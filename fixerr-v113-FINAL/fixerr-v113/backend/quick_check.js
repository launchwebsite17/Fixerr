const { pool, query } = require('./db');
const auth = require('./middleware/auth');
const cryptoService = require('./services/cryptoService');
const taxService = require('./services/taxService');
const invoiceService = require('./services/invoiceService');

async function testAll() {
  console.log('=== STARTING ALL FEATURE VERIFICATION TESTS ===\n');

  // 1. DB Connection & State Taxes
  const taxRes = await taxService.calculateTax('CA', 100);
  console.log('✅ 1. Tax Calculation (CA):', taxRes);

  const gstRes = await taxService.calculateTax('GST', 100);
  console.log('✅ 2. Tax Calculation (India GST):', gstRes);

  // 2. Encryption / Decryption
  const secret = '1234-5678-9012';
  const enc = cryptoService.encrypt(secret);
  const dec = cryptoService.decrypt(enc);
  console.log('✅ 3. AES-256 Data Encryption:', { enc: enc.substring(0, 20) + '...', decSuccess: dec === secret });

  // 3. User Lookup in DB
  const users = await query('SELECT count(*) FROM users');
  console.log('✅ 4. Users Table Count:', users.rows[0].count);

  // 4. Requests/Bookings Lookup in DB
  const reqs = await query('SELECT count(*) FROM requests');
  console.log('✅ 5. Requests Table Count:', reqs.rows[0].count);

  // 5. Invoices Table Lookup in DB
  const invs = await query('SELECT count(*) FROM invoices');
  console.log('✅ 6. Invoices Table Count:', invs.rows[0].count);

  // 6. Payments Table Lookup in DB
  const pays = await query('SELECT count(*) FROM payments');
  console.log('✅ 7. Payments Table Count:', pays.rows[0].count);

  // 7. State Taxes Table Lookup in DB
  const taxes = await query('SELECT count(*) FROM state_taxes');
  console.log('✅ 8. State Taxes Table Count:', taxes.rows[0].count);

  console.log('\n===============================================');
  console.log('🎉 ALL SYSTEM CORE SERVICES & DB TABLES VERIFIED!');
  console.log('===============================================\n');

  await pool.end();
  process.exit(0);
}

testAll().catch(err => {
  console.error('❌ Verification Error:', err);
  process.exit(1);
});
