# Native radar performance milestone

## Scope

The reported failures were slow first display, repeated forecast work on every
playback loop, and discarded weather after panning/zooming or reopening Map.
This milestone changes caching and scheduling without changing weather values,
timestamps, forecast labeling, native map controls, or provider credentials.
Storm Check remains absent from the product UI.

This is a bounded client-side performance foundation, **not** a completed
geographic weather-tile renderer or a server/CDN weather pipeline. Enhanced US
weather still uses a padded geographic image envelope. Completely new areas
and new source runs can still require downloading and processing provider data.

## Changes

- Finished forecast images are reused before decoding or coloring another copy.
  Quarter-hour HRRR and hourly fallback images retain their real source times.
- Render identity includes source revision, exact geographic bounds, quality,
  enhancement mode, and the radar/model evidence used by the handoff.
- Caches live beyond a single map presentation. Moving the camera no longer
  clears all other areas. A bounded coverage history restores an area's exact
  previous envelope when returning to it.
- HRRR source bytes and sampled fields are shared across consumers. Matching
  requests join existing work; foreground requests promote useful prefetches.
  Failed or unvalidated content does not become a cache hit.
- Only two image producers run concurrently. Changing selection cancels its UI
  subscription without continually destroying useful next-frame work. Unrelated
  speculative work yields to the selected frame. Late results cannot replace a
  newer selection or be relabeled as a different area.
- Auxiliary motion evidence has a separate budget, so preparing the
  radar-to-forecast handoff cannot evict the observed playback loop.
- Metadata can seed a warm reopening for at most two minutes; refresh and source
  freshness checks still apply. Memory-pressure generations prevent retired work
  from repopulating a purged cache.
- CARTO PNGs use a separate credential-redacted cache. On disk it stores opaque
  hashes, image bytes, and local expiry metadata—not keyed URLs or HTTP headers.
  It honors provider freshness, has a one-day maximum residence, and purges on
  credential rotation. MapLibre's URL-keyed ambient database stays disabled.
  A bounded in-memory index avoids scanning the disk directory on every tile;
  failed disk eviction preserves accounting and falls back to memory serving.
- `DevPerformance` compiles the same isolated Dev app with optimization and
  symbols, without attaching the debugger. Plain `Debug` remains available via
  `NEARCAST_DEV_CONFIGURATION=Debug`. Release/TestFlight settings are unchanged.

## Explicit retention budgets

| Store | Maximum retained data |
| --- | ---: |
| Observed rendered areas | 16 MiB / 8 entries |
| Forecast rendered areas | 40 MiB / 30 entries |
| Auxiliary motion evidence | 8 MiB / 12 entries |
| MRMS compressed scans | 32 MiB / 8 scans |
| HRRR source records | 32 MiB |
| HRRR sampled fields | 24 MiB |
| CARTO PNG memory cache | 16 MiB |
| CARTO PNG disk cache | 96 MiB |

The weather retention budgets total 152 MiB. These are not an app memory cap:
active images, decode scratch space, MapLibre/GPU resources, SwiftUI, and hourly
fallback fields also consume memory. National decoded MRMS grids are not retained.
Physical-device resident memory and thermal behavior still need representative
long-session measurement.

## Evidence and tests

- The 24-frame HRRR replay fixture performs zero additional downloads or decodes
  on its second pass. Different viewport requests share a matching source record.
- Finished-frame cache tests cover a full 24-frame forecast loop, an intervening
  area, A→B→A camera travel, zoom out/back, byte eviction, and pressure recovery.
- Scheduler tests compile the actual production scheduling function and verify
  prefetch joining, canceled subscribers, foreground admission, the two-producer
  ceiling, and retry after a canceled producer.
- Provider tests cover exact identity, priority promotion, independent
  cancellation, failed/short responses, queue limits, expiry, and purge races.
- Basemap tests exercise persistent reopening, canonical host shards, HTTP
  freshness, key rotation/late retired responses, URLSession's task cache hooks,
  corrupt entries, and hard byte limits. Mock URLSession automatic retention is
  also observed, in addition to direct cache API checks.
- A user-approved single live CARTO request returned HTTP 200 / PNG, a positive
  cache lifetime, no `Vary`, and no `Set-Cookie`; this is compatible with the
  conservative cache admission policy. No key or keyed URL was printed or saved.
- Local Mac CPU benchmark at 512×672: optimized coloring was approximately
  6–17 ms, versus 273–653 ms in unoptimized Debug, with identical output checksums.
  This measures the color-rendering stage only—not iPhone end-to-end frame time.

Map tools in Dev includes redacted counters and source/render/publication timings.
Publication means the model handed an image to the map; it does not prove the GPU
has drawn that frame. Do not present this number as screen latency or claim a
physical-device p95 without measuring it.

## Acceptance pass

1. Open Map cold; record time to basemap and first weather separately.
2. Play the same one-hour and six-hour view twice; confirm second-loop cache hits
   and that the time label/thumb follows the displayed weather.
3. Pan A→B→A, then zoom out/back; confirm usable previous images remain visible
   while new coverage prepares, and returning areas reuse the correct identity.
4. Close/reopen Map and background/foreground the app. Confirm source timestamps
   stay truthful and late requests do not overwrite the new selection.
5. Repeat on iPhone 17 Pro Max without a debugger; measure memory and sustained
   behavior before calling the entire map performance problem solved.

### Validation record — September 21, 2026

- Full `scripts/nearcast-ci.sh native-model` gate passed. The final standalone
  basemap suite also passed after the disk-index/failure-accounting refinement.
- Final frozen-source optimized simulator and signed iPhone builds succeeded.
- Installed and launched `app.nearcast.ios.dev` on the paired iPhone 17 Pro Max
  without removing app data. No production or TestFlight deployment was made.
- Live QA simulator playback exercised both one-hour and six-hour timelines.
  At the 156-publication checkpoint, there had been 24 forecast renders and six
  observed renders, with 151 finished-frame cache hits and five foreground
  misses. Later looping continued hitting finished frames without rerendering.
  That checkpoint's selected-to-publication median was 0.79 ms and p95 6.10 ms;
  this is simulator model-publication timing, not physical-device screen timing.
- Immediate map reopening produced a finished-frame cache hit with no source or
  render work (0.84 ms to publication). A reopening after newer radar arrived
  correctly loaded the new observation rather than relabeling the old image.
- Live pan/zoom gesture automation was unavailable in Device Hub during this
  pass (`noWindowsAvailable` for coordinate actions). Area/zoom reuse is covered
  by deterministic tests, but real-device gesture feel and long-session memory
  remain manual acceptance items. No claim of completed physical-device pan QA.

If new-area cold loading remains the bottleneck after these fixes, the next
architecture milestone is reusable fixed geographic weather chunks, followed by
provider-safe server preprocessing/CDN delivery if measurements justify it. Do
not hide missing weather as clear sky or smooth away genuine source-time gaps.
