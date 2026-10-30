// routes/trackRoutes.js
const express = require('express');
const router = express.Router();
const trackController = require('../controllers/trackController');
const { optionalAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimiter');

const trackLimiter = rateLimit(60 * 1000, 30, 'track');

// Public — anonymous visitors are tracked too; a valid login token links the view to the user.
router.post('/track/pageview', trackLimiter, optionalAuth, trackController.trackPageView);

// Admin Traffic Report (reads the tracked data).
router.use(require('./trafficRoutes'));

module.exports = router;
