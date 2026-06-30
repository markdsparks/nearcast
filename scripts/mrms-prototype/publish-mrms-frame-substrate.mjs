#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FRAME_INDEX_PROVIDER = "nearcast-mrms-frame-index";
const FRAME_INDEX_VERSION = 1;
const DEFAULT_PROFILE = "conus";
const DEFAULT_ARTIFACT_ROOT = "radar/mrms/frame-substrate";
const DEFAULT_INDEX_NAME = "latest-frame-index.json";
const DEFAULT_FRAMES = 1;
const DEFAULT_TTL_MINUTES = 10;
const DEFAULT_SKIP_MIN_FRESH_MINUTES = 3;
const DEFAULT_MAX_CLIENT_OVERZOOM = 10;
const DEFAULT_ACTIVE_TILE_BUFFER = 1;

const PROFILES = {
  conus: {
    id: "conus",
    label: "CONUS radar substrate",
    region: "CONUS",
    tileBounds: "24,-125,50,-66",
    focusBounds: "24,-125,50,-66",
    tileZooms: "5,6,7,8"
  }
};

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`MRMS frame substrate publish failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const profile = resolveProfile(args.profile || DEFAULT_PROFILE);
  const generator = path.join(path.dirname(new URL(import.meta.url).pathname), "generate-mrms-timeline.mjs");
  const frames = Math.max(1, Math.round(numberArg(args.frames || args.limit, DEFAULT_FRAMES)));
  const ttlMinutes = Math.max(1, Math.round(numberArg(args["ttl-minutes"], DEFAULT_TTL_MINUTES)));
  const tileZooms = args["tile-zooms"] || args.zooms || profile.tileZooms;
  const renderProfile = cleanSegment(args["render-profile"] || `encoded-z${tileZooms.replace(/,/g, "-")}`);
  const artifactRoot = args["artifact-root"] || DEFAULT_ARTIFACT_ROOT;
  const publicBaseUrl = cleanPublicUrl(args["public-base-url"] || args["tile-url-base"] || args["tile-base-url"]);
  const checkedAt = new Date().toISOString();

  const resolveArgs = baseGeneratorArgs({
    generator,
    profile,
    frames,
    tileZooms,
    ttlMinutes,
    outDir: path.join(artifactRoot, "_resolve"),
    manifestOut: path.join(artifactRoot, "_resolve", "manifest.json"),
    tileUrlBase: "",
    renderProfile
  });
  const resolveResult = runGenerator([...resolveArgs, "--resolve-only"], "frame substrate source resolve");
  const sourcePlan = parseJsonOutput(resolveResult.stdout, "frame substrate source resolve");
  const sourceSignature = cleanSegment(sourcePlan.source?.signature || sourcePlan.publishFingerprint || checkedAt);
  const frameRoot = path.join(artifactRoot, profile.id, sourceSignature, renderProfile);
  const outDir = args["out-dir"] || path.join(frameRoot, "tiles");
  const manifestOut = args["manifest-out"] || path.join(frameRoot, "manifest.json");
  const indexOut = args["index-out"] || path.join(artifactRoot, DEFAULT_INDEX_NAME);
  const manifestUrl = publicBaseUrl
    ? joinPublicUrl(publicBaseUrl, profile.id, sourceSignature, renderProfile, "manifest.json")
    : relativeUrl(indexOut, manifestOut);
  const tileUrlBase = publicBaseUrl
    ? joinPublicUrl(publicBaseUrl, profile.id, sourceSignature, renderProfile, "tiles")
    : "";
  const skipMinFreshMinutes = Math.max(0, numberArg(args["skip-min-fresh-minutes"], DEFAULT_SKIP_MIN_FRESH_MINUTES));
  const current = await loadCurrentIndex();
  const skipDecision = booleanArg(args["force-publish"], false)
    ? { skip: false, reason: "forced-publish" }
    : shouldSkipPublish({
        currentIndex: current.index,
        profile,
        sourceSignature,
        renderProfile,
        manifestUrl,
        skipMinFreshMinutes
      });

  if (skipDecision.skip) {
    const summary = {
      provider: "nearcast-mrms-frame-substrate-publish",
      version: 1,
      skipped: true,
      reason: skipDecision.reason,
      profile: profile.id,
      sourceSignature,
      renderProfile,
      currentIndexSource: current.source,
      checkedAt,
      expiresAt: current.index?.expiresAt || null,
      skipMinFreshMinutes
    };
    writeSummary(summary);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (booleanArg(args.clean, true)) cleanFrameRoot(frameRoot, artifactRoot);

  const commandArgs = baseGeneratorArgs({
    generator,
    profile,
    frames,
    tileZooms,
    ttlMinutes,
    outDir,
    manifestOut,
    tileUrlBase,
    renderProfile
  });
  runGenerator(commandArgs, "frame substrate generation");

  const manifest = JSON.parse(fs.readFileSync(manifestOut, "utf8"));
  manifest.substrate = {
    provider: "nearcast-mrms-frame-substrate",
    version: 1,
    profile: profile.id,
    profileLabel: profile.label,
    renderProfile,
    sourceSignature,
    checkedAt,
    publishCadenceSeconds: Math.max(60, Math.round(numberArg(args["publish-cadence-seconds"], 120))),
    clientRendering: "encoded-radar",
    maxClientOverzoom: maxClientOverzoom()
  };
  atomicWriteJson(manifestOut, manifest);

  const index = buildFrameSubstrateIndex({
    manifest,
    profile,
    sourcePlan,
    sourceSignature,
    renderProfile,
    manifestUrl,
    indexOut,
    checkedAt,
    tileZooms
  });
  atomicWriteJson(indexOut, index);

  const summary = {
    provider: "nearcast-mrms-frame-substrate-publish",
    version: 1,
    profile: profile.id,
    sourceSignature,
    renderProfile,
    manifestOut,
    indexOut,
    publicBaseUrl: publicBaseUrl || null,
    manifestUrl,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    skipped: false,
    reason: skipDecision.reason,
    currentIndexSource: current.source,
    frameCount: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    maxClientOverzoom: maxClientOverzoom(),
    activeTilePlan: Boolean(manifest.activeTilePlan),
    activeTileBuffer: manifest.activeTileBuffer ?? null,
    generatedTiles: manifest.coverage?.generatedTiles || 0,
    candidateTiles: manifest.coverage?.candidateTiles || 0,
    radarTiles: manifest.coverage?.radarTiles || 0,
    dataTiles: manifest.coverage?.dataTiles || 0
  };
  writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
}

export function buildFrameSubstrateIndex({
  manifest,
  profile = PROFILES.conus,
  sourcePlan = null,
  sourceSignature = "",
  renderProfile = "encoded",
  manifestUrl = "",
  indexOut = "",
  checkedAt = new Date().toISOString(),
  tileZooms = ""
} = {}) {
  if (!manifest || typeof manifest !== "object") throw new Error("missing manifest");
  const pack = frameSubstratePack({ manifest, profile, sourceSignature, renderProfile, manifestUrl, tileZooms });
  return {
    provider: FRAME_INDEX_PROVIDER,
    version: FRAME_INDEX_VERSION,
    generatedAt: manifest.generatedAt || checkedAt,
    updatedAt: checkedAt,
    expiresAt: manifest.expiresAt || "",
    product: manifest.product || sourcePlan?.product || "",
    region: manifest.region || sourcePlan?.region || profile.region || "",
    geography: {
      id: profile.id,
      label: profile.label,
      scope: profile.region || manifest.region || "",
      coverage: "MRMS radar data where valid within this substrate profile."
    },
    renderProfile: {
      id: renderProfile,
      tileZooms: splitList(tileZooms).map((value) => Number(value)).filter(Number.isFinite),
      encodedTiles: true,
      skipEmptyTiles: true,
      clientRendering: "encoded-radar",
      maxClientOverzoom: maxClientOverzoom()
    },
    source: manifest.source || sourcePlan?.source || null,
    sourceSignature: sourceSignature || manifest.source?.signature || "",
    manifestUrl,
    manifest: manifestUrl,
    indexPath: indexOut || "",
    frameCount: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    maxClientOverzoom: maxClientOverzoom(),
    coverageBounds: manifest.coverageBounds || null,
    coverageAreas: manifest.coverageAreas || [],
    attribution: manifest.attribution || "NOAA MRMS · Nearcast",
    frames: summarizeFrames(manifest.frames),
    metrics: manifest.metrics || manifest.coverage || null,
    defaultPack: pack.id,
    packs: [pack]
  };
}

function frameSubstratePack({ manifest, profile, sourceSignature, renderProfile, manifestUrl, tileZooms }) {
  return {
    id: `frame-${profile.id}`,
    label: profile.label,
    provider: manifest.provider || "mrms-generated",
    kind: "frame-substrate",
    product: manifest.product || "",
    region: manifest.region || profile.region || "",
    style: manifest.style || "",
    manifestUrl,
    generatedAt: manifest.generatedAt || "",
    expiresAt: manifest.expiresAt || "",
    sample: Boolean(manifest.sample),
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    maxClientOverzoom: maxClientOverzoom(),
    renderProfile,
    tileZooms: splitList(tileZooms).map((value) => Number(value)).filter(Number.isFinite),
    frameCount: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
    coverageBounds: manifest.coverageBounds || null,
    coverageAreas: manifest.coverageAreas || [],
    publishFingerprint: manifest.publishFingerprint || null,
    sourceSignature: sourceSignature || manifest.source?.signature || null,
    metrics: manifest.metrics || manifest.coverage || null
  };
}

function summarizeFrames(frames) {
  return (Array.isArray(frames) ? frames : []).map((frame) => ({
    id: frame?.id || "",
    time: frame?.time || frame?.validTime || "",
    timestamp: frame?.timestamp || null,
    minZoom: frame?.minZoom ?? null,
    maxZoom: frame?.maxZoom ?? null,
    coverageBounds: frame?.coverageBounds || null,
    dataEncoding: frame?.dataEncoding || null,
    sourceObject: frame?.sourceObject || null
  }));
}

function baseGeneratorArgs({ generator, profile, frames, tileZooms, ttlMinutes, outDir, manifestOut, tileUrlBase, renderProfile }) {
  const commandArgs = [
    generator,
    `--frames=${frames}`,
    `--region=${args.region || profile.region || "CONUS"}`,
    `--out-dir=${outDir}`,
    `--manifest-out=${manifestOut}`,
    `--tile-bounds=${args["tile-bounds"] || args["coverage-bounds"] || profile.tileBounds}`,
    `--focus-bounds=${args["focus-bounds"] || profile.focusBounds || profile.tileBounds}`,
    `--coverage-id=${args["coverage-id"] || profile.id}`,
    `--coverage-label=${args["coverage-label"] || profile.label}`,
    `--tile-zooms=${tileZooms}`,
    `--ttl-minutes=${ttlMinutes}`,
    `--tile-version=${args["tile-version"] || renderProfile}`,
    `--max-keys=${args["max-keys"] || 1200}`
  ];
  if (tileUrlBase) commandArgs.push(`--tile-url-base=${tileUrlBase}`);
  passThrough(commandArgs, [
    "date",
    "days-back",
    "files",
    "file",
    "urls",
    "url",
    "frame-time",
    "frame-times",
    "product",
    "style"
  ]);
  if (booleanArg(args["skip-empty-tiles"], true)) commandArgs.push("--skip-empty-tiles");
  if (booleanArg(args["encoded-tiles"] ?? args["data-tiles"], true)) commandArgs.push("--encoded-tiles");
  if (booleanArg(args["active-tile-plan"], true)) commandArgs.push("--active-tile-plan");
  commandArgs.push(`--active-tile-buffer=${Math.max(0, Math.round(numberArg(args["active-tile-buffer"], DEFAULT_ACTIVE_TILE_BUFFER)))}`);
  if (booleanArg(args.sample, false)) commandArgs.push("--sample");
  return commandArgs;
}

function runGenerator(commandArgs, label) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 96
  });
  if (result.status !== 0) {
    throw new Error([
      `${label} failed`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return result;
}

async function loadCurrentIndex() {
  const file = args["current-index-file"];
  if (file) {
    try {
      return {
        index: JSON.parse(fs.readFileSync(file, "utf8")),
        source: { kind: "file", value: file, status: "ok" }
      };
    } catch (error) {
      return {
        index: null,
        source: { kind: "file", value: file, status: "unavailable", error: error.message }
      };
    }
  }

  const url = args["current-index-url"] || process.env.MRMS_FRAME_INDEX_URL;
  if (!url) return { index: null, source: null };

  try {
    const response = await fetch(url, {
      headers: { "cache-control": "no-cache" }
    });
    if (!response.ok) {
      return {
        index: null,
        source: { kind: "url", value: url, status: response.status }
      };
    }
    return {
      index: await response.json(),
      source: { kind: "url", value: url, status: response.status }
    };
  } catch (error) {
    return {
      index: null,
      source: { kind: "url", value: url, status: "error", error: error.message }
    };
  }
}

function shouldSkipPublish({ currentIndex, profile, sourceSignature, renderProfile, manifestUrl, skipMinFreshMinutes }) {
  if (!currentIndex) return { skip: false, reason: "missing-current-frame-index" };
  if (currentIndex.provider !== FRAME_INDEX_PROVIDER) return { skip: false, reason: "current-index-provider-different" };
  if (currentIndex.version !== FRAME_INDEX_VERSION) return { skip: false, reason: "current-index-version-different" };
  if (currentIndex.geography?.id !== profile.id) return { skip: false, reason: "current-profile-different" };
  if (currentIndex.sourceSignature !== sourceSignature) return { skip: false, reason: "source-changed" };
  if (currentIndex.renderProfile?.id !== renderProfile) return { skip: false, reason: "render-profile-changed" };
  if (manifestUrl && currentIndex.manifestUrl !== manifestUrl) return { skip: false, reason: "manifest-url-changed" };
  if (!indexFreshEnough(currentIndex, skipMinFreshMinutes)) return { skip: false, reason: "frame-index-near-expiry" };
  return { skip: true, reason: "source-unchanged-and-fresh" };
}

function indexFreshEnough(index, skipMinFreshMinutes) {
  const expiresAt = Date.parse(index?.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - Date.now() >= skipMinFreshMinutes * 60 * 1000;
}

function parseJsonOutput(stdout, label) {
  const text = String(stdout || "").trim();
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) throw new Error(`${label} did not emit JSON`);
  try {
    return JSON.parse(text.slice(jsonStart));
  } catch (error) {
    throw new Error(`${label} emitted invalid JSON: ${error.message}`);
  }
}

function resolveProfile(value) {
  const key = String(value || DEFAULT_PROFILE).toLowerCase();
  const profile = PROFILES[key];
  if (!profile) throw new Error(`unknown profile "${value}". Known profiles: ${Object.keys(PROFILES).join(", ")}`);
  return profile;
}

function maxClientOverzoom() {
  return Math.max(0, numberArg(args["max-client-overzoom"], DEFAULT_MAX_CLIENT_OVERZOOM));
}

function cleanFrameRoot(frameRoot, artifactRoot) {
  const resolvedFrameRoot = path.resolve(frameRoot);
  const resolvedArtifactRoot = path.resolve(artifactRoot);
  const resolvedTmp = path.resolve("/tmp");
  const allowed = resolvedFrameRoot.startsWith(`${resolvedArtifactRoot}${path.sep}`) ||
    resolvedFrameRoot.startsWith(`${resolvedTmp}${path.sep}`);
  if (!allowed) throw new Error(`refusing to clean frame root outside artifact root: ${frameRoot}`);
  fs.rmSync(resolvedFrameRoot, { recursive: true, force: true });
  fs.mkdirSync(resolvedFrameRoot, { recursive: true });
}

function passThrough(commandArgs, names) {
  names.forEach((name) => {
    if (args[name] !== undefined) commandArgs.push(`--${name}=${args[name]}`);
  });
}

function writeSummary(summary) {
  const summaryOut = args["summary-out"];
  if (!summaryOut) return;
  fs.mkdirSync(path.dirname(summaryOut), { recursive: true });
  atomicWriteJson(summaryOut, summary);
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function relativeUrl(fromFile, toFile) {
  const relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative || path.basename(toFile)}`;
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

function cleanSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "current";
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
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

function booleanArg(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/publish-mrms-frame-substrate.mjs
  node scripts/mrms-prototype/publish-mrms-frame-substrate.mjs --profile=conus --public-base-url=https://radar.example/radar/mrms/frame-substrate

Options:
  --profile=conus             Frame substrate geography profile.
  --frames=1                  Latest MRMS frames to publish.
  --tile-zooms=5,6,7,8        Source zooms for the reusable substrate.
  --ttl-minutes=10            Freshness window.
  --artifact-root=PATH        Local artifact root. Defaults to ${DEFAULT_ARTIFACT_ROOT}.
  --public-base-url=URL       Public R2/custom-domain root for this substrate.
  --index-out=PATH            Mutable latest frame index path.
  --current-index-url=URL     Existing frame index used to skip unchanged sources.
  --skip-min-fresh-minutes=3  Do not rerender unchanged frames if this fresh.
  --force-publish             Rerender even when source/render profile match.
  --max-client-overzoom=10    Maximum zoom stretch before the app falls back.
  --active-tile-plan=false    Disable active-first higher-zoom tile planning.
  --active-tile-buffer=1      Target-zoom tile buffer around active parents.
  --skip-empty-tiles=false    Publish transparent empty tiles too.
  --encoded-tiles=false       Disable compact encoded data tiles.
`);
}
