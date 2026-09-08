// controllers/adController.js
const { query } = require('../db');

exports.getAds = async (req, res) => {
  try {
    const r = await query('SELECT * FROM ads WHERE active=true ORDER BY created DESC');
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load ads.' });
  }
};

exports.clickAd = async (req, res) => {
  try {
    await query('UPDATE ads SET clicks=clicks+1 WHERE id=$1', [+req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not log click.' });
  }
};

exports.inquireAd = async (req, res) => {
  try {
    const b = req.body;
    if (!b.company || !b.name || !b.email) return res.status(400).json({ error: 'Company name, contact name and email are required.' });

    const r = await query(
      `INSERT INTO ad_leads (company,name,email,phone,tier,category,message,status,user_id,country,currency) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) RETURNING id`,
      [b.company || '', b.name || '', b.email || '', b.phone || '', b.tier || '', b.category || '', b.message || '', req.user.id, b.country || 'US', b.currency || 'USD']
    );
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)', ['ad_lead', `New ad inquiry from ${b.company || 'unknown'} — ${b.tier || 'custom'} tier`]);
    res.json({ success: true, inquiry_id: r.rows[0].id, message: 'Inquiry received! We will contact you within 24 hours.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not submit inquiry.' });
  }
};

exports.getMyAdLeads = async (req, res) => {
  try {
    const r = await query('SELECT * FROM ad_leads WHERE user_id=$1 ORDER BY created DESC', [req.user.id]);
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load inquiries.' });
  }
};

exports.cancelMyAdLead = async (req, res) => {
  try {
    const existing = await query('SELECT * FROM ad_leads WHERE id=$1 AND user_id=$2', [+req.params.id, req.user.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Inquiry not found.' });
    if (existing.rows[0].status === 'active') return res.status(400).json({ error: 'Active ads cannot be cancelled. Please contact support.' });

    await query('UPDATE ad_leads SET status=$1, updated=now() WHERE id=$2', ['cancelled', +req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not cancel inquiry.' });
  }
};
