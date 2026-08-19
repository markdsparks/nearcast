#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  forecastTruthContractFixtures,
  nwsThunderFixtures,
  crossPlaceFixture
} from "./forecast-truth-contract-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, daygraph, planner, nativeSnapshot, nativeWidget, nativeWatch] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "native/ios/Shared/NearcastWidgetSnapshot.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWidget/NearcastWidget.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatch/NearcastWatchRootView.swift"), "utf8")
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
  const starts = [`function ${name}(`, `async function ${name}(`]
    .map((marker) => source.indexOf(marker))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const signatureEnd = source.indexOf(") {", start);
  return extractBalancedBlock(source, start, name, signatureEnd + 2);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function contractSandbox() {
  const sandbox = {
    state: { forecast: null },
    weatherCodes: {
      0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy",
      61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow",
      73: "Snow", 75: "Heavy snow", 95: "Thunderstorms"
    },
    capitalize(value) {
      const text = String(value || "");
      return text ? text[0].toUpperCase() + text.slice(1) : text;
    },
    currentHourlyIndex() { return 0; },
    weatherTruth(data) { return data.__truth || null; },
    buildWeatherTruth(data) {
      return {
        data,
        current: data.current || {},
        code: data.current?.weather_code ?? 0,
        nowCode: data.current?.weather_code ?? 0,
        label: sandbox.weatherCodes[data.current?.weather_code] || "Weather",
        isDay: Boolean(data.current?.is_day),
        source: "modeled-current",
        display: {
          rawCode: data.hourly?.weather_code?.[0] ?? data.current?.weather_code ?? 0,
          pop: data.hourly?.precipitation_probability?.[0] ?? 0,
          precip: data.hourly?.precipitation?.[0] ?? 0,
          stormPotential: false
        },
        precip: { phase: "forecast", source: "hourly-forecast", confidence: "forecast" }
      };
    },
    hourlyPrecipProfile(data, index) {
      const rawCode = Number(data.hourly.weather_code?.[index] ?? 0);
      const pop = Number(data.hourly.precipitation_probability?.[index] ?? 0);
      const precip = Number(data.hourly.precipitation?.[index] ?? 0);
      const cloud = Number(data.hourly.cloud_cover?.[index] ?? 0);
      const precipCode = rawCode >= 51;
      const primary = pop >= 60 || (pop >= 30 && precip > 0);
      const code = precipCode && !primary
        ? cloud >= 80 ? 3 : cloud >= 40 ? 2 : 1
        : rawCode;
      return {
        rawCode, code, pop, precip, cloud,
        rate: precip,
        primary,
        chance: precipCode && !primary,
        amountSupported: precip > 0
      };
    },
    canonicalCurrentSnapshot(data) { return data.current || {}; },
    convectiveEvidenceForFutureHour(data, index) { return data.__futureConvective?.[index] || null; },
    forecastConditionFamily(code) {
      if (code >= 95) return "storm";
      if ([71, 73, 75].includes(code)) return "snow";
      if (code >= 51) return "rain";
      if (code === 0) return "clear";
      if (code === 1 || code === 2) return "partly-cloudy";
      if (code === 3) return "cloudy";
      return "weather";
    },
    forecastStoryCondition(code) {
      if (code >= 95) return "Storms";
      if ([71, 73, 75].includes(code)) return "Snow";
      if (code >= 51) return "Rain";
      return sandbox.weatherCodes[code] || "Mixed conditions";
    },
    hasThunderPotential(rawCode, pop, code) { return rawCode >= 95 || code >= 95 || pop >= 80; },
    precipKindFromCode(code) { return [71, 73, 75].includes(code) ? "snow" : "rain"; },
    parseForecastTimestamp(value) { return Date.parse(`${value}Z`); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    ${extractFunction(app, "forecastProbabilityValue")}
    ${extractFunction(app, "forecastPrecipNoun")}
    ${extractFunction(app, "forecastPrecipGuidanceLabel")}
    ${extractFunction(app, "forecastHourPrecipDisplay")}
    ${extractFunction(app, "forecastHourPresentation")}
    globalThis.resolveHour = forecastHourPresentation;
  `, sandbox);
  return sandbox;
}

const contract = contractSandbox();

function assertContract(fixture) {
  const hour = plain(contract.resolveHour(fixture.data, 0, {
    isCurrent: true,
    truth: fixture.truth
  }));
  const expected = fixture.expected;
  assert.equal(hour.pop, expected.forecastPop, `${fixture.name}: pop remains raw forecast guidance`);
  assert.equal(hour.forecastPop, expected.forecastPop, `${fixture.name}: forecastPop is the canonical guidance field`);
  assert.notEqual(hour.forecastPop, 100, `${fixture.name}: observation never fabricates a 100% forecast`);
  assert.equal(hour.precipDisplay.forecastProbability, expected.forecastPop, `${fixture.name}: display retains raw guidance`);
  assert.equal(hour.precipDisplay.displayMode, expected.displayMode, `${fixture.name}: display mode distinguishes observation from guidance`);
  assert.equal(hour.precipDisplay.isObservedNow, expected.observed, `${fixture.name}: observation state is explicit`);
  assert.equal(Boolean(hour.observation), expected.observed, `${fixture.name}: observation payload is present only for observed weather`);
  if (expected.displayLabel) assert.match(hour.precipDisplay.displayLabel, expected.displayLabel, `${fixture.name}: display label`);
  if (expected.ariaLabel) assert.match(hour.precipDisplay.ariaLabel, expected.ariaLabel, `${fixture.name}: accessible observation label`);
  if (expected.detail) assert.match(hour.precipDisplay.detail, expected.detail, `${fixture.name}: evidence detail`);
  if (expected.code !== undefined) assert.equal(hour.code, expected.code, `${fixture.name}: condition code`);
  if (expected.observationLabel) assert.match(hour.observation.label, expected.observationLabel, `${fixture.name}: observation does not claim lightning`);
  return hour;
}

for (const buildFixture of forecastTruthContractFixtures) assertContract(buildFixture());
for (const fixture of nwsThunderFixtures()) assertContract(fixture);

const activeFixture = forecastTruthContractFixtures[0]();
const current = plain(contract.resolveHour(activeFixture.data, 0, {
  isCurrent: true,
  truth: activeFixture.truth
}));
const future = plain(contract.resolveHour(activeFixture.data, 1, {
  isCurrent: false,
  truth: activeFixture.truth
}));
assert.equal(current.precipDisplay.displayMode, "observed-now", "current plan/hour windows may use selected-place observation truth");
assert.equal(future.precipDisplay.displayMode, "forecast-probability", "future plan/hour windows remain forecast guidance");
assert.equal(future.forecastPop, 78, "future plan/hour windows retain the provider probability");
assert.equal(future.observation, null, "future hours never inherit the current observation");

const isolation = crossPlaceFixture();
const isolatedHour = plain(contract.resolveHour(isolation.selectedData, 0, {
  isCurrent: true,
  truth: isolation.foreignTruth
}));
assert.equal(isolatedHour.forecastPop, isolation.expected.forecastPop, `${isolation.name}: selected place keeps its own forecast`);
assert.equal(Boolean(isolatedHour.observation), isolation.expected.observed, `${isolation.name}: foreign observation is rejected`);
assert.doesNotMatch(isolatedHour.label, isolation.expected.excludesLabel, `${isolation.name}: foreign condition is rejected`);

const missingData = structuredClone(activeFixture.data);
missingData.hourly.precipitation_probability[0] = null;
missingData.hourly.precipitation[0] = null;
const missingTruth = {
  ...activeFixture.truth,
  data: missingData,
  current: missingData.current,
  display: {
    ...activeFixture.truth.display,
    pop: null,
    precip: null
  }
};
const missingGuidanceHour = plain(contract.resolveHour(missingData, 0, {
  isCurrent: true,
  truth: missingTruth
}));
assert.equal(missingGuidanceHour.forecastPopAvailable, false, "missing hourly PoP is explicitly unavailable");
assert.equal(missingGuidanceHour.forecast.probability, null, "missing hourly PoP stays null at the typed forecast boundary");
assert.equal(missingGuidanceHour.precipDisplay.forecastProbability, null, "an observation cannot fill missing forecast guidance");
assert.match(missingGuidanceHour.precipDisplay.detail, /probability guidance is unavailable/i, "observed-now detail names unavailable guidance honestly");
assert.doesNotMatch(missingGuidanceHour.precipDisplay.detail, /0%/, "missing guidance is never rendered as a fabricated zero-percent forecast");

function functionSource(source, name) {
  return extractFunction(source, name);
}

// The behavioral contract above is the single semantic boundary. These wiring
// checks keep every user-facing projection on that boundary instead of letting
// a future refactor quietly reintroduce raw provider arrays on one surface.
const hourlyMetricSource = functionSource(app, "hourlyMetricValue");
assert.match(hourlyMetricSource, /forecastHourPresentation/, "Home's Rain lens resolves the same canonical hour");
assert.match(hourlyMetricSource, /forecastPop/, "Home's Rain lens presents forecast probability as guidance");
assert.doesNotMatch(hourlyMetricSource, /precipitation_probability/, "Home's Rain lens cannot bypass the canonical hour with a raw provider array");

const renderHourlySource = functionSource(app, "renderHourly");
assert.match(renderHourlySource, /hour\.forecastPop/, "Home hourly cards consume the canonical forecast probability");
assert.match(renderHourlySource, /hour\.precipDisplay/, "Home hourly cards consume the canonical observation display");
assert.match(renderHourlySource, /hourlyTrendSegments/, "Home's rain trend splits around unavailable forecast values");
assert.match(renderHourlySource, /filter\(\(point\) => point\.available\)/, "Home's rain trend omits missing values instead of plotting them at zero");

const currentReadoutSource = functionSource(app, "renderForecastCurrentReadouts");
assert.match(currentReadoutSource, /firstRainChance == null \? "--"/, "Home's current rain readout shows unavailable instead of zero percent");
assert.doesNotMatch(currentReadoutSource, /firstRainChance \|\| 0/, "Home's current rain readout cannot coerce missing guidance to zero");

const launchNextSource = functionSource(app, "launchNextItem");
assert.match(launchNextSource, /if \(!forecastRainGuidanceCoverage\(data, currentIndex, 2\)\.complete\)/, "Dry next two hours requires complete rain guidance");
assert.match(launchNextSource, /Rain guidance unavailable/, "launch copy names incomplete rain guidance");

const outdoorWindowSource = functionSource(app, "outdoorWindowCandidate");
assert.match(outdoorWindowSource, /rainAvailable: presentation\.forecastPopAvailable/, "outdoor windows carry rain-guidance availability");
assert.match(outdoorWindowSource, /some\(\(row\) => !row\.rainAvailable\).*return null/, "outdoor windows with incomplete rain guidance cannot win as dry");

const detailHoursSource = functionSource(daygraph, "detailHoursForIndices");
assert.match(detailHoursSource, /presentation\.forecastPop/, "Hourly detail consumes canonical forecast guidance");
assert.match(detailHoursSource, /presentation\.precipDisplay/, "Hourly detail consumes canonical observed-now evidence");
assert.match(detailHoursSource, /presentation\.observation/, "Hourly detail carries the typed observation receipt");
const detailNoteSource = functionSource(daygraph, "hourlyDetailNote");
assert.match(detailNoteSource, /precipDisplay/, "Hourly detail copy distinguishes observation from probability");

const daySummarySource = functionSource(daygraph, "buildDaySummary");
assert.match(daySummarySource, /forecastPop/, "Today's rollup uses canonical forecast guidance");
assert.match(daySummarySource, /precipDisplay/, "Today's rollup names an active observation without rewriting the day probability");

for (const name of ["planWindowDetailRows", "planWindowStats", "askWindowStats"]) {
  const source = functionSource(planner, name);
  assert.match(source, /forecastHourPresentation/, `${name} resolves hours through the canonical contract`);
  assert.match(source, /forecastPop/, `${name} scores forecast guidance without observation-to-probability conversion`);
}
assert.match(functionSource(planner, "planWindowDetailRows"), /precipDisplay/, "plan detail can show observed-now evidence separately");

const nativeTimelineSource = functionSource(app, "nativeWidgetTimeline");
assert.match(nativeTimelineSource, /presentation\.forecast\.probability/, "widget and Watch timeline rainChance remains nullable forecast guidance");
assert.match(nativeTimelineSource, /presentation\.code/, "widget and Watch timeline condition uses the same canonical hour");
const nativeSnapshotSource = functionSource(app, "syncNativeWidgetSnapshot");
assert.match(nativeSnapshotSource, /forecastHourPresentation/, "widget and Watch current snapshot resolves the canonical current hour");
assert.match(nativeSnapshotSource, /currentHour\?\.forecast\?\.probability/, "widget and Watch top-level rainChance remains forecast guidance");
assert.match(nativeSnapshotSource, /version: 9/, "V9 native snapshots distinguish unavailable guidance from a real zero percent");

const nowSignalSource = functionSource(app, "nowPrecipSignal");
assert.doesNotMatch(nowSignalSource, /signal\.chance\s*=\s*100|Math\.max\(\s*100\s*,\s*signal\.chance/, "near-term precipitation cannot rewrite forecast chance to 100");
assert.match(nowSignalSource, /must not[\s\S]{0,140}rewrite the provider's probability guidance to 100%/, "the observation/probability invariant is documented at its source boundary");
const radarSignalSource = functionSource(app, "applyRadarPrecipSignal");
assert.doesNotMatch(radarSignalSource, /signal\.chance\s*=/, "radar observation never assigns forecast probability");

assert.match(nativeSnapshot, /Nearcast's web forecast engine owns/, "native companion surfaces remain projections of web-authored truth");
assert.doesNotMatch(nativeSnapshot, /rainChance\s*=\s*100/, "native projection never fabricates a 100% rain chance for observed precipitation");
for (const field of ["forecastRainChance", "precipitationNowLabel", "precipitationNowBasis", "precipitationNowObserved", "precipitationNowDetail"]) {
  assert.match(nativeSnapshot, new RegExp(`var ${field}:`), `native snapshot decodes ${field}`);
}
for (const field of ["precipitationLabel", "precipitationBasis", "precipitationObserved", "precipitationDetail"]) {
  assert.match(nativeSnapshot, new RegExp(`var ${field}:`), `native timeline decodes ${field}`);
}
assert.doesNotMatch(nativeWidget, /max\(100,\s*reportedChance\)/, "widget rain line never turns an observation into 100% probability");
assert.match(nativeWidget, /mediumNowValue[\s\S]{0,260}precipitationNowObserved[\s\S]{0,160}precipitationNowLabel/, "widget Now copy prefers the observed precipitation label");
assert.match(nativeWidget, /nativeRainMetricValue[\s\S]{0,220}precipitationNowObserved == true[\s\S]{0,80}return "Now"/, "widget rain metrics say Now while retaining PoP in the forecast line");
assert.match(nativeWidget, /isStormCode\(snapshot\.conditionCode\)[\s\S]{0,420}precipitationNowObserved[\s\S]{0,260}storms likely[\s\S]{0,80}storms possible/, "widget never upgrades observed rain into observed lightning when thunder is only forecast evidence");
assert.match(nativeWatch, /WatchRainProbability[\s\S]{0,2600}precipitationNowObserved == true[\s\S]{0,80}\? "Now"/, "Watch rain summary says Now for observed precipitation");
assert.match(nativeWatch, /watchPrecipitationAccessibility[\s\S]{0,500}earlier hourly forecast chance/, "Watch accessibility retains forecast guidance beside an observation");
assert.match(nativeWatch, /watchPrecipitationAccessibility[\s\S]{0,500}observed;/, "Watch accessibility explicitly names observed rain");
assert.match(nativeWatch, /forecastRainChanceForDisplay\.map[\s\S]{0,80}\?\? "--"/, "Watch compact rain display shows unavailable instead of zero");

console.log("PASS  Forecast Truth Contract fixtures and cross-surface wiring");
