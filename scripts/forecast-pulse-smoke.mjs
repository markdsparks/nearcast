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

assert.equal(
  forecastPulseChange(
    { ...baseDay, family: "cloudy", label: "Cloudy", timing: "" },
    { ...baseDay, family: "partly-cloudy", label: "Partly cloudy", timing: "" },
    "F",
    "mph"
  ),
  null,
  "Ordinary sky-cover movement never becomes a forecast-change interruption"
);

assert.equal(
  forecastPulseChange(
    { ...baseDay, precipStartMs: baseDay.precipStartMs + 60 * 60 * 1000 },
    baseDay,
    "F",
    "mph"
  ),
  null,
  "A one-hour timing wobble stays quiet instead of making the forecast feel unstable"
);

const earlier = forecastPulseChange(
  { ...baseDay, precipStartMs: Date.parse("2026-08-16T12:00:00Z") },
  baseDay,
  "F",
  "mph"
);
assert.equal(earlier.kind, "timing");
assert.match(earlier.title, /earlier/);

const canonicalEventDay = {
  ...baseDay,
  eventId: "precip:2026-08-16:0",
  eventKind: "rain",
  eventHeadline: "Rain likely 3 PM–6 PM",
  eventStartMs: Date.parse("2026-08-16T15:00:00Z"),
  eventEndMs: Date.parse("2026-08-16T18:00:00Z")
};
assert.equal(
  forecastPulseChange(
    { ...canonicalEventDay, eventStartMs: canonicalEventDay.eventStartMs + 60 * 60 * 1000 },
    canonicalEventDay,
    "F",
    "mph"
  ),
  null,
  "the same event moving one hour remains below the material-change threshold"
);
const canonicalTimingChange = forecastPulseChange(
  { ...canonicalEventDay, eventStartMs: canonicalEventDay.eventStartMs - 2 * 60 * 60 * 1000 },
  canonicalEventDay,
  "F",
  "mph"
);
assert.equal(canonicalTimingChange.kind, "timing", "a material move of the same event reports timing, not a new storm");
assert.match(canonicalTimingChange.title, /earlier/);
const replacementEvent = forecastPulseChange(
  { ...canonicalEventDay, eventId: "precip:2026-08-16:1", eventHeadline: "A second rain window" },
  canonicalEventDay,
  "F",
  "mph"
);
assert.equal(replacementEvent.kind, "event", "a changed canonical identity is a genuinely different weather window");
assert.match(replacementEvent.title, /main weather window changed/i);

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
const renderDailySource = extractFunction(app, "renderDaily");
assert.match(renderDailySource, /nearcastForecastDisclosureForDay/, "Daily rows consume the shared calm disclosure policy");
assert.match(renderDailySource, /nearcastCalmDailyTiming/, "Daily uncertainty changes the timing wording instead of adding a confidence grade");
assert.doesNotMatch(renderDailySource, /day-pulse|Timing uncertain|High confidence|Some uncertainty/, "Daily rows never add a separate diagnostic confidence chip");

console.log("PASS  Forecast Pulse detects meaningful movement, stays quiet on noise, and distinguishes settled from shifting forecasts");
