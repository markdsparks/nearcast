import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRadarGenerationPlan } from "../workers/radar-generation-consumer.mjs";
import { materializePlanOutput } from "./radar-generation-renderer.mjs";
import {
  artifactObjects,
  mergeGeneratedRadarIndex,
  publishRadarGenerationArtifacts
} from "./radar-generation-publisher.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearcast-publish-smoke-"));
const artifactRoot = path.join(tempRoot, "artifacts");
const r2LocalDir = path.join(tempRoot, "r2");
const indexOut = path.join(tempRoot, "index", "radar", "mrms", "index.json");

const planResult = buildRadarGenerationPlan({
  requestId: "radar-publish-smoke",
  dedupeKey: "radar-generation:v1:auto:radar:47.50:-111.30:z10",
  requestedAt: "2026-06-29T17:50:00Z",
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
const sourceSignature = "fake-source-signature";
const materialized = materializePlanOutput(plan, {
  artifactRoot,
  sourceSignature,
  publicBaseUrl: "https://radar.example.test"
});
const pack = writeFakeArtifacts({ plan, materialized, sourceSignature });
const renderResult = {
  provider: "nearcast-radar-render-result",
  version: 1,
  state: "rendered",
  requestId: plan.requestId,
  dedupeKey: plan.dedupeKey,
  sourceSignature,
  materialized,
  pack
};

const objects = artifactObjects({ artifactRoot, materialized });
assert.deepEqual(objects.map((object) => object.key).sort(), [
  `${materialized.tilePrefix}/8/1/2.png`,
  `${materialized.tilePrefix}/data/8/1/2.png`,
  materialized.indexPackKey,
  materialized.manifestKey
].sort());

const expiredPack = {
  id: "expired-pack",
  manifestUrl: "radar/mrms/expired/manifest.json",
  expiresAt: "2026-01-01T00:00:00.000Z"
};
const currentPack = {
  id: "current-pack",
  manifestUrl: "radar/mrms/current/manifest.json",
  generatedAt: "2026-06-29T16:00:00.000Z",
  expiresAt: "2026-06-29T19:00:00.000Z",
  coverageBounds: { minLat: 40, minLon: -100, maxLat: 41, maxLon: -99 }
};
const merged = mergeGeneratedRadarIndex({
  currentIndex: {
    provider: "nearcast-generated-radar-index",
    version: 1,
    generatedAt: "2026-06-29T16:00:00.000Z",
    defaultPack: "current-pack",
    packs: [expiredPack, currentPack]
  },
  pack,
  maxPacks: 8
});
assert.equal(merged.provider, "nearcast-generated-radar-index");
assert.equal(merged.defaultPack, "current-pack");
assert.ok(merged.packs.some((item) => item.id === pack.id));
assert.ok(merged.packs.some((item) => item.id === "current-pack"));
assert.ok(!merged.packs.some((item) => item.id === "expired-pack"));

const mergedWithExpiredDefault = mergeGeneratedRadarIndex({
  currentIndex: {
    provider: "nearcast-generated-radar-index",
    version: 1,
    defaultPack: "expired-pack",
    packs: [expiredPack]
  },
  pack
});
assert.equal(mergedWithExpiredDefault.defaultPack, pack.id);

const dryRun = await publishRadarGenerationArtifacts({
  renderResult,
  currentIndex: merged,
  indexOut,
  uploadMode: "dry-run"
});
assert.equal(dryRun.upload.mode, "dry-run");
assert.equal(dryRun.upload.uploaded, 0);
assert.equal(dryRun.objectCount, 5);
assert.ok(fs.existsSync(indexOut));
assert.ok(dryRun.objects.some((object) => object.key === "radar/mrms/index.json"));

const published = await publishRadarGenerationArtifacts({
  renderResult,
  currentIndex: merged,
  indexOut,
  uploadMode: "local-r2",
  r2LocalDir,
  publicBaseUrl: "https://radar.example.test"
});
assert.equal(published.upload.mode, "local-r2");
assert.equal(published.upload.uploaded, 5);
assert.equal(published.index.packs[0].manifestUrl, `https://radar.example.test/${materialized.manifestKey}`);
assert.ok(fs.existsSync(path.join(r2LocalDir, materialized.manifestKey)));
assert.ok(fs.existsSync(path.join(r2LocalDir, materialized.indexPackKey)));
assert.ok(fs.existsSync(path.join(r2LocalDir, `${materialized.tilePrefix}/8/1/2.png`)));
assert.ok(fs.existsSync(path.join(r2LocalDir, "radar/mrms/index.json")));

const uploadedIndex = JSON.parse(fs.readFileSync(path.join(r2LocalDir, "radar/mrms/index.json"), "utf8"));
assert.ok(uploadedIndex.packs.some((item) => item.id === pack.id));

console.log(JSON.stringify({
  objectCount: published.objectCount,
  uploaded: published.upload.uploaded,
  packId: published.packId,
  indexPacks: published.index.packs.length,
  sampleKeys: published.upload.sampleKeys.slice(0, 4)
}, null, 2));

function writeFakeArtifacts({ plan, materialized, sourceSignature }) {
  const generatedAt = "2026-06-29T17:50:00.000Z";
  const expiresAt = "2026-06-29T18:05:00.000Z";
  const manifest = {
    provider: "mrms-generated",
    product: plan.source.product,
    region: plan.source.region,
    style: plan.render.style,
    mode: "bounds",
    sample: true,
    generatedAt,
    expiresAt,
    source: {
      provider: "noaa-mrms-pds",
      product: plan.source.product,
      region: plan.source.region,
      frameCount: 1,
      objects: [],
      signature: sourceSignature
    },
    minZoom: 8,
    maxZoom: 10,
    coverageBounds: plan.coverage.bounds,
    coverageAreas: [{ id: "fake-coverage", label: "Fake coverage", bounds: plan.coverage.bounds }],
    frames: [{ id: "fake-frame", time: generatedAt, timestamp: Date.parse(generatedAt) }],
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
  const pack = {
    provider: manifest.provider,
    version: 1,
    id: `on-demand-${plan.output.jobKey}-${sourceSignature}`,
    label: "Radar",
    product: manifest.product,
    region: manifest.region,
    style: manifest.style,
    manifestUrl: materialized.manifestUrl,
    manifestKey: materialized.manifestKey,
    generatedAt,
    expiresAt,
    sample: true,
    minZoom: manifest.minZoom,
    maxZoom: manifest.maxZoom,
    frameCount: 1,
    coverageBounds: manifest.coverageBounds,
    coverageAreas: manifest.coverageAreas,
    publishFingerprint: "fake-publish-fingerprint",
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
  writeJson(materialized.manifestPath, manifest);
  writeJson(materialized.indexPackPath, pack);
  writeFile(path.join(materialized.tilePath, "8", "1", "2.png"), "fake radar tile\n");
  writeFile(path.join(materialized.tilePath, "data", "8", "1", "2.png"), "fake data tile\n");
  return pack;
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
