# Radar provider bake-off

This folder defines the provider spike before we wire a commercial weather
renderer into the live app.

## First candidate

Start with Xweather MapsGL because it is built around WebGL weather rendering,
supports MapLibre, and describes client-side rendering from weather data rather
than static imagery. That is the exact capability missing from the current WMS
path.

## Required before app integration

- Trial or sandbox key.
- Written terms for public browser/PWA key usage.
- Pricing for expected public traffic.
- Attribution requirements.
- Caching and replay rules for radar animation frames.
- Confirmation that the provider exposes enough point/raster data for Nearcast
  truth language, not just a pretty layer.

If browser keys are not permitted, the spike moves behind a Cloudflare Worker
proxy instead of exposing credentials in static assets.

## Adapter contract

Any provider adapter should enter through a single radar-provider seam:

```text
radarProvider = noaa-wms | xweather-mapsgl | mrms-generated
```

The adapter needs to provide:

- A MapLibre layer setup function.
- A frame/timeline model compatible with the current radar scrubber.
- Attribution text.
- Readiness/error state for the existing diagnostic UI.
- A way to sample or query precipitation near a lat/lon, or a documented
  fallback to the current radar-truth sampling.

`mrms-generated` now enters through the same frame contract by reading
`radar/mrms/manifest.json`. A generated manifest should expose frames like:

```json
{
  "provider": "mrms-generated",
  "style": "banded",
  "generatedAt": "2026-06-28T17:36:07Z",
  "minZoom": 4,
  "maxZoom": 14,
  "frames": [
    {
      "time": "2026-06-28T17:36:07Z",
      "url": "./sample-mrms-banded-max/{z}/{x}/{y}.png"
    }
  ]
}
```

Generate a bounded test tile set with:

```sh
node scripts/mrms-prototype/render-mrms-preview.mjs \
  --file=/tmp/nearcast-mrms-reflectivity.grib2.gz \
  --generate-tiles \
  --style=banded \
  --focus=max \
  --bounds=25,-125,49,-70 \
  --tile-zooms=6,7,8,9,10,11,12,13,14 \
  --tile-radius=2 \
  --frame-id=sample-mrms-banded-max \
  --tile-out=radar/mrms/sample-mrms-banded-max \
  --manifest-out=radar/mrms/manifest.json
```

## Test matrix

Use the same places, frames, and zoom bands for every provider:

- Maryville, Illinois during active precip.
- A heavy storm case where NOAA WMS currently looks blocky.
- A light rain/drizzle case where visual exaggeration would be misleading.
- A clear/no-rain case to verify the map does not add visual noise.
- Zoom levels: z7.5, z9, z11, z13, z16, z18.
- Modes: preview map and immersive map in iOS PWA.

## Pass/fail

Pass:

- z7.5-z13 quality is visibly better than NOAA WMS.
- Pan/zoom stays close to the blank MapLibre baseline.
- Radar animation does not flicker or blank between frames.
- Labels and saved-place markers remain readable.
- Terms and cost make sense for a small public PWA.

Fail:

- The provider is only another raster tile source with prettier colors.
- Browser credentials are not allowed and the proxy cost/complexity outweighs
  the quality gain.
- Animation quality is worse than our current buffered MapLibre implementation.
