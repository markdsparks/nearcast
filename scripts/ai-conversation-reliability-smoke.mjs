import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ai = await readFile(new URL("../ai.js", import.meta.url), "utf8");
const planner = await readFile(new URL("../planner.js", import.meta.url), "utf8");
const runSource = ai.slice(ai.indexOf("export async function runAgent("))
  .replace(/^export /, "");
const sandbox = vm.createContext({
  load: async () => {}, provider: { kind: "apple" }, lastRun: null,
  nativeAI: () => sandbox.bridge
});
vm.runInContext(runSource, sandbox);
let calls = 0;
let received;
sandbox.bridge = { runAgent: async (request) => {
  calls += 1;
  received = request;
  return { ok: true, terminal: { result: { status: "completed" } } };
} };
// The final action/state must survive the old 1,800-character boundary.
const compound = "Please check the following weather request. ".repeat(50) +
  "Switch to Hardin, Kentucky, and open next Tuesday's hourly forecast.";
await sandbox.runAgent({ query: compound });
assert.equal(received.query, compound);
await assert.rejects(sandbox.runAgent({ query: "a".repeat(12001) }),
  (error) => error.code === "context-limit");
assert.equal(calls, 1, "oversized requests never reach inference or tools");

for (const reason of ["model-not-ready", "model-busy", "unsupported-language", "context-limit", "generation-failed"]) {
  sandbox.bridge.runAgent = async () => ({ ok: false, reason, message: `Recovery for ${reason}` });
  await assert.rejects(sandbox.runAgent({ query: "What about tomorrow?" }),
    (error) => error.code === reason && error.message === `Recovery for ${reason}` && error.invokedSkills === 0);
}
let actions = 0;
sandbox.bridge.runAgent = async (_request, handlers) => {
  await handlers.invokeSkill({ skillId: "nearcast.place_switch" });
  return { ok: false, reason: "generation-failed", message: "Try again." };
};
await assert.rejects(sandbox.runAgent({ query: "Switch places and open hourly", invokeSkill: async () => { actions += 1; } }),
  (error) => error.invokedSkills === 1);
assert.equal(actions, 1);
sandbox.bridge.runAgent = async (_request, handlers) => {
  await handlers.invokeSkill({ skillId: "nearcast.place_switch" });
  throw new Error("bridge disconnected");
};
await assert.rejects(sandbox.runAgent({ query: "Switch places", invokeSkill: async () => {} }),
  (error) => error.code === "bridge-failed" && error.invokedSkills === 1);
sandbox.bridge.runAgent = async () => ({ ok: false, reason: "cancelled" });
assert.equal((await sandbox.runAgent({ query: "Open hourly" })).status, "cancelled");

const artifactsSource = planner.slice(planner.indexOf("function nearcastAgentArtifactsForTurn("),
  planner.indexOf("function loadNearcastAgentSession("));
const context = vm.createContext({
  Date,
  state: { activePlace: { name: "Maryville", state: "Illinois" } },
  normalizePlace: (place) => place,
  placeLabel: (place) => `${place.name}, ${place.state}`,
  NEARCAST_AGENT_ARTIFACT_LIMIT: 8,
  NEARCAST_AGENT_ARTIFACT_KINDS: { place: "place", window: "window" },
  nearcastAgentSessionArtifacts: [
    { id: "old-place", kind: "place", value: { place: { name: "Nokomis" } } },
    { id: "expired", kind: "window", expires_at: "2000-01-01" },
    { id: "exact-window", kind: "window", value: { date: "2026-09-19", start: "18:00", end: "20:00" } }
  ],
  nearcastRecentTurnArtifacts: () => [
    { id: "chat-1", kind: "recent-turn" }, { id: "chat-2", kind: "recent-turn" }
  ]
});
vm.runInContext(artifactsSource, context);
let result = context.nearcastAgentArtifactsForTurn(2, 1);
assert.equal(result[0].value.place.state, "Illinois", "a minimal session keeps the selected place");
result = context.nearcastAgentArtifactsForTurn(2, 2);
assert.deepEqual(Array.from(result, (item) => item.id), ["exact-window", "nearcast-active-place"]);
assert.equal(result[0].value.start, "18:00", "exact time survives instead of answer prose");
assert.ok(!context.nearcastAgentArtifactsForTurn(2, 8).some((item) => item.id === "expired"));
assert.match(planner, /modelFailure\?\.invokedSkills > 0/, "partial actions cannot replay through fallback");
const askSource = planner.slice(planner.indexOf("async function runAsk("), planner.indexOf("async function runMemoryEdit("));
let fallbackCalls = 0;
let answer;
const ask = vm.createContext({
  aiState: { phase: "ready" }, askStreaming: false, askError: "",
  plannerClarification: null, plannerEditingMemoryId: null, planIntentDiagnostics: {},
  setNearcastAISurfaceMode: () => {}, startNearcastRun: () => ({ signal: {} }),
  nearcastRunIsCurrent: () => true, beginAskResponse: () => 0,
  finishAskResponse: (_row, response) => { answer = response; },
  cleanError: (error) => error.message,
  runNearcastDirectNavigation: async () => { fallbackCalls++; return null; },
  runNearcastDirectConfidenceAnswer: async () => null,
  runNearcastDirectWeatherAnswer: async () => null,
  answerPlanRequest: async () => { throw new Error("Must not reinterpret model failure as a plan"); }
});
vm.runInContext(askSource, ask);
for (const [code, invokedSkills] of [["context-limit", 0], ["generation-failed", 1]]) {
  fallbackCalls = 0;
  ask.runNearcastAgent = async () => { throw Object.assign(new Error("Model recovery"), { code, invokedSkills }); };
  await ask.runAsk("Switch place and open hourly");
  assert.equal(fallbackCalls, 0, "no fallback action after oversized request or partial execution");
  assert.match(answer, invokedSkills ? /Some actions may already be complete/ : /Model recovery/);
}
ask.runNearcastAgent = async () => { throw Object.assign(new Error("AI is getting ready"), { code: "model-not-ready", invokedSkills: 0 }); };
await ask.runAsk("Could you help with my weekend?");
assert.equal(answer, "AI is getting ready", "an infrastructure error does not become a missing-city clarification");
ask.runNearcastDirectNavigation = async () => ({ answer: "Opening hourly", navigation: {} });
ask.scheduleNearcastAgentNavigation = async () => {};
await ask.runAsk("Open hourly");
assert.equal(answer.answer, "Opening hourly", "safe direct navigation still works without the model");
const native = await readFile(new URL("../native/ios/NearcastApp/Bridge/NativeLanguageModelController.swift", import.meta.url), "utf8");
assert.match(native, /tokenCount\(for: schema\)/);
assert.match(native, /count \+ outputBudget \+ 256 <= model.contextSize/);
assert.match(native, /if #available\(iOS 26.4, \*\)/);
console.log("AI conversation reliability passed (bridge, context, and safety contracts; not model accuracy).");
