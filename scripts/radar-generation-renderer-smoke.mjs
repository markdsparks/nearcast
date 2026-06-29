import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRadarGenerationPlan } from "../workers/radar-generation-consumer.mjs";
import {
  executeRadarGenerationPlan,
  materializePlanOutput
} from "./radar-generation-renderer.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearcast-render-smoke-"));
const fakeGenerator = path.join(tempRoot, "fake-generator.mjs");
const fakeSource = path.join(tempRoot, "fake-frame.grib2.gz");
const artifactRoot = path.join(tempRoot, "artifacts");
fs.writeFileSync(fakeSource, "fake mrms source\n");
fs.writeFileSync(fakeGenerator, fakeGeneratorSource());

const planResult = buildRadarGenerationPlan({
  requestId: "radar-render-smoke",
  dedupeKey: "radar-generation:v1:auto:radar:47.50:-111.30:z10",
  requestedAt: "2026-06-29T17:40:00Z",
  viewport: {
    center: { latitude: 47.5, longitude: -111.3 },
    activePoint: { latitude: 47.5, longitude: -111.3 },
    zoom: 10,
    bounds: { minLat: 47.2, minLon: -111.8, maxLat: 47.8, maxLon: -110.8 },
    key: "47.50,-111.30,z10"
  },
  preferences: {
    radarProvider: "auto",
    mapRenderer: "gl",
    timelineKind: "radar",
    immersive: false
  },
  reason: "smoke-test"
}, {
  RADAR_GENERATION_TILE_ZOOMS: "8,9,10",
  RADAR_GENERATION_MAX_CANDIDATE_TILES: "80"
});
assert.equal(planResult.accepted, true);
const plan = planResult.plan;

const dryRun = await executeRadarGenerationPlan(plan, {
  artifactRoot,
  generatorScript: fakeGenerator,
  sourceFiles: [fakeSource],
  frameTimes: ["2026-06-29T17:35:00.000Z"],
  publicBaseUrl: "https://radar.example.test",
  sample: true,
  dryRun: true
});
assert.equal(dryRun.state, "resolved");
assert.equal(dryRun.sourceSignature, "fake-source-signature");
assert.equal(dryRun.materialized.manifestUrl, `https://radar.example.test/${dryRun.materialized.manifestKey}`);
assert.ok(!fs.existsSync(dryRun.materialized.manifestPath));

const rendered = await executeRadarGenerationPlan(plan, {
  artifactRoot,
  generatorScript: fakeGenerator,
  sourceFiles: [fakeSource],
  frameTimes: ["2026-06-29T17:35:00.000Z"],
  publicBaseUrl: "https://radar.example.test",
  sample: true
});
assert.equal(rendered.state, "rendered");
assert.equal(rendered.sourceSignature, "fake-source-signature");
assert.equal(rendered.pack.id, `on-demand-${plan.output.jobKey}-fake-source-signature`);
assert.equal(rendered.pack.manifestKey, rendered.materialized.manifestKey);
assert.equal(rendered.pack.manifestUrl, `https://radar.example.test/${rendered.materialized.manifestKey}`);
assert.equal(rendered.pack.sourceSignature, "fake-source-signature");
assert.equal(rendered.pack.sample, true);
assert.equal(rendered.pack.metrics.candidateTiles, 24);
assert.ok(fs.existsSync(rendered.materialized.manifestPath));
assert.ok(fs.existsSync(rendered.materialized.indexPackPath));
assert.ok(fs.existsSync(path.join(rendered.materialized.tilePath, "tile-placeholder.txt")));

const manifest = JSON.parse(fs.readFileSync(rendered.materialized.manifestPath, "utf8"));
const pack = JSON.parse(fs.readFileSync(rendered.materialized.indexPackPath, "utf8"));
assert.equal(manifest.source.signature, "fake-source-signature");
assert.deepEqual(manifest.coverageBounds, plan.coverage.bounds);
assert.equal(pack.manifestKey, rendered.materialized.manifestKey);

const materialized = materializePlanOutput(plan, {
  artifactRoot,
  sourceSignature: "fake-source-signature",
  publicBaseUrl: "https://radar.example.test"
});
assert.equal(materialized.manifestKey, rendered.materialized.manifestKey);
assert.equal(materialized.indexPackKey, rendered.materialized.indexPackKey);

console.log(JSON.stringify({
  state: rendered.state,
  sourceSignature: rendered.sourceSignature,
  manifestKey: rendered.materialized.manifestKey,
  indexPackKey: rendered.materialized.indexPackKey,
  candidateTiles: rendered.pack.metrics.candidateTiles
}, null, 2));

function fakeGeneratorSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const signature = "fake-source-signature";
const observedAt = splitList(args["frame-times"])[0] || "2026-06-29T17:35:00.000Z";
const sourceValue = splitList(args.files || args.file)[0] || splitList(args.urls || args.url)[0] || "https://example.test/fake.grib2.gz";
const sourceKind = args.files || args.file ? "file" : "url";
const region = args.region || "CONUS";
const product = args.product || "MergedReflectivityQCComposite_00.50";
const tileBounds = parseBounds(args["tile-bounds"]);
const tileZooms = splitList(args["tile-zooms"]).map((item) => Number(item)).filter(Number.isFinite);

if (args["resolve-only"]) {
  console.log(JSON.stringify({
    provider: "mrms-generated",
    product,
    region,
    frameCount: Number(args.frames || 1),
    source: sourcePlan(),
    renderConfig: renderConfig(),
    publishFingerprint: "fake-publish-fingerprint"
  }, null, 2));
  process.exit(0);
}

const manifestOut = args["manifest-out"];
const outDir = args["out-dir"];
if (!manifestOut || !outDir) throw new Error("missing manifest/out dir");
fs.mkdirSync(path.dirname(manifestOut), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "tile-placeholder.txt"), "fake tile\\n");

const generatedAt = "2026-06-29T17:40:00.000Z";
const manifest = {
  provider: "mrms-generated",
  product,
  region,
  style: args.style || "banded",
  mode: "bounds",
  sample: Boolean(args.sample),
  generatedAt,
  expiresAt: "2026-06-29T17:55:00.000Z",
  source: sourcePlan(),
  renderConfig: renderConfig(),
  publishFingerprint: "fake-publish-fingerprint",
  minZoom: Math.min(...tileZooms),
  maxZoom: Math.max(...tileZooms),
  tileSize: 256,
  skipEmptyTiles: Boolean(args["skip-empty-tiles"]),
  outDir,
  coverageBounds: tileBounds,
  coverageAreas: [{ id: "fake-coverage", label: "Fake coverage", bounds: tileBounds }],
  attribution: "NOAA MRMS · Nearcast",
  frames: [{
    id: "fake-frame",
    time: observedAt,
    timestamp: Date.parse(observedAt),
    url: "./fake-frame/{z}/{x}/{y}.png",
    dataUrl: "./fake-frame/data/{z}/{x}/{y}.png",
    sourceObject: sourcePlan().objects[0]
  }],
  coverage: {
    frameCount: 1,
    generatedTiles: 1,
    candidateTiles: 24,
    radarTiles: 1,
    dataTiles: 1
  },
  metrics: {
    generationMs: 12,
    frameCount: 1,
    generatedTiles: 1,
    candidateTiles: 24,
    radarTiles: 1,
    dataTiles: 1,
    tileBudget: 24
  }
};
fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + "\\n");
console.log(JSON.stringify({
  provider: manifest.provider,
  product,
  region,
  manifestOut,
  outDir,
  frameCount: 1,
  generatedAt,
  expiresAt: manifest.expiresAt,
  publishFingerprint: manifest.publishFingerprint,
  sourceSignature: signature,
  sample: manifest.sample
}, null, 2));

function sourcePlan() {
  return {
    provider: "noaa-mrms-pds",
    product,
    region,
    frameCount: 1,
    objects: [{
      kind: sourceKind,
      value: sourceValue,
      key: path.basename(sourceValue),
      observedAt,
      timestamp: Date.parse(observedAt),
      size: 123,
      lastModified: observedAt
    }],
    signature
  };
}

function renderConfig() {
  return {
    region,
    product,
    frameLimit: Number(args.frames || 1),
    style: args.style || "banded",
    focus: args.focus || "point",
    center: { lat: Number(args.lat), lon: Number(args.lon) },
    tileBounds,
    tileZooms,
    skipEmptyTiles: Boolean(args["skip-empty-tiles"]),
    encodedTiles: Boolean(args["encoded-tiles"]),
    sample: Boolean(args.sample),
    ttlMinutes: Number(args["ttl-minutes"] || 15)
  };
}

function parseBounds(value) {
  const parts = String(value || "").split(",").map((item) => Number(item.trim()));
  return { minLat: parts[0], minLon: parts[1], maxLat: parts[2], maxLon: parts[3] };
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
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
`;
}
