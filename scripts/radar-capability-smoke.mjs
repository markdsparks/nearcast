import assert from "node:assert/strict";
import worker, { handleRadarCapabilityRequest } from "../workers/radar-capability.mjs";

const futureExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const index = {
  provider: "nearcast-generated-radar-index",
  packs: [
    {
      id: "great-falls",
      label: "Great Falls",
      manifestUrl: "packs/great-falls/manifest.json",
      coverageBounds: { minLat: 46.9, minLon: -112.4, maxLat: 48.2, maxLon: -110.2 },
      expiresAt: futureExpiresAt,
      minZoom: 6,
      maxZoom: 13,
      metrics: { dataTiles: 42 }
    }
  ]
};

const env = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/radar/mrms/index.json") {
        return new Response("not found", { status: 404 });
      }
      return Response.json(index);
    }
  }
};

const basePayload = {
  provider: "nearcast-radar-capability-request",
  version: 1,
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
  generation: {
    request: false,
    reason: "smoke-test"
  }
};

const ready = await capability(basePayload);
assert.equal(ready.status, 200);
assert.equal(ready.body.provider, "nearcast-radar-capabilities");
assert.equal(ready.body.enhanced.state, "ready");
assert.equal(ready.body.enhanced.kind, "encoded-radar");
assert.equal(ready.body.enhanced.indexUrl, "https://getnearcast.app/radar/mrms/index.json");
assert.equal(ready.body.generation.state, "not-needed");

const workerReady = await workerCapability(basePayload, env);
assert.equal(workerReady.status, 200);
assert.equal(workerReady.body.enhanced.state, "ready");

const partialViewport = await capability({
  ...basePayload,
  viewport: {
    ...basePayload.viewport,
    bounds: { minLat: 46.4, minLon: -112.8, maxLat: 48.6, maxLon: -109.8 },
    key: "47.50,-111.30,z10-wide"
  }
});
assert.equal(partialViewport.status, 200);
assert.equal(partialViewport.body.enhanced.state, "unavailable");

const detailCenteredPartialViewport = await capability({
  ...basePayload,
  viewport: {
    ...basePayload.viewport,
    zoom: 13,
    bounds: { minLat: 46.4, minLon: -112.8, maxLat: 48.6, maxLon: -109.8 },
    key: "47.50,-111.30,z13-wide"
  }
});
assert.equal(detailCenteredPartialViewport.status, 200);
assert.equal(detailCenteredPartialViewport.body.enhanced.state, "ready");
assert.equal(detailCenteredPartialViewport.body.enhanced.score.viewportGate.centerFocusOk, true);

const detailActivePlaceCoveredViewport = await capability({
  ...basePayload,
  viewport: {
    ...basePayload.viewport,
    center: { latitude: 47.5, longitude: -113.2 },
    activePoint: { latitude: 47.5, longitude: -111.3 },
    zoom: 13,
    bounds: { minLat: 47.2, minLon: -113.6, maxLat: 47.8, maxLon: -112.9 },
    key: "47.50,-113.20,z13-active-covered"
  }
});
assert.equal(detailActivePlaceCoveredViewport.status, 200);
assert.equal(detailActivePlaceCoveredViewport.body.enhanced.state, "ready");
assert.equal(detailActivePlaceCoveredViewport.body.enhanced.score.viewportGate.centerFocusOk, true);
assert.equal(detailActivePlaceCoveredViewport.body.enhanced.score.viewportGate.focusPointCovered, true);

const passthrough = await worker.fetch(new Request("https://getnearcast.app/index.html"), {
  ASSETS: {
    async fetch() {
      return new Response("asset passthrough", { status: 200 });
    }
  }
}, {});
assert.equal(passthrough.status, 200);
assert.equal(await passthrough.text(), "asset passthrough");

const workerPlanStore = createR2PlanBucket();
const workerQueueMessage = createQueueMessage({
  requestId: "worker-queue-smoke",
  dedupeKey: "radar-generation:v1:auto:radar:35.20:-90.20:z10",
  requestedAt: "2026-06-29T18:30:00Z",
  viewport: {
    center: { latitude: 35.2, longitude: -90.2 },
    activePoint: { latitude: 35.2, longitude: -90.2 },
    zoom: 10,
    bounds: { minLat: 35.0, minLon: -90.4, maxLat: 35.4, maxLon: -90.0 },
    key: "35.20,-90.20,z10"
  },
  preferences: {
    radarProvider: "auto",
    mapRenderer: "gl",
    timelineKind: "radar",
    immersive: false
  },
  reason: "worker-queue-smoke",
  enhancedReason: "no-fresh-index-pack"
});
const workerQueue = await worker.queue({
  messages: [workerQueueMessage]
}, {
  RADAR_GENERATION_MAX_CANDIDATE_TILES: "220",
  RADAR_GENERATION_PLANS_R2: workerPlanStore,
  RADAR_GENERATION_PLANS_R2_PREFIX: "radar/mrms/plans-smoke"
}, {});
assert.equal(workerQueue.accepted, 1);
assert.equal(workerQueueMessage.acked, true);
assert.equal(workerPlanStore.records.length, 1);
assert.ok(workerPlanStore.records[0].key.startsWith("radar/mrms/plans-smoke/"));
assert.equal(workerPlanStore.pointers.length, 1);
assert.equal(workerPlanStore.pointers[0].key, "radar/mrms/pending-plans/latest.json");
assert.equal(workerPlanStore.pointers[0].value.reason, "worker-queue-smoke");

let externalFetchCount = 0;
const externalIndexUrl = "https://radar.example.test/radar/mrms/on-demand-preview/index.json";
const externalIndex = {
  ...index,
  packs: [{
    ...index.packs[0],
    id: "external-great-falls",
    manifestUrl: "encoded-current-v1/external-great-falls/manifest.json"
  }]
};
const externalReady = await capability(basePayload, {
  RADAR_GENERATION_INDEX_URL: externalIndexUrl,
  async RADAR_GENERATION_INDEX_FETCH(request) {
    externalFetchCount += 1;
    assert.equal(request.url, externalIndexUrl);
    return Response.json(externalIndex);
  }
});
assert.equal(externalReady.status, 200);
assert.equal(externalReady.body.enhanced.state, "ready");
assert.equal(externalReady.body.enhanced.packId, "external-great-falls");
assert.equal(externalReady.body.enhanced.indexUrl, externalIndexUrl);
assert.equal(
  externalReady.body.enhanced.manifestUrl,
  "https://radar.example.test/radar/mrms/on-demand-preview/encoded-current-v1/external-great-falls/manifest.json"
);
assert.equal(externalFetchCount, 1);

let routedFetchCount = 0;
const frameIndexUrl = "https://radar.example.test/radar/mrms/frame-substrate/latest-frame-index.json";
const previewIndexUrl = "https://radar.example.test/radar/mrms/on-demand-preview/index.json";
const frameIndex = {
  ...index,
  provider: "nearcast-mrms-frame-index",
  packs: [{
    ...index.packs[0],
    id: "frame-conus",
    kind: "frame-substrate",
    label: "CONUS radar substrate",
    manifestUrl: "conus/source/encoded/manifest.json",
    coverageBounds: { minLat: 24, minLon: -125, maxLat: 50, maxLon: -66 },
    maxClientOverzoom: 2.25
  }]
};
const routedFrameReady = await capability(basePayload, {
  RADAR_FRAME_INDEX_URL: frameIndexUrl,
  RADAR_GENERATION_INDEX_URL: previewIndexUrl,
  async RADAR_GENERATION_INDEX_FETCH(request) {
    routedFetchCount += 1;
    if (request.url === frameIndexUrl) return Response.json(frameIndex);
    return Response.json(externalIndex);
  }
});
assert.equal(routedFrameReady.status, 200);
assert.equal(routedFrameReady.body.enhanced.state, "ready");
assert.equal(routedFrameReady.body.enhanced.reason, "fresh-frame-substrate");
assert.equal(routedFrameReady.body.enhanced.selectionSource, "frame-index");
assert.equal(routedFrameReady.body.enhanced.packId, "frame-conus");
assert.equal(routedFrameReady.body.enhanced.indexUrl, frameIndexUrl);
assert.equal(routedFetchCount, 1);

let deepFrameFetchCount = 0;
const deepFrameIndex = {
  ...frameIndex,
  packs: [{
    ...frameIndex.packs[0],
    maxZoom: 8,
    maxClientOverzoom: 8
  }]
};
const deepFrameReady = await capability({
  ...basePayload,
  viewport: {
    ...basePayload.viewport,
    zoom: 18,
    key: "47.50,-111.30,z18"
  }
}, {
  RADAR_FRAME_INDEX_URL: frameIndexUrl,
  RADAR_GENERATION_INDEX_URL: previewIndexUrl,
  async RADAR_GENERATION_INDEX_FETCH(request) {
    deepFrameFetchCount += 1;
    if (request.url === frameIndexUrl) return Response.json(deepFrameIndex);
    return Response.json(externalIndex);
  }
});
assert.equal(deepFrameReady.status, 200);
assert.equal(deepFrameReady.body.enhanced.state, "ready");
assert.equal(deepFrameReady.body.enhanced.reason, "fresh-frame-substrate");
assert.equal(deepFrameReady.body.enhanced.selectionSource, "frame-index");
assert.equal(deepFrameReady.body.enhanced.score.viewportGate.maxClientOverzoom, 10);
assert.equal(deepFrameFetchCount, 1);

const outsidePayload = {
  ...basePayload,
  viewport: {
    center: { latitude: 35, longitude: -90 },
    activePoint: { latitude: 35, longitude: -90 },
    zoom: 10,
    bounds: { minLat: 34.8, minLon: -90.2, maxLat: 35.2, maxLon: -89.8 },
    key: "35.00,-90.00,z10"
  },
  generation: {
    request: true,
    reason: "smoke-test"
  }
};

const unsupported = await capability(outsidePayload);
assert.equal(unsupported.status, 200);
assert.equal(unsupported.body.enhanced.state, "unavailable");
assert.equal(unsupported.body.generation.state, "unsupported");

const queueEnv = {
  ...env,
  RADAR_GENERATION_QUEUE: createQueue()
};

const queueOnly = await capability(outsidePayload, queueEnv);
assert.equal(queueOnly.status, 200);
assert.equal(queueOnly.body.enhanced.state, "unavailable");
assert.equal(queueOnly.body.generation.state, "unsupported");
assert.equal(queueOnly.body.generation.reason, "request-state-binding-unavailable");
assert.equal(queueEnv.RADAR_GENERATION_QUEUE.messages.length, 0);

const disabledEnv = {
  ...env,
  RADAR_GENERATION_ACCEPT_REQUESTS: "false",
  RADAR_GENERATION_QUEUE: createQueue(),
  RADAR_GENERATION_REQUESTS: createRequestStore()
};
const disabled = await capability(outsidePayload, disabledEnv);
assert.equal(disabled.status, 200);
assert.equal(disabled.body.enhanced.state, "unavailable");
assert.equal(disabled.body.generation.state, "unsupported");
assert.equal(disabled.body.generation.reason, "generation-requests-disabled");
assert.equal(disabledEnv.RADAR_GENERATION_QUEUE.messages.length, 0);

const queuedEnv = {
  ...queueEnv,
  RADAR_GENERATION_REQUESTS: createRequestStore()
};

const queued = await capability(outsidePayload, queuedEnv);
assert.equal(queued.status, 200);
assert.equal(queued.body.enhanced.state, "unavailable");
assert.equal(queued.body.generation.state, "queued");
assert.equal(queued.body.generation.mode, "standard");
assert.equal(queued.body.generation.nextPollAfterSeconds, 20);
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages.length, 1);
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages[0].viewport.key, "35.00,-90.00,z10");
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages[0].dedupeKey, queued.body.generation.dedupeKey);

const lowZoomEnv = {
  ...env,
  RADAR_GENERATION_QUEUE: createQueue(),
  RADAR_GENERATION_REQUESTS: createRequestStore()
};
const lowZoom = await capability({
  ...outsidePayload,
  viewport: {
    ...outsidePayload.viewport,
    zoom: 7,
    key: "35.00,-90.00,z7"
  }
}, lowZoomEnv);
assert.equal(lowZoom.status, 200);
assert.equal(lowZoom.body.generation.state, "limited");
assert.equal(lowZoom.body.generation.reason, "below-generation-min-zoom");
assert.equal(lowZoomEnv.RADAR_GENERATION_QUEUE.messages.length, 0);

const directPlanStore = createR2PlanBucket();
const directPlanEnv = {
  ...env,
  RADAR_GENERATION_REQUESTS: createRequestStore(),
  RADAR_GENERATION_PLANS_R2: directPlanStore,
  RADAR_GENERATION_PLANS_R2_PREFIX: "radar/mrms/plans-direct-smoke"
};
const directPlanned = await capability({
  ...outsidePayload,
  viewport: {
    center: { latitude: 36.4, longitude: -91.2 },
    activePoint: { latitude: 36.4, longitude: -91.2 },
    zoom: 10,
    bounds: { minLat: 36.2, minLon: -91.4, maxLat: 36.6, maxLon: -91.0 },
    key: "36.40,-91.20,z10"
  }
}, directPlanEnv);
assert.equal(directPlanned.status, 200);
assert.equal(directPlanned.body.generation.state, "queued");
assert.equal(directPlanned.body.generation.planStored, true);
assert.ok(directPlanned.body.generation.planKey);
assert.equal(directPlanStore.records.length, 1);
assert.equal(directPlanStore.pointers.length, 1);

const safeQueuedEnv = {
  ...env,
  RADAR_GENERATION_ACCEPT_REQUESTS: "safe",
  RADAR_GENERATION_QUEUE: createQueue(),
  RADAR_GENERATION_POLL_AFTER_SECONDS: "25",
  RADAR_GENERATION_REQUESTS: createRequestStore()
};
const safeQueued = await capability(outsidePayload, safeQueuedEnv);
assert.equal(safeQueued.status, 200);
assert.equal(safeQueued.body.generation.state, "queued");
assert.equal(safeQueued.body.generation.mode, "safe");
assert.equal(safeQueued.body.generation.nextPollAfterSeconds, 25);

const overBudgetEnv = {
  ...env,
  RADAR_GENERATION_ACCEPT_REQUESTS: "safe",
  RADAR_GENERATION_QUEUE: createQueue(),
  RADAR_GENERATION_REQUESTS: createRequestStore(),
  RADAR_GENERATION_MAX_CANDIDATE_TILES: "0"
};
const overBudgetCapability = await capability(outsidePayload, overBudgetEnv);
assert.equal(overBudgetCapability.status, 200);
assert.equal(overBudgetCapability.body.generation.state, "limited");
assert.equal(overBudgetCapability.body.generation.reason, "tile-budget-exceeded");
assert.equal(overBudgetEnv.RADAR_GENERATION_QUEUE.messages.length, 0);

const deduped = await capability(outsidePayload, queuedEnv);
assert.equal(deduped.status, 200);
assert.equal(deduped.body.enhanced.state, "unavailable");
assert.equal(deduped.body.generation.state, "deduped");
assert.equal(deduped.body.generation.requestId, queued.body.generation.requestId);
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages.length, 1);

const r2RequestStore = createR2Bucket();
const r2QueuedEnv = {
  ...env,
  RADAR_GENERATION_QUEUE: createQueue(),
  RADAR_GENERATION_REQUESTS_R2: r2RequestStore,
  RADAR_GENERATION_REQUESTS_R2_PREFIX: "radar/mrms/request-state-smoke"
};
const r2Queued = await capability(outsidePayload, r2QueuedEnv);
assert.equal(r2Queued.status, 200);
assert.equal(r2Queued.body.generation.state, "queued");
assert.equal(r2QueuedEnv.RADAR_GENERATION_QUEUE.messages.length, 1);
assert.ok([...r2RequestStore.objects.keys()].some((key) => key.startsWith("radar/mrms/request-state-smoke/")));

const r2Deduped = await capability(outsidePayload, r2QueuedEnv);
assert.equal(r2Deduped.status, 200);
assert.equal(r2Deduped.body.generation.state, "deduped");
assert.equal(r2Deduped.body.generation.requestId, r2Queued.body.generation.requestId);
assert.equal(r2QueuedEnv.RADAR_GENERATION_QUEUE.messages.length, 1);

const budgetEnv = {
  ...env,
  RADAR_GENERATION_QUEUE: createQueue(),
  RADAR_GENERATION_REQUESTS: createRequestStore(),
  RADAR_GENERATION_GLOBAL_HOURLY_LIMIT: "1"
};
const budgetQueued = await capability(outsidePayload, budgetEnv);
assert.equal(budgetQueued.status, 200);
assert.equal(budgetQueued.body.generation.state, "queued");

const secondBudgetPayload = {
  ...outsidePayload,
  viewport: {
    center: { latitude: 36, longitude: -90 },
    activePoint: { latitude: 36, longitude: -90 },
    zoom: 10,
    bounds: { minLat: 35.8, minLon: -90.2, maxLat: 36.2, maxLon: -89.8 },
    key: "36.00,-90.00,z10"
  }
};
const budgetLimited = await capability(secondBudgetPayload, budgetEnv);
assert.equal(budgetLimited.status, 200);
assert.equal(budgetLimited.body.generation.state, "limited");
assert.equal(budgetLimited.body.generation.reason, "global-budget-exhausted");
assert.equal(budgetLimited.body.generation.budget.scope, "global");
assert.equal(budgetEnv.RADAR_GENERATION_QUEUE.messages.length, 1);

console.log(JSON.stringify({
  ready: ready.body.enhanced.state,
  workerReady: workerReady.body.enhanced.state,
  partialViewport: partialViewport.body.enhanced.state,
  workerQueue: workerQueue.accepted,
  external: externalReady.body.enhanced.packId,
  frameIndex: routedFrameReady.body.enhanced.reason,
  deepFrameIndex: deepFrameReady.body.enhanced.score.viewportGate.maxClientOverzoom,
  unsupported: unsupported.body.generation.state,
  queueOnly: queueOnly.body.generation.reason,
  disabled: disabled.body.generation.reason,
  queued: queued.body.generation.state,
  lowZoom: lowZoom.body.generation.reason,
  directPlanned: directPlanned.body.generation.planStored,
  safeQueued: safeQueued.body.generation.mode,
  overBudget: overBudgetCapability.body.generation.reason,
  deduped: deduped.body.generation.state,
  r2Queued: r2Queued.body.generation.state,
  r2Deduped: r2Deduped.body.generation.state,
  limited: budgetLimited.body.generation.reason,
  requestId: queued.body.generation.requestId
}, null, 2));

async function capability(payload, capabilityEnv = env) {
  const response = await handleRadarCapabilityRequest(new Request("https://getnearcast.app/api/radar/capability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }), capabilityEnv, {});
  return {
    status: response.status,
    body: await response.json()
  };
}

async function workerCapability(payload, capabilityEnv = env) {
  const response = await worker.fetch(new Request("https://getnearcast.app/api/radar/capability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }), capabilityEnv, {});
  return {
    status: response.status,
    body: await response.json()
  };
}

function createRequestStore() {
  const store = new Map();
  return {
    async get(key, options = {}) {
      const value = store.get(key);
      if (!value) return null;
      return options?.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
}

function createR2Bucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        async json() {
          return JSON.parse(value.body);
        },
        async text() {
          return value.body;
        }
      };
    },
    async put(key, body, options = {}) {
      objects.set(key, {
        body: String(body),
        options
      });
    }
  };
}

function createR2PlanBucket() {
  return {
    records: [],
    pointers: [],
    async put(key, body, options = {}) {
      const item = {
        key,
        value: JSON.parse(String(body)),
        options
      };
      if (key.endsWith("/latest.json")) this.pointers.push(item);
      else this.records.push(item);
    }
  };
}

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

function createQueue() {
  return {
    messages: [],
    async send(message) {
      this.messages.push(message);
    }
  };
}
