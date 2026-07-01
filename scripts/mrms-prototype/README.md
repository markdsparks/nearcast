# MRMS raw-data prototype

This folder is for proving whether Nearcast can render a more beautiful radar
layer from raw public NOAA MRMS data instead of accepting pre-colored WMS PNG
tiles.

## Why this exists

The current NOAA/NWS WMS radar layer is already colorized before it reaches the
app. At mid zoom levels it turns into soft, blocky pixels because the renderer
can only resample an image. MRMS gives us the numeric radar field first, which
lets us smooth, interpolate, threshold, and colorize before generating map
tiles.

## Step 1: discover candidate frames

The discovery script uses only Node's built-in `fetch`. It does not decode
GRIB2 yet.

```bash
node scripts/mrms-prototype/list-mrms.mjs
node scripts/mrms-prototype/list-mrms.mjs --all --limit=40
node scripts/mrms-prototype/list-mrms.mjs --product=MergedReflectivityQCComposite_00.50
node scripts/mrms-prototype/list-mrms.mjs --product=PrecipRate_00.00 --date=20260628 --limit=8
node scripts/mrms-prototype/list-mrms.mjs --product=ReflectivityAtLowestAltitude_00.50 --json
```

Good first products to compare:

- `MergedReflectivityQCComposite_00.50`: composite reflectivity with quality
  control. Likely best first visual radar candidate.
- `ReflectivityAtLowestAltitude_00.50`: closer to what is happening near the
  ground. Good for rain-now truth and user expectations.
- `PrecipRate_00.00`: precipitation-rate field. Good for softer rain intensity
  rendering, but may feel less like classic radar.
- `SeamlessHSR_00.00`: high-resolution seamless reflectivity-style candidate.
  Needs visual inspection before we know whether it is useful.

## Step 2: decode

The first practical decode path is now dependency-free for the initial MRMS
reflectivity products we inspected:

```bash
curl -L --max-time 30 -o /tmp/nearcast-mrms-reflectivity.grib2.gz \
  "https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MergedReflectivityQCComposite_00.50/20260628/MRMS_MergedReflectivityQCComposite_00.50_20260628-140037.grib2.gz"

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --probe

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --zoom=11 \
  --out=/tmp/nearcast-mrms-preview.png

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --focus=edge \
  --zoom=11 \
  --style=banded \
  --out=/tmp/nearcast-mrms-edge-z11-banded.png

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --focus=edge \
  --zoom=11 \
  --style=resolved \
  --out=/tmp/nearcast-mrms-edge-z11.png

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --focus=edge \
  --zoom=11 \
  --style=resolved \
  --compare \
  --out=/tmp/nearcast-mrms-style-compare-z11.png

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --focus=edge \
  --bounds=25,-125,49,-70 \
  --width=220 \
  --height=320 \
  --compare-current-zooms \
  --zooms=7.4,7.6,8,9,10,11,12,13,14 \
  --out=/tmp/nearcast-radar-current-vs-latest-mrms-conus-edge-zooms.png \
  --svg-out=/tmp/nearcast-radar-current-vs-latest-mrms-conus-edge-zooms.svg
```

What the renderer currently supports:

- GRIB2 grid definition template `3.0` latitude/longitude grids.
- GRIB2 data representation template `5.41` PNG-compressed values.
- Embedded 16-bit grayscale PNG extraction and decoding.
- GRIB scale-factor conversion back to dBZ-like values.
- Bilinear data-space sampling into a local Web Mercator viewport.
- Optional Gaussian data-space smoothing before threshold/color.
- `--focus=max` and `--focus=edge` to quickly find hard visual test cases.
- `--style=banded` for a raw-radar-derived look with discrete dBZ bands and
  subtle intensity separator lines.
- `--style=resolved` for a more polished, high-specificity field style.
- `--compare` for side-by-side continuous, banded, smoothed, and resolved panels.
- `--compare-current-zooms` for a zoom ladder that compares the current
  Nearcast-style NOAA WMS radar column against MRMS raw, banded, and resolved
  columns.
- `--bounds=minLat,minLon,maxLat,maxLon` to constrain `--focus=max` or
  `--focus=edge` to the current map source's useful coverage.
- Simple radar colorization into a PNG preview.

Early read:

- The `MergedReflectivityQCComposite_00.50` product inspected here uses a
  `7000 x 3500` grid at roughly `0.01` degree spacing.
- It stores values as GRIB2 template `5.41`, with a 16-bit grayscale PNG payload.
- No-echo values need to be normalized before interpolation; otherwise edge
  rendering stair-steps badly.
- A small data-space smoothing kernel makes edges more intentional, but deep
  zoom still needs product/style tuning because the public MRMS source grid is
  finite resolution.
- The first resolved-field direction was `resolved`: saturated green to
  yellow/orange field rendering with stronger opacity and smoother source-space
  sampling. It looks more premium, but can hide some raw radar structure.
- The newer `banded` direction starts from the raw continuous look and makes the
  dBZ transitions legible with wider discrete color bands plus subtle separator
  isolines. This may preserve more meaning while avoiding both the blurry read
  of a fully continuous gradient and the fake precision of dense contour rings.
- The current-vs-MRMS zoom ladder should be generated with a fresh MRMS frame,
  not an old local file, when the goal is visual comparison against live NOAA
  WMS. Pin `--wms-time` only when the WMS source actually exposes the same
  timestamp as the local MRMS frame.

Current local heavy-tool gap:

- `wgrib2` is not installed.
- `gdal_translate` is not installed.
- Python `pygrib`, `eccodes`, `cfgrib`, `PIL`, and `osgeo` are not installed.
- Python `numpy` is installed.

The dependency-free path is enough for the first visual quality spike. We may
still want `wgrib2` or ecCodes before production if we need broader product
support, reprojection, metadata validation, or automated tile generation.

## Step 3: publish a live static tile snapshot

The app stays static. A publisher job generates radar tiles and a manifest just
before deployment:

```bash
node scripts/mrms-prototype/publish-mrms-live.mjs --profile=metro-east
node scripts/mrms-prototype/publish-mrms-live.mjs --profiles=metro-east,great-falls
node scripts/mrms-prototype/publish-mrms-live.mjs --profiles=metro-east,great-falls --skip-empty-tiles
node scripts/mrms-prototype/publish-mrms-live.mjs --profiles=metro-east,great-falls --tile-url-base=https://radar.example.com/mrms
node scripts/mrms-prototype/publish-mrms-live.mjs --profile=metro-east --encoded-tiles
node scripts/mrms-prototype/generate-mrms-timeline.mjs --frames=1 --lat=38.7237 --lon=-89.9559 --tile-radius=1 --encoded-tiles --sample
```

Defaults:

- Profile: `metro-east`
- Bounds: `38.35,-90.65,39.25,-89.25`
- Frames: `6`
- Zooms: `6-13`
- Manifest: `radar/mrms/manifest.json`
- Index: `radar/mrms/index.json`
- Tile root: `radar/mrms/live/`
- Empty tiles: skipped in CI by default so transparent no-radar PNGs do not
  consume static asset slots.
- Encoded tiles: optional compact `data/{z}/{x}/{y}.png` dBZ-value tiles that
  let the browser colorize generated radar on the user's device while keeping
  the existing colored PNG tiles as fallback.
- Targeted fixtures: `--lat` and `--lon` switch the timeline wrapper from
  max-storm focus to a fixed point unless `--focus` is explicitly provided.

Useful profiles:

- `metro-east`: Maryville/Edwardsville/St. Louis test coverage.
- `great-falls`: Great Falls, Montana test coverage.
- `swaledale`: Swaledale, Iowa test coverage.

`radar/mrms/live/` is intentionally ignored by Git. The GitHub Actions publisher
deploys those generated files as static Cloudflare assets without committing
them.

Before rendering, the publisher can run a cheap source-resolution pass and
compare it to the current deployed manifest:

```bash
node scripts/mrms-prototype/publish-mrms-live.mjs \
  --profile=metro-east \
  --current-manifest-url=https://getnearcast.app/radar/mrms/manifest.json \
  --summary-out=/tmp/nearcast-mrms-publish-summary.json
```

The generated manifest includes:

- `source`: NOAA MRMS objects used for the frame set, plus a source signature.
- `renderConfig`: the coverage, zoom, style, and freshness inputs that affect
  the generated output.
- `publishFingerprint`: a stable hash of source plus render config. The
  publisher uses this to skip wasteful regeneration when nothing meaningful has
  changed.
- `metrics`: generation time and tile-count totals for CI/ops visibility.

The generated index includes one or more location-aware packs:

- `provider`: `nearcast-generated-radar-index`
- `packs[].manifestUrl`: manifest to load for that generated coverage area.
- `packs[].coverageBounds` / `coverageAreas`: where the pack is safe to use.
- `packs[].expiresAt`, `frameCount`, and `metrics`: routing and operations
  metadata.

The app checks this index before loading the legacy manifest path. In a
multi-profile run, the first profile stays at `radar/mrms/manifest.json` for
compatibility, additional manifests live under `radar/mrms/packs/<profile>/`,
and tiles live under `radar/mrms/live/<profile>/`. The same shape can later
point to many R2/CDN packs for different U.S. regions.

When `--tile-url-base` is provided, the publisher appends the profile id and
each frame id to that public root. A generated frame URL becomes:

```text
https://radar.example.com/mrms/great-falls/20260629-022439z/{z}/{x}/{y}.png?v=...
```

When `--encoded-tiles` is enabled, the same frame also advertises:

```text
https://radar.example.com/mrms/great-falls/20260629-022439z/data/{z}/{x}/{y}.png?v=...
```

The generated manifest exposes that template as `frames[].dataUrl` with a
`frames[].dataEncoding` object. Nearcast prefers `dataUrl` in the MapLibre
renderer and colorizes it client-side; older clients and the classic renderer
continue to use the colored `url` template.

The deployed `radar/mrms/index.json` is a routing layer, not just a list. The app
scores packs against the current map viewport, searched place, zoom level,
coverage area, and freshness, then keeps the current layer visible while a
better generated pack loads after pan or zoom.

The frame-substrate publisher follows the same multi-pack contract. A scheduled
CONUS run can publish active-storm source tiles, for example z5-z10, while a
manual canary can add bounded detail packs with `--detail-areas`. Detail specs
are semicolon-separated and use:

```text
id|Label|minLat,minLon,maxLat,maxLon|optionalFocusBounds|optionalZooms
```

Example:

```bash
node scripts/mrms-prototype/publish-mrms-frame-substrate.mjs \
  --tile-zooms=5,6,7,8,9,10 \
  --active-tile-buffer=0 \
  --detail-areas='green-bay|Green Bay|43.8,-89.4,45.2,-87|43,-90,46,-86|11,12'
```

The app does not expose this as a user-facing mode. It simply loads the public
frame index, scores the broad and detail packs, and switches to the best
available pack as the user searches, zooms, or pans.

## Step 4: coverage-engine chunk spike

The frame-substrate publisher is still tile-manifest shaped. The next spike is
lower level: publish numeric radar chunks that a custom WebGL layer can render
as one continuous field across zooms.

Synthetic smoke test:

```bash
node scripts/mrms-prototype/encode-mrms-chunks.mjs \
  --synthetic \
  --bounds=30.35,-88.3,31.25,-87.2 \
  --levels=8,9,10 \
  --base-zoom=10 \
  --pool=max \
  --out-dir=/tmp/nearcast-radar-chunks-smoke \
  --index-out=/tmp/nearcast-radar-chunks-smoke/index.json \
  --summary-out=/tmp/nearcast-radar-chunks-smoke/summary.json
```

Live MRMS shape once a storm frame is worth testing:

```bash
node scripts/mrms-prototype/encode-mrms-chunks.mjs \
  --product=MergedReflectivityQCComposite_00.50 \
  --bounds=30.35,-88.3,31.25,-87.2 \
  --levels=8,9,10 \
  --base-zoom=10 \
  --pool=max \
  --out-dir=/tmp/nearcast-radar-chunks-live \
  --index-out=/tmp/nearcast-radar-chunks-live/index.json
```

The script writes a small `index.json` plus gzip-compressed binary chunks at
`chunks/z{level}/{x}/{y}.ncrd.gz`. Chunks are `Uint8` dBZ fields by default,
not colored PNGs. `0` means no visible precip/no data; `1..255` maps across the
configured dBZ range. Empty chunks are skipped unless `--write-empty` is set.

This is the bridge toward the target custom WebGL radar layer described in
`docs/radar-coverage-engine-spike.md`.

This changes only the manifest contract. The renderer still writes local tile
files first. The GitHub Actions workflow can then upload those files to R2 and
remove the local tile directory before Worker deploy when
`MRMS_TILE_UPLOAD_MODE=r2`.

R2 upload dry run:

```bash
node scripts/mrms-prototype/upload-mrms-r2.mjs \
  --dir=radar/mrms/live \
  --bucket=nearcast-radar \
  --prefix=mrms \
  --dry-run
```

Production R2 mode expects:

- `MRMS_TILE_UPLOAD_MODE=r2`
- `MRMS_TILE_URL_BASE`, for example `https://radar.getnearcast.app/mrms`
- `MRMS_R2_BUCKET`
- `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as GitHub secrets

The GitHub Actions publisher also checks generated file count before deploying:

```bash
node scripts/mrms-prototype/check-mrms-asset-budget.mjs --limit=19500
```

That budget leaves room under the current Workers static asset file ceiling for
the app shell. In R2 upload mode, local tile PNGs are removed before this check,
so the Worker asset budget applies mostly to the app shell and radar manifests.
That is the sustainable path for more regions, longer history, and future
forecast tiles.

For dry inspection without writing tiles:

```bash
node scripts/mrms-prototype/generate-mrms-timeline.mjs \
  --frames=6 \
  --tile-bounds=38.35,-90.65,39.25,-89.25 \
  --resolve-only
```

## Success bar

- The same weather moment looks materially better than NOAA WMS from z7.5 to
  z13.
- We can explain the rendering honestly: smoothing is applied to values before
  colorization, not used to invent block-level precision.
- Output can become CDN-served tiles or textures that MapLibre can consume.
