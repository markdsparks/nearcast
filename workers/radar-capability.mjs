import {
  buildRadarGenerationPlan,
  handleRadarGenerationMessage,
  handleRadarGenerationQueue
} from "./radar-generation-consumer.mjs";
import "../weather-truth.js";

const {
  planWeatherWatchCurrentState: sharedPlanWeatherWatchCurrentState,
  planWeatherWatchStateChange: sharedPlanWeatherWatchStateChange,
  planWeatherLastKnownFromState: sharedPlanWeatherLastKnownFromState,
  planWeatherNotificationCandidate: sharedPlanWeatherNotificationCandidate,
  planWatchNotificationTargetUrl: sharedPlanWatchNotificationTargetUrl
} = globalThis.NearcastWeatherTruth || {};

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
const PLAN_WATCH_HEALTH_ENDPOINT_PATH = "/api/watch/notifications/health";
const PRODUCT_EVENTS_ENDPOINT_PATH = "/api/product/events";
const LIVE_ACTIVITY_REGISTER_ENDPOINT_PATH = "/api/live-activities/register";
const LIVE_ACTIVITY_END_ENDPOINT_PATH = "/api/live-activities/end";
const XWEATHER_CONFIG_ENDPOINT_PATH = "/api/xweather/config";
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
const PLAN_WATCH_URGENT_EVALUATOR_LIMIT_ENV = "PLAN_WATCH_URGENT_EVALUATOR_LIMIT";
const PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS_ENV = "PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS";
const PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION_ENV = "PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION";
const PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION_ENV = "PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION";
const PLAN_WATCH_APNS_TEAM_ID_ENV = "PLAN_WATCH_APNS_TEAM_ID";
const PLAN_WATCH_APNS_KEY_ID_ENV = "PLAN_WATCH_APNS_KEY_ID";
const PLAN_WATCH_APNS_PRIVATE_KEY_ENV = "PLAN_WATCH_APNS_PRIVATE_KEY";
const PLAN_WATCH_APNS_BUNDLE_ID_ENV = "PLAN_WATCH_APNS_BUNDLE_ID";
const PLAN_WATCH_QUIET_HOURS_START_ENV = "PLAN_WATCH_QUIET_HOURS_START";
const PLAN_WATCH_QUIET_HOURS_END_ENV = "PLAN_WATCH_QUIET_HOURS_END";
const PLAN_WATCH_QUIET_HOURS_BYPASS_PRIORITY_ENV = "PLAN_WATCH_QUIET_HOURS_BYPASS_PRIORITY";
const PLAN_WATCH_DELIVERY_RETRY_ATTEMPTS_ENV = "PLAN_WATCH_DELIVERY_RETRY_ATTEMPTS";
const PLAN_WATCH_DELIVERY_RETRY_BASE_MS_ENV = "PLAN_WATCH_DELIVERY_RETRY_BASE_MS";
const PLAN_WATCH_DELIVERY_TIMEOUT_MS_ENV = "PLAN_WATCH_DELIVERY_TIMEOUT_MS";
const PLAN_WATCH_HEALTH_MAX_AGE_MINUTES_ENV = "PLAN_WATCH_HEALTH_MAX_AGE_MINUTES";
const PLAN_WATCH_REGISTRATION_RATE_SALT_ENV = "PLAN_WATCH_REGISTRATION_RATE_SALT";
const PLAN_WATCH_REQUIRED_DELIVERY_CHANNELS_ENV = "PLAN_WATCH_REQUIRED_DELIVERY_CHANNELS";
const XWEATHER_CLIENT_ID_ENV = "XWEATHER_CLIENT_ID";
const XWEATHER_CLIENT_SECRET_ENV = "XWEATHER_CLIENT_SECRET";
const XWEATHER_LAYER_CODES_ENV = "XWEATHER_LAYER_CODES";
const XWEATHER_STORM_MODE_ENV = "XWEATHER_STORM_MODE";
const XWEATHER_MIN_VIEWPORT_ZOOM_ENV = "XWEATHER_MIN_VIEWPORT_ZOOM";
const XWEATHER_REQUIRE_ACTIVE_WEATHER_ENV = "XWEATHER_REQUIRE_ACTIVE_WEATHER";
const XWEATHER_MONTHLY_ACCESS_LIMIT_ENV = "XWEATHER_MONTHLY_ACCESS_LIMIT";
const XWEATHER_LOCAL_MONTHLY_ACCESS_LIMIT_ENV = "XWEATHER_LOCAL_MONTHLY_ACCESS_LIMIT";
const XWEATHER_PROVIDER_MIN_REMAINING_ENV = "XWEATHER_PROVIDER_MIN_REMAINING";
const XWEATHER_SESSION_ACCESS_COST_ENV = "XWEATHER_SESSION_ACCESS_COST";
const XWEATHER_BYPASS_BUDGET_CHECKS_ENV = "XWEATHER_BYPASS_BUDGET_CHECKS";
const XWEATHER_USAGE_PROBE_URL_ENV = "XWEATHER_USAGE_PROBE_URL";
const XWEATHER_USAGE_PROBE_CACHE_SECONDS_ENV = "XWEATHER_USAGE_PROBE_CACHE_SECONDS";
const DEFAULT_XWEATHER_LAYER_CODES = "radar,lightning-strikes-icons";
const DEFAULT_XWEATHER_STORM_MODE = "beta";
const DEFAULT_XWEATHER_MIN_VIEWPORT_ZOOM = 7.5;
const DEFAULT_XWEATHER_MONTHLY_ACCESS_LIMIT = 15000;
const DEFAULT_XWEATHER_LOCAL_MONTHLY_ACCESS_LIMIT = 1500;
const DEFAULT_XWEATHER_PROVIDER_MIN_REMAINING = 1800;
const DEFAULT_XWEATHER_SESSION_ACCESS_COST = 150;
const DEFAULT_XWEATHER_USAGE_PROBE_CACHE_SECONDS = 10 * 60;
const XWEATHER_STORM_SESSION_SECONDS = 5 * 60;
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
const DEFAULT_PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS = 0;
const DEFAULT_PLAN_WATCH_MAX_PLANS_PER_SUBSCRIPTION = 3;
const DEFAULT_PLAN_WATCH_MAX_PLACES_PER_SUBSCRIPTION = 3;
const PLAN_WATCH_SUBSCRIPTION_TTL_DAYS = 45;
const PLAN_WATCH_PUSH_TTL_SECONDS = 30 * 60;
const PLAN_WATCH_PENDING_TTL_SECONDS = 2 * 60 * 60;
const PLAN_WATCH_REGISTRATION_CAP_CACHE_SECONDS = 10 * 60;
const DEFAULT_PLAN_WATCH_EVALUATOR_LIMIT = 5;
const PLAN_WATCH_EVALUATOR_HARD_LIMIT = 25;
const DEFAULT_PLAN_WATCH_URGENT_EVALUATOR_LIMIT = 8;
const PLAN_WATCH_SCAN_PAGE_HARD_LIMIT = 100;
const PLAN_WATCH_FORECAST_TIMEOUT_MS = 5500;
const PLAN_WATCH_ALERT_TIMEOUT_MS = 3500;
const PLAN_WATCH_NWS_USER_AGENT = "Nearcast/3.0 (+https://getnearcast.app)";
const DEFAULT_PLAN_WATCH_QUIET_HOURS_START = 22;
const DEFAULT_PLAN_WATCH_QUIET_HOURS_END = 7;
const DEFAULT_PLAN_WATCH_QUIET_HOURS_BYPASS_PRIORITY = 135;
const DEFAULT_PLAN_WATCH_DELIVERY_RETRY_ATTEMPTS = 3;
const DEFAULT_PLAN_WATCH_DELIVERY_RETRY_BASE_MS = 250;
const DEFAULT_PLAN_WATCH_DELIVERY_TIMEOUT_MS = 5000;
const PLAN_WATCH_DELIVERY_RETRY_MAX_DELAY_MS = 2500;
const PLAN_WATCH_DELIVERY_DEDUPE_SECONDS = 24 * 60 * 60;
const DEFAULT_PLAN_WATCH_HEALTH_MAX_AGE_MINUTES = 75;
const PLAN_WATCH_URGENT_HEALTH_MAX_AGE_MINUTES = 15;
const PLAN_WATCH_STANDARD_BACKLOG_SLA_MINUTES = 90;
const PLAN_WATCH_URGENT_BACKLOG_SLA_MINUTES = 45;
const PRODUCT_EVENTS_MAX_BODY_BYTES = 8 * 1024;
const PRODUCT_EVENTS_MAX_BATCH = 20;
const PRODUCT_EVENTS_MAX_COUNT = 20;
const PRODUCT_EVENTS_MAX_TOTAL_COUNT = 100;
const PRODUCT_EVENT_NAMES = new Set([
  "best-dry", "best-walk", "best-dinner", "best-patio", "plan", "launch-summary",
  "memory-open", "memory-show", "memory-edit", "plan-invite-shown", "plan-invite-open",
  "plan-invite-dismiss", "plan-template", "plan-check-started", "plan-check-confirmed",
  "plan-check-completed", "plan-watched", "watching-open", "notification-opt-in",
  "notification-registration-ready", "notification-registration-failed", "notification-open",
  "watch-change-reviewed"
]);
const PRODUCT_EVENT_PLATFORMS = new Set(["web", "pwa", "ios", "ipados", "watchos"]);
const PLAN_WATCH_REGISTRATION_WINDOW_SECONDS = 60;
const PLAN_WATCH_REGISTRATION_CLIENT_LIMIT = 6;
const PLAN_WATCH_REGISTRATION_GLOBAL_LIMIT = 300;
const PRODUCT_EVENTS_CLIENT_RATE_LIMIT = 60;
const PRODUCT_EVENTS_GLOBAL_RATE_LIMIT = 2000;
const WEB_PUSH_PROVIDER_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com"
]);
const WEB_PUSH_PROVIDER_HOST_SUFFIXES = [
  ".push.apple.com",
  ".notify.windows.com"
];
const LIVE_ACTIVITY_TTL_SECONDS = 3 * 60 * 60;
const LIVE_ACTIVITY_SCAN_LIMIT = 40;

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
    if (url.pathname === PLAN_WATCH_HEALTH_ENDPOINT_PATH) {
      return handlePlanWatchNotificationHealthRequest(request, env);
    }
    if (url.pathname === PRODUCT_EVENTS_ENDPOINT_PATH) {
      return handleProductEventsRequest(request, env);
    }
    if (url.pathname === LIVE_ACTIVITY_REGISTER_ENDPOINT_PATH) {
      return handleLiveActivityRegisterRequest(request, env);
    }
    if (url.pathname === LIVE_ACTIVITY_END_ENDPOINT_PATH) {
      return handleLiveActivityEndRequest(request, env);
    }
    if (url.pathname === XWEATHER_CONFIG_ENDPOINT_PATH) {
      return handleXweatherConfigRequest(request, env);
    }
    if (env?.ASSETS?.fetch) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
  async queue(batch, env = {}, ctx = {}) {
    return handleRadarGenerationQueue(batch, env, ctx);
  },
  async scheduled(event, env = {}, ctx = {}) {
    ctx.waitUntil(evaluateLiveActivities(env, { reason: "scheduled" }));
    if (planWatchScheduledEvaluatorEnabled(env)) {
      ctx.waitUntil(runScheduledPlanWatchEvaluations(env, {
        includeStandard: true
      }));
    }
  }
};

export async function handleLiveActivityRegisterRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  const store = planWatchStore(env);
  if (!store?.putJson) return jsonResponse({ error: "store-unavailable" }, { status: 503 });
  const payload = await readJsonRequest(request);
  const record = normalizeLiveActivityRecord(payload);
  if (!record) return jsonResponse({ error: "invalid-live-activity" }, { status: 400 });
  await store.putJson(liveActivityStorageName(record.activityId), record);
  return jsonResponse({ ok: true, state: "registered", activityId: record.activityId, expiresAt: record.expiresAt });
}

export async function handleLiveActivityEndRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  const store = planWatchStore(env);
  const payload = await readJsonRequest(request);
  const activityId = cleanToken(payload?.activityId, 160);
  if (activityId && store?.deleteJson) await store.deleteJson(liveActivityStorageName(activityId));
  return jsonResponse({ ok: true, state: "ended" });
}

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
      state: publicKey && privateKey ? "ready" : publicKey ? "missing-vapid-private-key" : "missing-vapid-key",
      vapidPublicKey: publicKey,
      registerUrl: PLAN_WATCH_REGISTER_ENDPOINT_PATH,
      unregisterUrl: PLAN_WATCH_UNREGISTER_ENDPOINT_PATH,
      pendingUrl: PLAN_WATCH_PENDING_ENDPOINT_PATH,
      healthUrl: PLAN_WATCH_HEALTH_ENDPOINT_PATH
    },
    delivery: {
      state: publicKey && privateKey ? "ready" : publicKey ? "missing-vapid-private-key" : "missing-vapid-key",
      subject: configuredPlanWatchVapidSubject(env)
    },
    nativePush: {
      state: planWatchApnsConfigured(env) ? "ready" : "missing-apns-config",
      bundleId: configuredPlanWatchApnsBundleId(env)
    },
    storage: {
      state: store ? "ready" : "unavailable",
      kind: store?.kind || ""
    },
    limits: {
      mode: configuredPlanWatchEvaluatorMode(env),
      maxActiveSubscriptions: configuredPlanWatchMaxActiveSubscriptions(env) || null,
      maxPlansPerSubscription: configuredPlanWatchMaxPlansPerSubscription(env),
      maxPlacesPerSubscription: configuredPlanWatchMaxPlacesPerSubscription(env),
      scheduledEvaluationLimit: configuredPlanWatchEvaluatorLimit(env),
      urgentEvaluationLimit: configuredPlanWatchUrgentEvaluatorLimit(env),
      standardCadenceMinutes: 5,
      urgentCadenceMinutes: 5,
      backlogSlaMinutes: {
        standard: PLAN_WATCH_STANDARD_BACKLOG_SLA_MINUTES,
        urgent: PLAN_WATCH_URGENT_BACKLOG_SLA_MINUTES
      },
      quietHours: configuredPlanWatchQuietHours(env),
      requiredDeliveryChannels: configuredPlanWatchRequiredDeliveryChannels(env)
    }
  });
}

export async function handleProductEventsRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method-not-allowed" }, { status: 405 });
  }
  if (request.headers.get("Sec-GPC") === "1" || request.headers.get("DNT") === "1") {
    return jsonResponse({}, { status: 204 });
  }
  if (!productEventsSameOrigin(request)) {
    return jsonResponse({ ok: false, error: "origin-not-allowed" }, { status: 403 });
  }
  const admission = await productEventsAdmission(request, env);
  if (!admission.allowed) {
    return jsonResponse({ ok: false, error: admission.reason }, {
      status: admission.state === "rate-limited" ? 429 : 503,
      headers: admission.retryAfterSeconds ? { "Retry-After": String(admission.retryAfterSeconds) } : {}
    });
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > PRODUCT_EVENTS_MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "payload-too-large" }, { status: 413 });
  }
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return jsonResponse({ ok: false, error: "invalid-json" }, { status: 400 });
  }
  if (!raw || new TextEncoder().encode(raw).byteLength > PRODUCT_EVENTS_MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: raw ? "payload-too-large" : "invalid-json" }, {
      status: raw ? 413 : 400
    });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: "invalid-json" }, { status: 400 });
  }
  const normalized = normalizeProductEventsPayload(payload);
  if (!normalized.ok) {
    return jsonResponse({ ok: false, error: normalized.error }, { status: 400 });
  }
  const analytics = env?.PRODUCT_ANALYTICS;
  if (!analytics || typeof analytics.writeDataPoint !== "function") {
    return jsonResponse({ ok: false, error: "analytics-unavailable" }, { status: 503 });
  }
  try {
    for (const event of normalized.events) {
      analytics.writeDataPoint({
        blobs: [event.name, normalized.platform, normalized.version],
        doubles: [event.count],
        indexes: [event.name]
      });
    }
  } catch {
    return jsonResponse({ ok: false, error: "analytics-write-failed" }, { status: 503 });
  }
  return jsonResponse({
    ok: true,
    state: "accepted",
    acceptedEvents: normalized.events.length,
    acceptedCount: normalized.events.reduce((sum, event) => sum + event.count, 0)
  }, { status: 202 });
}

function productEventsSameOrigin(request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = String(request.headers.get("Origin") || "").trim();
  const referer = String(request.headers.get("Referer") || "").trim();
  if (!origin && !referer) return false;
  if (origin) {
    if (origin === "null") return false;
    try {
      if (new URL(origin).origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }
  if (referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function normalizeProductEventsPayload(payload) {
  if (!plainObjectWithOnlyKeys(payload, ["events", "platform", "version"])) {
    return { ok: false, error: "invalid-payload-shape" };
  }
  const platform = String(payload.platform || "").trim().toLowerCase();
  const version = String(payload.version || "").trim();
  if (!PRODUCT_EVENT_PLATFORMS.has(platform)) return { ok: false, error: "invalid-platform" };
  if (!/^\d{1,4}(?:\.\d{1,4}){1,3}$/.test(version)) return { ok: false, error: "invalid-version" };
  if (!Array.isArray(payload.events) || !payload.events.length || payload.events.length > PRODUCT_EVENTS_MAX_BATCH) {
    return { ok: false, error: "invalid-events" };
  }
  const events = [];
  let total = 0;
  for (const item of payload.events) {
    if (!plainObjectWithOnlyKeys(item, ["name", "count"])) return { ok: false, error: "invalid-event-shape" };
    const name = String(item.name || "").trim();
    const count = Number(item.count);
    if (!PRODUCT_EVENT_NAMES.has(name)) return { ok: false, error: "event-not-allowed" };
    if (!Number.isInteger(count) || count < 1 || count > PRODUCT_EVENTS_MAX_COUNT) {
      return { ok: false, error: "invalid-event-count" };
    }
    total += count;
    if (total > PRODUCT_EVENTS_MAX_TOTAL_COUNT) return { ok: false, error: "event-count-too-large" };
    events.push({ name, count });
  }
  return { ok: true, platform, version, events };
}

function plainObjectWithOnlyKeys(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export async function handlePlanWatchNotificationHealthRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "method-not-allowed" }, { status: 405 });
  }
  const auth = planWatchTestAuthorization(request, env);
  if (!auth.available) return jsonResponse({ ok: false, error: "health-disabled" }, { status: 404 });
  if (!auth.authorized) return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });

  const store = planWatchStore(env);
  const mode = configuredPlanWatchEvaluatorMode(env);
  const webPushReady = Boolean(configuredPlanWatchVapidPublicKey(env) && configuredPlanWatchVapidPrivateKey(env));
  const nativePushReady = planWatchApnsConfigured(env);
  const requiredChannels = configuredPlanWatchRequiredDeliveryChannels(env);
  const standard = store?.getJson ? await store.getJson(planWatchHealthStorageName("standard")) : null;
  const urgent = store?.getJson ? await store.getJson(planWatchHealthStorageName("urgent")) : null;
  const now = Date.now();
  const standardMaxAgeMs = configuredPlanWatchHealthMaxAgeMinutes(env) * 60 * 1000;
  const urgentMaxAgeMs = PLAN_WATCH_URGENT_HEALTH_MAX_AGE_MINUTES * 60 * 1000;
  const standardFresh = planWatchHealthFresh(standard, standardMaxAgeMs, now);
  const urgentFresh = planWatchHealthFresh(urgent, urgentMaxAgeMs, now);
  const standardBacklogReady = planWatchBacklogWithinSla(standard, PLAN_WATCH_STANDARD_BACKLOG_SLA_MINUTES);
  const urgentBacklogReady = planWatchBacklogWithinSla(urgent, PLAN_WATCH_URGENT_BACKLOG_SLA_MINUTES);
  const checks = {
    evaluator: planWatchScheduledEvaluatorEnabled(env),
    storage: Boolean(store?.getJson && store?.putJson && store?.listPage),
    delivery: requiredChannels.every((channel) => channel === "web-push" ? webPushReady : nativePushReady),
    standardSchedule: standardFresh && standard?.ok === true,
    urgentSchedule: urgentFresh && urgent?.ok === true,
    standardBacklog: standardBacklogReady,
    urgentBacklog: urgentBacklogReady
  };
  const ok = Object.values(checks).every(Boolean);
  const state = ok ? "healthy" : (checks.storage && checks.evaluator ? "degraded" : "unhealthy");
  return jsonResponse({
    ok,
    provider: `${PLAN_WATCH_PROVIDER}-health`,
    version: 1,
    state,
    checkedAt: new Date(now).toISOString(),
    mode,
    checks,
    delivery: {
      required: requiredChannels,
      webPush: webPushReady ? "ready" : "unavailable",
      nativePush: nativePushReady ? "ready" : "unavailable"
    },
    evaluator: {
      backlogSlaMinutes: {
        standard: PLAN_WATCH_STANDARD_BACKLOG_SLA_MINUTES,
        urgent: PLAN_WATCH_URGENT_BACKLOG_SLA_MINUTES
      },
      standard: sanitizePlanWatchHealthSummary(standard),
      urgent: sanitizePlanWatchHealthSummary(urgent)
    }
  }, { status: ok ? 200 : 503 });
}

export async function handleXweatherConfigRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const payload = request.method === "POST" ? await readJsonRequest(request) : {};
  const clientId = configuredXweatherClientId(env);
  const clientSecret = configuredXweatherClientSecret(env);
  const requestedAt = Date.now();
  let gate;
  try {
    gate = await xweatherStormGate(payload, request, env, requestedAt);
  } catch {
    gate = {
      allowed: false,
      state: "error",
      reason: "storm-view-config-failed",
      message: "StormScope is temporarily unavailable.",
      limits: xweatherStormLimits(env),
      usage: null,
      lease: null,
      context: normalizeXweatherStormContext(payload, normalizeViewport(payload.viewport || {}), requestedAt)
    };
  }
  const ready = Boolean(clientId && clientSecret && gate.allowed);
  return jsonResponse({
    provider: "nearcast-xweather-config",
    version: 1,
    checkedAt: new Date().toISOString(),
    state: ready ? "ready" : gate.state,
    reason: ready ? (gate.reason || "lease-granted") : gate.reason,
    message: ready ? "" : gate.message,
    credentials: ready ? { clientId, clientSecret } : null,
    layerCodes: configuredXweatherLayerCodes(env),
    lease: ready ? gate.lease : null,
    limits: gate.limits,
    usage: gate.usage,
    context: gate.context
  });
}

export async function handlePlanWatchNotificationRegisterRequest(request, env = {}) {
  if (request.method === "OPTIONS") return jsonResponse({}, { status: 204 });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method-not-allowed" }, { status: 405 });
  }
  const payload = await readJsonRequest(request);
  const subscription = normalizeWebPushSubscription(payload.subscription);
  const nativeChannel = normalizeNativeApnsChannel(payload.nativeChannel || payload.channel, env);
  if (!subscription && !nativeChannel) {
    return jsonResponse({ ok: false, error: "invalid-delivery-channel" }, { status: 400 });
  }
  const normalizedPlans = normalizePlanWatchPlans(payload.plans, env);
  const normalizedPlaces = normalizePlanWatchPlaces(payload.places, env);
  if (!normalizedPlans.length && !normalizedPlaces.length) {
    return jsonResponse({ ok: false, error: "missing-watch-target" }, { status: 400 });
  }
  const normalizedClient = normalizePlanWatchClient(payload.client);
  if (!normalizedClient.timezone) {
    return jsonResponse({ ok: false, error: "invalid-client-timezone" }, { status: 400 });
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

  const subscriptionId = subscription
    ? await planWatchSubscriptionId(subscription)
    : await planWatchNativeSubscriptionId(nativeChannel);
  const existingRecord = store.getJson
    ? await store.getJson(planWatchSubscriptionStorageName(subscriptionId))
    : null;
  if (!planWatchRecordHasDeliveryChannel(existingRecord)) {
    const admission = await planWatchRegistrationAdmission(request, store, env);
    if (!admission.allowed) {
      return jsonResponse({
        ok: false,
        provider: PLAN_WATCH_PROVIDER,
        state: admission.state,
        reason: admission.reason,
        retryAfterSeconds: admission.retryAfterSeconds
      }, {
        status: admission.state === "rate-limited" ? 429 : 503,
        headers: admission.retryAfterSeconds ? { "Retry-After": String(admission.retryAfterSeconds) } : {}
      });
    }
  }
  if (!planWatchRecordHasDeliveryChannel(existingRecord) && configuredPlanWatchMaxActiveSubscriptions(env) > 0) {
    const capMarker = await planWatchRegistrationCapMarker(store);
    if (capMarker.full) {
      return jsonResponse({
        ok: false,
        provider: PLAN_WATCH_PROVIDER,
        state: "capacity-reached",
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
        state: "capacity-reached",
        reason: "plan-watch-registration-limit",
        subscriptionId,
        activeSubscriptions: capacity.activeSubscriptions,
        maxActiveSubscriptions: capacity.maxActiveSubscriptions
      }, { status: 429 });
    }
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_WATCH_SUBSCRIPTION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const client = normalizedClient;
  const clientUnitChanged = Boolean(
    existingRecord?.client?.unit &&
    client?.unit &&
    existingRecord.client.unit !== client.unit
  );
  const record = {
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    subscriptionId,
    platform: normalizePlatform(payload.platform),
    client,
    subscription,
    nativeChannel,
    plans: mergePlanWatchPlansWithExisting(
      normalizedPlans,
      existingRecord?.plans,
      { resetBaseline: clientUnitChanged }
    ),
    places: mergePlanWatchPlacesWithExisting(
      normalizedPlaces,
      existingRecord?.places
    ),
    registeredAt: existingRecord?.registeredAt || now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt
  };
  await store.putJson(planWatchSubscriptionStorageName(subscriptionId), record);
  if (store.deleteJson && planWatchRecordHasDeliveryChannel(existingRecord)) {
    await store.deleteJson(planWatchRegistrationCapStorageName());
  }
  const webDeliveryReady = !subscription || Boolean(
    configuredPlanWatchVapidPublicKey(env) && configuredPlanWatchVapidPrivateKey(env)
  );
  const nativeDeliveryReady = !nativeChannel || planWatchApnsConfigured(env);
  const deliveryReady = webDeliveryReady && nativeDeliveryReady;
  return jsonResponse({
    ok: deliveryReady,
    provider: PLAN_WATCH_PROVIDER,
    state: deliveryReady
      ? "stored"
      : nativeDeliveryReady ? "stored-web-delivery-not-configured" : "stored-native-delivery-not-configured",
    reason: deliveryReady ? "" : nativeDeliveryReady ? "web-push-not-configured" : "native-push-not-configured",
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
  const nativeChannel = normalizeNativeApnsChannel(payload.nativeChannel || payload.channel);
  const subscriptionId = String(
    payload.subscriptionId ||
    (subscription ? await planWatchSubscriptionId(subscription) : "") ||
    (nativeChannel ? await planWatchNativeSubscriptionId(nativeChannel) : "")
  ).trim();
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
  if (!cleanText(payload.subscriptionId, 120) && !payload.subscription && !payload.nativeChannel && !payload.channel) {
    return jsonResponse({ ok: false, error: "missing-canary-subscription" }, { status: 400 });
  }
  const store = planWatchStore(env);
  if (!store) {
    return jsonResponse({ ok: false, error: "plan-watch-store-unavailable" }, { status: 503 });
  }
  const record = await resolvePlanWatchSubscriptionRecord(store, payload);
  if (!planWatchRecordHasDeliveryChannel(record)) {
    return jsonResponse({ ok: false, error: "subscription-not-found" }, { status: 404 });
  }

  const notification = normalizePendingPlanWatchNotification(payload.notification || {});
  const push = await sendPlanWatchDelivery(record, notification, store, env);
  if ((push.status === 404 || push.status === 410) && store.deleteJson) {
    await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
  }
  return jsonResponse({
    ok: push.ok,
    provider: PLAN_WATCH_PROVIDER,
    state: push.ok ? "sent" : "send-failed",
    subscriptionId: record.subscriptionId,
    endpointHost: safeUrlHost(record.subscription?.endpoint) || record.nativeChannel?.environment || "",
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
    urgentOnly: Boolean(payload.urgentOnly),
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

function configuredXweatherClientId(env = {}) {
  return String(env?.[XWEATHER_CLIENT_ID_ENV] || "").trim();
}

function configuredXweatherClientSecret(env = {}) {
  return String(env?.[XWEATHER_CLIENT_SECRET_ENV] || "").trim();
}

function configuredXweatherLayerCodes(env = {}) {
  const value = String(env?.[XWEATHER_LAYER_CODES_ENV] || DEFAULT_XWEATHER_LAYER_CODES);
  const codes = value
    .split(/[,\s]+/)
    .map((code) => cleanToken(code, 48).toLowerCase())
    .filter(Boolean)
    .filter((code) => /^[a-z0-9-]+$/.test(code))
    .slice(0, 6);
  return codes.length ? codes : DEFAULT_XWEATHER_LAYER_CODES.split(",");
}

async function xweatherStormGate(payload = {}, request, env = {}, now = Date.now()) {
  const clientId = configuredXweatherClientId(env);
  const clientSecret = configuredXweatherClientSecret(env);
  const limits = xweatherStormLimits(env);
  const mode = configuredXweatherStormMode(env);
  const viewport = normalizeViewport(payload.viewport || {});
  const context = normalizeXweatherStormContext(payload, viewport, now);
  const base = {
    limits,
    context,
    usage: null,
    lease: null
  };
  if (!xweatherStormModeEnabled(mode)) {
    return {
      ...base,
      allowed: false,
      state: "paused",
      reason: "storm-view-disabled",
      message: "StormScope is paused."
    };
  }
  if (!clientId || !clientSecret) {
    return {
      ...base,
      allowed: false,
      state: "missing-credentials",
      reason: "missing-credentials",
      message: "Xweather credentials are not configured on the Nearcast Worker."
    };
  }
  if (!context.hasViewport) {
    return {
      ...base,
      allowed: false,
      state: "needs-context",
      reason: "viewport-required",
      message: "Open the map before starting StormScope."
    };
  }
  if (context.zoom + 0.001 < limits.minZoom) {
    return {
      ...base,
      allowed: false,
      state: "below-min-zoom",
      reason: "below-min-zoom",
      message: `Zoom in to start StormScope.`
    };
  }
  if (limits.requireActiveWeather && !context.activeWeather) {
    return {
      ...base,
      allowed: false,
      state: "no-active-weather",
      reason: "no-active-weather",
      message: "StormScope starts when radar is active nearby."
    };
  }
  if (!context.activationRequested) {
    return {
      ...base,
      allowed: false,
      state: "activation-required",
      reason: "user-activation-required",
      message: "Tap StormScope on the map to start."
    };
  }

  if (limits.bypassBudgetChecks) {
    const bypassUsage = await xweatherBudgetBypassUsageState(payload, request, limits, now);
    return {
      ...base,
      allowed: true,
      state: "ready",
      reason: "budget-bypassed",
      message: "",
      lease: bypassUsage.lease,
      usage: {
        local: bypassUsage,
        provider: {
          provider: "nearcast-xweather-budget-bypass",
          bypassed: true,
          checkedAt: new Date(now).toISOString()
        }
      }
    };
  }

  const store = generationRequestStore(env);
  if (!store?.getJson || !store?.putJson) {
    return {
      ...base,
      allowed: false,
      state: "budget-paused",
      reason: "budget-store-unavailable",
      message: "StormScope is paused until budget tracking is available.",
      usage: {
        local: {
          allowed: false,
          reason: "budget-store-unavailable",
          accesses: 0,
          sessions: 0,
          limit: limits.localMonthlyAccessLimit
        }
      }
    };
  }
  const providerUsage = await xweatherProviderUsageSnapshot(env, store, now);
  if (
    Number.isFinite(providerUsage?.remainingPeriod) &&
    providerUsage.remainingPeriod < limits.providerMinRemaining + limits.sessionAccessCost
  ) {
    return {
      ...base,
      allowed: false,
      state: "provider-budget-paused",
      reason: "provider-remaining-low",
      message: "StormScope is paused to protect the Xweather free tier.",
      usage: {
        provider: providerUsage
      }
    };
  }

  const localUsage = await xweatherLocalUsageState(store, payload, request, limits, now);
  if (!localUsage.allowed) {
    return {
      ...base,
      allowed: false,
      state: "budget-paused",
      reason: localUsage.reason,
      message: "StormScope is paused for this month.",
      usage: {
        local: localUsage,
        provider: providerUsage
      }
    };
  }

  return {
    ...base,
    allowed: true,
    state: "ready",
    reason: localUsage.deduped ? "lease-reused" : "lease-granted",
    message: "",
    lease: localUsage.lease,
    usage: {
      local: localUsage,
      provider: providerUsage
    }
  };
}

function configuredXweatherStormMode(env = {}) {
  return cleanToken(env?.[XWEATHER_STORM_MODE_ENV] || DEFAULT_XWEATHER_STORM_MODE, 24).toLowerCase() || "off";
}

function xweatherStormModeEnabled(mode) {
  return ["1", "true", "on", "yes", "beta", "enabled"].includes(String(mode || "").toLowerCase());
}

function xweatherStormLimits(env = {}) {
  const monthlyAccessLimit = nonNegativeInteger(
    env?.[XWEATHER_MONTHLY_ACCESS_LIMIT_ENV],
    DEFAULT_XWEATHER_MONTHLY_ACCESS_LIMIT
  );
  const localMonthlyAccessLimit = Math.min(
    monthlyAccessLimit,
    nonNegativeInteger(env?.[XWEATHER_LOCAL_MONTHLY_ACCESS_LIMIT_ENV], DEFAULT_XWEATHER_LOCAL_MONTHLY_ACCESS_LIMIT)
  );
  return {
    mode: configuredXweatherStormMode(env),
    minZoom: Math.max(0, finiteNumber(env?.[XWEATHER_MIN_VIEWPORT_ZOOM_ENV], DEFAULT_XWEATHER_MIN_VIEWPORT_ZOOM)),
    requireActiveWeather: env?.[XWEATHER_REQUIRE_ACTIVE_WEATHER_ENV] === undefined
      ? true
      : booleanValue(env?.[XWEATHER_REQUIRE_ACTIVE_WEATHER_ENV]),
    sessionAccessCost: boundedInteger(
      env?.[XWEATHER_SESSION_ACCESS_COST_ENV],
      DEFAULT_XWEATHER_SESSION_ACCESS_COST,
      1,
      1000
    ),
    monthlyAccessLimit,
    localMonthlyAccessLimit,
    providerMinRemaining: nonNegativeInteger(
      env?.[XWEATHER_PROVIDER_MIN_REMAINING_ENV],
      DEFAULT_XWEATHER_PROVIDER_MIN_REMAINING
    ),
    usageProbeCacheSeconds: boundedInteger(
      env?.[XWEATHER_USAGE_PROBE_CACHE_SECONDS_ENV],
      DEFAULT_XWEATHER_USAGE_PROBE_CACHE_SECONDS,
      60,
      60 * 60
    ),
    usageProbeConfigured: Boolean(configuredXweatherUsageProbeUrl(env)),
    bypassBudgetChecks: booleanValue(env?.[XWEATHER_BYPASS_BUDGET_CHECKS_ENV])
  };
}

function normalizeXweatherStormContext(payload = {}, viewport = {}, now = Date.now()) {
  const zoom = finiteNumber(viewport.zoom, NaN);
  const hasViewport = Boolean(payload.viewport && typeof payload.viewport === "object" && Number.isFinite(zoom));
  const storm = payload.storm && typeof payload.storm === "object" ? payload.storm : {};
  const client = payload.client && typeof payload.client === "object" ? payload.client : {};
  const activeWeather = booleanValue(storm.activeWeather);
  const key = cleanToken(
    payload.contextKey ||
    viewport.key ||
    `${roundNumber(viewport.center?.latitude, 2) ?? "na"}:${roundNumber(viewport.center?.longitude, 2) ?? "na"}:z${roundNumber(zoom, 1) ?? "na"}`,
    96
  );
  return {
    hasViewport,
    key,
    zoom: Number.isFinite(zoom) ? roundNumber(zoom, 2) : null,
    activeWeather,
    activeWeatherReason: cleanText(storm.activeWeatherReason || "", 80),
    activationRequested: booleanValue(payload.activation?.requested || payload.activate || payload.userActivated),
    activationSource: cleanText(payload.activation?.source || "", 48),
    clientEstimatedAccesses: nonNegativeInteger(client.estimatedAccesses, 0),
    requestedAt: new Date(now).toISOString()
  };
}

async function xweatherProviderUsageSnapshot(env = {}, store = null, now = Date.now()) {
  const probeUrl = configuredXweatherUsageProbeUrl(env);
  if (!probeUrl) return null;
  const cacheSeconds = boundedInteger(
    env?.[XWEATHER_USAGE_PROBE_CACHE_SECONDS_ENV],
    DEFAULT_XWEATHER_USAGE_PROBE_CACHE_SECONDS,
    60,
    60 * 60
  );
  const cacheKey = "xweather-provider-usage:v1:latest";
  if (store?.getJson) {
    const cached = await store.getJson(cacheKey);
    const checkedAt = timestamp(cached?.checkedAt);
    if (checkedAt && now - checkedAt < cacheSeconds * 1000) {
      return { ...cached, cached: true };
    }
  }
  const clientId = configuredXweatherClientId(env);
  const clientSecret = configuredXweatherClientSecret(env);
  let response;
  try {
    response = await fetchWithTimeout(xweatherProbeUrlWithCredentials(probeUrl, clientId, clientSecret), {
      timeoutMs: 2500,
      headers: { Accept: "application/json" }
    });
  } catch (error) {
    return {
      provider: "xweather",
      state: "unavailable",
      reason: "probe-failed",
      message: cleanText(error?.message || "probe failed", 120),
      checkedAt: new Date(now).toISOString()
    };
  }
  const snapshot = {
    provider: "xweather",
    state: response.ok ? "ready" : "unavailable",
    status: response.status,
    limitPeriod: headerNumber(response.headers, "X-RateLimit-Limit-Period"),
    remainingPeriod: headerNumber(response.headers, "X-RateLimit-Remaining-Period"),
    resetPeriod: headerNumber(response.headers, "X-RateLimit-Reset-Period"),
    costTokens: headerNumber(response.headers, "X-Cost-Tokens"),
    checkedAt: new Date(now).toISOString(),
    cached: false
  };
  if (store?.putJson) {
    try {
      await store.putJson(cacheKey, snapshot, { expirationTtl: cacheSeconds + 60 });
    } catch {
      /* Provider headers are an extra guardrail; do not fail closed on storage. */
    }
  }
  return snapshot;
}

function configuredXweatherUsageProbeUrl(env = {}) {
  return String(env?.[XWEATHER_USAGE_PROBE_URL_ENV] || "").trim();
}

function xweatherProbeUrlWithCredentials(url, clientId, clientSecret) {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("client_id")) parsed.searchParams.set("client_id", clientId);
  if (!parsed.searchParams.has("client_secret")) parsed.searchParams.set("client_secret", clientSecret);
  return parsed.toString();
}

function headerNumber(headers, name) {
  const value = headers?.get?.(name);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs || 5000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function xweatherBudgetBypassUsageState(payload = {}, request, limits = xweatherStormLimits(), now = Date.now()) {
  const month = xweatherUsageMonthKey(new Date(now));
  const windowStart = Math.floor(now / (XWEATHER_STORM_SESSION_SECONDS * 1000)) * XWEATHER_STORM_SESSION_SECONDS * 1000;
  const clientKey = await xweatherClientBudgetKey(payload, request);
  const lease = {
    id: await sha256Hex(`xweather-budget-bypass:${month}:${Math.floor(windowStart / 1000)}:${clientKey}`),
    month,
    sessionWindowStart: new Date(windowStart).toISOString(),
    expiresAt: new Date(windowStart + XWEATHER_STORM_SESSION_SECONDS * 1000).toISOString(),
    estimatedAccessCost: limits.sessionAccessCost,
    budgetBypassed: true
  };
  return {
    allowed: true,
    reason: "budget-bypassed",
    month,
    accesses: 0,
    sessions: 0,
    limit: limits.localMonthlyAccessLimit,
    remaining: limits.localMonthlyAccessLimit,
    deduped: false,
    bypassed: true,
    lease
  };
}

async function xweatherLocalUsageState(store, payload = {}, request, limits = xweatherStormLimits(), now = Date.now()) {
  const month = xweatherUsageMonthKey(new Date(now));
  const windowStart = Math.floor(now / (XWEATHER_STORM_SESSION_SECONDS * 1000)) * XWEATHER_STORM_SESSION_SECONDS * 1000;
  const clientKey = await xweatherClientBudgetKey(payload, request);
  const sessionKey = ["xweather-storm-session", "v1", month, Math.floor(windowStart / 1000), clientKey].join(":");
  const budgetKey = ["xweather-storm-budget", "v1", month].join(":");
  const lease = {
    id: await sha256Hex(`${sessionKey}:${month}`),
    month,
    sessionWindowStart: new Date(windowStart).toISOString(),
    expiresAt: new Date(windowStart + XWEATHER_STORM_SESSION_SECONDS * 1000).toISOString(),
    estimatedAccessCost: limits.sessionAccessCost
  };
  if (!store?.getJson || !store?.putJson) {
    return {
      allowed: false,
      state: "budget-paused",
      reason: "budget-store-unavailable",
      month,
      accesses: 0,
      sessions: 0,
      limit: limits.localMonthlyAccessLimit,
      lease
    };
  }
  const existingSession = await store.getJson(sessionKey);
  const budget = await store.getJson(budgetKey);
  const accesses = Math.max(0, Math.floor(finiteNumber(budget?.accesses, 0)));
  const sessions = Math.max(0, Math.floor(finiteNumber(budget?.sessions, 0)));
  if (existingSession?.leaseId) {
    return {
      allowed: true,
      reason: "lease-reused",
      month,
      accesses,
      sessions,
      limit: limits.localMonthlyAccessLimit,
      remaining: Math.max(0, limits.localMonthlyAccessLimit - accesses),
      deduped: true,
      lease: {
        ...lease,
        id: existingSession.leaseId,
        reused: true
      }
    };
  }
  if (accesses + limits.sessionAccessCost > limits.localMonthlyAccessLimit) {
    return {
      allowed: false,
      reason: "local-monthly-budget-exhausted",
      month,
      accesses,
      sessions,
      limit: limits.localMonthlyAccessLimit,
      remaining: Math.max(0, limits.localMonthlyAccessLimit - accesses),
      lease
    };
  }
  const updated = {
    provider: "nearcast-xweather-budget",
    version: 1,
    month,
    accesses: accesses + limits.sessionAccessCost,
    sessions: sessions + 1,
    sessionAccessCost: limits.sessionAccessCost,
    limit: limits.localMonthlyAccessLimit,
    updatedAt: new Date(now).toISOString()
  };
  await store.putJson(budgetKey, updated);
  await store.putJson(sessionKey, {
    provider: "nearcast-xweather-session",
    version: 1,
    month,
    leaseId: lease.id,
    clientKey,
    sessionWindowStart: lease.sessionWindowStart,
    expiresAt: lease.expiresAt,
    accessCost: limits.sessionAccessCost,
    updatedAt: new Date(now).toISOString()
  });
  return {
    allowed: true,
    reason: "lease-granted",
    month,
    accesses: updated.accesses,
    sessions: updated.sessions,
    limit: limits.localMonthlyAccessLimit,
    remaining: Math.max(0, limits.localMonthlyAccessLimit - updated.accesses),
    deduped: false,
    lease
  };
}

async function xweatherClientBudgetKey(payload = {}, request) {
  const client = payload.client && typeof payload.client === "object" ? payload.client : {};
  const id = cleanToken(client.instanceId || client.id || "", 96);
  if (id) return `client:${await sha256Hex(id)}`;
  const ip = request?.headers?.get?.("CF-Connecting-IP") || "";
  const ua = request?.headers?.get?.("User-Agent") || "";
  return `anon:${await sha256Hex(`${ip}:${ua}`)}`;
}

function xweatherUsageMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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

function configuredPlanWatchApnsTeamId(env = {}) {
  return cleanToken(env?.[PLAN_WATCH_APNS_TEAM_ID_ENV], 24);
}

function configuredPlanWatchApnsKeyId(env = {}) {
  return cleanToken(env?.[PLAN_WATCH_APNS_KEY_ID_ENV], 24);
}

function configuredPlanWatchApnsPrivateKey(env = {}) {
  return String(env?.[PLAN_WATCH_APNS_PRIVATE_KEY_ENV] || "").trim();
}

function configuredPlanWatchApnsBundleId(env = {}) {
  return cleanText(env?.[PLAN_WATCH_APNS_BUNDLE_ID_ENV] || "app.nearcast.ios", 120);
}

function planWatchApnsConfigured(env = {}) {
  return Boolean(
    configuredPlanWatchApnsTeamId(env) &&
    configuredPlanWatchApnsKeyId(env) &&
    configuredPlanWatchApnsPrivateKey(env) &&
    configuredPlanWatchApnsBundleId(env)
  );
}

function configuredPlanWatchTestToken(env = {}) {
  return String(env?.[PLAN_WATCH_TEST_TOKEN_ENV] || "").trim();
}

function configuredPlanWatchEvaluatorMode(env = {}) {
  return cleanToken(env?.[PLAN_WATCH_EVALUATOR_MODE_ENV] || "off", 24).toLowerCase() || "off";
}

function planWatchScheduledEvaluatorEnabled(env = {}) {
  return ["production", "on", "enabled", "true"].includes(configuredPlanWatchEvaluatorMode(env));
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

function configuredPlanWatchUrgentEvaluatorLimit(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_URGENT_EVALUATOR_LIMIT_ENV],
    DEFAULT_PLAN_WATCH_URGENT_EVALUATOR_LIMIT,
    1,
    PLAN_WATCH_EVALUATOR_HARD_LIMIT
  );
}

function configuredPlanWatchMaxActiveSubscriptions(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS_ENV],
    DEFAULT_PLAN_WATCH_MAX_ACTIVE_SUBSCRIPTIONS,
    0,
    100000
  );
}

function configuredPlanWatchQuietHours(env = {}) {
  return {
    start: boundedInteger(
      env?.[PLAN_WATCH_QUIET_HOURS_START_ENV],
      DEFAULT_PLAN_WATCH_QUIET_HOURS_START,
      0,
      23
    ),
    end: boundedInteger(
      env?.[PLAN_WATCH_QUIET_HOURS_END_ENV],
      DEFAULT_PLAN_WATCH_QUIET_HOURS_END,
      0,
      23
    ),
    bypassPriority: boundedInteger(
      env?.[PLAN_WATCH_QUIET_HOURS_BYPASS_PRIORITY_ENV],
      DEFAULT_PLAN_WATCH_QUIET_HOURS_BYPASS_PRIORITY,
      1,
      500
    )
  };
}

function configuredPlanWatchDeliveryRetryAttempts(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_DELIVERY_RETRY_ATTEMPTS_ENV],
    DEFAULT_PLAN_WATCH_DELIVERY_RETRY_ATTEMPTS,
    1,
    5
  );
}

function configuredPlanWatchDeliveryRetryBaseMs(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_DELIVERY_RETRY_BASE_MS_ENV],
    DEFAULT_PLAN_WATCH_DELIVERY_RETRY_BASE_MS,
    0,
    2000
  );
}

function configuredPlanWatchDeliveryTimeoutMs(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_DELIVERY_TIMEOUT_MS_ENV],
    DEFAULT_PLAN_WATCH_DELIVERY_TIMEOUT_MS,
    1000,
    15000
  );
}

function configuredPlanWatchHealthMaxAgeMinutes(env = {}) {
  return boundedInteger(
    env?.[PLAN_WATCH_HEALTH_MAX_AGE_MINUTES_ENV],
    DEFAULT_PLAN_WATCH_HEALTH_MAX_AGE_MINUTES,
    15,
    24 * 60
  );
}

function configuredPlanWatchRequiredDeliveryChannels(env = {}) {
  const values = String(env?.[PLAN_WATCH_REQUIRED_DELIVERY_CHANNELS_ENV] || "web-push,apns")
    .split(/[\s,]+/)
    .map((value) => cleanToken(value, 24).toLowerCase())
    .filter((value) => value === "web-push" || value === "apns");
  return [...new Set(values.length ? values : ["web-push", "apns"])];
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

async function planWatchRegistrationAdmission(request, store, env = {}) {
  return edgeRateAdmission(request, store, env, {
    scope: "plan-watch-register",
    clientBinding: env?.PLAN_WATCH_REGISTRATION_RATE_LIMITER,
    globalBinding: env?.PLAN_WATCH_REGISTRATION_GLOBAL_RATE_LIMITER,
    clientLimit: PLAN_WATCH_REGISTRATION_CLIENT_LIMIT,
    globalLimit: PLAN_WATCH_REGISTRATION_GLOBAL_LIMIT
  });
}

async function productEventsAdmission(request, env = {}) {
  return edgeRateAdmission(request, planWatchStore(env), env, {
    scope: "product-events",
    clientBinding: env?.PRODUCT_EVENTS_RATE_LIMITER,
    globalBinding: env?.PRODUCT_EVENTS_GLOBAL_RATE_LIMITER,
    clientLimit: PRODUCT_EVENTS_CLIENT_RATE_LIMIT,
    globalLimit: PRODUCT_EVENTS_GLOBAL_RATE_LIMIT
  });
}

async function edgeRateAdmission(request, _store, env, options) {
  const clientKey = await edgeRateClientKey(request, env, options.scope);
  if (!clientKey) {
    return { allowed: false, state: "unavailable", reason: "rate-limit-identity-unavailable" };
  }
  if (!options.clientBinding?.limit || !options.globalBinding?.limit) {
    return { allowed: false, state: "unavailable", reason: "rate-limit-binding-unavailable" };
  }
  try {
    const [client, global] = await Promise.all([
      options.clientBinding.limit({ key: clientKey }),
      options.globalBinding.limit({ key: "global" })
    ]);
    if (client?.success && global?.success) return { allowed: true, state: "allowed", source: "edge" };
    return {
      allowed: false,
      state: "rate-limited",
      reason: client?.success ? "global-rate-limit" : "client-rate-limit",
      retryAfterSeconds: PLAN_WATCH_REGISTRATION_WINDOW_SECONDS
    };
  } catch {
    return { allowed: false, state: "unavailable", reason: "rate-limit-binding-failed" };
  }
}

async function edgeRateClientKey(request, env = {}, scope = "edge") {
  const salt = String(
    env?.[PLAN_WATCH_REGISTRATION_RATE_SALT_ENV] ||
    configuredPlanWatchTestToken(env) ||
    configuredPlanWatchApnsPrivateKey(env) ||
    JSON.stringify(configuredPlanWatchVapidPrivateKey(env) || "")
  ).trim();
  if (!salt) return "";
  const forwarded = String(request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
  const address = String(request.headers.get("CF-Connecting-IP") || forwarded || "").trim();
  const fallback = cleanText(request.headers.get("User-Agent") || "unknown-client", 160);
  return (await sha256Hex(`${scope}:${salt}:${address || fallback}`)).slice(0, 32);
}

async function planWatchRegistrationCapacity(store, subscriptionId, env = {}) {
  const maxActiveSubscriptions = configuredPlanWatchMaxActiveSubscriptions(env);
  if (maxActiveSubscriptions <= 0) {
    return { allowed: true, activeSubscriptions: null, maxActiveSubscriptions: null };
  }
  if (!store?.listPage || !store?.getJson) {
    return { allowed: true, activeSubscriptions: null, maxActiveSubscriptions };
  }
  let activeSubscriptions = 0;
  let cursor = "";
  do {
    const page = await store.listPage(
      "subscriptions/",
      Math.min(1000, Math.max(50, maxActiveSubscriptions - activeSubscriptions + 1)),
      cursor
    );
    for (const name of page.names) {
      const record = await store.getJson(name);
      if (!planWatchRecordHasDeliveryChannel(record)) continue;
      if (planWatchSubscriptionExpired(record)) {
        if (store.deleteJson && record.subscriptionId) {
          await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
        }
        continue;
      }
      if (record.subscriptionId === subscriptionId) continue;
      activeSubscriptions += 1;
      if (activeSubscriptions >= maxActiveSubscriptions) break;
    }
    if (activeSubscriptions >= maxActiveSubscriptions || !page.truncated || !page.cursor) break;
    cursor = page.cursor;
  } while (cursor);
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
      const page = await this.listPage(namePrefix, limit);
      return page.names;
    },
    async listPage(namePrefix = "", limit = 25, cursor = "") {
      if (!bucket.list) return { names: [], cursor: "", truncated: false };
      const listPrefix = storageKey(namePrefix);
      const result = await bucket.list({ prefix: listPrefix, limit, ...(cursor ? { cursor } : {}) });
      const stripPrefix = prefix ? `${prefix}/` : "";
      const names = (result?.objects || [])
        .map((object) => String(object?.key || ""))
        .filter(Boolean)
        .map((key) => key.startsWith(stripPrefix) ? key.slice(stripPrefix.length) : key);
      return {
        names,
        cursor: result?.truncated ? String(result.cursor || "") : "",
        truncated: Boolean(result?.truncated)
      };
    }
  };
}

function liveActivityStorageName(activityId) {
  return `live-activities/${cleanStorageName(activityId)}.json`;
}

function normalizeLiveActivityRecord(payload = {}) {
  const activityId = cleanToken(payload.activityId, 160);
  const token = cleanToken(payload.token, 260).toLowerCase();
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!activityId || !/^[a-f0-9]{32,260}$/.test(token)) return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const now = Date.now();
  const requestedExpiry = Number(payload.expiresAtEpoch) * 1000;
  const expiresAtMs = Math.min(
    now + LIVE_ACTIVITY_TTL_SECONDS * 1000,
    Number.isFinite(requestedExpiry) && requestedExpiry > now ? requestedExpiry : now + 90 * 60 * 1000
  );
  return {
    provider: "nearcast-live-activity",
    version: 1,
    activityId,
    token,
    environment: cleanToken(payload.environment, 24) === "development" ? "development" : "production",
    bundleId: cleanText(payload.bundleId || "app.nearcast.ios", 120),
    place: {
      name: cleanText(payload.placeName || "Saved place", 80),
      latitude,
      longitude
    },
    stormName: cleanText(payload.stormName || "Storm Watch", 42),
    status: cleanText(payload.status || "Storm nearby", 48),
    detail: cleanText(payload.detail || "Nearcast is tracking incoming weather.", 86),
    confidence: cleanText(payload.confidence || "Watching", 24),
    confidenceValue: finiteNumber(payload.confidenceValue, null),
    severity: finiteNumber(payload.severity, null),
    rainChance: finiteNumber(payload.rainChance, null),
    motionDegrees: finiteNumber(payload.motionDegrees, null),
    geometryQuality: cleanToken(payload.geometryQuality || "forecast", 18),
    url: cleanText(payload.url || "nearcast://weather?source=live-activity", 400),
    arrivalAtEpoch: finiteNumber(payload.arrivalAtEpoch, null),
    missedChecks: 0,
    registeredAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export async function evaluateLiveActivities(env = {}, options = {}) {
  const store = planWatchStore(env);
  if (!store?.listNames || !store?.getJson || !store?.putJson) return { ok: false, state: "store-unavailable" };
  const names = await store.listNames("live-activities/", LIVE_ACTIVITY_SCAN_LIMIT);
  const summary = { ok: true, state: "evaluated", reason: options.reason || "", records: names.length, updated: 0, ended: 0, failed: 0 };
  const forecastCache = new Map();
  for (const name of names) {
    const record = await store.getJson(name);
    if (!record?.activityId || !record?.token) continue;
    try {
      const result = await evaluateLiveActivity(record, env, forecastCache);
      if (result.event === "end" || result.delete) {
        await store.deleteJson(name);
        summary.ended += 1;
      } else {
        await store.putJson(name, result.record);
        summary.updated += 1;
      }
      if (!result.delivery?.ok) summary.failed += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

async function evaluateLiveActivity(record, env, forecastCache) {
  const now = Date.now();
  if ((timestamp(record.expiresAt) || 0) <= now) {
    const state = liveActivityEndedState(record, "Weather window passed", "Nearcast no longer sees incoming rain or storms.");
    return { event: "end", delivery: await sendLiveActivityApns(record, "end", state, env) };
  }
  const key = planWatchPlaceCacheKey(record.place, "live");
  if (!forecastCache.has(key)) forecastCache.set(key, fetchLiveActivityForecast(record.place));
  const forecast = await forecastCache.get(key);
  const candidate = liveActivityForecastCandidate(forecast, now);
  if (!candidate) {
    const missedChecks = Number(record.missedChecks || 0) + 1;
    if (missedChecks >= 2) {
      const state = liveActivityEndedState(record, "Weather moved on", "Incoming rain is no longer expected soon.");
      return { event: "end", delivery: await sendLiveActivityApns(record, "end", state, env) };
    }
    return { event: "update", delivery: { ok: true, status: 204 }, record: { ...record, missedChecks, updatedAt: new Date(now).toISOString() } };
  }
  const state = liveActivityContentState(record, candidate, now);
  const delivery = await sendLiveActivityApns(record, "update", state, env);
  return {
    event: "update",
    delivery,
    delete: [400, 404, 410].includes(delivery.status),
    record: {
      ...record,
      status: state.status,
      detail: state.detail,
      confidence: state.confidence,
      rainChance: state.rainChance,
      arrivalAtEpoch: state.arrivalAtEpoch,
      missedChecks: 0,
      updatedAt: new Date(now).toISOString()
    }
  };
}

async function fetchLiveActivityForecast(place = {}) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "precipitation,weather_code",
    minutely_15: "precipitation,precipitation_probability,weather_code",
    forecast_minutely_15: "12",
    hourly: "precipitation,precipitation_probability,weather_code",
    forecast_hours: "3",
    precipitation_unit: "inch",
    timezone: "UTC"
  });
  return fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`, PLAN_WATCH_FORECAST_TIMEOUT_MS);
}

export function liveActivityForecastCandidate(forecast = {}, now = Date.now()) {
  const currentWet = Number(forecast?.current?.precipitation || 0) > 0;
  const sections = [
    { data: forecast.minutely_15, precision: "minutely" },
    { data: forecast.hourly, precision: "hourly" }
  ];
  for (const section of sections) {
    const times = section.data?.time || [];
    for (let index = 0; index < times.length; index += 1) {
      const ms = Date.parse(times[index]);
      if (!Number.isFinite(ms) || ms < now - 10 * 60 * 1000 || ms > now + 90 * 60 * 1000) continue;
      const pop = Math.max(0, Math.min(100, Number(section.data?.precipitation_probability?.[index] || 0)));
      const precip = Math.max(0, Number(section.data?.precipitation?.[index] || 0));
      const code = Number(section.data?.weather_code?.[index] || 0);
      const storm = code >= 95 && code <= 99;
      if (!currentWet && !storm && pop < 40 && precip < 0.01) continue;
      return { ms: currentWet ? now : ms, pop, precip, storm, precision: section.precision };
    }
  }
  return null;
}

function liveActivityContentState(record, candidate, now) {
  const etaMinutes = Math.max(0, Math.round((candidate.ms - now) / 60000));
  const city = cleanText(record?.place?.name || "your place", 48);
  const kind = candidate.storm ? "Storm" : "Rain";
  const status = etaMinutes <= 5 ? `${kind} at ${city}` : `${kind} near ${city}`;
  const timing = etaMinutes <= 5 ? "now" : candidate.precision === "minutely" ? `in about ${etaMinutes} min` : "within the next hour";
  return {
    etaMinutes,
    status,
    detail: `${candidate.storm ? "Thunder" : "Rain"} possible ${timing}. Chance ${Math.round(candidate.pop)}%.`,
    confidence: candidate.pop >= 70 || candidate.precip >= 0.03 ? "Likely" : "Watching",
    updatedAtEpoch: Math.round(now / 1000),
    arrivalAtEpoch: Math.round(candidate.ms / 1000),
    expiresAtEpoch: Math.round((timestamp(record.expiresAt) || now + 45 * 60 * 1000) / 1000),
    motionDegrees: record.motionDegrees ?? null,
    confidenceValue: Math.max(0.4, Math.min(0.92, candidate.pop / 100)),
    severity: candidate.storm ? 3 : candidate.pop >= 70 ? 2 : 1,
    rainChance: Math.round(candidate.pop),
    geometryQuality: candidate.precision === "minutely" ? "forecast" : "estimated"
  };
}

function liveActivityEndedState(record, status, detail) {
  const now = Date.now();
  return {
    etaMinutes: 0,
    status,
    detail,
    confidence: "Ended",
    updatedAtEpoch: Math.round(now / 1000),
    arrivalAtEpoch: Math.round(now / 1000),
    expiresAtEpoch: Math.round(now / 1000),
    motionDegrees: null,
    confidenceValue: null,
    severity: 0,
    rainChance: null,
    geometryQuality: "ended"
  };
}

async function sendLiveActivityApns(record, event, state, env = {}) {
  if (!planWatchApnsConfigured(env)) return { ok: false, status: 0, body: "missing-apns-config" };
  const jwt = await planWatchApnsJwt(env);
  const host = record.environment === "development" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const bundleId = record.bundleId || configuredPlanWatchApnsBundleId(env);
  return planWatchFetchWithRetry(`${host}/3/device/${record.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": `${bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": event === "end" ? "10" : "5",
      "apns-collapse-id": cleanToken(record.activityId || "nearcast-live-activity", 64),
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 15 * 60),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      aps: {
        timestamp: Math.floor(Date.now() / 1000),
        event,
        "content-state": state,
        ...(event === "end" ? { "dismissal-date": Math.floor(Date.now() / 1000) + 10 * 60 } : {})
      }
    })
  }, env);
}

async function resolvePlanWatchSubscriptionRecord(store, payload = {}) {
  const subscriptionId = cleanText(payload?.subscriptionId, 120);
  if (subscriptionId && store.getJson) {
    const record = await store.getJson(planWatchSubscriptionStorageName(subscriptionId));
    if (planWatchRecordHasDeliveryChannel(record)) return record;
  }
  const subscription = normalizeWebPushSubscription(payload?.subscription);
  if (subscription && store.getJson) {
    const id = await planWatchSubscriptionId(subscription);
    const record = await store.getJson(planWatchSubscriptionStorageName(id));
    if (planWatchRecordHasDeliveryChannel(record)) return record;
  }
  const nativeChannel = normalizeNativeApnsChannel(payload?.nativeChannel || payload?.channel);
  if (nativeChannel && store.getJson) {
    const id = await planWatchNativeSubscriptionId(nativeChannel);
    const record = await store.getJson(planWatchSubscriptionStorageName(id));
    if (planWatchRecordHasDeliveryChannel(record)) return record;
  }
  return null;
}

async function planWatchSubscriptionRecords(store, options = {}) {
  if (!store?.getJson || !store?.listPage) return { records: [], scan: { scanned: 0, hasMore: false, wrapped: false } };
  const subscriptionId = cleanText(options.subscriptionId, 120);
  if (subscriptionId) {
    const record = await store.getJson(planWatchSubscriptionStorageName(subscriptionId));
    return {
      records: planWatchRecordHasDeliveryChannel(record) ? [record] : [],
      scan: { scanned: record ? 1 : 0, hasMore: false, wrapped: false, direct: true }
    };
  }
  const evaluationLimit = configuredPlanWatchEvaluatorLimit(options.env, options.limit);
  const scanLimit = Math.min(PLAN_WATCH_SCAN_PAGE_HARD_LIMIT, evaluationLimit);
  const scope = options.urgentOnly ? "urgent" : "standard";
  const useCursor = options.reason === "scheduled";
  const cursorState = useCursor ? await store.getJson(planWatchEvaluatorCursorStorageName(scope)) : null;
  const startCursor = cleanText(cursorState?.cursor, 1200);
  const scanStartedAt = Date.now();
  const existingCycleStartedAt = timestamp(cursorState?.cycleStartedAt);
  const cycleStartedAt = startCursor && Number.isFinite(existingCycleStartedAt)
    ? existingCycleStartedAt
    : scanStartedAt;
  let page;
  try {
    page = await store.listPage("subscriptions/", scanLimit, startCursor);
  } catch {
    page = await store.listPage("subscriptions/", scanLimit, "");
  }
  const records = [];
  for (const name of page.names) {
    const record = await store.getJson(name);
    if (planWatchSubscriptionExpired(record)) {
      if (store.deleteJson && record?.subscriptionId) {
        await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
      }
      continue;
    }
    if (planWatchRecordHasDeliveryChannel(record)) records.push(record);
    if (records.length >= evaluationLimit) break;
  }
  const nextCursor = page.truncated && page.cursor ? page.cursor : "";
  if (useCursor && store.putJson) {
    await store.putJson(planWatchEvaluatorCursorStorageName(scope), {
      provider: PLAN_WATCH_PROVIDER,
      version: 1,
      scope,
      cursor: nextCursor,
      cycleStartedAt: new Date(nextCursor ? cycleStartedAt : scanStartedAt).toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return {
    records,
    scan: {
      scanned: page.names.length,
      selected: records.length,
      hasMore: Boolean(nextCursor),
      wrapped: Boolean(startCursor && !nextCursor),
      cycleAgeMs: Math.max(0, scanStartedAt - cycleStartedAt),
      completedCycleMs: !nextCursor ? Math.max(0, scanStartedAt - cycleStartedAt) : null,
      oldestEvaluationLagMs: records.reduce((oldest, record) => {
        const evaluatedAt = timestamp(scope === "urgent" ? record.urgentEvaluatedAt : record.evaluatedAt);
        const fallback = timestamp(record.registeredAt || record.updatedAt) || scanStartedAt;
        return Math.max(oldest, Math.max(0, scanStartedAt - (evaluatedAt || fallback)));
      }, 0)
    }
  };
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

export async function runScheduledPlanWatchEvaluations(env = {}, options = {}) {
  const summaries = [];
  const context = { forecastCache: new Map(), alertsCache: new Map(), externalRequests: 0 };
  summaries.push(await runScheduledPlanWatchEvaluation(env, { urgentOnly: true, context }));
  if (options.includeStandard) {
    summaries.push(await runScheduledPlanWatchEvaluation(env, { urgentOnly: false, context }));
  }
  return summaries;
}

async function runScheduledPlanWatchEvaluation(env = {}, options = {}) {
  const startedAtMs = Date.now();
  const scope = options.urgentOnly ? "urgent" : "standard";
  let summary;
  try {
    summary = await evaluatePlanWatchNotifications(env, {
      reason: "scheduled",
      urgentOnly: Boolean(options.urgentOnly),
      limit: options.urgentOnly
        ? configuredPlanWatchUrgentEvaluatorLimit(env)
        : configuredPlanWatchEvaluatorLimit(env),
      context: options.context
    });
  } catch (error) {
    summary = {
      ok: false,
      provider: PLAN_WATCH_PROVIDER,
      state: "evaluation-failed",
      reason: "scheduled",
      scope,
      checkedAt: new Date().toISOString(),
      subscriptions: 0,
      plans: 0,
      places: 0,
      candidates: 0,
      sent: 0,
      skipped: 0,
      failed: 1,
      deferred: 0,
      updated: 0,
      errors: 1,
      deduplicated: 0,
      deliveryAttempts: 0,
      retries: 0,
      alertSupported: 0,
      alertUnsupported: 0,
      alertErrors: 1,
      externalRequests: Math.max(0, Number(options.context?.externalRequests || 0)),
      error: cleanText(error?.message || String(error), 160)
    };
  }
  const health = sanitizePlanWatchHealthSummary({
    ...summary,
    scope,
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: Math.max(0, Date.now() - startedAtMs)
  });
  const store = planWatchStore(env);
  if (store?.putJson) {
    const slot = Math.floor(startedAtMs / (5 * 60 * 1000)) % 288;
    await Promise.all([
      store.putJson(planWatchHealthStorageName(scope), health),
      store.putJson(`health/evaluator-history/${scope}/${String(slot).padStart(3, "0")}.json`, health)
    ]);
  }
  return summary;
}

function sanitizePlanWatchHealthSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    provider: `${PLAN_WATCH_PROVIDER}-evaluator-health`,
    version: 1,
    ok: Boolean(value.ok && Number(value.failed || 0) === 0 && Number(value.errors || 0) === 0),
    state: cleanToken(value.state || "unknown", 40),
    scope: value.scope === "urgent" ? "urgent" : "standard",
    checkedAt: cleanText(value.checkedAt, 40),
    startedAt: cleanText(value.startedAt, 40),
    durationMs: Math.max(0, Math.round(finiteNumber(value.durationMs, 0))),
    subscriptions: Math.max(0, Math.round(finiteNumber(value.subscriptions, 0))),
    plans: Math.max(0, Math.round(finiteNumber(value.plans, 0))),
    places: Math.max(0, Math.round(finiteNumber(value.places, 0))),
    candidates: Math.max(0, Math.round(finiteNumber(value.candidates, 0))),
    sent: Math.max(0, Math.round(finiteNumber(value.sent, 0))),
    skipped: Math.max(0, Math.round(finiteNumber(value.skipped, 0))),
    failed: Math.max(0, Math.round(finiteNumber(value.failed, 0))),
    deferred: Math.max(0, Math.round(finiteNumber(value.deferred, 0))),
    updated: Math.max(0, Math.round(finiteNumber(value.updated, 0))),
    errors: Math.max(0, Math.round(finiteNumber(value.errors, 0))),
    deduplicated: Math.max(0, Math.round(finiteNumber(value.deduplicated, 0))),
    deliveryAttempts: Math.max(0, Math.round(finiteNumber(value.deliveryAttempts, 0))),
    retries: Math.max(0, Math.round(finiteNumber(value.retries, 0))),
    alertSupported: Math.max(0, Math.round(finiteNumber(value.alertSupported, 0))),
    alertUnsupported: Math.max(0, Math.round(finiteNumber(value.alertUnsupported, 0))),
    alertErrors: Math.max(0, Math.round(finiteNumber(value.alertErrors, 0))),
    externalRequests: Math.max(0, Math.round(finiteNumber(value.externalRequests, 0))),
    scan: {
      scanned: Math.max(0, Math.round(finiteNumber(value.scan?.scanned, 0))),
      selected: Math.max(0, Math.round(finiteNumber(value.scan?.selected, value.subscriptions || 0))),
      hasMore: Boolean(value.scan?.hasMore),
      wrapped: Boolean(value.scan?.wrapped),
      cursor: value.scan?.hasMore ? "continuing" : "wrapped",
      cycleAgeMs: Math.max(0, Math.round(finiteNumber(value.scan?.cycleAgeMs, 0))),
      completedCycleMs: Math.max(0, Math.round(finiteNumber(value.scan?.completedCycleMs, 0))),
      oldestEvaluationLagMs: Math.max(0, Math.round(finiteNumber(value.scan?.oldestEvaluationLagMs, 0)))
    }
  };
}

function planWatchHealthFresh(summary, maxAgeMs, now = Date.now()) {
  const checkedAt = timestamp(summary?.checkedAt);
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 && now - checkedAt <= maxAgeMs;
}

function planWatchBacklogWithinSla(summary, slaMinutes) {
  if (!summary?.scan) return false;
  const maxMs = slaMinutes * 60 * 1000;
  return [
    finiteNumber(summary.scan.cycleAgeMs, 0),
    finiteNumber(summary.scan.completedCycleMs, 0),
    finiteNumber(summary.scan.oldestEvaluationLagMs, 0)
  ].every((value) => value >= 0 && value <= maxMs);
}

async function evaluatePlanWatchNotifications(env = {}, options = {}) {
  const store = planWatchStore(env);
  if (!store?.getJson || !store?.putJson || !store?.listPage) {
    return {
      ok: false,
      provider: PLAN_WATCH_PROVIDER,
      state: "store-unavailable",
      reason: options.reason || ""
    };
  }
  const selection = await planWatchSubscriptionRecords(store, { ...options, env });
  const records = selection.records;
  const externalRequestsAtStart = Math.max(0, Number(options.context?.externalRequests || 0));
  const summary = {
    ok: true,
    provider: PLAN_WATCH_PROVIDER,
    state: "evaluated",
    reason: options.reason || "",
    scope: options.urgentOnly ? "urgent" : "standard",
    dryRun: Boolean(options.dryRun),
    checkedAt: new Date().toISOString(),
    subscriptions: records.length,
    plans: 0,
    places: 0,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    updated: 0,
    errors: 0,
    deduplicated: 0,
    deliveryAttempts: 0,
    retries: 0,
    alertSupported: 0,
    alertUnsupported: 0,
    alertErrors: 0,
    scan: selection.scan,
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
    summary.deferred += result.deferred;
    summary.updated += result.updated;
    summary.errors += result.errors;
    summary.deduplicated += result.deduplicated;
    summary.deliveryAttempts += result.deliveryAttempts;
    summary.retries += result.retries;
    summary.alertSupported += result.alertSupported;
    summary.alertUnsupported += result.alertUnsupported;
    summary.alertErrors += result.alertErrors;
    summary.results.push(result);
  }
  summary.ok = summary.failed === 0 && summary.errors === 0;
  summary.state = summary.ok ? "evaluated" : "degraded";
  summary.externalRequests = Math.max(0, Number(options.context?.externalRequests || 0) - externalRequestsAtStart);
  return summary;
}

async function evaluatePlanWatchSubscription(record, store, env = {}, options = {}) {
  const plans = Array.isArray(record?.plans) ? record.plans : [];
  const places = Array.isArray(record?.places) ? record.places : [];
  const result = {
    subscriptionId: record?.subscriptionId || "",
    endpointHost: safeUrlHost(record?.subscription?.endpoint) || record?.nativeChannel?.environment || "",
    plans: plans.length,
    places: places.length,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    deduplicated: 0,
    deliveryAttempts: 0,
    retries: 0,
    alertSupported: 0,
    alertUnsupported: 0,
    alertErrors: 0,
    updated: 0,
    errors: 0,
    reasons: []
  };
  if (!plans.length && !places.length) return result;

  const evaluatedPlans = [];
  const evaluatedPlaces = [];
  const candidates = [];
  const context = options.context || {
    forecastCache: new Map(),
    alertsCache: new Map(),
    externalRequests: 0
  };
  context.urgentOnly = Boolean(options.urgentOnly);
  for (const plan of plans) {
    const evaluation = await evaluatePlanWatchPlan(plan, record, context).catch((error) => ({
      plan,
      error: error?.message || String(error)
    }));
    if (evaluation?.error) {
      result.errors += 1;
      if (evaluation.alertReadiness === "error") result.alertErrors += 1;
      result.reasons.push(`${plan?.id || "plan"}:${evaluation.error}`);
      evaluatedPlans.push(plan);
      continue;
    }
    if (evaluation.alertReadiness === "supported") result.alertSupported += 1;
    else if (evaluation.alertReadiness === "unsupported") result.alertUnsupported += 1;
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
      if (evaluation.alertReadiness === "error") result.alertErrors += 1;
      result.reasons.push(`${place?.id || "place"}:${evaluation.error}`);
      evaluatedPlaces.push(place);
      continue;
    }
    if (evaluation.alertReadiness === "supported") result.alertSupported += 1;
    else if (evaluation.alertReadiness === "unsupported") result.alertUnsupported += 1;
    evaluatedPlaces.push(evaluation.place);
    if (evaluation.updated) result.updated += 1;
    if (evaluation.candidate) candidates.push(evaluation.candidate);
    else result.skipped += 1;
  }
  result.candidates = candidates.length;

  const eligibleCandidates = options.urgentOnly
    ? candidates.filter(planWatchCandidateIsUrgent)
    : candidates;
  const top = eligibleCandidates.sort((a, b) => b.priority - a.priority)[0];
  let deliveredCandidate = null;
  if (top) {
    if (options.dryRun) {
      result.sent = 0;
      result.reasons.push(`dry-run:${top.type}`);
    } else if (planWatchCandidateInQuietHours(record, top, env)) {
      result.reasons.push(`quiet-hours:${top.type}`);
    } else {
      const duplicate = await planWatchDeliveryDuplicate(record, top, store);
      if (duplicate) {
        result.deduplicated = 1;
        result.skipped += 1;
        result.reasons.push(`duplicate-suppressed:${top.type}`);
        deliveredCandidate = top;
      } else {
        const pending = buildPendingPlanWatchNotification(record, top);
        const push = await sendPlanWatchDelivery(record, pending.notification, store, env);
        result.deliveryAttempts = Math.max(1, Number(push.attempts || 1));
        result.retries = Math.max(0, result.deliveryAttempts - 1);
        if (push.ok) {
          result.sent = 1;
          deliveredCandidate = top;
          await writePlanWatchDeliveryDedupe(record, top, store);
        }
        else {
          result.failed = 1;
          result.reasons.push(`push-failed:${push.status || 0}`);
          if ((push.status === 404 || push.status === 410) && store.deleteJson) {
            await store.deleteJson(planWatchSubscriptionStorageName(record.subscriptionId));
          }
        }
      }
    }
  }

  if (!options.dryRun && result.failed === 0) {
    const persisted = options.urgentOnly && !deliveredCandidate
      ? { plans, places, deferred: candidates.length }
      : planWatchPersistedEvaluationTargets({
        plans,
        places,
        evaluatedPlans,
        evaluatedPlaces,
        candidates,
        deliveredCandidate
      });
    result.deferred = persisted.deferred;
    result.updated = Math.max(0, result.updated - result.deferred);
    const nextRecord = {
      ...record,
      plans: persisted.plans,
      places: persisted.places,
      ...(options.urgentOnly
        ? { urgentEvaluatedAt: new Date().toISOString() }
        : { evaluatedAt: new Date().toISOString() })
    };
    await store.putJson(planWatchSubscriptionStorageName(record.subscriptionId), nextRecord);
  }
  return result;
}

export function planWatchCandidateIsUrgent(candidate = {}) {
  const type = cleanToken(candidate.type || candidate.notification?.signal, 64).toLowerCase();
  return Number(candidate.priority || 0) >= DEFAULT_PLAN_WATCH_QUIET_HOURS_BYPASS_PRIORITY &&
    (type.includes("alert") || type.includes("warning") || type.includes("critical"));
}

export function planWatchCandidateInQuietHours(record = {}, candidate = {}, env = {}, now = new Date()) {
  const quiet = configuredPlanWatchQuietHours(env);
  const bypassesQuietHours = planWatchCandidateIsUrgent(candidate) &&
    Number(candidate.priority || 0) >= quiet.bypassPriority;
  if (quiet.start === quiet.end || bypassesQuietHours) return false;
  const timezone = cleanText(record?.client?.timezone, 80);
  if (!timezone) return false;
  let hour;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now).find((item) => item.type === "hour");
    hour = Number(part?.value);
  } catch {
    return false;
  }
  if (!Number.isInteger(hour)) return false;
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}

async function planWatchDeliveryFingerprint(record = {}, candidate = {}) {
  const notification = normalizePendingPlanWatchNotification(candidate.notification || {});
  return sha256Hex(JSON.stringify([
    record.subscriptionId || "",
    candidate.type || "",
    notification.tag,
    notification.title,
    notification.body,
    notification.memoryId,
    notification.placeId,
    notification.signal,
    notification.timeScope
  ]));
}

async function planWatchDeliveryDuplicate(record, candidate, store) {
  if (!store?.getJson) return false;
  const fingerprint = await planWatchDeliveryFingerprint(record, candidate);
  const storageName = planWatchDeliveryDedupeStorageName(record.subscriptionId, fingerprint);
  const marker = await store.getJson(storageName);
  if (marker && planWatchPendingExpired(marker)) {
    if (store.deleteJson) await store.deleteJson(storageName);
    return false;
  }
  return Boolean(marker?.sentAt);
}

async function writePlanWatchDeliveryDedupe(record, candidate, store) {
  if (!store?.putJson) return;
  const now = Date.now();
  const fingerprint = await planWatchDeliveryFingerprint(record, candidate);
  return store.putJson(planWatchDeliveryDedupeStorageName(record.subscriptionId, fingerprint), {
    provider: PLAN_WATCH_PROVIDER,
    version: 1,
    sentAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_WATCH_DELIVERY_DEDUPE_SECONDS * 1000).toISOString()
  });
}

export function planWatchPersistedEvaluationTargets({
  plans = [],
  places = [],
  evaluatedPlans = [],
  evaluatedPlaces = [],
  candidates = [],
  deliveredCandidate = null
} = {}) {
  const candidatePlanIds = new Set(candidates.map((candidate) => candidate?.notification?.memoryId).filter(Boolean));
  const candidatePlaceIds = new Set(candidates.map((candidate) => candidate?.notification?.placeId).filter(Boolean));
  const deliveredPlanId = deliveredCandidate?.notification?.memoryId || "";
  const deliveredPlaceId = deliveredCandidate?.notification?.placeId || "";
  const originalPlans = new Map(plans.map((plan) => [plan.id, plan]));
  const originalPlaces = new Map(places.map((place) => [place.id, place]));
  return {
    plans: evaluatedPlans.map((plan) =>
      candidatePlanIds.has(plan.id) && plan.id !== deliveredPlanId
        ? originalPlans.get(plan.id) || plan
        : plan
    ),
    places: evaluatedPlaces.map((place) =>
      candidatePlaceIds.has(place.id) && place.id !== deliveredPlaceId
        ? originalPlaces.get(place.id) || place
        : place
    ),
    deferred: Math.max(0, candidatePlanIds.size + candidatePlaceIds.size - (deliveredCandidate ? 1 : 0))
  };
}

async function evaluatePlanWatchPlan(plan, record = {}, context = {}) {
  if (!plan || planWatchPlanIsPast(plan)) {
    return { plan, updated: false, candidate: null };
  }
  if (context.urgentOnly) return evaluateUrgentPlanWatchAlert(plan, record, context);
  const unit = record?.client?.unit === "celsius" ? "celsius" : "fahrenheit";
  const forecast = await cachedPlanWatchForecast(plan.place, unit, context);
  const stats = planWatchWindowStats(plan, forecast, unit);
  if (!stats) return { plan, updated: false, candidate: null, error: "forecast-window-unavailable" };
  const alertState = await cachedPlanWatchAlerts(plan.place, context);
  if (alertState.readiness === "error") {
    return { plan, updated: false, candidate: null, error: "official-alert-fetch-error", alertReadiness: "error" };
  }
  const windowMs = planWatchWindowMs(plan, forecast);
  const alert = alertState.readiness === "supported"
    ? topPlanWatchAlert(alertState.alerts, windowMs.startMs, windowMs.endMs)
    : null;
  const current = sharedPlanWeatherWatchCurrentState(plan, stats, alert, unit);
  preservePlanWatchAlertBaseline(current, plan.lastKnown, alertState.readiness);
  const checkedAt = new Date().toISOString();
  if (current?.snapshot) current.snapshot = { ...current.snapshot, checkedAt: Date.parse(checkedAt) };
  const change = sharedPlanWeatherWatchStateChange(plan.lastKnown, current);
  const lastKnown = sharedPlanWeatherLastKnownFromState(plan, current, change, checkedAt);
  const nextPlan = change?.updateBaseline ? { ...plan, lastKnown } : {
    ...plan,
    lastKnown: {
      ...(plan.lastKnown || {}),
      checkedAt: new Date().toISOString()
    }
  };
  const candidate = change?.notify ? sharedPlanWeatherNotificationCandidate(plan, current, change) : null;
  return {
    plan: nextPlan,
    updated: Boolean(change?.updateBaseline),
    candidate,
    alertReadiness: alertState.readiness
  };
}

async function evaluateUrgentPlanWatchAlert(plan, record = {}, context = {}) {
  const alertState = await cachedPlanWatchAlerts(plan.place, context);
  if (alertState.readiness === "error") {
    return { plan, updated: false, candidate: null, error: "official-alert-fetch-error", alertReadiness: "error" };
  }
  if (alertState.readiness !== "supported") {
    return { plan, updated: false, candidate: null, alertReadiness: alertState.readiness };
  }
  const windowMs = planWatchWindowMsForTimeZone(plan, record?.client?.timezone);
  if (!windowMs) {
    return { plan, updated: false, candidate: null, error: "official-alert-timezone-error", alertReadiness: "error" };
  }
  const alert = topPlanWatchAlert(alertState.alerts, windowMs.startMs, windowMs.endMs);
  const previous = normalizePlanWatchSnapshot(plan.lastKnown?.snapshot) || {};
  const unit = record?.client?.unit === "celsius" ? "celsius" : "fahrenheit";
  const stats = {
    rainChance: finiteNumber(previous.rainChance, 0),
    gustMax: finiteNumber(previous.gustMax, 0),
    feelsMax: finiteNumber(previous.feelsMax, 0),
    score: finiteNumber(previous.score, 100),
    tone: previous.tone || "good",
    riskKind: previous.riskKind || "good",
    stormPotential: false
  };
  const current = sharedPlanWeatherWatchCurrentState(plan, stats, alert, unit);
  preservePlanWatchAlertBaseline(current, plan.lastKnown, "supported");
  const checkedAt = new Date().toISOString();
  if (current?.snapshot) current.snapshot.checkedAt = Date.parse(checkedAt);
  const change = sharedPlanWeatherWatchStateChange(plan.lastKnown, current);
  const lastKnown = sharedPlanWeatherLastKnownFromState(plan, current, change, checkedAt);
  const nextPlan = change?.updateBaseline ? { ...plan, lastKnown } : plan;
  return {
    plan: nextPlan,
    updated: Boolean(change?.updateBaseline),
    candidate: change?.notify ? sharedPlanWeatherNotificationCandidate(plan, current, change) : null,
    alertReadiness: "supported"
  };
}

function preservePlanWatchAlertBaseline(current, previousLastKnown = {}, readiness = "unknown") {
  if (!current?.snapshot) return;
  current.snapshot.alertReadiness = readiness;
  if (readiness === "supported") return;
  const previous = normalizePlanWatchSnapshot(previousLastKnown?.snapshot);
  current.snapshot.alertTone = previous?.alertTone || "";
  current.snapshot.alertEvent = previous?.alertEvent || "";
}

function preserveSavedPlaceAlertBaseline(days = [], previousLastKnown = {}) {
  const previous = normalizePlanWatchSnapshot(previousLastKnown?.snapshot);
  const previousByDate = new Map((previous?.days || []).map((day) => [day.date, day]));
  return days.map((day) => {
    const prior = previousByDate.get(day.date);
    return prior ? {
      ...day,
      alertTone: prior.alertTone || "",
      alertEvent: prior.alertEvent || ""
    } : day;
  });
}

async function evaluateSavedPlaceWatch(watchedPlace, record = {}, context = {}) {
  if (!watchedPlace?.place) return { place: watchedPlace, updated: false, candidate: null };
  if (context.urgentOnly) return evaluateUrgentSavedPlaceAlert(watchedPlace, record, context);
  const unit = record?.client?.unit === "celsius" ? "celsius" : "fahrenheit";
  const forecast = await cachedPlanWatchForecast(watchedPlace.place, unit, context);
  const alertState = await cachedPlanWatchAlerts(watchedPlace.place, context);
  if (alertState.readiness === "error") {
    return { place: watchedPlace, updated: false, candidate: null, error: "official-alert-fetch-error", alertReadiness: "error" };
  }
  const current = savedPlaceWatchCurrentState(watchedPlace, forecast, alertState, unit);
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
    candidate,
    alertReadiness: alertState.readiness
  };
}

async function evaluateUrgentSavedPlaceAlert(watchedPlace, record = {}, context = {}) {
  const alertState = await cachedPlanWatchAlerts(watchedPlace.place, context);
  if (alertState.readiness === "error") {
    return { place: watchedPlace, updated: false, candidate: null, error: "official-alert-fetch-error", alertReadiness: "error" };
  }
  if (alertState.readiness !== "supported") {
    return { place: watchedPlace, updated: false, candidate: null, alertReadiness: alertState.readiness };
  }
  const timezone = record?.client?.timezone;
  const dates = planWatchDatesForTimeZone(timezone, 2);
  if (dates.length !== 2) {
    return { place: watchedPlace, updated: false, candidate: null, error: "official-alert-timezone-error", alertReadiness: "error" };
  }
  const previous = normalizePlanWatchSnapshot(watchedPlace.lastKnown?.snapshot);
  const previousByDate = new Map((previous?.days || []).map((day) => [day.date, day]));
  const days = dates.map((date, index) => {
    const window = planWatchDateWindowForTimeZone(date, timezone);
    const alert = window ? topPlanWatchAlert(alertState.alerts, window.startMs, window.endMs) : null;
    const prior = previousByDate.get(date) || {};
    return {
      ...prior,
      date,
      label: index === 0 ? "today" : "tomorrow",
      alertTone: planWatchAlertTone(alert),
      alertEvent: cleanText(alert?.event || "", 120)
    };
  });
  const snapshot = {
    ...(previous || {}),
    placeId: watchedPlace.id || "",
    placeName: watchedPlace.place?.name || "Saved place",
    unit: record?.client?.unit === "celsius" ? "celsius" : "fahrenheit",
    alertReadiness: "supported",
    days
  };
  const current = {
    signal: "place-watch",
    tone: days.some((day) => day.alertTone === "warning" || day.alertTone === "watch") ? "watch" : "good",
    label: "Saved place forecast",
    reason: savedPlaceWatchSnapshotReason(snapshot, snapshot.unit),
    body: savedPlaceWatchSnapshotReason(snapshot, snapshot.unit),
    receipt: savedPlaceWatchSnapshotReceipt(snapshot, snapshot.unit),
    snapshot
  };
  let change = savedPlaceWatchStateChange(watchedPlace.lastKnown, current);
  if (!previous?.days?.length) {
    const warningDay = days.find((day) => day.alertTone === "warning");
    if (warningDay) change = savedPlaceWatchDayChange(snapshot, { ...warningDay, alertTone: "", alertEvent: "" }, warningDay);
  }
  const lastKnown = savedPlaceWatchLastKnownFromState(watchedPlace, current, change);
  return {
    place: change?.updateBaseline ? { ...watchedPlace, lastKnown } : watchedPlace,
    updated: Boolean(change?.updateBaseline),
    candidate: change?.notify ? savedPlaceWatchNotificationCandidate(watchedPlace, current, change) : null,
    alertReadiness: "supported"
  };
}

function savedPlaceWatchCurrentState(watchedPlace = {}, forecast = {}, alertState = {}, unit = "fahrenheit") {
  const place = watchedPlace.place || {};
  const days = [0, 1]
    .map((dayIndex) => savedPlaceWatchDayStats(forecast, dayIndex, alertState.alerts || [], unit))
    .filter(Boolean);
  if (!days.length) return { snapshot: null };
  const placeName = place.name || "Saved place";
  const snapshot = {
    placeId: watchedPlace.id || "",
    placeName,
    unit,
    alertReadiness: cleanToken(alertState.readiness || "unknown", 24),
    days: alertState.readiness === "supported"
      ? days
      : preserveSavedPlaceAlertBaseline(days, watchedPlace.lastKnown)
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

  const seriousHeat = snapshot.unit === "celsius" ? 38 : 100;
  const notableHeat = snapshot.unit === "celsius" ? 35 : 95;
  const heatJump = snapshot.unit === "celsius" ? 4 : 8;
  const heatComparisonReady = plausibleHeatValue(current.feelsMax, snapshot.unit) &&
    plausibleHeatValue(previous.feelsMax, snapshot.unit);
  const heatDelta = heatComparisonReady ? numberDelta(current.feelsMax, previous.feelsMax) : null;
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

function savedPlaceWatchNotificationRoute(change = {}, current = {}) {
  const type = cleanToken(change.type || current.signal || "place-watch", 64).toLowerCase();
  const dayLabel = cleanToken(change.day?.label || "", 32).toLowerCase();
  if (type.includes("alert")) {
    return { target: "alerts", detail: "alerts", timeScope: dayLabel || "today" };
  }
  if (type.includes("heat")) {
    return { target: "place-hourly", detail: "feels", timeScope: dayLabel || "today" };
  }
  if (type.includes("wind")) {
    return { target: "place-hourly", detail: "wind", timeScope: dayLabel || "today" };
  }
  if (type.includes("storm") || type.includes("rain") || type.includes("clear") || type.includes("precip")) {
    return { target: "place-hourly", detail: "rain", timeScope: dayLabel || "today" };
  }
  return { target: "watching", detail: "", timeScope: dayLabel || "" };
}

function savedPlaceWatchNotificationCandidate(watchedPlace, current, change = {}) {
  const id = cleanToken(watchedPlace.id, 80);
  const signal = change.type || current.signal || "place-watch";
  const route = savedPlaceWatchNotificationRoute(change, current);
  return {
    type: signal,
    priority: change.priority || 50,
    notification: {
      title: change.title || `Nearcast: ${watchedPlace.place?.name || "Saved place"}`,
      body: change.body || current.body || "Weather changed for this saved place.",
      tag: `nearcast-place-${id}`,
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      url: typeof sharedPlanWatchNotificationTargetUrl === "function"
        ? sharedPlanWatchNotificationTargetUrl({
          target: route.target,
          placeId: watchedPlace.id || "",
          detail: route.detail,
          signal,
          timeScope: route.timeScope,
          source: "place-watch-evaluator"
        })
        : "./",
      placeId: watchedPlace.id || "",
      target: route.target,
      detail: route.detail,
      signal,
      timeScope: route.timeScope,
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
    context.externalRequests = Math.max(0, Number(context.externalRequests || 0)) + 1;
    context.forecastCache.set(key, fetchPlanWatchForecast(place, unit));
  }
  return context.forecastCache.get(key);
}

async function cachedPlanWatchAlerts(place = {}, context = {}) {
  if (!context.alertsCache) return fetchPlanWatchAlerts(place);
  const key = planWatchPlaceCacheKey(place, "alerts");
  if (!context.alertsCache.has(key)) {
    context.externalRequests = Math.max(0, Number(context.externalRequests || 0)) + 1;
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
  if (countryCode && !["US", "USA"].includes(countryCode)) {
    return { readiness: "unsupported", alerts: [] };
  }
  if (!Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) {
    return { readiness: "error", alerts: [], reason: "official-alert-coordinates-invalid" };
  }
  const url = `https://api.weather.gov/alerts/active?point=${Number(place.latitude).toFixed(4)},${Number(place.longitude).toFixed(4)}`;
  try {
    const json = await fetchJsonWithTimeout(url, PLAN_WATCH_ALERT_TIMEOUT_MS, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": PLAN_WATCH_NWS_USER_AGENT
      }
    });
    return {
      readiness: "supported",
      alerts: (json?.features || []).map((feature) => feature.properties).filter(Boolean)
    };
  } catch (error) {
    return {
      readiness: "error",
      alerts: [],
      reason: cleanToken(error?.message || "official-alert-fetch-error", 80)
    };
  }
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

function planWatchWindowMsForTimeZone(plan = {}, timezone = "") {
  const startMs = planWatchZonedDateHourMs(plan.targetDate, finiteNumber(plan.startHour, 0), timezone);
  const endMs = planWatchZonedDateHourMs(plan.targetDate, finiteNumber(plan.endHour, 24), timezone);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? { startMs, endMs } : null;
}

function planWatchDateWindowForTimeZone(date, timezone) {
  const startMs = planWatchZonedDateHourMs(date, 0, timezone);
  const endMs = planWatchZonedDateHourMs(date, 24, timezone);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? { startMs, endMs } : null;
}

function planWatchDatesForTimeZone(timezone, count = 2, now = new Date()) {
  if (!validTimeZone(timezone)) return [];
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  const base = Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")), 12);
  return Array.from({ length: count }, (_, index) => new Date(base + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
}

function planWatchZonedDateHourMs(date, hour, timezone) {
  if (!validTimeZone(timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const [year, month, day] = date.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour);
  let guess = desiredUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(guess));
    const part = (type) => Number(parts.find((item) => item.type === type)?.value);
    const representedUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    guess = desiredUtc - (representedUtc - guess);
  }
  return guess;
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
    url: cleanText(source.url || "./", 1200),
    memoryId: cleanText(source.memoryId || "", 96),
    placeId: cleanText(source.placeId || "", 96),
    target: cleanToken(source.target || "", 40),
    detail: cleanToken(source.detail || "", 32),
    signal: cleanToken(source.signal || "", 64),
    timeScope: cleanToken(source.timeScope || "", 32),
    mode: cleanToken(source.mode || "", 40),
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
  return planWatchFetchWithRetry(subscription.endpoint, {
    method: "POST",
    headers: {
      ...headers,
      TTL: String(PLAN_WATCH_PUSH_TTL_SECONDS)
    }
  }, env);
}

async function sendPlanWatchDelivery(record, notification, store, env = {}) {
  if (record?.subscription) {
    if (store?.putJson) {
      await store.putJson(planWatchPendingStorageName(record.subscriptionId), {
        provider: PLAN_WATCH_PROVIDER,
        version: 1,
        subscriptionId: record.subscriptionId,
        notification: normalizePendingPlanWatchNotification(notification),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PLAN_WATCH_PENDING_TTL_SECONDS * 1000).toISOString()
      });
    }
    return sendPlanWatchPush(record.subscription, env);
  }
  if (record?.nativeChannel) {
    return sendPlanWatchApns(record.nativeChannel, notification, env);
  }
  return { ok: false, status: 0, body: "missing-delivery-channel" };
}

async function sendPlanWatchApns(nativeChannel, notification, env = {}) {
  if (!planWatchApnsConfigured(env)) {
    return { ok: false, status: 0, body: "missing-apns-config" };
  }
  const channel = normalizeNativeApnsChannel(nativeChannel);
  if (!channel?.token) {
    return { ok: false, status: 0, body: "missing-apns-token" };
  }
  const bundleId = configuredPlanWatchApnsBundleId(env) || channel.bundleId;
  if (!bundleId) {
    return { ok: false, status: 0, body: "missing-apns-topic" };
  }
  const payload = normalizePendingPlanWatchNotification(notification);
  const jwt = await planWatchApnsJwt(env);
  const host = channel.environment === "development"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  return planWatchFetchWithRetry(`${host}/3/device/${channel.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": cleanToken(payload.tag || "nearcast-plan-watch", 64),
      "apns-expiration": String(Math.floor(Date.now() / 1000) + PLAN_WATCH_PUSH_TTL_SECONDS),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      aps: {
        alert: {
          title: payload.title,
          body: payload.body
        },
        sound: "default"
      },
      nearcast: {
        url: payload.url,
        memoryId: payload.memoryId,
        placeId: payload.placeId,
        target: payload.target,
        detail: payload.detail,
        signal: payload.signal,
        timeScope: payload.timeScope,
        mode: payload.mode,
        source: payload.source
      }
    })
  }, env);
}

export async function planWatchFetchWithRetry(input, init, env = {}) {
  const maxAttempts = configuredPlanWatchDeliveryRetryAttempts(env);
  const baseDelayMs = configuredPlanWatchDeliveryRetryBaseMs(env);
  const timeoutMs = configuredPlanWatchDeliveryTimeoutMs(env);
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastResponse = await planWatchFetchAttempt(input, init, timeoutMs);
      lastError = null;
      if (lastResponse.ok || !planWatchDeliveryStatusIsTransient(lastResponse.status) || attempt >= maxAttempts) {
        const body = lastResponse.ok ? "" : cleanText(await lastResponse.text().catch(() => ""), 240);
        return {
          ok: lastResponse.ok,
          status: lastResponse.status,
          body,
          attempts: attempt
        };
      }
      await lastResponse.body?.cancel?.().catch(() => {});
    } catch (error) {
      lastError = error;
      lastResponse = null;
      if (attempt >= maxAttempts) break;
    }
    const retryAfterMs = planWatchRetryAfterMs(lastResponse?.headers?.get?.("Retry-After"));
    const exponentialMs = Math.min(
      PLAN_WATCH_DELIVERY_RETRY_MAX_DELAY_MS,
      baseDelayMs * (2 ** (attempt - 1)) + Math.floor(Math.random() * Math.max(1, baseDelayMs))
    );
    await planWatchSleep(Math.max(retryAfterMs, exponentialMs));
  }
  return {
    ok: false,
    status: lastResponse?.status || 0,
    body: cleanText(lastError?.message || "delivery-network-error", 240),
    attempts: maxAttempts
  };
}

async function planWatchFetchAttempt(input, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function planWatchDeliveryStatusIsTransient(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function planWatchRetryAfterMs(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) {
    return Math.min(PLAN_WATCH_DELIVERY_RETRY_MAX_DELAY_MS, Math.max(0, Math.round(seconds * 1000)));
  }
  const date = Date.parse(text);
  return Number.isFinite(date)
    ? Math.min(PLAN_WATCH_DELIVERY_RETRY_MAX_DELAY_MS, Math.max(0, date - Date.now()))
    : 0;
}

function planWatchSleep(delayMs) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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

async function planWatchApnsJwt(env = {}) {
  const teamId = configuredPlanWatchApnsTeamId(env);
  const keyId = configuredPlanWatchApnsKeyId(env);
  const privateKey = configuredPlanWatchApnsPrivateKey(env);
  const header = base64UrlEncodeJson({ alg: "ES256", kid: keyId });
  const body = base64UrlEncodeJson({
    iss: teamId,
    iat: Math.floor(Date.now() / 1000)
  });
  const input = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input)
  );
  return `${input}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer;
}

function normalizeWebPushSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const endpoint = String(value.endpoint || "").trim();
  if (!endpoint || endpoint.length > 2048) return null;
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return null;
  }
  if (
    endpointUrl.protocol !== "https:" ||
    endpointUrl.username ||
    endpointUrl.password ||
    endpointUrl.hash ||
    (endpointUrl.port && endpointUrl.port !== "443") ||
    (endpointUrl.pathname === "/" && !endpointUrl.search) ||
    !publicDeliveryHostname(endpointUrl.hostname) ||
    !supportedWebPushProviderHostname(endpointUrl.hostname)
  ) return null;
  const keys = value.keys && typeof value.keys === "object" ? value.keys : {};
  const p256dh = String(keys.p256dh || "").trim();
  const auth = String(keys.auth || "").trim();
  const p256dhBytes = base64UrlDecodedBytes(p256dh);
  const authBytes = base64UrlDecodedBytes(auth);
  if (p256dhBytes?.length !== 65 || p256dhBytes[0] !== 4 || authBytes?.length !== 16) return null;
  return {
    endpoint: endpointUrl.toString(),
    expirationTime: value.expirationTime || null,
    keys: { p256dh, auth }
  };
}

function normalizeNativeApnsChannel(value, env = null) {
  if (!value || typeof value !== "object") return null;
  const token = cleanToken(value.token, 220).toLowerCase();
  if (!/^[a-f0-9]{32,200}$/.test(token) || token.length % 2 !== 0) return null;
  const environment = cleanToken(value.environment || "production", 24).toLowerCase() === "development"
    ? "development"
    : "production";
  const bundleId = cleanText(value.bundleId, 120);
  const configuredBundleId = env ? configuredPlanWatchApnsBundleId(env) : "";
  if (!bundleId || (configuredBundleId && bundleId !== configuredBundleId)) return null;
  return {
    kind: "ios-apns",
    token,
    environment,
    bundleId,
    deviceModel: cleanText(value.deviceModel, 80),
    systemVersion: cleanText(value.systemVersion, 40)
  };
}

function base64UrlDecodedBytes(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function publicDeliveryHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || !hostname.includes(".")) return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".test")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return false;
  return /^[a-z0-9.-]+$/.test(hostname) && !hostname.startsWith(".") && !hostname.endsWith(".");
}

function supportedWebPushProviderHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return WEB_PUSH_PROVIDER_HOSTS.has(hostname) ||
    WEB_PUSH_PROVIDER_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function planWatchRecordHasDeliveryChannel(record) {
  return Boolean(record?.subscription || record?.nativeChannel);
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
  const timezone = cleanText(source.timezone, 80);
  return {
    appVersion: cleanText(source.appVersion, 24),
    locale: cleanText(source.locale, 48),
    timezone: validTimeZone(timezone) ? timezone : "",
    unit: ["fahrenheit", "celsius"].includes(source.unit) ? source.unit : ""
  };
}

function validTimeZone(value) {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
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

function sameRegisteredPlanWindow(a = {}, b = {}) {
  const samePlace = Math.abs(Number(a.place?.latitude) - Number(b.place?.latitude)) < 0.001 &&
    Math.abs(Number(a.place?.longitude) - Number(b.place?.longitude)) < 0.001;
  return Boolean(
    a.id === b.id &&
    a.targetDate === b.targetDate &&
    a.startHour === b.startHour &&
    a.endHour === b.endHour &&
    samePlace
  );
}

function mergePlanWatchPlansWithExisting(plans = [], existingPlans = [], options = {}) {
  const existingById = new Map((Array.isArray(existingPlans) ? existingPlans : [])
    .filter(Boolean)
    .map((plan) => [plan.id, plan]));
  return plans.map((plan) => {
    const existing = existingById.get(plan.id);
    const existingSnapshot = existing?.lastKnown?.snapshot;
    const incomingSnapshot = plan?.lastKnown?.snapshot;
    const incomingUnitsReady = Boolean(incomingSnapshot?.tempUnit && incomingSnapshot?.windUnit);
    const sameUnits = !existingSnapshot || !incomingSnapshot || !incomingUnitsReady || (
      existingSnapshot.tempUnit === incomingSnapshot.tempUnit &&
      existingSnapshot.windUnit === incomingSnapshot.windUnit
    );
    return {
      ...plan,
      lastKnown: existing && !options.resetBaseline && sameRegisteredPlanWindow(existing, plan) && sameUnits
        ? existing.lastKnown
        : plan.lastKnown
    };
  });
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
  if (!id || !validPlanWatchTargetDate(targetDate)) return null;
  const place = normalizePlanWatchPlace(value.place);
  if (!place) return null;
  const startHour = finiteNumber(value.startHour, null);
  const endHour = finiteNumber(value.endHour, null);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour) {
    return null;
  }
  return {
    id,
    title: cleanText(value.title, 120),
    targetDate,
    startHour,
    endHour,
    place,
    lastKnown: normalizePlanWatchLastKnown(value.lastKnown)
  };
}

function normalizePlanWatchPlace(value = {}) {
  if (!value || typeof value !== "object") return null;
  const latitude = finiteNumber(value.latitude, null);
  const longitude = finiteNumber(value.longitude, null);
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) return null;
  return {
    name: cleanText(value.name, 120),
    admin1: cleanText(value.admin1, 120),
    country: cleanText(value.country, 120),
    countryCode: cleanToken(value.countryCode || value.country_code || "", 8),
    latitude,
    longitude
  };
}

function validPlanWatchTargetDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  return parsed >= Date.now() - 2 * dayMs && parsed <= Date.now() + 370 * dayMs;
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

function planWatchDeliveryDedupeStorageName(subscriptionId, fingerprint) {
  return `delivery-dedupe/${cleanStorageName(subscriptionId)}/${cleanStorageName(fingerprint)}.json`;
}

function planWatchEvaluatorCursorStorageName(scope = "standard") {
  return `health/evaluator-cursor-${scope === "urgent" ? "urgent" : "standard"}.json`;
}

function planWatchHealthStorageName(scope = "standard") {
  return `health/evaluator-latest-${scope === "urgent" ? "urgent" : "standard"}.json`;
}

function planWatchRegistrationCapStorageName() {
  return "limits/registration-cap.json";
}

function normalizePlanWatchSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const snapshot = {
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
    alertReadiness: cleanToken(value.alertReadiness, 24),
    riskKind: cleanToken(value.riskKind, 32),
    savedAt: finiteNumber(value.savedAt, 0),
    checkedAt: finiteNumber(value.checkedAt, 0),
    days: normalizePlanWatchSnapshotDays(value.days)
  };
  const hasContent = Boolean(
    snapshot.placeId ||
    snapshot.placeName ||
    snapshot.title ||
    snapshot.targetDate ||
    snapshot.alertEvent ||
    snapshot.tone ||
    snapshot.riskKind ||
    snapshot.days.length ||
    ["rainChance", "gustMax", "feelsMax", "score", "startHour", "endHour"]
      .some((key) => value[key] !== null && value[key] !== undefined && value[key] !== "" && Number.isFinite(Number(value[key])))
  );
  return hasContent ? snapshot : null;
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

async function planWatchNativeSubscriptionId(channel) {
  return `ios-${await sha256Hex(`${channel?.environment || "production"}:${channel?.bundleId || ""}:${channel?.token || ""}`)}`;
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

function plausibleHeatValue(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  return unit === "celsius" ? number >= 10 && number <= 65 : number >= 50 && number <= 150;
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
