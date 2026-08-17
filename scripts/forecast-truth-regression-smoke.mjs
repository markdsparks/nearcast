import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  hourBoundaryFixtures,
  sourceTaxonomyFixtures,
  remainingDayFixture,
  dailyPresentationFixtures,
  pmStormFixture,
  snowLanguageFixture,
  staleCacheFixture,
  crossPlaceTruthFixture,
  activePrecipAiFixture
} from "./forecast-truth-regression-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, daygraph, html] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8")
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
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`Could not extract ${label}`);
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const signatureEnd = source.indexOf(") {", start);
  return extractBalancedBlock(source, start, name, signatureEnd + 2);
}

function contextWith(source) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

function fixtureClockSource() {
  return `
    const RealDate = Date;
    let fixtureNow = RealDate.now();
    class FixtureDate extends RealDate {
      static now() { return fixtureNow; }
    }
    globalThis.Date = FixtureDate;
    function setFixtureNow(value, data) {
      fixtureNow = parseForecastTimestamp(value, data);
    }
  `;
}

const strict = process.argv.includes("--strict");
const results = [];

function check(name, callback, options = {}) {
  try {
    callback();
    results.push({ name, status: "pass" });
  } catch (error) {
    const knownGap = options.knownGap || "";
    if (!knownGap || strict) {
      results.push({ name, status: "fail", error, knownGap });
      process.exitCode = 1;
    } else {
      results.push({ name, status: "known-gap", error, knownGap });
    }
  }
}

const time = contextWith(`
  const state = { forecast: null };
  const FORECAST_CACHE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  ${extractFunction(app, "forecastOffsetMs")}
  ${extractFunction(app, "localDateTimeParts")}
  ${extractFunction(app, "parseForecastTimestamp")}
  ${fixtureClockSource()}
  ${extractFunction(app, "forecastDataTimeRange")}
  ${extractFunction(app, "forecastEvaluationNowMs")}
  ${extractFunction(app, "forecastNowMs")}
  ${extractFunction(app, "nearestHourlyIndexAt")}
  ${extractFunction(app, "currentHourlyIndex")}
  ${extractFunction(daygraph, "isCurrentHour")}
  globalThis.subject = { currentHourlyIndex, isCurrentHour, setFixtureNow };
`).subject;

hourBoundaryFixtures.forEach((fixture) => {
  check(fixture.name, () => {
    const data = {
      utc_offset_seconds: 0,
      current: { time: fixture.currentTime },
      hourly: { time: fixture.hourlyTimes }
    };
    time.setFixtureNow(fixture.wallTime || fixture.currentTime, data);
    assert.equal(time.currentHourlyIndex(data), fixture.expectedIndex);
    assert.deepEqual(
      Array.from(fixture.hourlyTimes, (value) => time.isCurrentHour(value, data)),
      fixture.expectedCurrentFlags
    );
  }, { knownGap: fixture.knownGap });
});

const receipt = contextWith(`
  const RAIN_LIKELY_CODE = 10001;
  const PRECIP_FEATURE_POP = 30;
  const weatherCodes = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow",
    73: "Snow", 75: "Heavy snow", 95: "Thunderstorms", 10001: "Rain likely"
  };
  ${extractFunction(app, "isPrecipCode")}
  ${extractFunction(app, "convectiveReceiptDetail")}
  ${extractFunction(app, "weatherTruthReceipt")}
  globalThis.subject = weatherTruthReceipt;
`).subject;

sourceTaxonomyFixtures.forEach((fixture) => {
  check(fixture.name, () => {
    const data = { hourly: { precipitation_probability: [fixture.display.pop] } };
    const value = receipt(fixture.display, fixture.nowPrecip, data, fixture.precipTruth);
    assert.equal(value.source, fixture.expected.source);
    assert.equal(value.confidence, fixture.expected.confidence);
    assert.match(value.short, fixture.expected.short);
  });
});

const nws = contextWith(`
  ${extractFunction(app, "nwsPeriodCallsForThunder")}
  ${extractFunction(app, "normalizeNwsConvectiveEvidence")}
  globalThis.subject = { nwsPeriodCallsForThunder, normalizeNwsConvectiveEvidence };
`).subject;

check("NWS convective parsing accepts TSRA wording and ignores ordinary rain", () => {
  const evidence = nws.normalizeNwsConvectiveEvidence({
    properties: {
      periods: [
        {
          startTime: "2026-08-17T00:00:00-05:00",
          endTime: "2026-08-17T01:00:00-05:00",
          shortForecast: "Showers And Thunderstorms",
          probabilityOfPrecipitation: { value: 80 }
        },
        {
          startTime: "2026-08-17T01:00:00-05:00",
          endTime: "2026-08-17T02:00:00-05:00",
          shortForecast: "Heavy Rain",
          probabilityOfPrecipitation: { value: 80 }
        }
      ]
    }
  }, { id: "maryville" });
  assert.equal(evidence.placeId, "maryville");
  assert.equal(evidence.periods.length, 1);
  assert.equal(evidence.periods[0].probability, 80);
  assert.equal(nws.nwsPeriodCallsForThunder({ icon: "https://api.weather.gov/icons/land/night/tsra,60" }), true);
});

const story = contextWith(`
  const state = { forecast: null, weatherTruth: null, unit: "fahrenheit" };
  const FORECAST_CACHE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const FORECAST_CURRENT_FRESH_MS = 75 * 60 * 1000;
  const RAIN_LIKELY_CODE = 10001;
  const RAIN_LIKELY_POP = 60;
  const THUNDER_POTENTIAL_POP = 20;
  const HOURLY_PRECIP_PRIMARY_POP = 60;
  const HOURLY_PRECIP_SUPPORTED_POP = 30;
  const HOURLY_PRECIP_CHANCE_POP = 20;
  const DAILY_PRECIP_ONE_HOUR_POP = 60;
  const DAILY_PRECIP_TWO_HOURS_POP = 40;
  const DAILY_PRECIP_THREE_HOURS_POP = 30;
  const DAILY_PRECIP_NOTE_POP = 20;
  const weatherCodes = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy",
    45: "Fog", 48: "Freezing fog", 61: "Light rain", 63: "Rain",
    65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
    95: "Thunderstorms", 96: "Thunderstorms, hail", 99: "Thunderstorms, hail",
    10001: "Rain likely"
  };
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function degree(unit) { return "°" + unit; }
  function formatClock(hour, minute = 0) {
    const value = Number(hour) % 12 || 12;
    return String(value) + (Number(hour) < 12 ? " AM" : " PM");
  }
  function formatTime(value) {
    const parts = localDateTimeParts(value);
    return parts ? formatClock(parts.hour, parts.minute) : "--";
  }
  ${extractFunction(app, "forecastOffsetMs")}
  ${extractFunction(app, "localDateTimeParts")}
  ${extractFunction(app, "parseForecastTimestamp")}
  ${fixtureClockSource()}
  ${extractFunction(app, "forecastDataTimeRange")}
  ${extractFunction(app, "forecastEvaluationNowMs")}
  ${extractFunction(app, "forecastNowMs")}
  ${extractFunction(app, "forecastLocalDateAtMs")}
  ${extractFunction(app, "datePart")}
  ${extractFunction(app, "addDaysToDateString")}
  ${extractFunction(app, "forecastLocalDate")}
  ${extractFunction(app, "forecastDailyIndex")}
  ${extractFunction(app, "forecastLocalBoundaryMs")}
  ${extractFunction(app, "forecastLocalHour")}
  ${extractFunction(app, "forecastCurrentHour")}
  ${extractFunction(app, "nearestHourlyIndexAt")}
  ${extractFunction(app, "currentHourlyIndex")}
  ${extractFunction(app, "canonicalCurrentSnapshot")}
  ${extractFunction(app, "forecastUsesInches")}
  ${extractFunction(app, "precipRateThresholds")}
  ${extractFunction(app, "precipNoticeThresholds")}
  ${extractFunction(app, "precipRateFromAmount")}
  ${extractFunction(app, "isSnowCode")}
  ${extractFunction(app, "isThunderCode")}
  ${extractFunction(app, "isPrecipCode")}
  ${extractFunction(app, "precipCodeFromRate")}
  ${extractFunction(app, "precipCodeWeight")}
  ${extractFunction(app, "strongerPrecipCode")}
  ${extractFunction(app, "skyCodeFromCloud")}
  ${extractFunction(app, "effectiveWeatherCode")}
  ${extractFunction(app, "precipKindFromCode")}
  ${extractFunction(app, "hourlySkyCode")}
  ${extractFunction(app, "hourlyPrecipProfile")}
  ${extractFunction(app, "dailyPrecipProfile")}
  ${extractFunction(app, "hasThunderPotential")}
  ${extractFunction(app, "dailyConditionLabel")}
  ${extractFunction(app, "precipRank")}
  ${extractFunction(app, "forecastConditionFamily")}
  ${extractFunction(app, "forecastStoryCondition")}
  ${extractFunction(app, "forecastHourPresentation")}
  ${extractFunction(app, "dailyRelevantHourlyIndices")}
  ${extractFunction(app, "collapseForecastSegments")}
  ${extractFunction(app, "dailyPrecipitationWindow")}
  ${extractFunction(app, "dailyTimingPhrase")}
  ${extractFunction(app, "hasThunderPotentialForDay")}
  ${extractFunction(app, "forecastDayPresentation")}
  ${extractFunction(app, "futureHourlyIndexes")}
  ${extractFunction(app, "futureMaxHourlyIndex")}
  ${extractFunction(app, "formatForecastMs")}
  ${extractFunction(app, "forecastStoryIndices")}
  ${extractFunction(app, "forecastStoryPrecipWindow")}
  ${extractFunction(app, "forecastTransitionSentence")}
  ${extractFunction(app, "forecastPrecipStorySentence")}
  ${extractFunction(app, "buildForecastStory")}
  function setActiveForecastTruth(data, truth) {
    state.forecast = data;
    state.weatherTruth = truth;
  }
  globalThis.subject = { buildForecastStory, dailyPrecipProfile, forecastDayPresentation, setFixtureNow, setActiveForecastTruth };
`).subject;

check("the outlook uses the selected place's remaining local day", () => {
  story.setFixtureNow(remainingDayFixture.data.current.time, remainingDayFixture.data);
  const value = story.buildForecastStory(remainingDayFixture.data, "F", "mph", remainingDayFixture.truth);
  assert.equal(value.kicker, remainingDayFixture.expected.kicker);
  assert.match(value.text, remainingDayFixture.expected.text);
  assert.doesNotMatch(value.text, remainingDayFixture.expected.excludes);
});

remainingDayFixture.daylightCases.forEach((fixture) => {
  check(`daylight semantics: ${fixture.expectedKicker}`, () => {
    const data = structuredClone(remainingDayFixture.data);
    data.current.time = fixture.time;
    story.setFixtureNow(fixture.time, data);
    const value = story.buildForecastStory(data, "F", "mph", {
      ...remainingDayFixture.truth,
      isDay: fixture.isDay
    });
    assert.equal(value.kicker, fixture.expectedKicker);
  });
});

dailyPresentationFixtures.forEach((fixture) => {
  check(fixture.name, () => {
    story.setFixtureNow(fixture.now, fixture.data);
    const value = story.forecastDayPresentation(fixture.data, fixture.dayIndex);
    assert.equal(value.code, fixture.expected.code);
    assert.equal(value.family, fixture.expected.family);
    assert.equal(value.precip.primary, fixture.expected.precipPrimary);
    assert.equal(value.precip.sustained, fixture.expected.precipSustained);
    assert.equal(value.precip.note, fixture.expected.precipNote);
    if (fixture.expected.precipAmountPrimary !== undefined) {
      assert.equal(value.precip.amountPrimary, fixture.expected.precipAmountPrimary);
    }
    if (fixture.expected.timing instanceof RegExp) assert.match(value.timing, fixture.expected.timing);
    else assert.equal(value.timing, fixture.expected.timing);
    (fixture.elapsedIndices || []).forEach((index) => {
      assert.ok(!value.primaryIndices.includes(index), `elapsed hourly index ${index} is excluded`);
    });
  });
});

check("active-place radar truth cannot redefine a different place's daily forecast", () => {
  const activeData = structuredClone(crossPlaceTruthFixture.activeForecast);
  const remoteData = structuredClone(crossPlaceTruthFixture.remoteForecast);
  story.setActiveForecastTruth(activeData, {
    data: activeData,
    nowCode: 63,
    precip: { phase: "active", source: "radar-current" }
  });
  story.setFixtureNow(remoteData.current.time, remoteData);
  const value = story.forecastDayPresentation(remoteData, 0);
  assert.equal(value.code, crossPlaceTruthFixture.expected.dailyCode);
  assert.equal(value.family, crossPlaceTruthFixture.expected.dailyFamily);
  assert.equal(value.precip.primary, false);
});

const placeTruth = contextWith(`
  const RAIN_LIKELY_CODE = 10001;
  const FORECAST_CLOCK_BUCKET_MS = 5 * 60 * 1000;
  const weatherCodes = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow",
    73: "Snow", 75: "Heavy snow", 95: "Thunderstorms", 10001: "Rain likely"
  };
  const state = {
    forecast: null,
    weatherTruth: null,
    unit: "fahrenheit",
    activePlace: null,
    radarPrecipSignal: null
  };
  const nwsConvectiveEvidenceByForecast = new WeakMap();
  const activeAlerts = [];
  const alertTrustState = { state: "ready" };
  function currentRadarPrecipSignal() { return state.radarPrecipSignal; }
  function radarPrecipSignalKey(radar) { return radar ? [radar.phase, radar.intensity, radar.placeId].join(":") : "none"; }
  function canonicalCurrentSnapshot(data) { return { ...(data.current || {}), basis: "modeled-current" }; }
  function currentHourlyIndex(data) { return data?.hourly?.time?.length ? 0 : -1; }
  function nowPrecipSignal() {
    return { isWetNow: false, amount: 0, rate: 0, code: null, isSnow: false, chance: 0, source: "", basis: "forecast" };
  }
  function radarObservedPrecipCode() { return 63; }
  function precipRateThresholds() { return { measurable: 0.01 }; }
  function strongerPrecipCode(_current, candidate) { return candidate; }
  function isSnowCode(code) { return code >= 71 && code <= 86; }
  function isThunderCode(code) { return code >= 95 && code <= 99; }
  function radarObservedPrecipDetail() { return "Rain observed on radar over this place"; }
  function effectiveWeatherCode(code) { return code ?? 3; }
  function effectiveCurrentCode(current) { return current?.weather_code ?? 3; }
  function buildPrecipTruth(_data, nowPrecip, context) {
    if (nowPrecip?.isWetNow) {
      return {
        phase: "active", isWetNow: true, chance: 100,
        visualCode: nowPrecip.code || 61, label: nowPrecip.label || "Rain",
        source: nowPrecip.source || "radar-current", basis: nowPrecip.basis || "observed"
      };
    }
    return {
      phase: "dry", isWetNow: false, chance: context.pop || 0,
      visualCode: context.baseCode, label: "Dry", source: "dry", basis: "forecast"
    };
  }
  function hasThunderPotential() { return false; }
  function currentLocalDaylightIsDay(_data, fallback) { return Boolean(fallback); }
  function weatherTruthReceipt(display) {
    const active = display.precipTruth?.phase === "active";
    return active
      ? { short: "Rain now · radar", detail: "Rain observed.", source: "radar-current", confidence: "observed" }
      : { short: "Mostly clear · hourly forecast", detail: "Dry forecast.", source: "hourly", confidence: "forecast" };
  }
  function currentRainChanceFromHourly(data) { return data?.hourly?.precipitation_probability?.[0] || 0; }
  function weatherTruthSurfaceDetail(truth) { return truth.receiptDetail || truth.receipt || ""; }
  function forecastNowMs() { return Date.UTC(2026, 7, 14, 14, 0, 0); }
  function weatherTruth(data) { return data === state.forecast && state.weatherTruth ? state.weatherTruth : buildWeatherTruth(data); }
  function forecastProvenance() { return { savedAt: Date.UTC(2026, 7, 14, 13, 55, 0), cacheFallback: false }; }
  function placeLabel(place) { return place?.name || "Unknown"; }
  function formatForecastMs() { return "2:00 PM"; }
  function analyzeNowcast() { return null; }
  function airQualitySummary() { return null; }
  function forecastHourPresentation(data, index, options = {}) {
    const code = options.truth?.nowCode ?? data.hourly.weather_code[index];
    return {
      temperature: data.hourly.temperature_2m[index],
      pop: data.hourly.precipitation_probability[index] || 0,
      label: weatherCodes[code] || "Weather"
    };
  }
  function forecastDailyIndex() { return 0; }
  function forecastDayPresentation(data, index) {
    return { label: weatherCodes[data.daily.weather_code[index]] || "Weather", timing: "" };
  }
  function shortClock(value) { return String(value || "").slice(-5); }
  ${extractFunction(app, "observedPrecipSummaryLabel")}
  ${extractFunction(app, "activePrecipSummaryValue")}
  ${extractFunction(app, "nowcastConflictsWithActivePrecip")}
  ${extractFunction(app, "radarSignalForForecastData")}
  ${extractFunction(app, "nwsConvectivePeriodForForecast")}
  ${extractFunction(app, "nwsConvectiveEvidenceKey")}
  ${extractFunction(app, "convectiveEvidenceForForecast")}
  ${extractFunction(app, "applyRadarPrecipSignal")}
  ${extractFunction(app, "buildWeatherTruth")}
  ${extractFunction(app, "buildAIContext")}
  function configure(activeForecast, activePlace, activeRadar, activeTruth) {
    state.forecast = activeForecast;
    state.activePlace = activePlace;
    state.radarPrecipSignal = activeRadar;
    state.weatherTruth = activeTruth;
  }
  function setNwsEvidence(data, evidence) { nwsConvectiveEvidenceByForecast.set(data, evidence); }
  globalThis.subject = { radarSignalForForecastData, buildWeatherTruth, buildAIContext, configure, setNwsEvidence };
`).subject;

check("active-place radar cannot leak into a remote AI or plan forecast context", () => {
  const activeData = structuredClone(crossPlaceTruthFixture.activeForecast);
  const remoteData = structuredClone(crossPlaceTruthFixture.remoteForecast);
  const activeTruth = {
    data: activeData,
    current: { weather_code: 63 },
    nowCode: 63,
    label: "Rain",
    isDay: true,
    precip: { phase: "active", source: "radar-current", basis: "observed" },
    source: "radar-current"
  };
  placeTruth.configure(
    activeData,
    structuredClone(crossPlaceTruthFixture.activePlace),
    structuredClone(crossPlaceTruthFixture.activeRadar),
    activeTruth
  );

  assert.equal(placeTruth.radarSignalForForecastData(activeData)?.phase, "active");
  assert.equal(placeTruth.radarSignalForForecastData(remoteData), null);
  const remoteTruth = placeTruth.buildWeatherTruth(remoteData);
  assert.notEqual(remoteTruth.source, crossPlaceTruthFixture.expected.forbiddenSource);
  assert.equal(remoteTruth.precip.phase, "dry");

  // Saved-plan evaluation and remote Ask Nearcast flows both consume this
  // explicit-data context. It must describe only the remote forecast object.
  const context = placeTruth.buildAIContext(remoteData, structuredClone(crossPlaceTruthFixture.remotePlace), []);
  assert.equal(context.now.sky, crossPlaceTruthFixture.expected.aiSky);
  assert.match(context.nowcast, crossPlaceTruthFixture.expected.aiNowcast);
  assert.notEqual(context.forecastStatus.precipitationSource, crossPlaceTruthFixture.expected.forbiddenSource);
});

check("AI nowcast copy cannot say dry while canonical truth says precipitation is active", () => {
  const data = structuredClone(activePrecipAiFixture.forecast);
  const truth = {
    ...structuredClone(activePrecipAiFixture.truth),
    data,
    current: { ...data.current, basis: "modeled-current" }
  };
  placeTruth.configure(data, structuredClone(activePrecipAiFixture.place), null, truth);
  const context = placeTruth.buildAIContext(data, structuredClone(activePrecipAiFixture.place), []);
  assert.match(context.nowcast, activePrecipAiFixture.expected.nowcast);
  assert.doesNotMatch(context.nowcast, activePrecipAiFixture.expected.excludes);
});

check("NWS thunder wording plus active radar elevates rain to thunderstorms likely", () => {
  const data = structuredClone(crossPlaceTruthFixture.remoteForecast);
  const place = { id: "maryville", name: "Maryville" };
  placeTruth.configure(data, place, {
    phase: "active",
    intensity: "moderate",
    placeId: place.id
  }, null);
  placeTruth.setNwsEvidence(data, {
    placeId: place.id,
    checkedAt: Date.UTC(2026, 7, 14, 14, 0, 0),
    periods: [{
      startMs: Date.UTC(2026, 7, 14, 13, 0, 0),
      endMs: Date.UTC(2026, 7, 14, 15, 0, 0),
      shortForecast: "Showers And Thunderstorms"
    }]
  });
  const truth = placeTruth.buildWeatherTruth(data);
  assert.equal(truth.nowCode, 95);
  assert.equal(truth.label, "Thunderstorms likely");
  assert.equal(truth.convective.level, "likely");
  assert.equal(truth.precip.source, "radar-current");
});

const focus = contextWith(`
  const RAIN_LIKELY_CODE = 10001;
  const weatherCodes = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow",
    73: "Snow", 75: "Heavy snow", 85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorms", 96: "Thunderstorms, hail", 99: "Thunderstorms, hail"
  };
  function degree(unit) { return "°" + unit; }
  function formatHour(value) {
    const parts = localDateTimeParts(value);
    if (!parts) return "--";
    const hour = parts.hour % 12 || 12;
    return String(hour) + (parts.hour < 12 ? " AM" : " PM");
  }
  ${extractFunction(app, "localDateTimeParts")}
  ${extractFunction(app, "forecastLocalHour")}
  ${extractFunction(app, "isSnowCode")}
  ${extractFunction(app, "isThunderCode")}
  ${extractFunction(app, "isPrecipCode")}
  ${extractFunction(app, "precipKindFromCode")}
  ${extractFunction(app, "forecastConditionFamily")}
  ${extractFunction(app, "forecastStoryCondition")}
  ${extractFunction(daygraph, "dayFocusHourLabel")}
  ${extractFunction(daygraph, "dayFocusPeriodHours")}
  ${extractFunction(daygraph, "dayFocusStory")}
  globalThis.subject = { dayFocusStory };
`).subject;

check(pmStormFixture.name, () => {
  const value = focus.dayFocusStory(pmStormFixture.hours, "F", "mph");
  assert.equal(value.signal?.label, pmStormFixture.expected.signalLabel);
  assert.match(value.signal?.value || "", pmStormFixture.expected.signalValue);
  assert.match(value.text, pmStormFixture.expected.text);
});

check(snowLanguageFixture.name, () => {
  const value = focus.dayFocusStory(snowLanguageFixture.hours, "F", "mph");
  assert.match(value.text, snowLanguageFixture.expected.text);
  assert.doesNotMatch(value.text, snowLanguageFixture.expected.excludes);
});

const provenance = contextWith(`
  ${extractFunction(app, "forecastProvenance")}
  ${extractFunction(app, "markForecastProvenance")}
  ${extractFunction(app, "markForecastCacheFallback")}
  globalThis.subject = { forecastProvenance, markForecastCacheFallback };
`).subject;

check("stale fallback retains source, age, and failure reason", () => {
  const data = {};
  provenance.markForecastCacheFallback(
    data,
    { savedAt: staleCacheFixture.savedAt },
    staleCacheFixture.reason
  );
  const value = provenance.forecastProvenance(data);
  assert.equal(value.source, staleCacheFixture.expected.source);
  assert.equal(value.cacheFallback, staleCacheFixture.expected.cacheFallback);
  assert.equal(value.savedAt, staleCacheFixture.savedAt);
  assert.equal(value.reason, staleCacheFixture.reason);
  assert.equal(staleCacheFixture.checkedAt - value.savedAt, staleCacheFixture.expected.ageMs);
});

const trust = contextWith(`
  const state = { forecast: null, activePlace: null };
  const activeAlerts = [];
  function currentRadarPrecipSignal() { return null; }
  function weatherTruth() { return {}; }
  function alertCountLabel(count) { return String(count); }
  const RealDate = Date;
  let fixtureNow = RealDate.now();
  class FixtureDate extends RealDate {
    static now() { return fixtureNow; }
  }
  globalThis.Date = FixtureDate;
  function setFixtureNowMs(value) { fixtureNow = Number(value); }
  ${extractFunction(app, "radarSignalForForecastData")}
  ${extractFunction(app, "forecastProvenance")}
  ${extractFunction(app, "forecastAgeLabel")}
  ${extractFunction(app, "forecastTrustPresentation")}
  ${extractFunction(app, "markForecastProvenance")}
  ${extractFunction(app, "markForecastCacheFallback")}
  globalThis.subject = { forecastTrustPresentation, markForecastCacheFallback, setFixtureNowMs };
`).subject;

check("stale fallback has a persistent user-facing freshness presenter", () => {
  const data = {};
  trust.markForecastCacheFallback(data, { savedAt: staleCacheFixture.savedAt }, staleCacheFixture.reason);
  trust.setFixtureNowMs(staleCacheFixture.checkedAt);
  const value = trust.forecastTrustPresentation(data, {
    precip: { phase: "dry", source: "dry" },
    receipt: "Cloudy · hourly forecast",
    receiptDetail: "Showing cloudy conditions from the nearest hourly forecast row."
  });
  assert.equal(value.tone, staleCacheFixture.expected.tone);
  assert.match(value.headline, staleCacheFixture.expected.headline);
  assert.match(value.trigger, staleCacheFixture.expected.trigger);
  assert.match(value.freshness, staleCacheFixture.expected.freshness);
  assert.match(html, /id="forecastReceiptTrigger"/);
  assert.match(html, /id="forecastReceiptFreshness"/);
});

results.forEach((result) => {
  if (result.status === "pass") {
    console.log(`PASS ${result.name}`);
    return;
  }
  const prefix = result.status === "known-gap" ? "KNOWN GAP" : "FAIL";
  console.log(`${prefix} ${result.name}`);
  if (result.knownGap) console.log(`  ${result.knownGap}`);
  console.log(`  ${result.error.message.split("\n")[0]}`);
});

const passed = results.filter((result) => result.status === "pass").length;
const gaps = results.filter((result) => result.status === "known-gap").length;
const failed = results.filter((result) => result.status === "fail").length;
console.log(`Forecast truth regression fixtures: ${passed} passed, ${gaps} known gaps, ${failed} failed${strict ? " (strict)" : ""}.`);
