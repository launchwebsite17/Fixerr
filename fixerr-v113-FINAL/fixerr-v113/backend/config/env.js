// config/env.js - Centralized Environment Configuration
// Loads .env from several candidate locations so the backend works whether it's run from the
// repo root, from inside backend/, or deployed standalone. On hosts like Render/Vercel the real
// values come from the dashboard (process.env); dotenv only fills what isn't already set.


const path = require('path');
const dotenv = require('dotenv');
[
  path.join(__dirname, '../../.env'), // repo root (frontend + backend siblings)
  path.join(__dirname, '../.env'),    // backend/.env (self-contained backend)
  path.join(process.cwd(), '.env'),   // wherever the process was started
].forEach((p) => dotenv.config({ path: p }));

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock_fixerr_stripe_key';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_mock_fixerr_stripe_key';
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
  // Frontend base URL used for password reset links and marketing emails. Set this once per environment:
  // local => http://localhost:3000, production => https://your-domain.com
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3000',
  // Production database is the Render Postgres (documented in FixErr_DB Details). DATABASE_URL
  // should always be set via env (Vercel + local .env); this fallback points at the SAME Render
  // DB so the app can never silently drop to a different/stale database if the env var is missing.
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3001',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://fixerr_db_user:QAAEKYmaIHRaHA45bTVkiNR73ACxqQ0W@dpg-d91kf8jtqb8s73978mn0-a.oregon-postgres.render.com/fixerr_db?sslmode=require',
  JWT_SECRET: process.env.JWT_SECRET || 'fixerr-secret-2024-change-in-production',
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  // Zoho SMTP fallback (used when Resend is unavailable or fails). ZOHO_PASSWORD should be a
  // Zoho *app-specific* password. Emails via this path are sent FROM the Zoho mailbox address.
  ZOHO_EMAIL: process.env.ZOHO_EMAIL,
  ZOHO_PASSWORD: process.env.ZOHO_PASSWORD,
  VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'CwSNbGdlr1JI',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'fixerr-32-byte-secret-key-1234567',
  STRIPE_SECRET_KEY:process.env.STRIPE_SECRET_KEY || 'sk_test_51U4823LlhJkyKxRyOpEl5L10H1o8uelbLxz4TrQBFfmvkGoJridooeqtMxLMo4npCcXXUXmyfKKvCM6o6IIfOwmb00g3qtWZ1Y',
  STRIPE_PUBLISHABLE_KEY:process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51U4823LlhJkyKxRyulM87aCNq2CDRFTjDzKoNOpJQH877kLkfkrv2tnF1iUd8EmQBhfXxJhC6fRBQchVWfHAz9YY00fd0a6cyK',
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  STRIPE_LIVE,
  RAZORPAY_LIVE
};
