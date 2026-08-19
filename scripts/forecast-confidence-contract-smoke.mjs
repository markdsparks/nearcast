import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  confidenceContractFixtures,
  confidenceForbiddenKeys,
  crossPlaceIsolationFixture
} from "./forecast-confidence-contract-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "forecast-confidence.js"), "utf8");
const sandbox = {
  module: { exports: {} },
  exports: {},
  console
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "forecast-confidence.js" });

const forecastConfidencePresentation =
  sandbox.module?.exports?.forecastConfidencePresentation ||
  sandbox.exports?.forecastConfidencePresentation ||
  sandbox.NearcastForecastConfidence?.forecastConfidencePresentation ||
  sandbox.forecastConfidencePresentation;

assert.equal(
  typeof forecastConfidencePresentation,
  "function",
  "forecast-confidence.js exports forecastConfidencePresentation as its pure v1 contract boundary"
);

const LEVELS = new Set(["high", "medium", "low", "unavailable"]);
const AGREEMENT = new Set(["aligned", "mixed", "diverging", "limited", "unavailable"]);
const EVOLUTION = new Set(["stable", "shifted", "learning", "unavailable"]);
const DIRECTIONS = new Set(["earlier", "later", "stronger", "weaker", "steady", null]);
const OBSERVATION = new Set(["confirmed", "conflict", "not-confirmed", "delayed", "unavailable", "not-applicable"]);
const CLAIM_KINDS = new Set(["dry-window", "precip-window", "temperature", "wind"]);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
}

function keysIn(value, output = []) {
  if (!value || typeof value !== "object") return output;
  Object.entries(value).forEach(([key, item]) => {
    output.push(key);
    keysIn(item, output);
  });
  return output;
}

function validateContract(value, input, label) {
  assert.equal(value?.version, 1, `${label}: schema version is pinned`);
  assert.equal(value?.generatedAtMs, input.nowMs, `${label}: deterministic generation time comes from the evaluation clock`);
  assert.equal(value?.placeKey, input.place.key, `${label}: result stays scoped to the requested place`);
  assert.deepEqual(value?.window, input.window, `${label}: confidence describes the requested time window`);
  assert.equal(value?.claim?.id, input.claim.id, `${label}: confidence remains attached to the canonical claim`);
  assert.equal(value?.claim?.kind, input.claim.kind, `${label}: claim kind is explicit`);
  assert.ok(CLAIM_KINDS.has(value?.claim?.kind), `${label}: claim kind is from the v1 vocabulary`);
  assert.equal(value?.claim?.startMs, input.claim.startMs, `${label}: claim start is not broadened`);
  assert.equal(value?.claim?.endMs, input.claim.endMs, `${label}: claim end is not broadened`);
  assert.ok(LEVELS.has(value?.level), `${label}: calibrated level is valid`);
  assert.ok(typeof value?.headline === "string" && value.headline.trim(), `${label}: headline is useful prose`);
  assert.ok(typeof value?.summary === "string" && value.summary.trim(), `${label}: summary is useful prose`);
  assert.ok(AGREEMENT.has(value?.evidence?.agreement?.status), `${label}: agreement status is valid`);
  assert.ok(Number.isInteger(value?.evidence?.agreement?.providersUsed), `${label}: usable source count is explicit`);
  assert.ok(Number.isInteger(value?.evidence?.agreement?.providersExpected), `${label}: expected source count is explicit`);
  assert.ok(EVOLUTION.has(value?.evidence?.evolution?.status), `${label}: evolution status is valid`);
  assert.ok(DIRECTIONS.has(value?.evidence?.evolution?.direction ?? null), `${label}: evolution direction is calibrated`);
  assert.ok(Number.isInteger(value?.evidence?.evolution?.comparedRuns), `${label}: history depth is explicit`);
  assert.ok(OBSERVATION.has(value?.evidence?.observation?.status), `${label}: observation status is valid`);
  assert.ok(Array.isArray(value?.limitations), `${label}: limitations are structured`);
  assert.ok(value.limitations.every((item) => typeof item === "string" && item.trim()), `${label}: limitations are readable`);

  const outputKeys = new Set(keysIn(value));
  confidenceForbiddenKeys.forEach((key) => {
    assert.equal(outputKeys.has(key), false, `${label}: ${key} is not exposed as synthetic precision`);
  });
  stringsIn(value).forEach((text) => {
    assert.doesNotMatch(text, /\b\d{1,3}(?:\.\d+)?\s*%\b/, `${label}: prose does not invent a confidence percentage`);
    assert.doesNotMatch(text, /\b(?:exactly|certain|guaranteed)\b/i, `${label}: prose does not overstate certainty`);
  });
}

function assertExpected(value, expected, label) {
  if (expected.level) assert.equal(value.level, expected.level, `${label}: confidence level`);
  if (expected.allowedLevels) assert.ok(expected.allowedLevels.includes(value.level), `${label}: confidence level is capped`);
  if (expected.agreementStatus) assert.equal(value.evidence.agreement.status, expected.agreementStatus, `${label}: agreement status`);
  if (expected.providersUsed !== undefined) assert.equal(value.evidence.agreement.providersUsed, expected.providersUsed, `${label}: usable provider count`);
  if (expected.providersExpected !== undefined) assert.equal(value.evidence.agreement.providersExpected, expected.providersExpected, `${label}: expected provider count`);
  if (expected.timingRangeMs !== undefined) assert.equal(value.evidence.agreement.timingRangeMs, expected.timingRangeMs, `${label}: evidenced timing range`);
  if (expected.tempRange !== undefined) assert.equal(value.evidence.agreement.tempRange, expected.tempRange, `${label}: evidenced temperature range`);
  if (expected.evolutionStatus) assert.equal(value.evidence.evolution.status, expected.evolutionStatus, `${label}: evolution status`);
  if (expected.evolutionDirection) assert.equal(value.evidence.evolution.direction, expected.evolutionDirection, `${label}: evolution direction`);
  if (expected.evolutionDeltaMs !== undefined) assert.equal(value.evidence.evolution.deltaMs, expected.evolutionDeltaMs, `${label}: material evolution delta`);
  if (expected.comparedRuns !== undefined) assert.equal(value.evidence.evolution.comparedRuns, expected.comparedRuns, `${label}: history comparisons`);
  if (expected.observationStatus) assert.equal(value.evidence.observation.status, expected.observationStatus, `${label}: observation verification`);
  if (expected.observationSource) assert.equal(value.evidence.observation.source, expected.observationSource, `${label}: observation source`);
  if (expected.observationAgeMs !== undefined) assert.equal(value.evidence.observation.ageMs, expected.observationAgeMs, `${label}: observation freshness`);
  if (expected.headline) assert.match(value.headline, expected.headline, `${label}: headline explains the calibrated result`);
  if (expected.summary) assert.match(value.summary, expected.summary, `${label}: summary explains the evidence`);
  if (expected.limitations) assert.match(value.limitations.join(" "), expected.limitations, `${label}: degraded evidence is disclosed`);
  if (expected.forbiddenText) assert.doesNotMatch(stringsIn(value).join(" "), expected.forbiddenText, `${label}: observation claims stay within source capability`);
}

for (const fixture of confidenceContractFixtures) {
  const input = plain(fixture.input);
  const before = JSON.stringify(input);
  const first = plain(forecastConfidencePresentation(input));
  const second = plain(forecastConfidencePresentation(plain(fixture.input)));
  assert.equal(JSON.stringify(input), before, `${fixture.name}: pure API does not mutate inputs`);
  assert.deepEqual(second, first, `${fixture.name}: the same evidence produces stable output`);
  validateContract(first, fixture.input, fixture.name);
  assertExpected(first, fixture.expected, fixture.name);

  const reorderedInput = plain(fixture.input);
  reorderedInput.providerSignals.reverse();
  const reordered = plain(forecastConfidencePresentation(reorderedInput));
  assert.deepEqual(reordered, first, `${fixture.name}: provider ordering cannot change confidence`);
}

const isolatedBase = plain(forecastConfidencePresentation(plain(crossPlaceIsolationFixture.base)));
const contaminatedInput = plain(crossPlaceIsolationFixture.base);
contaminatedInput.providerSignals.push(plain(crossPlaceIsolationFixture.foreignSignal));
contaminatedInput.history.push(plain(crossPlaceIsolationFixture.foreignHistory));
contaminatedInput.observation = plain(crossPlaceIsolationFixture.foreignObservation);
const isolatedContaminated = plain(forecastConfidencePresentation(contaminatedInput));
assert.deepEqual(
  isolatedContaminated,
  isolatedBase,
  "signals, forecast history, and radar observations from another place are ignored"
);

console.log(`PASS  Forecast Confidence v1 contract (${confidenceContractFixtures.length} calibrated fixtures + isolation/stability guards)`);
