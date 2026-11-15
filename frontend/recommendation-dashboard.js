'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let version = 0, controller = null;
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
  const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'Not assessed';
  function clear() {
    version++; controller?.abort();
    $('recommendationSection').classList.add('hidden');
    for (const id of ['topRecommendations', 'allCropResults', 'recommendationWarnings']) $(id).replaceChildren();
    $('recommendationStatus').textContent = '';
    $('generateRecommendationsButton').disabled = !window.FarmerLand?.getValidated();
  }
  async function generate(farmerData) {
    clear(); const current = version; controller = new AbortController();
    $('recommendationSection').classList.remove('hidden');
    $('generateRecommendationsButton').disabled = true;
    $('retryRecommendationsButton').classList.add('hidden');
    $('recommendationStatus').textContent = 'Evaluating 20 crops and preparing suitability recommendations using historical climate information…';
    try {
      const response = await fetch('/api/rule-based-scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ farmerData }), signal: controller.signal });
      const data = await response.json();
      if (current !== version) return;
      if (!response.ok || !data.success) throw Error(data.error || data.errors?.map(e => e.message).join('; ') || 'Recommendation processing failed.');
      if (!Array.isArray(data.evaluations) || data.evaluations.length !== 20 || !Array.isArray(data.topRecommendations)) throw Error('Incomplete recommendation response. Please retry.');
      $('recommendationStatus').textContent = 'Recommendations ready. Land details checked. Climate conditions analyzed. 20 crops evaluated, suitability scores calculated where evidence permits, and recommendations prepared.';
      if (!data.topRecommendations.length) $('topRecommendations').appendChild(text('p', 'No crops can be recommended with the available evidence and historical observations. Review the evaluations below.'));
      for (const crop of data.topRecommendations) {
        const card = document.createElement('article'); card.className = 'recommendation-card';
        card.append(text('h3', `${crop.rank}. ${crop.cropName}`), text('strong', `${score(crop.scores.final)} / 10`));
        for (const reason of crop.reasons) card.appendChild(text('p', reason));
        for (const warning of crop.warnings) card.appendChild(text('p', warning));
        $('topRecommendations').appendChild(card);
      }
      const table = document.createElement('table');
      const caption = text('caption', 'All 20 crop evaluations. Scores are out of 10; not assessed means evidence is insufficient.'); table.appendChild(caption);
      const head = document.createElement('thead'), header = document.createElement('tr');
      for (const name of ['Crop', 'Rank', 'Climate', 'Soil', 'Irrigation', 'Rotation', 'Final', 'Status and explanation']) header.appendChild(text('th', name));
      head.appendChild(header); table.appendChild(head); const body = document.createElement('tbody');
      for (const crop of data.evaluations) {
        const row = document.createElement('tr');
        for (const value of [crop.cropName, crop.rank ?? '—', ...['climate', 'soil', 'irrigation', 'rotation', 'final'].map(key => score(crop.scores[key])), `${crop.eligibility}: ${[...crop.reasons, ...crop.warnings].join(' ')}`]) row.appendChild(text('td', String(value)));
        body.appendChild(row);
      }
      table.appendChild(body); $('allCropResults').appendChild(table);
      for (const warning of data.warnings) $('recommendationWarnings').appendChild(text('p', warning));
    } catch (error) {
      if (current !== version) return;
      $('recommendationStatus').textContent = error.message || 'Connection failed. Please retry.';
      $('retryRecommendationsButton').classList.remove('hidden');
    } finally { if (current === version) $('generateRecommendationsButton').disabled = false; }
  }
  $('retryRecommendationsButton').addEventListener('click', () => { const data = window.FarmerLand.getValidated(); if (data) generate(data); });
  $('newAssessmentButton').addEventListener('click', () => window.FieldShift.startNewAssessment());
  window.RecommendationDashboard = { clear, generate };
})();
