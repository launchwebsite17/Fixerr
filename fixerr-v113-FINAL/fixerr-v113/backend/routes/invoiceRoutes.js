// routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');

router.get('/invoices/:bookingRef', invoiceController.getInvoice);
router.get('/invoices/:bookingRef/download', invoiceController.downloadInvoiceHTML);

module.exports = router;
