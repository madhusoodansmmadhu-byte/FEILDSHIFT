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
const status = (message, error = false) => {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
};
function placePin(latitude, longitude, zoom = 16) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  if (!marker) {
    marker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      updateSelection(p.lat, p.lng);
      status('Pin moved. Confirm when it marks your actual field.');
    });
  } else marker.setLatLng([latitude, longitude]);
  map.setView([latitude, longitude], zoom);
  updateSelection(latitude, longitude);
  status('Location found. Drag the pin or tap the map to mark your farm.');
}
function updateSelection(latitude, longitude) {
  selected = { latitude, longitude, method };
  $('coordinates').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  $('confirmButton').disabled = false;
  $('confirmedPanel').classList.add('hidden');
}
map.on('click', e => {
  if (!marker) marker = L.marker(e.latlng, { draggable: true }).addTo(map);
  marker.setLatLng(e.latlng);
  if (!marker._farmDragHandlerAdded) {
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      updateSelection(p.lat, p.lng);
    });
    marker._farmDragHandlerAdded = true;
  }
  updateSelection(e.latlng.lat, e.latlng.lng);
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
  if (selected) selected.method = next;
}
$('gpsMethod').addEventListener('click', () => selectMethod('gps'));
$('searchMethod').addEventListener('click', () => selectMethod('village'));
$('gpsButton').addEventListener('click', () => {
  if (!navigator.geolocation) return status('This browser does not support location detection. Try village search.', true);
  status('Requesting your device location. Please allow permission if prompted.');
  $('gpsButton').disabled = true;
  navigator.geolocation.getCurrentPosition(
    position => {
      $('gpsButton').disabled = false;
      placePin(position.coords.latitude, position.coords.longitude);
      status(`Device location detected (estimated accuracy: ${Math.round(position.coords.accuracy)} metres). Adjust the pin to your farm if needed.`);
    },
    error => {
      $('gpsButton').disabled = false;
      status(`Location unavailable: ${error.message}. Try village search or tap the map.`, true);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
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
    if (!places.length) return status('No matching places found. Add district and state to your search.', true);
    for (const place of places) {
      const result = document.createElement('button');
      result.type = 'button';
      result.className = 'result';
      result.textContent = place.name;
      result.addEventListener('click', () => {
        placePin(place.latitude, place.longitude, 15);
        results.replaceChildren();
      });
      results.appendChild(result);
    }
    status('Choose the correct place from the results, then adjust the map pin.');
  } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
});
$('confirmButton').addEventListener('click', async () => {
  if (!selected) return;
  $('confirmButton').disabled = true;
  status('Confirming selected coordinates…');
  try {
    const response = await fetch('/api/farm-location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selected)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Confirmation failed');
    $('confirmedText').textContent = `Latitude: ${data.latitude.toFixed(6)} | Longitude: ${data.longitude.toFixed(6)}`;
    $('confirmedJson').textContent = JSON.stringify(data, null, 2);
    $('confirmedPanel').classList.remove('hidden');
    status('Farm coordinates confirmed successfully.');
    $('confirmedPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) { status(error.message, true); }
  finally { $('confirmButton').disabled = false; }
});
