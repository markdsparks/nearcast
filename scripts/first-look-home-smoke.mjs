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

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
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
    if (char === "\"" || char === "'" || char === "`") {
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

const savedMetric = extractFunction(app, "savedHourlyHeroMetric");
const savedInterval = extractFunction(app, "savedHourlyHeroInterval");
const resetLens = extractFunction(app, "resetHomeHourlyLens");
const setMetric = extractFunction(app, "setHourlyHeroMetric");
const setInterval = extractFunction(app, "setHourlyHeroInterval");
assert.match(app, /hourlyHeroMetric:\s*"temperature"[\s\S]*hourlyHeroInterval:\s*"hourly"/, "Home starts on the stable Hourly + Temperature view");
assert.match(savedMetric, /state\.hourlyHeroMetric[\s\S]*"temperature"/, "Home metric is session state, not a remembered launch preference");
assert.match(savedInterval, /state\.hourlyHeroInterval[\s\S]*"hourly"/, "Home interval is session state, not a remembered launch preference");
assert.doesNotMatch(`${savedMetric}\n${savedInterval}\n${setMetric}\n${setInterval}`, /localStorage\.(?:getItem|setItem)/, "Home inspection lenses never persist into another launch");
assert.match(resetLens, /hourlyHeroMetric = "temperature"[\s\S]*hourlyHeroInterval = "hourly"[\s\S]*removeItem\(HOURLY_HERO_METRIC_KEY\)[\s\S]*removeItem\(HOURLY_HERO_INTERVAL_KEY\)/, "legacy sticky Home settings are removed during migration");
assert.match(extractFunction(app, "warmStartForecast"), /resetHomeHourlyLens\(\)/, "a cached app launch resets the Home lens");
assert.match(extractFunction(app, "loadPlace"), /!previousPlace \|\| !samePlanPlace\(previousPlace, nextPlace\)[\s\S]*resetHomeHourlyLens\(\)/, "switching locations resets the Home lens without disrupting a same-place refresh");

assert.match(html, /<h2>7-Day Outlook<\/h2>/, "the primary planning horizon is seven days");
assert.match(html, /id="extendedDailyPanel"[^>]*hidden[\s\S]*<details[^>]*id="extendedDaily"[\s\S]*Extended outlook[\s\S]*Lower confidence · Days 8–14[\s\S]*id="extendedDailyList"/, "days 8–14 live in a collapsed, plainly qualified section");
const hierarchy = extractFunction(app, "arrangeForecastHierarchy");
assert.match(hierarchy, /launch\.after\(nowcast, hourlyPanel, dailyPanel, map, extendedDailyPanel, els\.familyPlacesPeek/, "Home reads Outlook/Hourly, seven days, Map, extended days, then earned family exceptions");
const renderDaily = extractFunction(app, "renderDaily");
const renderHourly = extractFunction(app, "renderHourly");
assert.match(renderDaily, /const primaryRows = dayRows\.slice\(0, 7\)[\s\S]*const extendedRows = dayRows\.slice\(7, 14\)[\s\S]*els\.daily\.innerHTML = primaryRows\.join[\s\S]*els\.extendedDailyList\.innerHTML = extendedRows\.join/, "daily rendering splits the first seven days from the lower-confidence horizon");
assert.match(renderDaily, /extendedDailyPanel\.hidden = extendedRows\.length === 0/, "the extended disclosure disappears when the provider has no additional days");
assert.match(extractFunction(app, "dailyEditorialConditionLabel"), /most of day[\s\S]*early[\s\S]*Mixed conditions/, "a calm base condition is qualified when a different material event occurs later");
const dailyWeatherStory = extractFunction(app, "dailyRowWeatherStory");
assert.match(renderDaily, /dailyRowWeatherStory\(data, day, index, dayDisclosure\)/, "daily rows use one chronological weather-story contract");
assert.match(dailyWeatherStory, /nearcastBriefMaterialEvent\(event\)[\s\S]*nearcastCalmDailyTiming/, "two-phase rows reuse the canonical material event and confidence-softened timing");
assert.match(dailyWeatherStory, /eventFirst[\s\S]*relation: "then"[\s\S]*startsLater[\s\S]*relation = startsLater \? "then" : "with"/, "early, later, and ambiguous windows cannot be presented in a false sequence");
assert.doesNotMatch(dailyWeatherStory, /weather_code|precipitation_probability/, "daily stories never promote raw provider codes or probabilities");
assert.match(renderDaily, /day-story-relation[\s\S]*aria-hidden="true"[\s\S]*day-precip-note/, "the visual phase marker leaves the spoken chronological story authoritative");

const overlayGeometrySource = extractFunction(app, "hourlyEventOverlayGeometry");
const overlayMarkupSource = extractFunction(app, "hourlyEventOverlayMarkup");
assert.match(renderHourly, /metric === "temperature"[\s\S]*hourlyEventOverlayGeometry\(rows, canonicalEvent, trend\)/, "only the default temperature runway receives the event overlay");
assert.match(renderHourly, /\$\{eventOverlay\}[\s\S]*\$\{areaPaths\}[\s\S]*\$\{trendLines\}/, "the event window sits behind the metric line and values");
assert.doesNotMatch(overlayGeometrySource, /weather_code|precipitation_probability|stormPotential/, "overlay geometry consumes only the canonical event contract");
assert.match(styles, /\.hourly-event-overlay\s*\{[\s\S]*pointer-events:\s*none/, "the visual event layer cannot steal horizontal or vertical scrolling");
assert.doesNotMatch(`${overlayMarkupSource}\n${styles.match(/\/\* A canonical weather window[\s\S]*?\.hourly-trend-area/)?.[0] || ""}`, /\b(?:alert|warning|red)\b/i, "forecast event styling never borrows official-warning semantics");

const overlayGeometry = vm.runInNewContext(`
  const nearcastBriefMaterialEvent = (event) => Boolean(event && ["rain", "storm", "snow", "wind", "fog", "ice"].includes(event.kind));
  ${overlayGeometrySource}
  hourlyEventOverlayGeometry;
`);
const hourMs = 60 * 60 * 1000;
const overlayRows = Array.from({ length: 5 }, (_, index) => ({ ms: index * hourMs }));
const overlay = overlayGeometry(overlayRows, {
  kind: "rain",
  startMs: hourMs,
  endMs: 4 * hourMs,
  phases: [{ kind: "rain", startMs: hourMs, endMs: 4 * hourMs }, { kind: "storm", startMs: 2 * hourMs, endMs: 3 * hourMs }]
}, { width: 396 });
assert.deepEqual(
  { x: overlay.x, width: overlay.width, peakX: overlay.peak.x, peakWidth: overlay.peak.width, startsInside: overlay.startsInside },
  { x: 80, width: 240, peakX: 160, peakWidth: 80, startsInside: true },
  "one event window and one nested storm phase share the hourly card rhythm"
);
const clippedOverlay = overlayGeometry(overlayRows, {
  kind: "rain",
  startMs: -hourMs,
  endMs: 2 * hourMs,
  phases: []
}, { width: 396 });
assert.equal(clippedOverlay.x, 0, "an active event clips cleanly to Now");
assert.equal(clippedOverlay.startsInside, false, "clipping never invents a new onset marker at Now");
assert.equal(overlayGeometry(overlayRows, null, { width: 396 }), null, "a quiet forecast has no decorative event band");

const dailyStorySandbox = {};
vm.createContext(dailyStorySandbox);
vm.runInContext(`
  const nearcastBriefMaterialEvent = (event) => Boolean(event && ["rain", "storm", "snow", "wind", "fog", "ice"].includes(event.kind));
  const parseForecastTimestamp = (value) => Date.parse(String(value).length === 10 ? value + "T00:00:00Z" : value + "Z");
  const forecastOffsetMs = () => 0;
  const forecastLocalDateAtMs = (_data, ms) => new Date(ms).toISOString().slice(0, 10);
  const forecastMaterialEventDailyTiming = (_data, event) => event.headline || "";
  const nearcastCalmDailyTiming = (_data, _event, _disclosure, fallback) => fallback;
  const formatForecastMs = (ms) => {
    const date = new Date(ms);
    const hour = date.getUTCHours();
    return (hour % 12 || 12) + " " + (hour < 12 ? "AM" : "PM");
  };
  ${extractFunction(app, "dailyEditorialConditionLabel")}
  ${dailyWeatherStory}
  globalThis.dailyRowWeatherStory = dailyRowWeatherStory;
`, dailyStorySandbox);
const dailyData = { daily: { time: ["2026-09-03", "2026-09-04"] } };
const dayEvent = (start, end, overrides = {}) => ({
  label: "Clear",
  family: "clear",
  timing: "Storms possible 8 PM–11 PM",
  materialEvent: {
    kind: "storm",
    likelihood: "possible",
    startMs: Date.parse(start),
    endMs: Date.parse(end),
    ...overrides
  }
});
const eveningStory = dailyStorySandbox.dailyRowWeatherStory(
  dailyData,
  dayEvent("2026-09-03T20:00:00Z", "2026-09-03T23:00:00Z"),
  0,
  { precision: "exact" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(eveningStory)),
  { primary: "Clear most of day", secondary: "Storms possible 8 PM–11 PM", relation: "then", aria: "Clear most of day, then Storms possible 8 PM–11 PM" },
  "an evening storm reads as a calm day followed by the material change"
);
const earlyDay = dayEvent("2026-09-03T02:00:00Z", "2026-09-03T05:00:00Z");
earlyDay.timing = "Storms possible 2 AM–5 AM";
const earlyStory = dailyStorySandbox.dailyRowWeatherStory(dailyData, earlyDay, 0, { precision: "exact" });
assert.equal(earlyStory.primary, "Storms possible 2 AM–5 AM", "an early event leads instead of appearing after the day's dominant condition");
assert.equal(earlyStory.secondary, "Clear after 5 AM");
assert.equal(earlyStory.relation, "then");
const crossingDay = dayEvent("2026-09-02T23:00:00Z", "2026-09-03T02:00:00Z");
crossingDay.timing = "Rain early";
crossingDay.materialEvent.kind = "rain";
assert.equal(dailyStorySandbox.dailyRowWeatherStory(dailyData, crossingDay, 0, { precision: "daypart" }).secondary, "Clear later", "cross-midnight weather remains chronological without false clock precision");
const sustainedDay = dayEvent("2026-09-03T08:00:00Z", "2026-09-03T15:00:00Z");
sustainedDay.label = "Rain";
sustainedDay.family = "rain";
sustainedDay.timing = "Rain likely 8 AM–3 PM";
sustainedDay.materialEvent.kind = "rain";
const sustainedStory = dailyStorySandbox.dailyRowWeatherStory(dailyData, sustainedDay, 0, { precision: "exact" });
assert.equal(sustainedStory.primary, "Rain");
assert.equal(sustainedStory.relation, "detail", "a rain-shaped day gets timing detail, not a duplicate rain-to-rain transition");
assert.deepEqual(
  JSON.parse(JSON.stringify(dailyStorySandbox.dailyRowWeatherStory(dailyData, { label: "Clear", family: "clear", materialEvent: null }, 0))),
  { primary: "Clear", secondary: "", relation: null, aria: "Clear" },
  "low-level noise cannot create a second daily phase without a canonical event"
);

const homeException = extractFunction(app, "familyPlaceHomeException");
assert.match(homeException, /glance\.alert\?\.event[\s\S]*hasStorm[\s\S]*hasPrecip[\s\S]*Math\.abs\(there - here\) >= threshold/, "a family place earns Home space only for alerts, precipitation/storms, or a material temperature difference");
assert.doesNotMatch(extractFunction(app, "familyPlacesForHome"), /slice\(0, 4\)/, "every saved place is evaluated before the exception rail is capped");
assert.match(extractFunction(app, "familyPlacesForHomeExceptions"), /familyPlacesForHome\(\)[\s\S]*familyPlaceHomeException[\s\S]*filter[\s\S]*sort[\s\S]*exception\.priority[\s\S]*slice\(0, 4\)/, "ordinary saved places are filtered out, official alerts sort first, and only then is Home capped");
assert.doesNotMatch(homeException, /tone:\s*hasStorm \? "warning"/, "a modeled storm chance never borrows official-warning red");
const renderFamily = extractFunction(app, "renderFamilyPlacesPeek");
assert.match(renderFamily, /familyPlacesForHomeExceptions\(\)[\s\S]*root\.hidden = !exceptions\.length[\s\S]*Around us/, "the Around Us rail is absent until another place has earned attention");
assert.match(extractFunction(app, "updateFamilyPlacePeek"), /renderFamilyPlacesPeek\(\)/, "fresh glance data can add or remove a family exception card");
assert.match(styles, /\.extended-daily > summary[\s\S]*min-height:\s*58px[\s\S]*\.extended-daily-list/, "the extended forecast disclosure has a clear touch target and native progressive disclosure");

console.log("First Look Home smoke passed.");
