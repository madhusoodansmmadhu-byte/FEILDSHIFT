'use strict';
const { CROPS } = require('./farmerInputValidator');
const { analyzeGrowingSeasons } = require('./growingSeasonAnalysis');
const RAGI_SOURCE = 'https://agritech.tnau.ac.in/ta/expert_system/ragi/faqs.html';
const DURATION_SOURCE = 'https://www.fao.org/4/s2022e/s2022e07.htm';
const ROTATION_SOURCE = 'https://www.fao.org/4/a0218e/A0218E16.htm';
const FAMILIES = { paddy: 'Poaceae', maize: 'Poaceae', ragi: 'Poaceae', jowar: 'Poaceae', bajra: 'Poaceae', wheat: 'Poaceae', groundnut: 'Fabaceae', chickpea: 'Fabaceae', 'green-gram': 'Fabaceae', 'black-gram': 'Fabaceae', 'pigeon-pea': 'Fabaceae', soybean: 'Fabaceae', sunflower: 'Asteraceae', sesame: 'Pedaliaceae', mustard: 'Brassicaceae', cotton: 'Malvaceae', sugarcane: 'Poaceae', potato: 'Solanaceae', onion: 'Amaryllidaceae', tomato: 'Solanaceae' };
// Unknown is deliberate: water demand is not interchangeable with seasonal rainfall.
// Profiles must remain unassessable until crop-specific evidence is verified.
const PROFILES = CROPS.map(crop => ({ ...crop, family: FAMILIES[crop.id], seasons: null, temperatureC: null, seasonalPrecipitationMm: null, humidityPercent: null, soils: null, irrigation: null, durationDays: null, rotation: 'Avoid continuous same-crop cultivation; family history is a prototype risk indicator, not a disease diagnosis.', evidence: [] }));
Object.assign(PROFILES.find(c => c.id === 'ragi'), {
  seasons: ['kharif', 'rabi', 'summer'], temperatureC: [25, 32], seasonalPrecipitationMm: [450, 500], durationDays: 100,
  // TNAU describes irrigated and rainfed ragi; it does not quantify the user's water supply.
  irrigation: 'rainfed-or-irrigated', evidence: [{ url: RAGI_SOURCE, supports: 'Growing temperature; rainfed rainfall; all-season cultivation with moisture; 100-day example varieties. Duration is a reference variety, not universal.' }]
});
Object.assign(PROFILES.find(c => c.id === 'maize'), {
  temperatureC: [24, 24], seasonalPrecipitationMm: [500, 750], durationDays: 125,
  irrigation: 'moderate-to-high',
  evidence: [{ url: 'https://www.bamis.gov.bd/en/crops/view/8/', supports: 'Mean temperature around 24 C; rainfall 50–75 cm; excess-water sensitivity. Season suitability in Karnataka is unverified.' }, { url: DURATION_SOURCE, supports: 'Grain maize indicative duration 125–180 days; lower duration used as a reference, not a cultivar prediction.' }]
});
Object.assign(PROFILES.find(c => c.id === 'groundnut'), {
  seasons: ['kharif', 'rabi', 'summer'], temperatureC: [24, 34], seasonalPrecipitationMm: [500, 700], durationDays: 130,
  irrigation: 'moisture-at-pegging',
  evidence: [{ url: 'https://www.bamis.gov.bd/en/thresholds/1/all/34/', supports: 'Warm growing conditions, adequate crop rainfall and dry maturity; stage-specific moisture needs.' }, { url: DURATION_SOURCE, supports: 'Indicative duration 130–140 days; lower duration used as reference.' }, { url: 'https://agritech.tnau.ac.in/pdf/AGRICULTURE.pdf#page=192', supports: 'Groundnut grown in all three seasons.' }]
});
Object.assign(PROFILES.find(c => c.id === 'jowar'), {
  temperatureC: [30, 30], seasonalPrecipitationMm: [250, 400], durationDays: 120,
  seasons: ['kharif', 'rabi', 'summer'], irrigation: 'rainfed-or-irrigated',
  evidence: [{ url: 'https://keralaagriculture.gov.in/wp-content/uploads/2021/04/pop2016.pdf', supports: 'Sorghum reference optimum temperature, rainfall and rainfed/irrigated seasons; regional guidance needs local confirmation.' }, { url: DURATION_SOURCE, supports: 'Sorghum indicative duration 120–130 days; lower duration is a reference.' }]
});
Object.assign(PROFILES.find(c => c.id === 'ragi'), { soils: ['red', 'loamy', 'laterite'], soilCaution: 'Soil labels are broad: drainage, texture, fertility and variety still need local confirmation.' });
PROFILES.find(c => c.id === 'ragi').evidence.push({ url: 'https://www.agritech.tnau.ac.in/expert_system/ragi/cultivationpractices.html', supports: 'Well-drained loams, red and lateritic soils; black soil suitability depends on drainage. Sand alone is not sandy loam.' });
// Record verified partial facts without treating climate-table rainfall as proven seasonal requirements.
const durations = { paddy: 90, jowar: 120, bajra: 105, wheat: 120, soybean: 135, sunflower: 125, cotton: 180, sugarcane: 270, potato: 105, onion: 150, tomato: 135 };
for (const profile of PROFILES) {
  profile.evidence.push({ url: ROTATION_SOURCE, supports: 'General family rotation principle only; numerical rotation penalties are prototype policy.' });
  if (durations[profile.id]) { profile.durationDays = durations[profile.id]; profile.evidence.push({ url: DURATION_SOURCE, supports: 'Lower end of indicative growing-period range used as reference; variety and local conditions matter.' }); }
}
const POLICY = { unknownScore: 5, sameCrop: 2, sameFamily: 4, differentFamily: 8, preferredScore: 9, minimumScore: 1 };
function rangeScore(value, range) {
  if (!Number.isFinite(value) || !range) return null;
  const [low, high] = range;
  const distance = value < low ? low - value : value > high ? value - high : 0;
  return Math.max(1, 9 - 8 * distance / Math.max(high - low, Math.abs(low) * 0.25, 1));
}
const weightedClimate = components => {
  const weights = { temperature: 0.40, precipitation: 0.45, humidity: 0.15 };
  const available = Object.keys(weights).filter(k => components[k] !== null && Number.isFinite(components[k]));
  return available.length ? available.reduce((sum, k) => sum + components[k] * weights[k], 0) / available.reduce((sum, k) => sum + weights[k], 0) : null;
};
const finalScore = scores => .40 * scores.climate + .25 * scores.soil + .20 * scores.irrigation + .15 * scores.rotation;
const round = value => value === null ? null : Number(value.toFixed(2));
function evaluateCrops(farmer, nasaData) {
  const evaluations = PROFILES.map(profile => {
    const warnings = [], reasons = [];
    const result = { cropId: profile.id, cropName: profile.name, rank: null, eligibility: 'unassessable', scores: { climate: null, soil: null, irrigation: null, rotation: null, final: null }, reasons, warnings, evidence: profile.evidence };
    if (profile.seasons && !profile.seasons.includes(farmer.nextSeason)) { result.eligibility = 'excluded'; reasons.push('The selected season is outside the verified profile.'); return result; }
    if (!profile.durationDays || !profile.temperatureC || !profile.seasonalPrecipitationMm) { warnings.push('Verified crop-specific growing duration and seasonal climate evidence are not yet available. No suitability score was invented.'); return result; }
    if (!profile.seasons) warnings.push('Local season suitability is not verified; the planting date defines the historical window.');
    const history = analyzeGrowingSeasons(nasaData, farmer, profile.durationDays);
    warnings.push(...history.warnings);
    if (!history.complete?.length) { warnings.push('No complete historical growing window is available.'); return result; }
    const mean = field => history.complete.reduce((sum, w) => sum + w[field], 0) / history.complete.length;
    if (profile.id === 'maize' && farmer.nextSeason === 'summer' && mean('meanTemperatureC') < 19) {
      result.eligibility = 'excluded';
      reasons.push('Historical summer growing windows are below the documented maize growing temperature limit.');
      warnings.push('This exclusion uses historical seasonal means, not a future weather prediction.');
      return result;
    }
    const climate = weightedClimate({ temperature: rangeScore(mean('meanTemperatureC'), profile.temperatureC), precipitation: rangeScore(mean('rainfallTotalMm'), profile.seasonalPrecipitationMm), humidity: profile.humidityPercent ? rangeScore(mean('meanHumidityPercent'), profile.humidityPercent) : null });
    if (!profile.humidityPercent) warnings.push('Humidity requirements are unverified; verified climate weights were normalized.');
    // Missing secondary information gets a neutral, explicitly provisional policy score, never a perfect score.
    const soilVerified = profile.soils?.includes(farmer.soilType);
    const soil = soilVerified ? 9 : POLICY.unknownScore;
    const irrigationPolicy = profile.irrigation === 'moderate-to-high' ? { limited: 3, moderate: 6, sufficient: 8, unknown: 5 } : { limited: 5, moderate: 7, sufficient: 8, unknown: 5 };
    const irrigation = irrigationPolicy[farmer.irrigationAvailability];
    const historyCrops = [farmer.currentCrop, farmer.previousCrop];
    const rotation = historyCrops.includes(profile.id) ? POLICY.sameCrop : historyCrops.some(id => FAMILIES[id] === profile.family) ? POLICY.sameFamily : historyCrops.some(id => !FAMILIES[id]) ? POLICY.unknownScore : POLICY.differentFamily;
    const scores = { climate, soil, irrigation, rotation };
    result._raw = finalScore(scores);
    result.scores = Object.fromEntries(Object.entries({ ...scores, final: result._raw }).map(([key, value]) => [key, round(value)]));
    result.eligibility = 'eligible-limited';
    reasons.push('Compared with complete historical growing windows for your planting time.', rotation <= 4 ? 'Recent crop history suggests a rotation concern.' : 'Recent crop history has no same-family flag.');
    if (!soilVerified) warnings.push('This soil compatibility is unverified; a neutral provisional soil score is used.');
    else reasons.push('Your soil category is represented in the crop guidance; confirm drainage locally.');
    warnings.push('Prototype scoring weights and penalties are engineering policy, not field-validated agronomic thresholds.', 'Irrigation categories do not measure available water volume.', 'A reference growing duration may differ from your variety.', 'Historical rainfall does not account for effective rainfall, drainage or irrigation supply.', 'Growth-stage heat, flooding and harvest-rain risks are not resolved by seasonal means.');
    return result;
  });
  evaluations.sort((a, b) => (b._raw ?? -Infinity) - (a._raw ?? -Infinity) || a.cropName.localeCompare(b.cropName));
  let rank = 0;
  for (const result of evaluations) { if (result._raw !== undefined) result.rank = ++rank; delete result._raw; }
  return { evaluations, topRecommendations: evaluations.filter(c => c.rank !== null).slice(0, 3), warnings: ['These are prototype crop suitability estimates based on historical climate information and your land details. They do not guarantee crop yield.', 'Historical climate is not a future weather forecast.', 'Fewer than three recommendations may be available when evidence or observations are insufficient.', 'The historical source is limited to available observations from 2023–2026.'] };
}
module.exports = { PROFILES, POLICY, rangeScore, weightedClimate, finalScore, evaluateCrops };
