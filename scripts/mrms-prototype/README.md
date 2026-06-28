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

Current local tool gap:

- `wgrib2` is not installed.
- `gdal_translate` is not installed.
- Python `pygrib`, `eccodes`, `cfgrib`, `PIL`, and `osgeo` are not installed.
- Python `numpy` is installed.

The preferred next spike is to add a local/container decode path using either
`wgrib2` or ecCodes, then output a single PNG/WebP viewport for Maryville at
z9, z11, and z13 before we generate tiles.

## Success bar

- The same weather moment looks materially better than NOAA WMS from z7.5 to
  z13.
- We can explain the rendering honestly: smoothing is applied to values before
  colorization, not used to invent block-level precision.
- Output can become CDN-served tiles or textures that MapLibre can consume.
