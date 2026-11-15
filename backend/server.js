const { getNASAClimate } =
  require("./services/nasaPowerService");

const express = require('express');
const path = require('node:path');
const { analyzeClimate } = require('./services/climateAnalysis');

const app = express();
const port = process.env.PORT || 3001;
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
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 3 || query.length > 120) {
    return res.status(400).json({ error: 'Enter a place name of 3–120 characters.' });
  }
  const key = query.toLocaleLowerCase('en');
  if (cache.has(key)) return res.json(cache.get(key));

  // Serialize outgoing searches to respect public service rate limits.
  const job = nextSearch.then(async () => {
    if (cache.has(key)) return cache.get(key);
    const wait = Math.max(0, 1100 - (Date.now() - lastSearchAt));
    if (wait) await delay(wait);
    lastSearchAt = Date.now();
    const url = new URL(process.env.NOMINATIM_SEARCH_URL || 'https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'in');
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      const error = new Error(`Geocoding service returned ${response.status}`);
      error.upstreamStatus = response.status;
      throw error;
    }
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error('Unexpected geocoding response');
    const places = raw.map(place => ({
      name: place.display_name,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      type: place.type
    })).filter(place => typeof place.name === 'string' && Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180);
    cache.set(key, places);
    if (cache.size > 150) cache.delete(cache.keys().next().value);
    return places;
  });
  nextSearch = job.catch(() => {});
  try { res.json(await job); }
  catch (error) {
    console.error('Geocode error:', error.name, error.message, error.cause?.code || '');
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    const rejected = [403, 429].includes(error.upstreamStatus);
    res.status(timeout ? 504 : rejected ? 503 : 502).json({
      error: timeout ? 'Village search timed out. Please retry later.'
        : rejected ? 'The place-search provider is limiting or rejecting requests. Please retry later.'
        : 'Cannot reach the place-search provider or read its response. Check the server connection and retry.',
      code: timeout ? 'SEARCH_TIMEOUT' : rejected ? 'SEARCH_REJECTED' : 'SEARCH_UNAVAILABLE'
    });
  }
});

app.post('/api/farm-location', (req, res) => {
  const { latitude, longitude } = req.body || {};
  const method = req.body?.location_method ?? req.body?.method;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !['gps', 'village'].includes(method)) {
    return res.status(400).json({ error: 'Valid confirmed coordinates and method are required.' });
  }
  // This stage validates and returns the location; database storage comes later.
  res.json({ confirmed: true, latitude, longitude, method, location_method: method, nasaPowerReady: true });
});

app.get('/api/climate', async (req, res) => {
  const latInput = req.query.latitude, lonInput = req.query.longitude;
  if (typeof latInput !== 'string' || typeof lonInput !== 'string' || !latInput.trim() || !lonInput.trim()) {
    return res.status(400).json({ success: false, error: 'Valid latitude and longitude are required.' });
  }
  const latitude = Number(latInput), longitude = Number(lonInput);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ success: false, error: 'Coordinates are outside valid ranges.' });
  }
  try {
    const nasaData = await getNASAClimate(latitude, longitude);
    const climate = analyzeClimate(nasaData);
    return res.status(200).json({ success: true, source: nasaData.source, coordinates: nasaData.coordinates, period: nasaData.requestedPeriod, climate, metadata: nasaData.metadata });
  } catch (error) {
    console.error('NASA POWER:', error.name, error.message);
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    return res.status(timeout ? 504 : 502).json({ success: false, error: timeout ? 'NASA POWER request timed out. Your farm location is still confirmed.' : error.upstreamStatus === 422 ? 'NASA rejected the requested date range. Recent observations may not be published yet. Please retry later.' : 'NASA climate data is temporarily unavailable. Your farm location is still confirmed.' });
  }
});

app.use(express.static(path.join(__dirname, '../frontend')));
if (require.main === module) {
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Field Shift is running at http://localhost:${port}`);
  console.log('Press Ctrl+C to stop.');
});
server.on('error', error => {
  console.error(`Could not start Field Shift: ${error.message}`);
  process.exitCode = 1;
});
}
module.exports = app;
