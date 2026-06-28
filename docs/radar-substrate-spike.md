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
  structure. `banded` starts from the raw radar read and adds discrete dBZ bands
  plus subtle separator isolines so gradients feel intentional instead of
  blurry.
- App behavior is unchanged until a provider key or decoded MRMS render proves
  better than the current fallback.

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
