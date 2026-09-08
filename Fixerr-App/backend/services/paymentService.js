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
const { getInvoiceIfExists } = require('./invoiceService');

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
const Razorpay = require('razorpay');

let razorpayClient;
function getRazorpayClient() {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET
    });
  }
  return razorpayClient;
}

async function createRazorpayOrder(amount, receipt) {
  const amountPaise = Math.round(parseFloat(amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    throw new Error('Minimum payment amount is 100 paise (₹1).');
  }
  try {
    const order = await getRazorpayClient().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: String(receipt).slice(0, 40),
      notes: { bookingRef: String(receipt) }
    });
    if (!order || !order.id) throw new Error('Razorpay did not return an order id.');
    return order;
  } catch (err) {
    const status = err.statusCode || err.status;
    if (status === 401 || status === 403) {
      throw new Error('Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    }
    throw new Error(err.error?.description || err.message || 'Razorpay order creation failed.');
  }
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

function formatRazorpayContact(phone, country) {
  if (!phone) return '';
  const raw = String(phone).trim();
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (country === 'IN') {
    if (digits.length === 10) return '+91' + digits;
    if (digits.startsWith('91') && digits.length >= 12) return '+' + digits;
    return '+91' + digits;
  }
  if (digits.length === 10) return '+1' + digits;
  return '+' + digits;
}

function buildRazorpayPrefill(booking) {
  const country = booking.country === 'IN' ? 'IN' : 'US';
  return {
    name: booking.customer_name || '',
    email: booking.customer_email || '',
    contact: formatRazorpayContact(booking.customer_phone, country)
  };
}

function resolveBillingAddressFields(billingAddress, booking) {
  const src = billingAddress || {};
  const bk = booking || {};
  const country = src.country || bk.country || null;
  return {
    line1: src.line1 || bk.address || null,
    line2: src.line2 || null,
    city: src.city || bk.city || null,
    state: src.state || bk.state || null,
    zip: src.zip || bk.zip || null,
    country: country === 'IN' ? 'IN' : (country === 'US' ? 'US' : country)
  };
}

async function fetchRazorpayPayment(paymentId) {
  if (!paymentId) throw new Error('paymentId is required to fetch Razorpay payment.');
  return getRazorpayClient().payments.fetch(paymentId);
}

async function findLatestPendingRazorpayPayment(bookingRef, orderId) {
  if (orderId) {
    const byOrder = await query(
      `SELECT * FROM payments
       WHERE booking_ref=$1 AND payment_id=$2 AND status='pending'
       ORDER BY created_at DESC LIMIT 1`,
      [bookingRef, orderId]
    );
    if (byOrder.rows[0]) return byOrder.rows[0];
  }
  const res = await query(
    `SELECT * FROM payments
     WHERE booking_ref=$1 AND gateway ILIKE 'razorpay%' AND status='pending'
     ORDER BY created_at DESC LIMIT 1`,
    [bookingRef]
  );
  return res.rows[0] || null;
}

async function recordRazorpayFailure(payload = {}) {
  const { bookingRef, orderId, errorCode, errorDescription } = payload;
  if (!bookingRef) throw new Error('bookingRef is required');

  const payRow = await findLatestPendingRazorpayPayment(bookingRef, orderId);
  if (!payRow) {
    throw new Error('No pending Razorpay payment record found for this booking.');
  }

  await query(
    `UPDATE payments SET
       status='failed',
       gateway_error_code=$1,
       gateway_error_message=$2,
       gateway_response_at=now(),
       razorpay_order_id=COALESCE($3, razorpay_order_id)
     WHERE id=$4`,
    [errorCode || null, errorDescription || null, orderId || payRow.payment_id, payRow.id]
  );

  return { success: true, message: 'Razorpay payment failure recorded.' };
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
    out.prefill = buildRazorpayPrefill(bk);
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
  const prefill = isIndia ? buildRazorpayPrefill(bk) : null;
  await query(
    `INSERT INTO payments (payment_id, booking_ref, gateway, amount, currency, status, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, now())
     ON CONFLICT (payment_id) DO NOTHING`,
    [orderId, bookingRef, gatewayLabel, amount, cur,
      JSON.stringify({
        bookingRef,
        paymentMethod: paymentMethod || 'card',
        mode,
        gateway,
        subtotal,
        taxAmount,
        customerName: bk.customer_name,
        ...(prefill ? { prefill } : {})
      })]
  );

  return out;
}

async function verifyPayment(payload = {}) {
  const { bookingRef, orderId, paymentId, signature, sessionId, prefill, billingAddress } = payload;
  if (!bookingRef) throw new Error('bookingRef is required');

  const payRow = await findLatestPendingRazorpayPayment(bookingRef, orderId) ||
    (await query('SELECT * FROM payments WHERE booking_ref=$1 ORDER BY created_at DESC LIMIT 1', [bookingRef])).rows[0];
  const meta = payRow ? (typeof payRow.payload === 'string' ? JSON.parse(payRow.payload) : (payRow.payload || {})) : {};
  const mode = meta.mode || 'mock';
  const gateway = meta.gateway || (payRow && /razorpay/i.test(payRow.gateway) ? 'razorpay' : 'stripe');

  let txnId = paymentId || sessionId || ('TXN-MANUAL-' + Date.now());
  const prefillData = prefill || meta.prefill || {};

  // ── Real gateway verification ──
  if (mode === 'live' && gateway === 'razorpay') {
    const rzpOrderId = orderId || (payRow && payRow.payment_id);
    if (!verifyRazorpaySignature(rzpOrderId, paymentId, signature)) {
      throw new Error('Razorpay signature verification failed — payment not confirmed.');
    }
    txnId = paymentId;

    const bkRes = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
    const bookingRow = bkRes.rows[0] || {};
    const billingAddr = resolveBillingAddressFields(billingAddress, bookingRow);

    let rzpPayment = null;
    try {
      rzpPayment = await fetchRazorpayPayment(paymentId);
    } catch (err) {
      console.error('[paymentService] Razorpay fetch payment failed:', err.message);
    }

    const card = rzpPayment?.card || {};
    const billingName = prefillData.name || rzpPayment?.notes?.name || meta.customerName || null;
    const billingContact = prefillData.contact || rzpPayment?.contact || null;
    const billingEmail = prefillData.email || rzpPayment?.email || null;
    const { razorpayCheckout: _rzpDup, paymentId: _pidDup, ...restMeta } = meta;
    const mergedPayload = {
      ...restMeta,
      prefill: {
        name: billingName || prefillData.name || '',
        email: billingEmail || prefillData.email || '',
        contact: billingContact || prefillData.contact || ''
      },
      billingAddress: billingAddr
    };

    if (payRow) {
      await query(
        `UPDATE payments SET
           payment_id=$1,
           status='completed',
           gateway_transaction_id=$2,
           razorpay_order_id=$3,
           razorpay_signature=$4,
           gateway_status=$5,
           payment_method_type=$6,
           card_brand=$7,
           card_last4=$8,
           card_exp_month=$9,
           card_exp_year=$10,
           billing_name=$11,
           billing_contact=$12,
           billing_email=$13,
           billing_address_line1=$14,
           billing_address_line2=$15,
           billing_city=$16,
           billing_state=$17,
           billing_zip=$18,
           billing_country=$19,
           gateway_response=$20,
           gateway_response_at=now(),
           payload=$21
         WHERE id=$22`,
        [
          paymentId,
          paymentId,
          rzpOrderId,
          signature,
          rzpPayment?.status || 'captured',
          rzpPayment?.method || null,
          card.issuer || card.network || null,
          card.last4 || null,
          card.exp_month || null,
          card.exp_year || null,
          billingName,
          billingContact,
          billingEmail,
          billingAddr.line1,
          billingAddr.line2,
          billingAddr.city,
          billingAddr.state,
          billingAddr.zip,
          billingAddr.country,
          rzpPayment ? JSON.stringify(rzpPayment) : null,
          JSON.stringify(mergedPayload),
          payRow.id
        ]
      );
    }
  } else if (mode === 'live' && gateway === 'stripe') {
    const sid = sessionId || orderId || (payRow && payRow.payment_id);
    const session = await retrieveStripeSession(sid);
    if (!session || session.payment_status !== 'paid') {
      throw new Error('Stripe payment not completed — invoice not generated.');
    }
    txnId = session.payment_intent || session.id;
  }
  // mode === 'mock' → accept without external verification (demo/local)

  // ── Mark payment completed (Stripe / mock paths only — Razorpay handled above) ──
  if (!(mode === 'live' && gateway === 'razorpay' && payRow)) {
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
  }

  // ── Confirm booking & mark as paid online (canonical marker used by the UI) ──
  const bkStatusRes = await query('SELECT status, customer_name, customer_email FROM requests WHERE ref=$1', [bookingRef]);
  const bkRow = bkStatusRes.rows[0] || {};
  if (bkRow.status === 'completed') {
    await query(
      `UPDATE requests SET payment_method='online_paid', updated_at=now() WHERE ref=$1`,
      [bookingRef]
    );
  } else {
    await query(
      `UPDATE requests SET status='confirmed', payment_method='online_paid', updated_at=now() WHERE ref=$1`,
      [bookingRef]
    );
  }

  // ── Update the invoice's payment status/method, if one already exists ──
  // Invoices are only created when the professional marks the job "Completed" (proController.js)
  // — a payment can arrive before or after that point, so this only updates an existing invoice
  // rather than creating one here.
  let invoice = null;
  try {
    invoice = await getInvoiceIfExists(bookingRef);
    if (invoice) {
      const updated = await query(
        `UPDATE invoices SET payment_method='online_paid', payment_status='paid' WHERE booking_ref=$1 RETURNING *`,
        [bookingRef]
      );
      invoice = updated.rows[0] || invoice;
      // Record which invoice this payment paid, on the payment row(s) just marked completed.
      await query(
        `UPDATE payments SET invoice_number=$1 WHERE booking_ref=$2 AND status='completed'`,
        [invoice.invoice_number, bookingRef]
      );
    }
  } catch (err) {
    console.error('Invoice payment-status update error:', err.message);
  }

  return {
    success: true,
    message: invoice ? 'Payment confirmed and invoice updated successfully!' : 'Payment confirmed — invoice will be available once the job is marked completed.',
    bookingRef,
    transactionId: txnId,
    invoiceNumber: invoice ? invoice.invoice_number : null,
    downloadUrl: `/api/invoices/${bookingRef}/download`
  };
}

module.exports = {
  createPaymentOrder,
  verifyPayment,
  getPaymentConfig,
  createRazorpayOrder,
  verifyRazorpaySignature,
  fetchRazorpayPayment,
  recordRazorpayFailure,
  buildRazorpayPrefill,
  formatRazorpayContact
};
