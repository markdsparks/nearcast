#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rawMap = require("../raw-map-runtime.js");
const hrrrAdapter = require("../hrrr-zarr-adapter.js");

const width = 64;
const height = 64;
const nowMs = Date.parse("2026-07-11T12:00:00.000Z");
const observedTargets = Array.from({ length: 19 }, (_, index) => (
  new Date(nowMs - (18 - index) * 5 * 60_000).toISOString()
));
const observedSourceTimes = observedTargets.map((value, index) => (
  new Date(Date.parse(value) + (index % 2 ? 75_000 : 45_000)).toISOString()
));
const forecastSourceTimes = Array.from({ length: 12 }, (_, index) => (
  new Date(nowMs + (index + 1) * 15 * 60_000).toISOString()
));
const hourlyForecastTimes = Array.from({ length: 6 }, (_, index) => (
  new Date(nowMs + (index + 1) * 60 * 60_000).toISOString()
));
const encoding = {
  type: "uint8-dbz",
  dbzMin: 0,
  dbzMax: 80,
  threshold: 5,
  noData: 0,
  valueMin: 1,
  valueMax: 255
};

let observedLoadOptions = null;
const mrms = {
  createClient() {
    return {
      async loadHistory(options) {
        observedLoadOptions = options;
        return {
          attribution: "NOAA/NWS MRMS",
          product: "MergedReflectivityQCComposite_00.50",
          region: "CONUS",
          frames: observedSourceTimes.map((observedAt, index) => ({
            observedAt,
            data: new Uint8Array(width * height).fill(72 + index),
            encoding,
            sourceUrl: `https://example.test/mrms-${index}.grib2.gz`,
            metrics: { precipPixels: width * height }
          }))
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};

let hourlyFallbackCreateCalls = 0;
const hrrr = {
  projectLonLat(lon, lat) {
    return { x: lon, y: lat };
  },
  createClient() {
    hourlyFallbackCreateCalls += 1;
    return {
      async discoverLatestRun() {
        return {
          level: "entire_atmosphere",
          variable: "REFC",
          cycle: "20260711_12z",
          cycleIso: new Date(nowMs).toISOString()
        };
      },
      async loadGrid() {
        return {
          x: new Float64Array([0, 1]),
          y: new Float64Array([0, 1]),
          xSpacing: 1,
          ySpacing: 1,
          projection: {}
        };
      },
      async fetchVisible() {
        return {
          steps: forecastSourceTimes.map((validIso, index) => ({
            validIso,
            forecastHour: index + 1,
            sourceIndex: index + 1
          })),
          chunks: [{
            key: "0.0.0",
            chunkX: 0,
            chunkY: 0,
            gridOffsetX: 0,
            gridOffsetY: 0,
            width: 2,
            height: 2,
            logicalWidth: 2,
            logicalHeight: 2,
            shape: [forecastSourceTimes.length, 2, 2],
            values: new Float32Array(forecastSourceTimes.flatMap((_, index) => (
              [20 + index, 22 + index, 24 + index, 26 + index]
            )))
          }]
        };
      },
      clearCache() {}
    };
  }
};

let subhourlyLoadOptions = null;
const hrrrSubhourly = {
  createClient() {
    return {
      async loadForecast(options) {
        subhourlyLoadOptions = options;
        return {
          provider: "noaa-hrrr-subhourly",
          attribution: "NOAA/NWS HRRR",
          cycleTime: new Date(nowMs).toISOString(),
          frames: forecastSourceTimes.map((validTime, index) => ({
            provider: "noaa-hrrr-subhourly",
            validTime,
            cycleTime: new Date(nowMs).toISOString(),
            forecastMinutes: (index + 1) * 15,
            data: new Uint8Array(width * height).fill(84 + index),
            encoding,
            metrics: {
              precipPixels: width * height,
              outputPixels: width * height,
              minDbz: 18 + index,
              maxDbz: 30 + index
            }
          }))
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};

const session = rawMap.createSession({
  mode: "both",
  width,
  height,
  mrms,
  hrrr,
  hrrrSubhourly
});
const result = await session.prepare({
  bounds: [0, 0, 1, 1],
  observedTimes: observedTargets,
  observedNow: new Date(nowMs).toISOString(),
  forecastFrames: forecastSourceTimes.map((validTime) => ({ validTime })),
  width,
  height
});

assert.equal(result.status, "ready");
assert.deepEqual(
  observedLoadOptions?.targetTimes,
  observedTargets,
  "the runtime forwards every canonical observed scrub target to MRMS"
);
assert.equal(observedLoadOptions?.maxFrames, observedTargets.length);
assert.equal(result.observed.length, observedTargets.length, "raw observed data covers every scrub target");
assert.deepEqual(
  result.observed.map((frame) => frame.validTime),
  observedSourceTimes,
  "observed descriptors retain actual MRMS valid times rather than synthetic target times"
);
assert.deepEqual(
  result.forecast.map((frame) => frame.validTime),
  forecastSourceTimes,
  "future descriptors are the real HRRR valid times"
);
assert.ok(result.forecast.every((frame) => frame.provider === "noaa-hrrr-subhourly"));
assert.deepEqual(
  subhourlyLoadOptions?.validTimes.map((value) => value.toISOString()),
  forecastSourceTimes,
  "the runtime forwards the canonical quarter-hour targets to sub-hourly HRRR"
);
assert.equal(hourlyFallbackCreateCalls, 0, "hourly Zarr is not mixed into a successful sub-hourly timeline");

const hrrrSelectionClient = hrrrAdapter.createClient({
  fetch: async () => {
    throw new Error("selection-only smoke should not fetch");
  }
});
const selectedHrrrSteps = hrrrSelectionClient.selectSteps({
  steps: Array.from({ length: 10 }, (_, index) => ({
    sourceIndex: index,
    forecastHour: index,
    validTime: new Date(nowMs + index * 60 * 60_000)
  }))
}, {
  validTimes: hourlyForecastTimes
});
assert.deepEqual(
  selectedHrrrSteps.map((step) => step.validTime.toISOString()),
  hourlyForecastTimes,
  "HRRR valid-time selection returns only real requested model steps"
);

const mapHarness = createMapHarness();
const mapSource = fs.readFileSync(new URL("../map.js", import.meta.url), "utf8");
await verifyGeneratedRadarRefreshOwnershipRace(mapSource);
const renderWeatherSource = extractFunction(mapSource, "renderMapLibreWeather");
assert.ok(
  renderWeatherSource.indexOf("syncMapLibreRadarChunkLayer") < renderWeatherSource.indexOf("syncMapLibreWeatherSlots"),
  "raw frame switching happens before raster source changes can make the MapLibre style temporarily unsettled"
);
assert.equal(
  mapHarness.shouldRefreshGeneratedRadarForViewport(),
  true,
  "generated radar can refresh before a raw-map session owns the timeline"
);
mapHarness.mapState.rawMap.session = {};
assert.equal(
  mapHarness.shouldRefreshGeneratedRadarForViewport(),
  false,
  "generated radar does not race an active raw-map session"
);
mapHarness.mapState.rawMap.session = null;
mapHarness.mapState.frames = [{ rawMapCanonical: true }];
assert.equal(
  mapHarness.shouldRefreshGeneratedRadarForViewport(),
  false,
  "generated radar does not replace a canonical raw-map timeline"
);
mapHarness.mapState.frames = [];
const selectionNowMs = nowMs + 7 * 60_000;
const observedSelectionTargets = mapHarness.rawMapObservedTargetTimes(selectionNowMs);
const forecastSelectionTargets = mapHarness.rawMapForecastTargetTimes(selectionNowMs);
assert.equal(observedSelectionTargets.length, 19);
assert.equal(observedSelectionTargets[0], "2026-07-11T10:35:00.000Z");
assert.equal(observedSelectionTargets.at(-1), "2026-07-11T12:05:00.000Z");
assert.equal(forecastSelectionTargets[0], "2026-07-11T12:15:00.000Z");
assert.equal(forecastSelectionTargets.at(-1), "2026-07-11T15:00:00.000Z");
assertCadence(observedSelectionTargets, 5, "observed selection cadence");
assertCadence(forecastSelectionTargets, 15, "forecast selection cadence");

const fallbackObservedTargets = observedTargets.slice(6);
mapHarness.mapState.frames = [
  ...fallbackObservedTargets.map((time, index) => ({
    id: `observed-${index}`,
    source: "radar",
    timestamp: Date.parse(time),
    observedTimestamp: Date.parse(time),
    url: `https://example.test/nws-radar-${index}/{z}/{x}/{y}.png`,
    visualMetric: "reflectivity"
  })),
  ...Array.from({ length: 12 }, (_, index) => ({
    id: `ndfd-${index}`,
    source: "forecast",
    timestamp: nowMs + (index + 1) * 60 * 60_000,
    url: `https://example.test/ndfd-${index}/{z}/{x}/{y}.png`,
    layers: [{
      url: `https://example.test/ndfd-${index}/{z}/{x}/{y}.png`,
      opacity: 0.78
    }],
    visualMetric: "accumulation"
  }))
];
mapHarness.mapState.timelineKind = "precip";
mapHarness.mapState.nowIndex = fallbackObservedTargets.length - 1;
mapHarness.mapState.frameIndex = mapHarness.mapState.nowIndex;
assert.equal(
  mapHarness.standardTimelineSliderValueForFrame(mapHarness.mapState.nowIndex),
  mapHarness.mapState.nowIndex,
  "the long mixed NDFD fallback keeps its usable frame-index slider until a complete raw timeline is ready"
);

const matched = mapHarness.applyRawMapEnhancement(result);
const canonicalObserved = mapHarness.mapState.frames.filter((frame) => frame.source === "radar");
const canonicalForecast = mapHarness.mapState.frames.filter((frame) => frame.source === "forecast");

assert.equal(matched, observedSourceTimes.length + forecastSourceTimes.length);
assert.equal(canonicalObserved.length, observedTargets.length);
assert.ok(
  canonicalObserved.every((frame) => frame.rawMapProvider === "noaa-mrms-direct"),
  "every observed slider position has a raw MRMS render target"
);
assert.deepEqual(
  Array.from(canonicalObserved, (frame) => frame.rawMapValidTime),
  observedSourceTimes,
  "observed slider slots remain explicitly tied to real MRMS valid times"
);
assert.ok(
  canonicalObserved.filter((frame) => !frame.isNow).every((frame) => (
    frame.timestamp === Date.parse(frame.rawMapValidTime)
  )),
  "non-Now observed slider positions use actual MRMS source times"
);
assert.ok(
  canonicalObserved.slice(0, 5).every((frame) => !frame.url && !frame.layers),
  "raw history outside the fallback time tolerance never shows a mislabeled stale radar tile"
);
assert.ok(
  canonicalObserved.slice(5).every((frame) => Boolean(frame.url)),
  "nearby observed frames retain a time-aligned warming fallback"
);
assert.equal(
  canonicalForecast.length,
  forecastSourceTimes.length,
  "successful HRRR guidance removes synthetic NDFD-only future slider points"
);
assert.ok(
  canonicalForecast.every((frame) => frame.rawMapProvider === "noaa-hrrr-subhourly"),
  "the canonical future domain is coherently HRRR-only"
);
assert.deepEqual(
  Array.from(canonicalForecast, (frame) => frame.rawMapValidTime),
  forecastSourceTimes,
  "future slider positions retain actual HRRR valid times"
);
assert.ok(
  canonicalForecast.every((frame) => frame.timestamp === Date.parse(frame.rawMapValidTime)),
  "future slider positions use actual HRRR source times"
);
assert.ok(
  canonicalForecast.every((frame) => (
    frame.rawMapNoRasterFallback === true
    && !frame.url
    && !frame.dataUrl
    && !frame.layers
  )),
  "canonical HRRR frames contain no NDFD raster payload to mix pointwise"
);

const sliderValues = Array.from(mapHarness.mapState.frames, (_, index) => (
  mapHarness.standardTimelineSliderValueForFrame(index)
));
assert.ok(
  sliderValues.every((value, index) => index === 0 || value > sliderValues[index - 1]),
  "the time-domain slider is strictly monotonic across irregular real source times"
);
sliderValues.forEach((value, index) => {
  assert.equal(
    mapHarness.standardTimelineFrameIndexForSliderValue(value),
    index,
    `slider value round-trips to canonical frame ${index}`
  );
});

const forecastFrame = canonicalForecast[0];
mapHarness.mapState.frameIndex = mapHarness.mapState.frames.indexOf(forecastFrame);
const forecastRecord = rawRendererRecord({
  indexUrl: forecastFrame.rawMapIndexUrl,
  coverageBounds: { minLon: -91, minLat: 38, maxLon: -89, maxLat: 40 },
  weatherEntries: new Map(),
  paint: new Map()
});
mapHarness.record = forecastRecord;
assert.equal(mapHarness.mapLibreRadarChunkReady(forecastRecord), true);
assert.equal(mapHarness.rawMapFrameLayerVisible(forecastFrame, forecastRecord), true);
assert.equal(mapHarness.rawMapEffectiveVisualMetric(forecastFrame), "reflectivity");
forecastRecord.radarChunkLayerState.index.coverageBounds = {
  minLon: -90.1,
  minLat: 38.6,
  maxLon: -89.9,
  maxLat: 39.0
};
assert.equal(mapHarness.mapLibreRadarChunkReady(forecastRecord), false);
assert.equal(forecastRecord.weatherEntries.size, 0, "an unavailable HRRR frame has no hidden NDFD mix");
assert.equal(mapHarness.rawMapFrameLayerVisible(forecastFrame, forecastRecord), false);
assert.equal(
  mapHarness.rawMapEffectiveVisualMetric(forecastFrame),
  "reflectivity",
  "an HRRR-only frame retains its raw-data legend metric without borrowing an NDFD metric"
);

const observedFrame = canonicalObserved[0];
mapHarness.mapState.frameIndex = mapHarness.mapState.frames.indexOf(observedFrame);
observedFrame.provider = "mrms-generated";
assert.equal(
  mapHarness.maybeSwitchGeneratedRadarToFallback(mapHarness.mapState.frameIndex),
  false,
  "canonical raw frames bypass the legacy generated-radar fallback router"
);
const fallbackEntries = new Map([
  ["radar-a", fallbackEntry("radar-a", "radar-layer-a", 0.62)],
  ["radar-b", fallbackEntry("radar-b", "radar-layer-b", 0.16)]
]);
const paint = new Map();
const record = rawRendererRecord({
  indexUrl: observedFrame.rawMapIndexUrl,
  coverageBounds: { minLon: -91, minLat: 38, maxLon: -89, maxLat: 40 },
  weatherEntries: fallbackEntries,
  paint
});
mapHarness.record = record;

assert.equal(mapHarness.mapLibreRadarChunkReady(record), true);
mapHarness.syncMapLibreRadarChunkFallbackVisibility(record);
assert.deepEqual(
  [...fallbackEntries.values()].map((entry) => paint.get(entry.layerId)),
  [0, 0],
  "a fully ready raw frame hides every raster fallback layer as one atomic surface"
);
assert.equal(mapHarness.rawMapFrameLayerVisible(observedFrame, record), true);

record.radarChunkLayerState.index.coverageBounds = {
  minLon: -90.1,
  minLat: 38.6,
  maxLon: -89.9,
  maxLat: 39.0
};
assert.equal(mapHarness.mapLibreRadarChunkReady(record), false);
mapHarness.syncMapLibreRadarChunkFallbackVisibility(record);
assert.deepEqual(
  [...fallbackEntries.values()].map((entry) => paint.get(entry.layerId)),
  [0.62, 0.16],
  "partial raw coverage restores every fallback layer instead of mixing sources pointwise"
);
assert.equal(mapHarness.rawMapFrameLayerVisible(observedFrame, record), false);

result.dispose();
session.dispose();

console.log(JSON.stringify({
  ok: true,
  observedScrubTargets: canonicalObserved.length,
  hrrrFutureTargets: canonicalForecast.length,
  actualObservedValidTimes: true,
  actualForecastValidTimes: true,
  atomicRawFallbackSwitch: true
}, null, 2));

function fallbackEntry(key, layerId, opacity) {
  return {
    key,
    layerId,
    visible: true,
    lastSpec: { opacity }
  };
}

function assertCadence(values, minutes, label) {
  const expected = minutes * 60_000;
  for (let index = 1; index < values.length; index += 1) {
    assert.equal(Date.parse(values[index]) - Date.parse(values[index - 1]), expected, label);
  }
}

function rawRendererRecord({ indexUrl, coverageBounds, weatherEntries, paint }) {
  const viewport = {
    getWest: () => -90.8,
    getSouth: () => 38.2,
    getEast: () => -89.2,
    getNorth: () => 39.8
  };
  return {
    weatherEntries,
    liveWeatherKeys: new Set(weatherEntries.keys()),
    radarChunkLayerState: {
      indexUrl,
      status: "ready",
      hasSuccessfulDraw: true,
      activeZoom: 0,
      index: { provider: "nearcast-raw-map", coverageBounds },
      chunks: [{ levelZoom: 0, bounds: coverageBounds }],
      map: null
    },
    map: {
      getBounds: () => viewport,
      getLayer: () => ({}),
      setPaintProperty(layerId, property, value) {
        if (property === "raster-opacity") paint.set(layerId, value);
      }
    }
  };
}

function createMapHarness() {
  const source = fs.readFileSync(new URL("../map.js", import.meta.url), "utf8");
  const mapState = {
    initialized: true,
    frames: [],
    frameIndex: 0,
    nowIndex: 0,
    timelineKind: "precip",
    xfadeFrames: [null, null],
    frameWaitIndex: null,
    frameWaitStart: 0,
    rawMap: { fallbackFrames: null, session: null }
  };
  class FixedDate extends Date {
    static now() { return nowMs; }
  }
  const sandbox = {
    mapState,
    state: { activePlace: { latitude: 38.7, longitude: -89.9 } },
    record: null,
    Date: FixedDate,
    MAPLIBRE_RADAR_CHUNK_LAYER_ID: "nearcast-radar-chunks",
    MAPLIBRE_WEATHER_PRELOAD_OPACITY: 0.001,
    RAW_MAP_OBSERVED_WINDOW_MINUTES: 90,
    RAW_MAP_OBSERVED_STEP_MINUTES: 5,
    RAW_MAP_FORECAST_WINDOW_MINUTES: 180,
    RAW_MAP_FORECAST_STEP_MINUTES: 15,
    STANDARD_TIMELINE_SLIDER_STEPS: 1000
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    function activeMapSource(frame = mapState.frames[mapState.frameIndex]) {
      return frame?.source === "forecast" ? "forecast" : "radar";
    }
    function showFrame() {}
    function prefetchRawMapFramesAround() {}
    function syncStandardTimelineSlider() {}
    function radarTimelineLabel(timestamp) { return new Date(timestamp).toISOString(); }
    function forecastTimelineLabel(timestamp) { return new Date(timestamp).toISOString(); }
    function radarChunkIndexUrl() {
      return String(mapState.frames[mapState.frameIndex]?.rawMapIndexUrl || "");
    }
    function mapLibreCurrentRecord() { return globalThis.record; }
    function radarChunkActiveZoom(state) { return state?.activeZoom ?? 0; }
    function radarChunkIntersectsViewport() { return true; }
    function setMapLibreWeatherEntryOpacity(record, entry, opacity) {
      record.map.setPaintProperty(entry.layerId, "raster-opacity", opacity);
      entry.visible = opacity > MAPLIBRE_WEATHER_PRELOAD_OPACITY;
    }
    function setMapLibreWeatherEntryVisual(record, entry, spec) {
      setMapLibreWeatherEntryOpacity(record, entry, Number(spec?.opacity) || 0);
    }
    function syncRawMapPresentation() {}
    function syncMapLibreDiagnosticReadout() {}
    function generatedRadarRefreshTimelineKind() { return "precip"; }
    function radarProviderAllowsGenerated() { return true; }
    function generatedMrmsManifestUrlOverride() { return ""; }
    ${extractFunction(source, "clearRawMapFrameDecoration")}
    ${extractFunction(source, "rawMapCanonicalFrames")}
    ${extractFunction(source, "rawMapNearestFallbackFrame")}
    ${extractFunction(source, "rawMapCanonicalFrame")}
    ${extractFunction(source, "rawMapTimelineTimestamp")}
    ${extractFunction(source, "rawMapClosestFrameIndex")}
    ${extractFunction(source, "applyRawMapEnhancement")}
    ${extractFunction(source, "standardTimelineTimeRange")}
    ${extractFunction(source, "standardTimelineSliderValueForFrame")}
    ${extractFunction(source, "standardTimelineFrameIndexForSliderValue")}
    ${extractFunction(source, "rawMapObservedTargetTimes")}
    ${extractFunction(source, "rawMapForecastTargetTimes")}
    ${extractFunction(source, "mapLibreSourceBounds")}
    ${extractFunction(source, "radarChunkCoverageContainsViewport")}
    ${extractFunction(source, "mapLibreRadarChunkReady")}
    ${extractFunction(source, "syncMapLibreRadarChunkFallbackVisibility")}
    ${extractFunction(source, "rawMapFrameLayerVisible")}
    ${extractFunction(source, "rawMapEffectiveVisualMetric")}
    ${extractFunction(source, "maybeSwitchGeneratedRadarToFallback")}
    ${extractFunction(source, "rawMapOwnsActiveTimeline")}
    ${extractFunction(source, "shouldRefreshGeneratedRadarForViewport")}
    globalThis.api = {
      applyRawMapEnhancement,
      standardTimelineSliderValueForFrame,
      standardTimelineFrameIndexForSliderValue,
      rawMapObservedTargetTimes,
      rawMapForecastTargetTimes,
      mapLibreRadarChunkReady,
      syncMapLibreRadarChunkFallbackVisibility,
      rawMapFrameLayerVisible,
      rawMapEffectiveVisualMetric,
      maybeSwitchGeneratedRadarToFallback,
      shouldRefreshGeneratedRadarForViewport
    };
  `, sandbox);
  return {
    mapState,
    get record() { return sandbox.record; },
    set record(value) {
      sandbox.record = value;
      if (value?.radarChunkLayerState) value.radarChunkLayerState.map = value.map;
    },
    ...sandbox.api
  };
}

async function verifyGeneratedRadarRefreshOwnershipRace(source) {
  let resolveSelection;
  const selectionPromise = new Promise((resolve) => {
    resolveSelection = resolve;
  });
  const refreshCalls = [];
  const refreshMapState = {
    initialized: true,
    frames: [],
    rawMap: { session: null },
    timelineKind: "precip",
    immersive: false,
    playing: false,
    zoom: 7,
    generatedRadarRefreshSeq: 0,
    generatedRadarViewportKey: "old-viewport",
    generatedRadarSelectionKey: "old-selection",
    radarCapability: null
  };
  const refreshSandbox = {
    mapState: refreshMapState,
    state: { activePlace: { id: "test-place" } },
    selectionPromise,
    calls: refreshCalls
  };
  vm.createContext(refreshSandbox);
  vm.runInContext(`
    function generatedRadarRefreshTimelineKind() { return "precip"; }
    function radarProviderAllowsGenerated() { return true; }
    function generatedMrmsManifestUrlOverride() { return ""; }
    function generatedRadarViewportKey() { return "new-viewport"; }
    function beginGeneratedRadarWarmup() { calls.push("begin"); return {}; }
    function generatedRadarViewportAllowsGenerationRequest() { return true; }
    function resolveGeneratedMrmsManifestSelection() { return globalThis.selectionPromise; }
    function generatedRadarGenerationIsPending() { return false; }
    function radarProviderPreference() { return "auto"; }
    function clearGeneratedRadarSelection() { calls.push("clear-selection"); }
    function generatedRadarRefreshOptions() { return { protectRawMapTimeline: true }; }
    async function loadMapFrames() { calls.push("load"); }
    function scheduleGeneratedRadarWarmupPoll() { calls.push("poll"); }
    function recordRadarSourceDecision() { calls.push("record"); }
    function currentRadarFramesAreGenerated() { return false; }
    function rememberGeneratedRadarSelectionHint() { calls.push("remember"); }
    function finishGeneratedRadarWarmup() { calls.push("finish"); }
    function clearGeneratedRadarWarmup() { calls.push("clear-warmup"); }
    ${extractFunction(source, "rawMapOwnsActiveTimeline")}
    ${extractFunction(source, "shouldRefreshGeneratedRadarForViewport")}
    ${extractFunction(source, "refreshGeneratedRadarForViewport")}
    globalThis.api = { refreshGeneratedRadarForViewport };
  `, refreshSandbox);

  const pendingRefresh = refreshSandbox.api.refreshGeneratedRadarForViewport("race-smoke");
  refreshMapState.rawMap.session = { dispose() {} };
  resolveSelection({
    key: "new-selection",
    manifestUrl: "https://example.test/generated/index.json",
    capability: {}
  });
  await pendingRefresh;
  assert.equal(refreshCalls.includes("load"), false, "a pending generated selection cannot reload over a new raw session");
  assert.equal(refreshCalls.includes("remember"), false, "a stale generated selection is not promoted after raw ownership begins");

  let resolveTimeline;
  const timelinePromise = new Promise((resolve) => {
    resolveTimeline = resolve;
  });
  const loadCalls = [];
  const loadMapState = {
    initialized: true,
    frames: [{ id: "existing-fallback" }],
    frameIndex: 0,
    nowIndex: 0,
    timelineKind: "precip",
    immersive: false,
    playing: false,
    frameLoadSeq: 0,
    rawMap: { session: null }
  };
  const loadSandbox = {
    mapState: loadMapState,
    state: { activePlace: { id: "test-place" } },
    els: { mapLoading: { hidden: true } },
    timelinePromise,
    calls: loadCalls
  };
  vm.createContext(loadSandbox);
  vm.runInContext(`
    function mapFrameLoadPlaceKey() { return "test-place"; }
    function fetchMapTimeline() { return globalThis.timelinePromise; }
    function showFrame() { calls.push("show"); }
    function scheduleRawMapEnhancement() { calls.push("schedule-raw"); }
    function clearMapLayers() { calls.push("clear-layers"); }
    function disposeRawMapEnhancement() { calls.push("dispose-raw"); }
    function initialMapFrameIndex() { return 0; }
    function syncStandardTimelineSlider() { calls.push("sync-slider"); }
    function updateTimelineEraVisuals() { calls.push("update-era"); }
    function startRadarPlayback() { calls.push("play"); }
    function maybeAutoPlayRadar() { calls.push("autoplay"); }
    function setFrameLabel() { calls.push("label"); }
    ${extractFunction(source, "rawMapOwnsActiveTimeline")}
    ${extractFunction(source, "loadMapFrames")}
    globalThis.api = { loadMapFrames };
  `, loadSandbox);

  const pendingLoad = loadSandbox.api.loadMapFrames(true, {
    timelineKind: "precip",
    preserveExisting: true,
    protectRawMapTimeline: true
  });
  loadMapState.rawMap.session = { dispose() {} };
  resolveTimeline({ frames: [{ id: "late-generated" }], nowIndex: 0, forecastUnavailable: false });
  await pendingLoad;
  assert.equal(loadMapState.frames[0].id, "existing-fallback", "an in-flight generated load cannot replace a new raw timeline");
  assert.equal(loadCalls.includes("dispose-raw"), false, "the protected late load exits before disposing raw ownership");
}

function extractFunction(source, name) {
  const asyncMarker = `async function ${name}(`;
  const functionMarker = `function ${name}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(functionMarker);
  assert.notEqual(start, -1, `Found ${name} in map.js`);
  const signatureEnd = source.indexOf(") {", start);
  const bodyStart = signatureEnd >= 0 ? signatureEnd + 2 : source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${name} from map.js`);
}
