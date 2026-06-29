#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRadarGenerationPlan } from "../workers/radar-generation-consumer.mjs";

const DEFAULT_PLAN_OUT = "/tmp/nearcast-radar-generation-preview-plan.json";
const DEFAULT_OUTPUT_PREFIX = "radar/mrms/on-demand-preview";
const DEFAULT_BOUNDS = "46.9,-112.4,48.2,-110.2";
const DEFAULT_TILE_ZOOMS = "8,9,10";

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Radar generation preview plan failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  const result = createRadarGenerationPreviewPlan({
    planOut: args["plan-out"],
    latitude: args.lat || args.latitude,
    longitude: args.lon || args.longitude,
    zoom: args.zoom,
    bounds: args.bounds,
    tileZooms: args["tile-zooms"],
    maxCandidateTiles: args["max-candidate-tiles"],
    outputPrefix: args["output-prefix"],
    ttlMinutes: args["ttl-minutes"],
    frames: args.frames || args["frame-limit"],
    skipEmptyTiles: args["skip-empty-tiles"],
    encodedTiles: args["encoded-tiles"],
    requestId: args["request-id"],
    requestedAt: args["requested-at"]
  });
  console.log(JSON.stringify({
    provider: result.plan.provider,
    state: result.plan.state,
    requestId: result.plan.requestId,
    dedupeKey: result.plan.dedupeKey,
    planOut: result.planOut,
    outputPrefix: result.plan.output.prefixTemplate,
    tileZooms: result.plan.render.tileZooms,
    frameLimit: result.plan.render.frameLimit,
    candidateTiles: result.plan.coverage.candidateTiles,
    maxCandidateTiles: result.plan.coverage.maxCandidateTiles,
    coverageBounds: result.plan.coverage.bounds
  }, null, 2));
}

export function createRadarGenerationPreviewPlan(options = {}) {
  const latitude = numberArg(options.latitude, 47.505);
  const longitude = numberArg(options.longitude, -111.3);
  const zoom = Math.round(numberArg(options.zoom, 10));
  const bounds = parseBounds(options.bounds || DEFAULT_BOUNDS);
  const requestedAt = options.requestedAt || new Date().toISOString();
  const requestId = cleanKeySegment(options.requestId || `radar-preview-${process.env.GITHUB_RUN_ID || Date.now()}`);
  const dedupeKey = `radar-generation-preview:v1:${latitude.toFixed(3)}:${longitude.toFixed(3)}:z${zoom}`;
  const planResult = buildRadarGenerationPlan({
    requestId,
    dedupeKey,
    requestedAt,
    viewport: {
      center: { latitude, longitude },
      activePoint: { latitude, longitude },
      zoom,
      bounds,
      key: `${latitude.toFixed(3)},${longitude.toFixed(3)},z${zoom}`
    },
    preferences: {
      radarProvider: "auto",
      mapRenderer: "gl",
      timelineKind: "radar",
      immersive: true
    },
    reason: "r2-preview-real-render"
  }, {
    RADAR_GENERATION_TILE_ZOOMS: options.tileZooms || DEFAULT_TILE_ZOOMS,
    RADAR_GENERATION_MAX_CANDIDATE_TILES: options.maxCandidateTiles || "160",
    RADAR_GENERATION_OUTPUT_PREFIX: options.outputPrefix || DEFAULT_OUTPUT_PREFIX,
    RADAR_GENERATION_TTL_MINUTES: options.ttlMinutes || "60",
    RADAR_GENERATION_FRAME_LIMIT: options.frames || "1",
    RADAR_GENERATION_SKIP_EMPTY_TILES: booleanText(options.skipEmptyTiles, "true"),
    RADAR_GENERATION_ENCODED_TILES: booleanText(options.encodedTiles, "true")
  });
  if (!planResult.accepted) {
    throw new Error(`preview plan rejected: ${planResult.reason || "unknown"}`);
  }
  const planOut = path.resolve(options.planOut || DEFAULT_PLAN_OUT);
  writeJson(planOut, planResult.plan);
  return {
    plan: planResult.plan,
    planOut
  };
}

function parseBounds(value) {
  if (value && typeof value === "object") return value;
  const parts = String(value || "").split(",").map((item) => Number(item.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    throw new Error(`invalid bounds: ${value}`);
  }
  return {
    minLat: parts[0],
    minLon: parts[1],
    maxLat: parts[2],
    maxLon: parts[3]
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanKeySegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preview";
}

function booleanText(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? "true" : "false";
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase()) ? "true" : "false";
}

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  node scripts/radar-generation-preview-plan.mjs --plan-out=/tmp/preview-plan.json

Options:
  --plan-out=PATH            Output preview render plan JSON.
  --lat=47.505               Preview center latitude.
  --lon=-111.3               Preview center longitude.
  --zoom=10                  Preview viewport zoom.
  --bounds=minLat,minLon,maxLat,maxLon
                             Preview coverage bounds. Defaults to Great Falls.
  --tile-zooms=8,9,10        Source zooms for the bounded render.
  --frames=1                 Number of MRMS frames to render.
  --ttl-minutes=60           Preview freshness window.
  --max-candidate-tiles=160  Candidate-tile safety cap.
  --output-prefix=KEY        Object prefix. Defaults to radar/mrms/on-demand-preview.
  --skip-empty-tiles=false   Write transparent no-radar tiles instead of sparse output.
`);
}
