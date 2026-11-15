# NASA POWER integration

## Run and verify

```powershell
cd "C:\Users\HP\OneDrive\Documents\ChatGPT\NASA HACK\backend"
npm.cmd start
```

Default port: 3001. Stop the previous backend first if that port is occupied.
For automatic restart while editing, use `npm.cmd run dev` instead.
No extra package, SDK, database, or NASA API key is needed. Node.js 20+ is required.

From the project root:

```powershell
node --check backend/server.js
node --check backend/services/nasaPowerService.js
node --check backend/services/climateAnalysis.js
node --check frontend/script.js
node --test backend/*.test.js
```

Open http://localhost:3001 in Chrome and hard-refresh:

1. Select GPS or submit a village search. Adjust the pin to the actual farm.
2. Confirm the location. Inspect Network: POST `/api/farm-location`, then GET
   `/api/climate?latitude=...&longitude=...`. The second request uses the exact
   numeric coordinates returned by the first; display rounding does not affect it.
3. A loading message appears; NASA can take up to 60 seconds. A confirmed location
   remains confirmed even when climate loading fails. Use Retry NASA Data after an error.
4. Move the pin during loading. Old results disappear, the browser request is
   aborted, and the previous response must not display for the new point.
5. Check the three cards, monthly plots, annual sums, climatology, YTD comparisons,
   units, completeness labels and per-parameter observation counts.
6. Check at desktop width and approximately 375px. Check Console and Network.
7. Repeat GPS, village selection, pin dragging and confirmation to verify preservation.

## Data flow and upstream query

Leaflet -> confirmed coordinates -> POST `/api/farm-location` -> GET `/api/climate`
-> NASA service -> daily analysis -> compact dashboard response.

`/api/climate` is immediately before the existing static middleware. Health,
geocoding and farm-confirmation routes are preserved. NASA is called only by the
backend. The climate frontend call is in the existing confirmation handler after
its selection-version check, using the validated coordinates returned by Express.

Endpoint: https://power.larc.nasa.gov/api/temporal/daily/point

Parameters: `community=AG`, `parameters=T2M,PRECTOTCORR,RH2M`, `format=JSON`,
`time-standard=LST`, unchanged `latitude` and `longitude`, `start=20230101`, and
`end=min(current UTC calendar date,20261231)`. There is no invented lag offset.
If NASA rejects the end date with HTTP 422, a clear publication/date-range error is
returned. No automatic date retries are made. If it returns shorter series or fill
values, the analysis records actual coverage independently for each parameter.

The cache holds at most 20 successful validated responses for one hour. Identical
in-flight requests share one promise; at most five distinct upstream requests can
run concurrently in this process. Coordinates are not rounded to cache cells.
No coordinates are hardcoded as a selected farm. Initial map coordinates only set
the viewport. Karnataka is the intended scope, not an enforced rough rectangle.

## Response schema and calculation definitions

Top-level: `success`, `source`, `coordinates`, `period` (requested YYYYMMDD start/end),
`climate`, and `metadata` (NASA header, geometry, parameter definitions and time standard).
Daily series stay on the backend. NASA geometry uses longitude/latitude order;
requested coordinates remain named latitude/longitude fields and are never swapped.

Coverage for each of `T2M`, `PRECTOTCORR`, `RH2M`:
`{expected,valid,missing,complete}`. Expected counts include every calendar day in
the requested interval. Missing dates, nonnumeric/null/nonfinite values, header or
parameter metadata fill values and known -999 sentinels are excluded. Negative
precipitation and humidity outside 0–100 are excluded. Missing rain is never zero.

* `summary`: valid-daily mean temperature (°C), valid-daily mean humidity (%), mean
  annual rainfall (mm/year), `completeRainfallYears`, and units. Annual mean uses
  complete precipitation years 2023–2025 only; no eligible year means null.
* `monthly[]`: `{year,month,meanTemperatureC,meanHumidityPercent,rainfallObservedMm,
  rainfallTotalMm,coverage,calendarDays,complete,units}`. Observed sums include valid
  rain only. `rainfallTotalMm` is null unless the full calendar month has all rain
  observations. The `complete` flag describes rainfall; other parameters have their
  own coverage flags. Means use valid observations, including incomplete months.
* `yearly[]`: `{year,meanTemperatureC,meanHumidityPercent,rainfallObservedMm,
  annualRainfallMm,coverage,calendarDays,fullYearRequested,complete,units}`.
  `annualRainfallMm` is null unless the full calendar year has valid daily rainfall.
  Leap-year 2024 has 366 days. Partial 2026 sums are never labelled complete totals.
* `monthlyRainfallClimatology[]`: `{month,meanRainfallMm,completeYearCount,units}`.
  Means of complete month totals in 2023–2025, not a 30-year normal.
* `currentYear`: `{year:2026,partial,through,rainfallYtdMm,rainfallObservedMm,coverage,
  equivalentPeriodComparisons}`. `through` is the last valid 2026 rain date.
  A complete Jan-1-to-through series yields `rainfallYtdMm`; gaps yield null and a
  separately labelled observed sum. No available rain yields null, not zero.
* Comparisons: `{year,start,end,rainfallObservedMm,rainfallMm,coverage,units}`.
  Prior years use Jan 1 to the same month/day as the latest 2026 rain observation.
  Leap days are retained, so same-calendar-date windows can differ in day count.
  A comparison with gaps has null `rainfallMm` and must not be treated as comparable.
* `dataQuality`: overall coverage, requested period, first/last available dates,
  last available date per parameter, and warnings. The overall last date means
  latest valid observation of any parameter, not guaranteed common coverage.

NASA daily precipitation in mm/day is integrated across one-day intervals to
produce mm totals. Unknown reported units are rejected rather than mislabelled.
Null dashboard values display “Data unavailable”. Reported statistics are rounded
to two decimals. These gridded historical estimates are not field sensors or forecasts.

## Verification evidence and limits

16 automated tests passed at implementation: mocked NASA and browser responses,
actual Express handler functions, date/leap-year calculations, gaps/fill values,
cache/deduplication, route validation, cancellation, retry, coordinate transfer,
and previous GPS/village functionality. Syntax and whitespace checks passed.

One live request using a Bengaluru reference point failed DNS resolution with
`ENOTFOUND`. No live NASA success or browser/real-GPS success is claimed. Local
HTTP transport and visual/mobile checks require the manual procedure above.

Official API reference: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
