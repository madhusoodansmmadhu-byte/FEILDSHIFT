const express = require('express');
const path = require('node:path');

const app = express();
const port = process.env.PORT || 3000;
app.disable('x-powered-by');
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Public Nominatim permits at most one request/second per application.
// A single-process queue and cache are suitable for a small learning prototype.
const cache = new Map();
let nextSearch = Promise.resolve();
let lastSearchAt = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const email = process.env.NOMINATIM_CONTACT_EMAIL;
const userAgent = email
  ? `AgriShiftHackathon/1.0 (${email})`
  : 'AgriShiftHackathon/1.0 (local educational prototype; configure NOMINATIM_CONTACT_EMAIL)';

app.get('/api/geocode', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 3 || query.length > 120) {
    return res.status(400).json({ error: 'Enter a place name of 3–120 characters.' });
  }
  const key = query.toLocaleLowerCase('en');
  if (cache.has(key)) return res.json(cache.get(key));

  // Serialize outgoing searches to respect public service rate limits.
  const job = nextSearch.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastSearchAt));
    if (wait) await delay(wait);
    lastSearchAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'in');
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`);
    const raw = await response.json();
    const places = raw.map(place => ({
      name: place.display_name,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      type: place.type
    })).filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
    cache.set(key, places);
    if (cache.size > 150) cache.delete(cache.keys().next().value);
    return places;
  });
  nextSearch = job.catch(() => {});
  try { res.json(await job); }
  catch (error) {
    console.error('Geocode error:', error.message);
    res.status(502).json({ error: 'Place search is temporarily unavailable. Try GPS or retry later.' });
  }
});

app.post('/api/farm-location', (req, res) => {
  const { latitude, longitude, method } = req.body || {};
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !['gps', 'village'].includes(method)) {
    return res.status(400).json({ error: 'Valid confirmed coordinates and method are required.' });
  }
  // This stage validates and returns the location; database storage comes later.
  res.json({ confirmed: true, latitude, longitude, method, nasaPowerReady: true });
});

app.use(express.static(path.join(__dirname, '../frontend')));
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Field Shift is running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});
server.on('error', error => {
  console.error(`Could not start Field Shift: ${error.message}`);
  process.exitCode = 1;
});
