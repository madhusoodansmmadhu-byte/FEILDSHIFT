'use strict';
const { parsePowerDate, powerDate, DAY, PARAMETERS } = require('./nasaPowerService');

// Historical analogue windows use the planting month/day, never future weather.
function analyzeGrowingSeasons(nasaData, farmer, durationDays) {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 730) return { status: 'unavailable', windows: [], warnings: ['A verified growing duration is unavailable.'] };
  const windows = [], warnings = [];
  const monthDay = farmer.plantingDate.slice(5);
  const period = nasaData.requestedPeriod;
  for (let year = 2023; year <= 2026; year++) {
    const dateText = `${year}-${monthDay}`;
    const date = new Date(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) continue;
    const start = powerDate(date), end = powerDate(new Date(date.getTime() + (durationDays - 1) * DAY));
    if (start < period.start || end > period.end || end >= farmer.plantingDate.replaceAll('-', '')) continue;
    const series = Object.fromEntries(PARAMETERS.map(p => [p, []]));
    for (let i = 0; i < durationDays; i++) {
      const key = powerDate(new Date(date.getTime() + i * DAY));
      parsePowerDate(key);
      for (const p of PARAMETERS) {
        const value = nasaData.parameters?.[p]?.[key];
        const fills = [-999, nasaData.metadata?.header?.fill_value, nasaData.metadata?.definitions?.[p]?.fill_value];
        const units = nasaData.metadata?.definitions?.[p]?.units;
        const accepted = { T2M: ['c', '°c', 'degc'], PRECTOTCORR: ['mm/day', 'mm'], RH2M: ['%'] };
        if (units && !accepted[p].includes(units.toLowerCase())) throw new Error('Unsupported observation units');
        if (typeof value !== 'number' || !Number.isFinite(value) || fills.some(f => f !== null && f !== undefined && Number(f) === value) || (p === 'PRECTOTCORR' && value < 0) || (p === 'RH2M' && (value < 0 || value > 100))) continue;
        series[p].push(value);
      }
    }
    const coverage = Object.fromEntries(PARAMETERS.map(p => [p, { expected: durationDays, valid: series[p].length, missing: durationDays - series[p].length, complete: series[p].length === durationDays }]));
    const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    windows.push({ year, start, end, season: farmer.nextSeason, meanTemperatureC: mean(series.T2M), meanHumidityPercent: mean(series.RH2M), rainfallTotalMm: coverage.PRECTOTCORR.complete ? series.PRECTOTCORR.reduce((a, b) => a + b, 0) : null, coverage });
  }
  const complete = windows.filter(w => PARAMETERS.every(p => w.coverage[p].complete));
  if (complete.length < 2) warnings.push('Fewer than two complete historical growing windows are available.');
  if (windows.some(w => PARAMETERS.some(p => !w.coverage[p].complete))) warnings.push('Incomplete historical windows were excluded; missing rainfall was not replaced with zero.');
  return { status: complete.length ? complete.length < 2 ? 'limited' : 'available' : 'unavailable', windows, complete, warnings };
}
module.exports = { analyzeGrowingSeasons };
