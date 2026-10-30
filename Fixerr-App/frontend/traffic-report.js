/* ============================================================================
   traffic-report.js — Admin "Traffic Report" (Revenue & Reports → Traffic Report)
   Renders into <div class="admin-sec" id="sec-traffic"></div> on the admin page.
   Data: GET /api/admin/traffic/summary and GET /api/admin/traffic/visitors
   (backend/routes/trafficRoutes.js). Uses the admin page's global API helper and
   existing card classes (dash-card, stats-grid, stat-card, btn-primary).
   ============================================================================ */
(function () {
  "use strict";

  const PAGE_SIZE = 25;
  const EXPORT_LIMIT = 5000;
  const C = { green: "#3d8b37", green2: "#2e6b2a", navy: "#092555", navy2: "#1d4a8f", amber: "#f59e0b", grid: "#eef0ea", muted: "#9ca3af" };
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const PAGE_NAMES = {
    "/index.html": "Home", "/booking.html": "Booking", "/signup.html": "Sign up", "/login.html": "Log in",
    "/register-pro.html": "Join as Pro", "/how-it-works.html": "How it works", "/about.html": "About",
    "/contact-us.html": "Contact us", "/advertise.html": "Advertise", "/terms.html": "Terms",
    "/chat.html": "Chat", "/forgot-password.html": "Forgot password", "/reset-password.html": "Reset password",
  };
  const COUNTRY_NAMES = { IN: "India", US: "United States" };

  let rendered = false;
  let loadedOnce = false;
  let filters = null;
  let historyPage = 1;
  let historySearch = "";
  let searchTimer = null;
  let summaryReq = 0;
  let historyReq = 0;

  // ── helpers ────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmt = (n) => (Number(n) || 0).toLocaleString("en-IN");
  const pct = (a, b, d = 0) => (b ? ((a / b) * 100).toFixed(d) : "0");
  const pageName = (p) => PAGE_NAMES[p] || p || "—";
  const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const shortDay = (s) => { const d = new Date(s + "T00:00:00"); return d.getDate() + " " + d.toLocaleString("en-US", { month: "short" }); };
  const dateTime = (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      '<div class="tr-sub">' + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + "</div>";
  };
  const plainDateTime = (s) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const emptyMsg = (t) => '<div class="tr-empty">' + esc(t || "No visits recorded for this period.") + "</div>";

  function barRows(items, colorClass) {
    if (!items.length) return emptyMsg();
    const max = Math.max(...items.map((i) => i.value), 1);
    return items.map((i) =>
      '<div class="tr-bar-row"><span title="' + esc(i.label) + '">' + esc(i.label) + "</span>" +
      '<div class="tr-bar ' + (colorClass || "") + '"><span style="width:' + Math.max((i.value / max) * 100, 2) + '%"></span></div>' +
      '<span class="tr-num">' + fmt(i.value) + "</span></div>").join("");
  }

  // ── layout ─────────────────────────────────────────────────────────────
  function injectStyles() {
    if ($("tr-styles")) return;
    const st = document.createElement("style");
    st.id = "tr-styles";
    st.textContent = `
      #sec-traffic .tr-head{font-size:1.35rem;font-weight:800;margin-bottom:.15rem}
      #sec-traffic .tr-intro{color:var(--muted);font-size:.86rem;margin-bottom:1.2rem}
      #sec-traffic .tr-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:1rem;align-items:end;background:var(--bg2);padding:1.25rem;border-radius:var(--radius-sm)}
      #sec-traffic .tr-filters label{font-size:.8rem;font-weight:700;display:block;margin-bottom:.3rem}
      #sec-traffic .tr-filters select,#sec-traffic .tr-filters input{width:100%;border:1.5px solid var(--border);border-radius:8px;padding:.65rem;background:#fff;font:inherit}
      #sec-traffic .tr-chips{display:flex;gap:.45rem;margin-top:.85rem;flex-wrap:wrap}
      #sec-traffic .tr-chip{border:1.5px solid var(--border);background:#fff;border-radius:50px;padding:.3rem .8rem;font-size:.76rem;font-weight:600;color:var(--muted);cursor:pointer}
      #sec-traffic .tr-chip.on{border-color:var(--accent);background:var(--accent-light);color:var(--accent2)}
      #sec-traffic .tr-status{font-size:.8rem;color:var(--muted);margin:.7rem 0 0}
      #sec-traffic .tr-status.err{color:#dc2626;font-weight:600}
      #sec-traffic .tr-stats{grid-template-columns:repeat(4,1fr)}
      #sec-traffic .tr-row{display:grid;gap:1.15rem;margin-bottom:1.15rem;align-items:stretch}
      #sec-traffic .tr-row > .dash-card{margin-bottom:0;min-width:0}
      #sec-traffic .tr-row-2{grid-template-columns:1.75fr 1fr}
      #sec-traffic .tr-row-3{grid-template-columns:1fr 1fr 1fr}
      #sec-traffic .tr-row-3w{grid-template-columns:.85fr 1.35fr .95fr}
      #sec-traffic .tr-legend{display:flex;gap:.9rem;font-size:.72rem;color:var(--muted);font-weight:600;flex-wrap:wrap}
      #sec-traffic .tr-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:.35rem;vertical-align:middle}
      #sec-traffic .tr-sub{font-size:.7rem;color:var(--muted2);font-weight:500}
      #sec-traffic .tr-bar-row{display:grid;grid-template-columns:110px 1fr 58px;gap:.6rem;align-items:center;margin-bottom:.55rem;font-size:.8rem}
      #sec-traffic .tr-bar-row > span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #sec-traffic .tr-bar{height:10px;background:var(--bg3);border-radius:6px;overflow:hidden}
      #sec-traffic .tr-bar > span{display:block;height:100%;border-radius:6px;background:var(--accent)}
      #sec-traffic .tr-bar.navy > span{background:${C.navy}}
      #sec-traffic .tr-num{text-align:right;font-weight:700}
      #sec-traffic .tr-empty{font-size:.8rem;color:var(--muted);padding:1.2rem 0;text-align:center}
      #sec-traffic .tr-fa-row{margin-bottom:.75rem}
      #sec-traffic .tr-fa-top{display:flex;justify-content:space-between;gap:.5rem;font-size:.8rem;margin-bottom:.25rem}
      #sec-traffic .tr-track{height:13px;background:var(--bg3);border-radius:8px;overflow:hidden}
      #sec-traffic .tr-track span{display:block;height:100%;border-radius:8px}
      #sec-traffic .tr-drop{font-size:.68rem;color:#dc2626;margin-top:.2rem;text-align:right}
      #sec-traffic .tr-note{margin-top:.6rem;font-size:.74rem;background:var(--accent-light);border-radius:8px;padding:.5rem .65rem;color:#1F5020}
      #sec-traffic .tr-days{display:grid;grid-template-columns:repeat(7,1fr);gap:.35rem}
      #sec-traffic .tr-day{border-radius:10px;padding:.5rem .15rem;text-align:center;border:1px solid var(--border)}
      #sec-traffic .tr-day .n{font-size:.68rem;font-weight:700}
      #sec-traffic .tr-day .v{font-size:1rem;font-weight:800;margin:.15rem 0 .03rem}
      #sec-traffic .tr-day .a{font-size:.58rem;opacity:.85}
      #sec-traffic .tr-day.best{outline:2.5px solid ${C.amber};outline-offset:1px}
      #sec-traffic .tr-split{display:grid;grid-template-columns:60px repeat(7,1fr);gap:.3rem;align-items:center;margin-top:.55rem;font-size:.68rem}
      #sec-traffic .tr-split .c{border-radius:6px;text-align:center;padding:.25rem 0;font-weight:700}
      #sec-traffic .tr-insight{background:var(--accent-light);border:1px solid rgba(61,139,55,.25);border-radius:10px;padding:.65rem .85rem;font-size:.79rem;margin-bottom:.55rem;color:#1F5020}
      #sec-traffic .tr-insight.warn{background:#FEF3C7;border-color:#FDE68A;color:#92400E}
      #sec-traffic table.tr-table{width:100%;border-collapse:collapse;font-size:.8rem}
      #sec-traffic table.tr-table th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:.55rem .55rem;border-bottom:1.5px solid var(--border);background:var(--bg2);white-space:nowrap}
      #sec-traffic table.tr-table td{padding:.55rem .55rem;border-bottom:1px solid var(--border);vertical-align:top}
      #sec-traffic table.tr-table td.r,#sec-traffic table.tr-table th.r{text-align:right}
      #sec-traffic .tr-rate{display:flex;align-items:center;gap:.5rem}
      #sec-traffic .tr-rate .tr-bar{flex:1;height:8px}
      #sec-traffic .tr-scroll{max-height:540px;overflow:auto;border:1px solid var(--border);border-radius:10px}
      #sec-traffic .tr-scroll table.tr-table{min-width:1500px}
      #sec-traffic .tr-scroll table.tr-table th{position:sticky;top:0;z-index:1}
      #sec-traffic .tr-scroll table.tr-table td{white-space:nowrap}
      #sec-traffic .tr-badge{border-radius:50px;padding:.14rem .55rem;font-size:.68rem;font-weight:700;white-space:nowrap}
      #sec-traffic .tr-b-cust{background:#DBEAFE;color:#1D4ED8}
      #sec-traffic .tr-b-pro{background:var(--accent-light);color:var(--accent2)}
      #sec-traffic .tr-b-admin{background:#FEE2E2;color:#B91C1C}
      #sec-traffic .tr-b-anon{background:#F3F4F6;color:#4B5563}
      #sec-traffic .tr-tools{display:flex;gap:.5rem;align-items:center}
      #sec-traffic .tr-tools input{width:240px;padding:.45rem .65rem;border:1.5px solid var(--border);border-radius:8px;font:inherit;font-size:.8rem}
      #sec-traffic .tr-btn-ghost{background:#fff;color:var(--text);border:1.5px solid var(--border);border-radius:10px;padding:.45rem .9rem;font-weight:600;font-size:.8rem;cursor:pointer}
      #sec-traffic .tr-btn-ghost:disabled{opacity:.5;cursor:default}
      #sec-traffic .tr-pager{display:flex;justify-content:space-between;align-items:center;margin-top:.8rem;font-size:.78rem;color:var(--muted)}
      #sec-traffic .tr-loading{opacity:.55;transition:opacity .2s}
      @media (max-width:1200px){
        #sec-traffic .tr-row-2,#sec-traffic .tr-row-3,#sec-traffic .tr-row-3w{grid-template-columns:1fr 1fr}
        #sec-traffic .tr-row-2 > .dash-card:first-child{grid-column:1 / -1}
      }
      @media (max-width:800px){
        #sec-traffic .tr-filters{grid-template-columns:repeat(2,minmax(0,1fr))}
        #sec-traffic .tr-stats{grid-template-columns:1fr 1fr}
        #sec-traffic .tr-row-2,#sec-traffic .tr-row-3,#sec-traffic .tr-row-3w{grid-template-columns:1fr}
      }`;
    document.head.appendChild(st);
  }

  function card(id, title, extra) {
    return '<div class="dash-card" id="' + id + '"><div class="dash-card-title"><span>' + title + "</span>" + (extra || "") + '</div><div class="tr-body"></div></div>';
  }

  function renderShell() {
    const sec = $("sec-traffic");
    if (!sec || rendered) return;
    injectStyles();
    const statCard = (id, label) => '<div class="stat-card"><div class="stat-lbl">' + label + '</div><div class="stat-val" id="tr-k-' + id + '">—</div><div class="stat-sub" id="tr-k-' + id + '-sub">&nbsp;</div></div>';
    sec.innerHTML =
      '<div class="tr-head">🌐 Traffic Report</div>' +
      '<div class="tr-intro">Who visited Fixerr, where they came from, and how many became registered users. Bots are excluded.</div>' +
      '<div class="dash-card">' +
        '<div class="tr-filters">' +
          '<div><label for="tr-country">Country</label><select id="tr-country"><option value="">All countries</option><option value="IN">India</option><option value="US">United States</option></select></div>' +
          '<div><label for="tr-type">Visitor Type</label><select id="tr-type"><option value="all">All visitors</option><option value="registered">Registered</option><option value="anonymous">Not registered</option></select></div>' +
          '<div><label for="tr-start">Start Date</label><input type="date" id="tr-start"></div>' +
          '<div><label for="tr-end">End Date</label><input type="date" id="tr-end"></div>' +
          '<button type="button" class="btn-primary" id="tr-generate" style="padding:.7rem 1.5rem;font-weight:700">📊 Generate Report</button>' +
        "</div>" +
        '<div class="tr-chips" id="tr-chips">' +
          '<span class="tr-chip" data-range="today">Today</span><span class="tr-chip" data-range="7">Last 7 days</span>' +
          '<span class="tr-chip" data-range="30">Last 30 days</span><span class="tr-chip" data-range="month">This month</span>' +
          '<span class="tr-chip" data-range="90">Last 90 days</span>' +
        "</div>" +
        '<div class="tr-status" id="tr-status"></div>' +
      "</div>" +
      '<div id="tr-report">' +
        '<div class="stats-grid tr-stats">' +
          statCard("visitors", "Unique Visitors") + statCard("views", "Page Views") + statCard("registered", "Registered Visitors") + statCard("signups", "New Signups from Visitors") +
          statCard("sessions", "Sessions") + statCard("returning", "Returning Visitors") + statCard("single", "Single-page Sessions") + statCard("bots", "Bots Filtered") +
        "</div>" +
        '<div class="tr-row tr-row-2">' +
          card("tr-trend", "📅 Daily Visitors &amp; Page Views",
            '<span class="tr-legend"><span><span class="tr-dot" style="background:' + C.green + '"></span>Visitors</span><span><span class="tr-dot" style="background:' + C.navy + '"></span>Page views</span><span><span class="tr-dot" style="background:' + C.amber + '"></span>Signups</span></span>') +
          card("tr-funnel", "🎯 Visitor → Customer Funnel") +
        "</div>" +
        '<div class="tr-row tr-row-3">' +
          card("tr-sources", "🔗 Traffic Sources") + card("tr-cities", "📍 Top Cities", '<span class="tr-sub" id="tr-country-split"></span>') + card("tr-devices", "📱 Devices") +
        "</div>" +
        '<div class="tr-row tr-row-3w">' +
          card("tr-pages", "📄 Top Pages") + card("tr-days", "📆 Peak Visit Days", '<span class="tr-sub" id="tr-days-range"></span>') + card("tr-insights", "💡 Strategy Insights") +
        "</div>" +
        card("tr-rate", "💰 Signup Rate by Source", '<span class="tr-sub">Which channel brings visitors who actually sign up</span>') +
        '<div class="dash-card" id="tr-history"><div class="dash-card-title"><span>🧾 Visitor History</span>' +
          '<span class="tr-tools"><input id="tr-search" type="search" placeholder="Search name, email, city, PIN, campaign…" aria-label="Search visitors">' +
          '<button type="button" class="tr-btn-ghost" id="tr-csv">📥 Download CSV</button></span></div>' +
          '<div class="tr-scroll"><table class="tr-table"><thead><tr>' +
            "<th>Visitor</th><th>Type</th><th>Email</th><th>First Seen</th><th>Last Seen</th><th class=\"r\">Sessions</th><th class=\"r\">Page Views</th>" +
            "<th>Landing Page</th><th>Last Page</th><th>Area</th><th>City</th><th>State</th><th>Country</th><th>PIN / ZIP</th><th>Location By</th>" +
            "<th>Source</th><th>Campaign</th><th>Device</th><th>Browser</th><th>OS</th><th>Signed Up</th>" +
          '</tr></thead><tbody id="tr-history-body"></tbody></table></div>' +
          '<div class="tr-pager"><span id="tr-pager-info"></span><span style="display:flex;gap:.4rem"><button type="button" class="tr-btn-ghost" id="tr-prev">‹ Prev</button><button type="button" class="tr-btn-ghost" id="tr-next">Next ›</button></span></div>' +
        "</div>" +
      "</div>";

    $("tr-generate").addEventListener("click", generate);
    $("tr-chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".tr-chip");
      if (chip) setRange(chip.getAttribute("data-range"));
    });
    ["tr-start", "tr-end"].forEach((id) => $(id).addEventListener("change", () => markChip(null)));
    $("tr-search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { historySearch = $("tr-search").value.trim(); historyPage = 1; loadHistory(); }, 350);
    });
    $("tr-prev").addEventListener("click", () => { if (historyPage > 1) { historyPage--; loadHistory(); } });
    $("tr-next").addEventListener("click", () => { historyPage++; loadHistory(); });
    $("tr-csv").addEventListener("click", downloadCsv);
    setRange("30");
    rendered = true;
  }

  function markChip(range) {
    document.querySelectorAll("#tr-chips .tr-chip").forEach((c) => c.classList.toggle("on", c.getAttribute("data-range") === range));
  }

  // Quick ranges only fill the dates; the report updates on Generate Report.
  function setRange(range) {
    const end = new Date();
    const start = new Date();
    if (range === "today") { /* same day */ }
    else if (range === "month") start.setDate(1);
    else start.setDate(end.getDate() - (Number(range) - 1));
    $("tr-start").value = ymd(start);
    $("tr-end").value = ymd(end);
    markChip(range);
  }

  function readFilters() {
    return { country: $("tr-country").value, type: $("tr-type").value, start: $("tr-start").value, end: $("tr-end").value };
  }

  function qs(f, extra) {
    const p = new URLSearchParams();
    if (f.country) p.set("country", f.country);
    p.set("type", f.type || "all");
    if (f.start) p.set("start", f.start);
    if (f.end) p.set("end", f.end);
    Object.entries(extra || {}).forEach(([k, v]) => { if (v !== "" && v != null) p.set(k, v); });
    return p.toString();
  }

  function setStatus(msg, isErr) {
    const s = $("tr-status");
    s.textContent = msg || "";
    s.className = "tr-status" + (isErr ? " err" : "");
  }

  // ── generate ───────────────────────────────────────────────────────────
  async function generate() {
    const f = readFilters();
    if (!f.start || !f.end) return setStatus("Please choose a start and end date.", true);
    if (f.start > f.end) return setStatus("Start date must be on or before the end date.", true);
    filters = f;
    historyPage = 1;
    const id = ++summaryReq;
    const btn = $("tr-generate");
    btn.disabled = true;
    $("tr-report").classList.add("tr-loading");
    setStatus("Generating report…");
    try {
      const data = await API.get("/api/admin/traffic/summary?" + qs(f));
      if (id !== summaryReq) return;
      renderSummary(data);
      const rangeTxt = shortDay(data.filters.start) + " – " + shortDay(data.filters.end) + " " + data.filters.end.slice(0, 4);
      setStatus("Report for " + rangeTxt + (f.country ? " · " + COUNTRY_NAMES[f.country] : " · All countries") +
        (f.type !== "all" ? " · " + (f.type === "registered" ? "Registered" : "Not registered") + " visitors" : "") +
        " · generated " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      if (id === summaryReq) setStatus(e.message || "Could not load the traffic report.", true);
    } finally {
      if (id === summaryReq) { btn.disabled = false; $("tr-report").classList.remove("tr-loading"); }
    }
    loadHistory();
  }

  function setKpi(id, val, sub, subColor) {
    $("tr-k-" + id).textContent = val;
    const s = $("tr-k-" + id + "-sub");
    s.innerHTML = sub || "&nbsp;";
    s.style.color = subColor || "";
  }

  function renderSummary(d) {
    const k = d.kpis;
    const change = k.prev_visitors ? ((k.visitors - k.prev_visitors) / k.prev_visitors) * 100 : null;
    const span = d.filters.span;
    setKpi("visitors", fmt(k.visitors),
      change === null ? "No visits in previous " + span + " days" : (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(0) + "% vs previous " + span + " days",
      change !== null && change < 0 ? "#dc2626" : "");
    setKpi("views", fmt(k.page_views), (k.sessions ? (k.page_views / k.sessions).toFixed(1) : "0") + " pages per session");
    setKpi("registered", fmt(k.registered), pct(k.registered, k.visitors, 1) + "% of visitors");
    setKpi("signups", fmt(k.signups), pct(k.signups, k.visitors, 1) + "% visitor → signup");
    setKpi("sessions", fmt(k.sessions), (k.visitors ? (k.sessions / k.visitors).toFixed(1) : "0") + " sessions per visitor");
    setKpi("returning", pct(k.returning, k.visitors) + "%", fmt(k.returning) + " came back");
    setKpi("single", pct(k.single_sessions, k.sessions) + "%", fmt(k.single_sessions) + " left after 1 page", k.sessions && k.single_sessions / k.sessions > 0.4 ? "#dc2626" : "");
    setKpi("bots", fmt(k.bots), "Excluded from all numbers", "var(--muted)");

    renderTrend(d.daily);
    renderFunnel(d.funnel);
    renderSources(d.sources);
    renderCities(d.cities, d.countries);
    renderDevices(d.devices, d.top_browser);
    renderPages(d.pages);
    renderDays(d.weekdays, d.filters);
    renderInsights(d);
    renderRate(d.sources);
  }

  const body = (id) => $(id).querySelector(".tr-body");

  // Trend: visitors area + page-view line (shared left axis), signups as amber bars on their own scale.
  function renderTrend(daily) {
    const el = body("tr-trend");
    if (!daily.some((x) => x.visitors || x.page_views)) { el.innerHTML = emptyMsg(); return; }
    const W = 680, H = 240, P = { l: 40, r: 12, t: 12, b: 26 };
    const n = daily.length;
    const max = Math.max(...daily.map((x) => x.page_views), 1) * 1.1;
    const maxSu = Math.max(...daily.map((x) => x.signups), 1);
    const step = n > 1 ? (W - P.l - P.r) / (n - 1) : 0;
    const x = (i) => (n > 1 ? P.l + i * step : (P.l + W - P.r) / 2);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const suH = (v) => (v / maxSu) * (H - P.t - P.b) * 0.3;
    let g = "";
    for (let t = 0; t <= 4; t++) {
      const v = (max * t) / 4;
      g += '<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + C.grid + '"/>' +
        '<text x="' + (P.l - 6) + '" y="' + (y(v) + 3) + '" font-size="9" text-anchor="end" fill="' + C.muted + '">' + Math.round(v) + "</text>";
    }
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    daily.forEach((dd, i) => {
      if (i % labelEvery === 0 || i === n - 1) g += '<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="9" text-anchor="middle" fill="' + C.muted + '">' + shortDay(dd.day) + "</text>";
    });
    const bw = Math.max(2, Math.min(10, step * 0.5 || 10));
    daily.forEach((dd, i) => {
      if (dd.signups) g += '<rect x="' + (x(i) - bw / 2) + '" y="' + (y(0) - suH(dd.signups)) + '" width="' + bw + '" height="' + suH(dd.signups) + '" fill="' + C.amber + '" opacity=".8" rx="1.5"/>';
    });
    const pts = (key) => daily.map((dd, i) => x(i) + "," + y(dd[key])).join(" ");
    g += '<polygon fill="rgba(61,139,55,.12)" points="' + x(0) + "," + y(0) + " " + pts("visitors") + " " + x(n - 1) + "," + y(0) + '"/>';
    g += '<polyline fill="none" stroke="' + C.navy + '" stroke-width="2" stroke-linejoin="round" points="' + pts("page_views") + '"/>';
    g += '<polyline fill="none" stroke="' + C.green + '" stroke-width="2.5" stroke-linejoin="round" points="' + pts("visitors") + '"/>';
    if (n <= 62) daily.forEach((dd, i) => { g += '<circle cx="' + x(i) + '" cy="' + y(dd.visitors) + '" r="2.4" fill="' + C.green + '"/>'; });
    const hw = n > 1 ? step : W - P.l - P.r;
    daily.forEach((dd, i) => {
      g += '<rect x="' + (x(i) - hw / 2) + '" y="' + P.t + '" width="' + hw + '" height="' + (H - P.t - P.b) + '" fill="transparent"><title>' +
        esc(shortDay(dd.day) + ": " + fmt(dd.visitors) + " visitors · " + fmt(dd.page_views) + " page views · " + fmt(dd.signups) + " signups") + "</title></rect>";
    });
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="Daily visitors and page views">' + g + "</svg>";
  }

  function renderFunnel(fn) {
    const steps = [
      { l: "Visited site", v: fn.visited, ic: "👀", c: C.navy },
      { l: "Engaged (2+ pages or booking / signup)", v: fn.engaged, ic: "📄", c: C.navy2 },
      { l: "Opened booking / signup", v: fn.intent, ic: "📝", c: C.green2 },
      { l: "Signed up", v: fn.signed_up, ic: "✅", c: C.green },
    ];
    const el = body("tr-funnel");
    if (!fn.visited) { el.innerHTML = emptyMsg(); return; }
    el.innerHTML = steps.map((s, i) => {
      const p = (s.v / fn.visited) * 100;
      const lost = i ? Math.max(steps[i - 1].v - s.v, 0) : 0;
      return '<div class="tr-fa-row"><div class="tr-fa-top"><span>' + s.ic + " " + s.l + "</span><span><b>" + fmt(s.v) + "</b> · " + p.toFixed(p < 10 ? 1 : 0) + "%</span></div>" +
        '<div class="tr-track"><span style="width:' + Math.max(p, 1.5) + "%;background:" + s.c + '"></span></div>' +
        (i ? '<div class="tr-drop">▼ ' + fmt(lost) + " lost (" + pct(lost, steps[i - 1].v) + "% of previous step)</div>" : "") + "</div>";
    }).join("") + '<div class="tr-note">Overall conversion: <b>' + pct(fn.signed_up, fn.visited, 1) + "%</b> of visitors signed up</div>";
  }

  function renderSources(sources) {
    body("tr-sources").innerHTML = barRows(sources.slice(0, 6).map((s) => ({ label: s.source, value: s.visitors })), "navy");
  }

  function renderCities(cities, countries) {
    body("tr-cities").innerHTML = barRows(cities.map((c) => ({ label: c.city + (c.country && c.country !== "IN" ? ", " + c.country : ""), value: c.visitors })));
    const total = countries.reduce((a, c) => a + c.visitors, 0);
    $("tr-country-split").textContent = countries.filter((c) => c.country !== "—").slice(0, 3)
      .map((c) => (COUNTRY_NAMES[c.country] ? c.country : c.country) + " " + pct(c.visitors, total) + "%").join(" · ");
  }

  function renderDevices(devices, topBrowser) {
    const el = body("tr-devices");
    const total = devices.reduce((a, d) => a + d.visitors, 0);
    if (!total) { el.innerHTML = emptyMsg(); return; }
    const order = [["mobile", "Mobile", C.green], ["desktop", "Desktop", C.navy], ["tablet", "Tablet", C.amber]];
    let offset = 25, rings = "", legend = "";
    order.forEach(([key, label, color]) => {
      const v = (devices.find((d) => d.device === key) || {}).visitors || 0;
      const share = (v / total) * 100;
      if (share > 0) rings += '<circle cx="21" cy="21" r="15.9155" fill="none" stroke="' + color + '" stroke-width="6" stroke-dasharray="' + share + " " + (100 - share) + '" stroke-dashoffset="' + offset + '"/>';
      offset -= share;
      legend += '<div><span class="tr-dot" style="background:' + color + '"></span>' + label + " <b>" + share.toFixed(0) + "%</b> <span class=\"tr-sub\">· " + fmt(v) + "</span></div>";
    });
    const top = order.map(([key, label]) => ({ label, v: (devices.find((d) => d.device === key) || {}).visitors || 0 })).sort((a, b) => b.v - a.v)[0];
    el.innerHTML = '<div style="display:flex;align-items:center;gap:1.1rem">' +
      '<svg viewBox="0 0 42 42" width="124" height="124"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="' + C.grid + '" stroke-width="6"/>' + rings +
      '<text x="21" y="22.5" text-anchor="middle" font-size="6" font-weight="800" fill="#1a1d1a">' + pct(top.v, total) + "%</text>" +
      '<text x="21" y="27.5" text-anchor="middle" font-size="3.2" fill="#6b7280">' + esc(top.label) + "</text></svg>" +
      '<div style="font-size:.8rem;line-height:1.9">' + legend +
      (topBrowser ? '<div class="tr-sub" style="margin-top:.3rem">Top browser: ' + esc(topBrowser.browser) + " " + pct(topBrowser.visitors, total) + "%</div>" : "") +
      "</div></div>";
  }

  function renderPages(pages) {
    body("tr-pages").innerHTML = barRows(pages.map((p) => ({ label: pageName(p.page_path), value: p.views })));
  }

  function renderDays(wd, f) {
    const el = body("tr-days");
    $("tr-days-range").textContent = shortDay(f.start) + " – " + shortDay(f.end);
    if (!wd.some((d) => d.total)) { el.innerHTML = emptyMsg(); return; }
    const avg = wd.map((d) => (d.days ? d.total / d.days : 0));
    const maxAvg = Math.max(...avg, 1);
    const best = avg.indexOf(Math.max(...avg));
    const most = wd.reduce((b, d, i) => (d.total > wd[b].total ? i : b), 0);
    let h = '<div class="tr-days">' + wd.map((d, i) => {
      const r = avg[i] / maxAvg;
      return '<div class="tr-day' + (i === best ? " best" : "") + '" style="background:rgba(61,139,55,' + (0.1 + 0.85 * r).toFixed(2) + ");color:" + (r > 0.7 ? "#fff" : "#1a1d1a") + '" title="' +
        WEEKDAYS[i] + ": " + fmt(d.total) + " visitors over " + d.days + " day(s)" + '"><div class="n">' + WEEKDAYS[i] + '</div><div class="v">' + fmt(d.total) + '</div><div class="a">avg ' + (d.days ? Math.round(avg[i]) : 0) + "/day</div></div>";
    }).join("") + "</div>";
    if (!f.country) {
      const cell = (v, m, rgb) => '<div class="c" style="background:rgba(' + rgb + "," + (0.1 + 0.8 * (m ? v / m : 0)).toFixed(2) + ");color:" + (m && v / m > 0.7 ? "#fff" : "#1a1d1a") + '">' + fmt(v) + "</div>";
      const mIn = Math.max(...wd.map((d) => d.india)), mUs = Math.max(...wd.map((d) => d.us));
      h += '<div class="tr-split"><div>🇮🇳 India</div>' + wd.map((d) => cell(d.india, mIn, "61,139,55")).join("") +
        '<div>🇺🇸 US</div>' + wd.map((d) => cell(d.us, mUs, "9,37,85")).join("") + "</div>";
    }
    h += '<div class="tr-note">📌 <b>' + WEEKDAYS[best] + "</b> has the highest average (" + Math.round(avg[best]) + " visitors per " + WEEKDAYS[best] + ")" +
      (most !== best ? "; <b>" + WEEKDAYS[most] + "</b> has the most visits in total." : ".") + "</div>";
    el.innerHTML = h;
  }

  function renderInsights(d) {
    const out = [];
    const k = d.kpis;
    if (!k.visitors) { body("tr-insights").innerHTML = emptyMsg("Insights appear once visits are recorded."); return; }
    const rated = d.sources.filter((s) => s.visitors >= 20);
    if (rated.length >= 2) {
      const byRate = rated.slice().sort((a, b) => b.signups / b.visitors - a.signups / a.visitors);
      const top = byRate[0], biggest = rated[0];
      if (top.signups && top.source !== biggest.source && biggest.signups) {
        out.push(["", "📈 " + top.source + " visitors sign up " + ((top.signups / top.visitors) / (biggest.signups / biggest.visitors)).toFixed(1) + "× more than " + biggest.source + " visitors — consider more " + top.source + " promotion."]);
      } else if (top.signups) {
        out.push(["", "📈 " + top.source + " has the best signup rate (" + pct(top.signups, top.visitors, 1) + "%)."]);
      }
    } else if (d.sources[0]) {
      out.push(["", "🔗 Most visitors come from " + d.sources[0].source + " (" + pct(d.sources[0].visitors, k.visitors) + "%)."]);
    }
    const wd = d.weekdays;
    const avg = wd.map((x) => (x.days ? x.total / x.days : 0));
    const best = avg.indexOf(Math.max(...avg));
    const weekdayAvg = avg.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const weekendAvg = (avg[5] + avg[6]) / 2;
    if (avg[best] > 0) {
      let t = "📆 " + WEEKDAYS[best] + "s are your busiest day";
      if (weekdayAvg > 0 && weekendAvg < weekdayAvg * 0.8) t += "; weekends are " + pct(weekdayAvg - weekendAvg, weekdayAvg) + "% lower — try weekend offers.";
      else t += " — schedule posts and promos then.";
      out.push(["", t]);
    }
    if (d.cities[0]) {
      const c = d.cities[0];
      if (d.top_city_pros !== null && d.top_city_pros < 10) out.push(["", "📍 " + c.city + " has " + fmt(c.visitors) + " visitors but only " + d.top_city_pros + " approved pro" + (d.top_city_pros === 1 ? "" : "s") + " — recruit pros there."]);
      else out.push(["", "📍 " + c.city + " is your top city with " + fmt(c.visitors) + " visitors."]);
    }
    if (k.sessions && k.single_sessions / k.sessions > 0.4) {
      out.push(["warn", "⚠️ " + pct(k.single_sessions, k.sessions) + "% of visits leave after one page — review the landing page" + (pageName(d.pages[0] && d.pages[0].page_path) ? " (" + pageName(d.pages[0] && d.pages[0].page_path) + ")" : "") + "."]);
    }
    if (k.visitors && k.signups / k.visitors < 0.02) out.push(["warn", "🧲 Only " + pct(k.signups, k.visitors, 1) + "% of visitors signed up — add a clear signup prompt on popular pages."]);
    body("tr-insights").innerHTML = out.slice(0, 4).map(([cls, t]) => '<div class="tr-insight ' + cls + '">' + esc(t) + "</div>").join("");
  }

  function renderRate(sources) {
    const el = body("tr-rate");
    if (!sources.length) { el.innerHTML = emptyMsg(); return; }
    const rows = sources.slice(0, 10);
    const maxRate = Math.max(...rows.map((s) => (s.visitors ? s.signups / s.visitors : 0)), 0.0001);
    el.innerHTML = '<table class="tr-table"><thead><tr><th>Source</th><th class="r">Visitors</th><th class="r">Signups</th><th class="r">Customers</th><th class="r">Pros</th><th style="width:36%">Signup rate</th></tr></thead><tbody>' +
      rows.map((s) => {
        const r = s.visitors ? s.signups / s.visitors : 0;
        return "<tr><td>" + esc(s.source) + '</td><td class="r">' + fmt(s.visitors) + '</td><td class="r">' + fmt(s.signups) + '</td><td class="r">' + fmt(s.customers) + '</td><td class="r">' + fmt(s.pros) +
          '</td><td><div class="tr-rate"><div class="tr-bar"><span style="width:' + Math.max((r / maxRate) * 100, r ? 2 : 0) + '%"></span></div><b>' + (r * 100).toFixed(1) + "%</b></div></td></tr>";
      }).join("") + "</tbody></table>";
  }

  // ── visitor history ────────────────────────────────────────────────────
  function typeBadge(r) {
    if (!r.user_id) return '<span class="tr-badge tr-b-anon">Not registered</span>';
    if (r.user_role === "professional") return '<span class="tr-badge tr-b-pro">Professional</span>';
    if (r.user_role === "admin") return '<span class="tr-badge tr-b-admin">Admin</span>';
    return '<span class="tr-badge tr-b-cust">Customer</span>';
  }
  const visitorName = (r) => (r.user_id ? ((r.first || "") + " " + (r.last || "")).trim() || "User #" + r.user_id : "Anonymous");
  const locBy = { gps: "GPS", ip: "IP", profile: "Profile", manual: "City pick" };
  const deviceLabel = { mobile: "📱 Mobile", tablet: "📱 Tablet", desktop: "💻 Desktop" };

  async function loadHistory() {
    if (!filters) return;
    const id = ++historyReq;
    const tbody = $("tr-history-body");
    tbody.innerHTML = '<tr><td colspan="21" class="tr-empty">Loading visitors…</td></tr>';
    try {
      const d = await API.get("/api/admin/traffic/visitors?" + qs(filters, { page: historyPage, limit: PAGE_SIZE, q: historySearch }));
      if (id !== historyReq) return;
      if (!d.rows.length && historyPage > 1) { historyPage = 1; return loadHistory(); }
      tbody.innerHTML = d.rows.length ? d.rows.map((r) =>
        "<tr><td><b>" + esc(visitorName(r)) + '</b><div class="tr-sub">' + (r.user_id ? "user #" + r.user_id : "visitor " + esc(String(r.visitor_uid).slice(0, 8))) + "</div></td>" +
        "<td>" + typeBadge(r) + "</td><td>" + esc(r.email || "—") + "</td>" +
        "<td>" + dateTime(r.first_seen_at) + "</td><td>" + dateTime(r.last_in) + "</td>" +
        '<td class="r">' + fmt(r.sessions) + '</td><td class="r">' + fmt(r.page_views) + "</td>" +
        "<td>" + esc(pageName(r.first_landing_page)) + "</td><td>" + esc(pageName(r.last_page)) + "</td>" +
        "<td>" + esc(r.locality || "—") + "</td><td>" + esc(r.city || "—") + "</td><td>" + esc(r.state || "—") + "</td><td>" + esc(r.country || "—") + "</td>" +
        "<td>" + esc(r.postal_code || "—") + "</td><td>" + esc(locBy[r.location_source] || "—") + "</td>" +
        "<td>" + esc(r.source) + "</td><td>" + esc(r.utm_campaign || "—") + "</td>" +
        "<td>" + (deviceLabel[r.device_type] || "—") + "</td><td>" + esc(r.browser || "—") + "</td><td>" + esc(r.os || "—") + "</td>" +
        "<td>" + (r.signed_up_at ? dateTime(r.signed_up_at) : "—") + "</td></tr>").join("")
        : '<tr><td colspan="21" class="tr-empty">' + (historySearch ? "No visitors match your search." : "No visits recorded for this period.") + "</td></tr>";
      const from = d.total ? (d.page - 1) * d.limit + 1 : 0;
      const to = Math.min(d.page * d.limit, d.total);
      $("tr-pager-info").textContent = "Showing " + fmt(from) + "–" + fmt(to) + " of " + fmt(d.total) + " visitors";
      $("tr-prev").disabled = d.page <= 1;
      $("tr-next").disabled = to >= d.total;
    } catch (e) {
      if (id === historyReq) tbody.innerHTML = '<tr><td colspan="21" class="tr-empty" style="color:#dc2626">' + esc(e.message || "Could not load visitor history.") + "</td></tr>";
    }
  }

  async function downloadCsv() {
    if (!filters) return;
    const btn = $("tr-csv");
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      const d = await API.get("/api/admin/traffic/visitors?" + qs(filters, { page: 1, limit: EXPORT_LIMIT, q: historySearch }));
      const head = ["Visitor", "Type", "User ID", "Visitor ID", "Email", "First Seen", "Last Seen", "Sessions", "Page Views", "Landing Page", "Last Page",
        "Area", "City", "State", "Country", "PIN / ZIP", "Location By", "Source", "Referrer", "UTM Source", "UTM Medium", "UTM Campaign", "Device", "Browser", "OS", "Signed Up"];
      const type = (r) => (!r.user_id ? "Not registered" : r.user_role === "professional" ? "Professional" : r.user_role === "admin" ? "Admin" : "Customer");
      const rows = d.rows.map((r) => [visitorName(r), type(r), r.user_id || "", r.visitor_uid, r.email || "", plainDateTime(r.first_seen_at), plainDateTime(r.last_in),
        r.sessions, r.page_views, pageName(r.first_landing_page), pageName(r.last_page), r.locality || "", r.city || "", r.state || "", r.country || "",
        r.postal_code || "", locBy[r.location_source] || "", r.source, r.first_referrer || "", r.utm_source || "", r.utm_medium || "", r.utm_campaign || "",
        r.device_type || "", r.browser || "", r.os || "", plainDateTime(r.signed_up_at)]);
      const cell = (v) => {
        let s = String(v == null ? "" : v);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = "\ufeff" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "fixerr-traffic-" + filters.start + "-to-" + filters.end + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      if (d.total > d.rows.length) setStatus("CSV contains the most recent " + fmt(d.rows.length) + " of " + fmt(d.total) + " visitors. Narrow the dates for a full export.");
    } catch (e) {
      setStatus(e.message || "Could not export visitors.", true);
    } finally {
      btn.disabled = false;
      btn.textContent = "📥 Download CSV";
    }
  }

  // ── hook into the admin page's section switcher ────────────────────────
  function open() {
    renderShell();
    if (!loadedOnce) { loadedOnce = true; generate(); }
  }

  function install() {
    if (typeof window.show !== "function") return;
    const baseShow = window.show;
    window.show = function (s) {
      const r = baseShow.apply(this, arguments);
      if (s === "traffic") open();
      return r;
    };
    if ($("sec-traffic") && $("sec-traffic").classList.contains("active")) open();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
