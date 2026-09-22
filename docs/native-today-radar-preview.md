# Native Today radar preview

## Experience

Today includes an immersive radar preview immediately after the hourly outlook and before the daily outlook. The map fills the entire 200-point rounded preview, without header/footer panels or an expand control. Small freshness and required attribution text overlays the image. The whole map is an accessible button with pressed feedback and a selection haptic.

Opening it passes the selected place, center, zoom, source time, and the geographically bounded weather image into the native map. The taller interactive map may still need additional north/south coverage; the landscape image is never stretched to pretend it covers the portrait viewport. A stale or wrong-place handoff is rejected. The ordinary Map tab retains its normal behavior.

There is no miniature timeline, autoplay, precipitation check, or second persistent map engine on Today. Unavailable and delayed data are explicit; absence of data is never described as clear weather.

## Performance and ownership

- Actual scroll-viewport intersection, active scene, uncovered Today view, and settled scrolling gate snapshot work. Work is cancelled when those conditions stop holding.
- A short-lived MapLibre snapshotter starts with the complete basemap, observed weather, labels, and place-marker style. Per-render style/PNG resources live in bounded memory-only leases; credential-bearing style files are never written to disk. A finished bitmap must pass dimensions and meaningful map-content checks before it can be published or cached.
- A shared app-lifetime observed repository owns exact-key MRMS metadata, finished fields, coverage history, and in-flight producer leases. Preview and map consumers can join work without canceling each other. Actual observed render producers are capped at two.
- The preview requests only the latest observation. It never creates the full map model or starts forecast, alert, neighbor-frame, or playback pipelines. Global observed radar is the fallback where usable MRMS coverage is absent.
- Snapshot retention is memory-only, at most four entries / 12 MiB including the retained geographic image, with 120-second reuse and source-time validation. Visible snapshots refresh every four minutes. Memory pressure clears retention without allowing old work to refill it.
- Preview and interactive map use the same app-identity-specific basemap configuration and existing bounded tile cache.

## Verification

Focused executable checks cover exact place/camera/source identity, source freshness and future rejection, actual geographic bounds, viewport intersection, source-time expiry, cancellation generations, LRU/count/byte bounds, coalesced observed work, independent consumer cancellation, foreground admission, and warm playback/camera revisits. The feature is included in the native model CI gate.

Manual acceptance checks: scroll Today to Radar nearby, confirm the timestamp/credits and map imagery, press the card, compare the place/zoom/frame on the full map, close and reopen, then switch places. Check both light and dark appearance and a delayed/unavailable source. Physical-device feel is distinct from the deterministic cache and routing checks.

### Verified on September 21, 2026

- Full `native-model` CI gate passed, including the new preview/repository suites. Final accessibility and map-pipeline checks passed after the last polish.
- Optimized DevPerformance simulator and signed iPhone builds succeeded. The updated `app.nearcast.ios.dev` was installed and launched on the connected iPhone 17 Pro Max without removing saved data.
- Simulator inspection confirmed the enhanced observed image, selected-place marker, observation-age label, compact attribution, placement above the daily outlook, accessible button role, map opening, and ready preview on return.
- Pointer-driven simulator scrolling was unavailable; accessibility navigation and keyboard input allowed the preview to be inspected. Physical touch/haptic feel, light appearance, and live international/unavailable-source cases remain manual checks; the corresponding identity/freshness rules have automated coverage.

### Follow-up: blank image after switching places

The initial implementation mutated a background-only style in a style-loaded callback. MapLibre could complete its static render from that already-loaded empty style before the added sources/layers were rendered. The callback flag only confirmed mutation had happened, not which frame was captured. That empty bitmap could then enter the 120-second preview cache.

The replacement provides every source/layer in the initial style. An internal URL protocol serves opaque per-render style/PNG resources entirely from memory, claims expired internal URLs so they cannot reach the network, and releases them on completion/cancellation/failure. The final bitmap check rejects seed-background-only, marker-only, transparent, and incorrectly sized outputs. Valid dry-weather maps remain valid. The preview layout is now image-first with overlaid credits instead of chrome panels.

An isolated `Nearcast Radar Snapshot Tests` app-hosted scheme exercises the actual MapLibre renderer without changing the normal app launch or saved places. On the iOS 27 Pro Max test simulator, five tests passed: ten sequential dry-map renders across Maryville → Nokomis → Indianapolis → Maryville → Nokomis (twice), wet/dry isolation, blank-output rejection, cancellation/recovery, and missing-weather failure. Every render verifies pixel content, dimensions and resource cleanup. The sixth, live-basemap test is opt-in and skipped by default. The portable snapshot suite additionally verifies opaque resource URLs, no-store responses, expiry, memory limits and valid clear-weather output. A live multi-place CARTO test requires separate approval; it must not be run indirectly if that permission is denied.

The immersive follow-up passed the full native-model gate and optimized simulator/iPhone builds. The corrected signed Dev app was installed on the connected iPhone 17 Pro Max. Simulator inspection confirmed the full-image layout, overlaid freshness/credits and map opening.

After explicit approval, the live CARTO check passed on September 21 at 01:27 local time: Maryville → Nokomis → Indianapolis → Maryville → Nokomis, plus Nokomis with a fixture precipitation overlay. All six snapshots passed nonblank/detail/opacity/dimension checks and released their per-render memory resources. The opt-in XCTest executed (not skipped), with zero failures. This validates the actual snapshot renderer against the configured live basemap and existing tile cache; precipitation remains a test fixture, and this does not claim fresh downloads for every tile, live weather accuracy, or a physical-phone UI place-switch test. No additional app changes or reinstall were needed after this verification.

### Follow-up: preview-launched playback stopping at forecast

The integrated player had two related state bugs: every image message (including a usable frame's peripheral coverage notice) stopped playback, and any retained image could satisfy request deduplication even when it belonged to the previous radar time and the new forecast request had failed. Play did not retry that failed request. Preview handoff also made early playback possible while startup was still pending; late basemap configuration and metadata refresh could then pause it.

The model now records the exact successfully published image request separately from the requested frame. Playback waits for that request, accepts peripheral coverage notices when the selected place is covered, and still pauses for genuinely missing local coverage. Play and reselecting the same failed time retry acquisition. An old observed image remains labeled with its actual time/source during a forecast failure, including the hourly fallback. Internal basemap application and background metadata refresh no longer pause a user's running loop. Explicit layer changes and lifecycle suspension still do. WMS/rain-total tile products retain their separate readiness path.

`test-native-radar-playback.sh` compiles the actual production readiness, deduplication, selection, retry and playback methods with deterministic frame transport. It covers a delayed first forecast, two full loops, partial-coverage warnings, failed-frame replay, same-time retry, metadata waiting, rapid pause/play, preview/viewport publication identity, and nonnumeric products. Both disposable old-behavior mutations (message-based stopping and retained-image deduplication) fail the regression tests. The shared native CI gate includes this suite.

The optimized simulator and signed iPhone builds succeeded. Simulator checks opened the Today preview, crossed into radar-guided/model forecast, continued through a peripheral coverage notice, looped back into observed radar, paused/replayed, and reopened a ready preview for another handoff. The signed fix was installed in `app.nearcast.ios.dev` on the connected iPhone 17 Pro Max without removing saved data. Physical touch/playback feel remains a user acceptance check; the simulator's initial healthy baseline alone did not reproduce every intermittent failure.

The full `scripts/nearcast-ci.sh native-model` gate passed after this fix, including the new playback regressions and existing cache, preview, transition, routing, and companion-model checks.

### Follow-up: repeated forecast coverage notices during stationary playback

The motion handoff operated on a finite local image crop. Translating that crop exposed unknown enhancement edges even when every original MRMS/HRRR source pixel was valid. The compositor left those edges transparent, and the map counted the entire padded cache envelope when deciding whether to show an "outside forecast coverage" notice. Forecast lead changes the translated footprint, so the notice could appear repeatedly without any camera movement.

The compositor now retains the exact selected-time original model field where the enhancement crop has no support, feathering over eight pixels into the unchanged enhanced interior. It still rejects genuine incomplete source masks, stale/inconsistent times, unreliable motion and overly small enhancement footprints. Evidence separates enhancement footprint coverage from final available-data coverage. The rendered forecast cache identity is versioned to exclude the old edge treatment.

Coverage presentation now uses the actual displayed frame's mask and the visible camera in Web Mercator, including partially visible pixels and any area beyond the image. Missing offscreen padding alone cannot trigger a notice. A camera move inside a cached envelope recalculates coverage without reloading weather; a fully covered contained view takes a constant-time fast path. Dry transparent pixels remain valid data. Real visible gaps and unavailable data at the selected place remain explicit, independently of request failures and playback readiness.

Regression coverage includes an independent per-pixel edge/feather oracle, nonzero original model echoes at enhancement edges, mirrored motion, unchanged interior, prepared-result reuse, true source holes, excessive advection, padding-only mask holes, within-envelope pans, subpixel weights, high-latitude projection, dry fields and out-of-image views. Both focused suites and the existing playback/pipeline suites passed. Optimized simulator and signed iPhone builds succeeded. The Mac was locked during the attempted visual check, so this iteration does not claim a new hands-on playback inspection.

The corrected `app.nearcast.ios.dev` was installed on the connected iPhone 17 Pro Max with saved data preserved. The full native-model CI gate passed, including the new visible-coverage suite and updated transition/playback regressions.

### Follow-up: Bengaluru preview alternating between loading and unavailable

The international radar manifest responded successfully during diagnosis. The preview lifecycle nevertheless had restart paths that particularly affect slow raster loads: geometry was measured inside the animated button, visibility used one hard threshold, and another same-key load canceled the active producer. A superseded task could also enter `load` already canceled and disturb the newer request. These are confirmed code-level weaknesses; the exact on-device flicker was not visually reproduced because the Mac was locked.

Geometry is now measured on the fixed outer card. Width normalization ignores small layout changes, and visibility uses separate enter/exit thresholds. Same-place/camera calls join the active producer, already-canceled callers cannot alter it, and a replacement safely drains a canceled producer before retrying. Failed or timed-out requests have a same-key minimum 60-second admission cooldown; this is not a new one-minute timer, and the normal visible refresh cadence remains four minutes. A refresh failure keeps an existing, still-usable map with an explicit last-image status instead of replacing it with a placeholder. Source freshness and place identity still govern retention and handoff.

The actual production lifecycle methods have eight executable regression groups covering slow global acquisition, coalescing, canceled waiters, canceled-producer recovery, late old-place results, failure/timeout cooldown, usable-image retention and stale-image rejection, cache reuse and camera changes. A disposable mutation restoring same-key restart behavior fails this suite. The app-hosted MapLibre suite also renders Bengaluru's raster256/maxzoom7 path repeatedly across US geographic-image transitions, including wet/dry isolation and resource cleanup. All six offline tests passed; the separate live-CARTO test remained skipped. These fixtures validate rendering and lifecycle behavior, not current precipitation or live Bengaluru tile coverage.

The full native-model gate passed. Optimized simulator tests and the signed iPhone build succeeded, and the corrected `app.nearcast.ios.dev` was installed on the connected iPhone 17 Pro Max without removing saved data. A physical-phone Bengaluru switch remains the acceptance check; the locked Mac prevented visual inspection during this iteration.
