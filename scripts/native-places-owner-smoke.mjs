import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const [adapter, exporter, app, planner, boot] = await Promise.all(["native-places-owner.js", "native-places-migration.js", "app.js", "planner.js", "boot.js"].map((name) => readFile(new URL(name, root), "utf8")));
const plain = (value) => JSON.parse(JSON.stringify(value));
const WATCH = "nearcast-place-watch-notification-places-v1";
const DIRTY = "nearcast-plan-watch-sync-generation-v1";
function extract(source, name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
  assert.ok(match, `${name} exists`);
  return match[0];
}
const place = (id, changes = {}) => ({ id, name: `Town ${id}`, admin1: "Kentucky", country: "United States", countryCode: "US", latitude: 36.7, longitude: -88.3, timezone: "America/Chicago", ...changes });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ status = "owned", watch = { enabled: true, selectedIds: ["one", "two"], nativeDeletionWatermark: 0 }, delayedACK = false } = {}) {
  const listeners = new Map();
  const stored = new Map([["weather-places", JSON.stringify([place("one"), place("two")])], ["weather-last-place", JSON.stringify(place("one"))]]);
  if (watch !== null) stored.set(WATCH, typeof watch === "string" ? watch : JSON.stringify(watch));
  const failures = new Set();
  const counts = { performed: 0, acknowledged: 0, projections: 0, synced: 0, writes: 0 };
  let releaseACK;
  let known = true;
  const host = { version: 1, status, snapshot: null, compatibleReady: false };
  const sandbox = {
    TextEncoder, Intl, Date, crypto: { randomUUID }, setTimeout, clearTimeout,
    window: { NearcastNative: { placesOwner: host }, addEventListener(name, callback) { const values = listeners.get(name) || []; values.push(callback); listeners.set(name, values); } },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { if (failures.has(key)) throw new Error("private storage error"); stored.set(key, String(value)); counts.writes++; },
      removeItem(key) { stored.delete(key); }
    },
    state: { unit: "fahrenheit", theme: "auto", timeFormat: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false,
      activePlace: place("one"), savedPlaces: [place("one"), place("two")], planMemories: [] },
    nativePlacesMigrationInventoryReady: true,
    PLAN_WATCH_SYNC_GENERATION_KEY: DIRTY,
    planWatchInventoryIsKnown() { return known; },
    syncPlanWatchNotificationSubscription() { counts.synced++; return Promise.resolve({ ok: true }); },
    applyNativePlacesOwnerSource(source) {
      counts.projections++;
      sandbox.state.activePlace = sandbox.window.NearcastNativePlacesOwner.legacyPlace(source.selectedPlace);
      sandbox.state.savedPlaces = source.savedPlaces.map(sandbox.window.NearcastNativePlacesOwner.legacyPlace);
      Object.assign(sandbox.state, source.preferences);
    }
  };
  vm.createContext(sandbox);
  for (const name of ["planWatchSyncGeneration", "persistPlanWatchSyncGeneration", "markPlanWatchSyncDirty"]) vm.runInContext(extract(planner, name), sandbox);
  vm.runInContext(exporter, sandbox);
  const initial = sandbox.window.NearcastPlacesMigrationExport.build({ state: sandbox.state, storage: sandbox.localStorage, inventoryReady: true, now: new Date() });
  host.snapshot = { version: 1, revision: 1, source: { ...plain(initial), owner: "native" }, pendingDeletions: [], deletionWatermark: 0 };
  function fire(name = "nearcast:native-places-owner") { for (const listener of listeners.get(name) || []) listener({ detail: { status: host.status, snapshot: host.snapshot } }); }
  function advance() {
    host.snapshot.revision++;
    host.snapshot.source.capturedAt = new Date(Date.parse(host.snapshot.source.capturedAt) + 1).toISOString();
    host.compatibleReady = false;
  }
  host.perform = async (command) => {
    counts.performed++;
    assert.equal(command.version, 1);
    if (command.action !== "snapshot") assert.deepEqual(plain(command.expectedSource), plain(host.snapshot.source), "Writes use the current verified owner source");
    const source = host.snapshot.source;
    if (command.action === "preferences") Object.assign(source.preferences, command.preferences);
    if (command.action === "select") source.selectedPlace = source.lastPlace = plain(command.place);
    if (command.action === "save") source.savedPlaces.unshift({ ...plain(command.place), followsCurrentLocation: false });
    if (command.action === "remove") {
      source.savedPlaces = source.savedPlaces.filter((entry) => entry.id !== command.id);
      const sequence = (host.snapshot.pendingDeletions.at(-1)?.sequence ?? host.snapshot.deletionWatermark) + 1;
      host.snapshot.pendingDeletions.push({ sequence, id: command.id });
    }
    if (command.action !== "snapshot") advance();
    const reply = { version: 1, requestID: command.requestID, ok: true, source: plain(source) };
    fire();
    return reply;
  };
  host.acknowledgeDeletions = async (through) => {
    counts.acknowledged++;
    const persisted = JSON.parse(stored.get(WATCH));
    assert.ok(persisted.nativeDeletionWatermark >= through, "Watch watermark is durable before native ACK");
    assert.ok(JSON.parse(stored.get(DIRTY)).generation > 0, "Server cleanup is durably dirty before native ACK");
    if (delayedACK) await new Promise((resolve) => { releaseACK = resolve; });
    host.snapshot.pendingDeletions = host.snapshot.pendingDeletions.filter((item) => item.sequence > through);
    host.snapshot.deletionWatermark = through;
    advance(); // Exercise hosts that advance metadata capture during ACK.
    fire();
    return plain(host.snapshot);
  };
  vm.runInContext(adapter, sandbox);
  const api = sandbox.window.NearcastNativePlacesOwner;
  return { sandbox, stored, failures, counts, host, api, fire, advance, releaseACK: () => releaseACK?.(), setKnown: (value) => { known = value; },
    async boot() { api.bootstrap(); await api.finishInitialization(); await flush(); } };
}

const cold = fixture();
await cold.boot();
assert.equal(cold.host.compatibleReady, true);
assert.equal(cold.counts.performed, 0, "Owned bootstrap does not write/auto-select or enter a loop");
assert.equal(cold.counts.projections, 1);
await cold.api.mutate("preferences", { preferences: { unit: "celsius" } });
assert.equal(cold.sandbox.state.unit, "celsius");
assert.equal(cold.counts.performed, 1);

const legacy = fixture({ status: "unmigrated", watch: { enabled: true } });
await legacy.boot();
assert.equal(legacy.api.managed(), false);
assert.equal(legacy.counts.performed, 0, "No activation happens automatically");
const activation = await legacy.api.prepareActivation();
assert.equal(activation.owner, "legacy");
assert.deepEqual(JSON.parse(legacy.stored.get(WATCH)).selectedIds, ["one", "two"], "Implicit historical selection is frozen before cutover");
assert.equal(legacy.api.managed(), true, "Legacy mutations are frozen during activation handoff");
await assert.rejects(legacy.api.mutate("preferences", { preferences: { theme: "dark" } }));
await legacy.api.finishActivation();
assert.equal(legacy.api.managed(), false, "A failed/unmigrated activation releases its mutation freeze");

const oldHost = fixture({ status: "unmigrated" });
delete oldHost.sandbox.window.NearcastNative.placesOwner;
await oldHost.boot();
assert.equal(oldHost.api.managed(), false, "An old host keeps the existing web behavior");
await assert.rejects(oldHost.api.prepareActivation());

for (const watch of ["{broken", { enabled: true, selectedIds: "one" }]) {
  const bad = fixture({ status: "unmigrated", watch });
  await bad.boot();
  await assert.rejects(bad.api.prepareActivation());
  assert.equal(bad.api.managed(), false);
  assert.equal(bad.counts.performed, 0);
}
const invalidInventory = fixture({ status: "unmigrated", watch: { enabled: true } });
await invalidInventory.boot();
invalidInventory.stored.set("weather-places", "{broken");
const unmodifiedWatch = invalidInventory.stored.get(WATCH);
const writesBeforePreflight = invalidInventory.counts.writes;
await assert.rejects(invalidInventory.api.prepareActivation());
assert.equal(invalidInventory.stored.get(WATCH), unmodifiedWatch, "Corrupt legacy places must not change even preparatory watch intent");
assert.equal(invalidInventory.counts.writes, writesBeforePreflight);
assert.equal(invalidInventory.api.managed(), false);
const unknown = fixture();
unknown.setKnown(false);
await unknown.boot();
assert.equal(unknown.host.compatibleReady, false, "Unknown plans/permission inventory cannot register or unregister");
unknown.setKnown(true);
unknown.fire("nearcast:native-notification-status");
await flush();
assert.equal(unknown.host.compatibleReady, true);

const delayed = fixture({ delayedACK: true });
await delayed.boot();
const removing = delayed.api.mutate("remove", { id: "one" });
await flush();
assert.equal(delayed.host.compatibleReady, false, "Delayed ACK keeps all notification publication fenced");
assert.deepEqual(JSON.parse(delayed.stored.get(WATCH)).selectedIds, ["two"]);
assert.equal(JSON.parse(delayed.stored.get(WATCH)).nativeDeletionWatermark, 1);
delayed.releaseACK();
const removed = await removing;
assert.equal(removed.savedPlaces.length, 1, "ACK-only metadata advancement does not falsely reject a successful remove");
assert.equal(delayed.counts.acknowledged, 1);
await delayed.api.mutate("save", { place: delayed.api.exportPlace(place("one")) });
assert.deepEqual(JSON.parse(delayed.stored.get(WATCH)).selectedIds, ["two"], "Remove/re-add does not silently rewatch");

const offline = fixture();
offline.host.snapshot.pendingDeletions = [{ sequence: 1, id: "one" }];
// The place has already been re-added natively while the legacy web view slept.
await offline.boot();
assert.deepEqual(JSON.parse(offline.stored.get(WATCH)).selectedIds, ["two"]);
assert.equal(offline.host.snapshot.pendingDeletions.length, 0);

const spacedID = fixture();
spacedID.host.snapshot.source.savedPlaces[0].id = " one ";
spacedID.host.snapshot.pendingDeletions = [{ sequence: 1, id: " one " }];
await spacedID.boot();
assert.deepEqual(JSON.parse(spacedID.stored.get(WATCH)).selectedIds, ["two"], "Deletion uses the legacy trimmed watch identity without changing native IDs");
assert.equal(spacedID.sandbox.state.savedPlaces[0].id, " one ");

const advancedDuringACK = fixture();
advancedDuringACK.host.snapshot.pendingDeletions = [{ sequence: 1, id: "one" }];
const projectedUnits = [];
const originalProject = advancedDuringACK.sandbox.applyNativePlacesOwnerSource;
advancedDuringACK.sandbox.applyNativePlacesOwnerSource = (source) => { projectedUnits.push(source.preferences.unit); originalProject(source); };
advancedDuringACK.host.acknowledgeDeletions = async (through) => {
  advancedDuringACK.host.snapshot.pendingDeletions = [];
  advancedDuringACK.host.snapshot.deletionWatermark = through;
  advancedDuringACK.advance();
  const delayedReply = plain(advancedDuringACK.host.snapshot);
  advancedDuringACK.host.snapshot.source.preferences.unit = "celsius";
  advancedDuringACK.advance();
  advancedDuringACK.fire();
  return delayedReply;
};
await advancedDuringACK.boot();
assert.deepEqual(projectedUnits, ["fahrenheit", "celsius"], "A delayed ACK never projects a stale generation over a newer host edit");
assert.equal(advancedDuringACK.host.compatibleReady, true);

const failed = fixture();
failed.host.snapshot.pendingDeletions = [{ sequence: 1, id: "one" }];
failed.failures.add(WATCH);
failed.api.bootstrap();
await assert.rejects(failed.api.finishInitialization());
assert.equal(failed.counts.acknowledged, 0, "Failed persistence never consumes a deletion event");
assert.equal(failed.host.compatibleReady, false);

const futureWatermark = fixture({ watch: { enabled: true, selectedIds: ["one"], nativeDeletionWatermark: 50 } });
futureWatermark.host.snapshot.pendingDeletions = [{ sequence: 1, id: "one" }];
futureWatermark.api.bootstrap();
await assert.rejects(futureWatermark.api.finishInitialization());
assert.equal(futureWatermark.counts.acknowledged, 0, "A future local watermark cannot skip native deletion cleanup");
assert.equal(futureWatermark.host.compatibleReady, false);

const malformed = fixture();
malformed.host.snapshot.source.savedPlaces[0].latitude = 999;
assert.throws(() => malformed.api.bootstrap());
assert.equal(malformed.host.compatibleReady, false);
assert.equal(malformed.counts.projections, 0, "Invalid snapshots never replace web state");

const widget = fixture();
await widget.boot();
const data = {};
Object.assign(widget.sandbox.state, { forecast: data, forecastUnit: "fahrenheit", forecastPlaceId: "one" });
assert.equal(widget.api.widgetRevision(widget.sandbox.state.activePlace, data), 1);
assert.equal(widget.api.widgetRevision(place("one", { latitude: 36.7001 }), data), null, "Even nearby coordinates are a different forecast identity");
assert.equal(widget.api.widgetRevision(widget.sandbox.state.activePlace, {}), null);
widget.sandbox.state.forecastUnit = "celsius";
assert.equal(widget.api.widgetRevision(widget.sandbox.state.activePlace, data), null, "Wrong-unit data cannot publish a current owner revision");
widget.sandbox.FORECAST_CACHE_VERSION = "test";
vm.runInContext(extract(app, "forecastCacheKey"), widget.sandbox);
const cacheKey = widget.sandbox.forecastCacheKey(place("one"));
assert.notEqual(cacheKey, widget.sandbox.forecastCacheKey(place("two")), "Native weather cache cannot borrow another place's identity");
assert.notEqual(cacheKey, widget.sandbox.forecastCacheKey(place("one", { latitude: 36.70001 })), "Native weather cache keeps exact coordinates");
assert.notEqual(cacheKey, widget.sandbox.forecastCacheKey(place("one", { followsCurrentLocation: true })), "Fixed/current-location cache intents remain distinct");

let confirmDocument;
const bootCounts = { initialized: 0, projected: 0, reconciled: 0 };
const bootContext = { navigator: {}, window: { NearcastNative: { placesOwner: { ready: new Promise((resolve) => { confirmDocument = resolve; }) } },
  NearcastNativePlacesOwner: { bootstrap() { bootCounts.projected++; }, finishInitialization() { bootCounts.reconciled++; } } },
  init() { bootCounts.initialized++; }, setStatus() { throw new Error("Unexpected boot failure"); } };
vm.createContext(bootContext);
vm.runInContext(boot, bootContext);
await flush();
assert.equal(bootCounts.initialized, 0, "Boot waits for the host to confirm the exact current document");
confirmDocument();
await flush();
assert.deepEqual(bootCounts, { initialized: 1, projected: 1, reconciled: 1 });

const failedSelection = { window: { NearcastNativePlacesOwner: { managed: () => true, matches: () => false,
  owned: () => true, exportPlace: (value) => value, mutate: async () => { throw new Error("verified write failed"); } } },
  state: { activePlace: place("one"), forecast: { original: true } }, fetchForecast() { throw new Error("Must not fetch before commit"); } };
vm.createContext(failedSelection);
vm.runInContext(extract(app, "loadPlace"), failedSelection);
await assert.rejects(failedSelection.loadPlace(place("two")));
assert.equal(failedSelection.state.activePlace.id, "one", "Failed selection commit leaves the previous canonical projection intact");
await assert.rejects(failedSelection.loadPlace(place("two"), true), /selected place changed/);

let releasePermission;
let permissionWrites = 0;
let permissionStatus = "";
let permissionPrefs = { enabled: true, hasExplicitSelection: true, selectedIds: ["one"], nativeDeletionWatermark: 0 };
const permissionOwner = { snapshot: { revision: 1 } };
const permissionContext = { window: { NearcastNative: { placesOwner: permissionOwner }, NearcastNativePlacesOwner: { managed: () => true } },
  planWatchSyncInventoryReady: () => true, planWatchNotificationsSupported: () => true,
  readPlaceWatchNotificationPlaces: () => plain(permissionPrefs), placeWatchNotificationsRequested: () => true,
  planWatchNotificationsEnabled: () => false, planWatchNotificationPermission: () => "default",
  requestPlanWatchNotificationPermission: () => new Promise((resolve) => { releasePermission = resolve; }),
  writePlanWatchNotificationPreference() { permissionWrites++; }, writePlaceWatchNotificationPlaces() { permissionWrites++; },
  setStatus(value) { permissionStatus = value; }
};
vm.createContext(permissionContext);
vm.runInContext(extract(planner, "requestPlaceWatchNotifications"), permissionContext);
const permissionPending = permissionContext.requestPlaceWatchNotifications();
permissionOwner.snapshot.revision = 2;
permissionPrefs = { enabled: true, hasExplicitSelection: true, selectedIds: [], nativeDeletionWatermark: 1 };
releasePermission({ permission: "granted" });
await permissionPending;
assert.equal(permissionWrites, 0, "A native delete/re-add while permission is open cannot restore pre-dialog watch choices");
assert.match(permissionStatus, /Places changed/);

// Exercise the production durable drain independently with a network call held
// open while an edit arrives. It must send both generations and retain failures.
const drainStored = new Map();
let sends = 0;
let releaseSend;
let failSend = false;
const drain = { PLAN_WATCH_SYNC_GENERATION_KEY: DIRTY, planWatchDrainPromise: null, setTimeout,
  localStorage: { getItem: (key) => drainStored.get(key) ?? null, setItem: (key, value) => drainStored.set(key, value) },
  planWatchSyncInventoryReady: () => true,
  async performPlanWatchNotificationSync() { sends++; if (sends === 1) await new Promise((resolve) => { releaseSend = resolve; }); return { ok: !failSend }; }
};
vm.createContext(drain);
for (const name of ["planWatchSyncGeneration", "persistPlanWatchSyncGeneration", "markPlanWatchSyncDirty", "syncPlanWatchNotificationSubscription"]) vm.runInContext(extract(planner, name), drain);
const first = drain.syncPlanWatchNotificationSubscription({ force: true });
await flush();
const second = drain.syncPlanWatchNotificationSubscription({ force: true });
releaseSend();
await Promise.all([first, second]);
assert.equal(sends, 2, "An edit during network I/O is drained with a new payload");
let generation = JSON.parse(drainStored.get(DIRTY));
assert.equal(generation.generation, generation.acknowledged);
failSend = true;
await drain.syncPlanWatchNotificationSubscription({ force: true });
generation = JSON.parse(drainStored.get(DIRTY));
assert.ok(generation.generation > generation.acknowledged, "Failed/offline cleanup remains durably pending");

assert.doesNotMatch(extract(planner, "executeNearcastSettingsUpdateSkill"), /localStorage\.setItem/);
assert.match(extract(planner, "executeNearcastPlaceSaveSkill"), /await savePlace/);
assert.match(extract(planner, "executeNearcastPlaceRemoveSkill"), /await removeSavedPlace/);
assert.match(extract(app, "loadPlace"), /await owner\.mutate\("select"/);
assert.match(extract(app, "loadPlace"), /!owner\?\.managed\(\) && previousPlace/);
assert.match(extract(app, "applyNativePlacesOwnerSource"), /loadPlaceRequestSeq \+= 1;[\s\S]*locationLookupSeq \+= 1;/);
assert.doesNotMatch(extract(planner, "ensurePlanWatchPushSubscription"), /native\.requestPermission\(/);
console.log("PASS native places owner: explicit frozen cutover, verified projection, ordered durable deletion ACK, no silent rewatch, old-host compatibility, exact widget identity, and in-flight notification drain");
