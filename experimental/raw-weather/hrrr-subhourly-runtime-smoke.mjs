#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rawMap = require("../../raw-map-runtime.js");

const width = 64;
const height = 64;
const now = Date.parse("2026-07-11T12:07:00.000Z");
const targets = Array.from({ length: 12 }, (_, index) => (
  new Date(now + (index + 1) * 15 * 60_000).toISOString()
));
const actualTimes = targets.map((value) => {
  const timestamp = Date.parse(value);
  return new Date(Math.round(timestamp / 900_000) * 900_000).toISOString();
});
const encoding = {
  type: "uint8-dbz",
  dbzMin: 0,
  dbzMax: 80,
  threshold: 5,
  noData: 0,
  valueMin: 1,
  valueMax: 255
};

let subhourlyLoadOptions = null;
let subhourlyDestroyed = 0;
let hourlyCalls = 0;
const hrrrSubhourly = {
  createClient() {
    return {
      async loadForecast(options) {
        subhourlyLoadOptions = options;
        return {
          provider: "noaa-hrrr-subhourly",
          attribution: "NOAA/NWS HRRR",
          cycleTime: "2026-07-11T12:00:00.000Z",
          frames: actualTimes.map((validTime, index) => ({
            provider: "noaa-hrrr-subhourly",
            cycleTime: "2026-07-11T12:00:00.000Z",
            validTime,
            forecastMinutes: 15 * (index + 1),
            data: new Uint8Array(width * height).fill(80 + index),
            encoding,
            sourceUrl: `https://example.test/hrrr-subhourly-${index}.grib2`,
            rangeStart: index * 250_000,
            rangeEnd: index * 250_000 + 249_999,
            metrics: {
              precipPixels: width * height,
              minDbz: 20 + index,
              maxDbz: 30 + index,
              outputPixels: width * height
            }
          }))
        };
      },
      cancel() {},
      destroy() { subhourlyDestroyed += 1; }
    };
  }
};
const unusedHourly = {
  projectLonLat() { return { x: 0, y: 0 }; },
  createClient() {
    hourlyCalls += 1;
    throw new Error("hourly fallback should not be used when sub-hourly succeeds");
  }
};

const session = rawMap.createSession({
  mode: "forecast",
  width,
  height,
  hrrrSubhourly,
  hrrr: unusedHourly
});
const result = await session.prepare({
  bounds: [-91.4, 37.8, -88.3, 40],
  forecastFrames: targets.map((validTime) => ({ validTime })),
  width,
  height
});

assert.equal(result.status, "ready");
assert.equal(result.forecast.length, 12);
assert.deepEqual(result.forecast.map((frame) => frame.validTime), actualTimes);
assert.ok(result.forecast.every((frame) => frame.provider === "noaa-hrrr-subhourly"));
assert.ok(result.forecast.every((frame) => frame.source.product === "wrfsubhf/REFC"));
assert.equal(hourlyCalls, 0);
assert.deepEqual(
  subhourlyLoadOptions.validTimes.map((value) => value.toISOString()),
  targets,
  "runtime forwards all canonical target times to the sub-hourly adapter"
);
result.dispose();
assert.equal(subhourlyDestroyed, 1, "disposing the result releases the sub-hourly worker client");
session.dispose();

let failedSubhourlyDestroyed = 0;
let fallbackFetchOptions = null;
const failingSubhourly = {
  createClient() {
    return {
      async loadForecast() { throw new Error("simulated sub-hourly outage"); },
      cancel() {},
      destroy() { failedSubhourlyDestroyed += 1; }
    };
  }
};
const fallbackHourly = {
  projectLonLat(lon, lat) { return { x: lon, y: lat }; },
  createClient() {
    return {
      async discoverLatestRun() {
        return {
          level: "entire_atmosphere",
          variable: "REFC",
          cycle: "20260711_12z",
          cycleIso: "2026-07-11T12:00:00.000Z"
        };
      },
      async loadGrid() {
        return {
          x: new Float64Array([-91.4, -88.3]),
          y: new Float64Array([37.8, 40]),
          xSpacing: 3.1,
          ySpacing: 2.2,
          projection: {}
        };
      },
      async fetchVisible(options) {
        fallbackFetchOptions = options;
        return {
          steps: [{ validIso: actualTimes[3], forecastHour: 1, sourceIndex: 1 }],
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
            shape: [1, 2, 2],
            values: new Float32Array([20, 21, 22, 23])
          }]
        };
      },
      clearCache() {}
    };
  }
};

const fallbackSession = rawMap.createSession({
  mode: "forecast",
  width,
  height,
  hrrrSubhourly: failingSubhourly,
  hrrr: fallbackHourly
});
const fallbackResult = await fallbackSession.prepare({
  bounds: [-91.4, 37.8, -88.3, 40],
  forecastFrames: targets.map((validTime) => ({ validTime })),
  width,
  height
});

assert.equal(fallbackResult.status, "ready");
assert.equal(fallbackResult.forecast.length, 1);
assert.equal(fallbackResult.forecast[0].provider, "noaa-hrrr-zarr");
assert.equal(failedSubhourlyDestroyed, 1, "failed sub-hourly client is released before fallback");
assert.equal(fallbackFetchOptions.validTimes.length, targets.length);
fallbackResult.dispose();
fallbackSession.dispose();

console.log(JSON.stringify({
  ok: true,
  canonicalFrames: result.forecast.length,
  provider: result.forecast[0].provider,
  hourlyFallbackProvider: fallbackResult.forecast[0].provider,
  lifecycleReleased: subhourlyDestroyed === 1 && failedSubhourlyDestroyed === 1
}, null, 2));
