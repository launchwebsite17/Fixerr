// routes/trafficRoutes.js - Admin-only Traffic Report endpoints
const express = require('express');
const router = express.Router();
const trafficController = require('../controllers/trafficController');
const { auth, admin } = require('../middleware/auth');

router.get('/admin/traffic/summary', auth, admin, trafficController.getTrafficSummary);
router.get('/admin/traffic/visitors', auth, admin, trafficController.getTrafficVisitors);

module.exports = router;
