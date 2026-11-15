'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { validateFarmerLand, OPTIONS } = require('./services/farmerInputValidator');
const router = require('./routes/farmerLandRoutes');
const valid = () => ({ latitude: 14, longitude: 75, soilType: 'red', irrigationAvailability: 'moderate', previousCrop: 'maize', currentCrop: 'paddy', nextSeason: 'rabi', plantingDate: '2099-11-20' });
test('six agricultural fields normalize; all 20 crop IDs plus other/unknown are offered', () => {
  const result = validateFarmerLand({ ...valid(), soilType: ' RED ' });
  assert.equal(result.valid, true); assert.equal(result.data.soilType, 'red');
  assert.equal(OPTIONS.crops.length, 22); assert.equal(new Set(OPTIONS.crops.map(c => c.id)).size, 22);
  for (const crop of OPTIONS.crops) assert.equal(validateFarmerLand({ ...valid(), previousCrop: crop.id, currentCrop: crop.id }).valid, true);
});
test('reject malformed objects, extra properties, coordinates, each invalid field and invalid/past dates', () => {
  for (const input of [null, [], 'x', { ...valid(), extra: true }, { ...valid(), latitude: '14' }, { ...valid(), longitude: 181 }, { ...valid(), plantingDate: '2099-02-30' }, { ...valid(), plantingDate: '2020-01-01' }]) assert.equal(validateFarmerLand(input).valid, false);
  for (const field of ['soilType', 'irrigationAvailability', 'previousCrop', 'currentCrop', 'nextSeason', 'plantingDate']) {
    const result = validateFarmerLand({ ...valid(), [field]: 'invalid' }); assert.equal(result.valid, false); assert.ok(result.errors.some(e => e.field === field)); assert.equal(result.data, null);
  }
});
test('farmer routes return options and normalized records without saving', async () => {
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } });
  const get = router.stack.find(l => l.route?.path === '/options').route.stack[0].handle;
  const post = router.stack.find(l => l.route?.methods.post).route.stack[0].handle;
  const options = response(); get({}, options); assert.equal(options.data.crops.length, 22);
  const success = response(); post({ body: valid() }, success); assert.equal(success.data.saved, false); assert.equal(success.data.stage, 3);
  const bad = response(); post({ body: {} }, bad); assert.equal(bad.code, 400); assert.ok(bad.data.errors.length);
});
test('session helper saves, restores, clears and tolerates broken/blocked storage', () => {
  const values = new Map();
  const context = { window: {}, sessionStorage: { setItem: (k, v) => values.set(k, v), getItem: k => values.get(k), removeItem: k => values.delete(k) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/farmerSession.js'), 'utf8'), context);
  const session = context.window.FarmerSession;
  assert.equal(session.saveFarmerLand(valid()), true); assert.equal(session.getFarmerLand().soilType, 'red');
  session.clearFarmerLand(); assert.equal(session.getFarmerLand(), null);
  values.set('agrishift_farmer_land', '{bad'); assert.equal(session.getFarmerLand(), null);
  context.sessionStorage.setItem = () => { throw Error('blocked'); }; assert.equal(session.saveFarmerLand(valid()), false);
});
module.exports = { valid };
