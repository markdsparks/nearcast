# Native map preview checkpoint — 2026-09-18

This is **Phase 3 implementation in progress**, not full map parity or a default-native cutover. TestFlight 106 remains the last uploaded family build. The existing Map tab and its exact-place/date handoff remain unchanged.

## What is implemented

- Native preview → Settings → **Try native weather map**, using the selected place and its clock preference/time zone. An already-validated cached preview context can open the read-only map even when the older Places bridge is unavailable.
- A fixed full-screen MapLibre canvas, floating timeline, explicit previous/next frame controls, zoom/recenter, source labels and linked credits. Changing source content no longer resizes the map canvas.
- Landscape uses a side-by-side control layout rather than clipping the close button or timeline; large accessibility text gets a scrollable control region. Older saved places without a time zone use the loaded forecast's zone only when the coordinates match.
- Direct native MRMS observed decoding from NOAA's advertised S3 objects: bounded gzip/GRIB2 template 3.0/4.0/5.41/16-bit grayscale PNG, checksums, exact object/reference times, Mercator pixel-center sampling and a separate valid-data mask.
- Direct native HRRR Zarr guidance: validated metadata, explicit advertised forecast times, bounded Blosc/LZ4, verified LCC projection, nearest-cell sampling into Mercator rather than stretching four projected corners. Up to eight exact frames/eight spatial chunks in a bounded in-memory selection cache. No fabricated quarter-hour cadence.
- Existing NOAA WMS fallback and separately labeled six-hour NDFD totals. Blank/unverified WMS imagery is explicitly not a clear-weather claim.
- Existing RainViewer **observed-only** global fallback. Global playback is step-only in this preview while a bounded native tile-memory strategy is pending; do not churn the shared-IP provider request budget. No discontinued RainViewer nowcast is invented.
- Exact selection identity survives refresh. A removed selected instant becomes unavailable instead of silently selecting a different time. Source responses publish independently, stale work is cancelled/ignored, and image conversion runs away from the main actor.
- Latest observed source is current through 15 minutes, delayed through 35, then unavailable/fallback; deliberately selected older history is not mislabeled a delayed current feed. Missing coverage at the selected place is checked independently of total viewport coverage.
- Raw radar history is bounded to six actual scans over thirty minutes, with a six-entry/8 MiB rendered-frame LRU. Replaying the same viewport reuses images and their coverage evidence; changing the viewport clears them. Expired exact selections clear their bitmap before request deduplication. Initial and manual metadata work cancel on suspension.
- Current official NWS **selected-place** bulletins and available polygon/MultiPolygon outlines, including holes, CAP intervals, updates/cancellations and bounded freshness. Tapping an outline opens its exact bulletin; null geometry remains accessible as a bulletin, never an invented county outline. This is not a full-viewport alert completeness claim.
- NASA GIBS true-color satellite with verified local pass/date headers, explicit daily acquisition date, zoom bound and linked credit. Selecting satellite removes precipitation and playback; a blank placeholder for today's date is rejected in favor of a verified recent pass.
- NDFD six-hour totals use the provider's own numerical legend, not the reflectivity palette.
- Independent native CARTO configuration lane: `/api/map/config?client=ios`, audience `app.nearcast.ios`, secret `CARTO_BASEMAP_IOS_KEY`. Never borrow the web key, forge a Referer, or proxy/cache tiles on a server. Streets and USGS aerial descriptors keep city labels above weather.
- MapLibre's scoped iOS header, no persistent ambient cache, and redacted/disabled keyed-URL logging are prepared before creating the map. Failed configuration stays unavailable rather than requesting unkeyed/watermarked tiles.
- Fixed native Settings first-presentation race by using the sheet destination as its presentation identity.

## Automated evidence

`bash scripts/nearcast-ci.sh all` includes the existing product/weather/notification/Places/Watch regressions plus the native radar numeric, timeline, NCRD, MRMS, HRRR, presentation, freshness, basemap and global-source tests. Provider networking is optional, not required by normal CI.

Additional deterministic suites cover the bounded LRU, official alerts, satellite acquisition and 39 JavaScript-oracle seam estimation/gate cases. Seam code remains a pure foundation: no live pixel advection or blended transition has been activated.

Live source checks performed during implementation:

- MRMS source `2026-09-19T02:50:42Z`, 7000×3500 source: national 320×200 viewport, 43,808 valid pixels and 2,251 echo pixels; Swift texture SHA256 exactly matches the existing browser worker (`cd52920990c6383cb78f00c1159858b48f27400996c3fe6a58ab9013d1162140`). A St. Louis viewport had valid coverage with no echoes; transparent imagery there was not merely assumed to mean clear.
- HRRR `20260919_00z`, spatial chunk 3.7, first three advertised forecast hours: all 67,500 Float32 values match the web decoder's FNV1a64 (`ffe1a1fb0f01fb65`), with exact valid times and independent LCC coordinate comparison.
- Release simulator compilation succeeds with the pinned MapLibre SDK. This is not hardware performance evidence.

## Visual checks and limits

Unlocked-Mac inspection on the isolated iPhone 17 Pro Max simulator confirmed Settings initially opened Places in build 106; the fix now opens Settings on both phone sizes. Native preview source switches keep the map marker/canvas stationary, and the next-frame button updates the exact displayed time. Playback in the earlier lab reached the final advertised frame and stopped.

On the iPhone 17 Pro simulator, the corrected landscape layout keeps close, time controls and credits visible. Maryville shows UTC−05:00 with the 24-hour preference. The live NWS Heat Advisory opens its exact bulletin and is correctly identified as having no polygon.

The live NASA MODIS Aqua September 18 image renders in landscape with its date and credits; returning to radar removes satellite imagery. A small inline-style readiness race was fixed by accepting MapLibre's documented non-nil loaded style, even if its delegate callback happened before delegate assignment. The existing-map handoff opens the full map. Background/resume testing exposed metadata downsampling dropping a still-advertised selected scan; bounded history now explicitly retains that exact scan (regression-tested) while remaining capped at six images. True source removal still shows unavailable rather than guessing another time.

The computer-control bridge did not reliably forward drag gestures to the simulated map or slider. Double-tap zoom and explicit controls respond; **finger pan/pinch/scrub are not accepted on that basis**. Physical iPhone 17 Pro/Pro Max testing remains required. No personal device stores or notification choices were changed for testing.

## Open gates — do not call Phase 3 complete

1. **CARTO iOS authorization:** owner creates a separate bundle-restricted iOS key and installs `CARTO_BASEMAP_IOS_KEY`; deploy the isolated lane, then verify live authorized street/aerial tiles and labels. Current preview fails closed until this is available.
2. Real-device finger pan/pinch/scrub, background/resume, accessibility text/VoiceOver, rotation, slow/offline recovery, memory and frame-time measurement on both required phones.
3. MRMS/HRRR observed-to-forecast **motion/seam/quality gates** and subhourly model path. The numerical primitives and readers are not full enhanced-map parity. No smooth blended transition is claimed by this preview.
4. Full viewport alert discovery, saved/device markers, Storm Check/Ask routing, complete fallback legends and the remaining layer interactions. The point-alert/satellite implementations above still need end-to-end visual acceptance with authorized basemaps.
5. StormScope/lightning native SDK authorization, provider leases/budgets and rendering parity; no paid native session or account change has been activated here.
6. Global provider tile-memory/playback budget strategy; full global animation remains in the existing map.
7. Existing MapLibre device-archive metadata preparation and missing upstream dSYM caveat from build 106 still apply before another TestFlight upload.

No calendar permission, location permission prompt, new notification policy, or plan ownership change is introduced by this checkpoint.
