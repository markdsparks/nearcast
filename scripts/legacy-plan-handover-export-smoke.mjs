import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planner = fs.readFileSync(path.join(root, "planner.js"), "utf8");
const start = planner.indexOf("/* ---------- Native Agenda export (read-only legacy projection) ---------- */");
const end = planner.indexOf("\nfunction planMemoryFromEvent", start);
assert.ok(start >= 0 && end > start, "The Agenda/Plans exporter is a bounded planner.js section");
const exporter = planner.slice(start, end);

function plan(overrides = {}) {
  return {
    id: "soccer",
    kind: "plan",
    title: "Soccer",
    label: "Plan window",
    original: "Soccer after school",
    answer: "Dry enough to play.",
    place: {
      id: "home",
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

function harness({ rawPlans = JSON.stringify([plan()]), preference = "enabled", planSelection = { plans: { soccer: true } },
                   placeSelection = { enabled: true, selectedIds: ["home"], updatedAt: "2026-09-19T15:30:00.000Z" },
                   known = true, ios = true } = {}) {
  const reads = [];
  const writes = [];
  const messages = [];
  const entries = new Map([
    ["nearcast-plan-memory-v1", rawPlans],
    ["nearcast-plan-watch-notifications-v1", preference],
    ["nearcast-plan-watch-notification-plans-v1", planSelection == null ? null : JSON.stringify(planSelection)],
    ["nearcast-place-watch-notification-places-v1", placeSelection == null ? null : JSON.stringify(placeSelection)]
  ]);
  const bridge = ios ? { platform: "ios", postMessage(payload) { messages.push(payload); } } : { platform: "web", postMessage(payload) { messages.push(payload); } };
  const sandbox = {
    window: { NearcastNative: bridge },
    localStorage: {
      getItem(key) { reads.push(key); return entries.has(key) ? entries.get(key) : null; },
      setItem(key, value) { writes.push([key, value]); entries.set(key, value); }
    },
    PLAN_MEMORY_KEY: "nearcast-plan-memory-v1",
    PLAN_WATCH_NOTIFICATION_PREF_KEY: "nearcast-plan-watch-notifications-v1",
    PLAN_WATCH_NOTIFICATION_PLANS_KEY: "nearcast-plan-watch-notification-plans-v1",
    PLACE_WATCH_NOTIFICATION_PLACES_KEY: "nearcast-place-watch-notification-places-v1",
    planWatchInventoryIsKnown: () => known,
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
    normalizePlanMemory(value) { return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : null; },
    planIsoDateOffset(value, offset) {
      const date = new Date(`${value}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(exporter, sandbox, { filename: "planner.js:legacy-plan-handover-export" });
  vm.runInContext("legacyAgendaMemoryHydrated = true", sandbox);
  return {
    reads,
    writes,
    messages,
    publish() { return vm.runInContext("publishLegacyPlanHandoverSnapshot()", sandbox); }
  };
}

const valid = harness();
assert.equal(valid.publish(), true, "A complete known legacy inventory stages a handover snapshot");
assert.equal(valid.messages.length, 1);
assert.equal(valid.messages[0].type, "plans.handover.snapshot");
assert.deepEqual(Object.keys(valid.messages[0]).sort(), ["handover", "type"]);
const handover = valid.messages[0].handover;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(Object.keys(handover).sort(), ["capturedAt", "hydration", "notificationIntent", "owner", "plans", "version"]);
assert.equal(handover.version, 1);
assert.equal(handover.owner, "legacy");
assert.equal(handover.hydration, "ready");
assert.deepEqual(plain(handover.notificationIntent), {
  hydration: "ready",
  globalPreference: "enabled",
  selectedPlanIDs: ["soccer"],
  placeNotificationsEnabled: true,
  selectedPlaceIDs: ["home"],
  placeSelectionMode: "explicit"
});
assert.doesNotMatch(JSON.stringify(handover), /token|subscription|receipt|baseline/i,
  "Handover never includes delivery credentials or continuity state");
assert.deepEqual(valid.writes, [], "Read-only handover staging never repairs or writes legacy storage");

const empty = harness({ rawPlans: "[]", preference: null, planSelection: null, placeSelection: null });
assert.equal(empty.publish(), true, "An explicit empty, fully known Plans inventory is safe to stage");
assert.deepEqual(plain(empty.messages[0].handover.plans), []);
assert.deepEqual(plain(empty.messages[0].handover.notificationIntent), {
  hydration: "ready",
  globalPreference: "off",
  selectedPlanIDs: [],
  placeNotificationsEnabled: false,
  selectedPlaceIDs: [],
  placeSelectionMode: "default"
});

const unknown = harness({ known: false });
assert.equal(unknown.publish(), false, "Unknown notification hydration never becomes an empty/opt-out handover");
assert.deepEqual(unknown.messages, []);
assert.deepEqual(unknown.reads, [], "Unknown guard prevents reading partial plan or notification data");

const missingPlans = harness({ rawPlans: null });
assert.equal(missingPlans.publish(), false, "Missing plan storage is unavailable, not authoritative empty data");
assert.deepEqual(missingPlans.messages, []);

const malformedSelection = harness({ planSelection: { plans: { soccer: "yes" } } });
assert.equal(malformedSelection.publish(), false, "Malformed selected-plan intent fails closed");
assert.deepEqual(malformedSelection.messages, []);

const danglingPlan = harness({ planSelection: { plans: { missing: true } } });
assert.equal(danglingPlan.publish(), false, "A selection outside the verified plan inventory fails closed");

const malformedPlaceSelection = harness({ placeSelection: { enabled: true, selectedIds: ["home", "home"] } });
assert.equal(malformedPlaceSelection.publish(), false, "Duplicate place selection does not get silently collapsed");

const pausedPlaceWatch = harness({ placeSelection: { enabled: false, selectedIds: ["home"] } });
assert.equal(pausedPlaceWatch.publish(), true, "A paused saved-place watch still has a complete inert handover record");
assert.equal(pausedPlaceWatch.messages[0].handover.notificationIntent.placeNotificationsEnabled, false,
  "A future native owner cannot mistake a paused place watch for the default active selection");
assert.deepEqual(plain(pausedPlaceWatch.messages[0].handover.notificationIntent.selectedPlaceIDs), ["home"],
  "The paused explicit choice remains available for a later user-approved migration");

const nonNative = harness({ ios: false });
assert.equal(nonNative.publish(), false, "Only the trusted iOS bridge receives a handover export");
assert.deepEqual(nonNative.reads, [], "Non-iOS pages do not read handover records");

for (const functionName of ["writePlanWatchNotificationPreference", "writePlanWatchNotificationPlans", "writePlaceWatchNotificationPlaces", "savePlanMemories"]) {
  const beginning = planner.indexOf(`function ${functionName}(`);
  const next = planner.indexOf("\nfunction ", beginning + 1);
  assert.ok(beginning >= 0 && next > beginning, `${functionName} exists`);
  assert.match(planner.slice(beginning, next), /publishLegacyPlanHandoverSnapshot\(\)/,
    `${functionName} refreshes the read-only handover receipt after a verified durable change`);
}

console.log("PASS Legacy Plans handover exporter: complete, inert, strict projection");
