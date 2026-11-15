'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const fields = ['soilType', 'irrigationAvailability', 'previousCrop', 'currentCrop', 'nextSeason', 'plantingDate'];
  let context = null, validated = null, epoch = 0, controller = null, optionsPromise = null;
  function invalidate(clearStorage = true) {
    epoch++;
    controller?.abort();
    validated = null;
    $('validateFarmerButton').disabled = false;
    $('generateRecommendationsButton').disabled = true;
    if (clearStorage) window.FarmerSession.clearFarmerLand();
    window.RecommendationDashboard?.clear();
  }
  function reset() {
    invalidate(); context = null;
    $('farmerLandForm').reset();
    $('farmerFormStatus').textContent = '';
    $('farmerLandSection').classList.add('hidden');
  }
  async function loadOptions() {
    if (!optionsPromise) optionsPromise = fetch('/api/farmer-land/options').then(async response => {
      const data = await response.json();
      if (!response.ok || !data.success) throw Error('Land options could not be loaded. Retry climate processing.');
      for (const [id, options] of [['soilType', data.soilTypes], ['irrigationAvailability', data.irrigationLevels], ['previousCrop', data.crops], ['currentCrop', data.crops], ['nextSeason', data.seasons]]) {
        $(id).replaceChildren();
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an option'; $(id).appendChild(placeholder);
        for (const item of options) { const option = document.createElement('option'); option.value = typeof item === 'string' ? item : item.id; option.textContent = typeof item === 'string' ? item.charAt(0).toUpperCase() + item.slice(1) : item.name; $(id).appendChild(option); }
      }
    }).catch(error => { optionsPromise = null; throw error; });
    return optionsPromise;
  }
  async function ready(location) {
    invalidate(false); context = location;
    const version = epoch;
    await loadOptions();
    if (version !== epoch) return;
    $('plantingDate').min = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const stored = window.FarmerSession.getFarmerLand();
    if (stored && stored.latitude === location.latitude && stored.longitude === location.longitude) {
      for (const field of fields) $(field).value = stored[field] || '';
      $('farmerFormStatus').textContent = 'Previous details restored. Validate them again before generating recommendations.';
    } else { window.FarmerSession.clearFarmerLand(); $('farmerFormStatus').textContent = 'Climate information is ready. Enter your land details.'; }
    $('farmerLandSection').classList.remove('hidden');
    $('farmerLandSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  for (const field of fields) for (const event of ['input', 'change']) $(field).addEventListener(event, () => { invalidate(); $('farmerFormStatus').textContent = 'Details changed. Validate again.'; });
  $('farmerLandForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!context) return;
    invalidate(); const version = epoch;
    controller = new AbortController();
    $('validateFarmerButton').disabled = true;
    $('farmerFormStatus').textContent = 'Checking farmer land details…';
    const input = { latitude: context.latitude, longitude: context.longitude };
    for (const field of fields) input[field] = $(field).value;
    try {
      const response = await fetch('/api/farmer-land', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal });
      const data = await response.json();
      if (version !== epoch) return;
      if (!response.ok || !data.success) throw Error(data.errors?.map(e => `${e.field}: ${e.message}`).join('; ') || 'Could not validate details.');
      validated = data.landDetails;
      const saved = window.FarmerSession.saveFarmerLand(validated);
      $('farmerFormStatus').textContent = `Details validated.${saved ? ' Saved for this browser session only.' : ' Session storage is unavailable; details remain in this page only.'}`;
      $('generateRecommendationsButton').disabled = false;
    } catch (error) { if (version === epoch) $('farmerFormStatus').textContent = error.message || 'Validation failed. Please retry.'; }
    finally { if (version === epoch) $('validateFarmerButton').disabled = false; }
  });
  $('clearFarmerButton').addEventListener('click', () => { invalidate(); $('farmerLandForm').reset(); $('farmerFormStatus').textContent = 'Details cleared.'; });
  $('generateRecommendationsButton').addEventListener('click', () => { if (validated) window.RecommendationDashboard.generate(validated); });
  window.FarmerLand = { ready, reset, getValidated: () => validated };
})();
