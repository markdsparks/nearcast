import {
  buildRadarGenerationPlan,
  handleRadarGenerationMessage,
  handleRadarGenerationQueue
} from "./radar-generation-consumer.mjs";

const CAPABILITY_PROVIDER = "nearcast-radar-capabilities";
const CAPABILITY_REQUEST_PROVIDER = "nearcast-radar-capability-request";
const CAPABILITY_ENDPOINT_PATH = "/api/radar/capability";
const PLAN_WATCH_PROVIDER = "nearcast-plan-watch-notifications";
const PLAN_WATCH_CONFIG_ENDPOINT_PATH = "/api/watch/notifications/config";
const PLAN_WATCH_REGISTER_ENDPOINT_PATH = "/api/watch/notifications/register";
const PLAN_WATCH_UNREGISTER_ENDPOINT_PATH = "/api/watch/notifications/unregister";
const PLAN_WATCH_TEST_ENDPOINT_PATH = "/api/watch/notifications/test";
const RADAR_INDEX_PATH = "/radar/mrms/index.json";
const RADAR_GENERATION_INDEX_URL_ENV = "RADAR_GENERATION_INDEX_URL";
const RADAR_FRAME_INDEX_URL_ENV = "RADAR_FRAME_INDEX_URL";
const RADAR_GENERATION_ACCEPT_REQUESTS_ENV = "RADAR_GENERATION_ACCEPT_REQUESTS";
const RADAR_GENERATION_RUNNER_MODE_ENV = "RADAR_GENERATION_RUNNER_MODE";
const RADAR_GENERATION_POLL_AFTER_SECONDS_ENV = "RADAR_GENERATION_POLL_AFTER_SECONDS";
const RADAR_GENERATION_REQUESTS_R2_PREFIX_ENV = "RADAR_GENERATION_REQUESTS_R2_PREFIX";
const PLAN_WATCH_R2_PREFIX_ENV = "PLAN_WATCH_R2_PREFIX";
const PLAN_WATCH_VAPID_PUBLIC_KEY_ENV = "PLAN_WATCH_VAPID_PUBLIC_KEY";
const PLAN_WATCH_VAPID_PRIVATE_KEY_ENV = "PLAN_WATCH_VAPID_PRIVATE_KEY";
const PLAN_WATCH_VAPID_SUBJECT_ENV = "PLAN_WATCH_VAPID_SUBJECT";
const PLAN_WATCH_TEST_TOKEN_ENV = "PLAN_WATCH_TEST_TOKEN";
const DEFAULT_GENERATION_REQUESTS_R2_PREFIX = "radar/mrms/request-state";
const DEFAULT_PLAN_WATCH_R2_PREFIX = "plan-watch";
const DEFAULT_PLAN_WATCH_VAPID_SUBJECT = "https://getnearcast.app";
const GENERATION_DEDUPE_TTL_SECONDS = 8 * 60;
const GENERATION_BUDGET_WINDOW_SECONDS = 60 * 60;
const GENERATION_BUDGET_EXPIRATION_SECONDS = GENERATION_BUDGET_WINDOW_SECONDS + 10 * 60;
const DEFAULT_GENERATION_GLOBAL_HOURLY_LIMIT = 60;
const DEFAULT_GENERATION_VIEWPORT_HOURLY_LIMIT = 3;
const DEFAULT_GENERATION_POLL_AFTER_SECONDS = 20;
const DEFAULT_GENERATION_MIN_VIEWPORT_ZOOM = 7.5;
const RADAR_GENERATION_MIN_VIEWPORT_ZOOM_ENV = "RADAR_GENERATION_MIN_VIEWPORT_ZOOM";
const ENHANCED_VIEWPORT_COVERAGE_MIN = 0.999;
const ENHANCED_MIN_ZOOM_GRACE = 0.001;
const ENHANCED_MIN_VIEWPORT_ZOOM = 7.5;
const ENHANCED_CENTER_FOCUS_MIN_ZOOM = 9;
const FRAME_SUBSTRATE_MAX_CLIENT_ZOOM = 18;
const PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION = 40;
const PLAN_WATCH_SUBSCRIPTION_TTL_DAYS = 45;
const PLAN_WATCH_PUSH_TTL_SECONDS = 30 * 60;

export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url);
    if (url.pathname === CAPABILITY_ENDPOINT_PATH) {
      return handleRadarCapabilityRequest(request, env, ctx);
    }
    if (url.pathname === PLAN_WATCH_CONFIG_ENDPOINT_PATH) {
      return handlePlanWatchNotificationConfigRequest(request, env);
    }
    if (url.pathname === PLAN_WATCH_REGISTER_ENDPOINT_PATH) {
      return handlePlanWatchNotificationRegisterRequest(request, env);
    }
    if (url.pathname === PLAN_WATCH_UNREGISTER_ENDPOINT_PATH) {
      return handlePlanWatchNotificationUnregisterRequest(request, env);
    }
    if (url.pathname === PLAN_WATCH_TEST_ENDPOINT_PATH) {
      return handlePlanWatchNotificationTestRequest(request, env);
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
  const indexResult = await loadBestGeneratedRadarIndex(request, env, base.viewport);
  const capability = indexResult.selected
    ? capabilityWithEnhanced(base, indexResult.selected, request, indexResult)
    : capabilityUnavailable(base, indexResult);
  capability.generation = await generationState(capability, payload, env, ctx);
  return jsonResponse(capability);
}

export async function handlePlanWatchNotificationConfigRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "GET") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const publicKey = configuredPlanWatchVapidPublicKey(env);
  const privateKey = configuredPlanWatchVapidPrivateKey(env);
  const store = planWatchStore(env);
  return jsonResponse({
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    checkedAt: new Date().toISOString(),
    push: {
      state: publicKey ? "ready" : "missing-vapid-key",
      vapidPublicKey: publicKey,
      registerUrl: PLAN_WATCH_REGISTER_ENDPOINT_PATH,
      unregisterUrl: PLAN_WATCH_UNREGISTER_ENDPOINT_PATH
    },
    delivery: {
      state: publicKey && privateKey ? "ready" : publicKey ? "missing-vapid-private-key" : "missing-vapid-key",
      subject: configuredPlanWatchVapidSubject(env)
    },
    storage: {
      state: store ? "ready" : "unavailable",
      kind: store?.kind || ""
    }
  });
}

export async function handlePlanWatchNotificationRegisterRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const payload = await readJsonRequest(request);
  const subscription = normalizeWebPushSubscription(payload.subscription);
  if (!subscription) {
    return jsonResponse({ ok: false, error: "invalid-subscription" }, { status: 400 });
  }
  const store = planWatchStore(env);
  if (!store) {
    return jsonResponse({
      ok: false,
      provider: PLAN_WATCH_PROVIDER,
      state: "not-stored",
      reason: "plan-watch-store-unavailable"
    }, { status: 202 });
  }

  const subscriptionId = await planWatchSubscriptionId(subscription);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_WATCH_SUBSCRIPTION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const record = {
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    subscriptionId,
    platform: normalizePlatform(payload.platform),
    client: normalizePlanWatchClient(payload.client),
    subscription,
    plans: normalizePlanWatchPlans(payload.plans),
    registeredAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt
  };
  await store.putJson(planWatchSubscriptionStorageName(subscriptionId), record);
  return jsonResponse({
    ok: true,
    provider: PLAN_WATCH_PROVIDER,
    state: "stored",
    subscriptionId,
    planCount: record.plans.length,
    expiresAt
  });
}

export async function handlePlanWatchNotificationUnregisterRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const payload = await readJsonRequest(request);
  const subscription = normalizeWebPushSubscription(payload.subscription);
  const subscriptionId = String(payload.subscriptionId || (subscription ? await planWatchSubscriptionId(subscription) : "")).trim();
  if (!subscriptionId) {
    return jsonResponse({ ok: false, error: "missing-subscription" }, { status: 400 });
  }
  const store = planWatchStore(env);
  if (!store) {
    return jsonResponse({
      ok: false,
      provider: PLAN_WATCH_PROVIDER,
      state: "not-deleted",
      reason: "plan-watch-store-unavailable"
    }, { status: 202 });
  }
  await store.deleteJson(planWatchSubscriptionStorageName(subscriptionId));
  return jsonResponse({
    ok: true,
    provider: PLAN_WATCH_PROVIDER,
    state: "deleted",
    subscriptionId
  });
}

export async function handlePlanWatchNotificationTestRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const auth = planWatchTestAuthorization(request, env);
  if (!auth.available) {
    return jsonResponse({ ok: false, error: "test-disabled" }, { status: 404 });
  }
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const payload = await readJsonRequest(request);
  const store = planWatchStore(env);
  if (!store) {
    return jsonResponse({ ok: false, error: "plan-watch-store-unavailable" }, { status: 503 });
  }
  const record = await resolvePlanWatchSubscriptionRecord(store, payload);
  if (!record?.subscription) {
    return jsonResponse({ ok: false, error: "subscription-not-found" }, { status: 404 });
  }

  const push = await sendPlanWatchPush(record.subscription, env);
  if ((push.status === 404 || push.status === 410) && store.deleteJson) {
    await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
  }
  return jsonResponse({
    ok: push.ok,
    provider: PLAN_WATCH_PROVIDER,
    state: push.ok ? "sent" : "send-failed",
    subscriptionId: record.subscriptionId,
    endpointHost: safeUrlHost(record.subscription.endpoint),
    status: push.status,
    expired: push.status === 404 || push.status === 410,
    body: push.body
  }, {
    status: push.ok ? 200 : 502
  });
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

async function loadBestGeneratedRadarIndex(request, env = {}, viewport = {}) {
  const candidates = configuredGeneratedRadarIndexUrls(request, env);
  const results = [];
  for (const candidate of candidates) {
    const indexResult = await loadGeneratedRadarIndexCandidate(request, env, candidate);
    const selected = indexResult.index ? selectGeneratedRadarPack(indexResult.index, viewport) : null;
    const result = { ...indexResult, selected };
    results.push(result);
    if (selected) return { ...result, attempts: results };
  }
  return results[0]
    ? { ...results[0], attempts: results }
    : { reason: "index-unavailable", indexUrl: "", attempts: [] };
}

async function loadGeneratedRadarIndexCandidate(request, env = {}, candidate = {}) {
  const externalIndexUrl = candidate.indexUrl || "";
  if (externalIndexUrl && candidate.kind !== "asset") {
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

function configuredGeneratedRadarIndexUrls(request, env = {}) {
  const urls = [
    configuredRadarFrameIndexUrl(request, env),
    configuredGeneratedRadarIndexUrl(request, env)
  ].filter(Boolean);
  const seen = new Set();
  const externalCandidates = urls
    .filter((indexUrl) => {
      if (seen.has(indexUrl)) return false;
      seen.add(indexUrl);
      return true;
    })
    .map((indexUrl) => ({ kind: "external", indexUrl }));
  return [...externalCandidates, { kind: "asset" }];
}

function configuredRadarFrameIndexUrl(request, env = {}) {
  const value = typeof env?.[RADAR_FRAME_INDEX_URL_ENV] === "string"
    ? env[RADAR_FRAME_INDEX_URL_ENV].trim()
    : "";
  return value ? absoluteUrl(value, request.url) : "";
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
  if (pack?.kind === "frame-substrate" && Number(pack?.metrics?.dataTiles || pack?.metrics?.radarTiles || 0) <= 0) {
    return null;
  }
  const areas = coverageAreas(pack);
  const eligibility = enhancedViewportEligibility(pack, viewport, areas);
  if (!eligibility.usable) return null;
  const coverage = eligibility.coverage;
  const zoom = zoomScore(pack, viewport.zoom);
  const dataTiles = Number(pack?.metrics?.dataTiles || 0);
  const area = packArea(pack);
  const freshness = timestamp(pack?.expiresAt) || 0;
  return {
    value: coverage.value * 1000 + zoom * 100 + (dataTiles > 0 ? 25 : 0),
    coverage,
    zoom,
    area,
    freshness,
    viewportGate: {
      usable: eligibility.usable,
      reason: eligibility.reason,
      minZoom: eligibility.minZoom,
      maxZoom: eligibility.maxZoom,
      maxClientOverzoom: eligibility.maxClientOverzoom,
      viewportThreshold: eligibility.viewportThreshold,
      centerFocusOk: eligibility.centerFocusOk,
      focusPointCovered: eligibility.focusPointCovered,
      relevantOk: eligibility.relevantOk
    }
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
      selectionSource: pack?.kind === "frame-substrate" ? "frame-index" : "index",
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
      reason: pack?.kind === "frame-substrate" ? "fresh-frame-substrate" : "fresh-index-pack",
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
  const runnerMode = generationRunnerMode(env);
  if (!generationRequestsAccepted(env)) {
    return { state: "unsupported", requestId: null, reason: "generation-requests-disabled", mode: runnerMode };
  }
  const queue = env?.RADAR_GENERATION_QUEUE;
  const canStorePlan = generationPlanStoreAvailable(env);
  if (!canStorePlan && !queue?.send) return { state: "unsupported", requestId: null, reason: "generation-dispatch-unavailable", mode: runnerMode };
  const requestStore = generationRequestStore(env);
  if (!requestStore) {
    return { state: "unsupported", requestId: null, reason: "request-state-binding-unavailable", mode: runnerMode };
  }
  const dedupeKey = generationDedupeKey(capability, payload);
  const viewportEligibility = generationViewportEligibility(capability?.viewport, env);
  if (!viewportEligibility.accepted) {
    return {
      state: "limited",
      requestId: null,
      reason: viewportEligibility.reason,
      mode: runnerMode,
      viewport: viewportEligibility
    };
  }
  const preflight = preflightGenerationPlan(capability, payload, dedupeKey, env);
  if (preflight && !preflight.accepted) {
    return {
      state: "limited",
      requestId: null,
      reason: preflight.reason || "generation-preflight-rejected",
      mode: runnerMode,
      coverage: preflight.coverage || null
    };
  }
  const existing = await readGenerationRequest(requestStore, dedupeKey);
  if (existing && !generationRequestExpired(existing)) {
    const existingMessage = generationMessageFromRecord(existing, capability, payload, dedupeKey);
    const plan = existing.planStored ? null : await storeGenerationPlanForRequest(existingMessage, env);
    if (plan?.stored) {
      await requestStore.putJson(dedupeKey, {
        ...existing,
        planStored: true,
        planKey: plan.planKey || existing.planKey || "",
        planStorageKey: plan.planStorageKey || existing.planStorageKey || ""
      }, {
        expirationTtl: generationRequestRemainingTtl(existing)
      });
    }
    return {
      state: "deduped",
      requestId: existing.requestId || null,
      reason: "recent-generation-request",
      mode: runnerMode,
      dedupeKey,
      queuedAt: existing.queuedAt || "",
      planStored: existing.planStored ?? plan?.stored ?? null,
      planKey: existing.planKey || plan?.planKey || "",
      nextPollAfterSeconds: generationPollAfterSeconds(env)
    };
  }
  const budget = await generationBudgetState(requestStore, dedupeKey, env);
  if (!budget.accepted) {
    return {
      state: "limited",
      requestId: null,
      reason: `${budget.scope}-budget-exhausted`,
      mode: runnerMode,
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
  const plan = await storeGenerationPlanForRequest(message, env);
  if (plan?.available && !plan.accepted) {
    return {
      state: plan.retryable ? "unsupported" : "limited",
      requestId: null,
      reason: plan.reason || "generation-plan-rejected",
      mode: runnerMode,
      plan
    };
  }
  if (!plan?.stored) await queue.send(message);
  const record = {
    requestId,
    dedupeKey,
    queuedAt,
    expiresAt: new Date(Date.now() + GENERATION_DEDUPE_TTL_SECONDS * 1000).toISOString(),
    viewport: capability.viewport,
    preferences: payload.preferences || {},
    reason: payload.generation?.reason || "viewport",
    planStored: Boolean(plan?.stored),
    planKey: plan?.planKey || "",
    planStorageKey: plan?.planStorageKey || ""
  };
  await Promise.all([
    requestStore.putJson(dedupeKey, record, {
      expirationTtl: GENERATION_DEDUPE_TTL_SECONDS
    }),
    ...generationBudgetWrites(requestStore, budget, queuedAt)
  ]);
  return {
    state: "queued",
    requestId,
    reason: "queued-for-generation",
    mode: runnerMode,
    dedupeKey,
    queuedAt,
    planStored: Boolean(plan?.stored),
    planKey: plan?.planKey || "",
    nextPollAfterSeconds: generationPollAfterSeconds(env)
  };
}

function preflightGenerationPlan(capability, payload = {}, dedupeKey, env = {}) {
  try {
    return buildRadarGenerationPlan({
      requestId: "preflight",
      dedupeKey,
      requestedAt: capability?.checkedAt || new Date().toISOString(),
      viewport: capability?.viewport || {},
      preferences: payload.preferences || {},
      reason: payload.generation?.reason || "viewport",
      enhancedReason: capability?.enhanced?.reason || ""
    }, env);
  } catch (error) {
    return {
      accepted: false,
      reason: "generation-preflight-error",
      error: error?.message || String(error)
    };
  }
}

function generationPlanStoreAvailable(env = {}) {
  return Boolean(env?.RADAR_GENERATION_PLANS?.put || env?.RADAR_GENERATION_PLANS_R2?.put);
}

function generationMessageFromRecord(record = {}, capability, payload = {}, dedupeKey = "") {
  return {
    requestId: record.requestId || randomId(),
    dedupeKey: record.dedupeKey || dedupeKey,
    requestedAt: record.queuedAt || new Date().toISOString(),
    viewport: record.viewport || capability?.viewport || {},
    preferences: record.preferences || payload.preferences || {},
    reason: record.reason || payload.generation?.reason || "viewport",
    enhancedReason: capability?.enhanced?.reason || ""
  };
}

async function storeGenerationPlanForRequest(message, env = {}) {
  if (!generationPlanStoreAvailable(env)) return { available: false, stored: false };
  try {
    const result = await handleRadarGenerationMessage(message, env);
    return {
      available: true,
      accepted: Boolean(result?.accepted),
      stored: Boolean(result?.stored),
      retryable: Boolean(result?.retryable),
      reason: result?.reason || "",
      planKey: result?.plan?.output?.planKey || "",
      planStorageKey: result?.planStorageKey || "",
      pendingPointerStored: Boolean(result?.pendingPointerStored),
      coverage: result?.coverage || result?.plan?.coverage || null
    };
  } catch (error) {
    return {
      available: true,
      accepted: false,
      stored: false,
      retryable: true,
      reason: "generation-plan-store-error",
      error: error?.message || String(error)
    };
  }
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

function generationRunnerMode(env = {}) {
  if (!generationRequestsAccepted(env)) return "disabled";
  const mode = String(env?.[RADAR_GENERATION_RUNNER_MODE_ENV] || env?.[RADAR_GENERATION_ACCEPT_REQUESTS_ENV] || "")
    .trim()
    .toLowerCase();
  if (["safe", "standard", "manual"].includes(mode)) return mode;
  return "standard";
}

function generationPollAfterSeconds(env = {}) {
  const seconds = nonNegativeInteger(
    env?.[RADAR_GENERATION_POLL_AFTER_SECONDS_ENV],
    DEFAULT_GENERATION_POLL_AFTER_SECONDS
  );
  return Math.min(60, Math.max(5, seconds));
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

function configuredPlanWatchVapidPublicKey(env = {}) {
  return String(env?.[PLAN_WATCH_VAPID_PUBLIC_KEY_ENV] || "").trim();
}

function configuredPlanWatchVapidPrivateKey(env = {}) {
  const value = env?.[PLAN_WATCH_VAPID_PRIVATE_KEY_ENV];
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function configuredPlanWatchVapidSubject(env = {}) {
  const value = String(env?.[PLAN_WATCH_VAPID_SUBJECT_ENV] || "").trim();
  return value || DEFAULT_PLAN_WATCH_VAPID_SUBJECT;
}

function configuredPlanWatchTestToken(env = {}) {
  return String(env?.[PLAN_WATCH_TEST_TOKEN_ENV] || "").trim();
}

function planWatchTestAuthorization(request, env = {}) {
  const expected = configuredPlanWatchTestToken(env);
  if (!expected) return { available: false, authorized: false };
  const auth = String(request.headers.get("Authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = String(request.headers.get("X-Nearcast-Test-Token") || bearer || "").trim();
  return { available: true, authorized: token === expected };
}

function planWatchStore(env = {}) {
  const bucket = env?.PLAN_WATCH_R2 || env?.RADAR_GENERATION_REQUESTS_R2;
  if (!bucket?.put) return null;
  const prefix = cleanStoragePrefix(env?.[PLAN_WATCH_R2_PREFIX_ENV] || DEFAULT_PLAN_WATCH_R2_PREFIX);
  const storageKey = (name) => [prefix, name].filter(Boolean).join("/");
  return {
    kind: "r2",
    async getJson(name) {
      if (!bucket.get) return null;
      const object = await bucket.get(storageKey(name));
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
    async putJson(name, value) {
      return bucket.put(storageKey(name), JSON.stringify(value), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: {
          provider: value?.provider || PLAN_WATCH_PROVIDER,
          subscriptionId: value?.subscriptionId || "",
          expiresAt: value?.expiresAt || ""
        }
      });
    },
    async deleteJson(name) {
      if (bucket.delete) return bucket.delete(storageKey(name));
      return null;
    },
    async listNames(namePrefix = "", limit = 25) {
      if (!bucket.list) return [];
      const listPrefix = storageKey(namePrefix);
      const result = await bucket.list({ prefix: listPrefix, limit });
      const stripPrefix = prefix ? `${prefix}/` : "";
      return (result?.objects || [])
        .map((object) => String(object?.key || ""))
        .filter(Boolean)
        .map((key) => key.startsWith(stripPrefix) ? key.slice(stripPrefix.length) : key);
    }
  };
}

async function resolvePlanWatchSubscriptionRecord(store, payload = {}) {
  const subscriptionId = cleanText(payload?.subscriptionId, 120);
  if (subscriptionId && store.getJson) {
    const record = await store.getJson(planWatchSubscriptionStorageName(subscriptionId));
    if (record?.subscription) return record;
  }
  const subscription = normalizeWebPushSubscription(payload?.subscription);
  if (subscription && store.getJson) {
    const id = await planWatchSubscriptionId(subscription);
    const record = await store.getJson(planWatchSubscriptionStorageName(id));
    if (record?.subscription) return record;
  }
  if (!store.listNames || !store.getJson) return null;
  const names = await store.listNames("subscriptions/", 20);
  for (const name of names) {
    const record = await store.getJson(name);
    if (record?.subscription && !planWatchSubscriptionExpired(record)) return record;
  }
  return null;
}

function planWatchSubscriptionExpired(record) {
  const expiresAt = timestamp(record?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

async function sendPlanWatchPush(subscription, env = {}) {
  const publicKey = configuredPlanWatchVapidPublicKey(env);
  const privateKey = configuredPlanWatchVapidPrivateKey(env);
  if (!publicKey || !privateKey) {
    return { ok: false, status: 0, body: "missing-vapid-key" };
  }
  if (!subscription?.endpoint) {
    return { ok: false, status: 0, body: "missing-subscription-endpoint" };
  }
  const headers = await planWatchVapidHeaders(subscription.endpoint, env, publicKey, privateKey);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      ...headers,
      TTL: String(PLAN_WATCH_PUSH_TTL_SECONDS)
    }
  });
  const body = response.ok ? "" : cleanText(await response.text().catch(() => ""), 240);
  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

async function planWatchVapidHeaders(endpoint, env, publicKey, privateJwk) {
  const endpointUrl = new URL(endpoint);
  const jwt = await planWatchVapidJwt({
    audience: endpointUrl.origin,
    subject: configuredPlanWatchVapidSubject(env),
    privateJwk
  });
  return {
    Authorization: `vapid t=${jwt}, k=${publicKey}`
  };
}

async function planWatchVapidJwt({ audience, subject, privateJwk }) {
  const header = base64UrlEncodeJson({ typ: "JWT", alg: "ES256" });
  const body = base64UrlEncodeJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject
  });
  const input = `${header}.${body}`;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(input)
  );
  return `${input}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function normalizeWebPushSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const endpoint = String(value.endpoint || "").trim();
  if (!/^https:\/\/.+/i.test(endpoint)) return null;
  const keys = value.keys && typeof value.keys === "object" ? value.keys : {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  if (!p256dh || !auth) return null;
  return {
    endpoint,
    expirationTime: value.expirationTime || null,
    keys: { p256dh, auth }
  };
}

function normalizePlatform(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    kind: cleanToken(source.kind || "web-push", 32),
    userAgent: cleanText(source.userAgent, 240),
    standalone: Boolean(source.standalone),
    displayMode: cleanToken(source.displayMode || "", 32)
  };
}

function normalizePlanWatchClient(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    appVersion: cleanText(source.appVersion, 24),
    locale: cleanText(source.locale, 48),
    timezone: cleanText(source.timezone, 80),
    unit: ["fahrenheit", "celsius"].includes(source.unit) ? source.unit : ""
  };
}

function normalizePlanWatchPlans(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION)
    .map(normalizePlanWatchPlan)
    .filter(Boolean);
}

function normalizePlanWatchPlan(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanText(value.id, 96);
  const targetDate = cleanText(value.targetDate, 16);
  if (!id || !targetDate) return null;
  const place = normalizePlanWatchPlace(value.place);
  if (!place) return null;
  return {
    id,
    title: cleanText(value.title, 120),
    targetDate,
    startHour: finiteNumber(value.startHour, null),
    endHour: finiteNumber(value.endHour, null),
    place,
    lastKnown: normalizePlanWatchLastKnown(value.lastKnown)
  };
}

function normalizePlanWatchPlace(value = {}) {
  if (!value || typeof value !== "object") return null;
  const latitude = finiteNumber(value.latitude, null);
  const longitude = normalizeLongitude(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    name: cleanText(value.name, 120),
    admin1: cleanText(value.admin1, 120),
    country: cleanText(value.country, 120),
    countryCode: cleanToken(value.countryCode || value.country_code || "", 8),
    latitude,
    longitude
  };
}

function normalizePlanWatchLastKnown(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    eventKey: cleanText(source.eventKey, 240),
    signal: cleanToken(source.signal, 64),
    tone: cleanToken(source.tone, 32),
    label: cleanText(source.label, 120),
    reason: cleanText(source.reason, 240),
    body: cleanText(source.body, 240),
    checkedAt: cleanText(source.checkedAt, 40)
  };
}

function planWatchSubscriptionStorageName(subscriptionId) {
  return `subscriptions/${cleanStorageName(subscriptionId)}.json`;
}

async function planWatchSubscriptionId(subscription) {
  return `web-${await sha256Hex(subscription.endpoint)}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function cleanStorageName(value) {
  return String(value || "item")
    .replace(/[\\/]+/g, "_")
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanToken(value, maxLength) {
  return cleanText(value, maxLength).replace(/[^a-zA-Z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
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

function generationRequestRemainingTtl(record) {
  const expiresAt = timestamp(record?.expiresAt);
  if (!Number.isFinite(expiresAt)) return GENERATION_DEDUPE_TTL_SECONDS;
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function generationDedupeKey(capability, payload = {}) {
  const viewport = capability?.viewport || {};
  const center = viewport.center || viewport.activePoint || {};
  const lat = Number.isFinite(center.latitude) ? center.latitude.toFixed(2) : "na";
  const lon = Number.isFinite(center.longitude) ? center.longitude.toFixed(2) : "na";
  const zoom = Number.isFinite(viewport.zoom) ? Math.round(viewport.zoom * 2) / 2 : "na";
  const bounds = generationDedupeBounds(viewport.bounds);
  const provider = payload?.preferences?.radarProvider || "auto";
  const timeline = payload?.preferences?.timelineKind || "radar";
  return ["radar-generation", "v3", provider, timeline, lat, lon, `z${zoom}`, bounds].join(":");
}

function generationDedupeBounds(value) {
  const bounds = coverageBounds(value);
  if (!bounds) return "bna";
  return [
    bounds.minLat,
    bounds.minLon,
    bounds.maxLat,
    bounds.maxLon
  ].map((number) => Number(number).toFixed(1)).join(",");
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

function enhancedViewportEligibility(source, viewport = {}, areas = coverageAreas(source)) {
  const coverage = coverageScore(Array.isArray(areas) ? areas : [], viewport || {});
  const minZoom = finiteNumber(source?.minZoom ?? source?.minzoom, NaN);
  const maxZoom = finiteNumber(source?.maxZoom ?? source?.maxzoom, NaN);
  const zoom = finiteNumber(viewport?.zoom, NaN);
  const hasZoom = Number.isFinite(zoom);
  const centerPoint = viewport?.center || viewport?.activePoint;
  const hasViewport = Boolean(viewport?.bounds);
  const enhancedMinZoomOk = !hasZoom || zoom + ENHANCED_MIN_ZOOM_GRACE >= ENHANCED_MIN_VIEWPORT_ZOOM;
  const sourceMinZoomOk = !hasZoom || !Number.isFinite(minZoom) || zoom + ENHANCED_MIN_ZOOM_GRACE >= minZoom;
  const minZoomOk = enhancedMinZoomOk && sourceMinZoomOk;
  const maxClientOverzoom = enhancedMaxClientOverzoom(source);
  const maxZoomOk = !hasZoom || !Number.isFinite(maxZoom) || !Number.isFinite(maxClientOverzoom) ||
    zoom <= maxZoom + maxClientOverzoom + ENHANCED_MIN_ZOOM_GRACE;
  const focusPointCovered = coverage.centerCovered || coverage.activeCovered;
  const centerFocusOk = focusPointCovered && hasZoom && zoom + ENHANCED_MIN_ZOOM_GRACE >= ENHANCED_CENTER_FOCUS_MIN_ZOOM;
  const relevantOk = coverage.relevant || centerFocusOk;
  const centerOk = !centerPoint || coverage.centerCovered || centerFocusOk;
  const viewportThreshold = hasViewport ? ENHANCED_VIEWPORT_COVERAGE_MIN : null;
  const viewportOk = !hasViewport || coverage.viewportOverlap >= ENHANCED_VIEWPORT_COVERAGE_MIN || centerFocusOk;
  let reason = "usable";
  if (!relevantOk) reason = "coverage-not-relevant";
  else if (!enhancedMinZoomOk) reason = "below-enhanced-min-zoom";
  else if (!sourceMinZoomOk) reason = "below-generated-min-zoom";
  else if (!maxZoomOk) reason = "above-generated-max-zoom";
  else if (!centerOk) reason = "center-outside-coverage";
  else if (!viewportOk) reason = "viewport-not-covered";
  return {
    usable: relevantOk && minZoomOk && maxZoomOk && centerOk && viewportOk,
    reason,
    coverage,
    enhancedMinZoom: ENHANCED_MIN_VIEWPORT_ZOOM,
    minZoom: Number.isFinite(minZoom) ? minZoom : null,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : null,
    maxClientOverzoom: Number.isFinite(maxClientOverzoom) ? maxClientOverzoom : null,
    zoom: hasZoom ? zoom : null,
    viewportThreshold,
    centerFocusOk,
    focusPointCovered,
    relevantOk
  };
}

function enhancedMaxClientOverzoom(source) {
  const value = finiteNumber(source?.maxClientOverzoom ?? source?.renderProfile?.maxClientOverzoom ?? source?.substrate?.maxClientOverzoom, NaN);
  const frameSubstrateOverzoom = enhancedFrameSubstrateClientOverzoom(source);
  if (Number.isFinite(value) && value >= 0) {
    return Number.isFinite(frameSubstrateOverzoom)
      ? Math.max(value, frameSubstrateOverzoom)
      : value;
  }
  return Number.isFinite(frameSubstrateOverzoom) ? frameSubstrateOverzoom : NaN;
}

function enhancedFrameSubstrateClientOverzoom(source) {
  if (!enhancedSourceIsFrameSubstrate(source)) return NaN;
  const maxZoom = finiteNumber(source?.maxZoom ?? source?.maxzoom, NaN);
  if (!Number.isFinite(maxZoom)) return NaN;
  return Math.max(0, FRAME_SUBSTRATE_MAX_CLIENT_ZOOM - maxZoom);
}

function enhancedSourceIsFrameSubstrate(source) {
  return source?.kind === "frame-substrate" ||
    source?.substrate?.provider === "nearcast-mrms-frame-substrate" ||
    source?.substrate?.clientRendering === "encoded-radar";
}

function generationViewportEligibility(viewport = {}, env = {}) {
  const minZoom = finiteNumber(env?.[RADAR_GENERATION_MIN_VIEWPORT_ZOOM_ENV], DEFAULT_GENERATION_MIN_VIEWPORT_ZOOM);
  const zoom = finiteNumber(viewport?.zoom, NaN);
  if (Number.isFinite(zoom) && Number.isFinite(minZoom) && zoom + ENHANCED_MIN_ZOOM_GRACE < minZoom) {
    return {
      accepted: false,
      reason: "below-generation-min-zoom",
      zoom,
      minZoom
    };
  }
  return {
    accepted: true,
    reason: "viewport-ok",
    zoom: Number.isFinite(zoom) ? zoom : null,
    minZoom: Number.isFinite(minZoom) ? minZoom : null
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
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Nearcast-Test-Token");
  return new Response(options.status === 204 ? null : JSON.stringify(body, null, 2), {
    status: options.status || 200,
    headers
  });
}
