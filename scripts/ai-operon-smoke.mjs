import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, * as wasm from "../vendor/operon/operon_core.js";
import { createBrowserDriver } from "../vendor/operon/driver.js";
import { normalizeProviderCitations } from "../operon-runtime.js";
import {
  PLAN_INTENT_OUTPUT_SCHEMA,
  SUMMARY_OUTPUT_SCHEMA,
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

console.log("AI Operon smoke passed");
