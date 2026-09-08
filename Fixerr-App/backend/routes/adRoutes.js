// routes/adRoutes.js
const express = require('express');
const router = express.Router();
const adController = require('../controllers/adController');
const { auth } = require('../middleware/auth');

router.get('/ads', adController.getAds);
router.post('/ads/click/:id', adController.clickAd);
router.post('/ads/inquire', auth, adController.inquireAd);
router.get('/ads/my', auth, adController.getMyAdLeads);
router.patch('/ads/my/:id', auth, adController.cancelMyAdLead);

module.exports = router;
