'use strict';

const { parsePowerDate, powerDate, PARAMETERS, DAY } = require('./nasaPowerService');
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const sum = values => values.length ? values.reduce((a, b) => a + b, 0) : null;
const round = value => value === null || !Number.isFinite(value) ? null : Number(value.toFixed(2));
const iso = date => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
const UNITS = { temperature: '°C', rainfall: 'mm', humidity: '%' };

function analyzeClimate(nasaData) {
  const { start, end } = nasaData.requestedPeriod;
  const first = parsePowerDate(start), last = parsePowerDate(end);
  if (first > last) throw new Error('Invalid analysis date range');
  const parameters = nasaData.parameters;
  const definitions = nasaData.metadata?.definitions;
  // Daily mm/day rates integrated over one day produce rainfall totals in mm.
  const acceptedUnits = { T2M: ['c', '°c', 'degc'], PRECTOTCORR: ['mm/day', 'mm'], RH2M: ['%'] };
  for (const name of PARAMETERS) {
    if (!parameters?.[name] || typeof parameters[name] !== 'object' || Array.isArray(parameters[name])) throw new Error(`Missing parameter: ${name}`);
    if (definitions?.[name]?.units && !acceptedUnits[name].includes(definitions[name].units.toLowerCase())) throw new Error(`Unexpected NASA units for ${name}: ${definitions[name].units}`);
    for (const date of Object.keys(parameters[name])) {
      parsePowerDate(date);
      if (date < start || date > end) throw new Error('Daily date outside analysis period');
    }
  }
  function value(name, date) {
    const number = parameters[name][date];
    const fill = [nasaData.metadata?.header?.fill_value, definitions?.[name]?.fill_value, -999];
    if (typeof number !== 'number' || !Number.isFinite(number) || fill.some(item => item !== undefined && item !== null && Number(item) === number)) return null;
    if (name === 'PRECTOTCORR' && number < 0) return null;
    if (name === 'RH2M' && (number < 0 || number > 100)) return null;
    return number;
  }
  const dates = [];
  for (let time = first.getTime(); time <= last.getTime(); time += DAY) dates.push(powerDate(new Date(time)));
  function aggregate(keys) {
    const coverage = {}, values = {};
    for (const name of PARAMETERS) {
      values[name] = keys.map(date => value(name, date)).filter(number => number !== null);
      coverage[name] = { expected: keys.length, valid: values[name].length, missing: keys.length - values[name].length, complete: keys.length > 0 && values[name].length === keys.length };
    }
    return { meanTemperatureC: round(mean(values.T2M)), rainfallObservedMm: round(sum(values.PRECTOTCORR)), meanHumidityPercent: round(mean(values.RH2M)), coverage };
  }
  const overall = aggregate(dates);
  const lastByParameter = Object.fromEntries(PARAMETERS.map(name => [name, dates.filter(date => value(name, date) !== null).at(-1) ?? null]));
  const available = Object.values(lastByParameter).filter(Boolean).sort();
  if (!available.length) throw new Error('NASA returned no valid observations for this period');
  const monthly = [], yearly = [];
  for (let year = 2023; year <= 2026; year++) {
    const yearKeys = dates.filter(date => date.startsWith(String(year)));
    if (!yearKeys.length) continue;
    const calendarDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY;
    const stats = aggregate(yearKeys);
    const fullYearRequested = yearKeys.length === calendarDays;
    const complete = fullYearRequested && stats.coverage.PRECTOTCORR.complete;
    yearly.push({ year, ...stats, units: UNITS, calendarDays, fullYearRequested, complete, annualRainfallMm: complete ? stats.rainfallObservedMm : null });
    for (let month = 1; month <= 12; month++) {
      const prefix = `${year}${String(month).padStart(2, '0')}`;
      const keys = yearKeys.filter(date => date.startsWith(prefix));
      if (!keys.length) continue;
      const stats = aggregate(keys);
      const calendarDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const complete = keys.length === calendarDays && stats.coverage.PRECTOTCORR.complete;
      monthly.push({ year, month, ...stats, units: UNITS, calendarDays, complete, rainfallTotalMm: complete ? stats.rainfallObservedMm : null });
    }
  }
  // Three-year historical climatology; not a 30-year climate normal.
  const monthlyRainfallClimatology = Array.from({ length: 12 }, (_, index) => {
    const totals = monthly.filter(item => item.month === index + 1 && item.year < 2026 && item.complete).map(item => item.rainfallTotalMm);
    return { month: index + 1, meanRainfallMm: round(mean(totals)), completeYearCount: totals.length, units: 'mm' };
  });
  const currentLast = dates.filter(date => date.startsWith('2026') && value('PRECTOTCORR', date) !== null).at(-1);
  const comparisons = [];
  if (currentLast) {
    for (let year = 2023; year <= 2026; year++) {
      const month = Number(currentLast.slice(4, 6));
      const day = Math.min(Number(currentLast.slice(6)), new Date(Date.UTC(year, month, 0)).getUTCDate());
      const until = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
      const keys = [];
      for (let time = Date.UTC(year, 0, 1); time <= parsePowerDate(until).getTime(); time += DAY) keys.push(powerDate(new Date(time)));
      const stats = aggregate(keys);
      comparisons.push({ year, start: `${year}0101`, end: until, rainfallObservedMm: stats.rainfallObservedMm, rainfallMm: stats.coverage.PRECTOTCORR.complete ? stats.rainfallObservedMm : null, coverage: stats.coverage.PRECTOTCORR, units: 'mm' });
    }
  }
  const current = comparisons.find(item => item.year === 2026);
  const warnings = [];
  if (PARAMETERS.some(name => overall.coverage[name].missing)) warnings.push('Missing observations are excluded, never replaced with zero. Observed rainfall sums may be incomplete.');
  if (yearly.some(item => !item.complete)) warnings.push('Incomplete years are excluded from mean annual rainfall. 2026 is shown separately as year-to-date.');
  if (PARAMETERS.some(name => !lastByParameter[name] || lastByParameter[name] < end)) warnings.push('Requested dates extend beyond some available observations; NASA publication delays or missing data may apply.');
  warnings.push('Karnataka-focused prototype; exact state boundaries are not enforced. POWER provides gridded estimates, not on-farm sensor measurements.');
  return {
    summary: { meanTemperatureC: overall.meanTemperatureC, meanHumidityPercent: overall.meanHumidityPercent, meanAnnualRainfallMm: round(mean(yearly.filter(item => item.year < 2026 && item.complete).map(item => item.annualRainfallMm))), completeRainfallYears: yearly.filter(item => item.year < 2026 && item.complete).map(item => item.year), units: UNITS },
    monthly, yearly, monthlyRainfallClimatology,
    currentYear: { year: 2026, partial: !yearly.find(item => item.year === 2026)?.complete, through: currentLast ? iso(currentLast) : null, rainfallYtdMm: current?.rainfallMm ?? null, rainfallObservedMm: current?.rainfallObservedMm ?? null, coverage: current?.coverage ?? null, equivalentPeriodComparisons: comparisons },
    dataQuality: { coverage: overall.coverage, requestedPeriod: { start, end }, firstAvailableDate: iso(dates.find(date => PARAMETERS.some(name => value(name, date) !== null))), lastAvailableDate: iso(available.at(-1)), lastAvailableByParameter: Object.fromEntries(PARAMETERS.map(name => [name, lastByParameter[name] ? iso(lastByParameter[name]) : null])), warnings }
  };
}

module.exports = { analyzeClimate };
