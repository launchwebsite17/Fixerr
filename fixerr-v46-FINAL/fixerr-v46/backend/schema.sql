-- Fixerr PostgreSQL Schema
-- Run this once to set up all tables

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first TEXT,
  last TEXT,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  city TEXT,
  state TEXT,
  country TEXT,
  currency TEXT,
  zip TEXT,
  address TEXT,
  active BOOLEAN DEFAULT true,
  flagged BOOLEAN DEFAULT false,
  flagged_reason TEXT,
  cancellation_count INTEGER DEFAULT 0,
  created TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pros (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  services JSONB DEFAULT '[]',
  experience_map JSONB DEFAULT '{}',
  years_exp TEXT,
  languages TEXT,
  bio TEXT,
  certifications TEXT,
  photo_url TEXT,
  id_type TEXT,
  id_number TEXT,
  aadhaar TEXT,
  pan TEXT,
  pricing_map JSONB DEFAULT '{}',
  rate_inr NUMERIC DEFAULT 0,
  rate_usd NUMERIC DEFAULT 0,
  upi TEXT,
  zelle TEXT,
  venmo TEXT,
  bank TEXT,
  pay_methods JSONB DEFAULT '[]',
  commission_agreed BOOLEAN DEFAULT false,
  liability_agreed BOOLEAN DEFAULT false,
  conduct_agreed BOOLEAN DEFAULT false,
  has_insurance BOOLEAN DEFAULT false,
  has_tools BOOLEAN DEFAULT false,
  rating NUMERIC DEFAULT 4.8,
  reviews INTEGER DEFAULT 0,
  badge TEXT DEFAULT 'Verified',
  available BOOLEAN DEFAULT false,
  flagged BOOLEAN DEFAULT false,
  created TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  service_key TEXT,
  sub_service TEXT,
  custom_desc TEXT,
  preferred_pro TEXT,
  preferred_pro_id INTEGER,
  assigned_pro_id INTEGER,
  payment_method TEXT,
  preferred_date TEXT,
  preferred_time TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  currency TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  access_notes TEXT,
  terms_agreed BOOLEAN DEFAULT false,
  estimate NUMERIC DEFAULT 0,
  commission NUMERIC DEFAULT 0,
  pro_earns NUMERIC DEFAULT 0,
  proposed_price NUMERIC,
  confirmed_price NUMERIC,
  status TEXT DEFAULT 'pending',
  pro_note TEXT,
  review_requested BOOLEAN DEFAULT false,
  review_done BOOLEAN DEFAULT false,
  created TIMESTAMPTZ DEFAULT now(),
  updated TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  "from" INTEGER REFERENCES users(id) ON DELETE SET NULL,
  "to" INTEGER REFERENCES users(id) ON DELETE SET NULL,
  booking_ref TEXT,
  content TEXT NOT NULL,
  created TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  booking_ref TEXT,
  customer INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pro_id INTEGER REFERENCES pros(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  created TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ads (
  id SERIAL PRIMARY KEY,
  title TEXT,
  link TEXT,
  category TEXT,
  active BOOLEAN DEFAULT true,
  clicks INTEGER DEFAULT 0,
  created TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_leads (
  id SERIAL PRIMARY KEY,
  company TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  tier TEXT,
  category TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending',
  quoted_price TEXT,
  admin_note TEXT,
  created TIMESTAMPTZ DEFAULT now(),
  updated TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS custom_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  created TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifs (
  id SERIAL PRIMARY KEY,
  type TEXT,
  msg TEXT,
  read BOOLEAN DEFAULT false,
  created TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_ref ON requests(ref);
CREATE INDEX IF NOT EXISTS idx_pros_user ON pros(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_ref ON messages(booking_ref);
