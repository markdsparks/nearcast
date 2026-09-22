# Native hourly and radar refinement — September 20, 2026

## Product behavior

- Today’s outlook header and the Hourly tab open **Next 24 hours**, crossing
  local midnight. Individual Today columns focus their real provider timestamp.
- Explicit day-picker, daily outlook, dated Ask and plan routes remain calendar
  day views. The picker always offers a return to Next 24h.
- **Show next 24 hours** appends available hours without navigating away. The
  list is finite, capped at the provider horizon / 14 days. Missing hours are not
  fabricated, and DST repeats keep distinct timestamps and timezone labels.
- The chart is explicitly the initial next-24-hour window, even after the list
  is extended. Date-specific Day at a glance stays in day mode. Sun uses the
  sunrise/sunset for each date spanned by the rolling chart.
- The real six-hour 15-minute feed can cross midnight in rolling mode; choosing
  a specific day bounds it to that day. Earlier values remain forecast guidance.

## Radar acquisition and rendering

- Healthy US MRMS discovery publishes before any global backup request. The
  backup is only requested when the US source cannot be used.
- MRMS compressed scans share an in-memory cache: at most 32 MiB, eight scans,
  15-minute retention, two active acquisitions. Key includes advertised path,
  size and observation time. Only successfully decoded/validated bytes persist.
- Independent consumers share one flight; cancellation releases only that
  consumer, and the last cancellation aborts transport. Invalid, truncated,
  failed or canceled-only results do not become cached weather.
- HRRR independent metadata/grid/chunk work uses two-request batches. Subhourly
  metadata transport is isolated from selected-frame transport so discovery
  cannot consume its request slots.
- Padded, bounded geographic envelopes survive nearby pans. Half-zoom quality
  buckets avoid redoing work for every fractional zoom tick. Images retain their
  true geographic bounds and loading edges are not represented as clear weather.
- 512×672 samples preserve visible detail within padding. Each rendered cache
  retains six entries within 12 MiB (up from eight MiB): six padded frames require
  12,386,304 bytes, so a full six-scan observed loop stays resident. The observed
  and subhourly caches together are capped at 24 MiB; this is not a whole-app
  memory bound. HRRR numeric fields are reused when identity
  and coverage checks pass. Revised scans at the same time invalidate rendered
  cache, request and image identity through advertised byte length.

## Map controls

The top shows close, place and tools. Recenter sits near the bottom. A compact
timeline retains playback, the actual visible time/source, range, Latest, one
continuous scrubber and linked provider credits. Loading text occupies space
only when needed. The color scale expands on tap. Larger text gets a roomier
layout, and the scrubber retains a 44-point hit target and VoiceOver adjustment.

Official alerts and limited/stale/failed alert coverage stay prominent when
relevant; the complete list is always available in Map tools. My Location and
less-used controls also live in tools. Storm Check stays removed. Xweather and
lightning are not activated by this change.

## Verification

- Full native-model gate passed during integration; final narrow UI followups
  also passed their focused contracts, preview tests and Swift parsing.
- Expanded tests cover rolling midnight/DST/provider gaps, bounded continuation,
  scan coalescing/eviction/cancellation/corruption, viewport containment and
  replacement scan identity, metadata/frame concurrency and cancellation.
- Integrated iPhone 17 Pro Max simulator build passed. Simulator walkthrough
  verified late-night Today → Next 24h, Tomorrow day mode, return to rolling mode,
  extension to 48 hours, real 15-minute midnight crossover, rendered radar,
  expanded color scale, and official alerts opening from Map tools. Playback
  advanced through forecast frames and cycled back to observed radar; playback
  was paused after the check.
- Final signed iPhone and simulator builds passed after the cache-budget and
  compact-control followups. Nearcast Dev was installed on the connected iPhone
  17 Pro Max and its launch was confirmed. The final simulator build also
  reconfirmed Today → Next 24h and the compact map layout. TestFlight was not
  changed.
- These checks do not establish a measured cold-start speedup, long-running
  physical-device memory/battery behavior, or Watch/widget correctness. Those
  remain device-validation items; no Xweather traffic or TestFlight publication
  is required for this pass.
