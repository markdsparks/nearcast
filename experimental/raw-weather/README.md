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
  maxFrames: 10,
  onFrame(frame, progress) {
    // frame.data is a transferable Uint8Array numeric dBZ texture.
  }
});
client.destroy();
```

The default history budget is 8 MB of retained texture data, with hard caps of
16 frames, 1024 pixels per side, and 1,048,576 pixels per texture. Frames are
decoded serially. Set `retainTextures: false` and consume `onFrame` to keep only
the frame currently being uploaded to the GPU.

Encoding `0` means no data/no visible echo. Values `1…255` use:

```text
dbz = dbzMin + (value - 1) * (dbzMax - dbzMin) / 254
```

The texture rows are sampled in Web Mercator between the returned geographic
bounds, so a MapLibre bounds quad can use them without latitude stretching.

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
