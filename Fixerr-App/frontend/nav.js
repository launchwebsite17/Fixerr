/* ============================================================================
   nav.js — SHARED NAVIGATION / LOCATION / API LOGIC FOR PUBLIC PAGES
   ============================================================================
   This file holds the JavaScript that used to be copy-pasted, essentially
   unchanged, into an inline <script> block at the top of every public page
   (about.html, advertise.html, booking.html, chat.html, contact-us.html,
   forgot-password.html, how-it-works.html, index.html, login.html,
   register-pro.html, reset-password.html, signup.html, terms.html).

   WHY THIS FILE EXISTS
   The nav bar you see on every page (country/city picker, login-aware
   Dashboard/Log In/Log Out buttons, hamburger menu) is driven by this code.
   Before this file existed, every page had its OWN copy of it — 13 separate
   copies of the same ~350 lines. That meant a bug fix or a new city had to
   be applied 13 times by hand, and it was easy to update most copies and
   miss a few (exactly this kind of drift is what caused an earlier bug this
   project hit, where one page read a saved value from a different storage
   location than the page that wrote it). Now there is ONE copy; every page
   loads this file instead of embedding its own.

   HOW A PAGE USES THIS FILE
     <script src="nav.js"></script>
     ...later, once the page's own <body> markup has loaded...
     <script>
       document.addEventListener("DOMContentLoaded", initSharedLayout);
     </script>
   `initSharedLayout()` (defined at the bottom of this file) fetches the
   shared header/footer HTML partials, injects them into the page's
   <div id="site-header"></div> / <div id="site-footer"></div> placeholders,
   and only THEN runs the nav's own startup (updateNav/initNav) — because
   those functions reach into nav elements (like #nav-country) that don't
   exist in the DOM until the header partial has actually been injected.

   A PAGE CAN STILL CUSTOMIZE THINGS AFTER LOADING THIS FILE
   A couple of pages (index.html, notably) had small, genuine behavioral
   differences from the rest — e.g. index.html's FX.paint() also updates a
   ".svc-price" element, and its initNav() auto-detects currency for a
   brand-new visitor instead of defaulting to USD. Those differences were
   NOT folded into this shared file (that would have changed every other
   page's behavior too — the opposite of "don't break existing logic").
   Instead, index.html keeps a small local script, loaded AFTER this file,
   that redefines just the parts it customizes. Because these are plain
   global functions/objects (not a JS module), a page's own later
   declaration simply overrides the shared one for that page only.

   DASHBOARDS / ADMIN PANEL / PAYMENT PAGES ARE **NOT** PART OF THIS FILE'S
   AUDIENCE. dashboard.html, dashboard-pro.html,
   fixerr-owner-0si7erbb2ctq.html, admin-login.html and
   payment-checkout.html keep their own separate copies of similar-looking
   code and were intentionally left untouched by this consolidation.
   ============================================================================ */

/* ────────────────────────────────────────────────────────────────────────
   SHARED DATA — cities, starting prices, sub-services, icons, discount codes
   ──────────────────────────────────────────────────────────────────────── */

// Every selectable city in the country/city nav dropdown. Each entry: n=name,
// st=state/province, c=country code (US/IN), f=flag emoji, cur=currency code,
// sym=currency symbol. Used by onCountryChange() to populate the city <select>
// and by initNav() to match a logged-in user's saved city.
const CITIES=[{n:"Albuquerque",st:"NM",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Atlanta",st:"GA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Austin",st:"TX",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Baltimore",st:"MD",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Boston",st:"MA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Charlotte",st:"NC",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Chicago",st:"IL",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Cincinnati",st:"OH",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Cleveland",st:"OH",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Colorado Springs",st:"CO",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Columbus",st:"OH",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Dallas",st:"TX",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Denver",st:"CO",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Detroit",st:"MI",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Fort Worth",st:"TX",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Fresno",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Houston",st:"TX",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Indianapolis",st:"IN",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Jacksonville",st:"FL",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Kansas City",st:"MO",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Las Vegas",st:"NV",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Long Beach",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Los Angeles",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Louisville",st:"KY",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Memphis",st:"TN",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Miami",st:"FL",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Milwaukee",st:"WI",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Minneapolis",st:"MN",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Nashville",st:"TN",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"New Orleans",st:"LA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"New York",st:"NY",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Oklahoma City",st:"OK",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Omaha",st:"NE",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Orlando",st:"FL",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Philadelphia",st:"PA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Phoenix",st:"AZ",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Pittsburgh",st:"PA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Portland",st:"OR",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Raleigh",st:"NC",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Sacramento",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Salt Lake City",st:"UT",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"San Antonio",st:"TX",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"San Diego",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"San Francisco",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"San Jose",st:"CA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Seattle",st:"WA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Tampa",st:"FL",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Tucson",st:"AZ",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Virginia Beach",st:"VA",c:"US",f:"🇺🇸",cur:"USD",sym:"$"},{n:"Agra",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Ahmedabad",st:"Gujarat",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Aligarh",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Amritsar",st:"Punjab",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Aurangabad",st:"Maharashtra",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Bareilly",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Bengaluru",st:"Karnataka",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Bhopal",st:"Madhya Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Bhubaneswar",st:"Odisha",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Chandigarh",st:"Punjab",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Chennai",st:"Tamil Nadu",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Coimbatore",st:"Tamil Nadu",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Dehradun",st:"Uttarakhand",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Delhi",st:"Delhi",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Faridabad",st:"Haryana",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Gurugram",st:"Haryana",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Guwahati",st:"Assam",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Hubli",st:"Karnataka",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Hyderabad",st:"Telangana",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Indore",st:"Madhya Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Jabalpur",st:"Madhya Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Jaipur",st:"Rajasthan",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Jodhpur",st:"Rajasthan",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Kanpur",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Kochi",st:"Kerala",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Kolhapur",st:"Maharashtra",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Kolkata",st:"West Bengal",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Kozhikode",st:"Kerala",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Lucknow",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Ludhiana",st:"Punjab",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Madurai",st:"Tamil Nadu",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Mangaluru",st:"Karnataka",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Meerut",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Mumbai",st:"Maharashtra",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Mysuru",st:"Karnataka",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Nagpur",st:"Maharashtra",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Nashik",st:"Maharashtra",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Noida",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Patna",st:"Bihar",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Pune",st:"Maharashtra",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Rajkot",st:"Gujarat",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Ranchi",st:"Jharkhand",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Surat",st:"Gujarat",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Thiruvananthapuram",st:"Kerala",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Tiruchirappalli",st:"Tamil Nadu",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Vadodara",st:"Gujarat",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Varanasi",st:"Uttar Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Vijayawada",st:"Andhra Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"},{n:"Visakhapatnam",st:"Andhra Pradesh",c:"IN",f:"🇮🇳",cur:"INR",sym:"₹"}];

// Made available on window (not just as a local `const`) because
// mobileChangeCity() below reads it via window._CITIES — that indirection
// existed already in the original per-page code; kept as-is for consistency.
window._CITIES = CITIES;

// Starting/hourly prices per service, in INR and USD (b=base/starting, h=hourly).
// Read by FX.price()/FX.fmt() to paint any element with a data-p="<service>" attribute.
const PR={plumbing:{inr:{b:399,h:499},usd:{b:49,h:65}},electrical:{inr:{b:449,h:549},usd:{b:59,h:70}},cleaning:{inr:{b:599,h:449},usd:{b:79,h:55}},appliance:{inr:{b:499,h:499},usd:{b:69,h:60}},beauty:{inr:{b:299,h:349},usd:{b:39,h:45}},tutoring:{inr:{b:249,h:299},usd:{b:30,h:35}},photography:{inr:{b:799,h:649},usd:{b:99,h:80}},events:{inr:{b:1199,h:749},usd:{b:149,h:90}},lawn:{inr:{b:349,h:399},usd:{b:49,h:50}},painting:{inr:{b:599,h:449},usd:{b:79,h:55}},movers:{inr:{b:1199,h:699},usd:{b:149,h:85}},handyman:{inr:{b:449,h:499},usd:{b:59,h:60}},other:{inr:{b:399,h:449},usd:{b:49,h:55}}};

// Sub-service options offered per top-level service category (e.g. "plumbing" →
// "Faucet Repair", "Drain Cleaning", ...). Used by booking.html's category step.
const SUBS={plumbing:["Faucet Repair","Drain Cleaning","Toilet Repair","Garbage Disposal","Water Heater","Pipe Repair","Sprinkler Repair","Fixture Install"],electrical:["Ceiling Fan Install","Plugs & Switches","Light Fixtures","EV Charger Install","Motion Sensors","Panel Upgrade","Cable Lines"],cleaning:["Deep Cleaning","Regular Cleaning","Carpet Cleaning","Post-Construction Clean","Move-In/Out Clean","Window Cleaning"],appliance:["Washing Machine","Refrigerator","AC Service","TV Repair","Oven / Stove","Dishwasher","Dryer","Microwave"],beauty:["Haircut & Style","Manicure & Pedicure","Facial & Skincare","Massage Therapy","Bridal Makeup","Waxing","Mehendi/Henna","Threading"],tutoring:["Math & Science","English & Writing","Coding & Tech","Music Lessons","Language Learning","SAT/GRE Prep","IIT/JEE/NEET Coaching","Art & Drawing"],photography:["Event Photography","Portrait Sessions","Real Estate Photos","Corporate Shoots","Wedding Photography"],events:["Birthday Party","Wedding Planning","Corporate Events","Decoration Setup","Catering Coordination"],lawn:["Lawn Mowing","Tree Trimming","Landscaping","Pressure Washing","Garden Maintenance"],painting:["Interior Painting","Exterior Painting","Accent Walls","Cabinet & Trim Painting"],movers:["Local Moving","Long Distance Move","Packing Services","Commercial/Office Move"],handyman:["Furniture Assembly","Door & Window Fixes","General Repairs","TV Wall Mount","Picture Hanging"]};

// One decorative emoji per sub-service (same order as SUBS[key]) — purely cosmetic.
const SICONS={plumbing:["🚿","🌊","🚽","🗑️","♨️","🔩","💧","🛁"],electrical:["🌀","💡","🔦","🔋","🚨","⚙️","📡"],cleaning:["✨","🧹","🛋️","🏗️","📦","🪟"],appliance:["🧺","❄️","🌡️","📺","🔥","🍽️","🫧","♨️"],beauty:["💇","💅","🧖","💆","👰","🧴","🎀","🌸"],tutoring:["➗","📖","💻","🎵","🌐","🎓","🏫","🎨"],photography:["🎊","👶","🏠","💼","👰"],events:["🎂","💍","💼","🎊","🍽️"],lawn:["🌱","✂️","🌺","💦","🏡"],painting:["🏠","🏗️","🎨","🪟"],movers:["🏠","🚛","📦","🏢"],handyman:["🔨","🚪","🔧","📺","🖼️"]};

// Known promo/discount codes a customer can enter at checkout (v=value, t=type
// "pct"/"flat", d=display label, c=country restriction if any).
const DISC={"FIXERR10":{v:10,t:"pct",d:"10% off"},"FIXERR20":{v:20,t:"pct",d:"20% off"},"WELCOME":{v:15,t:"pct",d:"15% welcome"},"INDIA15":{v:15,t:"pct",d:"15% India off",c:"IN"},"USA10":{v:10,t:"pct",d:"10% US off",c:"US"},"LAUNCH50":{v:50,t:"flat",d:"₹50/$5 off"}};

/* ────────────────────────────────────────────────────────────────────────
   FX — the visitor's current country/city/currency selection.
   Persisted to sessionStorage under "fx_c" so it survives page navigation
   within the same browser tab/session (see FX.set()); intentionally NOT
   also written to localStorage here, so a brand-new browser session starts
   fresh rather than inheriting a city chosen weeks ago on a shared device.
   ──────────────────────────────────────────────────────────────────────── */
const FX={
  city:null,country:"IN",currency:"INR",symbol:"₹",flag:"🇮🇳",

  // Called once per page load (see initSharedLayout() at the bottom of this file).
  // Order of preference for figuring out where the visitor is: (1) a city already
  // saved in this browser tab's session, (2) best-effort guess from timezone/
  // locale via detectCurrency(), refined a moment later by an IP lookup.
  init(){const s=sessionStorage.getItem("fx_c");if(s){try{const c=JSON.parse(s);this.city=c;this.country=c.c;this.currency=c.cur;this.symbol=c.sym;this.flag=c.f;}catch(e){}}else{this.detectCurrency();}this.paint();this.detectCurrencyByIP();},

  // Fast, offline-capable guess at country/currency: prefer the logged-in user's
  // saved country if we have one, otherwise infer India vs US from the browser's
  // timezone offset/name or language tag. Never throws — a guess is best-effort.
  detectCurrency(){try{const u=(typeof API!=='undefined'&&API.user)?API.user():null;if(u&&u.country==="IN"){this.country="IN";this.currency="INR";this.symbol="₹";this.flag="🇮🇳";return;}if(u&&u.country==="US"){this.country="US";this.currency="USD";this.symbol="$";this.flag="🇺🇸";return;}const tz=(Intl.DateTimeFormat().resolvedOptions().timeZone||"");const lang=(navigator.language||navigator.userLanguage||"");const isIN=(new Date().getTimezoneOffset()===-330)||/Kolkata|Calcutta|India|Asia\/Kolkata/i.test(tz)||/[-_]IN$/i.test(lang);if(isIN){this.country="IN";this.currency="INR";this.symbol="₹";this.flag="🇮🇳";}else{this.country="US";this.currency="USD";this.symbol="$";this.flag="🇺🇸";}}catch(e){}},

  // Slower but more accurate: asks a third-party IP-geolocation API. Skipped
  // entirely if the visitor already has a saved city — this is only for the
  // very first, city-less page view, to refine the timezone-based guess above.
  async detectCurrencyByIP(){if(sessionStorage.getItem("fx_c")||this.city)return;try{const r=await fetch("https://ipwho.is/?fields=success,country_code",{cache:"no-store"});const j=await r.json();if(!j||j.success===false||!j.country_code)return;const isIN=j.country_code==="IN";if(isIN&&this.currency!=="INR"){this.country="IN";this.currency="INR";this.symbol="₹";this.flag="🇮🇳";this.paint();}else if(!isIN&&this.currency!=="USD"){this.country="US";this.currency="USD";this.symbol="$";this.flag="🇺🇸";this.paint();}}catch(e){}},

  // Called whenever the visitor explicitly picks a city (nav dropdown or the
  // mobile "Change city" modal). Saves the choice for this browser session and
  // repaints every price/currency-dependent element on the page.
  set(city){this.city=city;this.country=city.c;this.currency=city.cur;this.symbol=city.sym;this.flag=city.f;sessionStorage.setItem("fx_c",JSON.stringify(city));this.paint();if(typeof toast==='function')toast(city.n+(city.st?', '+city.st:'')+' selected — '+city.sym+' '+city.cur,'info');},

  // Format a number as this session's currency (₹ rounded, $ to whole dollars).
  fmt(v){return this.currency==="INR"?"₹"+Math.round(v).toLocaleString("en-IN"):"$"+Number(v).toFixed(0);},

  // Look up a service's starting ("b") or hourly ("h") price in the current currency.
  price(s,t="b"){const p=(typeof PR!=='undefined'?PR[s]:null)||(typeof PR!=='undefined'?PR.other:{inr:{b:399},usd:{b:49}});return this.currency==="INR"?(p.inr[t]||p.inr.b):(p.usd[t]||p.usd.b);},

  // Re-renders every element on the page whose appearance depends on the
  // current country/city/currency — prices (data-p), currency labels
  // (data-cf/data-cs), the nav's city name (data-cn), phone/zip/address
  // placeholders localized to India vs the US, and a couple of one-off
  // country-specific UI toggles (UPI payment option, Zelle, ad pricing tiers).
  paint(){
    document.querySelectorAll("[data-p]").forEach(el=>{const s=el.getAttribute("data-p"),t=el.getAttribute("data-pt")||"b";el.textContent=this.fmt(this.price(s,t));});
    document.querySelectorAll("[data-cf]").forEach(el=>el.textContent=this.symbol+" "+this.currency);
    document.querySelectorAll("[data-cs]").forEach(el=>el.textContent=this.symbol);
    document.querySelectorAll("[data-cn]").forEach(el=>el.textContent=this.city?this.city.n+(this.city.st?", "+this.city.st:""):"Select city");
    const isIN=this.country==="IN";
    document.querySelectorAll("[data-ph]").forEach(el=>el.placeholder=isIN?"+91 98765 43210":"+1 (555) 000-0000");
    document.querySelectorAll("[data-zip-lbl]").forEach(el=>el.textContent=isIN?"PIN code (optional)":"ZIP code (optional)");
    document.querySelectorAll("[data-zip-inp]").forEach(el=>{el.placeholder=isIN?"6-digit PIN":"5-digit ZIP";});
    document.querySelectorAll("[data-street-inp]").forEach(el=>el.placeholder=isIN?"e.g. 124 MG Road, Apt 4B, Near Metro":"e.g. 124 Main St, Apt 4B");
    document.querySelectorAll("[data-city-inp]").forEach(el=>el.placeholder=isIN?"e.g. Bengaluru":"e.g. New York");
    const upi=document.getElementById("pay-upi");if(upi)upi.style.display=isIN?"flex":"none";
    const navzip=document.getElementById("nav-zip");if(navzip){navzip.style.display=FX.city?"inline-block":"none";navzip.placeholder=isIN?"PIN":"ZIP";navzip.maxLength=isIN?6:10;}
    const zel=document.getElementById("pay-zelle");if(zel)zel.style.display=isIN?"none":"flex";
    const tier=document.getElementById("ad-tier");
    if(tier){tier.innerHTML=isIN?`<option value="starter">Starter — Single Service Page (₹4,999/mo)</option><option value="growth">Growth — Multi-Category + Homepage (₹14,999/mo)</option><option value="enterprise">Enterprise — Full Platform Presence (₹39,999/mo)</option><option value="custom">Not sure / Custom needs</option>`:`<option value="starter">Starter — Single Service Page ($79/mo)</option><option value="growth">Growth — Multi-Category + Homepage ($199/mo)</option><option value="enterprise">Enterprise — Full Platform Presence ($499/mo)</option><option value="custom">Not sure / Custom needs</option>`;}
  }
};

/* ────────────────────────────────────────────────────────────────────────
   API — thin fetch() wrapper: attaches the saved auth token, normalizes
   errors, and force-logs-out on a 401 (expired/invalid session).
   ──────────────────────────────────────────────────────────────────────── */
const API={
  // Talk to the deployed backend when the page itself is served from a live
  // domain; talk to a local dev server when the page is opened from localhost.
  base:(location.hostname==="localhost"||location.hostname==="127.0.0.1")?"http://localhost:3001":location.origin,
  tok(){return localStorage.getItem("fx_tok");},
  user(){try{return JSON.parse(localStorage.getItem("fx_usr")||"null");}catch{return null;}},
  async req(m,p,b=null){
    const o={method:m,headers:{"Content-Type":"application/json"}};
    const t=this.tok();if(t)o.headers["Authorization"]="Bearer "+t;
    if(b)o.body=JSON.stringify(b);
    try{const r=await fetch(this.base+p,o);const d=await r.json();if(r.status===401&&this.tok()){localStorage.removeItem("fx_tok");localStorage.removeItem("fx_usr");if(location.pathname.indexOf("login")===-1)location.href="login.html";}if(!r.ok)throw new Error(d.error||"Error");return d;}
    catch(e){if(e.message==="Failed to fetch")throw new Error("Cannot connect to server. Run: node server.js in backend folder.");throw e;}
  },
  get(p){return this.req("GET",p);},
  post(p,b){return this.req("POST",p,b);},
  patch(p,b){return this.req("PATCH",p,b);},
  save(d){localStorage.setItem("fx_tok",d.token);localStorage.setItem("fx_usr",JSON.stringify({id:d.userId,role:d.role,name:d.name,currency:d.currency,country:d.country}));},
  logout(){localStorage.removeItem("fx_tok");localStorage.removeItem("fx_usr");location.href="login.html";},
  must(role=null){const u=this.user();if(!u||!this.tok()){location.href="login.html";return false;}if(role&&u.role!==role&&u.role!=="admin"){alert("Access denied.");location.href="index.html";return false;}return true;}
};

/* ────────────────────────────────────────────────────────────────────────
   GENERIC UI HELPERS — used by nearly every form on every page.
   ──────────────────────────────────────────────────────────────────────── */

// A small auto-dismissing notification pill in the top-right corner.
// type: "ok" (green, default) | "err" (red) | "info" (blue).
function toast(msg,type="ok"){
  const c={ok:"background:var(--accent-light);border:1px solid var(--border-accent);color:#1F5020;",err:"background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;",info:"background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;"};
  const el=document.createElement("div");
  el.style.cssText="position:fixed;top:74px;right:1.5rem;z-index:9999;padding:0.75rem 1rem;border-radius:10px;font-size:0.86rem;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-width:340px;animation:fxIn 0.3s ease;"+(c[type]||c.info);
  el.textContent=(type==="ok"?"✓ ":type==="err"?"✕ ":"ℹ ")+msg;
  document.body.appendChild(el);setTimeout(()=>el.remove(),4000);
}

// Puts a red border + inline error message under the field with this id.
// The error auto-clears the moment the visitor edits that field again, and
// the very first error shown on a page auto-scrolls into view.
function showErr(id,msg){
  const el=document.getElementById(id);if(!el)return;
  el.style.borderColor="#DC2626";
  let e=el.parentElement.querySelector(".ferr");
  if(!e){e=document.createElement("div");e.className="ferr";e.style.cssText="color:#DC2626;font-size:0.78rem;font-weight:600;margin-top:0.3rem;";el.parentElement.appendChild(e);}
  e.textContent=msg;
  // Clear error when user starts typing/changing this field
  const clear=()=>{el.style.borderColor='';const fe=el.parentElement.querySelector('.ferr');if(fe)fe.remove();el.removeEventListener('input',clear);el.removeEventListener('change',clear);};
  el.addEventListener('input',clear);
  el.addEventListener('change',clear);
  // Scroll to first error only
  if(!document.querySelector('._first-err')){el.classList.add('_first-err');el.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>el.classList.remove('_first-err'),1000);}
}

// Wipes every showErr() marker on the page — call before re-validating a form.
function clearErr(){
  // Clear ALL red borders and error messages before re-validating
  document.querySelectorAll("input,select,textarea").forEach(el=>{el.style.borderColor='';});
  document.querySelectorAll(".ferr").forEach(e=>e.remove());
}

// Shorthand: trimmed value of the input/select/textarea with this id, or "".
function v(id){const el=document.getElementById(id);return el?el.value.trim():"";}

/* ────────────────────────────────────────────────────────────────────────
   LOGOUT — clears every piece of session state this app writes to the
   browser (auth token, cached user, selected city in both storages, saved
   zip), resets the in-memory FX object, and visibly resets the nav's own
   country/city controls before sending the visitor to the login page.
   ──────────────────────────────────────────────────────────────────────── */
function doLogout(e){
  if(e && e.preventDefault) e.preventDefault();
  localStorage.removeItem("fx_tok");
  localStorage.removeItem("fx_usr");
  sessionStorage.removeItem("fx_c");
  localStorage.removeItem("fx_c");
  localStorage.removeItem("fx_zip");
  if(typeof FX !== 'undefined'){
    FX.city = null;
    FX.country = "";
    FX.currency = "USD";
    FX.symbol = "$";
  }
  const countryEl = document.getElementById("nav-country");
  const citySel = document.getElementById("nav-city-sel");
  const zipInp = document.getElementById("nav-zip");
  if(countryEl) countryEl.value = "";
  if(citySel){
    citySel.innerHTML = '<option value="">📍 Select city</option>';
    citySel.disabled = true;
  }
  if(zipInp){
    zipInp.value = "";
    zipInp.style.display = "none";
  }
  location.href = "login.html";
}
// Exposed explicitly (as well as being a normal global function) because the
// header partial's "Log Out" buttons call it via a plain onclick="doLogout(event)"
// attribute, which resolves against the global scope at click time.
window.doLogout = doLogout;

/* ────────────────────────────────────────────────────────────────────────
   NAV RENDERING — fills in the right-hand side of the desktop nav bar
   (#nav-right) and the mobile hamburger menu (#mobile-menu) based on
   whether someone is currently logged in.
   ──────────────────────────────────────────────────────────────────────── */
function updateNav(){
  const u=API.user(), tok=API.tok(), nr=document.getElementById("nav-right"), mm=document.getElementById("mobile-menu");

  // If we already know the visitor's city (e.g. restored from session storage
  // by initNav()), make sure the "locked" city display is showing before we
  // touch anything else in the nav.
  if(FX && FX.city){
    lockCity(FX.city);
  }

  if(u && tok){
    // Logged in — show a greeting pill, a link to the right dashboard for
    // their role, and Log Out, both on desktop and inside the mobile menu.
    const dash=u.role==="admin"?"fixerr-owner-0si7erbb2ctq.html":u.role==="professional"?"dashboard-pro.html":"dashboard.html";
    const dashLabel=u.role==="admin"?"📊 Admin Panel":u.role==="professional"?"📊 Pro Dashboard":"📊 My Dashboard";
    const nameStr = u.name || u.first || "User";
    if(nr){
      nr.innerHTML=`<div style="display:flex;align-items:center;gap:0.4rem;background:var(--accent-light);border:1.5px solid var(--border-accent);border-radius:50px;padding:0.28rem 0.75rem 0.28rem 0.5rem;">
        <div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.65rem;flex-shrink:0;">${nameStr[0].toUpperCase()}</div>
        <span style="font-size:0.82rem;font-weight:700;color:var(--accent);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Hi, ${nameStr}</span>
      </div>
      <a href="${dash}" class="btn-ghost btn-sm">Dashboard</a>
      <button type="button" onclick="doLogout(event)" class="btn-ghost btn-sm" style="color:#DC2626;display:inline-flex;align-items:center;"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.15em;margin-right:0.4rem;"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>Log Out</button>`;
    }
    if(mm){
      mm.innerHTML=`<a href="index.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">Home</a>
      <a href="${dash}" style="display:block;padding:0.65rem 0;font-weight:700;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--border);">${dashLabel}</a>
      <a href="how-it-works.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">How It Works</a>
      <a href="register-pro.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">For Professionals</a>
      <a href="advertise.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">Advertise</a>
      <button type="button" onclick="doLogout(event)" style="display:block;width:100%;text-align:left;padding:0.65rem 0;font-weight:700;color:#DC2626;background:none;border:none;border-bottom:1px solid var(--border);cursor:pointer;font-size:0.95rem;"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-0.15em;margin-right:0.4rem;"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>Log Out</button>
      <a href="booking.html" style="display:block;margin-top:0.75rem;text-align:center;" class="btn-primary">Book a Service →</a>`;
    }
  } else {
    // Logged out — show Log In / Sign Up instead.
    if(nr){
      nr.innerHTML='<a href="login.html" class="btn-ghost btn-sm">Log In</a><a href="signup.html" class="btn-primary btn-sm">Sign Up Free</a>';
    }
    if(mm){
      mm.innerHTML=`<a href="index.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">Home</a>
      <a href="login.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">🔑 Log In</a>
      <a href="signup.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--accent);text-decoration:none;border-bottom:1px solid var(--border);">✨ Sign Up Free</a>
      <a href="how-it-works.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">How It Works</a>
      <a href="register-pro.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">For Professionals</a>
      <a href="advertise.html" style="display:block;padding:0.65rem 0;font-weight:600;color:var(--text);text-decoration:none;border-bottom:1px solid var(--border);">Advertise</a>
      <a href="booking.html" style="display:block;margin-top:0.75rem;text-align:center;" class="btn-primary">Book a Service →</a>`;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
   LOCATION — the country/city picker in the nav, and the "locked" display
   (flag + city name + a small "Change" link) shown once a city is chosen.
   ──────────────────────────────────────────────────────────────────────── */

// Makes the nav's own <select> controls agree with a city object that was
// set some other way (e.g. restored from storage) — picks the right country,
// repopulates the city dropdown for that country, then selects the right city.
function syncNavLocation(city){
  if(!city) return;
  const countryEl=document.getElementById("nav-country");
  const citySel=document.getElementById("nav-city-sel");

  if(countryEl){
    countryEl.value=city.c || "IN";
    onCountryChange();
  }
  if(citySel){
    for(let i=0; i<citySel.options.length; i++){
      const opt=citySel.options[i];
      if(opt.value && opt.value!=="📍 Select city"){
        try{
          const parsed=JSON.parse(opt.value);
          if(parsed.n===city.n){
            citySel.selectedIndex=i;
            break;
          }
        }catch(e){}
      }
    }
    citySel.disabled=false;
  }
}

// Fired when the visitor changes the Country <select> — repopulates the City
// <select> with only cities belonging to that country, alphabetically sorted.
function onCountryChange(){
  const cc=document.getElementById("nav-country")?.value;
  const sel=document.getElementById("nav-city-sel");
  if(!sel) return;
  sel.innerHTML='<option value="">📍 Select city</option>';
  if(!cc){sel.disabled=true;return;}
  const cities=CITIES.filter(c=>c.c===cc).sort((a,b)=>a.n.localeCompare(b.n));
  cities.forEach(c=>{const o=document.createElement("option");o.value=JSON.stringify(c);o.textContent=c.f+" "+c.n+(c.st?", "+c.st:"");sel.appendChild(o);});
  sel.disabled=false;
}

// Fired when the visitor picks a city from the City <select> — commits it via
// FX.set() (persists + repaints prices/currency) and switches the nav into
// its "locked" display for that city.
function onCityChange(){
  const v=document.getElementById("nav-city-sel").value;
  if(!v || v==="📍 Select city") return;
  try{
    const city=JSON.parse(v);
    FX.set(city);
    lockCity(city);
  }catch(e){}
}

// Swaps the nav from "pick a country/city" mode into "here's your chosen
// city, click Change to pick another" mode, and pre-fills any signup/
// registration form's city/state fields (read-only) so they match.
function lockCity(city){
  if(!city) return;
  syncNavLocation(city);
  const ui=document.getElementById("city-select-ui");
  const ld=document.getElementById("city-locked-display");
  const lbl=document.getElementById("city-locked-label");
  const cb=document.getElementById("city-change-btn");

  if(ui) ui.style.display="none";
  if(ld) ld.style.display="flex";
  if(cb) cb.style.display="inline";
  if(lbl){
    lbl.innerHTML='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(city.c==="IN"?"#FF6B35":"#3D8B37")+';margin-right:5px;"></span>'+city.f+' '+city.n+(city.st?'<span class="loc-state">, '+city.st+'</span>':"");
  }

  // Signup/registration/booking forms on various pages share these field id
  // prefixes (su-=signup, p-=pro registration, f-=forgot-password's own form);
  // lock them to the chosen city so the visitor can't accidentally mismatch
  // their nav location and their account's saved address.
  const stFields=['su-state','p-state','f-state'];
  const cityFields=['su-city','p-city','f-city'];
  stFields.forEach(id=>{const el=document.getElementById(id);if(el){el.value=city.st||'';el.readOnly=true;}});
  cityFields.forEach(id=>{const el=document.getElementById(id);if(el){el.value=city.n||'';el.readOnly=true;}});
  const nz=document.getElementById("nav-zip");
  const savedZip=localStorage.getItem("fx_zip")||"";
  if(nz){
    nz.placeholder=city.c==="IN"?"PIN":"ZIP";
    if(savedZip){ nz.value=savedZip; nz.style.display="inline-block"; }
    else { nz.value=""; nz.style.display="none"; }
  }
}

// The inverse of lockCity() — reveals the country/city pickers again (used by
// the "Change" link next to a locked city).
function unlockCity(){
  const ui=document.getElementById("city-select-ui");
  const ld=document.getElementById("city-locked-display");
  const cb=document.getElementById("city-change-btn");
  if(ui) ui.style.display="flex";
  if(ld) ld.style.display="none";
  if(cb) cb.style.display="none";
  const countryEl=document.getElementById("nav-country");
  if(countryEl) countryEl.value=FX.country||"IN";
  onCountryChange();
}

// Runs once per page load (from initSharedLayout(), after the header partial
// is in the DOM). Figures out which city to show: a city already saved for
// this browser session/device, or — for a logged-in user with no saved city
// yet — their account's own city. Falls back to "no city chosen" otherwise.
function initNav(){
  const s=sessionStorage.getItem("fx_c") || localStorage.getItem("fx_c");
  const u=API.user();
  let cityObj=null;

  if(s){
    try{ cityObj=JSON.parse(s); }catch(e){}
  }

  if(!cityObj && u && u.country){
    const userCityName=u.city || (u.country==='IN'?'Bengaluru':'New York');
    cityObj=CITIES.find(c=>c.c===u.country && c.n.toLowerCase()===userCityName.toLowerCase()) ||
            CITIES.find(c=>c.c===u.country);
  }

  if(cityObj){
    FX.city=cityObj;
    FX.country=cityObj.c;
    FX.currency=cityObj.cur;
    FX.symbol=cityObj.sym;
    FX.flag=cityObj.f;
    sessionStorage.setItem("fx_c", JSON.stringify(cityObj));
    localStorage.setItem("fx_c", JSON.stringify(cityObj));
    lockCity(cityObj);
    FX.paint();
  } else {
    FX.city = null;
    FX.country = "";
    FX.currency = "USD";
    FX.symbol = "$";
    const ui=document.getElementById("city-select-ui");
    const ld=document.getElementById("city-locked-display");
    const cb=document.getElementById("city-change-btn");
    if(ui) ui.style.display="flex";
    if(ld) ld.style.display="none";
    if(cb) cb.style.display="none";
    FX.paint();
  }
  updateNav();
}

/* ────────────────────────────────────────────────────────────────────────
   MOBILE NAV — hamburger menu open/close, and the mobile-only "Change city"
   bottom-sheet (the desktop nav uses the inline <select> dropdowns instead).
   ──────────────────────────────────────────────────────────────────────── */

function toggleMobileMenu(){
  const m=document.getElementById('mobile-menu');
  const btn=document.getElementById('ham-btn');
  if(!m)return;
  const open=m.style.display==='block';
  m.style.display=open?'none':'block';
  btn.setAttribute('aria-expanded',String(!open));
}
// Close menu when clicking outside
document.addEventListener('click',function(e){
  const m=document.getElementById('mobile-menu');
  const btn=document.getElementById('ham-btn');
  if(m&&m.style.display==='block'&&!m.contains(e.target)&&e.target!==btn&&!btn.contains(e.target)){
    m.style.display='none';
  }
});

// Builds and shows a bottom-sheet modal with a live-filtered city search,
// used on narrow screens instead of the desktop two-<select> picker.
function mobileChangeCity(){
  const modal=document.createElement('div');
  modal.id='city-change-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
  modal.innerHTML=`
    <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:1.5rem;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="font-size:1.1rem;font-weight:800;margin:0;">Change your city</h3>
        <button onclick="document.getElementById('city-change-modal').remove()" style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--muted);line-height:1;">✕</button>
      </div>
      <select id="ccm-country" style="width:100%;border:1.5px solid var(--border);border-radius:10px;padding:0.65rem 0.85rem;font-size:0.95rem;margin-bottom:0.75rem;background:#fff;" name="ccm-country" aria-label="Ccm country">
        <option value="US">🇺🇸 United States</option>
        <option value="IN">🇮🇳 India</option>
      </select>
      <input id="ccm-inp" type="text" placeholder="Type city name..." autocomplete="off"
        style="width:100%;border:1.5px solid var(--border);border-radius:10px;padding:0.65rem 0.85rem;font-size:0.95rem;box-sizing:border-box;margin-bottom:0.5rem;" name="ccm-inp" aria-label="Type city name...">
      <div id="ccm-results" style="border:1.5px solid var(--border);border-radius:10px;overflow:hidden;display:none;max-height:260px;overflow-y:auto;"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click',function(e){if(e.target===modal)modal.remove();});

  const CITIES=window._CITIES||[];
  const inp=document.getElementById('ccm-inp');
  const dd=document.getElementById('ccm-results');
  const countryEl=document.getElementById('ccm-country');
  // Pre-select current country
  if(FX.country)countryEl.value=FX.country;
  window._ccmMatches=[];

  inp.addEventListener('input',function(){
    const q=inp.value.toLowerCase().trim();
    const country=countryEl.value;
    if(q.length<1){dd.style.display='none';return;}
    window._ccmMatches=CITIES.filter(c=>c.c===country&&(c.n.toLowerCase().startsWith(q)||(c.st||'').toLowerCase().startsWith(q))).slice(0,10);
    if(!window._ccmMatches.length){dd.style.display='none';return;}
    dd.innerHTML=window._ccmMatches.map((c,i)=>`
      <div onclick="pickCCMCity(${i})" style="padding:0.7rem 0.85rem;cursor:pointer;font-size:0.9rem;border-bottom:1px solid var(--border);active:background:var(--accent-light);">
        ${c.n}${c.st?', '+c.st:''} <span style="color:var(--muted);font-size:0.75rem;">${c.c==='IN'?'India':'US'}</span>
      </div>`).join('');
    dd.style.display='block';
  });
  countryEl.addEventListener('change',function(){inp.value='';dd.style.display='none';inp.focus();});
  setTimeout(()=>inp.focus(),300);
}

// Called when a visitor taps one of the search results inside the mobile
// "Change city" modal.
function pickCCMCity(i){
  const city=window._ccmMatches&&window._ccmMatches[i];
  if(!city)return;
  FX.set(city);
  const modal=document.getElementById('city-change-modal');
  if(modal)modal.remove();
  if(typeof updateNav==='function')updateNav();
  if(typeof lockCity==='function')lockCity(city);
}

/* ────────────────────────────────────────────────────────────────────────
   SHARED LAYOUT LOADER — fetches header.html/footer.html and injects them
   into the page, THEN runs the nav startup above (which needs those
   elements to already exist in the DOM).
   ──────────────────────────────────────────────────────────────────────── */

// Fetches one HTML partial and drops its markup into the element with the
// given id. Returns a promise so callers can wait for it to finish before
// touching anything inside the injected markup.
async function loadPartial(targetId, file){
  const el = document.getElementById(targetId);
  if(!el) return;
  try{
    const res = await fetch(file);
    el.innerHTML = await res.text();
  }catch(e){
    console.error('Could not load shared layout partial:', file, e);
  }
}

// Call this once, on DOMContentLoaded, from every public page:
//   document.addEventListener("DOMContentLoaded", initSharedLayout);
// It loads the shared header/footer into <div id="site-header"></div> and
// <div id="site-footer"></div> (both must already be present in the page's
// own HTML as empty placeholders), and only once BOTH have finished loading
// does it call updateNav()/initNav() — those functions reach into elements
// (#nav-country, #nav-right, #mobile-menu, etc.) that only exist after the
// header partial has actually been injected into the page.
async function initSharedLayout(){
  await Promise.all([
    loadPartial('site-header', 'header.html'),
    loadPartial('site-footer', 'footer.html')
  ]);
  updateNav();
  initNav();
}
