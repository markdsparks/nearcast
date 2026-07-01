# Generated MRMS spike archive

Status: paused from the main product path as of `v3.0.107`.

## Decision

The generated MRMS radar work proved that Nearcast can create a better-looking
radar surface from public numeric weather data, especially when encoded tiles
are rendered on device with a WebGL shader. It also proved that chasing massive
deep-zoom detail is not worth the operational cost and complexity for the main
consumer app right now.

The main app should return to the free WebGL radar path:

- WebGL map renderer remains the default.
- Auto radar uses free NOAA/NWS radar first, with RainViewer as the fallback.
- Generated MRMS is no longer part of normal Auto routing.
- Generated MRMS remains available only through explicit experiment flags and
  debug URLs.

## What We Learned

The promising parts:

- Public NOAA MRMS data can be decoded into useful numeric radar fields.
- Encoded dBZ tiles are much better than pre-colored PNGs for iteration because
  color, opacity, smoothing, and deep-zoom styling can change in the app.
- A z7-z10 broad substrate plus z11-z12 detail packs can look good enough to
  evaluate the product experience.
- The shader pass made street zoom more pleasant without generating z13-z18
  image pyramids.
- R2 storage cost is small; storage itself is not the blocker.

The hard parts:

- A storm moves too quickly for on-demand viewport generation to feel reliable.
- A national 2-minute frame cadence creates constant object churn.
- z7-z10, z11-z12, and overzoomed street views still have visual discontinuity
  compared with a premium map vendor.
- Running this as a real production substrate likely lands around a few hundred
  dollars per month before global coverage or commercial data.
- The experience is not obviously better enough to justify that spend for the
  current product stage.

## Cost Posture

Target-architecture estimate for CONUS-only MRMS:

- Expected: about `$250-$300/month`.
- Reasonable range: `$150-$500/month`.
- Higher traffic or broader detail generation can push beyond that.

The main costs are generation compute, publish/write operations, read volume,
monitoring, and operational care. R2 storage remains comparatively cheap.

## Kept Artifacts

Code and scripts remain in place so the idea is not lost:

- `docs/radar-architecture.md`
- `docs/radar-substrate-spike.md`
- `docs/radar-coverage-engine-spike.md`
- `scripts/mrms-prototype/`
- `.github/workflows/publish-mrms-frame-substrate.yml`
- `.github/workflows/process-pending-radar-generation-plans.yml`
- `.github/workflows/radar-generation-r2-preview.yml`
- MapLibre generated-radar protocols and shader code in `map.js`

Scheduled generation should stay disabled while this is parked:

- `ENABLE_MRMS_FRAME_SUBSTRATE=false`
- `ENABLE_MRMS_FRAME_SUBSTRATE_HEALTH=false`
- `ENABLE_MRMS_PUBLISH=false`
- `ENABLE_RADAR_GENERATION_RUNNER=false`

The app also keeps explicit debug access for radar chunks:

```text
?map=gl&radarChunks=nebraska&mapPerf=current
```

Generated MRMS provider routing is now intentionally gated:

```text
?generatedRadar=1&radarProvider=mrms-generated
```

Without that explicit experiment flag, stored/generated provider preferences are
ignored and the app falls back to free radar coverage.

## Revival Criteria

Revisit this path if at least one of these becomes true:

- We need a premium radar experience as a paid/pro differentiator.
- Usage or retention data says radar quality is one of the top purchase drivers.
- A cheaper production worker architecture can run the CONUS substrate for well
  under `$100/month`.
- A provider bake-off shows commercial radar maps cost more than building while
  delivering less control.
- Saved-place storm detail becomes a clear product wedge and can be generated
  selectively without national-scale churn.

## Main-App Rule

Generated MRMS should not re-enter normal Auto radar until it can satisfy all of
these:

- No persistent "enhancing radar" state.
- No visual mode switching as the user zooms.
- No user-visible blanking or stale-frame confusion.
- Clear operating cost below the value it creates.
- A production runner independent from app deploys and GitHub Actions timing.
