// routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

// Public — no auth required, anyone can send a Contact Us message.
router.post('/contact', contactController.submitContact);

module.exports = router;
