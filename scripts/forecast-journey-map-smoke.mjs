import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, daygraph, map, planner] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8")
]);

function extractFunction(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map((marker) => source.indexOf(marker)).find((index) => index >= 0) ?? -1;
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (["\"", "'", "`"].includes(char)) { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${name}`);
}

const focusHarness = new Function(`
  ${extractFunction(daygraph, "dayDetailForecastFocusFromWindow")}
  return dayDetailForecastFocusFromWindow;
`)();
const focus = focusHarness({
  startMs: 1000,
  endMs: 4600,
  peakStartMs: 2200,
  peakEndMs: 3400,
  kind: "storm",
  headline: "Storms likely near 4 PM"
}, { dayIndex: 2, source: "day" });
assert.deepEqual(focus, {
  startMs: 2200,
  endMs: 3400,
  dayIndex: 2,
  kind: "storm",
  label: "Storms likely near 4 PM",
  source: "day"
}, "the journey keeps the canonical peak window, label, kind, and day");

const intentHarness = new Function(`
  function normalizeMapLongitude(value) { return Number(value); }
  ${extractFunction(map, "mapIntentTimestamp")}
  ${extractFunction(map, "normalizeMapOpenIntent")}
  return normalizeMapOpenIntent;
`)();
const intent = intentHarness({
  source: "forecast",
  timestamp: 2_000_000_000_000,
  endTimestamp: 2_000_003_600_000,
  event: "Rain near 4 PM",
  eventKind: "rain",
  place: { id: "maryville-il", name: "Maryville, Illinois", latitude: 38.72, longitude: -89.95 }
});
assert.equal(intent.timestamp, 2_000_000_000_000);
assert.equal(intent.endTimestamp, 2_000_003_600_000, "the full selected window survives the typed map handoff");

const coverageHarness = new Function(`
  const mapState = { frames: [
    { source: "radar", timestamp: 1_000 },
    { source: "forecast", timestamp: 2_000 },
    { source: "forecast", timestamp: 3_000 }
  ], intentResolution: {
    requestedMs: 1_263_000,
    requestedSource: "forecast",
    resolvedMs: 3_000,
    resolvedSource: "forecast",
    sourceMatched: true,
    inRange: false,
    deltaMs: 1_260_000
  } };
  function activeMapSource(frame) { return frame?.source === "forecast" ? "forecast" : "radar"; }
  function rawMapTimelineTimestamp(frame) { return Number(frame?.timestamp); }
  function formatTimelineTime(value) { return String(value); }
  ${extractFunction(map, "mapIntentCoverageText")}
  return mapIntentCoverageText;
`)();
assert.equal(coverageHarness({ source: "radar", timestamp: 9_999_999 }), "", "current radar does not receive forecast-coverage copy");
assert.equal(coverageHarness({ source: "forecast", timestamp: 2_500 }), "", "forecast coverage waits for the selected timeline to resolve instead of reading stale frames");
assert.match(
  coverageHarness({ source: "forecast", timestamp: 3_000 + 21 * 60 * 1000 }),
  /available through 3000; selected time is later/,
  "a selected hour beyond map guidance is disclosed instead of silently pretending to match"
);

const dock = extractFunction(app, "handleAppDockAction");
assert.match(dock, /nearcastDayDetailMapIntent/, "Hourly supplies the exact selected forecast focus to Map");
assert.match(dock, /nearcastSuspendDayDetailForMap/, "Hourly is suspended rather than destroyed during Map");
assert.match(dock, /nearcastMapIntentForNow/, "a direct Map visit remains grounded in current radar");
assert.doesNotMatch(dock.match(/if \(action === "map"\)[\s\S]*?\n  }/)?.[0] || "", /closeDayDetail\(/, "Map no longer destroys the Hourly journey");

assert.match(daygraph, /data-forecast-start=/, "every hourly row carries its exact forecast timestamp");
assert.match(extractFunction(daygraph, "toggleSheetHourRow"), /setDayDetailForecastFocusFromRow/, "expanding an hour updates the shared forecast focus");
const hourlyGraph = extractFunction(daygraph, "drawHourlyGraph");
assert.match(hourlyGraph, /pointermove"[^\n]*update\(nearest\(e\.clientX\)\)\)/, "hovering or dragging the graph is a transient inspection");
assert.match(hourlyGraph, /pointerup"[^\n]*commitFocus:\s*true/, "releasing on the graph commits the selected forecast focus");
assert.match(extractFunction(daygraph, "scheduleGraphCalloutReflow"), /graphUpdateActive\(graphActiveIndex\)/, "programmatic graph layout does not create a new user focus");
assert.match(extractFunction(daygraph, "suspendDayDetailForMap"), /is-suspended-for-map[\s\S]*aria-hidden[\s\S]*inert[\s\S]*nowJump\.hidden = true/, "the underlying Hourly surface is visually suspended, inaccessible, and free of floating controls while Map is open");
assert.match(extractFunction(daygraph, "suspendDayDetailForMap"), /document\.activeElement instanceof HTMLElement/, "Hourly remembers the invoking dock control as its return focus target");
assert.match(extractFunction(daygraph, "suspendDayDetailForMap"), /dayDetailNavState\?\.placeKey[\s\S]*suspendedPlace = detailPlace/, "Map suspension records the place that owns Hourly rather than an Ask-switched active place");
assert.match(extractFunction(daygraph, "restoreDayDetailAfterMap"), /suspendedPlace[\s\S]*activePlace[\s\S]*suspendedPlace !== activePlace[\s\S]*return false/, "a place change discards stale Hourly context");
assert.match(extractFunction(map, "exitImmersiveMap"), /nearcastRestoreDayDetailAfterMap[\s\S]*syncAppDockCurrent/, "closing Map restores the prior Hourly surface and its honest dock state");
assert.match(extractFunction(map, "syncMapIntentPresentation"), /mapIntentCoverageText/, "the Map context explains when its visual timeline cannot reach the selected hour");
assert.match(extractFunction(map, "enterImmersiveMap"), /immersiveSession !== mapState\.immersiveSession[\s\S]*waitForImmersiveMapReady\(8000, immersiveSession\)/, "map entry is guarded against a stale asynchronous session");
assert.match(extractFunction(map, "exitImmersiveMap"), /immersiveSession \+= 1[\s\S]*frameLoadSeq \+= 1/, "closing Map cancels pending frame work before restoring Hourly");
assert.match(extractFunction(map, "onImmersiveKey"), /e\.key === "Tab"[\s\S]*trapImmersiveMapFocus/, "keyboard focus remains inside the immersive Map dialog");
assert.match(extractFunction(map, "onImmersiveKey"), /topmostShownSheet[\s\S]*stormReceiptSheet[\s\S]*stormViewSheet/, "Map defers Escape to an app sheet intentionally shown above it");
assert.match(extractFunction(map, "enterImmersiveMap"), /requestAnimationFrame\(focusImmersiveMapSurface\)[\s\S]*focusImmersiveMapSurface\(\)/, "Map receives focus on entry without stealing it after the user begins interacting");
assert.match(extractFunction(map, "enterImmersiveMap"), /nearcastSuspendDayDetailForMap/, "every Map entry path shares the Hourly suspension lifecycle");
assert.match(extractFunction(map, "enterImmersiveMap"), /requestedReturnFocus[\s\S]*nearcastSuspendDayDetailForMap\(requestedReturnFocus\)/, "Map hands an explicit invoking control through the Hourly suspension lifecycle");
assert.match(extractFunction(map, "refreshInlineMap"), /mapState\.openIntent[\s\S]*mapIntentLoadOptions\(mapState\.openIntent\)/, "background forecast refreshes preserve a focused Map timestamp");
assert.match(extractFunction(app, "openAlertAffectedArea"), /returnFocus:\s*alertSheetReturnFocus[\s\S]*closeAlertSheet\(\{ restoreFocus: false \}\)/, "Alert hands its original launcher to Map and suppresses its delayed sheet restore");
assert.match(extractFunction(app, "closeAlertSheet"), /suspendedForMap !== "true"[\s\S]*options\?\.restoreFocus === false \? null/, "closing an alert preserves suspended Hourly state and suppresses stale focus restoration");
assert.match(extractFunction(app, "closeAlertSheet"), /restoreFocus\s*===\s*false[\s\S]*suppressSheetFocusRestore/, "Alert cancellation also suppresses the shared sheet accessibility restore");
assert.match(extractFunction(planner, "closeAISheet"), /restoreFocus\s*===\s*false[\s\S]*suppressSheetFocusRestore[\s\S]*return returnFocus/, "Ask transfers its launcher without a competing delayed focus restore");
assert.match(extractFunction(planner, "scheduleNearcastAgentNavigation"), /navigationReturnFocus[\s\S]*enterImmersiveMap\(\{ returnFocus: navigationReturnFocus \}\)/, "Ask-to-Map transfers focus ownership to the immersive surface");

console.log("Forecast journey map smoke passed.");
