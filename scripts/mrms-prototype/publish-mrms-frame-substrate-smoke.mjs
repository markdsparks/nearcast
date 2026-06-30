#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildFrameSubstrateIndex } from "./publish-mrms-frame-substrate.mjs";

const manifest = {
  provider: "mrms-generated",
  product: "MergedReflectivityQCComposite_00.50",
  region: "CONUS",
  style: "banded",
  generatedAt: "2026-06-30T16:00:00.000Z",
  expiresAt: "2026-06-30T16:10:00.000Z",
  minZoom: 5,
  maxZoom: 8,
  coverageBounds: { minLat: 24, minLon: -125, maxLat: 50, maxLon: -66 },
  coverageAreas: [{
    id: "conus",
    label: "CONUS radar substrate",
    bounds: { minLat: 24, minLon: -125, maxLat: 50, maxLon: -66 }
  }],
  attribution: "NOAA MRMS · Nearcast",
  source: {
    provider: "noaa-mrms-pds",
    product: "MergedReflectivityQCComposite_00.50",
    region: "CONUS",
    signature: "abc123",
    frameCount: 1
  },
  frames: [{
    id: "20260630-160000z",
    time: "2026-06-30T16:00:00.000Z",
    timestamp: 1782835200000,
    minZoom: 5,
    maxZoom: 8,
    dataUrl: "https://radar.example/radar/mrms/frame-substrate/conus/abc123/encoded-z5-6-7-8/tiles/20260630-160000z/data/{z}/{x}/{y}.png",
    dataEncoding: { type: "uint8-dbz", min: 0, max: 80, threshold: 5 }
  }],
  metrics: {
    frameCount: 1,
    generatedTiles: 12,
    candidateTiles: 120,
    radarTiles: 12,
    dataTiles: 12
  }
};

const index = buildFrameSubstrateIndex({
  manifest,
  profile: { id: "conus", label: "CONUS radar substrate", region: "CONUS" },
  sourceSignature: "abc123",
  renderProfile: "encoded-z5-6-7-8",
  manifestUrl: "https://radar.example/radar/mrms/frame-substrate/conus/abc123/encoded-z5-6-7-8/manifest.json",
  indexOut: "radar/mrms/frame-substrate/latest-frame-index.json",
  checkedAt: "2026-06-30T16:01:00.000Z",
  tileZooms: "5,6,7,8"
});

assert.equal(index.provider, "nearcast-mrms-frame-index");
assert.equal(index.version, 1);
assert.equal(index.defaultPack, "frame-conus");
assert.equal(index.packs.length, 1);
assert.equal(index.packs[0].kind, "frame-substrate");
assert.equal(index.packs[0].manifestUrl, index.manifestUrl);
assert.equal(index.packs[0].maxClientOverzoom, 8);
assert.deepEqual(index.renderProfile.tileZooms, [5, 6, 7, 8]);
assert.equal(index.frames.length, 1);
assert.equal(index.metrics.dataTiles, 12);

console.log(JSON.stringify({
  ok: true,
  provider: index.provider,
  packId: index.defaultPack,
  maxClientOverzoom: index.packs[0].maxClientOverzoom
}, null, 2));
