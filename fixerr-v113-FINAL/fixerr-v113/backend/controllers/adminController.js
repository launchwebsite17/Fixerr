// controllers/adminController.js
const { query } = require('../db');
const { sendEmail, EMAIL } = require('../services/emailService');
const { geocodeCity } = require('../services/geocodeService');

exports.getPros = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT p.*, u.first, u.last, u.email, u.phone, u.city, u.state, u.country,
              u.cp_unique_id,
                      u.address, u.zip, u.created as user_created
               FROM pros p JOIN users u ON p.user_id::text=u.id::text`;
    const params = [];
    if (status) { params.push(status); sql += ` WHERE p.status=$1`; }
    sql += ' ORDER BY p.created DESC';
    const r = await query(sql, params);
    res.json(r.rows.map(p => ({ ...p, created: p.created })));
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
    const r = await query('UPDATE pros SET status=$1, available=$2 WHERE id=$3 RETURNING *',
      [status, status === 'approved', +req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found.' });

    if (status === 'approved') {
      const u = await query('SELECT u.first, u.email FROM users u JOIN pros p ON p.user_id::text=u.id::text WHERE p.id=$1', [+req.params.id]).catch(() => ({ rows: [] }));
      if (u.rows[0]) {
        const tpl = EMAIL.proApproved(u.rows[0].first);
        await sendEmail(u.rows[0].email, tpl.subject, tpl.html, 'pro_approved');
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
    values.push(id);

    await query(`UPDATE requests SET ${setClauses}, updated=now() WHERE id=$${values.length}`, values);
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
      r = await query(`SELECT * FROM ${allowed[collection]} ORDER BY created DESC LIMIT 200`);
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

    const ignoreKeys = ['id', 'hash', 'password', 'created', 'booking_ref', 'customer', 'updated_at'];
    ignoreKeys.forEach(k => delete updates[k]);

    const keys = Object.keys(updates);
    if (!keys.length) return res.status(400).json({ error: 'No valid editable fields provided.' });

    const setClauses = keys.map((k, i) => `"${k}"=$${i + 1}`).join(', ');
    const params = keys.map(k => updates[k]);
    params.push(+id);

    const r = await query(`UPDATE ${tbl} SET ${setClauses} WHERE id=$${params.length} RETURNING *`, params);
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
             u.created, u.active,
             COALESCE(u.cancellation_count, 0) as cancellation_count,
             COALESCE(u.wallet_balance, 0) as wallet_balance,
             COUNT(DISTINCT r.id) as booking_count
      FROM users u
      LEFT JOIN requests r ON r.user_id=u.id
      WHERE u.role='customer'
      GROUP BY u.id
      ORDER BY u.created DESC NULLS LAST
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

    await query('UPDATE pros SET evaluation_fees_deducted=COALESCE(evaluation_fees_deducted,0)+$1 WHERE user_id=$2', [+amount, pro_user_id]);
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
    const vals = fields.map(f => updates[f]); vals.push(id);
    await query(`UPDATE users SET ${set}, updated=now() WHERE id=$${vals.length}`, vals);
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
      const vals = uf.map(f => uUpdates[f]); vals.push(userId);
      await query(`UPDATE users SET ${set}, updated=now() WHERE id=$${vals.length}`, vals);
    }

    // Professional-specific fields
    const pUpdates = {};
    if (req.body.status !== undefined) { pUpdates.status = req.body.status; pUpdates.available = req.body.status === 'approved'; }
    if (req.body.years_exp !== undefined) pUpdates.years_exp = req.body.years_exp;
    if (req.body.services !== undefined) pUpdates.services = JSON.stringify(Array.isArray(req.body.services) ? req.body.services : [req.body.services].filter(Boolean));
    const pf = Object.keys(pUpdates);
    if (pf.length) {
      const set = pf.map((f, i) => `"${f}"=$${i + 1}`).join(', ');
      const vals = pf.map(f => pUpdates[f]); vals.push(proId);
      await query(`UPDATE pros SET ${set}, updated=now() WHERE id=$${vals.length}`, vals);
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
