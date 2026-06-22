/* Nearcast radar/map timeline and immersive map interactions. */

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
  if (el) el.style.cursor = "grabbing";
}

function moveMapDrag(x, y) {
  if (!dragState.active || pinchState.active) return;
  updateMapPreviewTap(x, y);
  mapState.panX = dragState.startPanX + (x - dragState.startX);
  mapState.panY = dragState.startPanY + (y - dragState.startY);
  scheduleMapRender();
}

function endMapGesture(el = els.weatherMap) {
  dragState.active = false;
  pinchState.active = false;
  if (el) el.style.cursor = "grab";
}

// Re-tiling is cheap (tiles are reused by key, not rebuilt) but we still cap it
// to one render per frame so a burst of touchmove events can't thrash layout.
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

function refreshInlineMap(forceFrames = false) {
  if (!state.activePlace || !els.weatherMap) return;
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
    if (state.forecast === data) renderForecast(data, state.activePlace, { refreshMap: false });
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
  if (stats.maxScore >= 1.55 || stats.density >= 0.2) return "heavy";
  if (stats.maxScore >= 1.25 || stats.density >= 0.08) return "moderate";
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

// One extra ring of tiles beyond the viewport so a pan always has loaded tiles
// to slide into before an edge could show.
const TILE_BUFFER = 1;

function renderTileLayer(layer, viewport, urlForTile, options = {}) {
  if (!layer) return;
  const perf = perfStart();
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
  const startX = Math.floor(sourceTopLeft.x / tileSize) - TILE_BUFFER;
  const endX = Math.floor((sourceTopLeft.x + viewport.width / sourceScale) / tileSize) + TILE_BUFFER;
  const startY = Math.floor(sourceTopLeft.y / tileSize) - TILE_BUFFER;
  const endY = Math.floor((sourceTopLeft.y + viewport.height / sourceScale) / tileSize) + TILE_BUFFER;

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
      let img = layer.querySelector(`:scope > img[data-tile="${key}"]`);
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
  layer.querySelectorAll(":scope > img").forEach((img) => {
    if (wanted.has(img.dataset.tile)) return;
    const parts = (img.dataset.tile || "").split("/");
    const tz = Number(parts[0]);
    if (tz === z || Math.abs(tz - z) > 1) { img.remove(); return; }
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

// Remove leftover tiles (typically the previous zoom level) once every currently
// wanted tile has settled — called after each render and on each tile load, so the
// old view stays visible until the new one is ready.
function maybePurgeStaleTiles(layer) {
  const wanted = layer._wantedTiles;
  if (!wanted) return;
  for (const key of wanted) {
    const img = layer.querySelector(`:scope > img[data-tile="${key}"]`);
    if (!img || !img.complete) return; // new set hasn't finished loading yet
  }
  layer.querySelectorAll(":scope > img").forEach((img) => {
    if (!wanted.has(img.dataset.tile)) img.remove();
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
  const name = mapMarkerName(place);
  const tempText = mapState.immersive && isActive ? activeMapMarkerTemp() : "";
  marker.className = `map-marker${mapState.immersive && isActive ? " is-active-place" : ""}`;
  if (tempText) {
    marker.innerHTML = `<span>${escapeHtml(name)}</span><strong>${escapeHtml(tempText)}</strong>`;
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
  const name = mapMarkerName(place);
  return {
    left,
    top,
    bounds: mapMarkerBounds(left, top, estimateMapMarkerWidth(name, tempText), tempText ? 31 : 29)
  };
}

function mapMarkerName(place) {
  return place?.name || placeLabel(place);
}

function activeMapMarkerTemp() {
  return document.getElementById("nowTemp")?.textContent || "";
}

function estimateMapMarkerWidth(name, tempText = "") {
  const nameWidth = Math.min(112, String(name || "").length * 7.2);
  const tempWidth = tempText ? 10 + String(tempText).length * 8.4 : 0;
  const width = 18 + nameWidth + tempWidth;
  return Math.max(tempText ? 92 : 74, Math.min(tempText ? 178 : 130, width));
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
    startMapDrag(e.clientX, e.clientY, canvas);
  }, { signal: sig });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomMapFromWheel(e);
  }, { passive: false, signal: sig });
  window.addEventListener("mousemove", (e) => moveMapDrag(e.clientX, e.clientY), { signal: sig });
  window.addEventListener("mouseup", () => endMapGesture(canvas), { signal: sig });

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      startMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    const t = e.touches[0];
    startMapDrag(t.clientX, t.clientY, canvas);
  }, { passive: false, signal: sig });
  window.addEventListener("touchmove", (e) => {
    if (pinchState.active && e.touches.length === 2) {
      e.preventDefault();
      moveMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      moveMapDrag(t.clientX, t.clientY);
    }
  }, { passive: false, signal: sig });
  window.addEventListener("touchend", () => endMapGesture(canvas), { signal: sig });
}

function zoomMapFromWheel(e) {
  const pixelDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 240 : e.deltaY;
  const zoomDelta = Math.max(-0.7, Math.min(0.7, -pixelDelta / MAP_WHEEL_ZOOM_SENSITIVITY));
  if (Math.abs(zoomDelta) < 0.01) return;
  setMapZoom(mapState.zoom + zoomDelta, e.clientX, e.clientY);
}
