#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRadarGenerationPlan } from "../workers/radar-generation-consumer.mjs";
import { materializePlanOutput } from "./radar-generation-renderer.mjs";

const DEFAULT_ARTIFACT_ROOT = "/tmp/nearcast-radar-generation-preview";
const DEFAULT_OUTPUT_PREFIX = "radar/mrms/on-demand-preview";
const DEFAULT_BOUNDS = "46.9,-112.4,48.2,-110.2";
const DEFAULT_TILE_ZOOMS = "8,9,10";
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Radar generation preview fixture failed: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  const result = createRadarGenerationPreviewFixture({
    artifactRoot: args["artifact-root"],
    resultOut: args["result-out"],
    publicBaseUrl: args["public-base-url"],
    sourceSignature: args["source-signature"],
    latitude: args.lat || args.latitude,
    longitude: args.lon || args.longitude,
    zoom: args.zoom,
    bounds: args.bounds,
    tileZooms: args["tile-zooms"],
    maxCandidateTiles: args["max-candidate-tiles"],
    outputPrefix: args["output-prefix"],
    ttlMinutes: args["ttl-minutes"]
  });
  console.log(JSON.stringify({
    provider: result.provider,
    state: result.state,
    requestId: result.requestId,
    sourceSignature: result.sourceSignature,
    manifestKey: result.materialized.manifestKey,
    indexPackKey: result.materialized.indexPackKey,
    tilePrefix: result.materialized.tilePrefix,
    resultOut: result.resultOut,
    objectTiles: result.pack.metrics.generatedTiles,
    candidateTiles: result.pack.metrics.candidateTiles
  }, null, 2));
}

export function createRadarGenerationPreviewFixture(options = {}) {
  const latitude = numberArg(options.latitude, 47.505);
  const longitude = numberArg(options.longitude, -111.3);
  const zoom = Math.round(numberArg(options.zoom, 10));
  const bounds = parseBounds(options.bounds || DEFAULT_BOUNDS);
  const sourceSignature = cleanKeySegment(
    options.sourceSignature || `preview-${process.env.GITHUB_RUN_ID || Date.now()}`
  );
  const requestedAt = new Date().toISOString();
  const requestId = `radar-preview-${sourceSignature}`;
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
    reason: "r2-preview-fixture"
  }, {
    RADAR_GENERATION_TILE_ZOOMS: options.tileZooms || DEFAULT_TILE_ZOOMS,
    RADAR_GENERATION_MAX_CANDIDATE_TILES: options.maxCandidateTiles || "160",
    RADAR_GENERATION_OUTPUT_PREFIX: options.outputPrefix || DEFAULT_OUTPUT_PREFIX,
    RADAR_GENERATION_TTL_MINUTES: options.ttlMinutes || "15"
  });
  if (!planResult.accepted) {
    throw new Error(`preview plan rejected: ${planResult.reason || "unknown"}`);
  }

  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  const materialized = materializePlanOutput(planResult.plan, {
    artifactRoot,
    sourceSignature,
    publicBaseUrl: options.publicBaseUrl || ""
  });
  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(generatedAt) + planResult.plan.render.ttlMinutes * 60 * 1000).toISOString();
  const tiles = previewTiles(planResult.plan);
  const manifest = previewManifest({
    plan: planResult.plan,
    materialized,
    sourceSignature,
    generatedAt,
    expiresAt,
    tiles
  });
  const pack = previewPack({
    plan: planResult.plan,
    manifest,
    materialized,
    sourceSignature
  });

  writeJson(materialized.manifestPath, manifest);
  writeJson(materialized.indexPackPath, pack);
  tiles.forEach((tile) => {
    writeFile(path.join(materialized.tilePath, String(tile.z), String(tile.x), `${tile.y}.png`), TRANSPARENT_PNG);
    writeFile(path.join(materialized.tilePath, "data", String(tile.z), String(tile.x), `${tile.y}.png`), TRANSPARENT_PNG);
  });

  const result = {
    provider: "nearcast-radar-render-result",
    version: 1,
    state: "rendered",
    requestId,
    dedupeKey,
    sourceSignature,
    resolve: {
      provider: "mrms-generated",
      product: planResult.plan.source.product,
      region: planResult.plan.source.region,
      frameCount: 1,
      sourceSignature,
      publishFingerprint: `preview-${sourceSignature}`
    },
    render: {
      provider: "mrms-generated",
      product: planResult.plan.source.product,
      region: planResult.plan.source.region,
      frameCount: 1,
      generatedAt,
      expiresAt,
      sourceSignature,
      sample: true
    },
    materialized,
    pack
  };
  const resultOut = path.resolve(options.resultOut || path.join(artifactRoot, "render-result.json"));
  writeJson(resultOut, result);
  return {
    ...result,
    resultOut
  };
}

function previewManifest({ plan, materialized, sourceSignature, generatedAt, expiresAt, tiles }) {
  const minZoom = Math.min(...plan.render.tileZooms);
  const maxZoom = Math.max(...plan.render.tileZooms);
  const generatedTiles = tiles.length * 2;
  return {
    provider: "mrms-generated",
    product: plan.source.product,
    region: plan.source.region,
    style: plan.render.style,
    mode: "bounds",
    sample: true,
    generatedAt,
    expiresAt,
    source: previewSource({ plan, sourceSignature, generatedAt }),
    renderConfig: {
      region: plan.source.region,
      product: plan.source.product,
      frameLimit: 1,
      style: plan.render.style,
      focus: "point",
      center: { lat: plan.render.focus.latitude, lon: plan.render.focus.longitude },
      tileBounds: plan.coverage.tileBounds,
      tileZooms: plan.render.tileZooms,
      skipEmptyTiles: plan.render.skipEmptyTiles,
      encodedTiles: plan.render.encodedTiles,
      sample: true,
      ttlMinutes: plan.render.ttlMinutes
    },
    publishFingerprint: `preview-${sourceSignature}`,
    minZoom,
    maxZoom,
    tileSize: 256,
    skipEmptyTiles: true,
    outDir: "./tiles",
    coverageBounds: plan.coverage.bounds,
    coverageAreas: [{
      id: "preview-coverage",
      label: "Preview coverage",
      bounds: plan.coverage.bounds
    }],
    attribution: "NOAA MRMS · Nearcast preview",
    frames: [{
      id: `preview-${sourceSignature}`,
      time: generatedAt,
      timestamp: Date.parse(generatedAt),
      label: "Preview",
      url: "./tiles/{z}/{x}/{y}.png",
      dataUrl: "./tiles/data/{z}/{x}/{y}.png",
      coverageBounds: plan.coverage.bounds,
      sourceObject: previewSource({ plan, sourceSignature, generatedAt }).objects[0]
    }],
    coverage: {
      frameCount: 1,
      generatedTiles,
      candidateTiles: plan.coverage.candidateTiles,
      radarTiles: tiles.length,
      dataTiles: tiles.length
    },
    metrics: {
      generationMs: 0,
      frameCount: 1,
      generatedTiles,
      candidateTiles: plan.coverage.candidateTiles,
      radarTiles: tiles.length,
      dataTiles: tiles.length,
      tileBudget: plan.coverage.maxCandidateTiles
    },
    preview: {
      purpose: "manual-r2-upload-smoke",
      manifestKey: materialized.manifestKey,
      tilePrefix: materialized.tilePrefix
    }
  };
}

function previewPack({ plan, manifest, materialized, sourceSignature }) {
  return {
    provider: manifest.provider,
    version: 1,
    id: `on-demand-preview-${plan.output.jobKey}-${sourceSignature}`,
    label: "Radar Preview",
    product: manifest.product,
    region: manifest.region,
    style: manifest.style,
    manifestUrl: materialized.manifestUrl,
    manifestKey: materialized.manifestKey,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    sample: true,
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    frameCount: manifest.frames.length,
    coverageBounds: manifest.coverageBounds,
    coverageAreas: manifest.coverageAreas,
    publishFingerprint: manifest.publishFingerprint,
    sourceSignature,
    metrics: manifest.metrics,
    requestId: plan.requestId,
    dedupeKey: plan.dedupeKey,
    output: {
      jobKey: plan.output.jobKey,
      tilePrefix: materialized.tilePrefix,
      indexPackKey: materialized.indexPackKey
    }
  };
}

function previewSource({ plan, sourceSignature, generatedAt }) {
  return {
    provider: "noaa-mrms-pds",
    product: plan.source.product,
    region: plan.source.region,
    frameCount: 1,
    objects: [{
      kind: "preview",
      value: `preview://${sourceSignature}`,
      key: `${sourceSignature}.grib2.gz`,
      observedAt: generatedAt,
      timestamp: Date.parse(generatedAt),
      size: 0,
      lastModified: generatedAt
    }],
    signature: sourceSignature
  };
}

function previewTiles(plan) {
  return plan.coverage.perZoom.map((item) => ({
    z: item.z,
    x: item.range.minX,
    y: item.range.minY
  }));
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
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function cleanKeySegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preview";
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
  node scripts/radar-generation-preview-fixture.mjs --result-out=/tmp/render-result.json --public-base-url=https://radar.getnearcast.app

Options:
  --artifact-root=PATH       Local artifact root. Defaults to /tmp/nearcast-radar-generation-preview.
  --result-out=PATH          Render-result JSON path for the publisher.
  --public-base-url=URL      Public origin used for pack manifestUrl.
  --source-signature=VALUE   Source signature segment. Defaults to preview-<run id>.
  --lat=47.505               Preview center latitude.
  --lon=-111.3               Preview center longitude.
  --zoom=10                  Preview viewport zoom.
  --bounds=minLat,minLon,maxLat,maxLon
                             Preview coverage bounds. Defaults to Great Falls.
  --tile-zooms=8,9,10        Source zooms to represent in the fixture.
  --output-prefix=KEY        Object prefix. Defaults to radar/mrms/on-demand-preview.
`);
}
