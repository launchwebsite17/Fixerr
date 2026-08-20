// services/paymentService.js - Payment Gateway Integration (Razorpay for India, Stripe for USA)
//
// The gateway runs in one of two modes:
//   • "live" — real Razorpay Orders / Stripe Checkout Sessions are created and verified
//              server-side. Activated automatically when real (non-"mock") API keys are
//              supplied via environment variables (see config/env.js).
//   • "mock" — the previous simulated flow, used for local/demo when only placeholder keys
//              are present. Payments are accepted without contacting an external gateway.
//
// This keeps the demo working out-of-the-box while making the platform production-ready:
// setting real STRIPE_* / RAZORPAY_* env vars flips the relevant gateway to live with no
// further code changes.

const https = require('https');
const crypto = require('crypto');
const env = require('../config/env');
const { query } = require('../db');
const { calculateTax } = require('./taxService');
const { getOrCreateInvoice } = require('./invoiceService');

// ── Low-level HTTPS helper ──────────────────────────────────────────────
function httpsRequest(options, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (e) { /* non-JSON body */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Payment gateway request timed out')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function genRef(prefix) {
  return prefix + '-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 9000 + 1000);
}

// ── Razorpay (India) ────────────────────────────────────────────────────
async function createRazorpayOrder(amount, receipt) {
  const body = JSON.stringify({
    amount: Math.round(amount * 100), // paise
    currency: 'INR',
    receipt: String(receipt).slice(0, 40),
    notes: { bookingRef: String(receipt) }
  });
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const { status, json, raw } = await httpsRequest({
    hostname: 'api.razorpay.com', path: '/v1/orders', method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (status >= 200 && status < 300 && json && json.id) return json;
  throw new Error(`Razorpay order creation failed (${status}): ${raw}`);
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch (e) {
    return false; // length mismatch → invalid
  }
}

// ── Stripe (USA) ────────────────────────────────────────────────────────
async function createStripeSession(amount, currency, bookingRef, origin, serviceName) {
  const base = (origin || '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${base}/dashboard.html?pay=success&ref=${encodeURIComponent(bookingRef)}&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${base}/dashboard.html?pay=cancel&ref=${encodeURIComponent(bookingRef)}`);
  params.append('client_reference_id', bookingRef);
  params.append('metadata[bookingRef]', bookingRef);
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', String(currency).toLowerCase());
  params.append('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)));
  params.append('line_items[0][price_data][product_data][name]', serviceName || `Fixerr Service ${bookingRef}`);
  const body = params.toString();
  const { status, json, raw } = await httpsRequest({
    hostname: 'api.stripe.com', path: '/v1/checkout/sessions', method: 'POST',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (status >= 200 && status < 300 && json && json.id) return json;
  throw new Error(`Stripe session creation failed (${status}): ${raw}`);
}

async function retrieveStripeSession(sessionId) {
  const { status, json } = await httpsRequest({
    hostname: 'api.stripe.com', path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, method: 'GET',
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (status >= 200 && status < 300 && json) return json;
  throw new Error(`Stripe session retrieval failed (${status})`);
}

// ── Public API ──────────────────────────────────────────────────────────

// Config the frontend uses to decide whether to run a real gateway or the simulated flow.
function getPaymentConfig() {
  return {
    razorpay: { mode: env.RAZORPAY_LIVE ? 'live' : 'mock', keyId: env.RAZORPAY_LIVE ? env.RAZORPAY_KEY_ID : null },
    stripe:   { mode: env.STRIPE_LIVE ? 'live' : 'mock', publishableKey: env.STRIPE_LIVE ? env.STRIPE_PUBLISHABLE_KEY : null }
  };
}

async function createPaymentOrder(bookingRef, paymentMethod, currency, origin) {
  const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
  if (bkRes.rows.length === 0) throw new Error('Booking not found');
  const bk = bkRes.rows[0];

  const isIndia = currency === 'INR' || bk.country === 'IN';
  const cur = isIndia ? 'INR' : 'USD';

  // Charge the full amount the invoice reports as paid: the agreed booking price
  // (confirmed → proposed → estimate) plus applicable tax. Kept in sync with invoiceService.
  const subtotal = parseFloat(bk.confirmed_price || bk.proposed_price || bk.estimate || 0);
  const taxInfo = await calculateTax(subtotal, bk.state, bk.country);
  const taxAmount = parseFloat(taxInfo.taxAmount || 0);
  const amount = parseFloat((subtotal + taxAmount).toFixed(2));

  const serviceName = `Fixerr — ${(bk.service_key || 'Home Service')}${bk.sub_service ? ' (' + bk.sub_service + ')' : ''} [${bookingRef}]`;
  const gateway = isIndia ? 'razorpay' : 'stripe';
  const live = isIndia ? env.RAZORPAY_LIVE : env.STRIPE_LIVE;
  const mode = live ? 'live' : 'mock';

  let out = { success: true, gateway, mode, amount, subtotal, taxAmount, currency: cur, bookingRef };
  let orderId, gatewayLabel;

  if (isIndia && live) {
    const order = await createRazorpayOrder(amount, bookingRef);
    orderId = order.id;
    gatewayLabel = paymentMethod === 'upi' ? 'Razorpay-UPI' : 'Razorpay-Card';
    out.orderId = order.id;
    out.key = env.RAZORPAY_KEY_ID;
    out.name = 'Fixerr';
    out.description = serviceName;
  } else if (!isIndia && live) {
    const session = await createStripeSession(amount, cur, bookingRef, origin, serviceName);
    orderId = session.id;
    gatewayLabel = 'Stripe-Checkout';
    out.orderId = session.id;
    out.checkoutUrl = session.url;
    out.publishableKey = env.STRIPE_PUBLISHABLE_KEY;
  } else {
    // Simulated fallback (mock keys)
    orderId = genRef('ORD');
    gatewayLabel = isIndia ? (paymentMethod === 'upi' ? 'Razorpay-UPI (mock)' : 'Razorpay-Card (mock)') : 'Stripe-Card (mock)';
    out.orderId = orderId;
    out.key = isIndia ? env.RAZORPAY_KEY_ID : env.STRIPE_PUBLISHABLE_KEY;
  }

  // Persist a pending payment record so verify() can look up mode/gateway.
  await query(
    `INSERT INTO payments (payment_id, booking_ref, gateway, amount, currency, status, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, now())
     ON CONFLICT (payment_id) DO NOTHING`,
    [orderId, bookingRef, gatewayLabel, amount, cur,
      JSON.stringify({ bookingRef, paymentMethod: paymentMethod || 'card', mode, gateway, subtotal, taxAmount, customerName: bk.customer_name })]
  );

  return out;
}

async function verifyPayment(payload = {}) {
  const { bookingRef, orderId, paymentId, signature, sessionId } = payload;
  if (!bookingRef) throw new Error('bookingRef is required');

  // Find the most recent payment record for this booking (created by createPaymentOrder).
  const payRes = await query(
    'SELECT * FROM payments WHERE booking_ref=$1 ORDER BY created_at DESC LIMIT 1', [bookingRef]
  );
  const payRow = payRes.rows[0];
  const meta = payRow ? (typeof payRow.payload === 'string' ? JSON.parse(payRow.payload) : (payRow.payload || {})) : {};
  const mode = meta.mode || 'mock';
  const gateway = meta.gateway || (payRow && /razorpay/i.test(payRow.gateway) ? 'razorpay' : 'stripe');

  let txnId = paymentId || sessionId || ('TXN-MANUAL-' + Date.now());

  // ── Real gateway verification ──
  if (mode === 'live' && gateway === 'razorpay') {
    const rzpOrderId = orderId || (payRow && payRow.payment_id);
    if (!verifyRazorpaySignature(rzpOrderId, paymentId, signature)) {
      throw new Error('Razorpay signature verification failed — payment not confirmed.');
    }
    txnId = paymentId;
  } else if (mode === 'live' && gateway === 'stripe') {
    const sid = sessionId || orderId || (payRow && payRow.payment_id);
    const session = await retrieveStripeSession(sid);
    if (!session || session.payment_status !== 'paid') {
      throw new Error('Stripe payment not completed — invoice not generated.');
    }
    txnId = session.payment_intent || session.id;
  }
  // mode === 'mock' → accept without external verification (demo/local)

  // ── Mark payment completed ──
  if (payRow) {
    await query(
      `UPDATE payments SET status='completed', payload=jsonb_set(COALESCE(payload,'{}'::jsonb), '{paymentId}', $1::jsonb) WHERE id=$2`,
      [JSON.stringify(txnId), payRow.id]
    );
  } else {
    // No pre-created order (e.g. legacy call) — record it now.
    const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
    const bk = bkRes.rows[0] || {};
    await query(
      `INSERT INTO payments (payment_id, booking_ref, gateway, amount, currency, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, now()) ON CONFLICT (payment_id) DO NOTHING`,
      [genRef('ORD-MANUAL'), bookingRef, 'Manual Payment', parseFloat(bk.confirmed_price || bk.estimate || 0),
        bk.currency || 'USD', JSON.stringify({ bookingRef, mode, paymentId: txnId })]
    );
  }

  // ── Confirm booking & mark as paid online (canonical marker used by the UI) ──
  await query(
    `UPDATE requests SET status='confirmed', payment_method='online_paid', updated=now() WHERE ref=$1`,
    [bookingRef]
  );

  // ── Generate invoice & email customer automatically ──
  let invoice = null;
  try {
    invoice = await getOrCreateInvoice(bookingRef);
  } catch (err) {
    console.error('Invoice creation error post-payment:', err.message);
  }

  return {
    success: true,
    message: 'Payment confirmed and invoice generated successfully!',
    bookingRef,
    transactionId: txnId,
    invoiceNumber: invoice ? invoice.invoice_number : null,
    downloadUrl: `/api/invoices/${bookingRef}/download`
  };
}

module.exports = { createPaymentOrder, verifyPayment, getPaymentConfig };
