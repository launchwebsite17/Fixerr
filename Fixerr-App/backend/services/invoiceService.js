// services/invoiceService.js - Invoice Generation & HTML Template
const { query } = require('../db');
const env = require('../config/env');
const { calculateTax } = require('./taxService');
const { sendEmail, EMAIL } = require('./emailService');
const { normalizeBookingCountry, getBookingDateStr } = require('./bookingRefService');

/**
 * Invoice number format: INV-{US|IN}-{YYYYMMDD}-{000001}, resetting to 000001 each day per
 * country — same convention as booking refs (bookingRefService.js), but tracked against
 * invoices.invoice_number and dated by when the invoice is issued (not the booking's own date).
 */
const INVOICE_NUM_PATTERN = /^INV-(US|IN)-(\d{8})-(\d{6})$/;

async function generateInvoiceNumber(countryCode) {
  const cc = normalizeBookingCountry(countryCode);
  const dateStr = getBookingDateStr();
  const prefix = `INV-${cc}-${dateStr}-`;

  const r = await query(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY invoice_number DESC LIMIT 1`,
    [prefix + '%']
  );

  let nextSeq = 1;
  if (r.rows[0]?.invoice_number) {
    const m = r.rows[0].invoice_number.match(INVOICE_NUM_PATTERN);
    if (m) nextSeq = parseInt(m[3], 10) + 1;
  }
  if (nextSeq > 999999) throw new Error('Daily invoice number limit reached.');

  return prefix + String(nextSeq).padStart(6, '0');
}

/** Preview bill totals (subtotal + tax) without persisting an invoice row. */
async function computeBillPreview(bookingRef) {
  const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
  if (bkRes.rows.length === 0) throw new Error('Booking not found');
  const bk = bkRes.rows[0];
  const isIndia = bk.country === 'IN';
  const subtotal = parseFloat(bk.confirmed_price || bk.proposed_price || bk.estimate || 0);
  const taxInfo = await calculateTax(subtotal, bk.state, bk.country);
  const taxAmount = taxInfo.taxAmount;
  const totalAmount = subtotal + taxAmount;

  const billingAddress = {
    name: bk.customer_name || '',
    email: bk.customer_email || '',
    phone: bk.customer_phone || '',
    line1: bk.address || '',
    line2: '',
    city: bk.city || '',
    state: bk.state || '',
    zip: bk.zip || '',
    country: bk.country === 'IN' ? 'IN' : (bk.country || 'US'),
    countryLabel: bk.country === 'IN' ? 'India' : 'United States'
  };

  return {
    bookingRef,
    serviceKey: bk.service_key,
    subService: bk.sub_service,
    customerName: bk.customer_name,
    customerEmail: bk.customer_email,
    customerPhone: bk.customer_phone,
    state: bk.state,
    country: bk.country,
    billingAddress,
    subtotal,
    taxAmount,
    taxName: taxInfo.taxName,
    taxRate: taxInfo.taxRate,
    taxBreakdown: taxInfo.breakdown || [],
    totalAmount,
    currency: isIndia ? 'INR' : 'USD'
  };
}

// Read-only lookup — does NOT create an invoice. Invoices are only ever created from
// getOrCreateInvoice(), which is called exclusively when a professional marks a booking
// "Completed" (proController.js). Viewing/downloading an invoice or verifying a payment must
// never conjure one into existence early — they use this instead.
async function getInvoiceIfExists(bookingRef) {
  const r = await query('SELECT * FROM invoices WHERE booking_ref=$1', [bookingRef]);
  return r.rows[0] || null;
}

async function getOrCreateInvoice(bookingRef) {
  // Check if invoice already exists
  const existing = await query('SELECT * FROM invoices WHERE booking_ref=$1', [bookingRef]);
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Fetch booking details
  const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
  if (bkRes.rows.length === 0) {
    throw new Error('Booking not found');
  }
  const bk = bkRes.rows[0];
  const isIndia = bk.country === 'IN';
  // Use the exact agreed booking amount: the confirmed (approved) price first, then the
  // proposed final price, and only fall back to the starting estimate if neither exists.
  const subtotal = parseFloat(bk.confirmed_price || bk.proposed_price || bk.estimate || 0);

  // Calculate tax
  const taxInfo = await calculateTax(subtotal, bk.state, bk.country);
  const taxAmount = taxInfo.taxAmount;
  const totalAmount = subtotal + taxAmount;

  const invoiceNum = await generateInvoiceNumber(bk.country);
  const invRes = await query(
    `INSERT INTO invoices (invoice_number, booking_ref, user_id, customer_id, pro_id, subtotal, tax_amount, tax_rate, total_amount, currency, tax_breakdown, payment_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'notpaid', now())
     RETURNING *`,
    [
      invoiceNum,
      bookingRef,
      bk.user_id || null,
      bk.user_id || null,
      bk.assigned_pro_id || null,
      subtotal,
      taxAmount,
      taxInfo.taxRate || 0,
      totalAmount,
      isIndia ? 'INR' : 'USD',
      JSON.stringify(taxInfo)
    ]
  );

  const invoice = invRes.rows[0];

  // Send invoice email if customer email exists. Fire-and-forget — the invoice row above is
  // already created/returned regardless of how long (or whether) the email send takes.
  if (bk.customer_email) {
    const tpl = EMAIL.invoiceEmail(
      bk.customer_name || 'Valued Customer',
      invoiceNum,
      totalAmount,
      invoice.currency,
      generateInvoiceHTML(invoice, bk),
      bookingRef,
      invoice.payment_status
    );
    sendEmail(bk.customer_email, tpl.subject, tpl.html, 'invoice')
      .catch((mailErr) => console.error('Invoice email dispatch error (non-fatal):', mailErr.message));
  }

  return invoice;
}

function generateInvoiceHTML(invoice, booking) {
  const isIndia = invoice.currency === 'INR';
  const currSym = isIndia ? '₹' : '$';
  const taxInfo = typeof invoice.tax_breakdown === 'string'
    ? JSON.parse(invoice.tax_breakdown)
    : (invoice.tax_breakdown || {});

  const subtotalNum = parseFloat(invoice.subtotal) || 0;
  const taxNum = parseFloat(invoice.tax_amount) || 0;
  const subtotal = subtotalNum.toFixed(2);
  const taxAmount = taxNum.toFixed(2);
  const totalAmount = (subtotalNum + taxNum).toFixed(2);

  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const fmtD = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    const day = String(dt.getDate()).padStart(2, '0');
    return `${day}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
  };

  const invDate = fmtD(invoice.created_at);
  const bookingDate = fmtD(booking.created_at);
  const servicedDate = fmtD(booking.preferred_date || booking.created_at);
  // Payment status/method come from the invoice row itself (the single source of truth updated
  // when a payment gateway transaction completes) — not derived from the booking's own status.
  const payMethod = /paid|online/i.test(invoice.payment_method || '') ? 'Online Payment' : (invoice.payment_method || 'Card/UPI').toUpperCase();
  const payStatus = invoice.payment_status === 'paid' ? 'PAID' : 'PENDING';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Customer Invoice #${invoice.invoice_number}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    html, body { width: 100%; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background: #f9fafb; }
    /* Size the on-screen preview to real A4 portrait width (210mm) so it reads as an actual
       page, not an arbitrary box — matches the print output below one-to-one. */
    .invoice-card { width: 210mm; max-width: 100%; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 32px; border: 1px solid #e5e7eb; overflow: hidden; }
    .no-print { width: 210mm; max-width: 100%; margin: 0 auto 16px; display: flex; justify-content: flex-end; text-align: right; }

    .header-banner { background: #d8e8d0; border-radius: 8px; padding: 20px 24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
    .logo-box { background: #ffffff; border-radius: 6px; padding: 8px 14px; display: flex; align-items: center; border: 1px solid #c2dbb5; }
    .logo-box img { height: 48px; object-fit: contain; }
    .inv-title { font-size: 24px; font-weight: 800; color: #14532d; margin: 0; text-align: center; flex: 1; padding: 0 16px; }
    .inv-meta { font-size: 13px; color: #1f2937; line-height: 1.6; font-weight: 500; }

    .billed-to { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; font-size: 13px; line-height: 1.5; display: flex; flex-wrap: nowrap; justify-content: space-between; gap: 16px; }
    .billed-to strong { color: #111827; }
    .billed-to .booking-meta { text-align: right; flex-shrink: 0; }
    .billed-to .booking-meta div { margin-bottom: 2px; white-space: nowrap; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; table-layout: fixed; }
    th { background: #d8e8d0; color: #14532d; font-weight: 700; text-align: left; padding: 10px 14px; border: 1px solid #c2dbb5; }
    td { padding: 10px 14px; border: 1px solid #e5e7eb; vertical-align: middle; word-wrap: break-word; }

    .totals { width: 300px; max-width: 100%; margin-left: auto; font-size: 14px; margin-bottom: 24px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
    .totals div.grand-total { border-top: 2px solid #15803d; border-bottom: none; font-size: 17px; font-weight: 800; color: #15803d; padding-top: 10px; }

    .footer { text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    .print-btn { background: #15803d; color: #fff; border: none; padding: 10px 22px; border-radius: 6px; font-weight: 700; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #166534; }

    @media print {
      html, body { width: 186mm; }
      body { background: #fff; padding: 0; }
      /* border-radius + box-shadow + overflow:hidden together can force Chrome to composite
         this card as a single rasterized layer when printing, turning its text into an
         unselectable image inside the PDF — drop all three for print so text stays real text. */
      .invoice-card { box-shadow: none; border: none; border-radius: 0; overflow: visible; width: 100%; max-width: 100%; padding: 0; margin: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" class="print-btn">🖨️ Print / Download PDF</button>
  </div>
  <div class="invoice-card">
    <div class="header-banner">
      <div class="logo-box">
        <img src="${env.APP_BASE_URL.replace(/\/+$/, '')}/assets/logo-icon.png" alt="Fixerr Logo">
      </div>
      <div class="inv-title">Customer Invoice</div>
      <div class="inv-meta">
        <div><strong>Invoice #:</strong> ${invoice.invoice_number}</div>
        <div><strong>Invoice Date:</strong> ${invDate}</div>
      </div>
    </div>

    <div class="billed-to">
      <div>
        <strong>Billed To:</strong><br>
        ${booking.customer_name || 'Valued Customer'}<br>
        ${booking.customer_phone ? booking.customer_phone + '<br>' : ''}
        ${booking.address ? booking.address + '<br>' : ''}
        ${booking.city || ''}${booking.state ? ', ' + booking.state : ''} ${booking.zip || ''}<br>
        ${booking.country === 'IN' ? 'India' : 'United States'}
      </div>
      <div class="booking-meta">
        <div><strong>Booking Ref.#:</strong> ${booking.ref}</div>
        <div><strong>Booking Date:</strong> ${bookingDate}</div>
        <div><strong>Serviced Date:</strong> ${servicedDate}</div>
        <div><strong>Payment Method:</strong> ${payMethod}</div>
        <div><strong>Payment Status:</strong> <span style="color:${payStatus === 'PAID' ? '#15803d' : '#d97706'};font-weight:700;">${payStatus}</span></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 45px; text-align: center;">S.No</th>
          <th>Service Category</th>
          <th>Sub-Category</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="text-align: center;">1</td>
          <td><strong>${(booking.service_key || 'Home Service').toUpperCase()}</strong></td>
          <td>${booking.sub_service || 'Faucet Repair'}</td>
          <td style="text-align: right;">${currSym}${subtotal}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal:</span> <span>${currSym}${subtotal}</span></div>
      <div><span>${taxInfo.taxName || 'Sales Tax'}:</span> <span>${currSym}${taxAmount}</span></div>
      <div class="grand-total"><span>Total Paid:</span> <span>${currSym}${totalAmount}</span></div>
    </div>

    <div class="footer">
      <p>Fixerr On-Demand Home Services Platform — Official Customer Invoice</p>
      <p>Thank you for choosing Fixerr! Questions? Contact support@getfixerr.com</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { getOrCreateInvoice, getInvoiceIfExists, generateInvoiceHTML, computeBillPreview, generateInvoiceNumber };
