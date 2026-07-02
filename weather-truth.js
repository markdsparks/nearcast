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
    planWatchCompactText,
    planConditionRiskKind,
    planWatchRiskKind,
    planWatchLabel,
    planWatchFullReason,
    planWatchReason,
    planWatchActionText,
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
