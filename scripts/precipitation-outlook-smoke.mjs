import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(path.join(root, "app.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
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
  assert.fail(`Could not extract ${name}`);
}

const sandbox = {
  state: { unit: "fahrenheit" },
  parseForecastTimestamp: (value) => new Date(value).getTime(),
  forecastNowMs: (data) => new Date(data.current.time).getTime(),
  formatTime: (value) => {
    const date = new Date(value);
    return `${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }
};
vm.createContext(sandbox);
vm.runInContext(`
  ${extractFunction(app, "capitalize")}
  ${extractFunction(app, "nowcastFrac")}
  ${extractFunction(app, "analyzeNowcast")}
  globalThis.analyze = analyzeNowcast;
`, sandbox);

const base = {
  current: { time: "2026-08-30T12:00:00Z" },
  minutely_15: {
    time: ["12:00", "12:15", "12:30", "12:45", "13:00", "13:15", "13:30", "13:45"].map((time) => `2026-08-30T${time}:00Z`),
    precipitation: Array(8).fill(0),
    precipitation_probability: Array(8).fill(0)
  },
  hourly: {
    time: ["14:00", "15:00", "16:00", "17:00", "18:00"].map((time) => `2026-08-30T${time}:00Z`),
    precipitation: [0, 0.02, 0, 0, 0],
    precipitation_probability: [0, 55, 0, 0, 0],
    weather_code: [1, 61, 1, 1, 1]
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const analyzeInSandbox = (value) => {
  sandbox.fixture = JSON.stringify(value);
  return vm.runInContext("analyze(JSON.parse(fixture))", sandbox);
};
const later = analyzeInSandbox(clone(base));
assert.ok(later, "an hourly rain signal beyond the 15-minute window earns an outlook card");
assert.equal(later.slots.at(-1).source, "hourly", "the outlook bridges near-term minute data with later hourly guidance");
assert.match(later.title, /rain possible later/i, "later modeled rain is not presented as a falsely precise immediate arrival");
assert.match(later.detail, /15:00/, "the later outlook gives the family an actual likely time to watch");

const soonData = clone(base);
soonData.minutely_15.precipitation[1] = 0.01;
soonData.minutely_15.precipitation_probability[1] = 80;
const soon = analyzeInSandbox(soonData);
assert.ok(soon, "a 15-minute rain signal still earns the immediate nowcast");
assert.match(soon.title, /light rain soon/i, "the high-resolution window retains its familiar immediate wording");

const dryData = clone(base);
dryData.hourly.weather_code[1] = 1;
dryData.hourly.precipitation_probability[1] = 0;
dryData.hourly.precipitation[1] = 0;
assert.equal(analyzeInSandbox(dryData), null, "a fully dry six-hour window stays quiet");

console.log("Precipitation outlook smoke passed.");
