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
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages.length, 1);
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages[0].viewport.key, "35.00,-90.00,z10");
assert.equal(queuedEnv.RADAR_GENERATION_QUEUE.messages[0].dedupeKey, queued.body.generation.dedupeKey);

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
  workerQueue: workerQueue.accepted,
  external: externalReady.body.enhanced.packId,
  unsupported: unsupported.body.generation.state,
  queueOnly: queueOnly.body.generation.reason,
  disabled: disabled.body.generation.reason,
  queued: queued.body.generation.state,
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
