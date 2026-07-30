// db.js — PostgreSQL connection pool
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set!');
  console.error('   Go to Render → your web service → Environment → add DATABASE_URL');
  process.exit(1);
}

const useSsl = process.env.DB_SSL === 'true' || 
               (process.env.DATABASE_URL && 
                (process.env.DATABASE_URL.includes('sslmode=require') || 
                 process.env.DATABASE_URL.includes('render.com')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {})
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
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
    console.error('   Query:', text.substring(0, 100));
    throw err;
  }
}

module.exports = { pool, query };
