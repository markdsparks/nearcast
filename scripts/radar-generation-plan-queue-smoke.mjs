#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  markerKeyForPlanKey,
  pendingPlanCandidates,
  planKeyFromObjectKey,
  selectPendingPlanFromR2,
  markPlanFromR2
} from "./radar-generation-plan-queue.mjs";

const config = {
  planStorePrefix: "radar/mrms/plans",
  planOutputPrefix: "radar/mrms/on-demand-preview",
  processedPrefix: "radar/mrms/processed-plans",
  scanLimit: 5,
  maxAgeMinutes: 30,
  now: "2026-06-29T18:00:00.000Z"
};

const newestPlanKey = "radar/mrms/on-demand-preview/encoded-current-v1/newest/plan.json";
const olderPlanKey = "radar/mrms/on-demand-preview/encoded-current-v1/older/plan.json";
const expiredPlanKey = "radar/mrms/on-demand-preview/encoded-current-v1/expired/plan.json";

assert.equal(
  planKeyFromObjectKey(`radar/mrms/plans/${newestPlanKey}`, config),
  newestPlanKey
);
assert.equal(planKeyFromObjectKey("radar/mrms/request-state/nope.json", config), "");
assert.equal(
  markerKeyForPlanKey(newestPlanKey, config),
  `radar/mrms/processed-plans/${newestPlanKey}`
);

const candidates = pendingPlanCandidates([
  {
    key: `radar/mrms/plans/${olderPlanKey}`,
    lastModified: "2026-06-29T17:45:00.000Z",
    size: 100
  },
  {
    key: `radar/mrms/plans/${newestPlanKey}`,
    lastModified: "2026-06-29T17:55:00.000Z",
    size: 100
  },
  {
    key: `radar/mrms/plans/${expiredPlanKey}`,
    lastModified: "2026-06-29T17:00:00.000Z",
    size: 100
  },
  {
    key: "radar/mrms/plans/radar/mrms/on-demand-preview/encoded-current-v1/not-a-plan/pack.json",
    lastModified: "2026-06-29T17:58:00.000Z",
    size: 100
  },
  {
    key: "radar/mrms/plans/radar/mrms/on-demand/encoded-current-v1/prod/plan.json",
    lastModified: "2026-06-29T17:59:00.000Z",
    size: 100
  }
], config);

assert.deepEqual(
  candidates.map((candidate) => candidate.planKey),
  [newestPlanKey, olderPlanKey]
);
assert.equal(candidates[0].markerKey, `radar/mrms/processed-plans/${newestPlanKey}`);

const unlimitedAge = pendingPlanCandidates([
  {
    key: `radar/mrms/plans/${expiredPlanKey}`,
    lastModified: "2026-06-29T17:00:00.000Z",
    size: 100
  }
], {
  ...config,
  maxAgeMinutes: 0
});
assert.equal(unlimitedAge.length, 1);

const fakeR2 = createFakeR2({
  objects: [
    {
      key: `radar/mrms/plans/${newestPlanKey}`,
      lastModified: "2026-06-29T17:55:00.000Z",
      size: 100
    },
    {
      key: `radar/mrms/plans/${olderPlanKey}`,
      lastModified: "2026-06-29T17:45:00.000Z",
      size: 100
    }
  ],
  processed: [markerKeyForPlanKey(newestPlanKey, config)],
  plans: {
    [`radar/mrms/plans/${newestPlanKey}`]: planFor(newestPlanKey, "newest"),
    [`radar/mrms/plans/${olderPlanKey}`]: planFor(olderPlanKey, "older")
  }
});
const selected = await selectPendingPlanFromR2({
  ...config,
  bucket: "nearcast-radar-state",
  r2Client: fakeR2,
  planOut: "/tmp/radar-generation-plan-queue-smoke-plan.json",
  selectionOut: "/tmp/radar-generation-plan-queue-smoke-selection.json"
});
assert.equal(selected.selected, true);
assert.equal(selected.planKey, olderPlanKey);
assert.equal(selected.skipped[0].reason, "already-marked");

const marked = await markPlanFromR2({
  ...config,
  bucket: "nearcast-radar-state",
  r2Client: fakeR2,
  selection: "/tmp/radar-generation-plan-queue-smoke-selection.json",
  status: "published"
});
assert.equal(marked.marked, true);
assert.equal(marked.status, "published");
assert.ok(fakeR2.puts.some((item) => item.key === markerKeyForPlanKey(olderPlanKey, config)));

console.log(JSON.stringify({
  selected: candidates[0].planKey,
  markerKey: candidates[0].markerKey,
  candidates: candidates.length,
  unlimitedAge: unlimitedAge.length,
  r2Selected: selected.planKey,
  marked: marked.markerKey
}, null, 2));

function planFor(planKey, id) {
  return {
    provider: "nearcast-radar-generation-plan",
    version: 1,
    requestId: `request-${id}`,
    dedupeKey: `dedupe-${id}`,
    plannedAt: "2026-06-29T17:45:00.000Z",
    output: {
      planKey,
      manifestKeyTemplate: planKey.replace(/plan\.json$/, "{sourceSignature}/manifest.json")
    }
  };
}

function createFakeR2({ objects, processed, plans }) {
  return {
    puts: [],
    async listObjects() {
      return objects;
    },
    async objectExists(key) {
      return processed.includes(key);
    },
    async getJson(key) {
      return plans[key];
    },
    async putJson(key, value) {
      this.puts.push({ key, value });
    }
  };
}
