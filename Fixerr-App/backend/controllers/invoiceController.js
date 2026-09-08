// controllers/invoiceController.js
const { query } = require('../db');
const { getInvoiceIfExists, generateInvoiceHTML } = require('../services/invoiceService');

// Only the customer who booked it, the pro assigned to it, an admin, or a valid signed
// invoice-link token scoped to this exact booking (see middleware/auth.js invoiceLinkOrAuth,
// used by the "View Invoice" link in payment-receipt emails) may view an invoice.
function canAccessBooking(req, booking) {
  if (!booking) return false;
  if (req.invoiceLinkBookingRef) return req.invoiceLinkBookingRef === booking.ref;
  const user = req.user;
  if (!user) return false;
  if (user.role === 'admin') return true;
  return String(booking.user_id) === String(user.id) || String(booking.assigned_pro_id) === String(user.id);
}

exports.getInvoice = async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
    const booking = bkRes.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!canAccessBooking(req, booking)) return res.status(403).json({ error: 'Not authorized to view this invoice' });

    // Invoices are only ever created when the professional marks the job "Completed" — this
    // endpoint just reads whatever exists, it never generates one on the fly.
    const invoice = await getInvoiceIfExists(bookingRef);
    if (!invoice) return res.status(404).json({ error: 'Invoice not available yet — it is generated once the professional marks this job as completed.' });
    res.json({ success: true, invoice, booking });
  } catch (err) {
    console.error('Get invoice error:', err.message);
    res.status(500).json({ error: err.message || 'Could not fetch invoice' });
  }
};

exports.downloadInvoiceHTML = async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
    const booking = bkRes.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (!canAccessBooking(req, booking)) return res.status(403).json({ error: 'Not authorized to view this invoice' });

    const invoice = await getInvoiceIfExists(bookingRef);
    if (!invoice) return res.status(404).json({ error: 'Invoice not available yet — it is generated once the professional marks this job as completed.' });
    const html = generateInvoiceHTML(invoice, booking);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Download invoice error:', err.message);
    res.status(500).json({ error: err.message || 'Could not generate invoice document' });
  }
};
