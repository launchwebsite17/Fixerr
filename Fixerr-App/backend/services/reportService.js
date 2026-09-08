// services/reportService.js - Executive & Professional Performance Reports
const ExcelJS = require('exceljs');
const { query } = require('../db');
const env = require('../config/env');
const { fallbackInvoiceLabelFromBookingRef } = require('./bookingRefService');

function formatDDMMMYYYY(d) {
  if (!d) return '01-AUG-2026';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const day = String(dt.getDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${day}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
}

async function generateProReport(userId, startDate, endDate) {
  const proUser = await query('SELECT first, last, email, city, country FROM users WHERE id=$1', [userId]);
  if (proUser.rows.length === 0) throw new Error('Professional not found');
  const pu = proUser.rows[0];

  const proRecord = await query('SELECT id, rating, reviews FROM pros WHERE user_id=$1', [userId]);

  let sql = `
    SELECT r.*, i.invoice_number, i.created_at as invoice_created_at, i.total_amount as invoice_total
    FROM requests r
    LEFT JOIN invoices i ON r.ref = i.booking_ref
    WHERE (r.assigned_pro_id=$1 OR r.preferred_pro_id=$2)
  `;
  const params = [userId, userId];

  if (startDate) {
    params.push(startDate);
    sql += ` AND r.created_at >= $${params.length}::timestamptz`;
  }
  if (endDate) {
    params.push(endDate);
    sql += ` AND r.created_at <= ($${params.length}::timestamptz + interval '1 day')`;
  }
  sql += ` ORDER BY r.created_at DESC`;

  const bkRes = await query(sql, params);
  const bookings = bkRes.rows;

  const isINR = pu.country === 'IN';
  const totalBookings = bookings.length;
  const completedBookings = bookings.filter(b => b.status === 'completed');
  const cancelledBookings = bookings.filter(b => b.status === 'cancelled' || b.status === 'declined');

  let totalEarnings = 0;
  completedBookings.forEach(b => {
    const amount = parseFloat(b.pro_earns || b.confirmed_price || b.estimate || 0);
    totalEarnings += amount;
  });

  return {
    type: 'professional',
    proName: `${pu.first} ${pu.last}`,
    email: pu.email,
    city: pu.city,
    country: pu.country,
    rating: proRecord.rows[0]?.rating || 4.8,
    reviewsCount: proRecord.rows[0]?.reviews || 0,
    startDate: startDate || null,
    endDate: endDate || null,
    generatedAt: new Date().toISOString(),
    stats: {
      totalBookings,
      completedCount: completedBookings.length,
      cancelledCount: cancelledBookings.length,
      totalEarnings: isINR ? Math.round(totalEarnings) : parseFloat(totalEarnings.toFixed(2))
    },
    bookings: bookings.map((b, idx) => {
      // Pro Amount = Total Amount without Tax - FixErr Commission. Prefer the values already
      // stored on the booking (set from the pre-tax price when it was priced/confirmed);
      // fall back to the standard 15% commission split only if they were never set.
      const subtotal = parseFloat(b.confirmed_price || b.estimate || 0);
      const commission = b.commission != null && b.commission !== '' ? parseFloat(b.commission) : Math.round(subtotal * 0.15);
      const proAmount = b.pro_earns != null && b.pro_earns !== '' ? parseFloat(b.pro_earns) : (subtotal - commission);
      return {
        sNo: idx + 1,
        ref: b.ref,
        customerName: b.customer_name || 'N/A',
        serviceCategory: (b.service_key || '').toUpperCase(),
        subCategory: b.sub_service || 'Standard',
        bookingDate: b.created_at,
        status: b.status,
        invoiceNo: b.invoice_number || fallbackInvoiceLabelFromBookingRef(b.ref),
        invoiceDate: b.invoice_created_at || b.created_at,
        invoiceAmount: parseFloat(b.invoice_total || b.confirmed_price || b.estimate || 0),
        commission: isINR ? Math.round(commission) : parseFloat(commission.toFixed(2)),
        proAmount: isINR ? Math.round(proAmount) : parseFloat(proAmount.toFixed(2)),
        currency: b.currency || (isINR ? 'INR' : 'USD')
      };
    })
  };
}

async function generateAdminReport(startDate, endDate, country = 'IN', status = 'all') {
  let sql = `
    SELECT r.*, i.invoice_number, i.created_at as invoice_created_at, i.total_amount as invoice_total
    FROM requests r
    LEFT JOIN invoices i ON r.ref = i.booking_ref
    WHERE 1=1
  `;
  const params = [];

  const isUS = country === 'US';
  if (isUS) {
    sql += ` AND (r.currency = 'USD' OR r.country = 'US' OR r.country IS NULL OR r.country != 'IN')`;
  } else {
    sql += ` AND (r.currency = 'INR' OR r.country = 'IN')`;
  }

  if (startDate) {
    params.push(startDate);
    sql += ` AND r.created_at >= $${params.length}::timestamptz`;
  }
  if (endDate) {
    params.push(endDate);
    sql += ` AND r.created_at <= ($${params.length}::timestamptz + interval '1 day')`;
  }
  if (status && status !== 'all') {
    params.push(status);
    sql += ` AND r.status = $${params.length}`;
  }
  sql += ` ORDER BY r.created_at DESC`;

  const bkRes = await query(sql, params);
  const bookings = bkRes.rows;

  const totalBookings = bookings.length;
  const completed = bookings.filter(b => b.status === 'completed');
  const pending = bookings.filter(b => b.status === 'pending');
  const cancelled = bookings.filter(b => b.status === 'cancelled');

  let revenue = 0;
  let commission = 0;

  completed.forEach(b => {
    const total = parseFloat(b.invoice_total || b.confirmed_price || b.estimate || 0);
    const comm = parseFloat(b.commission || Math.round(total * 0.15));
    revenue += total;
    commission += comm;
  });

  const totalUsers = await query('SELECT COUNT(*) FROM users');
  const totalPros = await query("SELECT COUNT(*) FROM pros WHERE status='approved'");

  return {
    type: 'admin',
    country: isUS ? 'US' : 'IN',
    filterStatus: status || 'all',
    startDate: startDate || null,
    endDate: endDate || null,
    generatedAt: new Date().toISOString(),
    stats: {
      totalUsers: +totalUsers.rows[0].count,
      totalPros: +totalPros.rows[0].count,
      totalBookings,
      completedCount: completed.length,
      pendingCount: pending.length,
      cancelledCount: cancelled.length,
      revenue: isUS ? parseFloat(revenue.toFixed(2)) : Math.round(revenue),
      commission: isUS ? parseFloat(commission.toFixed(2)) : Math.round(commission)
    },
    bookings: bookings.map((b, idx) => ({
      sNo: idx + 1,
      ref: b.ref,
      customerName: b.customer_name || 'N/A',
      serviceCategory: (b.service_key || '').toUpperCase(),
      subCategory: b.sub_service || 'Standard',
      bookingDate: b.created_at,
      status: b.status,
      invoiceNo: b.invoice_number || fallbackInvoiceLabelFromBookingRef(b.ref),
      invoiceDate: b.invoice_created_at || b.created_at,
      invoiceAmount: parseFloat(b.invoice_total || b.confirmed_price || b.estimate || 0),
      commission: parseFloat(b.commission || Math.round(parseFloat(b.confirmed_price || b.estimate || 0) * 0.15)),
      currency: isUS ? 'USD' : 'INR'
    }))
  };
}

function generateReportHTML(reportData) {
  const isPro = reportData.type === 'professional';
  const reportTitle = isPro
    ? 'Professional Performance & Earning Summary'
    : 'Executive Performance Report';

  const fromStr = formatDDMMMYYYY(reportData.startDate || '2026-08-01');
  const toStr = formatDDMMMYYYY(reportData.endDate || '2026-08-07');
  const genStr = formatDDMMMYYYY(reportData.generatedAt);

  const currencySym = (reportData.country === 'US' || reportData.bookings[0]?.currency === 'USD') ? '$' : '₹';
  const isUSD = currencySym === '$';

  let totalInvSum = 0;
  let totalCommSum = 0;
  let totalProAmountSum = 0;
  reportData.bookings.forEach(b => {
    totalInvSum += b.invoiceAmount || 0;
    totalCommSum += b.commission || 0;
    totalProAmountSum += b.proAmount || 0;
  });

  // Same filters used to build this HTML report, re-sent so the "Download Excel" button on
  // this page can fetch the matching .xlsx without the page needing to parse its own (blob:) URL.
  const excelParams = new URLSearchParams({ format: 'xlsx' });
  if (reportData.startDate) excelParams.set('startDate', reportData.startDate);
  if (reportData.endDate) excelParams.set('endDate', reportData.endDate);
  if (!isPro) {
    excelParams.set('country', reportData.country || 'IN');
    excelParams.set('status', reportData.filterStatus || 'all');
  }
  const excelPath = (isPro ? '/api/reports/pro' : '/api/reports/admin') + '?' + excelParams.toString();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${reportTitle}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm;
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 11px;
        color: #6b7280;
      }
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    html, body { width: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background: #f9fafb; }
    .report-card { max-width: 1050px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 28px; border: 1px solid #e5e7eb; overflow: hidden; }
    .no-print { max-width: 1050px; margin: 0 auto 16px; text-align: right; display: flex; justify-content: flex-end; gap: 10px; }
    .header-banner { background: #d8e8d0; border-radius: 8px; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .header-logo-box { background: #ffffff; border-radius: 6px; padding: 8px 14px; display: flex; align-items: center; border: 1px solid #c2dbb5; }
    .header-logo-box img { height: 48px; object-fit: contain; }
    .header-title { text-align: center; flex: 1; padding: 0 20px; font-size: 22px; font-weight: 800; color: #14532d; margin: 0; }
    .header-dates { font-size: 13px; color: #1f2937; line-height: 1.6; font-weight: 500; min-width: 220px; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th { background: #f3f4f6; color: #374151; font-weight: 700; text-align: left; padding: 10px 10px; border: 1px solid #d1d5db; font-size: 12px; }
    td { padding: 8px 10px; border: 1px solid #e5e7eb; vertical-align: middle; word-wrap: break-word; }
    tfoot td { background: #f9fafb; font-weight: 800; font-size: 13px; border-top: 2px solid #15803d; }
    
    .print-btn, .excel-btn { color: #fff; border: none; padding: 10px 22px; border-radius: 6px; font-weight: 700; font-size: 14px; cursor: pointer; transition: background 0.2s; }
    .print-btn { background: #15803d; }
    .print-btn:hover { background: #166534; }
    .excel-btn { background: #1D6F42; }
    .excel-btn:hover { background: #14532d; }
    .excel-btn:disabled { opacity: 0.65; cursor: not-allowed; }
    
    @media print {
      /* A4 landscape usable width after 12mm margins each side (297mm - 24mm) — 10-11 data
         columns don't fit within portrait's 186mm even at a reduced font, so print landscape. */
      html, body { width: 273mm; }
      body { background: #fff; padding: 0; }
      /* border-radius + box-shadow + overflow:hidden together can force Chrome to composite
         this card as a single rasterized layer when printing, turning its text into an
         unselectable image inside the PDF — drop all three for print so text stays real text. */
      .report-card { box-shadow: none; border: none; border-radius: 0; overflow: visible; width: 100%; max-width: 100%; padding: 0; margin: 0; }
      .no-print { display: none !important; }
      table { font-size: 10px; }
      th, td { padding: 5px 6px; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button id="excel-dl-btn" onclick="downloadReportExcel()" class="excel-btn">📊 Download Excel</button>
    <button onclick="window.print()" class="print-btn">🖨️ Print / Save as PDF</button>
  </div>
  <div class="report-card">
    <div class="header-banner">
      <div class="header-logo-box">
        <img src="${env.APP_BASE_URL.replace(/\/+$/, '')}/assets/logo-icon.png" alt="Fixerr Logo">
      </div>
      <div class="header-title">${reportTitle}</div>
      <div class="header-dates">
        <div><strong>From Date :</strong> ${fromStr}</div>
        <div><strong>To Date :</strong> ${toStr}</div>
        <div><strong>Generated on :</strong> ${genStr}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 45px; text-align: center;">S.No</th>
          <th>Booking Ref.#</th>
          <th>Customer Name</th>
          <th>Service Category</th>
          <th>Sub Category</th>
          <th>Booking Date</th>
          <th>Status</th>
          <th>Invoice#</th>
          <th>Invoice Date</th>
          <th style="text-align: right;">Invoice Amount</th>
          ${!isPro ? '<th style="text-align: right;">FixErr Commission</th>' : ''}
          ${isPro ? '<th style="text-align: right;">Pro Amount</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${reportData.bookings.map(b => `
        <tr>
          <td style="text-align: center;">${b.sNo}</td>
          <td>${b.ref}</td>
          <td>${b.customerName}</td>
          <td>${b.serviceCategory}</td>
          <td>${b.subCategory}</td>
          <td>${formatDDMMMYYYY(b.bookingDate)}</td>
          <td style="text-transform: capitalize;">${b.status.replace('_', ' ')}</td>
          <td>${b.invoiceNo}</td>
          <td>${formatDDMMMYYYY(b.invoiceDate)}</td>
          <td style="text-align: right;">${currencySym}${isUSD ? b.invoiceAmount.toFixed(2) : Math.round(b.invoiceAmount)}</td>
          ${!isPro ? `<td style="text-align: right;">${currencySym}${isUSD ? b.commission.toFixed(2) : Math.round(b.commission)}</td>` : ''}
          ${isPro ? `<td style="text-align: right;">${currencySym}${isUSD ? b.proAmount.toFixed(2) : Math.round(b.proAmount)}</td>` : ''}
        </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="9" style="text-align: right;">Total:</td>
          <td style="text-align: right;">${currencySym}${isUSD ? totalInvSum.toFixed(2) : Math.round(totalInvSum)}</td>
          ${!isPro ? `<td style="text-align: right;">${currencySym}${isUSD ? totalCommSum.toFixed(2) : Math.round(totalCommSum)}</td>` : ''}
          ${isPro ? `<td style="text-align: right;">${currencySym}${isUSD ? totalProAmountSum.toFixed(2) : Math.round(totalProAmountSum)}</td>` : ''}
        </tr>
      </tfoot>
    </table>
  </div>
  <script>
    // This report opens in its own tab via a blob: URL, which keeps the origin (and therefore
    // localStorage) of the dashboard that generated it, so the saved auth token is still readable
    // here for the matching authenticated .xlsx download.
    async function downloadReportExcel() {
      const btn = document.getElementById('excel-dl-btn');
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = 'Preparing…';
      try {
        const token = localStorage.getItem('fx_tok');
        const res = await fetch(location.origin + ${JSON.stringify(excelPath)}, {
          headers: token ? { Authorization: 'Bearer ' + token } : {}
        });
        if (!res.ok) {
          let msg = 'Could not generate Excel file';
          try { msg = (await res.json()).error || msg; } catch (e) {}
          throw new Error(msg);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = ${JSON.stringify(reportTitle.replace(/[^a-z0-9]+/gi, '-') + '.xlsx')};
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        alert(e.message || 'Could not download Excel file');
      } finally {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    }
  </script>
</body>
</html>`;
}

async function generateReportExcel(reportData) {
  const isPro = reportData.type === 'professional';
  const reportTitle = isPro
    ? 'Professional Performance & Earning Summary'
    : 'Executive Performance Report';
  const currencySym = (reportData.country === 'US' || reportData.bookings[0]?.currency === 'USD') ? '$' : '₹';
  const currencyCode = currencySym === '$' ? 'USD' : 'INR';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fixerr';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Report', { pageSetup: { paperSize: 9, orientation: 'landscape' } });

  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = reportTitle;
  sheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF14532D' } };

  sheet.getCell('A2').value = 'From Date:';
  sheet.getCell('B2').value = formatDDMMMYYYY(reportData.startDate || '2026-08-01');
  sheet.getCell('C2').value = 'To Date:';
  sheet.getCell('D2').value = formatDDMMMYYYY(reportData.endDate || '2026-08-07');
  sheet.getCell('E2').value = 'Generated on:';
  sheet.getCell('F2').value = formatDDMMMYYYY(reportData.generatedAt);
  ['A2', 'C2', 'E2'].forEach(c => { sheet.getCell(c).font = { bold: true }; });

  const headers = ['S.No', 'Booking Ref.#', 'Customer Name', 'Service Category', 'Sub Category', 'Booking Date', 'Status', 'Invoice#', 'Invoice Date', `Invoice Amount (${currencyCode})`];
  if (!isPro) headers.push(`FixErr Commission (${currencyCode})`);
  if (isPro) headers.push(`Pro Amount (${currencyCode})`);

  const headerRow = sheet.addRow([]);
  headerRow.commit();
  const tableHeaderRow = sheet.addRow(headers);
  tableHeaderRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });

  let totalInvSum = 0;
  let totalCommSum = 0;
  let totalProAmountSum = 0;
  reportData.bookings.forEach(b => {
    totalInvSum += b.invoiceAmount || 0;
    totalCommSum += b.commission || 0;
    totalProAmountSum += b.proAmount || 0;
    const row = [b.sNo, b.ref, b.customerName, b.serviceCategory, b.subCategory, formatDDMMMYYYY(b.bookingDate), b.status.replace('_', ' '), b.invoiceNo, formatDDMMMYYYY(b.invoiceDate), parseFloat(b.invoiceAmount.toFixed(2))];
    if (!isPro) row.push(parseFloat((b.commission || 0).toFixed(2)));
    if (isPro) row.push(parseFloat((b.proAmount || 0).toFixed(2)));
    sheet.addRow(row);
  });

  const totalRow = ['', '', '', '', '', '', '', '', 'Total:', parseFloat(totalInvSum.toFixed(2))];
  if (!isPro) totalRow.push(parseFloat(totalCommSum.toFixed(2)));
  if (isPro) totalRow.push(parseFloat(totalProAmountSum.toFixed(2)));
  const tfoot = sheet.addRow(totalRow);
  tfoot.eachCell(cell => { cell.font = { bold: true }; });

  sheet.columns.forEach((col, idx) => {
    col.width = idx === 1 ? 16 : idx === 2 ? 20 : 16;
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { generateProReport, generateAdminReport, generateReportHTML, generateReportExcel };
