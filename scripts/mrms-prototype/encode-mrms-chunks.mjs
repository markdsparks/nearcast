#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import {
  decodeGridValues,
  decodePngGrayscale16,
  gridValueStats,
  loadGribBuffer,
  parseBounds,
  parseGrib2,
  round,
  sampleGrid,
  worldToLonLat
} from "./render-mrms-preview.mjs";

const DEFAULT_BOUNDS = "30.35,-88.3,31.25,-87.2";
const DEFAULT_LEVELS = "8,9,10";
const DEFAULT_BASE_ZOOM = 10;
const DEFAULT_CHUNK_SIZE = 256;
const DEFAULT_OUT_DIR = "/tmp/nearcast-radar-chunks";
const DEFAULT_INDEX_NAME = "index.json";
const DEFAULT_DBZ_MIN = 0;
const DEFAULT_DBZ_MAX = 80;
const DEFAULT_THRESHOLD = 5;
const DEFAULT_MAX_PIXELS = 80_000_000;

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`MRMS chunk encode failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  const bounds = parseBounds(args.bounds || DEFAULT_BOUNDS);
  const levels = parseLevels(args.levels || args.zooms || DEFAULT_LEVELS);
  const baseZoom = Math.max(...levels, Math.round(numberArg(args["base-zoom"], DEFAULT_BASE_ZOOM)));
  const chunkSize = Math.max(64, Math.min(512, Math.round(numberArg(args["chunk-size"], DEFAULT_CHUNK_SIZE))));
  const threshold = numberArg(args.threshold, DEFAULT_THRESHOLD);
  const valueEncoding = {
    type: "uint8-dbz",
    dbzMin: numberArg(args["dbz-min"], DEFAULT_DBZ_MIN),
    dbzMax: numberArg(args["dbz-max"], DEFAULT_DBZ_MAX),
    threshold,
    noData: 0,
    valueMin: 1,
    valueMax: 255,
    formula: "dbz = dbzMin + (value - 1) * (dbzMax - dbzMin) / 254"
  };
  if (valueEncoding.dbzMax <= valueEncoding.dbzMin) {
    throw new Error("--dbz-max must be greater than --dbz-min");
  }

  const pool = normalizePool(args.pool || "max");
  const sampleSmooth = Math.max(0, numberArg(args["sample-smooth"], 0));
  const outDir = args["out-dir"] || DEFAULT_OUT_DIR;
  const indexOut = args["index-out"] || path.join(outDir, DEFAULT_INDEX_NAME);
  const frame = await loadFrame({ bounds });
  const stats = gridValueStats(frame.values, frame.grid, bounds);

  const canonicalRange = canonicalRangeForLevels(bounds, levels, baseZoom, chunkSize);
  const canonicalPixels = (canonicalRange.maxX - canonicalRange.minX + 1) *
    chunkSize *
    (canonicalRange.maxY - canonicalRange.minY + 1) *
    chunkSize;
  const maxPixels = Math.max(1, Math.round(numberArg(args["max-pixels"], DEFAULT_MAX_PIXELS)));
  if (canonicalPixels > maxPixels) {
    throw new Error(`canonical raster is ${canonicalPixels.toLocaleString()} pixels; narrow --bounds, lower --base-zoom, or raise --max-pixels`);
  }

  const canonical = buildCanonicalRaster({
    values: frame.values,
    grid: frame.grid,
    range: canonicalRange,
    zoom: baseZoom,
    chunkSize,
    sampleSmooth
  });

  const chunksRoot = path.join(outDir, "chunks");
  fs.mkdirSync(chunksRoot, { recursive: true });

  const levelSummaries = [];
  for (const zoom of levels) {
    const raster = deriveLevelRaster({ canonical, bounds, zoom, chunkSize, pool });
    const written = writeLevelChunks({
      raster,
      chunksRoot,
      valueEncoding,
      threshold,
      writeEmpty: booleanArg(args["write-empty"], false)
    });
    levelSummaries.push({
      id: `z${zoom}`,
      zoom,
      chunkSize,
      pool: zoom === baseZoom ? "canonical" : pool,
      range: raster.range,
      bounds: tileRangeToBounds(raster.range, zoom, chunkSize),
      template: `chunks/z${zoom}/{x}/{y}.ncrd.gz`,
      candidateChunks: raster.candidateChunks,
      chunkCount: written.chunks.length,
      precipPixels: written.precipPixels,
      bytes: written.bytes,
      minDbz: round(written.minDbz, 1),
      maxDbz: round(written.maxDbz, 1),
      chunks: written.chunks
    });
  }

  const metrics = summarizeLevels(levelSummaries);
  const generatedAt = new Date().toISOString();
  const index = {
    provider: "nearcast-radar-coverage-chunks",
    version: 1,
    generatedAt,
    product: frame.product,
    region: frame.region,
    source: frame.source,
    bounds: roundBounds(bounds),
    frame: {
      observedAt: frame.observedAt || null,
      sourceType: frame.sourceType,
      stats
    },
    renderIntent: {
      clientRendering: "custom-webgl-radar-layer",
      fallback: "classic radar remains visible until chunks are ready",
      colorizeOnDevice: true,
      animateOnDevice: true
    },
    valueEncoding,
    canonical: {
      baseZoom,
      chunkSize,
      range: canonicalRange,
      bounds: tileRangeToBounds(canonicalRange, baseZoom, chunkSize),
      pixels: canonical.width * canonical.height,
      validPixels: canonical.validPixels,
      sampleSmooth
    },
    levels: levelSummaries,
    metrics: {
      ...metrics,
      elapsedMs: Date.now() - startedAt
    }
  };

  fs.mkdirSync(path.dirname(indexOut), { recursive: true });
  atomicWriteJson(indexOut, index);

  const summary = {
    provider: "nearcast-radar-coverage-chunk-encode",
    version: 1,
    generatedAt,
    synthetic: frame.sourceType === "synthetic",
    outDir,
    indexOut,
    product: frame.product,
    bounds: index.bounds,
    baseZoom,
    levels,
    chunkSize,
    threshold,
    pool,
    sampleSmooth,
    stats,
    metrics: index.metrics
  };

  const summaryOut = args["summary-out"];
  if (summaryOut) {
    fs.mkdirSync(path.dirname(summaryOut), { recursive: true });
    atomicWriteJson(summaryOut, summary);
  }

  console.log(JSON.stringify(summary, null, 2));
}

async function loadFrame({ bounds }) {
  if (booleanArg(args.synthetic, false)) {
    return syntheticFrame(bounds);
  }

  const grib = await loadGribBuffer(args);
  const parsed = parseGrib2(grib);
  const values = decodedGridValues(grib, parsed);
  return {
    sourceType: "mrms-grib2",
    product: args.product || "MergedReflectivityQCComposite_00.50",
    region: args.region || "CONUS",
    observedAt: observedAtFromInput(args),
    source: {
      kind: args.file ? "file" : "url-or-latest",
      file: args.file || null,
      url: args.url || null,
      product: args.product || "MergedReflectivityQCComposite_00.50",
      region: args.region || "CONUS",
      date: args.date || null
    },
    grid: parsed.grid,
    values
  };
}

function decodedGridValues(grib, parsed) {
  const pngSection = parsed.sections.find((section) => section.number === 7);
  if (!pngSection) throw new Error("GRIB2 section 7 data payload not found");
  const embeddedPng = grib.subarray(pngSection.offset + 5, pngSection.offset + pngSection.length);
  const decodedPng = decodePngGrayscale16(embeddedPng);
  return decodeGridValues(decodedPng.samples, parsed.dataRepresentation);
}

function syntheticFrame(bounds) {
  const marginLat = Math.max(0.25, (bounds.maxLat - bounds.minLat) * 0.35);
  const marginLon = Math.max(0.25, (bounds.maxLon - bounds.minLon) * 0.35);
  const syntheticBounds = {
    minLat: bounds.minLat - marginLat,
    minLon: bounds.minLon - marginLon,
    maxLat: bounds.maxLat + marginLat,
    maxLon: bounds.maxLon + marginLon
  };
  const ni = Math.max(240, Math.round(numberArg(args["synthetic-width"], 640)));
  const nj = Math.max(180, Math.round(numberArg(args["synthetic-height"], 460)));
  const grid = {
    ni,
    nj,
    lat1: syntheticBounds.maxLat,
    lon1: syntheticBounds.minLon,
    dx: (syntheticBounds.maxLon - syntheticBounds.minLon) / (ni - 1),
    dy: (syntheticBounds.maxLat - syntheticBounds.minLat) / (nj - 1),
    iScansPositive: true,
    jScansPositive: false
  };
  const values = new Float32Array(ni * nj);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;
  const cells = [
    { lat: centerLat + 0.22, lon: centerLon - 0.18, amp: 48, sx: 0.16, sy: 0.10 },
    { lat: centerLat - 0.04, lon: centerLon + 0.12, amp: 58, sx: 0.12, sy: 0.08 },
    { lat: centerLat - 0.26, lon: centerLon - 0.02, amp: 34, sx: 0.28, sy: 0.16 },
    { lat: centerLat + 0.05, lon: centerLon + 0.42, amp: 24, sx: 0.22, sy: 0.13 }
  ];

  for (let row = 0; row < nj; row += 1) {
    const lat = grid.lat1 - row * grid.dy;
    for (let col = 0; col < ni; col += 1) {
      const lon = grid.lon1 + col * grid.dx;
      let value = 0;
      for (const cell of cells) {
        const dx = (lon - cell.lon) / cell.sx;
        const dy = (lat - cell.lat) / cell.sy;
        value += cell.amp * Math.exp(-0.5 * (dx * dx + dy * dy));
      }
      const band = Math.max(0, 18 - Math.abs((lat - centerLat) * 18 + (lon - centerLon) * 9));
      const texture = 2.2 * Math.sin((lat + lon) * 52) + 1.5 * Math.cos((lat - lon) * 37);
      values[row * ni + col] = Math.max(0, value + band + texture - 4);
    }
  }

  return {
    sourceType: "synthetic",
    product: "SyntheticReflectivity_00.50",
    region: "LOCAL",
    observedAt: new Date().toISOString(),
    source: {
      kind: "synthetic",
      note: "Deterministic local radar-like field for chunk format smoke tests."
    },
    grid,
    values
  };
}

function buildCanonicalRaster({ values, grid, range, zoom, chunkSize, sampleSmooth }) {
  const width = (range.maxX - range.minX + 1) * chunkSize;
  const height = (range.maxY - range.minY + 1) * chunkSize;
  const data = new Float32Array(width * height);
  const worldSize = chunkSize * 2 ** zoom;
  let validPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const worldY = range.minY * chunkSize + y + 0.5;
    for (let x = 0; x < width; x += 1) {
      const worldX = range.minX * chunkSize + x + 0.5;
      const { lat, lon } = worldToLonLat(worldX, worldY, worldSize);
      const value = sampleGrid(values, grid, lat, lon, sampleSmooth);
      const index = y * width + x;
      data[index] = Number.isFinite(value) ? value : NaN;
      if (Number.isFinite(value)) validPixels += 1;
    }
  }

  return { zoom, chunkSize, range, width, height, data, validPixels };
}

function deriveLevelRaster({ canonical, bounds, zoom, chunkSize, pool }) {
  if (zoom > canonical.zoom) {
    throw new Error(`level z${zoom} is above canonical base z${canonical.zoom}`);
  }
  const range = tileRangeForBounds(bounds, zoom, chunkSize);
  const width = (range.maxX - range.minX + 1) * chunkSize;
  const height = (range.maxY - range.minY + 1) * chunkSize;
  const data = new Float32Array(width * height);
  const scale = 2 ** (canonical.zoom - zoom);
  let validPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const sourceY0 = Math.floor((range.minY * chunkSize + y) * scale - canonical.range.minY * chunkSize);
    const sourceY1 = Math.ceil((range.minY * chunkSize + y + 1) * scale - canonical.range.minY * chunkSize);
    for (let x = 0; x < width; x += 1) {
      const sourceX0 = Math.floor((range.minX * chunkSize + x) * scale - canonical.range.minX * chunkSize);
      const sourceX1 = Math.ceil((range.minX * chunkSize + x + 1) * scale - canonical.range.minX * chunkSize);
      const value = poolCanonical(canonical, sourceX0, sourceY0, sourceX1, sourceY1, pool);
      const index = y * width + x;
      data[index] = Number.isFinite(value) ? value : NaN;
      if (Number.isFinite(value)) validPixels += 1;
    }
  }

  return {
    zoom,
    chunkSize,
    range,
    width,
    height,
    data,
    validPixels,
    candidateChunks: (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)
  };
}

function writeLevelChunks({ raster, chunksRoot, valueEncoding, threshold, writeEmpty }) {
  const chunks = [];
  let bytes = 0;
  let precipPixels = 0;
  let minDbz = Infinity;
  let maxDbz = -Infinity;

  for (let ty = raster.range.minY; ty <= raster.range.maxY; ty += 1) {
    for (let tx = raster.range.minX; tx <= raster.range.maxX; tx += 1) {
      const chunk = encodeChunkPayload({ raster, x: tx, y: ty, valueEncoding, threshold });
      if (!writeEmpty && chunk.precipPixels === 0) continue;

      const relativePath = path.posix.join("chunks", `z${raster.zoom}`, String(tx), `${ty}.ncrd.gz`);
      const outPath = path.join(chunksRoot, `z${raster.zoom}`, String(tx), `${ty}.ncrd.gz`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const encoded = encodeChunkBinary({
        zoom: raster.zoom,
        x: tx,
        y: ty,
        width: raster.chunkSize,
        height: raster.chunkSize,
        valueEncoding,
        bounds: tileRangeToBounds({ minX: tx, maxX: tx, minY: ty, maxY: ty }, raster.zoom, raster.chunkSize)
      }, chunk.payload);
      fs.writeFileSync(outPath, encoded);

      bytes += encoded.length;
      precipPixels += chunk.precipPixels;
      if (Number.isFinite(chunk.minDbz) && chunk.minDbz < minDbz) minDbz = chunk.minDbz;
      if (Number.isFinite(chunk.maxDbz) && chunk.maxDbz > maxDbz) maxDbz = chunk.maxDbz;
      chunks.push({
        x: tx,
        y: ty,
        path: relativePath,
        byteLength: encoded.length,
        precipPixels: chunk.precipPixels,
        minDbz: round(chunk.minDbz, 1),
        maxDbz: round(chunk.maxDbz, 1),
        bounds: tileRangeToBounds({ minX: tx, maxX: tx, minY: ty, maxY: ty }, raster.zoom, raster.chunkSize)
      });
    }
  }

  return { chunks, bytes, precipPixels, minDbz, maxDbz };
}

function encodeChunkPayload({ raster, x, y, valueEncoding, threshold }) {
  const payload = new Uint8Array(raster.chunkSize * raster.chunkSize);
  const offsetX = (x - raster.range.minX) * raster.chunkSize;
  const offsetY = (y - raster.range.minY) * raster.chunkSize;
  let precipPixels = 0;
  let minDbz = Infinity;
  let maxDbz = -Infinity;

  for (let py = 0; py < raster.chunkSize; py += 1) {
    const sourceRow = (offsetY + py) * raster.width;
    const outRow = py * raster.chunkSize;
    for (let px = 0; px < raster.chunkSize; px += 1) {
      const value = raster.data[sourceRow + offsetX + px];
      const encoded = encodeDbz(value, valueEncoding, threshold);
      payload[outRow + px] = encoded;
      if (!encoded) continue;
      precipPixels += 1;
      if (value < minDbz) minDbz = value;
      if (value > maxDbz) maxDbz = value;
    }
  }

  return { payload, precipPixels, minDbz, maxDbz };
}

function encodeChunkBinary(meta, payload) {
  const header = Buffer.from(`${JSON.stringify({
    provider: "nearcast-radar-chunk",
    version: 1,
    ...meta
  })}\n`, "utf8");
  if (header.length > 65_535) throw new Error("chunk header too large");
  const prefix = Buffer.alloc(12);
  prefix.write("NCRD", 0, "ascii");
  prefix.writeUInt16BE(1, 4);
  prefix.writeUInt16BE(header.length, 6);
  prefix.writeUInt32BE(payload.length, 8);
  return zlib.gzipSync(Buffer.concat([prefix, header, Buffer.from(payload)]));
}

function encodeDbz(value, encoding, threshold) {
  if (!Number.isFinite(value) || value < threshold) return 0;
  const clamped = Math.max(encoding.dbzMin, Math.min(encoding.dbzMax, value));
  return Math.max(1, Math.min(255, Math.round(1 + (clamped - encoding.dbzMin) / (encoding.dbzMax - encoding.dbzMin) * 254)));
}

function poolCanonical(canonical, x0, y0, x1, y1, pool) {
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  const minX = Math.max(0, x0);
  const minY = Math.max(0, y0);
  const maxX = Math.min(canonical.width, x1);
  const maxY = Math.min(canonical.height, y1);

  for (let y = minY; y < maxY; y += 1) {
    const row = y * canonical.width;
    for (let x = minX; x < maxX; x += 1) {
      const value = canonical.data[row + x];
      if (!Number.isFinite(value)) continue;
      if (value > max) max = value;
      sum += value;
      count += 1;
    }
  }

  if (!count) return NaN;
  return pool === "mean" ? sum / count : max;
}

function canonicalRangeForLevels(bounds, levels, baseZoom, chunkSize) {
  const ranges = levels.map((zoom) => zoomRangeAtBaseZoom(tileRangeForBounds(bounds, zoom, chunkSize), zoom, baseZoom));
  ranges.push(tileRangeForBounds(bounds, baseZoom, chunkSize));
  return ranges.reduce((result, range) => ({
    minX: Math.min(result.minX, range.minX),
    maxX: Math.max(result.maxX, range.maxX),
    minY: Math.min(result.minY, range.minY),
    maxY: Math.max(result.maxY, range.maxY)
  }), ranges[0]);
}

function zoomRangeAtBaseZoom(range, zoom, baseZoom) {
  if (zoom > baseZoom) throw new Error(`level z${zoom} is above canonical base z${baseZoom}`);
  const scale = 2 ** (baseZoom - zoom);
  return {
    minX: range.minX * scale,
    maxX: (range.maxX + 1) * scale - 1,
    minY: range.minY * scale,
    maxY: (range.maxY + 1) * scale - 1
  };
}

function tileRangeForBounds(bounds, zoom, tileSize) {
  const nw = tileForLatLon(bounds.maxLat, bounds.minLon, zoom, tileSize);
  const se = tileForLatLon(bounds.minLat, bounds.maxLon, zoom, tileSize);
  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minY: Math.min(nw.y, se.y),
    maxY: Math.max(nw.y, se.y)
  };
}

function tileForLatLon(lat, lon, zoom, tileSize) {
  const worldSize = tileSize * 2 ** zoom;
  const sinLat = Math.sin(Math.max(-85.05113, Math.min(85.05113, lat)) * Math.PI / 180);
  const x = (lon + 180) / 360 * worldSize;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return {
    x: Math.floor(x / tileSize),
    y: Math.floor(y / tileSize)
  };
}

function tileRangeToBounds(range, zoom, chunkSize) {
  const worldSize = chunkSize * 2 ** zoom;
  const nw = worldToLonLat(range.minX * chunkSize, range.minY * chunkSize, worldSize);
  const se = worldToLonLat((range.maxX + 1) * chunkSize, (range.maxY + 1) * chunkSize, worldSize);
  return roundBounds({
    minLat: se.lat,
    minLon: nw.lon,
    maxLat: nw.lat,
    maxLon: se.lon
  });
}

function summarizeLevels(levels) {
  return levels.reduce((result, level) => ({
    candidateChunks: result.candidateChunks + level.candidateChunks,
    chunkCount: result.chunkCount + level.chunkCount,
    precipPixels: result.precipPixels + level.precipPixels,
    bytes: result.bytes + level.bytes,
    minDbz: minFinite(result.minDbz, level.minDbz),
    maxDbz: maxFinite(result.maxDbz, level.maxDbz)
  }), {
    candidateChunks: 0,
    chunkCount: 0,
    precipPixels: 0,
    bytes: 0,
    minDbz: Infinity,
    maxDbz: -Infinity
  });
}

function minFinite(a, b) {
  const values = [a, b].filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function maxFinite(a, b) {
  const values = [a, b].filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function roundBounds(bounds) {
  return {
    minLat: round(bounds.minLat, 5),
    minLon: round(bounds.minLon, 5),
    maxLat: round(bounds.maxLat, 5),
    maxLon: round(bounds.maxLon, 5)
  };
}

function parseLevels(value) {
  const levels = String(value || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite)
    .map((item) => Math.round(item));
  const unique = [...new Set(levels)].sort((a, b) => a - b);
  if (!unique.length) throw new Error("--levels expects one or more integer zoom-like levels");
  if (unique.some((level) => level < 0 || level > 22)) throw new Error("--levels must be between 0 and 22");
  return unique;
}

function normalizePool(value) {
  const normalized = String(value || "max").trim().toLowerCase();
  if (normalized === "mean") return "mean";
  if (normalized === "max") return "max";
  throw new Error("--pool must be max or mean");
}

function observedAtFromInput(options) {
  const explicit = options["observed-at"] || options["frame-time"];
  if (explicit) {
    const parsed = new Date(explicit);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const source = options.url || options.file || "";
  const match = String(source).match(/_(\d{8})-(\d{6})\.grib2(?:\.gz)?$/);
  if (!match) return null;
  const [, ymd, hms] = match;
  return new Date(Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
    Number(hms.slice(0, 2)),
    Number(hms.slice(2, 4)),
    Number(hms.slice(4, 6))
  )).toISOString();
}

function atomicWriteJson(file, data) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function numberArg(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function booleanArg(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/encode-mrms-chunks.mjs --synthetic
  node scripts/mrms-prototype/encode-mrms-chunks.mjs --file=/tmp/frame.grib2.gz --bounds=30.35,-88.3,31.25,-87.2
  node scripts/mrms-prototype/encode-mrms-chunks.mjs --product=MergedReflectivityQCComposite_00.50 --bounds=43.8,-89.4,45.2,-87

Options:
  --synthetic                 Use deterministic local radar-like data.
  --file=PATH                 Local .grib2 or .grib2.gz file.
  --url=URL                   Direct MRMS object URL.
  --product=NAME              MRMS product. Defaults to renderer default when fetching latest.
  --region=CONUS              MRMS region.
  --date=YYYYMMDD             Date folder for latest public MRMS lookup.
  --bounds=minLat,minLon,maxLat,maxLon
                              Coverage bounds to encode. Defaults to Bay Minette test area.
  --levels=8,9,10             Zoom-like data levels to publish.
  --base-zoom=10              Canonical sampled level used to derive lower levels.
  --chunk-size=256            Chunk width/height in samples.
  --pool=max                  Downsample method from canonical: max or mean.
  --threshold=5               Minimum dBZ encoded as visible precipitation.
  --dbz-min=0 --dbz-max=80    Uint8 dBZ scaling range.
  --sample-smooth=0           Optional source-grid smoothing before chunk encoding.
  --write-empty               Write chunks even when they contain no visible precipitation.
  --max-pixels=80000000       Canonical raster safety cap.
  --out-dir=/tmp/nearcast-radar-chunks
                              Output root for chunks and index.
  --index-out=PATH            Index path. Defaults to out-dir/index.json.
  --summary-out=PATH          Optional compact summary JSON path.
`);
}
