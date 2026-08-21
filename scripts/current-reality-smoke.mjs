import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "current-reality.js"), "utf8");
const sandbox = { module: { exports: {} }, exports: {}, console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "current-reality.js" });

const currentRealityPresentation = sandbox.module.exports.currentRealityPresentation;
assert.equal(typeof currentRealityPresentation, "function", "reality layer exports a pure presentation boundary");

const nowMs = Date.UTC(2026, 7, 21, 18, 0, 0);
const base = {
  nowMs,
  unit: "fahrenheit",
  current: { temperature_2m: 75, apparent_temperature: 78 },
  observations: {
    stations: [{
      id: "KTEST",
      name: "Test airport",
      distanceKm: 12,
      observedAtMs: nowMs - 8 * 60 * 1000,
      temperatureC: 20,
      provider: "NWS"
    }]
  }
};

const localized = currentRealityPresentation(base);
assert.equal(localized.status, "localized", "a fresh station within 25 km can calibrate the local model");
assert.equal(localized.basis, "localized-nearby-observations", "station calibration never claims an exact-place observation");
assert.equal(Math.round(localized.temperature_2m), 72, "single-station adjustment is conservatively capped at 3°F");
assert.equal(Math.round(localized.apparent_temperature), 75, "feels-like follows the bounded local calibration");
assert.equal(localized.nearestStation.distanceKm, 12, "station distance remains explicit for receipts");
assert.match(localized.stationLabel, /nearby observation/i, "receipt language stays human and non-technical");

const celsius = currentRealityPresentation({
  ...base,
  unit: "°C",
  current: { temperature_2m: 22, apparent_temperature: 24 }
});
assert.equal(Math.round(celsius.temperature_2m), 20, "Celsius forecasts keep nearby NWS observations in Celsius");

const agreeing = currentRealityPresentation({
  ...base,
  current: { temperature_2m: 78, apparent_temperature: 80 },
  observations: {
    stations: [
      { ...base.observations.stations[0], id: "A", temperatureC: 23, distanceKm: 15 },
      { ...base.observations.stations[0], id: "B", temperatureC: 23.6, distanceKm: 28 }
    ]
  }
});
assert.equal(agreeing.status, "localized", "two agreeing nearby stations can make a bounded calibration");
assert.equal(agreeing.stationCount, 2, "all supporting stations remain visible to the receipt");
assert.ok(agreeing.spread < 2, "agreement is measured before calibration");

const corroborated = currentRealityPresentation({
  ...base,
  current: { temperature_2m: 68.1, apparent_temperature: 70.1 }
});
assert.equal(corroborated.status, "corroborated", "tiny bias does not make the hero visibly jump");
assert.equal(corroborated.applied, false, "corroboration is evidence, not a needless replacement");
assert.equal(corroborated.temperature_2m, 68.1, "the modeled exact-place temperature remains intact when correction is negligible");

const stale = currentRealityPresentation({
  ...base,
  observations: {
    stations: [{ ...base.observations.stations[0], observedAtMs: nowMs - 46 * 60 * 1000 }]
  }
});
assert.equal(stale.status, "estimated", "observations older than 45 minutes never calibrate Now");

const disagreeing = currentRealityPresentation({
  ...base,
  observations: {
    stations: [
      { ...base.observations.stations[0], id: "A", temperatureC: 17, distanceKm: 12 },
      { ...base.observations.stations[0], id: "B", temperatureC: 24, distanceKm: 18 }
    ]
  }
});
assert.equal(disagreeing.status, "estimated", "disagreeing stations never turn into a fabricated local certainty");
assert.equal(disagreeing.reason, "nearby-observations-disagree", "the reason stays available for diagnostics without surfacing as primary UI");

const before = JSON.stringify(base);
currentRealityPresentation(base);
assert.equal(JSON.stringify(base), before, "reality calibration is pure and does not mutate forecast or observation input");

console.log("PASS  current reality calibration smoke");
