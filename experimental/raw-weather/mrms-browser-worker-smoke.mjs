#!/usr/bin/env node

import { isMainThread, parentPort, Worker } from "node:worker_threads";

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
  await import("./mrms-browser-adapter.js");

  const args = Object.fromEntries(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key, rest.join("=") || true];
  }));
  const bounds = args.bounds
    ? parseBounds(args.bounds)
    : { minLat: 38.35, minLon: -90.65, maxLat: 39.25, maxLon: -89.25 };

  const frames = await globalThis.NearcastMrms.listRecentFrames({ minutes: 30, maxFrames: 2 });
  if (!frames.length) throw new Error("No recent public MRMS frame was found.");
  const frame = frames[frames.length - 1];
  const worker = new Worker(new URL(import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MRMS worker smoke timed out.")), 45_000);
    worker.once("message", (message) => {
      clearTimeout(timeout);
      if (message.type === "error") {
        const error = new Error(message.error?.message || "Worker failed.");
        error.code = message.error?.code;
        reject(error);
      } else {
        resolve(message.result);
      }
    });
    worker.once("error", reject);
    worker.postMessage({
      id: 1,
      type: "decode",
      payload: {
        frame,
        bounds,
        width: 320,
        height: 200,
        timeoutMs: 40_000
      }
    });
  });
  await worker.terminate();

  const data = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
  if (data.byteLength !== result.width * result.height) throw new Error("Texture byte length is invalid.");
  if (result.metrics.sourceRowsDecoded <= 0) throw new Error("No source rows were decoded.");
  if (result.metrics.sourceRowsDecoded >= result.metrics.sourceRowsTotal) {
    throw new Error("The bounded decoder unexpectedly walked the full national grid.");
  }

  console.log(JSON.stringify({
    ok: true,
    frame: frame.observedAt,
    sourceBytes: result.metrics.compressedBytes,
    texture: `${result.width}x${result.height}`,
    textureBytes: data.byteLength,
    sourceRowsDecoded: result.metrics.sourceRowsDecoded,
    sourceRowsTotal: result.metrics.sourceRowsTotal,
    precipPixels: result.metrics.precipPixels,
    minDbz: result.metrics.minDbz,
    maxDbz: result.metrics.maxDbz,
    elapsedMs: result.metrics.elapsedMs,
    memoryStrategy: result.metrics.memoryStrategy
  }, null, 2));
}

function parseBounds(value) {
  const [minLat, minLon, maxLat, maxLon] = String(value).split(",").map(Number);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) {
    throw new Error("--bounds expects minLat,minLon,maxLat,maxLon");
  }
  return { minLat, minLon, maxLat, maxLon };
}
