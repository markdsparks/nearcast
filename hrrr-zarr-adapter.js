/*
 * Nearcast HRRR Zarr adapter
 *
 * Browser-first, dependency-free reader for the public HRRR surface-forecast
 * Zarr archive at https://hrrrzarr.s3.amazonaws.com/. The archive stores
 * composite reflectivity (REFC) as Zarr v2 chunks compressed with Blosc/LZ4.
 *
 * Classic-script usage:
 *
 *   const client = NearcastHrrrZarr.createClient();
 *   const run = await client.discoverLatestRun();
 *   const result = await client.fetchVisible({
 *     run,
 *     bounds: [-90.6, 38.2, -89.5, 39.1],
 *     hoursAhead: [0, 1, 2, 3, 4, 5, 6]
 *   });
 *
 * `result.chunks[*].values` is a compact Float32Array in
 * [selected time, y, x] order. Each spatial plane remains the Zarr storage
 * size (normally 150 x 150); `logicalWidth` and `logicalHeight` describe the
 * valid portion of edge chunks. Rows progress from lower to higher projected
 * y. `corners` contains the four projected-grid corners converted to lon/lat.
 */
(function installNearcastHrrrZarr(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NearcastHrrrZarr = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNearcastHrrrZarrApi() {
  "use strict";

  const VERSION = "0.1.0";
  const DEFAULT_BUCKET = "https://hrrrzarr.s3.amazonaws.com";
  const DEFAULT_PRODUCT = Object.freeze({
    level: "entire_atmosphere",
    variable: "REFC"
  });
  const DEFAULT_PROJECTION = Object.freeze({
    a: 6371229,
    b: 6371229,
    proj: "lcc",
    lon_0: 262.5,
    lat_0: 38.5,
    lat_1: 38.5,
    lat_2: 38.5
  });
  const HOURS_MS = 60 * 60 * 1000;
  const DAYS_MS = 24 * HOURS_MS;
  const MAX_SPLITS = 16;
  const MIN_BUFFER_SIZE = 128;

  class HrrrZarrError extends Error {
    constructor(message, code, details) {
      super(message);
      this.name = "HrrrZarrError";
      this.code = code || "HRRR_ZARR_ERROR";
      if (details !== undefined) this.details = details;
    }
  }

  class HrrrZarrClient {
    constructor(options = {}) {
      this.bucket = trimTrailingSlash(options.bucket || DEFAULT_BUCKET);
      this.fetch = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
      this.product = {
        level: options.level || DEFAULT_PRODUCT.level,
        variable: options.variable || DEFAULT_PRODUCT.variable
      };
      this.maxChunks = positiveInteger(options.maxChunks, 24);
      this.concurrency = positiveInteger(options.concurrency, 4);
      this._projectionPromise = null;
      this._gridPromises = new Map();
      this._chunkPromises = new Map();
      if (!this.fetch) {
        throw new HrrrZarrError("A Fetch API implementation is required", "FETCH_UNAVAILABLE");
      }
    }

    async discoverLatestRun(options = {}) {
      const now = validDate(options.now || new Date());
      const lookbackDays = positiveInteger(options.lookbackDays, 2);
      const minForecastSteps = positiveInteger(options.minForecastSteps, 6);
      const signal = options.signal;
      let candidates = [];
      let listingError = null;

      try {
        candidates = await this._listRunCandidates(now, lookbackDays, signal);
      } catch (error) {
        listingError = error;
      }
      if (!candidates.length) {
        candidates = deterministicRunCandidates(now, lookbackDays, this.bucket);
      }

      const failures = [];
      for (const candidate of candidates) {
        try {
          const run = await this._loadRunMetadata(candidate, signal);
          if (run.shape[0] < minForecastSteps) {
            failures.push({ cycle: run.cycle, reason: `only ${run.shape[0]} forecast steps` });
            continue;
          }
          return run;
        } catch (error) {
          if (isAbortError(error)) throw error;
          failures.push({ cycle: candidate.cycle, reason: error.message || String(error) });
        }
      }

      throw new HrrrZarrError(
        "No usable HRRR REFC forecast run was found",
        "RUN_NOT_FOUND",
        { listingError: listingError?.message || null, failures: failures.slice(0, 12) }
      );
    }

    async loadGrid(run, options = {}) {
      assertRun(run);
      const cacheKey = run.productRoot;
      if (!this._gridPromises.has(cacheKey)) {
        const promise = this._loadGrid(run, options.signal).catch((error) => {
          this._gridPromises.delete(cacheKey);
          throw error;
        });
        this._gridPromises.set(cacheKey, promise);
      }
      return this._gridPromises.get(cacheKey);
    }

    async visibleChunkDescriptors(options = {}) {
      const run = options.run || await this.discoverLatestRun(options);
      const grid = options.grid || await this.loadGrid(run, options);
      const bounds = normalizeBounds(options.bounds);
      const paddingChunks = nonNegativeInteger(options.paddingChunks, 0);
      const maxChunks = positiveInteger(options.maxChunks, this.maxChunks);
      const descriptors = descriptorsForBounds(run, grid, bounds, paddingChunks);
      if (descriptors.length > maxChunks) {
        throw new HrrrZarrError(
          `Viewport requires ${descriptors.length} HRRR chunks; limit is ${maxChunks}`,
          "TOO_MANY_CHUNKS",
          { bounds, chunkCount: descriptors.length, maxChunks }
        );
      }
      return { run, grid, bounds, descriptors };
    }

    selectSteps(grid, options = {}) {
      if (!grid?.steps?.length) return [];
      return selectForecastSteps(grid.steps, options);
    }

    async fetchVisible(options = {}) {
      const run = options.run || await this.discoverLatestRun(options);
      const grid = options.grid || await this.loadGrid(run, options);
      const selection = await this.visibleChunkDescriptors({ ...options, run, grid });
      const steps = this.selectSteps(grid, options);
      if (!steps.length) {
        throw new HrrrZarrError("No forecast steps matched the request", "NO_FORECAST_STEPS");
      }

      const concurrency = positiveInteger(options.concurrency, this.concurrency);
      let completed = 0;
      const chunks = await mapConcurrent(selection.descriptors, concurrency, async (descriptor) => {
        const chunk = await this._fetchSelectedChunk(run, grid, descriptor, steps, options.signal);
        completed += 1;
        if (typeof options.onProgress === "function") {
          options.onProgress({ completed, total: selection.descriptors.length, descriptor });
        }
        return chunk;
      });

      return {
        source: "HRRR-Zarr",
        variable: run.variable,
        level: run.level,
        run,
        grid: {
          projection: grid.projection,
          xCount: grid.x.length,
          yCount: grid.y.length,
          xSpacing: grid.xSpacing,
          ySpacing: grid.ySpacing
        },
        bounds: selection.bounds,
        steps,
        chunks,
        fetchedAt: new Date().toISOString(),
        byteLength: chunks.reduce((sum, chunk) => sum + chunk.values.byteLength, 0)
      };
    }

    clearCache() {
      this._gridPromises.clear();
      this._chunkPromises.clear();
      this._projectionPromise = null;
    }

    async _listRunCandidates(now, lookbackDays, signal) {
      const dateStamps = [];
      const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      for (let offset = 0; offset < lookbackDays; offset += 1) {
        dateStamps.push(formatUtcDate(new Date(start - offset * DAYS_MS)));
      }

      const listings = await Promise.all(dateStamps.map(async (dateStamp) => {
        const query = new URLSearchParams({
          "list-type": "2",
          prefix: `sfc/${dateStamp}/`,
          delimiter: "/"
        });
        const response = await this.fetch(`${this.bucket}/?${query}`, { signal, cache: "no-store" });
        if (!response.ok) {
          throw new HrrrZarrError(`HRRR bucket listing failed: ${response.status}`, "LISTING_FAILED");
        }
        return response.text();
      }));

      const candidates = [];
      for (const xml of listings) {
        for (const prefix of commonPrefixesFromXml(xml)) {
          const candidate = candidateFromPrefix(prefix, this.bucket);
          if (candidate && candidate.cycleTime.getTime() <= now.getTime() + HOURS_MS) {
            candidates.push(candidate);
          }
        }
      }
      return uniqueBy(candidates, (candidate) => candidate.runRoot)
        .sort((left, right) => right.cycleTime - left.cycleTime);
    }

    async _loadRunMetadata(candidate, signal) {
      const level = this.product.level;
      const variable = this.product.variable;
      const productRoot = `${candidate.runRoot}/${level}/${variable}`;
      const metadataUrl = `${productRoot}/.zmetadata`;
      const response = await this.fetch(metadataUrl, { signal, cache: "no-store" });
      if (!response.ok) {
        throw new HrrrZarrError(`REFC metadata unavailable: ${response.status}`, "METADATA_UNAVAILABLE");
      }
      let consolidated;
      try {
        consolidated = JSON.parse(await response.text());
      } catch (error) {
        throw new HrrrZarrError("REFC metadata is not valid JSON", "INVALID_METADATA", error.message);
      }

      const arrayPath = `${level}/${variable}`;
      const array = consolidated?.metadata?.[`${arrayPath}/.zarray`];
      const attrs = consolidated?.metadata?.[`${arrayPath}/.zattrs`] || {};
      validateReflectivityArray(array);
      const cycleTime = candidate.cycleTime || cycleDateFromStamp(candidate.cycle);

      return Object.freeze({
        bucket: this.bucket,
        cycle: candidate.cycle,
        cycleTime,
        cycleIso: cycleTime.toISOString(),
        runRoot: candidate.runRoot,
        productRoot,
        metadataUrl,
        level,
        variable,
        arrayPath,
        shape: array.shape.slice(),
        chunks: array.chunks.slice(),
        dtype: array.dtype,
        fillValue: array.fill_value,
        compressor: { ...array.compressor },
        attrs,
        metadata: consolidated.metadata
      });
    }

    async _loadGrid(run, signal) {
      const projectionPromise = this._loadProjection(signal);
      const xPromise = this._fetchArray(run, "projection_x_coordinate", "0", signal);
      const yPromise = this._fetchArray(run, "projection_y_coordinate", "0", signal);
      const forecastPeriodPromise = this._fetchArray(run, "forecast_period", "0", signal);
      const timePromise = this._fetchArray(run, "time", "0", signal).catch(() => null);
      const [projection, x, y, forecastPeriods, times] = await Promise.all([
        projectionPromise,
        xPromise,
        yPromise,
        forecastPeriodPromise,
        timePromise
      ]);

      if (x.length !== run.shape[2] || y.length !== run.shape[1]) {
        throw new HrrrZarrError(
          "HRRR coordinate dimensions do not match REFC dimensions",
          "GRID_DIMENSION_MISMATCH",
          { shape: run.shape, x: x.length, y: y.length }
        );
      }
      const steps = [];
      for (let index = 0; index < run.shape[0]; index += 1) {
        const forecastHour = Number(forecastPeriods[index]);
        const timestampHours = Number(times?.[index]);
        const validTime = Number.isFinite(timestampHours)
          ? new Date(timestampHours * HOURS_MS)
          : new Date(run.cycleTime.getTime() + forecastHour * HOURS_MS);
        steps.push(Object.freeze({
          sourceIndex: index,
          forecastHour,
          validTime,
          validIso: validTime.toISOString()
        }));
      }

      return Object.freeze({
        projection: Object.freeze({ ...projection }),
        x,
        y,
        xSpacing: medianSpacing(x),
        ySpacing: medianSpacing(y),
        forecastPeriods,
        times,
        steps: Object.freeze(steps)
      });
    }

    async _loadProjection(signal) {
      if (!this._projectionPromise) {
        this._projectionPromise = (async () => {
          try {
            const response = await this.fetch(`${this.bucket}/grid/projparams.json`, {
              signal,
              cache: "force-cache"
            });
            if (!response.ok) throw new Error(`projection request failed: ${response.status}`);
            const projection = JSON.parse(await response.text());
            validateProjection(projection);
            return projection;
          } catch (error) {
            if (isAbortError(error)) throw error;
            return { ...DEFAULT_PROJECTION };
          }
        })().catch((error) => {
          this._projectionPromise = null;
          throw error;
        });
      }
      return this._projectionPromise;
    }

    async _fetchArray(run, arrayPath, chunkKey, signal) {
      const spec = run.metadata?.[`${arrayPath}/.zarray`];
      if (!spec) {
        throw new HrrrZarrError(`Missing Zarr metadata for ${arrayPath}`, "ARRAY_METADATA_MISSING");
      }
      const response = await this.fetch(`${run.productRoot}/${arrayPath}/${chunkKey}`, {
        signal,
        cache: "force-cache"
      });
      if (!response.ok) {
        throw new HrrrZarrError(`${arrayPath} chunk failed: ${response.status}`, "ARRAY_CHUNK_FAILED");
      }
      const encoded = new Uint8Array(await response.arrayBuffer());
      const decoded = decodeZarrBytes(encoded, spec);
      return decodeNumericArray(decoded, spec.dtype);
    }

    async _fetchSelectedChunk(run, grid, descriptor, steps, signal) {
      const timeChunkSize = run.chunks[0];
      const spatialPlaneSize = run.chunks[1] * run.chunks[2];
      const groupedSteps = groupBy(steps, (step) => Math.floor(step.sourceIndex / timeChunkSize));
      const parts = new Map();
      await Promise.all(Array.from(groupedSteps.keys()).map(async (timeChunk) => {
        const cacheKey = `${run.productRoot}|${timeChunk}.${descriptor.chunkY}.${descriptor.chunkX}`;
        if (!this._chunkPromises.has(cacheKey)) {
          // Coalesce concurrent reads, but do not retain the full source chunk.
          // A 48-hour synoptic chunk expands to 4.32 MB; the compact selected
          // frames returned below are the appropriate long-lived cache unit.
          const promise = this._fetchChunkPart(run, descriptor, timeChunk, signal)
            .finally(() => this._chunkPromises.delete(cacheKey));
          this._chunkPromises.set(cacheKey, promise);
        }
        parts.set(timeChunk, await this._chunkPromises.get(cacheKey));
      }));

      const values = new Float32Array(steps.length * spatialPlaneSize);
      steps.forEach((step, outputIndex) => {
        const timeChunk = Math.floor(step.sourceIndex / timeChunkSize);
        const inChunkTime = step.sourceIndex % timeChunkSize;
        const part = parts.get(timeChunk);
        const sourceStart = inChunkTime * spatialPlaneSize;
        values.set(part.subarray(sourceStart, sourceStart + spatialPlaneSize), outputIndex * spatialPlaneSize);
      });

      const chunk = {
        key: `${descriptor.chunkY}.${descriptor.chunkX}`,
        chunkX: descriptor.chunkX,
        chunkY: descriptor.chunkY,
        width: run.chunks[2],
        height: run.chunks[1],
        logicalWidth: descriptor.logicalWidth,
        logicalHeight: descriptor.logicalHeight,
        gridOffsetX: descriptor.gridOffsetX,
        gridOffsetY: descriptor.gridOffsetY,
        projectedBounds: descriptor.projectedBounds,
        corners: descriptor.corners,
        rowOrder: "south-to-north",
        steps,
        shape: [steps.length, run.chunks[1], run.chunks[2]],
        values,
        frame(index) {
          const selectedIndex = typeof index === "object"
            ? steps.findIndex((step) => step.sourceIndex === index.sourceIndex)
            : Number(index);
          if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= steps.length) {
            throw new RangeError(`Forecast frame index ${index} is outside this chunk`);
          }
          const start = selectedIndex * spatialPlaneSize;
          return values.subarray(start, start + spatialPlaneSize);
        }
      };
      return chunk;
    }

    async _fetchChunkPart(run, descriptor, timeChunk, signal) {
      const chunkKey = `${timeChunk}.${descriptor.chunkY}.${descriptor.chunkX}`;
      const url = `${run.productRoot}/${run.arrayPath}/${chunkKey}`;
      const response = await this.fetch(url, { signal, cache: "force-cache" });
      if (!response.ok) {
        throw new HrrrZarrError(`REFC chunk ${chunkKey} failed: ${response.status}`, "REFC_CHUNK_FAILED");
      }
      const encoded = new Uint8Array(await response.arrayBuffer());
      const spec = {
        dtype: run.dtype,
        compressor: run.compressor,
        order: "C"
      };
      const decoded = decodeZarrBytes(encoded, spec);
      const numeric = decodeNumericArray(decoded, run.dtype);
      return numeric instanceof Float32Array ? numeric : Float32Array.from(numeric);
    }
  }

  function createClient(options) {
    return new HrrrZarrClient(options);
  }

  function validateReflectivityArray(array) {
    if (!array || !Array.isArray(array.shape) || array.shape.length !== 3) {
      throw new HrrrZarrError("REFC is not a three-dimensional Zarr array", "INVALID_REFC_ARRAY");
    }
    if (!Array.isArray(array.chunks) || array.chunks.length !== 3) {
      throw new HrrrZarrError("REFC has invalid chunk metadata", "INVALID_REFC_CHUNKS");
    }
    if (array.dtype !== "<f4") {
      throw new HrrrZarrError(`Unsupported REFC dtype ${array.dtype}`, "UNSUPPORTED_REFC_DTYPE");
    }
    const compressor = array.compressor || {};
    if (compressor.id !== "blosc" || !["lz4", "lz4hc"].includes(compressor.cname)) {
      throw new HrrrZarrError(
        `Unsupported REFC compressor ${compressor.id || "none"}/${compressor.cname || "none"}`,
        "UNSUPPORTED_REFC_COMPRESSOR"
      );
    }
  }

  function validateProjection(projection) {
    const required = ["a", "lon_0", "lat_0", "lat_1", "lat_2"];
    if (projection?.proj !== "lcc" || !required.every((key) => Number.isFinite(Number(projection[key])))) {
      throw new HrrrZarrError("Invalid HRRR projection parameters", "INVALID_PROJECTION");
    }
  }

  function decodeZarrBytes(bytes, spec) {
    if (!spec.compressor) return bytes;
    if (spec.compressor.id !== "blosc") {
      throw new HrrrZarrError(`Unsupported Zarr compressor ${spec.compressor.id}`, "UNSUPPORTED_COMPRESSOR");
    }
    if (!["lz4", "lz4hc"].includes(spec.compressor.cname)) {
      throw new HrrrZarrError(
        `Unsupported Blosc codec ${spec.compressor.cname}`,
        "UNSUPPORTED_BLOSC_CODEC"
      );
    }
    return decodeBloscLz4(bytes);
  }

  function decodeBloscLz4(input) {
    const src = toUint8Array(input);
    if (src.byteLength < 16) {
      throw new HrrrZarrError("Blosc payload is shorter than its header", "INVALID_BLOSC_HEADER");
    }
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const flags = src[2];
    const typesize = src[3];
    const nbytes = view.getUint32(4, true);
    const blocksize = view.getUint32(8, true);
    const compressedSize = view.getUint32(12, true);
    if (!nbytes || !blocksize || compressedSize > src.byteLength || typesize < 1) {
      throw new HrrrZarrError("Blosc header contains invalid sizes", "INVALID_BLOSC_SIZES");
    }

    const output = new Uint8Array(nbytes);
    const memcpyed = Boolean(flags & 0x02);
    if (memcpyed) {
      if (src.byteLength < 16 + nbytes) {
        throw new HrrrZarrError("Blosc memcpy payload is truncated", "TRUNCATED_BLOSC_PAYLOAD");
      }
      output.set(src.subarray(16, 16 + nbytes));
      return output;
    }

    const bitshuffled = Boolean(flags & 0x04);
    if (bitshuffled) {
      throw new HrrrZarrError("Blosc bitshuffle is not supported", "UNSUPPORTED_BITSHUFFLE");
    }
    const compressorFormat = (flags & 0xe0) >>> 5;
    if (compressorFormat !== 1 && compressorFormat !== 2) {
      throw new HrrrZarrError(
        `Blosc compressor format ${compressorFormat} is not LZ4`,
        "UNSUPPORTED_BLOSC_FORMAT"
      );
    }

    const nblocks = Math.ceil(nbytes / blocksize);
    const startsEnd = 16 + nblocks * 4;
    if (startsEnd > src.byteLength) {
      throw new HrrrZarrError("Blosc block table is truncated", "TRUNCATED_BLOSC_TABLE");
    }
    const shuffled = Boolean(flags & 0x01);
    const dontSplit = Boolean(flags & 0x10);
    let outputOffset = 0;

    for (let blockIndex = 0; blockIndex < nblocks; blockIndex += 1) {
      const blockStart = view.getUint32(16 + blockIndex * 4, true);
      const blockEnd = blockIndex + 1 < nblocks
        ? view.getUint32(16 + (blockIndex + 1) * 4, true)
        : compressedSize;
      const blockBytes = Math.min(blocksize, nbytes - outputOffset);
      const leftover = blockBytes !== blocksize;
      const canSplit = !dontSplit
        && !leftover
        && typesize <= MAX_SPLITS
        && blocksize / typesize >= MIN_BUFFER_SIZE;
      const splits = canSplit ? typesize : 1;
      const splitBytes = blockBytes / splits;
      if (!Number.isInteger(splitBytes) || blockStart < startsEnd || blockEnd > compressedSize) {
        throw new HrrrZarrError("Blosc block metadata is invalid", "INVALID_BLOSC_BLOCK");
      }

      const block = new Uint8Array(blockBytes);
      let cursor = blockStart;
      let blockOutput = 0;
      for (let split = 0; split < splits; split += 1) {
        if (cursor + 4 > blockEnd) {
          throw new HrrrZarrError("Blosc split header is truncated", "TRUNCATED_BLOSC_SPLIT");
        }
        const splitCompressedBytes = view.getUint32(cursor, true);
        cursor += 4;
        if (cursor + splitCompressedBytes > blockEnd) {
          throw new HrrrZarrError("Blosc split payload is truncated", "TRUNCATED_BLOSC_SPLIT");
        }
        const destination = block.subarray(blockOutput, blockOutput + splitBytes);
        if (splitCompressedBytes === splitBytes) {
          destination.set(src.subarray(cursor, cursor + splitCompressedBytes));
        } else {
          decodeLz4Block(src, cursor, splitCompressedBytes, destination);
        }
        cursor += splitCompressedBytes;
        blockOutput += splitBytes;
      }

      if (shuffled && typesize > 1) {
        unshuffleBytes(block, output, outputOffset, typesize);
      } else {
        output.set(block, outputOffset);
      }
      outputOffset += blockBytes;
    }
    return output;
  }

  function decodeLz4Block(src, sourceOffset, sourceLength, destination) {
    const sourceEnd = sourceOffset + sourceLength;
    let source = sourceOffset;
    let target = 0;

    while (source < sourceEnd) {
      const token = src[source++];
      let literalLength = token >>> 4;
      if (literalLength === 15) {
        let extension;
        do {
          if (source >= sourceEnd) throw invalidLz4("literal length");
          extension = src[source++];
          literalLength += extension;
        } while (extension === 255);
      }
      if (source + literalLength > sourceEnd || target + literalLength > destination.length) {
        throw invalidLz4("literal copy");
      }
      destination.set(src.subarray(source, source + literalLength), target);
      source += literalLength;
      target += literalLength;
      if (source >= sourceEnd) break;

      if (source + 2 > sourceEnd) throw invalidLz4("match offset");
      const matchOffset = src[source] | (src[source + 1] << 8);
      source += 2;
      if (!matchOffset || matchOffset > target) throw invalidLz4("match distance");

      let matchLength = token & 0x0f;
      if (matchLength === 15) {
        let extension;
        do {
          if (source >= sourceEnd) throw invalidLz4("match length");
          extension = src[source++];
          matchLength += extension;
        } while (extension === 255);
      }
      matchLength += 4;
      if (target + matchLength > destination.length) throw invalidLz4("match copy");
      const matchStart = target - matchOffset;
      for (let index = 0; index < matchLength; index += 1) {
        destination[target + index] = destination[matchStart + index];
      }
      target += matchLength;
    }

    if (target !== destination.length) {
      throw invalidLz4(`decoded ${target} bytes; expected ${destination.length}`);
    }
    return destination;
  }

  function invalidLz4(stage) {
    return new HrrrZarrError(`Invalid LZ4 block at ${stage}`, "INVALID_LZ4_BLOCK");
  }

  function unshuffleBytes(shuffled, output, outputOffset, typesize) {
    const elements = Math.floor(shuffled.length / typesize);
    const mainBytes = elements * typesize;
    for (let byteIndex = 0; byteIndex < typesize; byteIndex += 1) {
      const sourceOffset = byteIndex * elements;
      for (let element = 0; element < elements; element += 1) {
        output[outputOffset + element * typesize + byteIndex] = shuffled[sourceOffset + element];
      }
    }
    for (let index = mainBytes; index < shuffled.length; index += 1) {
      output[outputOffset + index] = shuffled[index];
    }
  }

  function decodeNumericArray(bytes, dtype) {
    const descriptor = parseDtype(dtype);
    if (bytes.byteLength % descriptor.bytes !== 0) {
      throw new HrrrZarrError(`Byte length is incompatible with dtype ${dtype}`, "INVALID_DTYPE_LENGTH");
    }
    const length = bytes.byteLength / descriptor.bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const littleEndian = descriptor.endian !== ">";

    if (descriptor.kind === "f" && descriptor.bytes === 4 && littleEndian && hostIsLittleEndian()) {
      return new Float32Array(bytes.buffer, bytes.byteOffset, length);
    }
    if (descriptor.kind === "f" && descriptor.bytes === 8 && littleEndian && hostIsLittleEndian()) {
      return new Float64Array(bytes.buffer, bytes.byteOffset, length);
    }

    const output = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
      const offset = index * descriptor.bytes;
      if (descriptor.kind === "f" && descriptor.bytes === 4) {
        output[index] = view.getFloat32(offset, littleEndian);
      } else if (descriptor.kind === "f" && descriptor.bytes === 8) {
        output[index] = view.getFloat64(offset, littleEndian);
      } else if (descriptor.kind === "i" && descriptor.bytes === 4) {
        output[index] = view.getInt32(offset, littleEndian);
      } else if (descriptor.kind === "u" && descriptor.bytes === 4) {
        output[index] = view.getUint32(offset, littleEndian);
      } else if ((descriptor.kind === "i" || descriptor.kind === "u") && descriptor.bytes === 8) {
        output[index] = readInt64AsNumber(view, offset, littleEndian, descriptor.kind === "i");
      } else {
        throw new HrrrZarrError(`Unsupported dtype ${dtype}`, "UNSUPPORTED_DTYPE");
      }
    }
    return output;
  }

  function parseDtype(dtype) {
    const match = String(dtype || "").match(/^([<>|=])([fiu])(\d+)$/);
    if (!match) throw new HrrrZarrError(`Unsupported dtype ${dtype}`, "UNSUPPORTED_DTYPE");
    return { endian: match[1], kind: match[2], bytes: Number(match[3]) };
  }

  function readInt64AsNumber(view, offset, littleEndian, signed) {
    let high;
    let low;
    if (littleEndian) {
      low = view.getUint32(offset, true);
      high = signed ? view.getInt32(offset + 4, true) : view.getUint32(offset + 4, true);
    } else {
      high = signed ? view.getInt32(offset, false) : view.getUint32(offset, false);
      low = view.getUint32(offset + 4, false);
    }
    return high * 4294967296 + low;
  }

  let littleEndianHost;
  function hostIsLittleEndian() {
    if (littleEndianHost === undefined) {
      const word = new Uint16Array([0x0102]);
      littleEndianHost = new Uint8Array(word.buffer)[0] === 0x02;
    }
    return littleEndianHost;
  }

  function projectLonLat(lon, lat, projection = DEFAULT_PROJECTION) {
    validateProjection(projection);
    const radius = Number(projection.a);
    const phi = degreesToRadians(clamp(Number(lat), -89.999999, 89.999999));
    const lambda = degreesToRadians(Number(lon));
    const phi0 = degreesToRadians(Number(projection.lat_0));
    const phi1 = degreesToRadians(Number(projection.lat_1));
    const phi2 = degreesToRadians(Number(projection.lat_2));
    const lambda0 = degreesToRadians(normalizeLongitude(Number(projection.lon_0)));
    const n = Math.abs(phi1 - phi2) < 1e-12
      ? Math.sin(phi1)
      : Math.log(Math.cos(phi1) / Math.cos(phi2))
        / Math.log(tanHalfPi(phi2) / tanHalfPi(phi1));
    const f = Math.cos(phi1) * Math.pow(tanHalfPi(phi1), n) / n;
    const rho = radius * f / Math.pow(tanHalfPi(phi), n);
    const rho0 = radius * f / Math.pow(tanHalfPi(phi0), n);
    const theta = n * normalizeRadians(lambda - lambda0);
    return {
      x: rho * Math.sin(theta),
      y: rho0 - rho * Math.cos(theta)
    };
  }

  function inverseProject(x, y, projection = DEFAULT_PROJECTION) {
    validateProjection(projection);
    const radius = Number(projection.a);
    const phi0 = degreesToRadians(Number(projection.lat_0));
    const phi1 = degreesToRadians(Number(projection.lat_1));
    const phi2 = degreesToRadians(Number(projection.lat_2));
    const lambda0 = degreesToRadians(normalizeLongitude(Number(projection.lon_0)));
    const n = Math.abs(phi1 - phi2) < 1e-12
      ? Math.sin(phi1)
      : Math.log(Math.cos(phi1) / Math.cos(phi2))
        / Math.log(tanHalfPi(phi2) / tanHalfPi(phi1));
    const f = Math.cos(phi1) * Math.pow(tanHalfPi(phi1), n) / n;
    const rho0 = radius * f / Math.pow(tanHalfPi(phi0), n);
    const rhoSign = n < 0 ? -1 : 1;
    const rho = rhoSign * Math.sqrt(Number(x) ** 2 + (rho0 - Number(y)) ** 2);
    const theta = Math.atan2(Number(x), rho0 - Number(y));
    const phi = 2 * Math.atan(Math.pow(radius * f / rho, 1 / n)) - Math.PI / 2;
    const lambda = lambda0 + theta / n;
    return {
      lon: normalizeLongitude(radiansToDegrees(lambda)),
      lat: radiansToDegrees(phi)
    };
  }

  function descriptorsForBounds(run, grid, bounds, paddingChunks) {
    const samples = projectedBoundsSamples(bounds, grid.projection, 8);
    const xs = samples.map((point) => point.x);
    const ys = samples.map((point) => point.y);
    const xRange = coordinateIndexRange(grid.x, Math.min(...xs), Math.max(...xs));
    const yRange = coordinateIndexRange(grid.y, Math.min(...ys), Math.max(...ys));
    if (!xRange || !yRange) return [];

    const chunkHeight = run.chunks[1];
    const chunkWidth = run.chunks[2];
    const chunkColumns = Math.ceil(run.shape[2] / chunkWidth);
    const chunkRows = Math.ceil(run.shape[1] / chunkHeight);
    const minChunkX = clamp(Math.floor(xRange[0] / chunkWidth) - paddingChunks, 0, chunkColumns - 1);
    const maxChunkX = clamp(Math.floor(xRange[1] / chunkWidth) + paddingChunks, 0, chunkColumns - 1);
    const minChunkY = clamp(Math.floor(yRange[0] / chunkHeight) - paddingChunks, 0, chunkRows - 1);
    const maxChunkY = clamp(Math.floor(yRange[1] / chunkHeight) + paddingChunks, 0, chunkRows - 1);
    const descriptors = [];

    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const gridOffsetX = chunkX * chunkWidth;
        const gridOffsetY = chunkY * chunkHeight;
        const logicalWidth = Math.min(chunkWidth, run.shape[2] - gridOffsetX);
        const logicalHeight = Math.min(chunkHeight, run.shape[1] - gridOffsetY);
        const xSpacing = grid.xSpacing || 3000;
        const ySpacing = grid.ySpacing || 3000;
        const xMin = grid.x[gridOffsetX] - xSpacing / 2;
        const xMax = grid.x[gridOffsetX + logicalWidth - 1] + xSpacing / 2;
        const yMin = grid.y[gridOffsetY] - ySpacing / 2;
        const yMax = grid.y[gridOffsetY + logicalHeight - 1] + ySpacing / 2;
        descriptors.push(Object.freeze({
          chunkX,
          chunkY,
          gridOffsetX,
          gridOffsetY,
          logicalWidth,
          logicalHeight,
          projectedBounds: Object.freeze({ xMin, xMax, yMin, yMax }),
          corners: Object.freeze([
            Object.freeze(inverseProject(xMin, yMin, grid.projection)),
            Object.freeze(inverseProject(xMax, yMin, grid.projection)),
            Object.freeze(inverseProject(xMax, yMax, grid.projection)),
            Object.freeze(inverseProject(xMin, yMax, grid.projection))
          ])
        }));
      }
    }
    return descriptors;
  }

  function projectedBoundsSamples(bounds, projection, segments) {
    const points = [];
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const lon = bounds.west + (bounds.east - bounds.west) * t;
      const lat = bounds.south + (bounds.north - bounds.south) * t;
      points.push(projectLonLat(lon, bounds.south, projection));
      points.push(projectLonLat(lon, bounds.north, projection));
      points.push(projectLonLat(bounds.west, lat, projection));
      points.push(projectLonLat(bounds.east, lat, projection));
    }
    return points;
  }

  function coordinateIndexRange(coordinates, minimum, maximum) {
    if (!coordinates?.length) return null;
    const increasing = coordinates[coordinates.length - 1] >= coordinates[0];
    if (!increasing) {
      const reversed = Float64Array.from(coordinates).reverse();
      const range = coordinateIndexRange(reversed, minimum, maximum);
      return range ? [coordinates.length - 1 - range[1], coordinates.length - 1 - range[0]] : null;
    }
    if (maximum < coordinates[0] || minimum > coordinates[coordinates.length - 1]) return null;
    const lower = clamp(lowerBound(coordinates, minimum) - 1, 0, coordinates.length - 1);
    const upper = clamp(lowerBound(coordinates, maximum) + 1, 0, coordinates.length - 1);
    return [Math.min(lower, upper), Math.max(lower, upper)];
  }

  function lowerBound(values, target) {
    let low = 0;
    let high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle] < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function selectForecastSteps(steps, options) {
    if (Array.isArray(options.stepIndexes)) {
      return uniqueBy(options.stepIndexes
        .map((index) => steps[Number(index)])
        .filter(Boolean), (step) => step.sourceIndex);
    }
    if (Array.isArray(options.forecastHours)) {
      return uniqueBy(options.forecastHours
        .map((hour) => nearestStep(steps, (step) => Math.abs(step.forecastHour - Number(hour))))
        .filter(Boolean), (step) => step.sourceIndex)
        .sort((left, right) => left.sourceIndex - right.sourceIndex);
    }
    if (Array.isArray(options.hoursAhead)) {
      const now = validDate(options.now || new Date());
      return uniqueBy(options.hoursAhead
        .map((hour) => {
          const target = now.getTime() + Number(hour) * HOURS_MS;
          return nearestStep(steps, (step) => Math.abs(step.validTime.getTime() - target));
        })
        .filter(Boolean), (step) => step.sourceIndex)
        .sort((left, right) => left.sourceIndex - right.sourceIndex);
    }
    return steps.slice();
  }

  function nearestStep(steps, score) {
    let best = null;
    let bestScore = Infinity;
    for (const step of steps) {
      const nextScore = score(step);
      if (Number.isFinite(nextScore) && nextScore < bestScore) {
        best = step;
        bestScore = nextScore;
      }
    }
    return best;
  }

  function candidateFromPrefix(prefix, bucket) {
    const match = String(prefix).match(/^sfc\/(\d{8})\/(\d{8})_(\d{2})z_fcst\.zarr\/$/);
    if (!match) return null;
    const cycle = `${match[2]}_${match[3]}z`;
    return {
      cycle,
      cycleTime: cycleDateFromStamp(cycle),
      runRoot: `${bucket}/${trimTrailingSlash(prefix)}`
    };
  }

  function deterministicRunCandidates(now, lookbackDays, bucket) {
    const count = lookbackDays * 24;
    const hour = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours()
    );
    const candidates = [];
    for (let offset = 0; offset < count; offset += 1) {
      const cycleTime = new Date(hour - offset * HOURS_MS);
      const dateStamp = formatUtcDate(cycleTime);
      const hourStamp = String(cycleTime.getUTCHours()).padStart(2, "0");
      const cycle = `${dateStamp}_${hourStamp}z`;
      candidates.push({
        cycle,
        cycleTime,
        runRoot: `${bucket}/sfc/${dateStamp}/${cycle}_fcst.zarr`
      });
    }
    return candidates;
  }

  function commonPrefixesFromXml(xml) {
    const prefixes = [];
    const pattern = /<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g;
    let match;
    while ((match = pattern.exec(String(xml)))) prefixes.push(decodeXml(match[1]));
    return prefixes;
  }

  function decodeXml(value) {
    return String(value)
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", "\"")
      .replaceAll("&#39;", "'");
  }

  async function mapConcurrent(items, concurrency, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  function groupBy(items, keyFor) {
    const groups = new Map();
    for (const item of items) {
      const key = keyFor(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  }

  function normalizeBounds(input) {
    let west;
    let south;
    let east;
    let north;
    if (Array.isArray(input) && input.length >= 4) {
      [west, south, east, north] = input.map(Number);
    } else if (input && typeof input.getWest === "function") {
      west = Number(input.getWest());
      south = Number(input.getSouth());
      east = Number(input.getEast());
      north = Number(input.getNorth());
    } else if (input && typeof input === "object") {
      west = Number(input.west ?? input.minLon ?? input.left);
      south = Number(input.south ?? input.minLat ?? input.bottom);
      east = Number(input.east ?? input.maxLon ?? input.right);
      north = Number(input.north ?? input.maxLat ?? input.top);
    }
    if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
      throw new HrrrZarrError("Bounds must be [west, south, east, north]", "INVALID_BOUNDS");
    }
    return Object.freeze({ west, south, east, north });
  }

  function cycleDateFromStamp(cycle) {
    const match = String(cycle).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})z$/);
    if (!match) throw new HrrrZarrError(`Invalid HRRR cycle ${cycle}`, "INVALID_CYCLE");
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4])));
  }

  function formatUtcDate(date) {
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
      .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
      .join("");
  }

  function medianSpacing(values) {
    if (!values || values.length < 2) return NaN;
    const sample = [];
    const stride = Math.max(1, Math.floor(values.length / 32));
    for (let index = stride; index < values.length; index += stride) {
      sample.push(values[index] - values[index - stride]);
    }
    sample.sort((left, right) => left - right);
    return sample[Math.floor(sample.length / 2)] / stride;
  }

  function tanHalfPi(phi) {
    return Math.tan(Math.PI / 4 + phi / 2);
  }

  function normalizeLongitude(value) {
    let result = Number(value);
    while (result > 180) result -= 360;
    while (result < -180) result += 360;
    return result;
  }

  function normalizeRadians(value) {
    let result = value;
    while (result > Math.PI) result -= Math.PI * 2;
    while (result < -Math.PI) result += Math.PI * 2;
    return result;
  }

  function degreesToRadians(value) {
    return value * Math.PI / 180;
  }

  function radiansToDegrees(value) {
    return value * 180 / Math.PI;
  }

  function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError("Expected ArrayBuffer or typed array");
  }

  function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new HrrrZarrError("Invalid date", "INVALID_DATE");
    return date;
  }

  function assertRun(run) {
    if (!run?.productRoot || !Array.isArray(run.shape) || !Array.isArray(run.chunks)) {
      throw new HrrrZarrError("A run returned by discoverLatestRun is required", "INVALID_RUN");
    }
  }

  function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function nonNegativeInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function trimTrailingSlash(value) {
    return String(value).replace(/\/+$/, "");
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function uniqueBy(items, keyFor) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFor(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  return Object.freeze({
    VERSION,
    DEFAULT_BUCKET,
    DEFAULT_PRODUCT,
    DEFAULT_PROJECTION,
    HrrrZarrError,
    HrrrZarrClient,
    createClient,
    decodeBloscLz4,
    decodeNumericArray,
    projectLonLat,
    inverseProject,
    normalizeBounds
  });
});
