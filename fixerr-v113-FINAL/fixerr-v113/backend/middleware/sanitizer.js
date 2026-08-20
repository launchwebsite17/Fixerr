// middleware/sanitizer.js - XSS & Input Sanitization
function esc(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function sanitizeMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const clean = (obj) => {
      for (const k in obj) {
        if (typeof obj[k] === 'string') obj[k] = esc(obj[k]);
        else if (typeof obj[k] === 'object' && obj[k] !== null) clean(obj[k]);
      }
    };
    clean(req.body);
  }
  next();
}

function noContact(txt) {
  if (!txt) return false;
  return /\b\d{10}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|@\w+\.\w+|whatsapp|telegram/i.test(txt);
}

module.exports = { esc, sanitizeMiddleware, noContact };
