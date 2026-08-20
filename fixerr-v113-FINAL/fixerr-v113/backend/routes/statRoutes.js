// routes/statRoutes.js
const express = require('express');
const router = express.Router();
const statController = require('../controllers/statController');

router.get('/cities', statController.getCities);
router.get('/prices', statController.getPrices);
router.get('/stats', statController.getPublicStats);
router.get('/stats/public', statController.getPublicStats);
router.get('/health', statController.getHealth);

module.exports = router;
