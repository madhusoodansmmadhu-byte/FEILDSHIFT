# Farmer details and recommendation workflow

Run from `backend`: `npm.cmd run dev` (port 3001). Do not start a duplicate process.
Run tests from the project root: `node --test backend/*.test.js`.

The existing map confirms coordinates internally, then `/api/climate` retrieves and analyzes real NASA observations. The six-field form becomes available only after success. `/api/farmer-land/options` supplies options and `/api/farmer-land` validates and normalizes a temporary record. Only that validated record enters sessionStorage under `agrishift_farmer_land`. Edits, pin movement, clearing details and a new assessment invalidate results. Stored details must match the confirmed coordinates and be validated again.

`/api/rule-based-scores` revalidates inputs, calls the existing NASA service once, and evaluates all 20 crops. It returns no coordinates or numerical NASA observations. All caches and farmer records remain temporary; there is no database or file persistence. The browser remembers validated details only for its session.

## Evidence and scoring limits

All profiles live inside `backend/services/ruleEngine.js`. Missing requirements are explicit nulls. Four crops currently have sufficient reference temperature, crop-period rainfall and indicative duration evidence for **provisional** scores: Ragi, Maize, Groundnut and Jowar. The other sixteen remain unassessable rather than receiving fabricated scores. Top recommendations contain at most three assessable, eligible crops and can be fewer or empty.

Sources are attached to each relevant profile. They include TNAU Ragi FAQs and cultivation guidance, the Bangladesh Department of Agricultural Extension's maize/groundnut guidance, Kerala Agriculture's crop package and FAO's indicative growing periods. Regional sources are not locally validated Karnataka prescriptions. Irrigation water need or annual rainfall has not been substituted for seasonal precipitation requirements.

Reference durations use a documented variety or the lower bound of an indicative range. Historical analogue windows match the planting month/day for available 2023–2026 years, including year crossings. Windows outside the requested data period or not earlier than planting are excluded. Non-leap years are skipped for February 29 planting dates. Missing values, fill values and incomplete rainfall are never turned into complete totals. Current scoring requires complete temperature, rainfall and humidity coverage in each used window; this is conservative even when a humidity requirement is unknown. One complete window permits only a limited assessment; no complete windows means no score.

The requested final weights are climate .40, soil .25, irrigation .20 and rotation .15. Climate weights are temperature .40, precipitation .45 and humidity .15, renormalized when the profile lacks a humidity requirement. No humidity ranges are currently verified. Scores remain within 1–10 and use continuous distance penalties around documented preferred values. Their penalty slope, irrigation-category mapping and rotation scores are **prototype engineering policy**, not source-validated agricultural response curves. Preferred conditions score 9 rather than implying perfection. Unknown soil compatibility receives a provisional neutral 5 with a warning. Ragi's supported soil categories receive a higher score; broad soil labels do not resolve drainage or fertility. Rotation uses both previous and current crop family history and warns about unresolved disease risks. Maize is excluded for historical summer means below the source's stated lower growing limit. Other stage-specific temperature/flooding/harvest hazards are disclosed as limitations rather than inferred from seasonal means.

Raw scores determine rank before output rounding. Historical climate is not a future forecast. These estimates do not guarantee yield.

## Presentation and progress

Map controls retain their existing IDs and behavior. Only the coordinate display block is hidden inside the map footer; the confirmation button remains visible. Confirmation numbers/JSON and the legacy technical climate results have permanent hidden presentation. Legacy rendering remains for regression compatibility. Loading and error controls remain visible independently.

Progress text follows request/response boundaries. The recommendation request uses one broad processing state and confirms completion only after a successful response. There are no timed fake stages. Validation errors remain actionable; climate and recommendations have retry buttons.

## Chrome checks

1. Open http://localhost:3001 and hard-refresh. Confirm Leaflet, map tiles and controls load.
2. Test GPS permission denial and village search. Click/drag the pin, confirm it and wait for climate processing. No coordinates or climate measurements should appear.
3. Fill all six fields, validate, generate and inspect the top crops and all 20 evaluations, including evidence limitations.
4. Edit a field and confirm Generate is disabled until validation. Change the pin while processing and confirm no old form/results appear.
5. Test Clear Farmer Details, recommendation retry, climate retry and Start a New Assessment.
6. Check keyboard controls and a 375px viewport. The form/cards should stack and the crop table should scroll within its region.
