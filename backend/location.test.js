const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('./server');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function frontend() {
  const nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { disabled: false, textContent: '', events: {}, children: [], style: {}, classList: { toggle() {}, add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } }, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); }, querySelector() { return element('searchSubmit'); }, addEventListener(event, callback) { this.events[event] = callback; }, setAttribute() {}, scrollIntoView() {} });
    }
    return nodes.get(id);
  }
  const map = { events: {}, setView() { return this; }, on(event, cb) { this.events[event] = cb; }, removeLayer() {}, invalidateSize() {} };
  let pin;
  const fixes = [];
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => element(Symbol()) }, window: { isSecureContext: true },
    AbortController, URLSearchParams,
    navigator: { geolocation: { getCurrentPosition(success, error, options) { fixes.push({ success, error, options }); } } },
    L: { map: () => map, tileLayer: () => ({ addTo() {} }), circle: () => ({ addTo() { return this; } }), marker: ([lat, lng]) => {
      pin = { point: { lat, lng }, handlers: [], addTo() { return this; }, on(event, cb) { this.handlers.push(cb); }, setLatLng(value) { this.point = Array.isArray(value) ? { lat: value[0], lng: value[1] } : value; }, getLatLng() { return this.point; } };
      return pin;
    } },
    fetch: async () => { throw Error('No network in unit test'); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/script.js'), 'utf8'), context);
  return { context, element, map, fixes, pin: () => pin, run: code => vm.runInContext(code, context) };
}

test('frontend GPS fallback, denied permission, one drag listener and method provenance (simulated)', () => {
  const f = frontend();
  f.element('gpsButton').events.click();
  assert.equal(f.fixes[0].options.enableHighAccuracy, true);
  f.fixes[0].error({ code: 3 });
  assert.equal(f.fixes[1].options.enableHighAccuracy, false);
  f.fixes[1].success({ coords: { latitude: 14.1, longitude: 75.2, accuracy: 500 }, timestamp: Date.now() });
  assert.match(f.element('status').textContent, /500 metres/);
  f.run("selectMethod('village')");
  assert.equal(f.run('selected.method'), 'gps');
  f.map.events.click({ latlng: { lat: 14.2, lng: 75.3 } });
  assert.equal(f.pin().handlers.length, 1);
  f.pin().point = { lat: 14.23456789, lng: 75.34567891 };
  f.pin().handlers[0]();
  assert.ok(Math.abs(f.run('selected.latitude') - 14.23456789) < 1e-10);
  assert.ok(Math.abs(f.run('selected.longitude') - 75.34567891) < 1e-10);
  assert.equal(f.element('coordinates').textContent, '14.234568, 75.345679');
  const denied = frontend();
  denied.element('gpsButton').events.click();
  denied.fixes[0].error({ code: 1 });
  assert.equal(denied.fixes.length, 1);
  assert.equal(denied.element('gpsButton').disabled, false);
});

function climateResponse(latitude, longitude) {
  return {
    success: true, coordinates: { latitude, longitude }, period: { start: '20230101', end: '20261115' },
    climate: { summary: { meanTemperatureC: 20, meanHumidityPercent: 60, meanAnnualRainfallMm: null, completeRainfallYears: [] }, monthly: [], yearly: [], monthlyRainfallClimatology: [], currentYear: { partial: true, through: null, rainfallYtdMm: null, rainfallObservedMm: null, equivalentPeriodComparisons: [] }, dataQuality: { coverage: {}, firstAvailableDate: '2023-01-01', lastAvailableDate: '2026-11-10', lastAvailableByParameter: {}, warnings: [] } }
  };
}

test('confirmation transfers exact backend coordinates to climate request and renders null explicitly (simulated)', async () => {
  const f = frontend();
  f.map.events.click({ latlng: { lat: 14.123456789, lng: 75.987654321 } });
  let posted;
  f.context.fetch = async (url, options) => {
    if (url === '/api/farm-location') {
      posted = JSON.parse(options.body);
      return { ok: true, json: async () => ({ ...posted, confirmed: true }) };
    }
    const parsed = new URL(url, 'http://localhost:3001');
    assert.equal(parsed.pathname, '/api/climate');
    assert.equal(Number(parsed.searchParams.get('latitude')), posted.latitude);
    assert.equal(Number(parsed.searchParams.get('longitude')), posted.longitude);
    return { ok: true, json: async () => climateResponse(posted.latitude, posted.longitude) };
  };
  await f.element('confirmButton').events.click();
  assert.equal(f.element('climateTemperature').textContent, '20 °C');
  assert.equal(f.element('climateRainfall').textContent, 'Data unavailable');
  assert.equal(f.element('climateResults').classList.contains('hidden'), false);
});

test('climate error preserves confirmation; retry works; invalid JSON is visible (simulated)', async () => {
  const f = frontend();
  f.map.events.click({ latlng: { lat: 14.1, lng: 75.2 } });
  f.context.fetch = async (url, options) => url === '/api/farm-location'
    ? { ok: true, json: async () => ({ ...JSON.parse(options.body), confirmed: true }) }
    : { ok: false, json: async () => ({ success: false, error: 'NASA timeout' }) };
  await f.element('confirmButton').events.click();
  assert.equal(f.element('confirmedPanel').classList.contains('hidden'), false);
  assert.match(f.element('climateError').textContent, /NASA timeout/);
  assert.match(f.element('climateReadyStatus').textContent, /could not finish/);
  assert.equal(f.element('climateLoading').classList.contains('hidden'), true);
  assert.equal(f.element('retryClimate').classList.contains('hidden'), false);
  f.context.fetch = async () => ({ ok: true, json: async () => climateResponse(14.1, 75.2) });
  await f.element('retryClimate').events.click();
  assert.equal(f.element('climateResults').classList.contains('hidden'), false);
  f.context.fetch = async () => ({ ok: true, json: async () => { throw SyntaxError(); } });
  await f.element('retryClimate').events.click();
  assert.match(f.element('climateError').textContent, /invalid JSON/);
});

test('marker movement cancels climate and stale results cannot render (simulated)', async () => {
  const f = frontend();
  f.map.events.click({ latlng: { lat: 14.1, lng: 75.2 } });
  let finish, signal;
  f.context.fetch = async (url, options) => {
    if (url === '/api/farm-location') return { ok: true, json: async () => ({ ...JSON.parse(options.body), confirmed: true }) };
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = f.element('confirmButton').events.click();
  await new Promise(resolve => setImmediate(resolve));
  f.map.events.click({ latlng: { lat: 14.3, lng: 75.4 } });
  assert.equal(signal.aborted, true);
  finish({ ok: true, json: async () => climateResponse(14.1, 75.2) });
  await pending;
  assert.equal(f.element('climatePanel').classList.contains('hidden'), true);
  assert.equal(f.element('climateResults').classList.contains('hidden'), true);
});

test('existing village submit selects provider coordinates and updates method (simulated)', async () => {
  const f = frontend();
  f.element('placeInput').value = 'Test village, Karnataka';
  f.context.fetch = async url => {
    assert.match(url, /^\/api\/geocode\?q=/);
    return { ok: true, json: async () => [{ name: 'Synthetic test village', latitude: 14.5, longitude: 75.5 }] };
  };
  await f.element('searchPanel').events.submit({ preventDefault() {} });
  f.element('results').children[0].events.click();
  assert.equal(f.run('selected.latitude'), 14.5);
  assert.equal(f.run('selected.longitude'), 75.5);
  assert.equal(f.run('selected.method'), 'village');
});

test('frontend ignores confirmation response when marker moved during request (simulated)', async () => {
  const f = frontend();
  f.map.events.click({ latlng: { lat: 14.1, lng: 75.2 } });
  let resolve;
  let submitted;
  f.context.fetch = (_url, options) => { submitted = JSON.parse(options.body); return new Promise(done => { resolve = done; }); };
  const pending = f.element('confirmButton').events.click();
  f.map.events.click({ latlng: { lat: 14.3, lng: 75.4 } });
  resolve({ ok: true, json: async () => ({ ...submitted, confirmed: true }) });
  await pending;
  assert.match(f.element('status').textContent, /Location changed/);
  assert.ok(Math.abs(f.run('selected.latitude') - 14.3) < 1e-10);
});

// Exercise the actual Express handlers without opening network sockets.
async function request(method, path, input = {}) {
  const layer = app.router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `Route exists: ${method} ${path}`);
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await layer.route.stack[0].handle(input, response);
  return response;
}

test('health and coordinate confirmation preserve full precision and method', async () => {
  assert.equal((await request('get', '/api/health')).body.status, 'ok');
  const body = { latitude: 14.123456789, longitude: 75.987654321, method: 'gps' };
  const result = await request('post', '/api/farm-location', { body });
  assert.equal(result.statusCode, 200);
  assert.ok(Math.abs(result.body.latitude - body.latitude) < 1e-10);
  assert.ok(Math.abs(result.body.longitude - body.longitude) < 1e-10);
  assert.equal(result.body.location_method, 'gps');
  assert.equal(result.body.confirmed, true);
  assert.equal((await request('post', '/api/farm-location', { body: { ...body, method: undefined, location_method: 'village' } })).body.location_method, 'village');
});

test('invalid, missing, nonnumeric and out-of-range coordinates fail', async () => {
  for (const body of [{}, { latitude: '14', longitude: 75, method: 'gps' }, { latitude: null, longitude: 75, method: 'gps' }, { latitude: 91, longitude: 75, method: 'gps' }, { latitude: 14, longitude: 181, method: 'gps' }, { latitude: NaN, longitude: 75, method: 'gps' }, { latitude: 14, longitude: 75, method: 'invalid' }]) {
    assert.equal((await request('post', '/api/farm-location', { body })).statusCode, 400);
  }
});

test('query validation, real-handler cache, empty results, and upstream failures (simulated)', async () => {
  for (const q of [undefined, '', 'ab', ['village'], 'a'.repeat(121)]) {
    assert.equal((await request('get', '/api/geocode', { query: { q } })).statusCode, 400);
  }
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(url.searchParams.get('countrycodes'), 'in');
      assert.match(options.headers['User-Agent'], /AgriShift/);
      return { ok: true, json: async () => [] };
    };
    assert.deepEqual((await request('get', '/api/geocode', { query: { q: 'test-empty' } })).body, []);
    await request('get', '/api/geocode', { query: { q: 'test-empty' } });
    assert.equal(calls, 1);
    global.fetch = async () => { throw Object.assign(new Error('simulated timeout'), { name: 'TimeoutError' }); };
    assert.equal((await request('get', '/api/geocode', { query: { q: 'test-timeout' } })).statusCode, 504);
    global.fetch = async () => ({ ok: false, status: 429 });
    assert.equal((await request('get', '/api/geocode', { query: { q: 'test-rejected' } })).statusCode, 503);
    global.fetch = async () => { throw new TypeError('simulated network failure'); };
    assert.equal((await request('get', '/api/geocode', { query: { q: 'test-network' } })).statusCode, 502);
  } finally { global.fetch = originalFetch; }
});
