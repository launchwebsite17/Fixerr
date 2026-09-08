// controllers/proController.js
const { query } = require("../db");
const { sendEmail, EMAIL } = require("../services/emailService");
const { getOrCreateInvoice } = require("../services/invoiceService");
const { geocodePlace } = require("../services/geocodeService");
const { encrypt } = require("../services/cryptoService");
const { saveProUpload } = require("../services/proAssetService");

exports.getPros = async (req, res) => {
  try {
    const { city, country, category, lat, lng } = req.query;
    let sql = `SELECT p.*, u.first, u.last, u.city as user_city, u.state, u.country as user_country, u.lat, u.lng
               FROM pros p JOIN users u ON p.user_id::text=u.id::text
               WHERE p.status='approved' AND p.available=true`;
    const params = [];
    if (country) {
      params.push(country);
      sql += ` AND u.country=$${params.length}`;
    }

    if (lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
      params.push(parseFloat(lat), parseFloat(lng));
      if (city) {
        params.push(city.toLowerCase());
        sql += ` AND (
          (u.lat IS NOT NULL AND u.lng IS NOT NULL AND
           (6371 * acos(GREATEST(-1.0, LEAST(1.0,
             cos(radians($${params.length - 2})) * cos(radians(u.lat::numeric)) *
             cos(radians(u.lng::numeric) - radians($${params.length - 1})) +
             sin(radians($${params.length - 2})) * sin(radians(u.lat::numeric))
           )))) <= COALESCE(p.service_radius, 25))
          OR
          (u.lat IS NULL AND LOWER(TRIM(u.city))=$${params.length})
        )`;
      } else {
        sql += ` AND u.lat IS NOT NULL AND u.lng IS NOT NULL
                 AND (6371 * acos(GREATEST(-1.0, LEAST(1.0,
                   cos(radians($${params.length - 1})) * cos(radians(u.lat::numeric)) *
                   cos(radians(u.lng::numeric) - radians($${params.length})) +
                   sin(radians($${params.length - 1})) * sin(radians(u.lat::numeric))
                 )))) <= COALESCE(p.service_radius, 25)`;
      }
    } else if (city) {
      params.push(city.toLowerCase());
      sql += ` AND LOWER(TRIM(u.city))=$${params.length}`;
    }

    // Match the customer's requested service category against the pro's registered service
    // type — checked in BOTH `services` (the plain category list) and `experience_map` (the
    // same categories, keyed with a years-of-experience value) so a pro isn't excluded just
    // because one of the two fields wasn't fully populated at registration time.
    if (category && category !== "all") {
      params.push(category);
      sql += ` AND (p.services ? $${params.length} OR p.experience_map ? $${params.length})`;
    }

    const r = await query(sql, params);
    let pros = r.rows.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      name: (p.first || "") + " " + (p.last || ""),
      initials: ((p.first || "?")[0] + (p.last || "?")[0]).toUpperCase(),
      city: p.user_city || "",
      state: p.state || "",
      country: p.user_country || "",
      services: p.services || [],
      experience_map: p.experience_map || {},
      bio: p.bio || "",
      years_exp: p.years_exp || 0,
      rating: p.rating || 4.8,
      reviews: p.reviews || 0,
      badge: p.badge || "Verified",
      rate_inr: p.rate_inr || 0,
      rate_usd: p.rate_usd || 0,
      languages: p.languages || "English",
      available: p.available,
      lat: p.lat || null,
      lng: p.lng || null,
    }));

    res.json(pros);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load professionals." });
  }
};

exports.applyPro = async (req, res) => {
  try {
    if (!req.body.commission_agreed)
      return res
        .status(400)
        .json({
          error:
            "You must agree to the Commission Agreement to submit your application.",
        });
    if (!req.body.liability_agreed)
      return res
        .status(400)
        .json({
          error:
            "You must agree to the liability terms to submit your application.",
        });

    const b = req.body;

    // Defense in depth: the client already blocks files over 5MB, but a direct API call could
    // skip that check, so re-verify size (base64 is ~4/3 the size of the original bytes).
    const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
    for (const [label, upload] of [["Photo", b.photo], ["Document 1", b.doc1], ["Document 2", b.doc2]]) {
      if (upload && upload.data && Buffer.byteLength(upload.data, "base64") > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: `${label} must be under 5MB.` });
      }
    }

    // cp_unique_id was already generated at signup (/api/auth/register), before this call
    // ever happens — the file-naming convention below relies on it already existing.
    const userRes = await query(
      "SELECT first, last, email, city, state, country, zip, cp_unique_id FROM users WHERE id=$1",
      [req.user.id],
    );
    const proUserRow = userRes.rows[0] || {};
    const cpUniqueId = proUserRow.cp_unique_id || null;

    // Photo and ID documents are written to frontend/pro_assets/<cpUniqueId>/... and only the
    // resulting file path is stored in the DB — no base64 data is persisted.
    const photoUrl = saveProUpload({
      cpUniqueId,
      file: b.photo || null,
    });
    const doc1Url = saveProUpload({
      cpUniqueId,
      firstName: proUserRow.first,
      lastName: proUserRow.last,
      label: b.doc1_type || "",
      file: b.doc1 || null,
    });
    const doc2Url = saveProUpload({
      cpUniqueId,
      firstName: proUserRow.first,
      lastName: proUserRow.last,
      label: b.doc2_type || "",
      file: b.doc2 || null,
    });

    // Aadhaar/PAN are stored as plain text (no longer encrypted); bank details still are.
    const encBank = b.bank ? encrypt(b.bank) : null;

    const r = await query(
      `INSERT INTO pros (user_id,services,experience_map,years_exp,languages,bio,certifications,photo_url,id_type,id_number,
         aadhaar,pan,pricing_map,rate_inr,rate_usd,upi,zelle,venmo,bank,pay_methods,commission_agreed,liability_agreed,
         conduct_agreed,has_insurance,has_tools,documents,service_radius,doc1_type,doc1_url,doc2_type,doc2_url,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,'pending',$32)
       RETURNING id`,
      [
        req.user.id,
        JSON.stringify(b.services || []),
        JSON.stringify(b.experience_map || {}),
        b.years_exp || "",
        b.languages || "",
        b.bio || "",
        b.certifications || "",
        photoUrl,
        b.id_type || "",
        b.id_number || "",
        b.aadhaar || null,
        b.pan || null,
        JSON.stringify(b.pricing_map || {}),
        parseFloat(b.starting_rate) || 0,
        parseFloat(b.starting_rate) || 0,
        b.upi || null,
        b.zelle || null,
        b.venmo || null,
        encBank,
        JSON.stringify(b.pay_methods || []),
        true,
        true,
        !!b.conduct_agreed,
        !!b.has_insurance,
        !!b.has_tools,
        JSON.stringify([]),
        parseInt(b.service_radius) || 25,
        b.doc1_type || null,
        doc1Url,
        b.doc2_type || null,
        doc2Url,
        req.user.id,
      ],
    );

    if (proUserRow.city) {
      const zip = b.zip || proUserRow.zip || "";
      const geo = await geocodePlace({
        city: proUserRow.city,
        state: proUserRow.state,
        country: proUserRow.country,
        zip,
      });
      if (geo) {
        await query("UPDATE users SET lat=$1, lng=$2 WHERE id=$3", [
          geo.lat,
          geo.lng,
          req.user.id,
        ]).catch(() => {});
      }
    }

    const docsSummary = [b.doc1_type, b.doc2_type].filter(Boolean).join(", ") || "none";
    await query("INSERT INTO notifs (type,msg) VALUES ($1,$2)", [
      "pro_application",
      `New pro application from user ${req.user.id}. Documents: ${docsSummary}`,
    ]);

    if (proUserRow.email) {
      const tpl = EMAIL.proReceived(proUserRow.first);
      // Fire-and-forget — the application is already saved; don't delay the response on email.
      sendEmail(proUserRow.email, tpl.subject, tpl.html, "pro_received")
        .catch((mailErr) => console.error('Pro-received email dispatch error (non-fatal):', mailErr.message));
    }

    res.json({ success: true, id: r.rows[0].id });
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: "Could not submit application. " + e.message });
  }
};

exports.getProBookings = async (req, res) => {
  try {
    const ur = await query("SELECT * FROM users WHERE id=$1", [req.user.id]);
    const u = ur.rows[0];
    if (!u) return res.status(404).json({ error: "User not found." });

    const fullName = ((u.first || "") + " " + (u.last || ""))
      .toLowerCase()
      .trim();
    const firstName = (u.first || "").toLowerCase();
    const initials =
      ((u.first || "")[0] || "").toLowerCase() +
      ((u.last || "")[0] || "").toLowerCase();

    const r = await query(
      `SELECT r.*,
         COALESCE(inv.payment_status, 'notpaid') AS payment_status,
         cu.cp_unique_id AS customer_unique_id
       FROM requests r
       LEFT JOIN users cu ON cu.id = r.user_id
       LEFT JOIN invoices inv ON inv.booking_ref = r.ref
       WHERE assigned_pro_id=$1
          OR preferred_pro_id=$1
          OR LOWER(TRIM(COALESCE(preferred_pro,'')))=LOWER(TRIM($2))
          OR LOWER(TRIM(COALESCE(preferred_pro,'')))=$3
          OR LOWER(TRIM(COALESCE(preferred_pro,''))) LIKE $4||'%'
       ORDER BY created_at DESC`,
      [req.user.id, fullName, initials, firstName],
    );
    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load bookings." });
  }
};

exports.updateProBooking = async (req, res) => {
  try {
    const ur = await query("SELECT * FROM users WHERE id=$1", [req.user.id]);
    const u = ur.rows[0];
    if (!u || u.role !== "professional")
      return res.status(403).json({ error: "Professionals only." });

    const existing = await query("SELECT * FROM requests WHERE ref=$1", [
      req.params.ref,
    ]);
    if (!existing.rows[0])
      return res.status(404).json({ error: "Booking not found." });

    const allowed = ["accepted", "declined", "in_progress", "completed"];
    if (!allowed.includes(req.body.status))
      return res.status(400).json({ error: "Invalid status." });

    const updates = { status: req.body.status };
    // Record which professional owns this booking so reviews & reports can resolve the pro.
    // (Declining does not assign the booking.)
    if (["accepted", "in_progress", "completed"].includes(req.body.status)) {
      updates.assigned_pro_id = req.user.id;
    }
    if (req.body.status === "completed") updates.review_requested = true;
    if (req.body.pro_note) updates.pro_note = req.body.pro_note;

    const fields = Object.keys(updates);
    const setClauses = fields.map((f, i) => `${f}=$${i + 1}`).join(", ");
    const values = fields.map((f) => updates[f]);
    values.push(req.user.id); // updated_by — the professional performing this update
    values.push(req.params.ref);

    await query(
      `UPDATE requests SET ${setClauses}, updated_at=now(), updated_by=$${values.length - 1} WHERE ref=$${values.length}`,
      values,
    );

    const bk = existing.rows[0];
    // E4 — email the customer when the professional accepts/confirms the booking.
    if (req.body.status === "accepted" && bk.customer_email) {
      const proName = ((u.first || "") + " " + (u.last || "")).trim();
      const isIndia = bk.country === "IN";
      const priceVal = bk.confirmed_price || bk.proposed_price || bk.estimate;
      const priceLine = priceVal ? (isIndia ? "₹" : "$") + priceVal : "";
      const tpl = EMAIL.bookingAcceptedByPro(
        bk.customer_name || "there",
        proName,
        u.phone || "",
        bk.service_key || "your service",
        bk.preferred_date || "",
        priceLine,
        bk.ref,
      );
      sendEmail(bk.customer_email, tpl.subject, tpl.html, "booking_accepted")
        .catch((mailErr) => console.error('Booking-accepted email dispatch error (non-fatal):', mailErr.message));
    }

    // Email the customer when the professional heads to the job (status -> in_progress).
    if (req.body.status === "in_progress" && bk.customer_email) {
      const proName = ((u.first || "") + " " + (u.last || "")).trim();
      const customerAddress = [bk.address, bk.city, bk.state, bk.zip].filter(Boolean).join(", ") || "your location";
      const tpl = EMAIL.technicianOnTheWay(
        bk.customer_name || "there",
        proName,
        u.phone || "",
        customerAddress,
        bk.ref,
      );
      sendEmail(bk.customer_email, tpl.subject, tpl.html, "technician_on_the_way")
        .catch((mailErr) => console.error('Technician-on-the-way email dispatch error (non-fatal):', mailErr.message));
    }

    // E5 — on completion, generate the invoice (idempotent). Awaited because the invoice row
    // itself must exist before this handler responds (the invoice email inside it is its own
    // fire-and-forget send — see invoiceService.js).
    if (req.body.status === "completed") {
      try {
        await getOrCreateInvoice(req.params.ref);
      } catch (e) {
        console.error("[INVOICE ON COMPLETE]", e.message);
      }
    }

    if (req.body.status === "declined") {
      // Self-update — the professional's own decline triggers these, so they're both creator
      // and updater of their own account/profile rows here.
      const cur = await query(
        "UPDATE users SET cancellation_count=COALESCE(cancellation_count,0)+1, updated_at=now(), updated_by=$1 WHERE id=$1 RETURNING *",
        [req.user.id],
      );
      const uu = cur.rows[0];
      const CANCEL_THRESHOLD = 3;
      if (uu.cancellation_count >= CANCEL_THRESHOLD && !uu.flagged) {
        await query(
          "UPDATE users SET flagged=true, flagged_reason=$1, updated_at=now(), updated_by=$2 WHERE id=$2",
          [`Declined ${uu.cancellation_count} bookings`, uu.id],
        );
        await query("UPDATE pros SET flagged=true, updated_at=now(), updated_by=$1 WHERE user_id=$1", [uu.id]);
        await query("INSERT INTO notifs (type,msg) VALUES ($1,$2)", [
          "flag",
          `⚠️ Professional ${uu.first} ${uu.last} flagged — ${uu.cancellation_count} declines`,
        ]);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update booking." });
  }
};
