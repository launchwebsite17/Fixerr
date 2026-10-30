// services/trafficReportService.js - Admin Traffic Report queries
// Reads site_visitors / page_views (003_create_visitor_tracking.sql) plus users / pros.
// Date filters are calendar days in REPORT_TZ; bots are excluded from every metric except
// the "bots filtered" count.
const { query } = require('../db');

const REPORT_TZ = 'Asia/Kolkata';
const MAX_RANGE_DAYS = 366;
const INTENT_PAGES = ['/booking.html', '/signup.html', '/register-pro.html'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const START_TS = `($1::date::timestamp AT TIME ZONE '${REPORT_TZ}')`;
const END_TS = `(($2::date + 1)::timestamp AT TIME ZONE '${REPORT_TZ}')`;

// ── Filters ──────────────────────────────────────────────────────────────
function todayInReportTz() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ }).format(new Date());
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// Returns { ok, error, filters } with start/end as YYYY-MM-DD (inclusive).
function parseFilters(q = {}) {
  const today = todayInReportTz();
  const end = DATE_RE.test(q.end || '') ? q.end : today;
  const start = DATE_RE.test(q.start || '') ? q.start : addDays(end, -29);
  if (start > end) return { ok: false, error: 'Start date must be on or before the end date.' };
  const span = daysBetween(start, end) + 1;
  if (span > MAX_RANGE_DAYS) return { ok: false, error: `Please choose a range of ${MAX_RANGE_DAYS} days or less.` };
  const country = ['IN', 'US'].includes(String(q.country || '').toUpperCase()) ? String(q.country).toUpperCase() : null;
  const type = ['registered', 'anonymous'].includes(q.type) ? q.type : 'all';
  return { ok: true, filters: { start, end, span, country, type } };
}

const params = (f) => [f.start, f.end, f.country, f.type];

// Filtered page views joined to their visitor. $1 start, $2 end, $3 country, $4 visitor type.
function filteredViews({ includeBots = false } = {}) {
  return `f AS (
    SELECT pv.visitor_id, pv.session_uid, pv.page_path, pv.viewed_at, pv.country, pv.city,
           v.user_id AS v_user_id, v.is_bot, v.first_seen_at, v.device_type, v.browser,
           v.utm_source AS v_utm_source, v.first_referrer
      FROM page_views pv
      JOIN site_visitors v ON v.id = pv.visitor_id
     WHERE pv.viewed_at >= ${START_TS}
       AND pv.viewed_at < ${END_TS}
       AND ($3::text IS NULL OR pv.country = $3::text)
       AND ($4::text = 'all'
            OR ($4::text = 'registered' AND v.user_id IS NOT NULL)
            OR ($4::text = 'anonymous' AND v.user_id IS NULL))
       ${includeBots ? '' : 'AND NOT v.is_bot'}
  )`;
}

// Visitors in range whose linked account was created in range = signups from visitors.
const SIGNUPS_CTE = `su AS (
    SELECT DISTINCT f.visitor_id, u.id AS uid, u.role, u.created_at
      FROM f JOIN users u ON u.id = f.v_user_id
     WHERE u.created_at >= ${START_TS} AND u.created_at < ${END_TS}
       AND u.role IN ('customer', 'professional')
  )`;

// ── Traffic source classification ────────────────────────────────────────
const SOURCE_RULES = [
  [/google\./, 'Google'],
  [/bing\./, 'Bing'],
  [/yahoo\./, 'Yahoo'],
  [/duckduckgo/, 'DuckDuckGo'],
  [/instagram|^ig$/, 'Instagram'],
  [/facebook|fb\.com|fb\.me|^fb$/, 'Facebook'],
  [/whatsapp|wa\.me|^wa$/, 'WhatsApp'],
  [/youtube|youtu\.be/, 'YouTube'],
  [/linkedin|lnkd\.in/, 'LinkedIn'],
  [/(^|\.)t\.co$|twitter|(^|\.)x\.com$/, 'X (Twitter)'],
  [/telegram|(^|\.)t\.me$/, 'Telegram'],
  [/reddit/, 'Reddit'],
  [/chatgpt|openai/, 'ChatGPT'],
];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return '';
  }
}

function classifySource(utmSource, referrer, ownHost) {
  const utm = String(utmSource || '').trim().toLowerCase();
  if (utm) {
    const hit = SOURCE_RULES.find(([re]) => re.test(utm));
    return hit ? hit[1] : utm.charAt(0).toUpperCase() + utm.slice(1);
  }
  const host = hostOf(referrer);
  if (!host || (ownHost && host === ownHost) || host === 'localhost' || host === '127.0.0.1') return 'Direct';
  const hit = SOURCE_RULES.find(([re]) => re.test(host));
  return hit ? hit[1] : host;
}

// ── Summary (cards, charts, insights data) ───────────────────────────────
async function getSummary(f, ownHost) {
  const p = params(f);
  const prevEnd = addDays(f.start, -1);
  const prev = { ...f, start: addDays(prevEnd, -(f.span - 1)), end: prevEnd };

  const [kpi, bots, prevVisitors, trend, trendSignups, sources, cities, countries, devices, browsers, pages, weekdays] =
    await Promise.all([
      query(`WITH ${filteredViews()},
              ${SIGNUPS_CTE},
              s AS (SELECT session_uid, COUNT(*) AS n FROM f GROUP BY session_uid),
              vv AS (SELECT visitor_id, MIN(first_seen_at) AS first_seen,
                            COUNT(DISTINCT session_uid) AS sess, COUNT(*) AS views,
                            BOOL_OR(page_path = ANY($5::text[])) AS intent
                       FROM f GROUP BY visitor_id)
             SELECT (SELECT COUNT(*) FROM vv) AS visitors,
                    (SELECT COUNT(*) FROM f) AS page_views,
                    (SELECT COUNT(*) FROM s) AS sessions,
                    (SELECT COUNT(*) FROM s WHERE n = 1) AS single_sessions,
                    (SELECT COUNT(DISTINCT visitor_id) FROM f WHERE v_user_id IS NOT NULL) AS registered,
                    (SELECT COUNT(*) FROM vv WHERE first_seen < ${START_TS} OR sess > 1) AS returning,
                    (SELECT COUNT(*) FROM vv WHERE views >= 2 OR intent) AS engaged,
                    (SELECT COUNT(*) FROM vv WHERE intent) AS intent,
                    (SELECT COUNT(DISTINCT uid) FROM su) AS signups`, [...p, INTENT_PAGES]),
      query(`WITH ${filteredViews({ includeBots: true })}
             SELECT COUNT(DISTINCT visitor_id) AS bots FROM f WHERE is_bot`, p),
      query(`WITH ${filteredViews()} SELECT COUNT(DISTINCT visitor_id) AS visitors FROM f`, params(prev)),
      query(`WITH ${filteredViews()}
             SELECT to_char(viewed_at AT TIME ZONE '${REPORT_TZ}', 'YYYY-MM-DD') AS day,
                    COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS page_views
               FROM f GROUP BY 1 ORDER BY 1`, p),
      query(`WITH ${filteredViews()}, ${SIGNUPS_CTE}
             SELECT to_char(created_at AT TIME ZONE '${REPORT_TZ}', 'YYYY-MM-DD') AS day, COUNT(DISTINCT uid) AS signups
               FROM su GROUP BY 1`, p),
      query(`WITH ${filteredViews()}, ${SIGNUPS_CTE},
              x AS (SELECT DISTINCT visitor_id, v_utm_source, first_referrer FROM f)
             SELECT x.v_utm_source AS utm_source, x.first_referrer AS referrer,
                    COUNT(DISTINCT x.visitor_id) AS visitors,
                    COUNT(DISTINCT su.uid) AS signups,
                    COUNT(DISTINCT su.uid) FILTER (WHERE su.role = 'customer') AS customers,
                    COUNT(DISTINCT su.uid) FILTER (WHERE su.role = 'professional') AS pros
               FROM x LEFT JOIN su ON su.visitor_id = x.visitor_id
              GROUP BY 1, 2`, p),
      query(`WITH ${filteredViews()}
             SELECT city, country, COUNT(DISTINCT visitor_id) AS visitors
               FROM f WHERE city IS NOT NULL AND city <> ''
              GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 6`, p),
      query(`WITH ${filteredViews()}
             SELECT COALESCE(country, '—') AS country, COUNT(DISTINCT visitor_id) AS visitors
               FROM f GROUP BY 1 ORDER BY 2 DESC`, p),
      query(`WITH ${filteredViews()}
             SELECT COALESCE(device_type, 'desktop') AS device, COUNT(DISTINCT visitor_id) AS visitors
               FROM f GROUP BY 1`, p),
      query(`WITH ${filteredViews()}
             SELECT COALESCE(browser, 'Other') AS browser, COUNT(DISTINCT visitor_id) AS visitors
               FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, p),
      query(`WITH ${filteredViews()}
             SELECT page_path, COUNT(*) AS views FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, p),
      // Weekday is taken from the visitor's market clock: US visits in US Central, others in India time.
      query(`WITH ${filteredViews()},
              d AS (SELECT CASE WHEN country = 'US' THEN 'US' WHEN country = 'IN' THEN 'IN' ELSE 'OTHER' END AS grp,
                           visitor_id,
                           (viewed_at AT TIME ZONE CASE WHEN country = 'US' THEN 'America/Chicago' ELSE '${REPORT_TZ}' END)::date AS local_day
                      FROM f)
             SELECT grp, EXTRACT(ISODOW FROM local_day)::int AS dow, COUNT(*) AS visitors
               FROM (SELECT DISTINCT grp, visitor_id, local_day FROM d) t
              GROUP BY 1, 2`, p),
    ]);

  const k = kpi.rows[0];
  const num = (v) => Number(v) || 0;

  // Fill every day in range so the trend has no gaps.
  const byDay = Object.fromEntries(trend.rows.map((r) => [r.day, r]));
  const suByDay = Object.fromEntries(trendSignups.rows.map((r) => [r.day, num(r.signups)]));
  const daily = [];
  for (let i = 0; i < f.span; i++) {
    const day = addDays(f.start, i);
    daily.push({
      day,
      visitors: num(byDay[day]?.visitors),
      page_views: num(byDay[day]?.page_views),
      signups: suByDay[day] || 0,
    });
  }

  const srcMap = {};
  sources.rows.forEach((r) => {
    const name = classifySource(r.utm_source, r.referrer, ownHost);
    const s = (srcMap[name] = srcMap[name] || { source: name, visitors: 0, signups: 0, customers: 0, pros: 0 });
    s.visitors += num(r.visitors);
    s.signups += num(r.signups);
    s.customers += num(r.customers);
    s.pros += num(r.pros);
  });
  const sourceList = Object.values(srcMap).sort((a, b) => b.visitors - a.visitors);

  // Weekday counts + how many of each weekday the range contains (for per-day averages).
  const weekdayOccurrences = Array(7).fill(0);
  for (let i = 0; i < f.span; i++) {
    const dow = new Date(addDays(f.start, i) + 'T00:00:00Z').getUTCDay();
    weekdayOccurrences[(dow + 6) % 7] += 1;
  }
  const wd = Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, total: 0, india: 0, us: 0, days: weekdayOccurrences[i] }));
  weekdays.rows.forEach((r) => {
    const row = wd[r.dow - 1];
    const v = num(r.visitors);
    row.total += v;
    if (r.grp === 'IN') row.india += v;
    if (r.grp === 'US') row.us += v;
  });

  const cityList = cities.rows.map((r) => ({ city: r.city, country: r.country, visitors: num(r.visitors) }));
  let topCityPros = null;
  if (cityList[0]) {
    const pr = await query(
      `SELECT COUNT(*) AS n FROM pros p JOIN users u ON u.id = p.user_id
        WHERE p.status = 'approved' AND LOWER(u.city) = LOWER($1)`,
      [cityList[0].city]
    );
    topCityPros = num(pr.rows[0].n);
  }

  return {
    filters: f,
    kpis: {
      visitors: num(k.visitors),
      prev_visitors: num(prevVisitors.rows[0].visitors),
      page_views: num(k.page_views),
      sessions: num(k.sessions),
      single_sessions: num(k.single_sessions),
      registered: num(k.registered),
      returning: num(k.returning),
      signups: num(k.signups),
      bots: num(bots.rows[0].bots),
    },
    funnel: {
      visited: num(k.visitors),
      engaged: num(k.engaged),
      intent: num(k.intent),
      signed_up: num(k.signups),
    },
    daily,
    sources: sourceList,
    cities: cityList,
    top_city_pros: topCityPros,
    countries: countries.rows.map((r) => ({ country: r.country, visitors: num(r.visitors) })),
    devices: devices.rows.map((r) => ({ device: r.device, visitors: num(r.visitors) })),
    top_browser: browsers.rows[0] ? { browser: browsers.rows[0].browser, visitors: num(browsers.rows[0].visitors) } : null,
    pages: pages.rows.map((r) => ({ page_path: r.page_path, views: num(r.views) })),
    weekdays: wd,
  };
}

// ── Visitor history (paged table / CSV export) ───────────────────────────
async function getVisitors(f, { page = 1, limit = 25, search = '' } = {}, ownHost) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 5000);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const term = String(search || '').trim().slice(0, 100);
  const like = term ? '%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%' : null;

  const base = `WITH ${filteredViews()},
    agg AS (SELECT visitor_id, MIN(viewed_at) AS first_in, MAX(viewed_at) AS last_in,
                   COUNT(*) AS page_views, COUNT(DISTINCT session_uid) AS sessions
              FROM f GROUP BY visitor_id),
    lastp AS (SELECT DISTINCT ON (visitor_id) visitor_id, page_path AS last_page
                FROM f ORDER BY visitor_id, viewed_at DESC),
    vrows AS (
      SELECT v.visitor_uid, v.user_id, v.user_role, u.first, u.last, u.email, u.created_at AS signed_up_at,
             v.first_seen_at, agg.first_in, agg.last_in, agg.sessions, agg.page_views,
             v.first_landing_page, lastp.last_page,
             v.locality, v.city, v.state, v.country, v.postal_code, v.location_source,
             v.first_referrer, v.utm_source, v.utm_medium, v.utm_campaign,
             v.device_type, v.browser, v.os
        FROM agg
        JOIN site_visitors v ON v.id = agg.visitor_id
        LEFT JOIN users u ON u.id = v.user_id
        LEFT JOIN lastp ON lastp.visitor_id = agg.visitor_id
       WHERE $5::text IS NULL
          OR u.first ILIKE $5 OR u.last ILIKE $5 OR u.email ILIKE $5
          OR v.city ILIKE $5 OR v.state ILIKE $5 OR v.postal_code ILIKE $5
          OR v.visitor_uid::text ILIKE $5 OR v.utm_campaign ILIKE $5
    )`;
  const p = [...params(f), like];

  const [count, rows] = await Promise.all([
    query(`${base} SELECT COUNT(*) AS n FROM vrows`, p),
    query(`${base} SELECT * FROM vrows ORDER BY last_in DESC LIMIT $6 OFFSET $7`, [...p, lim, (pg - 1) * lim]),
  ]);

  return {
    total: Number(count.rows[0].n) || 0,
    page: pg,
    limit: lim,
    rows: rows.rows.map((r) => ({
      ...r,
      sessions: Number(r.sessions) || 0,
      page_views: Number(r.page_views) || 0,
      source: classifySource(r.utm_source, r.first_referrer, ownHost),
    })),
  };
}

module.exports = { parseFilters, getSummary, getVisitors, classifySource };
