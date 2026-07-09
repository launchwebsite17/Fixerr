// migrate.js — One-time migration from db.json to PostgreSQL
// Run with: node migrate.js
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const DB_FILE = path.join(__dirname, 'db.json');

async function runSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✅ Schema created/verified');
}

async function migrate() {
  if (!fs.existsSync(DB_FILE)) {
    console.log('No db.json found — nothing to migrate. Schema is ready for fresh use.');
    return;
  }
  const old = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const idMap = { users: {}, pros: {} }; // old id -> new id

  // Users
  for (const u of old.users || []) {
    const r = await pool.query(
      `INSERT INTO users (first,last,email,phone,hash,role,city,state,country,currency,zip,address,active,flagged,flagged_reason,cancellation_count,created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [u.first, u.last, u.email, u.phone, u.hash, u.role, u.city, u.state, u.country, u.currency,
       u.zip, u.address, u.active !== false, !!u.flagged, u.flagged_reason || null, u.cancellation_count || 0,
       u.created || new Date().toISOString()]
    );
    if (r.rows[0]) idMap.users[u.id] = r.rows[0].id;
  }
  console.log(`✅ Migrated ${Object.keys(idMap.users).length} users`);

  // Pros
  for (const p of old.pros || []) {
    const newUserId = idMap.users[p.user_id] || null;
    const r = await pool.query(
      `INSERT INTO pros (user_id,status,services,experience_map,years_exp,languages,bio,certifications,photo_url,
         id_type,id_number,aadhaar,pan,pricing_map,rate_inr,rate_usd,upi,zelle,venmo,bank,pay_methods,
         commission_agreed,liability_agreed,conduct_agreed,has_insurance,has_tools,rating,reviews,badge,available,flagged,created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING id`,
      [newUserId, p.status||'pending', JSON.stringify(p.services||[]), JSON.stringify(p.experience_map||{}),
       p.years_exp, p.languages, p.bio, p.certifications, p.photo_url||null,
       p.id_type, p.id_number, p.aadhaar||null, p.pan||null, JSON.stringify(p.pricing_map||{}),
       p.rate_inr||0, p.rate_usd||0, p.upi||null, p.zelle||null, p.venmo||null, p.bank||null,
       JSON.stringify(p.pay_methods||[]), !!p.commission_agreed, !!p.liability_agreed, !!p.conduct_agreed,
       !!p.has_insurance, !!p.has_tools, p.rating||4.8, p.reviews||0, p.badge||'Verified',
       !!p.available, !!p.flagged, p.created || new Date().toISOString()]
    );
    idMap.pros[p.id] = r.rows[0].id;
  }
  console.log(`✅ Migrated ${Object.keys(idMap.pros).length} pros`);

  // Requests
  let reqCount = 0;
  for (const req of old.requests || []) {
    const newUserId = idMap.users[req.user_id] || null;
    await pool.query(
      `INSERT INTO requests (ref,user_id,service_key,sub_service,custom_desc,preferred_pro,preferred_pro_id,
         assigned_pro_id,payment_method,preferred_date,preferred_time,address,city,state,zip,country,currency,
         customer_name,customer_phone,customer_email,access_notes,terms_agreed,estimate,commission,pro_earns,
         proposed_price,confirmed_price,status,pro_note,review_requested,review_done,created,updated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
       ON CONFLICT (ref) DO NOTHING`,
      [req.ref, newUserId, req.service_key, req.sub_service, req.custom_desc, req.preferred_pro,
       req.preferred_pro_id || null, req.assigned_pro_id || null, req.payment_method, req.preferred_date,
       req.preferred_time, req.address, req.city, req.state, req.zip, req.country, req.currency,
       req.customer_name, req.customer_phone, req.customer_email, req.access_notes, !!req.terms_agreed,
       req.estimate||0, req.commission||0, req.pro_earns||0, req.proposed_price||null, req.confirmed_price||null,
       req.status||'pending', req.pro_note||null, !!req.review_requested, !!req.review_done,
       req.created || new Date().toISOString(), req.updated || new Date().toISOString()]
    );
    reqCount++;
  }
  console.log(`✅ Migrated ${reqCount} requests`);

  // Messages
  let msgCount = 0;
  for (const m of old.messages || []) {
    await pool.query(
      `INSERT INTO messages ("from","to",booking_ref,content,created) VALUES ($1,$2,$3,$4,$5)`,
      [idMap.users[m.from]||null, idMap.users[m.to]||null, m.booking_ref, m.content, m.created || new Date().toISOString()]
    );
    msgCount++;
  }
  console.log(`✅ Migrated ${msgCount} messages`);

  // Reviews
  let revCount = 0;
  for (const rv of old.reviews || []) {
    await pool.query(
      `INSERT INTO reviews (booking_ref,customer,pro_id,rating,comment,created) VALUES ($1,$2,$3,$4,$5,$6)`,
      [rv.booking_ref, idMap.users[rv.customer]||null, idMap.pros[rv.pro_id]||null, rv.rating, rv.comment, rv.created || new Date().toISOString()]
    );
    revCount++;
  }
  console.log(`✅ Migrated ${revCount} reviews`);

  // Ads
  for (const a of old.ads || []) {
    await pool.query(
      `INSERT INTO ads (title,link,category,active,clicks,created) VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.title, a.link, a.category, a.active!==false, a.clicks||0, a.created || new Date().toISOString()]
    );
  }
  console.log(`✅ Migrated ${(old.ads||[]).length} ads`);

  // Ad leads
  for (const al of old.ad_leads || []) {
    await pool.query(
      `INSERT INTO ad_leads (company,name,email,phone,tier,category,message,status,quoted_price,admin_note,created,updated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [al.company, al.name, al.email, al.phone, al.tier, al.category, al.message, al.status||'pending',
       al.quoted_price||null, al.admin_note||null, al.created || new Date().toISOString(), al.updated||null]
    );
  }
  console.log(`✅ Migrated ${(old.ad_leads||[]).length} ad leads`);

  // Notifs
  for (const n of old.notifs || []) {
    await pool.query(
      `INSERT INTO notifs (type,msg,read,created) VALUES ($1,$2,$3,$4)`,
      [n.type, n.msg, !!n.read, n.created || new Date().toISOString()]
    );
  }
  console.log(`✅ Migrated ${(old.notifs||[]).length} notifications`);

  console.log('\n🎉 Migration complete! Your data is now in PostgreSQL.');
  console.log('Keep db.json as a backup but the app will now use Postgres.');
}

async function seedAdmin() {
  const bcrypt = require('bcryptjs');
  const existing = await pool.query("SELECT id FROM users WHERE email='admin@fixerr.com'");
  if(existing.rows.length){
    console.log('✅ Admin user already exists');
    return;
  }
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'CwSNbGdlr1Jl#ESL', 10);
  await pool.query(
    `INSERT INTO users (first,last,email,hash,role,city,state,country,currency,active)
     VALUES ('Admin','Fixerr','admin@fixerr.com',$1,'admin','Bengaluru','Karnataka','IN','INR',true)`,
    [hash]
  );
  console.log('✅ Admin user created — admin@fixerr.com');
}

async function main() {
  try {
    await runSchema();
    await seedAdmin();
    await migrate();
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
