import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../planner.js", import.meta.url), "utf8");
function declaration(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
const kinds = { place: "place", window: "window", plan: "plan", view: "view", hourlyView: "view.hourly", dayView: "view.day" };
const hardin = { name: "Hardin", state: "Kentucky" };
const dates = ["2026-09-22", "2026-09-23", "2026-09-24"];
const navigations = [];
let modelCalls = 0;
let answer;
const test = vm.createContext({
  Date, state: { activePlace: hardin, forecast: { daily: { time: dates } } },
  NEARCAST_AGENT_ARTIFACT_KINDS: kinds, nearcastAgentSessionArtifacts: [],
  samePlanPlace: (a, b) => a?.name === b?.name && a?.state === b?.state,
  placeLabel: (place) => `${place.name}, ${place.state}`,
  nearcastHourlyDayContext: () => ({}),
  resolveDayIndex: (day) => /tuesday/i.test(day) ? 0 : /wednesday/i.test(day) ? 1 : /thursday/i.test(day) ? 2 : null,
  formatDay: (date) => date,
  nearcastArtifactForPreparation: (_ctx, kind) => test.nearcastAgentSessionArtifacts.find((item) => item.kind === kind),
  ensureNearcastSkillPlace: async (label) => {
    assert.equal(label, "Hardin, Kentucky");
    return hardin;
  },
  nearcastWindowArtifact: (place, window) => ({ kind: kinds.window, value: {
    place, target_date: dates[window.dayIdx], start_hour: window.startHour,
    end_hour: window.endHour, period: window.period
  } }),
  nearcastPlaceArtifact: (place) => ({ kind: kinds.place, value: { place } }),
  nearcastViewArtifacts: (view, place, _ctx, window) => [{ kind: kinds.view, value: {
    view, place, target_date: window.value.target_date
  } }],
  nearcastSkillResult: (output, artifacts) => ({ output, artifacts }),
  aiState: { phase: "ready" }, askStreaming: false, askError: "",
  plannerClarification: null, plannerEditingMemoryId: null, planIntentDiagnostics: {},
  setNearcastAISurfaceMode: () => {}, startNearcastRun: () => ({ signal: {} }),
  nearcastRunIsCurrent: () => true, beginAskResponse: () => 0,
  finishAskResponse: (_row, value) => { answer = value; },
  scheduleNearcastAgentNavigation: async (navigation) => navigations.push(navigation),
  cleanError: (error) => error.message
});
for (const name of ["nearcastExplicitDayText", "nearcastDayViewFollowup", "nearcastCompletionForQuestion", "executeNearcastHourlyOpenSkill", "runAsk"]) {
  vm.runInContext(declaration(name), test);
}
async function open(args) {
  const context = { receipt: {}, preparedSkillState: new Map() };
  const result = await test.executeNearcastHourlyOpenSkill(args, context);
  test.nearcastAgentSessionArtifacts = result.artifacts;
  return { ...context.receipt, skillCalls: 1 };
}
test.runNearcastAgent = async () => {
  modelCalls++;
  return open({ place: "Hardin, Kentucky", day: "next Tuesday" });
};
test.runNearcastDirectNavigation = async (question) => {
  const command = test.nearcastDayViewFollowup(question);
  assert.equal(command.skillId, "nearcast.forecast_open_hourly");
  return open(command.arguments);
};
await test.runAsk("Switch to Hardin Kentucky and show next Tuesday’s hourly forecast.");
assert.equal(navigations.at(-1).dayIndex, 0);
assert.equal(test.nearcastCompletionForQuestion("What about Wednesday?").required_artifact_kinds[0], "view.hourly");
await test.runAsk("What about Wednesday?");
assert.equal(modelCalls, 1, "the exact continuation cannot be misrouted by a second model call");
assert.equal(navigations.at(-1).type, "hourly");
assert.equal(navigations.at(-1).dayIndex, 1);
assert.match(answer.answer, /2026-09-23.*Hardin, Kentucky/);
await test.runAsk("And Thursday?");
assert.equal(navigations.at(-1).dayIndex, 2);
for (const question of ["What about rain Wednesday?", "Watch Wednesday", "What about Wednesday in Missouri?", "What about Wednesday for golf?"]) {
  assert.equal(test.nearcastDayViewFollowup(question), null, question);
}
test.nearcastAgentSessionArtifacts.push({ kind: kinds.window, value: { place: hardin } });
assert.equal(test.nearcastDayViewFollowup("What about Wednesday?"), null, "a newer weather discussion supersedes navigation");
test.nearcastAgentSessionArtifacts = [{ kind: kinds.view, value: { view: "day", place: hardin } }];
assert.equal(test.nearcastDayViewFollowup("What about Wednesday?").skillId, "nearcast.forecast_open_day");
test.state.activePlace = { name: "Maryville", state: "Illinois" };
assert.equal(test.nearcastDayViewFollowup("What about Wednesday?"), null, "no stale place after switching outside chat");
test.nearcastAgentSessionArtifacts = [];
assert.equal(test.nearcastDayViewFollowup("What about Wednesday?"), null, "new chat has no inherited navigation");
console.log("AI day follow-up passed: exact Tuesday → Wednesday → Thursday flow, place and intent boundaries.");
