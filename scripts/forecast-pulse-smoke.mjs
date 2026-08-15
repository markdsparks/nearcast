import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(path.join(root, "app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  const state = { forecast: null, activePlace: null };
  let runsFixture = [];
  function forecastDailyIndex() { return 0; }
  function forecastPulseRuns() { return runsFixture; }
  function continuityDelta(current, previous) {
    return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
  }
  function continuityTempDeltaThreshold(unit) { return unit === "F" ? 5 : 3; }
  function continuityWindDeltaThreshold(unit) { return unit === "mph" ? 8 : 13; }
  function continuityWindNotableThreshold(unit) { return unit === "mph" ? 24 : 39; }
  function degree(unit) { return "°" + unit; }
  function formatTime(value) {
    return new Date(value).toISOString().slice(11, 16);
  }
  ${extractFunction(app, "forecastAgeLabel")}
  ${extractFunction(app, "forecastPulseChange")}
  ${extractFunction(app, "forecastPulseDayPresentation")}
  globalThis.subject = {
    forecastPulseChange,
    forecastPulseDayPresentation,
    setRuns(value) { runsFixture = value; }
  };
`, sandbox);

const { forecastPulseChange, forecastPulseDayPresentation, setRuns } = sandbox.subject;
const baseDay = {
  date: "2026-08-16",
  high: 82,
  low: 64,
  rainMax: 45,
  gustMax: 16,
  family: "rain",
  label: "Rain",
  timing: "Rain after 3 PM",
  precipStartMs: Date.parse("2026-08-16T15:00:00Z"),
  hourly: []
};

assert.equal(
  forecastPulseChange({ ...baseDay, high: 84, rainMax: 49 }, baseDay, "F", "mph"),
  null,
  "Small model movement remains quiet"
);

const earlier = forecastPulseChange(
  { ...baseDay, precipStartMs: Date.parse("2026-08-16T12:00:00Z") },
  baseDay,
  "F",
  "mph"
);
assert.equal(earlier.kind, "timing");
assert.match(earlier.title, /earlier/);

const checkedAt = Date.parse("2026-08-15T12:00:00Z");
setRuns([
  { checkedAt, tempUnit: "F", windUnit: "mph", days: [baseDay] },
  { checkedAt: checkedAt + 3_600_000, tempUnit: "F", windUnit: "mph", days: [{ ...baseDay, high: 83, rainMax: 48 }] }
]);
const settled = forecastPulseDayPresentation({ daily: { time: [baseDay.date] } }, 0, {});
assert.equal(settled.status, "settled");
assert.equal(settled.label, "Holding steady");

setRuns([
  { checkedAt, tempUnit: "F", windUnit: "mph", days: [{ ...baseDay, high: 76, rainMax: 20 }] },
  { checkedAt: checkedAt + 3_600_000, tempUnit: "F", windUnit: "mph", days: [{ ...baseDay, high: 86, rainMax: 62 }] },
  { checkedAt: checkedAt + 7_200_000, tempUnit: "F", windUnit: "mph", days: [{ ...baseDay, high: 80, rainMax: 38 }] }
]);
const shifting = forecastPulseDayPresentation({ daily: { time: [baseDay.date] } }, 0, {});
assert.equal(shifting.status, "uncertain");
assert.equal(shifting.label, "Still shifting");

assert.match(app, /saveForecastPulseSnapshot\(ctx\.data, ctx\.place\)/, "Records one bounded run after rendering");
assert.match(app, /pulseCue = pulse\.status === "uncertain"/, "Daily rows expose useful uncertainty only");

console.log("PASS  Forecast Pulse detects meaningful movement, stays quiet on noise, and distinguishes settled from shifting forecasts");
