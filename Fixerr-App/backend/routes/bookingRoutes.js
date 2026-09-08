// routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { auth, optionalAuth } = require('../middleware/auth');
const { bookingLimiter } = require('../middleware/rateLimiter');

router.post('/requests', bookingLimiter, optionalAuth, bookingController.createBooking);
router.get('/requests/availability', optionalAuth, bookingController.checkAvailability);
router.get('/requests', auth, bookingController.getBookings);
router.patch('/requests/ref/:ref', auth, bookingController.updateCustomerBooking);

module.exports = router;
