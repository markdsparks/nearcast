# Native migration baseline and feasibility record

Date: September 18, 2026. Source baseline: web **3.0.408**, native **100**, plan commit `2a24eee`. This is a **source/contract audit**, not a declaration of phase acceptance. Follow [the migration plan](native-migration-plan.md) for ownership and promotion gates.

## Evidence and open gates

| Check | Result |
| --- | --- |
| Installed build tools | `xcodebuild -version`: **Xcode 27.0, 27A266a** |
| Family targets | iPhone 17 Pro and 17 Pro Max; latest installed iOS 27. Exact OS builds still to record |
| Watch target | Apple Watch Ultra 2 on watchOS 27.0, verified in Device Hub; exact build and test pairing still to record |
| Cold/cached launch, place switch, detail-open, scroll/scrub measurements | **NOT RUN on family hardware** |
| Native radar dependency integration and hardware proof | **NOT RUN**; documentation-level compatibility only |
| Current provider subscription/native credential authorization | **NOT VERIFIED**; no paid session, account change, SDK installation, or provider change performed by this audit |
| Physical-device AI, notification, Watch and permission regressions | **NOT RUN** |

Phase 0 remains open until its physical baseline, migration recovery contracts and native radar spike are completed. Do not use an iOS Simulator or portable-test pass as evidence of hardware interaction or delivery quality.

## Product parity inventory

All capabilities below are **retain/replace**, not retirement proposals. An opt-in Phase 1 preview may hand unmigrated destinations to existing Nearcast explicitly. Presence in this inventory means the source exposes the capability, not that it is always enabled or available for every place.

| Existing destination/control | Current owner/evidence | Native disposition |
| --- | --- | --- |
| Today: selected place, temperature, condition, high/low, contextual outlook, meaningful change, radar/current evidence | `app.js`, `index.html`; `weatherTruth`, outlook, receipt builders | Phase 1 replaces interface; preserve qualified weather evidence and source generation time |
| Home hourly trend: Temp, Feels, Rain, Wind, UV; Hourly/15 min | `app.js` hourly hero; `hasQuarterHourlyData`, `quarterHourDisplayCode` | Phase 1; first-look default is Hourly + Temperature, not a restored stale lens |
| Full Hourly and selected day: outlook, metrics, expanded hourly evidence, graphs, sun interaction, 15-minute coverage | `index.html` day/graph sheets, `app.js` hourly/day handlers | Phase 1 main journey; unsupported detail routes remain explicit handoffs until Phase 2 |
| Daily: seven-day list and expandable days 8–14 | `index.html` daily and extended-daily sections | Phase 1; preserve local civil dates and lower-confidence extended framing |
| Weather details: feels, rain, wind, AQI, sun/daylight, humidity/dew point, visibility, UV | `app.js: buildGlanceDetail` and its builders | Phase 2; persistent discoverability, selected place/time, existing confidence explanations |
| Official alerts and forecast/source receipt | `openAlertSheet`, receipt sheet, map alert intent | Phase 2 full presentation; legacy remains exact destination before then |
| Family places, search, current-location follow, local time, around-us cards | `app.js` place/search/current-location handlers; `placeSheet` | Phase 1 read-only saved-place selection; Phase 2 owns edits/search and preference handover |
| Navigation: Today, Hourly, Ask, Map, Plans; floating hide/settle behavior, back/close, detail return position | `index.html` bottom navigation; web sheet/navigation handlers | Native route coordinator; no browser-overlay state for migrated routes |
| Plans: Upcoming agenda, active-first next-up, manual create/edit/delete, multi-day span, weekly routine, deterministic verdict, material changes, hourly evidence | `planner.js`, memory sheets | Phase 4; exact IDs, spans, recurrence, reviewed-change state and explicit watches survive |
| Ask: transcript/context, typed skills, follow-ups, cancellation, voice press/release and tap/edit, level waveform | `planner.js`; native Operon/language/speech bridge | Phase 4 UI/actions; retain native engines, remove JS action dependency |
| Map preview/full screen; all layers and controls listed below | `map.js`, `raw-map-runtime.js`, `radar-seam-engine.js` | Phase 3 after renderer proof; do not equate one raster overlay with parity |
| Appearance, units, Auto/12/24 clock, manual refresh, Living sky and optional motion | `index.html` menu; `app.js` preference keys | Phase 2 ownership; Phase 1 reads applicable display preferences without overwriting them |
| Weather/privacy explanation, installation help, debug-only map/sky/Live Activity controls | `index.html` menu and sheets | Privacy explanation retained; web installation help remains web-specific. Keep diagnostics separate from family UI, and explicitly review diagnostic parity rather than exposing all controls |
| Widget, Watch/complication, Live Activity and notification entry | Swift targets and `NativeNotificationRouter`/`NearcastWebModel` | Keep current single publication/routing path during preview; regression-test throughout |

Ambient conditions, weather icons and day/night semantics are parity requirements, not post-migration decoration. Preserve readability under long place names, large text, dark mode and reduced motion.

## Ownership and architecture decisions

**Retain the weather service.** `/api/forecast` already resolves calibration and source metadata for native consumers. See [shared forecast contract](shared-forecast.md). Decode its full daily and six-hour 15-minute coverage rather than stretching `NearcastWidgetSnapshot` into the app database. Never apply calibration twice. Preserve `generatedAt` on cache reads and failed refreshes. AQI, official alerts and local radar evidence are separate inputs; absent inputs mean unavailable, not agreement or zero.

**Native app UI and actions, with one typed route.** A route must carry destination, selected-place identity/coordinates, place time zone, civil day, exact instant or interval, and plan/alert identity when applicable. Do not infer the requested day from the phone's time zone or from whichever screen last loaded. Map and plan handoffs need their exact parameters, not a generic `open map`/`open plans` instruction. The current router queues one notification before attaching `NearcastWebModel`, then navigates the web page; this is not yet an independent native action service.

**Keep Phase 1 session-only.** Existing web records and publishers remain authoritative. Native may read an allowlisted preference/place export and maintain an independent refetchable weather cache. It must not save a new active place to the widget store, sync Watch, register/unregister watches or update Live Activities merely because a tester viewed another place. Explicit handoff exits preview into normal legacy behavior; simply dismissing preview preserves the old authoritative state.

**Durable-store target for later ownership handover:** a versioned `Codable` user-record envelope in Application Support, serialized by one native store actor. Write a complete validated envelope using same-volume atomic replacement; retain a validated prior generation for recovery. Envelope fields must include schema and minimum-reader/writer versions, monotonically advancing revision, stable record IDs, deletion tombstones, per-domain ownership and migration receipts. Keep forecast cache disposable and separate. App Group snapshots are derived publications, not a second writable database. Secrets remain in their existing secure paths and never enter export logs. This design is selected for the small, local, account-free dataset; implementation is **not complete** until duplicate-import, interrupted-write, read-back, recovery and bridge-version tests pass. Atomic file replacement alone does not make a multi-file migration transactional.

**Do not port every legacy shortcut as truth.** Capture matched-input fixtures from pure weather rules, including qualified thunder, local observation adjustments, missing/stale sources, alert geometry, continuous spans and routine rollover. Preserve intended semantics while recording known defects separately. Notification/Live Activity weather evaluation is still separate from the shared forecast endpoint and is not made consistent merely by introducing native screens.

### Notification hydration: launch-blocking risk

`planner.js: syncPlanWatchNotificationSubscription` currently unregisters when notifications are disabled or when its local enabled-plan and enabled-place lists are both empty. An incomplete imported/fallback view must therefore **not execute sync as an empty selection**.

Before any preview distribution, test legacy startup, return/handoff and interrupted hydration with an existing valid subscription. Register, renew and unregister require `hydrated && ownershipVerified`, not a default empty array. Unknown state must be inert. Preserve one publisher and existing channel/subscription references; no testing path may create duplicate targets or turn visibility into consent. Do not log tokens or identifiers in test reports.

## Radar: current scope and native feasibility

Current code is authoritative here. `docs/radar-architecture.md` contains older experimental direction and is not evidence that generated regional MRMS packs are the production default.

| Source/layer or control | Existing implementation | Native feasibility / remaining work |
| --- | --- | --- |
| Streets/labels | CARTO raster tiles, key obtained via `/api/map/config`, OSM attribution | Native raster source is plausible; validate existing key restrictions, attribution and caching rights without changing the account |
| Aerial | USGS National Map imagery, capped source zoom, CARTO labels | Raster mapping; preserve US-specific coverage/label semantics |
| Satellite | NASA GIBS MODIS Aqua/Terra true color, recent available date selection | Raster mapping; preserve imagery date, availability probes and precipitation suppression |
| Standard observed radar | NOAA/NWS MRMS/RIDGE2 WMS first, RainViewer global/failure fallback | WMS template/bounding-box and XYZ raster paths are plausible; port source selection, valid time, delay thresholds and fallback evidence |
| Standard forecast fallback | NOAA nowCOAST/NDFD six-hour precipitation amount WMS, displayed through time selection | Do not describe an accumulation image as instant radar. Preserve source and valid-time semantics; renderer change does not create finer temporal data |
| Immersive enhanced observed/forecast | Raw mode defaults to `both` when eligible; direct MRMS + HRRR/subhourly adapters, viewport numeric textures, seam engine, motion/blended guidance | **Major port**, not an SDK drop-in: browser workers, Blob URLs and custom WebGL rendering need native data/texture ownership and matched seam fixtures |
| Generated MRMS packs/encoded tiles | Explicit experimental preference; archived/spike infrastructure remains available | Not a production dependency or default migration requirement. Keep separate from shipping raw mode; do not revive generation queues automatically |
| Official alert polygons, selected place/device location, saved-place markers | MapLibre GeoJSON/markers and location opt-in | Native shape sources/annotations are plausible; retain geometry, alert IDs, privacy and selected-place/location distinction |
| StormScope and recent lightning | Optional Xweather MapsGL, explicit activation, leased/budget-guarded sessions, radar styles, independent requested lightning | Native Apple SDK documents a MapLibre adapter; compatibility looks feasible but layer/configuration/lease parity and native credential restrictions are **unverified** |
| Timeline and interactions | Observed/forecast eras, timestamps/relative time, Now jump, play/pause, loading/buffering, source handoff, stable attribution popover, recenter, pan/zoom, Storm Check, contextual Ask | Rebuild controller/UI; preserve current rules and frame selection across pan/rotate/background. Gesture and memory behavior require hardware testing |

**Renderer candidate:** MapLibre Native for iOS, bridged into SwiftUI where necessary. Its documented raster tile/image and GeoJSON sources cover much of the existing substrate. However native style support excludes web canvas/video sources, so our numeric weather path is not directly portable. [Raster source API](https://maplibre.org/maplibre-native/ios/latest/documentation/maplibre/mlnrastertilesource/), [native style/source support](https://maplibre.org/maplibre-native/ios/latest/documentation/maplibre-native-for-ios/for_style_authors/).

**StormScope feasibility evidence:** Xweather's Apple setup documentation lists MapLibre Native iOS **6.18.0+**, `MapLibreMapController` and a MapLibre-specific package channel. The Apple SDK documentation lists iOS 16+ and an active account requirement. This supports a candidate architecture, not a tested dependency combination or a promise that our current account is licensed/configured identically. No native paid session was started. [Setup/compatibility](https://www.xweather.com/docs/mapsgl-apple-sdk/getting-started), [Apple SDK overview](https://www.xweather.com/docs/mapsgl-apple-sdk).

### Smallest next radar proof — NOT RUN

1. In an isolated native spike, pin a reviewed MapLibre release compatible with the existing deployment floor. Do not add Xweather or activate paid layers for this first proof.
2. Use one already-supported observed raster frame and one NOAA forecast frame, with their actual source/valid timestamps and attribution. No new provider, service endpoint or tile-generation pipeline. Start from a deterministic fixture manifest, then verify public live metadata separately.
3. Show the selected place, pan/zoom, a two-frame scrub control and truthful observed/forecast labeling. Verify projected WMS tile bounds, alignment and native raster opacity/fade behavior. Treat the time jump as a source transition, not physical storm motion.
4. On both family iPhones, measure first visible tile, scrub latency, memory peak, pan responsiveness, slow/offline recovery and background/resume. Capture exact device/OS, frame times and network conditions without private place names.
5. Separately prove one numeric MRMS texture + one HRRR/seam output against synthetic fixtures before claiming enhanced-map parity. Separately validate StormScope native adapter, authorization and budget/lease guards before any paid test is requested.

A successful raster spike settles only baseline rendering. It does not settle HRRR/MRMS decoding, encoded texture rendering, temporal seam accuracy, lightning, Storm Check or provider rights.

## Must-pass regression cases

- **Time/interval:** Today near midnight in Illinois versus a European selected place; daylight-saving skipped/repeated hours; Auto/12/24 clocks; quarter-hour coverage start/end and missing values; select 15 min then another day outside coverage without manufacturing readings.
- **Forecast identity:** fast place changes with responses arriving out of order; unit change during refresh; selected day's high/low versus widget current-day subset; provenance/calibration applied once; current temperature distinct from feels-like.
- **Weather meaning:** qualified possible thunder versus observed lightning; dry/missing precipitation; snow/ice; cloud and day/night icon; supplemental evidence arriving later; low-confidence extended days; official alerts outside the selected location/window.
- **Navigation:** Today → Hourly → tomorrow → exact evening → back; retain place/date/scroll context; switch metric repeatedly; vertical scrolling beginning on a chart/control; return from a nested plan hourly sheet without dismissing the plan; precise map time and alert routes.
- **Cold entry:** widget, Watch, Live Activity, and APNs links before app data is loaded; multiple delayed callbacks; missing/deleted plan; wrong saved-place name match; routes with `memoryId`/`planId`, `placeId`, target/detail/signal/timeScope/mode/source and date/window parameters. Missing requested records must be explained, never replaced silently with Today.
- **Permissions/publication:** preview alternate place does not change widget/Watch state; no APNs registration/renewal/unregistration from unhydrated records; permission denial and opt-out remain unchanged; one authoritative publisher after handoff; current-location permission is not requested just to preview saved weather.
- **Persistence:** interrupted export/import/atomic commit; import twice; malformed/older schema; delete/edit then legacy fallback/relaunch; incompatible live-site bridge version; recovery preserves newest accepted records and never restores a deleted or unwatched target.
- **Plans:** active-first order, later material change, seven-day boundary, weekly rollover after window end, continuous Tuesday–Thursday span rendered once, exact watch target IDs and opt-outs.
- **Visual/accessibility:** both phone widths, longest place/condition text, large text/VoiceOver, light/dark, reduced motion, selected metric highlight, chart non-drag access, safe areas and tab-bar hide/settle. Record measurements separately from subjective family preference.
- **Watch/system:** Ultra 2 stale/fresh/offline display, units/clock/location, independent refresh and exact destination; no old countdown presented as newly refreshed; prior channels intact after preview startup/dismissal.

## Physical baseline worksheet — all pending

Use the same selected test location and network for legacy/native comparisons, at least five repetitions per scenario; record median and slowest observed time, not an unsupported percentile. Keep measurements local and anonymized.

| Scenario | iPhone 17 Pro | iPhone 17 Pro Max | Capture |
| --- | --- | --- | --- |
| Cold process launch, no forecast cache | NOT RUN | NOT RUN | Launch → first useful current/hourly weather; network/time |
| Cold process launch, valid cache | NOT RUN | NOT RUN | Launch → cached weather; truthful source age |
| Saved-place switch | NOT RUN | NOT RUN | Tap → correct place and complete weather, out-of-order safety |
| Hourly/day open and back | NOT RUN | NOT RUN | Tap → interactive content; retained position |
| Chart/list scrolling, radar scrubbing | NOT RUN | NOT RUN | Visible stalls, gesture conflicts, memory/frame diagnostics |
| Offline cached/cold and reconnect | NOT RUN | NOT RUN | Honest status, retry, no timestamp renewal on failure |
| Background/deep-link/Watch delivery | NOT RUN | NOT RUN | Exact target, no unwanted publisher changes; Watch OS/pairing |

Record build number, OS build, accessibility settings, warm/cold definition and known limitations with every result. Promote no phase based solely on this document.
