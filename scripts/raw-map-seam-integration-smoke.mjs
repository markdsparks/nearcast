#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  WIDTH,
  HEIGHT,
  START_TIME,
  observedTrack,
  signalCentroid
} from "./fixtures/radar-seam-engine-fixtures.mjs";

const require = createRequire(import.meta.url);
const seam = require("../radar-seam-engine.js");
const rawMap = require("../raw-map-runtime.js");

const observed = observedTrack(seam, { frameCount: 19, dxPerFrame: 2, dyPerFrame: -1 });
const latest = observed.at(-1);
const latestAt = Date.parse(latest.validTime);
const forecastTimes = Array.from({ length: 12 }, (_, index) =>
  new Date(latestAt + (index + 1) * 15 * 60_000).toISOString()
);
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
          frames: observed.map((frame) => ({
            observedAt: frame.validTime,
            data: frame.data,
            encoding,
            metrics: { precipPixels: frame.data.filter(Boolean).length }
          }))
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};

const cycleTime = new Date(latestAt - 90 * 60_000).toISOString();
const hrrrSubhourly = {
  createClient() {
    return {
      async loadForecast({ validTimes }) {
        return {
          provider: "noaa-hrrr-subhourly",
          attribution: "NOAA/NWS HRRR",
          cycleTime,
          coverage: { complete: true },
          frames: validTimes.map((validTime, index) => {
            const leadMinutes = (Date.parse(validTime) - latestAt) / 60_000;
            // The model is deliberately eight pixels behind the observed
            // trajectory. The seam should remove that backward jump.
            const data = seam.translateTexture(
              latest.data,
              WIDTH,
              HEIGHT,
              0.4 * leadMinutes - 8,
              -0.2 * leadMinutes + 4,
              { interpolation: "nearest" }
            );
            return {
              provider: "noaa-hrrr-subhourly",
              validTime,
              cycleTime,
              cycleAgeMinutes: 90,
              forecastMinutes: 105 + index * 15,
              data,
              encoding,
              metrics: { precipPixels: data.filter(Boolean).length }
            };
          })
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};

const session = rawMap.createSession({
  mode: "both",
  width: WIDTH,
  height: HEIGHT,
  mrms,
  hrrrSubhourly,
  seam
});
const result = await session.prepare({
  bounds: [-90, 38, -89, 39],
  width: WIDTH,
  height: HEIGHT,
  observedNow: latest.validTime,
  observedTimes: observed.map((frame) => frame.validTime),
  forecastFrames: forecastTimes
});

assert.equal(result.status, "ready");
assert.equal(result.seam.status, "ready");
assert.ok(result.seam.replacedFrames >= 4);
assert.equal(result.observed.length, 19);
assert.equal(result.forecast.length, 12);
assert.deepEqual(result.forecast.map((frame) => frame.validTime), forecastTimes);
assert.equal(new Set(result.frames.map((frame) => frame.validTime)).size, result.frames.length);
assert.ok(result.forecast.slice(0, 4).every((frame) =>
  ["nearcast-radar-nowcast", "nearcast-blended-guidance", "nearcast-hrrr-aligned"].includes(frame.provider)
));
assert.ok(result.forecast.every((frame) => frame.kind === "forecast"));

const first = result.forecast[0];
assert.equal(first.source.baseObservedAt, latest.validTime);
assert.ok(["radar-nowcast", "blended-forecast", "hrrr-aligned"].includes(first.source.guidanceType));
const firstIndex = await (await fetch(first.indexUrl)).json();
assert.equal(firstIndex.frame.guidanceType, first.source.guidanceType);
assert.equal(firstIndex.frame.baseObservedAt, latest.validTime);

const firstChunk = new Uint8Array(await (await fetch(first.chunkUrl)).arrayBuffer());
const headerLength = new DataView(firstChunk.buffer, firstChunk.byteOffset, firstChunk.byteLength).getUint16(6);
const firstTexture = firstChunk.slice(12 + headerLength);
const observedCenter = signalCentroid(latest.data);
const forecastCenter = signalCentroid(firstTexture);
assert.ok(forecastCenter.x > observedCenter.x, "first future frame must continue eastward");
assert.ok(forecastCenter.y < observedCenter.y, "first future frame must continue northward");

result.dispose();
session.dispose();

const clearMrms = {
  createClient() {
    return {
      async loadHistory() {
        return {
          attribution: "NOAA/NWS MRMS",
          frames: observed.map((frame) => ({
            observedAt: frame.validTime,
            data: new Uint8Array(WIDTH * HEIGHT),
            encoding
          }))
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};
const clearHrrr = {
  createClient() {
    return {
      async loadForecast({ validTimes }) {
        return {
          provider: "noaa-hrrr-subhourly",
          attribution: "NOAA/NWS HRRR",
          cycleTime,
          frames: validTimes.map((validTime, index) => ({
            provider: "noaa-hrrr-subhourly",
            validTime,
            cycleTime,
            cycleAgeMinutes: 90,
            forecastMinutes: 105 + index * 15,
            data: new Uint8Array(WIDTH * HEIGHT),
            encoding
          }))
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};
const clearSession = rawMap.createSession({
  mode: "both",
  width: WIDTH,
  height: HEIGHT,
  mrms: clearMrms,
  hrrrSubhourly: clearHrrr,
  seam
});
const clearResult = await clearSession.prepare({
  bounds: [-90, 38, -89, 39],
  width: WIDTH,
  height: HEIGHT,
  observedNow: latest.validTime,
  observedTimes: observed.map((frame) => frame.validTime),
  forecastFrames: forecastTimes
});
assert.equal(clearResult.seam.status, "unavailable");
assert.ok(clearResult.forecast.every((frame) => frame.provider === "noaa-hrrr-subhourly"));
clearResult.dispose();
clearSession.dispose();

console.log(JSON.stringify({
  ok: true,
  observedFrames: 19,
  forecastFrames: 12,
  seamFrames: result.seam.replacedFrames,
  guidanceType: first.source.guidanceType,
  continuousMotion: true,
  forecastTimesUnique: true,
  lowSignalFailsClosed: true
}, null, 2));
