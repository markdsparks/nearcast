#!/usr/bin/env node

import { isMainThread, parentPort, Worker as ThreadWorker } from "node:worker_threads";

if (!isMainThread) {
  globalThis.self = {
    addEventListener(type, listener) {
      if (type === "message") parentPort.on("message", (data) => listener({ data }));
    },
    postMessage(message, transfer) {
      parentPort.postMessage(message, transfer);
    }
  };
  await import("./mrms-browser-worker.js");
} else {
  class BrowserWorker {
    constructor() {
      this.worker = new ThreadWorker(new URL(import.meta.url));
      this.listeners = new Map();
      this.worker.on("message", (data) => this.emit("message", { data }));
      this.worker.on("error", (error) => this.emit("error", error));
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    postMessage(message) {
      this.worker.postMessage(message);
    }

    terminate() {
      return this.worker.terminate();
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
  }

  globalThis.Worker = BrowserWorker;
  await import("./mrms-browser-adapter.js");

  const listed = await globalThis.NearcastMrms.listRecentFrames({ minutes: 20, maxFrames: 2 });
  if (listed.length < 2) throw new Error("Two recent MRMS frames are required for the pool comparison.");
  const targetTimes = listed.map((frame) => frame.observedAt);
  const bounds = { minLat: 38.35, minLon: -90.65, maxLat: 39.25, maxLon: -89.25 };

  const sequential = await run(1);
  const pooled = await run(2);
  const speedup = sequential.elapsedMs / Math.max(1, pooled.elapsedMs);

  console.log(JSON.stringify({
    ok: true,
    frames: targetTimes,
    sequential,
    pooled,
    speedup: Number(speedup.toFixed(2)),
    note: "Concurrency is bounded at two streaming decoders; one-shot speedup varies with network and decompression contention."
  }, null, 2));

  async function run(workerCount) {
    const client = globalThis.NearcastMrms.createClient({ workerCount });
    const startedAt = performance.now();
    try {
      const history = await client.loadHistory({
        minutes: 20,
        maxFrames: 2,
        targetTimes,
        targetToleranceMinutes: 6,
        bounds,
        width: 160,
        height: 100,
        timeoutMs: 45_000
      });
      return {
        workerCount,
        elapsedMs: Math.round(performance.now() - startedAt),
        decodedFrames: history.frames.length,
        compressedBytes: history.frames.reduce((sum, frame) => sum + (frame.metrics?.compressedBytes || 0), 0),
        gribBytes: history.frames.reduce((sum, frame) => sum + (frame.metrics?.gribBytes || 0), 0),
        maxWorkingBytesPerWorker: history.frames.reduce((max, frame) => Math.max(
          max,
          (frame.metrics?.compressedBytes || 0) +
            (frame.metrics?.gribBytes || 0) +
            (frame.metrics?.outputPixels || 0)
        ), 0),
        maxRowsHeldPerWorker: 2,
        textureBytes: history.textureBytes
      };
    } finally {
      client.destroy();
    }
  }
}
