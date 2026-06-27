/* Nearcast radar/map timeline and immersive map interactions. */

const MAP_PAN_MOVE_EPSILON_PX = 0.5;

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
  pinchState.active = false;
  dragState.active = true;
  dragState.startX = x;
  dragState.startY = y;
  dragState.startPanX = mapState.panX;
  dragState.startPanY = mapState.panY;
  dragState.moved = false;
  dragState.resumePlayback = false;
  if (el) el.style.cursor = "grabbing";
}

function moveMapDrag(x, y) {
  if (!dragState.active || pinchState.active) return;
  updateMapPreviewTap(x, y);
  const dx = x - dragState.startX;
  const dy = y - dragState.startY;
  mapState.panX = dragState.startPanX + dx;
  mapState.panY = dragState.startPanY + dy;
  if (Math.hypot(dx, dy) > MAP_PAN_MOVE_EPSILON_PX) {
    dragState.moved = true;
    pauseMapPlaybackForManualPan();
    scheduleMapRender();
  }
}

function endMapGesture(el = els.weatherMap) {
  const shouldRender = dragState.active && dragState.moved;
  const shouldResumePlayback = dragState.resumePlayback;
  dragState.active = false;
  pinchState.active = false;
  dragState.moved = false;
  if (shouldRender) renderTileMap();
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
  if (dragState.moved) {
    dragState.moved = false;
    renderTileMap();
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
  els.markerLayer.innerHTML = "";
  if (!state.activePlace) return;

  const viewport = getMapViewport();
  const placedBounds = [];
  const activeMarker = renderMapMarker(state.activePlace, { viewport });
  if (activeMarker?.bounds) placedBounds.push(activeMarker.bounds);

  if (!mapState.immersive) return;

  state.savedPlaces
    .filter((place) => !isActiveMapPlace(place))
    .forEach((place) => {
      const layout = mapMarkerLayout(place, viewport);
      if (!layout || mapBoundsOverlapAny(layout.bounds, placedBounds)) return;
      const marker = renderMapMarker(place, { viewport, layout });
      if (marker?.bounds) placedBounds.push(marker.bounds);
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
  setMapLoading(true);
  clearMapLayers({ renderStatic: false });
  mapState.timelineKind = timelineKind;

  try {
    const timeline = await fetchMapTimeline(timelineKind);
    mapState.frames = timeline.frames;
    mapState.nowIndex = timeline.nowIndex;
    mapState.forecastUnavailable = timeline.forecastUnavailable;

    if (!mapState.frames.length) {
      setFrameLabel(timeline.emptyLabel || "No frames");
      updateTimelineEraVisuals();
      return;
    }

    mapState.frameIndex = initialMapFrameIndex(timeline, timelineKind, options, shouldResumePlayback);
    els.frameSlider.max = String(mapState.frames.length - 1);
    updateTimelineEraVisuals();
    showFrame(mapState.frameIndex);
    if (shouldResumePlayback) startRadarPlayback();
    else maybeAutoPlayRadar(); // frames just became available — play if the map is on screen
  } catch (error) {
    setFrameLabel("Map data unavailable");
    updateTimelineEraVisuals();
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
    const response = await fetch("https://api.rainviewer.com/public/weather-maps.json");
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
  try {
    const nwsFrames = await fetchNwsRadarFrames();
    if (nwsFrames.length) return nwsFrames;
  } catch {
    /* RainViewer remains the global/fallback radar source for this spike. */
  }
  return fetchRainViewerFrames();
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
  const response = await fetch(`${config.endpoint}?${params.toString()}`);
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
    WIDTH: "256",
    HEIGHT: "256",
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
    // Cap below MAP_MAX_ZOOM so radar tiles upscale (browser bilinear-smooths
    // them) instead of the WMS server rendering MRMS's ~1km grid as hard blocks
    // at native zoom. Also means fewer, larger tiles per frame.
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
  renderWeatherTiles();
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
  setPlaybackButtonState();
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
    if (url) {
      const sourceZoom = mapTileSourceZoom((frame && frame.maxZoom) || MAP_MAX_ZOOM);
      renderTileLayer(pane, vp, ({ z, x, y }) => weatherTileUrl(url, z, x, y), { sourceZoom });
      pane.style.filter = radarBlurFilter(sourceZoom);
    }
    pane.style.opacity = f === cur ? "0.78" : "0"; // hard cut; next preloads hidden
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
  if (radarPaneReady(frameIndex)) {
    mapState.frameWaitIndex = null;
    mapState.frameWaitStart = 0;
    return true;
  }

  if (mapState.frameWaitIndex !== frameIndex) {
    mapState.frameWaitIndex = frameIndex;
    mapState.frameWaitStart = now;
  }

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
  if (shouldBuffer && els.weatherTileLayer) {
    renderXfade(mapState.frameIndex); // show current + preload next immediately
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
      renderXfade(mapState.frameIndex); // keep the upcoming hidden pane warming
      if (!waitForBufferedRadarFrame(idx, now)) {
        mapState.playAccum = interval;
        mapState.timer = requestAnimationFrame(playbackTick);
        return;
      }
      mapState.frameIndex = idx;
      renderXfade(idx); // hard swap to idx, preload idx+1
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
    else maybeAutoPlayRadar();
  });
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
  els.weatherTileLayer.innerHTML = "";
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
  const sourceNote = mapState.forecastUnavailable && mapState.timelineKind === "precip" ? "Forecast map unavailable here" : "";
  const legend = isForecast
    ? {
        title: "Forecast precipitation",
        colors: ["#d8f0ff", "#8fd07e", "#f2df5a", "#e99446", "#c74767"],
        labels: ["Trace", "0.10 in", "0.25 in", "0.50 in", "1.00+ in"]
      }
    : {
        title: "Radar intensity",
        colors: ["#7ec8ff", "#36b16a", "#f0d846", "#f08a30", "#c83f6b"],
        labels: ["Light", "Moderate", "Steady", "Heavy", "Severe"]
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

// Radar tiles are coarse (capped source zoom + low-res precip data), so soften
// them in proportion to how much they're being upscaled — bilinear alone leaves
// hard cell blocks at high zoom. Returns a CSS filter string for a weather pane.
function radarBlurFilter(sourceZoom) {
  const scale = 2 ** (mapState.zoom - sourceZoom);
  const px = Math.min(Math.max(scale * 0.55, 0.6), 2.4);
  return `blur(${px.toFixed(2)}px)`;
}

function setMapZoom(nextZoom, anchorClientX = null, anchorClientY = null) {
  const newZoom = clampMapZoom(nextZoom);
  if (Math.abs(newZoom - mapState.zoom) < 0.001) return;
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
  renderTileMap();
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
  const perf = perfStart();

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
function renderWeatherLayers(layers, frameMaxZoom, viewport = null) {
  if (!mapState.initialized || !els.weatherTileLayer) return;
  layers = (layers || []).filter((l) => l && l.url && l.opacity > 0.01);
  while (els.weatherTileLayer.children.length > layers.length) {
    els.weatherTileLayer.lastElementChild.remove();
  }
  if (!layers.length) return;

  const tileViewport = viewport || getMapViewport();
  const sourceZoom = mapTileSourceZoom(frameMaxZoom || MAP_MAX_ZOOM);
  layers.forEach((layer, index) => {
    let pane = els.weatherTileLayer.children[index];
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "tile-sublayer";
      els.weatherTileLayer.appendChild(pane);
    }
    pane.style.opacity = String(layer.opacity);
    pane.style.filter = radarBlurFilter(sourceZoom);
    renderTileLayer(pane, tileViewport, ({ z, x, y }) => weatherTileUrl(layer.url, z, x, y), { sourceZoom });
  });
}

function renderWeatherTiles(viewport = null) {
  const frame = mapState.frames[mapState.frameIndex];
  const layers = (frame && state.activePlace)
    ? (frame.layers || [{ url: frame.url, opacity: 0.78 }])
    : [];
  renderWeatherLayers(layers, frame && frame.maxZoom, viewport);
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

function renderMapMarker(place, options = {}) {
  if (!state.activePlace) return;
  const viewport = options.viewport || getMapViewport();
  const layout = options.layout || mapMarkerLayout(place, viewport);
  if (!layout) return null;

  const { left, top } = layout;
  const marker = document.createElement("div");
  const isActive = isActiveMapPlace(place);
  const impact = stormImpactForPlace(place);
  const name = mapMarkerName(place);
  const tempText = mapState.immersive && isActive ? activeMapMarkerTemp() : "";
  const impactText = impact ? formatImpactMarkerEta(impact.etaMin) : "";
  const classNames = ["map-marker"];
  if (mapState.immersive && isActive) classNames.push("is-active-place");
  if (impact) classNames.push("has-impact", `is-impact-${impact.tone}`);
  marker.className = classNames.join(" ");
  if (tempText || impactText) {
    marker.innerHTML = `<span>${escapeHtml(name)}</span>${tempText ? `<strong>${escapeHtml(tempText)}</strong>` : ""}${impactText ? `<small>${escapeHtml(impactText)}</small>` : ""}`;
  } else {
    marker.textContent = name;
  }
  marker.style.left = `${left}px`;
  marker.style.top = `${top}px`;
  els.markerLayer.appendChild(marker);
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
  mapState.immersive = true;
  document.body.classList.add("map-immersive-active");

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
  bindImmersiveDrag();
  document.addEventListener("keydown", onImmersiveKey);
}

function exitImmersiveMap() {
  if (!mapState.immersive || !mapState._normalEls) return;

  clearStormImpact();
  Object.assign(els, mapState._normalEls);
  mapState._normalEls = null;
  mapState.immersive = false;
  els.frameSlider.max = String(Math.max(0, mapState.frames.length - 1));
  els.frameSlider.value = String(mapState.frameIndex);
  updateRangeProgress(els.frameSlider);
  setPlaybackButtonState(els.playRadar, mapState.playing);

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
