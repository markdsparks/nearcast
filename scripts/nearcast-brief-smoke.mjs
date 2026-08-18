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
  function buildForecastStory() { throw new Error("fixture must pass canonical story"); }

  ${extractFunction(app, "nearcastRelativeTiming")}
  ${extractFunction(app, "forecastStoryIndices")}
  ${extractFunction(app, "forecastStoryPrecipWindow")}
  ${extractFunction(app, "forecastStoryTransitionSegment")}
  ${extractFunction(app, "forecastPrecipStorySentence")}
  ${extractFunction(app, "nearcastEvidencePresentation")}
  ${extractFunction(app, "nearcastPromotedEvent")}
  ${extractFunction(app, "buildNearcastBrief")}

  globalThis.subject = {
    nearcastRelativeTiming,
    forecastStoryIndices,
    forecastStoryPrecipWindow,
    forecastStoryTransitionSegment,
    forecastPrecipStorySentence,
    nearcastEvidencePresentation,
    nearcastPromotedEvent,
    buildNearcastBrief
  };
`, sandbox);

const {
  nearcastRelativeTiming,
  forecastStoryIndices,
  forecastStoryPrecipWindow,
  forecastStoryTransitionSegment,
  forecastPrecipStorySentence,
  nearcastEvidencePresentation,
  buildNearcastBrief
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

const storySource = extractFunction(app, "buildForecastStory");
assert.match(storySource, /eventHorizon[\s\S]*24 \* 60 \* 60 \* 1000/, "the Brief searches a full day for the next meaningful event");
assert.match(extractFunction(app, "buildForecastPresentation"), /brief = buildNearcastBrief[\s\S]*brief,/, "all forecast consumers receive the canonical Brief contract");
assert.match(html, /id="nearcastBrief"[^>]*aria-label="Current weather briefing"/, "the first-look surface has one named briefing landmark");
assert.match(html, /id="nearcastBriefJump"[^>]*aria-haspopup="dialog"[^>]*aria-controls="dayDetail"[^>]*hidden/, "the hourly jump declares the detail dialog it opens");
assert.match(extractCssRule(styles, ".nearcast-brief-jump"), /min-height:\s*44px/, "the promoted-event jump remains a full touch target");
assert.match(extractCssRule(styles, ".forecast-receipt-trigger"), /min-height:\s*44px/, "the evidence line remains a full touch target");
assert.match(extractCssRule(styles, ".nearcast-brief"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/, "long evidence copy cannot widen the mobile briefing grid");
assert.match(extractCssRule(styles, ".forecast-receipt-trigger"), /width:\s*min\(100%,\s*460px\)[\s\S]*min-width:\s*0/, "the evidence line shrinks within the phone viewport");
const askDockRule = extractCssRule(styles, ".app-dock-ai");
assert.doesNotMatch(askDockRule, /linear-gradient|margin:\s*-/, "Ask stays available without overpowering the weather hierarchy");
assert.match(askDockRule, /background:\s*transparent[\s\S]*box-shadow:\s*none/, "Ask uses the same quiet dock treatment as the weather destinations");
assert.match(extractFunction(app, "forecastTrustPresentation"), /if \(!provenance\.cacheFallback\)[\s\S]*trigger = briefEvidence\.label/, "saved-forecast warnings remain stronger than ordinary evidence copy");
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
