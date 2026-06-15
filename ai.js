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
  "You are Nearcast's weather assistant. Use ONLY the DATA provided — never invent " +
  "numbers. Write a friendly 2-sentence briefing of what to expect today, then one " +
  "practical tip. No greetings, no lists, no markdown. Keep it under 45 words.";

// Async generator of token deltas for the single-shot daily briefing.
export async function* brief(context, signal) {
  const eng = await load();
  const stream = await eng.chat.completions.create({
    stream: true,
    temperature: 0.3,
    max_tokens: 120,
    messages: [
      { role: "system", content: BRIEF_SYSTEM },
      { role: "user", content: "DATA:\n" + JSON.stringify(context) }
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
