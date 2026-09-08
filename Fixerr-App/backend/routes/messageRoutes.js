// routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { auth } = require('../middleware/auth');

router.post('/messages', auth, messageController.sendMessage);
router.get('/messages/:ref', auth, messageController.getMessages);

module.exports = router;
