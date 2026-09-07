(function attachNearcastSharedForecast(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NearcastSharedForecast = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function sharedForecastFactory() {
  "use strict";

  const FORECAST_MODELS = Object.freeze([
    { id: "gfs", suffix: "gfs_seamless", name: "NOAA GFS" },
    { id: "gem", suffix: "gem_seamless", name: "Environment Canada GEM" },
    { id: "icon", suffix: "icon_seamless", name: "DWD ICON" }
  ]);

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // Open-Meteo's wall-clock strings belong to the forecast place, not the
  // browser/Worker/device timezone. Preserve the existing shared offset rule.
  function parseTimestamp(value, data = {}) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const local = typeof value === "string" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
      ? value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/)
      : null;
    if (local) {
      return Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] || 0)) - (finite(data.utc_offset_seconds) || 0) * 1000;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function buildForecastParams(options = {}) {
    const unit = options.unit === "celsius" ? "celsius" : "fahrenheit";
    const params = new URLSearchParams({
      latitude: String(options.latitude),
      longitude: String(options.longitude),
      current: "temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,shortwave_radiation,direct_radiation,diffuse_radiation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
      hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,shortwave_radiation,direct_radiation,diffuse_radiation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,uv_index_clear_sky_max,daylight_duration,sunshine_duration,shortwave_radiation_sum,sunrise,sunset",
      temperature_unit: unit,
      wind_speed_unit: unit === "fahrenheit" ? "mph" : "kmh",
      precipitation_unit: options.precipitationUnit === "mm" || options.precipitationUnit === "inch"
        ? options.precipitationUnit : unit === "fahrenheit" ? "inch" : "mm",
      timezone: "auto",
      forecast_days: String(Math.max(1, Math.min(14, Math.trunc(finite(options.forecastDays) ?? 14))))
    });
    if (options.includeMinutely !== false) {
      params.set("minutely_15", "temperature_2m,apparent_temperature,precipitation,precipitation_probability,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,is_day");
      params.set("forecast_minutely_15", "24");
    }
    return params;
  }

  function canonicalCurrentSnapshot(data = {}, options = {}) {
    const current = data.current || {};
    const hourly = data.hourly || {};
    const times = hourly.time || [];
    const now = finite(options.nowMs) ?? Date.now();
    const parse = options.parseTimestamp || parseTimestamp;
    let index = Number.isInteger(options.hourlyIndex) ? options.hourlyIndex : -1;
    if (!Number.isInteger(options.hourlyIndex)) {
      for (let i = 0; i < times.length; i += 1) {
        const at = parse(times[i], data);
        if (!Number.isFinite(at)) continue;
        if (at <= now) index = i;
        else break;
      }
      if (index < 0) {
        let nearestDistance = Infinity;
        times.forEach((time, candidate) => {
          const at = parse(time, data);
          if (!Number.isFinite(at)) return;
          const distance = Math.abs(at - now);
          if (distance <= 90 * 60000 && distance < nearestDistance) {
            nearestDistance = distance;
            index = candidate;
          }
        });
      }
    }
    const currentAt = parse(current.time, data);
    const rowAt = index >= 0 ? parse(times[index], data) : null;
    const currentMatchesLiveHour = Number.isFinite(currentAt) && Number.isFinite(rowAt) &&
      currentAt >= rowAt && currentAt < rowAt + 60 * 60000;
    const currentIsFresh = currentMatchesLiveHour && Math.abs(now - currentAt) <= 75 * 60000;
    const useHourly = !currentIsFresh && index >= 0;
    const pick = (key, fallback = null) => {
      const hourlyValue = index >= 0 ? hourly[key]?.[index] : undefined;
      const currentValue = current[key];
      const selected = useHourly ? hourlyValue : currentValue;
      if (selected !== undefined && selected !== null) return selected;
      if (hourlyValue !== undefined && hourlyValue !== null) return hourlyValue;
      if (currentValue !== undefined && currentValue !== null) return currentValue;
      return fallback;
    };
    const rowTime = index >= 0 ? times[index] : null;
    return {
      ...current,
      time: useHourly && rowTime ? rowTime : current.time,
      temperature_2m: pick("temperature_2m", 0),
      apparent_temperature: pick("apparent_temperature", pick("temperature_2m", 0)),
      relative_humidity_2m: pick("relative_humidity_2m", null),
      precipitation: useHourly ? 0 : Number(current.precipitation || 0),
      weather_code: pick("weather_code", current.weather_code),
      cloud_cover: pick("cloud_cover", current.cloud_cover),
      wind_speed_10m: pick("wind_speed_10m", 0),
      wind_direction_10m: pick("wind_direction_10m", current.wind_direction_10m),
      wind_gusts_10m: pick("wind_gusts_10m", pick("wind_speed_10m", 0)),
      is_day: pick("is_day", current.is_day),
      interval: useHourly ? 3600 : (current.interval || 900),
      hourlyIndex: index,
      basis: useHourly ? "hourly-forecast" : "modeled-current",
      asOfMs: useHourly && rowTime ? parse(rowTime, data) : currentAt,
      evaluationMs: now
    };
  }

  function temperatureBaseline(data) {
    const copy = (value) => Array.isArray(value) ? [...value] : [];
    return {
      hourlyTemperature: copy(data?.hourly?.temperature_2m),
      hourlyApparent: copy(data?.hourly?.apparent_temperature),
      dailyHigh: copy(data?.daily?.temperature_2m_max),
      dailyLow: copy(data?.daily?.temperature_2m_min),
      dailyApparentHigh: copy(data?.daily?.apparent_temperature_max),
      dailyApparentLow: copy(data?.daily?.apparent_temperature_min)
    };
  }

  function medianTemperature(values) {
    const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function normalizeTemperatureGuidance(json, options = {}) {
    const times = Array.isArray(json?.hourly?.time) ? json.hourly.time : [];
    const sources = FORECAST_MODELS.map((model) => {
      const temperatures = json?.hourly?.[`temperature_2m_${model.suffix}`];
      const hours = Array.isArray(temperatures) ? times.map((time, index) => ({
        atMs: parseTimestamp(time, json),
        temperature: finite(temperatures[index])
      })).filter((hour) => hour.atMs !== null && hour.temperature !== null) : [];
      return { id: model.id, status: hours.length >= 24 ? "ready" : "missing", hours };
    });
    return {
      version: 1,
      placeKey: String(options.placeKey || ""),
      fetchedAtMs: finite(options.fetchedAtMs) ?? Date.now(),
      status: sources.filter((source) => source.status === "ready").length >= 2 ? "ready" : "failed",
      sources
    };
  }

  function normalizeNwsEvidence(hourlyJson, dailyJson = null, options = {}) {
    const periods = (hourlyJson?.properties?.periods || [])
      .filter((period) => /\bthunderstorms?\b|\bt-?storms?\b|\btsra\b/i.test([period?.shortForecast, period?.detailedForecast, period?.icon].join(" ")))
      .map((period) => ({
        startMs: new Date(period.startTime).getTime(),
        endMs: new Date(period.endTime).getTime(),
        shortForecast: String(period.shortForecast || "Thunderstorms"),
        probability: finite(period.probabilityOfPrecipitation?.value) ?? 0
      }))
      .filter((period) => Number.isFinite(period.startMs) && Number.isFinite(period.endMs) && period.endMs > period.startMs);
    const byDate = new Map();
    (dailyJson?.properties?.periods || []).forEach((period) => {
      const raw = finite(period?.temperature);
      if (raw === null) return;
      const sourceUnit = String(period.temperatureUnit || "F").toUpperCase();
      const temperature = options.unit === "celsius"
        ? sourceUnit === "C" ? raw : (raw - 32) * 5 / 9
        : sourceUnit === "C" ? raw * 9 / 5 + 32 : raw;
      const date = String(period.isDaytime ? period.startTime || "" : period.endTime || "").slice(0, 10);
      if (!date) return;
      const entry = byDate.get(date) || { date, high: null, low: null };
      if (period.isDaytime) entry.high = temperature;
      else entry.low = temperature;
      byDate.set(date, entry);
    });
    return {
      placeId: String(options.placeId || ""),
      checkedAt: finite(options.checkedAt) ?? Date.now(),
      periods,
      daily: [...byDate.values()]
    };
  }

  // Pure with respect to global application state. The caller owns the data
  // object and original baseline; reapplying new evidence cannot compound an
  // earlier correction. Neither sky/precipitation nor current observations are
  // changed here.
  function applyTemperatureGuidance(data, options = {}) {
    if (!data?.hourly || !data?.daily) return false;
    const baseline = options.baseline || temperatureBaseline(data);
    const times = data.hourly.time || [];
    if (!baseline.hourlyTemperature.length || !times.length) return false;
    data.hourly.temperature_2m = [...baseline.hourlyTemperature];
    if (baseline.hourlyApparent.length) data.hourly.apparent_temperature = [...baseline.hourlyApparent];
    data.daily.temperature_2m_max = [...baseline.dailyHigh];
    data.daily.temperature_2m_min = [...baseline.dailyLow];
    if (baseline.dailyApparentHigh.length) data.daily.apparent_temperature_max = [...baseline.dailyApparentHigh];
    if (baseline.dailyApparentLow.length) data.daily.apparent_temperature_min = [...baseline.dailyApparentLow];

    const parse = options.parseTimestamp || parseTimestamp;
    const nowMs = finite(options.nowMs) ?? Date.now();
    const guidance = options.guidance;
    if (guidance?.status === "ready") {
      // Index once for a bounded 14-day timeline, rather than repeatedly walking
      // every model's full hourly array for each forecast hour.
      const modelMaps = (guidance.sources || []).map((source) => {
        const values = new Map();
        (source.hours || []).forEach((hour) => {
          const atMs = Number(hour.atMs);
          // Preserve the original first-match behavior if a source repeats an
          // hourly timestamp (for example around a local clock transition).
          if (!values.has(atMs)) values.set(atMs, finite(hour.temperature));
        });
        return values;
      });
      times.forEach((time, index) => {
        const atMs = parse(time, data);
        if (!Number.isFinite(atMs) || atMs <= nowMs) return;
        const values = modelMaps.map((model) => model.get(atMs)).map(finite).filter((value) => value !== null);
        const raw = finite(baseline.hourlyTemperature[index]);
        if (values.length < 2 || raw === null) return;
        const consensus = medianTemperature(values);
        data.hourly.temperature_2m[index] = consensus;
        const apparent = finite(baseline.hourlyApparent[index]);
        if (apparent !== null) data.hourly.apparent_temperature[index] = apparent + consensus - raw;
      });
    }

    const indicesByDate = new Map();
    times.forEach((time, index) => {
      const date = String(time || "").slice(0, 10);
      if (!date) return;
      const indices = indicesByDate.get(date) || [];
      indices.push(index);
      indicesByDate.set(date, indices);
    });
    (data.daily.time || []).forEach((date, dayIndex) => {
      const indices = indicesByDate.get(date) || [];
      const nws = (options.nwsDaily || []).find((item) => item.date === date);
      const temperatures = indices.map((index) => finite(data.hourly.temperature_2m[index])).filter((value) => value !== null);
      if (!temperatures.length) return;
      const sourceLow = Math.min(...temperatures);
      const sourceHigh = Math.max(...temperatures);
      const targetLow = finite(nws?.low);
      const targetHigh = finite(nws?.high);
      if (targetLow !== null || targetHigh !== null) {
        indices.forEach((index) => {
          const value = finite(data.hourly.temperature_2m[index]);
          if (value === null) return;
          let adjusted = value;
          if (targetLow !== null && targetHigh !== null && sourceHigh - sourceLow >= 1) {
            adjusted = targetLow + (value - sourceLow) * (targetHigh - targetLow) / (sourceHigh - sourceLow);
          } else if (targetHigh !== null) {
            adjusted = value + targetHigh - sourceHigh;
          } else if (targetLow !== null) {
            adjusted = value + targetLow - sourceLow;
          }
          data.hourly.temperature_2m[index] = adjusted;
          const apparent = finite(data.hourly.apparent_temperature?.[index]);
          if (apparent !== null) data.hourly.apparent_temperature[index] = apparent + adjusted - value;
        });
      }
      const adjusted = indices.map((index) => finite(data.hourly.temperature_2m[index])).filter((value) => value !== null);
      const apparent = indices.map((index) => finite(data.hourly.apparent_temperature?.[index])).filter((value) => value !== null);
      data.daily.temperature_2m_max[dayIndex] = targetHigh ?? Math.max(...adjusted);
      data.daily.temperature_2m_min[dayIndex] = targetLow ?? Math.min(...adjusted);
      if (apparent.length) {
        if (!Array.isArray(data.daily.apparent_temperature_max)) data.daily.apparent_temperature_max = [];
        if (!Array.isArray(data.daily.apparent_temperature_min)) data.daily.apparent_temperature_min = [];
        data.daily.apparent_temperature_max[dayIndex] = Math.max(...apparent);
        data.daily.apparent_temperature_min[dayIndex] = Math.min(...apparent);
      }
    });
    return true;
  }

  return { FORECAST_MODELS, parseTimestamp, buildForecastParams, canonicalCurrentSnapshot, temperatureBaseline, normalizeTemperatureGuidance, normalizeNwsEvidence, applyTemperatureGuidance };
}));
