const VERSION = "3.0.275";
const DAY_DETAIL_MODE_KEY = "nearcast-day-detail-mode";
const PLAN_MEMORY_KEY = "nearcast-plan-memory-v1";
const FOR_YOU_CONTEXT_KEY = "nearcast-for-you-context-v1";
const CONTINUITY_KEY = "nearcast-continuity-v1";
const TIME_FORMAT_KEY = "nearcast-time-format";
const MAP_RENDERER_KEY = "nearcast-map-renderer";
const MAP_RENDERER_CHOICE_KEY = "nearcast-map-renderer-choice";
const MAP_DIAGNOSTIC_MODE_KEY = "nearcast-map-diagnostic-mode";
const RAW_MAP_EXPERIMENT_KEY = "nearcast-raw-map-experiment";
const RADAR_PROVIDER_KEY = "nearcast-radar-provider";
const GENERATED_RADAR_EXPERIMENT_KEY = "nearcast-generated-radar-experiment";
const RADAR_MANIFEST_URL_KEY = "nearcast-radar-manifest-url";
const RADAR_INDEX_URL_KEY = "nearcast-radar-index-url";
const RADAR_SOURCE_ZOOM_KEY = "nearcast-radar-source-zoom";
const RADAR_CAPABILITY_ENDPOINT_KEY = "nearcast-radar-capability-endpoint";
const XWEATHER_STORM_MODE_KEY = "nearcast-xweather-storm-mode";
const XWEATHER_CLIENT_ID_KEY = "nearcast-xweather-client-id";
const XWEATHER_CLIENT_SECRET_KEY = "nearcast-xweather-client-secret";
const XWEATHER_LAYER_CODES_KEY = "nearcast-xweather-layer-codes";
const XWEATHER_USAGE_KEY = "nearcast-xweather-usage-v1";
const XWEATHER_CLIENT_INSTANCE_KEY = "nearcast-xweather-client-instance-v1";
const XWEATHER_CONFIG_ENDPOINT = "/api/xweather/config";
const XWEATHER_MAPSGL_SCRIPT_ID = "xweatherMapsglScript";
const XWEATHER_MAPSGL_CSS_ID = "xweatherMapsglCss";
const XWEATHER_MAPSGL_SCRIPT_URL = "https://unpkg.com/@xweather/mapsgl@1.8.4/dist/mapsgl.js";
const XWEATHER_MAPSGL_CSS_URL = "https://unpkg.com/@xweather/mapsgl@1.8.4/dist/mapsgl.css";
const XWEATHER_STORM_DEFAULT_LAYERS = "radar";
const XWEATHER_STORM_LIGHTNING_LAYERS = "lightning-strikes-icons";
const XWEATHER_MAPSGL_SESSION_ACCESS_COST = 150;
const XWEATHER_MONTHLY_ACCESS_LIMIT = 1500;
const XWEATHER_STORM_SESSION_MS = 5 * 60 * 1000;
const XWEATHER_CONFIG_TIMEOUT_MS = 10000;
const XWEATHER_CONFIG_RETRY_MS = 8000;
const XWEATHER_CONFIG_STALE_MS = XWEATHER_CONFIG_TIMEOUT_MS + 4000;
const DEVICE_LOCATION_KEY = "nearcast-device-location-v1";
const DEVICE_LOCATION_MAP_MAX_AGE_MS = 30 * 60 * 1000;
const DEVICE_LOCATION_REFRESH_MAX_AGE_MS = 5 * 60 * 1000;
const DEVICE_LOCATION_REFRESH_TIMEOUT_MS = 4000;
const DEVICE_LOCATION_WATCH_MAX_AGE_MS = 30 * 1000;
const DEVICE_LOCATION_WATCH_TIMEOUT_MS = 10000;
const DEFAULT_RADAR_CAPABILITY_ENDPOINT = "/api/radar/capability";
const MRMS_RADAR_MANIFEST_URL = "radar/mrms/manifest.json";
const MRMS_RADAR_FRAME_INDEX_URL = "https://radar.getnearcast.app/radar/mrms/frame-substrate/latest-frame-index.json";
const MRMS_RADAR_INDEX_URL = "radar/mrms/index.json";
const MRMS_RADAR_PREVIEW_INDEX_URL = "https://radar.getnearcast.app/radar/mrms/on-demand-preview/index.json";
const MAPLIBRE_CSS_ID = "maplibreCss";
const MAPLIBRE_SCRIPT_ID = "maplibreScript";
const MAPLIBRE_CSS_URL = `vendor/maplibre/maplibre-gl.css?v=${VERSION}`;
const MAPLIBRE_SCRIPT_URL = `vendor/maplibre/maplibre-gl.js?v=${VERSION}`;
const INSTALL_PROMPT_DISMISSED_UNTIL_KEY = "nearcast-install-dismissed-until";
const INSTALL_PROMPT_ACCEPTED_KEY = "nearcast-install-accepted";
const INSTALL_PROMPT_VISIT_COUNT_KEY = "nearcast-install-visit-count";
const INSTALL_PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const WELCOME_AMBIENCE_CACHE_KEY = "nearcast-welcome-ambience-v1";
const WELCOME_WORLD_SKY_CACHE_KEY = "nearcast-world-sky-cache-v1";
const REACTIVE_SKY_KEY = "nearcast-reactive-sky-v1";
const REACTIVE_SKY_MOTION_KEY = "nearcast-reactive-sky-motion-v1";
const REACTIVE_SKY_SAMPLE_INTERVAL_MS = 120;
const REACTIVE_SKY_HEADING_MAX_AGE_MS = 1800;
const REACTIVE_SKY_HEADING_ACCURACY_MAX = 45;
const WELCOME_AMBIENCE_TIMEOUT_MS = 3500;
const WELCOME_WORLD_SKY_ROTATE_MS = 28000;
const LOCATION_LOOKUP_TIMEOUT_MS = 12000;
const FORECAST_WARM_START_MAX_AGE_MS = 60 * 60 * 1000;
const REVERSE_GEOCODE_TIMEOUT_MS = 3200;
const FORECAST_FETCH_TIMEOUT_MS = 10000;
const AIR_QUALITY_FETCH_TIMEOUT_MS = 5500;
const ALERTS_FETCH_TIMEOUT_MS = 6500;
const FORECAST_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const FORECAST_CACHE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PULL_REFRESH_TOP_TOLERANCE_PX = 28;
const PULL_REFRESH_THRESHOLD_PX = 44;
const PULL_REFRESH_MAX_PX = 92;
const PULL_REFRESH_COOLDOWN_MS = 12 * 1000;
const PERF_STORAGE_KEY = "nearcast-perf";
const WIND_FIELD_STORAGE_KEY = "nearcast-wind-field";
const PERF_RENDER_WARN_MS = 50;
const PERF_INPUT_WARN_MS = 80;
const PERF_LONG_TASK_WARN_MS = 120;
const PERF_MAX_ENTRIES = 80;
const PLACE_APOSTROPHE_GLOBAL_PATTERN = /['\u2018\u2019`\u00b4\u02bb]/g;
const FOR_YOU_SIGNAL_IDS = [
  "best-dry",
  "best-walk",
  "best-dinner",
  "best-patio",
  "plan",
  "launch-summary",
  "memory-open",
  "memory-show",
  "memory-edit"
];

const WELCOME_WORLD_SKY_PLACES = [
  { id: "paris", name: "Paris", country: "France", countryCode: "FR", latitude: 48.8566, longitude: 2.3522 },
  { id: "tokyo", name: "Tokyo", country: "Japan", countryCode: "JP", latitude: 35.6762, longitude: 139.6503 },
  { id: "sydney", name: "Sydney", country: "Australia", countryCode: "AU", latitude: -33.8688, longitude: 151.2093 },
  { id: "rio", name: "Rio de Janeiro", country: "Brazil", countryCode: "BR", latitude: -22.9068, longitude: -43.1729 },
  { id: "cape-town", name: "Cape Town", country: "South Africa", countryCode: "ZA", latitude: -33.9249, longitude: 18.4241 },
  { id: "reykjavik", name: "Reykjavik", country: "Iceland", countryCode: "IS", latitude: 64.1466, longitude: -21.9426 },
  { id: "new-york", name: "New York", country: "United States", countryCode: "US", latitude: 40.7128, longitude: -74.0060 },
  { id: "cairo", name: "Cairo", country: "Egypt", countryCode: "EG", latitude: 30.0444, longitude: 31.2357 },
  { id: "london", name: "London", country: "United Kingdom", countryCode: "GB", latitude: 51.5072, longitude: -0.1276 },
  { id: "singapore", name: "Singapore", country: "Singapore", countryCode: "SG", latitude: 1.3521, longitude: 103.8198 },
  { id: "vancouver", name: "Vancouver", country: "Canada", countryCode: "CA", latitude: 49.2827, longitude: -123.1207 },
  { id: "marrakesh", name: "Marrakesh", country: "Morocco", countryCode: "MA", latitude: 31.6295, longitude: -7.9811 }
];

function queryValue(...names) {
  try {
    const params = new URLSearchParams(window.location.search);
    for (const name of names) {
      const value = params.get(name);
      if (value !== null) return value;
    }
  } catch {
    return null;
  }
  return null;
}

function queryRoutePlace() {
  const rawLatitude = queryValue("latitude", "lat");
  const rawLongitude = queryValue("longitude", "lon", "lng");
  if (rawLatitude === null || rawLongitude === null) return null;

  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const rawName = queryValue("placeName", "name", "place") || "";
  const suppliedName = rawName.trim().slice(0, 80);
  const savedMatch = (Array.isArray(state?.savedPlaces) ? state.savedPlaces : []).find((place) => (
    Math.abs(Number(place?.latitude) - latitude) < 0.02 &&
    Math.abs(Number(place?.longitude) - longitude) < 0.02
  ));
  const lastPlace = readStorageJson("weather-last-place");
  const lastMatch = lastPlace &&
    Math.abs(Number(lastPlace.latitude) - latitude) < 0.02 &&
    Math.abs(Number(lastPlace.longitude) - longitude) < 0.02
    ? lastPlace
    : null;
  const matchedPlace = savedMatch || lastMatch;
  const admin1 = queryValue("admin1") || matchedPlace?.admin1 || "";
  const country = queryValue("country") || matchedPlace?.country || "";
  const countryCode = queryValue("countryCode", "countrycode") || matchedPlace?.countryCode || "";
  const matchedName = canonicalPlaceName({
    name: matchedPlace?.name || "",
    admin1: matchedPlace?.admin1 || admin1,
    country: matchedPlace?.country || country
  });
  const suppliedCanonicalName = canonicalPlaceName({
    name: suppliedName,
    admin1,
    country
  });
  // Coordinates are the route identity. When they match a saved place, its
  // structured locality wins over the widget's presentation label.
  const name = matchedPlace && matchedName.toLowerCase() !== "selected place"
    ? matchedName
    : suppliedCanonicalName && suppliedCanonicalName.toLowerCase() !== "selected place"
    ? suppliedCanonicalName
    : "Selected place";
  return normalizePlace({
    id: queryValue("placeId", "placeid") || matchedPlace?.id || `route-${latitude.toFixed(3)}-${longitude.toFixed(3)}`,
    name,
    admin1,
    country,
    countryCode,
    latitude,
    longitude
  });
}

function debugSettingsEnabled() {
  return generatedRadarExperimentFlagEnabled(queryValue(
    "debugSettings",
    "debugsettings",
    "settingsDebug",
    "settingsdebug"
  ));
}

function isNativeIOSApp() {
  return isNativeNearcastApp();
}

const DEBUG_SETTINGS_ENABLED = debugSettingsEnabled();

const rawMapExperimentQueryFlag = DEBUG_SETTINGS_ENABLED ? queryValue(
  "rawMap",
  "rawmap",
  "rawWeather",
  "rawweather",
  "numericWeather",
  "numericweather"
) : null;
const rawMapExperimentStoredFlag = DEBUG_SETTINGS_ENABLED
  ? localStorage.getItem(RAW_MAP_EXPERIMENT_KEY)
  : null;
let RAW_MAP_EXPERIMENT_MODE = sanitizeRawMapExperimentMode(
  rawMapExperimentQueryFlag !== null
    ? rawMapExperimentQueryFlag
    : rawMapExperimentStoredFlag ?? "both"
);
if (!DEBUG_SETTINGS_ENABLED) {
  try { localStorage.removeItem(RAW_MAP_EXPERIMENT_KEY); } catch {}
} else if (rawMapExperimentQueryFlag !== null) {
  try {
    localStorage.setItem(RAW_MAP_EXPERIMENT_KEY, RAW_MAP_EXPERIMENT_MODE);
  } catch {}
}

function sanitizeRawMapExperimentMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["1", "true", "on", "yes", "both", "all", "raw"].includes(mode)) return "both";
  if (["observed", "past", "history", "mrms"].includes(mode)) return "observed";
  if (["forecast", "future", "guidance", "hrrr"].includes(mode)) return "forecast";
  return "off";
}

function rawMapExperimentMode() {
  if (!mapState.immersive || mapSatelliteEnabled()) return "off";
  return RAW_MAP_EXPERIMENT_MODE;
}

function rawMapExperimentEnabled(kind = "") {
  const effectiveMode = rawMapExperimentMode();
  if (!kind) return effectiveMode !== "off";
  const requested = sanitizeRawMapExperimentMode(kind);
  return requested !== "off" && (
    effectiveMode === "both" || effectiveMode === requested
  );
}

const perfQueryFlag = queryValue("perf");
if (perfQueryFlag === "1") localStorage.setItem(PERF_STORAGE_KEY, "1");
else if (perfQueryFlag === "0") localStorage.removeItem(PERF_STORAGE_KEY);

const windFieldQueryFlag = queryValue("windField", "windfield");
if (windFieldQueryFlag === "1") localStorage.setItem(WIND_FIELD_STORAGE_KEY, "1");
else if (windFieldQueryFlag === "0") localStorage.setItem(WIND_FIELD_STORAGE_KEY, "0");

const mapRendererQueryFlag = queryValue("mapRenderer", "maprenderer", "map");
if (DEBUG_SETTINGS_ENABLED && ["classic", "gl", "webgl"].includes(String(mapRendererQueryFlag || "").toLowerCase())) {
  localStorage.setItem(MAP_RENDERER_KEY, String(mapRendererQueryFlag).toLowerCase() === "classic" ? "classic" : "gl");
  localStorage.setItem(MAP_RENDERER_CHOICE_KEY, "explicit");
} else if (!DEBUG_SETTINGS_ENABLED) {
  try {
    localStorage.removeItem(MAP_RENDERER_KEY);
    localStorage.removeItem(MAP_RENDERER_CHOICE_KEY);
  } catch {}
}

const MAP_DIAGNOSTIC_MODES = {
  full: {
    label: "Full stack",
    meta: "Normal WebGL map"
  },
  blank: {
    label: "Blank GL",
    meta: "Empty WebGL canvas"
  },
  nosky: {
    label: "No sky",
    meta: "Blank map, sky hidden"
  },
  nomotion: {
    label: "No motion",
    meta: "Blank map, animations off"
  },
  noblur: {
    label: "No blur",
    meta: "Blank map, blur effects off"
  },
  quiet: {
    label: "Quiet shell",
    meta: "Blank map, no sky effects"
  },
  "base-no-labels": {
    label: "Base no labels",
    meta: "Basemap without labels"
  },
  base: {
    label: "Basemap only",
    meta: "No radar or markers"
  },
  markers: {
    label: "Markers only",
    meta: "Basemap plus places"
  },
  current: {
    label: "Current radar",
    meta: "One radar frame, no markers"
  },
  "current-markers": {
    label: "Radar + markers",
    meta: "One radar frame plus places"
  },
  buffer: {
    label: "Current + next",
    meta: "Two radar frames, no markers"
  }
};

const mapDiagnosticQueryFlag = queryValue("mapPerf", "mapperf", "mapDiag", "mapdiag");
if (DEBUG_SETTINGS_ENABLED && mapDiagnosticQueryFlag !== null) {
  localStorage.setItem(MAP_DIAGNOSTIC_MODE_KEY, sanitizeMapDiagnosticMode(mapDiagnosticQueryFlag));
} else if (!DEBUG_SETTINGS_ENABLED) {
  try { localStorage.removeItem(MAP_DIAGNOSTIC_MODE_KEY); } catch {}
}

const radarSourceZoomQueryFlag = queryValue("radarSourceZoom", "radarsourcezoom", "radarZoom", "radarzoom");
if (DEBUG_SETTINGS_ENABLED && radarSourceZoomQueryFlag !== null) {
  localStorage.setItem(RADAR_SOURCE_ZOOM_KEY, sanitizeRadarSourceZoom(radarSourceZoomQueryFlag));
} else {
  try { localStorage.removeItem(RADAR_SOURCE_ZOOM_KEY); } catch {}
}

const generatedRadarExperimentQueryFlag = queryValue(
  "generatedRadar",
  "generatedradar",
  "radarExperimental",
  "radarexperimental",
  "mrmsExperiment",
  "mrmsexperiment"
);
if (generatedRadarExperimentQueryFlag !== null) {
  if (!generatedRadarExperimentFlagEnabled(generatedRadarExperimentQueryFlag)) {
    localStorage.removeItem(GENERATED_RADAR_EXPERIMENT_KEY);
  }
}

try {
  localStorage.removeItem(GENERATED_RADAR_EXPERIMENT_KEY);
} catch {}

if (!DEBUG_SETTINGS_ENABLED) {
  localStorage.removeItem(RADAR_PROVIDER_KEY);
} else if (!generatedRadarExperimentEnabled() && radarProviderValueIsGenerated(localStorage.getItem(RADAR_PROVIDER_KEY))) {
  localStorage.removeItem(RADAR_PROVIDER_KEY);
}

const radarProviderQueryFlag = queryValue("radarProvider", "radarprovider", "radar");
if (DEBUG_SETTINGS_ENABLED && radarProviderQueryFlag !== null) {
  localStorage.setItem(RADAR_PROVIDER_KEY, sanitizeRadarProvider(radarProviderQueryFlag));
}

const xweatherStormQueryFlag = queryValue("xweatherStorm", "xweatherstorm", "stormView", "stormview");
if (DEBUG_SETTINGS_ENABLED && xweatherStormQueryFlag !== null) {
  localStorage.setItem(XWEATHER_STORM_MODE_KEY, sanitizeXweatherStormMode(xweatherStormQueryFlag));
}

const nativeLiveActivityTestQueryFlag = queryValue("liveActivityTest", "liveactivitytest", "activityTest", "activitytest");

const xweatherClientIdQueryFlag = queryValue("xweatherClientId", "xweatherclientid", "xweatherId", "xweatherid");
if (DEBUG_SETTINGS_ENABLED && xweatherClientIdQueryFlag !== null) {
  const value = String(xweatherClientIdQueryFlag || "").trim();
  if (!value || ["0", "off", "none", "clear"].includes(value.toLowerCase())) localStorage.removeItem(XWEATHER_CLIENT_ID_KEY);
  else localStorage.setItem(XWEATHER_CLIENT_ID_KEY, value);
}

const xweatherClientSecretQueryFlag = queryValue("xweatherClientSecret", "xweatherclientsecret", "xweatherSecret", "xweathersecret");
if (DEBUG_SETTINGS_ENABLED && xweatherClientSecretQueryFlag !== null) {
  const value = String(xweatherClientSecretQueryFlag || "").trim();
  if (!value || ["0", "off", "none", "clear"].includes(value.toLowerCase())) localStorage.removeItem(XWEATHER_CLIENT_SECRET_KEY);
  else localStorage.setItem(XWEATHER_CLIENT_SECRET_KEY, value);
}

const xweatherLayersQueryFlag = queryValue("xweatherLayers", "xweatherlayers");
if (DEBUG_SETTINGS_ENABLED && xweatherLayersQueryFlag !== null) {
  const value = sanitizeXweatherLayerCodes(xweatherLayersQueryFlag).join(",");
  if (value) localStorage.setItem(XWEATHER_LAYER_CODES_KEY, value);
  else localStorage.removeItem(XWEATHER_LAYER_CODES_KEY);
}

const radarManifestQueryFlag = queryValue("radarManifest", "radarmanifest", "mrmsManifest", "mrmsmanifest");
if (DEBUG_SETTINGS_ENABLED && radarManifestQueryFlag !== null) {
  const value = String(radarManifestQueryFlag || "").trim();
  if (!value || ["0", "off", "local", "none"].includes(value.toLowerCase())) {
    localStorage.removeItem(RADAR_MANIFEST_URL_KEY);
  } else {
    localStorage.setItem(RADAR_MANIFEST_URL_KEY, value);
  }
} else if (!DEBUG_SETTINGS_ENABLED) {
  localStorage.removeItem(RADAR_MANIFEST_URL_KEY);
}

const radarIndexQueryFlag = queryValue("radarIndex", "radarindex", "mrmsIndex", "mrmsindex");
if (DEBUG_SETTINGS_ENABLED && radarIndexQueryFlag !== null) {
  const value = String(radarIndexQueryFlag || "").trim();
  localStorage.removeItem(RADAR_MANIFEST_URL_KEY);
  if (!value || ["0", "off", "local", "none"].includes(value.toLowerCase())) {
    localStorage.removeItem(RADAR_INDEX_URL_KEY);
  } else {
    localStorage.setItem(RADAR_INDEX_URL_KEY, value);
  }
} else if (!DEBUG_SETTINGS_ENABLED) {
  localStorage.removeItem(RADAR_INDEX_URL_KEY);
}

const radarCapabilityEndpointQueryFlag = queryValue("radarCapabilityEndpoint", "radarcapabilityendpoint", "radarCapability", "radarcapability");
if (DEBUG_SETTINGS_ENABLED && radarCapabilityEndpointQueryFlag !== null) {
  const value = String(radarCapabilityEndpointQueryFlag || "").trim();
  const lower = value.toLowerCase();
  if (!value || ["default", "auto"].includes(lower)) {
    localStorage.removeItem(RADAR_CAPABILITY_ENDPOINT_KEY);
  } else if (["0", "off", "local", "none"].includes(lower)) {
    localStorage.setItem(RADAR_CAPABILITY_ENDPOINT_KEY, "off");
  } else {
    localStorage.setItem(RADAR_CAPABILITY_ENDPOINT_KEY, value);
  }
} else if (!DEBUG_SETTINGS_ENABLED) {
  localStorage.removeItem(RADAR_CAPABILITY_ENDPOINT_KEY);
}

const radarRoutingOverrideQueryPresent = radarManifestQueryFlag !== null ||
  radarIndexQueryFlag !== null ||
  radarCapabilityEndpointQueryFlag !== null;
if (!radarRoutingOverrideQueryPresent) clearProductionRadarRoutingOverrides();

function clearProductionRadarRoutingOverrides() {
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (!["getnearcast.app", "www.getnearcast.app"].includes(host)) return;
    localStorage.removeItem(RADAR_MANIFEST_URL_KEY);
    localStorage.removeItem(RADAR_INDEX_URL_KEY);
    localStorage.removeItem(RADAR_CAPABILITY_ENDPOINT_KEY);
  } catch {
    /* Storage can be unavailable in private or embedded contexts. */
  }
}

const windFieldStoredFlag = localStorage.getItem(WIND_FIELD_STORAGE_KEY);
let mapLibreAssetPromise = null;
let mapLibreCssPromise = null;
let mapLibreAssetStatus = window.maplibregl ? "ready" : "idle";

const featureFlags = {
  windField: windFieldStoredFlag !== "0"
};

const state = {
  unit: localStorage.getItem("weather-unit") || "fahrenheit",
  theme: localStorage.getItem("weather-theme") || "auto",
  timeFormat: sanitizeTimeFormatPreference(localStorage.getItem(TIME_FORMAT_KEY)),
  mapRenderer: storedMapRendererPreference(),
  mapDiagnosticMode: sanitizeMapDiagnosticMode(localStorage.getItem(MAP_DIAGNOSTIC_MODE_KEY)),
  rawMapExperimentMode: RAW_MAP_EXPERIMENT_MODE,
  radarProvider: sanitizeRadarProvider(localStorage.getItem(RADAR_PROVIDER_KEY)),
  radarSourceZoom: sanitizeRadarSourceZoom(localStorage.getItem(RADAR_SOURCE_ZOOM_KEY)),
  xweatherStormMode: sanitizeXweatherStormMode(localStorage.getItem(XWEATHER_STORM_MODE_KEY)),
  reactiveSkyEnabled: localStorage.getItem(REACTIVE_SKY_KEY) === "1",
  reactiveSkyMotionAllowed: localStorage.getItem(REACTIVE_SKY_MOTION_KEY) === "1",
  sunriseMs: null,
  sunsetMs: null,
  activePlace: null,
  welcomeOverride: false,
  savedPlaces: JSON.parse(localStorage.getItem("weather-places") || "[]").map(normalizePlace),
  searchResults: [],
  skyCode: null,
  skyIsDay: null,
  skyData: null,
  skyDisplayCondition: null,
  skyState: null,
  weatherTruth: null,
  radarPrecipSignal: null,
  radarPrecipPlaceId: null,
  radarPrecipSeq: 0,
  locationIsDay: null,
  forecastUnit: null,
  continuityBaseline: { key: "", store: null },
  planMemories: loadPlanMemories(),
  userContext: loadUserContext()
};

window.nearcastReactiveSkyEnabled = () => state.reactiveSkyEnabled === true;

let xweatherStormConfigRecord = { status: "unknown", checkedAt: 0, credentials: null, layerCodes: [] };
let xweatherStormConfigPromise = null;
let xweatherStormConfigPromiseKey = "";
let xweatherStormActivatedUntil = 0;
let xweatherStormActivationTimer = 0;

if (state.mapDiagnosticMode !== "full" && state.mapRenderer !== "gl") {
  state.mapRenderer = "gl";
  localStorage.setItem(MAP_RENDERER_KEY, "gl");
}

function defaultUserContext() {
  return { actions: {}, updatedAt: 0 };
}

function normalizeForYouSignal(value) {
  const signal = String(value || "").trim();
  return FOR_YOU_SIGNAL_IDS.includes(signal) ? signal : "";
}

function loadUserContext() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOR_YOU_CONTEXT_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return defaultUserContext();
    const actions = {};
    Object.entries(parsed.actions || {}).forEach(([key, value]) => {
      const signal = normalizeForYouSignal(key);
      if (!signal || !value || typeof value !== "object") return;
      const count = Math.max(0, Math.min(99, Math.round(Number(value.count) || 0)));
      const lastAt = Math.max(0, Number(value.lastAt) || 0);
      if (count > 0 || lastAt > 0) actions[signal] = { count, lastAt };
    });
    return {
      actions,
      updatedAt: Math.max(0, Number(parsed.updatedAt) || 0)
    };
  } catch {
    return defaultUserContext();
  }
}

function saveUserContext() {
  try {
    localStorage.setItem(FOR_YOU_CONTEXT_KEY, JSON.stringify(state.userContext || defaultUserContext()));
  } catch {
    // Personalization is optional; forecast and planning stay fully usable.
  }
}

function recordForYouSignal(value) {
  const signal = normalizeForYouSignal(value);
  if (!signal) return;
  if (!state.userContext || typeof state.userContext !== "object") state.userContext = defaultUserContext();
  if (!state.userContext.actions || typeof state.userContext.actions !== "object") state.userContext.actions = {};
  const current = state.userContext.actions[signal] || { count: 0, lastAt: 0 };
  state.userContext.actions[signal] = {
    count: Math.min(99, (Number(current.count) || 0) + 1),
    lastAt: Date.now()
  };
  state.userContext.updatedAt = Date.now();
  saveUserContext();
}

const mapState = {
  initialized: false,
  zoom: 7,
  panX: 0,
  panY: 0,
  frames: [],
  frameIndex: 0,
  playing: false,
  timer: null,
  mode: "radar",
  immersive: false,
  userPausedRadar: false,
  playAccum: 0,
  playClock: 0,
  frameWaitIndex: null,
  frameWaitStart: 0,
  frameLoadSeq: 0,
  xfadeFrames: [null, null],
  _normalEls: null,
  timelineKind: "radar",
  nowIndex: 0,
  forecastUnavailable: false,
  generatedRadarManifestUrl: "",
  generatedRadarSelectionKey: "",
  generatedRadarViewportKey: "",
  generatedRadarSelectionHint: null,
  generatedRadarIndexSelection: null,
  generatedRadarRefreshTimer: 0,
  generatedRadarRefreshSeq: 0,
  generatedRadarWarmup: {
    state: "idle",
    viewportKey: "",
    requestId: "",
    dedupeKey: "",
    reason: "",
    attempts: 0,
    startedAt: 0,
    updatedAt: 0,
    timeoutAt: 0
  },
  generatedRadarStatusHideTimer: 0,
  xweatherStormCloseout: {
    text: "",
    visibleUntil: 0
  },
  xweatherStormCloseoutHideTimer: 0,
  radarCapability: null,
  radarCapabilityLog: [],
  radarSourceDecision: null,
  radarSourceDecisionLog: [],
  stormImpact: {
    status: "idle",
    analysis: null,
    seq: 0
  },
  nativeStormActivityKey: "",
  nativeStormActivitySyncedAt: 0,
  nativeStormActivityDebug: {
    active: false,
    pending: false,
    state: "idle",
    reason: ""
  },
  rawMap: {
    seq: 0,
    status: "idle",
    mode: "off",
    timelineKind: "",
    placeKey: "",
    bounds: null,
    boundsKey: "",
    session: null,
    abortController: null,
    viewportRefreshTimer: 0,
    fallbackFrames: null,
    fallbackNowIndex: 0,
    error: "",
    requestedAt: 0,
    preparedAt: 0,
    matchedFrames: 0,
    stage: ""
  }
};

const perfState = {
  enabled: localStorage.getItem(PERF_STORAGE_KEY) === "1",
  initialized: false,
  entries: [],
  inputFocusCount: 0,
  playbackPausedForInput: false,
  longTaskObserver: null,
  lastBriefingRenderAt: 0,
  briefingRenderQueued: false
};

let floatingChromeScrollY = 0;
let floatingChromeRaf = 0;
let floatingChromeUpTravel = 0;

const MAP_MIN_ZOOM = 4;
const MAP_MAX_ZOOM = 18; // street-level basemap zoom; weather sources stay capped separately.
const RADAR_TILE_MAX_ZOOM = 8; // cap radar source tiles so they upscale smoothly past z8
const RADAR_WMS_TILE_SIZE = 512;
const WEATHER_SOURCE_SOFTEN_START_DELTA = 0.5;
const WEATHER_SOURCE_SOFTEN_FULL_DELTA = 6;
const RADAR_PRECIP_SAMPLE_ZOOM = 8;
const RADAR_PRECIP_CENTER_RADIUS_PX = 4;
const RADAR_PRECIP_NEARBY_RADIUS_PX = 13;
const RADAR_PRECIP_MAX_FRAME_AGE_MS = 14 * 60 * 1000;
const RADAR_PRECIP_CACHE_MS = 3 * 60 * 1000;
const RADAR_PRECIP_CACHE_VERSION = "v3";
const STORM_IMPACT_SAMPLE_ZOOM = 7;
const STORM_IMPACT_SAMPLE_RADIUS_PX = 46;
const STORM_IMPACT_CELL_SCAN_RADIUS_PX = 180;
const STORM_IMPACT_CELL_SEED_RADIUS_PX = 40;
const STORM_IMPACT_CELL_GRID_STEP_PX = 3;
const STORM_IMPACT_CELL_CORE_SCORE = 0.18;
const STORM_IMPACT_CELL_HALO_SCORE = 0.08;
const STORM_IMPACT_CELL_GAP_CELLS = 4;
const STORM_IMPACT_CELL_MERGE_RADIUS_PX = 34;
const STORM_IMPACT_CELL_MAX_AREA_FRACTION = 0.54;
const STORM_IMPACT_CELL_MAX_OUTLINE_POINTS = 54;
const STORM_IMPACT_MIN_SAMPLE_HITS = 14;
const STORM_IMPACT_MIN_SAMPLE_DENSITY = 0.004;
const STORM_IMPACT_MAX_FRAME_AGE_MS = 50 * 60 * 1000;
const STORM_IMPACT_FRAME_LIMIT = 8;
const STORM_IMPACT_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
const STORM_IMPACT_PATH_RADIUS_PX = 34;
const STORM_IMPACT_NEAR_PATH_RADIUS_PX = 52;
const STORM_IMPACT_MIN_SPEED_PX_PER_MIN = 0.05;
const STORM_FORECAST_SAMPLE_ZOOM = 7;
const STORM_FORECAST_SAMPLE_RADIUS_PX = 36;
const STORM_FORECAST_LOOKAHEAD_MS = 4 * 60 * 60 * 1000;
const STORM_FORECAST_FRAME_LIMIT = 6;
const STORM_FORECAST_MIN_SAMPLE_HITS = 7;
const STORM_FORECAST_MIN_SAMPLE_DENSITY = 0.0025;
const MAP_TAP_MOVE_PX = 8;
const MAP_PREVIEW_TAP_MAX_MS = 650;
const MAP_WHEEL_ZOOM_SENSITIVITY = 360;
const CARTO_TILE_HOSTS = ["a", "b", "c", "d"];
const US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia"
};
const COUNTRY_CODES = [
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR",
  "IO", "BN", "BG", "BF", "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
  "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO",
  "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF",
  "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY",
  "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM",
  "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY",
  "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
  "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI",
  "NE", "NG", "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH",
  "PN", "PL", "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC",
  "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS",
  "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK",
  "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "UM", "US", "UY", "UZ", "VU",
  "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW", "XK"
];
const COUNTRY_ALIAS_OVERRIDES = {
  america: "US",
  "united states of america": "US",
  usa: "US",
  "u s": "US",
  "u s a": "US",
  uk: "GB",
  "u k": "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  uae: "AE",
  "u a e": "AE",
  "south korea": "KR",
  "north korea": "KP",
  "czech republic": "CZ",
  russia: "RU",
  "ivory coast": "CI",
  "cote d ivoire": "CI",
  bolivia: "BO",
  brunei: "BN",
  iran: "IR",
  laos: "LA",
  macedonia: "MK",
  moldova: "MD",
  palestine: "PS",
  syria: "SY",
  tanzania: "TZ",
  turkey: "TR",
  venezuela: "VE",
  vietnam: "VN",
  aland: "AX",
  "aland islands": "AX",
  curacao: "CW",
  reunion: "RE",
  kosovo: "XK"
};
const COUNTRY_DISPLAY_NAMES = buildCountryDisplayNames();
const COUNTRY_ALIASES = buildCountryAliases();
const COUNTRY_ALIAS_KEYS = [...COUNTRY_ALIASES.keys()].sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);
const COUNTRY_ALIAS_MAX_WORDS = COUNTRY_ALIAS_KEYS.reduce((max, key) => Math.max(max, key.split(" ").length), 1);
const US_STATE_ALIASES = buildUsStateAliases();
const US_STATE_ALIAS_KEYS = [...US_STATE_ALIASES.keys()].sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);
const US_STATE_ALIAS_MAX_WORDS = US_STATE_ALIAS_KEYS.reduce((max, key) => Math.max(max, key.split(" ").length), 1);
const NWS_RADAR_FRAME_LIMIT = 30;
const NWS_RADAR_WINDOW_MS = 60 * 60 * 1000;
const NWS_RADAR_REGIONS = {
  conus: {
    layer: "conus_bref_qcd",
    style: "radar_reflectivity",
    endpoint: "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows",
    label: "NWS radar"
  },
  alaska: {
    layer: "alaska_bref_qcd",
    style: "radar_reflectivity",
    endpoint: "https://opengeo.ncep.noaa.gov/geoserver/alaska/alaska_bref_qcd/ows",
    label: "NWS Alaska radar"
  },
  hawaii: {
    layer: "hawaii_bref_qcd",
    style: "radar_reflectivity",
    endpoint: "https://opengeo.ncep.noaa.gov/geoserver/hawaii/hawaii_bref_qcd/ows",
    label: "NWS Hawaii radar"
  },
  carib: {
    layer: "carib_bref_qcd",
    style: "radar_reflectivity",
    endpoint: "https://opengeo.ncep.noaa.gov/geoserver/carib/carib_bref_qcd/ows",
    label: "NWS Caribbean radar"
  },
  guam: {
    layer: "guam_bref_qcd",
    style: "radar_reflectivity",
    endpoint: "https://opengeo.ncep.noaa.gov/geoserver/guam/guam_bref_qcd/ows",
    label: "NWS Guam radar"
  }
};

const dragState = {
  active: false,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0,
  moved: false,
  anchorActive: false,
  anchorPanX: 0,
  anchorPanY: 0,
  anchorDx: 0,
  anchorDy: 0,
  resumePlayback: false
};

const pinchState = {
  active: false,
  startDistance: 0,
  startZoom: 0,
  anchorX: 0,
  anchorY: 0,
  lastMidX: 0,
  lastMidY: 0
};

const mapTapState = {
  active: false,
  valid: false,
  moved: false,
  startX: 0,
  startY: 0,
  pointerId: null,
  startedAt: 0,
  targetEl: null
};

const daylightScrub = {
  chart: null,
  data: null,
  uv: null,
  points: [],
  defaultIndex: 0,
  activeIndex: 0,
  pointerDown: false,
  restoreTimer: null
};

let searchSuggestTimer = null;
let searchRequestSeq = 0;
let welcomeAmbienceStarted = false;
let welcomeAmbienceAbort = null;
let welcomeWorldSkyTimer = null;
let welcomeWorldSkyAbort = null;
let welcomeWorldSkyIndex = Math.floor(Date.now() / WELCOME_WORLD_SKY_ROTATE_MS) % WELCOME_WORLD_SKY_PLACES.length;
let welcomeAmbientSource = "idle";
let locationLookupSeq = 0;
let locationLookupTimer = null;
const pullRefreshState = {
  tracking: false,
  active: false,
  ready: false,
  refreshing: false,
  startX: 0,
  startY: 0,
  distance: 0,
  hideTimer: null,
  lastRefreshAt: 0
};

const installPromptState = {
  deferredPrompt: null,
  nativePromptAvailable: false,
  visitCount: 0
};

const reactiveSkyMotionState = {
  status: "idle",
  source: "none",
  started: false,
  requestInFlight: false,
  webPermissionGranted: false,
  webListenerAttached: false,
  lastSampleAt: 0,
  lastAcceptedAt: 0,
  lastSample: null,
  sampleExpiryTimer: 0,
  syncTimer: 0,
  observer: null,
  mediaQuery: null
};

const els = {
  themeColorMeta: document.querySelector("meta[name='theme-color']"),
  statusBarMeta: document.querySelector("meta[name='apple-mobile-web-app-status-bar-style']"),
  shell: document.querySelector(".shell"),
  appMenuToggle: document.querySelector("#appMenuToggle"),
  appMenu: document.querySelector("#appMenu"),
  manualRefresh: document.querySelector("#manualRefresh"),
  searchToggle: document.querySelector("#searchToggle"),
  welcome: document.querySelector("#welcome"),
  welcomeAmbientLabel: document.querySelector("#welcomeAmbientLabel"),
  welcomeLocate: document.querySelector("#welcomeLocate"),
  pullRefresh: document.querySelector("#pullRefresh"),
  pullRefreshLabel: document.querySelector("[data-pull-refresh-label]"),
  installCard: document.querySelector("#installCard"),
  installCardCopy: document.querySelector("#installCardCopy"),
  installAction: document.querySelector("#installAction"),
  installDismiss: document.querySelector("#installDismiss"),
  installBackdrop: document.querySelector("#installBackdrop"),
  installSheet: document.querySelector("#installSheet"),
  installSheetClose: document.querySelector("#installSheetClose"),
  installSheetContext: document.querySelector("#installSheetContext"),
  installSheetSummary: document.querySelector("#installSheetSummary"),
  installSteps: document.querySelector("#installSteps"),
  installSheetPrimary: document.querySelector("#installSheetPrimary"),
  installSheetSnooze: document.querySelector("#installSheetSnooze"),
  themeToggle: document.querySelector("#themeToggle"),
  unitToggle: document.querySelector("#unitToggle"),
  reactiveSkyToggle: document.querySelector("#reactiveSkyToggle"),
  reactiveSkyMeta: document.querySelector("#reactiveSkyMeta"),
  reactiveSkyMotionSetting: document.querySelector("#reactiveSkyMotionSetting"),
  reactiveSkyMotionButton: document.querySelector("#reactiveSkyMotionButton"),
  reactiveSkyMotionMeta: document.querySelector("#reactiveSkyMotionMeta"),
  reactiveSkyLabSetting: document.querySelector("#reactiveSkyLabSetting"),
  reactiveSkyLabMeta: document.querySelector("#reactiveSkyLabMeta"),
  reactiveSkyLabReset: document.querySelector("#reactiveSkyLabReset"),
  timeFormatButtons: document.querySelectorAll("[data-time-format]"),
  timeFormatMeta: document.querySelector("#timeFormatMeta"),
  debugSettings: document.querySelectorAll("[data-debug-setting]"),
  mapRendererButtons: document.querySelectorAll("[data-map-renderer]"),
  mapRendererMeta: document.querySelector("#mapRendererMeta"),
  mapDiagnosticMode: document.querySelector("#mapDiagnosticMode"),
  mapDiagnosticMeta: document.querySelector("#mapDiagnosticMeta"),
  radarProvider: document.querySelector("#radarProvider"),
  radarProviderMeta: document.querySelector("#radarProviderMeta"),
  radarSourceZoom: document.querySelector("#radarSourceZoom"),
  radarSourceMeta: document.querySelector("#radarSourceMeta"),
  rawMapMode: document.querySelector("#rawMapMode"),
  rawMapMeta: document.querySelector("#rawMapMeta"),
  xweatherStormMode: document.querySelector("#xweatherStormMode"),
  xweatherStormMeta: document.querySelector("#xweatherStormMeta"),
  nativeLiveActivitySetting: document.querySelector("#nativeLiveActivitySetting"),
  nativeLiveActivityOpen: document.querySelector("#nativeLiveActivityOpen"),
  nativeLiveActivityMeta: document.querySelector("#nativeLiveActivityMeta"),
  liveActivityBackdrop: document.querySelector("#liveActivityBackdrop"),
  liveActivitySheet: document.querySelector("#liveActivitySheet"),
  liveActivityClose: document.querySelector("#liveActivityClose"),
  liveActivityStatus: document.querySelector("#liveActivityStatus"),
  liveActivityResult: document.querySelector("#liveActivityResult"),
  liveActivityStart: document.querySelector("#liveActivityStart"),
  liveActivityUpdate: document.querySelector("#liveActivityUpdate"),
  liveActivityStatusButton: document.querySelector("#liveActivityStatusButton"),
  liveActivityEnd: document.querySelector("#liveActivityEnd"),
  forecastView: document.querySelector("#forecastView"),
  mapView: document.querySelector("#mapView"),
  searchForm: document.querySelector("#searchForm"),
  searchClose: document.querySelector("#searchClose"),
  placeSearch: document.querySelector("#placeSearch"),
  searchResults: document.querySelector("#searchResults"),
  savedPlaces: document.querySelector("#savedPlaces"),
  status: document.querySelector("#status"),
  loadingStatuses: document.querySelectorAll("[data-loading-status]"),
  locationName: document.querySelector("#locationName"),
  launchPlaceButton: document.querySelector("#launchPlaceButton"),
  nowTemp: document.querySelector("#nowTemp"),
  heroRange: document.querySelector("#heroRange"),
  nowSummary: document.querySelector("#nowSummary"),
  forYouToday: document.querySelector("#forYouToday"),
  launchShortcuts: document.querySelector("#launchShortcuts"),
  glanceTitle: document.querySelector("#glanceTitle"),
  glanceSignals: document.querySelector(".glance-signals"),
  feelsLike: document.querySelector("#feelsLike"),
  feelsContext: document.querySelector("#feelsContext"),
  rainSignal: document.querySelector("#rainSignal"),
  rainChance: document.querySelector("#rainChance"),
  rainContext: document.querySelector("#rainContext"),
  windSignal: document.querySelector("#windSignal"),
  wind: document.querySelector("#wind"),
  windContext: document.querySelector("#windContext"),
  uv: document.querySelector("#uv"),
  humidity: document.querySelector("#humidity"),
  humiditySignal: document.querySelector("#humiditySignal"),
  humidityContext: document.querySelector("#humidityContext"),
  airSignalLabel: document.querySelector("#airSignalLabel"),
  sunrise: document.querySelector("#sunrise"),
  sunset: document.querySelector("#sunset"),
  daylightCard: document.querySelector("#daylightCard"),
  daylightArc: document.querySelector("#daylightArc"),
  daylightSummary: document.querySelector("#daylightSummary"),
  daylightContext: document.querySelector("#daylightContext"),
  daylightHorizon: document.querySelector("#daylightHorizon"),
  daylightNightPath: document.querySelector("#daylightNightPath"),
  daylightFill: document.querySelector("#daylightFill"),
  daylightUvBand: document.querySelector("#daylightUvBand"),
  daylightNowMarker: document.querySelector("#daylightNowMarker"),
  daylightNowLine: document.querySelector("#daylightNowLine"),
  daylightNowBadge: document.querySelector("#daylightNowBadge"),
  daylightScrubGuide: document.querySelector("#daylightScrubGuide"),
  daylightNow: document.querySelector("#daylightNow"),
  daylightNowGlow: document.querySelector("#daylightNowGlow"),
  daylightUv: document.querySelector("#daylightUv"),
  daylightReadout: document.querySelector("#daylightReadout"),
  daylightReadoutTime: document.querySelector("#daylightReadoutTime"),
  daylightReadoutTitle: document.querySelector("#daylightReadoutTitle"),
  daylightReadoutMeta: document.querySelector("#daylightReadoutMeta"),
  uvLabel: document.querySelector("#uvLabel"),
  insights: document.querySelector("#insights"),
  insightCards: document.querySelector("#insightCards"),
  planPulse: document.querySelector("#planPulse"),
  briefing: document.querySelector("#briefing"),
  aiAsk: document.querySelector("#aiAsk"),
  aiLauncher: document.querySelector("#aiLauncher"),
  aiLauncherSub: document.querySelector("#aiLauncherSub"),
  aiSheet: document.querySelector("#aiSheet"),
  aiBackdrop: document.querySelector("#aiBackdrop"),
  memorySheet: document.querySelector("#memorySheet"),
  memoryBackdrop: document.querySelector("#memoryBackdrop"),
  memorySheetSummary: document.querySelector("#memorySheetSummary"),
  memorySheetBody: document.querySelector("#memorySheetBody"),
  memoryEditSheet: document.querySelector("#memoryEditSheet"),
  memoryEditBackdrop: document.querySelector("#memoryEditBackdrop"),
  memoryEditBody: document.querySelector("#memoryEditBody"),
  memoryDetailSheet: document.querySelector("#memoryDetailSheet"),
  memoryDetailBackdrop: document.querySelector("#memoryDetailBackdrop"),
  memoryDetailBody: document.querySelector("#memoryDetailBody"),
  placeSwitcher: document.querySelector("#placeSwitcher"),
  placeSwitcherName: document.querySelector("#placeSwitcherName"),
  placeSwitcherMeta: document.querySelector("#placeSwitcherMeta"),
  placeSheet: document.querySelector("#placeSheet"),
  placeBackdrop: document.querySelector("#placeBackdrop"),
  hourly: document.querySelector("#hourly"),
  daily: document.querySelector("#daily"),
  updatedAt: document.querySelector("#updatedAt"),
  metricTip: document.querySelector("#metricTip"),
  glanceDetailBackdrop: document.querySelector("#glanceDetailBackdrop"),
  glanceDetailSheet: document.querySelector("#glanceDetailSheet"),
  glanceDetailClose: document.querySelector("#glanceDetailClose"),
  glanceDetailIcon: document.querySelector("#glanceDetailIcon"),
  glanceDetailTitle: document.querySelector("#glanceDetailTitle"),
  glanceDetailContext: document.querySelector("#glanceDetailContext"),
  glanceDetailSummary: document.querySelector("#glanceDetailSummary"),
  glanceDetailBody: document.querySelector("#glanceDetailBody"),
  placeSaveButton: document.querySelector("#placeSaveButton"),
  placeWelcomeButton: document.querySelector("#placeWelcomeButton"),
  weatherMap: document.querySelector("#weatherMap"),
  baseTileLayer: document.querySelector("#baseTileLayer"),
  weatherTileLayer: document.querySelector("#weatherTileLayer"),
  labelTileLayer: document.querySelector("#labelTileLayer"),
  markerLayer: document.querySelector("#markerLayer"),
  mapPlace: document.querySelector("#mapPlace"),
  mapLoading: document.querySelector("#mapLoading"),
  mapLegend: document.querySelector("#mapLegend"),
  zoomOutMap: document.querySelector("#zoomOutMap"),
  zoomInMap: document.querySelector("#zoomInMap"),
  radarMode: document.querySelector("#radarMode"),
  futureMode: document.querySelector("#futureMode"),
  playRadar: document.querySelector("#playRadar"),
  frameSlider: document.querySelector("#frameSlider"),
  frameLabel: document.querySelector("#frameLabel"),
  stormImpactCard: document.querySelector("#stormImpactCard"),
  stormImpactKicker: document.querySelector("#stormImpactKicker"),
  stormImpactTitle: document.querySelector("#stormImpactTitle"),
  stormImpactSummary: document.querySelector("#stormImpactSummary"),
  stormImpactList: document.querySelector("#stormImpactList"),
  stormImpactClose: document.querySelector("#stormImpactClose")
};

const RAIN_LIKELY_CODE = 10001;

const weatherCodes = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms, hail",
  99: "Thunderstorms, hail",
  [RAIN_LIKELY_CODE]: "Rain likely"
};

const weatherIcons = {
  0: "clear-day",
  1: "clear-day",
  2: "partly-cloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain-heavy",
  66: "rain",
  67: "rain-heavy",
  71: "snow",
  73: "snow",
  75: "snow-heavy",
  77: "snow",
  80: "rain",
  81: "rain",
  82: "rain-heavy",
  85: "snow",
  86: "snow-heavy",
  95: "thunder",
  96: "thunder",
  99: "thunder",
  [RAIN_LIKELY_CODE]: "rain"
};

const iconSvgs = {
  "clear-day": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="8" fill="#f5a623"/>
    <g stroke="#f5a623" stroke-width="2.2" stroke-linecap="round">
      <line x1="20" y1="4" x2="20" y2="8"/>
      <line x1="20" y1="32" x2="20" y2="36"/>
      <line x1="4" y1="20" x2="8" y2="20"/>
      <line x1="32" y1="20" x2="36" y2="20"/>
      <line x1="8.7" y1="8.7" x2="11.5" y2="11.5"/>
      <line x1="28.5" y1="28.5" x2="31.3" y2="31.3"/>
      <line x1="31.3" y1="8.7" x2="28.5" y2="11.5"/>
      <line x1="11.5" y1="28.5" x2="8.7" y2="31.3"/>
    </g>
  </svg>`,
  "clear-night": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M28 22a10 10 0 1 1-12-9.7A8 8 0 0 0 28 22z" fill="#a0b4c8"/>
  </svg>`,
  "partly-cloudy": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="15" cy="16" r="6" fill="#f5a623"/>
    <g stroke="#f5a623" stroke-width="1.8" stroke-linecap="round">
      <line x1="15" y1="5" x2="15" y2="8"/>
      <line x1="15" y1="24" x2="15" y2="27"/>
      <line x1="4" y1="16" x2="7" y2="16"/>
      <line x1="23" y1="16" x2="26" y2="16"/>
      <line x1="7.9" y1="8.9" x2="10" y2="11"/>
      <line x1="20" y1="21" x2="22.1" y2="23.1"/>
      <line x1="22.1" y1="8.9" x2="20" y2="11"/>
    </g>
    <rect x="8" y="22" width="24" height="12" rx="6" fill="#c8d8e4"/>
    <ellipse cx="16" cy="22" rx="7" ry="6" fill="#c8d8e4"/>
    <ellipse cx="24" cy="23" rx="6" ry="5" fill="#c8d8e4"/>
  </svg>`,
  "cloudy": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="20" width="28" height="14" rx="7" fill="#a8bcc8"/>
    <ellipse cx="16" cy="20" rx="9" ry="8" fill="#a8bcc8"/>
    <ellipse cx="26" cy="21" rx="8" ry="7" fill="#b8cad4"/>
  </svg>`,
  "fog": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#a8bcc8" stroke-width="2.5" stroke-linecap="round">
      <line x1="6" y1="14" x2="34" y2="14"/>
      <line x1="6" y1="20" x2="34" y2="20"/>
      <line x1="10" y1="26" x2="30" y2="26"/>
    </g>
  </svg>`,
  "drizzle": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="8" width="28" height="14" rx="7" fill="#a8bcc8"/>
    <ellipse cx="16" cy="8" rx="9" ry="7" fill="#a8bcc8"/>
    <ellipse cx="26" cy="9" rx="8" ry="6" fill="#b8cad4"/>
    <g stroke="#6aa0c8" stroke-width="2" stroke-linecap="round">
      <line x1="14" y1="27" x2="12" y2="33"/>
      <line x1="20" y1="25" x2="18" y2="31"/>
      <line x1="26" y1="27" x2="24" y2="33"/>
    </g>
  </svg>`,
  "rain": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="28" height="14" rx="7" fill="#8aaabb"/>
    <ellipse cx="16" cy="6" rx="9" ry="7" fill="#8aaabb"/>
    <ellipse cx="26" cy="7" rx="8" ry="6" fill="#9ab4c4"/>
    <g stroke="#3a7cbf" stroke-width="2.2" stroke-linecap="round">
      <line x1="13" y1="26" x2="10" y2="34"/>
      <line x1="20" y1="24" x2="17" y2="32"/>
      <line x1="27" y1="26" x2="24" y2="34"/>
    </g>
  </svg>`,
  "rain-heavy": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="5" width="32" height="14" rx="7" fill="#7090a0"/>
    <ellipse cx="14" cy="5" rx="10" ry="7" fill="#7090a0"/>
    <ellipse cx="27" cy="6" rx="9" ry="6" fill="#809aaa"/>
    <g stroke="#2060b0" stroke-width="2.4" stroke-linecap="round">
      <line x1="11" y1="24" x2="8" y2="33"/>
      <line x1="17" y1="22" x2="14" y2="31"/>
      <line x1="23" y1="24" x2="20" y2="33"/>
      <line x1="29" y1="22" x2="26" y2="31"/>
    </g>
  </svg>`,
  "snow": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="28" height="14" rx="7" fill="#a8bcc8"/>
    <ellipse cx="16" cy="6" rx="9" ry="7" fill="#a8bcc8"/>
    <ellipse cx="26" cy="7" rx="8" ry="6" fill="#b8cad4"/>
    <g fill="#80a8cc">
      <circle cx="13" cy="29" r="2.2"/>
      <circle cx="20" cy="26" r="2.2"/>
      <circle cx="27" cy="29" r="2.2"/>
    </g>
  </svg>`,
  "snow-heavy": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="5" width="32" height="14" rx="7" fill="#7090a0"/>
    <ellipse cx="14" cy="5" rx="10" ry="7" fill="#7090a0"/>
    <ellipse cx="27" cy="6" rx="9" ry="6" fill="#809aaa"/>
    <g fill="#80a8cc">
      <circle cx="10" cy="27" r="2.2"/>
      <circle cx="17" cy="24" r="2.2"/>
      <circle cx="24" cy="27" r="2.2"/>
      <circle cx="30" cy="25" r="2.2"/>
    </g>
  </svg>`,
  "thunder": `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="4" width="32" height="14" rx="7" fill="#606878"/>
    <ellipse cx="14" cy="4" rx="10" ry="7" fill="#606878"/>
    <ellipse cx="27" cy="5" rx="9" ry="6" fill="#708090"/>
    <polyline points="22,18 17,28 21,28 16,38" stroke="#f0d020" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`
};

const denseIconSvgs = {
  "clear-day": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="7" fill="var(--wx-sun)"/>
    <g stroke="var(--wx-sun)" stroke-width="2.4" stroke-linecap="round">
      <line x1="20" y1="4.5" x2="20" y2="8"/>
      <line x1="20" y1="32" x2="20" y2="35.5"/>
      <line x1="4.5" y1="20" x2="8" y2="20"/>
      <line x1="32" y1="20" x2="35.5" y2="20"/>
      <line x1="9.2" y1="9.2" x2="11.7" y2="11.7"/>
      <line x1="28.3" y1="28.3" x2="30.8" y2="30.8"/>
      <line x1="30.8" y1="9.2" x2="28.3" y2="11.7"/>
      <line x1="11.7" y1="28.3" x2="9.2" y2="30.8"/>
    </g>
  </svg>`,
  "clear-night": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M29.8 22.2A10.7 10.7 0 1 1 17.5 9.4 8.4 8.4 0 0 0 29.8 22.2Z" fill="var(--wx-moon)"/>
  </svg>`,
  "partly-cloudy": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="15" cy="15" r="6" fill="var(--wx-sun)"/>
    <g stroke="var(--wx-sun)" stroke-width="2" stroke-linecap="round">
      <line x1="15" y1="4" x2="15" y2="7"/>
      <line x1="4" y1="15" x2="7" y2="15"/>
      <line x1="23" y1="15" x2="26" y2="15"/>
      <line x1="7.4" y1="7.4" x2="9.7" y2="9.7"/>
      <line x1="22.6" y1="7.4" x2="20.3" y2="9.7"/>
    </g>
    <path d="M11.5 32h17.8a6.4 6.4 0 0 0 .5-12.8 8.4 8.4 0 0 0-15.8 2.2h-2.5A5.3 5.3 0 0 0 11.5 32Z" fill="var(--wx-cloud)"/>
    <circle cx="27" cy="22" r="6" fill="var(--wx-cloud-soft)"/>
  </svg>`,
  "partly-cloudy-night": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.5 16.8a7.2 7.2 0 0 1-8.2-8.6 8.8 8.8 0 1 0 10 10.4 7 7 0 0 1-1.8-1.8Z" fill="var(--wx-moon)"/>
    <path d="M11.5 32h17.8a6.4 6.4 0 0 0 .5-12.8 8.4 8.4 0 0 0-15.8 2.2h-2.5A5.3 5.3 0 0 0 11.5 32Z" fill="var(--wx-cloud)"/>
    <circle cx="27" cy="22" r="6" fill="var(--wx-cloud-soft)"/>
  </svg>`,
  "cloudy": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.6 31.5h20.7a7.1 7.1 0 0 0 .5-14.1 9.8 9.8 0 0 0-18.4 2.5H9.6a5.8 5.8 0 0 0 0 11.6Z" fill="var(--wx-cloud)"/>
    <circle cx="28.4" cy="20.4" r="6.8" fill="var(--wx-cloud-soft)"/>
  </svg>`,
  "fog": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g stroke="var(--wx-fog)" stroke-width="3" stroke-linecap="round">
      <line x1="6" y1="13" x2="34" y2="13"/>
      <line x1="4" y1="20" x2="30" y2="20"/>
      <line x1="10" y1="27" x2="36" y2="27"/>
    </g>
  </svg>`,
  "drizzle": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.6 16.3h17.2a5.4 5.4 0 0 0 .4-10.8A7.7 7.7 0 0 0 14.7 7h-3.1a4.7 4.7 0 1 0 0 9.3Z" fill="var(--wx-cloud-soft)"/>
    <g stroke="var(--wx-drizzle)" stroke-width="2.1" stroke-linecap="round">
      <line x1="12" y1="22" x2="10.5" y2="27"/>
      <line x1="19" y1="21" x2="17.5" y2="26"/>
      <line x1="26" y1="22" x2="24.5" y2="27"/>
      <line x1="16" y1="30" x2="14.7" y2="34"/>
      <line x1="23" y1="30" x2="21.7" y2="34"/>
    </g>
  </svg>`,
  "rain": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.6 15.4h17.2a5.4 5.4 0 0 0 .4-10.8A7.7 7.7 0 0 0 14.7 6h-3.1a4.7 4.7 0 1 0 0 9.4Z" fill="var(--wx-cloud)"/>
    <g stroke="var(--wx-rain)" stroke-width="2.9" stroke-linecap="round">
      <line x1="13" y1="21" x2="10" y2="32"/>
      <line x1="21" y1="19" x2="18" y2="31"/>
      <line x1="29" y1="21" x2="26" y2="33"/>
    </g>
  </svg>`,
  "rain-heavy": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.2 14.8h20.4a5.6 5.6 0 0 0 .4-11.2 8.8 8.8 0 0 0-16.4 1.8h-4.4a4.7 4.7 0 1 0 0 9.4Z" fill="var(--wx-cloud)"/>
    <g stroke="var(--wx-rain-heavy)" stroke-width="3.5" stroke-linecap="round">
      <line x1="10" y1="21" x2="7" y2="34"/>
      <line x1="17" y1="19" x2="14" y2="33"/>
      <line x1="24" y1="20" x2="21" y2="34"/>
      <line x1="31" y1="19" x2="28" y2="33"/>
    </g>
  </svg>`,
  "snow": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.6 15.4h17.2a5.4 5.4 0 0 0 .4-10.8A7.7 7.7 0 0 0 14.7 6h-3.1a4.7 4.7 0 1 0 0 9.4Z" fill="var(--wx-cloud)"/>
    <g fill="var(--wx-snow)">
      <circle cx="12" cy="25" r="2.5"/>
      <circle cx="20" cy="22" r="2.5"/>
      <circle cx="28" cy="25" r="2.5"/>
      <circle cx="16" cy="33" r="2.2"/>
      <circle cx="24" cy="33" r="2.2"/>
    </g>
  </svg>`,
  "snow-heavy": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.2 14.8h20.4a5.6 5.6 0 0 0 .4-11.2 8.8 8.8 0 0 0-16.4 1.8h-4.4a4.7 4.7 0 1 0 0 9.4Z" fill="var(--wx-cloud)"/>
    <g fill="var(--wx-snow)">
      <circle cx="9.5" cy="24" r="2.7"/>
      <circle cx="17" cy="21" r="2.7"/>
      <circle cx="24.5" cy="24" r="2.7"/>
      <circle cx="31" cy="21" r="2.7"/>
      <circle cx="14" cy="33" r="2.4"/>
      <circle cx="22" cy="31" r="2.4"/>
      <circle cx="30" cy="34" r="2.4"/>
    </g>
  </svg>`,
  "thunder": `<svg class="wx-icon wx-icon-dense" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.6 15.4H29a5.4 5.4 0 0 0 .4-10.8A8 8 0 0 0 14.3 6h-3.7a4.7 4.7 0 1 0 0 9.4Z" fill="var(--wx-cloud)"/>
    <path d="M23.4 13 13.8 26h6.3l-3.7 12 10.9-15.5h-6.4L23.4 13Z" fill="var(--wx-bolt)" stroke="var(--wx-storm-edge)" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`
};

function weatherIcon(code, isDay = true, options = {}) {
  const density = typeof options === "string" ? options : options.density;
  const set = density === "dense" ? denseIconSvgs : iconSvgs;
  let key = weatherIcons[code] || "cloudy";
  if (key === "clear-day" && !isDay) key = "clear-night";
  if (density === "dense" && key === "partly-cloudy" && !isDay) key = "partly-cloudy-night";
  return set[key] || set["cloudy"];
}

// Open-Meteo's weather_code reports the most significant *possible* condition,
// which over-states rain/storms when the probability is low — e.g. a 4%-chance
// afternoon still coded "thunderstorms". Gate precipitation codes by probability
// and fall back to the actual sky, so the icon/label match what's likely.
const PRECIP_FEATURE_POP = 30; // POP% at/above which precipitation is featured
const RAIN_LIKELY_POP = 60; // High POP can outrank a plain sky/cloud code
const THUNDER_POTENTIAL_POP = 20; // Lower-confidence thunder gets a badge, not the main icon
const IMMINENT_PRECIP_MINUTES = 30; // Wet-biased hero window: "about to rain" should feel wet
const HOURLY_PRECIP_PRIMARY_POP = 60; // The hour is likely wet enough for a rain-first icon.
const HOURLY_PRECIP_SUPPORTED_POP = 30; // A chance hour can go rain-first when amount supports it.
const HOURLY_PRECIP_CHANCE_POP = 20; // Below this, keep precip out of the compact hourly surface.
const DAILY_PRECIP_ONE_HOUR_POP = 60; // One likely hour can make the day rain-shaped.
const DAILY_PRECIP_TWO_HOURS_POP = 40; // A couple chance hours can make the day rain-shaped.
const DAILY_PRECIP_THREE_HOURS_POP = 30; // Several chance hours can make the day rain-shaped.
const DAILY_PRECIP_NOTE_POP = 20; // Low daily chance stays as a note/percentage, not the headline.

function forecastUsesInches(data = state.forecast) {
  const unit = data?.current_units?.precipitation ||
    data?.hourly_units?.precipitation ||
    data?.minutely_15_units?.precipitation ||
    "";
  if (unit) return /inch|in\b/i.test(unit);
  return state.unit === "fahrenheit";
}

function precipRateThresholds(data = state.forecast) {
  return forecastUsesInches(data)
    ? { measurable: 0.008, moderate: 0.1, heavy: 0.3 }
    : { measurable: 0.2, moderate: 2.5, heavy: 7.6 };
}

function precipNoticeThresholds(data = state.forecast) {
  return forecastUsesInches(data)
    ? { hourlyAmount: 0.03, dailyAmount: 0.08 }
    : { hourlyAmount: 0.75, dailyAmount: 2 };
}

function precipRateFromAmount(amount, intervalSeconds = 3600) {
  const value = Number(amount || 0);
  const seconds = Number(intervalSeconds) > 0 ? Number(intervalSeconds) : 3600;
  return value > 0 ? value * 3600 / seconds : 0;
}

function isSnowCode(code) {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

function precipCodeFromRate(rate, baseCode = null, data = state.forecast) {
  const value = Number(rate || 0);
  const thresholds = precipRateThresholds(data);
  if (value < thresholds.measurable) return null;
  if (isThunderCode(baseCode)) return baseCode;
  if (isSnowCode(baseCode)) {
    if (value >= thresholds.heavy) return 75;
    if (value >= thresholds.moderate) return 73;
    return 71;
  }
  if (value >= thresholds.heavy) return 65;
  if (value >= thresholds.moderate) return 63;
  return 61;
}

function precipCodeWeight(code) {
  if (isThunderCode(code)) return 70;
  if (code === 65 || code === 67 || code === 75 || code === 82 || code === 86) return 60;
  if (code === 63 || code === 73 || code === 80 || code === 81 || code === 85) return 50;
  if (code === 61 || code === 66 || code === 71 || code === 77) return 40;
  if (code >= 51 && code <= 57) return 30;
  if (code === RAIN_LIKELY_CODE) return 20;
  return 0;
}

function strongerPrecipCode(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return precipCodeWeight(b) > precipCodeWeight(a) ? b : a;
}

function skyCodeFromCloud(cloudPct) {
  if (cloudPct == null) return 2; // unknown → partly cloudy
  if (cloudPct < 15) return 0;    // clear
  if (cloudPct < 45) return 1;    // mainly clear
  if (cloudPct < 75) return 2;    // partly cloudy
  return 3;                       // overcast
}

// code: WMO weather code; pop: precip probability %; cloudPct: cloud cover %.
function effectiveWeatherCode(code, pop, cloudPct, precipAmount = 0, options = {}) {
  const featureByProbability = options.featureByProbability !== false;
  const rate = Number.isFinite(options.precipRate)
    ? options.precipRate
    : precipRateFromAmount(precipAmount, options.intervalSeconds || 3600);
  const measuredCode = precipCodeFromRate(rate, code, options.data);
  if (code == null) return measuredCode ?? code;
  if (code < 51) {
    if (measuredCode) return measuredCode;
    return featureByProbability && (pop || 0) >= RAIN_LIKELY_POP ? RAIN_LIKELY_CODE : code;
  }
  if (measuredCode) return strongerPrecipCode(code, measuredCode);
  if (!featureByProbability) return skyCodeFromCloud(cloudPct);
  if (pop == null || pop >= PRECIP_FEATURE_POP) return code; // precip likely → keep
  return skyCodeFromCloud(cloudPct);                         // unlikely → show sky
}

function isThunderCode(code) {
  return code === 95 || code === 96 || code === 99;
}

function isPrecipCode(code) {
  return code === RAIN_LIKELY_CODE || (code >= 51 && code <= 86);
}

function precipKindFromCode(code) {
  if (isSnowCode(code)) return "snow";
  if (isThunderCode(code)) return "storm";
  return "rain";
}

function hourlySkyCode(data, index) {
  const h = data?.hourly || {};
  const rawCode = h.weather_code?.[index];
  const cloud = h.cloud_cover ? h.cloud_cover[index] : null;
  return effectiveWeatherCode(rawCode, 0, cloud, 0, {
    data,
    featureByProbability: false,
    precipRate: 0
  });
}

function hourlyPrecipProfile(data, index, options = {}) {
  const h = data?.hourly || {};
  const rawCode = h.weather_code?.[index];
  const pop = h.precipitation_probability ? (h.precipitation_probability[index] || 0) : 0;
  const cloud = h.cloud_cover ? h.cloud_cover[index] : null;
  const precip = h.precipitation ? (h.precipitation[index] || 0) : 0;
  const rate = precipRateFromAmount(precip, options.intervalSeconds || 3600);
  const thresholds = precipNoticeThresholds(data);
  const activePrecip = Boolean(options.activePrecip);
  const likely = pop >= HOURLY_PRECIP_PRIMARY_POP;
  const amountSupported = pop >= HOURLY_PRECIP_SUPPORTED_POP && rate >= thresholds.hourlyAmount;
  const primary = activePrecip || likely || amountSupported;
  const skyCode = hourlySkyCode(data, index);
  const code = activePrecip && options.activeCode != null
    ? options.activeCode
    : primary
      ? effectiveWeatherCode(rawCode, pop, cloud, precip, { data })
      : skyCode;
  return {
    rawCode,
    pop,
    cloud,
    precip,
    rate,
    code,
    skyCode,
    primary,
    likely,
    amountSupported,
    chance: pop >= HOURLY_PRECIP_CHANCE_POP
  };
}

function dailyPrecipProfile(data, dayIndex) {
  const daily = data?.daily || {};
  const h = data?.hourly || {};
  const dayStr = daily.time?.[dayIndex];
  const thresholds = precipNoticeThresholds(data);
  const dailyAmount = daily.precipitation_sum?.[dayIndex] || 0;
  const dailyPop = daily.precipitation_probability_max?.[dayIndex] || 0;
  const activeNow = dayIndex === forecastDailyIndex(data) && state.weatherTruth?.precip?.phase === "active";
  let maxPop = dailyPop;
  let count20 = 0;
  let count30 = 0;
  let count40 = 0;
  let count60 = 0;
  let bestCode = null;
  let bestRawCode = daily.weather_code?.[dayIndex] ?? null;
  let bestScore = -1;
  let bestRawScore = -1;

  const considerCandidate = (rawCode, pop, cloud, precip, rate) => {
    const candidate = effectiveWeatherCode(rawCode, pop, cloud, precip, { data });
    if (!isPrecipCode(candidate) && !isThunderCode(candidate)) return;
    const amountScore = Math.min(999, Math.round((rate || 0) * 100));
    const score = precipRank(candidate) * 100000 + (pop || 0) * 1000 + amountScore;
    if (score > bestScore) {
      bestScore = score;
      bestCode = candidate;
    }
  };

  if (h.time?.length && dayStr) {
    h.time.forEach((time, index) => {
      if (!time.startsWith(dayStr)) return;
      const profile = hourlyPrecipProfile(data, index);
      maxPop = Math.max(maxPop, profile.pop || 0);
      if (profile.pop >= DAILY_PRECIP_NOTE_POP) count20 += 1;
      if (profile.pop >= DAILY_PRECIP_THREE_HOURS_POP) count30 += 1;
      if (profile.pop >= DAILY_PRECIP_TWO_HOURS_POP) count40 += 1;
      if (profile.pop >= DAILY_PRECIP_ONE_HOUR_POP) count60 += 1;
      if (isPrecipCode(profile.rawCode) || isThunderCode(profile.rawCode)) {
        const rawScore = (profile.pop || 0) * 1000 + precipRank(profile.rawCode);
        if (rawScore > bestRawScore) {
          bestRawScore = rawScore;
          bestRawCode = profile.rawCode;
        }
      }
      if (
        profile.pop >= DAILY_PRECIP_THREE_HOURS_POP ||
        (profile.pop >= DAILY_PRECIP_NOTE_POP && profile.rate >= thresholds.hourlyAmount)
      ) {
        considerCandidate(profile.rawCode, profile.pop, profile.cloud, profile.precip, profile.rate);
      }
    });
  } else {
    if (dailyPop >= DAILY_PRECIP_NOTE_POP) count20 = 1;
    if (dailyPop >= DAILY_PRECIP_THREE_HOURS_POP) count30 = 1;
    if (dailyPop >= DAILY_PRECIP_TWO_HOURS_POP) count40 = 1;
    if (dailyPop >= DAILY_PRECIP_ONE_HOUR_POP) count60 = 1;
    if (dailyPop >= DAILY_PRECIP_THREE_HOURS_POP && (isPrecipCode(bestRawCode) || isThunderCode(bestRawCode))) {
      bestCode = bestRawCode;
    }
  }

  const amountPrimary = dailyAmount >= thresholds.dailyAmount;
  const primary = Boolean(activeNow || count60 >= 1 || count40 >= 2 || count30 >= 3 || amountPrimary);
  if (activeNow && isPrecipCode(state.weatherTruth?.nowCode)) {
    bestCode = state.weatherTruth.nowCode;
  }
  if (primary && bestCode == null) {
    if (isPrecipCode(bestRawCode) || isThunderCode(bestRawCode)) bestCode = bestRawCode;
    else bestCode = RAIN_LIKELY_CODE;
  }

  const noun = precipKindFromCode(bestCode ?? bestRawCode);
  let note = "";
  if (!primary) {
    if (maxPop >= DAILY_PRECIP_THREE_HOURS_POP || count20 >= 2) note = `Brief ${noun} chance`;
    else if (maxPop >= DAILY_PRECIP_NOTE_POP || dailyAmount > 0) note = `Low ${noun} chance`;
  }

  return {
    primary,
    code: bestCode,
    rawCode: bestRawCode,
    noun,
    note,
    maxPop,
    dailyAmount,
    count20,
    count30,
    count40,
    count60,
    amountPrimary,
    activeNow
  };
}

function hasThunderPotential(rawCode, pop, shownCode, precipAmount = 0, data = state.forecast) {
  const measured = precipCodeFromRate(precipRateFromAmount(precipAmount), rawCode, data);
  return isThunderCode(rawCode) &&
    !isThunderCode(shownCode) &&
    ((pop || 0) >= THUNDER_POTENTIAL_POP || Boolean(measured));
}

function dailyConditionLabel(code) {
  if (isThunderCode(code)) return "Storms";
  return weatherCodes[code] || "Weather";
}

function thunderBadgeHtml(label = "Thunder possible") {
  return `<span class="storm-potential-badge" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M12.8 1.2 4.7 10.9h4.5L7.3 18.8l8.5-10.5h-4.4l1.4-7.1Z" fill="currentColor"/>
    </svg>
  </span>`;
}

// "Now" has no probability, so gate by whether precipitation is actually falling.
function effectiveCurrentCode(current, data = state.forecast) {
  const code = current.weather_code;
  const rate = precipRateFromAmount(current.precipitation, current.interval || 3600);
  const measuredCode = precipCodeFromRate(rate, code, data);
  if (measuredCode) return measuredCode;
  if (code == null || code < 51) return code;
  return skyCodeFromCloud(current.cloud_cover);
}

function nowPrecipSignal(data = state.forecast) {
  const current = data?.current || {};
  const hourly = data?.hourly || {};
  const currentIndex = currentHourlyIndex(data);
  const hourlyPop = currentIndex >= 0 ? (hourly.precipitation_probability?.[currentIndex] || 0) : 0;
  const signal = {
    isWetNow: false,
    isSnow: false,
    rate: 0,
    amount: 0,
    code: null,
    chance: hourlyPop,
    label: "",
    detail: "",
    nowcast: null
  };
  const consider = (amount, intervalSeconds, code, chance = 0, isSnow = false) => {
    const rate = precipRateFromAmount(amount, intervalSeconds);
    const measuredCode = precipCodeFromRate(rate, isSnow ? 71 : code, data);
    if (!measuredCode) return;
    if (rate >= signal.rate) {
      signal.rate = rate;
      signal.amount = Number(amount || 0);
      signal.code = strongerPrecipCode(signal.code, measuredCode);
      signal.isSnow = isSnow || isSnowCode(measuredCode);
    }
    signal.chance = Math.max(signal.chance, chance || 0, 100);
  };

  consider(current.precipitation, current.interval || 3600, current.weather_code, 0);
  // Hourly precipitation is a forecast bucket for the whole hour, not proof
  // that precipitation is happening at this exact moment.

  const nowcast = analyzeNowcast(data);
  if (nowcast) {
    signal.nowcast = nowcast;
    if (nowcast.wet?.[0]) {
      const slot = nowcast.slots?.[0];
      const nowcastBaseCode = nowcast.isSnow ? 71 : (isThunderCode(signal.code) ? signal.code : 61);
      consider(slot?.precip, 15 * 60, nowcastBaseCode, slot?.prob, nowcast.isSnow);
      signal.detail = nowcast.detail;
      signal.label = nowcast.title.replace(/\s+now$/i, "");
    }
  }

  signal.isWetNow = signal.rate >= precipRateThresholds(data).measurable;
  if (signal.isWetNow && !signal.label) {
    signal.label = weatherCodes[signal.code] || (signal.isSnow ? "Snow" : "Rain");
  }
  return signal;
}

function applyRadarPrecipSignal(signal, data = state.forecast) {
  const radar = currentRadarPrecipSignal();
  if (!signal || !radar || radar.phase === "unavailable") return signal;
  signal.radar = radar;

  if (radar.phase !== "active") return signal;

  const radarCode = radarObservedPrecipCode(data, radar);
  signal.isWetNow = true;
  signal.rate = Math.max(signal.rate || 0, precipRateThresholds(data).measurable);
  signal.code = strongerPrecipCode(signal.code, radarCode);
  signal.isSnow = signal.isSnow || isSnowCode(radarCode);
  signal.chance = Math.max(signal.chance || 0, 100);
  signal.label = weatherCodes[signal.code] || (signal.isSnow ? "Snow" : "Rain");
  signal.detail = radarObservedPrecipDetail(radarCode, "over this place");
  signal.source = "radar-current";
  return signal;
}

function radarObservedPrecipCode(data = state.forecast, radar = currentRadarPrecipSignal()) {
  const code = radarPrecipCode(data, radar);
  if (isThunderCode(code)) return code;
  if (isSnowCode(code)) return 71;
  return 61;
}

function radarObservedPrecipDetail(code, where = "over this place") {
  if (isThunderCode(code)) return `Storms observed on radar ${where}`;
  if (isSnowCode(code)) return `Snow observed on radar ${where}`;
  return `Rain observed on radar ${where}`;
}

function observedPrecipSummaryLabel(code) {
  if (isThunderCode(code)) return "Storms observed";
  if (isSnowCode(code)) return "Snow observed";
  return "Rain observed";
}

function activePrecipSummaryValue(precip, nowPrecip = null) {
  const code = precip?.textCode ?? precip?.visualCode ?? nowPrecip?.code ?? 61;
  const source = precip?.source || nowPrecip?.source || "";
  if (source === "radar-current") return observedPrecipSummaryLabel(code);
  const label = precip?.label || weatherCodes[code] || (isSnowCode(code) ? "Snow" : "Rain");
  return `${label} now`;
}

function radarPrecipCode(data = state.forecast, radar = currentRadarPrecipSignal()) {
  const shouldShowSnow = radarShouldShowSnow(data);
  const intensity = radar?.intensity || "light";
  if (shouldShowSnow) {
    if (intensity === "heavy") return 75;
    if (intensity === "moderate") return 73;
    return 71;
  }
  if (intensity === "heavy") return 65;
  if (intensity === "moderate") return 63;
  return 61;
}

function radarShouldShowSnow(data = state.forecast) {
  const current = data?.current || {};
  if (isSnowCode(current.weather_code)) return true;
  const nowcast = analyzeNowcast(data);
  if (nowcast?.isSnow) return true;
  const temp = Number(current.temperature_2m);
  if (!Number.isFinite(temp)) return false;
  const unit = data?.current_units?.temperature_2m || "";
  const tempF = /c/i.test(unit) ? (temp * 9 / 5 + 32) : temp;
  return tempF <= 34;
}

function hasMinutelyPrecipData(data = state.forecast) {
  const m = data?.minutely_15;
  return Boolean(m?.time?.length && m?.precipitation?.length);
}

function nowcastWetIndex(nowcast) {
  return nowcast?.wet?.findIndex(Boolean) ?? -1;
}

function nowcastLeadMinutes(nowcast, data = state.forecast) {
  const index = nowcastWetIndex(nowcast);
  const slot = index >= 0 ? nowcast.slots?.[index] : null;
  if (!slot || !Number.isFinite(slot.t)) return null;
  return Math.max(0, Math.round((slot.t - forecastNowMs(data)) / 60000));
}

function nowcastPrecipCode(nowcast, data = state.forecast) {
  if (!nowcast) return null;
  const rate = (nowcast.peak || 0) * 4;
  return precipCodeFromRate(rate, nowcast.isSnow ? 71 : 61, data) || (nowcast.isSnow ? 71 : 61);
}

function buildPrecipTruth(data, nowPrecip, context = {}) {
  const nowcast = nowPrecip?.nowcast || analyzeNowcast(data);
  const wetIndex = nowcastWetIndex(nowcast);
  const startsInMin = nowcastLeadMinutes(nowcast, data);
  const currentPop = context.pop ?? currentRainChanceFromHourly(data);
  const chance = Math.max(currentPop || 0, nowPrecip?.chance || 0, wetIndex >= 0 ? (nowcast?.slots?.[wetIndex]?.prob || 0) : 0);
  const hasMinuteData = hasMinutelyPrecipData(data);
  const rawPrecipLikely = isPrecipCode(context.rawCode) && context.rawCode !== RAIN_LIKELY_CODE && (currentPop == null || currentPop >= PRECIP_FEATURE_POP);
  const hourlyPrecipRate = precipRateFromAmount(context.precip || 0, context.intervalSeconds || 3600);
  const hourlyPrecipCode = precipCodeFromRate(hourlyPrecipRate, context.rawCode, data);
  const hourlyPrecipLikely = Boolean(hourlyPrecipCode);
  const radar = nowPrecip?.radar;
  const radarClearNow = radar?.phase === "clear" && radar.confidence === "observed-clear";
  const probableWithoutNowcast = !hasMinuteData && !radarClearNow && (rawPrecipLikely || hourlyPrecipLikely || (currentPop || 0) >= RAIN_LIKELY_POP);
  const baseSkyCode = context.baseCode ?? skyCodeFromCloud(context.cloud);

  if (nowPrecip?.isWetNow) {
    const code = nowPrecip.code || context.rawCode || 61;
    const label = nowPrecip.label || weatherCodes[code] || (nowPrecip.isSnow ? "Snow" : "Rain");
    return {
      phase: "active",
      isWetNow: true,
      isImminent: false,
      visualWet: true,
      visualCode: code,
      textCode: code,
      label,
      headline: `${label.toLowerCase()} now`,
      context: nowPrecip.detail || "Happening now",
      detail: nowPrecip.detail || "Precipitation is happening now.",
      chance,
      startsInMin: 0,
      nowcast,
      source: nowPrecip.source || (nowPrecip.radar?.phase === "active" ? "radar-current" : nowPrecip.nowcast?.wet?.[0] ? "minutely-current" : "current"),
      confidence: "observed"
    };
  }

  if (nowcast && wetIndex > 0 && startsInMin !== null && startsInMin <= IMMINENT_PRECIP_MINUTES) {
    const code = nowcastPrecipCode(nowcast, data);
    const label = weatherCodes[code] || (nowcast.isSnow ? "Snow" : "Rain");
    return {
      phase: "imminent",
      isWetNow: false,
      isImminent: true,
      visualWet: true,
      visualCode: code,
      textCode: code,
      label,
      headline: `${label.toLowerCase()} soon`,
      context: nowcast.detail,
      detail: `${label} starts soon. ${nowcast.detail}.`,
      chance,
      startsInMin,
      nowcast,
      source: "minutely-soon",
      confidence: "imminent"
    };
  }

  if (radar?.phase === "nearby") {
    const code = radarPrecipCode(data, radar);
    const label = weatherCodes[code] || radar.label || "Rain";
    return {
      phase: "nearby",
      isWetNow: false,
      isImminent: false,
      visualWet: false,
      visualCode: baseSkyCode,
      textCode: code,
      label,
      headline: `${label.toLowerCase()} nearby`,
      context: radar.detail || `${label} on radar nearby`,
      detail: `${label} is close by on radar, but not over this place yet.`,
      chance,
      startsInMin: null,
      nowcast,
      source: "radar-nearby",
      confidence: "nearby"
    };
  }

  if (probableWithoutNowcast) {
    const code = rawPrecipLikely ? context.rawCode : (hourlyPrecipCode || 61);
    const label = rawPrecipLikely || hourlyPrecipLikely ? (weatherCodes[code] || "Rain likely") : "Rain likely";
    return {
      phase: "likely-this-hour",
      isWetNow: false,
      isImminent: false,
      visualWet: true,
      visualCode: code,
      textCode: rawPrecipLikely || hourlyPrecipLikely ? code : RAIN_LIKELY_CODE,
      label,
      headline: "rain likely this hour",
      context: `${currentPop || chance}% this hour`,
      detail: `Rain is likely this hour, and no 15-minute nowcast is available to narrow the start time.`,
      chance,
      startsInMin: null,
      nowcast,
      source: "hourly-pop",
      confidence: "likely"
    };
  }

  if ((currentPop || 0) >= RAIN_LIKELY_POP) {
    return {
      phase: "likely-this-hour",
      isWetNow: false,
      isImminent: false,
      visualWet: false,
      visualCode: baseSkyCode,
      textCode: RAIN_LIKELY_CODE,
      label: "Rain likely",
      headline: "rain likely this hour",
      context: `${currentPop}% this hour`,
      detail: `Rain chance is ${currentPop}% this hour, but the near-term precipitation signal is not wet yet.`,
      chance,
      startsInMin: null,
      nowcast,
      source: "hourly-pop",
      confidence: "likely"
    };
  }

  if ((currentPop || 0) >= PRECIP_FEATURE_POP) {
    return {
      phase: "possible-this-hour",
      isWetNow: false,
      isImminent: false,
      visualWet: false,
      visualCode: baseSkyCode,
      textCode: RAIN_LIKELY_CODE,
      label: "Rain possible",
      headline: "rain possible this hour",
      context: `${currentPop}% this hour`,
      detail: `Rain is possible this hour, but not immediate enough to define the scene.`,
      chance,
      startsInMin: null,
      nowcast,
      source: "hourly-pop",
      confidence: "possible"
    };
  }

  if (nowcast && wetIndex > 0) {
    const code = nowcastPrecipCode(nowcast, data);
    const label = weatherCodes[code] || (nowcast.isSnow ? "Snow" : "Rain");
    return {
      phase: "possible-later",
      isWetNow: false,
      isImminent: false,
      visualWet: false,
      visualCode: baseSkyCode,
      textCode: code,
      label,
      headline: `${nowcast.isSnow ? "snow" : "rain"} later`,
      context: nowcast.detail,
      detail: `${label} is possible later. ${nowcast.detail}.`,
      chance,
      startsInMin,
      nowcast,
      source: "minutely-later",
      confidence: "forecast"
    };
  }

  return {
    phase: "dry",
    isWetNow: false,
    isImminent: false,
    visualWet: false,
    visualCode: baseSkyCode,
    textCode: baseSkyCode,
    label: "Dry",
    headline: "staying dry nearby",
    context: "No meaningful rain nearby",
    detail: "No meaningful precipitation is nearby.",
    chance,
    startsInMin: null,
    nowcast,
    source: "dry",
    confidence: "forecast"
  };
}

function weatherTruth(data = state.forecast) {
  const radarSignalKey = radarPrecipSignalKey(currentRadarPrecipSignal());
  if (state.weatherTruth?.data === data && state.weatherTruth?.radarSignalKey === radarSignalKey) return state.weatherTruth;
  return buildWeatherTruth(data);
}

function weatherTruthReceipt(display, nowPrecip, data = state.forecast, precipTruth = display?.precipTruth) {
  const label = weatherCodes[display.code] || "Weather";
  const hourlyPop = display.hourlyIndex >= 0
    ? data?.hourly?.precipitation_probability?.[display.hourlyIndex]
    : null;
  if (precipTruth?.phase === "active" || nowPrecip?.isWetNow) {
    const activeLabel = weatherCodes[precipTruth?.visualCode] || precipTruth?.label || label;
    const source = precipTruth?.source === "radar-current"
      ? "radar"
      : precipTruth?.source === "minutely-current" ? "current + 15-min precip" : "current precip";
    const lowPopNote = Number.isFinite(hourlyPop) && hourlyPop < PRECIP_FEATURE_POP
      ? ` Hourly rain chance is only ${hourlyPop}%, so measured precip is taking priority.`
      : "";
    return {
      short: `${activeLabel} now · ${source}`,
      detail: `Showing ${activeLabel.toLowerCase()} because precipitation is happening now.${lowPopNote}`,
      source: precipTruth?.source || (nowPrecip?.nowcast ? "minutely-current" : "current"),
      confidence: precipTruth?.confidence || "observed"
    };
  }

  if (precipTruth?.phase === "nearby") {
    return {
      short: `${precipTruth.label || "Rain"} nearby · radar`,
      detail: precipTruth.detail || `Radar shows ${String(precipTruth.label || "rain").toLowerCase()} nearby, but not over this place.`,
      source: precipTruth.source,
      confidence: precipTruth.confidence
    };
  }

  if (precipTruth?.phase === "imminent") {
    const soonLabel = precipTruth.label || "Rain";
    return {
      short: `${soonLabel} soon · ${precipTruth.context || "near-term nowcast"}`,
      detail: `Showing the current sky with an unsettled feel because ${soonLabel.toLowerCase()} starts soon. Text stays future-tense until precipitation is active.`,
      source: precipTruth.source,
      confidence: precipTruth.confidence
    };
  }

  if (precipTruth?.phase === "likely-this-hour") {
    const chance = precipTruth.chance || display.pop || 0;
    const scene = precipTruth.visualWet
      ? "the scene leans unsettled because no 15-minute nowcast is available to narrow the start time"
      : `the scene stays ${label.toLowerCase()} because near-term precipitation is not active yet`;
    return {
      short: `Rain likely this hour · ${precipTruth.context || `${chance}% this hour`}`,
      detail: `Rain chance is ${chance}% this hour, and ${scene}.`,
      source: precipTruth.source,
      confidence: precipTruth.confidence
    };
  }

  if (precipTruth?.phase === "possible-this-hour" || precipTruth?.phase === "possible-later") {
    return {
      short: `${label} · ${precipTruth.headline}`,
      detail: precipTruth.detail || `Showing ${label.toLowerCase()} while precipitation stays a future possibility.`,
      source: precipTruth.source,
      confidence: precipTruth.confidence
    };
  }

  if (display.rawCode !== display.code && isPrecipCode(display.rawCode)) {
    return {
      short: `${label} · low precip confidence`,
      detail: `Hourly code suggested ${String(weatherCodes[display.rawCode] || "precipitation").toLowerCase()}, but rain chance is ${display.pop || 0}% and no active precipitation is measured.`,
      source: "gated-hourly",
      confidence: "mixed"
    };
  }

  if (display.hourlyIndex >= 0) {
    return {
      short: `${label} · hourly forecast`,
      detail: `Showing ${label.toLowerCase()} from the nearest hourly forecast row.`,
      source: "hourly",
      confidence: "forecast"
    };
  }

  return {
    short: `${label} · current conditions`,
    detail: `Showing ${label.toLowerCase()} from current conditions.`,
    source: "current",
    confidence: "forecast"
  };
}

function weatherTruthSurfaceDetail(truth) {
  if (!truth) return "";
  return truth.receiptDetail || truth.receipt || "";
}

function currentLocalDaylightIsDay(data = state.forecast, fallback = true) {
  const dayIndex = forecastDailyIndex(data);
  const sunriseMs = data?.daily?.sunrise?.[dayIndex]
    ? parseForecastTimestamp(data.daily.sunrise[dayIndex], data)
    : null;
  const sunsetMs = data?.daily?.sunset?.[dayIndex]
    ? parseForecastTimestamp(data.daily.sunset[dayIndex], data)
    : null;
  const now = forecastNowMs(data);
  if (sunriseMs !== null && sunsetMs !== null && sunsetMs > sunriseMs) {
    return now >= sunriseMs && now <= sunsetMs;
  }
  const mode = sunExposureMode(data, sunriseMs, sunsetMs);
  if (mode === "polar-day") return true;
  if (mode === "polar-night") return false;
  return Boolean(fallback);
}

function syncWeatherTruthDaylight(truth, isDay) {
  if (!truth) return truth;
  const liveIsDay = Boolean(isDay);
  truth.isDay = liveIsDay;
  if (truth.display) truth.display.isDay = liveIsDay;
  return truth;
}

function updateHeroWeatherIcon(code, isDay) {
  const heroIcon = document.getElementById("heroIcon");
  if (heroIcon) heroIcon.innerHTML = weatherIcon(code, isDay);
}

function updateCurrentHourlyWeatherIcon(truth = state.weatherTruth) {
  const icon = els.hourly?.querySelector(".hour-card.current .hour-icon");
  if (!icon || !truth) return;
  const stormPotential = truth.display?.stormPotential;
  icon.innerHTML = weatherIcon(truth.nowCode ?? truth.code, truth.isDay, { density: "dense" }) +
    (stormPotential ? thunderBadgeHtml() : "");
}

function buildWeatherTruth(data = state.forecast) {
  const current = data?.current || {};
  const fallbackIsDay = current.is_day !== undefined ? Boolean(current.is_day) : true;
  const currentIndex = currentHourlyIndex(data);
  const hourly = data?.hourly || {};
  const nowPrecip = applyRadarPrecipSignal(nowPrecipSignal(data), data);
  const radarSignalKey = radarPrecipSignalKey(currentRadarPrecipSignal());
  let display;

  if (currentIndex >= 0 && hourly.weather_code?.[currentIndex] != null) {
    const rawCode = hourly.weather_code[currentIndex];
    const pop = hourly.precipitation_probability ? (hourly.precipitation_probability[currentIndex] || 0) : null;
    const cloud = hourly.cloud_cover ? hourly.cloud_cover[currentIndex] : current.cloud_cover;
    const precip = hourly.precipitation?.[currentIndex] || 0;
    const baseCode = effectiveWeatherCode(rawCode, pop, cloud, 0, {
      data,
      featureByProbability: false
    });
    const precipTruth = buildPrecipTruth(data, nowPrecip, {
      rawCode,
      pop,
      cloud,
      precip,
      intervalSeconds: 3600,
      baseCode,
      hourlyIndex: currentIndex
    });
    const currentCode = effectiveCurrentCode(current, data);
    const measuredCode = nowPrecip.isWetNow ? strongerPrecipCode(currentCode, nowPrecip.code) : null;
    // Keep current-condition icons separate from the immersive scene: "rain soon"
    // can tint the sky, but it must not become the Now icon.
    const nowCode = measuredCode ?? currentCode ?? baseCode;
    const sceneCode = measuredCode ?? baseCode;
    display = {
      code: sceneCode,
      sceneCode,
      nowCode,
      rawCode,
      pop: Math.max(pop || 0, precipTruth.chance || 0),
      cloud,
      isDay: hourly.is_day ? Boolean(hourly.is_day[currentIndex]) : fallbackIsDay,
      hourlyIndex: currentIndex,
      precip: Math.max(precip, nowPrecip.amount || 0, current.precipitation || 0),
      nowPrecip,
      precipTruth,
      stormPotential: hasThunderPotential(rawCode, pop, nowCode, precip, data)
    };
  } else {
    const fallbackCode = effectiveCurrentCode(current, data);
    const precipTruth = buildPrecipTruth(data, nowPrecip, {
      rawCode: current.weather_code,
      pop: null,
      cloud: current.cloud_cover,
      precip: current.precipitation,
      intervalSeconds: current.interval || 3600,
      baseCode: fallbackCode,
      hourlyIndex: -1
    });
    const nowCode = nowPrecip.isWetNow ? strongerPrecipCode(fallbackCode, nowPrecip.code) : fallbackCode;
    const sceneCode = nowPrecip.isWetNow ? strongerPrecipCode(fallbackCode, nowPrecip.code) : fallbackCode;
    display = {
      code: sceneCode,
      sceneCode,
      nowCode,
      rawCode: current.weather_code,
      pop: precipTruth.chance || null,
      cloud: current.cloud_cover,
      isDay: fallbackIsDay,
      hourlyIndex: -1,
      precip: Math.max(nowPrecip.amount || 0, current.precipitation || 0),
      nowPrecip,
      precipTruth,
      stormPotential: false
    };
  }

  display.isDay = currentLocalDaylightIsDay(data, display.isDay);

  const receipt = weatherTruthReceipt(display, nowPrecip, data, display.precipTruth);
  const truth = {
    data,
    display,
    code: display.nowCode,
    nowCode: display.nowCode,
    sceneCode: display.sceneCode,
    label: weatherCodes[display.nowCode] || "Weather",
    isDay: display.isDay,
    rainChance: display.precipTruth?.chance ?? (display.pop ?? currentRainChanceFromHourly(data)),
    nowPrecip,
    precip: display.precipTruth,
    confidence: receipt.confidence,
    source: receipt.source,
    receipt: receipt.short,
    receiptDetail: receipt.detail,
    surfaceDetail: ""
  };
  truth.radarPrecip = nowPrecip.radar || null;
  truth.radarSignalKey = radarSignalKey;
  truth.surfaceDetail = weatherTruthSurfaceDetail(truth);
  return truth;
}

function currentDisplayCondition(data = state.forecast) {
  return weatherTruth(data).display;
}

function currentRainChanceFromHourly(data = state.forecast) {
  const chances = data?.hourly?.precipitation_probability || [];
  const currentIndex = currentHourlyIndex(data);
  if (currentIndex >= 0) return chances[currentIndex] ?? 0;
  const hour = forecastCurrentHour(data);
  return chances[hour] ?? chances[0] ?? data?.daily?.precipitation_probability_max?.[forecastDailyIndex(data)] ?? 0;
}

// Rough severity ranking so a daily headline can feature the most significant
// precipitation, not just the lightest/likeliest one.
function precipRank(code) {
  if (code === RAIN_LIKELY_CODE) return 2;
  if (code >= 95) return 6;                                  // thunderstorms
  if (code === 65 || code === 67 || code === 75 || code === 82 || code === 86) return 5; // heavy
  if (code === 63 || code === 73 || code === 81 || code === 80 || code === 85) return 4; // moderate / showers
  if (code === 61 || code === 66 || code === 71 || code === 77) return 3;  // light rain / snow
  if (code >= 56) return 2;                                  // freezing drizzle / light snow
  return 1;                                                  // drizzle (51-55)
}

// Daily headline derived from the day's *gated* hourly codes, not Open-Meteo's
// daily code (which takes the single most-severe code regardless of probability,
// so a 4%-chance afternoon makes the whole day read "thunderstorms"). Among the
// hours where precip is likely enough to feature, take the most significant;
// if none, take the dominant sky.
function representativeDailyCode(data, dayIndex) {
  const dayStr = data.daily.time[dayIndex];
  const h = data.hourly;
  const precipProfile = dailyPrecipProfile(data, dayIndex);
  if (!h || !h.time) {
    if (precipProfile.primary && precipProfile.code != null) return precipProfile.code;
    return isPrecipCode(data.daily.weather_code[dayIndex])
      ? skyCodeFromCloud(null)
      : data.daily.weather_code[dayIndex];
  }
  const skyCounts = {};
  let cloudSum = 0, cloudN = 0;
  for (let i = 0; i < h.time.length; i++) {
    if (!h.time[i].startsWith(dayStr)) continue;
    const cloud = h.cloud_cover ? h.cloud_cover[i] : null;
    const eff = hourlySkyCode(data, i);
    skyCounts[eff] = (skyCounts[eff] || 0) + 1;
    if (Number.isFinite(cloud)) { cloudSum += cloud; cloudN++; }
  }
  if (precipProfile.primary && precipProfile.code != null) return precipProfile.code;
  const modalSky = Object.keys(skyCounts).sort((a, b) => skyCounts[b] - skyCounts[a])[0];
  return modalSky != null ? Number(modalSky) : skyCodeFromCloud(cloudN ? cloudSum / cloudN : null);
}

function hasThunderPotentialForDay(data, dayIndex, shownCode) {
  if (isThunderCode(shownCode)) return false;
  const dayStr = data.daily.time[dayIndex];
  const h = data.hourly;
  if (!h || !h.time) return false;
  return h.time.some((time, i) => {
    if (!time.startsWith(dayStr)) return false;
    const profile = hourlyPrecipProfile(data, i);
    return hasThunderPotential(profile.rawCode, profile.pop, profile.code, profile.precip, data);
  });
}

function hasThunderPotentialForIndices(data, indices, shownCode) {
  if (isThunderCode(shownCode)) return false;
  const h = data.hourly;
  if (!h || !h.time) return false;
  return indices.some((i) => {
    const profile = hourlyPrecipProfile(data, i);
    return hasThunderPotential(profile.rawCode, profile.pop, profile.code, profile.precip, data);
  });
}

function representativeHourlyCodeForIndices(data, indices) {
  const h = data?.hourly;
  if (!h || !indices?.length) return data?.current?.weather_code ?? 0;
  let precipCode = null, precipScore = -1;
  const skyCounts = {};
  let cloudSum = 0, cloudN = 0;
  indices.forEach((i) => {
    const profile = hourlyPrecipProfile(data, i);
    const cloud = h.cloud_cover ? h.cloud_cover[i] : null;
    const eff = profile.code;
    if (profile.primary && eff >= 51) {
      const score = precipRank(eff) * 1000 + profile.pop;
      if (score > precipScore) {
        precipScore = score;
        precipCode = eff;
      }
    } else {
      skyCounts[profile.skyCode] = (skyCounts[profile.skyCode] || 0) + 1;
    }
    if (Number.isFinite(cloud)) {
      cloudSum += cloud;
      cloudN++;
    }
  });
  if (precipCode != null) return precipCode;
  const modalSky = Object.keys(skyCounts).sort((a, b) => skyCounts[b] - skyCounts[a])[0];
  return modalSky != null ? Number(modalSky) : skyCodeFromCloud(cloudN ? cloudSum / cloudN : null);
}

function initPerfDiagnostics() {
  if (perfState.initialized) return;
  perfState.initialized = true;
  window.nearcastPerf = {
    get enabled() { return perfState.enabled; },
    get entries() { return perfState.entries.slice(); },
    enable() { setPerfEnabled(true); },
    disable() { setPerfEnabled(false); },
    clear() { perfState.entries = []; },
    mark(name, detail = {}) {
      perfRecord("mark", name, 0, detail, 0);
    },
    measure(name, fn, threshold = PERF_RENDER_WARN_MS) {
      return perfMeasure(name, fn, threshold);
    },
    get map() {
      return typeof window.nearcastMapDiagnostics === "function" ? window.nearcastMapDiagnostics() : null;
    }
  };
  if (perfState.enabled) {
    installLongTaskObserver();
    console.info("[Nearcast perf] Diagnostics enabled. Use window.nearcastPerf.entries to inspect recent events.");
  }
}

function setPerfEnabled(enabled) {
  perfState.enabled = Boolean(enabled);
  if (perfState.enabled) {
    localStorage.setItem(PERF_STORAGE_KEY, "1");
    installLongTaskObserver();
    console.info("[Nearcast perf] Enabled.");
  } else {
    localStorage.removeItem(PERF_STORAGE_KEY);
    console.info("[Nearcast perf] Disabled.");
  }
}

function installLongTaskObserver() {
  if (!perfState.enabled || perfState.longTaskObserver || !("PerformanceObserver" in window)) return;
  try {
    if (PerformanceObserver.supportedEntryTypes &&
        !PerformanceObserver.supportedEntryTypes.includes("longtask")) return;
    perfState.longTaskObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        perfRecord("longtask", "main-thread", entry.duration, {
          start: Math.round(entry.startTime)
        }, PERF_LONG_TASK_WARN_MS);
      });
    });
    perfState.longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    perfState.longTaskObserver = null;
  }
}

function perfRecord(kind, name, duration, detail = {}, threshold = PERF_RENDER_WARN_MS) {
  if (!perfState.enabled) return;
  const entry = {
    at: Math.round(performance.now()),
    kind,
    name,
    duration: Number(duration.toFixed ? duration.toFixed(1) : duration),
    detail
  };
  perfState.entries.push(entry);
  if (perfState.entries.length > PERF_MAX_ENTRIES) perfState.entries.shift();
  if (duration >= threshold) {
    console.warn(`[Nearcast perf] ${name} ${duration.toFixed ? duration.toFixed(1) : duration}ms`, detail);
  }
}

function perfStart() {
  return perfState.enabled && performance?.now ? performance.now() : 0;
}

function perfEnd(name, start, threshold = PERF_RENDER_WARN_MS, detail = {}) {
  if (!start) return;
  perfRecord("measure", name, performance.now() - start, detail, threshold);
}

function perfMeasure(name, fn, threshold = PERF_RENDER_WARN_MS) {
  const start = perfStart();
  try {
    return fn();
  } finally {
    perfEnd(name, start, threshold);
  }
}

function textInputIsActive() {
  const el = document.activeElement;
  return Boolean(el?.matches?.("input, textarea, [contenteditable='true']"));
}

function pauseBackgroundMotionForInput() {
  if (mapState.playing && !mapState.immersive) {
    perfState.playbackPausedForInput = true;
    stopRadarPlayback({ renderStatic: false });
  }
}

function resumeBackgroundMotionAfterInput() {
  if (textInputIsActive() || !perfState.playbackPausedForInput) return;
  perfState.inputFocusCount = 0;
  perfState.playbackPausedForInput = false;
  setTimeout(() => maybeAutoPlayRadar(), 140);
}

function recordInputLatency(name, start, valueLength) {
  if (!perfState.enabled) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      perfRecord("input", name, performance.now() - start, {
        valueLength
      }, PERF_INPUT_WARN_MS);
    });
  });
}

function bindInputResponsiveness(input, name) {
  if (!input || input.dataset.perfResponsive === "1") return;
  input.dataset.perfResponsive = "1";
  input.addEventListener("focus", () => {
    perfState.inputFocusCount = 1;
    pauseBackgroundMotionForInput();
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      perfState.inputFocusCount = textInputIsActive() ? 1 : 0;
      resumeBackgroundMotionAfterInput();
    }, 0);
  });
  input.addEventListener("keydown", () => {
    if (!perfState.enabled) return;
    recordInputLatency(name, performance.now(), input.value.length);
  });
}

const SKY_WORK_MOTION_RELEASE_MS = 260;
const SKY_WORK_MOTION_FALLBACK_RELEASE_MS = 900;
let skyWorkMotionPointerActive = false;
let skyWorkMotionSurfaceActive = false;
let skyWorkMotionFocusActive = false;
let skyWorkMotionReleaseTimer = 0;
let skyWorkMotionFollowUpTimer = 0;
let skyWorkMotionSyncRaf = 0;
let skyWorkMotionObserver = null;
let skyWorkMotionPointerStartedAt = 0;

function skyWorkInteractiveTarget(target) {
  return target?.closest?.([
    "button",
    "a[href]",
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='button']",
    "[role='slider']",
    ".app-menu",
    ".search-popover",
    ".day-sheet",
    ".sheet-backdrop",
    ".map-controls",
    ".map-timeline",
    ".imm-controls",
    ".storm-impact-card",
    ".hour-card",
    ".day-row",
    ".glance-signal",
    ".summary-chip",
    ".launch-shortcut",
    ".daylight-arc"
  ].join(", "));
}

function skyWorkFocusTarget(target) {
  const candidate = target?.closest?.([
    "input",
    "textarea",
    "select",
    "[contenteditable='true']",
    "[role='slider']",
    ".daylight-arc"
  ].join(", "));
  if (!skyWorkTargetIsVisible(candidate)) return null;
  return candidate;
}

function skyWorkTargetIsVisible(target) {
  if (!target?.isConnected) return false;
  if (target.hidden || target.closest?.("[hidden]")) return false;
  if (target.closest?.(".search-popover") && !els.shell?.classList.contains("search-open")) return false;
  if (target.closest?.(".app-menu") && els.appMenu?.hidden) return false;
  return Boolean(target.getClientRects?.().length);
}

function skyWorkSurfaceIsOpen() {
  return Boolean(
    (!els.appMenu?.hidden) ||
    els.shell?.classList.contains("search-open") ||
    document.querySelector(".day-sheet.show:not([hidden])") ||
    document.querySelector(".sheet-backdrop.show:not([hidden])")
  );
}

function syncSkyWorkMotionPause() {
  skyWorkMotionSurfaceActive = skyWorkSurfaceIsOpen();
  skyWorkMotionFocusActive = Boolean(skyWorkFocusTarget(document.activeElement));
  if (
    skyWorkMotionPointerActive &&
    !skyWorkMotionSurfaceActive &&
    !skyWorkMotionFocusActive &&
    Date.now() - skyWorkMotionPointerStartedAt > SKY_WORK_MOTION_RELEASE_MS
  ) {
    skyWorkMotionPointerActive = false;
  }
  const paused = skyWorkMotionPointerActive || skyWorkMotionFocusActive || skyWorkMotionSurfaceActive;
  document.documentElement.classList.toggle("sky-motion-paused-for-app-work", paused);
}

function scheduleSkyWorkMotionSync() {
  if (skyWorkMotionSyncRaf) return;
  skyWorkMotionSyncRaf = requestAnimationFrame(() => {
    skyWorkMotionSyncRaf = 0;
    syncSkyWorkMotionPause();
  });
}

function scheduleSkyWorkMotionFollowUp(delay = SKY_WORK_MOTION_RELEASE_MS + 120) {
  scheduleSkyWorkMotionSync();
  clearTimeout(skyWorkMotionFollowUpTimer);
  skyWorkMotionFollowUpTimer = setTimeout(scheduleSkyWorkMotionSync, delay);
}

function releaseSkyWorkPointerPause(delay = SKY_WORK_MOTION_RELEASE_MS) {
  clearTimeout(skyWorkMotionReleaseTimer);
  skyWorkMotionReleaseTimer = setTimeout(() => {
    skyWorkMotionPointerActive = false;
    syncSkyWorkMotionPause();
  }, delay);
}

function installSkyWorkMotionPause() {
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!skyWorkInteractiveTarget(event.target)) return;
    clearTimeout(skyWorkMotionReleaseTimer);
    skyWorkMotionPointerActive = true;
    skyWorkMotionPointerStartedAt = Date.now();
    syncSkyWorkMotionPause();
    releaseSkyWorkPointerPause(SKY_WORK_MOTION_FALLBACK_RELEASE_MS);
  }, { passive: true, capture: true });

  ["pointerup", "pointercancel", "lostpointercapture", "mouseup", "touchend", "click"].forEach((eventName) => {
    document.addEventListener(eventName, () => releaseSkyWorkPointerPause(), { passive: true, capture: true });
  });

  document.addEventListener("focusin", (event) => {
    skyWorkMotionFocusActive = Boolean(skyWorkFocusTarget(event.target));
    syncSkyWorkMotionPause();
  }, true);

  document.addEventListener("focusout", () => {
    setTimeout(() => {
      skyWorkMotionFocusActive = Boolean(skyWorkFocusTarget(document.activeElement));
      syncSkyWorkMotionPause();
    }, 0);
  }, true);

  ["input", "change", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      if (!skyWorkFocusTarget(event.target)) return;
      skyWorkMotionFocusActive = true;
      syncSkyWorkMotionPause();
      scheduleSkyWorkMotionFollowUp(eventName === "keydown" ? SKY_WORK_MOTION_RELEASE_MS + 180 : undefined);
    }, true);
  });

  skyWorkMotionObserver = new MutationObserver(scheduleSkyWorkMotionSync);
  skyWorkMotionObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "aria-expanded"]
  });

  scheduleSkyWorkMotionSync();
}

function currentPageScrollY() {
  return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function setSheetScrollAnchor(sheet) {
  if (!sheet) return;
  sheet.dataset.pageAnchorY = String(Math.round(currentPageScrollY()));
}

function clearSheetScrollAnchor(sheet) {
  if (!sheet) return;
  delete sheet.dataset.pageAnchorY;
}

function restoreSheetScrollAnchor(sheet) {
  const y = Number(sheet?.dataset?.pageAnchorY);
  if (!Number.isFinite(y) || sheet.hidden || typeof window.scrollTo !== "function") return;
  try {
    window.scrollTo({ top: y, left: 0, behavior: "auto" });
  } catch {
    window.scrollTo(0, y);
  }
}

let sheetInputViewportGuardInstalled = false;
let activeSheetInputGuard = { input: null, sheet: null, raf: 0 };

function visualKeyboardInset() {
  const visual = window.visualViewport;
  if (!visual) return 0;
  const layoutHeight = window.innerHeight || document.documentElement.clientHeight || visual.height;
  const inset = layoutHeight - visual.height - visual.offsetTop;
  return Math.max(0, Math.round(inset));
}

function clearSheetKeyboardGuard(sheet) {
  if (!sheet) return;
  if (activeSheetInputGuard.sheet === sheet) {
    if (activeSheetInputGuard.raf) cancelAnimationFrame(activeSheetInputGuard.raf);
    activeSheetInputGuard = { input: null, sheet: null, raf: 0 };
  }
  sheet.classList.remove("sheet-keyboard-active");
  sheet.style.removeProperty("--sheet-keyboard-inset");
}

function visibleViewportBounds() {
  const visual = window.visualViewport;
  if (!visual) {
    return { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight || 0 };
  }
  return {
    top: Math.max(0, visual.offsetTop || 0),
    bottom: Math.max(0, (visual.offsetTop || 0) + visual.height)
  };
}

function scrollSheetInputIntoView(input, sheet) {
  if (!input || !sheet || sheet.hidden) return;
  const target = input.closest(".ask-form") || input;
  const sheetRect = sheet.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const viewport = visibleViewportBounds();
  const top = Math.max(sheetRect.top, viewport.top) + 12;
  const bottom = Math.min(sheetRect.bottom, viewport.bottom) - 16;
  if (targetRect.bottom > bottom) {
    sheet.scrollTop += targetRect.bottom - bottom;
  } else if (targetRect.top < top) {
    sheet.scrollTop -= top - targetRect.top;
  }
}

function runSheetInputViewportGuard() {
  activeSheetInputGuard.raf = 0;
  const { input, sheet } = activeSheetInputGuard;
  if (!input || !sheet || sheet.hidden || document.activeElement !== input) {
    clearSheetKeyboardGuard(sheet);
    return;
  }
  sheet.classList.add("sheet-keyboard-active");
  sheet.style.setProperty("--sheet-keyboard-inset", `${visualKeyboardInset()}px`);
  restoreSheetScrollAnchor(sheet);
  scrollSheetInputIntoView(input, sheet);
}

function scheduleSheetInputViewportGuard() {
  if (!activeSheetInputGuard.input || activeSheetInputGuard.raf) return;
  activeSheetInputGuard.raf = requestAnimationFrame(runSheetInputViewportGuard);
}

function pulseSheetInputViewportGuard(input, sheet) {
  activeSheetInputGuard.input = input;
  activeSheetInputGuard.sheet = sheet;
  scheduleSheetInputViewportGuard();
  [80, 180, 360, 640].forEach((delay) => {
    setTimeout(() => {
      if (activeSheetInputGuard.input === input) scheduleSheetInputViewportGuard();
    }, delay);
  });
}

function releaseSheetInputViewportGuard(input, sheet) {
  setTimeout(() => {
    if (document.activeElement === input) return;
    if (activeSheetInputGuard.input === input) {
      activeSheetInputGuard = { input: null, sheet: null, raf: 0 };
    }
    clearSheetKeyboardGuard(sheet);
  }, 160);
}

function installSheetInputViewportGuardListeners() {
  if (sheetInputViewportGuardInstalled) return;
  sheetInputViewportGuardInstalled = true;
  const schedule = () => scheduleSheetInputViewportGuard();
  window.addEventListener("resize", schedule, { passive: true });
  const visual = window.visualViewport;
  if (visual) {
    visual.addEventListener("resize", schedule, { passive: true });
    visual.addEventListener("scroll", schedule, { passive: true });
    if ("onscrollend" in visual) {
      visual.addEventListener("scrollend", schedule, { passive: true });
    }
  }
}

function bindSheetInputViewportGuard(input, sheet) {
  if (!input || !sheet || input.dataset.sheetViewportGuard === "1") return;
  input.dataset.sheetViewportGuard = "1";
  installSheetInputViewportGuardListeners();
  const restore = () => {
    pulseSheetInputViewportGuard(input, sheet);
  };
  input.addEventListener("focus", restore);
  input.addEventListener("click", restore);
  input.addEventListener("input", restore);
  input.addEventListener("keyup", restore);
  input.addEventListener("blur", () => releaseSheetInputViewportGuard(input, sheet));
}

let viewportSyncRaf = 0;
let viewportSyncSignature = "";

function viewportDimension(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readViewportGeometry() {
  const root = document.documentElement;
  const visual = window.visualViewport;
  const widthCandidates = [
    viewportDimension(visual?.width),
    viewportDimension(window.innerWidth),
    viewportDimension(root?.clientWidth)
  ].filter((value) => value !== null);
  const heightCandidates = [
    viewportDimension(visual?.height),
    viewportDimension(window.innerHeight),
    viewportDimension(root?.clientHeight)
  ].filter((value) => value !== null);
  return {
    width: Math.ceil(widthCandidates.length ? Math.max(320, ...widthCandidates) : 320),
    height: Math.ceil(heightCandidates.length ? Math.max(...heightCandidates) : 640)
  };
}

function rerenderCurrentSkyForViewport() {
  if (state.skyCode === null || state.theme !== "auto" || textInputIsActive()) return;
  const el = document.getElementById("skyCanvas");
  if (!el) return;
  renderSkyScene(el, state.skyState?.condition || skyCondition(state.skyCode), state.skyState?.isDay ?? state.skyIsDay, state.skyState);
}

function syncViewportGeometry(options = {}) {
  const { force = false, rerenderSky = false } = options;
  const root = document.documentElement;
  const { width, height } = readViewportGeometry();
  const signature = `${width}x${height}`;
  const changed = force || signature !== viewportSyncSignature;
  if (!changed) return false;

  viewportSyncSignature = signature;
  root.style.setProperty("--app-viewport-width", `${width}px`);
  root.style.setProperty("--app-viewport-height", `${height}px`);
  if (rerenderSky) rerenderCurrentSkyForViewport();
  return true;
}

function scheduleViewportGeometrySync(options = {}) {
  if (viewportSyncRaf) cancelAnimationFrame(viewportSyncRaf);
  viewportSyncRaf = requestAnimationFrame(() => {
    viewportSyncRaf = 0;
    syncViewportGeometry(options);
  });
}

function settleViewportGeometry() {
  syncViewportGeometry({ force: true, rerenderSky: true });
  requestAnimationFrame(() => {
    syncViewportGeometry({ force: true, rerenderSky: true });
    requestAnimationFrame(() => syncViewportGeometry({ force: true, rerenderSky: true }));
  });
  [120, 360, 900].forEach((delay) => {
    setTimeout(() => syncViewportGeometry({ force: true, rerenderSky: true }), delay);
  });
}

function initViewportGeometrySync() {
  syncViewportGeometry({ force: true });
  window.addEventListener("resize", () => scheduleViewportGeometrySync({ rerenderSky: true }), { passive: true });
  window.addEventListener("orientationchange", settleViewportGeometry, { passive: true });
  window.addEventListener("pageshow", settleViewportGeometry, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) settleViewportGeometry();
  });

  const visual = window.visualViewport;
  if (visual) {
    visual.addEventListener("resize", () => scheduleViewportGeometrySync({ rerenderSky: true }), { passive: true });
    visual.addEventListener("scroll", () => scheduleViewportGeometrySync(), { passive: true });
    if ("onscrollend" in visual) {
      visual.addEventListener("scrollend", settleViewportGeometry, { passive: true });
    }
  }

  settleViewportGeometry();
}

function pageScrollY() {
  const raw = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  return clamp(raw, 0, maxPageScrollY());
}

function maxPageScrollY() {
  const doc = document.documentElement;
  const body = document.body;
  const contentHeight = Math.max(
    doc?.scrollHeight || 0,
    body?.scrollHeight || 0
  );
  const viewportHeight = window.visualViewport?.height || window.innerHeight || doc?.clientHeight || 0;
  return Math.max(0, contentHeight - viewportHeight);
}

function scheduleFloatingChromeUpdate() {
  if (floatingChromeRaf) return;
  floatingChromeRaf = requestAnimationFrame(() => {
    floatingChromeRaf = 0;
    updateFloatingChrome();
  });
}

function updateFloatingChrome(options = {}) {
  if (!els.shell) return;
  const y = pageScrollY();
  const delta = y - floatingChromeScrollY;
  const menuOpen = els.shell.classList.contains("menu-open");
  const searchOpen = els.shell.classList.contains("search-open");
  const welcome = els.shell.classList.contains("mode-welcome");
  const nearBottom = maxPageScrollY() - y < 96;
  if (delta < 0 && !nearBottom) floatingChromeUpTravel += Math.abs(delta);
  else if (delta > 0) floatingChromeUpTravel = 0;
  else if (nearBottom) floatingChromeUpTravel = 0;

  const shouldReveal = options.forceReveal || welcome || menuOpen || searchOpen || y < 220 || (!nearBottom && floatingChromeUpTravel > 24);
  if (shouldReveal) {
    els.shell.classList.remove("chrome-tucked");
    floatingChromeUpTravel = 0;
  } else if (y > 320 && delta > 2) {
    els.shell.classList.add("chrome-tucked");
  }
  floatingChromeScrollY = y;
}

function init() {
  initPerfDiagnostics();
  initViewportGeometrySync();
  document.getElementById("appVersion").textContent = `v${VERSION}`;
  applyTheme();
  renderSavedPlaces();
  updateUnitButton();
  updateTimeFormatButtons();
  updateReactiveSkyControls();
  updateDebugSettingsVisibility();
  updateMapRendererButtons();
  updateMapDiagnosticModeControl();
  updateRadarSourceZoomControl();
  updateRawMapExperimentControl();
  updateXweatherStormControl();
  loadXweatherStormConfig();
  if (state.mapRenderer === "gl") ensureMapLibreAssets({ renderAfterLoad: true });
  bindEvents();
  initReactiveSkyMotion();
  if ("serviceWorker" in navigator && typeof handleNearcastNotificationMessage === "function") {
    navigator.serviceWorker.addEventListener("message", handleNearcastNotificationMessage);
  }
  initTactileFeedback();
  initInstallPrompt();
  initMetricTipListeners();
  initDaylightScrubListeners();
  scheduleNativeLiveActivityQueryTest();
  detectAI();

  // Returning users open straight to their weather (last viewed → first saved).
  // First-timers get the welcome state to find a place — no arbitrary default.
  const lastPlace = readStorageJson("weather-last-place");
  const deepLinkRoutePlace = queryRoutePlace();
  const notificationRoutePlace = typeof nearcastNotificationRoutePlace === "function"
    ? nearcastNotificationRoutePlace()
    : null;
  const startingPlace = deepLinkRoutePlace && deepLinkRoutePlace.latitude != null
    ? deepLinkRoutePlace
    : notificationRoutePlace && notificationRoutePlace.latitude != null
    ? notificationRoutePlace
    : lastPlace && lastPlace.latitude != null
    ? lastPlace
    : state.savedPlaces.length ? state.savedPlaces[0] : null;
  if (startingPlace) {
    warmStartForecast(startingPlace);
    loadPlace(startingPlace);
  } else {
    updateMode(); // welcome mode
    if (typeof consumeNearcastNotificationRoute === "function") consumeNearcastNotificationRoute();
  }
}

function readStorageJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function userHasWeatherContext() {
  return Boolean(state.activePlace || state.savedPlaces.length || readStorageJson("weather-last-place"));
}

function incrementInstallVisitCount() {
  try {
    const next = Math.min(999, Number(localStorage.getItem(INSTALL_PROMPT_VISIT_COUNT_KEY) || 0) + 1);
    localStorage.setItem(INSTALL_PROMPT_VISIT_COUNT_KEY, String(next));
    installPromptState.visitCount = next;
    return next;
  } catch {
    installPromptState.visitCount = 1;
    return 1;
  }
}

function installPromptAccepted() {
  try {
    return localStorage.getItem(INSTALL_PROMPT_ACCEPTED_KEY) === "yes";
  } catch {
    return false;
  }
}

function markInstallPromptAccepted() {
  try {
    localStorage.setItem(INSTALL_PROMPT_ACCEPTED_KEY, "yes");
  } catch {
    // Install prompting is an enhancement; storage failure should not interrupt weather.
  }
}

function installPromptDismissed() {
  try {
    return Date.now() < Number(localStorage.getItem(INSTALL_PROMPT_DISMISSED_UNTIL_KEY) || 0);
  } catch {
    return false;
  }
}

function snoozeInstallPrompt(durationMs = INSTALL_PROMPT_SNOOZE_MS) {
  try {
    localStorage.setItem(INSTALL_PROMPT_DISMISSED_UNTIL_KEY, String(Date.now() + durationMs));
  } catch {
    // Ignore.
  }
  updateInstallPromptUI();
  refreshPlanAwareLaunchSurfaces();
}

function isNativeNearcastApp() {
  return Boolean(window.NearcastNative?.platform === "ios" || /\bNearcastNative\//.test(navigator.userAgent || ""));
}

function isInstalledPwa() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
    window.navigator?.standalone === true
  );
}

function isIosLikeDevice() {
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

function installPromptEarned() {
  return Boolean(
    state.savedPlaces.length ||
    (Array.isArray(state.planMemories) && state.planMemories.length) ||
    (state.activePlace && state.forecast) ||
    installPromptState.visitCount >= 2
  );
}

function installPromptCanShow() {
  if (isNativeNearcastApp() || isInstalledPwa() || installPromptAccepted() || installPromptDismissed()) return false;
  if (!userHasWeatherContext() || !installPromptEarned()) return false;
  return Boolean(installPromptState.nativePromptAvailable || isIosLikeDevice());
}

function installPromptMode() {
  if (installPromptState.nativePromptAvailable) return "native";
  if (isIosLikeDevice()) return "ios";
  return "manual";
}

function installPromptCopy() {
  const mode = installPromptMode();
  if (mode === "ios") return "Use Share, then Add to Home Screen.";
  if (mode === "native") return "Open faster in a clean app window.";
  return "Add it from your browser menu.";
}

function updateInstallPromptUI() {
  const show = installPromptCanShow();
  if (els.installCard) els.installCard.hidden = !show;
  if (!show) return;
  if (els.installCardCopy) els.installCardCopy.textContent = installPromptCopy();
  if (els.installAction) els.installAction.textContent = installPromptMode() === "native" ? "Add" : "How";
}

function installInstructionSteps() {
  if (installPromptMode() === "ios") {
    return [
      "Open Nearcast in Safari.",
      "Tap the Share button.",
      "Choose Add to Home Screen, then tap Add."
    ];
  }
  return [
    "Open your browser menu.",
    "Choose Install app or Add to Home Screen.",
    "Launch Nearcast from your apps or Home Screen."
  ];
}

function renderInstallSheet() {
  if (!els.installSteps) return;
  const mode = installPromptMode();
  if (els.installSheetContext) {
    els.installSheetContext.textContent = mode === "ios"
      ? "Safari needs one manual step."
      : "Your browser controls the final install step.";
  }
  if (els.installSheetSummary) {
    els.installSheetSummary.textContent = "Add Nearcast for a cleaner full-screen weather app, faster launch, and notification support when your browser allows it.";
  }
  els.installSteps.innerHTML = installInstructionSteps()
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join("");
}

function openInstallSheet() {
  if (!els.installSheet || !els.installBackdrop) return;
  renderInstallSheet();
  els.installBackdrop.hidden = false;
  els.installSheet.hidden = false;
  showSheet(els.installBackdrop, els.installSheet, {
    onPullDismiss: () => closeInstallSheet({ snooze: false }),
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
}

function closeInstallSheet(options = {}) {
  if (!els.installSheet || !els.installBackdrop || els.installSheet.hidden) return;
  if (options.snooze) snoozeInstallPrompt();
  els.installBackdrop.classList.remove("show");
  els.installSheet.classList.remove("show");
  document.body.style.overflow = mapState.immersive ? "hidden" : "";
  setTimeout(() => {
    els.installBackdrop.hidden = true;
    els.installSheet.hidden = true;
  }, 260);
}

async function handleInstallAction() {
  if (isNativeNearcastApp() || isInstalledPwa()) {
    updateInstallPromptUI();
    return;
  }

  const promptEvent = installPromptState.deferredPrompt;
  if (promptEvent) {
    installPromptState.deferredPrompt = null;
    installPromptState.nativePromptAvailable = false;
    updateInstallPromptUI();
    try {
      const promptResult = await promptEvent.prompt();
      const choice = promptResult || (promptEvent.userChoice ? await promptEvent.userChoice.catch(() => null) : null);
      if (choice?.outcome === "accepted") {
        markInstallPromptAccepted();
      } else {
        snoozeInstallPrompt();
      }
    } catch {
      openInstallSheet();
    } finally {
      updateInstallPromptUI();
      refreshPlanAwareLaunchSurfaces();
    }
    return;
  }

  openInstallSheet();
}

function dismissInstallPrompt() {
  snoozeInstallPrompt();
}

function initInstallPrompt() {
  incrementInstallVisitCount();
  window.addEventListener("nearcast-native-ready", () => {
    installPromptState.deferredPrompt = null;
    installPromptState.nativePromptAvailable = false;
    updateInstallPromptUI();
    updateNativeStormActivityDebugControl();
    refreshPlanAwareLaunchSurfaces();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    if (isNativeNearcastApp()) return;
    event.preventDefault();
    installPromptState.deferredPrompt = event;
    installPromptState.nativePromptAvailable = true;
    updateInstallPromptUI();
    refreshPlanAwareLaunchSurfaces();
  });
  window.addEventListener("appinstalled", () => {
    installPromptState.deferredPrompt = null;
    installPromptState.nativePromptAvailable = false;
    markInstallPromptAccepted();
    updateInstallPromptUI();
    refreshPlanAwareLaunchSurfaces();
  });
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", updateInstallPromptUI);
  updateInstallPromptUI();
}

const TAP_MOVE_TOLERANCE = 22;
let clickThroughGuardUntil = 0;

function guardNextClickThrough(durationMs = 450) {
  clickThroughGuardUntil = Math.max(clickThroughGuardUntil, Date.now() + durationMs);
}

function blockGuardedClickThrough(event) {
  if (Date.now() > clickThroughGuardUntil) return;
  clickThroughGuardUntil = 0;
  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
}

const TACTILE_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "[role='button']",
  ".hour-card",
  ".day-row",
  ".summary-strip-item",
  ".for-you-card",
  ".glance-signal.has-detail",
  ".place-item-main",
  ".result-button",
  ".memory-main",
  ".sheet-hour-row",
  ".daylight-arc"
].join(", ");

let tactilePressTarget = null;
let tactilePressPointerId = null;
let tactilePressTimer = 0;

function tactileTargetFromEvent(event) {
  const target = event.target?.closest?.(TACTILE_TARGET_SELECTOR);
  if (!target || !document.body.contains(target)) return null;
  if (target.matches?.(":disabled, [disabled], [aria-disabled='true']")) return null;
  if (target.closest?.("input[type='range'], .tile-map, #weatherMap, .maplibregl-canvas-container")) return null;
  return target;
}

function clearTactilePress(target = tactilePressTarget) {
  if (tactilePressTimer) {
    clearTimeout(tactilePressTimer);
    tactilePressTimer = 0;
  }
  if (target) target.classList.remove("is-touch-pressed");
  if (target === tactilePressTarget) {
    tactilePressTarget = null;
    tactilePressPointerId = null;
  }
}

function initTactileFeedback() {
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = tactileTargetFromEvent(event);
    if (!target) return;
    clearTactilePress();
    tactilePressTarget = target;
    tactilePressPointerId = event.pointerId;
    target.classList.add("is-touch-pressed");
  }, { capture: true, passive: true });

  document.addEventListener("pointerup", (event) => {
    if (tactilePressPointerId !== event.pointerId) return;
    const target = tactilePressTarget;
    tactilePressTimer = setTimeout(() => clearTactilePress(target), 90);
  }, { capture: true, passive: true });

  document.addEventListener("pointercancel", (event) => {
    if (tactilePressPointerId === event.pointerId) clearTactilePress();
  }, { capture: true, passive: true });

  document.addEventListener("scroll", () => clearTactilePress(), { capture: true, passive: true });
}

function bindTapAction(element, action, options = {}) {
  if (!element) return;
  element.classList.add("tap-action-target");
  const { moveTolerance = TAP_MOVE_TOLERANCE, preventDefault = true } = options;
  let tapStart = null;
  let suppressClick = false;

  if (element._tapActionAbort) element._tapActionAbort.abort();
  const abort = new AbortController();
  element._tapActionAbort = abort;

  element.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    tapStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (element.setPointerCapture) {
      try { element.setPointerCapture(event.pointerId); } catch { /* capture can fail after fast taps */ }
    }
  }, { signal: abort.signal });

  element.addEventListener("pointerup", (event) => {
    if (!tapStart || tapStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y);
    tapStart = null;
    if (moved > moveTolerance) return;
    suppressClick = true;
    if (preventDefault && event.cancelable) event.preventDefault();
    action(event);
    setTimeout(() => { suppressClick = false; }, 350);
  }, { signal: abort.signal });

  element.addEventListener("pointercancel", () => { tapStart = null; }, { signal: abort.signal });
  element.addEventListener("click", (event) => {
    if (suppressClick) {
      event.preventDefault();
      return;
    }
    action(event);
  }, { signal: abort.signal });
}

function bindTapDelegate(container, selector, action, options = {}) {
  if (!container) return;
  const { moveTolerance = TAP_MOVE_TOLERANCE, preventDefault = true } = options;
  let tapStart = null;
  let suppressClick = false;

  const matchingTarget = (target) => {
    const match = target?.closest?.(selector);
    return match && container.contains(match) ? match : null;
  };

  container.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = matchingTarget(event.target);
    if (!target) return;
    target.classList.add("tap-action-target");
    tapStart = { x: event.clientX, y: event.clientY, id: event.pointerId, target };
  });

  container.addEventListener("pointerup", (event) => {
    if (!tapStart || tapStart.id !== event.pointerId) return;
    const start = tapStart;
    tapStart = null;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > moveTolerance || !container.contains(start.target)) return;
    suppressClick = true;
    if (preventDefault && event.cancelable) event.preventDefault();
    action(event, start.target);
    setTimeout(() => { suppressClick = false; }, 350);
  });

  container.addEventListener("pointercancel", () => { tapStart = null; });
  container.addEventListener("click", (event) => {
    if (suppressClick) {
      event.preventDefault();
      return;
    }
    const target = matchingTarget(event.target);
    if (target) {
      target.classList.add("tap-action-target");
      action(event, target);
    }
  });
}

function handleLaunchShortcut(action) {
  if (action === "plan") {
    recordForYouSignal("plan");
    openAISheet({ autoBrief: false });
    return;
  }

  const targets = {
    hourly: ".hourly-panel",
    daily: ".daily-panel",
    map: "#mapView"
  };
  const target = document.querySelector(targets[action]);
  if (!target) return;
  if (action === "map" && typeof ensureInlineMapReady === "function") {
    ensureInlineMapReady(true);
  }
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  target.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
}

function stopStormImpactControlEvent(event) {
  if (!event) return;
  if (event.cancelable && event.type === "click") event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
}

function bindStormImpactCardGuards() {
  const card = els.stormImpactCard;
  if (!card || card._stormImpactGuardAbort) return;
  const abort = new AbortController();
  card._stormImpactGuardAbort = abort;
  ["mousedown", "mouseup", "touchstart", "touchmove", "touchend", "pointerdown", "pointerup", "click"].forEach((type) => {
    card.addEventListener(type, stopStormImpactControlEvent, { signal: abort.signal });
  });
}

function dismissStormImpactFromControl(event) {
  stopStormImpactControlEvent(event);
  guardNextClickThrough(800);
  if (typeof cancelStormImpactTap === "function") cancelStormImpactTap();
  if (typeof clearStormImpact === "function") clearStormImpact();
}

function bindEvents() {
  document.addEventListener("click", blockGuardedClickThrough, true);
  installSkyWorkMotionPause();

  els.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = els.placeSearch.value.trim();
    if (!query) return;
    await searchPlaces(query);
  });

  els.placeSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSearchResults();
  });
  bindInputResponsiveness(els.placeSearch, "place-search");
  els.placeSearch.addEventListener("input", () => {
    const query = els.placeSearch.value.trim();
    clearTimeout(searchSuggestTimer);
    if (query.length < 2) {
      searchRequestSeq += 1;
      hideSearchResults();
      return;
    }
    searchSuggestTimer = setTimeout(() => searchPlaces(query, { quiet: true }), 260);
  });

  document.addEventListener("click", (event) => {
    const inSearch = els.searchForm.contains(event.target) || els.searchResults.contains(event.target);
    if (!inSearch) clearSearchResults();
  });
  document.addEventListener("click", (event) => {
    const inMenu = els.appMenu.contains(event.target) || els.appMenuToggle.contains(event.target);
    if (!inMenu) closeAppMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAppMenu();
      toggleSearch(false);
    }
  });

  bindTapAction(els.unitToggle, () => {
    const oldUnit = state.unit;
    state.unit = state.unit === "fahrenheit" ? "celsius" : "fahrenheit";
    localStorage.setItem("weather-unit", state.unit);
    updateUnitButton();
    // Cached glance temps are unit-specific — drop them so chips refetch
    for (const id in glanceData) delete glanceData[id];
    renderSavedPlaces();
    if (state.forecast && state.activePlace) {
      const forecastUnit = state.forecastUnit || oldUnit;
      state.forecast = convertForecastUnits(state.forecast, forecastUnit, state.unit);
      renderForecast(state.forecast, state.activePlace, {
        refreshMap: false,
        refreshSky: false,
        saveContinuity: false,
        refreshTheme: false,
        reason: "unit-toggle"
      });
    } else if (state.activePlace) {
      loadPlace(state.activePlace);
    }
  });

  bindTapAction(els.themeToggle, toggleTheme);
  bindTapAction(els.reactiveSkyToggle, toggleReactiveSky);
  bindTapAction(els.reactiveSkyMotionButton, toggleReactiveSkyDeviceMotion);
  bindTapAction(els.reactiveSkyLabReset, resetReactiveSkyPose);
  els.timeFormatButtons.forEach((button) => {
    bindTapAction(button, () => setTimeFormatPreference(button.dataset.timeFormat));
  });
  els.mapRendererButtons.forEach((button) => {
    bindTapAction(button, () => setMapRendererPreference(button.dataset.mapRenderer));
  });
  if (els.mapDiagnosticMode) {
    els.mapDiagnosticMode.addEventListener("change", () => setMapDiagnosticMode(els.mapDiagnosticMode.value));
  }
  if (els.radarProvider) {
    els.radarProvider.addEventListener("change", () => setRadarProvider(els.radarProvider.value));
  }
  if (els.radarSourceZoom) {
    els.radarSourceZoom.addEventListener("change", () => setRadarSourceZoom(els.radarSourceZoom.value));
  }
  if (els.rawMapMode) {
    els.rawMapMode.addEventListener("change", () => setRawMapExperimentMode(els.rawMapMode.value));
  }
  if (els.xweatherStormMode) {
    els.xweatherStormMode.addEventListener("change", () => setXweatherStormMode(els.xweatherStormMode.value));
  }
  bindTapAction(els.nativeLiveActivityOpen, openLiveActivityLab);
  bindTapAction(els.liveActivityBackdrop, closeLiveActivityLab);
  bindTapAction(els.liveActivityClose, closeLiveActivityLab);
  bindLiveActivityLabActions();
  els.briefing.addEventListener("click", (event) => {
    const planShow = event.target.closest("[data-plan-brief-show]");
    if (planShow) {
      openPlanWatchForMemory(planShow.dataset.planBriefShow);
      return;
    }
    const memoryOpen = event.target.closest("[data-memory-open]");
    if (memoryOpen) {
      openGlobalMemorySheet();
      return;
    }
    const btn = event.target.closest("[data-ai]");
    if (!btn) return;
    const action = btn.dataset.ai;
    if (action === "enable") enableAI();
    else if (action === "brief") runBrief();
    else if (action === "stop" && aiBriefAbort) aiBriefAbort.aborted = true;
    else if (action === "copy-report") copySupportReport();
  });
  bindTapDelegate(els.planPulse, "[data-memory-show], [data-memory-edit], [data-memory-open], [data-plan-brief-show]", (event, target) => {
    const memoryOpen = target.closest("[data-memory-open]");
    if (memoryOpen) {
      openGlobalMemorySheet();
      return;
    }
    const memoryShow = target.closest("[data-memory-show]");
    if (memoryShow) {
      openPlanWatchForMemory(memoryShow.dataset.memoryShow);
      return;
    }
    const memoryEdit = target.closest("[data-memory-edit]");
    if (memoryEdit) {
      startPlanMemoryEdit(memoryEdit.dataset.memoryEdit);
      return;
    }
    const planShow = target.closest("[data-plan-brief-show]");
    if (planShow) {
      openPlanWatchForMemory(planShow.dataset.planBriefShow);
    }
  }, { preventDefault: false });
  bindTapDelegate(els.forYouToday, "[data-for-you-summary], [data-for-you-ask], [data-for-you-template], [data-for-you-install], [data-memory-show], [data-memory-edit], [data-memory-open], [data-plan-brief-show]", (event, target) => {
    const signal = target.dataset.forYouSignal;
    if (signal) recordForYouSignal(signal);

    const summary = target.closest("[data-for-you-summary]");
    if (summary) {
      if (!signal) recordForYouSignal("launch-summary");
      openLaunchSummaryDetail(Number(summary.dataset.forYouSummary));
      return;
    }
    const ask = target.closest("[data-for-you-ask]");
    if (ask) {
      openAISheet({ autoBrief: false });
      requestAnimationFrame(() => {
        if (typeof clearPlannerMemoryEdit === "function") clearPlannerMemoryEdit();
        if (typeof renderAsk === "function") renderAsk();
        runAsk(ask.dataset.forYouQ, ask.dataset.forYouIntent);
      });
      return;
    }
    const template = target.closest("[data-for-you-template]");
    if (template) {
      openAISheet({ autoBrief: false });
      requestAnimationFrame(() => {
        if (typeof clearPlannerMemoryEdit === "function") clearPlannerMemoryEdit();
        if (typeof renderAsk === "function") renderAsk();
        fillPlannerTemplate(template.dataset.forYouTemplate || "");
      });
      return;
    }
    const install = target.closest("[data-for-you-install]");
    if (install) {
      if (!signal) recordForYouSignal("install");
      handleInstallAction();
      return;
    }
    const memoryOpen = target.closest("[data-memory-open]");
    if (memoryOpen) {
      if (!signal) recordForYouSignal("memory-open");
      openGlobalMemorySheet();
      return;
    }
    const memoryShow = target.closest("[data-memory-show]");
    if (memoryShow) {
      if (!signal) recordForYouSignal("memory-show");
      openPlanWatchForMemory(memoryShow.dataset.memoryShow);
      return;
    }
    const memoryEdit = target.closest("[data-memory-edit]");
    if (memoryEdit) {
      if (!signal) recordForYouSignal("memory-edit");
      startPlanMemoryEdit(memoryEdit.dataset.memoryEdit);
      return;
    }
    const planShow = target.closest("[data-plan-brief-show]");
    if (planShow) {
      if (!signal) recordForYouSignal("memory-show");
      openPlanWatchForMemory(planShow.dataset.planBriefShow);
    }
  }, { preventDefault: false });
  bindTapDelegate(els.launchShortcuts, "[data-launch-jump]", (event, target) => {
    handleLaunchShortcut(target.dataset.launchJump);
  }, { preventDefault: false });
  bindTapDelegate(els.aiAsk, "[data-ask-show], [data-ask-clarify], [data-ask-template], [data-ask-q], [data-memory-open], [data-memory-remember], [data-memory-detail], [data-memory-show], [data-memory-forget], [data-memory-edit]", (event, target) => {
    const memoryOpen = target.closest("[data-memory-open]");
    if (memoryOpen) {
      openGlobalMemorySheet();
      return;
    }
    const remember = target.closest("[data-memory-remember]");
    if (remember) {
      rememberPlanFromThread(Number(remember.dataset.memoryRemember));
      return;
    }
    const memoryDetail = target.closest("[data-memory-detail]");
    if (memoryDetail) {
      openMemoryDetail(memoryDetail.dataset.memoryDetail);
      return;
    }
    const memoryShow = target.closest("[data-memory-show]");
    if (memoryShow) {
      openPlanWatchForMemory(memoryShow.dataset.memoryShow);
      return;
    }
    const memoryForget = target.closest("[data-memory-forget]");
    if (memoryForget) {
      forgetPlanMemory(memoryForget.dataset.memoryForget);
      return;
    }
    const memoryEdit = target.closest("[data-memory-edit]");
    if (memoryEdit) {
      startPlanMemoryEdit(memoryEdit.dataset.memoryEdit);
      return;
    }
    const show = target.closest("[data-ask-show]");
    if (show) {
      showPlannerEvent(Number(show.dataset.askShow));
      return;
    }
    const clarify = target.closest("[data-ask-clarify]");
    if (clarify) {
      runPlannerClarification(Number(clarify.dataset.askClarify));
      return;
    }
    const template = target.closest("[data-ask-template]");
    if (template) {
      clearPlannerMemoryEdit();
      fillPlannerTemplate(template.dataset.askTemplate);
      return;
    }
    const chip = target.closest("[data-ask-q]");
    if (chip) {
      clearPlannerMemoryEdit();
      runAsk(chip.dataset.askQ, chip.dataset.askIntent);
    }
  }, { preventDefault: false });
  els.aiAsk.addEventListener("submit", (event) => {
    if (event.target.id !== "askForm") return;
    event.preventDefault();
    submitAskForm();
  });
  bindTapAction(els.aiLauncher, openAISheet);
  bindTapAction(els.aiBackdrop, closeAISheet);
  bindTapAction(document.getElementById("aiSheetClose"), closeAISheet);
  bindTapAction(document.getElementById("memorySheetClose"), closeGlobalMemorySheet);
  bindTapAction(els.memoryBackdrop, closeGlobalMemorySheet);
  bindTapDelegate(els.memorySheetBody, "[data-memory-detail], [data-memory-hourly], [data-memory-show], [data-memory-forget], [data-memory-edit], [data-memory-new], [data-watch-notify], [data-place-watch-notify], [data-place-watch-toggle], [data-notification-place]", (event, target) => {
    const notificationPlace = target.closest("[data-notification-place]");
    if (notificationPlace) {
      const place = state.savedPlaces.find((item) => item.id === notificationPlace.dataset.notificationPlace);
      if (place) {
        closeGlobalMemorySheet();
        loadPlace(place);
      }
      return;
    }
    const watchNotify = target.closest("[data-watch-notify]");
    if (watchNotify) {
      if (typeof requestPlanWatchNotifications === "function") {
        requestPlanWatchNotifications(watchNotify.dataset.watchNotify || "");
      }
      return;
    }
    const placeWatchNotify = target.closest("[data-place-watch-notify]");
    if (placeWatchNotify) {
      if (typeof requestPlaceWatchNotifications === "function") {
        requestPlaceWatchNotifications();
      }
      return;
    }
    const placeWatchToggle = target.closest("[data-place-watch-toggle]");
    if (placeWatchToggle) {
      if (typeof togglePlaceWatchNotificationPlace === "function") {
        togglePlaceWatchNotificationPlace(placeWatchToggle.dataset.placeWatchToggle);
      }
      return;
    }
    const memoryNew = target.closest("[data-memory-new]");
    if (memoryNew) {
      closeGlobalMemorySheet();
      openAISheet({ autoBrief: false });
      requestAnimationFrame(() => fillPlannerTemplate(""));
      return;
    }
    const memoryHourly = target.closest("[data-memory-hourly]");
    if (memoryHourly) {
      closeGlobalMemorySheet();
      if (typeof openPlanMemoryWindowDetail === "function" && openPlanMemoryWindowDetail(memoryHourly.dataset.memoryHourly)) return;
      showPlanMemory(memoryHourly.dataset.memoryHourly);
      return;
    }
    const memoryDetail = target.closest("[data-memory-detail]");
    if (memoryDetail) {
      openMemoryDetail(memoryDetail.dataset.memoryDetail);
      return;
    }
    const memoryShow = target.closest("[data-memory-show]");
    if (memoryShow) {
      openPlanWatchForMemory(memoryShow.dataset.memoryShow);
      return;
    }
    const memoryForget = target.closest("[data-memory-forget]");
    if (memoryForget) {
      forgetPlanMemory(memoryForget.dataset.memoryForget);
      return;
    }
    const memoryEdit = target.closest("[data-memory-edit]");
    if (memoryEdit) {
      closeGlobalMemorySheet();
      startPlanMemoryEdit(memoryEdit.dataset.memoryEdit);
    }
  });
  bindTapAction(document.getElementById("memoryEditClose"), closeMemoryEditSheet);
  bindTapAction(els.memoryEditBackdrop, closeMemoryEditSheet);
  bindTapAction(document.getElementById("memoryDetailClose"), closeMemoryDetail);
  bindTapAction(document.getElementById("memoryDetailBackdrop"), closeMemoryDetail);
  bindTapDelegate(els.memoryDetailBody, "[data-memory-hourly], [data-memory-day-hourly], [data-memory-show], [data-memory-forget], [data-memory-edit]", (event, target) => {
    const memoryDayHourly = target.closest("[data-memory-day-hourly]");
    if (memoryDayHourly) {
      closeMemoryDetail();
      showPlanMemory(memoryDayHourly.dataset.memoryDayHourly);
      return;
    }
    const memoryHourly = target.closest("[data-memory-hourly]");
    if (memoryHourly) {
      if (typeof openPlanMemoryWindowDetail === "function" && openPlanMemoryWindowDetail(memoryHourly.dataset.memoryHourly)) return;
      closeMemoryDetail();
      showPlanMemory(memoryHourly.dataset.memoryHourly);
      return;
    }
    const memoryShow = target.closest("[data-memory-show]");
    if (memoryShow) {
      closeMemoryDetail();
      openPlanWatchForMemory(memoryShow.dataset.memoryShow);
      return;
    }
    const memoryForget = target.closest("[data-memory-forget]");
    if (memoryForget) {
      forgetPlanMemory(memoryForget.dataset.memoryForget);
      refreshOpenMemoryDetail();
      return;
    }
    const memoryEdit = target.closest("[data-memory-edit]");
    if (memoryEdit) {
      startPlanMemoryEdit(memoryEdit.dataset.memoryEdit);
    }
  });
  bindTapAction(els.appMenuToggle, () => toggleAppMenu());
  bindTapAction(els.manualRefresh, triggerManualRefresh);
  bindTapAction(els.searchToggle, () => {
    closeAppMenu();
    toggleSearch(true);
  });
  bindTapAction(els.searchClose, () => toggleSearch(false));
  bindTapAction(els.placeSwitcher, () => {
    closeAppMenu();
    openPlaceSheet();
  });
  bindTapAction(els.launchPlaceButton, () => {
    if (state.activePlace || state.savedPlaces.length) openPlaceSheet();
  });
  bindTapAction(els.placeBackdrop, closePlaceSheet);
  bindTapAction(document.getElementById("placeSheetClose"), closePlaceSheet);
  bindTapDelegate(els.savedPlaces, "[data-place-watch-notify]", () => {
    if (typeof requestPlaceWatchNotifications === "function") {
      requestPlaceWatchNotifications();
    }
  });
  bindTapDelegate(els.savedPlaces, "[data-place-watch-toggle]", (event, target) => {
    if (typeof togglePlaceWatchNotificationPlace === "function") {
      togglePlaceWatchNotificationPlace(target.dataset.placeWatchToggle);
    }
  });
  bindTapAction(els.placeWelcomeButton, showWelcomeFromPlaces);
  bindTapAction(els.glanceDetailClose, closeGlanceDetail);
  bindTapAction(els.glanceDetailBackdrop, closeGlanceDetail);
  bindTapAction(els.welcomeLocate, useCurrentLocation);
  bindTapAction(els.welcomeAmbientLabel, handleWelcomeAmbientChip);
  bindTapAction(els.installAction, handleInstallAction);
  bindTapAction(els.installDismiss, dismissInstallPrompt);
  bindTapAction(els.installSheetClose, closeInstallSheet);
  bindTapAction(els.installSheetPrimary, closeInstallSheet);
  bindTapAction(els.installSheetSnooze, () => closeInstallSheet({ snooze: true }));
  bindTapAction(els.installBackdrop, () => closeInstallSheet({ snooze: false }));
  bindTapAction(document.getElementById("searchLocate"), () => {
    toggleSearch(false);
    useCurrentLocation();
  });
  bindTapAction(document.getElementById("nowcast"), openNext24Detail);

  // Refresh stale data and reset stale drill-in views when reopened/foregrounded.
  document.addEventListener("visibilitychange", handleVisibilityResume);
  window.addEventListener("pagehide", noteBackgrounded);
  window.addEventListener("pageshow", handleForegroundResume);
  window.addEventListener("focus", handleForegroundResume);
  window.addEventListener("scroll", scheduleFloatingChromeUpdate, { passive: true });
  initPullToRefresh();
  bindTapAction(els.placeSaveButton, () => {
    if (!state.activePlace) return;
    const alreadySaved = state.savedPlaces.some((place) => place.id === state.activePlace.id);
    if (alreadySaved) return;
    savePlace(state.activePlace);
  });
  bindTapAction(els.radarMode, () => setMapMode("radar"));
  bindTapAction(els.futureMode, () => setMapMode("future"));
  bindTapAction(els.zoomOutMap, () => setMapZoom(mapState.zoom - 1));
  bindTapAction(els.zoomInMap, () => setMapZoom(mapState.zoom + 1));
  bindTapAction(els.playRadar, toggleRadarPlayback);
  bindStormImpactCardGuards();
  bindTapAction(els.stormImpactClose, dismissStormImpactFromControl);
  els.frameSlider.addEventListener("pointerdown", beginStandardTimelineScrub);
  els.frameSlider.addEventListener("input", () => scrubToFrame(Number(els.frameSlider.value)));
  els.frameSlider.addEventListener("change", settleStandardTimelineScrub);
  els.frameSlider.addEventListener("pointerup", settleStandardTimelineScrub);
  els.frameSlider.addEventListener("pointercancel", settleStandardTimelineScrub);
  els.frameSlider.addEventListener("blur", settleStandardTimelineScrub);
  bindTapAction(document.getElementById("expandMap"), enterImmersiveMap);

  // Day-detail drill-down: tap a 10-day row or the hourly strip
  bindTapDelegate(els.daily, ".day-row", (event, row) => {
    if (row && row.dataset.index !== undefined) openDayFromIndex(Number(row.dataset.index));
  });
  els.daily.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".day-row");
    if (row && row.dataset.index !== undefined) {
      event.preventDefault();
      openDayFromIndex(Number(row.dataset.index));
    }
  });
  bindTapDelegate(els.nowSummary, "[data-summary-index]", (event, target) => {
    openLaunchSummaryDetail(Number(target.dataset.summaryIndex));
  }, { preventDefault: false });
  bindTapDelegate(els.hourly, ".hour-card", (event, card) => {
    openHourlyStripDetail(Number(card.dataset.hourIndex));
  }, { moveTolerance: 14 });
  els.hourly.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".hour-card");
    if (!card) return;
    event.preventDefault();
    openHourlyStripDetail(Number(card.dataset.hourIndex));
  });
  bindTapAction(document.getElementById("sheetGraphMode"), () => setDayDetailMode("graph"));
  bindTapAction(document.getElementById("sheetHourlyMode"), () => setDayDetailMode("hourly"));
  bindTapAction(document.getElementById("sheetPrevDay"), () => navigateSheetDay(-1));
  bindTapAction(document.getElementById("sheetNextDay"), () => navigateSheetDay(1));
  bindTapAction(document.getElementById("sheetNowJump"), scrollDayDetailToNow);
  document.getElementById("dayDetail").addEventListener("scroll", handleDayDetailScroll, { passive: true });
  const sheetHourlyList = document.getElementById("sheetHourlyList");
  bindTapDelegate(sheetHourlyList, ".sheet-hour-alert-divider", (event, alertDivider) => {
    const alertKey = alertDivider.dataset.alertKey || "";
    const opened = openAlertSheet(alertKey, { returnFocus: alertDivider });
    if (!opened && typeof refreshOpenDayDetailMemorySurfaces === "function") {
      refreshOpenDayDetailMemorySurfaces();
      document.getElementById("dayDetailClose")?.focus({ preventScroll: true });
    }
  }, { moveTolerance: 14 });
  bindTapDelegate(sheetHourlyList, ".sheet-hour-row", (event, row) => {
    const memoryDetail = event.target.closest("[data-memory-detail]");
    if (memoryDetail) {
      openMemoryDetail(memoryDetail.dataset.memoryDetail);
      return;
    }
    toggleSheetHourRow(row);
  });
  sheetHourlyList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const memoryDetail = event.target.closest("[data-memory-detail]");
    if (memoryDetail) {
      event.preventDefault();
      openMemoryDetail(memoryDetail.dataset.memoryDetail);
      return;
    }
    const row = event.target.closest(".sheet-hour-row");
    if (!row) return;
    event.preventDefault();
    toggleSheetHourRow(row);
  });
  bindTapDelegate(document.getElementById("sheetGraph"), "[data-memory-detail]", (event, target) => {
    openMemoryDetail(target.dataset.memoryDetail);
  }, { moveTolerance: 10 });
  document.getElementById("sheetGraph").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const memoryDetail = event.target.closest("[data-memory-detail]");
    if (!memoryDetail) return;
    event.preventDefault();
    openMemoryDetail(memoryDetail.dataset.memoryDetail);
  });
  bindTapAction(document.getElementById("graphTempBtn"), () => setGraphMetric("temp"));
  bindTapAction(document.getElementById("graphWindBtn"), () => setGraphMetric("wind"));
  bindTapAction(document.getElementById("graphSunBtn"), () => setGraphMetric("sun"));
  bindTapAction(document.getElementById("dayDetailClose"), closeDayDetail);
  bindTapAction(document.getElementById("dayDetailBackdrop"), closeDayDetail);
  document.addEventListener("keydown", (event) => {
    const sheet = document.getElementById("dayDetail");
    if (event.key === "Escape" && !sheet.hidden && isTopmostShownSheet(sheet)) closeDayDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.placeSheet.hidden) closePlaceSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.glanceDetailSheet.hidden) closeGlanceDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.installSheet && !els.installSheet.hidden) {
      event.stopImmediatePropagation();
      closeInstallSheet();
    }
  });

  // Severe weather alerts
  const alertBar = document.getElementById("alertBar");
  bindTapAction(alertBar, () => openAlertSheet(null, { returnFocus: alertBar }));
  bindTapAction(document.getElementById("alertSheetClose"), closeAlertSheet);
  bindTapAction(document.getElementById("alertBackdrop"), closeAlertSheet);
  document.addEventListener("keydown", (event) => {
    const sheet = document.getElementById("alertSheet");
    if (event.key === "Escape" && !sheet.hidden && isTopmostShownSheet(sheet)) {
      event.stopImmediatePropagation();
      closeAlertSheet();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.memoryDetailSheet.hidden) {
      event.stopImmediatePropagation();
      closeMemoryDetail();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.memorySheet.hidden) {
      event.stopImmediatePropagation();
      closeGlobalMemorySheet();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.memoryEditSheet.hidden) {
      event.stopImmediatePropagation();
      closeMemoryEditSheet();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.aiSheet.hidden) closeAISheet();
  });
}

function applyTheme(options = {}) {
  const { rerenderSky = true, rerenderMap = true } = options;
  let isDark;
  if (state.theme === "auto") {
    if (state.locationIsDay !== null) {
      isDark = !state.locationIsDay;
    } else if (state.sunriseMs && state.sunsetMs) {
      const now = Date.now();
      isDark = now < state.sunriseMs || now > state.sunsetMs;
    } else {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  } else {
    isDark = state.theme === "dark";
  }
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  els.themeToggle.textContent = isDark ? "☽" : "☀︎";
  els.themeToggle.title = state.theme === "auto"
    ? (isDark ? "Night mode (auto) — click to force light" : "Day mode (auto) — click to force dark")
    : (isDark ? "Dark mode (manual) — click to reset to auto" : "Light mode (manual) — click to reset to auto");

  if (rerenderSky) {
    if (state.skyCode !== null) {
      updateSkyCanvas(
        state.skyCode,
        state.skyIsDay,
        state.skyData || state.forecast,
        state.skyDisplayCondition
      );
    } else {
      if (state.theme !== "auto") clearSkyCanvas();
      else updateSkyChrome(null, null);
    }
  }

  if (rerenderMap && mapState.initialized && state.activePlace) {
    renderTileMap();
  }
  scheduleReactiveSkyMotionSync();
}

function toggleTheme() {
  if (state.theme === "auto") {
    const currentlyDark = document.documentElement.dataset.theme === "dark";
    state.theme = currentlyDark ? "light" : "dark";
  } else {
    state.theme = "auto";
  }
  localStorage.setItem("weather-theme", state.theme);
  applyTheme();
}

function reactiveSkyIsCurrentLocation(place = state.activePlace) {
  const id = String(place?.id || "").toLowerCase();
  return id.startsWith("gps-") || id === "device-location";
}

function reactiveSkyNativeMotionBridge() {
  const bridge = window.NearcastNative?.ambientMotion;
  return bridge && bridge.supported !== false && typeof bridge.start === "function" ? bridge : null;
}

function reactiveSkyWebMotionSupported() {
  return typeof window.DeviceOrientationEvent !== "undefined";
}

function reactiveSkyMotionSupported() {
  return Boolean(reactiveSkyNativeMotionBridge() || reactiveSkyWebMotionSupported());
}

function reactiveSkyReducedMotion() {
  return Boolean(reactiveSkyMotionState.mediaQuery?.matches || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function reactiveSkyWeatherCanRespond() {
  const sky = state.skyState;
  if (!sky || state.theme !== "auto") return false;
  const condition = String(sky.condition || "");
  if ((sky.activePrecip || sky.precipPhase === "active") && ["rain", "thunder"].includes(condition)) return true;
  if (Number(sky.cloud) >= 12 || Number(sky.lowCloud) >= 8) return true;
  return ["rain", "thunder", "fog", "cloudy", "partly-cloudy"].includes(condition);
}

function reactiveSkyWorkIsPaused() {
  const root = document.documentElement;
  return root.classList.contains("sky-motion-paused-for-map") ||
    root.classList.contains("sky-motion-paused-for-app-work") ||
    Boolean(mapState.immersive);
}

function reactiveSkyMotionShouldRun() {
  return Boolean(
    state.reactiveSkyEnabled &&
    state.reactiveSkyMotionAllowed &&
    reactiveSkyIsCurrentLocation() &&
    reactiveSkyMotionSupported() &&
    !document.hidden &&
    !reactiveSkyReducedMotion() &&
    !reactiveSkyWorkIsPaused() &&
    reactiveSkyWeatherCanRespond()
  );
}

function reactiveSkyMotionIdleStatus() {
  if (!state.reactiveSkyEnabled || !state.reactiveSkyMotionAllowed) return "idle";
  if (!reactiveSkyIsCurrentLocation()) return "location";
  if (!reactiveSkyMotionSupported()) return "unsupported";
  if (reactiveSkyReducedMotion()) return "reduced";
  if (document.hidden || reactiveSkyWorkIsPaused()) return "paused";
  if (!reactiveSkyWeatherCanRespond()) return "standby";
  const needsWebGesture = !reactiveSkyNativeMotionBridge() &&
    typeof window.DeviceOrientationEvent?.requestPermission === "function" &&
    !reactiveSkyMotionState.webPermissionGranted;
  return needsWebGesture ? "reconnect" : "ready";
}

function setReactiveSkyMotionStatus(status) {
  if (reactiveSkyMotionState.status === status) return;
  reactiveSkyMotionState.status = status;
  updateReactiveSkyControls();
}

function reactiveSkyMotionMetaText() {
  if (!reactiveSkyIsCurrentLocation()) return "Available at Current Location";
  switch (reactiveSkyMotionState.status) {
    case "requesting": return "Waiting for permission…";
    case "active": return "Rain and clouds respond as you turn";
    case "paused": return "Paused while the sky is covered";
    case "standby": return "Ready when rain or low clouds appear";
    case "reduced": return "Off while Reduce Motion is enabled";
    case "denied": return "Not allowed · weather motion still works";
    case "inaccurate": return "Compass signal is too uncertain";
    case "reconnect": return "Tap to reconnect on this device";
    case "unsupported": return "Unavailable · weather motion still works";
    case "ready": return "Ready to respond when weather is visible";
    default: return "Optional · processed on this device";
  }
}

function updateReactiveSkyLab() {
  if (!els.reactiveSkyLabMeta) return;
  if (!state.reactiveSkyEnabled) {
    els.reactiveSkyLabMeta.textContent = "Experiment off";
    return;
  }
  const sky = state.skyState;
  const sample = reactiveSkyMotionState.lastSample;
  const rawFrom = sky?.windDirectionDeg ?? sky?.windDirection;
  const rawToward = sky?.windTravelDeg;
  const from = rawFrom == null ? NaN : Number(rawFrom);
  const toward = rawToward == null ? NaN : Number(rawToward);
  const pieces = [String(sky?.condition || "waiting")];
  if (Number.isFinite(from)) pieces.push(`${Math.round(from)}° from`);
  if (Number.isFinite(toward)) pieces.push(`${Math.round(toward)}° toward`);
  if (Number.isFinite(sample?.heading)) pieces.push(`facing ${Math.round(sample.heading)}°`);
  pieces.push(reactiveSkyMotionState.status);
  els.reactiveSkyLabMeta.textContent = pieces.join(" · ");
}

function updateReactiveSkyControls() {
  const enabled = state.reactiveSkyEnabled === true;
  if (els.reactiveSkyToggle) {
    els.reactiveSkyToggle.textContent = enabled ? "On" : "Off";
    els.reactiveSkyToggle.setAttribute("aria-pressed", String(enabled));
  }
  if (els.reactiveSkyMeta) {
    els.reactiveSkyMeta.textContent = enabled
      ? "Wind shapes rain and low clouds"
      : "Off · the current sky stays unchanged";
  }
  if (els.reactiveSkyMotionSetting) els.reactiveSkyMotionSetting.hidden = !enabled;
  if (els.reactiveSkyMotionButton) {
    const allowed = state.reactiveSkyMotionAllowed === true;
    els.reactiveSkyMotionButton.textContent = allowed ? "Turn off" : "Allow motion";
    els.reactiveSkyMotionButton.setAttribute("aria-pressed", String(allowed));
    els.reactiveSkyMotionButton.disabled = reactiveSkyMotionState.requestInFlight ||
      (!allowed && (!reactiveSkyIsCurrentLocation() || !reactiveSkyMotionSupported()));
  }
  if (els.reactiveSkyMotionMeta) els.reactiveSkyMotionMeta.textContent = reactiveSkyMotionMetaText();
  updateReactiveSkyLab();
}

function rerenderReactiveSky() {
  if (state.skyCode !== null && typeof updateSkyCanvas === "function") {
    updateSkyCanvas(state.skyCode, state.skyIsDay, state.skyData || state.forecast, state.skyDisplayCondition);
  }
}

function toggleReactiveSky() {
  state.reactiveSkyEnabled = !state.reactiveSkyEnabled;
  localStorage.setItem(REACTIVE_SKY_KEY, state.reactiveSkyEnabled ? "1" : "0");
  updateReactiveSkyControls();
  if (!state.reactiveSkyEnabled) stopReactiveSkyMotion("idle");
  rerenderReactiveSky();
  scheduleReactiveSkyMotionSync();
}

function normalizeReactiveSkyHeading(value) {
  if (value === null || value === undefined || value === "") return null;
  const heading = Number(value);
  return Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null;
}

function reactiveSkyWebHeading(event) {
  const webkitHeading = normalizeReactiveSkyHeading(event?.webkitCompassHeading);
  if (webkitHeading !== null) return webkitHeading;
  if (event?.absolute !== true) return null;
  const alpha = Number(event?.alpha);
  return Number.isFinite(alpha) ? normalizeReactiveSkyHeading(360 - alpha) : null;
}

function acceptReactiveSkyPose(detail, source = "web") {
  const now = Date.now();
  if (now - reactiveSkyMotionState.lastAcceptedAt < REACTIVE_SKY_SAMPLE_INTERVAL_MS) return false;
  if (!reactiveSkyMotionShouldRun()) return false;

  const timestamp = Number(detail?.timestamp);
  if (Number.isFinite(timestamp) && Math.abs(now - timestamp) > REACTIVE_SKY_HEADING_MAX_AGE_MS) return false;
  if (detail?.headingReference === "unavailable") return false;
  const heading = normalizeReactiveSkyHeading(detail?.heading);
  if (heading === null) return false;
  const accuracy = Number(detail?.headingAccuracy ?? detail?.accuracy);
  if (Number.isFinite(accuracy) && (accuracy < 0 || accuracy > REACTIVE_SKY_HEADING_ACCURACY_MAX)) {
    clearTimeout(reactiveSkyMotionState.sampleExpiryTimer);
    reactiveSkyMotionState.lastSample = null;
    window.nearcastSetAmbientPose?.({ active: false });
    setReactiveSkyMotionStatus("inaccurate");
    return false;
  }

  const pose = {
    active: true,
    heading,
    pitch: Number.isFinite(Number(detail?.pitch)) ? Number(detail.pitch) : 0,
    roll: Number.isFinite(Number(detail?.roll)) ? Number(detail.roll) : 0,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    timestamp: Number.isFinite(timestamp) ? timestamp : now,
    source
  };
  reactiveSkyMotionState.lastAcceptedAt = now;
  reactiveSkyMotionState.lastSample = pose;
  clearTimeout(reactiveSkyMotionState.sampleExpiryTimer);
  reactiveSkyMotionState.sampleExpiryTimer = setTimeout(() => {
    if (Date.now() - reactiveSkyMotionState.lastAcceptedAt < REACTIVE_SKY_HEADING_MAX_AGE_MS) return;
    reactiveSkyMotionState.lastSample = null;
    window.nearcastSetAmbientPose?.({ active: false });
    setReactiveSkyMotionStatus(reactiveSkyMotionState.started ? "ready" : reactiveSkyMotionIdleStatus());
  }, REACTIVE_SKY_HEADING_MAX_AGE_MS + 80);
  window.nearcastSetAmbientPose?.(pose);
  setReactiveSkyMotionStatus("active");
  if (els.reactiveSkyLabMeta && now - reactiveSkyMotionState.lastSampleAt > 480) updateReactiveSkyLab();
  reactiveSkyMotionState.lastSampleAt = now;
  return true;
}

function handleReactiveSkyWebOrientation(event) {
  const heading = reactiveSkyWebHeading(event);
  if (heading === null) return;
  acceptReactiveSkyPose({
    heading,
    headingReference: Number.isFinite(Number(event.webkitCompassHeading)) ? "magnetic" : "true",
    headingAccuracy: Number(event.webkitCompassAccuracy),
    pitch: Number(event.beta) * Math.PI / 180,
    roll: Number(event.gamma) * Math.PI / 180,
    timestamp: Date.now()
  }, "web");
}

function handleReactiveSkyNativeMotion(event) {
  const detail = event?.detail || {};
  if (detail.active === false) {
    clearTimeout(reactiveSkyMotionState.sampleExpiryTimer);
    reactiveSkyMotionState.started = false;
    reactiveSkyMotionState.source = "none";
    reactiveSkyMotionState.lastSample = null;
    window.nearcastSetAmbientPose?.({ active: false });
    setReactiveSkyMotionStatus(reactiveSkyMotionIdleStatus());
    scheduleReactiveSkyMotionSync();
    return;
  }
  if (detail.kind === "sample") acceptReactiveSkyPose(detail, "native");
}

function startReactiveSkyWebMotion() {
  if (reactiveSkyMotionState.webListenerAttached) return;
  window.addEventListener("deviceorientation", handleReactiveSkyWebOrientation, true);
  window.addEventListener("deviceorientationabsolute", handleReactiveSkyWebOrientation, true);
  reactiveSkyMotionState.webListenerAttached = true;
  reactiveSkyMotionState.source = "web";
  reactiveSkyMotionState.started = true;
  setReactiveSkyMotionStatus("ready");
}

function stopReactiveSkyWebMotion() {
  if (!reactiveSkyMotionState.webListenerAttached) return;
  window.removeEventListener("deviceorientation", handleReactiveSkyWebOrientation, true);
  window.removeEventListener("deviceorientationabsolute", handleReactiveSkyWebOrientation, true);
  reactiveSkyMotionState.webListenerAttached = false;
}

function reactiveSkyNativeStartSucceeded(result) {
  if (!result || result.ok === false) return false;
  return result.ok === true || result.active === true || ["active", "started", "ready"].includes(String(result.state || ""));
}

async function startReactiveSkyNativeMotion(options = {}) {
  const bridge = reactiveSkyNativeMotionBridge();
  if (!bridge || reactiveSkyMotionState.requestInFlight || reactiveSkyMotionState.started) return false;
  reactiveSkyMotionState.requestInFlight = true;
  if (options.userInitiated) setReactiveSkyMotionStatus("requesting");
  updateReactiveSkyControls();
  try {
    const result = await bridge.start({ frequencyHz: 8, userInitiated: options.userInitiated === true });
    if (!reactiveSkyNativeStartSucceeded(result)) {
      if (options.userInitiated) {
        state.reactiveSkyMotionAllowed = false;
        localStorage.removeItem(REACTIVE_SKY_MOTION_KEY);
        setReactiveSkyMotionStatus(result?.state === "denied" || result?.reason === "denied" ? "denied" : "unsupported");
      }
      return false;
    }
    reactiveSkyMotionState.source = "native";
    reactiveSkyMotionState.started = true;
    setReactiveSkyMotionStatus("ready");
    return true;
  } catch {
    if (options.userInitiated) {
      state.reactiveSkyMotionAllowed = false;
      localStorage.removeItem(REACTIVE_SKY_MOTION_KEY);
      setReactiveSkyMotionStatus("unsupported");
    }
    return false;
  } finally {
    reactiveSkyMotionState.requestInFlight = false;
    updateReactiveSkyControls();
  }
}

async function stopReactiveSkyMotion(status = reactiveSkyMotionIdleStatus()) {
  const wasStarted = reactiveSkyMotionState.started || reactiveSkyMotionState.webListenerAttached;
  const source = reactiveSkyMotionState.source;
  reactiveSkyMotionState.started = false;
  reactiveSkyMotionState.source = "none";
  stopReactiveSkyWebMotion();
  clearTimeout(reactiveSkyMotionState.sampleExpiryTimer);
  if (source === "native") {
    try { await reactiveSkyNativeMotionBridge()?.stop?.(); } catch { /* Fallback remains weather-driven. */ }
  }
  if (wasStarted || reactiveSkyMotionState.lastSample) window.nearcastSetAmbientPose?.({ active: false });
  reactiveSkyMotionState.lastSample = null;
  setReactiveSkyMotionStatus(status);
}

async function requestReactiveSkyWebMotion() {
  const permissionRequest = window.DeviceOrientationEvent?.requestPermission;
  if (typeof permissionRequest === "function") {
    const permission = await permissionRequest.call(window.DeviceOrientationEvent);
    if (permission !== "granted") return false;
    reactiveSkyMotionState.webPermissionGranted = true;
  }
  startReactiveSkyWebMotion();
  return true;
}

async function toggleReactiveSkyDeviceMotion() {
  if (state.reactiveSkyMotionAllowed) {
    state.reactiveSkyMotionAllowed = false;
    localStorage.removeItem(REACTIVE_SKY_MOTION_KEY);
    await stopReactiveSkyMotion("idle");
    updateReactiveSkyControls();
    return;
  }
  if (!state.reactiveSkyEnabled || !reactiveSkyIsCurrentLocation() || !reactiveSkyMotionSupported()) return;

  reactiveSkyMotionState.requestInFlight = true;
  setReactiveSkyMotionStatus("requesting");
  updateReactiveSkyControls();
  let granted = false;
  try {
    if (reactiveSkyNativeMotionBridge()) {
      reactiveSkyMotionState.requestInFlight = false;
      granted = await startReactiveSkyNativeMotion({ userInitiated: true });
    } else {
      granted = await requestReactiveSkyWebMotion();
    }
  } catch {
    granted = false;
  }
  reactiveSkyMotionState.requestInFlight = false;
  if (granted) {
    state.reactiveSkyMotionAllowed = true;
    localStorage.setItem(REACTIVE_SKY_MOTION_KEY, "1");
    setReactiveSkyMotionStatus("ready");
  } else {
    state.reactiveSkyMotionAllowed = false;
    localStorage.removeItem(REACTIVE_SKY_MOTION_KEY);
    await stopReactiveSkyMotion("denied");
  }
  updateReactiveSkyControls();
  scheduleReactiveSkyMotionSync(0);
}

function resetReactiveSkyPose() {
  clearTimeout(reactiveSkyMotionState.sampleExpiryTimer);
  reactiveSkyMotionState.lastSample = null;
  reactiveSkyMotionState.lastAcceptedAt = 0;
  window.nearcastSetAmbientPose?.({ active: false });
  setReactiveSkyMotionStatus(reactiveSkyMotionIdleStatus());
  scheduleReactiveSkyMotionSync();
}

async function syncReactiveSkyMotion() {
  if (!reactiveSkyMotionShouldRun()) {
    await stopReactiveSkyMotion(reactiveSkyMotionIdleStatus());
    updateReactiveSkyControls();
    return;
  }
  const nativeBridge = reactiveSkyNativeMotionBridge();
  if (nativeBridge) {
    const started = await startReactiveSkyNativeMotion();
    if (started && !reactiveSkyMotionShouldRun()) await stopReactiveSkyMotion(reactiveSkyMotionIdleStatus());
  } else {
    const needsGesture = typeof window.DeviceOrientationEvent?.requestPermission === "function" &&
      !reactiveSkyMotionState.webPermissionGranted;
    if (needsGesture) setReactiveSkyMotionStatus("reconnect");
    else startReactiveSkyWebMotion();
  }
  updateReactiveSkyControls();
}

function scheduleReactiveSkyMotionSync(delay = 80) {
  clearTimeout(reactiveSkyMotionState.syncTimer);
  reactiveSkyMotionState.syncTimer = setTimeout(() => {
    reactiveSkyMotionState.syncTimer = 0;
    syncReactiveSkyMotion();
  }, delay);
}

function initReactiveSkyMotion() {
  reactiveSkyMotionState.mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
  reactiveSkyMotionState.mediaQuery?.addEventListener?.("change", () => scheduleReactiveSkyMotionSync(0));
  window.addEventListener("nearcast-ambient-motion", handleReactiveSkyNativeMotion);
  window.addEventListener("nearcast-native-ready", () => scheduleReactiveSkyMotionSync(0));
  document.addEventListener("visibilitychange", () => scheduleReactiveSkyMotionSync(0));
  window.addEventListener("pagehide", () => stopReactiveSkyMotion("paused"));
  window.addEventListener("pageshow", () => scheduleReactiveSkyMotionSync(0));
  reactiveSkyMotionState.observer = new MutationObserver(() => scheduleReactiveSkyMotionSync());
  reactiveSkyMotionState.observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"]
  });
  updateReactiveSkyControls();
  scheduleReactiveSkyMotionSync(0);
}

window.nearcastReactiveSkySnapshot = () => ({
  enabled: state.reactiveSkyEnabled,
  motionAllowed: state.reactiveSkyMotionAllowed,
  motionStatus: reactiveSkyMotionState.status,
  source: reactiveSkyMotionState.source,
  currentLocation: reactiveSkyIsCurrentLocation(),
  weatherCanRespond: reactiveSkyWeatherCanRespond(),
  running: reactiveSkyMotionState.started,
  lastSample: reactiveSkyMotionState.lastSample ? { ...reactiveSkyMotionState.lastSample } : null
});

function forecastOffsetMs(data = state.forecast) {
  const seconds = Number(data?.utc_offset_seconds);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function localDateTimeParts(value) {
  if (typeof value !== "string") return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0)
  };
}

function parseForecastTimestamp(value, data = state.forecast) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const parts = localDateTimeParts(value);
  if (parts) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - forecastOffsetMs(data);
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function forecastNowMs(data = state.forecast) {
  return parseForecastTimestamp(data?.current?.time, data) ?? Date.now();
}

function forecastDailyIndex(data = state.forecast, offsetDays = 0) {
  const target = forecastLocalDate(data, offsetDays);
  const times = data?.daily?.time || [];
  const found = times.findIndex((time) => datePart(time) === target);
  if (found >= 0) return found;
  if (!times.length) return Math.max(0, offsetDays);
  return clamp(offsetDays, 0, times.length - 1);
}

function currentUvIndex(data = state.forecast, fallbackDailyIndex = forecastDailyIndex(data)) {
  const now = forecastNowMs(data);
  const hourlyIndex = nearestHourlyIndexAt(data, now, 90 * 60 * 1000);
  const hourlyUv = hourlyIndex >= 0 ? Number(data?.hourly?.uv_index?.[hourlyIndex]) : NaN;
  if (Number.isFinite(hourlyUv)) return Math.max(0, Math.round(hourlyUv));
  return Math.max(0, Math.round(data?.daily?.uv_index_max?.[fallbackDailyIndex] || 0));
}

function datePart(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function addDaysToDateString(value, offsetDays) {
  const parts = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + offsetDays));
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function forecastLocalDate(data = state.forecast, offsetDays = 0) {
  const base = datePart(data?.current?.time) || data?.daily?.time?.[0] || datePart(Date.now());
  return addDaysToDateString(base, offsetDays);
}

function forecastLocalBoundaryMs(data, hour, offsetDays = 0) {
  const dayShift = Math.floor(hour / 24);
  const localHour = ((hour % 24) + 24) % 24;
  const day = forecastLocalDate(data, offsetDays + dayShift);
  if (!day) return null;
  return parseForecastTimestamp(`${day}T${String(localHour).padStart(2, "0")}:00`, data);
}

function forecastLocalHour(value) {
  const parts = localDateTimeParts(value);
  if (parts) return parts.hour + parts.minute / 60;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.getHours() + d.getMinutes() / 60;
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function forecastCurrentHour(data = state.forecast) {
  return Math.floor(forecastLocalHour(data?.current?.time));
}

function currentHourlyIndex(data = state.forecast) {
  const now = forecastNowMs(data);
  const times = data?.hourly?.time || [];
  for (let i = 0; i < times.length; i += 1) {
    const ms = parseForecastTimestamp(times[i], data);
    if (ms !== null && ms >= now - 60 * 60 * 1000) return i;
  }
  return nearestHourlyIndexAt(data, now, 90 * 60 * 1000);
}

function currentRainChance(data = state.forecast) {
  return weatherTruth(data).rainChance;
}

function daysFromForecastToday(value, data = state.forecast) {
  const base = forecastLocalDate(data, 0);
  const target = datePart(value);
  if (!base || !target) {
    const d = new Date(value);
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    return Math.round((startOf(d) - startOf(new Date())) / 86400000);
  }
  const baseDate = new Date(`${base}T12:00:00Z`);
  const targetDate = new Date(`${target}T12:00:00Z`);
  return Math.round((targetDate.getTime() - baseDate.getTime()) / 86400000);
}

function updateUnitButton() {
  els.unitToggle.textContent = state.unit === "fahrenheit" ? "F" : "C";
  els.unitToggle.title = state.unit === "fahrenheit" ? "Switch to Celsius" : "Switch to Fahrenheit";
}

function sanitizeTimeFormatPreference(value) {
  return ["auto", "12", "24"].includes(value) ? value : "auto";
}

function sanitizeMapRendererPreference(value) {
  return value === "classic" ? "classic" : "gl";
}

function storedMapRendererPreference() {
  const stored = localStorage.getItem(MAP_RENDERER_KEY);
  const choice = localStorage.getItem(MAP_RENDERER_CHOICE_KEY);
  if (stored === "classic" && choice !== "explicit") {
    try { localStorage.removeItem(MAP_RENDERER_KEY); } catch {}
    return "gl";
  }
  return sanitizeMapRendererPreference(stored);
}

function sanitizeMapDiagnosticMode(value) {
  const mode = String(value || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(MAP_DIAGNOSTIC_MODES, mode) ? mode : "full";
}

function sanitizeRadarSourceZoom(value) {
  const mode = String(value || "auto").toLowerCase();
  if (mode === "10" || mode === "z10") return "10";
  if (mode === "12" || mode === "z12") return "12";
  return "auto";
}

function sanitizeRadarProvider(value) {
  const mode = String(value || "auto").toLowerCase();
  if (radarProviderValueIsGenerated(mode)) return generatedRadarExperimentEnabled() ? "mrms-generated" : "auto";
  if (mode === "noaa" || mode === "noaa-wms" || mode === "wms") return "noaa-wms";
  return "auto";
}

function sanitizeXweatherStormMode(value) {
  const mode = String(value || "off").trim().toLowerCase();
  if (["1", "true", "on", "yes", "xweather", "storm", "storm-view", "enhanced"].includes(mode)) return "xweather";
  return "off";
}

function sanitizeXweatherLayerCodes(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((code) => code.trim().toLowerCase())
    .filter((code) => /^[a-z0-9-]+$/.test(code))
    .slice(0, 6);
}

function legacyXweatherDebugCredentials() {
  if (!DEBUG_SETTINGS_ENABLED) return null;
  const clientId = String(localStorage.getItem(XWEATHER_CLIENT_ID_KEY) || "").trim();
  const clientSecret = String(localStorage.getItem(XWEATHER_CLIENT_SECRET_KEY) || "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function normalizeXweatherStormConfig(payload = {}) {
  const credentials = payload.credentials || {};
  const clientId = String(credentials.clientId || payload.clientId || "").trim();
  const clientSecret = String(credentials.clientSecret || payload.clientSecret || "").trim();
  const layerCodes = sanitizeXweatherLayerCodes(
    Array.isArray(payload.layerCodes) ? payload.layerCodes.join(",") : payload.layerCodes
  );
  const ready = Boolean(clientId && clientSecret && String(payload.state || "").toLowerCase() === "ready");
  return {
    provider: payload.provider || "nearcast-xweather-config",
    version: Number(payload.version) || 1,
    status: ready ? "ready" : String(payload.state || payload.status || "missing-credentials").trim() || "missing-credentials",
    reason: String(payload.reason || "").trim(),
    checkedAt: Date.now(),
    credentials: ready ? { clientId, clientSecret } : null,
    layerCodes: layerCodes.length ? layerCodes : sanitizeXweatherLayerCodes(XWEATHER_STORM_DEFAULT_LAYERS),
    message: String(payload.message || "").trim(),
    lease: payload.lease && typeof payload.lease === "object" ? payload.lease : null,
    limits: payload.limits && typeof payload.limits === "object" ? payload.limits : null,
    usage: payload.usage && typeof payload.usage === "object" ? payload.usage : null,
    context: payload.context && typeof payload.context === "object" ? payload.context : null,
    contextKey: String(payload.context?.key || payload.contextKey || "").trim()
  };
}

function xweatherClientInstanceId() {
  try {
    const existing = localStorage.getItem(XWEATHER_CLIENT_INSTANCE_KEY);
    if (existing) return existing;
    const next = crypto?.randomUUID
      ? crypto.randomUUID()
      : `xw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(XWEATHER_CLIENT_INSTANCE_KEY, next);
    return next;
  } catch {
    return `xw-session-${Date.now().toString(36)}`;
  }
}

function xweatherStormConfigErrorMessage(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").trim();
  const lower = message.toLowerCase();
  if (name === "aborterror" || lower.includes("abort") || lower.includes("timed out")) return "StormScope timed out";
  return message || "StormScope config unavailable";
}

function xweatherStormConfigLoadingStale(record = xweatherStormConfigRecord, now = Date.now()) {
  if (record?.status !== "loading") return false;
  const checkedAt = Number(record.checkedAt || 0);
  return checkedAt > 0 && now - checkedAt > XWEATHER_CONFIG_STALE_MS;
}

function expireStaleXweatherStormConfig(now = Date.now()) {
  if (!xweatherStormConfigLoadingStale(xweatherStormConfigRecord, now)) return false;
  xweatherStormConfigRecord = {
    ...(xweatherStormConfigRecord || {}),
    status: "error",
    reason: "config-timeout",
    checkedAt: now,
    credentials: null,
    layerCodes: sanitizeXweatherLayerCodes(XWEATHER_STORM_DEFAULT_LAYERS),
    message: "StormScope timed out",
    retryAt: 0
  };
  xweatherStormConfigPromise = null;
  xweatherStormConfigPromiseKey = "";
  return true;
}

function xweatherStormConfigLeaseActive(record = xweatherStormConfigRecord, now = Date.now()) {
  if (record?.status !== "ready") return false;
  const expiresAt = Date.parse(record?.lease?.expiresAt || "");
  if (Number.isFinite(expiresAt)) return now < expiresAt - 2000;
  const checkedAt = Number(record?.checkedAt || 0);
  const sessionMs = Number(XWEATHER_STORM_SESSION_MS) || 5 * 60 * 1000;
  return checkedAt > 0 && now - checkedAt < sessionMs;
}

function xweatherStormConfigSnapshot() {
  expireStaleXweatherStormConfig();
  const debugCredentials = legacyXweatherDebugCredentials();
  if (debugCredentials) {
    return {
      status: "ready",
      checkedAt: Date.now(),
      credentials: debugCredentials,
      layerCodes: storedXweatherLayerCodes({ ignoreConfig: true }),
      message: "Using debug credentials"
    };
  }
  return xweatherStormConfigRecord || { status: "unknown", checkedAt: 0, credentials: null, layerCodes: [] };
}

function xweatherStormActivated() {
  return state.xweatherStormMode === "xweather" && Date.now() < xweatherStormActivatedUntil;
}

function xweatherStormActivationSnapshot() {
  return {
    active: xweatherStormActivated(),
    expiresAt: xweatherStormActivated() ? new Date(xweatherStormActivatedUntil).toISOString() : ""
  };
}

function stormScopeRelevanceSnapshot() {
  const truth = state.weatherTruth || (state.forecast ? weatherTruth(state.forecast) : null);
  const precipPhase = String(truth?.precip?.phase || "").toLowerCase();
  const radarPhase = String(currentRadarPrecipSignal()?.phase || "").toLowerCase();
  const thunderPotential = Boolean(truth?.display?.stormPotential);
  const stormAlert = (typeof activeAlerts !== "undefined" ? activeAlerts : []).find((alert) => {
    const event = String(alert?.event || "").toLowerCase();
    const tone = typeof alertTone === "function" ? alertTone(alert) : "";
    return ["warning", "watch"].includes(tone)
      && /tornado|thunderstorm|flash flood|storm|squall|hail/.test(event);
  }) || null;

  let reason = "quiet-nearby";
  if (["active", "nearby"].includes(radarPhase)) reason = `radar-${radarPhase}`;
  else if (["active", "nearby", "imminent", "likely-this-hour"].includes(precipPhase)) reason = `precip-${precipPhase}`;
  else if (thunderPotential) reason = "thunder-potential";
  else if (stormAlert) reason = "storm-alert";

  const eligible = reason !== "quiet-nearby";
  return {
    eligible,
    promote: eligible,
    reason,
    tone: stormAlert || thunderPotential ? "storm" : eligible ? "wet" : "quiet",
    precipPhase,
    radarPhase,
    alertEvent: stormAlert?.event || ""
  };
}

function activateXweatherStormView() {
  if (xweatherStormActivationTimer) clearTimeout(xweatherStormActivationTimer);
  xweatherStormActivatedUntil = Date.now() + XWEATHER_STORM_SESSION_MS;
  xweatherStormActivationTimer = setTimeout(() => {
    xweatherStormActivationTimer = 0;
    deactivateXweatherStormView();
  }, XWEATHER_STORM_SESSION_MS + 250);
  if (state.xweatherStormMode !== "xweather") {
    state.xweatherStormMode = "xweather";
    localStorage.setItem(XWEATHER_STORM_MODE_KEY, state.xweatherStormMode);
  }
  updateXweatherStormControl();
  if (typeof applyXweatherStormPreference === "function") applyXweatherStormPreference();
  return xweatherStormActivationSnapshot();
}

function deactivateXweatherStormView() {
  if (xweatherStormActivationTimer) {
    clearTimeout(xweatherStormActivationTimer);
    xweatherStormActivationTimer = 0;
  }
  xweatherStormActivatedUntil = 0;
  updateXweatherStormControl();
  if (typeof applyXweatherStormPreference === "function") applyXweatherStormPreference();
  return xweatherStormActivationSnapshot();
}

function xweatherStormCredentialsSnapshot() {
  const snapshot = xweatherStormConfigSnapshot();
  return snapshot.credentials?.clientId && snapshot.credentials?.clientSecret ? snapshot.credentials : null;
}

async function loadXweatherStormConfig(options = {}) {
  if (legacyXweatherDebugCredentials()) {
    xweatherStormConfigRecord = xweatherStormConfigSnapshot();
    updateXweatherStormControl();
    return xweatherStormConfigRecord;
  }
  const requestContext = options.context && typeof options.context === "object" ? options.context : null;
  const contextKey = String(requestContext?.contextKey || requestContext?.viewport?.key || "").trim();
  const existingContextKey = String(xweatherStormConfigRecord?.contextKey || xweatherStormConfigRecord?.context?.key || "").trim();
  if (!requestContext) {
    xweatherStormConfigRecord = {
      ...(xweatherStormConfigRecord || {}),
      status: "needs-context",
      reason: "viewport-required",
      checkedAt: Date.now(),
      credentials: null,
      layerCodes: sanitizeXweatherLayerCodes(XWEATHER_STORM_DEFAULT_LAYERS),
      message: "Open the full map to start StormScope.",
      contextKey: ""
    };
    updateXweatherStormControl();
    return xweatherStormConfigRecord;
  }
  if (xweatherStormConfigRecord?.status === "ready" && xweatherStormConfigLeaseActive(xweatherStormConfigRecord)) {
    return xweatherStormConfigRecord;
  }
  if (expireStaleXweatherStormConfig()) {
    updateXweatherStormControl();
    if (!options.force) return xweatherStormConfigRecord;
  }
  if (xweatherStormConfigPromise) return xweatherStormConfigPromise;
  if (xweatherStormConfigRecord?.status === "error" && existingContextKey === contextKey) {
    const retryAt = Number(xweatherStormConfigRecord.retryAt || 0);
    if (retryAt && Date.now() < retryAt && !options.force) return xweatherStormConfigRecord;
  }
  if (!xweatherStormConfigRecord || xweatherStormConfigRecord.status === "unknown" || options.force) {
    xweatherStormConfigRecord = {
      ...(xweatherStormConfigRecord || {}),
      status: "loading",
      checkedAt: Date.now(),
      credentials: null,
      contextKey
    };
    updateXweatherStormControl();
  }
  xweatherStormConfigPromiseKey = contextKey;
  const requestKey = contextKey;
  xweatherStormConfigPromise = fetchJsonWithTimeout(XWEATHER_CONFIG_ENDPOINT, XWEATHER_CONFIG_TIMEOUT_MS, null, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider: "nearcast-xweather-config-request",
      version: 1,
      requestedAt: new Date().toISOString(),
      contextKey,
      viewport: requestContext.viewport || null,
      storm: requestContext.storm || {},
      activation: {
        requested: xweatherStormActivated(),
        source: "storm-view-button"
      },
      client: {
        instanceId: xweatherClientInstanceId(),
        estimatedAccesses: readXweatherUsageRecord().accesses
      }
    })
  })
    .then((payload) => {
      const nextRecord = normalizeXweatherStormConfig(payload);
      nextRecord.contextKey = nextRecord.contextKey || requestKey;
      if (xweatherStormConfigPromiseKey === requestKey || nextRecord.status === "ready") xweatherStormConfigRecord = nextRecord;
      return nextRecord;
    })
    .catch((error) => {
      const message = xweatherStormConfigErrorMessage(error);
      const nextRecord = {
        status: "error",
        reason: "config-request-failed",
        checkedAt: Date.now(),
        credentials: null,
        layerCodes: sanitizeXweatherLayerCodes(XWEATHER_STORM_DEFAULT_LAYERS),
        message,
        contextKey: requestKey,
        retryAt: Date.now() + XWEATHER_CONFIG_RETRY_MS
      };
      if (xweatherStormConfigPromiseKey === requestKey) xweatherStormConfigRecord = nextRecord;
      setTimeout(() => {
        if (
          xweatherStormEnabled() &&
          xweatherStormConfigRecord?.status === "error" &&
          String(xweatherStormConfigRecord.contextKey || "") === requestKey &&
          typeof applyXweatherStormPreference === "function"
        ) {
          applyXweatherStormPreference();
        }
      }, XWEATHER_CONFIG_RETRY_MS + 100);
      return nextRecord;
    })
    .finally(() => {
      if (xweatherStormConfigPromiseKey === requestKey) {
        xweatherStormConfigPromise = null;
        xweatherStormConfigPromiseKey = "";
      }
      updateXweatherStormControl();
      if (typeof applyXweatherStormPreference === "function") applyXweatherStormPreference();
    });
  return xweatherStormConfigPromise;
}

function storedXweatherLayerCodes(options = {}) {
  const snapshot = options.ignoreConfig ? null : xweatherStormConfigSnapshot();
  if (snapshot?.layerCodes?.length) return sanitizeXweatherLayerCodes(snapshot.layerCodes.join(","));
  return sanitizeXweatherLayerCodes(localStorage.getItem(XWEATHER_LAYER_CODES_KEY) || XWEATHER_STORM_DEFAULT_LAYERS);
}

function xweatherLayerCodeIsLightning(code) {
  const value = String(code || "").toLowerCase();
  return value.startsWith("lightning-strikes") || value === "lightning-icons";
}

function xweatherStormRadarLayerCodes() {
  const layers = storedXweatherLayerCodes().filter((code) => !xweatherLayerCodeIsLightning(code));
  return layers.length ? layers : sanitizeXweatherLayerCodes(XWEATHER_STORM_DEFAULT_LAYERS);
}

function xweatherStormEnabled() {
  return state.xweatherStormMode === "xweather";
}

function xweatherStormCredentialsReady() {
  return Boolean(xweatherStormCredentialsSnapshot());
}

window.nearcastXweatherStormConfig = xweatherStormConfigSnapshot;
window.nearcastXweatherStormCredentials = xweatherStormCredentialsSnapshot;
window.nearcastLoadXweatherStormConfig = loadXweatherStormConfig;
window.nearcastXweatherStormActivated = xweatherStormActivated;
window.nearcastXweatherStormActivation = xweatherStormActivationSnapshot;
window.nearcastActivateXweatherStorm = activateXweatherStormView;
window.nearcastDeactivateXweatherStorm = deactivateXweatherStormView;
window.nearcastStormScopeRelevance = stormScopeRelevanceSnapshot;

function xweatherUsageMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function readXweatherUsageRecord() {
  try {
    const parsed = JSON.parse(localStorage.getItem(XWEATHER_USAGE_KEY) || "null");
    if (!parsed || parsed.month !== xweatherUsageMonthKey()) return { month: xweatherUsageMonthKey(), sessions: 0, accesses: 0, updatedAt: 0 };
    return {
      month: parsed.month,
      sessions: Math.max(0, Number(parsed.sessions) || 0),
      accesses: Math.max(0, Number(parsed.accesses) || 0),
      updatedAt: Math.max(0, Number(parsed.updatedAt) || 0),
      leaseIds: Array.isArray(parsed.leaseIds)
        ? parsed.leaseIds.map((id) => String(id || "").trim()).filter(Boolean).slice(-60)
        : []
    };
  } catch {
    return { month: xweatherUsageMonthKey(), sessions: 0, accesses: 0, updatedAt: 0 };
  }
}

function radarProviderValueIsGenerated(value) {
  const mode = String(value || "").toLowerCase();
  return mode === "mrms" || mode === "mrms-generated" || mode === "generated";
}

function generatedRadarExperimentFlagEnabled(value) {
  return ["1", "true", "on", "yes", "mrms", "generated"].includes(String(value || "").toLowerCase());
}

function generatedRadarExperimentEnabled() {
  try {
    const queryFlag = queryValue(
      "generatedRadar",
      "generatedradar",
      "radarExperimental",
      "radarexperimental",
      "mrmsExperiment",
      "mrmsexperiment"
    );
    return queryFlag !== null && generatedRadarExperimentFlagEnabled(queryFlag);
  } catch {
    return false;
  }
}

function timeFormatMetaText() {
  if (state.timeFormat === "12") return "Always show 6:00 PM";
  if (state.timeFormat === "24") return "Always show 18:00";
  return prefersTwentyFourHourClock() ? "Auto: showing 24-hour" : "Auto: showing 12-hour";
}

function updateTimeFormatButtons() {
  els.timeFormatButtons.forEach((button) => {
    const active = button.dataset.timeFormat === state.timeFormat;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.timeFormatMeta) els.timeFormatMeta.textContent = timeFormatMetaText();
}

function setTimeFormatPreference(value) {
  const next = sanitizeTimeFormatPreference(value);
  if (next === state.timeFormat) return;
  state.timeFormat = next;
  localStorage.setItem(TIME_FORMAT_KEY, next);
  updateTimeFormatButtons();
  refreshTimeFormattedSurfaces();
}

function updateDebugSettingsVisibility() {
  els.debugSettings.forEach((setting) => {
    setting.hidden = !DEBUG_SETTINGS_ENABLED;
  });
  document.documentElement.classList.toggle("debug-settings-enabled", DEBUG_SETTINGS_ENABLED);
  updateNativeStormActivityDebugControl();
}

function mapRendererMetaText() {
  if (state.mapDiagnosticMode !== "full") return `Testing: ${MAP_DIAGNOSTIC_MODES[state.mapDiagnosticMode]?.label || "Map"}`;
  if (state.mapRenderer === "gl") {
    if (window.maplibregl) return "Experimental WebGL map";
    if (mapLibreAssetStatus === "loading") return "Loading WebGL map";
    if (mapLibreAssetStatus === "error") return "WebGL unavailable";
    return "Tap to load WebGL map";
  }
  return "Stable Nearcast map";
}

function mapDiagnosticMetaText() {
  return MAP_DIAGNOSTIC_MODES[state.mapDiagnosticMode]?.meta || MAP_DIAGNOSTIC_MODES.full.meta;
}

function radarSourceMetaText() {
  if (state.radarSourceZoom === "10") return "Forcing radar z10";
  if (state.radarSourceZoom === "12") return "Forcing radar z12";
  if (state.radarProvider === "mrms-generated") return "Experimental generated max zoom";
  if (state.radarProvider === "auto") return "Auto: free radar coverage";
  return `Auto: NOAA WMS z${RADAR_TILE_MAX_ZOOM}`;
}

function radarProviderMetaText() {
  if (state.radarProvider === "mrms-generated") return "Experimental MRMS spike, NOAA fallback";
  if (state.radarProvider === "noaa-wms") return "NOAA WMS with RainViewer fallback";
  return "Auto: free radar coverage";
}

function rawMapExperimentMetaText() {
  const mode = sanitizeRawMapExperimentMode(state.rawMapExperimentMode);
  if (mode === "both") return "Enhanced past + forecast";
  if (mode === "observed") return "Enhanced past radar";
  if (mode === "forecast") return "Enhanced forecast";
  return "Standard radar";
}

function updateRawMapExperimentControl() {
  if (els.rawMapMode) els.rawMapMode.value = sanitizeRawMapExperimentMode(state.rawMapExperimentMode);
  if (els.rawMapMeta) els.rawMapMeta.textContent = rawMapExperimentMetaText();
}

function setRawMapExperimentMode(value) {
  const next = sanitizeRawMapExperimentMode(value);
  if (next === state.rawMapExperimentMode) return;
  state.rawMapExperimentMode = next;
  RAW_MAP_EXPERIMENT_MODE = next;
  try {
    if (DEBUG_SETTINGS_ENABLED) localStorage.setItem(RAW_MAP_EXPERIMENT_KEY, next);
    else localStorage.removeItem(RAW_MAP_EXPERIMENT_KEY);
  } catch {}
  updateRawMapExperimentControl();
  window.setTimeout(() => window.location.reload(), 120);
}

function xweatherStormMetaText() {
  const usage = readXweatherUsageRecord();
  const layers = xweatherStormRadarLayerCodes();
  const usageText = `${usage.accesses}/${XWEATHER_MONTHLY_ACCESS_LIMIT} est. accesses`;
  const config = xweatherStormConfigSnapshot();
  if (state.xweatherStormMode !== "xweather") {
    if (config.status === "ready") return `Off · ready for storm maps`;
    if (config.status === "loading") return "Checking storm map access";
    if (config.status === "unknown" || config.status === "needs-context") return "Off · starts in full map";
    return "Off · storm maps not configured";
  }
  if (!xweatherStormActivated()) {
    if (config.status === "budget-paused" || config.status === "provider-budget-paused") return `Budget paused · ${usageText}`;
    if (config.status === "error") return "StormScope unavailable";
    return "Tap StormScope on the map to start";
  }
  if (config.status === "loading") return "Checking storm map access";
  if (config.status === "unknown" || config.status === "needs-context") return "Open full map to start";
  if (config.status === "activation-required") return "Tap StormScope on the map to start";
  if (config.status === "below-min-zoom") return "Zoom in to start StormScope";
  if (config.status === "no-active-weather") return "Starts when radar is active";
  if (config.status === "budget-paused" || config.status === "provider-budget-paused") return `Budget paused · ${usageText}`;
  if (config.status === "error") return "StormScope unavailable";
  if (!xweatherStormCredentialsReady()) return "Storm maps not configured";
  if (!layers.length) return "No layer codes configured";
  return `On in map · ${layers.join(" + ")} · ${usageText}`;
}

function updateXweatherStormControl() {
  if (els.xweatherStormMode) els.xweatherStormMode.value = state.xweatherStormMode;
  if (els.xweatherStormMeta) els.xweatherStormMeta.textContent = xweatherStormMetaText();
}

function setXweatherStormMode(value) {
  const next = sanitizeXweatherStormMode(value);
  if (next === state.xweatherStormMode) return;
  state.xweatherStormMode = next;
  localStorage.setItem(XWEATHER_STORM_MODE_KEY, next);
  if (next !== "xweather") xweatherStormActivatedUntil = 0;
  updateXweatherStormControl();
  if (typeof applyXweatherStormPreference === "function") applyXweatherStormPreference();
}

function persistDeviceLocation(coords, source = "gps") {
  const latitude = Number(coords?.latitude);
  const longitude = Number(coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const location = {
    id: "device-location",
    name: "You",
    latitude,
    longitude,
    accuracy: Number.isFinite(Number(coords?.accuracy)) ? Math.max(0, Number(coords.accuracy)) : null,
    heading: Number.isFinite(Number(coords?.heading)) ? Number(coords.heading) : null,
    speed: Number.isFinite(Number(coords?.speed)) ? Number(coords.speed) : null,
    source,
    savedAt: Date.now()
  };
  try { localStorage.setItem(DEVICE_LOCATION_KEY, JSON.stringify(location)); } catch {}
  return location;
}

function readDeviceLocation(options = {}) {
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Math.max(0, Number(options.maxAgeMs))
    : DEVICE_LOCATION_MAP_MAX_AGE_MS;
  try {
    const location = JSON.parse(localStorage.getItem(DEVICE_LOCATION_KEY) || "null");
    if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) return null;
    const savedAt = Number(location.savedAt) || 0;
    if (maxAgeMs && Date.now() - savedAt > maxAgeMs) return null;
    return {
      id: "device-location",
      name: "You",
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
      savedAt
    };
  } catch {
    return null;
  }
}

function requestDeviceLocationOnce() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(persistDeviceLocation(position.coords, "gps")),
      () => resolve(readDeviceLocation()),
      {
        enableHighAccuracy: false,
        timeout: DEVICE_LOCATION_REFRESH_TIMEOUT_MS,
        maximumAge: DEVICE_LOCATION_REFRESH_MAX_AGE_MS
      }
    );
  });
}

async function refreshDeviceLocationForMapIfAllowed() {
  const recent = readDeviceLocation();
  if (!navigator.geolocation) return recent;
  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission?.state !== "granted") return recent;
      return await requestDeviceLocationOnce();
    } catch {
      return recent;
    }
  }
  return recent;
}

async function deviceLocationPermissionState() {
  if (!navigator.geolocation) return "unsupported";
  if (!navigator.permissions?.query) return "prompt";
  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    return ["granted", "denied", "prompt"].includes(permission?.state)
      ? permission.state
      : "prompt";
  } catch {
    return "prompt";
  }
}

function watchDeviceLocationForMap(onLocation, onError) {
  if (!navigator.geolocation) return null;
  return navigator.geolocation.watchPosition(
    (position) => {
      const location = persistDeviceLocation(position.coords, "gps-watch");
      if (location && typeof onLocation === "function") onLocation(location);
    },
    (error) => {
      if (typeof onError === "function") onError(error);
    },
    {
      enableHighAccuracy: false,
      timeout: DEVICE_LOCATION_WATCH_TIMEOUT_MS,
      maximumAge: DEVICE_LOCATION_WATCH_MAX_AGE_MS
    }
  );
}

function stopDeviceLocationWatch(watchId) {
  if (!navigator.geolocation || watchId === null || watchId === undefined) return;
  navigator.geolocation.clearWatch(watchId);
}

window.nearcastLastDeviceLocation = readDeviceLocation;
window.nearcastRefreshDeviceLocationForMap = refreshDeviceLocationForMapIfAllowed;
window.nearcastDeviceLocationPermissionState = deviceLocationPermissionState;
window.nearcastWatchDeviceLocationForMap = watchDeviceLocationForMap;
window.nearcastStopDeviceLocationWatch = stopDeviceLocationWatch;

function syncGeneratedRadarProviderOption() {
  if (!els.radarProvider) return;
  const existing = els.radarProvider.querySelector?.("option[value=\"mrms-generated\"]");
  if (DEBUG_SETTINGS_ENABLED && generatedRadarExperimentEnabled()) {
    if (!existing) {
      const option = document.createElement("option");
      option.value = "mrms-generated";
      option.textContent = "Generated MRMS spike";
      els.radarProvider.append(option);
    }
  } else {
    existing?.remove?.();
  }
}

function updateRadarProviderControl() {
  syncGeneratedRadarProviderOption();
  if (els.radarProvider) els.radarProvider.value = state.radarProvider;
  if (els.radarProviderMeta) els.radarProviderMeta.textContent = radarProviderMetaText();
}

function updateRadarSourceZoomControl() {
  updateRadarProviderControl();
  if (els.radarSourceZoom) {
    const autoOption = els.radarSourceZoom.querySelector?.("option[value=\"auto\"]");
    if (autoOption) {
      autoOption.textContent = state.radarProvider === "mrms-generated" ? "Auto MRMS" : "Auto z8";
    }
    els.radarSourceZoom.value = state.radarSourceZoom;
  }
  if (els.radarSourceMeta) els.radarSourceMeta.textContent = radarSourceMetaText();
}

function setRadarProvider(value) {
  const next = sanitizeRadarProvider(value);
  if (next === state.radarProvider) return;
  state.radarProvider = next;
  localStorage.setItem(RADAR_PROVIDER_KEY, next);
  updateRadarProviderControl();
  if (typeof applyRadarProviderPreference === "function") applyRadarProviderPreference();
}

function setRadarSourceZoom(value) {
  const next = sanitizeRadarSourceZoom(value);
  if (next === state.radarSourceZoom) return;
  state.radarSourceZoom = next;
  localStorage.setItem(RADAR_SOURCE_ZOOM_KEY, next);
  updateRadarSourceZoomControl();
  if (typeof applyRadarSourceZoomPreference === "function") applyRadarSourceZoomPreference();
}

function syncMapDiagnosticRootState() {
  const root = document.documentElement;
  const mode = state.mapDiagnosticMode;
  if (state.mapDiagnosticMode === "full") root.removeAttribute("data-map-diagnostic-mode");
  else root.dataset.mapDiagnosticMode = state.mapDiagnosticMode;
  root.classList.toggle("map-diagnostic-no-sky", mode === "quiet" || mode === "nosky");
  root.classList.toggle("map-diagnostic-no-motion", mode === "quiet" || mode === "nomotion");
  root.classList.toggle("map-diagnostic-no-blur", mode === "quiet" || mode === "noblur");
  root.classList.toggle("map-diagnostic-quiet-shell", mode === "quiet");
}

function updateMapDiagnosticModeControl() {
  syncMapDiagnosticRootState();
  if (els.mapDiagnosticMode) els.mapDiagnosticMode.value = state.mapDiagnosticMode;
  if (els.mapDiagnosticMeta) els.mapDiagnosticMeta.textContent = mapDiagnosticMetaText();
  updateRadarSourceZoomControl();
  updateMapRendererButtons();
}

function setMapDiagnosticMode(value) {
  const next = sanitizeMapDiagnosticMode(value);
  if (next === state.mapDiagnosticMode) return;
  state.mapDiagnosticMode = next;
  localStorage.setItem(MAP_DIAGNOSTIC_MODE_KEY, next);
  updateMapDiagnosticModeControl();
  if (next !== "full" && state.mapRenderer !== "gl") {
    setMapRendererPreference("gl");
  } else if (typeof applyMapDiagnosticModePreference === "function") {
    applyMapDiagnosticModePreference();
  }
}

function ensureMapLibreStylesheet() {
  if (mapLibreCssPromise) return mapLibreCssPromise;
  const existing = document.getElementById(MAPLIBRE_CSS_ID);
  if (existing) {
    mapLibreCssPromise = Promise.resolve(true);
    return mapLibreCssPromise;
  }
  const link = document.createElement("link");
  link.id = MAPLIBRE_CSS_ID;
  link.rel = "stylesheet";
  link.href = MAPLIBRE_CSS_URL;
  mapLibreCssPromise = new Promise((resolve) => {
    link.addEventListener("load", () => resolve(true), { once: true });
    link.addEventListener("error", () => {
      link.remove();
      mapLibreCssPromise = null;
      resolve(false);
    }, { once: true });
  });
  document.head.appendChild(link);
  return mapLibreCssPromise;
}

function ensureMapLibreAssets(options = {}) {
  if (window.maplibregl) {
    mapLibreAssetStatus = "ready";
    updateMapRendererButtons();
    if (options.renderAfterLoad && state.mapRenderer === "gl" && typeof applyMapRendererPreference === "function") {
      applyMapRendererPreference();
    }
    return Promise.resolve(true);
  }

  const cssPromise = ensureMapLibreStylesheet();
  if (!mapLibreAssetPromise) {
    const shouldReplaceScript = mapLibreAssetStatus === "error";
    mapLibreAssetStatus = "loading";
    updateMapRendererButtons();
    mapLibreAssetPromise = new Promise((resolve) => {
      let script = document.getElementById(MAPLIBRE_SCRIPT_ID);
      if (script && shouldReplaceScript) {
        script.remove();
        script = null;
      }
      if (!script) {
        script = document.createElement("script");
        script.id = MAPLIBRE_SCRIPT_ID;
        script.src = MAPLIBRE_SCRIPT_URL;
        script.async = true;
      }
      if (window.maplibregl) {
        resolve(true);
        return;
      }
      script.addEventListener("load", () => resolve(true), { once: true });
      script.addEventListener("error", () => resolve(false), { once: true });
      if (!script.isConnected) document.body.appendChild(script);
    }).then((loaded) => Promise.all([Promise.resolve(loaded), cssPromise])).then(([scriptLoaded, cssLoaded]) => {
      const ready = scriptLoaded && cssLoaded && Boolean(window.maplibregl);
      mapLibreAssetStatus = ready ? "ready" : "error";
      if (!ready) {
        document.getElementById(MAPLIBRE_SCRIPT_ID)?.remove();
        mapLibreAssetPromise = null;
      }
      updateMapRendererButtons();
      return ready;
    });
  }

  return mapLibreAssetPromise.then((ready) => {
    if (ready && options.renderAfterLoad && state.mapRenderer === "gl" && typeof applyMapRendererPreference === "function") {
      applyMapRendererPreference();
    } else if (!ready && state.mapRenderer === "gl") {
      state.mapRenderer = "classic";
      if (state.mapDiagnosticMode !== "full") {
        state.mapDiagnosticMode = "full";
        localStorage.setItem(MAP_DIAGNOSTIC_MODE_KEY, "full");
        updateMapDiagnosticModeControl();
      }
      updateMapRendererButtons();
      if (typeof applyMapRendererPreference === "function") applyMapRendererPreference();
    }
    return ready;
  });
}

function updateMapRendererButtons() {
  els.mapRendererButtons.forEach((button) => {
    const active = button.dataset.mapRenderer === state.mapRenderer;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.mapRendererMeta) els.mapRendererMeta.textContent = mapRendererMetaText();
}

function setMapRendererPreference(value) {
  const next = sanitizeMapRendererPreference(value);
  if (next === state.mapRenderer) {
    localStorage.setItem(MAP_RENDERER_KEY, next);
    localStorage.setItem(MAP_RENDERER_CHOICE_KEY, "explicit");
    return;
  }
  state.mapRenderer = next;
  localStorage.setItem(MAP_RENDERER_KEY, next);
  localStorage.setItem(MAP_RENDERER_CHOICE_KEY, "explicit");
  if (next === "classic" && state.mapDiagnosticMode !== "full") {
    state.mapDiagnosticMode = "full";
    localStorage.setItem(MAP_DIAGNOSTIC_MODE_KEY, "full");
    updateMapDiagnosticModeControl();
  }
  updateMapRendererButtons();
  if (next === "gl") {
    ensureMapLibreAssets({ renderAfterLoad: true });
  } else if (typeof applyMapRendererPreference === "function") {
    applyMapRendererPreference();
  }
}

function refreshTimeFormattedSurfaces() {
  renderTimeFormattedForecastSurfaces();
  if (typeof refreshOpenDayDetailMemorySurfaces === "function") refreshOpenDayDetailMemorySurfaces();
  if (typeof showFrame === "function" && mapState.frames?.length) showFrame(mapState.frameIndex);
  if (typeof renderTimelineTimeBubble === "function") renderTimelineTimeBubble();
  if (memoryEditState && typeof renderMemoryEditSheet === "function") renderMemoryEditSheet();
  if (typeof refreshOpenGlobalMemorySheet === "function") refreshOpenGlobalMemorySheet();
}

function renderTimeFormattedForecastSurfaces() {
  if (!state.forecast || !state.activePlace) return;
  renderForecast(state.forecast, state.activePlace, {
    only: ["launch", "glance", "nowcast", "insights", "plan", "hourly", "daily", "metricTips"],
    reason: "time-format"
  });
}

async function searchPlaces(query, { quiet = false } = {}) {
  const requestId = ++searchRequestSeq;
  const parsed = parseLocationQuery(query);
  if (!quiet) setStatus("Searching places...");
  try {
    let results = [];
    const attempts = buildPlaceSearchAttempts(parsed);
    for (const attempt of attempts) {
      results = await fetchPlaceResults(attempt.name, 12, attempt);
      if (results.length) break;
    }
    if (requestId !== searchRequestSeq) return;
    state.searchResults = rankPlaceResults(results, parsed).slice(0, 6);
    renderSearchResults();
    if (quiet) {
      if (state.searchResults.length) setStatus("");
    } else {
      setStatus(state.searchResults.length ? "" : `No matching places found for "${query}".`, !state.searchResults.length);
    }
  } catch (error) {
    if (requestId !== searchRequestSeq) return;
    if (quiet) return;
    setStatus("Could not search places. Check the connection and try again.", true);
  }
}

function buildPlaceSearchAttempts(parsed) {
  const attempts = [];
  const seen = new Set();
  const add = (name, countryCode = "") => {
    const cleanName = String(name || "").trim().replace(/\s+/g, " ");
    const cleanCountry = String(countryCode || "").toUpperCase();
    if (!cleanName) return;
    placeNameSearchVariants(cleanName).forEach((variant) => {
      const key = `${variant.toLowerCase()}|${cleanCountry}`;
      if (seen.has(key)) return;
      seen.add(key);
      attempts.push({ name: variant, countryCode: cleanCountry });
    });
  };

  add(parsed.primary || parsed.raw, parsed.countryCode);
  if (parsed.countryCode) add(parsed.primary || parsed.raw);
  if (parsed.primary !== parsed.raw) add(parsed.raw);
  return attempts;
}

function placeNameSearchVariants(name) {
  const cleanName = String(name || "").trim().replace(/\s+/g, " ");
  if (!cleanName) return [];
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    const clean = String(value || "").trim().replace(/\s+/g, " ");
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    variants.push(clean);
  };
  const asciiApostrophe = cleanName.replace(PLACE_APOSTROPHE_GLOBAL_PATTERN, "'");
  add(cleanName);
  add(asciiApostrophe);
  const singleLetterPrefix = asciiApostrophe.match(/^([A-Za-z])\s+(.{2,})$/);
  if (singleLetterPrefix) add(`${singleLetterPrefix[1]}'${singleLetterPrefix[2]}`);
  return variants;
}

async function fetchPlaceResults(name, count = 12, { countryCode = "" } = {}) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  const params = new URLSearchParams({
    name,
    count: String(count),
    language: "en",
    format: "json"
  });
  if (countryCode) params.set("countryCode", countryCode);
  url.search = params.toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error("Place search failed.");
  const data = await response.json();
  return data.results || [];
}

function parseLocationQuery(query) {
  const raw = query.trim().replace(/\s+/g, " ");
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  let primary = parts[0] || raw;
  let region = parts.slice(1).join(" ");
  let stateName = "";
  let countryCode = "";
  let countryName = "";

  if (region) {
    const qualifier = parseLocationQualifier(region);
    stateName = qualifier.stateName;
    countryCode = qualifier.countryCode;
    countryName = qualifier.countryName;
  } else {
    const stateSuffix = extractUsStateSuffix(raw);
    const countrySuffix = stateSuffix ? null : extractCountrySuffix(raw);
    const suffix = stateSuffix || countrySuffix;
    if (suffix) {
      primary = suffix.primary;
      region = suffix.region;
      stateName = suffix.stateName || "";
      countryCode = suffix.countryCode || "";
      countryName = suffix.countryName || "";
    }
  }

  return { raw, primary, region, stateName, countryCode, countryName };
}

function parseLocationQualifier(region) {
  const stateName = resolveUsStateName(region);
  if (stateName) {
    return { stateName, countryCode: "US", countryName: COUNTRY_DISPLAY_NAMES.US || "United States" };
  }

  const country = resolveCountry(region);
  if (country) return { stateName: "", countryCode: country.code, countryName: country.name };

  return { stateName: normalizeRegionName(region), countryCode: "", countryName: "" };
}

function extractUsStateSuffix(raw) {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const maxWords = Math.min(tokens.length - 1, US_STATE_ALIAS_MAX_WORDS);
  for (let wordCount = maxWords; wordCount >= 1; wordCount -= 1) {
    const region = tokens.slice(-wordCount).join(" ");
    const stateName = resolveUsStateName(region);
    const primary = tokens.slice(0, -wordCount).join(" ").trim();
    if (stateName && primary) {
      return {
        primary,
        region,
        stateName,
        countryCode: "US",
        countryName: COUNTRY_DISPLAY_NAMES.US || "United States"
      };
    }
  }
  return null;
}

function extractCountrySuffix(raw) {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const maxWords = Math.min(tokens.length - 1, COUNTRY_ALIAS_MAX_WORDS);
  for (let wordCount = maxWords; wordCount >= 1; wordCount -= 1) {
    const region = tokens.slice(-wordCount).join(" ");
    const country = resolveCountry(region);
    const primary = tokens.slice(0, -wordCount).join(" ").trim();
    if (country && primary) {
      return {
        primary,
        region,
        countryCode: country.code,
        countryName: country.name
      };
    }
  }
  return null;
}

function resolveUsStateName(region) {
  const value = String(region || "").trim();
  if (!value) return "";
  const upper = value.replace(/\./g, "").toUpperCase();
  if (US_STATE_NAMES[upper]) return US_STATE_NAMES[upper];
  return US_STATE_ALIASES.get(normalizeQualifierKey(value)) || "";
}

function normalizeRegionName(region) {
  const value = String(region || "").trim();
  return resolveUsStateName(value) || value;
}

function resolveCountry(region) {
  const match = COUNTRY_ALIASES.get(normalizeQualifierKey(region));
  if (!match) return null;
  return match;
}

function buildCountryDisplayNames() {
  const displayNames = typeof Intl !== "undefined" && Intl.DisplayNames
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
  return COUNTRY_CODES.reduce((names, code) => {
    names[code] = displayNames?.of(code) || code;
    return names;
  }, {});
}

function buildCountryAliases() {
  const aliases = new Map();
  COUNTRY_CODES.forEach((code) => {
    const name = COUNTRY_DISPLAY_NAMES[code];
    addCountryAlias(aliases, name, code);
    addCountryAlias(aliases, code, code);
  });
  Object.entries(COUNTRY_ALIAS_OVERRIDES).forEach(([alias, code]) => addCountryAlias(aliases, alias, code));
  return aliases;
}

function addCountryAlias(aliases, alias, code) {
  const normalizedCode = String(code || "").toUpperCase();
  const key = normalizeQualifierKey(alias);
  if (!key || !normalizedCode) return;
  aliases.set(key, {
    code: normalizedCode,
    name: COUNTRY_DISPLAY_NAMES[normalizedCode] || alias
  });
}

function buildUsStateAliases() {
  return Object.entries(US_STATE_NAMES).reduce((aliases, [code, name]) => {
    aliases.set(normalizeQualifierKey(code), name);
    aliases.set(normalizeQualifierKey(name), name);
    return aliases;
  }, new Map());
}

function normalizeQualifierKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function compactQualifierKey(value) {
  return normalizeQualifierKey(value).replace(/\s+/g, "");
}

function rankPlaceResults(results, parsed) {
  return results
    .map((place, index) => ({ place, index, score: placeScore(place, parsed) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.place);
}

function placeScore(place, parsed) {
  let score = 0;
  const primary = String(parsed.primary || "").toLowerCase();
  const primaryKey = normalizeQualifierKey(parsed.primary);
  const primaryCompact = compactQualifierKey(parsed.primary);
  const stateName = parsed.stateName.toLowerCase();
  const explicitCountry = String(parsed.countryCode || "").toUpperCase();
  const name = String(place.name || "").toLowerCase();
  const nameKey = normalizeQualifierKey(place.name);
  const nameCompact = compactQualifierKey(place.name);
  const admin = String(place.admin1 || "").toLowerCase();
  const country = String(place.country || "").toLowerCase();
  const countryCode = placeCountryCode(place);
  const featureCode = String(place.feature_code || place.featureCode || "").toUpperCase();
  const population = Number(place.population) || 0;

  if (name === primary) score += 35;
  else if (primaryKey && nameKey === primaryKey) score += 34;
  else if (primaryCompact && nameCompact === primaryCompact) score += 33;
  else if (primary && name.startsWith(primary)) score += 18;
  else if (primaryKey && nameKey.startsWith(primaryKey)) score += 18;
  else if (primaryCompact && nameCompact.startsWith(primaryCompact)) score += 16;
  else if (primary && name.includes(primary)) score += 8;
  else if (primaryKey && nameKey.includes(primaryKey)) score += 8;
  else if (primaryCompact && nameCompact.includes(primaryCompact)) score += 6;

  if (explicitCountry) score += countryCode === explicitCountry ? 70 : -50;
  if (stateName && admin === stateName) score += 80;
  else if (stateName && (admin.includes(stateName) || country.includes(stateName))) score += 35;

  if (featureCode === "PPLC") score += 35;
  else if (featureCode === "PPLA") score += 18;
  else if (featureCode === "PPLA2" || featureCode === "PPLA3") score += 10;

  if (population > 0) score += Math.min(32, Math.log10(population) * 5);
  return score;
}

function clearSearchResults() {
  searchRequestSeq += 1;
  clearTimeout(searchSuggestTimer);
  state.searchResults = [];
  hideSearchResults();
  els.placeSearch.value = "";
}

function hideSearchResults() {
  state.searchResults = [];
  els.searchResults.hidden = true;
  els.searchResults.innerHTML = "";
}

// Two modes: "welcome" (no place yet — search/location is the hero) and
// "browse" (a place is loaded — weather is the hero, search collapses to an icon).
function updateMode() {
  const hasContext = !state.welcomeOverride && Boolean(state.activePlace);
  els.shell.classList.remove("mode-boot");
  document.documentElement.removeAttribute("data-boot");
  els.shell.classList.toggle("mode-welcome", !hasContext);
  document.documentElement.toggleAttribute("data-welcome", !hasContext);
  if (!hasContext) {
    els.shell.classList.remove("search-open");
    closeAppMenu();
    clearWelcomeTransientUi();
    updateWelcomeBrandMark(null, browserApproximateIsDay());
    initWelcomeAmbience();
  } else {
    clearWelcomeTransientUi();
    cancelWelcomeAmbience();
  }
  updateReactiveSkyControls();
  scheduleReactiveSkyMotionSync();
}

function setForecastLaunchLoading(place) {
  const label = placeLabel(place);
  els.shell?.classList.add("is-loading-place");
  if (els.locationName) els.locationName.textContent = label;
  if (els.nowTemp) els.nowTemp.textContent = "";
  if (els.heroIcon) els.heroIcon.innerHTML = "";
  if (els.heroRange) els.heroRange.hidden = true;
  if (els.nowSummary) {
    els.nowSummary.classList.remove("summary-strip");
    els.nowSummary.textContent = `Waking up ${label}...`;
    els.nowSummary.setAttribute("aria-label", `Waking up ${label}.`);
  }
  if (els.glanceTitle) els.glanceTitle.textContent = "Building your local weather read.";
  if (els.forYouToday) els.forYouToday.hidden = true;
  if (els.launchShortcuts) els.launchShortcuts.hidden = true;
  const alertBar = document.getElementById("alertBar");
  if (alertBar) alertBar.hidden = true;
}

function clearForecastLaunchLoading() {
  els.shell?.classList.remove("is-loading-place");
}

function browserApproximateIsDay(date = new Date()) {
  const hour = date.getHours();
  return hour >= 6 && hour < 19;
}

function welcomeIsActive() {
  return Boolean(els.shell?.classList.contains("mode-welcome")) &&
    (state.welcomeOverride || (!state.activePlace && !state.savedPlaces.length));
}

function updateWelcomeBrandMark(code = null, isDay = browserApproximateIsDay()) {
  const mark = document.querySelector(".welcome-brand-mark");
  if (!mark) return;
  if (!mark.querySelector("img")) {
    mark.innerHTML = '<img src="icons/nearcast-mark.svg" alt="">';
  }
  mark.dataset.source = code === null || code === undefined ? "ambient" : "local";
  mark.dataset.day = isDay ? "day" : "night";
}

function setWelcomeAmbientLabel(text, options = {}) {
  if (!els.welcomeAmbientLabel) return;
  const copy = String(text || "").trim();
  els.welcomeAmbientLabel.textContent = copy;
  els.welcomeAmbientLabel.hidden = !copy;
  els.welcomeAmbientLabel.disabled = !copy;
  const source = options.source || "";
  els.welcomeAmbientLabel.dataset.source = source;
  els.welcomeAmbientLabel.classList.toggle("is-world", source === "world");
  els.welcomeAmbientLabel.classList.toggle("is-local", source === "local");
  const action = source === "world" ? "Tap for another city." : "Tap for a world sky.";
  els.welcomeAmbientLabel.title = copy ? action : "";
  els.welcomeAmbientLabel.setAttribute("aria-label", copy ? `${copy}. ${action}` : "Welcome sky");
}

function clearWelcomeTransientUi() {
  setWelcomeAmbientLabel("");
  els.loadingStatuses.forEach((status) => {
    if (!status.classList.contains("welcome-loading")) return;
    const text = status.querySelector("[data-loading-message]");
    if (text) text.textContent = "";
    status.hidden = true;
  });
}

function welcomeAmbientCopy(data, place, truth, source = "local") {
  const placeName = String(place?.name || "").trim();
  if (!placeName) return "";
  const condition = dailyConditionLabel(truth?.sceneCode ?? truth?.code ?? data?.current?.weather_code ?? 3);
  return source === "world"
    ? `World sky over ${placeName} · ${condition}`
    : `Local sky near ${placeName} · ${condition}`;
}

function cancelWelcomeAmbience() {
  if (welcomeAmbienceAbort) {
    welcomeAmbienceAbort.abort();
    welcomeAmbienceAbort = null;
  }
  cancelWelcomeWorldSky();
  welcomeAmbientSource = "idle";
  welcomeAmbienceStarted = false;
}

function readWelcomeAmbienceCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(WELCOME_AMBIENCE_CACHE_KEY) || "null");
    if (!cached || cached.unit !== state.unit || Date.now() - cached.savedAt > 15 * 60 * 1000) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeWelcomeAmbienceCache(place, data) {
  try {
    sessionStorage.setItem(WELCOME_AMBIENCE_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      unit: state.unit,
      place,
      data
    }));
  } catch {
    /* Ambience is optional; failing to cache it should not affect first run. */
  }
}

function welcomeWorldSkyCacheKey(place) {
  return `${state.unit}:${place.id || place.name}`;
}

function readWelcomeWorldSkyCache(place) {
  try {
    const all = JSON.parse(sessionStorage.getItem(WELCOME_WORLD_SKY_CACHE_KEY) || "{}");
    const cached = all[welcomeWorldSkyCacheKey(place)];
    if (!cached || Date.now() - cached.savedAt > 15 * 60 * 1000) return null;
    return cached.data || null;
  } catch {
    return null;
  }
}

function writeWelcomeWorldSkyCache(place, data) {
  try {
    const all = JSON.parse(sessionStorage.getItem(WELCOME_WORLD_SKY_CACHE_KEY) || "{}");
    all[welcomeWorldSkyCacheKey(place)] = {
      savedAt: Date.now(),
      data
    };
    sessionStorage.setItem(WELCOME_WORLD_SKY_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* World sky is decorative; cache failures should stay invisible. */
  }
}

function clearWelcomeWorldSkyTimer() {
  if (welcomeWorldSkyTimer) {
    clearTimeout(welcomeWorldSkyTimer);
    welcomeWorldSkyTimer = null;
  }
}

function cancelWelcomeWorldSky() {
  clearWelcomeWorldSkyTimer();
  if (welcomeWorldSkyAbort) {
    welcomeWorldSkyAbort.abort();
    welcomeWorldSkyAbort = null;
  }
}

function nextWelcomeWorldSkyPlace() {
  const place = WELCOME_WORLD_SKY_PLACES[welcomeWorldSkyIndex % WELCOME_WORLD_SKY_PLACES.length];
  welcomeWorldSkyIndex = (welcomeWorldSkyIndex + 1) % WELCOME_WORLD_SKY_PLACES.length;
  return place;
}

function scheduleWelcomeWorldSkyRotation() {
  clearWelcomeWorldSkyTimer();
  if (!welcomeIsActive() || welcomeAmbientSource !== "world") return;
  welcomeWorldSkyTimer = setTimeout(() => {
    showNextWelcomeWorldSky();
  }, WELCOME_WORLD_SKY_ROTATE_MS);
}

function startWelcomeWorldSky() {
  if (!welcomeIsActive()) return;
  welcomeAmbientSource = "world";
  showNextWelcomeWorldSky();
}

async function showNextWelcomeWorldSky(attempt = 0) {
  if (!welcomeIsActive()) return;
  clearWelcomeWorldSkyTimer();
  if (welcomeWorldSkyAbort) {
    welcomeWorldSkyAbort.abort();
    welcomeWorldSkyAbort = null;
  }

  const place = nextWelcomeWorldSkyPlace();
  welcomeAmbientSource = "world";
  setWelcomeAmbientLabel(`World sky over ${place.name}`, { source: "world" });

  const cached = readWelcomeWorldSkyCache(place);
  if (cached) {
    applyWelcomeAmbience(cached, place, { source: "world" });
    scheduleWelcomeWorldSkyRotation();
    return;
  }

  const abort = new AbortController();
  welcomeWorldSkyAbort = abort;
  try {
    const data = await fetchWelcomeAmbienceForecast(place, abort.signal);
    if (!welcomeIsActive() || abort.signal.aborted || welcomeAmbientSource !== "world") return;
    writeWelcomeWorldSkyCache(place, data);
    applyWelcomeAmbience(data, place, { source: "world" });
    scheduleWelcomeWorldSkyRotation();
  } catch {
    if (!abort.signal.aborted && welcomeIsActive() && welcomeAmbientSource === "world") {
      if (attempt < WELCOME_WORLD_SKY_PLACES.length - 1) {
        showNextWelcomeWorldSky(attempt + 1);
      } else {
        scheduleWelcomeWorldSkyRotation();
      }
    }
  } finally {
    if (welcomeWorldSkyAbort === abort) welcomeWorldSkyAbort = null;
  }
}

function handleWelcomeAmbientChip() {
  if (!welcomeIsActive()) return;
  if (welcomeAmbienceAbort) {
    welcomeAmbienceAbort.abort();
    welcomeAmbienceAbort = null;
  }
  welcomeAmbienceStarted = true;
  startWelcomeWorldSky();
}

function initWelcomeAmbience() {
  if (welcomeAmbienceStarted || !welcomeIsActive()) return;
  welcomeAmbienceStarted = true;
  const cached = readWelcomeAmbienceCache();
  if (cached?.data) applyWelcomeAmbience(cached.data, cached.place);
  loadWelcomeAmbience();
}

async function loadWelcomeAmbience() {
  const abort = new AbortController();
  welcomeAmbienceAbort = abort;
  let applied = false;
  try {
    const place = await fetchApproximateWelcomePlace(abort.signal);
    if (!welcomeIsActive() || abort.signal.aborted) return;
    const data = await fetchWelcomeAmbienceForecast(place, abort.signal);
    if (!welcomeIsActive() || abort.signal.aborted) return;
    writeWelcomeAmbienceCache(place, data);
    if (welcomeAmbientSource === "world") return;
    cancelWelcomeWorldSky();
    applyWelcomeAmbience(data, place, { source: "local" });
    applied = true;
  } catch {
    if (!abort.signal.aborted && welcomeIsActive() && welcomeAmbientSource !== "local") {
      startWelcomeWorldSky();
      applied = true;
    }
  } finally {
    if (!applied && welcomeAmbientSource !== "world") welcomeAmbienceStarted = false;
    if (welcomeAmbienceAbort === abort) welcomeAmbienceAbort = null;
  }
}

function applyWelcomeAmbience(data, place, options = {}) {
  if (!welcomeIsActive() || !data) return;
  const source = options.source || "local";
  welcomeAmbientSource = source;
  const truth = buildWeatherTruth(data);
  const sceneCode = truth.sceneCode ?? truth.code;
  const display = { ...(truth.display || {}), welcomeAmbient: true };
  updateWelcomeBrandMark(truth.nowCode ?? truth.code, truth.isDay);
  updateSkyCanvas(sceneCode, truth.isDay, data, display);
  if (state.theme === "auto") applyTheme();
  setWelcomeAmbientLabel(welcomeAmbientCopy(data, place, truth, source), { source });
}

async function fetchJsonWithTimeout(url, timeoutMs, signal = null, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) signal.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error("Request failed.");
    return await response.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}

async function fetchApproximateWelcomePlace(signal = null) {
  const providers = [
    {
      url: "https://get.geojs.io/v1/ip/geo.json",
      parse: (json) => approximatePlaceFromIpJson(json, {
        lat: "latitude",
        lon: "longitude",
        region: "region",
        country: "country",
        countryCode: "country_code"
      })
    },
    {
      url: "https://ipapi.co/json/",
      parse: (json) => approximatePlaceFromIpJson(json, {
        lat: "latitude",
        lon: "longitude",
        region: "region",
        country: "country_name",
        countryCode: "country_code"
      })
    },
    {
      url: "https://ipwho.is/",
      parse: (json) => json?.success === false ? null : approximatePlaceFromIpJson(json, {
        lat: "latitude",
        lon: "longitude",
        region: "region",
        country: "country",
        countryCode: "country_code"
      })
    }
  ];

  for (const provider of providers) {
    if (signal?.aborted) break;
    try {
      const place = provider.parse(await fetchJsonWithTimeout(provider.url, WELCOME_AMBIENCE_TIMEOUT_MS, signal));
      if (place) return place;
    } catch {
      /* Try the next no-key coarse location provider. */
    }
  }
  throw new Error("Approximate location unavailable.");
}

function approximatePlaceFromIpJson(json, fields) {
  const latitude = Number(json?.[fields.lat]);
  const longitude = Number(json?.[fields.lon]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const city = String(json?.city || "").trim();
  const region = String(json?.[fields.region] || "").trim();
  const country = String(json?.[fields.country] || "").trim();
  const label = city || region || country || "Nearby";
  return normalizePlace({
    id: `ambient-${latitude.toFixed(2)}-${longitude.toFixed(2)}`,
    name: label,
    admin1: city && region ? region : "",
    country,
    countryCode: String(json?.[fields.countryCode] || "").toUpperCase(),
    latitude,
    longitude
  });
}

async function fetchWelcomeAmbienceForecast(place, signal = null) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
      "shortwave_radiation",
      "direct_radiation",
      "diffuse_radiation",
      "is_day"
    ].join(","),
    hourly: [
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
      "shortwave_radiation",
      "direct_radiation",
      "diffuse_radiation",
      "uv_index",
      "is_day"
    ].join(","),
    daily: "weather_code,sunrise,sunset",
    minutely_15: "precipitation,precipitation_probability,snowfall",
    forecast_minutely_15: "8",
    temperature_unit: state.unit,
    wind_speed_unit: state.unit === "fahrenheit" ? "mph" : "kmh",
    precipitation_unit: state.unit === "fahrenheit" ? "inch" : "mm",
    timezone: "auto",
    forecast_days: "2"
  });
  return fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`, 2600, signal);
}

function toggleAppMenu(open) {
  const next = open === undefined ? els.appMenu.hidden : open;
  els.appMenu.hidden = !next;
  els.appMenuToggle.setAttribute("aria-expanded", String(next));
  els.shell.classList.toggle("menu-open", next);
  if (next) updateFloatingChrome({ forceReveal: true });
}

function closeAppMenu() {
  if (!els.appMenu || els.appMenu.hidden) return;
  toggleAppMenu(false);
}

function toggleSearch(open) {
  const next = open === undefined ? !els.shell.classList.contains("search-open") : open;
  els.shell.classList.toggle("search-open", next);
  if (next) updateFloatingChrome({ forceReveal: true });
  if (next) {
    els.placeSearch.focus();
  } else {
    clearSearchResults();
  }
}

function renderSearchResults() {
  els.searchResults.innerHTML = "";
  els.searchResults.hidden = !state.searchResults.length;

  state.searchResults.forEach((place) => {
    const button = document.createElement("button");
    button.className = "result-button";
    button.type = "button";
    button.innerHTML = `
      <span>${escapeHtml(place.name)}</span>
      <small>${escapeHtml(formatPlaceResultMeta(place))}</small>
    `;
    bindTapAction(button, () => {
      toggleSearch(false);
      loadPlace(normalizePlace(place));
    });
    els.searchResults.appendChild(button);
  });
}

function updatePlaceSaveButton() {
  if (!els.placeSaveButton) return;
  const alreadySaved = Boolean(state.activePlace &&
    state.savedPlaces.some((p) => p.id === state.activePlace.id));
  const placeName = state.activePlace?.name || "place";

  els.placeSaveButton.hidden = !state.activePlace;
  els.placeSaveButton.disabled = !state.activePlace || alreadySaved;
  els.placeSaveButton.classList.toggle("is-saved", alreadySaved);
  els.placeSaveButton.setAttribute("aria-pressed", String(alreadySaved));
  els.placeSaveButton.setAttribute(
    "aria-label",
    alreadySaved ? `${placeName} is saved` : `Save ${placeName}`
  );
  els.placeSaveButton.querySelector("[data-place-save-title]").textContent =
    alreadySaved ? "Saved" : "Save this place";
  els.placeSaveButton.querySelector("[data-place-save-copy]").textContent =
    alreadySaved ? `${placeName} is in your places.` : `Add ${placeName} for faster switching.`;
}

// Lightweight current-conditions for the saved-places glance row.
// Cached per place + unit so re-renders and taps are instant.
const glanceData = {};
const GLANCE_CACHE_VERSION = "v2";

async function fetchGlance(place) {
  const key = `glance:${GLANCE_CACHE_VERSION}:${state.unit}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(localStorage.getItem(key) || "null");
  if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.data;

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,precipitation,weather_code,cloud_cover,is_day",
    temperature_unit: state.unit,
    timezone: "auto"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error("Glance failed.");
  const json = await response.json();
  const code = effectiveCurrentCode(json.current);
  const data = {
    temp: Math.round(json.current.temperature_2m),
    code,
    isDay: Boolean(json.current.is_day)
  };
  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  return data;
}

function renderSavedPlaces() {
  els.savedPlaces.innerHTML = "";
  updatePlaceSaveButton();
  updatePlaceSwitcher();
  updateInstallPromptUI();

  if (state.savedPlaces.length && typeof renderSavedPlaceWatchNotificationPanel === "function") {
    els.savedPlaces.insertAdjacentHTML("beforeend", renderSavedPlaceWatchNotificationPanel());
  }

  if (!state.savedPlaces.length) {
    els.savedPlaces.innerHTML = `
      <div class="place-empty">
        <strong>No saved places yet</strong>
        <span>Use Save this place above to make switching faster.</span>
      </div>
    `;
  }

  state.savedPlaces.forEach((place) => {
    const g = glanceData[place.id];
    const isActive = state.activePlace && state.activePlace.id === place.id;
    const placeName = escapeHtml(place.name);
    const watchCopy = typeof placeWatchNotificationPlaceCopy === "function"
      ? placeWatchNotificationPlaceCopy(place.id)
      : null;
    const watchButton = watchCopy ? `
      <button
        class="place-watch-toggle${watchCopy.pressed ? " is-on" : ""}"
        type="button"
        data-place-watch-toggle="${escapeHtml(place.id)}"
        aria-pressed="${watchCopy.pressed ? "true" : "false"}"
        aria-label="${escapeHtml(watchCopy.aria)}"
        title="${escapeHtml(watchCopy.title || watchCopy.aria)}"
        ${watchCopy.disabled ? "disabled" : ""}
      >${escapeHtml(watchCopy.label)}</button>
    ` : "";
    const item = document.createElement("article");
    item.className = `place-item${isActive ? " active" : ""}${watchCopy ? " has-watch-control" : ""}`;
    item.dataset.placeId = place.id;
    item.innerHTML = `
      <button class="place-item-main" type="button" aria-label="Load ${placeName}">
        <span class="place-item-icon" aria-hidden="true">${g ? weatherIcon(g.code, g.isDay, { density: "dense" }) : ""}</span>
        <span class="place-item-copy">
          <strong>${placeName}</strong>
          <span>${escapeHtml(formatPlaceResultMeta(place) || (isActive ? "Current place" : "Saved place"))}</span>
        </span>
        <span class="place-item-temp">${g ? `${g.temp}${degree(state.unit === "fahrenheit" ? "F" : "C")}` : ""}</span>
      </button>
      ${watchButton}
      <button class="place-item-remove" type="button" aria-label="Remove ${placeName}">×</button>
    `;
    bindTapAction(item.querySelector(".place-item-main"), () => {
      closePlaceSheet();
      loadPlace(place);
    });
    bindTapAction(item.querySelector(".place-item-remove"), () => removeSavedPlace(place.id));
    els.savedPlaces.appendChild(item);
  });
  renderMapMarkers();
  hydrateGlances();
}

function updatePlaceSwitcher() {
  const hasContext = Boolean(state.activePlace) || state.savedPlaces.length > 0;
  els.placeSwitcher.hidden = !hasContext;
  els.launchPlaceButton.disabled = !hasContext;
  els.launchPlaceButton.setAttribute("aria-disabled", String(!hasContext));
  if (!hasContext) return;

  const place = state.activePlace || state.savedPlaces[0];
  const count = state.savedPlaces.length;
  const g = place ? glanceData[place.id] : null;
  els.launchPlaceButton.setAttribute("aria-label", `Open saved places for ${place ? place.name : "current place"}`);
  els.placeSwitcherName.textContent = place ? place.name : "Places";
  els.placeSwitcherMeta.textContent =
    `${count} saved${g ? ` · ${g.temp}${degree(state.unit === "fahrenheit" ? "F" : "C")}` : ""}`;
}

// Fill in temp + condition icon on each saved chip; runs after the
// synchronous render so cached chips show instantly and the rest fill in.
function hydrateGlances() {
  state.savedPlaces.forEach(async (place) => {
    if (glanceData[place.id]) return;
    try {
      glanceData[place.id] = await fetchGlance(place);
      updatePlaceGlance(place.id);
    } catch {
      /* leave chip as name-only on failure */
    }
  });
}

function updatePlaceGlance(placeId) {
  const chip = els.savedPlaces.querySelector(`[data-place-id="${placeId}"]`);
  const g = glanceData[placeId];
  if (!g) return;
  const icon = chip?.querySelector(".place-item-icon");
  const temp = chip?.querySelector(".place-item-temp");
  if (icon) icon.innerHTML = weatherIcon(g.code, g.isDay, { density: "dense" });
  if (temp) temp.textContent = `${g.temp}${degree(state.unit === "fahrenheit" ? "F" : "C")}`;
  updatePlaceSwitcher();
}

const sheetPullDismissStates = new WeakMap();
const shownSheetStack = [];

function noteSheetShown(sheet) {
  const priorIndex = shownSheetStack.indexOf(sheet);
  if (priorIndex >= 0) shownSheetStack.splice(priorIndex, 1);
  shownSheetStack.push(sheet);
}

function isTopmostShownSheet(sheet) {
  for (let index = shownSheetStack.length - 1; index >= 0; index -= 1) {
    const candidate = shownSheetStack[index];
    if (!candidate?.isConnected || candidate.hidden || !candidate.classList.contains("show")) {
      shownSheetStack.splice(index, 1);
    }
  }
  return shownSheetStack[shownSheetStack.length - 1] === sheet;
}

function resetSheetPullDismiss(sheet) {
  if (!sheet) return;
  const gesture = sheetPullDismissStates.get(sheet);
  if (gesture) {
    gesture.trackingAbort?.abort();
    gesture.trackingAbort = null;
    if (gesture.pointerId !== null) {
      try { gesture.handle.releasePointerCapture(gesture.pointerId); } catch {}
    }
    gesture.active = false;
    gesture.claimed = false;
    gesture.rejected = false;
    gesture.pointerId = null;
    gesture.distance = 0;
    gesture.velocity = 0;
  }
  sheet.classList.remove("is-dragging");
  sheet.style.removeProperty("--sheet-drag-y");
}

function bindSheetPullToDismiss(sheet, dismiss, canDismiss = null) {
  const handle = sheet?.querySelector?.(".sheet-grabber");
  if (!sheet || !handle) return;

  const enabled = typeof dismiss === "function";
  handle.hidden = !enabled;
  const existing = sheetPullDismissStates.get(sheet);
  if (existing) {
    existing.dismiss = enabled ? dismiss : null;
    existing.canDismiss = typeof canDismiss === "function" ? canDismiss : null;
    if (!enabled) resetSheetPullDismiss(sheet);
    return;
  }
  if (!enabled) return;

  const gesture = {
    handle,
    dismiss,
    canDismiss: typeof canDismiss === "function" ? canDismiss : null,
    active: false,
    claimed: false,
    rejected: false,
    pointerId: null,
    trackingAbort: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    distance: 0,
    lastDistance: 0,
    lastSampleTime: 0,
    velocity: 0
  };
  sheetPullDismissStates.set(sheet, gesture);

  const eventTime = (event) => Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const stopTracking = () => {
    gesture.trackingAbort?.abort();
    gesture.trackingAbort = null;
  };
  const snapBack = () => {
    const pointerId = gesture.pointerId;
    stopTracking();
    gesture.active = false;
    gesture.claimed = false;
    gesture.rejected = false;
    gesture.pointerId = null;
    gesture.distance = 0;
    gesture.velocity = 0;
    if (pointerId !== null) {
      try { handle.releasePointerCapture(pointerId); } catch {}
    }
    sheet.classList.remove("is-dragging");
    sheet.style.setProperty("--sheet-drag-y", "0px");
    setTimeout(() => {
      if (!gesture.active && sheet.classList.contains("show")) {
        sheet.style.removeProperty("--sheet-drag-y");
      }
    }, 300);
  };

  const move = (event) => {
    if (!gesture.active || event.pointerId !== gesture.pointerId || gesture.rejected) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.claimed) {
      if (dy <= -8 || (Math.abs(dx) >= 8 && Math.abs(dx) > Math.max(0, dy) * 1.25)) {
        gesture.rejected = true;
        return;
      }
      if (dy < 8 || dy <= Math.abs(dx) * 1.25) return;
      gesture.claimed = true;
      sheet.classList.add("is-dragging");
    }
    const nextDistance = Math.max(0, dy);
    const sampleTime = eventTime(event);
    const sampleElapsed = Math.max(1, sampleTime - gesture.lastSampleTime);
    const sampleVelocity = (nextDistance - gesture.lastDistance) / sampleElapsed;
    gesture.velocity = (gesture.velocity * 0.35) + (sampleVelocity * 0.65);
    gesture.distance = nextDistance;
    gesture.lastDistance = nextDistance;
    gesture.lastSampleTime = sampleTime;
    sheet.style.setProperty("--sheet-drag-y", `${Math.round(gesture.distance)}px`);
    event.preventDefault();
  };

  const finish = (event, cancelled = false) => {
    if (!gesture.active || event.pointerId !== gesture.pointerId) return;
    const finishedAt = eventTime(event);
    const recentVelocity = finishedAt - gesture.lastSampleTime <= 160
      ? gesture.velocity
      : 0;
    const distanceThreshold = Math.min(120, sheet.getBoundingClientRect().height * 0.28);
    const remainsDismissible = (
      !sheet.hidden &&
      sheet.classList.contains("show") &&
      !sheet.classList.contains("sheet-keyboard-active") &&
      isTopmostShownSheet(sheet) &&
      (!gesture.canDismiss || gesture.canDismiss())
    );
    const shouldDismiss = !cancelled && gesture.claimed && remainsDismissible && (
      gesture.distance >= distanceThreshold ||
      (gesture.distance >= 36 && recentVelocity >= 0.65)
    );
    const dismissAction = gesture.dismiss;
    stopTracking();
    gesture.active = false;
    gesture.pointerId = null;
    try { handle.releasePointerCapture(event.pointerId); } catch {}
    if (shouldDismiss && typeof dismissAction === "function") {
      gesture.claimed = false;
      sheet.classList.remove("is-dragging");
      dismissAction();
      setTimeout(() => resetSheetPullDismiss(sheet), 300);
      return;
    }
    snapBack();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (
      sheet.hidden ||
      !sheet.classList.contains("show") ||
      sheet.classList.contains("sheet-keyboard-active") ||
      !isTopmostShownSheet(sheet) ||
      (gesture.canDismiss && !gesture.canDismiss())
    ) return;
    gesture.active = true;
    gesture.claimed = false;
    gesture.rejected = false;
    gesture.pointerId = event.pointerId;
    gesture.startX = event.clientX;
    gesture.startY = event.clientY;
    gesture.startTime = eventTime(event);
    gesture.distance = 0;
    gesture.lastDistance = 0;
    gesture.lastSampleTime = gesture.startTime;
    gesture.velocity = 0;

    gesture.trackingAbort?.abort();
    const trackingAbort = new AbortController();
    gesture.trackingAbort = trackingAbort;
    window.addEventListener("pointermove", move, { capture: true, passive: false, signal: trackingAbort.signal });
    window.addEventListener("pointerup", (releaseEvent) => finish(releaseEvent), { capture: true, signal: trackingAbort.signal });
    window.addEventListener("pointercancel", (cancelEvent) => finish(cancelEvent, true), { capture: true, signal: trackingAbort.signal });
    window.addEventListener("blur", () => snapBack(), { once: true, signal: trackingAbort.signal });
    try { handle.setPointerCapture(event.pointerId); } catch {}
  });

  handle.addEventListener("lostpointercapture", (event) => {
    if (gesture.active && event.pointerId === gesture.pointerId) finish(event, true);
  });
}

function showSheet(backdrop, sheet, options = {}) {
  const {
    onPullDismiss = null,
    canPullDismiss = null,
    resetScroll = false
  } = options;
  const pullDismissEnabled = sheet.dataset.pullDismiss !== "disabled";
  if (sheet.dataset.pullDismiss === "enabled" && typeof onPullDismiss !== "function") {
    console.warn(`Sheet #${sheet.id || "unknown"} is missing its pull-dismiss callback.`);
  }
  bindSheetPullToDismiss(
    sheet,
    pullDismissEnabled ? onPullDismiss : null,
    canPullDismiss
  );
  resetSheetPullDismiss(sheet);
  if (resetScroll) sheet.scrollTop = 0;
  // Force the initial translated state to commit before adding `.show`.
  // This keeps the slide transition, and avoids relying on deferred timers.
  void sheet.offsetHeight;
  backdrop.classList.add("show");
  sheet.classList.add("show");
  noteSheetShown(sheet);
}

function openPlaceSheet() {
  renderSavedPlaces();
  els.placeBackdrop.hidden = false;
  els.placeSheet.hidden = false;
  showSheet(els.placeBackdrop, els.placeSheet, {
    onPullDismiss: closePlaceSheet,
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
}

function closePlaceSheet() {
  els.placeBackdrop.classList.remove("show");
  els.placeSheet.classList.remove("show");
  document.body.style.overflow = mapState.immersive ? "hidden" : "";
  setTimeout(() => {
    els.placeBackdrop.hidden = true;
    els.placeSheet.hidden = true;
  }, 260);
}

function showWelcomeFromPlaces() {
  state.welcomeOverride = true;
  state.activePlace = null;
  closePlaceSheet();
  clearSearchResults();
  setStatus("");
  updateMode();
  updatePlaceSwitcher();
  requestAnimationFrame(() => {
    try { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }
    catch { window.scrollTo(0, 0); }
  });
}

function warmStartForecast(place) {
  try {
    const normalized = normalizePlace(place);
    const cached = readForecastCache(normalized, { maxAge: FORECAST_WARM_START_MAX_AGE_MS });
    if (!cached) return false;

    state.welcomeOverride = false;
    state.activePlace = normalized;
    state.radarPrecipSeq += 1;
    state.radarPrecipSignal = null;
    state.radarPrecipPlaceId = normalized.id;
    state.weatherTruth = null;
    if (typeof clearStormImpact === "function") clearStormImpact();

    updateMode();
    clearForecastLaunchLoading();
    updateFloatingChrome({ forceReveal: true });
    updatePlaceSwitcher();
    if (typeof resetMapForPlaceChange === "function") {
      resetMapForPlaceChange({ clearFrames: true });
    } else {
      mapState.panX = 0;
      mapState.panY = 0;
    }
    renderSavedPlaces();
    updateMapPlace();
    setAlertsLoading();
    renderForecast(markForecastProvenance(cached.data, {
      source: "warm-start",
      savedAt: cached.savedAt,
      cacheFallback: false,
      reason: ""
    }), normalized, { refreshMap: false });
    setLoadingStatus("");
    return true;
  } catch {
    return false;
  }
}

async function loadPlace(place, force = false) {
  const requestId = ++loadPlaceRequestSeq;
  state.welcomeOverride = false;
  const previousPlace = state.activePlace;
  const previousForecast = state.forecast;
  const nextPlace = normalizePlace(place);
  state.activePlace = nextPlace;
  const shouldShowLaunchLoading = !previousForecast || !samePlanPlace(previousPlace, nextPlace);
  state.radarPrecipSeq += 1;
  state.radarPrecipSignal = null;
  state.radarPrecipPlaceId = state.activePlace.id;
  state.weatherTruth = null;
  if (typeof clearStormImpact === "function") clearStormImpact();
  localStorage.setItem("weather-last-place", JSON.stringify(state.activePlace));
  updateMode();
  if (shouldShowLaunchLoading) setForecastLaunchLoading(nextPlace);
  else clearForecastLaunchLoading();
  updateFloatingChrome({ forceReveal: true });
  updatePlaceSwitcher();
  if (typeof resetMapForPlaceChange === "function") {
    resetMapForPlaceChange({ clearFrames: true });
  } else {
    mapState.panX = 0;
    mapState.panY = 0;
  }
  renderSavedPlaces();
  updateMapPlace();
  setAlertsLoading(); // clear prior place's alerts until this one resolves
  setStatus(`Updating ${state.activePlace.name}...`);

  try {
    const data = await fetchForecast(nextPlace, force);
    if (requestId !== loadPlaceRequestSeq || !samePlanPlace(nextPlace, state.activePlace)) return;
    clearForecastLaunchLoading();
    renderForecast(data, nextPlace);
    startRadarPrecipProbe(nextPlace, data, force);
    setStatus("");
    lastLoadedAt = Date.now();
    lastLoadUsedForecastFallback = forecastUsedCacheFallback(data);
    if (typeof consumeNearcastNotificationRoute === "function") consumeNearcastNotificationRoute();
  } catch (error) {
    if (requestId !== loadPlaceRequestSeq || !samePlanPlace(nextPlace, state.activePlace)) return;
    lastLoadUsedForecastFallback = false;
    const canKeepPreviousPlace = previousPlace && previousForecast && !samePlanPlace(previousPlace, nextPlace);
    if (canKeepPreviousPlace) {
      clearForecastLaunchLoading();
      state.activePlace = previousPlace;
      state.radarPrecipPlaceId = previousPlace.id;
      localStorage.setItem("weather-last-place", JSON.stringify(previousPlace));
      updatePlaceSwitcher();
      renderSavedPlaces();
      updateMapPlace();
      setStatus(`Could not update ${nextPlace.name}. Still showing ${placeLabel(previousPlace)}.`, true);
    } else {
      clearForecastLaunchLoading();
      setStatus("Could not load weather data. Try another place or reload the page.", true);
    }
  }

  // Alerts are best-effort and US-only — never block or break the forecast
  try {
    const alerts = await fetchAlerts(nextPlace);
    if (requestId !== loadPlaceRequestSeq || !samePlanPlace(nextPlace, state.activePlace)) return;
    renderAlerts(alerts);
    if (typeof consumeNearcastNotificationRoute === "function") consumeNearcastNotificationRoute({ forceAlerts: true });
  } catch {
    if (requestId !== loadPlaceRequestSeq || !samePlanPlace(nextPlace, state.activePlace)) return;
    setAlertsLoading();
    if (typeof consumeNearcastNotificationRoute === "function") consumeNearcastNotificationRoute({ forceAlerts: true });
  }
}

// When the PWA returns to the foreground after being idle (a common iOS case
// where the frozen page is restored without re-running), pull fresh data.
let lastLoadedAt = Date.now();
let lastBackgroundedAt = null;
let loadPlaceRequestSeq = 0;
let lastLoadUsedForecastFallback = false;
const FOREGROUND_STALE_MS = 8 * 60 * 1000;
const VIEW_RESET_IDLE_MS = 20 * 60 * 1000;

function noteBackgrounded() {
  lastBackgroundedAt = Date.now();
}

function handleVisibilityResume(event) {
  if (document.visibilityState === "hidden") {
    noteBackgrounded();
    return;
  }
  handleForegroundResume(event);
}

function handleForegroundResume(event = {}) {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  const idleMs = lastBackgroundedAt !== null
    ? now - lastBackgroundedAt
    : event.persisted ? now - lastLoadedAt : 0;
  if (idleMs >= VIEW_RESET_IDLE_MS) resetTransientViewToForecastTop();
  lastBackgroundedAt = null;
  clearRestoredWelcomeLoading(event, idleMs);
  refreshOnForeground();
}

function refreshOnForeground() {
  if (document.visibilityState === "hidden") return;
  if (welcomeIsActive()) return;
  if (!state.activePlace) return;
  if (Date.now() - lastLoadedAt < FOREGROUND_STALE_MS) return;
  for (const id in glanceData) delete glanceData[id]; // let chips re-pull too
  loadPlace(state.activePlace, true);
}

function initPullToRefresh() {
  if (!els.pullRefresh || initPullToRefresh.bound) return;
  initPullToRefresh.bound = true;
  document.addEventListener("touchstart", handlePullRefreshStart, { passive: true, capture: true });
  document.addEventListener("touchmove", handlePullRefreshMove, { passive: false, capture: true });
  document.addEventListener("touchend", handlePullRefreshEnd, { passive: true, capture: true });
  document.addEventListener("touchcancel", cancelPullRefreshGesture, { passive: true, capture: true });
}

function pullRefreshAtTop() {
  return currentScrollY() <= PULL_REFRESH_TOP_TOLERANCE_PX;
}

function pullRefreshModalOpen() {
  return Boolean(
    document.querySelector(".day-sheet:not([hidden])") ||
    document.querySelector(".sheet-backdrop.show:not([hidden])")
  );
}

function canStartPullRefresh(target) {
  if (!state.activePlace || !state.forecast) return false;
  if (welcomeIsActive()) return false;
  if (document.visibilityState === "hidden") return false;
  if (mapState.immersive) return false;
  if (els.shell?.classList.contains("search-open") || els.shell?.classList.contains("menu-open")) return false;
  if (pullRefreshModalOpen()) return false;
  if (!pullRefreshAtTop()) return false;
  const blocked = target?.closest?.("input, textarea, select, option, [contenteditable='true'], .day-sheet, .sheet-backdrop, .map-controls, .map-timeline, input[type='range']");
  return !blocked;
}

function handlePullRefreshStart(event) {
  if (pullRefreshState.refreshing || event.touches.length !== 1 || !canStartPullRefresh(event.target)) {
    cancelPullRefreshGesture();
    return;
  }
  const touch = event.touches[0];
  pullRefreshState.tracking = true;
  pullRefreshState.active = false;
  pullRefreshState.ready = false;
  pullRefreshState.startX = touch.clientX;
  pullRefreshState.startY = touch.clientY;
  pullRefreshState.distance = 0;
}

function handlePullRefreshMove(event) {
  if (!pullRefreshState.tracking || pullRefreshState.refreshing) return;
  if (event.touches.length !== 1) {
    cancelPullRefreshGesture();
    return;
  }
  const touch = event.touches[0];
  const dx = touch.clientX - pullRefreshState.startX;
  const dy = touch.clientY - pullRefreshState.startY;
  if (dy < -4 || Math.abs(dx) > Math.max(28, dy * 1.35)) {
    cancelPullRefreshGesture();
    return;
  }
  if (dy <= 3) return;
  if (!pullRefreshAtTop() && !pullRefreshState.active) {
    cancelPullRefreshGesture();
    return;
  }

  pullRefreshState.active = true;
  if (event.cancelable) event.preventDefault();
  const distance = Math.min(PULL_REFRESH_MAX_PX, dy * 0.78);
  const ready = distance >= PULL_REFRESH_THRESHOLD_PX;
  pullRefreshState.distance = distance;
  pullRefreshState.ready = ready;
  setPullRefreshVisual(distance, ready ? "Release to update" : "Pull to update", { ready });
}

function handlePullRefreshEnd() {
  if (!pullRefreshState.tracking) return;
  const shouldRefresh = pullRefreshState.active && pullRefreshState.ready;
  pullRefreshState.tracking = false;
  pullRefreshState.active = false;
  pullRefreshState.ready = false;
  if (shouldRefresh) {
    triggerPullRefresh();
    return;
  }
  hidePullRefresh();
}

function cancelPullRefreshGesture() {
  if (!pullRefreshState.tracking && !pullRefreshState.active) return;
  pullRefreshState.tracking = false;
  pullRefreshState.active = false;
  pullRefreshState.ready = false;
  pullRefreshState.distance = 0;
  if (!pullRefreshState.refreshing) hidePullRefresh();
}

function setPullRefreshVisual(distance, label, options = {}) {
  if (!els.pullRefresh) return;
  if (pullRefreshState.hideTimer) {
    clearTimeout(pullRefreshState.hideTimer);
    pullRefreshState.hideTimer = null;
  }
  const y = Math.max(0, Math.min(PULL_REFRESH_MAX_PX, Math.round(distance)));
  const progress = Math.max(0, Math.min(1, y / PULL_REFRESH_THRESHOLD_PX));
  els.pullRefresh.hidden = false;
  els.pullRefresh.style.setProperty("--pull-refresh-y", `${y}px`);
  els.pullRefresh.style.setProperty("--pull-refresh-progress", String(progress));
  els.pullRefresh.classList.add("is-visible");
  els.pullRefresh.classList.toggle("is-ready", Boolean(options.ready));
  els.pullRefresh.classList.toggle("is-refreshing", Boolean(options.refreshing));
  if (els.pullRefreshLabel) els.pullRefreshLabel.textContent = label;
}

function hidePullRefresh(delay = 180) {
  if (!els.pullRefresh) return;
  if (pullRefreshState.hideTimer) clearTimeout(pullRefreshState.hideTimer);
  els.pullRefresh.classList.remove("is-visible", "is-ready", "is-refreshing");
  els.pullRefresh.style.setProperty("--pull-refresh-y", "0px");
  els.pullRefresh.style.setProperty("--pull-refresh-progress", "0");
  pullRefreshState.hideTimer = setTimeout(() => {
    els.pullRefresh.hidden = true;
    pullRefreshState.hideTimer = null;
  }, delay);
}

function schedulePullRefreshHide(holdMs = 700) {
  if (pullRefreshState.hideTimer) clearTimeout(pullRefreshState.hideTimer);
  pullRefreshState.hideTimer = setTimeout(() => {
    pullRefreshState.hideTimer = null;
    hidePullRefresh();
  }, holdMs);
}

function setManualRefreshBusy(isBusy) {
  if (!els.manualRefresh) return;
  els.manualRefresh.classList.toggle("is-refreshing", Boolean(isBusy));
  els.manualRefresh.disabled = Boolean(isBusy);
  els.manualRefresh.setAttribute("aria-busy", String(Boolean(isBusy)));
}

async function triggerPullRefresh() {
  if (pullRefreshState.refreshing || !state.activePlace) {
    hidePullRefresh();
    return;
  }
  const now = Date.now();
  if (now - pullRefreshState.lastRefreshAt < PULL_REFRESH_COOLDOWN_MS) {
    setPullRefreshVisual(42, "Updated just now");
    schedulePullRefreshHide(700);
    return;
  }

  pullRefreshState.refreshing = true;
  setManualRefreshBusy(true);
  setPullRefreshVisual(42, "Updating forecast", { refreshing: true });
  const beforeLoadedAt = lastLoadedAt;
  for (const id in glanceData) delete glanceData[id];
  try {
    await loadPlace(state.activePlace, true);
  } finally {
    pullRefreshState.refreshing = false;
    setManualRefreshBusy(false);
    pullRefreshState.lastRefreshAt = Date.now();
    const updated = lastLoadedAt !== beforeLoadedAt && !lastLoadUsedForecastFallback;
    const label = updated
      ? "Updated"
      : lastLoadUsedForecastFallback
        ? "Using last forecast"
        : "Could not update";
    setPullRefreshVisual(42, label);
    schedulePullRefreshHide(updated ? 700 : 1200);
  }
}

async function triggerManualRefresh(event) {
  event?.preventDefault?.();
  if (!state.activePlace || welcomeIsActive() || pullRefreshState.refreshing) return;
  closeAppMenu();
  toggleSearch(false);
  await triggerPullRefresh();
}

function clearRestoredWelcomeLoading(event = {}, idleMs = 0) {
  if (!welcomeIsActive()) return;
  if (!event.persisted && idleMs < 1000) return;
  clearLocationLookupWatchdog();
  setLoadingStatus("");
  if (!els.status.hidden && !els.status.classList.contains("error")) setStatus("");
  if (!welcomeAmbienceStarted) initWelcomeAmbience();
}

function plannerHasActiveDraft() {
  const input = document.getElementById("askInput");
  return Boolean(
    askStreaming ||
    plannerEditingMemoryId ||
    plannerClarification ||
    input?.value?.trim()
  );
}

function scrollForecastToTop() {
  const target = state.activePlace
    ? document.querySelector(".launch-stage") || els.forecastView
    : els.welcome || els.shell;
  requestAnimationFrame(() => {
    if (target?.scrollIntoView) {
      try {
        target.scrollIntoView({ block: "start", behavior: "auto" });
      } catch {
        target.scrollIntoView();
      }
    }
    [document.scrollingElement, document.documentElement, document.body, els.shell, els.forecastView]
      .filter(Boolean)
      .forEach((el) => { el.scrollTop = 0; });
    if (typeof window.scrollTo === "function") {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      } catch {
        window.scrollTo(0, 0);
      }
    }
    updateFloatingChrome({ forceReveal: true });
  });
}

function resetTransientViewToForecastTop() {
  closeAppMenu();
  toggleSearch(false);
  plannerReturnAfterDayDetail = null;

  const preservePlanner = !els.aiSheet?.hidden && plannerHasActiveDraft();
  if (mapState.immersive) exitImmersiveMap();
  if (!els.placeSheet?.hidden) closePlaceSheet();
  if (!els.memoryDetailSheet?.hidden) closeMemoryDetail();
  if (!els.memoryEditSheet?.hidden) closeMemoryEditSheet();
  if (!els.memorySheet?.hidden) closeGlobalMemorySheet();

  const alertSheet = document.getElementById("alertSheet");
  if (alertSheet && !alertSheet.hidden) closeAlertSheet();

  const dayDetail = document.getElementById("dayDetail");
  if (dayDetail && !dayDetail.hidden) closeDayDetail();

  if (!preservePlanner && !els.aiSheet?.hidden) closeAISheet();
  document.body.style.overflow = preservePlanner ? "hidden" : "";
  scrollForecastToTop();
}

const FORECAST_CACHE_VERSION = "v4";
const AIR_QUALITY_CACHE_VERSION = "v1";
const AIR_QUALITY_FIELDS = [
  "us_aqi",
  "pm2_5",
  "pm10",
  "grass_pollen",
  "ragweed_pollen",
  "birch_pollen",
  "alder_pollen",
  "mugwort_pollen",
  "olive_pollen"
];

function forecastCacheKey(place, unit = state.unit) {
  return `forecast:${FORECAST_CACHE_VERSION}:${unit}:${Number(place.latitude).toFixed(3)}:${Number(place.longitude).toFixed(3)}`;
}

function readForecastCache(place, options = {}) {
  if (!place || place.latitude === undefined || place.longitude === undefined) return null;
  const cacheKey = forecastCacheKey(place, options.unit || state.unit);
  const cached = readStorageJson(cacheKey);
  if (!cached?.data || !Number.isFinite(Number(cached.savedAt))) return null;
  const maxAge = options.maxAge ?? Infinity;
  if (Date.now() - Number(cached.savedAt) > maxAge) return null;
  cached.data = markForecastProvenance(cached.data, {
    source: options.source || "cache",
    savedAt: Number(cached.savedAt),
    cacheFallback: false,
    reason: ""
  });
  return cached;
}

function forecastProvenance(data) {
  const meta = data?._nearcastMeta;
  const savedAt = Number(meta?.savedAt);
  return {
    source: String(meta?.source || "unknown"),
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null,
    cacheFallback: Boolean(meta?.cacheFallback),
    reason: String(meta?.reason || "")
  };
}

function markForecastProvenance(data, options = {}) {
  if (!data || typeof data !== "object") return data;
  const previous = forecastProvenance(data);
  const requestedSavedAt = Number(options.savedAt);
  const meta = {
    source: String(options.source || previous.source || "unknown"),
    savedAt: Number.isFinite(requestedSavedAt) && requestedSavedAt > 0
      ? requestedSavedAt
      : previous.savedAt,
    cacheFallback: options.cacheFallback === undefined
      ? previous.cacheFallback
      : Boolean(options.cacheFallback),
    reason: options.reason === undefined ? previous.reason : String(options.reason || "")
  };
  try {
    Object.defineProperty(data, "_nearcastMeta", {
      value: meta,
      configurable: true
    });
  } catch {
    data._nearcastMeta = meta;
  }
  return data;
}

function markForecastCacheFallback(data, cached, reason = "network-timeout") {
  return markForecastProvenance(data, {
    source: "cache-fallback",
    savedAt: Number(cached?.savedAt) || 0,
    cacheFallback: true,
    reason
  });
}

function forecastUsedCacheFallback(data) {
  return Boolean(data?._nearcastMeta?.cacheFallback);
}

async function fetchForecast(place, force = false) {
  const cacheKey = forecastCacheKey(place);
  const cached = readForecastCache(place, { maxAge: FORECAST_CACHE_MAX_AGE_MS });
  const fallbackCached = cached || readForecastCache(place, { maxAge: FORECAST_CACHE_FALLBACK_MAX_AGE_MS });

  if (!force && cached) {
    return cached.data;
  }

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
      "shortwave_radiation",
      "direct_radiation",
      "diffuse_radiation",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "is_day"
    ].join(","),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
      "shortwave_radiation",
      "direct_radiation",
      "diffuse_radiation",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "uv_index",
      "is_day"
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "uv_index_max",
      "uv_index_clear_sky_max",
      "daylight_duration",
      "sunshine_duration",
      "shortwave_radiation_sum",
      "sunrise",
      "sunset"
    ].join(","),
    minutely_15: "precipitation,precipitation_probability,snowfall",
    forecast_minutely_15: "8",
    temperature_unit: state.unit,
    wind_speed_unit: state.unit === "fahrenheit" ? "mph" : "kmh",
    precipitation_unit: state.unit === "fahrenheit" ? "inch" : "mm",
    timezone: "auto",
    forecast_days: "10"
  });

  try {
    const forecastPromise = fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`, FORECAST_FETCH_TIMEOUT_MS);
    const airQualityPromise = fetchAirQuality(place, force).catch(() => null);
    const data = await forecastPromise;
    const savedAt = Date.now();
    data.airQuality = await airQualityPromise;
    markForecastProvenance(data, {
      source: "network",
      savedAt,
      cacheFallback: false,
      reason: ""
    });
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt, data }));
    return data;
  } catch (error) {
    if (fallbackCached?.data) {
      return markForecastCacheFallback(fallbackCached.data, fallbackCached, error?.name || "forecast-fetch-failed");
    }
    throw error;
  }
}

async function fetchAirQuality(place, force = false) {
  const cacheKey = `air-quality:${AIR_QUALITY_CACHE_VERSION}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 30 * 60 * 1000;
  if (!force && cached && Date.now() - cached.savedAt < maxCacheAge) return cached.data;

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: AIR_QUALITY_FIELDS.join(","),
    hourly: AIR_QUALITY_FIELDS.join(","),
    forecast_days: "2",
    timezone: "auto"
  });
  const data = await fetchJsonWithTimeout(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, AIR_QUALITY_FETCH_TIMEOUT_MS);
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  return data;
}

function convertForecastUnits(data, fromUnit, toUnit) {
  if (!data || fromUnit === toUnit) return data;

  const provenance = forecastProvenance(data);
  const converted = JSON.parse(JSON.stringify(data));
  const temp = converterForUnit(fromUnit, toUnit, "temp");
  const wind = converterForUnit(fromUnit, toUnit, "wind");
  const precip = converterForUnit(fromUnit, toUnit, "precip");

  convertFields(converted.current, ["temperature_2m", "apparent_temperature"], temp);
  convertFields(converted.current, ["wind_speed_10m", "wind_gusts_10m"], wind);
  convertFields(converted.current, ["precipitation"], precip);
  convertFields(converted.hourly, ["temperature_2m", "apparent_temperature"], temp);
  convertFields(converted.hourly, ["wind_speed_10m", "wind_gusts_10m"], wind);
  convertFields(converted.hourly, ["precipitation"], precip);
  convertFields(converted.daily, [
    "temperature_2m_max",
    "temperature_2m_min",
    "apparent_temperature_max",
    "apparent_temperature_min"
  ], temp);
  convertFields(converted.daily, ["wind_speed_10m_max", "wind_gusts_10m_max"], wind);
  convertFields(converted.daily, ["precipitation_sum"], precip);
  convertFields(converted.minutely_15, ["precipitation", "snowfall"], precip);
  updateForecastUnitLabels(converted, toUnit);

  return markForecastProvenance(converted, provenance);
}

function convertFields(source, keys, convert) {
  if (!source) return;
  keys.forEach((key) => {
    if (Array.isArray(source[key])) {
      source[key] = source[key].map((value) => convertNumber(value, convert));
    } else if (source[key] !== undefined) {
      source[key] = convertNumber(source[key], convert);
    }
  });
}

function convertNumber(value, convert) {
  return typeof value === "number" ? convert(value) : value;
}

function converterForUnit(fromUnit, toUnit, type) {
  if (type === "temp") {
    return fromUnit === "fahrenheit" && toUnit === "celsius"
      ? (value) => (value - 32) * 5 / 9
      : (value) => (value * 9 / 5) + 32;
  }
  if (type === "wind") {
    return fromUnit === "fahrenheit" && toUnit === "celsius"
      ? (value) => value * 1.609344
      : (value) => value / 1.609344;
  }
  return fromUnit === "fahrenheit" && toUnit === "celsius"
    ? (value) => value * 25.4
    : (value) => value / 25.4;
}

function updateForecastUnitLabels(data, unit) {
  const temp = unit === "fahrenheit" ? "°F" : "°C";
  const wind = unit === "fahrenheit" ? "mp/h" : "km/h";
  const precip = unit === "fahrenheit" ? "inch" : "mm";
  [data.current_units, data.hourly_units, data.daily_units, data.minutely_15_units].forEach((units) => {
    if (!units) return;
    [
      "temperature_2m",
      "apparent_temperature",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min"
    ].forEach((key) => {
      if (units[key] !== undefined) units[key] = temp;
    });
    ["wind_speed_10m", "wind_gusts_10m", "wind_speed_10m_max", "wind_gusts_10m_max"].forEach((key) => {
      if (units[key] !== undefined) units[key] = wind;
    });
    ["precipitation", "precipitation_sum", "snowfall"].forEach((key) => {
      if (units[key] !== undefined) units[key] = precip;
    });
  });
}

function updateWeatherTruthReceipt(truth) {
  if (!truth) {
    document.documentElement.removeAttribute("data-weather-confidence");
    document.documentElement.removeAttribute("data-weather-source");
    return;
  }
  document.documentElement.dataset.weatherConfidence = truth.confidence || "forecast";
  document.documentElement.dataset.weatherSource = truth.source || "forecast";
}

const FORECAST_RENDER_LANE_KEYS = [
  "theme",
  "hero",
  "launch",
  "glance",
  "nowcast",
  "insights",
  "plan",
  "briefing",
  "hourly",
  "daily",
  "map",
  "metricTips",
  "sky",
  "continuity"
];

function forecastRenderLaneState(value) {
  return Object.fromEntries(FORECAST_RENDER_LANE_KEYS.map((key) => [key, value]));
}

function forecastRenderLaneList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeForecastRenderLanes(options = {}) {
  const only = forecastRenderLaneList(options.only);
  const lanes = only.length ? forecastRenderLaneState(false) : forecastRenderLaneState(true);
  only.forEach((key) => {
    if (key in lanes) lanes[key] = true;
  });
  if (options.lanes && typeof options.lanes === "object") {
    Object.entries(options.lanes).forEach(([key, value]) => {
      if (key in lanes) lanes[key] = Boolean(value);
    });
  }
  forecastRenderLaneList(options.skip).forEach((key) => {
    if (key in lanes) lanes[key] = false;
  });
  if (options.refreshMap === false) lanes.map = false;
  if (options.refreshSky === false) lanes.sky = false;
  if (options.saveContinuity === false) lanes.continuity = false;
  if (options.resetBriefing === false) lanes.briefing = false;
  if (options.refreshTheme === false) lanes.theme = false;
  return lanes;
}

function activeForecastRenderLanes(lanes) {
  return FORECAST_RENDER_LANE_KEYS.filter((key) => lanes[key]);
}

function buildForecastRenderContext(data, place) {
  const current = data.current;
  const todayIndex = forecastDailyIndex(data);
  const truth = buildWeatherTruth(data);
  const displayCondition = truth.display || currentDisplayCondition(data);
  const isDay = displayCondition.isDay;
  const nowCode = truth.nowCode ?? truth.code;
  const sceneCode = truth.sceneCode ?? nowCode;
  return {
    data,
    place,
    current,
    todayIndex,
    truth,
    firstRainChance: truth.rainChance,
    displayCondition,
    isDay,
    nowCode,
    sceneCode,
    tempUnit: state.unit === "fahrenheit" ? "F" : "C",
    precipUnit: state.unit === "fahrenheit" ? "in" : "mm",
    windUnit: state.unit === "fahrenheit" ? "mph" : "km/h",
    skyState: null
  };
}

function applyForecastRenderState(ctx, lanes) {
  state.forecast = ctx.data; // retained for the day-detail sheet
  state.forecastUnit = state.unit;
  state.weatherTruth = ctx.truth;
  state.sunriseMs = parseForecastTimestamp(ctx.data.daily.sunrise[ctx.todayIndex], ctx.data);
  state.sunsetMs = parseForecastTimestamp(ctx.data.daily.sunset[ctx.todayIndex], ctx.data);
  ctx.skyState = deriveSkyState(ctx.sceneCode, ctx.isDay, ctx.data, ctx.displayCondition);
  state.skyState = ctx.skyState;
  syncWeatherTruthDaylight(ctx.truth, ctx.skyState.isDay);
  state.skyIsDay = ctx.truth.isDay;
  state.locationIsDay = ctx.truth.isDay;
  if (lanes.theme && state.theme === "auto") applyTheme({ rerenderSky: false, rerenderMap: false });
  updateWeatherTruthReceipt(ctx.truth);
}

function renderForecastHero(ctx) {
  els.locationName.textContent = placeLabel(ctx.place);
  els.nowTemp.textContent = `${Math.round(ctx.current.temperature_2m)}${degree(ctx.tempUnit)}`;
  const high = ctx.data.daily?.temperature_2m_max?.[ctx.todayIndex];
  const low = ctx.data.daily?.temperature_2m_min?.[ctx.todayIndex];
  const hasRange = Number.isFinite(high) && Number.isFinite(low);
  if (els.heroRange) {
    els.heroRange.hidden = !hasRange;
    els.heroRange.textContent = hasRange
      ? `H ${Math.round(high)}${degree(ctx.tempUnit)} · L ${Math.round(low)}${degree(ctx.tempUnit)}`
      : "";
    if (hasRange) {
      els.heroRange.setAttribute(
        "aria-label",
        `High ${Math.round(high)}${degree(ctx.tempUnit)}, low ${Math.round(low)}${degree(ctx.tempUnit)}`
      );
    } else {
      els.heroRange.removeAttribute("aria-label");
    }
  }
  updateHeroWeatherIcon(ctx.nowCode, ctx.truth.isDay);
}

function renderForecastLaunch(ctx) {
  renderLaunchSummaryStrip(ctx.data, ctx.tempUnit, ctx.windUnit, ctx.truth);
  renderForYouToday(ctx.data, ctx.place, ctx.tempUnit, ctx.windUnit, ctx.truth);
  renderLaunchShortcuts(ctx.data, ctx.place);
}

function renderForecastCurrentReadouts(ctx) {
  els.feelsLike.textContent = `${Math.round(ctx.current.apparent_temperature)}${degree(ctx.tempUnit)}`;
  els.rainChance.textContent = ctx.truth.precip?.phase === "active"
    ? "Now"
    : ctx.truth.precip?.phase === "nearby" ? "Nearby"
      : ctx.truth.precip?.phase === "imminent" ? "Soon" : `${ctx.firstRainChance || 0}%`;
  els.wind.textContent = `${Math.round(ctx.current.wind_speed_10m)} ${ctx.windUnit}`;
  els.uv.textContent = currentUvIndex(ctx.data, ctx.todayIndex);
  els.humidity.textContent = `${ctx.current.relative_humidity_2m ?? "--"}%`;
  els.sunrise.textContent = ctx.data.daily.sunrise[ctx.todayIndex] ? formatTime(ctx.data.daily.sunrise[ctx.todayIndex]) : "--";
  els.sunset.textContent = ctx.data.daily.sunset[ctx.todayIndex] ? formatTime(ctx.data.daily.sunset[ctx.todayIndex]) : "--";
  els.updatedAt.textContent = `Updated ${formatTime(ctx.current.time)}`;
}

function renderForecastGlance(ctx) {
  renderForecastCurrentReadouts(ctx);
  renderTodayGlance(ctx.data, ctx.tempUnit, ctx.windUnit, ctx.todayIndex, ctx.truth);
}

function renderForecastPlan(ctx) {
  renderPlanPulse(ctx.data, ctx.place);
  if (typeof refreshPlanWatchForecasts === "function") refreshPlanWatchForecasts();
  if (typeof maybeSyncPlanWatchNotifications === "function") maybeSyncPlanWatchNotifications();
  if (typeof syncPlanWatchNotificationSubscription === "function") {
    syncPlanWatchNotificationSubscription({ reason: "forecast-rendered" });
  }
}

function renderForecastLists(ctx, lanes) {
  if (lanes.hourly) renderHourly(ctx.data, ctx.tempUnit, ctx.truth);
  if (lanes.daily) renderDaily(ctx.data, ctx.tempUnit, ctx.precipUnit);
}

function renderForecastMap() {
  updateMapPlace();
  refreshInlineMap(true);
}

function renderForecast(data, place, options = {}) {
  const perf = perfStart();
  const lanes = normalizeForecastRenderLanes(options);
  const ctx = buildForecastRenderContext(data, place);
  applyForecastRenderState(ctx, lanes);

  if (lanes.hero) renderForecastHero(ctx);
  if (lanes.launch) renderForecastLaunch(ctx);
  if (lanes.glance) renderForecastGlance(ctx);
  if (lanes.nowcast) renderNowcast(ctx.data, ctx.truth);
  if (lanes.insights) renderInsights(ctx.data, ctx.windUnit);
  if (lanes.plan) renderForecastPlan(ctx);
  if (lanes.briefing) resetBriefing();
  renderForecastLists(ctx, lanes);
  if (lanes.map) renderForecastMap();
  if (lanes.metricTips) bindMetricTips(ctx.data, ctx.tempUnit, ctx.windUnit);
  if (lanes.sky) updateSkyCanvas(ctx.sceneCode, ctx.truth.isDay, ctx.data, ctx.displayCondition);
  if (lanes.continuity) saveContinuitySnapshot(ctx.data, ctx.place, ctx.tempUnit, ctx.windUnit, ctx.truth);
  syncNativeWidgetSnapshot(ctx.data, ctx.place, ctx.truth);
  perfEnd("renderForecast", perf, PERF_RENDER_WARN_MS, {
    reason: options.reason || "full",
    lanes: activeForecastRenderLanes(lanes)
  });
  scheduleReactiveSkyMotionSync();
}

function renderTodayGlance(data, tempUnit, windUnit, todayIndex = forecastDailyIndex(data), truth = weatherTruth(data)) {
  const current = data.current;
  const feelsVal = Math.round(current.apparent_temperature);
  const actualVal = Math.round(current.temperature_2m);
  const diff = feelsVal - actualVal;
  const rainVal = truth.rainChance;
  const windVal = Math.round(current.wind_speed_10m);
  const humidityVal = current.relative_humidity_2m ?? 0;
  const uvVal = Math.round(data.daily.uv_index_max[todayIndex] || 0);
  const comfort = comfortGlance(actualVal, feelsVal, humidityVal, tempUnit);
  const rain = rainGlance(data, rainVal, truth);
  const wind = windGlance(windVal, windUnit, current.wind_direction_10m);
  const air = airGlance(data, humidityVal);
  const airHeadline = air.summary && (air.summary.band?.rank >= 2 || air.summary.pollen?.rank >= 3)
    ? `, ${air.summary.headline.toLowerCase()}`
    : "";

  if (els.glanceTitle) {
    els.glanceTitle.textContent = `${comfort.headline}, ${rain.headline.toLowerCase()}, ${wind.headline.toLowerCase()}${airHeadline}.`;
  }
  if (els.feelsContext) els.feelsContext.textContent = feelsContext(diff, tempUnit);
  if (els.rainContext) els.rainContext.textContent = rain.context;
  if (els.rainSignal) {
    const detail = truth.surfaceDetail || truth.receiptDetail || "";
    els.rainSignal.title = detail;
    els.rainSignal.setAttribute("aria-label", detail ? `Rain. ${rain.context}. ${detail}` : `Rain. ${rain.context}`);
  }
  if (els.windSignal) els.windSignal.classList.toggle("is-wind-field", featureFlags.windField);
  if (els.wind) els.wind.innerHTML = windVisualHtml(windVal, windUnit, wind);
  if (els.windContext) els.windContext.innerHTML = windContextHtml(wind);
  if (els.airSignalLabel) els.airSignalLabel.textContent = air.label;
  if (els.humidity) {
    if (air.html) els.humidity.innerHTML = air.html;
    else els.humidity.textContent = air.value;
  }
  if (els.humidityContext) els.humidityContext.textContent = air.context;
  if (els.humiditySignal) {
    els.humiditySignal.classList.toggle("is-visible", air.visible);
    els.humiditySignal.classList.toggle("air-quality-card", Boolean(air.summary));
    ["air-good", "air-moderate", "air-sensitive", "air-unhealthy", "air-very-unhealthy", "air-hazardous"].forEach((className) => {
      els.humiditySignal.classList.remove(className);
    });
    if (air.summary?.band?.severity) els.humiditySignal.classList.add(`air-${air.summary.band.severity}`);
  }
  if (els.glanceSignals) els.glanceSignals.classList.toggle("has-humidity", air.visible);

  renderDaylightGlance(data, uvVal, todayIndex);
}

function comfortGlance(actual, feels, humidity, tempUnit) {
  const feelsF = tempUnit === "F" ? feels : feels * 9 / 5 + 32;
  const actualF = tempUnit === "F" ? actual : actual * 9 / 5 + 32;
  if (feelsF >= 96) return { headline: "Dangerously hot" };
  if (feelsF >= 88) return { headline: humidity >= 65 ? "Hot and humid" : "Hot" };
  if (feelsF >= 78) return { headline: humidity >= 65 ? "Warm and muggy" : "Warm" };
  if (feelsF >= 60) return { headline: Math.abs(feelsF - actualF) <= 3 ? "Comfortable" : "Mild" };
  if (feelsF >= 45) return { headline: "Cool" };
  return { headline: "Cold" };
}

function feelsContext(diff, tempUnit) {
  const unit = degree(tempUnit);
  if (diff >= 5) return `Feels ${diff}${unit} warmer`;
  if (diff <= -5) return `Feels ${Math.abs(diff)}${unit} cooler`;
  return "Near the air temp";
}

function rainGlance(data, currentChance, truth = weatherTruth(data)) {
  const nowPrecip = truth.nowPrecip || nowPrecipSignal(data);
  const precip = truth.precip || buildPrecipTruth(data, nowPrecip, {
    rawCode: truth.display?.rawCode,
    pop: currentChance,
    cloud: truth.display?.cloud,
    precip: truth.display?.precip,
    baseCode: truth.display?.code
  });

  if (precip.phase === "active") {
    return {
      headline: precip.headline,
      context: precip.context || "Happening now"
    };
  }

  if (precip.phase === "imminent") {
    return {
      headline: precip.headline,
      context: precip.context || "Starting soon"
    };
  }

  if (precip.phase === "nearby") {
    return {
      headline: precip.headline,
      context: precip.context || "Radar shows rain nearby"
    };
  }

  if (precip.phase === "likely-this-hour" || precip.phase === "possible-this-hour") {
    return {
      headline: precip.headline,
      context: precip.context || `${currentChance}% this hour`
    };
  }

  if (precip.phase === "possible-later" && precip.startsInMin !== null && precip.startsInMin <= 120) {
    return {
      headline: precip.headline,
      context: precip.context || "Possible later"
    };
  }

  const next = nextRainChance(data, 12, 35);
  if (next) {
    return {
      headline: `rain possible near ${formatTime(next.time)}`,
      context: `${next.chance}% around ${formatTime(next.time)}`
    };
  }

  const start = forecastCurrentHour(data);
  const maxToday = Math.max(...(data.hourly.precipitation_probability || []).slice(start, start + 12).filter((value) => Number.isFinite(value)), 0);
  if (maxToday >= 20) return { headline: "rain chances stay low", context: `Peak ${maxToday}% nearby` };
  return { headline: "staying dry nearby", context: "No meaningful rain nearby" };
}

function nextRainChance(data, hoursAhead, threshold) {
  const start = forecastCurrentHour(data);
  const chances = data.hourly.precipitation_probability || [];
  const times = data.hourly.time || [];
  const end = Math.min(chances.length, start + hoursAhead + 1);
  for (let i = start + 1; i < end; i += 1) {
    if ((chances[i] || 0) >= threshold && times[i]) {
      return { chance: chances[i], time: times[i] };
    }
  }
  return null;
}

function windGlance(speed, unit, directionDeg = null) {
  const mph = unit === "mph" ? speed : speed / 1.609344;
  const direction = windDirectionCue(directionDeg);
  if (mph >= 30) return { headline: "very windy", context: "Secure loose items", direction };
  if (mph >= 20) return { headline: "windy", context: "Noticeable gusts", direction };
  if (mph >= 12) return { headline: "breezy", context: "A steady breeze", direction };
  if (mph >= 5) return { headline: "light wind", context: "Gentle movement", direction };
  return { headline: "calm wind", context: "Barely moving", direction };
}

function windContextHtml(wind) {
  return escapeHtml(wind?.context || "--");
}

function windVisualHtml(speed, unit, wind) {
  return featureFlags.windField ? windFieldHtml(speed, unit, wind) : windDialHtml(speed, unit, wind);
}

function windDialHtml(speed, unit, wind) {
  const value = Number.isFinite(speed) ? Math.round(speed) : "--";
  const direction = wind?.direction || null;
  const directionStyle = direction ? ` style="--wind-dir:${direction.towardDegrees}deg"` : "";
  const directionLabel = direction ? `<span class="wind-dial-direction">${escapeHtml(direction.label)}</span>` : "";
  const directionAria = direction ? ` ${direction.aria}` : "";
  return `
    <span class="wind-dial${direction ? "" : " is-missing-direction"}" role="img" aria-label="${escapeHtml(`${value} ${unit} wind.${directionAria}`)}"${directionStyle}>
      <span class="wind-dial-ring" aria-hidden="true"></span>
      <span class="wind-dial-cardinal is-n" aria-hidden="true">N</span>
      <span class="wind-dial-cardinal is-e" aria-hidden="true">E</span>
      <span class="wind-dial-cardinal is-s" aria-hidden="true">S</span>
      <span class="wind-dial-cardinal is-w" aria-hidden="true">W</span>
      ${direction ? `<span class="wind-dial-pointer" aria-hidden="true">${windDirectionIcon()}</span>` : ""}
      <span class="wind-dial-center" aria-hidden="true">
        <b>${escapeHtml(value)}</b>
        <em>${escapeHtml(unit)}</em>
        ${directionLabel}
      </span>
    </span>
  `;
}

function windDirectionIcon() {
  return `<svg viewBox="0 0 24 34" aria-hidden="true" focusable="false"><path d="M12 2 21 21.5l-9-4.3-9 4.3L12 2Z" fill="currentColor"/><path d="M12 17.2v14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;
}

function windFieldHtml(speed, unit, wind) {
  const numericSpeed = Number(speed);
  const value = Number.isFinite(numericSpeed) ? Math.round(numericSpeed) : "--";
  const mph = Number.isFinite(numericSpeed) ? (unit === "mph" ? numericSpeed : numericSpeed / 1.609344) : 0;
  const strength = Math.max(0, Math.min(1, mph / 28));
  const direction = wind?.direction || null;
  const fieldStyle = [
    direction ? `--wind-flow-dir:${direction.towardDegrees}deg` : "",
    `--wind-strength:${strength.toFixed(2)}`,
    `--wind-duration:${Math.max(3.2, 8.4 - strength * 5).toFixed(1)}s`
  ].filter(Boolean).join(";");
  const speedClass = mph >= 20 ? " is-strong" : mph >= 12 ? " is-breezy" : mph >= 5 ? " is-light" : " is-calm";
  const directionLabel = direction ? `<span class="wind-ribbon-direction">${escapeHtml(direction.label)}</span>` : "";
  const aria = direction
    ? `${value} ${unit} wind. ${direction.aria} Flow arrow points ${direction.towardAria}.`
    : `${value} ${unit} wind. Direction unavailable.`;

  return `
    <span class="wind-ribbon${direction ? "" : " is-missing-direction"}${speedClass}" role="img" aria-label="${escapeHtml(aria)}" style="${escapeHtml(fieldStyle)}">
      <span class="wind-ribbon-cardinal is-n" aria-hidden="true">N</span>
      <span class="wind-ribbon-cardinal is-e" aria-hidden="true">E</span>
      <span class="wind-ribbon-cardinal is-s" aria-hidden="true">S</span>
      <span class="wind-ribbon-cardinal is-w" aria-hidden="true">W</span>
      ${windRibbonSvg()}
      <span class="wind-ribbon-readout" aria-hidden="true">
        <b>${escapeHtml(value)}</b>
        <em>${escapeHtml(unit)}</em>
        ${directionLabel}
      </span>
    </span>
  `;
}

function windRibbonSvg() {
  return `
    <svg class="wind-ribbon-svg" viewBox="0 0 132 108" aria-hidden="true" focusable="false">
      <g class="wind-ribbon-rotor">
        <path class="wind-ribbon-halo" d="M66 103 L66 -3" />
        <path class="wind-ribbon-track" d="M66 103 L66 -3" />
        <path class="wind-ribbon-current" d="M66 99 L66 9" />
        <path class="wind-ribbon-arrow-shaft is-tail" d="M66 101 L66 76" />
        <path class="wind-ribbon-arrow-shaft is-middle" d="M66 72 L66 68 M66 40 L66 36" />
        <path class="wind-ribbon-arrow-shaft is-head" d="M66 32 L66 13" />
        <circle class="wind-ribbon-source" cx="66" cy="101" r="4.2" />
        <path class="wind-ribbon-arrow" d="M66 -1 L54 20 L78 20Z" />
      </g>
    </svg>
  `;
}

function windDirectionCue(value) {
  const degrees = normalizeWindDegrees(value);
  if (degrees === null) return null;
  const direction = compassDirection(degrees);
  const towardDegrees = (degrees + 180) % 360;
  const toward = compassDirection(towardDegrees);
  return {
    degrees,
    towardDegrees,
    towardRadians: towardDegrees * Math.PI / 180,
    flowDegrees: (towardDegrees + 270) % 360,
    label: `from ${direction.short}`,
    towardLabel: `toward ${toward.short}`,
    title: `Wind from ${direction.long}.`,
    aria: `Wind from ${direction.long}.`,
    towardAria: `toward ${toward.long}`
  };
}

function normalizeWindDegrees(value) {
  if (value === null || value === undefined || value === "") return null;
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) return null;
  return Math.round(((degrees % 360) + 360) % 360);
}

function compassDirection(degrees) {
  const labels = [
    ["N", "north"],
    ["NNE", "north-northeast"],
    ["NE", "northeast"],
    ["ENE", "east-northeast"],
    ["E", "east"],
    ["ESE", "east-southeast"],
    ["SE", "southeast"],
    ["SSE", "south-southeast"],
    ["S", "south"],
    ["SSW", "south-southwest"],
    ["SW", "southwest"],
    ["WSW", "west-southwest"],
    ["W", "west"],
    ["WNW", "west-northwest"],
    ["NW", "northwest"],
    ["NNW", "north-northwest"]
  ];
  const [short, long] = labels[Math.round(degrees / 22.5) % labels.length];
  return { short, long };
}

function humidityContext(value) {
  if (value >= 80) return "Very muggy";
  if (value >= 65) return "Muggy air";
  if (value <= 25) return "Very dry";
  if (value <= 35) return "Dry air";
  return "In the background";
}

const POLLEN_FIELDS = [
  { key: "grass_pollen", label: "grass" },
  { key: "ragweed_pollen", label: "ragweed" },
  { key: "birch_pollen", label: "birch" },
  { key: "alder_pollen", label: "alder" },
  { key: "mugwort_pollen", label: "mugwort" },
  { key: "olive_pollen", label: "olive" }
];

function finiteValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function aqiBand(value) {
  const aqi = Math.round(Number(value || 0));
  if (aqi <= 50) return { label: "Good", short: "Good", mood: "Good air", severity: "good", rank: 0, color: "#24b46b", glow: "rgba(36, 180, 107, 0.38)", advice: "Air looks good" };
  if (aqi <= 100) return { label: "Moderate", short: "Moderate", mood: "Moderate air", severity: "moderate", rank: 1, color: "#e3b72f", glow: "rgba(227, 183, 47, 0.38)", advice: "Fine for most people" };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", short: "Sensitive groups", mood: "Sensitive air", severity: "sensitive", rank: 2, color: "#ef8a2f", glow: "rgba(239, 138, 47, 0.42)", advice: "Sensitive folks should ease up" };
  if (aqi <= 200) return { label: "Unhealthy", short: "Unhealthy", mood: "Unhealthy air", severity: "unhealthy", rank: 3, color: "#df4f55", glow: "rgba(223, 79, 85, 0.44)", advice: "Keep hard efforts short" };
  if (aqi <= 300) return { label: "Very unhealthy", short: "Very unhealthy", mood: "Very unhealthy", severity: "very-unhealthy", rank: 4, color: "#9a62d0", glow: "rgba(154, 98, 208, 0.46)", advice: "Limit outdoor time" };
  return { label: "Hazardous", short: "Hazardous", mood: "Hazardous air", severity: "hazardous", rank: 5, color: "#8d3150", glow: "rgba(141, 49, 80, 0.48)", advice: "Stay inside if possible" };
}

const AQI_SCALE = [
  { range: "0-50", label: "Good", severity: "good", color: "#24b46b", note: "Little or no risk." },
  { range: "51-100", label: "Moderate", severity: "moderate", color: "#e3b72f", note: "Fine for most; sensitive people may notice it." },
  { range: "101-150", label: "Sensitive groups", severity: "sensitive", color: "#ef8a2f", note: "Sensitive groups should ease up." },
  { range: "151-200", label: "Unhealthy", severity: "unhealthy", color: "#df4f55", note: "Everyone may feel effects." },
  { range: "201-300", label: "Very unhealthy", severity: "very-unhealthy", color: "#9a62d0", note: "Limit outdoor time." },
  { range: "301+", label: "Hazardous", severity: "hazardous", color: "#8d3150", note: "Emergency conditions." }
];

function pollenBand(value) {
  const grains = finiteValue(value);
  if (grains === null) return null;
  if (grains < 1) return { label: "low", rank: 0 };
  if (grains < 10) return { label: "low", rank: 1 };
  if (grains < 50) return { label: "moderate", rank: 2 };
  if (grains < 100) return { label: "high", rank: 3 };
  return { label: "very high", rank: 4 };
}

function airQualityIndexAt(data, airQuality = data?.airQuality) {
  const hourly = airQuality?.hourly || {};
  const times = hourly.time || [];
  if (!times.length) return -1;
  const now = forecastNowMs(data);
  let best = -1;
  let bestDelta = Infinity;
  times.forEach((time, index) => {
    const ms = parseForecastTimestamp(time, airQuality);
    if (ms === null) return;
    const delta = Math.abs(ms - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  return bestDelta <= 90 * 60 * 1000 ? best : -1;
}

function airValueAt(data, key, airQuality = data?.airQuality) {
  const currentValue = finiteValue(airQuality?.current?.[key]);
  if (currentValue !== null) return currentValue;
  const index = airQualityIndexAt(data, airQuality);
  return index >= 0 ? finiteValue(airQuality?.hourly?.[key]?.[index]) : null;
}

function airPeakValue(data, key, hoursAhead = 12, airQuality = data?.airQuality) {
  const hourly = airQuality?.hourly || {};
  const times = hourly.time || [];
  const values = hourly[key] || [];
  const now = forecastNowMs(data);
  const end = now + hoursAhead * 60 * 60 * 1000;
  let peak = null;
  let peakTime = null;
  times.forEach((time, index) => {
    const ms = parseForecastTimestamp(time, airQuality);
    if (ms === null || ms < now - 30 * 60 * 1000 || ms > end) return;
    const value = finiteValue(values[index]);
    if (value === null) return;
    if (peak === null || value > peak) {
      peak = value;
      peakTime = time;
    }
  });
  return peak === null ? null : { value: peak, time: peakTime };
}

function pollenSummary(data, airQuality = data?.airQuality) {
  if (!airQuality) return null;
  const entries = POLLEN_FIELDS.map((field) => {
    const current = airValueAt(data, field.key, airQuality);
    const peak = airPeakValue(data, field.key, 24, airQuality);
    const value = Math.max(current ?? -Infinity, peak?.value ?? -Infinity);
    const band = pollenBand(value);
    return band ? { key: field.key, name: field.label, value, current, peak, levelLabel: band.label, rank: band.rank } : null;
  }).filter(Boolean);
  if (!entries.length) return null;
  entries.sort((a, b) => b.rank - a.rank || b.value - a.value);
  const top = entries[0];
  const displayLabel = top.rank > 0 ? top.name : "pollen";
  return {
    label: displayLabel,
    type: top.name,
    value: top.value,
    level: top.levelLabel,
    levelLabel: top.levelLabel,
    rank: top.rank,
    peakTime: top.peak?.time || null
  };
}

function airQualitySummary(data = state.forecast) {
  const airQuality = data?.airQuality;
  if (!airQuality) return null;
  const aqi = airValueAt(data, "us_aqi", airQuality);
  const pm25 = airValueAt(data, "pm2_5", airQuality);
  const pm10 = airValueAt(data, "pm10", airQuality);
  const peak = airPeakValue(data, "us_aqi", 12, airQuality);
  const pollen = pollenSummary(data, airQuality);
  if (aqi === null && pm25 === null && pm10 === null && !pollen) return null;

  const band = aqi !== null ? aqiBand(aqi) : null;
  const peakAqi = peak?.value !== null && peak?.value !== undefined ? Math.round(peak.value) : null;
  const aqiRounded = aqi !== null ? Math.round(aqi) : null;
  const display = band?.mood || (pollen ? `${capitalize(pollen.label)} pollen` : "Air");
  const context = band
    ? `${band.short}${pollen && pollen.rank >= 2 ? ` · ${capitalize(pollen.label)} pollen ${pollen.levelLabel}` : ""}`
    : pollen
      ? `${capitalize(pollen.label)} pollen ${pollen.levelLabel}`
      : "Air data nearby";
  const headline = band && band.rank >= 2
    ? band.rank === 2 ? "air sensitive for some" : `${band.label.toLowerCase()} air`
    : pollen && pollen.rank >= 3
      ? `${pollen.label} pollen ${pollen.levelLabel}`
      : band && band.rank === 1
        ? "moderate air"
        : "air looks good";

  return {
    aqi: aqiRounded,
    pm25,
    pm10,
    peakAqi,
    peakTime: peak?.time || null,
    band,
    pollen,
    display,
    visualLabel: display,
    context,
    headline,
    source: "Open-Meteo/CAMS"
  };
}

function airQualityVisualHtml(air) {
  const band = air?.band;
  const aqi = air?.aqi;
  const level = aqi !== null && aqi !== undefined
    ? `${clamp(Math.round((Math.min(aqi, 300) / 300) * 100), 4, 100)}%`
    : "18%";
  const color = band?.color || "#7ca7ff";
  const glow = band?.glow || "rgba(124, 167, 255, 0.36)";
  const label = air?.visualLabel || "Air";
  const sub = aqi !== null && aqi !== undefined ? `AQI ${aqi}` : air?.context || "Air data";
  return `
    <span class="air-visual" aria-label="${escapeHtml(`${label}${aqi !== null && aqi !== undefined ? `, AQI ${aqi}` : ""}`)}">
      <span class="air-orb" style="--air-accent:${escapeHtml(color)};--air-glow:${escapeHtml(glow)};--air-level:${level};" aria-hidden="true">
        <span class="air-orb-core"></span>
        <span class="air-orb-mist"></span>
      </span>
      <span class="air-visual-copy">
        <b>${escapeHtml(label)}</b>
        <em>${escapeHtml(sub)}</em>
      </span>
    </span>`;
}

function airQualityTipHtml(air) {
  if (!air) return "";
  const currentRows = [
    air.aqi !== null ? ["AQI", `${air.aqi}`, air.band?.label || ""] : null,
    air.pm25 !== null ? ["PM2.5", `${Math.round(air.pm25)} ug/m3`, "Fine particles"] : null,
    air.pm10 !== null ? ["PM10", `${Math.round(air.pm10)} ug/m3`, "Coarse particles"] : null,
    air.pollen ? ["Pollen", `${capitalize(air.pollen.label)} ${air.pollen.levelLabel}`, "Outdoor allergens"] : null
  ].filter(Boolean);
  const scaleRows = AQI_SCALE.map((item) => `
    <li class="aqi-scale-row aqi-${escapeHtml(item.severity)}">
      <span class="aqi-scale-dot" style="--aqi-color:${escapeHtml(item.color)}" aria-hidden="true"></span>
      <strong>${escapeHtml(item.range)}</strong>
      <b>${escapeHtml(item.label)}</b>
      <em>${escapeHtml(item.note)}</em>
    </li>
  `).join("");
  const currentHtml = currentRows.map(([label, value, detail]) => `
    <div class="air-tip-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<em>${escapeHtml(detail)}</em>` : ""}
    </div>
  `).join("");
  return `
    <section class="air-tip">
      <header class="air-tip-head">
        <span class="air-tip-kicker">Air Quality Index</span>
        <strong>${escapeHtml(air.visualLabel || air.display || "Air")}</strong>
        <small>${escapeHtml(air.band?.advice || air.context || "Air data nearby.")}</small>
      </header>
      <div class="air-tip-stats">${currentHtml}</div>
      <div class="air-tip-scale">
        <span class="air-tip-scale-title">AQI ranges</span>
        <ol>${scaleRows}</ol>
      </div>
    </section>
  `;
}

function airGlance(data, humidityValue) {
  const air = airQualitySummary(data);
  if (air) {
    const pollenNote = air.pollen && air.pollen.rank >= 2
      ? `${capitalize(air.pollen.label)} pollen ${air.pollen.levelLabel}`
      : "";
    const peakNote = air.peakAqi !== null && air.aqi !== null && air.peakAqi >= air.aqi + 20
      ? `Peaks ${air.peakAqi}${air.peakTime ? ` near ${formatTime(air.peakTime)}` : ""}`
      : "";
    const context = [
      air.band?.advice || air.context,
      pollenNote,
      peakNote
    ].filter(Boolean).join(" · ");
    return {
      label: "Air",
      value: air.visualLabel,
      html: airQualityVisualHtml(air),
      tipHtml: airQualityTipHtml(air),
      context,
      visible: true,
      summary: air
    };
  }
  return {
    label: "Air",
    value: `${humidityValue}%`,
    context: humidityContext(humidityValue),
    visible: humidityValue >= 70 || humidityValue <= 30,
    summary: null
  };
}

function weatherTrendSummary(data = state.forecast) {
  const todayIndex = forecastDailyIndex(data);
  const tomorrowIndex = forecastDailyIndex(data, 1);
  const highs = data?.daily?.temperature_2m_max || [];
  const lows = data?.daily?.temperature_2m_min || [];
  const rain = data?.daily?.precipitation_probability_max || [];
  if (!highs.length) return null;

  const todayHigh = Math.round(highs[todayIndex] ?? highs[0]);
  const tomorrowHigh = Math.round(highs[tomorrowIndex] ?? highs[todayIndex] ?? highs[0]);
  const delta = tomorrowHigh - todayHigh;
  if (Math.abs(delta) >= 5) {
    return {
      label: "Trend",
      short: `Tomorrow ${delta > 0 ? "warms" : "cools"} ${Math.abs(delta)}°`,
      detail: `Tomorrow's high is ${tomorrowHigh}°, ${Math.abs(delta)}° ${delta > 0 ? "warmer" : "cooler"} than today.`
    };
  }

  const horizon = Math.min(7, highs.length);
  const startIndex = Math.min(Math.max(tomorrowIndex, 0), Math.max(0, horizon - 1));
  let wettest = startIndex;
  let hottest = startIndex;
  let coolest = startIndex;
  for (let i = startIndex + 1; i < horizon; i += 1) {
    if ((rain[i] || 0) > (rain[wettest] || 0)) wettest = i;
    if ((highs[i] || -Infinity) > (highs[hottest] || -Infinity)) hottest = i;
    if ((lows[i] || Infinity) < (lows[coolest] || Infinity)) coolest = i;
  }
  const wetChance = rain[wettest] || 0;
  if (wetChance >= 50) {
    return {
      label: "Trend",
      short: `${forecastDayShortLabel(data, wettest)} looks wettest`,
      detail: `${forecastDayShortLabel(data, wettest)} has the highest rain chance nearby at ${wetChance}%.`
    };
  }
  if (hottest !== todayIndex && highs[hottest] - todayHigh >= 4) {
    return {
      label: "Trend",
      short: `${forecastDayShortLabel(data, hottest)} looks warmest`,
      detail: `${forecastDayShortLabel(data, hottest)} has the warmest high nearby at ${Math.round(highs[hottest])}°.`
    };
  }
  if (coolest !== todayIndex && todayHigh - lows[coolest] >= 18) {
    return {
      label: "Trend",
      short: `${forecastDayShortLabel(data, coolest)} starts coolest`,
      detail: `${forecastDayShortLabel(data, coolest)} has the coolest low nearby at ${Math.round(lows[coolest])}°.`
    };
  }
  return {
    label: "Trend",
    short: "No big swing ahead",
    detail: "Temperatures and rain chances stay fairly steady nearby."
  };
}

function forecastDayShortLabel(data, index) {
  if (index === forecastDailyIndex(data)) return "Today";
  if (index === forecastDailyIndex(data, 1)) return "Tomorrow";
  const value = data?.daily?.time?.[index];
  if (!value) return "Later";
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function outdoorInsight(data) {
  const air = airQualitySummary(data);
  const trend = weatherTrendSummary(data);
  if (!air && !trend) return null;

  if (!air) return { label: "Trend", value: trend.detail };

  const airLead = air.band && air.band.rank >= 2
    ? air.band.rank === 2 ? `Air sensitive for some (AQI ${air.aqi})` : `${air.band.label} air (AQI ${air.aqi})`
    : air.pollen && air.pollen.rank >= 3
      ? `${capitalize(air.pollen.label)} pollen ${air.pollen.levelLabel}`
      : air.aqi !== null
        ? `${air.band.label} air (AQI ${air.aqi})`
        : air.context;
  const peakNote = air.peakAqi !== null && air.aqi !== null && air.peakAqi >= air.aqi + 20
    ? `, peaks ${air.peakAqi}${air.peakTime ? ` near ${formatTime(air.peakTime)}` : ""}`
    : "";
  const trendNote = trend ? ` ${trend.short}.` : "";
  return {
    label: "Air & trend",
    value: `${airLead}${peakNote}.${trendNote}`.trim()
  };
}

function renderDaylightGlance(data, uvVal, dayIndex = forecastDailyIndex(data)) {
  const tomorrowIndex = forecastDailyIndex(data, 1);
  const sunriseISO = data.daily.sunrise[dayIndex];
  const sunsetISO = data.daily.sunset[dayIndex];
  const tomorrowSunriseISO = data.daily.sunrise[tomorrowIndex];
  const sunriseMs = sunriseISO ? parseForecastTimestamp(sunriseISO, data) : null;
  const sunsetMs = sunsetISO ? parseForecastTimestamp(sunsetISO, data) : null;
  const tomorrowSunriseMs = tomorrowSunriseISO ? parseForecastTimestamp(tomorrowSunriseISO, data) : null;
  const nowMs = forecastNowMs(data);
  let summary = "--";
  let context = "Daylight timing is unavailable.";
  const uv = sunRiskWindow(data, sunriseMs, sunsetMs, uvVal);
  const sunMode = sunExposureMode(data, sunriseMs, sunsetMs);

  if (sunMode === "normal") {
    if (els.sunrise) els.sunrise.textContent = sunriseISO ? formatTime(sunriseISO) : "--";
    if (els.sunset) els.sunset.textContent = sunsetISO ? formatTime(sunsetISO) : "--";
    if (nowMs < sunriseMs) {
      summary = `Sunrise in ${durationBrief(sunriseMs - nowMs)}`;
      context = `First light starts at ${formatTime(sunriseISO)}. ${uv.context}`;
    } else if (nowMs > sunsetMs) {
      summary = "Dark now";
      context = tomorrowSunriseMs
        ? `Next sunrise is ${formatTime(tomorrowSunriseISO)}.`
        : `Sunset was ${formatTime(sunsetISO)}.`;
    } else {
      const remaining = sunsetMs - nowMs;
      summary = remaining <= 90 * 60 * 1000
        ? `Sunset in ${durationBrief(remaining)}`
        : `${durationBrief(remaining)} daylight left`;
      context = uv.context;
    }
  } else if (sunMode === "polar-day") {
    summary = "Sun stays up";
    if (els.sunrise) els.sunrise.textContent = "All day";
    if (els.sunset) els.sunset.textContent = "No sunset";
    context = uv.context === "Low sun risk today."
      ? "The sun stays above the horizon today."
      : uv.context;
  } else if (sunMode === "polar-night") {
    summary = "No daylight today";
    if (els.sunrise) els.sunrise.textContent = "No sunrise";
    if (els.sunset) els.sunset.textContent = "No sunset";
    context = tomorrowSunriseISO
      ? `Next sunrise is ${formatTime(tomorrowSunriseISO)}.`
      : "The sun stays below the horizon today.";
  }

  if (els.daylightCard) {
    els.daylightCard.classList.remove("uv-low", "uv-moderate", "uv-high", "uv-very-high", "uv-extreme");
    els.daylightCard.classList.add(`uv-${uv.severity}`);
  }
  if (els.daylightSummary) els.daylightSummary.textContent = summary;
  if (els.daylightContext) els.daylightContext.textContent = context;
  renderSunPath(data, sunriseMs, sunsetMs, tomorrowSunriseMs, nowMs, uv);
  if (els.uvLabel) els.uvLabel.textContent = "UV risk";
  if (els.uv) els.uv.textContent = uv.display;
}

function renderSunPath(data, sunriseMs, sunsetMs, tomorrowSunriseMs, nowMs, uv) {
  const chart = sunChartGeometry(data, sunriseMs, sunsetMs, tomorrowSunriseMs, 0);
  if (!chart) {
    [els.daylightNightPath, els.daylightFill, els.daylightUvBand].forEach((path) => {
      if (path) path.setAttribute("d", "");
    });
    if (els.daylightNowMarker) els.daylightNowMarker.setAttribute("hidden", "");
    if (els.daylightNowBadge) els.daylightNowBadge.hidden = true;
    resetDaylightScrub();
    return;
  }

  if (els.daylightHorizon) {
    els.daylightHorizon.setAttribute("x1", String(chart.left));
    els.daylightHorizon.setAttribute("x2", String(chart.right));
    els.daylightHorizon.setAttribute("y1", String(chart.horizonY));
    els.daylightHorizon.setAttribute("y2", String(chart.horizonY));
  }
  if (els.daylightNightPath) {
    const path = chart.mode === "polar-day" ? "" : sunPathSegment(chart, chart.dayStartMs, chart.dayEndMs, 96);
    els.daylightNightPath.setAttribute("d", path);
  }
  if (els.daylightFill) {
    const path = chart.mode === "polar-night"
      ? ""
      : sunPathSegment(chart, chart.daylightStartMs, chart.daylightEndMs, 64);
    els.daylightFill.setAttribute("d", path);
  }
  if (els.daylightUvBand) {
    const showBand = uv.showBand && uv.startMs && uv.endMs && uv.endMs > uv.startMs;
    if (showBand) {
      els.daylightUvBand.setAttribute("d", sunPathSegment(chart, uv.startMs, uv.endMs, 24));
      els.daylightUvBand.removeAttribute("hidden");
    } else {
      els.daylightUvBand.setAttribute("d", "");
      els.daylightUvBand.setAttribute("hidden", "");
    }
  }

  positionDaylightNowMarker(chart, nowMs);

  const nowPoint = sunPathPoint(chart, nowMs);
  positionSunMarker(els.daylightNow, nowPoint, chart);
  positionSunMarker(els.daylightNowGlow, nowPoint, chart);
  [els.daylightNow, els.daylightNowGlow].forEach((marker) => {
    if (!marker) return;
    const isDay = nowPoint.y < chart.horizonY;
    marker.classList.toggle("is-day", isDay);
    marker.classList.toggle("is-night", !isDay);
  });

  if (els.daylightUv) {
    const peakMs = uv.peakMs || sunPeakMs(chart);
    positionSunMarker(els.daylightUv, sunPathPoint(chart, peakMs), chart);
    els.daylightUv.hidden = !uv.showMarker;
  }

  setupDaylightScrub(data, chart, nowMs, uv);
}

function positionDaylightNowMarker(chart, nowMs) {
  if (!els.daylightNowMarker || !chart || nowMs < chart.dayStartMs || nowMs > chart.dayEndMs) {
    if (els.daylightNowMarker) els.daylightNowMarker.setAttribute("hidden", "");
    if (els.daylightNowBadge) els.daylightNowBadge.hidden = true;
    return;
  }
  const point = sunPathPoint(chart, nowMs);
  const x = roundSvg(point.x);
  els.daylightNowLine?.setAttribute("x1", x);
  els.daylightNowLine?.setAttribute("x2", x);
  if (els.daylightNowBadge) {
    els.daylightNowBadge.style.setProperty("--now-x", `${(point.x / chart.width) * 100}%`);
    els.daylightNowBadge.hidden = false;
  }
  els.daylightNowMarker.removeAttribute("hidden");
}

function sunChartGeometry(data, sunriseMs, sunsetMs, tomorrowSunriseMs, offsetDays = 0) {
  const dayStartMs = forecastLocalBoundaryMs(data, 0, offsetDays);
  const dayEndMs = forecastLocalBoundaryMs(data, 24, offsetDays);
  if (!dayStartMs || !dayEndMs || dayEndMs <= dayStartMs) return null;

  const mode = sunExposureMode(data, sunriseMs, sunsetMs, offsetDays);
  const validSunWindow = mode === "normal";
  const safeSunriseMs = validSunWindow ? sunriseMs : dayStartMs;
  const safeSunsetMs = validSunWindow ? sunsetMs : dayEndMs;
  const dayHours = validSunWindow
    ? Math.max(0, Math.min(24, (Math.min(safeSunsetMs, dayEndMs) - Math.max(safeSunriseMs, dayStartMs)) / 3600000))
    : mode === "polar-day" ? 24 : 0;
  const previousSunsetMs = validSunWindow ? safeSunsetMs - 24 * 60 * 60 * 1000 : null;
  const nextSunriseMs = validSunWindow ? tomorrowSunriseMs || safeSunriseMs + 24 * 60 * 60 * 1000 : null;
  return {
    mode,
    width: 320,
    height: 136,
    left: 8,
    right: 312,
    horizonY: 76,
    dayStartMs,
    dayEndMs,
    sunriseMs: safeSunriseMs,
    sunsetMs: safeSunsetMs,
    tomorrowSunriseMs,
    previousSunsetMs,
    nextSunriseMs,
    daylightStartMs: validSunWindow ? safeSunriseMs : dayStartMs,
    daylightEndMs: validSunWindow ? safeSunsetMs : dayEndMs,
    dayAmplitude: clamp(24 + ((dayHours - 8) / 8) * 34, 22, 58),
    nightDepth: clamp(18 + (((24 - dayHours) - 8) / 8) * 20, 18, 44)
  };
}

function sunPathSegment(chart, startMs, endMs, samples) {
  const start = Math.max(chart.dayStartMs, startMs);
  const end = Math.min(chart.dayEndMs, endMs);
  if (end <= start) return "";
  const steps = Math.max(2, samples);
  const points = [];
  for (let i = 0; i <= steps; i++) {
    points.push(sunPathPoint(chart, start + ((end - start) * i) / steps));
  }
  return points
    .map((point, index) => `${index ? "L" : "M"} ${roundSvg(point.x)} ${roundSvg(point.y)}`)
    .join(" ");
}

function sunPathPoint(chart, ms) {
  const tDay = Math.max(0, Math.min(1, (ms - chart.dayStartMs) / (chart.dayEndMs - chart.dayStartMs)));
  const x = chart.left + tDay * (chart.right - chart.left);
  let y = chart.horizonY;

  if (chart.mode === "polar-day") {
    y = chart.horizonY - 14 - chart.dayAmplitude * 0.72 * Math.sin(tDay * Math.PI);
  } else if (chart.mode === "polar-night") {
    y = chart.horizonY + 12 + chart.nightDepth * 0.72 * Math.sin(tDay * Math.PI);
  } else if (ms < chart.sunriseMs) {
    y = sunNightY(chart, ms, chart.previousSunsetMs, chart.sunriseMs);
  } else if (ms <= chart.sunsetMs) {
    const t = Math.max(0, Math.min(1, (ms - chart.sunriseMs) / (chart.sunsetMs - chart.sunriseMs)));
    y = chart.horizonY - chart.dayAmplitude * Math.sin(t * Math.PI);
  } else {
    y = sunNightY(chart, ms, chart.sunsetMs, chart.nextSunriseMs);
  }

  return { x, y };
}

function sunNightY(chart, ms, nightStartMs, nightEndMs) {
  if (!nightStartMs || !nightEndMs || nightEndMs <= nightStartMs) {
    return chart.horizonY + chart.nightDepth;
  }
  const t = Math.max(0, Math.min(1, (ms - nightStartMs) / (nightEndMs - nightStartMs)));
  return chart.horizonY + chart.nightDepth * Math.sin(t * Math.PI);
}

function sunPeakMs(chart) {
  if (!chart) return null;
  if (chart.mode === "normal") return chart.sunriseMs + (chart.sunsetMs - chart.sunriseMs) / 2;
  return chart.dayStartMs + (chart.dayEndMs - chart.dayStartMs) / 2;
}

function sunExposureMode(data, sunriseMs, sunsetMs, offsetDays = 0) {
  const rows = sunExposureRows(data, offsetDays);
  const hasDay = rows.some((row) => row.isDay);
  const hasNight = rows.some((row) => !row.isDay);
  if (hasDay && !hasNight) return "polar-day";
  if (hasNight && !hasDay) return "polar-night";
  if (sunriseMs && sunsetMs && sunsetMs > sunriseMs) return "normal";
  return offsetDays === 0 && data?.current?.is_day ? "polar-day" : "polar-night";
}

function todaySunMode(data) {
  const dayIndex = forecastDailyIndex(data);
  const sunriseMs = data?.daily?.sunrise?.[dayIndex] ? parseForecastTimestamp(data.daily.sunrise[dayIndex], data) : null;
  const sunsetMs = data?.daily?.sunset?.[dayIndex] ? parseForecastTimestamp(data.daily.sunset[dayIndex], data) : null;
  return sunExposureMode(data, sunriseMs, sunsetMs);
}

function sunExposureRows(data, offsetDays = 0) {
  const day = forecastLocalDate(data, offsetDays);
  return data?.hourly?.time?.map((time, index) => ({
    time,
    isDay: data.hourly.is_day ? Boolean(data.hourly.is_day[index]) : null
  })).filter((row) => row.isDay !== null && datePart(row.time) === day) || [];
}

function positionSunMarker(marker, point, chart) {
  if (!marker || !point || !chart) return;
  marker.style.setProperty("--sun-x", `${(point.x / chart.width) * 100}%`);
  marker.style.setProperty("--sun-y", `${(point.y / chart.height) * 100}%`);
}

function setupDaylightScrub(data, chart, nowMs, uv = null) {
  daylightScrub.data = data;
  daylightScrub.chart = chart;
  daylightScrub.uv = uv;
  daylightScrub.points = buildDaylightScrubPoints(data, chart);
  daylightScrub.defaultIndex = nearestDaylightPointIndexByMs(nowMs);
  daylightScrub.activeIndex = daylightScrub.defaultIndex;
  updateDaylightScrub(daylightScrub.defaultIndex, { showGuide: false });
}

function resetDaylightScrub() {
  daylightScrub.chart = null;
  daylightScrub.data = null;
  daylightScrub.uv = null;
  daylightScrub.points = [];
  daylightScrub.defaultIndex = 0;
  daylightScrub.activeIndex = 0;
  clearTimeout(daylightScrub.restoreTimer);
  if (els.daylightScrubGuide) els.daylightScrubGuide.setAttribute("hidden", "");
  if (els.daylightArc) {
    els.daylightArc.classList.remove("is-scrubbing");
    els.daylightArc.setAttribute("aria-valuenow", "0");
    els.daylightArc.setAttribute("aria-valuetext", "Light and sun details unavailable");
  }
  if (els.daylightReadoutTime) els.daylightReadoutTime.textContent = "Now";
  if (els.daylightReadoutTitle) els.daylightReadoutTitle.textContent = "--";
  if (els.daylightReadoutMeta) els.daylightReadoutMeta.textContent = "--";
}

function buildDaylightScrubPoints(data, chart) {
  const samples = 96; // 15-minute steps give the small chart a smooth but stable feel.
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const ms = chart.dayStartMs + ((chart.dayEndMs - chart.dayStartMs) * i) / samples;
    const point = sunPathPoint(chart, ms);
    const hourly = nearestHourlyAt(data, ms);
    const isDay = sunPointIsDay(chart, ms);
    points.push({
      ms,
      x: point.x,
      y: point.y,
      isDay,
      uv: Number(hourly?.uv ?? 0),
      temp: hourly?.temp,
      rain: hourly?.rain
    });
  }
  return points;
}

function nearestHourlyAt(data, ms) {
  const bestIndex = nearestHourlyIndexAt(data, ms);
  if (bestIndex < 0) return null;
  return {
    uv: data.hourly.uv_index?.[bestIndex],
    temp: data.hourly.temperature_2m?.[bestIndex],
    rain: data.hourly.precipitation_probability?.[bestIndex],
    isDay: data.hourly.is_day ? Boolean(data.hourly.is_day[bestIndex]) : null
  };
}

function nearestHourlyIndexAt(data, ms, maxDistanceMs = Infinity) {
  const times = data?.hourly?.time || [];
  if (!times.length || ms === null || ms === undefined) return -1;
  let bestIndex = -1;
  let bestDistance = Infinity;
  times.forEach((time, index) => {
    const rowMs = parseForecastTimestamp(time, data);
    if (rowMs === null) return;
    const distance = Math.abs(rowMs - ms);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestDistance <= maxDistanceMs ? bestIndex : -1;
}

function sunPointIsDay(chart, ms) {
  if (chart.mode === "polar-day") return true;
  if (chart.mode === "polar-night") return false;
  return ms >= chart.sunriseMs && ms <= chart.sunsetMs;
}

function updateDaylightScrub(index, { showGuide = true } = {}) {
  const point = daylightScrub.points[index];
  const chart = daylightScrub.chart;
  const data = daylightScrub.data;
  if (!point || !chart || !data) return;

  daylightScrub.activeIndex = index;
  positionSunMarker(els.daylightNow, point, chart);
  positionSunMarker(els.daylightNowGlow, point, chart);
  [els.daylightNow, els.daylightNowGlow].forEach((marker) => {
    if (!marker) return;
    marker.classList.toggle("is-day", point.isDay);
    marker.classList.toggle("is-night", !point.isDay);
  });

  if (els.daylightScrubGuide) {
    els.daylightScrubGuide.setAttribute("x1", roundSvg(point.x));
    els.daylightScrubGuide.setAttribute("x2", roundSvg(point.x));
    if (showGuide) els.daylightScrubGuide.removeAttribute("hidden");
    else els.daylightScrubGuide.setAttribute("hidden", "");
  }
  if (els.daylightArc) {
    const dayPct = percentBetween(point.ms, chart.dayStartMs, chart.dayEndMs);
    const valueNow = Math.round((dayPct / 100) * 24 * 10) / 10;
    const copy = daylightReadoutCopy(point, data, chart, daylightScrub.uv);
    els.daylightArc.classList.toggle("is-scrubbing", showGuide);
    els.daylightArc.setAttribute("aria-valuenow", String(valueNow));
    els.daylightArc.setAttribute("aria-valuetext", `${copy.time}: ${copy.title}. ${copy.meta}`);
    if (els.daylightReadoutTime) els.daylightReadoutTime.textContent = copy.time;
    if (els.daylightReadoutTitle) els.daylightReadoutTitle.textContent = copy.title;
    if (els.daylightReadoutMeta) els.daylightReadoutMeta.textContent = copy.meta;
    positionDaylightReadout(point, chart);
  }
}

function positionDaylightReadout(point, chart) {
  if (!els.daylightArc || !els.daylightReadout || !point || !chart) return;
  const wrapWidth = els.daylightArc.clientWidth;
  const calloutWidth = els.daylightReadout.offsetWidth;
  if (!wrapWidth || !calloutWidth) return;

  const px = (point.x / chart.width) * wrapWidth;
  const minLeft = calloutWidth / 2 + 2;
  const maxLeft = Math.max(minLeft, wrapWidth - calloutWidth / 2 - 2);
  const left = clamp(px, minLeft, maxLeft);
  const pointerX = clamp(px - (left - calloutWidth / 2), 8, calloutWidth - 8);
  els.daylightReadout.style.left = `${left}px`;
  els.daylightReadout.style.setProperty("--pointer-x", `${pointerX}px`);
}

function daylightReadoutCopy(point, data, chart, uvWindow = null) {
  const nowish = Math.abs(point.ms - forecastNowMs(data)) <= 16 * 60 * 1000;
  const time = nowish ? "Now" : formatForecastMs(point.ms, data);
  const uvValue = Math.max(0, Math.round(point.uv || 0));
  const risk = uvRisk(uvValue);
  let title = point.isDay ? "Day" : "Night";
  let meta = point.isDay ? uvReadoutMeta(point, data, uvWindow) : "No UV risk";

  if (chart.mode === "polar-day") {
    title = "All day";
    meta = uvReadoutMeta(point, data, uvWindow);
  } else if (chart.mode === "polar-night") {
    title = "Night";
    meta = "No UV risk";
  } else if (isNearTime(point.ms, chart.sunriseMs, 18 * 60 * 1000)) {
    title = "Sunrise";
    meta = "Light begins";
  } else if (isNearTime(point.ms, chart.sunsetMs, 18 * 60 * 1000)) {
    title = "Sunset";
    meta = "Light fades";
  } else if (point.isDay && uvValue >= 6) {
    title = `${risk.label} UV`;
  }

  return { time, title, meta };
}

function uvReadoutMeta(point, data, uvWindow = null) {
  const uvValue = Math.max(0, Math.round(point.uv || 0));
  const risk = uvRisk(uvValue);
  if (uvValue < 1) return "UV 0";

  if (uvWindow?.startMs && uvWindow?.endMs && point.ms >= uvWindow.startMs && point.ms <= uvWindow.endMs) {
    return `${risk.label} UV ${uvValue} · until ${formatForecastMs(uvWindow.endMs, data)}`;
  }
  if (uvWindow?.startMs && point.ms < uvWindow.startMs) {
    return `${risk.label} UV ${uvValue} · higher near ${formatForecastMs(uvWindow.startMs, data)}`;
  }
  if (uvWindow?.endMs && point.ms > uvWindow.endMs && uvWindow?.peakMs) {
    return `${risk.label} UV ${uvValue} · peaked ${formatForecastMs(uvWindow.peakMs, data)}`;
  }
  return `${risk.label} UV ${uvValue}`;
}

function formatForecastMs(ms, data = state.forecast) {
  const local = new Date(ms + forecastOffsetMs(data));
  return formatClock(local.getUTCHours(), local.getUTCMinutes());
}

function isNearTime(ms, targetMs, toleranceMs) {
  return targetMs && Math.abs(ms - targetMs) <= toleranceMs;
}

function nearestDaylightPointIndexByMs(ms) {
  if (!daylightScrub.points.length) return 0;
  let best = 0;
  let bestDistance = Infinity;
  daylightScrub.points.forEach((point, index) => {
    const distance = Math.abs(point.ms - ms);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function nearestDaylightPointIndexFromClientX(clientX) {
  if (!els.daylightArc || !daylightScrub.points.length) return 0;
  const rect = els.daylightArc.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * daylightScrub.chart.width;
  let best = 0;
  let bestDistance = Infinity;
  daylightScrub.points.forEach((point, index) => {
    const distance = Math.abs(point.x - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function scheduleDaylightDefaultRestore() {
  clearTimeout(daylightScrub.restoreTimer);
  daylightScrub.restoreTimer = setTimeout(() => {
    updateDaylightScrub(daylightScrub.defaultIndex, { showGuide: false });
  }, 650);
}

function roundSvg(value) {
  return Math.round(value * 10) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function durationBrief(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "now";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function sunRiskWindow(data, sunriseMs, sunsetMs, fallbackUv, offsetDays = 0) {
  const dayStartMs = forecastLocalBoundaryMs(data, 0, offsetDays);
  const dayEndMs = forecastLocalBoundaryMs(data, 24, offsetDays);
  const hasSunWindow = Boolean(sunriseMs && sunsetMs && sunsetMs > sunriseMs);
  const low = {
    display: `Low ${Math.round(fallbackUv || 0)}`,
    severity: "low",
    peakPct: 50,
    startPct: 0,
    widthPct: 0,
    startMs: null,
    endMs: null,
    peakMs: null,
    showBand: false,
    showMarker: false,
    context: "Low sun risk today."
  };
  if (!data?.hourly?.time?.length || !data?.hourly?.uv_index?.length || !dayStartMs || !dayEndMs) {
    const fallback = Math.round(fallbackUv || 0);
    if (fallback < 3) return { ...low, display: `Low ${fallback}` };
    const risk = uvRisk(fallback);
    return {
      ...low,
      display: `${risk.label} ${fallback}`,
      severity: risk.severity,
      peakMs: hasSunWindow ? sunriseMs + (sunsetMs - sunriseMs) / 2 : dayStartMs + (dayEndMs - dayStartMs) / 2,
      showMarker: true,
      context: `${risk.label} UV peaks at ${fallback}.`
    };
  }

  const day = forecastLocalDate(data, offsetDays);
  const rows = data.hourly.time
    .map((time, index) => ({
      time,
      index,
      value: Number(data.hourly.uv_index[index] || 0),
      ms: parseForecastTimestamp(time, data)
    }))
    .filter((row) =>
      row.ms !== null &&
      datePart(row.time) === day &&
      row.ms >= (hasSunWindow ? sunriseMs - 60 * 60 * 1000 : dayStartMs) &&
      row.ms <= (hasSunWindow ? sunsetMs + 60 * 60 * 1000 : dayEndMs) &&
      Number.isFinite(row.value)
    );

  if (!rows.length) return low;

  const peak = rows.reduce((best, row) => row.value > best.value ? row : best, rows[0]);
  const peakValue = Math.round(peak.value);
  const risk = uvRisk(peakValue);
  const threshold = peakValue >= 6 ? 6 : peakValue >= 3 ? 3 : 0;
  let activeRows = threshold ? rows.filter((row) => Math.round(row.value) >= threshold) : [];
  if (threshold && !activeRows.length) activeRows = [peak];
  const first = activeRows[0];
  const last = activeRows[activeRows.length - 1];
  const endTime = last ? data.hourly.time[last.index + 1] || last.time : null;
  const endMs = endTime ? parseForecastTimestamp(endTime, data) : last ? last.ms + 60 * 60 * 1000 : null;
  const percentStartMs = hasSunWindow ? sunriseMs : dayStartMs;
  const percentEndMs = hasSunWindow ? sunsetMs : dayEndMs;
  const startPct = first ? percentBetween(Math.max(first.ms, percentStartMs), percentStartMs, percentEndMs) : 0;
  const endPct = endMs ? percentBetween(Math.min(endMs, percentEndMs), percentStartMs, percentEndMs) : startPct;
  const widthPct = Math.max(0, endPct - startPct);
  const nowMs = forecastNowMs(data);
  const peakPct = percentBetween(peak.ms, percentStartMs, percentEndMs);
  const peakTime = formatTime(peak.time);
  const display = `${risk.label} ${peakValue}`;
  let context = peakValue < 3
    ? "Low sun risk today."
    : `${risk.label} UV peaks around ${peakTime}.`;

  if (first && endMs && peakValue >= 3) {
    if (nowMs < first.ms) {
      context = `${risk.label} UV starts around ${formatTime(first.time)}.`;
    } else if (nowMs <= endMs) {
      context = `${risk.label} UV now; eases around ${formatTime(endTime || last.time)}.`;
    } else {
      context = `${risk.label} UV window has passed.`;
    }
  }

  return {
    display,
    severity: risk.severity,
    peakPct,
    startPct,
    widthPct,
    startMs: first ? first.ms : null,
    endMs,
    peakMs: peak.ms,
    showBand: peakValue >= 3 && widthPct > 0,
    showMarker: peakValue >= 3,
    context
  };
}

function percentBetween(ms, startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return 0;
  return Math.max(0, Math.min(100, ((ms - startMs) / (endMs - startMs)) * 100));
}

function uvRisk(value) {
  if (value >= 11) return { label: "Extreme", severity: "extreme" };
  if (value >= 8) return { label: "Very high", severity: "very-high" };
  if (value >= 6) return { label: "High", severity: "high" };
  if (value >= 3) return { label: "Moderate", severity: "moderate" };
  return { label: "Low", severity: "low" };
}

function renderLaunchSummaryStrip(data, tempUnit, windUnit, truth = weatherTruth(data)) {
  if (!els.nowSummary) return;
  const items = launchSummaryItems(data, tempUnit, windUnit, truth);
  launchSummaryTargets = items.map((item) => item.target || null);
  els.nowSummary.classList.add("summary-strip");
  els.nowSummary.innerHTML = items.map((item, index) => (
    `<button class="summary-strip-item is-${escapeHtml(item.tone || "neutral")}" type="button" data-summary-index="${index}" aria-label="${escapeHtml(summaryItemAria(item))}" title="${escapeHtml(item.receipt || item.value)}">` +
      `<b>${escapeHtml(item.label)}</b>` +
      `<strong>${escapeHtml(item.value)}</strong>` +
      `<span class="summary-strip-cue" aria-hidden="true">›</span>` +
    `</button>`
  )).join("");
  els.nowSummary.setAttribute("aria-label", `${items.map((item) => `${item.label}: ${item.value}`).join(". ")}. Tap a chip for hourly details.`);
}

function renderLaunchShortcuts(data, place) {
  if (!els.launchShortcuts) return;
  els.launchShortcuts.hidden = !(data && place);
}

function refreshPlanAwareLaunchSurfaces(data = state.forecast, place = state.activePlace) {
  if (!data || !place) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const truth = state.weatherTruth || weatherTruth(data);
  renderForYouToday(data, place, tempUnit, windUnit, truth);
  renderLaunchShortcuts(data, place);
  syncNativeStormActivity(data, place, truth);
  updateInstallPromptUI();
}

function syncNativeWidgetSnapshot(data = state.forecast, place = state.activePlace, truth = state.weatherTruth || weatherTruth(data)) {
  if (!window.NearcastNative?.postMessage || !data || !place) return;
  try {
    const normalizedWidgetPlace = normalizePlace(place);
    const widgetPlaceDisplayName = placeLabel(normalizedWidgetPlace);
    const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
    const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
    const todayIndex = forecastDailyIndex(data);
    const current = data.current || {};
    const items = launchSummaryItems(data, tempUnit, windUnit, truth);
    const item = (index, fallbackLabel, fallbackValue) => items[index] || { label: fallbackLabel, value: fallbackValue };
    const high = data.daily?.temperature_2m_max?.[todayIndex];
    const low = data.daily?.temperature_2m_min?.[todayIndex];
    const sunriseAt = data.daily?.sunrise?.[todayIndex]
      ? parseForecastTimestamp(data.daily.sunrise[todayIndex], data)
      : null;
    const sunsetAt = data.daily?.sunset?.[todayIndex]
      ? parseForecastTimestamp(data.daily.sunset[todayIndex], data)
      : null;
    const windDirection = normalizeWindDegrees(current.wind_direction_10m);
    const windCue = windDirectionCue(current.wind_direction_10m);
    const widgetPlan = nativeWidgetPlanSummary(data, place);
    const watchSummary = nativeWidgetWatchSummary(data, place, truth, widgetPlan);
    const forecastSavedAt = forecastProvenance(data).savedAt;
    const snapshotSavedAt = (forecastSavedAt || Date.now()) / 1000;
    const snapshot = {
      version: 6,
      savedAt: snapshotSavedAt,
      placeName: widgetPlaceDisplayName,
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      high: Number.isFinite(high) ? Math.round(high) : null,
      low: Number.isFinite(low) ? Math.round(low) : null,
      condition: truth?.label || weatherCodes[truth?.nowCode] || "Weather",
      conditionCode: Number(truth?.nowCode ?? current.weather_code ?? 0),
      isDay: Boolean(truth?.isDay),
      rainChance: Math.round(truth?.rainChance ?? currentRainChance(data) ?? 0),
      wind: Math.round(current.wind_speed_10m || 0),
      windUnit,
      windDirection,
      windLabel: windCue?.label || null,
      uv: currentUvIndex(data, todayIndex),
      nowLabel: item(0, "Now", "Open Nearcast").label,
      nowValue: item(0, "Now", "Open Nearcast").value,
      nextLabel: item(1, "Next", "Check forecast").label,
      nextValue: item(1, "Next", "Check forecast").value,
      laterLabel: item(2, "Later", "Plan ahead").label,
      laterValue: item(2, "Later", "Plan ahead").value,
      planTitle: widgetPlan?.title || null,
      planLabel: widgetPlan?.label || null,
      planDetail: widgetPlan?.detail || null,
      planPlace: widgetPlan?.place || null,
      planTone: widgetPlan?.tone || null,
      watchStatus: watchSummary.status,
      watchDetail: watchSummary.detail,
      watchTone: watchSummary.tone,
      timeline: nativeWidgetTimeline(data),
      daily: nativeWidgetDaily(data),
      sunriseAt: Number.isFinite(sunriseAt) ? sunriseAt / 1000 : null,
      sunsetAt: Number.isFinite(sunsetAt) ? sunsetAt / 1000 : null,
      isAvailable: true,
      weatherSavedAt: snapshotSavedAt,
      planSavedAt: widgetPlan ? snapshotSavedAt : null,
      planId: widgetPlan?.id || null,
      planAvailable: Boolean(widgetPlan),
      planRisk: widgetPlan?.risk || null,
      planStartAt: widgetPlan?.startAt || null,
      planEndAt: widgetPlan?.endAt || null
    };
    window.NearcastNative.postMessage({
      type: "widget.snapshot",
      snapshot,
      place: {
        id: normalizedWidgetPlace.id,
        name: normalizedWidgetPlace.name,
        displayName: widgetPlaceDisplayName,
        admin1: normalizedWidgetPlace.admin1,
        country: normalizedWidgetPlace.country,
        countryCode: normalizedWidgetPlace.countryCode,
        latitude: Number(normalizedWidgetPlace.latitude),
        longitude: Number(normalizedWidgetPlace.longitude)
      }
    });
  } catch (error) {
    console.debug("[Nearcast native] Widget snapshot skipped", error);
  }
}

function nativeWidgetTimeline(data = state.forecast) {
  const hourly = data?.hourly || {};
  const times = hourly.time || [];
  const startIndex = currentHourlyIndex(data);
  if (startIndex < 0 || !times[startIndex]) return [];
  const rows = [];
  for (let index = startIndex; index < times.length && rows.length < 6; index += 1) {
    const offsetHours = rows.length;
    const roundOrNull = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.round(number) : null;
    };
    const startsAt = parseForecastTimestamp(times[index], data);
    rows.push({
      offsetHours,
      timeLabel: shortClock(times[index]),
      temperature: roundOrNull(hourly.temperature_2m?.[index]),
      feelsLike: roundOrNull(hourly.apparent_temperature?.[index]),
      rainChance: roundOrNull(hourly.precipitation_probability?.[index]),
      wind: roundOrNull(hourly.wind_speed_10m?.[index]),
      windGust: roundOrNull(hourly.wind_gusts_10m?.[index]),
      windDirection: normalizeWindDegrees(hourly.wind_direction_10m?.[index]),
      uv: roundOrNull(hourly.uv_index?.[index]),
      conditionCode: roundOrNull(hourly.weather_code?.[index]),
      isDay: hourly.is_day ? Boolean(hourly.is_day[index]) : null,
      startsAt: Number.isFinite(startsAt)
        ? startsAt / 1000
        : null
    });
  }
  return rows;
}

function nativeWidgetDaily(data = state.forecast) {
  const daily = data?.daily || {};
  const dates = daily.time || [];
  const startIndex = Math.max(0, forecastDailyIndex(data));
  const rows = [];
  for (let index = startIndex; index < dates.length && rows.length < 3; index += 1) {
    const numberOrZero = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    rows.push({
      date: dates[index],
      label: formatDay(dates[index], rows.length),
      high: numberOrZero(daily.temperature_2m_max?.[index]),
      low: numberOrZero(daily.temperature_2m_min?.[index]),
      rainChance: numberOrZero(daily.precipitation_probability_max?.[index]),
      conditionCode: numberOrZero(daily.weather_code?.[index])
    });
  }
  return rows;
}

function syncNativeStormActivity(data = state.forecast, place = state.activePlace, truth = state.weatherTruth || weatherTruth(data)) {
  const bridge = window.NearcastNative?.stormActivity;
  if (!bridge?.supported || !data || !place) return;
  if (state.nativeStormActivityDebug?.active) return;
  if (!nativeStormActivitySavedPlace(place)) {
    if (state.nativeStormActivityKey) {
      state.nativeStormActivityKey = "";
      state.nativeStormActivitySyncedAt = 0;
      bridge.end({
        status: "Storm watch ended",
        detail: "Nearcast only tracks storm activities for saved places.",
        confidence: "Ended"
      }).catch(() => {});
    }
    return;
  }

  const candidate = nativeStormActivityCandidate(data, place, truth);
  if (!candidate) {
    if (state.nativeStormActivityKey) {
      state.nativeStormActivityKey = "";
      state.nativeStormActivitySyncedAt = 0;
      bridge.end({
        status: "Storm watch ended",
        detail: "Nearcast no longer sees incoming rain or storms for this place.",
        confidence: "Ended"
      }).catch(() => {});
    }
    return;
  }

  if (candidate.key === state.nativeStormActivityKey && Date.now() - Number(state.nativeStormActivitySyncedAt || 0) < 4 * 60 * 1000) return;
  state.nativeStormActivityKey = candidate.key;
  state.nativeStormActivitySyncedAt = Date.now();
  bridge.start(candidate).catch(() => {
    if (state.nativeStormActivityKey === candidate.key) {
      state.nativeStormActivityKey = "";
      state.nativeStormActivitySyncedAt = 0;
    }
  });
}

function nativeStormActivitySavedPlace(place) {
  if (!place || !Array.isArray(state.savedPlaces) || !state.savedPlaces.length) return false;
  const id = String(place.id || "").trim();
  if (id && state.savedPlaces.some((saved) => String(saved?.id || "").trim() === id)) return true;
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return state.savedPlaces.some((saved) => (
    Math.abs(Number(saved?.latitude) - lat) < 0.02 &&
    Math.abs(Number(saved?.longitude) - lon) < 0.02
  ));
}

function nativeStormActivityCandidate(data, place, truth = state.weatherTruth || weatherTruth(data)) {
  const hourly = data?.hourly || {};
  const times = hourly.time || [];
  if (!times.length) return null;

  const now = forecastNowMs(data);
  const end = now + 90 * 60 * 1000;
  let best = null;

  const minutely = data?.minutely_15 || {};
  const minutelyTimes = minutely.time || [];
  for (let index = 0; index < minutelyTimes.length; index += 1) {
    const ms = parseForecastTimestamp(minutelyTimes[index], data);
    if (!Number.isFinite(ms) || ms < now - 5 * 60 * 1000 || ms > end) continue;
    const pop = Number(minutely.precipitation_probability?.[index] || 0);
    const precip = Number(minutely.precipitation?.[index] || 0);
    const storm = Boolean(truth?.display?.stormPotential) && (pop >= 35 || precip > 0);
    const meaningfulRain = pop >= 55 || precip >= 0.03;
    if (!storm && !meaningfulRain) continue;
    const etaMinutes = Math.max(0, Math.round((ms - now) / 60000));
    const score = (storm ? 1000 : 0) + pop * 10 + precip * 500 - etaMinutes * 3;
    if (!best || score > best.score) {
      best = { index, ms, pop, rawCode: Number(truth?.nowCode ?? truth?.code ?? 61), precip, storm, etaMinutes, score, source: "minutely_15" };
    }
  }

  for (let index = 0; index < times.length; index += 1) {
    const ms = parseForecastTimestamp(times[index], data);
    if (!Number.isFinite(ms) || ms < now - 10 * 60 * 1000 || ms > end) continue;
    const pop = Number(hourly.precipitation_probability?.[index] || 0);
    const rawCode = Number(hourly.weather_code?.[index] ?? 0);
    const precip = Number(hourly.precipitation?.[index] || 0);
    const storm = isThunderCode(rawCode) || hasThunderPotential(rawCode, pop, rawCode, precip, data);
    const meaningfulRain = pop >= 65 || precip >= 0.8;
    if (!storm && !meaningfulRain) continue;
    const etaMinutes = Math.max(0, Math.round((ms - now) / 60000));
    const score = (storm ? 1000 : 0) + pop * 10 + precip * 100 - etaMinutes;
    if (!best || score > best.score) {
      best = { index, ms, pop, rawCode, precip, storm, etaMinutes, score, source: "hourly" };
    }
  }

  const activeStorm = truth?.display?.stormPotential || isThunderCode(Number(truth?.nowCode ?? truth?.code ?? 0));
  if (!best && activeStorm) {
    best = {
      index: currentHourlyIndex(data),
      ms: now,
      pop: Math.round(truth?.rainChance ?? currentRainChance(data) ?? 0),
      rawCode: Number(truth?.nowCode ?? truth?.code ?? 95),
      precip: Number(data?.current?.precipitation || 0),
      storm: true,
      etaMinutes: 0,
      score: 1000
    };
  }
  if (!best) return null;

  const placeName = placeLabel(place);
  const city = placeCityLabel(place) || cityNameFromLabel(placeName);
  const stormName = best.storm ? "Storm Watch" : "Rain Watch";
  const status = best.etaMinutes <= 5
    ? `${stormName} at ${city}`
    : `${stormName} near ${city}`;
  const detail = best.storm
    ? best.etaMinutes <= 5
      ? `Thunder is possible now. Rain chance ${best.pop}%.`
      : `Thunder possible in about ${best.etaMinutes} min. Rain chance ${best.pop}%.`
    : best.etaMinutes <= 5
      ? `Rain is likely now. Chance ${best.pop}%.`
      : `Rain possible in about ${best.etaMinutes} min. Chance ${best.pop}%.`;
  const confidence = best.storm
    ? best.pop >= 50 || best.etaMinutes <= 15 ? "Likely" : "Watching"
    : best.pop >= 75 ? "Likely" : "Possible";
  const route = nativeStormActivityUrl(place);
  const severity = best.storm
    ? best.pop >= 80 || best.precip >= 1.6 ? 4 : 3
    : best.pop >= 75 || best.precip >= 0.8 ? 2 : 1;
  const confidenceValue = best.storm
    ? Math.max(0.52, Math.min(0.92, (best.pop / 100) * 0.72 + (best.etaMinutes <= 15 ? 0.18 : 0.06)))
    : Math.max(0.42, Math.min(0.82, best.pop / 100));

  const arrivalAtEpoch = Math.round(best.ms / 1000);
  const expiresAtEpoch = Math.round(Math.max(best.ms + 45 * 60 * 1000, now + 30 * 60 * 1000) / 1000);

  return {
    key: [
      place.id || placeName,
      best.index,
      Math.round(best.pop / 5) * 5,
      best.storm ? "storm" : "rain"
    ].join(":"),
    placeName,
    stormName,
    etaMinutes: best.etaMinutes,
    arrivalAtEpoch,
    expiresAtEpoch,
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    status,
    detail,
    confidence,
    confidenceValue,
    severity,
    rainChance: best.pop,
    motionDegrees: nativeStormActivityMotionDegrees(data, best.source === "hourly" ? best.index : currentHourlyIndex(data)),
    geometryQuality: "forecast",
    url: route || "nearcast://watching?source=live-activity"
  };
}

function nativeStormActivityMotionDegrees(data, index) {
  const hourly = data?.hourly || {};
  const windDirection = Number(hourly.wind_direction_10m?.[index] ?? data?.current?.wind_direction_10m);
  if (Number.isFinite(windDirection)) return Math.round(windDirection);
  return null;
}

function nativeStormActivityUrl(place) {
  const params = new URLSearchParams();
  params.set("nearcast", "live-activity");
  params.set("target", "map");
  params.set("detail", "rain");
  params.set("source", "live-activity");
  params.set("mode", "stormscope-available");
  if (place?.id) params.set("placeId", String(place.id));
  if (Number.isFinite(Number(place?.latitude))) params.set("lat", String(Number(place.latitude)));
  if (Number.isFinite(Number(place?.longitude))) params.set("lon", String(Number(place.longitude)));
  return `nearcast://weather?${params.toString()}`;
}

function nativeStormActivityBridge() {
  return window.NearcastNative?.stormActivity || null;
}

function nativeStormActivityDebugPlaceName() {
  return placeCityLabel(state.activePlace) || cityNameFromLabel(placeLabel(state.activePlace)) || "Maryville";
}

function nativeStormActivityDebugPayload(options = {}) {
  const city = nativeStormActivityDebugPlaceName();
  const now = Date.now();
  const etaMinutes = Number.isFinite(Number(options.etaMinutes)) ? Math.max(0, Math.round(Number(options.etaMinutes))) : 18;
  const chance = Number.isFinite(Number(options.chance)) ? Math.max(0, Math.min(100, Math.round(Number(options.chance)))) : 72;
  const detailVerb = options.updated ? "Updated sample:" : "Thunder possible";
  return {
    key: `debug-live-activity:${city}:${Math.floor(now / 60000)}`,
    placeName: placeLabel(state.activePlace) || city,
    stormName: "Storm Watch",
    etaMinutes,
    status: `Storm Watch near ${city}`,
    detail: `${detailVerb} in about ${etaMinutes} min. Rain chance ${chance}%.`,
    confidence: "Sample",
    confidenceValue: options.updated ? 0.84 : 0.72,
    severity: options.updated ? 4 : 3,
    rainChance: chance,
    motionDegrees: options.updated ? 78 : 112,
    geometryQuality: "sample",
    url: nativeStormActivityUrl(state.activePlace) || "nearcast://weather?nearcast=live-activity&source=debug"
  };
}

function updateNativeStormActivityDebugControl() {
  if (els.nativeLiveActivitySetting) {
    els.nativeLiveActivitySetting.hidden = !isNativeNearcastApp();
  }
  const button = els.nativeLiveActivityOpen;
  const meta = els.nativeLiveActivityMeta;
  if (!button && !meta) return;

  const bridge = nativeStormActivityBridge();
  const supported = Boolean(bridge?.supported);
  const debug = state.nativeStormActivityDebug || {};
  if (button) {
    button.disabled = debug.pending || !supported;
    button.textContent = debug.pending ? "Working..." : "Open lab";
  }
  if (meta) {
    if (!isNativeNearcastApp()) meta.textContent = "Native app only";
    else if (!supported) meta.textContent = "Bridge not ready";
    else if (debug.pending) meta.textContent = "Talking to ActivityKit";
    else if (debug.active) meta.textContent = "Sample is active";
    else if (debug.reason) meta.textContent = debug.reason;
    else meta.textContent = "Starts a sample storm card";
  }
}

function openLiveActivityLab() {
  closeAppMenu();
  if (!els.liveActivitySheet || !els.liveActivityBackdrop) return;
  els.liveActivityBackdrop.hidden = false;
  els.liveActivitySheet.hidden = false;
  showSheet(els.liveActivityBackdrop, els.liveActivitySheet, {
    onPullDismiss: closeLiveActivityLab,
    canPullDismiss: () => !state.nativeStormActivityDebug?.pending,
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
  const bridgeReady = Boolean(nativeStormActivityBridge()?.supported);
  updateLiveActivityLabStatus(
    bridgeReady ? "Ready to test" : "Native bridge not ready",
    bridgeReady
      ? "Tap Start sample, then lock the phone or swipe home to look for the Live Activity."
      : "This test only works inside the native iPhone app after the native bridge loads.",
    {
      ok: bridgeReady,
      bridge: bridgeReady ? "ready" : "missing",
      native: isNativeNearcastApp()
    }
  );
}

function closeLiveActivityLab() {
  if (!els.liveActivitySheet || !els.liveActivityBackdrop || els.liveActivitySheet.hidden) return;
  els.liveActivityBackdrop.classList.remove("show");
  els.liveActivitySheet.classList.remove("show");
  document.body.style.overflow = mapState.immersive ? "hidden" : "";
  setTimeout(() => {
    els.liveActivityBackdrop.hidden = true;
    els.liveActivitySheet.hidden = true;
  }, 260);
}

function setLiveActivityLabBusy(isBusy) {
  [
    els.liveActivityStart,
    els.liveActivityUpdate,
    els.liveActivityStatusButton,
    els.liveActivityEnd
  ].forEach((button) => {
    if (!button) return;
    button.disabled = Boolean(isBusy);
  });
  if (els.nativeLiveActivityOpen) els.nativeLiveActivityOpen.disabled = Boolean(isBusy) || !nativeStormActivityBridge()?.supported;
}

function bindLiveActivityLabActions() {
  if (!els.liveActivitySheet || els.liveActivitySheet._liveActivityActionsBound) return;
  els.liveActivitySheet._liveActivityActionsBound = true;
  els.liveActivitySheet.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-live-activity-action]");
    if (!button || !els.liveActivitySheet.contains(button) || button.disabled) return;
    event.preventDefault();
    const action = button.dataset.liveActivityAction || "status";
    updateLiveActivityLabStatus("Tap received", `Starting ${action} test...`, { action, tapped: true });
    setTimeout(() => {
      runLiveActivityLabDirectAction(action).catch((error) => {
        showLiveActivityLabCrash(action, error, "sync-action");
      });
    }, 40);
  });
}

function waitForLiveActivityLabPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function runLiveActivityLabDirectAction(action) {
  const bridge = window.NearcastNative?.stormActivity;
  const initial = {
    action,
    phase: "direct-bridge-check",
    native: isNativeNearcastApp(),
    hasNative: Boolean(window.NearcastNative),
    hasStormActivity: Boolean(bridge),
    supported: Boolean(bridge?.supported)
  };
  updateLiveActivityLabStatus("Checking bridge", `Preparing ${action}.`, initial);
  await waitForLiveActivityLabPaint();

  if (!bridge?.supported) {
    updateLiveActivityLabStatus("Live Activities unavailable", "The native Storm Activity bridge is not ready.", {
      ...initial,
      ok: false,
      reason: "bridge-not-ready"
    });
    return;
  }

  try {
    state.nativeStormActivityDebug.pending = true;
    setLiveActivityLabBusy(true);
    updateNativeStormActivityDebugControl();
  } catch (error) {
    updateLiveActivityLabStatus("Lab state warning", "The bridge is ready, but the debug UI state update failed. Continuing anyway.", {
      ...initial,
      phase: "direct-debug-state-warning",
      message: error?.message || String(error || "Unknown debug state error")
    });
    await waitForLiveActivityLabPaint();
  }
  updateLiveActivityLabStatus("Calling native", `Sending ${action} request to ActivityKit.`, {
    ...initial,
    phase: `direct-native-${action}`
  });
  await waitForLiveActivityLabPaint();

  let request;
  try {
    if (action === "start" || action === "update") {
      const city = nativeStormActivityDebugPlaceName();
      const etaMinutes = action === "update" ? 9 : 18;
      const chance = action === "update" ? 81 : 72;
      const payload = {
        key: `direct-live-activity:${city}:${Math.floor(Date.now() / 60000)}:${action}`,
        placeName: placeLabel(state.activePlace) || city,
        stormName: "Storm Watch",
        etaMinutes,
        status: `Storm Watch near ${city}`,
        detail: `${action === "update" ? "Updated sample:" : "Thunder possible"} in about ${etaMinutes} min. Rain chance ${chance}%.`,
        confidence: "Sample",
        confidenceValue: action === "update" ? 0.84 : 0.72,
        severity: action === "update" ? 4 : 3,
        rainChance: chance,
        motionDegrees: action === "update" ? 78 : 112,
        geometryQuality: "sample",
        url: nativeStormActivityUrl(state.activePlace) || "nearcast://weather?nearcast=live-activity&source=debug"
      };
      state.nativeStormActivityKey = payload.key;
      updateLiveActivityLabStatus("Calling native", `Payload ready. Requesting ${action}.`, {
        ...initial,
        phase: "direct-payload-ready",
        payload
      });
      await waitForLiveActivityLabPaint();
      request = action === "update" ? bridge.update(payload) : bridge.start(payload);
    } else if (action === "end") {
      state.nativeStormActivityKey = "";
      updateLiveActivityLabStatus("Calling native", "Requesting ActivityKit end.", {
        ...initial,
        phase: "direct-end-ready"
      });
      await waitForLiveActivityLabPaint();
      request = bridge.end({
        status: "Sample ended",
        detail: "Nearcast ended the sample storm activity.",
        confidence: "Ended"
      });
    } else {
      updateLiveActivityLabStatus("Calling native", "Requesting ActivityKit status.", {
        ...initial,
        phase: "direct-status-ready"
      });
      await waitForLiveActivityLabPaint();
      request = bridge.status();
    }
  } catch (error) {
    showLiveActivityLabCrash(action, error, "native-call-sync");
    return;
  }

  updateLiveActivityLabStatus("Waiting for native", "Nearcast sent the request. Waiting for the native callback.", {
    ...initial,
    phase: "direct-waiting"
  });
  await waitForLiveActivityLabPaint();

  try {
    const result = await liveActivityRequestWithTimeout(request, action);
    applyLiveActivityLabResult(action, result);
  } catch (error) {
    showLiveActivityLabCrash(action, error, "native-call-async");
  }
}

function applyLiveActivityLabResult(action, result = {}) {
  const ok = result?.ok !== false && result?.state !== "timeout";
  const stateText = String(result?.state || (ok ? "ok" : "failed"));
  state.nativeStormActivityDebug.active = ["started", "updated", "active"].includes(stateText);
  if (action === "end") state.nativeStormActivityDebug.active = false;
  state.nativeStormActivityDebug.state = stateText;
  state.nativeStormActivityDebug.reason = ok ? "" : String(result?.reason || stateText);
  state.nativeStormActivityDebug.pending = false;
  setLiveActivityLabBusy(false);
  updateNativeStormActivityDebugControl();
  updateLiveActivityLabStatus(
    ok ? `Live Activity ${stateText}` : "Live Activity failed",
    liveActivityLabResultText(action, result),
    result
  );
  setStatus(ok ? `Live Activity ${stateText}.` : `Live Activity: ${state.nativeStormActivityDebug.reason}`, !ok);
}

function showLiveActivityLabCrash(action, error, phase = "unknown") {
  const message = error?.message || String(error || "Unknown JavaScript error");
  state.nativeStormActivityDebug.pending = false;
  state.nativeStormActivityDebug.active = false;
  state.nativeStormActivityDebug.state = "crashed";
  state.nativeStormActivityDebug.reason = message;
  setLiveActivityLabBusy(false);
  updateNativeStormActivityDebugControl();
  updateLiveActivityLabStatus("Live Activity test crashed", message, {
    ok: false,
    action,
    phase,
    message,
    stack: error?.stack || ""
  });
}

function updateLiveActivityLabStatus(title, body, result = null) {
  if (els.liveActivityStatus) {
    els.liveActivityStatus.innerHTML = `
      <strong>${escapeHtml(title || "Live Activity Lab")}</strong>
      <span>${escapeHtml(body || "")}</span>
    `;
  }
  if (els.liveActivityResult) {
    const hasResult = result !== null && result !== undefined;
    els.liveActivityResult.hidden = !hasResult;
    els.liveActivityResult.textContent = hasResult
      ? JSON.stringify(result, null, 2)
      : "";
  }
}

async function runNativeStormActivityLabAction(action, options = {}) {
  const trace = {
    action,
    phase: "bridge-check",
    native: isNativeNearcastApp(),
    hasNative: Boolean(window.NearcastNative),
    hasStormActivity: Boolean(window.NearcastNative?.stormActivity)
  };
  if (!options.quiet) updateLiveActivityLabStatus("Checking bridge", `Preparing ${action}.`, trace);
  const bridge = nativeStormActivityBridge();
  if (!bridge?.supported) {
    const reason = isNativeNearcastApp() ? "Native bridge not ready yet." : "Open this in the native iPhone app.";
    state.nativeStormActivityDebug.reason = reason;
    updateNativeStormActivityDebugControl();
    updateLiveActivityLabStatus("Live Activities unavailable", reason, { ok: false, action, reason });
    if (!options.quiet) setStatus(`Live Activity: ${reason}`, true);
    return null;
  }

  state.nativeStormActivityDebug.pending = true;
  setLiveActivityLabBusy(true);
  updateNativeStormActivityDebugControl();
  trace.phase = "working";
  trace.bridge = "ready";
  if (!options.quiet) updateLiveActivityLabStatus("Working...", `Running ${action}.`, trace);

  let result = null;
  try {
    if (action === "start") {
      trace.phase = "payload";
      const payload = nativeStormActivityDebugPayload({ etaMinutes: 18, chance: 72 });
      state.nativeStormActivityKey = payload.key;
      trace.phase = "native-start";
      if (!options.quiet) updateLiveActivityLabStatus("Calling native", "Requesting ActivityKit start.", { ...trace, payload });
      result = await liveActivityRequestWithTimeout(bridge.start(payload), action);
    } else if (action === "update") {
      trace.phase = "payload";
      const payload = nativeStormActivityDebugPayload({ etaMinutes: 9, chance: 81, updated: true });
      state.nativeStormActivityKey = payload.key;
      trace.phase = "native-update";
      if (!options.quiet) updateLiveActivityLabStatus("Calling native", "Requesting ActivityKit update.", { ...trace, payload });
      result = await liveActivityRequestWithTimeout(bridge.update(payload), action);
    } else if (action === "end") {
      trace.phase = "native-end";
      if (!options.quiet) updateLiveActivityLabStatus("Calling native", "Requesting ActivityKit end.", trace);
      result = await liveActivityRequestWithTimeout(bridge.end({
        status: "Sample ended",
        detail: "Nearcast ended the sample storm activity.",
        confidence: "Ended"
      }), action);
      state.nativeStormActivityKey = "";
    } else {
      trace.phase = "native-status";
      if (!options.quiet) updateLiveActivityLabStatus("Calling native", "Requesting ActivityKit status.", trace);
      result = await liveActivityRequestWithTimeout(bridge.status(), action);
    }

    const ok = result?.ok !== false && result?.state !== "timeout";
    const stateText = String(result?.state || (ok ? "ok" : "failed"));
    state.nativeStormActivityDebug.active = ["started", "updated", "active"].includes(stateText);
    if (action === "end") state.nativeStormActivityDebug.active = false;
    state.nativeStormActivityDebug.state = stateText;
    state.nativeStormActivityDebug.reason = ok ? "" : String(result?.reason || stateText);
    updateLiveActivityLabStatus(
      ok ? `Live Activity ${stateText}` : "Live Activity failed",
      liveActivityLabResultText(action, result),
      result
    );
    if (!options.quiet) setStatus(ok ? `Live Activity ${stateText}.` : `Live Activity: ${state.nativeStormActivityDebug.reason}`, !ok);
    return result;
  } catch (error) {
    state.nativeStormActivityDebug.active = false;
    state.nativeStormActivityDebug.state = "failed";
    state.nativeStormActivityDebug.reason = error?.message || "Unknown error";
    updateLiveActivityLabStatus("Live Activity failed", state.nativeStormActivityDebug.reason, {
      ok: false,
      action,
      reason: state.nativeStormActivityDebug.reason
    });
    if (!options.quiet) setStatus(`Live Activity: ${state.nativeStormActivityDebug.reason}`, true);
    return null;
  } finally {
    state.nativeStormActivityDebug.pending = false;
    setLiveActivityLabBusy(false);
    updateNativeStormActivityDebugControl();
  }
}

function liveActivityRequestWithTimeout(promise, action, timeoutMs = 6000) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: false,
          state: "timeout",
          action,
          reason: `No native ActivityKit callback after ${Math.round(timeoutMs / 1000)} seconds.`
        });
      }, timeoutMs);
    })
  ]);
}

function liveActivityLabResultText(action, result = {}) {
  if (result?.ok === false || result?.state === "timeout") {
    return result?.reason || result?.state || `${action} failed.`;
  }
  if (action === "start") return "Now lock the phone or swipe home. The sample should appear on the Lock Screen or Dynamic Island.";
  if (action === "update") return "The existing sample should tighten its ETA and refresh the detail text.";
  if (action === "end") return "The sample should dismiss shortly.";
  if (result?.state === "active") return "A Live Activity is active.";
  if (result?.state === "none") return "No Live Activity is currently active.";
  return `Native bridge returned ${result?.state || "ok"}.`;
}

function scheduleNativeLiveActivityQueryTest() {
  const action = String(nativeLiveActivityTestQueryFlag || "").trim().toLowerCase();
  if (!action || ["0", "false", "off", "none"].includes(action)) return;
  const resolvedAction = ["update", "end", "status"].includes(action) ? action : "start";
  let attempts = 0;
  const run = () => {
    attempts += 1;
    if (!nativeStormActivityBridge()?.supported && attempts < 8) {
      setTimeout(run, 350);
      return;
    }
    openLiveActivityLab();
    runLiveActivityLabDirectAction(resolvedAction).catch((error) => {
      showLiveActivityLabCrash(resolvedAction, error, "query-test-direct");
    });
  };
  setTimeout(run, 650);
}

async function toggleNativeStormActivitySample() {
  const bridge = nativeStormActivityBridge();
  if (!bridge?.supported) {
    state.nativeStormActivityDebug.reason = isNativeNearcastApp() ? "Bridge not ready" : "Native app only";
    updateNativeStormActivityDebugControl();
    setStatus("Live Activities are only available in the native iPhone app.", true);
    return;
  }

  const debug = state.nativeStormActivityDebug;
  if (debug.pending) return;
  debug.pending = true;
  debug.reason = "";
  updateNativeStormActivityDebugControl();

  try {
    if (debug.active) {
      const result = await bridge.end({
        status: "Sample ended",
        detail: "Nearcast ended the sample storm activity.",
        confidence: "Ended"
      });
      debug.active = false;
      debug.state = String(result?.state || "ended");
      debug.reason = result?.ok === false ? String(result.reason || result.state || "Could not end sample") : "Sample ended";
      state.nativeStormActivityKey = "";
      setStatus(result?.ok === false ? `Live Activity: ${debug.reason}` : "Sample Live Activity ended.", result?.ok === false);
      return;
    }

    const payload = nativeStormActivityDebugPayload();
    state.nativeStormActivityKey = payload.key;
    const result = await bridge.start(payload);
    const ok = result?.ok !== false && result?.state !== "timeout";
    debug.active = ok;
    debug.state = String(result?.state || (ok ? "started" : "failed"));
    debug.reason = ok ? "Sample is active" : String(result?.reason || result?.state || "Could not start sample");
    if (!ok) state.nativeStormActivityKey = "";
    setStatus(ok ? "Sample Live Activity started." : `Live Activity: ${debug.reason}`, !ok);
  } catch (error) {
    debug.active = false;
    debug.state = "failed";
    debug.reason = error?.message || "Could not start sample";
    state.nativeStormActivityKey = "";
    setStatus(`Live Activity: ${debug.reason}`, true);
  } finally {
    debug.pending = false;
    updateNativeStormActivityDebugControl();
  }
}

function cityNameFromLabel(label) {
  return String(label || "").split(",")[0]?.trim() || "your place";
}

function nativeWidgetPlanSummary(data, place) {
  if (
    !Array.isArray(state.planMemories) ||
    !state.planMemories.length ||
    typeof planMemoryListItems !== "function" ||
    typeof planWatchItemForMemoryItem !== "function"
  ) return null;

  const watches = planMemoryListItems(data, place, { includePast: false })
    .map(planWatchItemForMemoryItem)
    .filter(Boolean)
    .sort((a, b) => (
      (typeof planWatchAttentionRank === "function" ? planWatchAttentionRank(b) - planWatchAttentionRank(a) : 0) ||
      (a.event?.startMs ?? Infinity) - (b.event?.startMs ?? Infinity)
    ));
  const top = watches[0];
  if (!top?.memory) return null;

  const title = typeof planMemoryTitle === "function" ? planMemoryTitle(top.memory) : (top.memory.title || "Plan");
  const label = top.change ? "Changed" : (top.label && !["Looks good", "Past"].includes(top.label) ? top.label : "Watching");
  const detail = top.change?.body || top.reason || top.fullReason || (typeof planWatchWhenText === "function" ? planWatchWhenText(top.memory, data) : "");
  const planPlace = top.place || top.memory.place || null;
  const samePlace = planPlace && typeof samePlanPlace === "function" ? samePlanPlace(planPlace, place) : false;
  return {
    id: top.memory.id || top.memory.memoryId || null,
    title,
    label,
    detail: compactForYouText(detail || "Plan checked against the forecast.", 72),
    place: !samePlace && planPlace ? placeCityLabel(planPlace) : null,
    risk: top.riskKind || (typeof planWatchRiskKind === "function" ? planWatchRiskKind(top) : null),
    startAt: Number.isFinite(top.event?.startMs) ? top.event.startMs / 1000 : null,
    endAt: Number.isFinite(top.event?.endMs) ? top.event.endMs / 1000 : null,
    // A changed plan is an action state. Do not let an older caution/watch
    // tone downgrade the Watch verdict back to WATCH.
    tone: top.change ? "changed" : (top.tone || "neutral")
  };
}

function nativeWidgetWatchSummary(data, place, truth, widgetPlan = null) {
  if (widgetPlan?.label && widgetPlan.label !== "Watching") {
    return {
      status: compactForYouText(widgetPlan.label, 32),
      detail: compactForYouText(widgetPlan.detail || widgetPlan.title || "Watched plan changed.", 54),
      tone: widgetPlan.tone || "watch"
    };
  }

  if (widgetPlan?.title) {
    return {
      status: "Watching",
      detail: compactForYouText(widgetPlan.detail || widgetPlan.title, 54),
      tone: widgetPlan.tone || "neutral"
    };
  }

  const current = data?.current || {};
  const nextValue = launchSummaryItems(data, state.unit === "fahrenheit" ? "F" : "C", state.unit === "fahrenheit" ? "mph" : "km/h", truth)?.[1]?.value || "";
  const rainChance = Math.round(truth?.rainChance ?? currentRainChance(data) ?? 0);
  const feelsLike = Math.round(current.apparent_temperature ?? current.temperature_2m ?? 0);
  const code = Number(truth?.nowCode ?? current.weather_code ?? 0);
  const city = cityNameFromLabel(placeLabel(place));

  if (code >= 95 || /storm|thunder/i.test(nextValue)) {
    return {
      status: "Storms possible",
      detail: compactForYouText(`${city} · ${nextValue || "Stay weather aware"}`, 54),
      tone: "watch"
    };
  }
  if (rainChance >= 45 || /rain|shower|drizzle/i.test(nextValue)) {
    return {
      status: "Expect rain",
      detail: compactForYouText(`${city} · ${nextValue || `${rainChance}% rain chance`}`, 54),
      tone: rainChance >= 60 ? "watch" : "caution"
    };
  }
  if (feelsLike >= 95) {
    return {
      status: "Plan around heat",
      detail: compactForYouText(`${city} · Feels ${feelsLike}°`, 54),
      tone: feelsLike >= 100 ? "watch" : "caution"
    };
  }
  if (feelsLike <= 32) {
    return {
      status: "Freezing",
      detail: compactForYouText(`${city} · Feels ${feelsLike}°`, 54),
      tone: "caution"
    };
  }
  return {
    status: "Looks good",
    detail: compactForYouText(`${city} · ${truth?.label || "Weather checked"}`, 54),
    tone: "good"
  };
}

function placeCityLabel(place) {
  const name = String(place?.name || "").trim();
  if (name) return name;
  return String(placeLabel(place || {})).split(",")[0]?.trim() || "";
}

function renderForYouToday(data, place, tempUnit, windUnit, truth = weatherTruth(data)) {
  if (!els.forYouToday) return;
  if (!data || !place) {
    els.forYouToday.hidden = true;
    els.forYouToday.innerHTML = "";
    return;
  }

  const context = buildTodayContext(data, place, tempUnit, windUnit, truth);
  const visibleCards = todayPriorityCards(context);
  if (!visibleCards.length) {
    els.forYouToday.hidden = true;
    els.forYouToday.innerHTML = "";
    return;
  }

  els.forYouToday.hidden = false;
  els.forYouToday.classList.toggle("is-single", visibleCards.length === 1);
  els.forYouToday.innerHTML = `
    <div class="for-you-head">
      <span>
        <strong>Today</strong>
        <small>${escapeHtml(forYouMeta(context))}</small>
      </span>
    </div>
    <div class="for-you-grid">${visibleCards.join("")}</div>
  `;
}

function buildTodayContext(data, place, tempUnit, windUnit, truth = weatherTruth(data)) {
  const weatherItems = launchSummaryItems(data, tempUnit, windUnit, truth);
  const continuity = forYouContinuityCard(data, place, tempUnit, windUnit, truth, weatherItems, continuityBaselineStore(data, place));
  const watching = forYouWatchingCard(data, place);
  const interruption = forYouInterruptionCard(data, tempUnit, windUnit, truth, weatherItems);
  const install = forYouInstallCard();
  return {
    data,
    place,
    tempUnit,
    windUnit,
    truth,
    weatherItems,
    continuityCard: continuity.html,
    continuityType: continuity.type,
    continuityMemoryId: continuity.memoryId,
    watchingCard: watching.html,
    watchingMemoryId: watching.memoryId,
    watchingCount: watching.count,
    interruptionCard: interruption.html,
    interruptionType: interruption.type,
    installCard: install.html,
    memoryCount: Array.isArray(state.planMemories) ? state.planMemories.length : 0
  };
}

function todayPriorityCards(context) {
  if (!context) return [];
  const cards = [];
  if (context.continuityCard) cards.push(context.continuityCard);

  if (
    context.watchingCard &&
    (!context.continuityMemoryId || context.watchingMemoryId !== context.continuityMemoryId)
  ) cards.push(context.watchingCard);

  if (context.interruptionCard && context.interruptionType !== context.continuityType) {
    cards.push(context.interruptionCard);
  }

  if (context.installCard && cards.length < 2) {
    cards.push(context.installCard);
  }

  return cards.filter(Boolean).slice(0, 2);
}

function forYouMeta(context) {
  const place = context?.place || context;
  const memoryCount = Number(context?.memoryCount ?? (Array.isArray(state.planMemories) ? state.planMemories.length : 0));
  const placeText = place ? placeLabel(place) : "Current place";
  if (context?.continuityCard) return `${placeText} · forecast changed`;
  if (context?.watchingCard) return `${placeText} · watching ${context.watchingCount || memoryCount}`;
  if (memoryCount) return `${placeText} · watching`;
  return placeText;
}

function forYouWatchingCard(data, place) {
  if (
    !Array.isArray(state.planMemories) ||
    !state.planMemories.length ||
    typeof planMemoryListItems !== "function"
  ) return { html: "", memoryId: "", count: 0 };

  const items = planMemoryListItems(data, place, { includePast: false });
  if (!items.length) return { html: "", memoryId: "", count: 0 };

  const watches = typeof planWatchItemForMemoryItem === "function"
    ? items.map(planWatchItemForMemoryItem).filter(Boolean)
    : [];
  const ranked = [...watches].sort((a, b) => (
    (typeof planWatchAttentionRank === "function" ? planWatchAttentionRank(b) - planWatchAttentionRank(a) : 0) ||
    (a.event?.startMs ?? Infinity) - (b.event?.startMs ?? Infinity)
  ));
  const top = ranked[0];
  const attentionCount = watches.filter((watch) =>
    !watch?.isPast && ["watch", "caution"].includes(watch?.tone)
  ).length;
  const changedCount = watches.filter((watch) => !watch?.isPast && watch?.change).length;
  const loadingCount = watches.filter((watch) =>
    watch?.status === "loading" || watch?.status === "idle"
  ).length;
  const tone = attentionCount ? "caution" : changedCount ? "changed" : loadingCount ? "pending" : "good";
  const topTitle = top?.memory ? (typeof planMemoryTitle === "function" ? planMemoryTitle(top.memory) : top.memory.title || "Plan") : "";
  const attentionLabel = top?.label && !["Looks good", "Past"].includes(top.label)
    ? top.label
    : top?.tone === "watch" ? "Needs attention" : "May be affected by weather";
  const title = attentionCount && topTitle
    ? `${topTitle}: ${attentionLabel}`
    : changedCount && topTitle
      ? `${topTitle} changed`
      : loadingCount
        ? "Checking your plans"
        : `Watching ${items.length} ${items.length === 1 ? "plan" : "plans"}`;
  const body = top?.change?.body ||
    top?.reason ||
    (loadingCount ? "Nearcast is checking saved plan windows." : "No major weather signal right now.");
  const focusId = top?.memory?.id || "";
  const opensPlan = Boolean(focusId && (attentionCount || changedCount || items.length === 1));
  const actionAttr = opensPlan
    ? `data-memory-show="${escapeHtml(focusId)}" data-for-you-signal="memory-show"`
    : `data-memory-open data-for-you-signal="memory-open"`;
  return {
    memoryId: focusId,
    count: items.length,
    html: `
    <button class="for-you-card is-watching is-${escapeHtml(tone)}" type="button" ${actionAttr}>
      <span class="for-you-kicker"><span>Watching</span><em>${escapeHtml(`${items.length} active`)}</em></span>
      <strong>${escapeHtml(title)}</strong>
      <span class="for-you-body">${escapeHtml(compactForYouText(body, 92))}</span>
      <small>${opensPlan ? "View plan" : "Review"}</small>
    </button>
  `
  };
}

function forYouInstallCard() {
  if (!installPromptCanShow()) return { html: "" };
  return {
    html: `
      <button class="for-you-card is-action is-install" type="button" data-for-you-install data-for-you-signal="install">
        <span class="for-you-kicker"><span>Nearcast app</span><em>${escapeHtml(installPromptMode() === "native" ? "1 tap" : "Home Screen")}</em></span>
        <strong>Add Nearcast</strong>
        <span class="for-you-body">${escapeHtml(installPromptCopy())}</span>
        <small>${escapeHtml(installPromptMode() === "native" ? "Install" : "Show me")}</small>
      </button>
    `
  };
}

function defaultContinuityStore() {
  return { places: {}, plans: {}, updatedAt: 0 };
}

function loadContinuityStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTINUITY_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return defaultContinuityStore();
    return {
      places: parsed.places && typeof parsed.places === "object" ? parsed.places : {},
      plans: parsed.plans && typeof parsed.plans === "object" ? parsed.plans : {},
      updatedAt: Math.max(0, Number(parsed.updatedAt) || 0)
    };
  } catch {
    return defaultContinuityStore();
  }
}

function saveContinuityStore(store) {
  try {
    localStorage.setItem(CONTINUITY_KEY, JSON.stringify(store));
  } catch {
    // Continuity is an enhancement; the forecast should never depend on storage.
  }
  syncContinuityBaselineStore(store);
}

function syncContinuityBaselineStore(store) {
  if (!store || typeof store !== "object") return;
  state.continuityBaseline = {
    ...(state.continuityBaseline || { key: "" }),
    store
  };
  if (typeof refreshPlanWatchBaselineStore === "function") {
    refreshPlanWatchBaselineStore(store);
  }
}

function continuityPlaceKey(place) {
  if (!place) return "";
  if (place.id) return `id:${place.id}`;
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `geo:${lat.toFixed(3)},${lon.toFixed(3)}`;
  return `name:${placeLabel(place).toLowerCase()}`;
}

function continuityPlanKey(memory) {
  const id = memory?.id || memory?.memoryId;
  return id ? `memory:${id}` : "";
}

function continuityNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function continuityDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}

function continuityChangeWord(delta, up, down) {
  return delta > 0 ? up : down;
}

function continuityWindDeltaThreshold(windUnit) {
  return windUnit === "mph" ? 8 : 13;
}

function continuityWindNotableThreshold(windUnit) {
  return windUnit === "mph" ? 24 : 39;
}

function continuityTempDeltaThreshold(tempUnit) {
  return tempUnit === "F" ? 5 : 3;
}

function continuityPlaceSnapshot(data, place, tempUnit, windUnit, truth = weatherTruth(data)) {
  if (!data || !place) return null;
  const now = forecastNowMs(data);
  const todayIndex = forecastDailyIndex(data);
  const endMs = forecastLocalBoundaryMs(data, 24) || now + 18 * 60 * 60 * 1000;
  const nextRain = nextRainChance(data, 24, 20);
  const gustIndex = futureMaxHourlyIndex(data, "wind_gusts_10m", 24);
  return {
    savedAt: Date.now(),
    placeKey: continuityPlaceKey(place),
    placeLabel: placeLabel(place),
    forecastTime: data.current?.time || "",
    localDate: forecastLocalDate(data) || "",
    tempUnit,
    windUnit,
    high: continuityNumber(data.daily?.temperature_2m_max?.[todayIndex]),
    low: continuityNumber(data.daily?.temperature_2m_min?.[todayIndex]),
    rainMax: continuityNumber(maxRainInRange(data, now, endMs)),
    nextRainChance: continuityNumber(nextRain?.chance || 0),
    nextRainMs: nextRain?.time ? parseForecastTimestamp(nextRain.time, data) : null,
    gustMax: continuityNumber(gustIndex >= 0 ? data.hourly?.wind_gusts_10m?.[gustIndex] : data.daily?.wind_gusts_10m_max?.[todayIndex]),
    gustMs: gustIndex >= 0 ? parseForecastTimestamp(data.hourly.time[gustIndex], data) : null,
    nowTemp: continuityNumber(data.current?.temperature_2m),
    feels: continuityNumber(data.current?.apparent_temperature),
    rainPhase: truth?.precip?.phase || ""
  };
}

function continuityPlanItems(data, place) {
  if (!data || !place || typeof nextPlanBriefingItem !== "function") return [];
  const items = [];
  const seen = new Set();
  const push = (item) => {
    const key = typeof planBriefingItemKey === "function" ? planBriefingItemKey(item) : item?.memory?.id || "";
    if (!item?.memory?.id || !key || seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  push(nextPlanBriefingItem(data, place));
  if (typeof planAwareBriefingItems === "function") {
    planAwareBriefingItems(data, place).forEach(push);
  }
  return items.slice(0, 4);
}

function continuityPlanSnapshot(item, data, place, tempUnit, windUnit) {
  const memory = item?.memory;
  const stats = item?.stats;
  if (!memory?.id || !stats) return null;
  const truth = typeof planWeatherTruth === "function"
    ? planWeatherTruth({ ...item, status: "ready" })
    : null;
  return {
    savedAt: Date.now(),
    placeKey: continuityPlaceKey(place),
    memoryId: memory.id,
    title: typeof planMemoryTitle === "function" ? planMemoryTitle(memory) : (memory.title || "Plan"),
    targetDate: memory.targetDate || "",
    startHour: continuityNumber(memory.startHour),
    endHour: continuityNumber(memory.endHour),
    startMs: Number.isFinite(item.event?.startMs) ? item.event.startMs : null,
    endMs: Number.isFinite(item.event?.endMs) ? item.event.endMs : null,
    tempUnit,
    windUnit,
    rainChance: continuityNumber(stats.rainChance),
    gustMax: continuityNumber(stats.gustMax ?? stats.windMax),
    feelsMax: continuityNumber(stats.feelsMax ?? stats.feelsAvg),
    feelsAvg: continuityNumber(stats.feelsAvg),
    uvMax: continuityNumber(stats.uvMax),
    tempMin: continuityNumber(stats.tempMin),
    tempMax: continuityNumber(stats.tempMax),
    score: continuityNumber(item.score),
    tone: truth?.tone || item.tone || "",
    verdict: item.verdict || "",
    riskKind: truth?.riskKind || item.riskKind || "",
    alertsReady: typeof activeAlertsReady === "undefined" ? true : Boolean(activeAlertsReady),
    alertTone: truth?.alertTone || item.alertTone || "",
    alertEvent: item.alert?.event || item.alertEvent || "",
    when: typeof planPulseWhenText === "function" ? planPulseWhenText(memory, data) : ""
  };
}

function continuityCurrentSnapshots(data, place, tempUnit, windUnit, truth = weatherTruth(data)) {
  return {
    place: continuityPlaceSnapshot(data, place, tempUnit, windUnit, truth),
    plans: continuityPlanItems(data, place)
      .map((item) => continuityPlanSnapshot(item, data, place, tempUnit, windUnit))
      .filter(Boolean)
  };
}

function continuityBaselineStore(data, place) {
  const key = `${continuityPlaceKey(place)}|${data?.current?.time || ""}`;
  if (state.continuityBaseline?.key !== key) {
    state.continuityBaseline = { key, store: loadContinuityStore() };
  }
  return state.continuityBaseline.store || defaultContinuityStore();
}

function pruneContinuityStore(store, currentPlaceKey = "") {
  const maxAge = 10 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentEntries = (entries, keepKey, limit) => entries
    .filter(([key, value]) => key === keepKey || now - (Number(value?.savedAt) || 0) <= maxAge)
    .sort((a, b) => (Number(b[1]?.savedAt) || 0) - (Number(a[1]?.savedAt) || 0))
    .slice(0, limit);
  return {
    places: Object.fromEntries(recentEntries(Object.entries(store.places || {}), currentPlaceKey, 24)),
    plans: Object.fromEntries(recentEntries(Object.entries(store.plans || {}), "", 80)),
    updatedAt: now
  };
}

function saveContinuitySnapshot(data, place, tempUnit, windUnit, truth = weatherTruth(data)) {
  const snapshots = continuityCurrentSnapshots(data, place, tempUnit, windUnit, truth);
  if (!snapshots.place?.placeKey) return;
  let store = loadContinuityStore();
  store.places[snapshots.place.placeKey] = snapshots.place;
  snapshots.plans.forEach((snapshot) => {
    const key = continuityPlanKey(snapshot);
    if (snapshot.alertsReady === false) return;
    if (key) store.plans[key] = snapshot;
  });
  store = pruneContinuityStore(store, snapshots.place.placeKey);
  saveContinuityStore(store);
}

function continuitySummaryIndex(weatherItems, tone) {
  const index = weatherItems.findIndex((item) => item?.tone === tone || new RegExp(tone, "i").test(item?.value || ""));
  return index >= 0 ? index : 0;
}

function forYouContinuityCard(data, place, tempUnit, windUnit, truth, weatherItems, store = loadContinuityStore()) {
  const snapshots = continuityCurrentSnapshots(data, place, tempUnit, windUnit, truth);
  const planCard = forYouPlanContinuityCard(snapshots.plans, store);
  if (planCard.html) return planCard;
  return forYouPlaceContinuityCard(snapshots.place, store, weatherItems, tempUnit, windUnit);
}

function forYouPlanContinuityCard(planSnapshots, store) {
  const choices = planSnapshots
    .map((current) => {
      const previous = store.plans?.[continuityPlanKey(current)];
      const change = continuityPlanChange(current, previous);
      return change ? { current, change } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.change.priority - a.change.priority);
  const top = choices[0];
  if (!top) return { type: "", html: "", memoryId: "" };
  const { current, change } = top;
  return {
    type: change.type,
    memoryId: current.memoryId,
    html: `
      <button class="for-you-card is-plan is-continuity is-${escapeHtml(change.tone)}" type="button" data-memory-show="${escapeHtml(current.memoryId)}" data-for-you-signal="memory-show">
        <span class="for-you-kicker"><span>Forecast changed</span><em>Plan watch</em></span>
        <strong>${escapeHtml(change.title)}</strong>
        <span class="for-you-body">${escapeHtml(change.body)}</span>
        <small>Check plan</small>
      </button>
    `
  };
}

function continuityPlanChange(current, previous) {
  if (!current || !previous) return null;
  if (current.targetDate !== previous.targetDate || current.startHour !== previous.startHour || current.endHour !== previous.endHour) return null;
  if (typeof planWeatherChange === "function") {
    if (current.alertsReady === false) {
      return planWeatherChange(
        { ...previous, alertTone: "", alertEvent: "" },
        { ...current, alertTone: "", alertEvent: "" }
      );
    }
    return planWeatherChange(previous, current);
  }
  const rainDelta = continuityDelta(current.rainChance, previous.rainChance);
  if (rainDelta !== null && Math.abs(rainDelta) >= 20 && Math.max(current.rainChance, previous.rainChance) >= 35) {
    const wetter = rainDelta > 0;
    return {
      type: "plan-rain",
      tone: wetter ? "watch" : "good",
      priority: 90 + Math.abs(rainDelta),
      title: `${current.title} ${wetter ? "got wetter" : "got drier"}`,
      body: `Rain now ${current.rainChance}%, ${wetter ? "up" : "down"} from ${previous.rainChance}%.`
    };
  }

  const gustDelta = continuityDelta(current.gustMax, previous.gustMax);
  const windThreshold = continuityWindDeltaThreshold(current.windUnit);
  if (
    current.windUnit === previous.windUnit &&
    gustDelta !== null &&
    Math.abs(gustDelta) >= windThreshold &&
    Math.max(current.gustMax, previous.gustMax) >= continuityWindNotableThreshold(current.windUnit)
  ) {
    const stronger = gustDelta > 0;
    return {
      type: "plan-wind",
      tone: stronger ? "caution" : "good",
      priority: 70 + Math.abs(gustDelta),
      title: `${current.title} ${stronger ? "got windier" : "eased up"}`,
      body: `Gusts now ${current.gustMax} ${current.windUnit}, ${stronger ? "from" : "down from"} ${previous.gustMax} ${current.windUnit}.`
    };
  }

  const scoreDelta = continuityDelta(current.score, previous.score);
  if (scoreDelta !== null && Math.abs(scoreDelta) >= 18 && continuityScoreBand(current.score) !== continuityScoreBand(previous.score)) {
    const better = scoreDelta > 0;
    return {
      type: "plan-score",
      tone: better ? "good" : "caution",
      priority: 55 + Math.abs(scoreDelta),
      title: `${current.title} looks ${better ? "better" : "iffy now"}`,
      body: `Plan window moved from ${continuityScoreBand(previous.score)} to ${continuityScoreBand(current.score)}.`
    };
  }

  return null;
}

function continuityScoreBand(score) {
  if (score >= 65) return "good";
  if (score >= 45) return "iffy";
  return "poor";
}

function forYouPlaceContinuityCard(current, store, weatherItems, tempUnit, windUnit) {
  const previous = current?.placeKey ? store.places?.[current.placeKey] : null;
  const change = continuityPlaceChange(current, previous, tempUnit, windUnit);
  if (!change) return { type: "", html: "", memoryId: "" };
  const summaryIndex = continuitySummaryIndex(weatherItems || [], change.summaryTone || change.type);
  return {
    type: change.type,
    memoryId: "",
    html: `
      <button class="for-you-card is-interruption is-continuity is-${escapeHtml(change.summaryTone || change.type)}" type="button" data-for-you-summary="${summaryIndex}" data-for-you-signal="launch-summary">
        <span class="for-you-kicker"><span>Forecast changed</span><em>Here</em></span>
        <strong>${escapeHtml(change.title)}</strong>
        <span class="for-you-body">${escapeHtml(change.body)}</span>
        <small>Hourly detail</small>
      </button>
    `
  };
}

function continuityPlaceChange(current, previous, tempUnit, windUnit) {
  if (!current || !previous || current.localDate !== previous.localDate) return null;
  const rainDelta = continuityDelta(current.rainMax, previous.rainMax);
  if (rainDelta !== null && Math.abs(rainDelta) >= 25 && Math.max(current.rainMax, previous.rainMax) >= 35) {
    const wetter = rainDelta > 0;
    return {
      type: "rain",
      summaryTone: "rain",
      title: `Rain ${wetter ? "picked up" : "backed off"}`,
      body: `Peak chance now ${current.rainMax}%, ${wetter ? "up" : "down"} from ${previous.rainMax}%.`
    };
  }

  const rainMovedMs = continuityDelta(current.nextRainMs, previous.nextRainMs);
  if (
    rainMovedMs !== null &&
    Math.abs(rainMovedMs) >= 90 * 60 * 1000 &&
    Math.min(current.nextRainChance || 0, previous.nextRainChance || 0) >= 20 &&
    Math.max(current.nextRainChance || 0, previous.nextRainChance || 0) >= 35
  ) {
    const later = rainMovedMs > 0;
    return {
      type: "rain",
      summaryTone: "rain",
      title: `Rain moved ${later ? "later" : "earlier"}`,
      body: `Now near ${formatTime(current.nextRainMs)}, was near ${formatTime(previous.nextRainMs)}.`
    };
  }

  const gustDelta = continuityDelta(current.gustMax, previous.gustMax);
  if (
    current.windUnit === previous.windUnit &&
    gustDelta !== null &&
    Math.abs(gustDelta) >= continuityWindDeltaThreshold(windUnit) &&
    Math.max(current.gustMax, previous.gustMax) >= continuityWindNotableThreshold(windUnit)
  ) {
    const stronger = gustDelta > 0;
    return {
      type: "wind",
      summaryTone: "wind",
      title: `Wind ${stronger ? "picked up" : "eased"}`,
      body: `Gusts now ${current.gustMax} ${windUnit}, ${stronger ? "from" : "down from"} ${previous.gustMax} ${windUnit}.`
    };
  }

  const highDelta = continuityDelta(current.high, previous.high);
  if (
    current.tempUnit === previous.tempUnit &&
    highDelta !== null &&
    Math.abs(highDelta) >= continuityTempDeltaThreshold(tempUnit)
  ) {
    const warmer = highDelta > 0;
    return {
      type: "temp",
      summaryTone: "temp",
      title: `Today got ${continuityChangeWord(highDelta, "warmer", "cooler")}`,
      body: `High now ${current.high}${degree(tempUnit)}, ${warmer ? "up" : "down"} from ${previous.high}${degree(tempUnit)}.`
    };
  }

  return null;
}

function forYouPlanCards(data, place) {
  if (typeof nextPlanBriefingItem !== "function") return [];
  const next = nextPlanBriefingItem(data, place);
  const today = typeof planAwareBriefingItems === "function" ? planAwareBriefingItems(data, place) : [];
  const nextKey = typeof planBriefingItemKey === "function" ? planBriefingItemKey(next) : "";
  const alternate = today.find((item) => (
    typeof planBriefingItemKey !== "function" || planBriefingItemKey(item) !== nextKey
  ));
  return [
    next ? forYouPlanCard(next, "Next plan", data) : "",
    !next && alternate ? forYouPlanCard(alternate, "Today", data) : ""
  ].filter(Boolean);
}

function forYouPlanCard(item, label, data) {
  const memory = item?.memory;
  if (!memory?.id) return "";
  const title = typeof planMemoryTitle === "function" ? planMemoryTitle(memory) : (memory.title || "Plan");
  const when = typeof planPulseWhenText === "function" ? planPulseWhenText(memory, data) : "";
  const lead = [item.verdict, item.primaryReason ? capitalize(item.primaryReason) : ""]
    .filter(Boolean)
    .join(". ")
    .replace(/\.$/, "");
  const body = compactForYouText(lead || item.advice || "Plan-aware forecast", 92);
  return `
    <button class="for-you-card is-plan is-${escapeHtml(item.tone || "neutral")}" type="button" data-memory-show="${escapeHtml(memory.id)}" data-for-you-signal="memory-show">
      <span class="for-you-kicker"><span>${escapeHtml(label)}</span><em>${escapeHtml(when)}</em></span>
      <strong>${escapeHtml(title)}</strong>
      <span class="for-you-body">${escapeHtml(body)}</span>
      <small>Check plan</small>
    </button>
  `;
}

function forYouElsewherePlanCard(data, place) {
  const entry = nextForYouElsewhereMemory(data, place);
  const memory = entry?.memory;
  if (!memory?.id) return "";
  const title = typeof planMemoryTitle === "function" ? planMemoryTitle(memory) : (memory.title || "Plan");
  const where = placeLabel(memory.place);
  const day = typeof planMemoryDayLabel === "function" ? planMemoryDayLabel(memory, data) : memory.targetDate;
  const time = typeof planMemoryTimeText === "function" ? planMemoryTimeText(memory) : "";
  return `
    <button class="for-you-card is-plan is-away" type="button" data-memory-show="${escapeHtml(memory.id)}" data-for-you-signal="memory-show">
      <span class="for-you-kicker"><span>Next away</span><em>${escapeHtml(where)}</em></span>
      <strong>${escapeHtml(title)}</strong>
      <span class="for-you-body">${escapeHtml([day, time].filter(Boolean).join(" · "))}</span>
      <small>Check plan</small>
    </button>
  `;
}

function nextForYouElsewhereMemory(data, place) {
  if (!Array.isArray(state.planMemories) || !state.planMemories.length || !place) return null;
  const now = forecastNowMs(data);
  const items = state.planMemories
    .filter((memory) => !forYouSamePlace(memory.place, place))
    .map((memory) => {
      const startMs = forYouMemoryBoundaryMs(memory, data, memory.startHour);
      const endMs = forYouMemoryBoundaryMs(memory, data, memory.endHour);
      return { memory, startMs, endMs };
    })
    .filter((item) => item.endMs === null || item.endMs >= now - 60 * 60 * 1000)
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
  return items[0] || null;
}

function forYouSamePlace(a, b) {
  if (typeof samePlanPlace === "function") return samePlanPlace(a, b);
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return Math.abs(Number(a.latitude) - Number(b.latitude)) < 0.01 &&
    Math.abs(Number(a.longitude) - Number(b.longitude)) < 0.01;
}

function forYouMemoryBoundaryMs(memory, data, hour) {
  const targetDate = datePart(memory?.targetDate);
  const numericHour = Number(hour);
  if (!targetDate || !Number.isFinite(numericHour)) return null;
  const dayOffset = daysFromForecastToday(targetDate, data);
  if (typeof planBoundaryMs === "function" && Number.isInteger(dayOffset)) {
    return planBoundaryMs(data, numericHour, dayOffset);
  }
  const wholeHour = Math.floor(numericHour);
  const minute = Math.round((numericHour - wholeHour) * 60);
  return parseForecastTimestamp(`${targetDate}T${String(wholeHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, data);
}

function forYouInterruptionCard(data, tempUnit, windUnit, truth, weatherItems) {
  const nextRain = nextRainChance(data, 12, 55);
  if (nextRain) {
    const summaryIndex = weatherItems.findIndex((item) => item?.tone === "rain" || /rain/i.test(item?.value || ""));
    return {
      type: "rain",
      html: `
        <button class="for-you-card is-interruption is-rain" type="button" data-for-you-summary="${summaryIndex >= 0 ? summaryIndex : 1}" data-for-you-signal="launch-summary">
          <span class="for-you-kicker"><span>Heads up</span><em>Rain risk</em></span>
          <strong>${nextRain.chance}% near ${escapeHtml(formatTime(nextRain.time))}</strong>
          <span class="for-you-body">Worth checking before outdoor plans.</span>
          <small>Hourly detail</small>
        </button>
      `
    };
  }

  const gustThreshold = windUnit === "mph" ? 28 : 45;
  const gustIndex = futureMaxHourlyIndex(data, "wind_gusts_10m", 18);
  const gust = gustIndex >= 0 ? Math.round(data.hourly.wind_gusts_10m[gustIndex] || 0) : 0;
  if (gust >= gustThreshold) {
    const summaryIndex = weatherItems.findIndex((item) => item?.tone === "wind");
    return {
      type: "wind",
      html: `
        <button class="for-you-card is-interruption is-wind" type="button" data-for-you-summary="${summaryIndex >= 0 ? summaryIndex : 2}" data-for-you-signal="launch-summary">
          <span class="for-you-kicker"><span>Heads up</span><em>Wind</em></span>
          <strong>Gusts ${gust} ${escapeHtml(windUnit)}</strong>
          <span class="for-you-body">Keep outdoor plans flexible.</span>
          <small>Hourly detail</small>
        </button>
      `
    };
  }

  return { type: "", html: "" };
}

function compactForYouText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function summaryItemAria(item) {
  const base = `Show hourly details for ${item.label}: ${item.value}`;
  return item.receipt ? `${base}. ${item.receipt}` : base;
}

function launchSummaryItems(data, tempUnit, windUnit, truth = weatherTruth(data)) {
  const current = data.current;
  const actual = Math.round(current.temperature_2m);
  const feels = Math.round(current.apparent_temperature);
  const humidity = current.relative_humidity_2m ?? 0;
  const comfort = comfortGlance(actual, feels, humidity, tempUnit).headline;
  const nowPrecip = truth.nowPrecip || nowPrecipSignal(data);
  const precip = truth.precip || buildPrecipTruth(data, nowPrecip, {
    rawCode: truth.display?.rawCode,
    pop: truth.display?.pop,
    cloud: truth.display?.cloud,
    precip: truth.display?.precip,
    baseCode: truth.display?.code
  });
  const activePrecip = precip.phase === "active";
  const nowValue = activePrecip ? activePrecipSummaryValue(precip, nowPrecip) : `${comfort} - feels ${feels}${degree(tempUnit)}`;
  const now = {
    label: "Now",
    value: nowValue,
    tone: activePrecip ? (nowPrecip.isSnow ? "snow" : "rain") : "now",
    receipt: truth.surfaceDetail || truth.receiptDetail || truth.receipt,
    target: launchDetailTarget(
      data,
      "Now",
      nowValue,
      forecastNowMs(data),
      { hours: 1 }
    )
  };
  const next = launchNextItem(data, { nowPrecipCovered: activePrecip, truth });
  const later = launchLaterItem(data, tempUnit, windUnit, Boolean(next.rainSoon));
  return [now, next, later].filter(Boolean).slice(0, 3);
}

function launchDetailTarget(data, label, value, startMs, options = {}) {
  if (startMs === null || startMs === undefined) return null;
  const ms = Number(startMs);
  if (!Number.isFinite(ms)) return null;
  const hours = options.hours || 1;
  const endMs = options.endMs || (ms + hours * 60 * 60 * 1000);
  return {
    startMs: ms,
    endMs: Math.max(endMs, ms + 30 * 60 * 1000),
    badgeLabel: label,
    label: `${label}: ${value}`
  };
}

function forecastHourWindowTarget(data, label, value, index, hours = 1) {
  if (index < 0 || !data?.hourly?.time?.[index]) return null;
  const startMs = parseForecastTimestamp(data.hourly.time[index], data);
  const endMs = data.hourly.time[index + hours]
    ? parseForecastTimestamp(data.hourly.time[index + hours], data)
    : startMs !== null ? startMs + hours * 60 * 60 * 1000 : null;
  return launchDetailTarget(data, label, value, startMs, { endMs, hours });
}

function compactNowcastDetail(detail) {
  return String(detail || "")
    .replace(/^Starting in about /i, "in ")
    .replace(/^Likely for /i, "for ")
    .replace(/^Easing around /i, "eases ")
    .replace(/, lasting about /i, " for ");
}

function launchNextItem(data, options = {}) {
  const nowcast = options.truth?.nowPrecip?.nowcast || analyzeNowcast(data);
  if (nowcast && !nowcastConflictsWithActivePrecip(nowcast, options.truth)) {
    const wetIndex = nowcast.wet.findIndex(Boolean);
    const targetMs = nowcast.wet[0]
      ? forecastNowMs(data)
      : wetIndex >= 0 ? nowcast.slots[wetIndex]?.t : forecastNowMs(data);
    const value = options.nowPrecipCovered && nowcast.wet[0]
      ? compactNowcastDetail(nowcast.detail).replace(/^eases /i, "Eases ")
      : `${nowcast.title} ${compactNowcastDetail(nowcast.detail)}`;
    return {
      label: "Next",
      value,
      tone: nowcast.isSnow ? "snow" : "rain",
      rainSoon: true,
      target: launchDetailTarget(data, "Next", value, targetMs, { hours: 1.5 })
    };
  }

  const currentChance = options.truth?.rainChance ?? currentRainChance(data);
  if (!options.nowPrecipCovered && currentChance >= 35) {
    const value = `${currentChance}% rain nearby`;
    return {
      label: "Next",
      value,
      tone: "rain",
      rainSoon: true,
      target: launchDetailTarget(data, "Next", value, forecastNowMs(data), { hours: 1 })
    };
  }

  const nextRain = nextRainChance(data, 12, 35);
  if (nextRain) {
    const value = `Rain near ${formatTime(nextRain.time)}`;
    const targetMs = parseForecastTimestamp(nextRain.time, data);
    return {
      label: "Next",
      value,
      tone: "rain",
      rainSoon: true,
      target: launchDetailTarget(data, "Next", value, targetMs, { hours: 1 })
    };
  }

  const value = "Dry next 2 hours";
  return {
    label: "Next",
    value,
    tone: "dry",
    rainSoon: false,
    target: launchDetailTarget(data, "Next", value, forecastNowMs(data), { hours: 2 })
  };
}

function launchLaterItem(data, tempUnit, windUnit, rainAlreadyCovered = false) {
  const laterRain = !rainAlreadyCovered ? nextRainChance(data, 24, 35) : null;
  if (laterRain) {
    const value = `Rain near ${formatTime(laterRain.time)}`;
    const targetMs = parseForecastTimestamp(laterRain.time, data);
    return {
      label: "Later",
      value,
      tone: "rain",
      target: launchDetailTarget(data, "Later", value, targetMs, { hours: 1 })
    };
  }

  const daily = data.daily;
  const todayIndex = forecastDailyIndex(data);
  const gustThreshold = windUnit === "mph" ? 25 : 40;
  const gustIndex = futureMaxHourlyIndex(data, "wind_gusts_10m", 24);
  const gust = gustIndex >= 0
    ? Math.round(data.hourly.wind_gusts_10m[gustIndex] || 0)
    : Math.round(daily.wind_gusts_10m_max?.[todayIndex] || data.current.wind_gusts_10m || data.current.wind_speed_10m || 0);
  if (gust >= gustThreshold) {
    const value = `Gusts ${gust} ${windUnit}`;
    return {
      label: "Later",
      value,
      tone: "wind",
      target: forecastHourWindowTarget(data, "Later", value, gustIndex, 1)
    };
  }

  const now = forecastNowMs(data);
  const sunMode = todaySunMode(data);
  const sunsetISO = daily.sunset?.[todayIndex];
  const sunsetMs = state.sunsetMs || (sunsetISO ? parseForecastTimestamp(sunsetISO, data) : null);
  if (sunMode === "normal" && sunsetMs && now < sunsetMs && sunsetISO) {
    const value = `Sunset ${formatTime(sunsetISO)}`;
    return {
      label: "Later",
      value,
      tone: "sun",
      target: launchDetailTarget(data, "Later", value, sunsetMs - 30 * 60 * 1000, { hours: 1 })
    };
  }

  const lowIndex = futureMinHourlyIndex(data, "temperature_2m", 18);
  const value = `Low ${Math.round(daily.temperature_2m_min[todayIndex])}${degree(tempUnit)} overnight`;
  return {
    label: "Later",
    value,
    tone: "temp",
    target: forecastHourWindowTarget(data, "Later", value, lowIndex, 1)
  };
}

function futureHourlyIndexes(data, hoursAhead = 24) {
  const now = forecastNowMs(data);
  const end = now + hoursAhead * 60 * 60 * 1000;
  return (data?.hourly?.time || [])
    .map((time, index) => ({ index, ms: parseForecastTimestamp(time, data) }))
    .filter(({ ms }) => ms !== null && ms >= now - 30 * 60 * 1000 && ms <= end)
    .map(({ index }) => index);
}

function futureMaxHourlyIndex(data, key, hoursAhead = 24) {
  let best = -1;
  let bestValue = -Infinity;
  futureHourlyIndexes(data, hoursAhead).forEach((index) => {
    const value = Number(data?.hourly?.[key]?.[index]);
    if (Number.isFinite(value) && value > bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best;
}

function futureMinHourlyIndex(data, key, hoursAhead = 24) {
  let best = -1;
  let bestValue = Infinity;
  futureHourlyIndexes(data, hoursAhead).forEach((index) => {
    const value = Number(data?.hourly?.[key]?.[index]);
    if (Number.isFinite(value) && value < bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best;
}

function openLaunchSummaryDetail(index) {
  const target = launchSummaryTargets[index];
  if (!target) return;
  openNext24Detail({
    eventWindow: target,
    contextLabel: `Launch summary · ${target.label}`
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ---------- Precipitation nowcast ("rain in ~X min") ---------- */

// Analyze the next ~2 hours of 15-minute precipitation into a plain-language
// headline + a timeline. Returns null when it's dry (so the strip stays hidden).
function analyzeNowcast(data) {
  const m = data.minutely_15;
  if (!m || !m.time || !m.precipitation) return null;

  const now = forecastNowMs(data);
  const inch = (state.unit === "fahrenheit");
  const wetThreshold = inch ? 0.002 : 0.05; // measurable precip per 15 min

  // Keep the current slot through the next ~2 hours.
  const slots = [];
  for (let i = 0; i < m.time.length; i++) {
    const t = parseForecastTimestamp(m.time[i], data);
    if (t === null) continue;
    if (t < now - 15 * 60 * 1000) continue; // drop fully-past slots
    slots.push({
      t,
      time: m.time[i],
      precip: m.precipitation[i] || 0,
      snow: (m.snowfall && m.snowfall[i]) || 0,
      prob: (m.precipitation_probability && m.precipitation_probability[i]) || 0
    });
    if (slots.length >= 8) break;
  }
  if (!slots.length) return null;

  const wet = slots.map((s) => s.precip > wetThreshold);
  if (!wet.some(Boolean)) return null; // dry → hide

  const wetSlots = slots.filter((_, i) => wet[i]);
  const peak = Math.max(...wetSlots.map((s) => s.precip));
  const perHour = peak * 4;
  const isSnow = wetSlots.some((s) => s.snow > 0);
  const heavy = inch ? perHour > 0.3 : perHour > 7.6;
  const moderate = inch ? perHour > 0.1 : perHour > 2.5;
  const intensity = heavy ? "Heavy " : moderate ? "Moderate " : "Light ";
  const peakFrac = nowcastFrac(perHour, inch);
  const word = isSnow ? "snow" : "rain";
  const label = `${intensity}${word}`.trim();
  const Label = capitalize(label);

  const roundMin = (ms) => {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min <= 5) return 5;
    return Math.round(min / 5) * 5;
  };

  let title;
  let detail;
  if (wet[0]) {
    // Raining now — when does it ease?
    const firstDry = wet.indexOf(false);
    title = `${Label} now`;
    if (firstDry === -1) {
      detail = "Likely for at least the next 2 hours";
    } else {
      detail = `Easing around ${formatTime(slots[firstDry].time)}`;
    }
  } else {
    // Dry now — when does it start?
    const startIdx = wet.indexOf(true);
    const mins = roundMin(slots[startIdx].t - now);
    title = `${Label} soon`;
    detail = `Starting in about ${mins} min`;
    const dryAfter = wet.indexOf(false, startIdx);
    if (dryAfter !== -1) {
      const dur = roundMin(slots[dryAfter].t - slots[startIdx].t);
      detail += `, lasting about ${dur} min`;
    }
  }

  const headline = `${title}, ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
  return { headline, title, detail, slots, wet, peak, peakFrac, isSnow };
}

function nowcastConflictsWithActivePrecip(analysis, truth = weatherTruth()) {
  return Boolean(truth?.nowPrecip?.isWetNow && analysis && !analysis.wet?.[0]);
}

function renderNowcast(data, truth = weatherTruth(data)) {
  const el = document.getElementById("nowcast");
  const analysis = analyzeNowcast(data);
  if (!analysis || nowcastConflictsWithActivePrecip(analysis, truth)) {
    el.hidden = true;
    return;
  }

  document.getElementById("nowcastTitle").textContent = analysis.title;
  document.getElementById("nowcastSubtitle").textContent = analysis.detail;
  document.getElementById("nowcastIcon").innerHTML = analysis.isSnow ? snowGlyph() : raindropGlyph();
  document.getElementById("nowcastGraph").innerHTML = buildNowcastGraph(analysis);
  el.style.setProperty("--nowcast-accent", nowcastIntensityColor(analysis.peakFrac));
  el.style.setProperty("--nowcast-glow", nowcastIntensityRgba(analysis.peakFrac, analysis.isSnow ? 0.18 : 0.22));
  const receipt = truth.surfaceDetail || truth.receiptDetail || "";
  el.title = receipt;
  el.setAttribute("aria-label", `${analysis.headline}. ${receipt ? `${receipt}. ` : ""}Open hourly details.`);
  el.hidden = false;
}

function raindropGlyph() {
  return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5C10 2.5 4.5 9 4.5 13a5.5 5.5 0 0 0 11 0C15.5 9 10 2.5 10 2.5z" fill="currentColor"/></svg>`;
}
function snowGlyph() {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="10" y1="2" x2="10" y2="18"/><line x1="2" y1="10" x2="18" y2="10"/><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg>`;
}

// Shared intensity fraction: maps precip rate (per-hour, display units) → 0..1.
function nowcastFrac(perHour, inch) {
  const lightMax = inch ? 0.1 : 2.5;
  const modMax   = inch ? 0.3 : 7.6;
  const heavyCap = inch ? 0.6 : 15;
  if (perHour <= 0) return 0;
  if (perHour <= lightMax) return (perHour / lightMax) / 3;
  if (perHour <= modMax)   return 1 / 3 + ((perHour - lightMax) / (modMax - lightMax)) / 3;
  return Math.min(1, 2 / 3 + ((perHour - modMax) / (heavyCap - modMax)) / 3);
}

// Compact nowcast ramp: intensity stays rain-native instead of alert-colored.
function nowcastIntensityRgb(f) {
  const stops = [
    [0.00, [117, 201, 230]],
    [0.35, [87, 166, 226]],
    [0.70, [106, 135, 224]],
    [1.00, [165, 126, 216]]
  ];
  const t = Math.min(Math.max(f, 0), 1);
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const [a, ca] = stops[i], [b, cb] = stops[i + 1];
      const k = (t - a) / (b - a || 1);
      return ca.map((c, j) => Math.round(c + (cb[j] - c) * k));
    }
  }
  return stops[stops.length - 1][1];
}

function nowcastIntensityColor(f) {
  return `rgb(${nowcastIntensityRgb(f).join(",")})`;
}

function nowcastIntensityRgba(f, alpha) {
  return `rgba(${nowcastIntensityRgb(f).join(",")}, ${alpha})`;
}

function shortClock(t) {
  const parts = localDateTimeParts(t);
  if (parts) return formatClock(parts.hour, parts.minute, true);
  const d = new Date(t);
  return formatClock(d.getHours(), d.getMinutes(), true);
}

function buildNowcastGraph(analysis) {
  const { slots } = analysis;
  const inch = state.unit === "fahrenheit";

  const VW = 320, H = 72;
  const padL = 8, padR = 8, topY = 8, baseY = 48;
  const plotW = VW - padL - padR;
  const plotH = baseY - topY;
  const n = slots.length;

  const fr = (i) => nowcastFrac((slots[i].precip || 0) * 4, inch);
  const x = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const pts = slots.map((s, i) => ({ x: x(i), y: baseY - fr(i) * plotH }));
  const line = smoothPath(pts);
  const area = `${line} L ${pts[n - 1].x.toFixed(1)} ${baseY} L ${pts[0].x.toFixed(1)} ${baseY} Z`;

  // Horizontal gradient coloring the curve by intensity at each moment.
  const gradStops = pts.map((p, i) =>
    `<stop offset="${((i / Math.max(n - 1, 1)) * 100).toFixed(1)}%" stop-color="${nowcastIntensityColor(fr(i))}"/>`
  ).join("");

  const idxEnd = n - 1;
  const botTime = (i, anchor, t) => `<text x="${x(i).toFixed(1)}" y="${H - 2}" text-anchor="${anchor}" class="nowcast-axis">${t}</text>`;
  const botLabels = botTime(0, "start", "Now") + botTime(idxEnd, "end", "2 hr");

  return `<svg viewBox="0 0 ${VW} ${H}" class="nowcast-svg">
    <defs>
      <linearGradient id="nowcastGrad" x1="0" y1="0" x2="1" y2="0">${gradStops}</linearGradient>
    </defs>
    <path d="${area}" fill="url(#nowcastGrad)" fill-opacity="0.18"/>
    <path d="${line}" fill="none" stroke="url(#nowcastGrad)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="${padL}" y1="${baseY}" x2="${VW - padR}" y2="${baseY}" class="nowcast-base"/>
    ${botLabels}
  </svg>`;
}

function renderInsights(data, windUnit) {
  const now = forecastNowMs(data);
  const sunsetMs = state.sunsetMs;
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const noonMs = forecastLocalBoundaryMs(data, 12) ?? new Date().setHours(12, 0, 0, 0);

  const isEvening = sunsetMs && now >= sunsetMs - twoHoursMs;
  const isMorning = now < noonMs;

  const cards = isEvening
    ? buildEveningInsights(data, windUnit)
    : isMorning
      ? buildMorningInsights(data, windUnit)
      : buildAfternoonInsights(data, windUnit);
  const outdoor = outdoorInsight(data);
  if (outdoor) cards.push(outdoor);

  els.insightCards.innerHTML = cards.map(({ label, value }) => `
    <article class="insight">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join("");
}

// Compact, grounded snapshot of the current forecast for the on-device LLM.
// Every value carries its unit so a tiny model never has to infer them.
// Returns null until a place is loaded.
function buildAIContext(data = state.forecast, place = state.activePlace, alertsSource = activeAlerts) {
  if (!data || !place) return null;

  const inch = state.unit === "fahrenheit";
  const cur = data.current;
  const daily = data.daily;
  const hourly = data.hourly;
  const now = forecastNowMs(data);
  const r = Math.round;
  const sky = (code) => weatherCodes[code] || "—";
  const dir = (deg) => {
    if (deg == null) return "";
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  };

  // Reuse the existing nowcast analysis; headline or an explicit "dry".
  const nc = analyzeNowcast(data);
  const nowcast = nc ? nc.headline : "Dry for the next 2 hours";
  const air = airQualitySummary(data);

  // Sparse hourly points (~every 3h) so the model can answer "later today".
  let start = hourly.time.findIndex((t) => {
    const ms = parseForecastTimestamp(t, data);
    return ms !== null && ms >= now - 30 * 60 * 1000;
  });
  if (start < 0) start = 0;
  const next12h = [];
  for (let k = 0; k < 5; k++) {
    const i = start + k * 3;
    if (i >= hourly.time.length) break;
    next12h.push({
      t: shortClock(hourly.time[i]),
      temp: r(hourly.temperature_2m[i]),
      rain: hourly.precipitation_probability[i] || 0
    });
  }

  // Full multi-day outlook (today=0 … +9) so day-specific questions
  // ("will it rain Tuesday?") can be answered exactly from the data.
  const dayName = (iso) => new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(`${iso}T12:00:00`));
  const dailyArr = [];
  for (let i = 0; i < daily.time.length && i < 10; i++) {
    dailyArr.push({
      date: daily.time[i],
      dow: new Date(`${daily.time[i]}T12:00:00`).getDay(),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayName(daily.time[i]),
      hi: r(daily.temperature_2m_max[i]),
      lo: r(daily.temperature_2m_min[i]),
      rainChance: daily.precipitation_probability_max[i] || 0,
      sky: sky(representativeDailyCode(data, i)),
      sunrise: daily.sunrise[i] ? shortClock(daily.sunrise[i]) : null,
      sunset: daily.sunset[i] ? shortClock(daily.sunset[i]) : null
    });
  }

  const alerts = (alertsSource || []).slice(0, 3).map((a) => ({
    event: a.event,
    severity: a.severity,
    until: (a.ends || a.expires) ? shortClock(new Date(a.ends || a.expires).getTime()) : null
  }));

  return {
    place: placeLabel(place),
    asOf: shortClock(cur.time),
    units: { temp: inch ? "°F" : "°C", wind: inch ? "mph" : "km/h", precip: inch ? "in" : "mm" },
    now: {
      temp: r(cur.temperature_2m),
      feels: r(cur.apparent_temperature),
      humidity: r(cur.relative_humidity_2m),
      sky: sky(cur.weather_code),
      wind: r(cur.wind_speed_10m),
      gust: r(cur.wind_gusts_10m),
      windDir: dir(cur.wind_direction_10m),
      isDay: cur.is_day !== 0
    },
    nowcast,
    today: {
      hi: r(daily.temperature_2m_max[0]),
      lo: r(daily.temperature_2m_min[0]),
      rainChance: daily.precipitation_probability_max[0] || 0,
      uvPeak: r(daily.uv_index_max[0]),
      sunrise: daily.sunrise[0] ? shortClock(daily.sunrise[0]) : null,
      sunset: shortClock(daily.sunset[0])
    },
    tomorrow: {
      hi: r(daily.temperature_2m_max[1]),
      lo: r(daily.temperature_2m_min[1]),
      rainChance: daily.precipitation_probability_max[1] || 0,
      sky: sky(representativeDailyCode(data, 1)),
      sunrise: daily.sunrise[1] ? shortClock(daily.sunrise[1]) : null,
      sunset: daily.sunset[1] ? shortClock(daily.sunset[1]) : null
    },
    next12h,
    daily: dailyArr,
    air,
    alerts
  };
}

// Natural-language fact sheet for the LLM. Tiny models reason over prose far
// better than nested JSON, so we pre-digest the context into plain sentences
// and let the model do only phrasing — not parsing or arithmetic.
function buildAIFactSheet() {
  const c = buildAIContext();
  if (!c) return null;
  const u = c.units;
  const lines = [];
  // Word the rain chance so a tiny model can't mistake "5% chance of rain" for "it will rain".
  const rainWord = (p) =>
    p < 15 ? `rain unlikely (${p}%)`
    : p < 35 ? `slight rain chance (${p}%)`
    : p < 60 ? `decent rain chance (${p}%)`
    : `rain likely (${p}%)`;

  lines.push(`Place: ${c.place}. Local time ${c.asOf}, ${c.now.isDay ? "daytime" : "night"}.`);

  const gust = c.now.gust > c.now.wind + 2 ? ` gusting to ${c.now.gust}` : "";
  lines.push(
    `Right now: ${c.now.temp}${u.temp}, feels like ${c.now.feels}${u.temp}, ` +
    `${c.now.sky.toLowerCase()}. Wind ${c.now.wind} ${u.wind}${gust} from the ${c.now.windDir}. ` +
    `Humidity ${c.now.humidity}%.`
  );

  lines.push(`${c.nowcast.replace(/\.$/, "")}.`);

  if (c.air) {
    const airParts = [];
    if (c.air.aqi !== null) airParts.push(`air ${c.air.band.label.toLowerCase()}, US AQI ${c.air.aqi}`);
    if (c.air.pm25 !== null) airParts.push(`PM2.5 ${Math.round(c.air.pm25)} micrograms per cubic meter`);
    if (c.air.pollen) {
      airParts.push(`${c.air.pollen.label} pollen ${c.air.pollen.levelLabel}`);
    }
    if (airParts.length) lines.push(`Air quality: ${airParts.join(", ")}.`);
  }

  if (c.now.isDay) {
    // Daytime: the day's high/low and UV still lie ahead.
    lines.push(
      `Rest of today: high ${c.today.hi}${u.temp}, low ${c.today.lo}${u.temp}, ` +
      `${rainWord(c.today.rainChance)}. UV index peaks at ${c.today.uvPeak}. ` +
      `Sunset ${c.today.sunset}.`
    );
    lines.push(
      `Tomorrow: ${c.tomorrow.sky.toLowerCase()}, high ${c.tomorrow.hi}${u.temp}, ` +
      `low ${c.tomorrow.lo}${u.temp}, ${rainWord(c.tomorrow.rainChance)}.`
    );
  } else {
    // Night: today's high is already past — frame around the overnight low and tomorrow.
    lines.push(
      `Tonight: low near ${c.tomorrow.lo}${u.temp}. ` +
      `Tomorrow: ${c.tomorrow.sky.toLowerCase()}, high ${c.tomorrow.hi}${u.temp}, ` +
      `${rainWord(c.tomorrow.rainChance)}. UV index peaks at ${c.today.uvPeak}.`
    );
  }

  if (c.next12h && c.next12h.length) {
    const pts = c.next12h
      .map((h) => `${h.t} ${h.temp}${u.temp}${h.rain >= 30 ? ` (${h.rain}% rain)` : ""}`)
      .join(", ");
    lines.push(`Coming hours: ${pts}.`);
  }

  if (c.alerts && c.alerts.length) {
    lines.push(
      "Active alerts: " +
      c.alerts.map((a) => `${a.event}${a.until ? ` until ${a.until}` : ""}`).join("; ") + "."
    );
  } else {
    lines.push("No active weather alerts.");
  }

  return lines.join("\n");
}

function hoursInRange(data, fromMs, toMs) {
  return data.hourly.time
    .map((t, i) => ({ ms: parseForecastTimestamp(t, data), i }))
    .filter(({ ms }) => ms !== null && ms >= fromMs && ms < toMs);
}

function maxRainInRange(data, fromMs, toMs) {
  const hours = hoursInRange(data, fromMs, toMs);
  if (!hours.length) return 0;
  return Math.max(...hours.map(({ i }) => data.hourly.precipitation_probability[i] || 0));
}

function rainPhraseShort(pct) {
  if (pct >= 70) return "rain likely";
  if (pct >= 40) return "rain possible";
  return "staying dry";
}

function buildMorningInsights(data, windUnit) {
  const now = forecastNowMs(data);
  const noonMs = forecastLocalBoundaryMs(data, 12) ?? new Date().setHours(12, 0, 0, 0);
  const sixPmMs = forecastLocalBoundaryMs(data, 18) ?? new Date().setHours(18, 0, 0, 0);
  const sunMode = todaySunMode(data);
  const todayIndex = forecastDailyIndex(data);
  const sunsetTime = sunMode === "normal" && data.daily.sunset[todayIndex] ? formatTime(data.daily.sunset[todayIndex]) : null;
  const low0 = Math.round(data.daily.temperature_2m_min[todayIndex]);

  const morningRain = maxRainInRange(data, now, noonMs);
  const afternoonHours = hoursInRange(data, noonMs, sixPmMs);
  const afternoonRain = maxRainInRange(data, noonMs, sixPmMs);
  const afternoonHigh = afternoonHours.length
    ? Math.max(...afternoonHours.map(({ i }) => Math.round(data.hourly.temperature_2m[i])))
    : Math.round(data.daily.temperature_2m_max[todayIndex]);
  let tonightValue = `Overnight low drops to ${low0}°.`;
  if (sunMode === "polar-day") {
    tonightValue = `Sun stays up tonight. Overnight low drops to ${low0}°.`;
  } else if (sunMode === "polar-night") {
    tonightValue = `Sun stays below the horizon today. Overnight low drops to ${low0}°.`;
  } else if (sunsetTime) {
    tonightValue = `Sun sets at ${sunsetTime}. Overnight low drops to ${low0}°.`;
  }

  return [
    {
      label: "This morning",
      value: morningRain >= 40
        ? `${capitalize(rainPhraseShort(morningRain))} through midday. Grab an umbrella.`
        : `Dry through midday. ${weatherCodes[data.current.weather_code] || "Mild"} conditions.`
    },
    {
      label: "This afternoon",
      value: `High near ${afternoonHigh}°. ${capitalize(rainPhraseShort(afternoonRain))} this afternoon.`
    },
    {
      label: "Tonight",
      value: tonightValue
    }
  ];
}

function buildAfternoonInsights(data, windUnit) {
  const now = forecastNowMs(data);
  const sunsetMs = state.sunsetMs;
  const midnightMs = forecastLocalBoundaryMs(data, 24) ?? new Date().setHours(24, 0, 0, 0);
  const sunMode = todaySunMode(data);
  const todayIndex = forecastDailyIndex(data);
  const tomorrowIndex = forecastDailyIndex(data, 1);
  const low0 = Math.round(data.daily.temperature_2m_min[todayIndex]);
  const high1 = Math.round(data.daily.temperature_2m_max[tomorrowIndex]);
  const rain1 = data.daily.precipitation_probability_max[tomorrowIndex] || 0;

  const remainingRain = maxRainInRange(data, now, sunsetMs || midnightMs);
  const overnightRain = maxRainInRange(data, sunsetMs || now, midnightMs);
  const sunsetTime = sunMode === "normal" && data.daily.sunset[todayIndex] ? formatTime(data.daily.sunset[todayIndex]) : null;

  return [
    {
      label: "Rest of today",
      value: sunsetTime
        ? `${capitalize(rainPhraseShort(remainingRain))} until sunset at ${sunsetTime}.`
        : `${capitalize(rainPhraseShort(remainingRain))} for the rest of the day.`
    },
    {
      label: "Tonight",
      value: `Overnight low of ${low0}°. ${overnightRain >= 40 ? capitalize(rainPhraseShort(overnightRain)) + " overnight." : "Dry overnight."}`
    },
    {
      label: "Tomorrow",
      value: `High of ${high1}°. ${capitalize(rainPhraseShort(rain1))} tomorrow.`
    }
  ];
}

function buildEveningInsights(data, windUnit) {
  const now = forecastNowMs(data);
  const sixAmMs = forecastLocalBoundaryMs(data, 6, 1) ?? new Date(now + 86400000).setHours(6, 0, 0, 0);
  const todayIndex = forecastDailyIndex(data);
  const tomorrowIndex = forecastDailyIndex(data, 1);
  const low0 = Math.round(data.daily.temperature_2m_min[todayIndex]);
  const high1 = Math.round(data.daily.temperature_2m_max[tomorrowIndex]);
  const rain1 = data.daily.precipitation_probability_max[tomorrowIndex] || 0;
  const uv1 = Math.round(data.daily.uv_index_max[tomorrowIndex] || 0);
  const gust1 = Math.round(data.daily.wind_gusts_10m_max[tomorrowIndex] || 0);
  const code1 = weatherCodes[representativeDailyCode(data, tomorrowIndex)] || "Mixed";

  const overnightRain = maxRainInRange(data, now, sixAmMs);

  return [
    {
      label: "Tonight",
      value: `Overnight low of ${low0}°. ${overnightRain >= 40 ? capitalize(rainPhraseShort(overnightRain)) + " through the night." : "Dry overnight."}`
    },
    {
      label: "Tomorrow",
      value: `${code1}. High of ${high1}°, ${rainPhraseShort(rain1)}.`
    },
    {
      label: "Heads up",
      value: buildHeadsUp(data, uv1, gust1, rain1, high1, low0, windUnit)
    }
  ];
}

function buildHeadsUp(data, uv1, gust1, rain1, high1, low0, windUnit) {
  const gustThreshold = windUnit === "mph" ? 35 : 56;
  const tempSwing = high1 - low0;

  if (rain1 >= 70) return `Heavy rain expected tomorrow — plan indoor alternatives.`;
  if (uv1 >= 8) return `Tomorrow's UV peaks at ${uv1}. Pack sunscreen for any time outdoors.`;
  if (gust1 >= gustThreshold) return `Strong gusts tomorrow near ${gust1} ${windUnit}. Secure loose items outside.`;
  if (tempSwing >= 25) return `Big swing ahead — overnight low of ${low0}°, climbing to ${high1}° tomorrow.`;
  if (rain1 < 20 && uv1 < 6) return `Conditions look favorable tomorrow. Good day to spend time outside.`;
  return `Low of ${low0}° tonight, high of ${high1}° tomorrow. Relatively mild conditions ahead.`;
}

function renderHourly(data, tempUnit, truth = weatherTruth(data)) {
  const perf = perfStart();
  const now = forecastNowMs(data);
  const rows = data.hourly.time
    .map((time, index) => ({ time, index, ms: parseForecastTimestamp(time, data) }))
    .filter((row) => row.ms !== null && row.ms >= now - 60 * 60 * 1000)
    .slice(0, 24);
  const planMemory = hourlyPlanMemoryContext(rows, data);

  // Compact, scannable columns — tap any hour to open that hour expanded.
  els.hourly.innerHTML = rows.map(({ time, index }, position) => {
    const precipProfile = hourlyPrecipProfile(data, index);
    let rain = precipProfile.pop;
    let rawCode = data.hourly.weather_code[index];
    let precip = data.hourly.precipitation?.[index] || 0;
    let wcode = precipProfile.code;
    let stormPotential = hasThunderPotential(rawCode, rain, wcode, precip, data);
    if (position === 0) {
      const display = truth.display;
      rawCode = display.rawCode;
      wcode = display.nowCode ?? truth.code;
      rain = display.nowPrecip?.isWetNow ? display.nowPrecip.chance : Math.max(rain, display.pop || 0);
      precip = Math.max(precip, display.precip || 0);
      stormPotential = display.stormPotential || hasThunderPotential(rawCode, display.pop, wcode, precip, data);
    }
    const nowPrecipPhase = position === 0 ? truth.precip?.phase : null;
    const measuredWet = position === 0
      ? nowPrecipPhase === "active"
      : precipProfile.primary && precipProfile.amountSupported;
    const code = weatherCodes[wcode] || "Weather";
    const isHourDay = position === 0 ? truth.isDay : (data.hourly.is_day ? Boolean(data.hourly.is_day[index]) : true);
    const temp = Math.round(data.hourly.temperature_2m[index]);
    const label = position === 0 ? "Now" : formatHour(time);
    const title = stormPotential ? `${code}; thunder possible` : code;
    const rainChance = Math.max(0, Math.min(100, Math.round(Number(rain) || 0)));
    const hasRainChance = rainChance > 0;
    const rainLabel = `${rainChance}%`;
    const rainIsEmphasized = measuredWet || nowPrecipPhase === "imminent" || rainChance >= 20;
    const rainClass = ` has-rain${rainIsEmphasized ? " wet" : " is-low"}`;
    const rainBarWidth = measuredWet ? Math.max(70, Math.min(100, rainChance)) : rainChance;
    const receipt = position === 0 ? (truth.surfaceDetail || truth.receiptDetail || truth.receipt || "") : "";
    const memoryItems = planMemory.markers.get(index) || [];
    const memoryLabel = hourlyPlanMemoryLabel(memoryItems);
    const hasPlanMemory = planMemory.overlaps.has(index);
    const rainAria = measuredWet ? ", rain" : nowPrecipPhase === "imminent" ? ", precipitation soon" : hasRainChance ? `, ${rainChance}% rain` : "";
    const cardLabel = `${label}: ${code}, ${temp} degrees${rainAria}${memoryLabel ? `, ${memoryLabel} starts` : ""}.${receipt ? ` ${receipt}.` : ""} Show hourly details.`;
    return `
      <article class="hour-card${position === 0 ? " current" : ""}${stormPotential ? " has-storm-potential" : ""}${hasPlanMemory ? " has-plan-memory" : ""}" role="button" tabindex="0" data-hour-index="${index}" aria-label="${escapeHtml(cardLabel)}" title="${escapeHtml(receipt || title)}">
        <span class="hour-label">${label}</span>
        ${memoryLabel ? `<span class="hour-memory">${escapeHtml(memoryLabel)}</span>` : ""}
        <div class="hour-icon weather-icon-with-badge" aria-hidden="true">${weatherIcon(wcode, isHourDay, { density: "dense" })}${stormPotential ? thunderBadgeHtml() : ""}</div>
        <strong class="hour-temp" style="--t-h:${tempOklchHue(temp).toFixed(0)}">${temp}°</strong>
        <span class="hour-rain${rainClass}">${rainLabel}</span>
        <div class="rain-bar" aria-hidden="true"><i style="width:${rainBarWidth}%"></i></div>
      </article>
    `;
  }).join("");
  perfEnd("renderHourly", perf);
}

// Absolute temperature → color, anchored to real-world warm/cold norms (°F).
// Color carries honest temperature semantics; bar POSITION stays week-relative
// (in renderDaily) so day-to-day differentiation is preserved even in extreme weeks.
const TEMP_SCALE = [
  [10, 270, 62, 56],   // frigid — violet
  [25, 222, 74, 55],   // freezing — blue
  [40, 196, 70, 50],   // cold — cyan
  [55, 152, 56, 47],   // cool — teal
  [68, 120, 50, 46],   // comfortable — green
  [78, 55, 76, 50],    // warm — yellow
  [88, 32, 84, 52],    // hot — orange
  [100, 8, 80, 52],    // very hot — red
  [112, -14, 70, 50]   // extreme — deep red
];

function tempColor(value, unit = state.unit) {
  const f = unit === "celsius" ? value * 9 / 5 + 32 : value;
  const s = TEMP_SCALE;
  if (f <= s[0][0]) return hslStop(s[0]);
  if (f >= s[s.length - 1][0]) return hslStop(s[s.length - 1]);
  for (let i = 0; i < s.length - 1; i++) {
    if (f >= s[i][0] && f <= s[i + 1][0]) {
      const k = (f - s[i][0]) / (s[i + 1][0] - s[i][0]);
      const h = s[i][1] + (s[i + 1][1] - s[i][1]) * k;
      const sa = s[i][2] + (s[i + 1][2] - s[i][2]) * k;
      const l = s[i][3] + (s[i + 1][3] - s[i][3]) * k;
      return `hsl(${(((h % 360) + 360) % 360).toFixed(0)}, ${sa.toFixed(0)}%, ${l.toFixed(0)}%)`;
    }
  }
  return hslStop(s[s.length - 1]);
}

function hslStop([, h, s, l]) {
  return `hsl(${(((h % 360) + 360) % 360)}, ${s}%, ${l}%)`;
}

// OKLCH hue for a temperature, paired in CSS with a theme-aware OKLCH lightness.
// HSL "lightness" isn't perceptually uniform — green at a given L looks far
// brighter than blue/red, so colored temps washed out on the light background.
// OKLCH lightness IS perceptual, so one lightness value gives every hue the same
// contrast. Anchors mirror TEMP_SCALE (cold→hot) but in OKLCH hue degrees.
const TEMP_OKLCH_HUE = [
  [10, 300], [25, 266], [40, 232], [55, 178], [68, 146],
  [78, 100], [88, 64], [100, 33], [112, 18]
];

function tempOklchHue(value, unit = state.unit) {
  const f = unit === "celsius" ? value * 9 / 5 + 32 : value;
  const s = TEMP_OKLCH_HUE;
  if (f <= s[0][0]) return s[0][1];
  if (f >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 0; i < s.length - 1; i++) {
    if (f >= s[i][0] && f <= s[i + 1][0]) {
      const k = (f - s[i][0]) / (s[i + 1][0] - s[i][0]);
      return s[i][1] + (s[i + 1][1] - s[i][1]) * k;
    }
  }
  return s[s.length - 1][1];
}

function renderDaily(data, tempUnit, precipUnit) {
  const perf = perfStart();
  const highs = data.daily.temperature_2m_max;
  const lows = data.daily.temperature_2m_min;
  const minTemp = Math.min(...lows);
  const maxTemp = Math.max(...highs);
  const spread = Math.max(maxTemp - minTemp, 1);

  els.daily.innerHTML = data.daily.time.map((time, index) => {
    const low = Math.round(lows[index]);
    const high = Math.round(highs[index]);
    const start = ((low - minTemp) / spread) * 100;
    const width = Math.max(((high - low) / spread) * 100, 6);
    const lowColor = tempColor(low);
    const highColor = tempColor(high);
    const rain = data.daily.precipitation_probability_max[index] || 0;
    const precip = data.daily.precipitation_sum[index] || 0;
    const wcode = representativeDailyCode(data, index);
    const precipProfile = dailyPrecipProfile(data, index);
    const code = dailyConditionLabel(wcode);
    const stormPotential = hasThunderPotentialForDay(data, index, wcode);
    const memoryItems = activePlanMemoryEventsForDay(index, data);
    const memoryCue = planMemoryDayCue(memoryItems);
    const precipNote = precipProfile.note;
    const dayAria = `${formatDay(time, index)} detail${stormPotential ? ", thunder possible" : ""}${precipNote ? `, ${precipNote}` : ""}${memoryCue ? `, watched plan ${memoryCue}` : ""}`;
    return `
      <article class="day-row${index === 0 ? " current" : ""}${stormPotential ? " has-storm-potential" : ""}${memoryCue ? " has-plan-memory" : ""}" data-index="${index}" role="button" tabindex="0" aria-label="${escapeHtml(dayAria)}">
        <div class="day-label">
          <div class="day-icon weather-icon-with-badge" aria-hidden="true">${weatherIcon(wcode, true, { density: "dense" })}${stormPotential ? thunderBadgeHtml() : ""}</div>
          <div>
            <div class="day-name">${formatDay(time, index)}</div>
            <div class="day-meta">
              <span class="day-condition">${escapeHtml(code)}</span>
              ${precipNote ? `<span class="day-precip-note">${escapeHtml(precipNote)}</span>` : ""}
              ${memoryCue ? `<span class="day-memory">${escapeHtml(memoryCue)}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="day-temps">
          <span class="day-low">${low}°</span>
          <div class="temp-track" aria-hidden="true">
            <i style="margin-left: ${start}%; width: ${width}%; background: linear-gradient(90deg, ${lowColor}, ${highColor})"></i>
          </div>
          <span class="day-high">${high}°</span>
        </div>
        <div class="day-rain" aria-label="${rain}% rain${precip > 0 ? `, ${formatAmount(precip)} ${precipUnit} precipitation` : ""}">
          <span>${rain}%</span>
          ${precip > 0 ? `<small>${formatAmount(precip)} ${precipUnit}</small>` : ""}
        </div>
      </article>
    `;
  }).join("");
  perfEnd("renderDaily", perf);
}

async function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("This browser does not support location lookup.", true);
    return;
  }

  const lookupSeq = ++locationLookupSeq;
  setStatus("Waiting for location permission...");
  startLocationLookupWatchdog(lookupSeq);
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (lookupSeq !== locationLookupSeq) return;
      clearLocationLookupWatchdog(lookupSeq);
      persistDeviceLocation(position.coords, "gps");
      const fallback = placeFromCoordinates(position.coords);
      setStatus("Naming your location...");
      try {
        const place = await reverseGeocodePlace(position.coords, fallback);
        if (lookupSeq !== locationLookupSeq) return;
        loadPlace(place);
      } catch {
        if (lookupSeq !== locationLookupSeq) return;
        loadPlace(fallback);
      }
    },
    (error) => {
      if (lookupSeq !== locationLookupSeq) return;
      clearLocationLookupWatchdog(lookupSeq);
      setStatus(locationErrorMessage(error), true);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
}

function startLocationLookupWatchdog(lookupSeq) {
  clearLocationLookupWatchdog();
  locationLookupTimer = setTimeout(() => {
    if (lookupSeq !== locationLookupSeq || state.activePlace) return;
    setStatus("Location lookup is taking too long. Search for a place or try again.", true);
  }, LOCATION_LOOKUP_TIMEOUT_MS);
}

function clearLocationLookupWatchdog(lookupSeq = null) {
  if (lookupSeq !== null && lookupSeq !== locationLookupSeq) return;
  if (!locationLookupTimer) return;
  clearTimeout(locationLookupTimer);
  locationLookupTimer = null;
}

function locationErrorMessage(error) {
  if (error?.code === 1) return "Location permission was not granted.";
  if (error?.code === 2) return "Current location is unavailable. Search for a place or try again.";
  if (error?.code === 3) return "Location lookup timed out. Search for a place or try again.";
  return "Could not get your location. Search for a place or try again.";
}

function placeFromCoordinates(coords) {
  return {
    id: `gps-${coords.latitude.toFixed(3)}-${coords.longitude.toFixed(3)}`,
    name: "Current Location",
    admin1: "",
    country: "",
    latitude: coords.latitude,
    longitude: coords.longitude
  };
}

async function reverseGeocodePlace(coords, fallback) {
  const cacheKey = `reverse-place:${coords.latitude.toFixed(3)}:${coords.longitude.toFixed(3)}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 30 * 24 * 60 * 60 * 1000;

  if (cached && Date.now() - cached.savedAt < maxCacheAge) {
    return { ...fallback, ...cached.place };
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: coords.latitude.toFixed(5),
    lon: coords.longitude.toFixed(5),
    zoom: "12",
    addressdetails: "1",
    layer: "address",
    "accept-language": "en"
  }).toString();

  const json = await fetchJsonWithTimeout(url, REVERSE_GEOCODE_TIMEOUT_MS);
  const place = placeFromReverseGeocode(json, fallback);
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), place }));
  return { ...fallback, ...place };
}

function placeFromReverseGeocode(json, fallback) {
  const address = json?.address || {};
  const name = address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.hamlet ||
    address.suburb ||
    address.county ||
    json?.name ||
    fallback.name;
  const admin1 = address.state || address.region || address.state_district || "";
  const country = address.country || "";

  return {
    id: `gps-${slug(name)}-${fallback.latitude.toFixed(3)}-${fallback.longitude.toFixed(3)}`,
    name,
    admin1,
    country
  };
}

function savePlace(place) {
  const normalized = normalizePlace(place);
  if (!state.savedPlaces.some((saved) => saved.id === normalized.id)) {
    state.savedPlaces = [normalized, ...state.savedPlaces].slice(0, 8);
    localStorage.setItem("weather-places", JSON.stringify(state.savedPlaces));
    renderSavedPlaces();
    updateMode();
    if (typeof syncPlanWatchNotificationSubscription === "function") {
      syncPlanWatchNotificationSubscription({ force: true, reason: "saved-place-added" });
    }
  }
}

function removeSavedPlace(id) {
  state.savedPlaces = state.savedPlaces.filter((place) => place.id !== id);
  localStorage.setItem("weather-places", JSON.stringify(state.savedPlaces));
  if (typeof prunePlaceWatchNotificationPlaces === "function") {
    prunePlaceWatchNotificationPlaces();
  }
  renderSavedPlaces();
  updateMode();
  if (typeof syncPlanWatchNotificationSubscription === "function") {
    syncPlanWatchNotificationSubscription({ force: true, reason: "saved-place-removed" });
  }
}

let glanceDetailReturnFocus = null;

function openGlanceDetail(kind, returnFocus = null) {
  const data = state.forecast;
  if (!data || !els.glanceDetailSheet || !els.glanceDetailBackdrop) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const detail = buildGlanceDetail(kind, data, tempUnit, windUnit, weatherTruth(data));
  if (!detail) return;

  glanceDetailReturnFocus = returnFocus instanceof HTMLElement
    ? returnFocus
    : (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  hideMetricTip();
  els.glanceDetailSheet.className = `day-sheet glance-detail-sheet is-${detail.kind}`;
  if (els.glanceDetailIcon) els.glanceDetailIcon.innerHTML = detail.icon;
  if (els.glanceDetailTitle) els.glanceDetailTitle.textContent = detail.title;
  if (els.glanceDetailContext) {
    els.glanceDetailContext.textContent = detail.context || "";
    els.glanceDetailContext.hidden = !detail.context;
  }
  if (els.glanceDetailSummary) els.glanceDetailSummary.textContent = detail.summary || "";
  if (els.glanceDetailBody) els.glanceDetailBody.innerHTML = detail.body || "";

  els.glanceDetailBackdrop.hidden = false;
  els.glanceDetailSheet.hidden = false;
  showSheet(els.glanceDetailBackdrop, els.glanceDetailSheet, {
    onPullDismiss: closeGlanceDetail,
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => els.glanceDetailClose?.focus({ preventScroll: true }));
}

function closeGlanceDetail() {
  if (!els.glanceDetailSheet || !els.glanceDetailBackdrop || els.glanceDetailSheet.hidden) return;
  els.glanceDetailBackdrop.classList.remove("show");
  els.glanceDetailSheet.classList.remove("show");
  document.body.style.overflow = mapState.immersive ? "hidden" : "";
  setTimeout(() => {
    els.glanceDetailBackdrop.hidden = true;
    els.glanceDetailSheet.hidden = true;
    const returnFocus = glanceDetailReturnFocus;
    glanceDetailReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }, 260);
}

function buildGlanceDetail(kind, data, tempUnit, windUnit, truth = weatherTruth(data)) {
  if (kind === "feels") return buildFeelsGlanceDetail(data, tempUnit, windUnit);
  if (kind === "rain") return buildRainGlanceDetail(data, tempUnit, windUnit, truth);
  if (kind === "wind") return buildWindGlanceDetail(data, windUnit);
  if (kind === "air") return buildAirGlanceDetail(data);
  return null;
}

function buildFeelsGlanceDetail(data, tempUnit, windUnit) {
  const current = data.current || {};
  const feels = Math.round(current.apparent_temperature);
  const actual = Math.round(current.temperature_2m);
  const diff = feels - actual;
  const humidity = current.relative_humidity_2m;
  const windSpeed = Math.round(current.wind_speed_10m || 0);
  const humidityNote = Number.isFinite(humidity) ? humidityContext(humidity) : "";
  const wind = windGlance(windSpeed, windUnit, current.wind_direction_10m);
  const context = [
    `Air ${actual}${degree(tempUnit)}`,
    Number.isFinite(humidity) ? `${humidity}% humidity` : "",
    `${windSpeed} ${windUnit} wind`
  ].filter(Boolean).join(" · ");

  return {
    kind: "feels",
    icon: glanceDetailIconHtml("feels"),
    title: `Feels like ${feels}${degree(tempUnit)}`,
    context,
    summary: metricTipFeels(diff, feels, tempUnit),
    body: `
      <section class="glance-detail-hero is-feels">
        <b>${escapeHtml(`${feels}${degree(tempUnit)}`)}</b>
        <span>${escapeHtml(feelsContext(diff, tempUnit))}</span>
      </section>
      <div class="glance-detail-facts">
        ${glanceDetailFactHtml("Air temp", `${actual}${degree(tempUnit)}`, "Measured temperature")}
        ${glanceDetailFactHtml("Humidity", Number.isFinite(humidity) ? `${humidity}%` : "--", humidityNote)}
        ${glanceDetailFactHtml("Wind", `${windSpeed} ${windUnit}`, wind.context)}
        ${glanceDetailFactHtml("Difference", `${diff > 0 ? "+" : ""}${diff}${degree(tempUnit)}`, diff === 0 ? "No adjustment" : "Feels-like adjustment")}
      </div>
      ${glanceDetailNoteHtml("Why it matters", "The feels-like value blends air temperature with humidity and wind so the glance matches what your body notices outside.")}
    `
  };
}

function buildRainGlanceDetail(data, tempUnit, windUnit, truth = weatherTruth(data)) {
  const rain = rainGlance(data, truth.rainChance, truth);
  const precip = truth.precip || {};
  const chance = truth.rainChance || 0;
  const nowcast = analyzeNowcast(data);
  const usableNowcast = nowcast && !nowcastConflictsWithActivePrecip(nowcast, truth) ? nowcast : null;
  const next = nextRainChance(data, 12, 20);
  const precipUnit = data.current_units?.precipitation || data.hourly_units?.precipitation || (state.unit === "fahrenheit" ? "in" : "mm");
  const amount = Math.max(Number(data.current?.precipitation || 0), Number(truth.nowPrecip?.amount || 0));
  const nowLabel = precip.phase === "active"
    ? activePrecipSummaryValue(precip, truth.nowPrecip)
    : precip.phase === "nearby" ? `${precip.label || "Rain"} nearby`
      : precip.phase === "imminent" ? `${precip.label || "Rain"} soon`
        : amount > 0 ? `${truth.label || "Precipitation"} now` : "Dry here";
  const source = weatherSourceLabel(precip.source || truth.source);
  const detail = precip.detail || truth.surfaceDetail || truth.receiptDetail || metricTipRain(chance);
  const title = precip.phase === "active" || precip.phase === "nearby" || precip.phase === "imminent"
    ? capitalize(nowLabel)
    : `Rain chance ${chance}%`;

  return {
    kind: "rain",
    icon: glanceDetailIconHtml(usableNowcast?.isSnow ? "snow" : "rain"),
    title,
    context: `${rain.context} · ${source}`,
    summary: detail,
    body: `
      <section class="glance-detail-hero is-rain">
        <b>${escapeHtml(els.rainChance?.textContent || `${chance}%`)}</b>
        <span>${escapeHtml(rain.context)}</span>
      </section>
      <div class="glance-detail-facts">
        ${glanceDetailFactHtml("Right now", nowLabel, amount > 0 ? `${formatAmount(amount)} ${precipUnit} measured` : source)}
        ${glanceDetailFactHtml("This hour", `${chance}%`, "Hourly forecast chance")}
        ${glanceDetailFactHtml("Next signal", next ? `${next.chance}% near ${formatTime(next.time)}` : "No meaningful rain", next ? "Forecast window" : "Next 12 hours")}
        ${glanceDetailFactHtml("Wind", `${Math.round(data.current?.wind_speed_10m || 0)} ${windUnit}`, "For umbrella comfort")}
      </div>
      ${usableNowcast ? `
        <section class="glance-detail-nowcast">
          <div class="glance-detail-section-head">
            <span>Near-term precip</span>
            <strong>${escapeHtml(usableNowcast.detail)}</strong>
          </div>
          <div class="nowcast-graph">${buildNowcastGraph(usableNowcast)}</div>
        </section>
      ` : ""}
      ${glanceDetailNoteHtml("Signal", detail)}
    `
  };
}

function buildWindGlanceDetail(data, windUnit) {
  const current = data.current || {};
  const speed = Math.round(current.wind_speed_10m || 0);
  const gust = Number.isFinite(current.wind_gusts_10m) ? Math.round(current.wind_gusts_10m) : null;
  const peakIndex = futureMaxHourlyIndex(data, "wind_gusts_10m", 12);
  const peakGust = peakIndex >= 0 ? Math.round(data.hourly.wind_gusts_10m[peakIndex] || 0) : null;
  const wind = windGlance(speed, windUnit, current.wind_direction_10m);
  const direction = wind.direction;
  const directionText = direction ? capitalize(direction.label) : "Direction unavailable";
  const towardText = direction ? capitalize(direction.towardLabel) : "";

  return {
    kind: "wind",
    icon: glanceDetailIconHtml("wind"),
    title: `${speed} ${windUnit} wind`,
    context: [directionText, wind.context].filter(Boolean).join(" · "),
    summary: metricTipWind(speed, windUnit),
    body: `
      <section class="glance-detail-wind">
        ${windVisualHtml(speed, windUnit, wind)}
      </section>
      <div class="glance-detail-facts">
        ${glanceDetailFactHtml("Coming from", directionText, towardText ? `Blowing ${direction.towardLabel}` : "")}
        ${glanceDetailFactHtml("Current speed", `${speed} ${windUnit}`, wind.context)}
        ${glanceDetailFactHtml("Gusts now", gust !== null ? `${gust} ${windUnit}` : "--", "Short bursts")}
        ${glanceDetailFactHtml("Peak next 12h", peakGust !== null ? `${peakGust} ${windUnit}` : "--", peakIndex >= 0 ? `Near ${formatTime(data.hourly.time[peakIndex])}` : "")}
      </div>
      ${glanceDetailNoteHtml("How to read it", "The dot marks where the wind is coming from. The arrow points where it is blowing, while the label keeps the standard weather convention.")}
    `
  };
}

function buildAirGlanceDetail(data) {
  const humidity = data.current?.relative_humidity_2m ?? 0;
  const air = airGlance(data, humidity);
  const summary = air.summary;

  if (summary) {
    const currentRows = [
      summary.aqi !== null ? glanceDetailFactHtml("AQI", `${summary.aqi}`, summary.band?.label || "") : "",
      summary.pm25 !== null ? glanceDetailFactHtml("PM2.5", `${Math.round(summary.pm25)} ug/m3`, "Fine particles") : "",
      summary.pm10 !== null ? glanceDetailFactHtml("PM10", `${Math.round(summary.pm10)} ug/m3`, "Coarse particles") : "",
      summary.pollen ? glanceDetailFactHtml("Pollen", `${capitalize(summary.pollen.label)} ${summary.pollen.levelLabel}`, "Outdoor allergens") : ""
    ].filter(Boolean).join("");
    const scale = AQI_SCALE.map((item) => `
      <li class="glance-detail-scale-row">
        <span style="--aqi-color:${escapeHtml(item.color)}" aria-hidden="true"></span>
        <strong>${escapeHtml(item.range)}</strong>
        <b>${escapeHtml(item.label)}</b>
      </li>
    `).join("");

    return {
      kind: "air",
      icon: glanceDetailIconHtml("air"),
      title: summary.visualLabel || summary.display || "Air quality",
      context: [summary.band?.advice || summary.context, summary.source].filter(Boolean).join(" · "),
      summary: air.context || summary.band?.advice || summary.context,
      body: `
        <section class="glance-detail-air">
          ${airQualityVisualHtml(summary)}
        </section>
        <div class="glance-detail-facts">${currentRows}</div>
        <section class="glance-detail-scale" aria-label="AQI scale">
          <div class="glance-detail-section-head">
            <span>AQI ranges</span>
            <strong>${escapeHtml(summary.band?.label || "Current")}</strong>
          </div>
          <ol>${scale}</ol>
        </section>
      `
    };
  }

  return {
    kind: "air",
    icon: glanceDetailIconHtml("air"),
    title: `Humidity ${humidity}%`,
    context: humidityContext(humidity),
    summary: metricTipHumidity(humidity),
    body: `
      <section class="glance-detail-hero is-air">
        <b>${escapeHtml(`${humidity}%`)}</b>
        <span>${escapeHtml(humidityContext(humidity))}</span>
      </section>
      <div class="glance-detail-facts">
        ${glanceDetailFactHtml("Humidity", `${humidity}%`, humidityContext(humidity))}
        ${glanceDetailFactHtml("Feels like", els.feelsLike?.textContent || "--", "Humidity can change comfort")}
      </div>
      ${glanceDetailNoteHtml("Why it matters", "Humidity becomes glance-worthy when it pushes comfort noticeably muggy or unusually dry.")}
    `
  };
}

function weatherSourceLabel(source) {
  const value = String(source || "").toLowerCase();
  if (value.includes("radar")) return "Observed radar";
  if (value.includes("minutely")) return "15-minute precip";
  if (value.includes("current")) return "Current conditions";
  if (value.includes("hourly")) return "Hourly forecast";
  if (value.includes("dry")) return "Dry forecast";
  return "Forecast";
}

function glanceDetailFactHtml(label, value, note = "") {
  return `
    <div class="glance-detail-fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<em>${escapeHtml(note)}</em>` : ""}
    </div>
  `;
}

function glanceDetailNoteHtml(label, text) {
  if (!text) return "";
  return `
    <section class="glance-detail-note">
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(text)}</p>
    </section>
  `;
}

function glanceDetailIconHtml(kind) {
  if (kind === "feels") {
    return `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="18" y="7" width="4" height="16" rx="2" fill="currentColor"/><circle cx="20" cy="28" r="7" fill="currentColor"/><path d="M25 11h5M25 17h4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  }
  if (kind === "wind") {
    return `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M7 14c7-4 11 4 17 0 3-2 5-2 9-1M7 22c6-4 10 4 16 0 3-2 5-2 8-1M20 30h11" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
  }
  if (kind === "air") {
    return `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 6s-9 11-9 19a9 9 0 0 0 18 0C29 17 20 6 20 6Z" fill="currentColor" opacity="0.22"/><path d="M13 25h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="24" r="11" stroke="currentColor" stroke-width="2.4" opacity="0.55"/></svg>`;
  }
  if (kind === "snow") return snowGlyph();
  return raindropGlyph();
}

function bindMetricTips(data, tempUnit, windUnit) {
  document.querySelectorAll(".today-glance .has-tip, .today-glance .has-detail").forEach((card) => {
    card.classList.remove("has-tip");
    card.classList.remove("has-detail");
    delete card.dataset.tip;
    delete card.dataset.tipHtml;
    delete card.dataset.glanceDetail;
    card.removeAttribute("tabindex");
    card.removeAttribute("role");
    card.removeAttribute("aria-label");
  });
  const current = data.current;
  const isFahrenheit = tempUnit === "F";
  const feelsVal = Math.round(current.apparent_temperature);
  const actualVal = Math.round(current.temperature_2m);
  const diff = feelsVal - actualVal;
  const rainVal = currentRainChance(data);
  const windVal = Math.round(current.wind_speed_10m);
  const humidityVal = current.relative_humidity_2m ?? 0;
  const air = airGlance(data, humidityVal);

  const tips = {
    feelsLike: { kind: "feels", tip: metricTipFeels(diff, feelsVal, tempUnit), aria: "Open feels-like detail" },
    rainChance: { kind: "rain", tip: metricTipRain(rainVal), aria: "Open rain detail" },
    wind: { kind: "wind", tip: metricTipWind(windVal, windUnit), aria: "Open wind detail" },
    humidity: { kind: "air", tip: air.tipHtml || metricTipHumidity(humidityVal), rich: Boolean(air.tipHtml), aria: air.tipHtml ? "Open air quality detail" : "Open air detail" }
  };

  Object.entries(tips).forEach(([id, detail]) => {
    if (!detail?.tip) return;
    const card = document.getElementById(id)?.closest(".glance-signal");
    if (!card) return;
    if (detail.rich) card.dataset.tipHtml = detail.tip;
    else card.dataset.tip = detail.tip;
    card.dataset.glanceDetail = detail.kind;
    card.classList.add("has-tip", "has-detail");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", detail.aria);
  });
}

function metricTipFeels(diff, feelsVal, tempUnit) {
  const unit = `°${tempUnit}`;
  if (diff <= -5) return `Feels ${Math.abs(diff)}${unit} colder than the air. Wind chill is a factor — add a layer.`;
  if (diff >= 5) return `Feels ${diff}${unit} warmer than the air. High humidity is trapping heat — stay hydrated.`;
  return `Feels close to the actual temperature. Humidity and wind are minimal factors right now.`;
}

function metricTipRain(pct) {
  if (pct >= 80) return `Rain is almost certain. Bring an umbrella and consider waterproof footwear.`;
  if (pct >= 60) return `More likely than not to rain. An umbrella is a good idea.`;
  if (pct >= 40) return `Roughly a coin-flip chance of rain. Worth packing an umbrella just in case.`;
  if (pct >= 20) return `Low chance of rain, but not zero. A light jacket may be useful.`;
  return `Dry conditions expected. No rain gear needed.`;
}

function metricTipWind(speed, unit) {
  const threshold = unit === "mph" ? [5, 15, 25, 40] : [8, 24, 40, 64];
  if (speed >= threshold[3]) return `Dangerously strong winds. Avoid open areas and secure loose objects.`;
  if (speed >= threshold[2]) return `Strong wind — umbrellas will struggle. Cycling or running into it will be tough.`;
  if (speed >= threshold[1]) return `Noticeable breeze. Keep an eye on light items and hats outdoors.`;
  if (speed >= threshold[0]) return `Light wind. Generally comfortable — might notice it on exposed walks.`;
  return `Calm air. Ideal for any outdoor activity.`;
}

function metricTipHumidity(pct) {
  if (pct >= 85) return `Very high humidity. Sweat won't evaporate well — the heat index will feel elevated. Stay cool.`;
  if (pct >= 70) return `Muggy conditions. You'll notice the air feels heavy, especially during activity.`;
  if (pct >= 50) return `Comfortable humidity range. No significant effect on how the temperature feels.`;
  if (pct >= 30) return `Low-moderate humidity. Pleasant conditions for most activities.`;
  return `Very dry air. Consider staying hydrated and using lip balm or moisturizer.`;
}

let activeTipCard = null;

function showMetricTip(card) {
  const tipHtml = card.dataset.tipHtml;
  const tip = card.dataset.tip;
  if (!tip && !tipHtml) return;
  els.metricTip.classList.toggle("metric-tip-rich", Boolean(tipHtml));
  if (tipHtml) els.metricTip.innerHTML = tipHtml;
  else els.metricTip.textContent = tip;
  els.metricTip.hidden = false;

  const rect = card.getBoundingClientRect();
  const tipRect = els.metricTip.getBoundingClientRect();
  // Tooltip is position:fixed so coordinates are viewport-relative — no scroll offset needed
  let top = rect.bottom + 10;
  // If the tip would be clipped at the bottom, flip it above the card instead
  if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 10;
  top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  els.metricTip.style.top = `${top}px`;
  els.metricTip.style.left = `${left}px`;
  activeTipCard = card;
}

function hideMetricTip() {
  els.metricTip.hidden = true;
  els.metricTip.classList.remove("metric-tip-rich");
  activeTipCard = null;
}

function initDaylightScrubListeners() {
  const arc = els.daylightArc;
  if (!arc) return;

  const inspect = (clientX) => {
    if (!daylightScrub.points.length) return;
    clearTimeout(daylightScrub.restoreTimer);
    updateDaylightScrub(nearestDaylightPointIndexFromClientX(clientX), { showGuide: true });
  };

  arc.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") inspect(event.clientX);
  });

  arc.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || daylightScrub.pointerDown) inspect(event.clientX);
  });

  arc.addEventListener("pointerdown", (event) => {
    daylightScrub.pointerDown = true;
    if (event.pointerType !== "mouse" && arc.setPointerCapture) {
      arc.setPointerCapture(event.pointerId);
    }
    inspect(event.clientX);
  });

  arc.addEventListener("pointerup", (event) => {
    daylightScrub.pointerDown = false;
    if (event.pointerType === "mouse" && arc.matches(":hover")) return;
    if (event.pointerType === "mouse") scheduleDaylightDefaultRestore();
  });

  arc.addEventListener("pointercancel", () => {
    daylightScrub.pointerDown = false;
    scheduleDaylightDefaultRestore();
  });

  arc.addEventListener("pointerleave", (event) => {
    if (!daylightScrub.pointerDown && event.pointerType === "mouse") scheduleDaylightDefaultRestore();
  });

  arc.addEventListener("keydown", (event) => {
    if (!daylightScrub.points.length) return;
    const max = daylightScrub.points.length - 1;
    let next = daylightScrub.activeIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(max, next + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, next - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    clearTimeout(daylightScrub.restoreTimer);
    updateDaylightScrub(next, { showGuide: true });
  });

  window.addEventListener("resize", () => {
    if (!daylightScrub.points.length) return;
    positionDaylightReadout(daylightScrub.points[daylightScrub.activeIndex], daylightScrub.chart);
  }, { passive: true });
}

function initMetricTipListeners() {
  const metricsEl = document.querySelector(".today-glance");
  if (!metricsEl) return;
  const openCardDetail = (card) => {
    const kind = card?.dataset?.glanceDetail;
    if (!kind) return false;
    openGlanceDetail(kind, card);
    return true;
  };
  const toggleCardTip = (card) => {
    if (!card) return;
    if (activeTipCard === card) hideMetricTip();
    else showMetricTip(card);
  };

  // Hover: mouse only
  metricsEl.addEventListener("mouseenter", (event) => {
    const card = event.target.closest(".has-tip");
    if (card && card !== activeTipCard) showMetricTip(card);
  }, true);

  metricsEl.addEventListener("mouseleave", (event) => {
    const card = event.target.closest(".has-tip");
    if (card) hideMetricTip();
  }, true);

  // Tap: open detail — but only on a genuine tap, never a scroll. We let
  // touchstart pass through (no preventDefault) so the page can still scroll
  // when a swipe begins on a metric card, and only act on touchend if the
  // finger didn't move.
  let tipTouch = null;
  const TIP_MOVE_TOLERANCE = 10;

  metricsEl.addEventListener("touchstart", (event) => {
    const card = event.target.closest(".has-detail, .has-tip");
    const t = event.touches[0];
    tipTouch = card ? { card, x: t.clientX, y: t.clientY, moved: false } : null;
  }, { passive: true });

  metricsEl.addEventListener("touchmove", (event) => {
    if (!tipTouch) return;
    const t = event.touches[0];
    if (Math.abs(t.clientX - tipTouch.x) > TIP_MOVE_TOLERANCE ||
        Math.abs(t.clientY - tipTouch.y) > TIP_MOVE_TOLERANCE) {
      tipTouch.moved = true; // it's a scroll, not a tap
    }
  }, { passive: true });

  metricsEl.addEventListener("touchend", (event) => {
    const touch = tipTouch;
    tipTouch = null;
    if (!touch || touch.moved) return; // scrolled — leave cards alone
    event.preventDefault(); // a real tap: block the synthetic click + mouse events
    if (!openCardDetail(touch.card)) toggleCardTip(touch.card);
  }, { passive: false });

  metricsEl.addEventListener("click", (event) => {
    const detailCard = event.target.closest(".has-detail");
    if (detailCard) {
      openCardDetail(detailCard);
      return;
    }
    const card = event.target.closest(".has-tip");
    if (!card) return;
    toggleCardTip(card);
  });

  metricsEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".has-detail, .has-tip");
    if (!card) return;
    event.preventDefault();
    if (!openCardDetail(card)) toggleCardTip(card);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".today-glance") && !event.target.closest("#metricTip")) {
      hideMetricTip();
    }
  });

  // Dismiss tooltip immediately when the page scrolls
  window.addEventListener("scroll", hideMetricTip, { passive: true });
}

function setStatus(message, isError = false) {
  const text = message || "";
  const showLoading = Boolean(text) && !isError && isTransientStatus(text);
  setLoadingStatus(showLoading ? text : "");

  const showCard = Boolean(text) && !showLoading;
  els.status.hidden = !showCard;
  els.status.textContent = showCard ? text : "";
  els.status.classList.toggle("error", isError);
  els.shell.classList.toggle("has-status", showCard);
}

function isTransientStatus(message) {
  return /^(Loading|Updating|Searching|Waiting|Naming)\b/.test(message);
}

function setLoadingStatus(message) {
  const textValue = String(message || "");
  const welcome = welcomeIsActive();
  els.loadingStatuses.forEach((status) => {
    const isWelcomeStatus = status.classList.contains("welcome-loading");
    const isLaunchStatus = status.classList.contains("launch-loading");
    const visible = Boolean(textValue) &&
      ((isWelcomeStatus && welcome) || (isLaunchStatus && !welcome) || (!isWelcomeStatus && !isLaunchStatus));
    const text = status.querySelector("[data-loading-message]");
    if (text) text.textContent = visible ? textValue : "";
    status.hidden = !visible;
  });
}

function normalizePlace(place) {
  const name = canonicalPlaceName(place);
  return {
    id: place.id || `${slug(name)}-${Number(place.latitude).toFixed(3)}-${Number(place.longitude).toFixed(3)}`,
    name,
    admin1: place.admin1 || "",
    country: place.country || "",
    countryCode: placeCountryCode(place),
    latitude: Number(place.latitude),
    longitude: Number(place.longitude)
  };
}

function canonicalPlaceName(place) {
  const rawName = String(place?.name || "Selected Place").trim() || "Selected Place";
  const qualifiers = new Set(
    [place?.admin1, place?.country]
      .map((value) => normalizeQualifierKey(value))
      .filter(Boolean)
  );
  const parts = rawName.split(",").map((part) => part.trim()).filter(Boolean);

  // Repair the exact legacy failure safely: collapse repeated trailing pieces,
  // then remove only suffixes that match known structured qualifiers.
  while (
    parts.length > 1 &&
    normalizeQualifierKey(parts[parts.length - 1]) === normalizeQualifierKey(parts[parts.length - 2])
  ) {
    parts.pop();
  }
  while (parts.length > 1 && qualifiers.has(normalizeQualifierKey(parts[parts.length - 1]))) {
    parts.pop();
  }

  return parts.join(", ") || "Selected Place";
}

function placeLabel(place) {
  const name = canonicalPlaceName(place);
  const countryCode = placeCountryCode(place);
  if (place.admin1 && place.country && countryCode && countryCode !== "US") {
    return joinUniquePlaceParts([name, place.admin1, place.country]);
  }
  return joinUniquePlaceParts([name, place.admin1 || place.country]);
}

function joinUniquePlaceParts(parts) {
  const seen = new Set();
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part) => {
      const key = normalizeQualifierKey(part);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function formatPlaceResultMeta(place) {
  const admin = place.admin1 || "";
  const country = place.country || "";
  if (admin && country && normalizeQualifierKey(admin) !== normalizeQualifierKey(country)) {
    return `${admin}, ${country}`;
  }
  return admin || country || "";
}

function placeCountryCode(place) {
  return String(place?.countryCode || place?.country_code || "").toUpperCase();
}

function degree(unit) {
  return `°${unit}`;
}

function clockDateFromParts(hour, minute = 0) {
  const rawHour = Number(hour);
  const rawMinute = Number(minute);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) return null;
  const totalMinutes = ((Math.floor(rawHour) * 60 + Math.floor(rawMinute)) % 1440 + 1440) % 1440;
  const normalizedHour = Math.floor(totalMinutes / 60);
  const normalizedMinute = totalMinutes % 60;
  return new Date(Date.UTC(2000, 0, 1, normalizedHour, normalizedMinute));
}

function compactDayPeriod(value) {
  const text = String(value || "").trim();
  if (/^a/i.test(text)) return "a";
  if (/^p/i.test(text)) return "p";
  return text.replace(/\./g, "").slice(0, 1).toLowerCase();
}

function compactClockParts(parts) {
  return parts.map((part) => {
    if (part.type === "dayPeriod") return compactDayPeriod(part.value);
    if (part.type === "literal") return part.value.replace(/\s+/g, "");
    return part.value;
  }).join("").replace(/\s+/g, "");
}

function userClockPreference() {
  if (state.timeFormat === "12") return { hourCycle: "h12" };
  if (state.timeFormat === "24") return { hourCycle: "h23" };
  try {
    const options = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    const cycle = options.hourCycle;
    if (["h11", "h12", "h23", "h24"].includes(cycle)) return { hourCycle: cycle };
    if (typeof options.hour12 === "boolean") return { hour12: options.hour12 };
  } catch (_) {
    return {};
  }
  return {};
}

function prefersTwentyFourHourClock() {
  const preference = userClockPreference();
  return preference.hourCycle === "h23" || preference.hourCycle === "h24" || preference.hour12 === false;
}

function timeFormatOptions(options = {}) {
  const preference = userClockPreference();
  return { ...options, ...preference };
}

function formatClock(hour, minute = 0, compact = false, showMinutes = true) {
  const date = clockDateFromParts(hour, minute);
  if (!date) return "--";
  const formatter = new Intl.DateTimeFormat(undefined, timeFormatOptions({
    hour: "numeric",
    ...(showMinutes ? { minute: "2-digit" } : {}),
    timeZone: "UTC"
  }));
  return compact ? compactClockParts(formatter.formatToParts(date)) : formatter.format(date);
}

function formatTime(value) {
  const parts = localDateTimeParts(value);
  if (parts) return formatClock(parts.hour, parts.minute);
  return new Intl.DateTimeFormat(undefined, timeFormatOptions({ hour: "numeric", minute: "2-digit" })).format(new Date(value));
}

function formatHour(value) {
  const parts = localDateTimeParts(value);
  if (parts) return formatClock(parts.hour, 0, false, false);
  return new Intl.DateTimeFormat(undefined, timeFormatOptions({ hour: "numeric" })).format(new Date(value));
}

function formatDay(value, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

// Day relative to today: 0 = today, 1 = tomorrow, etc. Used to mark the day
// rollover inside the rolling next-24h views.
function daysFromToday(value) {
  return daysFromForecastToday(value);
}

function dayDividerDateLabel(value) {
  const day = datePart(value);
  const d = day ? new Date(`${day}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(d);
}

// Full divider label for the hourly list, e.g. "Tomorrow · Tue, Jun 23".
function dayDividerLabel(value) {
  const diff = daysFromToday(value);
  const label = dayDividerDateLabel(value);
  if (diff === 0) return `Today · ${label}`;
  if (diff === 1) return `Tomorrow · ${label}`;
  return label;
}

// Compact label for the graph's midnight line, e.g. "Tomorrow" or "Wed".
function dayShortLabel(value) {
  const diff = daysFromToday(value);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(value));
}

function timelineLocalParts(ms, data = state.forecast) {
  const local = new Date(ms + forecastOffsetMs(data));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes()
  };
}

function timelineDayNumber(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * 60 * 60 * 1000));
}

function timelineWeekday(parts) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function formatTimelineTime(ms, options = {}) {
  const parts = timelineLocalParts(ms);
  const nowParts = timelineLocalParts(Date.now());
  const dayDiff = timelineDayNumber(parts) - timelineDayNumber(nowParts);
  const showMinutes = options.showMinutes ?? parts.minute !== 0;
  let dayLabel = "";

  if (options.dayStyle !== "none") {
    if (dayDiff === 1) dayLabel = "Tomorrow";
    else if (dayDiff === -1) dayLabel = "Yesterday";
    else if (dayDiff !== 0) dayLabel = timelineWeekday(parts);
  }

  return `${dayLabel ? `${dayLabel} ` : ""}${formatClock(parts.hour, parts.minute, false, showMinutes)}`;
}

function formatTimelineRelative(ms) {
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  if (abs < 45 * 1000) return "right now";
  const value = formatRelativeDuration(abs);
  return delta < 0 ? `${value} ago` : `in ${value}`;
}

function formatRelativeDuration(ms) {
  const minutes = Math.max(1, Math.round(ms / (60 * 1000)));
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 36) return `${hours} hr`;
  const days = Math.max(1, Math.round(hours / 24));
  return `${days} day${days === 1 ? "" : "s"}`;
}

function radarTimelineLabel(ms) {
  return `Radar · ${formatTimelineTime(ms, { showMinutes: true })}`;
}

function forecastTimelineLabel(ms) {
  return `Forecast · ${formatTimelineTime(ms)}`;
}

function formatAmount(value) {
  const number = Number(value || 0);
  if (number === 0) return "0";
  return number.toFixed(number >= 1 ? 1 : 2).replace(/\.0$/, "");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

/* ---------- Severe weather alerts (NWS, US-only) ---------- */

const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
const ALERT_TONE_RANK = { warning: 4, watch: 3, advisory: 2, notice: 1 };
let activeAlerts = [];
// Loading/unknown alerts are different from a confirmed empty alert list.
let activeAlertsReady = false;
let alertSheetReturnFocus = null;
let alertSheetUnderlyingDayDetail = null;
let alertSheetUnderlyingAriaHidden = null;
let alertSheetUnderlyingWasInert = false;

async function fetchAlerts(place) {
  const cacheKey = `alerts:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
  if (cached && Date.now() - cached.savedAt < 5 * 60 * 1000) return cached.data;

  const url = `https://api.weather.gov/alerts/active?point=${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
  const json = await fetchJsonWithTimeout(url, ALERTS_FETCH_TIMEOUT_MS, null, {
    headers: { Accept: "application/geo+json" }
  });
  const alerts = (json.features || [])
    .map((f) => f.properties)
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data: alerts }));
  return alerts;
}

function alertSeverityClass(severity) {
  if (severity === "Extreme" || severity === "Severe") return "alert-severe";
  if (severity === "Moderate") return "alert-moderate";
  return "alert-minor";
}

function alertSeverityLabel(severity) {
  if (severity === "Extreme" || severity === "Severe") return "Urgent alert";
  if (severity === "Moderate") return "Weather alert";
  if (severity === "Minor") return "Advisory";
  return "Weather notice";
}

function alertTone(alert) {
  const event = (alert?.event || "").toLowerCase();
  if (event.includes("warning")) return "warning";
  if (event.includes("watch")) return "watch";
  if (event.includes("advisory")) return "advisory";
  if (alert?.severity === "Extreme" || alert?.severity === "Severe") return "warning";
  if (alert?.severity === "Moderate" || alert?.severity === "Minor") return "advisory";
  return "notice";
}

function alertToneLabel(tone) {
  if (tone === "warning") return "Warning";
  if (tone === "watch") return "Watch";
  if (tone === "advisory") return "Advisory";
  return "Notice";
}

function alertPriority(alert) {
  return (ALERT_TONE_RANK[alertTone(alert)] || 0) * 100 + (SEVERITY_RANK[alert?.severity] || 0) * 10;
}

function alertMotionClass(alert) {
  const event = (alert?.event || "").toLowerCase();
  return alert?.severity === "Extreme" || event.includes("warning") ? "alert-pulse" : "";
}

function alertCountLabel(count) {
  return count === 1 ? "1 active alert" : `${count} active alerts`;
}

function alertIdentityKey(alert) {
  if (!alert) return "";
  const id = String(alert.id || "").trim();
  if (id) return `id:${id}`;
  return [alert.event, alert.onset || alert.effective, alert.ends || alert.expires]
    .map((value) => String(value || "").trim())
    .join("|");
}

function alertsForAlertSheet(selectedAlert = null) {
  const hasSelection = selectedAlert !== null && selectedAlert !== undefined && selectedAlert !== "";
  const selectedKey = typeof selectedAlert === "string"
    ? selectedAlert
    : alertIdentityKey(selectedAlert);
  if (!hasSelection) return [...activeAlerts];
  if (!selectedKey) return [];
  const selectedIndex = activeAlerts.findIndex((alert) => alertIdentityKey(alert) === selectedKey);
  if (selectedIndex < 0) return [];
  return [
    activeAlerts[selectedIndex],
    ...activeAlerts.slice(0, selectedIndex),
    ...activeAlerts.slice(selectedIndex + 1)
  ];
}

function setAlertsLoading() {
  activeAlerts = [];
  activeAlertsReady = false;
  const bar = document.getElementById("alertBar");
  if (bar) bar.hidden = true;
  window.nearcastSyncRadarView?.();
}

function syncLaunchAfterAlertsReady() {
  if (!state.forecast || !state.activePlace) return;
  refreshPlanAwareLaunchSurfaces(state.forecast, state.activePlace);
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const truth = state.weatherTruth || weatherTruth(state.forecast);
  saveContinuitySnapshot(state.forecast, state.activePlace, tempUnit, windUnit, truth);
}

function renderAlerts(alerts) {
  activeAlerts = alerts || [];
  activeAlertsReady = true;
  window.nearcastSyncRadarView?.();
  const bar = document.getElementById("alertBar");
  if (!activeAlerts.length) {
    bar.hidden = true;
    syncLaunchAfterAlertsReady();
    return;
  }
  const top = activeAlerts[0];
  bar.className = `alert-bar launch-alert ${alertSeverityClass(top.severity)}`;
  document.getElementById("alertBarSeverity").textContent = alertSeverityLabel(top.severity);
  document.getElementById("alertBarEvent").textContent = top.event;
  document.getElementById("alertBarTiming").textContent = top.ends || top.expires
    ? `Until ${formatAlertTime(top.ends || top.expires)}` : "";
  document.getElementById("alertBarMore").textContent =
    activeAlerts.length > 1 ? `+${activeAlerts.length - 1} more` : "";
  bar.setAttribute("aria-label", `${top.event}${top.ends || top.expires ? ` until ${formatAlertTime(top.ends || top.expires)}` : ""}. ${alertCountLabel(activeAlerts.length)}. Open alert details.`);
  bar.hidden = false;
  syncLaunchAfterAlertsReady();
}

function formatAlertTime(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, timeFormatOptions(sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { weekday: "short", hour: "numeric", minute: "2-digit" })).format(d);
}

function alertWindow(a) {
  const start = a.onset || a.effective;
  const end = a.ends || a.expires;
  const parts = [];
  if (start) parts.push(`From ${formatAlertTime(start)}`);
  if (end) parts.push(`until ${formatAlertTime(end)}`);
  return parts.join(" ");
}

function normalizeAlertBlock(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanAlertText(value) {
  return normalizeAlertBlock(value).replace(/\s+/g, " ").trim();
}

function truncateText(value, max = 170) {
  const text = cleanAlertText(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1).lastIndexOf(" ");
  return `${text.slice(0, cut > max * 0.55 ? cut : max).trim()}...`;
}

function firstAlertSentence(value, max = 170) {
  const text = cleanAlertText(value);
  if (!text) return "";
  const sentence = text.match(/^(.+?[.!?])(?:\s|$)/)?.[1];
  return truncateText(sentence && sentence.length <= max + 35 ? sentence : text, max);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alertSectionText(alert, names, max = 170) {
  const block = normalizeAlertBlock([alert?.description, alert?.instruction].filter(Boolean).join("\n"));
  if (!block) return "";
  const labels = names.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:\\*\\s*)?(?:${labels})\\s*\\.\\.\\.\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\*\\s*)?[A-Z][A-Z /'-]{2,}\\s*\\.\\.\\.|$)`,
    "i"
  );
  return truncateText(block.match(pattern)?.[1] || "", max);
}

function alertKind(alert) {
  const text = `${alert?.event || ""} ${alert?.headline || ""} ${alert?.description || ""}`.toLowerCase();
  if (text.includes("tornado")) return "tornado";
  if (text.includes("flash flood")) return "flash-flood";
  if (text.includes("flood")) return "flood";
  if (text.includes("thunderstorm") || text.includes("hail") || text.includes("lightning")) return "storm";
  if (text.includes("heat")) return "heat";
  if (text.includes("winter") || text.includes("snow") || text.includes("ice") || text.includes("blizzard")) return "winter";
  if (text.includes("wind")) return "wind";
  if (text.includes("fog")) return "fog";
  if (text.includes("fire") || text.includes("red flag")) return "fire";
  if (text.includes("coastal") || text.includes("surf") || text.includes("rip current")) return "coastal";
  return "weather";
}

function alertMeaningLine(alert, tone, kind) {
  const what = alertSectionText(alert, ["WHAT"]);
  if (what) return what;
  if (kind === "tornado") {
    return tone === "watch"
      ? "Conditions could support tornadoes and severe storms."
      : "A dangerous tornado threat is active or could develop quickly.";
  }
  if (kind === "flash-flood") return "Flash flooding can happen quickly, especially near low spots and drainage areas.";
  if (kind === "flood") return tone === "watch"
    ? "Flooding is possible if heavier rain develops or continues."
    : "Flooding is happening or expected in parts of the alert area.";
  if (kind === "storm") return tone === "watch"
    ? "Conditions could support severe thunderstorms."
    : "Severe storms may bring damaging wind, hail, lightning, or heavy rain.";
  if (kind === "heat") return "Heat stress risk is elevated, especially during outdoor activity.";
  if (kind === "winter") return "Snow, ice, or blowing snow may make travel slow or hazardous.";
  if (kind === "wind") return "Strong wind may affect travel, loose items, trees, or power lines.";
  if (kind === "fog") return "Visibility may drop quickly and make travel harder.";
  if (kind === "fire") return "Fires could start or spread quickly.";
  if (kind === "coastal") return "Coastal water or beach conditions may become hazardous.";
  if (tone === "warning") return "Dangerous weather is happening or expected soon.";
  if (tone === "watch") return "Conditions could support hazardous weather.";
  if (tone === "advisory") return "Disruptive weather is expected.";
  return "Weather conditions are worth monitoring.";
}

function alertTimingLine(alert) {
  const when = alertSectionText(alert, ["WHEN"], 150);
  if (when) return when;
  return alertWindow(alert) || "Timing is listed in the official alert details.";
}

function alertImpactLine(alert, kind) {
  const impacts = alertSectionText(alert, ["IMPACTS", "IMPACT"]);
  if (impacts) return impacts;
  if (kind === "tornado") return "A tornado threat can become life-threatening quickly.";
  if (kind === "flash-flood" || kind === "flood") return "Low spots, poor-drainage roads, creeks, or streams may become risky.";
  if (kind === "storm") return "Outdoor plans, trees, power lines, and travel may be affected.";
  if (kind === "heat") return "Kids, older adults, pets, and people outside are more vulnerable.";
  if (kind === "winter") return "Roads and sidewalks may become slick or difficult.";
  if (kind === "wind") return "Loose outdoor items and high-profile travel may be affected.";
  if (kind === "fog") return "Travel may require extra time and slower speeds.";
  if (kind === "fire") return "Outdoor burning or sparks may be dangerous.";
  if (kind === "coastal") return "Surf, currents, or water levels may be unsafe.";
  return "Plans may need extra caution or a backup option.";
}

function alertActionLine(alert, tone) {
  const instruction = firstAlertSentence(alert?.instruction, 170);
  if (instruction) return instruction;
  if (tone === "warning") return "Take protective action now and follow the official guidance below.";
  if (tone === "watch") return "Review backup plans and keep checking for warnings.";
  if (tone === "advisory") return "Use extra caution and adjust travel or outdoor plans.";
  return "Stay weather-aware and check the official details below.";
}

function alertInsightHeadline(tone) {
  if (tone === "warning") return "Take this seriously now";
  if (tone === "watch") return "Use this as planning time";
  if (tone === "advisory") return "Expect some disruption";
  return "Keep an eye on conditions";
}

function alertInsightChips(alert, tone) {
  return [
    alertToneLabel(tone),
    alert?.severity && alert.severity !== "Unknown" ? `${alert.severity} severity` : "",
    alert?.urgency && alert.urgency !== "Unknown" ? alert.urgency : "",
    alert?.certainty && alert.certainty !== "Unknown" ? `${alert.certainty} confidence` : ""
  ].filter(Boolean).filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 4);
}

function renderAlertInsight(alert) {
  if (!alert) return "";
  const tone = alertTone(alert);
  const kind = alertKind(alert);
  const facts = [
    ["Means", alertMeaningLine(alert, tone, kind)],
    ["Timing", alertTimingLine(alert)],
    ["Impact", alertImpactLine(alert, kind)],
    ["Action", alertActionLine(alert, tone)]
  ];
  const chips = alertInsightChips(alert, tone).map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  return `
    <section class="alert-insight-panel" aria-label="Nearcast alert read">
      <div class="alert-insight-head">
        <span>Nearcast read</span>
        <strong>${escapeHtml(alertInsightHeadline(tone))}</strong>
      </div>
      <div class="alert-insight-grid">
        ${facts.map(([label, value]) => `
          <div class="alert-insight-fact">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `).join("")}
      </div>
      ${chips ? `<div class="alert-insight-chips">${chips}</div>` : ""}
    </section>
  `;
}

function alertStartMs(alert) {
  return parseForecastTimestamp(alert?.onset || alert?.effective);
}

function alertEndMs(alert) {
  return parseForecastTimestamp(alert?.ends || alert?.expires);
}

function alertOverlapsRange(alert, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  const alertStart = alertStartMs(alert);
  const alertEnd = alertEndMs(alert);
  const startsBeforeEnd = alertStart === null || alertStart < endMs;
  const endsAfterStart = alertEnd === null || alertEnd > startMs;
  return startsBeforeEnd && endsAfterStart;
}

function topAlertForRange(startMs, endMs, alertsSource = activeAlerts) {
  return (alertsSource || [])
    .filter((alert) => alertOverlapsRange(alert, startMs, endMs))
    .sort((a, b) => alertPriority(b) - alertPriority(a))[0] || null;
}

function compactAlertAreas(areaDesc, max = 5) {
  if (!areaDesc) return "";
  const areas = areaDesc.split(";").map((area) => area.trim()).filter(Boolean);
  if (!areas.length) return areaDesc;
  if (areas.length <= max) return areas.join("; ");
  return `${areas.slice(0, max).join("; ")} +${areas.length - max} more`;
}

function openAlertSheet(selectedAlert = null, options = {}) {
  const sheetAlerts = alertsForAlertSheet(selectedAlert);
  if (!sheetAlerts.length) return false;
  const top = sheetAlerts[0];
  const sheet = document.getElementById("alertSheet");
  const explicitReturnFocus = options.returnFocus;
  alertSheetReturnFocus = explicitReturnFocus instanceof HTMLElement
    ? explicitReturnFocus
    : (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null);
  const dayDetail = document.getElementById("dayDetail");
  alertSheetUnderlyingDayDetail = dayDetail && !dayDetail.hidden ? dayDetail : null;
  alertSheetUnderlyingAriaHidden = alertSheetUnderlyingDayDetail?.getAttribute("aria-hidden") ?? null;
  alertSheetUnderlyingWasInert = Boolean(alertSheetUnderlyingDayDetail?.inert);
  if (alertSheetUnderlyingDayDetail) {
    alertSheetUnderlyingDayDetail.inert = true;
    alertSheetUnderlyingDayDetail.setAttribute("aria-hidden", "true");
  }
  sheet.className = `day-sheet alert-sheet ${alertSeverityClass(top.severity)} ${alertMotionClass(top)}`.trim();
  document.getElementById("alertSheetKicker").textContent = alertSeverityLabel(top.severity);
  document.getElementById("alertSheetTitle").textContent = top.event;
  document.getElementById("alertSheetSummary").textContent = [
    alertWindow(top),
    sheetAlerts.length > 1 ? alertCountLabel(sheetAlerts.length) : ""
  ].filter(Boolean).join(" · ");
  const insight = document.getElementById("alertInsight");
  if (insight) insight.innerHTML = renderAlertInsight(top);
  document.getElementById("alertList").innerHTML = sheetAlerts.map((a, index) => `
    ${index === 1 ? `<h3 class="alert-list-section">Other active alerts</h3>` : ""}
    <article class="alert-item ${alertSeverityClass(a.severity)}">
      ${index > 0 ? `
        <div class="alert-item-head">
          <div>
            <span class="alert-item-event">${escapeHtml(a.event)}</span>
            <p class="alert-item-when">${escapeHtml(alertWindow(a))}</p>
          </div>
          <span class="alert-item-sev">${escapeHtml(alertSeverityLabel(a.severity))}</span>
        </div>
      ` : ""}
      ${a.instruction ? `<section class="alert-item-instruction"><strong>What to do</strong><p>${escapeHtml(a.instruction)}</p></section>` : ""}
      ${a.areaDesc ? `
        <details class="alert-item-area">
          <summary>
            <span>Affected areas</span>
            <strong>${escapeHtml(compactAlertAreas(a.areaDesc))}</strong>
          </summary>
          <p>${escapeHtml(a.areaDesc)}</p>
        </details>
      ` : ""}
      ${a.description ? `<details class="alert-item-details"><summary>Full NWS details</summary><p>${escapeHtml(a.description)}</p></details>` : ""}
      ${a.senderName ? `<p class="alert-item-sender">Issued by ${escapeHtml(a.senderName)}</p>` : ""}
    </article>
  `).join("");

  const backdrop = document.getElementById("alertBackdrop");
  backdrop.hidden = false;
  sheet.hidden = false;
  document.getElementById("sheetNowJump")?.setAttribute("hidden", "");
  showSheet(backdrop, sheet, {
    onPullDismiss: closeAlertSheet,
    resetScroll: true
  });
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => document.getElementById("alertSheetClose")?.focus({ preventScroll: true }));
  return true;
}

function canRestoreAlertSheetFocus(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function closeAlertSheet() {
  const backdrop = document.getElementById("alertBackdrop");
  const sheet = document.getElementById("alertSheet");
  if (!sheet || !backdrop || sheet.hidden) return;
  backdrop.classList.remove("show");
  sheet.classList.remove("show");
  const keepLocked = Boolean(document.querySelector(
    "#dayDetail:not([hidden]), #memoryDetailSheet:not([hidden]), #memorySheet:not([hidden]), #aiSheet:not([hidden]), #placeSheet:not([hidden])"
  )) || mapState.immersive;
  document.body.style.overflow = keepLocked ? "hidden" : "";
  setTimeout(() => {
    backdrop.hidden = true;
    sheet.hidden = true;
    const underlyingDayDetail = alertSheetUnderlyingDayDetail;
    if (underlyingDayDetail?.isConnected) {
      underlyingDayDetail.inert = alertSheetUnderlyingWasInert;
      if (alertSheetUnderlyingAriaHidden === null) underlyingDayDetail.removeAttribute("aria-hidden");
      else underlyingDayDetail.setAttribute("aria-hidden", alertSheetUnderlyingAriaHidden);
    }
    alertSheetUnderlyingDayDetail = null;
    alertSheetUnderlyingAriaHidden = null;
    alertSheetUnderlyingWasInert = false;
    if (typeof updateSheetNowJump === "function") updateSheetNowJump();
    const returnFocus = alertSheetReturnFocus;
    alertSheetReturnFocus = null;
    const returnSheet = returnFocus?.closest?.(".day-sheet");
    const canRestoreFocus = canRestoreAlertSheetFocus(returnFocus) && (
      !returnSheet || (!returnSheet.hidden && returnSheet.classList.contains("show"))
    );
    const underlyingClose = underlyingDayDetail?.querySelector?.("#dayDetailClose");
    const focusTarget = canRestoreFocus
      ? returnFocus
      : (canRestoreAlertSheetFocus(underlyingClose) ? underlyingClose : null);
    focusTarget?.focus({ preventScroll: true });
  }, 260);
}
