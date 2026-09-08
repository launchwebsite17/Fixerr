// controllers/contactController.js
const { sendEmail, EMAIL } = require('../services/emailService');

const SUPPORT_EMAIL = 'support@getfixerr.com';

exports.submitContact = async (req, res) => {
  try {
    const b = req.body;
    const name = (b.name || '').trim();
    const email = (b.email || '').trim();
    const message = (b.message || '').trim();

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const data = {
      name,
      email,
      phone: (b.phone || '').trim(),
      subject: (b.subject || 'General Inquiry').trim(),
      message,
    };

    const { subject, html } = EMAIL.contactUs(data);
    await sendEmail(SUPPORT_EMAIL, subject, html, 'contact_us');

    res.json({ success: true, message: 'Thanks for reaching out! Our team will get back to you within 24 hours.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not send your message. Please try again.' });
  }
};
