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
  --style=resolved \
  --out=/tmp/nearcast-mrms-edge-z11.png

node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --focus=edge \
  --zoom=11 \
  --style=resolved \
  --compare \
  --out=/tmp/nearcast-mrms-style-compare-z11.png
```

What the renderer currently supports:

- GRIB2 grid definition template `3.0` latitude/longitude grids.
- GRIB2 data representation template `5.41` PNG-compressed values.
- Embedded 16-bit grayscale PNG extraction and decoding.
- GRIB scale-factor conversion back to dBZ-like values.
- Bilinear data-space sampling into a local Web Mercator viewport.
- Optional Gaussian data-space smoothing before threshold/color.
- `--focus=max` and `--focus=edge` to quickly find hard visual test cases.
- `--style=resolved` for a more polished, high-specificity field style.
- `--compare` for side-by-side continuous, smoothed, and resolved panels.
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
- The best current visual direction is the `resolved` style: saturated green to
  yellow/orange field rendering with stronger opacity and smoother source-space
  sampling. It looks more like a premium radar product without pretending the
  raw grid has road-level certainty.
- Explicit contour bands (`--band-step`) are available, but they are not the
  default because obvious rings make the image feel manufactured.

Current local heavy-tool gap:

- `wgrib2` is not installed.
- `gdal_translate` is not installed.
- Python `pygrib`, `eccodes`, `cfgrib`, `PIL`, and `osgeo` are not installed.
- Python `numpy` is installed.

The dependency-free path is enough for the first visual quality spike. We may
still want `wgrib2` or ecCodes before production if we need broader product
support, reprojection, metadata validation, or automated tile generation.

## Success bar

- The same weather moment looks materially better than NOAA WMS from z7.5 to
  z13.
- We can explain the rendering honestly: smoothing is applied to values before
  colorization, not used to invent block-level precision.
- Output can become CDN-served tiles or textures that MapLibre can consume.
