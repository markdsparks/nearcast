#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, confidenceSource] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "forecast-confidence.js"), "utf8")
]);

function extractFunction(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const starts = markers.map((marker) => source.indexOf(marker)).filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  assert.notEqual(start, -1, `Found ${name}`);
  const bodyStart = source.indexOf("{", start);
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
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not extract ${name}`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const rosterMatch = app.match(/const FORECAST_CONFIDENCE_MODELS\s*=\s*Object\.freeze\((\[[\s\S]*?\])\);/);
assert.ok(rosterMatch, "forecast confidence declares a bounded independent-model roster");
const roster = plain(vm.runInNewContext(rosterMatch[1]));
assert.deepEqual(
  roster,
  [
    { id: "gfs", suffix: "gfs_seamless", name: "NOAA GFS" },
    { id: "gem", suffix: "gem_seamless", name: "Environment Canada GEM" },
    { id: "icon", suffix: "icon_seamless", name: "DWD ICON" }
  ],
  "confidence compares three named, independently produced deterministic model families"
);
assert.equal(new Set(roster.map((model) => model.id)).size, roster.length, "model ids are unique");
assert.equal(new Set(roster.map((model) => model.suffix)).size, roster.length, "Open-Meteo field suffixes are unique");

const fetchGuidanceSource = extractFunction(app, "fetchForecastConfidenceGuidance");
assert.match(fetchGuidanceSource, /https:\/\/api\.open-meteo\.com\/v1\/forecast\?/, "confidence uses one standard Open-Meteo multi-model request");
assert.doesNotMatch(fetchGuidanceSource, /ensemble-api|\/v1\/ensemble/, "v1 does not silently mix deterministic families with ensemble members");
assert.match(fetchGuidanceSource, /models:\s*FORECAST_CONFIDENCE_MODELS\.map\([\s\S]{0,100}?\.suffix\)\.join\(","\)/, "the complete declared roster is requested together");
assert.match(fetchGuidanceSource, /forecast_hours:\s*"72"/, "confidence guidance has a bounded 72-hour horizon");
for (const field of ["temperature_2m", "precipitation_probability", "precipitation", "weather_code", "wind_gusts_10m"]) {
  assert.ok(fetchGuidanceSource.includes(field), `multi-model request includes ${field}`);
}

// Exercise the real suffix normalizer with a response shaped exactly like the
// Open-Meteo multi-model API. This catches roster/query changes that leave the
// field reader silently empty.
const normalizeSandbox = {
  FORECAST_CONFIDENCE_MODELS: roster,
  FORECAST_CONFIDENCE_CACHE_MAX_AGE_MS: 30 * 60 * 1000,
  continuityPlaceKey(place) {
    return `${Number(place.latitude).toFixed(3)}|${Number(place.longitude).toFixed(3)}`;
  },
  parseForecastTimestamp(value) {
    return Date.parse(`${value}Z`);
  }
};
vm.createContext(normalizeSandbox);
vm.runInContext(`${extractFunction(app, "forecastConfidenceNumber")}\n${extractFunction(app, "normalizeForecastConfidenceGuidance")}\nglobalThis.normalize = normalizeForecastConfidenceGuidance;`, normalizeSandbox);
const hours = Array.from({ length: 12 }, (_, index) => `2026-08-19T${String(index).padStart(2, "0")}:00`);
const hourly = { time: hours };
const hourlyUnits = {};
roster.forEach((model, modelIndex) => {
  hourly[`temperature_2m_${model.suffix}`] = hours.map((_, index) => 70 + modelIndex + index / 10);
  hourly[`precipitation_probability_${model.suffix}`] = hours.map((_, index) => 10 + modelIndex + index);
  hourly[`precipitation_${model.suffix}`] = hours.map((_, index) => index === 7 ? 0.1 + modelIndex / 100 : 0);
  hourly[`weather_code_${model.suffix}`] = hours.map((_, index) => index === 7 ? 61 : 3);
  hourly[`wind_gusts_10m_${model.suffix}`] = hours.map((_, index) => 12 + modelIndex + index / 10);
  hourlyUnits[`temperature_2m_${model.suffix}`] = "°F";
  hourlyUnits[`precipitation_${model.suffix}`] = "inch";
  hourlyUnits[`wind_gusts_10m_${model.suffix}`] = "mph";
});
const normalized = plain(normalizeSandbox.normalize(
  { hourly, hourly_units: hourlyUnits },
  { latitude: 38.723, longitude: -89.955 }
));
assert.equal(normalized.placeKey, "38.723|-89.955", "normalized guidance is pinned to the requested coordinates");
assert.equal(normalized.status, "ready", "all three correctly suffixed families become ready");
assert.deepEqual(normalized.sources.map((source) => source.id), ["gfs", "gem", "icon"], "normalization preserves the declared roster order");
assert.ok(normalized.sources.every((source) => source.hours.length === 12), "every model family retains its hourly evidence");
assert.deepEqual(normalized.units, { temperature: "°F", wind: "mph", precipitation: "inch" }, "normalization retains user-facing units");
assert.equal(normalized.sources[2].hours[7].weatherCode, 61, "the suffixed weather-code series reaches model evidence");
assert.equal(normalized.sources[1].hours[7].precipProbability, 18, "the suffixed probability series reaches model evidence");
const nullHourly = { time: hours };
roster.forEach((model) => {
  for (const field of ["temperature_2m", "precipitation_probability", "precipitation", "weather_code", "wind_gusts_10m"]) {
    nullHourly[`${field}_${model.suffix}`] = hours.map(() => null);
  }
});
const nullNormalized = plain(normalizeSandbox.normalize(
  { hourly: nullHourly, hourly_units: hourlyUnits },
  { latitude: 38.723, longitude: -89.955 }
));
assert.equal(nullNormalized.status, "failed", "all-null model cells cannot fabricate usable guidance");
assert.ok(nullNormalized.sources.every((source) => source.status === "missing" && source.hours.length === 0), "null cells remain missing instead of becoming zero-valued weather");

const sourceSignalSandbox = {};
vm.createContext(sourceSignalSandbox);
vm.runInContext(`
  ${extractFunction(app, "forecastConfidenceNumber")}
  ${extractFunction(app, "forecastConfidenceWetHour")}
  ${extractFunction(app, "forecastConfidencePrecipKind")}
  ${extractFunction(app, "forecastConfidenceSourceSignal")}
  globalThis.signal = forecastConfidenceSourceSignal;
`, sourceSignalSandbox);
const evidenceStart = Date.parse("2026-08-19T00:00:00Z");
const evidenceHours = Array.from({ length: 72 }, (_, index) => ({
  atMs: evidenceStart + index * 60 * 60 * 1000,
  temperature: 75,
  precipProbability: 5,
  precipitation: 0,
  weatherCode: 1,
  gust: 12
}));
const sourceBundle = { placeKey: "38.723|-89.955", fetchedAtMs: evidenceStart, units: { precipitation: "inch" } };
const completeSignal = plain(sourceSignalSandbox.signal(
  { id: "gfs", status: "ready", hours: evidenceHours },
  sourceBundle,
  { kind: "dry-window", startMs: evidenceStart + 4 * 60 * 60 * 1000, endMs: evidenceStart + 8 * 60 * 60 * 1000 }
));
assert.equal(completeSignal.status, "ready", "a model is usable when it covers the complete claim window");
const boundarySignal = plain(sourceSignalSandbox.signal(
  { id: "gfs", status: "ready", hours: evidenceHours },
  sourceBundle,
  { kind: "dry-window", startMs: evidenceStart + 70 * 60 * 60 * 1000, endMs: evidenceStart + 74 * 60 * 60 * 1000 }
));
assert.equal(boundarySignal.status, "missing", "partial 72-hour-boundary coverage cannot represent a longer plan or day window");
const temperatureOnlyHours = evidenceHours.slice(0, 6).map((hour) => ({
  ...hour,
  precipProbability: null,
  precipitation: null,
  weatherCode: null
}));
const noDryEvidenceSignal = plain(sourceSignalSandbox.signal(
  { id: "gfs", status: "ready", hours: temperatureOnlyHours },
  sourceBundle,
  { kind: "dry-window", startMs: evidenceStart, endMs: evidenceStart + 4 * 60 * 60 * 1000 }
));
assert.equal(noDryEvidenceSignal.status, "missing", "temperature-only data cannot be counted as evidence for a dry claim");
const oneBucketOnlyHours = evidenceHours.slice(0, 4).map((hour, index) => ({
  ...hour,
  precipProbability: index === 0 ? 15 : null,
  precipitation: index === 0 ? 0 : null,
  weatherCode: index === 0 ? 1 : null
}));
const oneBucketOnlySignal = plain(sourceSignalSandbox.signal(
  { id: "gfs", status: "ready", hours: oneBucketOnlyHours },
  sourceBundle,
  { kind: "dry-window", startMs: evidenceStart, endMs: evidenceStart + 4 * 60 * 60 * 1000 }
));
assert.equal(
  oneBucketOnlySignal.status,
  "missing",
  "one relevant metric bucket cannot represent a fully covered multi-hour claim even when timestamps span the window"
);

// Confidence is supplemental. Loading and rendering canonical weather must not
// await its extra probe, and a failed probe must be swallowed locally.
const loadPlaceSource = extractFunction(app, "loadPlace");
const warmStartSource = extractFunction(app, "warmStartForecast");
const probeSource = extractFunction(app, "startForecastConfidenceProbe");
const canonicalFetchSource = extractFunction(app, "fetchForecast");
assert.match(loadPlaceSource, /renderForecast\(data, nextPlace\);[\s\S]{0,300}startForecastConfidenceProbe\(nextPlace, data, force\);/, "live canonical forecast renders before the confidence probe starts");
assert.doesNotMatch(loadPlaceSource, /await\s+startForecastConfidenceProbe/, "live forecast never waits for confidence guidance");
assert.match(warmStartSource, /renderForecast\([\s\S]{0,500}startForecastConfidenceProbe\(normalized, cached\.data\);/, "warm-start forecast also launches confidence after rendering cached truth");
assert.doesNotMatch(warmStartSource, /await\s+startForecastConfidenceProbe/, "warm start remains instant");
assert.doesNotMatch(canonicalFetchSource, /ForecastConfidence|confidenceGuidance|startForecastConfidenceProbe/, "canonical forecast acquisition is independent of supplemental confidence");
assert.match(probeSource, /try\s*\{[\s\S]*await sharedForecastConfidenceGuidanceRequest\(place\)[\s\S]*\}\s*catch\s*\{[\s\S]*supplemental evidence/, "probe failure cannot fail the canonical forecast");
const sharedGuidanceSource = extractFunction(app, "sharedForecastConfidenceGuidanceRequest");
assert.match(sharedGuidanceSource, /forecastConfidenceInflightByKey/, "compatible concurrent confidence probes share one bounded request");
assert.match(sharedGuidanceSource, /forecastConfidenceCacheKey\(place\)[\s\S]*continuityPlaceKey\(place\)/, "in-flight identity includes both storage coordinates/unit and exact place identity");

const inflightDeferred = [];
const inflightSandbox = {
  FORECAST_CONFIDENCE_CACHE_VERSION: "v1",
  state: { unit: "fahrenheit" },
  forecastConfidenceInflightByKey: new Map(),
  fetchCount: 0,
  placeLabel(place) { return place.name || "place"; },
  fetchForecastConfidenceGuidance(place) {
    inflightSandbox.fetchCount += 1;
    return new Promise((resolve) => inflightDeferred.push({ id: place.id, resolve }));
  }
};
vm.createContext(inflightSandbox);
vm.runInContext(`
  ${extractFunction(app, "forecastConfidenceCacheKey")}
  ${extractFunction(app, "continuityPlaceKey")}
  ${sharedGuidanceSource}
  globalThis.cacheKey = forecastConfidenceCacheKey;
  globalThis.shared = sharedForecastConfidenceGuidanceRequest;
`, inflightSandbox);
const coordinateTwinA = { id: "maryville-primary", latitude: 38.72341, longitude: -89.95461, name: "Maryville" };
const coordinateTwinB = { id: "maryville-search-result", latitude: 38.72342, longitude: -89.95462, name: "Maryville" };
assert.equal(
  inflightSandbox.cacheKey(coordinateTwinA),
  inflightSandbox.cacheKey(coordinateTwinB),
  "the regression fixture intentionally collides at the rounded coordinate/unit storage key"
);
const twinRequestA = inflightSandbox.shared(coordinateTwinA);
const twinRequestB = inflightSandbox.shared(coordinateTwinB);
assert.notEqual(twinRequestA, twinRequestB, "different exact place identities never share an incompatible in-flight guidance promise");
assert.equal(inflightSandbox.fetchCount, 2, "both exact place representations receive their own normalization request");
assert.equal(inflightSandbox.forecastConfidenceInflightByKey.size, 2, "both incompatible requests remain independently tracked while pending");
inflightDeferred.find((entry) => entry.id === coordinateTwinA.id).resolve({ placeKey: `id:${coordinateTwinA.id}` });
inflightDeferred.find((entry) => entry.id === coordinateTwinB.id).resolve({ placeKey: `id:${coordinateTwinB.id}` });
await Promise.all([twinRequestA, twinRequestB]);
assert.equal(inflightSandbox.forecastConfidenceInflightByKey.size, 0, "each exact-place in-flight entry cleans itself up after completion");

const compatibleRequestA = inflightSandbox.shared(coordinateTwinA);
const compatibleRequestB = inflightSandbox.shared({ ...coordinateTwinA, name: "Maryville, Illinois" });
assert.equal(compatibleRequestA, compatibleRequestB, "two concurrent representations of the same exact place still deduplicate");
assert.equal(inflightSandbox.fetchCount, 3, "compatible deduplication starts only one additional request");
inflightDeferred.at(-1).resolve({ placeKey: `id:${coordinateTwinA.id}` });
await Promise.all([compatibleRequestA, compatibleRequestB]);

// Cache attachment must reject a bundle from any other exact place, and late
// responses must be unable to repaint a place selected after the request began.
const isolationSandbox = {
  forecastConfidenceGuidanceByForecast: new WeakMap(),
  continuityPlaceKey(place) {
    return `${Number(place.latitude).toFixed(3)}|${Number(place.longitude).toFixed(3)}`;
  }
};
vm.createContext(isolationSandbox);
vm.runInContext(`${extractFunction(app, "bindForecastConfidenceGuidance")}\nglobalThis.bind = bindForecastConfidenceGuidance;`, isolationSandbox);
const forecastObject = {};
const maryville = { latitude: 38.723, longitude: -89.955 };
assert.equal(
  isolationSandbox.bind(forecastObject, maryville, { placeKey: "38.723|-89.955", status: "ready", sources: [] }),
  true,
  "an exact-place guidance bundle may attach to its canonical forecast"
);
assert.equal(
  isolationSandbox.bind({}, maryville, { placeKey: "38.724|-89.955", status: "ready", sources: [] }),
  false,
  "even a nearby but different place cannot contaminate confidence"
);
assert.match(probeSource, /sequence !== forecastConfidenceProbeSequence/, "a superseded probe cannot repaint the current forecast");
assert.match(probeSource, /state\.forecast !== data/, "a response cannot attach to a replaced forecast object");
assert.match(probeSource, /!samePlanPlace\(state\.activePlace, place\)/, "a response cannot attach after the active place changes");

const cachedForecast = {};
const wrongPlaceCache = {
  savedAt: Date.now() - 60 * 1000,
  bundle: { placeKey: "38.624|-89.955", status: "ready", sources: [] }
};
const cacheProbeSandbox = {
  FORECAST_CONFIDENCE_CACHE_VERSION: "v1",
  FORECAST_CONFIDENCE_CACHE_FALLBACK_MS: 3 * 60 * 60 * 1000,
  FORECAST_CONFIDENCE_CACHE_MAX_AGE_MS: 30 * 60 * 1000,
  FORECAST_CONFIDENCE_FORCE_FLOOR_MS: 10 * 60 * 1000,
  forecastConfidencePresentation() {},
  forecastConfidenceGuidanceByForecast: new WeakMap(),
  state: { unit: "fahrenheit", forecast: cachedForecast, activePlace: maryville },
  localStorage: { getItem() { return JSON.stringify(wrongPlaceCache); } },
  liveFetchCount: 0,
  renderCount: 0,
  continuityPlaceKey(place) {
    return `${Number(place.latitude).toFixed(3)}|${Number(place.longitude).toFixed(3)}`;
  },
  samePlanPlace(left, right) {
    return Number(left?.latitude).toFixed(3) === Number(right?.latitude).toFixed(3) &&
      Number(left?.longitude).toFixed(3) === Number(right?.longitude).toFixed(3);
  },
  async sharedForecastConfidenceGuidanceRequest(place) {
    cacheProbeSandbox.liveFetchCount += 1;
    return { placeKey: cacheProbeSandbox.continuityPlaceKey(place), status: "ready", sources: [] };
  },
  renderForecastConfidenceSurfaces() {
    cacheProbeSandbox.renderCount += 1;
  }
};
vm.createContext(cacheProbeSandbox);
vm.runInContext(`
  let forecastConfidenceProbeSequence = 0;
  ${extractFunction(app, "forecastConfidenceCacheKey")}
  ${extractFunction(app, "readForecastConfidenceCache")}
  ${extractFunction(app, "bindForecastConfidenceGuidance")}
  ${extractFunction(app, "startForecastConfidenceProbe")}
  globalThis.start = startForecastConfidenceProbe;
`, cacheProbeSandbox);
await cacheProbeSandbox.start(maryville, cachedForecast, false);
assert.equal(cacheProbeSandbox.liveFetchCount, 1, "a fresh cache record carrying another place key falls through to a live guidance request");
assert.equal(cacheProbeSandbox.renderCount, 1, "the wrong-place cache never renders; only the exact-place live bundle updates confidence surfaces");

const historySavedAt = Date.parse("2026-08-19T16:00:00Z");
const historyClaimStart = Date.parse("2026-08-20T20:00:00Z");
const historySandbox = {
  state: { activePlace: maryville },
  runs: [
    {
      placeKey: "38.723|-89.955",
      checkedAt: historySavedAt - 2 * 60 * 60 * 1000,
      days: [
        { date: "2026-08-19", eventKind: "storm", precipStartMs: Date.parse("2026-08-19T20:00:00Z") },
        { date: "2026-08-20", eventKind: "rain", precipStartMs: historyClaimStart },
        { date: "2026-08-20", eventKind: "storm", precipStartMs: historyClaimStart - 2 * 60 * 60 * 1000 }
      ]
    },
    {
      placeKey: "38.723|-89.955",
      checkedAt: historySavedAt - 60 * 60 * 1000,
      days: [
        { date: "2026-08-20", eventKind: "rain", precipStartMs: historyClaimStart - 30 * 60 * 1000 },
        { date: "2026-08-21", eventKind: "storm", precipStartMs: historyClaimStart + 24 * 60 * 60 * 1000 }
      ]
    },
    {
      placeKey: "38.723|-89.955",
      checkedAt: historySavedAt,
      days: [
        { date: "2026-08-20", eventKind: "storm", precipStartMs: historyClaimStart + 3 * 60 * 60 * 1000 }
      ]
    }
  ],
  forecastProvenance() { return { savedAt: historySavedAt }; },
  forecastPulseRuns() { return historySandbox.runs; },
  parseForecastTimestamp(value) { return Date.parse(`${value}T00:00:00Z`); }
};
vm.createContext(historySandbox);
vm.runInContext(`
  ${extractFunction(app, "forecastConfidenceNumber")}
  ${extractFunction(app, "forecastConfidenceHistory")}
  globalThis.history = forecastConfidenceHistory;
`, historySandbox);
const scopedHistory = plain(historySandbox.history(
  { daily: { time: ["2026-08-19", "2026-08-20", "2026-08-21"] } },
  {
    kind: "precip-window",
    startMs: historyClaimStart,
    endMs: historyClaimStart + 3 * 60 * 60 * 1000,
    canonical: { eventKind: "storm" }
  },
  maryville
));
assert.deepEqual(
  scopedHistory,
  [{
    placeKey: "38.723|-89.955",
    checkedAtMs: historySavedAt - 2 * 60 * 60 * 1000,
    precipitationStartMs: historyClaimStart - 2 * 60 * 60 * 1000
  }],
  "forecast evolution only receives older baselines from the same local claim date and exact canonical weather kind"
);

const confidenceSandbox = { module: { exports: {} }, exports: {} };
confidenceSandbox.globalThis = confidenceSandbox;
confidenceSandbox.window = confidenceSandbox;
vm.createContext(confidenceSandbox);
vm.runInContext(confidenceSource, confidenceSandbox, { filename: "forecast-confidence.js" });
const presentConfidence = confidenceSandbox.module.exports.forecastConfidencePresentation;
const hourMs = 60 * 60 * 1000;
const stableCanonicalStart = Date.parse("2026-08-20T20:00:00Z");
const modelLaterSignals = roster.map((model, index) => ({
  id: model.id,
  status: "ready",
  placeKey: "38.723|-89.955",
  issuedAtMs: historySavedAt,
  precipitation: {
    kind: "rain",
    startMs: stableCanonicalStart + (3 * hourMs) + index * 15 * 60 * 1000,
    endMs: stableCanonicalStart + 6 * hourMs
  },
  temperature: { min: 70, max: 78 },
  wind: { gustMax: 18 }
}));
const unrelatedModelMovement = plain(presentConfidence({
  nowMs: historySavedAt,
  place: { key: "38.723|-89.955", name: "Maryville, Illinois" },
  window: { startMs: stableCanonicalStart, endMs: stableCanonicalStart + 3 * hourMs },
  claim: {
    id: "precip:2026-08-20:0",
    kind: "precip-window",
    headline: "Rain likely this evening",
    startMs: stableCanonicalStart,
    endMs: stableCanonicalStart + 3 * hourMs,
    canonical: { eventKind: "rain" }
  },
  providerSignals: modelLaterSignals,
  expectedProviders: roster.map((model) => model.id),
  history: [{
    placeKey: "38.723|-89.955",
    checkedAtMs: historySavedAt - hourMs,
    precipitationStartMs: stableCanonicalStart
  }],
  observation: null
}));
assert.equal(unrelatedModelMovement.evidence.evolution.status, "stable", "a model-family timing offset is agreement evidence, not canonical forecast movement");
assert.equal(unrelatedModelMovement.evidence.evolution.deltaMs, 0, "canonical evolution compares canonical claim starts across runs");
assert.doesNotMatch(unrelatedModelMovement.headline, /shifted/i, "unrelated guidance movement cannot create a false Home movement claim");

// The evidence affordance is consolidated into the outlook card. The old
// launch-header location and duplicate pulse cannot compete for attention.
assert.equal((html.match(/id="forecastReceiptTrigger"/g) || []).length, 1, "there is one confidence receipt trigger");
const launchMetaStart = html.indexOf('<div class="launch-meta-row">');
const launchMetaEnd = html.indexOf('<section class="for-you-today"', launchMetaStart);
assert.ok(launchMetaStart >= 0 && launchMetaEnd > launchMetaStart, "launch metadata region is present");
assert.doesNotMatch(html.slice(launchMetaStart, launchMetaEnd), /forecastReceiptTrigger/, "confidence no longer crowds the launch header");
const outlookStart = html.indexOf('<div class="today-glance"');
const outlookEnd = html.indexOf('<div class="glance-signals"', outlookStart);
assert.ok(outlookStart >= 0 && outlookEnd > outlookStart, "outlook header region is present");
assert.match(html.slice(outlookStart, outlookEnd), /id="forecastReceiptTrigger"/, "the confidence receipt sits with the claim it explains");
assert.match(extractFunction(app, "renderTodayGlance"), /if \(els\.forecastPulse\) els\.forecastPulse\.hidden = true;/, "the legacy forecast pulse is retired from Home");

// Exercise the real receipt precedence. A good comparison may enhance a live
// forecast, but can never hide a canonical refresh failure or alert-check failure.
const receiptSandbox = {
  FORECAST_CONFIDENCE_MODELS: roster,
  state: { forecast: {}, activePlace: { id: "maryville" } },
  activeAlerts: [],
  alertTrustState: { state: "ready", checkedAt: null, reason: "" },
  radarFixture: null,
  provenanceFixture: { source: "network", savedAt: Date.now() - 5 * 60 * 1000, cacheFallback: false, reason: "" },
  confidenceFixture: {
    level: "high",
    headline: "High confidence",
    summary: "Three independent forecasts align on rain this evening.",
    evidence: {
      agreement: { status: "aligned", providersUsed: 3, providersExpected: 3, providerIds: ["gfs", "gem", "icon"], timingRangeMs: 60 * 60 * 1000 },
      evolution: { status: "stable", direction: null }
    },
    limitations: []
  },
  forecastProvenance() { return receiptSandbox.provenanceFixture; },
  forecastAgeLabel(ms) { return `${Math.max(0, Math.round(ms / 60000))} min ago`; },
  radarSignalForForecastData() { return receiptSandbox.radarFixture; },
  forecastPulseDayPresentation() { return { status: "learning", tone: "neutral", label: "", detail: "" }; },
  forecastDailyIndex() { return 0; },
  nearcastForecastConfidence() { return receiptSandbox.confidenceFixture; },
  nearcastEvidencePresentation() { return { basis: "forecast", label: "Forecast guidance" }; },
  alertCountLabel(count) { return `${count} alert${count === 1 ? "" : "s"}`; },
  weatherTruth() { return {}; }
};
vm.createContext(receiptSandbox);
vm.runInContext(`${extractFunction(app, "forecastConfidenceSourceList")}\n${extractFunction(app, "forecastTrustPresentation")}\nglobalThis.present = forecastTrustPresentation;`, receiptSandbox);
const liveReceipt = plain(receiptSandbox.present({}, { precip: { phase: "dry" } }));
assert.equal(liveReceipt.tone, "confidence-high", "confidence can summarize a healthy live forecast");
assert.equal(liveReceipt.trigger, "High confidence");
assert.equal(liveReceipt.source, "3 model families align");
assert.match(liveReceipt.sourceMeta, /NOAA GFS/);
assert.match(liveReceipt.sourceMeta, /Environment Canada GEM/);
assert.match(liveReceipt.sourceMeta, /DWD ICON/);

receiptSandbox.radarFixture = {
  phase: "active",
  label: "Light rain",
  source: "weather radar",
  timestamp: Date.now() - 4 * 60 * 1000
};
const observedReceipt = plain(receiptSandbox.present({}, {
  precip: { phase: "likely-this-hour", source: "radar-current", label: "Light rain" }
}));
assert.equal(observedReceipt.tone, "observed", "fresh direct radar keeps the observed Home treatment instead of a model-agreement color");
assert.equal(observedReceipt.trigger, "Radar confirms light rain", "the collapsed Home receipt leads with what radar observes now");
assert.match(observedReceipt.triggerMeta, /4 min ago/, "the collapsed observed claim keeps radar freshness visible");
assert.equal(observedReceipt.headline, "High confidence", "model confidence remains available inside the expanded receipt");
assert.equal(observedReceipt.source, "3 model families align", "the expanded receipt retains independent-guidance evidence behind the observed Home claim");
assert.match(observedReceipt.evidence, /observed on radar/i, "the sheet separately explains the direct observation");

receiptSandbox.radarFixture = null;

receiptSandbox.provenanceFixture = {
  source: "cache",
  savedAt: Date.now() - 2 * 60 * 60 * 1000,
  cacheFallback: true,
  reason: "forecast-fetch-failed"
};
const staleReceipt = plain(receiptSandbox.present({}, { precip: { phase: "dry" } }));
assert.equal(staleReceipt.tone, "stale", "an old canonical fallback preempts a reassuring confidence color");
assert.equal(staleReceipt.trigger, "Using saved forecast", "canonical refresh failure stays visible in the collapsed receipt");
assert.match(staleReceipt.headline, /older saved forecast/i);
assert.equal(staleReceipt.source, "Open-Meteo Best Match", "supplemental models do not replace the canonical source during failure");

receiptSandbox.provenanceFixture = { source: "network", savedAt: Date.now() - 5 * 60 * 1000, cacheFallback: false, reason: "" };
receiptSandbox.alertTrustState = { state: "failed", checkedAt: Date.now(), reason: "timeout" };
const alertFailureReceipt = plain(receiptSandbox.present({}, { precip: { phase: "dry" } }));
assert.equal(alertFailureReceipt.tone, "issue", "an alert-check failure preempts a reassuring confidence color");
assert.match(alertFailureReceipt.headline, /alerts could not be checked/i);
assert.doesNotMatch(alertFailureReceipt.trigger, /high confidence/i, "the compact line cannot conceal failed official-alert verification");
assert.match(alertFailureReceipt.triggerMeta, /Alerts unavailable/);

// Best Match remains the one canonical weather story; the three comparison
// families are named evidence, not blended into an opaque fourth forecast.
const confidenceIntegrationSource = app.slice(
  app.indexOf("const FORECAST_CONFIDENCE_CACHE_VERSION"),
  app.indexOf("function renderForecastTrust")
);
assert.match(confidenceIntegrationSource, /Open-Meteo Best Match/, "canonical source is explicitly attributed");
for (const name of ["NOAA GFS", "Environment Canada GEM", "DWD ICON"]) {
  assert.ok(confidenceIntegrationSource.includes(name), `${name} is explicitly attributed in the evidence receipt`);
}
assert.doesNotMatch(confidenceIntegrationSource, /confidence(?:Score|Pct|Percent|Percentage)|Math\.round\([^)]*confidence[^)]*\*\s*100/i, "integration exposes calibrated language instead of a synthetic score");
assert.doesNotMatch(confidenceSource, /\bconfidence\s+(?:of\s+)?\d{1,3}(?:\.\d+)?\s*%/i, "the confidence engine never emits an invented confidence percentage");
assert.match(html, /never an invented percentage/i, "the detailed receipt explains the no-false-precision policy");

console.log("PASS  Forecast Confidence integration: independent guidance, non-blocking probes, exact-place isolation, consolidated receipt, and failure precedence");
