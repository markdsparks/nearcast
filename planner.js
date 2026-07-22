/* Nearcast planner, local AI summary, and plan memory surfaces. */

/* ---------- Planner: local AI summary (Tier 1, opt-in) ---------- */
const LOCAL_AI_MODEL = "Qwen3-0.6B-q4f16_1-MLC";
const LOCAL_AI_MODEL_MB = 360;
const LOCAL_AI_MIN_FREE_BYTES = 500 * 1024 * 1024;

// phase: unknown | unsupported | idle | loading | ready | generating | error
const aiState = {
  phase: "unknown",
  progress: 0,
  status: "",
  text: "",
  error: "",
  support: null,
  loadError: "",
  reportCopied: false
};
let aiBriefAbort = null;
let aiModule = null;
let aiWarmQueued = false;
let aiWarmLoading = false;

function loadAIModule() {
  if (!aiModule) aiModule = import(`./ai.js?v=${encodeURIComponent(VERSION)}`);
  return aiModule;
}

function applyAIProviderInfo(ai) {
  const info = typeof ai?.providerInfo === "function" ? ai.providerInfo() : null;
  if (!info || !aiState.support) return;
  aiState.support.activeProvider = info.kind || "unknown";
  aiState.support.model = info.model || aiState.support.model;
  aiState.support.operon = info.operon === true;
}

function localAIIntentReady(ai) {
  return aiState.phase === "ready" &&
    typeof ai?.extractPlanIntent === "function" &&
    (typeof ai.isLoaded !== "function" || ai.isLoaded());
}

function detectBrowserName(ua) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/CriOS\//.test(ua)) return "Chrome iOS";
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua) || /FxiOS\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

function plannerHostInfo() {
  const ua = navigator.userAgent || "";
  const brands = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") || "";
  return {
    browser: detectBrowserName(ua),
    platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
    mobile: navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(ua),
    brands,
    userAgent: ua
  };
}

function supportsModuleWorker() {
  if (!window.Worker || !window.Blob || !window.URL?.createObjectURL) return false;
  let url = "";
  try {
    url = URL.createObjectURL(new Blob(["export {};"], { type: "text/javascript" }));
    const worker = new Worker(url, { type: "module" });
    worker.terminate();
    return true;
  } catch (_) {
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function bytesToMB(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Math.round(bytes / 1024 / 1024);
}

function errorDetail(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const parts = [
      err.name || "Error",
      err.message || "",
      err.cause ? `cause: ${errorDetail(err.cause)}` : ""
    ].filter(Boolean);
    return parts.join(": ");
  }
  if (typeof err === "object") {
    const detail = {};
    for (const key of Object.getOwnPropertyNames(err)) {
      try {
        const value = err[key];
        detail[key] = typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value;
      } catch (_) {
        detail[key] = "[unreadable]";
      }
    }
    if (Object.keys(detail).length) {
      try {
        return JSON.stringify(detail);
      } catch (_) {}
    }
    const asText = String(err);
    return asText && asText !== "[object Object]"
      ? asText
      : "Object error with no readable fields";
  }
  return String(err);
}

function cleanError(err) {
  const text = errorDetail(err);
  return text.replace(/\s+/g, " ").trim().slice(0, 900);
}

function adapterSnapshot(adapter) {
  const limits = adapter?.limits || {};
  return {
    features: adapter?.features ? Array.from(adapter.features).slice(0, 25) : [],
    limits: {
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize
    }
  };
}

async function probeLocalAI() {
  const report = {
    appVersion: VERSION,
    model: aiState.support?.model || LOCAL_AI_MODEL,
    modelDownloadMB: LOCAL_AI_MODEL_MB,
    checkedAt: new Date().toISOString(),
    host: plannerHostInfo(),
    origin: location.origin,
    secureContext: window.isSecureContext === true,
    webgpu: "gpu" in navigator,
    adapter: false,
    device: false,
    moduleWorker: supportsModuleWorker(),
    cacheApi: "caches" in window,
    nativeAI: null,
    activeProvider: "",
    operon: true,
    storage: null,
    adapterDetails: null,
    result: "unknown",
    reason: "",
    warnings: []
  };

  const fail = (code, reason, err) => {
    report.result = code;
    report.reason = reason;
    if (err) report.error = cleanError(err);
    return { ok: false, report };
  };

  if (!report.secureContext) {
    return fail("needs-secure-context", "Private AI summary needs HTTPS or localhost.");
  }

  const nativeBridge = window.NearcastNative?.ai;
  if (nativeBridge && typeof nativeBridge.availability === "function") {
    try {
      const availability = await nativeBridge.availability();
      report.nativeAI = {
        supported: true,
        available: availability?.available === true,
        reason: availability?.reason || "unknown",
        model: availability?.model || "apple-system-language-model"
      };
      if (report.nativeAI.available) {
        report.model = report.nativeAI.model;
        report.activeProvider = "apple";
        report.result = "ready";
        report.reason = "Apple's private on-device language model is ready.";
        return { ok: true, report };
      }
      report.warnings.push(`Apple on-device model unavailable (${report.nativeAI.reason}); checking WebGPU fallback.`);
    } catch (err) {
      report.nativeAI = { supported: true, available: false, reason: cleanError(err) };
      report.warnings.push("Apple on-device model availability check failed; checking WebGPU fallback.");
    }
  }
  if (!report.webgpu) {
    return fail("no-webgpu", "This browser does not expose WebGPU.");
  }
  if (!report.moduleWorker) {
    return fail("no-module-worker", "This browser cannot run the module worker used by the local model.");
  }
  if (!report.cacheApi) {
    report.warnings.push("Cache API is unavailable; the model may need to download again.");
  }

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      const usage = estimate.usage || 0;
      const free = quota ? Math.max(0, quota - usage) : null;
      report.storage = {
        quotaMB: bytesToMB(quota),
        usageMB: bytesToMB(usage),
        freeMB: bytesToMB(free)
      };
      if (free != null && free < LOCAL_AI_MIN_FREE_BYTES) {
        report.warnings.push(`Browser storage may be tight (${bytesToMB(free)} MB free).`);
      }
    } catch (err) {
      report.warnings.push(`Storage estimate failed: ${cleanError(err)}`);
    }
  } else {
    report.warnings.push("Storage estimate API is unavailable.");
  }

  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) adapter = await navigator.gpu.requestAdapter();
  } catch (err) {
    return fail("adapter-error", "WebGPU adapter request failed.", err);
  }
  if (!adapter) {
    return fail("no-adapter", "WebGPU is present, but no compatible GPU adapter was available.");
  }
  report.adapter = true;
  report.adapterDetails = adapterSnapshot(adapter);

  try {
    const device = await adapter.requestDevice();
    report.device = true;
    if (device.destroy) device.destroy();
  } catch (err) {
    return fail("device-error", "WebGPU is present, but the browser could not create a GPU device.", err);
  }

  report.result = "ready";
  report.activeProvider = "webllm";
  report.reason = report.warnings.length
    ? "Local AI summary appears supported, with compatibility warnings."
    : "Local AI summary appears supported.";
  return { ok: true, report };
}

function localAIReady() {
  return aiState.support?.result === "ready";
}

function supportReason() {
  return aiState.support?.reason || "Private AI summary is not available on this device.";
}

function supportReportText() {
  return JSON.stringify({
    app: "Nearcast",
    appVersion: VERSION,
    plannerPhase: aiState.phase,
    model: LOCAL_AI_MODEL,
    support: aiState.support,
    loadError: aiState.loadError || null
  }, null, 2);
}

async function copySupportReport() {
  aiState.reportCopied = false;
  try {
    await navigator.clipboard.writeText(supportReportText());
    aiState.reportCopied = true;
  } catch (err) {
    aiState.loadError = `Copy failed: ${cleanError(err)}`;
  }
  renderBriefing();
}

function classifyAIError(err) {
  const msg = cleanError(err);
  const lower = msg.toLowerCase();
  aiState.loadError = msg;
  if (/quota|storage|cache|indexeddb|opfs/.test(lower)) {
    return "The local model could not be stored. Free up browser storage or try another browser profile.";
  }
  if (/fetch|network|import|cdn|load failed|failed to fetch/.test(lower)) {
    return "The local model or runtime could not download. Check connection, content blockers, then retry.";
  }
  if (/gpu|adapter|device|memory|out of memory|webgpu/.test(lower)) {
    return "This browser found WebGPU, but the device could not start the local model.";
  }
  return "Couldn't start the private AI summary on this device.";
}

function renderSupportActions(includeRetry = false) {
  const copied = aiState.reportCopied ? `<span class="briefing-copy-ok">Copied</span>` : "";
  return `<div class="briefing-actions">` +
    (includeRetry ? `<button class="briefing-link" data-ai="enable" type="button">Retry summary</button>` : "") +
    `<button class="briefing-link" data-ai="copy-report" type="button">Copy support report</button>` +
    copied +
  `</div>`;
}

const PLAN_BRIEFING_MAX_ITEMS = 3;
const MAIN_PLAN_BRIEFING_MAX_ITEMS = 2;
const PLAN_WATCH_MAX_AUTO_FETCH_PLACES = 4;
const PLAN_WATCH_FORECAST_MAX_AGE_MS = 60 * 60 * 1000;
const PLAN_WATCH_REFRESH_THROTTLE_MS = 90 * 1000;
const PLAN_WATCH_NOTIFICATION_PREF_KEY = "nearcast-plan-watch-notifications-v1";
const PLAN_WATCH_NOTIFICATION_PLANS_KEY = "nearcast-plan-watch-notification-plans-v1";
const PLACE_WATCH_NOTIFICATION_PLACES_KEY = "nearcast-place-watch-notification-places-v1";
const PLACE_WATCH_MAX_SYNC_PLACES = 3;
const PLAN_WATCH_NOTIFICATION_STATE_KEY = "nearcast-plan-watch-notification-events-v1";
const PLAN_WATCH_RECENT_UPDATES_KEY = "nearcast-plan-watch-recent-updates-v1";
const PLAN_WATCH_NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PLAN_WATCH_NOTIFICATION_MAX_EVENTS = 48;
const PLAN_WATCH_RECENT_UPDATE_MAX_ITEMS = 10;
const PLAN_WATCH_RECENT_UPDATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_WATCH_REVIEWED_CHANGES_KEY = "nearcast-plan-watch-reviewed-changes-v1";
const PLAN_WATCH_REVIEWED_MAX_CHANGES = 120;
const PLAN_WATCH_REVIEWED_CHANGE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PLAN_WATCH_RECENT_REVIEW_MS = 10 * 60 * 1000;
const PLAN_WATCH_RECEIPTS_KEY = "nearcast-plan-watch-receipts-v1";
const PLAN_WATCH_RECEIPT_MAX_ITEMS = 40;
const PLAN_WATCH_RECEIPT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const PLAN_WATCH_PUSH_CONFIG_ENDPOINT = "/api/watch/notifications/config";
const PLAN_WATCH_PUSH_REGISTER_ENDPOINT = "/api/watch/notifications/register";
const PLAN_WATCH_PUSH_UNREGISTER_ENDPOINT = "/api/watch/notifications/unregister";
const PLAN_WATCH_PUSH_SYNC_THROTTLE_MS = 30 * 1000;
const PLAN_WATCH_MAX_NOTIFICATION_PLANS = 3;
const PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS = 5 * 60 * 1000;
const PLAN_WATCH_NATIVE_CHANNEL_KEY = "nearcast-plan-watch-native-channel-v1";
const PLAN_WATCH_NATIVE_SUBSCRIPTION_ID_KEY = "nearcast-plan-watch-native-subscription-id-v1";
const PLAN_WATCH_PUSH_HEALTH_KEY = "nearcast-plan-watch-push-health-v1";
let planWatchMemoryInventoryReady = false;

function planWatchRegistrationExpiryTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readPlanWatchPushHealth() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_PUSH_HEALTH_KEY) || "null");
    return {
      lastAttemptAt: Math.max(0, Number(parsed?.lastAttemptAt) || 0),
      lastAttemptState: ["pending", "ready", "failed"].includes(parsed?.lastAttemptState)
        ? parsed.lastAttemptState
        : "",
      lastAttemptReason: planWatchCompactText(parsed?.lastAttemptReason || "", 120),
      lastSuccessAt: Math.max(0, Number(parsed?.lastSuccessAt) || 0),
      registrationExpiresAt: planWatchRegistrationExpiryTimestamp(parsed?.registrationExpiresAt)
    };
  } catch {
    return { lastAttemptAt: 0, lastAttemptState: "", lastAttemptReason: "", lastSuccessAt: 0, registrationExpiresAt: 0 };
  }
}

function writePlanWatchPushHealth(health = {}) {
  try {
    localStorage.setItem(PLAN_WATCH_PUSH_HEALTH_KEY, JSON.stringify({
      lastAttemptAt: Math.max(0, Number(health.lastAttemptAt) || 0),
      lastAttemptState: ["pending", "ready", "failed"].includes(health.lastAttemptState)
        ? health.lastAttemptState
        : "",
      lastAttemptReason: planWatchCompactText(health.lastAttemptReason || "", 120),
      lastSuccessAt: Math.max(0, Number(health.lastSuccessAt) || 0),
      registrationExpiresAt: planWatchRegistrationExpiryTimestamp(health.registrationExpiresAt)
    }));
  } catch {
    /* Delivery health is explanatory UI; registration itself does not depend on storage. */
  }
}

const initialPlanWatchPushHealth = readPlanWatchPushHealth();

const planWatchState = {
  data: {},
  alerts: {},
  alertsReady: {},
  loading: {},
  errors: {},
  lastFetchAt: {},
  baselineStore: null,
  recentReviewedChanges: {},
  announcedReceiptSignatures: new Set(),
  pushConfig: null,
  pushConfigPromise: null,
  pushLastSyncAt: 0,
  pushLastAttemptAt: initialPlanWatchPushHealth.lastAttemptAt,
  pushLastAttemptState: initialPlanWatchPushHealth.lastAttemptState,
  pushLastAttemptReason: initialPlanWatchPushHealth.lastAttemptReason,
  pushLastSuccessAt: initialPlanWatchPushHealth.lastSuccessAt,
  pushRegistrationExpiresAt: initialPlanWatchPushHealth.registrationExpiresAt,
  pushLastSyncResult: null,
  pushSyncPromise: null
};
let planWatchFocusMemoryId = "";
let planWatchVisibleReceiptSignature = "";
let planWatchNotificationRouteConsumed = "";

function planWatchReviewedChangesStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_REVIEWED_CHANGES_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return { changes: {} };
    return {
      changes: parsed.changes && typeof parsed.changes === "object" ? parsed.changes : {}
    };
  } catch {
    return { changes: {} };
  }
}

function writePlanWatchReviewedChangesStore(store) {
  try {
    const now = Date.now();
    const changes = Object.entries(store?.changes || {})
      .filter(([, value]) => now - (Number(value) || 0) <= PLAN_WATCH_REVIEWED_CHANGE_MAX_AGE_MS)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, PLAN_WATCH_REVIEWED_MAX_CHANGES);
    localStorage.setItem(PLAN_WATCH_REVIEWED_CHANGES_KEY, JSON.stringify({
      changes: Object.fromEntries(changes)
    }));
  } catch {
    /* Change review is an affordance; storage failure should not block the app. */
  }
}

function planWatchChangeReviewKey(memory, change) {
  if (!memory?.id || !change?.type) return "";
  return [
    memory.id,
    memory.targetDate || "",
    memory.startHour ?? "",
    memory.endHour ?? "",
    planWatchPlaceKey(memory.place || {}),
    change.type,
    change.receipt?.metric?.unit || "",
    change.title || "",
    change.body || ""
  ].join("|");
}

function planWatchChangeWasReviewed(memory, change) {
  const key = planWatchChangeReviewKey(memory, change);
  if (!key) return false;
  const reviewedAt = Number(planWatchReviewedChangesStore().changes[key] || 0);
  return reviewedAt > 0 && Date.now() - reviewedAt <= PLAN_WATCH_REVIEWED_CHANGE_MAX_AGE_MS;
}

function planWatchRecentReviewedChange(memoryId) {
  const entry = planWatchState.recentReviewedChanges?.[memoryId];
  if (!entry?.change || Date.now() - Number(entry.at || 0) > PLAN_WATCH_RECENT_REVIEW_MS) return null;
  return entry.change;
}

function markPlanWatchChangeReviewed(memory, change) {
  const key = planWatchChangeReviewKey(memory, change);
  if (!key) return false;
  const now = Date.now();
  const store = planWatchReviewedChangesStore();
  store.changes[key] = now;
  writePlanWatchReviewedChangesStore(store);
  planWatchState.recentReviewedChanges[memory.id] = { change, at: now };
  return true;
}

function planWatchReceiptWindowKey(value = {}, snapshot = null) {
  const source = snapshot || value;
  const memory = value.memory || value;
  return [
    source.targetDate || memory.targetDate || "",
    source.startHour ?? memory.startHour ?? "",
    source.endHour ?? memory.endHour ?? "",
    source.placeKey || planWatchPlaceKey(memory.place || {}),
    source.tempUnit || "",
    source.windUnit || ""
  ].join("|");
}

function cleanPlanWatchStoredReceipt(entry = {}, fallbackMemoryId = "") {
  const sourceChange = entry.change && typeof entry.change === "object" ? entry.change : {};
  const sourceReceipt = sourceChange.receipt && typeof sourceChange.receipt === "object"
    ? sourceChange.receipt
    : entry.receipt && typeof entry.receipt === "object" ? entry.receipt : {};
  const sourceMetric = sourceReceipt.metric && typeof sourceReceipt.metric === "object" ? sourceReceipt.metric : {};
  const memoryId = String(entry.memoryId || fallbackMemoryId || "").trim().slice(0, 96);
  const type = String(sourceChange.type || sourceReceipt.kind || "").trim().slice(0, 48);
  const title = planWatchCompactText(sourceChange.title || sourceReceipt.headline || "Forecast changed", 120);
  const body = planWatchCompactText(sourceChange.body || "Weather changed during this plan window.", 180);
  const detectedAt = Math.max(0, Number(entry.detectedAt || sourceReceipt.checkedAt) || Date.now());
  const reviewedAt = Math.max(0, Number(entry.reviewedAt) || 0);
  if (!memoryId || !type || !title) return null;
  return {
    memoryId,
    windowKey: String(entry.windowKey || "").slice(0, 80),
    signature: String(entry.signature || "").slice(0, 320),
    detectedAt,
    reviewedAt,
    change: {
      type,
      tone: ["good", "caution", "watch", "pending", "neutral"].includes(sourceChange.tone)
        ? sourceChange.tone
        : "caution",
      notify: sourceChange.notify !== false,
      priority: Math.max(0, Number(sourceChange.priority) || 0),
      title,
      body,
      receipt: {
        version: 1,
        kind: type,
        tone: sourceReceipt.tone || sourceChange.tone || "caution",
        direction: ["better", "worse", "changed"].includes(sourceReceipt.direction)
          ? sourceReceipt.direction
          : "changed",
        headline: planWatchCompactText(sourceReceipt.headline || title, 120),
        metric: {
          label: planWatchCompactText(sourceMetric.label || "Forecast", 48),
          before: planWatchCompactText(sourceMetric.before || "Previous", 48),
          after: planWatchCompactText(sourceMetric.after || "Now", 48),
          unit: planWatchCompactText(sourceMetric.unit || "", 16)
        },
        why: planWatchCompactText(sourceReceipt.why || body, 180),
        action: planWatchCompactText(sourceReceipt.action || "Review the plan window before you go.", 180),
        baselineAt: Math.max(0, Number(sourceReceipt.baselineAt || entry.baselineAt) || 0),
        checkedAt: Math.max(0, Number(sourceReceipt.checkedAt || entry.checkedAt || detectedAt) || detectedAt)
      }
    }
  };
}

function readPlanWatchReceiptStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_RECEIPTS_KEY) || "null");
    const raw = parsed?.receipts && typeof parsed.receipts === "object" ? parsed.receipts : {};
    const now = Date.now();
    const receipts = {};
    Object.entries(raw).forEach(([memoryId, value]) => {
      const receipt = cleanPlanWatchStoredReceipt(value, memoryId);
      if (receipt && now - receipt.detectedAt <= PLAN_WATCH_RECEIPT_MAX_AGE_MS) receipts[memoryId] = receipt;
    });
    return { receipts };
  } catch {
    return { receipts: {} };
  }
}

function writePlanWatchReceiptStore(store) {
  try {
    const now = Date.now();
    const entries = Object.entries(store?.receipts || {})
      .map(([memoryId, value]) => [memoryId, cleanPlanWatchStoredReceipt(value, memoryId)])
      .filter(([, value]) => value && now - value.detectedAt <= PLAN_WATCH_RECEIPT_MAX_AGE_MS)
      .sort((a, b) => b[1].detectedAt - a[1].detectedAt)
      .slice(0, PLAN_WATCH_RECEIPT_MAX_ITEMS);
    localStorage.setItem(PLAN_WATCH_RECEIPTS_KEY, JSON.stringify({ receipts: Object.fromEntries(entries) }));
  } catch {
    /* A durable receipt is helpful, but storage failure must not block forecasts. */
  }
}

function planWatchStoredReceipt(memory, snapshot = null) {
  if (!memory?.id) return null;
  const entry = readPlanWatchReceiptStore().receipts[memory.id] || null;
  if (!entry || entry.windowKey !== planWatchReceiptWindowKey(memory, snapshot)) return null;
  return entry;
}

function capturePlanWatchChangeReceipt(current, previous, change) {
  const memoryId = String(current?.memoryId || "").trim();
  const memory = state.planMemories.find((item) => item.id === memoryId);
  if (!memory || !change?.type || !change?.body) return null;
  const signature = planWatchChangeReviewKey(memory, change);
  if (!signature) return null;
  const store = readPlanWatchReceiptStore();
  const existing = store.receipts[memoryId];
  if (existing?.signature === signature) return existing;
  const receipt = cleanPlanWatchStoredReceipt({
    memoryId,
    windowKey: planWatchReceiptWindowKey(memory, current),
    signature,
    detectedAt: change.receipt?.checkedAt || current?.savedAt || Date.now(),
    reviewedAt: 0,
    baselineAt: change.receipt?.baselineAt || previous?.savedAt || 0,
    checkedAt: change.receipt?.checkedAt || current?.savedAt || Date.now(),
    change
  }, memoryId);
  if (!receipt) return null;
  store.receipts[memoryId] = receipt;
  writePlanWatchReceiptStore(store);
  recordPlanWatchRecentUpdate({
    key: `receipt:${signature}`,
    targetType: "plan",
    targetId: memoryId,
    tone: change.tone || "caution",
    title: change.title || planMemoryTitle(memory),
    body: change.body,
    at: receipt.detectedAt
  }, { refresh: false });
  return receipt;
}

function markPlanWatchReceiptReviewed(memoryId) {
  const store = readPlanWatchReceiptStore();
  const entry = store.receipts[memoryId];
  if (!entry || entry.reviewedAt) return entry || null;
  entry.reviewedAt = Date.now();
  store.receipts[memoryId] = entry;
  writePlanWatchReceiptStore(store);
  return entry;
}

function clearPlanWatchTracking(memoryId) {
  if (!memoryId) return;
  const receiptStore = readPlanWatchReceiptStore();
  delete receiptStore.receipts[memoryId];
  writePlanWatchReceiptStore(receiptStore);
  writePlanWatchRecentUpdates(readPlanWatchRecentUpdates().filter((update) => !(
    update.targetType === "plan" && update.targetId === memoryId
  )));
  const reviewed = planWatchReviewedChangesStore();
  reviewed.changes = Object.fromEntries(Object.entries(reviewed.changes || {}).filter(([key]) => !key.startsWith(`${memoryId}|`)));
  writePlanWatchReviewedChangesStore(reviewed);
  delete planWatchState.recentReviewedChanges[memoryId];
  if (typeof loadContinuityStore === "function" && typeof saveContinuityStore === "function") {
    const continuity = loadContinuityStore();
    delete continuity.plans?.[`memory:${memoryId}`];
    continuity.updatedAt = Date.now();
    saveContinuityStore(continuity);
    refreshPlanWatchBaselineStore(continuity);
  }
}

function readPlanWatchNotificationState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_NOTIFICATION_STATE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return { events: {} };
    return {
      events: parsed.events && typeof parsed.events === "object" ? parsed.events : {}
    };
  } catch {
    return { events: {} };
  }
}

function writePlanWatchNotificationState(stateValue) {
  try {
    const now = Date.now();
    const events = Object.entries(stateValue?.events || {})
      .filter(([, value]) => now - (Number(value) || 0) <= 7 * 24 * 60 * 60 * 1000)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, PLAN_WATCH_NOTIFICATION_MAX_EVENTS);
    localStorage.setItem(PLAN_WATCH_NOTIFICATION_STATE_KEY, JSON.stringify({
      events: Object.fromEntries(events)
    }));
  } catch {
    /* Notification dedupe is optional. */
  }
}

function cleanPlanWatchRecentUpdate(update = {}) {
  const at = Number(update.at || Date.now());
  const targetType = ["plan", "place", "watching"].includes(update.targetType)
    ? update.targetType
    : "watching";
  const targetId = String(update.targetId || "").trim().slice(0, 96);
  const title = planWatchCompactText(update.title || "Nearcast update", 90);
  const body = planWatchCompactText(update.body || "Nearcast found something worth checking.", 140);
  const tone = ["good", "caution", "watch", "pending", "neutral"].includes(update.tone)
    ? update.tone
    : "neutral";
  const key = String(update.key || [targetType, targetId, title, body].join("|"))
    .trim()
    .slice(0, 240);
  return {
    key,
    targetType,
    targetId,
    title,
    body,
    tone,
    at: Number.isFinite(at) && at > 0 ? at : Date.now()
  };
}

function readPlanWatchRecentUpdates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_RECENT_UPDATES_KEY) || "null");
    const raw = Array.isArray(parsed?.updates) ? parsed.updates : Array.isArray(parsed) ? parsed : [];
    const now = Date.now();
    return raw
      .map(cleanPlanWatchRecentUpdate)
      .filter((update) => now - update.at <= PLAN_WATCH_RECENT_UPDATE_MAX_AGE_MS)
      .sort((a, b) => b.at - a.at)
      .slice(0, PLAN_WATCH_RECENT_UPDATE_MAX_ITEMS);
  } catch {
    return [];
  }
}

function writePlanWatchRecentUpdates(updates) {
  try {
    const now = Date.now();
    const clean = (updates || [])
      .map(cleanPlanWatchRecentUpdate)
      .filter((update) => now - update.at <= PLAN_WATCH_RECENT_UPDATE_MAX_AGE_MS)
      .sort((a, b) => b.at - a.at)
      .slice(0, PLAN_WATCH_RECENT_UPDATE_MAX_ITEMS);
    localStorage.setItem(PLAN_WATCH_RECENT_UPDATES_KEY, JSON.stringify({ updates: clean }));
  } catch {
    /* Recent-update history is helpful, not required. */
  }
}

function recordPlanWatchRecentUpdate(update = {}, options = {}) {
  const clean = cleanPlanWatchRecentUpdate(update);
  const existing = readPlanWatchRecentUpdates().filter((item) => item.key !== clean.key);
  writePlanWatchRecentUpdates([clean, ...existing]);
  if (options.refresh !== false && typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
  return clean;
}

function planWatchRecentUpdateFromWatch(watch, options = {}) {
  if (!watch?.memory?.id) return null;
  const notification = watch.notification || planWeatherNotificationState(watch);
  return {
    key: `plan:${watch.memory.id}:${planWatchNotificationEventKey(watch)}`,
    targetType: "plan",
    targetId: watch.memory.id,
    tone: watch.tone || notification?.tone || "caution",
    title: planMemoryTitle(watch.memory),
    body: notification?.body || watch.change?.body || watch.reason || "Nearcast found a meaningful change.",
    at: options.at || Date.now()
  };
}

function planWatchRecentUpdateFromRoute(route = {}) {
  const memoryId = String(route.memoryId || "").trim();
  const placeId = String(route.placeId || "").trim();
  if (memoryId) {
    const memory = state.planMemories.find((item) => item.id === memoryId);
    return {
      key: `route:plan:${memoryId}:${route.source || "notification"}`,
      targetType: "plan",
      targetId: memoryId,
      tone: "caution",
      title: memory ? planMemoryTitle(memory) : "Watched plan",
      body: "Nearcast had a meaningful update for this plan.",
      at: Date.now()
    };
  }
  if (placeId) {
    const place = placeWatchSavedPlaces().find((item) => String(item?.id || "") === placeId);
    return {
      key: `route:place:${placeId}:${route.source || "notification"}`,
      targetType: "place",
      targetId: placeId,
      tone: "caution",
      title: place ? placeLabel(place) : "Saved place",
      body: "Nearcast had a meaningful update for this saved place.",
      at: Date.now()
    };
  }
  return {
    key: `route:watching:${route.source || "notification"}`,
    targetType: "watching",
    targetId: "",
    tone: "neutral",
    title: "Watching update",
    body: "Nearcast opened your watched weather.",
    at: Date.now()
  };
}

function planWatchNotificationTargetPath({
  target = "",
  memoryId = "",
  placeId = "",
  detail = "",
  signal = "",
  timeScope = "",
  mode = "",
  source = "plan-watch",
  receipt = null
} = {}) {
  if (typeof planWatchNotificationTargetUrl === "function") {
    return planWatchNotificationTargetUrl({ target, memoryId, placeId, detail, signal, timeScope, mode, source, receipt });
  }
  const params = new URLSearchParams();
  params.set("nearcast", "notification");
  params.set("target", target || (memoryId ? "plan" : placeId ? "place" : "watching"));
  if (memoryId) params.set("memoryId", memoryId);
  if (placeId) params.set("placeId", placeId);
  if (detail) params.set("detail", detail);
  if (signal) params.set("signal", signal);
  if (timeScope) params.set("timeScope", timeScope);
  if (mode) params.set("mode", mode);
  if (source) params.set("source", source);
  if (receipt && typeof receipt === "object") {
    const metric = receipt.metric && typeof receipt.metric === "object" ? receipt.metric : {};
    const receiptParams = {
      receiptKind: receipt.kind,
      receiptTone: receipt.tone,
      receiptDirection: receipt.direction,
      receiptHeadline: receipt.headline,
      receiptMetric: metric.label,
      receiptBefore: metric.before,
      receiptAfter: metric.after,
      receiptUnit: metric.unit,
      receiptWhy: receipt.why,
      receiptAction: receipt.action,
      receiptBaselineAt: receipt.baselineAt,
      receiptCheckedAt: receipt.checkedAt
    };
    Object.entries(receiptParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        params.set(key, planWatchCompactText(value, key.includes("At") ? 24 : 180));
      }
    });
  }
  return `./?${params.toString()}`;
}

function nearcastNotificationRouteFromLocation() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const marker = params.get("nearcast") || params.get("nearcastTarget") || "";
    const memoryId = (params.get("memoryId") || params.get("planId") || params.get("plan") || "").trim();
    const placeId = (params.get("placeId") || params.get("place") || "").trim();
    const alertId = (params.get("alertId") || params.get("alert") || "").trim();
    if (!memoryId && !placeId && !alertId && marker !== "notification") return null;
    const target = (params.get("target") || (memoryId ? "plan" : alertId ? "alerts" : placeId ? "place" : "watching")).trim();
    const detail = (params.get("detail") || params.get("kind") || "").trim();
    const signal = (params.get("signal") || params.get("type") || "").trim();
    const timeScope = (params.get("timeScope") || params.get("scope") || "").trim();
    const mode = (params.get("mode") || params.get("layer") || "").trim();
    const receiptKind = (params.get("receiptKind") || "").trim();
    const receipt = receiptKind ? {
      version: 1,
      kind: receiptKind,
      tone: (params.get("receiptTone") || "caution").trim(),
      direction: (params.get("receiptDirection") || "changed").trim(),
      headline: (params.get("receiptHeadline") || "Forecast changed").trim(),
      metric: {
        label: (params.get("receiptMetric") || "Forecast").trim(),
        before: (params.get("receiptBefore") || "Previous").trim(),
        after: (params.get("receiptAfter") || "Now").trim(),
        unit: (params.get("receiptUnit") || "").trim()
      },
      why: (params.get("receiptWhy") || "The forecast changed during this plan window.").trim(),
      action: (params.get("receiptAction") || "Review the plan window before you go.").trim(),
      baselineAt: Math.max(0, Number(params.get("receiptBaselineAt")) || 0),
      checkedAt: Math.max(0, Number(params.get("receiptCheckedAt")) || 0)
    } : null;
    return {
      marker,
      target,
      detail,
      signal,
      timeScope,
      mode,
      memoryId,
      placeId,
      alertId,
      receipt,
      source: (params.get("source") || "notification").trim(),
      signature: `${marker}|${target}|${detail}|${signal}|${timeScope}|${mode}|${memoryId}|${placeId}|${alertId}|${receipt?.checkedAt || ""}|${params.get("source") || ""}`
    };
  } catch {
    return null;
  }
}

function nearcastNotificationRoutePlace(route = nearcastNotificationRouteFromLocation()) {
  if (!route) return null;
  if (route.memoryId) {
    const memory = state.planMemories.find((item) => item.id === route.memoryId);
    return memory?.place || null;
  }
  if (route.placeId) {
    return placeWatchSavedPlaces().find((place) => String(place?.id || "") === route.placeId) || null;
  }
  return null;
}

function clearNearcastNotificationRouteUrl() {
  try {
    const url = new URL(window.location.href);
    [
      "nearcast",
      "nearcastTarget",
      "target",
      "memoryId",
      "planId",
      "plan",
      "placeId",
      "place",
      "alertId",
      "alert",
      "detail",
      "kind",
      "signal",
      "type",
      "timeScope",
      "scope",
      "mode",
      "layer",
      "receiptKind",
      "receiptTone",
      "receiptDirection",
      "receiptHeadline",
      "receiptMetric",
      "receiptBefore",
      "receiptAfter",
      "receiptUnit",
      "receiptWhy",
      "receiptAction",
      "receiptBaselineAt",
      "receiptCheckedAt",
      "source"
    ].forEach((key) => url.searchParams.delete(key));
    const clean = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", clean || "./");
  } catch {
    /* URL cleanup is best-effort. */
  }
}

function handleNearcastNotificationMessage(event) {
  const data = event?.data;
  if (!data || data.type !== "nearcast.notification.open") return;

  try {
    const url = new URL(data.url || "", window.location.href);
    if (url.origin !== window.location.origin) return;
    window.location.assign(url.href);
  } catch {
    /* Notification click fallback is best-effort. */
  }
}

function nearcastNotificationDetailKind(route = {}) {
  const value = String(route.detail || route.signal || route.target || "").toLowerCase();
  if (["feels", "rain", "wind", "air"].includes(value)) return value;
  if (value.includes("heat") || value.includes("feels") || value.includes("uv")) return "feels";
  if (value.includes("wind") || value.includes("gust")) return "wind";
  if (value.includes("air") || value.includes("smoke") || value.includes("pollen") || value.includes("aqi")) return "air";
  if (value.includes("rain") || value.includes("storm") || value.includes("precip") || value.includes("clear")) return "rain";
  return "";
}

function capturePlanWatchRouteReceipt(route = {}) {
  const memoryId = String(route.memoryId || "").trim();
  const memory = state.planMemories.find((item) => item.id === memoryId);
  const receipt = route.receipt;
  if (!memory || !receipt?.kind || !receipt?.headline) return null;
  const metric = receipt.metric || {};
  const body = metric.before && metric.after
    ? `${metric.label || "Forecast"} changed from ${metric.before} to ${metric.after}.`
    : receipt.why || "Weather changed during this plan window.";
  const change = {
    type: receipt.kind,
    tone: receipt.tone || "caution",
    notify: receipt.direction !== "better",
    priority: receipt.direction === "worse" ? 100 : 50,
    title: receipt.headline,
    body,
    receipt
  };
  const current = {
    memoryId,
    targetDate: memory.targetDate || "",
    startHour: memory.startHour,
    endHour: memory.endHour,
    placeKey: planWatchPlaceKey(memory.place || {}),
    tempUnit: state.unit === "fahrenheit" ? "F" : "C",
    windUnit: state.unit === "fahrenheit" ? "mph" : "km/h",
    savedAt: receipt.checkedAt || Date.now()
  };
  return capturePlanWatchChangeReceipt(current, { savedAt: receipt.baselineAt || 0 }, change);
}

function consumeNearcastNotificationRoute(options = {}) {
  const route = nearcastNotificationRouteFromLocation();
  if (!route || route.signature === planWatchNotificationRouteConsumed) return false;

  const wantsAlerts = route.target === "alerts" || Boolean(route.alertId) || (!route.memoryId && (route.detail === "alerts" || route.signal.includes("alert")));
  if (
    wantsAlerts &&
    !options.forceAlerts &&
    typeof activeAlertsReady !== "undefined" &&
    activeAlertsReady === false
  ) {
    return false;
  }

  planWatchNotificationRouteConsumed = route.signature;
  if (route.marker === "notification" && typeof recordForYouSignal === "function") {
    recordForYouSignal("notification-open");
  }
  const routedReceipt = capturePlanWatchRouteReceipt(route);
  const update = routedReceipt ? null : planWatchRecentUpdateFromRoute(route);
  if (update) recordPlanWatchRecentUpdate(update);
  clearNearcastNotificationRouteUrl();

  if (route.memoryId && state.planMemories.some((memory) => memory.id === route.memoryId)) {
    if (route.target === "plan-hourly" && typeof showPlanMemory === "function") {
      showPlanMemory(route.memoryId, { returnToPlanner: false, source: "notification" });
      return true;
    }
    openPlanWatchForMemory(route.memoryId, { source: "notification" });
    return true;
  }

  if (wantsAlerts && typeof openAlertSheet === "function" && Array.isArray(activeAlerts) && activeAlerts.length) {
    const opened = openAlertSheet(route.alertId || null);
    if (!opened && route.alertId) openAlertSheet();
    return true;
  }

  const detailKind = nearcastNotificationDetailKind(route);
  if (
    (route.target === "place-hourly" || route.target === "hourly") &&
    detailKind &&
    typeof openNotificationHourlyRoute === "function" &&
    openNotificationHourlyRoute(route, detailKind)
  ) {
    return true;
  }

  if ((route.target === "place-detail" || route.target === "place" || detailKind) && detailKind && typeof openGlanceDetail === "function") {
    openGlanceDetail(detailKind);
    return true;
  }

  if (route.target === "map" && typeof enterImmersiveMap === "function") {
    enterImmersiveMap();
    if (route.mode === "stormscope-available" && typeof openXweatherStormSheet === "function") {
      setTimeout(() => openXweatherStormSheet({ force: true }), 450);
    }
    return true;
  }

  if (route.placeId) {
    const place = placeWatchSavedPlaces().find((item) => String(item?.id || "") === route.placeId);
    if (place && state.activePlace && samePlanPlace(place, state.activePlace)) {
      openGlobalMemorySheet({ source: "notification" });
      return true;
    }
  }

  openGlobalMemorySheet({ source: "notification" });
  return true;
}

function planWatchNativeNotifications() {
  return window.NearcastNative?.notifications || null;
}

function planWatchNativeNotificationsSupported() {
  const native = planWatchNativeNotifications();
  return Boolean(native?.supported && typeof native.requestPermission === "function");
}

function planWatchWebNotificationsSupported() {
  return Boolean(
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

function planWatchNotificationsSupported() {
  return planWatchWebNotificationsSupported() || planWatchNativeNotificationsSupported();
}

function planWatchNotificationPermission() {
  const native = planWatchNativeNotifications();
  if (planWatchNativeNotificationsSupported() && typeof native.permission === "function") {
    return native.permission() || "default";
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission || "default";
}

async function requestPlanWatchNotificationPermission(reason = "plan-watch") {
  const native = planWatchNativeNotifications();
  if (planWatchNativeNotificationsSupported()) {
    const result = await native.requestPermission({ reason });
    if (result?.channel) writePlanWatchNativeChannel(result.channel);
    return {
      permission: result?.permission || "default",
      result
    };
  }
  const permission = await Notification.requestPermission();
  return { permission, result: { ok: permission === "granted", permission } };
}

function planWatchNotificationPreference() {
  try {
    return localStorage.getItem(PLAN_WATCH_NOTIFICATION_PREF_KEY) || "off";
  } catch {
    return "off";
  }
}

function writePlanWatchNotificationPreference(value) {
  try {
    localStorage.setItem(PLAN_WATCH_NOTIFICATION_PREF_KEY, value);
  } catch {
    /* Keep the current session working even if storage is unavailable. */
  }
}

function cleanPlanWatchNotificationPlans(value = {}) {
  const entries = Object.entries(value?.plans || {})
    .filter(([id, enabled]) => String(id || "").trim() && Boolean(enabled));
  if (!planWatchMemoryInventoryReady) {
    // planner.js loads before app.js hydrates plan memories. Preserve the raw
    // intent until that inventory is authoritative, otherwise an early bridge
    // callback could erase every selection.
    return { plans: Object.fromEntries(entries.map(([id]) => [String(id), true])) };
  }
  const memories = Array.isArray(state?.planMemories) ? state.planMemories : [];
  const activeIds = new Set(
    memories
      .filter((memory) => !planWatchMemoryIsPast(memory))
      .map((memory) => String(memory?.id || "").trim())
      .filter(Boolean)
  );
  const plans = Object.fromEntries(
    entries
      .filter(([id]) => activeIds.has(String(id)))
      .slice(0, PLAN_WATCH_MAX_NOTIFICATION_PLANS)
      .map(([id]) => [String(id), true])
  );
  return { plans };
}

function markPlanWatchMemoryInventoryReady() {
  if (planWatchMemoryInventoryReady) return;
  planWatchMemoryInventoryReady = true;
  const clean = readPlanWatchNotificationPlans();
  writePlanWatchNotificationPlans(clean);
}

function readPlanWatchNotificationPlans() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_NOTIFICATION_PLANS_KEY) || "null");
    const raw = parsed && typeof parsed === "object" && parsed.plans && typeof parsed.plans === "object"
      ? parsed
      : { plans: {} };
    const clean = cleanPlanWatchNotificationPlans(raw);
    if (JSON.stringify(raw.plans || {}) !== JSON.stringify(clean.plans)) {
      localStorage.setItem(PLAN_WATCH_NOTIFICATION_PLANS_KEY, JSON.stringify(clean));
    }
    return clean;
  } catch {
    return { plans: {} };
  }
}

function writePlanWatchNotificationPlans(value) {
  try {
    localStorage.setItem(
      PLAN_WATCH_NOTIFICATION_PLANS_KEY,
      JSON.stringify(cleanPlanWatchNotificationPlans(value))
    );
  } catch {
    /* Plan-level notification intent is optional. */
  }
}

function planWatchNotificationPlanEnabled(memoryId) {
  const id = String(memoryId || "").trim();
  if (!id) return false;
  return readPlanWatchNotificationPlans().plans[id] === true;
}

function setPlanWatchNotificationPlan(memoryId, enabled) {
  const id = String(memoryId || "").trim();
  if (!id) return false;
  const prefs = readPlanWatchNotificationPlans();
  if (enabled && !prefs.plans[id] && Object.keys(prefs.plans).length >= PLAN_WATCH_MAX_NOTIFICATION_PLANS) {
    return false;
  }
  if (enabled) prefs.plans[id] = true;
  else delete prefs.plans[id];
  writePlanWatchNotificationPlans(prefs);
  return planWatchNotificationPlanEnabled(id) === Boolean(enabled);
}

function planWatchNotificationSelectedCount() {
  return Object.keys(readPlanWatchNotificationPlans().plans).length;
}

function planWatchNotificationLimitReached(memoryId = "") {
  const id = String(memoryId || "").trim();
  return !planWatchNotificationPlanEnabled(id) &&
    planWatchNotificationSelectedCount() >= PLAN_WATCH_MAX_NOTIFICATION_PLANS;
}

function planWatchNotificationEnabledCount(watchItems) {
  return (watchItems || []).filter((watch) =>
    !watch?.isPast && planWatchNotificationPlanEnabled(watch?.memory?.id)
  ).length;
}

function readPlaceWatchNotificationPlaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLACE_WATCH_NOTIFICATION_PLACES_KEY) || "null");
    return parsed && typeof parsed === "object"
      ? {
          enabled: Boolean(parsed.enabled),
          selectedIds: Array.isArray(parsed.selectedIds)
            ? cleanPlaceWatchSelectedIds(parsed.selectedIds)
            : [],
          hasExplicitSelection: Array.isArray(parsed.selectedIds),
          updatedAt: parsed.updatedAt || ""
        }
      : { enabled: false, selectedIds: [], hasExplicitSelection: false, updatedAt: "" };
  } catch {
    return { enabled: false, selectedIds: [], hasExplicitSelection: false, updatedAt: "" };
  }
}

function writePlaceWatchNotificationPlaces(value) {
  try {
    const current = readPlaceWatchNotificationPlaces();
    const selectedIds = Array.isArray(value?.selectedIds)
      ? cleanPlaceWatchSelectedIds(value.selectedIds, { filterSaved: true })
      : cleanPlaceWatchSelectedIds(current.selectedIds, { filterSaved: true });
    localStorage.setItem(PLACE_WATCH_NOTIFICATION_PLACES_KEY, JSON.stringify({
      enabled: Boolean(value?.enabled),
      selectedIds,
      updatedAt: new Date().toISOString()
    }));
  } catch {
    /* Saved-place notification intent is optional. */
  }
}

function cleanPlaceWatchSelectedIds(ids, options = {}) {
  const savedIdSet = options.filterSaved ? placeWatchSavedPlaceIdSet() : null;
  const clean = [];
  const seen = new Set();
  (ids || []).forEach((value) => {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) return;
    if (savedIdSet && !savedIdSet.has(id)) return;
    seen.add(id);
    clean.push(id);
  });
  return clean.slice(0, PLACE_WATCH_MAX_SYNC_PLACES);
}

function placeWatchSavedPlaces() {
  return (typeof state !== "undefined" && Array.isArray(state.savedPlaces))
    ? state.savedPlaces
    : [];
}

function placeWatchSavedPlaceIdSet() {
  return new Set(placeWatchSavedPlaces().map((place) => String(place?.id || "").trim()).filter(Boolean));
}

function defaultPlaceWatchSelectedIds() {
  return placeWatchSavedPlaces()
    .map((place) => String(place?.id || "").trim())
    .filter(Boolean)
    .slice(0, PLACE_WATCH_MAX_SYNC_PLACES);
}

function placeWatchNotificationSelectedIds() {
  const prefs = readPlaceWatchNotificationPlaces();
  if (!prefs.enabled) return [];
  if (prefs.hasExplicitSelection) {
    return cleanPlaceWatchSelectedIds(prefs.selectedIds, { filterSaved: true });
  }
  return defaultPlaceWatchSelectedIds();
}

function placeWatchNotificationSelectedCount() {
  return placeWatchNotificationSelectedIds().length;
}

function placeWatchNotificationPlaceEnabled(placeId) {
  const id = String(placeId || "").trim();
  if (!id) return false;
  return placeWatchNotificationSelectedIds().includes(id);
}

function placeWatchNotificationPlaceCopy(placeId) {
  if (!placeWatchNotificationsRequested()) return null;
  const id = String(placeId || "").trim();
  if (!id) return null;
  const selectedIds = placeWatchNotificationSelectedIds();
  const pressed = selectedIds.includes(id);
  const atLimit = selectedIds.length >= PLACE_WATCH_MAX_SYNC_PLACES;
  return {
    label: pressed ? "Watching" : "Watch",
    aria: pressed ? "Stop watching this saved place" : "Watch this saved place",
    pressed,
    disabled: !pressed && atLimit,
    title: !pressed && atLimit
      ? `You can watch up to ${PLACE_WATCH_MAX_SYNC_PLACES} saved places.`
      : ""
  };
}

function togglePlaceWatchNotificationPlace(placeId) {
  const id = String(placeId || "").trim();
  if (!id || !placeWatchNotificationsRequested()) return;
  const selectedIds = placeWatchNotificationSelectedIds();
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else if (next.size < PLACE_WATCH_MAX_SYNC_PLACES) {
    next.add(id);
  } else {
    return;
  }
  writePlaceWatchNotificationPlaces({
    enabled: true,
    selectedIds: Array.from(next)
  });
  if (typeof renderSavedPlaces === "function") renderSavedPlaces();
  if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
  syncPlanWatchNotificationSubscription({ force: true, reason: "place-watch-selection" });
}

function prunePlaceWatchNotificationPlaces() {
  const prefs = readPlaceWatchNotificationPlaces();
  if (!prefs.hasExplicitSelection) return;
  const selectedIds = cleanPlaceWatchSelectedIds(prefs.selectedIds, { filterSaved: true });
  if (selectedIds.length === prefs.selectedIds.length) return;
  writePlaceWatchNotificationPlaces({
    enabled: prefs.enabled,
    selectedIds
  });
}

function placeWatchNotificationsRequested() {
  return readPlaceWatchNotificationPlaces().enabled === true;
}

function planWatchNotificationsEnabled() {
  return planWatchNotificationsSupported() &&
    planWatchNotificationPermission() === "granted" &&
    planWatchNotificationPreference() === "enabled";
}

function planWatchNativeDeliveryNotConfigured() {
  if (!planWatchNativeNotificationsSupported()) return false;
  const result = planWatchState.pushLastSyncResult || {};
  const reason = String(
    result.reason || result.state || result.error || planWatchState.pushLastAttemptReason || ""
  ).toLowerCase();
  const nativeState = String(planWatchState.pushConfig?.nativePush?.state || "").toLowerCase();
  return nativeState === "missing-apns-config" ||
    reason.includes("native-push-not-configured") ||
    reason.includes("missing-apns");
}

function planWatchRegistrationHealth() {
  const now = Date.now();
  const attemptAt = Math.max(0, Number(planWatchState.pushLastAttemptAt) || 0);
  const successAt = Math.max(0, Number(planWatchState.pushLastSuccessAt) || 0);
  const expiresAt = planWatchRegistrationExpiryTimestamp(planWatchState.pushRegistrationExpiresAt);
  let stateValue = planWatchState.pushLastAttemptState || "";
  if (stateValue === "pending" && attemptAt && now - attemptAt > 2 * 60 * 1000) {
    stateValue = "failed";
  }
  if (planWatchNativeDeliveryNotConfigured()) stateValue = "failed";
  const expired = stateValue === "ready" && successAt > 0 &&
    (!expiresAt || expiresAt <= now + PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS);
  if (expired) stateValue = "expired";
  return {
    state: stateValue,
    attemptAt,
    successAt,
    expiresAt,
    expired,
    reason: expired ? "registration-expired" : planWatchState.pushLastAttemptReason || "",
    ready: stateValue === "ready" && successAt > 0 && successAt >= attemptAt &&
      expiresAt > now + PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS
  };
}

function beginPlanWatchRegistrationAttempt() {
  const health = {
    lastAttemptAt: Date.now(),
    lastAttemptState: "pending",
    lastAttemptReason: "",
    lastSuccessAt: planWatchState.pushLastSuccessAt,
    registrationExpiresAt: planWatchState.pushRegistrationExpiresAt
  };
  planWatchState.pushLastAttemptAt = health.lastAttemptAt;
  planWatchState.pushLastAttemptState = health.lastAttemptState;
  planWatchState.pushLastAttemptReason = health.lastAttemptReason;
  writePlanWatchPushHealth(health);
}

function planWatchRegistrationResultSucceeded(result = {}) {
  const reason = String(result.reason || result.state || result.error || "").toLowerCase();
  if (result.ok === false) return false;
  if (/deleted|disabled|no-enabled|no-subscription|unregister|paused/.test(reason)) return false;
  const stored = result.state === "stored" || Boolean(result.subscriptionId) || result.ok === true;
  const expiresAt = planWatchRegistrationExpiryTimestamp(result.expiresAt);
  return stored && expiresAt > Date.now() + PLAN_WATCH_REGISTRATION_EXPIRY_SKEW_MS;
}

function completePlanWatchRegistrationAttempt(result = {}) {
  const ready = planWatchRegistrationResultSucceeded(result);
  const now = Date.now();
  const expiresAt = planWatchRegistrationExpiryTimestamp(result.expiresAt);
  const accepted = result.ok !== false && (
    result.state === "stored" || Boolean(result.subscriptionId) || result.ok === true
  );
  const expiryFailure = accepted && !ready
    ? expiresAt ? "registration-expired" : "registration-expiry-missing"
    : "";
  planWatchState.pushLastAttemptState = ready ? "ready" : "failed";
  planWatchState.pushLastAttemptReason = ready
    ? ""
    : planWatchCompactText(
        expiryFailure || result.reason || result.error || result.state || "registration-failed",
        120
      );
  if (ready) {
    planWatchState.pushLastSuccessAt = now;
    planWatchState.pushRegistrationExpiresAt = expiresAt;
  }
  writePlanWatchPushHealth({
    lastAttemptAt: planWatchState.pushLastAttemptAt || now,
    lastAttemptState: planWatchState.pushLastAttemptState,
    lastAttemptReason: planWatchState.pushLastAttemptReason,
    lastSuccessAt: planWatchState.pushLastSuccessAt,
    registrationExpiresAt: planWatchState.pushRegistrationExpiresAt
  });
  if (typeof recordForYouSignal === "function") {
    recordForYouSignal(ready ? "notification-registration-ready" : "notification-registration-failed");
  }
  return ready;
}

function planWatchPushSupported() {
  return typeof fetch === "function" && (
    planWatchNativeNotificationsSupported() ||
    (planWatchWebNotificationsSupported() && "PushManager" in window)
  );
}

function readPlanWatchNativeChannel() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAN_WATCH_NATIVE_CHANNEL_KEY) || "null");
    return parsed && typeof parsed === "object" && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function writePlanWatchNativeChannel(channel) {
  if (!channel?.token) return;
  try {
    localStorage.setItem(PLAN_WATCH_NATIVE_CHANNEL_KEY, JSON.stringify(channel));
  } catch {
    /* Native channel caching is optional. */
  }
}

function readPlanWatchNativeSubscriptionId() {
  try {
    return localStorage.getItem(PLAN_WATCH_NATIVE_SUBSCRIPTION_ID_KEY) || "";
  } catch {
    return "";
  }
}

function writePlanWatchNativeSubscriptionId(subscriptionId) {
  try {
    if (subscriptionId) localStorage.setItem(PLAN_WATCH_NATIVE_SUBSCRIPTION_ID_KEY, subscriptionId);
    else localStorage.removeItem(PLAN_WATCH_NATIVE_SUBSCRIPTION_ID_KEY);
  } catch {
    /* Native channel caching is optional. */
  }
}

function planWatchEndpoint(path) {
  try {
    return new URL(path, window.location.href).toString();
  } catch {
    return path;
  }
}

async function planWatchPushConfig() {
  if (planWatchState.pushConfig) return planWatchState.pushConfig;
  if (planWatchState.pushConfigPromise) return planWatchState.pushConfigPromise;
  planWatchState.pushConfigPromise = fetch(planWatchEndpoint(PLAN_WATCH_PUSH_CONFIG_ENDPOINT), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store"
  }).then(async (response) => {
    if (!response.ok) throw new Error("Plan watch push config unavailable.");
    const config = await response.json();
    planWatchState.pushConfig = config;
    return config;
  }).catch((error) => {
    planWatchState.pushConfig = {
      provider: "nearcast-plan-watch-notifications",
      push: { state: "unavailable", reason: cleanError(error) || "config-unavailable" },
      nativePush: { state: "unknown" },
      storage: { state: "unknown" }
    };
    return planWatchState.pushConfig;
  }).finally(() => {
    planWatchState.pushConfigPromise = null;
  });
  return planWatchState.pushConfigPromise;
}

function planWatchVapidKeyBytes(publicKey) {
  const value = String(publicKey || "").trim();
  if (!value) return null;
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function ensurePlanWatchPushSubscription() {
  if (!planWatchPushSupported()) return { subscription: null, reason: "push-unsupported" };
  const config = await planWatchPushConfig();
  if (planWatchNativeNotificationsSupported()) {
    const native = planWatchNativeNotifications();
    const result = await native.requestPermission({ reason: "plan-watch-sync" });
    if (result?.channel) {
      writePlanWatchNativeChannel(result.channel);
      return {
        subscription: null,
        nativeChannel: result.channel,
        config,
        reason: "native-channel"
      };
    }
    return {
      subscription: null,
      nativeChannel: null,
      config,
      reason: result?.reason || result?.state || "native-channel-unavailable"
    };
  }
  const publicKey = config?.push?.vapidPublicKey || "";
  if (!publicKey) return { subscription: null, reason: config?.push?.state || "missing-vapid-key" };
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return { subscription: existing, config, reason: "existing-subscription" };
  const applicationServerKey = planWatchVapidKeyBytes(publicKey);
  if (!applicationServerKey) return { subscription: null, config, reason: "invalid-vapid-key" };
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });
  return { subscription, config, reason: "created-subscription" };
}

function planWatchNotificationSyncPlans() {
  const watchById = new Map(currentPlanWatchItems().map((watch) => [watch.memory.id, watch]));
  return (state.planMemories || [])
    .filter((memory) => planWatchNotificationPlanEnabled(memory.id))
    .filter((memory) => !planWatchMemoryIsPast(memory))
    .map((memory) => planWatchServerPlanFromMemory(memory, watchById.get(memory.id)))
    .filter(Boolean)
    .slice(0, PLAN_WATCH_MAX_NOTIFICATION_PLANS);
}

function planWatchMemoryIsPast(memory) {
  if (!memory?.targetDate) return false;
  const endHour = Number.isFinite(Number(memory.endHour)) ? Number(memory.endHour) : 23.99;
  const end = new Date(`${memory.targetDate}T${String(Math.floor(endHour)).padStart(2, "0")}:00:00`);
  if (!Number.isFinite(end.getTime())) return false;
  return end.getTime() < Date.now() - 60 * 60 * 1000;
}

function planWatchServerPlanFromMemory(memory, watch = null) {
  const place = memory?.place;
  if (!memory?.id || !place) return null;
  const notification = watch?.notification || (watch ? planWeatherNotificationState(watch) : null);
  const receipt = watch?.receipt || (watch && typeof planWeatherReceiptText === "function" ? planWeatherReceiptText(watch) : "");
  return {
    id: memory.id,
    title: planMemoryTitle(memory),
    targetDate: memory.targetDate || "",
    startHour: Number(memory.startHour),
    endHour: Number(memory.endHour),
    place: {
      name: place.name || "",
      admin1: place.admin1 || "",
      country: place.country || "",
      countryCode: placeCountryCode(place),
      latitude: Number(place.latitude),
      longitude: Number(place.longitude)
    },
    lastKnown: {
      eventKey: watch ? planWatchNotificationEventKey(watch) : "",
      signal: notification?.signal || watch?.change?.type || watch?.tone || "",
      tone: watch?.tone || "",
      label: watch?.label || "",
      reason: watch?.reason || "",
      body: notification?.body || watch?.change?.body || "",
      receipt,
      checkedAt: new Date().toISOString(),
      snapshot: watch && typeof planWeatherChangeSnapshot === "function" ? planWeatherChangeSnapshot(watch) : null
    }
  };
}

function placeWatchNotificationSyncPlaces() {
  if (!placeWatchNotificationsRequested()) return [];
  const selectedIds = new Set(placeWatchNotificationSelectedIds());
  if (!selectedIds.size) return [];
  return (state.savedPlaces || [])
    .filter((place) => selectedIds.has(String(place?.id || "").trim()))
    .map(placeWatchServerPlaceFromSavedPlace)
    .filter(Boolean)
    .slice(0, PLACE_WATCH_MAX_SYNC_PLACES);
}

function placeWatchServerPlaceFromSavedPlace(place) {
  if (!place) return null;
  const normalized = typeof normalizePlace === "function" ? normalizePlace(place) : place;
  const latitude = Number(normalized.latitude);
  const longitude = Number(normalized.longitude);
  if (!normalized?.id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const countryCode = typeof placeCountryCode === "function"
    ? placeCountryCode(normalized)
    : normalized.countryCode || normalized.country_code || "";
  return {
    id: normalized.id,
    place: {
      name: normalized.name || "",
      admin1: normalized.admin1 || "",
      country: normalized.country || "",
      countryCode,
      latitude,
      longitude
    }
  };
}

function planWatchPushPlatform() {
  if (planWatchNativeNotificationsSupported()) {
    return {
      kind: "ios-apns",
      userAgent: navigator.userAgent || "",
      standalone: true,
      displayMode: "native"
    };
  }
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches ||
    navigator.standalone === true;
  return {
    kind: "web-push",
    userAgent: navigator.userAgent || "",
    standalone,
    displayMode: standalone ? "standalone" : "browser"
  };
}

function planWatchPushClient() {
  return {
    appVersion: typeof VERSION === "string" ? VERSION : "",
    locale: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    unit: state.unit || ""
  };
}

async function postPlanWatchPush(endpoint, body) {
  const response = await fetch(planWatchEndpoint(endpoint), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("Plan watch push sync failed.");
  return response.json().catch(() => ({}));
}

async function unregisterPlanWatchPushSubscription(options = {}) {
  if (!planWatchPushSupported()) return { ok: false, reason: "push-unsupported" };
  if (planWatchNativeNotificationsSupported()) {
    const subscriptionId = readPlanWatchNativeSubscriptionId();
    const nativeChannel = readPlanWatchNativeChannel() || planWatchNativeNotifications()?.channel?.() || null;
    if (!subscriptionId && !nativeChannel?.token) {
      const noNativeChannel = { ok: true, reason: "no-native-channel" };
      planWatchState.pushLastSyncResult = noNativeChannel;
      return noNativeChannel;
    }
    const config = await planWatchPushConfig();
    const endpoint = config?.push?.unregisterUrl || PLAN_WATCH_PUSH_UNREGISTER_ENDPOINT;
    const result = await postPlanWatchPush(endpoint, {
      provider: "nearcast-plan-watch-notification-client",
      version: 1,
      subscriptionId,
      nativeChannel,
      client: planWatchPushClient(),
      reason: options.reason || "disabled"
    }).catch((error) => ({ ok: false, reason: cleanError(error) || "native-unregister-failed" }));
    if (result.ok !== false && options.unsubscribe !== false) {
      writePlanWatchNativeSubscriptionId("");
    }
    planWatchState.pushLastSyncResult = result;
    return result;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const noSubscription = { ok: true, reason: "no-subscription" };
      planWatchState.pushLastSyncResult = noSubscription;
      return noSubscription;
    }
    const config = await planWatchPushConfig();
    const endpoint = config?.push?.unregisterUrl || PLAN_WATCH_PUSH_UNREGISTER_ENDPOINT;
    const result = await postPlanWatchPush(endpoint, {
      provider: "nearcast-plan-watch-notification-client",
      version: 1,
      subscription: subscription.toJSON(),
      client: planWatchPushClient(),
      reason: options.reason || "disabled"
    }).catch((error) => ({ ok: false, reason: cleanError(error) || "unregister-failed" }));
    if (options.unsubscribe !== false) await subscription.unsubscribe().catch(() => false);
    planWatchState.pushLastSyncResult = result;
    return result;
  } catch (error) {
    const result = { ok: false, reason: cleanError(error) || "unregister-failed" };
    planWatchState.pushLastSyncResult = result;
    return result;
  }
}

async function syncPlanWatchNotificationSubscription(options = {}) {
  if (!planWatchPushSupported()) return { ok: false, reason: "push-unsupported" };
  const now = Date.now();
  if (!options.force && now - planWatchState.pushLastSyncAt < PLAN_WATCH_PUSH_SYNC_THROTTLE_MS) {
    return { ok: true, reason: "sync-throttled" };
  }
  if (planWatchState.pushSyncPromise) return planWatchState.pushSyncPromise;
  let attemptedRegistration = false;
  planWatchState.pushSyncPromise = (async () => {
    planWatchState.pushLastSyncAt = Date.now();
    if (!planWatchNotificationsEnabled()) {
      return unregisterPlanWatchPushSubscription({ reason: options.reason || "notifications-disabled" });
    }
    const plans = planWatchNotificationSyncPlans();
    const places = placeWatchNotificationSyncPlaces();
    if (!plans.length && !places.length) {
      return unregisterPlanWatchPushSubscription({ reason: options.reason || "no-enabled-watches" });
    }
    attemptedRegistration = true;
    beginPlanWatchRegistrationAttempt();
    refreshPlanWatchDeliveryUI();
    const { subscription, nativeChannel, config, reason } = await ensurePlanWatchPushSubscription();
    if (!subscription && !nativeChannel) return { ok: false, reason };
    const endpoint = config?.push?.registerUrl || PLAN_WATCH_PUSH_REGISTER_ENDPOINT;
    const subscriptionPayload = subscription?.toJSON ? subscription.toJSON() : subscription;
    const result = await postPlanWatchPush(endpoint, {
      provider: "nearcast-plan-watch-notification-client",
      version: 1,
      subscription: subscriptionPayload,
      nativeChannel,
      plans,
      places,
      platform: planWatchPushPlatform(),
      client: planWatchPushClient(),
      reason: options.reason || "sync"
    });
    if (nativeChannel && result.subscriptionId) {
      writePlanWatchNativeChannel(nativeChannel);
      writePlanWatchNativeSubscriptionId(result.subscriptionId);
    }
    return result;
  })().then((result) => {
    planWatchState.pushLastSyncResult = result;
    if (attemptedRegistration) completePlanWatchRegistrationAttempt(result);
    reportPlanWatchNotificationSyncResult(result);
    refreshPlanWatchDeliveryUI();
    return result;
  }).catch((error) => {
    const result = { ok: false, reason: cleanError(error) || "sync-failed" };
    planWatchState.pushLastSyncResult = result;
    if (attemptedRegistration) completePlanWatchRegistrationAttempt(result);
    reportPlanWatchNotificationSyncResult(result);
    refreshPlanWatchDeliveryUI();
    return result;
  }).finally(() => {
    planWatchState.pushSyncPromise = null;
  });
  return planWatchState.pushSyncPromise;
}

function refreshPlanWatchDeliveryUI() {
  if (typeof renderAsk === "function") renderAsk();
  if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
  if (typeof refreshPlanAwareLaunchSurfaces === "function") refreshPlanAwareLaunchSurfaces();
}

function reportPlanWatchNotificationSyncResult(result) {
  if (!result || result.ok !== false || typeof setStatus !== "function") return;
  const reason = String(result.reason || result.error || "").toLowerCase();
  if (reason.includes("native") || reason.includes("apns")) {
    setStatus("Native notification delivery needs server setup before it can send.", true);
    if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
  }
}

function planWatchNotificationPlanCopy(memoryId) {
  const id = String(memoryId || "").trim();
  const supported = planWatchNotificationsSupported();
  const permission = planWatchNotificationPermission();
  if (!supported) {
    return {
      label: "Notifications unavailable",
      aria: "Device notifications are unavailable in this browser",
      pressed: false,
      disabled: true
    };
  }
  if (permission === "denied") {
    return {
      label: "Notifications blocked",
      aria: "Notifications are blocked in browser settings",
      pressed: false,
      disabled: true
    };
  }
  if (id && planWatchNotificationLimitReached(id)) {
    return {
      label: "3-plan limit",
      aria: "Notifications are already on for three plans; turn one off before enabling this plan",
      title: "Up to three active plans can notify this device.",
      pressed: false,
      disabled: true,
      action: "limit"
    };
  }
  if (id && planWatchNotificationPlanEnabled(id) && planWatchNotificationsEnabled()) {
    const delivery = planWatchRegistrationHealth();
    if (planWatchNativeDeliveryNotConfigured()) {
      return {
        label: "Turn notifications off",
        aria: "Turn off notifications for this plan; native delivery is unavailable",
        pressed: true,
        disabled: false,
        action: "disable"
      };
    }
    if (delivery.state === "failed" || delivery.state === "expired") {
      return {
        label: delivery.state === "expired" ? "Renew delivery" : "Retry delivery",
        aria: delivery.state === "expired"
          ? "Renew notification delivery for this plan"
          : "Retry notification delivery for this plan",
        pressed: true,
        disabled: false,
        action: "retry"
      };
    }
    if (delivery.state === "pending" || !delivery.ready) {
      return {
        label: "Setting up…",
        aria: "Notification delivery is being set up for this plan",
        pressed: true,
        disabled: true,
        action: "pending"
      };
    }
    return {
      label: "Notifications on",
      aria: "Turn off notifications for this plan",
      pressed: true,
      disabled: false,
      action: "disable"
    };
  }
  if (id && planWatchNotificationPlanEnabled(id)) {
    return {
      label: "Resume notifications",
      aria: "Resume notifications for this plan",
      pressed: true,
      disabled: false,
      action: "resume"
    };
  }
  return {
    label: "Notify me",
    aria: "Notify me if this plan changes",
    pressed: false,
    disabled: false,
    action: "enable"
  };
}

async function requestPlanWatchNotifications(memoryId = "") {
  const planId = String(memoryId || "").trim();
  const wasSelected = Boolean(planId && planWatchNotificationPlanEnabled(planId));
  const planCopy = planId ? planWatchNotificationPlanCopy(planId) : null;
  if (!planWatchNotificationsSupported()) {
    renderGlobalMemorySheet();
    return;
  }
  if (planId && planCopy?.action === "limit") {
    if (typeof setStatus === "function") {
      setStatus("Notifications are already on for 3 plans. Turn one off in Watching first.", true);
    }
    refreshPlanWatchDeliveryUI();
    return;
  }
  if (planId && planWatchNotificationPlanEnabled(planId) && planWatchNotificationsEnabled()) {
    if (planCopy?.action === "retry") {
      syncPlanWatchNotificationSubscription({ force: true, reason: "plan-retry" });
      return;
    }
    if (planCopy?.action === "pending") return;
    setPlanWatchNotificationPlan(planId, false);
    renderGlobalMemorySheet();
    if (typeof refreshPlanAwareLaunchSurfaces === "function") refreshPlanAwareLaunchSurfaces();
    syncPlanWatchNotificationSubscription({ force: true, reason: "plan-disabled" });
    return;
  }
  if (!planId && planWatchNotificationsEnabled()) {
    writePlanWatchNotificationPreference("off");
    renderGlobalMemorySheet();
    if (typeof refreshPlanAwareLaunchSurfaces === "function") refreshPlanAwareLaunchSurfaces();
    unregisterPlanWatchPushSubscription({ reason: "paused-all" });
    return;
  }

  let permission = planWatchNotificationPermission();
  if (permission !== "granted") {
    const permissionResult = await requestPlanWatchNotificationPermission("plan-watch");
    permission = permissionResult.permission;
  }
  writePlanWatchNotificationPreference(permission === "granted" ? "enabled" : "off");
  if (permission === "granted" && planId) {
    const selected = setPlanWatchNotificationPlan(planId, true);
    if (!selected && typeof setStatus === "function") {
      setStatus("Notifications are already on for 3 plans. Turn one off in Watching first.", true);
    }
    if (selected && !wasSelected && typeof recordForYouSignal === "function") {
      recordForYouSignal("notification-opt-in");
    }
  }
  renderGlobalMemorySheet();
  if (typeof refreshPlanAwareLaunchSurfaces === "function") refreshPlanAwareLaunchSurfaces();
  if (permission === "granted") {
    syncPlanWatchNotificationSubscription({ force: true, reason: planWatchNativeNotificationsSupported() ? "native-permission-granted" : "permission-granted" });
    maybeSyncPlanWatchNotifications(null, { userInitiated: true });
  }
}

async function requestPlaceWatchNotifications() {
  if (!planWatchNotificationsSupported()) {
    if (typeof renderSavedPlaces === "function") renderSavedPlaces();
    if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
    return;
  }
  const prefs = readPlaceWatchNotificationPlaces();
  if (placeWatchNotificationsRequested() && planWatchNotificationsEnabled()) {
    writePlaceWatchNotificationPlaces({
      enabled: false,
      selectedIds: placeWatchNotificationSelectedIds()
    });
    if (typeof renderSavedPlaces === "function") renderSavedPlaces();
    if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
    syncPlanWatchNotificationSubscription({ force: true, reason: "place-watch-disabled" });
    return;
  }

  let permission = planWatchNotificationPermission();
  if (permission !== "granted") {
    const permissionResult = await requestPlanWatchNotificationPermission("place-watch");
    permission = permissionResult.permission;
  }
  writePlanWatchNotificationPreference(permission === "granted" ? "enabled" : "off");
  const selectedIds = prefs.hasExplicitSelection
    ? cleanPlaceWatchSelectedIds(prefs.selectedIds, { filterSaved: true })
    : defaultPlaceWatchSelectedIds();
  writePlaceWatchNotificationPlaces({
    enabled: permission === "granted",
    selectedIds
  });
  if (typeof renderSavedPlaces === "function") renderSavedPlaces();
  if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
  if (permission === "granted") {
    syncPlanWatchNotificationSubscription({ force: true, reason: planWatchNativeNotificationsSupported() ? "native-place-watch-enabled" : "place-watch-enabled" });
  }
}

function planWatchNotificationPanelCopy(watchItems) {
  const count = (watchItems || []).filter((watch) => !watch.isPast).length;
  const enabledCount = planWatchNotificationEnabledCount(watchItems);
  const supported = planWatchNotificationsSupported();
  const permission = planWatchNotificationPermission();
  const enabled = planWatchNotificationsEnabled();
  const nativeDeliveryMissing = planWatchNativeDeliveryNotConfigured();
  const delivery = planWatchRegistrationHealth();
  if (!supported) {
    return {
      tone: "pending",
      title: "Watching ready",
      body: "Nearcast can track changes here. Device notifications need browser support and a secure installed app.",
      button: "",
      meta: count ? `${count} active` : "No active plans"
    };
  }
  if (permission === "denied") {
    return {
      tone: "caution",
      title: "Notifications blocked",
      body: "Nearcast still watches in the app. Change browser notification settings to receive notifications.",
      button: "",
      meta: "Blocked"
    };
  }
  if (enabled) {
    if (nativeDeliveryMissing || delivery.state === "failed" || delivery.state === "expired") {
      return {
        tone: "caution",
        title: nativeDeliveryMissing
          ? "Native delivery needs setup"
          : delivery.state === "expired" ? "Notification delivery needs renewal" : "Notification delivery needs attention",
        body: nativeDeliveryMissing
          ? "This iPhone can allow notifications, but Nearcast needs APNs server setup before it can send them outside the app."
          : delivery.state === "expired"
            ? "The last confirmed registration expired. Nearcast is still watching in the app; renew delivery from the selected plan."
            : "The last registration attempt failed. Nearcast is still watching in the app; retry delivery from the selected plan.",
        button: "",
        meta: "Not delivering"
      };
    }
    if (enabledCount && !delivery.ready) {
      return {
        tone: "neutral",
        title: "Finishing notification setup",
        body: "The plan is saved and being watched. Nearcast has not confirmed delivery for this device yet.",
        button: "",
        meta: "Setting up"
      };
    }
    return {
      tone: enabledCount ? "good" : "neutral",
      title: enabledCount
        ? `Notifications on for ${enabledCount} ${enabledCount === 1 ? "plan" : "plans"}`
        : "Choose which plans notify you",
      body: enabledCount
        ? "Nearcast will only notify when those plans meaningfully change."
        : "Open a watched plan and tap Notify me to opt into that plan.",
      button: enabledCount ? "Pause all" : "",
      meta: count ? `${count} active` : "Allowed"
    };
  }
  return {
    tone: "neutral",
    title: "Notify on meaningful changes",
    body: "Enable notifications, then choose the plans that should be allowed to send a heads-up.",
    button: "Enable",
    meta: count ? `${count} active` : "Optional"
  };
}

function renderPlanWatchNotificationPanel(watchItems, options = {}) {
  const copy = planWatchNotificationPanelCopy(watchItems);
  const compactClass = options.compact ? " is-compact" : "";
  return `
    <section class="plan-watch-notify${compactClass} is-${escapeHtml(copy.tone)}">
      <div class="plan-watch-notify-main">
        <span>${escapeHtml(copy.meta)}</span>
        <strong>${escapeHtml(copy.title)}</strong>
        <small>${escapeHtml(copy.body)}</small>
      </div>
      ${copy.button ? `<button type="button" data-watch-notify>${escapeHtml(copy.button)}</button>` : ""}
    </section>
  `;
}

function formatPlanWatchRelativeTimestamp(value) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(time) || time <= 0) return "";
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const future = diff < -1000;
  const unit = future ? "from now" : "ago";
  if (abs < 45 * 1000) return future ? "in a moment" : "just now";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) {
    const count = Math.max(1, Math.round(abs / minute));
    return `${count} min ${unit}`;
  }
  if (abs < day) {
    const count = Math.max(1, Math.round(abs / hour));
    return `${count} hr ${unit}`;
  }
  const count = Math.max(1, Math.round(abs / day));
  return `${count} day${count === 1 ? "" : "s"} ${unit}`;
}

function latestPlanWatchNotificationEventAt() {
  const values = Object.values(readPlanWatchNotificationState().events || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 0;
}

function planWatchActivityRows(watchItems) {
  const active = (watchItems || []).filter((watch) => !watch?.isPast);
  const enabledPlans = planWatchNotificationEnabledCount(active);
  const notificationsReady = planWatchNotificationsEnabled();
  const nativeDeliveryMissing = planWatchNativeDeliveryNotConfigured();
  const placesRequested = placeWatchNotificationsRequested();
  const selectedPlaces = placeWatchNotificationSelectedCount();
  const savedPlaces = placeWatchSavedPlaces().length;
  const delivery = planWatchRegistrationHealth();
  const lastAttempt = formatPlanWatchRelativeTimestamp(delivery.attemptAt);
  const lastSuccess = formatPlanWatchRelativeTimestamp(delivery.successAt);
  const lastSignal = formatPlanWatchRelativeTimestamp(latestPlanWatchNotificationEventAt());
  const notificationState = notificationsReady
    ? nativeDeliveryMissing
      ? "Delivery setup needed"
      : delivery.state === "failed" || delivery.state === "expired"
        ? delivery.state === "expired" ? "Delivery expired" : "Delivery failed"
        : delivery.ready
          ? "Notifications ready"
          : "Delivery not confirmed"
    : planWatchNotificationPermission() === "denied"
      ? "Notifications blocked"
      : "In-app watching";
  const planNotifyText = enabledPlans
    ? notificationsReady
      ? `${enabledPlans} can notify`
      : `${enabledPlans} selected`
    : "";
  const savedPlaceText = savedPlaces
    ? placesRequested
      ? `${selectedPlaces}/${PLACE_WATCH_MAX_SYNC_PLACES} selected${notificationsReady ? "" : " · off"}`
      : "Not watching"
    : "None saved";
  const rows = [
    {
      label: "Plans",
      value: active.length
        ? `${active.length} active${planNotifyText ? ` · ${planNotifyText}` : ""}`
        : "None yet"
    },
    {
      label: "Saved places",
      value: savedPlaceText
    },
    {
      label: "Status",
      value: notificationState
    }
  ];
  if (lastAttempt) {
    const attemptState = delivery.state === "ready"
      ? "Succeeded"
      : delivery.state === "expired" ? "Expired" : delivery.state === "failed" ? "Failed" : "In progress";
    rows.push({ label: "Last attempt", value: `${attemptState} · ${lastAttempt}` });
  }
  if (lastSuccess) {
    rows.push({ label: "Last success", value: lastSuccess });
  } else if (notificationsReady && (enabledPlans || selectedPlaces)) {
    rows.push({ label: "Last success", value: "None yet" });
  }
  if (lastSignal) {
    rows.push({ label: "Last matched change", value: lastSignal });
  }
  return rows;
}

function renderPlanWatchActivityPanel(watchItems, options = {}) {
  const rows = planWatchActivityRows(watchItems);
  const compactClass = options.compact ? " is-compact" : "";
  const deliveryReady = planWatchNotificationsEnabled() && planWatchRegistrationHealth().ready;
  const body = planWatchNotificationsEnabled()
    ? planWatchNativeDeliveryNotConfigured()
      ? "Nearcast will still check enabled plans and saved places in the app. Native delivery needs server setup before it can interrupt you."
      : planWatchRegistrationHealth().ready
        ? "Nearcast will check enabled plans and saved places, then interrupt only for meaningful changes."
        : "Nearcast is watching in the app, but notification delivery has not been confirmed for this device."
    : "Nearcast still checks watched plans in the app. Turn on notifications when you want phone/browser updates.";
  return `
    <section class="plan-watch-activity${compactClass}">
      <div class="plan-watch-activity-head">
        <span>Watching activity</span>
        <strong>${deliveryReady ? "Notification delivery is confirmed" : "Watching is active in the app"}</strong>
        <small>${escapeHtml(body)}</small>
      </div>
      <dl class="plan-watch-activity-list">
        ${rows.map((row) => `
          <div>
            <dt>${escapeHtml(row.label)}</dt>
            <dd>${escapeHtml(row.value)}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function renderPlanWatchRecentUpdates() {
  const updates = readPlanWatchRecentUpdates();
  if (!updates.length) return "";
  return `
    <section class="plan-watch-recent-updates">
      <div class="plan-watch-recent-head">
        <span>Latest calls</span>
        <strong>What changed recently</strong>
        <small>Meaningful plan or place changes Nearcast noticed on this device.</small>
      </div>
      <div class="plan-watch-recent-list">
        ${updates.slice(0, 3).map((update) => {
          const memory = update.targetType === "plan"
            ? state.planMemories.find((item) => item.id === update.targetId)
            : null;
          const place = update.targetType === "place"
            ? placeWatchSavedPlaces().find((item) => String(item?.id || "") === update.targetId)
            : null;
          const action = memory
            ? `<button type="button" data-memory-show="${escapeHtml(memory.id)}">Open plan</button>`
            : place
              ? `<button type="button" data-notification-place="${escapeHtml(place.id)}">Open place</button>`
              : "";
          return `
            <article class="plan-watch-recent-item is-${escapeHtml(update.tone || "neutral")}">
              <div>
                <span>${escapeHtml(formatPlanWatchRelativeTimestamp(update.at) || "recently")}</span>
                <strong>${escapeHtml(update.title)}</strong>
                <small>${escapeHtml(update.body)}</small>
              </div>
              ${action}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function planWatchNotificationHubStatus(watchItems) {
  const active = (watchItems || []).filter((watch) => !watch?.isPast);
  const supported = planWatchNotificationsSupported();
  const permission = planWatchNotificationPermission();
  const enabled = planWatchNotificationsEnabled();
  const nativeDeliveryMissing = planWatchNativeDeliveryNotConfigured();
  const planTargets = planWatchNotificationEnabledCount(active);
  const placeTargets = placeWatchNotificationSelectedCount();
  const placeRequested = placeWatchNotificationsRequested();
  const totalTargets = planTargets + (placeRequested ? placeTargets : 0);
  const delivery = planWatchRegistrationHealth();
  if (!supported) {
    return {
      tone: "pending",
      eyebrow: "In-app only",
      title: "Nearcast can watch, but cannot notify this device",
      body: "You will still see important plan and saved-place changes when you open the app.",
      primary: "",
      primaryLabel: ""
    };
  }
  if (permission === "denied") {
    return {
      tone: "caution",
      eyebrow: "Blocked",
      title: "Notifications are blocked",
      body: "Nearcast still watches in the app. Change browser notification settings if you want notifications outside the app.",
      primary: "",
      primaryLabel: ""
    };
  }
  if (enabled && totalTargets) {
    if (nativeDeliveryMissing) {
      return {
        tone: "caution",
        eyebrow: "Setup needed",
        title: "Native delivery needs server setup",
        body: "This iPhone is allowed and saved, but Nearcast needs APNs credentials before it can send notifications outside the app.",
        primary: "pause",
        primaryLabel: "Pause all"
      };
    }
    if (delivery.state === "expired") {
      const succeeded = formatPlanWatchRelativeTimestamp(delivery.successAt);
      return {
        tone: "caution",
        eyebrow: "Renewal needed",
        title: "Notification registration expired",
        body: `Nearcast is still watching in the app${succeeded ? ` · last successful sync ${succeeded}` : ""}. Renew delivery before expecting another notification.`,
        primary: "retry",
        primaryLabel: "Renew delivery"
      };
    }
    if (delivery.state === "failed") {
      const attempted = formatPlanWatchRelativeTimestamp(delivery.attemptAt);
      const succeeded = formatPlanWatchRelativeTimestamp(delivery.successAt);
      return {
        tone: "caution",
        eyebrow: "Delivery not ready",
        title: "The last registration attempt failed",
        body: `Nearcast is still watching in the app${attempted ? ` · attempted ${attempted}` : ""}${succeeded ? ` · last successful sync ${succeeded}` : " · no successful sync yet"}.`,
        primary: "retry",
        primaryLabel: "Retry"
      };
    }
    if (!delivery.ready) {
      const attempted = formatPlanWatchRelativeTimestamp(delivery.attemptAt);
      return {
        tone: "neutral",
        eyebrow: delivery.state === "pending" ? "Setting up" : "Not registered",
        title: delivery.state === "pending" ? "Confirming notification delivery" : "Notification delivery is not confirmed",
        body: attempted
          ? `The plan is being watched in the app. Registration was attempted ${attempted}; no successful sync is recorded yet.`
          : "The plan is being watched in the app. Nearcast has not registered this device for delivery yet.",
        primary: "retry",
        primaryLabel: delivery.state === "pending" ? "Check again" : "Set up delivery"
      };
    }
    return {
      tone: "good",
      eyebrow: "Ready",
      title: "Nearcast can notify you when it matters",
      body: "Only the plans and saved places you choose can send a notification. Routine forecast noise stays in the app.",
      primary: "pause",
      primaryLabel: "Pause all"
    };
  }
  if (enabled) {
    return {
      tone: "neutral",
      eyebrow: "Allowed",
      title: "Choose what can notify you",
      body: "Notifications are allowed. Pick the plans or saved places worth hearing about.",
      primary: "",
      primaryLabel: ""
    };
  }
  if (totalTargets) {
    return {
      tone: "neutral",
      eyebrow: "Paused",
      title: "Notifications are paused",
      body: "Your choices are saved. Resume notifications when you want this device to interrupt you again.",
      primary: "resume",
      primaryLabel: "Resume"
    };
  }
  return {
    tone: "neutral",
    eyebrow: "Optional",
    title: "Get notified only for meaningful changes",
    body: "Turn on notifications, then choose exactly which plans and saved places can interrupt you.",
    primary: "enable",
    primaryLabel: "Enable"
  };
}

function planWatchSyncResultText() {
  const health = planWatchRegistrationHealth();
  if (health.state === "expired") return "Registration expired";
  if (health.state === "failed") return "Registration failed";
  if (health.state === "pending") return "Registration in progress";
  if (health.ready) return "Delivery confirmed";
  const result = planWatchState.pushLastSyncResult;
  if (!result) {
    const lastSync = formatPlanWatchRelativeTimestamp(planWatchState.pushLastSyncAt);
    return lastSync ? `Checked ${lastSync}` : "Automatic";
  }
  if (result.ok === false) {
    const reason = String(result.reason || result.error || result.state || "").toLowerCase();
    if (reason.includes("native") || reason.includes("apns")) return "APNs setup needed";
    return "Needs attention";
  }
  if (result.state === "stored") {
    const planCount = Number(result.planCount || 0);
    const placeCount = Number(result.placeCount || 0);
    const parts = [];
    if (planCount) parts.push(`${planCount} ${planCount === 1 ? "plan" : "plans"}`);
    if (placeCount) parts.push(`${placeCount} ${placeCount === 1 ? "place" : "places"}`);
    return parts.length ? `Ready for ${parts.join(" + ")}` : "Ready";
  }
  if (result.state === "deleted" || result.reason === "no-enabled-watches" || result.reason === "notifications-disabled") {
    return "Paused";
  }
  return "Ready";
}

function planWatchNotificationHubStats(watchItems) {
  const active = (watchItems || []).filter((watch) => !watch?.isPast);
  const enabledPlans = planWatchNotificationEnabledCount(active);
  const selectedPlaces = placeWatchNotificationSelectedCount();
  const savedPlaces = placeWatchSavedPlaces().length;
  const permission = planWatchNotificationPermission();
  const delivery = planWatchRegistrationHealth();
  const permissionMode = planWatchNotificationsEnabled()
    ? "On"
    : permission === "denied" ? "Blocked" : planWatchNotificationsSupported() ? "Off" : "In-app";
  const notificationMode = planWatchNotificationsEnabled()
    ? planWatchNativeDeliveryNotConfigured() || delivery.state === "failed" || delivery.state === "expired"
      ? "Not delivering"
      : delivery.ready ? "Ready" : "Not confirmed"
    : permission === "denied" ? "Blocked" : planWatchNotificationsSupported() ? "Off" : "In-app";
  const rows = [
    { label: "Notifications", value: permissionMode },
    {
      label: "Plans",
      value: active.length
        ? enabledPlans ? `${enabledPlans}/${active.length} can notify` : `${active.length} watched`
        : "None active"
    },
    {
      label: "Places",
      value: savedPlaces
        ? placeWatchNotificationsRequested()
          ? selectedPlaces ? `${selectedPlaces}/${Math.min(savedPlaces, PLACE_WATCH_MAX_SYNC_PLACES)} can notify` : "Choose places"
          : `${savedPlaces} saved`
        : "None saved"
    },
    { label: "Delivery", value: notificationMode }
  ];
  const lastAttempt = formatPlanWatchRelativeTimestamp(delivery.attemptAt);
  const lastSuccess = formatPlanWatchRelativeTimestamp(delivery.successAt);
  if (lastAttempt) {
    const stateLabel = delivery.state === "ready"
      ? "Succeeded"
      : delivery.state === "expired" ? "Expired" : delivery.state === "failed" ? "Failed" : "In progress";
    rows.push({ label: "Last attempt", value: `${stateLabel} · ${lastAttempt}` });
  }
  if (planWatchNotificationsEnabled() && (enabledPlans || selectedPlaces)) {
    rows.push({ label: "Last success", value: lastSuccess || "None yet" });
  }
  const lastSignal = formatPlanWatchRelativeTimestamp(latestPlanWatchNotificationEventAt());
  if (lastSignal) rows.push({ label: "Last call", value: lastSignal });
  return rows;
}

function planWatchNotificationRuleRows() {
  return [
    { label: "Official weather alerts", value: "A warning or watch overlaps a plan." },
    { label: "Plans", value: "Rain, heat, wind, storms, or the overall read changes meaningfully." },
    { label: "Saved places", value: "Today or tomorrow gets stormier, wetter, hotter, windier, smokier, or clears up." }
  ];
}

function renderPlanWatchNotificationHubStats(watchItems) {
  const rows = planWatchNotificationHubStats(watchItems);
  return `
    <dl class="watch-notify-stats">
      ${rows.map((row) => `
        <div>
          <dt>${escapeHtml(row.label)}</dt>
          <dd>${escapeHtml(row.value)}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function renderPlanWatchNotificationRules() {
  return `
    <details class="watch-notify-rules">
      <summary>What Nearcast watches for</summary>
      <div>
        ${planWatchNotificationRuleRows().map((row) => `
          <small><b>${escapeHtml(row.label)}</b>${escapeHtml(row.value)}</small>
        `).join("")}
      </div>
    </details>
  `;
}

function renderPlanWatchNotificationHubActions(status) {
  const buttons = [];
  if (status.primaryLabel) {
    const action = status.primary === "retry" ? " data-watch-notify-retry" : " data-watch-notify";
    buttons.push(`<button class="is-primary" type="button"${action}>${escapeHtml(status.primaryLabel)}</button>`);
  }
  if (!buttons.length) return "";
  return `<div class="watch-notify-actions">${buttons.join("")}</div>`;
}

function renderPlanWatchNotificationTargets(watchItems, options = {}) {
  const active = (watchItems || []).filter((watch) => !watch?.isPast);
  const savedPlaces = placeWatchSavedPlaces();
  if (!active.length && !savedPlaces.length) return "";
  const placeCopy = savedPlaceWatchNotificationPanelCopy();
  const placeRequested = placeWatchNotificationsRequested();
  const selectedPlanCount = planWatchNotificationEnabledCount(active);
  return `
    <div class="watch-notify-targets">
      ${active.length ? `
        <div class="watch-notify-target-group">
          <div class="watch-notify-target-title">
            <span>Plans that can notify you</span>
            <small>${escapeHtml(selectedPlanCount)}/${PLAN_WATCH_MAX_NOTIFICATION_PLANS}</small>
          </div>
          ${selectedPlanCount >= PLAN_WATCH_MAX_NOTIFICATION_PLANS && active.length > selectedPlanCount
            ? `<p class="watch-notify-limit">Three plans can notify this device at once. Turn one off to choose another.</p>`
            : ""}
          <div class="plan-watch-manage-list">
            ${active.map(renderPlanWatchManagePlanItem).join("")}
          </div>
        </div>
      ` : ""}
      ${savedPlaces.length ? `
        <div class="watch-notify-target-group">
          <div class="watch-notify-target-title">
            <span>Saved places that can notify you</span>
            <small>${escapeHtml(placeWatchNotificationSelectedCount())}/${PLACE_WATCH_MAX_SYNC_PLACES}</small>
          </div>
          ${placeRequested ? `
            <div class="plan-watch-manage-list">
              ${savedPlaces.map(renderPlanWatchManagePlaceItem).join("")}
            </div>
          ` : `
            <div class="plan-watch-manage-empty">
              <span>${escapeHtml(placeCopy?.body || "Get a heads-up when today or tomorrow changes meaningfully.")}</span>
              ${placeCopy?.button ? `<button type="button" data-place-watch-notify>${escapeHtml(placeCopy.button)}</button>` : ""}
            </div>
          `}
        </div>
      ` : ""}
      ${options.compact ? "" : `<small class="watch-notify-note">Choose only what is worth an interruption. Pausing notifications does not delete plans or saved places.</small>`}
    </div>
  `;
}

function renderPlanWatchNotificationManagementSurface(watchItems, options = {}) {
  const active = (watchItems || []).filter((watch) => !watch?.isPast);
  const savedPlaces = placeWatchSavedPlaces();
  if (!active.length && !savedPlaces.length) return "";
  const status = planWatchNotificationHubStatus(active);
  const compactClass = options.compact ? " is-compact" : "";
  return `
    <section class="watch-notify-hub${compactClass} is-${escapeHtml(status.tone)}">
      <div class="watch-notify-head">
        <span>${escapeHtml(status.eyebrow)}</span>
        <strong>${escapeHtml(status.title)}</strong>
        <small>${escapeHtml(status.body)}</small>
      </div>
      ${renderPlanWatchNotificationHubActions(status)}
      ${renderPlanWatchNotificationHubStats(active)}
      ${renderPlanWatchNotificationRules()}
      ${renderPlanWatchNotificationTargets(active, options)}
    </section>
  `;
}

function renderPlanWatchManagePlanItem(watch) {
  if (!watch?.memory?.id) return "";
  const id = escapeHtml(watch.memory.id);
  const copy = planWatchNotificationPlanCopy(watch.memory.id);
  return `
    <div class="plan-watch-manage-item is-${escapeHtml(watch.tone || "pending")}">
      <span>
        <strong>${escapeHtml(planMemoryTitle(watch.memory))}</strong>
        <small>${escapeHtml(planWatchMetaText(watch.memory, watch))}</small>
      </span>
      <button
        type="button"
        data-watch-notify="${id}"
        aria-pressed="${copy.pressed ? "true" : "false"}"
        aria-label="${escapeHtml(copy.aria)}"
        title="${escapeHtml(copy.title || copy.aria)}"
        ${copy.disabled ? "disabled" : ""}
      >${escapeHtml(copy.label)}</button>
    </div>
  `;
}

function renderPlanWatchManagePlaceItem(place) {
  if (!place?.id) return "";
  const copy = placeWatchNotificationPlaceCopy(place.id);
  const disabled = copy?.disabled ? " disabled" : "";
  const pressed = copy?.pressed ? "true" : "false";
  return `
    <div class="plan-watch-manage-item">
      <span>
        <strong>${escapeHtml(placeLabel(place))}</strong>
        <small>${escapeHtml(formatPlaceResultMeta(place) || "Saved place")}</small>
      </span>
      ${copy ? `
        <button
          type="button"
          data-place-watch-toggle="${escapeHtml(place.id)}"
          aria-pressed="${pressed}"
          aria-label="${escapeHtml(copy.aria)}"
          title="${escapeHtml(copy.title || copy.aria)}"${disabled}
        >${escapeHtml(copy.label)}</button>
      ` : ""}
    </div>
  `;
}

function renderPlanWatchManagementPanel(watchItems, options = {}) {
  const active = (watchItems || []).filter((watch) => !watch?.isPast);
  const savedPlaces = placeWatchSavedPlaces();
  if (!active.length && !savedPlaces.length) return "";
  const compactClass = options.compact ? " is-compact" : "";
  const placeCopy = savedPlaceWatchNotificationPanelCopy();
  const placeRequested = placeWatchNotificationsRequested();
  return `
    <section class="plan-watch-manage${compactClass}">
      <div class="plan-watch-manage-head">
        <span>Watching controls</span>
        <strong>Choose what can notify you</strong>
        <small>Plans and saved places stay local unless notifications are enabled for them.</small>
      </div>
      ${active.length ? `
        <div class="plan-watch-manage-group">
          <div class="plan-watch-manage-title">
            <span>Plans</span>
            <small>${escapeHtml(planWatchNotificationEnabledCount(active) || 0)} selected</small>
          </div>
          <div class="plan-watch-manage-list">
            ${active.map(renderPlanWatchManagePlanItem).join("")}
          </div>
        </div>
      ` : ""}
      ${savedPlaces.length ? `
        <div class="plan-watch-manage-group">
          <div class="plan-watch-manage-title">
            <span>Saved places</span>
            <small>${escapeHtml(placeWatchNotificationSelectedCount())}/${PLACE_WATCH_MAX_SYNC_PLACES} selected</small>
          </div>
          ${placeRequested ? `
            <div class="plan-watch-manage-list">
              ${savedPlaces.map(renderPlanWatchManagePlaceItem).join("")}
            </div>
          ` : `
            <div class="plan-watch-manage-empty">
              <span>${escapeHtml(placeCopy?.body || "Get a heads-up when today or tomorrow changes meaningfully.")}</span>
              ${placeCopy?.button ? `<button type="button" data-place-watch-notify>${escapeHtml(placeCopy.button)}</button>` : ""}
            </div>
          `}
        </div>
      ` : ""}
    </section>
  `;
}

function savedPlaceWatchNotificationPanelCopy() {
  const savedCount = (state.savedPlaces || []).length;
  const selectedCount = placeWatchNotificationSelectedCount();
  const supported = planWatchNotificationsSupported();
  const permission = planWatchNotificationPermission();
  const enabled = placeWatchNotificationsRequested() && planWatchNotificationsEnabled();
  if (!savedCount) return null;
  if (!supported) {
    return {
      tone: "pending",
      title: "Saved-place watches ready",
      body: "Device notifications need browser support and a secure installed app.",
      button: "",
      meta: `${savedCount} saved`
    };
  }
  if (permission === "denied") {
    return {
      tone: "caution",
      title: "Notifications blocked",
      body: "Change browser notification settings to receive saved-place notifications.",
      button: "",
      meta: "Blocked"
    };
  }
  if (enabled) {
    return {
      tone: selectedCount ? "good" : "neutral",
      title: selectedCount
        ? `Watching ${selectedCount} saved ${selectedCount === 1 ? "place" : "places"}`
        : "Choose places to watch",
      body: selectedCount
        ? `Pick up to ${PLACE_WATCH_MAX_SYNC_PLACES} saved places below. Nearcast will only notify for meaningful today/tomorrow changes.`
        : `Choose up to ${PLACE_WATCH_MAX_SYNC_PLACES} saved places below to receive notifications.`,
      button: "Pause",
      meta: `${selectedCount}/${PLACE_WATCH_MAX_SYNC_PLACES}`
    };
  }
  return {
    tone: "neutral",
    title: "Watch saved places",
    body: "Get a heads-up when today or tomorrow changes meaningfully.",
    button: "Enable",
    meta: savedCount === 1 ? "1 saved" : `${savedCount} saved`
  };
}

function renderSavedPlaceWatchNotificationPanel() {
  const copy = savedPlaceWatchNotificationPanelCopy();
  if (!copy) return "";
  return `
    <section class="plan-watch-notify place-watch-notify is-${escapeHtml(copy.tone)}">
      <div class="plan-watch-notify-main">
        <span>${escapeHtml(copy.meta)}</span>
        <strong>${escapeHtml(copy.title)}</strong>
        <small>${escapeHtml(copy.body)}</small>
      </div>
      ${copy.button ? `<button type="button" data-place-watch-notify>${escapeHtml(copy.button)}</button>` : ""}
    </section>
  `;
}

function currentPlanWatchItems() {
  if (typeof planMemoryListItems !== "function" || typeof planWatchItemForMemoryItem !== "function") return [];
  return planMemoryListItems(state.forecast, state.activePlace, { includePast: false })
    .map(planWatchItemForMemoryItem)
    .filter(Boolean)
    .filter((watch) => !watch.isPast);
}

function planWatchNotificationEventKey(watch) {
  if (!watch?.memory?.id) return "";
  const notification = watch.notification || planWeatherNotificationState(watch);
  const signal = notification.signal || watch.change?.type || watch.alertTone || watch.tone || watch.label || "watch";
  const body = watch.change?.body || watch.reason || "";
  return [
    watch.memory.id,
    watch.memory.targetDate,
    watch.memory.startHour,
    watch.memory.endHour,
    signal,
    body
  ].join("|");
}

function planWatchNotificationCandidates(watchItems) {
  return (watchItems || [])
    .filter((watch) => planWatchNotificationPlanEnabled(watch?.memory?.id))
    .filter((watch) => planWeatherNotificationState(watch).eligible)
    .sort((a, b) =>
      planWatchAttentionRank(b) - planWatchAttentionRank(a) ||
      (a.event?.startMs ?? Infinity) - (b.event?.startMs ?? Infinity)
    );
}

async function showPlanWatchNotification(watch) {
  if (!planWatchNotificationsEnabled()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const title = `Nearcast: ${planMemoryTitle(watch.memory)}`;
    const body = (watch.notification || planWeatherNotificationState(watch)).body;
    const receipt = watch.change?.receipt || null;
    await registration.showNotification(title, {
      body,
      tag: `nearcast-plan-${watch.memory.id}`,
      renotify: false,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: {
        url: planWatchNotificationTargetPath({
          target: "plan",
          memoryId: watch.memory.id,
          detail: typeof planWeatherNotificationDetail === "function"
            ? planWeatherNotificationDetail((watch.notification || planWeatherNotificationState(watch)).signal)
            : "",
          signal: (watch.notification || planWeatherNotificationState(watch)).signal || "plan-watch",
          timeScope: "plan-window",
          source: "plan-watch",
          receipt
        }),
        memoryId: watch.memory.id,
        target: "plan",
        detail: typeof planWeatherNotificationDetail === "function"
          ? planWeatherNotificationDetail((watch.notification || planWeatherNotificationState(watch)).signal)
          : "",
        signal: (watch.notification || planWeatherNotificationState(watch)).signal || "plan-watch",
        timeScope: "plan-window",
        source: "plan-watch",
        receipt
      }
    });
    const update = planWatchRecentUpdateFromWatch(watch);
    if (update) recordPlanWatchRecentUpdate(update);
    return true;
  } catch {
    return false;
  }
}

async function maybeSyncPlanWatchNotifications(watchItems = null, options = {}) {
  const candidates = planWatchNotificationCandidates(watchItems || currentPlanWatchItems());
  if (!candidates.length) return;
  if (!planWatchNotificationsEnabled()) return;
  const store = readPlanWatchNotificationState();
  const now = Date.now();
  const candidate = candidates.find((watch) => {
    const key = planWatchNotificationEventKey(watch);
    return key && now - (Number(store.events[key]) || 0) > PLAN_WATCH_NOTIFICATION_COOLDOWN_MS;
  });
  if (!candidate) return;

  const key = planWatchNotificationEventKey(candidate);
  store.events[key] = now;
  writePlanWatchNotificationState(store);

  if (!options.userInitiated && document.visibilityState === "visible") return;
  await showPlanWatchNotification(candidate);
}

function briefingPanel(html, className = "") {
  const cls = ["briefing-panel", className].filter(Boolean).join(" ");
  return `<section class="${cls}">${html}</section>`;
}

function planBriefingActivityKey(memory) {
  const text = [memory?.title, memory?.original, memory?.label, memory?.answer]
    .filter(Boolean)
    .join(" ");
  return detectAskActivity(text) || detectPlanActivity(text) || "event";
}

function planBriefingItemFromEvent(memory, event, data, place, c = null, alerts = activeAlerts) {
  const context = c || buildAIContext(data, place, alerts || []);
  if (!memory || !event || !data || !place || !context) return null;
  const stats = planWindowStats(data, context, {
    dayIdx: event.dayIndex,
    startHour: event.startHour,
    endHour: event.endHour,
    label: "custom"
  });
  if (!stats) return null;
  const activityKey = planBriefingActivityKey(memory);
  const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.event || ACTIVITY_RULES.walk;
  const alert = topAlertForPlanRange(alerts || [], event.startMs, event.endMs);
  const alertSignal = alert ? alertTone(alert) : "";
  const score = numericWindowScore(rule, stats);
  const verdict = planVerdict(score, alertSignal);
  const item = {
    memory,
    event,
    stats,
    alert,
    alertTone: alertSignal,
    score,
    verdict,
    units: context.units,
    reasons: planReasons(stats, context.units, alert).slice(0, 3)
  };
  return { ...item, ...planWeatherTruth(item) };
}

function planAwareBriefingItems(data = state.forecast, place = state.activePlace, options = {}) {
  if (!data || !place || !state.planMemories?.length) return [];
  const todayIndex = Number.isInteger(options.dayIndex)
    ? options.dayIndex
    : typeof forecastDailyIndex === "function" ? forecastDailyIndex(data) : 0;
  const alerts = Array.isArray(options.alerts) ? options.alerts : activeAlerts;
  const c = buildAIContext(data, place, alerts);
  if (!c) return [];
  return activePlanMemoryEventsForDay(todayIndex, data, place)
    .map(({ memory, event }) => planBriefingItemFromEvent(memory, event, data, place, c, alerts))
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || a.event.startMs - b.event.startMs);
}

function nextPlanBriefingItem(data = state.forecast, place = state.activePlace, options = {}) {
  if (!data || !place || !state.planMemories?.length) return null;
  const alerts = Array.isArray(options.alerts) ? options.alerts : activeAlerts;
  const c = buildAIContext(data, place, alerts);
  if (!c) return null;
  const events = planMemoryEventsForPlace(data, place, { limit: 12 });
  for (const { memory, event } of events) {
    const item = planBriefingItemFromEvent(memory, event, data, place, c, alerts);
    if (item) return item;
  }
  return null;
}

function planPulseMetricRows(item) {
  return planContextSignalRows(item).map(renderPlanSignalChip).join("");
}

function planPulseWhenText(memory, data = state.forecast) {
  return `${planMemoryDayLabel(memory, data)} · ${planMemoryTimeText(memory)}`;
}

function renderNextPlanCard(item, data = state.forecast) {
  if (!item) return "";
  const title = planMemoryTitle(item.memory);
  const when = planPulseWhenText(item.memory, data);
  const where = placeLabel(item.memory.place);
  const lead = `${item.verdict}. ${capitalize(item.primaryReason)}.`;
  return `
    <article class="next-plan-card is-${item.tone}" aria-label="Next watched plan">
      <div class="next-plan-kicker">
        <span>Next up</span>
        <em>${escapeHtml(when)}</em>
      </div>
      <div class="next-plan-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(where)}</span>
      </div>
      <p>${escapeHtml(lead)} <span>${escapeHtml(item.advice)}</span></p>
      <div class="next-plan-metrics">${planPulseMetricRows(item)}</div>
      <div class="next-plan-actions">
        <button type="button" data-memory-show="${escapeHtml(item.memory.id)}">View plan</button>
        <button type="button" data-memory-edit="${escapeHtml(item.memory.id)}">Edit</button>
      </div>
    </article>
  `;
}

function planBriefingItemKey(item) {
  if (!item) return "";
  return [
    item.memory?.id || "",
    Number.isFinite(item.event?.startMs) ? item.event.startMs : "",
    Number.isFinite(item.event?.endMs) ? item.event.endMs : ""
  ].join(":");
}

function planBriefingLeadText(items, options = {}) {
  if (!items?.length) return "";
  const top = items[0];
  const title = planMemoryTitle(top.memory);
  const reason = capitalize(String(top.primaryReason || top.reasons?.[0] || "weather is the main signal").trim().replace(/[.!?]+$/, ""));
  if (options.also) {
    return items.length === 1
      ? `Also today: ${title}. ${reason}.`
      : `Also today, ${title} has the strongest weather signal: ${reason}.`;
  }
  if (options.inline) {
    return items.length === 1
      ? `${title}. ${reason}.`
      : `${title} has today's strongest weather signal: ${reason}.`;
  }
  return items.length === 1
    ? `${title}: ${reason}.`
    : `${title} has today's strongest weather signal: ${reason}.`;
}

function renderMainPlanBriefing(items, data = state.forecast, options = {}) {
  if (!items?.length) return "";
  const visible = items.slice(0, MAIN_PLAN_BRIEFING_MAX_ITEMS);
  const lead = planBriefingLeadText(visible, options);
  const countLabel = options.also
    ? items.length === 1 ? "1 other plan" : `${items.length} other plans`
    : items.length === 1 ? "1 watched plan" : `${items.length} watched plans`;
  const rows = visible.map((item) => {
    const title = planMemoryTitle(item.memory);
    const reason = item.reasons.slice(0, 2).join(" · ") || item.primaryReason;
    return `
      <button class="plan-pulse-brief-item is-${item.tone}" type="button" data-plan-brief-show="${escapeHtml(item.memory.id)}" aria-label="Check ${escapeHtml(title)} plan">
        <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(planPulseWhenText(item.memory, data))}</small></span>
        <em>${escapeHtml(reason)}</em>
      </button>
    `;
  }).join("");
  return `
    <section class="main-plan-briefing" aria-label="What matters today">
      <div class="main-plan-head">
        <span class="main-plan-spark" aria-hidden="true">✦</span>
        <div>
          <strong>What matters today</strong>
          <small>${countLabel}</small>
        </div>
      </div>
      <p>${escapeHtml(lead)}</p>
      <div class="plan-pulse-brief-list">${rows}</div>
      ${items.length > visible.length ? `<button class="plan-pulse-more" type="button" data-memory-open>Review all</button>` : ""}
    </section>
  `;
}

function renderPlanPulse(data = state.forecast, place = state.activePlace) {
  const slot = els.planPulse;
  if (!slot) return;
  slot.hidden = true;
  slot.innerHTML = "";
}

function renderPlanAwareBriefing() {
  const items = planAwareBriefingItems();
  if (!items.length) return "";
  const visible = items.slice(0, PLAN_BRIEFING_MAX_ITEMS);
  const lead = `Here's what matters today: ${planBriefingLeadText(visible, { inline: true }).replace(/\.$/, "")}.`;
  const rows = visible.map((item) => {
    const title = planMemoryTitle(item.memory);
    const reason = item.reasons.slice(0, 2).join(" · ");
    return `
      <button class="plan-briefing-item is-${item.tone}" type="button" data-plan-brief-show="${escapeHtml(item.memory.id)}" aria-label="Check ${escapeHtml(title)} plan">
        <span class="plan-briefing-item-head">
          <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(planMemoryTimeText(item.memory))}</small></span>
          <em>${escapeHtml(item.verdict)}</em>
        </span>
        <span class="plan-briefing-item-reason">${escapeHtml(reason || item.primaryReason)}</span>
      </button>
    `;
  }).join("");
  const more = items.length > visible.length
    ? `<button class="plan-briefing-more" type="button" data-memory-open>Review all</button>`
    : "";

  return `
    <section class="plan-briefing" aria-label="Plan-aware briefing">
      <div class="plan-briefing-head">
        <span class="plan-briefing-spark" aria-hidden="true">✦</span>
        <div>
          <strong>What matters today</strong>
          <small>Based on plans you're watching</small>
        </div>
      </div>
      <p class="plan-briefing-lead">${escapeHtml(lead)}</p>
      <div class="plan-briefing-list">${rows}</div>
      ${more}
    </section>
  `;
}

// One-time capability probe. Planner works everywhere; the private summary gets
// enabled only when the current browser, host, GPU, worker, and storage path look viable.
async function detectAI() {
  const support = await probeLocalAI();
  aiState.support = support.report;
  aiState.phase = support.ok ? "idle" : "unsupported";
  if (aiState.phase === "idle" && localStorage.getItem("ai-enabled") === "1") {
    // Previously enabled: optimistically show "Generate summary" and warm in the background.
    aiState.phase = "ready";
    aiState.text = "";
    warmAI();
  }
  renderBriefing();
  renderAsk();
  renderAILauncher();
}

function warmAI() {
  if (aiWarmQueued || aiWarmLoading) return;
  aiWarmQueued = true;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => {
    aiWarmQueued = false;
    if (textInputIsActive()) {
      setTimeout(warmAI, 2200);
      return;
    }
    aiWarmLoading = true;
    loadAIModule()
      .then(async (ai) => {
        await ai.load();
        applyAIProviderInfo(ai);
      })
      .catch(() => {}) // a failed warm just means the first tap pays the load
      .finally(() => { aiWarmLoading = false; });
  });
}

function renderBriefingSoon() {
  const now = performance.now();
  if (now - perfState.lastBriefingRenderAt > 90) {
    perfState.lastBriefingRenderAt = now;
    renderBriefing();
    return;
  }
  if (perfState.briefingRenderQueued) return;
  perfState.briefingRenderQueued = true;
  requestAnimationFrame(() => {
    perfState.briefingRenderQueued = false;
    perfState.lastBriefingRenderAt = performance.now();
    renderBriefing();
  });
}

async function enableAI() {
  try {
    if (!localAIReady()) {
      const support = await probeLocalAI();
      aiState.support = support.report;
      if (!support.ok) {
        aiState.phase = "unsupported";
        renderBriefing();
        renderAsk();
        renderAILauncher();
        return;
      }
    }
    aiState.phase = "loading";
    aiState.progress = 0;
    aiState.status = "Starting local AI summary…";
    aiState.error = "";
    aiState.loadError = "";
    aiState.reportCopied = false;
    renderBriefing();
    const ai = await loadAIModule();
    await ai.load((p) => {
      aiState.phase = "loading";
      aiState.progress = Math.round((p.progress || 0) * 100);
      aiState.status = p.text || "Preparing local AI summary…";
      renderBriefing();
    });
    applyAIProviderInfo(ai);
    localStorage.setItem("ai-enabled", "1");
    aiState.phase = "ready";
    aiState.text = "";
    renderBriefing();
    renderAsk();
    renderAILauncher();
    runBrief(); // first briefing immediately after enabling
  } catch (err) {
    aiState.phase = "error";
    aiState.error = classifyAIError(err);
    renderBriefing();
    renderAsk();
    renderAILauncher();
  }
}

async function runBrief() {
  const factSheet = buildAIFactSheet();
  if (!factSheet) return;
  aiBriefAbort = { aborted: false };
  const mine = aiBriefAbort;
  aiState.phase = "generating";
  aiState.text = "";
  renderBriefing();
  renderAsk(); // reflect engine-busy (disable Q&A) during the briefing
  try {
    const ai = await loadAIModule();
    for await (const delta of ai.brief(factSheet, mine)) {
      if (mine.aborted) break;
      aiState.text += delta;
      renderBriefingSoon();
    }
    aiState.phase = "ready"; // text retained → shows regenerate control
    renderBriefing();
    renderAsk(); // re-enable Q&A
  } catch (err) {
    aiState.phase = "error";
    aiState.error = classifyAIError(err) || "Private AI summary failed. Planner tools still work.";
    renderBriefing();
    renderAsk();
    renderAILauncher();
  }
}

// Clear per-city briefing text + Q&A when the forecast changes; keep engine state.
function resetBriefing() {
  if (aiBriefAbort) aiBriefAbort.aborted = true;
  if (aiState.phase === "generating") aiState.phase = localAIReady() ? "ready" : "unsupported";
  if (aiState.phase === "ready") aiState.text = "";
  aiState.reportCopied = false;
  renderBriefing();
  resetAsk();
  renderAILauncher();
}

function renderBriefing() {
  const slot = els.briefing;
  if (!slot) return;
  if (!state.forecast || !state.activePlace ||
      aiState.phase === "unknown") {
    slot.hidden = true;
    return;
  }
  const showSummarySurface = aiState.phase === "idle" ||
    aiState.phase === "unsupported" ||
    aiState.phase === "loading" ||
    aiState.phase === "generating" ||
    aiState.phase === "error" ||
    Boolean(aiState.text);
  if (!showSummarySurface) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;

  // Privacy is the headline feature: the model runs entirely on-device.
  const privateTag =
    `<span class="briefing-tag">${lockGlyph()}Private AI summary · runs on your device</span>`;
  const planBriefing = renderPlanAwareBriefing();

  if (aiState.phase === "unsupported") {
    slot.className = "briefing briefing-stack briefing-compat";
    slot.innerHTML =
      planBriefing +
      briefingPanel(
      `<div class="briefing-row">` +
        `<span class="briefing-spark">${lockGlyph()}</span>` +
        `<div class="briefing-copy">` +
          `<strong>Private AI summary unavailable here</strong>` +
          `<p>${escapeHtml(supportReason())}</p>` +
          `<small>Planner windows and planning answers still work on this device.</small>` +
        `</div>` +
      `</div>` +
      renderSupportActions(false));
    return;
  }

  if (aiState.phase === "idle") {
    slot.className = "briefing briefing-stack briefing-cta";
    const usingApple = aiState.support?.activeProvider === "apple";
    const warning = usingApple ? "Uses Apple's private on-device model · no Nearcast model download" : aiState.support?.warnings?.[0];
    slot.innerHTML =
      planBriefing +
      `<button class="briefing-enable" data-ai="enable" type="button">` +
        `<span class="briefing-spark">${lockGlyph()}</span>` +
        `<span class="briefing-enable-copy"><strong>Enable private AI summary</strong>` +
        `<small>${escapeHtml(warning || `Runs locally with WebGPU · ~${LOCAL_AI_MODEL_MB} MB, one time`)}</small></span></button>`;
    return;
  }

  if (aiState.phase === "loading") {
    slot.className = "briefing briefing-stack briefing-loading";
    slot.innerHTML =
      planBriefing +
      briefingPanel(
      `<div class="briefing-progress-head"><span class="briefing-spark spin">✦</span>` +
      `<span>${escapeHtml(aiState.status || "Preparing local AI summary…")}</span>` +
      `<em>${aiState.progress}%</em></div>` +
      `<div class="briefing-bar"><i style="width:${aiState.progress}%"></i></div>` +
      `<span class="briefing-tag">${lockGlyph()}${aiState.support?.activeProvider === "apple" ? "Apple on-device model · private on this device" : "One-time model download, then private on this device"}</span>`);
    return;
  }

  if (aiState.phase === "generating") {
    slot.className = "briefing briefing-stack briefing-text generating";
    slot.innerHTML =
      planBriefing +
      briefingPanel(
      `<div class="briefing-row"><span class="briefing-spark">✦</span>` +
      `<p class="briefing-body">${escapeHtml(aiState.text)}<i class="briefing-caret"></i></p>` +
      `<button class="briefing-act" data-ai="stop" type="button" aria-label="Stop">■</button></div>` +
      privateTag);
    return;
  }

  if (aiState.phase === "error") {
    slot.className = "briefing briefing-stack briefing-compat";
    slot.innerHTML =
      planBriefing +
      briefingPanel(
      `<div class="briefing-row">` +
        `<span class="briefing-spark">!</span>` +
        `<div class="briefing-copy">` +
          `<strong>Private AI summary needs attention</strong>` +
          `<p>${escapeHtml(aiState.error || "Private AI summary unavailable.")}</p>` +
          `<small>Planner windows and planning answers are still available.</small>` +
        `</div>` +
      `</div>` +
      renderSupportActions(true));
    return;
  }

  // ready
  if (aiState.text) {
    slot.className = "briefing briefing-stack briefing-text";
    slot.innerHTML =
      planBriefing +
      briefingPanel(
      `<div class="briefing-row"><span class="briefing-spark">✦</span>` +
      `<p class="briefing-body">${escapeHtml(aiState.text)}</p>` +
      `<button class="briefing-act" data-ai="brief" type="button" aria-label="Regenerate">↻</button></div>` +
      privateTag);
  } else {
    slot.className = "briefing briefing-stack briefing-cta";
    slot.innerHTML =
      planBriefing +
      `<button class="briefing-enable" data-ai="brief" type="button">` +
      `<span class="briefing-spark">✦</span>` +
      `<span class="briefing-enable-copy"><strong>Generate private AI summary</strong>` +
      `<small>Runs locally on this device</small></span></button>`;
  }
}

function lockGlyph() {
  return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
    `<rect x="3.2" y="7" width="9.6" height="6.3" rx="1.6" fill="currentColor"/>` +
    `<path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`;
}

/* ---------- Ask the forecast (Q&A + planner templates) ---------- */
// Chips and typed questions are answered by local deterministic forecast logic.
// The tiny model stays focused on summaries; it never owns weather verdicts.
const ACTIVITY_CHIPS = [
  { label: "Ballgame", template: "I have a ballgame " },
  { label: "Golf", template: "I'm golfing " },
  { label: "Dinner outside", template: "Dinner outside " },
  { label: "What to wear", template: "What should I wear " }
];

const PLANNER_TERM_ALIASES = {
  morn: "morning",
  mornin: "morning",
  nxt: "next",
  tmr: "tomorrow",
  tmrw: "tomorrow",
  tmrrow: "tomorrow",
  tonite: "tonight",
  nite: "night",
  eve: "evening",
  tue: "tuesday",
  tues: "tuesday",
  wed: "wednesday",
  weds: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  sat: "saturday",
  sun: "sunday",
  hts: "heights"
};

const PLANNER_CANONICAL_TERMS = [
  "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "night",
  "overnight", "midday", "weekend", "daytime", "this", "next", "coming",
  "following", "sunday", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday"
];
const PLANNER_WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function plannerParseText(value) {
  return askText(value).replace(/\b[a-z]{3,}\b/g, (token) => plannerCanonicalTerm(token) || token);
}

function plannerCanonicalTerm(token) {
  const word = String(token || "").toLowerCase();
  if (PLANNER_TERM_ALIASES[word]) return PLANNER_TERM_ALIASES[word];
  if (PLANNER_CANONICAL_TERMS.includes(word)) return word;
  let best = null;
  let bestDistance = Infinity;
  for (const term of PLANNER_CANONICAL_TERMS) {
    const distance = plannerEditDistance(word, term);
    if (distance < bestDistance) {
      best = term;
      bestDistance = distance;
    }
  }
  const limit = word.length >= 7 ? 2 : word.length >= 5 ? 1 : 0;
  return bestDistance <= limit ? best : "";
}

function plannerEditDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

// Resolve a target day (index into c.daily, 0=today … 9) from a question's
// weekday names or relative phrases. Returns null when no day is referenced.
function resolveDayIndex(s, c) {
  s = plannerParseText(s);
  const days = c.daily;
  if (!days || !days.length) return null;
  if (/\bday after tomorrow\b/.test(s)) return Math.min(2, days.length - 1);
  if (/\btomorrow\b/.test(s)) return 1;
  const inN = s.match(/\bin (\d+) days?\b/);
  if (inN) { const n = +inN[1]; if (n >= 0 && n < days.length) return n; }

  for (let wd = 0; wd < 7; wd++) {
    const dayName = PLANNER_WEEKDAY_NAMES[wd];
    if (new RegExp(`\\b(?:next|following)\\s+${dayName}\\b`).test(s)) {
      const matches = days.map((day, index) => day.dow === wd ? index : -1).filter((index) => index >= 0);
      return matches[1] ?? null;
    }
    if (new RegExp(`\\b(?:this|coming)\\s+${dayName}\\b`).test(s)) {
      for (let i = 0; i < days.length; i++) if (days[i].dow === wd) return i;
    }
  }
  if (/\b(?:next|following)\s+weekend\b/.test(s)) {
    const saturdays = days.map((day, index) => day.dow === 6 ? index : -1).filter((index) => index >= 0);
    return saturdays[1] ?? null;
  }
  if (/\b(?:this|coming)\s+weekend\b/.test(s)) {
    for (let i = 0; i < days.length; i++) if (days[i].dow === 6) return i;
  }

  // Bare weekday names → next occurrence (today counts if it matches).
  for (let wd = 0; wd < 7; wd++) {
    if (s.includes(PLANNER_WEEKDAY_NAMES[wd])) {
      for (let i = 0; i < days.length; i++) if (days[i].dow === wd) return i;
    }
  }
  if (s.includes("weekend")) {
    for (let i = 0; i < days.length; i++) if (days[i].dow === 6) return i; // next Saturday
  }
  if (/\btonight\b|\bovernight\b|\btoday\b|\bright now\b|\bthis afternoon\b/.test(s)) return 0;
  return null;
}

function plannerWeekdayMention(value) {
  const rawWords = String(value || "").match(/[A-Za-z]{3,}/g) || [];
  for (const raw of rawWords) {
    const word = raw.toLowerCase();
    const alias = PLANNER_TERM_ALIASES[word] || "";
    const canonical = alias || plannerCanonicalTerm(word);
    const index = PLANNER_WEEKDAY_NAMES.indexOf(canonical);
    if (index < 0) continue;
    return {
      index,
      label: capitalize(canonical),
      raw,
      corrected: Boolean(!alias && canonical !== word)
    };
  }
  return null;
}

// A short conversation thread of {q, a} for this place/session. The last entry
// may be mid-stream (askStreaming). Cleared when the place changes.
let askThread = [];
let askStreaming = false;
let askError = "";
let askAbort = null;
let plannerClarification = null;
let plannerReturnAfterDayDetail = null;
let plannerEditingMemoryId = "";
let plannerEditingMemoryDraft = "";
let memoryDetailIds = [];
let memoryDetailMode = "facts";
let memoryEditState = null;
let launchSummaryTargets = [];

function setPlannerClarification(clarification, rowIndex = null) {
  if (!clarification) {
    plannerClarification = null;
    return;
  }
  plannerClarification = {
    ...clarification,
    rowIndex: Number.isInteger(rowIndex) ? rowIndex : clarification.rowIndex ?? null
  };
}

function fillPlannerTemplate(template, options = {}) {
  const input = document.getElementById("askInput");
  if (!input) return;
  const { helperText = "Nearcast will use this place unless you name another one." } = options || {};
  const form = document.getElementById("askForm");
  const helper = document.querySelector(".ask-helper");
  input.value = template || "";
  if (form) {
    form.classList.add("is-drafting");
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (els.aiSheet && !els.aiSheet.hidden) restoreSheetScrollAnchor(els.aiSheet);
  }
  if (helper) {
    helper.textContent = helperText;
  }
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch { /* selection can fail on some mobile inputs */ }
  input.addEventListener("input", () => {
    form?.classList.remove("is-drafting");
  }, { once: true });
}

async function runAsk(question, intent) {
  question = (question || "").trim();
  if (!question) return;
  // Engine does one generation at a time — ignore taps while it's busy.
  if (aiState.phase === "generating" || askStreaming) return;
  askError = "";

  if (plannerClarification && !intent && shouldUseAsClarification(question)) {
    await continuePlannerClarificationWithText(question);
    return;
  }
  plannerClarification = null;
  if (intent) clearPlannerMemoryEdit();

  // Activity chips: answer instantly from a code-computed verdict. No model —
  // a tiny model can't reliably reason about this, and even handed the correct
  // verdict it sometimes mangles or flips it. Deterministic = always correct.
  if (intent) {
    if (typeof recordForYouSignal === "function") recordForYouSignal("plan-check-started");
    const row = beginAskResponse(question);
    try {
      finishAskResponse(row, await answerPresetIntent(intent, question, row));
    } catch {
      finishAskResponse(row, "I hit a snag checking that preset. Try typing the plan with a day and time.");
    }
    return;
  }

  if (plannerEditingMemoryId) {
    await runMemoryEdit(question, plannerEditingMemoryId);
    return;
  }

  if (typeof recordForYouSignal === "function") recordForYouSignal("plan-check-started");

  // Free-form: answer deterministically from the data (always correct). We do
  // NOT route open questions to the model — a 0.5B hallucinates on these
  // (e.g. inventing a day's forecast). If we can't answer exactly, say what we
  // CAN answer rather than guessing.
  const row = beginAskResponse(question);
  try {
    const plan = await answerPlanRequest(question);
    if (plan?.clarification) {
      setPlannerClarification(plan.clarification, row);
      finishAskResponse(row, plan.clarification.prompt);
      return;
    }
    const direct = plan?.answer || answerFreeform(question);
    finishAskResponse(row, plan?.answer ? plan : direct);
  } catch (error) {
    finishAskResponse(row, "I hit a snag checking that plan. Try a city, day, and time, like \"golf Saturday morning in Fillmore, IL.\"");
  }
}

async function runMemoryEdit(question, memoryId) {
  plannerEditingMemoryDraft = question;
  const row = beginAskResponse(question);
  try {
    const result = await answerPlanRequest(question);
    if (result?.clarification) {
      setPlannerClarification(result.clarification, row);
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result?.answer ? result : (answerFreeform(question) || result), {
      updateMemoryId: memoryId,
      original: question
    });
  } catch {
    finishAskResponse(row, "I hit a snag updating that memory. Try a city, day, and time, like \"golf Saturday morning in Fillmore, IL.\"");
  }
}

function shouldUseAsClarification(text) {
  const pending = plannerClarification;
  if (!pending) return false;
  const raw = String(text || "").trim();
  const s = plannerParseText(raw);
  if (!raw || raw.length > 48 || raw.includes("?")) return false;
  if (pending.type === "time") {
    return /\b(morning|afternoon|evening|tonight|night|overnight)\b/.test(s) ||
      /^(?:at|around|about)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(raw) ||
      /^(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(raw);
  }
  if (pending.type === "day") {
    const c = buildAIContext();
    return c ? resolveDayIndex(s, c) != null : false;
  }
  if (pending.type === "location") {
    if (hasAny(s, [" what ", " when ", " should ", " best ", " weather ", " forecast ", " rain ", " wind "])) return false;
    return true;
  }
  return false;
}

function beginAskResponse(question) {
  askThread.push({ q: question, a: "" });
  askStreaming = true;
  renderAsk();
  scrollAskIntoView();
  return askThread.length - 1;
}

function finishAskResponse(row, result, options = {}) {
  const normalized = normalizeAskResult(result);
  if (askThread[row]) {
    askThread[row].a = normalized.answer;
    askThread[row].event = normalized.event || null;
  }
  if (normalized.event && !options.updateMemoryId && typeof recordForYouSignal === "function") {
    recordForYouSignal("plan-check-completed");
  }
  if (options.updateMemoryId) {
    const updated = applyPlanMemoryEdit(options.updateMemoryId, normalized, {
      row,
      original: options.original || plannerEditingMemoryDraft || askThread[row]?.q || ""
    });
    if (!updated) {
      askError = "I could not turn that edit into a saved plan. Try including the day, time, and place.";
    }
  }
  askStreaming = false;
  renderAsk();
  scrollAskIntoView();
}

function normalizeAskResult(result) {
  if (result && typeof result === "object") {
    return {
      answer: result.answer || AI_FALLBACK_MSG,
      event: result.event || null
    };
  }
  return {
    answer: result || AI_FALLBACK_MSG,
    event: null
  };
}

async function runPlannerClarification(index) {
  if (aiState.phase === "generating" || askStreaming || !plannerClarification) return;
  const option = plannerClarification.options[index];
  if (!option) return;
  const pending = plannerClarification;
  const editingMemoryId = plannerEditingMemoryId;
  plannerClarification = null;
  let row = null;
  try {
    if (pending.type === "confirm") {
      if (option.editPlan) {
        renderAsk();
        startPlanConfirmationEdit(pending, {
          updateMemoryId: editingMemoryId,
          original: plannerEditingMemoryDraft || pending.plan?.original || "",
          rowIndex: pending.rowIndex
        });
        return;
      }
      row = beginAskResponse(option.label);
      if (option.confirmPlan) {
        if (typeof recordForYouSignal === "function") recordForYouSignal("plan-check-confirmed");
        finishAskResponse(row, pending.result, editingMemoryId ? {
          updateMemoryId: editingMemoryId,
          original: plannerEditingMemoryDraft || pending.plan?.original || option.label
        } : {});
        return;
      }
      const nextClarification = buildPlanConfirmationAdjustment(pending, option.field);
      if (nextClarification) {
        setPlannerClarification(nextClarification, row);
        finishAskResponse(row, nextClarification.prompt);
        return;
      }
    }
    row = beginAskResponse(option.label);
    const result = await completePlanRequest(pending.plan, option);
    if (result?.clarification) {
      setPlannerClarification(result.clarification, row);
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result, editingMemoryId ? {
      updateMemoryId: editingMemoryId,
      original: plannerEditingMemoryDraft || pending.plan?.original || option.label
    } : {});
  } catch {
    if (Number.isInteger(row)) {
      finishAskResponse(row, "I could not check that plan. Try adding the city/state and a time window.");
    } else {
      askError = "I could not open the plan editor. Try adding the city/state and a time window.";
      askStreaming = false;
      renderAsk();
    }
  }
}

async function continuePlannerClarificationWithText(text) {
  const pending = plannerClarification;
  const editingMemoryId = plannerEditingMemoryId;
  plannerClarification = null;
  const row = beginAskResponse(text);
  try {
    const option = { label: text };
    if (pending.type === "location") {
      option.locationQuery = pending.replaceLocation
        ? text
        : mergeLocationClarification(pending.plan.locationQuery, text);
    } else if (pending.type === "day") {
      option.dayText = text;
    } else if (pending.type === "time") {
      option.timeText = text;
      option.replaceTime = Boolean(pending.replaceTime);
    }
    const result = await completePlanRequest(pending.plan, option);
    if (result?.clarification) {
      setPlannerClarification(result.clarification, row);
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result, editingMemoryId ? {
      updateMemoryId: editingMemoryId,
      original: plannerEditingMemoryDraft || pending.plan?.original || text
    } : {});
  } catch {
    finishAskResponse(row, `I could not use that detail. Try something like "${formatClock(18, 0, false, false)}" or "Fillmore, IL."`);
  }
}

const AI_FALLBACK_MSG =
  "I can answer weather decisions like \"dinner outside tonight?\", \"better today or tomorrow?\", " +
  "\"too windy for biking after 5?\", \"what should I wear tonight?\", plus rain, temperature, wind, UV, " +
  "humidity, and sunrise/sunset through the next 10 days.";

const ACTIVITY_RULES = {
  run: { label: "a run", hot: 86, cold: 34, rain: 35, wind: 24, uv: 9, aliases: ["run", "running", "jog", "jogging"] },
  bike: { label: "a bike ride", hot: 88, cold: 36, rain: 30, wind: 20, uv: 9, aliases: ["bike", "biking", "cycling", "cycle"] },
  walk: { label: "a walk", hot: 90, cold: 28, rain: 45, wind: 28, uv: 10, aliases: ["walk", "walking", "stroll", "dog", "walk the dog"] },
  dinner: { label: "dinner outside", hot: 92, cold: 45, rain: 30, wind: 18, uv: 9, aliases: ["dinner", "supper", "dinner outside", "eat outside", "eating outside", "patio dinner"] },
  grill: { label: "grilling outside", hot: 94, cold: 35, rain: 35, wind: 18, uv: 10, aliases: ["grill", "grilling", "barbecue", "bbq", "cookout", "cook out"] },
  picnic: { label: "a picnic", hot: 90, cold: 45, rain: 25, wind: 20, uv: 8, aliases: ["picnic", "patio", "eat outside", "dinner outside", "lunch outside"] },
  yard: { label: "yard work", hot: 86, cold: 35, rain: 35, wind: 28, uv: 8, aliases: ["yard", "mow", "mowing", "garden", "gardening", "rake", "yard work"] },
  golf: { label: "golf", hot: 92, cold: 40, rain: 35, wind: 22, uv: 9, aliases: ["golf", "golfing"] },
  hike: { label: "a hike", hot: 84, cold: 32, rain: 30, wind: 25, uv: 8, aliases: ["hike", "hiking", "trail"] },
  sports: { label: "outdoor sports", hot: 88, cold: 35, rain: 35, wind: 25, uv: 9, aliases: ["soccer", "baseball", "softball", "football", "tennis", "sports", "game", "practice", "ballgame", "ball game"] },
  event: { label: "an outdoor event", hot: 88, cold: 40, rain: 35, wind: 24, uv: 9, aliases: ["event", "party", "birthday", "wedding", "concert", "festival", "parade", "camp", "camping", "recital", "meetup", "meet up"] },
  pool: { label: "the pool", hot: 95, cold: 75, rain: 25, wind: 22, uv: 9, aliases: ["pool", "swim", "swimming", "beach"] },
  commute: { label: "the commute", hot: 100, cold: 15, rain: 55, wind: 35, uv: 99, aliases: ["commute", "drive", "driving", "school pickup", "errands", "travel"] }
};

const PLAN_SIGNAL_PHRASES = [
  " i have ", " we have ", " i've got ", " we got ", " going ", " planning ",
  " plan ", " plans ", " tee ", " game ", " practice ", " tournament ", " event ",
  " party ", " birthday ", " wedding ", " concert ", " festival ", " parade ",
  " camp ", " camping ", " recital ", " meetup ", " meet up "
];
const PLAN_FLEXIBLE_ASK_PHRASES = ["best", "best time", "best window", "when should", "when can", "window"];
const PLAN_LOCAL_AI_TIMEOUT_MS = 8000;

const ASK_PERIODS = {
  morning: { start: 6, end: 12, label: "morning" },
  afternoon: { start: 12, end: 18, label: "afternoon" },
  evening: { start: 18, end: 22, label: "evening" },
  night: { start: 20, end: 24, label: "tonight" },
  overnight: { start: 0, end: 7, label: "overnight" },
  day: { start: 8, end: 20, label: "daytime" }
};

const PLAN_LOCATION_STOP_WORDS = [
  "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "night",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "on", "for", "at", "from", "between", "before", "after", "around", "about"
];
const PLAN_LOCATION_IGNORE = new Set([
  "the morning", "morning", "the afternoon", "afternoon", "the evening", "evening",
  "the", "tonight", "night", "the rain", "rain", "weather", "the weather"
]);
const PLAN_LOCATION_PREPOSITION_RE = /\b(?:in|near|around|at)\s+/gi;
const PLAN_IMPLICIT_LOCATION_DROP_WORDS = new Set([
  "i", "me", "my", "m", "we", "us", "our", "re", "ve", "you", "your",
  "can", "could", "should", "would", "will", "do", "does", "did",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "got", "get", "need", "want", "maybe", "please", "pls",
  "a", "an", "the", "this", "that", "these", "those",
  "to", "for", "of", "on", "at", "from", "between", "before", "after", "around", "about", "by",
  "go", "going", "planning", "plan", "plans", "check", "checking",
  "look", "looks", "looking", "weather", "forecast", "conditions",
  "hour", "hours", "hr", "hrs", "minute", "minutes", "min", "mins",
  "outside", "outdoors", "outdoor", "inside", "party", "birthday", "wedding",
  "concert", "festival", "parade", "camp", "camping", "recital", "meetup"
]);
let planActivityLocationWordCache = null;

async function answerPlanRequest(question) {
  const c = buildAIContext();
  if (!c) return null;
  const plan = await buildPlannerIntent(question, c);
  if (!plan) return null;
  return completePlanRequest(plan);
}

async function buildPlannerIntent(question, c) {
  const deterministic = parsePlanRequest(question, c);
  if (deterministic) return deterministic;
  const repaired = repairPlanIntent(question, c);
  if (repaired) return repaired;
  return localAIPlanIntent(question, c);
}

function parsePlanRequest(question, c, options = {}) {
  const s = plannerParseText(question);
  const activityKey = detectAskActivity(question) || detectPlanActivity(question);
  const dayIdx = resolveDayIndex(s, c);
  const dayMention = plannerWeekdayMention(question);
  const targetDate = dayIdx == null ? null : planTargetDate(dayIdx);
  const locationQuery = extractPlanLocationQuery(question);
  const timing = inferPlanTiming(question, c, activityKey);
  const implicitCandidates = locationQuery ? [] : implicitPlanLocationCandidates({ original: question });
  const planish = hasAny(s, PLAN_SIGNAL_PHRASES);
  const flexibleAsk = hasAny(s, PLAN_FLEXIBLE_ASK_PHRASES);
  const signalCount = [activityKey, dayIdx != null, locationQuery, timing.hasTime, implicitCandidates.length].filter(Boolean).length;

  if (flexibleAsk) return null;
  if (!activityKey && !planish) return null;
  if (!activityKey && signalCount < 2) return null;
  if (activityKey && signalCount < 1 && !planish) return null;

  return {
    original: question,
    activityKey: activityKey || "walk",
    dayIdx,
    dayExplicit: dayIdx != null,
    dayDisplay: dayMention && dayIdx != null ? dayMention.label : "",
    dayCorrection: dayMention?.corrected ? { from: dayMention.raw, to: dayMention.label } : null,
    targetDate,
    locationQuery,
    locationExplicit: Boolean(locationQuery),
    timing,
    intent: plannerIntentReceipt({
      source: options.source || "rules",
      confidence: plannerIntentConfidence({ activityKey, dayIdx, locationQuery, timing, implicitCandidates, planish }),
      implicitLocationCandidates: implicitCandidates
    })
  };
}

function detectPlanActivity(question) {
  const s = plannerParseText(question);
  if (hasAny(s, [" ballgame ", " ball game ", " baseball ", " softball "])) return "sports";
  if (hasAny(s, [" tee time ", " tee ", " round of golf "])) return "golf";
  if (hasAny(s, [" practice ", " tournament ", " match ", " game "])) return "sports";
  if (hasAny(s, [" event ", " party ", " birthday ", " wedding ", " concert ", " festival ", " parade ", " camp ", " camping ", " recital ", " meetup ", " meet up "])) return "event";
  return null;
}

function plannerIntentConfidence({ activityKey, dayIdx, locationQuery, timing, implicitCandidates, planish }) {
  let score = 0.15;
  if (activityKey) score += 0.35;
  if (dayIdx != null) score += 0.18;
  if (timing?.hasTime) score += timing.explicit ? 0.16 : 0.08;
  if (locationQuery) score += 0.18;
  else if (implicitCandidates?.length) score += 0.08;
  if (planish) score += 0.07;
  return Math.min(0.98, Math.round(score * 100) / 100);
}

function plannerIntentReceipt(meta = {}) {
  return {
    source: meta.source || "rules",
    confidence: meta.confidence || 0,
    implicitLocationCandidates: meta.implicitLocationCandidates || [],
    notes: meta.notes || []
  };
}

function repairPlanIntent(question, c) {
  const s = plannerParseText(question);
  if (hasAny(s, PLAN_FLEXIBLE_ASK_PHRASES)) return null;
  const fragments = compactPlannerFragments({
    activity: likelyPlannerActivityText(question),
    day: likelyPlannerDayText(question, c),
    time: likelyPlannerTimeText(question),
    location: implicitPlanLocationCandidates({ original: question })[0] || ""
  });
  if (!fragments.activity && !hasAny(s, PLAN_SIGNAL_PHRASES)) return null;
  if (![fragments.day, fragments.time, fragments.location].filter(Boolean).length) return null;
  return planFromIntentFragments(question, c, fragments, "repair");
}

function likelyPlannerActivityText(question) {
  const s = plannerParseText(question);
  const key = detectAskActivity(question) || detectPlanActivity(question);
  if (key) return ACTIVITY_RULES[key]?.aliases?.[0] || ACTIVITY_RULES[key]?.label || key;
  if (hasAny(s, PLAN_SIGNAL_PHRASES)) return "event";
  return "";
}

function likelyPlannerDayText(question, c) {
  const s = plannerParseText(question);
  const idx = resolveDayIndex(s, c);
  if (idx == null) return "";
  return c.daily?.[idx]?.label || "";
}

function likelyPlannerTimeText(question) {
  const s = plannerParseText(question);
  const period = inferPlanPeriod(s);
  if (period) return period;
  const namedTime = !/\b(before|after)\s+noon\b/.test(s)
    ? s.match(/\b(?:at|around|about)?\s*(noon|midday|midnight)\b/)
    : null;
  if (namedTime) return namedTime[0];
  const at = s.match(/\b(?:at|around|about)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (at) return at[0];
  const between = s.match(/\b(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/);
  return between?.[0] || "";
}

function compactPlannerFragments(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    String(value || "").trim().replace(/\s+/g, " ").slice(0, 90)
  ]));
}

function planFromIntentFragments(original, c, fragments, source) {
  const activityText = fragments.activity || "";
  const activityKey = detectAskActivity(activityText) || detectPlanActivity(activityText) ||
    detectAskActivity(original) || detectPlanActivity(original) ||
    (activityText ? "event" : null);
  if (!activityKey) return null;

  const dayIdx = resolveDayIndex(fragments.day || original, c);
  const dayMention = plannerWeekdayMention(fragments.day || original);
  const targetDate = dayIdx == null ? null : planTargetDate(dayIdx);
  const locationQuery = cleanPlanLocation(fragments.location || "");
  const timingText = fragments.time
    ? normalizePlanTimeClarification(fragments.time)
    : original;
  const timing = inferPlanTiming(timingText, c, activityKey);
  const confidence = plannerIntentConfidence({
    activityKey,
    dayIdx,
    locationQuery,
    timing,
    implicitCandidates: locationQuery ? [] : implicitPlanLocationCandidates({ original }),
    planish: true
  });
  if (dayIdx == null && !locationQuery && !timing.hasTime) return null;

  return {
    original,
    activityKey,
    dayIdx,
    dayExplicit: dayIdx != null,
    dayDisplay: dayMention && dayIdx != null ? dayMention.label : "",
    dayCorrection: dayMention?.corrected ? { from: dayMention.raw, to: dayMention.label } : null,
    targetDate,
    locationQuery,
    locationExplicit: Boolean(locationQuery),
    locationImplicit: Boolean(locationQuery && !extractPlanLocationQuery(original)),
    timing,
    intent: plannerIntentReceipt({
      source,
      confidence,
      notes: source === "local-ai" ? ["local intent extraction"] : ["repaired loose phrasing"]
    })
  };
}

async function localAIPlanIntent(question, c) {
  if (!shouldTryLocalAIPlanIntent(question, c)) return null;
  try {
    const ai = await loadAIModule();
    if (!localAIIntentReady(ai)) return null;
    const abort = { aborted: false };
    const raw = await withPlannerTimeout(ai.extractPlanIntent(question, abort), PLAN_LOCAL_AI_TIMEOUT_MS, abort);
    const fragments = parseLocalAIIntent(raw);
    if (!fragments) return null;
    return planFromIntentFragments(question, c, fragments, "local-ai");
  } catch (_) {
    return null;
  }
}

function shouldTryLocalAIPlanIntent(question, c) {
  if (aiState.phase !== "ready") return false;
  const s = plannerParseText(question);
  if (hasAny(s, [" umbrella ", " what to wear ", " wear ", " aqi ", " air quality ", " pollen ", " sunrise ", " sunset "])) return false;
  const day = resolveDayIndex(s, c) != null;
  const period = Boolean(inferPlanPeriod(s));
  const activityish = Boolean(detectAskActivity(question) || detectPlanActivity(question) || hasAny(s, PLAN_SIGNAL_PHRASES));
  return activityish || (day && period);
}

function withPlannerTimeout(promise, ms, abort = null) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (abort) abort.aborted = true;
      reject(new Error("Planner intent timed out."));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseLocalAIIntent(raw) {
  const text = String(raw || "").trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return compactPlannerFragments({
      activity: parsed.activity,
      day: parsed.day,
      time: parsed.time,
      location: parsed.location
    });
  } catch (_) {
    return null;
  }
}

function planTargetDate(dayIdx) {
  const idx = dayIdx == null ? 0 : dayIdx;
  return state.forecast?.daily?.time?.[idx] || forecastLocalDate(state.forecast, idx);
}

function inferPlanTiming(question, c, activityKey) {
  const s = plannerParseText(question);
  const period = inferPlanPeriod(s);
  const between = s.match(/\b(?:from|between)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:and|to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (between) {
    const start = parsePlanHour(between[1], between[2], between[3] || between[6], period);
    const end = parsePlanHour(between[4], between[5], between[6] || between[3], period);
    if (start.ambiguous || end.ambiguous) return { needsClarification: true, hasTime: true, period };
    let endHour = end.hour;
    if (endHour <= start.hour) endHour += 12;
    return {
      startHour: start.hour,
      endHour: Math.min(endHour, 24),
      hasTime: true,
      explicit: true,
      period,
      assumption: ""
    };
  }

  const namedTime = !/\b(before|after)\s+noon\b/.test(s)
    ? s.match(/\b(?:at|around|about)?\s*(noon|midday|midnight)\b/)
    : null;
  if (namedTime) {
    const startHour = namedTime[1] === "midnight" ? 0 : 12;
    const duration = planDurationHours(activityKey);
    return {
      startHour,
      endHour: Math.min(startHour + duration, 24),
      hasTime: true,
      explicit: true,
      period: namedTime[1] === "midnight" ? "overnight" : "afternoon",
      assumption: `I used ${formatHourFloat(startHour)}-${formatHourFloat(Math.min(startHour + duration, 24))}.`
    };
  }

  const at = s.match(/\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (at) {
    const start = parsePlanHour(at[1], at[2], at[3], period);
    if (start.ambiguous) return { needsClarification: true, hasTime: true, period };
    const duration = planDurationHours(activityKey);
    return {
      startHour: start.hour,
      endHour: Math.min(start.hour + duration, 24),
      hasTime: true,
      explicit: true,
      period,
      assumption: `I used ${formatHourFloat(start.hour)}-${formatHourFloat(Math.min(start.hour + duration, 24))}.`
    };
  }

  if (period) {
    const window = planPeriodWindow(period, activityKey);
    return {
      ...window,
      hasTime: true,
      explicit: true,
      period: window.period || period,
      assumption: window.assumption
    };
  }

  const activityWindow = defaultActivityWindow(activityKey);
  if (activityWindow) {
    return {
      ...activityWindow,
      hasTime: true,
      explicit: false,
      period: activityWindow.period,
      assumption: activityWindow.assumption
    };
  }

  return { needsClarification: true, hasTime: false, period: null };
}

function inferPlanPeriod(s) {
  s = plannerParseText(s);
  if (/\bovernight\b/.test(s)) return "overnight";
  if (/\bmorning\b|\bbefore noon\b/.test(s)) return "morning";
  if (/\bafternoon\b|\bmidday\b/.test(s)) return "afternoon";
  if (/\bevening\b|\bafter work\b/.test(s)) return "evening";
  if (/\btonight\b|\bnight\b/.test(s)) return "night";
  return null;
}

function parsePlanHour(hourValue, minuteValue, meridiem, period) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) return { ambiguous: true };
  if (meridiem) {
    const m = meridiem.toLowerCase();
    if (m === "pm" && hour < 12) hour += 12;
    if (m === "am" && hour === 12) hour = 0;
    return { hour: hour + minute / 60, ambiguous: false };
  }
  if (period === "morning" || period === "overnight") {
    if (hour === 12) hour = 0;
    return { hour: hour + minute / 60, ambiguous: false };
  }
  if (period === "afternoon" || period === "evening" || period === "night") {
    if (hour < 12) hour += 12;
    return { hour: hour + minute / 60, ambiguous: false };
  }
  return { ambiguous: true };
}

function planDurationHours(activityKey) {
  if (activityKey === "golf") return 5;
  if (activityKey === "sports") return 3;
  if (activityKey === "dinner" || activityKey === "grill" || activityKey === "picnic") return 3;
  if (activityKey === "commute") return 1;
  return 2;
}

function planPeriodWindow(period, activityKey) {
  if (period === "morning") {
    const start = activityKey === "golf" || activityKey === "run" ? 7 : 8;
    return { startHour: start, endHour: 12, period: "morning", assumption: `I used ${formatHourRangeText(start, 12)} for morning.` };
  }
  if (period === "afternoon") {
    return { startHour: 12, endHour: 18, period: "afternoon", assumption: `I used ${formatHourRangeText(12, 18)} for afternoon.` };
  }
  if (period === "evening" || period === "night") {
    if (activityKey === "dinner" || activityKey === "grill" || activityKey === "picnic") {
      return { startHour: 17, endHour: 21, period: "evening", assumption: `I used ${formatHourRangeText(17, 21)} for dinner hours.` };
    }
    if (activityKey === "sports") {
      return { startHour: 18, endHour: 22, period: "evening", assumption: `I used ${formatHourRangeText(18, 22)} for game time.` };
    }
    return { startHour: 18, endHour: 22, period: "evening", assumption: `I used ${formatHourRangeText(18, 22)} for evening.` };
  }
  if (period === "overnight") {
    return { startHour: 0, endHour: 7, period: "overnight", assumption: `I used ${formatHourRangeText(0, 7)} for overnight.` };
  }
  return { startHour: 8, endHour: 20, period: "day", assumption: "I used daytime hours." };
}

function defaultActivityWindow(activityKey) {
  if (activityKey === "dinner" || activityKey === "grill") return { startHour: 17, endHour: 21, period: "evening", assumption: `I used ${formatHourRangeText(17, 21)} for dinner hours.` };
  return null;
}

function extractPlanLocationQuery(question) {
  const raw = String(question || "").trim();
  const candidates = [];
  let match;
  PLAN_LOCATION_PREPOSITION_RE.lastIndex = 0;
  while ((match = PLAN_LOCATION_PREPOSITION_RE.exec(raw)) !== null) {
    const rest = raw.slice(match.index + match[0].length);
    if (isTemporalLocationPhrase(rest)) continue;
    const value = cleanPlanLocation(rest);
    if (value) candidates.push(value);
  }
  return candidates[candidates.length - 1] || "";
}

function isTemporalLocationPhrase(value) {
  const key = normalizeQualifierKey(value);
  const s = plannerParseText(value).trim();
  if (!key || /^\d/.test(key)) return true;
  return /^(the )?(morning|afternoon|evening|night|weekend|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(key) ||
    /^(the )?(morning|afternoon|evening|night|weekend|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(s);
}

function cleanPlanLocation(value) {
  let text = String(value || "").trim().replace(/^the\s+/i, "");
  const stop = findPlanLocationStopIndex(text);
  if (stop >= 0) text = text.slice(0, stop).trim();
  text = text.replace(/[,.\s]+$/g, "").trim();
  const key = normalizeQualifierKey(text);
  return key && !PLAN_LOCATION_IGNORE.has(key) ? text : "";
}

async function inferImplicitPlanLocation(plan) {
  const candidates = implicitPlanLocationCandidates(plan);
  for (const query of candidates) {
    try {
      const options = await fetchPlannerPlaceOptions(query);
      if (isLikelyImplicitPlanLocation(query, options)) return { query, options };
    } catch {
      return null;
    }
  }
  return null;
}

function implicitPlanLocationCandidates(plan) {
  const s = plannerParseText(plan?.original || "").trim();
  if (!s) return [];
  const activityWords = planActivityLocationWords();
  const tokens = s
    .split(/\s+/)
    .map((token) => plannerCanonicalTerm(token) || token)
    .filter((token) => !shouldDropImplicitLocationToken(token, activityWords));
  const candidates = [];
  const add = (value) => {
    const query = cleanImplicitPlanLocation(value);
    const key = normalizeQualifierKey(query);
    if (!isViableImplicitLocationQuery(query) || candidates.some((item) => normalizeQualifierKey(item) === key)) return;
    candidates.push(query);
  };

  add(tokens.join(" "));
  for (let count = Math.min(5, tokens.length - 1); count >= 1; count -= 1) {
    add(tokens.slice(-count).join(" "));
  }
  return candidates.slice(0, 5);
}

function shouldDropImplicitLocationToken(token, activityWords) {
  if (!token) return true;
  if (/^\d{1,2}(?::\d{2})?$/.test(token) || /^(?:am|pm)$/.test(token)) return true;
  if (PLAN_LOCATION_STOP_WORDS.includes(token) || PLANNER_CANONICAL_TERMS.includes(token)) return true;
  if (PLAN_IMPLICIT_LOCATION_DROP_WORDS.has(token) || activityWords.has(token)) return true;
  return false;
}

function cleanImplicitPlanLocation(value) {
  return normalizeQualifierKey(value)
    .replace(/\s+/g, " ")
    .trim();
}

function isViableImplicitLocationQuery(query) {
  const key = normalizeQualifierKey(query);
  if (!key || PLAN_LOCATION_IGNORE.has(key)) return false;
  const words = key.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return false;
  if (words.length === 1 && words[0].length < 3) return false;
  if (words.every((word) =>
    PLAN_IMPLICIT_LOCATION_DROP_WORDS.has(word) ||
    PLAN_LOCATION_STOP_WORDS.includes(word) ||
    PLANNER_CANONICAL_TERMS.includes(word) ||
    planActivityLocationWords().has(word)
  )) return false;
  return true;
}

function isLikelyImplicitPlanLocation(query, { parsed, matches }) {
  if (!matches?.length) return false;
  const words = normalizeQualifierKey(query).split(/\s+/).filter(Boolean);
  const [top, second] = matches;
  const topName = normalizeQualifierKey(top.place?.name || "");
  const primary = normalizeQualifierKey(parsed?.primary || query);
  const hasQualifier = Boolean(parsed?.stateName || parsed?.countryCode || parsed?.region);
  const exactName = topName === primary;
  const closeToActive = state.activePlace && distanceKm(state.activePlace, top.place) < 250;
  const clearGap = !second || top.score >= second.score + 12;

  if (hasQualifier && top.score >= 45) return true;
  if (words.length >= 2 && top.score >= 42 && (exactName || clearGap || closeToActive)) return true;
  if (words.length === 1 && words[0].length >= 4 && exactName && top.score >= 45) return true;
  if (closeToActive && top.score >= 60) return true;
  return false;
}

function planActivityLocationWords() {
  if (planActivityLocationWordCache) return planActivityLocationWordCache;
  const words = new Set(["event", "game", "practice", "match", "tournament", "tee", "time", "round"]);
  Object.values(ACTIVITY_RULES).forEach((rule) => {
    [rule.label, ...(rule.aliases || [])].forEach((term) => {
      normalizeQualifierKey(term).split(/\s+/).forEach((word) => {
        if (word) words.add(word);
      });
    });
  });
  planActivityLocationWordCache = words;
  return words;
}

function findPlanLocationStopIndex(text) {
  const re = /\b[a-z]{2,}\b/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].toLowerCase();
    const token = plannerCanonicalTerm(raw) || raw;
    if (PLAN_LOCATION_STOP_WORDS.includes(token)) return match.index;
  }
  const punct = text.search(/[?.!]/);
  return punct >= 0 ? punct : -1;
}

function mergeLocationClarification(original, detail) {
  const a = String(original || "").trim();
  const b = String(detail || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (normalizeQualifierKey(b).includes(normalizeQualifierKey(a))) return b;
  return `${a}, ${b}`;
}

async function completePlanRequest(plan, override = {}) {
  const baseContext = buildAIContext();
  const nextPlan = { ...plan };
  if (override.locationQuery) {
    nextPlan.locationQuery = override.locationQuery;
    nextPlan.locationExplicit = true;
  }
  if (override.dayIdx != null) {
    nextPlan.dayIdx = override.dayIdx;
    nextPlan.dayExplicit = true;
    nextPlan.targetDate = null;
  }
  if (override.dayText) {
    const dayIdx = resolveDayIndex(askText(override.dayText), baseContext);
    if (dayIdx != null) {
      nextPlan.dayIdx = dayIdx;
      nextPlan.dayExplicit = true;
      nextPlan.targetDate = null;
    }
  }
  if (override.timeText) {
    const timeText = normalizePlanTimeClarification(override.timeText);
    nextPlan.timing = inferPlanTiming(
      override.replaceTime ? timeText : `${nextPlan.original} ${timeText}`,
      baseContext,
      nextPlan.activityKey
    );
  }

  if (!nextPlan.dayExplicit) {
    return { clarification: buildDayClarification(nextPlan, baseContext) };
  }

  if (nextPlan.timing?.needsClarification || !nextPlan.timing?.hasTime) {
    return { clarification: buildTimeClarification(nextPlan) };
  }

  const inferredLocation = !override.place && !nextPlan.locationQuery
    ? await inferImplicitPlanLocation(nextPlan)
    : null;
  if (inferredLocation) {
    nextPlan.locationQuery = inferredLocation.query;
    nextPlan.locationExplicit = true;
    nextPlan.locationImplicit = true;
  }

  const placeResult = override.place
    ? { place: normalizePlace(override.place), data: override.data || null, alerts: override.alerts || null }
    : inferredLocation
      ? resolvePlanPlaceOptions(nextPlan, inferredLocation.options)
      : await resolvePlanPlace(nextPlan);
  if (placeResult.clarification) return placeResult;

  const place = normalizePlace(placeResult.place);
  const usingActivePlace = samePlanPlace(place, state.activePlace);
  const data = placeResult.data || (usingActivePlace ? state.forecast : await fetchForecast(place));
  const alerts = placeResult.alerts || (usingActivePlace ? activeAlerts : await safeFetchPlanAlerts(place));
  const c = buildAIContext(data, place, alerts);
  if (!c) return { answer: "I need a loaded forecast before I can check that plan." };

  const dayIdx = resolvePlanDayIndex(nextPlan, data, c);
  if (dayIdx === null) {
    return { answer: "I can only check plans inside the next 10 days right now." };
  }

  const window = {
    dayIdx,
    startHour: nextPlan.timing.startHour,
    endHour: nextPlan.timing.endHour,
    period: nextPlan.timing.period,
    label: "custom"
  };
  const stats = planWindowStats(data, c, window);
  if (!stats) return { answer: "I could not find hourly forecast data for that plan window." };

  const startMs = planBoundaryMs(data, window.startHour, dayIdx);
  const endMs = planBoundaryMs(data, window.endHour, dayIdx);
  const alert = topAlertForPlanRange(alerts, startMs, endMs);
  const displayLabel = planWindowDisplayLabel(nextPlan, stats);
  const result = {
    answer: planAnswer(nextPlan, place, c, stats, alert),
    event: plannerShowEvent({
      title: `${planDisplayName(nextPlan)} ${displayLabel}`,
      place,
      data,
      alerts,
      window,
      stats,
      label: displayLabel
    })
  };
  if (!override.confirmed) {
    return {
      clarification: buildPlanConfirmation(nextPlan, result, {
        place,
        data,
        alerts,
        dayIdx,
        window,
        stats
      })
    };
  }
  return result;
}

function plannerShowEvent({ title, place, data, alerts, window, stats, label }) {
  const startMs = planBoundaryMs(data, window.startHour, window.dayIdx);
  const endMs = planBoundaryMs(data, window.endHour, window.dayIdx);
  if (!data || !place || startMs === null || endMs === null || endMs <= startMs) return null;
  return {
    title,
    place: normalizePlace(place),
    data,
    alerts: alerts || [],
    dayIndex: window.dayIdx,
    startHour: window.startHour,
    endHour: window.endHour,
    startMs,
    endMs,
    label: label || stats?.label || "plan window"
  };
}

function loadPlanMemories() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAN_MEMORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePlanMemory).filter(Boolean).slice(0, 60);
  } catch {
    return [];
  }
}

function savePlanMemories() {
  try {
    localStorage.setItem(PLAN_MEMORY_KEY, JSON.stringify(state.planMemories.slice(0, 60)));
  } catch {
    /* localStorage can be full or unavailable; keep the in-memory session copy. */
  }
}

function normalizePlanMemory(memory) {
  if (!memory || memory.kind !== "plan") return null;
  const place = normalizePlace(memory.place || {});
  if (!Number.isFinite(Number(place?.latitude)) || !Number.isFinite(Number(place?.longitude))) return null;
  const startHour = Number(memory.startHour);
  const endHour = Number(memory.endHour);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) return null;
  const targetDate = String(memory.targetDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  return {
    id: String(memory.id || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    kind: "plan",
    title: String(memory.title || "Plan").slice(0, 80),
    label: String(memory.label || "Plan window").slice(0, 80),
    original: String(memory.original || "").slice(0, 220),
    answer: String(memory.answer || "").slice(0, 280),
    place,
    targetDate,
    startHour,
    endHour,
    createdAt: Number(memory.createdAt) || Date.now(),
    updatedAt: Number(memory.updatedAt) || Date.now()
  };
}

function planMemoryFromEvent(event, exchange = {}) {
  if (!event?.data || !event.place) return null;
  const targetDate = event.data.daily?.time?.[event.dayIndex];
  if (!targetDate) return null;
  return normalizePlanMemory({
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "plan",
    title: event.title || event.label || "Plan",
    label: event.label || "Plan window",
    original: exchange.q || "",
    answer: exchange.a || "",
    place: event.place,
    targetDate,
    startHour: event.startHour,
    endHour: event.endHour,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

function planMemoryMatchesEvent(memory, event) {
  if (!memory || !event?.data || !event.place) return false;
  const targetDate = event.data.daily?.time?.[event.dayIndex];
  return targetDate === memory.targetDate &&
    samePlanPlace(memory.place, event.place) &&
    Math.abs(memory.startHour - event.startHour) < 0.01 &&
    Math.abs(memory.endHour - event.endHour) < 0.01;
}

function rememberedPlanIdForEvent(event) {
  return state.planMemories.find((memory) => planMemoryMatchesEvent(memory, event))?.id || "";
}

function rememberPlanFromThread(rowIndex) {
  const exchange = askThread[rowIndex];
  if (!exchange?.event) return;
  const existing = rememberedPlanIdForEvent(exchange.event);
  if (existing) {
    exchange.memoryId = existing;
    renderAsk();
    return;
  }
  const memory = planMemoryFromEvent(exchange.event, exchange);
  if (!memory) return;
  state.planMemories = [memory, ...state.planMemories].slice(0, 60);
  exchange.memoryId = memory.id;
  savePlanMemories();
  if (typeof recordForYouSignal === "function") recordForYouSignal("plan-watched");
  renderAsk();
  refreshPlanMemorySurfaces();
  if (!savePlanWatchBaselineForMemory(memory.id, { replace: true })) {
    const pending = planMemoryListItems(state.forecast, state.activePlace, { includePast: false })
      .filter((item) => item.memory.id === memory.id);
    if (pending.length) refreshPlanWatchForecasts(pending);
  }
}

function clearPlannerMemoryEdit() {
  plannerEditingMemoryId = "";
  plannerEditingMemoryDraft = "";
}

function applyPlanMemoryEdit(memoryId, normalized, options = {}) {
  const existing = state.planMemories.find((memory) => memory.id === memoryId);
  const event = normalized?.event;
  if (!existing || !event) return false;
  const next = planMemoryFromEvent(event, {
    q: options.original || existing.original || planMemoryDraft(existing),
    a: normalized.answer || existing.answer || ""
  });
  if (!next) return false;
  const updated = {
    ...next,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now()
  };
  state.planMemories = state.planMemories.map((memory) =>
    memory.id === existing.id ? updated : memory
  );
  askThread.forEach((exchange) => {
    if (exchange.memoryId === existing.id) exchange.memoryId = "";
  });
  if (Number.isInteger(options.row) && askThread[options.row]) {
    askThread[options.row].memoryId = existing.id;
  }
  savePlanMemories();
  clearPlanWatchTracking(existing.id);
  clearPlannerMemoryEdit();
  refreshPlanMemorySurfaces();
  if (!savePlanWatchBaselineForMemory(existing.id, { replace: true })) {
    const pending = planMemoryListItems(state.forecast, state.activePlace, { includePast: false })
      .filter((item) => item.memory.id === existing.id);
    if (pending.length) refreshPlanWatchForecasts(pending);
  }
  syncPlanWatchNotificationSubscription({ force: true, reason: "plan-edited" });
  return true;
}

function forgetPlanMemory(id) {
  const before = state.planMemories.length;
  state.planMemories = state.planMemories.filter((memory) => memory.id !== id);
  setPlanWatchNotificationPlan(id, false);
  askThread.forEach((exchange) => {
    if (exchange.memoryId === id) exchange.memoryId = "";
  });
  if (plannerEditingMemoryId === id) clearPlannerMemoryEdit();
  if (state.planMemories.length !== before) savePlanMemories();
  if (state.planMemories.length !== before) clearPlanWatchTracking(id);
  renderAsk();
  refreshPlanMemorySurfaces();
  syncPlanWatchNotificationSubscription({ force: true, reason: "plan-forgotten" });
}

function startPlanMemoryEdit(idOrRow) {
  const rowIndex = Number(idOrRow);
  const exchange = Number.isInteger(rowIndex) ? askThread[rowIndex] : null;
  const memory = exchange ? null : state.planMemories.find((item) => item.id === idOrRow);
  if (exchange?.event) {
    const preview = previewPlanMemoryFromEvent(exchange.event, exchange, rowIndex);
    if (preview) {
      openStructuredPlanEdit(preview, {
        source: "thread",
        rowIndex,
        data: exchange.event.data,
        alerts: exchange.event.alerts || []
      });
      return;
    }
  }
  if (!memory) {
    editPlanMemory(idOrRow);
    return;
  }

  openStructuredMemoryEdit(memory.id);
}

function startMemoryTextEdit(id) {
  const memory = state.planMemories.find((item) => item.id === id);
  if (!memory) return;

  const restoreScroll = !els.aiSheet?.hidden
    ? els.aiSheet.scrollTop
    : plannerReturnAfterDayDetail?.scrollTop ?? null;
  if (!els.memoryDetailSheet?.hidden) closeMemoryDetail();
  if (!els.memoryEditSheet?.hidden) closeMemoryEditSheet();

  const dayDetail = document.getElementById("dayDetail");
  if (dayDetail && !dayDetail.hidden) {
    plannerReturnAfterDayDetail = null;
    closeDayDetail();
  }

  if (els.aiSheet?.hidden) {
    openAISheet({ restoreScroll, autoBrief: false });
  } else if (restoreScroll !== null && restoreScroll !== undefined) {
    els.aiSheet.scrollTop = restoreScroll;
  }
  renderAsk();
  requestAnimationFrame(() => editPlanMemory(memory.id));
}

function editPlanMemory(idOrRow) {
  const rowIndex = Number(idOrRow);
  const exchange = Number.isInteger(rowIndex) ? askThread[rowIndex] : null;
  const memory = exchange ? null : state.planMemories.find((item) => item.id === idOrRow);
  const draft = exchange?.q || memory?.original || planMemoryDraft(memory);
  if (memory) {
    plannerEditingMemoryId = memory.id;
    plannerEditingMemoryDraft = draft;
  } else {
    clearPlannerMemoryEdit();
  }
  fillPlannerTemplate(draft, {
    helperText: memory
      ? "Editing this plan. Submit to replace it."
      : "Adjust the plan, then submit it again."
  });
}

async function showPlanMemory(id, options = {}) {
  const memory = state.planMemories.find((item) => item.id === id);
  if (!memory) return;
  const returnToPlanner = options.returnToPlanner ?? !els.aiSheet?.hidden;
  plannerReturnAfterDayDetail = returnToPlanner
    ? { scrollTop: els.aiSheet?.scrollTop || 0 }
    : null;
  if (!els.aiSheet?.hidden) closeAISheet();
  const switchingPlaces = !samePlanPlace(memory.place, state.activePlace);
  const previousForecast = state.forecast;
  if (switchingPlaces) {
    await loadPlace(memory.place);
    if (state.forecast === previousForecast) {
      const returnState = plannerReturnAfterDayDetail;
      plannerReturnAfterDayDetail = null;
      if (returnToPlanner) openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
      return;
    }
  }
  const event = planMemoryEvent(memory);
  if (!event) {
    const returnState = plannerReturnAfterDayDetail;
    plannerReturnAfterDayDetail = null;
    if (returnToPlanner) openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
    return;
  }
  const opened = openPlannerEventDetail(event);
  if (!opened) {
    const returnState = plannerReturnAfterDayDetail;
    plannerReturnAfterDayDetail = null;
    if (returnToPlanner) openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
  }
}

function openPlanWatchForMemory(id, options = {}) {
  const memory = state.planMemories.find((item) => item.id === id);
  if (!memory) return;
  openGlobalMemorySheet({ focusMemoryId: memory.id, source: options.source || "plan" });
}

function openPlanMemoryWindowDetail(id) {
  const memory = state.planMemories.find((item) => item.id === id);
  if (!memory) return false;
  openMemoryDetail(memory.id, { mode: "plan-window" });
  if (!samePlanPlace(memory.place, state.activePlace)) {
    refreshPlanWatchForecasts([{ memory, isHere: false, isPast: planWatchMemoryIsPast(memory) }]);
  }
  return true;
}

function memoryIdsFromValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function openMemoryDetail(idsOrValue, options = {}) {
  const ids = [...new Set(memoryIdsFromValue(idsOrValue))];
  const memories = ids
    .map((id) => state.planMemories.find((memory) => memory.id === id))
    .filter(Boolean);
  if (!memories.length || !els.memoryDetailSheet || !els.memoryDetailBackdrop || !els.memoryDetailBody) return;
  memoryDetailMode = options.mode === "plan-window" && memories.length === 1 ? "plan-window" : "facts";
  memoryDetailIds = memories.map((memory) => memory.id);
  document.getElementById("memoryDetailTitle").textContent = memoryDetailMode === "plan-window"
    ? "Hourly detail"
    : memories.length === 1
      ? planMemoryTitle(memories[0])
      : `${memories.length} plans`;
  document.getElementById("memoryDetailSub").textContent = memoryDetailMode === "plan-window"
    ? `${planMemoryTitle(memories[0])} · ${planMemoryTimeText(memories[0])}`
    : memories.length === 1
      ? "Local context · under your control"
      : "Overlapping local context";
  els.memoryDetailBody.innerHTML = memoryDetailMode === "plan-window"
    ? renderPlanWindowDetailPanel(memories[0])
    : memories.map(renderMemoryDetailPanel).join("");
  els.memoryDetailBackdrop.hidden = false;
  els.memoryDetailSheet.hidden = false;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  showSheet(els.memoryDetailBackdrop, els.memoryDetailSheet, {
    onPullDismiss: closeMemoryDetail,
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
}

function refreshOpenMemoryDetail() {
  if (!els.memoryDetailSheet || els.memoryDetailSheet.hidden) return;
  const ids = memoryDetailIds.filter((id) => state.planMemories.some((memory) => memory.id === id));
  if (!ids.length) {
    closeMemoryDetail();
    return;
  }
  openMemoryDetail(ids, { mode: memoryDetailMode });
}

function closeMemoryDetail() {
  if (!els.memoryDetailSheet || !els.memoryDetailBackdrop || els.memoryDetailSheet.hidden) return;
  els.memoryDetailBackdrop.classList.remove("show");
  els.memoryDetailSheet.classList.remove("show");
  const keepLocked =
    !document.getElementById("dayDetail")?.hidden ||
    !els.memorySheet?.hidden ||
    !els.aiSheet?.hidden ||
    !document.getElementById("alertSheet")?.hidden ||
    !els.placeSheet?.hidden ||
    mapState.immersive;
  document.body.style.overflow = keepLocked ? "hidden" : "";
  setTimeout(() => {
    els.memoryDetailBackdrop.hidden = true;
    els.memoryDetailSheet.hidden = true;
    if (typeof updateSheetNowJump === "function") updateSheetNowJump();
  }, 260);
}

function memoryEditDateLabel(iso, data = memoryEditState?.data) {
  const idx = data?.daily?.time?.indexOf(iso) ?? -1;
  const date = new Date(`${iso}T12:00:00`);
  const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  if (idx === 0) return `Today, ${dateLabel}`;
  if (idx === 1) return `Tomorrow, ${dateLabel}`;
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return `${weekday}, ${dateLabel}`;
}

function memoryEditHourLabel(hour) {
  const value = Number(hour);
  const label = formatClock(value, 0, false, false);
  return value === 24 ? `${label} next day` : label;
}

function memoryEditDateOptions(selectedDate = memoryEditState?.targetDate) {
  const dates = [...(memoryEditState?.data?.daily?.time || [])].slice(0, 10);
  if (selectedDate && !dates.includes(selectedDate)) dates.unshift(selectedDate);
  return dates.map((date) =>
    `<option value="${escapeHtml(date)}"${date === selectedDate ? " selected" : ""}>${escapeHtml(memoryEditDateLabel(date))}</option>`
  ).join("");
}

function memoryEditTimeOptions(selected, min, max) {
  const options = [];
  for (let hour = min; hour <= max; hour++) {
    options.push(`<option value="${hour}"${Number(selected) === hour ? " selected" : ""}>${escapeHtml(memoryEditHourLabel(hour))}</option>`);
  }
  return options.join("");
}

function memoryEditWindowText(state = memoryEditState) {
  if (!state) return "";
  return `${memoryEditDateLabel(state.targetDate, state.data)} · ${hourText(state.startHour)}-${hourText(state.endHour)}`;
}

function openStructuredMemoryEdit(id) {
  const memory = state.planMemories.find((item) => item.id === id);
  if (!memory || !els.memoryEditSheet || !els.memoryEditBackdrop || !els.memoryEditBody) {
    startMemoryTextEdit(id);
    return;
  }
  openStructuredPlanEdit(memory, { source: "memory" });
}

function startPlanConfirmationEdit(pending, options = {}) {
  const event = pending?.result?.event;
  if (!event) return;
  const memory = previewPlanMemoryFromEvent(event, {
    q: options.original || pending.plan?.original || "",
    a: pending.result?.answer || ""
  }, "confirm");
  if (!memory) return;
  openStructuredPlanEdit(memory, {
    source: "confirm",
    updateMemoryId: options.updateMemoryId || "",
    original: options.original || pending.plan?.original || "",
    rowIndex: Number.isInteger(options.rowIndex) ? options.rowIndex : pending.rowIndex,
    restoreClarification: pending,
    data: event.data,
    alerts: event.alerts || []
  });
}

function memoryEditForecastKeyForPlace(place) {
  if (!place) return "";
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  return `${lat.toFixed(3)}:${lon.toFixed(3)}:${state.unit}`;
}

function openStructuredPlanEdit(memory, options = {}) {
  if (!memory || !els.memoryEditSheet || !els.memoryEditBackdrop || !els.memoryEditBody) return;
  if (!els.memoryDetailSheet?.hidden) closeMemoryDetail();

  const place = normalizePlace(memory.place);
  const here = samePlanPlace(place, state.activePlace);
  const initialData = options.data || (here ? state.forecast : null);
  const initialAlerts = options.alerts || (here ? activeAlerts : []);
  memoryEditState = {
    source: options.source || "memory",
    memoryId: options.source === "memory" ? memory.id : options.updateMemoryId || "",
    rowIndex: Number.isInteger(options.rowIndex) ? options.rowIndex : null,
    restoreClarification: options.restoreClarification || null,
    applied: false,
    original: options.original || memory.original || "",
    title: planMemoryTitle(memory),
    place,
    placeQuery: placeLabel(place),
    targetDate: memory.targetDate,
    startHour: Math.max(0, Math.min(23, Math.floor(Number(memory.startHour) || 0))),
    endHour: Math.max(1, Math.min(24, Math.ceil(Number(memory.endHour) || 1))),
    data: initialData,
    alerts: initialAlerts,
    results: [],
    searchSeq: 0,
    previewSeq: 0,
    forecastKey: initialData ? memoryEditForecastKeyForPlace(place) : "",
    error: "",
    saving: false
  };
  if (memoryEditState.endHour <= memoryEditState.startHour) {
    memoryEditState.endHour = Math.min(24, memoryEditState.startHour + 1);
  }

  renderMemoryEditSheet();
  els.memoryEditBackdrop.hidden = false;
  els.memoryEditSheet.hidden = false;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  showSheet(els.memoryEditBackdrop, els.memoryEditSheet, {
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
  updateMemoryEditPreview({ fetchIfNeeded: true });
}

function renderMemoryEditSheet() {
  if (!memoryEditState || !els.memoryEditBody) return;
  const placeValue = memoryEditState.placeQuery || placeLabel(memoryEditState.place);
  const editingSavedPlan = memoryEditState.source === "memory";
  const saveLabel = editingSavedPlan ? "Save changes" : "Apply changes";
  const textEditAction = editingSavedPlan
    ? `<button type="button" data-memory-edit-text>Edit with text</button>`
    : "";
  els.memoryEditBody.innerHTML = `
    <form class="memory-edit-form" id="memoryEditForm">
      <label class="memory-edit-field">
        <span>Plan</span>
        <input id="memoryEditTitle" name="title" type="text" maxlength="80" value="${escapeHtml(memoryEditState.title)}" autocomplete="off">
      </label>
      <label class="memory-edit-field">
        <span>Place</span>
        <div class="memory-edit-place-row">
          <input id="memoryEditPlace" name="place" type="text" value="${escapeHtml(placeValue)}" autocomplete="off">
          <button type="button" data-memory-edit-search>Search</button>
        </div>
      </label>
      <div class="memory-edit-place-results" id="memoryEditPlaceResults" hidden></div>
      <div class="memory-edit-grid">
        <label class="memory-edit-field">
          <span>Date</span>
          <select id="memoryEditDate" name="date">${memoryEditDateOptions(memoryEditState.targetDate)}</select>
        </label>
        <label class="memory-edit-field">
          <span>Start</span>
          <select id="memoryEditStart" name="startHour">${memoryEditTimeOptions(memoryEditState.startHour, 0, 23)}</select>
        </label>
        <label class="memory-edit-field">
          <span>End</span>
          <select id="memoryEditEnd" name="endHour">${memoryEditTimeOptions(memoryEditState.endHour, 1, 24)}</select>
        </label>
      </div>
      <div class="memory-edit-preview" id="memoryEditPreview" role="status"></div>
      <div class="memory-edit-actions">
        <button class="memory-edit-save" type="submit"${memoryEditState.saving ? " disabled" : ""}>${saveLabel}</button>
        ${textEditAction}
      </div>
    </form>
  `;
  wireMemoryEditForm();
  renderMemoryEditPlaceResults();
}

function wireMemoryEditForm() {
  const form = document.getElementById("memoryEditForm");
  if (!form) return;
  form.addEventListener("submit", saveStructuredMemoryEdit);
  ["memoryEditTitle", "memoryEditDate", "memoryEditStart", "memoryEditEnd"].forEach((id) => {
    document.getElementById(id)?.addEventListener(id === "memoryEditTitle" ? "input" : "change", () => {
      syncMemoryEditStateFromForm();
      updateMemoryEditPreview({ fetchIfNeeded: true });
    });
  });
  const placeInput = document.getElementById("memoryEditPlace");
  placeInput?.addEventListener("input", () => {
    memoryEditState.placeQuery = placeInput.value;
    if (!memoryEditPlaceQueryMatchesSelected()) {
      memoryEditState.data = null;
      memoryEditState.alerts = [];
      memoryEditState.forecastKey = "";
      memoryEditState.results = [];
      renderMemoryEditPlaceResults();
      setMemoryEditPreview("<p>Save changes or tap Search to use this place.</p>", "is-warning");
    }
  });
  placeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchMemoryEditPlaces();
  });
  form.querySelector("[data-memory-edit-search]")?.addEventListener("click", searchMemoryEditPlaces);
  form.querySelector("[data-memory-edit-text]")?.addEventListener("click", () => {
    const id = memoryEditState?.memoryId;
    if (id) startMemoryTextEdit(id);
  });
  form.querySelectorAll("[data-memory-edit-place]").forEach((button) => {
    button.addEventListener("click", () => {
      selectMemoryEditPlace(Number(button.dataset.memoryEditPlace));
    });
  });
}

function syncMemoryEditStateFromForm() {
  if (!memoryEditState) return;
  const title = document.getElementById("memoryEditTitle")?.value || "";
  const date = document.getElementById("memoryEditDate")?.value || memoryEditState.targetDate;
  const start = Number(document.getElementById("memoryEditStart")?.value);
  let end = Number(document.getElementById("memoryEditEnd")?.value);
  memoryEditState.title = title.trim();
  memoryEditState.targetDate = date;
  memoryEditState.startHour = Number.isFinite(start) ? start : memoryEditState.startHour;
  if (!Number.isFinite(end)) end = memoryEditState.endHour;
  if (end <= memoryEditState.startHour) end = Math.min(24, memoryEditState.startHour + 1);
  memoryEditState.endHour = end;
  const endSelect = document.getElementById("memoryEditEnd");
  if (endSelect && Number(endSelect.value) !== end) endSelect.value = String(end);
}

function renderMemoryEditPlaceResults(message = "") {
  const box = document.getElementById("memoryEditPlaceResults");
  if (!box || !memoryEditState) return;
  if (message) {
    box.hidden = false;
    box.innerHTML = `<p>${escapeHtml(message)}</p>`;
    return;
  }
  if (!memoryEditState.results?.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = memoryEditState.results.map((place, index) => `
    <button type="button" data-memory-edit-place="${index}">
      <strong>${escapeHtml(place.name)}</strong>
      <span>${escapeHtml(formatPlaceResultMeta(place) || placeLabel(place))}</span>
    </button>
  `).join("");
  wireMemoryEditPlaceResultButtons();
}

function wireMemoryEditPlaceResultButtons() {
  document.querySelectorAll("#memoryEditPlaceResults [data-memory-edit-place]").forEach((button) => {
    button.addEventListener("click", () => {
      selectMemoryEditPlace(Number(button.dataset.memoryEditPlace));
    });
  });
}

async function searchMemoryEditPlaces() {
  if (!memoryEditState) return;
  const input = document.getElementById("memoryEditPlace");
  const query = (input?.value || "").trim();
  if (!query) {
    renderMemoryEditPlaceResults("Enter a city, state, or country.");
    return;
  }
  const seq = ++memoryEditState.searchSeq;
  renderMemoryEditPlaceResults("Searching places...");
  try {
    const options = await fetchPlannerPlaceOptions(query);
    if (!memoryEditState || seq !== memoryEditState.searchSeq) return;
    memoryEditState.results = (options.matches || []).slice(0, 5).map(({ place }) => normalizePlace(place));
    renderMemoryEditPlaceResults(memoryEditState.results.length ? "" : "No matching places found.");
  } catch {
    if (!memoryEditState || seq !== memoryEditState.searchSeq) return;
    renderMemoryEditPlaceResults("Could not search places.");
  }
}

function selectMemoryEditPlace(index) {
  if (!memoryEditState) return;
  const place = memoryEditState.results?.[index];
  if (!place) return;
  memoryEditState.place = normalizePlace(place);
  memoryEditState.placeQuery = placeLabel(memoryEditState.place);
  memoryEditState.data = samePlanPlace(memoryEditState.place, state.activePlace) ? state.forecast : null;
  memoryEditState.alerts = samePlanPlace(memoryEditState.place, state.activePlace) ? activeAlerts : [];
  memoryEditState.forecastKey = "";
  memoryEditState.results = [];
  memoryEditState.error = "";
  renderMemoryEditSheet();
  updateMemoryEditPreview({ fetchIfNeeded: true });
}

function memoryEditErrorMessage(err, fallback = "I could not save that edit. Check the date, time, and place.") {
  return err?.userMessage || fallback;
}

function memoryEditPlaceQueryMatchesSelected() {
  if (!memoryEditState?.place) return false;
  const query = String(memoryEditState.placeQuery || "").trim();
  if (!query) return false;
  const parsed = parseLocationQuery(query);
  const place = memoryEditState.place;
  const queryKey = normalizeQualifierKey(query);
  const labelKeys = [
    placeLabel(place),
    place.name,
    [place.name, place.admin1].filter(Boolean).join(" "),
    [place.name, place.country].filter(Boolean).join(" ")
  ].map(normalizeQualifierKey).filter(Boolean);
  return labelKeys.includes(queryKey) || planPlaceMatchesParsedQuery(place, parsed);
}

function planPlaceMatchesParsedQuery(place, parsed) {
  if (!place || !parsed) return false;
  const primary = normalizeQualifierKey(parsed.primary || parsed.raw);
  const name = normalizeQualifierKey(place.name);
  if (primary && name !== primary) return false;
  const state = normalizeQualifierKey(parsed.stateName || "");
  const admin = normalizeQualifierKey(place.admin1 || "");
  if (state && admin && admin !== state) return false;
  const country = String(parsed.countryCode || "").toUpperCase();
  if (country && placeCountryCode(place) && placeCountryCode(place) !== country) return false;
  return Boolean(primary || state || country);
}

function memoryEditResolvedPlaceFromOptions(options) {
  const matches = options?.matches || [];
  if (!matches.length) return null;
  if (shouldClarifyPlanPlace(options)) return null;
  return normalizePlace(matches[0].place);
}

async function ensureMemoryEditPlace() {
  if (!memoryEditState) return null;
  const input = document.getElementById("memoryEditPlace");
  const query = (input?.value || memoryEditState.placeQuery || "").trim();
  memoryEditState.placeQuery = query;
  if (!query) {
    const error = new Error("Missing place.");
    error.userMessage = "Enter a place before saving.";
    throw error;
  }
  if (memoryEditPlaceQueryMatchesSelected()) return memoryEditState.place;

  renderMemoryEditPlaceResults("Checking place...");
  const options = await fetchPlannerPlaceOptions(query);
  if (!memoryEditState) return null;
  const resolved = memoryEditResolvedPlaceFromOptions(options);
  memoryEditState.results = (options.matches || []).slice(0, 5).map(({ place }) => normalizePlace(place));
  if (!resolved) {
    renderMemoryEditPlaceResults(memoryEditState.results.length ? "" : "No matching places found.");
    const error = new Error("Unresolved place.");
    error.userMessage = memoryEditState.results.length
      ? "Choose a place from the search results before saving."
      : `I could not find "${query}". Try city + state.`;
    throw error;
  }

  memoryEditState.place = resolved;
  memoryEditState.placeQuery = placeLabel(resolved);
  memoryEditState.data = samePlanPlace(resolved, state.activePlace) ? state.forecast : null;
  memoryEditState.alerts = samePlanPlace(resolved, state.activePlace) ? activeAlerts : [];
  memoryEditState.forecastKey = "";
  memoryEditState.results = [];
  memoryEditState.error = "";
  renderMemoryEditPlaceResults();
  return memoryEditState.place;
}

function memoryEditForecastKey() {
  return memoryEditForecastKeyForPlace(memoryEditState?.place);
}

async function ensureMemoryEditForecast() {
  if (!memoryEditState?.place) return null;
  const key = memoryEditForecastKey();
  if (memoryEditState.data && memoryEditState.forecastKey === key) return memoryEditState.data;
  if (samePlanPlace(memoryEditState.place, state.activePlace) && state.forecast) {
    memoryEditState.data = state.forecast;
    memoryEditState.alerts = activeAlerts || [];
    memoryEditState.forecastKey = key;
    return memoryEditState.data;
  }
  const place = normalizePlace(memoryEditState.place);
  const data = await fetchForecast(place);
  if (!memoryEditState || memoryEditForecastKey() !== key) return null;
  memoryEditState.data = data;
  memoryEditState.alerts = await safeFetchPlanAlerts(place);
  memoryEditState.forecastKey = key;
  return data;
}

function refreshMemoryEditDateSelect() {
  const select = document.getElementById("memoryEditDate");
  if (!select || !memoryEditState) return;
  const current = memoryEditState.targetDate;
  select.innerHTML = memoryEditDateOptions(current);
  select.value = current;
}

function setMemoryEditPreview(html, statusClass = "") {
  const preview = document.getElementById("memoryEditPreview");
  if (!preview) return;
  preview.className = `memory-edit-preview${statusClass ? ` ${statusClass}` : ""}`;
  preview.innerHTML = html;
}

async function updateMemoryEditPreview(options = {}) {
  if (!memoryEditState) return;
  syncMemoryEditStateFromForm();
  const seq = ++memoryEditState.previewSeq;
  const { fetchIfNeeded = false } = options;
  if (!memoryEditState.title) {
    setMemoryEditPreview("<p>Add a plan name before saving.</p>", "is-warning");
    return;
  }
  if (fetchIfNeeded) {
    try {
      await ensureMemoryEditPlace();
      if (!memoryEditState || seq !== memoryEditState.previewSeq) return;
    } catch (err) {
      setMemoryEditPreview(`<p>${escapeHtml(memoryEditErrorMessage(err, "I could not check that place. Try city + state."))}</p>`, "is-warning");
      return;
    }
  }
  let data = memoryEditState.data;
  if (!data && fetchIfNeeded) {
    setMemoryEditPreview("<p>Checking that place's forecast...</p>", "is-loading");
    try {
      data = await ensureMemoryEditForecast();
      if (!memoryEditState || seq !== memoryEditState.previewSeq) return;
      refreshMemoryEditDateSelect();
    } catch {
      setMemoryEditPreview("<p>Could not load the forecast for this place.</p>", "is-warning");
      return;
    }
  }
  if (!data) {
    setMemoryEditPreview("<p>Search and choose a place to preview this plan.</p>", "is-warning");
    return;
  }
  const dayIdx = data.daily?.time?.indexOf(memoryEditState.targetDate) ?? -1;
  if (dayIdx < 0) {
    setMemoryEditPreview("<p>This date is outside the available forecast window.</p>", "is-warning");
    return;
  }
  const c = buildAIContext(data, memoryEditState.place, memoryEditState.alerts || []);
  const stats = c ? planWindowStats(data, c, {
    dayIdx,
    startHour: memoryEditState.startHour,
    endHour: memoryEditState.endHour,
    label: "custom"
  }) : null;
  if (!stats) {
    setMemoryEditPreview("<p>No hourly forecast data for that window.</p>", "is-warning");
    return;
  }
  const startMs = planBoundaryMs(data, memoryEditState.startHour, dayIdx);
  const endMs = planBoundaryMs(data, memoryEditState.endHour, dayIdx);
  const alert = topAlertForPlanRange(memoryEditState.alerts || [], startMs, endMs);
  setMemoryEditPreview(`
    <div><span>Window</span><strong>${escapeHtml(memoryEditWindowText())}</strong></div>
    <div><span>Weather</span><strong>${escapeHtml(stats.sky)}</strong></div>
    <div><span>Rain</span><strong>${stats.rainChance}%</strong></div>
    <div><span>Wind</span><strong>${stats.windMax} ${escapeHtml(c.units.wind)}</strong></div>
    <div><span>Temp</span><strong>${stats.tempMin}${escapeHtml(c.units.temp)}-${stats.tempMax}${escapeHtml(c.units.temp)}</strong></div>
    ${alert ? `<div><span>Weather alert</span><strong>${escapeHtml(alert.event)}</strong></div>` : ""}
  `);
}

function structuredMemoryAnswer(draft, stats, c, alert) {
  const text = `${draft.title} ${draft.original || ""}`;
  const activityKey = detectAskActivity(text) || detectPlanActivity(text) || "walk";
  const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.walk;
  const score = numericWindowScore(rule, stats);
  const tone = alert ? alertTone(alert) : "";
  const verdict = planVerdict(score, tone);
  const reasons = planReasons(stats, c.units, alert).slice(0, 4).join(", ");
  return `${draft.title} ${memoryEditWindowText(draft)} in ${placeLabel(draft.place)}: ${verdict}. Why: ${reasons}. ${planAdvice(stats, alert, score)}`.replace(/\s+/g, " ").trim();
}

function structuredMemoryResult(draft, data, window, stats, c, alert) {
  return {
    answer: structuredMemoryAnswer(draft, stats, c, alert),
    event: plannerShowEvent({
      title: draft.title,
      place: draft.place,
      data,
      alerts: draft.alerts || [],
      window,
      stats,
      label: draft.label
    })
  };
}

async function saveStructuredMemoryEdit(event) {
  event?.preventDefault();
  if (!memoryEditState || memoryEditState.saving) return;
  syncMemoryEditStateFromForm();
  if (!memoryEditState.title) {
    setMemoryEditPreview("<p>Add a plan name before saving.</p>", "is-warning");
    return;
  }
  memoryEditState.saving = true;
  renderMemoryEditSheet();
  setMemoryEditPreview("<p>Saving changes...</p>", "is-loading");
  try {
    await ensureMemoryEditPlace();
    const data = await ensureMemoryEditForecast();
    refreshMemoryEditDateSelect();
    const dayIdx = data?.daily?.time?.indexOf(memoryEditState.targetDate) ?? -1;
    if (dayIdx < 0) throw new Error("Date outside forecast.");
    const c = buildAIContext(data, memoryEditState.place, memoryEditState.alerts || []);
    const window = {
      dayIdx,
      startHour: memoryEditState.startHour,
      endHour: memoryEditState.endHour,
      label: "custom"
    };
    const stats = c ? planWindowStats(data, c, window) : null;
    if (!stats) throw new Error("No window stats.");
    const startMs = planBoundaryMs(data, window.startHour, dayIdx);
    const endMs = planBoundaryMs(data, window.endHour, dayIdx);
    const alert = topAlertForPlanRange(memoryEditState.alerts || [], startMs, endMs);
    const draft = {
      ...memoryEditState,
      data,
      label: memoryEditWindowText(memoryEditState)
    };
    const result = structuredMemoryResult(draft, data, window, stats, c, alert);

    if (memoryEditState.source === "thread") {
      const rowIndex = memoryEditState.rowIndex;
      if (!Number.isInteger(rowIndex) || !askThread[rowIndex]) throw new Error("Plan result missing.");
      const normalized = normalizeAskResult(result);
      askThread[rowIndex].a = normalized.answer;
      askThread[rowIndex].event = normalized.event;
      askThread[rowIndex].memoryId = "";
      clearPlannerMemoryEdit();
      renderAsk();
      refreshPlanMemorySurfaces();
      closeMemoryEditSheet();
      return;
    }

    if (memoryEditState.source === "confirm") {
      memoryEditState.applied = true;
      const existingRow = Number.isInteger(memoryEditState.rowIndex) && askThread[memoryEditState.rowIndex]
        ? memoryEditState.rowIndex
        : null;
      const row = existingRow ?? beginAskResponse(memoryEditState.original || draft.title);
      finishAskResponse(row, result, memoryEditState.memoryId ? {
        updateMemoryId: memoryEditState.memoryId,
        original: memoryEditState.original || draft.title
      } : {});
      closeMemoryEditSheet();
      return;
    }

    const existing = state.planMemories.find((memory) => memory.id === memoryEditState.memoryId);
    if (!existing) throw new Error("Plan missing.");
    const updated = normalizePlanMemory({
      ...existing,
      title: draft.title,
      label: draft.label,
      original: existing.original || `${draft.title} ${hourText(draft.startHour)}-${hourText(draft.endHour)} in ${placeLabel(draft.place)}`,
      answer: result.answer,
      place: draft.place,
      targetDate: draft.targetDate,
      startHour: draft.startHour,
      endHour: draft.endHour,
      updatedAt: Date.now()
    });
    if (!updated) throw new Error("Invalid memory.");
    state.planMemories = state.planMemories.map((memory) =>
      memory.id === updated.id ? updated : memory
    );
    savePlanMemories();
    clearPlanWatchTracking(updated.id);
    clearPlannerMemoryEdit();
    renderAsk();
    refreshPlanMemorySurfaces();
    if (!savePlanWatchBaselineForMemory(updated.id, { replace: true })) {
      const pending = planMemoryListItems(state.forecast, state.activePlace, { includePast: false })
        .filter((item) => item.memory.id === updated.id);
      if (pending.length) refreshPlanWatchForecasts(pending);
    }
    syncPlanWatchNotificationSubscription({ force: true, reason: "plan-edited" });
    closeMemoryEditSheet();
  } catch (err) {
    if (memoryEditState) memoryEditState.saving = false;
    renderMemoryEditSheet();
    setMemoryEditPreview(`<p>${escapeHtml(memoryEditErrorMessage(err))}</p>`, "is-warning");
  }
}

function closeMemoryEditSheet() {
  if (!els.memoryEditSheet || !els.memoryEditBackdrop || els.memoryEditSheet.hidden) return;
  const restoreClarification = memoryEditState?.source === "confirm" && !memoryEditState.applied
    ? memoryEditState.restoreClarification
    : null;
  els.memoryEditBackdrop.classList.remove("show");
  els.memoryEditSheet.classList.remove("show");
  const keepLocked =
    !document.getElementById("dayDetail")?.hidden ||
    !els.memoryDetailSheet?.hidden ||
    !els.memorySheet?.hidden ||
    !els.aiSheet?.hidden ||
    !document.getElementById("alertSheet")?.hidden ||
    !els.placeSheet?.hidden ||
    mapState.immersive;
  document.body.style.overflow = keepLocked ? "hidden" : "";
  setTimeout(() => {
    els.memoryEditBackdrop.hidden = true;
    els.memoryEditSheet.hidden = true;
    memoryEditState = null;
    if (restoreClarification) {
      setPlannerClarification(restoreClarification, restoreClarification.rowIndex);
      renderAsk();
    }
    if (typeof updateSheetNowJump === "function") updateSheetNowJump();
  }, 260);
}

function renderMemoryDetailPanel(memory) {
  const event = samePlanPlace(memory.place, state.activePlace)
    ? planMemoryEvent(memory)
    : null;
  const original = String(memory.original || "").trim();
  const answer = String(memory.answer || "").trim();
  const interpreted = `${planMemoryTitle(memory)} · ${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  const saved = memoryTimestamp(memory.createdAt);
  const updated = memory.updatedAt && Math.abs(memory.updatedAt - memory.createdAt) > 1000
    ? memoryTimestamp(memory.updatedAt)
    : "";
  const weatherLine = event ? planMemoryMeta(memory, event) : `${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  return `
    <article class="memory-detail-panel">
      <div class="memory-detail-title">
        <strong>${escapeHtml(planMemoryTitle(memory))}</strong>
        <span>${escapeHtml(placeLabel(memory.place))}</span>
      </div>
      <dl class="memory-detail-facts">
        <div><dt>You asked</dt><dd>${escapeHtml(original || planMemoryDraft(memory))}</dd></div>
        <div><dt>Plan window</dt><dd>${escapeHtml(interpreted)}</dd></div>
        <div><dt>Forecast read</dt><dd>${escapeHtml(weatherLine)}</dd></div>
        ${answer ? `<div><dt>Last answer</dt><dd>${escapeHtml(answer)}</dd></div>` : ""}
        <div><dt>Saved</dt><dd>${escapeHtml(saved)}${updated ? ` · updated ${escapeHtml(updated)}` : ""}</dd></div>
      </dl>
      <div class="memory-detail-actions">
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit plan</button>
        <button type="button" data-memory-hourly="${escapeHtml(memory.id)}">Hourly detail</button>
        <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
      </div>
    </article>
  `;
}

function planWindowDetailContext(memory) {
  const isHere = samePlanPlace(memory.place, state.activePlace);
  const source = planWatchSourceForMemory(memory, isHere);
  if (!source.data) {
    return {
      source,
      watch: planWatchPendingItem(memory, source, planWatchMemoryIsPast(memory)),
      event: null
    };
  }
  const event = planMemoryEventForData(memory, source.data, source.place, source.alerts);
  const watch = planWatchItemForMemoryItem({ memory, event, isHere, isPast: planWatchMemoryIsPast(memory) });
  return { source, event, watch };
}

function planWindowDetailTempUnit(watch) {
  return watch?.units?.temp || degree(state.unit === "fahrenheit" ? "F" : "C");
}

function planWindowDetailWindUnit(watch) {
  return watch?.units?.wind || (state.unit === "fahrenheit" ? "mph" : "km/h");
}

function planWindowDetailPrecipUnit(watch) {
  return watch?.units?.precip || (state.unit === "fahrenheit" ? "in" : "mm");
}

function planWindowDetailUnitValue(value, unit) {
  if (!Number.isFinite(Number(value))) return "--";
  return `${Math.round(Number(value))}${unit || ""}`;
}

function planWindowDetailAmount(value, unit) {
  const amount = Number(value || 0);
  if (!amount) return "0";
  return `${formatAmount(amount)} ${unit}`.trim();
}

function planWindowDetailHourLabel(row) {
  if (typeof formatHour === "function") return formatHour(row.time);
  return formatHourFloat(row.hour);
}

function planWindowDetailRowPosition(row, event) {
  if (row.inWindow) return "Plan hour";
  return row.ms < event.startMs ? "Before" : "After";
}

function planWindowDetailRows(event, data) {
  if (!event?.startMs || !event?.endMs || !data?.hourly?.time?.length) return [];
  const bufferMs = 60 * 60 * 1000;
  const startMs = event.startMs - bufferMs;
  const endMs = event.endMs + bufferMs;
  return data.hourly.time
    .map((time, index) => {
      const ms = parseForecastTimestamp(time, data);
      if (ms === null) return null;
      const code = Number(data.hourly.weather_code?.[index]);
      const precip = Number(data.hourly.precipitation?.[index] || 0);
      const pop = Math.round(Number(data.hourly.precipitation_probability?.[index] || 0));
      const wind = Math.round(Number(data.hourly.wind_speed_10m?.[index] || 0));
      const gust = Math.round(Number(data.hourly.wind_gusts_10m?.[index] || wind));
      const temp = Math.round(Number(data.hourly.temperature_2m?.[index] || 0));
      const feels = Math.round(Number(data.hourly.apparent_temperature?.[index] ?? temp));
      const uv = Math.round(Number(data.hourly.uv_index?.[index] || 0));
      return {
        index,
        time,
        ms,
        hour: forecastLocalHour(time),
        inWindow: ms >= event.startMs && ms < event.endMs,
        code,
        label: weatherCodes[code] || "Weather",
        temp,
        feels,
        pop,
        precip,
        wind,
        gust,
        uv,
        isDay: data.hourly.is_day ? Boolean(data.hourly.is_day[index]) : true,
        storm: [95, 96, 99].includes(code)
      };
    })
    .filter((row) => row && row.ms >= startMs && row.ms < endMs);
}

function planWindowDetailHourScore(row, risk, unit) {
  if (!row) return -Infinity;
  const preference = unit === "celsius" ? "celsius" : "fahrenheit";
  const feels = Number(row.feels || 0);
  const gust = Number(row.gust || 0);
  const rain = Number(row.pop || 0);
  const precip = Number(row.precip || 0);
  if (risk === "heat") return feels * 1.6 + Number(row.uv || 0) * 5 + Math.max(0, rain - 35) * 0.25;
  if (risk === "cold") return -feels * 1.4 + gust * 0.7 + rain * 0.2;
  if (risk === "rain" || risk === "flood") return rain + precip * 160 + gust * 0.25;
  if (risk === "storm") return rain + precip * 140 + gust * 0.45 + (row.storm ? 35 : 0);
  if (risk === "wind") return gust * 2 + Number(row.wind || 0) + rain * 0.15;
  const target = preference === "celsius" ? 22 : 72;
  return rain * 0.55 + Math.abs(feels - target) * 1.2 + Math.max(0, gust - 20);
}

function planWindowDetailPeakHour(rows, watch) {
  const risk = planWatchRiskKind(watch);
  const unit = planWeatherUnitFromItem(watch);
  return rows
    .filter((row) => row.inWindow)
    .map((row) => ({ row, score: planWindowDetailHourScore(row, risk, unit) }))
    .sort((a, b) => b.score - a.score)[0]?.row || null;
}

function planWindowDetailPeakLabel(watch) {
  const risk = planWatchRiskKind(watch);
  if (watch?.tone === "good") return "Key hour";
  if (risk === "heat") return "Hottest part";
  if (risk === "cold") return "Coldest part";
  if (risk === "rain" || risk === "flood") return "Wettest part";
  if (risk === "storm") return "Stormiest part";
  if (risk === "wind") return "Windiest part";
  return "Key hour";
}

function planWindowDetailPeakText(row, watch) {
  if (!row) return "";
  const risk = planWatchRiskKind(watch);
  const tempUnit = planWindowDetailTempUnit(watch);
  const windUnit = planWindowDetailWindUnit(watch);
  const precipUnit = planWindowDetailPrecipUnit(watch);
  const time = planWindowDetailHourLabel(row);
  if (risk === "heat") return `${time}: feels ${planWindowDetailUnitValue(row.feels, tempUnit)}, UV ${row.uv || "low"}.`;
  if (risk === "cold") return `${time}: feels ${planWindowDetailUnitValue(row.feels, tempUnit)}, gusts ${row.gust} ${windUnit}.`;
  if (risk === "rain" || risk === "flood") return `${time}: rain ${row.pop}%, ${planWindowDetailAmount(row.precip, precipUnit)}.`;
  if (risk === "storm") return `${time}: rain ${row.pop}%, gusts ${row.gust} ${windUnit}.`;
  if (risk === "wind") return `${time}: gusts ${row.gust} ${windUnit}.`;
  return `${time}: ${row.label.toLowerCase()}, feels ${planWindowDetailUnitValue(row.feels, tempUnit)}.`;
}

function planWindowDetailAdjustmentHint(rows, peak, watch) {
  const action = String(watch?.action || "").trim();
  if (!peak || !watch || watch.tone === "good") return action || "The plan window looks manageable right now.";
  const risk = planWatchRiskKind(watch);
  const unit = planWeatherUnitFromItem(watch);
  const peakScore = planWindowDetailHourScore(peak, risk, unit);
  const outside = rows
    .filter((row) => !row.inWindow)
    .map((row) => ({ row, score: planWindowDetailHourScore(row, risk, unit) }))
    .sort((a, b) => a.score - b.score)[0];
  const threshold = risk === "heat" || risk === "cold" || risk === "wind" ? 8 : 18;
  if (outside && peakScore - outside.score >= threshold) {
    return `If timing can move, ${planWindowDetailHourLabel(outside.row)} looks easier than the peak hour.`;
  }
  return action || "Keep the plan flexible and check the timing before you go.";
}

function renderPlanWindowPendingPanel(memory, watch) {
  const status = watch?.status || "idle";
  const copy = status === "error"
    ? "Nearcast could not refresh this place yet. Try opening the place or checking again shortly."
    : "Nearcast is checking this place's forecast. The plan-window detail will appear when the forecast is ready.";
  return `
    <article class="plan-window-detail is-pending">
      <div class="plan-window-detail-head">
        <span>Plan window</span>
        <h3>${escapeHtml(planMemoryTitle(memory))}</h3>
        <p>${escapeHtml(planWatchMetaText(memory, watch))}</p>
      </div>
      <p class="plan-window-empty">${escapeHtml(copy)}</p>
      <div class="memory-detail-actions">
        <button type="button" data-memory-show="${escapeHtml(memory.id)}">Open watched plan</button>
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Change plan</button>
      </div>
    </article>
  `;
}

function renderPlanWindowHourRow(row, event, peak, watch) {
  const tempUnit = planWindowDetailTempUnit(watch);
  const windUnit = planWindowDetailWindUnit(watch);
  const precipUnit = planWindowDetailPrecipUnit(watch);
  const isPeak = peak && row.index === peak.index;
  return `
    <article class="plan-window-hour${row.inWindow ? " is-in-window" : " is-buffer"}${isPeak ? " is-peak" : ""}">
      <span class="plan-window-hour-time">${escapeHtml(planWindowDetailHourLabel(row))}</span>
      <span class="plan-window-hour-icon" aria-hidden="true">${weatherIcon(row.code, row.isDay, { density: "dense" })}</span>
      <span class="plan-window-hour-main">
        <strong>${escapeHtml(row.label)}</strong>
        <small>${escapeHtml(planWindowDetailRowPosition(row, event))}${isPeak ? " · key hour" : ""}</small>
      </span>
      <dl>
        <div><dt>Feels</dt><dd>${escapeHtml(planWindowDetailUnitValue(row.feels, tempUnit))}</dd></div>
        <div><dt>Rain</dt><dd>${row.pop}%${row.precip ? ` · ${escapeHtml(planWindowDetailAmount(row.precip, precipUnit))}` : ""}</dd></div>
        <div><dt>Gust</dt><dd>${row.gust} ${escapeHtml(windUnit)}</dd></div>
        <div><dt>UV</dt><dd>${row.uv || "Low"}</dd></div>
      </dl>
    </article>
  `;
}

function renderPlanWindowDetailPanel(memory) {
  const detail = planWindowDetailContext(memory);
  const watch = detail.watch;
  if (!detail.event || !watch?.stats) return renderPlanWindowPendingPanel(memory, watch);

  const rows = planWindowDetailRows(detail.event, watch.data || detail.source.data);
  const peak = planWindowDetailPeakHour(rows, watch);
  const signals = planContextSignalRows(watch).map(renderPlanSignalChip).join("");
  const reason = watch.fullReason || watch.primaryReason || watch.reason || "Nearcast checked this plan against the forecast.";
  const hint = planWindowDetailAdjustmentHint(rows, peak, watch);
  return `
    <article class="plan-window-detail is-${escapeHtml(watch.tone || "pending")}">
      <div class="plan-window-detail-head">
        <span>Plan window</span>
        <h3>${escapeHtml(watch.label || "Forecast checked")}</h3>
        <p>${escapeHtml(planWatchMetaText(memory, watch))}</p>
      </div>
      <section class="plan-window-story">
        <p><span>Main read</span>${escapeHtml(reason)}</p>
        ${hint ? `<p><span>Best adjustment</span>${escapeHtml(hint)}</p>` : ""}
      </section>
      ${signals ? `<div class="plan-watch-signals plan-window-signals">${signals}</div>` : ""}
      ${peak ? `
        <section class="plan-window-peak">
          <span>${escapeHtml(planWindowDetailPeakLabel(watch))}</span>
          <strong>${escapeHtml(planWindowDetailPeakText(peak, watch))}</strong>
        </section>
      ` : ""}
      ${renderFocusedPlanReceipt(watch)}
      <section class="plan-window-hours" aria-label="Plan-window hourly forecast">
        ${rows.map((row) => renderPlanWindowHourRow(row, detail.event, peak, watch)).join("")}
      </section>
      <div class="memory-detail-actions">
        <button type="button" data-memory-day-hourly="${escapeHtml(memory.id)}">Full day hourly</button>
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Change plan</button>
        <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
      </div>
    </article>
  `;
}

function memoryTimestamp(value) {
  const date = new Date(Number(value) || Date.now());
  return new Intl.DateTimeFormat(undefined, timeFormatOptions({
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })).format(date);
}

function planMemoryEventForData(memory, data = state.forecast, place = state.activePlace, alerts = activeAlerts) {
  if (!memory || !data || !place || !samePlanPlace(memory.place, place)) return null;
  const dayIdx = data.daily?.time?.indexOf(memory.targetDate);
  if (dayIdx === undefined || dayIdx < 0) return null;
  const normalizedPlace = normalizePlace(place);
  const c = buildAIContext(data, normalizedPlace, alerts || []);
  if (!c) return null;
  const window = {
    dayIdx,
    startHour: memory.startHour,
    endHour: memory.endHour,
    label: "custom"
  };
  const stats = planWindowStats(data, c, window);
  if (!stats) return null;
  const event = plannerShowEvent({
    title: memory.title,
    place: normalizedPlace,
    data,
    alerts: alerts || [],
    window,
    stats,
    label: memory.label
  });
  if (event) {
    event.memoryId = memory.id;
    event.badgeLabel = "Plan";
  }
  return event;
}

function planMemoryEvent(memory, data = state.forecast, place = state.activePlace, alerts = activeAlerts) {
  return planMemoryEventForData(memory, data, place, alerts);
}

function planMemoryEventsForPlace(data = state.forecast, place = state.activePlace, options = {}) {
  if (!data || !place) return [];
  const { upcomingOnly = true, limit = Infinity } = options || {};
  const now = forecastNowMs(data);
  const items = state.planMemories
    .map((memory) => ({ memory, event: planMemoryEvent(memory, data, place) }))
    .filter(({ event }) => event && (!upcomingOnly || event.endMs >= now - 60 * 60 * 1000))
    .sort((a, b) => a.event.startMs - b.event.startMs);
  return Number.isFinite(limit) ? items.slice(0, Math.max(0, limit)) : items;
}

function activePlanMemoryEvents(data = state.forecast, place = state.activePlace) {
  return planMemoryEventsForPlace(data, place, { limit: 6 });
}

function activePlanMemoryEventsForDay(dayIndex, data = state.forecast, place = state.activePlace) {
  const index = Number(dayIndex);
  if (!Number.isInteger(index)) return [];
  return planMemoryEventsForPlace(data, place).filter(({ event }) => event.dayIndex === index);
}

function planMemoryDetailEventForDay(items, data = state.forecast, place = state.activePlace) {
  if (!items?.length) return null;
  if (items.length === 1) return items[0].event;
  const windows = items
    .map(({ event }) => event)
    .filter((event) => event && Number.isFinite(event.startMs) && Number.isFinite(event.endMs))
    .sort((a, b) => a.startMs - b.startMs);
  if (!windows.length) return null;
  const first = windows[0];
  const last = windows.reduce((best, event) => event.endMs > best.endMs ? event : best, first);
  return {
    title: `${items.length} plans`,
    place: normalizePlace(place),
    data,
    alerts: activeAlerts || [],
    dayIndex: first.dayIndex,
    startHour: Math.min(...windows.map((event) => event.startHour)),
    endHour: Math.max(...windows.map((event) => event.endHour)),
    startMs: first.startMs,
    endMs: last.endMs,
    label: "watched plans",
    badgeLabel: "Plan",
    memoryIds: items.map(({ memory }) => memory.id),
    windows
  };
}

function hourlyPlanMemoryContext(rows, data = state.forecast) {
  const markers = new Map();
  const overlaps = new Set();
  const items = activePlanMemoryEvents(data, state.activePlace);
  items.forEach(({ memory, event }) => {
    const touched = rows.filter((row, rowIndex) => {
      const start = row.ms;
      const next = rows[rowIndex + 1]?.ms;
      const end = next && next > start ? next : start + 60 * 60 * 1000;
      return start < event.endMs && end > event.startMs;
    });
    touched.forEach((row) => overlaps.add(row.index));
    const first = touched[0];
    if (!first) return;
    const list = markers.get(first.index) || [];
    list.push({ memory, event });
    markers.set(first.index, list);
  });
  return { markers, overlaps };
}

function hourlyPlanMemoryLabel(items) {
  if (!items?.length) return "";
  if (items.length > 1) return `${items.length} plans`;
  return planMemoryTitle(items[0].memory);
}

function planMemoryDayCue(items) {
  if (!items?.length) return "";
  if (items.length > 1) return `${items.length} plans`;
  const { memory } = items[0];
  return `${planMemoryTitle(memory)} ${planMemoryTimeText(memory)}`;
}

function planMemoryDayRangeText(items) {
  if (!items?.length) return "";
  if (items.length === 1) return planMemoryTimeText(items[0].memory);
  const starts = items.map(({ memory }) => memory.startHour).filter(Number.isFinite);
  const ends = items.map(({ memory }) => memory.endHour).filter(Number.isFinite);
  if (!starts.length || !ends.length) return "";
  return `${hourText(Math.min(...starts))}-${hourText(Math.max(...ends))}`;
}

function planMemoryDraft(memory) {
  if (!memory) return "";
  return `${memory.title} ${planMemoryTimeText(memory)} in ${placeLabel(memory.place)}`.replace(/\s+/g, " ").trim();
}

function planMemoryTitle(memory) {
  const raw = String(memory?.title || "Plan").trim();
  return raw.replace(/\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i, "").slice(0, 34) || raw;
}

function planMemoryTimeText(memory) {
  return `${hourText(memory.startHour)}-${hourText(memory.endHour)}`;
}

function planMemoryDayLabel(memory, data = state.forecast) {
  const idx = data?.daily?.time?.indexOf(memory.targetDate) ?? -1;
  if (idx >= 0) return formatDay(memory.targetDate, idx);
  return memory.targetDate;
}

function planMemoryMeta(memory, event = null) {
  const where = placeLabel(memory.place);
  const when = `${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  if (!event) return `${when} · ${where}`;
  const c = buildAIContext(event.data, event.place, event.alerts);
  if (!c) return `${when} · ${where}`;
  const stats = planWindowStats(event.data, c, {
    dayIdx: event.dayIndex,
    startHour: event.startHour,
    endHour: event.endHour,
    label: "custom"
  });
  if (!stats) return `${when} · ${where}`;
  return `${when} · ${stats.rainChance}% rain · ${stats.windMax} ${state.unit === "fahrenheit" ? "mph" : "km/h"}`;
}

function planMemoryListItems(data = state.forecast, place = state.activePlace, options = {}) {
  const { includePast = false } = options || {};
  const today = forecastLocalDate(data) || new Date().toISOString().slice(0, 10);
  const now = forecastNowMs(data);
  return state.planMemories
    .map((memory) => {
      const isHere = Boolean(place && samePlanPlace(memory.place, place));
      const event = isHere ? planMemoryEvent(memory, data, place) : null;
      const isPast = event ? event.endMs < now - 60 * 60 * 1000 : memory.targetDate < today;
      return { memory, event, isHere, isPast };
    })
    .filter((item) => includePast || !item.isPast)
    .sort((a, b) =>
      a.memory.targetDate.localeCompare(b.memory.targetDate) ||
      a.memory.startHour - b.memory.startHour ||
      a.memory.createdAt - b.memory.createdAt
    );
}

function planMemoryEventContextLabel(memory, event) {
  const place = event?.place ? placeLabel(event.place) : "";
  const title = memory ? planMemoryTitle(memory) : String(event?.title || "").trim();
  const when = memory ? planMemoryTimeText(memory) : "";
  return ["Plan", place, [title, when].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}

function planMemoryDayContextLabel(items, event) {
  if (!items?.length) return "";
  if (items.length === 1) return planMemoryEventContextLabel(items[0].memory, event);
  const place = event?.place ? placeLabel(event.place) : "";
  return ["Plan", place, `${items.length} plans`, planMemoryDayRangeText(items)].filter(Boolean).join(" · ");
}

function detailEventWindows(eventWindow) {
  if (!eventWindow) return [];
  if (Array.isArray(eventWindow)) return eventWindow.filter(Boolean);
  if (Array.isArray(eventWindow.windows) && eventWindow.windows.length) {
    return eventWindow.windows.filter(Boolean);
  }
  return [eventWindow];
}

function matchingDetailEventWindows(windows, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  return windows.filter((window) =>
    Number.isFinite(window?.startMs) &&
    Number.isFinite(window?.endMs) &&
    startMs < window.endMs &&
    endMs > window.startMs
  );
}

function detailEventBadgeLabel(windows, eventWindow = null) {
  if (!windows?.length) return "";
  const memoryWindows = windows.filter((window) => window.memoryId);
  if (memoryWindows.length > 1) return `${memoryWindows.length} plans`;
  if (memoryWindows.length === 1) return planMemoryTitle(memoryWindows[0]);
  if (windows.length > 1) return eventWindow?.badgeLabel || `${windows.length} plans`;
  return windows[0].badgeLabel || eventWindow?.badgeLabel || "Plan";
}

function graphMemoryWindowIds(window) {
  return [...new Set([
    window?.memoryId,
    ...(Array.isArray(window?.memoryIds) ? window.memoryIds : [])
  ].filter(Boolean).map(String))];
}

function graphMemoryWindowLabel(ids, fallback = "Plan") {
  if (!ids?.length) return fallback;
  if (ids.length > 1) return `${ids.length} plans`;
  const memory = state.planMemories.find((item) => item.id === ids[0]);
  return memory ? planMemoryTitle(memory) : fallback;
}

function normalizeGraphMemoryWindow(window, visibleStartMs, visibleEndMs) {
  if (!Number.isFinite(window?.startMs) || !Number.isFinite(window?.endMs)) return null;
  if (window.endMs <= visibleStartMs || window.startMs >= visibleEndMs) return null;
  const memoryIds = graphMemoryWindowIds(window);
  if (!memoryIds.length) return null;
  const startMs = Math.max(window.startMs, visibleStartMs);
  const endMs = Math.min(window.endMs, visibleEndMs);
  if (endMs <= startMs) return null;
  return {
    startMs,
    endMs,
    memoryIds,
    sourceWindows: [window]
  };
}

function graphMemoryWindows(hrs, data = state.forecast, eventWindow = null) {
  if (!hrs?.length || !data || !state.activePlace) return [];
  const startMs = hrs[0].ms ?? parseForecastTimestamp(hrs[0].time, data);
  const lastMs = hrs[hrs.length - 1].ms ?? parseForecastTimestamp(hrs[hrs.length - 1].time, data);
  if (!Number.isFinite(startMs) || !Number.isFinite(lastMs)) return [];
  const visibleEndMs = Math.max(lastMs + 60 * 60 * 1000, startMs + 60 * 60 * 1000);
  const seen = new Set();
  const raw = [];

  const pushWindow = (window) => {
    const normalized = normalizeGraphMemoryWindow(window, startMs, visibleEndMs);
    if (!normalized) return;
    const key = normalized.memoryIds.length
      ? `ids:${normalized.memoryIds.sort().join(",")}:${Math.round(normalized.startMs / 60000)}:${Math.round(normalized.endMs / 60000)}`
      : `time:${Math.round(normalized.startMs / 60000)}:${Math.round(normalized.endMs / 60000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push(normalized);
  };

  detailEventWindows(eventWindow).forEach(pushWindow);
  planMemoryEventsForPlace(data, state.activePlace, { limit: 12 }).forEach(({ event }) => pushWindow(event));
  raw.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  return raw.reduce((merged, item) => {
    const prev = merged[merged.length - 1];
    if (prev && item.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, item.endMs);
      prev.memoryIds = [...new Set(prev.memoryIds.concat(item.memoryIds))];
      prev.sourceWindows.push(...item.sourceWindows);
      prev.label = graphMemoryWindowLabel(prev.memoryIds);
      return merged;
    }
    merged.push({
      ...item,
      label: graphMemoryWindowLabel(item.memoryIds)
    });
    return merged;
  }, []);
}

function graphMemoryAtMs(ms, windows) {
  if (!Number.isFinite(ms) || !windows?.length) return null;
  return windows.find((window) => ms >= window.startMs && ms < window.endMs) || null;
}

function graphMemoryAriaLabel(window, data = state.forecast) {
  const start = formatForecastMs(window.startMs, data);
  const end = formatForecastMs(window.endMs, data);
  return `${window.label}, ${start} to ${end}. Show plan details.`;
}

function renderGraphMemoryBands(windows, xForMs, options = {}) {
  if (!windows?.length || typeof xForMs !== "function") return "";
  const {
    top = 18,
    bottom = 136,
    labelY = top + 13,
    minLabelWidth = 48,
    data = state.forecast
  } = options;
  const h = Math.max(1, bottom - top);
  return windows.map((window, index) => {
    const x1 = xForMs(window.startMs);
    const x2 = xForMs(window.endMs);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return "";
    const left = Math.min(x1, x2);
    const width = Math.max(3, Math.abs(x2 - x1));
    const center = left + width / 2;
    const ids = window.memoryIds.join(",");
    const label = width >= minLabelWidth ? window.label : "";
    const labelText = label.length > 18 ? `${label.slice(0, 17)}…` : label;
    const aria = graphMemoryAriaLabel(window, data);
    return `<g class="graph-memory-window graph-memory-window-${index % 4}" data-memory-detail="${escapeHtml(ids)}" tabindex="0" role="button" aria-label="${escapeHtml(aria)}">` +
      `<title>${escapeHtml(aria)}</title>` +
      `<rect class="graph-memory-band" x="${left.toFixed(1)}" y="${top}" width="${width.toFixed(1)}" height="${h}" rx="5"/>` +
      `<line class="graph-memory-edge" x1="${left.toFixed(1)}" y1="${top}" x2="${left.toFixed(1)}" y2="${bottom}"/>` +
      `<line class="graph-memory-edge" x1="${(left + width).toFixed(1)}" y1="${top}" x2="${(left + width).toFixed(1)}" y2="${bottom}"/>` +
      (labelText ? `<text class="graph-memory-label" x="${center.toFixed(1)}" y="${labelY}" text-anchor="middle">${escapeHtml(labelText)}</text>` : "") +
      `<rect class="graph-memory-hit" x="${left.toFixed(1)}" y="${Math.max(0, top - 12)}" width="${width.toFixed(1)}" height="${h + 24}" rx="8"/>` +
    `</g>`;
  }).join("");
}

function renderPlanMemoryGroup(label, items) {
  if (!items.length) return "";
  return `<div class="memory-group">` +
    `<div class="memory-group-title">${escapeHtml(label)}</div>` +
    `<div class="memory-list">` +
      items.map(({ memory, event, isHere }) => `
        <article class="memory-card">
          <button class="memory-main" type="button" data-memory-detail="${escapeHtml(memory.id)}" aria-label="${escapeHtml(`Inspect ${memory.title}`)}">
            <strong>${escapeHtml(planMemoryTitle(memory))}</strong>
            <span>${escapeHtml(planMemoryMeta(memory, event))}</span>
          </button>
          <div class="memory-actions">
            <button type="button" data-memory-show="${escapeHtml(memory.id)}">View plan</button>
            <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit</button>
            <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
          </div>
        </article>
      `).join("") +
    `</div>` +
  `</div>`;
}

function renderPlanMemorySection() {
  const allItems = planMemoryListItems(state.forecast, state.activePlace, { includePast: true });
  if (!allItems.length) return "";
  const upcoming = allItems.filter((item) => !item.isPast);
  if (!upcoming.length) return "";
  const summary = upcoming.length === 1 ? "1 watched plan" : `${upcoming.length} watched plans`;
  return `<section class="memory-section ask-watch-summary" aria-label="Watched plans">` +
    `<div class="ai-section-title memory-section-title">` +
      `<strong>Watching</strong>` +
      `<span>${escapeHtml(summary)}</span>` +
      `<button class="memory-manage-btn" type="button" data-memory-open>Open</button>` +
    `</div>` +
  `</section>`;
}

function planMemoryPlaceKey(memory) {
  const place = memory?.place || {};
  return [
    placeLabel(place),
    Number(place.latitude || 0).toFixed(3),
    Number(place.longitude || 0).toFixed(3)
  ].join("|");
}

function groupPlanMemoryItemsByPlace(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = planMemoryPlaceKey(item.memory);
    if (!groups.has(key)) {
      groups.set(key, {
        label: placeLabel(item.memory.place),
        items: []
      });
    }
    groups.get(key).items.push(item);
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function planWatchPlaceKey(place) {
  if (typeof continuityPlaceKey === "function") return continuityPlaceKey(place);
  const normalized = normalizePlace(place || {});
  return [
    placeLabel(normalized).toLowerCase(),
    Number(normalized.latitude || 0).toFixed(3),
    Number(normalized.longitude || 0).toFixed(3)
  ].join("|");
}

function planWatchForecastFreshness(data, key = "") {
  const provenance = data && typeof forecastProvenance === "function" ? forecastProvenance(data) : null;
  const checkedAt = Math.max(0, Number(provenance?.savedAt || planWatchState.lastFetchAt[key]) || 0);
  return {
    checkedAt,
    stale: Boolean(
      provenance?.cacheFallback ||
      (checkedAt && Date.now() - checkedAt > PLAN_WATCH_FORECAST_MAX_AGE_MS)
    )
  };
}

function planWatchSourceForMemory(memory, isHere = false) {
  const place = normalizePlace(memory?.place || {});
  const key = planWatchPlaceKey(place);
  if (isHere && state.forecast) {
    const freshness = planWatchForecastFreshness(state.forecast, key);
    return {
      key,
      place: normalizePlace(state.activePlace || place),
      data: state.forecast,
      alerts: activeAlerts || [],
      alertsReady: typeof activeAlertsReady === "undefined" ? true : Boolean(activeAlertsReady),
      status: "ready",
      ...freshness
    };
  }

  const cached = typeof readForecastCache === "function"
    ? readForecastCache(place, { maxAge: PLAN_WATCH_FORECAST_MAX_AGE_MS })
    : null;
  const data = planWatchState.data[key] || cached?.data || null;
  const freshness = planWatchForecastFreshness(data, key);
  return {
    key,
    place,
    data,
    alerts: planWatchState.alerts[key] || [],
    alertsReady: Boolean(planWatchState.alertsReady[key]),
    status: data ? "ready" : planWatchState.loading[key] ? "loading" : planWatchState.errors[key] ? "error" : "idle",
    error: planWatchState.errors[key] || "",
    ...freshness
  };
}

function planWatchPendingItem(memory, source, isPast = false) {
  const label = isPast
    ? "Past"
    : source.status === "error" ? "Refresh needed"
      : source.status === "loading" ? "Checking forecast"
        : "Waiting on forecast";
  const reason = isPast
    ? "Kept here until you forget it."
    : source.status === "error" ? "Could not update this place yet."
      : "This plan is saved; forecast detail will appear when this place is checked.";
  return {
    memory,
    source,
    status: source.status,
    tone: source.status === "error" ? "caution" : "pending",
    label,
    reason,
    isPast,
    event: null,
    stats: null,
    units: { temp: degree(state.unit === "fahrenheit" ? "F" : "C"), wind: state.unit === "fahrenheit" ? "mph" : "km/h" }
  };
}

function refreshPlanWatchBaselineStore(store = null) {
  planWatchState.baselineStore = store ||
    state.continuityBaseline?.store ||
    (typeof loadContinuityStore === "function" ? loadContinuityStore() : null);
  return planWatchState.baselineStore;
}

function planWatchBaselineStore() {
  return state.continuityBaseline?.store || planWatchState.baselineStore || refreshPlanWatchBaselineStore();
}

function planWatchComparisonForItem(item, source) {
  if (
    !item?.memory ||
    !item?.stats ||
    !source?.data ||
    typeof continuityPlanSnapshot !== "function" ||
    typeof continuityPlanKey !== "function" ||
    typeof continuityPlanChange !== "function"
  ) return { snapshot: null, previous: null, change: null };

  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const snapshot = continuityPlanSnapshot(item, source.data, source.place, tempUnit, windUnit, {
    alertsReady: source.alertsReady
  });
  const previous = snapshot ? planWatchBaselineStore()?.plans?.[continuityPlanKey(snapshot)] : null;
  const compatible = Boolean(
    snapshot &&
    previous &&
    previous.alertsReady !== false &&
    snapshot.alertsReady !== false &&
    previous.placeKey === snapshot.placeKey &&
    previous.targetDate === snapshot.targetDate &&
    previous.startHour === snapshot.startHour &&
    previous.endHour === snapshot.endHour &&
    previous.tempUnit === snapshot.tempUnit &&
    previous.windUnit === snapshot.windUnit
  );
  return {
    snapshot,
    previous: compatible ? previous : null,
    change: compatible && !source?.stale ? continuityPlanChange(snapshot, previous) : null
  };
}

function planWatchChangeForItem(item, source) {
  return planWatchComparisonForItem(item, source).change;
}

function planWatchResolvedForecastItem({ memory, event = null, isHere = false, isPast = false }) {
  const source = planWatchSourceForMemory(memory, isHere);
  if (!source.data) return { source, item: null, event: null, past: isPast };

  const watchEvent = event || planMemoryEventForData(memory, source.data, source.place, source.alerts);
  if (!watchEvent) return { source, item: null, event: null, past: isPast };

  const now = forecastNowMs(source.data);
  const past = isPast || watchEvent.endMs < now - 60 * 60 * 1000;
  const item = planBriefingItemFromEvent(memory, watchEvent, source.data, source.place, null, source.alerts);
  return { source, item, event: watchEvent, past };
}

function savePlanWatchBaselineForMemory(memoryId, options = {}) {
  const found = planMemoryListItems(state.forecast, state.activePlace, { includePast: true })
    .find((entry) => entry.memory.id === memoryId);
  if (!found || found.isPast) return false;
  const resolved = planWatchResolvedForecastItem(found);
  if (!resolved.item || resolved.source?.stale) return false;
  const comparison = planWatchComparisonForItem(resolved.item, resolved.source);
  const snapshot = comparison.snapshot;
  const key = snapshot && typeof continuityPlanKey === "function" ? continuityPlanKey(snapshot) : "";
  if (
    !snapshot ||
    snapshot.alertsReady === false ||
    !key ||
    typeof loadContinuityStore !== "function" ||
    typeof saveContinuityStore !== "function"
  ) return false;
  if (comparison.previous && !options.replace) return true;
  let store = loadContinuityStore();
  store.plans[key] = snapshot;
  if (typeof pruneContinuityStore === "function") {
    const placeKey = typeof continuityPlaceKey === "function" ? continuityPlaceKey(resolved.source.place) : "";
    store = pruneContinuityStore(store, placeKey);
  } else {
    store.updatedAt = Date.now();
  }
  saveContinuityStore(store);
  refreshPlanWatchBaselineStore(store);
  return true;
}

function savePlanWatchReviewedContinuitySnapshot(item, source) {
  if (
    !item?.memory?.id ||
    !source?.data ||
    !source?.place ||
    source?.stale ||
    typeof loadContinuityStore !== "function" ||
    typeof saveContinuityStore !== "function" ||
    typeof continuityPlanSnapshot !== "function" ||
    typeof continuityPlanKey !== "function"
  ) return;

  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const snapshot = continuityPlanSnapshot(item, source.data, source.place, tempUnit, windUnit, {
    alertsReady: source.alertsReady
  });
  const key = continuityPlanKey(snapshot);
  if (!key) return;

  let store = loadContinuityStore();
  store.plans[key] = snapshot;
  if (typeof pruneContinuityStore === "function") {
    const placeKey = typeof continuityPlaceKey === "function" ? continuityPlaceKey(source.place) : "";
    store = pruneContinuityStore(store, placeKey);
  } else {
    store.updatedAt = Date.now();
  }
  saveContinuityStore(store);
  refreshPlanWatchBaselineStore(store);
}

function markPlanWatchFocusedChangeReviewed(memoryId, expectedSignature = null) {
  const found = planMemoryListItems(state.forecast, state.activePlace, { includePast: true })
    .find((item) => item.memory.id === memoryId);
  if (!found || found.isPast) return false;
  const resolved = planWatchResolvedForecastItem(found);
  if (!resolved.item) return false;
  const comparison = planWatchComparisonForItem(resolved.item, resolved.source);
  let stored = planWatchStoredReceipt(found.memory, comparison.snapshot);
  if (comparison.change && !stored) {
    stored = capturePlanWatchChangeReceipt(comparison.snapshot, comparison.previous, comparison.change);
  }
  if (expectedSignature !== null && stored?.signature !== expectedSignature) return false;
  const change = stored?.change || comparison.change;
  if (!change?.body) return false;
  markPlanWatchChangeReviewed(found.memory, change);
  markPlanWatchReceiptReviewed(memoryId);
  savePlanWatchReviewedContinuitySnapshot(resolved.item, resolved.source);
  if (typeof recordForYouSignal === "function") recordForYouSignal("watch-change-reviewed");
  if (typeof refreshPlanAwareLaunchSurfaces === "function") refreshPlanAwareLaunchSurfaces();
  return true;
}

function planWatchItemForMemoryItem({ memory, event = null, isHere = false, isPast = false }) {
  const resolved = planWatchResolvedForecastItem({ memory, event, isHere, isPast });
  const { source, item, event: watchEvent, past } = resolved;
  if (!source.data) return planWatchPendingItem(memory, source, isPast);
  if (!watchEvent || !item) return planWatchPendingItem(memory, source, past);

  const comparison = planWatchComparisonForItem(item, source);
  const rawChange = comparison.change;
  let storedReceipt = planWatchStoredReceipt(memory, comparison.snapshot);
  if (rawChange && !past) {
    storedReceipt = capturePlanWatchChangeReceipt(comparison.snapshot, comparison.previous, rawChange) || storedReceipt;
  }
  const rawSignature = rawChange ? planWatchChangeReviewKey(memory, rawChange) : "";
  const rawAlreadyReviewed = Boolean(
    rawChange &&
    storedReceipt?.reviewedAt &&
    storedReceipt.signature === rawSignature
  );
  const effectiveRawChange = rawAlreadyReviewed ? null : rawChange;
  const durableUnreviewedChange = !effectiveRawChange && storedReceipt && !storedReceipt.reviewedAt
    ? storedReceipt.change
    : null;
  const durableReviewedChange = storedReceipt?.reviewedAt ? storedReceipt.change : null;
  const storedReviewedChange = effectiveRawChange && planWatchChangeWasReviewed(memory, effectiveRawChange)
    ? effectiveRawChange
    : null;
  const recentReviewedChange = !effectiveRawChange && !durableUnreviewedChange && !durableReviewedChange && !past
    ? planWatchRecentReviewedChange(memory.id)
    : null;
  const reviewedChange = durableReviewedChange || storedReviewedChange || recentReviewedChange;
  const change = reviewedChange ? null : (effectiveRawChange || durableUnreviewedChange);
  const truth = planWeatherTruth({ ...item, change, isPast: past, status: "ready" }) || {};
  const baselineAt = Number(
    (change || reviewedChange)?.receipt?.baselineAt ||
    comparison.previous?.savedAt ||
    0
  ) || 0;
  const checkedAt = Number(
    source.checkedAt ||
    comparison.snapshot?.forecastCheckedAt ||
    comparison.snapshot?.savedAt ||
    (change || reviewedChange)?.receipt?.checkedAt ||
    0
  ) || 0;
  const baselineIsCurrent = Boolean(
    baselineAt && checkedAt && Math.abs(checkedAt - baselineAt) < 2 * 60 * 1000
  );
  const comparisonState = past
    ? "past"
    : change ? "changed"
      : source.stale ? "stale"
        : reviewedChange ? "reviewed"
          : comparison.previous ? (baselineIsCurrent ? "baseline" : "stable")
            : "baseline";
  return {
    ...item,
    ...truth,
    source,
    data: source.data,
    place: source.place,
    event: watchEvent,
    status: "ready",
    label: past ? "Past" : truth.label,
    fullReason: past ? "Kept here until you forget it." : truth.fullReason,
    reason: past ? "Kept here until you forget it." : truth.reason,
    action: past ? "" : truth.action,
    notification: past ? planWeatherNotificationState({ ...item, ...truth, change, isPast: true, status: "ready" }) : truth.notification,
    change,
    reviewedChange,
    changeReviewed: Boolean(reviewedChange),
    storedReceipt,
    comparisonState,
    baselineAt,
    checkedAt,
    changeDetectedAt: Number(storedReceipt?.detectedAt || change?.receipt?.checkedAt || 0) || 0,
    isPast: past
  };
}

function planWatchWhenText(memory, data = state.forecast) {
  return `${planMemoryDayLabel(memory, data)} · ${planMemoryTimeText(memory)}`;
}

function planWatchMetaText(memory, watch) {
  return `${planWatchWhenText(memory, watch?.data || state.forecast)} · ${placeLabel(memory.place)}`;
}

function renderPlanWatchStatus(watch) {
  const tone = watch?.tone || "pending";
  const change = watch?.change;
  return `
    <div class="plan-watch-status is-${escapeHtml(tone)}">
      <span class="plan-watch-pill">${escapeHtml(watch?.label || "Waiting on forecast")}</span>
      <span class="plan-watch-reason">${escapeHtml(watch?.reason || "")}</span>
      ${change ? `<span class="plan-watch-change">${escapeHtml(change.body)}</span>` : ""}
    </div>
    ${renderPlanWatchSignals(watch)}
  `;
}

function planWatchAttentionRank(watch) {
  if (!watch || watch.isPast) return 0;
  if (watch.change?.type === "plan-alert") return 7;
  if (watch.change?.receipt?.direction === "worse") return 6;
  if (watch.tone === "watch") return 4;
  if (watch.tone === "caution") return 3;
  if (watch.change) return 2;
  if (watch.status === "loading") return 1;
  return 0;
}

function planWatchChangeEvidence(change) {
  const metric = change?.receipt?.metric;
  if (!metric?.before || !metric?.after) return change?.body || "";
  return `${metric.label}: ${metric.before} → ${metric.after}`;
}

function planWatchOverviewFactRows(watchItems) {
  const upcoming = (watchItems || []).filter((watch) => !watch?.isPast);
  const savedPlaces = placeWatchSavedPlaces().length;
  const selectedPlaces = placeWatchNotificationSelectedCount();
  const enabledPlans = planWatchNotificationEnabledCount(upcoming);
  const notificationsOn = planWatchNotificationsEnabled();
  const allowedCount = enabledPlans + (placeWatchNotificationsRequested() ? selectedPlaces : 0);
  const facts = [
    {
      value: String(upcoming.length),
      label: upcoming.length === 1 ? "active plan" : "active plans"
    },
    {
      value: selectedPlaces ? String(selectedPlaces) : String(savedPlaces),
      label: selectedPlaces
        ? selectedPlaces === 1 ? "place can notify" : "places can notify"
        : savedPlaces === 1 ? "saved place" : "saved places"
    },
    {
      value: notificationsOn ? String(allowedCount) : planWatchNotificationPermission() === "denied" ? "Blocked" : "In app",
      label: notificationsOn
        ? allowedCount === 1 ? "can notify you" : "can notify you"
        : "notifications"
    }
  ];
  return facts.filter((fact) => fact.value !== "0");
}

function renderPlanWatchOverview(watchItems) {
  const upcoming = watchItems.filter((watch) => !watch.isPast);
  const savedPlaces = placeWatchSavedPlaces().length;
  if (!upcoming.length && !savedPlaces) return "";
  const top = [...upcoming].sort((a, b) =>
    planWatchAttentionRank(b) - planWatchAttentionRank(a) ||
    (a.event?.startMs ?? Infinity) - (b.event?.startMs ?? Infinity)
  )[0];

  const tone = top?.comparisonState === "stale"
    ? "caution"
    : top?.tone || (savedPlaces ? "good" : "pending");
  let kicker = "Watching now";
  let title = "Nothing needs attention right now";
  let body = "Nearcast will keep plan and saved-place changes visible here.";
  const attentionCount = upcoming.filter((watch) => ["watch", "caution"].includes(watch.tone) && !watch.isPast).length;
  if (top?.change) {
    const changedWhen = formatPlanWatchRelativeTimestamp(top.changeDetectedAt || top.change?.receipt?.checkedAt);
    kicker = changedWhen ? `Forecast changed · ${changedWhen}` : "Forecast changed";
    title = top.change.title || `${planMemoryTitle(top.memory)} changed`;
    body = `${planWatchChangeEvidence(top.change) || top.change.body || top.reason}${top.source?.stale ? " · refresh needed" : ""}`;
  } else if (top?.comparisonState === "stale") {
    const checkedWhen = formatPlanWatchRelativeTimestamp(top.checkedAt);
    kicker = "Refresh needed";
    title = "Forecast check is out of date";
    body = `Nearcast cannot confirm whether this plan is still holding${checkedWhen ? ` · last forecast ${checkedWhen}` : ""}.`;
  } else if (top && attentionCount) {
    kicker = attentionCount === 1 ? "Needs a look" : `${attentionCount} need a look`;
    title = `${planMemoryTitle(top.memory)}: ${top.label}`;
    body = top.change?.body || top.reason || "Nearcast found weather worth checking.";
  } else if (top) {
    const checkedWhen = formatPlanWatchRelativeTimestamp(top.checkedAt);
    if (top.comparisonState === "baseline") {
      kicker = "Watching starts here";
      title = upcoming.length === 1 ? "Baseline saved for your plan" : "Baselines saved for your plans";
      body = "Nearcast will make the next meaningful forecast change easy to see.";
    } else {
      kicker = "All steady";
      title = "No meaningful forecast changes";
      body = upcoming.length === 1
        ? `${planMemoryTitle(top.memory)}: ${top.label || "Weather looks manageable"}${checkedWhen ? ` · checked ${checkedWhen}` : ""}.`
        : `Nothing has crossed a plan-changing threshold${checkedWhen ? ` · checked ${checkedWhen}` : ""}.`;
    }
  } else if (savedPlaces) {
    kicker = "Saved places";
    title = "Your places are ready to watch";
    body = "Choose which saved places are worth notifications for meaningful today or tomorrow changes.";
  }
  const facts = planWatchOverviewFactRows(upcoming);
  return `
    <section class="plan-watch-overview is-${escapeHtml(tone)}">
      <span>${escapeHtml(kicker)}</span>
      <h3>${escapeHtml(title)}</h3>
      <small>${escapeHtml(planWatchCompactText(body, 136))}</small>
      ${facts.length ? `
        <div class="plan-watch-overview-facts">
          ${facts.map((fact) => `
            <em><b>${escapeHtml(fact.value)}</b>${escapeHtml(fact.label)}</em>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function renderGlobalMemoryCard({ memory, event, isHere, isPast, watch = null }) {
  const watched = watch || planWatchItemForMemoryItem({ memory, event, isHere, isPast });
  const meta = planWatchMetaText(memory, watched);
  const effectivePast = Boolean(isPast || watched?.isPast);
  const kicker = effectivePast ? "Past" : isHere ? "This place" : "Away";
  const focused = memory.id === planWatchFocusMemoryId;
  const statusAria = watched?.change
    ? `Forecast changed. ${planWatchChangeEvidence(watched.change) || watched.change.body}`
    : `${watched?.label || "Waiting on forecast"}. ${watched?.reason || ""}`;
  const accessibleMeta = meta ? `${meta}. ` : "";
  return `
    <article class="memory-card global-memory-card${effectivePast ? " is-past" : ""}${isHere ? " is-here" : ""}${focused ? " is-focused" : ""} is-${escapeHtml(watched?.tone || "pending")}" data-memory-card="${escapeHtml(memory.id)}">
      <button class="memory-main global-memory-main" type="button" data-memory-show="${escapeHtml(memory.id)}" aria-label="${escapeHtml(`Open ${planMemoryTitle(memory)}. ${accessibleMeta}${statusAria}`)}">
        <span class="global-memory-kicker">${escapeHtml(kicker)}</span>
        <strong>${escapeHtml(planMemoryTitle(memory))}</strong>
        <span>${escapeHtml(meta)}</span>
        ${renderPlanWatchStatus(watched)}
      </button>
      <div class="memory-actions global-memory-actions">
        ${effectivePast ? "" : `<button type="button" data-memory-hourly="${escapeHtml(memory.id)}">${isHere ? "Hourly detail" : "Load hourly"}</button>`}
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit</button>
        <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
      </div>
    </article>
  `;
}

function renderGlobalMemoryCards(items, watchById) {
  return items.map((item) => renderGlobalMemoryCard({ ...item, watch: watchById?.get(item.memory.id) })).join("");
}

function renderGlobalMemoryGroup(label, items, options = {}) {
  if (!items.length) return "";
  const { sub = "", watchById = null } = options;
  return `
    <section class="global-memory-group">
      <div class="memory-group-title global-memory-group-title">
        <span>${escapeHtml(label)}</span>
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ""}
      </div>
      <div class="memory-list global-memory-list">
        ${renderGlobalMemoryCards(items, watchById)}
      </div>
    </section>
  `;
}

function setGlobalMemorySheetFocusedMode(focused) {
  const sub = document.getElementById("memorySheetSub");
  if (sub) {
    sub.textContent = focused
      ? "Your plan, checked against the forecast"
      : "Plans Nearcast is keeping an eye on";
  }
  els.memorySheet?.classList.toggle("is-focused-plan", Boolean(focused));
}

function renderFocusedPlanNotifyAction(watch, effectivePast) {
  if (effectivePast || !watch?.memory?.id) return "";
  const id = escapeHtml(watch.memory.id);
  const copy = planWatchNotificationPlanCopy(watch.memory.id);
  const disabled = copy.disabled ? " disabled" : "";
  const active = copy.pressed ? " is-active" : "";
  const aria = `${copy.aria} ${planMemoryTitle(watch.memory)}`.trim();
  return `<button class="${active.trim()}" type="button" data-watch-notify="${id}" aria-label="${escapeHtml(aria)}" aria-pressed="${copy.pressed ? "true" : "false"}" title="${escapeHtml(copy.title || aria)}"${disabled}>${escapeHtml(copy.label)}</button>`;
}

function renderFocusedPlanNotifyLimit(watch, effectivePast) {
  if (effectivePast || !watch?.memory?.id) return "";
  const copy = planWatchNotificationPlanCopy(watch.memory.id);
  if (copy.action !== "limit") return "";
  return `<p class="focused-plan-notify-limit">Notifications are already on for 3 plans. Turn one off in Watching before choosing this plan.</p>`;
}

function renderFocusedPlanChangeBlock(watch) {
  const change = watch?.change || (watch?.comparisonState === "stale" ? null : watch?.reviewedChange);
  if (!change?.body) {
    if (watch?.isPast) return "";
    const baseline = formatPlanWatchRelativeTimestamp(watch?.baselineAt);
    const checked = formatPlanWatchRelativeTimestamp(watch?.checkedAt);
    const freshness = [
      baseline ? `Comparison saved ${baseline}` : "",
      checked ? `checked ${checked}` : ""
    ].filter(Boolean).join(" · ");
    const stateValue = watch?.comparisonState || "baseline";
    const copy = stateValue === "stale"
      ? {
          label: "Refresh needed",
          title: "Using the last usable forecast",
          body: "Nearcast will compare again when a fresh forecast is available."
        }
      : stateValue === "stable"
        ? {
            label: "No meaningful change",
            title: "Forecast is holding steady",
            body: "Nothing has crossed a threshold that should change this plan."
          }
        : {
            label: "Baseline saved",
            title: "Watching starts here",
            body: "Future forecasts will be compared with this plan window."
          };
    return `
      <section class="focused-plan-change is-${escapeHtml(stateValue)}" aria-label="${escapeHtml(copy.label)}">
        <span>${escapeHtml(copy.label)}</span>
        <h4>${escapeHtml(copy.title)}</h4>
        <p>${escapeHtml(copy.body)}</p>
        ${freshness ? `<small>${escapeHtml(freshness)}</small>` : ""}
      </section>
    `;
  }
  const reviewed = !watch?.change && Boolean(watch?.reviewedChange);
  const tone = change.tone || watch?.tone || "caution";
  const receipt = change.receipt || {};
  const metric = receipt.metric || {};
  const changedWhen = formatPlanWatchRelativeTimestamp(watch?.changeDetectedAt || receipt.checkedAt);
  const baselineWhen = formatPlanWatchRelativeTimestamp(receipt.baselineAt || watch?.baselineAt);
  const checkedWhen = formatPlanWatchRelativeTimestamp(receipt.checkedAt || watch?.checkedAt);
  const freshness = [
    baselineWhen ? `Compared with ${baselineWhen}` : "Compared with the saved forecast",
    checkedWhen ? `checked ${checkedWhen}` : "",
    watch?.source?.stale ? "forecast refresh needed" : ""
  ].filter(Boolean).join(" · ");
  const announceSignature = !reviewed ? String(watch?.storedReceipt?.signature || "") : "";
  const shouldAnnounce = Boolean(
    announceSignature &&
    !planWatchState.announcedReceiptSignatures.has(announceSignature)
  );
  if (shouldAnnounce) planWatchState.announcedReceiptSignatures.add(announceSignature);
  const announcement = `${change.title || "Forecast changed"}. ${planWatchChangeEvidence(change) || change.body || ""}`.trim();
  return `
    <section class="focused-plan-change is-${escapeHtml(tone)}${reviewed ? " is-reviewed" : ""}">
      ${shouldAnnounce ? `<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(announcement)}</span>` : ""}
      <div class="focused-plan-change-head">
        <span>${reviewed ? "Last meaningful change" : "Forecast changed"}</span>
        ${changedWhen ? `<time datetime="${escapeHtml(new Date(watch?.changeDetectedAt || receipt.checkedAt).toISOString())}">${escapeHtml(changedWhen)}</time>` : ""}
      </div>
      <h4>${escapeHtml(change.title || "Plan changed")}</h4>
      ${metric.before && metric.after ? `
        <div class="focused-plan-compare" aria-label="${escapeHtml(`${metric.label || "Forecast"}: before ${metric.before}, now ${metric.after}`)}">
          <div><span>Before</span><b>${escapeHtml(metric.before)}</b></div>
          <i aria-hidden="true">→</i>
          <div><span>Now</span><b>${escapeHtml(metric.after)}</b></div>
        </div>
      ` : `<p>${escapeHtml(change.body)}</p>`}
      <p class="focused-plan-impact"><span>Why it matters</span>${escapeHtml(receipt.why || change.body)}</p>
      <small>${escapeHtml(freshness)}${reviewed ? " · reviewed" : ""}</small>
    </section>
  `;
}

function renderFocusedPlanReceipt(watch) {
  const lines = Array.isArray(watch?.receiptLines)
    ? watch.receiptLines
    : typeof planWeatherReceiptLines === "function" ? planWeatherReceiptLines(watch) : [];
  const filtered = lines.filter((line) => !(
    (watch?.change || watch?.reviewedChange) && String(line?.label || "").toLowerCase() === "changed"
  ));
  if (!filtered.length) return "";
  return `
    <section class="focused-plan-receipt">
      <span>Plan window now</span>
      <dl>
        ${filtered.map((line) => `
          <div class="is-${escapeHtml(line.kind || "neutral")}">
            <dt>${escapeHtml(line.label)}</dt>
            <dd>${escapeHtml(line.value)}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function renderFocusedPlanWatchHero(item, watch) {
  const memory = item.memory;
  const id = escapeHtml(memory.id);
  const tone = watch?.tone || "pending";
  const label = watch?.label || "Waiting on forecast";
  const reason = watch?.primaryReason ||
    watch?.reasons?.[0] ||
    watch?.fullReason ||
    watch?.reason ||
    "Nearcast is checking this plan against the forecast.";
  const effectivePast = Boolean(item.isPast || watch?.isPast);
  const receiptChange = watch?.change || watch?.reviewedChange;
  const advice = effectivePast
    ? ""
    : String(receiptChange?.receipt?.action || watch?.action || (!watch?.change ? watch?.advice : "") || "").trim();
  return `
    <section class="focused-plan-hero is-${escapeHtml(tone)}">
      <span class="focused-plan-kicker">${effectivePast ? "Saved plan" : "Watched plan"}</span>
      <h3>${escapeHtml(planMemoryTitle(memory))}</h3>
      <strong class="focused-plan-outcome">${escapeHtml(label)}</strong>
      ${renderFocusedPlanChangeBlock(watch)}
      ${receiptChange ? "" : `<p class="focused-plan-reason">${escapeHtml(reason)}</p>`}
      ${advice ? `<p class="focused-plan-advice"><span>What to do</span>${escapeHtml(advice)}</p>` : ""}
      <small>${escapeHtml(planWatchMetaText(memory, watch))}</small>
      ${renderPlanWatchSignals(watch)}
      <div class="focused-plan-actions">
        ${effectivePast ? "" : `<button class="is-primary" type="button" data-memory-hourly="${id}">Hourly detail</button>`}
        ${renderFocusedPlanNotifyAction(watch, effectivePast)}
        <button type="button" data-memory-edit="${id}">Change plan</button>
      </div>
      ${renderFocusedPlanNotifyLimit(watch, effectivePast)}
      <button class="focused-plan-forget" type="button" data-memory-forget="${id}">Forget this plan</button>
    </section>
  `;
}

function renderPastPlanDisclosure(past, watchById) {
  if (!past.length) return "";
  return `
    <details class="past-plan-disclosure">
      <summary>
        <span>Past plans</span>
        <small>${past.length} kept locally</small>
      </summary>
      <div class="memory-list global-memory-list">
        ${renderGlobalMemoryCards(past, watchById)}
      </div>
    </details>
  `;
}

function renderFocusedPlanWatchSheet({ focusedItem, focusedWatch, upcoming, past, watchById }) {
  const otherUpcoming = upcoming.filter((item) => item.memory.id !== focusedItem.memory.id);
  return `
    ${renderFocusedPlanWatchHero(focusedItem, focusedWatch)}
    ${renderGlobalMemoryGroup("Other watched plans", otherUpcoming, {
      sub: otherUpcoming.length === 1 ? "1 upcoming" : `${otherUpcoming.length} upcoming`,
      watchById
    })}
    ${renderPastPlanDisclosure(past, watchById)}
    <button class="memory-new-btn" type="button" data-memory-new>Add a plan</button>
  `;
}

function renderGlobalMemorySheet() {
  if (!els.memorySheetBody || !els.memorySheetSummary) return;
  const items = planMemoryListItems(state.forecast, state.activePlace, { includePast: true });
  const upcoming = items.filter((item) => !item.isPast);
  const past = items.filter((item) => item.isPast).sort((a, b) =>
    b.memory.targetDate.localeCompare(a.memory.targetDate) ||
    b.memory.startHour - a.memory.startHour ||
    b.memory.updatedAt - a.memory.updatedAt
  );
  const here = upcoming.filter((item) => item.isHere);
  const elsewhere = upcoming.filter((item) => !item.isHere);
  const otherGroups = groupPlanMemoryItemsByPlace(elsewhere);
  const allWatchItems = items.map(planWatchItemForMemoryItem);
  const watchItems = allWatchItems.filter((watch) => !watch.isPast);
  const watchById = new Map(allWatchItems.map((watch) => [watch.memory.id, watch]));
  const focusedItem = planWatchFocusMemoryId
    ? items.find((item) => item.memory.id === planWatchFocusMemoryId)
    : null;

  if (focusedItem) {
    const focusedWatch = watchById.get(focusedItem.memory.id) || planWatchItemForMemoryItem(focusedItem);
    planWatchVisibleReceiptSignature = focusedWatch?.change
      ? String(focusedWatch?.storedReceipt?.signature || "")
      : "";
    setGlobalMemorySheetFocusedMode(true);
    els.memorySheetSummary.innerHTML = "";
    els.memorySheetBody.innerHTML = renderFocusedPlanWatchSheet({
      focusedItem,
      focusedWatch,
      upcoming,
      past,
      watchById
    });
    return;
  }

  planWatchFocusMemoryId = "";
  planWatchVisibleReceiptSignature = "";
  setGlobalMemorySheetFocusedMode(false);
  els.memorySheetSummary.innerHTML = renderPlanWatchOverview(watchItems);

  if (!state.planMemories.length) {
    els.memorySheetBody.innerHTML = `
      ${renderPlanWatchNotificationManagementSurface(watchItems)}
      ${renderPlanWatchRecentUpdates()}
      <section class="memory-empty-state">
        <strong>Nothing being watched yet</strong>
        <p>Use Plan Check for a real plan, then watch it when the forecast matters.</p>
        <button type="button" data-memory-new>Create a plan</button>
      </section>
    `;
    return;
  }

  els.memorySheetBody.innerHTML =
    renderPlanWatchNotificationManagementSurface(watchItems) +
    renderPlanWatchRecentUpdates() +
    renderGlobalMemoryGroup("This place", here, {
      sub: state.activePlace ? placeLabel(state.activePlace) : "",
      watchById
    }) +
    otherGroups.map((group) =>
      renderGlobalMemoryGroup(group.label, group.items, { sub: `${group.items.length} upcoming`, watchById })
    ).join("") +
    renderGlobalMemoryGroup("Past plans", past, { sub: "kept locally until you forget them", watchById }) +
    `<button class="memory-new-btn" type="button" data-memory-new>Add a plan</button>`;
}

function scrollFocusedPlanWatchCard() {
  if (!planWatchFocusMemoryId || !els.memorySheetBody) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const card = [...els.memorySheetBody.querySelectorAll("[data-memory-card]")]
        .find((item) => item.dataset.memoryCard === planWatchFocusMemoryId);
      if (!card?.scrollIntoView) return;
      try {
        card.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        card.scrollIntoView();
      }
    });
  });
}

function planWatchFetchPlaces(items) {
  const seen = new Set();
  return items
    .filter((item) => !item.isPast && !item.isHere)
    .map(({ memory }) => {
      const place = normalizePlace(memory.place);
      const key = planWatchPlaceKey(place);
      if (seen.has(key)) return null;
      seen.add(key);
      return { key, place };
    })
    .filter(Boolean)
    .slice(0, PLAN_WATCH_MAX_AUTO_FETCH_PLACES);
}

function savePlanWatchContinuitySnapshot(data, place, options = {}) {
  if (!data || !place || typeof saveContinuitySnapshot !== "function") return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const truth = typeof weatherTruth === "function" ? weatherTruth(data) : null;
  saveContinuitySnapshot(data, place, tempUnit, windUnit, truth, options);
  refreshPlanWatchBaselineStore();
}

function refreshPlanWatchForecasts(items = planMemoryListItems(state.forecast, state.activePlace, { includePast: false })) {
  if (!items?.length || typeof fetchForecast !== "function") return;
  if (!planWatchState.baselineStore) {
    refreshPlanWatchBaselineStore();
  }

  planWatchFetchPlaces(items).forEach(({ key, place }) => {
    const now = Date.now();
    if (planWatchState.loading[key]) return;
    if (now - Number(planWatchState.lastFetchAt[key] || 0) < PLAN_WATCH_REFRESH_THROTTLE_MS) return;
    const cached = typeof readForecastCache === "function"
      ? readForecastCache(place, { maxAge: PLAN_WATCH_FORECAST_MAX_AGE_MS })
      : null;
    if (cached?.data) planWatchState.data[key] = cached.data;

    planWatchState.loading[key] = true;
    planWatchState.alertsReady[key] = false;
    planWatchState.lastFetchAt[key] = now;
    delete planWatchState.errors[key];
    refreshOpenGlobalMemorySheet();

    Promise.all([
      fetchForecast(place),
      safeFetchPlanAlerts(place)
        .then((alerts) => ({ alerts: alerts || [], ready: true }))
        .catch(() => ({ alerts: [], ready: false }))
    ]).then(([data, alertResult]) => {
      planWatchState.data[key] = data;
      planWatchState.alerts[key] = alertResult.alerts;
      planWatchState.alertsReady[key] = alertResult.ready;
      delete planWatchState.errors[key];
      if (typeof refreshPlanAwareLaunchSurfaces === "function") refreshPlanAwareLaunchSurfaces();
      maybeSyncPlanWatchNotifications();
      syncPlanWatchNotificationSubscription({ reason: "watch-forecast-refreshed" });
      savePlanWatchContinuitySnapshot(data, place, {
        alertsReady: alertResult.ready,
        alerts: alertResult.alerts
      });
    }).catch((err) => {
      planWatchState.errors[key] = cleanError(err) || "Forecast refresh failed.";
      planWatchState.alertsReady[key] = false;
    }).finally(() => {
      delete planWatchState.loading[key];
      refreshOpenGlobalMemorySheet();
      refreshOpenMemoryDetail();
    });
  });
}

function openGlobalMemorySheet(options = {}) {
  if (!els.memorySheet || !els.memoryBackdrop) return;
  if (typeof recordForYouSignal === "function") recordForYouSignal("watching-open");
  const focusMemoryId = String(options.focusMemoryId || "").trim();
  if (focusMemoryId && state.planMemories.some((memory) => memory.id === focusMemoryId)) {
    if (planWatchFocusMemoryId && planWatchFocusMemoryId !== focusMemoryId) {
      markPlanWatchFocusedChangeReviewed(planWatchFocusMemoryId, planWatchVisibleReceiptSignature);
    }
    planWatchFocusMemoryId = focusMemoryId;
  } else if (!focusMemoryId) {
    planWatchFocusMemoryId = "";
  }
  refreshPlanWatchBaselineStore();
  renderGlobalMemorySheet();
  els.memoryBackdrop.hidden = false;
  els.memorySheet.hidden = false;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  showSheet(els.memoryBackdrop, els.memorySheet, {
    onPullDismiss: closeGlobalMemorySheet,
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
  scrollFocusedPlanWatchCard();
  refreshPlanWatchForecasts();
}

function refreshOpenGlobalMemorySheet() {
  if (!els.memorySheet || els.memorySheet.hidden) return;
  renderGlobalMemorySheet();
}

function refreshPlanMemorySurfaces() {
  renderBriefing();
  renderPlanPulse();
  if (typeof refreshPlanAwareLaunchSurfaces === "function") {
    refreshPlanAwareLaunchSurfaces();
  }
  renderForecastMemorySurfaces();
  refreshOpenGlobalMemorySheet();
  if (els.memoryDetailSheet && !els.memoryDetailSheet.hidden) {
    refreshOpenMemoryDetail();
  }
  if (typeof refreshOpenDayDetailMemorySurfaces === "function") {
    refreshOpenDayDetailMemorySurfaces();
  }
}

function closeGlobalMemorySheet() {
  if (!els.memorySheet || !els.memoryBackdrop || els.memorySheet.hidden) return;
  if (planWatchFocusMemoryId) {
    markPlanWatchFocusedChangeReviewed(planWatchFocusMemoryId, planWatchVisibleReceiptSignature);
  }
  planWatchFocusMemoryId = "";
  planWatchVisibleReceiptSignature = "";
  els.memoryBackdrop.classList.remove("show");
  els.memorySheet.classList.remove("show");
  const keepLocked =
    !document.getElementById("dayDetail")?.hidden ||
    !els.memoryDetailSheet?.hidden ||
    !els.aiSheet?.hidden ||
    !document.getElementById("alertSheet")?.hidden ||
    !els.placeSheet?.hidden ||
    mapState.immersive;
  document.body.style.overflow = keepLocked ? "hidden" : "";
  setTimeout(() => {
    els.memoryBackdrop.hidden = true;
    els.memorySheet.hidden = true;
    if (typeof updateSheetNowJump === "function") updateSheetNowJump();
  }, 260);
}

function renderForecastMemorySurfaces() {
  if (!state.forecast) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  renderHourly(state.forecast, tempUnit, state.weatherTruth || weatherTruth(state.forecast));
  renderDaily(state.forecast, tempUnit, precipUnit);
}

function normalizePlanTimeClarification(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(?:at|around|about|from|between|morning|afternoon|evening|tonight|night|overnight)\b/i.test(text)) return text;
  if (/^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(text)) return `at ${text}`;
  return text;
}

function samePlanPlace(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  const distance = distanceKm(a, b);
  if (distance < 1) return true;
  if (distance >= 25) return false;
  const nameA = normalizeQualifierKey(a.name);
  const nameB = normalizeQualifierKey(b.name);
  if (!nameA || nameA !== nameB) return false;
  const countryA = placeCountryCode(a);
  const countryB = placeCountryCode(b);
  if (countryA && countryB && countryA !== countryB) return false;
  const adminA = normalizeQualifierKey(a.admin1 || "");
  const adminB = normalizeQualifierKey(b.admin1 || "");
  if (adminA && adminB && adminA !== adminB) return false;
  return true;
}

function resolvePlanDayIndex(plan, data, c) {
  if (plan.targetDate) {
    const idx = data?.daily?.time?.indexOf(plan.targetDate);
    return idx >= 0 ? idx : null;
  }
  const idx = plan.dayIdx;
  return idx >= 0 && idx < c.daily.length ? idx : null;
}

function buildDayClarification(plan, c = buildAIContext()) {
  const label = planDisplayName(plan).toLowerCase();
  const days = (c?.daily || []).slice(0, 10).map((day, index) => ({
    label: planDayClarificationLabel(day, index),
    dayIdx: index
  }));
  return {
    type: "day",
    plan,
    prompt: `Which day should I use for ${label}?`,
    options: days
  };
}

function planDayClarificationLabel(day, index) {
  const iso = day?.date || "";
  if (!iso) return day?.label || (index === 0 ? "Today" : index === 1 ? "Tomorrow" : `Day ${index + 1}`);
  const date = new Date(`${iso}T12:00:00`);
  const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  if (index === 0) return `Today, ${dateLabel}`;
  if (index === 1) return `Tomorrow, ${dateLabel}`;
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return `${weekday}, ${dateLabel}`;
}

function buildTimeClarification(plan, options = {}) {
  const label = planDisplayName(plan);
  const optionMeta = options.replaceTime ? { replaceTime: true } : {};
  return {
    type: "time",
    plan,
    replaceTime: Boolean(options.replaceTime),
    prompt: `What time should I use for ${label.toLowerCase()}?`,
    options: [
      { label: "Morning", timeText: "morning", ...optionMeta },
      { label: "Afternoon", timeText: "afternoon", ...optionMeta },
      { label: "Evening", timeText: "evening", ...optionMeta }
    ]
  };
}

function buildPlanConfirmation(plan, result, context = {}) {
  const event = result?.event;
  const data = context.data || event?.data || state.forecast;
  const place = normalizePlace(context.place || event?.place || state.activePlace || {});
  const dayIdx = Number.isInteger(context.dayIdx) ? context.dayIdx : event?.dayIndex;
  const window = context.window || event || {};
  return {
    type: "confirm",
    plan,
    result,
    prompt: "I read your plan this way. Does it look right?",
    facts: {
      plan: planDisplayName(plan),
      day: planConfirmationDayLabel(data, dayIdx),
      time: planConfirmationTimeLabel(window),
      place: placeLabel(place)
    },
    notes: planConfirmationNotes(plan, place),
    options: [
      { label: "Looks right", confirmPlan: true },
      { label: "Edit details", editPlan: true }
    ]
  };
}

function buildPlanConfirmationAdjustment(pending, field) {
  const plan = pending?.plan;
  if (!plan) return null;
  if (field === "day") {
    const event = pending.result?.event;
    const c = event ? buildAIContext(event.data, event.place, event.alerts || []) : buildAIContext();
    return buildDayClarification(plan, c);
  }
  if (field === "time") return buildTimeClarification(plan, { replaceTime: true });
  if (field === "location") {
    const options = [];
    const seen = new Set();
    const pushPlace = (place, prefix) => {
      if (!place) return;
      const normalized = normalizePlace(place);
      const key = `${Number(normalized.latitude).toFixed(3)}:${Number(normalized.longitude).toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ label: `${prefix} ${placeLabel(normalized)}`, place: normalized });
    };
    pushPlace(state.activePlace, "Use");
    pushPlace(pending.result?.event?.place, "Keep");
    return {
      type: "location",
      plan,
      replaceLocation: true,
      prompt: `Which place should I use for ${planDisplayName(plan).toLowerCase()}? You can also type city + state.`,
      options
    };
  }
  return null;
}

function planConfirmationDayLabel(data, dayIdx) {
  const idx = Number.isInteger(dayIdx) ? dayIdx : 0;
  const iso = data?.daily?.time?.[idx];
  if (!iso) return "Selected day";
  return formatDay(iso, idx);
}

function planConfirmationTimeLabel(window) {
  if (Number.isFinite(window?.startHour) && Number.isFinite(window?.endHour)) {
    return `${hourText(window.startHour)}-${hourText(window.endHour)}`;
  }
  return "Selected time";
}

function planConfirmationNotes(plan, place) {
  const notes = [];
  if (plan.timing?.assumption) notes.push(plan.timing.assumption.replace(/\.$/, ""));
  if (plan.dayCorrection) notes.push(`read "${plan.dayCorrection.from}" as ${plan.dayCorrection.to}`);
  if (plan.locationImplicit) notes.push(`read ${placeLabel(place)} as the place`);
  if (plan.intent?.source === "repair") notes.push("filled in loose wording");
  if (plan.intent?.source === "local-ai") notes.push("read details from your wording");
  return notes;
}

async function resolvePlanPlace(plan) {
  if (!plan.locationQuery) {
    return { place: state.activePlace, data: state.forecast, alerts: activeAlerts };
  }
  const options = await fetchPlannerPlaceOptions(plan.locationQuery);
  return resolvePlanPlaceOptions(plan, options);
}

function resolvePlanPlaceOptions(plan, options) {
  if (!options.matches.length) {
    return {
      clarification: {
        type: "location",
        plan,
        prompt: `I could not find "${plan.locationQuery}". Try city + state or country.`,
        options: state.activePlace ? [{ label: `Use ${placeLabel(state.activePlace)}`, place: state.activePlace }] : []
      }
    };
  }
  if (shouldClarifyPlanPlace(options)) {
    return {
      clarification: {
        type: "location",
        plan,
        prompt: `Which ${plan.locationQuery} should I use?`,
        options: options.matches.slice(0, 4).map(({ place }) => ({
          label: placeLabel(normalizePlace(place)),
          place: normalizePlace(place)
        }))
      }
    };
  }
  return { place: normalizePlace(options.matches[0].place) };
}

async function fetchPlannerPlaceOptions(query) {
  const parsed = parseLocationQuery(query);
  const seen = new Set();
  const results = [];
  for (const attempt of buildPlaceSearchAttempts(parsed)) {
    const places = await fetchPlaceResults(attempt.name, 8, attempt);
    places.forEach((place) => {
      const normalized = normalizePlace(place);
      const key = `${normalized.latitude.toFixed(3)}:${normalized.longitude.toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(place);
    });
  }
  const matches = results
    .map((place, index) => ({ place, index, score: plannerPlaceScore(place, parsed) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return { parsed, matches };
}

function plannerPlaceScore(place, parsed) {
  let score = placeScore(place, parsed);
  const active = state.activePlace;
  if (!active) return score;
  const admin = normalizeQualifierKey(place.admin1 || "");
  const activeAdmin = normalizeQualifierKey(active.admin1 || "");
  const country = placeCountryCode(place);
  const activeCountry = placeCountryCode(active);
  if (country && activeCountry && country === activeCountry) score += 8;
  if (admin && activeAdmin && admin === activeAdmin) score += 22;
  const distance = distanceKm(active, place);
  if (Number.isFinite(distance)) {
    if (distance < 80) score += 42;
    else if (distance < 250) score += 28;
    else if (distance < 600) score += 12;
  }
  return score;
}

function shouldClarifyPlanPlace({ parsed, matches }) {
  if (parsed.countryCode || parsed.stateName || matches.length < 2) return false;
  const [top, second] = matches;
  const topDistance = state.activePlace ? distanceKm(state.activePlace, top.place) : Infinity;
  if (Number.isFinite(topDistance) && topDistance < 250 && top.score >= second.score + 8) return false;
  const primary = normalizeQualifierKey(parsed.primary);
  const sameNameCount = matches.slice(0, 4)
    .filter(({ place }) => normalizeQualifierKey(place.name) === primary).length;
  return sameNameCount > 1 && top.score < second.score + 24;
}

function distanceKm(a, b) {
  const lat1 = Number(a?.latitude);
  const lon1 = Number(a?.longitude);
  const lat2 = Number(b?.latitude);
  const lon2 = Number(b?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function safeFetchPlanAlerts(place) {
  try {
    return await fetchAlerts(place);
  } catch {
    return [];
  }
}

function planWindowStats(data, c, w) {
  const hours = planWindowHours(data, w);
  const day = c.daily[w.dayIdx] || c.daily[0];
  const idxs = hours.map(({ index }) => index);
  if (!idxs.length) return null;
  const values = (key, fallback) => idxs.map((i) => data.hourly[key][i] ?? fallback);
  const temps = idxs.map((i) => data.hourly.temperature_2m[i]);
  const feels = idxs.map((i) => data.hourly.apparent_temperature[i]);
  const pop = values("precipitation_probability", 0);
  const precip = values("precipitation", 0);
  const wind = values("wind_speed_10m", c.now.wind);
  const gust = values("wind_gusts_10m", c.now.gust);
  const uv = values("uv_index", 0);
  const codes = idxs.map((i) => data.hourly.weather_code[i]);
  const air = airStatsForHours(data, hours, c.air);

  return {
    window: w,
    label: askWindowLabel(c, w),
    day,
    tempAvg: Math.round(avg(temps)),
    tempMin: Math.round(Math.min(...temps)),
    tempMax: Math.round(Math.max(...temps)),
    feelsAvg: Math.round(avg(feels)),
    feelsMin: Math.round(Math.min(...feels)),
    feelsMax: Math.round(Math.max(...feels)),
    rainChance: Math.round(Math.max(...pop)),
    rainChanceMin: Math.round(Math.min(...pop)),
    precipTotal: precip.reduce((sum, item) => sum + Number(item || 0), 0),
    windMin: Math.round(Math.min(...wind)),
    windMax: Math.round(Math.max(...wind)),
    gustMax: Math.round(Math.max(...gust)),
    uvMin: Math.round(Math.min(...uv)),
    uvMax: Math.round(Math.max(...uv)),
    aqiMax: air.aqiMax,
    aqiLabel: air.aqiLabel,
    pollenRank: air.pollenRank,
    pollenLabel: air.pollenLabel,
    pollenLevel: air.pollenLevel,
    sky: weatherCodes[mostCommon(codes)] || day.sky || "Weather",
    stormPotential: codes.some((code) => [95, 96, 99].includes(Number(code)))
  };
}

function planWindowHours(data, w) {
  const day = data?.daily?.time?.[w.dayIdx];
  if (!data?.hourly?.time || !day) return [];
  const startHour = w.startHour ?? 0;
  const endHour = w.endHour ?? 24;
  return data.hourly.time
    .map((time, index) => ({ time, index, hour: forecastLocalHour(time) }))
    .filter(({ time, hour }) => time.startsWith(day) && hour >= startHour && hour < endHour);
}

function planBoundaryMs(data, hour, offsetDays = 0) {
  const dayShift = Math.floor(hour / 24);
  const local = ((hour % 24) + 24) % 24;
  const wholeHour = Math.floor(local);
  const minute = Math.round((local - wholeHour) * 60);
  const day = forecastLocalDate(data, offsetDays + dayShift);
  if (!day) return null;
  return parseForecastTimestamp(
    `${day}T${String(wholeHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    data
  );
}

function topAlertForPlanRange(alerts, startMs, endMs) {
  return (alerts || [])
    .filter((alert) => alertOverlapsRange(alert, startMs, endMs))
    .sort((a, b) => alertPriority(b) - alertPriority(a))[0] || null;
}

function planAnswer(plan, place, c, stats, alert) {
  const rule = ACTIVITY_RULES[plan.activityKey] || ACTIVITY_RULES.walk;
  const score = numericWindowScore(rule, stats);
  const tone = alert ? alertTone(alert) : "";
  const verdict = planVerdict(score, tone);
  const activity = planDisplayName(plan);
  const displayLabel = planWindowDisplayLabel(plan, stats);
  const location = plan.locationExplicit ? ` in ${placeLabel(place)}` : "";
  const why = planWhy(plan, place, stats, c.units, alert);
  const advice = planAdvice(stats, alert, score);
  return `${activity} ${displayLabel}${location}: ${verdict}. Why: ${why}. ${advice}`.replace(/\s+/g, " ").trim();
}

function planWindowDisplayLabel(plan, stats) {
  const day = String(plan?.dayDisplay || "").trim();
  const w = stats?.window || {};
  if (!day) return stats?.label || "plan window";
  if (w.period) return `${day} ${ASK_PERIODS[w.period]?.label || w.period}`;
  if (Number.isFinite(w.startHour) && Number.isFinite(w.endHour)) {
    return `${day} from ${hourText(w.startHour)} to ${hourText(w.endHour)}`;
  }
  return stats?.label || "plan window";
}

function planDisplayName(plan) {
  const s = askText(plan.original);
  if (hasAny(s, [" ballgame ", " ball game ", " baseball ", " softball "])) return "Ballgame";
  if (plan.activityKey === "golf") return "Golf";
  if (plan.activityKey === "sports") return "Game/practice";
  if (plan.activityKey === "event") return "Event";
  const label = ACTIVITY_RULES[plan.activityKey]?.label || "Plan";
  return capitalize(label.replace(/^a\s+/, "").replace(/^the\s+/, ""));
}

function planReasons(stats, units, alert) {
  const reasons = [];
  if (alert) reasons.push(`${alert.event} overlaps that window`);
  if (stats.stormPotential) reasons.push("thunderstorms are possible");
  if (stats.rainChance >= 60) reasons.push(`${stats.rainChance}% rain chance`);
  else if (stats.rainChance >= 35) reasons.push(`${stats.rainChance}% rain chance`);
  else reasons.push(`rain looks low (${stats.rainChance}%)`);
  if (stats.gustMax >= stats.windMax + 8 && stats.gustMax >= 22) reasons.push(`gusts near ${stats.gustMax} ${units.wind}`);
  else reasons.push(`wind near ${stats.windMax} ${units.wind}`);
  if (stats.aqiMax !== null && stats.aqiMax !== undefined) {
    if (stats.aqiMax >= 101) reasons.push(`AQI ${stats.aqiMax} (${stats.aqiLabel.toLowerCase()})`);
    else if (stats.aqiMax >= 51) reasons.push(`moderate air (AQI ${stats.aqiMax})`);
  }
  if (stats.pollenRank >= 3) reasons.push(`${stats.pollenLabel} pollen ${stats.pollenLevel}`);
  if (stats.uvMax >= 8) reasons.push(`UV up to ${stats.uvMax}`);
  if (stats.feelsAvg >= 88 || stats.feelsAvg <= 40) reasons.push(`feels around ${stats.feelsAvg}${units.temp}`);
  else reasons.push(`${stats.tempMin}${units.temp}-${stats.tempMax}${units.temp}`);
  return reasons;
}

function planWhy(plan, place, stats, units, alert) {
  const reasons = planReasons(stats, units, alert).slice(0, 4);
  if (plan.timing?.assumption) reasons.push(plan.timing.assumption.replace(/\.$/, ""));
  if (plan.dayCorrection) reasons.push(`read "${plan.dayCorrection.from}" as ${plan.dayCorrection.to}`);
  if (plan.locationImplicit) reasons.push(`read ${placeLabel(place)} as the place`);
  if (plan.intent?.source === "local-ai") reasons.push("read the plan details from your wording");
  return reasons.join(", ");
}

function formatHourFloat(hour) {
  if (!prefersTwentyFourHourClock()) {
    if (hour === 12) return "noon";
    if (hour === 24) return "midnight";
  }
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return formatClock(h, m, false, m !== 0);
}

function formatHourRangeText(startHour, endHour) {
  return `${formatHourFloat(startHour)}-${formatHourFloat(endHour)}`;
}

function askText(q) {
  return ` ${String(q || "").toLowerCase().replace(/[^\w\s:]/g, " ").replace(/\s+/g, " ")} `;
}

function hasAny(s, words) {
  return words.some((w) => s.includes(w));
}

function hourText(hour) {
  return formatClock(hour, 0, true, false);
}

function parseAskHour(value, ampm) {
  let hour = Number(value);
  if (!Number.isFinite(hour)) return null;
  if (ampm) {
    const meridiem = ampm.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  return Math.min(Math.max(hour, 0), 24);
}

function askDayLabel(c, dayIdx) {
  if (dayIdx === 0) return "today";
  if (dayIdx === 1) return "tomorrow";
  return c.daily[dayIdx]?.label || "that day";
}

function askWindowLabel(c, w) {
  if (w.label === "right now" || w.label === "rest of today") return w.label;
  const day = askDayLabel(c, w.dayIdx);
  if (w.period && w.dayIdx === 0) {
    if (w.period === "night") return "tonight";
    if (w.period === "overnight") return "overnight";
    return `this ${ASK_PERIODS[w.period]?.label || w.period}`;
  }
  if (w.period) return `${day} ${ASK_PERIODS[w.period]?.label || w.period}`;
  return `${day} from ${hourText(w.startHour)} to ${hourText(w.endHour)}`;
}

function currentAskWindow() {
  const hour = forecastCurrentHour();
  return {
    dayIdx: 0,
    startHour: hour,
    endHour: Math.min(hour + 3, 24),
    label: "right now"
  };
}

function resolveAskWindow(q, c) {
  const s = plannerParseText(q);
  let dayIdx = resolveDayIndex(s, c);
  if (dayIdx == null) dayIdx = 0;

  const between = s.match(/\b(?:from|between)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\s+(?:and|to|-)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/);
  if (between) {
    let start = parseAskHour(between[1], between[2] || between[4]);
    let end = parseAskHour(between[3], between[4] || between[2]);
    if (start != null && end != null && end <= start) end += 12;
    return { dayIdx, startHour: start, endHour: Math.min(end, 24), label: "custom" };
  }

  const after = s.match(/\bafter\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/);
  if (after) {
    const start = parseAskHour(after[1], after[2] || "pm");
    return { dayIdx, startHour: start, endHour: Math.min(start + 5, 24), label: "custom" };
  }

  const before = s.match(/\bbefore\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/);
  if (before) {
    const end = parseAskHour(before[1], before[2] || "pm");
    return { dayIdx, startHour: Math.max(end - 5, 0), endHour: end, label: "custom" };
  }

  let period = null;
  if (/\bovernight\b/.test(s)) period = "overnight";
  else if (/\btonight\b|\bnight\b/.test(s)) period = "night";
  else if (/\bmorning\b|\bbefore noon\b/.test(s)) period = "morning";
  else if (/\bafternoon\b|\bmidday\b/.test(s)) period = "afternoon";
  else if (/\bevening\b|\bafter work\b/.test(s)) period = "evening";
  else if (/\ball day\b|\bdaytime\b/.test(s)) period = "day";

  if (/\bright now\b|\bnow\b|\bcurrently\b/.test(s)) return currentAskWindow();
  if (/\blater\b|\brest of today\b/.test(s)) {
    return { dayIdx: 0, startHour: forecastCurrentHour(), endHour: 24, label: "rest of today" };
  }
  if (hasAny(s, ["dinner", "supper", "grill", "grilling", "bbq", "barbecue", "eat outside"])) {
    return { dayIdx, startHour: 17, endHour: 21, label: "custom" };
  }
  if (hasAny(s, ["after work", "after 5", "after five"])) {
    return { dayIdx, startHour: 17, endHour: 22, label: "custom" };
  }
  if (period) return { dayIdx, startHour: ASK_PERIODS[period].start, endHour: ASK_PERIODS[period].end, period };
  return { dayIdx, startHour: dayIdx === 0 ? forecastCurrentHour() : 8, endHour: 20, period: "day" };
}

function askWindowHours(w) {
  const data = state.forecast;
  if (!data || !w) return [];
  const day = data.daily.time[w.dayIdx];
  if (!day) return [];
  const now = forecastNowMs(data);
  const startHour = w.startHour ?? 0;
  const endHour = w.endHour ?? 24;
  return data.hourly.time
    .map((time, index) => ({ time, index, ms: parseForecastTimestamp(time, data), hour: forecastLocalHour(time) }))
    .filter(({ time, ms, hour }) => {
      if (!time.startsWith(day)) return false;
      if (w.dayIdx === 0 && ms !== null && ms < now - 60 * 60 * 1000) return false;
      return hour >= startHour && hour < endHour;
    });
}

function avg(values) {
  return values.reduce((sum, item) => sum + Number(item || 0), 0) / Math.max(values.length, 1);
}

function mostCommon(values) {
  const counts = {};
  values.forEach((value) => { counts[value] = (counts[value] || 0) + 1; });
  return values.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
}

function askWindowStats(w) {
  const data = state.forecast;
  const c = buildAIContext();
  if (!data || !c) return null;
  const hours = askWindowHours(w);
  const day = c.daily[w.dayIdx] || c.daily[0];
  const idxs = hours.map(({ index }) => index);
  const values = (key, fallback) => idxs.length ? idxs.map((i) => data.hourly[key][i] ?? fallback) : [fallback];
  const temps = idxs.length ? idxs.map((i) => data.hourly.temperature_2m[i]) : [day.hi, day.lo];
  const feels = idxs.length ? idxs.map((i) => data.hourly.apparent_temperature[i]) : temps;
  const pop = idxs.length ? values("precipitation_probability", 0) : [day.rainChance];
  const precip = idxs.length ? values("precipitation", 0) : [0];
  const wind = idxs.length ? values("wind_speed_10m", c.now.wind) : [c.now.wind];
  const gust = idxs.length ? values("wind_gusts_10m", c.now.gust) : [c.now.gust];
  const uv = idxs.length ? values("uv_index", 0) : [w.dayIdx === 0 ? c.today.uvPeak : 0];
  const codes = idxs.length ? idxs.map((i) => data.hourly.weather_code[i]) : [data.daily.weather_code[w.dayIdx] || data.current.weather_code];
  const air = airStatsForHours(data, hours, c.air);

  return {
    window: w,
    label: askWindowLabel(c, w),
    day,
    tempAvg: Math.round(avg(temps)),
    tempMin: Math.round(Math.min(...temps)),
    tempMax: Math.round(Math.max(...temps)),
    feelsAvg: Math.round(avg(feels)),
    feelsMin: Math.round(Math.min(...feels)),
    feelsMax: Math.round(Math.max(...feels)),
    rainChance: Math.round(Math.max(...pop)),
    rainChanceMin: Math.round(Math.min(...pop)),
    precipTotal: precip.reduce((sum, item) => sum + Number(item || 0), 0),
    windMin: Math.round(Math.min(...wind)),
    windMax: Math.round(Math.max(...wind)),
    gustMax: Math.round(Math.max(...gust)),
    uvMin: Math.round(Math.min(...uv)),
    uvMax: Math.round(Math.max(...uv)),
    aqiMax: air.aqiMax,
    aqiLabel: air.aqiLabel,
    pollenRank: air.pollenRank,
    pollenLabel: air.pollenLabel,
    pollenLevel: air.pollenLevel,
    sky: weatherCodes[mostCommon(codes)] || day.sky || "Weather"
  };
}

function tempAsF(value) {
  return state.unit === "celsius" ? Math.round((value * 9) / 5 + 32) : value;
}

function askRainWord(p) {
  if (p < 15) return "unlikely";
  if (p < 35) return "a slight chance";
  if (p < 60) return "possible";
  return "likely";
}

function activityComfort(feelsF, rule) {
  if (feelsF >= rule.hot + 8) return "too hot";
  if (feelsF >= rule.hot) return "hot";
  if (feelsF <= rule.cold - 8) return "too cold";
  if (feelsF <= rule.cold) return "cold";
  return "comfortable";
}

function activityAnswer(rule, stats, units) {
  const result = scoreActivityWindow(rule, stats, units);
  return `${result.verdict} for ${rule.label} ${stats.label}: ${result.reasons.join(", ")}.`;
}

function scoreActivityWindow(rule, stats, units) {
  const feelsF = tempAsF(stats.feelsAvg);
  const reasons = [];
  let score = 3;

  if (stats.rainChance >= rule.rain + 25) {
    score = Math.min(score, 0);
    reasons.push(`${stats.rainChance}% rain chance`);
  } else if (stats.rainChance >= rule.rain) {
    score = Math.min(score, 1);
    reasons.push(`${stats.rainChance}% rain chance`);
  } else {
    reasons.push(`${askRainWord(stats.rainChance)} rain (${stats.rainChance}%)`);
  }

  const comfort = activityComfort(feelsF, rule);
  if (comfort === "too hot" || comfort === "too cold") {
    score = Math.min(score, 0);
    reasons.push(`${comfort} at ${stats.feelsAvg}${units.temp}`);
  } else if (comfort === "hot" || comfort === "cold") {
    score = Math.min(score, 1);
    reasons.push(`${comfort} at ${stats.feelsAvg}${units.temp}`);
  } else {
    reasons.push(`${stats.feelsAvg}${units.temp} and comfortable`);
  }

  if (stats.gustMax >= rule.wind + 12) {
    score = Math.min(score, 1);
    reasons.push(`gusts near ${stats.gustMax} ${units.wind}`);
  } else if (stats.windMax >= rule.wind) {
    score = Math.min(score, 2);
    reasons.push(`wind near ${stats.windMax} ${units.wind}`);
  }

  if (rule.uv < 99 && stats.uvMax >= rule.uv) {
    score = Math.min(score, 2);
    reasons.push(`UV peaks at ${stats.uvMax}`);
  }

  if (stats.aqiMax !== null && stats.aqiMax !== undefined) {
    if (stats.aqiMax >= 151) {
      score = Math.min(score, 0);
      reasons.push(`AQI ${stats.aqiMax} (${stats.aqiLabel.toLowerCase()})`);
    } else if (stats.aqiMax >= 101) {
      score = Math.min(score, 1);
      reasons.push(`AQI ${stats.aqiMax} (${stats.aqiLabel.toLowerCase()})`);
    } else if (stats.aqiMax >= 51) {
      reasons.push(`moderate air (AQI ${stats.aqiMax})`);
    }
  }

  if (stats.pollenRank >= 3) {
    score = Math.min(score, 2);
    reasons.push(`${stats.pollenLabel} pollen ${stats.pollenLevel}`);
  }

  const verdict = score >= 3 ? "Good conditions" : score === 2 ? "Pretty good" : score === 1 ? "Doable, with caveats" : "Not ideal";
  return { score, verdict, reasons };
}

function numericWindowScore(rule, stats) {
  const feelsF = tempAsF(stats.feelsAvg);
  const target = 72;
  const tempPenalty = Math.abs(feelsF - target) * (rule.label === "the pool" ? 0.35 : 0.8);
  const rainPenalty = stats.rainChance * 1.2 + stats.precipTotal * 80;
  const windPenalty = Math.max(0, stats.windMax - rule.wind) * 2 + Math.max(0, stats.gustMax - rule.wind - 8) * 2;
  const uvPenalty = rule.uv < 99 ? Math.max(0, stats.uvMax - rule.uv + 1) * 5 : 0;
  const airPenalty = stats.aqiMax ? Math.max(0, stats.aqiMax - 80) * 0.8 : 0;
  const pollenPenalty = stats.pollenRank >= 3 ? stats.pollenRank * 4 : 0;
  return Math.round(100 - tempPenalty - rainPenalty - windPenalty - uvPenalty - airPenalty - pollenPenalty);
}

function currentHourFloat() {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function windowVerdict(score) {
  if (score >= 80) return "Great";
  if (score >= 65) return "Good";
  if (score >= 45) return "Iffy";
  return "Poor";
}

function windowQuality(score) {
  if (score >= 70) return "show";
  if (score >= 45) return "caution";
  return "fallback";
}

function plannerWindow({ todayStart, todayEnd, tomorrowStart = todayStart, tomorrowEnd = todayEnd, rolloverAt = todayEnd - 0.25 }) {
  const hour = currentHourFloat();
  if (hour >= rolloverAt) {
    return { dayIdx: 1, earliestHour: tomorrowStart, limitHour: tomorrowEnd };
  }
  return { dayIdx: 0, earliestHour: todayStart, limitHour: todayEnd, allowTomorrow: false };
}

function cardWindowText(stats, prefix = "") {
  return prefix ? `${prefix}: ${capitalize(stats.label)}` : capitalize(stats.label);
}

function cardMeta(prefix, reasons) {
  return `${prefix}: ${reasons.slice(0, 2).join(" · ")}`;
}

function bestWindowOptionsFromText(s, c) {
  s = plannerParseText(s);
  const options = {};
  const dayIdx = resolveDayIndex(s, c);
  if (dayIdx != null) options.dayIdx = dayIdx;

  if (hasAny(s, ["dinner", "supper", "grill", "grilling", "bbq", "barbecue", "eat outside"])) {
    options.earliestHour = 17;
    options.limitHour = 21;
    options.allowTomorrow = !hasAny(s, ["tonight", "today"]);
  } else if (hasAny(s, ["after work", "after 5", "after five"])) {
    options.earliestHour = 17;
    options.limitHour = 22;
  } else if (hasAny(s, ["morning"])) {
    options.earliestHour = 6;
    options.limitHour = 12;
  } else if (hasAny(s, ["afternoon", "midday"])) {
    options.earliestHour = 12;
    options.limitHour = 18;
  } else if (hasAny(s, ["evening"])) {
    options.earliestHour = 17;
    options.limitHour = 22;
  } else if (hasAny(s, ["weekend"])) {
    options.earliestHour = 8;
    options.limitHour = 18;
  }

  return options;
}

function candidateAskWindows({ dayIdx = 0, hours = 2, earliestHour = 6, limitHour = 22 } = {}) {
  const start = dayIdx === 0 ? Math.max(forecastCurrentHour(), earliestHour) : earliestHour;
  const windows = [];
  for (let h = start; h + hours <= limitHour; h += 1) {
    windows.push({ dayIdx, startHour: h, endHour: h + hours, label: "custom" });
  }
  return windows;
}

function bestWindowForRule(rule, options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  let candidates = candidateAskWindows(options)
    .map((window) => askWindowStats(window))
    .filter(Boolean)
    .map((stats) => ({ stats, score: numericWindowScore(rule, stats) }))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length && (options.dayIdx || 0) === 0 && options.allowTomorrow !== false) {
    candidates = candidateAskWindows({ ...options, dayIdx: 1 })
      .map((window) => askWindowStats(window))
      .filter(Boolean)
      .map((stats) => ({ stats, score: numericWindowScore(rule, stats) }))
      .sort((a, b) => b.score - a.score);
  }

  if (!candidates.length) return null;
  const best = candidates[0];
  const assessment = scoreActivityWindow(rule, best.stats, c.units);
  return {
    ...best,
    title: `Best for ${rule.label}`,
    answer: `${assessment.verdict} for ${rule.label} ${best.stats.label}: ${assessment.reasons.join(", ")}.`,
    reasons: assessment.reasons
  };
}

function bestDryWindow(options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  const windows = candidateAskWindows(options)
    .map((window) => askWindowStats(window))
    .filter(Boolean)
    .map((stats) => ({
      stats,
      score: 100 - stats.rainChance - stats.precipTotal * 120 - Math.max(0, stats.windMax - 25)
    }))
    .sort((a, b) => b.score - a.score);
  if (!windows.length) return null;
  const best = windows[0];
  return {
    ...best,
    title: "Best dry window",
    answer: `Best dry window ${best.stats.label}: rain is ${askRainWord(best.stats.rainChance)} (${best.stats.rainChance}%), wind up to ${best.stats.windMax} ${c.units.wind}.`,
    reasons: [`${best.stats.rainChance}% rain`, `${best.stats.windMax} ${c.units.wind} wind`, `${best.stats.tempAvg}${c.units.temp}`]
  };
}

function bestWindowAnswer(activityKey, options = {}) {
  return bestWindowResult(activityKey, options)?.answer || null;
}

function bestWindowResult(activityKey, options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  let result;
  let title;
  if (activityKey === "dry") {
    result = bestDryWindow(options);
    title = "Dry window";
  } else {
    const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.walk;
    result = bestWindowForRule(rule, options);
    title = `Best for ${rule.label}`;
  }
  if (!result) {
    if (options.allowTomorrow === false) {
      const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.walk;
      return { answer: `I do not see a useful ${rule.label} window left tonight.` };
    }
    return null;
  }
  return {
    answer: result.answer,
    event: plannerShowEvent({
      title,
      place: state.activePlace,
      data: state.forecast,
      alerts: activeAlerts,
      window: result.stats.window,
      stats: result.stats
    })
  };
}

function buildBestWindowCards() {
  const c = buildAIContext();
  if (!c) return [];

  const dry = bestDryWindow();
  const walkWindow = plannerWindow({ todayStart: 6, todayEnd: 21, tomorrowStart: 7, tomorrowEnd: 11, rolloverAt: 20.75 });
  const dinnerWindow = plannerWindow({ todayStart: 17, todayEnd: 21, tomorrowStart: 17, tomorrowEnd: 21, rolloverAt: 20.5 });
  const afterWorkWindow = plannerWindow({ todayStart: 17, todayEnd: 22, tomorrowStart: 17, tomorrowEnd: 22, rolloverAt: 21.5 });
  const walk = bestWindowForRule(ACTIVITY_RULES.walk, walkWindow);
  const dinner = bestWindowForRule(ACTIVITY_RULES.dinner, dinnerWindow);
  const afterWork = bestWindowForRule(ACTIVITY_RULES.picnic, afterWorkWindow);

  const dryCard = dry && (() => {
    const rain = dry.stats.rainChance;
    if (rain < 25) {
      return {
        ...dry,
        intent: "best-dry",
        badge: "Dry",
        title: "Driest stretch",
        q: "What is the best dry window today?",
        window: cardWindowText(dry.stats),
        meta: cardMeta("Lowest rain chance", dry.reasons)
      };
    }
    if (rain < 60) {
      return {
        ...dry,
        intent: "best-dry",
        badge: "Maybe",
        title: "Least wet stretch",
        q: "What is the least wet window today?",
        window: cardWindowText(dry.stats),
        meta: cardMeta("Not truly dry", dry.reasons)
      };
    }
    return {
      ...dry,
      intent: "best-dry",
      badge: "Wet",
      title: "Rainy day",
      q: "Is there any useful dry window today?",
      window: cardWindowText(dry.stats, "Best odds"),
      meta: cardMeta("No reliable dry stretch", dry.reasons)
    };
  })();

  const walkCard = walk && (() => {
    const quality = windowQuality(walk.score);
    const tomorrow = walk.stats.window.dayIdx > 0;
    return {
      ...walk,
      intent: "best-walk",
      badge: quality === "show" ? windowVerdict(walk.score) : quality === "caution" ? "Iffy" : "Brief",
      title: quality === "show" ? "Comfortable walk" : quality === "caution" ? "Walk check" : "Quick walk only",
      q: tomorrow ? "When is a comfortable time for a walk tomorrow?" : "When is a comfortable time for a walk today?",
      window: cardWindowText(walk.stats),
      meta: cardMeta(quality === "fallback" ? "Keep it short" : "Comfort window", walk.reasons)
    };
  })();

  const dinnerCard = dinner && (() => {
    const quality = windowQuality(dinner.score);
    const tomorrow = dinner.stats.window.dayIdx > 0;
    return {
      ...dinner,
      intent: "best-dinner",
      badge: quality === "show" ? windowVerdict(dinner.score) : quality === "caution" ? "Iffy" : "Indoor",
      title: quality === "show" ? (tomorrow ? "Tomorrow dinner outside" : "Dinner outside")
        : quality === "caution" ? "Dinner check" : "Indoor dinner weather",
      q: tomorrow ? "Is dinner outside tomorrow a good idea?" : "Is dinner outside tonight a good idea?",
      window: cardWindowText(dinner.stats),
      meta: cardMeta(quality === "fallback" ? "Better inside" : "Dinner hours", dinner.reasons)
    };
  })();

  const afterWorkCard = afterWork && (() => {
    const quality = windowQuality(afterWork.score);
    const tomorrow = afterWork.stats.window.dayIdx > 0;
    return {
      ...afterWork,
      intent: "best-patio",
      badge: quality === "show" ? windowVerdict(afterWork.score) : quality === "caution" ? "Iffy" : "Skip",
      title: quality === "show" ? "After work outside" : quality === "caution" ? "After-work check" : "After-work indoor weather",
      q: tomorrow ? "What is the best patio window after work tomorrow?" : "What is the best patio window after work today?",
      window: cardWindowText(afterWork.stats),
      meta: cardMeta(quality === "fallback" ? "Not much payoff" : "After 5pm", afterWork.reasons)
    };
  })();

  const defaults = [
    dryCard,
    walkCard,
    dinnerCard,
    afterWorkCard
  ].filter(Boolean);

  return defaults.slice(0, 4).map((item) => {
    const score = Math.max(0, Math.min(100, item.score));
    return {
      q: item.q,
      intent: item.intent,
      badge: item.badge || windowVerdict(score),
      title: item.title,
      window: item.window || capitalize(item.stats.label),
      meta: item.meta || cardMeta("Weather", item.reasons),
      score
    };
  });
}

function detectAskActivity(q) {
  const s = askText(q);
  for (const [key, rule] of Object.entries(ACTIVITY_RULES)) {
    if (rule.aliases.some((alias) => {
      const phrase = askText(alias).trim();
      return phrase && s.includes(` ${phrase} `);
    })) return key;
  }
  return null;
}

async function answerPresetIntent(intent, question, rowIndex = null) {
  const c = buildAIContext();
  if (!c) return null;

  if (intent === "plan") {
    const result = await answerPlanRequest(question);
    if (result?.clarification) {
      setPlannerClarification(result.clarification, rowIndex);
      return result.clarification.prompt;
    }
    return result || answerFreeform(question);
  }

  const s = askText(question);
  const options = bestWindowOptionsFromText(s, c);
  if (intent === "best-dry") {
    return bestWindowResult("dry", options) ||
      bestWindowResult("dry", { dayIdx: 1, earliestHour: 7, limitHour: 22 });
  }
  if (intent === "best-walk") return bestWindowResult("walk", options);
  if (intent === "best-dinner") return bestWindowResult("dinner", options);
  if (intent === "best-patio") return bestWindowResult("picnic", options);

  const stats = askWindowStats(resolveAskWindow(question, c));
  if (!stats) return null;
  if (intent === "wear") return outfitAnswer(stats, c.units);
  if (intent.startsWith("activity-")) {
    const key = intent.replace(/^activity-/, "");
    const rule = ACTIVITY_RULES[key] || ACTIVITY_RULES.walk;
    return activityAnswer(rule, stats, c.units);
  }
  return answerFreeform(question);
}

function outfitAnswer(stats, units) {
  const feelsF = tempAsF(stats.feelsAvg);
  let outfit;
  if (feelsF >= 88) outfit = "light, breathable clothes";
  else if (feelsF >= 72) outfit = "short sleeves";
  else if (feelsF >= 60) outfit = "a light layer";
  else if (feelsF >= 45) outfit = "a jacket";
  else if (feelsF >= 30) outfit = "a warm coat";
  else outfit = "heavy winter layers";
  const extras = [];
  if (stats.rainChance >= 35) extras.push("rain gear");
  if (stats.windMax >= 20) extras.push("something wind-resistant");
  if (stats.uvMax >= 7) extras.push("sunscreen");
  return `${capitalize(stats.label)}: feels around ${stats.feelsAvg}${units.temp}, ${stats.sky.toLowerCase()}. Wear ${outfit}${extras.length ? `, plus ${extras.join(" and ")}` : ""}.`;
}

function umbrellaAnswer(stats) {
  if (stats.rainChance >= 60) return `Yes — rain is likely ${stats.label} (${stats.rainChance}% chance). Take an umbrella.`;
  if (stats.rainChance >= 35) return `Maybe — there is a ${stats.rainChance}% rain chance ${stats.label}. An umbrella is worth carrying.`;
  return `Probably not — rain is ${askRainWord(stats.rainChance)} ${stats.label} (${stats.rainChance}% chance).`;
}

function generalForecastAnswer(stats, units) {
  return `${capitalize(stats.label)}: ${stats.sky.toLowerCase()}, ${stats.tempMin}${units.temp} to ${stats.tempMax}${units.temp}, rain ${askRainWord(stats.rainChance)} (${stats.rainChance}%), wind up to ${stats.windMax} ${units.wind}.`;
}

function metricAskAnswer(q, stats, c) {
  const s = askText(q);
  const u = c.units;
  if (hasAny(s, ["sunset", "sun set", "sundown", "sun go down", "get dark"])) {
    return stats.day.sunset ? `Sunset ${askDayLabel(c, stats.window.dayIdx)} is at ${stats.day.sunset}.` : "I do not have sunset for that day.";
  }
  if (hasAny(s, ["sunrise", "sun rise", "sun up", "sun come up", "get light"])) {
    return stats.day.sunrise ? `Sunrise ${askDayLabel(c, stats.window.dayIdx)} is at ${stats.day.sunrise}.` : "I do not have sunrise for that day.";
  }
  if (hasAny(s, ["rain", "wet", "precip", "shower", "storm", "drizzle", "snow", "pour"])) {
    return `Rain is ${askRainWord(stats.rainChance)} ${stats.label}: ${stats.rainChance}% chance${stats.precipTotal ? `, about ${formatAmount(stats.precipTotal)} ${u.precip}` : ""}.`;
  }
  if (hasAny(s, ["hot", "warm", "cold", "temperature", "temp ", " high ", " low ", "degrees"])) {
    return `${capitalize(stats.label)} runs from ${stats.tempMin}${u.temp} to ${stats.tempMax}${u.temp}, feeling around ${stats.feelsAvg}${u.temp}.`;
  }
  if (hasAny(s, ["wind", "windy", "gust", "breeze", "breezy"])) {
    const gust = stats.gustMax > stats.windMax + 2 ? ` with gusts near ${stats.gustMax} ${u.wind}` : "";
    return `Wind ${stats.label} should peak near ${stats.windMax} ${u.wind}${gust}.`;
  }
  if (hasAny(s, [" uv ", "sunburn", "sunscreen", "sun strong", "strong is the sun"])) {
    return `UV ${stats.label} peaks at ${stats.uvMax}.`;
  }
  if (hasAny(s, ["air quality", "aqi", "pollution", "polluted", "pm2", "pm 2", "smoke", "hazy air"])) {
    if (!c.air || c.air.aqi === null) return "I do not have air quality data for this place right now.";
    const peak = stats.aqiMax && stats.aqiMax > c.air.aqi + 10
      ? ` It may peak near ${stats.aqiMax} during ${stats.label}.`
      : "";
    return `Air quality is ${c.air.band.label.toLowerCase()} right now: US AQI ${c.air.aqi}${c.air.pm25 !== null ? `, PM2.5 ${Math.round(c.air.pm25)} micrograms per cubic meter` : ""}.${peak}`;
  }
  if (hasAny(s, ["pollen", "allergy", "allergies", "hay fever"])) {
    if (!c.air?.pollen) return "I do not have pollen data for this place right now.";
    const pollen = c.air.pollen;
    return `${capitalize(pollen.label)} pollen is ${pollen.levelLabel}${Number.isFinite(pollen.value) ? `, around ${Math.round(pollen.value)} grains per cubic meter` : ""}.`;
  }
  if (hasAny(s, ["humid", "muggy", "sticky", "dry air"])) {
    return `Humidity is ${c.now.humidity}% right now. I only have detailed humidity for current conditions.`;
  }
  return null;
}

function comparisonDayIndexes(q, c) {
  const s = plannerParseText(q);
  const days = [];
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  if (s.includes("today")) days.push(0);
  if (s.includes("tomorrow")) days.push(1);
  names.forEach((name, wd) => {
    if (!s.includes(name)) return;
    for (let i = 0; i < c.daily.length; i++) {
      if (c.daily[i].dow === wd && !days.includes(i)) {
        days.push(i);
        break;
      }
    }
  });
  if (s.includes("weekend")) {
    for (let i = 0; i < c.daily.length; i++) {
      if ((c.daily[i].dow === 6 || c.daily[i].dow === 0) && !days.includes(i)) days.push(i);
      if (days.length >= 2) break;
    }
  }
  if (days.length < 2 && s.includes("better")) {
    if (!days.includes(0)) days.push(0);
    if (!days.includes(1)) days.push(1);
  }
  return days.slice(0, 2);
}

function dayComfortScore(day) {
  const meanF = (tempAsF(day.hi) + tempAsF(day.lo)) / 2;
  return 100 - day.rainChance - Math.abs(meanF - 72) / 4;
}

function compareAskDays(q, c) {
  const days = comparisonDayIndexes(q, c);
  if (days.length < 2) return null;
  const a = c.daily[days[0]];
  const b = c.daily[days[1]];
  if (!a || !b) return null;
  const better = dayComfortScore(a) >= dayComfortScore(b) ? a : b;
  const other = better === a ? b : a;
  const reason = better.rainChance === other.rainChance
    ? `temps look more comfortable (${better.lo}${c.units.temp}-${better.hi}${c.units.temp})`
    : `lower rain chance (${better.rainChance}% vs ${other.rainChance}%)`;
  return `${better.label} looks better: ${reason}. ${a.label}: ${a.sky.toLowerCase()}, ${a.lo}${c.units.temp}-${a.hi}${c.units.temp}, ${a.rainChance}% rain. ${b.label}: ${b.sky.toLowerCase()}, ${b.lo}${c.units.temp}-${b.hi}${c.units.temp}, ${b.rainChance}% rain.`;
}

function airStatsForHours(data, hours, fallback = null) {
  const airQuality = data?.airQuality;
  if (!airQuality) {
    return {
      aqiMax: fallback?.aqi ?? null,
      aqiLabel: fallback?.band?.label || "",
      pollenRank: fallback?.pollen?.rank ?? 0,
      pollenLabel: fallback?.pollen?.label || "",
      pollenLevel: fallback?.pollen?.levelLabel || ""
    };
  }

  const hourTimes = hours
    .map(({ index }) => parseForecastTimestamp(data?.hourly?.time?.[index], data))
    .filter((ms) => ms !== null);
  const start = hourTimes.length ? Math.min(...hourTimes) - 30 * 60 * 1000 : forecastNowMs(data);
  const end = hourTimes.length ? Math.max(...hourTimes) + 90 * 60 * 1000 : start + 3 * 60 * 60 * 1000;
  const aqTimes = airQuality.hourly?.time || [];

  let aqiMax = null;
  let pollen = null;
  aqTimes.forEach((time, index) => {
    const ms = parseForecastTimestamp(time, airQuality);
    if (ms === null || ms < start || ms > end) return;
    const aqi = finiteValue(airQuality.hourly?.us_aqi?.[index]);
    if (aqi !== null) aqiMax = aqiMax === null ? aqi : Math.max(aqiMax, aqi);
    POLLEN_FIELDS.forEach((field) => {
      const value = finiteValue(airQuality.hourly?.[field.key]?.[index]);
      const band = pollenBand(value);
      if (!band) return;
      const candidate = { label: field.label, value, rank: band.rank, level: band.label };
      if (!pollen || candidate.rank > pollen.rank || (candidate.rank === pollen.rank && candidate.value > pollen.value)) {
        pollen = candidate;
      }
    });
  });

  if (aqiMax === null) aqiMax = fallback?.aqi ?? null;
  if (!pollen && fallback?.pollen) {
    pollen = {
      label: fallback.pollen.label,
      value: fallback.pollen.value,
      rank: fallback.pollen.rank,
      level: fallback.pollen.levelLabel
    };
  }
  const band = aqiMax !== null ? aqiBand(aqiMax) : null;
  return {
    aqiMax: aqiMax !== null ? Math.round(aqiMax) : null,
    aqiLabel: band?.label || "",
    pollenRank: pollen?.rank ?? 0,
    pollenLabel: pollen?.label || "",
    pollenLevel: pollen?.level || ""
  };
}

function answerFreeform(q) {
  const c = buildAIContext();
  if (!c) return null;
  const s = plannerParseText(q);
  const stats = askWindowStats(resolveAskWindow(q, c));
  if (!stats) return null;

  const comparison = compareAskDays(q, c);
  if (comparison && hasAny(s, ["better", "which", "compare", " or "])) return comparison;

  if (hasAny(s, ["umbrella"])) return umbrellaAnswer(stats);
  if (hasAny(s, ["what to wear", "should i wear", "what to put on", "a jacket", "a coat", "bundle"])) {
    return outfitAnswer(stats, c.units);
  }

  const activity = detectAskActivity(q);
  if (hasAny(s, ["best", "best time", "best window", "when should", "when can", "what time", "window"])) {
    const options = bestWindowOptionsFromText(s, c);
    if (hasAny(s, ["dry", "rain-free", "rain free"])) return bestWindowAnswer("dry", options);
    if (activity) return bestWindowAnswer(activity, options);
    return bestWindowAnswer("walk", options);
  }

  if (activity) return activityAnswer(ACTIVITY_RULES[activity], stats, c.units);

  const metric = metricAskAnswer(q, stats, c);
  if (metric) return metric;

  if (hasAny(s, ["weather", "forecast", "conditions", "look like", "going to be", "outside"])) {
    return generalForecastAnswer(stats, c.units);
  }

  return null;
}

function resetAsk() {
  if (askAbort) askAbort.aborted = true;
  askThread = [];
  askStreaming = false;
  askError = "";
  plannerClarification = null;
  renderAsk();
}

function scrollAskIntoView() {
  // Keep the newest exchange + input visible inside the sheet.
  requestAnimationFrame(() => {
    const form = document.getElementById("askForm");
    if (form) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function submitAskForm() {
  const input = document.getElementById("askInput");
  if (!input || input.disabled) return;
  runAsk(input.value);
}

function bindAskSendButton() {
  const send = document.querySelector("#askForm .ask-send");
  if (!send) return;
  bindTapAction(send, submitAskForm);
}

function renderPlannerClarification(disabledAttr = "") {
  const pending = plannerClarification;
  if (!pending) return "";
  if (pending.type === "confirm") {
    const facts = pending.facts || {};
    const notes = (pending.notes || []).filter(Boolean);
    return `
      <div class="ask-confirm" aria-label="Plan Check interpretation confirmation">
        <div class="ask-confirm-head">
          <strong>I read your plan as</strong>
          <small>Confirm the timing and place before Nearcast checks the weather.</small>
        </div>
        <dl class="ask-confirm-facts">
          <div><dt>Plan</dt><dd>${escapeHtml(facts.plan || "Plan")}</dd></div>
          <div><dt>Day</dt><dd>${escapeHtml(facts.day || "Selected day")}</dd></div>
          <div><dt>Time</dt><dd>${escapeHtml(facts.time || "Selected time")}</dd></div>
          <div><dt>Place</dt><dd>${escapeHtml(facts.place || "Selected place")}</dd></div>
        </dl>
        ${notes.length ? `<p>${escapeHtml(notes.join(" · "))}</p>` : ""}
        <div class="ask-clarify ask-confirm-actions">
          ${pending.options.map((option, index) =>
            `<button class="ask-clarify-chip${option.confirmPlan ? " primary" : ""}" type="button" data-ask-clarify="${index}"${disabledAttr}>${escapeHtml(option.label)}</button>`
          ).join("")}
        </div>
      </div>
    `;
  }
  return `<div class="ask-clarify" aria-label="Plan Check follow-up choices">` +
    pending.options.map((option, index) =>
      `<button class="ask-clarify-chip" type="button" data-ask-clarify="${index}"${disabledAttr}>${escapeHtml(option.label)}</button>`
    ).join("") +
  `</div>`;
}

function plannerStarterExamples() {
  return [
    { label: "Outdoor party", template: "outdoor party Friday 3-8" },
    { label: "Practice", template: "soccer practice tomorrow 6-8" },
    { label: "Patio dinner", template: "dinner outside tonight" }
  ];
}

function previewPlanMemoryFromEvent(event, exchange = {}, index = 0) {
  if (!event?.data || !event.place) return null;
  const targetDate = event.data.daily?.time?.[event.dayIndex];
  if (!targetDate) return null;
  return normalizePlanMemory({
    id: event.memoryId || `plan-preview-${index}`,
    kind: "plan",
    title: event.title || event.label || "Plan",
    label: event.label || "Plan window",
    original: exchange.q || "",
    answer: exchange.a || "",
    place: event.place,
    targetDate,
    startHour: event.startHour,
    endHour: event.endHour,
    createdAt: Number(event.startMs) || Date.now(),
    updatedAt: Number(event.endMs) || Date.now()
  });
}

function planDecisionItemForExchange(exchange, index) {
  const event = exchange?.event;
  if (!event?.data || !event.place) return null;
  const rememberedId = exchange.memoryId || rememberedPlanIdForEvent(event);
  const remembered = rememberedId
    ? state.planMemories.find((memory) => memory.id === rememberedId)
    : null;
  const memory = remembered || previewPlanMemoryFromEvent(event, exchange, index);
  if (!memory) return null;
  const alerts = event.alerts || [];
  const context = buildAIContext(event.data, event.place, alerts);
  return planBriefingItemFromEvent(memory, event, event.data, event.place, context, alerts);
}

function renderSavedPlanWatchConfirmation(memoryId) {
  const id = String(memoryId || "").trim();
  if (!id) return "";
  const escapedId = escapeHtml(id);
  const copy = planWatchNotificationPlanCopy(id);
  const selected = planWatchNotificationPlanEnabled(id);
  const delivery = planWatchRegistrationHealth();
  const permission = planWatchNotificationPermission();
  let notificationTitle = "Want a heads-up?";
  let notificationBody = "Optional: choose up to 3 active plans for meaningful-change notifications.";
  let notificationAction = copy.disabled
    ? ""
    : `<button type="button" data-watch-notify="${escapedId}" aria-pressed="${copy.pressed ? "true" : "false"}">${escapeHtml(copy.label)}</button>`;
  let notificationTone = "neutral";

  if (permission === "denied") {
    notificationTitle = "Watching in the app";
    notificationBody = "Notifications are blocked in device settings, but this plan will still update here.";
    notificationAction = "";
    notificationTone = "caution";
  } else if (!planWatchNotificationsSupported()) {
    notificationTitle = "Watching in the app";
    notificationBody = "This browser cannot deliver notifications, but the plan will still update here.";
    notificationAction = "";
  } else if (copy.action === "limit") {
    notificationTitle = "Three plans already notify you";
    notificationBody = "This plan is still watched in the app. Turn notifications off for another plan before enabling this one.";
    notificationAction = "";
    notificationTone = "caution";
  } else if (selected && delivery.ready) {
    notificationTitle = "Notifications are on";
    notificationBody = "Nearcast can send a heads-up when this plan changes meaningfully.";
    notificationTone = "good";
  } else if (selected && (delivery.state === "failed" || delivery.state === "expired" || planWatchNativeDeliveryNotConfigured())) {
    notificationTitle = delivery.state === "expired" ? "Delivery needs renewal" : "Delivery needs attention";
    notificationBody = delivery.state === "expired"
      ? "The plan is still watched here, but this device’s notification registration expired."
      : "The plan is still being watched here, but notifications are not reaching this device yet.";
    notificationTone = "caution";
  } else if (selected) {
    notificationTitle = "Setting up notifications";
    notificationBody = "The plan is saved. Nearcast is still confirming delivery for this device.";
  }

  return `
    <section class="ask-watch-saved">
      <div class="ask-watch-confirmation" role="status" aria-live="polite">
        <span class="ask-watch-confirmation-mark" aria-hidden="true">✓</span>
        <span>
          <strong>Nearcast is watching this</strong>
          <small>We’ll compare this exact time and place as the forecast changes.</small>
        </span>
      </div>
      <div class="ask-watch-next is-${escapeHtml(notificationTone)}">
        <span>
          <strong>${escapeHtml(notificationTitle)}</strong>
          <small>${escapeHtml(notificationBody)}</small>
        </span>
        ${notificationAction}
      </div>
      <button class="ask-watch-open" type="button" data-memory-show="${escapedId}">Open watched plan</button>
    </section>
  `;
}

function renderPlanDecisionExchange(exchange, index, streaming = false) {
  const item = planDecisionItemForExchange(exchange, index);
  if (!item) return "";
  const event = exchange.event;
  const rememberedId = exchange.memoryId || rememberedPlanIdForEvent(event);
  const memory = item.memory;
  const title = planMemoryTitle(memory);
  const meta = [
    planMemoryDayLabel(memory, event.data),
    planMemoryTimeText(memory),
    placeLabel(memory.place)
  ].filter(Boolean).join(" · ");
  const reason = item.fullReason || item.primaryReason || exchange.a;
  const action = item.action || (item.tone === "good" ? "" : item.advice);
  const signals = planContextSignalRows(item).map(renderPlanSignalChip).join("");
  const decisionLabel = item.label || item.verdict || "Forecast checked";
  const reasonLabel = item.tone === "good" ? "Why it works" : "Main concern";
  const actionLabel = item.tone === "good" ? "Good to know" : "Plan for this";
  const watchAction = rememberedId
    ? renderSavedPlanWatchConfirmation(rememberedId)
    : `<button class="ask-decision-primary-btn" type="button" data-memory-remember="${index}">Watch this plan</button>` +
      `<span class="ask-decision-action-note">Get meaningful updates if the forecast changes.</span>`;
  const changeTarget = rememberedId || index;
  return `
    <article class="ask-decision is-${escapeHtml(item.tone || "pending")}${streaming ? " answering" : ""}">
      <div class="ask-decision-head">
        <span>Forecast read</span>
        <strong>${escapeHtml(decisionLabel)}</strong>
      </div>
      <div class="ask-decision-plan">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(meta)}</p>
      </div>
      <div class="ask-decision-story">
        ${reason ? `<p class="ask-decision-reason"><span>${escapeHtml(reasonLabel)}</span>${escapeHtml(reason)}</p>` : ""}
        ${action ? `<p class="ask-decision-action"><span>${escapeHtml(actionLabel)}</span>${escapeHtml(action)}</p>` : ""}
      </div>
      ${signals ? `<div class="plan-watch-signals ask-decision-signals">${signals}</div>` : ""}
      <div class="ask-decision-actions">
        <div class="ask-decision-primary-row">
          ${watchAction}
        </div>
        <div class="ask-decision-secondary-actions">
          <button class="ask-show" type="button" data-ask-show="${index}">Hourly detail</button>
          <button class="ask-memory-btn" type="button" data-memory-edit="${escapeHtml(changeTarget)}">Change plan</button>
        </div>
      </div>
    </article>
  `;
}

function renderAskExchange(exchange, index) {
  const streaming = askStreaming && index === askThread.length - 1;
  if (exchange.event && !streaming) return renderPlanDecisionExchange(exchange, index, streaming);
  const showAction = exchange.event && !streaming
    ? `<button class="ask-show" type="button" data-ask-show="${index}">Hourly detail</button>`
    : "";
  return `<div class="ask-exchange${streaming ? " answering" : ""}">` +
    `<p class="ask-q">${escapeHtml(exchange.q)}</p>` +
    `<p class="ask-a">${escapeHtml(exchange.a)}</p>` +
    (showAction ? `<div class="ask-exchange-actions">${showAction}</div>` : "") +
  `</div>`;
}

function latestAskDecisionIndex() {
  for (let index = askThread.length - 1; index >= 0; index -= 1) {
    const streaming = askStreaming && index === askThread.length - 1;
    if (askThread[index]?.event && !streaming) return index;
  }
  return -1;
}

function renderLatestAskDecision(index) {
  if (index < 0) return "";
  return `
    <section class="ask-latest-result" aria-label="Latest Plan Check">
      <div class="ai-section-title ask-latest-title">
        <strong>Latest check</strong>
        <span>Forecast window ready</span>
      </div>
      ${renderAskExchange(askThread[index], index)}
    </section>
  `;
}

function renderAskWorkingThread(excludeIndex, errLine, clarification) {
  const activeTailIndex = excludeIndex >= 0 && (askStreaming || clarification || errLine)
    ? askThread.length - 1
    : -1;
  const active = askThread
    .map((exchange, index) => ({ exchange, index }))
    .filter(({ index }) => index !== excludeIndex)
    .filter(({ index }) => excludeIndex < 0 || index === activeTailIndex);
  if (!active.length && !errLine && !clarification) return "";
  return `<div class="ask-thread ask-active-thread">` +
    active.map(({ exchange, index }) => renderAskExchange(exchange, index)).join("") +
    errLine +
    clarification +
  `</div>`;
}

function renderAskHistory(excludeIndex) {
  const activeTailIndex = excludeIndex >= 0 && (askStreaming || plannerClarification || askError)
    ? askThread.length - 1
    : -1;
  const history = askThread
    .map((exchange, index) => ({ exchange, index }))
    .filter(({ index }) => index !== excludeIndex)
    .filter(({ index }) => index !== activeTailIndex)
    .filter(({ index }) => !(askStreaming && index === askThread.length - 1));
  if (excludeIndex < 0 || !history.length) return "";
  const label = history.length === 1 ? "1 earlier check" : `${history.length} earlier checks`;
  return `
    <details class="ask-history">
      <summary>
        <span>Earlier checks</span>
        <small>${escapeHtml(label)}</small>
      </summary>
      <div class="ask-history-list">
        ${history.map(({ exchange, index }) => renderAskExchange(exchange, index)).join("")}
      </div>
    </details>
  `;
}

function renderAsk() {
  const perf = perfStart();
  const panel = els.aiAsk;
  if (!panel) {
    perfEnd("renderAsk", perf);
    return;
  }
  const available = state.forecast && state.activePlace &&
    aiState.phase !== "unknown";
  if (!available) {
    panel.hidden = true;
    perfEnd("renderAsk", perf);
    return;
  }
  panel.hidden = false;

  const busy = aiState.phase === "generating" || askStreaming;
  const dis = busy ? " disabled" : "";

  const memorySection = renderPlanMemorySection();
  const examples = plannerStarterExamples().map((example) =>
    `<button class="ask-example-chip" type="button" data-ask-template="${escapeHtml(example.template)}"${dis}>` +
      `${escapeHtml(example.label)}` +
    `</button>`
  ).join("");
  const editing = plannerEditingMemoryId && state.planMemories.some((memory) => memory.id === plannerEditingMemoryId);
  const place = state.activePlace ? placeLabel(state.activePlace) : "this place";
  const promptTitle = editing ? "Update this plan" : "What should Nearcast check?";
  const promptCopy = editing
    ? "Change the activity, time, or place. Nearcast will check the new window against the forecast."
    : `Using ${place} unless you mention another place.`;
  const latestIndex = latestAskDecisionIndex();
  const latest = renderLatestAskDecision(latestIndex);
  const errLine = askError ? `<p class="ask-err">${escapeHtml(askError)}</p>` : "";
  const clarification = renderPlannerClarification(dis);
  const activeThread = renderAskWorkingThread(latestIndex, errLine, clarification);
  const history = renderAskHistory(latestIndex);

  panel.innerHTML =
    `<section class="ask-plan-check" aria-label="Plan Check">` +
      `<div class="ask-plan-copy">` +
        `<span>Plan Check</span>` +
        `<h3>${escapeHtml(promptTitle)}</h3>` +
        `<p>${escapeHtml(promptCopy)}</p>` +
      `</div>` +
      `<form class="ask-form" id="askForm">` +
        `<input id="askInput" type="text" autocomplete="off" ` +
          `placeholder="outdoor party Friday 3-8"${dis}>` +
        `<button type="submit" class="ask-send" aria-label="Check plan"${dis}>↑</button>` +
      `</form>` +
      `<div class="ask-plan-examples" aria-label="Plan examples">${examples}</div>` +
      `<p class="ask-helper">Name another city only when the plan is away from ${escapeHtml(place)}.</p>` +
    `</section>` +
    latest +
    activeThread +
    history +
    memorySection;
  bindAskSendButton();
  const input = document.getElementById("askInput");
  bindInputResponsiveness(input, "planner-input");
  bindSheetInputViewportGuard(input, els.aiSheet);
  perfEnd("renderAsk", perf);
}

function showPlannerEvent(rowIndex) {
  const event = askThread[rowIndex]?.event;
  if (!event?.data || !event.place) return;
  plannerReturnAfterDayDetail = {
    scrollTop: els.aiSheet?.scrollTop || 0
  };
  closeAISheet();
  const opened = openPlannerEventDetail(event);
  if (!opened) {
    const returnState = plannerReturnAfterDayDetail;
    plannerReturnAfterDayDetail = null;
    openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
  }
}

function openPlannerEventDetail(event) {
  const data = event.data;
  const dayIndex = event.dayIndex ?? 0;
  const dayStr = data?.daily?.time?.[dayIndex];
  if (!dayStr || !data?.hourly?.time?.length) return false;
  const indices = [];
  data.hourly.time.forEach((time, index) => {
    if (time.startsWith(dayStr)) indices.push(index);
  });
  if (!indices.length) return false;

  const code = representativeDailyCode(data, dayIndex);
  const memory = event.memoryId ? state.planMemories.find((item) => item.id === event.memoryId) : null;
  openDayDetail({
    indices,
    title: plannerEventSheetTitle(event, dayStr, dayIndex),
    contextLabel: memory ? planMemoryEventContextLabel(memory, event) : plannerEventContextLabel(event),
    code,
    stormPotential: hasThunderPotentialForDay(data, dayIndex, code),
    isDay: true,
    sunriseISO: data.daily.sunrise?.[dayIndex],
    sunsetISO: data.daily.sunset?.[dayIndex],
    dayIndex,
    initialMode: "hourly",
    persistInitialMode: false,
    showNow: dayIndex === 0,
    data,
    alerts: event.alerts || [],
    eventWindow: event
  });
  scrollFocusedSheetHour();
  return true;
}

function scrollFocusedSheetHour() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector("#sheetHourlyList .sheet-hour-row.is-plan-window")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
}

function plannerEventSheetTitle(event, dayStr, dayIndex) {
  const label = String(event.label || "").trim();
  if (label && label !== "custom" && label.length <= 28) return capitalize(label);
  return formatDay(dayStr, dayIndex);
}

function plannerEventContextLabel(event) {
  const place = event?.place ? placeLabel(event.place) : "";
  const title = String(event?.title || "").trim();
  return ["Plan Check", place, title].filter(Boolean).join(" · ");
}

/* ---------- Planner launcher + sheet ---------- */
function renderAILauncher() {
  const btn = els.aiLauncher;
  if (!btn) return;
  const show = state.forecast && state.activePlace &&
    aiState.phase !== "unknown";
  btn.hidden = !show;
  if (show && els.aiLauncherSub) {
    els.aiLauncherSub.textContent =
      aiState.phase === "error" ? "Plan checks work · private summary needs attention"
      : "Check a plan against the forecast.";
  }
  if (typeof renderPlanInvitation === "function") renderPlanInvitation();
  if (typeof updateInstallPromptUI === "function") updateInstallPromptUI();
}

function openAISheet(options = {}) {
  const { restoreScroll = null, autoBrief = false } = options;
  if (typeof retirePlanInvitationForPlanCheckEntry === "function") {
    retirePlanInvitationForPlanCheckEntry();
  }
  els.aiBackdrop.hidden = false;
  els.aiSheet.hidden = false;
  setSheetScrollAnchor(els.aiSheet);
  showSheet(els.aiBackdrop, els.aiSheet, {
    onPullDismiss: closeAISheet,
    canPullDismiss: () => aiState.phase !== "generating" && !askStreaming
  });
  document.body.style.overflow = "hidden";
  if (restoreScroll !== null && restoreScroll !== undefined) {
    requestAnimationFrame(() => {
      els.aiSheet.scrollTop = restoreScroll;
    });
  }
  // Summary generation is optional; the planner sheet opens directly to plan checking.
  if (autoBrief && aiState.phase === "ready" && !aiState.text) runBrief();
}

function closeAISheet() {
  els.aiBackdrop.classList.remove("show");
  els.aiSheet.classList.remove("show");
  clearSheetScrollAnchor(els.aiSheet);
  clearSheetKeyboardGuard(els.aiSheet);
  document.body.style.overflow = "";
  setTimeout(() => {
    els.aiBackdrop.hidden = true;
    els.aiSheet.hidden = true;
  }, 280);
}
