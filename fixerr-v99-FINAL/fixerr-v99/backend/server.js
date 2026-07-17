// FIXERR BACKEND - PostgreSQL Edition
// Run: npm install && node server.js
// First time setup: node migrate.js (creates tables + migrates old db.json if present)
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, query } = require('./db');
const https = require('https');
const nodemailer = require('nodemailer');

// ── EMAIL SETUP (Zoho SMTP) ─────────────────────────────────
const mailer = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL || 'noreply@getfixerr.com',
    pass: process.env.ZOHO_PASSWORD || ''
  }
});

async function sendEmail(to, subject, html) {
  if(!process.env.ZOHO_PASSWORD){ console.log(`[EMAIL SKIP] To: ${to} | ${subject}`); return; }
  try {
    await mailer.sendMail({
      from: '"Fixerr" <noreply@getfixerr.com>',
      replyTo: 'support@getfixerr.com',
      to, subject, html
    });
    console.log(`[EMAIL SENT] To: ${to} | ${subject}`);
  } catch(e){ console.error('[EMAIL ERROR]', e.message); }
}

// Email templates
const EMAIL = {
  welcome: (name) => ({
    subject: 'Welcome to Fixerr! 🎉',
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h2 style="color:#3D8B37;">Welcome to Fixerr, ${name}!</h2>
      <p>Your account has been created successfully. You can now book home services across India and the US.</p>
      <p><strong>Pay only after the job is done.</strong> We call you within 2 hours to confirm.</p>
      <a href="https://getfixerr.com/booking.html" style="background:#3D8B37;color:#fff;padding:0.75rem 1.5rem;border-radius:50px;text-decoration:none;display:inline-block;margin-top:1rem;">Book a Service →</a>
      <hr style="margin:2rem 0;border:none;border-top:1px solid #eee;">
      <p style="color:#6B7280;font-size:0.85rem;">Questions? Email us at <a href="mailto:support@getfixerr.com">support@getfixerr.com</a></p>
    </div>`
  }),
  proReceived: (name) => ({
    subject: 'Application Received — Fixerr Professional',
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h2 style="color:#3D8B37;">Hi ${name}, we received your application!</h2>
      <p>Our team will review your details and contact you within <strong>24 hours</strong>.</p>
      <p><strong>What happens next:</strong></p>
      <ol><li>We verify your identity and documents</li><li>Application approved or feedback given</li><li>Once approved, you start receiving bookings</li></ol>
      <hr style="margin:2rem 0;border:none;border-top:1px solid #eee;">
      <p style="color:#6B7280;font-size:0.85rem;">Questions? Email <a href="mailto:support@getfixerr.com">support@getfixerr.com</a></p>
    </div>`
  }),
  proApproved: (name) => ({
    subject: `🎉 You're approved — Welcome to Fixerr Professionals!`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h2 style="color:#3D8B37;">Congratulations ${name}!</h2>
      <p>Your professional application has been <strong>approved</strong>. You can now log in and start receiving bookings.</p>
      <a href="https://getfixerr.com/login.html" style="background:#3D8B37;color:#fff;padding:0.75rem 1.5rem;border-radius:50px;text-decoration:none;display:inline-block;margin-top:1rem;">Log In to Dashboard →</a>
      <hr style="margin:2rem 0;border:none;border-top:1px solid #eee;">
      <p style="color:#6B7280;font-size:0.85rem;">Support: <a href="mailto:support@getfixerr.com">support@getfixerr.com</a></p>
    </div>`
  }),
  bookingConfirmed: (name, service, date) => ({
    subject: `Booking Confirmed — ${service}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
      <h2 style="color:#3D8B37;">Booking Confirmed, ${name}!</h2>
      <p>Your <strong>${service}</strong> booking for <strong>${date}</strong> is confirmed.</p>
      <p>Our team will call you within 2 hours to finalize details. <strong>Pay only after the job is done.</strong></p>
      <a href="https://getfixerr.com/dashboard.html" style="background:#3D8B37;color:#fff;padding:0.75rem 1.5rem;border-radius:50px;text-decoration:none;display:inline-block;margin-top:1rem;">View My Bookings →</a>
      <hr style="margin:2rem 0;border:none;border-top:1px solid #eee;">
      <p style="color:#6B7280;font-size:0.85rem;">Support: <a href="mailto:support@getfixerr.com">support@getfixerr.com</a></p>
    </div>`
  }),
};

// Geocode city to lat/lng using free OpenStreetMap Nominatim API (no key needed)
async function geocodeCity(cityOrZip, state, country, city) {
  return new Promise((resolve) => {
    // If ZIP provided, search by ZIP+city for 2-3km precision vs 20-30km for city name
    const parts = city
      ? [cityOrZip, city, state, country==='IN'?'India':'United States']  // ZIP + city
      : [cityOrZip, state, country==='IN'?'India':'United States'];        // city only
    const q = encodeURIComponent(parts.filter(Boolean).join(', '));
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=1`;
    const req = https.get(url, { headers: { 'User-Agent': 'FixerrApp/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results.length > 0) {
            resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) });
          } else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fixerr-secret-2024-change-in-production';

function uid_ref(p) { return p+'-'+Date.now().toString().slice(-6)+'-'+Math.floor(Math.random()*9000+1000); }

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

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors({origin:'*'}));
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true, limit:'50mb'}));
app.use(express.static(path.join(__dirname,'../frontend')));

// ── RATE LIMITING (in-memory, no extra dependencies) ────────
const rateLimitStore = {};
function rateLimit(windowMs, maxRequests, label) {
  return (req, res, next) => {
    const key = label + ':' + (req.ip || req.connection.remoteAddress || 'unknown');
    const now = Date.now();
    if (!rateLimitStore[key]) rateLimitStore[key] = [];
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < windowMs);
    if (rateLimitStore[key].length >= maxRequests) {
      const retryAfterSec = Math.ceil((windowMs - (now - rateLimitStore[key][0])) / 1000);
      return res.status(429).json({ error: `Too many requests. Please try again in ${retryAfterSec} seconds.` });
    }
    rateLimitStore[key].push(now);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(key => {
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < 15 * 60 * 1000);
    if (!rateLimitStore[key].length) delete rateLimitStore[key];
  });
}, 5 * 60 * 1000);

const authLimiter = rateLimit(15 * 60 * 1000, 30, 'auth');
const bookingLimiter = rateLimit(60 * 60 * 1000, 20, 'booking');
const generalLimiter = rateLimit(60 * 1000, 60, 'general');

function noContact(txt) {
  return /\b\d{10}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|@\w+\.\w+|whatsapp|telegram/i.test(txt);
}

function esc(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function sanitizeMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const clean = (obj) => {
      for (const k in obj) {
        if (typeof obj[k] === 'string') obj[k] = esc(obj[k]);
        else if (typeof obj[k] === 'object' && obj[k] !== null) clean(obj[k]);
      }
    };
    clean(req.body);
  }
  next();
}
app.use('/api/', generalLimiter);
app.use('/api/', sanitizeMiddleware);

function auth(req,res,next) {
  const t = req.headers.authorization?.split(' ')[1];
  if(!t) return res.status(401).json({error:'Please log in.'});
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Session expired. Please log in again.'}); }
}
function optionalAuth(req,res,next) {
  const t = req.headers.authorization?.split(' ')[1];
  if(t){try{req.user=jwt.verify(t,JWT_SECRET);}catch{}}
  next();
}
function admin(req,res,next) {
  if(req.user?.role !== 'admin') return res.status(403).json({error:'Admin only.'});
  next();
}

// ── AUTH ──────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req,res) => {
  try {
    const {firstName,lastName,email,phone,password,role,city,state,country,currency,address,zip,lat,lng} = req.body;
    if(!firstName||!lastName||!email||!password) return res.status(400).json({error:'All fields are required.'});
    if(password.length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
    const existing = await query('SELECT id FROM users WHERE email=$1',[email]);
    if(existing.rows.length) return res.status(400).json({error:'An account with this email already exists.'});
    const hash = bcrypt.hashSync(password,10);
    const r = await query(
      `INSERT INTO users (first,last,email,phone,hash,role,city,state,country,currency,address,zip,lat,lng,active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,0) RETURNING id,first,role,currency,country`,
      [firstName,lastName,email,phone||'',hash,role||'customer',city||'',state||'',country||'US',currency||'USD',address||'',zip||'',
       lat||null, lng||null]
    );
    const u = r.rows[0];
    // Geocode from city+ZIP if GPS not provided
    if(!lat && city){
      const geo = await geocodeCity(zip||city, state, country, zip?city:null).catch(()=>null);
      if(geo){
        await query('UPDATE users SET lat=$1, lng=$2 WHERE id=$3',[geo.lat, geo.lng, u.id]).catch(()=>{});
      }
    }
    const token = jwt.sign({id:u.id, email, role:u.role}, JWT_SECRET, {expiresIn:'30d'});
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',[
      'welcome', `New ${u.role} registered: ${u.first} (${email})`
    ]).catch(()=>{});
    // Send welcome email
    const welcomeTpl = EMAIL.welcome(u.first);
    sendEmail(email, welcomeTpl.subject, welcomeTpl.html);
    res.json({success:true, token, userId:u.id, role:u.role, name:u.first, currency:u.currency, country:u.country, welcome:`Welcome to Fixerr, ${u.first}! Your account is ready.`});
  } catch(e) { console.error(e); res.status(500).json({error:'Registration failed. Please try again.'}); }
});

app.post('/api/auth/login', authLimiter, async (req,res) => {
  try {
    const {email, password, expected_role} = req.body;
    if(!email||!password) return res.status(400).json({error:'Email and password required.'});
    const r = await query('SELECT * FROM users WHERE email=$1 AND active=true',[email]);
    const u = r.rows[0];
    if(!u) return res.status(401).json({error:'No account found with this email. Please sign up.'});
    if(!bcrypt.compareSync(password, u.hash))
      return res.status(401).json({error:'Incorrect password. Please try again.'});
    if(expected_role && u.role !== 'admin' && u.role !== expected_role){
      return res.status(403).json({error:`This email is registered as a ${u.role==='professional'?'Professional':'Customer'} account. Please select the ${u.role==='professional'?'Professional':'Customer'} tab to log in.`});
    }
    const token = jwt.sign({id:u.id, email:u.email, role:u.role}, JWT_SECRET, {expiresIn:'30d'});
    res.json({success:true, token, userId:u.id, role:u.role, name:u.first, currency:u.currency, country:u.country});
  } catch(e) { console.error(e); res.status(500).json({error:'Login failed. Please try again.'}); }
});

app.get('/api/auth/me', auth, async (req,res) => {
  try {
    const r = await query('SELECT * FROM users WHERE id=$1',[req.user.id]);
    const u = r.rows[0];
    if(!u) return res.status(404).json({error:'User not found.'});
    const {hash,...safe} = u;
    if(u.role==='professional'){
      const pr = await query('SELECT status, available FROM pros WHERE user_id=$1',[u.id]);
      const pro = pr.rows[0];
      safe.pro_status = pro ? pro.status : 'pending';
      safe.pro_available = pro ? !!pro.available : false;
    }
    res.json(safe);
  } catch(e) { console.error(e); res.status(500).json({error:'Could not load profile.'}); }
});

// ── CITIES ────────────────────────────────────────────────
app.get('/api/cities', (req,res) => {
  const {q=''} = req.query;
  const raw = require('./cities.json');
  // Normalise to short-key format {n,st,c,f,cur,sym} matching frontend CITIES array
  const CITIES = raw.map(c=>({
    n: c.name||c.n, st: c.state||c.st||'',
    c: c.country||c.c, f: c.flag||c.f||'',
    cur: c.currency||c.cur, sym: c.symbol||c.sym
  }));
  const q2 = q.toLowerCase();
  res.json(CITIES.filter(c =>
    c.n.toLowerCase().includes(q2) ||
    (c.st||'').toLowerCase().includes(q2)
  ).slice(0,12));
});

// ── PRICES ────────────────────────────────────────────────
app.get('/api/prices', (req,res) => res.json(PRICES));

// Public pros listing - filtered by city + category
app.get('/api/pros', async (req,res) => {
  try {
    const {city, country, category, lat, lng} = req.query;
    let sql = `SELECT p.*, u.first, u.last, u.city as user_city, u.state, u.country as user_country, u.lat, u.lng
               FROM pros p JOIN users u ON p.user_id=u.id
               WHERE p.status='approved' AND p.available=true`;
    const params = [];
    if(country){ params.push(country); sql += ` AND u.country=$${params.length}`; }
    // Geo-match: if customer lat/lng available, use 25km Haversine radius
    // Otherwise fall back to exact city name match
    if(lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))){
      params.push(parseFloat(lat), parseFloat(lng));
      sql += ` AND u.lat IS NOT NULL AND u.lng IS NOT NULL
               AND (6371 * acos(LEAST(1.0,
                 cos(radians($${params.length-1})) * cos(radians(u.lat::numeric)) *
                 cos(radians(u.lng::numeric) - radians($${params.length})) +
                 sin(radians($${params.length-1})) * sin(radians(u.lat::numeric))
               ))) <= COALESCE(p.service_radius, 25)`;
    } else if(city){
      params.push(city.toLowerCase());
      sql += ` AND LOWER(TRIM(u.city))=$${params.length}`;
    }
    const r = await query(sql, params);
    let pros = r.rows.map(p => ({
      id: p.id,
      user_id: p.user_id,
      name: (p.first||'')+' '+(p.last||''),
      initials: ((p.first||'?')[0]+(p.last||'?')[0]).toUpperCase(),
      city: p.user_city||'', state: p.state||'', country: p.user_country||'',
      services: p.services||[],
      bio: p.bio||'', years_exp: p.years_exp||0,
      rating: p.rating||4.8, reviews: p.reviews||0,
      badge: p.badge||'Verified',
      rate_inr: p.rate_inr||0, rate_usd: p.rate_usd||0,
      languages: p.languages||'English',
      available: p.available
    }));
    if(category && category!=='all') pros = pros.filter(p => Array.isArray(p.services) && p.services.includes(category));
    res.json(pros);
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load professionals.'}); }
});

// ── BOOKINGS ──────────────────────────────────────────────
app.post('/api/requests', bookingLimiter, optionalAuth, async (req,res) => {
  try {
    const {serviceKey,subService,customDesc,preferredPro,preferredProId,paymentMethod,date,time,address,city,state,zip,
      country,currency,name,phone,email,notes,termsAgreed} = req.body;
    if(!serviceKey) return res.status(400).json({error:'Service category is required.'});
    if(!name||!phone) return res.status(400).json({error:'Name and phone are required.'});
    if(!termsAgreed) return res.status(400).json({error:'You must agree to the terms to continue.'});

    const isIndia = country==='IN';
    const p = PRICES[serviceKey]||PRICES.other;
    const est = isIndia ? p.inr.base : p.usd.base;
    const comm = Math.round(est * 0.15);
    const proEarns = est - comm;
    const reference = uid_ref('BK');

    const r = await query(
      `INSERT INTO requests (ref,user_id,service_key,sub_service,custom_desc,preferred_pro,preferred_pro_id,
         payment_method,preferred_date,preferred_time,address,city,state,zip,country,currency,
         customer_name,customer_phone,customer_email,access_notes,terms_agreed,estimate,commission,pro_earns,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'pending')
       RETURNING *`,
      [reference, req.user?.id||null, serviceKey, subService||null, customDesc||null, preferredPro||null,
       preferredProId||null, paymentMethod||'cash', date||null, time||null, address||'', city||'', state||'',
       zip||'', country||'US', currency||'USD', name, phone, email||null, notes||null, true, est, comm, proEarns]
    );
    res.json({success:true, ref:reference, estimate:est, currency:isIndia?'INR':'USD', commission:comm, proEarns});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not submit booking. Please try again.'}); }
});

app.get('/api/requests', auth, async (req,res) => {
  try {
    if(req.user.role==='admin'){
      const r = await query(`
        SELECT req.*, u.flagged as customer_flagged, u.cancellation_count as customer_cancel_count
        FROM requests req LEFT JOIN users u ON req.user_id=u.id
        ORDER BY req.created DESC`);
      return res.json(r.rows);
    }
    const r = await query('SELECT * FROM requests WHERE user_id=$1 ORDER BY created DESC',[req.user.id]);
    // Enrich with assigned pro info
    const enriched = await Promise.all(r.rows.map(async (row) => {
      let pro_info = {};
      if(row.assigned_pro_id){
        const pu = await query('SELECT first,last,phone FROM users WHERE id=$1',[row.assigned_pro_id]);
        if(pu.rows[0]) pro_info = {assigned_pro_name: pu.rows[0].first+' '+pu.rows[0].last, assigned_pro_phone: row.status==='confirmed'?pu.rows[0].phone:null};
      }
      return {...row, ...pro_info};
    }));
    res.json(enriched);
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load bookings.'}); }
});

// Admin updates booking (status, price, assign pro)
app.patch('/api/requests/:id', auth, admin, async (req,res) => {
  try {
    const id = +req.params.id;
    const existing = await query('SELECT * FROM requests WHERE id=$1',[id]);
    if(!existing.rows[0]) return res.status(404).json({error:'Not found.'});
    const updates = {...req.body};
    if(updates.proposed_price || updates.confirmed_price){
      const finalPrice = updates.confirmed_price || updates.proposed_price || existing.rows[0].confirmed_price || existing.rows[0].proposed_price;
      if(finalPrice){ updates.commission = Math.round(finalPrice*0.15); updates.pro_earns = Math.round(finalPrice*0.85); }
    }
    if(updates.status === 'completed') updates.review_requested = true;

    const fields = Object.keys(updates);
    if(!fields.length) return res.json({success:true});
    const setClauses = fields.map((f,i) => `${f}=$${i+1}`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);
    await query(`UPDATE requests SET ${setClauses}, updated=now() WHERE id=$${values.length}`, values);
    const updated = await query('SELECT * FROM requests WHERE id=$1',[id]);
    res.json({success:true, commission: updated.rows[0].commission, pro_earns: updated.rows[0].pro_earns});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not update booking.'}); }
});

// Customer updates own booking (cancel or approve price)
app.patch('/api/requests/ref/:ref', auth, async (req,res) => {
  try {
    const existing = await query('SELECT * FROM requests WHERE ref=$1 AND user_id=$2',[req.params.ref, req.user.id]);
    if(!existing.rows[0]) return res.status(404).json({error:'Booking not found.'});
    const {status, confirmed_price} = req.body;
    const allowed = ['cancelled','confirmed'];
    if(status && !allowed.includes(status)) return res.status(400).json({error:'Invalid status update.'});
    if(status==='cancelled' && !['pending','price_proposed'].includes(existing.rows[0].status))
      return res.status(400).json({error:'This booking cannot be cancelled at this stage.'});

    if(status) await query('UPDATE requests SET status=$1, updated=now() WHERE ref=$2',[status, req.params.ref]);
    if(confirmed_price) await query('UPDATE requests SET confirmed_price=$1, updated=now() WHERE ref=$2',[confirmed_price, req.params.ref]);

    if(status==='cancelled'){
      const ur = await query('UPDATE users SET cancellation_count=COALESCE(cancellation_count,0)+1 WHERE id=$1 RETURNING *',[req.user.id]);
      const u = ur.rows[0];
      const CANCEL_THRESHOLD = 3;
      if(u.cancellation_count >= CANCEL_THRESHOLD && !u.flagged){
        await query('UPDATE users SET flagged=true, flagged_reason=$1 WHERE id=$2',[`Cancelled ${u.cancellation_count} bookings`, u.id]);
        await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',['flag', `⚠️ Customer ${u.first} ${u.last} flagged — ${u.cancellation_count} cancellations`]);
      }
    }
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not update booking.'}); }
});

// ── PRO BOOKINGS ──────────────────────────────────────────
app.get('/api/pro/bookings', auth, async (req,res) => {
  try {
    const ur = await query('SELECT * FROM users WHERE id=$1',[req.user.id]);
    const u = ur.rows[0];
    if(!u) return res.status(404).json({error:'User not found.'});
    const fullName = ((u.first||'')+' '+(u.last||'')).toLowerCase().trim();
    const firstName = (u.first||'').toLowerCase();
    const initials = ((u.first||'')[0]||'').toLowerCase()+((u.last||'')[0]||'').toLowerCase();
    const r = await query(
      `SELECT * FROM requests
       WHERE assigned_pro_id=$1
          OR preferred_pro_id=$1
          OR LOWER(TRIM(COALESCE(preferred_pro,'')))=LOWER(TRIM($2))
          OR LOWER(TRIM(COALESCE(preferred_pro,'')))=$3
          OR LOWER(TRIM(COALESCE(preferred_pro,''))) LIKE $4||'%'
       ORDER BY created DESC`,
      [req.user.id, fullName, initials, firstName]
    );
    res.json(r.rows);
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load bookings.'}); }
});

app.patch('/api/pro/bookings/:ref', auth, async (req,res) => {
  try {
    const ur = await query('SELECT * FROM users WHERE id=$1',[req.user.id]);
    const u = ur.rows[0];
    if(!u||u.role!=='professional') return res.status(403).json({error:'Professionals only.'});
    const existing = await query('SELECT * FROM requests WHERE ref=$1',[req.params.ref]);
    if(!existing.rows[0]) return res.status(404).json({error:'Booking not found.'});
    const allowed=['accepted','declined','in_progress','completed'];
    if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Invalid status.'});

    const updates = {status:req.body.status};
    if(req.body.status==='completed') updates.review_requested = true;
    if(req.body.pro_note) updates.pro_note = req.body.pro_note;
    const fields = Object.keys(updates);
    const setClauses = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
    const values = fields.map(f=>updates[f]);
    values.push(req.params.ref);
    await query(`UPDATE requests SET ${setClauses}, updated=now() WHERE ref=$${values.length}`, values);

    if(req.body.status==='declined'){
      const cur = await query('UPDATE users SET cancellation_count=COALESCE(cancellation_count,0)+1 WHERE id=$1 RETURNING *',[req.user.id]);
      const uu = cur.rows[0];
      const CANCEL_THRESHOLD = 3;
      if(uu.cancellation_count >= CANCEL_THRESHOLD && !uu.flagged){
        await query('UPDATE users SET flagged=true, flagged_reason=$1 WHERE id=$2',[`Declined ${uu.cancellation_count} bookings`, uu.id]);
        await query('UPDATE pros SET flagged=true WHERE user_id=$1',[uu.id]);
        await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',['flag', `⚠️ Professional ${uu.first} ${uu.last} flagged — ${uu.cancellation_count} declines`]);
      }
    }
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not update booking.'}); }
});

// ── PROFESSIONAL APPLICATION ──────────────────────────────
app.post('/api/pro-application', auth, async (req,res) => {
  try {
    if(!req.body.commission_agreed) return res.status(400).json({error:'You must agree to the Commission Agreement to submit your application.'});
    if(!req.body.liability_agreed) return res.status(400).json({error:'You must agree to the liability terms to submit your application.'});
    const b = req.body;
    // Add documents column if not exists
    await query(`ALTER TABLE pros ADD COLUMN IF NOT EXISTS documents JSONB DEFAULT '[]'`).catch(()=>{});
    await query(`ALTER TABLE pros ADD COLUMN IF NOT EXISTS upi TEXT`).catch(()=>{});
    await query(`ALTER TABLE pros ADD COLUMN IF NOT EXISTS zelle TEXT`).catch(()=>{});
    await query(`ALTER TABLE pros ADD COLUMN IF NOT EXISTS venmo TEXT`).catch(()=>{});
    // Store document metadata (name, size, type) — not the full base64 to avoid DB bloat
    // For soft launch: store file names + metadata; full data can go to S3 later
    const docMeta = (b.documents||[]).map(d=>({name:d.name,size:d.size,type:d.type,uploaded:new Date().toISOString()}));
    const r = await query(
      `INSERT INTO pros (user_id,services,experience_map,years_exp,languages,bio,certifications,id_type,id_number,
         aadhaar,pan,pricing_map,rate_inr,rate_usd,upi,zelle,venmo,bank,pay_methods,commission_agreed,liability_agreed,
         conduct_agreed,has_insurance,has_tools,documents,service_radius,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'pending')
       RETURNING id`,
      [req.user.id, JSON.stringify(b.services||[]), JSON.stringify(b.experience_map||{}), b.years_exp||'',
       b.languages||'', b.bio||'', b.certifications||'', b.id_type||'', b.id_number||'', b.aadhaar||null, b.pan||null,
       JSON.stringify(b.pricing_map||{}), parseFloat(b.starting_rate)||0, parseFloat(b.starting_rate)||0,
       b.upi||null, b.zelle||null, b.venmo||null, b.bank||null, JSON.stringify(b.pay_methods||[]),
       true, true, !!b.conduct_agreed, !!b.has_insurance, !!b.has_tools, JSON.stringify(docMeta), parseInt(b.service_radius)||25]
    );
    // Geocode pro city for proximity matching
    const proUser = await query('SELECT city, state, country FROM users WHERE id=$1',[req.user.id]);
    if(proUser.rows[0]){
      // Use ZIP code for more precise geocoding (2-3km accuracy vs 20-30km for city name)
      const zip = b.zip || proUser.rows[0].zip || '';
      const geo = await geocodeCity(
        zip ? zip : proUser.rows[0].city,
        proUser.rows[0].state,
        proUser.rows[0].country,
        zip ? proUser.rows[0].city : null
      );
      if(geo){
        await query('UPDATE users SET lat=$1, lng=$2 WHERE id=$3',[geo.lat, geo.lng, req.user.id]).catch(()=>{});
        console.log(`Geocoded pro ${req.user.id}: ${geo.lat}, ${geo.lng}`);
      }
    }
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',['pro_application',
      `New pro application from user ${req.user.id}. Documents: ${docMeta.map(d=>d.name).join(', ')||'none'}`]);
    // Send confirmation email to pro
    const proUser2 = await query('SELECT first, email FROM users WHERE id=$1',[req.user.id]).catch(()=>({rows:[]}));
    if(proUser2.rows[0]){
      const tpl = EMAIL.proReceived(proUser2.rows[0].first);
      sendEmail(proUser2.rows[0].email, tpl.subject, tpl.html);
    }
    res.json({success:true, id:r.rows[0].id});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not submit application. '+e.message}); }
});

app.get('/api/admin/pros', auth, admin, async (req,res) => {
  try {
    const {status} = req.query;
    let sql = `SELECT p.*, u.first, u.last, u.email, u.phone, u.city, u.country, u.created as user_created
               FROM pros p JOIN users u ON p.user_id=u.id`;
    const params = [];
    if(status){ params.push(status); sql += ` WHERE p.status=$1`; }
    sql += ' ORDER BY p.created DESC';
    const r = await query(sql, params);
    res.json(r.rows.map(p=>({...p, created:p.created})));
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load professionals.'}); }
});

app.patch('/api/admin/pros/:id', auth, admin, async (req,res) => {
  try {
    const {status} = req.body;
    const r = await query('UPDATE pros SET status=$1, available=$2 WHERE id=$3 RETURNING *',
      [status, status==='approved', +req.params.id]);
    if(!r.rows[0]) return res.status(404).json({error:'Not found.'});
    // Send approval email
    if(status==='approved'){
      const u = await query('SELECT u.first, u.email FROM users u JOIN pros p ON p.user_id=u.id WHERE p.id=$1',[+req.params.id]).catch(()=>({rows:[]}));
      if(u.rows[0]){ const tpl=EMAIL.proApproved(u.rows[0].first); sendEmail(u.rows[0].email, tpl.subject, tpl.html); }
    }
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not update professional.'}); }
});

// ── MESSAGES ──────────────────────────────────────────────
app.post('/api/messages', auth, async (req,res) => {
  try {
    const {to,booking_ref,content} = req.body;
    if(!content?.trim()) return res.status(400).json({error:'Message cannot be empty.'});
    if(noContact(content)) return res.status(400).json({
      error:'Please keep contact details (phone numbers, emails) within the platform for your safety.'
    });
    const r = await query(
      `INSERT INTO messages ("from","to",booking_ref,content) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, to||null, booking_ref||null, content.trim()]
    );
    res.json({success:true, message:r.rows[0]});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not send message.'}); }
});

app.get('/api/messages/:ref', auth, async (req,res) => {
  try {
    const r = await query('SELECT * FROM messages WHERE booking_ref=$1 ORDER BY created ASC',[req.params.ref]);
    res.json(r.rows);
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load messages.'}); }
});

// ── REVIEWS ───────────────────────────────────────────────
app.post('/api/reviews', auth, async (req,res) => {
  try {
    const {booking_ref,rating,comment,pro_id} = req.body;
    if(!rating||rating<1||rating>5) return res.status(400).json({error:'Rating must be 1-5.'});
    const existing = await query('SELECT id FROM reviews WHERE booking_ref=$1 AND customer=$2',[booking_ref, req.user.id]);
    if(existing.rows.length) return res.status(400).json({error:'You have already reviewed this booking.'});
    await query(
      `INSERT INTO reviews (booking_ref,customer,pro_id,rating,comment) VALUES ($1,$2,$3,$4,$5)`,
      [booking_ref, req.user.id, pro_id||null, rating, comment||'']
    );
    await query('UPDATE requests SET review_done=true WHERE ref=$1',[booking_ref]);
    // Update pro rating - find pro record by pros.id or by user_id
    let resolvedProId = pro_id;
    if(!resolvedProId){
      // Try to get pro from booking's assigned_pro_id (which is a user_id)
      const bk = await query('SELECT assigned_pro_id FROM requests WHERE ref=$1',[booking_ref]);
      if(bk.rows[0]?.assigned_pro_id){
        const pr = await query('SELECT id FROM pros WHERE user_id=$1',[bk.rows[0].assigned_pro_id]);
        resolvedProId = pr.rows[0]?.id;
      }
    }
    if(resolvedProId){
      const avgR = await query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM reviews WHERE pro_id=$1',[resolvedProId]);
      await query('UPDATE pros SET rating=$1, reviews=$2 WHERE id=$3',[avgR.rows[0].avg, avgR.rows[0].cnt, resolvedProId]);
    }
    res.json({success:true, message:'Review submitted — thank you!'});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not submit review.'}); }
});

// ── ADS ───────────────────────────────────────────────────
app.get('/api/ads', async (req,res) => {
  try { const r = await query('SELECT * FROM ads WHERE active=true ORDER BY created DESC'); res.json(r.rows); }
  catch(e){ console.error(e); res.status(500).json({error:'Could not load ads.'}); }
});

app.post('/api/ads/click/:id', async (req,res) => {
  try { await query('UPDATE ads SET clicks=clicks+1 WHERE id=$1',[+req.params.id]); res.json({success:true}); }
  catch(e){ res.status(500).json({error:'Could not log click.'}); }
});

app.post('/api/ads/inquire', auth, async (req,res) => {
  try {
    const b = req.body;
    if(!b.company||!b.name||!b.email) return res.status(400).json({error:'Company name, contact name and email are required.'});
    // Add user_id column if it doesn't exist (safe migration)
    await query(`ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`).catch(()=>{});
    await query(`ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS country TEXT`).catch(()=>{});
    await query(`ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS currency TEXT`).catch(()=>{});
    const r = await query(
      `INSERT INTO ad_leads (company,name,email,phone,tier,category,message,status,user_id,country,currency) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) RETURNING id`,
      [b.company||'', b.name||'', b.email||'', b.phone||'', b.tier||'', b.category||'', b.message||'', req.user.id, b.country||'US', b.currency||'USD']
    );
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',['ad_lead', `New ad inquiry from ${b.company||'unknown'} — ${b.tier||'custom'} tier`]);
    res.json({success:true, inquiry_id:r.rows[0].id, message:'Inquiry received! We will contact you within 24 hours.'});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not submit inquiry.'}); }
});

app.get('/api/ads/my', auth, async (req,res) => {
  try {
    const r = await query('SELECT * FROM ad_leads WHERE user_id=$1 ORDER BY created DESC',[req.user.id]);
    res.json(r.rows);
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load inquiries.'}); }
});

app.patch('/api/ads/my/:id', auth, async (req,res) => {
  try {
    const existing = await query('SELECT * FROM ad_leads WHERE id=$1 AND user_id=$2',[+req.params.id, req.user.id]);
    if(!existing.rows[0]) return res.status(404).json({error:'Inquiry not found.'});
    if(existing.rows[0].status==='active') return res.status(400).json({error:'Active ads cannot be cancelled. Please contact support.'});
    await query('UPDATE ad_leads SET status=$1, updated=now() WHERE id=$2',['cancelled', +req.params.id]);
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not cancel inquiry.'}); }
});

app.patch('/api/admin/ad-leads/:id', auth, admin, async (req,res) => {
  try {
    const updates = req.body;
    const fields = Object.keys(updates);
    if(!fields.length) return res.json({success:true});
    const setClauses = fields.map((f,i)=>`${f}=$${i+1}`).join(', ');
    const values = fields.map(f=>updates[f]);
    values.push(+req.params.id);
    await query(`UPDATE ad_leads SET ${setClauses}, updated=now() WHERE id=$${values.length}`, values);
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not update inquiry.'}); }
});

app.get('/api/admin/ad-leads', auth, admin, async (req,res) => {
  try { const r = await query('SELECT * FROM ad_leads ORDER BY created DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:'Could not load inquiries.'}); }
});

app.get('/api/admin/ads', auth, admin, async (req,res) => {
  try { const r = await query('SELECT * FROM ads ORDER BY created DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:'Could not load ads.'}); }
});

app.post('/api/admin/ads', auth, admin, async (req,res) => {
  try {
    const {title,link,category} = req.body;
    const r = await query('INSERT INTO ads (title,link,category,active) VALUES ($1,$2,$3,true) RETURNING *',[title,link,category]);
    res.json({success:true, ad:r.rows[0]});
  } catch(e){ res.status(500).json({error:'Could not create ad.'}); }
});

app.patch('/api/admin/ads/:id', auth, admin, async (req,res) => {
  try {
    const {active} = req.body;
    await query('UPDATE ads SET active=$1 WHERE id=$2',[active, +req.params.id]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:'Could not update ad.'}); }
});

// ── CUSTOM REQUESTS ───────────────────────────────────────
app.get('/api/admin/custom', auth, admin, async (req,res) => {
  try { const r = await query('SELECT * FROM custom_requests ORDER BY created DESC'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:'Could not load custom requests.'}); }
});

app.patch('/api/admin/custom/:id', auth, admin, async (req,res) => {
  try {
    const {status} = req.body;
    await query('UPDATE custom_requests SET status=$1 WHERE id=$2',[status, +req.params.id]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:'Could not update.'}); }
});

// ── ADMIN STATS ───────────────────────────────────────────
app.get('/api/admin/stats', auth, admin, async (req,res) => {
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
  } catch(e){ console.error(e); res.status(500).json({error:'Could not load stats.'}); }
});

app.get('/api/admin/notifs', auth, admin, async (req,res) => {
  try { const r = await query('SELECT * FROM notifs ORDER BY created DESC LIMIT 50'); res.json(r.rows); }
  catch(e){ res.status(500).json({error:'Could not load notifications.'}); }
});

app.patch('/api/admin/notifs/read-all', auth, admin, async (req,res) => {
  try { await query('UPDATE notifs SET read=true WHERE read=false'); res.json({success:true}); }
  catch(e){ res.status(500).json({error:'Could not update notifications.'}); }
});

// Admin DB viewer — query live tables for testing/debugging
app.get('/api/admin/db-view', auth, admin, async (req,res) => {
  try {
    const {collection='users'} = req.query;
    const allowed = {
      users: 'users', pros: 'pros', requests: 'requests',
      messages: 'messages', reviews: 'reviews', ads: 'ads',
      ad_leads: 'ad_leads', notifs: 'notifs'
    };
    if(!allowed[collection]) return res.status(400).json({error:'Invalid collection'});
    const r = await query(`SELECT * FROM ${allowed[collection]} ORDER BY created DESC LIMIT 200`);
    let data = r.rows;
    if(collection==='users') data = data.map(({hash,...u})=>u);
    res.json({collection, count:data.length, data});
  } catch(e){ console.error(e); res.status(500).json({error:'Could not query database.'}); }
});

// Public stats for home page
app.get('/api/stats/public', async (req,res) => {
  try {
    const r = await query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='customer') as customers,
        (SELECT COUNT(*) FROM pros WHERE status='approved') as pros,
        (SELECT COUNT(*) FROM requests WHERE status='completed') as jobs
    `);
    res.json(r.rows[0]);
  } catch(e){ res.json({customers:0,pros:0,jobs:0}); }
});

app.get('/api/health', async (req,res) => {
  try {
    const users = await query('SELECT COUNT(*) FROM users');
    const requests = await query('SELECT COUNT(*) FROM requests');
    const pros = await query('SELECT COUNT(*) FROM pros');
    res.json({status:'ok', version:'fixerr-postgres-v1', time:new Date().toISOString(),
      users: +users.rows[0].count, requests: +requests.rows[0].count, pros: +pros.rows[0].count});
  } catch(e){ res.status(500).json({status:'error', error: e.message}); }
});

app.use('/api/*', (req,res) => res.status(404).json({error:'Not found.'}));
app.get('*', (req,res) => {
  const f = path.join(__dirname,'../frontend/index.html');
  res.sendFile(f);
});

// Test DB connection and auto-create schema on startup
const fs = require('fs');
async function initDB() {
  try {
    await query('SELECT 1');
    console.log('✅ Database connection verified');
    // Auto-run schema to create tables if they don't exist
    const schemaPath = require('path').join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(schema);
      console.log('✅ Schema verified/created');
    }
    // Run any pending column migrations
    const migrations = [
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS country TEXT`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS currency TEXT`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS preferred_pro_id INTEGER`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1`,
      // General Note 8: Standard audit columns on all tables
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS updated TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      // General Note 10: Geo-location storage for proximity matching
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS lat NUMERIC`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS lng NUMERIC`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS lat NUMERIC`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS lng NUMERIC`,
      // Service radius for geo-matching
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS service_radius INTEGER DEFAULT 25`,
      // WHO columns - standard audit trail on all tables
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE pros ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
      `ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE ad_leads ADD COLUMN IF NOT EXISTS updated_by INTEGER`,
    ];
    for(const m of migrations){
      await pool.query(m).catch(e=>console.log('Migration skip:', e.message.substring(0,60)));
    }
    console.log('✅ Column migrations verified');
    // Auto-seed admin if not exists
    const existing = await query("SELECT id FROM users WHERE email='admin@fixerr.com'");
    if (!existing.rows.length) {
      const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'CwSNbGdlr1Jl#ESL', 10);
      await query(
        `INSERT INTO users (first,last,email,hash,role,city,state,country,currency,active)
         VALUES ('Admin','Fixerr','admin@fixerr.com',$1,'admin','Bengaluru','Karnataka','IN','INR',true)`,
        [hash]
      );
      console.log('✅ Admin user created — admin@fixerr.com');
    } else {
      console.log('✅ Admin user exists');
    }
    // Log table counts for verification
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
    console.error('   Make sure DATABASE_URL is set correctly in Render Environment variables');
  }
}

// ── ADMIN: CUSTOMERS ──────────────────────────────────────
app.get('/api/admin/customers', auth, async (req,res) => {
  if(req.user.role!=='admin') return res.status(403).json({error:'Admin only.'});
  try {
    // Ensure columns exist before querying
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC DEFAULT 0`).catch(()=>{});
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0`).catch(()=>{});
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lat NUMERIC`).catch(()=>{});
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lng NUMERIC`).catch(()=>{});
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT`).catch(()=>{});
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zip TEXT`).catch(()=>{});
    const r = await query(`
      SELECT u.id, u.first, u.last, u.email, u.phone, u.city, u.state, u.country,
             u.address, u.zip, u.currency,
             COALESCE(u.lat, NULL) as lat, COALESCE(u.lng, NULL) as lng,
             u.created, u.active,
             COALESCE(u.cancellation_count, 0) as cancellation_count,
             COALESCE(u.wallet_balance, 0) as wallet_balance,
             COUNT(DISTINCT req.id) as booking_count
      FROM users u
      LEFT JOIN requests req ON req.customer=u.id
      WHERE u.role='customer'
      GROUP BY u.id
      ORDER BY u.created DESC NULLS LAST
    `);
    res.json(r.rows);
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.listen(PORT, async () => {
  console.log(`\n🚀 Fixerr backend running on port ${PORT}`);
  console.log(`   Database: PostgreSQL`);
  await initDB();
  console.log(`   Ready!\n`);
});

// ── WALLET ────────────────────────────────────────────────
// General Note 5: Wallet concept for customers
app.get('/api/wallet', auth, async (req,res) => {
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC DEFAULT 0`).catch(()=>{});
    const r = await query('SELECT wallet_balance FROM users WHERE id=$1',[req.user.id]);
    res.json({balance: r.rows[0]?.wallet_balance||0});
  } catch(e){ res.status(500).json({error:'Could not load wallet.'}); }
});

app.post('/api/wallet/topup', auth, async (req,res) => {
  try {
    const {amount} = req.body;
    if(!amount||+amount<=0) return res.status(400).json({error:'Invalid amount.'});
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC DEFAULT 0`).catch(()=>{});
    const r = await query('UPDATE users SET wallet_balance=COALESCE(wallet_balance,0)+$1 WHERE id=$2 RETURNING wallet_balance',[+amount, req.user.id]);
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',['wallet', `Customer wallet topped up: ${amount}`]);
    res.json({success:true, balance: r.rows[0].wallet_balance});
  } catch(e){ res.status(500).json({error:'Could not top up wallet.'}); }
});

// General Note 6: Evaluation fee - deduct from technician earnings
app.post('/api/admin/evaluation-fee', auth, async (req,res) => {
  if(req.user.role!=='admin') return res.status(403).json({error:'Admin only.'});
  try {
    const {pro_user_id, amount, reason} = req.body;
    if(!pro_user_id||!amount) return res.status(400).json({error:'pro_user_id and amount required.'});
    await query(`ALTER TABLE pros ADD COLUMN IF NOT EXISTS evaluation_fees_deducted NUMERIC DEFAULT 0`).catch(()=>{});
    await query('UPDATE pros SET evaluation_fees_deducted=COALESCE(evaluation_fees_deducted,0)+$1 WHERE user_id=$2',[+amount, pro_user_id]);
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)',['eval_fee', `Evaluation fee of ${amount} deducted from pro ID ${pro_user_id}: ${reason||'standard evaluation'}`]);
    res.json({success:true, message:`Evaluation fee of ${amount} deducted.`});
  } catch(e){ res.status(500).json({error:'Could not deduct evaluation fee.'}); }
});
