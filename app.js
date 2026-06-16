const VERSION = "1.10.32";
const DAY_DETAIL_MODE_KEY = "nearcast-day-detail-mode";

const state = {
  unit: localStorage.getItem("weather-unit") || "fahrenheit",
  theme: localStorage.getItem("weather-theme") || "auto",
  sunriseMs: null,
  sunsetMs: null,
  activePlace: null,
  savedPlaces: JSON.parse(localStorage.getItem("weather-places") || "[]"),
  searchResults: [],
  skyCode: null,
  skyIsDay: null,
  locationIsDay: null
};

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
  playPos: 0,
  playClock: 0,
  xfadeFrames: [null, null],
  _normalEls: null
};

const MAP_MIN_ZOOM = 4;
const MAP_MAX_ZOOM = 10;
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
  startPanY: 0
};

const pinchState = {
  active: false,
  startDistance: 0,
  startZoom: 0,
  anchorX: 0,
  anchorY: 0
};

let searchSuggestTimer = null;
let searchRequestSeq = 0;

const els = {
  shell: document.querySelector(".shell"),
  searchToggle: document.querySelector("#searchToggle"),
  welcome: document.querySelector("#welcome"),
  welcomeLocate: document.querySelector("#welcomeLocate"),
  themeToggle: document.querySelector("#themeToggle"),
  unitToggle: document.querySelector("#unitToggle"),
  forecastView: document.querySelector("#forecastView"),
  mapView: document.querySelector("#mapView"),
  searchForm: document.querySelector("#searchForm"),
  placeSearch: document.querySelector("#placeSearch"),
  searchResults: document.querySelector("#searchResults"),
  savedPlaces: document.querySelector("#savedPlaces"),
  status: document.querySelector("#status"),
  locationName: document.querySelector("#locationName"),
  nowTemp: document.querySelector("#nowTemp"),
  nowSummary: document.querySelector("#nowSummary"),
  feelsLike: document.querySelector("#feelsLike"),
  rainChance: document.querySelector("#rainChance"),
  wind: document.querySelector("#wind"),
  uv: document.querySelector("#uv"),
  humidity: document.querySelector("#humidity"),
  sunrise: document.querySelector("#sunrise"),
  sunset: document.querySelector("#sunset"),
  insights: document.querySelector("#insights"),
  insightCards: document.querySelector("#insightCards"),
  briefing: document.querySelector("#briefing"),
  aiAsk: document.querySelector("#aiAsk"),
  aiLauncher: document.querySelector("#aiLauncher"),
  aiLauncherSub: document.querySelector("#aiLauncherSub"),
  aiSheet: document.querySelector("#aiSheet"),
  aiBackdrop: document.querySelector("#aiBackdrop"),
  placeSwitcher: document.querySelector("#placeSwitcher"),
  placeSwitcherName: document.querySelector("#placeSwitcherName"),
  placeSwitcherMeta: document.querySelector("#placeSwitcherMeta"),
  placeSheet: document.querySelector("#placeSheet"),
  placeBackdrop: document.querySelector("#placeBackdrop"),
  hourly: document.querySelector("#hourly"),
  daily: document.querySelector("#daily"),
  updatedAt: document.querySelector("#updatedAt"),
  metricTip: document.querySelector("#metricTip"),
  savePlace: document.querySelector("#savePlace"),
  weatherMap: document.querySelector("#weatherMap"),
  baseTileLayer: document.querySelector("#baseTileLayer"),
  weatherTileLayer: document.querySelector("#weatherTileLayer"),
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
  frameLabel: document.querySelector("#frameLabel")
};

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
  99: "Thunderstorms, hail"
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
  99: "thunder"
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

function weatherIcon(code, isDay = true) {
  let key = weatherIcons[code] || "cloudy";
  if (key === "clear-day" && !isDay) key = "clear-night";
  return iconSvgs[key] || iconSvgs["cloudy"];
}

function init() {
  document.getElementById("appVersion").textContent = `v${VERSION}`;
  applyTheme();
  renderSavedPlaces();
  updateUnitButton();
  bindEvents();
  initMetricTipListeners();
  detectAI();

  // Returning users open straight to their weather (last viewed → first saved).
  // First-timers get the welcome state to find a place — no arbitrary default.
  const lastPlace = JSON.parse(localStorage.getItem("weather-last-place") || "null");
  if (lastPlace && lastPlace.latitude != null) {
    loadPlace(lastPlace);
  } else if (state.savedPlaces.length) {
    loadPlace(state.savedPlaces[0]);
  } else {
    updateMode(); // welcome mode
  }
}

function bindEvents() {
  els.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = els.placeSearch.value.trim();
    if (!query) return;
    await searchPlaces(query);
  });

  els.placeSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSearchResults();
  });
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

  els.unitToggle.addEventListener("click", () => {
    state.unit = state.unit === "fahrenheit" ? "celsius" : "fahrenheit";
    localStorage.setItem("weather-unit", state.unit);
    updateUnitButton();
    // Cached glance temps are unit-specific — drop them so chips refetch
    for (const id in glanceData) delete glanceData[id];
    renderSavedPlaces();
    if (state.activePlace) loadPlace(state.activePlace);
  });

  els.themeToggle.addEventListener("click", toggleTheme);
  els.briefing.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-ai]");
    if (!btn) return;
    const action = btn.dataset.ai;
    if (action === "enable") enableAI();
    else if (action === "brief") runBrief();
    else if (action === "stop" && aiBriefAbort) aiBriefAbort.aborted = true;
    else if (action === "copy-report") copySupportReport();
  });
  els.aiAsk.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-ask-q]");
    if (chip) runAsk(chip.dataset.askQ, chip.dataset.askIntent);
  });
  els.aiAsk.addEventListener("submit", (event) => {
    if (event.target.id !== "askForm") return;
    event.preventDefault();
    const input = document.getElementById("askInput");
    runAsk(input.value);
  });
  els.aiLauncher.addEventListener("click", openAISheet);
  els.aiBackdrop.addEventListener("click", closeAISheet);
  document.getElementById("aiSheetClose").addEventListener("click", closeAISheet);
  els.searchToggle.addEventListener("click", () => toggleSearch());
  els.placeSwitcher.addEventListener("click", openPlaceSheet);
  els.placeBackdrop.addEventListener("click", closePlaceSheet);
  document.getElementById("placeSheetClose").addEventListener("click", closePlaceSheet);
  els.welcomeLocate.addEventListener("click", useCurrentLocation);
  document.getElementById("searchLocate").addEventListener("click", () => {
    toggleSearch(false);
    useCurrentLocation();
  });
  document.getElementById("nowcast").addEventListener("click", openNext24Detail);

  // Refresh stale data when the app is reopened/foregrounded (esp. iOS PWA)
  document.addEventListener("visibilitychange", refreshOnForeground);
  window.addEventListener("pageshow", (event) => { if (event.persisted) refreshOnForeground(); });
  window.addEventListener("focus", refreshOnForeground);
  els.savePlace.addEventListener("click", () => {
    if (!state.activePlace) return;
    savePlace(state.activePlace);
    setStatus(`${state.activePlace.name} saved.`);
  });
  els.radarMode.addEventListener("click", () => setMapMode("radar"));
  els.futureMode.addEventListener("click", () => setMapMode("future"));
  els.zoomOutMap.addEventListener("click", () => setMapZoom(mapState.zoom - 1));
  els.zoomInMap.addEventListener("click", () => setMapZoom(mapState.zoom + 1));
  els.playRadar.addEventListener("click", toggleRadarPlayback);
  els.frameSlider.addEventListener("input", () => scrubToFrame(Number(els.frameSlider.value)));
  document.getElementById("expandMap").addEventListener("click", enterImmersiveMap);

  // Day-detail drill-down: tap a 10-day row or the hourly strip
  els.daily.addEventListener("click", (event) => {
    const row = event.target.closest(".day-row");
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
  els.hourly.addEventListener("click", openNext24Detail);
  document.getElementById("sheetGraphMode").addEventListener("click", () => setDayDetailMode("graph"));
  document.getElementById("sheetHourlyMode").addEventListener("click", () => setDayDetailMode("hourly"));
  document.getElementById("graphTempBtn").addEventListener("click", () => setGraphMetric("temp"));
  document.getElementById("graphWindBtn").addEventListener("click", () => setGraphMetric("wind"));
  document.getElementById("dayDetailClose").addEventListener("click", closeDayDetail);
  document.getElementById("dayDetailBackdrop").addEventListener("click", closeDayDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("dayDetail").hidden) closeDayDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.placeSheet.hidden) closePlaceSheet();
  });

  // Severe weather alerts
  document.getElementById("alertBar").addEventListener("click", openAlertSheet);
  document.getElementById("alertSheetClose").addEventListener("click", closeAlertSheet);
  document.getElementById("alertBackdrop").addEventListener("click", closeAlertSheet);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("alertSheet").hidden) closeAlertSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.aiSheet.hidden) closeAISheet();
  });
}

function applyTheme() {
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

  if (state.skyCode !== null) {
    updateSkyCanvas(state.skyCode, state.skyIsDay);
  } else if (state.theme !== "auto") {
    clearSkyCanvas();
  }
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

async function searchPlaces(query, { quiet = false } = {}) {
  const requestId = ++searchRequestSeq;
  const parsed = parseLocationQuery(query);
  if (!quiet) setStatus("Searching places...");
  try {
    let results = await fetchPlaceResults(parsed.raw);
    if (!results.length && parsed.primary && parsed.primary !== parsed.raw) {
      results = await fetchPlaceResults(parsed.primary, 10);
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

async function fetchPlaceResults(name, count = 8) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name,
    count: String(count),
    language: "en",
    format: "json"
  }).toString();
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

  if (!region) {
    const trailingState = raw.match(/^(.+?)\s+([A-Za-z]{2})$/);
    if (trailingState) {
      primary = trailingState[1].trim();
      region = trailingState[2].trim();
    }
  }

  const stateName = normalizeRegionName(region);
  return { raw, primary, region, stateName };
}

function normalizeRegionName(region) {
  const value = String(region || "").trim();
  if (!value) return "";
  const upper = value.replace(/\./g, "").toUpperCase();
  return US_STATE_NAMES[upper] || value;
}

function rankPlaceResults(results, parsed) {
  const primary = parsed.primary.toLowerCase();
  const stateName = parsed.stateName.toLowerCase();

  return [...results].sort((a, b) => placeScore(b, primary, stateName) - placeScore(a, primary, stateName));
}

function placeScore(place, primary, stateName) {
  let score = 0;
  const name = String(place.name || "").toLowerCase();
  const admin = String(place.admin1 || "").toLowerCase();
  const country = String(place.country || "").toLowerCase();
  if (name === primary) score += 20;
  else if (name.startsWith(primary)) score += 10;
  if (stateName && admin === stateName) score += 50;
  else if (stateName && (admin.includes(stateName) || country.includes(stateName))) score += 15;
  if (place.country_code === "US") score += 3;
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
  const hasContext = Boolean(state.activePlace) || state.savedPlaces.length > 0;
  els.shell.classList.toggle("mode-welcome", !hasContext);
  if (!hasContext) els.shell.classList.remove("search-open");
}

function toggleSearch(open) {
  const next = open === undefined ? !els.shell.classList.contains("search-open") : open;
  els.shell.classList.toggle("search-open", next);
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
      <small>${escapeHtml(place.admin1 || place.country || "")}</small>
    `;
    button.addEventListener("click", () => {
      toggleSearch(false);
      loadPlace(normalizePlace(place));
    });
    els.searchResults.appendChild(button);
  });
}

function updateSaveButton() {
  if (!els.savePlace) return;
  const alreadySaved = state.activePlace &&
    state.savedPlaces.some((p) => p.id === state.activePlace.id);
  els.savePlace.textContent = alreadySaved ? "Saved ✓" : "Save place";
  els.savePlace.disabled = alreadySaved;
  els.savePlace.classList.toggle("is-saved", Boolean(alreadySaved));
}

// Lightweight current-conditions for the saved-places glance row.
// Cached per place + unit so re-renders and taps are instant.
const glanceData = {};

async function fetchGlance(place) {
  const key = `glance:${state.unit}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(localStorage.getItem(key) || "null");
  if (cached && Date.now() - cached.savedAt < 15 * 60 * 1000) return cached.data;

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,weather_code,is_day",
    temperature_unit: state.unit,
    timezone: "auto"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error("Glance failed.");
  const json = await response.json();
  const data = {
    temp: Math.round(json.current.temperature_2m),
    code: json.current.weather_code,
    isDay: Boolean(json.current.is_day)
  };
  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  return data;
}

function renderSavedPlaces() {
  els.savedPlaces.innerHTML = "";
  updateSaveButton();
  updatePlaceSwitcher();

  if (!state.savedPlaces.length) {
    els.savedPlaces.innerHTML = `
      <div class="place-empty">
        <strong>No saved places yet</strong>
        <span>Save a place from the forecast to make switching faster.</span>
      </div>
    `;
  }

  state.savedPlaces.forEach((place) => {
    const g = glanceData[place.id];
    const isActive = state.activePlace && state.activePlace.id === place.id;
    const placeName = escapeHtml(place.name);
    const item = document.createElement("article");
    item.className = `place-item${isActive ? " active" : ""}`;
    item.dataset.placeId = place.id;
    item.innerHTML = `
      <button class="place-item-main" type="button" aria-label="Load ${placeName}">
        <span class="place-item-icon" aria-hidden="true">${g ? weatherIcon(g.code, g.isDay) : ""}</span>
        <span class="place-item-copy">
          <strong>${placeName}</strong>
          <span>${escapeHtml(place.admin1 || place.country || (isActive ? "Current place" : "Saved place"))}</span>
        </span>
        <span class="place-item-temp">${g ? `${g.temp}${degree(state.unit === "fahrenheit" ? "F" : "C")}` : ""}</span>
      </button>
      <button class="place-item-remove" type="button" aria-label="Remove ${placeName}">×</button>
    `;
    item.querySelector(".place-item-main").addEventListener("click", () => {
      closePlaceSheet();
      loadPlace(place);
    });
    item.querySelector(".place-item-remove").addEventListener("click", () => removeSavedPlace(place.id));
    els.savedPlaces.appendChild(item);
  });
  renderMapMarkers();
  hydrateGlances();
}

function updatePlaceSwitcher() {
  const hasContext = Boolean(state.activePlace) || state.savedPlaces.length > 0;
  els.placeSwitcher.hidden = !hasContext;
  if (!hasContext) return;

  const place = state.activePlace || state.savedPlaces[0];
  const count = state.savedPlaces.length;
  const g = place ? glanceData[place.id] : null;
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
  if (icon) icon.innerHTML = weatherIcon(g.code, g.isDay);
  if (temp) temp.textContent = `${g.temp}${degree(state.unit === "fahrenheit" ? "F" : "C")}`;
  updatePlaceSwitcher();
}

function openPlaceSheet() {
  renderSavedPlaces();
  els.placeBackdrop.hidden = false;
  els.placeSheet.hidden = false;
  requestAnimationFrame(() => {
    els.placeBackdrop.classList.add("show");
    els.placeSheet.classList.add("show");
  });
  document.body.style.overflow = "hidden";
}

function closePlaceSheet() {
  els.placeBackdrop.classList.remove("show");
  els.placeSheet.classList.remove("show");
  document.body.style.overflow = "";
  setTimeout(() => {
    els.placeBackdrop.hidden = true;
    els.placeSheet.hidden = true;
  }, 260);
}

async function loadPlace(place, force = false) {
  state.activePlace = normalizePlace(place);
  localStorage.setItem("weather-last-place", JSON.stringify(state.activePlace));
  updateMode();
  updatePlaceSwitcher();
  mapState.panX = 0;
  mapState.panY = 0;
  renderSavedPlaces();
  updateMapPlace();
  syncMapToPlace();
  renderAlerts([]); // clear prior place's alerts until this one resolves
  setStatus(`Loading ${state.activePlace.name}...`);

  try {
    const data = await fetchForecast(state.activePlace, force);
    renderForecast(data, state.activePlace);
    setStatus("");
    lastLoadedAt = Date.now();
  } catch (error) {
    setStatus("Could not load weather data. Try another place or reload the page.", true);
  }

  // Alerts are best-effort and US-only — never block or break the forecast
  try {
    renderAlerts(await fetchAlerts(state.activePlace));
  } catch {
    renderAlerts([]);
  }
}

// When the PWA returns to the foreground after being idle (a common iOS case
// where the frozen page is restored without re-running), pull fresh data.
let lastLoadedAt = Date.now();
const FOREGROUND_STALE_MS = 8 * 60 * 1000;

function refreshOnForeground() {
  if (document.visibilityState === "hidden") return;
  if (!state.activePlace) return;
  if (Date.now() - lastLoadedAt < FOREGROUND_STALE_MS) return;
  for (const id in glanceData) delete glanceData[id]; // let chips re-pull too
  loadPlace(state.activePlace, true);
}

async function fetchForecast(place, force = false) {
  const cacheKey = `forecast:${state.unit}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 15 * 60 * 1000;

  if (!force && cached && Date.now() - cached.savedAt < maxCacheAge) {
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
      "wind_speed_10m",
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

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error("Forecast failed.");
  const data = await response.json();
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  return data;
}

function renderForecast(data, place) {
  state.forecast = data; // retained for the day-detail sheet
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const current = data.current;
  const firstRainChance = data.hourly.precipitation_probability[0] ?? data.daily.precipitation_probability_max[0];
  const todayCode = weatherCodes[current.weather_code] || "Weather";

  const isDay = current.is_day !== undefined ? Boolean(current.is_day) : true;
  state.locationIsDay = isDay;
  state.sunriseMs = parseForecastTimestamp(data.daily.sunrise[0], data);
  state.sunsetMs = parseForecastTimestamp(data.daily.sunset[0], data);
  if (state.theme === "auto") applyTheme();

  els.locationName.textContent = placeLabel(place);
  els.nowTemp.textContent = `${Math.round(current.temperature_2m)}${degree(tempUnit)}`;
  els.nowSummary.textContent = buildSummary(data);
  els.feelsLike.textContent = `${Math.round(current.apparent_temperature)}${degree(tempUnit)}`;
  els.rainChance.textContent = `${firstRainChance || 0}%`;
  els.wind.textContent = `${Math.round(current.wind_speed_10m)} ${windUnit}`;
  els.uv.textContent = Math.round(data.daily.uv_index_max[0] || 0);
  els.humidity.textContent = `${current.relative_humidity_2m ?? "--"}%`;
  els.sunrise.textContent = data.daily.sunrise[0] ? formatTime(data.daily.sunrise[0]) : "--";
  els.sunset.textContent = data.daily.sunset[0] ? formatTime(data.daily.sunset[0]) : "--";
  els.updatedAt.textContent = `Updated ${formatTime(current.time)}`;

  const heroIcon = document.getElementById("heroIcon");
  if (heroIcon) heroIcon.innerHTML = weatherIcon(current.weather_code, isDay);

  renderNowcast(data);
  renderInsights(data, windUnit);
  resetBriefing();
  renderHourly(data, tempUnit);
  renderDaily(data, tempUnit, precipUnit);
  updateMapPlace();
  refreshInlineMap(true);
  bindMetricTips(data, tempUnit, windUnit);
  updateSkyCanvas(current.weather_code, isDay);
}

function buildSummary(data) {
  const daily = data.daily;
  const now = forecastNowMs(data);
  const sunriseMs = state.sunriseMs || parseForecastTimestamp(daily.sunrise[0], data);
  const sunsetMs = state.sunsetMs || parseForecastTimestamp(daily.sunset[0], data);
  const twoHoursMs = 2 * 60 * 60 * 1000;

  const high0 = Math.round(daily.temperature_2m_max[0]);
  const low0 = Math.round(daily.temperature_2m_min[0]);
  const rain0 = daily.precipitation_probability_max[0] || 0;
  const gust0 = Math.round(daily.wind_gusts_10m_max[0] || data.current.wind_gusts_10m || 0);

  const high1 = Math.round(daily.temperature_2m_max[1]);
  const rain1 = daily.precipitation_probability_max[1] || 0;
  const gust1 = Math.round(daily.wind_gusts_10m_max[1] || 0);

  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const rainPhrase = (pct) =>
    pct >= 70 ? "rain is likely" : pct >= 40 ? "rain is possible" : "rain chances stay low";
  const gustPhrase = (g) =>
    g > 0 ? `Gusts may reach ${g} ${windUnit}.` : "";

  const isEvening = sunsetMs && now >= sunsetMs - twoHoursMs;
  const isMorning = sunriseMs && now < sunriseMs + twoHoursMs;

  if (isEvening) {
    const tomorrowRain = rainPhrase(rain1);
    const gusts = gustPhrase(gust1 || gust0);
    return `Overnight low of ${low0}°. Tomorrow: high of ${high1}°, ${tomorrowRain}. ${gusts}`.trim();
  }

  if (isMorning || !sunriseMs) {
    return `Today will reach a high of ${high0}°, low of ${low0}°. ${capitalize(rainPhrase(rain0))} this afternoon. ${gustPhrase(gust0)}`.trim();
  }

  return `Afternoon high near ${high0}°, dropping to ${low0}° overnight. ${capitalize(rainPhrase(rain0))} later. ${gustPhrase(gust0)}`.trim();
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

function renderNowcast(data) {
  const el = document.getElementById("nowcast");
  const analysis = analyzeNowcast(data);
  if (!analysis) {
    el.hidden = true;
    return;
  }

  document.getElementById("nowcastTitle").textContent = analysis.title;
  document.getElementById("nowcastSubtitle").textContent = analysis.detail;
  document.getElementById("nowcastIcon").innerHTML = analysis.isSnow ? snowGlyph() : raindropGlyph();
  document.getElementById("nowcastGraph").innerHTML = buildNowcastGraph(analysis);
  el.style.setProperty("--nowcast-accent", nowcastIntensityColor(analysis.peakFrac));
  el.style.setProperty("--nowcast-glow", nowcastIntensityRgba(analysis.peakFrac, analysis.isSnow ? 0.18 : 0.22));
  el.setAttribute("aria-label", `${analysis.headline}. Open hourly details.`);
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
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h < 12 ? "a" : "p";
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
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
function buildAIContext() {
  const data = state.forecast;
  if (!data || !state.activePlace) return null;

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
      dow: new Date(`${daily.time[i]}T12:00:00`).getDay(),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayName(daily.time[i]),
      hi: r(daily.temperature_2m_max[i]),
      lo: r(daily.temperature_2m_min[i]),
      rainChance: daily.precipitation_probability_max[i] || 0,
      sky: sky(daily.weather_code[i]),
      sunrise: daily.sunrise[i] ? shortClock(daily.sunrise[i]) : null,
      sunset: daily.sunset[i] ? shortClock(daily.sunset[i]) : null
    });
  }

  const alerts = (activeAlerts || []).slice(0, 3).map((a) => ({
    event: a.event,
    severity: a.severity,
    until: (a.ends || a.expires) ? shortClock(new Date(a.ends || a.expires).getTime()) : null
  }));

  return {
    place: placeLabel(state.activePlace),
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
      sky: sky(daily.weather_code[1]),
      sunrise: daily.sunrise[1] ? shortClock(daily.sunrise[1]) : null,
      sunset: daily.sunset[1] ? shortClock(daily.sunset[1]) : null
    },
    next12h,
    daily: dailyArr,
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

/* ---------- Planner: local AI summary (Tier 1, opt-in) ---------- */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const LOCAL_AI_MODEL_MB = 350;
const LOCAL_AI_MIN_FREE_BYTES = 450 * 1024 * 1024;

// phase: unknown | unsupported | idle | loading | ready | generating | error
const aiState = {
  phase: "unknown",
  progress: 0,
  status: "",
  text: "",
  error: "",
  support: null,
  loadError: "",
  reportCopied: false
};
let aiBriefAbort = null;
let aiModule = null;

function loadAIModule() {
  if (!aiModule) aiModule = import("./ai.js");
  return aiModule;
}

function detectBrowserName(ua) {
  if (/Edg\//.test(ua)) return "Edge";
  if (/CriOS\//.test(ua)) return "Chrome iOS";
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua) || /FxiOS\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

function plannerHostInfo() {
  const ua = navigator.userAgent || "";
  const brands = navigator.userAgentData?.brands?.map((b) => `${b.brand} ${b.version}`).join(", ") || "";
  return {
    browser: detectBrowserName(ua),
    platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
    mobile: navigator.userAgentData?.mobile ?? /Mobi|Android/i.test(ua),
    brands,
    userAgent: ua
  };
}

function supportsModuleWorker() {
  if (!window.Worker || !window.Blob || !window.URL?.createObjectURL) return false;
  let url = "";
  try {
    url = URL.createObjectURL(new Blob(["export {};"], { type: "text/javascript" }));
    const worker = new Worker(url, { type: "module" });
    worker.terminate();
    return true;
  } catch (_) {
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function bytesToMB(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Math.round(bytes / 1024 / 1024);
}

function cleanError(err) {
  const text = err?.message || String(err || "");
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function adapterSnapshot(adapter) {
  const limits = adapter?.limits || {};
  return {
    features: adapter?.features ? Array.from(adapter.features).slice(0, 25) : [],
    limits: {
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize
    }
  };
}

async function probeLocalAI() {
  const report = {
    appVersion: VERSION,
    model: LOCAL_AI_MODEL,
    modelDownloadMB: LOCAL_AI_MODEL_MB,
    checkedAt: new Date().toISOString(),
    host: plannerHostInfo(),
    origin: location.origin,
    secureContext: window.isSecureContext === true,
    webgpu: "gpu" in navigator,
    adapter: false,
    device: false,
    moduleWorker: supportsModuleWorker(),
    cacheApi: "caches" in window,
    storage: null,
    adapterDetails: null,
    result: "unknown",
    reason: "",
    warnings: []
  };

  const fail = (code, reason, err) => {
    report.result = code;
    report.reason = reason;
    if (err) report.error = cleanError(err);
    return { ok: false, report };
  };

  if (!report.secureContext) {
    return fail("needs-secure-context", "Private AI summary needs HTTPS or localhost.");
  }
  if (!report.webgpu) {
    return fail("no-webgpu", "This browser does not expose WebGPU.");
  }
  if (!report.moduleWorker) {
    return fail("no-module-worker", "This browser cannot run the module worker used by the local model.");
  }
  if (!report.cacheApi) {
    report.warnings.push("Cache API is unavailable; the model may need to download again.");
  }

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      const usage = estimate.usage || 0;
      const free = quota ? Math.max(0, quota - usage) : null;
      report.storage = {
        quotaMB: bytesToMB(quota),
        usageMB: bytesToMB(usage),
        freeMB: bytesToMB(free)
      };
      if (free != null && free < LOCAL_AI_MIN_FREE_BYTES) {
        report.warnings.push(`Browser storage may be tight (${bytesToMB(free)} MB free).`);
      }
    } catch (err) {
      report.warnings.push(`Storage estimate failed: ${cleanError(err)}`);
    }
  } else {
    report.warnings.push("Storage estimate API is unavailable.");
  }

  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) adapter = await navigator.gpu.requestAdapter();
  } catch (err) {
    return fail("adapter-error", "WebGPU adapter request failed.", err);
  }
  if (!adapter) {
    return fail("no-adapter", "WebGPU is present, but no compatible GPU adapter was available.");
  }
  report.adapter = true;
  report.adapterDetails = adapterSnapshot(adapter);

  try {
    const device = await adapter.requestDevice();
    report.device = true;
    if (device.destroy) device.destroy();
  } catch (err) {
    return fail("device-error", "WebGPU is present, but the browser could not create a GPU device.", err);
  }

  report.result = "ready";
  report.reason = report.warnings.length
    ? "Local AI summary appears supported, with compatibility warnings."
    : "Local AI summary appears supported.";
  return { ok: true, report };
}

function localAIReady() {
  return aiState.support?.result === "ready";
}

function supportReason() {
  return aiState.support?.reason || "Private AI summary is not available on this device.";
}

function supportReportText() {
  return JSON.stringify({
    app: "Nearcast",
    appVersion: VERSION,
    plannerPhase: aiState.phase,
    model: LOCAL_AI_MODEL,
    support: aiState.support,
    loadError: aiState.loadError || null
  }, null, 2);
}

async function copySupportReport() {
  aiState.reportCopied = false;
  try {
    await navigator.clipboard.writeText(supportReportText());
    aiState.reportCopied = true;
  } catch (err) {
    aiState.loadError = `Copy failed: ${cleanError(err)}`;
  }
  renderBriefing();
}

function classifyAIError(err) {
  const msg = cleanError(err);
  const lower = msg.toLowerCase();
  aiState.loadError = msg;
  if (/quota|storage|cache|indexeddb|opfs/.test(lower)) {
    return "The local model could not be stored. Free up browser storage or try another browser profile.";
  }
  if (/fetch|network|import|cdn|load failed|failed to fetch/.test(lower)) {
    return "The local model or runtime could not download. Check connection, content blockers, then retry.";
  }
  if (/gpu|adapter|device|memory|out of memory|webgpu/.test(lower)) {
    return "This browser found WebGPU, but the device could not start the local model.";
  }
  return "Couldn't start the private AI summary on this device.";
}

function renderSupportActions(includeRetry = false) {
  const copied = aiState.reportCopied ? `<span class="briefing-copy-ok">Copied</span>` : "";
  return `<div class="briefing-actions">` +
    (includeRetry ? `<button class="briefing-link" data-ai="enable" type="button">Retry summary</button>` : "") +
    `<button class="briefing-link" data-ai="copy-report" type="button">Copy support report</button>` +
    copied +
  `</div>`;
}

// One-time capability probe. Planner works everywhere; the private summary gets
// enabled only when the current browser, host, GPU, worker, and storage path look viable.
async function detectAI() {
  const support = await probeLocalAI();
  aiState.support = support.report;
  aiState.phase = support.ok ? "idle" : "unsupported";
  if (aiState.phase === "idle" && localStorage.getItem("ai-enabled") === "1") {
    // Previously enabled: optimistically show "Generate summary" and warm in the background.
    aiState.phase = "ready";
    aiState.text = "";
    warmAI();
  }
  renderBriefing();
  renderAsk();
  renderAILauncher();
}

function warmAI() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => {
    loadAIModule()
      .then((ai) => ai.load())
      .catch(() => {}); // a failed warm just means the first tap pays the load
  });
}

async function enableAI() {
  try {
    if (!localAIReady()) {
      const support = await probeLocalAI();
      aiState.support = support.report;
      if (!support.ok) {
        aiState.phase = "unsupported";
        renderBriefing();
        renderAsk();
        renderAILauncher();
        return;
      }
    }
    aiState.phase = "loading";
    aiState.progress = 0;
    aiState.status = "Starting local AI summary…";
    aiState.error = "";
    aiState.loadError = "";
    aiState.reportCopied = false;
    renderBriefing();
    const ai = await loadAIModule();
    await ai.load((p) => {
      aiState.phase = "loading";
      aiState.progress = Math.round((p.progress || 0) * 100);
      aiState.status = p.text || "Preparing local AI summary…";
      renderBriefing();
    });
    localStorage.setItem("ai-enabled", "1");
    aiState.phase = "ready";
    aiState.text = "";
    renderBriefing();
    renderAsk();
    renderAILauncher();
    runBrief(); // first briefing immediately after enabling
  } catch (err) {
    aiState.phase = "error";
    aiState.error = classifyAIError(err);
    renderBriefing();
    renderAsk();
    renderAILauncher();
  }
}

async function runBrief() {
  const factSheet = buildAIFactSheet();
  if (!factSheet) return;
  aiBriefAbort = { aborted: false };
  const mine = aiBriefAbort;
  aiState.phase = "generating";
  aiState.text = "";
  renderBriefing();
  renderAsk(); // reflect engine-busy (disable Q&A) during the briefing
  try {
    const ai = await loadAIModule();
    for await (const delta of ai.brief(factSheet, mine)) {
      if (mine.aborted) break;
      aiState.text += delta;
      renderBriefing();
    }
    aiState.phase = "ready"; // text retained → shows regenerate control
    renderBriefing();
    renderAsk(); // re-enable Q&A
  } catch (err) {
    aiState.phase = "error";
    aiState.error = classifyAIError(err) || "Private AI summary failed. Planner tools still work.";
    renderBriefing();
    renderAsk();
    renderAILauncher();
  }
}

// Clear per-city briefing text + Q&A when the forecast changes; keep engine state.
function resetBriefing() {
  if (aiBriefAbort) aiBriefAbort.aborted = true;
  if (aiState.phase === "generating") aiState.phase = localAIReady() ? "ready" : "unsupported";
  if (aiState.phase === "ready") aiState.text = "";
  aiState.reportCopied = false;
  renderBriefing();
  resetAsk();
  renderAILauncher();
}

function renderBriefing() {
  const slot = els.briefing;
  if (!slot) return;
  if (!state.forecast || !state.activePlace ||
      aiState.phase === "unknown") {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;

  // Privacy is the headline feature: the model runs entirely on-device.
  const privateTag =
    `<span class="briefing-tag">${lockGlyph()}Private AI summary · runs on your device</span>`;

  if (aiState.phase === "unsupported") {
    slot.className = "briefing briefing-compat";
    slot.innerHTML =
      `<div class="briefing-row">` +
        `<span class="briefing-spark">${lockGlyph()}</span>` +
        `<div class="briefing-copy">` +
          `<strong>Private AI summary unavailable here</strong>` +
          `<p>${escapeHtml(supportReason())}</p>` +
          `<small>Planner windows and planning answers still work on this device.</small>` +
        `</div>` +
      `</div>` +
      renderSupportActions(false);
    return;
  }

  if (aiState.phase === "idle") {
    slot.className = "briefing briefing-cta";
    const warning = aiState.support?.warnings?.[0];
    slot.innerHTML =
      `<button class="briefing-enable" data-ai="enable" type="button">` +
        `<span class="briefing-spark">${lockGlyph()}</span>` +
        `<span class="briefing-enable-copy"><strong>Enable private AI summary</strong>` +
        `<small>${escapeHtml(warning || `Runs locally with WebGPU · ~${LOCAL_AI_MODEL_MB} MB, one time`)}</small></span></button>`;
    return;
  }

  if (aiState.phase === "loading") {
    slot.className = "briefing briefing-loading";
    slot.innerHTML =
      `<div class="briefing-progress-head"><span class="briefing-spark spin">✦</span>` +
      `<span>${escapeHtml(aiState.status || "Preparing local AI summary…")}</span>` +
      `<em>${aiState.progress}%</em></div>` +
      `<div class="briefing-bar"><i style="width:${aiState.progress}%"></i></div>` +
      `<span class="briefing-tag">${lockGlyph()}One-time model download, then private on this device</span>`;
    return;
  }

  if (aiState.phase === "generating") {
    slot.className = "briefing briefing-text generating";
    slot.innerHTML =
      `<div class="briefing-row"><span class="briefing-spark">✦</span>` +
      `<p class="briefing-body">${escapeHtml(aiState.text)}<i class="briefing-caret"></i></p>` +
      `<button class="briefing-act" data-ai="stop" type="button" aria-label="Stop">■</button></div>` +
      privateTag;
    return;
  }

  if (aiState.phase === "error") {
    slot.className = "briefing briefing-compat";
    slot.innerHTML =
      `<div class="briefing-row">` +
        `<span class="briefing-spark">!</span>` +
        `<div class="briefing-copy">` +
          `<strong>Private AI summary needs attention</strong>` +
          `<p>${escapeHtml(aiState.error || "Private AI summary unavailable.")}</p>` +
          `<small>Planner windows and planning answers are still available.</small>` +
        `</div>` +
      `</div>` +
      renderSupportActions(true);
    return;
  }

  // ready
  if (aiState.text) {
    slot.className = "briefing briefing-text";
    slot.innerHTML =
      `<div class="briefing-row"><span class="briefing-spark">✦</span>` +
      `<p class="briefing-body">${escapeHtml(aiState.text)}</p>` +
      `<button class="briefing-act" data-ai="brief" type="button" aria-label="Regenerate">↻</button></div>` +
      privateTag;
  } else {
    slot.className = "briefing briefing-cta";
    slot.innerHTML =
      `<button class="briefing-enable" data-ai="brief" type="button">` +
      `<span class="briefing-spark">✦</span>` +
      `<span class="briefing-enable-copy"><strong>Generate private AI summary</strong>` +
      `<small>Runs locally on this device</small></span></button>`;
  }
}

function lockGlyph() {
  return `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
    `<rect x="3.2" y="7" width="9.6" height="6.3" rx="1.6" fill="currentColor"/>` +
    `<path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>`;
}

/* ---------- Ask the forecast (Q&A + activity chips) ---------- */
// Chips and typed questions are answered by local deterministic forecast logic.
// The tiny model stays focused on summaries; it never owns weather verdicts.
const ACTIVITY_CHIPS = [
  { label: "Dry window", q: "What is the best dry window today?" },
  { label: "After work", q: "What is the best patio window after work today?" },
  { label: "Dinner outside", q: "Is dinner outside tonight a good idea?" },
  { label: "Yard work", q: "What is a reasonable yard-work window this weekend?" },
  { label: "What to wear", q: "What should I wear tonight?" }
];

// Resolve a target day (index into c.daily, 0=today … 9) from a question's
// weekday names or relative phrases. Returns null when no day is referenced.
function resolveDayIndex(s, c) {
  const days = c.daily;
  if (!days || !days.length) return null;
  if (/\bday after tomorrow\b/.test(s)) return Math.min(2, days.length - 1);
  if (/\btomorrow\b/.test(s)) return 1;
  const inN = s.match(/\bin (\d+) days?\b/);
  if (inN) { const n = +inN[1]; if (n >= 0 && n < days.length) return n; }
  // Weekday names → next occurrence (today counts if it matches).
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let wd = 0; wd < 7; wd++) {
    if (s.includes(names[wd])) {
      for (let i = 0; i < days.length; i++) if (days[i].dow === wd) return i;
    }
  }
  if (s.includes("weekend")) {
    for (let i = 0; i < days.length; i++) if (days[i].dow === 6) return i; // next Saturday
  }
  if (/\btonight\b|\bovernight\b|\btoday\b|\bright now\b|\bthis afternoon\b/.test(s)) return 0;
  return null;
}

// A short conversation thread of {q, a} for this place/session. The last entry
// may be mid-stream (askStreaming). Cleared when the place changes.
let askThread = [];
let askStreaming = false;
let askError = "";
let askAbort = null;

async function runAsk(question, intent) {
  question = (question || "").trim();
  if (!question) return;
  // Engine does one generation at a time — ignore taps while it's busy.
  if (aiState.phase === "generating" || askStreaming) return;
  askError = "";

  // Activity chips: answer instantly from a code-computed verdict. No model —
  // a tiny model can't reliably reason about this, and even handed the correct
  // verdict it sometimes mangles or flips it. Deterministic = always correct.
  if (intent) {
    const assessment = assessActivity(intent);
    if (!assessment) return;
    askThread.push({ q: question, a: assessment });
    renderAsk();
    scrollAskIntoView();
    return;
  }

  // Free-form: answer deterministically from the data (always correct). We do
  // NOT route open questions to the model — a 0.5B hallucinates on these
  // (e.g. inventing a day's forecast). If we can't answer exactly, say what we
  // CAN answer rather than guessing.
  const direct = answerFreeform(question);
  askThread.push({ q: question, a: direct || AI_FALLBACK_MSG });
  renderAsk();
  scrollAskIntoView();
}

const AI_FALLBACK_MSG =
  "I can answer weather decisions like \"dinner outside tonight?\", \"better today or tomorrow?\", " +
  "\"too windy for biking after 5?\", \"what should I wear tonight?\", plus rain, temperature, wind, UV, " +
  "humidity, and sunrise/sunset through the next 10 days.";

const ACTIVITY_RULES = {
  run: { label: "a run", hot: 86, cold: 34, rain: 35, wind: 24, uv: 9, aliases: ["run", "running", "jog", "jogging"] },
  bike: { label: "a bike ride", hot: 88, cold: 36, rain: 30, wind: 20, uv: 9, aliases: ["bike", "biking", "cycling", "cycle"] },
  walk: { label: "a walk", hot: 90, cold: 28, rain: 45, wind: 28, uv: 10, aliases: ["walk", "walking", "stroll", "dog", "walk the dog"] },
  dinner: { label: "dinner outside", hot: 92, cold: 45, rain: 30, wind: 18, uv: 9, aliases: ["dinner", "supper", "dinner outside", "eat outside", "eating outside", "patio dinner"] },
  grill: { label: "grilling outside", hot: 94, cold: 35, rain: 35, wind: 18, uv: 10, aliases: ["grill", "grilling", "barbecue", "bbq", "cookout", "cook out"] },
  picnic: { label: "a picnic", hot: 90, cold: 45, rain: 25, wind: 20, uv: 8, aliases: ["picnic", "patio", "eat outside", "dinner outside", "lunch outside"] },
  yard: { label: "yard work", hot: 86, cold: 35, rain: 35, wind: 28, uv: 8, aliases: ["yard", "mow", "mowing", "garden", "gardening", "rake", "yard work"] },
  golf: { label: "golf", hot: 92, cold: 40, rain: 35, wind: 22, uv: 9, aliases: ["golf", "golfing"] },
  hike: { label: "a hike", hot: 84, cold: 32, rain: 30, wind: 25, uv: 8, aliases: ["hike", "hiking", "trail"] },
  sports: { label: "outdoor sports", hot: 88, cold: 35, rain: 35, wind: 25, uv: 9, aliases: ["soccer", "baseball", "football", "tennis", "sports", "game", "practice"] },
  pool: { label: "the pool", hot: 95, cold: 75, rain: 25, wind: 22, uv: 9, aliases: ["pool", "swim", "swimming", "beach"] },
  commute: { label: "the commute", hot: 100, cold: 15, rain: 55, wind: 35, uv: 99, aliases: ["commute", "drive", "driving", "school pickup", "errands", "travel"] }
};

const ASK_PERIODS = {
  morning: { start: 6, end: 12, label: "morning" },
  afternoon: { start: 12, end: 18, label: "afternoon" },
  evening: { start: 18, end: 22, label: "evening" },
  night: { start: 20, end: 24, label: "tonight" },
  overnight: { start: 0, end: 7, label: "overnight" },
  day: { start: 8, end: 20, label: "daytime" }
};

function askText(q) {
  return ` ${String(q || "").toLowerCase().replace(/[^\w\s:]/g, " ").replace(/\s+/g, " ")} `;
}

function hasAny(s, words) {
  return words.some((w) => s.includes(w));
}

function hourText(hour) {
  const h = ((hour % 24) + 24) % 24;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${h < 12 ? "am" : "pm"}`;
}

function parseAskHour(value, ampm) {
  let hour = Number(value);
  if (!Number.isFinite(hour)) return null;
  if (ampm) {
    const meridiem = ampm.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  return Math.min(Math.max(hour, 0), 24);
}

function askDayLabel(c, dayIdx) {
  if (dayIdx === 0) return "today";
  if (dayIdx === 1) return "tomorrow";
  return c.daily[dayIdx]?.label || "that day";
}

function askWindowLabel(c, w) {
  if (w.label === "right now" || w.label === "rest of today") return w.label;
  const day = askDayLabel(c, w.dayIdx);
  if (w.period && w.dayIdx === 0 && w.period === "night") return "tonight";
  if (w.period) return `${day} ${ASK_PERIODS[w.period]?.label || w.period}`;
  return `${day} from ${hourText(w.startHour)} to ${hourText(w.endHour)}`;
}

function currentAskWindow() {
  const hour = forecastCurrentHour();
  return {
    dayIdx: 0,
    startHour: hour,
    endHour: Math.min(hour + 3, 24),
    label: "right now"
  };
}

function resolveAskWindow(q, c) {
  const s = askText(q);
  let dayIdx = resolveDayIndex(s, c);
  if (dayIdx == null) dayIdx = 0;

  const between = s.match(/\b(?:from|between)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\s+(?:and|to|-)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/);
  if (between) {
    let start = parseAskHour(between[1], between[2] || between[4]);
    let end = parseAskHour(between[3], between[4] || between[2]);
    if (start != null && end != null && end <= start) end += 12;
    return { dayIdx, startHour: start, endHour: Math.min(end, 24), label: "custom" };
  }

  const after = s.match(/\bafter\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/);
  if (after) {
    const start = parseAskHour(after[1], after[2] || "pm");
    return { dayIdx, startHour: start, endHour: Math.min(start + 5, 24), label: "custom" };
  }

  const before = s.match(/\bbefore\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/);
  if (before) {
    const end = parseAskHour(before[1], before[2] || "pm");
    return { dayIdx, startHour: Math.max(end - 5, 0), endHour: end, label: "custom" };
  }

  let period = null;
  if (/\bovernight\b/.test(s)) period = "overnight";
  else if (/\btonight\b|\bnight\b/.test(s)) period = "night";
  else if (/\bmorning\b|\bbefore noon\b/.test(s)) period = "morning";
  else if (/\bafternoon\b|\bmidday\b/.test(s)) period = "afternoon";
  else if (/\bevening\b|\bafter work\b/.test(s)) period = "evening";
  else if (/\ball day\b|\bdaytime\b/.test(s)) period = "day";

  if (/\bright now\b|\bnow\b|\bcurrently\b/.test(s)) return currentAskWindow();
  if (/\blater\b|\brest of today\b/.test(s)) {
    return { dayIdx: 0, startHour: forecastCurrentHour(), endHour: 24, label: "rest of today" };
  }
  if (hasAny(s, ["dinner", "supper", "grill", "grilling", "bbq", "barbecue", "eat outside"])) {
    return { dayIdx, startHour: 17, endHour: 21, label: "custom" };
  }
  if (hasAny(s, ["after work", "after 5", "after five"])) {
    return { dayIdx, startHour: 17, endHour: 22, label: "custom" };
  }
  if (period) return { dayIdx, startHour: ASK_PERIODS[period].start, endHour: ASK_PERIODS[period].end, period };
  return { dayIdx, startHour: dayIdx === 0 ? forecastCurrentHour() : 8, endHour: 20, period: "day" };
}

function askWindowHours(w) {
  const data = state.forecast;
  if (!data || !w) return [];
  const day = data.daily.time[w.dayIdx];
  if (!day) return [];
  const now = forecastNowMs(data);
  const startHour = w.startHour ?? 0;
  const endHour = w.endHour ?? 24;
  return data.hourly.time
    .map((time, index) => ({ time, index, ms: parseForecastTimestamp(time, data), hour: forecastLocalHour(time) }))
    .filter(({ time, ms, hour }) => {
      if (!time.startsWith(day)) return false;
      if (w.dayIdx === 0 && ms !== null && ms < now - 60 * 60 * 1000) return false;
      return hour >= startHour && hour < endHour;
    });
}

function avg(values) {
  return values.reduce((sum, item) => sum + Number(item || 0), 0) / Math.max(values.length, 1);
}

function mostCommon(values) {
  const counts = {};
  values.forEach((value) => { counts[value] = (counts[value] || 0) + 1; });
  return values.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
}

function askWindowStats(w) {
  const data = state.forecast;
  const c = buildAIContext();
  if (!data || !c) return null;
  const hours = askWindowHours(w);
  const day = c.daily[w.dayIdx] || c.daily[0];
  const idxs = hours.map(({ index }) => index);
  const values = (key, fallback) => idxs.length ? idxs.map((i) => data.hourly[key][i] ?? fallback) : [fallback];
  const temps = idxs.length ? idxs.map((i) => data.hourly.temperature_2m[i]) : [day.hi, day.lo];
  const feels = idxs.length ? idxs.map((i) => data.hourly.apparent_temperature[i]) : temps;
  const pop = idxs.length ? values("precipitation_probability", 0) : [day.rainChance];
  const precip = idxs.length ? values("precipitation", 0) : [0];
  const wind = idxs.length ? values("wind_speed_10m", c.now.wind) : [c.now.wind];
  const gust = idxs.length ? values("wind_gusts_10m", c.now.gust) : [c.now.gust];
  const uv = idxs.length ? values("uv_index", 0) : [w.dayIdx === 0 ? c.today.uvPeak : 0];
  const codes = idxs.length ? idxs.map((i) => data.hourly.weather_code[i]) : [data.daily.weather_code[w.dayIdx] || data.current.weather_code];

  return {
    window: w,
    label: askWindowLabel(c, w),
    day,
    tempAvg: Math.round(avg(temps)),
    tempMin: Math.round(Math.min(...temps)),
    tempMax: Math.round(Math.max(...temps)),
    feelsAvg: Math.round(avg(feels)),
    rainChance: Math.round(Math.max(...pop)),
    precipTotal: precip.reduce((sum, item) => sum + Number(item || 0), 0),
    windMax: Math.round(Math.max(...wind)),
    gustMax: Math.round(Math.max(...gust)),
    uvMax: Math.round(Math.max(...uv)),
    sky: weatherCodes[mostCommon(codes)] || day.sky || "Weather"
  };
}

function tempAsF(value) {
  return state.unit === "celsius" ? Math.round((value * 9) / 5 + 32) : value;
}

function askRainWord(p) {
  if (p < 15) return "unlikely";
  if (p < 35) return "a slight chance";
  if (p < 60) return "possible";
  return "likely";
}

function activityComfort(feelsF, rule) {
  if (feelsF >= rule.hot + 8) return "too hot";
  if (feelsF >= rule.hot) return "hot";
  if (feelsF <= rule.cold - 8) return "too cold";
  if (feelsF <= rule.cold) return "cold";
  return "comfortable";
}

function activityAnswer(rule, stats, units) {
  const result = scoreActivityWindow(rule, stats, units);
  return `${result.verdict} for ${rule.label} ${stats.label}: ${result.reasons.join(", ")}.`;
}

function scoreActivityWindow(rule, stats, units) {
  const feelsF = tempAsF(stats.feelsAvg);
  const reasons = [];
  let score = 3;

  if (stats.rainChance >= rule.rain + 25) {
    score = Math.min(score, 0);
    reasons.push(`${stats.rainChance}% rain chance`);
  } else if (stats.rainChance >= rule.rain) {
    score = Math.min(score, 1);
    reasons.push(`${stats.rainChance}% rain chance`);
  } else {
    reasons.push(`${askRainWord(stats.rainChance)} rain (${stats.rainChance}%)`);
  }

  const comfort = activityComfort(feelsF, rule);
  if (comfort === "too hot" || comfort === "too cold") {
    score = Math.min(score, 0);
    reasons.push(`${comfort} at ${stats.feelsAvg}${units.temp}`);
  } else if (comfort === "hot" || comfort === "cold") {
    score = Math.min(score, 1);
    reasons.push(`${comfort} at ${stats.feelsAvg}${units.temp}`);
  } else {
    reasons.push(`${stats.feelsAvg}${units.temp} and comfortable`);
  }

  if (stats.gustMax >= rule.wind + 12) {
    score = Math.min(score, 1);
    reasons.push(`gusts near ${stats.gustMax} ${units.wind}`);
  } else if (stats.windMax >= rule.wind) {
    score = Math.min(score, 2);
    reasons.push(`wind near ${stats.windMax} ${units.wind}`);
  }

  if (rule.uv < 99 && stats.uvMax >= rule.uv) {
    score = Math.min(score, 2);
    reasons.push(`UV peaks at ${stats.uvMax}`);
  }

  const verdict = score >= 3 ? "Good conditions" : score === 2 ? "Pretty good" : score === 1 ? "Doable, with caveats" : "Not ideal";
  return { score, verdict, reasons };
}

function numericWindowScore(rule, stats) {
  const feelsF = tempAsF(stats.feelsAvg);
  const target = 72;
  const tempPenalty = Math.abs(feelsF - target) * (rule.label === "the pool" ? 0.35 : 0.8);
  const rainPenalty = stats.rainChance * 1.2 + stats.precipTotal * 80;
  const windPenalty = Math.max(0, stats.windMax - rule.wind) * 2 + Math.max(0, stats.gustMax - rule.wind - 8) * 2;
  const uvPenalty = rule.uv < 99 ? Math.max(0, stats.uvMax - rule.uv + 1) * 5 : 0;
  return Math.round(100 - tempPenalty - rainPenalty - windPenalty - uvPenalty);
}

function currentHourFloat() {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

function windowVerdict(score) {
  if (score >= 80) return "Great";
  if (score >= 65) return "Good";
  if (score >= 45) return "Iffy";
  return "Poor";
}

function windowQuality(score) {
  if (score >= 70) return "show";
  if (score >= 45) return "caution";
  return "fallback";
}

function plannerWindow({ todayStart, todayEnd, tomorrowStart = todayStart, tomorrowEnd = todayEnd, rolloverAt = todayEnd - 0.25 }) {
  const hour = currentHourFloat();
  if (hour >= rolloverAt) {
    return { dayIdx: 1, earliestHour: tomorrowStart, limitHour: tomorrowEnd };
  }
  return { dayIdx: 0, earliestHour: todayStart, limitHour: todayEnd, allowTomorrow: false };
}

function cardWindowText(stats, prefix = "") {
  return prefix ? `${prefix}: ${capitalize(stats.label)}` : capitalize(stats.label);
}

function cardMeta(prefix, reasons) {
  return `${prefix}: ${reasons.slice(0, 2).join(" · ")}`;
}

function bestWindowOptionsFromText(s, c) {
  const options = {};
  const dayIdx = resolveDayIndex(s, c);
  if (dayIdx != null) options.dayIdx = dayIdx;

  if (hasAny(s, ["dinner", "supper", "grill", "grilling", "bbq", "barbecue", "eat outside"])) {
    options.earliestHour = 17;
    options.limitHour = 21;
    options.allowTomorrow = !hasAny(s, ["tonight", "today"]);
  } else if (hasAny(s, ["after work", "after 5", "after five"])) {
    options.earliestHour = 17;
    options.limitHour = 22;
  } else if (hasAny(s, ["morning"])) {
    options.earliestHour = 6;
    options.limitHour = 12;
  } else if (hasAny(s, ["afternoon", "midday"])) {
    options.earliestHour = 12;
    options.limitHour = 18;
  } else if (hasAny(s, ["evening"])) {
    options.earliestHour = 17;
    options.limitHour = 22;
  } else if (hasAny(s, ["weekend"])) {
    options.earliestHour = 8;
    options.limitHour = 18;
  }

  return options;
}

function candidateAskWindows({ dayIdx = 0, hours = 2, earliestHour = 6, limitHour = 22 } = {}) {
  const start = dayIdx === 0 ? Math.max(forecastCurrentHour(), earliestHour) : earliestHour;
  const windows = [];
  for (let h = start; h + hours <= limitHour; h += 1) {
    windows.push({ dayIdx, startHour: h, endHour: h + hours, label: "custom" });
  }
  return windows;
}

function bestWindowForRule(rule, options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  let candidates = candidateAskWindows(options)
    .map((window) => askWindowStats(window))
    .filter(Boolean)
    .map((stats) => ({ stats, score: numericWindowScore(rule, stats) }))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length && (options.dayIdx || 0) === 0 && options.allowTomorrow !== false) {
    candidates = candidateAskWindows({ ...options, dayIdx: 1 })
      .map((window) => askWindowStats(window))
      .filter(Boolean)
      .map((stats) => ({ stats, score: numericWindowScore(rule, stats) }))
      .sort((a, b) => b.score - a.score);
  }

  if (!candidates.length) return null;
  const best = candidates[0];
  const assessment = scoreActivityWindow(rule, best.stats, c.units);
  return {
    ...best,
    title: `Best for ${rule.label}`,
    answer: `${assessment.verdict} for ${rule.label} ${best.stats.label}: ${assessment.reasons.join(", ")}.`,
    reasons: assessment.reasons
  };
}

function bestDryWindow(options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  const windows = candidateAskWindows(options)
    .map((window) => askWindowStats(window))
    .filter(Boolean)
    .map((stats) => ({
      stats,
      score: 100 - stats.rainChance - stats.precipTotal * 120 - Math.max(0, stats.windMax - 25)
    }))
    .sort((a, b) => b.score - a.score);
  if (!windows.length) return null;
  const best = windows[0];
  return {
    ...best,
    title: "Best dry window",
    answer: `Best dry window ${best.stats.label}: rain is ${askRainWord(best.stats.rainChance)} (${best.stats.rainChance}%), wind up to ${best.stats.windMax} ${c.units.wind}.`,
    reasons: [`${best.stats.rainChance}% rain`, `${best.stats.windMax} ${c.units.wind} wind`, `${best.stats.tempAvg}${c.units.temp}`]
  };
}

function bestWindowAnswer(activityKey, options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  if (activityKey === "dry") return bestDryWindow(options)?.answer || null;
  const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.walk;
  const result = bestWindowForRule(rule, options);
  if (result) return result.answer;
  if (options.allowTomorrow === false) return `I do not see a useful ${rule.label} window left tonight.`;
  return null;
}

function buildBestWindowCards() {
  const c = buildAIContext();
  if (!c) return [];

  const dry = bestDryWindow();
  const walkWindow = plannerWindow({ todayStart: 6, todayEnd: 21, tomorrowStart: 7, tomorrowEnd: 11, rolloverAt: 20.75 });
  const dinnerWindow = plannerWindow({ todayStart: 17, todayEnd: 21, tomorrowStart: 17, tomorrowEnd: 21, rolloverAt: 20.5 });
  const afterWorkWindow = plannerWindow({ todayStart: 17, todayEnd: 22, tomorrowStart: 17, tomorrowEnd: 22, rolloverAt: 21.5 });
  const walk = bestWindowForRule(ACTIVITY_RULES.walk, walkWindow);
  const dinner = bestWindowForRule(ACTIVITY_RULES.dinner, dinnerWindow);
  const afterWork = bestWindowForRule(ACTIVITY_RULES.picnic, afterWorkWindow);

  const dryCard = dry && (() => {
    const rain = dry.stats.rainChance;
    if (rain < 25) {
      return {
        ...dry,
        badge: "Dry",
        title: "Driest stretch",
        q: "What is the best dry window today?",
        window: cardWindowText(dry.stats),
        meta: cardMeta("Lowest rain chance", dry.reasons)
      };
    }
    if (rain < 60) {
      return {
        ...dry,
        badge: "Maybe",
        title: "Least wet stretch",
        q: "What is the least wet window today?",
        window: cardWindowText(dry.stats),
        meta: cardMeta("Not truly dry", dry.reasons)
      };
    }
    return {
      ...dry,
      badge: "Wet",
      title: "Rainy day",
      q: "Is there any useful dry window today?",
      window: cardWindowText(dry.stats, "Best odds"),
      meta: cardMeta("No reliable dry stretch", dry.reasons)
    };
  })();

  const walkCard = walk && (() => {
    const quality = windowQuality(walk.score);
    const tomorrow = walk.stats.window.dayIdx > 0;
    return {
      ...walk,
      badge: quality === "show" ? windowVerdict(walk.score) : quality === "caution" ? "Iffy" : "Brief",
      title: quality === "show" ? "Comfortable walk" : quality === "caution" ? "Walk check" : "Quick walk only",
      q: tomorrow ? "When is a comfortable time for a walk tomorrow?" : "When is a comfortable time for a walk today?",
      window: cardWindowText(walk.stats),
      meta: cardMeta(quality === "fallback" ? "Keep it short" : "Comfort window", walk.reasons)
    };
  })();

  const dinnerCard = dinner && (() => {
    const quality = windowQuality(dinner.score);
    const tomorrow = dinner.stats.window.dayIdx > 0;
    return {
      ...dinner,
      badge: quality === "show" ? windowVerdict(dinner.score) : quality === "caution" ? "Iffy" : "Indoor",
      title: quality === "show" ? (tomorrow ? "Tomorrow dinner outside" : "Dinner outside")
        : quality === "caution" ? "Dinner check" : "Indoor dinner weather",
      q: tomorrow ? "Is dinner outside tomorrow a good idea?" : "Is dinner outside tonight a good idea?",
      window: cardWindowText(dinner.stats),
      meta: cardMeta(quality === "fallback" ? "Better inside" : "Dinner hours", dinner.reasons)
    };
  })();

  const afterWorkCard = afterWork && (() => {
    const quality = windowQuality(afterWork.score);
    const tomorrow = afterWork.stats.window.dayIdx > 0;
    return {
      ...afterWork,
      badge: quality === "show" ? windowVerdict(afterWork.score) : quality === "caution" ? "Iffy" : "Skip",
      title: quality === "show" ? "After work outside" : quality === "caution" ? "After-work check" : "After-work indoor weather",
      q: tomorrow ? "What is the best patio window after work tomorrow?" : "What is the best patio window after work today?",
      window: cardWindowText(afterWork.stats),
      meta: cardMeta(quality === "fallback" ? "Not much payoff" : "After 5pm", afterWork.reasons)
    };
  })();

  const defaults = [
    dryCard,
    walkCard,
    dinnerCard,
    afterWorkCard
  ].filter(Boolean);

  return defaults.slice(0, 4).map((item) => {
    const score = Math.max(0, Math.min(100, item.score));
    return {
      q: item.q,
      badge: item.badge || windowVerdict(score),
      title: item.title,
      window: item.window || capitalize(item.stats.label),
      meta: item.meta || cardMeta("Weather", item.reasons),
      score
    };
  });
}

function detectAskActivity(q) {
  const s = askText(q);
  for (const [key, rule] of Object.entries(ACTIVITY_RULES)) {
    if (rule.aliases.some((alias) => s.includes(` ${alias} `) || s.includes(alias))) return key;
  }
  return null;
}

function assessActivity(intent) {
  const c = buildAIContext();
  if (!c) return null;
  const stats = askWindowStats(currentAskWindow());
  const rule = ACTIVITY_RULES[intent] || ACTIVITY_RULES.walk;
  return stats ? activityAnswer(rule, stats, c.units) : null;
}

function outfitAnswer(stats, units) {
  const feelsF = tempAsF(stats.feelsAvg);
  let outfit;
  if (feelsF >= 88) outfit = "light, breathable clothes";
  else if (feelsF >= 72) outfit = "short sleeves";
  else if (feelsF >= 60) outfit = "a light layer";
  else if (feelsF >= 45) outfit = "a jacket";
  else if (feelsF >= 30) outfit = "a warm coat";
  else outfit = "heavy winter layers";
  const extras = [];
  if (stats.rainChance >= 35) extras.push("rain gear");
  if (stats.windMax >= 20) extras.push("something wind-resistant");
  if (stats.uvMax >= 7) extras.push("sunscreen");
  return `${capitalize(stats.label)}: feels around ${stats.feelsAvg}${units.temp}, ${stats.sky.toLowerCase()}. Wear ${outfit}${extras.length ? `, plus ${extras.join(" and ")}` : ""}.`;
}

function umbrellaAnswer(stats) {
  if (stats.rainChance >= 60) return `Yes — rain is likely ${stats.label} (${stats.rainChance}% chance). Take an umbrella.`;
  if (stats.rainChance >= 35) return `Maybe — there is a ${stats.rainChance}% rain chance ${stats.label}. An umbrella is worth carrying.`;
  return `Probably not — rain is ${askRainWord(stats.rainChance)} ${stats.label} (${stats.rainChance}% chance).`;
}

function generalForecastAnswer(stats, units) {
  return `${capitalize(stats.label)}: ${stats.sky.toLowerCase()}, ${stats.tempMin}${units.temp} to ${stats.tempMax}${units.temp}, rain ${askRainWord(stats.rainChance)} (${stats.rainChance}%), wind up to ${stats.windMax} ${units.wind}.`;
}

function metricAskAnswer(q, stats, c) {
  const s = askText(q);
  const u = c.units;
  if (hasAny(s, ["sunset", "sun set", "sundown", "sun go down", "get dark"])) {
    return stats.day.sunset ? `Sunset ${askDayLabel(c, stats.window.dayIdx)} is at ${stats.day.sunset}.` : "I do not have sunset for that day.";
  }
  if (hasAny(s, ["sunrise", "sun rise", "sun up", "sun come up", "get light"])) {
    return stats.day.sunrise ? `Sunrise ${askDayLabel(c, stats.window.dayIdx)} is at ${stats.day.sunrise}.` : "I do not have sunrise for that day.";
  }
  if (hasAny(s, ["rain", "wet", "precip", "shower", "storm", "drizzle", "snow", "pour"])) {
    return `Rain is ${askRainWord(stats.rainChance)} ${stats.label}: ${stats.rainChance}% chance${stats.precipTotal ? `, about ${formatAmount(stats.precipTotal)} ${u.precip}` : ""}.`;
  }
  if (hasAny(s, ["hot", "warm", "cold", "temperature", "temp ", " high ", " low ", "degrees"])) {
    return `${capitalize(stats.label)} runs from ${stats.tempMin}${u.temp} to ${stats.tempMax}${u.temp}, feeling around ${stats.feelsAvg}${u.temp}.`;
  }
  if (hasAny(s, ["wind", "windy", "gust", "breeze", "breezy"])) {
    const gust = stats.gustMax > stats.windMax + 2 ? ` with gusts near ${stats.gustMax} ${u.wind}` : "";
    return `Wind ${stats.label} should peak near ${stats.windMax} ${u.wind}${gust}.`;
  }
  if (hasAny(s, [" uv ", "sunburn", "sunscreen", "sun strong", "strong is the sun"])) {
    return `UV ${stats.label} peaks at ${stats.uvMax}.`;
  }
  if (hasAny(s, ["humid", "muggy", "sticky", "dry air"])) {
    return `Humidity is ${c.now.humidity}% right now. I only have detailed humidity for current conditions.`;
  }
  return null;
}

function comparisonDayIndexes(q, c) {
  const s = askText(q);
  const days = [];
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  if (s.includes("today")) days.push(0);
  if (s.includes("tomorrow")) days.push(1);
  names.forEach((name, wd) => {
    if (!s.includes(name)) return;
    for (let i = 0; i < c.daily.length; i++) {
      if (c.daily[i].dow === wd && !days.includes(i)) {
        days.push(i);
        break;
      }
    }
  });
  if (s.includes("weekend")) {
    for (let i = 0; i < c.daily.length; i++) {
      if ((c.daily[i].dow === 6 || c.daily[i].dow === 0) && !days.includes(i)) days.push(i);
      if (days.length >= 2) break;
    }
  }
  if (days.length < 2 && s.includes("better")) {
    if (!days.includes(0)) days.push(0);
    if (!days.includes(1)) days.push(1);
  }
  return days.slice(0, 2);
}

function dayComfortScore(day) {
  const meanF = (tempAsF(day.hi) + tempAsF(day.lo)) / 2;
  return 100 - day.rainChance - Math.abs(meanF - 72) / 4;
}

function compareAskDays(q, c) {
  const days = comparisonDayIndexes(q, c);
  if (days.length < 2) return null;
  const a = c.daily[days[0]];
  const b = c.daily[days[1]];
  if (!a || !b) return null;
  const better = dayComfortScore(a) >= dayComfortScore(b) ? a : b;
  const other = better === a ? b : a;
  const reason = better.rainChance === other.rainChance
    ? `temps look more comfortable (${better.lo}${c.units.temp}-${better.hi}${c.units.temp})`
    : `lower rain chance (${better.rainChance}% vs ${other.rainChance}%)`;
  return `${better.label} looks better: ${reason}. ${a.label}: ${a.sky.toLowerCase()}, ${a.lo}${c.units.temp}-${a.hi}${c.units.temp}, ${a.rainChance}% rain. ${b.label}: ${b.sky.toLowerCase()}, ${b.lo}${c.units.temp}-${b.hi}${c.units.temp}, ${b.rainChance}% rain.`;
}

function answerFreeform(q) {
  const c = buildAIContext();
  if (!c) return null;
  const s = askText(q);
  const stats = askWindowStats(resolveAskWindow(q, c));
  if (!stats) return null;

  const comparison = compareAskDays(q, c);
  if (comparison && hasAny(s, ["better", "which", "compare", " or "])) return comparison;

  if (hasAny(s, ["umbrella"])) return umbrellaAnswer(stats);
  if (hasAny(s, ["what to wear", "should i wear", "what to put on", "a jacket", "a coat", "bundle"])) {
    return outfitAnswer(stats, c.units);
  }

  const activity = detectAskActivity(q);
  if (hasAny(s, ["best", "best time", "best window", "when should", "when can", "what time", "window"])) {
    const options = bestWindowOptionsFromText(s, c);
    if (hasAny(s, ["dry", "rain-free", "rain free"])) return bestWindowAnswer("dry", options);
    if (activity) return bestWindowAnswer(activity, options);
    return bestWindowAnswer("walk", options);
  }

  if (activity) return activityAnswer(ACTIVITY_RULES[activity], stats, c.units);

  const metric = metricAskAnswer(q, stats, c);
  if (metric) return metric;

  if (hasAny(s, ["weather", "forecast", "conditions", "look like", "going to be", "outside"])) {
    return generalForecastAnswer(stats, c.units);
  }

  return null;
}

function resetAsk() {
  if (askAbort) askAbort.aborted = true;
  askThread = [];
  askStreaming = false;
  askError = "";
  renderAsk();
}

function scrollAskIntoView() {
  // Keep the newest exchange + input visible inside the sheet.
  requestAnimationFrame(() => {
    const form = document.getElementById("askForm");
    if (form) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function renderAsk() {
  const panel = els.aiAsk;
  if (!panel) return;
  const available = state.forecast && state.activePlace &&
    aiState.phase !== "unknown";
  if (!available) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const busy = aiState.phase === "generating" || askStreaming;
  const dis = busy ? " disabled" : "";

  const bestCards = buildBestWindowCards().map((card) =>
    `<button class="best-window-card" type="button" data-ask-q="${escapeHtml(card.q)}"${dis}>` +
      `<span class="best-window-copy">` +
        `<span class="best-window-top">` +
          `<strong>${escapeHtml(card.title)}</strong>` +
          `<span class="best-window-badge">${escapeHtml(card.badge)}</span>` +
        `</span>` +
        `<em>${escapeHtml(card.window)}</em>` +
        `<small>${escapeHtml(card.meta)}</small>` +
      `</span>` +
    `</button>`
  ).join("");

  const chips = ACTIVITY_CHIPS.map((c) =>
    `<button class="ask-chip" type="button" data-ask-q="${escapeHtml(c.q)}"` +
    `${c.intent ? ` data-ask-intent="${escapeHtml(c.intent)}"` : ""}${dis}>${escapeHtml(c.label)}</button>`
  ).join("");

  const thread = askThread.map((ex, i) => {
    const streaming = askStreaming && i === askThread.length - 1;
    return `<div class="ask-exchange${streaming ? " answering" : ""}">` +
      `<p class="ask-q">${escapeHtml(ex.q)}</p>` +
      `<p class="ask-a">${escapeHtml(ex.a)}</p>` +
    `</div>`;
  }).join("");
  const errLine = askError ? `<p class="ask-err">${escapeHtml(askError)}</p>` : "";

  panel.innerHTML =
    (bestCards ? `<section class="best-windows" aria-label="Weather windows">` +
      `<div class="ai-section-title"><strong>Weather windows</strong><span>Weather only</span></div>` +
      `<div class="best-window-grid">${bestCards}</div>` +
    `</section>` : "") +
    `<section class="plan-presets" aria-label="Plan presets">` +
      `<div class="ai-section-title"><strong>Plan something</strong><span>Useful defaults</span></div>` +
      `<div class="ask-chips">${chips}</div>` +
    `</section>` +
    (thread ? `<div class="ask-thread">${thread}${errLine}</div>` : "") +
    `<form class="ask-form" id="askForm">` +
      `<input id="askInput" type="text" autocomplete="off" ` +
        `placeholder="Plan something… picnic Saturday afternoon"${dis}>` +
      `<button type="submit" class="ask-send" aria-label="Ask"${dis}>↑</button>` +
    `</form>`;
}

/* ---------- Planner launcher + sheet ---------- */
function renderAILauncher() {
  const btn = els.aiLauncher;
  if (!btn) return;
  const show = state.forecast && state.activePlace &&
    aiState.phase !== "unknown";
  btn.hidden = !show;
  if (show && els.aiLauncherSub) {
    els.aiLauncherSub.textContent =
      aiState.phase === "idle" ? "Plans + optional private summary"
      : aiState.phase === "unsupported" ? "Best windows & plans"
      : aiState.phase === "error" ? "Planner works · summary needs attention"
      : "Best windows, plans & private summary";
  }
}

function openAISheet() {
  els.aiBackdrop.hidden = false;
  els.aiSheet.hidden = false;
  requestAnimationFrame(() => {
    els.aiBackdrop.classList.add("show");
    els.aiSheet.classList.add("show");
  });
  document.body.style.overflow = "hidden";
  // Auto-generate the briefing the first time it's opened for a place.
  if (aiState.phase === "ready" && !aiState.text) runBrief();
}

function closeAISheet() {
  els.aiBackdrop.classList.remove("show");
  els.aiSheet.classList.remove("show");
  document.body.style.overflow = "";
  setTimeout(() => {
    els.aiBackdrop.hidden = true;
    els.aiSheet.hidden = true;
  }, 280);
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
  const sunsetTime = data.daily.sunset[0] ? formatTime(data.daily.sunset[0]) : null;
  const low0 = Math.round(data.daily.temperature_2m_min[0]);

  const morningRain = maxRainInRange(data, now, noonMs);
  const afternoonHours = hoursInRange(data, noonMs, sixPmMs);
  const afternoonRain = maxRainInRange(data, noonMs, sixPmMs);
  const afternoonHigh = afternoonHours.length
    ? Math.max(...afternoonHours.map(({ i }) => Math.round(data.hourly.temperature_2m[i])))
    : Math.round(data.daily.temperature_2m_max[0]);

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
      value: sunsetTime
        ? `Sun sets at ${sunsetTime}. Overnight low drops to ${low0}°.`
        : `Overnight low drops to ${low0}°.`
    }
  ];
}

function buildAfternoonInsights(data, windUnit) {
  const now = forecastNowMs(data);
  const sunsetMs = state.sunsetMs;
  const midnightMs = forecastLocalBoundaryMs(data, 24) ?? new Date().setHours(24, 0, 0, 0);
  const low0 = Math.round(data.daily.temperature_2m_min[0]);
  const high1 = Math.round(data.daily.temperature_2m_max[1]);
  const rain1 = data.daily.precipitation_probability_max[1] || 0;

  const remainingRain = maxRainInRange(data, now, sunsetMs || midnightMs);
  const overnightRain = maxRainInRange(data, sunsetMs || now, midnightMs);
  const sunsetTime = data.daily.sunset[0] ? formatTime(data.daily.sunset[0]) : null;

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
  const low0 = Math.round(data.daily.temperature_2m_min[0]);
  const high1 = Math.round(data.daily.temperature_2m_max[1]);
  const rain1 = data.daily.precipitation_probability_max[1] || 0;
  const uv1 = Math.round(data.daily.uv_index_max[1] || 0);
  const gust1 = Math.round(data.daily.wind_gusts_10m_max[1] || 0);
  const code1 = weatherCodes[data.daily.weather_code[1]] || "Mixed";

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

function renderHourly(data, tempUnit) {
  const now = forecastNowMs(data);
  const rows = data.hourly.time
    .map((time, index) => ({ time, index, ms: parseForecastTimestamp(time, data) }))
    .filter((row) => row.ms !== null && row.ms >= now - 60 * 60 * 1000)
    .slice(0, 24);

  els.hourly.innerHTML = rows.map(({ time, index }, position) => {
    const rain = data.hourly.precipitation_probability[index] || 0;
    const wcode = data.hourly.weather_code[index];
    const code = weatherCodes[wcode] || "Weather";
    const compactCode = compactHourlyCondition(wcode, code);
    const isHourDay = data.hourly.is_day ? Boolean(data.hourly.is_day[index]) : true;
    const label = position === 0 ? "Now" : formatHour(time);
    return `
      <article class="hour-card${position === 0 ? " current" : ""}">
        <span>${label}</span>
        <strong>${Math.round(data.hourly.temperature_2m[index])}${degree(tempUnit)}</strong>
        <div class="hour-icon" aria-hidden="true">${weatherIcon(wcode, isHourDay)}</div>
        <div class="code" title="${escapeHtml(code)}" aria-label="${escapeHtml(code)}">${escapeHtml(compactCode)}</div>
        <span>${rain}% rain</span>
        <div class="rain-bar" aria-hidden="true"><i style="width: ${rain}%"></i></div>
      </article>
    `;
  }).join("");
}

function compactHourlyCondition(code, label) {
  if (code === 95) return "Storms";
  if (code === 96 || code === 99) return "Storms + hail";
  if (label === "Rain showers") return "Showers";
  if (label === "Heavy showers") return "Heavy showers";
  if (label === "Freezing drizzle") return "Icy drizzle";
  if (label === "Freezing rain") return "Icy rain";
  if (label === "Heavy snow showers") return "Heavy snow";
  return label;
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

function renderDaily(data, tempUnit, precipUnit) {
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
    const wcode = data.daily.weather_code[index];
    const code = weatherCodes[wcode] || "Weather";
    return `
      <article class="day-row${index === 0 ? " current" : ""}" data-index="${index}" role="button" tabindex="0" aria-label="${formatDay(time, index)} detail">
        <div class="day-label">
          <div class="day-icon" aria-hidden="true">${weatherIcon(wcode, true)}</div>
          <div>
            <div class="day-name">${formatDay(time, index)}</div>
            <div class="day-meta">${escapeHtml(code)}</div>
          </div>
        </div>
        <div class="day-temps">
          <span class="day-low">${low}°</span>
          <div class="temp-track" aria-hidden="true">
            <i style="margin-left: ${start}%; width: ${width}%; background: linear-gradient(90deg, ${lowColor}, ${highColor})"></i>
          </div>
          <span class="day-high">${high}°</span>
        </div>
        <div class="day-rain" aria-label="${rain}% rain, ${formatAmount(precip)} ${precipUnit} precipitation">
          <span>${rain}%</span>
          <small>${formatAmount(precip)} ${precipUnit}</small>
        </div>
      </article>
    `;
  }).join("");
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
  el.addEventListener("mousedown", (e) => { e.preventDefault(); startMapDrag(e.clientX, e.clientY, el); });
  window.addEventListener("mousemove", (e) => moveMapDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", () => endMapGesture(el));

  el.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      startMapPinch(e.touches[0], e.touches[1]);
      return;
    }
    const t = e.touches[0];
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
  el.addEventListener("touchend", () => endMapGesture(el));
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
  const nextZoom = Math.round(pinchState.startZoom + Math.log2(ratio));
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
  loadMapFrames(forceFrames);
}

function renderMapMarkers() {
  if (!mapState.initialized || !els.markerLayer) return;
  els.markerLayer.innerHTML = "";

  const places = state.savedPlaces.length ? state.savedPlaces : state.activePlace ? [state.activePlace] : [];
  places.forEach((place) => {
    renderMapMarker(place);
  });

  if (state.activePlace && !places.some((place) => place.id === state.activePlace.id)) {
    renderMapMarker(state.activePlace);
  }
}

async function setMapMode(mode) {
  mapState.mode = mode;
  stopRadarPlayback();
  els.radarMode.classList.toggle("active", mode === "radar");
  els.futureMode.classList.toggle("active", mode === "future");
  renderMapLegend();
  await loadMapFrames(true);
}

async function loadMapFrames(force = false) {
  if (!mapState.initialized || !state.activePlace) return;
  if (!force && mapState.frames.length) {
    showFrame(mapState.frameIndex);
    return;
  }

  setMapLoading(true);
  clearMapLayers();

  try {
    mapState.frames = mapState.mode === "future" ? await fetchNoaaFutureRainFrames() : await fetchRadarFrames();

    if (!mapState.frames.length) {
      setFrameLabel(mapState.mode === "future" ? "No NWS forecast frames" : "No radar frames");
      return;
    }

    mapState.frameIndex = mapState.mode === "future" ? 0 : mapState.frames.length - 1;
    els.frameSlider.max = String(mapState.frames.length - 1);
    showFrame(mapState.frameIndex);
    maybeAutoPlayRadar(); // frames just became available — play if the map is on screen
  } catch (error) {
    setFrameLabel("Map data unavailable");
  } finally {
    setMapLoading(false);
  }
}

async function fetchRainViewerFrames() {
  const data = await fetchRainViewerData();
  const nowcast = data.radar?.nowcast || [];
  const frames = [...(data.radar?.past || []), ...nowcast];
  return frames.map((frame) => ({
    label: `${nowcast.some((item) => item.time === frame.time) ? "Nowcast" : "Radar"} ${formatFrameTime(frame.time)}`,
    time: frame.time,
    url: rainViewerTileUrl(data, frame),
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
    label: `${config.label} ${formatDateTime(time)}`,
    time,
    timestamp: new Date(time).getTime(),
    url: `${config.endpoint}?${params.toString()}`,
    attribution: "NOAA/NWS MRMS",
    maxZoom: MAP_MAX_ZOOM
  };
}

async function fetchNoaaFutureRainFrames() {
  const region = getNoaaRegion();
  const layer = `${region}_6hr_precipitation_amount`;
  const style = "precipitation_amount";
  const capabilities = await fetchNoaaPrecipCapabilities();
  const times = getNoaaLayerTimes(capabilities, layer);
  const noaaFrames = times.map((time) => buildNoaaFrame(layer, style, time));

  return buildForecastTimelineFrames(noaaFrames);
}

function buildNoaaFrame(layer, style, time) {
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
    label: `NWS rain ${formatDateTime(time)}`,
    time,
    timestamp: new Date(time).getTime(),
    url: `https://nowcoast.noaa.gov/geoserver/forecasts/ndfd_precipitation/ows?${params.toString()}`,
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

  frames.push(asForecastFrame(noaaFrames, "Now", now));

  for (let timestamp = start; timestamp <= lastNoaa.timestamp; timestamp += hour) {
    frames.push(asForecastFrame(
      noaaFrames,
      `Forecast ${formatDateTime(timestamp)}`,
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
  if (!place) return "conus";
  const latitude = Number(place.latitude);
  const longitude = normalizeMapLongitude(place.longitude);

  if (latitude >= 18 && latitude <= 23 && longitude >= -161 && longitude <= -154) return "hawaii";
  if (latitude >= 51 && latitude <= 72 && longitude >= -170 && longitude <= -129) return "alaska";
  if (latitude >= 17 && latitude <= 19 && longitude >= -68 && longitude <= -65) return "puerto_rico";
  return "conus";
}

function showFrame(index) {
  if (!mapState.frames.length) return;
  const nextIndex = Math.min(Math.max(index, 0), mapState.frames.length - 1);
  mapState.frameIndex = nextIndex;
  els.frameSlider.value = String(nextIndex);

  setFrameLabel(mapState.frames[nextIndex].label);
  renderWeatherTiles();
}

// Dragging the timeline is a manual scrub — pause playback so the loop and the
// finger don't fight, and hold the pause while the map stays in view.
function scrubToFrame(index) {
  if (mapState.playing) {
    mapState.userPausedRadar = true;
    stopRadarPlayback();
  }
  showFrame(index);
}

// Playback timing. Each frame holds sharp for most of its step, then cross-fades
// into the next over the tail — so the radar loop reads as motion, not a slideshow.
const FRAME_STEP_MS = 720;
const XFADE_PORTION = 0.42;

function frameUrl(frame) {
  return frame && (frame.url || (frame.layers && frame.layers[0] && frame.layers[0].url));
}

// How far we are through the cross-fade for a fractional playback position:
// 0 while the current frame holds, ramping 0→1 across the tail of the step.
function xfadeAmount(within) {
  return within <= 1 - XFADE_PORTION ? 0 : (within - (1 - XFADE_PORTION)) / XFADE_PORTION;
}

// Continuous, cross-faded radar render. Two panes double-buffer: the incoming
// frame loads on the hidden pane (opacity ~0) and fades up while the outgoing
// pane fades down, so a frame's tiles never swap while they're visible.
function renderXfade(pos, viewport = null) {
  const N = mapState.frames.length;
  if (!N || !els.weatherTileLayer) return;
  const i = ((Math.floor(pos) % N) + N) % N;
  const next = N > 1 ? (i + 1) % N : i;
  const fade = xfadeAmount(pos - Math.floor(pos));

  // Keep the two panes covering frames i and next; reassign only the stale pane.
  const frames = mapState.xfadeFrames;
  for (const need of [i, next]) {
    if (frames[0] !== need && frames[1] !== need) {
      const other = need === i ? next : i;
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
      const sourceZoom = Math.min(mapState.zoom, (frame && frame.maxZoom) || mapState.zoom);
      renderTileLayer(pane, vp, ({ z, x, y }) => weatherTileUrl(url, z, x, y), { sourceZoom });
    }
    pane.style.opacity = String(f === i ? 0.78 * (1 - fade) : f === next ? 0.78 * fade : 0);
  }
  while (els.weatherTileLayer.children.length > 2) {
    els.weatherTileLayer.lastElementChild.remove();
  }
}

function startRadarPlayback() {
  if (mapState.playing || !mapState.frames.length) return;
  mapState.playing = true;
  els.playRadar.textContent = "Pause";
  mapState.playPos = mapState.frameIndex;
  mapState.playClock = performance.now();
  mapState.xfadeFrames = [null, null];
  if (mapState.mode === "radar" && els.weatherTileLayer) els.weatherTileLayer.innerHTML = "";
  mapState.timer = requestAnimationFrame(playbackTick);
}

function playbackTick(now) {
  if (!mapState.playing) return;
  const N = mapState.frames.length;
  if (!N) { stopRadarPlayback(); return; }

  const dt = now - mapState.playClock;
  mapState.playClock = now;
  mapState.playPos += dt / FRAME_STEP_MS;
  if (mapState.playPos >= N) mapState.playPos -= N; // loop

  if (mapState.mode === "radar" && N > 1) {
    renderXfade(mapState.playPos);
    const i = Math.floor(mapState.playPos) % N;
    const dom = xfadeAmount(mapState.playPos - Math.floor(mapState.playPos)) < 0.5 ? i : (i + 1) % N;
    if (dom !== mapState.frameIndex) {
      mapState.frameIndex = dom;
      els.frameSlider.value = String(dom);
      setFrameLabel(mapState.frames[dom].label);
    }
  } else {
    // Forecast frames are already interpolated hourly — step them discretely.
    const idx = Math.floor(mapState.playPos) % N;
    if (idx !== mapState.frameIndex) showFrame(idx);
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
    startRadarPlayback();
  }
}

// Auto-play the radar loop while the inline map is on screen; pause when it
// scrolls out of view. A manual pause disables scroll-triggered auto-play until
// the user presses Play again in this session. Immersive mode drives itself.
let mapInView = false;
let mapViewObserver = null;

function maybeAutoPlayRadar() {
  if (mapState.immersive || !mapInView) return;
  if (mapState.userPausedRadar || !mapState.frames.length) return;
  startRadarPlayback();
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

function stopRadarPlayback() {
  const wasPlaying = mapState.playing;
  mapState.playing = false;
  els.playRadar.textContent = "Play";
  if (mapState.timer) {
    cancelAnimationFrame(mapState.timer);
    mapState.timer = null;
  }
  mapState.xfadeFrames = [null, null];
  // Settle on the current frame as a clean, accurate static render.
  if (wasPlaying && mapState.frames.length) showFrame(mapState.frameIndex);
}

function clearMapLayers() {
  stopRadarPlayback();
  mapState.frames = [];
  mapState.frameIndex = 0;
  els.frameSlider.max = "0";
  els.frameSlider.value = "0";
  els.weatherTileLayer.innerHTML = "";
  setFrameLabel("No frames");
}

function setMapLoading(isLoading) {
  els.mapLoading.hidden = !isLoading;
}

function setFrameLabel(label) {
  els.frameLabel.textContent = label;
}

function renderMapLegend() {
  if (!els.mapLegend) return;
  const isForecast = mapState.mode === "future";
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
    <strong>${escapeHtml(legend.title)}</strong>
    <div class="legend-scale" aria-hidden="true">
      ${legend.colors.map((color) => `<i style="background: ${color}"></i>`).join("")}
    </div>
    <div class="legend-labels">
      ${legend.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
    </div>
  `;
}

function setMapZoom(nextZoom, anchorClientX = null, anchorClientY = null) {
  const newZoom = Math.min(Math.max(Math.round(nextZoom), MAP_MIN_ZOOM), MAP_MAX_ZOOM);
  if (newZoom === mapState.zoom) return;
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

  const viewport = getMapViewport();
  renderTileLayer(els.baseTileLayer, viewport, ({ z, x, y }) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`);
  if (mapState.playing && mapState.mode === "radar") renderXfade(mapState.playPos, viewport);
  else renderWeatherTiles(viewport);
  renderMapMarkers();
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
  const sourceZoom = Math.min(mapState.zoom, frameMaxZoom || mapState.zoom);
  layers.forEach((layer, index) => {
    let pane = els.weatherTileLayer.children[index];
    if (!pane) {
      pane = document.createElement("div");
      pane.className = "tile-sublayer";
      els.weatherTileLayer.appendChild(pane);
    }
    pane.style.opacity = String(layer.opacity);
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
  const z = options.sourceZoom || mapState.zoom;
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
        img.addEventListener("load", () => { img.style.visibility = ""; img.dataset.tries = "0"; });
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
  if (mapState.mode !== "future") return;
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

function renderMapMarker(place) {
  if (!state.activePlace) return;
  const viewport = getMapViewport();
  const point = projectLatLon(place.latitude, place.longitude, mapState.zoom);
  const left = point.x - (viewport.center.x - viewport.width / 2);
  const top = point.y - (viewport.center.y - viewport.height / 2);

  if (left < -80 || left > viewport.width + 80 || top < -80 || top > viewport.height + 80) return;

  const marker = document.createElement("div");
  marker.className = "map-marker";
  marker.textContent = place.name;
  marker.style.left = `${left}px`;
  marker.style.top = `${top}px`;
  els.markerLayer.appendChild(marker);
}

function projectLatLon(latitude, longitude, zoom) {
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  const worldSize = 256 * 2 ** zoom;

  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  };
}

async function useCurrentLocation() {
  if (!navigator.geolocation) {
    setStatus("This browser does not support location lookup.", true);
    return;
  }

  setStatus("Waiting for location permission...");
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const fallback = placeFromCoordinates(position.coords);
      setStatus("Naming your location...");
      try {
        loadPlace(await reverseGeocodePlace(position.coords, fallback));
      } catch {
        loadPlace(fallback);
      }
    },
    () => setStatus("Location permission was not granted.", true),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
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

  const response = await fetch(url);
  if (!response.ok) throw new Error("Reverse geocoding failed.");
  const json = await response.json();
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
  }
}

function removeSavedPlace(id) {
  state.savedPlaces = state.savedPlaces.filter((place) => place.id !== id);
  localStorage.setItem("weather-places", JSON.stringify(state.savedPlaces));
  renderSavedPlaces();
  updateMode();
}

function bindMetricTips(data, tempUnit, windUnit) {
  const current = data.current;
  const isFahrenheit = tempUnit === "F";
  const feelsVal = Math.round(current.apparent_temperature);
  const actualVal = Math.round(current.temperature_2m);
  const diff = feelsVal - actualVal;
  const rainVal = data.hourly.precipitation_probability[0] ?? data.daily.precipitation_probability_max[0] ?? 0;
  const windVal = Math.round(current.wind_speed_10m);
  const uvVal = Math.round(data.daily.uv_index_max[0] || 0);
  const humidityVal = current.relative_humidity_2m ?? 0;
  const sunriseTime = data.daily.sunrise[0] ? formatTime(data.daily.sunrise[0]) : null;
  const sunsetTime = data.daily.sunset[0] ? formatTime(data.daily.sunset[0]) : null;

  const tips = {
    feelsLike: metricTipFeels(diff, feelsVal, tempUnit),
    rainChance: metricTipRain(rainVal),
    wind: metricTipWind(windVal, windUnit),
    uv: metricTipUv(uvVal),
    humidity: metricTipHumidity(humidityVal),
    sunrise: sunriseTime ? `Golden light starts at ${sunriseTime}. Temps are coolest right after dawn.` : null,
    sunset: sunsetTime ? `Sun sets at ${sunsetTime}. Temperatures will drop noticeably within the hour.` : null
  };

  Object.entries(tips).forEach(([id, tip]) => {
    if (!tip) return;
    const card = document.getElementById(id)?.closest(".metrics-group > div");
    if (!card) return;
    card.dataset.tip = tip;
    card.classList.add("has-tip");
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

function metricTipUv(uv) {
  if (uv >= 11) return `Today's UV peaks at ${uv} — extreme. If you're going out, full-cover clothing and SPF 50+ are essential.`;
  if (uv >= 8) return `Today's UV peaks at ${uv} — very high. Plan outdoor time before 10am or after 4pm, and wear SPF 30+.`;
  if (uv >= 6) return `Today's UV peaks at ${uv} — high. Sunscreen and a hat are a good idea for any extended time outside.`;
  if (uv >= 3) return `Today's UV peaks at ${uv} — moderate. Sunscreen is worth it if you're out for more than 30 minutes.`;
  return `Today's UV index stays low at ${uv}. No special sun protection needed.`;
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
  const tip = card.dataset.tip;
  if (!tip) return;
  els.metricTip.textContent = tip;
  els.metricTip.hidden = false;

  const rect = card.getBoundingClientRect();
  const tipRect = els.metricTip.getBoundingClientRect();
  // Tooltip is position:fixed so coordinates are viewport-relative — no scroll offset needed
  let top = rect.bottom + 10;
  // If the tip would be clipped at the bottom, flip it above the card instead
  if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 10;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  els.metricTip.style.top = `${top}px`;
  els.metricTip.style.left = `${left}px`;
  activeTipCard = card;
}

function hideMetricTip() {
  els.metricTip.hidden = true;
  activeTipCard = null;
}

function initMetricTipListeners() {
  const metricsEl = document.querySelector(".hero-metrics");

  // Hover: mouse only
  metricsEl.addEventListener("mouseenter", (event) => {
    const card = event.target.closest(".has-tip");
    if (card && card !== activeTipCard) showMetricTip(card);
  }, true);

  metricsEl.addEventListener("mouseleave", (event) => {
    const card = event.target.closest(".has-tip");
    if (card) hideMetricTip();
  }, true);

  // Tap: toggle tip — but only on a genuine tap, never a scroll. We let
  // touchstart pass through (no preventDefault) so the page can still scroll
  // when a swipe begins on a metric card, and only toggle on touchend if the
  // finger didn't move. This fixes the mobile annoyance where scrolling from a
  // card would snap open a tip and stop the scroll.
  let tipTouch = null;
  const TIP_MOVE_TOLERANCE = 10;

  metricsEl.addEventListener("touchstart", (event) => {
    const card = event.target.closest(".has-tip");
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
    if (!touch || touch.moved) return; // scrolled — leave tips alone
    event.preventDefault(); // a real tap: block the synthetic click + mouse events
    if (activeTipCard === touch.card) hideMetricTip();
    else showMetricTip(touch.card);
  }, { passive: false });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".hero-metrics") && !event.target.closest("#metricTip")) {
      hideMetricTip();
    }
  });

  // Dismiss tooltip immediately when the page scrolls
  window.addEventListener("scroll", hideMetricTip, { passive: true });
}

function setStatus(message, isError = false) {
  els.status.hidden = !message;
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function normalizePlace(place) {
  return {
    id: place.id || `${slug(place.name)}-${Number(place.latitude).toFixed(3)}-${Number(place.longitude).toFixed(3)}`,
    name: place.name || "Selected Place",
    admin1: place.admin1 || "",
    country: place.country || "",
    latitude: Number(place.latitude),
    longitude: Number(place.longitude)
  };
}

function placeLabel(place) {
  return [place.name, place.admin1 || place.country].filter(Boolean).join(", ");
}

function degree(unit) {
  return `°${unit}`;
}

function formatClock(hour, minute = 0, compact = false, showMinutes = true) {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  const hr = normalized % 12 || 12;
  const suffix = normalized < 12 ? (compact ? "a" : "AM") : (compact ? "p" : "PM");
  const mins = String(Math.floor(minute)).padStart(2, "0");
  return showMinutes ? `${hr}:${mins}${compact ? "" : " "}${suffix}` : `${hr}${compact ? "" : " "}${suffix}`;
}

function formatTime(value) {
  const parts = localDateTimeParts(value);
  if (parts) return formatClock(parts.hour, parts.minute);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatHour(value) {
  const parts = localDateTimeParts(value);
  if (parts) return formatClock(parts.hour, 0, false, false);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(value));
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

// Full divider label for the hourly list, e.g. "Tomorrow · Tuesday".
function dayDividerLabel(value) {
  const diff = daysFromToday(value);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(value));
  if (diff === 0) return `Today · ${weekday}`;
  if (diff === 1) return `Tomorrow · ${weekday}`;
  return weekday;
}

// Compact label for the graph's midnight line, e.g. "Tomorrow" or "Wed".
function dayShortLabel(value) {
  const diff = daysFromToday(value);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(value));
}

function formatFrameTime(seconds) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
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

// ── Immersive Map ────────────────────────────────────────────
let immersiveDragAbort = null;

function enterImmersiveMap() {
  if (mapState.immersive) return;
  mapState.immersive = true;
  document.body.classList.add("map-immersive-active");

  mapState._normalEls = {
    baseTileLayer: els.baseTileLayer,
    weatherTileLayer: els.weatherTileLayer,
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
  if (mapState.playing) els.playRadar.textContent = "Pause";

  // Wait two frames so the browser has painted the full-screen canvas
  // before we measure its bounding rect for tile placement
  requestAnimationFrame(() => requestAnimationFrame(() => {
    renderTileMap();
    renderMapLegend();
    showFrame(mapState.frameIndex);
  }));

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

  document.getElementById("immersiveMap").hidden = true;
  document.body.style.overflow = "";
  document.body.classList.remove("map-immersive-active");

  if (immersiveDragAbort) { immersiveDragAbort.abort(); immersiveDragAbort = null; }
  document.removeEventListener("keydown", onImmersiveKey);

  setTimeout(() => { renderTileMap(); renderMapLegend(); maybeAutoPlayRadar(); }, 40);
}

function onImmersiveKey(e) {
  if (e.key === "Escape") exitImmersiveMap();
}

function updateImmersiveHUD() {
  if (!state.activePlace) return;
  const loc  = document.getElementById("immLocation");
  const temp = document.getElementById("immTemp");
  const icon = document.getElementById("immIcon");
  const condition = document.getElementById("immCondition");
  const currentCode = state.forecast?.current?.weather_code;
  if (loc)  loc.textContent  = placeLabel(state.activePlace);
  if (temp) temp.textContent = document.getElementById("nowTemp").textContent;
  if (icon) icon.innerHTML   = document.getElementById("heroIcon").innerHTML;
  if (condition) condition.textContent = weatherCodes[currentCode] || document.getElementById("nowSummary").textContent || "Current";
}

function bindImmersiveModeButtons() {
  const immRadar  = document.getElementById("immRadar");
  const immFuture = document.getElementById("immFuture");
  immRadar.classList.toggle("imm-active", mapState.mode === "radar");
  immFuture.classList.toggle("imm-active", mapState.mode === "future");

  document.getElementById("collapseMap").onclick = exitImmersiveMap;
  document.getElementById("immZoomIn").onclick    = () => setMapZoom(mapState.zoom + 1);
  document.getElementById("immZoomOut").onclick   = () => setMapZoom(mapState.zoom - 1);
  document.getElementById("immPlay").onclick      = toggleRadarPlayback;
  document.getElementById("immSlider").oninput    = (e) => scrubToFrame(Number(e.target.value));
  immRadar.onclick  = () => { setMapMode("radar");  immRadar.classList.add("imm-active");  immFuture.classList.remove("imm-active"); };
  immFuture.onclick = () => { setMapMode("future"); immFuture.classList.add("imm-active"); immRadar.classList.remove("imm-active"); };
}

function bindImmersiveDrag() {
  immersiveDragAbort = new AbortController();
  const sig = immersiveDragAbort.signal;
  const canvas = document.getElementById("immersiveMapCanvas");

  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startMapDrag(e.clientX, e.clientY, canvas);
  }, { signal: sig });
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

function skyCondition(code) {
  if (code <= 1) return "clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3 || code === 45 || code === 48) return "overcast";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "overcast";
}

function updateSkyCanvas(weatherCode, isDay) {
  const el = document.getElementById("skyCanvas");
  if (!el) return;

  state.skyCode = weatherCode;
  state.skyIsDay = isDay;

  if (state.theme !== "auto") {
    clearSkyCanvas();
    return;
  }

  const condition = skyCondition(weatherCode);
  document.documentElement.dataset.sky = condition + "-" + (isDay ? "day" : "night");
  renderSkyScene(el, condition, isDay);
}

function clearSkyCanvas() {
  const el = document.getElementById("skyCanvas");
  if (!el) return;
  el.style.background = "";
  el.innerHTML = "";
  document.documentElement.removeAttribute("data-sky");
}

function renderSkyScene(el, condition, isDay) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tod = isDay ? "day" : "night";
  const cfg = SKY_CFG[tod][condition] || SKY_CFG[tod].overcast;

  el.style.background = cfg.bg;

  const parts = [skyFilterDefs()];
  if (cfg.stars)     parts.push(skyStars(vw, vh, cfg.stars));
  if (cfg.moon)      parts.push(skyMoon(vw, vh));
  if (cfg.moonGlow)  parts.push(skyMoonGlow(vw, vh));
  if (cfg.sun)       parts.push(skySun(vw, vh));
  if (cfg.clouds)    parts.push(skyClouds(vw, vh, cfg.clouds, isDay, condition));
  if (cfg.rain)      parts.push(skyRain(vw, vh, cfg.lightning));
  if (cfg.snow)      parts.push(skySnow(vw, vh));
  if (cfg.lightning) parts.push(skyLightning(vw, vh));

  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">${parts.join("")}</svg>`;
}

function skyFilterDefs() {
  return `<defs>
    <filter id="sky-cloud-f" x="-30%" y="-40%" width="160%" height="180%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="13" result="b"/>
      <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/>
    </filter>
    <filter id="sky-glow-f" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="22"/>
    </filter>
  </defs>`;
}

function skyStars(vw, vh, count) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * vw).toFixed(1);
    const y = (Math.random() * vh * 0.82).toFixed(1);
    const r = (Math.random() * 1.2 + 0.4).toFixed(1);
    const op = (Math.random() * 0.5 + 0.25).toFixed(2);
    const dur = (Math.random() * 3 + 2).toFixed(1);
    const delay = (Math.random() * 6).toFixed(1);
    s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#e8f0ff" class="sky-star" style="--op:${op};animation-duration:${dur}s;animation-delay:-${delay}s"/>`;
  }
  return s;
}

function skyMoon(vw, vh) {
  const x = Math.round(vw * (0.58 + Math.random() * 0.26));
  const y = Math.round(vh * (0.06 + Math.random() * 0.13));
  const r = Math.round(36 + Math.random() * 18);
  const cr = Math.round(r * 0.18);
  return `
    <circle cx="${x}" cy="${y}" r="${r * 5}" fill="#5060a8" opacity="0.08" filter="url(#sky-glow-f)" class="sky-moon-glow"/>
    <circle cx="${x}" cy="${y}" r="${r * 2.2}" fill="none" stroke="#a8c0f0" stroke-width="1" opacity="0.13" class="sky-moon-glow"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="#d8e8fa"/>
    <circle cx="${x}" cy="${y}" r="${r - 1}" fill="none" stroke="#b8ccee" stroke-width="0.5" opacity="0.4"/>
    <circle cx="${x + Math.round(r * 0.25)}" cy="${y - Math.round(r * 0.1)}" r="${cr}" fill="#c0d0e8" opacity="0.5"/>
    <circle cx="${x - Math.round(r * 0.32)}" cy="${y + Math.round(r * 0.28)}" r="${Math.round(cr * 0.75)}" fill="#c0d0e8" opacity="0.4"/>
    <circle cx="${x + Math.round(r * 0.05)}" cy="${y + Math.round(r * 0.35)}" r="${Math.round(cr * 0.55)}" fill="#c8d8ec" opacity="0.35"/>
  `;
}

function skyMoonGlow(vw, vh) {
  const x = Math.round(vw * (0.52 + Math.random() * 0.3));
  const y = Math.round(vh * (0.05 + Math.random() * 0.18));
  return `<circle cx="${x}" cy="${y}" r="90" fill="#7080b0" opacity="0.24" filter="url(#sky-glow-f)" class="sky-moon-glow"/>`;
}

function skySun(vw, vh) {
  const x = Math.round(vw * (0.12 + Math.random() * 0.28));
  const y = Math.round(vh * (0.06 + Math.random() * 0.12));
  const r = 46;
  let rays = "";
  for (let i = 0; i < 12; i++) {
    const rad = (i * 30) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const r1 = r + 10, r2 = r + 26;
    rays += `<line x1="${(x + cos * r1).toFixed(1)}" y1="${(y + sin * r1).toFixed(1)}" x2="${(x + cos * r2).toFixed(1)}" y2="${(y + sin * r2).toFixed(1)}" stroke="#ffe060" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  return `
    <circle cx="${x}" cy="${y}" r="${r * 3.2}" fill="#ffcc30" opacity="0.15" filter="url(#sky-glow-f)"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="#ffe060"/>
    <circle cx="${x}" cy="${y}" r="${r - 5}" fill="#fff590" opacity="0.45"/>
    <g class="sky-sun-rays" style="transform-origin:${x}px ${y}px">${rays}</g>
  `;
}

function skyClouds(vw, vh, count, isDay, condition) {
  const isRainy = condition === "rain" || condition === "thunder";
  const isOvercast = condition === "overcast";
  let out = "";
  for (let c = 0; c < count; c++) {
    const bx = Math.random() * vw * 1.3 - vw * 0.15;
    const by = vh * (isRainy ? 0.04 + Math.random() * 0.18 : 0.04 + Math.random() * 0.38);
    const scale = 0.65 + Math.random() * 0.9;
    const dur = (70 + Math.random() * 70).toFixed(0);
    const delay = (Math.random() * 70).toFixed(0);
    const dir = Math.random() > 0.5 ? "normal" : "reverse";

    let fill;
    if (!isDay) fill = isRainy ? "#14182a" : (isOvercast ? "#1c2434" : "#243050");
    else        fill = isRainy ? "#485060" : (isOvercast ? "#788490" : "#dce8f4");
    const op = (isOvercast || isRainy ? 0.9 + Math.random() * 0.09 : 0.7 + Math.random() * 0.24).toFixed(2);

    const puffs = Math.floor(3 + Math.random() * 3);
    let ellipses = "";
    for (let p = 0; p < puffs; p++) {
      const px = bx + (p - puffs / 2) * 70 * scale;
      const py = by + Math.sin(p * 1.2) * 20 * scale + (Math.random() - 0.5) * 12 * scale;
      const rx = (36 + Math.random() * 26) * scale;
      const ry = (22 + Math.random() * 16) * scale;
      ellipses += `<ellipse cx="${px.toFixed(0)}" cy="${py.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${fill}"/>`;
    }
    out += `<g class="sky-cloud" style="animation-duration:${dur}s;animation-delay:-${delay}s;animation-direction:${dir}" filter="url(#sky-cloud-f)" opacity="${op}">${ellipses}</g>`;
  }
  return out;
}

function skyRain(vw, vh, heavy = false) {
  let out = "";
  const count = heavy ? 90 : 60;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * vw * 1.4).toFixed(0);
    const dur = ((heavy ? 0.9 : 1.1) + Math.random() * 0.5).toFixed(2);
    const delay = (Math.random() * 2.5).toFixed(2);
    const op = ((heavy ? 0.45 : 0.35) + Math.random() * 0.3).toFixed(2);
    const len = Math.round((heavy ? 22 : 14) + Math.random() * (heavy ? 20 : 12));
    const dx = heavy ? 22 : 16;
    const w = heavy ? 1.6 : 1.3;
    out += `<line x1="${x}" y1="0" x2="${Number(x) + dx}" y2="${len}" class="sky-rain" style="animation-delay:-${delay}s;animation-duration:${dur}s" stroke="rgba(160,185,215,${op})" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  return out;
}

function skySnow(vw, vh) {
  let out = "";
  for (let i = 0; i < 42; i++) {
    const x = (Math.random() * vw).toFixed(0);
    const r = (1.5 + Math.random() * 2.5).toFixed(1);
    const dur = (4 + Math.random() * 6).toFixed(1);
    const delay = (Math.random() * 8).toFixed(1);
    const drift = ((Math.random() * 50) - 25).toFixed(0);
    out += `<circle cx="${x}" cy="-5" r="${r}" fill="white" opacity="0.8" class="sky-snow" style="--drift:${drift}px;animation-duration:${dur}s;animation-delay:-${delay}s"/>`;
  }
  return out;
}

function skyLightningBolt(vw, vh) {
  let x = vw * (0.2 + Math.random() * 0.6);
  let y = vh * (0.05 + Math.random() * 0.08);
  const segs = 5 + Math.floor(Math.random() * 4);
  let d = `M ${x.toFixed(0)} ${y.toFixed(0)}`;
  for (let i = 0; i < segs; i++) {
    x += (Math.random() - 0.45) * (vw * 0.1);
    y += vh * (0.1 + Math.random() * 0.07);
    if (y > vh * 0.88) break;
    d += ` L ${x.toFixed(0)} ${y.toFixed(0)}`;
  }
  return d;
}

function skyLightning(vw, vh) {
  const d1 = (Math.random() * 5).toFixed(1);
  const d2 = (Number(d1) + 5 + Math.random() * 7).toFixed(1);
  const bolt1 = skyLightningBolt(vw, vh);
  const bolt2 = skyLightningBolt(vw, vh);
  return `
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="#c0d0ff" opacity="0" class="sky-lightning" style="animation-delay:${d1}s"/>
    <path d="${bolt1}" stroke="#ffe080" stroke-width="3" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d1}s;filter:blur(3px)"/>
    <path d="${bolt1}" stroke="white" stroke-width="1.5" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d1}s"/>
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="#c0d0ff" opacity="0" class="sky-lightning" style="animation-delay:${d2}s"/>
    <path d="${bolt2}" stroke="#ffe080" stroke-width="3" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d2}s;filter:blur(3px)"/>
    <path d="${bolt2}" stroke="white" stroke-width="1.5" fill="none" opacity="0" class="sky-lightning" style="animation-delay:${d2}s"/>
  `;
}

window.addEventListener("resize", () => {
  if (state.skyCode !== null && state.theme === "auto") {
    const el = document.getElementById("skyCanvas");
    if (el) renderSkyScene(el, skyCondition(state.skyCode), state.skyIsDay);
  }
});

/* ---------- Day-detail bottom sheet ---------- */

// Collect a single day's hours from the retained forecast and open the sheet.
function openDayFromIndex(i) {
  const data = state.forecast;
  if (!data) return;
  const dayStr = data.daily.time[i];
  const indices = [];
  data.hourly.time.forEach((t, h) => { if (t.startsWith(dayStr)) indices.push(h); });
  openDayDetail({
    indices,
    title: formatDay(data.daily.time[i], i),
    code: data.daily.weather_code[i],
    isDay: true,
    sunriseISO: data.daily.sunrise[i],
    sunsetISO: data.daily.sunset[i],
    initialMode: getDayDetailMode(),
    showNow: i === 0
  });
}

// Rolling next-24-hours window from "now".
function openNext24Detail() {
  const data = state.forecast;
  if (!data) return;
  const now = forecastNowMs(data);
  const indices = [];
  data.hourly.time.forEach((t, h) => {
    const ms = parseForecastTimestamp(t, data);
    if (ms !== null && ms >= now - 3600000 && indices.length < 24) indices.push(h);
  });
  openDayDetail({
    indices,
    title: "Next 24 Hours",
    code: data.current.weather_code,
    isDay: data.current.is_day !== undefined ? Boolean(data.current.is_day) : true,
    sunriseISO: data.daily.sunrise[0],
    sunsetISO: data.daily.sunset[0],
    initialMode: "hourly",
    persistInitialMode: false,
    showNow: true
  });
}

function getDayDetailMode() {
  return localStorage.getItem(DAY_DETAIL_MODE_KEY) === "hourly" ? "hourly" : "graph";
}

function setDayDetailMode(mode, persist = true) {
  const normalized = mode === "hourly" ? "hourly" : "graph";
  const graphBtn = document.getElementById("sheetGraphMode");
  const hourlyBtn = document.getElementById("sheetHourlyMode");
  const graphWrap = document.getElementById("sheetGraphWrap");
  const hourlyList = document.getElementById("sheetHourlyList");
  const isHourly = normalized === "hourly";

  graphBtn.classList.toggle("active", !isHourly);
  hourlyBtn.classList.toggle("active", isHourly);
  graphBtn.setAttribute("aria-pressed", String(!isHourly));
  hourlyBtn.setAttribute("aria-pressed", String(isHourly));
  graphWrap.hidden = isHourly;
  hourlyList.hidden = !isHourly;
  const metricToggle = document.getElementById("graphMetricToggle");
  if (metricToggle) metricToggle.hidden = isHourly; // Temp/Wind only applies to the graph

  if (!isHourly) scheduleGraphCalloutReflow();
  if (persist) localStorage.setItem(DAY_DETAIL_MODE_KEY, normalized);
}

function openDayDetail({ indices, title, code, isDay, sunriseISO, sunsetISO, initialMode = getDayDetailMode(), persistInitialMode = false, showNow = false }) {
  const data = state.forecast;
  if (!data || !indices.length) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";

  const hrs = indices.map((h) => ({
    time: data.hourly.time[h],
    temp: data.hourly.temperature_2m[h],
    feels: data.hourly.apparent_temperature[h],
    pop: data.hourly.precipitation_probability[h] || 0,
    precip: data.hourly.precipitation[h] || 0,
    wind: data.hourly.wind_speed_10m[h],
    gust: data.hourly.wind_gusts_10m[h],
    uv: data.hourly.uv_index[h] || 0,
    code: data.hourly.weather_code[h],
    isDay: data.hourly.is_day ? Boolean(data.hourly.is_day[h]) : true
  }));

  const temps = hrs.map((h) => h.temp);
  const high = Math.round(Math.max(...temps));
  const low = Math.round(Math.min(...temps));

  document.getElementById("sheetTitle").textContent = title;
  document.getElementById("sheetIcon").innerHTML = weatherIcon(code, isDay);
  document.getElementById("sheetHigh").textContent = `${high}${degree(tempUnit)}`;
  document.getElementById("sheetLow").textContent = `${low}${degree(tempUnit)}`;
  document.getElementById("sheetSummary").textContent = buildDaySummary(hrs, windUnit);

  graphMetric = "temp"; // each open defaults to Temp (with the Feels-like overlay)
  buildHourlyGraph(hrs, tempUnit, windUnit, showNow);
  renderHourlyList(hrs, tempUnit, windUnit, precipUnit, showNow);
  renderSheetStats(hrs, { sunriseISO, sunsetISO, windUnit, precipUnit });
  setDayDetailMode(initialMode, persistInitialMode);

  const backdrop = document.getElementById("dayDetailBackdrop");
  const sheet = document.getElementById("dayDetail");
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add("show");
    sheet.classList.add("show");
  });
  document.body.style.overflow = "hidden";
}

function closeDayDetail() {
  const backdrop = document.getElementById("dayDetailBackdrop");
  const sheet = document.getElementById("dayDetail");
  backdrop.classList.remove("show");
  sheet.classList.remove("show");
  document.body.style.overflow = "";
  setTimeout(() => {
    backdrop.hidden = true;
    sheet.hidden = true;
  }, 260);
}

function buildDaySummary(hrs, windUnit) {
  const maxPop = Math.max(...hrs.map((h) => h.pop));
  const totalPrecip = hrs.reduce((sum, h) => sum + h.precip, 0);
  const maxGust = Math.round(Math.max(...hrs.map((h) => h.gust)));
  const parts = [];
  if (maxPop >= 50) parts.push(`Rain likely, up to ${maxPop}% chance`);
  else if (maxPop >= 20) parts.push(`Slight chance of rain (${maxPop}%)`);
  else parts.push("Mostly dry");
  if (maxGust >= 25) parts.push(`gusts to ${maxGust} ${windUnit}`);
  return parts.join(", ") + ".";
}

function hourlyRowNote(hour, windUnit, precipUnit) {
  const notes = [];
  if (hour.pop >= 50) notes.push(`${hour.pop}% rain`);
  else if (hour.pop >= 25) notes.push(`${hour.pop}% chance`);
  if (hour.gust >= 25) notes.push(`gusts ${Math.round(hour.gust)} ${windUnit}`);
  if (hour.uv >= 6) notes.push(`UV ${Math.round(hour.uv)}`);
  if (hour.precip > 0.02) notes.push(`${formatAmount(hour.precip)} ${precipUnit}`);
  return notes.join(" · ");
}

function isCurrentHour(time) {
  const target = localDateTimeParts(time);
  const current = localDateTimeParts(state.forecast?.current?.time);
  if (target && current) {
    return target.year === current.year &&
      target.month === current.month &&
      target.day === current.day &&
      target.hour === current.hour;
  }
  const targetMs = parseForecastTimestamp(time, state.forecast);
  const now = forecastNowMs(state.forecast);
  return targetMs !== null && Math.abs(targetMs - now) < 1800000;
}

function renderHourlyList(hrs, tempUnit, windUnit, precipUnit, showNow = false) {
  const deg = degree(tempUnit);
  const list = document.getElementById("sheetHourlyList");
  let prevDay = null;
  list.innerHTML = hrs.map((hour) => {
    // Mark where the day rolls over (the list runs from "now" into tomorrow).
    const dayKey = hour.time.slice(0, 10);
    const divider = prevDay && dayKey !== prevDay
      ? `<div class="sheet-day-divider"><span>${escapeHtml(dayDividerLabel(hour.time))}</span></div>`
      : "";
    prevDay = dayKey;
    const condition = weatherCodes[hour.code] || "Weather";
    const note = hourlyRowNote(hour, windUnit, precipUnit);
    const windy = hour.gust >= 20 && hour.gust >= hour.wind + 5;
    const now = showNow && isCurrentHour(hour.time);
    const rainClass = hour.pop >= 40 ? " is-rainy" : "";
    const uvClass = hour.uv >= 6 ? " is-sunny" : "";
    const windClass = hour.gust >= 25 ? " is-windy" : "";
    const nowClass = now ? " is-now" : "";
    const noteLine = note ? `<span>${escapeHtml(note)}</span>` : "";
    return `${divider}
      <article class="sheet-hour-row${rainClass}${uvClass}${windClass}${nowClass}">
        <div class="sheet-hour-time">${formatHour(hour.time)}${now ? `<span class="sheet-now-badge">Now</span>` : ""}</div>
        <div class="sheet-hour-icon" aria-hidden="true">${weatherIcon(hour.code, hour.isDay)}</div>
        <div class="sheet-hour-main">
          <strong>${escapeHtml(condition)}</strong>
          ${noteLine}
        </div>
        <div class="sheet-hour-metrics">
          <strong>${Math.round(hour.temp)}${deg}</strong>
          <span>Feels ${Math.round(hour.feels)}${deg}</span>
          <span>${hour.pop}% rain</span>
          <span>${Math.round(hour.wind)} ${windUnit}${windy ? `, gust ${Math.round(hour.gust)}` : ""}</span>
        </div>
      </article>
    `;
  }).join("");
}

// Build a smooth cardinal-spline path through the points.
function smoothPath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function shortHour(t) {
  const parts = localDateTimeParts(t);
  if (parts) return formatClock(parts.hour, 0, true, false);
  const h = new Date(t).getHours();
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${h < 12 ? "a" : "p"}`;
}

let graphPts = [];
let graphActiveIndex = 0;
let graphUpdateActive = null;

function scheduleGraphCalloutReflow() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (typeof graphUpdateActive === "function") {
        graphUpdateActive(graphActiveIndex);
      }
    });
  });
}

// The graph can plot two metrics, each as a primary curve + a dashed secondary
// curve: Temp (with Feels-like) by default, or Wind (with Gusts). The current
// metric + last-rendered context are kept so the toggle can redraw in place.
let graphMetric = "temp";
let graphCtx = null;
const GRAPH_WIND_COLOR = "#8479ff";

function setGraphMetric(metric) {
  graphMetric = metric === "wind" ? "wind" : "temp";
  if (graphCtx) drawHourlyGraph();
}

function buildHourlyGraph(hrs, tempUnit, windUnit, showNow = false) {
  graphCtx = { hrs, tempUnit, windUnit, showNow };
  drawHourlyGraph();
}

function drawHourlyGraph() {
  if (!graphCtx) return;
  const { hrs, tempUnit, windUnit, showNow } = graphCtx;
  const isWind = graphMetric === "wind";

  // Reflect the active metric in the toggle + hint.
  const tempBtn = document.getElementById("graphTempBtn");
  const windBtn = document.getElementById("graphWindBtn");
  const hint = document.getElementById("graphMetricHint");
  if (tempBtn && windBtn) {
    tempBtn.classList.toggle("active", !isWind);
    windBtn.classList.toggle("active", isWind);
    tempBtn.setAttribute("aria-pressed", String(!isWind));
    windBtn.setAttribute("aria-pressed", String(isWind));
  }
  if (hint) hint.textContent = isWind ? "dashed = gusts" : "dashed = feels like";

  const VW = 340;
  const padL = 18, padR = 18;
  const plotW = VW - padL - padR;
  const tempTop = 18, tempBottom = 104;
  const precipTop = 116, precipBottom = 136;
  const precipH = precipBottom - precipTop;
  const labelY = 152;
  const n = hrs.length;

  const primaryKey = isWind ? "wind" : "temp";
  const secondaryKey = isWind ? "gust" : "feels";
  const unitSuffix = isWind ? ` ${windUnit}` : degree(tempUnit);
  const fmt = (v) => `${Math.round(v)}${unitSuffix}`;

  const primaryVals = hrs.map((h) => h[primaryKey]);
  const secondaryVals = hrs.map((h) => h[secondaryKey]);
  const all = primaryVals.concat(secondaryVals);
  let vMin = Math.min(...all), vMax = Math.max(...all);
  if (isWind) vMin = Math.min(vMin, 0); // wind reads naturally from a 0 baseline
  const range = Math.max(vMax - vMin, 1);
  const dMin = vMin - range * 0.18, dMax = vMax + range * 0.18;
  const dRange = dMax - dMin;

  const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yv = (v) => tempBottom - ((v - dMin) / dRange) * (tempBottom - tempTop);

  const pPts = hrs.map((h, i) => ({ ...h, x: x(i), y: yv(h[primaryKey]) }));
  const sPts = hrs.map((h, i) => ({ x: x(i), y: yv(h[secondaryKey]) }));
  graphPts = pPts; // scrubbing tracks the primary curve
  graphActiveIndex = 0;
  graphUpdateActive = null;

  // Primary stroke: temp is colored by value (gradient); wind is a solid hue.
  let defs = "";
  let primaryStroke, areaFill, areaOpacity, secondaryStroke;
  if (isWind) {
    primaryStroke = areaFill = secondaryStroke = GRAPH_WIND_COLOR;
    areaOpacity = 0.10;
  } else {
    const gradStops = pPts.map((p, i) =>
      `<stop offset="${((i / Math.max(n - 1, 1)) * 100).toFixed(1)}%" stop-color="${tempColor(p.temp)}"/>`
    ).join("");
    defs = `<linearGradient id="tempGrad" x1="0" y1="0" x2="1" y2="0">${gradStops}</linearGradient>`;
    primaryStroke = areaFill = "url(#tempGrad)";
    secondaryStroke = "var(--ink)";
    areaOpacity = 0.13;
  }

  const primaryPath = smoothPath(pPts);
  const secondaryPath = smoothPath(sPts);
  const areaPath = `${primaryPath} L ${pPts[n - 1].x.toFixed(1)} ${tempBottom} L ${pPts[0].x.toFixed(1)} ${tempBottom} Z`;

  // Precip bars — useful context in either metric.
  const barW = Math.max((plotW / n) * 0.5, 2);
  const precipBars = pPts.map((p) => {
    if (p.pop <= 0) return "";
    const h = (p.pop / 100) * precipH;
    return `<rect x="${(p.x - barW / 2).toFixed(1)}" y="${(precipBottom - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="#4a90d9" opacity="0.5"/>`;
  }).join("");

  // Keep marker labels inside the chart even when a peak lands at an edge.
  const peakText = (px, py, text, cls) => {
    const edge = px < 26 ? { x: 2, anchor: "start" } : px > VW - 26 ? { x: VW - 2, anchor: "end" } : { x: px, anchor: "middle" };
    return `<text x="${edge.x.toFixed(1)}" y="${py.toFixed(1)}" text-anchor="${edge.anchor}" class="${cls}">${text}</text>`;
  };

  // Markers: temp shows hi/lo; wind shows peak wind + peak gust.
  let markers;
  if (isWind) {
    const wIdx = primaryVals.indexOf(Math.max(...primaryVals));
    const gIdx = secondaryVals.indexOf(Math.max(...secondaryVals));
    markers =
      `<circle cx="${pPts[wIdx].x.toFixed(1)}" cy="${pPts[wIdx].y.toFixed(1)}" r="2.6" fill="${GRAPH_WIND_COLOR}"/>` +
      peakText(pPts[wIdx].x, pPts[wIdx].y - 7, fmt(primaryVals[wIdx]), "graph-peak") +
      peakText(sPts[gIdx].x, sPts[gIdx].y - 6, `gust ${fmt(secondaryVals[gIdx])}`, "graph-peak-sub");
  } else {
    const tMax = Math.max(...primaryVals), tMin = Math.min(...primaryVals);
    const hiIdx = primaryVals.indexOf(tMax), loIdx = primaryVals.indexOf(tMin);
    markers =
      `<circle cx="${pPts[hiIdx].x.toFixed(1)}" cy="${pPts[hiIdx].y.toFixed(1)}" r="2.6" fill="${tempColor(tMax)}"/>` +
      peakText(pPts[hiIdx].x, pPts[hiIdx].y - 7, fmt(tMax), "graph-peak") +
      `<circle cx="${pPts[loIdx].x.toFixed(1)}" cy="${pPts[loIdx].y.toFixed(1)}" r="2.6" fill="${tempColor(tMin)}"/>` +
      peakText(pPts[loIdx].x, pPts[loIdx].y + 13, fmt(tMin), "graph-peak");
  }

  // X-axis time labels
  const steps = 4;
  const labelIdx = [...new Set(Array.from({ length: steps + 1 }, (_, s) => Math.round((s * (n - 1)) / steps)))];
  const axisLabels = labelIdx.map((i) =>
    `<text x="${x(i).toFixed(1)}" y="${labelY}" text-anchor="middle" class="graph-axis">${shortHour(hrs[i].time)}</text>`
  ).join("");

  // Vertical line at each midnight so the day rollover is visible on the curve.
  const dayLines = hrs.map((h, i) => {
    if (i === 0 || Math.floor(forecastLocalHour(h.time)) !== 0) return "";
    const lx = x(i);
    const nearRight = lx > VW - 46;
    const tx = nearRight ? lx - 4 : lx + 4;
    const anchor = nearRight ? "end" : "start";
    return `<line x1="${lx.toFixed(1)}" y1="${tempTop}" x2="${lx.toFixed(1)}" y2="${precipBottom}" class="graph-day-line"/>` +
      `<text x="${tx.toFixed(1)}" y="${(tempTop + 9).toFixed(1)}" text-anchor="${anchor}" class="graph-day-label">${escapeHtml(dayShortLabel(h.time))}</text>`;
  }).join("");

  const firstMs = parseForecastTimestamp(hrs[0].time, state.forecast);
  const lastMs = parseForecastTimestamp(hrs[n - 1].time, state.forecast);
  const nowMs = forecastNowMs(state.forecast);
  const nowX = firstMs !== null && lastMs !== null && firstMs < lastMs
    ? padL + ((nowMs - firstMs) / (lastMs - firstMs)) * plotW
    : null;
  const nowMarker = showNow && nowX != null && nowX >= padL && nowX <= padL + plotW ? `
    <line x1="${nowX.toFixed(1)}" y1="${tempTop}" x2="${nowX.toFixed(1)}" y2="${precipBottom}" class="graph-now-line"/>
    <rect x="${(nowX - 13).toFixed(1)}" y="2" width="26" height="14" rx="7" class="graph-now-pill"/>
    <text x="${nowX.toFixed(1)}" y="12" text-anchor="middle" class="graph-now-label">Now</text>
  ` : "";

  document.getElementById("sheetGraph").innerHTML = `
    <svg viewBox="0 0 ${VW} 162" class="hourly-graph">
      <defs>${defs}</defs>
      <path d="${areaPath}" fill="${areaFill}" fill-opacity="${areaOpacity}"/>
      <path d="${secondaryPath}" fill="none" stroke="${secondaryStroke}" stroke-width="1.6" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
      <path d="${primaryPath}" fill="none" stroke="${primaryStroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${precipBars}
      ${dayLines}
      ${markers}
      ${nowMarker}
      ${axisLabels}
      <line id="graphGuide" x1="0" y1="${tempTop}" x2="0" y2="${precipBottom}" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity="0.4" style="display:none"/>
      <circle id="graphDot" r="4" fill="var(--ink)" style="display:none"/>
      <rect id="graphHit" x="0" y="0" width="${VW}" height="${precipBottom}" fill="transparent" style="cursor:crosshair"/>
    </svg>
  `;

  const svg = document.querySelector("#sheetGraph svg");
  const guide = svg.querySelector("#graphGuide");
  const dot = svg.querySelector("#graphDot");
  const callout = document.getElementById("sheetReadout");
  const wrap = document.getElementById("sheetGraphWrap");

  function update(i) {
    const p = graphPts[i];
    if (!p) return;
    graphActiveIndex = i;
    guide.setAttribute("x1", p.x);
    guide.setAttribute("x2", p.x);
    guide.style.display = "";
    dot.setAttribute("cx", p.x);
    dot.setAttribute("cy", p.y);
    dot.style.display = "";

    const long = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(p.time));
    const main = isWind
      ? `${long} · ${Math.round(p.wind)} ${windUnit}`
      : `${long} · ${Math.round(p.temp)}${degree(tempUnit)}`;
    const sub = isWind
      ? `gust ${Math.round(p.gust)} ${windUnit} · ${p.pop}% rain`
      : `feels ${Math.round(p.feels)}${degree(tempUnit)} · ${p.pop}% · ${Math.round(p.wind)} ${windUnit}`;
    callout.innerHTML =
      `<span class="callout-main">${main}</span><span class="callout-sub">${sub}</span>`;

    // Slide the callout to ride above the active point, clamped to the chart edges.
    // The vertical guide line marks the exact column; the callout pointer tracks it too.
    const wrapWidth = wrap.clientWidth;
    const cw = callout.offsetWidth;
    if (!wrapWidth || !cw) return;

    const px = (p.x / VW) * wrapWidth;
    const minLeft = cw / 2 + 2;
    const maxLeft = Math.max(minLeft, wrapWidth - cw / 2 - 2);
    const left = Math.max(minLeft, Math.min(px, maxLeft));
    const pointerX = Math.max(8, Math.min(cw - 8, px - (left - cw / 2)));
    callout.style.left = `${left}px`;
    callout.style.setProperty("--pointer-x", `${pointerX}px`);
  }
  graphUpdateActive = update;

  function nearest(clientX) {
    const rect = svg.getBoundingClientRect();
    const vbX = ((clientX - rect.left) / rect.width) * VW;
    let best = 0, bd = Infinity;
    graphPts.forEach((p, idx) => {
      const d = Math.abs(p.x - vbX);
      if (d < bd) { bd = d; best = idx; }
    });
    return best;
  }

  svg.addEventListener("pointermove", (e) => update(nearest(e.clientX)));
  svg.addEventListener("pointerdown", (e) => update(nearest(e.clientX)));

  // Default readout: the hour nearest "now" if present, else the first point.
  const now = forecastNowMs(state.forecast);
  let def = hrs.findIndex((h) => {
    const ms = parseForecastTimestamp(h.time, state.forecast);
    return ms !== null && Math.abs(ms - now) < 1800000;
  });
  if (def < 0) def = 0;
  // Defer to next frame so the sheet has laid out and the callout can be
  // measured/positioned correctly (it's still hidden when this runs).
  graphActiveIndex = def;
  scheduleGraphCalloutReflow();
}

function renderSheetStats(hrs, { sunriseISO, sunsetISO, windUnit, precipUnit }) {
  const maxWind = Math.round(Math.max(...hrs.map((h) => h.wind)));
  const maxGust = Math.round(Math.max(...hrs.map((h) => h.gust)));
  const maxUv = Math.round(Math.max(...hrs.map((h) => h.uv)));
  const totalPrecip = hrs.reduce((sum, h) => sum + h.precip, 0);

  const tiles = [
    { label: "Sunrise", value: sunriseISO ? formatTime(sunriseISO) : "--" },
    { label: "Sunset", value: sunsetISO ? formatTime(sunsetISO) : "--" },
    { label: "UV Peak", value: maxUv },
    { label: "Wind", value: `${maxWind} ${windUnit}` },
    { label: "Gusts", value: `${maxGust} ${windUnit}` },
    { label: "Precip", value: `${formatAmount(totalPrecip)} ${precipUnit}` }
  ];

  document.getElementById("sheetStats").innerHTML = tiles.map((t) => `
    <div class="sheet-stat">
      <span>${t.label}</span>
      <strong>${t.value}</strong>
    </div>
  `).join("");
}

/* ---------- Severe weather alerts (NWS, US-only) ---------- */

const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
let activeAlerts = [];

async function fetchAlerts(place) {
  const cacheKey = `alerts:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
  if (cached && Date.now() - cached.savedAt < 5 * 60 * 1000) return cached.data;

  const url = `https://api.weather.gov/alerts/active?point=${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
  const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!res.ok) return [];
  const json = await res.json();
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

function alertCountLabel(count) {
  return count === 1 ? "1 active alert" : `${count} active alerts`;
}

function renderAlerts(alerts) {
  activeAlerts = alerts || [];
  const bar = document.getElementById("alertBar");
  if (!activeAlerts.length) {
    bar.hidden = true;
    return;
  }
  const top = activeAlerts[0];
  bar.className = `alert-bar ${alertSeverityClass(top.severity)}`;
  document.getElementById("alertBarSeverity").textContent = alertSeverityLabel(top.severity);
  document.getElementById("alertBarEvent").textContent = top.event;
  document.getElementById("alertBarTiming").textContent = top.ends || top.expires
    ? `Until ${formatAlertTime(top.ends || top.expires)}` : "";
  document.getElementById("alertBarMore").textContent =
    activeAlerts.length > 1 ? `+${activeAlerts.length - 1} more` : "";
  bar.setAttribute("aria-label", `${top.event}${top.ends || top.expires ? ` until ${formatAlertTime(top.ends || top.expires)}` : ""}. ${alertCountLabel(activeAlerts.length)}. Open alert details.`);
  bar.hidden = false;
}

function formatAlertTime(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
}

function alertWindow(a) {
  const start = a.onset || a.effective;
  const end = a.ends || a.expires;
  const parts = [];
  if (start) parts.push(`From ${formatAlertTime(start)}`);
  if (end) parts.push(`until ${formatAlertTime(end)}`);
  return parts.join(" ");
}

function openAlertSheet() {
  if (!activeAlerts.length) return;
  const top = activeAlerts[0];
  document.getElementById("alertSheetKicker").textContent = alertSeverityLabel(top.severity);
  document.getElementById("alertSheetTitle").textContent = alertCountLabel(activeAlerts.length);
  document.getElementById("alertSheetSummary").textContent = `${top.event}${alertWindow(top) ? ` · ${alertWindow(top)}` : ""}`;
  document.getElementById("alertList").innerHTML = activeAlerts.map((a) => `
    <article class="alert-item ${alertSeverityClass(a.severity)}">
      <div class="alert-item-head">
        <div>
          <span class="alert-item-event">${escapeHtml(a.event)}</span>
          <p class="alert-item-when">${escapeHtml(alertWindow(a))}</p>
        </div>
        <span class="alert-item-sev">${escapeHtml(alertSeverityLabel(a.severity))}</span>
      </div>
      ${a.areaDesc ? `<p class="alert-item-area">${escapeHtml(a.areaDesc)}</p>` : ""}
      ${a.instruction ? `<div class="alert-item-instruction"><strong>What to do</strong><p>${escapeHtml(a.instruction)}</p></div>` : ""}
      ${a.description ? `<details class="alert-item-details"><summary>Full details</summary><p>${escapeHtml(a.description)}</p></details>` : ""}
      ${a.senderName ? `<p class="alert-item-sender">${escapeHtml(a.senderName)}</p>` : ""}
    </article>
  `).join("");

  const backdrop = document.getElementById("alertBackdrop");
  const sheet = document.getElementById("alertSheet");
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add("show");
    sheet.classList.add("show");
  });
  document.body.style.overflow = "hidden";
}

function closeAlertSheet() {
  const backdrop = document.getElementById("alertBackdrop");
  const sheet = document.getElementById("alertSheet");
  backdrop.classList.remove("show");
  sheet.classList.remove("show");
  document.body.style.overflow = "";
  setTimeout(() => {
    backdrop.hidden = true;
    sheet.hidden = true;
  }, 260);
}

// Register service worker for PWA / offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL("sw.js", window.location.href).pathname).catch(() => {});
  });
}

// Start the app last, after every module-level declaration is initialized,
// so the synchronous startup path can't hit a temporal-dead-zone reference.
init();
