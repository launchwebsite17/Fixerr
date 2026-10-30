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

function mapCityRow(r) {
  const st = r.country_code === 'US'
    ? (r.state_code || '')
    : (r.state_name || r.state_code || '');
  return {
    n: r.city_name,
    st,
    c: r.country_code,
    f: r.flag_emoji || '',
    cur: r.currency_code,
    sym: r.currency_symbol,
    aliases: Array.isArray(r.aliases) ? r.aliases : []
  };
}

// Old version read backend/cities.json and filtered in memory by ?q=.
exports.getCities = async (req, res) => {
  const country = String(req.query.country || '').trim().toUpperCase();
  const q = String(req.query.q || '').trim();
  try {
    const params = [];
    let where = 'ci.is_active = true AND cc.is_active = true';
    if (country) {
      params.push(country);
      where += ` AND ci.country_code = $${params.length}`;
    }
    if (q) {
      params.push('%' + q.toLowerCase() + '%');
      const p = params.length;
      where += ` AND (
        lower(ci.city_name) LIKE $${p}
        OR lower(COALESCE(ci.state_name,'')) LIKE $${p}
        OR lower(COALESCE(ci.state_code,'')) LIKE $${p}
        OR EXISTS (SELECT 1 FROM unnest(ci.aliases) a WHERE lower(a) LIKE $${p})
      )`;
    }
    const limit = q && !country ? ' LIMIT 12' : '';
    const r = await query(`
      SELECT ci.city_name, ci.state_code, ci.state_name, ci.country_code, ci.aliases,
             cc.flag_emoji, cc.currency_code, cc.currency_symbol
      FROM cities ci
      JOIN countries_config cc ON cc.country_code = ci.country_code
      WHERE ${where}
      ORDER BY ci.city_name
      ${limit}
    `, params);
    res.json(r.rows.map(mapCityRow));
  } catch (e) {
    console.error('GET /api/cities:', e.message);
    res.json([]);
  }
};

exports.getPrices = (req, res) => res.json(PRICES);

exports.getCountriesConfig = async (req, res) => {
  try {
    const r = await query(`
      SELECT country_code, country_name, flag_emoji, currency_code, currency_symbol,
             currency_decimals, number_locale, tax_label, postal_code_label,
             postal_code_regex, postal_code_example, phone_dial_code, phone_regex,
             phone_example, distance_unit, date_format, is_default, sort_order
      FROM countries_config
      WHERE is_active = true
      ORDER BY sort_order, country_name
    `);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /api/countries_config:', e.message);
    res.json([]);
  }
};

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
