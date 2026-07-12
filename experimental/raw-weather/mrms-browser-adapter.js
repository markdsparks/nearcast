(function installNearcastMrms(global) {
  "use strict";

  const VERSION = "0.1.0";
  const BUCKET_URL = "https://noaa-mrms-pds.s3.amazonaws.com/";
  const DEFAULT_REGION = "CONUS";
  const DEFAULT_PRODUCT = "MergedReflectivityQCComposite_00.50";
  const DEFAULT_HISTORY_MINUTES = 90;
  const DEFAULT_MAX_FRAMES = 10;
  const MAX_HISTORY_MINUTES = 180;
  const MAX_FRAMES = 16;
  const MAX_LIST_PAGES = 3;
  const DEFAULT_TEXTURE_BUDGET = 8 * 1024 * 1024;

  const scriptUrl = typeof document !== "undefined" && document.currentScript?.src
    ? document.currentScript.src
    : (typeof location !== "undefined" ? location.href : "");
  const defaultWorkerUrl = scriptUrl
    ? new URL("./mrms-browser-worker.js", scriptUrl).href
    : "mrms-browser-worker.js";

  function support() {
    return {
      supported: typeof Worker !== "undefined" &&
        typeof fetch === "function" &&
        typeof ReadableStream !== "undefined" &&
        typeof DecompressionStream !== "undefined",
      worker: typeof Worker !== "undefined",
      fetch: typeof fetch === "function",
      streams: typeof ReadableStream !== "undefined",
      decompressionStream: typeof DecompressionStream !== "undefined"
    };
  }

  async function listRecentFrames(options) {
    const config = normalizeListOptions(options || {});
    const earliest = new Date(config.now.getTime() - config.minutes * 60_000);
    const dates = utcDatesBetween(earliest, config.now);
    const objects = [];

    for (const date of dates) {
      const prefix = `${config.region}/${config.product}/${date}/`;
      let continuationToken = "";
      for (let pageNumber = 0; pageNumber < config.maxListPages; pageNumber += 1) {
        const page = await listS3Page({
          prefix,
          continuationToken,
          signal: config.signal
        });
        objects.push(...page.objects);
        if (!page.isTruncated || !page.nextContinuationToken) break;
        continuationToken = page.nextContinuationToken;
      }
    }

    const lowerBound = earliest.getTime();
    const upperBound = config.now.getTime() + 5 * 60_000;
    const recent = uniqueByKey(objects)
      .filter((item) => Number.isFinite(item.observedAtMs))
      .filter((item) => item.observedAtMs >= lowerBound && item.observedAtMs <= upperBound)
      .filter((item) => item.size > 0 && item.size <= config.maxCompressedBytes)
      .sort((a, b) => a.observedAtMs - b.observedAtMs);

    return evenlySample(recent, config.maxFrames).map((item) => ({
      key: item.key,
      url: objectUrl(item.key),
      observedAt: new Date(item.observedAtMs).toISOString(),
      lastModified: item.lastModified,
      size: item.size,
      product: config.product,
      region: config.region,
      provider: "noaa-mrms-pds"
    }));
  }

  function createClient(options) {
    const config = options || {};
    const capabilities = support();
    if (!capabilities.supported) {
      const missing = Object.entries(capabilities)
        .filter(([key, value]) => key !== "supported" && !value)
        .map(([key]) => key)
        .join(", ");
      throw new Error(`MRMS browser adapter is unavailable; missing ${missing || "required browser APIs"}.`);
    }

    const worker = new Worker(config.workerUrl || defaultWorkerUrl);
    const pending = new Map();
    let nextRequestId = 1;
    let destroyed = false;
    let queue = Promise.resolve();

    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.type === "error") {
        const error = new Error(message.error?.message || "MRMS worker failed.");
        error.name = message.error?.name || "Error";
        error.code = message.error?.code || "MRMS_WORKER_ERROR";
        error.details = message.error?.details || null;
        request.reject(error);
        return;
      }
      request.resolve(message.result);
    });

    worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "MRMS worker crashed.");
      error.code = "MRMS_WORKER_CRASH";
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    });

    function request(type, payload) {
      if (destroyed) return Promise.reject(new Error("MRMS client has been destroyed."));
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload });
      });
    }

    function enqueue(operation) {
      const result = queue.then(operation, operation);
      queue = result.catch(() => {});
      return result;
    }

    async function decodeFrame(frame, decodeOptions) {
      if (!frame?.url) throw new Error("decodeFrame requires a frame returned by listRecentFrames().");
      const normalized = normalizeDecodeOptions(decodeOptions || {});
      return enqueue(() => request("decode", {
        frame,
        bounds: normalized.bounds,
        width: normalized.width,
        height: normalized.height,
        threshold: normalized.threshold,
        dbzMin: normalized.dbzMin,
        dbzMax: normalized.dbzMax,
        timeoutMs: normalized.timeoutMs,
        maxCompressedBytes: normalized.maxCompressedBytes
      }));
    }

    async function loadHistory(historyOptions) {
      const normalized = normalizeDecodeOptions(historyOptions || {});
      const requestedFrames = clampInteger(historyOptions?.maxFrames, DEFAULT_MAX_FRAMES, 1, MAX_FRAMES);
      const textureBudget = clampInteger(
        historyOptions?.maxTextureBytes,
        DEFAULT_TEXTURE_BUDGET,
        normalized.width * normalized.height,
        32 * 1024 * 1024
      );
      const maxFramesByBudget = Math.max(1, Math.floor(textureBudget / (normalized.width * normalized.height)));
      const maxFrames = Math.min(requestedFrames, maxFramesByBudget);
      const frames = await listRecentFrames({
        ...historyOptions,
        maxFrames,
        maxCompressedBytes: normalized.maxCompressedBytes
      });
      const retainTextures = historyOptions?.retainTextures !== false;
      const decoded = [];

      for (let index = 0; index < frames.length; index += 1) {
        const texture = await decodeFrame(frames[index], normalized);
        const decodedFrame = {
          ...frames[index],
          ...texture,
          data: texture.data instanceof Uint8Array ? texture.data : new Uint8Array(texture.data)
        };
        if (typeof historyOptions?.onFrame === "function") {
          await historyOptions.onFrame(decodedFrame, {
            index,
            count: frames.length,
            progress: frames.length ? (index + 1) / frames.length : 1
          });
        }
        if (retainTextures) decoded.push(decodedFrame);
      }

      return {
        provider: "noaa-mrms-pds",
        product: historyOptions?.product || DEFAULT_PRODUCT,
        region: historyOptions?.region || DEFAULT_REGION,
        bounds: normalized.bounds,
        width: normalized.width,
        height: normalized.height,
        frames: retainTextures ? decoded : frames,
        retainedTextures: retainTextures,
        textureBytes: retainTextures ? decoded.length * normalized.width * normalized.height : 0,
        attribution: "NOAA/NWS MRMS"
      };
    }

    function cancel(requestId) {
      if (destroyed) return;
      worker.postMessage({ type: "cancel", payload: { requestId: requestId || null } });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      worker.terminate();
      const error = new Error("MRMS client was destroyed.");
      error.code = "MRMS_CLIENT_DESTROYED";
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    }

    return Object.freeze({
      decodeFrame,
      loadHistory,
      cancel,
      destroy,
      workerUrl: config.workerUrl || defaultWorkerUrl
    });
  }

  function normalizeListOptions(options) {
    const now = options.now ? new Date(options.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("now must be a valid date.");
    return {
      now,
      minutes: clampNumber(options.minutes, DEFAULT_HISTORY_MINUTES, 1, MAX_HISTORY_MINUTES),
      maxFrames: clampInteger(options.maxFrames, DEFAULT_MAX_FRAMES, 1, MAX_FRAMES),
      maxListPages: clampInteger(options.maxListPages, MAX_LIST_PAGES, 1, 6),
      maxCompressedBytes: clampInteger(options.maxCompressedBytes, 8 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024),
      region: cleanSegment(options.region || DEFAULT_REGION, "region"),
      product: cleanSegment(options.product || DEFAULT_PRODUCT, "product"),
      signal: options.signal
    };
  }

  function normalizeDecodeOptions(options) {
    const bounds = normalizeBounds(options.bounds);
    const width = clampInteger(options.width, 512, 64, 1024);
    const height = clampInteger(options.height, 384, 64, 1024);
    if (width * height > 1_048_576) throw new Error("MRMS texture is limited to 1,048,576 pixels.");
    const dbzMin = clampNumber(options.dbzMin, 0, -20, 40);
    const dbzMax = clampNumber(options.dbzMax, 80, 41, 100);
    if (dbzMax <= dbzMin) throw new Error("dbzMax must be greater than dbzMin.");
    return {
      bounds,
      width,
      height,
      dbzMin,
      dbzMax,
      threshold: clampNumber(options.threshold, 5, -10, 80),
      timeoutMs: clampInteger(options.timeoutMs, 30_000, 5_000, 60_000),
      maxCompressedBytes: clampInteger(options.maxCompressedBytes, 8 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024)
    };
  }

  function normalizeBounds(value) {
    const source = Array.isArray(value)
      ? { minLon: value[0], minLat: value[1], maxLon: value[2], maxLat: value[3] }
      : value;
    const bounds = {
      minLat: Number(source?.minLat),
      minLon: Number(source?.minLon),
      maxLat: Number(source?.maxLat),
      maxLon: Number(source?.maxLon)
    };
    if (!Object.values(bounds).every(Number.isFinite)) {
      throw new Error("bounds must contain finite minLat, minLon, maxLat, and maxLon values.");
    }
    if (bounds.minLat >= bounds.maxLat || bounds.minLon >= bounds.maxLon) {
      throw new Error("bounds must have increasing latitude and longitude extents.");
    }
    if (bounds.minLat < -85 || bounds.maxLat > 85 || bounds.minLon < -180 || bounds.maxLon > 180) {
      throw new Error("bounds fall outside the supported Web Mercator extent.");
    }
    return bounds;
  }

  async function listS3Page({ prefix, continuationToken, signal }) {
    const url = new URL(BUCKET_URL);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    url.searchParams.set("prefix", prefix);
    if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`MRMS listing failed with HTTP ${response.status}.`);
    const xml = await response.text();
    return {
      objects: blocksForTag(xml, "Contents").map(parseS3Object).filter((item) => item.key),
      isTruncated: textForTag(xml, "IsTruncated") === "true",
      nextContinuationToken: textForTag(xml, "NextContinuationToken")
    };
  }

  function parseS3Object(block) {
    const key = textForTag(block, "Key");
    const observedAtMs = observedTimeFromKey(key);
    return {
      key,
      observedAtMs,
      lastModified: textForTag(block, "LastModified"),
      size: Number(textForTag(block, "Size")) || 0
    };
  }

  function observedTimeFromKey(key) {
    const match = String(key || "").match(/_(\d{8})-(\d{6})\.grib2(?:\.gz)?$/);
    if (!match) return NaN;
    const ymd = match[1];
    const hms = match[2];
    return Date.UTC(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(4, 6)) - 1,
      Number(ymd.slice(6, 8)),
      Number(hms.slice(0, 2)),
      Number(hms.slice(2, 4)),
      Number(hms.slice(4, 6))
    );
  }

  function utcDatesBetween(start, end) {
    const dates = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const finalDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    while (cursor.getTime() <= finalDay) {
      dates.push(cursor.toISOString().slice(0, 10).replace(/-/g, ""));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  function evenlySample(values, limit) {
    if (values.length <= limit) return values;
    if (limit === 1) return [values[values.length - 1]];
    const indexes = new Set();
    for (let index = 0; index < limit; index += 1) {
      indexes.add(Math.round(index * (values.length - 1) / (limit - 1)));
    }
    return [...indexes].sort((a, b) => a - b).map((index) => values[index]);
  }

  function uniqueByKey(values) {
    return [...new Map(values.map((value) => [value.key, value])).values()];
  }

  function objectUrl(key) {
    return `${BUCKET_URL}${String(key).split("/").map(encodeURIComponent).join("/")}`;
  }

  function cleanSegment(value, label) {
    const normalized = String(value || "").trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) throw new Error(`${label} contains unsupported characters.`);
    return normalized;
  }

  function blocksForTag(xml, tag) {
    return [...String(xml || "").matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]);
  }

  function textForTag(xml, tag) {
    const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return decodeXml(match?.[1] || "");
  }

  function decodeXml(value) {
    return String(value || "")
      .replace(/&quot;/g, "\"")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }

  function clampInteger(value, fallback, min, max) {
    return Math.round(clampNumber(value, fallback, min, max));
  }

  global.NearcastMrms = Object.freeze({
    version: VERSION,
    support,
    listRecentFrames,
    createClient,
    defaults: Object.freeze({
      bucketUrl: BUCKET_URL,
      region: DEFAULT_REGION,
      product: DEFAULT_PRODUCT,
      historyMinutes: DEFAULT_HISTORY_MINUTES,
      maxFrames: DEFAULT_MAX_FRAMES,
      workerUrl: defaultWorkerUrl
    })
  });
})(typeof self !== "undefined" ? self : globalThis);
