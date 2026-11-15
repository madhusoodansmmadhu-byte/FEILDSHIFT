# Farm location verification

Start from PowerShell:

```powershell
cd "C:\Users\HP\OneDrive\Documents\ChatGPT\NASA HACK\backend"
$env:PORT="3001"
# Optional: set NOMINATIM_CONTACT_EMAIL to your real project contact email.
npm.cmd start
```

Use one backend process so its shared queue enforces the public provider limit.
Nominatim uses an application-specific User-Agent; configure the actual project
contact using NOMINATIM_CONTACT_EMAIL. No contact email is invented or committed.
NOMINATIM_SEARCH_URL can configure a replacement provider endpoint supporting the
same API. Search is button-triggered, cached, India-filtered, and serialized at
least 1.1 seconds apart. Follow https://operations.osmfoundation.org/policies/nominatim/.

## Local automated checks

From the project root:

```powershell
node --check frontend/script.js
node --check backend/server.js
node --test backend/location.test.js
```

Tests use simulated browser/provider responses and actual backend handlers.
They do not establish successful live GPS, live geocoding or HTTP transport.

## Manual browser checklist

1. Open http://localhost:3001 in normal Chrome. Hard-refresh (Ctrl+F5).
2. In developer tools, check Console and Network for Leaflet CSS/JS and tile failures.
3. Check `window.isSecureContext` and
   `navigator.permissions.query({name:'geolocation'}).then(console.log)` in Console.
4. Allow Chrome site location permission and Windows Settings > Privacy & security >
   Location (including desktop app access if shown). A laptop may use network-based
   location rather than dedicated GPS. Integrated browsers can have additional restrictions.
5. Detect location. Verify accuracy and fix age are shown; manually place the pin at
   the actual field. Denial must not retry. High-accuracy timeout gets one lower-accuracy attempt.
6. Search Shivamogga, Shikaripura and Bengaluru with Karnataka, India. Record actual
   provider results; distinguish matching addresses. No reference coordinates are fabricated.
7. Drag and click the pin. Compare the marker's coordinates with the displayed six-decimal
   values. Display rounding is intentional; the confirmation payload retains full precision.
8. In Network, inspect POST /api/farm-location. Its numeric latitude/longitude must
   match the latest pin (tolerance 0.000001 degrees) and the response must echo them.
9. Move the pin while confirming; the old response must not confirm the new location.
10. Check zoom, pan, marker dragging and horizontal overflow at desktop and 375px widths.

Technology: Leaflet is a CDN frontend library; geolocation is a browser API;
OpenStreetMap tiles and Nominatim are hosted services; Express is the backend dependency.
No extra geolocation, CORS or duplicate Leaflet package is needed for same-origin requests.

Live audit attempts in the restricted execution environment failed DNS lookup for
nominatim.openstreetmap.org (ENOTFOUND) for all three requested places. Actual GPS,
browser layout, provider coordinates and end-to-end HTTP still require manual verification.
