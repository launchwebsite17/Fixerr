// routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { auth } = require('../middleware/auth');

router.post('/reviews', auth, reviewController.submitReview);
router.get('/reviews/featured', reviewController.getFeaturedReviews);

module.exports = router;
