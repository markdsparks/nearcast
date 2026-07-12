#!/usr/bin/env node

import assert from "node:assert/strict";
import { isMainThread, parentPort, Worker as NodeWorker, workerData } from "node:worker_threads";

if (!isMainThread) {
  globalThis.self = {
    addEventListener(type, listener) {
      if (type === "message") parentPort.on("message", (data) => listener({ data }));
    },
    postMessage(message, transfer) {
      parentPort.postMessage(message, transfer);
    }
  };
  await import(workerData.target);
} else {
  class BrowserWorker {
    constructor(target) {
      this.worker = new NodeWorker(new URL(import.meta.url), {
        workerData: { target: new URL(target, import.meta.url).href }
      });
    }

    addEventListener(type, listener) {
      if (type === "message") this.worker.on("message", (data) => listener({ data }));
      if (type === "error") this.worker.on("error", listener);
    }

    postMessage(message, transfer) {
      this.worker.postMessage(message, transfer);
    }

    terminate() {
      return this.worker.terminate();
    }
  }

  globalThis.Worker = BrowserWorker;
  await import("./hrrr-subhourly-adapter.js");

  const requestedFrames = Math.max(1, Math.min(12, Number(
    process.argv.find((argument) => argument.startsWith("--frames="))?.split("=")[1]
  ) || 2));
  const now = new Date();
  const validTimes = Array.from({ length: requestedFrames }, (_, index) => (
    new Date(now.getTime() + (index + 1) * 15 * 60_000)
  ));
  const client = globalThis.NearcastHrrrSubhourly.createClient({
    workerUrl: new URL("./hrrr-subhourly-worker.js", import.meta.url).href
  });

  try {
    const result = await client.loadForecast({
      now,
      validTimes,
      bounds: { minLat: 37.8, minLon: -91.4, maxLat: 40.0, maxLon: -88.3 },
      width: 160,
      height: 100,
      timeoutMs: 80_000
    });
    assert.equal(result.frames.length, requestedFrames, "Expected every requested sub-hourly forecast frame");
    assert.equal(new Set(result.frames.map((frame) => frame.validTime)).size, requestedFrames);
    assert.ok(result.frames.every((frame) => frame.forecastMinutes % 15 === 0));
    assert.ok(result.frames.every((frame) => frame.data.byteLength === 160 * 100));
    assert.ok(result.frames.every((frame) => frame.metrics.recordBytes > 64 * 1024));
    assert.ok(result.frames.every((frame) => frame.metrics.recordBytes < 4 * 1024 * 1024));
    assert.ok(result.frames.every((frame) => frame.metrics.sourcePoints === 1799 * 1059));
    assert.ok(result.frames.every((frame) => frame.metrics.sourceMinDbz >= -20));
    assert.ok(result.frames.every((frame) => frame.metrics.sourceMaxDbz <= 100));
    assert.ok(result.frames[0].validTime < result.frames[1].validTime);

    console.log(JSON.stringify({
      ok: true,
      cycleTime: result.cycleTime,
      frames: result.frames.map((frame) => ({
        validTime: frame.validTime,
        forecastMinutes: frame.forecastMinutes,
        recordBytes: frame.metrics.recordBytes,
        sourceRangeDbz: [frame.metrics.sourceMinDbz, frame.metrics.sourceMaxDbz],
        viewportRangeDbz: [frame.metrics.minDbz, frame.metrics.maxDbz],
        precipPixels: frame.metrics.precipPixels,
        elapsedMs: frame.metrics.elapsedMs
      }))
    }, null, 2));
  } finally {
    client.destroy();
  }
}
