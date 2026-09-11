import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../shared-forecast.js";
import "../current-reality.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const shared = globalThis.NearcastSharedForecast;
const realNow = Date.parse("2026-09-07T10:59:00-05:00");
let now = realNow;
class Clock extends Date { static now() { return now; } }
const place = { id: "home", latitude: 38.723, longitude: -89.956 };
const times = Array.from({ length: 24 }, (_, i) => `2026-09-07T${String(i).padStart(2, "0")}:00`);
const raw = {
  timezone: "America/Chicago", utc_offset_seconds: -18000,
  current: { time: "2026-09-07T10:45", temperature_2m: 80, apparent_temperature: 82, weather_code: 3, precipitation: 0, is_day: 1 },
  current_units: { temperature_2m: "°F" },
  hourly: { time: times, temperature_2m: times.map((_, i) => 70 + i), apparent_temperature: times.map((_, i) => 72 + i) },
  daily: { time: ["2026-09-07"], temperature_2m_max: [93], temperature_2m_min: [70] }
};
const wire = structuredClone(raw);
const baseline = shared.temperatureBaseline(raw);
const guidance = shared.normalizeTemperatureGuidance({ utc_offset_seconds: -18000, hourly: {
  time: times, temperature_2m_gfs_seamless: times.map(() => 85), temperature_2m_gem_seamless: times.map(() => 87)
} }, { fetchedAtMs: realNow });
shared.applyTemperatureGuidance(wire, { baseline, guidance, nowMs: realNow });
wire._nearcastForecast = { version: 1, latitude: place.latitude, longitude: place.longitude, unit: "fahrenheit", generatedAtMs: realNow,
  baseline, rawCurrent: structuredClone(raw.current), temperatureGuidance: guidance,
  sources: { temperature: "ready", nws: "unavailable", observations: "unavailable" } };
const storage = new Map();
let resolveFetch;
const context = {
  NearcastSharedForecast: shared, NearcastCurrentReality: globalThis.NearcastCurrentReality,
  Date: Clock, URL, URLSearchParams, console,
  state: { unit: "fahrenheit", activePlace: place }, window: { location: { origin: "https://getnearcast.app" } },
  forecastTemperatureBaselineByForecast: new WeakMap(), forecastTemperatureGuidanceByForecast: new WeakMap(),
  nwsConvectiveEvidenceByForecast: new WeakMap(), currentRealityByForecast: new WeakMap(),
  FORECAST_TEMPERATURE_GUIDANCE_CACHE_FALLBACK_MS: 3 * 3600000,
  FORECAST_CACHE_MAX_AGE_MS: 900000, FORECAST_CACHE_FALLBACK_MAX_AGE_MS: 6 * 3600000, FORECAST_FETCH_TIMEOUT_MS: 10000,
  forecastNowMs: () => now, parseForecastTimestamp: shared.parseTimestamp,
  currentHourlyIndex: data => shared.canonicalCurrentSnapshot(data, { nowMs: now }).hourlyIndex,
  continuityPlaceKey: p => p.id, currentRealityPlaceKey: p => p.id,
  currentRealityForForecast: data => context.currentRealityByForecast.get(data),
  forecastCacheKey: (p, unit) => `${p.id}:${unit}`, readForecastCache: () => null,
  forecastProvenance: data => data._nearcastMeta || {},
  markForecastProvenance: (data, meta) => { data._nearcastMeta = meta; return data; },
  fetchAirQuality: async () => null,
  localStorage: { setItem: (key, value) => storage.set(key, value) },
  fetchJsonWithTimeout: () => new Promise(resolve => { resolveFetch = resolve; })
};
vm.createContext(context);
const names = ["writeStorageJsonBestEffort", "sharedForecastMetadata", "sharedForecastSourceIsFresh", "hydrateSharedForecast", "forecastTemperatureGuidanceBaseline", "rebuildForecastTemperatures", "canonicalCurrentSnapshot", "bindCurrentReality", "fetchForecast", "convertForecastUnits", "convertFields", "convertNumber", "converterForUnit", "updateForecastUnitLabels"];
for (const name of names) {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  const rest = app.slice(start);
  const next = rest.slice(1).search(/\n(?:async )?function /);
  vm.runInContext(next < 0 ? rest : rest.slice(0, next + 1), context);
}
const hydrated = context.hydrateSharedForecast(structuredClone(wire), place);
assert.deepEqual(hydrated.hourly.temperature_2m, wire.hourly.temperature_2m);
now += 2 * 60000;
const crossed = context.hydrateSharedForecast(structuredClone(wire), place);
assert.equal(crossed.hourly.temperature_2m[11], 86, "cached boundary retains service consensus, not raw81");
assert.equal(context.canonicalCurrentSnapshot(crossed).temperature_2m, 86, "new current hour uses the same calibrated row");
assert.equal(context.sharedForecastSourceIsFresh(crossed, place, "temperature", 1800000), true);
assert.equal(context.sharedForecastMetadata(wire, { ...place, latitude: 40 }), null);
assert.equal(context.sharedForecastMetadata(wire, place, "celsius"), null);
const unchanged = context.hydrateSharedForecast(structuredClone(wire), { ...place, latitude: 40 });
assert.equal(context.forecastTemperatureBaselineByForecast.has(unchanged), false, "cross-place metadata cannot bind");
now += 4 * 3600000;
const stale = context.hydrateSharedForecast(structuredClone(wire), place);
assert.equal(context.forecastTemperatureBaselineByForecast.get(stale).hourlyTemperature[11], 81, "old fallback still retains original baseline");
assert.equal(context.forecastTemperatureGuidanceByForecast.has(stale), false, "expired evidence is not refreshed by reading cache");
assert.equal(context.sharedForecastSourceIsFresh(stale, place, "temperature", 1800000), false);
now = realNow;
const converted = context.convertForecastUnits(hydrated, "fahrenheit", "celsius");
assert.equal(converted._nearcastForecast, undefined);
assert.ok(Math.abs(context.forecastTemperatureBaselineByForecast.get(converted).hourlyTemperature[11] - (81 - 32) * 5 / 9) < 1e-8);
context.rebuildForecastTemperatures(converted, realNow);
assert.ok(Math.abs(converted.hourly.temperature_2m[11] - 30) < 1e-8, "later evidence cannot compound old-unit correction");

const pending = context.fetchForecast(place, true);
context.state.unit = "celsius";
resolveFetch(structuredClone(wire));
const changedUnits = await pending;
assert.ok(Math.abs(changedUnits.current.temperature_2m - (80 - 32) * 5 / 9) < 1e-8, "in-flight F response is rendered in latest C preference");
assert.equal(changedUnits.current_units.temperature_2m, "°C");
assert.equal(JSON.parse(storage.get("home:fahrenheit")).savedAt, realNow, "cache age is generation age, not receipt age");
context.state.unit = "fahrenheit";
const savedBefore = [...storage.entries()];
for (const name of ["QuotaExceededError", "SecurityError"]) {
  context.localStorage.setItem = () => { const error = new Error("Storage unavailable"); error.name = name; throw error; };
  assert.equal(context.writeStorageJsonBestEffort("weather-last-place", place), false, "remembering a place is optional");
  const fresh = context.fetchForecast(place, true);
  resolveFetch(structuredClone(wire));
  const result = await fresh;
  assert.equal(result.current.temperature_2m, 80, `${name} cannot discard downloaded weather`);
  assert.equal(result._nearcastMeta.source, "network");
  assert.equal(result._nearcastMeta.cacheFallback, false, "failed save does not relabel fresh weather as stale");
  assert.deepEqual([...storage.entries()], savedBefore, "no other cached or personal data is removed");
}
assert.match(app, /uses24HourClock:\s*prefersTwentyFourHourClock\(\)/);
console.log("PASS Shared forecast web integration: same values, boundary, place isolation, old cache, unit race, clock bridge");
