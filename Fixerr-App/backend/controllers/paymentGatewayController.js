// controllers/paymentGatewayController.js
const env = require('../config/env');
const { query } = require('../db');
const gw = require('../services/paymentGatewayService');
const { computeBillPreview } = require('../services/invoiceService');
const { sendEmail, EMAIL } = require('../services/emailService');
const { createPaymentOrder, verifyPayment, recordRazorpayFailure } = require('../services/paymentService');

// A booking may only be paid for by the customer who owns it, and only once it's marked
// 'completed' by the professional — matching the requirement that "Make Payment" only appears
// at that point in the flow.
async function loadPayableBooking(bookingRef, userId) {
  const res = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
  const booking = res.rows[0];
  if (!booking) return { error: { status: 404, message: 'Booking not found.' } };
  if (booking.user_id !== userId) return { error: { status: 403, message: 'This booking does not belong to you.' } };
  if (booking.status !== 'completed') return { error: { status: 400, message: 'Payment is only available once the job is marked completed.' } };
  return { booking };
}

exports.getBillPreview = async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const { booking, error } = await loadPayableBooking(bookingRef, req.user.id);
    if (error) return res.status(error.status).json({ error: error.message });

    const bill = await computeBillPreview(bookingRef);
    if (!bill.subtotal || bill.subtotal <= 0) {
      return res.status(400).json({ error: 'No payable amount found for this booking.' });
    }

    res.json({ success: true, bill });
  } catch (err) {
    console.error('[paymentGateway] getBillPreview error:', err.message);
    res.status(500).json({ error: 'Could not load bill details.' });
  }
};

exports.createIntent = async (req, res) => {
  try {
    const { bookingRef } = req.body;
    if (!bookingRef) return res.status(400).json({ error: 'bookingRef is required.' });

    const { booking, error } = await loadPayableBooking(bookingRef, req.user.id);
    if (error) return res.status(error.status).json({ error: error.message });

    // Refuse to create a second PaymentIntent if this booking already has a completed payment.
    const existing = await gw.getPaymentStatus(bookingRef);
    if (existing && existing.status === 'completed') {
      return res.status(400).json({ error: 'This booking has already been paid.' });
    }

    const bill = await computeBillPreview(bookingRef);
    const amount = bill.totalAmount;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'No payable amount found for this booking.' });
    }

    const bookingCountry = booking.country === 'IN' ? 'IN' : 'US';
    if (bookingCountry === 'IN') {
      return res.status(400).json({
        error: 'India bookings use Razorpay checkout. Call /api/payment-gateway/create-order instead.',
        gateway: 'razorpay'
      });
    }

    const payCurrency = bill.currency || (bookingCountry === 'IN' ? 'INR' : 'USD');
    const returnUrlBase = req.headers.origin || env.APP_BASE_URL;
    const result = await gw.createPaymentIntent({
      bookingRef,
      amount,
      currency: payCurrency,
      country: bookingCountry,
      customerName: booking.customer_name,
      customerEmail: booking.customer_email,
      returnUrlBase
    });

    res.json({
      success: true,
      ...result,
      amount,
      currency: payCurrency,
      subtotal: bill.subtotal,
      taxAmount: bill.taxAmount,
      totalAmount: bill.totalAmount
    });
  } catch (err) {
    console.error('[paymentGateway] createIntent error:', err.message);
    res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { bookingRef, paymentMethod, currency } = req.body;
    if (!bookingRef) return res.status(400).json({ error: 'bookingRef is required.' });

    const { booking, error } = await loadPayableBooking(bookingRef, req.user.id);
    if (error) return res.status(error.status).json({ error: error.message });

    const bookingCountry = booking.country === 'IN' ? 'IN' : 'US';
    if (bookingCountry !== 'IN') {
      return res.status(400).json({
        error: 'Razorpay checkout is only for India (IN) bookings. Use Stripe for US bookings.',
        gateway: 'stripe'
      });
    }

    const existing = await gw.getPaymentStatus(bookingRef);
    if (existing && existing.status === 'completed') {
      return res.status(400).json({ error: 'This booking has already been paid.' });
    }

    if (!env.RAZORPAY_LIVE) {
      return res.status(503).json({ error: 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' });
    }

    const origin = req.body.origin || req.headers.origin ||
      (req.headers.host ? `${req.protocol}://${req.headers.host}` : env.APP_BASE_URL);
    const orderData = await createPaymentOrder(bookingRef, paymentMethod || 'card', currency || 'INR', origin);

    if (orderData.gateway !== 'razorpay') {
      return res.status(400).json({ error: 'Could not create a Razorpay order for this booking.' });
    }

    res.json({
      success: true,
      order_id: orderData.orderId,
      orderId: orderData.orderId,
      amount: orderData.amount,
      currency: orderData.currency,
      key: orderData.key,
      name: orderData.name,
      description: orderData.description,
      subtotal: orderData.subtotal,
      taxAmount: orderData.taxAmount,
      bookingRef: orderData.bookingRef,
      gateway: orderData.gateway,
      mode: orderData.mode,
      prefill: orderData.prefill || null
    });
  } catch (err) {
    console.error('[paymentGateway] createOrder error:', err.message);
    const msg = err.message || 'Could not create Razorpay order.';
    if (/authentication failed/i.test(msg)) return res.status(401).json({ error: msg });
    res.status(500).json({ error: msg });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { bookingRef, orderId, paymentId, signature, prefill, billingAddress } = req.body;
    if (!bookingRef) return res.status(400).json({ error: 'bookingRef is required.' });
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'orderId, paymentId, and signature are required.' });
    }

    const { booking, error } = await loadPayableBookingOrAnyStatus(bookingRef, req.user);
    if (error) return res.status(error.status).json({ error: error.message });

    const result = await verifyPayment({ bookingRef, orderId, paymentId, signature, prefill, billingAddress });
    if (!result.success) {
      return res.status(400).json({ error: result.message || 'Payment verification failed.' });
    }

    // Fire-and-forget — the payment itself is already verified/recorded above; the customer's
    // browser gets the success response immediately instead of waiting on the receipt email
    // (this was the main source of the delay between the gateway closing and the UI updating).
    if (booking?.customer_email) {
      (async () => {
        const payRow = await gw.getPaymentStatus(bookingRef);
        const { subject, html } = EMAIL.paymentReceipt({
          bookingRef,
          customerName: booking.customer_name,
          amount: payRow?.amount || result.amount,
          currency: payRow?.currency || 'INR',
          cardBrand: payRow?.card_brand || 'Razorpay',
          cardLast4: payRow?.card_last4 || ''
        });
        await sendEmail(booking.customer_email, subject, html, 'payment_receipt');
      })().catch((emailErr) => console.error('[paymentGateway] Razorpay receipt email failed:', emailErr.message));
    }

    res.json(result);
  } catch (err) {
    console.error('[paymentGateway] verifyPayment error:', err.message);
    const status = /signature|verification failed|not confirmed/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message || 'Payment verification failed.' });
  }
};

exports.recordRazorpayFailure = async (req, res) => {
  try {
    const { bookingRef, orderId, errorCode, errorDescription } = req.body;
    if (!bookingRef) return res.status(400).json({ error: 'bookingRef is required.' });

    const { error } = await loadPayableBookingOrAnyStatus(bookingRef, req.user);
    if (error) return res.status(error.status).json({ error: error.message });

    const result = await recordRazorpayFailure({
      bookingRef,
      orderId,
      errorCode,
      errorDescription
    });
    res.json(result);
  } catch (err) {
    console.error('[paymentGateway] recordRazorpayFailure error:', err.message);
    res.status(400).json({ error: err.message || 'Could not record payment failure.' });
  }
};

exports.recordAttempt = async (req, res) => {
  try {
    const { paymentIntentId, paymentMethodType, billing } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId is required.' });
    await gw.recordPaymentAttempt({ paymentIntentId, paymentMethodType, billing });
    res.json({ success: true });
  } catch (err) {
    console.error('[paymentGateway] recordAttempt error:', err.message);
    // Never block the actual payment confirmation on this bookkeeping step failing.
    res.json({ success: false });
  }
};

exports.getSessionStatus = async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id is required.' });

    const sessionInfo = await gw.getCheckoutSessionStatus(sessionId);
    if (sessionInfo.bookingRef) {
      const { error } = await loadPayableBookingOrAnyStatus(sessionInfo.bookingRef, req.user);
      if (error) return res.status(error.status).json({ error: error.message });
    }

    res.json({ success: true, ...sessionInfo });
  } catch (err) {
    console.error('[paymentGateway] getSessionStatus error:', err.message);
    res.status(500).json({ error: 'Could not fetch checkout session status.' });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const { bookingRef } = req.params;
    const { error } = await loadPayableBookingOrAnyStatus(bookingRef, req.user);
    if (error) return res.status(error.status).json({ error: error.message });

    const payment = await gw.getPaymentStatus(bookingRef);
    res.json({ success: true, payment });
  } catch (err) {
    console.error('[paymentGateway] getStatus error:', err.message);
    res.status(500).json({ error: 'Could not fetch payment status.' });
  }
};

// Status checks are allowed regardless of booking.status (so the dashboard can show "already
// paid" even after the fact) — only ownership is enforced here, not the 'completed' requirement.
async function loadPayableBookingOrAnyStatus(bookingRef, user) {
  const res = await query('SELECT * FROM requests WHERE ref=$1', [bookingRef]);
  const booking = res.rows[0];
  if (!booking) return { error: { status: 404, message: 'Booking not found.' } };
  const isOwner = user && user.id === booking.user_id;
  const isAdmin = user && user.role === 'admin';
  if (!isOwner && !isAdmin) return { error: { status: 403, message: 'This booking does not belong to you.' } };
  return { booking };
}

// Stripe requires the RAW, unparsed request body to verify a webhook's signature — this route is
// wired up in server.js with express.raw() instead of express.json() (see routes file comment).
// No auth middleware here: Stripe itself is the caller, authenticated via signature instead of a
// login token.
exports.stripeWebhook = async (req, res) => {
  let event;
  try {
    event = gw.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[paymentGateway] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const outcome = await gw.recordCheckoutSessionCompleted(session);

      if (outcome.isSuccess && outcome.bookingRef) {
        // Fire-and-forget — Stripe just needs a prompt ack of the webhook; the receipt email
        // sending doesn't need to hold that up (and a failed email must never look like a
        // failed webhook to Stripe).
        (async () => {
          const bkRes = await query('SELECT customer_name, customer_email FROM requests WHERE ref=$1', [outcome.bookingRef]);
          const booking = bkRes.rows[0];
          if (booking?.customer_email) {
            const { subject, html } = EMAIL.paymentReceipt({
              bookingRef: outcome.bookingRef,
              customerName: booking.customer_name,
              amount: outcome.amount,
              currency: outcome.currency,
              cardBrand: outcome.cardBrand,
              cardLast4: outcome.cardLast4
            });
            await sendEmail(booking.customer_email, subject, html, 'payment_receipt');
          }
        })().catch((emailErr) => console.error('[paymentGateway] Receipt email failed (payment itself still succeeded):', emailErr.message));
      }
    } else if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      // Re-retrieve with the charge expanded so card brand/last4/expiry are available.
      const full = await gw.stripe.paymentIntents.retrieve(event.data.object.id, { expand: ['latest_charge'] });
      const outcome = await gw.recordPaymentOutcome(full);

      if (outcome.isSuccess && outcome.bookingRef) {
        (async () => {
          const bkRes = await query('SELECT customer_name, customer_email FROM requests WHERE ref=$1', [outcome.bookingRef]);
          const booking = bkRes.rows[0];
          if (booking?.customer_email) {
            const { subject, html } = EMAIL.paymentReceipt({
              bookingRef: outcome.bookingRef,
              customerName: booking.customer_name,
              amount: outcome.amount,
              currency: outcome.currency,
              cardBrand: outcome.cardBrand,
              cardLast4: outcome.cardLast4
            });
            await sendEmail(booking.customer_email, subject, html, 'payment_receipt');
          }
        })().catch((emailErr) => console.error('[paymentGateway] Receipt email failed (payment itself still succeeded):', emailErr.message));
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[paymentGateway] Webhook processing error:', err.message);
    // Still 200 so Stripe doesn't endlessly retry a webhook whose failure is on our side after
    // the payment itself already succeeded/failed at Stripe.
    res.json({ received: true, warning: 'Processed with errors, see server logs.' });
  }
};
