'use strict';
const router = require('express').Router();
const { OPTIONS, validateFarmerLand } = require('../services/farmerInputValidator');
router.get('/options', (_req, res) => res.json({ success: true, ...OPTIONS }));
router.post('/', (req, res) => {
  const result = validateFarmerLand(req.body);
  if (!result.valid) return res.status(400).json({ success: false, errors: result.errors });
  return res.json({ success: true, stage: 3, landDetails: result.data, saved: false, nextStage: 'rule-based-recommendation' });
});
module.exports = router;
