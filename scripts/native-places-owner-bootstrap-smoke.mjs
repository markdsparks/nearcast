import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const swift = await readFile(new URL("../native/ios/NearcastApp/Bridge/NativePlacesOwnerBridge.swift", import.meta.url), "utf8");
const match = swift.match(/static let body = #"""\n([\s\S]*?)\n\s*"""#/);
assert.ok(match, "The smoke test must execute the actual bundled document-start body");
const bootstrap = `(function(configuration) {\n${match[1]}\n})(configuration);`;
const ownedKeys = ["weather-places", "weather-last-place", "weather-unit", "weather-theme", "nearcast-time-format",
  "nearcast-reactive-sky-v1", "nearcast-reactive-sky-motion-v1"];
const origin = "https://getnearcast.app";
const plain = (value) => JSON.parse(JSON.stringify(value));
let uuidSequence = 0;

function source() {
  const numeric = { id: "4243918", legacyIDType: "number", name: "Maryville", admin1: "Illinois", country: "United States",
    countryCode: "US", latitude: 38.7237, longitude: -89.9559, alias: "Home", timezone: "America/Chicago", followsCurrentLocation: false };
  const text = { ...numeric, id: "gps-fixed", alias: "Family" };
  delete text.legacyIDType;
  return { version: 1, owner: "native", hydration: "ready", capturedAt: "2026-09-18T19:00:00.000Z",
    selectedPlace: text, lastPlace: numeric, savedPlaces: [numeric, text],
    preferences: { unit: "celsius", theme: "dark", timeFormat: "24", reactiveSkyEnabled: true, reactiveSkyMotionAllowed: false } };
}

function snapshot() {
  return { version: 1, revision: 4, source: source(), deletionWatermark: 1, pendingDeletions: [{ sequence: 2, id: "removed-place" }] };
}

function fixture(options = {}) {
  const records = new WeakMap();
  class Storage {
    constructor(initial = {}) { records.set(this, new Map(Object.entries(initial))); }
    getItem(key) { return records.get(this).get(String(key)) ?? null; }
    setItem(key, value) { records.get(this).set(String(key), String(value)); }
    removeItem(key) { records.get(this).delete(String(key)); }
    clear() { records.get(this).clear(); }
  }
  class Request {
    constructor(url, init = {}) { this.url = String(url); this.method = init.method || "GET"; }
  }
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const posted = [], fetched = [], events = [], timers = new Map();
  const methodsBefore = Object.fromEntries(["getItem", "setItem", "removeItem", "clear"].map((key) => [key, Storage.prototype[key]]));
  const localStorage = new Storage(options.raw ?? Object.fromEntries(ownedKeys.map((key) => [key, `old:${key}`])));
  const sessionStorage = new Storage({ "weather-unit": "session-value" });
  const fetch = async (input, init) => {
    fetched.push({ input, init });
    return { ok: true, status: 200, json: async () => ({ mocked: true }) };
  };
  let timerID = 0;
  const configuration = { origin: options.expectedOrigin ?? origin };
  let seedReads = 0;
  Object.defineProperty(configuration, "seed", { get() {
    seedReads += 1;
    if (options.rejectSeedAccess) throw new Error("Private seed must not be inspected here");
    return { status: options.status ?? "owned", snapshot: options.snapshot === undefined ? snapshot() : options.snapshot };
  } });
  const sandbox = { configuration, Storage, Request, URL, CustomEvent, localStorage, sessionStorage,
    location: new URL(options.url ?? `${origin}/?test=owner-bootstrap`),
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}` },
    setTimeout(callback, delay) { const id = ++timerID; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, fetch,
    dispatchEvent(event) { events.push(event); return true; } };
  sandbox.window = sandbox;
  if (options.bridge !== false) sandbox.NearcastNative = { postMessage(message) {
    posted.push(plain(message));
    options.onPost?.(message, sandbox);
  } };
  vm.createContext(sandbox);
  vm.runInContext(bootstrap, sandbox, { filename: "NativePlacesOwnerBridge.swift: bundled body" });
  return { sandbox, api: sandbox.NearcastNative?.placesOwner, posted, fetched, events, timers, methodsBefore, fetch,
    seedReads: () => seedReads, raw: (storage = localStorage) => Object.fromEntries(records.get(storage)),
    fireTimer(id) { const entry = timers.get(id); assert.ok(entry); timers.delete(id); entry.callback(); } };
}

function confirmDocument(f, latest = { status: f.api.status, snapshot: f.api.snapshot }) {
  f.sandbox.NearcastNative.__updatePlacesOwner({ documentID: f.api.documentID, ...latest });
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// Wrong origin must return before reading private records or installing any
// projection, even when the page happens to have the regular native bridge.
for (const url of ["https://getnearcast.app.evil.invalid/", "http://getnearcast.app/", "https://getnearcast.app:444/",
  "https://www.getnearcast.app/", "https://example.invalid/"]) {
  const f = fixture({ url, rejectSeedAccess: true });
  assert.equal(f.seedReads(), 0, `Private seed is untouched on ${url}`);
  assert.equal(f.api, undefined);
  assert.equal(f.sandbox.NearcastNative.__resolvePlacesOwner, undefined);
  assert.equal(f.sandbox.NearcastNative.__updatePlacesOwner, undefined);
  assert.equal(f.sandbox.fetch, f.fetch);
  assert.deepEqual(f.posted, []);
  for (const [key, method] of Object.entries(f.methodsBefore)) assert.equal(f.sandbox.Storage.prototype[key], method);
}
const noBridge = fixture({ bridge: false, rejectSeedAccess: true });
assert.equal(noBridge.seedReads(), 0, "No native bridge means no private bootstrap");
const localOrigin = fixture({ expectedOrigin: "http://127.0.0.1:8080", url: "http://127.0.0.1:8080/fixture" });
assert.equal(localOrigin.api.version, 1, "A configured development origin must match its exact port");
assert.equal(fixture({ url: "https://getnearcast.app:443/" }).api.version, 1, "The browser's normalized default HTTPS port remains trusted");

const owned = fixture();
assert.equal(owned.api.status, "owned");
assert.equal(owned.api.compatibleReady, false, "Publication/notification readiness starts closed");
assert.deepEqual(owned.posted, [{ type: "placesOwner.ready", documentID: owned.api.documentID }]);
confirmDocument(owned);
await flushMicrotasks();
const initialOwnerEventCount = owned.events.length;
assert.equal(initialOwnerEventCount, 1, "Initial native confirmation publishes the latest seed to the page");
const saved = JSON.parse(owned.sandbox.localStorage.getItem("weather-places"));
assert.equal(saved[0].id, 4243918, "Numeric legacy IDs are projected as numbers");
assert.equal(saved[1].id, "gps-fixed", "String identifiers remain exact");
assert.ok(!("legacyIDType" in saved[0]) && !("legacyIDType" in saved[1]));
assert.equal(saved[0].alias, "Home");
assert.equal(saved[0].followsCurrentLocation, false, "Saved GPS-origin places remain fixed");
assert.equal(JSON.parse(owned.sandbox.localStorage.getItem("weather-last-place")).id, 4243918,
  "Last place is projected independently from the currently selected place");
const projectedPreferences = Object.fromEntries(ownedKeys.slice(2).map((key) => [key, owned.sandbox.localStorage.getItem(key)]));
assert.deepEqual(projectedPreferences, { "weather-unit": "celsius", "weather-theme": "dark", "nearcast-time-format": "24",
  "nearcast-reactive-sky-v1": "1", "nearcast-reactive-sky-motion-v1": "0" });
assert.equal(owned.api.snapshot.source.savedPlaces[0].id, "4243918", "Projection never mutates the authoritative native snapshot");
const rawBefore = owned.raw();
for (const key of ownedKeys) {
  assert.throws(() => owned.sandbox.localStorage.setItem(key, "replacement"), /Native places/);
  assert.throws(() => owned.sandbox.localStorage.removeItem(key), /Native places/);
}
assert.throws(() => owned.sandbox.localStorage.clear(), /Native places/);
assert.deepEqual(owned.raw(), rawBefore, "Rejected legacy edits leave protected browser records unchanged");
for (const key of ["nearcast-place-watch-notification-places-v1", "nearcast-plan-watch-notification-plans-v1",
  "nearcast-plan-watch-native-subscription-id-v1", "forecast-cache:public-city"]) {
  owned.sandbox.localStorage.setItem(key, "legacy-owned-value");
  assert.equal(owned.sandbox.localStorage.getItem(key), "legacy-owned-value");
  assert.equal(owned.raw()[key], "legacy-owned-value");
  owned.sandbox.localStorage.removeItem(key);
  assert.equal(owned.sandbox.localStorage.getItem(key), null);
}
owned.sandbox.sessionStorage.setItem("weather-unit", "session-celsius");
assert.equal(owned.sandbox.sessionStorage.getItem("weather-unit"), "session-celsius", "Only localStorage is owned");
owned.sandbox.sessionStorage.clear();
assert.deepEqual(owned.raw(owned.sandbox.sessionStorage), {});

const unmigrated = fixture({ status: "unmigrated", snapshot: null });
let legacyReady = false;
unmigrated.api.ready.then(() => { legacyReady = true; });
await flushMicrotasks();
assert.equal(legacyReady, false, "A bundled unmigrated seed is not confirmation of current ownership");
for (const key of ownedKeys) {
  assert.equal(unmigrated.sandbox.localStorage.getItem(key), `old:${key}`, "Unconfirmed legacy reads are preserved rather than fabricated empty");
  assert.throws(() => unmigrated.sandbox.localStorage.setItem(key, "early-write"), /Native places/);
  assert.throws(() => unmigrated.sandbox.localStorage.removeItem(key), /Native places/);
}
assert.throws(() => unmigrated.sandbox.localStorage.clear(), /Native places/);
for (const route of ["register", "unregister"]) {
  await assert.rejects(unmigrated.sandbox.fetch(`/api/watch/notifications/${route}`, { method: "POST" }), /not reconciled/);
}
assert.equal(unmigrated.fetched.length, 0, "Old pages cannot mutate notifications before the native handshake");
unmigrated.sandbox.NearcastNative.__updatePlacesOwner({ documentID: "prior-document", status: "unmigrated", snapshot: null });
await flushMicrotasks();
assert.equal(legacyReady, false);
confirmDocument(unmigrated);
await flushMicrotasks();
assert.equal(legacyReady, true, "Matching native confirmation releases normal legacy initialization");
for (const key of ownedKeys) {
  assert.equal(unmigrated.sandbox.localStorage.getItem(key), `old:${key}`);
  unmigrated.sandbox.localStorage.setItem(key, 42);
  assert.equal(unmigrated.sandbox.localStorage.getItem(key), "42");
  unmigrated.sandbox.localStorage.removeItem(key);
  assert.equal(unmigrated.sandbox.localStorage.getItem(key), null);
}
unmigrated.sandbox.localStorage.setItem("other", "value");
unmigrated.sandbox.localStorage.clear();
assert.deepEqual(unmigrated.raw(), {}, "Unmigrated pages keep legacy Storage semantics");

for (const status of ["blocked", "loading"]) {
  const f = fixture({ status, snapshot: null });
  for (const key of ownedKeys) {
    assert.equal(f.sandbox.localStorage.getItem(key), null, "Unknown state must not expose stale owned browser records");
    assert.throws(() => f.sandbox.localStorage.setItem(key, "replacement"), /Native places/);
    assert.throws(() => f.sandbox.localStorage.removeItem(key), /Native places/);
  }
  assert.throws(() => f.sandbox.localStorage.clear(), /Native places/);
}
const emptySnapshot = snapshot();
emptySnapshot.source.selectedPlace = null;
emptySnapshot.source.lastPlace = null;
emptySnapshot.source.savedPlaces = [];
const empty = fixture({ snapshot: emptySnapshot });
assert.equal(empty.sandbox.localStorage.getItem("weather-places"), "[]");
assert.equal(empty.sandbox.localStorage.getItem("weather-last-place"), null, "Explicit empty last place never borrows a saved/selected record");

// Use the real production route names, strings, URL objects and Request-like
// inputs. Every response comes from the stub; this test never uses the network.
for (const [input, init] of [
  ["/api/watch/notifications/register", { method: "POST" }],
  ["/api/watch/notifications/unregister/", { method: "post" }],
  [`${origin}/api/watch/notifications/register?reason=test`, { method: "POST" }],
  [new URL("/api/watch/notifications/unregister", origin), { method: "DELETE" }],
  [new owned.sandbox.Request(`${origin}/api/watch/notifications/register`, { method: "POST" }), undefined],
  [new owned.sandbox.Request(`${origin}/api/watch/notifications/unregister`), { method: "POST" }]
]) {
  await assert.rejects(owned.sandbox.fetch(input, init), /not reconciled/);
}
assert.equal(owned.fetched.length, 0, "Fenced notification mutation requests never reach fetch");
for (const [url, method] of [["/api/watch/notifications/register", "GET"], ["/api/watch/notifications/unregister", "HEAD"],
  ["/api/watch/notifications/config", "GET"], ["/api/forecast", "GET"], ["/api/watch/notifications/register-extra", "POST"]]) {
  assert.equal((await owned.sandbox.fetch(url, { method })).ok, true);
}
owned.api.compatibleReady = true;
for (const route of ["register", "unregister"]) {
  assert.equal((await owned.sandbox.fetch(`/api/watch/notifications/${route}`, { method: "POST" })).ok, true);
  assert.equal((await unmigrated.sandbox.fetch(`/api/watch/notifications/${route}`, { method: "POST" })).ok, true);
}

const updated = snapshot();
updated.revision += 1;
updated.source.preferences.unit = "fahrenheit";
owned.sandbox.NearcastNative.__updatePlacesOwner({ documentID: "old-document", status: "unmigrated", snapshot: null });
assert.equal(owned.api.compatibleReady, true, "An old document update cannot reset this document's readiness");
assert.equal(owned.api.snapshot.revision, 4);
assert.equal(owned.events.length, initialOwnerEventCount);
owned.sandbox.NearcastNative.__updatePlacesOwner({ documentID: owned.api.documentID, status: "owned", snapshot: updated });
assert.equal(owned.api.compatibleReady, false, "Every accepted ownership update resets reconciliation readiness");
assert.equal(owned.api.snapshot.revision, 5);
assert.equal(owned.sandbox.localStorage.getItem("weather-unit"), "fahrenheit");
assert.equal(owned.events.length, initialOwnerEventCount + 1);
assert.equal(owned.events.at(-1).type, "nearcast:native-places-owner");
assert.equal(owned.events.at(-1).detail.documentID, owned.api.documentID);
await assert.rejects(owned.sandbox.fetch("/api/watch/notifications/register", { method: "POST" }), /not reconciled/);

// Request promises are bound to both request and document, resolve once, and
// expire without replaying a possibly committed native mutation.
const requests = fixture();
const command = { version: 1, requestID: "22222222-2222-4222-8222-222222222222", action: "snapshot" };
confirmDocument(requests);
await flushMicrotasks();
let settled = false;
const request = requests.api.perform(command).then((value) => { settled = true; return value; });
await flushMicrotasks();
const sent = requests.posted.at(-1);
assert.equal(sent.type, "placesOwner.perform");
assert.equal(sent.documentID, requests.api.documentID);
assert.deepEqual(sent.command, command);
assert.ok(sent.requestId && sent.requestId !== sent.documentID);
assert.equal(requests.timers.size, 1);
assert.equal([...requests.timers.values()][0].delay, 20000);
requests.sandbox.NearcastNative.__resolvePlacesOwner({ requestId: sent.requestId, ok: true, value: "missing-document" });
requests.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: "old-document", requestId: sent.requestId, ok: true, value: "wrong-document" });
requests.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: requests.api.documentID, requestId: "other-request", ok: true, value: "wrong-request" });
await Promise.resolve();
assert.equal(settled, false);
assert.equal(requests.timers.size, 1);
requests.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: requests.api.documentID, requestId: sent.requestId, ok: true, value: { accepted: true } });
assert.deepEqual(plain(await request), { accepted: true });
assert.equal(requests.timers.size, 0);
requests.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: requests.api.documentID, requestId: sent.requestId, ok: false, message: "late duplicate" });

const acknowledgement = requests.api.acknowledgeDeletions(8);
await flushMicrotasks();
const ackMessage = requests.posted.at(-1);
assert.equal(ackMessage.type, "placesOwner.acknowledge");
assert.equal(ackMessage.through, 8);
requests.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: requests.api.documentID, requestId: ackMessage.requestId, ok: false, message: "Native save failed" });
await assert.rejects(acknowledgement, /Native save failed/);
assert.equal(requests.timers.size, 0);

const timeout = requests.api.perform(command);
const timeoutRejected = assert.rejects(timeout, /could not be verified/);
await flushMicrotasks();
const timedOutRequest = requests.posted.at(-1);
const sentBeforeTimeout = requests.posted.length;
requests.fireTimer([...requests.timers.keys()][0]);
await timeoutRejected;
assert.equal(requests.posted.length, sentBeforeTimeout, "Timeout never replays a mutation");
requests.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: requests.api.documentID, requestId: timedOutRequest.requestId, ok: true, value: "too late" });
assert.equal(requests.timers.size, 0);
await assert.rejects(requests.api.activate(), /native Settings/);
assert.equal(requests.posted.length, sentBeforeTimeout, "A page cannot silently request ownership activation");

const immediate = fixture({ onPost(message, sandbox) {
  if (message.type === "placesOwner.perform") sandbox.NearcastNative.__resolvePlacesOwner({
    documentID: message.documentID, requestId: message.requestId, ok: true, value: "synchronous native reply"
  });
} });
confirmDocument(immediate);
assert.equal(await immediate.api.perform(command), "synchronous native reply", "Pending correlation is installed before native dispatch");
assert.equal(immediate.timers.size, 0);

// The bundled snapshot may predate a native commit that happens before ready
// delivery. No command leaves this page until its exact document is confirmed,
// and the latest seed must be installed before the queued dispatch occurs.
const dispatchRevisions = [];
const startup = fixture({ onPost(message, sandbox) {
  if (message.type !== "placesOwner.ready") dispatchRevisions.push(sandbox.NearcastNative.placesOwner.snapshot?.revision);
} });
const startupRead = startup.api.perform(command);
const startupAck = startup.api.acknowledgeDeletions(2);
await flushMicrotasks();
assert.equal(startup.posted.length, 1, "Startup commands queue behind document confirmation");
assert.equal(startup.timers.size, 2, "Queued startup requests already have bounded timeouts");
const latestSeed = snapshot();
latestSeed.revision = 9;
latestSeed.source.preferences.unit = "fahrenheit";
latestSeed.source.savedPlaces = [];
startup.sandbox.NearcastNative.__updatePlacesOwner({ documentID: requests.api.documentID, status: "owned", snapshot: latestSeed });
await flushMicrotasks();
assert.equal(startup.posted.length, 1, "A same-URL prior document cannot release the new document's queue");
assert.equal(startup.api.snapshot.revision, 4, "Wrong-document ready responses cannot install records");
confirmDocument(startup, { status: "owned", snapshot: latestSeed });
assert.equal(startup.api.snapshot.revision, 9, "Latest native state replaces the bundled seed synchronously");
assert.equal(startup.sandbox.localStorage.getItem("weather-unit"), "fahrenheit");
assert.equal(startup.sandbox.localStorage.getItem("weather-places"), "[]");
await flushMicrotasks();
assert.deepEqual(startup.posted.map((message) => message.type), ["placesOwner.ready", "placesOwner.perform", "placesOwner.acknowledge"]);
assert.deepEqual(dispatchRevisions, [9, 9], "Queued commands dispatch only after latest seed installation");
assert.equal(startup.api.compatibleReady, false, "Document confirmation alone never grants notification compatibility");
for (const message of startup.posted.slice(1)) startup.sandbox.NearcastNative.__resolvePlacesOwner({
  documentID: startup.api.documentID, requestId: message.requestId, ok: true, value: latestSeed
});
assert.equal((await startupRead).revision, 9);
assert.equal((await startupAck).revision, 9);
assert.equal(startup.timers.size, 0);

const startupTimeout = fixture({ status: "loading", snapshot: null });
const expiredStartupRequest = startupTimeout.api.perform(command);
const startupRejected = assert.rejects(expiredStartupRequest, /could not be verified/);
await flushMicrotasks();
assert.equal(startupTimeout.posted.length, 1);
startupTimeout.fireTimer([...startupTimeout.timers.keys()][0]);
await startupRejected;
confirmDocument(startupTimeout, { status: "owned", snapshot: latestSeed });
await flushMicrotasks();
assert.equal(startupTimeout.posted.length, 1, "A request that expired before ready must never be dispatched afterward");
assert.equal(startupTimeout.timers.size, 0);
assert.equal(startupTimeout.api.snapshot.revision, 9, "Late confirmation may hydrate current state without replaying an expired request");

const changedOwnerDuringStartup = fixture({ status: "unmigrated", snapshot: null });
const latestOwnedRead = changedOwnerDuringStartup.api.perform(command);
await flushMicrotasks();
assert.equal(changedOwnerDuringStartup.posted.length, 1);
confirmDocument(changedOwnerDuringStartup, { status: "owned", snapshot: latestSeed });
await flushMicrotasks();
assert.equal(changedOwnerDuringStartup.api.status, "owned", "A cold latest seed can supersede stale unmigrated ownership");
assert.throws(() => changedOwnerDuringStartup.sandbox.localStorage.setItem("weather-unit", "celsius"), /Native places/);
const latestOwnedRequest = changedOwnerDuringStartup.posted.at(-1);
changedOwnerDuringStartup.sandbox.NearcastNative.__resolvePlacesOwner({ documentID: changedOwnerDuringStartup.api.documentID,
  requestId: latestOwnedRequest.requestId, ok: true, value: latestSeed });
assert.equal((await latestOwnedRead).revision, 9);

// Regression guards: a callback without its originating document must never
// clear the ownership fence, and blocked state must not project stale content.
owned.api.compatibleReady = true;
owned.sandbox.NearcastNative.__updatePlacesOwner({ status: "unmigrated", snapshot: null });
assert.equal(owned.api.status, "owned", "Uncorrelated ownership updates must be ignored");
assert.equal(owned.api.compatibleReady, true);
const blockedWithStaleCopy = fixture({ status: "blocked", snapshot: snapshot() });
for (const key of ownedKeys) assert.equal(blockedWithStaleCopy.sandbox.localStorage.getItem(key), null,
  "Blocked ownership must not expose an unverified stale projection");

console.log("PASS native owner document-start bootstrap: exact origin/privacy, seven-key projection, storage/network fences, latest-seed handshake, queued startup timeouts and document-correlated request promises");
