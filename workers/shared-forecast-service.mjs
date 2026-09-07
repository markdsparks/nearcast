import "../shared-forecast.js";
import "../current-reality.js";

const shared = globalThis.NearcastSharedForecast;
const CACHE_SECONDS = 300;
const inflight = new Map();
const NWS_HEADERS = { Accept: "application/geo+json", "User-Agent": "Nearcast/3.0 (+https://getnearcast.app)" };

function coordinate(value, limit) {
  if (value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? Number(number.toFixed(3)) : null;
}

function response(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}` : "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    }
  });
}

async function json(url, fetcher, { headers, timeout = 6500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const result = await fetcher(url, { headers, signal: controller.signal });
    if (!result.ok) throw new Error("forecast-provider-unavailable");
    return await result.json();
  } finally {
    clearTimeout(timer);
  }
}

async function optionalWithin(promise, timeout = 7500) {
  let timer;
  try {
    return await Promise.race([promise.catch(() => null), new Promise(resolve => {
      timer = setTimeout(() => resolve(null), timeout);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function nwsEvidence(latitude, longitude, unit, fetcher, nowMs) {
  const point = await json(`https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`, fetcher, {
    headers: NWS_HEADERS, timeout: 3500
  });
  const read = async url => {
    // Provider links are data, never permission to request arbitrary hosts.
    if (!/^https:\/\/api\.weather\.gov\//.test(String(url || ""))) return null;
    return json(url, fetcher, { headers: NWS_HEADERS, timeout: 3500 }).catch(() => null);
  };
  const [hourly, daily] = await Promise.all([read(point?.properties?.forecastHourly), read(point?.properties?.forecast)]);
  if (!hourly && !daily) return null;
  return { ...shared.normalizeNwsEvidence(hourly, daily, { unit, checkedAt: nowMs }),
    hourlyAvailable: Boolean(hourly), dailyAvailable: Boolean(daily) };
}

export async function buildSharedForecast({ latitude, longitude, unit, precipitationUnit, fetcher = fetch, observationsLoader, nowMs = Date.now() }) {
  const params = shared.buildForecastParams({ latitude, longitude, unit, precipitationUnit });
  const guidanceParams = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), hourly: "temperature_2m",
    models: shared.FORECAST_MODELS.map(model => model.suffix).join(","),
    forecast_days: "14", temperature_unit: unit, timezone: "auto"
  });
  // Existing providers only. Independent guidance is optional and bounded;
  // a missing source is represented as missing, never as agreement.
  const primary = json(`https://api.open-meteo.com/v1/forecast?${params}`, fetcher);
  const guidance = optionalWithin(json(`https://api.open-meteo.com/v1/forecast?${guidanceParams}`, fetcher));
  const nws = optionalWithin(nwsEvidence(latitude, longitude, unit, fetcher, nowMs));
  const observations = observationsLoader
    ? optionalWithin(Promise.resolve().then(() => observationsLoader(latitude, longitude)))
    : Promise.resolve(null);
  const [data, guidanceJson, nwsData, observationData] = await Promise.all([primary, guidance, nws, observations]);
  if (!data?.current || !Array.isArray(data?.hourly?.time) || !Array.isArray(data?.daily?.time) || !data?.timezone) {
    throw new Error("forecast-provider-invalid");
  }
  const baseline = shared.temperatureBaseline(data);
  const temperatureGuidance = guidanceJson ? shared.normalizeTemperatureGuidance(guidanceJson, { fetchedAtMs: nowMs }) : null;
  const rawCurrent = { ...data.current };
  shared.applyTemperatureGuidance(data, { baseline, guidance: temperatureGuidance, nwsDaily: nwsData?.daily || [], nowMs });
  const resolvedCurrent = shared.canonicalCurrentSnapshot(data, { nowMs });
  const numeric = value => typeof value === "number" && Number.isFinite(value);
  const required = ["temperature_2m", "apparent_temperature", "weather_code", "wind_speed_10m", "wind_direction_10m", "is_day"];
  if (required.some(key => !numeric(rawCurrent[key]) && !numeric(data.hourly[key]?.[resolvedCurrent.hourlyIndex]))) {
    // Native current fields are required. Fail back to the last known forecast
    // instead of transporting defaults that look like real zero readings.
    throw new Error("forecast-current-incomplete");
  }
  data.current = resolvedCurrent;
  const reality = observationData?.status === "ready"
    ? globalThis.NearcastCurrentReality.currentRealityPresentation({ nowMs, unit, current: data.current, observations: observationData })
    : null;
  if (reality?.applied) {
    data.current.temperature_2m = reality.temperature_2m;
    data.current.apparent_temperature = reality.apparent_temperature;
  }
  data._nearcastForecast = {
    version: 1, generatedAtMs: nowMs, latitude, longitude, unit, precipitationUnit,
    sources: {
      temperature: temperatureGuidance?.status === "ready" ? "ready" : "unavailable",
      nws: nwsData ? (nwsData.hourlyAvailable && nwsData.dailyAvailable ? "ready" : "partial") : "unavailable",
      observations: observationData?.status === "ready" ? "ready" : "unavailable"
    },
    baseline, rawCurrent, temperatureGuidance, nws: nwsData,
    observations: observationData?.status === "ready" ? observationData : null,
    nearbyApplied: Boolean(reality?.applied)
  };
  return data;
}

export async function handleSharedForecastRequest(request, env = {}, ctx = {}, dependencies = {}) {
  if (request.method === "OPTIONS") return response(null, 204);
  if (request.method !== "GET") return response({ error: "method-not-allowed" }, 405);
  const url = new URL(request.url);
  const latitude = coordinate(url.searchParams.get("lat"), 90);
  const longitude = coordinate(url.searchParams.get("lon"), 180);
  const unit = url.searchParams.get("unit") || "fahrenheit";
  const precipitationUnit = url.searchParams.get("precipitation_unit") || (unit === "fahrenheit" ? "inch" : "mm");
  if (latitude === null || longitude === null || !["fahrenheit", "celsius"].includes(unit) || !["inch", "mm"].includes(precipitationUnit)) {
    return response({ error: "invalid-forecast-request" }, 400);
  }
  const cacheUrl = new URL("/api/forecast", url.origin);
  cacheUrl.search = new URLSearchParams({ lat: latitude.toFixed(3), lon: longitude.toFixed(3), unit, precipitation_unit: precipitationUnit }).toString();
  const key = cacheUrl.toString();
  const cache = dependencies.cache ?? globalThis.caches?.default;
  const cached = cache ? await cache.match(new Request(key)) : null;
  if (cached) return cached;
  const limiter = env.FORECAST_RATE_LIMITER;
  if (limiter?.limit) {
    const result = await limiter.limit({ key: request.headers.get("CF-Connecting-IP") || "anonymous" });
    if (!result.success) return response({ error: "forecast-rate-limited" }, 429);
  }
  try {
    let pending = inflight.get(key);
    if (!pending) {
      pending = buildSharedForecast({ latitude, longitude, unit, precipitationUnit,
        fetcher: dependencies.fetcher, observationsLoader: dependencies.observationsLoader, nowMs: dependencies.nowMs })
        .finally(() => { if (inflight.get(key) === pending) inflight.delete(key); });
      inflight.set(key, pending);
    }
    const result = response(await pending);
    if (cache) {
      const write = cache.put(new Request(key), result.clone()).catch(() => {});
      if (ctx.waitUntil) ctx.waitUntil(write);
      else await write;
    }
    return result;
  } catch {
    return response({ error: "forecast-unavailable" }, 503);
  }
}
