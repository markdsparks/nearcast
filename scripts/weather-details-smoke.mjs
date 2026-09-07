import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function source(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf("\nfunction ", start + 1));
}
const harness = vm.createContext({
  state: { unit: "fahrenheit" },
  forecastNowMs: (data) => data.now,
  parseForecastTimestamp: (time) => time ? Date.parse(time) : null,
  currentHourlyIndex: (data) => data.hourly?.time?.findIndex(time => Date.parse(time) <= data.now && data.now < Date.parse(time) + 3600000) ?? -1,
  forecastDailyIndex: () => 0,
  degree: (unit) => `°${unit}`,
  escapeHtml: (value) => String(value),
  raindropGlyph: () => "",
  formatTime: (time) => time.slice(11, 16)
});
vm.runInContext([
  "weatherDetailNumber", "currentWeatherDetailValue", "weatherDetailVisibility", "homeWeatherDetailItems",
  "uvRisk", "uvForecastInsight", "glanceDetailFactHtml", "glanceDetailNoteHtml",
  "buildHumidityGlanceDetail", "buildVisibilityGlanceDetail"
].map(source).join("\n"), harness);

const now = Date.parse("2026-09-07T12:30:00Z");
const data = { now, current: { time: "2026-09-07T12:15:00Z", wind_speed_10m: 0, relative_humidity_2m: 62, visibility: 16093.44 },
  hourly: { time: ["2026-09-07T12:00:00Z", "2026-09-07T13:00:00Z"], uv_index: [3, 5], dew_point_2m: [55, 56], wind_gusts_10m: [12, 18], visibility: [16093.44, 8046.72] },
  daily: { uv_index_max: [8] }
};
let items = harness.homeWeatherDetailItems(data);
assert.equal(items.find(item => item.kind === "wind").value, "0 mph", "genuine calm is retained");
assert.equal(items.find(item => item.kind === "humidity").note, "Dew point 55°F");
assert.equal(items.find(item => item.kind === "visibility").value, "10 mi");
assert.equal(items.find(item => item.kind === "uv").value, "3 · Moderate", "current UV never borrows the daily peak");
assert.equal(harness.weatherDetailVisibility(10000, "celsius"), "10 km");
assert.equal(harness.weatherDetailVisibility(50, "fahrenheit"), "<0.1 mi");
for (const value of [undefined, null, NaN, "", false, -1]) assert.equal(harness.weatherDetailVisibility(value), "Unavailable");
assert.match(harness.buildVisibilityGlanceDetail(data).body, /5 mi/);
assert.match(harness.buildHumidityGlanceDetail(data, "F").body, /55°F/);

data.current.wind_speed_10m = null;
assert.equal(harness.homeWeatherDetailItems(data).find(item => item.kind === "wind").value, "Unavailable");
data.hourly.uv_index[0] = null;
assert.equal(harness.homeWeatherDetailItems(data).find(item => item.kind === "uv").value, "Unavailable");
data.current.time = "2026-09-06T12:15:00Z";
data.hourly.time = ["2026-09-06T12:00:00Z", "2026-09-06T13:00:00Z"];
assert.ok(harness.homeWeatherDetailItems(data).every(item => item.value === "Unavailable"), "expired readings are not current conditions");
for (const value of [null, undefined, NaN, false, ""]) {
  data.daily.uv_index_max[0] = value;
  assert.equal(harness.uvForecastInsight(data).available, false, "missing UV peak is not zero");
}
assert.match(source("buildGlanceDetail"), /kind === "humidity"/);
assert.match(source("buildGlanceDetail"), /kind === "visibility"/);
assert.match(source("buildGlanceDetail"), /kind === "uv"/);
console.log("Weather details: stable entry points, current-hour scope, missing data, humidity and visibility units passed.");
