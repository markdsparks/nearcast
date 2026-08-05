import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, planner, styles, truth] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "weather-truth.js"), "utf8")
]);

assert.match(planner, /function renderSavedPlanWatchConfirmation\(/, "a saved plan has a dedicated confirmation state");
assert.match(planner, /Nearcast is watching this[\s\S]*exact time and place/, "the save confirmation explains exactly what is being watched");
assert.match(planner, /Want a heads-up\?[\s\S]*Optional:[\s\S]*data-watch-notify/, "notification opt-in is an optional next step after the plan is saved");
assert.match(planner, /const watchAction = rememberedId[\s\S]*renderSavedPlanWatchConfirmation\(rememberedId\)[\s\S]*Watch this plan/, "the notification invitation cannot appear before watch creation");
assert.match(app, /bindTapDelegate\(els\.aiAsk,[^\n]*\[data-watch-notify\]/, "the post-save notification action works inside Plan Check");
assert.match(styles, /\.ask-watch-confirmation strong,[\s\S]*font-size: 1rem/, "the save confirmation uses readable type");
assert.match(styles, /\.ask-watch-next button,[\s\S]*min-height: 44px/, "the optional notification action has a full touch target");
assert.equal(Number(planner.match(/const PLAN_WATCH_MAX_NOTIFICATION_PLANS = (\d+)/)?.[1]), 3, "the client shares the server's three-plan notification cap");
assert.match(planner, /function cleanPlanWatchNotificationPlans\([\s\S]*!planWatchMemoryIsPast\(memory\)[\s\S]*slice\(0, PLAN_WATCH_MAX_NOTIFICATION_PLANS\)/, "legacy selections migrate to at most three active plans");
assert.match(app, /function init\(\) \{[\s\S]{0,500}markPlanWatchMemoryInventoryReady\(\)/, "notification-plan migration waits until app state has hydrated plan memories");
assert.match(planner, /function setPlanWatchNotificationPlan\([\s\S]*Object\.keys\(prefs\.plans\)\.length >= PLAN_WATCH_MAX_NOTIFICATION_PLANS[\s\S]*return false/, "a fourth notifying plan cannot be persisted");
assert.match(planner, /function planWatchNotificationSyncPlans\([\s\S]*slice\(0, PLAN_WATCH_MAX_NOTIFICATION_PLANS\)/, "subscription sync never sends more than three plans");
assert.match(planner, /function normalizePlanRoutine\([\s\S]*frequency !== "weekly"[\s\S]*weekday < 0 \|\| weekday > 6/, "a routine is a constrained weekly schedule rather than a second plan type");
assert.match(planner, /function planRoutineNextDate\([\s\S]*offset === 0[\s\S]*endHour[\s\S]*offset = 7/, "a completed same-day routine advances to its next weekly occurrence");
assert.match(planner, /function refreshPlanRoutineOccurrences\([\s\S]*windows: \[window\][\s\S]*savePlanMemories\(\)/, "the next routine occurrence is persisted into the existing plan model");
assert.match(planner, /function setPlanMemoryRoutine\([\s\S]*scheduleType === "single"[\s\S]*syncPlanWatchNotificationSubscription/, "routines reuse the existing one-window plan and notification pipeline");
assert.match(planner, /Make weekly routine/, "plan details offer a control to start a weekly routine");
assert.match(planner, /Stop weekly routine/, "plan details offer a clear reversible weekly-routine control");
assert.match(app, /data-memory-routine[\s\S]*setPlanMemoryRoutine/, "the plan detail control can enable or stop a routine");

const routineStart = planner.indexOf("function planIsoDateOffset(");
const routineEnd = planner.indexOf("function planWindowsFromSpan(", routineStart);
assert.ok(routineStart >= 0 && routineEnd > routineStart, "routine helpers can be isolated for timing tests");
const routineSandbox = {
  forecastLocalDate() { return "2026-08-03"; }, // Monday
  forecastCurrentHour() { return 10; }
};
vm.createContext(routineSandbox);
vm.runInContext(planner.slice(routineStart, routineEnd), routineSandbox);
const weeklyTuesday = { routine: { frequency: "weekly", weekday: 2 }, endHour: 18 };
assert.equal(
  routineSandbox.planRoutineNextDate(weeklyTuesday, {}),
  "2026-08-04",
  "a future same-week routine resolves to its next weekday"
);
routineSandbox.forecastCurrentHour = () => 19;
const weeklyMonday = { routine: { frequency: "weekly", weekday: 1 }, endHour: 18 };
assert.equal(
  routineSandbox.planRoutineNextDate(weeklyMonday, {}),
  "2026-08-10",
  "a completed routine advances by one week rather than appearing as past"
);
assert.match(planner, /label: "3-plan limit"[\s\S]*Up to three active plans can notify this device/, "a fourth plan explains the limit instead of offering a broken toggle");
assert.match(planner, /Three plans already notify you[\s\S]*Turn notifications off for another plan/, "post-save confirmation explains why a fourth plan remains in-app only");
assert.match(styles, /\.watch-notify-limit,[\s\S]*font-size: 0\.82rem/, "the plan limit is readable rather than micro copy");

// Exercise the real migration functions with startup storage. An empty
// pre-hydration state must never erase intent; once the plan inventory is
// authoritative, stale entries are removed before the three-plan cap applies.
const migrationStart = planner.indexOf("function cleanPlanWatchNotificationPlans(");
const migrationEnd = planner.indexOf("function planWatchNotificationPlanEnabled(", migrationStart);
assert.ok(migrationStart >= 0 && migrationEnd > migrationStart, "notification migration functions can be isolated for runtime testing");
const migrationSource = planner.slice(migrationStart, migrationEnd);
const migrationKey = "nearcast-plan-watch-notification-plans-v1";
const migrationStorage = new Map([
  [migrationKey, JSON.stringify({ plans: { stale: true, one: true, two: true, three: true, four: true } })]
]);
const migrationSandbox = {
  state: { planMemories: [] },
  localStorage: {
    getItem(key) {
      return migrationStorage.get(key) ?? null;
    },
    setItem(key, value) {
      migrationStorage.set(key, String(value));
    }
  },
  planWatchMemoryIsPast() {
    return false;
  }
};
vm.createContext(migrationSandbox);
vm.runInContext(`
  const PLAN_WATCH_NOTIFICATION_PLANS_KEY = ${JSON.stringify(migrationKey)};
  const PLAN_WATCH_MAX_NOTIFICATION_PLANS = 3;
  let planWatchMemoryInventoryReady = false;
  ${migrationSource}
`, migrationSandbox);

const beforeHydration = migrationSandbox.readPlanWatchNotificationPlans();
assert.equal(
  Object.keys(beforeHydration.plans).join(","),
  "stale,one,two,three,four",
  "pre-hydration reads preserve all stored notification selections"
);
assert.equal(
  Object.keys(JSON.parse(migrationStorage.get(migrationKey)).plans).join(","),
  "stale,one,two,three,four",
  "pre-hydration migration does not rewrite storage from an empty state"
);

migrationSandbox.state.planMemories = ["one", "two", "three", "four"].map((id) => ({ id }));
migrationSandbox.markPlanWatchMemoryInventoryReady();
assert.equal(
  Object.keys(JSON.parse(migrationStorage.get(migrationKey)).plans).join(","),
  "one,two,three",
  "post-hydration migration removes stale entries before retaining three active plans"
);

assert.match(app, /const unreviewed = ranked\.filter\([\s\S]*watch\?\.change/, "Today explicitly finds unreviewed watched-plan changes");
assert.match(app, /New forecast change[\s\S]*unreviewed/, "Today labels an unseen meaningful change rather than a generic plan warning");
assert.match(app, /Last checked \$\{checkedWhen\}/, "Today shows when the watched plan was last checked");
assert.match(app, /watchingOwnsPlanChange/, "the canonical watched-plan receipt wins over a duplicate continuity card");
assert.match(styles, /\.for-you-watch-check \{[\s\S]*font-size: 0\.78rem/, "watch freshness remains readable on Today");
assert.match(planner, /function homePlanExplicitlyExcludesExposure\([\s\S]*inside\|indoors/, "explicit indoor plans can opt out of outdoor exposure escalation");
assert.match(planner, /function homePlanSafetyAssessment\([\s\S]*feelsMaxF >= 100[\s\S]*uvMax >= 8/, "the home plan verdict escalates dangerous heat and UV instead of saying looks good");
assert.match(planner, /function planWatchItemForMemoryItem\([\s\S]*homePlanSafetyAssessment\(watch\)[\s\S]*resolvedWatch\.notification = planWeatherNotificationState\(resolvedWatch\)/, "all plan surfaces and notifications share the same safety-resolved decision");
assert.match(planner, /const resolvedWatch = \{[\s\S]*riskKind: safety\.riskKind,[\s\S]*label: safety\.label/, "the selected hazard kind propagates with the safety-resolved watch");
assert.match(planner, /function homePlanDecisionPriority\([\s\S]*changeDirection !== "better"[\s\S]*if \(actionNow\) return 5;[\s\S]*if \(active\) return 4;[\s\S]*futureHours >= 0 && futureHours <= 24[\s\S]*if \(changed \|\| alertAffectsPlan\) return 2;/, "plan promotion ranks action-now, active, next-day, then distant changes without treating an improvement as urgent");
assert.match(planner, /data-plan-state=[\s\S]*data-plan-risk=/, "the promoted plan exposes change and resulting-risk semantics to its styling layer");
assert.match(planner, /showPlace[\s\S]*samePlanPlace\(memory\.place, place\)[\s\S]*home-plan-place/, "the promoted plan omits a location that repeats the active place");
assert.match(planner, /scheduleType === "continuous_span"[\s\S]*startDay\} at[\s\S]*endDay\} at/, "continuous plan timing reads as a human date-and-time range");
assert.match(planner, /const when = planPulseWhenText\(memory, watch\.data \|\| data\)/, "the promoted plan renders the human timing text");
assert.match(planner, /function planWatchMetaText\([\s\S]*planPulseWhenText\([\s\S]*samePlace[\s\S]*filter\(Boolean\)\.join/, "the Plans destination shares human timing and omits a repeated active place");

const homeDecisionStart = planner.indexOf("function homePlanToneRank(");
const homeDecisionEnd = planner.indexOf("function planPulseWhenText(", homeDecisionStart);
assert.ok(homeDecisionStart >= 0 && homeDecisionEnd > homeDecisionStart, "home plan safety helpers can be isolated for runtime testing");
const homeDecisionSandbox = {
  planWeatherUnitFromItem(item) {
    return String(item?.units?.temp || "").includes("C") ? "celsius" : "fahrenheit";
  },
  planWatchRiskKind(item) {
    const stats = item?.stats || {};
    if ((stats.rainChance || 0) >= 35) return "rain";
    if ((stats.feelsMax ?? stats.feelsAvg ?? 0) >= 88 || (stats.uvMax || 0) >= 8) return "heat";
    return "good";
  }
};
vm.createContext(homeDecisionSandbox);
vm.runInContext(planner.slice(homeDecisionStart, homeDecisionEnd), homeDecisionSandbox);
const hotOutdoorPlan = vm.runInContext(`homePlanSafetyAssessment(${JSON.stringify({
  tone: "good",
  label: "Looks good",
  memory: { title: "Community event" },
  units: { temp: "°F", wind: "mph" },
  stats: { feelsMax: 97, uvMax: 8 }
})})`, homeDecisionSandbox);
assert.equal(hotOutdoorPlan.tone, "caution", "a hot outdoor plan cannot remain good");
assert.equal(hotOutdoorPlan.overridden, true);
assert.doesNotMatch(hotOutdoorPlan.label, /looks good/i);
const hotIndoorPlan = vm.runInContext(`homePlanSafetyAssessment(${JSON.stringify({
  tone: "good",
  label: "Looks good",
  memory: { title: "Indoor community event" },
  units: { temp: "°F", wind: "mph" },
  stats: { feelsMax: 97, uvMax: 8 }
})})`, homeDecisionSandbox);
assert.equal(hotIndoorPlan.tone, "good", "an explicitly indoor plan does not inherit outdoor exposure risk");
const mixedRainAndDangerousHeat = vm.runInContext(`homePlanSafetyAssessment(${JSON.stringify({
  tone: "caution",
  label: "Keep an eye on rain",
  memory: { title: "Community event" },
  units: { temp: "°F", wind: "mph" },
  stats: { rainChance: 40, feelsMax: 105, uvMax: 7 }
})})`, homeDecisionSandbox);
assert.equal(mixedRainAndDangerousHeat.riskKind, "heat", "a first-match rain classification cannot hide dangerous heat");
assert.equal(mixedRainAndDangerousHeat.tone, "watch");
assert.equal(mixedRainAndDangerousHeat.label, "Heat needs attention");
assert.equal(vm.runInContext("homePlanDecisionPriority({ active: true, hoursUntil: -1, changed: false, changeDirection: '', alertAffectsPlan: false, tone: 'good', riskKind: 'good' })", homeDecisionSandbox), 4);
assert.equal(vm.runInContext("homePlanDecisionPriority({ active: false, hoursUntil: 12, changed: false, changeDirection: '', alertAffectsPlan: false, tone: 'good', riskKind: 'good' })", homeDecisionSandbox), 3);
assert.equal(vm.runInContext("homePlanDecisionPriority({ active: false, hoursUntil: 48, changed: true, changeDirection: 'worse', alertAffectsPlan: false, tone: 'good', riskKind: 'good' })", homeDecisionSandbox), 2);
assert.equal(vm.runInContext("homePlanDecisionPriority({ active: false, hoursUntil: 2, changed: true, changeDirection: 'better', alertAffectsPlan: false, tone: 'good', riskKind: 'good' })", homeDecisionSandbox), 3, "a better forecast remains a next-day item, not an action-now warning");

assert.match(planner, /const PLAN_WATCH_PUSH_HEALTH_KEY/, "notification delivery health persists locally");
assert.match(planner, /pushLastAttemptAt:[\s\S]*pushLastAttemptState:[\s\S]*pushLastSuccessAt:/, "attempt and success are distinct delivery facts");
assert.match(planner, /function beginPlanWatchRegistrationAttempt\([\s\S]*lastAttemptState: "pending"/, "a registration attempt is visible before it is confirmed");
assert.match(planner, /function completePlanWatchRegistrationAttempt\([\s\S]*pushLastSuccessAt = now/, "only a successful registration advances last success");
assert.match(planner, /label: "Last attempt"[\s\S]*label: "Last success"/, "Watching shows both the latest attempt and latest confirmed sync");
assert.match(planner, /The last registration attempt failed[\s\S]*no successful sync yet/, "failed setup is described honestly instead of appearing ready");
assert.match(planner, /data-watch-notify-retry/, "degraded delivery offers a retry without pausing the plan");
assert.match(planner, /const PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS = 5 \* 60 \* 1000/, "readiness renews with a small five-minute expiry skew");
assert.match(planner, /registrationExpiresAt: planWatchRegistrationExpiryTimestamp\(parsed\?\.registrationExpiresAt\)/, "server registration expiry survives an app restart");
assert.match(planner, /function planWatchRegistrationHealth\([\s\S]*expiresAt <= now \+ PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS[\s\S]*stateValue = "expired"/, "an expired registration cannot remain ready");
assert.match(planner, /function planWatchRegistrationResultSucceeded\([\s\S]*result\.expiresAt[\s\S]*expiresAt > Date\.now\(\) \+ PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS/, "a register response is successful only with a usable future expiry");
assert.match(planner, /Notification registration expired[\s\S]*Renew delivery/, "expired delivery has an explicit renewal state and action");

assert.match(planner, /PLAN_IMPLICIT_LOCATION_DROP_WORDS = new Set\([\s\S]*"hour", "hours", "hr", "hrs", "minute", "minutes", "min", "mins"/, "duration words cannot be mistaken for an implicit city");

assert.match(truth, /receipt: change\.receipt \|\| null/, "server notifications carry a structured change receipt");
assert.match(planner, /source: "plan-watch",[\s\S]*receipt\n/, "local notifications also carry the exact receipt");
assert.match(planner, /receiptAction[\s\S]*receipt\.action/, "the deep link preserves the recommended action");
assert.match(planner, /capturePlanWatchRouteReceipt\(route\)[\s\S]*openPlanWatchForMemory/, "a notification restores its receipt before opening the watched plan");
assert.match(planner, /receiptChange\?\.receipt\?\.action[\s\S]*What to do/, "the focused receipt surfaces the exact recommended action");

for (const event of [
  "notification-opt-in",
  "notification-registration-ready",
  "notification-registration-failed",
  "notification-open",
  "watch-change-reviewed"
]) {
  assert.ok(app.includes(`"${event}"`), `${event} is allowlisted for aggregate measurement`);
  assert.ok(planner.includes(`"${event}"`), `${event} is emitted at its product transition`);
}

console.log("Trust Loop smoke passed.");
