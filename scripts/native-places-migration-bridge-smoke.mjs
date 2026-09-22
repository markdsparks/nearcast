import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("app.js");
const exporter = read("native-places-migration.js");
const bridge = read("native/ios/NearcastApp/Bridge/NativeBridge.swift");
const model = read("native/ios/NearcastApp/Models/NearcastWebModel.swift");
const store = read("native/ios/NearcastApp/NativeWeather/NativePlacesMigrationStore.swift");
const diagnostics = read("native/ios/NearcastApp/Views/NativeDiagnosticsView.swift");
const contentView = read("native/ios/NearcastApp/Views/ContentView.swift");
const section = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `production section exists: ${from}`);
  return source.slice(start, end);
};
const appSource = section(app, "function nativePlacesMigrationSnapshotForPreview()", "\nfunction nativePreviewPlacesEqual(");
const injectedPreview = section(bridge, "window.NearcastNative.preview = {", "\n\n          window.dispatchEvent");
const plain = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const selected = {
  id: "test-home", name: "Maryville", admin1: "Illinois", country: "United States", countryCode: "US",
  latitude: 38.723, longitude: -89.956, followsCurrentLocation: false
};
const saved = {
  id: "test-away", name: "Hardin", admin1: "Kentucky", country: "United States", countryCode: "US",
  latitude: 36.762, longitude: -88.301, alias: "Test destination", timezone: "America/Chicago"
};
const storageKeys = ["weather-places", "weather-last-place", "weather-unit", "weather-theme", "nearcast-time-format", "nearcast-reactive-sky-v1", "nearcast-reactive-sky-motion-v1"];
const baselineContext = {
  version: 1,
  selectedPlace: { id: selected.id, name: "Maryville, Illinois", latitude: selected.latitude, longitude: selected.longitude, countryCode: "US", timezone: "America/Chicago" },
  savedPlaces: [{ id: saved.id, name: "Hardin, Kentucky", latitude: saved.latitude, longitude: saved.longitude, countryCode: "US", timezone: "America/Chicago" }],
  metric: true, uses24HourClock: true, theme: "dark"
};

function harness(options = {}) {
  const savedPlaces = options.empty ? [] : [{ ...saved }];
  const state = freeze({
    activePlace: { ...selected }, savedPlaces,
    forecastPlaceId: selected.id, forecast: { timezone: "America/Chicago" },
    unit: "celsius", timeFormat: "24", theme: "dark", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: true,
    planMemories: [{ text: "PRIVATE_PLAN_SENTINEL", id: "PRIVATE_PLAN_ID" }],
    watchedPlaces: [{ token: "PRIVATE_WATCH_TOKEN" }], subscription: "PRIVATE_SUBSCRIPTION"
  });
  const entries = new Map([
    ["weather-places", JSON.stringify(savedPlaces)], ["weather-last-place", JSON.stringify(selected)],
    ["weather-unit", "celsius"], ["weather-theme", "dark"], ["nearcast-time-format", "24"],
    ["nearcast-reactive-sky-v1", "0"], ["nearcast-reactive-sky-motion-v1", "1"],
    ["private-unrelated-key", "PRIVATE_UNRELATED_STORAGE"]
  ]);
  if (options.malformed) entries.set("weather-places", "[malformed]");
  if (options.inventoryMismatch) entries.set("weather-places", "[]");
  const calls = [];
  const reads = [];
  const prohibited = (name) => () => { throw new Error(`Forbidden side effect: ${name}`); };
  const storage = freeze({
    getItem(key) {
      reads.push(key);
      if (options.storageFailure) throw new Error("PRIVATE_STORAGE_ERROR");
      assert.ok(storageKeys.includes(key), "export never scans unrelated storage");
      return entries.get(key) ?? null;
    },
    setItem: prohibited("storage write"), removeItem: prohibited("storage delete"),
    clear: prohibited("storage clear"), key: prohibited("storage scan")
  });
  const sandbox = {
    state, window: {}, Intl, Date, TextEncoder, console: { log: prohibited("log"), warn: prohibited("warn"), error: prohibited("error") },
    nativePlacesMigrationInventoryReady: options.ready !== false,
    placeLabel: (place) => [place.name, place.admin1].filter(Boolean).join(", "),
    prefersTwentyFourHourClock: () => true,
    closeAppMenu: () => calls.push(["close-menu"]), setStatus: (...args) => calls.push(["status", ...args]),
    document: { getElementById: () => null },
    fetch: prohibited("network"), loadPlace: prohibited("place load"),
    syncPlanWatchNotificationSubscription: prohibited("notification sync"),
    publishNativeSnapshot: prohibited("snapshot publish"),
    navigator: { geolocation: { getCurrentPosition: prohibited("location permission") } },
    Notification: { requestPermission: prohibited("notification permission") }
  };
  Object.defineProperty(sandbox, "localStorage", { get() {
    if (options.storageGetterFailure) throw new Error("PRIVATE_STORAGE_GETTER_ERROR");
    return storage;
  } });
  vm.createContext(sandbox);
  vm.runInContext(exporter, sandbox, { filename: "native-places-migration.js" });
  if (options.exportVersion !== undefined) {
    sandbox.window.NearcastPlacesMigrationExport = { version: options.exportVersion, build: prohibited("incompatible exporter") };
  }
  if (options.missingExporter) delete sandbox.window.NearcastPlacesMigrationExport;
  if (options.throwingExporter) sandbox.window.NearcastPlacesMigrationExport = { version: 1, build() { throw new Error("PRIVATE_EXPORT_FAILURE"); } };
  sandbox.window.NearcastNative = { postMessage: (payload) => calls.push(["preview", plain(payload)]) };
  if (options.oldHost) {
    sandbox.window.NearcastNative.preview = {
      version: 1,
      open(context) { calls.push(["preview", { type: "preview.open", context: plain(context) }]); }
    };
  } else {
    vm.runInContext(injectedPreview, sandbox, { filename: "NativeBridge.swift: injected preview object" });
    if (options.migrationVersion !== undefined) sandbox.window.NearcastNative.preview.migrationVersion = options.migrationVersion;
    if (options.previewVersion !== undefined) sandbox.window.NearcastNative.preview.version = options.previewVersion;
  }
  vm.runInContext(appSource, sandbox, { filename: "app.js: actual preview + optional migration export" });
  const before = JSON.stringify(state);
  return {
    sandbox, calls, reads,
    run() {
      vm.runInContext("openNativeWeatherPreview()", sandbox);
      assert.equal(JSON.stringify(state), before, "opening preview/export leaves live user records unchanged");
      assert.deepEqual(calls.map(([kind]) => kind), ["preview", "close-menu"], "optional migration adds no navigation, permission, publisher or diagnostic calls");
      const payload = calls[0][1];
      assert.deepEqual(payload.context, options.empty ? { ...baselineContext, savedPlaces: [] } : baselineContext, "original version-1 preview context remains exactly unchanged");
      assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_/, "unrelated records, subscriptions and errors never cross this bridge");
      return payload;
    }
  };
}

for (const options of [{ oldHost: true }, { migrationVersion: 2 }, { migrationVersion: "1" }, { exportVersion: 2 }, { missingExporter: true }]) {
  const h = harness(options);
  const payload = h.run();
  assert.ok(payload.migration == null, "non-advertising/incompatible combinations keep normal preview without a migration copy");
  assert.deepEqual(h.reads, [], "non-advertising host or exporter never reads durable records");
}
const noCapabilityStorage = harness({ oldHost: true, storageGetterFailure: true });
noCapabilityStorage.run();
assert.deepEqual(noCapabilityStorage.reads, [], "old hosts never touch even the storage getter");

for (const options of [{ ready: false }, { malformed: true }, { inventoryMismatch: true }, { storageFailure: true }, { storageGetterFailure: true }, { throwingExporter: true }]) {
  const h = harness(options);
  const payload = h.run();
  assert.equal(payload.migration, null, "unready/unreadable/invalid export fails closed but never blocks ordinary weather preview");
  if (options.ready === false) assert.deepEqual(h.reads, [], "unhydrated inventory is not read or mistaken for empty");
}

for (const empty of [false, true]) {
  const h = harness({ empty });
  const payload = h.run();
  assert.deepEqual(h.reads, storageKeys, "compatible path reads only the fixed allowlisted keys");
  assert.deepEqual(Object.keys(payload).sort(), ["context", "migration", "type"]);
  assert.equal(payload.migration.owner, "legacy");
  assert.equal(payload.migration.hydration, "ready");
  assert.equal(payload.migration.version, 1);
  assert.equal(payload.migration.savedPlaces.length, empty ? 0 : 1, "verified empty inventory is distinct from missing export");
  assert.equal(payload.migration.selectedPlace.id, selected.id);
  assert.equal(payload.migration.selectedPlace.name, "Maryville", "rehearsal keeps structured city fields separately from preview labels");
  assert.deepEqual(payload.migration.preferences, {
    unit: "celsius", timeFormat: "24", theme: "dark", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: true
  });
  assert.match(payload.migration.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(payload.context, payload.migration, "migration remains a separate optional payload, not preview state");
}

const oldPage = harness();
oldPage.sandbox.window.NearcastNative.preview.open(baselineContext);
assert.deepEqual(oldPage.calls, [["preview", { type: "preview.open", context: baselineContext, migration: null }]], "new host accepts unchanged old-page open(context) calls");
assert.deepEqual(oldPage.reads, [], "native bootstrap does not generate an export on its own");
const unsupportedPreview = harness({ previewVersion: 2 });
vm.runInContext("openNativeWeatherPreview()", unsupportedPreview.sandbox);
assert.deepEqual(unsupportedPreview.calls, []);
assert.deepEqual(unsupportedPreview.reads, []);

// These Swift checks are explicit source guardrails, not claims of executed
// WebKit, filesystem, permission, or physical-device integration tests.
const receive = section(bridge, "func userContentController(", "\n    static func bootstrapScript");
assert.match(receive, /let type = payload\["type"\][\s\S]*type == "preview\.open"[\s\S]*recordBridgeMessage\(\["type": type\]\)/);
// Every bridge payload that can carry a saved-plan/place receipt must be
// reduced to its event type before diagnostics see it.  Keep this list
// explicit: a later export must not silently fall back to recording the
// whole message body just because the redaction assertion is too narrow.
assert.match(receive, /type == "widget\.snapshot" \|\| type == "agenda\.snapshot" \|\|[\s\S]*type == "plans\.handover\.snapshot" \|\| type\.hasPrefix\("placesOwner\."\)/);
const redactedBranch = receive.slice(receive.indexOf('== "preview.open"'), receive.indexOf("} else {"));
assert.doesNotMatch(redactedBranch, /recordBridgeMessage\((?:message\.body|payload)\)/, "preview context and migration are redacted before handling");
const handler = section(bridge, 'if type == "preview.open" {', '\n        if type.hasPrefix("ai.")');
assert.ok(handler.indexOf("guard isTrustedAmbientFrame") < handler.indexOf('payload["migration"]'));
assert.ok(handler.indexOf("applicationState == .active") < handler.indexOf('payload["migration"]'));
assert.match(handler, /openNativePreview\(data: data, migrationData: migration\)/);
const trust = section(bridge, "private func isTrustedAmbientFrame(", "\n    private static func sameOrigin(");
assert.match(trust, /guard isMainFrame/);
assert.match(trust, /scheme == "https" && host == "getnearcast\.app"/);
assert.match(bridge, /injectionTime: \.atDocumentStart, forMainFrameOnly: true/);
assert.doesNotMatch(handler, /recordBridgeMessage|requestCurrentLocation|requestNativeNotifications|saveWidgetSnapshot|startOrUpdateStormActivity/);

const openAndRehearse = section(model, "func openNativePreview(", "\n    /// Transitional write-through:");
assert.ok(openAndRehearse.indexOf("NativePreviewContext.decode(data)") < openAndRehearse.indexOf("rehearsePlacesMigration(migrationData"));
assert.ok(openAndRehearse.indexOf("showingNativePreview = true") < openAndRehearse.indexOf("rehearsePlacesMigration(migrationData"), "optional storage is not a prerequisite to show weather");
assert.match(openAndRehearse, /data\.count <= 128 \* 1_024/);
for (const key of ["id", "latitude", "longitude"]) assert.ok(openAndRehearse.includes(`selected["${key}"]`), "migration copy is bound to the preview-selected place");
assert.match(openAndRehearse, /revision == self\.placesMigrationRevision/);
assert.match(model, /mode == \.production \? productionMigrationStore : developmentMigrationStore/);
assert.match(model, /appendingPathComponent\("DevelopmentOnly"/);
assert.doesNotMatch(openAndRehearse, /recordBridgeMessage|error\.localizedDescription|UserDefaults|AppGroup|Snapshot|Watch|register|notification|requestPermission/i);
assert.doesNotMatch(store, /UserDefaults|AppGroup|NearcastWatch|WidgetSnapshot|WKWebView|NotificationCenter|URLSession/);
assert.match(store, /owner: "legacy"/);
assert.doesNotMatch(store, /owner: "native"/);
const report = section(store, "struct NativePlacesMigrationReport:", "\nenum NativePlacesMigrationError:");
assert.doesNotMatch(report, /latitude|longitude|placeID|digest|name|alias/i, "diagnostic receipt contains counts and state, not private records");
const reportView = section(diagnostics, 'Section("Places migration rehearsal")', '\n                Section("Apple Watch sync")');
assert.doesNotMatch(reportView, /selectedPlace|savedPlaces|latitude|longitude|digest|\.id\b|\.name\b/);
assert.match(contentView, /#if DEBUG\s*\.sheet\(isPresented: \$showingDiagnostics\)[\s\S]*NativeDiagnosticsView\(model: model\)[\s\S]*#endif/);
assert.match(app, /let nativePlacesMigrationInventoryReady = false;/);
assert.match(app, /nativePlacesMigrationInventoryReady = true;/);
// Source guard for the WebKit overload regression; end-to-end simulator QA
// separately verifies an actual asynchronous durable command receipt.
const controlsTransport = section(model, "func performPlacesCommand(", "\n    func openExistingPlacesSettings(");
assert.match(controlsTransport, /withCheckedThrowingContinuation/);
assert.match(controlsTransport, /continuation\.resume\(with: result\)/);
assert.doesNotMatch(controlsTransport, /response = try await webView\.callAsyncJavaScript/);
assert.match(controlsTransport, /reply\.requestID == command\.requestID/);
assert.match(controlsTransport, /revision == navigationRevision/);
assert.match(controlsTransport, /isTrustedPlacesDocument\(documentURL\)/);
assert.doesNotMatch(controlsTransport, /recordBridgeMessage|print\(|error\.localizedDescription/);
console.log("PASS Native places migration bridge: real exporter/app/bootstrap compatibility, safe empty vs unreadable inventory, unchanged preview context, local-only allowlisted copy, no writes/publishers/permissions, and native trust/redaction/ownership guardrails");
