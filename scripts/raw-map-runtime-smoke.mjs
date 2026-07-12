#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rawMap = require("../raw-map-runtime.js");

const observedAt = "2026-07-11T12:00:00.000Z";
const forecastAt = "2026-07-11T13:00:00.000Z";
const width = 64;
const height = 64;
const encoding = {
  type: "uint8-dbz",
  dbzMin: 0,
  dbzMax: 80,
  threshold: 5,
  noData: 0,
  valueMin: 1,
  valueMax: 255
};

const mrms = {
  createClient() {
    return {
      async loadHistory() {
        return {
          attribution: "NOAA/NWS MRMS",
          product: "MergedReflectivityQCComposite_00.50",
          region: "CONUS",
          frames: [{
            observedAt,
            data: new Uint8Array(width * height).fill(96),
            encoding,
            metrics: { precipPixels: width * height }
          }]
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};

const hrrr = {
  projectLonLat(lon, lat) {
    return { x: lon, y: lat };
  },
  createClient() {
    return {
      async discoverLatestRun() {
        return {
          level: "surface",
          variable: "REFC",
          cycle: "20260711_12z",
          cycleIso: observedAt
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
          steps: [{ validIso: forecastAt, forecastHour: 1, sourceIndex: 1 }],
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
            values: new Float32Array([20, 22, 24, 26])
          }]
        };
      },
      clearCache() {}
    };
  }
};

const session = rawMap.createSession({ mode: "both", width, height, mrms, hrrr });
const result = await session.prepare({
  bounds: [0, 0, 1, 1],
  forecastFrames: 1,
  historyFrames: 1,
  width,
  height
});

assert.equal(result.status, "ready");
assert.equal(result.observed.length, 1);
assert.equal(result.forecast.length, 1);
assert.deepEqual(result.frames.map((frame) => frame.validTime), [observedAt, forecastAt]);

for (const frame of result.frames) {
  const indexResponse = await fetch(frame.indexUrl);
  assert.equal(indexResponse.ok, true);
  const index = await indexResponse.json();
  assert.equal(index.provider, "nearcast-raw-map");
  assert.equal(index.levels[0].chunks.length, 1);
  const chunkResponse = await fetch(index.levels[0].chunks[0].path);
  const chunk = new Uint8Array(await chunkResponse.arrayBuffer());
  assert.equal(new TextDecoder().decode(chunk.subarray(0, 4)), "NCRD");
}

const observedIndexUrl = result.observed[0].indexUrl;
result.dispose();
await assert.rejects(() => fetch(observedIndexUrl));
session.dispose();

const partialSession = rawMap.createSession({
  mode: "both",
  width,
  height,
  mrms,
  hrrr: {
    ...hrrr,
    createClient() {
      return {
        async discoverLatestRun() {
          throw new Error("forecast unavailable");
        },
        clearCache() {}
      };
    }
  }
});
const partial = await partialSession.prepare({ bounds: [0, 0, 1, 1], width, height });
assert.equal(partial.status, "partial");
assert.equal(partial.observed.length, 1);
assert.equal(partial.forecast.length, 0);
assert.equal(partial.errors[0].provider, "forecast");
partialSession.dispose();

console.log(JSON.stringify({
  ok: true,
  runtimeVersion: rawMap.VERSION,
  combinedFrames: 2,
  partialFallback: true,
  blobLifecycle: true
}, null, 2));
