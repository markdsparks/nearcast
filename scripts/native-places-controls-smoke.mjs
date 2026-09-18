import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

const root = new URL("../", import.meta.url);
const app = await readFile(new URL("app.js", root), "utf8");
const planner = await readFile(new URL("planner.js", root), "utf8");
const dayGraph = await readFile(new URL("daygraph.js", root), "utf8");
const exporter = await readFile(new URL("native-places-migration.js", root), "utf8");
const controls = await readFile(new URL("native-places-controls.js", root), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const match = /\n(?:async )?function /g;
  match.lastIndex = start + 1;
  const end = match.exec(source)?.index;
  assert.ok(end, `${name} is bounded`);
  return source.slice(start, end);
}
const place = (id, overrides = {}) => ({ id, name: "Maryville", admin1: "Illinois", country: "United States", countryCode: "US", latitude: 38.7237, longitude: -89.9559, timezone: "America/Chicago", ...overrides });

function fixture(records = [place(4243918), place("family", { alias: "Family", name: "Nokomis" })], options = {}) {
  const stored = new Map([
    ["weather-places", JSON.stringify(records)],
    ["weather-last-place", JSON.stringify(records[0] ?? null)],
    ...(options.watch === undefined ? [] : [["nearcast-place-watch-notification-places-v1", JSON.stringify(options.watch)]])
  ]);
  const counts = { sync: 0, renders: 0, loads: 0, locations: 0, menu: 0, permission: 0 };
  const failures = new Set();
  const timers = new Map();
  let timerID = 0;
  let loadFailure = false;
  const storage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { if (failures.has(key)) throw new Error("PRIVATE storage error"); stored.set(key, String(value)); },
    removeItem(key) { if (failures.has(key)) throw new Error("PRIVATE storage error"); stored.delete(key); }
  };
  const sandbox = {
    window: { NearcastNative: { preview: { controlsVersion: 1 } } },
    nativePlacesMigrationInventoryReady: true,
    TextEncoder, Intl, Date,
    setTimeout: options.fakeTimers ? (callback) => { timers.set(++timerID, callback); return timerID; } : setTimeout,
    clearTimeout: options.fakeTimers ? (id) => { timers.delete(id); } : clearTimeout,
    localStorage: storage,
    state: {
      activePlace: null, savedPlaces: [], unit: "fahrenheit", theme: "auto", timeFormat: "auto",
      reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false, forecast: { time: "fixture" }, forecastUnit: "fahrenheit"
    },
    glanceData: { old: { temp: 80 } }, editingSavedPlaceId: null,
    PLACE_WATCH_MAX_SYNC_PLACES: 3, PLACE_WATCH_NOTIFICATION_PLACES_KEY: "nearcast-place-watch-notification-places-v1",
    TIME_FORMAT_KEY: "nearcast-time-format",
    renderSavedPlaces() { counts.renders++; }, updateMode() {}, updateUnitButton() {},
    syncPlanWatchNotificationSubscription() { counts.sync++; },
    renderForecast() { counts.renders++; }, convertForecastUnits(data, from, to) { return { ...data, converted: to }; },
    applyTheme() {}, sanitizeTimeFormatPreference(value) { return ["12", "24"].includes(value) ? value : "auto"; },
    updateTimeFormatButtons() {}, refreshTimeFormattedSurfaces() {},
    parseLocationQuery(query) { return { raw: query }; }, buildPlaceSearchAttempts(parsed) { return [{ name: parsed.raw }]; },
    async fetchPlaceResults() { return [place(12345, { name: "Berlin", country: "Germany", countryCode: "DE", admin1: "Berlin", timezone: "Europe/Berlin" })]; },
    rankPlaceResults(results) { return results; },
    toggleAppMenu(open) { if (open) counts.menu++; },
    persistDeviceLocation(coords) { return coords; },
    async reverseGeocodePlace(coords, fallback) { return { ...fallback, name: "Current town", timezone: "America/Chicago" }; },
    navigator: { geolocation: { getCurrentPosition(success) { counts.locations++; success({ coords: { latitude: 38.73, longitude: -89.96 } }); } } },
    nativePreviewForecastMatches(value) {
      return !loadFailure && sandbox.state.forecast && sandbox.state.activePlace?.id === value.id &&
        sandbox.state.activePlace.latitude === value.latitude && sandbox.state.activePlace.longitude === value.longitude;
    },
    async loadPlace(value) {
      counts.loads++;
      if (loadFailure) return;
      sandbox.state.activePlace = sandbox.normalizePlace(value);
      // Match production loadPlace's best-effort persisted selected place.
      try { storage.setItem("weather-last-place", JSON.stringify(sandbox.state.activePlace)); } catch {}
    }
  };
  vm.createContext(sandbox);
  for (const name of ["normalizePlace", "canonicalPlaceName", "normalizedPlaceAlias", "placeCountryCode", "normalizeQualifierKey", "slug", "readStorageJson", "savePlace", "removeSavedPlace", "renameSavedPlace", "moveSavedPlace", "setUnitPreference", "setThemePreference", "setTimeFormatPreference", "placeFromCoordinates"]) {
    vm.runInContext(functionSource(app, name), sandbox);
  }
  for (const name of ["readPlaceWatchNotificationPlaces", "writePlaceWatchNotificationPlaces", "cleanPlaceWatchSelectedIds", "placeWatchSavedPlaces", "placeWatchSavedPlaceIdSet", "defaultPlaceWatchSelectedIds", "placeWatchNotificationSelectedIds", "prunePlaceWatchNotificationPlaces"]) {
    vm.runInContext(functionSource(planner, name), sandbox);
  }
  sandbox.state.savedPlaces = records.map((record) => sandbox.normalizePlace(record));
  sandbox.state.activePlace = records[0] ? sandbox.normalizePlace(records[0]) : null;
  vm.runInContext(exporter, sandbox);
  vm.runInContext(controls, sandbox);
  const api = sandbox.window.NearcastPlacesControls;
  const source = () => plain(sandbox.window.NearcastPlacesMigrationExport.build({ state: sandbox.state, storage, inventoryReady: true, now: new Date() }));
  const command = (action, data = {}) => ({ version: 1, requestID: randomUUID(), action, ...(["snapshot", "search"].includes(action) ? {} : { expectedSource: source() }), ...data });
  const perform = async (action, data = {}) => plain(await api.perform(command(action, data)));
  return { sandbox, stored, storage, counts, failures, api, source, command, perform,
    expireTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); },
    timerCount: () => timers.size,
    failLoad: () => { loadFailure = true; } };
}

const base = fixture();
assert.equal(base.api.version, 1);
let result = await base.perform("snapshot");
assert.equal(result.ok, true);
assert.equal(result.source.owner, "legacy");
assert.equal(result.source.savedPlaces[0].legacyIDType, "number");
assert.equal(result.source.savedPlaces[0].timezone, "America/Chicago");
assert.equal(base.counts.sync, 0);

for (const disabled of ["old-host", "unready"]) {
  const f = fixture();
  if (disabled === "old-host") delete f.sandbox.window.NearcastNative.preview.controlsVersion;
  else f.sandbox.nativePlacesMigrationInventoryReady = false;
  result = await f.perform("snapshot");
  assert.equal(result.ok, false);
  assert.equal(result.code, "unavailable");
  assert.equal(result.source, undefined, "Unknown inventory is never projected as empty");
  assert.equal(f.counts.sync, 0);
}

for (const changes of [
  { action: "erase" }, { requestID: "bad" }, { mystery: true },
  { action: "preferences", preferences: { theme: "rainbow" } },
  { action: "preferences", preferences: { reactiveSkyMotionAllowed: true } },
  { action: "move", id: "family", direction: 0 },
  { action: "rename", id: "family", alias: "\u0000private" },
  { action: "select", place: { ...base.source().savedPlaces[0], latitude: "38" } },
  { action: "select", place: { ...base.source().savedPlaces[0], legacyIDType: "number", id: "04243918" } }
]) {
  result = plain(await base.api.perform(base.command("rename", { id: "family", alias: "Family", ...changes })));
  assert.equal(result.ok, false, JSON.stringify(changes));
  assert.equal(result.code, "invalid");
}

const searched = await base.perform("search", { query: "Berlin, Germany" });
assert.equal(searched.ok, true);
assert.equal(searched.results[0].legacyIDType, "number");
assert.equal(searched.results[0].timezone, "Europe/Berlin");
assert.equal(base.counts.loads, 0, "Search does not select");
const stalledSearch = fixture(undefined, { fakeTimers: true });
let finishSearch;
let searchAttempts = 0;
stalledSearch.sandbox.buildPlaceSearchAttempts = () => [{ name: "primary" }, { name: "fallback" }];
stalledSearch.sandbox.fetchPlaceResults = () => {
  searchAttempts++;
  return new Promise((resolve) => { finishSearch = resolve; });
};
const stalledRequest = stalledSearch.command("search", { query: "Berlin" });
const pendingSearch = stalledSearch.api.perform(stalledRequest);
await Promise.resolve();
assert.equal(stalledSearch.timerCount(), 1);
const editAfterSearch = stalledSearch.api.perform(stalledSearch.command("rename", { id: "family", alias: "Queue recovered" }));
stalledSearch.expireTimers();
const timeoutReply = plain(await pendingSearch);
assert.equal(timeoutReply.ok, false);
assert.equal(timeoutReply.code, "search");
assert.equal((await editAfterSearch).ok, true, "Timed-out search releases the edit queue");
const afterEdit = stalledSearch.source();
finishSearch([]);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(searchAttempts, 1, "Late response does not start a fallback search");
assert.equal(stalledSearch.source().savedPlaces[1].alias, "Queue recovered");
assert.equal(stalledSearch.timerCount(), 0);
assert.deepEqual(plain(await stalledSearch.api.perform(stalledRequest)), timeoutReply, "Late response cannot replace timeout receipt");
assert.deepEqual(stalledSearch.source().savedPlaces, afterEdit.savedPlaces);
const rejectedSearch = fixture(undefined, { fakeTimers: true });
let rejectLateSearch;
rejectedSearch.sandbox.fetchPlaceResults = () => new Promise((resolve, reject) => { rejectLateSearch = reject; });
const rejectedPending = rejectedSearch.perform("search", { query: "Berlin" });
await Promise.resolve();
rejectedSearch.expireTimers();
assert.equal((await rejectedPending).code, "search");
rejectLateSearch(new Error("PRIVATE late provider error"));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(rejectedSearch.timerCount(), 0, "Late rejection is observed without leaking a timer or unhandled promise");

result = await base.perform("rename", { id: "4243918", alias: "Our home 👨‍👩‍👧" });
assert.equal(result.ok, true);
assert.equal(result.source.savedPlaces[0].alias, "Our home 👨‍👩‍👧");
assert.equal(result.source.selectedPlace.alias, result.source.lastPlace.alias);
assert.equal(JSON.parse(base.stored.get("weather-places"))[0].id, 4243918);
assert.equal(JSON.parse(base.stored.get("weather-last-place")).timezone, "America/Chicago");
result = await base.perform("rename", { id: "4243918", alias: "" });
assert.equal(result.ok, true, "Clearing alias is allowed");

const stale = base.command("remove", { id: "family" });
await base.perform("rename", { id: "family", alias: "Changed in web" });
result = plain(await base.api.perform(stale));
assert.equal(result.code, "stale");
assert.equal(result.source.savedPlaces[1].alias, "Changed in web");
assert.equal(result.source.savedPlaces.length, 2);

const watching = fixture([place("one"), place("two"), place("three"), place("four")], { watch: { enabled: true } });
result = await watching.perform("save", { place: searched.results[0] });
assert.equal(result.ok, true);
assert.deepEqual(JSON.parse(watching.stored.get("nearcast-place-watch-notification-places-v1")).selectedIds, ["one", "two", "three"]);
assert.equal(result.source.savedPlaces[0].followsCurrentLocation, false);
assert.equal(watching.counts.sync, 1, "Only existing save path synchronizes");
result = await watching.perform("move", { id: "four", direction: -1 });
assert.equal(result.ok, true);
assert.deepEqual(result.source.savedPlaces.map((record) => record.id), ["12345", "one", "two", "four", "three"]);
assert.deepEqual(JSON.parse(watching.stored.get("nearcast-place-watch-notification-places-v1")).selectedIds, ["one", "two", "three"]);
result = await watching.perform("remove", { id: "two" });
assert.equal(result.ok, true);
assert.deepEqual(JSON.parse(watching.stored.get("nearcast-place-watch-notification-places-v1")).selectedIds, ["one", "three"]);
assert.equal(watching.counts.sync, 2);

for (const watch of [{ enabled: false, selectedIds: ["family"] }, { enabled: true, selectedIds: [] }]) {
  const f = fixture(undefined, { watch });
  const old = f.stored.get("nearcast-place-watch-notification-places-v1");
  await f.perform("save", { place: searched.results[0] });
  assert.equal(f.stored.get("nearcast-place-watch-notification-places-v1"), old, "Explicit opt-out/empty intent stays unchanged");
}
const freezeFailure = fixture(undefined, { watch: { enabled: true } });
freezeFailure.failures.add("nearcast-place-watch-notification-places-v1");
result = await freezeFailure.perform("save", { place: searched.results[0] });
assert.equal(result.ok, false);
assert.equal(result.code, "storage");
assert.equal(result.source.savedPlaces.length, 2);
assert.equal(freezeFailure.counts.sync, 0);
const malformedWatch = fixture();
malformedWatch.stored.set("nearcast-place-watch-notification-places-v1", "{broken");
result = await malformedWatch.perform("remove", { id: "family" });
assert.equal(result.code, "storage");
assert.equal(result.source.savedPlaces.length, 2);
assert.equal(malformedWatch.counts.sync, 0, "Unknown watch intent cannot be treated as disabled");
const explicitPruneFailure = fixture(undefined, { watch: { enabled: true, selectedIds: ["family"] } });
explicitPruneFailure.failures.add("nearcast-place-watch-notification-places-v1");
result = await explicitPruneFailure.perform("remove", { id: "family" });
assert.equal(result.code, "storage");
assert.equal(result.source.savedPlaces.length, 2, "A failed stop-watch persistence blocks deletion");
assert.equal(explicitPruneFailure.counts.sync, 0);
assert.deepEqual(JSON.parse(explicitPruneFailure.stored.get("nearcast-place-watch-notification-places-v1")).selectedIds, ["family"]);
const partialRemoval = fixture(undefined, { watch: { enabled: true, selectedIds: ["family"] } });
partialRemoval.failures.add("weather-places");
result = await partialRemoval.perform("remove", { id: "family" });
assert.equal(result.code, "storage");
assert.equal(result.source.savedPlaces.length, 2, "Saved-place failure preserves the place");
assert.deepEqual(JSON.parse(partialRemoval.stored.get("nearcast-place-watch-notification-places-v1")).selectedIds, [], "Confirmed stop-watch intent survives a later place-write failure");
assert.match(result.message, /may have been saved/);
assert.equal(partialRemoval.counts.sync, 0);

const full = fixture(Array.from({ length: 8 }, (_, index) => place(`record-${index}`)));
result = await full.perform("save", { place: searched.results[0] });
assert.equal(result.code, "limit");
assert.equal(result.source.savedPlaces.length, 8);
assert.equal(result.source.savedPlaces[7].id, "record-7", "No ninth-place eviction");
const duplicate = await full.perform("save", { place: full.source().savedPlaces[0] });
// Historical saved records can omit the explicit fixed flag; duplicate saves
// are intentionally idempotent rather than rewriting those records.
assert.equal(duplicate.source.savedPlaces.length, 8);
assert.equal(duplicate.ok, true);

const replay = fixture();
const request = replay.command("remove", { id: "family" });
const [first, second] = await Promise.all([replay.api.perform(request), replay.api.perform(request)]);
assert.deepEqual(plain(first), plain(second));
assert.equal(first.ok, true);
assert.equal(replay.counts.sync, 1, "Repeated request IDs do not repeat edits/publication");
assert.equal((await replay.api.perform({ ...request, id: "4243918" })).code, "invalid");
const queued = fixture();
const queuedRename = queued.command("rename", { id: "family", alias: "Renamed" });
const queuedRemoval = queued.command("remove", { id: "family" });
const queuedReplies = await Promise.all([queued.api.perform(queuedRename), queued.api.perform(queuedRemoval)]);
assert.equal(queuedReplies[0].ok, true);
assert.equal(queuedReplies[1].code, "stale", "Queued writes recheck the source after previous completion");
assert.equal(queued.source().savedPlaces.length, 2);

const persistFailure = fixture();
persistFailure.failures.add("weather-places");
const failedRequest = persistFailure.command("remove", { id: "family" });
result = plain(await persistFailure.api.perform(failedRequest));
assert.equal(result.ok, false);
assert.equal(result.code, "storage");
assert.match(result.message, /may have been saved/);
assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
assert.equal(result.source.savedPlaces.length, 2);
persistFailure.failures.clear();
assert.equal((await persistFailure.api.perform(failedRequest)).ok, false, "Uncertain failures are not replayed");
assert.equal(persistFailure.source().savedPlaces.length, 2);

const prefs = fixture();
result = await prefs.perform("preferences", { preferences: { unit: "celsius", timeFormat: "24", theme: "dark" } });
assert.equal(result.ok, true);
assert.equal(result.source.preferences.unit, "celsius");
assert.equal(result.source.preferences.timeFormat, "24");
assert.equal(result.source.preferences.theme, "dark");
assert.deepEqual(Object.keys(prefs.sandbox.glanceData), []);
assert.equal(prefs.counts.sync, 0, "Adapter never adds a notification sync for settings");
result = await prefs.perform("preferences", { preferences: { timeFormat: "auto", theme: "auto" } });
assert.equal(result.ok, true);
assert.equal(result.source.preferences.timeFormat, "auto");
assert.equal(result.source.preferences.theme, "auto");
prefs.failures.add("weather-theme");
result = await prefs.perform("preferences", { preferences: { unit: "fahrenheit", theme: "light" } });
assert.equal(result.ok, false);
assert.equal(result.source.preferences.unit, "fahrenheit", "Partial success receipt reflects actual persisted change");
assert.equal(result.source.preferences.theme, "auto");

const selected = fixture();
result = await selected.perform("select", { id: "family" });
assert.equal(result.ok, true);
assert.equal(result.source.selectedPlace.id, "family");
assert.equal(result.source.lastPlace.id, "family");
selected.failLoad();
result = await selected.perform("select", { id: "4243918" });
assert.equal(result.ok, false);
assert.equal(result.code, "forecast");
assert.equal(result.source.selectedPlace.id, "family");

const selectedPersistFailure = fixture();
selectedPersistFailure.failures.add("weather-last-place");
result = await selectedPersistFailure.perform("select", { id: "family" });
assert.equal(result.ok, false, "Best-effort selection persistence is not a verified commit");
assert.equal(result.code, "storage");

const location = fixture();
assert.equal(location.counts.locations, 0);
result = await location.perform("currentLocation");
assert.equal(result.ok, true);
assert.equal(result.source.selectedPlace.followsCurrentLocation, true);
assert.equal(location.counts.locations, 1);
location.sandbox.navigator.geolocation.getCurrentPosition = (success, failure) => { location.counts.locations++; failure(); };
result = await location.perform("currentLocation");
assert.equal(result.ok, false);
assert.equal(result.code, "location");
assert.equal(location.counts.loads, 1, "Denied lookup does not select stale cached coordinates");
assert.equal(location.api.openExistingSettings(), true);
assert.equal(location.counts.menu, 1);
const locationRace = fixture();
locationRace.sandbox.reverseGeocodePlace = async (coords, fallback) => {
  locationRace.sandbox.renameSavedPlace("family", "Changed while locating");
  return fallback;
};
result = await locationRace.perform("currentLocation");
assert.equal(result.code, "stale");
assert.equal(locationRace.counts.loads, 0, "A delayed GPS lookup cannot overwrite a changed source");

function staleDetailsFixture() {
  const f = fixture(undefined, { fakeTimers: true });
  const element = () => ({ hidden: false, classList: { remove() {} }, setAttribute() {} });
  const nodes = { dayDetail: element(), dayDetailBackdrop: element(), alertSheet: element() };
  f.sandbox.document = { getElementById: (id) => nodes[id] ?? null, body: { style: {} } };
  f.sandbox.els = {
    glanceDetailSheet: element(), forecastReceiptSheet: element(), placeSheet: element(),
    memoryDetailSheet: element(), memorySheet: element(), aiSheet: element(), memoryEditSheet: { hidden: true }
  };
  f.sandbox.dayDetailNavState = { placeKey: "Maryville", data: { temperature: 96, unit: "fahrenheit" } };
  f.sandbox.dayDetailMapSuspension = { place: "Maryville" };
  f.sandbox.plannerReturnAfterDayDetail = { type: "planner" };
  f.sandbox.mapState = { immersive: true };
  const draft = { title: "Unsaved family outing" };
  f.sandbox.memoryEditState = draft;
  f.sandbox.askDraft = "Keep my typed question";
  f.sandbox.resetHourlyDetailDockVisibility = () => {};
  f.sandbox.syncAppDockCurrent = () => {};
  f.sandbox.restorePlanDayDetailTarget = () => { throw new Error("Old planner surface must not be reopened"); };
  f.sandbox.exitImmersiveMap = () => {
    assert.equal(f.sandbox.dayDetailNavState, null, "Old hourly context is cleared before map exit can restore it");
    f.sandbox.mapState.immersive = false;
  };
  for (const [name, field] of Object.entries({
    closeGlanceDetail: "glanceDetailSheet", closeForecastReceipt: "forecastReceiptSheet", closePlaceSheet: "placeSheet",
    closeMemoryDetail: "memoryDetailSheet", closeGlobalMemorySheet: "memorySheet", closeAISheet: "aiSheet"
  })) f.sandbox[name] = () => { f.sandbox.els[field].hidden = true; };
  f.sandbox.closeMemoryEditSheet = () => { throw new Error("Never discard an unsaved plan editor"); };
  f.sandbox.closeAlertSheet = () => { nodes.alertSheet.hidden = true; };
  f.sandbox.toggleSearch = () => {};
  f.sandbox.scrollForecastToTop = () => {};
  // Execute the real day-sheet cleanup, including its delayed planner return.
  vm.runInContext(functionSource(dayGraph, "closeDayDetail"), f.sandbox);
  return { ...f, nodes, draft };
}
const staleUnit = staleDetailsFixture();
let clockRefreshes = 0;
staleUnit.sandbox.refreshTimeFormattedSurfaces = () => {
  clockRefreshes++;
  assert.equal(staleUnit.sandbox.dayDetailNavState, null, "Clock refresh cannot relabel stale Fahrenheit hourly data as Celsius");
};
result = await staleUnit.perform("preferences", { preferences: { unit: "celsius", timeFormat: "24" } });
assert.equal(result.ok, true);
assert.equal(clockRefreshes, 1);
assert.equal(staleUnit.sandbox.plannerReturnAfterDayDetail, null);
staleUnit.expireTimers();
assert.equal(staleUnit.nodes.dayDetail.hidden, true);
assert.equal(staleUnit.sandbox.memoryEditState, staleUnit.draft, "Weather reconciliation preserves unsaved plan state");

for (const action of ["select", "currentLocation"]) {
  const f = staleDetailsFixture();
  result = await f.perform(action, action === "select" ? { id: "family" } : {});
  assert.equal(result.ok, true);
  assert.equal(f.sandbox.dayDetailNavState, null, `${action} invalidates the old hourly evidence`);
  assert.equal(f.sandbox.memoryEditState, f.draft);
}
const settingsFallback = staleDetailsFixture();
assert.equal(settingsFallback.api.openExistingSettings(), true);
assert.equal(settingsFallback.counts.menu, 1);
assert.equal(settingsFallback.sandbox.dayDetailNavState, null);
assert.equal(settingsFallback.sandbox.els.aiSheet.hidden, true);
assert.equal(settingsFallback.sandbox.askDraft, "Keep my typed question");
assert.equal(settingsFallback.sandbox.memoryEditState, settingsFallback.draft);
const activeDraft = staleDetailsFixture();
activeDraft.sandbox.els.memoryEditSheet.hidden = false;
assert.equal(activeDraft.api.openExistingSettings(), false, "A visible plan edit requires deliberate completion/cancellation");
assert.equal(activeDraft.sandbox.memoryEditState, activeDraft.draft);
assert.equal(activeDraft.sandbox.els.memoryEditSheet.hidden, false);
assert.equal(activeDraft.counts.menu, 0);

console.log("PASS native places controls: verified legacy write-through, capabilities/hydration, stale/deduplicated commands, stable numeric IDs/timezones, watch intent, capacity, partial persistence, preferences, selection and explicit location");
