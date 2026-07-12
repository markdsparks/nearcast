#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const hrrr = require("../hrrr-zarr-adapter.js");

const maryvilleBounds = [-90.4, 38.4, -89.7, 39.0];
const maryville = { lon: -89.9559, lat: 38.7237 };

assert.equal(typeof hrrr.createClient, "function");
assert.equal(typeof hrrr.decodeBloscLz4, "function");

const projected = hrrr.projectLonLat(maryville.lon, maryville.lat);
const roundTrip = hrrr.inverseProject(projected.x, projected.y);
assert.ok(Math.abs(roundTrip.lon - maryville.lon) < 1e-7, "longitude projection round trip");
assert.ok(Math.abs(roundTrip.lat - maryville.lat) < 1e-7, "latitude projection round trip");

const now = new Date();
const client = hrrr.createClient({ maxChunks: 8, concurrency: 2 });
const run = await client.discoverLatestRun({ now });
assert.equal(run.variable, "REFC");
assert.equal(run.shape.length, 3);
assert.ok(run.shape[0] >= 6, "latest run has useful forecast depth");

const grid = await client.loadGrid(run);
assert.equal(grid.x.length, run.shape[2]);
assert.equal(grid.y.length, run.shape[1]);
assert.ok(Math.abs(grid.xSpacing - 3000) < 0.01, "HRRR x spacing remains 3 km");
assert.ok(Math.abs(grid.ySpacing - 3000) < 0.01, "HRRR y spacing remains 3 km");

const result = await client.fetchVisible({
  run,
  grid,
  bounds: maryvilleBounds,
  hoursAhead: [0, 1, 2, 3, 4, 5, 6],
  now
});

assert.ok(result.chunks.length >= 1, "Maryville intersects at least one HRRR chunk");
assert.ok(result.steps.length >= 1, "at least one forecast step was selected");
assert.equal(result.chunks[0].shape[0], result.steps.length);
assert.equal(result.chunks[0].values.length, result.steps.length * 150 * 150);

let minimum = Infinity;
let maximum = -Infinity;
let finiteCount = 0;
let fillCount = 0;
for (const value of result.chunks[0].values) {
  if (value <= -9000) {
    fillCount += 1;
  } else if (Number.isFinite(value)) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    finiteCount += 1;
  }
}
assert.ok(finiteCount > 0, "decoded REFC chunk contains finite values");
assert.ok(minimum >= -10.1 && maximum <= 150, "decoded values are plausible dBZ");

console.log(JSON.stringify({
  ok: true,
  adapterVersion: hrrr.VERSION,
  run: run.cycle,
  cycleIso: run.cycleIso,
  sourceShape: run.shape,
  sourceChunks: run.chunks,
  selectedForecastHours: result.steps.map((step) => step.forecastHour),
  selectedValidTimes: result.steps.map((step) => step.validIso),
  spatialChunks: result.chunks.map((chunk) => chunk.key),
  retainedBytes: result.byteLength,
  decodedRangeDbz: { minimum, maximum },
  finiteCount,
  fillCount
}, null, 2));
