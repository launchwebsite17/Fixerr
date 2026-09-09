// routes/paymentGatewayRoutes.js
const express = require('express');
const router = express.Router();
const paymentGatewayController = require('../controllers/paymentGatewayController');
const { auth } = require('../middleware/auth');

router.get('/payment-gateway/bill-preview/:bookingRef', auth, paymentGatewayController.getBillPreview);
router.post('/payment-gateway/create-intent', auth, paymentGatewayController.createIntent);
router.post('/payment-gateway/confirm-intent', auth, paymentGatewayController.confirmIntent);
router.post('/payment-gateway/create-order', auth, paymentGatewayController.createOrder);
router.post('/payment-gateway/verify-payment', auth, paymentGatewayController.verifyPayment);
router.post('/payment-gateway/record-razorpay-failure', auth, paymentGatewayController.recordRazorpayFailure);
router.post('/create-order', auth, paymentGatewayController.createOrder);
router.post('/verify-payment', auth, paymentGatewayController.verifyPayment);
router.post('/payment-gateway/record-attempt', auth, paymentGatewayController.recordAttempt);
router.get('/payment-gateway/session-status', auth, paymentGatewayController.getSessionStatus);
router.get('/payment-gateway/status/:bookingRef', auth, paymentGatewayController.getStatus);

// NOTE: the Stripe webhook route (/api/payment-gateway/webhook) is intentionally NOT defined
// here. It needs the RAW, unparsed request body to verify Stripe's signature, but server.js's
// global express.json() middleware runs before any router in this file is reached — so it's
// mounted directly in server.js, ahead of that global JSON parser. See server.js for the actual
// route registration.

module.exports = router;
