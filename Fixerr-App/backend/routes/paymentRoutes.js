// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.get('/payment/config', paymentController.config);
router.get('/payments/config', paymentController.config);
router.post('/payment/create-order', paymentController.createOrder);
router.post('/payments/create-order', paymentController.createOrder);
router.post('/payment/verify', paymentController.verify);
router.post('/payments/verify', paymentController.verify);

module.exports = router;
