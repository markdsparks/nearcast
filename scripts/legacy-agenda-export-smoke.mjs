import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planner = fs.readFileSync(path.join(root, "planner.js"), "utf8");
const start = planner.indexOf("/* ---------- Native Agenda export (read-only legacy projection) ---------- */");
const end = planner.indexOf("\nfunction planMemoryFromEvent", start);
assert.ok(start >= 0 && end > start, "The read-only Agenda exporter is a bounded planner.js section");
const exporter = planner.slice(start, end);
const adapter = fs.readFileSync(path.join(root, "native/ios/NearcastApp/Support/NativeAgendaExport.js"), "utf8");
const contractEnd = planner.indexOf("/* ---------- Native Plans handover rehearsal (read-only) ---------- */", start);
assert.ok(adapter.includes(planner.slice(start, contractEnd).trim()), "Bundled adapter must use the same validated Agenda contract");

function validPlan(overrides = {}) {
  return {
    id: "soccer",
    kind: "plan",
    title: "Soccer",
    label: "Plan window",
    original: "Soccer after school",
    answer: "Dry enough to play.",
    place: {
      id: 12345,
      name: "Maryville",
      admin1: "Illinois",
      country: "United States",
      countryCode: "US",
      latitude: 38.72,
      longitude: -89.95,
      timezone: "America/Chicago"
    },
    targetDate: "2026-09-22",
    startHour: 17,
    endHour: 19,
    windows: [{ id: "soccer-window", targetDate: "2026-09-22", startHour: 17, endHour: 19, label: "Plan window" }],
    scheduleType: "single",
    span: null,
    routine: null,
    schemaVersion: 2,
    scheduleId: "soccer",
    createdAt: 1_789_000_000_000,
    updatedAt: 1_789_000_000_000,
    ...overrides
  };
}

function harness({ raw, ios = true, bundled = false } = {}) {
  const reads = [];
  const writes = [];
  const messages = [];
  const bridge = ios ? {
    platform: "ios",
    postMessage(payload) { messages.push(payload); }
  } : { platform: "web", postMessage(payload) { messages.push(payload); } };
  const sandbox = {
    window: { NearcastNative: bridge },
    localStorage: {
      getItem(key) { reads.push(key); return key === "nearcast-plan-memory-v1" ? raw : null; },
      setItem(key, value) { writes.push([key, value]); }
    },
    PLAN_MEMORY_KEY: "nearcast-plan-memory-v1",
    savePlanMemories(value) { raw = JSON.stringify(value); writes.push(["nearcast-plan-memory-v1", raw]); return "saved"; },
    TextEncoder,
    Intl,
    Date,
    JSON,
    Math,
    Set,
    Number,
    String,
    Array,
    Object,
    // The real exporter invokes planner.js's normalizer. This test keeps the
    // fixture already canonical so it isolates and exercises bridge/export
    // validation without loading the entire browser app.
    normalizePlanMemory(value) { return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : null; },
    planIsoDateOffset(value, offset) {
      const date = new Date(`${value}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(bundled ? adapter : exporter, sandbox, { filename: "legacy-agenda-export" });
  return {
    reads,
    writes,
    messages,
    installAgain() { vm.runInContext(adapter, sandbox); },
    save(value) { return sandbox.savePlanMemories(value); },
    hydrate() { return vm.runInContext("markLegacyAgendaMemoryHydrated()", sandbox); },
    publish() { return vm.runInContext("publishLegacyAgendaSnapshot()", sandbox); }
  };
}

const absent = harness({ raw: null });
absent.hydrate();
assert.deepEqual(absent.messages, [], "A missing raw plan key is unavailable, never an authoritative empty Agenda");
assert.deepEqual(absent.reads, ["nearcast-plan-memory-v1"], "The exporter reads only the plan-memory key");
assert.deepEqual(absent.writes, [], "Exporting an unavailable source never writes storage");

const bundled = harness({ raw: "[]", bundled: true });
assert.equal(bundled.messages.length, 1, "Bundled adapter exports persisted plans on installation");
bundled.installAgain();
assert.equal(bundled.messages.length, 1, "Repeated installation does not wrap saves twice");
assert.equal(bundled.save([validPlan()]), "saved", "Existing save behavior is preserved");
assert.equal(bundled.messages.length, 2, "A real save immediately updates native Agenda exactly once");
assert.equal(bundled.messages[1].agenda.plans[0].id, "soccer");
assert.equal(bundled.writes.length, 1, "The adapter adds no writes or notification side effects");
bundled.save([]);
assert.equal(bundled.messages[2].agenda.plans.length, 0, "Deletion clears native Agenda");
assert.equal(harness({ raw: "{", bundled: true }).messages.length, 0, "Bundled adapter fails closed on corrupt storage");

const malformed = harness({ raw: "{" });
malformed.hydrate();
assert.deepEqual(malformed.messages, [], "Malformed raw plan memory fails closed");
assert.deepEqual(malformed.writes, [], "Malformed raw plan memory is never repaired or overwritten");

const explicitEmpty = harness({ raw: "[]" });
explicitEmpty.hydrate();
assert.equal(explicitEmpty.messages.length, 1, "An explicit valid empty plan list is a known empty Agenda");
assert.deepEqual(Object.keys(explicitEmpty.messages[0]).sort(), ["agenda", "type"]);
assert.equal(explicitEmpty.messages[0].type, "agenda.snapshot");
assert.deepEqual(Object.keys(explicitEmpty.messages[0].agenda).sort(), ["capturedAt", "hydration", "owner", "plans", "version"]);
assert.deepEqual(explicitEmpty.messages[0].agenda.plans, []);
assert.equal(explicitEmpty.messages[0].agenda.owner, "legacy");
assert.equal(explicitEmpty.messages[0].agenda.hydration, "ready");
assert.equal(explicitEmpty.messages[0].agenda.version, 1);

const valid = harness({ raw: JSON.stringify([validPlan()]) });
valid.hydrate();
assert.equal(valid.messages.length, 1, "A fully known canonical plan exports once after hydration");
const wirePlan = valid.messages[0].agenda.plans[0];
assert.deepEqual(Object.keys(wirePlan).sort(), [
  "answer", "createdAt", "endHour", "id", "kind", "label", "original", "place", "routine", "scheduleId", "scheduleType", "schemaVersion", "span", "startHour", "targetDate", "title", "updatedAt", "windows"
]);
assert.equal(wirePlan.place.id, 12345, "Numeric legacy place IDs remain numeric for NativeAgendaRepository");
assert.deepEqual(Object.keys(wirePlan.place).sort(), ["admin1", "country", "countryCode", "id", "latitude", "longitude", "name", "timezone"]);
assert.deepEqual(valid.reads, ["nearcast-plan-memory-v1"], "A successful export still reads only the allowlisted plan key");
assert.deepEqual(valid.writes, [], "A successful export never mutates storage");

const futureSchema = harness({ raw: JSON.stringify([validPlan({ schemaVersion: 3 })]) });
futureSchema.hydrate();
assert.deepEqual(futureSchema.messages, [], "A future or unknown source plan schema is not silently reinterpreted");

const noNativeBridge = harness({ raw: JSON.stringify([validPlan()]), ios: false });
noNativeBridge.hydrate();
assert.deepEqual(noNativeBridge.messages, [], "Agenda snapshots are sent only through the iOS bridge");
assert.deepEqual(noNativeBridge.reads, [], "Non-iOS pages do not even read plan memory for native Agenda export");

const saveStart = planner.indexOf("function savePlanMemories()");
const saveEnd = planner.indexOf("\nfunction planIsoDateOffset", saveStart);
assert.match(planner.slice(saveStart, saveEnd), /publishLegacyAgendaSnapshot\(\)/,
  "Every successful durable plan-memory save refreshes the read-only Agenda projection");
const hydrationStart = planner.indexOf("function markPlanWatchMemoryInventoryReady()");
const hydrationEnd = planner.indexOf("\nfunction readPlanWatchNotificationPlans", hydrationStart);
assert.match(planner.slice(hydrationStart, hydrationEnd), /markLegacyAgendaMemoryHydrated\(\)/,
  "Initial Agenda export waits for the existing authoritative plan-memory hydration point");

console.log("PASS Legacy Agenda exporter: strict read-only iOS bridge projection");
