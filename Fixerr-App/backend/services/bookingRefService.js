// services/bookingRefService.js — canonical booking reference format & generator
// Format: BKG-{US|IN}-{YYYYMMDD}-{000001}
// Sequence resets daily at 000001, max 999999 per country+date.

const { query } = require('../db');

/** @type {RegExp} BKG-US-20260829-000001 */
const BOOKING_REF_PATTERN = /^BKG-(US|IN)-(\d{8})-(\d{6})$/;

const LEGACY_BOOKING_REF_PATTERN = /^BK-\d{6}-\d{4}$/;

function normalizeBookingCountry(countryCode) {
  return countryCode === 'IN' ? 'IN' : 'US';
}

function getBookingDateStr(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
}

function buildBookingRefPrefix(countryCode, dateStr) {
  const cc = normalizeBookingCountry(countryCode);
  const ds = dateStr || getBookingDateStr();
  return `BKG-${cc}-${ds}-`;
}

function formatBookingRef(countryCode, dateStr, sequence) {
  const prefix = buildBookingRefPrefix(countryCode, dateStr);
  const seq = Math.max(1, Math.min(999999, parseInt(sequence, 10) || 1));
  return prefix + String(seq).padStart(6, '0');
}

function parseBookingRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = ref.trim().match(BOOKING_REF_PATTERN);
  if (!m) return null;
  return {
    country: m[1],
    dateStr: m[2],
    sequence: m[3],
    prefix: `BKG-${m[1]}-${m[2]}-`,
  };
}

function isValidBookingRef(ref) {
  return BOOKING_REF_PATTERN.test(String(ref || '').trim());
}

function isLegacyBookingRef(ref) {
  return LEGACY_BOOKING_REF_PATTERN.test(String(ref || '').trim());
}

/** Fallback invoice label when no invoice_number row exists (reports). */
function fallbackInvoiceLabelFromBookingRef(ref) {
  const parsed = parseBookingRef(ref);
  if (parsed) {
    return `INV-${parsed.country}-${parsed.dateStr}-${parsed.sequence}`;
  }
  if (isLegacyBookingRef(ref)) {
    return 'INV-' + String(ref).replace(/^BK-/, '');
  }
  return 'INV-' + String(ref || 'UNKNOWN').replace(/[^A-Za-z0-9-]/g, '');
}

/**
 * Generate the next booking reference for the given customer country.
 * Looks up max sequence for BKG-{country}-{today}-* in requests.ref.
 */
async function generateBookingRef(countryCode, runQuery = query) {
  const cc = normalizeBookingCountry(countryCode);
  const dateStr = getBookingDateStr();
  const prefix = buildBookingRefPrefix(cc, dateStr);

  const r = await runQuery(
    `SELECT ref FROM requests WHERE ref LIKE $1 ORDER BY ref DESC LIMIT 1`,
    [prefix + '%']
  );

  let nextSeq = 1;
  if (r.rows[0]?.ref) {
    const parsed = parseBookingRef(r.rows[0].ref);
    if (parsed) {
      nextSeq = parseInt(parsed.sequence, 10) + 1;
    } else {
      const seqPart = r.rows[0].ref.slice(-6);
      const legacySeq = parseInt(seqPart, 10);
      if (!isNaN(legacySeq)) nextSeq = legacySeq + 1;
    }
  }

  if (nextSeq > 999999) {
    throw new Error('Daily booking reference limit reached.');
  }

  return formatBookingRef(cc, dateStr, nextSeq);
}

module.exports = {
  BOOKING_REF_PATTERN,
  LEGACY_BOOKING_REF_PATTERN,
  normalizeBookingCountry,
  getBookingDateStr,
  buildBookingRefPrefix,
  formatBookingRef,
  parseBookingRef,
  isValidBookingRef,
  isLegacyBookingRef,
  fallbackInvoiceLabelFromBookingRef,
  generateBookingRef,
};
