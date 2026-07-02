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

function weatherTruthDegree(unit) {
  if (typeof degree === "function") return degree(unit);
  return `°${unit}`;
}

function weatherTruthUnitPreference() {
  return typeof state !== "undefined" && state?.unit === "fahrenheit" ? "fahrenheit" : "celsius";
}

function planWatchCompactText(value, limit = 98) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function planConditionRiskKind(stats = {}, alert = null, text = "") {
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
  if (stats.rainChance >= 35 || stats.precipTotal > 0.02) return "rain";
  if (stats.gustMax >= 25) return "wind";
  if (stats.aqiMax >= 101) return "air";
  if (stats.pollenRank >= 3) return "pollen";
  if (stats.feelsAvg <= 40) return "cold";
  if (stats.feelsAvg >= 88 || stats.uvMax >= 8) return "heat";
  return "good";
}

function planWatchRiskKind(item) {
  return planConditionRiskKind(
    item?.stats || {},
    item?.alert || null,
    [item?.primaryReason, item?.advice, item?.label, item?.reason].filter(Boolean).join(" ")
  );
}

function planWatchLabel(item) {
  if (!item) return "Waiting on forecast";
  if (item.isPast) return "Past";
  const risk = planWatchRiskKind(item);
  if (item.alertTone === "warning" || item.alertTone === "watch" || item.tone === "watch") {
    if (risk === "heat") return "Plan around heat";
    if (risk === "storm") return item.alert ? "Alert overlaps" : "Keep an eye on it";
    if (risk === "flood" || risk === "rain") return "Expect rain";
    if (risk === "wind") return "Wind may matter";
    if (risk === "air") return "Air may matter";
    if (risk === "pollen") return "Allergies may matter";
    if (risk === "cold") return "Plan around cold";
    if (item.alert) return "Alert overlaps";
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
  if (item?.alertTone === "warning" || item?.alertTone === "watch") return "watch";
  if (item?.score < 45 || item?.stats?.stormPotential) return "watch";
  if (item?.score < 65 || item?.stats?.rainChance >= 35 || item?.stats?.gustMax >= 25) return "caution";
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
  return alert.tone || alert.severity || "";
}

function planAdvice(stats = {}, alert = null, score = 100, alertSignal = null) {
  const risk = planConditionRiskKind(stats, alert);
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
    return "Keep an eye on the alert details.";
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

function weatherTruthDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
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
    riskKind: item.riskKind || planWatchRiskKind(item)
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

  if (
    current.alertTone &&
    current.alertTone !== "none" &&
    (current.alertTone !== previous.alertTone || current.alertEvent !== previous.alertEvent)
  ) {
    const tone = current.alertTone === "warning" || current.alertTone === "watch" ? "watch" : "caution";
    const alertName = current.alertEvent || "A weather alert";
    return {
      type: "plan-alert",
      tone,
      notify: true,
      priority: current.alertTone === "warning" ? 140 : current.alertTone === "watch" ? 125 : 105,
      title: `${title}: alert started`,
      body: `${alertName} now overlaps this plan.`
    };
  }

  if (previous.alertTone && !current.alertTone) {
    return {
      type: "plan-alert-ended",
      tone: "good",
      notify: false,
      priority: 45,
      title: `${title}: alert ended`,
      body: `${previous.alertEvent || "The weather alert"} no longer overlaps this plan.`
    };
  }

  const rainDelta = weatherTruthDelta(current.rainChance, previous.rainChance);
  if (rainDelta !== null && Math.abs(rainDelta) >= 20 && Math.max(current.rainChance, previous.rainChance) >= 35) {
    const wetter = rainDelta > 0;
    return {
      type: "plan-rain",
      tone: wetter ? "watch" : "good",
      notify: wetter,
      priority: 90 + Math.abs(rainDelta),
      title: `${title} ${wetter ? "got wetter" : "got drier"}`,
      body: `Rain now ${current.rainChance}%, ${wetter ? "up" : "down"} from ${previous.rainChance}%.`
    };
  }

  const heatDelta = weatherTruthDelta(current.feelsMax, previous.feelsMax);
  const crossedSeriousHeat = previous.feelsMax !== null && current.feelsMax !== null && previous.feelsMax < 100 && current.feelsMax >= 100;
  if (
    heatDelta !== null &&
    (crossedSeriousHeat || (Math.abs(heatDelta) >= 5 && Math.max(current.feelsMax, previous.feelsMax) >= 92))
  ) {
    const hotter = heatDelta > 0;
    return {
      type: "plan-heat",
      tone: hotter ? (current.feelsMax >= 100 ? "watch" : "caution") : "good",
      notify: hotter,
      priority: (hotter ? 88 : 52) + Math.abs(heatDelta),
      title: `${title} ${hotter ? "got hotter" : "cooled down"}`,
      body: `Feels like now peaks at ${current.feelsMax}${current.tempUnit || ""}, ${hotter ? "up" : "down"} from ${previous.feelsMax}${current.tempUnit || ""}.`
    };
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
    return {
      type: "plan-wind",
      tone: stronger ? "caution" : "good",
      notify: stronger,
      priority: 70 + Math.abs(gustDelta),
      title: `${title} ${stronger ? "got windier" : "eased up"}`,
      body: `Gusts now ${current.gustMax} ${current.windUnit}, ${stronger ? "from" : "down from"} ${previous.gustMax} ${current.windUnit}.`
    };
  }

  const scoreDelta = weatherTruthDelta(current.score, previous.score);
  if (scoreDelta !== null && Math.abs(scoreDelta) >= 18 && weatherTruthScoreBand(current.score) !== weatherTruthScoreBand(previous.score)) {
    const better = scoreDelta > 0;
    return {
      type: "plan-score",
      tone: better ? "good" : "caution",
      notify: !better,
      priority: 55 + Math.abs(scoreDelta),
      title: `${title} looks ${better ? "better" : "iffy now"}`,
      body: `Plan window moved from ${weatherTruthScoreBand(previous.score)} to ${weatherTruthScoreBand(current.score)}.`
    };
  }

  return null;
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
      label: "Alert",
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
  const verdict = item.verdict || planVerdict(item.score ?? 100, alertToneValue);
  const base = {
    ...item,
    alertTone: alertToneValue,
    verdict,
    advice: item.advice || planAdvice(item.stats || {}, item.alert || null, item.score ?? 100, alertToneValue)
  };
  const tone = item.tone || planBriefingTone(base);
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
  const risk = planConditionRiskKind(stats, item?.alert || null, alertText);
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    weatherTruthCapitalize,
    weatherTruthEscapeHtml,
    weatherTruthDegree,
    weatherTruthUnitPreference,
    weatherTruthNumber,
    weatherTruthDelta,
    weatherTruthScoreBand,
    weatherTruthWindDeltaThreshold,
    weatherTruthWindNotableThreshold,
    weatherTruthDisplayTempUnit,
    planWatchCompactText,
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
    planWeatherChangeSnapshot,
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
}
