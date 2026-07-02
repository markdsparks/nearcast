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
const PLAN_WATCH_PENDING_ENDPOINT_PATH = "/api/watch/notifications/pending";
const PLAN_WATCH_EVALUATE_ENDPOINT_PATH = "/api/watch/notifications/evaluate";
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
const PLAN_WATCH_EVALUATOR_MODE_ENV = "PLAN_WATCH_EVALUATOR_MODE";
const PLAN_WATCH_EVALUATOR_LIMIT_ENV = "PLAN_WATCH_EVALUATOR_LIMIT";
const PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS_ENV = "PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS";
const PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION_ENV = "PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION";
const PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION_ENV = "PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION";
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
const DEFAULT_PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS = 10;
const DEFAULT_PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION = 3;
const DEFAULT_PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION = 3;
const PLAN_WATCH_SUBSCRIPTION_TTL_DAYS = 45;
const PLAN_WATCH_PUSH_TTL_SECONDS = 30 * 60;
const PLAN_WATCH_PENDING_TTL_SECONDS = 2 * 60 * 60;
const PLAN_WATCH_REGISTRATION_CAP_CACHE_SECONDS = 10 * 60;
const DEFAULT_PLAN_WATCH_EVALUATOR_LIMIT = 5;
const PLAN_WATCH_EVALUATOR_HARD_LIMIT = 25;
const PLAN_WATCH_FORECAST_TIMEOUT_MS = 5500;
const PLAN_WATCH_ALERT_TIMEOUT_MS = 3500;

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
    if (url.pathname === PLAN_WATCH_PENDING_ENDPOINT_PATH) {
      return handlePlanWatchNotificationPendingRequest(request, env);
    }
    if (url.pathname === PLAN_WATCH_EVALUATE_ENDPOINT_PATH) {
      return handlePlanWatchNotificationEvaluateRequest(request, env);
    }
    if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
  async queue(batch, env = {}, ctx = {}) {
    return handleRadarGenerationQueue(batch, env, ctx);
  },
  async scheduled(event, env = {}, ctx = {}) {
    if (!planWatchScheduledEvaluatorEnabled(env)) return;
    ctx.waitUntil(evaluatePlanWatchNotifications(env, {
      reason: "scheduled",
      limit: configuredPlanWatchEvaluatorLimit(env)
    }));
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
      unregisterUrl: PLAN_WATCH_UNREGISTER_ENDPOINT_PATH,
      pendingUrl: PLAN_WATCH_PENDING_ENDPOINT_PATH
    },
    delivery: {
      state: publicKey && privateKey ? "ready" : publicKey ? "missing-vapid-private-key" : "missing-vapid-key",
      subject: configuredPlanWatchVapidSubject(env)
    },
    storage: {
      state: store ? "ready" : "unavailable",
      kind: store?.kind || ""
    },
    limits: {
      mode: configuredPlanWatchEvaluatorMode(env),
      maxActiveSubscriptions: configuredPlanWatchMaxActiveSubscriptions(env),
      maxPlansPerSubscription: configuredPlanWatchMaxPlansPerSubscription(env),
      maxPlacesPerSubscription: configuredPlanWatchMaxPlacesPerSubscription(env),
      scheduledEvaluationLimit: configuredPlanWatchEvaluatorLimit(env)
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
  const existingRecord = store.getJson
    ? await store.getJson(planWatchSubscriptionStorageName(subscriptionId))
    : null;
  if (!existingRecord?.subscription) {
    const capMarker = await planWatchRegistrationCapMarker(store);
    if (capMarker.full) {
      return jsonResponse({
        ok: false,
        provider: PLAN_WATCH_PROVIDER,
        state: "beta-full",
        reason: "plan-watch-registration-limit",
        subscriptionId,
        activeSubscriptions: capMarker.activeSubscriptions,
        maxActiveSubscriptions: capMarker.maxActiveSubscriptions,
        retryAfterSeconds: capMarker.retryAfterSeconds
      }, { status: 429 });
    }
    const capacity = await planWatchRegistrationCapacity(store, subscriptionId, env);
    if (!capacity.allowed) {
      await writePlanWatchRegistrationCapMarker(store, capacity);
      return jsonResponse({
        ok: false,
        provider: PLAN_WATCH_PROVIDER,
        state: "beta-full",
        reason: "plan-watch-registration-limit",
        subscriptionId,
        activeSubscriptions: capacity.activeSubscriptions,
        maxActiveSubscriptions: capacity.maxActiveSubscriptions
      }, { status: 429 });
    }
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_WATCH_SUBSCRIPTION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const record = {
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    subscriptionId,
    platform: normalizePlatform(payload.platform),
    client: normalizePlanWatchClient(payload.client),
    subscription,
    plans: normalizePlanWatchPlans(payload.plans, env),
    places: mergePlanWatchPlacesWithExisting(
      normalizePlanWatchPlaces(payload.places, env),
      existingRecord?.places
    ),
    registeredAt: existingRecord?.registeredAt || now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt
  };
  await store.putJson(planWatchSubscriptionStorageName(subscriptionId), record);
  if (store.deleteJson && existingRecord?.subscription) {
    await store.deleteJson(planWatchRegistrationCapStorageName());
  }
  return jsonResponse({
    ok: true,
    provider: PLAN_WATCH_PROVIDER,
    state: "stored",
    subscriptionId,
    planCount: record.plans.length,
    placeCount: record.places.length,
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
  await store.deleteJson(planWatchRegistrationCapStorageName());
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

export async function handlePlanWatchNotificationPendingRequest(request, env = {}) {
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
  if (!store?.getJson) {
    return jsonResponse({ ok: false, error: "plan-watch-store-unavailable" }, { status: 503 });
  }
  const subscriptionId = await planWatchSubscriptionId(subscription);
  const pendingName = planWatchPendingStorageName(subscriptionId);
  const pending = await store.getJson(pendingName);
  if (!pending?.notification || planWatchPendingExpired(pending)) {
    if (pending && store.deleteJson) await store.deleteJson(pendingName);
    return jsonResponse({ ok: false, state: "no-pending-notification" }, { status: 204 });
  }
  if (store.deleteJson) await store.deleteJson(pendingName);
  return jsonResponse({
    ok: true,
    provider: PLAN_WATCH_PROVIDER,
    notification: normalizePendingPlanWatchNotification(pending.notification)
  });
}

export async function handlePlanWatchNotificationEvaluateRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const auth = planWatchTestAuthorization(request, env);
  if (!auth.available) {
    return jsonResponse({ ok: false, error: "evaluate-disabled" }, { status: 404 });
  }
  if (!auth.authorized) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const payload = await readJsonRequest(request);
  const result = await evaluatePlanWatchNotifications(env, {
    reason: "manual",
    dryRun: Boolean(payload.dryRun),
    subscriptionId: cleanText(payload.subscriptionId, 120),
    limit: configuredPlanWatchEvaluatorLimit(env, payload.limit)
  });
  return jsonResponse(result, { status: result.ok ? 200 : 500 });
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

function configuredPlanWatchEvaluatorMode(env = {}) {
  return cleanToken(env?.[PLAN_WATCH_EVALUATOR_MODE_ENV] || "off", 24).toLowerCase() || "off";
}

function planWatchScheduledEvaluatorEnabled(env = {}) {
  return ["beta", "on", "enabled", "true"].includes(configuredPlanWatchEvaluatorMode(env));
}

function configuredPlanWatchEvaluatorLimit(env = {}, value = undefined) {
  const defaultLimit = boundedInteger(
    env?.[PLAN_WATCH_EVALUATOR_LIMIT_ENV],
    DEFAULT_PLAN_WATCH_EVALUATOR_LIMIT,
    1,
    PLAN_WATCH_EVALUATOR_HARD_LIMIT
  );
  return boundedInteger(value, defaultLimit, 1, PLAN_WATCH_EVALUATOR_HARD_LIMIT);
}

function configuredPlanWatchMaxActiveSubscriptions(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS_ENV],
    DEFAULT_PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS,
    0,
    500
  );
}

function configuredPlanWatchMaxPlansPerSubscription(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION_ENV],
    DEFAULT_PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION,
    1,
    25
  );
}

function configuredPlanWatchMaxPlacesPerSubscription(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION_ENV],
    DEFAULT_PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION,
    1,
    25
  );
}

function planWatchTestAuthorization(request, env = {}) {
  const expected = configuredPlanWatchTestToken(env);
  if (!expected) return { available: false, authorized: false };
  const auth = String(request.headers.get("Authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = String(request.headers.get("X-Nearcast-Test-Token") || bearer || "").trim();
  return { available: true, authorized: token === expected };
}

async function planWatchRegistrationCapacity(store, subscriptionId, env = {}) {
  const maxActiveSubscriptions = configuredPlanWatchMaxActiveSubscriptions(env);
  if (maxActiveSubscriptions <= 0) {
    return { allowed: false, activeSubscriptions: 0, maxActiveSubscriptions };
  }
  if (!store?.listNames || !store?.getJson) {
    return { allowed: true, activeSubscriptions: null, maxActiveSubscriptions };
  }
  const names = await store.listNames(
    "subscriptions/",
    Math.min(1000, Math.max(maxActiveSubscriptions + 25, 50))
  );
  let activeSubscriptions = 0;
  for (const name of names) {
    const record = await store.getJson(name);
    if (!record?.subscription) continue;
    if (planWatchSubscriptionExpired(record)) {
      if (store.deleteJson && record.subscriptionId) {
        await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
      }
      continue;
    }
    if (record.subscriptionId === subscriptionId) continue;
    activeSubscriptions += 1;
  }
  return {
    allowed: activeSubscriptions < maxActiveSubscriptions,
    activeSubscriptions,
    maxActiveSubscriptions
  };
}

async function planWatchRegistrationCapMarker(store) {
  if (!store?.getJson) return { full: false };
  const marker = await store.getJson(planWatchRegistrationCapStorageName());
  if (!marker?.full || planWatchPendingExpired(marker)) return { full: false };
  const expiresAt = timestamp(marker.expiresAt);
  return {
    full: true,
    activeSubscriptions: finiteNumber(marker.activeSubscriptions, null),
    maxActiveSubscriptions: finiteNumber(marker.maxActiveSubscriptions, null),
    retryAfterSeconds: Number.isFinite(expiresAt) ? Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) : null
  };
}

async function writePlanWatchRegistrationCapMarker(store, capacity = {}) {
  if (!store?.putJson) return;
  const now = Date.now();
  return store.putJson(planWatchRegistrationCapStorageName(), {
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    full: true,
    activeSubscriptions: capacity.activeSubscriptions,
    maxActiveSubscriptions: capacity.maxActiveSubscriptions,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_WATCH_REGISTRATION_CAP_CACHE_SECONDS * 1000).toISOString()
  });
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

async function planWatchSubscriptionRecords(store, options = {}) {
  if (!store?.getJson || !store?.listNames) return [];
  const subscriptionId = cleanText(options.subscriptionId, 120);
  if (subscriptionId) {
    const record = await store.getJson(planWatchSubscriptionStorageName(subscriptionId));
    return record?.subscription ? [record] : [];
  }
  const evaluationLimit = configuredPlanWatchEvaluatorLimit(options.env, options.limit);
  const scanLimit = Math.min(
    1000,
    Math.max(evaluationLimit, configuredPlanWatchMaxActiveSubscriptions(options.env))
  );
  const names = await store.listNames("subscriptions/", scanLimit);
  const records = [];
  for (const name of names) {
    const record = await store.getJson(name);
    if (record?.subscription && !planWatchSubscriptionExpired(record)) records.push(record);
  }
  return records
    .sort((a, b) => planWatchLastEvaluatedAt(a) - planWatchLastEvaluatedAt(b))
    .slice(0, evaluationLimit);
}

function planWatchSubscriptionExpired(record) {
  const expiresAt = timestamp(record?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function planWatchLastEvaluatedAt(record = {}) {
  return timestamp(record.evaluatedAt || record.updatedAt || record.registeredAt) || 0;
}

function planWatchPendingExpired(record) {
  const expiresAt = timestamp(record?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

async function evaluatePlanWatchNotifications(env = {}, options = {}) {
  const store = planWatchStore(env);
  if (!store?.getJson || !store?.putJson || !store?.listNames) {
    return {
      ok: false,
      provider: PLAN_WATCH_PROVIDER,
      state: "store-unavailable",
      reason: options.reason || ""
    };
  }
  const records = await planWatchSubscriptionRecords(store, { ...options, env });
  const summary = {
    ok: true,
    provider: PLAN_WATCH_PROVIDER,
    state: "evaluated",
    reason: options.reason || "",
    dryRun: Boolean(options.dryRun),
    checkedAt: new Date().toISOString(),
    subscriptions: records.length,
    plans: 0,
    places: 0,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    updated: 0,
    errors: 0,
    results: []
  };

  for (const record of records) {
    const result = await evaluatePlanWatchSubscription(record, store, env, options);
    summary.plans += result.plans;
    summary.places += result.places;
    summary.candidates += result.candidates;
    summary.sent += result.sent;
    summary.skipped += result.skipped;
    summary.failed += result.failed;
    summary.updated += result.updated;
    summary.errors += result.errors;
    summary.results.push(result);
  }
  return summary;
}

async function evaluatePlanWatchSubscription(record, store, env = {}, options = {}) {
  const plans = Array.isArray(record?.plans) ? record.plans : [];
  const places = Array.isArray(record?.places) ? record.places : [];
  const result = {
    subscriptionId: record?.subscriptionId || "",
    endpointHost: safeUrlHost(record?.subscription?.endpoint),
    plans: plans.length,
    places: places.length,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    updated: 0,
    errors: 0,
    reasons: []
  };
  if (!plans.length && !places.length) return result;

  const evaluatedPlans = [];
  const evaluatedPlaces = [];
  const candidates = [];
  const context = {
    forecastCache: new Map(),
    alertsCache: new Map()
  };
  for (const plan of plans) {
    const evaluation = await evaluatePlanWatchPlan(plan, record, context).catch((error) => ({
      plan,
      error: error?.message || String(error)
    }));
    if (evaluation?.error) {
      result.errors += 1;
      result.reasons.push(`${plan?.id || "plan"}:${evaluation.error}`);
      evaluatedPlans.push(plan);
      continue;
    }
    evaluatedPlans.push(evaluation.plan);
    if (evaluation.updated) result.updated += 1;
    if (evaluation.candidate) candidates.push(evaluation.candidate);
    else result.skipped += 1;
  }
  for (const place of places) {
    const evaluation = await evaluateSavedPlaceWatch(place, record, context).catch((error) => ({
      place,
      error: error?.message || String(error)
    }));
    if (evaluation?.error) {
      result.errors += 1;
      result.reasons.push(`${place?.id || "place"}:${evaluation.error}`);
      evaluatedPlaces.push(place);
      continue;
    }
    evaluatedPlaces.push(evaluation.place);
    if (evaluation.updated) result.updated += 1;
    if (evaluation.candidate) candidates.push(evaluation.candidate);
    else result.skipped += 1;
  }
  result.candidates = candidates.length;

  const top = candidates.sort((a, b) => b.priority - a.priority)[0];
  if (top) {
    if (options.dryRun) {
      result.sent = 0;
      result.reasons.push(`dry-run:${top.type}`);
    } else {
      const pending = buildPendingPlanWatchNotification(record, top);
      await store.putJson(planWatchPendingStorageName(record.subscriptionId), pending);
      const push = await sendPlanWatchPush(record.subscription, env);
      if (push.ok) result.sent = 1;
      else {
        result.failed = 1;
        result.reasons.push(`push-failed:${push.status || 0}`);
        if ((push.status === 404 || push.status === 410) && store.deleteJson) {
          await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
        }
      }
    }
  }

  if (!options.dryRun && result.failed === 0) {
    const nextRecord = {
      ...record,
      plans: evaluatedPlans,
      places: evaluatedPlaces,
      evaluatedAt: new Date().toISOString()
    };
    await store.putJson(planWatchSubscriptionStorageName(record.subscriptionId), nextRecord);
  }
  return result;
}

async function evaluatePlanWatchPlan(plan, record = {}, context = {}) {
  if (!plan || planWatchPlanIsPast(plan)) {
    return { plan, updated: false, candidate: null };
  }
  const unit = record?.client?.unit === "celsius" ? "celsius" : "fahrenheit";
  const forecast = await cachedPlanWatchForecast(plan.place, unit, context);
  const stats = planWatchWindowStats(plan, forecast, unit);
  if (!stats) return { plan, updated: false, candidate: null, error: "forecast-window-unavailable" };
  const alerts = await cachedPlanWatchAlerts(plan.place, context).catch(() => []);
  const windowMs = planWatchWindowMs(plan, forecast);
  const alert = topPlanWatchAlert(alerts, windowMs.startMs, windowMs.endMs);
  const current = planWatchCurrentState(plan, stats, alert, unit);
  const change = planWatchStateChange(plan.lastKnown, current);
  const lastKnown = planWatchLastKnownFromState(plan, current, change);
  const nextPlan = change?.updateBaseline ? { ...plan, lastKnown } : {
    ...plan,
    lastKnown: {
      ...(plan.lastKnown || {}),
      checkedAt: new Date().toISOString()
    }
  };
  const candidate = change?.notify ? planWatchNotificationCandidate(plan, current, change) : null;
  return {
    plan: nextPlan,
    updated: Boolean(change?.updateBaseline),
    candidate
  };
}

async function evaluateSavedPlaceWatch(watchedPlace, record = {}, context = {}) {
  if (!watchedPlace?.place) return { place: watchedPlace, updated: false, candidate: null };
  const unit = record?.client?.unit === "celsius" ? "celsius" : "fahrenheit";
  const forecast = await cachedPlanWatchForecast(watchedPlace.place, unit, context);
  const alerts = await cachedPlanWatchAlerts(watchedPlace.place, context).catch(() => []);
  const current = savedPlaceWatchCurrentState(watchedPlace, forecast, alerts, unit);
  const change = savedPlaceWatchStateChange(watchedPlace.lastKnown, current);
  const lastKnown = savedPlaceWatchLastKnownFromState(watchedPlace, current, change);
  const nextPlace = change?.updateBaseline ? { ...watchedPlace, lastKnown } : {
    ...watchedPlace,
    lastKnown: {
      ...(watchedPlace.lastKnown || {}),
      checkedAt: new Date().toISOString()
    }
  };
  const candidate = change?.notify ? savedPlaceWatchNotificationCandidate(watchedPlace, current, change) : null;
  return {
    place: nextPlace,
    updated: Boolean(change?.updateBaseline),
    candidate
  };
}

function savedPlaceWatchCurrentState(watchedPlace = {}, forecast = {}, alerts = [], unit = "fahrenheit") {
  const place = watchedPlace.place || {};
  const days = [0, 1]
    .map((dayIndex) => savedPlaceWatchDayStats(forecast, dayIndex, alerts, unit))
    .filter(Boolean);
  if (!days.length) return { snapshot: null };
  const placeName = place.name || "Saved place";
  const snapshot = {
    placeId: watchedPlace.id || "",
    placeName,
    unit,
    days
  };
  return {
    signal: "place-watch",
    tone: days.some((day) => day.alertTone === "warning" || day.alertTone === "watch" || day.stormPotential) ? "watch" : "good",
    label: "Saved place forecast",
    reason: savedPlaceWatchSnapshotReason(snapshot, unit),
    body: savedPlaceWatchSnapshotReason(snapshot, unit),
    receipt: savedPlaceWatchSnapshotReceipt(snapshot, unit),
    snapshot
  };
}

function savedPlaceWatchDayStats(forecast = {}, dayIndex = 0, alerts = [], unit = "fahrenheit") {
  const daily = forecast?.daily || {};
  const hourly = forecast?.hourly || {};
  const date = Array.isArray(daily.time) ? cleanText(daily.time[dayIndex], 16) : "";
  if (!date) return null;
  const hourlyIndexes = Array.isArray(hourly.time)
    ? hourly.time.reduce((indexes, time, index) => {
        if (String(time || "").startsWith(date)) indexes.push(index);
        return indexes;
      }, [])
    : [];
  const dayValue = (key, fallback = 0) => Array.isArray(daily?.[key])
    ? finiteNumber(daily[key][dayIndex], fallback)
    : fallback;
  const hourlyValues = (key, fallback = 0) => {
    const values = hourlyIndexes
      .map((index) => finiteNumber(hourly?.[key]?.[index], null))
      .filter(Number.isFinite);
    return values.length ? values : [fallback];
  };
  const temps = hourlyValues("temperature_2m", dayValue("temperature_2m_max", 0));
  const feels = hourlyValues("apparent_temperature", dayValue("apparent_temperature_max", temps[0] || 0));
  const rain = hourlyValues("precipitation_probability", dayValue("precipitation_probability_max", 0));
  const precip = hourlyValues("precipitation", 0);
  const gust = hourlyValues("wind_gusts_10m", dayValue("wind_gusts_10m_max", 0));
  const uv = hourlyValues("uv_index", dayValue("uv_index_max", 0));
  const codes = hourlyIndexes.length
    ? hourlyIndexes.map((index) => Number(hourly.weather_code?.[index])).filter(Number.isFinite)
    : [dayValue("weather_code", 0)];
  const offset = finiteNumber(forecast.utc_offset_seconds, 0) * 1000;
  const startMs = planWatchLocalDateHourMs(date, 0, offset);
  const endMs = planWatchLocalDateHourMs(date, 24, offset);
  const alert = topPlanWatchAlert(alerts, startMs, endMs);
  const alertTone = planWatchAlertTone(alert);
  return {
    date,
    label: dayIndex === 0 ? "today" : "tomorrow",
    rainChance: roundNumber(Math.max(...rain)),
    precipTotal: roundNumber(precip.reduce((sum, item) => sum + Number(item || 0), 0), unit === "fahrenheit" ? 2 : 1),
    tempMin: roundNumber(Math.min(...temps)),
    tempMax: roundNumber(Math.max(...temps)),
    feelsMax: roundNumber(Math.max(...feels)),
    gustMax: roundNumber(Math.max(...gust)),
    uvMax: roundNumber(Math.max(...uv)),
    stormPotential: codes.some((code) => code >= 95),
    alertTone,
    alertEvent: cleanText(alert?.event || "", 120)
  };
}

function savedPlaceWatchSnapshotReason(snapshot = {}, unit = "fahrenheit") {
  const tomorrow = (snapshot.days || []).find((day) => day.label === "tomorrow");
  const today = (snapshot.days || [])[0];
  const day = tomorrow || today;
  if (!day) return "Watching saved place weather.";
  const tempUnit = unit === "fahrenheit" ? "°F" : "°C";
  if (day.alertEvent) return `${day.alertEvent} ${day.label}.`;
  if (day.stormPotential) return `Storms are possible ${day.label}.`;
  if (day.rainChance >= 50) return `Rain chance ${day.rainChance}% ${day.label}.`;
  if (day.feelsMax >= (unit === "fahrenheit" ? 95 : 35)) return `Feels up to ${day.feelsMax}${tempUnit} ${day.label}.`;
  return `${day.label} still looks mostly steady.`;
}

function savedPlaceWatchSnapshotReceipt(snapshot = {}, unit = "fahrenheit") {
  const tempUnit = unit === "fahrenheit" ? "°F" : "°C";
  const windUnit = unit === "fahrenheit" ? "mph" : "km/h";
  return (snapshot.days || [])
    .slice(0, 2)
    .map((day) => {
      const parts = [
        `${capitalizeWord(day.label || "day")}: rain ${roundNumber(day.rainChance)}%`,
        `feels ${roundNumber(day.feelsMax)}${tempUnit}`,
        `gusts ${roundNumber(day.gustMax)} ${windUnit}`
      ];
      if (day.alertEvent) parts.push(day.alertEvent);
      if (day.stormPotential) parts.push("storms possible");
      return parts.filter(Boolean).join(", ");
    })
    .filter(Boolean)
    .join(" · ");
}

function savedPlaceWatchStateChange(previousLastKnown = {}, current = {}) {
  const previous = normalizePlanWatchSnapshot(previousLastKnown?.snapshot);
  const currentSnapshot = current.snapshot;
  if (!currentSnapshot?.days?.length) return { updateBaseline: false, notify: false };
  if (!previous?.days?.length) {
    return { type: "place-baseline", notify: false, updateBaseline: true, priority: 0 };
  }

  let sawComparableDay = false;
  let missingCurrentDayBaseline = false;
  const changes = [];
  for (const day of currentSnapshot.days) {
    const previousDay = previous.days.find((item) => item.date === day.date);
    if (!previousDay) {
      missingCurrentDayBaseline = true;
      continue;
    }
    sawComparableDay = true;
    const change = savedPlaceWatchDayChange(currentSnapshot, previousDay, day);
    if (change?.notify || change?.updateBaseline) changes.push(change);
  }
  if (!sawComparableDay) {
    return { type: "place-baseline-rollover", notify: false, updateBaseline: true, priority: 0 };
  }
  return changes.sort((a, b) => b.priority - a.priority)[0] ||
    (missingCurrentDayBaseline
      ? { type: "place-baseline-partial", notify: false, updateBaseline: true, priority: 0 }
      : { updateBaseline: false, notify: false });
}

function savedPlaceWatchDayChange(snapshot = {}, previous = {}, current = {}) {
  const placeName = snapshot.placeName || "saved place";
  const tempUnit = snapshot.unit === "celsius" ? "°C" : "°F";
  const windUnit = snapshot.unit === "celsius" ? "km/h" : "mph";

  if (
    current.alertTone &&
    current.alertTone !== "none" &&
    (current.alertTone !== previous.alertTone || current.alertEvent !== previous.alertEvent)
  ) {
    return {
      type: "place-alert",
      tone: current.alertTone === "warning" || current.alertTone === "watch" ? "watch" : "caution",
      notify: true,
      updateBaseline: true,
      priority: current.alertTone === "warning" ? 135 : current.alertTone === "watch" ? 122 : 105,
      title: `${placeName}: weather alert ${current.label}`,
      body: `${current.alertEvent || "A weather alert"} is active ${current.label}.`,
      day: current
    };
  }

  const stormStarted = Boolean(current.stormPotential) && !Boolean(previous.stormPotential);
  if (stormStarted || (Boolean(current.stormPotential) && current.rainChance >= 50 && previous.rainChance < 35)) {
    return {
      type: "place-storm",
      tone: "watch",
      notify: true,
      updateBaseline: true,
      priority: 112 + Math.max(0, current.rainChance - previous.rainChance),
      title: `Storms possible ${current.label} in ${placeName}`,
      body: `Thunderstorms are now showing for ${current.label}.`,
      day: current
    };
  }

  const rainDelta = numberDelta(current.rainChance, previous.rainChance);
  const gotWetter = rainDelta !== null &&
    ((previous.rainChance <= 35 && current.rainChance >= 60) || (rainDelta >= 30 && current.rainChance >= 50));
  if (gotWetter) {
    return {
      type: "place-rain",
      tone: "caution",
      notify: true,
      updateBaseline: true,
      priority: 82 + Math.min(40, Math.abs(rainDelta)),
      title: `Rain is more likely ${current.label} in ${placeName}`,
      body: `Rain chance is now ${current.rainChance}%, up from ${previous.rainChance}%.`,
      day: current
    };
  }
  const clearedUp = rainDelta !== null &&
    ((previous.rainChance >= 50 && current.rainChance <= 25) || (rainDelta <= -30 && previous.rainChance >= 50));
  if (clearedUp) {
    return {
      type: "place-clearing",
      tone: "good",
      notify: true,
      updateBaseline: true,
      priority: 72 + Math.min(30, Math.abs(rainDelta)),
      title: `${capitalizeWord(current.label)} cleared up in ${placeName}`,
      body: `Rain chance dropped to ${current.rainChance}%, from ${previous.rainChance}%.`,
      day: current
    };
  }

  const heatDelta = numberDelta(current.feelsMax, previous.feelsMax);
  const seriousHeat = snapshot.unit === "celsius" ? 38 : 100;
  const notableHeat = snapshot.unit === "celsius" ? 35 : 95;
  const heatJump = snapshot.unit === "celsius" ? 4 : 8;
  if (
    heatDelta !== null &&
    heatDelta > 0 &&
    ((previous.feelsMax < seriousHeat && current.feelsMax >= seriousHeat) ||
      (heatDelta >= heatJump && current.feelsMax >= notableHeat))
  ) {
    return {
      type: "place-heat",
      tone: current.feelsMax >= seriousHeat ? "watch" : "caution",
      notify: true,
      updateBaseline: true,
      priority: 84 + Math.min(30, Math.abs(heatDelta)),
      title: `Heat risk rises ${current.label} in ${placeName}`,
      body: `Feels-like temperature now peaks near ${current.feelsMax}${tempUnit}.`,
      day: current
    };
  }

  const gustDelta = numberDelta(current.gustMax, previous.gustMax);
  const strongWind = snapshot.unit === "celsius" ? 48 : 30;
  const notableWind = snapshot.unit === "celsius" ? 40 : 25;
  const windJump = snapshot.unit === "celsius" ? 20 : 12;
  if (
    gustDelta !== null &&
    gustDelta > 0 &&
    ((previous.gustMax < strongWind && current.gustMax >= strongWind) ||
      (gustDelta >= windJump && current.gustMax >= notableWind))
  ) {
    return {
      type: "place-wind",
      tone: "caution",
      notify: true,
      updateBaseline: true,
      priority: 76 + Math.min(25, Math.abs(gustDelta)),
      title: `Wind picks up ${current.label} in ${placeName}`,
      body: `Gusts now peak near ${current.gustMax} ${windUnit}.`,
      day: current
    };
  }

  if (previous.alertTone && !current.alertTone) {
    return { type: "place-alert-ended", tone: "good", notify: false, updateBaseline: true, priority: 35, day: current };
  }

  return null;
}

function savedPlaceWatchLastKnownFromState(watchedPlace, current, change = {}) {
  const body = change?.body || current.body || "";
  const signal = change?.type || current.signal || "place-watch";
  const eventKey = [
    watchedPlace.id,
    signal,
    change?.day?.date || "",
    body || current.reason || ""
  ].join("|");
  return {
    eventKey,
    signal,
    tone: change?.tone || current.tone || "",
    label: current.label || "",
    reason: current.reason || "",
    body,
    receipt: current.receipt || "",
    checkedAt: new Date().toISOString(),
    snapshot: current.snapshot
  };
}

function savedPlaceWatchNotificationCandidate(watchedPlace, current, change = {}) {
  const id = cleanToken(watchedPlace.id, 80);
  return {
    type: change.type || current.signal || "place-watch",
    priority: change.priority || 50,
    notification: {
      title: change.title || `Nearcast: ${watchedPlace.place?.name || "Saved place"}`,
      body: change.body || current.body || "Weather changed for this saved place.",
      tag: `nearcast-place-${id}`,
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      url: "./",
      placeId: watchedPlace.id || "",
      source: "place-watch-evaluator"
    }
  };
}

function planWatchPlanIsPast(plan) {
  if (!plan?.targetDate) return false;
  const endOfDate = new Date(`${plan.targetDate}T23:59:59Z`);
  return Number.isFinite(endOfDate.getTime()) && endOfDate.getTime() < Date.now() - 12 * 60 * 60 * 1000;
}

async function cachedPlanWatchForecast(place = {}, unit = "fahrenheit", context = {}) {
  if (!context.forecastCache) return fetchPlanWatchForecast(place, unit);
  const key = planWatchPlaceCacheKey(place, unit);
  if (!context.forecastCache.has(key)) {
    context.forecastCache.set(key, fetchPlanWatchForecast(place, unit));
  }
  return context.forecastCache.get(key);
}

async function cachedPlanWatchAlerts(place = {}, context = {}) {
  if (!context.alertsCache) return fetchPlanWatchAlerts(place);
  const key = planWatchPlaceCacheKey(place, "alerts");
  if (!context.alertsCache.has(key)) {
    context.alertsCache.set(key, fetchPlanWatchAlerts(place));
  }
  return context.alertsCache.get(key);
}

function planWatchPlaceCacheKey(place = {}, suffix = "") {
  const lat = Number.isFinite(Number(place.latitude)) ? Number(place.latitude).toFixed(3) : "lat";
  const lon = Number.isFinite(Number(place.longitude)) ? Number(place.longitude).toFixed(3) : "lon";
  return [lat, lon, suffix].join(":");
}

async function fetchPlanWatchForecast(place = {}, unit = "fahrenheit") {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_gusts_10m",
      "uv_index"
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "uv_index_max"
    ].join(","),
    temperature_unit: unit,
    wind_speed_unit: unit === "fahrenheit" ? "mph" : "kmh",
    precipitation_unit: unit === "fahrenheit" ? "inch" : "mm",
    timezone: "auto",
    forecast_days: "10"
  });
  return fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`, PLAN_WATCH_FORECAST_TIMEOUT_MS);
}

async function fetchPlanWatchAlerts(place = {}) {
  const countryCode = cleanToken(place.countryCode || place.country_code || "", 8).toUpperCase();
  if (countryCode && !["US", "USA"].includes(countryCode)) return [];
  if (!Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return [];
  const url = `https://api.weather.gov/alerts/active?point=${Number(place.latitude).toFixed(4)},${Number(place.longitude).toFixed(4)}`;
  const json = await fetchJsonWithTimeout(url, PLAN_WATCH_ALERT_TIMEOUT_MS, {
    headers: { Accept: "application/geo+json" }
  });
  return (json?.features || []).map((feature) => feature.properties).filter(Boolean);
}

async function fetchJsonWithTimeout(url, timeoutMs, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`fetch-${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function planWatchWindowStats(plan, forecast, unit = "fahrenheit") {
  const hourly = forecast?.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  if (!times.length || !plan?.targetDate) return null;
  const startHour = finiteNumber(plan.startHour, 0);
  const endHour = finiteNumber(plan.endHour, 24);
  const indexes = times.reduce((result, time, index) => {
    if (!String(time).startsWith(plan.targetDate)) return result;
    const hour = planWatchLocalHour(time);
    if (hour >= startHour && hour < endHour) result.push(index);
    return result;
  }, []);
  const dailyIndex = Array.isArray(forecast?.daily?.time)
    ? forecast.daily.time.indexOf(plan.targetDate)
    : -1;
  const values = (key, fallback = 0) => indexes.length
    ? indexes.map((index) => finiteNumber(hourly?.[key]?.[index], fallback))
    : [fallback];
  const dayValue = (key, fallback = 0) => dailyIndex >= 0
    ? finiteNumber(forecast?.daily?.[key]?.[dailyIndex], fallback)
    : fallback;
  const temps = values("temperature_2m", dayValue("temperature_2m_max", 0));
  const feels = values("apparent_temperature", dayValue("apparent_temperature_max", temps[0] || 0));
  const pop = values("precipitation_probability", dayValue("precipitation_probability_max", 0));
  const precip = values("precipitation", 0);
  const wind = values("wind_speed_10m", dayValue("wind_speed_10m_max", 0));
  const gust = values("wind_gusts_10m", dayValue("wind_gusts_10m_max", 0));
  const uv = values("uv_index", dayValue("uv_index_max", 0));
  const codes = indexes.length ? indexes.map((index) => hourly.weather_code?.[index]) : [dayValue("weather_code", 0)];
  return {
    tempMin: roundNumber(Math.min(...temps)),
    tempMax: roundNumber(Math.max(...temps)),
    feelsAvg: roundNumber(avgNumber(feels)),
    feelsMin: roundNumber(Math.min(...feels)),
    feelsMax: roundNumber(Math.max(...feels)),
    rainChance: roundNumber(Math.max(...pop)),
    rainChanceMin: roundNumber(Math.min(...pop)),
    precipTotal: roundNumber(precip.reduce((sum, item) => sum + Number(item || 0), 0), unit === "fahrenheit" ? 2 : 1),
    windMin: roundNumber(Math.min(...wind)),
    windMax: roundNumber(Math.max(...wind)),
    gustMax: roundNumber(Math.max(...gust)),
    uvMax: roundNumber(Math.max(...uv)),
    stormPotential: codes.some((code) => Number(code) >= 95)
  };
}

function planWatchLocalHour(value) {
  const match = String(value || "").match(/T(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2] || 0) / 60;
}

function planWatchWindowMs(plan, forecast = {}) {
  const offset = finiteNumber(forecast.utc_offset_seconds, 0) * 1000;
  const start = planWatchLocalDateHourMs(plan.targetDate, finiteNumber(plan.startHour, 0), offset);
  const end = planWatchLocalDateHourMs(plan.targetDate, finiteNumber(plan.endHour, 24), offset);
  return { startMs: start, endMs: Math.max(end, start + 60 * 60 * 1000) };
}

function planWatchLocalDateHourMs(date, hour, utcOffsetMs) {
  const [year, month, day] = String(date || "").split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return NaN;
  const wholeHour = Math.floor(hour);
  const minute = Math.round((hour - wholeHour) * 60);
  return Date.UTC(year, month - 1, day, wholeHour, minute) - utcOffsetMs;
}

function topPlanWatchAlert(alerts = [], startMs, endMs) {
  return alerts
    .filter((alert) => planWatchAlertOverlaps(alert, startMs, endMs))
    .sort((a, b) => planWatchAlertPriority(b) - planWatchAlertPriority(a))[0] || null;
}

function planWatchAlertOverlaps(alert, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  const alertStart = timestamp(alert?.onset || alert?.effective);
  const alertEnd = timestamp(alert?.ends || alert?.expires);
  const startsBeforeEnd = alertStart === null || alertStart < endMs;
  const endsAfterStart = alertEnd === null || alertEnd > startMs;
  return startsBeforeEnd && endsAfterStart;
}

function planWatchAlertTone(alert) {
  const event = String(alert?.event || "").toLowerCase();
  if (event.includes("warning")) return "warning";
  if (event.includes("watch")) return "watch";
  if (event.includes("advisory")) return "advisory";
  if (alert?.severity === "Extreme" || alert?.severity === "Severe") return "warning";
  if (alert?.severity === "Moderate" || alert?.severity === "Minor") return "advisory";
  return alert ? "notice" : "";
}

function planWatchAlertPriority(alert) {
  const tone = planWatchAlertTone(alert);
  const toneRank = { warning: 4, watch: 3, advisory: 2, notice: 1 }[tone] || 0;
  const severityRank = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 }[alert?.severity] || 0;
  return toneRank * 100 + severityRank * 10;
}

function planWatchCurrentState(plan, stats, alert, unit = "fahrenheit") {
  const alertTone = planWatchAlertTone(alert);
  const score = planWatchWindowScore(stats, unit);
  const riskKind = planWatchRiskKindForStats(stats, alert, unit);
  const tone = alertTone === "warning" || alertTone === "watch" || score < 45 || stats.stormPotential
    ? "watch"
    : score < 65 || stats.rainChance >= 35 || stats.gustMax >= (unit === "fahrenheit" ? 25 : 40) ? "caution" : "good";
  const label = planWatchStateLabel({ tone, riskKind, alert });
  const reason = planWatchStateReason(stats, alert, unit);
  const body = `${label}: ${reason}.`;
  const receipt = planWatchStateReceipt(stats, alert, unit);
  const snapshot = {
    title: plan.title || "Plan",
    targetDate: plan.targetDate || "",
    startHour: roundNumber(finiteNumber(plan.startHour, null)),
    endHour: roundNumber(finiteNumber(plan.endHour, null)),
    rainChance: roundNumber(stats.rainChance),
    gustMax: roundNumber(stats.gustMax),
    windUnit: unit === "fahrenheit" ? "mph" : "km/h",
    feelsMax: roundNumber(stats.feelsMax),
    tempUnit: unit === "fahrenheit" ? "°F" : "°C",
    score,
    tone,
    verdict: planWatchVerdict(score, tone),
    alertTone,
    alertEvent: alert?.event || "",
    riskKind
  };
  const signal = alert ? "plan-alert" : tone;
  return {
    signal,
    tone,
    label,
    reason,
    body,
    receipt,
    snapshot,
    alert
  };
}

function planWatchRiskKindForStats(stats = {}, alert = null, unit = "fahrenheit") {
  const text = [alert?.event, alert?.headline, alert?.description, alert?.instruction].filter(Boolean).join(" ").toLowerCase();
  if (/\b(excessive heat|extreme heat|heat warning|heat advisory|heat|hot|humid|uv)\b/.test(text)) return "heat";
  if (/\b(thunder|lightning|hail|tornado|severe thunderstorm)\b/.test(text)) return "storm";
  if (/\b(flood|flash flood|heavy rain|downpour)\b/.test(text)) return "rain";
  if (/\b(high wind|wind advisory|strong wind|gust)\b/.test(text)) return "wind";
  if (stats.stormPotential) return "storm";
  if (stats.rainChance >= 35 || stats.precipTotal > (unit === "fahrenheit" ? 0.02 : 0.5)) return "rain";
  if (stats.gustMax >= (unit === "fahrenheit" ? 25 : 40)) return "wind";
  if (stats.feelsMax >= (unit === "fahrenheit" ? 92 : 33) || stats.uvMax >= 8) return "heat";
  return "good";
}

function planWatchStateLabel({ tone, riskKind, alert }) {
  if (tone === "good") return "Looks good";
  if (riskKind === "heat") return "Plan around heat";
  if (riskKind === "storm") return alert ? "Alert overlaps" : "Keep an eye on storms";
  if (riskKind === "rain") return "Expect rain";
  if (riskKind === "wind") return "Wind may matter";
  if (alert) return "Alert overlaps";
  return "Keep an eye on it";
}

function planWatchStateReason(stats = {}, alert = null, unit = "fahrenheit") {
  const windUnit = unit === "fahrenheit" ? "mph" : "km/h";
  const tempUnit = unit === "fahrenheit" ? "°F" : "°C";
  if (alert?.event) return `${alert.event} overlaps that window`;
  if (stats.stormPotential) return "thunderstorms are possible";
  if (stats.rainChance >= 35) return `${stats.rainChance}% rain chance`;
  if (stats.gustMax >= (unit === "fahrenheit" ? 25 : 40)) return `gusts near ${stats.gustMax} ${windUnit}`;
  if (stats.uvMax >= 8) return `UV up to ${stats.uvMax}`;
  if (stats.feelsMax >= (unit === "fahrenheit" ? 88 : 31)) return `feels up to ${stats.feelsMax}${tempUnit}`;
  return `rain looks low (${stats.rainChance}%)`;
}

function planWatchStateReceipt(stats = {}, alert = null, unit = "fahrenheit") {
  const windUnit = unit === "fahrenheit" ? "mph" : "km/h";
  const tempUnit = unit === "fahrenheit" ? "°F" : "°C";
  const precipUnit = unit === "fahrenheit" ? "in" : "mm";
  const lines = [];
  if (alert?.event) lines.push(`Alert: ${alert.event} overlaps this window`);
  lines.push(`Rain: ${roundNumber(stats.rainChanceMin ?? stats.rainChance)}-${roundNumber(stats.rainChance)}%`);
  lines.push(`Feels: ${roundNumber(stats.feelsMin ?? stats.feelsAvg)}${tempUnit}-${roundNumber(stats.feelsMax ?? stats.feelsAvg)}${tempUnit}`);
  lines.push(`Gusts: peak ${roundNumber(stats.gustMax)} ${windUnit}`);
  if (Number(stats.precipTotal || 0) > 0) {
    lines.push(`Amount: ${roundNumber(stats.precipTotal, unit === "fahrenheit" ? 2 : 1)} ${precipUnit}`);
  }
  if (Number(stats.uvMax || 0) > 0) lines.push(`UV: peak ${roundNumber(stats.uvMax)}`);
  return lines.filter(Boolean).slice(0, 5).join(" · ");
}

function planWatchWindowScore(stats = {}, unit = "fahrenheit") {
  const feelsF = unit === "celsius" ? (stats.feelsAvg * 9) / 5 + 32 : stats.feelsAvg;
  const windMph = unit === "celsius" ? stats.windMax / 1.609344 : stats.windMax;
  const gustMph = unit === "celsius" ? stats.gustMax / 1.609344 : stats.gustMax;
  const target = 72;
  const tempPenalty = Math.abs(feelsF - target) * 0.8;
  const rainPenalty = stats.rainChance * 1.2 + stats.precipTotal * 80;
  const windPenalty = Math.max(0, windMph - 24) * 2 + Math.max(0, gustMph - 32) * 2;
  const uvPenalty = Math.max(0, stats.uvMax - 8 + 1) * 5;
  return Math.round(100 - tempPenalty - rainPenalty - windPenalty - uvPenalty);
}

function planWatchVerdict(score, tone) {
  if (tone === "watch") return "Watch closely";
  if (score >= 80) return "Looks good";
  if (score >= 65) return "Pretty good";
  if (score >= 45) return "Iffy";
  return "Not ideal";
}

function planWatchStateChange(previousLastKnown = {}, current = {}) {
  const previous = normalizePlanWatchSnapshot(previousLastKnown?.snapshot);
  const currentSnapshot = current.snapshot;
  if (!currentSnapshot) return { updateBaseline: false, notify: false };

  if (!previous) {
    const hadAlert = /alert|warning|watch|advisory/i.test([
      previousLastKnown?.signal,
      previousLastKnown?.label,
      previousLastKnown?.reason,
      previousLastKnown?.body
    ].filter(Boolean).join(" "));
    if (currentSnapshot.alertTone && !hadAlert) {
      return {
        type: "plan-alert",
        tone: currentSnapshot.alertTone === "warning" || currentSnapshot.alertTone === "watch" ? "watch" : "caution",
        notify: true,
        updateBaseline: true,
        priority: currentSnapshot.alertTone === "warning" ? 140 : currentSnapshot.alertTone === "watch" ? 125 : 105,
        title: `${currentSnapshot.title}: alert started`,
        body: `${currentSnapshot.alertEvent || "A weather alert"} now overlaps this plan.`
      };
    }
    return { type: "baseline", notify: false, updateBaseline: true, priority: 0 };
  }

  if (
    currentSnapshot.alertTone &&
    currentSnapshot.alertTone !== "none" &&
    (currentSnapshot.alertTone !== previous.alertTone || currentSnapshot.alertEvent !== previous.alertEvent)
  ) {
    return {
      type: "plan-alert",
      tone: currentSnapshot.alertTone === "warning" || currentSnapshot.alertTone === "watch" ? "watch" : "caution",
      notify: true,
      updateBaseline: true,
      priority: currentSnapshot.alertTone === "warning" ? 140 : currentSnapshot.alertTone === "watch" ? 125 : 105,
      title: `${currentSnapshot.title}: alert started`,
      body: `${currentSnapshot.alertEvent || "A weather alert"} now overlaps this plan.`
    };
  }

  if (previous.alertTone && !currentSnapshot.alertTone) {
    return { type: "plan-alert-ended", tone: "good", notify: false, updateBaseline: true, priority: 45 };
  }

  const rainDelta = numberDelta(currentSnapshot.rainChance, previous.rainChance);
  if (rainDelta !== null && Math.abs(rainDelta) >= 20 && Math.max(currentSnapshot.rainChance, previous.rainChance) >= 35) {
    const wetter = rainDelta > 0;
    return {
      type: "plan-rain",
      tone: wetter ? "watch" : "good",
      notify: wetter,
      updateBaseline: true,
      priority: 90 + Math.abs(rainDelta),
      title: `${currentSnapshot.title} ${wetter ? "got wetter" : "got drier"}`,
      body: `Rain now ${currentSnapshot.rainChance}%, ${wetter ? "up" : "down"} from ${previous.rainChance}%.`
    };
  }

  const heatDelta = numberDelta(currentSnapshot.feelsMax, previous.feelsMax);
  const seriousHeat = currentSnapshot.tempUnit === "°C" ? 38 : 100;
  const notableHeat = currentSnapshot.tempUnit === "°C" ? 33 : 92;
  const crossedSeriousHeat = Number.isFinite(previous.feelsMax) &&
    Number.isFinite(currentSnapshot.feelsMax) &&
    previous.feelsMax < seriousHeat &&
    currentSnapshot.feelsMax >= seriousHeat;
  if (
    heatDelta !== null &&
    (crossedSeriousHeat || (Math.abs(heatDelta) >= (currentSnapshot.tempUnit === "°C" ? 3 : 5) && Math.max(currentSnapshot.feelsMax, previous.feelsMax) >= notableHeat))
  ) {
    const hotter = heatDelta > 0;
    return {
      type: "plan-heat",
      tone: hotter ? (currentSnapshot.feelsMax >= seriousHeat ? "watch" : "caution") : "good",
      notify: hotter,
      updateBaseline: true,
      priority: (hotter ? 88 : 52) + Math.abs(heatDelta),
      title: `${currentSnapshot.title} ${hotter ? "got hotter" : "cooled down"}`,
      body: `Feels like now peaks at ${currentSnapshot.feelsMax}${currentSnapshot.tempUnit}, ${hotter ? "up" : "down"} from ${previous.feelsMax}${currentSnapshot.tempUnit}.`
    };
  }

  const gustDelta = numberDelta(currentSnapshot.gustMax, previous.gustMax);
  const windThreshold = currentSnapshot.windUnit === "mph" ? 8 : 13;
  const notableWind = currentSnapshot.windUnit === "mph" ? 24 : 39;
  if (
    currentSnapshot.windUnit === previous.windUnit &&
    gustDelta !== null &&
    Math.abs(gustDelta) >= windThreshold &&
    Math.max(currentSnapshot.gustMax, previous.gustMax) >= notableWind
  ) {
    const stronger = gustDelta > 0;
    return {
      type: "plan-wind",
      tone: stronger ? "caution" : "good",
      notify: stronger,
      updateBaseline: true,
      priority: 70 + Math.abs(gustDelta),
      title: `${currentSnapshot.title} ${stronger ? "got windier" : "eased up"}`,
      body: `Gusts now ${currentSnapshot.gustMax} ${currentSnapshot.windUnit}, ${stronger ? "from" : "down from"} ${previous.gustMax} ${currentSnapshot.windUnit}.`
    };
  }

  const scoreDelta = numberDelta(currentSnapshot.score, previous.score);
  if (scoreDelta !== null && Math.abs(scoreDelta) >= 18 && scoreBand(currentSnapshot.score) !== scoreBand(previous.score)) {
    const better = scoreDelta > 0;
    return {
      type: "plan-score",
      tone: better ? "good" : "caution",
      notify: !better,
      updateBaseline: true,
      priority: 55 + Math.abs(scoreDelta),
      title: `${currentSnapshot.title} looks ${better ? "better" : "iffy now"}`,
      body: `Plan window moved from ${scoreBand(previous.score)} to ${scoreBand(currentSnapshot.score)}.`
    };
  }

  return { updateBaseline: false, notify: false };
}

function planWatchLastKnownFromState(plan, current, change = {}) {
  const body = change?.body || current.body || "";
  const signal = change?.type || current.signal || current.tone || "watch";
  const eventKey = [
    plan.id,
    plan.targetDate,
    plan.startHour,
    plan.endHour,
    signal,
    body || current.reason || ""
  ].join("|");
  return {
    eventKey,
    signal,
    tone: current.tone || "",
    label: current.label || "",
    reason: current.reason || "",
    body,
    receipt: current.receipt || "",
    checkedAt: new Date().toISOString(),
    snapshot: current.snapshot
  };
}

function planWatchNotificationCandidate(plan, current, change = {}) {
  return {
    type: change.type || current.signal || "plan-watch",
    priority: change.priority || 50,
    notification: {
      title: change.title || `Nearcast: ${plan.title || "Watched plan"}`,
      body: change.body || current.body || "Weather changed for this plan.",
      tag: `nearcast-plan-${cleanToken(plan.id, 80)}`,
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      url: "./",
      memoryId: plan.id || "",
      source: "plan-watch-evaluator"
    }
  };
}

function buildPendingPlanWatchNotification(record, candidate) {
  const createdAt = new Date();
  return {
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    subscriptionId: record.subscriptionId,
    notification: normalizePendingPlanWatchNotification(candidate.notification),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PLAN_WATCH_PENDING_TTL_SECONDS * 1000).toISOString()
  };
}

function normalizePendingPlanWatchNotification(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    title: cleanText(source.title || "Nearcast", 120),
    body: cleanText(source.body || "A watched plan changed.", 220),
    tag: cleanText(source.tag || "nearcast-plan-watch", 120),
    renotify: Boolean(source.renotify),
    icon: cleanText(source.icon || "/icons/icon-192.png", 120),
    badge: cleanText(source.badge || "/icons/icon-192.png", 120),
    url: cleanText(source.url || "./", 200),
    memoryId: cleanText(source.memoryId || "", 96),
    placeId: cleanText(source.placeId || "", 96),
    source: cleanToken(source.source || "plan-watch-evaluator", 64)
  };
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

function normalizePlanWatchPlans(value, env = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, configuredPlanWatchMaxPlansPerSubscription(env))
    .map(normalizePlanWatchPlan)
    .filter(Boolean);
}

function normalizePlanWatchPlaces(value, env = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, configuredPlanWatchMaxPlacesPerSubscription(env))
    .map(normalizePlanWatchWatchedPlace)
    .filter(Boolean);
}

function normalizePlanWatchWatchedPlace(value) {
  if (!value || typeof value !== "object") return null;
  const place = normalizePlanWatchPlace(value.place || value);
  if (!place) return null;
  const id = cleanText(value.id || planWatchPlaceStableId(place), 96);
  if (!id) return null;
  return {
    id,
    place,
    lastKnown: normalizePlanWatchLastKnown(value.lastKnown)
  };
}

function mergePlanWatchPlacesWithExisting(places = [], existingPlaces = []) {
  const existingById = new Map((Array.isArray(existingPlaces) ? existingPlaces : [])
    .filter(Boolean)
    .map((place) => [place.id, place]));
  return places.map((place) => {
    const existing = existingById.get(place.id);
    const hasIncomingSnapshot = Boolean(place?.lastKnown?.snapshot);
    return {
      ...place,
      lastKnown: hasIncomingSnapshot ? place.lastKnown : (existing?.lastKnown || place.lastKnown)
    };
  });
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

function planWatchPlaceStableId(place = {}) {
  const name = cleanToken(place.name || "place", 40).toLowerCase();
  const lat = Number.isFinite(Number(place.latitude)) ? Number(place.latitude).toFixed(3) : "lat";
  const lon = Number.isFinite(Number(place.longitude)) ? Number(place.longitude).toFixed(3) : "lon";
  return [name, lat, lon].join("-");
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
    receipt: cleanText(source.receipt, 500),
    checkedAt: cleanText(source.checkedAt, 40),
    snapshot: normalizePlanWatchSnapshot(source.snapshot)
  };
}

function planWatchSubscriptionStorageName(subscriptionId) {
  return `subscriptions/${cleanStorageName(subscriptionId)}.json`;
}

function planWatchPendingStorageName(subscriptionId) {
  return `pending/${cleanStorageName(subscriptionId)}.json`;
}

function planWatchRegistrationCapStorageName() {
  return "limits/registration-cap.json";
}

function normalizePlanWatchSnapshot(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    placeId: cleanText(value.placeId, 96),
    placeName: cleanText(value.placeName, 120),
    unit: cleanToken(value.unit, 16),
    title: cleanText(value.title, 120),
    targetDate: cleanText(value.targetDate, 16),
    startHour: finiteNumber(value.startHour, null),
    endHour: finiteNumber(value.endHour, null),
    rainChance: finiteNumber(value.rainChance, null),
    gustMax: finiteNumber(value.gustMax, null),
    windUnit: cleanText(value.windUnit, 16),
    feelsMax: finiteNumber(value.feelsMax, null),
    tempUnit: cleanText(value.tempUnit, 8),
    score: finiteNumber(value.score, null),
    tone: cleanToken(value.tone, 32),
    verdict: cleanText(value.verdict, 60),
    alertTone: cleanToken(value.alertTone, 32),
    alertEvent: cleanText(value.alertEvent, 120),
    riskKind: cleanToken(value.riskKind, 32),
    days: normalizePlanWatchSnapshotDays(value.days)
  };
}

function normalizePlanWatchSnapshotDays(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((day) => {
    const source = day && typeof day === "object" ? day : {};
    return {
      date: cleanText(source.date, 16),
      label: cleanToken(source.label, 24),
      rainChance: finiteNumber(source.rainChance, null),
      precipTotal: finiteNumber(source.precipTotal, null),
      tempMin: finiteNumber(source.tempMin, null),
      tempMax: finiteNumber(source.tempMax, null),
      feelsMax: finiteNumber(source.feelsMax, null),
      gustMax: finiteNumber(source.gustMax, null),
      uvMax: finiteNumber(source.uvMax, null),
      stormPotential: Boolean(source.stormPotential),
      alertTone: cleanToken(source.alertTone, 32),
      alertEvent: cleanText(source.alertEvent, 120)
    };
  }).filter((day) => day.date);
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

function avgNumber(values) {
  const numbers = (values || []).map(Number).filter(Number.isFinite);
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function roundNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function numberDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}

function scoreBand(score) {
  if (score >= 65) return "good";
  if (score >= 45) return "iffy";
  return "poor";
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

function capitalizeWord(value) {
  const text = cleanText(value, 40);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
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

function boundedInteger(value, fallback, min, max) {
  const number = nonNegativeInteger(value, fallback);
  return Math.max(min, Math.min(max, number));
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
