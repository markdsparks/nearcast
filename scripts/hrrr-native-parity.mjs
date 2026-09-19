#!/usr/bin/env node
// Read-only live comparison helper for the native HRRRZarrTests --live output.
// Exact cycle required; this does not discover/assume matching publication times.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const hrrr = require('../hrrr-zarr-adapter.js');
const cycle = process.argv[2];
assert.match(cycle ?? '', /^\d{8}_\d{2}z$/);
const cycleTime = new Date(`${cycle.slice(0, 4)}-${cycle.slice(4, 6)}-${cycle.slice(6, 8)}T${cycle.slice(9, 11)}:00:00Z`);
const client = hrrr.createClient({ maxChunks: 4, concurrency: 1 });
// The existing adapter's exact-cycle metadata loader is intentionally used to
// compare the same immutable source run, not whichever run appears mid-test.
const run = await client._loadRunMetadata({
  cycle, cycleTime,
  runRoot: `https://hrrrzarr.s3.amazonaws.com/sfc/${cycle.slice(0, 8)}/${cycle}_fcst.zarr`
});
const result = await client.fetchVisible({ run, bounds: [-90.4, 38.4, -89.7, 39], stepIndexes: [0, 1, 2] });
const chunks = result.chunks.map(chunk => {
  let hash = 14695981039346656037n;
  const bytes = new Uint8Array(chunk.values.buffer, chunk.values.byteOffset, chunk.values.byteLength);
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  const valid = chunk.values.filter(value => Number.isFinite(value) && value > -9000);
  return { key: chunk.key, count: chunk.values.length, fnv1a64: hash.toString(16),
    logicalWidth: chunk.logicalWidth, logicalHeight: chunk.logicalHeight,
    minimum: Math.min(...valid), maximum: Math.max(...valid) };
});
if (process.argv[3]) assert.equal(chunks[0].fnv1a64, process.argv[3], 'native/JS full selected-float byte hash');
console.log(JSON.stringify({ cycle, forecastHours: result.steps.map(step => step.forecastHour),
  validTimes: result.steps.map(step => step.validIso), chunks,
  maryvilleProjection: hrrr.projectLonLat(-89.9559, 38.7237)
}, null, 2));
