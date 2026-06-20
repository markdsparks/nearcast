// On-device summary layer for Nearcast Planner. Dynamically imported only when
// the user opts in, so the base PWA stays tiny. Runs Qwen2.5-0.5B in a WebGPU
// worker, grounded entirely on the weather context the app hands it.
import { CreateWebWorkerMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.79";

const MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const AI_ASSET_VERSION = "2.0";

let engine = null;
let loading = null;

// Idempotent: kicks off the (one-time) model download/compile and resolves to
// a ready engine. Repeat calls return the same in-flight or loaded engine.
export function load(onProgress) {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  const workerUrl = new URL("./ai-worker.js", import.meta.url);
  workerUrl.searchParams.set("v", AI_ASSET_VERSION);
  loading = CreateWebWorkerMLCEngine(
    new Worker(workerUrl, { type: "module" }),
    MODEL,
    { initProgressCallback: onProgress }
  ).then((e) => {
    engine = e;
    return e;
  }).catch((err) => {
    loading = null; // allow a retry
    throw err;
  });
  return loading;
}

export function isLoaded() {
  return Boolean(engine);
}

const BRIEF_SYSTEM =
  "You are Nearcast's friendly weather assistant. You are given FACTS about the user's " +
  "local weather. Write a warm, natural summary of exactly two sentences: the first says " +
  "what to expect, the second gives one practical tip. Use ONLY the facts and never invent " +
  "numbers. Speak like a helpful local — don't mechanically recite every number. No greetings, " +
  "no lists, no markdown. Keep it under 45 words.";

// A single gold-standard example anchors tone, length, and format — disproportionately
// effective for a tiny model.
const EXAMPLE_FACTS =
  "Place: Austin, Texas. Local time 7:10am, daytime.\n" +
  "Right now: 58°F, feels like 56°F, partly cloudy. Wind 6 mph from the S. Humidity 72%.\n" +
  "Next 2 hours: dry.\n" +
  "Rest of today: high 88°F, low 57°F, 20% chance of rain. UV index peaks at 8. Sunset 8:14pm.\n" +
  "Tomorrow: partly cloudy, high 90°F, low 60°F, 10% chance of rain.\n" +
  "No active weather alerts.";
const EXAMPLE_SUMMARY =
  "A cool, partly cloudy start near 58° warms fast to a summery high of 88°, staying mostly dry. " +
  "Get outdoor plans in early — the midday UV hits an 8, so keep sunscreen handy this afternoon.";

const INTENT_SYSTEM =
  "Extract an outdoor plan from the user's message. Return only compact JSON with " +
  "keys activity, day, time, location. Use only words present in the message; do not " +
  "answer weather questions, infer forecasts, or invent missing details. Empty string for unknown.";

const INTENT_EXAMPLE_USER = "Ballgame sat morning Fairview heights";
const INTENT_EXAMPLE_JSON =
  "{\"activity\":\"Ballgame\",\"day\":\"sat\",\"time\":\"morning\",\"location\":\"Fairview heights\"}";

// Async generator of token deltas for the single-shot private summary.
export async function* brief(factSheet, signal) {
  const eng = await load();
  const stream = await eng.chat.completions.create({
    stream: true,
    temperature: 0.2,
    max_tokens: 110,
    frequency_penalty: 0.3,
    presence_penalty: 0.2,
    messages: [
      { role: "system", content: BRIEF_SYSTEM },
      { role: "user", content: "FACTS:\n" + EXAMPLE_FACTS },
      { role: "assistant", content: EXAMPLE_SUMMARY },
      { role: "user", content: "FACTS:\n" + factSheet }
    ]
  });
  for await (const chunk of stream) {
    if (signal && signal.aborted) {
      try { await eng.interruptGenerate(); } catch (_) {}
      break;
    }
    yield chunk.choices[0]?.delta?.content || "";
  }
}

export async function extractPlanIntent(question, signal) {
  const eng = await load();
  const stream = await eng.chat.completions.create({
    stream: true,
    temperature: 0,
    max_tokens: 90,
    messages: [
      { role: "system", content: INTENT_SYSTEM },
      { role: "user", content: INTENT_EXAMPLE_USER },
      { role: "assistant", content: INTENT_EXAMPLE_JSON },
      { role: "user", content: String(question || "").slice(0, 220) }
    ]
  });
  let text = "";
  for await (const chunk of stream) {
    if (signal && signal.aborted) {
      try { await eng.interruptGenerate(); } catch (_) {}
      break;
    }
    text += chunk.choices[0]?.delta?.content || "";
  }
  return text;
}

// Note: free-text Q&A is intentionally NOT handled by the model. A 0.5B can't
// reliably reason about weather (it hallucinates day-specific forecasts, etc.),
// so app code answers questions deterministically from the data. The only other
// model job is extracting plan fields; every field is revalidated by app code
// before any weather answer is computed.
