// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../db');
const { sendEmail, EMAIL } = require('../services/emailService');
const { geocodePlace } = require('../services/geocodeService');
const { buildCpUniqueId } = require('../services/identityService');

exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, passkey, role, city, state, country, currency, address, zip, lat, lng } = req.body;
    if (!firstName || !lastName || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(400).json({ error: 'An account with this email already exists.' });

    const hash = bcrypt.hashSync(password, 10);
    const cpUniqueId = buildCpUniqueId({ role: role || 'customer', country, state, phone });
    // NOTE: `passkey` stores the raw (unhashed) password per product requirement. `hash` remains
    // the bcrypt hash used for authentication; passkey is a plaintext copy — handle with care.
    const r = await query(
      `INSERT INTO users (first,last,email,phone,hash,role,city,state,country,currency,address,zip,lat,lng,passkey,cp_unique_id,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true) RETURNING id,first,role,currency,country,cp_unique_id`,
      [firstName, lastName, email, phone || '', hash, role || 'customer', city || '', state || '', country || 'US', currency || 'USD', address || '', zip || '',
       lat || null, lng || null, passkey || password || null, cpUniqueId]
    );
    const u = r.rows[0];
    // Self-registration — the account is its own creator, referencing this same users.id.
    await query('UPDATE users SET created_by = $1 WHERE id = $1', [u.id]).catch(() => {});

    if ((!lat || !lng) && (city || zip || address)) {
      try {
        const geo = await geocodePlace({ city, state, country, zip, street: address });
        if (geo && geo.lat && geo.lng) {
          await query('UPDATE users SET lat=$1, lng=$2 WHERE id=$3', [geo.lat, geo.lng, u.id]);
        }
      } catch (geoErr) {}
    }

    const token = jwt.sign({ id: u.id, email, role: u.role }, env.JWT_SECRET, { expiresIn: '30d' });
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)', [
      'welcome', `New ${u.role} registered: ${u.first} (${email})`
    ]).catch(() => {});

    // Send a professional welcome email (Customer or Professional). Genuinely fire-and-forget —
    // not awaited, so a slow/failed mail send never delays or fails the registration response.
    const welcomeTpl = EMAIL.welcome(u.first, u.role);
    sendEmail(email, welcomeTpl.subject, welcomeTpl.html, 'welcome')
      .catch((mailErr) => console.error('Welcome email dispatch error (non-fatal):', mailErr.message));

    res.json({
      success: true,
      token,
      userId: u.id,
      role: u.role,
      name: u.first,
      currency: u.currency,
      country: u.country,
      cp_unique_id: u.cp_unique_id,
      welcome: `Welcome to Fixerr, ${u.first}! Your account is ready.`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

// Audit trail for the dedicated Admin Login page (admin-login.html) — logs every attempt,
// success or failure, to notifs so login activity is reviewable from the admin dashboard.
function logAdminLoginAttempt(success) {
  return query('INSERT INTO notifs (type, msg) VALUES ($1, $2)', [
    'admin_login',
    success ? 'Admin successfully logged in' : 'Admin login failed',
  ]).catch(() => {});
}

exports.login = async (req, res) => {
  try {
    let { email, password, expected_role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const cleanEmail = email.toLowerCase().trim();
    if (cleanEmail === 'admin@getfixerr.com') {
      expected_role = 'admin';
    }
    const isAdminAttempt = expected_role === 'admin';

    const r = await query('SELECT * FROM users WHERE LOWER(email)=$1 AND active=true', [cleanEmail]);
    const u = r.rows[0];
    if (!u) {
      if (isAdminAttempt) await logAdminLoginAttempt(false);
      return res.status(401).json({ error: 'No account found with this email. Please sign up.' });
    }

    if (!bcrypt.compareSync(password, u.hash)) {
      if (isAdminAttempt) await logAdminLoginAttempt(false);
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if (expected_role && u.role !== 'admin' && u.role !== expected_role) {
      if (isAdminAttempt) await logAdminLoginAttempt(false);
      return res.status(403).json({
        error: `This email is registered as a ${u.role === 'professional' ? 'Professional' : 'Customer'} account. Please select the ${u.role === 'professional' ? 'Professional' : 'Customer'} tab to log in.`
      });
    }

    if (isAdminAttempt) await logAdminLoginAttempt(true);

    const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, userId: u.id, role: u.role, name: u.first, currency: u.currency, country: u.country, city: u.city, state: u.state, cp_unique_id: u.cp_unique_id, redirect: u.role === 'admin' ? '/fixerr-owner-0si7erbb2ctq.html' : null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// Item 20 — Forgot password. Issues a signed, short-lived reset token and emails the link.
// Always responds success so the endpoint never reveals whether an email is registered.
exports.forgotPassword = async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Please enter your email address.' });
    const r = await query('SELECT id, first, email, hash FROM users WHERE LOWER(email)=$1 AND active=true', [email]);
    const u = r.rows[0];
    if (u) {
      // The token embeds a fragment of the current password hash; once the password changes,
      // the fragment no longer matches, making the link single-use without a separate table.
      const token = jwt.sign(
        { id: u.id, purpose: 'reset', h: String(u.hash).slice(0, 12) },
        env.JWT_SECRET, { expiresIn: '45m' }
      );
      const base = (env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const link = `${base}/reset-password.html?token=${encodeURIComponent(token)}`;
      const tpl = EMAIL.passwordReset(u.first, link);
      // Fire-and-forget — the response never reveals whether the email was sent (see comment
      // above), so there's nothing gained by waiting on it here.
      sendEmail(u.email, tpl.subject, tpl.html, 'password_reset')
        .catch((mailErr) => console.error('Reset email dispatch error (non-fatal):', mailErr.message));
    }
    res.json({ success: true, message: 'If an account exists for that email, a password reset link has been sent.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not process the request. Please try again.' });
  }
};

// Item 20 — Reset password. Verifies the token, checks it hasn't already been used, updates hash.
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'A reset link and a new password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    let payload;
    try { payload = jwt.verify(token, env.JWT_SECRET); }
    catch (e) { return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' }); }
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid reset link.' });
    const r = await query('SELECT id, hash FROM users WHERE id=$1 AND active=true', [payload.id]);
    const u = r.rows[0];
    if (!u) return res.status(400).json({ error: 'Account not found.' });
    if (payload.h !== String(u.hash).slice(0, 12))
      return res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
    const newHash = bcrypt.hashSync(password, 10);
    await query('UPDATE users SET hash=$1 WHERE id=$2', [newHash, u.id]);
    res.json({ success: true, message: 'Your password has been reset. You can now log in with your new password.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
};

exports.me = async (req, res) => {
  try {
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: 'User not found.' });

    const { hash, ...safe } = u;
    if (u.role === 'professional') {
      const pr = await query(
        `SELECT status, available, photo_url, services, years_exp, experience_map, bio,
                certifications, languages, rate_inr, rate_usd, badge, rating, reviews, created_at
         FROM pros WHERE user_id=$1`, [u.id]
      );
      const pro = pr.rows[0];
      safe.pro_status = pro ? pro.status : 'pending';
      safe.pro_available = pro ? !!pro.available : false;
      safe.pro = pro || null; // full professional profile for the dashboard
    }
    res.json(safe);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load profile.' });
  }
};
