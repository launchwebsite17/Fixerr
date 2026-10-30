// controllers/trackController.js
const { recordPageView } = require('../services/visitorTrackingService');

// Public page view beacon from nav.js. Tracking must never affect the page, so failures are
// logged and answered with 204 rather than surfacing an error to the visitor.
exports.trackPageView = async (req, res) => {
  try {
    const result = await recordPageView({
      body: req.body,
      user: req.user || null,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(204).end();
  } catch (e) {
    console.error('Page view tracking failed:', e.message);
    res.status(204).end();
  }
};
