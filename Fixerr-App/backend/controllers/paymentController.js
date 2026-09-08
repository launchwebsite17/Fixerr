// controllers/paymentController.js
const { createPaymentOrder, verifyPayment, getPaymentConfig } = require('../services/paymentService');

// Public gateway config — tells the frontend whether to run a live checkout or the
// simulated flow, and supplies publishable (non-secret) keys when live.
exports.config = (req, res) => {
  try {
    res.json(getPaymentConfig());
  } catch (err) {
    res.status(500).json({ error: 'Could not load payment config' });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { bookingRef, paymentMethod, currency } = req.body;
    if (!bookingRef) return res.status(400).json({ error: 'bookingRef is required' });
    // Origin used to build Stripe success/cancel return URLs.
    const origin = req.body.origin || req.headers.origin ||
      (req.headers.host ? `${req.protocol}://${req.headers.host}` : '');
    const orderData = await createPaymentOrder(bookingRef, paymentMethod, currency, origin);
    res.json(orderData);
  } catch (err) {
    console.error('Payment order creation error:', err.message);
    res.status(500).json({ error: err.message || 'Payment order creation failed' });
  }
};

exports.verify = async (req, res) => {
  try {
    if (!req.body.bookingRef) return res.status(400).json({ error: 'bookingRef is required' });
    const result = await verifyPayment(req.body);
    res.json(result);
  } catch (err) {
    console.error('Payment verification error:', err.message);
    res.status(400).json({ error: err.message || 'Payment verification failed' });
  }
};
