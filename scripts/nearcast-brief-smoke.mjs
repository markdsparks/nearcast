import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, daygraph, html, styles] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);

function extractBalancedBlock(source, start, label, bodyStartOverride = -1) {
  assert.notEqual(start, -1, `Found ${label}`);
  const bodyStart = bodyStartOverride >= 0 ? bodyStartOverride : source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Found ${label} body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not extract ${label}`);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  return extractBalancedBlock(source, start, name, signatureEnd + 2);
}

function extractCssRule(source, selector) {
  const exactStart = source.indexOf(`\n${selector} {`);
  const start = exactStart >= 0 ? exactStart + 1 : source.indexOf(`${selector} {`);
  return extractBalancedBlock(source, start, `${selector} rule`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`
  const state = { unit: "fahrenheit" };
  const RAIN_LIKELY_POP = 60;
  const DAILY_PRECIP_THREE_HOURS_POP = 30;
  const activeAlerts = [];
  const alertTrustState = { state: "ready", checkedAt: null, reason: "" };
  const weatherCodes = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 61: "Light rain", 63: "Rain", 95: "Thunderstorms" };

  function forecastOffsetMs(data) { return Number(data?.utc_offset_seconds || 0) * 1000; }
  function forecastNowMs(data) { return Number(data?.fixtureNowMs); }
  function forecastLocalDateAtMs(data, ms) {
    return new Date(Number(ms) + forecastOffsetMs(data)).toISOString().slice(0, 10);
  }
  function forecastLocalDate(data, dayOffset = 0) {
    const shifted = new Date(forecastNowMs(data) + forecastOffsetMs(data) + Number(dayOffset) * 86400000);
    return shifted.toISOString().slice(0, 10);
  }
  function formatForecastMs(ms, data) {
    const shifted = new Date(Number(ms) + forecastOffsetMs(data));
    const hour = shifted.getUTCHours();
    const minute = shifted.getUTCMinutes();
    const clock = hour % 12 || 12;
    return String(clock) + (minute ? ":" + String(minute).padStart(2, "0") : "") + (hour < 12 ? " AM" : " PM");
  }
  function currentHourlyIndex(data) { return Number(data?.fixtureCurrentIndex || 0); }
  function forecastHourPresentation(data, index) {
    return data.fixtureHours?.[index] || { index, convective: null };
  }
  function forecastDailyIndex(data) { return Number(data?.fixtureTodayIndex || 0); }
  function forecastDayPresentation(data, index) {
    const materialEvent = data?.fixtureStory
      ? forecastMaterialEvent(data, { dayIndex: index, truth: data.fixtureTruth, story: data.fixtureStory })
      : null;
    return { index, label: data?.fixtureDayLabels?.[index] || "Weather", materialEvent };
  }
  function dailyTimingPhrase() { return "Storms possible near 12 AM"; }
  function precipRank(code) { return code >= 95 ? 6 : code >= 63 ? 4 : code >= 51 ? 3 : 1; }
  function parseForecastTimestamp(value) { return Date.parse(String(value).endsWith("Z") ? value : value + "Z"); }
  function launchDetailTarget(_data, badgeLabel, label, startMs, options = {}) {
    return {
      startMs: Number(startMs),
      endMs: Number(options.endMs ?? (Number(startMs) + Number(options.hours || 1) * 3600000)),
      badgeLabel,
      label: badgeLabel + ": " + label
    };
  }
  function forecastProvenance(data) { return data.fixtureProvenance || { savedAt: null, cacheFallback: false }; }
  function radarSignalForForecastData() { return null; }
  function nearcastForecastConfidence() { return null; }
  function nearcastForecastDisclosure() { return null; }
  function forecastAgeLabel(ms) {
    const minutes = Math.max(0, Math.round(Number(ms) / 60000));
    return minutes < 60 ? minutes + " min ago" : Math.round(minutes / 60) + " hrs ago";
  }
  function buildWeatherTruth() { throw new Error("fixture must pass canonical truth"); }
  function canonicalCurrentSnapshot(data) { return data.current; }
  function comfortGlance(_actual, feels) {
    return { headline: feels >= 88 ? "Hot" : feels >= 60 ? "Comfortable" : "Cool" };
  }
  function activePrecipSummaryValue(precip) { return precip?.label || "Precipitation now"; }
  function degree(unit) { return "°" + unit; }
  function buildForecastStory(data) {
    if (data?.fixtureStory) return data.fixtureStory;
    throw new Error("fixture must pass canonical story");
  }

  ${extractFunction(app, "nearcastRelativeTiming")}
  ${extractFunction(app, "forecastStoryIndices")}
  ${extractFunction(app, "forecastStoryPrecipWindow")}
  ${extractFunction(app, "forecastStoryTransitionSegment")}
  ${extractFunction(app, "forecastPrecipStorySentence")}
  ${extractFunction(app, "nearcastEvidencePresentation")}
  ${extractFunction(app, "forecastTrustPresentation")}
  ${extractFunction(app, "nearcastPromotedEvent")}
  ${extractFunction(app, "nearcastBriefPeriod")}
  ${extractFunction(app, "nearcastBriefCleanSentence")}
  ${extractFunction(app, "nearcastBriefMaterialEvent")}
  ${extractFunction(app, "nearcastCalmDaypart")}
  ${extractFunction(app, "nearcastCalmEventCopy")}
  ${extractFunction(app, "nearcastCalmDailyTiming")}
  ${extractFunction(app, "forecastMaterialEventStory")}
  ${extractFunction(app, "forecastMaterialEventId")}
  ${extractFunction(app, "forecastMaterialEventLabel")}
  ${extractFunction(app, "forecastMaterialEventDailyTiming")}
  ${extractFunction(app, "forecastMaterialEvent")}
  ${extractFunction(app, "nearcastBriefTransitionSupport")}
  ${extractFunction(app, "nearcastBriefTemperatureSupport")}
  ${extractFunction(app, "nearcastBriefOutlook")}
  ${extractFunction(app, "buildNearcastBrief")}
  ${extractFunction(app, "buildForecastPresentation")}

  globalThis.subject = {
    nearcastRelativeTiming,
    forecastStoryIndices,
    forecastStoryPrecipWindow,
    forecastStoryTransitionSegment,
    forecastPrecipStorySentence,
    nearcastEvidencePresentation,
    forecastTrustPresentation,
    nearcastPromotedEvent,
    nearcastCalmDailyTiming,
    forecastMaterialEvent,
    buildNearcastBrief,
    buildForecastPresentation
  };
`, sandbox);

const {
  nearcastRelativeTiming,
  forecastStoryIndices,
  forecastStoryPrecipWindow,
  forecastStoryTransitionSegment,
  forecastPrecipStorySentence,
  nearcastEvidencePresentation,
  forecastTrustPresentation,
  nearcastCalmDailyTiming,
  forecastMaterialEvent,
  buildNearcastBrief,
  buildForecastPresentation
} = sandbox.subject;
const eveningNow = Date.parse("2026-08-18T20:00:00Z");
const tomorrowRainStart = Date.parse("2026-08-19T05:00:00Z");
const tomorrowRainEnd = Date.parse("2026-08-19T08:00:00Z");
const data = {
  fixtureNowMs: eveningNow,
  fixtureCurrentIndex: 0,
  fixtureProvenance: { savedAt: eveningNow - 6 * 60000, cacheFallback: false },
  utc_offset_seconds: 0,
  current: {
    time: "2026-08-18T20:00",
    temperature_2m: 82,
    apparent_temperature: 84,
    relative_humidity_2m: 62,
    weather_code: 2
  },
  hourly: {
    time: Array.from({ length: 25 }, (_, index) => new Date(eveningNow + index * 3600000).toISOString().slice(0, 16))
  }
};
const dryTruth = {
  current: data.current,
  code: 2,
  nowCode: 2,
  label: "Partly cloudy",
  source: "modeled-current",
  precip: { phase: "dry", source: "modeled-current", label: "Dry" }
};
const overnightStory = {
  kicker: "Tonight's outlook",
  text: "Dry through bedtime. Rain is likely around 5 AM tomorrow.",
  transition: null,
  convectiveWindow: null,
  gust: null,
  gustIndex: -1,
  precipWindow: {
    kind: "rain",
    pop: 72,
    hours: 3,
    startIndex: 9,
    endIndex: 11,
    startMs: tomorrowRainStart,
    endMs: tomorrowRainEnd
  }
};

const overnightTiming = nearcastRelativeTiming(data, tomorrowRainStart, tomorrowRainEnd);
assert.equal(overnightTiming.dayRelation, "tomorrow", "an evening open keeps an overnight event anchored to tomorrow");
assert.equal(overnightTiming.daypart, "morning", "the event preserves its useful daypart");
assert.equal(overnightTiming.dayLabel, "tomorrow");
assert.match(overnightTiming.rangeLabel, /5 AM.*8 AM.*tomorrow/i);

const midnightStart = Date.parse("2026-08-19T00:00:00Z");
const midnightData = { ...data, fixtureNowMs: Date.parse("2026-08-18T23:45:00Z") };
const midnightTiming = nearcastRelativeTiming(midnightData, midnightStart, midnightStart + 3600000);
assert.equal(midnightTiming.dayRelation, "tomorrow", "a near-midnight event keeps the correct calendar day");
assert.equal(midnightTiming.startsSoon, true, "soon remains separate from already happening");
assert.equal(midnightTiming.dayLabel, "tomorrow");
assert.equal(midnightTiming.timeLabel, "12 AM", "midnight keeps an explicit clock label");
assert.equal(midnightTiming.rangeLabel, "12 AM tomorrow", "midnight is always paired with its calendar day");

const tomorrowEvent = {
  kind: "storm",
  likelihood: "possible",
  headline: "Storms possible around 12 AM tomorrow",
  label: "Storms possible around 12 AM tomorrow",
  startMs: midnightStart,
  endMs: midnightStart + 60 * 60 * 1000
};
const priorEveningComparison = {
  precision: "daypart",
  reason: "weather-type-varies",
  timingStartMs: Date.parse("2026-08-18T18:00:00Z"),
  timingEndMs: Date.parse("2026-08-18T21:00:00Z")
};
const dayScopedTiming = nearcastCalmDailyTiming({
  ...midnightData,
  daily: { time: ["2026-08-18", "2026-08-19", "2026-08-20"] }
}, tomorrowEvent, priorEveningComparison, tomorrowEvent.headline, 1);
assert.equal(dayScopedTiming, "Rain possible in the morning", "a softened Daily row stays concise inside the day it represents");
assert.doesNotMatch(dayScopedTiming, /this evening/i, "comparison guidance from the prior day cannot relabel Tomorrow");
const rowScopedFallback = nearcastCalmDailyTiming({
  ...midnightData,
  daily: { time: ["2026-08-18", "2026-08-19", "2026-08-20"] }
}, {
  ...tomorrowEvent,
  startMs: Date.parse("2026-08-18T18:00:00Z"),
  endMs: Date.parse("2026-08-18T21:00:00Z")
}, priorEveningComparison, "Rain possible this evening", 1);
assert.equal(rowScopedFallback, "Storms possible near 12 AM", "a Daily row rejects an event that belongs to another calendar day");

const lateCurrentData = {
  fixtureNowMs: Date.parse("2026-08-18T05:45:00Z"),
  fixtureCurrentIndex: 0,
  utc_offset_seconds: 0,
  hourly: { time: ["2026-08-18T05:00", "2026-08-18T06:00", "2026-08-18T07:00"] }
};
assert.deepEqual(
  Array.from(forecastStoryIndices(lateCurrentData, lateCurrentData.fixtureNowMs, lateCurrentData.fixtureNowMs + 2 * 3600000)),
  [0, 1, 2],
  "the current hour remains in the Brief after half past"
);

const groupedPrecipData = {
  fixtureCurrentIndex: -1,
  fixtureHours: [
    { index: 0, code: 61, pop: 30, precipPrimary: false, stormPotential: false, convective: null, family: "rain", precipKind: "rain", ms: 0 },
    { index: 1, code: 3, pop: 0, precipPrimary: false, stormPotential: false, convective: null, family: "cloudy", precipKind: "rain", ms: 3600000 },
    { index: 2, code: 63, pop: 80, precipPrimary: true, stormPotential: false, convective: null, family: "rain", precipKind: "rain", ms: 7200000 },
    { index: 3, code: 63, pop: 82, precipPrimary: true, stormPotential: false, convective: null, family: "rain", precipKind: "rain", ms: 10800000 }
  ],
  hourly: { time: ["1970-01-01T00:00", "1970-01-01T01:00", "1970-01-01T02:00", "1970-01-01T03:00", "1970-01-01T04:00"] }
};
assert.equal(
  forecastStoryPrecipWindow(groupedPrecipData, [0, 1, 2, 3])?.startIndex,
  2,
  "a lone marginal blip cannot outrank a later sustained rain window"
);

assert.equal(
  forecastStoryTransitionSegment([
    { family: "cloudy", startIndex: 0, endIndex: 2 },
    { family: "partly-cloudy", startIndex: 3, endIndex: 3 },
    { family: "clear", startIndex: 4, endIndex: 7 }
  ])?.startIndex,
  4,
  "the Hourly focus uses the same stable transition described by the prose"
);
assert.equal(
  forecastStoryTransitionSegment([
    { family: "clear", startIndex: 0, endIndex: 2 },
    { family: "cloudy", startIndex: 3, endIndex: 3 },
    { family: "clear", startIndex: 4, endIndex: 7 }
  ]),
  null,
  "a brief interruption that returns to the opening condition does not create 'clear, then clear' copy"
);
assert.match(
  forecastPrecipStorySentence(data, overnightStory.precipWindow, dryTruth),
  /rain (?:is )?likely.*5 AM.*8 AM.*tomorrow/i,
  "the generated outlook sentence names the day as well as the clock time"
);

const brief = buildNearcastBrief(data, {
  truth: dryTruth,
  story: overnightStory,
  tempUnit: "F",
  windUnit: "mph",
  visibleHourCount: 5,
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(brief.story.kicker, "Tonight's outlook");
assert.equal(brief.suppressesGenericWeather, true, "the canonical Brief owns ordinary rain/wind messaging");
assert.equal(brief.promotedEvent.kind, "rain");
assert.equal(brief.promotedEvent.basis, "forecast");
assert.equal(brief.promotedEvent.timing.dayRelation, "tomorrow");
assert.match(brief.promotedEvent.label, /tomorrow/i, "promoted copy cannot drop the relative day");
assert.equal(brief.promotedEvent.hourlyIndex, overnightStory.precipWindow.startIndex, "the event points to its exact hourly row");
assert.equal(brief.promotedEvent.target.startMs, brief.promotedEvent.startMs, "the detail target starts at the promoted event");
assert.equal(brief.promotedEvent.target.endMs, brief.promotedEvent.endMs, "the detail target covers the promoted event window");
assert.equal(brief.promotedEvent.requiresJump, true, "an event beyond the visible hours exposes a deliberate jump");
assert.equal(brief.outlook.headline, "Partly cloudy", "the headline remains one concise current-period answer");
assert.match(brief.outlook.support || "", /rain likely.*5 AM.*8 AM.*tomorrow/i, "the optional support line carries the later material event");
assert.equal(brief.outlook.primaryClaimId, "condition");
assert.equal(brief.outlook.supportClaimId, "event");
assert.equal(brief.outlook.target.startMs, brief.promotedEvent.startMs, "the visible outlook and promoted event share one exact start");
assert.equal(brief.outlook.target.endMs, brief.promotedEvent.endMs, "the visible outlook and promoted event share one exact end");
assert.equal(brief.outlook.claims.length, 2, "the concise outlook exposes only its headline and optional supporting claim");

const softenedOvernightBrief = buildNearcastBrief(data, {
  truth: dryTruth,
  story: overnightStory,
  tempUnit: "F",
  windUnit: "mph",
  visibleHourCount: 5,
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" },
  disclosure: {
    mode: "soften",
    precision: "daypart",
    actionable: false,
    reason: "timing-varies",
    qualifier: null,
    timingStartMs: tomorrowRainStart - 60 * 60 * 1000,
    timingEndMs: tomorrowRainEnd + 60 * 60 * 1000
  }
});
assert.equal(softenedOvernightBrief.outlook.primaryClaimId, "condition", "a material event beyond six hours remains supporting context");
assert.equal(softenedOvernightBrief.outlook.supportClaimId, "event", "the later event still earns the one useful support line");
assert.match(softenedOvernightBrief.outlook.support || "", /rain likely tomorrow morning/i, "a later promoted event uses the calm daypart disclosure");
assert.doesNotMatch(softenedOvernightBrief.outlook.support || "", /5 AM|8 AM/i, "a softened later event cannot leak the original exact onset range");

const softenedReceipt = forecastTrustPresentation(data, dryTruth, { brief: softenedOvernightBrief });
assert.equal(softenedReceipt.headline, softenedOvernightBrief.outlook.headline, "the receipt headline follows the same softened Home brief");
assert.equal(softenedReceipt.overview, softenedOvernightBrief.outlook.support, "the receipt summary follows the same softened timing as Home");
assert.doesNotMatch(
  `${softenedReceipt.headline} ${softenedReceipt.overview}`,
  /5 AM|8 AM/i,
  "the expanded receipt cannot contradict the calm timing with the raw exact range"
);

const contractNow = Date.parse("2026-08-19T13:20:00Z");
const contractStart = Date.parse("2026-08-19T15:00:00Z");
const contractPeakStart = Date.parse("2026-08-19T16:00:00Z");
const contractPeakEnd = Date.parse("2026-08-19T18:00:00Z");
const contractEnd = Date.parse("2026-08-19T19:00:00Z");
const contractHours = Array.from({ length: 8 }, (_, index) => {
  const ms = Date.parse(`2026-08-19T${String(13 + index).padStart(2, "0")}:00:00Z`);
  const inRain = ms >= contractStart && ms < contractEnd;
  const inStormPeak = ms >= contractPeakStart && ms < contractPeakEnd;
  return {
    index,
    ms,
    code: inStormPeak ? 95 : inRain ? 61 : 2,
    family: inStormPeak ? "storm" : inRain ? "rain" : "partly-cloudy",
    precipKind: inRain ? "rain" : "",
    pop: inStormPeak ? 80 : inRain ? 65 : 10,
    precipPrimary: inRain,
    stormPotential: inStormPeak,
    convective: inStormPeak ? { level: "likely", source: "nws-hourly" } : null
  };
});
const contractTruth = {
  evaluationKey: "storm-contract-fixture",
  current: {
    time: "2026-08-19T13:20",
    temperature_2m: 82,
    apparent_temperature: 84,
    relative_humidity_2m: 64,
    weather_code: 2
  },
  code: 2,
  nowCode: 2,
  label: "Partly cloudy",
  source: "modeled-current",
  precip: { phase: "dry", source: "modeled-current", label: "Dry" }
};
const contractStory = {
  kicker: "This afternoon's outlook",
  text: "Rain develops this afternoon, with storms most likely later.",
  hour: 13,
  segments: [
    { family: "partly-cloudy", label: "Partly cloudy", startIndex: 0, endIndex: 1, startMs: contractHours[0].ms, endMs: contractStart },
    { family: "rain", label: "Rain", startIndex: 2, endIndex: 5, startMs: contractStart, endMs: contractEnd }
  ],
  temperatures: { current: 82, todayHigh: 86, overnightLow: 70 },
  transition: null,
  precipWindow: {
    kind: "rain",
    pop: 80,
    hours: 4,
    startIndex: 2,
    endIndex: 5,
    startMs: contractStart,
    endMs: contractEnd
  },
  convectiveWindow: {
    startTime: "2026-08-19T16:00",
    endTime: "2026-08-19T18:00",
    startIndex: 3,
    endIndex: 4,
    convective: { level: "likely", source: "nws-hourly" }
  },
  gust: null,
  gustIndex: -1
};
const contractData = {
  fixtureNowMs: contractNow,
  fixtureCurrentIndex: 0,
  fixtureTodayIndex: 0,
  fixtureProvenance: { savedAt: contractNow - 12 * 60000, cacheFallback: false },
  fixtureHours: contractHours,
  fixtureDayLabels: ["Storms"],
  fixtureTruth: contractTruth,
  fixtureStory: contractStory,
  utc_offset_seconds: 0,
  current: contractTruth.current,
  hourly: {
    time: contractHours.map((hour) => new Date(hour.ms).toISOString().slice(0, 16))
  },
  daily: { time: ["2026-08-19"] }
};

const canonicalEvent = forecastMaterialEvent(contractData, {
  truth: contractTruth,
  story: contractStory,
  tempUnit: "F",
  windUnit: "mph"
});
assert.equal(canonicalEvent.id, "precip:2026-08-19:0", "one stable identity owns the whole wet-weather window");
assert.equal(canonicalEvent.kind, "rain", "the event preserves the initial precipitation phase");
assert.equal(canonicalEvent.startMs, contractStart, "the event starts with the first material rain hour");
assert.equal(canonicalEvent.peakStartMs, contractPeakStart, "the peak starts with the supported thunder window");
assert.equal(canonicalEvent.peakEndMs, contractPeakEnd, "the peak ends with the supported thunder window");
assert.equal(canonicalEvent.endMs, contractEnd, "the event ends when the broader precipitation window ends");
assert.equal(canonicalEvent.phases.filter((phase) => phase.kind === "storm").length, 1, "broad thunder potential is one phase, not one claim per hour");
assert.match(canonicalEvent.headline, /Rain likely 3 PM–7 PM today/i);
assert.match(canonicalEvent.support || "", /Storms likely 4 PM–6 PM today/i);
assert.equal(canonicalEvent.target.startMs, contractStart, "the event deep-link opens at the canonical start");
assert.equal(canonicalEvent.target.endMs, contractEnd, "the event deep-link retains the canonical end");

const contractPresentation = buildForecastPresentation(contractData, {
  truth: contractTruth,
  tempUnit: "F",
  windUnit: "mph",
  radar: null,
  nowMs: contractNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.strictEqual(contractPresentation.materialEvent, contractPresentation.brief.materialEvent, "Home and the forecast package share one event object");
assert.strictEqual(contractPresentation.materialEvent, contractPresentation.brief.promotedEvent, "the Home promotion cannot choose a second event");
assert.equal(contractPresentation.days[0].materialEvent.id, canonicalEvent.id, "Daily uses the same canonical event identity");
assert.equal(contractPresentation.days[0].materialEvent.startMs, contractStart, "Daily agrees on event start");
assert.equal(contractPresentation.days[0].materialEvent.peakStartMs, contractPeakStart, "Daily agrees on peak start");
assert.equal(contractPresentation.days[0].materialEvent.peakEndMs, contractPeakEnd, "Daily agrees on peak end");
assert.equal(contractPresentation.days[0].materialEvent.endMs, contractEnd, "Daily agrees on event end");

const eventHours = contractPresentation.hours.filter((hour) => hour.eventId);
assert.deepEqual(Array.from(new Set(eventHours.map((hour) => hour.eventId))), [canonicalEvent.id], "Hourly references one event instead of restating separate hourly events");
assert.equal(eventHours.filter((hour) => hour.eventPhase === "storm" && hour.eventStarts).length, 1, "Hourly marks the thunder phase onset once");
assert.equal(eventHours.filter((hour) => hour.eventPhase === "storm" && hour.eventEnds).length, 1, "Hourly marks the thunder phase ending once");
assert.ok(eventHours.every((hour) => !("materialEvent" in hour)), "hour rows carry identity and phase only, never duplicate event prose");
assert.equal(contractPresentation.brief.outlook.target.startMs, contractStart, "the Home headline opens the same start shown by Hourly and Daily");
assert.equal(contractPresentation.brief.outlook.target.endMs, contractEnd, "the Home headline opens the same end shown by Hourly and Daily");

const quietBrief = buildNearcastBrief(data, {
  truth: dryTruth,
  story: {
    kicker: "Tonight's outlook",
    text: "Clear through tonight. Low near 78°F tonight; tomorrow reaches 92°F.",
    hour: 20,
    segments: [{
      family: "clear",
      label: "Clear",
      startIndex: 0,
      endIndex: 7,
      startMs: eveningNow,
      endMs: eveningNow + 8 * 3600000
    }],
    temperatures: { current: 82, todayHigh: 86, overnightLow: 78, tomorrowHigh: 92 },
    transition: null,
    convectiveWindow: null,
    precipWindow: null,
    gust: null,
    gustIndex: -1
  },
  visibleHourCount: 5,
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(quietBrief.outlook.headline, "Clear and cooling");
assert.match(quietBrief.outlook.support || "", /cooling to 78°F overnight/i, "quiet weather may retain one useful local trend");
assert.doesNotMatch(
  [quietBrief.outlook.headline, quietBrief.outlook.support].filter(Boolean).join(" "),
  /tomorrow|92°F|reaches/i,
  "a quiet opening does not spend its support line on the routine tomorrow high"
);
assert.equal(quietBrief.promotedEvent, null);
assert.equal(quietBrief.outlook.claims.length, 1, "quiet weather remains a single-claim glance");

const nearEvent = buildNearcastBrief(data, {
  truth: dryTruth,
  story: {
    ...overnightStory,
    text: "Clouds increase this evening. Rain is possible around 10 PM today.",
    precipWindow: {
      kind: "rain",
      pop: 45,
      hours: 1,
      startIndex: 2,
      endIndex: 2,
      startMs: eveningNow + 2 * 3600000,
      endMs: eveningNow + 3 * 3600000
    }
  },
  visibleHourCount: 5,
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(nearEvent.promotedEvent.timing.dayRelation, "today");
assert.equal(nearEvent.promotedEvent.requiresJump, false, "a visible event does not add a redundant jump affordance");

const radarEvidence = nearcastEvidencePresentation(data, {
  ...dryTruth,
  label: "Light rain",
  precip: { phase: "active", source: "radar-current", label: "Light rain" }
}, {
  radar: { phase: "active", source: "NOAA MRMS radar", timestamp: eveningNow - 5 * 60000 },
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(radarEvidence.basis, "observed");
assert.match(radarEvidence.label, /observed on radar/i);
assert.match(radarEvidence.parts.find((part) => part.kind === "current")?.meta || "", /observed/i);
assert.equal(radarEvidence.alerts.label, "No active NWS alerts");

const freshnessNow = Date.parse("2026-08-18T20:00:00Z");
const splitFreshness = nearcastEvidencePresentation({
  ...data,
  fixtureNowMs: freshnessNow,
  fixtureProvenance: { savedAt: freshnessNow - 18 * 60000, cacheFallback: false }
}, dryTruth, {
  radar: {
    phase: "clear",
    confidence: "observed-clear",
    source: "NOAA MRMS radar",
    timestamp: freshnessNow - 4 * 60000
  },
  nowMs: freshnessNow,
  alerts: [],
  alertState: { state: "ready" }
});
const splitRadarPart = splitFreshness.parts.find((part) => part.kind === "current");
const splitForecastPart = splitFreshness.parts.find((part) => part.kind === "forecast");
assert.match(splitRadarPart?.meta || "", /4 min ago/, "radar freshness comes from the radar frame timestamp");
assert.match(splitRadarPart?.detail || "", /4 min ago/, "radar detail keeps the radar frame age");
assert.match(splitForecastPart?.label || "", /18 min ago/, "forecast freshness comes from the forecast save timestamp");
assert.doesNotMatch(splitRadarPart?.meta || "", /18 min ago/, "forecast age cannot leak into the radar claim");
assert.doesNotMatch(splitForecastPart?.label || "", /4 min ago/, "radar age cannot leak into the forecast claim");

const modeledEvidence = nearcastEvidencePresentation(data, {
  ...dryTruth,
  label: "Light rain",
  precip: { phase: "active", source: "modeled-15-minute", label: "Light rain" }
}, {
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(modeledEvidence.basis, "estimated", "modeled current conditions never claim direct observation");
assert.match(modeledEvidence.label, /estimated now/i);
assert.match(modeledEvidence.detail, /not a direct observation|radar has not confirmed/i);
assert.doesNotMatch(modeledEvidence.label, /observed/i);

const activeBrief = buildNearcastBrief(data, {
  truth: {
    ...dryTruth,
    code: 61,
    nowCode: 61,
    label: "Light rain",
    source: "radar-current",
    nowPrecip: { isWetNow: true, source: "radar-current" },
    precip: { phase: "active", source: "radar-current", label: "Light rain" }
  },
  story: {
    kicker: "Tonight's outlook",
    text: "Light rain now, easing near 9 PM tonight.",
    transition: null,
    convectiveWindow: null,
    gust: null,
    gustIndex: -1,
    precipWindow: {
      kind: "rain",
      pop: 100,
      hours: 1,
      startIndex: 0,
      endIndex: 0,
      startMs: eveningNow - 5 * 60000,
      endMs: eveningNow + 60 * 60000
    }
  },
  visibleHourCount: 5,
  radar: { phase: "active", source: "NOAA MRMS radar", timestamp: eveningNow - 5 * 60000 },
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(activeBrief.promotedEvent.timing.dayRelation, "now");
assert.equal(activeBrief.promotedEvent.basis, "observed", "an active event only claims observed when radar supports it");
assert.match(activeBrief.promotedEvent.label, /^Rain now/i);

const modeledActiveBrief = buildNearcastBrief(data, {
  truth: {
    ...dryTruth,
    code: 61,
    nowCode: 61,
    label: "Light rain",
    source: "modeled-15-minute",
    nowPrecip: { isWetNow: true, source: "modeled-15-minute" },
    precip: { phase: "active", source: "modeled-15-minute", label: "Light rain" }
  },
  story: {
    kicker: "Tonight's outlook",
    text: "Light rain indicated now, easing near 9 PM tonight.",
    transition: null,
    convectiveWindow: null,
    gust: null,
    gustIndex: -1,
    precipWindow: {
      kind: "rain",
      pop: 100,
      hours: 1,
      startIndex: 0,
      endIndex: 0,
      startMs: eveningNow - 5 * 60000,
      endMs: eveningNow + 60 * 60000
    }
  },
  visibleHourCount: 5,
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.match(modeledActiveBrief.outlook.headline, /^Rain indicated now/i, "modeled current rain remains explicitly indicated, not observed");

const skyOnlyBrief = buildNearcastBrief(data, {
  truth: { ...dryTruth, label: "Cloudy" },
  story: {
    kicker: "Tonight's outlook",
    text: "Cloudy tonight, then clearing tomorrow morning.",
    hour: 20,
    segments: [
      { family: "cloudy", label: "Cloudy", startIndex: 0, endIndex: 8, startMs: eveningNow, endMs: tomorrowRainStart },
      { family: "clear", label: "Clear", startIndex: 9, endIndex: 13, startMs: tomorrowRainStart, endMs: tomorrowRainStart + 5 * 3600000 }
    ],
    temperatures: { current: 82, overnightLow: 78, tomorrowHigh: 88 },
    transition: { family: "clear", label: "Clear", startIndex: 9, endIndex: 13, startMs: tomorrowRainStart, endMs: tomorrowRainStart + 5 * 3600000 },
    convectiveWindow: null,
    precipWindow: null,
    gust: null,
    gustIndex: -1
  },
  visibleHourCount: 5,
  radar: null,
  nowMs: eveningNow,
  alerts: [],
  alertState: { state: "ready" }
});
assert.equal(skyOnlyBrief.promotedEvent, null, "ordinary sky movement is not promoted as a material event");
assert.equal(skyOnlyBrief.outlook.materialEvent, false, "an ordinary sky transition is context, not an interruption");

const jumpButton = {
  hidden: true,
  dataset: {},
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = String(value); },
  removeAttribute(name) { delete this.attributes[name]; }
};
const jumpLabel = { textContent: "" };
const jumpSandbox = { jumpButton, jumpLabel };
vm.createContext(jumpSandbox);
vm.runInContext(`
  let nearcastBriefJumpTarget = null;
  const els = { nearcastBriefJump: jumpButton, nearcastBriefJumpLabel: jumpLabel };
  ${extractFunction(app, "renderNearcastBriefJump")}
  globalThis.subject = {
    render: renderNearcastBriefJump,
    target() { return nearcastBriefJumpTarget; }
  };
`, jumpSandbox);
jumpSandbox.subject.render(brief);
assert.equal(jumpButton.hidden, false, "a material offscreen event earns the compact Hourly jump");
assert.equal(jumpLabel.textContent, "5 AM tomorrow", "the jump is a compact time link without repeating the event headline");
assert.equal(jumpButton.dataset.hourIndex, "9");
assert.equal(jumpSandbox.subject.target().startMs, brief.promotedEvent.startMs);
assert.equal(jumpSandbox.subject.target().endMs, brief.promotedEvent.endMs);

jumpSandbox.subject.render(skyOnlyBrief);
assert.equal(jumpButton.hidden, true, "a sky-only transition never adds a competing jump control");
assert.equal(jumpLabel.textContent, "Open hourly details");

const compactTrust = forecastTrustPresentation(data, dryTruth);
assert.match(compactTrust.trigger, /^Updated /);
assert.equal(compactTrust.triggerMeta, "For this location");
assert.doesNotMatch(
  `${compactTrust.trigger} ${compactTrust.triggerMeta}`,
  /evidence|no active (?:nws|official) alerts/i,
  "the collapsed success state stays quiet while full evidence remains one tap away"
);

const storySource = extractFunction(app, "buildForecastStory");
assert.match(storySource, /eventHorizon[\s\S]*24 \* 60 \* 60 \* 1000/, "the Brief searches a full day for the next meaningful event");
assert.match(extractFunction(app, "buildForecastPresentation"), /brief = buildNearcastBrief[\s\S]*brief,/, "all forecast consumers receive the canonical Brief contract");
assert.match(html, /id="nearcastBrief"[^>]*aria-label="Current weather briefing"/, "the first-look surface has one named briefing landmark");
assert.match(html, /id="nearcastBriefJump"[^>]*aria-haspopup="dialog"[^>]*aria-controls="dayDetail"[^>]*hidden/, "the hourly jump declares the detail dialog it opens");
assert.equal((html.match(/id="glanceTitle"/g) || []).length, 1, "the Brief renders one headline slot");
assert.equal((html.match(/id="glanceSupport"/g) || []).length, 1, "the Brief renders at most one support slot");
const renderTodayGlanceSource = extractFunction(app, "renderTodayGlance");
assert.match(renderTodayGlanceSource, /glanceTitle\.textContent = outlook\.headline/, "the hero renders only the concise outlook headline");
assert.match(renderTodayGlanceSource, /glanceSupport\.hidden = !outlook\.support[\s\S]*glanceSupport\.textContent = outlook\.support \|\| ""/, "the optional support row disappears completely when there is no second claim");
const receiptMarkup = html.match(/<button\s+class="forecast-receipt-trigger"[\s\S]*?<\/button>/)?.[0] || "";
assert.ok(receiptMarkup, "the collapsed evidence control is present");
assert.doesNotMatch(receiptMarkup, /forecast-receipt-trigger-label|>\s*Evidence\s*</i, "the collapsed control has no visible Evidence eyebrow");
assert.doesNotMatch(receiptMarkup, /No active (?:NWS|official) alerts/i, "the collapsed control does not advertise a routine successful no-alert check");
assert.match(extractCssRule(styles, ".nearcast-brief-jump"), /min-height:\s*44px/, "the promoted-event jump remains a full touch target");
assert.match(extractCssRule(styles, ".forecast-receipt-trigger"), /min-height:\s*44px/, "the evidence line remains a full touch target");
assert.match(extractCssRule(styles, ".launch-condition-button"), /min-height:\s*44px/, "the current-condition detail remains a full touch target");
assert.match(extractCssRule(styles, ".nearcast-brief"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/, "long evidence copy cannot widen the mobile briefing grid");
assert.match(extractCssRule(styles, ".launch-meta-row"), /flex-wrap:\s*wrap/, "the compact current and evidence controls wrap safely on narrow screens");
assert.match(styles, /@media \(pointer: coarse\)[\s\S]*\.forecast-receipt-trigger\s*\{[\s\S]*min-height:\s*44px/, "coarse-pointer layout explicitly preserves the evidence touch target");
assert.match(extractCssRule(styles, ".forecast-receipt-trigger"), /width:\s*auto[\s\S]*max-width:\s*min\(100%,\s*248px\)[\s\S]*min-width:\s*0/, "the compact evidence control shrinks within the phone viewport");
const askDockRule = extractCssRule(styles, ".app-dock-ai");
assert.doesNotMatch(askDockRule, /linear-gradient|margin:\s*-/, "Ask stays available without overpowering the weather hierarchy");
assert.match(askDockRule, /background:\s*transparent[\s\S]*box-shadow:\s*none/, "Ask uses the same quiet dock treatment as the weather destinations");
assert.match(extractFunction(app, "forecastTrustPresentation"), /if \(provenance\.cacheFallback\)[\s\S]*trigger = "Using saved forecast"[\s\S]*else \{[\s\S]*trigger = radarObserved/, "saved-forecast warnings remain stronger than the compact live evidence copy");
assert.match(extractFunction(app, "renderLaunchSummaryStrip"), /launchSummaryItems[\s\S]*launchSummaryTargets = detailItems\.map/, "forecast-change cards retain their exact hidden detail targets");
assert.match(extractFunction(app, "arrangeForecastHierarchy"), /hourlyPanel\.prepend\(hero\)[\s\S]*launch\.after\(nowcast, hourlyPanel, dailyPanel, map, els\.planPulse/, "the stable scan stays current, urgent nowcast, hourly proof, daily forecast, then map evidence");

const rollingBlockSource = extractFunction(daygraph, "rollingWindowBlockForEvent");
const rollingBlockSandbox = {};
vm.createContext(rollingBlockSandbox);
vm.runInContext(`
  const ROLLING_HOURLY_PAGE_SIZE = 24;
  ${rollingBlockSource}
  globalThis.subject = rollingWindowBlockForEvent;
`, rollingBlockSandbox);
const rollingRows = Array.from({ length: 30 }, (_, index) => ({ ms: index * 3600000 }));
assert.equal(
  rollingBlockSandbox.subject(rollingRows, { startMs: 24 * 3600000, endMs: 25 * 3600000 }),
  1,
  "a promised event on the twenty-fifth retained row opens the page that contains it"
);

const contextSource = extractFunction(app, "buildTodayContext");
assert.match(contextSource, /const interruption = \{ type: "", html: "" \}/, "For You leaves ordinary weather messaging to the canonical Brief");
assert.doesNotMatch(contextSource, /forYouInterruptionCard\(/, "For You cannot render a second generic rain or wind interpretation");

console.log("PASS  Nearcast Brief keeps one time-anchored, evidence-backed weather story linked to Hourly");
