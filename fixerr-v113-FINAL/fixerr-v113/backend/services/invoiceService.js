// services/invoiceService.js - Invoice Generation & HTML Template
const { query } = require('../db');
const { calculateTax } = require('./taxService');
const { sendEmail, EMAIL } = require('./emailService');

function uid_inv() {
  return 'INV-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 9000 + 1000);
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

  const invoiceNum = uid_inv();

  // Save to DB
  const invRes = await query(
    `INSERT INTO invoices (invoice_number, invoice_num, booking_ref, user_id, subtotal, tax_amount, total_amount, currency, tax_breakdown, created_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, now())
     RETURNING *`,
    [
      invoiceNum,
      bookingRef,
      bk.user_id || null,
      subtotal,
      taxAmount,
      totalAmount,
      isIndia ? 'INR' : 'USD',
      JSON.stringify(taxInfo)
    ]
  );

  const invoice = invRes.rows[0];

  // Send invoice email if customer email exists
  if (bk.customer_email) {
    const tpl = EMAIL.invoiceEmail(
      bk.customer_name || 'Valued Customer',
      invoiceNum,
      totalAmount,
      invoice.currency,
      generateInvoiceHTML(invoice, bk)
    );
    await sendEmail(bk.customer_email, tpl.subject, tpl.html, 'invoice');
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
  const bookingDate = fmtD(booking.created);
  const servicedDate = fmtD(booking.preferred_date || booking.created);
  const payMethod = /paid|online/i.test(booking.payment_method || '') ? 'Online Payment' : (booking.payment_method || 'Card/UPI').toUpperCase();
  const payStatus = booking.status === 'completed' || /paid/i.test(booking.payment_method || '') ? 'PAID' : 'PENDING';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Customer Invoice #${invoice.invoice_number}</title>
  <style>
    @page { margin: 12mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 24px; background: #f9fafb; }
    .invoice-card { max-width: 800px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 32px; border: 1px solid #e5e7eb; }
    
    .header-banner { background: #d8e8d0; border-radius: 8px; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .logo-box { background: #ffffff; border-radius: 6px; padding: 8px 14px; display: flex; align-items: center; border: 1px solid #c2dbb5; }
    .logo-box img { height: 48px; object-fit: contain; }
    .inv-title { font-size: 24px; font-weight: 800; color: #14532d; margin: 0; text-align: center; flex: 1; padding: 0 16px; }
    .inv-meta { font-size: 13px; color: #1f2937; line-height: 1.6; font-weight: 500; min-width: 240px; }
    
    .billed-to { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; font-size: 13px; line-height: 1.5; }
    .billed-to strong { color: #111827; }
    
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th { background: #d8e8d0; color: #14532d; font-weight: 700; text-align: left; padding: 10px 14px; border: 1px solid #c2dbb5; }
    td { padding: 10px 14px; border: 1px solid #e5e7eb; vertical-align: middle; }
    
    .totals { width: 300px; margin-left: auto; font-size: 14px; margin-bottom: 24px; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
    .totals div.grand-total { border-top: 2px solid #15803d; border-bottom: none; font-size: 17px; font-weight: 800; color: #15803d; padding-top: 10px; }
    
    .footer { text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    .print-btn { background: #15803d; color: #fff; border: none; padding: 10px 22px; border-radius: 6px; font-weight: 700; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #166534; }
    
    @media print {
      body { background: #fff; padding: 0; }
      .invoice-card { box-shadow: none; border: none; width: 100%; max-width: none; padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 864px; margin: 0 auto 16px; text-align: right;">
    <button onclick="window.print()" class="print-btn">🖨️ Print / Download PDF</button>
  </div>
  <div class="invoice-card">
    <div class="header-banner">
      <div class="logo-box">
        <img src="https://fixerr-app.vercel.app/fixerr-logo.png" alt="Fixerr Logo">
      </div>
      <div class="inv-title">Customer Invoice</div>
      <div class="inv-meta">
        <div><strong>Invoice #:</strong> ${invoice.invoice_number}</div>
        <div><strong>Invoice Date:</strong> ${invDate}</div>
        <div><strong>Booking Ref.#:</strong> ${booking.ref}</div>
        <div><strong>Booking Date:</strong> ${bookingDate}</div>
        <div><strong>Serviced Date:</strong> ${servicedDate}</div>
        <div><strong>Payment Method:</strong> ${payMethod}</div>
        <div><strong>Payment Status:</strong> <span style="color:${payStatus === 'PAID' ? '#15803d' : '#d97706'};font-weight:700;">${payStatus}</span></div>
      </div>
    </div>

    <div class="billed-to">
      <strong>Billed To:</strong><br>
      ${booking.customer_name || 'Valued Customer'}<br>
      ${booking.customer_phone ? booking.customer_phone + '<br>' : ''}
      ${booking.address ? booking.address + '<br>' : ''}
      ${booking.city || ''}${booking.state ? ', ' + booking.state : ''} ${booking.zip || ''}<br>
      ${booking.country === 'IN' ? 'India' : 'United States'}
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

module.exports = { getOrCreateInvoice, generateInvoiceHTML };
