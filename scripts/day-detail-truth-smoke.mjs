import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const daygraph = await readFile(path.join(root, "daygraph.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  assert.notEqual(bodyStart, -1, `Found ${name} body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${name}`);
}

const sandbox = {
  fixtureNow: Date.UTC(2026, 7, 19, 10, 30),
  state: { forecast: null, weatherTruth: { evaluationKey: "fixture" } }
};
vm.createContext(sandbox);
vm.runInContext(`
  const weatherCodes = { 0: "Clear", 2: "Partly cloudy", 3: "Cloudy", 61: "Light rain", 71: "Light snow", 95: "Thunderstorms" };
  function forecastDailyIndex(data) { return data.todayIndex; }
  function forecastNowMs() { return fixtureNow; }
  function parseForecastTimestamp(value) { return Date.parse(value + "Z"); }
  function forecastLocalHour(value) { return Number(value.slice(11, 13)); }
  function formatHour(value) {
    const hour = forecastLocalHour(value);
    return String(hour % 12 || 12) + (hour < 12 ? " AM" : " PM");
  }
  function forecastConditionFamily(code) {
    if (code === 95) return "storm";
    if (code === 61) return "rain";
    if (code === 71) return "snow";
    if (code === 3) return "cloudy";
    return "clear";
  }
  function forecastStoryCondition(code) { return weatherCodes[code] || "Mixed skies"; }
  function isThunderCode(code) { return code === 95; }
  function isSnowCode(code) { return code === 71; }
  function isPrecipCode(code) { return code === 61 || code === 71 || code === 95; }
  ${extractFunction(daygraph, "dayDetailIndicesForDay")}
  ${extractFunction(daygraph, "dayFocusHourLabel")}
  ${extractFunction(daygraph, "dayDetailSharedEvent")}
  ${extractFunction(daygraph, "dayDetailCanonicalStormWindow")}
  ${extractFunction(daygraph, "dayDetailReconcileRollingThunder")}
  ${extractFunction(daygraph, "dayFocusStory")}
  globalThis.subject = { dayDetailIndicesForDay, dayDetailReconcileRollingThunder, dayFocusStory };
`, sandbox);

const times = [];
for (const day of ["2026-08-19", "2026-08-20"]) {
  for (let hour = 0; hour < 24; hour += 1) times.push(`${day}T${String(hour).padStart(2, "0")}:00`);
}
const data = {
  todayIndex: 0,
  daily: { time: ["2026-08-19", "2026-08-20"] },
  hourly: { time: times }
};
sandbox.state.forecast = data;

assert.deepEqual(
  Array.from(sandbox.subject.dayDetailIndicesForDay(data, 0)),
  Array.from({ length: 14 }, (_, index) => index + 10),
  "Today begins with the current hour and excludes every elapsed hour"
);
assert.deepEqual(
  Array.from(sandbox.subject.dayDetailIndicesForDay(data, 1)),
  Array.from({ length: 24 }, (_, index) => index + 24),
  "future day detail retains full-day context"
);

const hours = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((hour, index) => ({
  index: hour,
  time: `2026-08-19T${String(hour).padStart(2, "0")}:00`,
  ms: Date.UTC(2026, 7, 19, hour),
  endMs: Date.UTC(2026, 7, 19, hour + 1),
  temp: 80,
  feels: 82,
  pop: index >= 4 ? 70 : 10,
  gust: 12,
  uv: 2,
  code: index >= 4 ? 95 : 0,
  stormPotential: index >= 4
}));

let contractOptions = null;
sandbox.forecastMaterialEvent = (_forecast, options) => {
  contractOptions = options;
  if (options.source === "rolling-hourly-detail") {
    return {
      id: "storm-19-21",
      kind: "storm",
      headline: "Storms are likely 7–9 PM",
      support: "The strongest signal is near 8 PM",
      startMs: Date.UTC(2026, 7, 19, 19),
      endMs: Date.UTC(2026, 7, 19, 21),
      chance: 70,
      likelihood: "likely",
      basis: "forecast",
      phases: [{ kind: "storm", startMs: Date.UTC(2026, 7, 19, 19), endMs: Date.UTC(2026, 7, 19, 21) }]
    };
  }
  return {
    id: "storm-16-18",
    kind: "storm",
    headline: "Storms are likely 4–6 PM",
    support: "The strongest signal is near 5 PM",
    startMs: Date.UTC(2026, 7, 19, 16),
    endMs: Date.UTC(2026, 7, 19, 18),
    chance: 70,
    likelihood: "likely",
    basis: "forecast"
  };
};

const canonical = sandbox.subject.dayFocusStory(hours, "F", "mph", {
  data,
  dayIndex: 0,
  source: "day",
  showNow: true
});
assert.equal(contractOptions.dayIndex, 0, "day detail requests the matching shared material event");
assert.equal(contractOptions.truth.evaluationKey, "fixture", "the active forecast passes its reconciled truth");
assert.match(canonical.text, /Clear until then\./, "pre-event conditions are summarized without repeating the event transition");
assert.match(canonical.text, /Storms are likely 4–6 PM\./, "the shared event headline is the day-detail weather claim");
assert.match(canonical.text, /strongest signal is near 5 PM\./i, "shared event support remains available");
assert.equal(canonical.signal, null, "the shared event is not repeated in a second focus card");

const rolling = sandbox.subject.dayFocusStory(hours, "F", "mph", {
  data,
  source: "rolling",
  showNow: true
});
assert.equal(Object.hasOwn(contractOptions, "dayIndex"), false, "rolling Hourly requests the cross-day canonical event instead of a daily reinterpretation");
assert.match(rolling.text, /Storms are likely 7–9 PM\./, "rolling Hourly narrates the canonical event window");
assert.match(rolling.text, /strongest signal is near 8 PM\./i, "rolling Hourly retains canonical event support");
assert.doesNotMatch(rolling.text, /near 2 PM/i, "broad early thunder evidence cannot replace the canonical event timing");

const gatedRows = sandbox.subject.dayDetailReconcileRollingThunder([
  {
    time: "2026-08-19T14:00",
    ms: Date.UTC(2026, 7, 19, 14),
    endMs: Date.UTC(2026, 7, 19, 15),
    rawCode: 3,
    stormPotential: true,
    convective: { source: "nws-hourly", level: "possible" }
  },
  {
    time: "2026-08-19T19:00",
    ms: Date.UTC(2026, 7, 19, 19),
    endMs: Date.UTC(2026, 7, 19, 20),
    rawCode: 3,
    stormPotential: true,
    convective: { source: "nws-hourly", level: "possible" }
  },
  {
    time: "2026-08-19T15:00",
    ms: Date.UTC(2026, 7, 19, 15),
    endMs: Date.UTC(2026, 7, 19, 16),
    rawCode: 95,
    stormPotential: true,
    convective: { source: "nws-hourly-model", level: "likely" }
  }
], rolling.sharedEvent, "rolling");
assert.equal(gatedRows[0].stormPotential, false, "an NWS-only badge before the canonical storm window is suppressed");
assert.equal(gatedRows[0].convective, null, "suppressed broad evidence cannot leak into the expanded-hour explanation");
assert.equal(gatedRows[1].stormPotential, true, "the canonical 7–9 PM storm window keeps its thunder badge");
assert.equal(gatedRows[2].stormPotential, true, "independent model-plus-NWS thunder evidence is never suppressed");

delete sandbox.forecastMaterialEvent;
const fallback = sandbox.subject.dayFocusStory(hours.slice(4), "F", "mph", { source: "rolling" });
assert.match(fallback.text, /Storms are likely near 4 PM\./, "plural storm fallback uses correct grammar");
assert.doesNotMatch(fallback.text, /Storms is /, "the old singular-verb storm wording cannot return");
assert.ok(fallback.claimIds.includes(fallback.signal.claimId), "fallback focus metadata marks its repeated precipitation claim for suppression");

assert.match(
  extractFunction(daygraph, "openDayFromIndex"),
  /dayDetailIndicesForDay\(data, i\)/,
  "the day-detail entry point applies now-forward filtering"
);
assert.match(
  extractFunction(daygraph, "dayDetailRowsForState"),
  /dayDetailIndicesForDay\(data, nav\.dayIndex/,
  "an open Today sheet preserves now-forward filtering when refreshed"
);
assert.match(
  extractFunction(daygraph, "renderDayFocus"),
  /focus\.claimIds\?\.includes\(focus\.signal\.claimId\)/,
  "the renderer suppresses a focus card that repeats the summary claim"
);

console.log("Day-detail shared forecast truth smoke passed.");
