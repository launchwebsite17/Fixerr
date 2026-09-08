// services/paymentGatewayService.js
// Stripe Payment Element + Address Element (billing mode) for dashboard "Make Payment".
// PaymentIntent uses a fixed currency (US → USD, IN → INR) — no Adaptive Pricing currency picker.
// Legacy embedded Checkout Session handlers remain for in-flight cs_ payments and webhooks.
const Stripe = require('stripe');
const env = require('../config/env');
const { query } = require('../db');

const stripe = Stripe(env.STRIPE_SECRET_KEY);
const GATEWAY_LABEL = 'Stripe-Elements';

/** US checkout: card, Link, bank debit, Cash App, Amazon Pay (+ Apple/Google Pay via Element wallets). */
const US_PAYMENT_METHOD_TYPES = ['card', 'link', 'us_bank_account', 'cashapp', 'amazon_pay'];

function paymentMethodTypesForBooking(country, currency) {
  const curr = String(currency || '').toLowerCase();
  if (country === 'IN' || curr === 'inr') return ['card', 'link'];
  return US_PAYMENT_METHOD_TYPES;
}

function resolvePayCurrency(country, currency) {
  if (country === 'IN') return 'INR';
  if (country === 'US') return 'USD';
  const c = String(currency || 'USD').toUpperCase();
  return c === 'INR' ? 'INR' : 'USD';
}

function extractBillingFromSession(session) {
  const cd = session.customer_details || {};
  const addr = cd.address || {};
  return {
    name: cd.name || null,
    email: cd.email || null,
    phone: cd.phone || null,
    line1: addr.line1 || null,
    line2: addr.line2 || null,
    city: addr.city || null,
    state: addr.state || null,
    postal_code: addr.postal_code || null,
    country: addr.country || null
  };
}

async function saveBillingOnPayment(sessionId, session) {
  const billing = extractBillingFromSession(session);
  await query(
    `UPDATE payments SET
       billing_name = COALESCE($1, billing_name),
       billing_email = COALESCE($2, billing_email),
       billing_contact = COALESCE($3, billing_contact),
       billing_address_line1 = COALESCE($4, billing_address_line1),
       billing_address_line2 = COALESCE($5, billing_address_line2),
       billing_city = COALESCE($6, billing_city),
       billing_state = COALESCE($7, billing_state),
       billing_zip = COALESCE($8, billing_zip),
       billing_country = COALESCE($9, billing_country)
     WHERE payment_id = $10`,
    [
      billing.name, billing.email, billing.phone, billing.line1, billing.line2, billing.city,
      billing.state, billing.postal_code, billing.country, sessionId
    ]
  );
}

async function cancelStaleCheckoutSessions(bookingRef) {
  const res = await query(
    `SELECT payment_id FROM payments WHERE booking_ref=$1 AND status='pending' AND payment_id LIKE 'cs_%'`,
    [bookingRef]
  );
  for (const row of res.rows) {
    try {
      await stripe.checkout.sessions.expire(row.payment_id);
    } catch (_) { /* already expired or completed */ }
    await query(`UPDATE payments SET status='cancelled' WHERE payment_id=$1`, [row.payment_id]);
  }
}

/**
 * Create a PaymentIntent with a fixed currency (no Adaptive Pricing / currency picker).
 * Uses Stripe Payment Element + Address Element (billing mode) on the client.
 */
async function createPaymentIntent({ bookingRef, amount, currency, country, customerName, customerEmail }) {
  await cancelStaleCheckoutSessions(bookingRef);

  const bookingCountry = country === 'IN' ? 'IN' : 'US';
  const curr = resolvePayCurrency(bookingCountry, currency).toLowerCase();
  const amountInCents = Math.round(parseFloat(amount) * 100);
  const paymentMethodTypes = paymentMethodTypesForBooking(bookingCountry, curr);

  const intentParams = {
    amount: amountInCents,
    currency: curr,
    payment_method_types: paymentMethodTypes,
    receipt_email: customerEmail || undefined,
    metadata: { bookingRef, customerName: customerName || '', country: bookingCountry }
  };

  if (paymentMethodTypes.includes('us_bank_account')) {
    intentParams.payment_method_options = {
      us_bank_account: { verification_method: 'automatic' }
    };
  }

  const paymentIntent = await stripe.paymentIntents.create(intentParams);

  await query(
    `INSERT INTO payments
       (payment_id, booking_ref, gateway, amount, currency, status, payload, gateway_transaction_id, gateway_status)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
     ON CONFLICT (payment_id) DO NOTHING`,
    [
      paymentIntent.id, bookingRef, GATEWAY_LABEL, amount, curr.toUpperCase(),
      JSON.stringify({ bookingRef, customerName, customerEmail, country: bookingCountry }),
      paymentIntent.id, paymentIntent.status
    ]
  );

  return {
    clientSecret: paymentIntent.client_secret,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
    paymentIntentId: paymentIntent.id,
    amount,
    currency: curr.toUpperCase(),
    paymentMethodTypes
  };
}

/** Legacy embedded Checkout Session — kept for in-flight sessions / webhooks only. */
async function createCheckoutSession(opts) {
  return createPaymentIntent(opts);
}

async function createCheckoutSessionEmbedded(opts) {
  const { bookingRef, amount, currency, country, customerName, customerEmail, returnUrlBase } = opts;
  const amountInCents = Math.round(parseFloat(amount) * 100);
  const bookingCountry = country === 'IN' ? 'IN' : 'US';
  const curr = resolvePayCurrency(bookingCountry, currency).toLowerCase();

  await cancelStaleCheckoutSessions(bookingRef);

  const base = String(returnUrlBase || env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
  const returnUrl = `${base}/payment-return.html?session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(bookingRef)}`;

  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded_page',
    mode: 'payment',
    currency: curr,
    adaptive_pricing: { enabled: false },
    line_items: [{
      price_data: {
        currency: curr,
        product_data: {
          name: 'Fixerr Service',
          description: `Booking ${bookingRef}${customerName ? ` — ${customerName}` : ''}`
        },
        unit_amount: amountInCents
      },
      quantity: 1
    }],
    billing_address_collection: 'required',
    customer_email: customerEmail || undefined,
    metadata: { bookingRef, customerName: customerName || '', country: bookingCountry },
    return_url: returnUrl
  });

  await query(
    `INSERT INTO payments
       (payment_id, booking_ref, gateway, amount, currency, status, payload, gateway_transaction_id, gateway_status)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
     ON CONFLICT (payment_id) DO NOTHING`,
    [
      session.id, bookingRef, 'Stripe-Embedded-Checkout', amount, curr.toUpperCase(),
      JSON.stringify({ bookingRef, customerName, customerEmail, sessionId: session.id, country: bookingCountry }),
      session.id, session.status
    ]
  );

  return {
    clientSecret: session.client_secret,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
    sessionId: session.id,
    amount,
    currency: curr.toUpperCase()
  };
}

/**
 * Optional bookkeeping for legacy Payment Element flow (kept for API compatibility).
 */
async function recordPaymentAttempt({ paymentIntentId, paymentMethodType, billing }) {
  await query(
    `UPDATE payments SET
       payment_method_type = $1,
       billing_name = $2,
       billing_email = $3,
       billing_contact = $4,
       billing_address_line1 = $5,
       billing_address_line2 = $6,
       billing_city = $7,
       billing_state = $8,
       billing_zip = $9,
       billing_country = $10
     WHERE payment_id = $11 OR gateway_transaction_id = $11`,
    [
      paymentMethodType || null,
      billing?.name || null,
      billing?.email || null,
      billing?.phone || null,
      billing?.address?.line1 || null,
      billing?.address?.line2 || null,
      billing?.address?.city || null,
      billing?.address?.state || null,
      billing?.address?.postal_code || null,
      billing?.address?.country || null,
      paymentIntentId
    ]
  );
}

async function recordCheckoutSessionCompleted(session) {
  let fullSession = session;
  if (session.id && !session.customer_details?.address) {
    try {
      fullSession = await stripe.checkout.sessions.retrieve(session.id);
    } catch (_) { /* use webhook payload as-is */ }
  }

  await saveBillingOnPayment(fullSession.id, fullSession);

  const isSuccess = fullSession.payment_status === 'paid';
  let card = {};
  let pmDetails = {};
  let paymentIntentPayload = null;

  if (fullSession.payment_intent) {
    const piId = typeof fullSession.payment_intent === 'string' ? fullSession.payment_intent : fullSession.payment_intent.id;
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
    paymentIntentPayload = pi;
    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    pmDetails = charge?.payment_method_details || {};
    card = pmDetails.card || {};
  }

  await query(
    `UPDATE payments SET
       status = $1,
       gateway_status = $2,
       gateway_response = $3,
       gateway_response_at = now(),
       card_brand = COALESCE($4, card_brand),
       card_last4 = COALESCE($5, card_last4),
       card_exp_month = COALESCE($6, card_exp_month),
       card_exp_year = COALESCE($7, card_exp_year),
       payment_method_type = COALESCE($8, payment_method_type)
     WHERE payment_id = $9`,
    [
      isSuccess ? 'completed' : 'failed',
      fullSession.status,
      JSON.stringify({ session: fullSession, paymentIntent: paymentIntentPayload }),
      card.brand || null,
      card.last4 || null,
      card.exp_month || null,
      card.exp_year || null,
      pmDetails.type || null,
      fullSession.id
    ]
  );

  const bookingRef = fullSession.metadata?.bookingRef;
  if (isSuccess && bookingRef) {
    await query(`UPDATE requests SET payment_method='online_paid', updated_at=now() WHERE ref=$1`, [bookingRef]);
    const payRow = await query('SELECT amount, currency FROM payments WHERE payment_id=$1', [fullSession.id]);
    return {
      isSuccess: true,
      bookingRef,
      amount: payRow.rows[0]?.amount,
      currency: payRow.rows[0]?.currency,
      cardBrand: card.brand || null,
      cardLast4: card.last4 || null
    };
  }
  return { isSuccess: false, bookingRef };
}

/**
 * Final outcome from PaymentIntent webhooks (fallback when session webhook is not configured).
 */
async function recordPaymentOutcome(paymentIntent) {
  const charge = paymentIntent.latest_charge && typeof paymentIntent.latest_charge === 'object'
    ? paymentIntent.latest_charge
    : null;
  const pmDetails = charge?.payment_method_details || {};
  const card = pmDetails.card || {};
  const isSuccess = paymentIntent.status === 'succeeded';
  const lastError = paymentIntent.last_payment_error || null;
  const bookingRef = paymentIntent.metadata?.bookingRef;
  const billDetails = charge?.billing_details || {};

  const result = await query(
    `UPDATE payments SET
       status = $1,
       gateway_status = $2,
       gateway_response = $3,
       gateway_response_at = now(),
       card_brand = COALESCE($4, card_brand),
       card_last4 = COALESCE($5, card_last4),
       card_exp_month = COALESCE($6, card_exp_month),
       card_exp_year = COALESCE($7, card_exp_year),
       payment_method_type = COALESCE($8, payment_method_type),
       gateway_error_code = $9,
       gateway_error_message = $10,
       billing_email = COALESCE($11, billing_email),
       billing_contact = COALESCE($12, billing_contact)
     WHERE payment_id = $13`,
    [
      isSuccess ? 'completed' : 'failed',
      paymentIntent.status,
      JSON.stringify(paymentIntent),
      card.brand || null,
      card.last4 || null,
      card.exp_month || null,
      card.exp_year || null,
      pmDetails.type || null,
      lastError?.code || null,
      lastError?.message || null,
      billDetails.email || null,
      billDetails.phone || null,
      paymentIntent.id
    ]
  );

  if (!result.rowCount && bookingRef) {
    await query(
      `UPDATE payments SET
         status = $1,
         gateway_status = $2,
         gateway_response = $3,
         gateway_response_at = now(),
         card_brand = COALESCE($4, card_brand),
         card_last4 = COALESCE($5, card_last4),
         card_exp_month = COALESCE($6, card_exp_month),
         card_exp_year = COALESCE($7, card_exp_year),
         payment_method_type = COALESCE($8, payment_method_type),
         gateway_error_code = $9,
         gateway_error_message = $10,
         billing_email = COALESCE($11, billing_email),
         billing_contact = COALESCE($12, billing_contact)
       WHERE booking_ref = $13 AND status = 'pending'`,
      [
        isSuccess ? 'completed' : 'failed',
        paymentIntent.status,
        JSON.stringify(paymentIntent),
        card.brand || null,
        card.last4 || null,
        card.exp_month || null,
        card.exp_year || null,
        pmDetails.type || null,
        lastError?.code || null,
        lastError?.message || null,
        billDetails.email || null,
        billDetails.phone || null,
        bookingRef
      ]
    );
  }

  if (isSuccess && bookingRef) {
    await query(`UPDATE requests SET payment_method='online_paid', updated_at=now() WHERE ref=$1`, [bookingRef]);
    const payRow = await query(
      'SELECT amount, currency FROM payments WHERE booking_ref=$1 ORDER BY created_at DESC LIMIT 1',
      [bookingRef]
    );
    return {
      isSuccess: true,
      bookingRef,
      amount: payRow.rows[0]?.amount,
      currency: payRow.rows[0]?.currency,
      cardBrand: card.brand || null,
      cardLast4: card.last4 || null
    };
  }

  return { isSuccess: false };
}

async function getCheckoutSessionStatus(sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status === 'paid' || session.status === 'complete') {
    await saveBillingOnPayment(sessionId, session);
  }
  return {
    status: session.status,
    paymentStatus: session.payment_status,
    customerEmail: session.customer_details?.email || null,
    bookingRef: session.metadata?.bookingRef || null,
    currency: resolvePayCurrency(session.metadata?.country, null)
  };
}

async function getPaymentStatus(bookingRef) {
  const res = await query(
    'SELECT * FROM payments WHERE booking_ref=$1 ORDER BY created_at DESC LIMIT 1',
    [bookingRef]
  );
  return res.rows[0] || null;
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

module.exports = {
  stripe,
  createCheckoutSession,
  createPaymentIntent,
  recordPaymentAttempt,
  recordCheckoutSessionCompleted,
  recordPaymentOutcome,
  getCheckoutSessionStatus,
  getPaymentStatus,
  constructWebhookEvent
};
