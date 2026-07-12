#!/usr/bin/env node

import assert from "node:assert/strict";

await import("./hrrr-subhourly-adapter.js");

const api = globalThis.NearcastHrrrSubhourly;
assert.ok(api, "NearcastHrrrSubhourly global was not installed");

const dataUrl = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20260711/conus/hrrr.t00z.wrfsubhf01.grib2";
const index = [
  "1:0:d=2026071100:REFC:entire atmosphere:15 min fcst:",
  "2:259557:d=2026071100:RETOP:cloud top:15 min fcst:",
  "3:408603:d=2026071100:VIL:entire atmosphere:15 min fcst:",
  "4:51995129:d=2026071100:REFC:entire atmosphere:30 min fcst:",
  "5:52250000:d=2026071100:RETOP:cloud top:30 min fcst:"
].join("\n");

const entries = api.parseHrrrIndex(index, dataUrl);
assert.equal(entries[0].parameter, "REFC");
assert.equal(entries[0].forecastMinutes, 15);
assert.equal(entries[0].rangeStart, 0);
assert.equal(entries[0].rangeEnd, 259556);
assert.equal(entries[0].byteLength, 259557);
assert.equal(entries[3].forecastMinutes, 30);
assert.equal(entries[3].rangeStart, 51995129);
assert.equal(entries[3].rangeEnd, 52249999);

const cycle = new Date("2026-07-11T00:00:00Z");
const selections = api.selectCanonicalTimes(cycle, [
  new Date("2026-07-11T00:16:00Z"),
  new Date("2026-07-11T00:31:00Z"),
  new Date("2026-07-11T00:46:00Z")
]);
assert.deepEqual(selections.map((item) => item.forecastMinutes), [15, 30, 45]);
assert.deepEqual(selections.map((item) => item.validTime.toISOString()), [
  "2026-07-11T00:15:00.000Z",
  "2026-07-11T00:30:00.000Z",
  "2026-07-11T00:45:00.000Z"
]);
assert.deepEqual(selections.map((item) => item.fileForecastHour), [1, 1, 1]);

const urls = api.hrrrSubhourlyUrls(api.BUCKET, cycle, 2);
assert.equal(urls.dataUrl, "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20260711/conus/hrrr.t00z.wrfsubhf02.grib2");
assert.equal(urls.indexUrl, `${urls.dataUrl}.idx`);

console.log(JSON.stringify({
  ok: true,
  parsedEntries: entries.length,
  canonicalMinutes: selections.map((item) => item.forecastMinutes),
  secondHourUrl: urls.dataUrl
}, null, 2));
