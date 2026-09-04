import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(path.join(root, "app.js"), "utf8");

function extractFunction(source, name) {
  const asyncMarker = `async function ${name}(`;
  const functionMarker = `function ${name}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(functionMarker);
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

const functionNames = [
  "normalizeAlertPosition",
  "normalizeAlertRing",
  "normalizeAlertPolygon",
  "alertGeometryBbox",
  "normalizeAlertGeometry",
  "unwrappedAlertRing",
  "alertPointOnSegment",
  "alertPointRingRelation",
  "alertPointInPolygon",
  "alertGeometryContainsPlace",
  "alertPlaceCoverage",
  "normalizeNwsAlertFeature",
  "alertTone",
  "alertPriority",
  "alertIdentityKey",
  "cloneAlertGeometry",
  "alertGeometrySnapshot",
  "openAlertAffectedArea",
  "fetchAlerts"
];

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
  const ALERT_TONE_RANK = { warning: 4, watch: 3, advisory: 2, notice: 1 };
  const ALERTS_FETCH_TIMEOUT_MS = 1000;
  let activeAlerts = [];
  let alertTrustState = { state: "unknown", checkedAt: null, reason: "" };
  let alertSheetReturnFocus = null;
  let mapIntents = [];
  let alertCloseCount = 0;
  const window = {
    nearcastOpenMapIntent(intent) { mapIntents.push(intent); return Promise.resolve(true); }
  };
  function closeAlertSheet() { alertCloseCount += 1; }
  const sessionValues = new Map();
  const sessionStorage = {
    getItem(key) { return sessionValues.has(key) ? sessionValues.get(key) : null; },
    setItem(key, value) { sessionValues.set(key, String(value)); }
  };
  let response = { features: [] };
  function placeSupportsNwsAlerts() { return true; }
  async function fetchJsonWithTimeout() { return response; }
  ${functionNames.map((name) => extractFunction(app, name)).join("\n")}
  globalThis.alertGeometryTest = {
    normalizeFeature: normalizeNwsAlertFeature,
    contains: alertGeometryContainsPlace,
    coverage: alertPlaceCoverage,
    snapshot: alertGeometrySnapshot,
    openAffectedArea: openAlertAffectedArea,
    fetch: fetchAlerts,
    setResponse(value) { response = value; },
    setAlerts(value, trust = { state: "ready", checkedAt: 1234, reason: "" }) {
      activeAlerts = value;
      alertTrustState = trust;
    },
    setCache(key, value) { sessionValues.set(key, JSON.stringify(value)); },
    mapIntents() { return mapIntents; },
    closeCount() { return alertCloseCount; }
  };
`, sandbox);

const api = sandbox.alertGeometryTest;
const plain = (value) => JSON.parse(JSON.stringify(value));
const square = {
  type: "Polygon",
  coordinates: [[
    [-90, 38],
    [-89, 38],
    [-89, 39],
    [-90, 39]
  ]]
};

const insidePlace = { latitude: 38.5, longitude: -89.5 };
const outsidePlace = { latitude: 38.5, longitude: -88.5 };
const normalized = plain(api.normalizeFeature({
  type: "Feature",
  id: "urn:nws:alert:one",
  geometry: square,
  properties: { event: "Severe Thunderstorm Warning", severity: "Severe" }
}, insidePlace));

assert.equal(normalized.id, "urn:nws:alert:one", "the GeoJSON feature identity survives normalization");
assert.equal(normalized.geometry.type, "Polygon", "official Polygon geometry is retained");
assert.deepEqual(normalized.geometry.bbox, [-90, 38, -89, 39], "normalized geometry includes stable lon/lat bounds");
assert.deepEqual(
  normalized.geometry.coordinates[0][0],
  normalized.geometry.coordinates[0].at(-1),
  "an open official ring is safely closed without changing coordinate order"
);
assert.deepEqual(
  normalized.placeCoverage,
  { status: "inside", basis: "feature-geometry" },
  "selected-place containment comes from official feature geometry"
);

const outside = plain(api.normalizeFeature({ geometry: square, properties: { event: "Warning" } }, outsidePlace));
assert.deepEqual(
  outside.placeCoverage,
  { status: "outside", basis: "feature-geometry" },
  "a place outside the official polygon is distinguished from an affected place"
);

const polygonWithHole = plain(api.normalizeFeature({
  geometry: {
    type: "Polygon",
    coordinates: [
      [[-91, 37], [-88, 37], [-88, 40], [-91, 40], [-91, 37]],
      [[-90, 38], [-89, 38], [-89, 39], [-90, 39], [-90, 38]]
    ]
  },
  properties: { event: "Warning" }
}, insidePlace));
assert.equal(polygonWithHole.placeCoverage.status, "outside", "polygon holes are respected");
const holeBoundary = plain(api.normalizeFeature({
  geometry: {
    type: "Polygon",
    coordinates: [
      [[-91, 37], [-88, 37], [-88, 40], [-91, 40], [-91, 37]],
      [[-90, 38], [-89, 38], [-89, 39], [-90, 39], [-90, 38]]
    ]
  },
  properties: { event: "Warning" }
}, { latitude: 38.5, longitude: -90 }));
assert.equal(holeBoundary.placeCoverage.status, "inside", "an exact official boundary is treated conservatively as affected");

const multipolygon = plain(api.normalizeFeature({
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      square.coordinates,
      [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]
    ]
  },
  properties: { event: "Warning" }
}, { latitude: 10.5, longitude: 10.5 }));
assert.equal(multipolygon.geometry.type, "MultiPolygon", "official MultiPolygon geometry is retained");
assert.equal(multipolygon.placeCoverage.status, "inside", "any MultiPolygon component can cover the place");

const dateline = plain(api.normalizeFeature({
  geometry: {
    type: "Polygon",
    coordinates: [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]]
  },
  properties: { event: "Warning" }
}, { latitude: 11, longitude: 179.5 }));
assert.equal(dateline.placeCoverage.status, "inside", "containment remains correct across the antimeridian");
assert.equal(
  api.contains(dateline.geometry, { latitude: 11, longitude: 0 }),
  false,
  "an antimeridian polygon does not falsely cover the opposite side of the world"
);

const noGeometry = plain(api.normalizeFeature({
  type: "Feature",
  geometry: null,
  properties: { event: "Heat Advisory" }
}, insidePlace));
assert.deepEqual(
  noGeometry.placeCoverage,
  { status: "inside", basis: "nws-point-query" },
  "a geometry-free result remains covered because the authoritative request was point-filtered"
);

const malformed = plain(api.normalizeFeature({
  geometry: { type: "Polygon", coordinates: [[[999, 0], [1, 0], [1, 1], [999, 0]]] },
  properties: { event: "Warning" }
}, insidePlace));
assert.equal(malformed.geometry, null, "malformed official geometry is never partially repaired");
assert.deepEqual(
  malformed.placeCoverage,
  { status: "unknown", basis: "unavailable" },
  "malformed geometry is unknown rather than inferred from the point request"
);
assert.deepEqual(
  plain(api.normalizeFeature(malformed, insidePlace)).placeCoverage,
  { status: "unknown", basis: "unavailable" },
  "cache rehydration cannot turn malformed geometry into inferred coverage"
);

api.setAlerts([{
  ...normalized,
  description: "private-to-alert-detail",
  instruction: "private-to-alert-detail"
}]);
const firstSnapshot = api.snapshot();
assert.deepEqual(
  plain(firstSnapshot.alerts[0].placeCoverage),
  { status: "inside", basis: "feature-geometry" },
  "the map bridge carries the stable place-coverage contract"
);
assert.equal(firstSnapshot.alerts[0].inside, true, "the map bridge includes a tri-state convenience flag");
assert.equal("description" in firstSnapshot.alerts[0], false, "full alert prose does not cross the map bridge");
firstSnapshot.alerts[0].geometry.coordinates[0][0][0] = 42;
assert.equal(api.snapshot().alerts[0].geometry.coordinates[0][0][0], -90, "map consumers receive a defensive geometry copy");
assert.equal(api.openAffectedArea(`id:${normalized.id}`), true, "an alert with official geometry can open its affected area");
assert.deepEqual(
  plain(api.mapIntents()[0]),
  {
    type: "alert",
    source: "alert",
    alertKey: `id:${normalized.id}`,
    alertId: `id:${normalized.id}`,
    event: "Severe Thunderstorm Warning",
    returnFocus: null
  },
  "the alert action sends stable identity through the map-intent bridge"
);
assert.equal(api.closeCount(), 1, "the alert sheet closes after map navigation begins");

const renderInsightSource = extractFunction(app, "renderAlertInsight");
assert.match(renderInsightSource, /data-alert-map-key=/, "the top-alert read includes a map action hook");
assert.match(renderInsightSource, />Show affected area</, "the official area action uses direct user language");
assert.match(app, /window\.nearcastAlertGeometrySnapshot\s*=\s*alertGeometrySnapshot/, "map code receives alerts through the stable read-only bridge");

const fetchPlace = { latitude: 38.5, longitude: -89.5 };
api.setResponse({
  features: [{
    type: "Feature",
    id: "urn:nws:alert:fetched",
    geometry: square,
    properties: { event: "Severe Thunderstorm Warning", severity: "Severe" }
  }]
});
const fetched = plain(await api.fetch(fetchPlace));
assert.equal(fetched[0].geometry.type, "Polygon", "fetchAlerts retains feature geometry instead of dropping the envelope");
assert.equal(fetched[0].placeCoverage.status, "inside", "fresh alert fetches compute place containment");
const cached = plain(await api.fetch(fetchPlace));
assert.deepEqual(cached[0].geometry, fetched[0].geometry, "cached alerts preserve and re-normalize official geometry");

console.log("Alert geometry smoke passed.");
