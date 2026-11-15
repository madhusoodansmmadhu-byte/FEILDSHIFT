'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeGrowingSeasons } = require('./services/growingSeasonAnalysis');
const { PROFILES, rangeScore, weightedClimate, finalScore, evaluateCrops } = require('./services/ruleEngine');
const { powerDate, DAY } = require('./services/nasaPowerService');
const router = require('./routes/ruleEngineRoutes');
const farmer = () => ({ latitude: 13.33, longitude: 76.66, soilType: 'loamy', irrigationAvailability: 'moderate', previousCrop: 'tomato', currentCrop: 'onion', nextSeason: 'rabi', plantingDate: '2099-11-20' });
function observations() {
  const parameters = { T2M: {}, PRECTOTCORR: {}, RH2M: {} };
  for (let time = Date.UTC(2023, 0, 1); time <= Date.UTC(2026, 10, 15); time += DAY) {
    const date = powerDate(new Date(time)); parameters.T2M[date] = 28; parameters.PRECTOTCORR[date] = 4.7; parameters.RH2M[date] = 65;
  }
  return { requestedPeriod: { start: '20230101', end: '20261115' }, parameters, metadata: { header: { fill_value: -999 }, definitions: { T2M: { units: 'C' }, PRECTOTCORR: { units: 'mm/day' }, RH2M: { units: '%' } } } };
}
test('cross-year growing windows use daily observations and exact duration', () => {
  const result = analyzeGrowingSeasons(observations(), farmer(), 100);
  assert.equal(result.complete.length, 3); assert.equal(result.windows[0].start, '20231120'); assert.equal(result.windows[0].end, '20240227');
  assert.equal(result.complete[0].meanTemperatureC, 28); assert.ok(Math.abs(result.complete[0].rainfallTotalMm - 470) < 1e-8);
  assert.equal(result.complete[0].coverage.PRECTOTCORR.expected, 100);
});
test('missing rainfall is null, not zero; fill, humidity and units are validated', () => {
  const data = observations(); data.parameters.PRECTOTCORR['20231120'] = -999; data.parameters.RH2M['20241120'] = 101;
  const result = analyzeGrowingSeasons(data, farmer(), 100);
  assert.equal(result.windows[0].rainfallTotalMm, null); assert.equal(result.complete.length, 1); assert.equal(result.status, 'limited');
  data.metadata.definitions.T2M.units = 'F'; assert.throws(() => analyzeGrowingSeasons(data, farmer(), 100), /units/);
});
test('unknown duration, no complete windows and leap-day analogues remain unavailable safely', () => {
  assert.equal(analyzeGrowingSeasons(observations(), farmer(), null).status, 'unavailable');
  const data = observations(); data.parameters.PRECTOTCORR = {};
  assert.equal(analyzeGrowingSeasons(data, farmer(), 100).status, 'unavailable');
  const leap = analyzeGrowingSeasons(observations(), { ...farmer(), plantingDate: '2104-02-29' }, 100);
  assert.equal(leap.windows.length, 1); assert.equal(leap.windows[0].year, 2024);
});
test('weighted formulas, missing humidity renormalization, gradual penalties and score bounds', () => {
  assert.equal(finalScore({ climate: 8, soil: 6, irrigation: 4, rotation: 2 }), 5.8);
  assert.ok(Math.abs(weightedClimate({ temperature: 8, precipitation: 6, humidity: 4 }) - 6.5) < 1e-10);
  assert.ok(Math.abs(weightedClimate({ temperature: 8, precipitation: 6, humidity: null }) - (5.9 / .85)) < 1e-10);
  assert.equal(rangeScore(null, [25, 32]), null);
  assert.ok(rangeScore(24, [25, 32]) > rangeScore(20, [25, 32]));
  for (const value of [-1000, 0, 25, 32, 1000]) assert.ok(rangeScore(value, [25, 32]) >= 1 && rangeScore(value, [25, 32]) <= 10);
});
test('20 independent evaluations rank raw scores; no invented scores for missing evidence', () => {
  assert.equal(PROFILES.length, 20);
  const result = evaluateCrops(farmer(), observations());
  assert.equal(result.evaluations.length, 20); assert.equal(result.topRecommendations.length, 3);
  assert.ok(result.evaluations.slice(0, 3).every((crop, i) => crop.rank === i + 1));
  for (let i = 1; i < 3; i++) assert.ok(result.evaluations[i - 1].scores.final >= result.evaluations[i].scores.final);
  assert.ok(result.evaluations.filter(c => c.eligibility === 'unassessable').every(c => c.scores.final === null));
  const changed = evaluateCrops({ ...farmer(), currentCrop: 'ragi' }, observations());
  assert.ok(changed.evaluations.find(c => c.cropId === 'ragi').scores.rotation < result.evaluations.find(c => c.cropId === 'ragi').scores.rotation);
});
test('recommendation API revalidates, ignores no client climate, fetches once and exposes no raw observations', async () => {
  const handler = router.stack.find(l => l.route?.methods.post).route.stack[0].handle;
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  const invalid = response(); await handler({ body: { farmerData: {} } }, invalid); assert.equal(invalid.code, 400);
  const injected = response(); await handler({ body: { farmerData: farmer(), climate: {} } }, injected); assert.equal(injected.code, 400);
  const original = global.fetch; let calls = 0;
  try {
    const data = observations();
    global.fetch = async () => { calls++; return { ok: true, json: async () => ({ header: data.metadata.header, parameters: data.metadata.definitions, properties: { parameter: data.parameters } }) }; };
    const success = response(); await handler({ body: { farmerData: farmer() } }, success);
    assert.equal(success.code, 200); assert.equal(success.data.success, true); assert.equal(success.data.evaluations.length, 20); assert.equal(success.data.saved, false); assert.equal(calls, 1);
    const serialized = JSON.stringify(success.data); for (const key of ['meanTemperatureC', 'rainfallTotalMm', 'latitude', 'longitude', 'PRECTOTCORR']) assert.equal(serialized.includes(key), false);
  } finally { global.fetch = original; }
});
test('documented maize summer incompatibility excludes it without a score', () => {
  const data = observations(); for (const date of Object.keys(data.parameters.T2M)) data.parameters.T2M[date] = 15;
  const maize = evaluateCrops({ ...farmer(), nextSeason: 'summer', plantingDate: '2099-03-01' }, data).evaluations.find(c => c.cropId === 'maize');
  assert.equal(maize.eligibility, 'excluded'); assert.equal(maize.rank, null); assert.equal(maize.scores.final, null);
});
