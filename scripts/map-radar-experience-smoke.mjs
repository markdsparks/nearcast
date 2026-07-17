import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, map, html, styles, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8")
]);

function extractFunction(source, name) {
  const asyncMarker = `async function ${name}(`;
  const functionMarker = `function ${name}(`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(functionMarker);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  const bodyStart = signatureEnd >= 0 ? signatureEnd + 2 : source.indexOf("{", start);
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

function openingTagForId(source, id) {
  return source.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || "";
}

function assertSettingIsDebugOnly(className, selectId) {
  if (!html.includes(`id="${selectId}"`)) return;
  const setting = html.match(new RegExp(`<div class="[^"]*\\b${className}\\b[^"]*"[^>]*>`))?.[0] || "";
  assert.ok(setting, `${selectId} remains inside its setting wrapper`);
  assert.match(setting, /\bdata-debug-setting\b/, `${selectId} is diagnostic-only`);
  assert.match(setting, /\bhidden\b/, `${selectId} is not exposed in normal settings`);
}

// Standard and free high-detail radar are one user experience. Source forcing
// may remain available for diagnostics, but it is not a normal product choice.
assertSettingIsDebugOnly("raw-map-setting", "rawMapMode");
assertSettingIsDebugOnly("xweather-storm-setting", "xweatherStormMode");

const radarViewEntry = openingTagForId(html, "immStormEntry");
assert.ok(radarViewEntry, "the immersive map exposes one Radar view control");
assert.doesNotMatch(radarViewEntry, /\shidden(?:\s|=|>)/, "the Radar view control is stable rather than weather-dependent");
assert.match(radarViewEntry, /aria-(?:label|controls)="[^"]*(?:Radar|radar)/, "the unified control is named as Radar view");
assert.match(radarViewEntry, /aria-controls="stormViewSheet"/, "the Radar view control owns the comparison sheet");

const radarViewSheet = openingTagForId(html, "stormViewSheet");
assert.match(radarViewSheet, /aria-label="[^"]*(?:Radar|radar)/, "the shared sheet is presented as Radar view");
assert.match(html, /data-radar-view-option="nearcast"/, "Radar view includes Nearcast Radar");
assert.match(html, /data-radar-view-status="nearcast"/, "Nearcast Radar has a truthful runtime status hook");
assert.match(html, /data-radar-view-option="stormscope"/, "Radar view includes StormScope");
assert.match(html, /data-radar-view-status="stormscope"/, "StormScope has a truthful runtime status hook");
assert.match(html, />\s*Nearcast Radar\s*</, "the included radar experience is named Nearcast Radar");
assert.match(html, />\s*StormScope(?:\s*<|\s*·)/, "the premium experience is named StormScope");
assert.match(styles, /\.radar-view-option\s*\{/, "the two Radar view choices have dedicated presentation");

// The automatic high-detail path is available only in the full, non-satellite
// map. The default product mode is automatic; explicit source modes are debug
// overrides rather than a persisted user-facing tier.
assert.match(
  app,
  /RAW_MAP_EXPERIMENT_MODE\s*=\s*sanitizeRawMapExperimentMode\([\s\S]{0,420}?(?:"both"|DEFAULT_[A-Z_]*RAW[A-Z_]*)/,
  "free high detail has an automatic product default"
);
const rawModeSource = extractFunction(app, "rawMapExperimentMode");
assert.match(rawModeSource, /mapState\.immersive/, "high detail is gated to the immersive map");
assert.match(rawModeSource, /mapSatelliteEnabled\(\)/, "satellite mode opts out of automatic radar detail");

const rawModeHarness = new Function(`
  let RAW_MAP_EXPERIMENT_MODE = "both";
  const mapState = { immersive: false };
  let satellite = false;
  function mapSatelliteEnabled() { return satellite; }
  ${rawModeSource}
  return {
    mode: rawMapExperimentMode,
    immersive(value) { mapState.immersive = value; },
    satellite(value) { satellite = value; }
  };
`)();
assert.equal(rawModeHarness.mode(), "off", "the inline preview stays on standard radar");
rawModeHarness.immersive(true);
assert.equal(rawModeHarness.mode(), "both", "the full map automatically opts into available high detail");
rawModeHarness.satellite(true);
assert.equal(rawModeHarness.mode(), "off", "satellite imagery does not start high-detail radar work");

const setRawModeSource = extractFunction(app, "setRawMapExperimentMode");
const debugRawModeHarness = new Function(`
  const state = { rawMapExperimentMode: "both" };
  let RAW_MAP_EXPERIMENT_MODE = "both";
  const DEBUG_SETTINGS_ENABLED = true;
  const writes = new Map();
  const localStorage = {
    setItem(key, value) { writes.set(key, String(value)); },
    removeItem(key) { writes.delete(key); }
  };
  const RAW_MAP_EXPERIMENT_KEY = "nearcast-raw-map-experiment";
  const window = { setTimeout() {} };
  function sanitizeRawMapExperimentMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    if (["both", "all", "raw"].includes(mode)) return "both";
    if (["observed", "mrms"].includes(mode)) return "observed";
    if (["forecast", "hrrr"].includes(mode)) return "forecast";
    return "off";
  }
  function updateRawMapExperimentControl() {}
  ${setRawModeSource}
  setRawMapExperimentMode("off");
  return {
    configured: RAW_MAP_EXPERIMENT_MODE,
    stored: writes.get(RAW_MAP_EXPERIMENT_KEY)
  };
`)();
assert.equal(debugRawModeHarness.configured, "off", "debug mode can explicitly disable automatic high detail");
assert.equal(debugRawModeHarness.stored, "off", "the debug off override survives reload instead of reverting to automatic");

// Never label capability, loading, or an unseen layer as High detail. The
// status becomes true only after a raw frame is actually drawable onscreen.
const highDetailSource = extractFunction(map, "rawMapHighDetailVisible");
assert.match(highDetailSource, /mapState\.immersive/, "High detail status requires the full map");
assert.match(highDetailSource, /mapSatelliteEnabled\(\)/, "High detail status is hidden in Satellite");
assert.match(highDetailSource, /xweatherStormActive\(/, "StormScope supersedes the included High detail status");
assert.match(highDetailSource, /rawMapFrameLayerVisible\(/, "High detail status is backed by a visible raw frame");

const highDetailHarness = new Function(`
  const mapState = { immersive: false };
  let satellite = false;
  let storm = false;
  let rawVisible = false;
  let handoffVisible = false;
  function mapSatelliteEnabled() { return satellite; }
  function xweatherStormActive() { return storm; }
  function rawMapFrameLayerVisible() { return rawVisible; }
  function mapLibreRawFrameHandoffSuppressesFallback() { return handoffVisible; }
  ${highDetailSource}
  return {
    visible: () => rawMapHighDetailVisible({}, {}),
    immersive(value) { mapState.immersive = value; },
    satellite(value) { satellite = value; },
    storm(value) { storm = value; },
    raw(value) { rawVisible = value; },
    handoff(value) { handoffVisible = value; }
  };
`)();
assert.equal(highDetailHarness.visible(), false, "preview never claims High detail");
highDetailHarness.immersive(true);
assert.equal(highDetailHarness.visible(), false, "loading alone never claims High detail");
highDetailHarness.handoff(true);
assert.equal(highDetailHarness.visible(), true, "a committed drawable handoff remains truthfully High detail");
highDetailHarness.handoff(false);
highDetailHarness.raw(true);
assert.equal(highDetailHarness.visible(), true, "a successfully drawn raw frame is High detail");
highDetailHarness.satellite(true);
assert.equal(highDetailHarness.visible(), false, "Satellite suppresses the High detail claim");
highDetailHarness.satellite(false);
highDetailHarness.storm(true);
assert.equal(highDetailHarness.visible(), false, "StormScope has its own distinct active state");

const statusSource = extractFunction(map, "syncGeneratedRadarStatusChip");
assert.match(statusSource, /rawMapHighDetailVisible\(/, "the public status uses actual enhanced-layer visibility");
assert.match(statusSource, /"High detail"/, "the factual status is named High detail");
assert.doesNotMatch(statusSource, /"(?:Checking radar|Enhancing radar|Radar enhanced)"/, "the UI makes no enhancement promise while loading");

// StormScope relevance must come from weather truth, not merely from the fact
// that a fallback radar frame URL happens to exist.
const contextSource = extractFunction(map, "xweatherStormViewportContext");
assert.doesNotMatch(contextSource, /hasFallbackRadar|currentLayers|radar-frame-ready/, "a radar URL is not treated as proof of active weather");
assert.match(
  contextSource,
  /currentRadarPrecipSignal|weatherTruth|activeAlerts|(?:storm|weather)Relevance/i,
  "StormScope relevance is grounded in precipitation or alert evidence"
);
const relevanceBridgeSource = extractFunction(map, "xweatherStormWeatherRelevance");
assert.match(relevanceBridgeSource, /nearcastStormScopeRelevance/, "map promotion reads the shared weather-truth signal");
const relevanceTruthSource = extractFunction(app, "stormScopeRelevanceSnapshot");
assert.match(relevanceTruthSource, /currentRadarPrecipSignal\(\)/, "recent radar precipitation contributes to StormScope relevance");
assert.match(relevanceTruthSource, /weatherTruth\(/, "the current precipitation truth contributes to StormScope relevance");
assert.match(relevanceTruthSource, /activeAlerts/, "nearby official storm alerts contribute to StormScope relevance");

// The stable control opens the comparison; only an explicit CTA starts paid
// data. Opening or re-entering the map never silently resumes StormScope.
const entryHandlerSource = extractFunction(map, "handleXweatherStormEntry");
assert.match(entryHandlerSource, /openXweatherStormSheet\(/, "Radar view opens the comparison sheet");
assert.doesNotMatch(entryHandlerSource, /toggleXweatherStormActivation\(/, "the Radar view control does not directly start or stop paid data");
const sheetActivationSource = extractFunction(map, "activateXweatherStormFromSheet");
assert.match(sheetActivationSource, /startXweatherStormActivation\(/, "StormScope starts only from the sheet CTA");
const enterSource = extractFunction(map, "enterImmersiveMap");
assert.doesNotMatch(enterSource, /nearcastActivateXweatherStorm|startXweatherStormActivation/, "opening the full map never resumes StormScope");

const activationSource = extractFunction(map, "startXweatherStormActivation");
assert.match(
  activationSource,
  /mapLibreCurrentRecord\(\) !== record[\s\S]{0,180}!mapState\.immersive[\s\S]{0,180}!xweatherStormPreferenceEnabled\(\)[\s\S]{0,100}return;[\s\S]{0,140}syncXweatherStormLayer\(record\)/,
  "a stale StormScope config response cannot activate a replaced, closed, or cancelled map"
);

const stopStormSource = extractFunction(map, "stopXweatherStormLayer");
assert.match(
  stopStormSource,
  /reason !== "error"[\s\S]*?mapState\.immersive[\s\S]*?!mapSatelliteEnabled\(\)[\s\S]*?!xweatherStormPreferenceEnabled\(\)[\s\S]*?scheduleRawMapEnhancement\(mapState\.timelineKind\)/,
  "an automatic StormScope stop restores the included high-detail path after preference is cleared"
);

const radarViewSyncSource = map.match(/window\.nearcastSyncRadarView\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\};/)?.[0] || "";
assert.match(radarViewSyncSource, /syncXweatherStormActivationControl\(mapLibreCurrentRecord\(\)\)/, "weather-signal changes have one shared Radar view refresh bridge");
const alertsLoadingSource = extractFunction(app, "setAlertsLoading");
const alertsRenderSource = extractFunction(app, "renderAlerts");
assert.match(alertsLoadingSource, /nearcastSyncRadarView\?\.\(\)/, "clearing stale alerts refreshes StormScope relevance");
assert.match(alertsRenderSource, /nearcastSyncRadarView\?\.\(\)/, "new alert results refresh StormScope relevance");
const radarProbeSource = extractFunction(map, "startRadarPrecipProbe");
assert.equal(
  (radarProbeSource.match(/nearcastSyncRadarView\?\.\(\)/g) || []).length,
  2,
  "successful and unavailable radar probes both refresh StormScope relevance"
);

const exitSource = extractFunction(map, "exitImmersiveMap");
assert.match(exitSource, /(?:endXweatherStormSession|nearcastDeactivateXweatherStorm)/, "leaving the full map ends the premium session");
assert.match(exitSource, /disposeRawMapEnhancement/, "leaving the full map releases high-detail work and restores fallback radar");
const baseModeSource = extractFunction(map, "setMapBaseMode");
assert.match(baseModeSource, /(?:endXweatherStormSession|nearcastDeactivateXweatherStorm)/, "entering Satellite ends StormScope instead of silently parking it");
assert.match(baseModeSource, /disposeRawMapEnhancement/, "entering Satellite releases high-detail radar work");
assert.match(baseModeSource, /scheduleRawMapEnhancement/, "returning from Satellite can quietly restore included High detail");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "app and service-worker versions stay synchronized");
assert.ok(html.includes(`app.js?v=${version}`), "HTML loads the current app version");
assert.ok(html.includes(`map.js?v=${version}`), "HTML loads the current map model");
assert.ok(html.includes(`styles.css?v=${version}`), "HTML loads the current Radar view presentation");

console.log(`Map radar experience smoke passed for Nearcast ${version}.`);
