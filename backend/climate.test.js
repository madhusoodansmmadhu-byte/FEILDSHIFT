const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeClimate } = require('./services/climateAnalysis');
const { createNASAService, parsePowerDate, powerDate, validCoordinates, PARAMETERS, DAY } = require('./services/nasaPowerService');
const app = require('./server');

// Synthetic observations exist only in tests, never in production or the dashboard.
function fixture(start = '20230101', end = '20260301') {
  const parameters = { T2M: {}, PRECTOTCORR: {}, RH2M: {} };
  for (let time = parsePowerDate(start).getTime(); time <= parsePowerDate(end).getTime(); time += DAY) {
    const date = powerDate(new Date(time));
    parameters.T2M[date] = 20;
    parameters.PRECTOTCORR[date] = 2;
    parameters.RH2M[date] = 60;
  }
  return { source: 'NASA POWER', coordinates: { latitude: 14.123456789, longitude: 75.987654321 }, requestedPeriod: { start, end }, parameters, metadata: { header: { fill_value: -999 }, definitions: { T2M: { units: 'C' }, PRECTOTCORR: { units: 'mm/day' }, RH2M: { units: '%' } }, geometry: { type: 'Point', coordinates: [75.987654321, 14.123456789, 0] } } };
}
function response(data) {
  return { ok: true, json: async () => ({ header: data.metadata.header, geometry: data.metadata.geometry, parameters: data.metadata.definitions, properties: { parameter: data.parameters } }) };
}

test('daily analysis: monthly, annual, leap year, climatology, means, YTD and equivalent dates', () => {
  const result = analyzeClimate(fixture());
  assert.equal(result.summary.meanTemperatureC, 20);
  assert.equal(result.summary.meanHumidityPercent, 60);
  assert.equal(result.yearly.find(item => item.year === 2024).annualRainfallMm, 732);
  assert.equal(result.monthly.find(item => item.year === 2024 && item.month === 2).rainfallTotalMm, 58);
  assert.equal(result.summary.meanAnnualRainfallMm, 730.67);
  assert.equal(result.monthlyRainfallClimatology[1].meanRainfallMm, 56.67);
  assert.equal(result.currentYear.partial, true);
  assert.equal(result.currentYear.rainfallYtdMm, 120);
  assert.equal(result.currentYear.equivalentPeriodComparisons.find(item => item.year === 2024).rainfallMm, 122);
  assert.equal(result.dataQuality.lastAvailableDate, '2026-03-01');
  assert.equal(result.dataQuality.coverage.T2M.expected, 1156);
});

test('metadata fills, known sentinel, nulls, missing days and invalid physical observations are not zero', () => {
  const data = fixture();
  data.metadata.header.fill_value = -777;
  data.parameters.T2M['20230101'] = -777;
  data.parameters.T2M['20230102'] = -999;
  data.parameters.T2M['20230103'] = null;
  data.parameters.RH2M['20230101'] = 101;
  delete data.parameters.PRECTOTCORR['20240229'];
  data.parameters.PRECTOTCORR['20260102'] = -1;
  const result = analyzeClimate(data);
  assert.equal(result.dataQuality.coverage.T2M.missing, 3);
  assert.equal(result.dataQuality.coverage.RH2M.missing, 1);
  const year = result.yearly.find(item => item.year === 2024);
  assert.equal(year.complete, false);
  assert.equal(year.annualRainfallMm, null);
  assert.equal(year.rainfallObservedMm, 730);
  assert.deepEqual(result.summary.completeRainfallYears, [2023, 2025]);
  assert.equal(result.currentYear.rainfallYtdMm, null);
  assert.equal(result.currentYear.rainfallObservedMm, 118);
});

test('publication lag records actual per-parameter coverage; invalid dates and missing series fail', () => {
  const data = fixture('20260101', '20260103');
  delete data.parameters.RH2M['20260103'];
  delete data.parameters.PRECTOTCORR['20260103'];
  const result = analyzeClimate(data);
  assert.equal(result.dataQuality.lastAvailableDate, '2026-01-03');
  assert.equal(result.dataQuality.lastAvailableByParameter.PRECTOTCORR, '2026-01-02');
  assert.equal(result.currentYear.through, '2026-01-02');
  assert.equal(result.currentYear.rainfallYtdMm, 4);
  data.parameters.T2M['20260230'] = 20;
  assert.throws(() => analyzeClimate(data), /Invalid calendar date/);
  delete data.parameters.T2M['20260230'];
  data.parameters.RH2M = undefined;
  assert.throws(() => analyzeClimate(data), /Missing parameter/);
  const empty = fixture('20260101', '20260101');
  for (const name of PARAMETERS) empty.parameters[name] = {};
  assert.throws(() => analyzeClimate(empty), /no valid observations/);
});

test('strict date/coordinate validation; service caps today, preserves coordinates, caches and deduplicates', async () => {
  assert.equal(validCoordinates(14, 75), true);
  for (const pair of [[undefined, 75], ['14', 75], [91, 75], [14, -181], [NaN, 75]]) assert.equal(validCoordinates(...pair), false);
  assert.throws(() => parsePowerDate('20230229'));
  assert.throws(() => parsePowerDate('2024-01-01'));
  let calls = 0, captured;
  const service = createNASAService({ now: () => new Date('2026-03-01T12:00:00Z'), fetchImpl: async url => { calls++; captured = new URL(url); return response(fixture()); } });
  const results = await Promise.all([service.getNASAClimate(14.123456789, 75.987654321), service.getNASAClimate(14.123456789, 75.987654321)]);
  assert.equal(calls, 1);
  assert.equal(results[0], results[1]);
  await service.getNASAClimate(14.123456789, 75.987654321);
  assert.equal(calls, 1);
  assert.equal(captured.searchParams.get('latitude'), '14.123456789');
  assert.equal(captured.searchParams.get('longitude'), '75.987654321');
  assert.equal(captured.searchParams.get('end'), '20260301');
  assert.equal(captured.searchParams.get('community'), 'AG');
  assert.equal(captured.searchParams.get('parameters'), 'T2M,PRECTOTCORR,RH2M');
  await assert.rejects(service.getNASAClimate(14, 75, { start: '20260230' }));
  await assert.rejects(service.getNASAClimate(14, 75, { start: '20270101' }));
  const capped = createNASAService({ now: () => new Date('2026-03-01'), fetchImpl: async url => { assert.equal(new URL(url).searchParams.get('end'), '20260301'); return response(fixture()); } });
  await capped.getNASAClimate(14, 75, { end: '20261231' });
});

test('bounded cache expires and evicts; failed requests are not cached', async () => {
  let calls = 0, clock = new Date('2026-03-01T12:00:00Z');
  const service = createNASAService({ maxEntries: 1, ttlMs: 1000, now: () => clock, fetchImpl: async () => { calls++; return response(fixture()); } });
  await service.getNASAClimate(14, 75);
  await service.getNASAClimate(15, 75);
  await service.getNASAClimate(14, 75);
  assert.equal(calls, 3);
  clock = new Date(clock.getTime() + 2000);
  await service.getNASAClimate(14, 75);
  assert.equal(calls, 4);
  const failure = createNASAService({ fetchImpl: async () => { calls++; throw Error('network'); } });
  await assert.rejects(failure.getNASAClimate(14, 75));
  await assert.rejects(failure.getNASAClimate(14, 75));
  assert.equal(calls, 6);
});

test('NASA HTTP errors, timeouts, invalid JSON, bad units and absent parameters propagate clearly', async () => {
  for (const status of [422, 429, 500]) {
    const service = createNASAService({ fetchImpl: async () => ({ ok: false, status }) });
    await assert.rejects(service.getNASAClimate(14, 75), error => error.upstreamStatus === status);
  }
  const timeout = createNASAService({ fetchImpl: async () => { throw Object.assign(Error('timeout'), { name: 'TimeoutError' }); } });
  await assert.rejects(timeout.getNASAClimate(14, 75), { name: 'TimeoutError' });
  const invalidJson = createNASAService({ fetchImpl: async () => ({ ok: true, json: async () => { throw SyntaxError(); } }) });
  await assert.rejects(invalidJson.getNASAClimate(14, 75), /invalid JSON/);
  const missing = createNASAService({ fetchImpl: async () => ({ ok: true, json: async () => ({ properties: { parameter: {} } }) }) });
  await assert.rejects(missing.getNASAClimate(14, 75), /missing required/);
  const bad = fixture(); bad.metadata.definitions.T2M.units = 'F';
  assert.throws(() => analyzeClimate(bad), /Unexpected NASA units/);
});

async function climateRoute(query) {
  const handler = app.router.stack.find(item => item.route?.path === '/api/climate').route.stack[0].handle;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query }, response);
  return response;
}

test('actual climate route rejects invalid query types and returns success or suitable upstream errors (mocked)', async () => {
  for (const query of [{}, { latitude: '', longitude: '75' }, { latitude: ['14'], longitude: '75' }, { latitude: '91', longitude: '75' }, { latitude: '14', longitude: 'bad' }]) assert.equal((await climateRoute(query)).statusCode, 400);
  const original = global.fetch;
  try {
    global.fetch = async () => response(fixture());
    const success = await climateRoute({ latitude: '14.123456789', longitude: '75.987654321' });
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.coordinates.longitude, 75.987654321);
    assert.equal(success.body.climate.summary.meanTemperatureC, 20);
    assert.equal(success.body.parameters, undefined);
    global.fetch = async () => { throw Object.assign(Error('timeout'), { name: 'TimeoutError' }); };
    assert.equal((await climateRoute({ latitude: '15', longitude: '75' })).statusCode, 504);
    global.fetch = async () => ({ ok: false, status: 500 });
    assert.equal((await climateRoute({ latitude: '16', longitude: '75' })).statusCode, 502);
  } finally { global.fetch = original; }
});

test('multi-year timeout recovers with sequential year requests and caches only the merged result', async () => {
  const ranges = [];
  const service = createNASAService({ now: () => new Date('2026-03-01T12:00:00Z'), fetchImpl: async url => {
    const params = new URL(url).searchParams;
    const range = [params.get('start'), params.get('end')]; ranges.push(range);
    if (ranges.length === 1) throw Object.assign(Error('slow full history'), { name: 'TimeoutError' });
    assert.equal(params.get('parameters'), 'T2M,PRECTOTCORR,RH2M'); assert.equal(params.get('community'), 'AG');
    return response(fixture(...range));
  } });
  const [first, second] = await Promise.all([service.getNASAClimate(14, 75), service.getNASAClimate(14, 75)]);
  assert.equal(first, second);
  assert.deepEqual(ranges, [['20230101', '20260301'], ['20230101', '20231231'], ['20240101', '20241231'], ['20250101', '20251231'], ['20260101', '20260301']]);
  assert.equal(Object.keys(first.parameters.T2M).length, 1156);
  assert.equal(analyzeClimate(first).dataQuality.coverage.PRECTOTCORR.missing, 0);
  await service.getNASAClimate(14, 75); assert.equal(ranges.length, 5);
});

test('failed yearly recovery is not cached, and rejected NASA dates are not retried', async () => {
  let calls = 0;
  const service = createNASAService({ now: () => new Date('2026-03-01'), fetchImpl: async url => {
    calls++;
    if (calls === 1 || calls === 3) throw Object.assign(Error('slow'), { name: 'TimeoutError' });
    const params = new URL(url).searchParams;
    return response(fixture(params.get('start'), params.get('end')));
  } });
  await assert.rejects(service.getNASAClimate(14, 75), { name: 'TimeoutError' });
  const recovered = await service.getNASAClimate(14, 75); assert.equal(calls, 4);
  assert.equal(recovered.requestedPeriod.start, '20230101');
  let rejectedCalls = 0;
  const rejected = createNASAService({ fetchImpl: async () => { rejectedCalls++; return { ok: false, status: 422 }; } });
  await assert.rejects(rejected.getNASAClimate(14, 75), error => error.upstreamStatus === 422); assert.equal(rejectedCalls, 1);
});
