// controllers/bookingController.js
const { query } = require('../db');
const { sendEmail, EMAIL } = require('../services/emailService');
const { geocodePlace } = require('../services/geocodeService');

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

function uid_ref(p) {
  return p + '-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 9000 + 1000);
}

exports.createBooking = async (req, res) => {
  try {
    const { serviceKey, subService, customDesc, preferredPro, preferredProId, paymentMethod, date, time, address, city, state, zip,
      country, currency, name, phone, email, notes, termsAgreed } = req.body;

    if (!serviceKey) return res.status(400).json({ error: 'Service category is required.' });
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });
    if (!termsAgreed) return res.status(400).json({ error: 'You must agree to the terms to continue.' });

    const isIndia = country === 'IN';
    const p = PRICES[serviceKey] || PRICES.other;
    const est = isIndia ? p.inr.base : p.usd.base;
    const comm = Math.round(est * 0.15);
    const proEarns = est - comm;
    const reference = uid_ref('BK');

    let geo = null;
    if (city || zip || address) {
      try {
        geo = await geocodePlace({ city, state, country, zip, street: address });
      } catch (e) {}
    }

    await query(
      `INSERT INTO requests (ref,user_id,service_key,sub_service,custom_desc,preferred_pro,preferred_pro_id,
         payment_method,preferred_date,preferred_time,address,city,state,zip,country,currency,
         customer_name,customer_phone,customer_email,access_notes,terms_agreed,estimate,commission,pro_earns,lat,lng,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'pending')`,
      [reference, req.user?.id || null, serviceKey, subService || null, customDesc || null, preferredPro || null,
       preferredProId || null, paymentMethod || 'cash', date || null, time || null, address || '', city || '', state || '',
       zip || '', country || 'US', currency || 'USD', name, phone, email || null, notes || null, true, est, comm, proEarns,
       geo?.lat || null, geo?.lng || null]
    );

    const custEmail = email || (req.user?.id ? (await query('SELECT email FROM users WHERE id=$1', [req.user.id]).catch(() => ({ rows: [] }))).rows[0]?.email : null);
    // Awaited (in parallel) so both emails actually send before this serverless handler responds.
    const mailJobs = [];
    if (custEmail) {
      const tpl = EMAIL.bookingConfirmed(name, serviceKey, date || 'your selected date');
      mailJobs.push(sendEmail(custEmail, tpl.subject, tpl.html, 'booking_confirmed'));
    }
    mailJobs.push(sendEmail('support@getfixerr.com', `New Booking: ${serviceKey} — ${name}`,
      `<p>New booking received.<br>Service: <b>${serviceKey}</b><br>Customer: <b>${name}</b> (${phone})<br>Ref: <b>${reference}</b><br>Estimate: <b>${isIndia ? '₹' : '$'}${est}</b></p>`,
      'booking_admin'
    ));
    await Promise.all(mailJobs);

    res.json({ success: true, ref: reference, estimate: est, currency: isIndia ? 'INR' : 'USD', commission: comm, proEarns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not submit booking. Please try again.' });
  }
};

exports.getBookings = async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const r = await query(`
        SELECT req.*, u.flagged as customer_flagged, u.cancellation_count as customer_cancel_count
        FROM requests req LEFT JOIN users u ON req.user_id::text=u.id::text
        ORDER BY req.created DESC`);
      return res.json(r.rows);
    }
    const r = await query('SELECT * FROM requests WHERE user_id=$1 ORDER BY created DESC', [req.user.id]);
    const enriched = await Promise.all(r.rows.map(async (row) => {
      let pro_info = {};
      if (row.assigned_pro_id) {
        const pu = await query('SELECT first,last,phone FROM users WHERE id=$1', [row.assigned_pro_id]);
        if (pu.rows[0]) pro_info = { assigned_pro_name: pu.rows[0].first + ' ' + pu.rows[0].last, assigned_pro_phone: row.status === 'confirmed' ? pu.rows[0].phone : null };
      }
      return { ...row, ...pro_info };
    }));
    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load bookings.' });
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

    if (status) await query('UPDATE requests SET status=$1, updated=now() WHERE ref=$2', [status, req.params.ref]);
    if (confirmed_price) await query('UPDATE requests SET confirmed_price=$1, updated=now() WHERE ref=$2', [confirmed_price, req.params.ref]);

    if (status === 'cancelled') {
      const ur = await query('UPDATE users SET cancellation_count=COALESCE(cancellation_count,0)+1 WHERE id=$1 RETURNING *', [req.user.id]);
      const u = ur.rows[0];
      const CANCEL_THRESHOLD = 3;
      if (u.cancellation_count >= CANCEL_THRESHOLD && !u.flagged) {
        await query('UPDATE users SET flagged=true, flagged_reason=$1 WHERE id=$2', [`Cancelled ${u.cancellation_count} bookings`, u.id]);
        await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)', ['flag', `⚠️ Customer ${u.first} ${u.last} flagged — ${u.cancellation_count} cancellations`]);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update booking.' });
  }
};
