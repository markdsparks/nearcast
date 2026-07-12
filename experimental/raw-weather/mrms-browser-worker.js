(function installMrmsWorker(scope) {
  "use strict";

  const MAX_SOURCE_PIXELS = 30_000_000;
  const MAX_GRIB_BYTES = 8 * 1024 * 1024;
  const MAX_EMBEDDED_BYTES = 64 * 1024 * 1024;
  const MAX_TEXTURE_PIXELS = 1_048_576;
  const NOAA_MRMS_ORIGIN = "https://noaa-mrms-pds.s3.amazonaws.com";
  const jobs = new Map();

  scope.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "cancel") {
      cancelJobs(message.payload?.requestId);
      return;
    }
    if (message.type !== "decode" || !message.id) return;
    const controller = new AbortController();
    jobs.set(message.id, controller);
    decodeFrame(message.payload || {}, controller.signal)
      .then((result) => {
        jobs.delete(message.id);
        scope.postMessage({ id: message.id, type: "result", result }, [result.data.buffer]);
      })
      .catch((error) => {
        jobs.delete(message.id);
        scope.postMessage({
          id: message.id,
          type: "error",
          error: serializeError(error)
        });
      });
  });

  function cancelJobs(requestId) {
    if (requestId && jobs.has(requestId)) {
      jobs.get(requestId).abort();
      return;
    }
    if (!requestId) {
      for (const controller of jobs.values()) controller.abort();
    }
  }

  async function decodeFrame(input, outerSignal) {
    const startedAt = performance.now();
    assertBrowserSupport();
    const config = normalizeInput(input);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
    const signal = anySignal([outerSignal, timeoutController.signal]);

    try {
      const downloaded = await fetchBounded(config.frame.url, config.maxCompressedBytes, signal);
      const grib = isGzip(downloaded)
        ? await decompressBounded(downloaded, "gzip", MAX_GRIB_BYTES, signal)
        : downloaded;
      const parsed = parseGrib2(grib);
      const png = parseEmbeddedPng(grib, parsed.dataSection);
      validateDecodeContract(parsed, png);
      const sampled = await decodeViewportTexture({
        png,
        grid: parsed.grid,
        representation: parsed.representation,
        bounds: config.bounds,
        width: config.width,
        height: config.height,
        threshold: config.threshold,
        dbzMin: config.dbzMin,
        dbzMax: config.dbzMax,
        signal
      });

      return {
        data: sampled.data,
        width: config.width,
        height: config.height,
        bounds: config.bounds,
        projection: "web-mercator-bounds",
        observedAt: config.frame.observedAt || null,
        sourceUrl: config.frame.url,
        provider: "noaa-mrms-pds",
        encoding: {
          type: "uint8-dbz",
          dbzMin: config.dbzMin,
          dbzMax: config.dbzMax,
          threshold: config.threshold,
          noData: 0,
          valueMin: 1,
          valueMax: 255,
          formula: "dbz = dbzMin + (value - 1) * (dbzMax - dbzMin) / 254"
        },
        grid: {
          ni: parsed.grid.ni,
          nj: parsed.grid.nj,
          lat1: parsed.grid.lat1,
          lon1: parsed.grid.lon1,
          dx: parsed.grid.dx,
          dy: parsed.grid.dy
        },
        metrics: {
          compressedBytes: downloaded.byteLength,
          gribBytes: grib.byteLength,
          embeddedCompressedBytes: png.compressedBytes,
          embeddedInflatedBytes: png.inflatedBytes,
          sourceRowsDecoded: sampled.rowsDecoded,
          sourceRowsTotal: parsed.grid.nj,
          outputPixels: sampled.data.length,
          precipPixels: sampled.precipPixels,
          minDbz: Number.isFinite(sampled.minDbz) ? sampled.minDbz : null,
          maxDbz: Number.isFinite(sampled.maxDbz) ? sampled.maxDbz : null,
          elapsedMs: Math.round(performance.now() - startedAt),
          memoryStrategy: "stream PNG scanlines; retain two source rows plus one Uint8 viewport texture"
        }
      };
    } catch (error) {
      if (timeoutController.signal.aborted && !outerSignal.aborted) {
        const timeoutError = new Error(`MRMS decode exceeded ${config.timeoutMs} ms.`);
        timeoutError.name = "TimeoutError";
        timeoutError.code = "MRMS_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeInput(input) {
    const frameUrl = new URL(input.frame?.url || "");
    if (frameUrl.origin !== NOAA_MRMS_ORIGIN || !frameUrl.pathname.startsWith("/CONUS/")) {
      throw codedError("MRMS_SOURCE_REJECTED", "Only public NOAA CONUS MRMS objects are accepted by this proof adapter.");
    }
    const bounds = normalizeBounds(input.bounds);
    const width = clampInteger(input.width, 512, 64, 1024);
    const height = clampInteger(input.height, 384, 64, 1024);
    if (width * height > MAX_TEXTURE_PIXELS) {
      throw codedError("MRMS_TEXTURE_TOO_LARGE", `Texture exceeds the ${MAX_TEXTURE_PIXELS.toLocaleString()} pixel limit.`);
    }
    const dbzMin = clampNumber(input.dbzMin, 0, -20, 40);
    const dbzMax = clampNumber(input.dbzMax, 80, 41, 100);
    if (dbzMax <= dbzMin) throw codedError("MRMS_ENCODING_INVALID", "dbzMax must be greater than dbzMin.");
    return {
      frame: { ...input.frame, url: frameUrl.href },
      bounds,
      width,
      height,
      dbzMin,
      dbzMax,
      threshold: clampNumber(input.threshold, 5, -10, 80),
      timeoutMs: clampInteger(input.timeoutMs, 30_000, 5_000, 60_000),
      maxCompressedBytes: clampInteger(input.maxCompressedBytes, 8 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024)
    };
  }

  async function fetchBounded(url, maxBytes, signal) {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw codedError("MRMS_FETCH_FAILED", `MRMS frame fetch failed with HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw codedError("MRMS_SOURCE_TOO_LARGE", `MRMS frame is ${declaredLength.toLocaleString()} bytes; limit is ${maxBytes.toLocaleString()}.`);
    }
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw codedError("MRMS_SOURCE_TOO_LARGE", "MRMS frame exceeded the download limit.");
      return bytes;
    }
    return readStreamBounded(response.body, maxBytes, signal);
  }

  async function decompressBounded(bytes, format, maxBytes, signal) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return readStreamBounded(stream, maxBytes, signal);
  }

  async function readStreamBounded(stream, maxBytes, signal) {
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    let complete = false;
    try {
      while (true) {
        if (signal.aborted) throw abortError();
        const { value, done } = await reader.read();
        if (done) {
          complete = true;
          break;
        }
        length += value.byteLength;
        if (length > maxBytes) {
          throw codedError("MRMS_BUFFER_LIMIT", `Decoded buffer exceeded ${maxBytes.toLocaleString()} bytes.`);
        }
        chunks.push(value);
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
    }
    return concatBytes(chunks, length);
  }

  function parseGrib2(bytes) {
    if (ascii(bytes, 0, 4) !== "GRIB") throw codedError("MRMS_GRIB_INVALID", "Downloaded object is not GRIB2.");
    if (bytes[7] !== 2) throw codedError("MRMS_GRIB_UNSUPPORTED", `Unsupported GRIB edition ${bytes[7]}.`);
    const view = dataView(bytes);
    const totalLength = readUint64(view, 8);
    if (totalLength !== bytes.byteLength) {
      throw codedError("MRMS_GRIB_TRUNCATED", `GRIB declares ${totalLength} bytes but ${bytes.byteLength} were decoded.`);
    }
    const sections = [];
    let offset = 16;
    while (offset < totalLength) {
      if (ascii(bytes, offset, 4) === "7777") {
        sections.push({ number: 8, offset, length: 4 });
        offset += 4;
        break;
      }
      if (offset + 5 > totalLength) throw codedError("MRMS_GRIB_TRUNCATED", "GRIB section header is truncated.");
      const length = view.getUint32(offset);
      const number = bytes[offset + 4];
      if (length < 5 || offset + length > totalLength) {
        throw codedError("MRMS_GRIB_INVALID", `GRIB section ${number} has an invalid length.`);
      }
      sections.push({ number, offset, length });
      offset += length;
    }
    const gridSection = sections.find((section) => section.number === 3);
    const representationSection = sections.find((section) => section.number === 5);
    const bitmapSection = sections.find((section) => section.number === 6);
    const dataSection = sections.find((section) => section.number === 7);
    if (!gridSection || !representationSection || !dataSection) {
      throw codedError("MRMS_GRIB_MISSING_SECTION", "GRIB2 grid, representation, or data section is missing.");
    }
    if (bitmapSection && bytes[bitmapSection.offset + 5] !== 255) {
      throw codedError("MRMS_BITMAP_UNSUPPORTED", "GRIB bitmap-packed fields are not supported by this bounded decoder.");
    }
    return {
      sections,
      grid: parseGridDefinition(bytes, gridSection),
      representation: parseRepresentation(bytes, representationSection),
      dataSection
    };
  }

  function parseGridDefinition(bytes, section) {
    const view = dataView(bytes);
    const template = view.getUint16(section.offset + 12);
    if (template !== 0) {
      throw codedError("MRMS_GRID_UNSUPPORTED", `Unsupported GRIB grid template 3.${template}; expected 3.0.`);
    }
    const ni = view.getUint32(section.offset + 30);
    const nj = view.getUint32(section.offset + 34);
    if (!ni || !nj || ni * nj > MAX_SOURCE_PIXELS) {
      throw codedError("MRMS_GRID_TOO_LARGE", `Source grid ${ni} x ${nj} exceeds the bounded decoder limit.`);
    }
    const scanMode = bytes[section.offset + 71];
    return {
      template,
      points: view.getUint32(section.offset + 6),
      ni,
      nj,
      lat1: view.getInt32(section.offset + 46) / 1e6,
      lon1: normalizeLon(view.getInt32(section.offset + 50) / 1e6),
      lat2: view.getInt32(section.offset + 55) / 1e6,
      lon2: normalizeLon(view.getInt32(section.offset + 59) / 1e6),
      dx: view.getUint32(section.offset + 63) / 1e6,
      dy: view.getUint32(section.offset + 67) / 1e6,
      iScansPositive: (scanMode & 0x80) === 0,
      jScansPositive: (scanMode & 0x40) !== 0
    };
  }

  function parseRepresentation(bytes, section) {
    const view = dataView(bytes);
    const template = view.getUint16(section.offset + 9);
    if (template !== 41) {
      throw codedError("MRMS_PACKING_UNSUPPORTED", `Unsupported GRIB data representation 5.${template}; expected PNG packing 5.41.`);
    }
    return {
      points: view.getUint32(section.offset + 5),
      template,
      referenceValue: view.getFloat32(section.offset + 11),
      binaryScale: view.getInt16(section.offset + 15),
      decimalScale: view.getInt16(section.offset + 17),
      bitsPerValue: bytes[section.offset + 19]
    };
  }

  function parseEmbeddedPng(grib, section) {
    const bytes = grib.subarray(section.offset + 5, section.offset + section.length);
    if (hex(bytes, 0, 8) !== "89504e470d0a1a0a") {
      throw codedError("MRMS_PNG_INVALID", "GRIB data section does not contain a PNG payload.");
    }
    const view = dataView(bytes);
    const idatChunks = [];
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let offset = 8;
    let compressedBytes = 0;
    while (offset + 12 <= bytes.byteLength) {
      const length = view.getUint32(offset);
      const type = ascii(bytes, offset + 4, 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.byteLength) throw codedError("MRMS_PNG_TRUNCATED", "Embedded PNG chunk is truncated.");
      if (type === "IHDR") {
        width = view.getUint32(dataStart);
        height = view.getUint32(dataStart + 4);
        bitDepth = bytes[dataStart + 8];
        colorType = bytes[dataStart + 9];
        const compression = bytes[dataStart + 10];
        const filter = bytes[dataStart + 11];
        const interlace = bytes[dataStart + 12];
        if (bitDepth !== 16 || colorType !== 0 || compression !== 0 || filter !== 0 || interlace !== 0) {
          throw codedError(
            "MRMS_PNG_UNSUPPORTED",
            `Embedded PNG must be non-interlaced 16-bit grayscale; received depth ${bitDepth}, color ${colorType}, interlace ${interlace}.`
          );
        }
      } else if (type === "IDAT") {
        const chunk = bytes.subarray(dataStart, dataEnd);
        idatChunks.push(chunk);
        compressedBytes += chunk.byteLength;
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }
    const rowBytes = width * 2;
    const inflatedBytes = (rowBytes + 1) * height;
    if (!width || !height || !idatChunks.length || inflatedBytes > MAX_EMBEDDED_BYTES) {
      throw codedError("MRMS_PNG_TOO_LARGE", `Embedded PNG would inflate to ${inflatedBytes.toLocaleString()} bytes.`);
    }
    return { width, height, bitDepth, colorType, rowBytes, inflatedBytes, compressedBytes, idatChunks };
  }

  function validateDecodeContract(parsed, png) {
    const sourcePixels = parsed.grid.ni * parsed.grid.nj;
    if (parsed.grid.points !== sourcePixels || parsed.representation.points !== sourcePixels) {
      throw codedError("MRMS_POINT_COUNT_MISMATCH", "GRIB point count does not match its regular latitude/longitude grid.");
    }
    if (png.width !== parsed.grid.ni || png.height !== parsed.grid.nj) {
      throw codedError("MRMS_PNG_GRID_MISMATCH", "Embedded PNG dimensions do not match the GRIB grid.");
    }
    if (parsed.representation.bitsPerValue !== 16) {
      throw codedError("MRMS_BITS_UNSUPPORTED", `Expected 16 packed bits per value; received ${parsed.representation.bitsPerValue}.`);
    }
  }

  async function decodeViewportTexture(options) {
    const output = new Uint8Array(options.width * options.height);
    const xSamples = buildXSamples(options.grid, options.bounds, options.width);
    const yBuckets = buildYSampleBuckets(options.grid, options.bounds, options.height);
    if (!yBuckets.size || !xSamples.some((sample) => sample.valid)) {
      return { data: output, rowsDecoded: 0, precipPixels: 0, minDbz: Infinity, maxDbz: -Infinity };
    }

    const maxSourceRowNeeded = Math.max(...yBuckets.keys()) + 1;
    const compressedStream = new ReadableStream({
      start(controller) {
        for (const chunk of options.png.idatChunks) controller.enqueue(chunk);
        controller.close();
      }
    });
    const inflated = compressedStream.pipeThrough(new DecompressionStream("deflate"));
    const byteReader = createExactReader(inflated.getReader(), options.signal);
    const packet = new Uint8Array(options.png.rowBytes + 1);
    let previousRow = new Uint8Array(options.png.rowBytes);
    let rowsDecoded = 0;
    let precipPixels = 0;
    let minDbz = Infinity;
    let maxDbz = -Infinity;

    try {
      for (let sourceRow = 0; sourceRow <= maxSourceRowNeeded; sourceRow += 1) {
        if (options.signal.aborted) throw abortError();
        await byteReader.readExactly(packet);
        const currentRow = reconstructPngRow(packet, previousRow, options.png.rowBytes);
        rowsDecoded += 1;
        const sourceY0 = sourceRow - 1;
        const targets = yBuckets.get(sourceY0);
        if (targets && sourceY0 >= 0) {
          for (const target of targets) {
            const rowStats = renderOutputRow({
              output,
              outY: target.outY,
              width: options.width,
              xSamples,
              yFraction: target.fraction,
              topRow: previousRow,
              bottomRow: currentRow,
              representation: options.representation,
              threshold: options.threshold,
              dbzMin: options.dbzMin,
              dbzMax: options.dbzMax
            });
            precipPixels += rowStats.precipPixels;
            if (rowStats.minDbz < minDbz) minDbz = rowStats.minDbz;
            if (rowStats.maxDbz > maxDbz) maxDbz = rowStats.maxDbz;
          }
        }
        previousRow = currentRow;
      }
    } finally {
      await byteReader.cancel().catch(() => {});
    }

    return { data: output, rowsDecoded, precipPixels, minDbz, maxDbz };
  }

  function buildXSamples(grid, bounds, width) {
    const samples = new Array(width);
    for (let x = 0; x < width; x += 1) {
      const lon = bounds.minLon + (x + 0.5) / width * (bounds.maxLon - bounds.minLon);
      const adjustedLon = lon < grid.lon1 && grid.lon1 > 0 ? lon + 360 : lon;
      const sourceX = grid.iScansPositive
        ? (adjustedLon - grid.lon1) / grid.dx
        : (grid.lon1 - adjustedLon) / grid.dx;
      const x0 = Math.floor(sourceX);
      samples[x] = {
        valid: sourceX >= 0 && sourceX < grid.ni - 1,
        x0,
        fraction: sourceX - x0
      };
    }
    return samples;
  }

  function buildYSampleBuckets(grid, bounds, height) {
    const buckets = new Map();
    const northY = mercatorY(bounds.maxLat);
    const southY = mercatorY(bounds.minLat);
    for (let outY = 0; outY < height; outY += 1) {
      const worldY = northY + (outY + 0.5) / height * (southY - northY);
      const lat = inverseMercatorY(worldY);
      const sourceY = grid.jScansPositive
        ? (lat - grid.lat1) / grid.dy
        : (grid.lat1 - lat) / grid.dy;
      if (sourceY < 0 || sourceY >= grid.nj - 1) continue;
      const y0 = Math.floor(sourceY);
      if (!buckets.has(y0)) buckets.set(y0, []);
      buckets.get(y0).push({ outY, fraction: sourceY - y0 });
    }
    return buckets;
  }

  function renderOutputRow(options) {
    let precipPixels = 0;
    let minDbz = Infinity;
    let maxDbz = -Infinity;
    const outOffset = options.outY * options.width;
    for (let x = 0; x < options.width; x += 1) {
      const sample = options.xSamples[x];
      if (!sample.valid) continue;
      const byteOffset = sample.x0 * 2;
      const v00 = cleanDbz(decodePacked(options.topRow, byteOffset, options.representation));
      const v10 = cleanDbz(decodePacked(options.topRow, byteOffset + 2, options.representation));
      const v01 = cleanDbz(decodePacked(options.bottomRow, byteOffset, options.representation));
      const v11 = cleanDbz(decodePacked(options.bottomRow, byteOffset + 2, options.representation));
      if (![v00, v10, v01, v11].every(Number.isFinite)) continue;
      const top = v00 * (1 - sample.fraction) + v10 * sample.fraction;
      const bottom = v01 * (1 - sample.fraction) + v11 * sample.fraction;
      const dbz = top * (1 - options.yFraction) + bottom * options.yFraction;
      if (dbz < options.threshold) continue;
      options.output[outOffset + x] = encodeDbz(dbz, options.dbzMin, options.dbzMax);
      precipPixels += 1;
      if (dbz < minDbz) minDbz = dbz;
      if (dbz > maxDbz) maxDbz = dbz;
    }
    return { precipPixels, minDbz, maxDbz };
  }

  function reconstructPngRow(packet, previousRow, rowBytes) {
    const filter = packet[0];
    const row = new Uint8Array(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= 2 ? row[index - 2] : 0;
      const up = previousRow[index] || 0;
      const upLeft = index >= 2 ? previousRow[index - 2] : 0;
      row[index] = (packet[index + 1] + pngPredictor(filter, left, up, upLeft)) & 0xff;
    }
    return row;
  }

  function pngPredictor(filter, left, up, upLeft) {
    if (filter === 0) return 0;
    if (filter === 1) return left;
    if (filter === 2) return up;
    if (filter === 3) return Math.floor((left + up) / 2);
    if (filter === 4) return paeth(left, up, upLeft);
    throw codedError("MRMS_PNG_FILTER_UNSUPPORTED", `Unsupported PNG row filter ${filter}.`);
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  }

  function decodePacked(row, offset, representation) {
    const sample = (row[offset] << 8) | row[offset + 1];
    return (representation.referenceValue + sample * (2 ** representation.binaryScale)) /
      (10 ** representation.decimalScale);
  }

  function cleanDbz(value) {
    if (!Number.isFinite(value) || value < -100 || value > 100) return NaN;
    return value <= -90 ? 0 : value;
  }

  function encodeDbz(value, min, max) {
    const clamped = Math.max(min, Math.min(max, value));
    return Math.max(1, Math.min(255, Math.round(1 + (clamped - min) / (max - min) * 254)));
  }

  function createExactReader(reader, signal) {
    let chunk = null;
    let chunkOffset = 0;
    let done = false;
    return {
      async readExactly(target) {
        let targetOffset = 0;
        while (targetOffset < target.byteLength) {
          if (signal.aborted) throw abortError();
          if (!chunk || chunkOffset >= chunk.byteLength) {
            const next = await reader.read();
            if (next.done) {
              done = true;
              throw codedError("MRMS_PNG_TRUNCATED", "Embedded PNG ended before the required scanlines were decoded.");
            }
            chunk = next.value;
            chunkOffset = 0;
          }
          const count = Math.min(target.byteLength - targetOffset, chunk.byteLength - chunkOffset);
          target.set(chunk.subarray(chunkOffset, chunkOffset + count), targetOffset);
          targetOffset += count;
          chunkOffset += count;
        }
      },
      async cancel() {
        if (!done) await reader.cancel();
      }
    };
  }

  function anySignal(signals) {
    if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  function normalizeBounds(value) {
    const bounds = {
      minLat: Number(value?.minLat),
      minLon: Number(value?.minLon),
      maxLat: Number(value?.maxLat),
      maxLon: Number(value?.maxLon)
    };
    if (!Object.values(bounds).every(Number.isFinite) ||
      bounds.minLat >= bounds.maxLat || bounds.minLon >= bounds.maxLon ||
      bounds.minLat < -85 || bounds.maxLat > 85 ||
      bounds.minLon < -180 || bounds.maxLon > 180) {
      throw codedError("MRMS_BOUNDS_INVALID", "A valid increasing Web Mercator bounds object is required.");
    }
    return bounds;
  }

  function mercatorY(lat) {
    const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
    return 0.5 - Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) / (4 * Math.PI);
  }

  function inverseMercatorY(y) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  }

  function normalizeLon(lon) {
    return lon > 180 ? lon - 360 : lon;
  }

  function assertBrowserSupport() {
    if (typeof DecompressionStream === "undefined" || typeof ReadableStream === "undefined") {
      throw codedError("MRMS_BROWSER_UNSUPPORTED", "Streaming decompression is unavailable in this browser.");
    }
  }

  function isGzip(bytes) {
    return bytes[0] === 0x1f && bytes[1] === 0x8b;
  }

  function concatBytes(chunks, length) {
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  function dataView(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function readUint64(view, offset) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    const value = high * 2 ** 32 + low;
    if (!Number.isSafeInteger(value)) throw codedError("MRMS_GRIB_TOO_LARGE", "GRIB length exceeds JavaScript's safe integer range.");
    return value;
  }

  function ascii(bytes, offset, length) {
    let result = "";
    for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index]);
    return result;
  }

  function hex(bytes, offset, length) {
    let result = "";
    for (let index = 0; index < length; index += 1) result += bytes[offset + index].toString(16).padStart(2, "0");
    return result;
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
    const error = new Error("MRMS operation was cancelled.");
    error.name = "AbortError";
    error.code = "MRMS_ABORTED";
    return error;
  }

  function serializeError(error) {
    return {
      name: error?.name || "Error",
      message: error?.message || String(error),
      code: error?.code || (error?.name === "AbortError" ? "MRMS_ABORTED" : "MRMS_DECODE_FAILED"),
      details: error?.details || null
    };
  }
})(self);
