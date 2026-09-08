// db.js — PostgreSQL connection pool
const { Pool } = require('pg');
const env = require('./config/env');

const rawDbUrl = env.DATABASE_URL || process.env.DATABASE_URL;

// Keep node-postgres on its current secure interpretation of legacy SSL modes.
const dbUrl = rawDbUrl && rawDbUrl.replace(
  /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/i,
  '$1verify-full'
);

if (!dbUrl) {
  console.error('❌ DATABASE_URL environment variable is not set!');
  console.error('   Go to Render → your web service → Environment → add DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false }  // Required for Render PostgreSQL
});

let _loggedOnce = false;
pool.on('connect', () => {
  if (!_loggedOnce) { console.log('✅ Connected to PostgreSQL database'); _loggedOnce = true; }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

async function query(text, params) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    console.error('❌ Query error:', err.message);
    console.error('   Query:', text ? text.substring(0, 100) : '');
    throw err;
  }
}

module.exports = { pool, query };
