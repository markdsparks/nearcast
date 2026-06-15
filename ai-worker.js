// Module worker: hosts WebLLM's engine so all inference runs off the UI thread.
// Loaded lazily (only after the user opts into the private summary), never on
// initial app start.
import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
