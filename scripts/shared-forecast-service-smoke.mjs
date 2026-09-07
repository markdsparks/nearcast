import assert from "node:assert/strict";
import { buildSharedForecast, handleSharedForecastRequest, fetchPrimaryForecast } from "../workers/shared-forecast-service.mjs";

const nowMs = Date.parse("2026-09-07T10:30:00-05:00");
let attempts = 0;
assert.deepEqual(await fetchPrimaryForecast("https://api.open-meteo.com/test", async () => {
  if (++attempts === 1) throw new DOMException("timeout", "AbortError");
  return Response.json({ ready: true });
}), { ready: true });
assert.equal(attempts, 2, "one short retry recovers a cold timeout");
attempts = 0;
await assert.rejects(fetchPrimaryForecast("https://api.open-meteo.com/test", async () => {
  attempts++; return new Response("limited", { status: 429 });
}), /429/);
assert.equal(attempts, 1, "provider throttling is never retried");
attempts = 0;
await assert.rejects(fetchPrimaryForecast("https://api.open-meteo.com/test", async () => {
  attempts++; throw new DOMException("timeout", "AbortError");
}), { name: "AbortError" });
assert.equal(attempts, 2, "persistent timeouts stay bounded");
const time = Array.from({ length: 48 }, (_, i) => `2026-09-${i < 24 ? "07" : "08"}T${String(i % 24).padStart(2, "0")}:00`);
const base = () => ({
  timezone: "America/Chicago", utc_offset_seconds: -18000,
  current: { time: "2026-09-07T10:30", temperature_2m: 80, apparent_temperature: 82, weather_code: 3, precipitation: 0, is_day: 1, wind_speed_10m: 4, wind_direction_10m: 90 },
  hourly: { time, temperature_2m: time.map((_, i) => 70 + i % 24), apparent_temperature: time.map((_, i) => 72 + i % 24), weather_code: time.map(() => 3), precipitation: time.map(() => 0) },
  daily: { time: ["2026-09-07", "2026-09-08"], temperature_2m_max: [93, 93], temperature_2m_min: [70, 70] }
});
const guidance = () => ({ utc_offset_seconds: -18000, hourly: {
  time, temperature_2m_gfs_seamless: time.map(() => 86), temperature_2m_gem_seamless: time.map(() => 88), temperature_2m_icon_seamless: time.map(() => 110)
} });
const observations = { status: "ready", fetchedAtMs: nowMs, stations: [
  { id: "station", distanceKm: 4, observedAtMs: nowMs - 600000, temperatureC: 29 }
] };
const requests = [];
const fetcher = async input => {
  const url = new URL(input); requests.push(url);
  let body;
  if (url.hostname === "api.open-meteo.com") body = url.searchParams.has("models") ? guidance() : base();
  else if (url.pathname.startsWith("/points/")) body = { properties: { forecastHourly: "https://api.weather.gov/hourly", forecast: "https://api.weather.gov/daily" } };
  else if (url.pathname === "/hourly") body = { properties: { periods: [{ startTime: "2026-09-07T10:00:00-05:00", endTime: "2026-09-07T12:00:00-05:00", shortForecast: "Slight chance thunderstorms", probabilityOfPrecipitation: { value: 20 } }] } };
  else if (url.pathname === "/daily") body = { properties: { periods: [{ startTime: "2026-09-07T06:00:00-05:00", endTime: "2026-09-07T18:00:00-05:00", isDaytime: true, temperature: 95, temperatureUnit: "F" }] } };
  else throw new Error(`Unexpected provider ${url}`);
  return Response.json(body);
};
const options = { latitude: 38.723, longitude: -89.956, unit: "fahrenheit", precipitationUnit: "mm", fetcher, observationsLoader: async () => observations, nowMs };
const result = await buildSharedForecast(options);
assert.equal(result.daily.temperature_2m_max[0], 95, "NWS high corrects the raw model");
assert.equal(result.daily.temperature_2m_max[1], 88, "three-model median tempers long-range outlier");
assert.equal(result.current.temperature_2m, 83, "nearby correction retains its physical cap");
assert.equal(result.current.apparent_temperature, 85);
assert.equal(result.current.weather_code, 3, "official thunder possibility is not rewritten as observed thunder");
assert.equal(result._nearcastForecast.nws.periods[0].probability, 20);
assert.equal(result._nearcastForecast.rawCurrent.temperature_2m, 80);
assert.equal(result._nearcastForecast.baseline.dailyHigh[0], 93);
assert.equal(result._nearcastForecast.generatedAtMs, nowMs);
assert.equal(result._nearcastForecast.nearbyApplied, true);
assert.ok(requests.filter(url => url.hostname === "api.open-meteo.com").every(url => !url.searchParams.has("forecast_hours")), "calibration sees complete civil days");
assert.equal(requests[0].searchParams.get("precipitation_unit"), "mm");

const unavailable = async input => new URL(input).hostname === "api.open-meteo.com" && !new URL(input).searchParams.has("models")
  ? Response.json(base()) : new Response("unavailable", { status: 503 });
const fallback = await buildSharedForecast({ ...options, fetcher: unavailable, observationsLoader: async () => { throw new Error("offline"); } });
assert.equal(fallback.current.temperature_2m, 80);
assert.deepEqual(fallback._nearcastForecast.sources, { temperature: "unavailable", nws: "unavailable", observations: "unavailable" });
assert.equal(fallback._nearcastForecast.nearbyApplied, false);
const stale = await buildSharedForecast({ ...options, observationsLoader: async () => ({ ...observations, stations: observations.stations.map(s => ({ ...s, observedAtMs: nowMs - 3600000 })) }) });
assert.equal(stale.current.temperature_2m, 80, "stale station cannot change current temperature");
await assert.rejects(buildSharedForecast({ ...options, fetcher: async input => {
  const result = await fetcher(input);
  const data = await result.json();
  if (data.current) data.current.wind_speed_10m = null;
  return Response.json(data);
} }), /forecast-current-incomplete/, "missing required readings never become invented zeros");

for (const query of ["lat=&lon=1", "lat=91&lon=1", "lat=1&lon=-181", "lat=1&lon=2&unit=kelvin", "lat=1&lon=2&precipitation_unit=cm"]) {
  const r = await handleSharedForecastRequest(new Request(`https://example.com/api/forecast?${query}`));
  assert.equal(r.status, 400);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
}
assert.equal((await handleSharedForecastRequest(new Request("https://example.com/api/forecast", { method: "OPTIONS" }))).status, 204);
assert.equal((await handleSharedForecastRequest(new Request("https://example.com/api/forecast", { method: "POST" }))).status, 405);
const cachedValues = new Map();
const cache = { match: async key => cachedValues.get(key.url)?.clone(), put: async (key, value) => { cachedValues.set(key.url, value); } };
const dependencies = { ...options, cache };
const url = "https://example.com/api/forecast?lat=38.72311&lon=-89.95591&unit=fahrenheit&precipitation_unit=mm";
const initial = await handleSharedForecastRequest(new Request(url), {}, {}, dependencies);
const requestCount = requests.length;
const again = await handleSharedForecastRequest(new Request(url + "&placeName=NeverStoreThis"), {}, {}, dependencies);
assert.equal(requests.length, requestCount, "rounded place/unit cache reuses the shared forecast");
assert.deepEqual(await initial.json(), await again.json(), "cache preserves generation timestamp, not request time");
assert.ok([...cachedValues.keys()].every(key => !key.includes("NeverStoreThis")), "no place text in cache keys");
await handleSharedForecastRequest(new Request(url.replace("unit=fahrenheit", "unit=celsius")), {}, {}, dependencies);
assert.equal(cachedValues.size, 2, "temperature units partition the cache");
const limited = await handleSharedForecastRequest(new Request(url.replace("38.72311", "38.800")), { FORECAST_RATE_LIMITER: { limit: async () => ({ success: false }) } }, {}, dependencies);
assert.equal(limited.status, 429);
const failure = await handleSharedForecastRequest(new Request(url.replace("38.72311", "39.800")), {}, {}, { fetcher: async () => new Response("offline", { status: 503 }) });
assert.equal(failure.status, 503, "primary outage never produces a successful empty forecast");
console.log("PASS Shared forecast service: corrections, source failures, freshness, units, cache, validation, rate limit");
