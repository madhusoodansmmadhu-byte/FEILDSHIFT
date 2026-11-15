'use strict';
const router = require('express').Router();
const { validateFarmerLand } = require('../services/farmerInputValidator');
const { getNASAClimate } = require('../services/nasaPowerService');
const { evaluateCrops } = require('../services/ruleEngine');
router.post('/', async (req, res) => {
  if (!req.body || Object.keys(req.body).some(key => key !== 'farmerData')) return res.status(400).json({ success: false, errors: [{ field: 'form', message: 'Supply farmerData only' }] });
  const validation = validateFarmerLand(req.body.farmerData);
  if (!validation.valid) return res.status(400).json({ success: false, errors: validation.errors });
  try {
    const farmer = validation.data;
    const nasaData = await getNASAClimate(farmer.latitude, farmer.longitude);
    const results = evaluateCrops(farmer, nasaData);
    return res.json({ success: true, saved: false, ...results, completedStages: ['Checking farmer land details', 'Retrieving historical climate information', 'Analyzing climate conditions', 'Evaluating 20 crops', 'Calculating suitability scores', 'Preparing recommendations'] });
  } catch (error) {
    const timeout = ['AbortError', 'TimeoutError'].includes(error.name);
    return res.status(timeout ? 504 : 502).json({ success: false, error: timeout ? 'Historical climate processing timed out. Please retry.' : 'Historical climate information is unavailable. Please retry.' });
  }
});
module.exports = router;
