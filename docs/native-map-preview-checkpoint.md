# Native map preview checkpoint — 2026-09-18

This is **Phase 3 implementation in progress**, not full map parity or a default-native cutover. TestFlight **0.1.0 (107)** uploaded successfully on September 18 at 23:01 CDT; Apple reported the package was processing. The existing Map tab and its exact-place/date handoff remain unchanged.

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
- Saved-place markers and an explicit device-location action. Tapping a marker opens detail; centering changes only the camera. "Use this place for weather" goes through the verified Places owner before changing the selected place. The location permission dialog is allowed to finish; background/disappearance cancels the lookup.
- Debounced viewport NWS polygon discovery, separate from selected-place bulletins: bounded pagination, exact viewport intersection, five-minute memory reuse, partial-feed disclosure, and no all-clear claim for missing outlines. A bulletin's freshness and expiry are independent of the selected radar time and the selected place's alert summary.
- Conservative observed-to-forecast composition at **existing advertised model times**. The original HRRR frame renders before optional radar-history downloads. Three actual observations, consistent motion, fresh source/run, complete source coverage, and forecast-alignment gates must pass. Unknown translated edges stay masked. A successful result is labeled "Radar-guided forecast"; unavailable evidence leaves the original HRRR image intact. This is not subhourly model parity or independent validation of storm accuracy.
- Request/cache identities cover source metadata revisions, observation/model freshness boundaries, exact selected/anchor times, run and viewport. Refreshed radar can reevaluate an already selected forecast; expired guidance cannot retain a radar-guided label indefinitely.
- "Ask about this place" hands off the exact selected place to existing Ask. It explicitly does not send the displayed radar frame or viewport as storm evidence. Storm Check remains available through the full existing map.

## Automated evidence

Build 107 passed the complete portable and native-model release preflight, signed archive, guarded SDK archive preparation, and iPhone/widget/Watch/complication packaging checks. App Store upload and export succeeded. The existing upstream MapLibre dSYM warning remains; it did not block upload, but MapLibre-internal crash frames may lack symbols. No Xweather SDK is included in this archive.

`bash scripts/nearcast-ci.sh all` includes the existing product/weather/notification/Places/Watch regressions plus the native radar numeric, timeline, NCRD, MRMS, HRRR, presentation, freshness, basemap and global-source tests. Provider networking is optional, not required by normal CI.

Additional deterministic suites cover the bounded LRU, paginated official alerts, satellite acquisition, 39 JavaScript-oracle seam estimation/gate cases, exact-time composition, and transition request/cache orchestration boundaries. Synthetic motion tests include conflicting motion, stale inputs, missing masks, cropped edges and cancellation; they are not real-device frame-rate or live storm-accuracy evidence.

Live source checks performed during implementation:

- MRMS source `2026-09-19T02:50:42Z`, 7000×3500 source: national 320×200 viewport, 43,808 valid pixels and 2,251 echo pixels; Swift texture SHA256 exactly matches the existing browser worker (`cd52920990c6383cb78f00c1159858b48f27400996c3fe6a58ab9013d1162140`). A St. Louis viewport had valid coverage with no echoes; transparent imagery there was not merely assumed to mean clear.
- HRRR `20260919_00z`, spatial chunk 3.7, first three advertised forecast hours: all 67,500 Float32 values match the web decoder's FNV1a64 (`ffe1a1fb0f01fb65`), with exact valid times and independent LCC coordinate comparison.
- Release simulator compilation succeeds with the pinned MapLibre SDK. This is not hardware performance evidence.
- The native CARTO configuration is now live and authorized: the iOS lane returns a no-store, bundle-audienced response, and official street/label tile requests with the bundle header return valid PNGs. Both street and aerial maps with city labels were visually checked; no watermarked/unkeyed fallback is used.
- The bounded live national NWS check loaded 364 products: 18 renderable active official polygons, 227 unexpired bulletin-only products, and 118 expired products rejected. These are nationwide counts, not local warnings. A Maryville viewport had no intersecting polygon; selected-place bulletin discovery remains independent. A cached world pan reused the feed without another download.

## Visual checks and limits

Unlocked-Mac inspection on the isolated iPhone 17 Pro Max simulator confirmed Settings initially opened Places in build 106; the fix now opens Settings on both phone sizes. Native preview source switches keep the map marker/canvas stationary, and the next-frame button updates the exact displayed time. Playback in the earlier lab reached the final advertised frame and stopped.

On the iPhone 17 Pro simulator, the corrected landscape layout keeps close, time controls and credits visible. Maryville shows UTC−05:00 with the 24-hour preference. The live NWS Heat Advisory opens its exact bulletin and is correctly identified as having no polygon.

The live NASA MODIS Aqua September 18 image renders in landscape with its date and credits; returning to radar removes satellite imagery. A small inline-style readiness race was fixed by accepting MapLibre's documented non-nil loaded style, even if its delegate callback happened before delegate assignment. The existing-map handoff opens the full map. Background/resume testing exposed metadata downsampling dropping a still-advertised selected scan; bounded history now explicitly retains that exact scan (regression-tested) while remaining capped at six images. True source removal still shows unavailable rather than guessing another time.

The computer-control bridge did not reliably forward drag gestures to the simulated map or slider. Double-tap zoom and explicit controls respond; **finger pan/pinch/scrub are not accepted on that basis**. Physical iPhone 17 Pro/Pro Max testing remains required. No personal device stores or notification choices were changed for testing.

The next checkpoint was exercised on both isolated iOS 27 phone simulators. The Pro showed the loaded HRRR forecast at its exact advertised time, the selected-place marker action sheet, camera-only recentering, and the separate place/area alert sections. Its Heat Advisory detail displayed the current check time and earlier bulletin expiry correctly. The Pro Max verified first-use location permission denial returns to an operable map with a useful explanation, and "Ask about this place" opened existing Ask with Maryville preserved. Neither simulator had a second saved test place in this round, so a different-place marker selection still requires the family/device check below. No storm echoes near the test location were available to visually accept enhanced storm motion; that path has deterministic fixtures, not live-storm acceptance.

Native Xweather contracts, mocked transport/lifecycle tests, an isolated worker lane and an SDK adapter candidate are prepared separately; see [native-xweather-foundation.md](native-xweather-foundation.md). They are not linked into the shipping app or enabled by this checkpoint.

## Open gates — do not call Phase 3 complete

### Faster looping playback (build 112)

Release: `11f859b`, TestFlight 0.1.0 (112), uploaded successfully September 19 at 07:08 CDT. Full portable/native-model preflight, signed archive, packaging validation and export/upload passed. Apple accepted the package for processing; its immediate build-list query did not yet include 112, so tester availability is not confirmed. Existing upstream MapLibre missing-dSYM warning remains nonblocking. Log: `/tmp/nearcast-testflight-112.log`.

Native map playback holds ready frames for 400 ms instead of 1.2 seconds, with an 800 ms endpoint pause before returning to the first advertised time in the selected range. Loading readiness is checked separately every 50 ms, so a download does not impose another full polling interval. Playback never skips pending frames or relabels the retained image. Interior source gaps, missing selection, errors, explicit pause and lifecycle cancellation retain their existing guards. Global tile-budget and satellite playback restrictions are unchanged. This changes animation pacing, not source cadence, forecast resolution or motion interpolation.

Deterministic presentation tests cover two complete cycles, endpoint behavior, single/empty timelines, missing selection and preservation of gap stops. Physical-phone acceptance should compare radar-only and integrated radar/forecast playback, loop reset, pause during loading, and background/resume. Cold network acquisition can still limit playback speed.

### Bounded frame readiness (build 111)

Release: `88ced54`, TestFlight 0.1.0 (111), uploaded successfully September 19 at 00:48 CDT. Full release preflight, signed archive, packaging validation and export/upload passed. Apple accepted the package for processing; its immediate build-list response did not yet include 111, so tester availability is not confirmed. The existing upstream MapLibre missing-dSYM warning remains nonblocking. Log: `/tmp/nearcast-testflight-111.log`. Physical-device cold-versus-warm scrubbing and active-storm acceptance remain required.

After a displayed frame settles for 450 ms (100 ms during playback), native numeric radar/subhourly forecast warms at most two uncached neighboring source frames per pass. Manual scrubbing favors the next and previous frames; playback favors the next two. The planner uses only advertised times in the active timeline, looks at most two positions away, and does not cross a gap over one hour. Global provider tiles, six-hour accumulation and satellite imagery are excluded. Existing hourly HRRR batching is unchanged.

Warmup is serial, optional and disabled in Low Power Mode. A foreground selection cancels it and waits for cancellation cleanup before acquiring a new field. Viewport/product changes and background/close invalidate work. Before insertion, generation, viewport, selected time and current source metadata must still match. Warmup never publishes a visible image, timestamp, label or failure message. The existing per-source six-entry/eight-MiB cache limits remain; prepared forecasts still go through current handoff checks when selected, not through a cached claim of radar alignment.

Deterministic tests cover the two-frame limit, forward playback, cached exclusion, duplicate/unordered dates, gaps, endpoints, missing selection, oversized input and selected-frame residency under eviction. Transport cancellation and late-result guards retain their existing contracts. Phone testing should compare the first cold pass with a second pass over the same nearby times, then rapidly change time/view and background/resume. No guaranteed latency claim or between-frame motion interpolation is introduced in this step.

### Radar-motion bridge follow-up (build 110)

Release: `4466561`, TestFlight 0.1.0 (110), uploaded successfully September 19. Full regression suite, release preflight, signed archive, packaging validation and export/upload passed. Apple accepted the upload for processing; its immediate build-list response did not yet include 110, so tester availability is not confirmed. Existing MapLibre upstream dSYM warning remains nonblocking. Log: `/tmp/nearcast-testflight-110.log`.

Native composition no longer discards a reliable observed-motion prediction solely because the model cannot be aligned. All observation/model freshness, input identity, motion, source coverage, exposed-edge coverage and maximum-horizon gates still apply. Failed/low-confidence model correction produces no fabricated displacement or intensity correction. At exact advertised forecast times, the fallback starts with radar motion and smoothly increases original-model weight from 15 to 60 minutes after the observation; at 60 minutes it is fully the original model and is no longer labeled radar-guided. Successful alignment retains the existing 15–75-minute corrected blend. This is prediction, not observation or extra measured temporal resolution.

One immutable prepared motion/correction (including an unavailable correction) is reused across target times. Exact observation pixels/masks/times, anchor pixels/masks/time, viewport/encoding and cycle must match; freshness checks run on every composition. Viewport and changed subhourly metadata invalidate the model-held preparation. A cached anchor avoids repeat downloads while scrubbing. No between-frame interpolation is added.

Targeted tests cover model mismatch retaining the first motion frame, progressive fallback weights, complete return to unmodified model, cached/uncached equality, input/cycle mismatch and stale prepared inputs. Existing reverse-motion, stationary, coverage, cancellation, time identity and original numeric-composition checks remain. Release simulator compilation passed. Physical active-storm acceptance remains required, especially for model disagreement during the blend; no claim of universal seamless continuity is made.

### Native high-detail rendering follow-up (after build 108)

Release: `b75f097`, TestFlight 0.1.0 (109), uploaded September 19 at 00:00 CDT. Full CI, release preflight, signed iPhone/Watch archive, archive validation and export/upload passed. Apple accepted the package for processing; the immediate build-list query did not yet return 109, so tester availability is not confirmed. The existing upstream MapLibre missing-dSYM warning remains nonblocking. Log: `/tmp/nearcast-testflight-109.log`. Pro Max additionally verified the six-hour range ending at 05:45 with the compact layout intact.

The native integrated timeline now prefers the existing NOAA HRRR subhourly source: 24 genuine quarter-hour REFC records covering the next six hours. Strict index/GRIB time binding, allowlisted bounded HTTP ranges, cancellation and a six-entry/eight-MiB viewport cache keep acquisition bounded. Hourly Zarr remains the fallback if subhourly discovery is unavailable. The existing radar-motion alignment applies only when its freshness/coverage/motion gates pass; no temporal frames are invented. During drag, the thumb follows the unsnapped finger time independently of the selected source image. On release it settles on the actual selected frame. Loading retains the previous image and its timestamp.

Verification for this follow-up: Release simulator build passed; four consecutive live NOAA quarter-hour records decoded with full coverage in the test viewport. A separate 19,200-pixel live sample matched the established web GRIB decoder byte-for-byte. Mock transport tests reject ignored ranges, wrong Content-Range and truncation. iPhone 17 Pro simulator playback displayed 00:00 and 00:15 forecast frames separately and returned to Latest radar. Finger-drag smoothness and active-storm visual acceptance still require physical-device testing. New deterministic index/decoder tests are included in native-model CI; live parity is opt-in via scripts/hrrr-subhourly-native-parity.mjs and NEARCAST_HRRR15_FIXTURE.

The default numeric MRMS/HRRR image path now uses a display-only port of the existing web raw-radar shader's eight reflectivity bands, zoom-dependent five-sample neighborhood treatment, smooth color transitions, street-level color tuning and opacity. This replaces the simpler CPU `resolved` palette used in build 108. Forecast baseline and radar-aligned forecast use the same renderer; provider tile fallbacks are unchanged. Xweather/StormScope is not involved.

The source texture and coverage mask remain immutable. Masked or missing center pixels remain transparent, missing neighbors do not enter the neighborhood average, and no rendered values feed motion estimation or forecast correction. Source timestamps, loading/generation guards, bounded caches and retained-frame presentation remain intact. Settled camera zoom is part of viewport identity and invalidates rendered caches; numeric image opacity is applied once, with provider-tile opacity unchanged. The legend uses the same renderer and zoom.

Validation: Release iPhone simulator build passed; presentation tests cover regional palette/opacity, heavy cores, masked holes, input immutability, street-level treatment, malformed masks/zoom and legend coverage. An optional synthetic visual fixture compares build-108 resolved rendering, new regional rendering and new street rendering (`NEARCAST_RENDER_FIXTURE=/tmp/nearcast-high-detail.ppm bash scripts/test-native-radar-presentation.sh`). This is not a live weather image or proof of extra source resolution.

Remaining visual gates: active-storm comparison on physical phones, street-scale source-resolution/overzoom acceptance, and continuous GPU styling during pinch. This implementation renders off-main into the existing bounded viewport images after camera changes; it does not yet port the full web raw-chunk GPU pipeline. TestFlight 109 carries this follow-up for phone testing once Apple processing finishes.

### Build 108 timeline polish

Release: commit `7ad157a`, TestFlight 0.1.0 (108), uploaded successfully September 18 at 23:37 CDT. Final portable/native-model preflight, signed archive, all-target archive validation and export/upload passed. Apple had accepted the package for processing; its build-list API had not indexed 108 at the immediate follow-up check. The existing upstream MapLibre missing-dSYM warning remains nonblocking. Release log: `/tmp/nearcast-testflight-108.log`.

Family feedback on 107 accepts the basic pan/zoom feel, but reports timeline flicker and excessive controls. This checkpoint combines real observed timestamps and advertised future model times into one time-proportional scrubber, with a default next-hour range, optional six-hour range, Now boundary marker, playback and Latest action. Six-hour accumulations remain a separate layer. No intermediate model frames are invented.

Numeric image requests retain the last complete georeferenced image and its displayed timestamp while the next frame loads; the pending target is separately labeled. MapLibre updates its resident image source rather than removing/recreating the weather layer on every frame. Forecast alignment is resolved before publishing a forecast, avoiding a second visible shift from baseline to corrected pixels. Provider-tile fallback behavior is unchanged.

The scrubber has one compact surface with inline source-info access and visible provider credits, not a separate attribution pill. Detailed source explanations, rain totals, refresh and zoom buttons move into Layers/Info. Recenter and location remain directly available. Radar-guided forecast can be disabled there; this is explicitly NOT a replacement for StormScope.

Verification: full regression suite passed before final copy/accessibility refinements; release simulator build passed. iPhone 17 Pro simulator verified 1h/6h selection, crossing into an actual next-day model frame, held-frame loading labels, and Latest returning to the exact observed timestamp. Additional integrated-timeline tests cover real-time snapping, six-hour bounds, one-hour bounds, empty sources and missing guidance gaps. No nearby storm echoes were available to claim live-storm visual acceptance. Final release preflight runs again before upload.

StormScope/lightning remains an open native integration gate below, as does genuine subhourly forecast parity. This checkpoint must not be described as finishing either.

Additional UI check: Pro Max portrait and both landscape orientations kept the compact controls inside safe areas, with the map still usable. Simulator restored to portrait. These layout checks do not establish physical-device frame-time performance.

1. Real-device finger pan/pinch/scrub, background/resume, accessibility text/VoiceOver, rotation, slow/offline recovery, memory and frame-time measurement on both required phones.
2. Live storm/transition acceptance and subhourly model path. The bounded exact-time compositor is implemented; it does not invent quarter-hour forecasts and is not full enhanced-map parity.
3. Native Storm Check/frame-aware Ask, complete fallback legends and remaining layer interactions. Existing full-map handoff stays available.
4. StormScope/lightning native SDK configuration, provider leases/budgets and rendering parity. The owner confirmed native iPhone use is included in the account; app-bundle credential configuration remains a separate check. No paid native session or account change has been activated here.
5. Global provider tile-memory/playback budget strategy; full global animation remains in the existing map.
6. Existing MapLibre device-archive metadata preparation and missing upstream dSYM caveat from build 106 still apply before another TestFlight upload.

No calendar permission, new notification policy, or plan ownership change is introduced. Location permission is requested only when the user explicitly taps the device-location control.

## Next family test round

- Enter via Native preview → Settings → Try native weather map; compare streets/aerial labels and radar/forecast times.
- Tap a saved marker. Center the map, then explicitly use the place for weather; confirm the header, time zone and forecast agree after closing/reopening.
- On first location use, test Allow Once and Don't Allow. Also background the app while locating. Neither path should trap the map or silently select a different weather place.
- Open a nearby warning outline and verify the correct bulletin, expiry and area; no-polygon bulletins must remain accessible in the selected-place section.
- Pan quickly during loading, switch sources, then background/resume after five minutes. Old viewport images/outlines must not reappear as current.
- During active weather, compare the radar→forecast handoff. Record location, source time, model time and a short screen recording if motion looks wrong. A plain "Model forecast" label is expected when evidence is insufficient.
- On physical iPhone 17 Pro and Pro Max, check finger pan/pinch/scrub, larger text, VoiceOver and landscape. Simulator button tests cannot substitute for these checks.
