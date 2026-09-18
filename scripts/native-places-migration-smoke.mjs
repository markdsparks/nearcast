import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "native-places-migration.js"), "utf8");
const app = await readFile(path.join(root, "app.js"), "utf8");
const sandbox = { window: {}, TextEncoder, Intl, Date };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "native-places-migration.js" });
const api = sandbox.window.NearcastPlacesMigrationExport;
assert.equal(api.version, 1);

// Use the real legacy normalizer, not a permissive synthetic approximation.
function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Legacy ${name} exists`);
  const end = app.indexOf("\nfunction ", start + 1);
  assert.notEqual(end, -1, `Legacy ${name} has a bounded source section`);
  return app.slice(start, end);
}
vm.runInContext(["normalizePlace", "canonicalPlaceName", "normalizedPlaceAlias", "placeCountryCode", "normalizeQualifierKey", "slug"]
  .map(functionSource).join("\n"), sandbox);
const plain = (value) => JSON.parse(JSON.stringify(value));
const normalized = (value) => plain(sandbox.normalizePlace(value));
const now = new Date("2026-09-18T20:00:00.000Z");
const keys = ["weather-places", "weather-last-place", "weather-unit", "weather-theme", "nearcast-time-format", "nearcast-reactive-sky-v1", "nearcast-reactive-sky-motion-v1"];
const genericError = "Places and preferences could not be prepared safely.";
const place = (overrides = {}) => ({ id: "home", name: "Maryville", admin1: "Illinois", country: "United States", countryCode: "US", latitude: 38.7237, longitude: -89.9559, ...overrides });

function fixture(saved = [], { selected = saved[0] ?? null, last = selected, values = {}, stateChanges = {} } = {}) {
  const stored = new Map(Object.entries({
    "weather-places": JSON.stringify(saved),
    ...(last === null ? {} : { "weather-last-place": JSON.stringify(last) }),
    ...values
  }));
  const reads = [];
  let writes = 0;
  const storage = new Proxy({
    getItem(key) { reads.push(key); return stored.has(key) ? stored.get(key) : null; },
    setItem() { writes += 1; throw new Error("Unexpected write"); },
    removeItem() { writes += 1; throw new Error("Unexpected removal"); },
    clear() { writes += 1; throw new Error("Unexpected clearing"); },
    key() { throw new Error("Storage enumeration is forbidden"); },
    get length() { throw new Error("Storage enumeration is forbidden"); }
  }, { ownKeys() { throw new Error("Storage enumeration is forbidden"); } });
  const state = {
    activePlace: selected === null ? null : normalized(selected),
    savedPlaces: saved.map(normalized),
    unit: values["weather-unit"] || "fahrenheit",
    theme: values["weather-theme"] || "auto",
    timeFormat: ["12", "24", "auto"].includes(values["nearcast-time-format"]) ? values["nearcast-time-format"] : "auto",
    reactiveSkyEnabled: values["nearcast-reactive-sky-v1"] === "1",
    reactiveSkyMotionAllowed: values["nearcast-reactive-sky-motion-v1"] === "1",
    ...stateChanges
  };
  return { input: { state, storage, inventoryReady: true, now }, reads, stored, writes: () => writes };
}
function build(f) { return plain(api.build(f.input)); }
function fails(f, message) {
  assert.throws(() => api.build(f.input), (error) => error.message === genericError && !String(error).includes("PRIVATE_MARKER"), message);
  assert.equal(f.writes(), 0, "Failure must not mutate storage");
}
function roundTripFixture() {
  const home = place({ id: 4243918, alias: "Home", timezone: "America/Chicago", followsCurrentLocation: false });
  const family = place({ id: "family-berlin", name: "Berlin", admin1: "Berlin", country: "Germany", countryCode: "DE",
    latitude: 52.52, longitude: 13.405, alias: "Family", timezone: "Europe/Berlin" });
  return fixture([home, family], { values: { "nearcast-time-format": "auto", "nearcast-reactive-sky-v1": "1", "nearcast-reactive-sky-motion-v1": "0" } });
}

if (process.argv.includes("--export-fixture")) {
  // Cross-language tests ingest a production-built synthetic payload. No family
  // records are read, and the caller controls any temporary output artifact.
  process.stdout.write(JSON.stringify(build(roundTripFixture())) + "\n");
  process.exit(0);
}

const zero = fixture();
const empty = build(zero);
assert.deepEqual(empty, {
  version: 1, owner: "legacy", hydration: "ready", capturedAt: now.toISOString(), selectedPlace: null, lastPlace: null, savedPlaces: [],
  preferences: { unit: "fahrenheit", timeFormat: "auto", theme: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false }
});
assert.deepEqual(zero.reads, keys, "Only the exact allowlisted keys are read, once each");
assert.equal(zero.writes(), 0);
const absentSaved = fixture();
absentSaved.stored.delete("weather-places");
assert.deepEqual(build(absentSaved).savedPlaces, [], "An explicitly ready genuinely empty inventory is valid");

const full = roundTripFixture();
const beforeRaw = full.stored.get("weather-places");
const beforeState = JSON.stringify(full.input.state);
const exported = build(full);
assert.equal(exported.savedPlaces[0].id, "4243918");
assert.equal(exported.savedPlaces[0].legacyIDType, "number", "Numeric legacy ID kind survives for compatibility round-trips");
assert.equal(Object.hasOwn(exported.savedPlaces[1], "legacyIDType"), false, "String IDs do not acquire numeric kind metadata");
assert.equal(exported.savedPlaces[0].timezone, "America/Chicago", "Raw timezone survives the legacy normalizer's omission");
assert.equal(exported.savedPlaces[0].alias, "Home");
assert.equal(exported.savedPlaces[0].followsCurrentLocation, false, "Explicit fixed-location choice survives");
assert.equal(Object.hasOwn(exported.savedPlaces[1], "followsCurrentLocation"), false, "Historical absence is not invented as false");
assert.equal(exported.preferences.timeFormat, "auto", "Auto is preserved rather than resolved to this device's clock");
assert.equal(exported.preferences.reactiveSkyEnabled, true);
assert.equal(exported.preferences.reactiveSkyMotionAllowed, false);
assert.equal(full.stored.get("weather-places"), beforeRaw, "Source numeric ID record is unchanged");
assert.equal(JSON.stringify(full.input.state), beforeState, "Hydrated legacy state is not mutated");

const duplicatesAtPoint = fixture([place({ id: "home", alias: "Home" }), place({ id: "parents", alias: "Parents" })]);
assert.deepEqual(build(duplicatesAtPoint).savedPlaces.map((item) => item.id), ["home", "parents"], "Distinct saved identities at one coordinate remain separate and ordered");
const legacy = place({ name: "Maryville, Illinois, Illinois", alias: "  Home  ", countryCode: "", country_code: "us", timezone: "America/Chicago" });
const legacyExport = build(fixture([legacy]));
assert.equal(legacyExport.savedPlaces[0].name, legacy.name, "Raw structured legacy name is preserved even when hydrated display is canonicalized");
assert.equal(legacyExport.savedPlaces[0].alias, legacy.alias, "Raw alias is preserved rather than silently rewritten");
assert.equal(legacyExport.savedPlaces[0].countryCode, "US", "Known legacy country spelling is exported as uppercase ISO code");
assert.equal(Object.hasOwn(build(fixture([place({ countryCode: "" })])).savedPlaces[0], "countryCode"), false);
const current = place({ id: "gps-synthetic", followsCurrentLocation: true, timezone: "America/Chicago" });
assert.equal(build(fixture([], { selected: current, last: current })).selectedPlace.followsCurrentLocation, true);
const renamed = fixture([place({ alias: "New name" })], { last: place({ alias: "Old name" }) });
assert.equal(build(renamed).lastPlace.alias, "Old name", "Persisted last-place record is not overwritten by selected-place alias changes");
const familyEmoji = "Family 👨‍👩‍👧";
assert.equal(build(fixture([place({ alias: familyEmoji })])).savedPlaces[0].alias, familyEmoji,
  "Legitimate emoji aliases retain zero-width joiners without normalization loss");

for (const readiness of [undefined, null, false, "ready", 1]) {
  const f = fixture(); f.input.inventoryReady = readiness; fails(f, "Unknown or false hydration cannot pretend to be an empty inventory");
}
for (const raw of ["{", "null", "{}", "", JSON.stringify([null]), JSON.stringify([false])]) {
  const f = fixture(); f.stored.set("weather-places", raw); fails(f, "Malformed raw inventory fails closed");
}
const twoRows = fixture([place(), place({ id: "other", latitude: 39 })]);
twoRows.stored.set("weather-places", JSON.stringify([place(), { ...place({ id: "other" }), latitude: null }]));
fails(twoRows, "One malformed row aborts the entire snapshot rather than dropping that row");
for (const change of [
  { latitude: "38.7237" }, { longitude: false }, { latitude: 91 }, { longitude: -181 }, { latitude: null },
  { id: Number.MAX_SAFE_INTEGER + 1 }, { id: 1.5 }, { id: 0 }, { id: -1 }, { id: "" }, { id: "x".repeat(161) },
  { name: "" }, { name: "x".repeat(181) }, { admin1: 2 }, { country: null },
  { name: "City\u0085name" }, { alias: "Home\u0001" }, { id: "place\u007f" },
  { alias: "a".repeat(37) }, { alias: null }, { timezone: "Not/AZone" }, { timezone: "" }, { timezone: false },
  { followsCurrentLocation: 1 }, { followsCurrentLocation: null }, { countryCode: "USA" }, { countryCode: " U" },
  { countryCode: "US", country_code: "DE" }
]) {
  const f = fixture([place()]); f.stored.set("weather-places", JSON.stringify([place(change)])); fails(f, "Invalid place fields cannot be coerced or truncated");
}
for (const key of ["name", "id", "latitude", "longitude"]) {
  const raw = place(); delete raw[key];
  const f = fixture([place()]); f.stored.set("weather-places", JSON.stringify([raw])); fails(f, "Missing required place fields fail closed");
}
const stringDuplicate = fixture([place(), place()]); fails(stringDuplicate, "Duplicate string IDs reject");
const numericCollision = fixture([place({ id: 123 }), place({ id: "123" })]); fails(numericCollision, "Numeric and string canonical-ID collisions reject instead of merging");
const tooMany = fixture(Array.from({ length: 61 }, (_, index) => place({ id: `place-${index}` }))); fails(tooMany, "Oversized inventory rejects instead of truncating");

for (const change of [
  { name: "Other town" }, { id: "different" }, { latitude: 38.8 }, { longitude: -89.8 },
  { admin1: "Missouri" }, { country: "Germany" }, { countryCode: "DE" }, { alias: "Changed" },
  { followsCurrentLocation: true }, { timezone: "Europe/Berlin" }
]) {
  const f = fixture([place({ alias: "Home", timezone: "America/Chicago" })]);
  Object.assign(f.input.state.savedPlaces[0], change); fails(f, "Stale meaningful hydrated-place differences reject");
}
const reordered = fixture([place(), place({ id: "second" })]); reordered.input.state.savedPlaces.reverse(); fails(reordered, "Order disagreement rejects");
const missingSaved = fixture([place()]); missingSaved.input.state.savedPlaces = []; fails(missingSaved, "Unhydrated empty state does not erase saved records");
const sourceMissing = fixture([place()]); sourceMissing.stored.delete("weather-places"); fails(sourceMissing, "Missing source with nonempty hydrated state rejects");
const lostFlag = fixture([place({ followsCurrentLocation: false })]); delete lostFlag.input.state.savedPlaces[0].followsCurrentLocation; fails(lostFlag, "Flag absence is meaningful, not equivalent to false");

for (const [key, value] of [
  ["weather-unit", "kelvin"], ["weather-theme", "system"], ["nearcast-time-format", "25"],
  ["nearcast-reactive-sky-v1", "false"], ["nearcast-reactive-sky-motion-v1", "true"]
]) {
  const f = fixture([], { values: { [key]: value } }); fails(f, "Unsupported preferences cannot be silently sanitized during migration");
}
for (const [key, value] of [["unit", "celsius"], ["timeFormat", "24"], ["theme", "dark"], ["reactiveSkyEnabled", true], ["reactiveSkyMotionAllowed", true]]) {
  const f = fixture([], { stateChanges: { [key]: value } }); fails(f, "Raw versus hydrated preference disagreement rejects");
}
for (const clock of ["12", "24", "auto"]) {
  const f = fixture([], { values: { "nearcast-time-format": clock, "weather-unit": "celsius", "weather-theme": "dark" } });
  assert.equal(build(f).preferences.timeFormat, clock);
  assert.equal(build(f).preferences.unit, "celsius");
  assert.equal(build(f).preferences.theme, "dark");
}
for (const key of keys) {
  const f = fixture(); f.input.storage = { getItem(name) { if (name === key) throw new Error("PRIVATE_MARKER storage failed"); return null; } };
  fails(f, "Any source read failure blocks rehearsal without leaking storage errors");
}
const invalidLast = fixture(); invalidLast.stored.set("weather-last-place", "{"); fails(invalidLast, "Malformed last-place data cannot be erased to null");
const invalidSelected = fixture(); invalidSelected.input.state.activePlace = { name: "PRIVATE_MARKER" }; fails(invalidSelected, "Malformed selected place blocks export");
const invalidClock = fixture(); invalidClock.input.now = new Date(NaN); fails(invalidClock, "Invalid capture timestamp rejects");

const privatePlace = place({ privateText: "PRIVATE_MARKER", plans: ["PRIVATE_MARKER"], notificationTargetId: "PRIVATE_MARKER", deviceLocationCache: "PRIVATE_MARKER" });
const privateFixture = fixture([privatePlace]);
privateFixture.stored.set("nearcast-plan-memory-v1", "PRIVATE_MARKER");
privateFixture.stored.set("nearcast-watch-targets", "PRIVATE_MARKER");
Object.defineProperty(privateFixture.input.state, "privateToken", { get() { throw new Error("Must not read private state"); } });
const safe = build(privateFixture);
assert.doesNotMatch(JSON.stringify(safe), /PRIVATE_MARKER|notificationTarget|deviceLocation|plans|privateText|privateToken/);
assert.deepEqual(privateFixture.reads, keys, "No plan/watch/cache key or storage enumeration is used");
assert.equal(privateFixture.writes(), 0);

const dense = Array.from({ length: 60 }, (_, index) => place({
  id: `${index}-${"界".repeat(156)}`, name: "名".repeat(180), admin1: "州".repeat(180), country: "国".repeat(180),
  countryCode: "", alias: "家".repeat(36)
}));
fails(fixture(dense), "UTF-8 payload limit applies to encoded bytes, not character count");

console.log("PASS native places migration export: exact read-only allowlist, hydration and source parity, lossless saved metadata/ID kind, Auto preferences, fail-closed limits, privacy and no writes");
