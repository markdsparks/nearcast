import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const app = readFileSync(new URL("app.js", root), "utf8");
const map = readFileSync(new URL("map.js", root), "utf8");
const planner = readFileSync(new URL("planner.js", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");
const start = app.indexOf("let nativePreviewContextPlaces = [];");
const end = app.indexOf("\nfunction handleAppDockAction(", start);
assert.ok(start > 0 && end > start, "extract production preview context and handoff implementation");
const source = app.slice(start, end);
assert.match(html, /id="nativeWeatherPreview"[^>]*hidden/, "entry is hidden by default");
assert.match(app, /bindTapAction\(document\.getElementById\("nativeWeatherPreview"\), openNativeWeatherPreview\)/);
assert.match(app, /addEventListener\("nearcast-native-ready", updateNativePreviewEntry\)/);
assert.doesNotMatch(source, /localStorage|location\.reload|syncPlanWatch|registerPlanWatch|unregisterPlanWatch|publish|postMessage\(/, "preview adds no direct storage, reload, watch or publication side effects");

const home = { id: "home", name: "Maryville", admin1: "Illinois", country: "United States", latitude: 38.723, longitude: -89.956, followsCurrentLocation: false };
const away = { id: "camp", name: "Hardin", admin1: "Kentucky", country: "United States", latitude: 36.762, longitude: -88.301, alias: "Camp", privateNote: "must not cross bridge" };
const calls = [];
const button = { hidden: true, style: { display: "none" } };
const details = { hidden: false, scrollIntoView: (options) => calls.push(["details", options]) };
const state = {
  activePlace: { ...home }, savedPlaces: [{ ...away }],
  forecastPlaceId: home.id, forecast: { timezone: "America/Chicago", daily: { time: ["2026-09-22", "2026-09-23"] } },
  unit: "celsius", theme: "dark", planMemories: [{ text: "private plan" }], subscription: "secret"
};
let load = async (place) => {
  calls.push(["load", place]);
  state.activePlace = { ...place };
  state.forecastPlaceId = place.id;
};
const mapState = { immersive: false, frames: [], frameIndex: 0 };
let basemapReady = true;
let openMap = async (intent) => {
  calls.push(["map", intent]);
  mapState.immersive = true;
  mapState.frames = [{ source: intent.source, timestamp: intent.timestamp ?? Date.parse("2026-09-22T12:00:00-05:00") }];
  mapState.frameIndex = 0;
  return true;
};
const sandbox = {
  state, mapState, window: {}, Intl, Date, Number, String, Math, Array, Boolean, Error,
  askStreaming: false,
  nearcastAgentArtifactSequence: 0, nearcastAgentSessionArtifacts: [], NEARCAST_AGENT_ARTIFACT_LIMIT: 8,
  NEARCAST_AGENT_PERIODS: new Set(["morning", "afternoon", "evening", "night", "day"]),
  NEARCAST_AGENT_ARTIFACT_KINDS: { place: "nearcast.place", window: "nearcast.forecast-window", view: "nearcast.view", plan: "nearcast.plan", confidence: "nearcast.forecast-confidence" },
  normalizePlace: (place) => ({ ...place }),
  samePlanPlace: (left, right) => left?.id === right?.id && left?.latitude === right?.latitude && left?.longitude === right?.longitude,
  buildAIContext: () => null,
  planCanonicalMaterialEventForWindow: () => null,
  planCanonicalMaterialEventSummary: () => "",
  forecastDailyIndex: () => 0,
  requestAnimationFrame: (callback) => callback(),
  document: { getElementById: (id) => id === "nativeWeatherPreview" ? button : id === "weatherEssentials" ? details : null },
  placeLabel: (place) => [place.name, place.admin1].filter(Boolean).join(", "),
  prefersTwentyFourHourClock: () => true,
  closeAppMenu: () => calls.push(["close-menu"]), setStatus: (...args) => calls.push(["status", ...args]),
  loadPlace: (place) => load(place),
  openDayFromIndex: (...args) => calls.push(["day", ...args]),
  handleAppDockAction: (destination) => calls.push(["dock", destination]),
  ensureMapBasemapConfigured: async () => basemapReady,
  initMap: () => true,
  syncMapToPlace: () => calls.push(["map-place"]),
  setAppDockCurrent: (destination) => calls.push(["dock-state", destination]),
  syncAppDockCurrent: () => calls.push(["restore-dock"]),
  openNearcastMapIntent: (intent) => openMap(intent),
  nearcastMapIntentPlace: (place) => ({ placeId: place.id, latitude: place.latitude, longitude: place.longitude }),
  nearcastMapIntentForNow: (place) => ({ source: "radar", placeId: place.id, latitude: place.latitude, longitude: place.longitude }),
  parseForecastTimestamp: (time) => Date.parse(`${time}:00-05:00`),
  forecastNowMs: () => Date.parse("2026-09-22T12:00:00-05:00"),
  activeMapSource: (frame) => frame.source,
  rawMapTimelineTimestamp: (frame) => frame.timestamp,
  exitImmersiveMap: () => { calls.push(["exit-map"]); mapState.immersive = false; },
  openGlobalMemorySheet: () => calls.push(["plans"]),
  openAISheet: (options) => {
    calls.push(["ask", options]);
    if (options.surface) sandbox.rememberNearcastSurfaceContext(options.surface);
  },
  runAsk: (question) => calls.push(["ask-run", question]),
  resetTransientViewToForecastTop: () => calls.push(["reset"])
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "app.js: native preview" });
function plannerFunction(name) {
  const beginning = planner.indexOf(`function ${name}(`);
  assert.ok(beginning >= 0, `production ${name} exists`);
  const next = planner.indexOf("\nfunction ", beginning + 1);
  return planner.slice(beginning, next);
}
vm.runInContext([
  "createNearcastAgentArtifact", "rememberNearcastAgentArtifacts", "nearcastPlaceArtifact",
  "nearcastWindowArtifact", "nearcastViewArtifact", "rememberNearcastSurfaceContext"
].map(plannerFunction).join("\n"), sandbox, { filename: "planner.js: forecast-focus artifacts" });
const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (expression) => vm.runInContext(expression, sandbox);
const handoff = (payload) => sandbox.window.NearcastNativePreview.handoff(payload);

run("updateNativePreviewEntry()");
assert.equal(button.hidden, true, "ordinary web and older native builds show no entry");
assert.equal(button.style.display, "none", "menu display:flex cannot expose hidden entry");
sandbox.window.NearcastNative = { preview: { version: 2, open: (context) => calls.push(["preview", context]) } };
run("updateNativePreviewEntry()");
assert.equal(button.hidden, true, "unsupported bridge version stays hidden");
sandbox.window.NearcastNative.preview.version = 1;
run("updateNativePreviewEntry()");
assert.equal(button.hidden, false, "supported native bridge reveals entry");
assert.equal(button.style.display, "");
run("openNativeWeatherPreview()");
const context = plain(calls.find(([kind]) => kind === "preview")[1]);
assert.deepEqual(Object.keys(context).sort(), ["version", "selectedPlace", "savedPlaces", "metric", "uses24HourClock", "theme"].sort());
assert.deepEqual(context.selectedPlace, { id: "home", name: "Maryville, Illinois", latitude: 38.723, longitude: -89.956, timezone: "America/Chicago" });
assert.deepEqual(context.savedPlaces[0], { id: "camp", name: "Hardin, Kentucky", latitude: 36.762, longitude: -88.301 });
assert.equal(context.metric, true);
assert.equal(context.uses24HourClock, true);
assert.equal(context.theme, "dark");
assert.doesNotMatch(JSON.stringify(context), /private|secret|alias|followsCurrentLocation|subscription|planMemories/);
assert.deepEqual(calls.map(([kind]) => kind), ["preview", "close-menu"], "opening preview performs no place load/navigation");

calls.length = 0;
await handoff({ version: 1, destination: "map", place: context.savedPlaces[0], targetDate: "2026-09-23" });
assert.deepEqual(calls.map(([kind]) => kind), ["load", "map-place", "dock-state", "map"]);
assert.equal(calls[0][1].name, "Hardin", "qualified label does not replace structured city name");
assert.equal(calls[0][1].admin1, "Kentucky", "structured region survives handoff");
assert.equal(calls[3][1].source, "forecast");
assert.equal(calls[3][1].timestamp, Date.parse("2026-09-23T00:00:00-05:00"), "map receives exact selected civil day in forecast timezone");
assert.equal(calls[3][1].endTimestamp, Date.parse("2026-09-24T00:00:00-05:00"));
assert.equal(calls[3][1].placeId, "camp");
assert.equal(calls.some(([kind]) => kind === "day" || kind === "dock"), false, "map never opens an intermediate day sheet or fire-and-forget dock action");

// The handoff must await the renderer's actual readiness; a successful bridge
// callback cannot be sent merely because map startup was requested.
let resolveMap;
openMap = (intent) => new Promise((resolve) => { calls.push(["pending-map", intent]); resolveMap = resolve; });
let completed = false;
const pending = handoff({ version: 1, destination: "map", place: context.savedPlaces[0] }).then(() => { completed = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(completed, false, "handoff remains pending until map readiness resolves");
await assert.rejects(handoff({ version: 1, destination: "plans", place: context.savedPlaces[0] }), /already opening/);
resolveMap(true);
await pending;
assert.equal(completed, true);
openMap = async () => false;
calls.length = 0;
await assert.rejects(handoff({ version: 1, destination: "map", place: context.savedPlaces[0] }), /did not finish opening/);
assert.ok(calls.some(([kind]) => kind === "restore-dock"), "failed map readiness restores navigation selection");
basemapReady = false;
calls.length = 0;
await assert.rejects(handoff({ version: 1, destination: "map", place: context.savedPlaces[0] }), /map is unavailable/);
assert.deepEqual(calls, [], "unavailable basemap neither opens a day nor reports successful map navigation");
basemapReady = true;

// A renderer can be ready even when it silently clamps a tomorrow request to
// the last frame this afternoon. That is not a successful dated handoff.
for (const wrongFrame of [
  { source: "forecast", timestamp: Date.parse("2026-09-22T17:30:00-05:00") },
  { source: "radar", timestamp: Date.parse("2026-09-23T00:00:00-05:00") },
  { source: "forecast", timestamp: Date.parse("2026-09-24T00:00:00-05:00") }
]) {
  openMap = async () => {
    mapState.immersive = true;
    mapState.frames = [wrongFrame];
    mapState.frameIndex = 0;
    mapState.openIntent = { event: "tomorrow" };
    mapState.pendingOpenIntent = { event: "tomorrow" };
    mapState.intentResolution = { inRange: true }; // deliberately stale metadata
    return true;
  };
  calls.length = 0;
  const result = await handoff({ version: 1, destination: "map", place: context.savedPlaces[0], targetDate: "2026-09-23" });
  assert.deepEqual(plain(result), { ok: false, reason: "map-date-unavailable" });
  assert.equal(mapState.immersive, false);
  assert.equal(mapState.openIntent, null);
  assert.equal(mapState.pendingOpenIntent, null);
  assert.equal(mapState.intentResolution, null);
  assert.ok(calls.some(([kind]) => kind === "exit-map"), "unsupported date closes contradictory map instead of leaving a wrong-day banner");
}

for (const destination of ["plans", "ask", "details"]) {
  calls.length = 0;
  assert.deepEqual(plain(await handoff({ version: 1, destination, place: context.savedPlaces[0] })), { ok: true });
  assert.equal(calls.some(([kind]) => kind === "load"), false, "already loaded place is reused");
  assert.ok(calls.some(([kind]) => kind === destination));
}
calls.length = 0;
await handoff({ version: 1, destination: "details", place: context.savedPlaces[0], targetDate: "2026-09-22" });
assert.deepEqual(calls.map(([kind]) => kind), ["day"]);
assert.equal(calls[0][1], 0);

// Seed a prior same-place day, then run the real window/view artifact builders
// and retention policy. Opening Ask must not leave yesterday's focus in charge.
run("rememberNearcastAgentArtifacts([nearcastWindowArtifact(state.activePlace, {dayIdx:0,startHour:8,endHour:10}, null, {targetDate:'2026-09-22'})])");
const privateRecordsBeforeAsk = JSON.stringify({ plans: state.planMemories, places: state.savedPlaces, subscription: state.subscription });
calls.length = 0;
await handoff({ version: 1, destination: "ask", place: context.savedPlaces[0], targetDate: "2026-09-23" });
assert.deepEqual(calls.map(([kind]) => kind), ["ask"], "Ask handoff neither opens another sheet nor submits a question");
assert.equal(calls[0][1].autoBrief, false);
assert.equal(calls[0][1].surface, "forecast");
let askArtifacts = plain(sandbox.nearcastAgentSessionArtifacts);
let askWindow = askArtifacts.find((artifact) => artifact.kind === "nearcast.forecast-window");
let askView = askArtifacts.find((artifact) => artifact.kind === "nearcast.view");
assert.equal(askArtifacts.filter((artifact) => artifact.kind === "nearcast.forecast-window").length, 1);
assert.equal(askWindow.value.target_date, "2026-09-23");
assert.equal(askWindow.value.day_index, 1);
assert.equal(askWindow.value.start_hour, 0);
assert.equal(askWindow.value.end_hour, 24);
assert.equal(askWindow.value.place.id, "camp");
assert.equal(askView.value.target_date, "2026-09-23", "exact date survives the surface-context artifact written during Ask open");
assert.equal(JSON.stringify({ plans: state.planMemories, places: state.savedPlaces, subscription: state.subscription }), privateRecordsBeforeAsk);
await handoff({ version: 1, destination: "ask", place: context.savedPlaces[0] });
askArtifacts = plain(sandbox.nearcastAgentSessionArtifacts);
askWindow = askArtifacts.find((artifact) => artifact.kind === "nearcast.forecast-window");
assert.equal(askWindow.value.target_date, "2026-09-22", "Today Ask explicitly replaces previous selected-day focus");
calls.length = 0;
await handoff({ version: 1, destination: "ask", place: context.savedPlaces[0], initialQuery: " Will rain affect soccer? " });
assert.deepEqual(calls.map(([kind]) => kind), ["ask", "ask-run"], "a bounded native draft reaches only the verified Ask host");
assert.equal(calls[1][1], "Will rain affect soccer?", "native Ask trims its draft before agent execution");
sandbox.askStreaming = true;
calls.length = 0;
await assert.rejects(handoff({ version: 1, destination: "ask", place: context.selectedPlace, targetDate: "2026-09-23" }), /current Nearcast reply/);
assert.deepEqual(calls, [], "active reply blocks place change and focus mutation before loading");
sandbox.askStreaming = false;

for (const payload of [
  { version: 2, destination: "map", place: context.savedPlaces[0] },
  { version: 1, destination: "delete-plan", place: context.savedPlaces[0] },
  { version: 1, destination: "map", place: { ...context.savedPlaces[0], longitude: -93 } },
  { version: 1, destination: "map", place: { ...context.savedPlaces[0], id: "unknown" } },
  { version: 1, destination: "map", place: { ...context.savedPlaces[0], latitude: null } },
  { version: 1, destination: "map", place: { ...context.savedPlaces[0], timezone: "invalid-zone" } },
  { version: 1, destination: "map", place: context.savedPlaces[0], targetDate: "2026-02-30" },
  { version: 1, destination: "map", place: context.savedPlaces[0], targetDate: "2026-09-23<script>" },
  { version: 1, destination: "ask", place: context.savedPlaces[0], initialQuery: "   " },
  { version: 1, destination: "ask", place: context.savedPlaces[0], initialQuery: "x".repeat(501) }
]) {
  calls.length = 0;
  await assert.rejects(handoff(payload));
  assert.deepEqual(calls, [], "invalid handoff has no load or navigation side effects");
}
calls.length = 0;
await assert.rejects(handoff({ version: 1, destination: "map", place: context.savedPlaces[0], targetDate: "2027-01-01" }), /outside/);
assert.deepEqual(calls, [], "unavailable date does not silently navigate Today");

// The real loader catches failures, and may retain/restore the previous place.
state.activePlace = { ...home };
state.forecastPlaceId = home.id;
load = async () => calls.push(["load-failed"]);
calls.length = 0;
await assert.rejects(handoff({ version: 1, destination: "map", place: context.savedPlaces[0] }), /Could not load/);
assert.deepEqual(calls, [["load-failed"]], "load rollback never opens the wrong place's map");
load = async (place) => { calls.push(["partial-load"]); state.activePlace = { ...place }; };
calls.length = 0;
await assert.rejects(handoff({ version: 1, destination: "ask", place: context.savedPlaces[0] }), /Could not load/);
assert.deepEqual(calls, [["partial-load"]], "correct label with old forecast is not accepted");

// A native cached context can return after this document is recreated, but only
// a still-known place is accepted (not an arbitrary native-supplied coordinate).
run("nativePreviewContextPlaces = []");
state.activePlace = { ...away };
state.forecastPlaceId = away.id;
calls.length = 0;
await handoff({ version: 1, destination: "plans", place: context.savedPlaces[0] });
assert.deepEqual(calls, [["plans"]]);

state.activePlace = { ...home };
state.forecastPlaceId = home.id;
calls.length = 0;
await handoff({ version: 1, destination: "ask", place: context.selectedPlace });
assert.equal(calls[0][0], "ask", "cached selected-place context retains its validated loaded timezone");

state.activePlace = { ...home };
state.forecastPlaceId = home.id;
state.savedPlaces = Array.from({ length: 70 }, (_, index) => ({ ...away, id: `place-${index}`, name: "A".repeat(220) }));
state.savedPlaces.unshift({ ...away, id: "invalid", latitude: Infinity });
state.savedPlaces.unshift({ ...away, id: "I".repeat(161) });
const bounded = plain(run("buildNativePreviewContext()"));
assert.equal(bounded.savedPlaces.length, 60);
assert.ok(bounded.savedPlaces.every((place) => place.name.length <= 180 && place.id.length <= 160));
assert.ok(bounded.savedPlaces.every((place) => Object.keys(place).every((key) => ["id", "name", "latitude", "longitude", "timezone", "countryCode"].includes(key))));
assert.equal(state.savedPlaces.length, 72, "export does not modify authoritative records");
assert.equal(plain(run('nativePreviewPlaceRecord({ id: "country", name: "Test", latitude: 40, longitude: -90, country_code: "us" })')).countryCode, "US", "declared country is exported for official alert coverage");
assert.equal(plain(run('nativePreviewPlaceRecord({ id: "country", name: "Test", latitude: 40, longitude: -90, countryCode: "unknown" })')).countryCode, undefined, "invalid country codes are omitted, not inferred");
assert.equal(plain(run('nativePreviewPlaceRecord({ id: "country", name: "Test", latitude: 40, longitude: -90 })')).countryCode, undefined, "old records remain compatible without a country field");
state.activePlace = null;
assert.throws(() => run("buildNativePreviewContext()"), /Open a place/);

// Run the actual enhancement guard: a later async HRRR result must not erase
// legitimate longer NDFD coverage after a successful dated handoff.
const rawStart = map.indexOf("function rawMapFramesCoverIntentWindow(");
const rawEnd = map.indexOf("\nfunction rawMapCanonicalFrames(", rawStart);
assert.ok(rawStart > 0 && rawEnd > rawStart);
const midnight = Date.parse("2026-09-23T00:00:00-05:00");
const sixAM = midnight + 6 * 60 * 60 * 1000;
const nextMidnight = midnight + 24 * 60 * 60 * 1000;
const forecastFrame = (timestamp, raw = false) => ({ source: "forecast", timestamp, ...(raw ? { rawMapIndexUrl: "fixture:raw" } : {}) });
const originalFrames = [forecastFrame(sixAM)];
const radarState = {
  frames: originalFrames, frameIndex: 0, nowIndex: -1, timelineKind: "precip", playing: false, immersive: true,
  rawMap: { fallbackFrames: originalFrames },
  openIntent: { source: "forecast", timestamp: midnight, endTimestamp: nextMidnight }
};
const radarCalls = [];
const radarSandbox = {
  mapState: radarState, Number, Math, Array,
  mapIntentTimestamp: (value) => value == null ? null : Number(value),
  activeMapSource: (frame) => frame?.source,
  rawMapTimelineTimestamp: (frame) => frame?.timestamp,
  rawMapCanonicalFrames: (frames) => frames || [],
  clearRawMapFrameDecoration: (frame) => ({ ...frame }),
  cancelStandardTimelineScrub: () => radarCalls.push("cancel"),
  rawMapClosestFrameIndex: () => 0,
  syncStandardTimelineSlider: () => {}, prefetchRawMapFramesAround: () => {}, showFrame: () => {},
  stopRadarPlayback: () => {}, radarTimelineLabel: () => "Observed"
};
vm.createContext(radarSandbox);
vm.runInContext(map.slice(rawStart, rawEnd), radarSandbox);
const shortForecast = [forecastFrame(midnight - 7 * 60 * 60 * 1000, true)];
assert.equal(radarSandbox.applyRawMapEnhancement({ frames: shortForecast, forecast: shortForecast, observed: [] }), 0);
assert.equal(radarState.frames, originalFrames, "async short raw timeline cannot displace the selected day's valid NDFD frame");
assert.equal(radarState.frameIndex, 0);
assert.deepEqual(radarCalls, [], "discarded enhancement does not cancel a user's scrub");
const inDayForecast = [forecastFrame(sixAM, true)];
assert.equal(radarSandbox.applyRawMapEnhancement({ frames: inDayForecast, forecast: inDayForecast, observed: [] }), 1);
assert.equal(radarState.frames[0].timestamp, sixAM, "later valid frame inside the requested day is accepted without requiring an exact midnight sample");
radarState.rawMap.fallbackFrames = [forecastFrame(midnight)];
radarState.frameIndex = 0;
radarState.nowIndex = -1;
const crossingMidnight = [forecastFrame(midnight - 5 * 60 * 1000, true), forecastFrame(midnight + 15 * 60 * 1000, true)];
assert.equal(radarSandbox.applyRawMapEnhancement({ frames: crossingMidnight, forecast: crossingMidnight, observed: [] }), 2);
assert.equal(radarState.frameIndex, 1, "closer previous-day sample cannot displace a selected-day frame when a genuine in-day sample exists");
radarState.openIntent = null;
assert.equal(radarSandbox.applyRawMapEnhancement({ frames: shortForecast, forecast: shortForecast, observed: [] }), 1, "ordinary Now map still accepts enhanced data");

console.log("PASS native preview context privacy, version gates, exact-place/date handoff and failed-load isolation");
