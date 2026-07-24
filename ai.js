// Nearcast's private model layer. Operon owns structured orchestration,
// verification, and bounded repair. Inference routes to Apple's system model
// in the native app when available, otherwise to Qwen in a WebGPU worker.
import { CreateWebWorkerMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.84";
import { runOperon } from "./operon-runtime.js?v=3.0.312";
import {
  PLAN_INTENT_OUTPUT_SCHEMA,
  SUMMARY_OUTPUT_SCHEMA,
  outputFromOperonResult,
  planIntentQuery,
  summaryQuery,
  summarySource,
  validatePlanIntentOutput,
  validateSummaryOutput
} from "./ai-contracts.js?v=3.0.312";

const WEB_MODEL = "Qwen3-0.6B-q4f16_1-MLC";
const WEB_APP_CONFIG = {
  cacheBackend: "cache",
  model_list: [{
    model: "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC",
    model_id: WEB_MODEL,
    model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm",
    low_resource_required: true,
    required_features: ["shader-f16"],
    overrides: { context_window_size: 4096 }
  }]
};
const AI_ASSET_VERSION = "3.0";

let engine = null;
let loading = null;
let provider = null;
let lastRun = null;

function nativeAI() {
  const bridge = globalThis.NearcastNative?.ai;
  return bridge && typeof bridge.availability === "function" && typeof bridge.generate === "function"
    ? bridge
    : null;
}

export async function nativeAvailability() {
  const bridge = nativeAI();
  if (!bridge) return { available: false, reason: "native-bridge-unavailable" };
  try {
    const result = await bridge.availability();
    return {
      available: result?.available === true,
      reason: String(result?.reason || (result?.available ? "available" : "unknown")),
      model: String(result?.model || "apple-system-language-model")
    };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function loadWebModel(onProgress) {
  if (engine) return engine;
  const workerUrl = new URL("./ai-worker.js", import.meta.url);
  workerUrl.searchParams.set("v", AI_ASSET_VERSION);
  engine = await CreateWebWorkerMLCEngine(
    new Worker(workerUrl, { type: "module" }),
    WEB_MODEL,
    { appConfig: WEB_APP_CONFIG, initProgressCallback: onProgress }
  );
  return engine;
}

// Idempotent provider selection. Apple is preferred because its model is
// already device-managed; WebLLM remains the private cross-platform fallback.
export function load(onProgress) {
  if (provider) return Promise.resolve(provider);
  if (loading) return loading;
  loading = (async () => {
    const native = await nativeAvailability();
    if (native.available) {
      provider = { kind: "apple", model: native.model };
      onProgress?.({ progress: 1, text: "Apple on-device model ready" });
      return provider;
    }
    await loadWebModel(onProgress);
    provider = { kind: "webllm", model: WEB_MODEL };
    return provider;
  })().catch((error) => {
    loading = null;
    provider = null;
    throw error;
  });
  return loading;
}

export function isLoaded() {
  return Boolean(provider);
}

export function providerInfo() {
  return provider ? { ...provider, operon: true, lastRun } : null;
}

function generationResult(text, usage = {}) {
  return {
    text: String(text || ""),
    prompt_tokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
    completion_tokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
    finish_reason: usage.finish_reason || null
  };
}

async function generateWithApple(request, signal) {
  if (signal?.aborted) throw new Error("Generation cancelled");
  const bridge = nativeAI();
  if (!bridge) throw new Error("Apple model bridge became unavailable");
  const result = await bridge.generate({
    messages: request.messages,
    schema: request.schema,
    temperature: request.temperature,
    maximumResponseTokens: request.max_tokens || 280
  });
  if (signal?.aborted) throw new Error("Generation cancelled");
  if (!result?.ok) throw new Error(result?.message || result?.reason || "Apple model generation failed");
  return generationResult(result.text, {
    prompt_tokens: result.promptTokens,
    completion_tokens: result.completionTokens,
    finish_reason: result.finishReason || "stop"
  });
}

async function generateWithWebLLM(request, signal) {
  if (signal?.aborted) throw new Error("Generation cancelled");
  const eng = await loadWebModel();
  const completion = await eng.chat.completions.create({
    stream: false,
    temperature: request.temperature,
    max_tokens: request.max_tokens || 280,
    response_format: request.schema ? {
      type: "json_object",
      schema: JSON.stringify(request.schema)
    } : undefined,
    extra_body: { enable_thinking: false },
    messages: request.messages
  });
  if (signal?.aborted) {
    try { await eng.interruptGenerate(); } catch (_) {}
    throw new Error("Generation cancelled");
  }
  return generationResult(completion.choices?.[0]?.message?.content, {
    prompt_tokens: completion.usage?.prompt_tokens,
    completion_tokens: completion.usage?.completion_tokens,
    finish_reason: completion.choices?.[0]?.finish_reason
  });
}

async function generate(request, signal) {
  const selected = await load();
  return selected.kind === "apple"
    ? generateWithApple(request, signal)
    : generateWithWebLLM(request, signal);
}

// Async generator retained for the existing UI contract. Operon returns only
// validated output, so a complete summary is yielded after validation.
export async function* brief(factSheet, signal) {
  await load();
  const result = await runOperon({
    query: summaryQuery(),
    schema: SUMMARY_OUTPUT_SCHEMA,
    generate: (request) => generate(request, signal),
    grounding: async () => [summarySource(factSheet)],
    validateOutput: (output) => validateSummaryOutput(output, factSheet)
  });
  const output = outputFromOperonResult(result);
  if (!output?.summary) throw new Error("Operon returned no validated weather summary");
  lastRun = {
    task: "summary",
    provider: provider?.kind,
    repaired: Boolean(result.was_repaired),
    traceEvents: result.trace?.length || 0
  };
  if (!signal?.aborted) yield output.summary.trim();
}

export async function extractPlanIntent(question, signal) {
  await load();
  const result = await runOperon({
    query: planIntentQuery(question),
    schema: PLAN_INTENT_OUTPUT_SCHEMA,
    generate: (request) => generate(request, signal),
    validateOutput: (output) => validatePlanIntentOutput(output, question),
    timeoutMs: 20000
  });
  const output = outputFromOperonResult(result);
  if (!output) throw new Error("Operon returned no validated plan intent");
  lastRun = {
    task: "plan-intent",
    provider: provider?.kind,
    repaired: Boolean(result.was_repaired),
    traceEvents: result.trace?.length || 0
  };
  return JSON.stringify(output);
}

// Full Nearcast agent sessions use Operon's planner and the finite skill catalog
// supplied by the application. The model chooses typed calls; Nearcast owns all
// data access, navigation, confirmation, storage, and other side effects.
export async function runAgent({
  query,
  skills,
  invokeSkill,
  searchMemory,
  memoryScope,
  sessionId,
  loadSession,
  prepareSkill,
  maxReplans = 0,
  completion = null,
  checkpoint = null,
  signal
}) {
  await load();
  const result = await runOperon({
    query: String(query || "").slice(0, 1800),
    generate: (request) => generate(request, signal),
    planning: "always",
    skills,
    invokeSkill,
    searchMemory,
    memoryScope,
    sessionId,
    maxSessionArtifacts: 8,
    loadSession,
    prepareSkill,
    // Agent turns must resolve to a typed Nearcast skill or an explicit
    // clarification. This keeps the SLM free to interpret language while
    // preventing an unplanned prose fallback from masquerading as action.
    maxReplans: Math.max(1, Number(maxReplans) || 0),
    requireSkillOrClarification: true,
    completion,
    checkpoint,
    timeoutMs: 60000
  });
  lastRun = {
    task: "agent",
    provider: provider?.kind,
    repaired: Boolean(result.was_repaired),
    traceEvents: result.trace?.length || 0,
    skillCalls: result.plan?.skill_calls?.length || 0
  };
  return result;
}
