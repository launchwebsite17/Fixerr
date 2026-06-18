// FIXERR BACKEND - Soft Launch Edition
// Pure JavaScript - NO compilation needed - Works on Windows
// Run: npm install && node server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fixerr-secret-2024-change-in-production';
const DB = path.join(__dirname, 'db.json');
const BACKUP_DIR = path.join(__dirname, 'db-backups');
const TMP_DB = DB + '.tmp';

// ── DATABASE (hardened JSON file storage) ──────────────────
// Atomic writes (write-then-rename) prevent corruption from a crash mid-save.
// Automatic timestamped backups protect against accidental data loss.
let _writeInProgress = false;
let _writeQueued = false;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupDB() {
  try {
    if (!fs.existsSync(DB)) return;
    ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `db-${stamp}.json`);
    fs.copyFileSync(DB, backupFile);
    // Keep only the most recent 20 backups to avoid unbounded disk growth
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-')).sort();
    if (files.length > 20) {
      files.slice(0, files.length - 20).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch(e) {}
      });
    }
  } catch (e) {
    console.error('Backup failed (non-fatal):', e.message);
  }
}

function load() {
  if (!fs.existsSync(DB)) {
    const fresh = seed();
    save(fresh);
    return fresh;
  }
  try {
    const raw = fs.readFileSync(DB, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('⚠️  db.json appears corrupted:', e.message);
    // Try to recover from the most recent backup instead of silently wiping data
    try {
      ensureBackupDir();
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-')).sort();
      if (files.length) {
        const latest = path.join(BACKUP_DIR, files[files.length - 1]);
        console.error('⚠️  Recovering from backup:', latest);
        const raw = fs.readFileSync(latest, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e2) {
      console.error('⚠️  Backup recovery also failed:', e2.message);
    }
    console.error('⚠️  No usable backup found. Starting fresh database (previous data may be lost).');
    return seed();
  }
}

function save(d) {
  // Atomic write: write to a temp file first, then rename over the real file.
  // This means a crash or power loss mid-write can never leave db.json half-written.
  try {
    backupDB();
    fs.writeFileSync(TMP_DB, JSON.stringify(d, null, 2));
    fs.renameSync(TMP_DB, DB);
  } catch (e) {
    console.error('⚠️  Save failed:', e.message);
    throw e;
  }
}
function uid(db, t) { if(!db._id)db._id={}; if(!db._id[t])db._id[t]=100; return db._id[t]++; }
function ref(p) { return p+'-'+Date.now().toString().slice(-6)+'-'+Math.floor(Math.random()*9000+1000); }

function seed() {
  return {
    users: [{
      id:1, first:'Admin', last:'Fixerr', email:'admin@fixerr.com',
      hash: bcrypt.hashSync('Admin@123',10), role:'admin',
      city:'Bengaluru', state:'Karnataka', country:'IN', currency:'INR',
      active:1, created: new Date().toISOString()
    }],
    pros: [],
    requests: [],
    messages: [],
    reviews: [],
    ads: [
      {id:1, name:'HomeServices Co', email:'ads@example.com', tagline:'Quality tools for every home', logo:'HS', cta:'Learn More', url:'#', category:'all', active:1, impressions:0, clicks:0, created: new Date().toISOString()}
    ],
    ad_leads: [],
    custom: [],
    notifs: [],
    _id: {users:2, pros:1, requests:1, messages:1, reviews:1, ads:2, ad_leads:1, custom:1, notifs:1}
  };
}

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
app.use(express.json());
app.use(express.static(path.join(__dirname,'../frontend')));

// ── RATE LIMITING (in-memory, no extra dependencies) ────────
// Tracks request counts per IP per route over a sliding time window.
// Resets automatically; lightweight enough for a soft-launch single server.
const rateLimitStore = {};
function rateLimit(windowMs, maxRequests, label) {
  return (req, res, next) => {
    const key = label + ':' + (req.ip || req.connection.remoteAddress || 'unknown');
    const now = Date.now();
    if (!rateLimitStore[key]) rateLimitStore[key] = [];
    // Drop timestamps outside the current window
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < windowMs);
    if (rateLimitStore[key].length >= maxRequests) {
      const retryAfterSec = Math.ceil((windowMs - (now - rateLimitStore[key][0])) / 1000);
      return res.status(429).json({ error: `Too many requests. Please try again in ${retryAfterSec} seconds.` });
    }
    rateLimitStore[key].push(now);
    next();
  };
}
// Periodically clear out old entries so memory doesn't grow forever
setInterval(() => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(key => {
    rateLimitStore[key] = rateLimitStore[key].filter(t => now - t < 15 * 60 * 1000);
    if (!rateLimitStore[key].length) delete rateLimitStore[key];
  });
}, 5 * 60 * 1000);

// Stricter limits on auth endpoints (brute-force protection)
const authLimiter = rateLimit(15 * 60 * 1000, 10, 'auth');      // 10 attempts / 15 min
const bookingLimiter = rateLimit(60 * 60 * 1000, 20, 'booking'); // 20 bookings / hour
const generalLimiter = rateLimit(60 * 1000, 60, 'general');     // 60 req/min for everything else
app.use('/api/', generalLimiter);
app.use('/api/', sanitizeMiddleware);

function auth(req,res,next) {
  const t = req.headers.authorization?.split(' ')[1];
  if(!t) return res.status(401).json({error:'Please log in.'});
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({error:'Session expired. Please log in again.'}); }
}
function admin(req,res,next) {
  if(req.user?.role !== 'admin') return res.status(403).json({error:'Admin only.'});
  next();
}
function noContact(txt) {
  return /\b\d{10}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|@\w+\.\w+|whatsapp|telegram/i.test(txt);
}

// ── INPUT SANITIZING ─────────────────────────────────────────
// Escapes HTML special characters so user input can never be rendered as
// live HTML/JavaScript elsewhere on the site (prevents stored XSS attacks).
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Trims, caps length, and escapes a single string field.
function cleanStr(val, maxLen = 500) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'string') return val;
  return escapeHtml(val.trim().slice(0, maxLen));
}
// Recursively sanitizes every string value in a plain object (one level deep
// is enough here since our request bodies are flat, but arrays are handled too).
function sanitizeBody(obj, maxLen = 500) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    const val = obj[key];
    if (typeof val === 'string') out[key] = cleanStr(val, maxLen);
    else if (Array.isArray(val)) out[key] = val.map(v => typeof v === 'string' ? cleanStr(v, maxLen) : v);
    else out[key] = val;
  }
  return out;
}
// Middleware: sanitizes every field in req.body automatically for POST/PATCH routes.
function sanitizeMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeBody(req.body);
  }
  next();
}

// ── AUTH ──────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, (req,res) => {
  const {firstName,lastName,email,phone,password,role,city,state,country,currency} = req.body;
  if(!firstName||!lastName||!email||!password)
    return res.status(400).json({error:'All fields are required.'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({error:'Please enter a valid email address.'});
  if(password.length < 8)
    return res.status(400).json({error:'Password must be at least 8 characters.'});

  const db = load();
  if(db.users.find(u => u.email === email))
    return res.status(409).json({error:'Account already exists with this email. Please log in.'});

  const userRole = ['customer','professional'].includes(role) ? role : 'customer';
  const id = uid(db,'users');
  const isIndia = (country||'IN') === 'IN';

  db.users.push({
    id, first:firstName, last:lastName, email, phone:phone||null,
    hash: bcrypt.hashSync(password, 10), role:userRole,
    city:city||null, state:state||null,
    country:country||'IN', currency:currency||(isIndia?'INR':'USD'),
    active:1, created: new Date().toISOString()
  });

  if(userRole === 'professional') {
    db.pros.push({
      id:uid(db,'pros'), user_id:id, status:'pending',
      services:[], bio:'', years_exp:0, certifications:'', languages:'English',
      rate_inr:499, rate_usd:65, fee_inr:399, fee_usd:49,
      rating:0, reviews:0, jobs:0, available:0,
      id_type:'', bank:'', upi:'', created: new Date().toISOString()
    });
    db.notifs.push({id:uid(db,'notifs'), type:'new_pro',
      msg:`New professional: ${firstName} ${lastName} (${email})`,
      read:0, created: new Date().toISOString()});
  }
  save(db);

  const token = jwt.sign({id, email, role:userRole}, JWT_SECRET, {expiresIn:'30d'});
  res.json({success:true, token, userId:id, role:userRole, name:firstName,
    currency:currency||(isIndia?'INR':'USD'), country:country||'IN'});
});

app.post('/api/auth/login', authLimiter, (req,res) => {
  const {email,password} = req.body;
  if(!email||!password) return res.status(400).json({error:'Email and password required.'});
  const db = load();
  const u = db.users.find(u => u.email===email && u.active);
  if(!u) return res.status(401).json({error:'No account found with this email. Please sign up.'});
  if(!bcrypt.compareSync(password, u.hash))
    return res.status(401).json({error:'Incorrect password. Please try again.'});
  const token = jwt.sign({id:u.id, email:u.email, role:u.role}, JWT_SECRET, {expiresIn:'30d'});
  res.json({success:true, token, userId:u.id, role:u.role, name:u.first, currency:u.currency, country:u.country});
});

app.get('/api/auth/me', auth, (req,res) => {
  const db = load();
  const u = db.users.find(u => u.id===req.user.id);
  if(!u) return res.status(404).json({error:'User not found.'});
  const {hash,...safe} = u;
  res.json(safe);
});

// ── CITIES ────────────────────────────────────────────────
app.get('/api/cities', (req,res) => {
  const {q=''} = req.query;
  const CITIES = require('./cities.json');
  res.json(CITIES.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.state||'').toLowerCase().includes(q.toLowerCase())
  ).slice(0,12));
});

// ── PRICES ────────────────────────────────────────────────
app.get('/api/prices', (req,res) => res.json(PRICES));

// ── BOOKING REQUESTS ──────────────────────────────────────
app.post('/api/requests', bookingLimiter, (req,res) => {
  const {serviceKey,subService,customDesc,preferredPro,paymentMethod,date,time,address,city,state,zip,
    country,currency,name,phone,email,notes,termsAgreed} = req.body;
  if(!serviceKey) return res.status(400).json({error:'Service is required.'});
  if(!address||!city) return res.status(400).json({error:'Full address required (street + city).'});
  if(!phone&&!email) return res.status(400).json({error:'Phone or email required so we can contact you.'});
  if(!termsAgreed) return res.status(400).json({error:'You must agree to the Terms of Service to submit a booking.'});

  const db = load();
  const id = uid(db,'requests');
  const bookRef = ref('BK');
  const isIndia = (country||'IN') === 'IN';
  const p = PRICES[serviceKey]||PRICES.other;
  const est = isIndia ? p.inr.base : p.usd.base;
  const cur = isIndia ? 'INR' : 'USD';
  const comm = Math.round(est * 0.15);
  const proEarns = est - comm;

  const r = {
    id, ref:bookRef,
    service_key:serviceKey, sub_service:subService||null,
    custom_desc:customDesc||null,
    preferred_pro:preferredPro||null,
    payment_method:paymentMethod||'cash',
    preferred_date:date||null, preferred_time:time||null,
    address, city, state:state||null, zip:zip||null,
    country:country||'IN', currency:cur,
    estimate:est, commission:comm, pro_earns:proEarns,
    customer_name:name||null, customer_phone:phone||null, customer_email:email||null,
    user_id:req.user?.id||null,
    notes:notes||null, status:'pending',
    terms_agreed:true, terms_agreed_at:new Date().toISOString(),
    assigned_pro:null, admin_notes:'',
    created: new Date().toISOString()
  };
  db.requests.push(r);
  db.notifs.push({id:uid(db,'notifs'), type:'new_booking',
    msg:`New booking: ${serviceKey}${subService?' - '+subService:''} from ${name||phone||email}`,
    ref:bookRef, read:0, created: new Date().toISOString()});
  save(db);

  res.json({
    success:true, ref:bookRef,
    estimate:est, currency:cur, commission:comm, proEarns,
    message:'Booking request received! Our team will call you within 2 hours to confirm.'
  });
});

app.get('/api/requests', auth, (req,res) => {
  const db = load();
  if(req.user.role==='admin') return res.json(db.requests.sort((a,b)=>new Date(b.created)-new Date(a.created)));
  res.json(db.requests.filter(r=>r.user_id===req.user.id).sort((a,b)=>new Date(b.created)-new Date(a.created)));
});

app.patch('/api/requests/:id', auth, admin, (req,res) => {
  const db = load();
  const i = db.requests.findIndex(r => r.id===+req.params.id);
  if(i===-1) return res.status(404).json({error:'Not found.'});
  db.requests[i] = {...db.requests[i], ...req.body, updated: new Date().toISOString()};
  save(db);
  res.json({success:true});
});

// ── PROFESSIONAL APPLICATION ──────────────────────────────
app.post('/api/pro-application', auth, (req,res) => {
  const db = load();
  const i = db.pros.findIndex(p => p.user_id===req.user.id);
  if(i===-1) return res.status(404).json({error:'Professional record not found.'});
  if(!req.body.commission_agreed) return res.status(400).json({error:'You must agree to the Commission Agreement to submit your application.'});
  if(!req.body.liability_agreed) return res.status(400).json({error:'You must agree to the Independent Contractor & Liability terms to submit your application.'});
  db.pros[i] = {...db.pros[i], ...req.body, agreements_accepted_at:new Date().toISOString(), status:'pending', updated: new Date().toISOString()};
  db.notifs.push({id:uid(db,'notifs'), type:'pro_update',
    msg:`Professional application updated by user ${req.user.id}`,
    read:0, created: new Date().toISOString()});
  save(db);
  res.json({success:true, message:'Application submitted! Admin will review within 24 hours.'});
});

// ── MESSAGES ──────────────────────────────────────────────
app.post('/api/messages', auth, (req,res) => {
  const {to,booking_ref,content} = req.body;
  if(!content?.trim()) return res.status(400).json({error:'Message cannot be empty.'});
  if(noContact(content)) return res.status(400).json({
    error:'For your safety, sharing phone numbers, emails or social handles is not allowed on Fixerr.',
    code:'BLOCKED'
  });
  const db = load();
  const id = uid(db,'messages');
  db.messages.push({id, from:req.user.id, to:to||null, booking_ref:booking_ref||null,
    content:content.trim(), read:0, created: new Date().toISOString()});
  save(db);
  res.json({success:true, id});
});

app.get('/api/messages', auth, (req,res) => {
  const db = load();
  res.json(db.messages.filter(m=>m.from===req.user.id||m.to===req.user.id)
    .sort((a,b)=>new Date(a.created)-new Date(b.created)));
});

// ── REVIEWS ───────────────────────────────────────────────
app.post('/api/reviews', auth, (req,res) => {
  const {booking_ref,rating,comment,pro_id} = req.body;
  if(!rating||rating<1||rating>5) return res.status(400).json({error:'Rating must be 1-5.'});
  const db = load();
  const id = uid(db,'reviews');
  db.reviews.push({id, booking_ref, customer:req.user.id, pro_id,
    rating, comment:comment||'', created: new Date().toISOString()});
  const proReviews = db.reviews.filter(r=>r.pro_id===pro_id);
  const avg = proReviews.reduce((s,r)=>s+r.rating,0)/proReviews.length;
  const pi = db.pros.findIndex(p=>p.id===pro_id);
  if(pi!==-1) { db.pros[pi].rating=+avg.toFixed(1); db.pros[pi].reviews=proReviews.length; }
  save(db);
  res.json({success:true});
});

// ── ADS ───────────────────────────────────────────────────
app.get('/api/ads', (req,res) => {
  const {category='all'} = req.query;
  const db = load();
  const ads = db.ads.filter(a=>a.active&&(a.category==='all'||a.category===category))
    .sort(()=>Math.random()-0.5).slice(0,2);
  ads.forEach(a=>{const i=db.ads.findIndex(x=>x.id===a.id);if(i!==-1)db.ads[i].impressions++;});
  save(db);
  res.json(ads);
});

app.post('/api/ads/click/:id', (req,res) => {
  const db = load();
  const i = db.ads.findIndex(a=>a.id===+req.params.id);
  if(i!==-1) { db.ads[i].clicks++; save(db); }
  res.json({success:true});
});

app.post('/api/ads/inquire', (req,res) => {
  const db = load();
  const id = uid(db,'ad_leads');
  db.ad_leads.push({id, ...req.body, status:'new', created: new Date().toISOString()});
  db.notifs.push({id:uid(db,'notifs'), type:'ad_lead',
    msg:`Ad inquiry from ${req.body.company||req.body.email}`, read:0, created: new Date().toISOString()});
  save(db);
  res.json({success:true, message:'Received! Our team will contact you within 24 hours.'});
});

// ── CUSTOM SERVICE REQUESTS ───────────────────────────────
app.post('/api/custom', (req,res) => {
  const db = load();
  const id = uid(db,'custom');
  db.custom.push({id, ...req.body, status:'open', created: new Date().toISOString()});
  db.notifs.push({id:uid(db,'notifs'), type:'custom',
    msg:`Custom request: ${req.body.title}`, read:0, created: new Date().toISOString()});
  save(db);
  res.json({success:true, message:'Request received! We will find the right professional within 24 hours.'});
});

// ── ADMIN ─────────────────────────────────────────────────
app.get('/api/admin/stats', auth, admin, (req,res) => {
  const db = load();
  const rq = db.requests;
  const done = rq.filter(r=>r.status==='completed');
  res.json({
    total_requests: rq.length,
    pending: rq.filter(r=>r.status==='pending').length,
    confirmed: rq.filter(r=>r.status==='confirmed').length,
    completed: done.length,
    customers: db.users.filter(u=>u.role==='customer').length,
    pros_total: db.pros.length,
    pros_pending: db.pros.filter(p=>p.status==='pending').length,
    pros_approved: db.pros.filter(p=>p.status==='approved').length,
    unread_notifs: db.notifs.filter(n=>!n.read).length,
    ad_leads: db.ad_leads.length,
    custom_requests: db.custom.length,
    commission_inr: Math.round(done.filter(r=>r.currency==='INR').reduce((s,r)=>s+(r.commission||0),0)),
    commission_usd: +done.filter(r=>r.currency==='USD').reduce((s,r)=>s+(r.commission||0),0).toFixed(2),
  });
});

app.get('/api/admin/users', auth, admin, (req,res) => {
  const {role} = req.query;
  const db = load();
  let users = db.users.map(({hash,...u})=>u);
  if(role) users = users.filter(u=>u.role===role);
  res.json(users.sort((a,b)=>new Date(b.created)-new Date(a.created)));
});

app.get('/api/admin/pros', auth, admin, (req,res) => {
  const {status} = req.query;
  const db = load();
  let pros = db.pros.map(p=>{
    const u = db.users.find(u=>u.id===p.user_id);
    return {...p, first:u?.first, last:u?.last, email:u?.email, phone:u?.phone, city:u?.city, country:u?.country};
  });
  if(status) pros = pros.filter(p=>p.status===status);
  res.json(pros.sort((a,b)=>new Date(b.created)-new Date(a.created)));
});

app.patch('/api/admin/pros/:id', auth, admin, (req,res) => {
  const db = load();
  const i = db.pros.findIndex(p=>p.id===+req.params.id);
  if(i===-1) return res.status(404).json({error:'Not found.'});
  db.pros[i] = {...db.pros[i], ...req.body};
  if(req.body.status==='approved') db.pros[i].available = 1;
  save(db);
  res.json({success:true});
});

app.get('/api/admin/notifs', auth, admin, (req,res) => {
  res.json(load().notifs.sort((a,b)=>new Date(b.created)-new Date(a.created)));
});
app.patch('/api/admin/notifs/read-all', auth, admin, (req,res) => {
  const db = load(); db.notifs.forEach(n=>n.read=1); save(db); res.json({success:true});
});

app.get('/api/admin/ads', auth, admin, (req,res) => res.json(load().ads));
app.post('/api/admin/ads', auth, admin, (req,res) => {
  const db = load();
  const id = uid(db,'ads');
  db.ads.push({id,...req.body,impressions:0,clicks:0,active:1,created:new Date().toISOString()});
  save(db); res.json({success:true,id});
});
app.patch('/api/admin/ads/:id', auth, admin, (req,res) => {
  const db = load();
  const i = db.ads.findIndex(a=>a.id===+req.params.id);
  if(i!==-1){db.ads[i]={...db.ads[i],...req.body};save(db);}
  res.json({success:true});
});

app.get('/api/admin/ad-leads', auth, admin, (req,res) => res.json(load().ad_leads));
app.get('/api/admin/custom', auth, admin, (req,res) => res.json(load().custom));
app.patch('/api/admin/custom/:id', auth, admin, (req,res) => {
  const db = load();
  const i = db.custom.findIndex(c=>c.id===+req.params.id);
  if(i!==-1){db.custom[i]={...db.custom[i],...req.body};save(db);}
  res.json({success:true});
});

// ── HEALTH ────────────────────────────────────────────────
app.get('/api/health', (req,res) => {
  const db = load();
  res.json({status:'ok', version:'fixerr-v6', time:new Date().toISOString(),
    users:db.users.length, requests:db.requests.length, pros:db.pros.length});
});

app.use('/api/*', (req,res) => res.status(404).json({error:'Not found.'}));
app.get('*', (req,res) => {
  const f = path.join(__dirname,'../frontend/index.html');
  if(fs.existsSync(f)) res.sendFile(f);
  else res.send('Place frontend files in frontend/ folder');
});

app.listen(PORT, () => {
  const db = load();
  console.log('\n==========================================');
  console.log('  ✅  FIXERR is running!');
  console.log('==========================================');
  console.log(`  🌐  Site:    http://localhost:${PORT}`);
  console.log(`  📊  Health:  http://localhost:${PORT}/api/health`);
  console.log(`  🔐  Admin:   admin@fixerr.com / Admin@123`);
  console.log(`  📦  Requests: ${db.requests.length}`);
  console.log('==========================================\n');
  console.log('  Keep this window open while using the site.');
  console.log('  Open: frontend/index.html in your browser\n');
});
