#!/usr/bin/env node

import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalWorker = globalThis.Worker;
const now = new Date("2026-07-12T12:00:00.000Z");
const times = Array.from({ length: 5 }, (_, index) =>
  new Date(now.getTime() - (4 - index) * 5 * 60_000).toISOString()
);

class FakeWorker {
  static instances = [];
  static started = [];
  static delayMs = 12;

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.jobs = new Map();
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  postMessage(message) {
    if (this.terminated) throw new Error("worker is terminated");
    if (message.type === "cancel") {
      const requestId = message.payload?.requestId;
      const ids = requestId ? [requestId] : [...this.jobs.keys()];
      ids.forEach((id) => this.cancelJob(id));
      return;
    }
    if (message.type !== "decode") return;
    const frame = message.payload.frame;
    FakeWorker.started.push(frame.observedAt);
    const delay = FakeWorker.delayMs + (Date.parse(frame.observedAt) === Date.parse(times[times.length - 1]) ? 18 : 0);
    const timer = setTimeout(() => {
      this.jobs.delete(message.id);
      const width = message.payload.width;
      const height = message.payload.height;
      this.emit("message", {
        data: {
          id: message.id,
          type: "result",
          result: {
            data: new Uint8Array(width * height).fill(message.id),
            width,
            height,
            bounds: message.payload.bounds,
            observedAt: frame.observedAt,
            sourceUrl: frame.url,
            encoding: {
              type: "uint8-dbz",
              dbzMin: 0,
              dbzMax: 80,
              threshold: 5,
              noData: 0,
              valueMin: 1,
              valueMax: 255
            },
            metrics: { elapsedMs: delay }
          }
        }
      });
    }, delay);
    this.jobs.set(message.id, timer);
  }

  cancelJob(id) {
    const timer = this.jobs.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.jobs.delete(id);
    setTimeout(() => this.emit("message", {
      data: {
        id,
        type: "error",
        error: {
          name: "AbortError",
          code: "ABORT_ERR",
          message: "MRMS operation was cancelled."
        }
      }
    }), 0);
  }

  terminate() {
    this.terminated = true;
    this.jobs.forEach((timer) => clearTimeout(timer));
    this.jobs.clear();
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

globalThis.Worker = FakeWorker;
globalThis.fetch = async () => ({
  ok: true,
  async text() {
    return s3Listing(times);
  }
});

await import("./mrms-browser-adapter.js");

try {
  const client = globalThis.NearcastMrms.createClient({ workerCount: 99, workerUrl: "fake-worker.js" });
  assert.equal(client.workerCount, 2, "workerCount is capped at two");
  assert.equal(FakeWorker.instances.length, 2, "two workers are created by default/cap");

  const callbacks = [];
  const history = await client.loadHistory({
    now,
    minutes: 30,
    maxFrames: times.length,
    targetTimes: times,
    targetToleranceMinutes: 1,
    bounds: { minLat: 38.2, minLon: -90.5, maxLat: 39.3, maxLon: -89.2 },
    width: 64,
    height: 64,
    onFrame(frame, progress) {
      callbacks.push({ observedAt: frame.observedAt, ...progress });
    }
  });

  assert.deepEqual(
    FakeWorker.started.slice(0, 2),
    [times[4], times[3]],
    "the newest frame and its nearest neighbor start first"
  );
  assert.deepEqual(
    history.frames.map((frame) => frame.observedAt),
    times,
    "final retained frames remain chronological"
  );
  assert.deepEqual(callbacks.map((item) => item.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(callbacks.map((item) => item.progress), [0.2, 0.4, 0.6, 0.8, 1]);
  assert.ok(
    callbacks.some((item) => item.sourceIndex !== item.index),
    "progress distinguishes completion order from chronological source index"
  );
  client.destroy();

  FakeWorker.instances = [];
  FakeWorker.started = [];
  FakeWorker.delayMs = 80;
  const cancellable = globalThis.NearcastMrms.createClient({ workerCount: 2, workerUrl: "fake-worker.js" });
  const pending = cancellable.loadHistory({
    now,
    minutes: 30,
    maxFrames: times.length,
    targetTimes: times,
    targetToleranceMinutes: 1,
    bounds: { minLat: 38.2, minLon: -90.5, maxLat: 39.3, maxLon: -89.2 },
    width: 64,
    height: 64
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  cancellable.cancel();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  cancellable.destroy();
} finally {
  globalThis.fetch = originalFetch;
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
}

console.log(JSON.stringify({
  ok: true,
  maxWorkers: 2,
  newestFirst: true,
  chronologicalResult: true,
  cancellation: true
}, null, 2));

function s3Listing(observedTimes) {
  const contents = observedTimes.map((iso) => {
    const day = iso.slice(0, 10).replace(/-/g, "");
    const clock = iso.slice(11, 19).replace(/:/g, "");
    const key = `CONUS/MergedReflectivityQCComposite_00.50/${day}/MRMS_MergedReflectivityQCComposite_00.50_${day}-${clock}.grib2.gz`;
    return `<Contents><Key>${key}</Key><LastModified>${iso}</LastModified><Size>1200000</Size></Contents>`;
  }).join("");
  return `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}
