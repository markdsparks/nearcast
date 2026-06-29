import assert from "node:assert/strict";
import { handleRadarCapabilityRequest } from "../workers/radar-capability.mjs";

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
assert.equal(ready.body.generation.state, "not-needed");

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
  RADAR_GENERATION_QUEUE: {
    messages: [],
    async send(message) {
      this.messages.push(message);
    }
  }
};

const queued = await capability(outsidePayload, queueEnv);
assert.equal(queued.status, 200);
assert.equal(queued.body.enhanced.state, "unavailable");
assert.equal(queued.body.generation.state, "queued");
assert.equal(queueEnv.RADAR_GENERATION_QUEUE.messages.length, 1);
assert.equal(queueEnv.RADAR_GENERATION_QUEUE.messages[0].viewport.key, "35.00,-90.00,z10");

console.log(JSON.stringify({
  ready: ready.body.enhanced.state,
  unsupported: unsupported.body.generation.state,
  queued: queued.body.generation.state,
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
