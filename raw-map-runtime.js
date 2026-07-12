/*
 * Nearcast raw-map runtime
 *
 * Joins the browser MRMS and HRRR adapters into viewport-sized, blob-backed
 * NCRD frames that can be consumed by Nearcast's existing MapLibre radar
 * chunk layer. This is deliberately a classic script so it can be loaded by
 * the PWA and the native WKWebView without a bundler.
 *
 * Load after hrrr-zarr-adapter.js and
 * experimental/raw-weather/mrms-browser-adapter.js:
 *
 *   const session = NearcastRawMap.createSession({ mode: "both" });
 *   const result = await session.prepare({
 *     bounds: [-90.4, 38.4, -89.7, 39.0],
 *     forecastFrames: 6,
 *     onUpdate(update) { console.debug(update); }
 *   });
 *
 * `result.frames` is chronological. Each descriptor contains an `indexUrl`
 * for one viewport texture and is also available from `result.byValidTime`.
 * A session owns one active result: preparing again revokes the old result's
 * blob URLs. Call result.dispose() or session.dispose() when finished.
 */
(function installNearcastRawMap(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NearcastRawMap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNearcastRawMapApi(root) {
  "use strict";

  const VERSION = "0.1.0";
  const DEFAULT_WIDTH = 512;
  const DEFAULT_HEIGHT = 384;
  const DEFAULT_FORECAST_FRAMES = 6;
  const DEFAULT_HISTORY_FRAMES = 6;
  const DEFAULT_HISTORY_MINUTES = 90;
  const DEFAULT_ENCODING = Object.freeze({
    type: "uint8-dbz",
    dbzMin: 0,
    dbzMax: 80,
    threshold: 5,
    noData: 0,
    valueMin: 1,
    valueMax: 255,
    formula: "dbz = dbzMin + (value - 1) * (dbzMax - dbzMin) / 254"
  });
  const MAX_TEXTURE_PIXELS = 1_048_576;
  const MAX_FORECAST_FRAMES = 12;
  const MAX_MERCATOR_LATITUDE = 85.05112878;

  function support(dependencies = {}) {
    const hrrr = dependencies.hrrr || root.NearcastHrrrZarr;
    const mrms = dependencies.mrms || root.NearcastMrms;
    const urlApi = dependencies.urlApi || root.URL;
    const BlobCtor = dependencies.Blob || root.Blob;
    return Object.freeze({
      supported: Boolean(urlApi?.createObjectURL && urlApi?.revokeObjectURL && BlobCtor),
      blobs: Boolean(urlApi?.createObjectURL && urlApi?.revokeObjectURL && BlobCtor),
      hrrr: Boolean(hrrr?.createClient && hrrr?.projectLonLat),
      mrms: Boolean(mrms?.createClient),
      abortController: typeof root.AbortController === "function"
    });
  }

  function createSession(options = {}) {
    const dependencies = {
      hrrr: options.hrrr || root.NearcastHrrrZarr,
      mrms: options.mrms || root.NearcastMrms,
      urlApi: options.urlApi || root.URL,
      Blob: options.Blob || root.Blob
    };
    const defaultMode = normalizeMode(options.mode || "both");
    const defaultWidth = normalizeDimension(options.width, DEFAULT_WIDTH);
    const defaultHeight = normalizeDimension(options.height, DEFAULT_HEIGHT);
    assertTextureBudget(defaultWidth, defaultHeight);

    let hrrrClient = null;
    let mrmsClient = null;
    let activeController = null;
    let activeResult = null;
    let prepareSequence = 0;
    let disposed = false;

    async function prepare(input = {}) {
      if (disposed) throw codedError("RAW_MAP_SESSION_DISPOSED", "Raw-map session has been disposed.");
      const capabilities = support(dependencies);
      if (!capabilities.blobs) {
        throw codedError("RAW_MAP_BLOBS_UNAVAILABLE", "Blob URL support is required for raw-map frames.");
      }

      cancelActivePrepare();
      releaseActiveResult();
      const sequence = ++prepareSequence;
      const controller = createAbortController();
      activeController = controller;
      const detachExternalAbort = forwardAbort(input.signal, controller);
      const signal = controller.signal;
      const onUpdate = typeof input.onUpdate === "function" ? input.onUpdate : null;
      const mode = normalizeMode(input.mode || defaultMode);
      const bounds = normalizeBounds(input.bounds, input.place);
      const width = normalizeDimension(input.width, defaultWidth);
      const height = normalizeDimension(input.height, defaultHeight);
      assertTextureBudget(width, height);
      const encoding = normalizeEncoding({ ...DEFAULT_ENCODING, ...(options.encoding || {}), ...(input.encoding || {}) });
      const forecastSelection = normalizeForecastSelection(
        input.forecastFrames ?? options.forecastFrames ?? DEFAULT_FORECAST_FRAMES
      );
      const localUrls = new Set();
      const startedAt = nowMs();

      const context = {
        sequence,
        signal,
        mode,
        bounds,
        width,
        height,
        encoding,
        place: cleanPlace(input.place),
        forecastSelection,
        historyFrames: clampInteger(
          input.historyFrames ?? options.historyFrames,
          DEFAULT_HISTORY_FRAMES,
          1,
          6
        ),
        historyMinutes: clampNumber(
          input.historyMinutes ?? options.historyMinutes,
          DEFAULT_HISTORY_MINUTES,
          15,
          180
        ),
        onUpdate,
        localUrls,
        options
      };

      emit(context, {
        stage: "start",
        mode,
        bounds,
        width,
        height,
        forecastFrames: forecastSelection.count
      });

      const requestedProviders = [];
      if (mode !== "forecast") requestedProviders.push(["observed", () => loadObserved(context)]);
      if (mode !== "observed") requestedProviders.push(["forecast", () => loadForecast(context)]);

      try {
        const providerResults = await Promise.all(requestedProviders.map(([kind, operation]) =>
          settleProvider(kind, operation, context)
        ));
        throwIfAborted(signal);
        if (disposed || sequence !== prepareSequence) throw abortError();

        const frames = providerResults
          .flatMap((result) => result.frames || [])
          .sort((left, right) => Date.parse(left.validTime) - Date.parse(right.validTime));
        const errors = providerResults.flatMap((result) => result.error ? [result.error] : []);
        const observed = frames.filter((frame) => frame.kind === "observed");
        const forecast = frames.filter((frame) => frame.kind === "forecast");
        const byValidTime = indexDescriptors(frames);
        const observedByValidTime = indexDescriptors(observed);
        const forecastByValidTime = indexDescriptors(forecast);
        let resultDisposed = false;

        const result = Object.freeze({
          status: frames.length ? (errors.length ? "partial" : "ready") : "unavailable",
          mode,
          bounds,
          width,
          height,
          place: context.place,
          frames: Object.freeze(frames),
          descriptors: Object.freeze(frames),
          observed: Object.freeze(observed),
          forecast: Object.freeze(forecast),
          byValidTime: Object.freeze(byValidTime),
          observedByValidTime: Object.freeze(observedByValidTime),
          forecastByValidTime: Object.freeze(forecastByValidTime),
          errors: Object.freeze(errors),
          preparedAt: new Date().toISOString(),
          elapsedMs: Math.round(nowMs() - startedAt),
          dispose() {
            if (resultDisposed) return;
            resultDisposed = true;
            revokeUrls(localUrls, dependencies.urlApi);
            releaseClients();
            if (activeResult === result) activeResult = null;
          }
        });

        activeResult = result;
        emit(context, {
          stage: "complete",
          status: result.status,
          observedFrames: observed.length,
          forecastFrames: forecast.length,
          errors,
          elapsedMs: result.elapsedMs
        });
        if (input.strict === true && errors.length) {
          result.dispose();
          throw aggregateProviderError(errors);
        }
        return result;
      } catch (error) {
        revokeUrls(localUrls, dependencies.urlApi);
        if (isAbortError(error)) emit(context, { stage: "aborted" });
        throw error;
      } finally {
        detachExternalAbort();
        if (activeController === controller) activeController = null;
      }
    }

    async function loadObserved(context) {
      const api = dependencies.mrms;
      if (!api?.createClient) {
        throw codedError("MRMS_ADAPTER_UNAVAILABLE", "NearcastMrms must be loaded before raw-map-runtime.js.");
      }
      if (!mrmsClient) mrmsClient = api.createClient(context.options.mrmsClientOptions || {});
      emit(context, { stage: "observed-loading", provider: "noaa-mrms-direct" });
      const onAbort = () => mrmsClient?.cancel?.();
      context.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const history = await mrmsClient.loadHistory({
          bounds: context.bounds,
          width: context.width,
          height: context.height,
          maxFrames: context.historyFrames,
          minutes: context.historyMinutes,
          maxTextureBytes: context.width * context.height * context.historyFrames,
          threshold: context.encoding.threshold,
          dbzMin: context.encoding.dbzMin,
          dbzMax: context.encoding.dbzMax,
          signal: context.signal,
          retainTextures: true,
          onFrame(frame, progress) {
            emit(context, {
              stage: "observed-progress",
              provider: "noaa-mrms-direct",
              completed: progress.index + 1,
              total: progress.count,
              progress: progress.progress,
              validTime: frame.observedAt
            });
          }
        });
        throwIfAborted(context.signal);
        return history.frames.map((frame) => packageTexture(context, {
          kind: "observed",
          provider: "noaa-mrms-direct",
          attribution: history.attribution || "NOAA/NWS MRMS",
          visualMetric: "reflectivity",
          validTime: validIso(frame.observedAt),
          texture: frame.data,
          encoding: frame.encoding || context.encoding,
          source: {
            product: frame.product || history.product,
            region: frame.region || history.region,
            url: frame.sourceUrl || frame.url || null,
            metrics: frame.metrics || null
          }
        }));
      } finally {
        context.signal.removeEventListener("abort", onAbort);
      }
    }

    async function loadForecast(context) {
      const api = dependencies.hrrr;
      if (!api?.createClient || !api?.projectLonLat) {
        throw codedError("HRRR_ADAPTER_UNAVAILABLE", "NearcastHrrrZarr must be loaded before raw-map-runtime.js.");
      }
      if (!hrrrClient) {
        hrrrClient = api.createClient({
          maxChunks: clampInteger(context.options.maxHrrrChunks, 32, 1, 64),
          concurrency: clampInteger(context.options.hrrrConcurrency, 4, 1, 8),
          ...(context.options.hrrrClientOptions || {})
        });
      }
      emit(context, { stage: "forecast-discovering", provider: "noaa-hrrr-zarr" });
      const run = await hrrrClient.discoverLatestRun({
        signal: context.signal,
        now: context.forecastSelection.now,
        minForecastSteps: Math.max(2, context.forecastSelection.count)
      });
      const grid = await hrrrClient.loadGrid(run, { signal: context.signal });
      throwIfAborted(context.signal);
      emit(context, {
        stage: "forecast-loading",
        provider: "noaa-hrrr-zarr",
        cycle: run.cycle,
        cycleTime: run.cycleIso
      });
      const visible = await hrrrClient.fetchVisible({
        run,
        grid,
        bounds: boundsArray(context.bounds),
        ...context.forecastSelection.adapterOptions,
        now: context.forecastSelection.now,
        paddingChunks: 1,
        maxChunks: clampInteger(context.options.maxHrrrChunks, 32, 1, 64),
        signal: context.signal,
        onProgress(progress) {
          emit(context, {
            stage: "forecast-download-progress",
            provider: "noaa-hrrr-zarr",
            completed: progress.completed,
            total: progress.total
          });
        }
      });
      throwIfAborted(context.signal);
      emit(context, {
        stage: "forecast-resampling",
        provider: "noaa-hrrr-zarr",
        frames: visible.steps.length,
        chunks: visible.chunks.length
      });
      const textures = resampleHrrrForecast({
        api,
        visible,
        grid,
        bounds: context.bounds,
        width: context.width,
        height: context.height,
        encoding: context.encoding,
        signal: context.signal,
        onProgress(completed, total, validTime) {
          emit(context, {
            stage: "forecast-resample-progress",
            provider: "noaa-hrrr-zarr",
            completed,
            total,
            progress: total ? completed / total : 1,
            validTime
          });
        }
      });
      return textures.map((item) => packageTexture(context, {
        kind: "forecast",
        provider: "noaa-hrrr-zarr",
        attribution: "NOAA/NWS HRRR",
        visualMetric: "simulated-reflectivity",
        validTime: item.step.validIso,
        texture: item.data,
        encoding: context.encoding,
        stats: item.stats,
        source: {
          product: `${run.level}/${run.variable}`,
          cycle: run.cycle,
          cycleTime: run.cycleIso,
          forecastHour: item.step.forecastHour,
          sourceIndex: item.step.sourceIndex,
          spatialChunks: visible.chunks.map((chunk) => chunk.key)
        }
      }));
    }

    function cancelActivePrepare() {
      if (activeController && !activeController.signal.aborted) activeController.abort();
      mrmsClient?.cancel?.();
      activeController = null;
    }

    function releaseActiveResult() {
      activeResult?.dispose?.();
      activeResult = null;
    }

    function releaseClients() {
      mrmsClient?.destroy?.();
      hrrrClient?.clearCache?.();
      mrmsClient = null;
      hrrrClient = null;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      prepareSequence += 1;
      cancelActivePrepare();
      releaseActiveResult();
      releaseClients();
    }

    return Object.freeze({
      prepare,
      dispose,
      support: () => support(dependencies)
    });
  }

  async function settleProvider(kind, operation, context) {
    try {
      const frames = await operation();
      throwIfAborted(context.signal);
      emit(context, { stage: `${kind}-ready`, frames: frames.length });
      return { kind, frames };
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) throw error;
      const serialized = serializeProviderError(kind, error);
      emit(context, { stage: `${kind}-unavailable`, error: serialized });
      return { kind, frames: [], error: serialized };
    }
  }

  function resampleHrrrForecast(options) {
    const { api, visible, grid, bounds, width, height, encoding, signal } = options;
    const steps = visible.steps || [];
    const chunks = visible.chunks || [];
    const output = steps.map((step) => ({
      step,
      data: new Uint8Array(width * height),
      stats: { precipPixels: 0, minDbz: Infinity, maxDbz: -Infinity }
    }));
    if (!steps.length || !chunks.length) return output;

    const chunkWidth = Number(chunks[0].width || chunks[0].shape?.[2]);
    const chunkHeight = Number(chunks[0].height || chunks[0].shape?.[1]);
    const planeSize = chunkWidth * chunkHeight;
    const chunkIndexes = new Map(chunks.map((chunk, index) => [`${chunk.chunkY}.${chunk.chunkX}`, index]));
    const xSpacing = Number(grid.xSpacing);
    const ySpacing = Number(grid.ySpacing);
    const xOrigin = Number(grid.x?.[0]);
    const yOrigin = Number(grid.y?.[0]);
    if (![chunkWidth, chunkHeight, planeSize, xSpacing, ySpacing, xOrigin, yOrigin].every(Number.isFinite) ||
        !chunkWidth || !chunkHeight || !xSpacing || !ySpacing) {
      throw codedError("HRRR_GRID_INVALID", "HRRR grid metadata is incomplete.");
    }

    const northWorldY = mercatorY(bounds.maxLat);
    const southWorldY = mercatorY(bounds.minLat);
    for (let outY = 0; outY < height; outY += 1) {
      if ((outY & 15) === 0) throwIfAborted(signal);
      const worldY = northWorldY + (outY + 0.5) / height * (southWorldY - northWorldY);
      const latitude = inverseMercatorY(worldY);
      const rowOffset = outY * width;
      for (let outX = 0; outX < width; outX += 1) {
        const longitude = bounds.minLon + (outX + 0.5) / width * (bounds.maxLon - bounds.minLon);
        const projected = api.projectLonLat(longitude, latitude, grid.projection);
        const sourceX = (projected.x - xOrigin) / xSpacing;
        const sourceY = (projected.y - yOrigin) / ySpacing;
        const x0 = Math.floor(sourceX);
        const y0 = Math.floor(sourceY);
        const fx = sourceX - x0;
        const fy = sourceY - y0;
        const refs = [
          hrrrSourceRef(x0, y0, chunks, chunkIndexes, chunkWidth, chunkHeight, planeSize),
          hrrrSourceRef(x0 + 1, y0, chunks, chunkIndexes, chunkWidth, chunkHeight, planeSize),
          hrrrSourceRef(x0, y0 + 1, chunks, chunkIndexes, chunkWidth, chunkHeight, planeSize),
          hrrrSourceRef(x0 + 1, y0 + 1, chunks, chunkIndexes, chunkWidth, chunkHeight, planeSize)
        ];
        const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
        const outIndex = rowOffset + outX;
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
          let sum = 0;
          let weightSum = 0;
          for (let corner = 0; corner < 4; corner += 1) {
            const ref = refs[corner];
            if (ref < 0 || weights[corner] <= 0) continue;
            const chunkIndex = Math.floor(ref / planeSize);
            const sourceOffset = ref - chunkIndex * planeSize;
            const value = chunks[chunkIndex].values[stepIndex * planeSize + sourceOffset];
            if (!isUsableDbz(value)) continue;
            sum += value * weights[corner];
            weightSum += weights[corner];
          }
          if (!weightSum) continue;
          const dbz = sum / weightSum;
          if (dbz < encoding.threshold) continue;
          const item = output[stepIndex];
          item.data[outIndex] = encodeDbz(dbz, encoding);
          item.stats.precipPixels += 1;
          if (dbz < item.stats.minDbz) item.stats.minDbz = dbz;
          if (dbz > item.stats.maxDbz) item.stats.maxDbz = dbz;
        }
      }
      if ((outY & 31) === 31 || outY === height - 1) {
        options.onProgress?.(outY + 1, height, null);
      }
    }

    output.forEach((item, index) => {
      item.stats.minDbz = finiteOrNull(item.stats.minDbz);
      item.stats.maxDbz = finiteOrNull(item.stats.maxDbz);
      item.stats.outputPixels = item.data.length;
      options.onProgress?.(index + 1, output.length, item.step.validIso);
    });
    return output;
  }

  function hrrrSourceRef(x, y, chunks, indexes, chunkWidth, chunkHeight, planeSize) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return -1;
    const chunkX = Math.floor(x / chunkWidth);
    const chunkY = Math.floor(y / chunkHeight);
    const chunkIndex = indexes.get(`${chunkY}.${chunkX}`);
    if (!Number.isInteger(chunkIndex)) return -1;
    const chunk = chunks[chunkIndex];
    const localX = x - chunk.gridOffsetX;
    const localY = y - chunk.gridOffsetY;
    if (localX < 0 || localY < 0 || localX >= chunk.logicalWidth || localY >= chunk.logicalHeight) return -1;
    return chunkIndex * planeSize + localY * chunkWidth + localX;
  }

  function packageTexture(context, input) {
    throwIfAborted(context.signal);
    const data = input.texture instanceof Uint8Array ? input.texture : new Uint8Array(input.texture || 0);
    if (data.length !== context.width * context.height) {
      throw codedError("RAW_MAP_TEXTURE_INVALID", `Texture has ${data.length} bytes; expected ${context.width * context.height}.`);
    }
    const validTime = validIso(input.validTime);
    const stats = normalizeTextureStats(input.stats || textureStats(data, input.encoding));
    const meta = {
      provider: "nearcast-raw-map",
      version: 1,
      sourceProvider: input.provider,
      kind: input.kind,
      validTime,
      timestamp: validTime,
      visualMetric: input.visualMetric,
      width: context.width,
      height: context.height,
      projection: "web-mercator-bounds",
      bounds: context.bounds,
      valueEncoding: normalizeEncoding(input.encoding || context.encoding)
    };
    const binary = encodeNcrd(meta, data);
    const chunkBlob = createBlob(context, binary, "application/vnd.nearcast.radar-chunk");
    const chunkUrl = createTrackedUrl(context, chunkBlob);
    try {
      const index = buildChunkIndex({
        context,
        input,
        validTime,
        chunkUrl,
        byteLength: binary.byteLength,
        stats,
        valueEncoding: meta.valueEncoding
      });
      const indexBlob = createBlob(
        context,
        JSON.stringify(index),
        "application/json"
      );
      const indexUrl = createTrackedUrl(context, indexBlob);
      return Object.freeze({
        kind: input.kind,
        provider: input.provider,
        attribution: input.attribution,
        visualMetric: input.visualMetric,
        validTime,
        timestamp: validTime,
        indexUrl,
        chunkUrl,
        width: context.width,
        height: context.height,
        bounds: context.bounds,
        valueEncoding: meta.valueEncoding,
        stats: Object.freeze(stats),
        source: Object.freeze(input.source || {})
      });
    } catch (error) {
      revokeTrackedUrl(context, chunkUrl);
      throw error;
    }
  }

  function createBlob(context, parts, type) {
    const BlobCtor = context.options.Blob || root.Blob;
    if (typeof BlobCtor !== "function") throw codedError("RAW_MAP_BLOB_UNAVAILABLE", "Blob is unavailable.");
    return new BlobCtor(Array.isArray(parts) ? parts : [parts], { type });
  }

  function createTrackedUrl(context, blob) {
    const urlApi = context.options.urlApi || root.URL;
    if (!urlApi?.createObjectURL) throw codedError("RAW_MAP_BLOB_URL_UNAVAILABLE", "URL.createObjectURL is unavailable.");
    const url = urlApi.createObjectURL(blob);
    context.localUrls.add(url);
    return url;
  }

  function revokeTrackedUrl(context, url) {
    if (!context.localUrls.delete(url)) return;
    try {
      (context.options.urlApi || root.URL)?.revokeObjectURL?.(url);
    } catch {
      // URL cleanup is best-effort.
    }
  }

  function buildChunkIndex(options) {
    const { context, input, validTime, chunkUrl, byteLength, stats, valueEncoding } = options;
    const source = input.source || {};
    return {
      provider: "nearcast-raw-map",
      version: 1,
      generatedAt: new Date().toISOString(),
      product: source.product || input.visualMetric,
      region: source.region || "viewport",
      bounds: context.bounds,
      frame: {
        kind: input.kind,
        provider: input.provider,
        validTime,
        timestamp: validTime,
        observedAt: input.kind === "observed" ? validTime : null,
        forecastHour: Number.isFinite(Number(source.forecastHour)) ? Number(source.forecastHour) : null,
        cycleTime: source.cycleTime || null,
        stats
      },
      renderIntent: {
        clientRendering: "custom-webgl-radar-layer",
        colorizeOnDevice: true,
        animateOnDevice: true
      },
      valueEncoding,
      canonical: {
        baseZoom: 0,
        chunkSize: Math.max(context.width, context.height),
        bounds: context.bounds,
        pixels: context.width * context.height,
        validPixels: stats.precipPixels
      },
      levels: [{
        id: "viewport",
        zoom: 0,
        chunkSize: Math.max(context.width, context.height),
        pool: "viewport",
        bounds: context.bounds,
        chunkCount: 1,
        chunks: [{
          x: 0,
          y: 0,
          path: chunkUrl,
          byteLength,
          precipPixels: stats.precipPixels,
          minDbz: stats.minDbz,
          maxDbz: stats.maxDbz,
          bounds: context.bounds
        }]
      }]
    };
  }

  function encodeNcrd(meta, payload) {
    const header = new TextEncoder().encode(`${JSON.stringify(meta)}\n`);
    if (header.byteLength > 65_535) throw codedError("NCRD_HEADER_TOO_LARGE", "NCRD header exceeds 65,535 bytes.");
    const bytes = new Uint8Array(12 + header.byteLength + payload.byteLength);
    bytes.set([0x4e, 0x43, 0x52, 0x44], 0);
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 1);
    view.setUint16(6, header.byteLength);
    view.setUint32(8, payload.byteLength);
    bytes.set(header, 12);
    bytes.set(payload, 12 + header.byteLength);
    return bytes;
  }

  function normalizeForecastSelection(value) {
    const now = new Date();
    if (Array.isArray(value)) {
      const hours = value.map(forecastHourFromValue).filter(Number.isFinite);
      if (hours.length) {
        const selected = uniqueNumbers(hours).slice(0, MAX_FORECAST_FRAMES);
        return { count: selected.length, now, adapterOptions: { hoursAhead: selected } };
      }
      const validTimes = value.map(forecastTimeFromValue).filter(Boolean).slice(0, MAX_FORECAST_FRAMES);
      if (validTimes.length) {
        return { count: validTimes.length, now, adapterOptions: { validTimes } };
      }
    }
    const count = clampInteger(value, DEFAULT_FORECAST_FRAMES, 1, MAX_FORECAST_FRAMES);
    const hoursAhead = Array.from({ length: count }, (_, index) => index + 1);
    return { count, now, adapterOptions: { hoursAhead } };
  }

  function forecastHourFromValue(value) {
    if (typeof value === "number") return value >= 0 && value <= 48 ? value : NaN;
    if (!value || typeof value !== "object") return NaN;
    const hour = Number(value.hoursAhead ?? value.hourAhead ?? value.forecastHour ?? value.hour);
    return hour >= 0 && hour <= 48 ? hour : NaN;
  }

  function forecastTimeFromValue(value) {
    const source = value && typeof value === "object"
      ? value.validTime ?? value.timestamp ?? value.time
      : value;
    const date = new Date(source);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function normalizeMode(value) {
    const mode = String(value || "both").trim().toLowerCase();
    if (["observed", "history", "historical", "past"].includes(mode)) return "observed";
    if (["forecast", "future", "guidance"].includes(mode)) return "forecast";
    if (["both", "all", "timeline"].includes(mode)) return "both";
    throw codedError("RAW_MAP_MODE_INVALID", `Unsupported raw-map mode: ${value}`);
  }

  function normalizeBounds(input, place) {
    let minLon;
    let minLat;
    let maxLon;
    let maxLat;
    if (Array.isArray(input)) {
      [minLon, minLat, maxLon, maxLat] = input.map(Number);
    } else if (input && typeof input.getWest === "function") {
      minLon = Number(input.getWest());
      minLat = Number(input.getSouth());
      maxLon = Number(input.getEast());
      maxLat = Number(input.getNorth());
    } else if (input && typeof input === "object") {
      minLon = Number(input.minLon ?? input.west ?? input.left);
      minLat = Number(input.minLat ?? input.south ?? input.bottom);
      maxLon = Number(input.maxLon ?? input.east ?? input.right);
      maxLat = Number(input.maxLat ?? input.north ?? input.top);
    } else {
      const latitude = Number(place?.latitude ?? place?.lat);
      const longitude = Number(place?.longitude ?? place?.lon ?? place?.lng);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        minLon = longitude - 0.7;
        maxLon = longitude + 0.7;
        minLat = latitude - 0.5;
        maxLat = latitude + 0.5;
      }
    }
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite) ||
        minLon >= maxLon || minLat >= maxLat ||
        minLon < -180 || maxLon > 180 ||
        minLat < -MAX_MERCATOR_LATITUDE || maxLat > MAX_MERCATOR_LATITUDE) {
      throw codedError("RAW_MAP_BOUNDS_INVALID", "Bounds must be an increasing [west, south, east, north] Web Mercator extent.");
    }
    return Object.freeze({ minLon, minLat, maxLon, maxLat });
  }

  function boundsArray(bounds) {
    return [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat];
  }

  function normalizeEncoding(input) {
    const dbzMin = clampNumber(input.dbzMin, 0, -20, 40);
    const dbzMax = clampNumber(input.dbzMax, 80, 41, 120);
    if (dbzMax <= dbzMin) throw codedError("RAW_MAP_ENCODING_INVALID", "dbzMax must exceed dbzMin.");
    return Object.freeze({
      type: "uint8-dbz",
      dbzMin,
      dbzMax,
      threshold: clampNumber(input.threshold, 5, -10, dbzMax),
      noData: 0,
      valueMin: 1,
      valueMax: 255,
      formula: DEFAULT_ENCODING.formula
    });
  }

  function textureStats(data, encoding) {
    let precipPixels = 0;
    let minDbz = Infinity;
    let maxDbz = -Infinity;
    for (const encoded of data) {
      if (!encoded) continue;
      const dbz = encoding.dbzMin + (encoded - 1) / 254 * (encoding.dbzMax - encoding.dbzMin);
      precipPixels += 1;
      if (dbz < minDbz) minDbz = dbz;
      if (dbz > maxDbz) maxDbz = dbz;
    }
    return normalizeTextureStats({ precipPixels, minDbz, maxDbz, outputPixels: data.length });
  }

  function normalizeTextureStats(stats) {
    return {
      precipPixels: Number(stats.precipPixels) || 0,
      minDbz: finiteOrNull(Number(stats.minDbz)),
      maxDbz: finiteOrNull(Number(stats.maxDbz)),
      outputPixels: Number(stats.outputPixels) || 0
    };
  }

  function encodeDbz(value, encoding) {
    const clamped = Math.max(encoding.dbzMin, Math.min(encoding.dbzMax, value));
    return Math.max(1, Math.min(255, Math.round(
      1 + (clamped - encoding.dbzMin) / (encoding.dbzMax - encoding.dbzMin) * 254
    )));
  }

  function isUsableDbz(value) {
    return Number.isFinite(value) && value > -100 && value <= 150;
  }

  function mercatorY(latitude) {
    const radians = Number(latitude) * Math.PI / 180;
    return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
  }

  function inverseMercatorY(value) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * value))) * 180 / Math.PI;
  }

  function indexDescriptors(frames) {
    const result = {};
    for (const frame of frames) result[frame.validTime] = frame;
    return result;
  }

  function cleanPlace(place) {
    if (!place || typeof place !== "object") return null;
    const latitude = Number(place.latitude ?? place.lat);
    const longitude = Number(place.longitude ?? place.lon ?? place.lng);
    return Object.freeze({
      name: String(place.name || place.label || place.city || "").trim(),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null
    });
  }

  function validIso(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw codedError("RAW_MAP_TIME_INVALID", `Invalid frame time: ${value}`);
    return date.toISOString();
  }

  function uniqueNumbers(values) {
    return [...new Set(values.map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
  }

  function normalizeDimension(value, fallback) {
    return clampInteger(value, fallback, 64, 1024);
  }

  function assertTextureBudget(width, height) {
    if (width * height > MAX_TEXTURE_PIXELS) {
      throw codedError("RAW_MAP_TEXTURE_TOO_LARGE", `Texture exceeds ${MAX_TEXTURE_PIXELS.toLocaleString()} pixels.`);
    }
  }

  function clampNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function clampInteger(value, fallback, minimum, maximum) {
    return Math.round(clampNumber(value, fallback, minimum, maximum));
  }

  function finiteOrNull(value) {
    return Number.isFinite(value) ? value : null;
  }

  function nowMs() {
    return typeof root.performance?.now === "function" ? root.performance.now() : Date.now();
  }

  function emit(context, update) {
    if (!context.onUpdate) return;
    try {
      context.onUpdate(Object.freeze({ ...update, at: new Date().toISOString() }));
    } catch {
      // Consumer diagnostics must not interrupt a weather load.
    }
  }

  function createAbortController() {
    if (typeof root.AbortController !== "function") {
      throw codedError("ABORT_CONTROLLER_UNAVAILABLE", "AbortController is required for raw-map sessions.");
    }
    return new root.AbortController();
  }

  function forwardAbort(externalSignal, controller) {
    if (!externalSignal?.addEventListener) return () => {};
    const abort = () => controller.abort(externalSignal.reason);
    if (externalSignal.aborted) abort();
    else externalSignal.addEventListener("abort", abort, { once: true });
    return () => externalSignal.removeEventListener?.("abort", abort);
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }

  function abortError() {
    if (typeof root.DOMException === "function") return new root.DOMException("The operation was aborted.", "AbortError");
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || error?.code === "ABORT_ERR";
  }

  function codedError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

  function serializeProviderError(provider, error) {
    return Object.freeze({
      provider,
      code: error?.code || "RAW_MAP_PROVIDER_ERROR",
      message: error?.message || String(error)
    });
  }

  function aggregateProviderError(errors) {
    const message = errors.map((error) => `${error.provider}: ${error.message}`).join("; ");
    if (typeof root.AggregateError === "function") return new root.AggregateError([], message);
    return codedError("RAW_MAP_PROVIDER_ERRORS", message, errors);
  }

  function revokeUrls(urls, urlApi) {
    for (const url of urls) {
      try {
        urlApi?.revokeObjectURL?.(url);
      } catch {
        // URL cleanup is best-effort.
      }
    }
    urls.clear();
  }

  return Object.freeze({
    VERSION,
    createSession,
    support
  });
});
