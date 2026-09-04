import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, map, html, styles] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
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
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
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

assert.match(map, /window\.nearcastSetMapIntent\s*=/, "Home and alert surfaces can set a typed map intent");
assert.match(map, /window\.nearcastOpenMapIntent\s*=/, "Home and alert surfaces can atomically open a typed map intent");
assert.match(app, /window\.nearcastInlineMapIntent\s*=/, "the inline evidence card exposes its exact typed map intent");
assert.match(extractFunction(app, "handleAppDockAction"), /nearcastDayDetailMapIntent[\s\S]*nearcastMapIntentForNow/, "the Map tab preserves an explicit Hourly focus and otherwise opens honest current radar");
assert.doesNotMatch(extractFunction(app, "nearcastMapIntentForNow"), /event:/, "a routine Map-tab visit does not add a redundant Weather now context card");
assert.match(extractFunction(app, "nearcastMapIntentForPreview"), /leadMs <= 3 \* 60 \* 60 \* 1000/, "the home preview only deep-links to forecast guidance inside the map's high-resolution horizon");
assert.match(extractFunction(map, "openInlineMapPreviewIntent"), /nearcastInlineMapIntent/, "pointer, keyboard, and assistive activation preserve the preview context");
assert.match(extractFunction(map, "mapIntentLoadOptions"), /targetTimestamp/, "map entry carries the selected forecast time");
assert.match(extractFunction(map, "mapIntentLoadOptions"), /targetSource/, "map entry carries observed-versus-forecast intent");
assert.match(extractFunction(map, "enterImmersiveMap"), /await loadMapFrames\(true, mapIntentLoadOptions\(intent\)\)/, "immersive entry waits for the intended timeline");
assert.match(extractFunction(map, "enterImmersiveMap"), /await ensureMapIntentPlace\(intent\)/, "an atomic map intent switches to its explicit place before rendering");

const intentHarness = new Function(`
  function normalizeMapLongitude(value) { return Number(value); }
  ${extractFunction(map, "mapIntentTimestamp")}
  ${extractFunction(map, "normalizeMapOpenIntent")}
  return normalizeMapOpenIntent;
`)();
const intent = intentHarness({
  source: "forecast",
  timestamp: "2026-08-22T19:00:00Z",
  place: { id: "maryville-il", name: "Maryville, Illinois", latitude: 38.72, longitude: -89.95 },
  event: "Thunderstorms likely"
});
assert.equal(intent.source, "forecast");
assert.equal(intent.timestamp, Date.parse("2026-08-22T19:00:00Z"));
assert.equal(intent.placeId, "maryville-il");
assert.equal(intent.event, "Thunderstorms likely");

const intentTimeHarness = new Function(`
  function formatTimelineTime(timestamp) { return String(timestamp); }
  ${extractFunction(map, "mapIntentTimeText")}
  return mapIntentTimeText;
`)();
assert.equal(intentTimeHarness({ source: "radar", timestamp: null }), "", "a Now intent never fabricates a clock time from null");
const explicitForecastTime = Date.parse("2026-08-19T18:00:00Z");
assert.equal(intentTimeHarness({ source: "forecast", timestamp: explicitForecastTime }), String(explicitForecastTime), "an explicit forecast time remains visible");

const now = Date.parse("2026-08-19T18:00:00Z");
const trustHarness = new Function(`
  const MAP_RADAR_CURRENT_MAX_AGE_MS = 15 * 60 * 1000;
  const MAP_RADAR_DELAYED_MAX_AGE_MS = 35 * 60 * 1000;
  const state = { activePlace: { id: "maryville-il" } };
  const mapState = { frames: [], frameIndex: 0, nowIndex: 0, radarLoadState: "available" };
  let signal = null;
  function activeMapSource(frame) { return frame?.source === "forecast" ? "forecast" : "radar"; }
  function rawMapTimelineTimestamp(frame) { return Number(frame?.timestamp); }
  function mapRadarSignal() { return signal; }
  ${extractFunction(map, "mapRadarAgeMinutes")}
  ${extractFunction(map, "mapRadarTrustState")}
  return {
    state: mapState,
    setSignal(value) { signal = value; },
    trust(frame, time) { return mapRadarTrustState(frame, time); }
  };
`)();

const current = { source: "radar", timestamp: now - 5 * 60_000, observedTimestamp: now - 5 * 60_000, isNow: true };
trustHarness.state.frames = [current];
trustHarness.setSignal({ phase: "clear", checkedAt: now - 60_000 });
assert.equal(trustHarness.trust(current, now).state, "clear", "fresh clear radar is explicit");
assert.match(trustHarness.trust(current, now).label, /Radar clear here · Updated 5 min ago/);

const delayed = { ...current, timestamp: now - 22 * 60_000, observedTimestamp: now - 22 * 60_000 };
trustHarness.state.frames = [delayed];
assert.equal(trustHarness.trust(delayed, now).state, "delayed", "15–35 minute radar is visibly delayed");
assert.match(trustHarness.trust(delayed, now).label, /Radar delayed · Last image 22 min ago/);

const stale = { ...current, timestamp: now - 40 * 60_000, observedTimestamp: now - 40 * 60_000 };
trustHarness.state.frames = [stale];
assert.equal(trustHarness.trust(stale, now).state, "unavailable", "radar older than 35 minutes is unavailable, not current");
assert.match(trustHarness.trust(stale, now).label, /too old/);

const forecast = { source: "forecast", timestamp: now + 60 * 60_000 };
trustHarness.state.frames = [forecast];
trustHarness.state.radarLoadState = "unavailable";
assert.deepEqual(
  trustHarness.trust(forecast, now),
  { state: "unavailable", label: "Live radar unavailable · Forecast guidance", ageMin: null },
  "forecast guidance never masquerades as live radar when radar failed"
);

const alertHarness = new Function(`
  const mapState = { openIntent: { alertId: "id:warning-1" } };
  ${extractFunction(map, "mapAlertIntentMatches")}
  ${extractFunction(map, "mapAlertToneRank")}
  ${extractFunction(map, "mapVisibleAlertRecords")}
  ${extractFunction(map, "mapAlertFeatureCollection")}
  return { collection: mapAlertFeatureCollection };
`)();
const coordinates = [[[-90, 38], [-89, 38], [-89, 39], [-90, 39], [-90, 38]]];
const snapshot = {
  state: "ready",
  alerts: [{
    key: "id:warning-1",
    id: "warning-1",
    event: "Severe Thunderstorm Warning",
    tone: "warning",
    geometry: { type: "Polygon", coordinates, bbox: [-90, 38, -89, 39] },
    placeCoverage: { status: "inside", basis: "feature-geometry" }
  }]
};
const collection = alertHarness.collection(snapshot);
assert.equal(collection.features.length, 1, "official alert geometry reaches the map");
assert.deepEqual(collection.features[0].geometry.coordinates, coordinates, "GeoJSON remains longitude-latitude without mutation");
assert.equal(collection.features[0].properties.selected, 1, "the requested alert footprint is visually prioritized");
assert.equal(collection.features[0].properties.coverage, "inside", "inside/outside state crosses the map contract");

assert.match(map, /window\.nearcastAlertGeometrySnapshot/, "map consumes the authoritative alert geometry bridge");
assert.match(map, /Your selected place is inside this alert/, "inside coverage has plain-language UX");
assert.match(map, /Your selected place is outside this alert/, "outside coverage has plain-language UX");
assert.match(map, /Official boundary is not available/, "missing geometry is stated rather than guessed");
assert.match(extractFunction(map, "syncMapIntentPresentation"), /\["warning", "watch"\]/, "only an urgent inside alert preempts an explicitly requested forecast focus");
assert.match(map, /MAP_ALERT_FILL_LAYER_ID/, "WebGL map renders official alert fills");
assert.match(map, /renderMapAlertGeometryHtml/, "classic map renders the same official footprints");
assert.match(html, /id="immMapContext"[^>]*aria-live="polite"/, "the map has a glanceable accessible context surface");
assert.match(styles, /\.map-alert-footprint\[data-tone="warning"\]/, "warning footprints have a dedicated visual language");
assert.match(styles, /\.imm-timeline\[data-trust-state="delayed"\]/, "delayed radar is visually distinct");
assert.match(styles, /\.imm-timeline\[data-trust-state="unavailable"\]/, "unavailable radar is visually distinct");
assert.match(extractFunction(map, "syncMapIntentPresentation"), /has-map-context/, "the map surface tracks when an intent card needs collision-free space");
assert.match(styles, /\.immersive-map\.has-map-context \.map-legend\s*\{[^}]*top:\s*calc\(var\(--imm-hud-top\) \+ 104px\)/s, "the mobile legend moves below a forecast or alert context card");
assert.match(map, /const STORM_IMPACT_ENABLED\s*=\s*true/, "Storm Check is available from the full map");
assert.match(map, /Tap a storm to check whether it may reach your places/, "Storm Check has a discoverable map affordance");
assert.match(map, /if this storm core holds together/, "Storm Check uses conservative persistence language");
assert.match(map, /motion\.confidence !== "low"/, "low-confidence motion cannot produce the strongest path claim");

console.log("Map trust experience smoke passed.");
