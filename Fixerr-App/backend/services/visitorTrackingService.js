// services/visitorTrackingService.js - Website visitor + page view tracking
// Tables: site_visitors / page_views (backend/migrations/003_create_visitor_tracking.sql).
// Raw IP addresses are never stored — only an HMAC hash (see hashIp).
const crypto = require('crypto');
const env = require('../config/env');
const { query } = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCATION_SOURCES = ['gps', 'ip', 'profile', 'manual'];

// Only JS-running clients can reach the tracking endpoint, so this mainly catches headless
// browsers, monitoring tools and scripted HTTP clients.
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|curl|wget|python-requests|python-urllib|axios|node-fetch|go-http-client|okhttp|java\/|postman|insomnia/i;

// ── Tables-ready guard ────────────────────────────────────────────────────
// The migration is applied manually, so the app may be deployed before the tables exist.
// Re-check at most every 5 minutes instead of failing (and logging) on every page view.
let tablesReady = null;
let tablesCheckedAt = 0;
async function trackingTablesReady() {
  if (tablesReady === true) return true;
  if (tablesReady === false && Date.now() - tablesCheckedAt < 5 * 60 * 1000) return false;
  tablesCheckedAt = Date.now();
  try {
    const r = await query(
      "SELECT to_regclass('public.site_visitors') AS v, to_regclass('public.page_views') AS p"
    );
    tablesReady = !!(r.rows[0] && r.rows[0].v && r.rows[0].p);
  } catch (e) {
    tablesReady = false;
  }
  if (!tablesReady) {
    console.warn('⚠️  Visitor tracking paused: run backend/migrations/003_create_visitor_tracking.sql');
  }
  return tablesReady;
}

// ── IP hashing ────────────────────────────────────────────────────────────
let warnedNoSalt = false;
function hashIp(ip) {
  const clean = String(ip || '').replace(/^::ffff:/, '').trim();
  if (!clean) return null;
  let key = env.VISITOR_IP_SALT;
  if (!key) {
    if (!env.JWT_SECRET) return null;
    if (!warnedNoSalt) {
      console.warn('⚠️  VISITOR_IP_SALT is not set; hashing visitor IPs with a JWT_SECRET-derived key.');
      warnedNoSalt = true;
    }
    key = 'visitor-ip:' + env.JWT_SECRET;
  }
  return crypto.createHmac('sha256', key).update(clean).digest('hex');
}

// ── User agent parsing (no external dependency) ──────────────────────────
function parseUserAgent(ua) {
  const s = String(ua || '');
  const deviceType = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(s)
    ? 'tablet'
    : /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(s) ? 'mobile' : 'desktop';

  let browser = 'Other';
  if (/Edg\//.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/.test(s)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(s)) browser = 'Firefox';
  else if (/CriOS|Chrome/.test(s)) browser = 'Chrome';
  else if (/Safari/.test(s)) browser = 'Safari';

  let os = 'Other';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  return { deviceType, browser, os, isBot: !s || BOT_RE.test(s) };
}

// ── Payload normalization ────────────────────────────────────────────────
function cleanText(v, max = 100) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

// Coordinates are rounded to 2 decimals (~1 km) before storage.
function cleanCoord(v, limit) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return Math.round(n * 100) / 100;
}

function cleanPath(v) {
  const s = cleanText(v, 300);
  if (!s || s[0] !== '/') return '/index.html';
  const path = s.split(/[?#]/)[0];
  return !path || path === '/' ? '/index.html' : path;
}

// Keep only origin + path so query strings (tokens, emails) never land in the table.
function cleanReferrer(v) {
  const s = cleanText(v, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return (u.origin + u.pathname).slice(0, 500);
  } catch (e) {
    return null;
  }
}

function cleanLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  const source = LOCATION_SOURCES.includes(loc.source) ? loc.source : null;
  if (!source) return null;
  const country = cleanText(loc.country, 2);
  const out = {
    source,
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    state: cleanText(loc.state),
    city: cleanText(loc.city),
    locality: cleanText(loc.locality),
    postalCode: cleanText(loc.postal_code, 20),
    lat: cleanCoord(loc.lat, 90),
    lng: cleanCoord(loc.lng, 180),
  };
  if (!out.country && !out.city && out.lat === null) return null;
  return out;
}

async function profileLocation(userId) {
  try {
    const r = await query('SELECT city, state, country, zip, lat, lng FROM users WHERE id=$1', [userId]);
    const u = r.rows[0];
    if (!u) return null;
    return cleanLocation({
      source: 'profile',
      country: u.country,
      state: u.state,
      city: u.city,
      postal_code: u.zip,
      lat: u.lat,
      lng: u.lng,
    });
  } catch (e) {
    return null;
  }
}

// ── Page view recording ──────────────────────────────────────────────────
const locRank = (col) =>
  `(CASE ${col} WHEN 'gps' THEN 4 WHEN 'profile' THEN 3 WHEN 'ip' THEN 2 WHEN 'manual' THEN 1 ELSE 0 END)`;
// Never let a weaker location source (e.g. a manual city pick) overwrite a stronger one (GPS).
const LOC_BETTER = `(EXCLUDED.location_source IS NOT NULL AND ${locRank('EXCLUDED.location_source')} >= ${locRank('site_visitors.location_source')})`;
const locSet = (col) => `${col} = CASE WHEN ${LOC_BETTER} THEN EXCLUDED.${col} ELSE site_visitors.${col} END`;

const UPSERT_VISITOR_SQL = `
  INSERT INTO site_visitors (
    visitor_uid, user_id, user_role, linked_at,
    first_landing_page, first_referrer, utm_source, utm_medium, utm_campaign,
    country, state, city, locality, postal_code, lat, lng, location_source,
    device_type, browser, os, is_bot, total_page_views
  ) VALUES (
    $1, $2, $3, CASE WHEN $2::INTEGER IS NULL THEN NULL ELSE now() END,
    $4, $5, $6, $7, $8,
    $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20, 1
  )
  ON CONFLICT (visitor_uid) DO UPDATE SET
    last_seen_at = now(),
    updated_at = now(),
    total_page_views = site_visitors.total_page_views + 1,
    linked_at = CASE
      WHEN EXCLUDED.user_id IS NOT NULL AND site_visitors.user_id IS DISTINCT FROM EXCLUDED.user_id THEN now()
      ELSE site_visitors.linked_at END,
    user_id = COALESCE(EXCLUDED.user_id, site_visitors.user_id),
    user_role = CASE WHEN EXCLUDED.user_id IS NOT NULL THEN EXCLUDED.user_role ELSE site_visitors.user_role END,
    utm_source = COALESCE(site_visitors.utm_source, EXCLUDED.utm_source),
    utm_medium = COALESCE(site_visitors.utm_medium, EXCLUDED.utm_medium),
    utm_campaign = COALESCE(site_visitors.utm_campaign, EXCLUDED.utm_campaign),
    ${locSet('country')},
    ${locSet('state')},
    ${locSet('city')},
    ${locSet('locality')},
    ${locSet('postal_code')},
    ${locSet('lat')},
    ${locSet('lng')},
    ${locSet('location_source')},
    device_type = EXCLUDED.device_type,
    browser = EXCLUDED.browser,
    os = EXCLUDED.os,
    is_bot = site_visitors.is_bot OR EXCLUDED.is_bot
  RETURNING id, (linked_at = now()) AS just_linked`;

const INSERT_VIEW_SQL = `
  INSERT INTO page_views (
    visitor_id, user_id, session_uid, page_path, referrer,
    utm_source, utm_medium, utm_campaign,
    country, state, city, locality, postal_code, lat, lng, location_source,
    ip_hash, user_agent
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`;

// Returns { ok: true } or { ok: false, status, error }.
async function recordPageView({ body, user, ip, userAgent }) {
  const b = body && typeof body === 'object' ? body : {};
  const visitorUid = cleanText(b.visitor_uid, 36);
  const sessionUid = cleanText(b.session_uid, 36);
  if (!visitorUid || !UUID_RE.test(visitorUid) || !sessionUid || !UUID_RE.test(sessionUid)) {
    return { ok: false, status: 400, error: 'Invalid visitor or session id.' };
  }
  if (!(await trackingTablesReady())) return { ok: true, skipped: true };

  const userId = user && Number.isInteger(Number(user.id)) ? Number(user.id) : null;
  const userRole = userId ? cleanText(user.role, 20) : null;
  const pagePath = cleanPath(b.page_path);
  const referrer = cleanReferrer(b.referrer);
  const utm = b.utm && typeof b.utm === 'object' ? b.utm : {};
  const utmSource = cleanText(utm.source);
  const utmMedium = cleanText(utm.medium);
  const utmCampaign = cleanText(utm.campaign);
  const ua = parseUserAgent(userAgent);
  const loc = cleanLocation(b.location) || (userId ? await profileLocation(userId) : null) || {};

  const visitor = await query(UPSERT_VISITOR_SQL, [
    visitorUid, userId, userRole,
    pagePath, referrer, utmSource, utmMedium, utmCampaign,
    loc.country || null, loc.state || null, loc.city || null, loc.locality || null,
    loc.postalCode || null, loc.lat ?? null, loc.lng ?? null, loc.source || null,
    ua.deviceType, ua.browser, ua.os, ua.isBot,
  ]);
  const row = visitor.rows[0];

  await query(INSERT_VIEW_SQL, [
    row.id, userId, sessionUid, pagePath, referrer,
    utmSource, utmMedium, utmCampaign,
    loc.country || null, loc.state || null, loc.city || null, loc.locality || null,
    loc.postalCode || null, loc.lat ?? null, loc.lng ?? null, loc.source || null,
    hashIp(ip), String(userAgent || '').slice(0, 400) || null,
  ]);

  if (userId && row.just_linked) {
    await query('UPDATE page_views SET user_id=$1 WHERE visitor_id=$2 AND user_id IS NULL', [userId, row.id]);
  }
  return { ok: true };
}

// ── Link anonymous visitor history to a user (signup / login) ────────────
async function linkVisitorToUser(visitorUid, userId, role) {
  const uid = cleanText(visitorUid, 36);
  if (!uid || !UUID_RE.test(uid) || !userId) return false;
  if (!(await trackingTablesReady())) return false;
  const r = await query(
    `UPDATE site_visitors
        SET user_id=$2, user_role=$3, linked_at=now(), updated_at=now()
      WHERE visitor_uid=$1 AND user_id IS DISTINCT FROM $2
      RETURNING id`,
    [uid, userId, cleanText(role, 20)]
  );
  if (!r.rows[0]) return false;
  await query('UPDATE page_views SET user_id=$1 WHERE visitor_id=$2 AND user_id IS NULL', [userId, r.rows[0].id]);
  return true;
}

module.exports = {
  recordPageView,
  linkVisitorToUser,
  hashIp,
  parseUserAgent,
  cleanLocation,
  trackingTablesReady,
};
