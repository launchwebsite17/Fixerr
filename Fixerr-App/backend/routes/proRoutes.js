// routes/proRoutes.js
const express = require('express');
const router = express.Router();
const proController = require('../controllers/proController');
const { auth } = require('../middleware/auth');

router.get('/pros', proController.getPros);
router.post('/pro-application', auth, proController.applyPro);
router.get('/pro/bookings', auth, proController.getProBookings);
router.patch('/pro/bookings/:ref', auth, proController.updateProBooking);

module.exports = router;
