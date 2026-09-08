// controllers/bookingController.js
const { query } = require('../db');
const { sendEmail, EMAIL } = require('../services/emailService');
const { geocodePlace } = require('../services/geocodeService');
const { generateBookingRef } = require('../services/bookingRefService');

const PRICES = {
  plumbing:{inr:{base:399,hr:499},usd:{base:49,hr:65}},
  electrical:{inr:{base:449,hr:549},usd:{base:59,hr:70}},
  cleaning:{inr:{base:599,hr:449},usd:{base:79,hr:55}},
  appliance:{inr:{base:499,hr:499},usd:{base:69,hr:60}},
  beauty:{inr:{base:299,hr:349},usd:{base:39,hr:45}},
  tutoring:{inr:{base:249,hr:299},usd:{base:30,hr:35}},
  photography:{inr:{base:799,hr:649},usd:{base:99,hr:80}},
  events:{inr:{base:1199,hr:749},usd:{base:149,hr:90}},
  lawn:{inr:{base:349,hr:399},usd:{base:49,hr:50}},
  painting:{inr:{base:599,hr:449},usd:{base:79,hr:55}},
  movers:{inr:{base:1199,hr:699},usd:{base:149,hr:85}},
  handyman:{inr:{base:449,hr:499},usd:{base:59,hr:60}},
  other:{inr:{base:399,hr:449},usd:{base:49,hr:55}},
};

async function isProSlotAvailable(proId, date, time) {
  if (!proId || !date || !time) return true;
  const r = await query(
    `SELECT id FROM requests
     WHERE preferred_pro_id = $1
       AND preferred_date = $2
       AND preferred_time = $3
       AND COALESCE(status, '') NOT IN ('cancelled')
     LIMIT 1`,
    [proId, date, time]
  );
  return r.rows.length === 0;
}

exports.createBooking = async (req, res) => {
  try {
    const { serviceKey, subService, customDesc, quantity, preferredPro, preferredProId, paymentMethod, date, time, address, city, state, zip,
      country, currency, name, phone, email, notes, termsAgreed } = req.body;

    if (!serviceKey) return res.status(400).json({ error: 'Service category is required.' });
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });
    if (!termsAgreed) return res.status(400).json({ error: 'You must agree to the terms to continue.' });

    const isIndia = country === 'IN';
    const p = PRICES[serviceKey] || PRICES.other;
    const unitPrice = isIndia ? p.inr.base : p.usd.base;
    const qty = Math.max(1, Math.min(99, parseInt(quantity, 10) || 1));
    const est = unitPrice * qty;
    const comm = Math.round(est * 0.15);
    const proEarns = est - comm;
    if (preferredProId && date && time) {
      const proIdNum = parseInt(preferredProId, 10);
      if (!isNaN(proIdNum)) {
        const available = await isProSlotAvailable(proIdNum, date, time);
        if (!available) {
          return res.status(409).json({ error: 'Please select a different date & time. This slot is already booked for the selected professional.' });
        }
      }
    }

    const reference = await generateBookingRef(country || 'US');

    let geo = null;
    if (city || zip || address) {
      try {
        geo = await geocodePlace({ city, state, country, zip, street: address });
      } catch (e) {}
    }

    await query(
      `INSERT INTO requests (ref,user_id,service_key,sub_service,custom_desc,quantity,preferred_pro,preferred_pro_id,
         payment_method,preferred_date,preferred_time,address,city,state,zip,country,currency,
         customer_name,customer_phone,customer_email,access_notes,terms_agreed,estimate,commission,pro_earns,lat,lng,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'pending',$28)`,
      [reference, req.user?.id || null, serviceKey, subService || null, customDesc || null, qty, preferredPro || null,
       preferredProId || null, paymentMethod || 'cash', date || null, time || null, address || '', city || '', state || '',
       zip || '', country || 'US', currency || 'USD', name, phone, email || null, notes || null, true, est, comm, proEarns,
       geo?.lat || null, geo?.lng || null, req.user?.id || null]
    );

    const custEmail = email || (req.user?.id ? (await query('SELECT email FROM users WHERE id=$1', [req.user.id]).catch(() => ({ rows: [] }))).rows[0]?.email : null);
    // Fire-and-forget — the booking is already saved above; don't delay the response on email.
    if (custEmail) {
      const tpl = EMAIL.bookingConfirmed(name, serviceKey, date || 'your selected date', reference);
      sendEmail(custEmail, tpl.subject, tpl.html, 'booking_confirmed')
        .catch((mailErr) => console.error('Booking-confirmed email dispatch error (non-fatal):', mailErr.message));
    }
    sendEmail('support@getfixerr.com', `New Booking: ${serviceKey} — ${name}`,
      `<p>New booking received.<br>Service: <b>${serviceKey}</b><br>Customer: <b>${name}</b> (${phone})<br>Ref: <b>${reference}</b><br>Estimate: <b>${isIndia ? '₹' : '$'}${est}</b></p>`,
      'booking_admin'
    ).catch((mailErr) => console.error('Booking-admin email dispatch error (non-fatal):', mailErr.message));

    res.json({
      success: true, ref: reference, estimate: est, unitPrice, quantity: qty,
      currency: isIndia ? 'INR' : 'USD', commission: comm, proEarns
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not submit booking. Please try again.' });
  }
};

exports.getBookings = async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const r = await query(`
        SELECT req.*, u.flagged as customer_flagged, u.cancellation_count as customer_cancel_count,
          u.cp_unique_id as customer_unique_id, u.address as customer_address,
          pu.address as pro_address, pu.city as pro_city, pu.cp_unique_id as pro_unique_id,
          pp.rating as pro_rating, pp.reviews as pro_reviews,
          COALESCE(inv.payment_status, 'notpaid') as payment_status
        FROM requests req
        LEFT JOIN users u ON req.user_id::text=u.id::text
        LEFT JOIN users pu ON COALESCE(req.preferred_pro_id, req.assigned_pro_id)::text=pu.id::text
        LEFT JOIN pros pp ON pp.user_id = pu.id
        LEFT JOIN invoices inv ON inv.booking_ref = req.ref
        ORDER BY req.created_at DESC`);
      return res.json(r.rows);
    }
    const r = await query(
      `SELECT r.*, COALESCE(inv.payment_status, 'notpaid') as payment_status
       FROM requests r
       LEFT JOIN invoices inv ON inv.booking_ref = r.ref
       WHERE r.user_id=$1 ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    const enriched = await Promise.all(r.rows.map(async (row) => {
      let pro_info = {};
      const proUserId = row.assigned_pro_id || row.preferred_pro_id;
      if (proUserId) {
        const pu = await query(
          'SELECT u.first, u.last, u.phone, p.rating, p.reviews FROM users u LEFT JOIN pros p ON p.user_id = u.id WHERE u.id=$1',
          [proUserId]
        );
        if (pu.rows[0]) pro_info = {
          assigned_pro_name: pu.rows[0].first + ' ' + pu.rows[0].last,
          assigned_pro_phone: row.status === 'confirmed' ? pu.rows[0].phone : null,
          assigned_pro_rating: pu.rows[0].rating,
          assigned_pro_reviews: pu.rows[0].reviews
        };
      }
      return { ...row, ...pro_info };
    }));
    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load bookings.' });
  }
};

exports.checkAvailability = async (req, res) => {
  try {
    const { proId, date, time } = req.query;
    if (!proId || !date || !time) {
      return res.status(400).json({ error: 'proId, date, and time are required.' });
    }
    const available = await isProSlotAvailable(parseInt(proId, 10), date, time);
    res.json({ available });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not check availability.' });
  }
};

exports.updateCustomerBooking = async (req, res) => {
  try {
    const existing = await query('SELECT * FROM requests WHERE ref=$1 AND user_id=$2', [req.params.ref, req.user.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Booking not found.' });

    const { status, confirmed_price } = req.body;
    const allowed = ['cancelled', 'confirmed'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status update.' });
    if (status === 'cancelled' && !['pending', 'price_proposed'].includes(existing.rows[0].status))
      return res.status(400).json({ error: 'This booking cannot be cancelled at this stage.' });

    if (status) await query('UPDATE requests SET status=$1, updated_at=now(), updated_by=$3 WHERE ref=$2', [status, req.params.ref, req.user.id]);
    if (confirmed_price) await query('UPDATE requests SET confirmed_price=$1, updated_at=now(), updated_by=$3 WHERE ref=$2', [confirmed_price, req.params.ref, req.user.id]);

    if (status === 'cancelled') {
      // Self-update — the customer's own cancellation triggers these.
      const ur = await query('UPDATE users SET cancellation_count=COALESCE(cancellation_count,0)+1, updated_at=now(), updated_by=$1 WHERE id=$1 RETURNING *', [req.user.id]);
      const u = ur.rows[0];
      const CANCEL_THRESHOLD = 3;
      if (u.cancellation_count >= CANCEL_THRESHOLD && !u.flagged) {
        await query('UPDATE users SET flagged=true, flagged_reason=$1, updated_at=now(), updated_by=$2 WHERE id=$2', [`Cancelled ${u.cancellation_count} bookings`, u.id]);
        await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)', ['flag', `⚠️ Customer ${u.first} ${u.last} flagged — ${u.cancellation_count} cancellations`]);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update booking.' });
  }
};
