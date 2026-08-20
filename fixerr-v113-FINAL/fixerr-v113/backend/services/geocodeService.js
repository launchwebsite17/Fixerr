// services/geocodeService.js - OpenStreetMap Nominatim Geocoding
const https = require('https');

function buildSearchUrl({ cityOrZip, state, country, city, street }) {
  const countryCode = country === 'IN' ? 'in' : 'us';
  if (street || city) {
    const params = new URLSearchParams({ format: 'json', limit: '1', addressdetails: '1', countrycodes: countryCode });
    if (street) params.set('street', street);
    if (city) params.set('city', city);
    if (state) params.set('state', state);
    if (cityOrZip) {
      if (/^\d+$/.test(String(cityOrZip))) params.set('postalcode', String(cityOrZip));
      else if (!city) params.set('city', String(cityOrZip));
    }
    return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  }
  const parts = [cityOrZip, state, country === 'IN' ? 'India' : 'United States'];
  const q = encodeURIComponent(parts.filter(Boolean).join(', '));
  return `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=1&countrycodes=${countryCode}`;
}

async function geocodeCity(cityOrZip, state, country, city) {
  return new Promise((resolve) => {
    const url = buildSearchUrl({ cityOrZip, state, country, city });
    const req = https.get(url, { headers: { 'User-Agent': 'FixerrApp/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results.length > 0) {
            resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) });
          } else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function geocodePlace(location = {}) {
  const city = location.city || null;
  const zip = location.zip || location.cityOrZip || null;
  return geocodeCity(zip || city, location.state, location.country, city || null, location.street || null);
}

module.exports = { geocodeCity, geocodePlace };
