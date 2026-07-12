#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtime = require("../../raw-map-runtime.js");
const now = new Date("2026-07-11T12:00:00.000Z");
const targets = canonicalTimes(now, 90, 5);

assert.equal(targets.length, 19, "a five-minute 90-minute timeline includes 19 targets");

const originalFetch = globalThis.fetch;
const sourceFrames = sourceTimes(now, 90, 2);
globalThis.fetch = async () => ({
  ok: true,
  async text() {
    return s3Listing(sourceFrames);
  }
});

await import("./mrms-browser-adapter.js");

try {
  const selected = await globalThis.NearcastMrms.listRecentFrames({
    now,
    minutes: 90,
    maxFrames: 24,
    targetTimes: targets,
    targetToleranceMinutes: 3
  });
  assert.equal(selected.length, targets.length, "each canonical target resolves to a source frame");
  assert.equal(new Set(selected.map((frame) => frame.key)).size, selected.length, "source objects are unique");
  selected.forEach((frame, index) => {
    const delta = Math.abs(Date.parse(frame.observedAt) - Date.parse(targets[index]));
    assert.ok(delta <= 60_000, `target ${index} resolves within one minute`);
  });

  const selectedWithDuplicateTarget = await globalThis.NearcastMrms.listRecentFrames({
    now,
    minutes: 90,
    maxFrames: 24,
    targetTimes: [...targets, targets[targets.length - 1]],
    targetToleranceMinutes: 3
  });
  assert.equal(
    selectedWithDuplicateTarget.length,
    targets.length,
    "duplicate target times do not duplicate source downloads"
  );
} finally {
  globalThis.fetch = originalFetch;
}

let capturedHistoryOptions = null;
const width = 64;
const height = 64;
const mrms = {
  createClient() {
    return {
      async loadHistory(options) {
        capturedHistoryOptions = options;
        const requested = options.targetTimes.length
          ? options.targetTimes
          : Array.from({ length: options.maxFrames }, (_, index) =>
            new Date(now.getTime() - (options.maxFrames - index - 1) * 2 * 60_000).toISOString()
          );
        return {
          attribution: "NOAA/NWS MRMS",
          product: "MergedReflectivityQCComposite_00.50",
          region: "CONUS",
          frames: requested.map((targetTime) => ({
            // Selection targets choose source objects; descriptors retain the
            // actual source validity instead of adopting a synthetic target.
            observedAt: new Date(Date.parse(targetTime) - 60_000).toISOString(),
            data: new Uint8Array(width * height).fill(96),
            encoding: {
              type: "uint8-dbz",
              dbzMin: 0,
              dbzMax: 80,
              threshold: 5,
              noData: 0,
              valueMin: 1,
              valueMax: 255
            }
          }))
        };
      },
      cancel() {},
      destroy() {}
    };
  }
};

const session = runtime.createSession({ mode: "observed", width, height, mrms });
const explicit = await session.prepare({
  bounds: [-90.5, 38.2, -89.2, 39.3],
  observedNow: now,
  observedTimes: targets,
  historyMinutes: 90,
  width,
  height
});

assert.equal(capturedHistoryOptions.maxFrames, 19);
assert.equal(capturedHistoryOptions.targetTimes.length, 19);
assert.equal(capturedHistoryOptions.now, now.toISOString());
assert.ok(capturedHistoryOptions.minutes >= 90);
assert.equal(explicit.observed.length, 19);
assert.equal(
  explicit.observed[0].validTime,
  new Date(Date.parse(targets[0]) - 60_000).toISOString(),
  "runtime descriptors retain actual MRMS valid time"
);

const generated = await session.prepare({
  bounds: [-90.5, 38.2, -89.2, 39.3],
  observedNow: now,
  historyMinutes: 90,
  historyStepMinutes: 5,
  width,
  height
});
assert.equal(capturedHistoryOptions.targetTimes.length, 19, "runtime can generate the canonical target sequence");
assert.deepEqual(capturedHistoryOptions.targetTimes, targets);
assert.equal(generated.observed.length, 19);

await session.prepare({
  bounds: [-90.5, 38.2, -89.2, 39.3],
  observedNow: now,
  historyFrames: 6,
  historyMinutes: 90,
  width,
  height
});
assert.equal(capturedHistoryOptions.maxFrames, 6, "numeric historyFrames remains compatible");
assert.equal(capturedHistoryOptions.targetTimes.length, 0, "legacy sampling remains available without targets");
session.dispose();

console.log(JSON.stringify({
  ok: true,
  canonicalTargets: targets.length,
  uniqueSourceFrames: targets.length,
  runtimeGeneratedCadence: true,
  legacyNumericFrames: true
}, null, 2));

function canonicalTimes(end, historyMinutes, stepMinutes) {
  const start = end.getTime() - historyMinutes * 60_000;
  const step = stepMinutes * 60_000;
  const values = [];
  for (let timestamp = start; timestamp < end.getTime(); timestamp += step) {
    values.push(new Date(timestamp).toISOString());
  }
  values.push(end.toISOString());
  return values;
}

function sourceTimes(end, historyMinutes, stepMinutes) {
  return canonicalTimes(end, historyMinutes, stepMinutes).map((value) => new Date(value));
}

function s3Listing(times) {
  const contents = times.map((time) => {
    const iso = time.toISOString();
    const day = iso.slice(0, 10).replace(/-/g, "");
    const clock = iso.slice(11, 19).replace(/:/g, "");
    const key = `CONUS/MergedReflectivityQCComposite_00.50/${day}/MRMS_MergedReflectivityQCComposite_00.50_${day}-${clock}.grib2.gz`;
    return `<Contents><Key>${key}</Key><LastModified>${iso}</LastModified><Size>1200000</Size></Contents>`;
  }).join("");
  return `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}
