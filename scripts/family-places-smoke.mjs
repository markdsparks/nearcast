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
  const state = { unit: "fahrenheit", timeFormat: "auto", activePlace: null, savedPlaces: [], forecast: null };
  const glanceData = {};
  function degree(unit) { return "°" + unit; }
  function canonicalCurrentSnapshot() { return state.forecast?.current || {}; }
  function formatClock(hour, minute) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const clock = hour % 12 || 12;
    return clock + (minute ? ":" + String(minute).padStart(2, "0") : "") + " " + suffix;
  }
  function effectiveCurrentCode(current) { return Number(current.weather_code); }
  ${extractFunction(app, "placeFamilyAlias")}
  ${extractFunction(app, "placeFamilyName")}
  ${extractFunction(app, "userClockPreference")}
  ${extractFunction(app, "timeFormatOptions")}
  ${extractFunction(app, "familyPlaceLocalTime")}
  ${extractFunction(app, "familyPlaceConditionLine")}
  ${extractFunction(app, "familyPlacesForOverview")}
  ${extractFunction(app, "familyPlacesForHydration")}
  ${extractFunction(app, "familyPlacesForHome")}
  ${extractFunction(app, "activeHomeTemperature")}
  ${extractFunction(app, "familyPlaceClock")}
  ${extractFunction(app, "familyPlaceDate")}
  ${extractFunction(app, "familyPlacePrecipKind")}
  ${extractFunction(app, "familyPlaceHomeException")}
  ${extractFunction(app, "familyPlacesForHomeExceptions")}
  ${extractFunction(app, "familyPlaceEventCopy")}
  ${extractFunction(app, "familyPlaceOutlook")}
  globalThis.subject = { state, glanceData, placeFamilyName, familyPlaceLocalTime, familyPlaceConditionLine, familyPlacesForOverview, familyPlacesForHydration, familyPlacesForHome, familyPlacesForHomeExceptions, familyPlaceOutlook };
`, sandbox);

const { state, glanceData, placeFamilyName, familyPlaceLocalTime, familyPlaceConditionLine, familyPlacesForOverview, familyPlacesForHydration, familyPlacesForHome, familyPlacesForHomeExceptions, familyPlaceOutlook } = sandbox.subject;
const home = { id: "home", name: "Nokomis", admin1: "Illinois", latitude: 39.3, longitude: -89.2, alias: "Home" };
const school = { id: "school", name: "Nokomis", admin1: "Illinois", latitude: 39.31, longitude: -89.21, alias: "School" };
state.activePlace = home;
state.savedPlaces = [home, school, ...Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, name: `Place ${index}`, latitude: 30 + index, longitude: -90 + index }))];
assert.equal(placeFamilyName(home), "Home", "family aliases lead the Places surface without changing the forecast's geographic identity");
const overviewPlaces = familyPlacesForOverview();
assert.equal(overviewPlaces[0].id, "home", "the active place is always first");
assert.equal(overviewPlaces.filter((place) => place.id === "home").length, 1, "active and saved copies of the same place are deduplicated");
assert.equal(overviewPlaces.length, 6, "the family overview stays intentionally short");
assert.equal(familyPlacesForHydration().length, 10, "weather and alerts hydrate for every unique saved place, not only the six visible in the sheet overview");
assert.equal(familyPlacesForHome().some((place) => place.id === "home"), false, "Home never repeats the selected place in the Home glance rail");
assert.equal(familyPlacesForHome().length, 9, "every saved place is evaluated before Home decides which exceptions earned space");
assert.equal(String(familyPlacesForHome()[0].id), "school", "Home cards keep the source place identity even when it will later be serialized through data attributes");

state.forecast = { current: { temperature_2m: 70 } };
for (const place of familyPlacesForHome()) {
  glanceData[place.id] = { temp: 72, code: 0, outlook: "Quiet through tonight", alert: null };
}
assert.equal(familyPlacesForHomeExceptions().length, 0, "quiet family weather adds no Home card");
glanceData.p7.alert = { event: "Tornado Warning", tone: "warning" };
glanceData.school = { temp: 71, code: 0, outlook: "Rain likely after 4 PM", alert: null };
glanceData.p0 = { temp: 88, code: 0, outlook: "Quiet through tonight", alert: null };
let homeExceptions = familyPlacesForHomeExceptions();
assert.equal(String(homeExceptions[0].place.id), "p7", "an official alert beyond the first four saved places is never missed");
assert.deepEqual(Array.from(homeExceptions.map((item) => item.exception.kind)), ["alert", "precipitation", "temperature"], "official alerts lead forecast precipitation and temperature differences");
for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
  glanceData[id] = { temp: 72, code: 61, outlook: "Rain now", alert: null };
}
homeExceptions = familyPlacesForHomeExceptions();
assert.equal(homeExceptions.length, 4, "the exception rail is capped only after all saved places are evaluated and ranked");
const chicagoTime = familyPlaceLocalTime("America/Chicago", new Date("2026-08-24T18:14:00Z"));
assert.match(chicagoTime, /local$/, "every family place can carry a quiet local-time cue");
state.timeFormat = "24";
assert.match(familyPlaceLocalTime("America/Chicago", new Date("2026-08-24T18:14:00Z")), /^13:14 local$/, "Family Places honors Nearcast's explicit 24-hour clock preference");
state.timeFormat = "auto";
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
assert.match(html, /id="familyPlacesPeek"/, "Home has an intentionally optional Family Places glance rail");
assert.match(app, /function familyPlacesForOverview\([\s\S]*?return places\.slice\(0, 6\)/, "the overview is intentionally limited instead of becoming a location dashboard");
assert.doesNotMatch(extractFunction(app, "familyPlacesForHome"), /slice\(0, 4\)/, "Home evaluates all saved places before applying its visual cap");
assert.match(extractFunction(app, "hydrateGlances"), /familyPlacesForHydration\(\)[\s\S]*GLANCE_REFRESH_MS[\s\S]*Math\.min\(3, queue\.length\)/, "Family weather refreshes every place with bounded concurrency and a freshness window");
assert.match(extractFunction(app, "fetchGlance"), /cached\.savedAt < GLANCE_REFRESH_MS[\s\S]*_savedAt:[\s\S]*const savedAt = Date\.now\(\)/, "cached family weather retains its original age instead of silently gaining another freshness window");
assert.match(extractFunction(app, "hydrateGlances"), /glanceHydrationTasks[\s\S]*finally[\s\S]*delete glanceHydrationTasks/, "overlapping renders share one family-weather request per place");
assert.match(extractFunction(app, "hydrateGlances"), /requestUnit = state\.unit[\s\S]*state\.unit !== requestUnit[\s\S]*hydrateGlances\(\)/, "a unit change cannot let an older family-weather request paint values in the wrong unit");
assert.match(extractFunction(app, "handleForegroundResume"), /hydrateGlances\(\)/, "returning to the app revalidates stale family exceptions without requiring a reload");
assert.match(extractFunction(app, "familyPlacesForHomeExceptions"), /sort[\s\S]*exception\.priority[\s\S]*slice\(0, 4\)/, "Home ranks earned exceptions before limiting the rail");
assert.match(app, /String\(candidate\.place\.id\) === String\(card\.dataset\.familyPlaceId\)/, "Home family-place cards resolve numeric and string place IDs after DOM serialization");
assert.match(app, /function familyPlaceOutlook\(/, "each family place has its own compact next-change reader");
assert.match(app, /function refreshFamilyPlaceLocalTimes\(/, "open Family Places refreshes local clocks on the app's minute cadence");
assert.match(app, /secondary:\s*`Air \$\{temp\}°`/, "Feels-like hourly cards use a compact, complete air-temperature comparison");
assert.match(app, /function renameSavedPlace\(/, "saved places can be named for the family");
assert.match(app, /function moveSavedPlace\(/, "saved places can be reordered");
assert.match(app, /place-item-outlook/, "the rendered card exposes one meaningful next line");
assert.match(styles, /\.place-item-main \{[\s\S]*grid-template-areas:[\s\S]*"icon copy temp"[\s\S]*"icon outlook outlook"/, "the next-change line receives its own readable row rather than squeezing beside a temperature");
assert.match(styles, /\.place-item-editor \{[\s\S]*grid-column:\s*1 \/ -1/, "family naming and ordering controls expand below, never crowding the weather read");
assert.match(styles, /@media \(max-width: 420px\) \{[\s\S]*\.place-item\.has-watch-control \{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 42px[\s\S]*\.place-watch-toggle \{[\s\S]*grid-column:\s*1 \/ -1/, "watch controls move below the weather read on narrow phones instead of crushing it");
const outlookRule = styles.match(/\.place-item-outlook\s*\{([^}]*)\}/)?.[1] || "";
assert.doesNotMatch(outlookRule, /text-overflow:\s*ellipsis/, "place outlooks never rely on truncation for their useful sentence");

console.log("PASS  Family Places keeps a short, named, decision-first weather overview");
