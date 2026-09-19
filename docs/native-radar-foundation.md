# Phase 3A — native radar foundation

September 18, 2026. This started as an **isolated engineering checkpoint**. At the user's request, [build 106](native-radar-lab-testflight-106.md) packages it as an explicit opt-in Radar Lab while Mac visual QA remains unavailable. It is not a replacement for the shipping map or completed radar parity. Nearcast's Map tab, providers, credentials, notification policy and family records are unchanged.

## What is built

- A separate SwiftUI/MapLibre app, `app.nearcast.radar-foundation`, with an offline coordinate grid, a public Maryville test marker, native camera controls, recentering, NOAA raster sources, advertised-frame scrubbing, playback and source details.
- Exact provider timestamps remain attached to the images. Observed reflectivity and NDFD **six-hour accumulated rain** are separate modes; no cross-source animation suggests they represent continuous storm motion. There is no interpolation between invented source times.
- Selection is keyed by source and valid instant, not array position. Refresh cannot silently move a selected frame. Missing selections are explicit; failed refreshes retain original timestamps; playback stops at missing time intervals or a source's end. Times use America/Chicago with a local laboratory-only 12/24-hour choice.
- A pure Swift numeric contract compares already-decoded synthetic MRMS/HRRR textures with the existing JavaScript primitives: dBZ encoding, nearest/bilinear translation, byte blending, supplied correction decay, exact-time composition, and the CPU `resolved` color style.
- Three asymmetric synthetic storm images are colored by Swift and checked byte-for-byte against JavaScript before being passed to MapLibre's georeferenced image source. Synthetic imagery is mutually exclusive with live NOAA imagery and visibly labeled **not weather**. Four corner markers expose orientation mistakes.
- An information sheet keeps diagnostics separate from the map controls. SDK drawing callbacks are explicitly **not** proof of tile correctness, coverage, or hardware performance. Blank areas are visibly labeled as potentially missing imagery, not clear weather.

The diagnostic grid intentionally has no street basemap. It avoids introducing a new provider or using production CARTO credentials before native restrictions/rights have been verified. Synthetic image bounds are west −93°, east −87°, south 36°, north 41°; the first pixel row is north and the first column west.

## Dependency decision

The experiment pins **MapLibre Native 6.31.0** rather than a floating version. Its official binary archive is checked before extraction or compilation:

`de3aaa435dd86768b06d90245e630d068dd7eef1491afae7217d1654c52c462a`

The SDK has an iOS 12 floor; this experiment keeps Nearcast's iOS 17 floor. MapLibre is a tested compilation candidate, not yet a physically accepted full-map renderer. Build 106 adds it to the iPhone target only for the opt-in lab; widget and Watch targets do not link it. The BSD license and unpruned tagged iOS/core notices are bundled.

Device packaging caveat: the verified official 6.31.0 device slice contains simulator-valued bundle platform metadata, despite an iOS Mach-O binary. Xcode copies those fields into the archive unchanged. Build 106's release preparation explicitly validates and corrects the known platform fields in the archived copy and re-signs the framework and app; it does not modify the source package/cache or executable code. Archive validation rejects uncorrected or mismatched platforms. This guarded workaround must be revisited, not silently generalized, when upgrading the SDK.

Primary references:

- [Exact official package manifest](https://raw.githubusercontent.com/maplibre/maplibre-gl-native-distribution/6.31.0/Package.swift)
- [Tagged WMS URL-template support](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/ios/MapLibre.docc/Tile_URL_Templates.md)
- [Tagged iOS dependency notices](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/ios/LICENSE.md)
- [Tagged core dependency notices](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/LICENSES.core.md)
- [Experimental Metal custom-layer example](https://github.com/maplibre/maplibre-native/blob/ios-v6.31.0/platform/ios/app-swift/Sources/CustomStyleLayerExample.swift)

Raster tiles, GeoJSON and georeferenced images are exercised by this code. A native Metal custom layer is still a separate decision: the SDK's `MLNCustomStyleLayer` is experimental, and this checkpoint makes no GPU parity claim.

## Reproduce

```sh
bash scripts/test-native-radar-timeline.sh
bash scripts/test-native-radar-numeric.sh
bash scripts/build-native-radar-foundation.sh
```

The build script downloads only the exact official SDK, validates its SHA-256, and prints a temporary simulator app path. `NEARCAST_RADAR_SDK_ARCHIVE` can point to a previously downloaded ZIP; its checksum is still mandatory. Binaries and downloaded SDK files are not committed.

Install the printed standalone app path on an isolated simulator. Launch with `-radar-fixtures YES` for the fully local synthetic mode; default launch requests public NOAA source metadata. The standalone app has no location, notification, calendar, microphone, App Group or family-storage capability. The embedded lab never accesses those capabilities or family records, and never launches a paid weather session. Its close action stops playback and returns to native Settings.

The fixture generator's `--check` mode compares checked-in data with the current web implementation; it does not silently refresh expected results. `node scripts/native-radar-numeric-fixtures.mjs --emit` prints candidate JSON for an intentional, reviewed fixture update. Synthetic tests are included in `nearcast-ci.sh native-model`; ordinary CI performs no radar network calls.

An explicitly opted-in public-source probe is available separately:

```sh
bash scripts/test-native-radar-foundation-live.sh --live --tiles
```

It refuses to run without `--live` or inside CI. Metadata and optional PNG checks use bounded, ephemeral requests to the existing NOAA endpoints; they cannot establish visual alignment or forecast accuracy.

## Evidence and boundaries

| Check | Result |
| --- | --- |
| Exact-time/source selection, retained/missing selection, stale refresh, gap stops, future observations, expired forecast, local clock/DST | PASS: 122 deterministic assertions; also passed with a different process timezone |
| Synthetic numerical comparison with current web primitives | PASS: 3 dBZ ranges/all 256 decode bytes; 16 translations; 7 blends; 16 supplied-correction cases; 4 exact-time compositions; 9 all-byte color sweeps; 6 timestamps; 10 lead-rounding edges; 3 preview images; invalid/nonfinite/oversized inputs |
| Existing radar seam, raw runtime, seam integration, canonical timeline and map experience checks | PASS during integration |
| Full `nearcast-ci.sh all` regression suite | PASS, including the new timeline and numeric checks |
| Checksum-pinned MapLibre compilation, iOS 17 simulator floor | PASS |
| Separate app installation and process launch | PASS on isolated iPhone 17 Pro and Pro Max / iOS 27; process launch is not visual evidence |
| Opt-in live NOAA metadata and selected-image signature probe | PASS at this point in time: MRMS 60 advertised/60 usable frames, latest `2026-09-19T01:18:08.000Z`; NDFD 12/12, next `2026-09-19T06:00:00.000Z`; both selected PNG signatures passed |
| Visual texture alignment, native pan/zoom/recenter, scrub and source transitions | BLOCKED: Mac locked during this checkpoint; not claimed as passed |
| Physical-device latency, memory, offline/slow recovery, background/resume | NOT RUN |

The model review also corrected cancellation leaving refresh busy, a late initial refresh overriding a source choice, paused clock expiry, overclaiming live/verified imagery, and attribution during failure. These are code-review/build checks, not a substitute for interaction testing.

## What this does not prove

No live GRIB/Zarr/NCRD decoding; no storm-motion or correction estimation; no full raw runtime freshness/quality gates; no GPU shader parity; no complete radar/forecast seam; no RainViewer/global fallback; no production basemap, aerial or satellite integration; no official alert polygons, Storm Check, lightning or StormScope. A synthetic exact-time blend is not validation of real-world storm guidance.

## Next gate before a family-facing native map

1. Unlock the Mac and verify the isolated renderer visually: asymmetric fixture orientation/colors, native pan/zoom/recenter, exact selected times, no source crossover, no timeline layout jumps, and restored selection after backgrounding. Record outcomes on both simulator sizes.
2. Finish the live numeric-data path and weather semantics needed by the existing enhanced map; compare matched inputs across web/native before replacing it. Decide CPU image versus a reviewed native rendering path using measured workload, not this tiny fixture.
3. Verify production provider authorization/attribution, selected-place routing, global fallback and buffering/error behavior. Existing providers remain unchanged until this gate is satisfied.
4. Use the early opt-in Radar Lab TestFlight to measure physical interactions/latency/memory on both family phones. This testing can run in parallel with Mac visual QA; it does not skip full-map parity or promote a default. Keep the current map available until accepted; resolve every existing layer or obtain explicit agreement for any retirement.

See [migration scope and acceptance](native-migration-plan.md), [current map inventory](native-migration-baseline.md), and the [earlier MapKit raster proof](native-radar-substrate-proof.md).
