'use strict';

const SOILS = ['red', 'black', 'sandy', 'loamy', 'clayey', 'laterite', 'unknown'];
const IRRIGATION = ['limited', 'moderate', 'sufficient', 'unknown'];
const SEASONS = ['kharif', 'rabi', 'summer'];
const CROP_NAMES = ['Paddy', 'Maize', 'Ragi', 'Jowar', 'Bajra', 'Wheat', 'Groundnut', 'Chickpea', 'Green gram', 'Black gram', 'Pigeon pea', 'Soybean', 'Sunflower', 'Sesame', 'Mustard', 'Cotton', 'Sugarcane', 'Potato', 'Onion', 'Tomato'];
const CROPS = CROP_NAMES.map(name => ({ id: name.toLowerCase().replaceAll(' ', '-'), name }));
const OPTIONS = { soilTypes: SOILS, irrigationLevels: IRRIGATION, crops: [...CROPS, { id: 'other', name: 'Other' }, { id: 'unknown', name: 'Unknown' }], seasons: SEASONS };
function validateFarmerLand(input) {
  const errors = [], data = {};
  const fail = (field, message) => errors.push({ field, message });
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return { valid: false, data: null, errors: [{ field: 'form', message: 'Expected a plain object' }] };
  const allowed = ['latitude', 'longitude', 'soilType', 'irrigationAvailability', 'previousCrop', 'currentCrop', 'nextSeason', 'plantingDate'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(key, 'Unsupported property');
  for (const [key, max] of [['latitude', 90], ['longitude', 180]]) {
    if (!Number.isFinite(input[key]) || Math.abs(input[key]) > max) fail(key, 'Invalid confirmed location');
    else data[key] = input[key];
  }
  for (const [key, values] of [['soilType', SOILS], ['irrigationAvailability', IRRIGATION], ['previousCrop', OPTIONS.crops.map(c => c.id)], ['currentCrop', OPTIONS.crops.map(c => c.id)], ['nextSeason', SEASONS]]) {
    const value = typeof input[key] === 'string' ? input[key].trim().toLowerCase() : '';
    if (!values.includes(value)) fail(key, `Invalid ${key}`); else data[key] = value;
  }
  const date = input.plantingDate;
  const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date(NaN);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today) fail('plantingDate', 'Choose a real planting date today or later (India time)');
  else data.plantingDate = date;
  return { valid: !errors.length, data: errors.length ? null : data, errors };
}
module.exports = { validateFarmerLand, OPTIONS, CROPS };
