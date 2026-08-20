// routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { auth, admin } = require('../middleware/auth');

router.get('/reports/pro', auth, reportController.getProReport);
router.get('/reports/admin', auth, admin, reportController.getAdminReport);

module.exports = router;
