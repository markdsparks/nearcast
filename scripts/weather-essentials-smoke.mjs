import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function source(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = app.indexOf("\nfunction ", start + 1);
  return app.slice(start, end);
}
const harness = vm.createContext({
  forecastNowMs: (data) => data.now,
  forecastDailyIndex: () => 0,
  parseForecastTimestamp: (value) => value ? Date.parse(value) : null,
  formatTime: (value) => value.slice(11, 16),
  durationBrief: (ms) => `${Math.round(ms / 60000)} min`,
  sunExposureRows: (data) => data.rows || []
});
vm.runInContext(["finiteAirValue", "airQualityIndexAt", "airValueAt", "airPeakValue", "daylightSummaryForHome"].map(source).join("\n"), harness);
const now = Date.parse("2026-09-06T12:00:00Z");
const data = { now, airQuality: {
  current: { time: "2026-09-06T12:00:00Z", us_aqi: null },
  hourly: { time: ["2026-09-06T12:00:00Z"], us_aqi: [null] }
} };
for (const value of [null, undefined, "", false, -1, NaN]) {
  data.airQuality.current.us_aqi = value;
  data.airQuality.hourly.us_aqi[0] = value;
  assert.equal(harness.airValueAt(data, "us_aqi"), null, "missing AQI must never be good air");
  assert.equal(harness.airPeakValue(data, "us_aqi"), null);
}
data.airQuality.current.us_aqi = 0;
assert.equal(harness.airValueAt(data, "us_aqi"), 0, "a genuine zero remains valid");
data.airQuality.current = { time: "2026-09-05T12:00:00Z", us_aqi: 20 };
data.airQuality.hourly.us_aqi[0] = 118;
assert.equal(harness.airValueAt(data, "us_aqi"), 118, "current-hour guidance replaces an old current snapshot");
data.airQuality.hourly.time[0] = "2026-09-05T12:00:00Z";
assert.equal(harness.airValueAt(data, "us_aqi"), null, "old air data becomes unavailable");

const sun = { now, daily: {
  sunrise: ["2026-09-06T06:30:00Z", "2026-09-07T06:31:00Z"],
  sunset: ["2026-09-06T19:20:00Z"]
} };
assert.equal(harness.daylightSummaryForHome(sun).sunrise, "06:30");
assert.equal(harness.daylightSummaryForHome(sun).sunset, "19:20");
assert.equal(harness.daylightSummaryForHome(sun).isDay, true);
sun.now = Date.parse("2026-09-06T05:00:00Z");
assert.match(harness.daylightSummaryForHome(sun).context, /Sunrise in/);
sun.now = Date.parse("2026-09-06T21:00:00Z");
assert.equal(harness.daylightSummaryForHome(sun).context, "Tomorrow's sunrise 06:31");
assert.equal(harness.daylightSummaryForHome(sun).sunset, "19:20", "today's sunset stays visible at night");
assert.equal(harness.daylightSummaryForHome({ now }).mode, "unavailable", "missing times do not imply polar night");
assert.equal(harness.daylightSummaryForHome({ now, rows: [{ isDay: true }] }).mode, "unavailable");
assert.equal(harness.daylightSummaryForHome({ now, rows: Array(24).fill({ isDay: true }) }).mode, "polar-day");
assert.equal(harness.daylightSummaryForHome({ now, rows: Array(24).fill({ isDay: false }) }).mode, "polar-night");
console.log("Air quality missing/stale data and daylight boundary cases passed.");
