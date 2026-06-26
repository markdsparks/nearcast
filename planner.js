/* Nearcast planner, local AI summary, and plan memory surfaces. */

/* ---------- Planner: local AI summary (Tier 1, opt-in) ---------- */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const LOCAL_AI_MODEL_MB = 350;
const LOCAL_AI_MIN_FREE_BYTES = 450 * 1024 * 1024;

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
    model: LOCAL_AI_MODEL,
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

function planBriefingTone(item) {
  if (item.alertTone === "warning" || item.alertTone === "watch") return "watch";
  if (item.score < 45 || item.stats?.stormPotential) return "watch";
  if (item.score < 65 || item.stats?.rainChance >= 35 || item.stats?.gustMax >= 25) return "caution";
  return "good";
}

function planBriefingPriority(item) {
  const alertWeight = item.alertTone === "warning" ? 80 :
    item.alertTone === "watch" ? 65 :
      item.alertTone === "advisory" ? 42 : 0;
  const rainWeight = item.stats?.stormPotential ? 35 : Math.min(35, Math.max(0, item.stats?.rainChance || 0) / 2);
  const windWeight = Math.max(0, (item.stats?.gustMax || 0) - 18);
  const scoreWeight = Math.max(0, 75 - item.score);
  return alertWeight + rainWeight + windWeight + scoreWeight;
}

function planBriefingReason(item) {
  const reasons = item.reasons || [];
  if (item.alert) return reasons[0] || `${item.alert.event} overlaps that window`;
  if (item.stats?.stormPotential) return "thunderstorms are possible";
  if (item.stats?.rainChance >= 35) return `${item.stats.rainChance}% rain chance`;
  if (item.stats?.gustMax >= 25) return `gusts near ${item.stats.gustMax} ${item.units.wind}`;
  if (item.stats?.uvMax >= 8) return `UV up to ${item.stats.uvMax}`;
  if (item.stats?.aqiMax >= 101) return `AQI ${item.stats.aqiMax}`;
  return reasons[0] || "weather looks manageable";
}

function planBriefingItemFromEvent(memory, event, data, place, c = buildAIContext(data, place, activeAlerts)) {
  if (!memory || !event || !data || !place || !c) return null;
  const stats = planWindowStats(data, c, {
    dayIdx: event.dayIndex,
    startHour: event.startHour,
    endHour: event.endHour,
    label: "custom"
  });
  if (!stats) return null;
  const activityKey = planBriefingActivityKey(memory);
  const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.event || ACTIVITY_RULES.walk;
  const alert = topAlertForPlanRange(activeAlerts, event.startMs, event.endMs);
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
    units: c.units,
    reasons: planReasons(stats, c.units, alert).slice(0, 3)
  };
  item.tone = planBriefingTone(item);
  item.priority = planBriefingPriority(item);
  item.primaryReason = planBriefingReason(item);
  item.advice = planAdvice(stats, alert, score);
  return item;
}

function planAwareBriefingItems(data = state.forecast, place = state.activePlace, options = {}) {
  if (!data || !place || !state.planMemories?.length) return [];
  const todayIndex = Number.isInteger(options.dayIndex)
    ? options.dayIndex
    : typeof forecastDailyIndex === "function" ? forecastDailyIndex(data) : 0;
  const c = buildAIContext(data, place, activeAlerts);
  if (!c) return [];
  return activePlanMemoryEventsForDay(todayIndex, data, place)
    .map(({ memory, event }) => planBriefingItemFromEvent(memory, event, data, place, c))
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || a.event.startMs - b.event.startMs);
}

function nextPlanBriefingItem(data = state.forecast, place = state.activePlace) {
  if (!data || !place || !state.planMemories?.length) return null;
  const c = buildAIContext(data, place, activeAlerts);
  if (!c) return null;
  const events = planMemoryEventsForPlace(data, place, { limit: 12 });
  for (const { memory, event } of events) {
    const item = planBriefingItemFromEvent(memory, event, data, place, c);
    if (item) return item;
  }
  return null;
}

function planPulseMetricRows(item) {
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const rain = `${item.stats.rainChance}%`;
  const wind = `${item.stats.gustMax || item.stats.windMax} ${item.units.wind}`;
  const temps = `${item.stats.tempMin}${degree(tempUnit)}-${item.stats.tempMax}${degree(tempUnit)}`;
  return [
    ["Rain", rain],
    ["Gusts", wind],
    ["Temp", temps]
  ].map(([label, value]) =>
    `<span><b>${escapeHtml(label)}</b><strong>${escapeHtml(value)}</strong></span>`
  ).join("");
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
    <article class="next-plan-card is-${item.tone}" aria-label="Next remembered plan">
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
        <button type="button" data-memory-show="${escapeHtml(item.memory.id)}">Show forecast</button>
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
    : items.length === 1 ? "1 remembered plan" : `${items.length} remembered plans`;
  const rows = visible.map((item) => {
    const title = planMemoryTitle(item.memory);
    const reason = item.reasons.slice(0, 2).join(" · ") || item.primaryReason;
    return `
      <button class="plan-pulse-brief-item is-${item.tone}" type="button" data-plan-brief-show="${escapeHtml(item.memory.id)}" aria-label="Open ${escapeHtml(title)} forecast">
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
      ${items.length > visible.length ? `<button class="plan-pulse-more" type="button" data-memory-open>View memories</button>` : ""}
    </section>
  `;
}

function renderPlanPulse(data = state.forecast, place = state.activePlace) {
  const slot = els.planPulse;
  if (!slot) return;
  const next = nextPlanBriefingItem(data, place);
  const today = planAwareBriefingItems(data, place);
  const nextKey = planBriefingItemKey(next);
  const mainItems = nextKey
    ? today.filter((item) => planBriefingItemKey(item) !== nextKey)
    : today;
  const html = [
    renderNextPlanCard(next, data),
    renderMainPlanBriefing(mainItems, data, { also: Boolean(nextKey) })
  ].filter(Boolean).join("");
  slot.hidden = !html;
  slot.innerHTML = html;
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
      <button class="plan-briefing-item is-${item.tone}" type="button" data-plan-brief-show="${escapeHtml(item.memory.id)}" aria-label="Open ${escapeHtml(title)} forecast">
        <span class="plan-briefing-item-head">
          <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(planMemoryTimeText(item.memory))}</small></span>
          <em>${escapeHtml(item.verdict)}</em>
        </span>
        <span class="plan-briefing-item-reason">${escapeHtml(reason || item.primaryReason)}</span>
      </button>
    `;
  }).join("");
  const more = items.length > visible.length
    ? `<button class="plan-briefing-more" type="button" data-memory-open>View memories</button>`
    : "";

  return `
    <section class="plan-briefing" aria-label="Plan-aware briefing">
      <div class="plan-briefing-head">
        <span class="plan-briefing-spark" aria-hidden="true">✦</span>
        <div>
          <strong>What matters today</strong>
          <small>Based on remembered plans</small>
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
      .then((ai) => ai.load())
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
    const warning = aiState.support?.warnings?.[0];
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
      `<span class="briefing-tag">${lockGlyph()}One-time model download, then private on this device</span>`);
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
  "overnight", "midday", "weekend", "daytime", "sunday", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday"
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
  // Weekday names → next occurrence (today counts if it matches).
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
let memoryEditState = null;
let launchSummaryTargets = [];

function fillPlannerTemplate(template, options = {}) {
  const input = document.getElementById("askInput");
  if (!input) return;
  const { helperText = "Finish the thought: add the day, time, and place if it is away from here." } = options || {};
  const form = document.getElementById("askForm");
  const helper = document.querySelector(".ask-helper");
  input.value = template || "";
  if (form) {
    form.classList.add("is-drafting");
    if (els.aiSheet && !els.aiSheet.hidden) {
      els.aiSheet.scrollTo({ top: els.aiSheet.scrollHeight, behavior: "smooth" });
      restoreSheetScrollAnchor(els.aiSheet);
    } else {
      form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
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
    const row = beginAskResponse(question);
    try {
      finishAskResponse(row, await answerPresetIntent(intent, question));
    } catch {
      finishAskResponse(row, "I hit a snag checking that preset. Try typing the plan with a day and time.");
    }
    return;
  }

  if (plannerEditingMemoryId) {
    await runMemoryEdit(question, plannerEditingMemoryId);
    return;
  }

  // Free-form: answer deterministically from the data (always correct). We do
  // NOT route open questions to the model — a 0.5B hallucinates on these
  // (e.g. inventing a day's forecast). If we can't answer exactly, say what we
  // CAN answer rather than guessing.
  const row = beginAskResponse(question);
  try {
    const plan = await answerPlanRequest(question);
    if (plan?.clarification) {
      plannerClarification = plan.clarification;
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
      plannerClarification = result.clarification;
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
  const row = beginAskResponse(option.label);
  try {
    if (pending.type === "confirm") {
      if (option.confirmPlan) {
        finishAskResponse(row, pending.result, editingMemoryId ? {
          updateMemoryId: editingMemoryId,
          original: plannerEditingMemoryDraft || pending.plan?.original || option.label
        } : {});
        return;
      }
      const nextClarification = buildPlanConfirmationAdjustment(pending, option.field);
      if (nextClarification) {
        plannerClarification = nextClarification;
        finishAskResponse(row, nextClarification.prompt);
        return;
      }
    }
    const result = await completePlanRequest(pending.plan, option);
    if (result?.clarification) {
      plannerClarification = result.clarification;
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result, editingMemoryId ? {
      updateMemoryId: editingMemoryId,
      original: plannerEditingMemoryDraft || pending.plan?.original || option.label
    } : {});
  } catch {
    finishAskResponse(row, "I could not check that plan. Try adding the city/state and a time window.");
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
      plannerClarification = result.clarification;
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
const PLAN_LOCAL_AI_TIMEOUT_MS = 2200;

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
  renderAsk();
  refreshPlanMemorySurfaces();
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
  clearPlannerMemoryEdit();
  refreshPlanMemorySurfaces();
  return true;
}

function forgetPlanMemory(id) {
  const before = state.planMemories.length;
  state.planMemories = state.planMemories.filter((memory) => memory.id !== id);
  askThread.forEach((exchange) => {
    if (exchange.memoryId === id) exchange.memoryId = "";
  });
  if (plannerEditingMemoryId === id) clearPlannerMemoryEdit();
  if (state.planMemories.length !== before) savePlanMemories();
  renderAsk();
  refreshPlanMemorySurfaces();
}

function startPlanMemoryEdit(idOrRow) {
  const rowIndex = Number(idOrRow);
  const exchange = Number.isInteger(rowIndex) ? askThread[rowIndex] : null;
  const memory = exchange ? null : state.planMemories.find((item) => item.id === idOrRow);
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
      ? "Editing remembered plan. Submit to replace this memory."
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

function memoryIdsFromValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function openMemoryDetail(idsOrValue) {
  const ids = [...new Set(memoryIdsFromValue(idsOrValue))];
  const memories = ids
    .map((id) => state.planMemories.find((memory) => memory.id === id))
    .filter(Boolean);
  if (!memories.length || !els.memoryDetailSheet || !els.memoryDetailBackdrop || !els.memoryDetailBody) return;
  memoryDetailIds = memories.map((memory) => memory.id);
  document.getElementById("memoryDetailTitle").textContent = memories.length === 1
    ? planMemoryTitle(memories[0])
    : `${memories.length} memories`;
  document.getElementById("memoryDetailSub").textContent = memories.length === 1
    ? "Local context · under your control"
    : "Overlapping local context";
  els.memoryDetailBody.innerHTML = memories.map(renderMemoryDetailPanel).join("");
  els.memoryDetailBackdrop.hidden = false;
  els.memoryDetailSheet.hidden = false;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  showSheet(els.memoryDetailBackdrop, els.memoryDetailSheet);
  document.body.style.overflow = "hidden";
}

function refreshOpenMemoryDetail() {
  const ids = memoryDetailIds.filter((id) => state.planMemories.some((memory) => memory.id === id));
  if (!ids.length) {
    closeMemoryDetail();
    return;
  }
  openMemoryDetail(ids);
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
  if (!els.memoryDetailSheet?.hidden) closeMemoryDetail();

  const place = normalizePlace(memory.place);
  const here = samePlanPlace(place, state.activePlace);
  memoryEditState = {
    memoryId: memory.id,
    title: planMemoryTitle(memory),
    original: memory.original || "",
    place,
    placeQuery: placeLabel(place),
    targetDate: memory.targetDate,
    startHour: Math.max(0, Math.min(23, Math.floor(Number(memory.startHour) || 0))),
    endHour: Math.max(1, Math.min(24, Math.ceil(Number(memory.endHour) || 1))),
    data: here ? state.forecast : null,
    alerts: here ? activeAlerts : [],
    results: [],
    searchSeq: 0,
    previewSeq: 0,
    forecastKey: "",
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
  showSheet(els.memoryEditBackdrop, els.memoryEditSheet);
  document.body.style.overflow = "hidden";
  updateMemoryEditPreview({ fetchIfNeeded: true });
}

function renderMemoryEditSheet() {
  if (!memoryEditState || !els.memoryEditBody) return;
  const placeValue = memoryEditState.placeQuery || placeLabel(memoryEditState.place);
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
        <button class="memory-edit-save" type="submit"${memoryEditState.saving ? " disabled" : ""}>Save changes</button>
        <button type="button" data-memory-edit-text>Edit with text</button>
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
  const place = memoryEditState?.place;
  if (!place) return "";
  return `${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}:${state.unit}`;
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
    ${alert ? `<div><span>Alert</span><strong>${escapeHtml(alert.event)}</strong></div>` : ""}
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
    const existing = state.planMemories.find((memory) => memory.id === memoryEditState.memoryId);
    if (!existing) throw new Error("Memory missing.");
    const draft = {
      ...memoryEditState,
      data,
      label: memoryEditWindowText(memoryEditState)
    };
    const updated = normalizePlanMemory({
      ...existing,
      title: draft.title,
      label: draft.label,
      original: existing.original || `${draft.title} ${hourText(draft.startHour)}-${hourText(draft.endHour)} in ${placeLabel(draft.place)}`,
      answer: structuredMemoryAnswer(draft, stats, c, alert),
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
    clearPlannerMemoryEdit();
    renderAsk();
    refreshPlanMemorySurfaces();
    closeMemoryEditSheet();
  } catch (err) {
    if (memoryEditState) memoryEditState.saving = false;
    renderMemoryEditSheet();
    setMemoryEditPreview(`<p>${escapeHtml(memoryEditErrorMessage(err))}</p>`, "is-warning");
  }
}

function closeMemoryEditSheet() {
  if (!els.memoryEditSheet || !els.memoryEditBackdrop || els.memoryEditSheet.hidden) return;
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
        <div><dt>Original</dt><dd>${escapeHtml(original || planMemoryDraft(memory))}</dd></div>
        <div><dt>Interpreted</dt><dd>${escapeHtml(interpreted)}</dd></div>
        <div><dt>Weather window</dt><dd>${escapeHtml(weatherLine)}</dd></div>
        ${answer ? `<div><dt>Last answer</dt><dd>${escapeHtml(answer)}</dd></div>` : ""}
        <div><dt>Saved</dt><dd>${escapeHtml(saved)}${updated ? ` · updated ${escapeHtml(updated)}` : ""}</dd></div>
      </dl>
      <div class="memory-detail-actions">
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit memory</button>
        <button type="button" data-memory-show="${escapeHtml(memory.id)}">Show forecast</button>
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

function planMemoryEvent(memory, data = state.forecast, place = state.activePlace, alerts = activeAlerts) {
  if (!memory || !data || !place || !samePlanPlace(memory.place, place)) return null;
  const dayIdx = data.daily?.time?.indexOf(memory.targetDate);
  if (dayIdx === undefined || dayIdx < 0) return null;
  const c = buildAIContext(data, place, alerts);
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
    place,
    data,
    alerts,
    window,
    stats,
    label: memory.label
  });
  if (event) {
    event.memoryId = memory.id;
    event.badgeLabel = "Memory";
  }
  return event;
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
    label: "remembered plans",
    badgeLabel: "Memory",
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
  return ["Memory", place, [title, when].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}

function planMemoryDayContextLabel(items, event) {
  if (!items?.length) return "";
  if (items.length === 1) return planMemoryEventContextLabel(items[0].memory, event);
  const place = event?.place ? placeLabel(event.place) : "";
  return ["Memory", place, `${items.length} plans`, planMemoryDayRangeText(items)].filter(Boolean).join(" · ");
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
  if (memoryWindows.length > 1) return `${memoryWindows.length} memories`;
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

function graphMemoryWindowLabel(ids, fallback = "Memory") {
  if (!ids?.length) return fallback;
  if (ids.length > 1) return `${ids.length} memories`;
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
  return `${window.label}, ${start} to ${end}. Show memory details.`;
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
            <button type="button" data-memory-show="${escapeHtml(memory.id)}">${isHere ? "Show" : "Load"}</button>
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
  const items = upcoming.slice(0, 6);
  const here = items.filter((item) => item.isHere);
  const elsewhere = items.filter((item) => !item.isHere);
  const summaryParts = [
    upcoming.length ? `${upcoming.length} upcoming` : "",
    allItems.length - upcoming.length ? `${allItems.length - upcoming.length} past` : ""
  ].filter(Boolean);
  const summary = summaryParts.join(" · ") || `${allItems.length} remembered`;
  return `<section class="memory-section" aria-label="Nearcast memory">` +
    `<div class="ai-section-title memory-section-title">` +
      `<strong>Memory</strong>` +
      `<span>${escapeHtml(summary)}</span>` +
      `<button class="memory-manage-btn" type="button" data-memory-open>Manage</button>` +
    `</div>` +
    (items.length
      ? renderPlanMemoryGroup("Here", here) + renderPlanMemoryGroup("Elsewhere", elsewhere)
      : `<p class="memory-empty-inline">No upcoming memories. Past memories are still in Manage.</p>`) +
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

function renderGlobalMemoryCard({ memory, event, isHere, isPast }) {
  const where = placeLabel(memory.place);
  const when = `${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  const meta = event
    ? planMemoryMeta(memory, event)
    : `${when} · ${where}`;
  const original = String(memory.original || "").trim();
  return `
    <article class="memory-card global-memory-card${isPast ? " is-past" : ""}${isHere ? " is-here" : ""}">
      <button class="memory-main global-memory-main" type="button" data-memory-detail="${escapeHtml(memory.id)}" aria-label="${escapeHtml(`Inspect ${planMemoryTitle(memory)}`)}">
        <span class="global-memory-kicker">${escapeHtml(isHere ? "Current place" : where)}</span>
        <strong>${escapeHtml(planMemoryTitle(memory))}</strong>
        <span>${escapeHtml(meta)}</span>
        ${original ? `<em>${escapeHtml(original)}</em>` : ""}
      </button>
      <div class="memory-actions global-memory-actions">
        ${isPast ? "" : `<button type="button" data-memory-show="${escapeHtml(memory.id)}">${isHere ? "Show" : "Load"}</button>`}
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit</button>
        <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
      </div>
    </article>
  `;
}

function renderGlobalMemoryGroup(label, items, options = {}) {
  if (!items.length) return "";
  const { sub = "" } = options;
  return `
    <section class="global-memory-group">
      <div class="memory-group-title global-memory-group-title">
        <span>${escapeHtml(label)}</span>
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ""}
      </div>
      <div class="memory-list global-memory-list">
        ${items.map(renderGlobalMemoryCard).join("")}
      </div>
    </section>
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
  const placeCount = new Set(state.planMemories.map(planMemoryPlaceKey)).size;

  els.memorySheetSummary.innerHTML = `
    <div class="memory-summary-stat"><strong>${state.planMemories.length}</strong><span>remembered</span></div>
    <div class="memory-summary-stat"><strong>${upcoming.length}</strong><span>upcoming</span></div>
    <div class="memory-summary-stat"><strong>${placeCount}</strong><span>${placeCount === 1 ? "place" : "places"}</span></div>
  `;

  if (!state.planMemories.length) {
    els.memorySheetBody.innerHTML = `
      <section class="memory-empty-state">
        <strong>No memories yet</strong>
        <p>Ask the Planner about a real plan, then remember it when the answer looks right.</p>
        <button type="button" data-memory-new>Open Planner</button>
      </section>
    `;
    return;
  }

  const otherHtml = otherGroups.map((group) =>
    renderGlobalMemoryGroup(group.label, group.items, { sub: `${group.items.length} upcoming` })
  ).join("");

  els.memorySheetBody.innerHTML =
    renderGlobalMemoryGroup("Current place", here, {
      sub: state.activePlace ? placeLabel(state.activePlace) : ""
    }) +
    otherHtml +
    renderGlobalMemoryGroup("Past", past, { sub: "kept locally until you forget them" }) +
    `<button class="memory-new-btn" type="button" data-memory-new>Plan something new</button>`;
}

function openGlobalMemorySheet() {
  if (!els.memorySheet || !els.memoryBackdrop) return;
  renderGlobalMemorySheet();
  els.memoryBackdrop.hidden = false;
  els.memorySheet.hidden = false;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  showSheet(els.memoryBackdrop, els.memorySheet);
  document.body.style.overflow = "hidden";
}

function refreshOpenGlobalMemorySheet() {
  if (!els.memorySheet || els.memorySheet.hidden) return;
  renderGlobalMemorySheet();
}

function refreshPlanMemorySurfaces() {
  renderBriefing();
  renderPlanPulse();
  renderForecastMemorySurfaces();
  refreshOpenGlobalMemorySheet();
  if (typeof refreshOpenDayDetailMemorySurfaces === "function") {
    refreshOpenDayDetailMemorySurfaces();
  }
}

function closeGlobalMemorySheet() {
  if (!els.memorySheet || !els.memoryBackdrop || els.memorySheet.hidden) return;
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
  const days = (c?.daily || []).slice(0, 5).map((day, index) => ({
    label: day.label || (index === 0 ? "Today" : index === 1 ? "Tomorrow" : `Day ${index + 1}`),
    dayIdx: index
  }));
  return {
    type: "day",
    plan,
    prompt: `Which day should I use for ${label}?`,
    options: days
  };
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
      { label: "Change day", field: "day" },
      { label: "Change time", field: "time" },
      { label: "Change place", field: "location" }
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
    rainChance: Math.round(Math.max(...pop)),
    precipTotal: precip.reduce((sum, item) => sum + Number(item || 0), 0),
    windMax: Math.round(Math.max(...wind)),
    gustMax: Math.round(Math.max(...gust)),
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

function planVerdict(score, tone) {
  if (tone === "warning") return "High-risk";
  if (tone === "watch") return "Watch closely";
  if (score >= 80) return "Looks good";
  if (score >= 65) return "Pretty good";
  if (score >= 45) return "Iffy";
  return "Not ideal";
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

function planAdvice(stats, alert, score) {
  if (alert) {
    const tone = alertTone(alert);
    if (tone === "warning") return "Check local guidance before you go.";
    if (tone === "watch") return "Keep a backup plan and stay weather-aware.";
    return "Keep an eye on the alert details.";
  }
  if (stats.stormPotential) return "Have a delay or indoor fallback.";
  if (stats.rainChance >= 55) return "Bring rain gear and expect interruptions.";
  if (stats.aqiMax >= 151) return "Air quality is rough enough to consider moving it indoors.";
  if (stats.aqiMax >= 101) return "Sensitive folks may want a shorter window or an indoor backup.";
  if (stats.pollenRank >= 4) return "Allergy-sensitive people should plan ahead.";
  if (stats.uvMax >= 8) return "Sunscreen earns its spot in the bag.";
  if (score >= 70) return "Weather is mostly behaving for this one.";
  return "I would keep a backup option handy.";
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
    rainChance: Math.round(Math.max(...pop)),
    precipTotal: precip.reduce((sum, item) => sum + Number(item || 0), 0),
    windMax: Math.round(Math.max(...wind)),
    gustMax: Math.round(Math.max(...gust)),
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

async function answerPresetIntent(intent, question) {
  const c = buildAIContext();
  if (!c) return null;

  if (intent === "plan") {
    const result = await answerPlanRequest(question);
    if (result?.clarification) {
      plannerClarification = result.clarification;
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
      <div class="ask-confirm" aria-label="Planner interpretation confirmation">
        <div class="ask-confirm-head">
          <strong>Confirm the plan</strong>
          <small>Nearcast read your text this way</small>
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
  return `<div class="ask-clarify" aria-label="Planner follow-up choices">` +
    pending.options.map((option, index) =>
      `<button class="ask-clarify-chip" type="button" data-ask-clarify="${index}"${disabledAttr}>${escapeHtml(option.label)}</button>`
    ).join("") +
  `</div>`;
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
  const bestCards = buildBestWindowCards().map((card) =>
    `<button class="best-window-card" type="button" data-ask-q="${escapeHtml(card.q)}"` +
      `${card.intent ? ` data-ask-intent="${escapeHtml(card.intent)}"` : ""}${dis}>` +
      `<span class="best-window-copy">` +
        `<span class="best-window-top">` +
          `<strong>${escapeHtml(card.title)}</strong>` +
          `<span class="best-window-badge">${escapeHtml(card.badge)}</span>` +
        `</span>` +
        `<em>${escapeHtml(card.window)}</em>` +
        `<small>${escapeHtml(card.meta)}</small>` +
      `</span>` +
    `</button>`
  ).join("");

  const chips = ACTIVITY_CHIPS.map((c) => {
    if (c.template) {
      return `<button class="ask-chip ask-template-chip" type="button" ` +
        `data-ask-template="${escapeHtml(c.template)}"${dis}>${escapeHtml(c.label)}</button>`;
    }
    return `<button class="ask-chip" type="button" data-ask-q="${escapeHtml(c.q)}"` +
      `${c.intent ? ` data-ask-intent="${escapeHtml(c.intent)}"` : ""}${dis}>${escapeHtml(c.label)}</button>`;
  }).join("");

  const thread = askThread.map((ex, i) => {
    const streaming = askStreaming && i === askThread.length - 1;
    const showAction = ex.event && !streaming
      ? `<button class="ask-show" type="button" data-ask-show="${i}">Show me</button>`
      : "";
    const rememberedId = ex.event && !streaming ? (ex.memoryId || rememberedPlanIdForEvent(ex.event)) : "";
    const memoryAction = ex.event && !streaming
      ? rememberedId
        ? `<span class="ask-memory-state">Remembered</span>` +
          `<button class="ask-memory-btn" type="button" data-memory-edit="${escapeHtml(rememberedId)}">Edit</button>` +
          `<button class="ask-memory-btn" type="button" data-memory-forget="${escapeHtml(rememberedId)}">Forget</button>`
        : `<button class="ask-memory-btn primary" type="button" data-memory-remember="${i}">Remember</button>` +
          `<button class="ask-memory-btn" type="button" data-memory-edit="${i}">Edit</button>`
      : "";
    return `<div class="ask-exchange${streaming ? " answering" : ""}">` +
      `<p class="ask-q">${escapeHtml(ex.q)}</p>` +
      `<p class="ask-a">${escapeHtml(ex.a)}</p>` +
      ((showAction || memoryAction) ? `<div class="ask-exchange-actions">${showAction}${memoryAction}</div>` : "") +
    `</div>`;
  }).join("");
  const errLine = askError ? `<p class="ask-err">${escapeHtml(askError)}</p>` : "";
  const clarification = renderPlannerClarification(dis);

  panel.innerHTML =
    memorySection +
    (bestCards ? `<section class="best-windows" aria-label="Weather windows">` +
      `<div class="ai-section-title"><strong>Weather windows</strong><span>Forecast-grounded</span></div>` +
      `<div class="best-window-grid">${bestCards}</div>` +
    `</section>` : "") +
    `<section class="plan-presets" aria-label="Plan presets">` +
      `<div class="ai-section-title"><strong>Plan something</strong><span>Templates, no guesses</span></div>` +
      `<div class="ask-chips">${chips}</div>` +
      `<p class="ask-helper">Tap a template, then add the day, time, and place if it is away from here.</p>` +
    `</section>` +
    (thread ? `<div class="ask-thread">${thread}${errLine}${clarification}</div>` : clarification) +
    `<form class="ask-form" id="askForm">` +
      `<input id="askInput" type="text" autocomplete="off" ` +
        `placeholder="golf Saturday morning in Silvis"${dis}>` +
      `<button type="submit" class="ask-send" aria-label="Ask"${dis}>↑</button>` +
    `</form>`;
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
  return ["Planner", place, title].filter(Boolean).join(" · ");
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
      aiState.phase === "idle" ? "Local AI available · optional summary"
      : aiState.phase === "unsupported" ? "Forecast-grounded planning"
      : aiState.phase === "error" ? "Planner works · summary needs attention"
      : "Local AI · forecast-grounded";
  }
}

function openAISheet(options = {}) {
  const { restoreScroll = null, autoBrief = true } = options;
  els.aiBackdrop.hidden = false;
  els.aiSheet.hidden = false;
  setSheetScrollAnchor(els.aiSheet);
  showSheet(els.aiBackdrop, els.aiSheet);
  document.body.style.overflow = "hidden";
  if (restoreScroll !== null && restoreScroll !== undefined) {
    requestAnimationFrame(() => {
      els.aiSheet.scrollTop = restoreScroll;
    });
  }
  // Auto-generate the briefing the first time it's opened for a place.
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
