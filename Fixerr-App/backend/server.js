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
const paymentGatewayRoutes = require('./routes/paymentGatewayRoutes');
const paymentGatewayController = require('./controllers/paymentGatewayController');

const app = express();
const PORT = env.PORT;

// Do not advertise the Express framework/version (fingerprinting hardening).
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Global Middleware
app.use(cors({ origin: '*' }));
// Stripe webhook needs the RAW, unparsed request body to verify its signature — must be
// registered here, before express.json() below, or Stripe's signature check will always fail.
app.post('/api/payment-gateway/webhook', express.raw({ type: 'application/json' }), paymentGatewayController.stripeWebhook);
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
app.use('/api', paymentGatewayRoutes);


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
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
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
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pro_id INTEGER`,
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
      )`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_transaction_id TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_status TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_response JSONB`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_response_at TIMESTAMPTZ`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_last4 TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_month INTEGER`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_exp_year INTEGER`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_type TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_error_code TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_error_message TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_name TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_address_line1 TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_address_line2 TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_city TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_state TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_zip TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_country TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS razorpay_signature TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_contact TEXT`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_email TEXT`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS doc1_type TEXT`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS doc1_url TEXT`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS doc2_type TEXT`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS doc2_url TEXT`,
      // Shared great-circle distance helper (km) — used by the admin "Pending Bookings" pro
      // matching logic instead of repeating the haversine formula inline in several queries.
      `CREATE OR REPLACE FUNCTION fx_distance_km(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC)
       RETURNS NUMERIC AS $$
         SELECT 6371 * acos(GREATEST(-1.0, LEAST(1.0,
           cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1)) +
           sin(radians(lat1)) * sin(radians(lat2))
         )))
       $$ LANGUAGE SQL IMMUTABLE`,
      // --- Invoice process fixes ---
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT`,
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'notpaid'`,
      // These two tables predate this codebase's schema.sql (columns existed on the live DB
      // with stale defaults from an older version) — force the correct default going forward.
      `ALTER TABLE invoices ALTER COLUMN payment_method DROP DEFAULT`,
      `ALTER TABLE invoices ALTER COLUMN payment_status SET DEFAULT 'notpaid'`,
      // One-time-safe corrective pass: recompute payment_status/payment_method for any invoice
      // whose stored value disagrees with the actual payments table (fixes rows created under
      // the old stale 'card'/'paid' defaults before this fix existed).
      `UPDATE invoices SET
         payment_status = CASE WHEN EXISTS (
           SELECT 1 FROM payments p WHERE p.booking_ref = invoices.booking_ref AND p.status = 'completed'
         ) THEN 'paid' ELSE 'notpaid' END,
         payment_method = CASE WHEN EXISTS (
           SELECT 1 FROM payments p WHERE p.booking_ref = invoices.booking_ref AND p.status = 'completed'
         ) THEN 'online_paid' ELSE payment_method END`,
      // Backfill tax_rate from the tax_breakdown JSON already stored per invoice, for rows
      // created before tax_rate was written directly to its own column.
      `UPDATE invoices SET tax_rate = (tax_breakdown->>'taxRate')::numeric
       WHERE tax_rate = 0 AND tax_breakdown IS NOT NULL AND (tax_breakdown->>'taxRate') IS NOT NULL`,
      // invoice_number and invoice_num were duplicate columns holding the same value — keep
      // invoice_number only (all code now reads/writes invoice_number exclusively).
      `ALTER TABLE invoices DROP COLUMN IF EXISTS invoice_num`,
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_pro TEXT`,

      // ---- Audit-column cleanup (ad_leads, pros, users, requests) ----
      // ad_leads.updated_at was a stray duplicate an earlier out-of-band migration added —
      // no code ever wrote to it (`updated` is the column actually maintained). Safe to drop.
      `ALTER TABLE ad_leads DROP COLUMN IF EXISTS updated_at`,

      // pros/requests already picked up created_at/updated_at from an earlier out-of-band
      // migration, alongside the original created/updated. Backfill the canonical columns
      // from the legacy ones first (created_at's DEFAULT now() only applied at ALTER time for
      // pre-existing rows, so it does NOT hold their true original creation time — `created`
      // does), then drop the legacy pair.
      `UPDATE pros SET created_at = created WHERE created_at IS DISTINCT FROM created`,
      `UPDATE pros SET updated_at = updated WHERE updated_at IS DISTINCT FROM updated`,
      `ALTER TABLE pros DROP COLUMN IF EXISTS created`,
      `ALTER TABLE pros DROP COLUMN IF EXISTS updated`,

      `UPDATE requests SET created_at = created WHERE created_at IS DISTINCT FROM created`,
      `UPDATE requests SET updated_at = updated WHERE updated_at IS DISTINCT FROM updated`,
      `ALTER TABLE requests DROP COLUMN IF EXISTS created`,
      `ALTER TABLE requests DROP COLUMN IF EXISTS updated`,

      // users never had created_at — rename created straight to created_at (preserves values
      // exactly; only errors — harmlessly, via the catch below — once already renamed).
      // updated_at already exists (same stray-migration situation as pros/requests above).
      `ALTER TABLE users RENAME COLUMN created TO created_at`,
      `UPDATE users SET updated_at = updated WHERE updated_at IS DISTINCT FROM updated`,
      `ALTER TABLE users DROP COLUMN IF EXISTS updated`
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
        UPDATE pros p SET reviews = sub.cnt, rating = sub.avg, updated_at = now()
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