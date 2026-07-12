# Browser-side MRMS historical proof

This bounded browser decoder lists public NOAA MRMS frames, downloads one
compressed GRIB2 object at a time, and returns a viewport-sized numeric dBZ
texture. Nearcast's guarded raw-map prototype uses it for observed history;
the normal NOAA/RainViewer map remains visible whenever this path is disabled
or unavailable.

Enable the full MRMS + HRRR experiment on a CONUS place with:

```text
?debugSettings=1&rawWeather=both
```

`rawWeather=observed` and `rawWeather=forecast` isolate either source. The
query is intentionally non-sticky and ignored unless debug settings are also
enabled.

The existing native deep-link router preserves both query items, so a
TestFlight install can open the deployed experiment without a new binary:

```text
nearcast://weather?debugSettings=1&rawWeather=both
```

## Why the worker streams rows

The current composite-reflectivity product is a `7000 x 3500` regular grid.
Its public object is usually around 1–2 MB, but the embedded 16-bit PNG expands
to about 49 MB. Creating a `Uint16Array` and then a `Float32Array` would briefly
cost roughly 147 MB before the map texture and browser overhead.

`mrms-browser-worker.js` instead reconstructs PNG scanlines sequentially. It
keeps only two 14 KB source rows and the bounded output texture. It decodes only
as far south as the requested viewport, although PNG filters require it to walk
all preceding rows.

## Public API

Load `mrms-browser-adapter.js` as a classic script. It installs
`window.NearcastMrms`:

```js
const client = NearcastMrms.createClient();
const history = await client.loadHistory({
  bounds: { minLat: 38.35, minLon: -90.65, maxLat: 39.25, maxLon: -89.25 },
  width: 512,
  height: 384,
  minutes: 90,
  // Canonical scrub targets select the nearest unique MRMS objects. The
  // returned frame times remain the actual MRMS observation times.
  targetTimes: observedScrubTimes,
  maxFrames: observedScrubTimes.length,
  onFrame(frame, progress) {
    // frame.data is a transferable Uint8Array numeric dBZ texture.
  }
});
client.destroy();
```

The default history budget is 8 MB of retained texture data, with hard caps of
24 frames, 1024 pixels per side, and 1,048,576 pixels per texture. A conservative
two-worker pool decodes at most two source objects concurrently; pass
`workerCount: 1` to `createClient()` for constrained devices. Values above two
are capped. Newest/current-neighbor frames are scheduled first, while the final
`history.frames` array remains chronological. Set `retainTextures: false` and
consume `onFrame` to keep only the frame currently being uploaded to the GPU.
Callers resuming around an older scrub point may pass `priorityTime` to schedule
that observation and its nearest neighbors before the rest of the history.

`targetTimes` accepts dates, timestamps, ISO strings, or objects containing
`validTime`, `timestamp`, `time`, or `observedAt`. The adapter resolves every
target to the nearest source object within `targetToleranceMinutes` (six minutes
by default), then deduplicates object keys before download and decode. Without
targets, the original evenly sampled `maxFrames` behavior remains unchanged.

The raw-map runtime exposes the same selection as
`session.prepare({ observedTimes })`. It can also generate a canonical sequence,
for example `historyMinutes: 90, historyStepMinutes: 5`, which produces 19
targets from `-90m` through `Now`. Array-valued `historyFrames` remains available
as a compatibility alias for explicit target times; numeric `historyFrames`
retains its existing meaning.

Encoding `0` means no data/no visible echo. Values `1…255` use:

```text
dbz = dbzMin + (value - 1) * (dbzMax - dbzMin) / 254
```

The texture rows are sampled in Web Mercator between the returned geographic
bounds, so a MapLibre bounds quad can use them without latitude stretching.

## HRRR quarter-hour forecast

`hrrr-subhourly-adapter.js` installs `window.NearcastHrrrSubhourly`. It maps
requested forecast targets to real HRRR quarter-hour valid times, reads the
official `.idx` files, and range-fetches only the `REFC` messages from NOAA's
public HRRR archive:

```js
const client = NearcastHrrrSubhourly.createClient();
const forecast = await client.loadForecast({
  validTimes: forecastScrubTimes, // for example +15m through +3h
  bounds: { minLat: 38.35, minLon: -90.65, maxLat: 39.25, maxLon: -89.25 },
  width: 512,
  height: 384,
  onFrame(frame, progress) {
    // frame.validTime is the actual HRRR valid time, not a synthetic target.
  }
});
client.destroy();
```

The dedicated worker supports the operational HRRR Lambert grid (`3.30`) and
complex packing with second-order spatial differencing (`5.3`). It unpacks one
national integer field at a time, resamples it directly into the viewport
texture, then releases the national field. A live twelve-frame `+15m…+3h`
smoke used roughly 230–343 KB per range request and completed in about four
seconds on the development Mac.

When explicit forecast valid times are supplied, `raw-map-runtime.js` prefers
this provider and returns `noaa-hrrr-subhourly` descriptors. The existing
hourly HRRR Zarr adapter remains the fallback if discovery, range fetching, or
decoding fails.

## Smoke test

Serve the repository over HTTP and open:

```text
/experimental/raw-weather/mrms-browser-smoke.html
```

The page uses the live public S3 listing and frame objects. The NOAA bucket
currently permits cross-origin GET and HEAD requests.

The same decode path can be exercised without a browser UI on a recent Node
runtime that provides the browser Streams APIs:

```bash
node experimental/raw-weather/mrms-browser-worker-smoke.mjs
node experimental/raw-weather/mrms-target-times-smoke.mjs
node experimental/raw-weather/mrms-worker-pool-smoke.mjs
# Optional live, two-frame sequential-versus-pooled comparison:
node experimental/raw-weather/mrms-worker-pool-live-smoke.mjs
node experimental/raw-weather/hrrr-subhourly-fixtures.mjs
node experimental/raw-weather/hrrr-subhourly-runtime-smoke.mjs
node experimental/raw-weather/hrrr-subhourly-smoke.mjs --frames=12
```

## Deliberate limits

- Only public `CONUS` objects from `noaa-mrms-pds.s3.amazonaws.com` are allowed.
- Only GRIB2 grid template `3.0`, data representation `5.41`, no bitmap, and a
  non-interlaced 16-bit grayscale embedded PNG are accepted. These match the
  inspected `MergedReflectivityQCComposite_00.50` frames.
- No Gaussian smoothing is performed in the decoder. Bilinear source sampling
  is applied; visual smoothing and colorization belong in the existing GPU
  shader.
- A browser must provide Web Workers, Streams, and `DecompressionStream` for
  both outer gzip and embedded PNG deflate. The production map should leave its
  current radar visible when these capabilities or raw frames are unavailable.
- This proof transfers compact textures back to the main thread. It never
  retains a full decoded national grid or multiple full source fields.
