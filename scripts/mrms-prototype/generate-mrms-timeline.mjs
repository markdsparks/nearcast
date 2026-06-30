#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const BUCKET_URL = "https://noaa-mrms-pds.s3.amazonaws.com/";
const DEFAULT_REGION = "CONUS";
const DEFAULT_PRODUCT = "MergedReflectivityQCComposite_00.50";
const DEFAULT_FRAMES = 6;
const DEFAULT_OUT_DIR = "radar/mrms/live";
const DEFAULT_MANIFEST_OUT = "radar/mrms/manifest.json";
const DEFAULT_TILE_ZOOMS = "6,7,8,9,10,11,12,13,14";
const DEFAULT_TILE_RADIUS = "2";
const DEFAULT_TTL_MINUTES = 15;

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`MRMS timeline generation failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  const region = cleanSegment(args.region || DEFAULT_REGION);
  const product = cleanSegment(args.product || DEFAULT_PRODUCT);
  const frameLimit = Math.max(1, Math.round(numberArg(args.frames || args.limit, DEFAULT_FRAMES)));
  const outDir = args["out-dir"] || DEFAULT_OUT_DIR;
  const manifestOut = args["manifest-out"] || DEFAULT_MANIFEST_OUT;
  const sources = await resolveSources({ region, product, frameLimit });
  if (!sources.length) throw new Error("no MRMS frame sources resolved");
  const sourcePlan = buildSourcePlan({ sources, region, product });
  const renderConfig = buildRenderConfig({ region, product, frameLimit });
  const publishFingerprint = hashJson({ source: sourcePlan, renderConfig });

  if (booleanArg(args["resolve-only"], false)) {
    console.log(JSON.stringify({
      provider: "mrms-generated",
      product,
      region,
      frameCount: sources.length,
      source: sourcePlan,
      renderConfig,
      publishFingerprint
    }, null, 2));
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestOut), { recursive: true });

  const generated = [];
  const orderedSources = [...sources].sort((a, b) => a.timestamp - b.timestamp);
  for (const source of orderedSources) {
    generated.push(renderFrame({ source, region, product, outDir, manifestOut }));
  }

  const manifest = combineFrameManifests({
    manifests: generated.map((item) => item.manifest),
    region,
    product,
    outDir,
    manifestOut,
    sourcePlan,
    renderConfig,
    publishFingerprint,
    startedAt
  });
  atomicWriteJson(manifestOut, manifest);

  console.log(JSON.stringify({
    provider: manifest.provider,
    product,
    region,
    manifestOut,
    outDir,
    frameCount: manifest.frames.length,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    publishFingerprint: manifest.publishFingerprint,
    sourceSignature: manifest.source?.signature,
    sample: manifest.sample,
    frames: manifest.frames.map((frame) => ({
      id: frame.id,
      time: frame.time,
      maxZoom: frame.maxZoom,
      url: frame.url
    }))
  }, null, 2));
}

async function resolveSources({ region, product, frameLimit }) {
  const files = splitList(args.files || args.file);
  if (files.length) {
    const frameTimes = splitList(args["frame-times"] || args["frame-time"]);
    return files.slice(0, frameLimit).map((file, index) => sourceFromFile(file, frameTimes[index], index));
  }

  const urls = splitList(args.urls || args.url);
  if (urls.length) {
    const frameTimes = splitList(args["frame-times"] || args["frame-time"]);
    return urls.slice(0, frameLimit).map((url, index) => sourceFromUrl(url, frameTimes[index], index));
  }

  const objects = await latestProductObjects({
    region,
    product,
    date: args.date,
    daysBack: numberArg(args["days-back"], 1),
    maxKeys: numberArg(args["max-keys"], 1000)
  });
  return objects.slice(0, frameLimit).map((object, index) => sourceFromUrl(object.url, object.observedAt, index, object));
}

function sourceFromFile(file, frameTime, index) {
  const observedAt = parseTime(frameTime) || observedTimeFromKey(file) || fallbackFrameTime(index);
  const stat = statFile(file);
  return {
    kind: "file",
    value: file,
    key: path.basename(file),
    size: stat?.size || null,
    lastModified: stat?.mtime || null,
    timestamp: observedAt.getTime(),
    observedAt: observedAt.toISOString()
  };
}

function sourceFromUrl(url, frameTime, index, object = {}) {
  const observedAt = parseTime(frameTime) || observedTimeFromKey(url) || fallbackFrameTime(index);
  return {
    kind: "url",
    value: url,
    key: object.key || keyFromSourceUrl(url),
    size: Number.isFinite(Number(object.size)) ? Number(object.size) : null,
    lastModified: object.lastModified || null,
    timestamp: observedAt.getTime(),
    observedAt: observedAt.toISOString()
  };
}

function renderFrame({ source, region, product, outDir, manifestOut }) {
  const startedAt = Date.now();
  const frameId = cleanTileSegment(args["frame-prefix"] ? `${args["frame-prefix"]}-${frameIdForIso(source.observedAt)}` : frameIdForIso(source.observedAt));
  const tileOut = path.join(outDir, frameId);
  const tempManifestOut = path.join(outDir, `.manifest-${frameId}.json`);
  const tileUrl = frameTileUrl({
    tileUrlBase: args["tile-url-base"] || args["tile-base-url"],
    frameId,
    manifestOut,
    tileOut
  });
  const renderScript = path.join(path.dirname(new URL(import.meta.url).pathname), "render-mrms-preview.mjs");
  const commandArgs = [
    renderScript,
    `--${source.kind}=${source.value}`,
    "--generate-tiles",
    `--region=${region}`,
    `--product=${product}`,
    `--style=${args.style || "banded"}`,
    `--focus=${args.focus || (args.lat || args.lon ? "point" : "max")}`,
    `--bounds=${args.bounds || args["focus-bounds"] || "25,-125,49,-70"}`,
    `--tile-zooms=${args["tile-zooms"] || args.zooms || DEFAULT_TILE_ZOOMS}`,
    `--tile-radius=${args["tile-radius"] || DEFAULT_TILE_RADIUS}`,
    `--frame-id=${frameId}`,
    `--tile-out=${tileOut}`,
    `--tile-url=${tileUrl}`,
    `--manifest-out=${tempManifestOut}`,
    `--frame-time=${source.observedAt}`,
    `--ttl-minutes=${args["ttl-minutes"] || DEFAULT_TTL_MINUTES}`,
    `--tile-version=${args["tile-version"] || buildTileVersion()}`
  ];

  if (args.lat) commandArgs.push(`--lat=${args.lat}`);
  if (args.lon) commandArgs.push(`--lon=${args.lon}`);
  if (args["tile-bounds"] || args["coverage-bounds"]) {
    commandArgs.push(`--tile-bounds=${args["tile-bounds"] || args["coverage-bounds"]}`);
  }
  if (booleanArg(args["skip-empty-tiles"], false)) commandArgs.push("--skip-empty-tiles");
  if (booleanArg(args["encoded-tiles"] ?? args["data-tiles"], false)) commandArgs.push("--encoded-tiles");
  if (booleanArg(args["active-tile-plan"], false)) commandArgs.push("--active-tile-plan");
  if (args["active-tile-buffer"] !== undefined) commandArgs.push(`--active-tile-buffer=${args["active-tile-buffer"]}`);
  if (booleanArg(args.sample, false)) commandArgs.push("--sample");

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16
  });
  if (result.status !== 0) {
    throw new Error([
      `render failed for ${source.value}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }

  const manifest = JSON.parse(fs.readFileSync(tempManifestOut, "utf8"));
  const sourceObject = sourceObjectForManifest(source);
  manifest.source = {
    provider: "noaa-mrms-pds",
    product,
    region,
    objects: [sourceObject],
    signature: hashJson({ product, region, objects: [sourceObject] })
  };
  manifest.frames = (manifest.frames || []).map((frame) => ({
    ...frame,
    sourceObject
  }));
  manifest.metrics = {
    ...(manifest.metrics || {}),
    generationMs: Date.now() - startedAt
  };
  try {
    fs.unlinkSync(tempManifestOut);
  } catch {
    /* Best effort cleanup; the combined manifest is the published contract. */
  }
  return { frameId, tileOut, manifest };
}

function combineFrameManifests({ manifests, region, product, outDir, manifestOut, sourcePlan, renderConfig, publishFingerprint, startedAt }) {
  const frames = manifests
    .flatMap((manifest) => manifest.frames || [])
    .filter((frame) => Number.isFinite(Number(frame.timestamp)))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const generatedAt = new Date().toISOString();
  const expiresAt = generatedExpiresAt(args, generatedAt);
  const generatedTiles = manifests.reduce((sum, manifest) => sum + Number(manifest.coverage?.generatedTiles || 0), 0);
  const candidateTiles = manifests.reduce((sum, manifest) => sum + Number(manifest.coverage?.candidateTiles || 0), 0);
  const radarTiles = manifests.reduce((sum, manifest) => sum + Number(manifest.coverage?.radarTiles || 0), 0);
  const dataTiles = manifests.reduce((sum, manifest) => sum + Number(manifest.coverage?.dataTiles || 0), 0);
  const first = manifests[0] || {};
  const explicitCoverageBounds = parseBounds(args["tile-bounds"] || args["coverage-bounds"]);
  const coverageAreas = combinedCoverageAreas(manifests, explicitCoverageBounds);
  const coverageBounds = explicitCoverageBounds || unionBounds(coverageAreas.map((area) => area.bounds));

  return {
    provider: "mrms-generated",
    product,
    region,
    style: args.style || first.style || "banded",
    mode: first.mode || ((args["tile-bounds"] || args["coverage-bounds"]) ? "bounds" : "radius"),
    sample: booleanArg(args.sample, false),
    generatedAt,
    expiresAt,
    source: sourcePlan,
    renderConfig,
    publishFingerprint,
    minZoom: minNumber(manifests.map((manifest) => manifest.minZoom)),
    maxZoom: maxNumber(manifests.map((manifest) => manifest.maxZoom)),
    tileSize: first.tileSize || 256,
    tileRadius: first.tileRadius,
    skipEmptyTiles: booleanArg(args["skip-empty-tiles"], false),
    activeTilePlan: booleanArg(args["active-tile-plan"], false),
    activeTileBuffer: numberArg(args["active-tile-buffer"], 1),
    outDir: manifestTileOutDirUrl({
      tileUrlBase: args["tile-url-base"] || args["tile-base-url"],
      manifestOut,
      outDir
    }),
    coverageBounds,
    coverageAreas,
    attribution: first.attribution || "NOAA MRMS · Nearcast",
    frames,
    coverage: {
      frameCount: frames.length,
      generatedTiles,
      candidateTiles,
      radarTiles,
      dataTiles
    },
    metrics: {
      generationMs: Number.isFinite(startedAt) ? Date.now() - startedAt : null,
      frameCount: frames.length,
      generatedTiles,
      candidateTiles,
      radarTiles,
      dataTiles,
      tileBudget: candidateTiles
    }
  };
}

async function latestProductObjects({ region, product, date, daysBack, maxKeys }) {
  const dates = candidateDates(date, daysBack);
  for (const candidate of dates) {
    const prefix = `${region}/${product}/${candidate}/`;
    const page = await listS3({ prefix, maxKeys });
    const objects = page.objects
      .map((object) => ({
        ...object,
        observedAt: observedTimeFromKey(object.key)?.toISOString() || object.lastModified
      }))
      .filter((object) => object.key && object.observedAt)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    if (objects.length) return objects;
  }
  throw new Error(`no MRMS objects found for ${region}/${product} across ${dates.join(", ")}`);
}

async function listS3({ prefix, maxKeys }) {
  const url = new URL(BUCKET_URL);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", String(maxKeys));
  url.searchParams.set("prefix", prefix);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  const xml = await response.text();
  return {
    objects: blocksForTag(xml, "Contents").map((block) => {
      const key = textForTag(block, "Key");
      return {
        key,
        lastModified: textForTag(block, "LastModified"),
        size: numberArg(textForTag(block, "Size"), 0),
        url: objectUrl(key)
      };
    }).filter((object) => object.key)
  };
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

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/generate-mrms-timeline.mjs --frames=6 --out-dir=radar/mrms/live
  node scripts/mrms-prototype/generate-mrms-timeline.mjs --files=/tmp/frame.grib2.gz --sample
  node scripts/mrms-prototype/generate-mrms-timeline.mjs --tile-bounds=37,-92,40,-88 --skip-empty-tiles

Options:
  --files=PATHS              Comma-separated local GRIB2 files.
  --urls=URLS                Comma-separated MRMS object URLs.
  --frames=6                 Number of latest S3 frames to generate when files/urls are omitted.
  --region=CONUS             MRMS region prefix.
  --product=NAME             MRMS product. Defaults to MergedReflectivityQCComposite_00.50.
  --out-dir=radar/mrms/live  Output tile root. Each frame gets its own child folder.
  --tile-url-base=URL        Public URL root for tile templates.
  --manifest-out=PATH        Combined manifest path.
  --tile-zooms=6,...,14      Source zooms to generate.
  --tile-radius=2            Tile radius around focus when tile-bounds is omitted.
  --tile-bounds=minLat,minLon,maxLat,maxLon
                              Generate a bounded coverage area.
  --lat=38.7237              Fixed focus latitude when tile-bounds is omitted.
  --lon=-89.9559             Fixed focus longitude when tile-bounds is omitted.
  --coverage-id=metro-east   Optional id for explicit coverage metadata.
  --coverage-label=NAME      Optional label for explicit coverage metadata.
  --skip-empty-tiles         Do not write transparent no-radar tiles.
  --active-tile-plan         Plan higher zoom tiles from active lower zoom radar tiles.
  --active-tile-buffer=1     Target-zoom tile buffer around active parents.
  --encoded-tiles            Also publish compact data tiles for client-side colorization.
  --resolve-only             Resolve candidate source objects and fingerprint without rendering tiles.
  --tile-version=mrms1       Optional cache-buster query string for tile URLs.
  --ttl-minutes=15           Manifest freshness window for live generated data.
  --sample                   Mark output as a non-live sample; the app will allow stale samples.
`);
}

function buildSourcePlan({ sources, region, product }) {
  const objects = sources
    .map(sourceObjectForManifest)
    .sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)) || String(a.key || a.value).localeCompare(String(b.key || b.value)));
  return {
    provider: "noaa-mrms-pds",
    product,
    region,
    frameCount: objects.length,
    objects,
    signature: hashJson({ product, region, objects })
  };
}

function sourceObjectForManifest(source) {
  return {
    kind: source.kind,
    value: source.kind === "file" ? path.resolve(source.value) : source.value,
    key: source.key || (source.kind === "url" ? keyFromSourceUrl(source.value) : path.basename(source.value)),
    observedAt: source.observedAt,
    timestamp: source.timestamp,
    size: Number.isFinite(Number(source.size)) ? Number(source.size) : null,
    lastModified: source.lastModified || null
  };
}

function buildRenderConfig({ region, product, frameLimit }) {
  return {
    region,
    product,
    frameLimit,
    style: args.style || "banded",
    focus: args.focus || (args.lat || args.lon ? "point" : "max"),
    center: args.lat || args.lon
      ? {
          lat: Number.isFinite(Number(args.lat)) ? Number(args.lat) : null,
          lon: Number.isFinite(Number(args.lon)) ? Number(args.lon) : null
        }
      : null,
    focusBounds: parseBounds(args.bounds || args["focus-bounds"] || "25,-125,49,-70"),
    tileBounds: parseBounds(args["tile-bounds"] || args["coverage-bounds"]),
    coverageId: args["coverage-id"] || null,
    coverageLabel: args["coverage-label"] || null,
    tileUrlBase: cleanPublicUrl(args["tile-url-base"] || args["tile-base-url"]) || null,
    tileZooms: splitList(args["tile-zooms"] || args.zooms || DEFAULT_TILE_ZOOMS).map((item) => Number(item)).filter(Number.isFinite),
    tileRadius: numberArg(args["tile-radius"], Number(DEFAULT_TILE_RADIUS)),
    skipEmptyTiles: booleanArg(args["skip-empty-tiles"], false),
    activeTilePlan: booleanArg(args["active-tile-plan"], false),
    activeTileBuffer: numberArg(args["active-tile-buffer"], 1),
    encodedTiles: booleanArg(args["encoded-tiles"] ?? args["data-tiles"], false),
    sample: booleanArg(args.sample, false),
    ttlMinutes: numberArg(args["ttl-minutes"], DEFAULT_TTL_MINUTES)
  };
}

function statFile(file) {
  try {
    const stat = fs.statSync(file);
    return {
      size: stat.size,
      mtime: stat.mtime.toISOString()
    };
  } catch {
    return null;
  }
}

function keyFromSourceUrl(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return path.basename(String(value || ""));
  }
}

function hashJson(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")
    .slice(0, 20);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function parseTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function fallbackFrameTime(index) {
  return new Date(Date.now() - index * 5 * 60 * 1000);
}

function candidateDates(dateArg, daysBack) {
  if (dateArg && dateArg !== "today") return [dateArg];
  const start = new Date();
  const dates = [];
  for (let offset = 0; offset <= daysBack; offset += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - offset));
    dates.push(date.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return dates;
}

function objectUrl(key) {
  return `${BUCKET_URL}${String(key).split("/").map(encodeURIComponent).join("/")}`;
}

function observedTimeFromKey(key) {
  const match = String(key || "").match(/_(\d{8})-(\d{6})\.grib2(?:\.gz)?$/);
  if (!match) return null;
  const [, ymd, hms] = match;
  return new Date(Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
    Number(hms.slice(0, 2)),
    Number(hms.slice(2, 4)),
    Number(hms.slice(4, 6))
  ));
}

function frameIdForIso(value) {
  const date = parseTime(value) || new Date();
  return date.toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "z");
}

function buildTileVersion() {
  return `mrms-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

function cleanTileSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || frameIdForIso(new Date().toISOString());
}

function manifestRelativeTileUrl(manifestOut, tileOut) {
  const manifestDir = path.dirname(manifestOut || DEFAULT_MANIFEST_OUT);
  const relative = path.relative(manifestDir, tileOut || ".");
  const cleanRelative = relative ? relative.split(path.sep).join("/") : ".";
  return cleanRelative.startsWith(".") ? cleanRelative : `./${cleanRelative}`;
}

function frameTileUrl({ tileUrlBase, frameId, manifestOut, tileOut }) {
  if (tileUrlBase) return joinPublicUrl(tileUrlBase, frameId);
  return manifestRelativeTileUrl(manifestOut, tileOut);
}

function manifestTileOutDirUrl({ tileUrlBase, manifestOut, outDir }) {
  if (tileUrlBase) return cleanPublicUrl(tileUrlBase);
  return manifestRelativeTileUrl(manifestOut, outDir);
}

function joinPublicUrl(base, ...parts) {
  const cleanBase = cleanPublicUrl(base);
  const cleanParts = parts
    .map((part) => String(part || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return [cleanBase, ...cleanParts].filter(Boolean).join("/");
}

function cleanPublicUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function generatedExpiresAt(options = {}, fromIso = new Date().toISOString()) {
  const explicit = options["expires-at"] || options.expiresAt;
  if (explicit) {
    const parsed = new Date(explicit);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  const ttlMinutes = numberArg(options["ttl-minutes"], DEFAULT_TTL_MINUTES);
  if (Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
    return new Date(Date.parse(fromIso) + ttlMinutes * 60 * 1000).toISOString();
  }
  return null;
}

function parseBounds(value) {
  if (!value) return null;
  const parts = String(value).split(",").map((item) => Number(item.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new Error("bounds expect minLat,minLon,maxLat,maxLon");
  }
  const [aLat, aLon, bLat, bLon] = parts;
  return {
    minLat: Math.min(aLat, bLat),
    minLon: Math.min(aLon, bLon),
    maxLat: Math.max(aLat, bLat),
    maxLon: Math.max(aLon, bLon)
  };
}

function combinedCoverageAreas(manifests, explicitCoverageBounds) {
  if (explicitCoverageBounds) {
    return [{
      id: cleanTileSegment(args["coverage-id"] || "generated-coverage"),
      label: args["coverage-label"] || "Generated coverage",
      bounds: explicitCoverageBounds
    }];
  }

  return manifests.flatMap((manifest, index) => {
    const areas = Array.isArray(manifest.coverageAreas) ? manifest.coverageAreas : [];
    if (areas.length) {
      return areas
        .map((area, areaIndex) => ({
          id: cleanTileSegment(area.id || `coverage-${index}-${areaIndex}`),
          label: area.label || `Generated coverage ${index + 1}`,
          bounds: parseBoundsObject(area.bounds || area)
        }))
        .filter((area) => area.bounds);
    }
    const bounds = parseBoundsObject(manifest.coverageBounds);
    return bounds ? [{
      id: cleanTileSegment(`coverage-${index}`),
      label: `Generated coverage ${index + 1}`,
      bounds
    }] : [];
  });
}

function parseBoundsObject(value) {
  if (!value || typeof value !== "object") return null;
  const minLat = Number(value.minLat);
  const minLon = Number(value.minLon);
  const maxLat = Number(value.maxLat);
  const maxLon = Number(value.maxLon);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  return {
    minLat: Math.min(minLat, maxLat),
    minLon: Math.min(minLon, maxLon),
    maxLat: Math.max(minLat, maxLat),
    maxLon: Math.max(minLon, maxLon)
  };
}

function unionBounds(boundsList) {
  const bounds = boundsList.filter(Boolean);
  if (!bounds.length) return null;
  return {
    minLat: Math.min(...bounds.map((item) => item.minLat)),
    minLon: Math.min(...bounds.map((item) => item.minLon)),
    maxLat: Math.max(...bounds.map((item) => item.maxLat)),
    maxLon: Math.max(...bounds.map((item) => item.maxLon))
  };
}

function minNumber(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? Math.min(...numbers) : null;
}

function maxNumber(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? Math.max(...numbers) : null;
}

function atomicWriteJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
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

function cleanSegment(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function blocksForTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  return [...String(xml || "").matchAll(regex)].map((match) => match[1]);
}

function textForTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
