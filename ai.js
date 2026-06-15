// On-device LLM layer for Nearcast. Dynamically imported only when the user
// opts in, so the base PWA stays tiny. Runs Qwen2.5-0.5B in a WebGPU worker,
// grounded entirely on the weather context the app hands it.
import { CreateWebWorkerMLCEngine } from "https://esm.run/@mlc-ai/web-llm";

const MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

let engine = null;
let loading = null;

// Idempotent: kicks off the (one-time) model download/compile and resolves to
// a ready engine. Repeat calls return the same in-flight or loaded engine.
export function load(onProgress) {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  loading = CreateWebWorkerMLCEngine(
    new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" }),
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

const BRIEF_SYSTEM =
  "You are Nearcast's friendly weather assistant. You are given FACTS about the user's " +
  "local weather. Write a warm, natural briefing of exactly two sentences: the first says " +
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
const EXAMPLE_BRIEF =
  "A cool, partly cloudy start near 58° warms fast to a summery high of 88°, staying mostly dry. " +
  "Get outdoor plans in early — the midday UV hits an 8, so keep sunscreen handy this afternoon.";

// Async generator of token deltas for the single-shot daily briefing.
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
      { role: "assistant", content: EXAMPLE_BRIEF },
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

// The example lives INSIDE the system prompt as an illustration — not as a real
// conversation turn. A 0.5B model given a separate example turn (with different
// city facts) fails to bind the user's question to the real facts and answers
// generically. Single-turn with the real facts immediately above the question,
// question last, fixes the grounding.
const ASK_SYSTEM =
  "You are Nearcast's weather assistant. You are given the user's CURRENT LOCAL WEATHER as " +
  "facts, then their QUESTION. Answer in ONE or TWO sentences that quote the specific fact that " +
  "settles the question (the temperature, the rain wording, the wind, or the timing) and give a " +
  "clear practical recommendation. Never answer with a bare 'yes' or 'no' — always include the " +
  "number or condition you based it on. Use ONLY the facts; never invent data or thresholds. If " +
  "the facts don't cover it, say so briefly. No markdown, no lists.\n\n" +
  "Example of the format:\n" +
  "WEATHER:\nDry for the next 2 hours. Rest of today: high 88°F, slight rain chance (20%).\n" +
  "QUESTION: Should I bring an umbrella this morning?\n" +
  "ANSWER: It's dry for the next couple hours and rain is unlikely today (20%), so you can leave " +
  "the umbrella at home.";

// Async generator of token deltas answering a free-text question about the
// forecast. (Activity chips don't come here — they're answered deterministically
// in app code, since a tiny model can't reliably reason about the weather.)
export async function* ask(factSheet, question, signal) {
  const eng = await load();
  const stream = await eng.chat.completions.create({
    stream: true,
    temperature: 0.15,
    max_tokens: 120,
    frequency_penalty: 0.3,
    messages: [
      { role: "system", content: ASK_SYSTEM },
      { role: "user", content: `WEATHER:\n${factSheet}\n\nQUESTION: ${question}\n\nANSWER:` }
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
