import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, styles] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);

function extractBalancedBlock(source, start, label, bodyStartOverride = -1) {
  assert.notEqual(start, -1, `Found ${label}`);
  const bodyStart = bodyStartOverride >= 0 ? bodyStartOverride : source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Found ${label} body`);
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
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not extract ${label}`);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  return extractBalancedBlock(source, start, name, signatureEnd + 2);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  const state = { unit: "fahrenheit", activePlace: null, savedPlaces: [] };
  function degree(unit) { return "°" + unit; }
  function formatClock(hour, minute) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const clock = hour % 12 || 12;
    return clock + (minute ? ":" + String(minute).padStart(2, "0") : "") + " " + suffix;
  }
  function effectiveCurrentCode(current) { return Number(current.weather_code); }
  ${extractFunction(app, "placeFamilyAlias")}
  ${extractFunction(app, "placeFamilyName")}
  ${extractFunction(app, "familyPlaceLocalTime")}
  ${extractFunction(app, "familyPlaceConditionLine")}
  ${extractFunction(app, "familyPlacesForOverview")}
  ${extractFunction(app, "familyPlaceClock")}
  ${extractFunction(app, "familyPlaceDate")}
  ${extractFunction(app, "familyPlacePrecipKind")}
  ${extractFunction(app, "familyPlaceEventCopy")}
  ${extractFunction(app, "familyPlaceOutlook")}
  globalThis.subject = { state, placeFamilyName, familyPlaceLocalTime, familyPlaceConditionLine, familyPlacesForOverview, familyPlaceOutlook };
`, sandbox);

const { state, placeFamilyName, familyPlaceLocalTime, familyPlaceConditionLine, familyPlacesForOverview, familyPlaceOutlook } = sandbox.subject;
const home = { id: "home", name: "Nokomis", admin1: "Illinois", latitude: 39.3, longitude: -89.2, alias: "Home" };
const school = { id: "school", name: "Nokomis", admin1: "Illinois", latitude: 39.31, longitude: -89.21, alias: "School" };
state.activePlace = home;
state.savedPlaces = [home, school, ...Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, latitude: 30 + index, longitude: -90 + index }))];
assert.equal(placeFamilyName(home), "Home", "family aliases lead the Places surface without changing the forecast's geographic identity");
const overviewPlaces = familyPlacesForOverview();
assert.equal(overviewPlaces[0].id, "home", "the active place is always first");
assert.equal(overviewPlaces.filter((place) => place.id === "home").length, 1, "active and saved copies of the same place are deduplicated");
assert.equal(overviewPlaces.length, 6, "the family overview stays intentionally short");
const chicagoTime = familyPlaceLocalTime("America/Chicago", new Date("2026-08-24T18:14:00Z"));
assert.match(chicagoTime, /local$/, "every family place can carry a quiet local-time cue");
assert.match(familyPlaceConditionLine({ condition: "Clear", timeZone: "America/Chicago" }), /^Clear · .* local$/, "the local time sits with the condition rather than taking another crowded row");

const clearCooling = familyPlaceOutlook({
  current: { time: "2026-08-24T15:10", temperature_2m: 79, weather_code: 0 },
  hourly: {
    time: ["2026-08-24T15:00", "2026-08-24T18:00", "2026-08-24T23:00"],
    temperature_2m: [79, 74, 60],
    precipitation_probability: [0, 2, 3],
    weather_code: [0, 1, 0],
    wind_gusts_10m: [8, 12, 10]
  }
});
assert.equal(clearCooling, "Cooling to 60°F tonight", "calm places still get a useful next change rather than a generic condition recap");

const rainLater = familyPlaceOutlook({
  current: { time: "2026-08-24T13:10", temperature_2m: 77, weather_code: 1 },
  hourly: {
    time: ["2026-08-24T13:00", "2026-08-24T16:00", "2026-08-24T17:00"],
    temperature_2m: [77, 76, 73],
    precipitation_probability: [4, 72, 76],
    weather_code: [1, 61, 63],
    wind_gusts_10m: [8, 16, 18]
  }
});
assert.equal(rainLater, "Rain likely after 4 PM", "a saved place leads with the next weather decision");

const rainNow = familyPlaceOutlook({
  current: { time: "2026-08-24T08:10", temperature_2m: 71, weather_code: 61 },
  hourly: {
    time: ["2026-08-24T08:00", "2026-08-24T09:00", "2026-08-24T10:00"],
    temperature_2m: [71, 72, 74],
    precipitation_probability: [80, 42, 8],
    weather_code: [61, 61, 2],
    wind_gusts_10m: [9, 10, 10]
  }
});
assert.equal(rainNow, "Rain now · easing after 10 AM", "current precipitation owns the saved-place message until it ends");

assert.match(html, /aria-label="Family places"/, "the sheet identifies the new family-oriented destination");
assert.match(html, /<h2>Family places<\/h2>/, "the Places surface has a clear, human-facing title");
assert.match(app, /function familyPlacesForOverview\([\s\S]*?return places\.slice\(0, 6\)/, "the overview is intentionally limited instead of becoming a location dashboard");
assert.match(app, /function familyPlaceOutlook\(/, "each family place has its own compact next-change reader");
assert.match(app, /function refreshFamilyPlaceLocalTimes\(/, "open Family Places refreshes local clocks on the app's minute cadence");
assert.match(app, /function renameSavedPlace\(/, "saved places can be named for the family");
assert.match(app, /function moveSavedPlace\(/, "saved places can be reordered");
assert.match(app, /place-item-outlook/, "the rendered card exposes one meaningful next line");
assert.match(styles, /\.place-item-main \{[\s\S]*grid-template-areas:[\s\S]*"icon copy temp"[\s\S]*"icon outlook outlook"/, "the next-change line receives its own readable row rather than squeezing beside a temperature");
assert.match(styles, /\.place-item-editor \{[\s\S]*grid-column:\s*1 \/ -1/, "family naming and ordering controls expand below, never crowding the weather read");
assert.match(styles, /@media \(max-width: 420px\) \{[\s\S]*\.place-item\.has-watch-control \{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 42px[\s\S]*\.place-watch-toggle \{[\s\S]*grid-column:\s*1 \/ -1/, "watch controls move below the weather read on narrow phones instead of crushing it");
const outlookRule = styles.match(/\.place-item-outlook\s*\{([^}]*)\}/)?.[1] || "";
assert.doesNotMatch(outlookRule, /text-overflow:\s*ellipsis/, "place outlooks never rely on truncation for their useful sentence");

console.log("PASS  Family Places keeps a short, named, decision-first weather overview");
