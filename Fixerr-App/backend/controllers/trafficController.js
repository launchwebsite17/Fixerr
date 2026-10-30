// controllers/trafficController.js - Admin Traffic Report
const { parseFilters, getSummary, getVisitors } = require('../services/trafficReportService');

// Referrers from our own domain count as "Direct", not as an external source.
const ownHost = (req) => String(req.hostname || '').replace(/^www\./, '').toLowerCase();

exports.getTrafficSummary = async (req, res) => {
  const parsed = parseFilters(req.query);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    res.json(await getSummary(parsed.filters, ownHost(req)));
  } catch (e) {
    console.error('Traffic summary failed:', e.message);
    res.status(500).json({ error: 'Could not load the traffic report.' });
  }
};

exports.getTrafficVisitors = async (req, res) => {
  const parsed = parseFilters(req.query);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    res.json(await getVisitors(parsed.filters, {
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.q,
    }, ownHost(req)));
  } catch (e) {
    console.error('Traffic visitors failed:', e.message);
    res.status(500).json({ error: 'Could not load visitor history.' });
  }
};
