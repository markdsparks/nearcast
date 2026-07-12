(function installNearcastHrrrSubhourly(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NearcastHrrrSubhourly = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNearcastHrrrSubhourlyApi() {
  "use strict";

  const VERSION = "0.1.0";
  const BUCKET = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com";
  const PROVIDER = "noaa-hrrr-subhourly";
  const MAX_FORECAST_MINUTES = 18 * 60;
  const DEFAULT_LOOKBACK_HOURS = 6;
  const DEFAULT_MAX_FRAMES = 12;
  const MAX_FRAMES = 24;

  const scriptUrl = typeof document !== "undefined" && document.currentScript?.src
    ? document.currentScript.src
    : (typeof location !== "undefined" ? location.href : "");
  const defaultWorkerUrl = scriptUrl
    ? new URL("./hrrr-subhourly-worker.js", scriptUrl).href
    : "hrrr-subhourly-worker.js";

  function support() {
    return {
      supported: typeof Worker !== "undefined" && typeof fetch === "function",
      worker: typeof Worker !== "undefined",
      fetch: typeof fetch === "function"
    };
  }

  function createClient(options = {}) {
    const capabilities = support();
    if (!capabilities.supported) {
      const missing = Object.entries(capabilities)
        .filter(([key, value]) => key !== "supported" && !value)
        .map(([key]) => key)
        .join(", ");
      throw codedError(
        "HRRR_SUBHOURLY_UNSUPPORTED",
        `HRRR sub-hourly adapter is unavailable; missing ${missing || "required browser APIs"}.`
      );
    }

    const worker = new Worker(options.workerUrl || defaultWorkerUrl);
    const fetchImpl = options.fetch || fetch.bind(globalThis);
    const indexCache = new Map();
    const pending = new Map();
    let nextRequestId = 1;
    let destroyed = false;
    let queue = Promise.resolve();

    worker.addEventListener("message", (event) => {
      const message = event.data || {};
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      request.detachAbort?.();
      if (message.type === "error") {
        const error = codedError(
          message.error?.code || "HRRR_SUBHOURLY_DECODE_FAILED",
          message.error?.message || "HRRR sub-hourly worker failed.",
          message.error?.details
        );
        error.name = message.error?.name || "Error";
        request.reject(error);
      } else {
        request.resolve(message.result);
      }
    });

    worker.addEventListener("error", (event) => {
      const error = codedError(
        "HRRR_SUBHOURLY_WORKER_FAILED",
        event?.message || "HRRR sub-hourly worker failed."
      );
      for (const request of pending.values()) {
        request.detachAbort?.();
        request.reject(error);
      }
      pending.clear();
    });

    function fetchIndex(url, signal) {
      if (!indexCache.has(url)) {
        const promise = fetchText(fetchImpl, url, signal).catch((error) => {
          indexCache.delete(url);
          throw error;
        });
        indexCache.set(url, promise);
      }
      return indexCache.get(url);
    }

    async function discoverFrames(input = {}) {
      assertActive();
      return discoverSubhourlyFrames({
        ...input,
        bucket: options.bucket || BUCKET,
        fetchIndex
      });
    }

    function decodeFrame(frame, input = {}) {
      assertActive();
      const requestId = nextRequestId++;
      const signal = input.signal;
      const operation = () => new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        const onAbort = () => {
          worker.postMessage({ type: "cancel", payload: { requestId } });
          const request = pending.get(requestId);
          if (!request) return;
          pending.delete(requestId);
          request.detachAbort?.();
          request.reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        pending.set(requestId, {
          resolve,
          reject,
          detachAbort: () => signal?.removeEventListener("abort", onAbort)
        });
        worker.postMessage({
          id: requestId,
          type: "decode",
          payload: {
            frame,
            bounds: input.bounds,
            width: input.width,
            height: input.height,
            threshold: input.threshold,
            dbzMin: input.dbzMin,
            dbzMax: input.dbzMax,
            timeoutMs: input.timeoutMs,
            maxRecordBytes: input.maxRecordBytes
          }
        });
      });
      const result = queue.then(operation, operation);
      queue = result.catch(() => undefined);
      return result;
    }

    async function loadForecast(input = {}) {
      assertActive();
      const descriptors = await discoverFrames(input);
      const retainTextures = input.retainTextures !== false;
      const decoded = [];

      for (let index = 0; index < descriptors.length; index += 1) {
        if (input.signal?.aborted) throw abortError();
        const texture = await decodeFrame(descriptors[index], input);
        const frame = {
          ...descriptors[index],
          ...texture,
          data: texture.data instanceof Uint8Array ? texture.data : new Uint8Array(texture.data)
        };
        if (typeof input.onFrame === "function") {
          await input.onFrame(frame, {
            index,
            count: descriptors.length,
            progress: descriptors.length ? (index + 1) / descriptors.length : 1
          });
        }
        if (retainTextures) decoded.push(frame);
      }

      return {
        provider: PROVIDER,
        attribution: "NOAA/NWS HRRR",
        cycleTime: descriptors[0]?.cycleTime || null,
        frames: retainTextures ? decoded : descriptors,
        retainedTextures: retainTextures,
        bounds: normalizeBounds(input.bounds),
        width: clampInteger(input.width, 512, 64, 1024),
        height: clampInteger(input.height, 384, 64, 1024)
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
      const error = codedError("HRRR_SUBHOURLY_CLIENT_DESTROYED", "HRRR sub-hourly client was destroyed.");
      for (const request of pending.values()) {
        request.detachAbort?.();
        request.reject(error);
      }
      pending.clear();
      indexCache.clear();
    }

    function assertActive() {
      if (destroyed) {
        throw codedError("HRRR_SUBHOURLY_CLIENT_DESTROYED", "HRRR sub-hourly client was destroyed.");
      }
    }

    return Object.freeze({
      discoverFrames,
      decodeFrame,
      loadForecast,
      cancel,
      destroy,
      support
    });
  }

  async function discoverSubhourlyFrames(input = {}) {
    const validTimes = normalizeValidTimes(input.validTimes, input.maxFrames);
    if (!validTimes.length) {
      throw codedError("HRRR_SUBHOURLY_TIMES_REQUIRED", "At least one forecast valid time is required.");
    }
    const now = validDate(input.now || new Date(), "now");
    const lookbackHours = clampInteger(input.lookbackHours, DEFAULT_LOOKBACK_HOURS, 1, 12);
    const bucket = trimTrailingSlash(input.bucket || BUCKET);
    const fetchIndex = input.fetchIndex || ((url, signal) => fetchText(input.fetch || fetch, url, signal));
    const failures = [];

    for (const cycleTime of cycleCandidates(now, lookbackHours)) {
      const selections = selectCanonicalTimes(cycleTime, validTimes);
      if (!selections.length || selections.length !== validTimes.length) {
        failures.push({ cycleTime: cycleTime.toISOString(), reason: "targets outside the 15-minute FH18 product" });
        continue;
      }

      const files = uniqueBy(selections, (item) => item.fileForecastHour)
        .map((item) => item.fileForecastHour);
      try {
        const indexes = new Map(await Promise.all(files.map(async (fileForecastHour) => {
          const urls = hrrrSubhourlyUrls(bucket, cycleTime, fileForecastHour);
          const text = await fetchIndex(urls.indexUrl, input.signal);
          return [fileForecastHour, parseHrrrIndex(text, urls.dataUrl)];
        })));
        const descriptors = selections.map((selection) => {
          const entries = indexes.get(selection.fileForecastHour) || [];
          const match = entries.find((entry) => entry.parameter === "REFC"
            && entry.level === "entire atmosphere"
            && entry.forecastMinutes === selection.forecastMinutes);
          if (!match) {
            throw codedError(
              "HRRR_SUBHOURLY_FRAME_MISSING",
              `REFC ${selection.forecastMinutes}-minute frame is missing from the ${cycleTime.toISOString()} run.`
            );
          }
          return Object.freeze({
            ...match,
            provider: PROVIDER,
            cycleTime: cycleTime.toISOString(),
            validTime: selection.validTime.toISOString(),
            targetValidTime: selection.targetValidTime.toISOString(),
            forecastMinutes: selection.forecastMinutes,
            forecastHour: selection.forecastMinutes / 60,
            fileForecastHour: selection.fileForecastHour
          });
        });
        return Object.freeze(uniqueBy(descriptors, (frame) => frame.validTime)
          .sort((left, right) => Date.parse(left.validTime) - Date.parse(right.validTime)));
      } catch (error) {
        if (isAbortError(error)) throw error;
        failures.push({ cycleTime: cycleTime.toISOString(), reason: error.message || String(error) });
      }
    }

    throw codedError(
      "HRRR_SUBHOURLY_RUN_UNAVAILABLE",
      "No complete HRRR sub-hourly run covered the requested valid times.",
      { failures }
    );
  }

  function selectCanonicalTimes(cycleTime, validTimes) {
    const cycleMs = cycleTime.getTime();
    const selected = [];
    for (const targetValidTime of validTimes) {
      const rawMinutes = (targetValidTime.getTime() - cycleMs) / 60_000;
      const forecastMinutes = Math.round(rawMinutes / 15) * 15;
      if (forecastMinutes < 15 || forecastMinutes > MAX_FORECAST_MINUTES) return [];
      selected.push({
        targetValidTime,
        forecastMinutes,
        fileForecastHour: Math.ceil(forecastMinutes / 60),
        validTime: new Date(cycleMs + forecastMinutes * 60_000)
      });
    }
    return uniqueBy(selected, (item) => item.validTime.toISOString());
  }

  function parseHrrrIndex(text, dataUrl) {
    const rows = String(text || "")
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^(\d+):(\d+):d=(\d{10}):([^:]+):([^:]+):(?:(\d+) min fcst|anl):/);
        if (!match) return null;
        return {
          record: Number(match[1]),
          offset: Number(match[2]),
          cycleStamp: match[3],
          parameter: match[4],
          level: match[5],
          forecastMinutes: match[6] === undefined ? 0 : Number(match[6])
        };
      })
      .filter(Boolean);
    if (!rows.length) throw codedError("HRRR_SUBHOURLY_INDEX_INVALID", "HRRR index contained no usable records.");

    return rows.map((row, index) => {
      const nextOffset = rows[index + 1]?.offset;
      const rangeEnd = Number.isFinite(nextOffset) ? nextOffset - 1 : null;
      return Object.freeze({
        ...row,
        url: dataUrl,
        rangeStart: row.offset,
        rangeEnd,
        byteLength: Number.isFinite(rangeEnd) ? rangeEnd - row.offset + 1 : null
      });
    });
  }

  function hrrrSubhourlyUrls(bucket, cycleTime, fileForecastHour) {
    const date = formatUtcDate(cycleTime);
    const cycleHour = String(cycleTime.getUTCHours()).padStart(2, "0");
    const forecastHour = String(fileForecastHour).padStart(2, "0");
    const base = `${bucket}/hrrr.${date}/conus/hrrr.t${cycleHour}z.wrfsubhf${forecastHour}.grib2`;
    return { dataUrl: base, indexUrl: `${base}.idx` };
  }

  function cycleCandidates(now, count) {
    const hour = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours()
    );
    return Array.from({ length: count }, (_, offset) => new Date(hour - offset * 3_600_000));
  }

  async function fetchText(fetchImpl, url, signal) {
    const response = await fetchImpl(url, { signal, cache: "no-store" });
    if (!response.ok) {
      throw codedError("HRRR_SUBHOURLY_INDEX_FETCH_FAILED", `HRRR index fetch failed with HTTP ${response.status}.`);
    }
    return response.text();
  }

  function normalizeValidTimes(values, maxFrames) {
    if (!Array.isArray(values)) return [];
    const limit = clampInteger(maxFrames, DEFAULT_MAX_FRAMES, 1, MAX_FRAMES);
    return uniqueBy(values.map((value) => {
      try {
        return validDate(value, "validTime");
      } catch {
        return null;
      }
    }).filter(Boolean), (date) => date.toISOString())
      .sort((left, right) => left - right)
      .slice(0, limit);
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
    if (!Object.values(bounds).every(Number.isFinite)
      || bounds.minLat >= bounds.maxLat
      || bounds.minLon >= bounds.maxLon) {
      throw codedError("HRRR_SUBHOURLY_BOUNDS_INVALID", "bounds must contain increasing finite coordinates.");
    }
    return bounds;
  }

  function uniqueBy(values, key) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      const id = key(value);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(value);
    }
    return result;
  }

  function formatUtcDate(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function validDate(value, label) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw codedError("HRRR_SUBHOURLY_TIME_INVALID", `${label || "time"} must be a valid date.`);
    }
    return date;
  }

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }

  function clampInteger(value, fallback, min, max) {
    return Math.round(clampNumber(value, fallback, min, max));
  }

  function codedError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.details = details || null;
    return error;
  }

  function abortError() {
    const error = codedError("HRRR_SUBHOURLY_ABORTED", "HRRR sub-hourly operation was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || error?.code === "HRRR_SUBHOURLY_ABORTED";
  }

  return Object.freeze({
    VERSION,
    PROVIDER,
    BUCKET,
    MAX_FORECAST_MINUTES,
    support,
    createClient,
    discoverSubhourlyFrames,
    selectCanonicalTimes,
    parseHrrrIndex,
    hrrrSubhourlyUrls
  });
});
