// controllers/adminController.js
const { query } = require('../db');
const { sendEmail, EMAIL } = require('../services/emailService');
const { geocodeCity } = require('../services/geocodeService');

exports.getPros = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT p.*, u.first, u.last, u.email, u.phone, u.city, u.state, u.country,
              u.cp_unique_id,
                      u.address, u.zip, u.lat, u.lng, u.created_at as user_created
               FROM pros p JOIN users u ON p.user_id::text=u.id::text`;
    const params = [];
    if (status) { params.push(status); sql += ` WHERE p.status=$1`; }
    sql += ' ORDER BY p.created_at DESC';
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load professionals.' });
  }
};

exports.updatePro = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'approved', 'on_hold', 'reviewed', 'rejected'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid professional status.' });
    const r = await query('UPDATE pros SET status=$1, available=$2, updated_at=now(), updated_by=$4 WHERE id=$3 RETURNING *',
      [status, status === 'approved', +req.params.id, req.user.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found.' });

    if (status === 'approved') {
      const u = await query('SELECT u.first, u.email FROM users u JOIN pros p ON p.user_id::text=u.id::text WHERE p.id=$1', [+req.params.id]).catch(() => ({ rows: [] }));
      if (u.rows[0]) {
        const tpl = EMAIL.proApproved(u.rows[0].first);
        sendEmail(u.rows[0].email, tpl.subject, tpl.html, 'pro_approved')
          .catch((mailErr) => console.error('Pro-approved email dispatch error (non-fatal):', mailErr.message));
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update professional.' });
  }
};

exports.updateBooking = async (req, res) => {
  try {
    const id = +req.params.id;
    const existing = await query('SELECT * FROM requests WHERE id=$1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Not found.' });

    const updates = { ...req.body };
    if (updates.proposed_price || updates.confirmed_price) {
      const finalPrice = updates.confirmed_price || updates.proposed_price || existing.rows[0].confirmed_price || existing.rows[0].proposed_price;
      if (finalPrice) {
        updates.commission = Math.round(finalPrice * 0.15);
        updates.pro_earns = Math.round(finalPrice * 0.85);
      }
    }
    if (updates.status === 'completed') updates.review_requested = true;

    const fields = Object.keys(updates);
    if (!fields.length) return res.json({ success: true });

    const setClauses = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(req.user.id);
    values.push(id);

    await query(`UPDATE requests SET ${setClauses}, updated_at=now(), updated_by=$${values.length - 1} WHERE id=$${values.length}`, values);
    const updated = await query('SELECT * FROM requests WHERE id=$1', [id]);
    res.json({ success: true, commission: updated.rows[0].commission, pro_earns: updated.rows[0].pro_earns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update booking.' });
  }
};

exports.getAdLeads = async (req, res) => {
  try {
    const r = await query('SELECT * FROM ad_leads ORDER BY created DESC');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Could not load inquiries.' });
  }
};

exports.updateAdLead = async (req, res) => {
  try {
    const updates = req.body;
    const fields = Object.keys(updates);
    if (!fields.length) return res.json({ success: true });

    const setClauses = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(+req.params.id);

    await query(`UPDATE ad_leads SET ${setClauses}, updated=now() WHERE id=$${values.length}`, values);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update inquiry.' });
  }
};

exports.getAds = async (req, res) => {
  try {
    const r = await query('SELECT * FROM ads ORDER BY created DESC');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Could not load ads.' });
  }
};

exports.createAd = async (req, res) => {
  try {
    const { title, link, category } = req.body;
    const r = await query('INSERT INTO ads (title,link,category,active) VALUES ($1,$2,$3,true) RETURNING *', [title, link, category]);
    res.json({ success: true, ad: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Could not create ad.' });
  }
};

exports.updateAd = async (req, res) => {
  try {
    const { active } = req.body;
    await query('UPDATE ads SET active=$1 WHERE id=$2', [active, +req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not update ad.' });
  }
};

exports.getCustomRequests = async (req, res) => {
  try {
    const r = await query('SELECT * FROM custom_requests ORDER BY created DESC');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Could not load custom requests.' });
  }
};

exports.updateCustomRequest = async (req, res) => {
  try {
    const { status } = req.body;
    await query('UPDATE custom_requests SET status=$1 WHERE id=$2', [status, +req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not update.' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const users = await query('SELECT COUNT(*) FROM users');
    const prosTotal = await query('SELECT COUNT(*) FROM pros');
    const prosPending = await query("SELECT COUNT(*) FROM pros WHERE status='pending'");
    const prosApproved = await query("SELECT COUNT(*) FROM pros WHERE status='approved'");
    const reqTotal = await query('SELECT COUNT(*) FROM requests');
    const reqPending = await query("SELECT COUNT(*) FROM requests WHERE status='pending'");
    const reqDone = await query("SELECT COUNT(*) FROM requests WHERE status='completed'");
    const commInr = await query("SELECT COALESCE(SUM(commission),0) as s FROM requests WHERE status='completed' AND currency='INR'");
    const commUsd = await query("SELECT COALESCE(SUM(commission),0) as s FROM requests WHERE status='completed' AND currency='USD'");
    const adLeads = await query('SELECT COUNT(*) FROM ad_leads');

    res.json({
      users: +users.rows[0].count,
      pros_total: +prosTotal.rows[0].count,
      pros_pending: +prosPending.rows[0].count,
      pros_approved: +prosApproved.rows[0].count,
      requests_total: +reqTotal.rows[0].count,
      requests_pending: +reqPending.rows[0].count,
      requests_done: +reqDone.rows[0].count,
      commission_inr: Math.round(+commInr.rows[0].s),
      commission_usd: +(+commUsd.rows[0].s).toFixed(2),
      ad_leads: +adLeads.rows[0].count
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load stats.' });
  }
};

exports.getNotifs = async (req, res) => {
  try {
    const r = await query('SELECT * FROM notifs ORDER BY created DESC LIMIT 50');
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'Could not load notifications.' });
  }
};

exports.readAllNotifs = async (req, res) => {
  try {
    await query('UPDATE notifs SET read=true WHERE read=false');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not update notifications.' });
  }
};

exports.dbView = async (req, res) => {
  try {
    const { collection = 'users' } = req.query;
    const allowed = {
      users: 'users', pros: 'pros', requests: 'requests',
      messages: 'messages', reviews: 'reviews', ads: 'ads',
      ad_leads: 'ad_leads', notifs: 'notifs', invoices: 'invoices', payments: 'payments'
    };
    if (!allowed[collection]) return res.status(400).json({ error: 'Invalid collection' });

    let r;
    if (collection === 'messages') {
      r = await query(`
        SELECT m.id, COALESCE(r.booking_ref, m.request_id::text, '—') as booking_ref,
               COALESCE(m.body, m.content, '') as content, m.created, COALESCE(m.updated_at, m.created) as updated_at
        FROM messages m LEFT JOIN requests r ON m.request_id=r.id
        ORDER BY m.created DESC LIMIT 200
      `).catch(() => query(`SELECT * FROM messages ORDER BY created DESC LIMIT 200`));
    } else if (collection === 'reviews') {
      r = await query(`
        SELECT rv.id, COALESCE(r.booking_ref, rv.request_id::text, '—') as booking_ref,
               COALESCE(u.first || ' ' || u.last, 'Customer #' || rv.user_id) as customer,
               rv.rating, COALESCE(rv.comment, '') as comment, rv.created
        FROM reviews rv LEFT JOIN requests r ON rv.request_id=r.id LEFT JOIN users u ON rv.user_id=u.id
        ORDER BY rv.created DESC LIMIT 200
      `).catch(() => query(`SELECT * FROM reviews ORDER BY created DESC LIMIT 200`));
    } else if (collection === 'notifs') {
      r = await query(`
        SELECT n.id, COALESCE(n.type, 'system') as type, COALESCE(n.message, n.msg, '') as msg,
               n.read, n.created
        FROM notifs n
        ORDER BY n.created DESC LIMIT 200
      `).catch(() => query(`SELECT * FROM notifs ORDER BY created DESC LIMIT 200`));
    } else {
      const orderCol = { users: 'created_at', pros: 'created_at', requests: 'created_at', invoices: 'created_at', payments: 'created_at' }[collection] || 'created';
      r = await query(`SELECT * FROM ${allowed[collection]} ORDER BY ${orderCol} DESC LIMIT 200`);
    }

    let data = r.rows;
    if (collection === 'users') data = data.map(({ hash, ...u }) => u);

    res.json({ collection, count: data.length, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not query database.' });
  }
};

exports.updateDbRecord = async (req, res) => {
  try {
    const { collection, id } = req.params;
    const allowed = {
      users: 'users', pros: 'pros', requests: 'requests',
      messages: 'messages', reviews: 'reviews', ads: 'ads',
      ad_leads: 'ad_leads', notifs: 'notifs', invoices: 'invoices', payments: 'payments'
    };
    const tbl = allowed[collection];
    if (!tbl) return res.status(400).json({ error: 'Invalid collection' });

    const updates = { ...(req.body || {}) };
    if (tbl === 'messages') {
      if (updates.content != null && updates.body == null) updates.body = updates.content;
      delete updates.content;
    }
    if (tbl === 'notifs') {
      if (updates.msg != null && updates.message == null) updates.message = updates.msg;
      delete updates.msg;
    }

    const ignoreKeys = ['id', 'hash', 'password', 'created', 'created_at', 'updated_at', 'created_by', 'updated_by', 'booking_ref', 'customer'];
    ignoreKeys.forEach(k => delete updates[k]);

    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ error: 'No valid editable fields provided.' });

    const setClauses = keys.map((k, i) => `"${k}"=$${i + 1}`).join(', ');
    const params = keys.map(k => updates[k]);
    // Tables that carry the created_at/updated_at/created_by/updated_by audit columns —
    // stamp who last touched the row via this generic admin editor.
    const auditedTables = ['users', 'pros', 'requests'];
    let auditClause = '';
    if (auditedTables.includes(tbl)) {
      params.push(req.user.id);
      auditClause = `, updated_at = now(), updated_by = $${params.length}`;
    }
    params.push(+id);

    const r = await query(`UPDATE ${tbl} SET ${setClauses}${auditClause} WHERE id=$${params.length} RETURNING *`, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Record not found' });
    res.json({ success: true, record: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update record: ' + e.message });
  }
};

exports.deleteDbRecord = async (req, res) => {
  try {
    const { collection, id } = req.params;
    const allowed = {
      users: 'users', pros: 'pros', requests: 'requests',
      messages: 'messages', reviews: 'reviews', ads: 'ads',
      ad_leads: 'ad_leads', notifs: 'notifs', invoices: 'invoices', payments: 'payments'
    };
    const tbl = allowed[collection];
    if (!tbl) return res.status(400).json({ error: 'Invalid collection' });

    const r = await query(`DELETE FROM ${tbl} WHERE id=$1 RETURNING id`, [+id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Record not found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete record: ' + e.message });
  }
};

exports.backfillGeo = async (req, res) => {
  try {
    const missing = await query(`
      SELECT u.id, u.city, u.state, u.country, u.zip
      FROM users u JOIN pros p ON p.user_id=u.id
      WHERE u.lat IS NULL AND u.city IS NOT NULL AND u.city != ''
    `);
    let fixed = 0, failed = 0;
    for (const u of missing.rows) {
      try {
        let geo = await geocodeCity(u.city, u.state, u.country, null);
        if (!geo && u.zip) geo = await geocodeCity(u.zip, u.state, u.country, u.city);
        if (geo && geo.lat && geo.lng) {
          await query('UPDATE users SET lat=$1, lng=$2 WHERE id=$3', [geo.lat, geo.lng, u.id]);
          fixed++;
        } else { failed++; }
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) { failed++; }
    }
    res.json({ success: true, total: missing.rows.length, fixed, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.backfillGeoCustomers = async (req, res) => {
  try {
    const missing = await query(`
      SELECT id, city, state, country, zip
      FROM users
      WHERE role='customer' AND lat IS NULL AND city IS NOT NULL AND city != ''
    `);
    let fixed = 0, failed = 0;
    for (const u of missing.rows) {
      try {
        let geo = await geocodeCity(u.city, u.state, u.country, null);
        if (!geo && u.zip) geo = await geocodeCity(u.zip, u.state, u.country, u.city);
        if (geo && geo.lat && geo.lng) {
          await query('UPDATE users SET lat=$1, lng=$2 WHERE id=$3', [geo.lat, geo.lng, u.id]);
          fixed++;
        } else { failed++; }
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) { failed++; }
    }
    res.json({ success: true, total: missing.rows.length, fixed, failed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getEmailLog = async (req, res) => {
  try {
    const r = await query(`SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100`);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.testEmail = async (req, res) => {
  const testTo = req.body.to || 'support@getfixerr.com';
  res.json({ success: true, message: `Test email queued for ${testTo} — check Email Log in 30 seconds` });
  sendEmail(testTo,
    'Fixerr Email Test ✅',
    `<div style="font-family:sans-serif;padding:2rem;"><h2 style="color:#3D8B37;">Email is working!</h2><p>This is a test email from Fixerr at ${new Date().toISOString()}</p></div>`,
    'test'
  );
};

exports.getCustomers = async (req, res) => {
  try {
    const r = await query(`
            SELECT u.id, u.first, u.last, u.email, u.phone, u.city, u.state, u.country,
              u.cp_unique_id,
             u.address, u.zip, u.currency,
             COALESCE(u.lat, NULL) as lat, COALESCE(u.lng, NULL) as lng,
             u.created_at, u.active,
             COALESCE(u.cancellation_count, 0) as cancellation_count,
             COALESCE(u.wallet_balance, 0) as wallet_balance,
             COUNT(DISTINCT r.id) as booking_count
      FROM users u
      LEFT JOIN requests r ON r.user_id=u.id
      WHERE u.role='customer'
      GROUP BY u.id
      ORDER BY u.created_at DESC NULLS LAST
    `);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};

exports.deductEvaluationFee = async (req, res) => {
  try {
    const { pro_user_id, amount, reason } = req.body;
    if (!pro_user_id || !amount) return res.status(400).json({ error: 'pro_user_id and amount required.' });

    await query('UPDATE pros SET evaluation_fees_deducted=COALESCE(evaluation_fees_deducted,0)+$1, updated_at=now(), updated_by=$3 WHERE user_id=$2', [+amount, pro_user_id, req.user.id]);
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)', ['eval_fee', `Evaluation fee of ${amount} deducted from pro ID ${pro_user_id}: ${reason || 'standard evaluation'}`]);
    res.json({ success: true, message: `Evaluation fee of ${amount} deducted.` });
  } catch (e) {
    res.status(500).json({ error: 'Could not deduct evaluation fee.' });
  }
};

// ── Admin CRUD: Customers & Professionals ─────────────────────────────
const ADMIN_EDITABLE_USER_FIELDS = ['first', 'last', 'email', 'phone', 'address', 'city', 'state', 'country', 'zip'];

async function emailTakenByOther(email, excludeUserId) {
  const dup = await query('SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND id<>$2', [email, excludeUserId]);
  return dup.rows.length > 0;
}

exports.updateCustomer = async (req, res) => {
  try {
    const id = +req.params.id;
    const existing = await query('SELECT id, role FROM users WHERE id=$1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Customer not found.' });
    if (existing.rows[0].role !== 'customer') return res.status(400).json({ error: 'This account is not a customer.' });

    const updates = {};
    for (const f of ADMIN_EDITABLE_USER_FIELDS) if (req.body[f] !== undefined) updates[f] = req.body[f];
    if (updates.email && await emailTakenByOther(updates.email, id))
      return res.status(400).json({ error: 'Another account already uses this email.' });

    const fields = Object.keys(updates);
    if (!fields.length) return res.json({ success: true });
    const set = fields.map((f, i) => `"${f}"=$${i + 1}`).join(', ');
    const vals = fields.map(f => updates[f]); vals.push(req.user.id); vals.push(id);
    await query(`UPDATE users SET ${set}, updated_at=now(), updated_by=$${vals.length - 1} WHERE id=$${vals.length}`, vals);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update customer.' });
  }
};

exports.deleteCustomer = async (req, res) => {
  try {
    const id = +req.params.id;
    const r = await query('SELECT role FROM users WHERE id=$1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Customer not found.' });
    if (r.rows[0].role !== 'customer') return res.status(400).json({ error: 'This account is not a customer.' });
    await query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete customer.' });
  }
};

exports.updateProProfile = async (req, res) => {
  try {
    const proId = +req.params.id;
    const pr = await query('SELECT id, user_id FROM pros WHERE id=$1', [proId]);
    if (!pr.rows[0]) return res.status(404).json({ error: 'Professional not found.' });
    const userId = pr.rows[0].user_id;

    // User (account) fields
    const uUpdates = {};
    for (const f of ADMIN_EDITABLE_USER_FIELDS) if (req.body[f] !== undefined) uUpdates[f] = req.body[f];
    if (uUpdates.email && await emailTakenByOther(uUpdates.email, userId))
      return res.status(400).json({ error: 'Another account already uses this email.' });
    const uf = Object.keys(uUpdates);
    if (uf.length) {
      const set = uf.map((f, i) => `"${f}"=$${i + 1}`).join(', ');
      const vals = uf.map(f => uUpdates[f]); vals.push(req.user.id); vals.push(userId);
      await query(`UPDATE users SET ${set}, updated_at=now(), updated_by=$${vals.length - 1} WHERE id=$${vals.length}`, vals);
    }

    // Professional-specific fields
    const pUpdates = {};
    if (req.body.status !== undefined) { pUpdates.status = req.body.status; pUpdates.available = req.body.status === 'approved'; }
    if (req.body.years_exp !== undefined) pUpdates.years_exp = req.body.years_exp;
    if (req.body.services !== undefined) pUpdates.services = JSON.stringify(Array.isArray(req.body.services) ? req.body.services : [req.body.services].filter(Boolean));
    const pf = Object.keys(pUpdates);
    if (pf.length) {
      const set = pf.map((f, i) => `"${f}"=$${i + 1}`).join(', ');
      const vals = pf.map(f => pUpdates[f]); vals.push(req.user.id); vals.push(proId);
      await query(`UPDATE pros SET ${set}, updated_at=now(), updated_by=$${vals.length - 1} WHERE id=$${vals.length}`, vals);
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update professional.' });
  }
};

exports.deletePro = async (req, res) => {
  try {
    const proId = +req.params.id;
    const pr = await query('SELECT user_id FROM pros WHERE id=$1', [proId]);
    if (!pr.rows[0]) return res.status(404).json({ error: 'Professional not found.' });
    // Removing the underlying user account cascades to the pros row.
    await query('DELETE FROM users WHERE id=$1', [pr.rows[0].user_id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete professional.' });
  }
};

// ── Pending Bookings: pro matching & assignment ──────────────────────────
// A pro is excluded once they already have this many active (confirmed/in_progress) jobs,
// so bulk/best-match assignment doesn't pile work onto one professional.
const MAX_ACTIVE_JOBS_PER_PRO = 5;

// Widened fallback distance band (miles/km) admin candidate search extends into when no
// professional matches within their own normal service_radius — lets admin still reach out
// to a farther-away professional rather than leaving the booking unassignable.
const WIDE_SEARCH_MIN_KM = 25;
const WIDE_SEARCH_MAX_KM = 75;

// Ranked candidate professionals for one booking: approved & available, offering the
// requested service, under the active-job cap, and within their own service_radius of the
// booking (by great-circle distance). Falls back to an exact city-name match when the
// booking has no lat/lng on file. Nearest (or, in the fallback, highest-rated) first.
// If nothing matches within the normal radius and geo is available, widens the search to
// WIDE_SEARCH_MIN_KM–WIDE_SEARCH_MAX_KM (ignoring each pro's own service_radius) so admin
// still sees farther-away professionals before concluding none are available at all.
async function findCandidatePros({ lat, lng, city, serviceKey }, limit = 5) {
  const hasGeo = lat != null && lng != null;
  if (hasGeo) {
    const r = await query(
      `SELECT cpu.id AS pro_user_id, (cpu.first || ' ' || cpu.last) AS pro_name,
              cpu.cp_unique_id AS pro_unique_id, cpu.phone AS pro_phone, cpu.email AS pro_email,
              cpu.address AS pro_address, cpu.city AS pro_city, cpu.state AS pro_state,
              cpu.lat AS pro_lat, cpu.lng AS pro_lng, cp.rating AS pro_rating, cp.reviews AS pro_reviews,
              fx_distance_km($1, $2, cpu.lat, cpu.lng) AS distance_km
       FROM pros cp JOIN users cpu ON cpu.id = cp.user_id
       WHERE cp.status = 'approved' AND cp.available = true
         AND (cp.services ? $3 OR cp.experience_map ? $3)
         AND cpu.lat IS NOT NULL AND cpu.lng IS NOT NULL
         AND fx_distance_km($1, $2, cpu.lat, cpu.lng) <= COALESCE(cp.service_radius, 25)
         AND (SELECT COUNT(*) FROM requests ar WHERE ar.assigned_pro_id = cpu.id
                AND ar.status IN ('confirmed', 'in_progress')) < $4
       ORDER BY distance_km ASC, cp.rating DESC NULLS LAST
       LIMIT $5`,
      [lat, lng, serviceKey, MAX_ACTIVE_JOBS_PER_PRO, limit],
    );
    if (r.rows.length) return r.rows;

    // Nobody within their own radius — widen the net (admin-only) before giving up.
    const wide = await query(
      `SELECT cpu.id AS pro_user_id, (cpu.first || ' ' || cpu.last) AS pro_name,
              cpu.cp_unique_id AS pro_unique_id, cpu.phone AS pro_phone, cpu.email AS pro_email,
              cpu.address AS pro_address, cpu.city AS pro_city, cpu.state AS pro_state,
              cpu.lat AS pro_lat, cpu.lng AS pro_lng, cp.rating AS pro_rating, cp.reviews AS pro_reviews,
              fx_distance_km($1, $2, cpu.lat, cpu.lng) AS distance_km, true AS wide_match
       FROM pros cp JOIN users cpu ON cpu.id = cp.user_id
       WHERE cp.status = 'approved' AND cp.available = true
         AND (cp.services ? $3 OR cp.experience_map ? $3)
         AND cpu.lat IS NOT NULL AND cpu.lng IS NOT NULL
         AND fx_distance_km($1, $2, cpu.lat, cpu.lng) > $6
         AND fx_distance_km($1, $2, cpu.lat, cpu.lng) <= $7
         AND (SELECT COUNT(*) FROM requests ar WHERE ar.assigned_pro_id = cpu.id
                AND ar.status IN ('confirmed', 'in_progress')) < $4
       ORDER BY distance_km ASC, cp.rating DESC NULLS LAST
       LIMIT $5`,
      [lat, lng, serviceKey, MAX_ACTIVE_JOBS_PER_PRO, limit, WIDE_SEARCH_MIN_KM, WIDE_SEARCH_MAX_KM],
    );
    return wide.rows;
  }
  const r = await query(
    `SELECT cpu.id AS pro_user_id, (cpu.first || ' ' || cpu.last) AS pro_name,
            cpu.cp_unique_id AS pro_unique_id, cpu.phone AS pro_phone, cpu.email AS pro_email,
            cpu.address AS pro_address, cpu.city AS pro_city, cpu.state AS pro_state,
            cpu.lat AS pro_lat, cpu.lng AS pro_lng, cp.rating AS pro_rating, cp.reviews AS pro_reviews,
            NULL::numeric AS distance_km
     FROM pros cp JOIN users cpu ON cpu.id = cp.user_id
     WHERE cp.status = 'approved' AND cp.available = true
       AND (cp.services ? $1 OR cp.experience_map ? $1)
       AND LOWER(TRIM(cpu.city)) = LOWER(TRIM($2))
       AND (SELECT COUNT(*) FROM requests ar WHERE ar.assigned_pro_id = cpu.id
              AND ar.status IN ('confirmed', 'in_progress')) < $3
     ORDER BY cp.rating DESC NULLS LAST
     LIMIT $4`,
    [serviceKey, city || '', MAX_ACTIVE_JOBS_PER_PRO, limit],
  );
  return r.rows;
}

exports.getUnassignedBookings = async (req, res) => {
  try {
    const { country, service, city } = req.query;
    let sql = `
      SELECT r.id, r.ref, r.service_key, r.sub_service, r.status, r.created_at,
             r.address AS booking_address, r.city AS booking_city, r.state AS booking_state,
             r.country AS booking_country, r.lat AS booking_lat, r.lng AS booking_lng,
             r.customer_name, r.customer_phone, r.customer_email,
             cu.cp_unique_id AS customer_unique_id, cu.address AS customer_home_address
      FROM requests r
      LEFT JOIN users cu ON cu.id = r.user_id
      WHERE r.assigned_pro_id IS NULL
        AND r.preferred_pro_id IS NULL AND (r.preferred_pro IS NULL OR r.preferred_pro = '')
        AND r.status NOT IN ('cancelled', 'declined', 'completed')
    `;
    const params = [];
    if (country) { params.push(country); sql += ` AND r.country = $${params.length}`; }
    if (service) { params.push(service); sql += ` AND r.service_key = $${params.length}`; }
    if (city) { params.push(`%${city.toLowerCase()}%`); sql += ` AND LOWER(r.city) LIKE $${params.length}`; }
    sql += ' ORDER BY r.created_at DESC LIMIT 200';

    const r = await query(sql, params);
    const bookings = await Promise.all(r.rows.map(async (row) => {
      const candidates = await findCandidatePros(
        { lat: row.booking_lat, lng: row.booking_lng, city: row.booking_city, serviceKey: row.service_key },
        5,
      );
      return {
        ...row,
        suggested_pro: candidates[0] || null,
        candidate_count: candidates.length,
      };
    }));
    res.json(bookings);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load unassigned bookings.' });
  }
};

exports.getBookingCandidates = async (req, res) => {
  try {
    const b = await query('SELECT * FROM requests WHERE ref = $1', [req.params.ref]);
    if (!b.rows[0]) return res.status(404).json({ error: 'Booking not found.' });
    const booking = b.rows[0];
    const candidates = await findCandidatePros(
      { lat: booking.lat, lng: booking.lng, city: booking.city, serviceKey: booking.service_key },
      5,
    );
    res.json({ booking, candidates });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load candidate professionals.' });
  }
};

exports.notifyCustomerNoProfessional = async (req, res) => {
  try {
    const b = await query('SELECT * FROM requests WHERE ref = $1', [req.params.ref]);
    const booking = b.rows[0];
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (!booking.customer_email) return res.status(400).json({ error: 'This customer has no email on file.' });

    const { subject, html } = EMAIL.noProfessionalFound(booking.customer_name || 'there');
    await sendEmail(booking.customer_email, subject, html, 'no_professional_found');
    const r = await query(
      "UPDATE requests SET status = 'cancelled', updated_at = now(), updated_by = $2 WHERE ref = $1 RETURNING *",
      [req.params.ref, req.user.id],
    );
    res.json({ success: true, booking: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not notify customer.' });
  }
};

exports.assignProToBooking = async (req, res) => {
  try {
    const { ref, pro_user_id } = req.body;
    if (!ref || !pro_user_id) return res.status(400).json({ error: 'ref and pro_user_id are required.' });

    const proCheck = await query(
      "SELECT (u.first || ' ' || u.last) AS pro_name FROM pros p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1 AND p.status = 'approved'",
      [pro_user_id],
    );
    if (!proCheck.rows[0]) return res.status(400).json({ error: 'That professional is not approved.' });

    // Only assign if still unassigned, and only if the customer hasn't already picked a
    // preferred pro — preferred_pro* and assigned_pro* are mutually exclusive on a booking.
    const r = await query(
      `UPDATE requests SET assigned_pro_id = $1, assigned_pro = $2, updated_at = now(), updated_by = $4
       WHERE ref = $3 AND assigned_pro_id IS NULL
         AND preferred_pro_id IS NULL AND (preferred_pro IS NULL OR preferred_pro = '')
       RETURNING *`,
      [pro_user_id, proCheck.rows[0].pro_name, ref, req.user.id],
    );
    if (!r.rows[0]) return res.status(409).json({ error: 'This booking already has a professional assigned or a preferred professional selected by the customer.' });

    await query('INSERT INTO notifs (type, msg) VALUES ($1, $2)', [
      'pro_assigned',
      `Admin assigned booking ${ref} to professional user ${pro_user_id}.`,
    ]);
    res.json({ success: true, booking: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not assign professional.' });
  }
};

exports.bulkAssignBestMatch = async (req, res) => {
  try {
    const refs = Array.isArray(req.body.refs) ? req.body.refs : [];
    if (!refs.length) return res.status(400).json({ error: 'refs must be a non-empty array.' });

    const results = [];
    for (const ref of refs) {
      const b = await query('SELECT * FROM requests WHERE ref = $1', [ref]);
      const booking = b.rows[0];
      if (!booking) { results.push({ ref, assigned: false, reason: 'Booking not found.' }); continue; }
      if (booking.assigned_pro_id) { results.push({ ref, assigned: false, reason: 'Already assigned.' }); continue; }
      if (booking.preferred_pro_id || booking.preferred_pro) { results.push({ ref, assigned: false, reason: 'Customer already selected a preferred professional.' }); continue; }

      const candidates = await findCandidatePros(
        { lat: booking.lat, lng: booking.lng, city: booking.city, serviceKey: booking.service_key },
        1,
      );
      const best = candidates[0];
      if (!best) { results.push({ ref, assigned: false, reason: 'No matching professional found within range.' }); continue; }

      await query(
        `UPDATE requests SET assigned_pro_id = $1, assigned_pro = $2, updated_at = now(), updated_by = $4
         WHERE ref = $3 AND assigned_pro_id IS NULL
           AND preferred_pro_id IS NULL AND (preferred_pro IS NULL OR preferred_pro = '')`,
        [best.pro_user_id, best.pro_name, ref, req.user.id],
      );
      await query('INSERT INTO notifs (type, msg) VALUES ($1, $2)', [
        'pro_assigned',
        `Admin bulk-assigned booking ${ref} to professional user ${best.pro_user_id}.`,
      ]);
      results.push({ ref, assigned: true, pro: best });
    }
    res.json({ success: true, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not bulk-assign professionals.' });
  }
};
