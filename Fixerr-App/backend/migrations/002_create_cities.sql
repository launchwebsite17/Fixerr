-- 002_create_cities.sql
-- Serviceable markets (header city dropdown). Flag/currency stay on countries_config.
-- Seeded from backend/cities.json + nav.js CITY_ALIASES. 49 US + 49 IN.
-- Depends on: 001_create_countries_config.sql
-- Idempotent: CREATE IF NOT EXISTS; INSERT ON CONFLICT DO NOTHING.
-- Rollback: 002_create_cities.down.sql
-- Do not auto-run against Render; apply manually when ready.

BEGIN;

CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  country_code TEXT NOT NULL REFERENCES countries_config (country_code),
  city_name TEXT NOT NULL,
  city_slug TEXT NOT NULL,
  state_code TEXT,
  state_name TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by INTEGER,
  updated_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_country_slug
  ON cities (country_code, city_slug);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cities_country_name
  ON cities (country_code, lower(city_name));

CREATE INDEX IF NOT EXISTS idx_cities_country_active
  ON cities (country_code, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_cities_aliases
  ON cities USING GIN (aliases);

-- United States (49)
INSERT INTO cities
  (country_code, city_name, city_slug, state_code, state_name, aliases, sort_order)
VALUES
  ('US', 'Albuquerque', 'albuquerque', 'NM', 'New Mexico', '{}'::TEXT[], 1),
  ('US', 'Atlanta', 'atlanta', 'GA', 'Georgia', '{}'::TEXT[], 2),
  ('US', 'Austin', 'austin', 'TX', 'Texas', '{}'::TEXT[], 3),
  ('US', 'Baltimore', 'baltimore', 'MD', 'Maryland', '{}'::TEXT[], 4),
  ('US', 'Boston', 'boston', 'MA', 'Massachusetts', '{}'::TEXT[], 5),
  ('US', 'Charlotte', 'charlotte', 'NC', 'North Carolina', '{}'::TEXT[], 6),
  ('US', 'Chicago', 'chicago', 'IL', 'Illinois', '{}'::TEXT[], 7),
  ('US', 'Cincinnati', 'cincinnati', 'OH', 'Ohio', '{}'::TEXT[], 8),
  ('US', 'Cleveland', 'cleveland', 'OH', 'Ohio', '{}'::TEXT[], 9),
  ('US', 'Colorado Springs', 'colorado-springs', 'CO', 'Colorado', '{}'::TEXT[], 10),
  ('US', 'Columbus', 'columbus', 'OH', 'Ohio', '{}'::TEXT[], 11),
  ('US', 'Dallas', 'dallas', 'TX', 'Texas', '{}'::TEXT[], 12),
  ('US', 'Denver', 'denver', 'CO', 'Colorado', '{}'::TEXT[], 13),
  ('US', 'Detroit', 'detroit', 'MI', 'Michigan', '{}'::TEXT[], 14),
  ('US', 'Fort Worth', 'fort-worth', 'TX', 'Texas', '{}'::TEXT[], 15),
  ('US', 'Fresno', 'fresno', 'CA', 'California', '{}'::TEXT[], 16),
  ('US', 'Houston', 'houston', 'TX', 'Texas', '{}'::TEXT[], 17),
  ('US', 'Indianapolis', 'indianapolis', 'IN', 'Indiana', '{}'::TEXT[], 18),
  ('US', 'Jacksonville', 'jacksonville', 'FL', 'Florida', '{}'::TEXT[], 19),
  ('US', 'Kansas City', 'kansas-city', 'MO', 'Missouri', '{}'::TEXT[], 20),
  ('US', 'Las Vegas', 'las-vegas', 'NV', 'Nevada', '{}'::TEXT[], 21),
  ('US', 'Long Beach', 'long-beach', 'CA', 'California', '{}'::TEXT[], 22),
  ('US', 'Los Angeles', 'los-angeles', 'CA', 'California', '{}'::TEXT[], 23),
  ('US', 'Louisville', 'louisville', 'KY', 'Kentucky', '{}'::TEXT[], 24),
  ('US', 'Memphis', 'memphis', 'TN', 'Tennessee', '{}'::TEXT[], 25),
  ('US', 'Miami', 'miami', 'FL', 'Florida', '{}'::TEXT[], 26),
  ('US', 'Milwaukee', 'milwaukee', 'WI', 'Wisconsin', '{}'::TEXT[], 27),
  ('US', 'Minneapolis', 'minneapolis', 'MN', 'Minnesota', '{}'::TEXT[], 28),
  ('US', 'Nashville', 'nashville', 'TN', 'Tennessee', '{}'::TEXT[], 29),
  ('US', 'New Orleans', 'new-orleans', 'LA', 'Louisiana', '{}'::TEXT[], 30),
  ('US', 'New York', 'new-york', 'NY', 'New York', ARRAY['New York City','NYC']::TEXT[], 31),
  ('US', 'Oklahoma City', 'oklahoma-city', 'OK', 'Oklahoma', '{}'::TEXT[], 32),
  ('US', 'Omaha', 'omaha', 'NE', 'Nebraska', '{}'::TEXT[], 33),
  ('US', 'Orlando', 'orlando', 'FL', 'Florida', '{}'::TEXT[], 34),
  ('US', 'Philadelphia', 'philadelphia', 'PA', 'Pennsylvania', '{}'::TEXT[], 35),
  ('US', 'Phoenix', 'phoenix', 'AZ', 'Arizona', '{}'::TEXT[], 36),
  ('US', 'Pittsburgh', 'pittsburgh', 'PA', 'Pennsylvania', '{}'::TEXT[], 37),
  ('US', 'Portland', 'portland', 'OR', 'Oregon', '{}'::TEXT[], 38),
  ('US', 'Raleigh', 'raleigh', 'NC', 'North Carolina', '{}'::TEXT[], 39),
  ('US', 'Sacramento', 'sacramento', 'CA', 'California', '{}'::TEXT[], 40),
  ('US', 'Salt Lake City', 'salt-lake-city', 'UT', 'Utah', '{}'::TEXT[], 41),
  ('US', 'San Antonio', 'san-antonio', 'TX', 'Texas', '{}'::TEXT[], 42),
  ('US', 'San Diego', 'san-diego', 'CA', 'California', '{}'::TEXT[], 43),
  ('US', 'San Francisco', 'san-francisco', 'CA', 'California', '{}'::TEXT[], 44),
  ('US', 'San Jose', 'san-jose', 'CA', 'California', '{}'::TEXT[], 45),
  ('US', 'Seattle', 'seattle', 'WA', 'Washington', '{}'::TEXT[], 46),
  ('US', 'Tampa', 'tampa', 'FL', 'Florida', '{}'::TEXT[], 47),
  ('US', 'Tucson', 'tucson', 'AZ', 'Arizona', '{}'::TEXT[], 48),
  ('US', 'Virginia Beach', 'virginia-beach', 'VA', 'Virginia', '{}'::TEXT[], 49)
ON CONFLICT (country_code, city_slug) DO NOTHING;

-- India (49)
INSERT INTO cities
  (country_code, city_name, city_slug, state_code, state_name, aliases, sort_order)
VALUES
  ('IN', 'Agra', 'agra', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 1),
  ('IN', 'Ahmedabad', 'ahmedabad', 'GJ', 'Gujarat', '{}'::TEXT[], 2),
  ('IN', 'Aligarh', 'aligarh', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 3),
  ('IN', 'Amritsar', 'amritsar', 'PB', 'Punjab', '{}'::TEXT[], 4),
  ('IN', 'Aurangabad', 'aurangabad', 'MH', 'Maharashtra', '{}'::TEXT[], 5),
  ('IN', 'Bareilly', 'bareilly', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 6),
  ('IN', 'Bengaluru', 'bengaluru', 'KA', 'Karnataka', ARRAY['Bangalore','Bengalooru']::TEXT[], 7),
  ('IN', 'Bhopal', 'bhopal', 'MP', 'Madhya Pradesh', '{}'::TEXT[], 8),
  ('IN', 'Bhubaneswar', 'bhubaneswar', 'OD', 'Odisha', '{}'::TEXT[], 9),
  ('IN', 'Chandigarh', 'chandigarh', 'PB', 'Punjab', '{}'::TEXT[], 10),
  ('IN', 'Chennai', 'chennai', 'TN', 'Tamil Nadu', ARRAY['Madras']::TEXT[], 11),
  ('IN', 'Coimbatore', 'coimbatore', 'TN', 'Tamil Nadu', '{}'::TEXT[], 12),
  ('IN', 'Dehradun', 'dehradun', 'UK', 'Uttarakhand', '{}'::TEXT[], 13),
  ('IN', 'Delhi', 'delhi', 'DL', 'Delhi', '{}'::TEXT[], 14),
  ('IN', 'Faridabad', 'faridabad', 'HR', 'Haryana', '{}'::TEXT[], 15),
  ('IN', 'Gurugram', 'gurugram', 'HR', 'Haryana', ARRAY['Gurgaon']::TEXT[], 16),
  ('IN', 'Guwahati', 'guwahati', 'AS', 'Assam', '{}'::TEXT[], 17),
  ('IN', 'Hubli', 'hubli', 'KA', 'Karnataka', '{}'::TEXT[], 18),
  ('IN', 'Hyderabad', 'hyderabad', 'TS', 'Telangana', '{}'::TEXT[], 19),
  ('IN', 'Indore', 'indore', 'MP', 'Madhya Pradesh', '{}'::TEXT[], 20),
  ('IN', 'Jabalpur', 'jabalpur', 'MP', 'Madhya Pradesh', '{}'::TEXT[], 21),
  ('IN', 'Jaipur', 'jaipur', 'RJ', 'Rajasthan', '{}'::TEXT[], 22),
  ('IN', 'Jodhpur', 'jodhpur', 'RJ', 'Rajasthan', '{}'::TEXT[], 23),
  ('IN', 'Kanpur', 'kanpur', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 24),
  ('IN', 'Kochi', 'kochi', 'KL', 'Kerala', '{}'::TEXT[], 25),
  ('IN', 'Kolhapur', 'kolhapur', 'MH', 'Maharashtra', '{}'::TEXT[], 26),
  ('IN', 'Kolkata', 'kolkata', 'WB', 'West Bengal', ARRAY['Calcutta']::TEXT[], 27),
  ('IN', 'Kozhikode', 'kozhikode', 'KL', 'Kerala', '{}'::TEXT[], 28),
  ('IN', 'Lucknow', 'lucknow', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 29),
  ('IN', 'Ludhiana', 'ludhiana', 'PB', 'Punjab', '{}'::TEXT[], 30),
  ('IN', 'Madurai', 'madurai', 'TN', 'Tamil Nadu', '{}'::TEXT[], 31),
  ('IN', 'Mangaluru', 'mangaluru', 'KA', 'Karnataka', '{}'::TEXT[], 32),
  ('IN', 'Meerut', 'meerut', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 33),
  ('IN', 'Mumbai', 'mumbai', 'MH', 'Maharashtra', ARRAY['Bombay']::TEXT[], 34),
  ('IN', 'Mysuru', 'mysuru', 'KA', 'Karnataka', '{}'::TEXT[], 35),
  ('IN', 'Nagpur', 'nagpur', 'MH', 'Maharashtra', '{}'::TEXT[], 36),
  ('IN', 'Nashik', 'nashik', 'MH', 'Maharashtra', '{}'::TEXT[], 37),
  ('IN', 'Noida', 'noida', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 38),
  ('IN', 'Patna', 'patna', 'BR', 'Bihar', '{}'::TEXT[], 39),
  ('IN', 'Pune', 'pune', 'MH', 'Maharashtra', '{}'::TEXT[], 40),
  ('IN', 'Rajkot', 'rajkot', 'GJ', 'Gujarat', '{}'::TEXT[], 41),
  ('IN', 'Ranchi', 'ranchi', 'JH', 'Jharkhand', '{}'::TEXT[], 42),
  ('IN', 'Surat', 'surat', 'GJ', 'Gujarat', '{}'::TEXT[], 43),
  ('IN', 'Thiruvananthapuram', 'thiruvananthapuram', 'KL', 'Kerala', ARRAY['Trivandrum']::TEXT[], 44),
  ('IN', 'Tiruchirappalli', 'tiruchirappalli', 'TN', 'Tamil Nadu', ARRAY['Trichy']::TEXT[], 45),
  ('IN', 'Vadodara', 'vadodara', 'GJ', 'Gujarat', '{}'::TEXT[], 46),
  ('IN', 'Varanasi', 'varanasi', 'UP', 'Uttar Pradesh', '{}'::TEXT[], 47),
  ('IN', 'Vijayawada', 'vijayawada', 'AP', 'Andhra Pradesh', '{}'::TEXT[], 48),
  ('IN', 'Visakhapatnam', 'visakhapatnam', 'AP', 'Andhra Pradesh', ARRAY['Vizag']::TEXT[], 49)
ON CONFLICT (country_code, city_slug) DO NOTHING;

COMMIT;
