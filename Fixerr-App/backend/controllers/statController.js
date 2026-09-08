// controllers/statController.js
const { query } = require('../db');

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

exports.getCities = (req, res) => {
  const { q = '' } = req.query;
  const raw = require('../cities.json');
  const CITIES = raw.map(c => ({
    n: c.name || c.n, st: c.state || c.st || '',
    c: c.country || c.c, f: c.flag || c.f || '',
    cur: c.currency || c.cur, sym: c.symbol || c.sym
  }));
  const q2 = q.toLowerCase();
  res.json(CITIES.filter(c =>
    c.n.toLowerCase().includes(q2) ||
    (c.st || '').toLowerCase().includes(q2)
  ).slice(0, 12));
};

exports.getPrices = (req, res) => res.json(PRICES);

exports.getPublicStats = async (req, res) => {
  try {
    const r = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer') as customers,
        (SELECT COUNT(*) FROM pros WHERE status='approved') as pros,
        (SELECT COUNT(*) FROM requests WHERE status='completed') as jobs
    `);
    res.json(r.rows[0]);
  } catch (e) {
    res.json({ customers: 0, pros: 0, jobs: 0 });
  }
};

exports.getHealth = async (req, res) => {
  try {
    const users = await query('SELECT COUNT(*) FROM users');
    const requests = await query('SELECT COUNT(*) FROM requests');
    const pros = await query('SELECT COUNT(*) FROM pros');
    res.json({
      status: 'ok', version: 'fixerr-postgres-v2', time: new Date().toISOString(),
      users: +users.rows[0].count, requests: +requests.rows[0].count, pros: +pros.rows[0].count
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
};
