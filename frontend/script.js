'use strict';
const $ = id => document.getElementById(id);
const map = L.map('map').setView([14.27, 75.36], 9);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
let marker = null;
let method = 'gps';
let selected = null;
let selectionVersion = 0;
let confirmationPending = false;
let gpsRequest = 0;
let accuracyCircle = null;
let climateController = null;
let confirmedClimateLocation = null;
const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
};
function ensureMarker(latitude, longitude) {
  if (marker) return;
  marker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
  marker.on('dragend', () => {
    const p = marker.getLatLng();
    updateSelection(p.lat, p.lng, selected?.method || method);
    status('Pin moved. Confirm when it marks your actual field.');
  });
}
function placePin(latitude, longitude, zoom = 16, source = method) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  ensureMarker(latitude, longitude);
  marker.setLatLng([latitude, longitude]);
  map.setView([latitude, longitude], zoom);
  updateSelection(latitude, longitude, source);
  status('Location found. Drag the pin or tap the map to mark your farm.');
}
function updateSelection(latitude, longitude, source = method) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return;
  if (!Number.isFinite(longitude)) return;
  if (longitude < -180 || longitude > 180) longitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  marker.setLatLng([latitude, longitude]);
  selected = { latitude, longitude, method: source };
  selectionVersion++;
  if (climateController) climateController.abort();
  confirmedClimateLocation = null;
  $('climatePanel').classList.add('hidden');
  $('climateResults').classList.add('hidden');
  if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
  $('coordinates').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  $('confirmButton').disabled = confirmationPending;
  $('confirmedPanel').classList.add('hidden');
}
map.on('click', e => {
  ensureMarker(e.latlng.lat, e.latlng.lng);
  marker.setLatLng(e.latlng);
  updateSelection(e.latlng.lat, e.latlng.lng, selected?.method || method);
  status('Pin placed. Confirm when it marks your actual field.');
});
function selectMethod(next) {
  method = next;
  $('gpsMethod').classList.toggle('active', next === 'gps');
  $('searchMethod').classList.toggle('active', next === 'village');
  $('gpsMethod').setAttribute('aria-pressed', String(next === 'gps'));
  $('searchMethod').setAttribute('aria-pressed', String(next === 'village'));
  $('gpsPanel').classList.toggle('hidden', next !== 'gps');
  $('searchPanel').classList.toggle('hidden', next !== 'village');
  gpsRequest++;
  $('gpsButton').disabled = false;
}
$('gpsMethod').addEventListener('click', () => selectMethod('gps'));
$('searchMethod').addEventListener('click', () => selectMethod('village'));
$('gpsButton').addEventListener('click', () => {
  if ($('gpsButton').disabled) return;
  if (!window.isSecureContext) return status('Location needs HTTPS or localhost. Open this page in Chrome at http://localhost:3001.', true);
  if (!navigator.geolocation) return status('This browser does not support location detection. Try village search.', true);
  status('Requesting your device location. Please allow permission if prompted.');
  $('gpsButton').disabled = true;
  const request = ++gpsRequest;
  const version = selectionVersion;
  const detect = highAccuracy => navigator.geolocation.getCurrentPosition(
    position => {
      if (request !== gpsRequest) return;
      $('gpsButton').disabled = false;
      if (version !== selectionVersion) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return status('Device returned invalid coordinates. Use village search.', true);
      placePin(latitude, longitude, 16, 'gps');
      const hasAccuracy = Number.isFinite(accuracy) && accuracy >= 0;
      if (hasAccuracy) accuracyCircle = L.circle([latitude, longitude], { radius: accuracy, weight: 1 }).addTo(map);
      const age = Number.isFinite(position.timestamp) ? Math.max(0, Math.round((Date.now() - position.timestamp) / 1000)) : null;
      status(`Approximate device position${hasAccuracy ? `: accuracy radius ${Math.round(accuracy)} metres` : ': accuracy unavailable'}${age !== null ? `; fix age ${age} seconds` : ''}. ${hasAccuracy && accuracy > 100 ? 'This is a broad estimate. ' : ''}Move the pin to your actual field and confirm. The accuracy circle applies only to the original device fix.`);
    },
    error => {
      if (request !== gpsRequest) return;
      if (version !== selectionVersion) { $('gpsButton').disabled = false; return; }
      if (error.code === 3 && highAccuracy) {
        status('High-accuracy positioning timed out. Trying an approximate device position…');
        detect(false);
        return;
      }
      $('gpsButton').disabled = false;
      const messages = {
        1: 'Location permission denied. Allow location in Chrome site settings and Windows Location settings, or use village search.',
        2: 'Device position unavailable. Check Windows Location settings and your connection, or use village search.',
        3: 'Both location attempts timed out. A laptop may not have GPS hardware. Try Chrome, village search, or tap the map.'
      };
      status(messages[error.code] || 'Device location failed. Use village search or tap the map.', true);
    },
    { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 15000 : 20000, maximumAge: 0 }
  );
  detect(true);
});
$('searchPanel').addEventListener('submit', async event => {
  event.preventDefault();
  const q = $('placeInput').value.trim();
  if (q.length < 3) return status('Enter at least 3 characters.', true);
  const results = $('results');
  results.replaceChildren();
  status('Searching for the village…');
  const button = $('searchPanel').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const places = await response.json();
    if (!response.ok) throw new Error(places.error || 'Search failed');
    if (!Array.isArray(places)) throw new Error('Search returned an unexpected response. Retry later.');
    if (!places.length) return status('No matching places found. Add district and state to your search.');
    for (const place of places) {
      const result = document.createElement('button');
      result.type = 'button';
      result.className = 'result';
      result.textContent = place.name;
      result.addEventListener('click', () => {
        gpsRequest++;
        $('gpsButton').disabled = false;
        placePin(place.latitude, place.longitude, 15, 'village');
        results.replaceChildren();
      });
      results.appendChild(result);
    }
    status('Choose the correct place from the results, then adjust the map pin.');
  } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
});
$('confirmButton').addEventListener('click', async () => {
  if (!selected || confirmationPending) return;
  const version = selectionVersion;
  const submitted = { ...selected };
  confirmationPending = true;
  $('confirmButton').disabled = true;
  status('Confirming selected coordinates…');
  try {
    const response = await fetch('/api/farm-location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitted)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Confirmation failed');
    if (version !== selectionVersion) return status('Location changed during confirmation. Confirm the new pin position.');
    $('confirmedText').textContent = `Latitude: ${data.latitude.toFixed(6)} | Longitude: ${data.longitude.toFixed(6)}`;
    $('confirmedJson').textContent = JSON.stringify(data, null, 2);
    $('confirmedPanel').classList.remove('hidden');
    status('Farm coordinates confirmed successfully.');
    $('confirmedPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    confirmedClimateLocation = { latitude: data.latitude, longitude: data.longitude, version };
    await loadClimate(data.latitude, data.longitude, version);
  } catch (error) { status(error.message, true); }
  finally { confirmationPending = false; $('confirmButton').disabled = !selected; }
});

async function loadClimate(latitude, longitude, version) {
  if (version !== selectionVersion) return;
  if (climateController) climateController.abort();
  const controller = new AbortController();
  climateController = controller;
  $('climatePanel').classList.remove('hidden');
  $('climateResults').classList.add('hidden');
  $('climateLoading').classList.remove('hidden');
  $('climateError').classList.add('hidden');
  $('retryClimate').classList.add('hidden');
  try {
    const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    const response = await fetch(`/api/climate?${params}`, { signal: controller.signal });
    let data;
    try { data = await response.json(); } catch { throw new Error('Climate server returned invalid JSON. Please retry.'); }
    if (!response.ok || !data.success) throw new Error(data.error || 'Climate request failed. Please retry.');
    if (controller.signal.aborted || controller !== climateController || version !== selectionVersion) return;
    if (data.coordinates?.latitude !== latitude || data.coordinates?.longitude !== longitude) throw new Error('Climate coordinates do not match the confirmed farm. Please retry.');
    renderClimateDashboard(data);
  } catch (error) {
    if (controller.signal.aborted || controller !== climateController || version !== selectionVersion) return;
    $('climateError').textContent = `${error.message || 'Network connection failed.'} Your farm location remains confirmed.`;
    $('climateError').classList.remove('hidden');
    $('retryClimate').classList.remove('hidden');
  } finally {
    if (controller === climateController && version === selectionVersion) $('climateLoading').classList.add('hidden');
  }
}

$('retryClimate').addEventListener('click', () => {
  if (confirmedClimateLocation) {
    const { latitude, longitude, version } = confirmedClimateLocation;
    return loadClimate(latitude, longitude, version);
  }
});

function renderClimateDashboard(data) {
  const climate = data.climate;
  if (!climate?.summary || !Array.isArray(climate.monthly) || !Array.isArray(climate.yearly) || !climate.dataQuality) throw new Error('Climate response is incomplete. Please retry.');
  const format = (number, units) => typeof number === 'number' && Number.isFinite(number) ? `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units}` : 'Data unavailable';
  const date = value => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  $('climateTemperature').textContent = format(climate.summary.meanTemperatureC, '°C');
  $('climateRainfall').textContent = format(climate.summary.meanAnnualRainfallMm, 'mm/year');
  $('climateHumidity').textContent = format(climate.summary.meanHumidityPercent, '%');
  $('climatePeriod').textContent = `Requested: ${date(data.period.start)} to ${date(data.period.end)}. Daily time standard: LST. Complete rainfall years used: ${climate.summary.completeRainfallYears.join(', ') || 'none'}.`;

  // Native CSS bars with exact text labels, including negative temperatures.
  function chart(id, rows, units) {
    const container = $(id);
    container.replaceChildren();
    const max = Math.max(1, ...rows.map(row => typeof row.value === 'number' ? Math.abs(row.value) : 0));
    for (const row of rows) {
      const entry = document.createElement('div');
      entry.className = 'climate-chart-row';
      const label = document.createElement('span');
      label.textContent = `${row.label}: ${format(row.value, units)}${row.note ? ` — ${row.note}` : ''}`;
      const bar = document.createElement('div');
      bar.className = 'climate-bar';
      bar.setAttribute('aria-hidden', 'true');
      bar.style.width = `${typeof row.value === 'number' ? Math.abs(row.value) / max * 100 : 0}%`;
      if (row.value < 0) bar.classList.add('negative');
      entry.append(label, bar);
      container.appendChild(entry);
    }
  }
  chart('monthlyRainfallChart', climate.monthly.map(item => ({ label: `${item.year}-${String(item.month).padStart(2, '0')}`, value: item.rainfallObservedMm, note: item.complete ? 'complete month' : 'incomplete observed sum' })), 'mm');
  chart('monthlyTemperatureChart', climate.monthly.map(item => ({ label: `${item.year}-${String(item.month).padStart(2, '0')}`, value: item.meanTemperatureC, note: `${item.coverage.T2M.valid}/${item.coverage.T2M.expected} days` })), '°C');
  chart('annualRainfallChart', climate.yearly.map(item => ({ label: String(item.year), value: item.rainfallObservedMm, note: item.complete ? 'complete year' : 'partial/incomplete observed sum' })), 'mm');
  chart('rainfallClimatologyChart', climate.monthlyRainfallClimatology.map(item => ({ label: `Month ${item.month}`, value: item.meanRainfallMm, note: `${item.completeYearCount} complete historical months` })), 'mm');
  chart('equivalentRainfallChart', climate.currentYear.equivalentPeriodComparisons.map(item => ({ label: `${item.year}: through ${date(item.end)}`, value: item.rainfallMm, note: `${item.coverage.valid}/${item.coverage.expected} days${item.coverage.complete ? '' : '; incomplete, not comparable'}` })), 'mm');
  const current = climate.currentYear;
  $('climateYtd').textContent = `2026 ${current.partial ? '(partial year)' : ''}: ${format(current.rainfallYtdMm, 'mm')} through ${current.through || 'unavailable'}. Observed sum: ${format(current.rainfallObservedMm, 'mm')}; gaps are not counted as zero.`;
  $('climateCoverage').replaceChildren();
  for (const [parameter, coverage] of Object.entries(climate.dataQuality.coverage)) {
    const line = document.createElement('p');
    line.textContent = `${parameter}: ${coverage.valid} valid, ${coverage.missing} missing of ${coverage.expected} requested days. Last valid: ${climate.dataQuality.lastAvailableByParameter[parameter] || 'unavailable'}.`;
    $('climateCoverage').appendChild(line);
  }
  $('climateDataQuality').textContent = `Available observations: ${climate.dataQuality.firstAvailableDate} to ${climate.dataQuality.lastAvailableDate}. ${climate.dataQuality.warnings.join(' ')}`;
  $('climateResults').classList.remove('hidden');
}

// Recalculate only when the map's actual container dimensions change.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
}
