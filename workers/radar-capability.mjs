import { handleRadarGenerationQueue } from "./radar-generation-consumer.mjs";

const CAPABILITY_PROVIDER = "nearcast-radar-capabilities";
const CAPABILITY_REQUEST_PROVIDER = "nearcast-radar-capability-request";
const CAPABILITY_ENDPOINT_PATH = "/api/radar/capability";
const RADAR_INDEX_PATH = "/radar/mrms/index.json";
const RADAR_GENERATION_INDEX_URL_ENV = "RADAR_GENERATION_INDEX_URL";
const RADAR_GENERATION_ACCEPT_REQUESTS_ENV = "RADAR_GENERATION_ACCEPT_REQUESTS";
const RADAR_GENERATION_REQUESTS_R2_PREFIX_ENV = "RADAR_GENERATION_REQUESTS_R2_PREFIX";
const DEFAULT_GENERATION_REQUESTS_R2_PREFIX = "radar/mrms/request-state";
const GENERATION_DEDUPE_TTL_SECONDS = 8 * 60;
const GENERATION_BUDGET_WINDOW_SECONDS = 60 * 60;
const GENERATION_BUDGET_EXPIRATION_SECONDS = GENERATION_BUDGET_WINDOW_SECONDS + 10 * 60;
const DEFAULT_GENERATION_GLOBAL_HOURLY_LIMIT = 60;
const DEFAULT_GENERATION_VIEWPORT_HOURLY_LIMIT = 3;

export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url);
    if (url.pathname === CAPABILITY_ENDPOINT_PATH) {
      return handleRadarCapabilityRequest(request, env, ctx);
    }
    if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
  async queue(batch, env = {}, ctx = {}) {
    return handleRadarGenerationQueue(batch, env, ctx);
  }
};

export async function handleRadarCapabilityRequest(request, env = {}, ctx = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }

  const payload = await readJsonRequest(request);
  const base = baseCapability(payload);
  const indexResult = await loadGeneratedRadarIndex(request, env);
  const selected = indexResult.index ? selectGeneratedRadarPack(indexResult.index, base.viewport) : null;
  const capability = selected
    ? capabilityWithEnhanced(base, selected, request, indexResult)
    : capabilityUnavailable(base, indexResult);
  capability.generation = await generationState(capability, payload, env, ctx);
  return jsonResponse(capability);
}

async function readJsonRequest(request) {
  try {
    const payload = await request.json();
    if (payload && typeof payload === "object") return payload;
  } catch {
    /* Fall through to a minimal request. */
  }
  return { provider: CAPABILITY_REQUEST_PROVIDER, version: 1 };
}

function baseCapability(payload = {}) {
  const viewport = normalizeViewport(payload.viewport);
  return {
    provider: CAPABILITY_PROVIDER,
    version: 1,
    checkedAt: new Date().toISOString(),
    viewport,
    immediate: {
      kind: "fallback-radar",
      label: "Radar",
      manifestUrl: null
    },
    enhanced: {
      state: "unavailable",
      kind: null,
      manifestUrl: null,
      reason: "not-resolved"
    },
    generation: {
      state: "not-requested",
      requestId: null,
      reason: "request-not-set"
    }
  };
}

async function loadGeneratedRadarIndex(request, env = {}) {
  const externalIndexUrl = configuredGeneratedRadarIndexUrl(request, env);
  if (externalIndexUrl) {
    const fetcher = generatedRadarIndexFetch(env);
    if (!fetcher) return { reason: "external-index-fetch-unavailable", indexUrl: externalIndexUrl };
    return fetchGeneratedRadarIndex(externalIndexUrl, fetcher, {
      loadedReason: "external-index-loaded",
      unavailableReason: "external-index-unavailable",
      errorReason: "external-index-error"
    });
  }

  const indexUrl = absoluteUrl(RADAR_INDEX_PATH, request.url);
  if (!env?.ASSETS?.fetch) {
    return { reason: "asset-binding-unavailable", indexUrl };
  }
  return fetchGeneratedRadarIndex(indexUrl, env.ASSETS.fetch.bind(env.ASSETS), {
    loadedReason: "index-loaded",
    unavailableReason: "index-unavailable",
    errorReason: "index-error"
  });
}

async function fetchGeneratedRadarIndex(indexUrl, fetcher, reasons) {
  try {
    const response = await fetcher(new Request(indexUrl, { method: "GET" }));
    if (!response.ok) {
      return { reason: reasons.unavailableReason, indexUrl, status: response.status };
    }
    const index = await response.json();
    return { reason: reasons.loadedReason, indexUrl, index };
  } catch (error) {
    return { reason: reasons.errorReason, indexUrl, error: error?.message || String(error) };
  }
}

function configuredGeneratedRadarIndexUrl(request, env = {}) {
  const value = typeof env?.[RADAR_GENERATION_INDEX_URL_ENV] === "string"
    ? env[RADAR_GENERATION_INDEX_URL_ENV].trim()
    : "";
  return value ? absoluteUrl(value, request.url) : "";
}

function generatedRadarIndexFetch(env = {}) {
  const configured = env?.RADAR_GENERATION_INDEX_FETCH;
  if (typeof configured === "function") return configured;
  if (configured?.fetch) return configured.fetch.bind(configured);
  if (globalThis.fetch) return globalThis.fetch.bind(globalThis);
  return null;
}

function selectGeneratedRadarPack(index, viewport) {
  const packs = generatedRadarPacks(index)
    .filter((pack) => !packExpired(pack))
    .map((pack) => ({
      pack,
      score: packScore(pack, viewport)
    }))
    .filter((item) => item.score)
    .sort(comparePackScores);
  return packs[0] || null;
}

function generatedRadarPacks(index) {
  const packs = Array.isArray(index?.packs)
    ? index.packs
    : Array.isArray(index?.manifests) ? index.manifests : [];
  return packs.filter((pack) => pack && packManifestUrl(pack));
}

function packManifestUrl(pack) {
  return pack?.manifestUrl || pack?.manifest || pack?.url || pack?.href || "";
}

function packExpired(pack) {
  const expiresAt = timestamp(pack?.expiresAt);
  return !pack?.sample && Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function packScore(pack, viewport) {
  const areas = coverageAreas(pack);
  const coverage = coverageScore(areas, viewport);
  if (!coverage.relevant) return null;
  const zoom = zoomScore(pack, viewport.zoom);
  const dataTiles = Number(pack?.metrics?.dataTiles || 0);
  const area = packArea(pack);
  const freshness = timestamp(pack?.expiresAt) || 0;
  return {
    value: coverage.value * 1000 + zoom * 100 + (dataTiles > 0 ? 25 : 0),
    coverage,
    zoom,
    area,
    freshness
  };
}

function comparePackScores(a, b) {
  const scoreDelta = b.score.value - a.score.value;
  if (Math.abs(scoreDelta) > 0.00001) return scoreDelta;
  const areaDelta = a.score.area - b.score.area;
  if (Math.abs(areaDelta) > 0.00001) return areaDelta;
  return b.score.freshness - a.score.freshness;
}

function capabilityWithEnhanced(base, selected, request, indexResult = {}) {
  const { pack, score } = selected;
  const indexUrl = indexResult.indexUrl || absoluteUrl(RADAR_INDEX_PATH, request.url);
  const manifestUrl = absoluteUrl(packManifestUrl(pack), indexUrl);
  return {
    ...base,
    enhanced: {
      state: "ready",
      kind: Number(pack?.metrics?.dataTiles || 0) > 0 ? "encoded-radar" : "generated-radar",
      label: pack?.label || "Radar",
      manifestUrl,
      indexUrl,
      selectionSource: "index",
      selectionKey: [
        manifestUrl,
        pack?.id || "",
        pack?.publishFingerprint || "",
        pack?.sourceSignature || "",
        pack?.expiresAt || ""
      ].join("|"),
      packId: pack?.id || "",
      coverageBounds: coverageBounds(pack?.coverageBounds),
      generatedAt: pack?.generatedAt || "",
      expiresAt: pack?.expiresAt || "",
      metrics: pack?.metrics || null,
      reason: "fresh-index-pack",
      score
    },
    generation: {
      state: "not-needed",
      requestId: null,
      reason: "fresh-enhanced-layer"
    }
  };
}

function capabilityUnavailable(base, indexResult = {}) {
  const packs = generatedRadarPacks(indexResult.index);
  const freshPackCount = packs.filter((pack) => !packExpired(pack)).length;
  const indexLoaded = indexResult.reason === "index-loaded" || indexResult.reason === "external-index-loaded";
  return {
    ...base,
    enhanced: {
      ...base.enhanced,
      state: "unavailable",
      reason: indexLoaded ? "no-fresh-index-pack" : indexResult.reason || "index-unavailable",
      indexUrl: indexResult.indexUrl || "",
      packCount: packs.length || null,
      freshPackCount: Number.isFinite(freshPackCount) ? freshPackCount : null,
      error: indexResult.error || "",
      status: indexResult.status || null
    }
  };
}

async function generationState(capability, payload = {}, env = {}, ctx = {}) {
  if (capability?.enhanced?.state === "ready") {
    return { state: "not-needed", requestId: null, reason: "fresh-enhanced-layer" };
  }
  if (!payload?.generation?.request) {
    return { state: "not-requested", requestId: null, reason: "request-not-set" };
  }
  if (!generationRequestsAccepted(env)) {
    return { state: "unsupported", requestId: null, reason: "generation-requests-disabled" };
  }
  const queue = env?.RADAR_GENERATION_QUEUE;
  if (!queue?.send) {
    return { state: "unsupported", requestId: null, reason: "queue-binding-unavailable" };
  }
  const requestStore = generationRequestStore(env);
  if (!requestStore) {
    return { state: "unsupported", requestId: null, reason: "request-state-binding-unavailable" };
  }
  const dedupeKey = generationDedupeKey(capability, payload);
  const existing = await readGenerationRequest(requestStore, dedupeKey);
  if (existing && !generationRequestExpired(existing)) {
    return {
      state: "deduped",
      requestId: existing.requestId || null,
      reason: "recent-generation-request",
      dedupeKey,
      queuedAt: existing.queuedAt || ""
    };
  }
  const budget = await generationBudgetState(requestStore, dedupeKey, env);
  if (!budget.accepted) {
    return {
      state: "limited",
      requestId: null,
      reason: `${budget.scope}-budget-exhausted`,
      retryAfterSeconds: budget.retryAfterSeconds,
      budget: budgetSummary(budget)
    };
  }
  const requestId = randomId();
  const queuedAt = new Date().toISOString();
  const message = {
    requestId,
    dedupeKey,
    requestedAt: queuedAt,
    viewport: capability.viewport,
    preferences: payload.preferences || {},
    reason: payload.generation?.reason || "viewport",
    enhancedReason: capability.enhanced?.reason || ""
  };
  await queue.send(message);
  const record = {
    requestId,
    dedupeKey,
    queuedAt,
    expiresAt: new Date(Date.now() + GENERATION_DEDUPE_TTL_SECONDS * 1000).toISOString(),
    viewport: capability.viewport,
    preferences: payload.preferences || {},
    reason: payload.generation?.reason || "viewport"
  };
  await Promise.all([
    requestStore.putJson(dedupeKey, record, {
      expirationTtl: GENERATION_DEDUPE_TTL_SECONDS
    }),
    ...generationBudgetWrites(requestStore, budget, queuedAt)
  ]);
  return { state: "queued", requestId, reason: "queued-for-generation", dedupeKey };
}

async function readGenerationRequest(requestStore, dedupeKey) {
  return requestStore.getJson(dedupeKey);
}

function generationRequestStore(env = {}) {
  const kv = env?.RADAR_GENERATION_REQUESTS;
  if (kv?.get && kv?.put) return kvGenerationRequestStore(kv);
  const r2 = env?.RADAR_GENERATION_REQUESTS_R2;
  if (r2?.get && r2?.put) return r2GenerationRequestStore(r2, env);
  return null;
}

function generationRequestsAccepted(env = {}) {
  if (env?.[RADAR_GENERATION_ACCEPT_REQUESTS_ENV] === undefined) return true;
  return booleanValue(env[RADAR_GENERATION_ACCEPT_REQUESTS_ENV]);
}

function kvGenerationRequestStore(namespace) {
  return {
    kind: "kv",
    async getJson(key) {
      try {
        const value = await namespace.get(key, { type: "json" });
        if (value && typeof value === "object") return value;
      } catch {
        try {
          const text = await namespace.get(key);
          if (text) return JSON.parse(text);
        } catch {
          return null;
        }
      }
      return null;
    },
    async putJson(key, value, options = {}) {
      return namespace.put(key, JSON.stringify(value), options);
    }
  };
}

function r2GenerationRequestStore(bucket, env = {}) {
  const prefix = cleanStoragePrefix(
    env?.[RADAR_GENERATION_REQUESTS_R2_PREFIX_ENV] || DEFAULT_GENERATION_REQUESTS_R2_PREFIX
  );
  return {
    kind: "r2",
    async getJson(key) {
      const object = await bucket.get(generationRequestStorageKey(prefix, key));
      if (!object) return null;
      try {
        if (typeof object.json === "function") return await object.json();
      } catch {
        /* Fall through to text parsing for R2-compatible test doubles. */
      }
      try {
        const text = typeof object.text === "function" ? await object.text() : "";
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    },
    async putJson(key, value) {
      return bucket.put(generationRequestStorageKey(prefix, key), JSON.stringify(value), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          provider: value?.provider || "nearcast-radar-generation-request",
          expiresAt: value?.expiresAt || ""
        }
      });
    }
  };
}

function generationRequestStorageKey(prefix, key) {
  const name = String(key || "request")
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "request";
  return [prefix, `${name}.json`].filter(Boolean).join("/");
}

function cleanStoragePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function generationRequestExpired(record) {
  const expiresAt = timestamp(record?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function generationDedupeKey(capability, payload = {}) {
  const viewport = capability?.viewport || {};
  const center = viewport.center || viewport.activePoint || {};
  const lat = Number.isFinite(center.latitude) ? center.latitude.toFixed(2) : "na";
  const lon = Number.isFinite(center.longitude) ? center.longitude.toFixed(2) : "na";
  const zoom = Number.isFinite(viewport.zoom) ? Math.round(viewport.zoom * 2) / 2 : "na";
  const provider = payload?.preferences?.radarProvider || "auto";
  const timeline = payload?.preferences?.timelineKind || "radar";
  return ["radar-generation", "v1", provider, timeline, lat, lon, `z${zoom}`].join(":");
}

async function generationBudgetState(requestStore, dedupeKey, env = {}) {
  const config = generationBudgetConfig(env);
  const bucket = Math.floor(Date.now() / (GENERATION_BUDGET_WINDOW_SECONDS * 1000));
  const scopes = [
    { scope: "global", limit: config.globalHourlyLimit, key: generationBudgetKey("global", "all", bucket) },
    { scope: "viewport", limit: config.viewportHourlyLimit, key: generationBudgetKey("viewport", dedupeKey, bucket) }
  ];
  const records = await Promise.all(scopes.map(async (entry) => {
    const record = await readGenerationRequest(requestStore, entry.key);
    const count = Math.max(0, Math.floor(finiteNumber(record?.count, 0)));
    return {
      ...entry,
      bucket,
      count,
      remaining: Math.max(0, entry.limit - count),
      record: record && typeof record === "object" ? record : null
    };
  }));
  const exhausted = records.find((entry) => entry.limit <= 0 || entry.count >= entry.limit);
  if (exhausted) {
    return {
      accepted: false,
      ...exhausted,
      retryAfterSeconds: budgetRetryAfterSeconds(bucket)
    };
  }
  return { accepted: true, bucket, records };
}

function generationBudgetConfig(env = {}) {
  return {
    globalHourlyLimit: nonNegativeInteger(
      env.RADAR_GENERATION_GLOBAL_HOURLY_LIMIT,
      DEFAULT_GENERATION_GLOBAL_HOURLY_LIMIT
    ),
    viewportHourlyLimit: nonNegativeInteger(
      env.RADAR_GENERATION_VIEWPORT_HOURLY_LIMIT,
      DEFAULT_GENERATION_VIEWPORT_HOURLY_LIMIT
    )
  };
}

function generationBudgetWrites(requestStore, budget, queuedAt) {
  if (!budget?.accepted) return [];
  return budget.records.map((entry) => {
    const next = {
      provider: "nearcast-radar-generation-budget",
      version: 1,
      scope: entry.scope,
      bucket: entry.bucket,
      count: entry.count + 1,
      limit: entry.limit,
      updatedAt: queuedAt,
      expiresAt: new Date((entry.bucket + 1) * GENERATION_BUDGET_WINDOW_SECONDS * 1000).toISOString()
    };
    return requestStore.putJson(entry.key, next, {
      expirationTtl: GENERATION_BUDGET_EXPIRATION_SECONDS
    });
  });
}

function generationBudgetKey(scope, value, bucket) {
  return ["radar-generation-budget", "v1", scope, value, bucket].join(":");
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return !["0", "false", "no", "off", "disabled"].includes(text);
}

function budgetRetryAfterSeconds(bucket) {
  const windowEnd = (bucket + 1) * GENERATION_BUDGET_WINDOW_SECONDS * 1000;
  return Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000));
}

function budgetSummary(budget) {
  return {
    scope: budget.scope,
    limit: budget.limit,
    remaining: budget.remaining,
    windowSeconds: GENERATION_BUDGET_WINDOW_SECONDS
  };
}

function normalizeViewport(viewport = {}) {
  return {
    center: normalizePoint(viewport.center),
    activePoint: normalizePoint(viewport.activePoint),
    zoom: finiteNumber(viewport.zoom, null),
    bounds: coverageBounds(viewport.bounds),
    key: viewport.key || ""
  };
}

function normalizePoint(value) {
  const latitude = finiteNumber(value?.latitude, null);
  const longitude = normalizeLongitude(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function coverageAreas(source) {
  const areas = Array.isArray(source?.coverageAreas)
    ? source.coverageAreas.map((area) => coverageBounds(area?.bounds || area)).filter(Boolean)
    : [];
  const bounds = coverageBounds(source?.coverageBounds);
  if (bounds && !areas.some((area) => boundsEqual(area, bounds))) areas.push(bounds);
  return areas;
}

function coverageBounds(value) {
  if (Array.isArray(value) && value.length === 4) {
    return coverageBounds({
      minLat: value[0],
      minLon: value[1],
      maxLat: value[2],
      maxLon: value[3]
    });
  }
  if (!value || typeof value !== "object") return null;
  const minLat = finiteNumber(value.minLat, NaN);
  const minLon = normalizeLongitude(value.minLon);
  const maxLat = finiteNumber(value.maxLat, NaN);
  const maxLon = normalizeLongitude(value.maxLon);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  return {
    minLat: Math.min(minLat, maxLat),
    minLon,
    maxLat: Math.max(minLat, maxLat),
    maxLon
  };
}

function coverageScore(areas, viewport) {
  if (!areas.length) {
    return { relevant: true, value: 4, centerCovered: true, activeCovered: true, viewportOverlap: 1 };
  }
  const centerPoint = viewport.center || viewport.activePoint;
  const centerCovered = centerPoint
    ? areas.some((bounds) => boundsContainPoint(bounds, centerPoint.latitude, centerPoint.longitude))
    : false;
  const activeCovered = viewport.activePoint
    ? areas.some((bounds) => boundsContainPoint(bounds, viewport.activePoint.latitude, viewport.activePoint.longitude))
    : false;
  const viewportOverlap = viewport.bounds
    ? Math.min(1, areas.reduce((sum, bounds) => sum + boundsOverlapRatio(bounds, viewport.bounds), 0))
    : 0;
  const hasViewport = Boolean(centerPoint || viewport.bounds);
  const activeRelevant = !hasViewport && activeCovered;
  const relevant = centerCovered || viewportOverlap >= 0.08 || activeRelevant;
  return {
    relevant,
    value: (centerCovered ? 3 : 0) + (activeRelevant ? 0.75 : 0) + viewportOverlap,
    centerCovered,
    activeCovered,
    viewportOverlap
  };
}

function zoomScore(pack, zoom) {
  const minZoom = finiteNumber(pack?.minZoom ?? pack?.minzoom, NaN);
  const maxZoom = finiteNumber(pack?.maxZoom ?? pack?.maxzoom, NaN);
  if (!Number.isFinite(zoom)) return 0.5;
  if (Number.isFinite(minZoom) && zoom < minZoom) return Math.max(0, 0.75 - (minZoom - zoom) * 0.12);
  if (Number.isFinite(maxZoom) && zoom > maxZoom) return Math.max(0, 1 - (zoom - maxZoom) * 0.16);
  return 1;
}

function packArea(pack) {
  const areas = coverageAreas(pack);
  return areas.length
    ? Math.min(...areas.map((bounds) => Math.abs((bounds.maxLat - bounds.minLat) * longitudeSpan(bounds))))
    : Number.MAX_SAFE_INTEGER;
}

function boundsOverlapRatio(bounds, target) {
  const targetArea = boundsArea(target);
  if (!targetArea) return 0;
  return boundsIntersectionArea(bounds, target) / targetArea;
}

function boundsIntersectionArea(a, b) {
  if (!a || !b) return 0;
  const latOverlap = Math.max(0, Math.min(a.maxLat, b.maxLat) - Math.max(a.minLat, b.minLat));
  if (!latOverlap) return 0;
  let lonOverlap = 0;
  longitudeSegments(a).forEach((segA) => {
    longitudeSegments(b).forEach((segB) => {
      lonOverlap += Math.max(0, Math.min(segA.max, segB.max) - Math.max(segA.min, segB.min));
    });
  });
  return latOverlap * lonOverlap;
}

function boundsArea(bounds) {
  if (!bounds) return 0;
  return Math.max(0, bounds.maxLat - bounds.minLat) * longitudeSpan(bounds);
}

function boundsContainPoint(bounds, latitude, longitude) {
  if (!bounds) return false;
  if (latitude < bounds.minLat || latitude > bounds.maxLat) return false;
  if (bounds.minLon <= bounds.maxLon) return longitude >= bounds.minLon && longitude <= bounds.maxLon;
  return longitude >= bounds.minLon || longitude <= bounds.maxLon;
}

function boundsEqual(a, b) {
  return a && b &&
    Math.abs(a.minLat - b.minLat) < 0.00001 &&
    Math.abs(a.minLon - b.minLon) < 0.00001 &&
    Math.abs(a.maxLat - b.maxLat) < 0.00001 &&
    Math.abs(a.maxLon - b.maxLon) < 0.00001;
}

function longitudeSpan(bounds) {
  if (!bounds) return 360;
  if (bounds.minLon <= bounds.maxLon) return bounds.maxLon - bounds.minLon;
  return 360 - bounds.minLon + bounds.maxLon;
}

function longitudeSegments(bounds) {
  if (!bounds) return [];
  if (bounds.minLon <= bounds.maxLon) return [{ min: bounds.minLon, max: bounds.maxLon }];
  return [
    { min: bounds.minLon, max: 180 },
    { min: -180, max: bounds.maxLon }
  ];
}

function normalizeLongitude(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return ((((number + 180) % 360) + 360) % 360) - 180;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function timestamp(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return String(value || "");
  }
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `radar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function jsonResponse(body, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  return new Response(options.status === 204 ? null : JSON.stringify(body, null, 2), {
    status: options.status || 200,
    headers
  });
}
