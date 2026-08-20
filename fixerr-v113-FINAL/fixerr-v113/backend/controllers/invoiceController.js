// controllers/invoiceController.js
const { query } = require('../db');
const { getOrCreateInvoice, generateInvoiceHTML } = require('../services/invoiceService');

exports.getInvoice = async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const invoice = await getOrCreateInvoice(bookingRef);

    const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
    const booking = bkRes.rows[0];

    res.json({ success: true, invoice, booking });
  } catch (err) {
    console.error('Get invoice error:', err.message);
    res.status(500).json({ error: err.message || 'Could not fetch invoice' });
  }
};

exports.downloadInvoiceHTML = async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const invoice = await getOrCreateInvoice(bookingRef);

    const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
    const booking = bkRes.rows[0];

    const html = generateInvoiceHTML(invoice, booking);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Download invoice error:', err.message);
    res.status(500).json({ error: err.message || 'Could not generate invoice document' });
  }
};
