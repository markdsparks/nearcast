import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const shared = require("../shared-forecast.js");
const time = Array.from({ length: 24 }, (_, index) => `2026-09-07T${String(index).padStart(2, "0")}:00`);
const nowMs = Date.parse("2026-09-07T10:30:00-05:00");
const fixture = () => ({
  timezone: "America/Chicago", utc_offset_seconds: -18000,
  current: { temperature_2m: 85, apparent_temperature: 88, weather_code: 3, time: time[10] },
  hourly: {
    time, temperature_2m: time.map((_, index) => 70 + index),
    apparent_temperature: time.map((_, index) => 75 + index),
    weather_code: time.map(() => 3), precipitation: time.map(() => 0.2)
  },
  daily: { time: ["2026-09-07"], temperature_2m_min: [70], temperature_2m_max: [93], apparent_temperature_min: [75], apparent_temperature_max: [98] }
});
const guidanceJson = {
  utc_offset_seconds: -18000,
  hourly: {
    time,
    temperature_2m_gfs_seamless: time.map(() => 85),
    temperature_2m_gem_seamless: time.map(() => 87),
    temperature_2m_icon_seamless: time.map(() => 110)
  }
};
const guidance = shared.normalizeTemperatureGuidance(guidanceJson, { placeKey: "test-place", fetchedAtMs: nowMs });
assert.equal(guidance.status, "ready");
assert.equal(guidance.sources[0].hours[0].atMs, Date.parse("2026-09-07T00:00:00-05:00"));
assert.equal(shared.parseTimestamp("2026-09-07T00:00:00Z", fixture()), Date.parse("2026-09-07T00:00:00Z"));
assert.equal(shared.parseTimestamp(null), null);

const data = fixture();
const baseline = shared.temperatureBaseline(data);
const oldCurrent = structuredClone(data.current);
const oldCodes = [...data.hourly.weather_code];
const oldPrecipitation = [...data.hourly.precipitation];
assert.equal(shared.applyTemperatureGuidance(data, { baseline, guidance, nowMs }), true);
assert.equal(data.hourly.temperature_2m[10], 80, "current/past hour is not replaced by consensus");
assert.equal(data.hourly.temperature_2m[11], 87, "independent median rejects a lone hot outlier");
assert.equal(data.hourly.apparent_temperature[11], 92, "feels-like offset is retained");
assert.equal(data.daily.temperature_2m_max[0], 87);
assert.deepEqual(data.current, oldCurrent);
assert.deepEqual(data.hourly.weather_code, oldCodes);
assert.deepEqual(data.hourly.precipitation, oldPrecipitation);
const once = structuredClone(data);
shared.applyTemperatureGuidance(data, { baseline, guidance, nowMs });
assert.deepEqual(data, once, "same original baseline makes repeated updates idempotent");

const oneModel = shared.normalizeTemperatureGuidance({ ...guidanceJson, hourly: { time, temperature_2m_gfs_seamless: time.map(() => 105) } });
assert.equal(oneModel.status, "failed");
shared.applyTemperatureGuidance(data, { baseline, guidance: oneModel, nowMs });
assert.deepEqual(data.hourly.temperature_2m, baseline.hourlyTemperature, "one model preserves original guidance");
const partial = structuredClone(guidance);
partial.sources[1].hours = partial.sources[1].hours.filter((hour) => hour.atMs !== shared.parseTimestamp(time[12], data));
partial.sources[2].hours = partial.sources[2].hours.filter((hour) => hour.atMs !== shared.parseTimestamp(time[12], data));
shared.applyTemperatureGuidance(data, { baseline, guidance: partial, nowMs });
assert.equal(data.hourly.temperature_2m[12], 82, "a sparse time with one model never gains fabricated consensus");

const nwsHourly = { properties: { periods: [
  { startTime: "2026-09-07T15:00:00-05:00", endTime: "2026-09-07T18:00:00-05:00", shortForecast: "Chance thunderstorms", probabilityOfPrecipitation: { value: 35 } },
  { startTime: "bad-date", endTime: "2026-09-07T19:00:00-05:00", shortForecast: "Thunderstorms" },
  { startTime: "2026-09-07T19:00:00-05:00", endTime: "2026-09-07T20:00:00-05:00", shortForecast: "Partly cloudy" }
] } };
const nwsDaily = { properties: { periods: [
  { isDaytime: true, startTime: "2026-09-07T06:00:00-05:00", temperature: 86, temperatureUnit: "F" },
  { isDaytime: false, startTime: "2026-09-06T18:00:00-05:00", endTime: "2026-09-07T06:00:00-05:00", temperature: 68, temperatureUnit: "F" },
  { isDaytime: true, startTime: "2026-09-08T06:00:00-05:00", temperature: null, temperatureUnit: "F" }
] } };
const nws = shared.normalizeNwsEvidence(nwsHourly, nwsDaily, { unit: "fahrenheit", checkedAt: nowMs, placeId: "maryville" });
assert.equal(nws.periods.length, 1);
assert.equal(nws.periods[0].probability, 35, "NWS thunder evidence retains qualification rather than forcing a storm code");
assert.deepEqual(nws.daily, [{ date: "2026-09-07", high: 86, low: 68 }]);
const nwsMetric = shared.normalizeNwsEvidence(nwsHourly, nwsDaily, { unit: "celsius" });
assert.deepEqual(nwsMetric.daily, [{ date: "2026-09-07", high: 30, low: 20 }]);
shared.applyTemperatureGuidance(data, { baseline, guidance, nwsDaily: nws.daily, nowMs });
assert.equal(data.daily.temperature_2m_max[0], 86);
assert.equal(data.daily.temperature_2m_min[0], 68);
assert.equal(Math.max(...data.hourly.temperature_2m), 86);
assert.equal(Math.min(...data.hourly.temperature_2m), 68);
data.hourly.temperature_2m.forEach((value, index) => assert.ok(Math.abs(data.hourly.apparent_temperature[index] - value - 5) < 1e-9));
assert.deepEqual(data.current, oldCurrent, "NWS daily adjustment never overwrites current observations");

const empty = fixture();
empty.hourly.temperature_2m = time.map(() => null);
empty.hourly.apparent_temperature = time.map(() => null);
shared.applyTemperatureGuidance(empty, { guidance, nwsDaily: nws.daily, nowMs });
assert.equal(empty.daily.temperature_2m_max[0], 93, "all-null hourly coverage preserves daily fallback");
assert.ok(empty.hourly.temperature_2m.every((value) => value === null));
assert.equal(shared.applyTemperatureGuidance({}), false);

const missingDailyApparent = fixture();
delete missingDailyApparent.daily.apparent_temperature_min;
delete missingDailyApparent.daily.apparent_temperature_max;
shared.applyTemperatureGuidance(missingDailyApparent, { guidance, nowMs });
assert.deepEqual(missingDailyApparent.daily.apparent_temperature_min, [75]);
assert.deepEqual(missingDailyApparent.daily.apparent_temperature_max, [92]);

const nowData = fixture();
nowData.current = { ...nowData.current, time: "2026-09-07T10:15", precipitation: 0.15, interval: 900, wind_speed_10m: 8 };
const liveCurrent = shared.canonicalCurrentSnapshot(nowData, { nowMs });
assert.equal(liveCurrent.temperature_2m, 85, "same-hour current reading remains authoritative");
assert.equal(liveCurrent.hourlyIndex, 10);
assert.equal(liveCurrent.interval, 900);
assert.equal(liveCurrent.precipitation, 0.15);
assert.equal(liveCurrent.wind_gusts_10m, 8, "missing gusts use chosen wind speed");
assert.equal(liveCurrent.basis, "modeled-current");
nowData.current.time = "2026-09-07T09:45";
const rolledCurrent = shared.canonicalCurrentSnapshot(nowData, { nowMs });
assert.equal(rolledCurrent.temperature_2m, 80, "a previous-hour current reading is not current even when less than 90min old");
assert.equal(rolledCurrent.apparent_temperature, 85);
assert.equal(rolledCurrent.time, "2026-09-07T10:00");
assert.equal(rolledCurrent.interval, 3600);
assert.equal(rolledCurrent.precipitation, 0, "hourly precipitation amount is not recast as current observed rain");
assert.equal(rolledCurrent.basis, "hourly-forecast");
assert.equal(rolledCurrent.asOfMs, Date.parse("2026-09-07T10:00:00-05:00"));
assert.equal(rolledCurrent.evaluationMs, nowMs);
assert.equal(rolledCurrent.wind_speed_10m, 8, "missing hourly value falls back to current field");
nowData.current.time = "2026-09-07T10:15";
const agedCurrent = shared.canonicalCurrentSnapshot(nowData, { nowMs: Date.parse("2026-09-07T11:31:00-05:00"), hourlyIndex: 10 });
assert.equal(agedCurrent.basis, "hourly-forecast", "the 75min guard also applies when a caller provides a matching row index");
const beforeCoverage = shared.canonicalCurrentSnapshot(nowData, { nowMs: Date.parse("2026-09-06T23:30:00-05:00") });
assert.equal(beforeCoverage.hourlyIndex, 0, "nearest row within 90min supports coverage starting ahead of the clock");
const noCoverage = shared.canonicalCurrentSnapshot(nowData, { nowMs: Date.parse("2026-09-06T21:00:00-05:00") });
assert.equal(noCoverage.hourlyIndex, -1);
assert.equal(noCoverage.temperature_2m, 85, "absent relevant hourly coverage preserves current fallback");
assert.equal(nowData.current.time, "2026-09-07T10:15", "canonical current selection never mutates raw source data");

const imperial = shared.buildForecastParams({ latitude: 38.7, longitude: -89.95 });
assert.equal(imperial.get("temperature_unit"), "fahrenheit");
assert.equal(imperial.get("wind_speed_unit"), "mph");
assert.equal(imperial.get("precipitation_unit"), "inch");
assert.equal(imperial.get("forecast_minutely_15"), "24");
const native = shared.buildForecastParams({ latitude: 38.7, longitude: -89.95, precipitationUnit: "mm", forecastDays: 4, includeMinutely: false });
assert.equal(native.get("precipitation_unit"), "mm", "native condition semantics consume mm even with Fahrenheit");
assert.equal(native.get("forecast_days"), "4");
assert.equal(native.has("minutely_15"), false);
assert.ok(native.get("daily").includes("sunrise,sunset"));
const metric = shared.buildForecastParams({ latitude: 47.5, longitude: 7.6, unit: "celsius" });
assert.equal(metric.get("wind_speed_unit"), "kmh");
assert.equal(metric.get("precipitation_unit"), "mm");

console.log("Shared forecast normalization, temperature calibration, and native field/unit contracts passed.");
