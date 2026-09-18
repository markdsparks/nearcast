# Nearcast native migration — phased delivery and family testing

Created September 18, 2026. Status: **plan approved in direction; implementation and device gates not yet complete**.

Baseline to preserve: web **3.0.408**, native **build 100**, repository commit `ccfbd80`. These identify the current implementation, not a declaration that every existing behavior is correct.

## Decision and outcome

Make the main iPhone experience fully native, using SwiftUI with UIKit/native rendering where appropriate. Preserve Nearcast's product identity, weather services, evidence rules, privacy boundaries, and existing platform investments. Replace browser-owned app state and actions as well as the interface. The final app must not need a loaded website or hidden web view to show weather, operate plans, or execute Ask actions.

The family should open Nearcast, understand now and what comes next, and reach hourly, daily, radar, or a detail without losing their place. A native implementation is only an improvement if this becomes measurably easier and more dependable.

This plan supersedes the sequencing in `roadmap.md` and the original web-first iteration policy in `native/ios/README.md`. Those documents remain useful historical/operational references. Urgent production fixes continue; major new web-only interface features pause during migration. No indefinite feature-parity commitment for two independently evolving frontends.

## Test devices and compatibility

Primary family acceptance devices, confirmed by the user:

- iPhone 17 Pro, latest installed iOS 27.
- iPhone 17 Pro Max, latest installed iOS 27.
- Apple Watch Ultra 2; record the actual watchOS version and pairing at kickoff rather than assuming it.

Record exact OS build numbers for each test round. Physical-device results are required for touch, performance, Apple Intelligence, permissions, background behavior, and Watch delivery. Simulator and fixture passes do not satisfy those gates.

Keep the current iOS 17 / watchOS 10 deployment floors unless separately approved. Compile and spot-check older fallback paths in Simulator where available. New OS-only features require availability checks. Primary-family testing on iOS 27 must not be described as exhaustive validation of older devices. No new Android work is included; the existing website remains available and maintained for critical fixes.

## What stays, what changes

| Retain or adapt | Replace or extract |
| --- | --- |
| Existing `/api/forecast`, weather providers, radar endpoints, notification backend | Main web screens and browser-driven navigation |
| Native forecast decoding, widgets, Watch, Live Activities, speech, Foundation Models adapter, Operon driver | Browser-owned selected place/date/window, saved records, and product action handlers |
| Tested weather rules, source attribution, fixture cases, and exact-route contracts | Rules embedded in screen code, using matched-input tests to preserve intended behavior |
| Existing app identity, App Groups, permissions, APNs channels | Assumption that a widget snapshot is the complete app database |

Do not change providers or rewrite forecast science to change UI. Preserve local plan evaluation and private AI boundaries; do not move plan text or family records to the server for implementation convenience. Native UI does not by itself fix inaccurate upstream weather or model reasoning.

## Architecture and transition rules

1. **One weather repository:** native clients request the existing shared service, retain source generation times, and cache forecast payloads by coordinates, units, and valid horizon. Consume already calibrated values without applying calibration a second time. A refresh failure does not make old data new. Reuse compatible native code, but extend it for full daily and 15-minute payloads rather than treating the compact widget snapshot as the full forecast.
2. **One route coordinator:** represent place, civil date, exact time/window, plan ID, and destination explicitly. Preserve navigation and scroll context. Route unsupported destinations to the existing surface intentionally during preview. Cold-start links wait for the exact required data; they must not silently fall back to an unrelated place or Today.
3. **One writer per data domain:** ownership changes by phase. The old web UI becomes a client of native-owned domains through a small compatibility adapter. No uncoordinated two-way synchronization between independent mutable stores. Version the host/legacy bridge handshake: a newer live website must not silently invalidate an installed build's fallback contract. Unsupported combinations fail closed for writes and offer a compatible recovery path.
4. **Native actions independent of screens:** AI, Shortcuts, notifications, and taps call the same validated actions. They must not require rendering a web page to resolve a place or open a day. Preserve cancellation, explicit confirmations, and no replay after a partially completed mutation.
5. **Versioned native storage:** choose and document the durable store in Phase 0. Require atomic commits, schema versioning, stable identifiers, interrupted-write recovery, and local migration receipts. Forecast caches are separate from user records. No account or cloud sync is introduced.
6. **Keep intentional design:** stable Home hierarchy, readable native charts and controls, accessible weather semantics, and Nearcast's visual identity. Appearance and ambient-sky work have an explicit parity inventory; they are not forgotten during functional migration.
7. **No permanent browser escape hatch:** temporarily retained web surfaces have a named retirement phase. A hidden web runtime for AI or persistence does not count as completing the native migration.

### Ownership and rollback

| Stage | Source of truth | Fallback behavior |
| --- | --- | --- |
| Phase 0 | Existing app | No production changes |
| Phase 1 preview | Existing app owns durable records and all publishers; native owns only its temporary forecast/navigation session | The preview itself changes no durable records or publications; an explicit handoff exits preview into ordinary legacy behavior |
| Phase 2–3 | Native owns places/settings after verified handover; legacy owns plans/watch selections | Legacy place/settings actions use the native store through the adapter; remaining legacy domains retain one writer |
| Phase 4 onward | Native owns migrated user records, product actions, and publication coordination | Compatibility UI reads the same authoritative records; it cannot restore an old copy |
| Phase 6 | Native only for primary app journeys | Recovery uses a compatible native build; browser UI is no longer a runtime dependency |

Before enabling writes in any migrated domain:

- Export allowlisted, versioned records locally through the trusted bridge, validate them, and stage an import; never dump all browser storage. Preserve original IDs, continuous spans, routines, units, clock settings, explicit watch selections, and subscription/channel references. Include revision/ownership markers and deletion tombstones wherever mirrored compatibility state could otherwise resurrect deleted records. Do not copy secrets into logs or reports.
- Make import idempotent and transactional: interrupt/restart at each stage, import twice, and verify no duplication or partial ownership change. Validate malformed/older records without silently discarding them.
- Verify read-back before switching ownership. Retain a protected local source export until migration acceptance; caches can be refetched. Do not clear browser storage at cutover.
- Route both new and compatibility UI writes to the designated owner. Reject or make a fallback read-only if its adapter cannot guarantee current data. Unchanged old web code is not a safe writer after handover.
- Test deletions, edits, and notification opt-outs across fallback/relaunch. Deleted plans must not reappear; selected watches must not multiply or become enabled by import.
- Define rollback as a **compatible forward build or compatible UI fallback**, not installation of build 100 or restoration of the original export over newer records. Record a minimum compatible schema reader/writer version. Destructive restoration requires separate user approval.
- Keep one notification-registration and snapshot-publication path. Read-only previews, mirrored records, and tests must not independently register watches or publish conflicting widget/Watch state.
- Gate all register/renew/unregister operations on complete hydration and verified ownership. The current legacy synchronizer can unregister a channel when its local view says there are no watched targets; an incompletely loaded fallback must mean **unknown**, never an empty selection or opt-out. Test fallback launch and interrupted handover while a valid subscription exists before shipping even the first preview.

## Phase overview

Checkpoint letters are planning labels, not reserved build numbers. Assign actual build numbers at release time across all targets.

| Phase | Family-visible result | Checkpoint |
| --- | --- | --- |
| 0 — Baseline and contracts | Existing app stays unchanged | Internal readiness review |
| 1 — Native everyday weather | Opt-in Today → Hourly/15-minute → selected day → back | TestFlight A |
| 2 — Complete daily utility | Places, settings, AQI, sun, alerts, other details | TestFlight B |
| 3 — Native radar | Native map, playback, scrubber, and required layers | TestFlight C |
| 4 — Plans and Ask | Existing plans and conversational actions work natively | TestFlight D |
| 5 — Connected experience | Consistent system surfaces and narrow App Shortcuts | TestFlight E |
| 6 — Native default | The normal installed app no longer needs the web runtime | TestFlight F and final family trial |

Each family checkpoint pauses promotion/default cutover until the user reports results. Independent work on later components may proceed, but an untested phase is not marked accepted or used to justify removing its fallback. A failed gate produces a corrective build for the same checkpoint, not silent advancement.

## Phase 0 — Baseline, boundaries, and early risk checks

**Deliverables**

- Inventory every shipped destination, control, setting, notification route, and map layer. Mark each retain, replace, or explicitly proposed for retirement; user approval is required to remove existing capability.
- Record current launch-to-useful-weather, place-switch and detail-open latency, scroll/scrub responsiveness, and failure recovery on both phones. Separate cold/cached/network launch; record conditions, medians, and slower cases. Use local diagnostics, not personal-data analytics.
- Capture synthetic/anonymized weather fixtures covering clear, cloud, rain, snow/ice, heat, thunder possibility versus confirmed evidence, alerts, missing/stale data, 15-minute limits, and remote time zones. Record known current defects separately; match intended weather contracts rather than blindly reproduce errors.
- Specify native forecast/place/day/window/route and persistence contracts. Decide fallback behavior when the shared service fails: preserve valid cached data, and deliberately assess the current Home-only direct-provider fallback instead of dropping it accidentally or creating divergent native weather.
- Prove a minimal native radar path with one observed frame, one forecast frame, timestamps, attribution, and pan/zoom on hardware. Audit current layer/vendor/native-SDK compatibility, licensing, and operational requirements before promising complete map parity. No provider purchase or architecture switch is authorized by this spike.
- Verify build tools for the chosen SDK, existing CI, and archive/signing workflow. Do not represent current Xcode 26.6 compilation as adoption of iOS 27-only APIs.

**Exit gate:** reviewed parity inventory, ownership/rollback contract, repeatable baseline, chosen storage strategy, test fixtures, and documented radar feasibility. Any missing native layer support becomes an explicit decision before Phase 3. No TestFlight or app behavior changes are necessary just to publish this plan.

## Phase 1 — First native weather journey

**Build**

- Add native forecast repository/cache, typed route coordinator, and read-only import of existing saved places/preferences for preview. No new authoritative user-data writes or external publishers.
- Build native Now, contextual outlook, hourly trend and metric selection, daily list, selected-day outlook, and detailed hourly/15-minute exploration. Keep coverage limits visible and never fabricate 15-minute data from unsupported hours.
- Preserve clear entry/back behavior, selected place/date, units, local time, and scroll position. Support light/dark, large text, reduced motion, loading, empty, stale, offline, and retry states from the start.
- Provide an explicit TestFlight preview entry and return to the existing app. For unmigrated Map, Plans, Ask, or detail destinations, offer a clear **Open in existing Nearcast** handoff that exits the read-only preview before executing the exact legacy route. From that point, user actions have ordinary legacy behavior: selecting the requested place may publish its weather, and explicit plan actions may save records. Do not describe those actions as read-only. Simply returning from preview without a destination handoff preserves the prior authoritative location and records. Mark the temporary scope in test notes, not with extra permanent Home clutter.
- Implement the route dispatcher and compatibility tests now. Existing widget, Watch, and notification behavior stays on its current publication path during the read-only preview.

**TestFlight A — first native comparison**

Family tasks: check now and the next few hours; switch Temp/Feels/Rain/Wind/UV; use 15-minute coverage; open tomorrow then its evening hours; return to Today; switch between two saved places; force-close, reopen, and try airplane mode after a successful load. Compare the two phone sizes and large text.

**Exit gate:** displayed values, conditions/icons, dates, and units match canonical fixtures; no place/date races; no clipping, stuck selection, or scroll traps in the test suite. Cached launch displays useful weather with truthful age; a cold offline launch shows unavailable rather than invented values. Measure responsiveness against Phase 0. Family explicitly accepts the native journey before it becomes default.

## Phase 2 — Everyday details, places, and settings

**Build**

- Native family places/search/current location and settings; migrate ownership of saved places and preferences only after the write/rollback gate above passes.
- Permanent access to air quality, sunrise/sunset and the interactive sun visual, wind/gusts, humidity/dew point, visibility, UV, and available precipitation details. Preserve source confidence explainers behind the relevant tap rather than adding diagnostic clutter.
- Native official-alert presentation and exact detail routes. Keep geographic coverage and missing/future-day data honest; do not reuse today's AQI as tomorrow's reading.
- Adapt the existing web UI to native-owned places/preferences. Plan records and explicit notification selections remain legacy-owned until Phase 4. A saved-place change that affects an existing watch must use the existing validated watch workflow or route to its owner; it must not silently unsubscribe or broaden targets.

**TestFlight B — daily replacement trial**

Family tasks: find AQI and sunset without instructions; check wind and tomorrow's weather; add/rename/delete a test place; change 12/24-hour clock and units; inspect a European saved place; switch between preview and compatibility UI and relaunch. Confirm widget/Watch location, units, and clock remain coherent after committed changes.

**Exit gate:** everyday lookup tasks complete without coaching (target under ten seconds, measured); settings and places survive interrupted upgrade/relaunch/fallback; no lost or resurrected records. Exact alert routes and existing notification selections remain intact.

## Phase 3 — Native radar and weather map

**Build**

- Implement native rendering and weather-layer integration chosen from Phase 0 evidence. Preserve frame timestamps, buffering, source handoff, coverage, scale/legend, attribution, and stale/unavailable handling.
- Rebuild timeline/scrubber, play/pause, observed-versus-forecast distinction, recentering, and applicable existing layer controls. Native map preview and full map share the same interpretation and destination.
- Port required timeline/source-transition rules with matched-input fixtures. Preserve the selected frame while panning/resizing/backgrounding where valid. Never hide a real data gap with misleading motion.
- Resolve all currently shipped layers in the inventory, including satellite/aerial/optional layers and StormScope where exposed. A basemap plus rain is not automatically full parity. Any deliberate retirement needs user agreement.

**TestFlight C — map session**

Family tasks: open from Home, play and scrub through the radar/forecast boundary, zoom/pan, return to your place, inspect attribution, rotate, background/resume, and repeat under slow connectivity. Check active-weather and dry conditions with fixtures as well as available live weather.

**Exit gate:** exact timestamp and source labeling, no wrong-place recentering, no layout jumps or touch conflicts, stable loading/failure states, and acceptable measured memory/frame behavior on both phones. Required layers pass parity; existing web radar remains available until this checkpoint is accepted.

## Phase 4 — Native Plans and Ask

**Build**

- Native Upcoming agenda, next-up presentation, creation/editing, deterministic evaluation, hourly evidence, and existing watch controls. Preserve active-first ordering, continuous multi-day spans, weekly rollover, and exact notification targets.
- Perform the verified plan/watch-state ownership handover. Preserve plan IDs, receipts and meaningful-change state where applicable, subscriptions, and explicit opt-outs; do not create a new delivery channel merely because the UI changed.
- Move skill/session/context handlers behind native actions. Reuse Foundation Models, Operon, and speech; remove dependence on JS `prepare_skill`/`invoke_skill` callbacks for migrated actions. Share context with native navigation rather than scrape displayed text.
- Native Ask transcript/composer, current microphone interaction modes, waveform feedback, cancellation, and honest failure states. Preserve deterministic fallbacks and mutation confirmation; no new cloud inference.

**TestFlight D — plans and conversations**

Family tasks: inspect an existing plan, create/edit/delete a test plan, inspect a Tuesday-to-Thursday camp, check routine rollover, open its exact hourly evidence, and verify watch opt-outs. Run the Hardin Kentucky → Tuesday hourly → Wednesday follow-up and the full existing `docs/ai-device-release-gate.md` on actual supported phones.

**Exit gate:** no lost/duplicate plans or subscriptions, no unrequested watch or permission prompt, no wrong-state/date action, and no browser dependency in native AI actions. Cancelled/partially completed requests do not replay mutations. Compatibility fallback reflects the same new records and deletions.

## Phase 5 — Connected Apple experience

Compatibility is required from Phase 1 onward. This phase improves integration; it is not the first time we test it.

**Build**

- Consolidate the shared native state/action layer used by widgets, Watch, Live Activities, notification routes, and the main app, preserving app-extension limits and independent refresh behavior.
- Close stale-countdown/expiry gaps in every Live Activity presentation. Audit differences between the shared forecast service and the existing notification/Live Activity evaluators; move data access only with matched-input tests and unchanged delivery rules.
- Add the narrow native App Shortcuts entry points (open a saved place, open plans, read/check an existing plan). No mutation shortcuts or claim to replace Siri's default weather provider. Gate capabilities by actual availability.
- Polish existing widget/Watch readability and appearance modes. Configurable extra widgets or additional watch features are optional follow-ons, not reasons to delay native cutover.

**TestFlight E — phone closed**

Family tasks: inspect Watch and widgets with the phone app closed, open exact hourly/plan/alert destinations from cold start, verify clock/place changes, use supported shortcuts, and inspect an explicitly started Live Activity through stale/end states. Delivery canaries use the existing test workflow and selected targets only; they must not alert the entire family unexpectedly.

**Exit gate:** consistent place/time/units/evidence, no stale authoritative countdown, and exact cold/warm links. Record actual Watch refresh behavior without promising a fixed OS background cadence. Shortcuts work without requiring the web screen.

## Phase 6 — Native default and retirement

**Build and release**

- Make the native experience default only after prior checkpoint acceptance. Complete the appearance/ambient-sky inventory and any approved accessibility/performance refinements without sacrificing input responsiveness.
- Run verified upgrade scenarios from build 100 and every transitional store schema. Keep the same app identity/App Groups and preserve user records. Retain the local migration export until explicit cleanup criteria are satisfied.
- Remove primary-app WebView boot, JS-dependent product actions, and obsolete compatibility writers once no supported route depends on them. External links/help may use a browser; core weather, radar, plans, and Ask may not.
- Maintain the existing website as a separate client of retained services, not the installed app's runtime. Preserve a documented compatible forward-recovery build path.

**TestFlight F — native default, one-week family trial**

Use Nearcast normally on both phones and Watch. Whenever someone opens another weather app, record the question they could not answer or trust, and classify it as missing information, findability, trust, or speed. Keep personal examples local.

**Final acceptance:** every required inventory item implemented or explicitly approved for retirement; no open blocking defects; all data/notification/route gates pass; the family accepts the everyday experience. Confirm that the installed UI and cached weather can launch without loading the website. Fresh network weather still requires the retained data services.

## Checkpoint release protocol

Every checkpoint includes:

1. Portable checks (`scripts/nearcast-ci.sh portable`), native shared-model checks (`scripts/nearcast-ci.sh native-model`), and new Swift unit/UI tests covering that phase. Port relevant fixtures from the existing weather, day/hourly, plan, gesture, and radar suites. Static source assertions alone do not prove native behavior.
2. Build all phone/widget/Watch/complication targets and validate the signed archive using the existing release workflow. Preserve clean-commit/build traceability. Passing compilation does not mean physical acceptance.
3. A test note listing exact build/commit, native versus legacy scope, three to six family tasks, known limitations, and the safe return path. No checkpoint label implies an already uploaded build.
4. A small local result record: device/OS, task, expected/actual outcome, timing where useful, screenshot if needed, severity, and pass/fail/not tested. Never commit real family coordinates, plan text, notification tokens, or raw private conversations to a fixture/report.
5. Explicit user feedback before promotion. Stop for data loss, unintended notification changes, wrong-place/date actions, invented or stale-as-current weather, crashes, or blocked primary navigation. Correctness blockers have zero tolerance in the acceptance suite; performance/accessibility regressions require investigation, not a blanket waiver because the UI is native.

## First implementation work package

This is the next engineering work, not work completed by writing this plan:

- [ ] Complete Phase 0 parity/ownership inventory and physical baseline; record Watch OS and target SDK readiness.
- [ ] Specify native route, forecast, cache, and durable-store contracts with fixture tests and the rollback boundary.
- [ ] Run the early native radar feasibility check and record unsupported layers before choosing a renderer.
- [x] Add the read-only native preview entry, native weather repository, and exact-route coordinator (engineering implementation; acceptance tracked separately).
- [ ] Build the complete Phase 1 Today/hourly/day journey, including 15-minute coverage and offline/stale states.
- [ ] Run technical gates; produce TestFlight A and its family test note.
- [ ] Wait for family results, fix issues, and record acceptance before default promotion.

Estimate the remaining phases after Phase 1 measures actual porting work and Phase 0 resolves map risks. Do not assign speculative delivery dates or preallocate TestFlight build numbers.

## September 18 engineering update

Native preview builds 101 and 102 implement and refine the first read-only journey; family acceptance and physical gates remain open. [Build 103](native-essentials-testflight-103.md) adds the read-only everyday details/alerts portion of Phase 2 while that testing continues. Places/settings ownership has **not** moved. The [isolated native radar proof](native-radar-substrate-proof.md) establishes a bounded raster feasibility artifact, not full radar parity or a renderer decision. None of these changes promotes the preview to native default.

## Out of scope

No new weather subscription/provider, accounts, household synchronization, calendar access, location sharing, background permission, notification policy, PCC/cloud inference, or custom forecasting model. No broad feature redesign during the migration. New iOS capabilities can be adopted when they support a named phase and preserve older-system fallbacks; they are not a reason to expand the project automatically.
