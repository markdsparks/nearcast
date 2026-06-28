#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_PROFILE = "metro-east";
const DEFAULT_FRAMES = 6;
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_TILE_ZOOMS = "6,7,8,9,10,11,12,13";
const DEFAULT_OUT_DIR = "radar/mrms/live";
const DEFAULT_MANIFEST_OUT = "radar/mrms/manifest.json";

const PROFILES = {
  "metro-east": {
    id: "metro-east",
    label: "Metro East",
    // Small enough for a scheduled static-asset publish, broad enough for
    // Maryville/Edwardsville/St. Louis test panning.
    tileBounds: "38.35,-90.65,39.25,-89.25",
    focusBounds: "35,-96,43,-84"
  },
  swaledale: {
    id: "swaledale",
    label: "Swaledale",
    tileBounds: "42.7,-93.8,43.4,-92.7",
    focusBounds: "39,-98,46,-88"
  }
};

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`MRMS live publish failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const profile = resolveProfile(args.profile || DEFAULT_PROFILE);
  const outDir = args["out-dir"] || DEFAULT_OUT_DIR;
  const manifestOut = args["manifest-out"] || DEFAULT_MANIFEST_OUT;
  const tileBounds = args["tile-bounds"] || args["coverage-bounds"] || profile.tileBounds;
  const tileVersion = args["tile-version"] || liveTileVersion(profile.id);
  const frames = Math.max(1, Math.round(numberArg(args.frames || args.limit, DEFAULT_FRAMES)));
  const ttlMinutes = Math.max(1, Math.round(numberArg(args["ttl-minutes"], DEFAULT_TTL_MINUTES)));
  const tileZooms = args["tile-zooms"] || args.zooms || DEFAULT_TILE_ZOOMS;

  if (booleanArg(args.clean, true)) cleanPublishOutDir(outDir);

  const generator = path.join(path.dirname(new URL(import.meta.url).pathname), "generate-mrms-timeline.mjs");
  const commandArgs = [
    generator,
    `--frames=${frames}`,
    `--out-dir=${outDir}`,
    `--manifest-out=${manifestOut}`,
    `--tile-bounds=${tileBounds}`,
    `--coverage-id=${args["coverage-id"] || profile.id}`,
    `--coverage-label=${args["coverage-label"] || profile.label}`,
    `--tile-zooms=${tileZooms}`,
    `--ttl-minutes=${ttlMinutes}`,
    `--tile-version=${tileVersion}`,
    `--focus-bounds=${args["focus-bounds"] || profile.focusBounds}`,
    `--max-keys=${args["max-keys"] || 1200}`
  ];

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
    "region",
    "style"
  ]);
  if (booleanArg(args["skip-empty-tiles"], false)) commandArgs.push("--skip-empty-tiles");
  if (booleanArg(args.sample, false)) commandArgs.push("--sample");

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64
  });
  if (result.status !== 0) {
    throw new Error([
      "timeline generation failed",
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }

  const manifest = JSON.parse(fs.readFileSync(manifestOut, "utf8"));
  validateLiveManifest(manifest, { profile, tileBounds, manifestOut });
  const summary = {
    profile: profile.id,
    coverage: manifest.coverageBounds,
    manifestOut,
    outDir,
    frameCount: manifest.frames.length,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    generatedTiles: manifest.coverage?.generatedTiles || 0,
    candidateTiles: manifest.coverage?.candidateTiles || 0,
    radarTiles: manifest.coverage?.radarTiles || 0,
    tileVersion
  };
  console.log(JSON.stringify(summary, null, 2));
}

function resolveProfile(name) {
  const key = String(name || DEFAULT_PROFILE).toLowerCase();
  const profile = PROFILES[key];
  if (!profile) throw new Error(`unknown profile "${name}". Known profiles: ${Object.keys(PROFILES).join(", ")}`);
  return profile;
}

function passThrough(commandArgs, names) {
  names.forEach((name) => {
    if (args[name] !== undefined) commandArgs.push(`--${name}=${args[name]}`);
  });
}

function cleanPublishOutDir(outDir) {
  const resolved = path.resolve(outDir);
  const cwd = process.cwd();
  const allowedRoots = [
    path.resolve(cwd, DEFAULT_OUT_DIR),
    path.resolve("/tmp")
  ];
  const allowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!allowed) {
    throw new Error(`refusing to clean non-live output path: ${outDir}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function validateLiveManifest(manifest, { profile, tileBounds, manifestOut }) {
  if (manifest?.provider !== "mrms-generated") throw new Error(`${manifestOut} is not a generated MRMS manifest`);
  if (!Array.isArray(manifest.frames) || !manifest.frames.length) throw new Error("generated manifest has no frames");
  if (!manifest.sample && !manifest.expiresAt) throw new Error("live generated manifest must include expiresAt");
  const expiresAt = Date.parse(manifest.expiresAt);
  if (!manifest.sample && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
    throw new Error("generated manifest expiresAt is not in the future");
  }
  const expected = parseBounds(tileBounds);
  const actual = parseBoundsObject(manifest.coverageBounds);
  if (!actual || !boundsContainBounds(actual, expected)) {
    throw new Error(`generated manifest coverage does not contain ${profile.id} bounds`);
  }
}

function boundsContainBounds(outer, inner) {
  return inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat &&
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon;
}

function parseBounds(value) {
  const parts = String(value || "").split(",").map((item) => Number(item.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new Error("bounds expect minLat,minLon,maxLat,maxLon");
  }
  return {
    minLat: Math.min(parts[0], parts[2]),
    minLon: Math.min(parts[1], parts[3]),
    maxLat: Math.max(parts[0], parts[2]),
    maxLon: Math.max(parts[1], parts[3])
  };
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

function liveTileVersion(profileId) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `mrms-${profileId}-${stamp}`;
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
  node scripts/mrms-prototype/publish-mrms-live.mjs
  node scripts/mrms-prototype/publish-mrms-live.mjs --profile=metro-east --frames=6
  node scripts/mrms-prototype/publish-mrms-live.mjs --files=/tmp/frame.grib2.gz --sample --out-dir=/tmp/mrms-live --manifest-out=/tmp/mrms-live/manifest.json

Options:
  --profile=metro-east       Coverage profile. Known: ${Object.keys(PROFILES).join(", ")}.
  --tile-bounds=a,b,c,d      Override profile coverage bounds.
  --frames=6                 Number of latest MRMS frames to publish.
  --tile-zooms=6,...,13      Generated source zooms. z14+ is expensive for regional jobs.
  --ttl-minutes=30           Live manifest freshness window.
  --out-dir=radar/mrms/live  Generated tile root.
  --manifest-out=PATH        Manifest to publish for the app.
  --skip-empty-tiles         Write only tiles with radar pixels.
  --clean=false              Keep existing output directory contents.
`);
}
