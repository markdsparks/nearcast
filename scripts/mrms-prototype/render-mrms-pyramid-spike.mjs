#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  decodeGridValues,
  decodePngGrayscale16,
  defaultSmoothForStyle,
  edgeFocus,
  encodePngRgba,
  gridValueStats,
  loadGribBuffer,
  lonLatToWorld,
  parseBounds,
  parseGrib2,
  radarStyle,
  round,
  sampleGrid,
  transparentRadarColor,
  worldToLonLat
} from "./render-mrms-preview.mjs";

const DEFAULT_BOUNDS = "43.8,-89.4,45.2,-87";
const DEFAULT_OUT = "/tmp/nearcast-mrms-pyramid-spike.png";
const DEFAULT_SUMMARY_OUT = "/tmp/nearcast-mrms-pyramid-spike.json";
const DEFAULT_ZOOMS = "8,9,10";
const DEFAULT_BASE_ZOOM = 10;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_PANEL_SIZE = 420;

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`MRMS pyramid spike failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  const grib = await loadGribBuffer(args);
  const parsed = parseGrib2(grib);
  const values = decodedGridValues(grib, parsed);
  const bounds = parseBounds(args.bounds || DEFAULT_BOUNDS);
  const focusBounds = parseBounds(args["focus-bounds"] || args.bounds || DEFAULT_BOUNDS);
  const stats = gridValueStats(values, parsed.grid, focusBounds);
  const focus = args.focus === "edge" ? edgeFocus(values, parsed.grid, focusBounds) : null;
  const center = centerForBounds(bounds);
  const centerLat = Number.isFinite(focus?.lat) ? focus.lat : numberArg(args.lat, center.lat);
  const centerLon = Number.isFinite(focus?.lon) ? focus.lon : numberArg(args.lon, center.lon);
  const zooms = parseZooms(args.zooms || DEFAULT_ZOOMS);
  const baseZoom = Math.max(...zooms, Math.round(numberArg(args["base-zoom"], DEFAULT_BASE_ZOOM)));
  const tileSize = Math.max(64, Math.min(512, Math.round(numberArg(args["tile-size"], DEFAULT_TILE_SIZE))));
  const panelSize = Math.max(240, Math.min(900, Math.round(numberArg(args["panel-size"], DEFAULT_PANEL_SIZE))));
  const threshold = numberArg(args.threshold, 5);
  const styleName = normalizeStyle(args.style || "resolved");
  const style = radarStyle(styleName, args);
  const smooth = numberArg(args.smooth, defaultSmoothForStyle(style.name));
  const pool = String(args.pool || "max").toLowerCase() === "mean" ? "mean" : "max";

  const canonicalRange = canonicalRangeForZooms(bounds, zooms, baseZoom, tileSize);
  const canonical = buildDirectRaster({
    values,
    grid: parsed.grid,
    bounds,
    zoom: baseZoom,
    tileSize,
    smooth,
    label: "canonical",
    rangeOverride: canonicalRange
  });

  const rows = zooms.map((zoom) => {
    const direct = buildDirectRaster({
      values,
      grid: parsed.grid,
      bounds,
      zoom,
      tileSize,
      smooth,
      label: "direct"
    });
    const pyramid = deriveRasterFromCanonical({
      canonical,
      bounds,
      zoom,
      tileSize,
      pool
    });
    return {
      zoom,
      direct,
      pyramid,
      metrics: compareRasters(direct, pyramid, { threshold })
    };
  });

  const sheet = composeComparisonSheet(rows, {
    panelSize,
    threshold,
    style,
    transparent: Boolean(args.transparent)
  });
  const out = args.out || DEFAULT_OUT;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePngRgba(sheet.width, sheet.height, sheet.pixels));

  const svgOut = args["svg-out"];
  if (svgOut) {
    fs.mkdirSync(path.dirname(svgOut), { recursive: true });
    fs.writeFileSync(svgOut, comparisonSvg({ ...sheet, out, rows, panelSize }));
  }

  const summary = {
    provider: "nearcast-mrms-pyramid-spike",
    version: 1,
    generatedAt: new Date().toISOString(),
    out,
    svgOut: svgOut || "",
    bounds,
    center: {
      lat: round(centerLat, 5),
      lon: round(centerLon, 5)
    },
    focus: args.focus || "bounds-center",
    focusBounds,
    stats,
    style: style.name,
    smooth,
    threshold,
    pool,
    tileSize,
    baseZoom,
    zooms,
    canonical: {
      ...rasterSummary(canonical, threshold),
      derivedFromZooms: zooms,
      coverageRange: canonicalRange
    },
    rows: rows.map((row) => ({
      zoom: row.zoom,
      direct: rasterSummary(row.direct, threshold),
      pyramid: rasterSummary(row.pyramid, threshold),
      metrics: row.metrics
    })),
    elapsedMs: Date.now() - startedAt
  };

  const summaryOut = args["summary-out"] || DEFAULT_SUMMARY_OUT;
  if (summaryOut) {
    fs.mkdirSync(path.dirname(summaryOut), { recursive: true });
    fs.writeFileSync(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
}

function decodedGridValues(grib, parsed) {
  const pngSection = parsed.sections.find((section) => section.number === 7);
  if (!pngSection) throw new Error("GRIB2 section 7 data payload not found");
  const embeddedPng = grib.subarray(pngSection.offset + 5, pngSection.offset + pngSection.length);
  const decodedPng = decodePngGrayscale16(embeddedPng);
  return decodeGridValues(decodedPng.samples, parsed.dataRepresentation);
}

function buildDirectRaster({ values, grid, bounds, zoom, tileSize, smooth, label, rangeOverride = null }) {
  const range = rangeOverride || tileRangeForBounds(bounds, zoom, tileSize);
  const width = (range.maxX - range.minX + 1) * tileSize;
  const height = (range.maxY - range.minY + 1) * tileSize;
  const data = new Float32Array(width * height);
  const worldSize = tileSize * 2 ** zoom;
  let validPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const worldY = range.minY * tileSize + y + 0.5;
    for (let x = 0; x < width; x += 1) {
      const worldX = range.minX * tileSize + x + 0.5;
      const { lat, lon } = worldToLonLat(worldX, worldY, worldSize);
      const value = sampleGrid(values, grid, lat, lon, smooth);
      const index = y * width + x;
      data[index] = Number.isFinite(value) ? value : NaN;
      if (Number.isFinite(value)) validPixels += 1;
    }
  }

  return { label, zoom, tileSize, range, bounds, width, height, data, validPixels };
}

function deriveRasterFromCanonical({ canonical, bounds, zoom, tileSize, pool }) {
  if (zoom > canonical.zoom) throw new Error(`target zoom z${zoom} is above canonical z${canonical.zoom}`);
  const range = tileRangeForBounds(bounds, zoom, tileSize);
  const width = (range.maxX - range.minX + 1) * tileSize;
  const height = (range.maxY - range.minY + 1) * tileSize;
  const data = new Float32Array(width * height);
  const scale = 2 ** (canonical.zoom - zoom);
  let validPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const sourceY0 = Math.floor((range.minY * tileSize + y) * scale - canonical.range.minY * tileSize);
    const sourceY1 = Math.ceil((range.minY * tileSize + y + 1) * scale - canonical.range.minY * tileSize);
    for (let x = 0; x < width; x += 1) {
      const sourceX0 = Math.floor((range.minX * tileSize + x) * scale - canonical.range.minX * tileSize);
      const sourceX1 = Math.ceil((range.minX * tileSize + x + 1) * scale - canonical.range.minX * tileSize);
      const value = poolCanonical(canonical, sourceX0, sourceY0, sourceX1, sourceY1, pool);
      const index = y * width + x;
      data[index] = Number.isFinite(value) ? value : NaN;
      if (Number.isFinite(value)) validPixels += 1;
    }
  }

  return { label: `pyramid-${pool}`, zoom, tileSize, range, bounds, width, height, data, validPixels };
}

function canonicalRangeForZooms(bounds, zooms, baseZoom, tileSize) {
  const ranges = zooms.map((zoom) => zoomRangeAtBaseZoom(tileRangeForBounds(bounds, zoom, tileSize), zoom, baseZoom));
  ranges.push(tileRangeForBounds(bounds, baseZoom, tileSize));
  return ranges.reduce((result, range) => ({
    minX: Math.min(result.minX, range.minX),
    maxX: Math.max(result.maxX, range.maxX),
    minY: Math.min(result.minY, range.minY),
    maxY: Math.max(result.maxY, range.maxY)
  }), ranges[0]);
}

function zoomRangeAtBaseZoom(range, zoom, baseZoom) {
  if (zoom > baseZoom) throw new Error(`target zoom z${zoom} is above canonical z${baseZoom}`);
  const scale = 2 ** (baseZoom - zoom);
  return {
    minX: range.minX * scale,
    maxX: (range.maxX + 1) * scale - 1,
    minY: range.minY * scale,
    maxY: (range.maxY + 1) * scale - 1
  };
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

function compareRasters(a, b, { threshold }) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`cannot compare rasters with different dimensions at z${a.zoom}`);
  }
  let aOn = 0;
  let bOn = 0;
  let bothOn = 0;
  let unionOn = 0;
  let compared = 0;
  let absoluteDelta = 0;
  let squaredDelta = 0;
  let maxDelta = 0;

  for (let i = 0; i < a.data.length; i += 1) {
    const av = a.data[i];
    const bv = b.data[i];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const aMask = av >= threshold;
    const bMask = bv >= threshold;
    if (aMask) aOn += 1;
    if (bMask) bOn += 1;
    if (aMask && bMask) bothOn += 1;
    if (aMask || bMask) {
      unionOn += 1;
      const delta = Math.abs(av - bv);
      absoluteDelta += delta;
      squaredDelta += delta * delta;
      if (delta > maxDelta) maxDelta = delta;
    }
    compared += 1;
  }

  return {
    maskIou: unionOn ? round(bothOn / unionOn, 4) : 1,
    directPixels: aOn,
    pyramidPixels: bOn,
    overlapPixels: bothOn,
    unionPixels: unionOn,
    precipDeltaPercent: round((bOn - aOn) / Math.max(1, aOn) * 100, 2),
    maeOnUnion: unionOn ? round(absoluteDelta / unionOn, 3) : 0,
    rmseOnUnion: unionOn ? round(Math.sqrt(squaredDelta / unionOn), 3) : 0,
    maxDelta: round(maxDelta, 2),
    comparedPixels: compared
  };
}

function rasterSummary(raster, threshold) {
  let precipPixels = 0;
  let maxDbz = -Infinity;
  let minDbz = Infinity;
  for (let i = 0; i < raster.data.length; i += 1) {
    const value = raster.data[i];
    if (!Number.isFinite(value)) continue;
    if (value >= threshold) precipPixels += 1;
    if (value > maxDbz) maxDbz = value;
    if (value < minDbz) minDbz = value;
  }
  return {
    zoom: raster.zoom,
    width: raster.width,
    height: raster.height,
    range: raster.range,
    validPixels: raster.validPixels,
    precipPixels,
    precipPercent: round(precipPixels / Math.max(1, raster.width * raster.height) * 100, 3),
    minDbz: Number.isFinite(minDbz) ? round(minDbz, 1) : null,
    maxDbz: Number.isFinite(maxDbz) ? round(maxDbz, 1) : null
  };
}

function composeComparisonSheet(rows, options) {
  const gutter = 16;
  const panelSize = options.panelSize;
  const columns = 2;
  const width = columns * panelSize + gutter;
  const height = rows.length * panelSize + (rows.length - 1) * gutter;
  const pixels = new Uint8ClampedArray(width * height * 4);
  fillBackground(pixels, width, height, [246, 247, 248, 255]);

  rows.forEach((row, index) => {
    const y = index * (panelSize + gutter);
    copyPanel(rasterPanel(row.direct, options), pixels, panelSize, panelSize, width, 0, y);
    copyPanel(rasterPanel(row.pyramid, options), pixels, panelSize, panelSize, width, panelSize + gutter, y);
  });

  return { width, height, pixels };
}

function rasterPanel(raster, { panelSize, threshold, style, transparent }) {
  const pixels = new Uint8ClampedArray(panelSize * panelSize * 4);
  for (let y = 0; y < panelSize; y += 1) {
    for (let x = 0; x < panelSize; x += 1) {
      const index = (y * panelSize + x) * 4;
      if (!transparent) paintPanelBasemap(pixels, index, x, y, panelSize, panelSize);
      else pixels[index + 3] = 0;
      const sourceX = (x + 0.5) / panelSize * raster.width - 0.5;
      const sourceY = (y + 0.5) / panelSize * raster.height - 0.5;
      const value = sampleRasterBilinear(raster, sourceX, sourceY);
      const color = transparentRadarColor(value, threshold, style);
      if (!color) continue;
      const alpha = color[3] / 255;
      pixels[index] = Math.round(color[0] * alpha + pixels[index] * (1 - alpha));
      pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * (1 - alpha));
      pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * (1 - alpha));
      pixels[index + 3] = transparent ? color[3] : 255;
    }
  }
  return pixels;
}

function sampleRasterBilinear(raster, x, y) {
  if (x < 0 || y < 0 || x >= raster.width - 1 || y >= raster.height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xFrac = x - x0;
  const yFrac = y - y0;
  const v00 = raster.data[y0 * raster.width + x0];
  const v10 = raster.data[y0 * raster.width + x0 + 1];
  const v01 = raster.data[(y0 + 1) * raster.width + x0];
  const v11 = raster.data[(y0 + 1) * raster.width + x0 + 1];
  if (![v00, v10, v01, v11].every(Number.isFinite)) return NaN;
  const top = v00 * (1 - xFrac) + v10 * xFrac;
  const bottom = v01 * (1 - xFrac) + v11 * xFrac;
  return top * (1 - yFrac) + bottom * yFrac;
}

function copyPanel(source, target, panelWidth, panelHeight, targetWidth, xOffset, yOffset) {
  for (let y = 0; y < panelHeight; y += 1) {
    const sourceStart = y * panelWidth * 4;
    const targetStart = ((y + yOffset) * targetWidth + xOffset) * 4;
    target.set(source.subarray(sourceStart, sourceStart + panelWidth * 4), targetStart);
  }
}

function fillBackground(pixels, width, height, color) {
  for (let i = 0; i < width * height; i += 1) {
    const index = i * 4;
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = color[3];
  }
}

function paintPanelBasemap(pixels, index, x, y, width, height) {
  const shade = 232 + Math.round(9 * Math.sin(x / 71) + 5 * Math.cos(y / 47));
  const road = Math.abs((x * 0.85 + y * 0.34) % 170 - 85) < 1.2 ||
    Math.abs((x * 0.28 - y) % 220 - 110) < 1.1;
  const water = y > height * 0.66 && Math.sin(x / 54) + Math.cos(y / 38) > 1.22;
  pixels[index] = water ? 207 : road ? 246 : shade;
  pixels[index + 1] = water ? 224 : road ? 243 : shade;
  pixels[index + 2] = water ? 233 : road ? 235 : shade + 2;
  pixels[index + 3] = 255;
}

function comparisonSvg(sheet) {
  const gutter = 16;
  const left = 82;
  const top = 42;
  const width = left + sheet.width;
  const height = top + sheet.height + 34;
  const image = encodePngRgba(sheet.width, sheet.height, sheet.pixels).toString("base64");
  const rowLabels = sheet.rows.map((row, index) => {
    const y = top + index * (sheet.panelSize + gutter) + sheet.panelSize / 2 + 5;
    return `<text x="70" y="${y}" text-anchor="end">z${row.zoom}</text>`;
  }).join("");
  const directX = left + sheet.panelSize / 2;
  const pyramidX = left + sheet.panelSize + gutter + sheet.panelSize / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f6f7f8"/>
  <style>
    text { font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #263342; }
  </style>
  <text x="${directX}" y="24" text-anchor="middle">direct per zoom</text>
  <text x="${pyramidX}" y="24" text-anchor="middle">single-field pyramid</text>
  ${rowLabels}
  <image x="${left}" y="${top}" width="${sheet.width}" height="${sheet.height}" href="data:image/png;base64,${image}"/>
  <text x="${left}" y="${height - 10}" font-weight="500">Pyramid column derives lower zooms from one canonical high zoom field.</text>
</svg>
`;
}

function tileRangeForBounds(bounds, zoom, tileSize = DEFAULT_TILE_SIZE) {
  const nw = tileForLatLon(bounds.maxLat, bounds.minLon, zoom, tileSize);
  const se = tileForLatLon(bounds.minLat, bounds.maxLon, zoom, tileSize);
  return {
    minX: Math.min(nw.x, se.x),
    maxX: Math.max(nw.x, se.x),
    minY: Math.min(nw.y, se.y),
    maxY: Math.max(nw.y, se.y)
  };
}

function tileForLatLon(lat, lon, zoom, tileSize = DEFAULT_TILE_SIZE) {
  const worldSize = tileSize * 2 ** zoom;
  const world = lonLatToWorld(lon, lat, worldSize);
  return {
    x: Math.floor(world.x / tileSize),
    y: Math.floor(world.y / tileSize)
  };
}

function centerForBounds(bounds) {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2
  };
}

function parseZooms(value) {
  const zooms = String(value || DEFAULT_ZOOMS)
    .split(",")
    .map((item) => Math.round(Number(item.trim())))
    .filter((zoom) => Number.isInteger(zoom) && zoom >= 0 && zoom <= 18);
  if (!zooms.length) throw new Error("--zooms must contain at least one integer zoom");
  return [...new Set(zooms)].sort((a, b) => a - b);
}

function normalizeStyle(value) {
  const next = String(value || "").toLowerCase();
  if (["resolved", "banded", "continuous"].includes(next)) return next;
  return "resolved";
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
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/render-mrms-pyramid-spike.mjs

Options:
  --bounds=43.8,-89.4,45.2,-87   Geographic bounds to compare.
  --zooms=8,9,10                 Output zoom levels to compare.
  --base-zoom=10                 Canonical zoom used by the pyramid.
  --pool=max                     Pyramid downsample: max or mean.
  --style=resolved               Visual style: resolved, banded, continuous.
  --smooth=2.15                  MRMS source smoothing radius.
  --threshold=5                  Minimum dBZ precipitation threshold.
  --out=/tmp/file.png            Comparison PNG output.
  --svg-out=/tmp/file.svg        Optional labeled SVG wrapper.
  --summary-out=/tmp/file.json   Metrics JSON output.
  --file=PATH or --url=URL       Optional MRMS frame source.
`);
}
