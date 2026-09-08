// config/env.js - Centralized Environment Configuration
// Loads .env from several candidate locations so the backend works whether it's run from the
// repo root, from inside backend/, or deployed standalone. On Render the real values come from
// the dashboard (process.env); dotenv only fills what isn't already set.


const path = require('path');
const dotenv = require('dotenv');
[
  path.join(__dirname, '../../.env'), // repo root (frontend + backend siblings)
  path.join(__dirname, '../.env'),    // backend/.env (self-contained backend)
  path.join(process.cwd(), '.env'),   // wherever the process was started
].forEach((p) => dotenv.config({ path: p }));

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_fixerr_key';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'mock_fixerr_razorpay_secret';

// A gateway is considered "live" when real (non-placeholder) credentials are supplied
// via environment variables. The literal string "mock" in any default key marks it as a
// simulated/demo credential, in which case the app falls back to the simulated payment flow.
const isMock = (v) => !v || /mock/i.test(String(v));
const STRIPE_LIVE = !isMock(STRIPE_SECRET_KEY) && !isMock(STRIPE_PUBLISHABLE_KEY);
const RAZORPAY_LIVE = !isMock(RAZORPAY_KEY_ID) && !isMock(RAZORPAY_KEY_SECRET);

module.exports = {
  PORT: process.env.PORT || 3001,
  // Frontend base URL used for password reset links and marketing emails. Set this once per
  // environment: local => http://localhost:3001, production => https://your-domain.com
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3001',
  // DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, ENCRYPTION_KEY and the Stripe keys are all real
  // secrets — they must come from .env (or the Render dashboard) only. No hardcoded fallback
  // values here; see backend/.env.example for what needs to be set.
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  // Zoho SMTP fallback (used when Resend is unavailable or fails). ZOHO_PASSWORD should be a
  // Zoho *app-specific* password. Emails via this path are sent FROM the Zoho mailbox address.
  ZOHO_EMAIL: process.env.ZOHO_EMAIL,
  ZOHO_PASSWORD: process.env.ZOHO_PASSWORD,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  STRIPE_LIVE,
  RAZORPAY_LIVE
};
