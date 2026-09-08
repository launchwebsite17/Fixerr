// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/register', authLimiter, authController.register);
router.post('/auth/register', authLimiter, authController.register);
router.post('/auth/signup', authLimiter, authController.register);
router.post('/signup', authLimiter, authController.register);

router.post('/login', authLimiter, authController.login);
router.post('/auth/login', authLimiter, authController.login);

// Item 20 — password reset
router.post('/auth/forgot', authLimiter, authController.forgotPassword);
router.post('/forgot', authLimiter, authController.forgotPassword);
router.post('/auth/reset', authLimiter, authController.resetPassword);
router.post('/reset', authLimiter, authController.resetPassword);

router.get('/me', auth, authController.me);
router.get('/auth/me', auth, authController.me);

module.exports = router;
