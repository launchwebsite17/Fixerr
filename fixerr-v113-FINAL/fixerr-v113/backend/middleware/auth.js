// middleware/auth.js - Authentication & Role Authorization Middleware
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../db');

// Verifies the JWT AND that the account still exists. A token can be cryptographically valid
// but reference a user that no longer exists (e.g. after a database migration where ids
// changed) — such "stale" sessions must be rejected with 401 so the client flushes them and
// forces a clean re-login, rather than the user getting stuck half-logged-in with failing calls.
async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Please log in.' });

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  try {
    const r = await query('SELECT id, role, active FROM users WHERE id=$1', [decoded.id]);
    const u = r.rows[0];
    if (!u) {
      return res.status(401).json({ error: 'Your session is no longer valid. Please log in again.' });
    }
    // Trust the current DB role over the (possibly stale) token claim.
    req.user = { ...decoded, id: u.id, role: u.role };
  } catch (dbErr) {
    // Database hiccup — fail open on the existence check so a transient DB issue does not
    // log everyone out. The token itself is already cryptographically verified above.
    console.error('auth existence-check DB error:', dbErr.message);
    req.user = decoded;
  }
  next();
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, env.JWT_SECRET);
    } catch (e) {}
  }
  next();
}

function admin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { auth, optionalAuth, admin };
