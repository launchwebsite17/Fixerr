// FIXERR BACKEND - PostgreSQL Edition (Modularized Architecture)
// Run: npm install && node server.js

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const env = require('./config/env');
const { pool, query } = require('./db');
const { buildCpUniqueId } = require('./services/identityService');

// Middleware
const { generalLimiter } = require('./middleware/rateLimiter');
const { sanitizeMiddleware } = require('./middleware/sanitizer');
const { securityHeaders, blockDirectoryListing } = require('./middleware/security');

// Modular Routes
const authRoutes = require('./routes/authRoutes');
const proRoutes = require('./routes/proRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const adRoutes = require('./routes/adRoutes');
const adminRoutes = require('./routes/adminRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const reportRoutes = require('./routes/reportRoutes');
const messageRoutes = require('./routes/messageRoutes');
const statRoutes = require('./routes/statRoutes');
const walletRoutes = require('./routes/walletRoutes');
const contactRoutes = require('./routes/contactRoutes');

const app = express();
const PORT = env.PORT;

// Do not advertise the Express framework/version (fingerprinting hardening).
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Global Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Security Headers & Directory Listing Protection
app.use(securityHeaders);
app.use(blockDirectoryListing);

// Serve static frontend files safely
app.use(express.static(path.join(__dirname, '../frontend'), {
  dotfiles: 'ignore',
  index: 'index.html'
}));

// API Rate Limiting & Sanitization
app.use('/api/', generalLimiter);
app.use('/api/', sanitizeMiddleware);

// Register Modular API Routes
app.use('/api', authRoutes);
app.use('/api', proRoutes);
app.use('/api', bookingRoutes);
app.use('/api', paymentRoutes);
app.use('/api', reviewRoutes);
app.use('/api', adRoutes);
app.use('/api', adminRoutes);
app.use('/api', invoiceRoutes);
app.use('/api', reportRoutes);
app.use('/api', messageRoutes);
app.use('/api', statRoutes);
app.use('/api', walletRoutes);
app.use('/api', contactRoutes);


// 404 handler for unknown API endpoints
app.use('/api/*', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Fallback to frontend index.html for SPA routing
app.get('*', (req, res) => {
  const f = path.join(__dirname, '../frontend/index.html');
  res.sendFile(f);
});

app.initPromise = initDB();

// Start Server & Initialize Database
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`\n🚀 Fixerr backend running on port ${PORT}`);
    console.log(`   Database: PostgreSQL`);
    await app.initPromise;
    console.log(`   Ready!\n`);
  });
}

// Database Initialization & Column Migrations
async function initDB() {
  try {
    await query('SELECT 1');
    console.log('✅ Database connection verified');

    // Run schema.sql to create tables if they don't exist
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✅ Schema verified/created');
    }

    // Run migrations for missing columns/tables
    const migrations = [
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS country TEXT`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS currency TEXT`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS preferred_pro_id INTEGER`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS updated TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS lat NUMERIC`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS lng NUMERIC`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS passkey TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS cp_unique_id TEXT`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS lat NUMERIC`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS lng NUMERIC`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 25`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS evaluation_fees_deducted NUMERIC DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS zip TEXT`,
      `ALTER TABLE state_taxes ADD COLUMN IF NOT EXISTS tax_name TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_num TEXT`,
      `ALTER TABLE invoices ALTER COLUMN invoice_num DROP NOT NULL`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS booking_ref TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS user_id INTEGER`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_amount NUMERIC DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD'`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_breakdown JSONB`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
      `CREATE TABLE IF NOT EXISTS email_log (
        id SERIAL PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT,
        type TEXT, status TEXT DEFAULT 'sent', error TEXT, created_at TIMESTAMPTZ DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS state_taxes (
        id SERIAL PRIMARY KEY, country TEXT NOT NULL, state_code TEXT NOT NULL,
        state_name TEXT, tax_rate NUMERIC NOT NULL DEFAULT 0, tax_name TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY, invoice_number TEXT UNIQUE NOT NULL,
        booking_ref TEXT REFERENCES requests(ref) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        subtotal NUMERIC NOT NULL DEFAULT 0, tax_amount NUMERIC NOT NULL DEFAULT 0,
        total_amount NUMERIC NOT NULL DEFAULT 0, currency TEXT DEFAULT 'USD',
        tax_breakdown JSONB DEFAULT '{}', pdf_url TEXT, created_at TIMESTAMPTZ DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY, payment_id TEXT UNIQUE NOT NULL, booking_ref TEXT,
        gateway TEXT, amount NUMERIC DEFAULT 0, currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'pending', payload JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now()
      )`
    ];

    for (const m of migrations) {
      await pool.query(m).catch(e => console.log('Migration skip:', e.message.substring(0, 60)));
    }
    console.log('✅ Column migrations verified');

    try {
      const missingIds = await query(`
        SELECT id, role, country, state, phone
        FROM users
        WHERE role IN ('customer', 'professional')
          AND (cp_unique_id IS NULL OR cp_unique_id='')
      `);
      for (const user of missingIds.rows) {
        const cpUniqueId = buildCpUniqueId(user);
        await query('UPDATE users SET cp_unique_id=$1 WHERE id=$2', [cpUniqueId, user.id]);
      }
      if (missingIds.rows.length) console.log(`✅ Backfilled ${missingIds.rows.length} CP unique IDs`);
    } catch (e) {
      console.log('CP unique ID backfill skip:', e.message.substring(0, 80));
    }

    // Auto-seed/update admin user
    const hash = bcrypt.hashSync(env.ADMIN_PASSWORD, 10);
    const existing = await query("SELECT id FROM users WHERE LOWER(email)='admin@getfixerr.com'");
    if (!existing.rows.length) {
      await query(
        `INSERT INTO users (first,last,email,hash,role,city,state,country,currency,active)
         VALUES ('Admin','Fixerr','admin@getfixerr.com',$1,'admin','Bengaluru','Karnataka','IN','INR',true)`,
        [hash]
      );
      console.log('✅ Admin user created — admin@getfixerr.com');
    } else {
      await query("UPDATE users SET hash=$1, role='admin', active=true WHERE LOWER(email)='admin@getfixerr.com'", [hash]);
      console.log('✅ Admin user password synced — admin@getfixerr.com');
    }

    // Seed default state taxes if empty
    const taxCount = await query('SELECT COUNT(*) FROM state_taxes');
    if (+taxCount.rows[0].count === 0) {
      const defaultTaxes = [
        ['US', 'CA', 'California', 7.25, 'CA State Sales Tax'],
        ['US', 'NY', 'New York', 4.00, 'NY State Sales Tax'],
        ['US', 'TX', 'Texas', 6.25, 'TX State Sales Tax'],
        ['US', 'FL', 'Florida', 6.00, 'FL State Sales Tax'],
        ['US', 'IL', 'Illinois', 6.25, 'IL State Sales Tax'],
        ['IN', 'KA', 'Karnataka', 18.00, 'GST (18%)'],
        ['IN', 'MH', 'Maharashtra', 18.00, 'GST (18%)'],
        ['IN', 'DL', 'Delhi', 18.00, 'GST (18%)']
      ];
      for (const t of defaultTaxes) {
        await query(`INSERT INTO state_taxes (country, state_code, state_name, tax_rate, tax_name) VALUES ($1,$2,$3,$4,$5)`, t);
      }
      console.log('✅ Default state taxes seeded');
    }

    // Reviews integrity: link any reviews missing a pro_id to the booking's assigned pro,
    // then recompute every professional's rating & review count from the reviews table
    // (source of truth). Idempotent — safe to run on every boot.
    try {
      await pool.query(`
        UPDATE reviews r SET pro_id = pr.id
        FROM requests req JOIN pros pr ON pr.user_id = req.assigned_pro_id
        WHERE r.pro_id IS NULL AND r.booking_ref = req.ref AND req.assigned_pro_id IS NOT NULL
      `);
      await pool.query(`
        UPDATE pros p SET reviews = sub.cnt, rating = sub.avg, updated = now()
        FROM (
          SELECT pro_id, COUNT(*) AS cnt, ROUND(AVG(rating)::numeric, 1) AS avg
          FROM reviews WHERE pro_id IS NOT NULL GROUP BY pro_id
        ) sub
        WHERE p.id = sub.pro_id AND (p.reviews IS DISTINCT FROM sub.cnt OR p.rating IS DISTINCT FROM sub.avg)
      `);
      console.log('✅ Professional ratings/reviews recomputed from reviews table');
    } catch (e) {
      console.log('Review recompute skip:', e.message.substring(0, 80));
    }

    // Repair any legacy invoices whose total_amount was corrupted (e.g. string-concatenated
    // "399"+"71.82" => 39971.82). The correct total is always subtotal + tax. Idempotent.
    try {
      await pool.query(`
        UPDATE invoices
        SET total_amount = ROUND((COALESCE(subtotal,0) + COALESCE(tax_amount,0))::numeric, 2)
        WHERE total_amount IS DISTINCT FROM ROUND((COALESCE(subtotal,0) + COALESCE(tax_amount,0))::numeric, 2)
      `);
      console.log('✅ Invoice totals verified/repaired');
    } catch (e) {
      console.log('Invoice total repair skip:', e.message.substring(0, 80));
    }

    const counts = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM requests) as requests,
        (SELECT COUNT(*) FROM pros) as pros,
        (SELECT COUNT(*) FROM ad_leads) as ad_leads
    `);
    console.log('📊 DB counts:', counts.rows[0]);
  } catch (err) {
    console.error('❌ Database init failed:', err.message);
  }
}

module.exports = app;