
'use strict';

const NASA_POWER_ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const PARAMETERS = ['T2M', 'PRECTOTCORR', 'RH2M'];
const DAY = 86400000;
const powerDate = date => date.toISOString().slice(0, 10).replaceAll('-', '');

function parsePowerDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) throw new Error('Date must be YYYYMMDD');
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || powerDate(date) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return date;
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

// Production shares one cache. A factory lets tests isolate caches and the clock.
function createNASAService({ fetchImpl = (...args) => fetch(...args), now = () => new Date(), maxEntries = 20, ttlMs = 3600000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function getNASAClimate(latitude, longitude, options = {}) {
    if (!validCoordinates(latitude, longitude)) throw new Error('Invalid coordinates');
    const today = powerDate(now()); // UTC request cutoff; daily observations use LST.
    const cap = today < '20261231' ? today : '20261231';
    const start = options.start ?? '20230101';
    const requestedEnd = options.end ?? cap;
    parsePowerDate(start);
    parsePowerDate(requestedEnd);
    const end = requestedEnd > cap ? cap : requestedEnd;
    if (start < '20230101' || start > end) throw new Error('Date range must fall within 2023–2026 and not start in the future');
    const key = JSON.stringify([latitude, longitude, start, end]);
    const hit = cache.get(key);
    if (hit && hit.expires > now().getTime()) return hit.value;
    cache.delete(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 5) throw new Error('NASA requests are busy. Please retry shortly.');
    const job = (async () => {
      async function requestRange(rangeStart, rangeEnd, timeoutMs = 60000) {
      const query = new URLSearchParams({ parameters: PARAMETERS.join(','), community: 'AG', latitude: String(latitude), longitude: String(longitude), start: rangeStart, end: rangeEnd, format: 'JSON', 'time-standard': 'LST' });
      const response = await fetchImpl(`${NASA_POWER_ENDPOINT}?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const error = new Error(`NASA POWER HTTP ${response.status}${response.status === 422 ? ': requested dates may not yet be published; retry later' : ''}`);
        error.upstreamStatus = response.status;
        throw error; // Do not guess dates or retry rejected requests.
      }
      let data;
      try { data = await response.json(); } catch (error) {
        if (['TimeoutError', 'AbortError'].includes(error.name)) throw error;
        throw new Error('NASA POWER returned invalid JSON');
      }
      const parameters = data?.properties?.parameter;
      if (!parameters || PARAMETERS.some(name => !parameters[name] || typeof parameters[name] !== 'object' || Array.isArray(parameters[name]))) throw new Error('NASA POWER response is missing required daily parameters');
      for (const name of PARAMETERS) {
        for (const date of Object.keys(parameters[name])) {
          parsePowerDate(date);
          if (date < rangeStart || date > rangeEnd) throw new Error('NASA returned observations outside the requested period');
        }
      }
      return data;
      }
      let data;
      try { data = await requestRange(start, end); }
      catch (error) {
        const timeout = ['TimeoutError', 'AbortError'].includes(error.name) || ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'].includes(error.cause?.code);
        if (!timeout || start.slice(0, 4) === end.slice(0, 4)) throw error;
        // One bounded recovery pass: smaller nonoverlapping requests, sequentially.
        // Never shorten the requested history or cache partial recovery results.
        const merged = Object.fromEntries(PARAMETERS.map(name => [name, {}]));
        for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
          const chunk = await requestRange(start > `${year}0101` ? start : `${year}0101`, end < `${year}1231` ? end : `${year}1231`, 30000);
          if (data && (JSON.stringify(data.parameters) !== JSON.stringify(chunk.parameters) || data.header?.fill_value !== chunk.header?.fill_value)) throw new Error('NASA returned inconsistent metadata between historical requests');
          data = chunk;
          for (const name of PARAMETERS) Object.assign(merged[name], chunk.properties.parameter[name]);
        }
        data = { ...data, properties: { ...data.properties, parameter: merged } };
      }
      const parameters = data.properties.parameter;
      const result = { source: 'NASA POWER', coordinates: { latitude, longitude }, requestedPeriod: { start, end }, parameters, metadata: { header: data.header ?? null, geometry: data.geometry ?? null, definitions: data.parameters ?? null, timeStandard: 'LST' } };
      require('./climateAnalysis').analyzeClimate(result); // Cache only usable, validated data.
      cache.set(key, { value: result, expires: now().getTime() + ttlMs });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return result;
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  return { getNASAClimate };
}

const { getNASAClimate } = createNASAService();
module.exports = { getNASAClimate, createNASAService, validCoordinates, powerDate, parsePowerDate, PARAMETERS, DAY };
