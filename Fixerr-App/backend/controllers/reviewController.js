// controllers/reviewController.js
const { query } = require('../db');

exports.submitReview = async (req, res) => {
  try {
    const { booking_ref, rating, comment, pro_id } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5.' });

    const existing = await query('SELECT id FROM reviews WHERE booking_ref=$1 AND customer::text=$2::text', [booking_ref, req.user.id.toString()]);
    if (existing.rows.length) return res.status(400).json({ error: 'You have already reviewed this booking.' });

    // Resolve the professional (pros.id) authoritatively from the booking's assigned pro
    // (assigned_pro_id is a users.id). Only fall back to a client-supplied pro_id if it is a
    // real pros.id — this prevents the historic bug of storing a user id as pro_id.
    let resolvedProId = null;
    const bk = await query('SELECT assigned_pro_id FROM requests WHERE ref=$1', [booking_ref]);
    const assignedUserId = bk.rows[0]?.assigned_pro_id;
    if (assignedUserId) {
      const pr = await query('SELECT id FROM pros WHERE user_id=$1', [assignedUserId]);
      resolvedProId = pr.rows[0]?.id || null;
    }
    if (!resolvedProId && pro_id) {
      const chk = await query('SELECT id FROM pros WHERE id=$1', [pro_id]);
      resolvedProId = chk.rows[0]?.id || null;
    }

    await query(
      `INSERT INTO reviews (booking_ref,customer,pro_id,rating,comment) VALUES ($1,$2,$3,$4,$5)`,
      [booking_ref, req.user.id, resolvedProId, rating, comment || '']
    );
    // The customer's own review submission triggers this — self-attributed as the updater.
    await query('UPDATE requests SET review_done=true, updated_at=now(), updated_by=$2 WHERE ref=$1', [booking_ref, req.user.id]);

    // Recompute the pro's average rating & review count from the reviews table (source of truth).
    // This is a derived/automatic recalculation, not a direct profile edit by anyone in
    // particular, so updated_by is intentionally left unset here.
    if (resolvedProId) {
      const avgR = await query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM reviews WHERE pro_id=$1', [resolvedProId]);
      if (avgR.rows[0]?.avg) {
        await query('UPDATE pros SET rating=$1, reviews=$2, updated_at=now() WHERE id=$3', [avgR.rows[0].avg, avgR.rows[0].cnt, resolvedProId]);
      }
    }
    res.json({ success: true, message: 'Review submitted — thank you!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not submit review.' });
  }
};

exports.getFeaturedReviews = async (req, res) => {
  try {
    const { country, city } = req.query;

    const baseSelect = `
      SELECT rev.id, rev.rating, rev.comment, rev.created,
             u.first as customer_first, u.last as customer_last,
             u.city as customer_city, u.country as customer_country,
             p.id as pro_id, pu.first as pro_first, pu.last as pro_last
      FROM reviews rev
      LEFT JOIN users u ON rev.customer::text=u.id::text
      LEFT JOIN pros p ON rev.pro_id::text=p.id::text
      LEFT JOIN users pu ON p.user_id::text=pu.id::text
    `;
    // Top rated first, most recent as the tiebreaker.
    const orderLimit = `ORDER BY rev.rating DESC, rev.created DESC LIMIT 6`;

    let rows = [];

    // A country (and optionally city) selected in the nav — prefer reviews tied to
    // bookings actually made in that location (requests.city/country), not the
    // reviewer's profile location, since a customer can book service in a city other
    // than the one on their account.
    if (country) {
      const params = [country];
      let locClause = 'req.country = $1';
      if (city) { params.push(city); locClause += ' AND req.city = $2'; }
      const locResult = await query(`
        ${baseSelect}
        JOIN requests req ON rev.booking_ref = req.ref
        WHERE rev.rating >= 4 AND ${locClause}
        ${orderLimit}
      `, params);
      rows = locResult.rows;
    }

    // No location filter requested, or that location has no reviews yet — fall back to
    // the site-wide top-rated/most-recent reviews.
    if (rows.length === 0) {
      const globalResult = await query(`
        ${baseSelect}
        WHERE rev.rating >= 4
        ${orderLimit}
      `);
      rows = globalResult.rows;
    }

    // Fallback sample reviews if the database has no reviews at all yet
    if (rows.length === 0) {
      return res.json([
        { id: 101, rating: 5, comment: "Exceeded expectations! Arrived on time and solved my plumbing issue quickly.", customer_first: "Rahul M.", customer_city: "Bengaluru", pro_first: "Amit", pro_last: "Sharma" },
        { id: 102, rating: 5, comment: "Fantastic electrician. Clean work, verified credentials, very polite.", customer_first: "Sarah K.", customer_city: "New York", pro_first: "John", pro_last: "Miller" },
        { id: 103, rating: 5, comment: "Deep cleaning team was super efficient. House looks brand new!", customer_first: "Priya S.", customer_city: "Mumbai", pro_first: "Deepak", pro_last: "Kumar" }
      ]);
    }

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load featured reviews.' });
  }
};
