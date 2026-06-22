/* Nearcast immersive sky and atmosphere renderer. */

// ── Sky Canvas ────────────────────────────────────────────────────────────────

const SKY_CFG = {
  night: {
    clear:           { bg: "linear-gradient(160deg,#04080f 0%,#091428 55%,#0d1c3c 100%)", stars: 85, moon: true,  moonGlow: false, sun: false, clouds: 0, rain: false, snow: false, lightning: false },
    "partly-cloudy": { bg: "linear-gradient(160deg,#070b16 0%,#0c1630 100%)",             stars: 30, moon: true,  moonGlow: false, sun: false, clouds: 2, rain: false, snow: false, lightning: false },
    overcast:        { bg: "linear-gradient(160deg,#090b11 0%,#131720 100%)",             stars: 0,  moon: false, moonGlow: true,  sun: false, clouds: 4, rain: false, snow: false, lightning: false },
    rain:            { bg: "linear-gradient(160deg,#050709 0%,#0b0e16 100%)",             stars: 0,  moon: false, moonGlow: false, sun: false, clouds: 4, rain: true,  snow: false, lightning: false },
    snow:            { bg: "linear-gradient(160deg,#090d18 0%,#111828 100%)",             stars: 0,  moon: false, moonGlow: true,  sun: false, clouds: 3, rain: false, snow: true,  lightning: false },
    thunder:         { bg: "linear-gradient(160deg,#040406 0%,#09090e 100%)",             stars: 0,  moon: false, moonGlow: false, sun: false, clouds: 5, rain: true,  snow: false, lightning: true  }
  },
  day: {
    clear:           { bg: "linear-gradient(180deg,#7fa8d8 0%,#b6d2ea 48%,#dcecf6 100%)", stars: 0, moon: false, moonGlow: false, sun: true,  clouds: 0, rain: false, snow: false, lightning: false },
    "partly-cloudy": { bg: "linear-gradient(180deg,#86add9 0%,#bfd8eb 58%,#e3eef6 100%)", stars: 0, moon: false, moonGlow: false, sun: true,  clouds: 2, rain: false, snow: false, lightning: false },
    overcast:        { bg: "linear-gradient(180deg,#92a8b6 0%,#bac8d2 58%,#dce5ea 100%)", stars: 0, moon: false, moonGlow: false, sun: false, clouds: 5, rain: false, snow: false, lightning: false },
    rain:            { bg: "linear-gradient(180deg,#718796 0%,#aab8c2 58%,#d3dce2 100%)", stars: 0, moon: false, moonGlow: false, sun: false, clouds: 4, rain: true,  snow: false, lightning: false },
    snow:            { bg: "linear-gradient(180deg,#a5b7c5 0%,#cbd8e0 58%,#edf3f6 100%)", stars: 0, moon: false, moonGlow: false, sun: false, clouds: 3, rain: false, snow: true,  lightning: false },
    thunder:         { bg: "linear-gradient(180deg,#4f6070 0%,#808f9b 58%,#b9c5cf 100%)", stars: 0, moon: false, moonGlow: false, sun: false, clouds: 5, rain: true,  snow: false, lightning: true  }
  }
};

const SKY_SCENE_VERSION = "sky-v3";

function skySceneSeed(condition, isDay) {
  const place = state.activePlace
    ? `${state.activePlace.id || state.activePlace.name || "place"}:${Number(state.activePlace.latitude || 0).toFixed(2)}:${Number(state.activePlace.longitude || 0).toFixed(2)}`
    : "no-place";
  const day = state.skyState?.dayKey || datePart(state.forecast?.current?.time) || datePart(new Date()) || "today";
  return skyHash(`${SKY_SCENE_VERSION}|${place}|${day}|${condition}|${isDay ? "day" : "night"}`);
}

function skyHash(value) {
  let h = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

function seededSkyRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function skyCondition(code) {
  if (code === RAIN_LIKELY_CODE) return "overcast";
  if (code <= 1) return "clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3 || code === 45 || code === 48) return "overcast";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "overcast";
}

// ---- Immersive sky: live solar light + weather texture ----------------------

const SKY_FORECAST_EDGE_MS = 60 * 60 * 1000;
const SKY_RENDER_OVERSCAN_PX = 360;

function skyNow(data = state.forecast) {
  return skyNowMs(data);
}

function skyNowMs(data = state.forecast) {
  const live = Date.now();
  const times = data?.hourly?.time || [];
  const first = parseForecastTimestamp(times[0], data);
  const last = parseForecastTimestamp(times[times.length - 1], data);

  if (
    Number.isFinite(live) &&
    first !== null &&
    last !== null &&
    live >= first - SKY_FORECAST_EDGE_MS &&
    live <= last + SKY_FORECAST_EDGE_MS
  ) {
    return live;
  }

  const forecastNow = forecastNowMs(data);
  return Number.isFinite(forecastNow) ? forecastNow : live;
}

function skyNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function skySeriesValue(series, index, fallback = null) {
  if (!series || index < 0 || series[index] === undefined || series[index] === null) return fallback;
  return skyNumber(series[index], fallback);
}

function skyWindMph(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 0;
  return state.unit === "fahrenheit" ? speed : speed / 1.609344;
}

function skyPrecipPressure(precipTruth = {}) {
  const phase = precipTruth?.phase;
  const chance = clamp01((precipTruth?.chance || 0) / 100);
  if (phase === "active") {
    return clamp01(0.56 + chance * 0.24);
  }
  if (phase === "imminent") {
    const lead = Number.isFinite(precipTruth.startsInMin)
      ? clamp01(1 - precipTruth.startsInMin / IMMINENT_PRECIP_MINUTES)
      : 0.4;
    return clamp01(0.16 + lead * 0.36 + chance * 0.22);
  }
  if (phase === "likely-this-hour") {
    return clamp01(0.18 + chance * 0.24 + (precipTruth.visualWet ? 0.10 : 0));
  }
  if (phase === "possible-this-hour") {
    return clamp01(0.08 + chance * 0.12);
  }
  if (phase === "possible-later" && Number.isFinite(precipTruth.startsInMin) && precipTruth.startsInMin <= 120) {
    return clamp01(0.05 + (1 - precipTruth.startsInMin / 120) * 0.12);
  }
  return 0;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function forecastLocalDateFromMs(ms, data = state.forecast) {
  if (!Number.isFinite(ms)) return datePart(data?.current?.time) || datePart(Date.now());
  const d = new Date(ms + forecastOffsetMs(data));
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function forecastLocalHourFromMs(ms, data = state.forecast) {
  const d = new Date(ms + forecastOffsetMs(data));
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

function skySolarPosition(ms, place = state.activePlace) {
  const lat = Number(place?.latitude);
  const lon = Number(place?.longitude);
  if (!Number.isFinite(ms) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const d = new Date(ms);
  const dayStart = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dayStart) / 86400000);
  const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (minutesUtc / 60 - 12) / 24);
  const eqTime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
  const decl = (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
  const trueSolarTime = ((minutesUtc + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const hourAngleDeg = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const hourAngle = hourAngleDeg * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const cosZenith = clamp(
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle),
    -1,
    1
  );
  const elevation = 90 - Math.acos(cosZenith) * 180 / Math.PI;
  const azRad = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(decl) * Math.cos(latRad)
  );
  const azimuth = (azRad * 180 / Math.PI + 180 + 360) % 360;
  return { elevation, azimuth };
}

function skyHourlySample(data, ms, displayCondition = {}) {
  const current = data?.current || {};
  const idx = nearestHourlyIndexAt(data, ms, 90 * 60 * 1000);
  const h = data?.hourly || {};
  return {
    index: idx,
    cloud: skySeriesValue(h.cloud_cover, idx, displayCondition.cloud ?? current.cloud_cover),
    lowCloud: skySeriesValue(h.cloud_cover_low, idx, current.cloud_cover_low),
    midCloud: skySeriesValue(h.cloud_cover_mid, idx, current.cloud_cover_mid),
    highCloud: skySeriesValue(h.cloud_cover_high, idx, current.cloud_cover_high),
    visibility: skySeriesValue(h.visibility, idx, current.visibility),
    precipitation: skySeriesValue(h.precipitation, idx, current.precipitation),
    pop: skySeriesValue(h.precipitation_probability, idx, displayCondition.pop),
    shortwave: skySeriesValue(h.shortwave_radiation, idx, current.shortwave_radiation),
    direct: skySeriesValue(h.direct_radiation, idx, current.direct_radiation),
    diffuse: skySeriesValue(h.diffuse_radiation, idx, current.diffuse_radiation),
    uv: skySeriesValue(h.uv_index, idx, null),
    wind: skySeriesValue(h.wind_speed_10m, idx, current.wind_speed_10m),
    gust: skySeriesValue(h.wind_gusts_10m, idx, current.wind_gusts_10m),
    isDay: h.is_day && idx >= 0 ? Boolean(h.is_day[idx]) : current.is_day !== undefined ? Boolean(current.is_day) : null
  };
}

function deriveSkyState(weatherCode, isDay, data = state.forecast, displayCondition = {}) {
  const now = skyNowMs(data);
  const condition = skyCondition(weatherCode ?? displayCondition.code ?? data?.current?.weather_code ?? 3);
  const dayIndex = forecastDailyIndex(data);
  const sunriseMs = state.sunriseMs ?? parseForecastTimestamp(data?.daily?.sunrise?.[dayIndex], data);
  const sunsetMs = state.sunsetMs ?? parseForecastTimestamp(data?.daily?.sunset?.[dayIndex], data);
  const sample = skyHourlySample(data, now, displayCondition);
  const solar = skySolarPosition(now);
  const span = sunriseMs !== null && sunsetMs !== null && sunsetMs > sunriseMs ? sunsetMs - sunriseMs : null;
  const dayProgress = span ? clamp01((now - sunriseMs) / span) : clamp01((forecastLocalHourFromMs(now, data) - 6) / 12);
  const liveIsDay = span ? now >= sunriseMs && now <= sunsetMs : (solar?.elevation ?? 0) > -0.8;
  const effectiveIsDay = liveIsDay || (isDay === true && (solar?.elevation ?? 0) > -4);
  const fallbackElevation = span ? Math.sin(dayProgress * Math.PI) * 66 - 3 : (effectiveIsDay ? 38 : -14);
  const elevation = solar?.elevation ?? fallbackElevation;
  const solarLift = smoothstep(-5, 58, elevation);
  const lowSun = effectiveIsDay ? 1 - smoothstep(7, 28, elevation) : 0;
  const twilight = effectiveIsDay ? 0 : smoothstep(-18, -4, elevation) * (1 - smoothstep(-4, 1, elevation));
  const golden = effectiveIsDay ? clamp01(lowSun * (0.85 + Math.max(0, 1 - dayProgress) * 0.06)) : 0;
  const precipTruth = displayCondition.precipTruth || {};
  const activePrecip = precipTruth.phase === "active" || precipTruth.isWetNow === true;
  let cloud = clamp(skyNumber(sample.cloud, displayCondition.cloud ?? data?.current?.cloud_cover ?? 0), 0, 100);
  if (activePrecip && (condition === "rain" || condition === "snow" || condition === "thunder")) {
    cloud = Math.max(cloud, condition === "thunder" ? 88 : condition === "rain" ? 82 : 76);
  }
  let lowCloud = clamp(skyNumber(sample.lowCloud, cloud * 0.55), 0, 100);
  let midCloud = clamp(skyNumber(sample.midCloud, cloud * 0.45), 0, 100);
  let highCloud = clamp(skyNumber(sample.highCloud, cloud * 0.35), 0, 100);
  if (activePrecip && (condition === "rain" || condition === "snow" || condition === "thunder")) {
    lowCloud = Math.max(lowCloud, cloud * 0.72);
    midCloud = Math.max(midCloud, cloud * 0.48);
    highCloud = Math.max(highCloud, cloud * 0.24);
  }
  const visibilityKm = sample.visibility !== null ? Math.max(0, sample.visibility / 1000) : null;
  const visibilityHaze = visibilityKm === null ? 0 : clamp01((18 - visibilityKm) / 14);
  const humidity = skyNumber(data?.current?.relative_humidity_2m, null);
  const humidityHaze = humidity === null ? 0 : clamp01((humidity - 72) / 24) * 0.32;
  const air = airQualitySummary(data);
  const aqi = air?.aqi ?? null;
  const airRank = air?.band?.rank ?? 0;
  const airHaze = aqi === null
    ? 0
    : clamp01((aqi - 55) / 185) * 0.24 + Math.max(0, airRank - 1) * 0.035;
  const pollenRank = air?.pollen?.rank ?? 0;
  const pollenVeil = pollenRank > 1
    ? clamp01((pollenRank - 1) / 3) * 0.22
    : 0;
  const windMph = skyWindMph(sample.wind);
  const gustMph = skyWindMph(sample.gust);
  const windiness = clamp01((Math.max(windMph, gustMph * 0.72) - 6) / 28);
  const precipPressure = skyPrecipPressure(precipTruth);
  const haze = clamp01(
    visibilityHaze +
    (condition === "rain" || condition === "thunder" ? 0 : humidityHaze) +
    highCloud / 360 +
    airHaze +
    pollenVeil * 0.45 +
    precipPressure * 0.08
  );
  const shortwave = skyNumber(sample.shortwave, null);
  const direct = skyNumber(sample.direct, null);
  const diffuse = skyNumber(sample.diffuse, null);
  const radiation = shortwave !== null ? clamp01(shortwave / 860) : null;
  const directnessBase = shortwave && shortwave > 20 ? clamp01((direct ?? 0) / shortwave) : solarLift * (1 - cloud / 130);
  const directness = activePrecip && (condition === "rain" || condition === "snow" || condition === "thunder")
    ? directnessBase * 0.24
    : directnessBase;
  const cloudShade = clamp01((cloud - 18) / 82);
  const activeWetness = activePrecip ? Math.max(0.58, clamp01((precipTruth.chance || 0) / 100) * 0.82) : 0;
  const wetness = condition === "rain" || condition === "thunder"
    ? clamp01((skyNumber(sample.pop, displayCondition.pop ?? 0) - 20) / 70 + skyNumber(sample.precipitation, 0) * 0.7 + activeWetness)
    : 0;
  const diffuseGlow = diffuse !== null ? clamp01(diffuse / 300) : clamp01(cloud / 140);
  const daytimeBrightness = clamp01(
    0.24 +
    (radiation ?? solarLift) * 0.64 * (1 - cloudShade * 0.58) +
    diffuseGlow * 0.14 -
    wetness * 0.14 -
    precipPressure * 0.10 -
    airHaze * 0.08
  );
  const nightBrightness = clamp(0.06 + twilight * 0.26 + (condition === "clear" ? 0.05 : 0) - cloudShade * 0.025, 0.04, 0.34);
  const brightness = effectiveIsDay ? daytimeBrightness : nightBrightness;
  const warmth = effectiveIsDay
    ? clamp01(golden * (0.88 - cloudShade * 0.20) + haze * 0.18)
    : clamp01(twilight * 0.78 + haze * 0.08);
  const localHour = forecastLocalHourFromMs(now, data);
  const nightProgress = clamp01(localHour >= 18 ? (localHour - 18) / 12 : (localHour + 6) / 12);
  const x = effectiveIsDay ? 0.14 + dayProgress * 0.72 : 0.52 + nightProgress * 0.32;
  const y = effectiveIsDay
    ? clamp(0.285 - solarLift * 0.235 + haze * 0.018, 0.055, 0.305)
    : 0.085 - Math.sin(nightProgress * Math.PI) * 0.04 + twilight * 0.035;

  return {
    nowMs: now,
    dayKey: forecastLocalDateFromMs(now, data),
    condition,
    isDay: effectiveIsDay,
    sourceIsDay: isDay,
    hourIndex: sample.index,
    sunriseMs,
    sunsetMs,
    dayProgress,
    localHour,
    elevation,
    azimuth: solar?.azimuth ?? null,
    x,
    y,
    golden,
    twilight,
    brightness,
    warmth,
    haze,
    cloud,
    lowCloud,
    midCloud,
    highCloud,
    directness,
    wetness,
    humidity,
    windMph,
    gustMph,
    windiness,
    airHaze,
    airRank,
    aqi,
    pollenVeil,
    pollenRank,
    precipPhase: precipTruth.phase || "",
    precipSource: precipTruth.source || "",
    activePrecip,
    precipPressure,
    precipitation: skyNumber(sample.precipitation, 0),
    pop: skyNumber(sample.pop, displayCondition.pop ?? 0)
  };
}

function skyPhase(skyState = state.skyState) {
  if (skyState) {
    return {
      isDay: skyState.isDay,
      golden: skyState.golden,
      twilight: skyState.twilight,
      x: skyState.x,
      y: skyState.y,
      brightness: skyState.brightness,
      warmth: skyState.warmth,
      haze: skyState.haze,
      cloud: skyState.cloud,
      directness: skyState.directness
    };
  }

  const now = skyNow();
  const sr = state.sunriseMs, ss = state.sunsetMs;
  const isDay = state.skyIsDay !== false;
  if (!sr || !ss || ss <= sr) {
    return { isDay, golden: 0, twilight: 0, x: isDay ? 0.3 : 0.66, y: 0.12, brightness: isDay ? 0.62 : 0.12, warmth: 0, haze: 0, cloud: 0, directness: 0.8 };
  }
  const span = ss - sr;
  if (now >= sr && now <= ss) {
    const p = (now - sr) / span;
    const altitude = Math.sin(p * Math.PI);
    const edge = Math.min(now - sr, ss - now);
    return {
      isDay: true,
      golden: Math.max(0, 1 - edge / (60 * 60 * 1000)),
      twilight: 0,
      x: 0.14 + p * 0.72,
      y: 0.26 - altitude * 0.20,
      brightness: 0.34 + altitude * 0.48,
      warmth: Math.max(0, 1 - edge / (60 * 60 * 1000)),
      haze: 0,
      cloud: 0,
      directness: 0.8
    };
  }
  const edge = now > ss ? now - ss : sr - now;
  const np = now > ss ? Math.min((now - ss) / span, 1) : 1 - Math.min((sr - now) / span, 1);
  return {
    isDay: false,
    golden: 0,
    twilight: Math.max(0, 1 - edge / (80 * 60 * 1000)),
    x: 0.52 + np * 0.32,
    y: 0.085 - Math.sin(Math.max(np, 0) * Math.PI) * 0.04,
    brightness: 0.1,
    warmth: Math.max(0, 1 - edge / (80 * 60 * 1000)) * 0.7,
    haze: 0,
    cloud: 0,
    directness: 0
  };
}

function lerpHex(a, b, t) {
  t = Math.min(Math.max(t, 0), 1);
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => {
    const x = (pa >> sh) & 255, y = (pb >> sh) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${(0x1000000 + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)}`;
}

function blendStopSet(stops, target, t) {
  return stops.map((c, i) => lerpHex(c, target[i] || target[target.length - 1] || c, t));
}

function skyGradientStops(condition, phase, skyState = state.skyState) {
  if (phase.isDay) {
    const base = {
      clear: ["#5f96db", "#a7ccea", "#e2f0f7"],
      "partly-cloudy": ["#78a7d7", "#b8d3e6", "#e5eff5"],
      overcast: ["#879ba8", "#bac7cf", "#dde5ea"],
      rain: ["#627887", "#a3b3bf", "#d2dbe1"],
      snow: ["#a5b8c7", "#cbd8e1", "#eef4f7"],
      thunder: ["#455461", "#7b8994", "#b5c0ca"]
    }[condition] || ["#879ba8", "#bac7cf", "#dde5ea"];
    const bright = {
      clear: ["#6ca8ec", "#bee0f6", "#f6fcff"],
      "partly-cloudy": ["#82b2e2", "#c5e0f1", "#f2f8fb"],
      overcast: ["#9eafbb", "#ccd7de", "#edf2f5"],
      rain: ["#748d9f", "#b4c3cd", "#e0e7eb"],
      snow: ["#b7ccdc", "#dbe8ef", "#fbfdff"],
      thunder: ["#566878", "#8f9fa9", "#c9d3dc"]
    }[condition] || base;
    const warm = {
      clear: ["#446ca6", "#d98b62", "#f7bf77"],
      "partly-cloudy": ["#607faf", "#d5a078", "#f4c992"],
      overcast: ["#7c8790", "#c6aa92", "#e5d1bd"],
      rain: ["#5f7180", "#aa9787", "#d6c2b0"],
      snow: ["#9caebe", "#d8c7b7", "#f4e3d4"],
      thunder: ["#424957", "#7b6f6c", "#b49a86"]
    }[condition] || base;
    const haze = ["#8aa7bc", "#c7d4db", "#eef2f1"];
    const brightness = skyState ? skyState.brightness : 0.62;
    const cloud = skyState ? skyState.cloud / 100 : phase.cloud / 100;
    const pressure = skyState?.precipPressure ?? 0;
    const airHaze = skyState?.airHaze ?? 0;
    const pollenVeil = skyState?.pollenVeil ?? 0;
    const pressureSky = ["#6f7f8c", "#adbac4", "#dce2e4"];
    const airSky = ["#8b98a0", "#c1c1ba", "#e4ded2"];
    const pollenSky = ["#7f9f9c", "#d6d2a5", "#f3e7bd"];
    let stops = blendStopSet(base, bright, clamp01((brightness - 0.55) / 0.35) * 0.62);
    stops = blendStopSet(stops, warm, clamp01(phase.warmth ?? phase.golden) * (condition === "clear" || condition === "partly-cloudy" ? 0.88 : 0.46));
    stops = blendStopSet(stops, haze, clamp01((phase.haze ?? 0) * 0.75 + cloud * 0.18));
    stops = blendStopSet(stops, pressureSky, pressure * 0.38);
    stops = blendStopSet(stops, airSky, airHaze * 0.38);
    stops = blendStopSet(stops, pollenSky, pollenVeil * 0.25);
    return { angle: 180, positions: [0, 54, 100], stops };
  }
  const nightBase = {
    clear: ["#04080f", "#091428", "#0d1c3c"],
    "partly-cloudy": ["#070b16", "#0c1630", "#14213d"],
    overcast: ["#090b11", "#141922", "#202837"],
    rain: ["#050709", "#0b0f17", "#15202c"],
    snow: ["#090d18", "#121a2b", "#233149"],
    thunder: ["#040406", "#09090e", "#151520"]
  }[condition] || ["#090b11", "#141922", "#202837"];
  const twilight = {
    clear: ["#0c1430", "#2c2f59", "#6f4f68"],
    "partly-cloudy": ["#10172f", "#313554", "#6b596d"],
    overcast: ["#161a25", "#353948", "#675c68"],
    rain: ["#0d1119", "#252d3d", "#4f5364"],
    snow: ["#111a2d", "#2b3b58", "#65708a"],
    thunder: ["#08090f", "#1b1d29", "#45424d"]
  }[condition] || nightBase;
  const haze = ["#111827", "#273343", "#505b6a"];
  const pressureSky = ["#090d14", "#1f2935", "#3d4652"];
  const airSky = ["#141820", "#30303a", "#5a514f"];
  const pollenSky = ["#101821", "#303842", "#665e54"];
  let stops = blendStopSet(nightBase, twilight, clamp01(phase.twilight));
  stops = blendStopSet(stops, haze, clamp01((phase.haze ?? 0) * 0.45 + (phase.cloud ?? 0) / 220));
  stops = blendStopSet(stops, pressureSky, (skyState?.precipPressure ?? 0) * 0.32);
  stops = blendStopSet(stops, airSky, (skyState?.airHaze ?? 0) * 0.32);
  stops = blendStopSet(stops, pollenSky, (skyState?.pollenVeil ?? 0) * 0.18);
  return { angle: 160, positions: [0, 55, 100], stops };
}

function skyBackgroundCss(condition, skyState = state.skyState) {
  const phase = skyPhase(skyState);
  const g = skyGradientStops(condition, phase, skyState);
  if (g) {
    const css = `linear-gradient(${g.angle}deg, ${g.stops.map((c, i) => `${c} ${g.positions[i]}%`).join(", ")})`;
    return { css, top: g.stops[0], bottom: g.stops[g.stops.length - 1], phase };
  }
  const tod = phase.isDay ? "day" : "night";
  const cfg = SKY_CFG[tod][condition] || SKY_CFG[tod].overcast;
  return { css: cfg.bg, top: firstHexColor(cfg.bg), bottom: lastHexColor(cfg.bg), phase };
}

// Moon illuminated fraction (0 new → 1 full) and waxing flag for a timestamp.
function moonPhase(ms) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  let p = ((ms / 86400000 - ref) % synodic) / synodic;
  if (p < 0) p += 1;
  return { illum: (1 - Math.cos(p * 2 * Math.PI)) / 2, waxing: p < 0.5 };
}

let skyMaskCounter = 0;

function applySkyAtmosphereTokens(skyState) {
  const root = document.documentElement;
  if (!skyState) {
    root.removeAttribute("data-sky-tone");
    root.style.removeProperty("--sky-veil-opacity");
    return;
  }

  const tone = skyState.isDay
    ? skyState.warmth > 0.48 ? "warm" : skyState.brightness > 0.68 ? "bright" : skyState.haze > 0.38 ? "hazy" : "soft"
    : skyState.twilight > 0.35 ? "twilight" : "night";
  const veil = skyState.isDay
    ? clamp(0.42 + skyState.brightness * 0.26 + skyState.haze * 0.10 - skyState.warmth * 0.16, 0.30, 0.78)
    : clamp(0.02 + skyState.twilight * 0.18 + skyState.haze * 0.04, 0, 0.22);
  root.dataset.skyTone = tone;
  root.style.setProperty("--sky-veil-opacity", veil.toFixed(2));
}

function updateSkyCanvas(weatherCode, isDay, data = state.forecast, displayCondition = null) {
  const el = document.getElementById("skyCanvas");
  if (!el) return;

  state.skyCode = weatherCode;

  if (state.theme !== "auto") {
    state.skyIsDay = isDay;
    state.skyState = null;
    clearSkyCanvas();
    return;
  }

  const display = displayCondition || currentDisplayCondition(data);
  const skyState = deriveSkyState(weatherCode, isDay, data, display);
  state.skyState = skyState;
  state.skyIsDay = skyState.isDay;
  state.locationIsDay = skyState.isDay;

  const condition = skyState.condition;
  document.documentElement.dataset.sky = condition + "-" + (skyState.isDay ? "day" : "night");
  applySkyAtmosphereTokens(skyState);
  updateSkyChrome(condition, skyState.isDay, skyState);
  renderSkyScene(el, condition, skyState.isDay, skyState);
}

function clearSkyCanvas() {
  const el = document.getElementById("skyCanvas");
  if (!el) return;
  el.style.background = "";
  el.innerHTML = "";
  document.documentElement.removeAttribute("data-sky");
  document.documentElement.style.removeProperty("--sky-page-bg");
  document.documentElement.style.removeProperty("--sky-page-bg-color");
  applySkyAtmosphereTokens(null);
  updateSkyChrome(null, null);
}

function updateSkyChrome(condition, isDay, skyState = state.skyState) {
  if (condition) {
    setThemeChromeColor(skyChromeColor(condition, isDay, skyState));
    return;
  }
  setThemeChromeColor(defaultChromeColor());
}

function skyChromeColor(condition, isDay, skyState = state.skyState) {
  return skyBackgroundCss(condition, skyState).top || defaultChromeColor();
}

function firstHexColor(value) {
  const match = String(value || "").match(/#[0-9a-f]{6}\b/i);
  return match ? match[0] : "";
}

function lastHexColor(value) {
  const matches = String(value || "").match(/#[0-9a-f]{6}\b/ig);
  return matches?.length ? matches[matches.length - 1] : "";
}

function defaultChromeColor() {
  return document.documentElement.dataset.theme === "dark" ? "#04080f" : "#edf4f8";
}

function setThemeChromeColor(color) {
  if (els.themeColorMeta) els.themeColorMeta.setAttribute("content", color);
  if (els.statusBarMeta) els.statusBarMeta.setAttribute("content", "black-translucent");
}

function skySceneConfig(condition, isDay, skyState = state.skyState) {
  const tod = isDay ? "day" : "night";
  const base = SKY_CFG[tod][condition] || SKY_CFG[tod].overcast;
  if (!skyState) return base;

  const cloudPct = clamp(skyState.cloud, 0, 100);
  const lowCloud = clamp01(skyState.lowCloud / 100);
  const highCloud = clamp01(skyState.highCloud / 100);
  const precipPressure = skyState.precipPressure ?? 0;
  const activePrecip = skyState.activePrecip === true || skyState.precipPhase === "active";
  const precipCloudBonus = condition === "rain" || condition === "snow" || condition === "thunder" ? 1 : 0;
  const clouds = Math.round(clamp(
    cloudPct / 18 + lowCloud * 1.2 + highCloud * 0.4 + precipCloudBonus + precipPressure * 1.45,
    condition === "clear" ? 0 : 1,
    condition === "overcast" || condition === "thunder" ? 7 : condition === "rain" ? 6 : 5
  ));
  const moonVisible = !isDay && cloudPct < 82 && skyState.twilight < 0.82 && condition !== "rain" && condition !== "thunder";
  const sunVisible = isDay &&
    !activePrecip &&
    condition !== "thunder" &&
    (condition === "clear" || condition === "partly-cloudy" || skyState.directness > 0.23 || cloudPct < 72);
  const stars = !isDay
    ? Math.round((base.stars || 0) * (1 - skyState.twilight * 0.85) * (1 - cloudPct / 130) * (1 - skyState.haze * 0.55))
    : 0;

  return {
    ...base,
    stars: Math.max(0, stars),
    moon: moonVisible && (base.moon || condition === "overcast"),
    moonGlow: !moonVisible && !isDay && cloudPct < 92 && condition !== "thunder",
    sun: sunVisible,
    clouds,
    rain: base.rain,
    snow: base.snow,
    lightning: base.lightning
  };
}

function renderSkyScene(el, condition, isDay, skyState = state.skyState) {
  const perf = perfStart();
  const { width: vw, height: vh } = skyViewportSize();
  const cfg = skySceneConfig(condition, isDay, skyState);
  const sceneSeed = skySceneSeed(condition, isDay);
  const rngFor = (key) => seededSkyRandom(skyHash(`${sceneSeed}:${key}`));
  const bg = skyBackgroundCss(condition, skyState);
  const phase = bg.phase;

  document.documentElement.style.setProperty("--sky-page-bg", bg.css);
  document.documentElement.style.setProperty("--sky-page-bg-color", bg.bottom || bg.top || defaultChromeColor());
  el.style.background = bg.css;

  const parts = [skyFilterDefs()];
  if (cfg.stars)        parts.push(skyStars(vw, vh, cfg.stars, rngFor("stars")));
  if (cfg.stars >= 60)  parts.push(skyShootingStar(vw, vh, rngFor("shoot")));
  if (cfg.moon)         parts.push(skyMoon(vw, vh, phase));
  if (cfg.moonGlow)     parts.push(skyMoonGlow(vw, vh, rngFor("moon-glow")));
  if (cfg.sun && phase.golden > 0.12) parts.push(skyHorizonGlow(vw, vh, phase));
  if (cfg.sun)          parts.push(skySun(vw, vh, phase));
  if (cfg.clouds)       parts.push(skyClouds(vw, vh, cfg.clouds, isDay, condition, rngFor("clouds"), skyState));
  if (skyState?.haze > 0.08 || phase.warmth > 0.18) parts.push(skyHaze(vw, vh, skyState || phase));
  if ((skyState?.precipPressure ?? 0) > 0.08) parts.push(skyApproachVeil(vw, vh, skyState));
  if ((skyState?.airHaze ?? 0) > 0.08 || (skyState?.pollenVeil ?? 0) > 0.10) parts.push(skyAirVeil(vw, vh, skyState));
  if (cfg.rain)         parts.push(skyRain(vw, vh, cfg.lightning, rngFor("rain"), skyState));
  if (cfg.snow)         parts.push(skySnow(vw, vh, rngFor("snow"), skyState));
  if (cfg.lightning)    parts.push(skyLightning(vw, vh, rngFor("lightning")));

  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice">${parts.join("")}</svg>`;
  perfEnd("renderSkyScene", perf);
}

function skyViewportSize() {
  const root = document.documentElement;
  const visual = window.visualViewport;
  const syncedHeight = parseFloat(getComputedStyle(root).getPropertyValue("--app-viewport-height"));
  const syncedWidth = parseFloat(getComputedStyle(root).getPropertyValue("--app-viewport-width"));
  return {
    width: Math.ceil(Math.max(window.innerWidth || 0, root?.clientWidth || 0, visual?.width || 0, syncedWidth || 0, 320)),
    height: Math.ceil(Math.max(window.innerHeight || 0, root?.clientHeight || 0, visual?.height || 0, syncedHeight || 0, 640) + SKY_RENDER_OVERSCAN_PX * 2)
  };
}

function skyFilterDefs() {
  return `<defs>
    <filter id="sky-cloud-f" x="-18%" y="-45%" width="136%" height="190%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="18"/>
    </filter>
    <filter id="sky-glow-f" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="22"/>
    </filter>
    <filter id="sky-rain-fine-f" x="-12%" y="-12%" width="124%" height="124%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="0.16"/>
    </filter>
    <filter id="sky-rain-near-f" x="-22%" y="-22%" width="144%" height="144%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="0.55"/>
    </filter>
  </defs>`;
}

function skyStars(vw, vh, count, rng) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const x = (rng() * vw).toFixed(1);
    const y = (rng() * vh * 0.82).toFixed(1);
    const r = (rng() * 1.2 + 0.4).toFixed(1);
    const op = (rng() * 0.5 + 0.25).toFixed(2);
    const dur = (rng() * 3 + 2).toFixed(1);
    const delay = (rng() * 6).toFixed(1);
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#e8f0ff" class="sky-star" style="--op:${op};animation-duration:${dur}s;animation-delay:-${delay}s"/>`;
  }
  return s;
}

function skyMoon(vw, vh, phase) {
  const cx = Math.round(vw * phase.x), cy = Math.round(vh * phase.y), r = 42;
  const { illum, waxing } = moonPhase(state.skyState?.nowMs ?? skyNow());
  // Carve the phase: white disc minus an offset black disc → crescent → gibbous.
  const sep = illum * 2 * r;
  const sx = (cx + (waxing ? -sep : sep)).toFixed(1);
  const id = `sky-moon-${++skyMaskCounter}`;
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * 4.6}" fill="#6f7fb2" opacity="0.075" filter="url(#sky-glow-f)" class="sky-moon-glow"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 2.0}" fill="none" stroke="#afc5ed" stroke-width="1" opacity="0.11" class="sky-moon-glow"/>
    <defs><mask id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/><circle cx="${sx}" cy="${cy}" r="${r}" fill="#000"/></mask></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#cfe0f3" opacity="0.14"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#eef4ff" opacity="0.95" mask="url(#${id})"/>
    <circle cx="${cx - Math.round(r * 0.18)}" cy="${cy - Math.round(r * 0.14)}" r="${Math.round(r * 0.7)}" fill="#fff" opacity="0.12" mask="url(#${id})"/>
  `;
}

function skyMoonGlow(vw, vh, rng) {
  const x = Math.round(vw * (0.52 + rng() * 0.3));
  const y = Math.round(vh * (0.05 + rng() * 0.18));
  return `<circle cx="${x}" cy="${y}" r="90" fill="#7080b0" opacity="0.24" filter="url(#sky-glow-f)" class="sky-moon-glow"/>`;
}

function skySun(vw, vh, phase) {
  const cx = Math.round(vw * phase.x), cy = Math.round(vh * phase.y), r = 46;
  const warm = phase.warmth ?? phase.golden;
  const brightness = phase.brightness ?? 0.68;
  const directness = phase.directness ?? 0.7;
  const haze = phase.haze ?? 0;
  const core = lerpHex("#ffdf67", "#ff9a3c", warm);
  const halo = lerpHex(lerpHex("#ffe56f", "#fff3a6", clamp01((brightness - 0.55) / 0.32)), "#ff8a4a", warm);
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * (4.1 + haze * 1.3)}" fill="${halo}" opacity="${(0.13 + warm * 0.18 + haze * 0.10).toFixed(2)}" filter="url(#sky-glow-f)"/>
    <circle cx="${cx}" cy="${cy}" r="${r * (1.9 + brightness * 0.65)}" fill="#fff5b4" opacity="${(0.12 + brightness * 0.11).toFixed(2)}" filter="url(#sky-glow-f)"/>
    <g transform="translate(${cx} ${cy})">${skySunRays(r, warm, directness)}</g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${core}" opacity="${(0.74 + directness * 0.23).toFixed(2)}"/>
    <circle cx="${cx - 13}" cy="${cy - 13}" r="${Math.round(r * 0.52)}" fill="#fff7b6" opacity="0.22"/>
  `;
}

function skySunRays(r, warm, directness = 0.7) {
  let lines = "";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lines += `<line x1="${(Math.cos(a) * r * 1.45).toFixed(0)}" y1="${(Math.sin(a) * r * 1.45).toFixed(0)}" x2="${(Math.cos(a) * r * 2.6).toFixed(0)}" y2="${(Math.sin(a) * r * 2.6).toFixed(0)}" stroke="#fff0b0" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return `<g class="sky-sun-rays" opacity="${(0.05 + directness * 0.13 + warm * 0.08).toFixed(2)}">${lines}</g>`;
}

// Warm bloom around a low sun during golden hour.
function skyHorizonGlow(vw, vh, phase) {
  const gx = Math.round(vw * phase.x);
  const gy = Math.round(vh * (phase.y + 0.05));
  const warm = phase.warmth ?? phase.golden;
  return `<ellipse cx="${gx}" cy="${gy}" rx="${Math.round(vw * 0.62)}" ry="${Math.round(vh * 0.2)}" fill="#ff9d5a" opacity="${(warm * 0.42).toFixed(2)}" filter="url(#sky-glow-f)"/>`;
}

// One rare meteor streak on clear nights — a small surprise, not a feature.
function skyShootingStar(vw, vh, rng) {
  const x = ((0.32 + rng() * 0.5) * vw).toFixed(0);
  const y = ((0.06 + rng() * 0.18) * vh).toFixed(0);
  const len = 110 + rng() * 80;
  const delay = (6 + rng() * 26).toFixed(1);
  return `<line x1="${x}" y1="${y}" x2="${(Number(x) - len * 0.92).toFixed(0)}" y2="${(Number(y) + len * 0.4).toFixed(0)}" class="sky-shoot" stroke="#ffffff" stroke-width="2" stroke-linecap="round" style="animation-delay:${delay}s"/>`;
}

function skyClouds(vw, vh, count, isDay, condition, rng, skyState = null) {
  const isRainy = condition === "rain" || condition === "thunder";
  const isOvercast = condition === "overcast";
  const cloudDepth = skyState ? clamp01(skyState.cloud / 100) : (isOvercast || isRainy ? 0.82 : 0.35);
  const lowLayer = skyState ? clamp01(skyState.lowCloud / 100) : 0.5;
  const highLayer = skyState ? clamp01(skyState.highCloud / 100) : 0.3;
  const haze = skyState?.haze ?? 0;
  const pressure = skyState?.precipPressure ?? 0;
  const windiness = skyState?.windiness ?? 0;
  let out = "";
  for (let c = 0; c < count; c++) {
    const bx = rng() * vw * 1.26 - vw * 0.13;
    const layerLift = highLayer * 0.045 - lowLayer * 0.035;
    const by = vh * (
      isRainy ? 0.06 + rng() * 0.17 + layerLift :
      isOvercast ? 0.05 + rng() * 0.24 + layerLift :
      0.08 + rng() * 0.30 + layerLift
    );
    const scale = 0.72 + rng() * 0.84 + (cloudDepth + pressure * 0.34) * 0.22;
    const dur = ((105 + rng() * 80) * (1 - windiness * 0.34)).toFixed(0);
    const delay = (rng() * 90).toFixed(0);
    const dir = rng() > 0.5 ? "normal" : "reverse";

    let fill;
    if (!isDay) fill = isRainy ? "#151927" : (isOvercast ? "#202939" : lerpHex("#2d3b55", "#46546b", haze));
    else if (isRainy) fill = lerpHex("#55606a", "#6f7c86", haze * 0.45);
    else if (isOvercast) fill = lerpHex("#8d98a2", "#a8b3bc", haze * 0.5);
    else fill = lerpHex("#f4f9fd", "#c5d0d8", cloudDepth * 0.34 + haze * 0.28 + pressure * 0.16);
    const op = clamp((isOvercast || isRainy ? 0.58 : 0.34) + cloudDepth * 0.28 + pressure * 0.12 + rng() * 0.14, 0.22, 0.9).toFixed(2);

    const bodyWidth = (280 + rng() * 260) * scale;
    const bodyHeight = (42 + rng() * 36) * scale;
    const shear = (rng() - 0.5) * 54 * scale + windiness * 46 * scale;
    const topY = by - bodyHeight * (0.38 + rng() * 0.24);
    const midY = by + (rng() - 0.5) * 12 * scale;
    const baseY = by + bodyHeight * (0.34 + rng() * 0.22);
    const x0 = bx - bodyWidth * 0.52;
    const x1 = bx + bodyWidth * 0.52;
    const d = [
      `M ${x0.toFixed(0)} ${baseY.toFixed(0)}`,
      `C ${(x0 + bodyWidth * 0.16).toFixed(0)} ${(midY - bodyHeight * 0.45).toFixed(0)}, ${(x0 + bodyWidth * 0.32).toFixed(0)} ${(topY - bodyHeight * 0.15).toFixed(0)}, ${(bx + shear * 0.18).toFixed(0)} ${topY.toFixed(0)}`,
      `C ${(bx + bodyWidth * 0.18).toFixed(0)} ${(topY + bodyHeight * 0.10).toFixed(0)}, ${(x1 - bodyWidth * 0.18).toFixed(0)} ${(midY - bodyHeight * 0.38).toFixed(0)}, ${x1.toFixed(0)} ${midY.toFixed(0)}`,
      `C ${(x1 - bodyWidth * 0.12).toFixed(0)} ${(baseY + bodyHeight * 0.10).toFixed(0)}, ${(x0 + bodyWidth * 0.18).toFixed(0)} ${(baseY + bodyHeight * 0.12).toFixed(0)}, ${x0.toFixed(0)} ${baseY.toFixed(0)}`,
      "Z"
    ].join(" ");
    const lowBandY = baseY + bodyHeight * (0.10 + rng() * 0.20);
    const band = `<ellipse cx="${(bx + shear).toFixed(0)}" cy="${lowBandY.toFixed(0)}" rx="${(bodyWidth * 0.52).toFixed(0)}" ry="${(bodyHeight * 0.20).toFixed(0)}" fill="${fill}" opacity="${isOvercast || isRainy ? "0.62" : "0.34"}"/>`;
    out += `<g class="sky-cloud" style="animation-duration:${dur}s;animation-delay:-${delay}s;animation-direction:${dir}" filter="url(#sky-cloud-f)" opacity="${op}"><path d="${d}" fill="${fill}"/>${band}</g>`;
  }
  return out;
}

function skyHaze(vw, vh, skyState) {
  const haze = clamp01(skyState?.haze ?? 0);
  const warm = clamp01(skyState?.warmth ?? 0);
  const cloud = clamp01((skyState?.cloud ?? 0) / 100);
  const air = clamp01(skyState?.airHaze ?? 0);
  const pollen = clamp01(skyState?.pollenVeil ?? 0);
  const topOpacity = clamp(haze * 0.20 + warm * 0.08 + cloud * 0.04 + air * 0.10 + pollen * 0.05, 0.02, 0.3);
  const horizonOpacity = clamp(haze * 0.30 + warm * 0.18 + air * 0.12 + pollen * 0.08, 0.03, 0.4);
  const fill = lerpHex("#dcebf4", "#ffd0a0", warm);
  return `
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="${fill}" opacity="${topOpacity.toFixed(2)}"/>
    <ellipse cx="${Math.round(vw * 0.5)}" cy="${Math.round(vh * 0.78)}" rx="${Math.round(vw * 0.78)}" ry="${Math.round(vh * 0.28)}" fill="${fill}" opacity="${horizonOpacity.toFixed(2)}" filter="url(#sky-glow-f)"/>
  `;
}

function skyApproachVeil(vw, vh, skyState) {
  const pressure = clamp01(skyState?.precipPressure ?? 0);
  const wind = clamp01(skyState?.windiness ?? 0);
  const isDay = skyState?.isDay !== false;
  const fill = isDay ? "#5f7180" : "#111827";
  const edgeFill = isDay ? "#9aa8b2" : "#273142";
  const opacity = clamp(pressure * 0.18, 0.02, 0.18);
  const edgeOpacity = clamp(pressure * 0.16, 0.02, 0.16);
  const x = Math.round(vw * (0.18 + wind * 0.22));
  const y = Math.round(vh * (0.16 + pressure * 0.06));
  return `
    <ellipse cx="${x}" cy="${y}" rx="${Math.round(vw * (0.62 + pressure * 0.18))}" ry="${Math.round(vh * 0.34)}" fill="${fill}" opacity="${opacity.toFixed(2)}" filter="url(#sky-glow-f)"/>
    <rect x="0" y="0" width="${vw}" height="${Math.round(vh * (0.44 + pressure * 0.16))}" fill="${edgeFill}" opacity="${edgeOpacity.toFixed(2)}"/>
  `;
}

function skyAirVeil(vw, vh, skyState) {
  const air = clamp01(skyState?.airHaze ?? 0);
  const pollen = clamp01(skyState?.pollenVeil ?? 0);
  const isDay = skyState?.isDay !== false;
  const airFill = isDay ? "#d8cec0" : "#6a5f5c";
  const pollenFill = isDay ? "#efe0a8" : "#807553";
  const airOpacity = clamp(air * 0.20, 0, 0.18);
  const pollenOpacity = clamp(pollen * 0.22, 0, 0.16);
  return `
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="${airFill}" opacity="${airOpacity.toFixed(2)}"/>
    <ellipse cx="${Math.round(vw * 0.62)}" cy="${Math.round(vh * 0.58)}" rx="${Math.round(vw * 0.72)}" ry="${Math.round(vh * 0.34)}" fill="${pollenFill}" opacity="${pollenOpacity.toFixed(2)}" filter="url(#sky-glow-f)"/>
  `;
}

function skyRain(vw, vh, heavy = false, rng, skyState = null) {
  const wetness = skyState ? skyState.wetness || 0 : heavy ? 1 : 0.55;
  const pressure = skyState ? skyState.precipPressure || 0 : heavy ? 0.8 : 0.45;
  const precipitation = skyState ? skyState.precipitation || 0 : heavy ? 0.8 : 0.3;
  const active = skyState?.activePrecip === true || skyState?.precipPhase === "active";
  const intensity = clamp01(wetness * 0.72 + pressure * 0.34 + precipitation * 0.20 + (heavy ? 0.16 : 0) + (active ? 0.12 : 0));
  const windMph = skyState ? skyState.windMph || 0 : heavy ? 18 : 10;
  const windLean = clamp01(Math.max(windMph / 34, skyState?.windiness || 0));
  const isDay = skyState?.isDay !== false;
  const warmth = clamp01(skyState?.warmth || 0);
  const drizzle = !heavy && intensity < 0.52;
  const fineCount = Math.round((drizzle ? 84 : 104) + intensity * 126 + (heavy ? 38 : 0) + (active ? 22 : 0));
  const nearCount = drizzle ? Math.round(4 + intensity * 12) : Math.round(10 + intensity * 32 + (heavy ? 12 : 0) + (active ? 8 : 0));
  const drift = 20 + windLean * 36 + intensity * 12;
  const fineColor = isDay ? lerpHex("#e9f1f4", "#f0d7bd", warmth * 0.55) : "#c9dceb";
  const nearColor = isDay ? lerpHex("#f7fbfc", "#f5dfc6", warmth * 0.48) : "#ecf5ff";
  const veilColor = isDay ? lerpHex("#8797a2", "#ad9683", warmth * 0.45) : "#151d29";
  const glowColor = isDay ? lerpHex("#d5e1e7", "#ead5bf", warmth * 0.5) : "#a8bacd";
  const veilOpacity = clamp(0.07 + intensity * 0.13 + pressure * 0.07 + (active ? 0.04 : 0), 0.08, heavy ? 0.32 : 0.24);
  const horizonOpacity = clamp(0.07 + intensity * 0.14 + pressure * 0.06 + (active ? 0.03 : 0), 0.08, heavy ? 0.34 : 0.25);
  const bandOpacity = clamp(0.035 + intensity * 0.075 + (active ? 0.018 : 0), 0.035, 0.14);
  let fine = "";
  let near = "";
  let bands = "";

  for (let i = 0; i < 6; i++) {
    const x = Math.round(-vw * 0.25 + rng() * vw * 1.15);
    const width = Math.round(vw * (0.18 + rng() * 0.16));
    const lean = Math.round(drift * (2.4 + rng() * 1.4));
    const op = (bandOpacity * (0.55 + rng() * 0.45)).toFixed(3);
    bands += `<path class="sky-rain-sheet" d="M${x} 0 L${x + width} 0 L${x + width + lean} ${vh} L${x + lean} ${vh} Z" fill="${glowColor}" opacity="${op}" style="--rain-drift:${drift.toFixed(0)}px;animation-delay:-${(rng() * 8).toFixed(2)}s;animation-duration:${(10 + rng() * 8).toFixed(2)}s"/>`;
  }

  for (let i = 0; i < fineCount; i++) {
    const x = -vw * 0.25 + rng() * vw * 1.5;
    const y = -vh * (0.58 + rng() * 0.48);
    const len = 18 + intensity * 26 + rng() * (drizzle ? 16 : 34);
    const dx = len * (0.20 + windLean * 0.46) + drift * 0.18;
    const width = 0.52 + intensity * 0.34 + rng() * 0.38;
    const op = clamp((drizzle ? 0.24 : 0.28) + intensity * 0.28 + rng() * 0.20 + (active ? 0.04 : 0), 0.22, heavy ? 0.72 : 0.62);
    const dur = clamp((drizzle ? 1.8 : 1.18) - intensity * 0.34 - windLean * 0.22 + rng() * 0.62, 0.58, 2.25);
    const delay = rng() * 3.4;
    fine += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + dx).toFixed(0)}" y2="${(y + len).toFixed(0)}" class="sky-rain sky-rain-fine" style="--rain-op:${op.toFixed(2)};--rain-drift:${drift.toFixed(0)}px;animation-delay:-${delay.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s" stroke="${fineColor}" stroke-width="${width.toFixed(2)}" stroke-linecap="butt" filter="url(#sky-rain-fine-f)"/>`;
  }

  for (let i = 0; i < nearCount; i++) {
    const x = -vw * 0.18 + rng() * vw * 1.36;
    const y = -vh * (0.62 + rng() * 0.52);
    const len = 42 + intensity * 52 + rng() * 54;
    const dx = len * (0.24 + windLean * 0.48) + drift * 0.24;
    const width = 0.9 + intensity * 0.8 + rng() * 0.8;
    const op = clamp(0.20 + intensity * 0.26 + rng() * 0.18 + (active ? 0.03 : 0), 0.20, heavy ? 0.58 : 0.48);
    const dur = clamp(0.72 - intensity * 0.18 - windLean * 0.10 + rng() * 0.36, 0.44, 1.06);
    const delay = rng() * 2.4;
    near += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + dx).toFixed(0)}" y2="${(y + len).toFixed(0)}" class="sky-rain sky-rain-near" style="--rain-op:${op.toFixed(2)};--rain-drift:${(drift * 1.25).toFixed(0)}px;animation-delay:-${delay.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s" stroke="${nearColor}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" filter="url(#sky-rain-near-f)"/>`;
  }

  return `
    <g class="sky-rain-atmosphere">
      <rect x="0" y="0" width="${vw}" height="${vh}" fill="${veilColor}" opacity="${veilOpacity.toFixed(3)}"/>
      <rect x="0" y="0" width="${vw}" height="${Math.round(vh * (0.42 + intensity * 0.22))}" fill="${veilColor}" opacity="${(veilOpacity * 0.44).toFixed(3)}"/>
      <ellipse cx="${Math.round(vw * 0.48)}" cy="${Math.round(vh * 0.74)}" rx="${Math.round(vw * 0.78)}" ry="${Math.round(vh * 0.30)}" fill="${glowColor}" opacity="${horizonOpacity.toFixed(3)}" filter="url(#sky-glow-f)"/>
      ${bands}
    </g>
    <g class="sky-rain-curtain">${fine}</g>
    <g class="sky-rain-foreground">${near}</g>
  `;
}

function skySnow(vw, vh, rng, skyState = null) {
  let out = "";
  const intensity = skyState ? clamp01((skyState.pop - 20) / 70 + (skyState.precipitation || 0) * 0.5) : 0.45;
  const count = Math.round(34 + intensity * 30);
  for (let i = 0; i < count; i++) {
    const x = (rng() * vw).toFixed(0);
    const r = (1.4 + intensity * 0.8 + rng() * 2.5).toFixed(1);
    const dur = (3.8 + rng() * 6 - intensity * 0.7).toFixed(1);
    const delay = (rng() * 8).toFixed(1);
    const drift = ((rng() * 50) - 25).toFixed(0);
    out += `<circle cx="${x}" cy="-5" r="${r}" fill="white" opacity="0.8" class="sky-snow" style="--drift:${drift}px;animation-duration:${dur}s;animation-delay:-${delay}s"/>`;
  }
  return out;
}

function skyLightningBolt(vw, vh, rng) {
  let x = vw * (0.2 + rng() * 0.6);
  let y = vh * (0.05 + rng() * 0.08);
  const segs = 5 + Math.floor(rng() * 4);
  let d = `M ${x.toFixed(0)} ${y.toFixed(0)}`;
  for (let i = 0; i < segs; i++) {
    x += (rng() - 0.45) * (vw * 0.1);
    y += vh * (0.1 + rng() * 0.07);
    if (y > vh * 0.88) break;
    d += ` L ${x.toFixed(0)} ${y.toFixed(0)}`;
  }
  return d;
}

function skyLightning(vw, vh, rng) {
  const d1 = (rng() * 5).toFixed(1);
  const d2 = (Number(d1) + 5 + rng() * 7).toFixed(1);
  const bolt1 = skyLightningBolt(vw, vh, rng);
  const bolt2 = skyLightningBolt(vw, vh, rng);
  return `
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="#c0d0ff" opacity="0" class="sky-lightning" style="animation-delay:${d1}s"/>
    <path d="${bolt1}" stroke="#ffe080" stroke-width="3" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d1}s;filter:blur(3px)"/>
    <path d="${bolt1}" stroke="white" stroke-width="1.5" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d1}s"/>
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="#c0d0ff" opacity="0" class="sky-lightning" style="animation-delay:${d2}s"/>
    <path d="${bolt2}" stroke="#ffe080" stroke-width="3" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d2}s;filter:blur(3px)"/>
    <path d="${bolt2}" stroke="white" stroke-width="1.5" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d2}s"/>
  `;
}

function refreshSkyForLiveTime() {
  if (state.skyCode === null || state.theme !== "auto" || !state.forecast) return;
  const truth = buildWeatherTruth(state.forecast);
  const display = truth.display;
  const sceneCode = truth.sceneCode ?? truth.code;
  state.skyCode = sceneCode;
  const nextSkyState = deriveSkyState(sceneCode, truth.isDay, state.forecast, display);
  const dayChanged = state.locationIsDay !== nextSkyState.isDay;
  syncWeatherTruthDaylight(truth, nextSkyState.isDay);
  state.weatherTruth = truth;
  state.skyState = nextSkyState;
  state.skyIsDay = truth.isDay;
  state.locationIsDay = truth.isDay;
  updateHeroWeatherIcon(truth.nowCode ?? truth.code, truth.isDay);
  updateCurrentHourlyWeatherIcon(truth);
  updateWeatherTruthReceipt(truth);
  renderMapLegend();
  if (dayChanged) {
    applyTheme();
    return;
  }
  updateSkyCanvas(sceneCode, truth.isDay, state.forecast, display);
}

window.setInterval(refreshSkyForLiveTime, 60 * 1000);
