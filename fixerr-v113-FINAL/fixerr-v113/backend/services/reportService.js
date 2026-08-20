// services/reportService.js - Executive & Professional Performance Reports
const { query } = require('../db');

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
    sql += ` AND r.created >= $${params.length}::timestamptz`;
  }
  if (endDate) {
    params.push(endDate);
    sql += ` AND r.created <= ($${params.length}::timestamptz + interval '1 day')`;
  }
  sql += ` ORDER BY r.created DESC`;

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
    bookings: bookings.map((b, idx) => ({
      sNo: idx + 1,
      ref: b.ref,
      customerName: b.customer_name || 'N/A',
      serviceCategory: (b.service_key || '').toUpperCase(),
      subCategory: b.sub_service || 'Standard',
      bookingDate: b.created,
      status: b.status,
      invoiceNo: b.invoice_number || ('INV-' + b.ref.replace('BK-', '')),
      invoiceDate: b.invoice_created_at || b.created,
      invoiceAmount: parseFloat(b.invoice_total || b.confirmed_price || b.estimate || 0),
      currency: b.currency || (isINR ? 'INR' : 'USD')
    }))
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
    sql += ` AND r.created >= $${params.length}::timestamptz`;
  }
  if (endDate) {
    params.push(endDate);
    sql += ` AND r.created <= ($${params.length}::timestamptz + interval '1 day')`;
  }
  if (status && status !== 'all') {
    params.push(status);
    sql += ` AND r.status = $${params.length}`;
  }
  sql += ` ORDER BY r.created DESC`;

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
      bookingDate: b.created,
      status: b.status,
      invoiceNo: b.invoice_number || ('INV-' + b.ref.replace('BK-', '')),
      invoiceDate: b.invoice_created_at || b.created,
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
  reportData.bookings.forEach(b => {
    totalInvSum += b.invoiceAmount || 0;
    totalCommSum += b.commission || 0;
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${reportTitle}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 12mm 16mm 12mm;
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 11px;
        color: #6b7280;
      }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background: #f9fafb; }
    .report-card { max-width: 1050px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 28px; border: 1px solid #e5e7eb; }
    .header-banner { background: #d8e8d0; border-radius: 8px; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .header-logo-box { background: #ffffff; border-radius: 6px; padding: 8px 14px; display: flex; align-items: center; border: 1px solid #c2dbb5; }
    .header-logo-box img { height: 48px; object-fit: contain; }
    .header-title { text-align: center; flex: 1; padding: 0 20px; font-size: 22px; font-weight: 800; color: #14532d; margin: 0; }
    .header-dates { font-size: 13px; color: #1f2937; line-height: 1.6; font-weight: 500; min-width: 220px; }
    
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #f3f4f6; padding: 16px; border-radius: 8px; text-align: center; border: 1px solid #e5e7eb; }
    .stat-val { font-size: 24px; font-weight: 800; color: #15803d; margin-top: 4px; }
    .stat-lbl { font-size: 12px; color: #4b5563; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th { background: #f3f4f6; color: #374151; font-weight: 700; text-align: left; padding: 10px 10px; border: 1px solid #d1d5db; font-size: 12px; }
    td { padding: 8px 10px; border: 1px solid #e5e7eb; vertical-align: middle; }
    tfoot td { background: #f9fafb; font-weight: 800; font-size: 13px; border-top: 2px solid #15803d; }
    
    .badge { font-size: 10px; padding: 3px 8px; border-radius: 12px; font-weight: 700; display: inline-block; text-transform: uppercase; }
    .badge-completed { background: #d1fae5; color: #065f46; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-confirmed { background: #dbeafe; color: #1e40af; }
    .badge-in_progress { background: #e0f2fe; color: #0369a1; }
    .badge-cancelled { background: #fee2e2; color: #991b1b; }
    
    .print-btn { background: #15803d; color: #fff; border: none; padding: 10px 22px; border-radius: 6px; font-weight: 700; font-size: 14px; cursor: pointer; transition: background 0.2s; }
    .print-btn:hover { background: #166534; }
    
    @media print {
      body { background: #fff; padding: 0; }
      .report-card { box-shadow: none; border: none; width: 100%; max-width: none; padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 1106px; margin: 0 auto 16px; text-align: right;">
    <button onclick="window.print()" class="print-btn">🖨️ Print / Save as PDF</button>
  </div>
  <div class="report-card">
    <div class="header-banner">
      <div class="header-logo-box">
        <img src="https://fixerr-app.vercel.app/fixerr-logo.png" alt="Fixerr Logo">
      </div>
      <div class="header-title">${reportTitle}</div>
      <div class="header-dates">
        <div><strong>From Date :</strong> ${fromStr}</div>
        <div><strong>To Date :</strong> ${toStr}</div>
        <div><strong>Generated on :</strong> ${genStr}</div>
      </div>
    </div>

    <div class="grid">
      <div class="stat-card">
        <div class="stat-lbl">TOTAL BOOKINGS</div>
        <div class="stat-val">${reportData.stats.totalBookings}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">COMPLETED</div>
        <div class="stat-val">${reportData.stats.completedCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-lbl">${isPro ? `EARNINGS (${isUSD ? 'USD' : 'INR'})` : `COMMISSION (${isUSD ? 'USD' : 'INR'})`}</div>
        <div class="stat-val">${currencySym}${isPro ? reportData.stats.totalEarnings : reportData.stats.commission}</div>
      </div>
    </div>

    <h3 style="font-size: 15px; margin: 16px 0 10px; color: #111827;">Bookings Breakdown</h3>
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
        </tr>
      </thead>
      <tbody>
        ${reportData.bookings.map(b => `
        <tr>
          <td style="text-align: center;">${b.sNo}</td>
          <td><strong>${b.ref}</strong></td>
          <td>${b.customerName}</td>
          <td>${b.serviceCategory}</td>
          <td>${b.subCategory}</td>
          <td>${formatDDMMMYYYY(b.bookingDate)}</td>
          <td><span class="badge badge-${b.status}">${b.status.replace('_', ' ')}</span></td>
          <td>${b.invoiceNo}</td>
          <td>${formatDDMMMYYYY(b.invoiceDate)}</td>
          <td style="text-align: right;">${currencySym}${isUSD ? b.invoiceAmount.toFixed(2) : Math.round(b.invoiceAmount)}</td>
          ${!isPro ? `<td style="text-align: right;">${currencySym}${isUSD ? b.commission.toFixed(2) : Math.round(b.commission)}</td>` : ''}
        </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="9" style="text-align: right;">Total:</td>
          <td style="text-align: right;">${currencySym}${isUSD ? totalInvSum.toFixed(2) : Math.round(totalInvSum)}</td>
          ${!isPro ? `<td style="text-align: right;">${currencySym}${isUSD ? totalCommSum.toFixed(2) : Math.round(totalCommSum)}</td>` : ''}
        </tr>
      </tfoot>
    </table>
  </div>
</body>
</html>`;
}

module.exports = { generateProReport, generateAdminReport, generateReportHTML };
