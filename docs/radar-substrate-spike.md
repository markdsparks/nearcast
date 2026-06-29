# Radar substrate spike

Working decision doc for moving Nearcast radar beyond NOAA/NWS WMS-rendered PNG
tiles. The `v3.0.45` source-zoom diagnostic showed that forcing NOAA WMS source
zoom to z10 or z12 did not materially improve the ugly z7.5-z13 band, so the
next work is a data-substrate decision rather than another renderer tweak.

## Goal

Make radar beautiful and responsive at every map zoom without overstating
precision.

Success means:

- Radar looks intentional at z7.5, z9, z11, z13, z16, and z18 on iPhone.
- Pan/zoom stays smooth in immersive WebGL mode.
- Animation does not flicker, pulse, or blank between frames.
- Labels and place markers remain readable over precipitation.
- The layer can still drive Nearcast truth language such as rain now, rain
  nearby, and rain soon.
- The source can be used legally and economically for a small public PWA.

## Decision tracks

Run these in parallel.

Current spike status:

- Provider bake-off scaffold added in `scripts/provider-bakeoff/README.md`.
- MRMS S3 discovery harness added in
  `scripts/mrms-prototype/list-mrms.mjs`.
- MRMS single-frame render harness added in
  `scripts/mrms-prototype/render-mrms-preview.mjs` for PNG-compressed GRIB2
  products.
- Public MRMS listing works from the local environment. The `CONUS/` catalog
  includes radar candidates such as `MergedReflectivityQCComposite_00.50`,
  `ReflectivityAtLowestAltitude_00.50`, `PrecipRate_00.00`, and
  `SeamlessHSR_00.00`.
- First inspected `MergedReflectivityQCComposite_00.50` frames are GRIB2 grid
  template `3.0` plus PNG-compressed data template `5.41`: `7000 x 3500`,
  `0.01` degree spacing, 16-bit encoded values, no bitmap.
- Early visual finding: raw MRMS lets us smooth in data-space before
  colorization, but deep zoom still needs product/style tuning because the
  source grid resolution remains visible at storm edges.
- Current visual target has split into two candidates. `resolved` gives a more
  premium green/yellow/orange weather-field look, but may hide raw radar
  structure. `banded` starts from the raw radar read and uses discrete dBZ bands
  with no separate outline stroke, so color regions meet directly instead of
  creating a border halo.
- Current-vs-MRMS zoom comparison is now supported by the prototype renderer.
  The useful diagnostic is a bounded CONUS precip edge, rendered as rows from
  z7.4 upward with columns for current NOAA WMS, MRMS raw, MRMS banded, and
  MRMS resolved. This directly shows where the current WMS path becomes blocky
  as Nearcast overzooms its capped radar source.
- App-side integration has started behind `radarProvider = auto | noaa-wms |
  mrms-generated`. The app reads a generated-MRMS manifest from
  `radar/mrms/manifest.json`, normalizes it into the existing radar frame model,
  and falls back to the current NOAA/RainViewer path if the manifest is empty or
  unavailable.
- The app now checks `radar/mrms/index.json` before the legacy manifest. The
  index is a location-aware catalog of generated packs, so the app can choose a
  generated manifest by active-place coverage instead of assuming there is only
  one generated region.
- The MRMS prototype can now generate a bounded slippy tile set directly from
  decoded numeric values. The checked-in sample publishes transparent PNG tiles
  at z6-z14 under `radar/mrms/sample-mrms-banded-max/`, centered on the strongest
  CONUS radar cell in the local test frame, and exposes them through
  `radar/mrms/manifest.json` for the app's `mrms-generated` provider.
- The production-shaped wrapper
  `scripts/mrms-prototype/generate-mrms-timeline.mjs` can discover latest MRMS
  objects or accept local files/URLs, render each source frame into its own tile
  folder, and publish one combined manifest atomically. Live manifests can carry
  `expiresAt`; sample manifests are marked with `sample: true` so the app can
  distinguish testing data from live radar.
- Generated manifests now publish `coverageBounds` / `coverageAreas`, and the
  app only uses the generated provider when the active place is inside that
  coverage. This keeps a local/regional generated pack from silently replacing
  global NOAA/RainViewer coverage for users elsewhere.
- The first banded contour passes used a separate separator stroke; on-device
  MapLibre resampling made those edges read as a gray-purple bleed. The current
  sample removes the outline entirely and uses a tile URL version query so
  mobile clients fetch the no-border tiles.
- Default app behavior remains unchanged; generated MRMS is still selected via
  the radar-provider setting and falls back to NOAA/RainViewer if a live
  generated manifest is unavailable, stale, or outside its declared coverage.

### Generated precipitation manifest contract

This should remain source-agnostic. Observed MRMS radar is the first producer,
but generated future forecast maps can use the same shape later:

- `frames[]`: ordered weather frames with `time`/`timestamp`, `url` or `layers`,
  `minZoom`, `maxZoom`, and optional frame-level `coverageBounds`.
- `coverageBounds`: the broad geographic area this manifest can safely serve.
- `coverageAreas[]`: one or more named generated packs. The app can check the
  active place against these before choosing generated tiles.
- `source`: the upstream source objects used to generate the pack, plus a stable
  source signature.
- `renderConfig`: the render inputs that shape the generated output, including
  product, coverage, zooms, style, and freshness window.
- `publishFingerprint`: stable source-plus-render hash used by CI to skip
  wasteful tile generation/deploys when the current manifest is still fresh.
- `metrics`: generation duration and tile counts for operational visibility.
- `sample`: `true` for checked-in or manual test packs that may be stale.
- `expiresAt`: freshness guard for live generated packs.

The companion index contract is intentionally smaller:

- `provider`: `nearcast-generated-radar-index`
- `packs[]`: available generated packs with `manifestUrl`, coverage metadata,
  freshness metadata, and tile/generation metrics.

Today the publisher writes one pack into the index. In the production shape,
this can become many observed or forecast packs backed by R2/object storage
without changing the app's map integration again. As an interim step, the
static publisher can already publish multiple profiles in one deployment:
the first profile remains the legacy `radar/mrms/manifest.json`, additional
profile manifests live under `radar/mrms/packs/<profile>/`, and the index routes
active places to the correct pack.

The app should not care whether a generated frame came from observed MRMS,
future HRRR/NBM/QPF guidance, or a commercial provider bake-off. If it exposes
the same manifest contract, it can enter the map as a normal precipitation
timeline frame.

### Live publish path

`scripts/mrms-prototype/publish-mrms-live.mjs` is the first operational wrapper
around the generator. It defaults to a small `metro-east` coverage profile,
creates `radar/mrms/live/` tiles, writes a live `radar/mrms/manifest.json`, and
is designed to run immediately before a static Cloudflare deploy. The scheduled
GitHub Actions workflow publishes those generated files as deployment assets
without committing them back to Git.

The wrapper now does a source-delta check before rendering. It resolves the
candidate MRMS objects, builds the same manifest fingerprint that a full render
would produce, and compares it with the currently deployed generated manifest.
When the source objects and render profile match and the deployed manifest is
still fresh enough, the workflow keeps the existing static asset snapshot and
skips deploy.

The first live profile intentionally stops at z13. Wider regions or z14+ tiles
are possible, but they need a more deliberate tile budget, object storage, or
multiple regional packs before becoming a global default.

### Track A: commercial provider bake-off

Purpose: determine whether we should buy the radar rendering substrate instead
of building it.

Primary candidate:

- Xweather MapsGL. It is designed for WebGL weather visuals, supports MapLibre,
  and describes client-side rendering from weather data rather than static
  imagery files. This maps directly to the problem we have with WMS PNG tiles.

Secondary candidates:

- Tomorrow.io maps, if their current product access can provide high-quality
  radar/precipitation map rendering in a browser PWA.
- Any provider that can prove data-driven or high-resolution weather rendering,
  not just another raster tile endpoint.

Bake-off requirements:

- Needs a trial key or sandbox from the provider.
- Must run inside the existing MapLibre immersive map path.
- Must support current radar animation and timeline control.
- Must expose enough data or query hooks to support point/location weather truth.
- Must be testable on iOS PWA, not only desktop.
- Must have clear pricing, attribution, caching, and public-app terms.

Provider acceptance checklist:

- z7.5-z13 radar quality is visibly better than current NOAA WMS.
- z13+ does not pretend block-level precision but still looks polished.
- Animation is smooth while panning and zooming.
- Bundle/runtime cost is acceptable.
- No keys are exposed in a way that violates provider terms. If browser keys are
  not allowed, a Worker proxy becomes part of this track.

### Track B: MRMS raw prototype

Purpose: determine whether we can own a beautiful radar pipeline using public
NOAA data.

Source:

- NOAA MRMS public dataset on AWS (`noaa-mrms-pds`). The dataset is real-time,
  public, and updated on a 2-minute cycle.

Prototype shape:

1. Pull the latest relevant MRMS product from S3.
2. Decode GRIB2 into a numeric grid.
3. Convert reflectivity/precipitation values into our own color ramp.
4. Render a single local test viewport first, then tile it.
5. Add zoom-aware styling before colorization, not after rasterization.
6. Compare against the same z7.5-z13 test band.
7. Publish a manifest whose frames use `{z}/{x}/{y}` tile templates that the
   app can consume through the `mrms-generated` provider.
8. For live usage, publish multiple recent frames through the timeline wrapper
   with an `expiresAt` freshness window and atomic manifest replacement.
9. Publish coverage metadata with every generated pack so the app can fall back
   outside generated coverage instead of showing a blank local tile set.
10. Run the live publisher in CI before deploy so the deployed static asset
    snapshot includes fresh generated tiles without storing them in Git history.
11. Keep source and render fingerprints in the manifest so future observed and
    forecast producers can avoid regenerating identical static tile snapshots.

Why this is different from WMS:

- WMS sends us already-colored pixels.
- Raw MRMS gives us values, so we can interpolate in data-space, smooth before
  colorization, tune alpha, generate contours, and avoid blocky color cells.
- It does not create unlimited precision. At close zoom, styling must be honest
  about the finite MRMS grid while avoiding ugly raster artifacts.

Prototype acceptance checklist:

- A local script can produce a PNG/WebP tile or full-viewport image from MRMS
  numeric data.
- The output looks materially better than NOAA WMS at z9-z13.
- The pipeline can be automated within 2-3 minutes of source updates.
- The runtime architecture is plausible on Cloudflare or a small external job.

Current local toolchain gap:

- `wgrib2`: not installed.
- `gdal_translate`: not installed.
- Python `pygrib`, `eccodes`, `cfgrib`, `PIL`, and `osgeo`: not installed.
- Python `numpy`: installed.

So the first MRMS task is choosing the decode path:

- Preferred: use `wgrib2` or ecCodes in a local/server build step, then emit
  normalized PNG/WebP/PMTiles artifacts for the PWA.
- Alternate: use a small containerized decode worker outside the static PWA.
- Avoid: parsing full GRIB2 in the browser.

## Likely architecture if we build

Nearcast app:

- Keeps MapLibre as the map shell.
- Loads radar as a custom raster/vector-like layer from our generated tiles.
- Keeps existing NOAA WMS as fallback.
- Does not decode GRIB2 in the browser; it consumes a small generated manifest
  plus pre-rendered tiles.

Radar processing job:

- Polls or subscribes to MRMS updates.
- Downloads latest GRIB2 product.
- Decodes to numeric grid.
- Reprojects/crops as needed.
- Generates tiled artifacts and metadata.
- Publishes frames to object storage/CDN.

Tile/render output options:

- Raster PNG/WebP tiles: fastest to ship, good enough if generated from
  smoothed data.
- PMTiles/MBTiles bundle per frame: cleaner CDN delivery, more tooling.
- Custom WebGL texture field: most control, more client complexity.

## Next implementation sequence

1. Request or create an Xweather MapsGL trial key and confirm browser/PWA key
   terms.
2. Build an isolated provider adapter behind a feature flag:
   `radarProvider = noaa-wms | xweather-mapsgl`.
3. Use `scripts/mrms-prototype/list-mrms.mjs` to select the first MRMS product
   frames for visual comparison.
4. Use the MRMS preview renderer to compare `MergedReflectivityQCComposite`,
   `ReflectivityAtLowestAltitude`, and `PrecipRate` at z9, z11, and z13.
5. Test both tracks against the same places and zoom bands:
   z7.5, z9, z11, z13, z16, z18.
6. Decide:
   - Buy if provider quality is clearly better and terms are acceptable.
   - Build if raw MRMS output is close and control matters.
   - Hybrid if provider wins now but raw MRMS is viable as a strategic fallback.

## Open questions

- Which MRMS product gives the best Nearcast radar layer: composite
  reflectivity, lowest-altitude reflectivity, or precipitation-rate product?
- Do we need NEXRAD Level II later for close storm inspection, or is MRMS enough
  once rendered correctly?
- Can Cloudflare handle the tile serving path alone, or do we need a scheduled
  processing job elsewhere?
- Are provider browser keys allowed for a public PWA, or do we need a Worker
  proxy from day one?

## References

- NOAA MRMS on AWS: https://registry.opendata.aws/noaa-mrms-pds/
- NOAA NEXRAD on AWS: https://registry.opendata.aws/noaa-nexrad/
- Xweather MapsGL: https://www.xweather.com/mapsgl
- Xweather MapsGL docs: https://www.xweather.com/docs/mapsgl
