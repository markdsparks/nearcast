import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(root, "native", "ios");
const [
  app,
  sky,
  html,
  styles,
  serviceWorker,
  nativeBridge,
  nativeWebView,
  debugPlist,
  releasePlist,
  xcodeProject
] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "sky.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(nativeRoot, "NearcastApp", "Bridge", "NativeBridge.swift"), "utf8"),
  readFile(path.join(nativeRoot, "NearcastApp", "Views", "NearcastWebView.swift"), "utf8"),
  readFile(path.join(nativeRoot, "NearcastApp", "Support", "Info-Debug.plist"), "utf8"),
  readFile(path.join(nativeRoot, "NearcastApp", "Support", "Info-Release.plist"), "utf8"),
  readFile(path.join(nativeRoot, "Nearcast.xcodeproj", "project.pbxproj"), "utf8")
]);

function extractBalancedBlock(source, start, label, bodyStartOverride = -1) {
  assert.notEqual(start, -1, `Found ${label}`);
  const bodyStart = bodyStartOverride >= 0 ? bodyStartOverride : source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Found ${label} body`);
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
  assert.fail(`Could not extract ${label}`);
}

function extractFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  const signatureEnd = source.indexOf(") {", start);
  return extractBalancedBlock(source, start, name, signatureEnd + 2);
}

function extractAssignedFunction(source, marker) {
  const start = source.indexOf(marker);
  const signatureEnd = source.indexOf(") {", start);
  return extractBalancedBlock(source, start, marker, signatureEnd + 2);
}

function openingTagForId(source, id) {
  return source.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || "";
}

// The first release is a real, visible experiment, but starts off and keeps
// device sensors behind a second, explicit user action.
const reactiveSetting = html.match(/<div class="[^"]*\breactive-sky-setting\b[^"]*"[^>]*>/)?.[0] || "";
assert.ok(reactiveSetting, "Reactive sky is present in normal settings");
assert.doesNotMatch(reactiveSetting, /\b(?:hidden|data-debug-setting)\b/, "Reactive sky is not hidden behind debug settings");
assert.match(html, /Reactive sky[\s\S]{0,100}Experimental/, "the setting is clearly labeled experimental");
const reactiveToggle = openingTagForId(html, "reactiveSkyToggle");
assert.match(reactiveToggle, /aria-pressed="false"/, "Reactive sky is visibly off by default");
assert.match(html, /<button[^>]*id="reactiveSkyToggle"[^>]*>Off<\/button>/, "the default action reads Off");
assert.match(app, /reactiveSkyEnabled:\s*localStorage\.getItem\(REACTIVE_SKY_KEY\)\s*===\s*"1"/, "missing storage opt-in resolves to disabled");

const motionSetting = openingTagForId(html, "reactiveSkyMotionSetting");
assert.match(motionSetting, /\bhidden\b/, "the optional motion row stays hidden until the experiment is enabled");
assert.match(html, /<button[^>]*id="reactiveSkyMotionButton"[^>]*>Allow motion<\/button>/, "motion has its own explicit permission action");
const skyLab = openingTagForId(html, "reactiveSkyLabSetting");
assert.match(skyLab, /\bdata-debug-setting\b/, "Sky Lab remains diagnostic-only");
assert.match(skyLab, /\bhidden\b/, "Sky Lab is hidden in normal settings");

const toggleExperimentSource = extractFunction(app, "toggleReactiveSky");
assert.match(toggleExperimentSource, /localStorage\.setItem\(REACTIVE_SKY_KEY/, "the experiment choice persists");
assert.doesNotMatch(toggleExperimentSource, /requestPermission|startReactiveSkyNativeMotion|requestReactiveSkyWebMotion/, "enabling weather motion does not prompt for device sensors");
const toggleMotionSource = extractFunction(app, "toggleReactiveSkyDeviceMotion");
assert.match(toggleMotionSource, /startReactiveSkyNativeMotion\(\{\s*userInitiated:\s*true\s*\}\)/, "native motion starts only from the explicit action");
assert.match(toggleMotionSource, /requestReactiveSkyWebMotion\(\)/, "web motion permission starts only from the explicit action");
assert.match(extractFunction(app, "requestReactiveSkyWebMotion"), /DeviceOrientationEvent\?\.requestPermission/, "Safari's permission API is called from the gesture path");
assert.match(extractFunction(app, "startReactiveSkyNativeMotion"), /bridge\.start\(\{\s*frequencyHz:\s*8/, "native samples are requested at a restrained 8 Hz");

// Sensor work is allowed only for a opted-in, useful, foreground Current
// Location scene. This harness exercises the actual gate without a DOM.
const shouldRunSource = extractFunction(app, "reactiveSkyMotionShouldRun");
const motionGate = new Function(`
  const state = { reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false };
  const document = { hidden: false };
  let currentLocation = true;
  let supported = true;
  let reduced = false;
  let paused = false;
  let usefulWeather = true;
  function reactiveSkyIsCurrentLocation() { return currentLocation; }
  function reactiveSkyMotionSupported() { return supported; }
  function reactiveSkyReducedMotion() { return reduced; }
  function reactiveSkyWorkIsPaused() { return paused; }
  function reactiveSkyWeatherCanRespond() { return usefulWeather; }
  ${shouldRunSource}
  return {
    shouldRun: reactiveSkyMotionShouldRun,
    enableExperiment(value) { state.reactiveSkyEnabled = value; },
    allowMotion(value) { state.reactiveSkyMotionAllowed = value; },
    currentLocation(value) { currentLocation = value; },
    supported(value) { supported = value; },
    reduced(value) { reduced = value; },
    paused(value) { paused = value; },
    usefulWeather(value) { usefulWeather = value; },
    hidden(value) { document.hidden = value; }
  };
`)();
assert.equal(motionGate.shouldRun(), false, "sensors are off on first run");
motionGate.enableExperiment(true);
assert.equal(motionGate.shouldRun(), false, "weather-only opt-in still does not start sensors");
motionGate.allowMotion(true);
assert.equal(motionGate.shouldRun(), true, "explicitly allowed motion can run for useful local weather");
motionGate.currentLocation(false);
assert.equal(motionGate.shouldRun(), false, "remote places never use the device's heading");
motionGate.currentLocation(true);
motionGate.hidden(true);
assert.equal(motionGate.shouldRun(), false, "background pages stop sensor work");
motionGate.hidden(false);
motionGate.reduced(true);
assert.equal(motionGate.shouldRun(), false, "Reduced Motion stops sensor work");
motionGate.reduced(false);
motionGate.paused(true);
assert.equal(motionGate.shouldRun(), false, "maps and covered app surfaces stop sensor work");
motionGate.paused(false);
motionGate.usefulWeather(false);
assert.equal(motionGate.shouldRun(), false, "clear scenes do not keep sensors alive");
motionGate.usefulWeather(true);
motionGate.supported(false);
assert.equal(motionGate.shouldRun(), false, "unsupported hardware stays on the weather-only fallback");

const syncMotionSource = extractFunction(app, "syncReactiveSkyMotion");
assert.match(syncMotionSource, /!reactiveSkyMotionShouldRun\(\)[\s\S]*stopReactiveSkyMotion/, "the lifecycle gate actively tears sensors down");
const stopMotionSource = extractFunction(app, "stopReactiveSkyMotion");
assert.match(stopMotionSource, /stopReactiveSkyWebMotion\(\)/, "web orientation listeners are removed");
assert.match(stopMotionSource, /reactiveSkyNativeMotionBridge\(\)\?\.stop\?\.\(\)/, "the native sensor stream is stopped");
assert.match(stopMotionSource, /nearcastSetAmbientPose\?\.\(\{\s*active:\s*false\s*\}\)/, "stopping returns the renderer to weather-only motion");

const acceptPoseSource = extractFunction(app, "acceptReactiveSkyPose");
assert.match(acceptPoseSource, /REACTIVE_SKY_HEADING_MAX_AGE_MS/, "stale headings are rejected");
assert.match(acceptPoseSource, /accuracy\s*>\s*REACTIVE_SKY_HEADING_ACCURACY_MAX/, "poor compass accuracy is rejected");
assert.match(acceptPoseSource, /accuracy[\s\S]{0,420}nearcastSetAmbientPose\?\.\(\{\s*active:\s*false\s*\}\)/, "poor accuracy immediately falls back to weather direction");
assert.match(acceptPoseSource, /setTimeout\([\s\S]*REACTIVE_SKY_HEADING_MAX_AGE_MS\s*\+\s*80/, "a stale-sample watchdog clears a stopped compass stream");

// Forecast wind is a FROM bearing. The sky converts it to travel TOWARD, then
// projects one bounded vector relative to heading for both rain and clouds.
const hourlySampleSource = extractFunction(sky, "skyHourlySample");
assert.match(hourlySampleSource, /windDirection:\s*skySeriesValue\(h\.wind_direction_10m/, "sky truth retains forecast wind direction");
const deriveSource = extractFunction(sky, "deriveSkyState");
assert.match(deriveSource, /windTravelDeg\s*=\s*windFromDeg\s*===\s*null\s*\?\s*null\s*:\s*normalizeSkyBearing\(windFromDeg\s*\+\s*180\)/, "meteorological FROM is converted to travel TOWARD");
assert.match(deriveSource, /windFromDeg[\s\S]*windTravelDeg/, "both wind conventions remain explicit in sky state");

const normalizeBearingSource = extractFunction(sky, "normalizeSkyBearing");
const signedDeltaSource = extractFunction(sky, "signedSkyBearingDelta");
const vectorSource = extractFunction(sky, "reactiveSkyVector");
const vectorHarness = new Function(`
  const state = { skyState: null };
  const reactiveSkyPose = { heading: 0, hasDeviceHeading: false };
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function clamp01(value) { return clamp(value, 0, 1); }
  ${normalizeBearingSource}
  ${signedDeltaSource}
  ${vectorSource}
  return {
    normalize: normalizeSkyBearing,
    vector: reactiveSkyVector,
    face(heading) {
      reactiveSkyPose.heading = heading;
      reactiveSkyPose.hasDeviceHeading = true;
    },
    weatherOnly() { reactiveSkyPose.hasDeviceHeading = false; }
  };
`)();
const westWindTravel = vectorHarness.normalize(270 + 180);
assert.equal(westWindTravel, 90, "wind from west travels east");
let vector = vectorHarness.vector({ windTravelDeg: westWindTravel, windMph: 35, gustMph: 35 });
assert.ok(vector.rainSlant > 0 && vector.cloudDistance > 0, "eastward weather moves rain and clouds in the same screen direction");
assert.ok(Math.abs(vector.rainSlant) <= 25, "weather-only rain slant is gravity-bounded");
vectorHarness.face(90);
vector = vectorHarness.vector({ windTravelDeg: westWindTravel, windMph: 35, gustMph: 35 });
assert.ok(Math.abs(vector.rainSlant) < 0.001, "facing with the wind keeps rain nearly vertical");
assert.ok(vector.depth > 0.99, "facing with the wind preserves a depth cue");
vectorHarness.face(180);
vector = vectorHarness.vector({ windTravelDeg: westWindTravel, windMph: 80, gustMph: 100 });
assert.ok(vector.rainSlant < 0 && vector.cloudDistance < 0, "turning around reverses both projected directions");
assert.ok(Math.abs(vector.rainSlant) <= 25 && Math.abs(vector.rainOffset) <= 22 && Math.abs(vector.cloudDistance) <= 78, "all reactive transforms remain capped");

// A heading sample updates inherited compositor tokens only. It must never
// rebuild the SVG, draw textures, or touch individual drops/clouds.
const poseSetterSource = extractAssignedFunction(sky, "window.nearcastSetAmbientPose = function nearcastSetAmbientPose");
assert.match(poseSetterSource, /applyReactiveSkyPose/, "sensor samples feed the shared vector");
assert.doesNotMatch(poseSetterSource, /renderSkyScene|updateSkyCanvas|innerHTML|createElement|toDataURL|querySelectorAll/, "sensor samples never rebuild or walk the scene");
const applyPoseSource = extractFunction(sky, "applyReactiveSkyPose");
for (const token of [
  "--sky-reactive-rain-slant",
  "--sky-reactive-rain-offset",
  "--sky-reactive-cloud-distance"
]) {
  assert.ok(applyPoseSource.includes(token), `${token} is updated as one global CSS token`);
  assert.ok(styles.includes(token), `${token} drives the renderer presentation`);
}
assert.match(styles, /\.sky-reactive-rain-vector\s*\{[\s\S]*transform:[^;]*--sky-reactive-rain-offset[^;]*--sky-reactive-rain-slant/, "one wrapper projects both rain texture layers");
assert.match(styles, /\.sky-reactive-cloud-vector\.is-animated[\s\S]*animation-name:\s*sky-reactive-cloud-travel/, "cloud strata share one coherent flow animation");
assert.match(styles, /@keyframes sky-reactive-cloud-travel[\s\S]*--sky-reactive-cloud-distance/, "cloud travel uses the same weather/heading vector");

const rainSource = extractFunction(sky, "skyRain");
assert.match(rainSource, /reactiveSkyEnabled\(\)[\s\S]*skyReactiveRain/, "only the opted-in renderer uses rain textures");
assert.match(rainSource, /if \(textureRain\) return textureRain;[\s\S]*sky-rain-streak/, "texture failure falls back to the established rain renderer");
const reactiveRainSource = extractFunction(sky, "skyReactiveRain");
assert.equal((reactiveRainSource.match(/skyRainTextureDataUrl\(/g) || []).length, 2, "reactive rain uses exactly two cached texture strata");
assert.match(reactiveRainSource, /clamp\(vw\s*\*\s*0\.78,\s*260,\s*420\)/, "rain texture width is bounded");
assert.match(reactiveRainSource, /clamp\(vh\s*\*\s*0\.48,\s*420,\s*680\)/, "rain texture height is bounded");
assert.match(reactiveRainSource, /ambient"\s*\?\s*0\.46[\s\S]*still"\s*\?\s*0\.42[\s\S]*0\.68/, "rain textures render below native screen resolution");
assert.doesNotMatch(reactiveRainSource, /requestAnimationFrame|setInterval/, "the rain renderer creates no JavaScript animation loop");

const profileSource = extractFunction(sky, "skyMotionProfile");
const profileHarness = new Function(`
  let reduced = false;
  const window = {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia(query) {
      return { matches: query.includes("prefers-reduced-motion") ? reduced : query.includes("pointer: coarse") };
    }
  };
  const document = { visibilityState: "visible" };
  const navigator = { deviceMemory: 4 };
  function reactiveSkyEnabled() { return true; }
  ${profileSource}
  return {
    profile: () => skyMotionProfile("rain", {}),
    reduced(value) { reduced = value; }
  };
`)();
const mobileProfile = profileHarness.profile();
assert.equal(mobileProfile.level, "ambient", "phones use the ambient quality tier");
assert.ok(mobileProfile.density <= 0.56, "phone particle density is materially reduced");
assert.ok(Number.isFinite(mobileProfile.animateClouds) && mobileProfile.animateClouds <= 3, "phone cloud animation count is capped");
assert.equal(mobileProfile.cloudFilter, false, "phone ambience avoids expensive SVG cloud filters");
profileHarness.reduced(true);
const reducedProfile = profileHarness.profile();
assert.equal(reducedProfile.level, "still", "Reduced Motion selects a still renderer");
assert.equal(reducedProfile.animateAtmosphere, false, "Reduced Motion disables precipitation animation");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sky-reactive-cloud-vector[\s\S]*animation:\s*none/, "CSS also enforces the Reduced Motion fallback");

// Native delivery is low-frequency, main-frame/origin scoped, and has complete
// teardown paths. Both app configurations include Apple's usage disclosure.
assert.match(nativeBridge, /WKUserScript\(source: source, injectionTime: \.atDocumentStart, forMainFrameOnly: true\)/, "native bootstrap is injected into the main frame only");
assert.match(nativeBridge, /type\.hasPrefix\("ambientMotion\."\)[\s\S]*isTrustedAmbientFrame/, "all ambient bridge messages pass the trust guard");
assert.match(nativeBridge, /guard isMainFrame,[\s\S]*scheme == "https" && host == "getnearcast\.app"/, "Release accepts ambient requests only from Nearcast's HTTPS main frame");
assert.match(nativeBridge, /frequencyHz = min\(10\.0, max\(4\.0, requestedFrequency\)\)/, "native sample frequency is capped at 4-10 Hz");
assert.match(nativeBridge, /deviceMotionUpdateInterval = 1\.0 \/ frequencyHz/, "Core Motion respects the bounded cadence");
assert.match(nativeBridge, /stopDeviceMotionUpdates\(\)[\s\S]*stopUpdatingHeading\(\)/, "native stop releases motion and compass services together");
assert.match(nativeBridge, /UIApplication\.willResignActiveNotification[\s\S]*UIApplication\.didEnterBackgroundNotification/, "native lifecycle stops sensors offscreen");
assert.match(nativeWebView, /didStartProvisionalNavigation[\s\S]*stopAmbientMotionForNavigation\(\)/, "navigation stops sensor delivery");
assert.match(nativeWebView, /dismantleUIView[\s\S]*bridge\.tearDown\(\)/, "web view teardown releases the bridge");
for (const [name, plist] of [["Debug", debugPlist], ["Release", releasePlist]]) {
  assert.match(plist, /<key>NSMotionUsageDescription<\/key>\s*<string>[^<]+<\/string>/, `${name} build explains device motion usage`);
}

const nativeBuildVersions = [...xcodeProject.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => Number(match[1]));
assert.ok(nativeBuildVersions.length > 0, "native build versions are declared");
assert.equal(new Set(nativeBuildVersions).size, 1, "iPhone, widget, watch, and complications share one build number");

// PWA assets must advance together or TestFlight's web shell can retain a
// previous experiment implementation.
const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker assets match app version");
assert.equal(serviceWorker.match(/const CACHE = "nearcast-v(\d+)"/)?.[1], version.replace(/\D/g, ""), "cache namespace matches app version");
const versionedHtmlAssets = [...html.matchAll(/(?:src|href)="[^"]+\?v=([^"]+)"/g)].map((match) => match[1]);
assert.ok(versionedHtmlAssets.length > 0, "HTML has versioned shell assets");
assert.deepEqual([...new Set(versionedHtmlAssets)], [version], "all HTML shell assets use one version");
assert.match(serviceWorker, /\$\{BASE\}sky\.js\?v=\$\{ASSET_VERSION\}/, "service worker precaches the sky renderer");
assert.ok(html.includes(`sky.js?v=${version}`), "HTML loads the current sky renderer");
assert.ok(html.includes(`styles.css?v=${version}`), "HTML loads the current reactive presentation");

console.log(`Reactive sky smoke passed for Nearcast ${version}, native build ${nativeBuildVersions[0]}.`);
