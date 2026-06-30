# Fixerr — PostgreSQL Setup Guide

## What changed
Your backend now uses **PostgreSQL** instead of the `db.json` flat file. This is more reliable, supports proper relational queries, and is the database every serious startup uses.

---

## Step 1 — Create a free PostgreSQL database on Render

1. Go to your Render dashboard
2. Click **New +** → **PostgreSQL**
3. Name it `fixerr-db` (or anything you like)
4. Region: same as your web service for speed
5. Plan: **Free** (good for soft launch — 1GB storage, expires after 90 days of inactivity, but fine while you're actively building)
6. Click **Create Database**
7. Wait ~1 minute for it to provision

## Step 2 — Connect your backend to the database

1. On the new database's page, copy the **Internal Database URL** (starts with `postgres://`)
2. Go to your Fixerr **web service** → **Environment** tab
3. Add a new environment variable:
   - Key: `DATABASE_URL`
   - Value: *(paste the Internal Database URL)*
4. Click **Save Changes** — this restarts your service

## Step 3 — Run the migration (one-time)

This creates all your tables and imports your existing data from `db.json` if it exists.

1. Go to your Fixerr web service → **Shell** tab
2. Run:
   ```bash
   node migrate.js
   ```
3. You should see output like:
   ```
   ✅ Schema created/verified
   ✅ Admin user created — admin@fixerr.com
   ✅ Migrated X users
   ✅ Migrated X pros
   ✅ Migrated X requests
   ...
   🎉 Migration complete!
   ```

## Step 4 — Restart your service

Render → your web service → **Manual Deploy** → **Deploy latest commit** (or just wait for auto-deploy if you pushed to Git)

---

## Database Credentials

Render manages the actual Postgres username/password internally via the `DATABASE_URL` — you never need to handle them directly. If you ever want to inspect the database with a SQL client (like TablePlus, pgAdmin, or DBeaver):

1. Render → your `fixerr-db` database → copy the **External Database URL**
2. Paste that connection string into your SQL client
3. You can now run any SQL query directly, e.g.:
   ```sql
   SELECT * FROM users;
   SELECT * FROM requests WHERE status='pending';
   SELECT COUNT(*) FROM pros WHERE status='approved';
   ```

**Important:** The External URL only works from outside Render's network (i.e., your laptop). The Internal URL (used in `DATABASE_URL`) only works from within Render — that's intentional and more secure.

---

## What stays the same
- Every page, every feature, every API endpoint works exactly the same from the frontend's perspective
- Login, booking, admin panel, pro dashboard — nothing visually changes
- Your admin login is still `admin@fixerr.com` + your `ADMIN_PASSWORD` env var

## What's better now
- No more JSON file corruption risk
- Can run real SQL queries (the thing you asked about earlier!)
- Scales properly as you get more users
- Proper relational integrity (a booking always points to a real user)
- Render free Postgres tier: 1GB storage, enough for tens of thousands of bookings

## If something breaks after migration
- Check Render logs: your web service → **Logs** tab
- Most common issue: `DATABASE_URL` not set — go back to Step 2
- If migration fails partway, it's safe to re-run `node migrate.js` — it uses `ON CONFLICT DO NOTHING` so it won't duplicate data
