import assert from "node:assert/strict";
import {
  buildRadarGenerationPlan,
  handleRadarGenerationQueue
} from "../workers/radar-generation-consumer.mjs";

const baseMessage = {
  requestId: "radar-generation-smoke",
  dedupeKey: "radar-generation:v1:auto:radar:47.50:-111.30:z10",
  requestedAt: "2026-06-29T17:30:00Z",
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
  reason: "smoke-test",
  enhancedReason: "no-fresh-index-pack"
};

const env = {
  RADAR_GENERATION_TILE_ZOOMS: "8,9,10",
  RADAR_GENERATION_MAX_CANDIDATE_TILES: "80"
};

const planned = buildRadarGenerationPlan(baseMessage, env);
assert.equal(planned.accepted, true);
assert.equal(planned.reason, "planned");
assert.equal(planned.plan.provider, "nearcast-radar-generation-plan");
assert.equal(planned.plan.source.provider, "noaa-mrms-pds");
assert.equal(planned.plan.render.encodedTiles, true);
assert.equal(planned.plan.render.skipEmptyTiles, true);
assert.deepEqual(planned.plan.render.tileZooms, [8, 9, 10]);
assert.equal(planned.plan.coverage.tileBounds, "47.2,-111.8,47.8,-110.8");
assert.ok(planned.plan.coverage.candidateTiles > 0);
assert.ok(planned.plan.coverage.candidateTiles <= 80);
assert.ok(planned.plan.output.manifestKeyTemplate.includes("{sourceSignature}"));

const plannedAgain = buildRadarGenerationPlan(baseMessage, env);
assert.equal(plannedAgain.accepted, true);
assert.equal(plannedAgain.plan.output.jobKey, planned.plan.output.jobKey);
assert.equal(plannedAgain.plan.output.planKey, planned.plan.output.planKey);
assert.equal(plannedAgain.plan.output.manifestKeyTemplate, planned.plan.output.manifestKeyTemplate);

const activePointFallback = buildRadarGenerationPlan({
  ...baseMessage,
  viewport: {
    ...baseMessage.viewport,
    center: null
  }
}, env);
assert.equal(activePointFallback.accepted, true);
assert.deepEqual(activePointFallback.plan.render.focus, {
  latitude: 47.5,
  longitude: -111.3
});

const invalid = buildRadarGenerationPlan({
  requestId: "invalid",
  dedupeKey: "invalid"
}, env);
assert.equal(invalid.accepted, false);
assert.equal(invalid.reason, "invalid-generation-message");
assert.ok(invalid.errors.includes("viewport"));

const overBudget = buildRadarGenerationPlan({
  ...baseMessage,
  requestId: "over-budget",
  dedupeKey: "radar-generation:v1:auto:radar:40.00:-100.00:z10",
  viewport: {
    center: { latitude: 40, longitude: -100 },
    activePoint: { latitude: 40, longitude: -100 },
    zoom: 10,
    bounds: { minLat: 30, minLon: -115, maxLat: 50, maxLon: -80 },
    key: "40.00,-100.00,z10"
  }
}, {
  RADAR_GENERATION_TILE_ZOOMS: "10",
  RADAR_GENERATION_MAX_CANDIDATE_TILES: "8"
});
assert.equal(overBudget.accepted, false);
assert.equal(overBudget.reason, "tile-budget-exceeded");
assert.ok(overBudget.coverage.candidateTiles > overBudget.coverage.maxCandidateTiles);

const queueMessage = createQueueMessage(baseMessage);
const badQueueMessage = createQueueMessage({ requestId: "bad", dedupeKey: "bad" });
const planStore = createPlanStore();
const queueResult = await handleRadarGenerationQueue({
  messages: [queueMessage, badQueueMessage]
}, {
  ...env,
  RADAR_GENERATION_PLANS: planStore
});
assert.equal(queueResult.accepted, 1);
assert.equal(queueResult.rejected, 1);
assert.equal(queueMessage.acked, true);
assert.equal(badQueueMessage.acked, true);
assert.equal(queueMessage.retried, false);
assert.equal(planStore.records.length, 1);
assert.equal(planStore.records[0].key, planned.plan.output.planKey);
assert.equal(queueResult.results[0].stored, true);
assert.equal(queueResult.results[0].planStore, "kv");

const r2PlanStore = createR2Bucket();
const r2QueueMessage = createQueueMessage(baseMessage);
const r2QueueResult = await handleRadarGenerationQueue({
  messages: [r2QueueMessage]
}, {
  ...env,
  RADAR_GENERATION_PLANS_R2: r2PlanStore,
  RADAR_GENERATION_PLANS_R2_PREFIX: "radar/mrms/plans-smoke"
});
assert.equal(r2QueueResult.accepted, 1);
assert.equal(r2QueueResult.rejected, 0);
assert.equal(r2QueueResult.results[0].stored, true);
assert.equal(r2QueueResult.results[0].planStore, "r2");
assert.equal(
  r2QueueResult.results[0].planStorageKey,
  `radar/mrms/plans-smoke/${planned.plan.output.planKey}`
);
assert.equal(r2QueueMessage.acked, true);
assert.equal(r2PlanStore.records.length, 1);
assert.equal(r2PlanStore.records[0].key, `radar/mrms/plans-smoke/${planned.plan.output.planKey}`);
assert.equal(r2PlanStore.records[0].value.requestId, baseMessage.requestId);

console.log(JSON.stringify({
  planned: planned.plan.output.jobKey,
  candidateTiles: planned.plan.coverage.candidateTiles,
  invalid: invalid.reason,
  overBudget: overBudget.reason,
  queue: {
    accepted: queueResult.accepted,
    rejected: queueResult.rejected,
    storedPlans: planStore.records.length,
    r2StoredPlans: r2PlanStore.records.length
  }
}, null, 2));

function createQueueMessage(body) {
  return {
    body,
    acked: false,
    retried: false,
    ack() {
      this.acked = true;
    },
    retry() {
      this.retried = true;
    }
  };
}

function createPlanStore() {
  return {
    records: [],
    async put(key, value, options = {}) {
      this.records.push({
        key,
        value: JSON.parse(value),
        options
      });
    }
  };
}

function createR2Bucket() {
  return {
    records: [],
    async put(key, body, options = {}) {
      this.records.push({
        key,
        value: JSON.parse(String(body)),
        options
      });
    }
  };
}
