import assert from "node:assert/strict";
import {
  handlePlanWatchNotificationConfigRequest,
  handlePlanWatchNotificationRegisterRequest,
  handlePlanWatchNotificationUnregisterRequest,
  planWatchWindowMsForTimeZone,
  rollNativePlanWatchRoutine
} from "../workers/radar-capability.mjs";

const rows = new Map();
const env = {
  PLAN_WATCH_R2: {
    async put(key, value) { rows.set(key, JSON.parse(value)); },
    async get(key) { return rows.has(key) ? { json: async () => structuredClone(rows.get(key)) } : null; },
    async delete(key) { rows.delete(key); },
    async list({ prefix }) { return { objects: [...rows.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false }; }
  },
  PLAN_WATCH_TEST_TOKEN: "fixture-only",
  PLAN_WATCH_REGISTRATION_RATE_LIMITER: { limit: async () => ({ success: true }) },
  PLAN_WATCH_REGISTRATION_GLOBAL_RATE_LIMITER: { limit: async () => ({ success: true }) },
  PLAN_WATCH_APNS_TEAM_ID: "fixture-team",
  PLAN_WATCH_APNS_KEY_ID: "fixture-key",
  PLAN_WATCH_APNS_PRIVATE_KEY: "fixture-key-never-used",
  PLAN_WATCH_APNS_BUNDLE_ID: "app.nearcast.ios"
};
const nativeChannel = { token: "ab".repeat(32), environment: "production", bundleId: "app.nearcast.ios" };
const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
const plan = { id: "native-soccer", title: "Soccer", targetDate: tomorrow, startHour: 15.5, endHour: 17.25,
  timezone: "America/Los_Angeles", scheduleType: "single",
  windows: [{ id: "first", targetDate: tomorrow, startHour: 15.5, endHour: 17.25 }],
  place: { name: "Los Angeles", countryCode: "US", latitude: 34, longitude: -118 } };
const client = { owner: "native-v1", timezone: "America/Chicago", unit: "fahrenheit" };
const request = (payload) => new Request("https://getnearcast.app/api/watch/notifications/register", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
});
const register = async (payload) => {
  const result = await handlePlanWatchNotificationRegisterRequest(request(payload), env);
  return { status: result.status, body: await result.json() };
};
const unregister = async (payload) => {
  const result = await handlePlanWatchNotificationUnregisterRequest(request(payload), env);
  return { status: result.status, body: await result.json() };
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("No network or delivery belongs in this test"); };
try {
  const config = await (await handlePlanWatchNotificationConfigRequest(new Request("https://getnearcast.app/api/watch/notifications/config"), env)).json();
  assert.deepEqual(config.nativeOwnerScopes, ["native-v1"], "preflight advertises exact supported ownership scope");
  const legacy = await register({ nativeChannel, client: { timezone: "America/Chicago", unit: "fahrenheit" }, plans: [{ ...plan, id: "old-plan" }] });
  assert.equal(legacy.body.ok, true);
  assert.match(legacy.body.subscriptionId, /^ios-/);
  const legacyKey = [...rows.keys()].find((key) => key.includes(legacy.body.subscriptionId));
  const retainedLegacy = structuredClone(rows.get(legacyKey));
  const native = await register({ nativeChannel, client, plans: [plan] });
  assert.equal(native.body.ok, true);
  assert.equal(native.body.owner, "native-v1");
  assert.equal(native.body.planCount, 1);
  assert.match(native.body.subscriptionId, /^native-v1-/);
  assert.notEqual(native.body.subscriptionId, legacy.body.subscriptionId, "same device token cannot overwrite an earlier web-owned native channel");
  assert.deepEqual(rows.get(legacyKey), retainedLegacy, "fresh-native enrollment leaves old record byte-equivalent");
  const nativeKey = [...rows.keys()].find((key) => key.includes(native.body.subscriptionId));
  const stored = rows.get(nativeKey);
  assert.equal(stored.client.owner, "native-v1");
  assert.equal(stored.plans[0].timezone, "America/Los_Angeles", "plan timezone survives a different device timezone");
  const again = await register({ nativeChannel, client, plans: [{ ...plan, title: "Soccer updated" }] });
  assert.equal(again.body.subscriptionId, native.body.subscriptionId, "same native enrollment is idempotent");
  assert.equal(rows.get(nativeKey).plans[0].title, "Soccer updated");
  assert.equal((await register({ nativeChannel, client: { ...client, owner: "native-v2" }, plans: [plan] })).status, 400, "unknown owner never falls through to legacy");
  assert.equal((await register({ nativeChannel, client, plans: [{ ...plan, timezone: "invalid/zone" }] })).status, 400);
  assert.equal((await register({ nativeChannel, client, plans: [plan, plan] })).status, 400, "duplicate native plans are rejected atomically");
  assert.equal((await register({ nativeChannel, client, plans: [{ ...plan, routine: { weekdays: [7] } }] })).status, 400);
  const deniedDelete = await unregister({ nativeChannel, client, subscriptionId: legacy.body.subscriptionId });
  assert.equal(deniedDelete.status, 400, "native unsubscribe cannot target a legacy subscription ID");
  assert.deepEqual(rows.get(legacyKey), retainedLegacy);
  const deleted = await unregister({ nativeChannel, client, subscriptionId: native.body.subscriptionId });
  assert.equal(deleted.body.owner, "native-v1");
  assert.equal(deleted.body.state, "deleted");
  assert.equal(rows.has(nativeKey), false);
  assert.deepEqual(rows.get(legacyKey), retainedLegacy, "native unsubscribe never removes prior subscription");

  const oldAnchor = "2025-01-06";
  const weekly = await register({ nativeChannel, client, plans: [{ ...plan, targetDate: oldAnchor,
    windows: [{ id: "original", targetDate: oldAnchor, startHour: 15.5, endHour: 17.25 }], routine: { weekdays: [1, 3] } }] });
  assert.equal(weekly.body.ok, true, "a durable weekly anchor does not expire after its first week");
  const routine = rows.get(nativeKey).plans[0];
  assert.equal(routine.routine.startDate, oldAnchor);
  assert.deepEqual(routine.routine.weekdays, [1, 3]);
  assert.ok(routine.targetDate > oldAnchor);
  console.log("PASS native notification ownership: preflight, isolation, validation, receipts, unregister and durable enrollment");
} finally { globalThis.fetch = originalFetch; }

const nativeClient = { owner: "native-v1" };
const base = { ...plan, targetDate: "2026-09-14", startHour: 15.5, endHour: 17.25,
  windows: [{ id: "old", targetDate: "2026-09-14", startHour: 15.5, endHour: 17.25 }],
  routine: { weekdays: [1, 3], startDate: "2026-09-01" },
  lastKnown: { eventKey: "old-weather", snapshot: { rainChance: 50 } } };
const monday = rollNativePlanWatchRoutine(base, nativeClient, new Date("2026-09-21T20:00:00Z"));
assert.equal(monday.targetDate, "2026-09-21");
assert.equal(monday.windows.length, 1);
assert.equal(monday.lastKnown.snapshot, null, "new occurrence cannot inherit last week's weather-change baseline");
assert.equal(rollNativePlanWatchRoutine(monday, nativeClient, new Date("2026-09-21T23:00:00Z")), monday, "current occurrence remains stable while in progress");
const wednesday = rollNativePlanWatchRoutine(monday, nativeClient, new Date("2026-09-22T01:00:00Z"));
assert.equal(wednesday.targetDate, "2026-09-23", "weekly watch moves to next occurrence when previous window ends");
assert.equal(rollNativePlanWatchRoutine(base, {}, new Date("2026-09-21T20:00:00Z")), base, "legacy plans are never rolled or adopted");
const zoned = planWatchWindowMsForTimeZone(monday, monday.timezone);
assert.equal(new Date(zoned.startMs).toISOString(), "2026-09-21T22:30:00.000Z", "half-hour plan uses Los Angeles civil time, not device Chicago time");
assert.equal(new Date(zoned.endMs).toISOString(), "2026-09-22T00:15:00.000Z", "fractional-hour end remains exact");
const spring = { ...base, timezone: "America/Chicago", targetDate: "2026-03-01", startHour: 2.5, endHour: 3.5,
  routine: { weekdays: [0], startDate: "2026-03-01" },
  windows: [{ targetDate: "2026-03-01", startHour: 2.5, endHour: 3.5 }] };
const rolledSpring = rollNativePlanWatchRoutine(spring, nativeClient, new Date("2026-03-08T06:00:00Z"));
assert.equal(rolledSpring.targetDate, "2026-03-15", "nonexistent DST clock time is skipped, not silently moved");
assert.equal(planWatchWindowMsForTimeZone({ windows: [{ targetDate: "2026-03-08", startHour: 2.5, endHour: 3.5 }] }, "America/Chicago"), null);
assert.equal(planWatchWindowMsForTimeZone({ windows: [{ targetDate: "2026-02-30", startHour: 1, endHour: 2 }] }, "UTC"), null);
console.log("PASS native weekly evaluation: occurrence rollover, baseline reset, remote timezone, fractional hours and DST safety");
