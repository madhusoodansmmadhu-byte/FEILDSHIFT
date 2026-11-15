'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { OPTIONS } = require('./services/farmerInputValidator');
const read = name => fs.readFileSync(path.join(__dirname, '../frontend', name), 'utf8');
function browser() {
  const nodes = new Map();
  function element() {
    const classes = new Set();
    return { value: '', children: [], events: {}, disabled: false, style: {}, textContent: '', classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} }, addEventListener(type, fn) { this.events[type] = fn; }, setAttribute() {}, appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, querySelector() { return searchSubmit; }, scrollIntoView() {}, reset() { for (const id of ['soilType', 'irrigationAvailability', 'previousCrop', 'currentCrop', 'nextSeason', 'plantingDate']) nodes.get(id).value = ''; } };
  }
  for (const match of read('index.html').matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = element(); if (/class="[^"]*\bhidden\b/.test(match[0])) node.classList.add('hidden'); nodes.set(match[1], node);
  }
  const searchSubmit = element(), storage = new Map();
  const context = { window: { isSecureContext: true }, document: { getElementById(id) { assert.ok(nodes.has(id), `DOM ID exists: ${id}`); return nodes.get(id); }, createElement: element }, navigator: {}, Intl, Date, AbortController, URLSearchParams, sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, L: { map() { return { setView() { return this; }, on() {}, invalidateSize() {}, removeLayer() {} }; }, tileLayer() { return { addTo() {} }; }, marker() { return { addTo() { return this; }, on() {}, setLatLng() {} }; } }, fetch: (...args) => context.request(...args) };
  context.request = async url => {
    if (url === '/api/farmer-land/options') return { ok: true, json: async () => ({ success: true, ...OPTIONS }) };
    throw Error(`Unexpected test request ${url}`);
  };
  vm.createContext(context);
  for (const script of ['farmerSession.js', 'recommendation-dashboard.js', 'land-form.js', 'script.js']) vm.runInContext(read(script), context);
  return { context, nodes, storage, run: code => vm.runInContext(code, context) };
}
const fill = b => { for (const [id, value] of Object.entries({ soilType: 'red', irrigationAvailability: 'limited', previousCrop: 'maize', currentCrop: 'paddy', nextSeason: 'rabi', plantingDate: '2099-11-20' })) b.nodes.get(id).value = value; };
const response = data => ({ ok: true, json: async () => data });
test('connected scripts use real HTML IDs, validate and store only backend records; edits invalidate', async () => {
  const b = browser(); await b.context.window.FarmerLand.ready({ latitude: 14, longitude: 75, version: 1 }); fill(b);
  b.context.request = async (url, opts) => { assert.equal(url, '/api/farmer-land'); return response({ success: true, landDetails: JSON.parse(opts.body) }); };
  await b.nodes.get('farmerLandForm').events.submit({ preventDefault() {} });
  assert.equal(b.storage.size, 1); assert.equal(b.nodes.get('generateRecommendationsButton').disabled, false);
  b.nodes.get('soilType').events.input();
  assert.equal(b.storage.size, 0); assert.equal(b.nodes.get('generateRecommendationsButton').disabled, true);
});
test('location change cancels validation and clears farmer and recommendation state', async () => {
  const b = browser(); await b.context.window.FarmerLand.ready({ latitude: 14, longitude: 75 }); fill(b);
  let finish, signal;
  b.context.request = async (_url, opts) => { signal = opts.signal; return new Promise(resolve => { finish = resolve; }); };
  const pending = b.nodes.get('farmerLandForm').events.submit({ preventDefault() {} });
  b.run('ensureMarker(14,75); updateSelection(15,76)');
  finish(response({ success: true, landDetails: {} })); await pending;
  assert.equal(signal.aborted, true); assert.equal(b.storage.size, 0); assert.equal(b.nodes.get('farmerLandSection').classList.contains('hidden'), true);
});
test('recommendation error exposes retry; stale recommendation cannot overwrite new assessment', async () => {
  const b = browser(); b.context.request = async () => { throw Error('Offline'); };
  await b.context.window.RecommendationDashboard.generate({});
  assert.match(b.nodes.get('recommendationStatus').textContent, /Offline/); assert.equal(b.nodes.get('retryRecommendationsButton').classList.contains('hidden'), false);
  let finish, signal;
  b.context.request = async (_url, opts) => { signal = opts.signal; return new Promise(resolve => { finish = resolve; }); };
  const pending = b.context.window.RecommendationDashboard.generate({}); b.context.window.FieldShift.startNewAssessment();
  finish(response({ success: true, evaluations: [] })); await pending;
  assert.equal(signal.aborted, true); assert.equal(b.nodes.get('recommendationSection').classList.contains('hidden'), true);
});
test('technical displays remain hidden regardless of legacy renderer class changes; map controls remain present', () => {
  const html = read('index.html'); assert.match(html, /id="climateResults"[^>]*hidden aria-hidden="true"/);
  assert.match(html, /id="confirmedText" hidden/); assert.match(html, /id="confirmedJson" hidden/);
  assert.match(html, /<div hidden><span class="caption">SELECTED COORDINATES/);
  assert.match(read('style.css'), /\[hidden\], #climateResults \{ display: none !important; \}/);
  for (const id of ['map', 'gpsMethod', 'searchMethod', 'gpsPanel', 'gpsButton', 'searchPanel', 'placeInput', 'results', 'confirmButton', 'status']) assert.ok(html.includes(`id="${id}"`));
});
test('complete connected frontend workflow confirms, waits for climate, validates, renders 20 and starts again', async () => {
  const b = browser(); const calls = [];
  assert.equal(b.nodes.get('farmerLandSection').classList.contains('hidden'), true);
  b.context.request = async (url, opts) => {
    calls.push(url);
    if (url === '/api/farm-location') return response({ ...JSON.parse(opts.body), confirmed: true });
    if (url.startsWith('/api/climate?')) return response({ success: true, coordinates: { latitude: 14, longitude: 75 }, period: { start: '20230101', end: '20261115' }, climate: { summary: { meanTemperatureC: 25, meanAnnualRainfallMm: 900, meanHumidityPercent: 65, completeRainfallYears: [2023] }, monthly: [], yearly: [], monthlyRainfallClimatology: [], currentYear: { equivalentPeriodComparisons: [], through: null }, dataQuality: { coverage: {}, warnings: [], firstAvailableDate: '2023-01-01', lastAvailableDate: '2026-11-10' } } });
    if (url === '/api/farmer-land/options') return response({ success: true, ...OPTIONS });
    if (url === '/api/farmer-land') return response({ success: true, landDetails: JSON.parse(opts.body) });
    if (url === '/api/rule-based-scores') {
      const evaluations = OPTIONS.crops.slice(0, 20).map((c, i) => ({ cropId: c.id, cropName: c.name, rank: i + 1, scores: { climate: 6, soil: 5, irrigation: 6, rotation: 7, final: 5.9 }, eligibility: 'eligible-limited', reasons: ['Synthetic test response'], warnings: [] }));
      return response({ success: true, evaluations, topRecommendations: evaluations.slice(0, 3), warnings: ['Test limitation'] });
    }
    throw Error(`Unexpected request ${url}`);
  };
  b.run('placePin(14,75)'); await b.nodes.get('confirmButton').events.click();
  assert.equal(b.nodes.get('farmerLandSection').classList.contains('hidden'), false);
  fill(b); await b.nodes.get('farmerLandForm').events.submit({ preventDefault() {} });
  await b.context.window.RecommendationDashboard.generate(b.context.window.FarmerLand.getValidated());
  assert.match(b.nodes.get('recommendationStatus').textContent, /Recommendations ready/);
  assert.equal(b.nodes.get('topRecommendations').children.length, 3);
  assert.equal(b.nodes.get('allCropResults').children[0].children[2].children.length, 20);
  assert.equal(calls.filter(url => url.startsWith('/api/climate?')).length, 1);
  b.nodes.get('newAssessmentButton').events.click();
  assert.equal(b.storage.size, 0); assert.equal(b.nodes.get('recommendationSection').classList.contains('hidden'), true);
});
test('stored details require matching coordinates and revalidation; late options cannot activate a changed location', async () => {
  const b = browser();
  b.context.window.FarmerSession.saveFarmerLand({ latitude: 14, longitude: 75, soilType: 'red' });
  await b.context.window.FarmerLand.ready({ latitude: 14, longitude: 75 });
  assert.equal(b.nodes.get('soilType').value, 'red'); assert.equal(b.nodes.get('generateRecommendationsButton').disabled, true);
  await b.context.window.FarmerLand.ready({ latitude: 15, longitude: 76 }); assert.equal(b.storage.size, 0);
  const c = browser(); let finish;
  c.context.request = async () => new Promise(resolve => { finish = resolve; });
  const pending = c.context.window.FarmerLand.ready({ latitude: 14, longitude: 75 });
  c.context.window.FarmerLand.reset(); finish(response({ success: true, ...OPTIONS })); await pending;
  assert.equal(c.nodes.get('farmerLandSection').classList.contains('hidden'), true);
});
