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

const SKY_SCENE_VERSION = "sky-v9";
const SKY_CLOUD_VERSION = "cloudfield-v3";
const SKY_PRECIPITATION_VERSION = "sky-v9";
const SKY_CLOUD_ATLAS_PIXEL_BUDGET = 145000;
const SKY_CLOUD_ATLAS_CACHE_LIMIT = 3;
const skyCloudAtlasCache = new Map();

// Reactive sky is deliberately renderer-only. The setting owner exposes a
// boolean/function hook; without it the existing SVG sky remains untouched.
const REACTIVE_SKY_HEADING_ACCURACY_LIMIT = 45;
const REACTIVE_SKY_SENSOR_INTERVAL_MS = 90;
const reactiveSkyPose = {
  heading: 0,
  hasDeviceHeading: false,
  lastAcceptedAt: 0,
  lastHeadingAt: 0
};
let reactiveSkyPresentationActive = false;
let reactiveSkyRainTextureCounter = 0;
let reactiveSkyLastVector = null;

function reactiveSkyEnabled() {
  const hook = window.nearcastReactiveSkyEnabled;
  if (typeof hook === "function") return hook() === true;
  if (hook === true) return true;
  const root = document.documentElement;
  return root?.dataset?.reactiveSky === "on" || root?.dataset?.skyReactive === "on";
}

function reactiveSkyWorkPaused() {
  const root = document.documentElement;
  return (
    document.visibilityState === "hidden" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true ||
    root?.classList?.contains("sky-motion-paused-for-map") ||
    root?.classList?.contains("sky-motion-paused-for-app-work")
  );
}

function normalizeSkyBearing(value) {
  if (value === null || value === undefined || value === "") return null;
  const bearing = Number(value);
  if (!Number.isFinite(bearing)) return null;
  return ((bearing % 360) + 360) % 360;
}

function signedSkyBearingDelta(value) {
  const bearing = normalizeSkyBearing(value);
  return bearing === null ? 0 : bearing > 180 ? bearing - 360 : bearing;
}

function smoothSkyHeading(previous, next, amount) {
  return normalizeSkyBearing(previous + signedSkyBearingDelta(next - previous) * amount) ?? next;
}

function reactiveSkyVector(skyState = state.skyState) {
  const travel = normalizeSkyBearing(skyState?.windTravelDeg);
  const heading = reactiveSkyPose.hasDeviceHeading ? reactiveSkyPose.heading : 0;
  const relative = signedSkyBearingDelta((travel ?? 180) - heading);
  const radians = relative * Math.PI / 180;
  const crosswind = travel === null ? 0 : Math.sin(radians);
  const depth = travel === null ? 0 : Math.cos(radians);
  const windMph = Math.max(Number(skyState?.windMph) || 0, (Number(skyState?.gustMph) || 0) * 0.65);
  const strength = clamp01((windMph - 1) / 29);
  return {
    relative,
    crosswind,
    depth,
    strength,
    rainSlant: clamp(crosswind * strength * 25, -25, 25),
    rainOffset: clamp(crosswind * strength * 22, -22, 22),
    cloudDistance: clamp(crosswind * (24 + strength * 54), -78, 78)
  };
}

function setReactiveSkyCssValue(name, value) {
  const root = document.documentElement;
  if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
}

function clearReactiveSkyVectorProps() {
  reactiveSkyLastVector = null;
  const root = document.documentElement;
  root.removeAttribute("data-sky-reactive-pose");
  root.style.removeProperty("--sky-reactive-rain-slant");
  root.style.removeProperty("--sky-reactive-rain-offset");
  root.style.removeProperty("--sky-reactive-cloud-distance");
}

function resetReactiveSkyPresentation() {
  reactiveSkyPresentationActive = false;
  reactiveSkyPose.heading = 0;
  reactiveSkyPose.hasDeviceHeading = false;
  reactiveSkyPose.lastAcceptedAt = 0;
  reactiveSkyPose.lastHeadingAt = 0;
  document.documentElement.removeAttribute("data-sky-reactive-renderer");
  clearReactiveSkyVectorProps();
}

function applyReactiveSkyPose({ force = false } = {}) {
  if (!reactiveSkyEnabled() || !reactiveSkyPresentationActive || reactiveSkyWorkPaused()) return false;
  const vector = reactiveSkyVector();
  if (
    !force &&
    reactiveSkyLastVector &&
    Math.abs(vector.rainSlant - reactiveSkyLastVector.rainSlant) < 0.08 &&
    Math.abs(vector.cloudDistance - reactiveSkyLastVector.cloudDistance) < 0.2
  ) return true;

  reactiveSkyLastVector = vector;
  setReactiveSkyCssValue("--sky-reactive-rain-slant", `${vector.rainSlant.toFixed(2)}deg`);
  setReactiveSkyCssValue("--sky-reactive-rain-offset", `${vector.rainOffset.toFixed(2)}px`);
  setReactiveSkyCssValue("--sky-reactive-cloud-distance", `${vector.cloudDistance.toFixed(2)}px`);
  document.documentElement.dataset.skyReactivePose = reactiveSkyPose.hasDeviceHeading ? "heading" : "weather";
  return true;
}

function syncReactiveSkyActivity() {
  const enabled = reactiveSkyEnabled();
  const paused = enabled && reactiveSkyWorkPaused();
  const root = document.documentElement;
  root.classList.toggle("sky-reactive-work-paused", paused);
  if (!enabled) {
    resetReactiveSkyPresentation();
  } else if (!paused) {
    applyReactiveSkyPose({ force: true });
  }
}

// Public sensor contract. Call at no more than 5-10 Hz with compass heading in
// degrees clockwise from north. `accuracy` is degrees; readings worse than 45
// are ignored. `{ active: false }` returns to weather-only/north-up projection.
// The function only updates three inherited CSS properties and never rebuilds
// the SVG or rain textures. It returns true when the pose was accepted.
window.nearcastSetAmbientPose = function nearcastSetAmbientPose(pose = {}) {
  const now = Date.now();

  if (pose.active === false) {
    reactiveSkyPose.hasDeviceHeading = false;
    reactiveSkyPose.heading = 0;
    reactiveSkyPose.lastAcceptedAt = 0;
    reactiveSkyPose.lastHeadingAt = 0;
    clearReactiveSkyVectorProps();
    if (!reactiveSkyEnabled() || !reactiveSkyPresentationActive || reactiveSkyWorkPaused()) return true;
    return applyReactiveSkyPose({ force: true });
  }

  if (!reactiveSkyEnabled() || !reactiveSkyPresentationActive || reactiveSkyWorkPaused()) return false;

  const heading = normalizeSkyBearing(pose.heading ?? pose.headingDeg);
  const accuracy = Number(pose.accuracy ?? pose.headingAccuracy);
  if (heading === null || (Number.isFinite(accuracy) && (accuracy < 0 || accuracy > REACTIVE_SKY_HEADING_ACCURACY_LIMIT))) {
    return false;
  }
  if (reactiveSkyPose.lastAcceptedAt && now - reactiveSkyPose.lastAcceptedAt < REACTIVE_SKY_SENSOR_INTERVAL_MS) {
    return true;
  }

  const elapsed = reactiveSkyPose.lastHeadingAt ? Math.max(0, now - reactiveSkyPose.lastHeadingAt) : 0;
  const amount = reactiveSkyPose.hasDeviceHeading
    ? clamp(1 - Math.exp(-elapsed / 520), 0.12, 0.42)
    : 1;
  reactiveSkyPose.heading = reactiveSkyPose.hasDeviceHeading
    ? smoothSkyHeading(reactiveSkyPose.heading, heading, amount)
    : heading;
  reactiveSkyPose.hasDeviceHeading = true;
  reactiveSkyPose.lastAcceptedAt = now;
  reactiveSkyPose.lastHeadingAt = now;
  return applyReactiveSkyPose();
};

// Setting changes use this cheap contract to swap the renderer once. Sensor
// samples must use nearcastSetAmbientPose instead.
window.nearcastRefreshAmbientScene = function nearcastRefreshAmbientScene() {
  if (!state.skyData || state.theme !== "auto") {
    syncReactiveSkyActivity();
    return false;
  }
  updateSkyCanvas(state.skyCode, state.skyIsDay, state.skyData, state.skyDisplayCondition);
  return true;
};

const reactiveSkyReducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState !== "hidden" &&
    reactiveSkyEnabled() &&
    !reactiveSkyReducedMotionQuery?.matches &&
    document.documentElement.dataset.skyReactiveRenderer === "still"
  ) {
    window.nearcastRefreshAmbientScene();
    return;
  }
  syncReactiveSkyActivity();
}, { passive: true });
reactiveSkyReducedMotionQuery?.addEventListener?.("change", (event) => {
  if (!event.matches && reactiveSkyEnabled() && document.documentElement.dataset.skyReactiveRenderer === "still") {
    window.nearcastRefreshAmbientScene();
    return;
  }
  syncReactiveSkyActivity();
});
new MutationObserver(syncReactiveSkyActivity).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "data-reactive-sky", "data-sky-reactive"]
});

function skyMotionProfile(condition, skyState = state.skyState) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  const smallViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) < 760;
  const lowMemory = Number(navigator.deviceMemory || 8) <= 4;
  const reactive = reactiveSkyEnabled();

  if (reduceMotion || document.visibilityState === "hidden") {
    return {
      level: "still",
      density: 1,
      animateClouds: 0,
      animateStars: 0,
      animateAtmosphere: false,
      sunMotion: false,
      moonMotion: false,
      rareMotion: false
    };
  }

  if (coarsePointer || smallViewport || lowMemory) {
    if (reactive) {
      return {
        level: "ambient",
        density: 0.56,
        animateClouds: 3,
        animateStars: 2,
        animateAtmosphere: true,
        sunMotion: false,
        moonMotion: false,
        rareMotion: false
      };
    }
    return {
      level: "ambient",
      density: 1,
      animateClouds: Infinity,
      animateStars: Infinity,
      animateAtmosphere: true,
      sunMotion: true,
      moonMotion: true,
      rareMotion: true
    };
  }

  if (reactive) {
    return {
      level: "full",
      density: 0.82,
      animateClouds: Infinity,
      animateStars: 3,
      animateAtmosphere: true,
      sunMotion: true,
      moonMotion: true,
      rareMotion: true
    };
  }

  return {
    level: "full",
    density: 1,
    animateClouds: Infinity,
    animateStars: Infinity,
    animateAtmosphere: true,
    sunMotion: true,
    moonMotion: true,
    rareMotion: true
  };
}

function applySkyMotionProfile(profile) {
  document.documentElement.dataset.skyMotion = profile?.level || "full";
  document.documentElement.classList.remove("sky-motion-paused-for-interaction");
}

function skySceneIdentity(condition, isDay) {
  const place = state.activePlace
    ? `${state.activePlace.id || state.activePlace.name || "place"}:${Number(state.activePlace.latitude || 0).toFixed(2)}:${Number(state.activePlace.longitude || 0).toFixed(2)}`
    : "no-place";
  const day = state.skyState?.dayKey || datePart(state.forecast?.current?.time) || datePart(new Date()) || "today";
  return `${place}|${day}|${condition}|${isDay ? "day" : "night"}`;
}

function skySceneSeed(condition, isDay, version = SKY_SCENE_VERSION) {
  return skyHash(`${version}|${skySceneIdentity(condition, isDay)}`);
}

function skyLayerSeed(key, condition, isDay) {
  const version = key === "clouds"
    ? SKY_CLOUD_VERSION
    : key === "rain" || key === "snow" || key === "lightning"
      ? SKY_PRECIPITATION_VERSION
      : SKY_SCENE_VERSION;
  return skyHash(`${skySceneSeed(condition, isDay, version)}:${key}`);
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

function skyPrecipRateIntensity(rate, data = state.forecast) {
  const value = Number(rate || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const thresholds = typeof precipRateThresholds === "function"
    ? precipRateThresholds(data)
    : { measurable: 0.008, moderate: 0.1, heavy: 0.3 };
  const measurable = Math.max(Number(thresholds.measurable) || 0.008, 0.0001);
  const moderate = Math.max(Number(thresholds.moderate) || 0.1, measurable * 2);
  const heavy = Math.max(Number(thresholds.heavy) || 0.3, moderate * 1.4);
  if (value < measurable) return 0;
  if (value < moderate) return 0.18 + smoothstep(measurable, moderate, value) * 0.22;
  if (value < heavy) return 0.42 + smoothstep(moderate, heavy, value) * 0.28;
  return clamp(0.74 + smoothstep(heavy, heavy * 2.2, value) * 0.22, 0.74, 0.96);
}

function skyPrecipCodeIntensity(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return 0;
  if (n === 51 || n === 56) return 0.18;
  if (n === 53 || n === 57) return 0.25;
  if (n === 55) return 0.34;
  if (n === 61 || n === 66 || n === 80) return 0.32;
  if (n === 63 || n === 67 || n === 81) return 0.58;
  if (n === 65 || n === 82) return 0.88;
  if (isThunderCode(n)) return 0.78;
  return 0;
}

function skyPrecipVisualIntensity(skyState = null, heavy = false) {
  const codeIntensity = skyPrecipCodeIntensity(skyState?.precipCode);
  const rateIntensity = skyPrecipRateIntensity(skyState?.precipRate);
  const wetness = clamp01(skyState?.wetness || 0);
  const pressure = clamp01(skyState?.precipPressure || 0);
  const precipitation = clamp01(skyState?.precipitation || 0);
  const active = skyState?.activePrecip === true || skyState?.precipPhase === "active";
  const fallback = clamp01(wetness * 0.30 + pressure * 0.18 + precipitation * 0.20 + (active ? 0.08 : 0));
  return clamp01(Math.max(codeIntensity, rateIntensity, fallback, heavy ? 0.82 : 0));
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
    windDirection: skySeriesValue(h.wind_direction_10m, idx, current.wind_direction_10m),
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
  const windFromDeg = normalizeSkyBearing(sample.windDirection);
  // Forecast APIs follow the meteorological convention: direction is where
  // wind comes from. The renderer needs the direction precipitation travels.
  const windTravelDeg = windFromDeg === null ? null : normalizeSkyBearing(windFromDeg + 180);
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
    welcomeAmbient: displayCondition.welcomeAmbient === true,
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
    windFromDeg,
    windDirection: windFromDeg,
    windDirectionDeg: windFromDeg,
    windTravelDeg,
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
    precipCode: precipTruth.visualCode ?? precipTruth.textCode ?? displayCondition.nowPrecip?.code ?? weatherCode,
    precipRate: displayCondition.nowPrecip?.rate ?? null,
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
      condition: skyState.condition,
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

function skyVisualCloudDepth(condition, cloudFraction) {
  const raw = clamp01(cloudFraction);
  if (condition === "partly-cloudy") return clamp(raw, 0.30, 0.58);
  if (condition === "overcast") return clamp(raw, 0.76, 1);
  return raw;
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
    const cloud = skyVisualCloudDepth(condition, skyState ? skyState.cloud / 100 : phase.cloud / 100);
    const pressure = skyState?.precipPressure ?? 0;
    const airHaze = skyState?.airHaze ?? 0;
    const pollenVeil = skyState?.pollenVeil ?? 0;
    const pressureSky = ["#6f7f8c", "#adbac4", "#dce2e4"];
    const airSky = ["#8b98a0", "#c1c1ba", "#e4ded2"];
    const pollenSky = ["#7f9f9c", "#d6d2a5", "#f3e7bd"];
    const brightLift = condition === "partly-cloudy" ? 0.08 : 0;
    const brightMix = condition === "partly-cloudy" ? 0.78 : 0.62;
    const hazeCloudWeight = condition === "partly-cloudy" ? 0.08 : 0.18;
    let stops = blendStopSet(base, bright, clamp01((brightness + brightLift - 0.55) / 0.35) * brightMix);
    stops = blendStopSet(stops, warm, clamp01(phase.warmth ?? phase.golden) * (condition === "clear" || condition === "partly-cloudy" ? 0.88 : 0.46));
    stops = blendStopSet(stops, haze, clamp01((phase.haze ?? 0) * 0.75 + cloud * hazeCloudWeight));
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
  const nightCloud = skyVisualCloudDepth(condition, (phase.cloud ?? 0) / 100);
  const twilightMix = condition === "partly-cloudy" ? 1.08 : 1;
  const nightCloudWeight = condition === "partly-cloudy" ? 0.18 : 0.45;
  let stops = blendStopSet(nightBase, twilight, clamp01(phase.twilight) * twilightMix);
  stops = blendStopSet(stops, haze, clamp01((phase.haze ?? 0) * 0.45 + nightCloud * nightCloudWeight));
  stops = blendStopSet(stops, pressureSky, (skyState?.precipPressure ?? 0) * 0.32);
  stops = blendStopSet(stops, airSky, (skyState?.airHaze ?? 0) * 0.32);
  stops = blendStopSet(stops, pollenSky, (skyState?.pollenVeil ?? 0) * 0.18);
  return { angle: 160, positions: [0, 55, 100], stops };
}

function skyBackgroundCss(condition, skyState = state.skyState) {
  const phase = { ...skyPhase(skyState), condition };
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
  state.skyData = data || null;
  state.skyDisplayCondition = displayCondition || null;

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
  resetReactiveSkyPresentation();
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

// Cloud art follows what the sky can visually support, not just the provider's
// condition label. A surviving sun/direct-light cue gets broken clouds and
// open sky; only a genuinely low, opaque ceiling becomes overcast.
function skyCloudVisualFamily(condition, skyState = state.skyState, sunVisible = false) {
  if (!skyState) {
    if (condition === "rain" || condition === "thunder") return "rain";
    if (condition === "snow") return "snow";
    if (condition === "overcast") return "overcast";
    if (condition === "partly-cloudy") return "broken";
    return "clear";
  }

  const cloud = clamp(skyState.cloud ?? 0, 0, 100);
  const low = clamp(skyState.lowCloud ?? cloud * 0.55, 0, 100);
  const high = clamp(skyState.highCloud ?? cloud * 0.35, 0, 100);
  const directness = clamp01(skyState.directness ?? 0);
  const pressure = clamp01(skyState.precipPressure ?? 0);
  const wetness = clamp01(skyState.wetness ?? 0);
  const activePrecip = skyState.activePrecip === true || skyState.precipPhase === "active";
  const quietClearNight = skyState.isDay === false && condition === "clear" && !activePrecip;

  if ((condition === "rain" || condition === "thunder") && (activePrecip || pressure > 0.42 || wetness > 0.38)) return "rain";
  if (condition === "snow" && (activePrecip || cloud > 62)) return "snow";
  // A mostly-clear night should read as open sky. Turning modest provider
  // cloud cover into the daytime broken-cumulus composition creates giant
  // pale lobes that compete with the hero and its condition icon.
  if (quietClearNight && high >= 42 && low < 46) return "cirrus";
  if (quietClearNight && (cloud < 62 || low < 42)) return "clear";
  if (high > Math.max(46, low + 18) && low < 46 && !activePrecip) return "cirrus";
  if (!activePrecip && (sunVisible || directness > 0.22) && cloud < 92) return "broken";
  if (cloud >= 76 && low >= 52 && directness < 0.24) return "overcast";
  if (condition === "partly-cloudy" || cloud >= 30) return "broken";
  if (high >= 32) return "cirrus";
  return "clear";
}

function skySceneConfig(condition, isDay, skyState = state.skyState) {
  const tod = isDay ? "day" : "night";
  const base = SKY_CFG[tod][condition] || SKY_CFG[tod].overcast;
  if (!skyState) return { ...base, cloudFamily: skyCloudVisualFamily(condition, null, base.sun) };

  const cloudPct = clamp(skyState.cloud, 0, 100);
  const visualCloudPct = skyVisualCloudDepth(condition, cloudPct / 100) * 100;
  const lowCloud = clamp01(skyState.lowCloud / 100);
  const highCloud = clamp01(skyState.highCloud / 100);
  const precipPressure = skyState.precipPressure ?? 0;
  const activePrecip = skyState.activePrecip === true || skyState.precipPhase === "active";
  const welcomeClearCue = skyState.welcomeAmbient === true && condition === "clear";
  const scenicCloudPct = welcomeClearCue ? Math.min(cloudPct, 42) : cloudPct;
  const scenicVisualCloudPct = welcomeClearCue ? Math.min(visualCloudPct, 42) : visualCloudPct;
  const precipCloudBonus = condition === "rain" || condition === "snow" || condition === "thunder" ? 1 : 0;
  const layerCloud = condition === "partly-cloudy"
    ? lowCloud * 0.55 + highCloud * 0.20
    : welcomeClearCue
      ? Math.min(lowCloud * 0.55 + highCloud * 0.18, 0.62)
      : lowCloud * 1.2 + highCloud * 0.4;
  const cloudDivisor = condition === "partly-cloudy" ? 30 : 18;
  const clouds = Math.round(clamp(
    scenicVisualCloudPct / cloudDivisor + layerCloud + precipCloudBonus + precipPressure * 1.45,
    condition === "clear" ? 0 : condition === "partly-cloudy" ? 2 : 1,
    condition === "partly-cloudy" ? 4 : condition === "overcast" || condition === "thunder" ? 7 : condition === "rain" ? 6 : 5
  ));
  const skyObjectCloudPct = condition === "partly-cloudy" ? visualCloudPct : welcomeClearCue ? scenicCloudPct : cloudPct;
  const moonCloudLimit = welcomeClearCue ? 96 : 82;
  const moonTwilightLimit = welcomeClearCue ? 0.92 : 0.82;
  const moonVisible = !isDay && skyObjectCloudPct < moonCloudLimit && skyState.twilight < moonTwilightLimit && condition !== "rain" && condition !== "thunder";
  // The hero already carries the literal condition icon. Keep a moon disc for
  // the spacious welcome ambience only; the forecast uses a soft off-axis
  // lunar glow so the background never becomes a duplicate weather glyph.
  const moonDiscVisible = moonVisible && skyState.welcomeAmbient === true && (base.moon || condition === "overcast");
  const moonGlowVisible = !isDay && !moonDiscVisible && skyObjectCloudPct < 92 && condition !== "rain" && condition !== "thunder";
  const sunVisible = isDay &&
    !activePrecip &&
    condition !== "thunder" &&
    (condition === "clear" || condition === "partly-cloudy" || skyState.directness > 0.23 || cloudPct < 72);
  const cloudFamily = skyCloudVisualFamily(condition, skyState, sunVisible);
  const stars = !isDay
    ? Math.round((base.stars || 0) * (1 - skyState.twilight * 0.85) * (1 - skyObjectCloudPct / 130) * (1 - skyState.haze * 0.55))
    : 0;

  return {
    ...base,
    stars: Math.max(0, stars),
    moon: moonDiscVisible,
    moonGlow: moonGlowVisible,
    sun: sunVisible,
    clouds,
    cloudFamily,
    rain: base.rain,
    snow: base.snow,
    lightning: base.lightning
  };
}

function renderSkyScene(el, condition, isDay, skyState = state.skyState) {
  const perf = perfStart();
  const { width: vw, height: vh } = skyViewportSize();
  const cfg = skySceneConfig(condition, isDay, skyState);
  const motion = skyMotionProfile(condition, skyState);
  applySkyMotionProfile(motion);
  const seedFor = (key) => skyLayerSeed(key, condition, isDay);
  const rngFor = (key) => seededSkyRandom(seedFor(key));
  const bg = skyBackgroundCss(condition, skyState);
  const phase = bg.phase;
  const reactive = reactiveSkyEnabled();

  document.documentElement.style.setProperty("--sky-page-bg", bg.css);
  document.documentElement.style.setProperty("--sky-page-bg-color", bg.bottom || bg.top || defaultChromeColor());
  el.style.background = bg.css;

  const parts = [skyFilterDefs()];
  const starCount = reactive ? Math.round(cfg.stars * (motion.density ?? 1)) : cfg.stars;
  const cloudCount = cfg.clouds;
  const hasCloudField = cloudCount > 0 && cfg.cloudFamily !== "clear";
  if (starCount)        parts.push(skyStars(vw, vh, starCount, rngFor("stars"), motion));
  if (starCount >= 60 && motion.rareMotion) parts.push(skyShootingStar(vw, vh, rngFor("shoot"), motion));
  if (cfg.moon)         parts.push(skyMoon(vw, vh, phase));
  if (cfg.moonGlow)     parts.push(skyMoonGlow(vw, vh, phase));
  if (cfg.sun && phase.golden > 0.12) parts.push(skyHorizonGlow(vw, vh, phase));
  if (cfg.sun)          parts.push(skySun(vw, vh, phase, motion));
  if (hasCloudField)    parts.push(skyClouds(vw, vh, cloudCount, isDay, condition, seedFor("clouds"), skyState, motion, cfg.cloudFamily, phase));
  if (skyState?.haze > 0.08 || phase.warmth > 0.18) parts.push(skyHaze(vw, vh, skyState || phase));
  if ((skyState?.precipPressure ?? 0) > 0.08) parts.push(skyApproachVeil(vw, vh, skyState));
  if ((skyState?.airHaze ?? 0) > 0.08 || (skyState?.pollenVeil ?? 0) > 0.10) parts.push(skyAirVeil(vw, vh, skyState));
  if (cfg.rain)         parts.push(skyRain(vw, vh, cfg.lightning, rngFor("rain"), skyState, motion));
  if (cfg.snow)         parts.push(skySnow(vw, vh, rngFor("snow"), skyState, motion));
  if (cfg.lightning)    parts.push(skyLightning(vw, vh, rngFor("lightning"), motion));

  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice">${parts.join("")}</svg>`;
  if (reactive) {
    reactiveSkyPresentationActive = Boolean(cfg.rain || hasCloudField);
    document.documentElement.dataset.skyReactiveRenderer = motion.level;
    if (reactiveSkyPresentationActive) applyReactiveSkyPose({ force: true });
    else clearReactiveSkyVectorProps();
  } else {
    resetReactiveSkyPresentation();
  }
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

function skyVisibleBox(vw, vh) {
  const hasOverscan = vh > SKY_RENDER_OVERSCAN_PX * 2 + 240;
  const verticalOverscan = hasOverscan ? SKY_RENDER_OVERSCAN_PX : 0;
  return {
    x: 0,
    y: verticalOverscan,
    width: vw,
    height: Math.max(1, vh - verticalOverscan * 2)
  };
}

function skyVisiblePoint(vw, vh, phase, options = {}) {
  const box = skyVisibleBox(vw, vh);
  const minY = options.minY ?? 0.10;
  const maxY = options.maxY ?? 0.36;
  return {
    x: Math.round(box.x + box.width * clamp01(phase.x ?? 0.5)),
    y: Math.round(box.y + box.height * clamp(phase.y ?? 0.16, minY, maxY))
  };
}

function skyChromeSafeMinY(defaultMinY) {
  return state.skyState?.welcomeAmbient === true ? defaultMinY : Math.max(defaultMinY, 0.18);
}

function skyNightAccentPoint(vw, vh, phase) {
  const box = skyVisibleBox(vw, vh);
  // Reserve the left side for controls and keep the accent above launch copy.
  const x = clamp(phase?.x ?? 0.72, 0.66, 0.84);
  return {
    x: Math.round(box.x + box.width * x),
    y: Math.round(box.y + box.height * 0.105)
  };
}

function skyFilterDefs() {
  return `<defs>
    <filter id="sky-glow-f" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="22"/>
    </filter>
  </defs>`;
}

function skyStars(vw, vh, count, rng, motion = skyMotionProfile("clear")) {
  const groups = ["", "", "", ""];
  for (let i = 0; i < count; i++) {
    const x = (rng() * vw).toFixed(1);
    const y = (rng() * vh * 0.82).toFixed(1);
    const r = (rng() * 1.2 + 0.4).toFixed(1);
    const op = (rng() * 0.5 + 0.25).toFixed(2);
    groups[i % groups.length] += `<circle cx="${x}" cy="${y}" r="${r}" fill="#e8f0ff" class="sky-star" opacity="${op}"/>`;
  }
  return groups
    .map((content, index) => {
      if (!content) return "";
      const animated = index < motion.animateStars;
      const dur = (4.2 + index * 1.35).toFixed(1);
      const delay = (index * 1.6).toFixed(1);
      const low = (0.42 + index * 0.08).toFixed(2);
      return `<g class="sky-star-field${animated ? " is-animated" : ""}" style="--twinkle-low:${low};animation-duration:${dur}s;animation-delay:-${delay}s">${content}</g>`;
    })
    .join("");
}

function skyMoon(vw, vh, phase) {
  const point = skyNightAccentPoint(vw, vh, phase);
  const cx = point.x, cy = point.y, r = Math.round(clamp(vw * 0.052, 18, 22));
  const { illum, waxing } = moonPhase(state.skyState?.nowMs ?? skyNow());
  // Carve the phase: white disc minus an offset black disc → crescent → gibbous.
  const sep = illum * 2 * r;
  const sx = (cx + (waxing ? -sep : sep)).toFixed(1);
  const id = `sky-moon-${++skyMaskCounter}`;
  return `
    <circle cx="${cx}" cy="${cy}" r="${Math.round(r * 2.8)}" fill="#8093bf" opacity="0.055" filter="url(#sky-glow-f)" class="sky-lunar-haze"/>
    <defs><mask id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/><circle cx="${sx}" cy="${cy}" r="${r}" fill="#000"/></mask></defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#eef4ff" opacity="0.82" mask="url(#${id})"/>
    <circle cx="${cx - Math.round(r * 0.18)}" cy="${cy - Math.round(r * 0.14)}" r="${Math.round(r * 0.7)}" fill="#fff" opacity="0.08" mask="url(#${id})"/>
  `;
}

function skyMoonGlow(vw, vh, phase) {
  const point = skyNightAccentPoint(vw, vh, phase);
  const radius = Math.round(clamp(vw * 0.15, 48, 68));
  return `<circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="#8093bd" opacity="0.075" filter="url(#sky-glow-f)" class="sky-lunar-haze"/>`;
}

function skySun(vw, vh, phase, motion = skyMotionProfile("clear")) {
  const isPartly = phase.condition === "partly-cloudy";
  const point = skyVisiblePoint(
    vw,
    vh,
    isPartly ? { ...phase, y: Math.max(phase.y ?? 0.16, 0.16) } : phase,
    { minY: skyChromeSafeMinY(isPartly ? 0.15 : 0.11), maxY: 0.34 }
  );
  const cx = point.x, cy = point.y, r = isPartly ? 50 : 46;
  const warm = phase.warmth ?? phase.golden;
  const brightness = clamp01((phase.brightness ?? 0.68) + (isPartly ? 0.10 : 0));
  const directness = clamp01((phase.directness ?? 0.7) + (isPartly ? 0.16 : 0));
  const haze = phase.haze ?? 0;
  const core = lerpHex("#ffdf67", "#ff9a3c", warm);
  const halo = lerpHex(lerpHex("#ffe56f", "#fff3a6", clamp01((brightness - 0.55) / 0.32)), "#ff8a4a", warm);
  return `
    <circle cx="${cx}" cy="${cy}" r="${r * (4.1 + haze * 1.3)}" fill="${halo}" opacity="${(0.13 + warm * 0.18 + haze * 0.10).toFixed(2)}" filter="url(#sky-glow-f)"/>
    <circle cx="${cx}" cy="${cy}" r="${r * (1.9 + brightness * 0.65)}" fill="#fff5b4" opacity="${(0.12 + brightness * 0.11).toFixed(2)}" filter="url(#sky-glow-f)"/>
    <g transform="translate(${cx} ${cy})">${skySunRays(r, warm, directness, motion)}</g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${core}" opacity="${(0.74 + directness * 0.23).toFixed(2)}"/>
    <circle cx="${cx - 13}" cy="${cy - 13}" r="${Math.round(r * 0.52)}" fill="#fff7b6" opacity="0.22"/>
  `;
}

function skySunRays(r, warm, directness = 0.7, motion = skyMotionProfile("clear")) {
  let lines = "";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lines += `<line x1="${(Math.cos(a) * r * 1.45).toFixed(0)}" y1="${(Math.sin(a) * r * 1.45).toFixed(0)}" x2="${(Math.cos(a) * r * 2.6).toFixed(0)}" y2="${(Math.sin(a) * r * 2.6).toFixed(0)}" stroke="#fff0b0" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return `<g class="sky-sun-rays${motion.sunMotion ? " is-animated" : ""}" opacity="${(0.05 + directness * 0.13 + warm * 0.08).toFixed(2)}">${lines}</g>`;
}

// Warm bloom around a low sun during golden hour.
function skyHorizonGlow(vw, vh, phase) {
  const point = skyVisiblePoint(vw, vh, { ...phase, y: (phase.y ?? 0.16) + 0.05 }, { minY: 0.16, maxY: 0.42 });
  const gx = point.x;
  const gy = point.y;
  const warm = phase.warmth ?? phase.golden;
  return `<ellipse cx="${gx}" cy="${gy}" rx="${Math.round(vw * 0.62)}" ry="${Math.round(vh * 0.2)}" fill="#ff9d5a" opacity="${(warm * 0.42).toFixed(2)}" filter="url(#sky-glow-f)"/>`;
}

// One rare meteor streak on clear nights — a small surprise, not a feature.
function skyShootingStar(vw, vh, rng, motion = skyMotionProfile("clear")) {
  const x = ((0.32 + rng() * 0.5) * vw).toFixed(0);
  const y = ((0.06 + rng() * 0.18) * vh).toFixed(0);
  const len = 110 + rng() * 80;
  const delay = (6 + rng() * 26).toFixed(1);
  return `<line x1="${x}" y1="${y}" x2="${(Number(x) - len * 0.92).toFixed(0)}" y2="${(Number(y) + len * 0.4).toFixed(0)}" class="sky-shoot${motion.rareMotion ? " is-animated" : ""}" stroke="#ffffff" stroke-width="2" stroke-linecap="round" style="animation-delay:${delay}s"/>`;
}

// Cloudfield V2 renders a curated weather composition into two tiny atlases.
// Noise only softens edges and adds volume; it never decides the composition.
// The same cached pixels are used by standard, reactive, and still skies.
function skyCloudQuantize(value, steps = 8) {
  return Math.round(clamp01(Number(value) || 0) * steps) / steps;
}

function skyCloudDescriptor(count, isDay, family, skyState, phase) {
  const cloud = skyState?.cloud ?? (family === "overcast" || family === "rain" ? 88 : family === "broken" ? 48 : 24);
  const low = skyState?.lowCloud ?? cloud * 0.55;
  const high = skyState?.highCloud ?? cloud * 0.35;
  return {
    family,
    isDay: isDay !== false,
    count: Math.round(clamp(count, 1, 7)),
    coverage: skyCloudQuantize(cloud / 100, 10),
    low: skyCloudQuantize(low / 100, 8),
    high: skyCloudQuantize(high / 100, 8),
    haze: skyCloudQuantize(skyState?.haze ?? 0, 6),
    warmth: skyCloudQuantize(skyState?.warmth ?? phase?.warmth ?? 0, 6),
    directness: skyCloudQuantize(skyState?.directness ?? phase?.directness ?? 0, 6),
    pressure: skyCloudQuantize(skyState?.precipPressure ?? 0, 6),
    sunX: skyCloudQuantize(phase?.x ?? 0.5, 10),
    sunY: skyCloudQuantize(phase?.y ?? 0.18, 10)
  };
}

function skyCloudAtlasPlan(vw, vh, family) {
  const bucketWidth = Math.ceil(Math.max(320, vw) / 40) * 40;
  const visibleHeight = Math.max(480, vh - SKY_RENDER_OVERSCAN_PX * 2);
  const bucketVisibleHeight = Math.ceil(visibleHeight / 56) * 56;
  const bucketHeight = bucketVisibleHeight + SKY_RENDER_OVERSCAN_PX * 2;
  const box = skyVisibleBox(bucketWidth, bucketHeight);
  const overscan = Math.round(clamp(bucketWidth * 0.27, 96, 148));
  const heightFactor = family === "cirrus" ? 0.44 : family === "broken" ? 0.56 : family === "rain" ? 0.66 : 0.61;
  const width = bucketWidth + overscan * 2;
  const height = Math.round(box.height * heightFactor);
  const x = -overscan;
  const y = Math.round(box.y - box.height * 0.035);
  const logicalArea = Math.max(1, width * height);
  const farScale = Math.min(0.46, Math.sqrt((SKY_CLOUD_ATLAS_PIXEL_BUDGET * 0.40) / logicalArea));
  const nearScale = Math.min(0.56, Math.sqrt((SKY_CLOUD_ATLAS_PIXEL_BUDGET * 0.60) / logicalArea));
  const layer = (renderScale) => ({
    width,
    height,
    renderScale,
    pixelWidth: Math.max(2, Math.round(width * renderScale)),
    pixelHeight: Math.max(2, Math.round(height * renderScale))
  });
  return {
    pixelBudget: SKY_CLOUD_ATLAS_PIXEL_BUDGET,
    viewportWidth: bucketWidth,
    viewportHeight: bucketHeight,
    visibleHeight: box.height,
    overscan,
    x,
    y,
    width,
    height,
    far: layer(farScale),
    near: layer(nearScale)
  };
}

function skyCloudHashSample(x, y, seed) {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

function skyCloudValueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = skyCloudHashSample(ix, iy, seed);
  const b = skyCloudHashSample(ix + 1, iy, seed);
  const c = skyCloudHashSample(ix, iy + 1, seed);
  const d = skyCloudHashSample(ix + 1, iy + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

function skyCloudFbm(x, y, seed, octaves = 3) {
  let value = 0;
  let amplitude = 0.56;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += skyCloudValueNoise(x, y, seed + octave * 37) * amplitude;
    normalizer += amplitude;
    const nextX = x * 1.91 - y * 0.18;
    const nextY = x * 0.14 + y * 2.03;
    x = nextX + 0.7;
    y = nextY + 0.3;
    amplitude *= 0.5;
  }
  return value / normalizer;
}

function skyCloudGaussian(u, v, cx, cy, rx, ry) {
  const dx = (u - cx) / Math.max(0.01, rx);
  const dy = (v - cy) / Math.max(0.01, ry);
  return Math.exp(-(dx * dx + dy * dy) * 1.45);
}

function skyCloudSoftUnion(a, b, c, base, satellite) {
  // Fixed arity keeps the per-pixel cloud pass allocation-free.
  return clamp01(1 - (
    (1 - clamp01(a * 0.76)) *
    (1 - clamp01(b * 0.78)) *
    (1 - clamp01(c * 0.76)) *
    (1 - clamp01(base * 0.60)) *
    (1 - clamp01(satellite * 0.34))
  ));
}

function skyCloudPalette(family, isDay, layer) {
  if (!isDay) {
    if (family === "rain") return layer === "near" ? { light: [76, 91, 116], shade: [18, 27, 44] } : { light: [93, 108, 134], shade: [30, 40, 60] };
    if (family === "snow") return layer === "near" ? { light: [144, 161, 187], shade: [52, 68, 94] } : { light: [166, 181, 205], shade: [68, 82, 109] };
    if (family === "overcast") return layer === "near" ? { light: [105, 120, 146], shade: [31, 42, 63] } : { light: [124, 139, 164], shade: [47, 59, 82] };
    if (family === "cirrus") return layer === "near" ? { light: [103, 119, 148], shade: [27, 39, 65] } : { light: [121, 137, 165], shade: [38, 51, 78] };
    return layer === "near" ? { light: [95, 112, 142], shade: [24, 36, 61] } : { light: [114, 131, 160], shade: [35, 48, 75] };
  }
  if (family === "rain") return layer === "near" ? { light: [139, 153, 161], shade: [45, 61, 73] } : { light: [168, 180, 185], shade: [82, 99, 110] };
  if (family === "snow") return layer === "near" ? { light: [245, 249, 250], shade: [163, 183, 196] } : { light: [252, 253, 252], shade: [188, 204, 213] };
  if (family === "overcast") return layer === "near" ? { light: [218, 220, 216], shade: [96, 114, 124] } : { light: [231, 233, 230], shade: [145, 162, 170] };
  return layer === "near" ? { light: [255, 252, 242], shade: [108, 141, 163] } : { light: [249, 252, 252], shade: [166, 195, 211] };
}

function skyCloudPixel(descriptor, layer, u, v, texture, seed) {
  const family = descriptor.family;
  const sunU = clamp(descriptor.atlasSunX ?? descriptor.sunX, 0.08, 0.92);
  const sunV = clamp(descriptor.atlasSunY ?? descriptor.sunY, 0.08, 0.72);
  const visibleStart = descriptor.atlasVisibleStart ?? 0;
  const visibleSpan = descriptor.atlasVisibleSpan ?? 1;
  const visibleEnd = visibleStart + visibleSpan;
  const visibleMid = visibleStart + visibleSpan * 0.5;
  const oppositeX = visibleStart + visibleSpan * (sunU < visibleMid ? 0.72 : 0.28);
  const jitter = (skyCloudHashSample(layer === "far" ? 13 : 29, 7, seed) - 0.5) * 0.09;
  // Daylight can open a believable pocket around a visible sun. At night the
  // same subtraction reads as a hard-edged spotlight or beam, so moonlight is
  // handled by the independent soft glow instead.
  const opening = descriptor.isDay
    ? skyCloudGaussian(u, v, sunU, sunV, family === "cirrus" ? 0.22 : 0.30, 0.29)
    : 0;
  let alpha = 0;
  let light = clamp(0.36 + (1 - v) * 0.32 + (texture - 0.5) * 0.44, 0.12, 0.92);

  if (family === "cirrus") {
    const ridgeA = Math.exp(-Math.pow((v - (0.13 + u * 0.08 + jitter)) / 0.095, 2));
    const ridgeB = Math.exp(-Math.pow((v - (0.28 - u * 0.045 - jitter * 0.5)) / 0.075, 2));
    const strand = Math.max(ridgeA, ridgeB * 0.68);
    alpha = smoothstep(0.51, 0.73, texture + strand * 0.31 - opening * 0.22) * strand * (layer === "far" ? 0.36 : 0.48);
    light = clamp(light + 0.18, 0.25, 1);
  } else if (family === "broken") {
    if (layer === "far") {
      const wispA = skyCloudGaussian(u, v, oppositeX + jitter, 0.22, 0.38, 0.13);
      const wispB = skyCloudGaussian(u, v, clamp(oppositeX + (sunU < visibleMid ? -0.18 : 0.18), visibleStart + 0.04, visibleEnd - 0.04), 0.34, 0.22, 0.10);
      const density = Math.max(wispA, wispB * 0.72) * 0.72 + (texture - 0.5) * 0.52 - opening * 0.62;
      alpha = smoothstep(0.16, 0.42, density) * (1 - smoothstep(0.54, 0.88, v)) * 0.50;
      light = clamp(0.58 + (texture - 0.5) * 0.52 - v * 0.12, 0.36, 0.94);
    } else {
      const side = sunU < visibleMid ? 1 : -1;
      const lobeA = skyCloudGaussian(u, v, oppositeX - side * 0.12 + jitter, 0.36, 0.15, 0.15);
      const lobeB = skyCloudGaussian(u, v, oppositeX + side * 0.04 - jitter * 0.5, 0.29, 0.17, 0.18);
      const lobeC = skyCloudGaussian(u, v, oppositeX + side * 0.17 + jitter * 0.35, 0.39, 0.15, 0.15);
      const base = skyCloudGaussian(u, v, oppositeX + jitter * 0.2, 0.49, 0.34, 0.16);
      const satellite = skyCloudGaussian(u, v, clamp(oppositeX - side * 0.24, visibleStart + 0.03, visibleEnd - 0.03), 0.32, 0.13, 0.13);
      const macro = skyCloudSoftUnion(lobeA, lobeB, lobeC, base, satellite);
      const density = macro * 0.86 + (texture - 0.5) * 0.46 - opening * 0.78;
      alpha = smoothstep(0.22, 0.56, density) * (1 - smoothstep(0.65, 0.94, v)) * 0.84;
      const crownLight = Math.max(lobeA, lobeB, lobeC);
      light = clamp(0.20 + crownLight * 0.72 + (texture - 0.5) * 0.34 - v * 0.16, 0.10, 0.98);
    }
  } else if (family === "rain") {
    const ceiling = 1 - smoothstep(layer === "far" ? 0.64 : 0.78, 1, v);
    const shelf = skyCloudGaussian(u, v, 0.48 + jitter, layer === "far" ? 0.30 : 0.47, 0.72, layer === "far" ? 0.30 : 0.27);
    const density = texture * 0.73 + shelf * 0.31 + descriptor.pressure * 0.10;
    alpha = layer === "far"
      ? 0.22 + smoothstep(0.43, 0.72, density) * 0.35
      : smoothstep(0.43, 0.68, density) * 0.80;
    alpha *= ceiling;
    light = clamp(light - 0.20 - v * 0.18, 0.05, 0.58);
  } else if (family === "snow") {
    const ceiling = 1 - smoothstep(layer === "far" ? 0.62 : 0.76, 1, v);
    const glow = skyCloudGaussian(u, v, 0.52, layer === "far" ? 0.30 : 0.44, 0.72, 0.34);
    alpha = ((layer === "far" ? 0.26 : 0.20) + smoothstep(0.44, 0.72, texture + glow * 0.17) * (layer === "far" ? 0.34 : 0.52)) * ceiling;
    light = clamp(light + 0.13, 0.28, 0.96);
  } else {
    const ceiling = 1 - smoothstep(layer === "far" ? 0.62 : 0.75, 1, v);
    const underside = skyCloudGaussian(u, v, 0.52 + jitter, layer === "far" ? 0.31 : 0.46, 0.76, layer === "far" ? 0.31 : 0.26);
    if (layer === "far") alpha = (0.16 + smoothstep(0.39, 0.72, texture + underside * 0.13) * 0.32) * ceiling;
    else alpha = smoothstep(0.47, 0.68, texture + underside * 0.25) * 0.72 * ceiling;
    alpha *= 1 - opening * Math.max(0.08, descriptor.directness * 0.34);
    light = layer === "far"
      ? clamp(0.48 + (texture - 0.5) * 0.46 - v * 0.12, 0.25, 0.78)
      : clamp(0.14 + texture * 0.70 - v * 0.19 + underside * 0.05, 0.10, 0.76);
  }

  if (!descriptor.isDay && family === "broken") alpha *= layer === "far" ? 0.42 : 0.30;
  if (!descriptor.isDay && family === "cirrus") alpha *= layer === "far" ? 0.50 : 0.38;
  const coverageLift = family === "broken" || family === "cirrus" ? 0.84 + descriptor.coverage * 0.20 : 0.94 + descriptor.coverage * 0.06;
  const maximumAlpha = family === "rain" ? 0.84 : family === "broken" || family === "cirrus" ? 0.84 : 0.88;
  return { alpha: clamp(alpha * coverageLift, 0, maximumAlpha), light };
}

// This is the only paint-heavy cloud work. It runs once per quantized scene,
// remains inside a fixed physical-pixel budget, and releases its canvases as
// soon as the PNG data is cached.
function skyCloudAtlasDataUrl(plan, descriptor, layer, seed) {
  try {
    const layerPlan = plan[layer];
    const canvas = document.createElement("canvas");
    canvas.width = layerPlan.pixelWidth;
    canvas.height = layerPlan.pixelHeight;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;
    const image = context.createImageData(canvas.width, canvas.height);
    const pixels = image.data;
    const palette = skyCloudPalette(descriptor.family, descriptor.isDay, layer);
    const atlasDescriptor = {
      ...descriptor,
      atlasSunX: (plan.overscan + plan.viewportWidth * descriptor.sunX) / plan.width,
      atlasSunY: (plan.visibleHeight * 0.035 + plan.visibleHeight * descriptor.sunY) / plan.height,
      atlasVisibleStart: plan.overscan / plan.width,
      atlasVisibleSpan: plan.viewportWidth / plan.width
    };
    const seedOffset = layer === "far" ? seed + 113 : seed + 719;
    const xScale = layer === "far" ? 2.25 : 2.95;
    const yScale = layer === "far" ? 3.20 : 3.75;

    for (let py = 0; py < canvas.height; py++) {
      const v = canvas.height > 1 ? py / (canvas.height - 1) : 0;
      for (let px = 0; px < canvas.width; px++) {
        const u = canvas.width > 1 ? px / (canvas.width - 1) : 0;
        const broad = skyCloudFbm(u * xScale + 0.7, v * yScale + 0.3, seedOffset, 3);
        const detail = skyCloudFbm(u * xScale * 2.37 + 3.1, v * yScale * 2.08 + 1.7, seedOffset + 191, 2);
        const texture = broad * 0.74 + detail * 0.26;
        const cloud = skyCloudPixel(atlasDescriptor, layer, u, v, texture, seedOffset);
        const warmDistanceX = (u - atlasDescriptor.atlasSunX) / 0.42;
        const warmDistanceY = (v - atlasDescriptor.atlasSunY) / 0.48;
        const warmLight = Math.exp(-(warmDistanceX * warmDistanceX + warmDistanceY * warmDistanceY) * 1.2) * descriptor.warmth;
        const light = clamp(cloud.light + warmLight * 0.12, 0, 1);
        const index = (py * canvas.width + px) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const base = palette.shade[channel] + (palette.light[channel] - palette.shade[channel]) * light;
          const warmTarget = channel === 0 ? 255 : channel === 1 ? 199 : 151;
          pixels[index + channel] = Math.round(base + (warmTarget - base) * warmLight * 0.23);
        }
        pixels[index + 3] = Math.round(cloud.alpha * 255);
      }
    }
    context.putImageData(image, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    canvas.width = 1;
    canvas.height = 1;
    return dataUrl;
  } catch {
    return null;
  }
}

function skyCloudAtlasPair(vw, vh, count, isDay, family, seed, skyState, phase) {
  const descriptor = skyCloudDescriptor(count, isDay, family, skyState, phase);
  const plan = skyCloudAtlasPlan(vw, vh, family);
  const descriptorKey = [
    SKY_CLOUD_VERSION,
    seed,
    plan.viewportWidth,
    plan.viewportHeight,
    descriptor.family,
    descriptor.isDay ? "day" : "night",
    descriptor.count,
    descriptor.coverage,
    descriptor.low,
    descriptor.high,
    descriptor.haze,
    descriptor.warmth,
    descriptor.directness,
    descriptor.pressure,
    descriptor.sunX,
    descriptor.sunY
  ].join(":");
  if (skyCloudAtlasCache.has(descriptorKey)) {
    const cached = skyCloudAtlasCache.get(descriptorKey);
    skyCloudAtlasCache.delete(descriptorKey);
    skyCloudAtlasCache.set(descriptorKey, cached);
    return cached;
  }

  const farDataUrl = skyCloudAtlasDataUrl(plan, descriptor, "far", seed);
  const nearDataUrl = skyCloudAtlasDataUrl(plan, descriptor, "near", seed);
  const atlas = farDataUrl && nearDataUrl ? { descriptor, plan, farDataUrl, nearDataUrl } : null;
  skyCloudAtlasCache.set(descriptorKey, atlas);
  while (skyCloudAtlasCache.size > SKY_CLOUD_ATLAS_CACHE_LIMIT) {
    skyCloudAtlasCache.delete(skyCloudAtlasCache.keys().next().value);
  }
  return atlas;
}

function skyClouds(vw, vh, count, isDay, condition, seed, skyState = null, motion = skyMotionProfile(condition, skyState), family = null, phase = skyPhase(skyState)) {
  const visualFamily = family || skyCloudVisualFamily(condition, skyState, false);
  if (visualFamily === "clear") return "";
  const atlas = skyCloudAtlasPair(vw, vh, count, isDay, visualFamily, seed, skyState, phase);
  if (!atlas) return "";

  const reactive = reactiveSkyEnabled();
  const animated = motion.animateClouds > 0;
  const windiness = clamp01(skyState?.windiness ?? 0);
  const travel = normalizeSkyBearing(skyState?.windTravelDeg);
  const crosswind = travel === null ? 0 : Math.sin(travel * Math.PI / 180);
  const fallbackDirection = seed % 2 ? 1 : -1;
  const direction = Math.abs(crosswind) > 0.14 ? Math.sign(crosswind) : fallbackDirection;
  const nearDistance = direction * Math.round(18 + windiness * 24);
  const farDistance = direction * Math.round(10 + windiness * 14);
  const nearDuration = Math.round(142 - windiness * 58);
  const farDuration = Math.round(nearDuration * 1.34);
  const { plan } = atlas;

  const image = (layer, dataUrl) => `<image class="sky-cloud-atlas sky-cloud-atlas-${layer}" href="${dataUrl}" x="${plan.x}" y="${plan.y}" width="${plan.width}" height="${plan.height}" preserveAspectRatio="none"/>`;
  const renderLayer = (layer, dataUrl, duration, distance, delay) => {
    const field = `<g class="sky-cloud-field sky-cloud-field-${layer}${!reactive && animated ? " is-animated" : ""}"${!reactive ? ` style="--sky-cloud-drift:${distance}px;animation-duration:${duration}s;animation-delay:-${delay}s"` : ""}>${image(layer, dataUrl)}</g>`;
    if (!reactive) return field;
    return `<g class="sky-reactive-cloud-vector sky-reactive-cloud-${layer}${animated ? " is-animated" : ""}" style="animation-duration:${duration}s">${field}</g>`;
  };

  return [
    renderLayer("far", atlas.farDataUrl, farDuration, farDistance, Math.round(farDuration * 0.37)),
    renderLayer("near", atlas.nearDataUrl, nearDuration, nearDistance, Math.round(nearDuration * 0.61))
  ].join("");
}

function skyHaze(vw, vh, skyState) {
  const haze = clamp01(skyState?.haze ?? 0);
  const warm = clamp01(skyState?.warmth ?? 0);
  const cloud = clamp01((skyState?.cloud ?? 0) / 100);
  const air = clamp01(skyState?.airHaze ?? 0);
  const pollen = clamp01(skyState?.pollenVeil ?? 0);
  const isDay = skyState?.isDay !== false;
  const topOpacity = isDay
    ? clamp(haze * 0.20 + warm * 0.08 + cloud * 0.04 + air * 0.10 + pollen * 0.05, 0.02, 0.3)
    : clamp(haze * 0.08 + cloud * 0.015 + air * 0.04 + pollen * 0.025, 0.008, 0.11);
  const horizonOpacity = isDay
    ? clamp(haze * 0.30 + warm * 0.18 + air * 0.12 + pollen * 0.08, 0.03, 0.4)
    : clamp(haze * 0.12 + warm * 0.04 + air * 0.05 + pollen * 0.035, 0.01, 0.14);
  const fill = isDay
    ? lerpHex("#dcebf4", "#ffd0a0", warm)
    : lerpHex("#6e819e", "#987a86", warm);
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

function skyRainTextureDataUrl({ width, height, count, intensity, color, near, rng, renderScale }) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width * renderScale));
  canvas.height = Math.max(2, Math.round(height * renderScale));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return null;
  context.scale(renderScale, renderScale);
  context.strokeStyle = color;
  context.lineCap = near ? "round" : "butt";

  // Spread drops through shallow vertical strata before applying seeded
  // jitter. This keeps one memorable random clump from becoming the visual
  // signature of the whole repeating atlas.
  const yPhase = rng();
  for (let i = 0; i < count; i++) {
    const x = rng() * width;
    const y = ((i + yPhase + rng() * 0.82) % Math.max(1, count)) / Math.max(1, count) * height;
    const length = near
      ? 44 + intensity * 54 + rng() * 58
      : 22 + intensity * 28 + rng() * 38;
    const lineWidth = near
      ? 0.92 + intensity * 0.72 + rng() * 0.58
      : 0.58 + intensity * 0.42 + rng() * 0.30;
    context.globalAlpha = near
      ? clamp(0.18 + intensity * 0.25 + rng() * 0.14, 0.10, 0.58)
      : clamp(0.24 + intensity * 0.26 + rng() * 0.16, 0.12, 0.62);
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (rng() - 0.5) * 2.4, y + length);
    context.stroke();
  }

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function skyRainTextureDimension(value, min, max) {
  const bounded = Math.round(clamp(value, min, max));
  if (bounded % 2) return bounded;
  return bounded < max ? bounded + 1 : bounded - 1;
}

function skyRainTextureScale(width, height, pixelBudget, preferredScale) {
  const bounded = Math.sqrt(Math.max(1, pixelBudget) / Math.max(1, width * height));
  return clamp(Math.min(preferredScale, bounded), 0.24, preferredScale);
}

function skyReactiveRainTexturePlan(vw, vh, intensity, motion, rng) {
  // The two atlases deliberately use different, odd dimensions so their
  // horizontal and vertical repeats do not lock together. They are logically
  // much taller than the old tiles, while their physical canvas pixels remain
  // capped for predictable mobile memory and scene-build cost.
  const fineWidth = skyRainTextureDimension(vw * (1.08 + rng() * 0.12), 360, 560);
  const fineHeight = skyRainTextureDimension(vh * (1.28 + rng() * 0.10), 860, 1320);
  const nearWidth = skyRainTextureDimension(vw * (0.94 + rng() * 0.10), 330, 500);
  const nearHeight = skyRainTextureDimension(vh * (0.92 + rng() * 0.10), 640, 980);
  const pixelBudget = motion.level === "ambient" ? 90000 : motion.level === "still" ? 65000 : 190000;
  const fineScale = skyRainTextureScale(
    fineWidth,
    fineHeight,
    pixelBudget * 0.56,
    motion.level === "ambient" ? 0.42 : motion.level === "still" ? 0.36 : 0.58
  );
  const nearScale = skyRainTextureScale(
    nearWidth,
    nearHeight,
    pixelBudget * 0.44,
    motion.level === "ambient" ? 0.46 : motion.level === "still" ? 0.40 : 0.64
  );
  const fineSpeed = 390 + intensity * 130;
  const nearSpeed = 510 + intensity * 150;
  const fineDuration = clamp((fineHeight / fineSpeed) * (0.96 + rng() * 0.08), 1.78, 3.25);
  const nearDuration = clamp((nearHeight / nearSpeed) * (0.95 + rng() * 0.10), 1.02, 2.10);
  const fineDirection = rng() < 0.5 ? -1 : 1;
  const nearDirection = rng() < 0.5 ? -1 : 1;

  return {
    pixelBudget,
    fine: {
      width: fineWidth,
      height: fineHeight,
      renderScale: fineScale,
      duration: fineDuration,
      wanderA: fineDirection * (2 + rng() * 3.5),
      wanderB: fineDirection * -(1.5 + rng() * 3)
    },
    near: {
      width: nearWidth,
      height: nearHeight,
      renderScale: nearScale,
      duration: nearDuration,
      wanderA: nearDirection * (3 + rng() * 5.5),
      wanderB: nearDirection * -(2.5 + rng() * 5)
    }
  };
}

// Experimental rain path: two low-resolution canvas textures replace hundreds
// of animated SVG lines. Textures are produced only when the scene rebuilds;
// pose samples move their two compositor layers through inherited CSS tokens.
function skyReactiveRain(vw, vh, heavy, rng, skyState, motion) {
  const wetness = skyState ? skyState.wetness || 0 : heavy ? 1 : 0.55;
  const pressure = skyState ? skyState.precipPressure || 0 : heavy ? 0.8 : 0.45;
  const precipitation = skyState ? skyState.precipitation || 0 : heavy ? 0.8 : 0.3;
  const active = skyState?.activePrecip === true || skyState?.precipPhase === "active";
  const intensity = skyPrecipVisualIntensity(skyState, heavy);
  const atmosphereIntensity = clamp01(intensity * 0.72 + wetness * 0.14 + pressure * 0.16 + precipitation * 0.08 + (active ? 0.03 : 0));
  const isDay = skyState?.isDay !== false;
  const warmth = clamp01(skyState?.warmth || 0);
  const lightRain = !heavy && intensity < 0.45;
  const nightOpacity = isDay ? 1 : clamp(0.52 + intensity * 0.22, 0.52, 0.76);
  const density = motion.density ?? 1;
  const fineTotal = Math.max(12, Math.round(((lightRain ? 76 : 118) + intensity * (lightRain ? 92 : 168) + (heavy ? 44 : 0)) * density));
  const nearTotal = Math.max(motion.level === "still" ? 0 : 3, Math.round((lightRain ? 5 + intensity * 15 : 13 + intensity * 40 + (heavy ? 14 : 0)) * density));
  const fineColor = isDay ? lerpHex("#8da6b4", "#b89f8c", warmth * 0.45) : lerpHex("#8197a8", "#adbfcc", intensity * 0.55);
  const nearColor = isDay ? lerpHex("#f4fafc", "#f3dcc2", warmth * 0.48) : lerpHex("#a7bac8", "#d4e0ea", intensity * 0.5);
  const veilColor = isDay ? lerpHex("#8797a2", "#ad9683", warmth * 0.45) : "#151d29";
  const glowColor = isDay ? lerpHex("#d5e1e7", "#ead5bf", warmth * 0.5) : "#a8bacd";
  const veilOpacity = clamp(0.055 + atmosphereIntensity * 0.12 + pressure * 0.045 + (active ? 0.025 : 0), 0.06, heavy ? 0.29 : 0.21);
  const horizonOpacity = clamp(0.06 + atmosphereIntensity * 0.12 + pressure * 0.045 + (active ? 0.02 : 0), 0.06, heavy ? 0.30 : 0.22);
  const viewportArea = Math.max(1, vw * vh);
  const texturePlan = skyReactiveRainTexturePlan(vw, vh, intensity, motion, rng);
  const fineRatio = clamp((texturePlan.fine.width * texturePlan.fine.height) / viewportArea, 0.18, 1.55);
  const nearRatio = clamp((texturePlan.near.width * texturePlan.near.height) / viewportArea, 0.18, 1.35);
  const fineTexture = skyRainTextureDataUrl({
    width: texturePlan.fine.width,
    height: texturePlan.fine.height,
    count: Math.max(8, Math.round(fineTotal * fineRatio)),
    intensity,
    color: fineColor,
    near: false,
    rng,
    renderScale: texturePlan.fine.renderScale
  });
  const nearTexture = skyRainTextureDataUrl({
    width: texturePlan.near.width,
    height: texturePlan.near.height,
    count: Math.max(motion.level === "still" ? 0 : 2, Math.round(nearTotal * nearRatio)),
    intensity,
    color: nearColor,
    near: true,
    rng,
    renderScale: texturePlan.near.renderScale
  });
  if (!fineTexture || !nearTexture) return null;

  const id = ++reactiveSkyRainTextureCounter;
  const finePattern = `sky-rain-texture-fine-${id}`;
  const nearPattern = `sky-rain-texture-near-${id}`;
  const overscan = Math.ceil(vh * 0.52 + 48);
  const animated = motion.animateAtmosphere;
  const finePhaseX = Math.round(rng() * texturePlan.fine.width);
  const finePhaseY = Math.round(rng() * texturePlan.fine.height);
  const nearPhaseX = Math.round(rng() * texturePlan.near.width);
  const nearPhaseY = Math.round(rng() * texturePlan.near.height);

  const rainLayerStyle = (layer, delay) => [
    `--rain-distance:${layer.height}px`,
    `--rain-step-a:${Math.round(layer.height * 0.37)}px`,
    `--rain-step-b:${Math.round(layer.height * 0.71)}px`,
    `--rain-wander-a:${layer.wanderA.toFixed(2)}px`,
    `--rain-wander-b:${layer.wanderB.toFixed(2)}px`,
    `animation-duration:${layer.duration.toFixed(2)}s`,
    `animation-delay:-${delay.toFixed(2)}s`
  ].join(";");

  return `
    <defs>
      <pattern id="${finePattern}" x="-${finePhaseX}" y="-${finePhaseY}" width="${texturePlan.fine.width}" height="${texturePlan.fine.height}" patternUnits="userSpaceOnUse">
        <image href="${fineTexture}" width="${texturePlan.fine.width}" height="${texturePlan.fine.height}" preserveAspectRatio="none"/>
      </pattern>
      <pattern id="${nearPattern}" x="-${nearPhaseX}" y="-${nearPhaseY}" width="${texturePlan.near.width}" height="${texturePlan.near.height}" patternUnits="userSpaceOnUse">
        <image href="${nearTexture}" width="${texturePlan.near.width}" height="${texturePlan.near.height}" preserveAspectRatio="none"/>
      </pattern>
    </defs>
    <g class="sky-rain-atmosphere">
      <rect x="0" y="0" width="${vw}" height="${vh}" fill="${veilColor}" opacity="${veilOpacity.toFixed(3)}"/>
      <rect x="0" y="0" width="${vw}" height="${Math.round(vh * (0.42 + intensity * 0.22))}" fill="${veilColor}" opacity="${(veilOpacity * 0.44).toFixed(3)}"/>
      <ellipse cx="${Math.round(vw * 0.48)}" cy="${Math.round(vh * 0.74)}" rx="${Math.round(vw * 0.78)}" ry="${Math.round(vh * 0.30)}" fill="${glowColor}" opacity="${horizonOpacity.toFixed(3)}" filter="url(#sky-glow-f)"/>
    </g>
    <g class="sky-reactive-rain-vector">
      <g class="sky-rain-layer sky-rain-curtain${animated ? " is-animated" : ""}" style="${rainLayerStyle(texturePlan.fine, rng() * texturePlan.fine.duration)}">
        <rect x="-${overscan}" y="-${texturePlan.fine.height}" width="${vw + overscan * 2}" height="${vh + texturePlan.fine.height * 2}" fill="url(#${finePattern})" opacity="${nightOpacity.toFixed(2)}"/>
      </g>
      <g class="sky-rain-layer sky-rain-foreground${animated ? " is-animated" : ""}" style="${rainLayerStyle(texturePlan.near, rng() * texturePlan.near.duration)}">
        <rect x="-${overscan}" y="-${texturePlan.near.height}" width="${vw + overscan * 2}" height="${vh + texturePlan.near.height * 2}" fill="url(#${nearPattern})" opacity="${nightOpacity.toFixed(2)}"/>
      </g>
    </g>
  `;
}

function skyRain(vw, vh, heavy = false, rng, skyState = null, motion = skyMotionProfile(heavy ? "thunder" : "rain", skyState)) {
  if (reactiveSkyEnabled()) {
    const textureRain = skyReactiveRain(vw, vh, heavy, rng, skyState, motion);
    if (textureRain) return textureRain;
  }
  const wetness = skyState ? skyState.wetness || 0 : heavy ? 1 : 0.55;
  const pressure = skyState ? skyState.precipPressure || 0 : heavy ? 0.8 : 0.45;
  const precipitation = skyState ? skyState.precipitation || 0 : heavy ? 0.8 : 0.3;
  const active = skyState?.activePrecip === true || skyState?.precipPhase === "active";
  const intensity = skyPrecipVisualIntensity(skyState, heavy);
  const atmosphereIntensity = clamp01(intensity * 0.72 + wetness * 0.14 + pressure * 0.16 + precipitation * 0.08 + (active ? 0.03 : 0));
  const windMph = skyState ? skyState.windMph || 0 : heavy ? 18 : 10;
  const windLean = clamp01(Math.max(windMph / 34, skyState?.windiness || 0));
  const isDay = skyState?.isDay !== false;
  const warmth = clamp01(skyState?.warmth || 0);
  const lightRain = !heavy && intensity < 0.45;
  const nightDensity = isDay ? 1 : clamp(0.58 + intensity * 0.28, 0.58, 0.84);
  const nightOpacity = isDay ? 1 : clamp(0.52 + intensity * 0.22, 0.52, 0.76);
  const density = motion.density ?? 1;
  const fineCount = Math.max(10, Math.round(((lightRain ? 70 : 112) + intensity * (lightRain ? 92 : 166) + (heavy ? 46 : 0) + (active ? intensity * 28 : 0)) * nightDensity * density));
  const nearCount = Math.max(motion.level === "still" ? 0 : 2, Math.round((lightRain ? 4 + intensity * 14 : 12 + intensity * 42 + (heavy ? 16 : 0) + (active ? intensity * 10 : 0)) * nightDensity * (density * 0.82)));
  const drift = 18 + windLean * 34 + intensity * 10;
  const fineColor = isDay ? lerpHex("#8da6b4", "#b89f8c", warmth * 0.45) : lerpHex("#8197a8", "#adbfcc", intensity * 0.55);
  const nearColor = isDay ? lerpHex("#f4fafc", "#f3dcc2", warmth * 0.48) : lerpHex("#a7bac8", "#d4e0ea", intensity * 0.5);
  const veilColor = isDay ? lerpHex("#8797a2", "#ad9683", warmth * 0.45) : "#151d29";
  const glowColor = isDay ? lerpHex("#d5e1e7", "#ead5bf", warmth * 0.5) : "#a8bacd";
  const veilOpacity = clamp(0.055 + atmosphereIntensity * 0.12 + pressure * 0.045 + (active ? 0.025 : 0), 0.06, heavy ? 0.29 : 0.21);
  const horizonOpacity = clamp(0.06 + atmosphereIntensity * 0.12 + pressure * 0.045 + (active ? 0.02 : 0), 0.06, heavy ? 0.30 : 0.22);
  const bandOpacity = clamp((0.022 + atmosphereIntensity * 0.055 + (active ? 0.012 : 0)) * nightOpacity, 0.018, 0.105);
  let fine = "";
  let near = "";
  let bands = "";
  const tileHeight = Math.round(vh * 1.08);
  const fineDuration = clamp(2.55 - intensity * 0.86 - windLean * 0.24, 1.10, 2.65);
  const nearDuration = clamp(1.72 - intensity * 0.48 - windLean * 0.16, 0.78, 1.78);
  const bandCount = isDay
    ? Math.max(1, Math.round((lightRain ? 3 : 4 + intensity * 3) * Math.max(0.45, density)))
    : 0;

  for (let i = 0; i < bandCount; i++) {
    const x = Math.round(-vw * 0.25 + rng() * vw * 1.15);
    const width = Math.round(vw * ((lightRain ? 0.12 : 0.18) + rng() * 0.14));
    const lean = Math.round(drift * (1.8 + rng() * 1.1));
    const op = (bandOpacity * (0.55 + rng() * 0.45)).toFixed(3);
    bands += `<path class="sky-rain-sheet${motion.animateAtmosphere ? " is-animated" : ""}" d="M${x} 0 L${x + width} 0 L${x + width + lean} ${vh} L${x + lean} ${vh} Z" fill="${glowColor}" opacity="${op}" style="--rain-drift:${drift.toFixed(0)}px;animation-delay:-${(rng() * 8).toFixed(2)}s;animation-duration:${(10 + rng() * 8).toFixed(2)}s"/>`;
  }

  for (let i = 0; i < fineCount; i++) {
    const x = -vw * 0.25 + rng() * vw * 1.5;
    const y = rng() * tileHeight;
    const len = 22 + intensity * 30 + rng() * (lightRain ? 20 : 44);
    const dx = len * (0.20 + windLean * 0.46) + drift * 0.18;
    const width = 0.56 + intensity * 0.50 + rng() * (lightRain ? 0.24 : 0.34);
    const op = clamp(((lightRain ? 0.20 : 0.30) + intensity * (lightRain ? 0.20 : 0.30) + rng() * 0.16 + (active ? 0.025 : 0)) * nightOpacity, 0.10, heavy ? 0.68 : 0.58);
    fine += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + dx).toFixed(0)}" y2="${(y + len).toFixed(0)}" class="sky-rain-streak sky-rain-fine" opacity="${op.toFixed(2)}" stroke="${fineColor}" stroke-width="${width.toFixed(2)}" stroke-linecap="butt"/>`;
  }

  for (let i = 0; i < nearCount; i++) {
    const x = -vw * 0.18 + rng() * vw * 1.36;
    const y = rng() * tileHeight;
    const len = 42 + intensity * 58 + rng() * (lightRain ? 36 : 64);
    const dx = len * (0.24 + windLean * 0.48) + drift * 0.24;
    const width = 0.88 + intensity * 0.78 + rng() * (lightRain ? 0.42 : 0.68);
    const op = clamp((0.18 + intensity * 0.25 + rng() * 0.14 + (active ? 0.025 : 0)) * nightOpacity, 0.10, heavy ? 0.62 : 0.52);
    near += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + dx).toFixed(0)}" y2="${(y + len).toFixed(0)}" class="sky-rain-streak sky-rain-near" opacity="${op.toFixed(2)}" stroke="${nearColor}" stroke-width="${width.toFixed(2)}" stroke-linecap="round"/>`;
  }

  return `
    <g class="sky-rain-atmosphere">
      <rect x="0" y="0" width="${vw}" height="${vh}" fill="${veilColor}" opacity="${veilOpacity.toFixed(3)}"/>
      <rect x="0" y="0" width="${vw}" height="${Math.round(vh * (0.42 + intensity * 0.22))}" fill="${veilColor}" opacity="${(veilOpacity * 0.44).toFixed(3)}"/>
      <ellipse cx="${Math.round(vw * 0.48)}" cy="${Math.round(vh * 0.74)}" rx="${Math.round(vw * 0.78)}" ry="${Math.round(vh * 0.30)}" fill="${glowColor}" opacity="${horizonOpacity.toFixed(3)}" filter="url(#sky-glow-f)"/>
      ${bands}
    </g>
    <g class="sky-rain-layer sky-rain-curtain${motion.animateAtmosphere ? " is-animated" : ""}" style="--rain-distance:${tileHeight}px;animation-duration:${fineDuration.toFixed(2)}s;animation-delay:-${(rng() * fineDuration).toFixed(2)}s">
      <g>${fine}</g>
      <g transform="translate(0 -${tileHeight})">${fine}</g>
    </g>
    <g class="sky-rain-layer sky-rain-foreground${motion.animateAtmosphere ? " is-animated" : ""}" style="--rain-distance:${tileHeight}px;animation-duration:${nearDuration.toFixed(2)}s;animation-delay:-${(rng() * nearDuration).toFixed(2)}s">
      <g>${near}</g>
      <g transform="translate(0 -${tileHeight})">${near}</g>
    </g>
  `;
}

function skySnow(vw, vh, rng, skyState = null, motion = skyMotionProfile("snow", skyState)) {
  const intensity = skyState ? clamp01((skyState.pop - 20) / 70 + (skyState.precipitation || 0) * 0.5) : 0.45;
  const count = Math.max(10, Math.round((34 + intensity * 30) * (motion.density ?? 1)));
  const tileHeight = Math.round(vh * 1.08);
  let far = "";
  let near = "";
  for (let i = 0; i < count; i++) {
    const x = (rng() * vw).toFixed(0);
    const y = (rng() * tileHeight).toFixed(0);
    const r = (1.4 + intensity * 0.8 + rng() * 2.5).toFixed(1);
    const op = (0.50 + rng() * 0.34).toFixed(2);
    const dot = `<circle cx="${x}" cy="${y}" r="${r}" fill="white" opacity="${op}" class="sky-snow"/>`;
    if (i % 3 === 0) near += dot;
    else far += dot;
  }
  const animated = motion.animateAtmosphere;
  const farDuration = (8.6 - intensity * 1.6).toFixed(2);
  const nearDuration = (5.2 - intensity * 1.0).toFixed(2);
  return `
    <g class="sky-snow-layer sky-snow-far${animated ? " is-animated" : ""}" style="--snow-distance:${tileHeight}px;--snow-drift:-26px;animation-duration:${farDuration}s;animation-delay:-${(rng() * Number(farDuration)).toFixed(2)}s">
      <g>${far}</g>
      <g transform="translate(0 -${tileHeight})">${far}</g>
    </g>
    <g class="sky-snow-layer sky-snow-near${animated ? " is-animated" : ""}" style="--snow-distance:${tileHeight}px;--snow-drift:34px;animation-duration:${nearDuration}s;animation-delay:-${(rng() * Number(nearDuration)).toFixed(2)}s">
      <g>${near}</g>
      <g transform="translate(0 -${tileHeight})">${near}</g>
    </g>
  `;
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

function skyLightning(vw, vh, rng, motion = skyMotionProfile("thunder")) {
  const d1 = (rng() * 5).toFixed(1);
  const d2 = (Number(d1) + 5 + rng() * 7).toFixed(1);
  const bolt1 = skyLightningBolt(vw, vh, rng);
  const bolt2 = skyLightningBolt(vw, vh, rng);
  const cls = `sky-lightning${motion.animateAtmosphere ? " is-animated" : ""}`;
  return `
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="#c0d0ff" opacity="0" class="${cls}" style="animation-delay:${d1}s"/>
    <path d="${bolt1}" stroke="#ffe080" stroke-width="3" fill="none" opacity="0" class="${cls}" style="animation-delay:${d1}s;filter:blur(3px)"/>
    <path d="${bolt1}" stroke="white" stroke-width="1.5" fill="none" opacity="0" class="${cls}" style="animation-delay:${d1}s"/>
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="#c0d0ff" opacity="0" class="${cls}" style="animation-delay:${d2}s"/>
    <path d="${bolt2}" stroke="#ffe080" stroke-width="3" fill="none" opacity="0" class="${cls}" style="animation-delay:${d2}s;filter:blur(3px)"/>
    <path d="${bolt2}" stroke="white" stroke-width="1.5" fill="none" opacity="0" class="${cls}" style="animation-delay:${d2}s"/>
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
