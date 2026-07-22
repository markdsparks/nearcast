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
assert.equal(summaryResult.protocol_version, "0.1");
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
      request_timeout_ms: 12000
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
