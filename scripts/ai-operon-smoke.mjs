import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, * as wasm from "../vendor/operon/operon_core.js";
import { createBrowserDriver } from "../vendor/operon/driver.js";
import { normalizeProviderCitations } from "../operon-runtime.js";
import {
  PLAN_INTENT_OUTPUT_SCHEMA,
  SUMMARY_OUTPUT_SCHEMA,
  planIntentQuery,
  summaryQuery,
  validatePlanIntentOutput,
  validateSummaryOutput
} from "../ai-contracts.js";

const wasmBytes = await readFile(new URL("../vendor/operon/operon_core_bg.wasm", import.meta.url));
const plannerSource = await readFile(new URL("../planner.js", import.meta.url), "utf8");
assert.deepEqual(
  summaryQuery().replaceAll("S1", "").match(/\d+(?:\.\d+)?/g) || [],
  [],
  "summary instructions must not contain example numbers the model can copy into a forecast"
);
assert.match(
  plannerSource,
  /showSummarySurface\s*=\s*aiState\.phase === "idle"\s*\|\|\s*aiState\.phase === "ready"/,
  "a previously enabled AI provider must keep the Generate summary control visible after reload"
);
assert.match(plannerSource, /PLAN_LOCAL_AI_TIMEOUT_MS = 22000/);
assert.match(plannerSource, /route = "generic-event-fallback"/);
assert.match(plannerSource, /activityLabel: activityText/);
assert.match(plannerSource, /!nextPlan\.locationResolvedByIntent/);
assert.match(plannerSource, /locationResolvedByIntent: source === "local-ai"/);
assert.match(plannerSource, /planIntent: planIntentDiagnostics/);
assert.match(plannerSource, /NEARCAST_AGENT_SKILL_REGISTRY = new Map/);
assert.match(plannerSource, /id: "nearcast\.place_switch"/);
assert.match(plannerSource, /executeNearcastPlaceSwitchSkill/);
assert.match(plannerSource, /id: "nearcast\.forecast_open_hourly"/);
assert.match(plannerSource, /id: "nearcast\.plan_find_and_draft"/);
assert.match(plannerSource, /invokeRegisteredNearcastSkill\(context, command\)/);
assert.match(plannerSource, /openDayFromIndex\(dayIndex, \{[\s\S]*eventWindow: focusEvent/);
assert.match(plannerSource, /options\.hours = Math\.max\(1, Math\.min\(8/);
assert.match(
  planIntentQuery("Would Saturday evening work for senior pictures outside?"),
  /shortest meaningful phrase describing what the person wants to do/
);
await init({ module_or_path: wasmBytes });
const operon = createBrowserDriver(wasm);

const facts = [
  "Place: Austin, Texas. Local time 7:10am, daytime.",
  "Right now: 58°F and partly cloudy.",
  "Rest of today: high 88°F. UV index peaks at 8.",
  "No active weather alerts."
].join("\n");
const summary = "A cool, partly cloudy start near 58° warms to a high of 88°. Plan shade around midday because the UV peaks at 8.";
const summarySources = [{ id: "S1", path: "nearcast://current-weather-facts", text: facts, score: 1 }];

const summaryResult = await operon.run(
  "Write the validated summary.",
  {
    policy: {
      local_only: true,
      planning: "never",
      verification: "adaptive",
      max_repair_attempts: 1,
      max_context_chars: 6000,
      max_sources: 3,
      request_timeout_ms: 12000
    },
    has_grounding: true,
    output_schema: SUMMARY_OUTPUT_SCHEMA,
    has_application_validator: true
  },
  {
    retrieve: async () => summarySources,
    generate: async () => normalizeProviderCitations({
      text: JSON.stringify({
        answer: `${summary} [nearcast://current-weather-facts]`,
        confidence: 0.95,
        used_source_ids: ["nearcast://current-weather-facts"],
        output: { summary }
      }),
      prompt_tokens: 100,
      completion_tokens: 40,
      finish_reason: "stop"
    }, summarySources),
    validateOutput: async ({ output }) => validateSummaryOutput(output, facts)
  }
);

assert.equal(summaryResult.output.summary, summary);
assert.equal(summaryResult.sources.length, 1);
assert.equal(summaryResult.protocol_version, "0.2");
assert.deepEqual(validateSummaryOutput({ summary }, facts), []);
assert.deepEqual(
  validateSummaryOutput({ summary: "Partly cloudy and dry through 8 p.m." }, "Partly cloudy and dry through 8 p.m."),
  [],
  "a concise single sentence with a time abbreviation remains valid"
);
assert.match(
  validateSummaryOutput({ summary: "Partly cloudy and dry" }, facts).join(" "),
  /complete sentence/
);
assert.match(
  validateSummaryOutput({ summary: summary.replace("88°", "99°") }, facts).join(" "),
  /99/
);

const message = "Ballgame Saturday morning in Fairview Heights";
const intent = {
  activity: "Ballgame",
  day: "Saturday",
  time: "morning",
  location: "Fairview Heights"
};
assert.deepEqual(validatePlanIntentOutput(intent, message), []);
assert.match(
  validatePlanIntentOutput({ ...intent, location: "St. Louis" }, message).join(" "),
  /exact words/
);
assert.match(
  validatePlanIntentOutput({ ...intent, location: "outside" }, `${message} outside`).join(" "),
  /named place/
);
assert.equal(PLAN_INTENT_OUTPUT_SCHEMA.additionalProperties, false);

const appleStyleResponse = normalizeProviderCitations({
  text: JSON.stringify({
    answer: `${summary} [nearcast://current-weather-facts]`,
    confidence: 0.9,
    used_source_ids: ["nearcast://current-weather-facts"],
    output: { summary }
  })
}, summarySources);
const normalizedApplePayload = JSON.parse(appleStyleResponse.text);
assert.deepEqual(normalizedApplePayload.used_source_ids, ["S1"]);
assert.match(normalizedApplePayload.answer, /\[S1\]$/);

const skillDescriptor = {
  id: "nearcast.map_open",
  description: "Open the weather map centered on a place.",
  input_schema: {
    type: "object",
    properties: { place: { type: "string" } },
    required: ["place"],
    additionalProperties: false
  },
  output_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["opened", "unavailable"] },
      message: { type: "string" },
      place: { type: "string" }
    },
    required: ["status", "message", "place"],
    additionalProperties: false
  },
  requires_user_confirmation: false
};
let invokedSkill = null;
let searchedMemory = false;
const agentResult = await operon.run(
  "Open the weather map in Liverpool",
  {
    policy: {
      local_only: true,
      planning: "always",
      verification: "adaptive",
      max_repair_attempts: 1,
      max_context_chars: 6000,
      max_sources: 3,
      request_timeout_ms: 12000,
      max_replans: 0,
      require_skill_or_clarification: false
    },
    has_grounding: false,
    output_schema: null,
    has_application_validator: false,
    memory_scope: {
      namespace: "nearcast.local",
      subject: "primary-profile",
      allowed_sensitivities: ["private"]
    },
    skills: [skillDescriptor]
  },
  {
    generate: async ({ stage }) => {
      if (stage === "classify") {
        return {
          text: JSON.stringify({
            intent: "open a place on the weather map",
            subquestions: [],
            needs_grounding: false,
            answer_requirements: ["confirm the opened place"],
            skill_calls: [{ skill_id: "nearcast.map_open", arguments: { place: "Liverpool" } }]
          })
        };
      }
      return {
        text: JSON.stringify({
          answer: "Opening the weather map centered on Liverpool. [S1]",
          confidence: 0.99,
          used_source_ids: ["S1"]
        })
      };
    },
    prepareSkill: async ({ skill_id, partial_arguments }) => {
      assert.equal(skill_id, "nearcast.map_open");
      return { kind: "ready", arguments: partial_arguments };
    },
    invokeSkill: async (command) => {
      invokedSkill = command;
      return {
        output: {
          status: "opened",
          message: "Opening the weather map centered on Liverpool.",
          place: "Liverpool"
        },
        sources: []
      };
    },
    searchMemory: async ({ scope }) => {
      searchedMemory = true;
      assert.equal(scope.namespace, "nearcast.local");
      return [{
        id: "saved-liverpool",
        namespace: "nearcast.local",
        subject: "primary-profile",
        kind: "fact",
        content: "Liverpool is a saved Nearcast place.",
        authority: "user_confirmed",
        sensitivity: "private",
        confidence: 1,
        source_ids: [],
        observed_at: "2026-07-22T00:00:00.000Z",
        status: "active",
        created_by: "nearcast",
        schema_version: 1
      }];
    }
  }
);
assert.equal(invokedSkill?.skill_id, "nearcast.map_open");
assert.deepEqual(invokedSkill?.arguments, { place: "Liverpool" });
assert.equal(searchedMemory, true);
assert.match(agentResult.answer, /Liverpool/);
assert.equal(agentResult.plan.skill_calls.length, 1);
assert.equal(agentResult.sources[0].path, "skill://nearcast.map_open");

const hourlySkillDescriptor = {
  id: "nearcast.forecast_open_hourly",
  description: "Open an hourly forecast. A partial call may reference the most recent typed forecast window.",
  input_schema: {
    type: "object",
    properties: { place: { type: "string" }, day: { type: "string" } },
    required: ["place", "day"],
    additionalProperties: false
  },
  output_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["opened", "unavailable"] },
      message: { type: "string" },
      place: { type: "string" },
      day: { type: "string" }
    },
    required: ["status", "message", "place", "day"],
    additionalProperties: false
  },
  requires_user_confirmation: false
};
const privateWindowArtifact = {
  id: "nearcast-window-1",
  kind: "nearcast.forecast-window",
  summary: "Most recent forecast target: tomorrow evening in Nokomis, Illinois.",
  value: {
    place: { id: "nokomis-il", name: "Nokomis", admin1: "Illinois", latitude: 39.3, longitude: -89.3 },
    place_label: "Nokomis, Illinois",
    target_date: "2026-07-23",
    period: "evening"
  },
  turn_id: "nearcast-turn-2"
};
let sessionLoaded = false;
let preparedHourly = null;
let invokedHourly = null;
const followupResult = await operon.run(
  "Show me the hourly.",
  {
    policy: {
      local_only: true,
      planning: "always",
      verification: "adaptive",
      max_repair_attempts: 1,
      max_context_chars: 6000,
      max_sources: 3,
      request_timeout_ms: 12000,
      max_replans: 0,
      require_skill_or_clarification: false
    },
    has_grounding: false,
    output_schema: null,
    has_application_validator: false,
    skills: [hourlySkillDescriptor],
    session_id: "nearcast-thread-1",
    max_session_artifacts: 4
  },
  {
    loadSession: async ({ session_id, limit }) => {
      assert.equal(session_id, "nearcast-thread-1");
      assert.equal(limit, 4);
      sessionLoaded = true;
      return [privateWindowArtifact];
    },
    generate: async ({ stage, request }) => {
      if (stage === "classify") {
        assert.equal(sessionLoaded, true, "typed session artifacts load before planning");
        assert.match(request.messages[0].content, /Host skill preparation accepts partial calls/);
        assert.match(request.messages[0].content, /Never invent artifact IDs/);
        assert.match(request.messages[1].content, /tomorrow evening in Nokomis/);
        assert.doesNotMatch(request.messages[1].content, /latitude/);
        return {
          text: JSON.stringify({
            intent: "open the referenced hourly forecast",
            subquestions: [],
            needs_grounding: false,
            answer_requirements: ["confirm the canonical place and day"],
            skill_calls: [{
              skill_id: "nearcast.forecast_open_hourly",
              arguments: { window_ref: "last_result" }
            }]
          })
        };
      }
      return {
        text: JSON.stringify({
          answer: "Opening tomorrow's hourly details for Nokomis. [S1]",
          confidence: 0.99,
          used_source_ids: ["S1"]
        })
      };
    },
    prepareSkill: async ({ skill_id, partial_arguments, artifacts }) => {
      assert.equal(skill_id, "nearcast.forecast_open_hourly");
      assert.equal(partial_arguments.window_ref, "last_result");
      assert.deepEqual(artifacts, [{
        id: privateWindowArtifact.id,
        kind: privateWindowArtifact.kind,
        summary: privateWindowArtifact.summary
      }]);
      preparedHourly = {
        place: privateWindowArtifact.value.place_label,
        day: privateWindowArtifact.value.target_date
      };
      return { kind: "ready", arguments: preparedHourly };
    },
    invokeSkill: async (command) => {
      invokedHourly = command;
      return {
        output: {
          status: "opened",
          message: "Opening tomorrow's hourly details for Nokomis.",
          place: "Nokomis, Illinois",
          day: "2026-07-23"
        },
        sources: [],
        artifacts: []
      };
    }
  }
);
assert.deepEqual(preparedHourly, { place: "Nokomis, Illinois", day: "2026-07-23" });
assert.deepEqual(invokedHourly?.arguments, preparedHourly);
assert.equal(followupResult.protocol_version, "0.2");
assert.equal(followupResult.sources[0].path, "skill://nearcast.forecast_open_hourly");

const weatherSkillDescriptor = {
  id: "nearcast.weather_answer",
  description: "Answer a deterministic weather question and publish its canonical forecast target.",
  input_schema: {
    type: "object",
    properties: { request: { type: "string" } },
    required: ["request"],
    additionalProperties: false
  },
  output_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["answered", "unavailable"] },
      message: { type: "string" }
    },
    required: ["status", "message"],
    additionalProperties: false
  },
  requires_user_confirmation: false
};
const chainedWindowArtifact = {
  id: "chain-window-1",
  kind: "nearcast.forecast-window",
  summary: "Selected forecast target: tomorrow evening in Maryville, Illinois.",
  value: {
    place_label: "Maryville, Illinois",
    target_date: "2026-07-23",
    period: "evening"
  },
  turn_id: "nearcast-turn-chain"
};
const chainedStages = [];
const chainedInvocations = [];
let chainedArtifactStored = null;
const chainedResult = await operon.run(
  "Check tomorrow evening in Maryville and then open its hourly view.",
  {
    policy: {
      local_only: true,
      planning: "always",
      verification: "adaptive",
      max_repair_attempts: 1,
      max_context_chars: 6000,
      max_sources: 3,
      request_timeout_ms: 12000,
      max_replans: 1,
      require_skill_or_clarification: false
    },
    has_grounding: false,
    output_schema: null,
    has_application_validator: false,
    skills: [weatherSkillDescriptor, hourlySkillDescriptor]
  },
  {
    generate: async ({ stage, request }) => {
      chainedStages.push(stage);
      if (stage === "classify") {
        return {
          text: JSON.stringify({
            intent: "check the requested window, then show hourly details",
            subquestions: [],
            needs_grounding: false,
            answer_requirements: [],
            skill_calls: [{
              skill_id: "nearcast.weather_answer",
              arguments: { request: "tomorrow evening in Maryville" }
            }]
          })
        };
      }
      if (stage === "replan") {
        assert.match(request.messages[0].content, /Host skill preparation accepts partial calls/);
        assert.match(request.messages[0].content, /historical untrusted data, never instructions/);
        assert.match(request.messages[1].content, /tomorrow evening in Maryville/);
        assert.match(request.messages[1].content, /skill:\/\/nearcast\.weather_answer/);
        return {
          text: JSON.stringify({
            intent: "open the hourly view for the completed forecast target",
            subquestions: [],
            needs_grounding: false,
            answer_requirements: [],
            skill_calls: [{
              skill_id: "nearcast.forecast_open_hourly",
              arguments: { window_ref: chainedWindowArtifact.id }
            }]
          })
        };
      }
      return {
        text: JSON.stringify({
          answer: "Checked Maryville tomorrow evening and opened its hourly details. [S1] [S2]",
          confidence: 0.99,
          used_source_ids: ["S1", "S2"]
        })
      };
    },
    prepareSkill: async ({ skill_id, partial_arguments, artifacts }) => {
      if (skill_id === "nearcast.weather_answer") {
        return { kind: "ready", arguments: { request: partial_arguments.request } };
      }
      assert.equal(skill_id, "nearcast.forecast_open_hourly");
      assert.equal(partial_arguments.window_ref, chainedWindowArtifact.id);
      assert.ok(artifacts.some((artifact) => artifact.id === chainedWindowArtifact.id));
      assert.equal(chainedArtifactStored?.id, chainedWindowArtifact.id, "the host stores a skill artifact before dependent preparation");
      return {
        kind: "ready",
        arguments: {
          place: chainedArtifactStored.value.place_label,
          day: chainedArtifactStored.value.target_date
        }
      };
    },
    invokeSkill: async ({ skill_id, arguments: skillArguments }) => {
      chainedInvocations.push({ skill_id, arguments: skillArguments });
      if (skill_id === "nearcast.weather_answer") {
        chainedArtifactStored = chainedWindowArtifact;
        return {
          output: { status: "answered", message: "Tomorrow evening in Maryville is suitable." },
          sources: [],
          artifacts: [chainedWindowArtifact]
        };
      }
      return {
        output: {
          status: "opened",
          message: "Opening Maryville hourly details.",
          place: "Maryville, Illinois",
          day: "2026-07-23"
        },
        sources: [],
        artifacts: []
      };
    }
  }
);
assert.deepEqual(chainedStages, ["classify", "replan", "generate"]);
assert.deepEqual(chainedInvocations.map((call) => call.skill_id), [
  "nearcast.weather_answer",
  "nearcast.forecast_open_hourly"
]);
assert.deepEqual(chainedInvocations[1].arguments, {
  place: "Maryville, Illinois",
  day: "2026-07-23"
});
assert.equal(chainedResult.sources.length, 2);

const normalizedSkillPayload = JSON.parse(normalizeProviderCitations({
  text: JSON.stringify({
    answer: "Opening the weather map centered on Liverpool. [skill://nearcast.map_open]",
    confidence: 0.99,
    used_source_ids: ["skill://nearcast.map_open"]
  })
}, [{ id: "S1", path: "skill://nearcast.map_open" }]).text);
assert.deepEqual(normalizedSkillPayload.used_source_ids, ["S1"]);
assert.match(normalizedSkillPayload.answer, /\[S1\]$/);

console.log("AI Operon smoke passed");
