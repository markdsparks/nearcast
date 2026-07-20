/* Nearcast weather truth helpers shared by planner, watched plans, and future notifications. */

function weatherTruthCapitalize(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function weatherTruthEscapeHtml(value) {
  if (typeof escapeHtml === "function") return escapeHtml(value);
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function weatherTruthCleanText(value, maxLength = 240) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function weatherTruthCleanToken(value, maxLength = 64) {
  return weatherTruthCleanText(value, maxLength)
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function planWatchNotificationTargetUrl({
  target = "",
  memoryId = "",
  placeId = "",
  detail = "",
  signal = "",
  timeScope = "",
  mode = "",
  source = "plan-watch-evaluator",
  receipt = null
} = {}) {
  const params = new URLSearchParams();
  const cleanMemoryId = weatherTruthCleanText(memoryId, 96);
  const cleanPlaceId = weatherTruthCleanText(placeId, 96);
  params.set("nearcast", "notification");
  params.set("target", weatherTruthCleanToken(target, 32) || (cleanMemoryId ? "plan" : cleanPlaceId ? "place" : "watching"));
  if (cleanMemoryId) params.set("memoryId", cleanMemoryId);
  if (cleanPlaceId) params.set("placeId", cleanPlaceId);
  if (detail) params.set("detail", weatherTruthCleanToken(detail, 32));
  if (signal) params.set("signal", weatherTruthCleanToken(signal, 64));
  if (timeScope) params.set("timeScope", weatherTruthCleanToken(timeScope, 32));
  if (mode) params.set("mode", weatherTruthCleanToken(mode, 40));
  if (source) params.set("source", weatherTruthCleanToken(source, 64));
  if (receipt && typeof receipt === "object") {
    const metric = receipt.metric && typeof receipt.metric === "object" ? receipt.metric : {};
    const receiptParams = {
      receiptKind: weatherTruthCleanToken(receipt.kind, 48),
      receiptTone: weatherTruthCleanToken(receipt.tone, 24),
      receiptDirection: weatherTruthCleanToken(receipt.direction, 16),
      receiptHeadline: weatherTruthCleanText(receipt.headline, 120),
      receiptMetric: weatherTruthCleanText(metric.label, 48),
      receiptBefore: weatherTruthCleanText(metric.before, 48),
      receiptAfter: weatherTruthCleanText(metric.after, 48),
      receiptUnit: weatherTruthCleanText(metric.unit, 16),
      receiptWhy: weatherTruthCleanText(receipt.why, 180),
      receiptAction: weatherTruthCleanText(receipt.action, 180),
      receiptBaselineAt: String(weatherTruthTimestamp(receipt.baselineAt) || ""),
      receiptCheckedAt: String(weatherTruthTimestamp(receipt.checkedAt) || "")
    };
    Object.entries(receiptParams).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
  }
  return `./?${params.toString()}`;
}

function planWeatherNotificationDetail(type = "") {
  const value = weatherTruthCleanToken(type, 64).toLowerCase();
  if (value.includes("alert")) return "alerts";
  if (value.includes("heat")) return "feels";
  if (value.includes("wind")) return "wind";
  if (value.includes("rain") || value.includes("storm") || value.includes("clearing") || value.includes("precip")) return "rain";
  return "";
}

function weatherTruthDegree(unit) {
  if (typeof degree === "function") return degree(unit);
  return `°${unit}`;
}

function weatherTruthUnitPreference() {
  return typeof state !== "undefined" && state?.unit === "fahrenheit" ? "fahrenheit" : "celsius";
}

function planWeatherUnitFromItem(item = {}) {
  if (item.unit === "celsius" || item.unit === "fahrenheit") return item.unit;
  const tempUnit = String(item.units?.temp || item.tempUnit || "").toLowerCase();
  if (tempUnit.includes("c")) return "celsius";
  if (tempUnit.includes("f")) return "fahrenheit";
  return weatherTruthUnitPreference();
}

function planWatchCompactText(value, limit = 98) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function planWeatherAlertName(value) {
  return weatherTruthCleanText(value || "Weather alert", 96) || "Weather alert";
}

function planWeatherAlertChangeTitle(planTitle, alertName, cleared = false) {
  const title = planTitle || "Plan";
  const event = planWeatherAlertName(alertName);
  return planWatchCompactText(`${title}: ${event} ${cleared ? "cleared" : "overlaps plan"}`, 92);
}

function planWeatherAlertChangeBody(alertName, cleared = false) {
  const event = planWeatherAlertName(alertName);
  return cleared
    ? `${event} no longer overlaps this plan window.`
    : `${event} overlaps this plan window.`;
}

function planConditionRiskKind(stats = {}, alert = null, text = "", unit = weatherTruthUnitPreference()) {
  const preference = unit === "celsius" ? "celsius" : "fahrenheit";
  const precipThreshold = preference === "fahrenheit" ? 0.02 : 0.5;
  const windThreshold = preference === "fahrenheit" ? 25 : 40;
  const coldThreshold = preference === "fahrenheit" ? 40 : 4;
  const heatThreshold = preference === "fahrenheit" ? 88 : 31;
  const alertText = [
    alert?.event,
    alert?.headline,
    alert?.description,
    alert?.instruction,
    text
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\b(excessive heat|extreme heat|heat warning|heat advisory|heat|hot|humid|uv|sun|sunscreen)\b/.test(alertText)) return "heat";
  if (/\b(thunder|lightning|hail|tornado|severe thunderstorm)\b/.test(alertText)) return "storm";
  if (/\b(flood|flash flood|heavy rain|downpour)\b/.test(alertText)) return "flood";
  if (/\b(high wind|wind advisory|strong wind|gust)\b/.test(alertText)) return "wind";
  if (/\b(aqi|air quality|smoke)\b/.test(alertText)) return "air";
  if (/\b(pollen|allerg)\b/.test(alertText)) return "pollen";
  if (/\b(cold|freeze|frost|snow|ice|winter)\b/.test(alertText)) return "cold";
  if (stats.stormPotential) return "storm";
  if (stats.rainChance >= 35 || stats.precipTotal > precipThreshold) return "rain";
  if (stats.gustMax >= windThreshold) return "wind";
  if (stats.aqiMax >= 101) return "air";
  if (stats.pollenRank >= 3) return "pollen";
  const feels = Number.isFinite(Number(stats.feelsAvg)) ? Number(stats.feelsAvg) : Number(stats.feelsMax);
  if (feels <= coldThreshold) return "cold";
  if (feels >= heatThreshold || stats.uvMax >= 8) return "heat";
  return "good";
}

function planWatchRiskKind(item) {
  return planConditionRiskKind(
    item?.stats || {},
    item?.alert || null,
    [item?.primaryReason, item?.advice, item?.label, item?.reason].filter(Boolean).join(" "),
    planWeatherUnitFromItem(item)
  );
}

function planWatchLabel(item) {
  if (!item) return "Waiting on forecast";
  if (item.isPast) return "Past";
  const risk = planWatchRiskKind(item);
  if (item.alertTone === "warning" || item.alertTone === "watch" || item.tone === "watch") {
    if (risk === "heat") return "Plan around heat";
    if (risk === "storm") return item.alert ? "Weather alert overlaps" : "Keep an eye on it";
    if (risk === "flood" || risk === "rain") return "Expect rain";
    if (risk === "wind") return "Wind may matter";
    if (risk === "air") return "Air may matter";
    if (risk === "pollen") return "Allergies may matter";
    if (risk === "cold") return "Plan around cold";
    if (item.alert) return "Weather alert overlaps";
    return "Keep an eye on it";
  }
  if (item.tone === "caution") {
    if (risk === "heat") return "Plan around heat";
    if (risk === "rain" || risk === "flood") return "Keep an eye on rain";
    if (risk === "wind") return "Wind may matter";
    if (risk === "air") return "Air may matter";
    if (risk === "cold") return "Plan around cold";
    return "Keep an eye on it";
  }
  return "Looks good";
}

function planWatchFullReason(item) {
  if (!item) return "";
  return weatherTruthCapitalize(String(item.primaryReason || item.reasons?.[0] || "weather looks manageable").replace(/[.!?]+$/, ""));
}

function planWatchReason(item) {
  return planWatchCompactText(planWatchFullReason(item));
}

function planWatchActionText(item) {
  if (!item || item.isPast) return "";
  if (item.change) return "Check the hourly timing before you go.";
  if (item.tone === "good") return "";
  const stats = item.stats || {};
  const risk = planWatchRiskKind(item);
  if (risk === "heat") {
    if ((stats.feelsMax ?? stats.feelsAvg ?? 0) >= 100 || item.alertTone === "warning") {
      return "Plan shade, water, cooling breaks, and an indoor option if needed.";
    }
    return "Bring water and plan shade during the hottest part.";
  }
  if (risk === "storm") return "Keep an indoor or delay option if thunder gets close.";
  if (risk === "flood") return "Avoid low spots and check routes before you leave.";
  if (risk === "rain") {
    if ((stats.rainChance || 0) >= 60) return "Bring rain gear and expect possible interruptions.";
    return "Keep rain gear close and watch the timing.";
  }
  if (risk === "wind") return "Secure loose items and choose a less exposed setup.";
  if (risk === "air") return "Limit strenuous outdoor time, especially for sensitive people.";
  if (risk === "pollen") return "Allergy-sensitive people should plan ahead.";
  if (risk === "cold") return "Add layers and keep the outdoor window flexible.";
  if (item.alert) return "Check local guidance and keep the plan flexible.";
  return item.advice || "Keep an alternate window or location handy.";
}

function planVerdict(score, tone) {
  if (tone === "warning") return "High-risk";
  if (tone === "watch") return "Watch closely";
  if (score >= 80) return "Looks good";
  if (score >= 65) return "Pretty good";
  if (score >= 45) return "Iffy";
  return "Not ideal";
}

function planBriefingTone(item) {
  const unit = planWeatherUnitFromItem(item);
  if (item?.alertTone === "warning" || item?.alertTone === "watch") return "watch";
  if (item?.score < 45 || item?.stats?.stormPotential) return "watch";
  if (item?.score < 65 || item?.stats?.rainChance >= 35 || item?.stats?.gustMax >= planWeatherWindCautionThreshold(unit)) return "caution";
  return "good";
}

function planBriefingPriority(item) {
  const alertWeight = item?.alertTone === "warning" ? 80 :
    item?.alertTone === "watch" ? 65 :
      item?.alertTone === "advisory" ? 42 : 0;
  const rainWeight = item?.stats?.stormPotential ? 35 : Math.min(35, Math.max(0, item?.stats?.rainChance || 0) / 2);
  const windWeight = Math.max(0, (item?.stats?.gustMax || 0) - 18);
  const scoreWeight = Math.max(0, 75 - (item?.score ?? 75));
  return alertWeight + rainWeight + windWeight + scoreWeight;
}

function planBriefingReason(item) {
  const reasons = item?.reasons || [];
  const stats = item?.stats || {};
  const units = item?.units || {};
  if (item?.alert) return reasons[0] || `${item.alert.event} overlaps that window`;
  if (stats.stormPotential) return "thunderstorms are possible";
  if (stats.rainChance >= 35) return `${stats.rainChance}% rain chance`;
  if (stats.gustMax >= 25) return `gusts near ${stats.gustMax} ${units.wind || ""}`.trim();
  if (stats.uvMax >= 8) return `UV up to ${stats.uvMax}`;
  if (stats.aqiMax >= 101) return `AQI ${stats.aqiMax}`;
  return reasons[0] || "weather looks manageable";
}

function weatherTruthAlertTone(alert) {
  if (!alert) return "";
  if (typeof alertTone === "function") return alertTone(alert);
  if (alert.tone) return String(alert.tone).toLowerCase();
  const event = String(alert.event || alert.headline || "").toLowerCase();
  if (event.includes("warning")) return "warning";
  if (event.includes("watch")) return "watch";
  if (event.includes("advisory")) return "advisory";
  const severity = String(alert.severity || "").toLowerCase();
  if (severity === "extreme" || severity === "severe") return "warning";
  if (severity === "moderate" || severity === "minor") return "advisory";
  return alert ? "notice" : "";
}

function planAdvice(stats = {}, alert = null, score = 100, alertSignal = null, unit = weatherTruthUnitPreference()) {
  const risk = planConditionRiskKind(stats, alert, "", unit);
  if (alert) {
    const tone = alertSignal || weatherTruthAlertTone(alert);
    if (risk === "heat") return "Plan shade, water, breaks, and an indoor option if people need it.";
    if (risk === "storm") return "Keep an indoor option and a way to delay if lightning or warnings arrive.";
    if (risk === "flood") return "Avoid low spots and keep a different route or window available.";
    if (risk === "wind") return "Secure loose items and avoid exposed setups.";
    if (risk === "air") return "Sensitive folks may want shorter outdoor time or an indoor option.";
    if (risk === "cold") return "Add warm layers and a shorter outdoor window.";
    if (tone === "warning") return "Check local guidance and adjust the plan before you go.";
    if (tone === "watch") return "Stay weather-aware and keep an alternate window or location available.";
    return "Keep an eye on the official alert details.";
  }
  if (stats.stormPotential) return "Have a delay or indoor fallback.";
  if (stats.rainChance >= 55) return "Bring rain gear and expect interruptions.";
  if (stats.aqiMax >= 151) return "Air quality is rough enough to consider moving it indoors.";
  if (stats.aqiMax >= 101) return "Sensitive folks may want a shorter window or an indoor backup.";
  if (stats.pollenRank >= 4) return "Allergy-sensitive people should plan ahead.";
  if (stats.uvMax >= 8) return "Sunscreen earns its spot in the bag.";
  if (score >= 70) return "Weather is mostly behaving for this one.";
  return "Keep an alternate window or location handy.";
}

function weatherTruthNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function weatherTruthTimestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.round(number);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function weatherTruthDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}

function weatherTruthIsPlausibleHeatValue(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  const normalizedUnit = String(unit || "").toLowerCase();
  if (normalizedUnit.includes("c")) return number >= 10 && number <= 65;
  return number >= 50 && number <= 150;
}

function weatherTruthScoreBand(score) {
  if (score >= 65) return "good";
  if (score >= 45) return "iffy";
  return "poor";
}

function weatherTruthWindDeltaThreshold(unit) {
  return unit === "mph" ? 8 : 13;
}

function weatherTruthWindNotableThreshold(unit) {
  return unit === "mph" ? 24 : 39;
}

function weatherTruthDisplayTempUnit(unit) {
  if (!unit) return "";
  return unit.startsWith("°") ? unit : weatherTruthDegree(unit);
}

function planWeatherUnits(unit = weatherTruthUnitPreference()) {
  const preference = unit === "celsius" ? "celsius" : "fahrenheit";
  return {
    temp: weatherTruthDegree(preference === "fahrenheit" ? "F" : "C"),
    wind: preference === "fahrenheit" ? "mph" : "km/h",
    precip: preference === "fahrenheit" ? "in" : "mm"
  };
}

function planWeatherWindowScore(stats = {}, unit = weatherTruthUnitPreference()) {
  const preference = unit === "celsius" ? "celsius" : "fahrenheit";
  const feelsAvg = Number(stats.feelsAvg ?? stats.feelsMax ?? 0);
  const windMax = Number(stats.windMax ?? 0);
  const gustMax = Number(stats.gustMax ?? windMax ?? 0);
  const rainChance = Number(stats.rainChance ?? 0);
  const precipTotal = Number(stats.precipTotal ?? 0);
  const uvMax = Number(stats.uvMax ?? 0);
  const feelsF = preference === "celsius" ? (feelsAvg * 9) / 5 + 32 : feelsAvg;
  const windMph = preference === "celsius" ? windMax / 1.609344 : windMax;
  const gustMph = preference === "celsius" ? gustMax / 1.609344 : gustMax;
  const target = 72;
  const tempPenalty = Math.abs(feelsF - target) * 0.8;
  const rainPenalty = rainChance * 1.2 + precipTotal * 80;
  const windPenalty = Math.max(0, windMph - 24) * 2 + Math.max(0, gustMph - 32) * 2;
  const uvPenalty = Math.max(0, uvMax - 8 + 1) * 5;
  return Math.round(100 - tempPenalty - rainPenalty - windPenalty - uvPenalty);
}

function planWeatherWindCautionThreshold(unit = weatherTruthUnitPreference()) {
  return unit === "celsius" ? 40 : 25;
}

function planWeatherWatchCurrentState(plan = {}, stats = {}, alert = null, unit = weatherTruthUnitPreference()) {
  const preference = unit === "celsius" ? "celsius" : "fahrenheit";
  const alertToneValue = weatherTruthAlertTone(alert);
  const score = planWeatherWindowScore(stats, preference);
  const tone = alertToneValue === "warning" || alertToneValue === "watch" || score < 45 || stats.stormPotential
    ? "watch"
    : score < 65 || stats.rainChance >= 35 || stats.gustMax >= planWeatherWindCautionThreshold(preference) ? "caution" : "good";
  const truth = planWeatherTruth({
    title: plan.title || "Plan",
    targetDate: plan.targetDate || "",
    startHour: plan.startHour,
    endHour: plan.endHour,
    stats,
    units: planWeatherUnits(preference),
    score,
    tone,
    alert,
    alertTone: alertToneValue,
    status: "ready"
  }) || {};
  const fullReason = truth.fullReason || planWatchFullReason({ stats, alert, primaryReason: truth.primaryReason });
  const bodyReason = fullReason ? String(fullReason).replace(/[.!?]+$/, "") : "Weather changed for this plan";
  const snapshot = planWeatherChangeSnapshot({
    title: plan.title || "Plan",
    targetDate: plan.targetDate || "",
    startHour: plan.startHour,
    endHour: plan.endHour,
    stats,
    units: planWeatherUnits(preference),
    score,
    tone: truth.tone || tone,
    verdict: truth.verdict,
    alert,
    alertTone: alertToneValue,
    riskKind: truth.riskKind
  });
  return {
    signal: alert ? "plan-alert" : (truth.tone || tone),
    tone: truth.tone || tone,
    label: truth.label || planWatchLabel({ stats, alert, tone }),
    reason: truth.reason || bodyReason,
    body: `${truth.label || "Plan watch"}: ${bodyReason}.`,
    receipt: truth.receipt || planWeatherReceiptText({ stats, alert, ...truth }),
    snapshot,
    alert,
    truth
  };
}

function planWeatherWatchStateChange(previousLastKnown = {}, current = {}) {
  const previous = previousLastKnown?.snapshot || null;
  const currentSnapshot = current?.snapshot || null;
  if (!currentSnapshot) return { updateBaseline: false, notify: false };

  if (!previous) {
    const hadAlert = /alert|warning|watch|advisory/i.test([
      previousLastKnown?.signal,
      previousLastKnown?.label,
      previousLastKnown?.reason,
      previousLastKnown?.body
    ].filter(Boolean).join(" "));
    if (currentSnapshot.alertTone && !hadAlert) {
      const title = currentSnapshot.title || "Plan";
      const alertName = currentSnapshot.alertEvent || "A weather alert";
      const tone = currentSnapshot.alertTone === "warning" || currentSnapshot.alertTone === "watch"
        ? "watch"
        : "caution";
      const initialAlert = {
        type: "plan-alert",
        tone,
        notify: true,
        priority: currentSnapshot.alertTone === "warning" ? 140 : currentSnapshot.alertTone === "watch" ? 125 : 105,
        title: planWeatherAlertChangeTitle(title, alertName),
        body: `${alertName} overlaps this plan window on the first check.`
      };
      return {
        ...planWeatherChangeResult(initialAlert, {}, currentSnapshot, {
          direction: "changed",
          metricLabel: "Official alert",
          before: "First check",
          after: alertName,
          why: "An official weather alert was already present when Nearcast first checked this plan.",
          action: "Open the alert details and adjust the plan if needed."
        }),
        updateBaseline: true
      };
    }
    return { type: "baseline", notify: false, updateBaseline: true, priority: 0 };
  }

  const change = planWeatherChange(previous, currentSnapshot);
  return change ? { ...change, updateBaseline: true } : { updateBaseline: false, notify: false };
}

function planWeatherLastKnownFromState(plan = {}, current = {}, change = {}, checkedAt = new Date().toISOString()) {
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
    checkedAt,
    snapshot: current.snapshot
  };
}

function planWeatherNotificationCandidate(plan = {}, current = {}, change = {}) {
  const signal = change.type || current.signal || "plan-watch";
  const detail = planWeatherNotificationDetail(signal);
  return {
    type: signal,
    priority: change.priority || 50,
    notification: {
      title: change.title || `Nearcast: ${plan.title || "Watched plan"}`,
      body: change.body || current.body || "Weather changed for this plan.",
      tag: `nearcast-plan-${weatherTruthCleanToken(plan.id, 80)}`,
      renotify: false,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      url: planWatchNotificationTargetUrl({
        target: "plan",
        memoryId: plan.id || "",
        detail,
        signal,
        timeScope: "plan-window",
        source: "plan-watch-evaluator",
        receipt: change.receipt || null
      }),
      memoryId: plan.id || "",
      target: "plan",
      detail,
      signal,
      timeScope: "plan-window",
      source: "plan-watch-evaluator",
      receipt: change.receipt || null
    }
  };
}

function planWeatherChangeSnapshot(item) {
  if (!item) return null;
  const stats = item.stats || {};
  const units = item.units || {};
  return {
    title: item.title || item.memory?.title || item.label || "Plan",
    targetDate: item.targetDate || item.memory?.targetDate || "",
    startHour: weatherTruthNumber(item.startHour ?? item.memory?.startHour),
    endHour: weatherTruthNumber(item.endHour ?? item.memory?.endHour),
    rainChance: weatherTruthNumber(stats.rainChance ?? item.rainChance),
    gustMax: weatherTruthNumber(stats.gustMax ?? stats.windMax ?? item.gustMax),
    windUnit: item.windUnit || units.wind || "",
    feelsMax: weatherTruthNumber(stats.feelsMax ?? stats.feelsAvg ?? item.feelsMax ?? item.feels),
    tempUnit: weatherTruthDisplayTempUnit(item.tempUnit || units.temp || ""),
    score: weatherTruthNumber(item.score),
    tone: item.tone || "",
    verdict: item.verdict || "",
    alertTone: item.alertTone || weatherTruthAlertTone(item.alert),
    alertEvent: item.alert?.event || item.alertEvent || "",
    riskKind: item.riskKind || planWatchRiskKind(item),
    savedAt: weatherTruthTimestamp(item.savedAt),
    checkedAt: weatherTruthTimestamp(item.checkedAt)
  };
}

function planWeatherChangeReceipt(change = {}, previous = {}, current = {}, detail = {}) {
  const type = weatherTruthCleanToken(change.type || detail.kind || "plan-change", 48) || "plan-change";
  const direction = detail.direction === "better" ? "better" : detail.direction === "worse" ? "worse" : "changed";
  return {
    version: 1,
    kind: type,
    tone: change.tone || "caution",
    direction,
    headline: weatherTruthCleanText(change.title || detail.headline || "Forecast changed", 120),
    metric: {
      label: weatherTruthCleanText(detail.metricLabel || "Forecast", 48),
      before: weatherTruthCleanText(detail.before || "Previous", 48),
      after: weatherTruthCleanText(detail.after || "Now", 48),
      unit: weatherTruthCleanText(detail.unit || "", 16)
    },
    why: weatherTruthCleanText(detail.why || "The forecast changed during this plan window.", 180),
    action: weatherTruthCleanText(detail.action || "Review the plan window before you go.", 180),
    baselineAt: weatherTruthTimestamp(previous.savedAt || previous.checkedAt),
    checkedAt: weatherTruthTimestamp(current.savedAt || current.checkedAt)
  };
}

function planWeatherChangeResult(change, previous, current, detail) {
  return {
    ...change,
    receipt: planWeatherChangeReceipt(change, previous, current, detail)
  };
}

function samePlanWeatherWindow(previous, current) {
  if (!previous || !current) return false;
  if (previous.targetDate && current.targetDate && previous.targetDate !== current.targetDate) return false;
  if (previous.startHour !== null && current.startHour !== null && previous.startHour !== current.startHour) return false;
  if (previous.endHour !== null && current.endHour !== null && previous.endHour !== current.endHour) return false;
  return true;
}

function planWeatherChange(previousItem, currentItem) {
  const previous = planWeatherChangeSnapshot(previousItem);
  const current = planWeatherChangeSnapshot(currentItem);
  if (!previous || !current || !samePlanWeatherWindow(previous, current)) return null;
  const title = current.title || previous.title || "Plan";
  const candidates = [];

  if (
    current.alertTone &&
    current.alertTone !== "none" &&
    (current.alertTone !== previous.alertTone || current.alertEvent !== previous.alertEvent)
  ) {
    const tone = current.alertTone === "warning" || current.alertTone === "watch" ? "watch" : "caution";
    const alertName = current.alertEvent || "A weather alert";
    const change = {
      type: "plan-alert",
      tone,
      notify: true,
      priority: current.alertTone === "warning" ? 140 : current.alertTone === "watch" ? 125 : 105,
      title: planWeatherAlertChangeTitle(title, alertName),
      body: planWeatherAlertChangeBody(alertName)
    };
    candidates.push(planWeatherChangeResult(change, previous, current, {
      direction: "worse",
      metricLabel: "Official alert",
      before: previous.alertEvent || "No overlap",
      after: alertName,
      why: "An official weather alert now overlaps this plan window.",
      action: "Open the alert details and adjust the plan if needed."
    }));
  }

  if (previous.alertTone && !current.alertTone) {
    const change = {
      type: "plan-alert-ended",
      tone: "good",
      notify: false,
      priority: 45,
      title: planWeatherAlertChangeTitle(title, previous.alertEvent, true),
      body: planWeatherAlertChangeBody(previous.alertEvent || "The weather alert", true)
    };
    candidates.push(planWeatherChangeResult(change, previous, current, {
      direction: "better",
      metricLabel: "Official alert",
      before: previous.alertEvent || "Alert overlap",
      after: "No overlap",
      why: "The official alert no longer overlaps this plan window.",
      action: "Keep the plan, but check once more before you go."
    }));
  }

  const rainDelta = weatherTruthDelta(current.rainChance, previous.rainChance);
  if (rainDelta !== null && Math.abs(rainDelta) >= 20 && Math.max(current.rainChance, previous.rainChance) >= 35) {
    const wetter = rainDelta > 0;
    const change = {
      type: "plan-rain",
      tone: wetter ? "watch" : "good",
      notify: wetter,
      priority: 90 + Math.abs(rainDelta),
      title: `${title} ${wetter ? "got wetter" : "got drier"}`,
      body: `Rain now ${current.rainChance}%, ${wetter ? "up" : "down"} from ${previous.rainChance}%.`
    };
    candidates.push(planWeatherChangeResult(change, previous, current, {
      direction: wetter ? "worse" : "better",
      metricLabel: "Rain chance",
      before: `${previous.rainChance}%`,
      after: `${current.rainChance}%`,
      unit: "%",
      why: wetter
        ? "Rain is now more likely during this plan window."
        : "Rain is now less likely during this plan window.",
      action: wetter
        ? "Bring rain cover or keep an indoor backup ready."
        : "The original timing now looks more workable."
    }));
  }

  const heatComparisonReady = current.tempUnit === previous.tempUnit &&
    weatherTruthIsPlausibleHeatValue(current.feelsMax, current.tempUnit) &&
    weatherTruthIsPlausibleHeatValue(previous.feelsMax, previous.tempUnit || current.tempUnit);
  const heatDelta = heatComparisonReady ? weatherTruthDelta(current.feelsMax, previous.feelsMax) : null;
  const seriousHeat = String(current.tempUnit || "").toLowerCase().includes("c") ? 38 : 100;
  const notableHeat = String(current.tempUnit || "").toLowerCase().includes("c") ? 33 : 92;
  const crossedSeriousHeat = heatComparisonReady && previous.feelsMax < seriousHeat && current.feelsMax >= seriousHeat;
  if (
    heatDelta !== null &&
    (crossedSeriousHeat || (Math.abs(heatDelta) >= 5 && Math.max(current.feelsMax, previous.feelsMax) >= notableHeat))
  ) {
    const hotter = heatDelta > 0;
    const change = {
      type: "plan-heat",
      tone: hotter ? (current.feelsMax >= 100 ? "watch" : "caution") : "good",
      notify: hotter,
      priority: (hotter ? 88 : 52) + Math.abs(heatDelta),
      title: `${title} ${hotter ? "got hotter" : "cooled down"}`,
      body: `Feels like now peaks at ${current.feelsMax}${current.tempUnit || ""}, ${hotter ? "up" : "down"} from ${previous.feelsMax}${current.tempUnit || ""}.`
    };
    candidates.push(planWeatherChangeResult(change, previous, current, {
      direction: hotter ? "worse" : "better",
      metricLabel: "Feels-like peak",
      before: `${previous.feelsMax}${current.tempUnit || ""}`,
      after: `${current.feelsMax}${current.tempUnit || ""}`,
      unit: current.tempUnit || "",
      why: hotter
        ? "The hottest part of the forecast now overlaps this plan window."
        : "The heat burden eased during this plan window.",
      action: hotter
        ? "Shift away from peak heat or plan shade, water, and cooling breaks."
        : "The plan is easier on heat, but check conditions before you go."
    }));
  }

  const gustDelta = weatherTruthDelta(current.gustMax, previous.gustMax);
  const windThreshold = weatherTruthWindDeltaThreshold(current.windUnit);
  if (
    current.windUnit === previous.windUnit &&
    gustDelta !== null &&
    Math.abs(gustDelta) >= windThreshold &&
    Math.max(current.gustMax, previous.gustMax) >= weatherTruthWindNotableThreshold(current.windUnit)
  ) {
    const stronger = gustDelta > 0;
    const change = {
      type: "plan-wind",
      tone: stronger ? "caution" : "good",
      notify: stronger,
      priority: 70 + Math.abs(gustDelta),
      title: `${title} ${stronger ? "got windier" : "eased up"}`,
      body: `Gusts now ${current.gustMax} ${current.windUnit}, ${stronger ? "from" : "down from"} ${previous.gustMax} ${current.windUnit}.`
    };
    candidates.push(planWeatherChangeResult(change, previous, current, {
      direction: stronger ? "worse" : "better",
      metricLabel: "Peak gusts",
      before: `${previous.gustMax} ${current.windUnit}`,
      after: `${current.gustMax} ${current.windUnit}`,
      unit: current.windUnit,
      why: stronger
        ? "Stronger gusts now overlap this plan window."
        : "The wind risk eased during this plan window.",
      action: stronger
        ? "Secure loose items and reconsider wind-sensitive activity."
        : "Wind is less limiting, but check once more before you go."
    }));
  }

  const scoreDelta = weatherTruthDelta(current.score, previous.score);
  if (scoreDelta !== null && Math.abs(scoreDelta) >= 18 && weatherTruthScoreBand(current.score) !== weatherTruthScoreBand(previous.score)) {
    const better = scoreDelta > 0;
    const previousBand = weatherTruthScoreBand(previous.score);
    const currentBand = weatherTruthScoreBand(current.score);
    const change = {
      type: "plan-score",
      tone: better ? "good" : "caution",
      notify: !better,
      priority: 55 + Math.abs(scoreDelta),
      title: `${title} looks ${better ? "better" : "iffy now"}`,
      body: `Plan window moved from ${previousBand} to ${currentBand}.`
    };
    candidates.push(planWeatherChangeResult(change, previous, current, {
      direction: better ? "better" : "worse",
      metricLabel: "Plan fit",
      before: weatherTruthCapitalize(previousBand),
      after: weatherTruthCapitalize(currentBand),
      why: better
        ? "The combined weather picture is more workable for this plan."
        : "The combined weather picture crossed into a less workable range.",
      action: better
        ? "The plan looks more workable; check the hourly view before you go."
        : "Review the hourly window and keep a backup option ready."
    }));
  }

  return candidates.sort((a, b) =>
    Number(Boolean(b?.notify)) - Number(Boolean(a?.notify)) ||
    (Number(b?.priority) || 0) - (Number(a?.priority) || 0)
  )[0] || null;
}

function planWeatherNotificationState(item) {
  const change = item?.change || null;
  const alertChange = change?.type === "plan-alert";
  const changeEligible = Boolean(change && change.notify !== false && change.type);
  const eligible = Boolean(
    item &&
    !item.isPast &&
    item.status === "ready" &&
    (changeEligible || alertChange)
  );
  const signal = change?.type || item?.alertTone || item?.tone || item?.label || "watch";
  const body = planWatchCompactText(`${item?.label || "Plan"}: ${change?.body || item?.reason || "Weather changed for this plan."}`, 128);
  const urgency = change?.tone === "watch" || item?.alertTone === "warning" || item?.tone === "watch" ? "attention" : "watch";
  return { eligible, signal, body, urgency };
}

function planReceiptValue(row) {
  if (!row?.label || !row?.value) return "";
  return `${row.label}: ${row.value}`;
}

function planWeatherReceiptLines(item) {
  if (!item?.stats) return [];
  const stats = item.stats;
  const units = item.units || {};
  const risk = planSignalRiskKind(item);
  const temp = units.temp || weatherTruthDegree(weatherTruthUnitPreference() === "fahrenheit" ? "F" : "C");
  const wind = units.wind || (weatherTruthUnitPreference() === "fahrenheit" ? "mph" : "km/h");
  const precip = units.precip || (weatherTruthUnitPreference() === "fahrenheit" ? "in" : "mm");
  const lines = [];

  if (item.alert?.event) {
    lines.push({
      label: "Weather alert",
      value: `${item.alert.event} overlaps this window`,
      kind: "storm"
    });
  }

  if (item.change?.body) {
    lines.push({
      label: "Changed",
      value: item.change.body,
      kind: item.change.tone || item.tone || "caution"
    });
  }

  const reason = planWatchFullReason(item);
  if (reason && !item.alert?.event) {
    lines.push({
      label: "Signal",
      value: reason,
      kind: risk
    });
  }

  const metricRows = {
    heat: [
      { label: "Feels", value: planSignalRangeText(stats.feelsMin ?? stats.feelsAvg, stats.feelsMax ?? stats.feelsAvg, temp), kind: "heat" },
      { label: "Temp", value: planSignalRangeText(stats.tempMin, stats.tempMax, temp), kind: "temp" },
      { label: "UV", value: stats.uvMax > 0 ? planSignalPeakText(stats.uvMax) : "", kind: "sun" }
    ],
    cold: [
      { label: "Feels", value: planSignalRangeText(stats.feelsMin ?? stats.feelsAvg, stats.feelsMax ?? stats.feelsAvg, temp), kind: "cold" },
      { label: "Temp", value: planSignalRangeText(stats.tempMin, stats.tempMax, temp), kind: "temp" },
      { label: "Gusts", value: planSignalPeakText(stats.gustMax || stats.windMax, wind), kind: "wind" }
    ],
    rain: [
      { label: "Rain", value: planSignalChanceRangeText(stats.rainChanceMin ?? stats.rainChance, stats.rainChance), kind: "rain" },
      { label: "Amount", value: planSignalPrecipTotalText(stats.precipTotal, precip), kind: "rain" },
      { label: "Gusts", value: planSignalPeakText(stats.gustMax || stats.windMax, wind), kind: "wind" }
    ],
    storm: [
      { label: "Storms", value: stats.stormPotential ? "Possible" : "Watch", kind: "storm" },
      { label: "Rain", value: planSignalChanceRangeText(stats.rainChanceMin ?? stats.rainChance, stats.rainChance), kind: "rain" },
      { label: "Gusts", value: planSignalPeakText(stats.gustMax || stats.windMax, wind), kind: "wind" }
    ],
    wind: [
      { label: "Gusts", value: planSignalPeakText(stats.gustMax || stats.windMax, wind), kind: "wind" },
      { label: "Wind", value: planSignalUnitRangeText(stats.windMin ?? stats.windMax, stats.windMax, wind), kind: "wind" },
      { label: "Rain", value: planSignalChanceRangeText(stats.rainChanceMin ?? stats.rainChance, stats.rainChance), kind: "rain" }
    ],
    air: [
      { label: "Air", value: stats.aqiMax ? `Peak AQI ${stats.aqiMax}` : (stats.aqiLabel || "Good"), kind: "air" },
      { label: "Feels", value: planSignalRangeText(stats.feelsMin ?? stats.feelsAvg, stats.feelsMax ?? stats.feelsAvg, temp), kind: "heat" }
    ],
    pollen: [
      { label: "Pollen", value: stats.pollenLabel || stats.pollenLevel || "Elevated", kind: "air" },
      { label: "Air", value: stats.aqiMax ? `Peak AQI ${stats.aqiMax}` : (stats.aqiLabel || "Good"), kind: "air" }
    ],
    good: [
      { label: "Rain", value: planSignalChanceRangeText(stats.rainChanceMin ?? stats.rainChance, stats.rainChance), kind: "rain" },
      { label: "Feels", value: planSignalRangeText(stats.feelsMin ?? stats.feelsAvg, stats.feelsMax ?? stats.feelsAvg, temp), kind: "heat" },
      { label: "Gusts", value: planSignalPeakText(stats.gustMax || stats.windMax, wind), kind: "wind" }
    ]
  };

  const seen = new Set(lines.map((line) => String(line.label || "").toLowerCase()));
  (metricRows[risk] || metricRows.good).forEach((line) => {
    const key = String(line.label || "").toLowerCase();
    if (!line.value || seen.has(key)) return;
    seen.add(key);
    lines.push(line);
  });

  return lines.slice(0, 4);
}

function planWeatherReceiptText(item) {
  return planWeatherReceiptLines(item)
    .map(planReceiptValue)
    .filter(Boolean)
    .join(" · ");
}

function planWeatherTruth(item) {
  if (!item) return null;
  const alertToneValue = item.alertTone || weatherTruthAlertTone(item.alert);
  const base = {
    ...item,
    alertTone: alertToneValue,
    advice: item.advice || planAdvice(item.stats || {}, item.alert || null, item.score ?? 100, alertToneValue, planWeatherUnitFromItem(item))
  };
  const tone = item.tone || planBriefingTone(base);
  const verdict = item.verdict || planVerdict(item.score ?? 100, alertToneValue === "warning" ? "warning" : tone);
  base.verdict = verdict;
  const riskKind = planWatchRiskKind({ ...base, tone });
  const primaryReason = item.primaryReason || planBriefingReason({ ...base, tone, riskKind });
  const truth = {
    riskKind,
    alertTone: alertToneValue,
    verdict,
    tone,
    priority: item.priority ?? planBriefingPriority({ ...base, tone, riskKind }),
    primaryReason,
    advice: base.advice
  };
  const resolved = { ...base, ...truth };
  truth.label = planWatchLabel(resolved);
  truth.fullReason = planWatchFullReason({ ...resolved, label: truth.label });
  truth.reason = planWatchReason({ ...resolved, label: truth.label, fullReason: truth.fullReason });
  truth.action = planWatchActionText({ ...resolved, label: truth.label, fullReason: truth.fullReason, reason: truth.reason });
  truth.signalRows = planContextSignalRows({ ...resolved, ...truth });
  truth.receiptLines = planWeatherReceiptLines({ ...resolved, ...truth });
  truth.receipt = planWeatherReceiptText({ ...resolved, ...truth });
  truth.notification = planWeatherNotificationState({ ...resolved, ...truth, status: item.status || "ready" });
  return truth;
}

function planSignalRiskKind(item) {
  const stats = item?.stats || {};
  const alertText = [item?.alert?.event, item?.primaryReason, item?.advice, item?.label, item?.reason]
    .filter(Boolean)
    .join(" ");
  const risk = planConditionRiskKind(stats, item?.alert || null, alertText, planWeatherUnitFromItem(item));
  return risk === "flood" ? "rain" : risk;
}

function planSignalPrecipText(value, unit) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "None";
  if (unit === "in") {
    if (amount < 0.01) return "Trace";
    return amount < 0.1 ? amount.toFixed(2) : amount.toFixed(1);
  }
  if (amount < 0.1) return "Trace";
  return amount < 1 ? amount.toFixed(1) : String(Math.round(amount));
}

function planSignalRangeText(min, max, unit = "") {
  const low = Math.round(Number(min));
  const high = Math.round(Number(max));
  if (!Number.isFinite(low) && !Number.isFinite(high)) return "";
  if (!Number.isFinite(low)) return `${high}${unit}`;
  if (!Number.isFinite(high)) return `${low}${unit}`;
  if (low === high) return `${low}${unit}`;
  return `${low}${unit}-${high}${unit}`;
}

function planSignalChanceRangeText(min, max) {
  const low = Math.round(Number(min));
  const high = Math.round(Number(max));
  if (!Number.isFinite(low) && !Number.isFinite(high)) return "";
  if (!Number.isFinite(low)) return `${high}% max`;
  if (!Number.isFinite(high)) return `${low}%`;
  if (high <= 0) return "0%";
  if (low === high) return `${high}%`;
  return `${low}-${high}%`;
}

function planSignalUnitRangeText(min, max, unit = "") {
  const low = Math.round(Number(min));
  const high = Math.round(Number(max));
  const suffix = unit ? ` ${unit}` : "";
  if (!Number.isFinite(low) && !Number.isFinite(high)) return "";
  if (!Number.isFinite(low)) return `${high}${suffix}`;
  if (!Number.isFinite(high)) return `${low}${suffix}`;
  if (low === high) return `${low}${suffix}`;
  return `${low}-${high}${suffix}`;
}

function planSignalPeakText(value, unit = "") {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount)) return "";
  return `Peak ${amount}${unit ? ` ${unit}` : ""}`;
}

function planSignalPrecipTotalText(value, unit) {
  const text = planSignalPrecipText(value, unit);
  return text === "None" ? text : `${text} ${unit} total`;
}

function uniquePlanSignalRows(rows, limit = 3) {
  const seen = new Set();
  const result = [];
  rows.forEach((row) => {
    if (!row?.label || row.value === null || row.value === undefined) return;
    const key = String(row.label).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result.slice(0, limit);
}

function planContextSignalRows(item) {
  if (!item?.stats) return [];
  const stats = item.stats;
  const preference = weatherTruthUnitPreference();
  const tempUnit = preference === "fahrenheit" ? "F" : "C";
  const temp = item.units?.temp || weatherTruthDegree(tempUnit);
  const wind = item.units?.wind || (preference === "fahrenheit" ? "mph" : "km/h");
  const precip = item.units?.precip || (preference === "fahrenheit" ? "in" : "mm");
  const risk = planSignalRiskKind(item);
  const feelsRow = { label: "Feels", value: planSignalRangeText(stats.feelsMin ?? stats.feelsAvg, stats.feelsMax ?? stats.feelsAvg, temp), kind: "heat" };
  const tempRow = { label: "Temp", value: planSignalRangeText(stats.tempMin, stats.tempMax, temp), kind: "temp" };
  const rainRow = { label: "Rain", value: planSignalChanceRangeText(stats.rainChanceMin ?? stats.rainChance, stats.rainChance), kind: "rain" };
  const amountRow = { label: "Amount", value: planSignalPrecipTotalText(stats.precipTotal, precip), kind: "rain" };
  const gustRow = { label: "Gusts", value: planSignalPeakText(stats.gustMax || stats.windMax, wind), kind: "wind" };
  const windRow = { label: "Wind", value: planSignalUnitRangeText(stats.windMin ?? stats.windMax, stats.windMax, wind), kind: "wind" };
  const uvRow = { label: "UV", value: stats.uvMax > 0 ? planSignalPeakText(stats.uvMax) : "Low", kind: "sun" };
  const airRow = { label: "Air", value: stats.aqiMax ? `Peak AQI ${stats.aqiMax}` : (stats.aqiLabel || "Good"), kind: "air" };
  const pollenRow = { label: "Pollen", value: stats.pollenLabel || stats.pollenLevel || "Elevated", kind: "air" };
  const stormRow = { label: "Storms", value: stats.stormPotential ? "Possible" : "Watch", kind: "storm" };
  const fallback = [rainRow, feelsRow, gustRow, tempRow];
  const rowsByRisk = {
    heat: [feelsRow, tempRow, uvRow, rainRow],
    cold: [feelsRow, tempRow, gustRow, rainRow],
    storm: [stormRow, rainRow, gustRow, amountRow],
    rain: [rainRow, amountRow, gustRow, feelsRow],
    wind: [gustRow, windRow, rainRow, feelsRow],
    air: [airRow, feelsRow, rainRow, gustRow],
    pollen: [pollenRow, airRow, feelsRow, rainRow],
    good: fallback
  };
  return uniquePlanSignalRows([...(rowsByRisk[risk] || fallback), ...fallback]);
}

function renderPlanSignalChip(row) {
  const escape = weatherTruthEscapeHtml;
  const kind = row.kind ? ` is-${escape(row.kind)}` : "";
  return `<span class="${kind.trim()}"><b>${escape(row.label)}</b><strong>${escape(row.value)}</strong></span>`;
}

function renderPlanWatchSignals(watch) {
  const rows = planContextSignalRows(watch);
  if (!rows.length) return "";
  return `<div class="plan-watch-signals">` +
    rows.map(renderPlanSignalChip).join("") +
  `</div>`;
}

const NearcastWeatherTruth = {
  weatherTruthCapitalize,
  weatherTruthEscapeHtml,
  weatherTruthCleanText,
  weatherTruthCleanToken,
  weatherTruthDegree,
  weatherTruthUnitPreference,
  weatherTruthNumber,
  weatherTruthTimestamp,
  weatherTruthDelta,
  weatherTruthScoreBand,
  weatherTruthWindDeltaThreshold,
  weatherTruthWindNotableThreshold,
  weatherTruthDisplayTempUnit,
  planWeatherUnitFromItem,
  planWatchCompactText,
  planWatchNotificationTargetUrl,
  planConditionRiskKind,
  planWatchRiskKind,
  planWatchLabel,
  planWatchFullReason,
  planWatchReason,
  planWatchActionText,
  planVerdict,
  planBriefingTone,
  planBriefingPriority,
  planBriefingReason,
  weatherTruthAlertTone,
  planAdvice,
  planWeatherUnits,
  planWeatherWindowScore,
  planWeatherWindCautionThreshold,
  planWeatherWatchCurrentState,
  planWeatherWatchStateChange,
  planWeatherLastKnownFromState,
  planWeatherNotificationCandidate,
  planWeatherNotificationDetail,
  planWeatherChangeSnapshot,
  planWeatherChangeReceipt,
  samePlanWeatherWindow,
  planWeatherChange,
  planWeatherNotificationState,
  planReceiptValue,
  planWeatherReceiptLines,
  planWeatherReceiptText,
  planWeatherTruth,
  planSignalRiskKind,
  planSignalPrecipText,
  planSignalRangeText,
  planSignalChanceRangeText,
  planSignalUnitRangeText,
  planSignalPeakText,
  planSignalPrecipTotalText,
  uniquePlanSignalRows,
  planContextSignalRows,
  renderPlanSignalChip,
  renderPlanWatchSignals
};

if (typeof globalThis !== "undefined") {
  globalThis.NearcastWeatherTruth = NearcastWeatherTruth;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = NearcastWeatherTruth;
}
