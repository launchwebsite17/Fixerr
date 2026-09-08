// routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { auth } = require('../middleware/auth');

router.get('/wallet', auth, walletController.getWallet);
router.post('/wallet/topup', auth, walletController.topupWallet);

module.exports = router;
