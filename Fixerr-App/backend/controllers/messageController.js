// controllers/messageController.js
const { query } = require('../db');
const { noContact } = require('../middleware/sanitizer');

exports.sendMessage = async (req, res) => {
  try {
    const to = req.body.to || req.body.receiverId;
    const booking_ref = req.body.booking_ref || req.body.bookingRef;
    const content = req.body.content || req.body.message;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Message cannot be empty.' });
    if (noContact(content)) {
      return res.status(400).json({
        error: 'Please keep contact details (phone numbers, emails) within the platform for your safety.'
      });
    }
    const r = await query(
      `INSERT INTO messages ("from","to",booking_ref,content) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, to || null, booking_ref || null, content.trim()]
    );
    res.json({ success: true, message: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not send message.' });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const r = await query('SELECT * FROM messages WHERE booking_ref=$1 ORDER BY created ASC', [req.params.ref]);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load messages.' });
  }
};
