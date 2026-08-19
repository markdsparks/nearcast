import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  disclosureContractFixtures,
  forbiddenDisclosureLanguage,
  observationContractFixtures
} from "./forecast-disclosure-contract-fixtures.mjs";

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
  sandbox.NearcastForecastConfidence?.forecastConfidencePresentation ||
  sandbox.forecastConfidencePresentation;
const forecastDisclosurePresentation =
  sandbox.module?.exports?.forecastDisclosurePresentation ||
  sandbox.NearcastForecastConfidence?.forecastDisclosurePresentation ||
  sandbox.forecastDisclosurePresentation;

assert.equal(
  typeof forecastConfidencePresentation,
  "function",
  "forecast-confidence.js still exports the technical confidence contract"
);
assert.equal(
  typeof forecastDisclosurePresentation,
  "function",
  "forecast-confidence.js exports the calm disclosure contract"
);

const MODES = new Set(["silent", "soften", "caution", "interrupt"]);
const PRECISION = new Set(["exact", "range", "daypart"]);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
}

function validateDisclosure(value, label) {
  assert.equal(value?.version, 1, `${label}: schema version is pinned`);
  assert.ok(MODES.has(value?.mode), `${label}: disclosure mode is from the calm vocabulary`);
  assert.ok(PRECISION.has(value?.precision), `${label}: timing precision is explicit`);
  assert.equal(typeof value?.actionable, "boolean", `${label}: actionable state is explicit`);
  assert.ok(typeof value?.reason === "string" && value.reason.trim(), `${label}: machine-readable reason is present`);
  assert.ok(value?.qualifier === null || (typeof value.qualifier === "string" && value.qualifier.trim()), `${label}: qualifier is either absent or useful prose`);
  assert.equal(typeof value?.technicalAvailable, "boolean", `${label}: technical detail availability is explicit`);
  assert.doesNotMatch(
    stringsIn(value).join(" "),
    forbiddenDisclosureLanguage,
    `${label}: calm disclosure does not leak diagnostic language`
  );
}

for (const fixture of disclosureContractFixtures) {
  const input = plain(fixture.input);
  const before = JSON.stringify(input);
  const first = plain(forecastDisclosurePresentation(input));
  const second = plain(forecastDisclosurePresentation(plain(fixture.input)));

  assert.equal(JSON.stringify(input), before, `${fixture.name}: pure API does not mutate inputs`);
  assert.deepEqual(second, first, `${fixture.name}: the same evidence produces stable disclosure`);
  validateDisclosure(first, fixture.name);

  for (const [key, expected] of Object.entries(fixture.expected)) {
    assert.deepEqual(first[key] ?? null, expected, `${fixture.name}: ${key}`);
  }
}

for (const fixture of observationContractFixtures) {
  const confidence = plain(forecastConfidencePresentation(plain(fixture.input)));
  assert.equal(
    confidence?.evidence?.observation?.status,
    fixture.expected.observationStatus,
    `${fixture.name}: radar evidence retains the correct scope`
  );
  if (fixture.expected.forbiddenConfidenceText) {
    assert.doesNotMatch(
      stringsIn(confidence).join(" "),
      fixture.expected.forbiddenConfidenceText,
      `${fixture.name}: clear radar does not manufacture a forecast conflict`
    );
  }

  const disclosure = plain(forecastDisclosurePresentation({ confidence }));
  validateDisclosure(disclosure, fixture.name);
}

console.log(
  `PASS  Calm Forecast disclosure contract (${disclosureContractFixtures.length} disclosure fixtures + ${observationContractFixtures.length} observation guards)`
);
