/* Nearcast radar/map timeline and immersive map interactions. */

const MAP_PAN_MOVE_EPSILON_PX = 0.5;
const MAP_PAN_REBASE_PX = 96;
const IMMERSIVE_MAP_PAN_REBASE_PX = 180;
const MAPLIBRE_BASE_LAYER_ID = "nearcast-base";
const MAPLIBRE_LABEL_LAYER_ID = "nearcast-labels";
const MAPLIBRE_LOAD_TIMEOUT_MS = 3600;
const MAPLIBRE_IMMERSIVE_LOAD_TIMEOUT_MS = 4800;
const MAPLIBRE_RADAR_SETTLE_MS = 90;
const MAPLIBRE_WEATHER_PREFIX = "nearcast-weather";
const MAPLIBRE_RADAR_CHUNK_LAYER_ID = "nearcast-radar-chunks";
const MAPLIBRE_RADAR_CHUNK_DEFAULT_INDEX_URL = "radar/chunks/synthetic-smoke/index.json";
const MAPLIBRE_RADAR_CHUNK_INDEX_URLS = {
  synthetic: MAPLIBRE_RADAR_CHUNK_DEFAULT_INDEX_URL,
  smoke: MAPLIBRE_RADAR_CHUNK_DEFAULT_INDEX_URL,
  test: MAPLIBRE_RADAR_CHUNK_DEFAULT_INDEX_URL,
  nebraska: "radar/chunks/nebraska-20260701-055640-z12/index.json",
  "nebraska-live": "radar/chunks/nebraska-20260701-055640-z12/index.json",
  "real-nebraska": "radar/chunks/nebraska-20260701-055640-z12/index.json",
  "nebraska-z12": "radar/chunks/nebraska-20260701-055640-z12/index.json",
  "nebraska-z10": "radar/chunks/nebraska-20260701-055640/index.json"
};
const MAPLIBRE_RADAR_CHUNK_FETCH_LIMIT = 96;
const MAPLIBRE_RADAR_CHUNK_LOADED_LIMIT = 384;
const MAPLIBRE_WEATHER_PRELOAD_OPACITY = 0.001;
const MAPLIBRE_WEATHER_LAYER_CACHE_LIMIT = 8;
const MAPLIBRE_GENERATED_RADAR_PROTOCOL = "nearcast-radar";
const MAPLIBRE_GENERATED_RADAR_DATA_PROTOCOL = "nearcast-radar-data";
const MAPLIBRE_ENCODED_RADAR_TILE_CACHE_LIMIT = 160;
const MAPLIBRE_ENCODED_RADAR_EMPTY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=";
const GENERATED_RADAR_TILE_PREFLIGHT_FRAME_LIMIT = 3;
const GENERATED_RADAR_TILE_PREFLIGHT_MAX_URLS = 48;
const GENERATED_RADAR_TILE_PREFLIGHT_TIMEOUT_MS = 1600;
const GENERATED_RADAR_TILE_PREFLIGHT_CACHE_MS = 2 * 60 * 1000;
const GENERATED_RADAR_REFRESH_DEBOUNCE_MS = 300;
const GENERATED_RADAR_POLL_INITIAL_MS = 7000;
const GENERATED_RADAR_POLL_INTERVAL_MS = 12000;
const GENERATED_RADAR_POLL_MAX_MS = 2 * 60 * 1000;
const GENERATED_RADAR_READY_STATUS_MS = 1800;
const GENERATED_RADAR_SELECTION_HINT_MS = 60 * 1000;
const GENERATED_RADAR_VIEWPORT_COVERAGE_MIN = 0.999;
const GENERATED_RADAR_MIN_ZOOM_GRACE = 0.001;
const GENERATED_RADAR_MIN_VIEWPORT_ZOOM = 7.5;
const GENERATED_RADAR_CENTER_FOCUS_MIN_ZOOM = 9;
const GENERATED_RADAR_FRAME_SUBSTRATE_MAX_CLIENT_ZOOM = MAP_MAX_ZOOM;
const GENERATED_RADAR_FALLBACK_RELOAD_MS = 120;
const GENERATED_RADAR_GENERATION_MIN_ZOOM = GENERATED_RADAR_MIN_VIEWPORT_ZOOM;
const RADAR_CAPABILITY_FETCH_TIMEOUT_MS = 3500;
const RADAR_FALLBACK_METADATA_FETCH_TIMEOUT_MS = 3500;
const RADAR_CAPABILITY_LOG_LIMIT = 20;
const RADAR_SOURCE_DECISION_LOG_LIMIT = 50;
const GENERATED_RADAR_DIAGNOSTIC_CANDIDATE_LIMIT = 6;
const mapLibreRecords = new Map();
let mapLibreOverlayRaf = 0;
let mapLibreOverlayForceRadar = false;
let mapLibreGeneratedRadarProtocolRegistered = false;
let mapLibreGeneratedRadarDataProtocolRegistered = false;
let xweatherMapsglAssetPromise = null;
let xweatherMapsglCssPromise = null;
let generatedRadarFallbackReloadTimer = 0;
const mapLibreEncodedRadarTileCache = new Map();
const generatedRadarTilePreflightCache = new Map();
const mapLibreInteraction = {
  active: false,
  settleTimer: 0,
  resumePlayback: false,
  needsRadarRender: false
};

const MAPLIBRE_RADAR_RAMP = [
  { value: 5, color: [68, 170, 210, 172] },
  { value: 10, color: [66, 174, 214, 202] },
  { value: 12, color: [62, 204, 105, 224] },
  { value: 20, color: [24, 164, 78, 242] },
  { value: 28, color: [12, 110, 55, 250] },
  { value: 30, color: [10, 104, 52, 252] },
  { value: 31, color: [238, 188, 42, 255] },
  { value: 36, color: [244, 181, 38, 255] },
  { value: 43, color: [230, 111, 36, 255] },
  { value: 54, color: [214, 55, 43, 255] },
  { value: 65, color: [154, 64, 188, 255] },
  { value: 75, color: [238, 220, 244, 255] }
];

const MAPLIBRE_RADAR_STEPPED_RAMP = [
  { value: 10, color: [66, 174, 214, 202] },
  { value: 18, color: [62, 204, 105, 226] },
  { value: 28, color: [20, 154, 74, 246] },
  { value: 36, color: [238, 188, 42, 255] },
  { value: 45, color: [230, 111, 36, 255] },
  { value: 56, color: [214, 55, 43, 255] },
  { value: 68, color: [154, 64, 188, 255] },
  { value: 80, color: [238, 220, 244, 255] }
];

const MAPLIBRE_RADAR_RESOLVED_RAMP = [
  { value: 8, color: [66, 174, 214, 204] },
  { value: 16, color: [62, 204, 105, 228] },
  { value: 28, color: [20, 154, 74, 248] },
  { value: 36, color: [238, 188, 42, 255] },
  { value: 45, color: [230, 111, 36, 255] },
  { value: 56, color: [214, 55, 43, 255] },
  { value: 68, color: [154, 64, 188, 255] },
  { value: 80, color: [238, 220, 244, 255] }
];

function mapDiagnosticMode() {
  return sanitizeMapDiagnosticMode?.(state.mapDiagnosticMode) || "full";
}

function mapDiagnosticIsActive() {
  return mapDiagnosticMode() !== "full";
}

function mapDiagnosticAllowsRadar() {
  return !["blank", "quiet", "nosky", "nomotion", "noblur", "base", "base-no-labels", "markers"].includes(mapDiagnosticMode());
}

function mapDiagnosticAllowsMarkers() {
  return ["full", "markers", "current-markers"].includes(mapDiagnosticMode());
}

function mapDiagnosticUsesStrictLayerSet() {
  return mapDiagnosticIsActive();
}

function mapDiagnosticModeLabel() {
  return MAP_DIAGNOSTIC_MODES?.[mapDiagnosticMode()]?.label || "Full stack";
}

function mapDiagnosticBaseVisibility() {
  const mode = mapDiagnosticMode();
  const blankModes = ["blank", "quiet", "nosky", "nomotion", "noblur"];
  return {
    base: !blankModes.includes(mode),
    labels: !blankModes.includes(mode) && mode !== "base-no-labels"
  };
}

window.nearcastMapDiagnostics = function nearcastMapDiagnostics() {
  return {
    mode: mapDiagnosticMode(),
    renderer: state.mapRenderer,
    immersive: Boolean(mapState.immersive),
    radar: radarDiagnosticsSnapshot(),
    records: [...mapLibreRecords.values()].map(mapLibreDiagnosticStats)
  };
};

window.nearcastRadarDiagnostics = radarDiagnosticsSnapshot;
window.nearcastRadarChunkDiagnostics = radarChunkDiagnosticsSnapshot;
window.nearcastXweatherDiagnostics = xweatherStormDiagnosticsSnapshot;
window.nearcastRadarCapability = (options = {}) => resolveRadarViewportCapability(options);
window.nearcastRequestRadarGeneration = (options = {}) => requestRadarViewportGeneration(options);
window.nearcastUseRadarPreviewIndex = (enabled = true) => setGeneratedMrmsIndexUrlOverride(enabled ? "preview" : "");

function xweatherStormPreferenceEnabled() {
  return typeof xweatherStormEnabled === "function" ? xweatherStormEnabled() : false;
}

function xweatherStormLayerCodes() {
  const codes = typeof storedXweatherLayerCodes === "function" ? storedXweatherLayerCodes() : [];
  return codes.length ? codes : ["radar", "lightning-strikes-icons"];
}

function xweatherStormCredentials() {
  return {
    clientId: localStorage.getItem(XWEATHER_CLIENT_ID_KEY) || "",
    clientSecret: localStorage.getItem(XWEATHER_CLIENT_SECRET_KEY) || ""
  };
}

function xweatherStormMapsglNamespace() {
  return window.mapsgl || window.aerisweather?.mapsgl || window.xweather?.mapsgl || null;
}

function xweatherStormGuard() {
  if (!xweatherStormPreferenceEnabled()) return { ok: false, status: "off", message: "" };
  if (!mapState.immersive) return { ok: false, status: "standby", message: "Open full map" };
  if (!mapDiagnosticAllowsRadar()) return { ok: false, status: "paused", message: "Map test hides radar" };
  const credentials = xweatherStormCredentials();
  if (!credentials.clientId || !credentials.clientSecret) return { ok: false, status: "missing-keys", message: "Add Xweather keys" };
  if (!xweatherStormLayerCodes().length) return { ok: false, status: "paused", message: "No storm layers" };
  const usage = typeof readXweatherUsageRecord === "function" ? readXweatherUsageRecord() : { accesses: 0 };
  if (usage.accesses + XWEATHER_MAPSGL_SESSION_ACCESS_COST > XWEATHER_MONTHLY_ACCESS_LIMIT) {
    return { ok: false, status: "budget", message: "Storm view budget paused" };
  }
  return { ok: true, status: "ready", message: "" };
}

function ensureXweatherMapsglStylesheet() {
  if (xweatherStormMapsglNamespace()) return Promise.resolve(true);
  if (xweatherMapsglCssPromise) return xweatherMapsglCssPromise;
  const existing = document.getElementById(XWEATHER_MAPSGL_CSS_ID);
  if (existing) {
    xweatherMapsglCssPromise = Promise.resolve(true);
    return xweatherMapsglCssPromise;
  }
  const link = document.createElement("link");
  link.id = XWEATHER_MAPSGL_CSS_ID;
  link.rel = "stylesheet";
  link.href = XWEATHER_MAPSGL_CSS_URL;
  xweatherMapsglCssPromise = new Promise((resolve) => {
    link.addEventListener("load", () => resolve(true), { once: true });
    link.addEventListener("error", () => {
      link.remove();
      xweatherMapsglCssPromise = null;
      resolve(false);
    }, { once: true });
  });
  document.head.appendChild(link);
  return xweatherMapsglCssPromise;
}

function ensureXweatherMapsglAssets() {
  if (xweatherStormMapsglNamespace()) return Promise.resolve(true);
  const cssPromise = ensureXweatherMapsglStylesheet();
  if (!xweatherMapsglAssetPromise) {
    xweatherMapsglAssetPromise = new Promise((resolve) => {
      let script = document.getElementById(XWEATHER_MAPSGL_SCRIPT_ID);
      if (!script) {
        script = document.createElement("script");
        script.id = XWEATHER_MAPSGL_SCRIPT_ID;
        script.src = XWEATHER_MAPSGL_SCRIPT_URL;
        script.async = true;
      }
      script.addEventListener("load", () => resolve(true), { once: true });
      script.addEventListener("error", () => resolve(false), { once: true });
      if (!script.isConnected) document.body.appendChild(script);
    }).then((loaded) => Promise.all([Promise.resolve(loaded), cssPromise]))
      .then(([scriptLoaded]) => Boolean(scriptLoaded && xweatherStormMapsglNamespace()))
      .catch(() => false)
      .then((ready) => {
        if (!ready) {
          document.getElementById(XWEATHER_MAPSGL_SCRIPT_ID)?.remove();
          xweatherMapsglAssetPromise = null;
        }
        return ready;
      });
  }
  return xweatherMapsglAssetPromise;
}

function xweatherStormSessionWindow(now = Date.now()) {
  const interval = XWEATHER_STORM_SESSION_MS || 5 * 60 * 1000;
  return Math.floor(now / interval) * interval;
}

function recordXweatherStormSession(record) {
  const now = Date.now();
  const windowStart = xweatherStormSessionWindow(now);
  if (record?.xweatherStorm?.sessionWindowStart === windowStart) return;
  if (record?.xweatherStorm) record.xweatherStorm.sessionWindowStart = windowStart;
  try {
    const usage = typeof readXweatherUsageRecord === "function" ? readXweatherUsageRecord() : {
      month: new Date().toISOString().slice(0, 7),
      sessions: 0,
      accesses: 0,
      updatedAt: 0
    };
    usage.sessions = (Number(usage.sessions) || 0) + 1;
    usage.accesses = (Number(usage.accesses) || 0) + XWEATHER_MAPSGL_SESSION_ACCESS_COST;
    usage.updatedAt = now;
    localStorage.setItem(XWEATHER_USAGE_KEY, JSON.stringify(usage));
    if (typeof updateXweatherStormControl === "function") updateXweatherStormControl();
  } catch {}
}

function setXweatherStormStatus(record, status, message = "") {
  if (!record) return;
  record.xweatherStorm = {
    ...(record.xweatherStorm || {}),
    status,
    message,
    updatedAt: Date.now()
  };
  syncGeneratedRadarStatusChip();
  syncMapLibreDiagnosticReadout(record);
}

function xweatherStormActive(record = mapLibreCurrentRecord()) {
  return Boolean(record?.xweatherStorm?.status === "active" && record.xweatherStorm.controller);
}

function xweatherStormSuppressesNearcastRadar(record = mapLibreCurrentRecord()) {
  return xweatherStormActive(record);
}

function xweatherStormStatusForChip() {
  if (!xweatherStormPreferenceEnabled() || !mapState.immersive) return { visible: false };
  const record = mapLibreCurrentRecord();
  const status = record?.xweatherStorm?.status || xweatherStormGuard().status;
  const message = record?.xweatherStorm?.message || xweatherStormGuard().message || "";
  if (status === "active") return { visible: true, ready: true, text: "Storm view" };
  if (status === "loading") return { visible: true, ready: false, text: "Loading storm view" };
  if (status === "error") return { visible: true, ready: false, text: message || "Storm view unavailable" };
  if (status === "missing-keys" || status === "budget" || status === "paused") {
    return { visible: true, ready: false, text: message || "Storm view paused" };
  }
  return { visible: false };
}

async function startXweatherStormLayer(record) {
  if (!record || record.xweatherStorm?.loadingPromise || xweatherStormActive(record)) return;
  const guard = xweatherStormGuard();
  if (!guard.ok) {
    setXweatherStormStatus(record, guard.status, guard.message);
    return;
  }
  const credentials = xweatherStormCredentials();
  const layerCodes = xweatherStormLayerCodes();
  setXweatherStormStatus(record, "loading", "Loading storm view");
  record.xweatherStorm.loadingPromise = (async () => {
    const ready = await ensureXweatherMapsglAssets();
    if (!ready) throw new Error("Xweather SDK unavailable");
    if (mapLibreCurrentRecord() !== record || !mapState.immersive || !xweatherStormPreferenceEnabled()) return;
    const sdk = xweatherStormMapsglNamespace();
    if (!sdk?.Account || !sdk?.MaplibreMapController) throw new Error("Xweather MapLibre controller unavailable");
    const account = new sdk.Account(credentials.clientId, credentials.clientSecret);
    const controller = new sdk.MaplibreMapController(record.map, { account });
    const addedLayers = [];
    layerCodes.forEach((code) => {
      try {
        controller.addWeatherLayer(code);
        addedLayers.push(code);
      } catch (error) {
        console.warn(`[Nearcast] Xweather layer failed: ${code}`, error);
      }
    });
    if (!addedLayers.length) throw new Error("No Xweather storm layers loaded");
    record.xweatherStorm = {
      status: "active",
      controller,
      addedLayers,
      layerCodes,
      startedAt: Date.now(),
      sessionWindowStart: 0,
      message: "Storm view"
    };
    recordXweatherStormSession(record);
    clearMapLibreWeatherRecord(record);
    removeMapLibreRadarChunkLayer(record);
    syncGeneratedRadarStatusChip();
    syncMapLibreDiagnosticReadout(record);
    record.map.triggerRepaint?.();
  })().catch((error) => {
    console.warn("[Nearcast] Xweather storm view failed", error);
    if (mapLibreRecords.get(record.container) === record) {
      stopXweatherStormLayer(record, "error");
      setXweatherStormStatus(record, "error", error?.message || "Storm view unavailable");
    }
  }).finally(() => {
    if (record.xweatherStorm) record.xweatherStorm.loadingPromise = null;
  });
}

function stopXweatherStormLayer(record, reason = "off") {
  const storm = record?.xweatherStorm;
  if (!record || !storm) return;
  if (storm.controller && Array.isArray(storm.addedLayers)) {
    storm.addedLayers.forEach((code) => {
      try { storm.controller.removeWeatherLayer?.(code); } catch {}
    });
  }
  try { storm.controller?.removeLegendControl?.(); } catch {}
  try { storm.controller?.removeDataInspectorControl?.(); } catch {}
  try { storm.controller?.dispose?.(); } catch {}
  try { storm.controller?.destroy?.(); } catch {}
  if (reason === "error") {
    record.xweatherStorm = { status: "error", message: storm.message || "Storm view unavailable", updatedAt: Date.now() };
  } else {
    record.xweatherStorm = null;
    if (!["destroy", "exit"].includes(reason) && record.loaded) renderMapLibreWeather(mapState.frameIndex);
  }
  syncGeneratedRadarStatusChip();
  syncMapLibreDiagnosticReadout(record);
}

function syncXweatherStormLayer(record = mapLibreCurrentRecord()) {
  if (!record || !mapLibreRecordReady(record)) return false;
  const guard = xweatherStormGuard();
  if (!guard.ok) {
    if (xweatherStormActive(record)) stopXweatherStormLayer(record, guard.status);
    else if (xweatherStormPreferenceEnabled() && mapState.immersive) setXweatherStormStatus(record, guard.status, guard.message);
    return false;
  }
  if (!xweatherStormActive(record)) startXweatherStormLayer(record);
  if (xweatherStormActive(record)) {
    recordXweatherStormSession(record);
    clearMapLibreWeatherRecord(record);
    removeMapLibreRadarChunkLayer(record);
    return true;
  }
  return false;
}

function applyXweatherStormPreference() {
  mapLibreRecords.forEach((record) => {
    if (!xweatherStormPreferenceEnabled()) stopXweatherStormLayer(record, "off");
    else syncXweatherStormLayer(record);
  });
  renderMapLibreOverlays({ forceRadar: true });
  syncGeneratedRadarStatusChip();
}

function xweatherStormDiagnosticsSnapshot(record = mapLibreCurrentRecord()) {
  const storm = record?.xweatherStorm || null;
  const usage = typeof readXweatherUsageRecord === "function" ? readXweatherUsageRecord() : null;
  return {
    enabled: xweatherStormPreferenceEnabled(),
    status: storm?.status || "off",
    message: storm?.message || "",
    layers: storm?.addedLayers || xweatherStormLayerCodes(),
    active: xweatherStormActive(record),
    sessionWindowStart: storm?.sessionWindowStart || 0,
    estimatedAccesses: usage?.accesses || 0,
    estimatedSessions: usage?.sessions || 0
  };
}

function radarDiagnosticsSnapshot() {
  return {
    current: mapState.radarSourceDecision || null,
    history: [...(mapState.radarSourceDecisionLog || [])],
    generated: {
      manifestUrl: mapState.generatedRadarManifestUrl || "",
      selectionKey: mapState.generatedRadarSelectionKey || "",
      viewportKey: mapState.generatedRadarViewportKey || "",
      selectionHint: mapState.generatedRadarSelectionHint || null,
      indexUrl: generatedMrmsIndexUrl(),
      indexOverride: generatedMrmsIndexUrlOverride(),
      indexSelection: mapState.generatedRadarIndexSelection || null
    },
    warmup: mapState.generatedRadarWarmup || null,
    capability: mapState.radarCapability || null,
    capabilityHistory: [...(mapState.radarCapabilityLog || [])],
    context: safeGeneratedSelectionContext()
  };
}

function radarChunkDiagnosticsSnapshot(record = mapLibreCurrentRecord()) {
  const layer = record?.radarChunkLayerState;
  if (!layer) {
    return {
      enabled: Boolean(radarChunkIndexUrl()),
      indexUrl: radarChunkIndexUrl() || "",
      state: "inactive"
    };
  }
  return {
    enabled: true,
    indexUrl: layer.indexUrl || "",
    state: layer.status || "idle",
    error: layer.error || "",
    levels: (layer.index?.levels || []).map((level) => ({
      zoom: level.zoom,
      chunkCount: Array.isArray(level.chunks) ? level.chunks.length : 0,
      bytes: level.bytes || 0
    })),
    loadedChunks: layer.chunks?.length || 0,
    availableChunks: layer.chunkMetas?.length || 0,
    loadingChunks: layer.loadingChunkKeys?.size || 0,
    activeZoom: layer.activeZoom ?? null,
    renderedChunks: layer.renderedChunks || 0,
    drawnChunks: layer.drawnChunks || 0,
    renderCalls: layer.renderCalls || 0,
    glError: layer.glError || ""
  };
}

function rememberRadarCapability(capability) {
  mapState.radarCapability = capability || null;
  if (!capability) return capability;
  if (!Array.isArray(mapState.radarCapabilityLog)) mapState.radarCapabilityLog = [];
  mapState.radarCapabilityLog.push(capability);
  while (mapState.radarCapabilityLog.length > RADAR_CAPABILITY_LOG_LIMIT) {
    mapState.radarCapabilityLog.shift();
  }
  return capability;
}

function safeGeneratedSelectionContext() {
  try {
    return generatedMrmsSelectionContext();
  } catch {
    return null;
  }
}

function recordRadarSourceDecision(event, detail = {}) {
  const entry = {
    at: new Date().toISOString(),
    event,
    provider: radarProviderPreference(),
    renderer: state.mapRenderer,
    timelineKind: mapState.timelineKind,
    immersive: Boolean(mapState.immersive),
    place: radarSourcePlaceSnapshot(),
    zoom: Number.isFinite(Number(mapState.zoom)) ? Number(mapState.zoom) : null,
    generated: {
      manifestUrl: mapState.generatedRadarManifestUrl || "",
      selectionKey: mapState.generatedRadarSelectionKey || "",
      viewportKey: mapState.generatedRadarViewportKey || "",
      indexSelection: mapState.generatedRadarIndexSelection || null
    },
    detail
  };
  mapState.radarSourceDecision = entry;
  if (!Array.isArray(mapState.radarSourceDecisionLog)) mapState.radarSourceDecisionLog = [];
  mapState.radarSourceDecisionLog.push(entry);
  while (mapState.radarSourceDecisionLog.length > RADAR_SOURCE_DECISION_LOG_LIMIT) {
    mapState.radarSourceDecisionLog.shift();
  }
  if (window.NEARCAST_DEBUG_RADAR === true) console.info("[nearcast radar]", entry);
  return entry;
}

function radarSourcePlaceSnapshot() {
  const place = state.activePlace;
  if (!place) return null;
  return {
    id: place.id || "",
    name: place.name || "",
    latitude: Number.isFinite(Number(place.latitude)) ? Number(place.latitude) : null,
    longitude: Number.isFinite(Number(place.longitude)) ? Number(place.longitude) : null
  };
}

function radarDecisionErrorMessage(error) {
  return error?.message || String(error || "unknown error");
}

async function fetchRadarMetadataWithTimeout(url, options = {}) {
  const timeoutMs = Math.max(500, Number(options.timeoutMs || RADAR_FALLBACK_METADATA_FETCH_TIMEOUT_MS));
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
  const abort = () => controller?.abort();
  const externalSignal = options.signal;
  if (externalSignal) externalSignal.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) controller?.abort();

  const {
    timeoutMs: _timeoutMs,
    signal: _signal,
    ...fetchOptions
  } = options;

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller?.signal || externalSignal
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abort);
  }
}

function radarDecisionFrameSummary(frames) {
  const list = Array.isArray(frames) ? frames : [];
  const latest = list[list.length - 1];
  return {
    frameCount: list.length,
    provider: latest?.provider || "",
    attribution: latest?.attribution || latest?.sourceLabel || "",
    latestTime: Number.isFinite(latest?.timestamp) ? new Date(latest.timestamp).toISOString() : "",
    maxZoom: Number.isFinite(Number(latest?.maxZoom)) ? Number(latest.maxZoom) : null,
    encodedFrames: list.filter((frame) => frame?.dataUrl).length
  };
}

function initMap() {
  if (mapState.initialized || !els.weatherMap) return;
  mapState.initialized = true;
  window.addEventListener("resize", renderTileMap);
  bindMapDrag();
  renderMapLegend();
  renderTileMap();
  initMapAutoPlay();
}

function bindMapDrag() {
  const el = els.weatherMap;
  document.addEventListener("click", openMapLibrePreviewFromEvent, true);
  document.addEventListener("pointerup", openMapLibrePreviewFromEvent, true);
  document.addEventListener("touchend", openMapLibrePreviewFromEvent, { capture: true, passive: false });
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startMapPreviewTap(e.clientX, e.clientY, el);
    startMapDrag(e.clientX, e.clientY, el);
  });
  window.addEventListener("mousemove", (e) => moveMapDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", (e) => {
    const shouldOpen = finishMapPreviewTap(e.clientX, e.clientY);
    endMapGesture(el);
    if (shouldOpen) enterImmersiveMap();
  });

  el.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      cancelMapPreviewTap();
      startMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    const t = e.touches[0];
    startMapPreviewTap(t.clientX, t.clientY, el);
    startMapDrag(t.clientX, t.clientY, el);
  }, { passive: false });
  el.addEventListener("touchmove", (e) => {
    if (pinchState.active && e.touches.length === 2) {
      e.preventDefault();
      moveMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      moveMapDrag(t.clientX, t.clientY);
    }
  }, { passive: false });
  el.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const shouldOpen = t ? finishMapPreviewTap(t.clientX, t.clientY) : false;
    endMapGesture(el);
    if (shouldOpen) enterImmersiveMap();
  });
  el.addEventListener("touchcancel", () => {
    cancelMapPreviewTap();
    endMapGesture(el);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!state.activePlace || mapState.immersive) return;
    e.preventDefault();
    enterImmersiveMap();
  });
  el.addEventListener("click", (e) => {
    openMapLibrePreviewFromEvent(e);
  }, true);
}

function openMapLibrePreviewFromEvent(event) {
  if (!mapRendererIsGl() || mapState.immersive || !state.activePlace) return false;
  const target = event.target instanceof Element
    ? event.target
    : event.target?.parentElement;
  const previewMap = target?.closest?.("#weatherMap.is-gl-renderer");
  if (!previewMap || previewMap !== els.weatherMap) return false;
  const point = eventClientPoint(event);
  if (mapTapState.active && point && !finishMapPreviewTap(point.x, point.y)) return false;
  event.preventDefault();
  event.stopPropagation();
  enterImmersiveMap();
  return true;
}

function eventClientPoint(event) {
  const touch = event.changedTouches?.[0] || event.touches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (typeof event.clientX === "number" && typeof event.clientY === "number") {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

function startMapPreviewTap(x, y, el = els.weatherMap) {
  mapTapState.active = true;
  mapTapState.valid = !mapState.immersive && Boolean(state.activePlace);
  mapTapState.moved = false;
  mapTapState.startX = x;
  mapTapState.startY = y;
  mapTapState.targetEl = el;
}

function updateMapPreviewTap(x, y) {
  if (!mapTapState.active || mapTapState.moved) return;
  const dx = x - mapTapState.startX;
  const dy = y - mapTapState.startY;
  if (Math.hypot(dx, dy) > MAP_TAP_MOVE_PX) mapTapState.moved = true;
}

function finishMapPreviewTap(x, y) {
  updateMapPreviewTap(x, y);
  const el = mapTapState.targetEl;
  const rect = el?.getBoundingClientRect();
  const inside = rect
    ? x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    : false;
  const shouldOpen = mapTapState.active && mapTapState.valid && !mapTapState.moved && inside;
  cancelMapPreviewTap();
  return shouldOpen;
}

function cancelMapPreviewTap() {
  mapTapState.active = false;
  mapTapState.valid = false;
  mapTapState.moved = false;
  mapTapState.targetEl = null;
}

function startMapDrag(x, y, el = els.weatherMap) {
  if (mapRendererIsGl()) return;
  pinchState.active = false;
  dragState.active = true;
  dragState.startX = x;
  dragState.startY = y;
  dragState.startPanX = mapState.panX;
  dragState.startPanY = mapState.panY;
  dragState.moved = false;
  dragState.anchorActive = false;
  dragState.anchorPanX = mapState.panX;
  dragState.anchorPanY = mapState.panY;
  dragState.resumePlayback = false;
  if (el) el.style.cursor = "grabbing";
}

function moveMapDrag(x, y) {
  if (mapRendererIsGl() && !mapState.immersive) {
    updateMapPreviewTap(x, y);
    return;
  }
  if (mapRendererIsGl()) return;
  if (!dragState.active || pinchState.active) return;
  updateMapPreviewTap(x, y);
  const dx = x - dragState.startX;
  const dy = y - dragState.startY;
  mapState.panX = dragState.startPanX + dx;
  mapState.panY = dragState.startPanY + dy;
  if (Math.hypot(dx, dy) > MAP_PAN_MOVE_EPSILON_PX) {
    dragState.moved = true;
    pauseMapPlaybackForManualPan();
    updateAnchoredMapPan();
  }
}

function endMapGesture(el = els.weatherMap) {
  const shouldRender = dragState.active && dragState.moved;
  const shouldResumePlayback = dragState.resumePlayback;
  dragState.active = false;
  pinchState.active = false;
  finishAnchoredMapPan({ render: shouldRender });
  if (shouldRender) scheduleGeneratedRadarViewportRefresh("pan");
  if (el) el.style.cursor = "grab";
  if (shouldResumePlayback) {
    requestAnimationFrame(() => {
      if (!mapState.playing && mapState.frames.length) {
        startRadarPlayback({ restartIfAtEnd: !mapState.immersive });
      }
    });
  }
}

function pauseMapPlaybackForManualPan() {
  if (!mapState.playing || dragState.resumePlayback) return;
  dragState.resumePlayback = true;
  stopRadarPlayback({ renderStatic: false });
}

let mapPanTransformRaf = 0;

function mapPanLayers() {
  return [
    els.baseTileLayer,
    els.weatherTileLayer,
    els.labelTileLayer,
    els.markerLayer,
    document.getElementById("immersiveImpactLayer")
  ].filter(Boolean);
}

function beginAnchoredMapPan() {
  if (dragState.anchorActive) return;
  dragState.anchorActive = true;
  dragState.anchorPanX = dragState.startPanX;
  dragState.anchorPanY = dragState.startPanY;
  if (els.weatherMap) els.weatherMap.classList.add("is-panning");
}

function updateAnchoredMapPan() {
  beginAnchoredMapPan();
  const dx = mapState.panX - dragState.anchorPanX;
  const dy = mapState.panY - dragState.anchorPanY;
  const threshold = mapState.immersive ? IMMERSIVE_MAP_PAN_REBASE_PX : MAP_PAN_REBASE_PX;
  if (Math.abs(dx) >= threshold || Math.abs(dy) >= threshold) {
    rebaseAnchoredMapPan();
    return;
  }
  scheduleMapPanTransform(dx, dy);
}

function scheduleMapPanTransform(dx, dy) {
  dragState.anchorDx = dx;
  dragState.anchorDy = dy;
  if (mapPanTransformRaf) return;
  mapPanTransformRaf = requestAnimationFrame(() => {
    mapPanTransformRaf = 0;
    applyMapPanTransform(dragState.anchorDx || 0, dragState.anchorDy || 0);
  });
}

function applyMapPanTransform(dx, dy) {
  if (!dragState.anchorActive) return;
  const transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
  mapPanLayers().forEach((layer) => {
    layer.style.transform = transform;
  });
}

function clearMapPanTransform() {
  if (mapPanTransformRaf) {
    cancelAnimationFrame(mapPanTransformRaf);
    mapPanTransformRaf = 0;
  }
  mapPanLayers().forEach((layer) => {
    layer.style.transform = "";
  });
  dragState.anchorDx = 0;
  dragState.anchorDy = 0;
}

function rebaseAnchoredMapPan() {
  clearMapPanTransform();
  renderTileMap();
  dragState.anchorPanX = mapState.panX;
  dragState.anchorPanY = mapState.panY;
}

function finishAnchoredMapPan(options = {}) {
  const { render = false } = options;
  clearMapPanTransform();
  dragState.anchorActive = false;
  dragState.moved = false;
  if (els.weatherMap) els.weatherMap.classList.remove("is-panning");
  if (render) renderTileMap();
}

function mapRendererIsGl() {
  return state.mapRenderer === "gl" && Boolean(window.maplibregl);
}

function applyMapRendererPreference() {
  updateMapRendererButtons();
  stopRadarPlayback({ renderStatic: false });
  if (!mapRendererIsGl()) {
    destroyMapLibreMaps();
    if (mapState.immersive && !immersiveDragAbort) bindImmersiveDrag();
  } else if (mapState.immersive && immersiveDragAbort) {
    immersiveDragAbort.abort();
    immersiveDragAbort = null;
  }
  if (!mapState.initialized || !state.activePlace) return;
  renderTileMap();
  if (mapState.frames.length) showFrame(mapState.frameIndex);
}

function ensureMapLibreSurface(container) {
  let surface = container.querySelector(":scope > .maplibre-surface");
  if (!surface) {
    surface = document.createElement("div");
    surface.className = "maplibre-surface";
    container.appendChild(surface);
  }
  Object.assign(surface.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    overflow: "hidden"
  });
  if (!surface.dataset.nearcastTapBound) {
    surface.dataset.nearcastTapBound = "1";
    surface.addEventListener("click", openMapLibrePreviewFromEvent, true);
  }
  return surface;
}

function syncMapLibrePreviewHitbox(container) {
  let hitbox = container.querySelector(":scope > .maplibre-open-hitbox");
  if (mapState.immersive) {
    hitbox?.remove();
    return;
  }
  if (hitbox) return;
  hitbox = document.createElement("button");
  hitbox.type = "button";
  hitbox.className = "maplibre-open-hitbox";
  hitbox.tabIndex = -1;
  hitbox.setAttribute("aria-label", "Open immersive map");
  hitbox.addEventListener("click", openMapLibrePreviewFromEvent);
  hitbox.addEventListener("pointerup", openMapLibrePreviewFromEvent);
  hitbox.addEventListener("touchend", openMapLibrePreviewFromEvent, { passive: false });
  container.appendChild(hitbox);
}

function clearClassicLayersForMapLibre() {
  [els.baseTileLayer, els.weatherTileLayer, els.labelTileLayer].forEach((layer) => {
    if (!layer) return;
    layer.innerHTML = "";
    layer.style.transform = "";
  });
  clearMapMarkerNodes();
}

function mapLibrePlaceKey(place = state.activePlace) {
  if (!place) return "";
  return `${Number(place.latitude).toFixed(5)},${Number(place.longitude).toFixed(5)}`;
}

function mapLibreCenterFromState() {
  const place = state.activePlace;
  if (!place) return [0, 0];
  const zoom = clampMapZoom(mapState.zoom);
  const placeWorld = projectLatLon(place.latitude, place.longitude, zoom);
  const centerWorld = {
    x: placeWorld.x - mapState.panX,
    y: placeWorld.y - mapState.panY
  };
  const center = unprojectWorldPoint(centerWorld, zoom);
  return [center.longitude, center.latitude];
}

function syncMapLibreStateFromMap(map) {
  if (!map || !state.activePlace) return;
  const center = map.getCenter();
  const zoom = clampMapZoom(map.getZoom());
  const placeWorld = projectLatLon(state.activePlace.latitude, state.activePlace.longitude, zoom);
  const centerWorld = projectLatLon(center.lat, center.lng, zoom);
  mapState.zoom = zoom;
  mapState.panX = placeWorld.x - centerWorld.x;
  mapState.panY = placeWorld.y - centerWorld.y;
}

function setMapLibreRadarSuspended(suspended) {
  document.querySelectorAll(".tile-map.is-gl-radar-suspended").forEach((el) => {
    if (!suspended || el !== els.weatherMap) el.classList.remove("is-gl-radar-suspended");
  });
  if (els.weatherMap?.classList.contains("is-gl-renderer")) {
    els.weatherMap.classList.toggle("is-gl-radar-suspended", Boolean(suspended));
  }
}

function clearMapLibreInteractionState() {
  if (mapLibreOverlayRaf) {
    cancelAnimationFrame(mapLibreOverlayRaf);
    mapLibreOverlayRaf = 0;
  }
  mapLibreOverlayForceRadar = false;
  if (mapLibreInteraction.settleTimer) {
    clearTimeout(mapLibreInteraction.settleTimer);
    mapLibreInteraction.settleTimer = 0;
  }
  mapLibreInteraction.active = false;
  mapLibreInteraction.resumePlayback = false;
  mapLibreInteraction.needsRadarRender = false;
  setMapLibreRadarSuspended(false);
}

function beginMapLibreInteraction(map) {
  if (!mapRendererIsGl() || !mapState.immersive || !state.activePlace) return;
  syncMapLibreStateFromMap(map);
  if (mapLibreInteraction.settleTimer) {
    clearTimeout(mapLibreInteraction.settleTimer);
    mapLibreInteraction.settleTimer = 0;
  }
  if (mapLibreInteraction.active) return;

  mapLibreInteraction.active = true;
  mapLibreInteraction.resumePlayback = Boolean(mapState.playing);
  mapLibreInteraction.needsRadarRender = true;
  if (mapState.playing) stopRadarPlayback({ renderStatic: false });
  setMapLibreRadarSuspended(true);
}

function scheduleMapLibreSettle(map) {
  if (!mapRendererIsGl() || !mapLibreInteraction.active) {
    syncMapLibreStateAndOverlays(map, { forceRadar: true });
    return;
  }
  syncMapLibreStateFromMap(map);
  syncMapLibreStateAndOverlays(map);
  if (mapLibreInteraction.settleTimer) clearTimeout(mapLibreInteraction.settleTimer);
  mapLibreInteraction.settleTimer = setTimeout(() => finishMapLibreInteraction(map), MAPLIBRE_RADAR_SETTLE_MS);
}

function finishMapLibreInteraction(map) {
  if (mapLibreOverlayRaf) {
    cancelAnimationFrame(mapLibreOverlayRaf);
    mapLibreOverlayRaf = 0;
  }
  mapLibreOverlayForceRadar = false;
  if (mapLibreInteraction.settleTimer) {
    clearTimeout(mapLibreInteraction.settleTimer);
    mapLibreInteraction.settleTimer = 0;
  }
  syncMapLibreStateFromMap(map);
  const resumePlayback = mapLibreInteraction.resumePlayback;
  mapLibreInteraction.active = false;
  mapLibreInteraction.resumePlayback = false;
  renderMapLegend();
  renderMapLibreOverlays({ forceRadar: true });
  scheduleGeneratedRadarViewportRefresh("gl-settle");
  requestAnimationFrame(() => setMapLibreRadarSuspended(false));
  if (resumePlayback && mapState.frames.length && !mapState.playing) {
    requestAnimationFrame(() => {
      if (!mapState.playing && mapState.frames.length) startRadarPlayback({ restartIfAtEnd: false });
    });
  }
}

function syncMapLibreStateAndOverlays(map, options = {}) {
  syncMapLibreStateFromMap(map);
  if (options.forceRadar) mapLibreOverlayForceRadar = true;
  if (mapLibreOverlayRaf) return;
  mapLibreOverlayRaf = requestAnimationFrame(() => {
    mapLibreOverlayRaf = 0;
    const forceRadar = mapLibreOverlayForceRadar;
    mapLibreOverlayForceRadar = false;
    renderMapLibreOverlays({ forceRadar });
  });
}

function renderMapLibreOverlays(options = {}) {
  const shouldRenderRadar = Boolean(options.forceRadar) || !mapLibreInteraction.active;
  syncMapZoomDebugReadout();
  let record = mapLibreCurrentRecord();
  syncMapLibreBaseLayerVisibility(record);
  const useXweatherStorm = syncXweatherStormLayer(record);
  if (shouldRenderRadar) {
    if (useXweatherStorm) {
      clearMapLibreWeatherRecord(record);
      removeMapLibreRadarChunkLayer(record);
    } else {
      renderMapLibreWeather(mapState.frameIndex);
      record = mapLibreCurrentRecord() || record;
      syncMapLibreRadarChunkLayer(record);
    }
    renderMapLibreMarkers();
    if (mapState.immersive) renderStormImpactOverlay();
    mapLibreInteraction.needsRadarRender = false;
  } else {
    record = mapLibreCurrentRecord() || record;
    if (useXweatherStorm) {
      clearMapLibreWeatherRecord(record);
      removeMapLibreRadarChunkLayer(record);
    } else {
      syncMapLibreRadarChunkLayer(record);
    }
    mapLibreInteraction.needsRadarRender = true;
  }
  syncMapLibreDiagnosticReadout(record);
}

function syncMapLibreBaseLayerVisibility(record) {
  const map = record?.map;
  if (!map?.isStyleLoaded?.()) return;
  const visibility = mapDiagnosticBaseVisibility();
  setMapLibreLayerVisibility(map, MAPLIBRE_BASE_LAYER_ID, visibility.base);
  setMapLibreLayerVisibility(map, MAPLIBRE_LABEL_LAYER_ID, visibility.labels);
}

function setMapLibreLayerVisibility(map, layerId, visible) {
  if (!map?.getLayer?.(layerId)) return;
  const next = visible ? "visible" : "none";
  if (map.getLayoutProperty?.(layerId, "visibility") === next) return;
  map.setLayoutProperty(layerId, "visibility", next);
}

function mapLibreTileStyle() {
  const isDark = document.documentElement.dataset.theme === "dark";
  return {
    theme: isDark ? "dark" : "light",
    base: "rastertiles/voyager_nolabels",
    labels: "rastertiles/voyager_only_labels"
  };
}

function mapLibreCartoTileUrls(style) {
  const hosts = Array.isArray(CARTO_TILE_HOSTS) && CARTO_TILE_HOSTS.length
    ? CARTO_TILE_HOSTS
    : ["a"];
  return hosts.map((host) => `https://${host}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`);
}

function mapLibreBasePaint(theme) {
  return theme === "dark"
    ? {
        "raster-saturation": -0.2,
        "raster-contrast": 0.04,
        "raster-brightness-min": 0.04,
        "raster-brightness-max": 0.82,
        "raster-fade-duration": 0
      }
    : {
        "raster-saturation": -0.65,
        "raster-contrast": -0.08,
        "raster-brightness-min": 0.06,
        "raster-brightness-max": 0.98,
        "raster-fade-duration": 0
      };
}

function mapLibreStyle() {
  const style = mapLibreTileStyle();
  return {
    version: 8,
    sources: {
      "nearcast-base": {
        type: "raster",
        tiles: mapLibreCartoTileUrls(style.base),
        tileSize: 256,
        minzoom: MAP_MIN_ZOOM,
        maxzoom: MAP_MAX_ZOOM,
        attribution: "CARTO, OpenStreetMap contributors"
      },
      "nearcast-labels": {
        type: "raster",
        tiles: mapLibreCartoTileUrls(style.labels),
        tileSize: 256,
        minzoom: MAP_MIN_ZOOM,
        maxzoom: MAP_MAX_ZOOM
      }
    },
    layers: [
      {
        id: MAPLIBRE_BASE_LAYER_ID,
        type: "raster",
        source: "nearcast-base",
        paint: mapLibreBasePaint(style.theme)
      },
      {
        id: MAPLIBRE_LABEL_LAYER_ID,
        type: "raster",
        source: "nearcast-labels",
        paint: {
          "raster-opacity": 0.96,
          "raster-fade-duration": 0
        }
      }
    ]
  };
}

function mapLibreCurrentRecord() {
  return els.weatherMap ? mapLibreRecords.get(els.weatherMap) : null;
}

function mapLibreWeatherTileTemplate(template) {
  return String(template || "")
    .replace("%7Bbbox%7D", "{bbox-epsg-3857}")
    .replace("{bbox}", "{bbox-epsg-3857}");
}

function ensureMapLibreGeneratedRadarProtocol() {
  const maplibre = window.maplibregl;
  if (mapLibreGeneratedRadarProtocolRegistered || !maplibre?.addProtocol) return;
  maplibre.addProtocol(MAPLIBRE_GENERATED_RADAR_PROTOCOL, async (params, abortController) => {
    const url = mapLibreGeneratedRadarUrl(params?.url);
    if (!url) return { data: new ArrayBuffer(0) };
    const response = await fetch(url, { signal: abortController?.signal });
    if (response.status === 404 || response.status === 410) {
      return {
        data: new ArrayBuffer(0),
        cacheControl: response.headers.get("Cache-Control"),
        expires: response.headers.get("Expires")
      };
    }
    if (!response.ok) {
      throw new Error(`Generated radar tile failed: ${response.status}`);
    }
    return {
      data: await response.arrayBuffer(),
      cacheControl: response.headers.get("Cache-Control"),
      expires: response.headers.get("Expires")
    };
  });
  mapLibreGeneratedRadarProtocolRegistered = true;
}

function ensureMapLibreGeneratedRadarDataProtocol() {
  const maplibre = window.maplibregl;
  if (mapLibreGeneratedRadarDataProtocolRegistered || !maplibre?.addProtocol) return;
  maplibre.addProtocol(MAPLIBRE_GENERATED_RADAR_DATA_PROTOCOL, async (params, abortController) => {
    const request = mapLibreGeneratedRadarDataRequest(params?.url);
    if (!request.url) return { data: mapLibreEmptyPngArrayBuffer() };
    const data = await colorizeMapLibreEncodedRadarTile(request, abortController?.signal);
    return { data };
  });
  mapLibreGeneratedRadarDataProtocolRegistered = true;
}

function mapLibreGeneratedRadarUrl(url) {
  const value = String(url || "");
  if (!value.startsWith(`${MAPLIBRE_GENERATED_RADAR_PROTOCOL}://`)) return "";
  return value.replace(`${MAPLIBRE_GENERATED_RADAR_PROTOCOL}:`, "https:");
}

function mapLibreGeneratedRadarTileTemplate(template, frame) {
  if (frame?.provider !== "mrms-generated") return template;
  if (!/^https:\/\//i.test(template)) return template;
  ensureMapLibreGeneratedRadarProtocol();
  return template.replace(/^https:/i, `${MAPLIBRE_GENERATED_RADAR_PROTOCOL}:`);
}

function mapLibreGeneratedRadarDataTileTemplate(template, frame, layer = {}) {
  if (frame?.provider !== "mrms-generated" || !template || !/^https?:\/\//i.test(template)) return "";
  ensureMapLibreGeneratedRadarDataProtocol();
  const encoding = layer.dataEncoding || frame.dataEncoding || {};
  const sourceScheme = template.match(/^(https?):/i)?.[1]?.toLowerCase() || "https";
  const params = new URLSearchParams({
    ncStyle: layer.style || frame.style || encoding.style || "banded",
    ncMin: String(Number.isFinite(Number(encoding.min)) ? Number(encoding.min) : 0),
    ncMax: String(Number.isFinite(Number(encoding.max)) ? Number(encoding.max) : 80),
    ncThreshold: String(Number.isFinite(Number(encoding.threshold)) ? Number(encoding.threshold) : 5),
    ncAlpha: String(Number.isFinite(Number(encoding.alpha)) ? Number(encoding.alpha) : 1.02)
  });
  if (sourceScheme !== "https") params.set("ncScheme", sourceScheme);
  const separator = template.includes("?") ? "&" : "?";
  return `${template.replace(/^https?:/i, `${MAPLIBRE_GENERATED_RADAR_DATA_PROTOCOL}:`)}${separator}${params.toString()}`;
}

function mapLibreGeneratedRadarDataRequest(url) {
  const value = String(url || "");
  if (!value.startsWith(`${MAPLIBRE_GENERATED_RADAR_DATA_PROTOCOL}://`)) return { url: "" };
  const protectedUrl = value.replace(`${MAPLIBRE_GENERATED_RADAR_DATA_PROTOCOL}:`, "https:");
  try {
    const parsed = new URL(protectedUrl);
    const encoding = {
      style: parsed.searchParams.get("ncStyle") || "banded",
      min: Number(parsed.searchParams.get("ncMin")),
      max: Number(parsed.searchParams.get("ncMax")),
      threshold: Number(parsed.searchParams.get("ncThreshold")),
      alpha: Number(parsed.searchParams.get("ncAlpha"))
    };
    const sourceScheme = parsed.searchParams.get("ncScheme");
    ["ncStyle", "ncMin", "ncMax", "ncThreshold", "ncAlpha", "ncScheme"].forEach((key) => parsed.searchParams.delete(key));
    if (sourceScheme === "http") parsed.protocol = "http:";
    return {
      url: parsed.toString(),
      encoding
    };
  } catch {
    return {
      url: protectedUrl,
      encoding: {}
    };
  }
}

async function colorizeMapLibreEncodedRadarTile(request, signal) {
  const cacheKey = `${request.url}|${JSON.stringify(request.encoding || {})}`;
  const cached = mapLibreEncodedRadarTileCache.get(cacheKey);
  if (cached) return cached;
  const promise = colorizeMapLibreEncodedRadarTileUncached(request, signal)
    .catch(() => mapLibreEmptyPngArrayBuffer());
  mapLibreEncodedRadarTileCache.set(cacheKey, promise);
  pruneMapLibreEncodedRadarTileCache();
  return promise;
}

async function colorizeMapLibreEncodedRadarTileUncached(request, signal) {
  const response = await fetch(request.url, { signal });
  if (response.status === 404 || response.status === 410) return mapLibreEmptyPngArrayBuffer();
  if (!response.ok) throw new Error(`Generated radar data tile failed: ${response.status}`);
  const blob = await response.blob();
  const bitmap = await decodeMapLibreRadarDataBlob(blob);
  const canvas = createMapLibreRadarCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Encoded radar tile canvas unavailable.");
  ctx.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  colorizeMapLibreRadarImageData(imageData, request.encoding || {});
  ctx.putImageData(imageData, 0, 0);
  const outBlob = await mapLibreRadarCanvasToBlob(canvas);
  return outBlob.arrayBuffer();
}

function pruneMapLibreEncodedRadarTileCache() {
  while (mapLibreEncodedRadarTileCache.size > MAPLIBRE_ENCODED_RADAR_TILE_CACHE_LIMIT) {
    mapLibreEncodedRadarTileCache.delete(mapLibreEncodedRadarTileCache.keys().next().value);
  }
}

function mapLibreEmptyPngArrayBuffer() {
  const binary = atob(MAPLIBRE_ENCODED_RADAR_EMPTY_PNG);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function decodeMapLibreRadarDataBlob(blob) {
  if ("createImageBitmap" in window) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Generated radar data tile decode failed."));
    };
    image.src = url;
  });
}

function createMapLibreRadarCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function mapLibreRadarCanvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Generated radar tile encode failed."));
    }, "image/png");
  });
}

function colorizeMapLibreRadarImageData(imageData, encoding) {
  const min = Number.isFinite(Number(encoding.min)) ? Number(encoding.min) : 0;
  const max = Number.isFinite(Number(encoding.max)) && Number(encoding.max) > min ? Number(encoding.max) : 80;
  const threshold = Number.isFinite(Number(encoding.threshold)) ? Number(encoding.threshold) : 5;
  const style = mapLibreRadarStyle(encoding.style || "banded", encoding);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const encoded = data[index];
    if (encoded <= 0 || data[index + 3] < 1) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }
    const dbz = min + ((encoded - 1) / 254) * (max - min);
    const thresholdFade = mapLibreRadarThresholdAlpha(dbz, threshold, style);
    if (thresholdFade <= 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }
    const color = mapLibreRadarColor(dbz, style);
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = Math.round(Math.min(1, color[3] / 255 * thresholdFade * style.alphaScale) * 255);
  }
}

function mapLibreRadarStyle(name, encoding = {}) {
  const styleName = String(name || "banded").toLowerCase();
  if (styleName === "resolved" || styleName === "field") {
    return {
      ramp: MAPLIBRE_RADAR_RESOLVED_RAMP,
      steppedRamp: true,
      alphaScale: mapLibreRadarAlphaScale(encoding, 1.22),
      fadeBelow: 5,
      fadeAbove: 1.75,
      hardThreshold: false,
      bandBase: 5,
      bandStep: 0,
      bandFeather: 0.4
    };
  }
  if (styleName === "continuous") {
    return {
      ramp: MAPLIBRE_RADAR_RAMP,
      steppedRamp: false,
      alphaScale: mapLibreRadarAlphaScale(encoding, 1.16),
      fadeBelow: 3,
      fadeAbove: 2,
      hardThreshold: false,
      bandBase: 5,
      bandStep: 0,
      bandFeather: 0
    };
  }
  return {
    ramp: MAPLIBRE_RADAR_STEPPED_RAMP,
    steppedRamp: true,
    alphaScale: mapLibreRadarAlphaScale(encoding, 1.22),
    fadeBelow: 2.5,
    fadeAbove: 1.25,
    hardThreshold: true,
    bandBase: 5,
    bandStep: 7.5,
    bandFeather: 0
  };
}

function mapLibreRadarThresholdAlpha(dbz, threshold, style) {
  if (!Number.isFinite(dbz)) return 0;
  if (style?.hardThreshold) return dbz >= threshold ? 1 : 0;
  return mapLibreSmoothstep(threshold - style.fadeBelow, threshold + style.fadeAbove, dbz);
}

function mapLibreRadarAlphaScale(encoding = {}, minimum = 1) {
  const value = Number(encoding.alpha);
  return Number.isFinite(value) ? Math.max(value, minimum) : minimum;
}

function mapLibreRadarColor(value, style) {
  const styledValue = mapLibreRadarContourValue(value, style);
  return style.steppedRamp ? mapLibreSteppedRampColor(styledValue, style.ramp) : mapLibreRampColor(styledValue, style.ramp);
}

function mapLibreRadarContourValue(value, style) {
  if (!Number.isFinite(value) || !style.bandStep) return value;
  if (value <= style.bandBase) return value;
  const rawBand = (value - style.bandBase) / style.bandStep;
  const bandIndex = Math.floor(rawBand);
  const fraction = rawBand - bandIndex;
  const current = style.bandBase + bandIndex * style.bandStep + style.bandStep * 0.5;
  const previous = Math.max(style.bandBase, current - style.bandStep);
  const next = current + style.bandStep;
  if (style.bandFeather > 0 && fraction < style.bandFeather) {
    return previous + (current - previous) * mapLibreSmoothstep(0, style.bandFeather, fraction);
  }
  if (style.bandFeather > 0 && fraction > 1 - style.bandFeather) {
    return current + (next - current) * mapLibreSmoothstep(1 - style.bandFeather, 1, fraction);
  }
  return current;
}

function mapLibreRampColor(value, ramp) {
  if (value <= ramp[0].value) return ramp[0].color;
  for (let i = 1; i < ramp.length; i += 1) {
    const prev = ramp[i - 1];
    const next = ramp[i];
    if (value <= next.value) {
      const t = mapLibreSmoothstep(0, 1, (value - prev.value) / (next.value - prev.value));
      return prev.color.map((channel, index) => Math.round(channel + (next.color[index] - channel) * t));
    }
  }
  return ramp[ramp.length - 1].color;
}

function mapLibreSteppedRampColor(value, ramp) {
  if (value <= ramp[0].value) return ramp[0].color;
  for (let i = 1; i < ramp.length; i += 1) {
    if (value <= ramp[i].value) return ramp[i].color;
  }
  return ramp[ramp.length - 1].color;
}

function mapLibreSmoothstep(edge0, edge1, value) {
  if (!Number.isFinite(value)) return 0;
  const t = Math.max(0, Math.min((value - edge0) / (edge1 - edge0), 1));
  return t * t * (3 - 2 * t);
}

function mapLibreSourceBounds(bounds) {
  if (!bounds) return null;
  const minLat = Number(bounds.minLat);
  const minLon = Number(bounds.minLon);
  const maxLat = Number(bounds.maxLat);
  const maxLon = Number(bounds.maxLon);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  if (minLon > maxLon) return null;
  return [
    Math.max(-180, minLon),
    Math.max(-85.051129, Math.min(minLat, maxLat)),
    Math.min(180, maxLon),
    Math.min(85.051129, Math.max(minLat, maxLat))
  ];
}

function mapLibreWeatherBeforeLayer(map) {
  return map?.getLayer?.(MAPLIBRE_LABEL_LAYER_ID) ? MAPLIBRE_LABEL_LAYER_ID : undefined;
}

function radarChunkIndexUrl() {
  const value = radarChunkIndexFlag();
  if (!value) return "";
  const normalized = value.trim();
  const key = normalized.toLowerCase();
  if (!normalized || ["0", "false", "off", "none"].includes(key)) return "";
  if (["1", "true"].includes(key)) {
    return MAPLIBRE_RADAR_CHUNK_DEFAULT_INDEX_URL;
  }
  if (MAPLIBRE_RADAR_CHUNK_INDEX_URLS[key]) return MAPLIBRE_RADAR_CHUNK_INDEX_URLS[key];
  return normalized;
}

function radarChunkIndexFlag() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("radarChunkIndex") || params.get("radarChunks") || params.get("radarchunks") || "";
  } catch {
    return "";
  }
}

function syncMapLibreRadarChunkLayer(record = mapLibreCurrentRecord()) {
  const map = record?.map;
  if (!map || !map.isStyleLoaded?.()) return;
  const indexUrl = radarChunkIndexUrl();
  if (!indexUrl) {
    removeMapLibreRadarChunkLayer(record);
    syncMapLibreRadarChunkFallbackVisibility(record);
    return;
  }

  const existing = record.radarChunkLayerState;
  if (existing?.indexUrl === indexUrl && map.getLayer(MAPLIBRE_RADAR_CHUNK_LAYER_ID)) {
    ensureMapLibreRadarChunkLayerOrder(map);
    syncMapLibreRadarChunkFallbackVisibility(record);
    return;
  }
  removeMapLibreRadarChunkLayer(record);
  const layer = createMapLibreRadarChunkLayer(indexUrl);
  map.addLayer(layer, mapLibreWeatherBeforeLayer(map));
  ensureMapLibreRadarChunkLayerOrder(map);
  record.radarChunkLayerState = layer._nearcastState;
  record.radarChunkLayerState.record = record;
  syncMapLibreRadarChunkFallbackVisibility(record);
}

function ensureMapLibreRadarChunkLayerOrder(map) {
  if (!map?.getLayer?.(MAPLIBRE_RADAR_CHUNK_LAYER_ID)) return;
  const beforeLayer = mapLibreWeatherBeforeLayer(map);
  if (!beforeLayer || !map.getLayer?.(beforeLayer)) return;
  const layers = map.getStyle?.().layers || [];
  const chunkIndex = layers.findIndex((layer) => layer.id === MAPLIBRE_RADAR_CHUNK_LAYER_ID);
  const beforeIndex = layers.findIndex((layer) => layer.id === beforeLayer);
  if (chunkIndex < 0 || beforeIndex < 0 || chunkIndex === beforeIndex - 1) return;
  map.moveLayer?.(MAPLIBRE_RADAR_CHUNK_LAYER_ID, beforeLayer);
}

function removeMapLibreRadarChunkLayer(record) {
  const map = record?.map;
  if (!map) return;
  if (map.getLayer?.(MAPLIBRE_RADAR_CHUNK_LAYER_ID)) map.removeLayer(MAPLIBRE_RADAR_CHUNK_LAYER_ID);
  record.radarChunkLayerState = null;
}

function mapLibreRadarChunkReady(record = mapLibreCurrentRecord()) {
  const state = record?.radarChunkLayerState;
  const activeZoom = state?.activeZoom ?? radarChunkActiveZoom(state);
  return Boolean(
    state?.status === "ready"
    && (state.chunks || []).some((chunk) => chunk.levelZoom === activeZoom && radarChunkIntersectsViewport(state.map, chunk.bounds))
    && record?.map?.getLayer?.(MAPLIBRE_RADAR_CHUNK_LAYER_ID)
  );
}

function syncMapLibreRadarChunkFallbackVisibility(record = mapLibreCurrentRecord()) {
  if (!record?.weatherEntries) return;
  const useChunkRadar = mapLibreRadarChunkReady(record);
  record.weatherEntries.forEach((entry) => {
    if (!entry || !record.map?.getLayer?.(entry.layerId)) return;
    if (useChunkRadar) {
      setMapLibreWeatherEntryOpacity(record, entry, 0);
    } else if (record.liveWeatherKeys?.has(entry.key) && entry.lastSpec) {
      setMapLibreWeatherEntryVisual(record, entry, entry.lastSpec);
    }
  });
  syncMapLibreDiagnosticReadout(record);
}

function createMapLibreRadarChunkLayer(indexUrl) {
  const state = {
    indexUrl,
    map: null,
    record: null,
    status: "idle",
    error: "",
    index: null,
    chunkMetas: [],
    chunks: [],
    loadedChunkKeys: new Set(),
    loadingChunkKeys: new Set(),
    chunkLoadSeq: 0,
    program: null,
    buffers: null,
    uniforms: null,
    attributes: null,
    texturesCreated: 0,
    activeZoom: null,
    renderedChunks: 0,
    drawnChunks: 0,
    renderCalls: 0,
    glError: "",
    removed: false
  };

  return {
    id: MAPLIBRE_RADAR_CHUNK_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    _nearcastState: state,
    onAdd(map, gl) {
      state.map = map;
      initRadarChunkGl(state, gl);
      loadRadarChunkIndex(state).then(() => {
        if (!state.removed) state.map?.triggerRepaint?.();
      });
    },
    render(glOrArgs, matrixMaybe) {
      const gl = glOrArgs?.gl || glOrArgs;
      const matrix = radarChunkRenderMatrix(glOrArgs, matrixMaybe);
      renderRadarChunkLayer(state, gl, matrix);
    },
    onRemove(map, gl) {
      state.removed = true;
      destroyRadarChunkGl(state, gl);
      state.map = null;
      state.record = null;
    }
  };
}

function radarChunkRenderMatrix(glOrArgs, matrixMaybe) {
  if (glOrArgs?.defaultProjectionData?.mainMatrix) return glOrArgs.defaultProjectionData.mainMatrix;
  if (matrixMaybe?.defaultProjectionData?.mainMatrix) return matrixMaybe.defaultProjectionData.mainMatrix;
  if (glOrArgs?.modelViewProjectionMatrix) return glOrArgs.modelViewProjectionMatrix;
  if (matrixMaybe?.modelViewProjectionMatrix) return matrixMaybe.modelViewProjectionMatrix;
  return matrixMaybe;
}

function initRadarChunkGl(state, gl) {
  const vertexSource = `
    attribute vec2 a_pos;
    attribute vec2 a_tex;
    uniform mat4 u_matrix;
    varying vec2 v_tex;
    void main() {
      gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
      v_tex = a_tex;
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform float u_dbz_min;
    uniform float u_dbz_max;
    uniform float u_threshold;
    uniform float u_opacity;
    uniform float u_zoom;
    uniform vec2 u_texel_size;
    varying vec2 v_tex;

    float radarDbzFromEncoded(float encoded) {
      return u_dbz_min + ((encoded - 1.0) / 254.0) * (u_dbz_max - u_dbz_min);
    }

    float radarSampleDbz(vec2 coord) {
      float encoded = texture2D(u_texture, coord).r * 255.0;
      if (encoded < 0.5) return -999.0;
      return radarDbzFromEncoded(encoded);
    }

    vec4 radarSteppedColor(float dbz) {
      if (dbz <= 10.0) return vec4(66.0 / 255.0, 174.0 / 255.0, 214.0 / 255.0, 202.0 / 255.0);
      if (dbz <= 18.0) return vec4(62.0 / 255.0, 204.0 / 255.0, 105.0 / 255.0, 226.0 / 255.0);
      if (dbz <= 28.0) return vec4(20.0 / 255.0, 154.0 / 255.0, 74.0 / 255.0, 246.0 / 255.0);
      if (dbz <= 36.0) return vec4(238.0 / 255.0, 188.0 / 255.0, 42.0 / 255.0, 255.0 / 255.0);
      if (dbz <= 45.0) return vec4(230.0 / 255.0, 111.0 / 255.0, 36.0 / 255.0, 255.0 / 255.0);
      if (dbz <= 56.0) return vec4(214.0 / 255.0, 55.0 / 255.0, 43.0 / 255.0, 255.0 / 255.0);
      if (dbz <= 68.0) return vec4(154.0 / 255.0, 64.0 / 255.0, 188.0 / 255.0, 255.0 / 255.0);
      return vec4(238.0 / 255.0, 220.0 / 255.0, 244.0 / 255.0, 255.0 / 255.0);
    }

    vec4 radarSmoothColor(float dbz) {
      vec4 c0 = vec4(66.0 / 255.0, 174.0 / 255.0, 214.0 / 255.0, 202.0 / 255.0);
      vec4 c1 = vec4(62.0 / 255.0, 204.0 / 255.0, 105.0 / 255.0, 226.0 / 255.0);
      vec4 c2 = vec4(20.0 / 255.0, 154.0 / 255.0, 74.0 / 255.0, 246.0 / 255.0);
      vec4 c3 = vec4(238.0 / 255.0, 188.0 / 255.0, 42.0 / 255.0, 255.0 / 255.0);
      vec4 c4 = vec4(230.0 / 255.0, 111.0 / 255.0, 36.0 / 255.0, 255.0 / 255.0);
      vec4 c5 = vec4(214.0 / 255.0, 55.0 / 255.0, 43.0 / 255.0, 255.0 / 255.0);
      vec4 c6 = vec4(154.0 / 255.0, 64.0 / 255.0, 188.0 / 255.0, 255.0 / 255.0);
      vec4 c7 = vec4(238.0 / 255.0, 220.0 / 255.0, 244.0 / 255.0, 255.0 / 255.0);
      if (dbz <= 10.0) return c0;
      if (dbz <= 18.0) return mix(c0, c1, smoothstep(10.0, 18.0, dbz));
      if (dbz <= 28.0) return mix(c1, c2, smoothstep(18.0, 28.0, dbz));
      if (dbz <= 36.0) return mix(c2, c3, smoothstep(28.0, 36.0, dbz));
      if (dbz <= 45.0) return mix(c3, c4, smoothstep(36.0, 45.0, dbz));
      if (dbz <= 56.0) return mix(c4, c5, smoothstep(45.0, 56.0, dbz));
      if (dbz <= 68.0) return mix(c5, c6, smoothstep(56.0, 68.0, dbz));
      return mix(c6, c7, smoothstep(68.0, 80.0, dbz));
    }

    float radarNeighborhoodDbz(float centerDbz, float blend) {
      float sum = centerDbz;
      float count = 1.0;
      float sampleDbz;
      sampleDbz = radarSampleDbz(v_tex + vec2(u_texel_size.x, 0.0));
      if (sampleDbz > -900.0) { sum += sampleDbz; count += 1.0; }
      sampleDbz = radarSampleDbz(v_tex - vec2(u_texel_size.x, 0.0));
      if (sampleDbz > -900.0) { sum += sampleDbz; count += 1.0; }
      sampleDbz = radarSampleDbz(v_tex + vec2(0.0, u_texel_size.y));
      if (sampleDbz > -900.0) { sum += sampleDbz; count += 1.0; }
      sampleDbz = radarSampleDbz(v_tex - vec2(0.0, u_texel_size.y));
      if (sampleDbz > -900.0) { sum += sampleDbz; count += 1.0; }
      return mix(centerDbz, sum / count, blend);
    }

    vec4 radarColor(float dbz, float deepMix) {
      vec4 stepped = radarSteppedColor(dbz);
      vec4 smooth = radarSmoothColor(dbz);
      vec4 color = mix(stepped, smooth, deepMix * 0.88);
      vec3 warmStreetTone = color.rgb * vec3(0.88, 0.90, 0.78) + vec3(0.018, 0.012, 0.0);
      float luminance = dot(warmStreetTone, vec3(0.2126, 0.7152, 0.0722));
      warmStreetTone = mix(vec3(luminance), warmStreetTone, 0.94);
      color.rgb = mix(color.rgb, warmStreetTone, deepMix * 0.82);
      return color;
    }

    void main() {
      float encoded = texture2D(u_texture, v_tex).r * 255.0;
      if (encoded < 0.5) discard;
      float deepMix = smoothstep(13.0, 16.25, u_zoom);
      float dbz = radarDbzFromEncoded(encoded);
      dbz = radarNeighborhoodDbz(dbz, deepMix * 0.32);
      if (dbz < u_threshold) discard;
      vec4 color = radarColor(dbz, deepMix);
      float intensityAlpha = smoothstep(24.0, 58.0, dbz) * 0.08;
      gl_FragColor = vec4(color.rgb, color.a * min(u_opacity + intensityAlpha, 1.0));
    }
  `;

  const vertexShader = compileRadarChunkShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileRadarChunkShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "radar chunk shader link failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  state.program = program;
  state.buffers = {
    vertices: gl.createBuffer()
  };
  state.attributes = {
    pos: gl.getAttribLocation(program, "a_pos"),
    tex: gl.getAttribLocation(program, "a_tex")
  };
  state.uniforms = {
    matrix: gl.getUniformLocation(program, "u_matrix"),
    texture: gl.getUniformLocation(program, "u_texture"),
    dbzMin: gl.getUniformLocation(program, "u_dbz_min"),
    dbzMax: gl.getUniformLocation(program, "u_dbz_max"),
    threshold: gl.getUniformLocation(program, "u_threshold"),
    opacity: gl.getUniformLocation(program, "u_opacity"),
    zoom: gl.getUniformLocation(program, "u_zoom"),
    texelSize: gl.getUniformLocation(program, "u_texel_size")
  };
}

function compileRadarChunkShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "radar chunk shader compile failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

async function loadRadarChunkIndex(state) {
  state.status = "loading";
  state.error = "";
  try {
    const response = await fetch(state.indexUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`chunk index failed: ${response.status}`);
    const index = await response.json();
    if (state.removed) return;
    state.index = index;
    state.chunkMetas = radarChunkMetasFromIndex(index);
    state.chunks = [];
    state.loadedChunkKeys = new Set();
    state.loadingChunkKeys = new Set();
    state.status = state.chunkMetas.length ? "loading" : "empty";
    state.map?.triggerRepaint?.();
    syncMapLibreRadarChunkFallbackVisibility(state.record);
  } catch (error) {
    state.status = "error";
    state.error = error?.message || "chunk radar failed";
    syncMapLibreRadarChunkFallbackVisibility(state.record);
    recordRadarSourceDecision("radar.chunk-layer-unavailable", {
      indexUrl: state.indexUrl,
      reason: state.error
    });
  }
}

function radarChunkMetasFromIndex(index) {
  const levels = Array.isArray(index?.levels) ? index.levels : [];
  const metas = [];
  for (const level of levels) {
    const levelZoom = Number(level.zoom);
    const chunks = Array.isArray(level.chunks) ? level.chunks : [];
    for (const chunk of chunks) {
      metas.push({
        level,
        chunk,
        levelZoom,
        x: Number(chunk.x),
        y: Number(chunk.y),
        bounds: chunk.bounds || level.bounds,
        key: radarChunkKey(levelZoom, chunk.x, chunk.y)
      });
    }
  }
  return metas.filter((meta) => Number.isFinite(meta.levelZoom) && Number.isFinite(meta.x) && Number.isFinite(meta.y));
}

function radarChunkKey(levelZoom, x, y) {
  return `${levelZoom}/${x}/${y}`;
}

async function loadRadarChunkPayloads(index, indexUrl) {
  const levels = Array.isArray(index?.levels) ? index.levels : [];
  const tasks = [];
  for (const level of levels) {
    const chunks = Array.isArray(level.chunks) ? level.chunks : [];
    for (const chunk of chunks) {
      if (tasks.length >= MAPLIBRE_RADAR_CHUNK_FETCH_LIMIT) break;
      tasks.push(loadRadarChunkPayload(index, level, chunk, indexUrl));
    }
  }
  const results = await Promise.allSettled(tasks);
  return results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
}

async function loadRadarChunkPayload(index, level, chunk, indexUrl) {
  const url = new URL(chunk.path || "", new URL(indexUrl, window.location.href)).href;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`chunk failed: ${response.status}`);
  const raw = await response.arrayBuffer();
  const decoded = await decodeRadarChunkBinary(raw);
  const bounds = decoded.meta.bounds || chunk.bounds || level.bounds;
  const vertices = radarChunkVertices(bounds);
  return {
    levelZoom: Number(level.zoom),
    x: Number(chunk.x ?? decoded.meta.x),
    y: Number(chunk.y ?? decoded.meta.y),
    bounds,
    vertices,
    width: Number(decoded.meta.width || level.chunkSize || index?.canonical?.chunkSize || 256),
    height: Number(decoded.meta.height || level.chunkSize || index?.canonical?.chunkSize || 256),
    payload: decoded.payload,
    valueEncoding: decoded.meta.valueEncoding || index.valueEncoding || {},
    texture: null
  };
}

async function decodeRadarChunkBinary(buffer) {
  const bytes = new Uint8Array(buffer);
  const inflated = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? new Uint8Array(await gunzipRadarChunkBuffer(buffer))
    : bytes;
  const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
  const magic = String.fromCharCode(inflated[0], inflated[1], inflated[2], inflated[3]);
  if (magic !== "NCRD") throw new Error("unsupported radar chunk magic");
  const headerLength = view.getUint16(6);
  const payloadLength = view.getUint32(8);
  const headerStart = 12;
  const payloadStart = headerStart + headerLength;
  const meta = JSON.parse(new TextDecoder().decode(inflated.slice(headerStart, payloadStart)).trim());
  const payload = inflated.slice(payloadStart, payloadStart + payloadLength);
  if (payload.length !== payloadLength) throw new Error("truncated radar chunk payload");
  return { meta, payload };
}

async function gunzipRadarChunkBuffer(buffer) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("browser lacks gzip chunk decompression");
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function radarChunkVertices(bounds) {
  const source = mapLibreSourceBounds(bounds);
  if (!source || !window.maplibregl?.MercatorCoordinate) return null;
  const [minLon, minLat, maxLon, maxLat] = source;
  const nw = maplibregl.MercatorCoordinate.fromLngLat({ lng: minLon, lat: maxLat });
  const ne = maplibregl.MercatorCoordinate.fromLngLat({ lng: maxLon, lat: maxLat });
  const sw = maplibregl.MercatorCoordinate.fromLngLat({ lng: minLon, lat: minLat });
  const se = maplibregl.MercatorCoordinate.fromLngLat({ lng: maxLon, lat: minLat });
  return new Float32Array([
    nw.x, nw.y, 0, 0,
    ne.x, ne.y, 1, 0,
    sw.x, sw.y, 0, 1,
    se.x, se.y, 1, 1
  ]);
}

function radarChunkRenderZoom(state) {
  const mapZoom = Number(state?.map?.getZoom?.());
  const appZoom = Number(mapState.zoom);
  if (Number.isFinite(mapZoom) && Number.isFinite(appZoom)) return Math.max(mapZoom, appZoom);
  if (Number.isFinite(mapZoom)) return mapZoom;
  if (Number.isFinite(appZoom)) return appZoom;
  return Number(state?.activeZoom) || MAP_MAX_ZOOM;
}

function radarChunkOpacityForZoom(zoom) {
  if (!Number.isFinite(zoom)) return 0.94;
  const streetMix = mapLibreSmoothstep(0, 1, (zoom - 12) / 5);
  return 0.94 - (0.24 * streetMix);
}

function renderRadarChunkLayer(state, gl, matrix) {
  if (!gl || !matrix || !state?.program || !["loading", "ready"].includes(state.status)) return;
  const activeZoom = radarChunkActiveZoom(state);
  const renderZoom = radarChunkRenderZoom(state);
  scheduleRadarChunkViewportLoads(state, activeZoom);
  const chunks = state.chunks.filter((chunk) => chunk.levelZoom === activeZoom && radarChunkIntersectsViewport(state.map, chunk.bounds));
  state.activeZoom = activeZoom;
  state.renderedChunks = chunks.length;
  state.drawnChunks = 0;
  state.renderCalls += 1;
  syncMapLibreRadarChunkFallbackVisibility(state.record);
  if (!chunks.length) return;
  pruneRadarChunkCache(state, gl, new Set(chunks.map((chunk) => chunk._nearcastChunkKey).filter(Boolean)));

  state.glError = "";
  gl.useProgram(state.program);
  if (typeof gl.bindVertexArray === "function") gl.bindVertexArray(null);
  else gl.getExtension?.("OES_vertex_array_object")?.bindVertexArrayOES?.(null);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.colorMask(true, true, true, true);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.depthMask(false);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.vertices);
  gl.enableVertexAttribArray(state.attributes.pos);
  gl.enableVertexAttribArray(state.attributes.tex);
  gl.vertexAttribPointer(state.attributes.pos, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(state.attributes.tex, 2, gl.FLOAT, false, 16, 8);
  gl.uniformMatrix4fv(state.uniforms.matrix, false, matrix);
  gl.uniform1i(state.uniforms.texture, 0);
  gl.uniform1f(state.uniforms.opacity, radarChunkOpacityForZoom(renderZoom));
  gl.uniform1f(state.uniforms.zoom, renderZoom);

  for (const chunk of chunks) {
    if (!chunk.vertices) continue;
    const texture = ensureRadarChunkTexture(state, gl, chunk);
    if (!texture) continue;
    const encoding = chunk.valueEncoding || {};
    const dbzMin = Number.isFinite(Number(encoding.dbzMin)) ? Number(encoding.dbzMin) : 0;
    const dbzMax = Number.isFinite(Number(encoding.dbzMax)) && Number(encoding.dbzMax) > dbzMin ? Number(encoding.dbzMax) : 80;
    const threshold = Number.isFinite(Number(encoding.threshold)) ? Number(encoding.threshold) : 5;
    gl.uniform1f(state.uniforms.dbzMin, dbzMin);
    gl.uniform1f(state.uniforms.dbzMax, dbzMax);
    gl.uniform1f(state.uniforms.threshold, threshold);
    gl.uniform2f(state.uniforms.texelSize, 1 / Math.max(1, chunk.width || 256), 1 / Math.max(1, chunk.height || 256));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    state.drawnChunks += 1;
    chunk.lastDrawSeq = state.renderCalls;
    const error = gl.getError?.();
    if (error) {
      state.glError = `gl ${error}`;
      break;
    }
  }
}

function radarChunkActiveZoom(state) {
  const mapZoom = Number(state?.map?.getZoom?.());
  const appZoom = Number(mapState.zoom);
  const zoom = Number.isFinite(mapZoom)
    ? (Number.isFinite(appZoom) ? Math.max(mapZoom, appZoom) : mapZoom)
    : appZoom;
  const source = state?.chunkMetas?.length ? state.chunkMetas : state?.chunks;
  const levels = [...new Set((source || []).map((chunk) => chunk.levelZoom).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!levels.length) return null;
  if (!Number.isFinite(zoom)) return levels[levels.length - 1];
  return levels.reduce((best, level) => {
    const bestDelta = Math.abs(best - zoom);
    const levelDelta = Math.abs(level - zoom);
    return levelDelta <= bestDelta ? level : best;
  }, levels[0]);
}

function scheduleRadarChunkViewportLoads(state, activeZoom) {
  if (!state?.index || !state.chunkMetas?.length || activeZoom == null || state.removed) return;
  const candidates = state.chunkMetas
    .filter((meta) => meta.levelZoom === activeZoom && radarChunkIntersectsViewport(state.map, meta.bounds))
    .filter((meta) => !state.loadedChunkKeys.has(meta.key) && !state.loadingChunkKeys.has(meta.key))
    .slice(0, MAPLIBRE_RADAR_CHUNK_FETCH_LIMIT);
  if (!candidates.length) return;

  candidates.forEach((meta) => {
    state.loadingChunkKeys.add(meta.key);
    loadRadarChunkPayload(state.index, meta.level, meta.chunk, state.indexUrl)
      .then((chunk) => {
        state.loadingChunkKeys.delete(meta.key);
        if (!chunk || state.removed) return;
        chunk._nearcastChunkKey = meta.key;
        chunk.loadedAtSeq = ++state.chunkLoadSeq;
        state.loadedChunkKeys.add(meta.key);
        state.chunks.push(chunk);
        state.status = "ready";
        syncMapLibreRadarChunkFallbackVisibility(state.record);
        state.map?.triggerRepaint?.();
      })
      .catch((error) => {
        state.loadingChunkKeys.delete(meta.key);
        state.error = error?.message || "chunk load failed";
        if (!state.chunks.length) state.status = "loading";
        syncMapLibreRadarChunkFallbackVisibility(state.record);
        state.map?.triggerRepaint?.();
      });
  });
}

function pruneRadarChunkCache(state, gl, protectedKeys = new Set()) {
  if (!state?.chunks || state.chunks.length <= MAPLIBRE_RADAR_CHUNK_LOADED_LIMIT) return;
  const removable = state.chunks
    .filter((chunk) => !protectedKeys.has(chunk._nearcastChunkKey))
    .sort((a, b) => (a.lastDrawSeq || a.loadedAtSeq || 0) - (b.lastDrawSeq || b.loadedAtSeq || 0));
  while (state.chunks.length > MAPLIBRE_RADAR_CHUNK_LOADED_LIMIT && removable.length) {
    const chunk = removable.shift();
    const index = state.chunks.indexOf(chunk);
    if (index >= 0) state.chunks.splice(index, 1);
    if (chunk._nearcastChunkKey) state.loadedChunkKeys.delete(chunk._nearcastChunkKey);
    if (chunk.texture && gl) gl.deleteTexture(chunk.texture);
    chunk.texture = null;
    chunk.rgbaPayload = null;
  }
}

function radarChunkIntersectsViewport(map, bounds) {
  if (!map?.getBounds || !bounds) return true;
  const source = mapLibreSourceBounds(bounds);
  if (!source) return true;
  const viewport = map.getBounds();
  const west = viewport.getWest();
  const east = viewport.getEast();
  const south = viewport.getSouth();
  const north = viewport.getNorth();
  return source[2] >= west && source[0] <= east && source[3] >= south && source[1] <= north;
}

function ensureRadarChunkTexture(state, gl, chunk) {
  if (chunk.texture) return chunk.texture;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, chunk.width, chunk.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, radarChunkRgbaPayload(chunk));
  chunk.texture = texture;
  state.texturesCreated += 1;
  return texture;
}

function radarChunkRgbaPayload(chunk) {
  if (chunk.rgbaPayload) return chunk.rgbaPayload;
  const source = chunk.payload || new Uint8Array(0);
  const rgba = new Uint8Array(source.length * 4);
  for (let i = 0; i < source.length; i += 1) {
    const offset = i * 4;
    rgba[offset] = source[i];
    rgba[offset + 3] = 255;
  }
  chunk.rgbaPayload = rgba;
  return rgba;
}

function destroyRadarChunkGl(state, gl) {
  if (!gl || !state) return;
  (state.chunks || []).forEach((chunk) => {
    if (chunk.texture) gl.deleteTexture(chunk.texture);
    chunk.texture = null;
  });
  if (state.buffers?.vertices) gl.deleteBuffer(state.buffers.vertices);
  if (state.program) gl.deleteProgram(state.program);
  state.buffers = null;
  state.program = null;
}

function mapLibreWeatherLayerPaint(opacity, sourceZoom = MAP_MAX_ZOOM, options = {}) {
  const tone = weatherVisualTone(sourceZoom, options);
  return {
    "raster-opacity": opacity,
    "raster-fade-duration": 0,
    "raster-resampling": "linear",
    "raster-saturation": tone.mapLibreSaturation,
    "raster-contrast": tone.mapLibreContrast
  };
}

function mapLibreWeatherOpacity(spec) {
  const opacity = spec?.preload ? MAPLIBRE_WEATHER_PRELOAD_OPACITY : spec?.opacity ?? 0.78;
  return weatherVisualOpacity(opacity, spec?.maxZoom || MAP_MAX_ZOOM);
}

function weatherFrameDefaultOpacity(frame) {
  return frame?.provider === "mrms-generated" ? 0.94 : 0.78;
}

function mapLibreWeatherLayerSpecs(index = mapState.frameIndex) {
  if (!mapState.frames.length) return [];
  const N = mapState.frames.length;
  const cur = ((index % N) + N) % N;
  const diagnosticMode = mapDiagnosticMode();
  if (!mapDiagnosticAllowsRadar()) return [];

  if (diagnosticMode === "current" || diagnosticMode === "current-markers") {
    return mapLibreCurrentFrameWeatherSpecs(cur);
  }

  if (diagnosticMode === "buffer") {
    return mapLibreBufferedFrameWeatherSpecs(cur);
  }

  if (shouldBufferRadarPlayback(cur)) {
    const next = nextPlaybackIndexFrom(cur);
    const frames = mapState.xfadeFrames;
    for (const need of [cur, next]) {
      if (frames[0] !== need && frames[1] !== need) {
        const other = need === cur ? next : cur;
        frames[frames[0] === other ? 1 : 0] = need;
      }
    }

    return frames
      .map((frameIndex) => mapLibreWeatherSpecForFrame(frameIndex, {
        opacity: frameIndex === cur ? weatherFrameDefaultOpacity(mapState.frames[frameIndex]) : MAPLIBRE_WEATHER_PRELOAD_OPACITY,
        preload: frameIndex !== cur
      }))
      .filter(Boolean);
  }

  const frame = mapState.frames[cur];
  const layers = frame?.layers || ((frame?.url || frame?.dataUrl)
    ? [{ url: frame.url, dataUrl: frame.dataUrl, dataEncoding: frame.dataEncoding, opacity: weatherFrameDefaultOpacity(frame) }]
    : []);
  return layers
    .map((layer, layerIndex) => mapLibreWeatherSpecForLayer(frame, layer, {
      frameIndex: cur,
      layerIndex,
      preload: false
    }))
    .filter(Boolean);
}

function mapLibreCurrentFrameWeatherSpecs(frameIndex) {
  const frame = mapState.frames[frameIndex];
  const layers = frame?.layers || ((frame?.url || frame?.dataUrl)
    ? [{ url: frame.url, dataUrl: frame.dataUrl, dataEncoding: frame.dataEncoding, opacity: weatherFrameDefaultOpacity(frame) }]
    : []);
  return layers
    .map((layer, layerIndex) => mapLibreWeatherSpecForLayer(frame, layer, {
      frameIndex,
      layerIndex,
      preload: false
    }))
    .filter(Boolean);
}

function mapLibreBufferedFrameWeatherSpecs(frameIndex) {
  const frame = mapState.frames[frameIndex];
  if (!frame) return [];
  if (activeMapSource(frame) !== "radar") return mapLibreCurrentFrameWeatherSpecs(frameIndex);
  const bounds = playbackBounds();
  const next = nextPlaybackIndexFrom(frameIndex, bounds);
  return [frameIndex, next]
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .map((value) => mapLibreWeatherSpecForFrame(value, {
      opacity: value === frameIndex ? weatherFrameDefaultOpacity(mapState.frames[value]) : MAPLIBRE_WEATHER_PRELOAD_OPACITY,
      preload: value !== frameIndex
    }))
    .filter(Boolean);
}

function mapLibreWeatherSpecForFrame(frameIndex, options = {}) {
  const frame = mapState.frames[frameIndex];
  if (!frame) return null;
  return mapLibreWeatherSpecForLayer(frame, {
    url: frame.url,
    dataUrl: frame.dataUrl,
    dataEncoding: frame.dataEncoding,
    opacity: options.opacity ?? weatherFrameDefaultOpacity(frame)
  }, {
    frameIndex,
    layerIndex: 0,
    preload: Boolean(options.preload)
  });
}

function mapLibreWeatherSpecForLayer(frame, layer, options = {}) {
  const rawTemplate = mapLibreWeatherTileTemplate(layer?.url);
  const rawDataTemplate = mapLibreWeatherTileTemplate(layer?.dataUrl || frame?.dataUrl);
  const dataTemplate = mapLibreGeneratedRadarDataTileTemplate(rawDataTemplate, frame, layer);
  const template = dataTemplate || mapLibreGeneratedRadarTileTemplate(rawTemplate, frame);
  if (!template) return null;
  const opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : weatherFrameDefaultOpacity(frame);
  const minZoom = weatherFrameMinZoom(frame);
  const maxZoom = Math.max(minZoom, weatherFrameMaxZoom(frame));
  return {
    key: `${options.frameIndex}:${options.layerIndex}:${template}`,
    frameIndex: options.frameIndex,
    template,
    renderer: dataTemplate ? "encoded-radar" : "raster",
    generatedRadar: frame?.provider === "mrms-generated",
    dataEncoding: layer?.dataEncoding || frame?.dataEncoding || null,
    opacity: Math.max(0, Math.min(opacity, 1)),
    preload: Boolean(options.preload),
    minZoom,
    maxZoom,
    bounds: mapLibreSourceBounds(frame?.coverageBounds),
    attribution: frame?.attribution || ""
  };
}

function renderMapLibreWeather(index = mapState.frameIndex) {
  const record = mapLibreCurrentRecord();
  if (!mapLibreRecordReady(record)) return;
  if (xweatherStormSuppressesNearcastRadar(record)) {
    clearMapLibreWeatherRecord(record);
    removeMapLibreRadarChunkLayer(record);
    return;
  }
  if (maybeSwitchGeneratedRadarToFallback(index, "generated-viewport-out-of-scope")) return;
  const specs = mapLibreWeatherLayerSpecs(index);
  syncMapLibreWeatherSlots(record, specs);
  syncMapLibreRadarChunkLayer(record);
}

function syncMapLibreWeatherSlots(record, specs = []) {
  const map = record?.map;
  if (!map || !map.isStyleLoaded?.()) return;
  if (!record.weatherEntries) record.weatherEntries = new Map();
  record.weatherRenderSeq = (record.weatherRenderSeq || 0) + 1;

  const liveKeys = new Set(specs.map((spec) => spec.key));
  record.liveWeatherKeys = liveKeys;

  specs.forEach((spec) => {
    const entry = ensureMapLibreWeatherEntry(record, spec);
    if (!entry) return;
    entry.frameIndex = spec.frameIndex;
    entry.lastUsedAt = record.weatherRenderSeq;
    entry.lastSpec = spec;
    entry.hideSeq = 0;
    setMapLibreWeatherEntryVisual(record, entry, spec);
  });

  syncMapLibreRadarChunkFallbackVisibility(record);
  record.weatherEntries.forEach((entry, key) => {
    if (liveKeys.has(key)) return;
    if (mapDiagnosticUsesStrictLayerSet()) {
      removeMapLibreWeatherEntry(record, entry);
    } else if (entry.visible) scheduleMapLibreWeatherEntryHide(record, entry);
    else setMapLibreWeatherEntryOpacity(record, entry, 0);
  });

  pruneMapLibreWeatherEntries(record);
  syncMapLibreDiagnosticReadout(record);
}

function mapLibreWeatherSourceSignature(spec) {
  const bounds = Array.isArray(spec.bounds) ? spec.bounds.join(",") : "";
  const dataEncoding = spec.dataEncoding ? JSON.stringify(spec.dataEncoding) : "";
  return `${spec.renderer}|${spec.template}|${spec.minZoom}|${spec.maxZoom}|${bounds}|${spec.attribution}|${dataEncoding}`;
}

function ensureMapLibreWeatherEntry(record, spec) {
  const map = record?.map;
  if (!map || !spec?.key) return null;
  let entry = record.weatherEntries.get(spec.key);
  const sourceSignature = mapLibreWeatherSourceSignature(spec);
  if (entry && entry.sourceSignature === sourceSignature && map.getLayer(entry.layerId) && map.getSource(entry.sourceId)) {
    return entry;
  }

  if (entry) removeMapLibreWeatherEntry(record, entry);
  const id = record.weatherEntrySeq = (record.weatherEntrySeq || 0) + 1;
  const sourceId = `${MAPLIBRE_WEATHER_PREFIX}-source-${id}`;
  const layerId = `${MAPLIBRE_WEATHER_PREFIX}-layer-${id}`;
  const sourceOptions = {
    type: "raster",
    tiles: [spec.template],
    tileSize: 256,
    minzoom: spec.minZoom,
    maxzoom: spec.maxZoom,
    attribution: spec.attribution
  };
  if (Array.isArray(spec.bounds)) sourceOptions.bounds = spec.bounds;
  map.addSource(sourceId, sourceOptions);
  map.addLayer({
    id: layerId,
    type: "raster",
    source: sourceId,
    paint: mapLibreWeatherLayerPaint(mapLibreWeatherOpacity(spec), spec.maxZoom, spec)
  }, mapLibreWeatherBeforeLayer(map));

  entry = {
    key: spec.key,
    sourceId,
    layerId,
    sourceSignature,
    frameIndex: spec.frameIndex,
    lastSpec: spec,
    visible: mapLibreWeatherOpacity(spec) > MAPLIBRE_WEATHER_PRELOAD_OPACITY,
    lastUsedAt: record.weatherRenderSeq || 0,
    hideSeq: 0
  };
  record.weatherEntries.set(spec.key, entry);
  return entry;
}

function setMapLibreWeatherEntryOpacity(record, entry, opacity) {
  if (!record?.map?.getLayer(entry.layerId)) return;
  record.map.setPaintProperty(entry.layerId, "raster-opacity", opacity);
  entry.visible = opacity > MAPLIBRE_WEATHER_PRELOAD_OPACITY;
}

function setMapLibreWeatherEntryVisual(record, entry, spec) {
  if (!record?.map?.getLayer(entry.layerId)) return;
  const sourceZoom = spec?.maxZoom || MAP_MAX_ZOOM;
  const tone = weatherVisualTone(sourceZoom, spec);
  setMapLibreWeatherEntryOpacity(record, entry, mapLibreWeatherOpacity(spec));
  record.map.setPaintProperty(entry.layerId, "raster-saturation", tone.mapLibreSaturation);
  record.map.setPaintProperty(entry.layerId, "raster-contrast", tone.mapLibreContrast);
}

function scheduleMapLibreWeatherEntryHide(record, entry) {
  const hideSeq = record.weatherRenderSeq || 0;
  entry.hideSeq = hideSeq;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!record.weatherEntries?.has(entry.key)) return;
      if (record.liveWeatherKeys?.has(entry.key)) return;
      if (entry.hideSeq !== hideSeq) return;
      setMapLibreWeatherEntryOpacity(record, entry, 0);
      pruneMapLibreWeatherEntries(record);
    });
  });
}

function pruneMapLibreWeatherEntries(record) {
  if (!record?.weatherEntries || record.weatherEntries.size <= MAPLIBRE_WEATHER_LAYER_CACHE_LIMIT) return;
  const entries = [...record.weatherEntries.values()]
    .filter((entry) => !entry.visible && !record.liveWeatherKeys?.has(entry.key))
    .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));

  while (record.weatherEntries.size > MAPLIBRE_WEATHER_LAYER_CACHE_LIMIT && entries.length) {
    removeMapLibreWeatherEntry(record, entries.shift());
  }
}

function removeMapLibreWeatherEntry(record, entry) {
  const map = record?.map;
  if (!map || !entry) return;
  if (entry.layerId && map.getLayer(entry.layerId)) map.removeLayer(entry.layerId);
  if (entry.sourceId && map.getSource(entry.sourceId)) map.removeSource(entry.sourceId);
  record.weatherEntries?.delete(entry.key);
}

function clearMapLibreWeatherRecord(record) {
  if (!record?.weatherEntries) return;
  [...record.weatherEntries.values()].forEach((entry) => removeMapLibreWeatherEntry(record, entry));
  record.weatherEntries.clear();
  record.liveWeatherKeys = new Set();
}

function mapLibreBufferedRadarFrameReady(frameIndex) {
  const record = mapLibreCurrentRecord();
  if (!mapLibreRecordReady(record)) return false;
  const entry = [...(record.weatherEntries?.values() || [])].find((item) => item?.frameIndex === frameIndex);
  if (!entry) return false;
  return record.map.isSourceLoaded?.(entry.sourceId) || false;
}

function renderMapLibreMarkers(record = mapLibreCurrentRecord()) {
  if (!mapDiagnosticAllowsMarkers() || !mapLibreRecordReadyForMarkers(record) || !state.activePlace || !window.maplibregl) {
    clearMapLibreMarkers(record);
    syncMapLibreDiagnosticReadout(record);
    return;
  }
  if (!record.markerEntries) record.markerEntries = new Map();

  const liveKeys = new Set();
  const placedBounds = [];
  const activeLayout = mapLibreMarkerLayout(record, state.activePlace);
  if (activeLayout) {
    upsertMapLibreMarker(record, state.activePlace, liveKeys);
    placedBounds.push(activeLayout.bounds);
  }

  if (mapState.immersive) {
    state.savedPlaces
      .filter((place) => !isActiveMapPlace(place))
      .forEach((place) => {
        const layout = mapLibreMarkerLayout(record, place);
        if (!layout || mapBoundsOverlapAny(layout.bounds, placedBounds)) return;
        upsertMapLibreMarker(record, place, liveKeys);
        placedBounds.push(layout.bounds);
      });
  }

  record.markerEntries.forEach((entry, key) => {
    if (liveKeys.has(key)) return;
    entry.marker.remove();
    record.markerEntries.delete(key);
  });
  syncMapLibreDiagnosticReadout(record);
}

function mapLibreMarkerLayout(record, place) {
  if (!record?.map || !place) return null;
  const longitude = Number(place.longitude);
  const latitude = Number(place.latitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const size = record.map.getContainer()?.getBoundingClientRect?.();
  const point = record.map.project([longitude, latitude]);
  if (!point || !size) return null;
  if (point.x < -90 || point.x > size.width + 90 || point.y < -90 || point.y > size.height + 90) return null;

  const data = mapMarkerData(place);
  const width = estimateMapMarkerWidth(data.name, data.tempText, data.impactText);
  const height = data.tempText || data.impactText ? 31 : 29;
  return {
    point,
    bounds: mapMarkerBounds(point.x, point.y, width, height)
  };
}

function upsertMapLibreMarker(record, place, liveKeys) {
  const data = mapMarkerData(place);
  liveKeys.add(data.key);
  let entry = record.markerEntries.get(data.key);
  if (!entry) {
    const element = document.createElement("div");
    element.dataset.markerKey = data.key;
    applyMapLibreMarkerData(element, data);
    const marker = new maplibregl.Marker({
      element,
      anchor: "bottom"
    })
      .setLngLat([Number(place.longitude), Number(place.latitude)])
      .addTo(record.map);
    entry = { marker, element, signature: "" };
    record.markerEntries.set(data.key, entry);
  } else {
    entry.marker.setLngLat([Number(place.longitude), Number(place.latitude)]);
  }

  if (entry.signature !== data.signature) {
    applyMapLibreMarkerData(entry.element, data);
    entry.signature = data.signature;
  }
}

function applyMapLibreMarkerData(element, data) {
  const preserved = Array.from(element.classList)
    .filter((className) => className === "nearcast-gl-marker" || className.startsWith("maplibregl-"));
  element.className = [data.className, "nearcast-gl-marker", ...preserved].join(" ");
  if (data.tempText || data.impactText) element.innerHTML = data.content;
  else element.textContent = data.name;
}

function clearMapLibreMarkers(record) {
  if (!record?.markerEntries) return;
  record.markerEntries.forEach((entry) => entry.marker.remove());
  record.markerEntries.clear();
  syncMapLibreDiagnosticReadout(record);
}

function radarQualityDiagnosticStats(record = null) {
  const frame = mapState.frames[mapState.frameIndex] || null;
  const currentZoom = Number.isFinite(Number(mapState.zoom)) ? Number(mapState.zoom) : null;
  const frameMinZoom = frame ? weatherFrameMinZoom(frame) : null;
  const frameMaxZoom = frame ? weatherFrameMaxZoom(frame) : null;
  const frameSourceZoom = frame ? weatherFrameSourceZoom(frame) : null;
  const selection = mapState.generatedRadarIndexSelection || null;
  const capability = mapState.radarCapability || null;
  const selected = selection?.selected || capability?.enhanced?.quality || null;
  const enhanced = mapState.radarCapability?.enhanced || {};
  const metrics = selected?.metrics || enhanced.metrics || null;
  const score = selected?.score || enhanced.score || null;
  const coverage = score?.coverage || null;
  const viewportGate = score?.viewportGate || score?.viewportEligibility || null;
  const selectedMinZoom = diagnosticFiniteNumber(selected?.minZoom ?? enhanced.minZoom ?? viewportGate?.minZoom);
  const selectedMaxZoom = diagnosticFiniteNumber(selected?.maxZoom ?? enhanced.maxZoom ?? viewportGate?.maxZoom);
  const maxClientOverzoom = diagnosticFiniteNumber(
    selected?.maxClientOverzoom ??
    enhanced.maxClientOverzoom ??
    viewportGate?.maxClientOverzoom ??
    frame?.maxClientOverzoom
  );
  const sourceZoom = selectedMaxZoom ?? frameSourceZoom;
  const overzoom = Number.isFinite(currentZoom) && Number.isFinite(sourceZoom)
    ? Math.max(0, currentZoom - sourceZoom)
    : (Number.isFinite(frameSourceZoom) ? weatherOverzoomAmount(frameSourceZoom) : null);
  const renderer = frame?.dataUrl ? "encoded-radar" : (frame?.provider === "mrms-generated" ? "generated-radar" : activeMapSource(frame));
  const frameTime = diagnosticIsoString(frame?.time || frame?.validTime || frame?.sourceObject?.observedAt || "");
  const generatedAt = diagnosticIsoString(selected?.generatedAt || enhanced.generatedAt || capability?.checkedAt || "");
  const sourceTime = frameTime || generatedAt;
  const expiresAt = diagnosticIsoString(selected?.expiresAt || enhanced.expiresAt || "");
  const checkedAt = diagnosticIsoString(capability?.checkedAt || selection?.at || "");
  return {
    renderer: renderer || enhanced.kind || "",
    selectionSource: enhanced.selectionSource || (selection?.selected ? "index" : ""),
    state: enhanced.state || (selected ? "ready" : "unavailable"),
    reason: enhanced.reason || selection?.reason || "",
    generationState: capability?.generation?.state || "",
    generationReason: capability?.generation?.reason || "",
    packId: selected?.id || enhanced.packId || "",
    label: selected?.label || enhanced.label || "",
    currentZoom: roundedDiagnosticNumber(currentZoom, 2),
    frameMinZoom,
    frameMaxZoom,
    selectedMinZoom,
    selectedMaxZoom,
    sourceZoom,
    overzoom: roundedDiagnosticNumber(overzoom, 2),
    maxClientOverzoom: roundedDiagnosticNumber(maxClientOverzoom, 2),
    coverageBounds: selected?.coverageBounds || enhanced.coverageBounds || null,
    score,
    viewportGate,
    metrics,
    packCount: selection?.packCount ?? enhanced.packCount ?? null,
    freshPackCount: selection?.freshPackCount ?? enhanced.freshPackCount ?? null,
    rejectedPackCount: selection?.rejectedPackCount ?? null,
    candidateCount: Array.isArray(selection?.candidates) ? selection.candidates.length : 0,
    visibleWeatherEntries: [...(record?.weatherEntries?.values?.() || [])].filter((entry) => entry.visible).length,
    indexUrl: enhanced.indexUrl || selection?.indexUrl || "",
    manifestUrl: enhanced.manifestUrl || selected?.manifestUrl || mapState.generatedRadarManifestUrl || "",
    frameTime,
    generatedAt,
    sourceTime,
    checkedAt,
    expiresAt,
    frameAgeMinutes: diagnosticMinutesSince(sourceTime),
    expiresInMinutes: diagnosticMinutesUntil(expiresAt),
    coverageValue: coverage ? roundedDiagnosticNumber(coverage.value, 3) : null,
    viewportOverlap: coverage ? roundedDiagnosticNumber(coverage.viewportOverlap, 3) : null
  };
}

function diagnosticFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedDiagnosticNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** Math.max(0, digits);
  return Math.round(number * factor) / factor;
}

function diagnosticIsoString(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function diagnosticMinutesSince(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  return roundedDiagnosticNumber((Date.now() - timestamp) / 60000, 1);
}

function diagnosticMinutesUntil(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  return roundedDiagnosticNumber((timestamp - Date.now()) / 60000, 1);
}

function diagnosticMinuteLabel(value, suffix) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return "";
  const absolute = Math.abs(minutes);
  const amount = absolute < 1 ? "<1m" : absolute < 90 ? `${Math.round(absolute)}m` : `${roundedDiagnosticNumber(absolute / 60, 1)}h`;
  return `${amount} ${suffix}`;
}

function diagnosticClockLabel(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(11, 16) + "Z";
}

function radarQualityDiagnosticLine(quality) {
  if (!quality) return "";
  const pack = quality.packId ? `pack ${shortDiagnosticId(quality.packId)}` : (quality.selectionSource || quality.renderer || "radar");
  const minZoom = Number.isFinite(quality.selectedMinZoom) ? quality.selectedMinZoom : quality.frameMinZoom;
  const maxZoom = Number.isFinite(quality.selectedMaxZoom) ? quality.selectedMaxZoom : quality.frameMaxZoom;
  const band = Number.isFinite(minZoom) && Number.isFinite(maxZoom)
    ? `z${minZoom}-${maxZoom}`
    : "z--";
  const source = Number.isFinite(quality.sourceZoom) ? `source z${quality.sourceZoom}` : "source z--";
  const overzoom = Number.isFinite(quality.overzoom) ? `over ${quality.overzoom.toFixed(1)}` : "over --";
  const maxOver = Number.isFinite(quality.maxClientOverzoom) ? `max ${quality.maxClientOverzoom.toFixed(1)}` : "max --";
  return `quality ${quality.state || "unknown"} · ${pack} · ${band} · ${source} · ${overzoom}/${maxOver}`;
}

function radarRouteDiagnosticLine(quality) {
  if (!quality) return "";
  const route = quality.selectionSource || quality.renderer || "fallback";
  const reason = quality.reason || quality.generationReason || "no-reason";
  const generation = quality.generationState && !["not-needed", "not-requested"].includes(quality.generationState)
    ? `generation ${quality.generationState}`
    : "";
  const index = quality.indexUrl ? `index ${shortDiagnosticUrl(quality.indexUrl)}` : "";
  return ["route", route, reason, generation, index].filter(Boolean).join(" · ");
}

function radarFreshnessDiagnosticLine(quality) {
  if (!quality) return "";
  const sourceClock = diagnosticClockLabel(quality.sourceTime);
  const age = diagnosticMinuteLabel(quality.frameAgeMinutes, "old");
  const expires = Number.isFinite(Number(quality.expiresInMinutes))
    ? Number(quality.expiresInMinutes) < 0
      ? diagnosticMinuteLabel(quality.expiresInMinutes, "expired")
      : diagnosticMinuteLabel(quality.expiresInMinutes, "left")
    : "";
  const checked = diagnosticClockLabel(quality.checkedAt);
  const pieces = [];
  if (sourceClock || age) pieces.push(`frame ${[sourceClock, age].filter(Boolean).join(" ")}`);
  if (expires) pieces.push(`expires ${expires}`);
  if (checked) pieces.push(`checked ${checked}`);
  return pieces.length ? `freshness ${pieces.join(" · ")}` : "";
}

function radarCostDiagnosticLine(quality) {
  if (!quality) return "";
  const metrics = quality.metrics || {};
  const generatedTiles = Number(metrics.generatedTiles || metrics.radarTiles || 0);
  const dataTiles = Number(metrics.dataTiles || 0);
  const candidateTiles = Number(metrics.candidateTiles || 0);
  const candidateText = Number.isFinite(Number(quality.freshPackCount)) && Number.isFinite(Number(quality.packCount))
    ? `packs ${quality.freshPackCount}/${quality.packCount}`
    : `packs ${quality.candidateCount || 0}`;
  const overlap = Number.isFinite(Number(quality.viewportOverlap))
    ? `overlap ${Math.round(Number(quality.viewportOverlap) * 100)}%`
    : "overlap --";
  const tiles = candidateTiles ? `${generatedTiles || "--"}/${candidateTiles}` : `${generatedTiles || "--"}`;
  return `${candidateText} · tiles ${tiles} · data ${dataTiles || "--"} · ${overlap}`;
}

function shortDiagnosticId(value) {
  const text = String(value || "");
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function shortDiagnosticUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, window.location?.href || "https://getnearcast.app/");
    const parts = url.pathname.split("/").filter(Boolean);
    return [url.hostname, ...parts.slice(-3)].join("/");
  } catch {
    return shortDiagnosticId(text);
  }
}

function mapLibreDiagnosticStats(record) {
  const entries = [...(record?.weatherEntries?.values?.() || [])];
  const style = record?.map?.getStyle?.();
  return {
    loaded: Boolean(record?.loaded),
    rendered: Boolean(record?.rendered),
    mode: mapDiagnosticMode(),
    fps: Math.round(record?.diagnosticGlFps || 0),
    glFps: Math.round(record?.diagnosticGlFps || 0),
    uiFps: Math.round(record?.diagnosticUiFps || 0),
    movesPerSecond: Math.round(record?.diagnosticMovesPerSecond || 0),
    tilesLoaded: record?.map?.areTilesLoaded?.() || false,
    weatherEntries: entries.length,
    visibleWeatherEntries: entries.filter((entry) => entry.visible).length,
    markers: record?.markerEntries?.size || 0,
    layers: style?.layers?.length || 0,
    sources: Object.keys(style?.sources || {}).length,
    zoom: Number(mapState.zoom?.toFixed ? mapState.zoom.toFixed(2) : mapState.zoom),
    immersive: Boolean(mapState.immersive),
    radarChunks: radarChunkDiagnosticsSnapshot(record),
    radarQuality: radarQualityDiagnosticStats(record),
    xweatherStorm: xweatherStormDiagnosticsSnapshot(record),
    lastError: record?.lastError || ""
  };
}

function radarSourceZoomOverride() {
  const value = String(state?.radarSourceZoom || "auto");
  if (value === "10" || value === "12") return Number(value);
  return null;
}

function radarSourceZoomLabel() {
  if (!radarSourceZoomOverride()) {
    return radarProviderAllowsGenerated() ? "Radar experimental MRMS" : "Radar auto";
  }
  return `Radar z${radarSourceZoomOverride() || RADAR_TILE_MAX_ZOOM}`;
}

function ensureMapLibreDiagnosticReadout(record) {
  const container = record?.container;
  if (!container) return null;
  let readout = container.querySelector(":scope > .map-diagnostic-readout");
  if (!readout) {
    readout = document.createElement("div");
    readout.className = "map-diagnostic-readout";
    readout.setAttribute("aria-hidden", "true");
    container.appendChild(readout);
  }
  return readout;
}

function syncMapLibreDiagnosticReadout(record) {
  if (!record?.container) return;
  record.container.dataset.mapDiagnosticMode = mapDiagnosticMode();
  const active = mapDiagnosticIsActive();
  const readout = record.container.querySelector(":scope > .map-diagnostic-readout");
  if (!active) {
    readout?.remove();
    stopMapLibreDiagnosticRaf(record);
    return;
  }
  ensureMapLibreDiagnosticRaf(record);
  const stats = mapLibreDiagnosticStats(record);
  const nextReadout = ensureMapLibreDiagnosticReadout(record);
  if (!nextReadout) return;
  const uiFps = stats.uiFps ? `ui ${stats.uiFps}` : "ui warming";
  const glFps = stats.glFps ? `gl ${stats.glFps}` : "gl warming";
  const loaded = stats.tilesLoaded ? "tiles ready" : "tiles loading";
  const radarQuality = radarQualityDiagnosticLine(stats.radarQuality);
  const radarRoute = radarRouteDiagnosticLine(stats.radarQuality);
  const radarFreshness = radarFreshnessDiagnosticLine(stats.radarQuality);
  const radarCost = radarCostDiagnosticLine(stats.radarQuality);
  const radarChunks = radarChunkDiagnosticLine(stats.radarChunks);
  const xweatherStorm = xweatherStormDiagnosticLine(stats.xweatherStorm);
  nextReadout.innerHTML = `
    <strong>${escapeHtml(mapDiagnosticModeLabel())}</strong>
    <span>${escapeHtml(uiFps)} fps · ${escapeHtml(glFps)} fps · moves ${stats.movesPerSecond}/s</span>
    <span>radar ${stats.visibleWeatherEntries}/${stats.weatherEntries} · places ${stats.markers} · z${escapeHtml(String(stats.zoom))} · ${escapeHtml(radarSourceZoomLabel())}</span>
    ${xweatherStorm ? `<span>${escapeHtml(xweatherStorm)}</span>` : ""}
    ${radarChunks ? `<span>${escapeHtml(radarChunks)}</span>` : ""}
    ${radarQuality ? `<span>${escapeHtml(radarQuality)}</span>` : ""}
    ${radarRoute ? `<span>${escapeHtml(radarRoute)}</span>` : ""}
    ${radarFreshness ? `<span>${escapeHtml(radarFreshness)}</span>` : ""}
    ${radarCost ? `<span>${escapeHtml(radarCost)}</span>` : ""}
    <span>layers ${stats.layers} · sources ${stats.sources} · ${escapeHtml(loaded)}</span>
`;
}

function xweatherStormDiagnosticLine(storm) {
  if (!storm?.enabled && storm?.status === "off") return "";
  const active = storm?.active ? "active" : storm?.status || "off";
  const layers = (storm?.layers || []).join("+");
  const usage = Number.isFinite(Number(storm?.estimatedAccesses)) ? ` · est ${storm.estimatedAccesses}/${XWEATHER_MONTHLY_ACCESS_LIMIT}` : "";
  const detail = storm?.message && storm.status !== "active" ? ` · ${storm.message}` : "";
  return `storm view ${active}${layers ? ` · ${layers}` : ""}${usage}${detail}`;
}

function radarChunkDiagnosticLine(chunks) {
  if (!chunks?.enabled) return "";
  const levels = (chunks.levels || []).map((level) => `z${level.zoom}:${level.chunkCount}`).join(" ");
  const rendered = Number.isFinite(Number(chunks.renderedChunks)) ? chunks.renderedChunks : "--";
  const loaded = Number.isFinite(Number(chunks.loadedChunks)) ? chunks.loadedChunks : "--";
  const loading = Number.isFinite(Number(chunks.loadingChunks)) && Number(chunks.loadingChunks) > 0 ? `+${chunks.loadingChunks}` : "";
  const active = chunks.activeZoom == null ? "--" : `z${chunks.activeZoom}`;
  const reason = chunks.error || chunks.glError ? ` · ${chunks.error || chunks.glError}` : "";
  return `chunks ${chunks.state || "idle"} · ${active} · visible ${rendered} · loaded ${loaded}${loading}${levels ? ` · ${levels}` : ""}${reason}`;
}

function syncMapZoomDebugReadout() {
  document.querySelectorAll(".map-zoom-debug").forEach((node) => {
    if (node.parentElement !== els.weatherMap) node.remove();
  });
  if (!els.weatherMap || !mapState.initialized || !state.activePlace) return;
  let readout = els.weatherMap.querySelector(":scope > .map-zoom-debug");
  if (!readout) {
    readout = document.createElement("div");
    readout.className = "map-zoom-debug";
    readout.setAttribute("aria-hidden", "true");
    els.weatherMap.appendChild(readout);
  }
  const zoom = Number(mapState.zoom);
  readout.textContent = `Zoom ${Number.isFinite(zoom) ? zoom.toFixed(2) : "--"} · ${radarSourceZoomLabel()}`;
}

function ensureMapLibreDiagnosticRaf(record) {
  if (!record || record.diagnosticRaf) return;
  record.diagnosticUiWindowStart = performance.now();
  record.diagnosticUiFrameCount = 0;
  record.diagnosticMoveWindowStart = performance.now();
  record.diagnosticMoveCount = 0;
  const tick = (now) => {
    if (!record.container?.isConnected || !mapDiagnosticIsActive()) {
      record.diagnosticRaf = 0;
      return;
    }
    record.diagnosticUiFrameCount = (record.diagnosticUiFrameCount || 0) + 1;
    const elapsed = now - (record.diagnosticUiWindowStart || now);
    if (elapsed >= 650) {
      record.diagnosticUiFps = record.diagnosticUiFrameCount * 1000 / elapsed;
      record.diagnosticUiWindowStart = now;
      record.diagnosticUiFrameCount = 0;

      const moveElapsed = now - (record.diagnosticMoveWindowStart || now);
      if (moveElapsed > 0) record.diagnosticMovesPerSecond = (record.diagnosticMoveCount || 0) * 1000 / moveElapsed;
      record.diagnosticMoveWindowStart = now;
      record.diagnosticMoveCount = 0;
      syncMapLibreDiagnosticReadout(record);
    }
    record.diagnosticRaf = requestAnimationFrame(tick);
  };
  record.diagnosticRaf = requestAnimationFrame(tick);
}

function stopMapLibreDiagnosticRaf(record) {
  if (!record?.diagnosticRaf) return;
  cancelAnimationFrame(record.diagnosticRaf);
  record.diagnosticRaf = 0;
}

function countMapLibreDiagnosticMove(record) {
  if (!record || (!mapDiagnosticIsActive() && !perfState.enabled)) return;
  record.diagnosticMoveCount = (record.diagnosticMoveCount || 0) + 1;
}

function recordMapLibreRenderFrame(record) {
  if (!record || (!mapDiagnosticIsActive() && !perfState.enabled)) return;
  const now = performance.now();
  record.diagnosticGlFrameCount = (record.diagnosticGlFrameCount || 0) + 1;
  if (!record.diagnosticGlWindowStart) {
    record.diagnosticGlWindowStart = now;
    record.diagnosticGlFrameCount = 0;
    return;
  }
  const elapsed = now - record.diagnosticGlWindowStart;
  if (elapsed < 650) return;
  record.diagnosticGlFps = record.diagnosticGlFrameCount * 1000 / elapsed;
  record.diagnosticGlWindowStart = now;
  record.diagnosticGlFrameCount = 0;
  syncMapLibreDiagnosticReadout(record);
  if (perfState.enabled) {
    const stats = mapLibreDiagnosticStats(record);
    perfRecord("map", "maplibre-render", 0, stats, 0);
  }
}

function applyMapDiagnosticModePreference() {
  updateMapDiagnosticModeControl?.();
  mapLibreRecords.forEach((record) => {
    record.diagnosticGlFrameCount = 0;
    record.diagnosticGlWindowStart = 0;
    record.diagnosticGlFps = 0;
    record.diagnosticUiFrameCount = 0;
    record.diagnosticUiWindowStart = 0;
    record.diagnosticUiFps = 0;
    record.diagnosticMoveCount = 0;
    record.diagnosticMovesPerSecond = 0;
    clearMapLibreWeatherRecord(record);
    clearMapLibreMarkers(record);
    syncMapLibreBaseLayerVisibility(record);
    syncMapLibreDiagnosticReadout(record);
  });
  if (!mapState.initialized || !state.activePlace) return;
  if (mapRendererIsGl()) {
    renderTileMap();
    if (mapState.frames.length) showFrame(mapState.frameIndex);
  }
}

function applyRadarSourceZoomPreference() {
  clearMapLibreWeather();
  if (!mapState.initialized || !state.activePlace) return;
  renderMapLegend();
  renderTileMap();
  if (mapState.frames.length) showFrame(mapState.frameIndex);
  syncMapZoomDebugReadout();
}

function applyRadarProviderPreference() {
  clearMapLibreWeather();
  if (!mapState.initialized || !state.activePlace) return;
  renderMapLegend();
  const timelineKind = mapState.immersive
    ? "precip"
    : mapState.timelineKind === "forecast" ? "forecast" : "radar";
  if (timelineKind === "forecast") {
    renderTileMap();
    if (mapState.frames.length) showFrame(mapState.frameIndex);
    return;
  }
  loadMapFrames(true, {
    timelineKind,
    focusNow: timelineKind === "precip",
    focusLatest: timelineKind === "radar",
    resumePlayback: mapState.playing
  });
}

function scheduleGeneratedRadarViewportRefresh(reason = "viewport", delayMs = GENERATED_RADAR_REFRESH_DEBOUNCE_MS) {
  if (!shouldRefreshGeneratedRadarForViewport()) return;
  if (mapState.generatedRadarRefreshTimer) clearTimeout(mapState.generatedRadarRefreshTimer);
  const delay = Math.max(0, Number(delayMs) || 0);
  mapState.generatedRadarRefreshTimer = setTimeout(() => {
    mapState.generatedRadarRefreshTimer = 0;
    refreshGeneratedRadarForViewport(reason);
  }, delay);
}

function shouldRefreshGeneratedRadarForViewport() {
  if (!mapState.initialized || !state.activePlace) return false;
  if (!generatedRadarRefreshTimelineKind()) return false;
  if (!radarProviderAllowsGenerated()) return false;
  if (generatedMrmsManifestUrlOverride()) return false;
  return true;
}

function generatedRadarViewportAllowsGenerationRequest() {
  const zoom = Number(mapState.zoom);
  return !Number.isFinite(zoom) || zoom + GENERATED_RADAR_MIN_ZOOM_GRACE >= GENERATED_RADAR_GENERATION_MIN_ZOOM;
}

function generatedRadarRefreshTimelineKind() {
  if (mapState.timelineKind === "radar") return "radar";
  if (mapState.timelineKind === "precip") return "precip";
  if (mapState.immersive) return "precip";
  return "";
}

function generatedRadarRefreshOptions(timelineKind) {
  return {
    timelineKind,
    focusNow: timelineKind === "precip",
    focusLatest: timelineKind === "radar",
    resumePlayback: mapState.playing,
    preserveExisting: true
  };
}

function currentRadarFramesAreGenerated() {
  return (mapState.frames || []).some((frame) =>
    frame?.source !== "forecast" && frame?.provider === "mrms-generated"
  );
}

function maybeSwitchGeneratedRadarToFallback(index = mapState.frameIndex, reason = "generated-viewport-out-of-scope") {
  const frame = mapState.frames[index];
  const eligibility = generatedRadarFrameViewportEligibility(frame);
  if (!eligibility || eligibility.usable) return false;

  if (generatedRadarFallbackReloadTimer) return true;
  const timelineKind = mapState.timelineKind === "precip" ? "precip" : "radar";
  const shouldResumePlayback = Boolean(mapState.playing);
  recordRadarSourceDecision("radar.enhanced-fallback-viewport", {
    reason,
    eligibility: generatedRadarViewportEligibilityDiagnostic(eligibility)
  });

  clearGeneratedRadarSelection();
  clearGeneratedRadarWarmup();
  clearMapLayers({ renderStatic: false });
  setFrameLabel("Loading radar");
  setMapLoading(true);

  generatedRadarFallbackReloadTimer = setTimeout(() => {
    generatedRadarFallbackReloadTimer = 0;
    loadMapFrames(true, {
      ...generatedRadarRefreshOptions(timelineKind),
      preserveExisting: false,
      resumePlayback: shouldResumePlayback
    }).catch((error) => {
      recordRadarSourceDecision("radar.fallback-reload-failed", {
        reason: radarDecisionErrorMessage(error)
      });
    });
  }, GENERATED_RADAR_FALLBACK_RELOAD_MS);
  return true;
}

async function refreshGeneratedRadarForViewport(reason = "viewport") {
  if (!shouldRefreshGeneratedRadarForViewport()) return;
  const timelineKind = generatedRadarRefreshTimelineKind();
  if (!timelineKind) return;
  const viewportKey = generatedRadarViewportKey();
  if (viewportKey && viewportKey === mapState.generatedRadarViewportKey) {
    finishGeneratedRadarWarmup(viewportKey, "already-ready");
    return;
  }
  const seq = ++mapState.generatedRadarRefreshSeq;
  const warmup = beginGeneratedRadarWarmup(viewportKey, reason);
  try {
    const requestGeneration = generatedRadarViewportAllowsGenerationRequest();
    const selection = await resolveGeneratedMrmsManifestSelection({
      allowLegacy: false,
      requestGeneration,
      reason
    });
    if (seq !== mapState.generatedRadarRefreshSeq) return;
    const capability = selection?.capability || mapState.radarCapability || null;
    if (!selection?.key) {
      if (generatedRadarGenerationIsPending(capability)) {
        if (radarProviderPreference() === "auto" && mapState.generatedRadarSelectionKey && viewportKey !== mapState.generatedRadarViewportKey) {
          clearGeneratedRadarSelection();
          await loadMapFrames(true, generatedRadarRefreshOptions(timelineKind));
        }
        scheduleGeneratedRadarWarmupPoll(capability, warmup, viewportKey, reason);
        return;
      }
      if (capability?.generation?.state) {
        recordRadarSourceDecision("radar.generation-not-started", {
          generationState: capability.generation.state || "",
          generationReason: capability.generation.reason || "",
          generationMode: capability.generation.mode || "",
          retryAfterSeconds: capability.generation.retryAfterSeconds ?? null
        });
      }
      if (radarProviderPreference() === "auto" && mapState.generatedRadarSelectionKey) {
        clearGeneratedRadarSelection();
        await loadMapFrames(true, generatedRadarRefreshOptions(timelineKind));
      }
      clearGeneratedRadarWarmup();
      return;
    }
    if (selection.key === mapState.generatedRadarSelectionKey && currentRadarFramesAreGenerated()) {
      mapState.generatedRadarViewportKey = viewportKey;
      finishGeneratedRadarWarmup(viewportKey, "selection-current");
      return;
    }
    rememberGeneratedRadarSelectionHint(selection, viewportKey);
    await loadMapFrames(true, generatedRadarRefreshOptions(timelineKind));
    if (selection.key === mapState.generatedRadarSelectionKey) {
      finishGeneratedRadarWarmup(viewportKey, "selection-loaded");
    } else {
      recordRadarSourceDecision("radar.generation-ready-promotion-missed", {
        selectionKey: selection.key || "",
        manifestUrl: selection.manifestUrl || "",
        activeSelectionKey: mapState.generatedRadarSelectionKey || ""
      });
      clearGeneratedRadarWarmup();
    }
  } catch {
    if (radarProviderPreference() === "auto") {
      clearGeneratedRadarSelection();
      await loadMapFrames(true, generatedRadarRefreshOptions(timelineKind));
    }
    clearGeneratedRadarWarmup();
  }
}

function beginGeneratedRadarWarmup(viewportKey, reason = "viewport") {
  const current = generatedRadarWarmupState();
  const now = Date.now();
  const sameViewport = current.viewportKey && current.viewportKey === viewportKey && generatedRadarWarmupIsActive(current);
  const startedAt = sameViewport && Number.isFinite(Number(current.startedAt)) ? Number(current.startedAt) : now;
  return setGeneratedRadarWarmup({
    state: "checking",
    viewportKey,
    reason,
    requestId: sameViewport ? current.requestId : "",
    dedupeKey: sameViewport ? current.dedupeKey : "",
    attempts: (sameViewport ? Number(current.attempts) || 0 : 0) + 1,
    startedAt,
    updatedAt: now,
    timeoutAt: startedAt + GENERATED_RADAR_POLL_MAX_MS
  });
}

function scheduleGeneratedRadarWarmupPoll(capability, warmup, viewportKey, reason = "generation-poll") {
  const generation = capability?.generation || {};
  const now = Date.now();
  const startedAt = Number(warmup?.startedAt) || now;
  const timeoutAt = Number(warmup?.timeoutAt) || startedAt + GENERATED_RADAR_POLL_MAX_MS;
  if (now >= timeoutAt) {
    recordRadarSourceDecision("radar.generation-poll-timeout", {
      generationState: generation.state || "",
      requestId: generation.requestId || "",
      dedupeKey: generation.dedupeKey || "",
      viewportKey
    });
    clearGeneratedRadarWarmup();
    return;
  }

  const attempts = Math.max(1, Number(warmup?.attempts) || 1);
  const advisedDelay = Number(generation.nextPollAfterSeconds) * 1000;
  const baseDelay = Number.isFinite(advisedDelay) && advisedDelay > 0
    ? advisedDelay
    : attempts <= 1 ? GENERATED_RADAR_POLL_INITIAL_MS : GENERATED_RADAR_POLL_INTERVAL_MS;
  const delay = Math.max(1200, Math.min(baseDelay, timeoutAt - now));
  setGeneratedRadarWarmup({
    ...warmup,
    state: generation.state === "deduped" ? "deduped" : "queued",
    viewportKey,
    requestId: generation.requestId || warmup?.requestId || "",
    dedupeKey: generation.dedupeKey || warmup?.dedupeKey || "",
    reason: reason || generation.reason || "generation-poll",
    updatedAt: now,
    timeoutAt
  });
  scheduleGeneratedRadarViewportRefresh("generation-poll", delay);
}

function finishGeneratedRadarWarmup(viewportKey, reason = "ready") {
  const current = generatedRadarWarmupState();
  if (!generatedRadarWarmupIsActive(current) && current.state !== "ready") return;
  setGeneratedRadarWarmup({
    ...current,
    state: "ready",
    viewportKey: viewportKey || current.viewportKey || "",
    reason,
    updatedAt: Date.now()
  });
  if (mapState.generatedRadarStatusHideTimer) clearTimeout(mapState.generatedRadarStatusHideTimer);
  const readyViewportKey = viewportKey || current.viewportKey || "";
  mapState.generatedRadarStatusHideTimer = setTimeout(() => {
    mapState.generatedRadarStatusHideTimer = 0;
    const latest = generatedRadarWarmupState();
    if (latest.state === "ready" && (!readyViewportKey || latest.viewportKey === readyViewportKey)) {
      clearGeneratedRadarWarmup();
    }
  }, GENERATED_RADAR_READY_STATUS_MS);
}

function generatedRadarWarmupState() {
  if (!mapState.generatedRadarWarmup || typeof mapState.generatedRadarWarmup !== "object") {
    mapState.generatedRadarWarmup = {
      state: "idle",
      viewportKey: "",
      requestId: "",
      dedupeKey: "",
      reason: "",
      attempts: 0,
      startedAt: 0,
      updatedAt: 0,
      timeoutAt: 0
    };
  }
  return mapState.generatedRadarWarmup;
}

function setGeneratedRadarWarmup(next = {}) {
  const current = generatedRadarWarmupState();
  mapState.generatedRadarWarmup = {
    state: generatedRadarWarmupValue(next, current, "state", "idle"),
    viewportKey: generatedRadarWarmupValue(next, current, "viewportKey", ""),
    requestId: generatedRadarWarmupValue(next, current, "requestId", ""),
    dedupeKey: generatedRadarWarmupValue(next, current, "dedupeKey", ""),
    reason: generatedRadarWarmupValue(next, current, "reason", ""),
    attempts: Number.isFinite(Number(next.attempts)) ? Number(next.attempts) : Number(current.attempts) || 0,
    startedAt: Number.isFinite(Number(next.startedAt)) ? Number(next.startedAt) : Number(current.startedAt) || 0,
    updatedAt: Number.isFinite(Number(next.updatedAt)) ? Number(next.updatedAt) : Date.now(),
    timeoutAt: Number.isFinite(Number(next.timeoutAt)) ? Number(next.timeoutAt) : Number(current.timeoutAt) || 0
  };
  syncGeneratedRadarStatusChip();
  return mapState.generatedRadarWarmup;
}

function generatedRadarWarmupValue(next, current, key, fallback) {
  return Object.prototype.hasOwnProperty.call(next, key) ? next[key] || fallback : current[key] || fallback;
}

function clearGeneratedRadarWarmup() {
  if (mapState.generatedRadarStatusHideTimer) {
    clearTimeout(mapState.generatedRadarStatusHideTimer);
    mapState.generatedRadarStatusHideTimer = 0;
  }
  mapState.generatedRadarWarmup = {
    state: "idle",
    viewportKey: "",
    requestId: "",
    dedupeKey: "",
    reason: "",
    attempts: 0,
    startedAt: 0,
    updatedAt: Date.now(),
    timeoutAt: 0
  };
  syncGeneratedRadarStatusChip();
}

function generatedRadarWarmupIsActive(warmup = generatedRadarWarmupState()) {
  return ["checking", "queued", "deduped"].includes(warmup?.state);
}

function generatedRadarGenerationIsPending(capability) {
  return ["queued", "deduped"].includes(capability?.generation?.state);
}

function maybeScheduleGeneratedRadarWarmup(reason = "fallback-visible") {
  if (!shouldRefreshGeneratedRadarForViewport()) return;
  const warmup = generatedRadarWarmupState();
  const viewportKey = generatedRadarViewportKey();
  if (generatedRadarWarmupIsActive(warmup) && warmup.viewportKey === viewportKey) return;
  scheduleGeneratedRadarViewportRefresh(reason);
}

function ensureGeneratedRadarStatusChip() {
  if (!els.weatherMap) return null;
  const existing = Array.from(els.weatherMap.children || []).find((child) => child.classList?.contains("map-radar-status"));
  if (existing) return existing;
  const chip = document.createElement("div");
  chip.className = "map-radar-status";
  chip.setAttribute("role", "status");
  chip.setAttribute("aria-live", "polite");
  chip.hidden = true;
  els.weatherMap.appendChild(chip);
  return chip;
}

function syncGeneratedRadarStatusChip() {
  const chip = ensureGeneratedRadarStatusChip();
  if (!chip) return;
  const stormStatus = xweatherStormStatusForChip();
  if (stormStatus.visible) {
    chip.hidden = false;
    chip.classList.toggle("is-ready", Boolean(stormStatus.ready));
    chip.classList.toggle("is-storm-view", true);
    chip.textContent = stormStatus.text || "Storm view";
    return;
  }
  chip.classList.remove("is-storm-view");
  const warmup = generatedRadarWarmupState();
  const visible = generatedRadarWarmupIsActive(warmup) || warmup.state === "ready";
  chip.hidden = !visible;
  chip.classList.toggle("is-ready", warmup.state === "ready");
  if (!visible) {
    chip.textContent = "";
    return;
  }
  if (warmup.state === "ready") chip.textContent = "Radar enhanced";
  else if (warmup.state === "checking") chip.textContent = "Checking radar";
  else chip.textContent = "Enhancing radar";
}

function resetMapForPlaceChange(options = {}) {
  mapState.panX = 0;
  mapState.panY = 0;
  clearGeneratedRadarSelection();
  clearGeneratedRadarWarmup();
  mapState.generatedRadarRefreshSeq += 1;
  if (mapState.generatedRadarRefreshTimer) {
    clearTimeout(mapState.generatedRadarRefreshTimer);
    mapState.generatedRadarRefreshTimer = 0;
  }
  if (generatedRadarFallbackReloadTimer) {
    clearTimeout(generatedRadarFallbackReloadTimer);
    generatedRadarFallbackReloadTimer = 0;
  }
  if (!mapState.initialized || !state.activePlace) return;
  clearMapLibreInteractionState();
  if (options.clearFrames !== false) clearMapLayers({ renderStatic: false });
  mapLibreRecords.forEach((record) => {
    record.placeKey = "";
    syncMapLibreCamera(record, { force: true });
  });
  renderMapLegend();
  renderTileMap();
}

function ensureMapLibreMap() {
  if (!mapRendererIsGl() || !els.weatherMap || !state.activePlace) return null;
  const container = els.weatherMap;
  container.classList.add("is-gl-renderer");
  clearClassicLayersForMapLibre();
  syncMapLibrePreviewHitbox(container);
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  let record = mapLibreRecords.get(container);
  if (record && record.theme !== theme) {
    destroyMapLibreRecord(container);
    record = null;
  }
  if (record) {
    record.map.resize();
    requestAnimationFrame(() => {
      if (mapLibreRecords.get(container) === record) record.map.resize();
    });
    return record;
  }

  const surface = ensureMapLibreSurface(container);
  const map = new maplibregl.Map({
    container: surface,
    style: mapLibreStyle(),
    center: mapLibreCenterFromState(),
    zoom: clampMapZoom(mapState.zoom),
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    interactive: mapState.immersive,
    attributionControl: false,
    fadeDuration: 0,
    renderWorldCopies: true
  });
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  if (!mapState.immersive) {
    map.dragPan.disable();
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.doubleClickZoom.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disable();
  }

  record = {
    map,
    container,
    surface,
    theme,
    placeKey: "",
    loaded: false,
    rendered: false,
    fallbackTimer: 0,
    lastError: "",
    weatherEntries: new Map(),
    weatherEntrySeq: 0,
    weatherRenderSeq: 0,
    liveWeatherKeys: new Set(),
    radarChunkLayerState: null,
    markerEntries: new Map(),
    diagnosticRaf: 0,
    diagnosticGlFps: 0,
    diagnosticUiFps: 0,
    diagnosticMovesPerSecond: 0
  };
  mapLibreRecords.set(container, record);

  const markRendered = () => {
    record.rendered = true;
    if (record.fallbackTimer) {
      clearTimeout(record.fallbackTimer);
      record.fallbackTimer = 0;
    }
  };
  const markRenderedIfSourcesLoaded = () => {
    if (!record.surface?.clientWidth || !record.surface?.clientHeight) return;
    const baseLoaded = map.isSourceLoaded?.("nearcast-base") || false;
    const labelsLoaded = map.isSourceLoaded?.("nearcast-labels") || false;
    const allTilesLoaded = map.areTilesLoaded?.() || false;
    if (baseLoaded || labelsLoaded || allTilesLoaded) markRendered();
  };

  map.on("load", () => {
    record.loaded = true;
    syncMapLibreCamera(record, { force: true });
    renderMapLibreOverlays();
    syncMapLibreRadarChunkLayer(record);
    markRenderedIfSourcesLoaded();
    requestAnimationFrame(() => {
      if (mapLibreRecords.get(container) !== record) return;
      map.resize();
      renderMapLibreOverlays({ forceRadar: true });
      syncMapLibreRadarChunkLayer(record);
      map.triggerRepaint?.();
      markRenderedIfSourcesLoaded();
    });
  });
  map.on("idle", () => {
    markRenderedIfSourcesLoaded();
    if (mapLibreRecords.get(container) === record && state.mapRenderer === "gl") {
      syncMapLibreRadarChunkLayer(record);
      renderMapLibreMarkers(record);
    }
  });
  map.on("sourcedata", (event) => {
    if (event.sourceId === "nearcast-base" || event.sourceId === "nearcast-labels") {
      markRenderedIfSourcesLoaded();
    }
  });
  map.on("error", (event) => {
    record.lastError = event?.error?.message || event?.message || "MapLibre source error";
  });
  map.on("render", () => recordMapLibreRenderFrame(record));
  map.on("movestart", () => beginMapLibreInteraction(map));
  map.on("zoomstart", () => beginMapLibreInteraction(map));
  map.on("move", () => {
    countMapLibreDiagnosticMove(record);
    syncMapLibreStateAndOverlays(map);
  });
  map.on("zoom", () => {
    countMapLibreDiagnosticMove(record);
    syncMapLibreStateAndOverlays(map);
  });
  map.on("moveend", () => scheduleMapLibreSettle(map));
  map.on("zoomend", () => scheduleMapLibreSettle(map));
  map.on("click", (event) => {
    if (!mapState.immersive || !event.originalEvent) return;
    syncMapLibreStateAndOverlays(map);
    inspectStormImpactAt(event.originalEvent.clientX, event.originalEvent.clientY);
  });
  map.getCanvas()?.addEventListener("webglcontextlost", () => {
    fallbackMapLibreRenderer("WebGL context was lost");
  }, { once: true });
  record.fallbackTimer = setTimeout(() => {
    if (mapLibreRecords.get(container) !== record || record.rendered || state.mapRenderer !== "gl") return;
    fallbackMapLibreRenderer(record.lastError || "WebGL map tiles did not finish loading");
  }, mapState.immersive ? MAPLIBRE_IMMERSIVE_LOAD_TIMEOUT_MS : MAPLIBRE_LOAD_TIMEOUT_MS);

  syncMapLibreDiagnosticReadout(record);
  return record;
}

function fallbackMapLibreRenderer(reason = "WebGL map unavailable") {
  if (state.mapRenderer !== "gl") return;
  console.warn(`[Nearcast] Falling back to Classic map: ${reason}`);
  state.mapRenderer = "classic";
  state.mapDiagnosticMode = "full";
  try { localStorage.setItem(MAP_DIAGNOSTIC_MODE_KEY, "full"); } catch {}
  if (typeof updateMapRendererButtons === "function") updateMapRendererButtons();
  if (typeof updateMapDiagnosticModeControl === "function") updateMapDiagnosticModeControl();
  destroyMapLibreMaps();
  renderTileMap();
  if (mapState.frames.length) showFrame(mapState.frameIndex);
}

function mapLibreRecordReady(record) {
  return Boolean(record?.loaded && record.map?.isStyleLoaded?.());
}

function mapLibreRecordReadyForMarkers(record) {
  return Boolean(record?.loaded && record.map);
}

function syncMapLibreCamera(record, options = {}) {
  if (!record?.map || !state.activePlace) return;
  const placeKey = mapLibrePlaceKey();
  if (!options.force && record.placeKey === placeKey) return;
  record.map.jumpTo({
    center: mapLibreCenterFromState(),
    zoom: clampMapZoom(mapState.zoom)
  });
  record.placeKey = placeKey;
}

function renderMapLibreMap() {
  const record = ensureMapLibreMap();
  if (!record) return;
  syncMapLibreCamera(record);
  if (!mapLibreRecordReady(record)) return;
  renderMapLibreOverlays();
  if (mapState.immersive) updateImmersiveHUD();
}

function clearMapLibreWeather() {
  mapLibreRecords.forEach((record) => {
    clearMapLibreWeatherRecord(record);
    clearMapLibreMarkers(record);
  });
}

function destroyMapLibreRecord(container) {
  const record = mapLibreRecords.get(container);
  if (!record) return;
  if (record.fallbackTimer) clearTimeout(record.fallbackTimer);
  stopMapLibreDiagnosticRaf(record);
  stopXweatherStormLayer(record, "destroy");
  removeMapLibreRadarChunkLayer(record);
  clearMapLibreWeatherRecord(record);
  clearMapLibreMarkers(record);
  container.querySelector(":scope > .map-diagnostic-readout")?.remove();
  record.map.remove();
  record.surface?.remove();
  container.querySelector(":scope > .maplibre-open-hitbox")?.remove();
  container.classList.remove("is-gl-renderer");
  container.removeAttribute("data-map-diagnostic-mode");
  mapLibreRecords.delete(container);
}

function destroyMapLibreMaps() {
  clearMapLibreInteractionState();
  [...mapLibreRecords.keys()].forEach(destroyMapLibreRecord);
  document.querySelectorAll(".tile-map.is-gl-renderer").forEach((container) => {
    container.querySelector(":scope > .maplibre-open-hitbox")?.remove();
    container.querySelector(":scope > .map-diagnostic-readout")?.remove();
    container.classList.remove("is-gl-renderer");
    container.removeAttribute("data-map-diagnostic-mode");
  });
  document.querySelectorAll(".maplibre-open-hitbox").forEach((hitbox) => hitbox.remove());
}

// Full re-tiling is capped to one render per frame so bursts of touchmove
// events can't force multiple DOM reconciliation passes before paint.
let mapRenderQueued = false;
function scheduleMapRender() {
  if (mapRenderQueued) return;
  mapRenderQueued = true;
  requestAnimationFrame(() => {
    mapRenderQueued = false;
    renderTileMap();
  });
}

function touchDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMidpoint(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  };
}

function startMapPinch(a, b) {
  if (mapRendererIsGl()) return;
  if (dragState.moved) {
    finishAnchoredMapPan({ render: true });
  }
  const mid = touchMidpoint(a, b);
  dragState.active = false;
  pinchState.active = true;
  pinchState.startDistance = touchDistance(a, b);
  pinchState.startZoom = mapState.zoom;
  pinchState.anchorX = mid.x;
  pinchState.anchorY = mid.y;
}

function moveMapPinch(a, b) {
  if (mapRendererIsGl()) return;
  if (!pinchState.active || pinchState.startDistance <= 0) return;
  const ratio = touchDistance(a, b) / pinchState.startDistance;
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const mid = touchMidpoint(a, b);
  const nextZoom = pinchState.startZoom + Math.log2(ratio);
  setMapZoom(nextZoom, mid.x, mid.y);
}

function updateMapPlace() {
  els.mapPlace.textContent = state.activePlace ? `Centered on ${placeLabel(state.activePlace)}` : "Centered on selected place";
}

function syncMapToPlace() {
  if (!mapState.initialized || !state.activePlace) return;
  renderTileMap();
}

let inlineMapRefreshObserver = null;
let inlineMapRefreshQueuedForce = false;

function mapViewNearViewport() {
  const target = document.getElementById("mapView");
  if (!target) return true;
  const rect = target.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight || 720;
  return rect.top < vh * 1.35 && rect.bottom > -vh * 0.35;
}

function queueInlineMapRefresh(forceFrames = false) {
  inlineMapRefreshQueuedForce = inlineMapRefreshQueuedForce || forceFrames;
  if (mapState.initialized && !mapState.immersive) {
    stopRadarPlayback({ renderStatic: false });
    setFrameLabel("Map updates when viewed");
  }
  const target = document.getElementById("mapView");
  if (!target || !("IntersectionObserver" in window)) {
    const force = inlineMapRefreshQueuedForce;
    inlineMapRefreshQueuedForce = false;
    refreshInlineMap(force, { defer: false });
    return;
  }
  if (inlineMapRefreshObserver) return;
  inlineMapRefreshObserver = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry?.isIntersecting) return;
    const force = inlineMapRefreshQueuedForce;
    inlineMapRefreshQueuedForce = false;
    inlineMapRefreshObserver.disconnect();
    inlineMapRefreshObserver = null;
    refreshInlineMap(force, { defer: false });
  }, { rootMargin: "520px 0px 640px", threshold: 0 });
  inlineMapRefreshObserver.observe(target);
}

function shouldDeferInlineMapRefresh(options = {}) {
  if (options.defer === false) return false;
  if (mapState.immersive) return false;
  if (!("IntersectionObserver" in window)) return false;
  return !mapViewNearViewport();
}

function ensureInlineMapReady(forceFrames = false) {
  refreshInlineMap(forceFrames, { defer: false });
}

function refreshInlineMap(forceFrames = false, options = {}) {
  if (!state.activePlace || !els.weatherMap) return;
  if (shouldDeferInlineMapRefresh(options)) {
    queueInlineMapRefresh(forceFrames);
    return;
  }
  if (inlineMapRefreshObserver) {
    inlineMapRefreshObserver.disconnect();
    inlineMapRefreshObserver = null;
  }
  inlineMapRefreshQueuedForce = false;
  initMap();
  syncMapToPlace();
  if (mapState.immersive) {
    loadMapFrames(forceFrames, { timelineKind: "precip", focusNow: true });
  } else {
    loadMapFrames(forceFrames, { timelineKind: "radar", focusLatest: true });
  }
}

function renderMapMarkers() {
  if (!mapState.initialized || !els.markerLayer) return;
  if (mapRendererIsGl()) {
    renderMapLibreMarkers();
    return;
  }
  const markerNodes = mapMarkerNodes();
  const liveKeys = new Set();
  if (!state.activePlace) {
    clearMapMarkerNodes();
    return;
  }

  const viewport = getMapViewport();
  const placedBounds = [];
  const activeMarker = renderMapMarker(state.activePlace, { viewport, markerNodes, liveKeys });
  if (activeMarker?.bounds) placedBounds.push(activeMarker.bounds);

  if (mapState.immersive) {
    state.savedPlaces
      .filter((place) => !isActiveMapPlace(place))
      .forEach((place) => {
        const layout = mapMarkerLayout(place, viewport);
        if (!layout || mapBoundsOverlapAny(layout.bounds, placedBounds)) return;
        const marker = renderMapMarker(place, { viewport, layout, markerNodes, liveKeys });
        if (marker?.bounds) placedBounds.push(marker.bounds);
      });
  }

  markerNodes.forEach((node, key) => {
    if (liveKeys.has(key)) return;
    node.remove();
    markerNodes.delete(key);
  });
}

async function setMapMode(mode) {
  if (mapState.mode === mode) return;
  const shouldResumePlayback = mapState.playing;
  mapState.mode = mode;
  stopRadarPlayback({ renderStatic: false });
  updateMapModeButtons();
  renderMapLegend();
  await loadMapFrames(true, {
    timelineKind: mode === "future" ? "forecast" : "radar",
    resumePlayback: shouldResumePlayback
  });
}

async function loadMapFrames(force = false, options = {}) {
  if (!mapState.initialized || !state.activePlace) return;
  const timelineKind = options.timelineKind || (mapState.immersive ? "precip" : mapState.timelineKind || "radar");
  if (!force && mapState.frames.length && mapState.timelineKind === timelineKind) {
    showFrame(mapState.frameIndex);
    return;
  }

  const shouldResumePlayback = Boolean(options.resumePlayback || mapState.playing);
  const preserveExisting = Boolean(options.preserveExisting && mapState.frames.length);
  setMapLoading(true);
  if (!preserveExisting) clearMapLayers({ renderStatic: false });
  mapState.timelineKind = timelineKind;

  try {
    const timeline = await fetchMapTimeline(timelineKind);
    mapState.frames = timeline.frames;
    mapState.nowIndex = timeline.nowIndex;
    mapState.forecastUnavailable = timeline.forecastUnavailable;

    if (!mapState.frames.length) {
      if (!preserveExisting) {
        setFrameLabel(timeline.emptyLabel || "No frames");
        updateTimelineEraVisuals();
      }
      return;
    }

    mapState.frameIndex = initialMapFrameIndex(timeline, timelineKind, options, shouldResumePlayback);
    els.frameSlider.max = String(mapState.frames.length - 1);
    updateTimelineEraVisuals();
    showFrame(mapState.frameIndex);
    if (shouldResumePlayback) startRadarPlayback();
    else maybeAutoPlayRadar(); // frames just became available — play if the map is on screen
  } catch (error) {
    if (!preserveExisting) {
      setFrameLabel("Map data unavailable");
      updateTimelineEraVisuals();
    }
  } finally {
    setMapLoading(false);
  }
}

async function fetchMapTimeline(timelineKind) {
  if (timelineKind === "precip") return fetchPrecipTimelineFrames();
  if (timelineKind === "forecast") {
    const frames = await fetchNoaaFutureRainFrames();
    return {
      frames,
      nowIndex: 0,
      forecastUnavailable: !frames.length && !getNoaaRegion(),
      emptyLabel: getNoaaRegion() ? "No NWS forecast frames" : "Forecast map unavailable here"
    };
  }

  const frames = await fetchRadarFrames();
  return {
    frames,
    nowIndex: Math.max(0, frames.length - 1),
    forecastUnavailable: false,
    emptyLabel: "No radar frames"
  };
}

function initialMapFrameIndex(timeline, timelineKind, options, shouldResumePlayback) {
  const last = Math.max(0, timeline.frames.length - 1);
  if (options.focusNow && Number.isFinite(timeline.nowIndex)) return clamp(timeline.nowIndex, 0, last);
  if (options.focusLatest || timelineKind === "radar") return last;
  if (shouldResumePlayback || timelineKind === "forecast") return 0;
  if (timelineKind === "precip" && Number.isFinite(timeline.nowIndex)) return clamp(timeline.nowIndex, 0, last);
  return last;
}

async function fetchPrecipTimelineFrames() {
  const [radarResult, forecastResult] = await Promise.allSettled([
    fetchRadarFrames(),
    fetchNoaaFutureRainFrames()
  ]);

  const radarFrames = radarResult.status === "fulfilled" ? radarResult.value : [];
  const forecastFrames = forecastResult.status === "fulfilled" ? forecastResult.value : [];
  const timeline = buildPrecipTimelineFrames(radarFrames, forecastFrames);
  const forecastUnavailable = !getNoaaRegion();

  return {
    ...timeline,
    forecastUnavailable,
    emptyLabel: forecastUnavailable ? "Forecast map unavailable here" : "No precipitation frames"
  };
}

function buildPrecipTimelineFrames(radarFrames, forecastFrames) {
  const now = Date.now();
  const radarCutoff = now + 2 * 60 * 1000;
  const radar = [...(radarFrames || [])]
    .filter((frame) => Number.isFinite(frame.timestamp) && frame.timestamp <= radarCutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((frame) => ({
      ...frame,
      source: "radar",
      sourceLabel: "Radar",
      label: radarTimelineLabel(frame.timestamp)
    }));

  const forecast = [...(forecastFrames || [])]
    .filter((frame) => Number.isFinite(frame.timestamp) && frame.timestamp > now)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((frame) => ({
      ...frame,
      source: "forecast",
      sourceLabel: "Forecast guidance",
      label: forecastTimelineLabel(frame.timestamp)
    }));

  let frames = radar;
  let nowIndex = Math.max(0, radar.length - 1);
  if (radar.length) {
    nowIndex = radar.length - 1;
    frames = [
      ...radar.slice(0, -1),
      {
        ...radar[radar.length - 1],
        timestamp: now,
        label: "Now",
        isNow: true
      }
    ];
  }

  frames = [...frames, ...forecast];
  if (!radar.length && forecast.length) nowIndex = 0;
  return { frames, nowIndex, forecastUnavailable: false };
}

async function fetchRainViewerFrames() {
  const data = await fetchRainViewerData();
  const frames = data.radar?.past || [];
  return frames.map((frame) => ({
    label: radarTimelineLabel(frame.time * 1000),
    time: frame.time,
    timestamp: frame.time * 1000,
    url: rainViewerTileUrl(data, frame),
    source: "radar",
    sourceLabel: "Radar",
    attribution: "RainViewer",
    maxZoom: 7
  }));
}

async function fetchRainViewerData() {
  const cacheKey = "rainviewer-frames";
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 4 * 60 * 1000;
  let data = cached && Date.now() - cached.savedAt < maxCacheAge ? cached.data : null;

  if (!data) {
    const response = await fetchRadarMetadataWithTimeout("https://api.rainviewer.com/public/weather-maps.json", {
      timeoutMs: RADAR_FALLBACK_METADATA_FETCH_TIMEOUT_MS
    });
    if (!response.ok) throw new Error("RainViewer metadata failed.");
    data = await response.json();
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  }

  return data;
}

function rainViewerTileUrl(data, frame) {
  return `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

async function fetchRadarFrames() {
  const provider = radarProviderPreference();
  if (radarProviderAllowsGenerated(provider)) {
    try {
      const generatedFrames = await fetchGeneratedMrmsRadarFrames();
      if (generatedFrames.length) {
        recordRadarSourceDecision("radar.enhanced-selected", radarDecisionFrameSummary(generatedFrames));
        return generatedFrames;
      }
      recordRadarSourceDecision("radar.enhanced-empty", {
        reason: "manifest loaded without usable frames"
      });
    } catch (error) {
      recordRadarSourceDecision("radar.enhanced-unavailable", {
        reason: radarDecisionErrorMessage(error)
      });
      /* Generated MRMS is optional; fall through to the proven sources if it is unavailable or stale. */
    }
    clearGeneratedRadarSelection();
    maybeScheduleGeneratedRadarWarmup("enhanced-missing");
  } else {
    recordRadarSourceDecision("radar.enhanced-skipped", {
      reason: "provider preference is NOAA WMS"
    });
  }

  try {
    const nwsFrames = await fetchNwsRadarFrames();
    if (nwsFrames.length) {
      recordRadarSourceDecision("radar.fallback-nws-selected", radarDecisionFrameSummary(nwsFrames));
      maybeScheduleGeneratedRadarWarmup("fallback-nws-visible");
      return nwsFrames;
    }
    recordRadarSourceDecision("radar.fallback-nws-empty", {
      reason: "NOAA/NWS returned no radar frames"
    });
  } catch (error) {
    recordRadarSourceDecision("radar.fallback-nws-unavailable", {
      reason: radarDecisionErrorMessage(error)
    });
    /* RainViewer remains the global/fallback radar source for this spike. */
  }
  try {
    const rainViewerFrames = await fetchRainViewerFrames();
    recordRadarSourceDecision("radar.fallback-rainviewer-selected", radarDecisionFrameSummary(rainViewerFrames));
    maybeScheduleGeneratedRadarWarmup("fallback-rainviewer-visible");
    return rainViewerFrames;
  } catch (error) {
    recordRadarSourceDecision("radar.fallback-rainviewer-unavailable", {
      reason: radarDecisionErrorMessage(error)
    });
    throw error;
  }
}

function radarProviderPreference() {
  return sanitizeRadarProvider?.(state.radarProvider) || "auto";
}

function radarProviderAllowsGenerated(provider = radarProviderPreference()) {
  return provider === "mrms-generated" && generatedRadarExperimentEnabled?.();
}

function generatedMrmsManifestUrlOverride() {
  try {
    return String(localStorage.getItem(RADAR_MANIFEST_URL_KEY) || "").trim();
  } catch {
    return "";
  }
}

function generatedMrmsIndexUrlOverride() {
  try {
    const key = typeof RADAR_INDEX_URL_KEY === "string"
      ? RADAR_INDEX_URL_KEY
      : "nearcast-radar-index-url";
    return normalizeGeneratedMrmsIndexUrl(localStorage.getItem(key));
  } catch {
    return "";
  }
}

function setGeneratedMrmsIndexUrlOverride(value) {
  const key = typeof RADAR_INDEX_URL_KEY === "string"
    ? RADAR_INDEX_URL_KEY
    : "nearcast-radar-index-url";
  const normalized = normalizeGeneratedMrmsIndexUrl(value);
  try {
    localStorage.removeItem(RADAR_MANIFEST_URL_KEY);
    if (normalized) localStorage.setItem(key, normalized);
    else localStorage.removeItem(key);
  } catch {
    /* Storage can be unavailable in private or embedded contexts. */
  }
  clearGeneratedRadarSelection();
  recordRadarSourceDecision("radar.index-override-updated", {
    indexUrl: normalized || generatedMrmsIndexUrl()
  });
  if (typeof loadMapFrames === "function") {
    loadMapFrames(true, { timelineKind: "radar", preserveExisting: true }).catch((error) => {
      recordRadarSourceDecision("radar.index-override-refresh-failed", {
        reason: radarDecisionErrorMessage(error)
      });
    });
  }
  scheduleGeneratedRadarViewportRefresh("index-override");
  return normalized || "";
}

function normalizeGeneratedMrmsIndexUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || ["0", "off", "local", "none"].includes(raw.toLowerCase())) return "";
  if (["preview", "r2-preview", "ondemand-preview", "on-demand-preview"].includes(raw.toLowerCase())) {
    return typeof MRMS_RADAR_PREVIEW_INDEX_URL === "string" && MRMS_RADAR_PREVIEW_INDEX_URL
      ? MRMS_RADAR_PREVIEW_INDEX_URL
      : "https://radar.getnearcast.app/radar/mrms/on-demand-preview/index.json";
  }
  return raw;
}

async function resolveRadarViewportCapability(options = {}) {
  const base = baseRadarViewportCapability();
  const endpoint = radarCapabilityEndpointUrl();
  const explicit = generatedMrmsManifestUrlOverride();
  if (endpoint && !explicit && !options.localOnly) {
    try {
      const capability = await fetchRadarCapabilityEndpoint(endpoint, base, options);
      recordRadarSourceDecision("radar.capability-endpoint-selected", {
        endpoint: capability?.endpoint || endpoint,
        enhancedState: capability?.enhanced?.state || "",
        generationState: capability?.generation?.state || ""
      });
      return rememberRadarCapability(capability);
    } catch (error) {
      recordRadarSourceDecision("radar.capability-endpoint-unavailable", {
        endpoint,
        reason: radarDecisionErrorMessage(error)
      });
    }
  }
  return resolveLocalRadarViewportCapability(base, options);
}

async function requestRadarViewportGeneration(options = {}) {
  return resolveRadarViewportCapability({
    ...options,
    allowLegacy: false,
    requestGeneration: true,
    reason: options.reason || "manual-diagnostic-request"
  });
}

async function resolveLocalRadarViewportCapability(base, options = {}) {
  const explicit = generatedMrmsManifestUrlOverride();
  if (explicit) {
    rememberGeneratedMrmsIndexSelection(null);
    const capability = radarCapabilityWithEnhanced(base, {
      state: "ready",
      kind: "generated-radar",
      manifestUrl: explicit,
      selectionSource: "override",
      selectionKey: `override:${explicit}`,
      reason: "explicit-manifest-override"
    });
    recordRadarSourceDecision("radar.enhanced-override-selected", {
      manifestUrl: explicit
    });
    return rememberRadarCapability(capability);
  }

  const indexAttempts = [];
  for (const indexUrl of generatedMrmsIndexCandidateUrls()) {
    try {
      const response = await fetchRadarMetadataWithTimeout(indexUrl, {
        cache: "no-store",
        timeoutMs: RADAR_CAPABILITY_FETCH_TIMEOUT_MS
      });
      if (!response.ok) throw new Error("Generated MRMS index unavailable.");
      const index = await response.json();
      const selection = selectGeneratedMrmsIndexPack(index, { indexUrl });
      const pack = selection.pack;
      const manifestUrl = generatedMrmsIndexPackManifestUrl(pack);
      if (manifestUrl) {
        const resolved = resolveGeneratedRadarUrl(manifestUrl, indexUrl);
        const quality = selection.selected
          ? { ...selection.selected, manifestUrl: resolved }
          : generatedMrmsIndexPackDiagnosticSummary(pack, null, { indexUrl, manifestUrl: resolved });
        const capability = radarCapabilityWithEnhanced(base, {
          state: "ready",
          kind: Number(pack?.metrics?.dataTiles || 0) > 0 ? "encoded-radar" : "generated-radar",
          manifestUrl: resolved,
          selectionSource: pack?.kind === "frame-substrate" ? "frame-index" : "index",
          selectionKey: generatedMrmsIndexPackSelectionKey(pack, resolved),
          packId: pack?.id || "",
          label: pack?.label || "",
          generatedAt: pack?.generatedAt || "",
          expiresAt: pack?.expiresAt || "",
          coverageBounds: generatedCoverageBounds(pack?.coverageBounds),
          metrics: pack?.metrics || null,
          quality,
          reason: pack?.kind === "frame-substrate" ? "fresh-frame-substrate" : "fresh-index-pack"
        });
        recordRadarSourceDecision("radar.enhanced-index-pack-selected", {
          indexUrl,
          provider: index?.provider || "",
          packId: pack?.id || pack?.label || "",
          kind: pack?.kind || "",
          manifestUrl: resolved,
          packCount: selection.packCount,
          freshPackCount: selection.freshPackCount,
          rejectedPackCount: selection.rejectedPackCount,
          candidates: selection.candidates,
          quality,
          expiresAt: pack?.expiresAt || "",
          coverageBounds: generatedCoverageBounds(pack?.coverageBounds)
        });
        return rememberRadarCapability(capability);
      }
      const attempt = {
        reason: "no-fresh-index-pack",
        indexUrl,
        provider: index?.provider || "",
        packCount: selection.packCount,
        freshPackCount: selection.freshPackCount,
        rejectedPackCount: selection.rejectedPackCount,
        candidates: selection.candidates
      };
      indexAttempts.push(attempt);
      recordRadarSourceDecision("radar.enhanced-index-no-match", attempt);
    } catch (error) {
      rememberGeneratedMrmsIndexSelection(null);
      const attempt = {
        reason: "index-unavailable",
        indexUrl,
        error: radarDecisionErrorMessage(error)
      };
      indexAttempts.push(attempt);
      recordRadarSourceDecision("radar.enhanced-index-unavailable", attempt);
      /* The index is a production-routing layer; legacy generated radar and fallback remain compatibility paths. */
    }
  }

  const indexUrl = generatedMrmsIndexUrl();
  if (options.allowLegacy === false) {
    const latestAttempt = indexAttempts[indexAttempts.length - 1] || { reason: "index-unavailable", indexUrl };
    return rememberRadarCapability(radarCapabilityWithGenerationState(radarCapabilityUnavailable(base, {
      ...latestAttempt,
      attempts: indexAttempts
    }), options));
  }

  rememberGeneratedMrmsIndexSelection(null);
  const capability = radarCapabilityWithEnhanced(base, {
    state: "ready",
    kind: "generated-radar",
    manifestUrl: MRMS_RADAR_MANIFEST_URL,
    selectionSource: "legacy",
    selectionKey: `legacy:${MRMS_RADAR_MANIFEST_URL}`,
    reason: "legacy-manifest-compatibility"
  });
  recordRadarSourceDecision("radar.enhanced-legacy-selected", {
    manifestUrl: MRMS_RADAR_MANIFEST_URL
  });
  return rememberRadarCapability(capability);
}

function radarCapabilityEndpointUrl() {
  try {
    const key = typeof RADAR_CAPABILITY_ENDPOINT_KEY === "string"
      ? RADAR_CAPABILITY_ENDPOINT_KEY
      : "nearcast-radar-capability-endpoint";
    const configured = String(localStorage.getItem(key) || "").trim();
    if (["0", "off", "local", "none"].includes(configured.toLowerCase())) return "";
    if (configured) return configured;
    return defaultRadarCapabilityEndpointUrl();
  } catch {
    return defaultRadarCapabilityEndpointUrl();
  }
}

function defaultRadarCapabilityEndpointUrl() {
  const endpoint = typeof DEFAULT_RADAR_CAPABILITY_ENDPOINT === "string"
    ? DEFAULT_RADAR_CAPABILITY_ENDPOINT
    : "";
  if (!endpoint) return "";
  const host = String(window.location?.hostname || "").toLowerCase();
  if (!host || ["localhost", "127.0.0.1", "0.0.0.0"].includes(host)) return "";
  return endpoint;
}

async function fetchRadarCapabilityEndpoint(endpoint, base, options = {}) {
  const url = resolveRadarCapabilityEndpointUrl(endpoint);
  if (!url) throw new Error("Radar capability endpoint URL is invalid.");
  const response = await fetchRadarMetadataWithTimeout(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    cache: "no-store",
    body: JSON.stringify(radarCapabilityRequestPayload(base, options)),
    timeoutMs: RADAR_CAPABILITY_FETCH_TIMEOUT_MS
  });
  if (!response.ok) throw new Error(`Radar capability endpoint failed with ${response.status}.`);
  const capability = normalizeRadarCapabilityResponse(await response.json(), base, url);
  if (capability?.provider !== "nearcast-radar-capabilities") {
    throw new Error("Radar capability endpoint returned an invalid provider.");
  }
  return capability;
}

function resolveRadarCapabilityEndpointUrl(endpoint) {
  try {
    return new URL(endpoint, window.location.href).toString();
  } catch {
    return "";
  }
}

function radarCapabilityRequestPayload(base, options = {}) {
  return {
    provider: "nearcast-radar-capability-request",
    version: 1,
    requestedAt: new Date().toISOString(),
    viewport: base?.viewport || null,
    preferences: {
      radarProvider: radarProviderPreference(),
      mapRenderer: state.mapRenderer,
      timelineKind: mapState.timelineKind,
      immersive: Boolean(mapState.immersive)
    },
    generation: {
      request: Boolean(options.requestGeneration),
      reason: options.reason || "capability-resolution"
    }
  };
}

function normalizeRadarCapabilityResponse(value, base, endpoint) {
  const capability = value && typeof value === "object" ? value : {};
  const enhanced = capability.enhanced && typeof capability.enhanced === "object"
    ? capability.enhanced
    : {};
  const generation = capability.generation && typeof capability.generation === "object"
    ? capability.generation
    : {};
  return {
    ...base,
    ...capability,
    provider: capability.provider || "nearcast-radar-capabilities",
    version: Number.isFinite(Number(capability.version)) ? Number(capability.version) : 1,
    checkedAt: capability.checkedAt || new Date().toISOString(),
    endpoint,
    viewport: capability.viewport || base.viewport,
    immediate: capability.immediate || base.immediate,
    enhanced: {
      ...base.enhanced,
      ...enhanced,
      state: enhanced.state || "unavailable",
      manifestUrl: enhanced.manifestUrl || null,
      reason: enhanced.reason || "endpoint-response"
    },
    generation: {
      ...base.generation,
      ...generation,
      state: generation.state || "not-requested",
      requestId: generation.requestId || null,
      reason: generation.reason || "endpoint-response"
    }
  };
}

function baseRadarViewportCapability(context = generatedMrmsSelectionContext()) {
  return {
    provider: "nearcast-radar-capabilities",
    version: 1,
    checkedAt: new Date().toISOString(),
    viewport: radarCapabilityViewport(context),
    immediate: {
      kind: "fallback-radar",
      label: "Radar",
      manifestUrl: null
    },
    enhanced: {
      state: "unavailable",
      kind: null,
      manifestUrl: null,
      reason: "not-resolved"
    },
    generation: {
      state: "not-requested",
      requestId: null,
      reason: "local-static-resolver"
    }
  };
}

function radarCapabilityViewport(context) {
  return {
    center: context?.centerPoint || context?.activePoint || null,
    activePoint: context?.activePoint || null,
    zoom: Number.isFinite(Number(context?.zoom)) ? Number(context.zoom) : null,
    bounds: context?.viewportBounds || null,
    key: generatedRadarViewportKey()
  };
}

function radarCapabilityWithEnhanced(base, enhanced) {
  return {
    ...base,
    enhanced: {
      state: enhanced.state || "ready",
      kind: enhanced.kind || "generated-radar",
      label: enhanced.label || "Radar",
      manifestUrl: enhanced.manifestUrl || null,
      selectionSource: enhanced.selectionSource || "",
      selectionKey: enhanced.selectionKey || "",
      packId: enhanced.packId || "",
      coverageBounds: enhanced.coverageBounds || null,
      generatedAt: enhanced.generatedAt || "",
      expiresAt: enhanced.expiresAt || "",
      metrics: enhanced.metrics || null,
      quality: enhanced.quality || null,
      reason: enhanced.reason || "enhanced-layer-ready"
    },
    generation: {
      state: "not-needed",
      requestId: null,
      reason: enhanced.reason || "enhanced-layer-ready"
    }
  };
}

function radarCapabilityUnavailable(base, detail = {}) {
  return {
    ...base,
    enhanced: {
      ...base.enhanced,
      state: "unavailable",
      reason: detail.reason || "enhanced-layer-unavailable",
      indexUrl: detail.indexUrl || "",
      packCount: Number.isFinite(Number(detail.packCount)) ? Number(detail.packCount) : null,
      freshPackCount: Number.isFinite(Number(detail.freshPackCount)) ? Number(detail.freshPackCount) : null,
      rejectedPackCount: Number.isFinite(Number(detail.rejectedPackCount)) ? Number(detail.rejectedPackCount) : null,
      candidates: Array.isArray(detail.candidates) ? detail.candidates : [],
      error: detail.error || ""
    },
    generation: {
      state: "not-requested",
      requestId: null,
      reason: "local-static-resolver"
    }
  };
}

function radarCapabilityWithGenerationState(capability, options = {}) {
  if (!options.requestGeneration) return capability;
  return {
    ...capability,
    generation: {
      state: "unsupported",
      requestId: null,
      reason: "no-capability-endpoint-configured"
    }
  };
}

async function fetchGeneratedMrmsRadarFrames() {
  const selection = await resolveGeneratedMrmsManifestSelection();
  if (!selection?.manifestUrl) throw new Error("Generated MRMS capability unavailable.");
  const response = await fetchRadarMetadataWithTimeout(selection.manifestUrl, {
    cache: "no-store",
    timeoutMs: RADAR_CAPABILITY_FETCH_TIMEOUT_MS
  });
  if (!response.ok) throw new Error("Generated MRMS manifest unavailable.");
  const manifest = await response.json();
  validateGeneratedMrmsManifest(manifest);
  const frames = normalizeGeneratedMrmsFrames(manifest, selection.manifestUrl);
  const frameEligibility = generatedRadarFramesViewportEligibility(frames);
  if (frameEligibility && !frameEligibility.usable) {
    throw new Error(`Generated MRMS frame coverage unavailable for current map view (${frameEligibility.reason}).`);
  }
  await preflightGeneratedMrmsTiles(frames, manifest);
  if (frames.length) {
    mapState.generatedRadarManifestUrl = selection.manifestUrl;
    mapState.generatedRadarSelectionKey = selection.key;
    mapState.generatedRadarViewportKey = generatedRadarViewportKey();
    recordRadarSourceDecision("radar.enhanced-ready", {
      selectionSource: selection.source || "",
      manifestUrl: selection.manifestUrl,
      frameCount: frames.length,
      encodedFrames: frames.filter((frame) => frame?.dataUrl).length,
      generatedAt: manifest?.generatedAt || "",
      expiresAt: manifest?.expiresAt || "",
      coverageBounds: generatedCoverageBounds(manifest?.coverageBounds)
    });
  }
  return frames;
}

async function preflightGeneratedMrmsTiles(frames, manifest) {
  if (!Array.isArray(frames) || !frames.length) {
    throw new Error("Generated MRMS manifest has no usable frames.");
  }

  const metrics = manifest?.metrics || manifest?.coverage || {};
  const expectedTiles = Number(metrics.dataTiles ?? metrics.radarTiles ?? metrics.generatedTiles);
  if (Number.isFinite(expectedTiles) && expectedTiles <= 0) {
    throw new Error("Generated MRMS manifest has no public radar tiles.");
  }

  const cacheKey = generatedMrmsTilePreflightCacheKey(frames, manifest);
  const cached = generatedRadarTilePreflightCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < GENERATED_RADAR_TILE_PREFLIGHT_CACHE_MS) {
    recordRadarSourceDecision(cached.ok ? "radar.enhanced-tile-preflight-cache-ok" : "radar.enhanced-tile-preflight-cache-failed", {
      probes: cached.probes,
      generatedTiles: Number.isFinite(expectedTiles) ? expectedTiles : null
    });
    if (!cached.ok) throw new Error(cached.error || "Generated MRMS public tiles unreachable.");
    return;
  }

  const urls = generatedMrmsTilePreflightUrls(frames);
  if (!urls.length) throw new Error("Generated MRMS tile preflight had no probe URLs.");

  recordRadarSourceDecision("radar.enhanced-tile-preflight-start", {
    probes: urls.length,
    frameCount: frames.length,
    generatedTiles: Number.isFinite(expectedTiles) ? expectedTiles : null
  });

  const ok = await generatedMrmsAnyTileAvailable(urls);
  generatedRadarTilePreflightCache.set(cacheKey, {
    ok,
    checkedAt: Date.now(),
    probes: urls.length,
    error: ok ? "" : `Generated MRMS public tiles unreachable (${urls.length} probes).`
  });
  pruneGeneratedMrmsTilePreflightCache();
  recordRadarSourceDecision(ok ? "radar.enhanced-tile-preflight-ok" : "radar.enhanced-tile-preflight-failed", {
    probes: urls.length,
    frameCount: frames.length,
    generatedTiles: Number.isFinite(expectedTiles) ? expectedTiles : null
  });
  if (!ok) throw new Error(`Generated MRMS public tiles unreachable (${urls.length} probes).`);
}

function generatedMrmsTilePreflightUrls(frames) {
  const urls = [];
  const seen = new Set();
  const recentFrames = frames
    .slice(-GENERATED_RADAR_TILE_PREFLIGHT_FRAME_LIMIT)
    .reverse();

  for (const frame of recentFrames) {
    const template = generatedMrmsPreflightTileTemplate(frame);
    if (!template) continue;
    for (const z of generatedMrmsPreflightZooms(frame)) {
      for (const coord of generatedMrmsPreflightTileCoords(frame, z)) {
        const url = weatherTileUrl(template, z, coord.x, coord.y);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
        if (urls.length >= GENERATED_RADAR_TILE_PREFLIGHT_MAX_URLS) return urls;
      }
    }
  }
  return urls;
}

function generatedMrmsTilePreflightCacheKey(frames, manifest) {
  const latest = frames[frames.length - 1] || {};
  return [
    manifest?.generatedAt || "",
    manifest?.expiresAt || "",
    latest.dataUrl || latest.url || "",
    latest.timestamp || ""
  ].join("|");
}

function pruneGeneratedMrmsTilePreflightCache() {
  while (generatedRadarTilePreflightCache.size > 12) {
    generatedRadarTilePreflightCache.delete(generatedRadarTilePreflightCache.keys().next().value);
  }
}

function generatedMrmsPreflightTileTemplate(frame) {
  if (frame?.dataUrl) return frame.dataUrl;
  if (frame?.url) return frame.url;
  const layer = (frame?.layers || []).find((item) => item?.dataUrl || item?.url);
  return layer?.dataUrl || layer?.url || "";
}

function generatedMrmsPreflightZooms(frame) {
  const minZoom = weatherFrameMinZoom(frame);
  const maxZoom = weatherFrameMaxZoom(frame);
  const currentZoom = Math.min(Math.max(weatherFrameSourceZoom(frame), minZoom), maxZoom);
  return [
    currentZoom,
    Math.min(maxZoom, Math.max(minZoom, 8)),
    Math.min(maxZoom, Math.max(minZoom, 10)),
    maxZoom,
    minZoom
  ].filter((value, index, list) => Number.isFinite(value) && list.indexOf(value) === index);
}

function generatedMrmsPreflightTileCoords(frame, z) {
  const coords = [];
  const seen = new Set();
  const worldTiles = 2 ** z;
  const context = generatedMrmsSelectionContext();
  const frameBounds = generatedCoverageBounds(frame?.coverageBounds);
  const viewportBounds = generatedCoverageBounds(context?.viewportBounds);
  const sampleBounds = generatedBoundsIntersectionSimple(frameBounds, viewportBounds) || frameBounds;

  generatedMrmsTileCoordsForBounds(sampleBounds, z).forEach(addCoord);
  [context?.activePoint, context?.centerPoint].forEach((point) => {
    generatedMrmsTileCoordsForPoint(point, z).forEach(addCoord);
  });

  return coords;

  function addCoord(coord) {
    if (!coord) return;
    const x = ((coord.x % worldTiles) + worldTiles) % worldTiles;
    const y = Math.max(0, Math.min(worldTiles - 1, coord.y));
    const key = `${x}/${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    coords.push({ x, y });
  }
}

function generatedMrmsTileCoordsForBounds(bounds, z) {
  if (!bounds) return [];
  const worldTiles = 2 ** z;
  const nw = projectLatLon(bounds.maxLat, bounds.minLon, z);
  const se = projectLatLon(bounds.minLat, bounds.maxLon, z);
  const minX = Math.floor(Math.min(nw.x, se.x) / 256);
  const maxX = Math.floor(Math.max(nw.x, se.x) / 256);
  const minY = Math.max(0, Math.floor(Math.min(nw.y, se.y) / 256));
  const maxY = Math.min(worldTiles - 1, Math.floor(Math.max(nw.y, se.y) / 256));
  const xs = generatedIntegerSamples(minX, maxX);
  const ys = generatedIntegerSamples(minY, maxY);
  const coords = [];
  xs.forEach((x) => ys.forEach((y) => coords.push({ x, y })));
  return coords;
}

function generatedMrmsTileCoordsForPoint(point, z) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  const projected = projectLatLon(latitude, longitude, z);
  const tileX = Math.floor(projected.x / 256);
  const tileY = Math.floor(projected.y / 256);
  const coords = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      coords.push({ x: tileX + dx, y: tileY + dy });
    }
  }
  return coords;
}

function generatedIntegerSamples(min, max) {
  const start = Math.ceil(Math.min(min, max));
  const end = Math.floor(Math.max(min, max));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  if (end - start <= 2) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return [start, Math.floor((start + end) / 2), end];
}

function generatedBoundsIntersectionSimple(a, b) {
  if (!a || !b) return null;
  const minLat = Math.max(a.minLat, b.minLat);
  const maxLat = Math.min(a.maxLat, b.maxLat);
  const minLon = Math.max(a.minLon, b.minLon);
  const maxLon = Math.min(a.maxLon, b.maxLon);
  if (!(minLat < maxLat && minLon < maxLon)) return null;
  return { minLat, minLon, maxLat, maxLon };
}

async function generatedMrmsAnyTileAvailable(urls) {
  const checks = urls.map((url) => generatedMrmsTileAvailable(url).catch(() => false));
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

async function generatedMrmsTileAvailable(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), GENERATED_RADAR_TILE_PREFLIGHT_TIMEOUT_MS)
    : 0;
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller?.signal
    });
    if (response.ok) return true;
    if (![405, 501].includes(response.status)) return false;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const fallbackController = typeof AbortController === "function" ? new AbortController() : null;
  const fallbackTimer = fallbackController
    ? setTimeout(() => fallbackController.abort(), GENERATED_RADAR_TILE_PREFLIGHT_TIMEOUT_MS)
    : 0;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: fallbackController?.signal
    });
    return response.ok;
  } finally {
    if (fallbackTimer) clearTimeout(fallbackTimer);
  }
}

async function resolveGeneratedMrmsManifestUrl() {
  const selection = await resolveGeneratedMrmsManifestSelection();
  return selection?.manifestUrl || "";
}

async function resolveGeneratedMrmsManifestSelection(options = {}) {
  if (!generatedMrmsManifestUrlOverride()) {
    const hinted = generatedRadarSelectionHint();
    if (hinted) return hinted;
  }
  const capability = await resolveRadarViewportCapability(options);
  const enhanced = capability?.enhanced;
  if (enhanced?.state !== "ready" || !enhanced.manifestUrl) return null;
  return {
    source: enhanced.selectionSource || "capability",
    manifestUrl: enhanced.manifestUrl,
    key: enhanced.selectionKey || `${enhanced.selectionSource || "capability"}:${enhanced.manifestUrl}`,
    capability
  };
}

function rememberGeneratedRadarSelectionHint(selection, viewportKey = generatedRadarViewportKey()) {
  if (!selection?.manifestUrl || !selection?.key) return null;
  mapState.generatedRadarSelectionHint = {
    source: selection.source || "capability",
    manifestUrl: selection.manifestUrl,
    key: selection.key,
    capability: selection.capability || null,
    viewportKey,
    rememberedAt: Date.now()
  };
  return mapState.generatedRadarSelectionHint;
}

function generatedRadarSelectionHint() {
  const hint = mapState.generatedRadarSelectionHint;
  if (!hint?.manifestUrl || !hint.key) return null;
  const age = Date.now() - (Number(hint.rememberedAt) || 0);
  if (!Number.isFinite(age) || age > GENERATED_RADAR_SELECTION_HINT_MS) {
    mapState.generatedRadarSelectionHint = null;
    return null;
  }
  const viewportKey = generatedRadarViewportKey();
  if (hint.viewportKey && viewportKey && hint.viewportKey !== viewportKey) {
    mapState.generatedRadarSelectionHint = null;
    return null;
  }
  return {
    source: hint.source || "capability",
    manifestUrl: hint.manifestUrl,
    key: hint.key,
    capability: hint.capability || null
  };
}

function generatedMrmsIndexUrl() {
  return generatedMrmsIndexCandidateUrls()[0] || "radar/mrms/index.json";
}

function generatedMrmsIndexCandidateUrls() {
  const override = generatedMrmsIndexUrlOverride();
  if (override) return [override];
  return [
    typeof MRMS_RADAR_FRAME_INDEX_URL === "string" ? MRMS_RADAR_FRAME_INDEX_URL : "",
    typeof MRMS_RADAR_INDEX_URL === "string" ? MRMS_RADAR_INDEX_URL : "radar/mrms/index.json"
  ].filter((url, index, urls) => url && urls.indexOf(url) === index);
}

function selectGeneratedMrmsIndexPack(index, options = {}) {
  const selection = generatedMrmsIndexPackSelection(index, options);
  rememberGeneratedMrmsIndexSelection(selection);
  return selection;
}

function generatedMrmsIndexPackSelection(index, options = {}) {
  const context = options.context || generatedMrmsSelectionContext();
  const indexUrl = options.indexUrl || generatedMrmsIndexUrl();
  const packs = generatedMrmsIndexPacks(index);
  const freshPacks = packs.filter((pack) => !generatedMrmsIndexPackExpired(pack));
  const candidates = freshPacks
    .map((pack) => ({
      pack,
      score: generatedMrmsIndexPackScore(pack, context)
    }))
    .filter((item) => item.score)
    .sort(compareGeneratedMrmsIndexPackScores);
  const selected = candidates[0] || null;
  return {
    at: new Date().toISOString(),
    indexUrl,
    context: generatedMrmsSelectionContextSummary(context),
    packCount: packs.length,
    freshPackCount: freshPacks.length,
    expiredPackCount: Math.max(0, packs.length - freshPacks.length),
    rejectedPackCount: Math.max(0, freshPacks.length - candidates.length),
    pack: selected?.pack || null,
    selected: selected
      ? generatedMrmsIndexPackDiagnosticSummary(selected.pack, selected.score, { indexUrl })
      : null,
    candidates: candidates
      .slice(0, GENERATED_RADAR_DIAGNOSTIC_CANDIDATE_LIMIT)
      .map((item) => generatedMrmsIndexPackDiagnosticSummary(item.pack, item.score, { indexUrl }))
  };
}

function rememberGeneratedMrmsIndexSelection(selection) {
  mapState.generatedRadarIndexSelection = selection
    ? {
      at: selection.at || new Date().toISOString(),
      indexUrl: selection.indexUrl || "",
      context: selection.context || null,
      packCount: selection.packCount ?? null,
      freshPackCount: selection.freshPackCount ?? null,
      expiredPackCount: selection.expiredPackCount ?? null,
      rejectedPackCount: selection.rejectedPackCount ?? null,
      selected: selection.selected || null,
      candidates: Array.isArray(selection.candidates) ? selection.candidates : []
    }
    : null;
  return selection;
}

function generatedMrmsSelectionContextSummary(context) {
  return {
    activePoint: generatedPointDiagnosticSummary(context?.activePoint),
    centerPoint: generatedPointDiagnosticSummary(context?.centerPoint),
    viewportBounds: generatedBoundsDiagnosticSummary(context?.viewportBounds),
    zoom: roundedDiagnosticNumber(context?.zoom, 2)
  };
}

function generatedPointDiagnosticSummary(point) {
  if (!point) return null;
  const latitude = Number(point.latitude);
  const longitude = normalizeMapLongitude(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude: roundedDiagnosticNumber(latitude, 4),
    longitude: roundedDiagnosticNumber(longitude, 4)
  };
}

function generatedBoundsDiagnosticSummary(bounds) {
  const normalized = generatedCoverageBounds(bounds);
  if (!normalized) return null;
  return {
    minLat: roundedDiagnosticNumber(normalized.minLat, 4),
    minLon: roundedDiagnosticNumber(normalized.minLon, 4),
    maxLat: roundedDiagnosticNumber(normalized.maxLat, 4),
    maxLon: roundedDiagnosticNumber(normalized.maxLon, 4)
  };
}

function generatedMrmsIndexPackDiagnosticSummary(pack, score = null, options = {}) {
  if (!pack) return null;
  const manifestUrl = options.manifestUrl || resolveGeneratedRadarUrl(generatedMrmsIndexPackManifestUrl(pack), options.indexUrl || generatedMrmsIndexUrl());
  const zoomWindow = generatedMrmsIndexPackZoomWindow(pack);
  const metrics = pack?.metrics || {};
  return {
    id: pack?.id || pack?.label || "",
    label: pack?.label || "",
    manifestUrl,
    minZoom: zoomWindow.minZoom,
    maxZoom: zoomWindow.maxZoom,
    maxClientOverzoom: generatedRadarMaxClientOverzoom(pack),
    generatedAt: pack?.generatedAt || "",
    expiresAt: pack?.expiresAt || "",
    coverageBounds: generatedBoundsDiagnosticSummary(pack?.coverageBounds),
    metrics: {
      candidateTiles: diagnosticMetricNumber(metrics.candidateTiles),
      generatedTiles: diagnosticMetricNumber(metrics.generatedTiles),
      radarTiles: diagnosticMetricNumber(metrics.radarTiles),
      dataTiles: diagnosticMetricNumber(metrics.dataTiles),
      uploadedObjects: diagnosticMetricNumber(metrics.uploadedObjects || metrics.uploaded)
    },
    score: score ? generatedMrmsIndexPackScoreSummary(score) : null
  };
}

function generatedMrmsIndexPackScoreSummary(score) {
  return {
    value: roundedDiagnosticNumber(score.value, 3),
    zoom: roundedDiagnosticNumber(score.zoom, 3),
    maxZoomBonus: roundedDiagnosticNumber(score.maxZoomBonus, 3),
    overzoom: roundedDiagnosticNumber(score.overzoom, 2),
    underzoom: roundedDiagnosticNumber(score.underzoom, 2),
    area: roundedDiagnosticNumber(score.area, 4),
    freshness: score.freshness || 0,
    coverage: score.coverage
      ? {
        value: roundedDiagnosticNumber(score.coverage.value, 3),
        relevant: Boolean(score.coverage.relevant),
        centerCovered: Boolean(score.coverage.centerCovered),
        activeCovered: Boolean(score.coverage.activeCovered),
        viewportOverlap: roundedDiagnosticNumber(score.coverage.viewportOverlap, 3)
      }
      : null,
    viewportGate: score.viewportEligibility
      ? {
        usable: Boolean(score.viewportEligibility.usable),
        reason: score.viewportEligibility.reason || "",
        minZoom: score.viewportEligibility.minZoom,
        viewportThreshold: roundedDiagnosticNumber(score.viewportEligibility.viewportThreshold, 3)
      }
      : null
  };
}

function diagnosticMetricNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function generatedMrmsIndexPackZoomWindow(pack) {
  const minZoom = Number(pack?.minZoom ?? pack?.minzoom);
  const maxZoom = Number(pack?.maxZoom ?? pack?.maxzoom);
  return {
    minZoom: Number.isFinite(minZoom) ? minZoom : null,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : null
  };
}

function generatedRadarViewportEligibilityForSource(source, context = generatedMrmsSelectionContext(), areas = generatedManifestCoverageAreas(source)) {
  const safeContext = context || {};
  const coverage = generatedCoverageScoreForAreas(Array.isArray(areas) ? areas : [], safeContext);
  const { minZoom, maxZoom } = generatedMrmsIndexPackZoomWindow(source);
  const zoom = Number(safeContext.zoom);
  const hasZoom = Number.isFinite(zoom);
  const hasViewport = Boolean(safeContext.viewportBounds);
  const enhancedMinZoomOk = !hasZoom || zoom + GENERATED_RADAR_MIN_ZOOM_GRACE >= GENERATED_RADAR_MIN_VIEWPORT_ZOOM;
  const sourceMinZoomOk = !hasZoom || !Number.isFinite(minZoom) || zoom + GENERATED_RADAR_MIN_ZOOM_GRACE >= minZoom;
  const minZoomOk = enhancedMinZoomOk && sourceMinZoomOk;
  const maxClientOverzoom = generatedRadarMaxClientOverzoom(source);
  const maxZoomOk = !hasZoom || !Number.isFinite(maxZoom) || !Number.isFinite(maxClientOverzoom) ||
    zoom <= maxZoom + maxClientOverzoom + GENERATED_RADAR_MIN_ZOOM_GRACE;
  const focusPointCovered = coverage.centerCovered || coverage.activeCovered;
  const centerFocusOk = focusPointCovered && hasZoom && zoom + GENERATED_RADAR_MIN_ZOOM_GRACE >= GENERATED_RADAR_CENTER_FOCUS_MIN_ZOOM;
  const relevantOk = coverage.relevant || centerFocusOk;
  const centerOk = !safeContext.centerPoint || coverage.centerCovered || centerFocusOk;
  const viewportThreshold = hasViewport ? GENERATED_RADAR_VIEWPORT_COVERAGE_MIN : null;
  const viewportOk = !hasViewport || coverage.viewportOverlap >= GENERATED_RADAR_VIEWPORT_COVERAGE_MIN || centerFocusOk;
  let reason = "usable";
  if (!relevantOk) reason = "coverage-not-relevant";
  else if (!enhancedMinZoomOk) reason = "below-enhanced-min-zoom";
  else if (!sourceMinZoomOk) reason = "below-generated-min-zoom";
  else if (!maxZoomOk) reason = "above-generated-max-zoom";
  else if (!centerOk) reason = "center-outside-coverage";
  else if (!viewportOk) reason = "viewport-not-covered";
  return {
    usable: relevantOk && minZoomOk && maxZoomOk && centerOk && viewportOk,
    reason,
    coverage,
    minZoom,
    enhancedMinZoom: GENERATED_RADAR_MIN_VIEWPORT_ZOOM,
    maxZoom,
    maxClientOverzoom,
    zoom: hasZoom ? zoom : null,
    viewportThreshold,
    centerFocusOk,
    focusPointCovered,
    relevantOk
  };
}

function generatedRadarMaxClientOverzoom(source) {
  const explicit = Number(source?.maxClientOverzoom ?? source?.renderProfile?.maxClientOverzoom ?? source?.substrate?.maxClientOverzoom);
  const frameSubstrateOverzoom = generatedRadarFrameSubstrateClientOverzoom(source);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return Number.isFinite(frameSubstrateOverzoom)
      ? Math.max(explicit, frameSubstrateOverzoom)
      : explicit;
  }
  return Number.isFinite(frameSubstrateOverzoom) ? frameSubstrateOverzoom : null;
}

function generatedRadarFrameSubstrateClientOverzoom(source) {
  if (!generatedRadarSourceIsFrameSubstrate(source)) return null;
  const maxZoom = Number(source?.maxZoom ?? source?.maxzoom);
  if (!Number.isFinite(maxZoom)) return null;
  return Math.max(0, GENERATED_RADAR_FRAME_SUBSTRATE_MAX_CLIENT_ZOOM - maxZoom);
}

function generatedRadarSourceIsFrameSubstrate(source) {
  return source?.kind === "frame-substrate" ||
    source?.substrate?.provider === "nearcast-mrms-frame-substrate" ||
    source?.substrate?.clientRendering === "encoded-radar";
}

function generatedRadarFrameViewportEligibility(frame, context = generatedMrmsSelectionContext()) {
  if (!frame || frame.provider !== "mrms-generated") return null;
  return generatedRadarViewportEligibilityForSource(frame, context, generatedManifestCoverageAreas(frame));
}

function generatedRadarFramesViewportEligibility(frames, context = generatedMrmsSelectionContext()) {
  const list = Array.isArray(frames) ? frames : [];
  const frame = [...list].reverse().find((item) => item?.provider === "mrms-generated");
  if (!frame) return null;
  return generatedRadarFrameViewportEligibility(frame, context);
}

function generatedRadarViewportEligibilityDiagnostic(eligibility) {
  if (!eligibility) return null;
  return {
    usable: Boolean(eligibility.usable),
    reason: eligibility.reason || "",
    zoom: roundedDiagnosticNumber(eligibility.zoom, 2),
    minZoom: eligibility.minZoom,
    maxZoom: eligibility.maxZoom,
    maxClientOverzoom: roundedDiagnosticNumber(eligibility.maxClientOverzoom, 2),
    viewportThreshold: roundedDiagnosticNumber(eligibility.viewportThreshold, 3),
    centerFocusOk: Boolean(eligibility.centerFocusOk),
    focusPointCovered: Boolean(eligibility.focusPointCovered),
    relevantOk: Boolean(eligibility.relevantOk),
    coverage: eligibility.coverage
      ? {
        relevant: Boolean(eligibility.coverage.relevant),
        centerCovered: Boolean(eligibility.coverage.centerCovered),
        activeCovered: Boolean(eligibility.coverage.activeCovered),
        viewportOverlap: roundedDiagnosticNumber(eligibility.coverage.viewportOverlap, 3)
      }
      : null
  };
}

function generatedMrmsIndexPacks(index) {
  const packs = Array.isArray(index?.packs)
    ? index.packs
    : Array.isArray(index?.manifests) ? index.manifests : [];
  return packs.filter((pack) => pack && generatedMrmsIndexPackManifestUrl(pack));
}

function generatedMrmsIndexPackManifestUrl(pack) {
  return pack?.manifestUrl || pack?.manifest || pack?.url || pack?.href || "";
}

function generatedMrmsIndexPackExpired(pack) {
  const expiresAt = generatedManifestTimestamp(pack?.expiresAt);
  return !pack?.sample && Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function generatedMrmsIndexPackScore(pack, context = generatedMrmsSelectionContext()) {
  if (pack?.kind === "frame-substrate" && Number(pack?.metrics?.dataTiles || pack?.metrics?.radarTiles || 0) <= 0) {
    return null;
  }
  const areas = generatedManifestCoverageAreas(pack);
  const viewportEligibility = generatedRadarViewportEligibilityForSource(pack, context, areas);
  if (!viewportEligibility.usable) return null;
  const coverage = viewportEligibility.coverage;
  const zoom = generatedMrmsIndexPackZoomScore(pack, context.zoom);
  const { minZoom, maxZoom } = generatedMrmsIndexPackZoomWindow(pack);
  const currentZoom = Number(context.zoom);
  const overzoom = Number.isFinite(currentZoom) && Number.isFinite(maxZoom)
    ? Math.max(0, currentZoom - maxZoom)
    : 0;
  const underzoom = Number.isFinite(currentZoom) && Number.isFinite(minZoom)
    ? Math.max(0, minZoom - currentZoom)
    : 0;
  const maxZoomBonus = Number.isFinite(maxZoom) ? Math.min(maxZoom, MAP_MAX_ZOOM) * 18 : 0;
  const dataTiles = Number(pack?.metrics?.dataTiles || 0);
  const area = generatedMrmsIndexPackArea(pack);
  const freshness = generatedManifestTimestamp(pack?.expiresAt) || 0;
  return {
    value: coverage.value * 1000 + zoom * 140 + maxZoomBonus - overzoom * 85 - underzoom * 45 + (dataTiles > 0 ? 35 : 0),
    coverage,
    zoom,
    maxZoomBonus,
    overzoom,
    underzoom,
    area,
    freshness,
    viewportEligibility
  };
}

function compareGeneratedMrmsIndexPackScores(a, b) {
  const scoreDelta = b.score.value - a.score.value;
  if (Math.abs(scoreDelta) > 0.00001) return scoreDelta;
  const areaDelta = a.score.area - b.score.area;
  if (Math.abs(areaDelta) > 0.00001) return areaDelta;
  return b.score.freshness - a.score.freshness;
}

function generatedMrmsIndexPackZoomScore(pack, zoom) {
  const minZoom = Number(pack?.minZoom ?? pack?.minzoom);
  const maxZoom = Number(pack?.maxZoom ?? pack?.maxzoom);
  if (!Number.isFinite(zoom)) return 0.5;
  if (Number.isFinite(minZoom) && zoom < minZoom) return Math.max(0, 0.75 - (minZoom - zoom) * 0.12);
  if (Number.isFinite(maxZoom) && zoom > maxZoom) return Math.max(0, 1 - (zoom - maxZoom) * 0.16);
  return 1;
}

function generatedMrmsIndexPackSelectionKey(pack, manifestUrl) {
  return [
    manifestUrl,
    pack?.id || "",
    pack?.publishFingerprint || "",
    pack?.sourceSignature || "",
    pack?.expiresAt || ""
  ].join("|");
}

function generatedMrmsIndexPackArea(pack) {
  const areas = generatedManifestCoverageAreas(pack);
  return areas.length
    ? Math.min(...areas.map((bounds) => Math.abs((bounds.maxLat - bounds.minLat) * generatedLongitudeSpan(bounds))))
    : Number.MAX_SAFE_INTEGER;
}

function generatedLongitudeSpan(bounds) {
  if (!bounds) return 360;
  if (bounds.minLon <= bounds.maxLon) return bounds.maxLon - bounds.minLon;
  return 360 - bounds.minLon + bounds.maxLon;
}

function generatedMrmsSelectionContext() {
  const activePoint = generatedPointForPlace(state.activePlace);
  const viewport = generatedCurrentMapViewport();
  return {
    activePoint,
    centerPoint: viewport?.center || activePoint,
    viewportBounds: viewport?.bounds || null,
    zoom: Number.isFinite(Number(mapState.zoom)) ? Number(mapState.zoom) : null
  };
}

function generatedPointForPlace(place) {
  if (!place) return null;
  const latitude = Number(place.latitude);
  const longitude = normalizeMapLongitude(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function generatedCurrentMapViewport() {
  if (!mapState.initialized || !state.activePlace || !els.weatherMap) return null;
  const rect = els.weatherMap.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const zoom = clampMapZoom(mapState.zoom);
  const viewport = getMapViewport();
  if (!Number.isFinite(viewport?.center?.x) || !Number.isFinite(viewport?.center?.y)) return null;
  const halfWidth = viewport.width / 2;
  const halfHeight = viewport.height / 2;
  const corners = [
    { x: viewport.center.x - halfWidth, y: viewport.center.y - halfHeight },
    { x: viewport.center.x + halfWidth, y: viewport.center.y - halfHeight },
    { x: viewport.center.x + halfWidth, y: viewport.center.y + halfHeight },
    { x: viewport.center.x - halfWidth, y: viewport.center.y + halfHeight }
  ].map((point) => unprojectWorldPoint(point, zoom));
  const center = unprojectWorldPoint(viewport.center, zoom);
  return {
    center,
    bounds: generatedBoundsFromPoints(corners)
  };
}

function generatedBoundsFromPoints(points) {
  const valid = (points || []).filter((point) =>
    point &&
    Number.isFinite(Number(point.latitude)) &&
    Number.isFinite(normalizeMapLongitude(point.longitude))
  );
  if (!valid.length) return null;
  const latitudes = valid.map((point) => Number(point.latitude));
  const longitudes = valid.map((point) => normalizeMapLongitude(point.longitude));
  const lonBounds = generatedLongitudeBounds(longitudes);
  return {
    minLat: Math.max(-85.0511, Math.min(...latitudes)),
    minLon: lonBounds.minLon,
    maxLat: Math.min(85.0511, Math.max(...latitudes)),
    maxLon: lonBounds.maxLon
  };
}

function generatedLongitudeBounds(longitudes) {
  const values = longitudes.map(normalizeMapLongitude).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return { minLon: -180, maxLon: 180 };
  if (values.length === 1) return { minLon: values[0], maxLon: values[0] };
  let largestGap = -Infinity;
  let largestGapIndex = 0;
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    const next = index === values.length - 1 ? values[0] + 360 : values[index + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }
  const coverageSpan = 360 - largestGap;
  if (coverageSpan >= 359.999) return { minLon: -180, maxLon: 180 };
  return {
    minLon: normalizeMapLongitude(values[(largestGapIndex + 1) % values.length]),
    maxLon: normalizeMapLongitude(values[largestGapIndex])
  };
}

function generatedCoverageScoreForAreas(areas, context) {
  if (!areas.length) {
    return {
      relevant: true,
      value: 4,
      centerCovered: true,
      activeCovered: true,
      viewportOverlap: 1
    };
  }
  const centerCovered = context.centerPoint
    ? areas.some((bounds) => generatedBoundsContainPoint(bounds, context.centerPoint.latitude, context.centerPoint.longitude))
    : false;
  const activeCovered = context.activePoint
    ? areas.some((bounds) => generatedBoundsContainPoint(bounds, context.activePoint.latitude, context.activePoint.longitude))
    : false;
  const viewportOverlap = context.viewportBounds
    ? Math.min(1, areas.reduce((sum, bounds) => sum + generatedBoundsOverlapRatio(bounds, context.viewportBounds), 0))
    : 0;
  const hasViewport = Boolean(context.centerPoint || context.viewportBounds);
  const activeRelevant = !hasViewport && activeCovered;
  const relevant = centerCovered || viewportOverlap >= 0.08 || activeRelevant;
  return {
    relevant,
    value: (centerCovered ? 3 : 0) + (activeRelevant ? 0.75 : 0) + viewportOverlap,
    centerCovered,
    activeCovered,
    viewportOverlap
  };
}

function generatedBoundsOverlapRatio(bounds, target) {
  const targetArea = generatedBoundsArea(target);
  if (!targetArea) return 0;
  return generatedBoundsIntersectionArea(bounds, target) / targetArea;
}

function generatedBoundsIntersectionArea(a, b) {
  if (!a || !b) return 0;
  const latOverlap = Math.max(0, Math.min(a.maxLat, b.maxLat) - Math.max(a.minLat, b.minLat));
  if (!latOverlap) return 0;
  let lonOverlap = 0;
  generatedLongitudeSegments(a).forEach((segA) => {
    generatedLongitudeSegments(b).forEach((segB) => {
      lonOverlap += Math.max(0, Math.min(segA.max, segB.max) - Math.max(segA.min, segB.min));
    });
  });
  return latOverlap * lonOverlap;
}

function generatedBoundsArea(bounds) {
  if (!bounds) return 0;
  return Math.max(0, bounds.maxLat - bounds.minLat) * generatedLongitudeSpan(bounds);
}

function generatedLongitudeSegments(bounds) {
  if (!bounds) return [];
  if (bounds.minLon <= bounds.maxLon) return [{ min: bounds.minLon, max: bounds.maxLon }];
  return [
    { min: bounds.minLon, max: 180 },
    { min: -180, max: bounds.maxLon }
  ];
}

function generatedRadarViewportKey() {
  const context = generatedMrmsSelectionContext();
  const point = context.centerPoint || context.activePoint;
  if (!point) return "";
  const zoom = Number.isFinite(context.zoom) ? context.zoom : 0;
  const bounds = generatedCoverageBounds(context.viewportBounds);
  const boundsKey = bounds
    ? `,b${bounds.minLat.toFixed(1)},${bounds.minLon.toFixed(1)},${bounds.maxLat.toFixed(1)},${bounds.maxLon.toFixed(1)}`
    : "";
  return `${point.latitude.toFixed(2)},${point.longitude.toFixed(2)},z${Math.round(zoom * 2) / 2}${boundsKey}`;
}

function clearGeneratedRadarSelection() {
  mapState.generatedRadarManifestUrl = "";
  mapState.generatedRadarSelectionKey = "";
  mapState.generatedRadarViewportKey = "";
  mapState.generatedRadarSelectionHint = null;
  mapState.generatedRadarIndexSelection = null;
}

function normalizeGeneratedMrmsFrames(manifest, manifestUrl) {
  const frames = Array.isArray(manifest?.frames)
    ? manifest.frames
    : Array.isArray(manifest?.radarFrames) ? manifest.radarFrames : [];
  const manifestMaxZoom = Number(manifest?.maxZoom ?? manifest?.maxzoom);
  const manifestMinZoom = Number(manifest?.minZoom ?? manifest?.minzoom);
  const attribution = manifest?.attribution || "NOAA MRMS · Nearcast";
  const style = manifest?.style || "banded";
  const dataEncoding = normalizeGeneratedMrmsDataEncoding(manifest?.dataEncoding);
  const manifestGeneratedAt = generatedManifestTimestamp(manifest?.generatedAt);
  const manifestExpiresAt = generatedManifestTimestamp(manifest?.expiresAt);
  const coverageBounds = generatedCoverageBounds(manifest?.coverageBounds);
  const maxClientOverzoom = generatedRadarMaxClientOverzoom(manifest);
  const sample = Boolean(manifest?.sample);

  return frames
    .map((frame) => normalizeGeneratedMrmsFrame(frame, {
      manifestUrl,
      manifestMaxZoom,
      manifestMinZoom,
      attribution,
      style,
      dataEncoding,
      manifestGeneratedAt,
      manifestExpiresAt,
      coverageBounds,
      maxClientOverzoom,
      sample
    }))
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function validateGeneratedMrmsManifest(manifest) {
  const expiresAt = generatedManifestTimestamp(manifest?.expiresAt);
  if (!manifest?.sample && Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    throw new Error("Generated MRMS manifest expired.");
  }
  if (!generatedManifestCoversCurrentMapView(manifest)) {
    throw new Error("Generated MRMS coverage unavailable for current map view.");
  }
}

function normalizeGeneratedMrmsFrame(frame, context) {
  const timestamp = generatedFrameTimestamp(frame);
  const layers = Array.isArray(frame?.layers) ? frame.layers : [];
  const firstLayerTemplate = layers
    .map((layer) => layer?.url || layer?.tileUrl || layer?.template)
    .find(Boolean);
  const template = frame?.url || frame?.tileUrl || frame?.template || firstLayerTemplate;
  const dataTemplate = frame?.dataUrl || frame?.dataTileUrl || frame?.encodedUrl || frame?.encodedTileUrl;
  if (!Number.isFinite(timestamp) || (!template && !dataTemplate && !layers.length)) return null;
  const maxZoom = Number(frame?.maxZoom ?? frame?.maxzoom ?? context.manifestMaxZoom);
  const minZoom = Number(frame?.minZoom ?? frame?.minzoom ?? context.manifestMinZoom);
  const frameDataEncoding = normalizeGeneratedMrmsDataEncoding(frame?.dataEncoding, context.dataEncoding);
  const normalized = {
    label: frame?.label || radarTimelineLabel(timestamp),
    time: frame?.time || new Date(timestamp).toISOString(),
    timestamp,
    url: template ? resolveGeneratedRadarUrl(template, context.manifestUrl) : "",
    dataUrl: dataTemplate ? resolveGeneratedRadarUrl(dataTemplate, context.manifestUrl) : "",
    dataEncoding: frameDataEncoding,
    source: "radar",
    sourceLabel: frame?.sourceLabel || "Radar",
    attribution: frame?.attribution || context.attribution,
    provider: "mrms-generated",
    style: frame?.style || context.style,
    manifestGeneratedAt: context.manifestGeneratedAt,
    manifestExpiresAt: context.manifestExpiresAt,
    sample: context.sample,
    coverageBounds: generatedCoverageBounds(frame?.coverageBounds) || context.coverageBounds,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : 14
  };
  const maxClientOverzoom = generatedRadarMaxClientOverzoom(frame) ?? context.maxClientOverzoom;
  if (Number.isFinite(maxClientOverzoom)) normalized.maxClientOverzoom = maxClientOverzoom;
  if (Number.isFinite(minZoom)) normalized.minZoom = minZoom;
  if (layers.length) {
    normalized.layers = layers
      .map((layer) => normalizeGeneratedMrmsLayer(layer, normalized.url, context.manifestUrl))
      .filter(Boolean);
  }
  return normalized;
}

function normalizeGeneratedMrmsLayer(layer, fallbackUrl, manifestUrl) {
  const template = layer?.url || layer?.tileUrl || layer?.template || fallbackUrl;
  const dataTemplate = layer?.dataUrl || layer?.dataTileUrl || layer?.encodedUrl || layer?.encodedTileUrl;
  if (!template && !dataTemplate) return null;
  const opacity = Number(layer?.opacity);
  return {
    url: template ? resolveGeneratedRadarUrl(template, manifestUrl) : "",
    dataUrl: dataTemplate ? resolveGeneratedRadarUrl(dataTemplate, manifestUrl) : "",
    dataEncoding: normalizeGeneratedMrmsDataEncoding(layer?.dataEncoding),
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(opacity, 1)) : 0.94
  };
}

function normalizeGeneratedMrmsDataEncoding(value, fallback = null) {
  const source = value && typeof value === "object" ? value : fallback;
  if (!source || typeof source !== "object") return null;
  const min = Number(source.min);
  const max = Number(source.max);
  const threshold = Number(source.threshold);
  const alpha = Number(source.alpha);
  return {
    type: source.type || "uint8-dbz",
    channel: source.channel || "r",
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) && max > (Number.isFinite(min) ? min : 0) ? max : 80,
    threshold: Number.isFinite(threshold) ? threshold : 5,
    alpha: Number.isFinite(alpha) ? alpha : 1.02,
    style: source.style || source.ramp || "banded"
  };
}

function generatedFrameTimestamp(frame) {
  if (Number.isFinite(Number(frame?.timestamp))) {
    const raw = Number(frame.timestamp);
    return raw < 100000000000 ? raw * 1000 : raw;
  }
  const value = frame?.time || frame?.validTime || frame?.observedAt;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function generatedManifestTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function generatedManifestCoversActivePlace(manifest) {
  const place = state.activePlace;
  if (!place) return true;
  const latitude = Number(place.latitude);
  const longitude = normalizeMapLongitude(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const areas = generatedManifestCoverageAreas(manifest);
  if (!areas.length) return true;
  return areas.some((bounds) => generatedBoundsContainPoint(bounds, latitude, longitude));
}

function generatedManifestCoversCurrentMapView(manifest) {
  const areas = generatedManifestCoverageAreas(manifest);
  return generatedRadarViewportEligibilityForSource(manifest, generatedMrmsSelectionContext(), areas).usable;
}

function generatedManifestCoverageAreas(manifest) {
  const areas = Array.isArray(manifest?.coverageAreas)
    ? manifest.coverageAreas
      .map((area) => generatedCoverageBounds(area?.bounds || area))
      .filter(Boolean)
    : [];
  const manifestBounds = generatedCoverageBounds(manifest?.coverageBounds);
  if (manifestBounds && !areas.some((area) => generatedBoundsEqual(area, manifestBounds))) {
    areas.push(manifestBounds);
  }
  return areas;
}

function generatedCoverageBounds(value) {
  if (Array.isArray(value) && value.length === 4) {
    return generatedCoverageBounds({
      minLat: value[0],
      minLon: value[1],
      maxLat: value[2],
      maxLon: value[3]
    });
  }
  if (!value || typeof value !== "object") return null;
  const minLat = Number(value.minLat);
  const minLon = normalizeMapLongitude(value.minLon);
  const maxLat = Number(value.maxLat);
  const maxLon = normalizeMapLongitude(value.maxLon);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  return {
    minLat: Math.min(minLat, maxLat),
    minLon,
    maxLat: Math.max(minLat, maxLat),
    maxLon
  };
}

function generatedBoundsContainPoint(bounds, latitude, longitude) {
  if (!bounds) return false;
  if (latitude < bounds.minLat || latitude > bounds.maxLat) return false;
  if (bounds.minLon <= bounds.maxLon) return longitude >= bounds.minLon && longitude <= bounds.maxLon;
  return longitude >= bounds.minLon || longitude <= bounds.maxLon;
}

function generatedBoundsEqual(a, b) {
  return a && b &&
    Math.abs(a.minLat - b.minLat) < 0.00001 &&
    Math.abs(a.minLon - b.minLon) < 0.00001 &&
    Math.abs(a.maxLat - b.maxLat) < 0.00001 &&
    Math.abs(a.maxLon - b.maxLon) < 0.00001;
}

function resolveGeneratedRadarUrl(template, manifestUrl) {
  if (!template) return "";
  const value = String(template);
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return restoreTileTemplateTokens(value);
  try {
    const protectedValue = protectTileTemplateTokens(value);
    const resolved = new URL(protectedValue, new URL(manifestUrl, window.location.href)).toString();
    return restoreTileTemplateTokens(resolved);
  } catch {
    return restoreTileTemplateTokens(value);
  }
}

const TILE_TEMPLATE_TOKENS = [
  ["{z}", "__NEARCAST_TILE_Z__"],
  ["{x}", "__NEARCAST_TILE_X__"],
  ["{y}", "__NEARCAST_TILE_Y__"],
  ["{bbox}", "__NEARCAST_TILE_BBOX__"],
  ["{bbox-epsg-3857}", "__NEARCAST_TILE_BBOX_3857__"]
];

function protectTileTemplateTokens(value) {
  let output = String(value || "");
  TILE_TEMPLATE_TOKENS.forEach(([token, marker]) => {
    output = output.split(token).join(marker);
  });
  return output;
}

function restoreTileTemplateTokens(value) {
  let output = String(value || "");
  TILE_TEMPLATE_TOKENS.forEach(([token, marker]) => {
    output = output.split(marker).join(token);
  });
  return output
    .replace(/%7Bz%7D/gi, "{z}")
    .replace(/%7Bx%7D/gi, "{x}")
    .replace(/%7By%7D/gi, "{y}")
    .replace(/%7Bbbox%7D/gi, "{bbox}")
    .replace(/%7Bbbox-epsg-3857%7D/gi, "{bbox-epsg-3857}");
}

function radarPrecipSignalKey(signal) {
  if (!signal) return "none";
  return [
    signal.placeId || "",
    signal.phase || "",
    signal.source || "",
    signal.timestamp || 0,
    signal.code || "",
    signal.confidence || ""
  ].join(":");
}

function currentRadarPrecipSignal(place = state.activePlace) {
  const signal = state.radarPrecipSignal;
  if (!signal || !place) return null;
  if (state.radarPrecipPlaceId !== place.id || signal.placeId !== place.id) return null;
  if (Date.now() - (signal.checkedAt || 0) > RADAR_PRECIP_CACHE_MS) return null;
  return signal;
}

async function startRadarPrecipProbe(place, data, force = false) {
  if (!place || !data) return;
  const placeId = place.id;
  const seq = ++state.radarPrecipSeq;
  try {
    const signal = await loadRadarPrecipSignal(place, { force });
    if (seq !== state.radarPrecipSeq || !state.activePlace || state.activePlace.id !== placeId) return;
    state.radarPrecipSignal = signal;
    state.radarPrecipPlaceId = placeId;
    if (state.forecast === data) {
      renderForecast(data, state.activePlace, {
        skip: ["daily", "map", "continuity"],
        reason: "radar-precip"
      });
    }
  } catch {
    if (seq !== state.radarPrecipSeq || !state.activePlace || state.activePlace.id !== placeId) return;
    state.radarPrecipSignal = {
      placeId,
      phase: "unavailable",
      confidence: "unavailable",
      source: "radar",
      timestamp: null,
      checkedAt: Date.now()
    };
  }
}

async function loadRadarPrecipSignal(place, options = {}) {
  const frames = await fetchRadarFrames();
  const frame = latestObservedRadarFrame(frames);
  const checkedAt = Date.now();
  if (!frame) {
    return {
      placeId: place.id,
      phase: "unavailable",
      confidence: "unavailable",
      source: "radar",
      timestamp: null,
      checkedAt
    };
  }

  let sampleFrame = frame;
  let z = Math.min(sampleFrame.maxZoom || RADAR_TILE_MAX_ZOOM, RADAR_PRECIP_SAMPLE_ZOOM);
  let cacheKey = radarPrecipCacheKey(place, sampleFrame, z);
  let cached = options.force ? null : readRadarPrecipCache(cacheKey);
  if (cached) return cached;

  let sample;
  try {
    sample = await sampleRadarFrameAtPlace(sampleFrame, place, z);
  } catch (error) {
    const fallbackFrame = await fallbackRainViewerRadarFrame(sampleFrame);
    if (!fallbackFrame) throw error;
    sampleFrame = fallbackFrame;
    z = Math.min(sampleFrame.maxZoom || RADAR_TILE_MAX_ZOOM, RADAR_PRECIP_SAMPLE_ZOOM);
    cacheKey = radarPrecipCacheKey(place, sampleFrame, z);
    cached = options.force ? null : readRadarPrecipCache(cacheKey);
    if (cached) return cached;
    sample = await sampleRadarFrameAtPlace(sampleFrame, place, z);
  }

  const signal = {
    placeId: place.id,
    phase: sample.phase,
    confidence: sample.confidence,
    source: sampleFrame.attribution || sampleFrame.sourceLabel || "Radar",
    timestamp: sampleFrame.timestamp,
    ageMin: Math.max(0, Math.round((Date.now() - sampleFrame.timestamp) / 60000)),
    code: sample.code,
    label: sample.label,
    detail: sample.detail,
    intensity: sample.intensity,
    stats: sample.stats,
    checkedAt
  };
  writeRadarPrecipCache(cacheKey, signal);
  return signal;
}

async function fallbackRainViewerRadarFrame(currentFrame) {
  const source = `${currentFrame?.attribution || ""} ${currentFrame?.sourceLabel || ""}`;
  if (/rainviewer/i.test(source)) return null;
  try {
    return latestObservedRadarFrame(await fetchRainViewerFrames());
  } catch {
    return null;
  }
}

function latestObservedRadarFrame(frames) {
  const now = Date.now();
  const observed = (frames || [])
    .filter((frame) => frame?.url && Number.isFinite(frame.timestamp))
    .filter((frame) => frame.timestamp <= now + 2 * 60 * 1000)
    .filter((frame) => now - frame.timestamp <= RADAR_PRECIP_MAX_FRAME_AGE_MS)
    .sort((a, b) => a.timestamp - b.timestamp);
  return observed.length ? observed[observed.length - 1] : null;
}

function radarPrecipCacheKey(place, frame, z) {
  const lat = Number(place.latitude || 0).toFixed(3);
  const lon = Number(place.longitude || 0).toFixed(3);
  return `radar-precip:${RADAR_PRECIP_CACHE_VERSION}:${place.id || `${lat},${lon}`}:${lat}:${lon}:${frame.source || "radar"}:${frame.timestamp}:${z}`;
}

function readRadarPrecipCache(cacheKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (cached && Date.now() - cached.checkedAt < RADAR_PRECIP_CACHE_MS) return cached;
  } catch {
    /* Ignore corrupt probe cache. */
  }
  return null;
}

function writeRadarPrecipCache(cacheKey, signal) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(signal));
  } catch {
    /* The probe is opportunistic; storage pressure should not block weather. */
  }
}

async function sampleRadarFrameAtPlace(frame, place, z) {
  const worldTiles = 2 ** z;
  const point = projectLatLon(place.latitude, place.longitude, z);
  const tileX = Math.floor(point.x / 256);
  const tileY = Math.floor(point.y / 256);
  if (tileY < 0 || tileY >= worldTiles) return radarUnavailableSample();

  const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
  const localX = Math.round(point.x - tileX * 256);
  const localY = Math.round(point.y - tileY * 256);
  const url = weatherTileUrl(frame.url, z, wrappedX, tileY);
  const imageData = await fetchRadarTileImageData(url);
  const center = radarSampleStats(imageData, localX, localY, RADAR_PRECIP_CENTER_RADIUS_PX);
  const nearby = radarSampleStats(imageData, localX, localY, RADAR_PRECIP_NEARBY_RADIUS_PX);
  const active = center.density >= 0.035 || center.maxScore >= 1.15 || (center.hits >= 2 && nearby.density >= 0.02);
  const near = nearby.density >= 0.028 || nearby.hits >= 7 || nearby.maxScore >= 1.3;
  const intensity = radarSampleIntensity(active ? center : nearby);
  const code = intensity === "heavy" ? 65 : intensity === "moderate" ? 63 : 61;
  const label = weatherCodes[code] || "Rain";

  if (active) {
    return {
      phase: "active",
      confidence: "observed",
      code,
      label,
      intensity,
      detail: `${label} on radar over this place`,
      stats: { center, nearby }
    };
  }
  if (near) {
    return {
      phase: "nearby",
      confidence: "nearby",
      code,
      label,
      intensity,
      detail: `${label} on radar nearby`,
      stats: { center, nearby }
    };
  }
  return {
    phase: "clear",
    confidence: "observed-clear",
    code: null,
    label: "Dry",
    intensity: "none",
    detail: "Radar is clear over this place",
    stats: { center, nearby }
  };
}

function radarUnavailableSample() {
  return {
    phase: "unavailable",
    confidence: "unavailable",
    code: null,
    label: "Radar unavailable",
    intensity: "unknown",
    detail: "Radar could not be sampled",
    stats: null
  };
}

async function fetchRadarTileImageData(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error("Radar tile sample failed.");
  const blob = await response.blob();
  const bitmap = await decodeRadarImageBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Radar tile canvas unavailable.");
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === "function") bitmap.close();
  return imageData;
}

async function decodeRadarImageBlob(blob) {
  if ("createImageBitmap" in window) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Radar tile decode failed."));
    };
    image.src = url;
  });
}

function radarSampleStats(imageData, cx, cy, radius) {
  let hits = 0;
  let score = 0;
  let maxScore = 0;
  let count = 0;
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(imageData.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(imageData.height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSq) continue;
      const index = (y * imageData.width + x) * 4;
      const pixelScore = radarPixelPrecipScore(
        imageData.data[index],
        imageData.data[index + 1],
        imageData.data[index + 2],
        imageData.data[index + 3]
      );
      count += 1;
      if (pixelScore > 0) {
        hits += 1;
        score += pixelScore;
        maxScore = Math.max(maxScore, pixelScore);
      }
    }
  }

  return {
    hits,
    count,
    score: Number(score.toFixed(2)),
    maxScore: Number(maxScore.toFixed(2)),
    density: count ? Number((hits / count).toFixed(3)) : 0
  };
}

function radarPixelPrecipScore(r, g, b, a) {
  if (a < 18) return 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;
  const brightness = (r + g + b) / 3;
  if (brightness < 18) return 0;
  if (saturation < 10 && a < 120) return 0;
  let score = Math.min(1, a / 210);
  if (saturation >= 24) score += 0.35;
  if (saturation >= 64) score += 0.25;
  if (r > 170 && g > 100) score += 0.2;
  return score;
}

function radarSampleIntensity(stats) {
  if (!stats) return "unknown";
  const density = Number(stats.density) || 0;
  const hitScore = stats.hits ? (Number(stats.score) || 0) / stats.hits : 0;
  const areaScore = stats.count ? (Number(stats.score) || 0) / stats.count : 0;

  // A single saturated radar pixel should prove "rain here", not "heavy rain".
  // Use coverage plus average signal so sparse tile artifacts stay light.
  if (
    density >= 0.28 ||
    areaScore >= 0.22 ||
    (density >= 0.18 && hitScore >= 1.35)
  ) return "heavy";
  if (
    density >= 0.10 ||
    areaScore >= 0.075 ||
    (density >= 0.05 && hitScore >= 1.18)
  ) return "moderate";
  if (stats.hits > 0) return "light";
  return "none";
}

async function fetchNwsRadarFrames() {
  const config = getNwsRadarConfig();
  if (!config) return [];

  const capabilities = await fetchNwsRadarCapabilities(config);
  const times = getNoaaLayerTimes(capabilities, config.layer);
  const recentTimes = selectNwsRadarTimes(times);

  return recentTimes.map((time) => buildNwsRadarFrame(config, time));
}

async function fetchNwsRadarCapabilities(config) {
  const cacheKey = `nws-radar-capabilities:${config.layer}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 60 * 1000;

  if (cached && Date.now() - cached.savedAt < maxCacheAge) {
    return cached.xml;
  }

  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetCapabilities"
  });
  const response = await fetchRadarMetadataWithTimeout(`${config.endpoint}?${params.toString()}`, {
    timeoutMs: RADAR_FALLBACK_METADATA_FETCH_TIMEOUT_MS
  });
  if (!response.ok) throw new Error("NWS radar capabilities failed.");
  const xml = await response.text();
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), xml }));
  return xml;
}

function selectNwsRadarTimes(times) {
  const cutoff = Date.now() - NWS_RADAR_WINDOW_MS;
  const parsed = times
    .map((time) => ({ time, timestamp: new Date(time).getTime() }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const recent = parsed.filter((item) => item.timestamp >= cutoff);
  return (recent.length ? recent : parsed)
    .slice(-NWS_RADAR_FRAME_LIMIT)
    .map((item) => item.time);
}

function buildNwsRadarFrame(config, time) {
  const timestamp = new Date(time).getTime();
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: config.layer,
    STYLES: config.style,
    CRS: "EPSG:3857",
    BBOX: "{bbox}",
    WIDTH: String(RADAR_WMS_TILE_SIZE),
    HEIGHT: String(RADAR_WMS_TILE_SIZE),
    FORMAT: "image/png",
    TRANSPARENT: "true",
    TIME: time,
    TILED: "true"
  });

  return {
    label: radarTimelineLabel(timestamp),
    time,
    timestamp,
    url: `${config.endpoint}?${params.toString()}`,
    source: "radar",
    sourceLabel: "Radar",
    attribution: "NOAA/NWS MRMS",
    // Cap below MAP_MAX_ZOOM so radar tiles upscale, but ask WMS for a denser
    // PNG per tile so the z8-z13 overzoom band has cleaner source pixels.
    maxZoom: RADAR_TILE_MAX_ZOOM
  };
}

async function fetchNoaaFutureRainFrames() {
  const region = getNoaaRegion();
  if (!region) return [];
  const layer = `${region}_6hr_precipitation_amount`;
  const style = "precipitation_amount";
  const capabilities = await fetchNoaaPrecipCapabilities();
  const times = getNoaaLayerTimes(capabilities, layer);
  const noaaFrames = times.map((time) => buildNoaaFrame(layer, style, time));

  return buildForecastTimelineFrames(noaaFrames);
}

function buildNoaaFrame(layer, style, time) {
  const timestamp = new Date(time).getTime();
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: layer,
    STYLES: style,
    CRS: "EPSG:3857",
    BBOX: "{bbox}",
    WIDTH: "256",
    HEIGHT: "256",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    TIME: time
  });

  return {
    label: forecastTimelineLabel(timestamp),
    time,
    timestamp,
    url: `https://nowcoast.noaa.gov/geoserver/forecasts/ndfd_precipitation/ows?${params.toString()}`,
    source: "forecast",
    sourceLabel: "Forecast guidance",
    attribution: "NOAA/NWS",
    maxZoom: 7
  };
}

function buildForecastTimelineFrames(noaaFrames) {
  if (!noaaFrames.length) return [];
  const frames = [];
  const now = Date.now();
  const lastNoaa = noaaFrames[noaaFrames.length - 1];
  const hour = 60 * 60 * 1000;
  const start = Math.ceil(now / hour) * hour;

  for (let timestamp = start; timestamp <= lastNoaa.timestamp; timestamp += hour) {
    frames.push(asForecastFrame(
      noaaFrames,
      forecastTimelineLabel(timestamp),
      timestamp
    ));
  }

  return frames;
}

function asForecastFrame(noaaFrames, label, timestamp) {
  const frame = noaaFrameAt(noaaFrames, timestamp);
  return {
    ...frame,
    label,
    timestamp
  };
}

function noaaFrameAt(frames, timestamp) {
  const surrounding = getSurroundingNoaaFrames(frames, timestamp);
  if (surrounding.from === surrounding.to) {
    return {
      ...surrounding.from,
      layers: [{ url: surrounding.from.url, opacity: 0.78 }]
    };
  }

  const ratio = (timestamp - surrounding.from.timestamp) / (surrounding.to.timestamp - surrounding.from.timestamp);
  return {
    ...surrounding.from,
    layers: [
      { url: surrounding.from.url, opacity: 0.78 * (1 - ratio) },
      { url: surrounding.to.url, opacity: 0.78 * ratio }
    ]
  };
}

function getSurroundingNoaaFrames(frames, timestamp) {
  if (timestamp <= frames[0].timestamp) return { from: frames[0], to: frames[0] };

  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (timestamp >= from.timestamp && timestamp <= to.timestamp) {
      return { from, to };
    }
  }

  const last = frames[frames.length - 1];
  return { from: last, to: last };
}

async function fetchNoaaPrecipCapabilities() {
  const cacheKey = "noaa-ndfd-precip-capabilities";
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 10 * 60 * 1000;

  if (cached && Date.now() - cached.savedAt < maxCacheAge) {
    return cached.xml;
  }

  const url = "https://nowcoast.noaa.gov/geoserver/ndfd_precipitation/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities";
  const response = await fetch(url);
  if (!response.ok) throw new Error("NOAA NDFD capabilities failed.");
  const xml = await response.text();
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), xml }));
  return xml;
}

function getNoaaLayerTimes(xml, layerName) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const layers = Array.from(doc.querySelectorAll("Layer"));
  const layer = layers.find((item) => item.querySelector(":scope > Name")?.textContent === layerName);
  const dimension = layer?.querySelector('Dimension[name="time"]');

  return (dimension?.textContent || "")
    .split(",")
    .map((time) => time.trim())
    .filter(Boolean);
}

function getNwsRadarConfig() {
  return NWS_RADAR_REGIONS[getNwsRadarRegion()] || null;
}

function getNwsRadarRegion(place = state.activePlace) {
  if (!place) return null;
  const latitude = Number(place.latitude);
  const longitude = normalizeMapLongitude(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  if (latitude >= 13 && latitude <= 15 && longitude >= 143 && longitude <= 146) return "guam";
  if (latitude >= 18 && latitude <= 23 && longitude >= -161 && longitude <= -154) return "hawaii";
  if (latitude >= 51 && latitude <= 72 && longitude >= -170 && longitude <= -129) return "alaska";
  if (latitude >= 5 && latitude <= 30 && longitude >= -90 && longitude <= -55) return "carib";
  if (latitude >= 20 && latitude <= 55 && longitude >= -130 && longitude <= -60) return "conus";
  return null;
}

function normalizeMapLongitude(value) {
  let longitude = Number(value);
  if (!Number.isFinite(longitude)) return NaN;
  while (longitude < -180) longitude += 360;
  while (longitude > 180) longitude -= 360;
  return longitude;
}

function getNoaaRegion() {
  const place = state.activePlace;
  if (!place) return null;
  const latitude = Number(place.latitude);
  const longitude = normalizeMapLongitude(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  if (latitude >= 18 && latitude <= 23 && longitude >= -161 && longitude <= -154) return "hawaii";
  if (latitude >= 51 && latitude <= 72 && longitude >= -170 && longitude <= -129) return "alaska";
  if (latitude >= 17 && latitude <= 19 && longitude >= -68 && longitude <= -65) return "puerto_rico";
  if (latitude >= 20 && latitude <= 55 && longitude >= -130 && longitude <= -60) return "conus";
  return null;
}

let timelineBubbleHideTimer = null;

function showFrame(index) {
  if (!mapState.frames.length) return;
  const perf = perfStart();
  const nextIndex = Math.min(Math.max(index, 0), mapState.frames.length - 1);
  mapState.frameIndex = nextIndex;
  els.frameSlider.value = String(nextIndex);
  updateRangeProgress(els.frameSlider);
  const frame = mapState.frames[nextIndex];

  syncMapSourceFromFrame(frame);
  setFrameLabel(frame.label);
  updateTimelineEraVisuals();
  if (mapRendererIsGl()) {
    renderMapLibreWeather(nextIndex);
    renderMapLibreMarkers();
  } else {
    renderWeatherTiles();
  }
  perfEnd("showFrame", perf);
}

function activeMapSource(frame = mapState.frames[mapState.frameIndex]) {
  return frame?.source === "forecast" ? "forecast" : "radar";
}

function syncMapSourceFromFrame(frame) {
  const source = activeMapSource(frame);
  const mode = source === "forecast" ? "future" : "radar";
  if (mapState.mode !== mode) {
    mapState.mode = mode;
    updateMapModeButtons();
  }
  renderMapLegend();
  renderMapCredit(frame);
  setPlaybackButtonState();
}

function renderMapCredit(frame = mapState.frames[mapState.frameIndex]) {
  const credit = mapCreditText(frame);
  const html = `${escapeHtml(credit)} · Map <a href="https://carto.com/basemaps/" target="_blank" rel="noreferrer">CARTO</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM</a>`;
  document.querySelectorAll("#mapCredit, #immCredit").forEach((node) => {
    node.innerHTML = html;
  });
}

function mapCreditText(frame) {
  if (activeMapSource(frame) === "forecast") return "Forecast NOAA/NWS nowCOAST/NDFD";
  if (frame?.provider === "mrms-generated") return `Radar ${frame.attribution || "NOAA MRMS · Nearcast"}`;
  if (frame?.attribution === "RainViewer") return "Radar RainViewer";
  if (frame?.attribution) return `Radar ${frame.attribution}`;
  return "Radar NOAA/NWS, RainViewer";
}

function updateMapModeButtons() {
  if (els.radarMode) els.radarMode.classList.toggle("active", mapState.mode === "radar");
  if (els.futureMode) els.futureMode.classList.toggle("active", mapState.mode === "future");
}

function updateTimelineEraVisuals() {
  const slider = els.frameSlider;
  if (!slider) return;
  const max = Math.max(0, mapState.frames.length - 1);
  const nowIndex = Number.isFinite(mapState.nowIndex) ? clamp(mapState.nowIndex, 0, max) : max;
  const nowProgress = max > 0 ? (nowIndex / max) * 100 : 100;
  slider.style.setProperty("--timeline-now", `${nowProgress}%`);
  slider.dataset.timelineKind = mapState.timelineKind;
  slider.dataset.source = activeMapSource();

  const marker = document.getElementById("immNowMarker");
  if (marker) {
    const showMarker = mapState.immersive && mapState.timelineKind === "precip" && mapState.frames.length > 1;
    marker.hidden = !showMarker;
    marker.style.left = `${nowProgress}%`;
  }
  renderTimelineTimeBubble();
}

function renderTimelineTimeBubble(options = {}) {
  const bubble = document.getElementById("immTimeBubble");
  const slider = els.frameSlider;
  const frame = mapState.frames[mapState.frameIndex];
  if (!bubble || !slider || !mapState.immersive || !frame) {
    hideTimelineTimeBubble(true);
    return;
  }

  const copy = timelineBubbleCopy(frame);
  bubble.querySelector("strong").textContent = copy.title;
  bubble.querySelector("span").textContent = copy.meta;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 0);
  const value = Number(slider.value || 0);
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 100;
  bubble.style.setProperty("--time-bubble-left", `${Math.min(Math.max(progress, 0), 100)}%`);
  bubble.dataset.source = activeMapSource(frame);

  if (options.show || mapState.playing) {
    bubble.hidden = false;
    requestAnimationFrame(() => bubble.classList.add("is-visible"));
  }
}

function showTimelineTimeBubble(durationMs = 1600) {
  clearTimelineBubbleTimer();
  renderTimelineTimeBubble({ show: true });
  if (mapState.playing) return;
  timelineBubbleHideTimer = setTimeout(() => hideTimelineTimeBubble(), durationMs);
}

function scheduleTimelineBubbleHide(durationMs = 900) {
  clearTimelineBubbleTimer();
  timelineBubbleHideTimer = setTimeout(() => hideTimelineTimeBubble(), durationMs);
}

function hideTimelineTimeBubble(force = false) {
  const bubble = document.getElementById("immTimeBubble");
  if (!bubble) return;
  if (!force && mapState.playing) return;
  clearTimelineBubbleTimer();
  bubble.classList.remove("is-visible");
  setTimeout(() => {
    if (!bubble.classList.contains("is-visible")) bubble.hidden = true;
  }, 180);
}

function clearTimelineBubbleTimer() {
  if (!timelineBubbleHideTimer) return;
  clearTimeout(timelineBubbleHideTimer);
  timelineBubbleHideTimer = null;
}

function timelineBubbleCopy(frame) {
  if (frame?.isNow) {
    return {
      title: "Now",
      meta: formatTimelineTime(frame.timestamp, { showMinutes: true, dayStyle: "none" })
    };
  }

  return {
    title: formatTimelineTime(frame.timestamp, {
      showMinutes: activeMapSource(frame) !== "forecast",
      dayStyle: "compact"
    }),
    meta: formatTimelineRelative(frame.timestamp)
  };
}

function updateRangeProgress(slider) {
  if (!slider) return;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 0);
  const value = Number(slider.value || 0);
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  slider.style.setProperty("--range-progress", `${Math.min(Math.max(progress, 0), 100)}%`);
}

function setPlaybackButtonState(button = els.playRadar, playing = mapState.playing) {
  if (!button) return;
  const noun = mapState.timelineKind === "precip"
    ? "precipitation timeline"
    : activeMapSource() === "forecast"
      ? "forecast animation"
      : "radar animation";
  const label = playing ? `Pause ${noun}` : `Play ${noun}`;
  button.setAttribute("aria-label", label);
  button.title = label;

  if (button.classList.contains("imm-play-button")) {
    button.classList.toggle("is-playing", playing);
    return;
  }

  button.textContent = playing ? "Pause" : "Play";
}

// Dragging the timeline is a manual scrub — pause playback so the loop and the
// finger don't fight, and hold the pause while the map stays in view.
function scrubToFrame(index) {
  if (mapState.playing) {
    mapState.userPausedRadar = true;
    stopRadarPlayback();
  }
  showFrame(index);
  showTimelineTimeBubble();
}

// Playback timing. The NWS MRMS frames are dense (≈2-min cadence, up to 30 of
// them), so a clean hard-cut between frames reads as fluid motion — exactly like
// scrubbing the slider. We aim for a ~4.5s loop, clamped to a sane per-frame
// range, and hold a beat on the latest frame before looping (radar convention).
const TARGET_LOOP_MS = 4500;
const MIN_STEP_MS = 90;
const MAX_STEP_MS = 380;
const LAST_FRAME_HOLD_MS = 700;

function radarStepMs(n) {
  return Math.min(Math.max(TARGET_LOOP_MS / Math.max(n, 1), MIN_STEP_MS), MAX_STEP_MS);
}

function frameUrl(frame) {
  return frame && (frame.url || (frame.layers && frame.layers[0] && frame.layers[0].url));
}

function playbackBounds() {
  const last = Math.max(0, mapState.frames.length - 1);
  if (mapState.timelineKind === "precip") {
    const nowIndex = Number.isFinite(mapState.nowIndex) ? clamp(mapState.nowIndex, 0, last) : last;
    if (mapState.frameIndex > nowIndex) {
      return { start: Math.min(nowIndex + 1, last), end: last, loop: false };
    }
    return { start: 0, end: nowIndex, loop: true };
  }
  if (mapState.timelineKind === "forecast" || activeMapSource() === "forecast") {
    return { start: 0, end: last, loop: false };
  }
  return { start: 0, end: last, loop: true };
}

function nextPlaybackIndexFrom(index, bounds = playbackBounds()) {
  if (index >= bounds.end) return bounds.loop ? bounds.start : bounds.end;
  return Math.min(index + 1, bounds.end);
}

function shouldBufferRadarPlayback(index = mapState.frameIndex) {
  if (!mapState.playing || !mapState.frames.length) return false;
  const bounds = playbackBounds();
  if (bounds.end <= bounds.start) return false;
  const current = mapState.frames[index];
  const next = mapState.frames[nextPlaybackIndexFrom(index, bounds)];
  return activeMapSource(current) === "radar" && activeMapSource(next) === "radar";
}

// Hard-cut radar render with a two-pane double-buffer: the current frame shows
// at full opacity while the NEXT frame preloads on the hidden pane (opacity 0),
// so advancing is an instant swap with no load flash and — crucially — no
// alpha-blend of two frames (which caused the pulsing/double-exposure).
function renderXfade(index, viewport = null) {
  const N = mapState.frames.length;
  if (!N || !els.weatherTileLayer) return;
  const perf = perfStart();
  const cur = ((index % N) + N) % N;
  const next = shouldBufferRadarPlayback(cur) ? nextPlaybackIndexFrom(cur) : cur;

  // Keep the two panes covering {cur, next}; reassign only the stale pane (which
  // is at opacity 0, so its reload is invisible).
  const frames = mapState.xfadeFrames;
  for (const need of [cur, next]) {
    if (frames[0] !== need && frames[1] !== need) {
      const other = need === cur ? next : cur;
      frames[frames[0] === other ? 1 : 0] = need;
    }
  }

  const vp = viewport || getMapViewport();
  for (let s = 0; s < 2; s++) {
    let pane = els.weatherTileLayer.children[s];
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "tile-sublayer";
      els.weatherTileLayer.appendChild(pane);
    }
    const f = frames[s];
    const frame = mapState.frames[f];
    const url = frameUrl(frame);
    const sourceZoom = weatherFrameSourceZoom(frame || MAP_MAX_ZOOM);
    if (url) {
      renderTileLayer(pane, vp, ({ z, x, y }) => weatherTileUrl(url, z, x, y), { sourceZoom });
      pane.style.filter = weatherVisualFilter(sourceZoom, frame);
    }
    pane.style.opacity = f === cur ? String(weatherVisualOpacity(weatherFrameDefaultOpacity(frame), sourceZoom)) : "0"; // hard cut; next preloads hidden
  }
  while (els.weatherTileLayer.children.length > 2) {
    els.weatherTileLayer.lastElementChild.remove();
  }
  perfEnd("renderXfade", perf);
}

function radarFramePane(frameIndex) {
  const paneIndex = mapState.xfadeFrames.findIndex((frame) => frame === frameIndex);
  return paneIndex >= 0 ? els.weatherTileLayer?.children[paneIndex] : null;
}

function radarPaneReady(frameIndex) {
  const pane = radarFramePane(frameIndex);
  if (!pane) return false;
  const images = [...pane.querySelectorAll(":scope > img")];
  return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0);
}

function waitForBufferedRadarFrame(frameIndex, now) {
  const ready = mapRendererIsGl()
    ? mapLibreBufferedRadarFrameReady(frameIndex)
    : radarPaneReady(frameIndex);
  if (ready) {
    mapState.frameWaitIndex = null;
    mapState.frameWaitStart = 0;
    return true;
  }

  if (mapState.frameWaitIndex !== frameIndex) {
    mapState.frameWaitIndex = frameIndex;
    mapState.frameWaitStart = now;
  }

  if (mapRendererIsGl()) return false;

  // Don't freeze forever on a failed or slow tile. Most frames are ready well
  // before this; this only keeps first-pass playback from outrunning warm tiles.
  return now - mapState.frameWaitStart > 1300;
}

function startRadarPlayback(options = {}) {
  if (mapState.playing || !mapState.frames.length) return;
  const { restartIfAtEnd = false } = options;
  const bounds = playbackBounds();
  if (bounds.end <= bounds.start) return;
  if (restartIfAtEnd && mapState.frameIndex >= bounds.end && bounds.end > bounds.start) {
    showFrame(bounds.start);
  }
  mapState.playing = true;
  setPlaybackButtonState();
  showTimelineTimeBubble();
  mapState.playAccum = 0;
  mapState.playClock = performance.now();
  mapState.frameWaitIndex = null;
  mapState.frameWaitStart = 0;
  const shouldBuffer = shouldBufferRadarPlayback(mapState.frameIndex);
  mapState.xfadeFrames = shouldBuffer ? [mapState.frameIndex, null] : [null, null];
  if (shouldBuffer) {
    if (mapRendererIsGl()) {
      renderMapLibreWeather(mapState.frameIndex); // show current + preload next immediately
    } else if (els.weatherTileLayer) {
      renderXfade(mapState.frameIndex); // show current + preload next immediately
    }
  }
  mapState.timer = requestAnimationFrame(playbackTick);
}

function playbackTick(now) {
  if (!mapState.playing) return;
  const N = mapState.frames.length;
  if (!N) { stopRadarPlayback(); return; }

  const dt = now - mapState.playClock;
  mapState.playClock = now;
  mapState.playAccum += dt;

  const bounds = playbackBounds();
  if (bounds.end <= bounds.start) { stopRadarPlayback(); return; }
  const rangeLength = bounds.end - bounds.start + 1;
  const stepMs = radarStepMs(rangeLength);
  // Hold an extra beat on the most recent frame before looping back to the start.
  const atEnd = mapState.frameIndex >= bounds.end;
  const interval = atEnd && bounds.loop ? stepMs + LAST_FRAME_HOLD_MS : stepMs;
  if (mapState.playAccum >= interval) {
    mapState.playAccum -= interval;
    if (atEnd && !bounds.loop) {
      showFrame(bounds.end);
      stopRadarPlayback({ renderStatic: false });
      return;
    }
    const idx = nextPlaybackIndexFrom(mapState.frameIndex, bounds);
    if (shouldBufferRadarPlayback(mapState.frameIndex)) {
      if (mapRendererIsGl()) renderMapLibreWeather(mapState.frameIndex);
      else renderXfade(mapState.frameIndex); // keep the upcoming hidden pane warming
      if (!waitForBufferedRadarFrame(idx, now)) {
        mapState.playAccum = interval;
        mapState.timer = requestAnimationFrame(playbackTick);
        return;
      }
      mapState.frameIndex = idx;
      if (mapRendererIsGl()) renderMapLibreWeather(idx);
      else renderXfade(idx); // hard swap to idx, preload idx+1
      els.frameSlider.value = String(idx);
      updateRangeProgress(els.frameSlider);
      syncMapSourceFromFrame(mapState.frames[idx]);
      setFrameLabel(mapState.frames[idx].label);
      updateTimelineEraVisuals();
    } else {
      showFrame(idx); // forecast frames are already interpolated — step discretely
    }
  }
  mapState.timer = requestAnimationFrame(playbackTick);
}

function toggleRadarPlayback() {
  if (!mapState.frames.length) return;
  if (mapState.playing) {
    mapState.userPausedRadar = true;
    stopRadarPlayback();
  } else {
    mapState.userPausedRadar = false;
    startRadarPlayback({ restartIfAtEnd: !mapState.immersive });
  }
}

// Auto-play the radar loop while the inline map is on screen; pause when it
// scrolls out of view. A manual pause disables scroll-triggered auto-play until
// the user presses Play again in this session. Immersive mode drives itself.
let mapInView = false;
let mapViewObserver = null;
let mapViewportSyncRaf = 0;

function mapViewVisibleForSkyPause() {
  const target = document.getElementById("mapView");
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight || 720;
  return rect.top < vh && rect.bottom > 0;
}

function syncSkyMotionForMap() {
  document.documentElement.classList.toggle("sky-motion-paused-for-map", Boolean(mapState.immersive || mapViewVisibleForSkyPause()));
}

function scheduleMapViewportMotionSync() {
  if (mapViewportSyncRaf) return;
  mapViewportSyncRaf = requestAnimationFrame(() => {
    mapViewportSyncRaf = 0;
    syncSkyMotionForMap();
  });
}

function maybeAutoPlayRadar() {
  if (mapState.immersive || !mapInView) return;
  if (mapState.timelineKind !== "radar") return;
  if (mapState.userPausedRadar || !mapState.frames.length) return;
  startRadarPlayback({ restartIfAtEnd: true });
}

function initMapAutoPlay() {
  if (mapViewObserver) return;
  const target = document.getElementById("mapView");
  if (!target || !("IntersectionObserver" in window)) return;
  mapViewObserver = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    mapInView = entry.isIntersecting && entry.intersectionRatio >= 0.4;
    syncSkyMotionForMap();
    if (mapInView) {
      maybeAutoPlayRadar();
    } else if (!mapState.immersive) {
      stopRadarPlayback();
    }
  }, { threshold: [0, 0.4, 0.75] });
  mapViewObserver.observe(target);

  // Don't keep the loop running in a backgrounded tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopRadarPlayback();
    else {
      syncSkyMotionForMap();
      maybeAutoPlayRadar();
    }
  });
  window.addEventListener("scroll", scheduleMapViewportMotionSync, { passive: true });
  window.addEventListener("resize", scheduleMapViewportMotionSync, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleMapViewportMotionSync, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleMapViewportMotionSync, { passive: true });
}

function stopRadarPlayback(options = {}) {
  const { renderStatic = true } = options;
  const wasPlaying = mapState.playing;
  mapState.playing = false;
  setPlaybackButtonState();
  if (mapState.timer) {
    cancelAnimationFrame(mapState.timer);
    mapState.timer = null;
  }
  mapState.xfadeFrames = [null, null];
  mapState.frameWaitIndex = null;
  mapState.frameWaitStart = 0;
  if (wasPlaying || mapState.immersive) scheduleTimelineBubbleHide();
  // Settle on the current frame as a clean, accurate static render.
  if (renderStatic && wasPlaying && mapState.frames.length) showFrame(mapState.frameIndex);
}

function clearMapLayers(options = {}) {
  stopRadarPlayback(options);
  mapState.frames = [];
  mapState.frameIndex = 0;
  mapState.nowIndex = 0;
  mapState.forecastUnavailable = false;
  els.frameSlider.max = "0";
  els.frameSlider.value = "0";
  updateRangeProgress(els.frameSlider);
  clearMapLibreWeather();
  els.weatherTileLayer.innerHTML = "";
  clearMapMarkerNodes();
  setFrameLabel("No frames");
  updateTimelineEraVisuals();
}

function setMapLoading(isLoading) {
  els.mapLoading.hidden = !isLoading;
}

function setFrameLabel(label) {
  els.frameLabel.textContent = label;
}

function renderMapLegend() {
  if (!els.mapLegend) return;
  const isForecast = activeMapSource() === "forecast";
  const sourceNotes = [];
  if (mapState.forecastUnavailable && mapState.timelineKind === "precip") {
    sourceNotes.push("Forecast map unavailable here");
  }
  const resolutionNote = weatherResolutionLegendNote();
  if (resolutionNote) sourceNotes.push(resolutionNote);
  const sourceNote = sourceNotes.join(" · ");
  const legend = isForecast
    ? {
        title: "Forecast precipitation",
        colors: ["#d8f0ff", "#8fd07e", "#f2df5a", "#e99446", "#c74767"],
        labels: ["Trace", "0.10 in", "0.25 in", "0.50 in", "1.00+ in"]
      }
    : {
        title: "Radar intensity",
        colors: ["#42aed6", "#3ecc69", "#eebc2a", "#e66f24", "#d6372b"],
        labels: ["Very light", "Light", "Steady", "Heavy", "Severe"]
      };

  els.mapLegend.innerHTML = `
    <div class="legend-header">
      <strong>${escapeHtml(legend.title)}</strong>
    </div>
    <div class="legend-scale" aria-hidden="true">
      ${legend.colors.map((color) => `<i style="background: ${color}"></i>`).join("")}
    </div>
    <div class="legend-labels">
      ${legend.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
    </div>
    ${sourceNote ? `<span class="legend-note">${escapeHtml(sourceNote)}</span>` : ""}
  `;
}

function clampMapZoom(value) {
  return Math.min(Math.max(value, MAP_MIN_ZOOM), MAP_MAX_ZOOM);
}

function mapTileSourceZoom(maxZoom = MAP_MAX_ZOOM) {
  const max = Math.max(MAP_MIN_ZOOM, Math.min(Math.floor(maxZoom || MAP_MAX_ZOOM), MAP_MAX_ZOOM));
  return Math.min(Math.max(Math.floor(mapState.zoom + 0.0001), MAP_MIN_ZOOM), max);
}

function weatherFrameMaxZoom(frameOrMaxZoom = MAP_MAX_ZOOM) {
  if (typeof frameOrMaxZoom === "number") {
    return Math.max(MAP_MIN_ZOOM, Math.min(Math.floor(frameOrMaxZoom || MAP_MAX_ZOOM), MAP_MAX_ZOOM));
  }

  const frame = frameOrMaxZoom || {};
  const forcedRadarZoom = frame.source === "radar" ? radarSourceZoomOverride() : null;
  const maxZoom = forcedRadarZoom || frame.maxZoom || MAP_MAX_ZOOM;
  return Math.max(MAP_MIN_ZOOM, Math.min(Math.floor(maxZoom), MAP_MAX_ZOOM));
}

function weatherFrameMinZoom(frameOrMinZoom = MAP_MIN_ZOOM) {
  if (typeof frameOrMinZoom === "number") {
    return Math.max(MAP_MIN_ZOOM, Math.min(Math.floor(frameOrMinZoom || MAP_MIN_ZOOM), MAP_MAX_ZOOM));
  }

  const frame = frameOrMinZoom || {};
  const minZoom = Number(frame.minZoom ?? frame.minzoom);
  return Number.isFinite(minZoom)
    ? Math.max(MAP_MIN_ZOOM, Math.min(Math.floor(minZoom), MAP_MAX_ZOOM))
    : MAP_MIN_ZOOM;
}

function weatherFrameSourceZoom(frameOrMaxZoom = MAP_MAX_ZOOM) {
  const max = weatherFrameMaxZoom(frameOrMaxZoom);
  return Math.min(Math.max(Math.floor(mapState.zoom + 0.5), MAP_MIN_ZOOM), max);
}

function weatherOverzoomAmount(sourceZoom) {
  const source = Number.isFinite(Number(sourceZoom)) ? Number(sourceZoom) : MAP_MAX_ZOOM;
  return Math.max(0, mapState.zoom - source);
}

function weatherSourceSofteningAmount(sourceZoom) {
  const overzoom = weatherOverzoomAmount(sourceZoom);
  const start = Number.isFinite(Number(WEATHER_SOURCE_SOFTEN_START_DELTA))
    ? Number(WEATHER_SOURCE_SOFTEN_START_DELTA)
    : 2;
  const full = Math.max(start + 1, Number.isFinite(Number(WEATHER_SOURCE_SOFTEN_FULL_DELTA))
    ? Number(WEATHER_SOURCE_SOFTEN_FULL_DELTA)
    : 8);
  if (overzoom <= start) return 0;
  return Math.min(Math.max((overzoom - start) / (full - start), 0), 1);
}

function weatherVisualOpacity(baseOpacity, sourceZoom) {
  const base = Math.min(Math.max(Number(baseOpacity) || 0, 0), 1);
  if (base <= MAPLIBRE_WEATHER_PRELOAD_OPACITY * 1.5) return base;
  return Number((base * weatherVisualTone(sourceZoom).opacity).toFixed(3));
}

function weatherVisualTone(sourceZoom, options = {}) {
  const t = weatherSourceSofteningAmount(sourceZoom);
  const generatedBoost = options?.generatedRadar || options?.provider === "mrms-generated" ? 1 : 0;
  return {
    opacity: 1 - 0.1 * t,
    cssSaturation: 1 + generatedBoost * 0.16 + t * 0.1,
    cssContrast: 1 + generatedBoost * 0.08 + t * 0.06,
    mapLibreSaturation: Number((generatedBoost * 0.22 + 0.12 * t).toFixed(3)),
    mapLibreContrast: Number((generatedBoost * 0.1 + 0.07 * t).toFixed(3))
  };
}

// Weather tiles are source-capped, so close street zoom should read like a
// smoothed field over the basemap instead of false block-level precision.
function weatherVisualFilter(sourceZoom, options = {}) {
  const overzoom = weatherOverzoomAmount(sourceZoom);
  const tone = weatherVisualTone(sourceZoom, options);
  const px = Math.min(Math.max(0.75 + overzoom * 0.48, 0.75), 7.25);
  return `blur(${px.toFixed(2)}px) saturate(${tone.cssSaturation.toFixed(2)}) contrast(${tone.cssContrast.toFixed(2)})`;
}

function weatherResolutionLegendNote() {
  const frame = mapState.frames[mapState.frameIndex];
  if (!frame) return "";
  const sourceZoom = weatherFrameSourceZoom(frame);
  if (weatherSourceSofteningAmount(sourceZoom) <= 0) return "";
  return activeMapSource(frame) === "forecast"
    ? "Forecast guidance is smoothed at street zoom"
    : "Radar is smoothed at street zoom";
}

function setMapZoom(nextZoom, anchorClientX = null, anchorClientY = null) {
  const newZoom = clampMapZoom(nextZoom);
  if (Math.abs(newZoom - mapState.zoom) < 0.001) return;
  if (mapRendererIsGl()) {
    const record = ensureMapLibreMap();
    if (record?.map) {
      const options = { duration: 0 };
      if (anchorClientX != null && anchorClientY != null && els.weatherMap) {
        const rect = els.weatherMap.getBoundingClientRect();
        options.around = record.map.unproject([anchorClientX - rect.left, anchorClientY - rect.top]);
      }
      record.map.zoomTo(newZoom, options);
      syncMapLibreStateAndOverlays(record.map);
      renderMapLegend();
      scheduleGeneratedRadarViewportRefresh("zoom");
      return;
    }
  }
  const scale = 2 ** (newZoom - mapState.zoom);

  if (anchorClientX != null && anchorClientY != null && state.activePlace && els.weatherMap) {
    const rect = els.weatherMap.getBoundingClientRect();
    const oldPlace = projectLatLon(state.activePlace.latitude, state.activePlace.longitude, mapState.zoom);
    const oldCenter = { x: oldPlace.x - mapState.panX, y: oldPlace.y - mapState.panY };
    const dx = anchorClientX - rect.left - rect.width / 2;
    const dy = anchorClientY - rect.top - rect.height / 2;
    const anchoredWorld = { x: oldCenter.x + dx, y: oldCenter.y + dy };
    const newPlace = projectLatLon(state.activePlace.latitude, state.activePlace.longitude, newZoom);
    const newCenter = {
      x: anchoredWorld.x * scale - dx,
      y: anchoredWorld.y * scale - dy
    };
    mapState.panX = newPlace.x - newCenter.x;
    mapState.panY = newPlace.y - newCenter.y;
  } else {
    mapState.panX *= scale;
    mapState.panY *= scale;
  }

  mapState.zoom = newZoom;
  renderMapLegend();
  renderTileMap();
  scheduleGeneratedRadarViewportRefresh("zoom");
}

function getMapViewport() {
  const rect = els.weatherMap.getBoundingClientRect();
  const place = projectLatLon(state.activePlace.latitude, state.activePlace.longitude, mapState.zoom);
  return {
    width: rect.width,
    height: rect.height,
    center: { x: place.x - mapState.panX, y: place.y - mapState.panY }
  };
}

function renderTileMap() {
  if (!mapState.initialized || !state.activePlace) return;
  const rect = els.weatherMap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  syncMapZoomDebugReadout();
  if (mapRendererIsGl()) {
    renderMapLibreMap();
    return;
  }
  if (els.weatherMap) els.weatherMap.classList.remove("is-gl-renderer");
  const perf = perfStart();
  if (dragState.anchorActive) clearMapPanTransform();

  const viewport = getMapViewport();
  const style = mapTileStyle();
  setMapTileTheme(style);
  renderTileLayer(els.baseTileLayer, viewport, baseTileUrl, { sourceZoom: mapTileSourceZoom() });
  if (shouldBufferRadarPlayback(mapState.frameIndex)) renderXfade(mapState.frameIndex, viewport);
  else renderWeatherTiles(viewport);
  renderTileLayer(els.labelTileLayer, viewport, labelTileUrl, { sourceZoom: mapTileSourceZoom() });
  if (mapState.immersive) updateImmersiveHUD();
  renderMapMarkers();
  renderStormImpactOverlay(viewport);
  if (dragState.anchorActive) {
    dragState.anchorPanX = mapState.panX;
    dragState.anchorPanY = mapState.panY;
  }
  perfEnd("renderTileMap", perf);
}

function mapTileStyle() {
  const isDark = document.documentElement.dataset.theme === "dark";
  return isDark
    ? {
        theme: "dark",
        base: "rastertiles/voyager_nolabels",
        labels: "rastertiles/voyager_only_labels"
      }
    : {
        theme: "light",
        base: "rastertiles/voyager_nolabels",
        labels: "rastertiles/voyager_only_labels"
      };
}

function setMapTileTheme(style) {
  [els.weatherMap, els.baseTileLayer, els.labelTileLayer].forEach((el) => {
    if (el) el.dataset.mapTheme = style.theme;
  });
}

function baseTileUrl({ z, x, y }) {
  const style = mapTileStyle();
  return cartoTileUrl(style.base, z, x, y);
}

function labelTileUrl({ z, x, y }) {
  const style = mapTileStyle();
  return cartoTileUrl(style.labels, z, x, y);
}

function cartoTileUrl(style, z, x, y) {
  const host = CARTO_TILE_HOSTS[Math.abs((x + y) % CARTO_TILE_HOSTS.length)];
  return `https://${host}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}.png`;
}

function weatherTileUrl(template, z, x, y) {
  return template
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("%7Bbbox%7D", tileBbox3857(z, x, y))
    .replace("{bbox}", tileBbox3857(z, x, y));
}

// Render an explicit set of weather sublayers, one pane each. Each weather
// sublayer (radar, a cross-fade pair, or two interpolated NOAA frames) gets its
// own pane: they share z/x/y tile keys, so a flat tile set would clobber, and
// separate panes let the cross-fade ride on each pane's opacity.
function renderWeatherLayers(layers, frameOrMaxZoom, viewport = null) {
  if (!mapState.initialized || !els.weatherTileLayer) return;
  layers = (layers || []).filter((l) => l && l.url && l.opacity > 0.01);
  while (els.weatherTileLayer.children.length > layers.length) {
    els.weatherTileLayer.lastElementChild.remove();
  }
  if (!layers.length) return;

  const tileViewport = viewport || getMapViewport();
  const sourceZoom = weatherFrameSourceZoom(frameOrMaxZoom || MAP_MAX_ZOOM);
  layers.forEach((layer, index) => {
    let pane = els.weatherTileLayer.children[index];
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "tile-sublayer";
      els.weatherTileLayer.appendChild(pane);
    }
    pane.style.opacity = String(weatherVisualOpacity(layer.opacity, sourceZoom));
    pane.style.filter = weatherVisualFilter(sourceZoom, frameOrMaxZoom);
    renderTileLayer(pane, tileViewport, ({ z, x, y }) => weatherTileUrl(layer.url, z, x, y), { sourceZoom });
  });
}

function renderWeatherTiles(viewport = null) {
  if (maybeSwitchGeneratedRadarToFallback(mapState.frameIndex, "generated-viewport-out-of-scope")) return;
  const frame = mapState.frames[mapState.frameIndex];
  const layers = (frame && state.activePlace)
    ? (frame.layers || [{ url: frame.url, opacity: weatherFrameDefaultOpacity(frame) }])
    : [];
  renderWeatherLayers(layers, frame, viewport);
}

// Extra tiles beyond the viewport keep fast pans from showing an edge while the
// next frame reconciles. Immersive gets a wider cushion because full-screen
// swipes are longer.
const TILE_BUFFER = 1;
const IMMERSIVE_TILE_BUFFER = 2;

function renderTileLayer(layer, viewport, urlForTile, options = {}) {
  if (!layer) return;
  const perf = perfStart();
  const tileNodes = mapLayerTileNodes(layer);
  const z = mapTileSourceZoom(options.sourceZoom || MAP_MAX_ZOOM);
  const tileSize = 256;
  const sourceScale = 2 ** (mapState.zoom - z);
  const displayTileSize = tileSize * sourceScale;
  const worldTiles = 2 ** z;
  const topLeft = {
    x: viewport.center.x - viewport.width / 2,
    y: viewport.center.y - viewport.height / 2
  };
  const sourceTopLeft = {
    x: topLeft.x / sourceScale,
    y: topLeft.y / sourceScale
  };
  const tileBuffer = mapState.immersive ? IMMERSIVE_TILE_BUFFER : TILE_BUFFER;
  const startX = Math.floor(sourceTopLeft.x / tileSize) - tileBuffer;
  const endX = Math.floor((sourceTopLeft.x + viewport.width / sourceScale) / tileSize) + tileBuffer;
  const startY = Math.floor(sourceTopLeft.y / tileSize) - tileBuffer;
  const endY = Math.floor((sourceTopLeft.y + viewport.height / sourceScale) / tileSize) + tileBuffer;

  // Reconcile against tiles already in the pane: reuse the ones still on screen
  // (just reposition them) and only create/remove at the edges. Rebuilding every
  // <img> each move is what made the map flash while panning.
  const wanted = new Set();
  for (let tileX = startX; tileX <= endX; tileX += 1) {
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (tileY < 0 || tileY >= worldTiles) continue;
      const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
      const key = `${z}/${tileX}/${tileY}`; // unwrapped tileX → distinct keys across the date line
      wanted.add(key);
      const url = urlForTile({ z, x: wrappedX, y: tileY });
      let img = tileNodes.get(key);
      if (img && !img.isConnected) {
        tileNodes.delete(key);
        img = null;
      }
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.loading = "eager";
        img.dataset.tile = key;
        img.addEventListener("load", () => {
          img.style.visibility = "";
          img.dataset.tries = "0";
          maybePurgeStaleTiles(layer); // drop the old zoom once this set has painted
        });
        img.addEventListener("error", () => onTileError(img, layer));
        layer.appendChild(img);
        tileNodes.set(key, img);
      }
      if (img.dataset.url !== url) {
        img.dataset.url = url;
        img.dataset.tries = "0";
        img.style.visibility = "";
        img.src = url;
      }
      img.style.width = `${Math.ceil(displayTileSize)}px`;
      img.style.height = `${Math.ceil(displayTileSize)}px`;
      img.style.left = `${Math.round(tileX * displayTileSize - topLeft.x)}px`;
      img.style.top = `${Math.round(tileY * displayTileSize - topLeft.y)}px`;
    }
  }

  // Same-zoom tiles that scrolled out of view are dropped immediately (panning has
  // the buffer to cover it). Tiles from the immediately previous zoom level are kept
  // under the new ones until the new set paints (so the map never blanks on zoom) —
  // but REALIGNED to the current zoom so they track it as a soft stand-in instead of
  // looking "stuck" at the old position. Older zoom levels are dropped outright.
  layer._wantedTiles = wanted;
  [...tileNodes.entries()].forEach(([key, img]) => {
    if (!img.isConnected) {
      tileNodes.delete(key);
      return;
    }
    if (wanted.has(key)) return;
    const parts = key.split("/");
    const tz = Number(parts[0]);
    if (tz === z || Math.abs(tz - z) > 1) {
      removeMapTile(layer, img, tileNodes);
      return;
    }
    const ts = tileSize * 2 ** (mapState.zoom - tz);
    img.style.width = `${Math.ceil(ts)}px`;
    img.style.height = `${Math.ceil(ts)}px`;
    img.style.left = `${Math.round(Number(parts[1]) * ts - topLeft.x)}px`;
    img.style.top = `${Math.round(Number(parts[2]) * ts - topLeft.y)}px`;
  });
  maybePurgeStaleTiles(layer);
  perfEnd("renderTileLayer", perf, PERF_RENDER_WARN_MS, {
    tiles: wanted.size,
    zoom: z
  });
}

function mapLayerTileNodes(layer) {
  if (!layer._tileNodes) {
    layer._tileNodes = new Map();
    layer.querySelectorAll(":scope > img[data-tile]").forEach((img) => {
      layer._tileNodes.set(img.dataset.tile, img);
    });
  }
  return layer._tileNodes;
}

function removeMapTile(layer, img, tileNodes = mapLayerTileNodes(layer)) {
  if (img?.dataset?.tile) tileNodes.delete(img.dataset.tile);
  img.remove();
}

// Remove leftover tiles (typically the previous zoom level) once every currently
// wanted tile has settled — called after each render and on each tile load, so the
// old view stays visible until the new one is ready.
function maybePurgeStaleTiles(layer) {
  const wanted = layer._wantedTiles;
  if (!wanted) return;
  const tileNodes = mapLayerTileNodes(layer);
  for (const key of wanted) {
    const img = tileNodes.get(key);
    if (!img || !img.complete) return; // new set hasn't finished loading yet
  }
  [...tileNodes.entries()].forEach(([key, img]) => {
    if (!wanted.has(key)) removeMapTile(layer, img, tileNodes);
  });
}

// A tile that fails to load should never show the browser's broken-image
// glyph (the "?" box). Hide it, then retry a couple of times with a short
// backoff to ride out transient OSM/RainViewer/NOAA hiccups. After that we
// give up quietly — a brief hole is far less jarring than a "?".
function onTileError(img, layer) {
  handleWeatherTileError(layer);
  img.style.visibility = "hidden";
  const tries = (Number(img.dataset.tries) || 0) + 1;
  img.dataset.tries = String(tries);
  if (tries > 2) return;
  const url = img.dataset.url;
  setTimeout(() => {
    // Only retry if this <img> is still the live tile for its key/url.
    if (img.isConnected && img.dataset.url === url) {
      img.src = `${url}${url.includes("?") ? "&" : "?"}retry=${tries}`;
    }
  }, 400 * tries);
}

function handleWeatherTileError(layer) {
  if (activeMapSource() !== "forecast") return;
  if (!els.weatherTileLayer || !els.weatherTileLayer.contains(layer)) return;
  setFrameLabel("Forecast unavailable");
}

function tileBbox3857(z, x, y) {
  const earthRadius = 6378137;
  const origin = Math.PI * earthRadius;
  const tileSize = 256;
  const resolution = (2 * origin) / (tileSize * 2 ** z);
  const minX = -origin + x * tileSize * resolution;
  const maxX = -origin + (x + 1) * tileSize * resolution;
  const maxY = origin - y * tileSize * resolution;
  const minY = origin - (y + 1) * tileSize * resolution;
  return [minX, minY, maxX, maxY].join(",");
}

function mapMarkerNodes() {
  const layer = els.markerLayer;
  if (!layer) return new Map();
  if (!layer._markerNodes) {
    layer._markerNodes = new Map();
    layer.querySelectorAll(":scope > .map-marker[data-marker-key]").forEach((node) => {
      layer._markerNodes.set(node.dataset.markerKey, node);
    });
  }
  return layer._markerNodes;
}

function clearMapMarkerNodes() {
  if (!els.markerLayer) return;
  els.markerLayer.innerHTML = "";
  if (els.markerLayer._markerNodes) els.markerLayer._markerNodes.clear();
}

function mapMarkerKey(place) {
  if (isActiveMapPlace(place)) return "active";
  if (place?.id) return `place:${place.id}`;
  const lat = Number(place?.latitude || 0).toFixed(5);
  const lon = Number(place?.longitude || 0).toFixed(5);
  return `place:${lat},${lon}`;
}

function mapMarkerData(place) {
  const key = mapMarkerKey(place);
  const isActive = isActiveMapPlace(place);
  const impact = stormImpactForPlace(place);
  const name = mapMarkerName(place);
  const tempText = mapState.immersive && isActive ? activeMapMarkerTemp() : "";
  const impactText = impact ? formatImpactMarkerEta(impact.etaMin) : "";
  const classNames = ["map-marker"];
  if (mapState.immersive && isActive) classNames.push("is-active-place");
  if (impact) classNames.push("has-impact", `is-impact-${impact.tone}`);
  const className = classNames.join(" ");
  const content = tempText || impactText
    ? `<span>${escapeHtml(name)}</span>${tempText ? `<strong>${escapeHtml(tempText)}</strong>` : ""}${impactText ? `<small>${escapeHtml(impactText)}</small>` : ""}`
    : escapeHtml(name);
  return {
    key,
    isActive,
    impact,
    name,
    tempText,
    impactText,
    className,
    content,
    signature: `${className}|${content}`
  };
}

function renderMapMarker(place, options = {}) {
  if (!state.activePlace) return;
  const viewport = options.viewport || getMapViewport();
  const layout = options.layout || mapMarkerLayout(place, viewport);
  if (!layout) return null;

  const { left, top } = layout;
  const markerNodes = options.markerNodes || mapMarkerNodes();
  const liveKeys = options.liveKeys || new Set();
  const markerData = mapMarkerData(place);

  let marker = markerNodes.get(markerData.key);
  if (!marker || !marker.isConnected) {
    marker = document.createElement("div");
    marker.dataset.markerKey = markerData.key;
    els.markerLayer.appendChild(marker);
    markerNodes.set(markerData.key, marker);
  }
  liveKeys.add(markerData.key);

  if (marker.dataset.signature !== markerData.signature) {
    marker.className = markerData.className;
    if (markerData.tempText || markerData.impactText) marker.innerHTML = markerData.content;
    else marker.textContent = markerData.name;
    marker.dataset.signature = markerData.signature;
  }

  marker.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0) translate(-50%, -100%)`;
  return layout;
}

function mapMarkerLayout(place, viewport = getMapViewport()) {
  if (!state.activePlace || !place) return null;
  const point = projectLatLon(place.latitude, place.longitude, mapState.zoom);
  const left = point.x - (viewport.center.x - viewport.width / 2);
  const top = point.y - (viewport.center.y - viewport.height / 2);

  if (left < -80 || left > viewport.width + 80 || top < -80 || top > viewport.height + 80) return;

  const isActive = isActiveMapPlace(place);
  const tempText = mapState.immersive && isActive ? activeMapMarkerTemp() : "";
  const impact = stormImpactForPlace(place);
  const impactText = impact ? formatImpactMarkerEta(impact.etaMin) : "";
  const name = mapMarkerName(place);
  return {
    left,
    top,
    bounds: mapMarkerBounds(left, top, estimateMapMarkerWidth(name, tempText, impactText), tempText || impactText ? 31 : 29)
  };
}

function mapMarkerName(place) {
  return place?.name || placeLabel(place);
}

function activeMapMarkerTemp() {
  return document.getElementById("nowTemp")?.textContent || "";
}

function estimateMapMarkerWidth(name, tempText = "", impactText = "") {
  const nameWidth = Math.min(112, String(name || "").length * 7.2);
  const tempWidth = tempText ? 10 + String(tempText).length * 8.4 : 0;
  const impactWidth = impactText ? 12 + String(impactText).length * 7.2 : 0;
  const width = 18 + nameWidth + tempWidth + impactWidth;
  return Math.max(tempText || impactText ? 92 : 74, Math.min(tempText || impactText ? 190 : 130, width));
}

function mapMarkerBounds(left, top, width, height) {
  return {
    left: left - width / 2 - 8,
    right: left + width / 2 + 8,
    top: top - height - 12,
    bottom: top + 12
  };
}

function mapBoundsOverlapAny(bounds, placedBounds) {
  return placedBounds.some((placed) => mapBoundsOverlap(bounds, placed));
}

function mapBoundsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isActiveMapPlace(place) {
  if (!place || !state.activePlace) return false;
  if (place.id && state.activePlace.id && place.id === state.activePlace.id) return true;
  return Math.abs(Number(place.latitude) - Number(state.activePlace.latitude)) < 0.0001 &&
    Math.abs(Number(place.longitude) - Number(state.activePlace.longitude)) < 0.0001;
}

function projectLatLon(latitude, longitude, zoom) {
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  const worldSize = 256 * 2 ** zoom;

  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  };
}

// ── Immersive Map ────────────────────────────────────────────
let immersiveDragAbort = null;
const impactTapState = {
  active: false,
  moved: false,
  startX: 0,
  startY: 0
};

function enterImmersiveMap() {
  if (mapState.immersive) return;
  stopRadarPlayback({ renderStatic: false });
  clearMapLibreInteractionState();
  mapState.immersive = true;
  document.body.classList.add("map-immersive-active");
  syncSkyMotionForMap();

  mapState._normalEls = {
    baseTileLayer: els.baseTileLayer,
    weatherTileLayer: els.weatherTileLayer,
    labelTileLayer: els.labelTileLayer,
    markerLayer: els.markerLayer,
    weatherMap: els.weatherMap,
    mapLoading: els.mapLoading,
    mapLegend: els.mapLegend,
    frameSlider: els.frameSlider,
    frameLabel: els.frameLabel,
    playRadar: els.playRadar,
  };

  els.baseTileLayer    = document.getElementById("immersiveBaseTiles");
  els.weatherTileLayer = document.getElementById("immersiveWeatherTiles");
  els.labelTileLayer   = document.getElementById("immersiveLabelTiles");
  els.markerLayer      = document.getElementById("immersiveMarker");
  els.weatherMap       = document.getElementById("immersiveMapCanvas");
  els.mapLoading       = document.getElementById("immersiveLoading");
  els.mapLegend        = document.getElementById("immersiveLegend");
  els.frameSlider      = document.getElementById("immSlider");
  els.frameLabel       = document.getElementById("immLabel");
  els.playRadar        = document.getElementById("immPlay");
  syncGeneratedRadarStatusChip();

  document.getElementById("immersiveMap").hidden = false;
  document.body.style.overflow = "hidden";

  // Sync slider range before rendering so scrubbing works immediately
  els.frameSlider.max   = String(Math.max(0, mapState.frames.length - 1));
  els.frameSlider.value = String(mapState.frameIndex);
  updateRangeProgress(els.frameSlider);
  setPlaybackButtonState(els.playRadar, mapState.playing);

  // Wait two frames so the browser has painted the full-screen canvas
  // before we measure its bounding rect for tile placement
  const renderImmersiveFrame = () => {
    renderTileMap();
    renderMapLegend();
    showFrame(mapState.frameIndex);
  };
  requestAnimationFrame(() => requestAnimationFrame(renderImmersiveFrame));
  setTimeout(renderImmersiveFrame, 140);
  loadMapFrames(true, { timelineKind: "precip", focusNow: true });

  updateImmersiveHUD();
  bindImmersiveModeButtons();
  if (mapRendererIsGl()) {
    if (immersiveDragAbort) {
      immersiveDragAbort.abort();
      immersiveDragAbort = null;
    }
  } else {
    bindImmersiveDrag();
  }
  document.addEventListener("keydown", onImmersiveKey);
}

function exitImmersiveMap() {
  if (!mapState.immersive || !mapState._normalEls) return;

  clearMapLibreInteractionState();
  stopXweatherStormLayer(mapLibreCurrentRecord(), "exit");
  clearStormImpact();
  Object.assign(els, mapState._normalEls);
  mapState._normalEls = null;
  mapState.immersive = false;
  syncSkyMotionForMap();
  els.frameSlider.max = String(Math.max(0, mapState.frames.length - 1));
  els.frameSlider.value = String(mapState.frameIndex);
  updateRangeProgress(els.frameSlider);
  setPlaybackButtonState(els.playRadar, mapState.playing);
  syncGeneratedRadarStatusChip();

  document.getElementById("immersiveMap").hidden = true;
  document.body.style.overflow = "";
  document.body.classList.remove("map-immersive-active");

  if (immersiveDragAbort) { immersiveDragAbort.abort(); immersiveDragAbort = null; }
  document.removeEventListener("keydown", onImmersiveKey);

  setTimeout(() => {
    loadMapFrames(true, { timelineKind: "radar", focusLatest: true });
    renderMapLegend();
  }, 40);
}

function onImmersiveKey(e) {
  if (e.key === "Escape") exitImmersiveMap();
}

function updateImmersiveHUD() {
  if (!state.activePlace) return;
  const card = document.getElementById("immWeatherCard");
  const placeName = (state.activePlace.name || placeLabel(state.activePlace)).split(",")[0].trim();
  const savedCount = state.savedPlaces.length;
  if (card) {
    const label = `Switch place from ${placeName}${savedCount ? `, ${savedCount} saved` : ""}`;
    card.setAttribute("aria-label", label);
    card.setAttribute("title", "Switch place");
  }
}

function bindImmersiveModeButtons() {
  bindTapAction(document.getElementById("collapseMap"), () => {
    guardNextClickThrough();
    exitImmersiveMap();
  });
  bindTapAction(document.getElementById("immWeatherCard"), openPlaceSheet);
  bindTapAction(document.getElementById("immPlay"), toggleRadarPlayback);
  const slider = document.getElementById("immSlider");
  slider.oninput = (e) => scrubToFrame(Number(e.target.value));
  slider.onpointerdown = () => showTimelineTimeBubble(2400);
  slider.onpointerup = () => showTimelineTimeBubble();
  slider.onpointercancel = () => scheduleTimelineBubbleHide();
  slider.onblur = () => scheduleTimelineBubbleHide(300);
  slider.onkeydown = () => showTimelineTimeBubble(1400);
}

function bindImmersiveDrag() {
  immersiveDragAbort = new AbortController();
  const sig = immersiveDragAbort.signal;
  const canvas = document.getElementById("immersiveMapCanvas");

  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startStormImpactTap(e.clientX, e.clientY);
    startMapDrag(e.clientX, e.clientY, canvas);
  }, { signal: sig });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cancelStormImpactTap();
    zoomMapFromWheel(e);
  }, { passive: false, signal: sig });
  window.addEventListener("mousemove", (e) => {
    updateStormImpactTap(e.clientX, e.clientY);
    moveMapDrag(e.clientX, e.clientY);
  }, { signal: sig });
  window.addEventListener("mouseup", (e) => {
    const shouldInspect = finishStormImpactTap(e.clientX, e.clientY, canvas);
    endMapGesture(canvas);
    if (shouldInspect) inspectStormImpactAt(e.clientX, e.clientY);
  }, { signal: sig });

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      cancelStormImpactTap();
      startMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    const t = e.touches[0];
    startStormImpactTap(t.clientX, t.clientY);
    startMapDrag(t.clientX, t.clientY, canvas);
  }, { passive: false, signal: sig });
  window.addEventListener("touchmove", (e) => {
    if (pinchState.active && e.touches.length === 2) {
      e.preventDefault();
      cancelStormImpactTap();
      moveMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      updateStormImpactTap(t.clientX, t.clientY);
      moveMapDrag(t.clientX, t.clientY);
    }
  }, { passive: false, signal: sig });
  window.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const shouldInspect = t ? finishStormImpactTap(t.clientX, t.clientY, canvas) : false;
    endMapGesture(canvas);
    if (shouldInspect && t) inspectStormImpactAt(t.clientX, t.clientY);
  }, { signal: sig });
  window.addEventListener("touchcancel", () => {
    cancelStormImpactTap();
    endMapGesture(canvas);
  }, { signal: sig });
}

function startStormImpactTap(x, y) {
  if (!mapState.immersive || !state.activePlace) return;
  impactTapState.active = true;
  impactTapState.moved = false;
  impactTapState.startX = x;
  impactTapState.startY = y;
}

function updateStormImpactTap(x, y) {
  if (!impactTapState.active || impactTapState.moved) return;
  const dx = x - impactTapState.startX;
  const dy = y - impactTapState.startY;
  if (Math.hypot(dx, dy) > MAP_TAP_MOVE_PX) impactTapState.moved = true;
}

function finishStormImpactTap(x, y, canvas = els.weatherMap) {
  updateStormImpactTap(x, y);
  const rect = canvas?.getBoundingClientRect();
  const inside = rect
    ? x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    : false;
  const shouldInspect = impactTapState.active && !impactTapState.moved && inside && mapState.immersive && Boolean(state.activePlace);
  cancelStormImpactTap();
  return shouldInspect;
}

function cancelStormImpactTap() {
  impactTapState.active = false;
  impactTapState.moved = false;
}

async function inspectStormImpactAt(clientX, clientY) {
  const target = mapLatLonFromClientPoint(clientX, clientY);
  if (!target) return;

  const seq = ++mapState.stormImpact.seq;
  const selectedFrame = mapState.frames[mapState.frameIndex] || null;
  mapState.stormImpact.status = "loading";
  mapState.stormImpact.analysis = {
    target,
    tapSource: activeMapSource(selectedFrame),
    selectedTimestamp: selectedFrame?.timestamp || null
  };
  renderStormImpactCard();
  renderStormImpactOverlay();

  try {
    const analysis = await analyzeStormImpactAtPoint(target, {
      tapSource: activeMapSource(selectedFrame),
      selectedFrame
    });
    if (seq !== mapState.stormImpact.seq) return;
    mapState.stormImpact.status = "ready";
    mapState.stormImpact.analysis = analysis;
  } catch {
    if (seq !== mapState.stormImpact.seq) return;
    mapState.stormImpact.status = "error";
    mapState.stormImpact.analysis = {
      target,
      tapSource: activeMapSource(selectedFrame),
      selectedTimestamp: selectedFrame?.timestamp || null,
      title: "Radar check unavailable",
      summary: "Nearcast could not sample the radar tiles for this spot. Try again in a moment."
    };
  }

  renderStormImpactCard();
  renderTileMap();
}

function clearStormImpact(options = {}) {
  if (!mapState.stormImpact) return;
  mapState.stormImpact.seq += 1;
  mapState.stormImpact.status = "idle";
  mapState.stormImpact.analysis = null;
  if (els.stormImpactCard) els.stormImpactCard.hidden = true;
  const layer = document.getElementById("immersiveImpactLayer");
  if (layer) layer.innerHTML = "";
  if (options.render !== false && mapState.immersive && mapState.initialized && state.activePlace) renderTileMap();
}

async function analyzeStormImpactAtPoint(target, options = {}) {
  const base = {
    target,
    tapSource: options.tapSource || activeMapSource(),
    selectedTimestamp: options.selectedFrame?.timestamp || null,
    hasPrecip: false,
    hasObservedPrecip: false,
    impacts: [],
    closestMiss: null,
    source: "Radar"
  };

  const observed = await analyzeObservedStormImpactAtPoint(target, base);
  const shouldUseForecast = base.tapSource === "forecast" || !observed.impacts.length;
  if (!shouldUseForecast) return observed;

  const guidance = await analyzeForecastGuidanceAtPoint(target, options).catch(() => null);
  return mergeStormImpactGuidance(observed, guidance);
}

async function analyzeObservedStormImpactAtPoint(target, base) {
  const frames = selectStormImpactFrames(await fetchRadarFrames());

  if (!frames.length) {
    return {
      ...base,
      title: "Radar unavailable here",
      summary: "No recent observed radar frames are available for this map area."
    };
  }

  const z = STORM_IMPACT_SAMPLE_ZOOM;
  const tileCache = new Map();
  const settled = await Promise.allSettled(
    frames.map((frame) => sampleStormImpactFrame(frame, target, z, tileCache))
  );
  const samples = settled
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value)
    .sort((a, b) => a.timestamp - b.timestamp);
  const latestSample = samples[samples.length - 1] || null;
  const source = latestSample?.source || frames[frames.length - 1]?.attribution || frames[frames.length - 1]?.sourceLabel || "Radar";

  if (!latestSample || !isSignificantStormSample(latestSample)) {
    return {
      ...base,
      source,
      title: "No selected storm",
      summary: base.tapSource === "forecast"
        ? "This forecast frame is display guidance; storm impact uses the latest observed radar, which is weak or clear at this spot."
        : "The latest radar is weak or clear where you tapped."
    };
  }

  const significant = samples.filter(isSignificantStormSample);
  const motion = estimateStormMotion(significant);
  const latestWorld = latestSample.centroidWorld || latestSample.targetWorld;
  const latestLatLon = unprojectWorldPoint(latestWorld, z);
  const radiusPx = stormImpactRadius(latestSample);
  const places = stormImpactPlaces();
  const selection = stormImpactSelection(latestSample);
  const impactResult = computeStormImpacts({
    latestWorld,
    latestLatLon,
    motion,
    radiusPx,
    selection,
    places,
    z
  });

  const analysis = {
    ...base,
    z,
    source,
    hasPrecip: true,
    hasObservedPrecip: true,
    label: stormImpactRainLabel(latestSample),
    intensity: latestSample.intensity,
    frameTimestamp: latestSample.timestamp,
    sampleCount: samples.length,
    motion,
    radiusPx,
    latestWorld,
    latestLatLon,
    selection,
    impacts: impactResult.impacts,
    closestMiss: impactResult.closestMiss
  };
  analysis.title = stormImpactTitle(analysis);
  analysis.summary = stormImpactSummary(analysis);
  return analysis;
}

async function analyzeForecastGuidanceAtPoint(target, options = {}) {
  const frames = selectStormForecastFrames(await fetchNoaaFutureRainFrames(), options);
  if (!frames.length) return null;

  const z = STORM_FORECAST_SAMPLE_ZOOM;
  const tileCache = new Map();
  const places = stormImpactPlaces();
  const targetSamples = await Promise.allSettled(
    frames.map((frame) => sampleForecastGuidanceFrame(frame, target, z, tileCache))
  );
  const targetByTimestamp = new Map();
  const targetSignals = [];
  targetSamples.forEach((result) => {
    if (result.status !== "fulfilled" || !result.value) return;
    targetByTimestamp.set(result.value.timestamp, result.value);
    if (isSignificantForecastSample(result.value)) targetSignals.push(result.value);
  });

  const tapHasForecastSignal = targetSignals.length > 0;
  if (!tapHasForecastSignal && options.tapSource !== "forecast") return null;

  const impacts = [];
  for (const place of places) {
    let best = null;
    for (const frame of frames) {
      const targetSample = targetByTimestamp.get(frame.timestamp);
      const targetSignal = isSignificantForecastSample(targetSample);
      if (!tapHasForecastSignal && !targetSignal && options.tapSource !== "forecast") continue;

      const placeSample = await sampleForecastGuidanceFrame(frame, place, z, tileCache).catch(() => null);
      if (!isSignificantForecastSample(placeSample)) continue;

      const etaMin = Math.max(0, Math.round((frame.timestamp - Date.now()) / 60000));
      const placeWorld = projectLatLon(place.latitude, place.longitude, z);
      const targetWorld = projectLatLon(target.latitude, target.longitude, z);
      const distancePx = Math.hypot(placeWorld.x - targetWorld.x, placeWorld.y - targetWorld.y);
      const impact = {
        place,
        placeKey: stormImpactPlaceKey(place),
        placeName: mapMarkerName(place),
        tone: targetSignal || distancePx <= STORM_IMPACT_NEAR_PATH_RADIUS_PX * 1.6 ? "possible" : "nearby",
        toneLabel: "Forecast",
        impactSource: "forecast",
        etaMin,
        timestamp: frame.timestamp,
        crossPx: distancePx,
        closestMin: etaMin,
        distanceLabel: formatImpactDistance(distancePx, place.latitude, z),
        detail: `Forecast guidance shows precipitation near this place around ${formatTimelineTime(frame.timestamp)}.`
      };
      if (!best || impact.etaMin < best.etaMin) best = impact;
    }
    if (best) impacts.push(best);
  }

  impacts.sort((a, b) => a.etaMin - b.etaMin);
  const firstTarget = targetSignals[0] || null;
  return {
    source: "Forecast guidance",
    hasForecastPrecip: tapHasForecastSignal || impacts.length > 0,
    label: "Forecast rain",
    z,
    targetSignal: firstTarget,
    impacts: impacts.slice(0, 5)
  };
}

function mergeStormImpactGuidance(observed, guidance) {
  if (!guidance?.hasForecastPrecip) return observed;

  const observedKeys = new Set((observed.impacts || []).map((impact) => impact.placeKey));
  const forecastImpacts = (guidance.impacts || [])
    .filter((impact) => !observedKeys.has(impact.placeKey));
  const impacts = [...(observed.impacts || []), ...forecastImpacts]
    .sort((a, b) => (a.etaMin - b.etaMin) || impactSourceRank(a) - impactSourceRank(b));

  const merged = {
    ...observed,
    source: observed.hasObservedPrecip ? `${observed.source} + Forecast guidance` : "Forecast guidance",
    hasPrecip: observed.hasPrecip || guidance.hasForecastPrecip,
    label: observed.hasPrecip ? observed.label : guidance.label,
    forecastGuidance: guidance,
    impacts,
    closestMiss: impacts.length ? null : observed.closestMiss
  };
  merged.title = stormImpactTitle(merged);
  merged.summary = stormImpactSummary(merged);
  return merged;
}

function impactSourceRank(impact) {
  return impact?.impactSource === "forecast" ? 1 : 0;
}

function selectStormImpactFrames(frames) {
  const now = Date.now();
  const observed = [...(frames || [])]
    .filter((frame) => frame?.url && Number.isFinite(frame.timestamp))
    .filter((frame) => frame.timestamp <= now + 2 * 60 * 1000)
    .filter((frame) => now - frame.timestamp <= STORM_IMPACT_MAX_FRAME_AGE_MS)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (observed.length <= STORM_IMPACT_FRAME_LIMIT) return observed;
  const recent = observed.slice(-STORM_IMPACT_FRAME_LIMIT * 2);
  const stride = Math.max(1, Math.ceil(recent.length / STORM_IMPACT_FRAME_LIMIT));
  return recent
    .filter((_, index) => index % stride === 0 || index === recent.length - 1)
    .slice(-STORM_IMPACT_FRAME_LIMIT);
}

function selectStormForecastFrames(frames, options = {}) {
  const now = Date.now();
  const selectedTimestamp = options.selectedFrame?.source === "forecast" && Number.isFinite(options.selectedFrame.timestamp)
    ? options.selectedFrame.timestamp
    : null;
  const start = selectedTimestamp ? selectedTimestamp - 15 * 60 * 1000 : now;
  const end = selectedTimestamp
    ? selectedTimestamp + Math.min(STORM_FORECAST_LOOKAHEAD_MS, 2 * 60 * 60 * 1000)
    : now + STORM_FORECAST_LOOKAHEAD_MS;

  const selected = [...(frames || [])]
    .filter((frame) => frame?.url || frame?.layers?.length)
    .filter((frame) => Number.isFinite(frame.timestamp))
    .filter((frame) => frame.timestamp >= start && frame.timestamp <= end)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (selected.length <= STORM_FORECAST_FRAME_LIMIT) return selected;
  const stride = Math.max(1, Math.ceil(selected.length / STORM_FORECAST_FRAME_LIMIT));
  return selected
    .filter((_, index) => index % stride === 0 || index === selected.length - 1)
    .slice(0, STORM_FORECAST_FRAME_LIMIT);
}

async function sampleStormImpactFrame(frame, target, z, tileCache) {
  const targetWorld = projectLatLon(target.latitude, target.longitude, z);
  const stats = await radarStormCellStats(frame, targetWorld, z, tileCache) ||
    await radarAreaStats(frame, targetWorld, z, STORM_IMPACT_SAMPLE_RADIUS_PX, tileCache);
  const centroidWorld = stats.totalScore > 0
    ? { x: targetWorld.x + stats.centroidDx, y: targetWorld.y + stats.centroidDy }
    : targetWorld;
  const intensity = radarSampleIntensity(stats);
  return {
    ...stats,
    frame,
    source: frame.attribution || frame.sourceLabel || "Radar",
    timestamp: frame.timestamp,
    targetWorld,
    centroidWorld,
    intensity
  };
}

async function sampleForecastGuidanceFrame(frame, target, z, tileCache) {
  const targetWorld = projectLatLon(target.latitude, target.longitude, z);
  const stats = await weatherFrameAreaStats(frame, targetWorld, z, STORM_FORECAST_SAMPLE_RADIUS_PX, tileCache);
  if (!stats) return null;
  const centroidWorld = stats.totalScore > 0
    ? { x: targetWorld.x + stats.centroidDx, y: targetWorld.y + stats.centroidDy }
    : targetWorld;
  return {
    ...stats,
    frame,
    source: frame.attribution || frame.sourceLabel || "Forecast guidance",
    timestamp: frame.timestamp,
    targetWorld,
    centroidWorld,
    intensity: radarSampleIntensity(stats)
  };
}

async function weatherFrameAreaStats(frame, targetWorld, z, radiusPx, tileCache) {
  const layers = (frame.layers?.length ? frame.layers : [{ url: frame.url, opacity: 1 }])
    .filter((layer) => layer?.url);
  if (!layers.length) return null;

  const settled = await Promise.allSettled(
    layers.map((layer) => radarAreaStats({ url: layer.url }, targetWorld, z, radiusPx, tileCache))
  );
  const samples = settled
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
  if (!samples.length) return null;
  return samples.sort((a, b) => forecastSampleScore(b) - forecastSampleScore(a))[0];
}

async function radarStormCellStats(frame, targetWorld, z, tileCache) {
  const radiusPx = STORM_IMPACT_CELL_SCAN_RADIUS_PX;
  const step = Math.max(1, STORM_IMPACT_CELL_GRID_STEP_PX);
  const worldTiles = 2 ** z;
  const minX = Math.floor(targetWorld.x - radiusPx);
  const maxX = Math.ceil(targetWorld.x + radiusPx);
  const minY = Math.floor(targetWorld.y - radiusPx);
  const maxY = Math.ceil(targetWorld.y + radiusPx);
  const startTileX = Math.floor(minX / 256);
  const endTileX = Math.floor(maxX / 256);
  const startTileY = Math.floor(minY / 256);
  const endTileY = Math.floor(maxY / 256);
  const tiles = new Map();
  const loads = [];

  for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
    for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
      if (tileY < 0 || tileY >= worldTiles) continue;
      const key = `${tileX}/${tileY}`;
      loads.push(radarTileImageDataForSample(frame, z, tileX, tileY, tileCache).then((imageData) => {
        if (imageData) tiles.set(key, imageData);
      }));
    }
  }

  await Promise.all(loads);
  if (!tiles.size) return null;

  const gridWidth = Math.floor((maxX - minX) / step) + 1;
  const gridHeight = Math.floor((maxY - minY) / step) + 1;
  const scores = new Float32Array(gridWidth * gridHeight);
  const wet = new Uint8Array(gridWidth * gridHeight);
  const core = new Uint8Array(gridWidth * gridHeight);
  const scanRadiusSq = radiusPx * radiusPx;
  const seedRadiusSq = STORM_IMPACT_CELL_SEED_RADIUS_PX * STORM_IMPACT_CELL_SEED_RADIUS_PX;
  let count = 0;
  let seedIndex = -1;
  let seedScore = 0;
  let seedDistanceSq = Infinity;

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const y = minY + gy * step;
    const dy = y - targetWorld.y;
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = minX + gx * step;
      const dx = x - targetWorld.x;
      const distSq = dx * dx + dy * dy;
      if (distSq > scanRadiusSq) continue;

      count += 1;
      const score = radarWorldPixelScore(tiles, x, y);
      if (score < STORM_IMPACT_CELL_HALO_SCORE) continue;

      const index = gy * gridWidth + gx;
      scores[index] = score;
      wet[index] = 1;
      if (score >= STORM_IMPACT_CELL_CORE_SCORE) core[index] = 1;
      if (core[index] && distSq <= seedRadiusSq && (score > seedScore || (score === seedScore && distSq < seedDistanceSq))) {
        seedIndex = index;
        seedScore = score;
        seedDistanceSq = distSq;
      }
    }
  }

  if (seedIndex < 0) return null;

  const visited = new Uint8Array(wet.length);
  const queue = new Int32Array(wet.length);
  const cellIndices = [];
  const maxGap = Math.max(1, Math.ceil(STORM_IMPACT_CELL_MERGE_RADIUS_PX / step), STORM_IMPACT_CELL_GAP_CELLS);
  const maxSelectedCells = Math.max(36, Math.floor(count * STORM_IMPACT_CELL_MAX_AREA_FRACTION));
  let capped = false;
  let head = 0;
  let tail = 0;
  queue[tail] = seedIndex;
  tail += 1;
  visited[seedIndex] = 1;

  while (head < tail) {
    const index = queue[head];
    head += 1;
    cellIndices.push(index);
    if (cellIndices.length >= maxSelectedCells) {
      capped = head < tail;
      break;
    }
    const gx = index % gridWidth;
    const gy = Math.floor(index / gridWidth);

    for (let oy = -maxGap; oy <= maxGap; oy += 1) {
      for (let ox = -maxGap; ox <= maxGap; ox += 1) {
        if (!ox && !oy) continue;
        if (ox * ox + oy * oy > maxGap * maxGap) continue;
        const nx = gx + ox;
        const ny = gy + oy;
        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
        const nextIndex = ny * gridWidth + nx;
        if (visited[nextIndex] || !wet[nextIndex]) continue;
        visited[nextIndex] = 1;
        queue[tail] = nextIndex;
        tail += 1;
      }
    }
  }

  if (!cellIndices.length) return null;

  const selected = new Uint8Array(wet.length);
  cellIndices.forEach((index) => {
    selected[index] = 1;
  });

  let hits = 0;
  let totalScore = 0;
  let maxScore = 0;
  let sumX = 0;
  let sumY = 0;
  let minCellX = Infinity;
  let maxCellX = -Infinity;
  let minCellY = Infinity;
  let maxCellY = -Infinity;

  cellIndices.forEach((index) => {
    const score = scores[index];
    const gx = index % gridWidth;
    const gy = Math.floor(index / gridWidth);
    const x = minX + gx * step;
    const y = minY + gy * step;
    hits += 1;
    totalScore += score;
    maxScore = Math.max(maxScore, score);
    sumX += (x - targetWorld.x) * score;
    sumY += (y - targetWorld.y) * score;
    minCellX = Math.min(minCellX, x);
    maxCellX = Math.max(maxCellX, x);
    minCellY = Math.min(minCellY, y);
    maxCellY = Math.max(maxCellY, y);
  });

  if (!totalScore) return null;

  const centroidDx = sumX / totalScore;
  const centroidDy = sumY / totalScore;
  const centroidWorld = {
    x: targetWorld.x + centroidDx,
    y: targetWorld.y + centroidDy
  };
  let sumDistance = 0;
  let maxDistance = 0;
  const boundary = [];

  cellIndices.forEach((index) => {
    const score = scores[index];
    const gx = index % gridWidth;
    const gy = Math.floor(index / gridWidth);
    const x = minX + gx * step;
    const y = minY + gy * step;
    const distance = Math.hypot(x - centroidWorld.x, y - centroidWorld.y);
    sumDistance += distance * score;
    maxDistance = Math.max(maxDistance, distance);
    if (isStormCellBoundary(gx, gy, gridWidth, gridHeight, selected)) {
      boundary.push({ x, y });
    }
  });

  const outlineWorld = simplifyStormCellOutline(convexHull(boundary.length ? boundary : cellIndices.map((index) => {
    const gx = index % gridWidth;
    const gy = Math.floor(index / gridWidth);
    return { x: minX + gx * step, y: minY + gy * step };
  })));
  const weightedRadius = totalScore ? sumDistance / totalScore : 0;
  const cellRadiusPx = Math.max(weightedRadius + 12, Math.min(maxDistance + 8, radiusPx));

  return {
    cell: true,
    hits,
    count,
    score: Number(totalScore.toFixed(2)),
    totalScore,
    maxScore: Number(maxScore.toFixed(2)),
    density: count ? Number((hits / count).toFixed(3)) : 0,
    centroidDx,
    centroidDy,
    weightedRadius,
    maxDistance,
    cellRadiusPx,
    capped,
    boundsWorld: {
      minX: minCellX,
      maxX: maxCellX,
      minY: minCellY,
      maxY: maxCellY
    },
    outlineWorld
  };
}

function radarWorldPixelScore(tiles, x, y) {
  const tileX = Math.floor(x / 256);
  const tileY = Math.floor(y / 256);
  const imageData = tiles.get(`${tileX}/${tileY}`);
  if (!imageData) return 0;
  const localX = x - tileX * 256;
  const localY = y - tileY * 256;
  if (localX < 0 || localX >= imageData.width || localY < 0 || localY >= imageData.height) return 0;

  const index = (localY * imageData.width + localX) * 4;
  return radarPixelPrecipScore(
    imageData.data[index],
    imageData.data[index + 1],
    imageData.data[index + 2],
    imageData.data[index + 3]
  );
}

function isStormCellBoundary(gx, gy, gridWidth, gridHeight, visited) {
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (!ox && !oy) continue;
      const nx = gx + ox;
      const ny = gy + oy;
      if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) return true;
      if (!visited[ny * gridWidth + nx]) return true;
    }
  }
  return false;
}

function convexHull(points) {
  const unique = [];
  const seen = new Set();
  (points || []).forEach((point) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    const key = `${point.x.toFixed(2)}:${point.y.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(point);
  });
  if (unique.length <= 2) return unique;

  unique.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower = [];
  unique.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function simplifyStormCellOutline(points) {
  const outline = (points || []).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (outline.length <= STORM_IMPACT_CELL_MAX_OUTLINE_POINTS) return outline;
  const stride = Math.ceil(outline.length / STORM_IMPACT_CELL_MAX_OUTLINE_POINTS);
  return outline.filter((_, index) => index % stride === 0).slice(0, STORM_IMPACT_CELL_MAX_OUTLINE_POINTS);
}

async function radarAreaStats(frame, targetWorld, z, radiusPx, tileCache) {
  const worldTiles = 2 ** z;
  const minX = Math.floor(targetWorld.x - radiusPx);
  const maxX = Math.ceil(targetWorld.x + radiusPx);
  const minY = Math.floor(targetWorld.y - radiusPx);
  const maxY = Math.ceil(targetWorld.y + radiusPx);
  const startTileX = Math.floor(minX / 256);
  const endTileX = Math.floor(maxX / 256);
  const startTileY = Math.floor(minY / 256);
  const endTileY = Math.floor(maxY / 256);
  const tiles = new Map();
  const loads = [];

  for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
    for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
      if (tileY < 0 || tileY >= worldTiles) continue;
      const key = `${tileX}/${tileY}`;
      loads.push(radarTileImageDataForSample(frame, z, tileX, tileY, tileCache).then((imageData) => {
        if (imageData) tiles.set(key, imageData);
      }));
    }
  }

  await Promise.all(loads);

  let hits = 0;
  let count = 0;
  let totalScore = 0;
  let maxScore = 0;
  let sumX = 0;
  let sumY = 0;
  let sumDistance = 0;
  let maxDistance = 0;
  const radiusSq = radiusPx * radiusPx;

  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - targetWorld.y;
    const tileY = Math.floor(y / 256);
    if (tileY < 0 || tileY >= worldTiles) continue;

    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - targetWorld.x;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;

      const tileX = Math.floor(x / 256);
      const imageData = tiles.get(`${tileX}/${tileY}`);
      if (!imageData) continue;
      const localX = x - tileX * 256;
      const localY = y - tileY * 256;
      if (localX < 0 || localX >= imageData.width || localY < 0 || localY >= imageData.height) continue;

      const index = (localY * imageData.width + localX) * 4;
      const score = radarPixelPrecipScore(
        imageData.data[index],
        imageData.data[index + 1],
        imageData.data[index + 2],
        imageData.data[index + 3]
      );
      count += 1;
      if (score > 0) {
        const distance = Math.sqrt(distSq);
        hits += 1;
        totalScore += score;
        maxScore = Math.max(maxScore, score);
        sumX += dx * score;
        sumY += dy * score;
        sumDistance += distance * score;
        maxDistance = Math.max(maxDistance, distance);
      }
    }
  }

  return {
    hits,
    count,
    score: Number(totalScore.toFixed(2)),
    totalScore,
    maxScore: Number(maxScore.toFixed(2)),
    density: count ? Number((hits / count).toFixed(3)) : 0,
    centroidDx: totalScore ? sumX / totalScore : 0,
    centroidDy: totalScore ? sumY / totalScore : 0,
    weightedRadius: totalScore ? sumDistance / totalScore : 0,
    maxDistance
  };
}

async function radarTileImageDataForSample(frame, z, tileX, tileY, tileCache) {
  const worldTiles = 2 ** z;
  if (tileY < 0 || tileY >= worldTiles) return null;
  const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
  const key = `${frame.url}:${z}:${wrappedX}:${tileY}`;
  if (!tileCache.has(key)) {
    const url = weatherTileUrl(frame.url, z, wrappedX, tileY);
    tileCache.set(key, fetchRadarTileImageData(url).catch(() => null));
  }
  return tileCache.get(key);
}

function isSignificantStormSample(sample) {
  if (!sample) return false;
  return sample.hits >= STORM_IMPACT_MIN_SAMPLE_HITS ||
    sample.density >= STORM_IMPACT_MIN_SAMPLE_DENSITY ||
    sample.maxScore >= 1.16;
}

function isSignificantForecastSample(sample) {
  if (!sample) return false;
  return sample.hits >= STORM_FORECAST_MIN_SAMPLE_HITS ||
    sample.density >= STORM_FORECAST_MIN_SAMPLE_DENSITY ||
    sample.maxScore >= 1.06;
}

function forecastSampleScore(sample) {
  if (!sample) return 0;
  return (sample.maxScore || 0) * 100 + (sample.density || 0) * 1000 + (sample.hits || 0);
}

function estimateStormMotion(samples) {
  const usable = [...(samples || [])]
    .filter((sample) => sample?.centroidWorld && Number.isFinite(sample.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (usable.length < 2) return null;

  const latest = usable[usable.length - 1];
  const t0 = latest.timestamp;
  const rows = usable.map((sample) => ({
    t: (sample.timestamp - t0) / 60000,
    x: sample.centroidWorld.x,
    y: sample.centroidWorld.y,
    w: Math.max(1, sample.score || sample.hits || 1)
  }));
  const vx = weightedSlope(rows, "x");
  const vy = weightedSlope(rows, "y");
  const speedPxMin = Math.hypot(vx, vy);
  if (!Number.isFinite(speedPxMin) || speedPxMin < STORM_IMPACT_MIN_SPEED_PX_PER_MIN) return null;

  const first = usable[0];
  const windowMin = Math.max(1, (latest.timestamp - first.timestamp) / 60000);
  const displacementPx = Math.hypot(
    latest.centroidWorld.x - first.centroidWorld.x,
    latest.centroidWorld.y - first.centroidWorld.y
  );
  const confidence = usable.length >= 4 && windowMin >= 8 && displacementPx >= 6
    ? "strong"
    : usable.length >= 3 && displacementPx >= 4 ? "medium" : "low";

  return {
    vx,
    vy,
    speedPxMin,
    direction: compassDirectionFromVector(vx, vy),
    confidence,
    frameCount: usable.length,
    windowMin,
    displacementPx
  };
}

function weightedSlope(rows, key) {
  const totalW = rows.reduce((sum, row) => sum + row.w, 0);
  if (!totalW) return 0;
  const meanT = rows.reduce((sum, row) => sum + row.t * row.w, 0) / totalW;
  const meanV = rows.reduce((sum, row) => sum + row[key] * row.w, 0) / totalW;
  let numerator = 0;
  let denominator = 0;
  rows.forEach((row) => {
    const dt = row.t - meanT;
    numerator += row.w * dt * (row[key] - meanV);
    denominator += row.w * dt * dt;
  });
  return denominator ? numerator / denominator : 0;
}

function computeStormImpacts({ latestWorld, latestLatLon, motion, radiusPx, selection, places, z }) {
  const impacts = [];
  const candidates = [];
  const currentRadius = Math.max(radiusPx, STORM_IMPACT_PATH_RADIUS_PX * 0.72);
  const pathRadius = Math.max(STORM_IMPACT_PATH_RADIUS_PX, radiusPx * 0.88);
  const nearRadius = Math.max(STORM_IMPACT_NEAR_PATH_RADIUS_PX, pathRadius * 1.45);
  const lookaheadMin = STORM_IMPACT_LOOKAHEAD_MS / 60000;
  const speedSq = motion ? motion.vx * motion.vx + motion.vy * motion.vy : 0;
  const speed = motion?.speedPxMin || 0;
  const outline = selection?.outlineWorld?.length >= 3 ? selection.outlineWorld : null;
  const polygonBuffer = selectedStormImpactBuffers(radiusPx);

  places.forEach((place) => {
    const placeWorld = projectLatLon(place.latitude, place.longitude, z);
    const dx = placeWorld.x - latestWorld.x;
    const dy = placeWorld.y - latestWorld.y;
    const centerDistancePx = Math.hypot(dx, dy);
    const polygonApproach = outline
      ? selectedStormPolygonApproach({ outline, placeWorld, motion, lookaheadMin, buffers: polygonBuffer })
      : null;
    const nowDistancePx = polygonApproach ? polygonApproach.nowDistancePx : centerDistancePx;
    let impact = null;
    let closestMin = 0;
    let crossPx = nowDistancePx;

    if (polygonApproach) {
      closestMin = polygonApproach.closestMin;
      crossPx = polygonApproach.crossPx;
      if (polygonApproach.nowDistancePx <= polygonBuffer.hit) {
        impact = {
          tone: "likely",
          etaMin: 0,
          crossPx: polygonApproach.nowDistancePx,
          closestMin: 0,
          impactSource: "radar",
          detail: "Selected storm area is near this place now."
        };
      } else if (motion && polygonApproach.inWindow && polygonApproach.crossPx <= polygonBuffer.near) {
        const tone = polygonApproach.crossPx <= polygonBuffer.hit && motion.confidence !== "low"
          ? "likely"
          : polygonApproach.crossPx <= polygonBuffer.clip ? "possible" : "nearby";
        const etaMin = tone === "likely"
          ? polygonApproach.hitMin
          : tone === "possible" ? polygonApproach.clipMin : polygonApproach.nearMin;
        impact = {
          tone,
          etaMin: etaMin == null ? polygonApproach.closestMin : etaMin,
          crossPx: polygonApproach.crossPx,
          closestMin: polygonApproach.closestMin,
          impactSource: "radar",
          detail: stormImpactDetail(tone, polygonApproach.crossPx, latestLatLon.latitude, z)
        };
      }
    } else if (nowDistancePx <= currentRadius) {
      impact = {
        tone: "likely",
        etaMin: 0,
        crossPx: nowDistancePx,
        closestMin: 0,
        impactSource: "radar",
        detail: "Radar return is near this place now."
      };
    } else if (motion && speedSq > 0) {
      const dot = dx * motion.vx + dy * motion.vy;
      closestMin = dot / speedSq;
      const closestDx = dx - motion.vx * closestMin;
      const closestDy = dy - motion.vy * closestMin;
      crossPx = Math.hypot(closestDx, closestDy);
      const inWindow = closestMin >= -8 && closestMin <= lookaheadMin;

      if (inWindow && crossPx <= nearRadius) {
        const threshold = crossPx <= pathRadius ? pathRadius : nearRadius;
        const entryOffset = crossPx < threshold && speed > 0
          ? Math.sqrt(Math.max(0, threshold * threshold - crossPx * crossPx)) / speed
          : 0;
        const etaMin = Math.max(0, closestMin - entryOffset);
        const tone = crossPx <= pathRadius * 0.65 && motion.confidence !== "low"
          ? "likely"
          : crossPx <= pathRadius ? "possible" : "nearby";
        impact = {
          tone,
          etaMin,
          crossPx,
          closestMin,
          impactSource: "radar",
          detail: stormImpactDetail(tone, crossPx, latestLatLon.latitude, z)
        };
      }
    }

    const candidate = {
      place,
      placeKey: stormImpactPlaceKey(place),
      placeName: mapMarkerName(place),
      nowDistancePx,
      crossPx,
      closestMin,
      distanceLabel: formatImpactDistance(crossPx, latestLatLon.latitude, z)
    };
    candidates.push(candidate);

    if (impact) {
      impacts.push({
        ...candidate,
        ...impact,
        etaMin: Math.round(impact.etaMin),
        impactSource: impact.impactSource || "radar",
        toneLabel: impact.tone === "likely" ? "Likely" : impact.tone === "possible" ? "May clip" : "Nearby"
      });
    }
  });

  const toneRank = { likely: 0, possible: 1, nearby: 2 };
  impacts.sort((a, b) => (a.etaMin - b.etaMin) || ((toneRank[a.tone] ?? 3) - (toneRank[b.tone] ?? 3)));
  const misses = candidates
    .filter((candidate) => !impacts.some((impact) => impact.placeKey === candidate.placeKey))
    .filter((candidate) => candidate.closestMin >= -8 && candidate.closestMin <= lookaheadMin)
    .sort((a, b) => a.crossPx - b.crossPx);

  return {
    impacts: impacts.slice(0, 5),
    closestMiss: misses[0] || null
  };
}

function selectedStormImpactBuffers(radiusPx) {
  return {
    hit: Math.max(10, Math.min(18, radiusPx * 0.14)),
    clip: Math.max(22, Math.min(34, radiusPx * 0.28)),
    near: Math.max(40, Math.min(62, radiusPx * 0.50))
  };
}

function selectedStormPolygonApproach({ outline, placeWorld, motion, lookaheadMin, buffers }) {
  const distanceAt = (minutes) => {
    const offset = motion
      ? { x: motion.vx * minutes, y: motion.vy * minutes }
      : { x: 0, y: 0 };
    return distanceFromPointToPolygon({
      x: placeWorld.x - offset.x,
      y: placeWorld.y - offset.y
    }, outline);
  };
  const nowDistancePx = distanceAt(0);
  let best = { minutes: 0, distance: nowDistancePx };
  let hitMin = nowDistancePx <= buffers.hit ? 0 : null;
  let clipMin = nowDistancePx <= buffers.clip ? 0 : null;
  let nearMin = nowDistancePx <= buffers.near ? 0 : null;

  if (motion) {
    const stepMin = 4;
    for (let minutes = stepMin; minutes <= lookaheadMin; minutes += stepMin) {
      const distance = distanceAt(minutes);
      if (distance < best.distance) best = { minutes, distance };
      if (hitMin == null && distance <= buffers.hit) hitMin = minutes;
      if (clipMin == null && distance <= buffers.clip) clipMin = minutes;
      if (nearMin == null && distance <= buffers.near) nearMin = minutes;
    }
    if (lookaheadMin % stepMin !== 0) {
      const distance = distanceAt(lookaheadMin);
      if (distance < best.distance) best = { minutes: lookaheadMin, distance };
      if (hitMin == null && distance <= buffers.hit) hitMin = lookaheadMin;
      if (clipMin == null && distance <= buffers.clip) clipMin = lookaheadMin;
      if (nearMin == null && distance <= buffers.near) nearMin = lookaheadMin;
    }
  }

  return {
    nowDistancePx,
    crossPx: best.distance,
    closestMin: best.minutes,
    hitMin,
    clipMin,
    nearMin,
    inWindow: best.minutes >= -8 && best.minutes <= lookaheadMin
  };
}

function distanceFromPointToPolygon(point, polygon) {
  if (pointInPolygon(point, polygon)) return 0;
  let minDistance = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    minDistance = Math.min(minDistance, distanceFromPointToSegment(point, a, b));
  }
  return Number.isFinite(minDistance) ? minDistance : Infinity;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceFromPointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function stormImpactDetail(tone, crossPx, latitude, z) {
  const distance = formatImpactDistance(crossPx, latitude, z);
  if (tone === "likely") return crossPx < 8 ? "Selected storm area tracks over this place." : `Selected storm area passes within ${distance}.`;
  if (tone === "possible") return `Selected storm edge passes within ${distance}.`;
  return `Selected storm should pass nearby, about ${distance} away.`;
}

function stormImpactRadius(sample) {
  if (sample?.cellRadiusPx) return Number(Math.max(28, Math.min(112, sample.cellRadiusPx)).toFixed(1));
  const radius = Math.max(24, Math.min(58, (sample.weightedRadius || 18) + 16));
  return Number(radius.toFixed(1));
}

function stormImpactSelection(sample) {
  if (!sample?.cell) return null;
  return {
    kind: "cell",
    outlineWorld: sample.outlineWorld || [],
    boundsWorld: sample.boundsWorld || null,
    radiusPx: stormImpactRadius(sample),
    capped: Boolean(sample.capped)
  };
}

function stormImpactPlaces() {
  const places = [];
  const seen = new Set();
  [state.activePlace, ...(state.savedPlaces || [])].filter(Boolean).forEach((place) => {
    const key = stormImpactPlaceKey(place);
    if (seen.has(key)) return;
    seen.add(key);
    places.push(place);
  });
  return places;
}

function stormImpactForPlace(place) {
  if (!mapState.immersive) return null;
  const impacts = mapState.stormImpact?.analysis?.impacts || [];
  const key = stormImpactPlaceKey(place);
  return impacts.find((impact) => impact.placeKey === key) || null;
}

function stormImpactPlaceKey(place) {
  if (!place) return "";
  if (place.id) return `id:${place.id}`;
  const lat = Number(place.latitude || 0).toFixed(4);
  const lon = Number(place.longitude || 0).toFixed(4);
  return `ll:${lat}:${lon}`;
}

function stormImpactRainLabel(sample) {
  if (!sample) return "Radar return";
  if (sample.cell) {
    return sample.intensity === "heavy" || sample.intensity === "moderate"
      ? "Selected storm"
      : "Selected rain area";
  }
  if (sample.intensity === "heavy" || sample.intensity === "moderate") return "Rain";
  return "Light rain";
}

function stormImpactTitle(analysis) {
  if (!analysis.hasPrecip) return analysis.title || "No radar return";
  if (analysis.impacts.length) {
    const first = analysis.impacts[0];
    if (first.impactSource === "forecast") return `Forecast near ${first.placeName} ${formatImpactEtaSentence(first.etaMin)}`;
    return `${first.placeName} ${formatImpactEtaSentence(first.etaMin)}`;
  }
  if (analysis.forecastGuidance?.hasForecastPrecip && !analysis.hasObservedPrecip) {
    return "Forecast rain nearby";
  }
  return analysis.selection ? "Selected storm track" : `${analysis.label} track`;
}

function stormImpactSummary(analysis) {
  if (!analysis.hasPrecip) return analysis.summary || "No observed radar return was found at this tap.";
  const motion = analysis.motion ? stormMotionCopy(analysis.motion, analysis.latestLatLon.latitude, analysis.z) : "";
  const sourceNote = analysis.tapSource === "forecast"
    ? " Observed radar still drives motion when a current track is available."
    : "";
  const firstImpact = analysis.impacts?.[0] || null;
  if (firstImpact?.impactSource === "forecast") {
    const observedNote = analysis.hasObservedPrecip
      ? "Observed radar track misses your places for now."
      : "Observed radar is weak or clear at the tap.";
    return `Forecast guidance brings precipitation near ${firstImpact.placeName} ${formatImpactEtaPhrase(firstImpact.etaMin)}. ${observedNote}${sourceNote}`;
  }
  if (analysis.forecastGuidance?.hasForecastPrecip && !analysis.impacts.length) {
    return `Forecast guidance has precipitation near the tap, but not near your places in the sampled forecast window.${sourceNote}`;
  }

  if (!analysis.motion) {
    return `${analysis.label} is highlighted, but recent radar frames do not show enough movement for an ETA yet.${sourceNote}`;
  }
  if (analysis.impacts.length) {
    return `${firstImpact.toneLabel} for ${firstImpact.placeName} ${formatImpactEtaPhrase(firstImpact.etaMin)} if this selected area holds. ${motion}${sourceNote}`;
  }
  if (analysis.closestMiss) {
    return `Selected storm misses your places for now. Closest pass is ${analysis.closestMiss.distanceLabel} from ${analysis.closestMiss.placeName}. ${motion}${sourceNote}`;
  }
  return `Selected storm misses your places for now. ${motion}${sourceNote}`;
}

function stormMotionCopy(motion, latitude, z) {
  const speed = formatMotionSpeed(motion.speedPxMin, latitude, z);
  return `Moving ${motion.direction} about ${speed}.`;
}

function renderStormImpactCard() {
  const card = els.stormImpactCard;
  if (!card) return;
  const status = mapState.stormImpact?.status || "idle";
  const analysis = mapState.stormImpact?.analysis;
  if (status === "idle" || !analysis) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  if (els.stormImpactKicker) {
    const sourceLabel = stormImpactKickerLabel(analysis);
    els.stormImpactKicker.textContent = sourceLabel
      ? `Storm impact · ${sourceLabel}`
      : "Storm impact";
  }

  if (status === "loading") {
    if (els.stormImpactTitle) els.stormImpactTitle.textContent = "Finding storm area";
    if (els.stormImpactSummary) els.stormImpactSummary.textContent = "Selecting the nearby radar area, then checking whether it reaches your places.";
    if (els.stormImpactList) els.stormImpactList.innerHTML = "";
    return;
  }

  if (els.stormImpactTitle) els.stormImpactTitle.textContent = analysis.title || "Storm impact";
  if (els.stormImpactSummary) els.stormImpactSummary.textContent = analysis.summary || "";
  if (els.stormImpactList) els.stormImpactList.innerHTML = stormImpactRowsHtml(analysis);
}

function stormImpactKickerLabel(analysis) {
  if (!analysis) return "";
  if (analysis.selection) {
    return analysis.forecastGuidance?.hasForecastPrecip
      ? "Selected storm + forecast"
      : "Selected storm";
  }
  return analysis.source || "";
}

function stormImpactRowsHtml(analysis) {
  if (!analysis.hasPrecip) return "";
  if (analysis.impacts?.length) return analysis.impacts.map(stormImpactRowHtml).join("");
  if (analysis.closestMiss) {
    return stormImpactRowHtml({
      ...analysis.closestMiss,
      tone: "miss",
      etaMin: null,
      toneLabel: "Miss",
      detail: `Closest projected pass is ${analysis.closestMiss.distanceLabel} away.`
    });
  }
  return "";
}

function stormImpactRowHtml(impact) {
  const eta = impact.etaMin == null ? "Miss" : formatImpactEta(impact.etaMin);
  const sub = impact.etaMin == null ? "track" : impact.toneLabel || "ETA";
  return `
    <article class="storm-impact-row" data-tone="${escapeHtml(impact.tone || "nearby")}">
      <span>${escapeHtml(eta)}<small>${escapeHtml(sub)}</small></span>
      <strong>${escapeHtml(impact.placeName)}</strong>
      <em>${escapeHtml(impact.detail || "")}</em>
    </article>
  `;
}

function renderStormImpactOverlay(viewport = null) {
  const layer = document.getElementById("immersiveImpactLayer");
  if (!layer) return;
  const analysis = mapState.stormImpact?.analysis;
  if (!mapState.immersive || !analysis?.target) {
    layer.innerHTML = "";
    return;
  }

  const vp = viewport || getMapViewport();
  const target = mapScreenPointForLatLon(analysis.target.latitude, analysis.target.longitude, vp);
  const targetHtml = `<span class="impact-target" style="left:${target.x.toFixed(1)}px;top:${target.y.toFixed(1)}px"></span>`;
  const selectionHtml = stormImpactSelectionHtml(analysis, vp);
  let pathHtml = "";

  if (analysis.hasPrecip && analysis.motion && analysis.latestWorld) {
    const start = mapScreenPointForWorld(analysis.latestWorld, analysis.z, vp);
    const lookaheadMin = analysis.impacts?.length
      ? clamp(Math.max(...analysis.impacts.map((impact) => impact.etaMin || 0)) + 24, 34, 120)
      : 72;
    const endWorld = {
      x: analysis.latestWorld.x + analysis.motion.vx * lookaheadMin,
      y: analysis.latestWorld.y + analysis.motion.vy * lookaheadMin
    };
    const end = mapScreenPointForWorld(endWorld, analysis.z, vp);
    pathHtml = `
      <svg class="impact-track-svg" aria-hidden="true">
        <line class="impact-track-line" x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}"></line>
      </svg>
    `;
  }

  layer.innerHTML = `${selectionHtml}${pathHtml}${targetHtml}`;
}

function stormImpactSelectionHtml(analysis, viewport) {
  const outline = analysis?.selection?.outlineWorld || [];
  if (!analysis?.hasPrecip || !outline.length) return "";

  const points = outline
    .map((point) => mapScreenPointForWorld(point, analysis.z, viewport))
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  if (!points) return "";

  return `
    <svg class="impact-cell-svg" aria-hidden="true">
      <polygon class="impact-cell-polygon" points="${points}"></polygon>
    </svg>
  `;
}

function mapLatLonFromClientPoint(clientX, clientY) {
  if (!els.weatherMap || !state.activePlace) return null;
  const rect = els.weatherMap.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const viewport = getMapViewport();
  const world = {
    x: viewport.center.x - rect.width / 2 + (clientX - rect.left),
    y: viewport.center.y - rect.height / 2 + (clientY - rect.top)
  };
  return unprojectWorldPoint(world, mapState.zoom);
}

function mapScreenPointForLatLon(latitude, longitude, viewport = getMapViewport()) {
  const point = projectLatLon(latitude, longitude, mapState.zoom);
  return {
    x: point.x - (viewport.center.x - viewport.width / 2),
    y: point.y - (viewport.center.y - viewport.height / 2)
  };
}

function mapScreenPointForWorld(world, sourceZoom, viewport = getMapViewport()) {
  const latLon = unprojectWorldPoint(world, sourceZoom);
  return mapScreenPointForLatLon(latLon.latitude, latLon.longitude, viewport);
}

function unprojectWorldPoint(point, zoom) {
  const worldSize = 256 * 2 ** zoom;
  const longitude = normalizeMapLongitude((point.x / worldSize) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * point.y) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

function compassDirectionFromVector(vx, vy) {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const degrees = (Math.atan2(vx, -vy) * 180 / Math.PI + 360) % 360;
  return directions[Math.round(degrees / 22.5) % directions.length];
}

function kmPerPixelAtLat(latitude, z) {
  return (156543.03392 * Math.cos(latitude * Math.PI / 180)) / (2 ** z) / 1000;
}

function formatImpactDistance(px, latitude, z) {
  const km = Math.max(0, px * kmPerPixelAtLat(latitude, z));
  if (state.unit === "fahrenheit") {
    const miles = km * 0.621371;
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  }
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function formatMotionSpeed(pxPerMin, latitude, z) {
  const kph = Math.max(0, pxPerMin * kmPerPixelAtLat(latitude, z) * 60);
  if (state.unit === "fahrenheit") return `${Math.round(kph * 0.621371)} mph`;
  return `${Math.round(kph)} km/h`;
}

function formatImpactEta(minutes) {
  if (minutes == null) return "Miss";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded <= 2) return "Now";
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins ? `${hours}h ${mins}m` : `${hours} hr`;
}

function formatImpactMarkerEta(minutes) {
  if (minutes == null) return "";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded <= 2) return "now";
  if (rounded < 60) return `${rounded}m`;
  return `${Math.max(1, Math.round(rounded / 60))}h`;
}

function formatImpactEtaPhrase(minutes) {
  if (minutes == null) return "";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded <= 2) return "now";
  return `in ${formatImpactEta(rounded).toLowerCase()}`;
}

function formatImpactEtaSentence(minutes) {
  if (minutes == null) return "";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded <= 2) return "now";
  return `in ${formatImpactEta(rounded).toLowerCase()}`;
}

function zoomMapFromWheel(e) {
  const pixelDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 240 : e.deltaY;
  const zoomDelta = Math.max(-0.7, Math.min(0.7, -pixelDelta / MAP_WHEEL_ZOOM_SENSITIVITY));
  if (Math.abs(zoomDelta) < 0.01) return;
  setMapZoom(mapState.zoom + zoomDelta, e.clientX, e.clientY);
}
