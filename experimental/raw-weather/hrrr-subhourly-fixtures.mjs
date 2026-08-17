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

const discoveryNow = new Date("2026-07-11T12:07:00.000Z");
const discoveryTargets = Array.from({ length: 5 }, (_, index) => (
  new Date(discoveryNow.getTime() + (index + 1) * 15 * 60_000)
));
const fetchedIndexes = [];
const fallbackToCompleteRun = await api.discoverSubhourlyFrames({
  now: discoveryNow,
  validTimes: discoveryTargets,
  lookbackHours: 3,
  async fetchIndex(indexUrl) {
    fetchedIndexes.push(indexUrl);
    if (indexUrl.includes("hrrr.t12z.wrfsubhf01")) {
      return fixtureIndex("2026071112", [15, 30, 45, 60]);
    }
    if (indexUrl.includes("hrrr.t12z.wrfsubhf02")) {
      throw Object.assign(new Error("simulated latest-cycle publication lag"), { code: "HTTP_404" });
    }
    if (indexUrl.includes("hrrr.t11z.wrfsubhf02")) {
      return fixtureIndex("2026071111", [75, 90, 105, 120]);
    }
    if (indexUrl.includes("hrrr.t11z.wrfsubhf03")) {
      return fixtureIndex("2026071111", [135]);
    }
    throw Object.assign(new Error(`unexpected index request ${indexUrl}`), { code: "HTTP_404" });
  }
});

assert.equal(fallbackToCompleteRun.length, 5, "discovery preserves the complete requested model horizon");
assert.deepEqual(
  fallbackToCompleteRun.map((frame) => frame.cycleTime),
  [
    "2026-07-11T11:00:00.000Z",
    "2026-07-11T11:00:00.000Z",
    "2026-07-11T11:00:00.000Z",
    "2026-07-11T11:00:00.000Z",
    "2026-07-11T11:00:00.000Z"
  ],
  "an incomplete latest run falls back wholesale to the next complete cycle"
);
assert.deepEqual(
  fallbackToCompleteRun.map((frame) => frame.cycleSegment),
  [0, 0, 0, 0, 0],
  "one displayed timeline contains exactly one model cycle"
);
assert.deepEqual(
  fallbackToCompleteRun.map((frame) => frame.validTime),
  [
    "2026-07-11T12:15:00.000Z",
    "2026-07-11T12:30:00.000Z",
    "2026-07-11T12:45:00.000Z",
    "2026-07-11T13:00:00.000Z",
    "2026-07-11T13:15:00.000Z"
  ],
  "complete-run discovery remains chronologically ordered"
);
assert.equal(fallbackToCompleteRun[0].cycleAgeMinutes, 67, "frames expose selected-cycle freshness metadata");
assert.equal(fallbackToCompleteRun[0].coverageComplete, true, "selected guidance covers the full horizon");
assert.equal(fallbackToCompleteRun[0].requestedFrameCount, 5, "coverage retains the requested horizon size");
assert.equal(fallbackToCompleteRun[0].coverageThrough, "2026-07-11T13:15:00.000Z");
assert.equal(fallbackToCompleteRun[0].requestedThrough, discoveryTargets[4].toISOString());
assert.ok(fetchedIndexes.some((url) => url.includes("hrrr.t12z.wrfsubhf02")), "latest cycle is probed through its first unavailable file");

const cycleSegments = api.summarizeCycleSegments(fallbackToCompleteRun);
assert.deepEqual(
  cycleSegments.map(({ cycleTime, frameCount, firstValidTime, lastValidTime, coverageComplete }) => ({
    cycleTime,
    frameCount,
    firstValidTime,
    lastValidTime,
    coverageComplete
  })),
  [
    {
      cycleTime: "2026-07-11T11:00:00.000Z",
      frameCount: 5,
      firstValidTime: "2026-07-11T12:15:00.000Z",
      lastValidTime: "2026-07-11T13:15:00.000Z",
      coverageComplete: true
    }
  ],
  "cycle metadata describes the one coherent returned segment"
);
assert.deepEqual(api.summarizeCoverage(fallbackToCompleteRun), {
  complete: true,
  frameCount: 5,
  requestedFrameCount: 5,
  firstValidTime: "2026-07-11T12:15:00.000Z",
  availableThrough: "2026-07-11T13:15:00.000Z",
  requestedThrough: discoveryTargets[4].toISOString(),
  cycleTime: "2026-07-11T11:00:00.000Z",
  cycleAgeMinutes: 67
});

console.log(JSON.stringify({
  ok: true,
  parsedEntries: entries.length,
  canonicalMinutes: selections.map((item) => item.forecastMinutes),
  secondHourUrl: urls.dataUrl,
  selectedCycle: cycleSegments.map((segment) => ({
    cycleTime: segment.cycleTime,
    frameCount: segment.frameCount,
    coverageComplete: segment.coverageComplete
  })),
  incompleteLatestFallsBackWholeTimeline: true
}, null, 2));

function fixtureIndex(cycleStamp, forecastMinutes) {
  return forecastMinutes.map((minutes, index) => (
    `${index + 1}:${index * 250000}:d=${cycleStamp}:REFC:entire atmosphere:${minutes} min fcst:`
  )).join("\n");
}
