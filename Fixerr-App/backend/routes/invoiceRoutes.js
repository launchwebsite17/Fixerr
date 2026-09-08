// routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { auth, invoiceLinkOrAuth } = require('../middleware/auth');

router.get('/invoices/:bookingRef', auth, invoiceController.getInvoice);
// /download also accepts the signed ?token= link embedded in payment-receipt emails (in
// addition to a normal Bearer session, unchanged for the dashboards) — see invoiceLinkOrAuth.
router.get('/invoices/:bookingRef/download', invoiceLinkOrAuth, invoiceController.downloadInvoiceHTML);

module.exports = router;
