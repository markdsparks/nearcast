const VERSION = "2.6.12";
const DAY_DETAIL_MODE_KEY = "nearcast-day-detail-mode";
const PLAN_MEMORY_KEY = "nearcast-plan-memory-v1";
const WELCOME_AMBIENCE_CACHE_KEY = "nearcast-welcome-ambience-v1";
const WELCOME_AMBIENCE_TIMEOUT_MS = 1800;
const PERF_STORAGE_KEY = "nearcast-perf";
const PERF_RENDER_WARN_MS = 50;
const PERF_INPUT_WARN_MS = 80;
const PERF_LONG_TASK_WARN_MS = 120;
const PERF_MAX_ENTRIES = 80;

const perfQueryFlag = (() => {
  try {
    return new URLSearchParams(window.location.search).get("perf");
  } catch {
    return null;
  }
})();
if (perfQueryFlag === "1") localStorage.setItem(PERF_STORAGE_KEY, "1");
else if (perfQueryFlag === "0") localStorage.removeItem(PERF_STORAGE_KEY);

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
  skyState: null,
  weatherTruth: null,
  locationIsDay: null,
  forecastUnit: null,
  planMemories: loadPlanMemories()
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
  playAccum: 0,
  playClock: 0,
  frameWaitIndex: null,
  frameWaitStart: 0,
  xfadeFrames: [null, null],
  _normalEls: null,
  timelineKind: "radar",
  nowIndex: 0,
  forecastUnavailable: false
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

const MAP_MIN_ZOOM = 4;
const MAP_MAX_ZOOM = 10;
const RADAR_TILE_MAX_ZOOM = 8; // cap radar source tiles so they upscale smoothly past z8
const MAP_TAP_MOVE_PX = 8;
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
  startPanY: 0
};

const pinchState = {
  active: false,
  startDistance: 0,
  startZoom: 0,
  anchorX: 0,
  anchorY: 0
};

const mapTapState = {
  active: false,
  valid: false,
  moved: false,
  startX: 0,
  startY: 0,
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

const els = {
  themeColorMeta: document.querySelector("meta[name='theme-color']"),
  statusBarMeta: document.querySelector("meta[name='apple-mobile-web-app-status-bar-style']"),
  shell: document.querySelector(".shell"),
  appMenuToggle: document.querySelector("#appMenuToggle"),
  appMenu: document.querySelector("#appMenu"),
  searchToggle: document.querySelector("#searchToggle"),
  welcome: document.querySelector("#welcome"),
  welcomeAmbientLabel: document.querySelector("#welcomeAmbientLabel"),
  welcomeLocate: document.querySelector("#welcomeLocate"),
  themeToggle: document.querySelector("#themeToggle"),
  unitToggle: document.querySelector("#unitToggle"),
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
  nowSummary: document.querySelector("#nowSummary"),
  glanceTitle: document.querySelector("#glanceTitle"),
  glanceSignals: document.querySelector(".glance-signals"),
  feelsLike: document.querySelector("#feelsLike"),
  feelsContext: document.querySelector("#feelsContext"),
  rainSignal: document.querySelector("#rainSignal"),
  rainChance: document.querySelector("#rainChance"),
  rainContext: document.querySelector("#rainContext"),
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
  briefing: document.querySelector("#briefing"),
  aiAsk: document.querySelector("#aiAsk"),
  aiLauncher: document.querySelector("#aiLauncher"),
  aiLauncherSub: document.querySelector("#aiLauncherSub"),
  aiSheet: document.querySelector("#aiSheet"),
  aiBackdrop: document.querySelector("#aiBackdrop"),
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
  savePlace: document.querySelector("#savePlace"),
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
  frameLabel: document.querySelector("#frameLabel")
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
function effectiveCurrentCode(current) {
  const code = current.weather_code;
  if (code == null || code < 51) return code;
  if ((current.precipitation || 0) > 0) return code;
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
  if (currentIndex >= 0) {
    consider(
      hourly.precipitation?.[currentIndex],
      3600,
      hourly.weather_code?.[currentIndex],
      hourlyPop
    );
  }

  const nowcast = analyzeNowcast(data);
  if (nowcast) {
    signal.nowcast = nowcast;
    if (nowcast.wet?.[0]) {
      const slot = nowcast.slots?.[0];
      consider(slot?.precip, 15 * 60, nowcast.isSnow ? 71 : signal.code, slot?.prob, nowcast.isSnow);
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
  const probableWithoutNowcast = !hasMinuteData && (rawPrecipLikely || hourlyPrecipLikely || (currentPop || 0) >= RAIN_LIKELY_POP);
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
      source: nowPrecip.nowcast?.wet?.[0] ? "minutely-current" : "current",
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
  if (state.weatherTruth?.data === data) return state.weatherTruth;
  return buildWeatherTruth(data);
}

function weatherTruthReceipt(display, nowPrecip, data = state.forecast, precipTruth = display?.precipTruth) {
  const label = weatherCodes[display.code] || "Weather";
  const hourlyPop = display.hourlyIndex >= 0
    ? data?.hourly?.precipitation_probability?.[display.hourlyIndex]
    : null;
  if (precipTruth?.phase === "active" || nowPrecip?.isWetNow) {
    const activeLabel = weatherCodes[precipTruth?.visualCode] || precipTruth?.label || label;
    const source = precipTruth?.source === "minutely-current" ? "current + 15-min precip" : "current precip";
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

  if (precipTruth?.phase === "imminent") {
    const soonLabel = precipTruth.label || "Rain";
    return {
      short: `${soonLabel} soon · ${precipTruth.context || "near-term nowcast"}`,
      detail: `Showing a wet scene because ${soonLabel.toLowerCase()} starts soon. Text stays future-tense until precipitation is active.`,
      source: precipTruth.source,
      confidence: precipTruth.confidence
    };
  }

  if (precipTruth?.phase === "likely-this-hour") {
    const chance = precipTruth.chance || display.pop || 0;
    const scene = precipTruth.visualWet
      ? "the scene leans wet because no 15-minute nowcast is available to narrow the start time"
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
  icon.innerHTML = weatherIcon(truth.code, truth.isDay, { density: "dense" }) +
    (stormPotential ? thunderBadgeHtml() : "");
}

function buildWeatherTruth(data = state.forecast) {
  const current = data?.current || {};
  const fallbackIsDay = current.is_day !== undefined ? Boolean(current.is_day) : true;
  const currentIndex = currentHourlyIndex(data);
  const hourly = data?.hourly || {};
  const nowPrecip = nowPrecipSignal(data);
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
    const currentRate = precipRateFromAmount(current.precipitation, current.interval || 3600);
    const currentCode = effectiveWeatherCode(current.weather_code, null, current.cloud_cover, current.precipitation, {
      data,
      precipRate: currentRate
    });
    const measuredCode = nowPrecip.isWetNow ? strongerPrecipCode(currentCode, nowPrecip.code) : null;
    const visualCode = precipTruth.visualWet ? strongerPrecipCode(baseCode, precipTruth.visualCode) : baseCode;
    const code = measuredCode ? strongerPrecipCode(visualCode, measuredCode) : visualCode;
    display = {
      code,
      rawCode,
      pop: Math.max(pop || 0, precipTruth.chance || 0),
      cloud,
      isDay: hourly.is_day ? Boolean(hourly.is_day[currentIndex]) : fallbackIsDay,
      hourlyIndex: currentIndex,
      precip: Math.max(precip, nowPrecip.amount || 0, current.precipitation || 0),
      nowPrecip,
      precipTruth,
      stormPotential: hasThunderPotential(rawCode, pop, code, precip, data)
    };
  } else {
    const fallbackCode = effectiveCurrentCode(current);
    const precipTruth = buildPrecipTruth(data, nowPrecip, {
      rawCode: current.weather_code,
      pop: null,
      cloud: current.cloud_cover,
      precip: current.precipitation,
      intervalSeconds: current.interval || 3600,
      baseCode: fallbackCode,
      hourlyIndex: -1
    });
    const visualCode = precipTruth.visualWet ? strongerPrecipCode(fallbackCode, precipTruth.visualCode) : fallbackCode;
    const code = nowPrecip.isWetNow ? strongerPrecipCode(visualCode, nowPrecip.code) : visualCode;
    display = {
      code,
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
    code: display.code,
    label: weatherCodes[display.code] || "Weather",
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
  if (!h || !h.time) return data.daily.weather_code[dayIndex];
  let precipCode = null, precipScore = -1;
  const skyCounts = {};
  let cloudSum = 0, cloudN = 0;
  for (let i = 0; i < h.time.length; i++) {
    if (!h.time[i].startsWith(dayStr)) continue;
    const pop = h.precipitation_probability ? (h.precipitation_probability[i] || 0) : 0;
    const cloud = h.cloud_cover ? h.cloud_cover[i] : null;
    const precip = h.precipitation ? (h.precipitation[i] || 0) : 0;
    const eff = effectiveWeatherCode(h.weather_code[i], pop, cloud, precip, { data });
    if (eff >= 51) {
      const score = precipRank(eff) * 1000 + pop; // severity first, likelihood breaks ties
      if (score > precipScore) { precipScore = score; precipCode = eff; }
    } else {
      skyCounts[eff] = (skyCounts[eff] || 0) + 1;
    }
    if (Number.isFinite(cloud)) { cloudSum += cloud; cloudN++; }
  }
  if (precipCode != null) return precipCode;
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
    const pop = h.precipitation_probability ? (h.precipitation_probability[i] || 0) : 0;
    const cloud = h.cloud_cover ? h.cloud_cover[i] : null;
    const precip = h.precipitation ? (h.precipitation[i] || 0) : 0;
    const eff = effectiveWeatherCode(h.weather_code[i], pop, cloud, precip, { data });
    return hasThunderPotential(h.weather_code[i], pop, eff, precip, data);
  });
}

function hasThunderPotentialForIndices(data, indices, shownCode) {
  if (isThunderCode(shownCode)) return false;
  const h = data.hourly;
  if (!h || !h.time) return false;
  return indices.some((i) => {
    const pop = h.precipitation_probability ? (h.precipitation_probability[i] || 0) : 0;
    const cloud = h.cloud_cover ? h.cloud_cover[i] : null;
    const precip = h.precipitation ? (h.precipitation[i] || 0) : 0;
    const eff = effectiveWeatherCode(h.weather_code[i], pop, cloud, precip, { data });
    return hasThunderPotential(h.weather_code[i], pop, eff, precip, data);
  });
}

function representativeHourlyCodeForIndices(data, indices) {
  const h = data?.hourly;
  if (!h || !indices?.length) return data?.current?.weather_code ?? 0;
  let precipCode = null, precipScore = -1;
  const skyCounts = {};
  let cloudSum = 0, cloudN = 0;
  indices.forEach((i) => {
    const pop = h.precipitation_probability ? (h.precipitation_probability[i] || 0) : 0;
    const cloud = h.cloud_cover ? h.cloud_cover[i] : null;
    const precip = h.precipitation ? (h.precipitation[i] || 0) : 0;
    const eff = effectiveWeatherCode(h.weather_code[i], pop, cloud, precip, { data });
    if (eff >= 51) {
      const score = precipRank(eff) * 1000 + pop;
      if (score > precipScore) {
        precipScore = score;
        precipCode = eff;
      }
    } else {
      skyCounts[eff] = (skyCounts[eff] || 0) + 1;
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

function init() {
  initPerfDiagnostics();
  document.getElementById("appVersion").textContent = `v${VERSION}`;
  applyTheme();
  renderSavedPlaces();
  updateUnitButton();
  bindEvents();
  initMetricTipListeners();
  initDaylightScrubListeners();
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

function bindTapAction(element, action, options = {}) {
  if (!element) return;
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
    if (target) action(event, target);
  });
}

function bindEvents() {
  document.addEventListener("click", blockGuardedClickThrough, true);

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
      renderForecast(state.forecast, state.activePlace);
    } else if (state.activePlace) {
      loadPlace(state.activePlace);
    }
  });

  bindTapAction(els.themeToggle, toggleTheme);
  els.briefing.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-ai]");
    if (!btn) return;
    const action = btn.dataset.ai;
    if (action === "enable") enableAI();
    else if (action === "brief") runBrief();
    else if (action === "stop" && aiBriefAbort) aiBriefAbort.aborted = true;
    else if (action === "copy-report") copySupportReport();
  });
  bindTapDelegate(els.aiAsk, "[data-ask-show], [data-ask-clarify], [data-ask-template], [data-ask-q], [data-memory-remember], [data-memory-detail], [data-memory-show], [data-memory-forget], [data-memory-edit]", (event, target) => {
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
      showPlanMemory(memoryShow.dataset.memoryShow);
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
  bindTapAction(document.getElementById("memoryDetailClose"), closeMemoryDetail);
  bindTapAction(document.getElementById("memoryDetailBackdrop"), closeMemoryDetail);
  bindTapDelegate(els.memoryDetailBody, "[data-memory-show], [data-memory-forget], [data-memory-edit]", (event, target) => {
    const memoryShow = target.closest("[data-memory-show]");
    if (memoryShow) {
      closeMemoryDetail();
      showPlanMemory(memoryShow.dataset.memoryShow);
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
  bindTapAction(els.welcomeLocate, useCurrentLocation);
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
  bindTapAction(els.savePlace, () => {
    if (!state.activePlace) return;
    const alreadySaved = state.savedPlaces.some((place) => place.id === state.activePlace.id);
    if (alreadySaved) {
      openPlaceSheet();
      return;
    }
    savePlace(state.activePlace);
    updateSaveButton();
    openPlaceSheet();
  });
  bindTapAction(els.radarMode, () => setMapMode("radar"));
  bindTapAction(els.futureMode, () => setMapMode("future"));
  bindTapAction(els.zoomOutMap, () => setMapZoom(mapState.zoom - 1));
  bindTapAction(els.zoomInMap, () => setMapZoom(mapState.zoom + 1));
  bindTapAction(els.playRadar, toggleRadarPlayback);
  els.frameSlider.addEventListener("input", () => scrubToFrame(Number(els.frameSlider.value)));
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
  bindTapDelegate(document.getElementById("sheetHourlyList"), ".sheet-hour-row", (event, row) => {
    const memoryDetail = event.target.closest("[data-memory-detail]");
    if (memoryDetail) {
      openMemoryDetail(memoryDetail.dataset.memoryDetail);
      return;
    }
    toggleSheetHourRow(row);
  });
  document.getElementById("sheetHourlyList").addEventListener("keydown", (event) => {
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
    if (event.key === "Escape" && !document.getElementById("dayDetail").hidden) closeDayDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.placeSheet.hidden) closePlaceSheet();
  });

  // Severe weather alerts
  bindTapAction(document.getElementById("alertBar"), openAlertSheet);
  bindTapAction(document.getElementById("alertSheetClose"), closeAlertSheet);
  bindTapAction(document.getElementById("alertBackdrop"), closeAlertSheet);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("alertSheet").hidden) closeAlertSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.memoryDetailSheet.hidden) {
      event.stopImmediatePropagation();
      closeMemoryDetail();
    }
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
  } else {
    if (state.theme !== "auto") clearSkyCanvas();
    else updateSkyChrome(null, null);
  }

  if (mapState.initialized && state.activePlace) {
    renderTileMap();
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

function forecastDailyIndex(data = state.forecast, offsetDays = 0) {
  const target = forecastLocalDate(data, offsetDays);
  const times = data?.daily?.time || [];
  const found = times.findIndex((time) => datePart(time) === target);
  if (found >= 0) return found;
  if (!times.length) return Math.max(0, offsetDays);
  return clamp(offsetDays, 0, times.length - 1);
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
    const cleanName = String(name || "").trim();
    const cleanCountry = String(countryCode || "").toUpperCase();
    if (!cleanName) return;
    const key = `${cleanName.toLowerCase()}|${cleanCountry}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ name: cleanName, countryCode: cleanCountry });
  };

  add(parsed.primary || parsed.raw, parsed.countryCode);
  if (parsed.countryCode) add(parsed.primary || parsed.raw);
  if (parsed.primary !== parsed.raw) add(parsed.raw);
  return attempts;
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

function rankPlaceResults(results, parsed) {
  return results
    .map((place, index) => ({ place, index, score: placeScore(place, parsed) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.place);
}

function placeScore(place, parsed) {
  let score = 0;
  const primary = parsed.primary.toLowerCase();
  const stateName = parsed.stateName.toLowerCase();
  const explicitCountry = String(parsed.countryCode || "").toUpperCase();
  const name = String(place.name || "").toLowerCase();
  const admin = String(place.admin1 || "").toLowerCase();
  const country = String(place.country || "").toLowerCase();
  const countryCode = placeCountryCode(place);
  const featureCode = String(place.feature_code || place.featureCode || "").toUpperCase();
  const population = Number(place.population) || 0;

  if (name === primary) score += 35;
  else if (name.startsWith(primary)) score += 18;
  else if (primary && name.includes(primary)) score += 8;

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
  const hasContext = Boolean(state.activePlace) || state.savedPlaces.length > 0;
  els.shell.classList.toggle("mode-welcome", !hasContext);
  if (!hasContext) {
    els.shell.classList.remove("search-open");
    closeAppMenu();
    setWelcomeAmbientLabel("");
    updateWelcomeWeatherMark(null, browserApproximateIsDay());
    initWelcomeAmbience();
  } else {
    setWelcomeAmbientLabel("");
    cancelWelcomeAmbience();
  }
}

function browserApproximateIsDay(date = new Date()) {
  const hour = date.getHours();
  return hour >= 6 && hour < 19;
}

function welcomeIsActive() {
  return Boolean(els.shell?.classList.contains("mode-welcome")) &&
    !state.activePlace &&
    !state.savedPlaces.length;
}

function updateWelcomeWeatherMark(code = null, isDay = browserApproximateIsDay()) {
  const mark = document.querySelector(".welcome-weather-mark");
  if (!mark) return;
  const sky = code === null || code === undefined ? "overcast" : skyCondition(code);
  const condition = ["rain", "snow", "thunder", "clear"].includes(sky) ? sky : "cloud";
  mark.dataset.condition = condition;
  mark.dataset.day = isDay ? "day" : "night";
}

function setWelcomeAmbientLabel(text) {
  if (!els.welcomeAmbientLabel) return;
  const copy = String(text || "").trim();
  els.welcomeAmbientLabel.textContent = copy;
  els.welcomeAmbientLabel.hidden = !copy;
}

function welcomeAmbientCopy(data, place, truth) {
  const placeName = String(place?.name || "").trim();
  if (!placeName) return "";
  const condition = dailyConditionLabel(truth?.code ?? data?.current?.weather_code ?? 3);
  return `Near ${placeName} now · ${condition}`;
}

function cancelWelcomeAmbience() {
  if (welcomeAmbienceAbort) {
    welcomeAmbienceAbort.abort();
    welcomeAmbienceAbort = null;
  }
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
    applyWelcomeAmbience(data, place);
    applied = true;
  } catch {
    /* Keep the designed default welcome sky when coarse lookup is unavailable. */
  } finally {
    if (!applied) welcomeAmbienceStarted = false;
    if (welcomeAmbienceAbort === abort) welcomeAmbienceAbort = null;
  }
}

function applyWelcomeAmbience(data, place) {
  if (!welcomeIsActive() || !data) return;
  const truth = buildWeatherTruth(data);
  updateWelcomeWeatherMark(truth.code, truth.isDay);
  updateSkyCanvas(truth.code, truth.isDay, data, truth.display);
  setWelcomeAmbientLabel(welcomeAmbientCopy(data, place, truth));
}

async function fetchJsonWithTimeout(url, timeoutMs, signal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) signal.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, { signal: controller.signal });
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
}

function closeAppMenu() {
  if (!els.appMenu || els.appMenu.hidden) return;
  toggleAppMenu(false);
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
      <small>${escapeHtml(formatPlaceResultMeta(place))}</small>
    `;
    bindTapAction(button, () => {
      toggleSearch(false);
      loadPlace(normalizePlace(place));
    });
    els.searchResults.appendChild(button);
  });
}

function updateSaveButton() {
  if (!els.savePlace) return;
  const alreadySaved = Boolean(state.activePlace &&
    state.savedPlaces.some((p) => p.id === state.activePlace.id));
  const placeName = state.activePlace?.name || "place";

  els.savePlace.disabled = !state.activePlace;
  els.savePlace.classList.toggle("is-saved", alreadySaved);
  els.savePlace.setAttribute("aria-pressed", String(alreadySaved));
  els.savePlace.setAttribute(
    "aria-label",
    alreadySaved ? `${placeName} is saved. Open saved places.` : `Save ${placeName}`
  );
  els.savePlace.title = alreadySaved ? "Saved place" : "Save place";
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
        <span class="place-item-icon" aria-hidden="true">${g ? weatherIcon(g.code, g.isDay, { density: "dense" }) : ""}</span>
        <span class="place-item-copy">
          <strong>${placeName}</strong>
          <span>${escapeHtml(formatPlaceResultMeta(place) || (isActive ? "Current place" : "Saved place"))}</span>
        </span>
        <span class="place-item-temp">${g ? `${g.temp}${degree(state.unit === "fahrenheit" ? "F" : "C")}` : ""}</span>
      </button>
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

function showSheet(backdrop, sheet) {
  // Force the initial translated state to commit before adding `.show`.
  // This keeps the slide transition, and avoids relying on deferred timers.
  void sheet.offsetHeight;
  backdrop.classList.add("show");
  sheet.classList.add("show");
}

function openPlaceSheet() {
  renderSavedPlaces();
  els.placeBackdrop.hidden = false;
  els.placeSheet.hidden = false;
  showSheet(els.placeBackdrop, els.placeSheet);
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
  setStatus(`Updating ${state.activePlace.name}...`);

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
let lastBackgroundedAt = null;
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
  refreshOnForeground();
}

function refreshOnForeground() {
  if (document.visibilityState === "hidden") return;
  if (!state.activePlace) return;
  if (Date.now() - lastLoadedAt < FOREGROUND_STALE_MS) return;
  for (const id in glanceData) delete glanceData[id]; // let chips re-pull too
  loadPlace(state.activePlace, true);
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

async function fetchForecast(place, force = false) {
  const cacheKey = `forecast:${FORECAST_CACHE_VERSION}:${state.unit}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
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

  const forecastPromise = fetch(`https://api.open-meteo.com/v1/forecast?${params}`).then(async (response) => {
    if (!response.ok) throw new Error("Forecast failed.");
    return response.json();
  });
  const airQualityPromise = fetchAirQuality(place, force).catch(() => null);
  const data = await forecastPromise;
  data.airQuality = await airQualityPromise;
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  return data;
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
  const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  if (!response.ok) throw new Error("Air quality failed.");
  const data = await response.json();
  localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  return data;
}

function convertForecastUnits(data, fromUnit, toUnit) {
  if (!data || fromUnit === toUnit) return data;

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

  return converted;
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

function renderForecast(data, place) {
  const perf = perfStart();
  state.forecast = data; // retained for the day-detail sheet
  state.forecastUnit = state.unit;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const current = data.current;
  const todayCode = weatherCodes[current.weather_code] || "Weather";
  const todayIndex = forecastDailyIndex(data);

  const truth = buildWeatherTruth(data);
  state.weatherTruth = truth;
  const firstRainChance = truth.rainChance;
  const displayCondition = truth.display;
  const isDay = displayCondition.isDay;
  state.sunriseMs = parseForecastTimestamp(data.daily.sunrise[todayIndex], data);
  state.sunsetMs = parseForecastTimestamp(data.daily.sunset[todayIndex], data);
  const nowCode = truth.code;
  state.skyState = deriveSkyState(nowCode, isDay, data, displayCondition);
  syncWeatherTruthDaylight(truth, state.skyState.isDay);
  state.skyIsDay = truth.isDay;
  state.locationIsDay = truth.isDay;
  if (state.theme === "auto") applyTheme();

  els.locationName.textContent = placeLabel(place);
  els.nowTemp.textContent = `${Math.round(current.temperature_2m)}${degree(tempUnit)}`;
  renderLaunchSummaryStrip(data, tempUnit, windUnit, truth);
  els.feelsLike.textContent = `${Math.round(current.apparent_temperature)}${degree(tempUnit)}`;
  els.rainChance.textContent = truth.precip?.phase === "active"
    ? "Now"
    : truth.precip?.phase === "imminent" ? "Soon" : `${firstRainChance || 0}%`;
  els.wind.textContent = `${Math.round(current.wind_speed_10m)} ${windUnit}`;
  els.uv.textContent = Math.round(data.daily.uv_index_max[todayIndex] || 0);
  els.humidity.textContent = `${current.relative_humidity_2m ?? "--"}%`;
  els.sunrise.textContent = data.daily.sunrise[todayIndex] ? formatTime(data.daily.sunrise[todayIndex]) : "--";
  els.sunset.textContent = data.daily.sunset[todayIndex] ? formatTime(data.daily.sunset[todayIndex]) : "--";
  els.updatedAt.textContent = `Updated ${formatTime(current.time)}`;
  updateWeatherTruthReceipt(truth);

  updateHeroWeatherIcon(nowCode, truth.isDay);

  renderTodayGlance(data, tempUnit, windUnit, todayIndex, truth);
  renderNowcast(data, truth);
  renderInsights(data, windUnit);
  resetBriefing();
  renderHourly(data, tempUnit, truth);
  renderDaily(data, tempUnit, precipUnit);
  updateMapPlace();
  refreshInlineMap(true);
  bindMetricTips(data, tempUnit, windUnit);
  updateSkyCanvas(nowCode, truth.isDay, data, displayCondition);
  perfEnd("renderForecast", perf);
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
  const wind = windGlance(windVal, windUnit);
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
  if (els.windContext) els.windContext.textContent = wind.context;
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

function windGlance(speed, unit) {
  const mph = unit === "mph" ? speed : speed / 1.609344;
  if (mph >= 30) return { headline: "very windy", context: "Secure loose items" };
  if (mph >= 20) return { headline: "windy", context: "Noticeable gusts" };
  if (mph >= 12) return { headline: "breezy", context: "A steady breeze" };
  if (mph >= 5) return { headline: "light wind", context: "Gentle movement" };
  return { headline: "calm wind", context: "Barely moving" };
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
      ? ` · peaks ${air.peakAqi}${air.peakTime ? ` near ${formatTime(air.peakTime)}` : ""}`
      : "";
    return {
      label: "Air",
      value: air.visualLabel,
      html: airQualityVisualHtml(air),
      tipHtml: airQualityTipHtml(air),
      context: `${air.aqi !== null ? `AQI ${air.aqi}` : air.context}${pollenNote ? ` · ${pollenNote}` : peakNote}`.trim(),
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
  const nowValue = activePrecip ? `${precip.label} now` : `${comfort} - feels ${feels}${degree(tempUnit)}`;
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
  if (currentChance >= 35) {
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
      sky: sky(daily.weather_code[1]),
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
let aiWarmQueued = false;
let aiWarmLoading = false;

function loadAIModule() {
  if (!aiModule) aiModule = import(`./ai.js?v=${encodeURIComponent(VERSION)}`);
  return aiModule;
}

function localAIIntentReady(ai) {
  return aiState.phase === "ready" &&
    typeof ai?.extractPlanIntent === "function" &&
    (typeof ai.isLoaded !== "function" || ai.isLoaded());
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

function errorDetail(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const parts = [
      err.name || "Error",
      err.message || "",
      err.cause ? `cause: ${errorDetail(err.cause)}` : ""
    ].filter(Boolean);
    return parts.join(": ");
  }
  if (typeof err === "object") {
    const detail = {};
    for (const key of Object.getOwnPropertyNames(err)) {
      try {
        const value = err[key];
        detail[key] = typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value;
      } catch (_) {
        detail[key] = "[unreadable]";
      }
    }
    if (Object.keys(detail).length) {
      try {
        return JSON.stringify(detail);
      } catch (_) {}
    }
    const asText = String(err);
    return asText && asText !== "[object Object]"
      ? asText
      : "Object error with no readable fields";
  }
  return String(err);
}

function cleanError(err) {
  const text = errorDetail(err);
  return text.replace(/\s+/g, " ").trim().slice(0, 900);
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
  if (aiWarmQueued || aiWarmLoading) return;
  aiWarmQueued = true;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => {
    aiWarmQueued = false;
    if (textInputIsActive()) {
      setTimeout(warmAI, 2200);
      return;
    }
    aiWarmLoading = true;
    loadAIModule()
      .then((ai) => ai.load())
      .catch(() => {}) // a failed warm just means the first tap pays the load
      .finally(() => { aiWarmLoading = false; });
  });
}

function renderBriefingSoon() {
  const now = performance.now();
  if (now - perfState.lastBriefingRenderAt > 90) {
    perfState.lastBriefingRenderAt = now;
    renderBriefing();
    return;
  }
  if (perfState.briefingRenderQueued) return;
  perfState.briefingRenderQueued = true;
  requestAnimationFrame(() => {
    perfState.briefingRenderQueued = false;
    perfState.lastBriefingRenderAt = performance.now();
    renderBriefing();
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
      renderBriefingSoon();
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

/* ---------- Ask the forecast (Q&A + planner templates) ---------- */
// Chips and typed questions are answered by local deterministic forecast logic.
// The tiny model stays focused on summaries; it never owns weather verdicts.
const ACTIVITY_CHIPS = [
  { label: "Ballgame", template: "I have a ballgame " },
  { label: "Golf", template: "I'm golfing " },
  { label: "Dinner outside", template: "Dinner outside " },
  { label: "What to wear", template: "What should I wear " }
];

const PLANNER_TERM_ALIASES = {
  morn: "morning",
  mornin: "morning",
  tmr: "tomorrow",
  tmrw: "tomorrow",
  tmrrow: "tomorrow",
  tonite: "tonight",
  nite: "night",
  eve: "evening",
  tue: "tuesday",
  tues: "tuesday",
  wed: "wednesday",
  weds: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  sat: "saturday",
  sun: "sunday",
  hts: "heights"
};

const PLANNER_CANONICAL_TERMS = [
  "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "night",
  "overnight", "midday", "weekend", "daytime", "sunday", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday"
];
const PLANNER_WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function plannerParseText(value) {
  return askText(value).replace(/\b[a-z]{3,}\b/g, (token) => plannerCanonicalTerm(token) || token);
}

function plannerCanonicalTerm(token) {
  const word = String(token || "").toLowerCase();
  if (PLANNER_TERM_ALIASES[word]) return PLANNER_TERM_ALIASES[word];
  if (PLANNER_CANONICAL_TERMS.includes(word)) return word;
  let best = null;
  let bestDistance = Infinity;
  for (const term of PLANNER_CANONICAL_TERMS) {
    const distance = plannerEditDistance(word, term);
    if (distance < bestDistance) {
      best = term;
      bestDistance = distance;
    }
  }
  const limit = word.length >= 7 ? 2 : word.length >= 5 ? 1 : 0;
  return bestDistance <= limit ? best : "";
}

function plannerEditDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

// Resolve a target day (index into c.daily, 0=today … 9) from a question's
// weekday names or relative phrases. Returns null when no day is referenced.
function resolveDayIndex(s, c) {
  s = plannerParseText(s);
  const days = c.daily;
  if (!days || !days.length) return null;
  if (/\bday after tomorrow\b/.test(s)) return Math.min(2, days.length - 1);
  if (/\btomorrow\b/.test(s)) return 1;
  const inN = s.match(/\bin (\d+) days?\b/);
  if (inN) { const n = +inN[1]; if (n >= 0 && n < days.length) return n; }
  // Weekday names → next occurrence (today counts if it matches).
  for (let wd = 0; wd < 7; wd++) {
    if (s.includes(PLANNER_WEEKDAY_NAMES[wd])) {
      for (let i = 0; i < days.length; i++) if (days[i].dow === wd) return i;
    }
  }
  if (s.includes("weekend")) {
    for (let i = 0; i < days.length; i++) if (days[i].dow === 6) return i; // next Saturday
  }
  if (/\btonight\b|\bovernight\b|\btoday\b|\bright now\b|\bthis afternoon\b/.test(s)) return 0;
  return null;
}

function plannerWeekdayMention(value) {
  const rawWords = String(value || "").match(/[A-Za-z]{3,}/g) || [];
  for (const raw of rawWords) {
    const word = raw.toLowerCase();
    const alias = PLANNER_TERM_ALIASES[word] || "";
    const canonical = alias || plannerCanonicalTerm(word);
    const index = PLANNER_WEEKDAY_NAMES.indexOf(canonical);
    if (index < 0) continue;
    return {
      index,
      label: capitalize(canonical),
      raw,
      corrected: Boolean(!alias && canonical !== word)
    };
  }
  return null;
}

// A short conversation thread of {q, a} for this place/session. The last entry
// may be mid-stream (askStreaming). Cleared when the place changes.
let askThread = [];
let askStreaming = false;
let askError = "";
let askAbort = null;
let plannerClarification = null;
let plannerReturnAfterDayDetail = null;
let plannerEditingMemoryId = "";
let plannerEditingMemoryDraft = "";
let memoryDetailIds = [];
let launchSummaryTargets = [];

function fillPlannerTemplate(template, options = {}) {
  const input = document.getElementById("askInput");
  if (!input) return;
  const { helperText = "Finish the thought: add the day, time, and place if it is away from here." } = options || {};
  const form = document.getElementById("askForm");
  const helper = document.querySelector(".ask-helper");
  input.value = template || "";
  if (form) {
    form.classList.add("is-drafting");
    form.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  if (helper) {
    helper.textContent = helperText;
  }
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch { /* selection can fail on some mobile inputs */ }
  input.addEventListener("input", () => {
    form?.classList.remove("is-drafting");
  }, { once: true });
}

async function runAsk(question, intent) {
  question = (question || "").trim();
  if (!question) return;
  // Engine does one generation at a time — ignore taps while it's busy.
  if (aiState.phase === "generating" || askStreaming) return;
  askError = "";

  if (plannerClarification && !intent && shouldUseAsClarification(question)) {
    await continuePlannerClarificationWithText(question);
    return;
  }
  plannerClarification = null;
  if (intent) clearPlannerMemoryEdit();

  // Activity chips: answer instantly from a code-computed verdict. No model —
  // a tiny model can't reliably reason about this, and even handed the correct
  // verdict it sometimes mangles or flips it. Deterministic = always correct.
  if (intent) {
    const row = beginAskResponse(question);
    try {
      finishAskResponse(row, await answerPresetIntent(intent, question));
    } catch {
      finishAskResponse(row, "I hit a snag checking that preset. Try typing the plan with a day and time.");
    }
    return;
  }

  if (plannerEditingMemoryId) {
    await runMemoryEdit(question, plannerEditingMemoryId);
    return;
  }

  // Free-form: answer deterministically from the data (always correct). We do
  // NOT route open questions to the model — a 0.5B hallucinates on these
  // (e.g. inventing a day's forecast). If we can't answer exactly, say what we
  // CAN answer rather than guessing.
  const row = beginAskResponse(question);
  try {
    const plan = await answerPlanRequest(question);
    if (plan?.clarification) {
      plannerClarification = plan.clarification;
      finishAskResponse(row, plan.clarification.prompt);
      return;
    }
    const direct = plan?.answer || answerFreeform(question);
    finishAskResponse(row, plan?.answer ? plan : direct);
  } catch (error) {
    finishAskResponse(row, "I hit a snag checking that plan. Try a city, day, and time, like \"golf Saturday morning in Fillmore, IL.\"");
  }
}

async function runMemoryEdit(question, memoryId) {
  plannerEditingMemoryDraft = question;
  const row = beginAskResponse(question);
  try {
    const result = await answerPlanRequest(question);
    if (result?.clarification) {
      plannerClarification = result.clarification;
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result?.answer ? result : (answerFreeform(question) || result), {
      updateMemoryId: memoryId,
      original: question
    });
  } catch {
    finishAskResponse(row, "I hit a snag updating that memory. Try a city, day, and time, like \"golf Saturday morning in Fillmore, IL.\"");
  }
}

function shouldUseAsClarification(text) {
  const pending = plannerClarification;
  if (!pending) return false;
  const raw = String(text || "").trim();
  const s = plannerParseText(raw);
  if (!raw || raw.length > 48 || raw.includes("?")) return false;
  if (pending.type === "time") {
    return /\b(morning|afternoon|evening|tonight|night|overnight)\b/.test(s) ||
      /^(?:at|around|about)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(raw) ||
      /^(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(raw);
  }
  if (pending.type === "day") {
    const c = buildAIContext();
    return c ? resolveDayIndex(s, c) != null : false;
  }
  if (pending.type === "location") {
    if (hasAny(s, [" what ", " when ", " should ", " best ", " weather ", " forecast ", " rain ", " wind "])) return false;
    return true;
  }
  return false;
}

function beginAskResponse(question) {
  askThread.push({ q: question, a: "" });
  askStreaming = true;
  renderAsk();
  scrollAskIntoView();
  return askThread.length - 1;
}

function finishAskResponse(row, result, options = {}) {
  const normalized = normalizeAskResult(result);
  if (askThread[row]) {
    askThread[row].a = normalized.answer;
    askThread[row].event = normalized.event || null;
  }
  if (options.updateMemoryId) {
    const updated = applyPlanMemoryEdit(options.updateMemoryId, normalized, {
      row,
      original: options.original || plannerEditingMemoryDraft || askThread[row]?.q || ""
    });
    if (!updated) {
      askError = "I could not turn that edit into a saved plan. Try including the day, time, and place.";
    }
  }
  askStreaming = false;
  renderAsk();
  scrollAskIntoView();
}

function normalizeAskResult(result) {
  if (result && typeof result === "object") {
    return {
      answer: result.answer || AI_FALLBACK_MSG,
      event: result.event || null
    };
  }
  return {
    answer: result || AI_FALLBACK_MSG,
    event: null
  };
}

async function runPlannerClarification(index) {
  if (aiState.phase === "generating" || askStreaming || !plannerClarification) return;
  const option = plannerClarification.options[index];
  if (!option) return;
  const pending = plannerClarification;
  const editingMemoryId = plannerEditingMemoryId;
  plannerClarification = null;
  const row = beginAskResponse(option.label);
  try {
    const result = await completePlanRequest(pending.plan, option);
    if (result?.clarification) {
      plannerClarification = result.clarification;
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result, editingMemoryId ? {
      updateMemoryId: editingMemoryId,
      original: plannerEditingMemoryDraft || pending.plan?.original || option.label
    } : {});
  } catch {
    finishAskResponse(row, "I could not check that plan. Try adding the city/state and a time window.");
  }
}

async function continuePlannerClarificationWithText(text) {
  const pending = plannerClarification;
  const editingMemoryId = plannerEditingMemoryId;
  plannerClarification = null;
  const row = beginAskResponse(text);
  try {
    const option = { label: text };
    if (pending.type === "location") {
      option.locationQuery = mergeLocationClarification(pending.plan.locationQuery, text);
    } else if (pending.type === "day") {
      option.dayText = text;
    } else if (pending.type === "time") {
      option.timeText = text;
    }
    const result = await completePlanRequest(pending.plan, option);
    if (result?.clarification) {
      plannerClarification = result.clarification;
      finishAskResponse(row, result.clarification.prompt);
      return;
    }
    finishAskResponse(row, result, editingMemoryId ? {
      updateMemoryId: editingMemoryId,
      original: plannerEditingMemoryDraft || pending.plan?.original || text
    } : {});
  } catch {
    finishAskResponse(row, "I could not use that detail. Try something like \"6 PM\" or \"Fillmore, IL.\"");
  }
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
  sports: { label: "outdoor sports", hot: 88, cold: 35, rain: 35, wind: 25, uv: 9, aliases: ["soccer", "baseball", "softball", "football", "tennis", "sports", "game", "practice", "ballgame", "ball game"] },
  event: { label: "an outdoor event", hot: 88, cold: 40, rain: 35, wind: 24, uv: 9, aliases: ["event", "party", "birthday", "wedding", "concert", "festival", "parade", "camp", "camping", "recital", "meetup", "meet up"] },
  pool: { label: "the pool", hot: 95, cold: 75, rain: 25, wind: 22, uv: 9, aliases: ["pool", "swim", "swimming", "beach"] },
  commute: { label: "the commute", hot: 100, cold: 15, rain: 55, wind: 35, uv: 99, aliases: ["commute", "drive", "driving", "school pickup", "errands", "travel"] }
};

const PLAN_SIGNAL_PHRASES = [
  " i have ", " we have ", " i've got ", " we got ", " going ", " planning ",
  " plan ", " plans ", " tee ", " game ", " practice ", " tournament ", " event ",
  " party ", " birthday ", " wedding ", " concert ", " festival ", " parade ",
  " camp ", " camping ", " recital ", " meetup ", " meet up "
];
const PLAN_FLEXIBLE_ASK_PHRASES = ["best", "best time", "best window", "when should", "when can", "window"];
const PLAN_LOCAL_AI_TIMEOUT_MS = 2200;

const ASK_PERIODS = {
  morning: { start: 6, end: 12, label: "morning" },
  afternoon: { start: 12, end: 18, label: "afternoon" },
  evening: { start: 18, end: 22, label: "evening" },
  night: { start: 20, end: 24, label: "tonight" },
  overnight: { start: 0, end: 7, label: "overnight" },
  day: { start: 8, end: 20, label: "daytime" }
};

const PLAN_LOCATION_STOP_WORDS = [
  "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "night",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "on", "for", "at", "from", "between", "before", "after", "around", "about"
];
const PLAN_LOCATION_IGNORE = new Set([
  "the morning", "morning", "the afternoon", "afternoon", "the evening", "evening",
  "the", "tonight", "night", "the rain", "rain", "weather", "the weather"
]);
const PLAN_LOCATION_PREPOSITION_RE = /\b(?:in|near|around|at)\s+/gi;
const PLAN_IMPLICIT_LOCATION_DROP_WORDS = new Set([
  "i", "me", "my", "m", "we", "us", "our", "re", "ve", "you", "your",
  "can", "could", "should", "would", "will", "do", "does", "did",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "got", "get", "need", "want", "maybe", "please", "pls",
  "a", "an", "the", "this", "that", "these", "those",
  "to", "for", "of", "on", "at", "from", "between", "before", "after", "around", "about", "by",
  "go", "going", "planning", "plan", "plans", "check", "checking",
  "look", "looks", "looking", "weather", "forecast", "conditions",
  "outside", "outdoors", "outdoor", "inside", "party", "birthday", "wedding",
  "concert", "festival", "parade", "camp", "camping", "recital", "meetup"
]);
let planActivityLocationWordCache = null;

async function answerPlanRequest(question) {
  const c = buildAIContext();
  if (!c) return null;
  const plan = await buildPlannerIntent(question, c);
  if (!plan) return null;
  return completePlanRequest(plan);
}

async function buildPlannerIntent(question, c) {
  const deterministic = parsePlanRequest(question, c);
  if (deterministic) return deterministic;
  const repaired = repairPlanIntent(question, c);
  if (repaired) return repaired;
  return localAIPlanIntent(question, c);
}

function parsePlanRequest(question, c, options = {}) {
  const s = plannerParseText(question);
  const activityKey = detectAskActivity(question) || detectPlanActivity(question);
  const dayIdx = resolveDayIndex(s, c);
  const dayMention = plannerWeekdayMention(question);
  const targetDate = dayIdx == null ? null : planTargetDate(dayIdx);
  const locationQuery = extractPlanLocationQuery(question);
  const timing = inferPlanTiming(question, c, activityKey);
  const implicitCandidates = locationQuery ? [] : implicitPlanLocationCandidates({ original: question });
  const planish = hasAny(s, PLAN_SIGNAL_PHRASES);
  const flexibleAsk = hasAny(s, PLAN_FLEXIBLE_ASK_PHRASES);
  const signalCount = [activityKey, dayIdx != null, locationQuery, timing.hasTime, implicitCandidates.length].filter(Boolean).length;

  if (flexibleAsk) return null;
  if (!activityKey && !planish) return null;
  if (!activityKey && signalCount < 2) return null;
  if (activityKey && signalCount < 1 && !planish) return null;

  return {
    original: question,
    activityKey: activityKey || "walk",
    dayIdx,
    dayExplicit: dayIdx != null,
    dayDisplay: dayMention && dayIdx != null ? dayMention.label : "",
    dayCorrection: dayMention?.corrected ? { from: dayMention.raw, to: dayMention.label } : null,
    targetDate,
    locationQuery,
    locationExplicit: Boolean(locationQuery),
    timing,
    intent: plannerIntentReceipt({
      source: options.source || "rules",
      confidence: plannerIntentConfidence({ activityKey, dayIdx, locationQuery, timing, implicitCandidates, planish }),
      implicitLocationCandidates: implicitCandidates
    })
  };
}

function detectPlanActivity(question) {
  const s = plannerParseText(question);
  if (hasAny(s, [" ballgame ", " ball game ", " baseball ", " softball "])) return "sports";
  if (hasAny(s, [" tee time ", " tee ", " round of golf "])) return "golf";
  if (hasAny(s, [" practice ", " tournament ", " match ", " game "])) return "sports";
  if (hasAny(s, [" event ", " party ", " birthday ", " wedding ", " concert ", " festival ", " parade ", " camp ", " camping ", " recital ", " meetup ", " meet up "])) return "event";
  return null;
}

function plannerIntentConfidence({ activityKey, dayIdx, locationQuery, timing, implicitCandidates, planish }) {
  let score = 0.15;
  if (activityKey) score += 0.35;
  if (dayIdx != null) score += 0.18;
  if (timing?.hasTime) score += timing.explicit ? 0.16 : 0.08;
  if (locationQuery) score += 0.18;
  else if (implicitCandidates?.length) score += 0.08;
  if (planish) score += 0.07;
  return Math.min(0.98, Math.round(score * 100) / 100);
}

function plannerIntentReceipt(meta = {}) {
  return {
    source: meta.source || "rules",
    confidence: meta.confidence || 0,
    implicitLocationCandidates: meta.implicitLocationCandidates || [],
    notes: meta.notes || []
  };
}

function repairPlanIntent(question, c) {
  const s = plannerParseText(question);
  if (hasAny(s, PLAN_FLEXIBLE_ASK_PHRASES)) return null;
  const fragments = compactPlannerFragments({
    activity: likelyPlannerActivityText(question),
    day: likelyPlannerDayText(question, c),
    time: likelyPlannerTimeText(question),
    location: implicitPlanLocationCandidates({ original: question })[0] || ""
  });
  if (!fragments.activity && !hasAny(s, PLAN_SIGNAL_PHRASES)) return null;
  if (![fragments.day, fragments.time, fragments.location].filter(Boolean).length) return null;
  return planFromIntentFragments(question, c, fragments, "repair");
}

function likelyPlannerActivityText(question) {
  const s = plannerParseText(question);
  const key = detectAskActivity(question) || detectPlanActivity(question);
  if (key) return ACTIVITY_RULES[key]?.aliases?.[0] || ACTIVITY_RULES[key]?.label || key;
  if (hasAny(s, PLAN_SIGNAL_PHRASES)) return "event";
  return "";
}

function likelyPlannerDayText(question, c) {
  const s = plannerParseText(question);
  const idx = resolveDayIndex(s, c);
  if (idx == null) return "";
  return c.daily?.[idx]?.label || "";
}

function likelyPlannerTimeText(question) {
  const s = plannerParseText(question);
  const period = inferPlanPeriod(s);
  if (period) return period;
  const at = s.match(/\b(?:at|around|about)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (at) return at[0];
  const between = s.match(/\b(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:and|to|-)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/);
  return between?.[0] || "";
}

function compactPlannerFragments(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    String(value || "").trim().replace(/\s+/g, " ").slice(0, 90)
  ]));
}

function planFromIntentFragments(original, c, fragments, source) {
  const activityText = fragments.activity || "";
  const activityKey = detectAskActivity(activityText) || detectPlanActivity(activityText) ||
    detectAskActivity(original) || detectPlanActivity(original) ||
    (activityText ? "event" : null);
  if (!activityKey) return null;

  const dayIdx = resolveDayIndex(fragments.day || original, c);
  const dayMention = plannerWeekdayMention(fragments.day || original);
  const targetDate = dayIdx == null ? null : planTargetDate(dayIdx);
  const locationQuery = cleanPlanLocation(fragments.location || "");
  const timingText = fragments.time
    ? normalizePlanTimeClarification(fragments.time)
    : original;
  const timing = inferPlanTiming(timingText, c, activityKey);
  const confidence = plannerIntentConfidence({
    activityKey,
    dayIdx,
    locationQuery,
    timing,
    implicitCandidates: locationQuery ? [] : implicitPlanLocationCandidates({ original }),
    planish: true
  });
  if (dayIdx == null && !locationQuery && !timing.hasTime) return null;

  return {
    original,
    activityKey,
    dayIdx,
    dayExplicit: dayIdx != null,
    dayDisplay: dayMention && dayIdx != null ? dayMention.label : "",
    dayCorrection: dayMention?.corrected ? { from: dayMention.raw, to: dayMention.label } : null,
    targetDate,
    locationQuery,
    locationExplicit: Boolean(locationQuery),
    locationImplicit: Boolean(locationQuery && !extractPlanLocationQuery(original)),
    timing,
    intent: plannerIntentReceipt({
      source,
      confidence,
      notes: source === "local-ai" ? ["local intent extraction"] : ["repaired loose phrasing"]
    })
  };
}

async function localAIPlanIntent(question, c) {
  if (!shouldTryLocalAIPlanIntent(question, c)) return null;
  try {
    const ai = await loadAIModule();
    if (!localAIIntentReady(ai)) return null;
    const abort = { aborted: false };
    const raw = await withPlannerTimeout(ai.extractPlanIntent(question, abort), PLAN_LOCAL_AI_TIMEOUT_MS, abort);
    const fragments = parseLocalAIIntent(raw);
    if (!fragments) return null;
    return planFromIntentFragments(question, c, fragments, "local-ai");
  } catch (_) {
    return null;
  }
}

function shouldTryLocalAIPlanIntent(question, c) {
  if (aiState.phase !== "ready") return false;
  const s = plannerParseText(question);
  if (hasAny(s, [" umbrella ", " what to wear ", " wear ", " aqi ", " air quality ", " pollen ", " sunrise ", " sunset "])) return false;
  const day = resolveDayIndex(s, c) != null;
  const period = Boolean(inferPlanPeriod(s));
  const activityish = Boolean(detectAskActivity(question) || detectPlanActivity(question) || hasAny(s, PLAN_SIGNAL_PHRASES));
  return activityish || (day && period);
}

function withPlannerTimeout(promise, ms, abort = null) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (abort) abort.aborted = true;
      reject(new Error("Planner intent timed out."));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseLocalAIIntent(raw) {
  const text = String(raw || "").trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return compactPlannerFragments({
      activity: parsed.activity,
      day: parsed.day,
      time: parsed.time,
      location: parsed.location
    });
  } catch (_) {
    return null;
  }
}

function planTargetDate(dayIdx) {
  const idx = dayIdx == null ? 0 : dayIdx;
  return state.forecast?.daily?.time?.[idx] || forecastLocalDate(state.forecast, idx);
}

function inferPlanTiming(question, c, activityKey) {
  const s = plannerParseText(question);
  const period = inferPlanPeriod(s);
  const between = s.match(/\b(?:from|between)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:and|to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (between) {
    const start = parsePlanHour(between[1], between[2], between[3] || between[6], period);
    const end = parsePlanHour(between[4], between[5], between[6] || between[3], period);
    if (start.ambiguous || end.ambiguous) return { needsClarification: true, hasTime: true, period };
    let endHour = end.hour;
    if (endHour <= start.hour) endHour += 12;
    return {
      startHour: start.hour,
      endHour: Math.min(endHour, 24),
      hasTime: true,
      explicit: true,
      period,
      assumption: ""
    };
  }

  const at = s.match(/\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (at) {
    const start = parsePlanHour(at[1], at[2], at[3], period);
    if (start.ambiguous) return { needsClarification: true, hasTime: true, period };
    const duration = planDurationHours(activityKey);
    return {
      startHour: start.hour,
      endHour: Math.min(start.hour + duration, 24),
      hasTime: true,
      explicit: true,
      period,
      assumption: `I used ${formatHourFloat(start.hour)}-${formatHourFloat(Math.min(start.hour + duration, 24))}.`
    };
  }

  if (period) {
    const window = planPeriodWindow(period, activityKey);
    return {
      ...window,
      hasTime: true,
      explicit: true,
      period: window.period || period,
      assumption: window.assumption
    };
  }

  const activityWindow = defaultActivityWindow(activityKey);
  if (activityWindow) {
    return {
      ...activityWindow,
      hasTime: true,
      explicit: false,
      period: activityWindow.period,
      assumption: activityWindow.assumption
    };
  }

  return { needsClarification: true, hasTime: false, period: null };
}

function inferPlanPeriod(s) {
  s = plannerParseText(s);
  if (/\bovernight\b/.test(s)) return "overnight";
  if (/\bmorning\b|\bbefore noon\b/.test(s)) return "morning";
  if (/\bafternoon\b|\bmidday\b/.test(s)) return "afternoon";
  if (/\bevening\b|\bafter work\b/.test(s)) return "evening";
  if (/\btonight\b|\bnight\b/.test(s)) return "night";
  return null;
}

function parsePlanHour(hourValue, minuteValue, meridiem, period) {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) return { ambiguous: true };
  if (meridiem) {
    const m = meridiem.toLowerCase();
    if (m === "pm" && hour < 12) hour += 12;
    if (m === "am" && hour === 12) hour = 0;
    return { hour: hour + minute / 60, ambiguous: false };
  }
  if (period === "morning" || period === "overnight") {
    if (hour === 12) hour = 0;
    return { hour: hour + minute / 60, ambiguous: false };
  }
  if (period === "afternoon" || period === "evening" || period === "night") {
    if (hour < 12) hour += 12;
    return { hour: hour + minute / 60, ambiguous: false };
  }
  return { ambiguous: true };
}

function planDurationHours(activityKey) {
  if (activityKey === "golf") return 5;
  if (activityKey === "sports") return 3;
  if (activityKey === "dinner" || activityKey === "grill" || activityKey === "picnic") return 3;
  if (activityKey === "commute") return 1;
  return 2;
}

function planPeriodWindow(period, activityKey) {
  if (period === "morning") {
    const start = activityKey === "golf" || activityKey === "run" ? 7 : 8;
    return { startHour: start, endHour: 12, period: "morning", assumption: `I used ${formatHourFloat(start)}-noon for morning.` };
  }
  if (period === "afternoon") {
    return { startHour: 12, endHour: 18, period: "afternoon", assumption: "I used noon-6 PM for afternoon." };
  }
  if (period === "evening" || period === "night") {
    if (activityKey === "dinner" || activityKey === "grill" || activityKey === "picnic") {
      return { startHour: 17, endHour: 21, period: "evening", assumption: "I used 5-9 PM for dinner hours." };
    }
    if (activityKey === "sports") {
      return { startHour: 18, endHour: 22, period: "evening", assumption: "I used 6-10 PM for game time." };
    }
    return { startHour: 18, endHour: 22, period: "evening", assumption: "I used 6-10 PM for evening." };
  }
  if (period === "overnight") {
    return { startHour: 0, endHour: 7, period: "overnight", assumption: "I used midnight-7 AM for overnight." };
  }
  return { startHour: 8, endHour: 20, period: "day", assumption: "I used daytime hours." };
}

function defaultActivityWindow(activityKey) {
  if (activityKey === "dinner" || activityKey === "grill") return { startHour: 17, endHour: 21, period: "evening", assumption: "I used 5-9 PM for dinner hours." };
  return null;
}

function extractPlanLocationQuery(question) {
  const raw = String(question || "").trim();
  const candidates = [];
  let match;
  PLAN_LOCATION_PREPOSITION_RE.lastIndex = 0;
  while ((match = PLAN_LOCATION_PREPOSITION_RE.exec(raw)) !== null) {
    const rest = raw.slice(match.index + match[0].length);
    if (isTemporalLocationPhrase(rest)) continue;
    const value = cleanPlanLocation(rest);
    if (value) candidates.push(value);
  }
  return candidates[candidates.length - 1] || "";
}

function isTemporalLocationPhrase(value) {
  const key = normalizeQualifierKey(value);
  const s = plannerParseText(value).trim();
  if (!key || /^\d/.test(key)) return true;
  return /^(the )?(morning|afternoon|evening|night|weekend|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(key) ||
    /^(the )?(morning|afternoon|evening|night|weekend|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(s);
}

function cleanPlanLocation(value) {
  let text = String(value || "").trim().replace(/^the\s+/i, "");
  const stop = findPlanLocationStopIndex(text);
  if (stop >= 0) text = text.slice(0, stop).trim();
  text = text.replace(/[,.\s]+$/g, "").trim();
  const key = normalizeQualifierKey(text);
  return key && !PLAN_LOCATION_IGNORE.has(key) ? text : "";
}

async function inferImplicitPlanLocation(plan) {
  const candidates = implicitPlanLocationCandidates(plan);
  for (const query of candidates) {
    try {
      const options = await fetchPlannerPlaceOptions(query);
      if (isLikelyImplicitPlanLocation(query, options)) return { query, options };
    } catch {
      return null;
    }
  }
  return null;
}

function implicitPlanLocationCandidates(plan) {
  const s = plannerParseText(plan?.original || "").trim();
  if (!s) return [];
  const activityWords = planActivityLocationWords();
  const tokens = s
    .split(/\s+/)
    .map((token) => plannerCanonicalTerm(token) || token)
    .filter((token) => !shouldDropImplicitLocationToken(token, activityWords));
  const candidates = [];
  const add = (value) => {
    const query = cleanImplicitPlanLocation(value);
    const key = normalizeQualifierKey(query);
    if (!isViableImplicitLocationQuery(query) || candidates.some((item) => normalizeQualifierKey(item) === key)) return;
    candidates.push(query);
  };

  add(tokens.join(" "));
  for (let count = Math.min(5, tokens.length - 1); count >= 1; count -= 1) {
    add(tokens.slice(-count).join(" "));
  }
  return candidates.slice(0, 5);
}

function shouldDropImplicitLocationToken(token, activityWords) {
  if (!token) return true;
  if (/^\d{1,2}(?::\d{2})?$/.test(token) || /^(?:am|pm)$/.test(token)) return true;
  if (PLAN_LOCATION_STOP_WORDS.includes(token) || PLANNER_CANONICAL_TERMS.includes(token)) return true;
  if (PLAN_IMPLICIT_LOCATION_DROP_WORDS.has(token) || activityWords.has(token)) return true;
  return false;
}

function cleanImplicitPlanLocation(value) {
  return normalizeQualifierKey(value)
    .replace(/\s+/g, " ")
    .trim();
}

function isViableImplicitLocationQuery(query) {
  const key = normalizeQualifierKey(query);
  if (!key || PLAN_LOCATION_IGNORE.has(key)) return false;
  const words = key.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return false;
  if (words.length === 1 && words[0].length < 3) return false;
  if (words.every((word) =>
    PLAN_IMPLICIT_LOCATION_DROP_WORDS.has(word) ||
    PLAN_LOCATION_STOP_WORDS.includes(word) ||
    PLANNER_CANONICAL_TERMS.includes(word) ||
    planActivityLocationWords().has(word)
  )) return false;
  return true;
}

function isLikelyImplicitPlanLocation(query, { parsed, matches }) {
  if (!matches?.length) return false;
  const words = normalizeQualifierKey(query).split(/\s+/).filter(Boolean);
  const [top, second] = matches;
  const topName = normalizeQualifierKey(top.place?.name || "");
  const primary = normalizeQualifierKey(parsed?.primary || query);
  const hasQualifier = Boolean(parsed?.stateName || parsed?.countryCode || parsed?.region);
  const exactName = topName === primary;
  const closeToActive = state.activePlace && distanceKm(state.activePlace, top.place) < 250;
  const clearGap = !second || top.score >= second.score + 12;

  if (hasQualifier && top.score >= 45) return true;
  if (words.length >= 2 && top.score >= 42 && (exactName || clearGap || closeToActive)) return true;
  if (words.length === 1 && words[0].length >= 4 && exactName && top.score >= 45) return true;
  if (closeToActive && top.score >= 60) return true;
  return false;
}

function planActivityLocationWords() {
  if (planActivityLocationWordCache) return planActivityLocationWordCache;
  const words = new Set(["event", "game", "practice", "match", "tournament", "tee", "time", "round"]);
  Object.values(ACTIVITY_RULES).forEach((rule) => {
    [rule.label, ...(rule.aliases || [])].forEach((term) => {
      normalizeQualifierKey(term).split(/\s+/).forEach((word) => {
        if (word) words.add(word);
      });
    });
  });
  planActivityLocationWordCache = words;
  return words;
}

function findPlanLocationStopIndex(text) {
  const re = /\b[a-z]{2,}\b/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].toLowerCase();
    const token = plannerCanonicalTerm(raw) || raw;
    if (PLAN_LOCATION_STOP_WORDS.includes(token)) return match.index;
  }
  const punct = text.search(/[?.!]/);
  return punct >= 0 ? punct : -1;
}

function mergeLocationClarification(original, detail) {
  const a = String(original || "").trim();
  const b = String(detail || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (normalizeQualifierKey(b).includes(normalizeQualifierKey(a))) return b;
  return `${a}, ${b}`;
}

async function completePlanRequest(plan, override = {}) {
  const baseContext = buildAIContext();
  const nextPlan = { ...plan };
  if (override.locationQuery) {
    nextPlan.locationQuery = override.locationQuery;
    nextPlan.locationExplicit = true;
  }
  if (override.dayIdx != null) {
    nextPlan.dayIdx = override.dayIdx;
    nextPlan.dayExplicit = true;
    nextPlan.targetDate = null;
  }
  if (override.dayText) {
    const dayIdx = resolveDayIndex(askText(override.dayText), baseContext);
    if (dayIdx != null) {
      nextPlan.dayIdx = dayIdx;
      nextPlan.dayExplicit = true;
      nextPlan.targetDate = null;
    }
  }
  if (override.timeText) {
    nextPlan.timing = inferPlanTiming(`${nextPlan.original} ${normalizePlanTimeClarification(override.timeText)}`, baseContext, nextPlan.activityKey);
  }

  if (!nextPlan.dayExplicit) {
    return { clarification: buildDayClarification(nextPlan, baseContext) };
  }

  if (nextPlan.timing?.needsClarification || !nextPlan.timing?.hasTime) {
    return { clarification: buildTimeClarification(nextPlan) };
  }

  const inferredLocation = !override.place && !nextPlan.locationQuery
    ? await inferImplicitPlanLocation(nextPlan)
    : null;
  if (inferredLocation) {
    nextPlan.locationQuery = inferredLocation.query;
    nextPlan.locationExplicit = true;
    nextPlan.locationImplicit = true;
  }

  const placeResult = override.place
    ? { place: normalizePlace(override.place), data: override.data || null, alerts: override.alerts || null }
    : inferredLocation
      ? resolvePlanPlaceOptions(nextPlan, inferredLocation.options)
      : await resolvePlanPlace(nextPlan);
  if (placeResult.clarification) return placeResult;

  const place = normalizePlace(placeResult.place);
  const usingActivePlace = samePlanPlace(place, state.activePlace);
  const data = placeResult.data || (usingActivePlace ? state.forecast : await fetchForecast(place));
  const alerts = placeResult.alerts || (usingActivePlace ? activeAlerts : await safeFetchPlanAlerts(place));
  const c = buildAIContext(data, place, alerts);
  if (!c) return { answer: "I need a loaded forecast before I can check that plan." };

  const dayIdx = resolvePlanDayIndex(nextPlan, data, c);
  if (dayIdx === null) {
    return { answer: "I can only check plans inside the next 10 days right now." };
  }

  const window = {
    dayIdx,
    startHour: nextPlan.timing.startHour,
    endHour: nextPlan.timing.endHour,
    period: nextPlan.timing.period,
    label: "custom"
  };
  const stats = planWindowStats(data, c, window);
  if (!stats) return { answer: "I could not find hourly forecast data for that plan window." };

  const startMs = planBoundaryMs(data, window.startHour, dayIdx);
  const endMs = planBoundaryMs(data, window.endHour, dayIdx);
  const alert = topAlertForPlanRange(alerts, startMs, endMs);
  const displayLabel = planWindowDisplayLabel(nextPlan, stats);
  return {
    answer: planAnswer(nextPlan, place, c, stats, alert),
    event: plannerShowEvent({
      title: `${planDisplayName(nextPlan)} ${displayLabel}`,
      place,
      data,
      alerts,
      window,
      stats,
      label: displayLabel
    })
  };
}

function plannerShowEvent({ title, place, data, alerts, window, stats, label }) {
  const startMs = planBoundaryMs(data, window.startHour, window.dayIdx);
  const endMs = planBoundaryMs(data, window.endHour, window.dayIdx);
  if (!data || !place || startMs === null || endMs === null || endMs <= startMs) return null;
  return {
    title,
    place: normalizePlace(place),
    data,
    alerts: alerts || [],
    dayIndex: window.dayIdx,
    startHour: window.startHour,
    endHour: window.endHour,
    startMs,
    endMs,
    label: label || stats?.label || "plan window"
  };
}

function loadPlanMemories() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAN_MEMORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizePlanMemory).filter(Boolean).slice(0, 60);
  } catch {
    return [];
  }
}

function savePlanMemories() {
  try {
    localStorage.setItem(PLAN_MEMORY_KEY, JSON.stringify(state.planMemories.slice(0, 60)));
  } catch {
    /* localStorage can be full or unavailable; keep the in-memory session copy. */
  }
}

function normalizePlanMemory(memory) {
  if (!memory || memory.kind !== "plan") return null;
  const place = normalizePlace(memory.place || {});
  if (!Number.isFinite(Number(place?.latitude)) || !Number.isFinite(Number(place?.longitude))) return null;
  const startHour = Number(memory.startHour);
  const endHour = Number(memory.endHour);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) return null;
  const targetDate = String(memory.targetDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  return {
    id: String(memory.id || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    kind: "plan",
    title: String(memory.title || "Plan").slice(0, 80),
    label: String(memory.label || "Plan window").slice(0, 80),
    original: String(memory.original || "").slice(0, 220),
    answer: String(memory.answer || "").slice(0, 280),
    place,
    targetDate,
    startHour,
    endHour,
    createdAt: Number(memory.createdAt) || Date.now(),
    updatedAt: Number(memory.updatedAt) || Date.now()
  };
}

function planMemoryFromEvent(event, exchange = {}) {
  if (!event?.data || !event.place) return null;
  const targetDate = event.data.daily?.time?.[event.dayIndex];
  if (!targetDate) return null;
  return normalizePlanMemory({
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "plan",
    title: event.title || event.label || "Plan",
    label: event.label || "Plan window",
    original: exchange.q || "",
    answer: exchange.a || "",
    place: event.place,
    targetDate,
    startHour: event.startHour,
    endHour: event.endHour,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

function planMemoryMatchesEvent(memory, event) {
  if (!memory || !event?.data || !event.place) return false;
  const targetDate = event.data.daily?.time?.[event.dayIndex];
  return targetDate === memory.targetDate &&
    samePlanPlace(memory.place, event.place) &&
    Math.abs(memory.startHour - event.startHour) < 0.01 &&
    Math.abs(memory.endHour - event.endHour) < 0.01;
}

function rememberedPlanIdForEvent(event) {
  return state.planMemories.find((memory) => planMemoryMatchesEvent(memory, event))?.id || "";
}

function rememberPlanFromThread(rowIndex) {
  const exchange = askThread[rowIndex];
  if (!exchange?.event) return;
  const existing = rememberedPlanIdForEvent(exchange.event);
  if (existing) {
    exchange.memoryId = existing;
    renderAsk();
    return;
  }
  const memory = planMemoryFromEvent(exchange.event, exchange);
  if (!memory) return;
  state.planMemories = [memory, ...state.planMemories].slice(0, 60);
  exchange.memoryId = memory.id;
  savePlanMemories();
  renderAsk();
  renderForecastMemorySurfaces();
}

function clearPlannerMemoryEdit() {
  plannerEditingMemoryId = "";
  plannerEditingMemoryDraft = "";
}

function applyPlanMemoryEdit(memoryId, normalized, options = {}) {
  const existing = state.planMemories.find((memory) => memory.id === memoryId);
  const event = normalized?.event;
  if (!existing || !event) return false;
  const next = planMemoryFromEvent(event, {
    q: options.original || existing.original || planMemoryDraft(existing),
    a: normalized.answer || existing.answer || ""
  });
  if (!next) return false;
  const updated = {
    ...next,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now()
  };
  state.planMemories = state.planMemories.map((memory) =>
    memory.id === existing.id ? updated : memory
  );
  askThread.forEach((exchange) => {
    if (exchange.memoryId === existing.id) exchange.memoryId = "";
  });
  if (Number.isInteger(options.row) && askThread[options.row]) {
    askThread[options.row].memoryId = existing.id;
  }
  savePlanMemories();
  clearPlannerMemoryEdit();
  renderForecastMemorySurfaces();
  return true;
}

function forgetPlanMemory(id) {
  const before = state.planMemories.length;
  state.planMemories = state.planMemories.filter((memory) => memory.id !== id);
  askThread.forEach((exchange) => {
    if (exchange.memoryId === id) exchange.memoryId = "";
  });
  if (plannerEditingMemoryId === id) clearPlannerMemoryEdit();
  if (state.planMemories.length !== before) savePlanMemories();
  renderAsk();
  renderForecastMemorySurfaces();
}

function startPlanMemoryEdit(idOrRow) {
  const rowIndex = Number(idOrRow);
  const exchange = Number.isInteger(rowIndex) ? askThread[rowIndex] : null;
  const memory = exchange ? null : state.planMemories.find((item) => item.id === idOrRow);
  if (!memory) {
    editPlanMemory(idOrRow);
    return;
  }

  const restoreScroll = !els.aiSheet?.hidden
    ? els.aiSheet.scrollTop
    : plannerReturnAfterDayDetail?.scrollTop ?? null;
  if (!els.memoryDetailSheet?.hidden) closeMemoryDetail();

  const dayDetail = document.getElementById("dayDetail");
  if (dayDetail && !dayDetail.hidden) {
    plannerReturnAfterDayDetail = null;
    closeDayDetail();
  }

  if (els.aiSheet?.hidden) {
    openAISheet({ restoreScroll, autoBrief: false });
  } else if (restoreScroll !== null && restoreScroll !== undefined) {
    els.aiSheet.scrollTop = restoreScroll;
  }
  renderAsk();
  requestAnimationFrame(() => editPlanMemory(memory.id));
}

function editPlanMemory(idOrRow) {
  const rowIndex = Number(idOrRow);
  const exchange = Number.isInteger(rowIndex) ? askThread[rowIndex] : null;
  const memory = exchange ? null : state.planMemories.find((item) => item.id === idOrRow);
  const draft = exchange?.q || memory?.original || planMemoryDraft(memory);
  if (memory) {
    plannerEditingMemoryId = memory.id;
    plannerEditingMemoryDraft = draft;
  } else {
    clearPlannerMemoryEdit();
  }
  fillPlannerTemplate(draft, {
    helperText: memory
      ? "Editing remembered plan. Submit to replace this memory."
      : "Adjust the plan, then submit it again."
  });
}

async function showPlanMemory(id, options = {}) {
  const memory = state.planMemories.find((item) => item.id === id);
  if (!memory) return;
  const returnToPlanner = options.returnToPlanner ?? !els.aiSheet?.hidden;
  plannerReturnAfterDayDetail = returnToPlanner
    ? { scrollTop: els.aiSheet?.scrollTop || 0 }
    : null;
  if (!els.aiSheet?.hidden) closeAISheet();
  const switchingPlaces = !samePlanPlace(memory.place, state.activePlace);
  const previousForecast = state.forecast;
  if (switchingPlaces) {
    await loadPlace(memory.place);
    if (state.forecast === previousForecast) {
      const returnState = plannerReturnAfterDayDetail;
      plannerReturnAfterDayDetail = null;
      if (returnToPlanner) openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
      return;
    }
  }
  const event = planMemoryEvent(memory);
  if (!event) {
    const returnState = plannerReturnAfterDayDetail;
    plannerReturnAfterDayDetail = null;
    if (returnToPlanner) openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
    return;
  }
  const opened = openPlannerEventDetail(event);
  if (!opened) {
    const returnState = plannerReturnAfterDayDetail;
    plannerReturnAfterDayDetail = null;
    if (returnToPlanner) openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
  }
}

function memoryIdsFromValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function openMemoryDetail(idsOrValue) {
  const ids = [...new Set(memoryIdsFromValue(idsOrValue))];
  const memories = ids
    .map((id) => state.planMemories.find((memory) => memory.id === id))
    .filter(Boolean);
  if (!memories.length || !els.memoryDetailSheet || !els.memoryDetailBackdrop || !els.memoryDetailBody) return;
  memoryDetailIds = memories.map((memory) => memory.id);
  document.getElementById("memoryDetailTitle").textContent = memories.length === 1
    ? planMemoryTitle(memories[0])
    : `${memories.length} memories`;
  document.getElementById("memoryDetailSub").textContent = memories.length === 1
    ? "Local context · under your control"
    : "Overlapping local context";
  els.memoryDetailBody.innerHTML = memories.map(renderMemoryDetailPanel).join("");
  els.memoryDetailBackdrop.hidden = false;
  els.memoryDetailSheet.hidden = false;
  showSheet(els.memoryDetailBackdrop, els.memoryDetailSheet);
  document.body.style.overflow = "hidden";
}

function refreshOpenMemoryDetail() {
  const ids = memoryDetailIds.filter((id) => state.planMemories.some((memory) => memory.id === id));
  if (!ids.length) {
    closeMemoryDetail();
    return;
  }
  openMemoryDetail(ids);
}

function closeMemoryDetail() {
  if (!els.memoryDetailSheet || !els.memoryDetailBackdrop || els.memoryDetailSheet.hidden) return;
  els.memoryDetailBackdrop.classList.remove("show");
  els.memoryDetailSheet.classList.remove("show");
  const keepLocked =
    !document.getElementById("dayDetail")?.hidden ||
    !els.aiSheet?.hidden ||
    !document.getElementById("alertSheet")?.hidden ||
    !els.placeSheet?.hidden ||
    mapState.immersive;
  document.body.style.overflow = keepLocked ? "hidden" : "";
  setTimeout(() => {
    els.memoryDetailBackdrop.hidden = true;
    els.memoryDetailSheet.hidden = true;
  }, 260);
}

function renderMemoryDetailPanel(memory) {
  const event = samePlanPlace(memory.place, state.activePlace)
    ? planMemoryEvent(memory)
    : null;
  const original = String(memory.original || "").trim();
  const answer = String(memory.answer || "").trim();
  const interpreted = `${planMemoryTitle(memory)} · ${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  const saved = memoryTimestamp(memory.createdAt);
  const updated = memory.updatedAt && Math.abs(memory.updatedAt - memory.createdAt) > 1000
    ? memoryTimestamp(memory.updatedAt)
    : "";
  const weatherLine = event ? planMemoryMeta(memory, event) : `${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  return `
    <article class="memory-detail-panel">
      <div class="memory-detail-title">
        <strong>${escapeHtml(planMemoryTitle(memory))}</strong>
        <span>${escapeHtml(placeLabel(memory.place))}</span>
      </div>
      <dl class="memory-detail-facts">
        <div><dt>Original</dt><dd>${escapeHtml(original || planMemoryDraft(memory))}</dd></div>
        <div><dt>Interpreted</dt><dd>${escapeHtml(interpreted)}</dd></div>
        <div><dt>Weather window</dt><dd>${escapeHtml(weatherLine)}</dd></div>
        ${answer ? `<div><dt>Last answer</dt><dd>${escapeHtml(answer)}</dd></div>` : ""}
        <div><dt>Saved</dt><dd>${escapeHtml(saved)}${updated ? ` · updated ${escapeHtml(updated)}` : ""}</dd></div>
      </dl>
      <div class="memory-detail-actions">
        <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit in Planner</button>
        <button type="button" data-memory-show="${escapeHtml(memory.id)}">Show forecast</button>
        <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
      </div>
    </article>
  `;
}

function memoryTimestamp(value) {
  const date = new Date(Number(value) || Date.now());
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function planMemoryEvent(memory, data = state.forecast, place = state.activePlace, alerts = activeAlerts) {
  if (!memory || !data || !place || !samePlanPlace(memory.place, place)) return null;
  const dayIdx = data.daily?.time?.indexOf(memory.targetDate);
  if (dayIdx === undefined || dayIdx < 0) return null;
  const c = buildAIContext(data, place, alerts);
  if (!c) return null;
  const window = {
    dayIdx,
    startHour: memory.startHour,
    endHour: memory.endHour,
    label: "custom"
  };
  const stats = planWindowStats(data, c, window);
  if (!stats) return null;
  const event = plannerShowEvent({
    title: memory.title,
    place,
    data,
    alerts,
    window,
    stats,
    label: memory.label
  });
  if (event) {
    event.memoryId = memory.id;
    event.badgeLabel = "Memory";
  }
  return event;
}

function planMemoryEventsForPlace(data = state.forecast, place = state.activePlace, options = {}) {
  if (!data || !place) return [];
  const { upcomingOnly = true, limit = Infinity } = options || {};
  const now = forecastNowMs(data);
  const items = state.planMemories
    .map((memory) => ({ memory, event: planMemoryEvent(memory, data, place) }))
    .filter(({ event }) => event && (!upcomingOnly || event.endMs >= now - 60 * 60 * 1000))
    .sort((a, b) => a.event.startMs - b.event.startMs);
  return Number.isFinite(limit) ? items.slice(0, Math.max(0, limit)) : items;
}

function activePlanMemoryEvents(data = state.forecast, place = state.activePlace) {
  return planMemoryEventsForPlace(data, place, { limit: 6 });
}

function activePlanMemoryEventsForDay(dayIndex, data = state.forecast, place = state.activePlace) {
  const index = Number(dayIndex);
  if (!Number.isInteger(index)) return [];
  return planMemoryEventsForPlace(data, place).filter(({ event }) => event.dayIndex === index);
}

function planMemoryDetailEventForDay(items, data = state.forecast, place = state.activePlace) {
  if (!items?.length) return null;
  if (items.length === 1) return items[0].event;
  const windows = items
    .map(({ event }) => event)
    .filter((event) => event && Number.isFinite(event.startMs) && Number.isFinite(event.endMs))
    .sort((a, b) => a.startMs - b.startMs);
  if (!windows.length) return null;
  const first = windows[0];
  const last = windows.reduce((best, event) => event.endMs > best.endMs ? event : best, first);
  return {
    title: `${items.length} plans`,
    place: normalizePlace(place),
    data,
    alerts: activeAlerts || [],
    dayIndex: first.dayIndex,
    startHour: Math.min(...windows.map((event) => event.startHour)),
    endHour: Math.max(...windows.map((event) => event.endHour)),
    startMs: first.startMs,
    endMs: last.endMs,
    label: "remembered plans",
    badgeLabel: "Memory",
    memoryIds: items.map(({ memory }) => memory.id),
    windows
  };
}

function hourlyPlanMemoryContext(rows, data = state.forecast) {
  const markers = new Map();
  const overlaps = new Set();
  const items = activePlanMemoryEvents(data, state.activePlace);
  items.forEach(({ memory, event }) => {
    const touched = rows.filter((row, rowIndex) => {
      const start = row.ms;
      const next = rows[rowIndex + 1]?.ms;
      const end = next && next > start ? next : start + 60 * 60 * 1000;
      return start < event.endMs && end > event.startMs;
    });
    touched.forEach((row) => overlaps.add(row.index));
    const first = touched[0];
    if (!first) return;
    const list = markers.get(first.index) || [];
    list.push({ memory, event });
    markers.set(first.index, list);
  });
  return { markers, overlaps };
}

function hourlyPlanMemoryLabel(items) {
  if (!items?.length) return "";
  if (items.length > 1) return `${items.length} plans`;
  return planMemoryTitle(items[0].memory);
}

function planMemoryDayCue(items) {
  if (!items?.length) return "";
  if (items.length > 1) return `${items.length} plans`;
  const { memory } = items[0];
  return `${planMemoryTitle(memory)} ${planMemoryTimeText(memory)}`;
}

function planMemoryDayRangeText(items) {
  if (!items?.length) return "";
  if (items.length === 1) return planMemoryTimeText(items[0].memory);
  const starts = items.map(({ memory }) => memory.startHour).filter(Number.isFinite);
  const ends = items.map(({ memory }) => memory.endHour).filter(Number.isFinite);
  if (!starts.length || !ends.length) return "";
  return `${hourText(Math.min(...starts))}-${hourText(Math.max(...ends))}`;
}

function planMemoryDraft(memory) {
  if (!memory) return "";
  return `${memory.title} ${planMemoryTimeText(memory)} in ${placeLabel(memory.place)}`.replace(/\s+/g, " ").trim();
}

function planMemoryTitle(memory) {
  const raw = String(memory?.title || "Plan").trim();
  return raw.replace(/\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i, "").slice(0, 34) || raw;
}

function planMemoryTimeText(memory) {
  return `${hourText(memory.startHour)}-${hourText(memory.endHour)}`;
}

function planMemoryDayLabel(memory, data = state.forecast) {
  const idx = data?.daily?.time?.indexOf(memory.targetDate) ?? -1;
  if (idx >= 0) return formatDay(memory.targetDate, idx);
  return memory.targetDate;
}

function planMemoryMeta(memory, event = null) {
  const where = placeLabel(memory.place);
  const when = `${planMemoryDayLabel(memory)} · ${planMemoryTimeText(memory)}`;
  if (!event) return `${when} · ${where}`;
  const c = buildAIContext(event.data, event.place, event.alerts);
  if (!c) return `${when} · ${where}`;
  const stats = planWindowStats(event.data, c, {
    dayIdx: event.dayIndex,
    startHour: event.startHour,
    endHour: event.endHour,
    label: "custom"
  });
  if (!stats) return `${when} · ${where}`;
  return `${when} · ${stats.rainChance}% rain · ${stats.windMax} ${state.unit === "fahrenheit" ? "mph" : "km/h"}`;
}

function planMemoryListItems(data = state.forecast, place = state.activePlace) {
  const today = forecastLocalDate(data) || new Date().toISOString().slice(0, 10);
  const now = forecastNowMs(data);
  return state.planMemories
    .map((memory) => {
      const isHere = Boolean(place && samePlanPlace(memory.place, place));
      const event = isHere ? planMemoryEvent(memory, data, place) : null;
      const isPast = event ? event.endMs < now - 60 * 60 * 1000 : memory.targetDate < today;
      return { memory, event, isHere, isPast };
    })
    .filter((item) => !item.isPast)
    .sort((a, b) =>
      a.memory.targetDate.localeCompare(b.memory.targetDate) ||
      a.memory.startHour - b.memory.startHour ||
      a.memory.createdAt - b.memory.createdAt
    );
}

function planMemoryEventContextLabel(memory, event) {
  const place = event?.place ? placeLabel(event.place) : "";
  const title = memory ? planMemoryTitle(memory) : String(event?.title || "").trim();
  const when = memory ? planMemoryTimeText(memory) : "";
  return ["Memory", place, [title, when].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}

function planMemoryDayContextLabel(items, event) {
  if (!items?.length) return "";
  if (items.length === 1) return planMemoryEventContextLabel(items[0].memory, event);
  const place = event?.place ? placeLabel(event.place) : "";
  return ["Memory", place, `${items.length} plans`, planMemoryDayRangeText(items)].filter(Boolean).join(" · ");
}

function detailEventWindows(eventWindow) {
  if (!eventWindow) return [];
  if (Array.isArray(eventWindow)) return eventWindow.filter(Boolean);
  if (Array.isArray(eventWindow.windows) && eventWindow.windows.length) {
    return eventWindow.windows.filter(Boolean);
  }
  return [eventWindow];
}

function matchingDetailEventWindows(windows, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  return windows.filter((window) =>
    Number.isFinite(window?.startMs) &&
    Number.isFinite(window?.endMs) &&
    startMs < window.endMs &&
    endMs > window.startMs
  );
}

function detailEventBadgeLabel(windows, eventWindow = null) {
  if (!windows?.length) return "";
  const memoryWindows = windows.filter((window) => window.memoryId);
  if (memoryWindows.length > 1) return `${memoryWindows.length} memories`;
  if (memoryWindows.length === 1) return planMemoryTitle(memoryWindows[0]);
  if (windows.length > 1) return eventWindow?.badgeLabel || `${windows.length} plans`;
  return windows[0].badgeLabel || eventWindow?.badgeLabel || "Plan";
}

function graphMemoryWindowIds(window) {
  return [...new Set([
    window?.memoryId,
    ...(Array.isArray(window?.memoryIds) ? window.memoryIds : [])
  ].filter(Boolean).map(String))];
}

function graphMemoryWindowLabel(ids, fallback = "Memory") {
  if (!ids?.length) return fallback;
  if (ids.length > 1) return `${ids.length} memories`;
  const memory = state.planMemories.find((item) => item.id === ids[0]);
  return memory ? planMemoryTitle(memory) : fallback;
}

function normalizeGraphMemoryWindow(window, visibleStartMs, visibleEndMs) {
  if (!Number.isFinite(window?.startMs) || !Number.isFinite(window?.endMs)) return null;
  if (window.endMs <= visibleStartMs || window.startMs >= visibleEndMs) return null;
  const memoryIds = graphMemoryWindowIds(window);
  if (!memoryIds.length) return null;
  const startMs = Math.max(window.startMs, visibleStartMs);
  const endMs = Math.min(window.endMs, visibleEndMs);
  if (endMs <= startMs) return null;
  return {
    startMs,
    endMs,
    memoryIds,
    sourceWindows: [window]
  };
}

function graphMemoryWindows(hrs, data = state.forecast, eventWindow = null) {
  if (!hrs?.length || !data || !state.activePlace) return [];
  const startMs = hrs[0].ms ?? parseForecastTimestamp(hrs[0].time, data);
  const lastMs = hrs[hrs.length - 1].ms ?? parseForecastTimestamp(hrs[hrs.length - 1].time, data);
  if (!Number.isFinite(startMs) || !Number.isFinite(lastMs)) return [];
  const visibleEndMs = Math.max(lastMs + 60 * 60 * 1000, startMs + 60 * 60 * 1000);
  const seen = new Set();
  const raw = [];

  const pushWindow = (window) => {
    const normalized = normalizeGraphMemoryWindow(window, startMs, visibleEndMs);
    if (!normalized) return;
    const key = normalized.memoryIds.length
      ? `ids:${normalized.memoryIds.sort().join(",")}:${Math.round(normalized.startMs / 60000)}:${Math.round(normalized.endMs / 60000)}`
      : `time:${Math.round(normalized.startMs / 60000)}:${Math.round(normalized.endMs / 60000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push(normalized);
  };

  detailEventWindows(eventWindow).forEach(pushWindow);
  planMemoryEventsForPlace(data, state.activePlace, { limit: 12 }).forEach(({ event }) => pushWindow(event));
  raw.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  return raw.reduce((merged, item) => {
    const prev = merged[merged.length - 1];
    if (prev && item.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, item.endMs);
      prev.memoryIds = [...new Set(prev.memoryIds.concat(item.memoryIds))];
      prev.sourceWindows.push(...item.sourceWindows);
      prev.label = graphMemoryWindowLabel(prev.memoryIds);
      return merged;
    }
    merged.push({
      ...item,
      label: graphMemoryWindowLabel(item.memoryIds)
    });
    return merged;
  }, []);
}

function graphMemoryAtMs(ms, windows) {
  if (!Number.isFinite(ms) || !windows?.length) return null;
  return windows.find((window) => ms >= window.startMs && ms < window.endMs) || null;
}

function graphMemoryAriaLabel(window, data = state.forecast) {
  const start = formatForecastMs(window.startMs, data);
  const end = formatForecastMs(window.endMs, data);
  return `${window.label}, ${start} to ${end}. Show memory details.`;
}

function renderGraphMemoryBands(windows, xForMs, options = {}) {
  if (!windows?.length || typeof xForMs !== "function") return "";
  const {
    top = 18,
    bottom = 136,
    labelY = top + 13,
    minLabelWidth = 48,
    data = state.forecast
  } = options;
  const h = Math.max(1, bottom - top);
  return windows.map((window, index) => {
    const x1 = xForMs(window.startMs);
    const x2 = xForMs(window.endMs);
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return "";
    const left = Math.min(x1, x2);
    const width = Math.max(3, Math.abs(x2 - x1));
    const center = left + width / 2;
    const ids = window.memoryIds.join(",");
    const label = width >= minLabelWidth ? window.label : "";
    const labelText = label.length > 18 ? `${label.slice(0, 17)}…` : label;
    const aria = graphMemoryAriaLabel(window, data);
    return `<g class="graph-memory-window graph-memory-window-${index % 4}" data-memory-detail="${escapeHtml(ids)}" tabindex="0" role="button" aria-label="${escapeHtml(aria)}">` +
      `<title>${escapeHtml(aria)}</title>` +
      `<rect class="graph-memory-band" x="${left.toFixed(1)}" y="${top}" width="${width.toFixed(1)}" height="${h}" rx="5"/>` +
      `<line class="graph-memory-edge" x1="${left.toFixed(1)}" y1="${top}" x2="${left.toFixed(1)}" y2="${bottom}"/>` +
      `<line class="graph-memory-edge" x1="${(left + width).toFixed(1)}" y1="${top}" x2="${(left + width).toFixed(1)}" y2="${bottom}"/>` +
      (labelText ? `<text class="graph-memory-label" x="${center.toFixed(1)}" y="${labelY}" text-anchor="middle">${escapeHtml(labelText)}</text>` : "") +
      `<rect class="graph-memory-hit" x="${left.toFixed(1)}" y="${Math.max(0, top - 12)}" width="${width.toFixed(1)}" height="${h + 24}" rx="8"/>` +
    `</g>`;
  }).join("");
}

function renderPlanMemoryGroup(label, items) {
  if (!items.length) return "";
  return `<div class="memory-group">` +
    `<div class="memory-group-title">${escapeHtml(label)}</div>` +
    `<div class="memory-list">` +
      items.map(({ memory, event, isHere }) => `
        <article class="memory-card">
          <button class="memory-main" type="button" data-memory-detail="${escapeHtml(memory.id)}" aria-label="${escapeHtml(`Inspect ${memory.title}`)}">
            <strong>${escapeHtml(planMemoryTitle(memory))}</strong>
            <span>${escapeHtml(planMemoryMeta(memory, event))}</span>
          </button>
          <div class="memory-actions">
            <button type="button" data-memory-show="${escapeHtml(memory.id)}">${isHere ? "Show" : "Load"}</button>
            <button type="button" data-memory-edit="${escapeHtml(memory.id)}">Edit</button>
            <button type="button" data-memory-forget="${escapeHtml(memory.id)}">Forget</button>
          </div>
        </article>
      `).join("") +
    `</div>` +
  `</div>`;
}

function renderPlanMemorySection() {
  const items = planMemoryListItems().slice(0, 8);
  if (!items.length) return "";
  const here = items.filter((item) => item.isHere);
  const elsewhere = items.filter((item) => !item.isHere);
  const summary = elsewhere.length ? `${here.length} here · ${elsewhere.length} elsewhere` : "Here · local";
  return `<section class="memory-section" aria-label="Nearcast memory">` +
    `<div class="ai-section-title"><strong>Memory</strong><span>${escapeHtml(summary)}</span></div>` +
    renderPlanMemoryGroup("Here", here) +
    renderPlanMemoryGroup("Elsewhere", elsewhere) +
  `</section>`;
}

function renderForecastMemorySurfaces() {
  if (!state.forecast) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  renderHourly(state.forecast, tempUnit, state.weatherTruth || weatherTruth(state.forecast));
  renderDaily(state.forecast, tempUnit, precipUnit);
}

function normalizePlanTimeClarification(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(?:at|around|about|from|between|morning|afternoon|evening|tonight|night|overnight)\b/i.test(text)) return text;
  if (/^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(text)) return `at ${text}`;
  return text;
}

function samePlanPlace(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  return distanceKm(a, b) < 1;
}

function resolvePlanDayIndex(plan, data, c) {
  if (plan.targetDate) {
    const idx = data?.daily?.time?.indexOf(plan.targetDate);
    return idx >= 0 ? idx : null;
  }
  const idx = plan.dayIdx;
  return idx >= 0 && idx < c.daily.length ? idx : null;
}

function buildDayClarification(plan, c = buildAIContext()) {
  const label = planDisplayName(plan).toLowerCase();
  const days = (c?.daily || []).slice(0, 5).map((day, index) => ({
    label: day.label || (index === 0 ? "Today" : index === 1 ? "Tomorrow" : `Day ${index + 1}`),
    dayIdx: index
  }));
  return {
    type: "day",
    plan,
    prompt: `Which day should I use for ${label}?`,
    options: days
  };
}

function buildTimeClarification(plan) {
  const label = planDisplayName(plan);
  return {
    type: "time",
    plan,
    prompt: `What time should I use for ${label.toLowerCase()}?`,
    options: [
      { label: "Morning", timeText: "morning" },
      { label: "Afternoon", timeText: "afternoon" },
      { label: "Evening", timeText: "evening" }
    ]
  };
}

async function resolvePlanPlace(plan) {
  if (!plan.locationQuery) {
    return { place: state.activePlace, data: state.forecast, alerts: activeAlerts };
  }
  const options = await fetchPlannerPlaceOptions(plan.locationQuery);
  return resolvePlanPlaceOptions(plan, options);
}

function resolvePlanPlaceOptions(plan, options) {
  if (!options.matches.length) {
    return {
      clarification: {
        type: "location",
        plan,
        prompt: `I could not find "${plan.locationQuery}". Try city + state or country.`,
        options: state.activePlace ? [{ label: `Use ${placeLabel(state.activePlace)}`, place: state.activePlace }] : []
      }
    };
  }
  if (shouldClarifyPlanPlace(options)) {
    return {
      clarification: {
        type: "location",
        plan,
        prompt: `Which ${plan.locationQuery} should I use?`,
        options: options.matches.slice(0, 4).map(({ place }) => ({
          label: placeLabel(normalizePlace(place)),
          place: normalizePlace(place)
        }))
      }
    };
  }
  return { place: normalizePlace(options.matches[0].place) };
}

async function fetchPlannerPlaceOptions(query) {
  const parsed = parseLocationQuery(query);
  const seen = new Set();
  const results = [];
  for (const attempt of buildPlaceSearchAttempts(parsed)) {
    const places = await fetchPlaceResults(attempt.name, 8, attempt);
    places.forEach((place) => {
      const normalized = normalizePlace(place);
      const key = `${normalized.latitude.toFixed(3)}:${normalized.longitude.toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(place);
    });
  }
  const matches = results
    .map((place, index) => ({ place, index, score: plannerPlaceScore(place, parsed) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return { parsed, matches };
}

function plannerPlaceScore(place, parsed) {
  let score = placeScore(place, parsed);
  const active = state.activePlace;
  if (!active) return score;
  const admin = normalizeQualifierKey(place.admin1 || "");
  const activeAdmin = normalizeQualifierKey(active.admin1 || "");
  const country = placeCountryCode(place);
  const activeCountry = placeCountryCode(active);
  if (country && activeCountry && country === activeCountry) score += 8;
  if (admin && activeAdmin && admin === activeAdmin) score += 22;
  const distance = distanceKm(active, place);
  if (Number.isFinite(distance)) {
    if (distance < 80) score += 42;
    else if (distance < 250) score += 28;
    else if (distance < 600) score += 12;
  }
  return score;
}

function shouldClarifyPlanPlace({ parsed, matches }) {
  if (parsed.countryCode || parsed.stateName || matches.length < 2) return false;
  const [top, second] = matches;
  const topDistance = state.activePlace ? distanceKm(state.activePlace, top.place) : Infinity;
  if (Number.isFinite(topDistance) && topDistance < 250 && top.score >= second.score + 8) return false;
  const primary = normalizeQualifierKey(parsed.primary);
  const sameNameCount = matches.slice(0, 4)
    .filter(({ place }) => normalizeQualifierKey(place.name) === primary).length;
  return sameNameCount > 1 && top.score < second.score + 24;
}

function distanceKm(a, b) {
  const lat1 = Number(a?.latitude);
  const lon1 = Number(a?.longitude);
  const lat2 = Number(b?.latitude);
  const lon2 = Number(b?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function safeFetchPlanAlerts(place) {
  try {
    return await fetchAlerts(place);
  } catch {
    return [];
  }
}

function planWindowStats(data, c, w) {
  const hours = planWindowHours(data, w);
  const day = c.daily[w.dayIdx] || c.daily[0];
  const idxs = hours.map(({ index }) => index);
  if (!idxs.length) return null;
  const values = (key, fallback) => idxs.map((i) => data.hourly[key][i] ?? fallback);
  const temps = idxs.map((i) => data.hourly.temperature_2m[i]);
  const feels = idxs.map((i) => data.hourly.apparent_temperature[i]);
  const pop = values("precipitation_probability", 0);
  const precip = values("precipitation", 0);
  const wind = values("wind_speed_10m", c.now.wind);
  const gust = values("wind_gusts_10m", c.now.gust);
  const uv = values("uv_index", 0);
  const codes = idxs.map((i) => data.hourly.weather_code[i]);
  const air = airStatsForHours(data, hours, c.air);

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
    aqiMax: air.aqiMax,
    aqiLabel: air.aqiLabel,
    pollenRank: air.pollenRank,
    pollenLabel: air.pollenLabel,
    pollenLevel: air.pollenLevel,
    sky: weatherCodes[mostCommon(codes)] || day.sky || "Weather",
    stormPotential: codes.some((code) => [95, 96, 99].includes(Number(code)))
  };
}

function planWindowHours(data, w) {
  const day = data?.daily?.time?.[w.dayIdx];
  if (!data?.hourly?.time || !day) return [];
  const startHour = w.startHour ?? 0;
  const endHour = w.endHour ?? 24;
  return data.hourly.time
    .map((time, index) => ({ time, index, hour: forecastLocalHour(time) }))
    .filter(({ time, hour }) => time.startsWith(day) && hour >= startHour && hour < endHour);
}

function planBoundaryMs(data, hour, offsetDays = 0) {
  const dayShift = Math.floor(hour / 24);
  const local = ((hour % 24) + 24) % 24;
  const wholeHour = Math.floor(local);
  const minute = Math.round((local - wholeHour) * 60);
  const day = forecastLocalDate(data, offsetDays + dayShift);
  if (!day) return null;
  return parseForecastTimestamp(
    `${day}T${String(wholeHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    data
  );
}

function topAlertForPlanRange(alerts, startMs, endMs) {
  return (alerts || [])
    .filter((alert) => alertOverlapsRange(alert, startMs, endMs))
    .sort((a, b) => alertPriority(b) - alertPriority(a))[0] || null;
}

function planAnswer(plan, place, c, stats, alert) {
  const rule = ACTIVITY_RULES[plan.activityKey] || ACTIVITY_RULES.walk;
  const score = numericWindowScore(rule, stats);
  const tone = alert ? alertTone(alert) : "";
  const verdict = planVerdict(score, tone);
  const activity = planDisplayName(plan);
  const displayLabel = planWindowDisplayLabel(plan, stats);
  const location = plan.locationExplicit ? ` in ${placeLabel(place)}` : "";
  const why = planWhy(plan, place, stats, c.units, alert);
  const advice = planAdvice(stats, alert, score);
  return `${activity} ${displayLabel}${location}: ${verdict}. Why: ${why}. ${advice}`.replace(/\s+/g, " ").trim();
}

function planWindowDisplayLabel(plan, stats) {
  const day = String(plan?.dayDisplay || "").trim();
  const w = stats?.window || {};
  if (!day) return stats?.label || "plan window";
  if (w.period) return `${day} ${ASK_PERIODS[w.period]?.label || w.period}`;
  if (Number.isFinite(w.startHour) && Number.isFinite(w.endHour)) {
    return `${day} from ${hourText(w.startHour)} to ${hourText(w.endHour)}`;
  }
  return stats?.label || "plan window";
}

function planDisplayName(plan) {
  const s = askText(plan.original);
  if (hasAny(s, [" ballgame ", " ball game ", " baseball ", " softball "])) return "Ballgame";
  if (plan.activityKey === "golf") return "Golf";
  if (plan.activityKey === "sports") return "Game/practice";
  if (plan.activityKey === "event") return "Event";
  const label = ACTIVITY_RULES[plan.activityKey]?.label || "Plan";
  return capitalize(label.replace(/^a\s+/, "").replace(/^the\s+/, ""));
}

function planVerdict(score, tone) {
  if (tone === "warning") return "High-risk";
  if (tone === "watch") return "Watch closely";
  if (score >= 80) return "Looks good";
  if (score >= 65) return "Pretty good";
  if (score >= 45) return "Iffy";
  return "Not ideal";
}

function planReasons(stats, units, alert) {
  const reasons = [];
  if (alert) reasons.push(`${alert.event} overlaps that window`);
  if (stats.stormPotential) reasons.push("thunderstorms are possible");
  if (stats.rainChance >= 60) reasons.push(`${stats.rainChance}% rain chance`);
  else if (stats.rainChance >= 35) reasons.push(`${stats.rainChance}% rain chance`);
  else reasons.push(`rain looks low (${stats.rainChance}%)`);
  if (stats.gustMax >= stats.windMax + 8 && stats.gustMax >= 22) reasons.push(`gusts near ${stats.gustMax} ${units.wind}`);
  else reasons.push(`wind near ${stats.windMax} ${units.wind}`);
  if (stats.aqiMax !== null && stats.aqiMax !== undefined) {
    if (stats.aqiMax >= 101) reasons.push(`AQI ${stats.aqiMax} (${stats.aqiLabel.toLowerCase()})`);
    else if (stats.aqiMax >= 51) reasons.push(`moderate air (AQI ${stats.aqiMax})`);
  }
  if (stats.pollenRank >= 3) reasons.push(`${stats.pollenLabel} pollen ${stats.pollenLevel}`);
  if (stats.uvMax >= 8) reasons.push(`UV up to ${stats.uvMax}`);
  if (stats.feelsAvg >= 88 || stats.feelsAvg <= 40) reasons.push(`feels around ${stats.feelsAvg}${units.temp}`);
  else reasons.push(`${stats.tempMin}${units.temp}-${stats.tempMax}${units.temp}`);
  return reasons;
}

function planWhy(plan, place, stats, units, alert) {
  const reasons = planReasons(stats, units, alert).slice(0, 4);
  if (plan.timing?.assumption) reasons.push(plan.timing.assumption.replace(/\.$/, ""));
  if (plan.dayCorrection) reasons.push(`read "${plan.dayCorrection.from}" as ${plan.dayCorrection.to}`);
  if (plan.locationImplicit) reasons.push(`read ${placeLabel(place)} as the place`);
  if (plan.intent?.source === "local-ai") reasons.push("read the plan details from your wording");
  return reasons.join(", ");
}

function planAdvice(stats, alert, score) {
  if (alert) {
    const tone = alertTone(alert);
    if (tone === "warning") return "Check local guidance before you go.";
    if (tone === "watch") return "Keep a backup plan and stay weather-aware.";
    return "Keep an eye on the alert details.";
  }
  if (stats.stormPotential) return "Have a delay or indoor fallback.";
  if (stats.rainChance >= 55) return "Bring rain gear and expect interruptions.";
  if (stats.aqiMax >= 151) return "Air quality is rough enough to consider moving it indoors.";
  if (stats.aqiMax >= 101) return "Sensitive folks may want a shorter window or an indoor backup.";
  if (stats.pollenRank >= 4) return "Allergy-sensitive people should plan ahead.";
  if (stats.uvMax >= 8) return "Sunscreen earns its spot in the bag.";
  if (score >= 70) return "Weather is mostly behaving for this one.";
  return "I would keep a backup option handy.";
}

function formatHourFloat(hour) {
  if (hour === 12) return "noon";
  if (hour === 24) return "midnight";
  const total = Math.round(hour * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return formatClock(h, m, false, m !== 0);
}

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
  if (w.period && w.dayIdx === 0) {
    if (w.period === "night") return "tonight";
    if (w.period === "overnight") return "overnight";
    return `this ${ASK_PERIODS[w.period]?.label || w.period}`;
  }
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
  const s = plannerParseText(q);
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
  const air = airStatsForHours(data, hours, c.air);

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
    aqiMax: air.aqiMax,
    aqiLabel: air.aqiLabel,
    pollenRank: air.pollenRank,
    pollenLabel: air.pollenLabel,
    pollenLevel: air.pollenLevel,
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

  if (stats.aqiMax !== null && stats.aqiMax !== undefined) {
    if (stats.aqiMax >= 151) {
      score = Math.min(score, 0);
      reasons.push(`AQI ${stats.aqiMax} (${stats.aqiLabel.toLowerCase()})`);
    } else if (stats.aqiMax >= 101) {
      score = Math.min(score, 1);
      reasons.push(`AQI ${stats.aqiMax} (${stats.aqiLabel.toLowerCase()})`);
    } else if (stats.aqiMax >= 51) {
      reasons.push(`moderate air (AQI ${stats.aqiMax})`);
    }
  }

  if (stats.pollenRank >= 3) {
    score = Math.min(score, 2);
    reasons.push(`${stats.pollenLabel} pollen ${stats.pollenLevel}`);
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
  const airPenalty = stats.aqiMax ? Math.max(0, stats.aqiMax - 80) * 0.8 : 0;
  const pollenPenalty = stats.pollenRank >= 3 ? stats.pollenRank * 4 : 0;
  return Math.round(100 - tempPenalty - rainPenalty - windPenalty - uvPenalty - airPenalty - pollenPenalty);
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
  s = plannerParseText(s);
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
  return bestWindowResult(activityKey, options)?.answer || null;
}

function bestWindowResult(activityKey, options = {}) {
  const c = buildAIContext();
  if (!c) return null;
  let result;
  let title;
  if (activityKey === "dry") {
    result = bestDryWindow(options);
    title = "Dry window";
  } else {
    const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.walk;
    result = bestWindowForRule(rule, options);
    title = `Best for ${rule.label}`;
  }
  if (!result) {
    if (options.allowTomorrow === false) {
      const rule = ACTIVITY_RULES[activityKey] || ACTIVITY_RULES.walk;
      return { answer: `I do not see a useful ${rule.label} window left tonight.` };
    }
    return null;
  }
  return {
    answer: result.answer,
    event: plannerShowEvent({
      title,
      place: state.activePlace,
      data: state.forecast,
      alerts: activeAlerts,
      window: result.stats.window,
      stats: result.stats
    })
  };
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
        intent: "best-dry",
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
        intent: "best-dry",
        badge: "Maybe",
        title: "Least wet stretch",
        q: "What is the least wet window today?",
        window: cardWindowText(dry.stats),
        meta: cardMeta("Not truly dry", dry.reasons)
      };
    }
    return {
      ...dry,
      intent: "best-dry",
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
      intent: "best-walk",
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
      intent: "best-dinner",
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
      intent: "best-patio",
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
      intent: item.intent,
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
    if (rule.aliases.some((alias) => {
      const phrase = askText(alias).trim();
      return phrase && s.includes(` ${phrase} `);
    })) return key;
  }
  return null;
}

async function answerPresetIntent(intent, question) {
  const c = buildAIContext();
  if (!c) return null;

  if (intent === "plan") {
    const result = await answerPlanRequest(question);
    if (result?.clarification) {
      plannerClarification = result.clarification;
      return result.clarification.prompt;
    }
    return result || answerFreeform(question);
  }

  const s = askText(question);
  const options = bestWindowOptionsFromText(s, c);
  if (intent === "best-dry") {
    return bestWindowResult("dry", options) ||
      bestWindowResult("dry", { dayIdx: 1, earliestHour: 7, limitHour: 22 });
  }
  if (intent === "best-walk") return bestWindowResult("walk", options);
  if (intent === "best-dinner") return bestWindowResult("dinner", options);
  if (intent === "best-patio") return bestWindowResult("picnic", options);

  const stats = askWindowStats(resolveAskWindow(question, c));
  if (!stats) return null;
  if (intent === "wear") return outfitAnswer(stats, c.units);
  if (intent.startsWith("activity-")) {
    const key = intent.replace(/^activity-/, "");
    const rule = ACTIVITY_RULES[key] || ACTIVITY_RULES.walk;
    return activityAnswer(rule, stats, c.units);
  }
  return answerFreeform(question);
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
  if (hasAny(s, ["air quality", "aqi", "pollution", "polluted", "pm2", "pm 2", "smoke", "hazy air"])) {
    if (!c.air || c.air.aqi === null) return "I do not have air quality data for this place right now.";
    const peak = stats.aqiMax && stats.aqiMax > c.air.aqi + 10
      ? ` It may peak near ${stats.aqiMax} during ${stats.label}.`
      : "";
    return `Air quality is ${c.air.band.label.toLowerCase()} right now: US AQI ${c.air.aqi}${c.air.pm25 !== null ? `, PM2.5 ${Math.round(c.air.pm25)} micrograms per cubic meter` : ""}.${peak}`;
  }
  if (hasAny(s, ["pollen", "allergy", "allergies", "hay fever"])) {
    if (!c.air?.pollen) return "I do not have pollen data for this place right now.";
    const pollen = c.air.pollen;
    return `${capitalize(pollen.label)} pollen is ${pollen.levelLabel}${Number.isFinite(pollen.value) ? `, around ${Math.round(pollen.value)} grains per cubic meter` : ""}.`;
  }
  if (hasAny(s, ["humid", "muggy", "sticky", "dry air"])) {
    return `Humidity is ${c.now.humidity}% right now. I only have detailed humidity for current conditions.`;
  }
  return null;
}

function comparisonDayIndexes(q, c) {
  const s = plannerParseText(q);
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

function airStatsForHours(data, hours, fallback = null) {
  const airQuality = data?.airQuality;
  if (!airQuality) {
    return {
      aqiMax: fallback?.aqi ?? null,
      aqiLabel: fallback?.band?.label || "",
      pollenRank: fallback?.pollen?.rank ?? 0,
      pollenLabel: fallback?.pollen?.label || "",
      pollenLevel: fallback?.pollen?.levelLabel || ""
    };
  }

  const hourTimes = hours
    .map(({ index }) => parseForecastTimestamp(data?.hourly?.time?.[index], data))
    .filter((ms) => ms !== null);
  const start = hourTimes.length ? Math.min(...hourTimes) - 30 * 60 * 1000 : forecastNowMs(data);
  const end = hourTimes.length ? Math.max(...hourTimes) + 90 * 60 * 1000 : start + 3 * 60 * 60 * 1000;
  const aqTimes = airQuality.hourly?.time || [];

  let aqiMax = null;
  let pollen = null;
  aqTimes.forEach((time, index) => {
    const ms = parseForecastTimestamp(time, airQuality);
    if (ms === null || ms < start || ms > end) return;
    const aqi = finiteValue(airQuality.hourly?.us_aqi?.[index]);
    if (aqi !== null) aqiMax = aqiMax === null ? aqi : Math.max(aqiMax, aqi);
    POLLEN_FIELDS.forEach((field) => {
      const value = finiteValue(airQuality.hourly?.[field.key]?.[index]);
      const band = pollenBand(value);
      if (!band) return;
      const candidate = { label: field.label, value, rank: band.rank, level: band.label };
      if (!pollen || candidate.rank > pollen.rank || (candidate.rank === pollen.rank && candidate.value > pollen.value)) {
        pollen = candidate;
      }
    });
  });

  if (aqiMax === null) aqiMax = fallback?.aqi ?? null;
  if (!pollen && fallback?.pollen) {
    pollen = {
      label: fallback.pollen.label,
      value: fallback.pollen.value,
      rank: fallback.pollen.rank,
      level: fallback.pollen.levelLabel
    };
  }
  const band = aqiMax !== null ? aqiBand(aqiMax) : null;
  return {
    aqiMax: aqiMax !== null ? Math.round(aqiMax) : null,
    aqiLabel: band?.label || "",
    pollenRank: pollen?.rank ?? 0,
    pollenLabel: pollen?.label || "",
    pollenLevel: pollen?.level || ""
  };
}

function answerFreeform(q) {
  const c = buildAIContext();
  if (!c) return null;
  const s = plannerParseText(q);
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
  plannerClarification = null;
  renderAsk();
}

function scrollAskIntoView() {
  // Keep the newest exchange + input visible inside the sheet.
  requestAnimationFrame(() => {
    const form = document.getElementById("askForm");
    if (form) form.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function submitAskForm() {
  const input = document.getElementById("askInput");
  if (!input || input.disabled) return;
  runAsk(input.value);
}

function bindAskSendButton() {
  const send = document.querySelector("#askForm .ask-send");
  if (!send) return;
  bindTapAction(send, submitAskForm);
}

function renderAsk() {
  const perf = perfStart();
  const panel = els.aiAsk;
  if (!panel) {
    perfEnd("renderAsk", perf);
    return;
  }
  const available = state.forecast && state.activePlace &&
    aiState.phase !== "unknown";
  if (!available) {
    panel.hidden = true;
    perfEnd("renderAsk", perf);
    return;
  }
  panel.hidden = false;

  const busy = aiState.phase === "generating" || askStreaming;
  const dis = busy ? " disabled" : "";

  const memorySection = renderPlanMemorySection();
  const bestCards = buildBestWindowCards().map((card) =>
    `<button class="best-window-card" type="button" data-ask-q="${escapeHtml(card.q)}"` +
      `${card.intent ? ` data-ask-intent="${escapeHtml(card.intent)}"` : ""}${dis}>` +
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

  const chips = ACTIVITY_CHIPS.map((c) => {
    if (c.template) {
      return `<button class="ask-chip ask-template-chip" type="button" ` +
        `data-ask-template="${escapeHtml(c.template)}"${dis}>${escapeHtml(c.label)}</button>`;
    }
    return `<button class="ask-chip" type="button" data-ask-q="${escapeHtml(c.q)}"` +
      `${c.intent ? ` data-ask-intent="${escapeHtml(c.intent)}"` : ""}${dis}>${escapeHtml(c.label)}</button>`;
  }).join("");

  const thread = askThread.map((ex, i) => {
    const streaming = askStreaming && i === askThread.length - 1;
    const showAction = ex.event && !streaming
      ? `<button class="ask-show" type="button" data-ask-show="${i}">Show me</button>`
      : "";
    const rememberedId = ex.event && !streaming ? (ex.memoryId || rememberedPlanIdForEvent(ex.event)) : "";
    const memoryAction = ex.event && !streaming
      ? rememberedId
        ? `<span class="ask-memory-state">Remembered</span>` +
          `<button class="ask-memory-btn" type="button" data-memory-edit="${escapeHtml(rememberedId)}">Edit</button>` +
          `<button class="ask-memory-btn" type="button" data-memory-forget="${escapeHtml(rememberedId)}">Forget</button>`
        : `<button class="ask-memory-btn primary" type="button" data-memory-remember="${i}">Remember</button>` +
          `<button class="ask-memory-btn" type="button" data-memory-edit="${i}">Edit</button>`
      : "";
    return `<div class="ask-exchange${streaming ? " answering" : ""}">` +
      `<p class="ask-q">${escapeHtml(ex.q)}</p>` +
      `<p class="ask-a">${escapeHtml(ex.a)}</p>` +
      ((showAction || memoryAction) ? `<div class="ask-exchange-actions">${showAction}${memoryAction}</div>` : "") +
    `</div>`;
  }).join("");
  const errLine = askError ? `<p class="ask-err">${escapeHtml(askError)}</p>` : "";
  const clarification = plannerClarification
    ? `<div class="ask-clarify" aria-label="Planner follow-up choices">` +
      plannerClarification.options.map((option, index) =>
        `<button class="ask-clarify-chip" type="button" data-ask-clarify="${index}"${dis}>${escapeHtml(option.label)}</button>`
      ).join("") +
    `</div>`
    : "";

  panel.innerHTML =
    memorySection +
    (bestCards ? `<section class="best-windows" aria-label="Weather windows">` +
      `<div class="ai-section-title"><strong>Weather windows</strong><span>Forecast-grounded</span></div>` +
      `<div class="best-window-grid">${bestCards}</div>` +
    `</section>` : "") +
    `<section class="plan-presets" aria-label="Plan presets">` +
      `<div class="ai-section-title"><strong>Plan something</strong><span>Templates, no guesses</span></div>` +
      `<div class="ask-chips">${chips}</div>` +
      `<p class="ask-helper">Tap a template, then add the day, time, and place if it is away from here.</p>` +
    `</section>` +
    (thread ? `<div class="ask-thread">${thread}${errLine}${clarification}</div>` : clarification) +
    `<form class="ask-form" id="askForm">` +
      `<input id="askInput" type="text" autocomplete="off" ` +
        `placeholder="golf Saturday morning in Silvis"${dis}>` +
      `<button type="submit" class="ask-send" aria-label="Ask"${dis}>↑</button>` +
    `</form>`;
  bindAskSendButton();
  bindInputResponsiveness(document.getElementById("askInput"), "planner-input");
  perfEnd("renderAsk", perf);
}

function showPlannerEvent(rowIndex) {
  const event = askThread[rowIndex]?.event;
  if (!event?.data || !event.place) return;
  plannerReturnAfterDayDetail = {
    scrollTop: els.aiSheet?.scrollTop || 0
  };
  closeAISheet();
  const opened = openPlannerEventDetail(event);
  if (!opened) {
    const returnState = plannerReturnAfterDayDetail;
    plannerReturnAfterDayDetail = null;
    openAISheet({ restoreScroll: returnState?.scrollTop, autoBrief: false });
  }
}

function openPlannerEventDetail(event) {
  const data = event.data;
  const dayIndex = event.dayIndex ?? 0;
  const dayStr = data?.daily?.time?.[dayIndex];
  if (!dayStr || !data?.hourly?.time?.length) return false;
  const indices = [];
  data.hourly.time.forEach((time, index) => {
    if (time.startsWith(dayStr)) indices.push(index);
  });
  if (!indices.length) return false;

  const code = representativeDailyCode(data, dayIndex);
  const memory = event.memoryId ? state.planMemories.find((item) => item.id === event.memoryId) : null;
  openDayDetail({
    indices,
    title: plannerEventSheetTitle(event, dayStr, dayIndex),
    contextLabel: memory ? planMemoryEventContextLabel(memory, event) : plannerEventContextLabel(event),
    code,
    stormPotential: hasThunderPotentialForDay(data, dayIndex, code),
    isDay: true,
    sunriseISO: data.daily.sunrise?.[dayIndex],
    sunsetISO: data.daily.sunset?.[dayIndex],
    dayIndex,
    initialMode: "hourly",
    persistInitialMode: false,
    showNow: dayIndex === 0,
    data,
    alerts: event.alerts || [],
    eventWindow: event
  });
  scrollFocusedSheetHour();
  return true;
}

function scrollFocusedSheetHour() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelector("#sheetHourlyList .sheet-hour-row.is-plan-window")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
}

function plannerEventSheetTitle(event, dayStr, dayIndex) {
  const label = String(event.label || "").trim();
  if (label && label !== "custom" && label.length <= 28) return capitalize(label);
  return formatDay(dayStr, dayIndex);
}

function plannerEventContextLabel(event) {
  const place = event?.place ? placeLabel(event.place) : "";
  const title = String(event?.title || "").trim();
  return ["Planner", place, title].filter(Boolean).join(" · ");
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
      aiState.phase === "idle" ? "Local AI available · optional summary"
      : aiState.phase === "unsupported" ? "Forecast-grounded planning"
      : aiState.phase === "error" ? "Planner works · summary needs attention"
      : "Local AI · forecast-grounded";
  }
}

function openAISheet(options = {}) {
  const { restoreScroll = null, autoBrief = true } = options;
  els.aiBackdrop.hidden = false;
  els.aiSheet.hidden = false;
  showSheet(els.aiBackdrop, els.aiSheet);
  document.body.style.overflow = "hidden";
  if (restoreScroll !== null && restoreScroll !== undefined) {
    requestAnimationFrame(() => {
      els.aiSheet.scrollTop = restoreScroll;
    });
  }
  // Auto-generate the briefing the first time it's opened for a place.
  if (autoBrief && aiState.phase === "ready" && !aiState.text) runBrief();
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
  const code1 = weatherCodes[data.daily.weather_code[tomorrowIndex]] || "Mixed";

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
    let rain = data.hourly.precipitation_probability[index] || 0;
    const cloud = data.hourly.cloud_cover ? data.hourly.cloud_cover[index] : null;
    let rawCode = data.hourly.weather_code[index];
    let precip = data.hourly.precipitation?.[index] || 0;
    let wcode = effectiveWeatherCode(rawCode, rain, cloud, precip, { data });
    let stormPotential = hasThunderPotential(rawCode, rain, wcode, precip, data);
    if (position === 0) {
      const display = truth.display;
      rawCode = display.rawCode;
      wcode = display.code;
      rain = display.nowPrecip?.isWetNow ? display.nowPrecip.chance : Math.max(rain, display.pop || 0);
      precip = Math.max(precip, display.precip || 0);
      stormPotential = display.stormPotential || hasThunderPotential(rawCode, display.pop, wcode, precip, data);
    }
    const nowPrecipPhase = position === 0 ? truth.precip?.phase : null;
    const measuredRate = precipRateFromAmount(precip);
    const measuredWet = position === 0
      ? nowPrecipPhase === "active"
      : measuredRate >= precipRateThresholds(data).measurable;
    const code = weatherCodes[wcode] || "Weather";
    const isHourDay = position === 0 ? truth.isDay : (data.hourly.is_day ? Boolean(data.hourly.is_day[index]) : true);
    const temp = Math.round(data.hourly.temperature_2m[index]);
    const label = position === 0 ? "Now" : formatHour(time);
    const title = stormPotential ? `${code}; thunder possible` : code;
    const rainLabel = measuredWet ? "Rain" : nowPrecipPhase === "imminent" ? "Soon" : rain >= 20 ? `${rain}%` : "";
    const rainBarWidth = measuredWet ? Math.max(70, Math.min(100, rain)) : rain;
    const receipt = position === 0 ? (truth.surfaceDetail || truth.receiptDetail || truth.receipt || "") : "";
    const memoryItems = planMemory.markers.get(index) || [];
    const memoryLabel = hourlyPlanMemoryLabel(memoryItems);
    const hasPlanMemory = planMemory.overlaps.has(index);
    const rainAria = measuredWet ? ", rain" : nowPrecipPhase === "imminent" ? ", precipitation soon" : rain >= 20 ? `, ${rain}% rain` : "";
    const cardLabel = `${label}: ${code}, ${temp} degrees${rainAria}${memoryLabel ? `, ${memoryLabel} starts` : ""}.${receipt ? ` ${receipt}.` : ""} Show hourly details.`;
    return `
      <article class="hour-card${position === 0 ? " current" : ""}${stormPotential ? " has-storm-potential" : ""}${hasPlanMemory ? " has-plan-memory" : ""}" role="button" tabindex="0" data-hour-index="${index}" aria-label="${escapeHtml(cardLabel)}" title="${escapeHtml(receipt || title)}">
        <span class="hour-label">${label}</span>
        ${memoryLabel ? `<span class="hour-memory">${escapeHtml(memoryLabel)}</span>` : ""}
        <div class="hour-icon weather-icon-with-badge" aria-hidden="true">${weatherIcon(wcode, isHourDay, { density: "dense" })}${stormPotential ? thunderBadgeHtml() : ""}</div>
        <strong class="hour-temp" style="--t-h:${tempOklchHue(temp).toFixed(0)}">${temp}°</strong>
        <span class="hour-rain${rainLabel ? " wet" : ""}">${rainLabel}</span>
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
    const code = dailyConditionLabel(wcode);
    const stormPotential = hasThunderPotentialForDay(data, index, wcode);
    const memoryItems = activePlanMemoryEventsForDay(index, data);
    const memoryCue = planMemoryDayCue(memoryItems);
    const dayAria = `${formatDay(time, index)} detail${stormPotential ? ", thunder possible" : ""}${memoryCue ? `, remembered ${memoryCue}` : ""}`;
    return `
      <article class="day-row${index === 0 ? " current" : ""}${stormPotential ? " has-storm-potential" : ""}${memoryCue ? " has-plan-memory" : ""}" data-index="${index}" role="button" tabindex="0" aria-label="${escapeHtml(dayAria)}">
        <div class="day-label">
          <div class="day-icon weather-icon-with-badge" aria-hidden="true">${weatherIcon(wcode, true, { density: "dense" })}${stormPotential ? thunderBadgeHtml() : ""}</div>
          <div>
            <div class="day-name">${formatDay(time, index)}</div>
            <div class="day-meta">
              <span class="day-condition">${escapeHtml(code)}</span>
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
  document.querySelectorAll(".today-glance .has-tip").forEach((card) => {
    card.classList.remove("has-tip");
    delete card.dataset.tip;
    delete card.dataset.tipHtml;
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
    feelsLike: metricTipFeels(diff, feelsVal, tempUnit),
    rainChance: metricTipRain(rainVal),
    wind: metricTipWind(windVal, windUnit),
    humidity: air.tipHtml || metricTipHumidity(humidityVal)
  };

  Object.entries(tips).forEach(([id, tip]) => {
    if (!tip) return;
    const card = document.getElementById(id)?.closest(".glance-signal");
    if (!card) return;
    if (id === "humidity" && air.tipHtml) card.dataset.tipHtml = tip;
    else card.dataset.tip = tip;
    card.classList.add("has-tip");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", id === "humidity" && air.tipHtml ? "Show AQI scale and air details" : "Show weather detail");
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

  metricsEl.addEventListener("click", (event) => {
    const card = event.target.closest(".has-tip");
    if (!card) return;
    showMetricTip(card);
  });

  metricsEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".has-tip");
    if (!card) return;
    event.preventDefault();
    if (activeTipCard === card) hideMetricTip();
    else showMetricTip(card);
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
  els.loadingStatuses.forEach((status) => {
    const text = status.querySelector("[data-loading-message]");
    if (text) text.textContent = message;
    status.hidden = !message;
  });
}

function normalizePlace(place) {
  return {
    id: place.id || `${slug(place.name)}-${Number(place.latitude).toFixed(3)}-${Number(place.longitude).toFixed(3)}`,
    name: place.name || "Selected Place",
    admin1: place.admin1 || "",
    country: place.country || "",
    countryCode: placeCountryCode(place),
    latitude: Number(place.latitude),
    longitude: Number(place.longitude)
  };
}

function placeLabel(place) {
  const countryCode = placeCountryCode(place);
  if (place.admin1 && place.country && countryCode && countryCode !== "US") {
    return [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  }
  return [place.name, place.admin1 || place.country].filter(Boolean).join(", ");
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
const SKY_RENDER_OVERSCAN_PX = 260;

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
  const cloud = clamp(skyNumber(sample.cloud, displayCondition.cloud ?? data?.current?.cloud_cover ?? 0), 0, 100);
  const lowCloud = clamp(skyNumber(sample.lowCloud, cloud * 0.55), 0, 100);
  const midCloud = clamp(skyNumber(sample.midCloud, cloud * 0.45), 0, 100);
  const highCloud = clamp(skyNumber(sample.highCloud, cloud * 0.35), 0, 100);
  const visibilityKm = sample.visibility !== null ? Math.max(0, sample.visibility / 1000) : null;
  const visibilityHaze = visibilityKm === null ? 0 : clamp01((18 - visibilityKm) / 14);
  const humidity = skyNumber(data?.current?.relative_humidity_2m, null);
  const humidityHaze = humidity === null ? 0 : clamp01((humidity - 72) / 24) * 0.32;
  const haze = clamp01(visibilityHaze + (condition === "rain" || condition === "thunder" ? 0 : humidityHaze) + highCloud / 360);
  const shortwave = skyNumber(sample.shortwave, null);
  const direct = skyNumber(sample.direct, null);
  const diffuse = skyNumber(sample.diffuse, null);
  const radiation = shortwave !== null ? clamp01(shortwave / 860) : null;
  const directness = shortwave && shortwave > 20 ? clamp01((direct ?? 0) / shortwave) : solarLift * (1 - cloud / 130);
  const cloudShade = clamp01((cloud - 18) / 82);
  const wetness = condition === "rain" || condition === "thunder"
    ? clamp01((skyNumber(sample.pop, displayCondition.pop ?? 0) - 20) / 70 + skyNumber(sample.precipitation, 0) * 0.7)
    : 0;
  const diffuseGlow = diffuse !== null ? clamp01(diffuse / 300) : clamp01(cloud / 140);
  const daytimeBrightness = clamp01(
    0.24 +
    (radiation ?? solarLift) * 0.64 * (1 - cloudShade * 0.58) +
    diffuseGlow * 0.14 -
    wetness * 0.14
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
    let stops = blendStopSet(base, bright, clamp01((brightness - 0.55) / 0.35) * 0.62);
    stops = blendStopSet(stops, warm, clamp01(phase.warmth ?? phase.golden) * (condition === "clear" || condition === "partly-cloudy" ? 0.88 : 0.46));
    stops = blendStopSet(stops, haze, clamp01((phase.haze ?? 0) * 0.75 + cloud * 0.18));
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
  let stops = blendStopSet(nightBase, twilight, clamp01(phase.twilight));
  stops = blendStopSet(stops, haze, clamp01((phase.haze ?? 0) * 0.45 + (phase.cloud ?? 0) / 220));
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
  const precipCloudBonus = condition === "rain" || condition === "snow" || condition === "thunder" ? 1 : 0;
  const clouds = Math.round(clamp(
    cloudPct / 18 + lowCloud * 1.2 + highCloud * 0.4 + precipCloudBonus,
    condition === "clear" ? 0 : 1,
    condition === "overcast" || condition === "thunder" ? 7 : condition === "rain" ? 6 : 5
  ));
  const moonVisible = !isDay && cloudPct < 82 && skyState.twilight < 0.82 && condition !== "rain" && condition !== "thunder";
  const sunVisible = isDay &&
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
  if (cfg.rain)         parts.push(skyRain(vw, vh, cfg.lightning, rngFor("rain"), skyState));
  if (cfg.snow)         parts.push(skySnow(vw, vh, rngFor("snow"), skyState));
  if (cfg.lightning)    parts.push(skyLightning(vw, vh, rngFor("lightning")));

  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}">${parts.join("")}</svg>`;
  perfEnd("renderSkyScene", perf);
}

function skyViewportSize() {
  const root = document.documentElement;
  const visual = window.visualViewport;
  return {
    width: Math.ceil(Math.max(window.innerWidth || 0, root?.clientWidth || 0, visual?.width || 0, 320)),
    height: Math.ceil(Math.max(window.innerHeight || 0, root?.clientHeight || 0, visual?.height || 0, 640) + SKY_RENDER_OVERSCAN_PX)
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
  let out = "";
  for (let c = 0; c < count; c++) {
    const bx = rng() * vw * 1.26 - vw * 0.13;
    const layerLift = highLayer * 0.045 - lowLayer * 0.035;
    const by = vh * (
      isRainy ? 0.06 + rng() * 0.17 + layerLift :
      isOvercast ? 0.05 + rng() * 0.24 + layerLift :
      0.08 + rng() * 0.30 + layerLift
    );
    const scale = 0.72 + rng() * 0.84 + cloudDepth * 0.22;
    const dur = (105 + rng() * 80).toFixed(0);
    const delay = (rng() * 90).toFixed(0);
    const dir = rng() > 0.5 ? "normal" : "reverse";

    let fill;
    if (!isDay) fill = isRainy ? "#151927" : (isOvercast ? "#202939" : lerpHex("#2d3b55", "#46546b", haze));
    else if (isRainy) fill = lerpHex("#55606a", "#6f7c86", haze * 0.45);
    else if (isOvercast) fill = lerpHex("#8d98a2", "#a8b3bc", haze * 0.5);
    else fill = lerpHex("#f4f9fd", "#c5d0d8", cloudDepth * 0.34 + haze * 0.28);
    const op = clamp((isOvercast || isRainy ? 0.58 : 0.34) + cloudDepth * 0.28 + rng() * 0.14, 0.22, 0.88).toFixed(2);

    const bodyWidth = (280 + rng() * 260) * scale;
    const bodyHeight = (42 + rng() * 36) * scale;
    const shear = (rng() - 0.5) * 54 * scale;
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
  const topOpacity = clamp(haze * 0.20 + warm * 0.08 + cloud * 0.04, 0.02, 0.26);
  const horizonOpacity = clamp(haze * 0.30 + warm * 0.18, 0.03, 0.36);
  const fill = lerpHex("#dcebf4", "#ffd0a0", warm);
  return `
    <rect x="0" y="0" width="${vw}" height="${vh}" fill="${fill}" opacity="${topOpacity.toFixed(2)}"/>
    <ellipse cx="${Math.round(vw * 0.5)}" cy="${Math.round(vh * 0.78)}" rx="${Math.round(vw * 0.78)}" ry="${Math.round(vh * 0.28)}" fill="${fill}" opacity="${horizonOpacity.toFixed(2)}" filter="url(#sky-glow-f)"/>
  `;
}

function skyRain(vw, vh, heavy = false, rng, skyState = null) {
  let out = "";
  const intensity = skyState ? clamp01((skyState.wetness || 0) + (skyState.precipitation || 0) * 0.35) : (heavy ? 1 : 0.55);
  const count = Math.round((heavy ? 74 : 42) + intensity * 46);
  for (let i = 0; i < count; i++) {
    const x = (rng() * vw * 1.4).toFixed(0);
    const dur = ((heavy ? 0.82 : 1.04) - intensity * 0.16 + rng() * 0.5).toFixed(2);
    const delay = (rng() * 2.5).toFixed(2);
    const op = ((heavy ? 0.42 : 0.28) + intensity * 0.22 + rng() * 0.22).toFixed(2);
    const len = Math.round((heavy ? 22 : 14) + intensity * 14 + rng() * (heavy ? 20 : 12));
    const dx = heavy ? 22 + intensity * 7 : 16 + intensity * 5;
    const w = heavy ? 1.55 + intensity * 0.35 : 1.18 + intensity * 0.28;
    out += `<line x1="${x}" y1="0" x2="${Number(x) + dx}" y2="${len}" class="sky-rain" style="animation-delay:-${delay}s;animation-duration:${dur}s" stroke="rgba(160,185,215,${op})" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  return out;
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

window.addEventListener("resize", () => {
  if (state.skyCode !== null && state.theme === "auto") {
    const el = document.getElementById("skyCanvas");
    if (el) renderSkyScene(el, state.skyState?.condition || skyCondition(state.skyCode), state.skyState?.isDay ?? state.skyIsDay, state.skyState);
  }
});

function refreshSkyForLiveTime() {
  if (state.skyCode === null || state.theme !== "auto" || !state.forecast) return;
  const truth = buildWeatherTruth(state.forecast);
  const display = truth.display;
  state.skyCode = truth.code;
  const nextSkyState = deriveSkyState(truth.code, truth.isDay, state.forecast, display);
  const dayChanged = state.locationIsDay !== nextSkyState.isDay;
  syncWeatherTruthDaylight(truth, nextSkyState.isDay);
  state.weatherTruth = truth;
  state.skyState = nextSkyState;
  state.skyIsDay = truth.isDay;
  state.locationIsDay = truth.isDay;
  updateHeroWeatherIcon(truth.code, truth.isDay);
  updateCurrentHourlyWeatherIcon(truth);
  updateWeatherTruthReceipt(truth);
  renderMapLegend();
  if (dayChanged) {
    applyTheme();
    return;
  }
  updateSkyCanvas(truth.code, truth.isDay, state.forecast, display);
}

window.setInterval(refreshSkyForLiveTime, 60 * 1000);

/* ---------- Day-detail bottom sheet ---------- */

let dayDetailNavState = null;

// Collect a single day's hours from the retained forecast and open the sheet.
function openDayFromIndex(i, options = {}) {
  const data = state.forecast;
  if (!data) return;
  if (!Number.isInteger(i) || i < 0 || i >= (data.daily?.time?.length || 0)) return;
  const dayStr = data.daily.time[i];
  const indices = [];
  data.hourly.time.forEach((t, h) => { if (t.startsWith(dayStr)) indices.push(h); });
  const code = representativeDailyCode(data, i);
  const memoryItems = activePlanMemoryEventsForDay(i, data);
  const memoryEvent = planMemoryDetailEventForDay(memoryItems, data);
  openDayDetail({
    indices,
    title: formatDay(data.daily.time[i], i),
    contextLabel: planMemoryDayContextLabel(memoryItems, memoryEvent),
    code,
    stormPotential: hasThunderPotentialForDay(data, i, code),
    isDay: true,
    sunriseISO: data.daily.sunrise[i],
    sunsetISO: data.daily.sunset[i],
    dayIndex: i,
    initialMode: options.initialMode || (memoryEvent ? "hourly" : getDayDetailMode()),
    persistInitialMode: options.persistInitialMode ?? false,
    showNow: i === 0,
    eventWindow: memoryEvent,
    source: "day"
  });
  if (memoryEvent) scrollFocusedSheetHour();
}

// Rolling next-24-hours window from "now".
function rollingHourlyRows(data) {
  const h = data?.hourly;
  if (!h?.time?.length) return [];
  const now = forecastNowMs(data);
  return h.time
    .map((time, index) => ({ time, index, ms: parseForecastTimestamp(time, data) }))
    .filter((row) => row.ms !== null && row.ms >= now - 60 * 60 * 1000);
}

function rollingWindowTitle(block = 0) {
  if (block <= 0) return "Next 24 Hours";
  return `${block * 24}-${(block + 1) * 24} Hours Out`;
}

function rollingWindowNavLabel(block = 0) {
  if (block <= 0) return "Next 24 hours";
  return `${block * 24}-${(block + 1) * 24} hours out`;
}

function rollingWindowDayLabel(date, data) {
  const diff = daysFromForecastToday(date, data);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function rollingWindowEndpoint(ms, data) {
  const day = forecastLocalDateFromMs(ms, data);
  return {
    day,
    dayLabel: rollingWindowDayLabel(day, data),
    timeLabel: formatForecastMs(ms, data)
  };
}

function rollingWindowRangeLabel(rows, allRows, data) {
  if (!rows.length) return "";
  const first = rows[0];
  const last = rows[rows.length - 1];
  const allIndex = allRows.findIndex((row) => row.index === last.index);
  const next = allIndex >= 0 ? allRows[allIndex + 1] : null;
  const endMs = next?.ms ?? (last.ms + 60 * 60 * 1000);
  const start = rollingWindowEndpoint(first.ms, data);
  const end = rollingWindowEndpoint(endMs, data);
  if (start.day === end.day) return `${start.dayLabel} ${start.timeLabel}-${end.timeLabel}`;
  return `${start.dayLabel} ${start.timeLabel}-${end.dayLabel} ${end.timeLabel}`;
}

function openNext24Detail(options = {}) {
  const data = state.forecast;
  if (!data) return;
  const { eventWindow = null, contextLabel = "", block = 0 } = options || {};
  const safeBlock = Math.max(0, Math.floor(Number(block) || 0));
  const rows = rollingHourlyRows(data);
  const start = safeBlock * 24;
  const windowRows = rows.slice(start, start + 24);
  if (!windowRows.length) return;
  const indices = windowRows.map((row) => row.index);
  const firstIndex = indices[0];
  const firstDay = datePart(data.hourly.time[firstIndex]);
  const firstDayIndex = Math.max(0, data.daily?.time?.findIndex((time) => datePart(time) === firstDay) ?? 0);
  const displayCondition = currentDisplayCondition(data);
  const code = safeBlock === 0 ? displayCondition.code : representativeHourlyCodeForIndices(data, indices);
  const firstHourIsDay = data.hourly.is_day ? Boolean(data.hourly.is_day[firstIndex]) : displayCondition.isDay;
  const rangeLabel = rollingWindowRangeLabel(windowRows, rows, data);
  const detailContext = [rangeLabel, contextLabel].filter(Boolean).join(" · ");
  openDayDetail({
    indices,
    title: rollingWindowTitle(safeBlock),
    code,
    stormPotential: hasThunderPotentialForIndices(data, indices, code),
    isDay: safeBlock === 0 ? displayCondition.isDay : firstHourIsDay,
    sunriseISO: data.daily.sunrise[firstDayIndex],
    sunsetISO: data.daily.sunset[firstDayIndex],
    dayIndex: firstDayIndex,
    initialMode: "hourly",
    persistInitialMode: false,
    showNow: safeBlock === 0,
    eventWindow,
    contextLabel: detailContext,
    source: "rolling",
    navState: {
      block: safeBlock,
      canPrev: safeBlock > 0,
      canNext: start + 24 < rows.length,
      label: rollingWindowNavLabel(safeBlock)
    }
  });
  if (eventWindow) scrollFocusedSheetHour();
}

function openHourlyStripDetail(hourIndex) {
  const data = state.forecast;
  const index = Number(hourIndex);
  if (!data || !Number.isInteger(index) || !data.hourly?.time?.[index]) {
    openNext24Detail();
    return;
  }
  const startMs = parseForecastTimestamp(data.hourly.time[index], data);
  if (startMs === null) {
    openNext24Detail();
    return;
  }
  const nextMs = data.hourly.time[index + 1]
    ? parseForecastTimestamp(data.hourly.time[index + 1], data)
    : null;
  const label = isCurrentHour(data.hourly.time[index], data) ? "Now" : formatHour(data.hourly.time[index]);
  openNext24Detail({
    eventWindow: {
      startMs,
      endMs: nextMs && nextMs > startMs ? nextMs : startMs + 60 * 60 * 1000,
      badgeLabel: label,
      label: `${label} detail`
    },
    contextLabel: `${label} focus`
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
  updateSheetDayNav(normalized);

  if (!isHourly) scheduleGraphCalloutReflow();
  if (persist) localStorage.setItem(DAY_DETAIL_MODE_KEY, normalized);
}

function updateSheetDayNav(mode = getDayDetailMode()) {
  const nav = document.getElementById("sheetDayNav");
  if (!nav) return;
  const prev = document.getElementById("sheetPrevDay");
  const next = document.getElementById("sheetNextDay");
  const label = document.getElementById("sheetDayNavLabel");
  const data = dayDetailNavState?.data || state.forecast;
  const dayIndex = dayDetailNavState?.dayIndex;
  const dayCount = data?.daily?.time?.length || 0;
  const isHourly = mode === "hourly";
  const isRolling = dayDetailNavState?.source === "rolling";
  const isDay = dayDetailNavState?.source === "day";
  const canPageDay = isDay && Number.isInteger(dayIndex) && dayCount > 1;
  const canPageRolling = isRolling && (dayDetailNavState.canPrev || dayDetailNavState.canNext);
  const canPage = canPageDay || canPageRolling;
  nav.hidden = !(isHourly && canPage);
  if (!canPage) return;

  nav.classList.toggle("is-rolling", isRolling);
  const canPrev = isRolling ? Boolean(dayDetailNavState.canPrev) : dayIndex > 0;
  const canNext = isRolling ? Boolean(dayDetailNavState.canNext) : dayIndex < dayCount - 1;
  if (prev) {
    prev.textContent = isRolling ? "Earlier" : "‹";
    prev.disabled = !canPrev;
    prev.setAttribute("aria-disabled", String(!canPrev));
    prev.setAttribute("aria-label", isRolling ? "Earlier 24-hour window" : "Previous day");
  }
  if (next) {
    next.textContent = isRolling ? "Later" : "›";
    next.disabled = !canNext;
    next.setAttribute("aria-disabled", String(!canNext));
    next.setAttribute("aria-label", isRolling ? "Later 24-hour window" : "Next day");
  }
  if (label) {
    label.textContent = isRolling
      ? (dayDetailNavState.label || "Next 24 hours")
      : formatDay(data.daily.time[dayIndex], dayIndex);
  }
}

function navigateSheetDay(delta) {
  const stateForNav = dayDetailNavState;
  if (!stateForNav) return;
  if (stateForNav.source === "rolling") {
    const nextBlock = (stateForNav.block || 0) + delta;
    if (nextBlock < 0) return;
    if (delta < 0 && !stateForNav.canPrev) return;
    if (delta > 0 && !stateForNav.canNext) return;
    openNext24Detail({ block: nextBlock });
    return;
  }
  if (stateForNav.source !== "day") return;
  const nextIndex = stateForNav.dayIndex + delta;
  const dayCount = stateForNav.data?.daily?.time?.length || 0;
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= dayCount) return;
  openDayFromIndex(nextIndex, {
    initialMode: "hourly",
    persistInitialMode: false
  });
}

function openDayDetail({
  indices,
  title,
  code,
  stormPotential = false,
  isDay,
  sunriseISO,
  sunsetISO,
  dayIndex = 0,
  initialMode = getDayDetailMode(),
  persistInitialMode = false,
  showNow = false,
  data = state.forecast,
  alerts = activeAlerts,
  eventWindow = null,
  contextLabel = "",
  source = "day",
  navState = null
}) {
  if (!data || !indices.length) return;
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const eventWindows = detailEventWindows(eventWindow);

  const hrs = indices.map((h) => {
    const rawCode = data.hourly.weather_code[h];
    const pop = data.hourly.precipitation_probability[h] || 0;
    const cloud = data.hourly.cloud_cover ? data.hourly.cloud_cover[h] : null;
    const precip = data.hourly.precipitation[h] || 0;
    const code = effectiveWeatherCode(rawCode, pop, cloud, precip, { data });
    const ms = parseForecastTimestamp(data.hourly.time[h], data);
    const nextMs = indices.includes(h + 1)
      ? parseForecastTimestamp(data.hourly.time[h + 1], data)
      : ms !== null ? ms + 60 * 60 * 1000 : null;
    const matchedEventWindows = matchingDetailEventWindows(eventWindows, ms, nextMs);
    const inEvent = Boolean(matchedEventWindows.length);
    const eventMemoryIds = matchedEventWindows.map((window) => window.memoryId).filter(Boolean);
    const hourIsDay = data.hourly.is_day ? Boolean(data.hourly.is_day[h]) : true;
    const isNowHour = showNow && isCurrentHour(data.hourly.time[h], data);
    return {
      time: data.hourly.time[h],
      ms,
      endMs: nextMs,
      temp: data.hourly.temperature_2m[h],
      feels: data.hourly.apparent_temperature[h],
      pop,
      precip,
      wind: data.hourly.wind_speed_10m[h],
      gust: data.hourly.wind_gusts_10m[h],
      uv: data.hourly.uv_index[h] || 0,
      rawCode,
      code,
      stormPotential: hasThunderPotential(rawCode, pop, code, precip, data),
      alert: ms !== null && nextMs !== null ? topAlertForRange(ms, nextMs, alerts) : null,
      inEvent,
      eventLabel: inEvent ? detailEventBadgeLabel(matchedEventWindows, eventWindow) : "",
      eventMemoryIds,
      isDay: isNowHour ? (state.weatherTruth?.isDay ?? currentLocalDaylightIsDay(data, hourIsDay)) : hourIsDay
    };
  });

  const temps = hrs.map((h) => h.temp);
  const high = Math.round(Math.max(...temps));
  const low = Math.round(Math.min(...temps));

  document.getElementById("sheetTitle").textContent = title;
  const sheetContext = document.getElementById("sheetContext");
  if (sheetContext) {
    sheetContext.textContent = contextLabel || "";
    sheetContext.hidden = !contextLabel;
  }
  document.getElementById("sheetIcon").classList.toggle("weather-icon-with-badge", stormPotential);
  document.getElementById("sheetIcon").innerHTML = weatherIcon(code, isDay) + (stormPotential ? thunderBadgeHtml() : "");
  document.getElementById("sheetHigh").textContent = `${high}${degree(tempUnit)}`;
  document.getElementById("sheetLow").textContent = `${low}${degree(tempUnit)}`;
  document.getElementById("sheetSummary").textContent = buildDaySummary(hrs, windUnit);

  graphMetric = "temp"; // each open defaults to Temp (with the Feels-like overlay)
  dayDetailNavState = { source, dayIndex, data, ...(navState || {}) };
  buildHourlyGraph(hrs, tempUnit, windUnit, showNow, { dayIndex, sunriseISO, sunsetISO, data, eventWindow });
  renderHourlyList(hrs, tempUnit, windUnit, precipUnit, { showNow, data, eventWindow });
  renderSheetStats(hrs, { sunriseISO, sunsetISO, windUnit, precipUnit });
  setDayDetailMode(initialMode, persistInitialMode);

  const backdrop = document.getElementById("dayDetailBackdrop");
  const sheet = document.getElementById("dayDetail");
  backdrop.hidden = false;
  sheet.hidden = false;
  showSheet(backdrop, sheet);
  document.body.style.overflow = "hidden";
}

function closeDayDetail() {
  const backdrop = document.getElementById("dayDetailBackdrop");
  const sheet = document.getElementById("dayDetail");
  const returnToPlanner = plannerReturnAfterDayDetail;
  plannerReturnAfterDayDetail = null;
  dayDetailNavState = null;
  backdrop.classList.remove("show");
  sheet.classList.remove("show");
  document.body.style.overflow = returnToPlanner ? "hidden" : "";
  setTimeout(() => {
    backdrop.hidden = true;
    sheet.hidden = true;
    if (returnToPlanner) {
      openAISheet({ restoreScroll: returnToPlanner.scrollTop, autoBrief: false });
    }
  }, 260);
}

function buildDaySummary(hrs, windUnit) {
  const maxPop = Math.max(...hrs.map((h) => h.pop));
  const maxGust = Math.round(Math.max(...hrs.map((h) => h.gust)));
  const thunder = hrs.some((h) => isThunderCode(h.code) || h.stormPotential);
  const parts = [];
  if (thunder) parts.push(`Thunder possible${maxPop >= 20 ? `, up to ${maxPop}% rain` : ""}`);
  else if (maxPop >= 50) parts.push(`Rain likely, up to ${maxPop}% chance`);
  else if (maxPop >= 20) parts.push(`Slight chance of rain (${maxPop}%)`);
  else parts.push("Mostly dry");
  if (maxGust >= 25) parts.push(`gusts to ${maxGust} ${windUnit}`);
  return parts.join(", ") + ".";
}

function hourlyRowSignals(hour, tempUnit, windUnit, precipUnit) {
  const deg = degree(tempUnit);
  const feelsDelta = Math.round(hour.feels - hour.temp);
  const windy = hour.gust >= 20 && hour.gust >= hour.wind + 5;
  const signals = [];

  if (hour.alert) {
    signals.push({ label: alertToneLabel(alertTone(hour.alert)), tone: ` is-alert is-alert-${alertTone(hour.alert)}` });
  }

  if (hour.stormPotential) {
    signals.push({ label: "Thunder", tone: " is-storm" });
  }

  if (hour.pop >= 20) {
    signals.push({ label: `${hour.pop}% rain`, tone: hour.pop >= 40 ? " is-wet" : "" });
  }

  if (hour.precip > 0.02) {
    signals.push({ label: `${formatAmount(hour.precip)} ${precipUnit}`, tone: " is-flag" });
  } else if (windy) {
    signals.push({ label: `Gust ${Math.round(hour.gust)}`, tone: " is-wind" });
  } else if (hour.uv >= 6) {
    signals.push({ label: `UV ${Math.round(hour.uv)}`, tone: " is-flag" });
  } else if (Math.abs(feelsDelta) >= 6) {
    signals.push({ label: `Feels ${feelsDelta > 0 ? "+" : ""}${feelsDelta}${deg}`, tone: " is-flag" });
  }

  if (signals.length < 2) {
    signals.push({ label: `${Math.round(hour.wind)} ${windUnit}`, tone: "" });
  }

  return signals.slice(0, 2);
}

function hourlyDetailNote(hour, tempUnit, windUnit) {
  const alertNote = hour.alert ? hourlyAlertDetailNote(hour.alert) : "";
  let weatherNote = "";
  if (isThunderCode(hour.code) || hour.stormPotential) {
    const stormCode = hour.rawCode || hour.code;
    const hail = stormCode === 96 || stormCode === 99 ? " Hail is also possible." : "";
    weatherNote = isThunderCode(hour.code)
      ? `Watch for lightning and quick downpours.${hail}`
      : `Thunder possible. Watch for lightning and quick downpours.${hail}`;
  } else if (isPrecipCode(hour.code)) {
    const likelihood = hour.pop >= 50 ? "Likely" : "Possible";
    const burst = hour.code === 65 || hour.code === 67 || hour.code === 82 || hour.code === 86
      ? " Brief heavier bursts are possible."
      : "";
    weatherNote = `${likelihood} through this hour.${burst}`;
  } else if (hour.pop >= 50) {
    weatherNote = "Rain likely through this hour.";
  } else if (hour.gust >= 25) {
    weatherNote = `Gusts near ${Math.round(hour.gust)} ${windUnit}.`;
  } else if (hour.uv >= 6) {
    weatherNote = `High UV. Sunscreen helps outdoors.`;
  } else {
    const feelsDelta = Math.round(hour.feels - hour.temp);
    weatherNote = Math.abs(feelsDelta) >= 6
      ? `Feels ${Math.abs(feelsDelta)}${degree(tempUnit)} ${feelsDelta > 0 ? "warmer" : "cooler"} than the air temp.`
      : "No major weather flags.";
  }

  if (!alertNote) return weatherNote;
  if (weatherNote === "No major weather flags.") return alertNote;
  return `${alertNote} ${weatherNote}`;
}

function hourlyAlertDetailNote(alert) {
  const tone = alertTone(alert);
  const event = alert?.event || alertToneLabel(tone);
  if (tone === "warning") return `${event} active. Check alert details and follow local guidance.`;
  if (tone === "watch") return `${event} active. Stay weather aware.`;
  if (tone === "advisory") return `${event} active.`;
  return `${event} active for this hour.`;
}

function toggleSheetHourRow(row) {
  const list = document.getElementById("sheetHourlyList");
  const shouldOpen = !row.classList.contains("is-expanded");
  list.querySelectorAll(".sheet-hour-row.is-expanded").forEach((openRow) => {
    setSheetHourRowExpanded(openRow, false);
  });
  if (shouldOpen) setSheetHourRowExpanded(row, true);
}

function setSheetHourRowExpanded(row, expanded) {
  row.classList.toggle("is-expanded", expanded);
  row.setAttribute("aria-expanded", String(expanded));
  const detail = row.querySelector(".sheet-hour-detail");
  if (detail) detail.hidden = !expanded;
}

function isCurrentHour(time, data = state.forecast) {
  const target = localDateTimeParts(time);
  const current = localDateTimeParts(data?.current?.time);
  if (target && current) {
    return target.year === current.year &&
      target.month === current.month &&
      target.day === current.day &&
      target.hour === current.hour;
  }
  const targetMs = parseForecastTimestamp(time, data);
  const now = forecastNowMs(data);
  return targetMs !== null && Math.abs(targetMs - now) < 1800000;
}

function plannerEventFocusIndex(hrs) {
  let best = -1;
  let bestScore = -Infinity;
  hrs.forEach((hour, index) => {
    if (!hour.inEvent) return;
    const score =
      (hour.alert ? 500 + alertPriority(hour.alert) : 0) +
      (hour.stormPotential ? 260 : 0) +
      (hour.pop || 0) * 2 +
      Math.max(0, (hour.gust || 0) - 18) * 8 +
      Math.max(0, (hour.uv || 0) - 5) * 14 +
      (hour.precip || 0) * 80;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function renderHourlyList(hrs, tempUnit, windUnit, precipUnit, options = {}) {
  const opts = typeof options === "boolean" ? { showNow: options } : (options || {});
  const { showNow = false, data = state.forecast, eventWindow = null } = opts;
  const deg = degree(tempUnit);
  const list = document.getElementById("sheetHourlyList");
  const defaultExpandedIndex = eventWindow ? plannerEventFocusIndex(hrs) : -1;
  let prevDay = null;
  list.innerHTML = hrs.map((hour, rowIndex) => {
    // Mark where the day rolls over (the list runs from "now" into tomorrow).
    const dayKey = hour.time.slice(0, 10);
    const divider = prevDay && dayKey !== prevDay
      ? `<div class="sheet-day-divider"><span>${escapeHtml(dayDividerLabel(hour.time))}</span></div>`
      : "";
    prevDay = dayKey;
    const condition = weatherCodes[hour.code] || "Weather";
    const signals = hourlyRowSignals(hour, tempUnit, windUnit, precipUnit);
    const detailNote = hourlyDetailNote(hour, tempUnit, windUnit);
    const windy = hour.gust >= 20 && hour.gust >= hour.wind + 5;
    const now = showNow && isCurrentHour(hour.time, data);
    const rainClass = hour.pop >= 40 ? " is-rainy" : "";
    const uvClass = hour.uv >= 6 ? " is-sunny" : "";
    const windClass = hour.gust >= 25 ? " is-windy" : "";
    const stormClass = hour.stormPotential ? " is-stormy" : "";
    const alertClass = hour.alert ? ` has-alert is-alert-${alertTone(hour.alert)}` : "";
    const nowClass = now ? " is-now" : "";
    const eventClass = hour.inEvent ? " is-plan-window" : "";
    const expanded = rowIndex === defaultExpandedIndex;
    const eventBadge = hour.inEvent ? escapeHtml(hour.eventLabel || "Plan") : "";
    const eventBadgeHtml = hour.inEvent
      ? hour.eventMemoryIds?.length
        ? `<button class="sheet-plan-badge" type="button" data-memory-detail="${escapeHtml(hour.eventMemoryIds.join(","))}" aria-label="${escapeHtml(`Show memory details for ${hour.eventLabel || "plan"}`)}">${eventBadge}</button>`
        : `<span class="sheet-plan-badge">${eventBadge}</span>`
      : "";
    const signalChips = signals.map((signal) => `<span class="sheet-hour-chip${signal.tone}">${escapeHtml(signal.label)}</span>`).join("");
    const detailId = `sheet-hour-detail-${rowIndex}`;
    const rowLabel = `${formatHour(hour.time)} ${condition}${hour.eventLabel ? `, memory ${hour.eventLabel}` : ""}${hour.stormPotential ? ", thunder possible" : ""}${hour.alert ? `, ${hour.alert.event}` : ""}, ${Math.round(hour.temp)}${deg}, ${signals.map((signal) => signal.label).join(", ")}`;
    return `${divider}
      <article class="sheet-hour-row${rainClass}${uvClass}${windClass}${stormClass}${alertClass}${nowClass}${eventClass}${expanded ? " is-expanded" : ""}" role="button" tabindex="0" aria-label="${escapeHtml(rowLabel)}" aria-expanded="${expanded}" aria-controls="${detailId}">
        <div class="sheet-hour-time">${formatHour(hour.time)}${now ? `<span class="sheet-now-badge">Now</span>` : ""}${eventBadgeHtml}</div>
        <div class="sheet-hour-icon weather-icon-with-badge" aria-hidden="true">${weatherIcon(hour.code, hour.isDay, { density: "dense" })}${hour.stormPotential ? thunderBadgeHtml() : ""}</div>
        <div class="sheet-hour-main">
          <strong>${Math.round(hour.temp)}${deg}</strong>
        </div>
        <div class="sheet-hour-signals">
          ${signalChips}
          <span class="sheet-hour-cue" aria-hidden="true"></span>
        </div>
        <div class="sheet-hour-detail" id="${detailId}"${expanded ? "" : " hidden"}>
          <h3 class="sheet-hour-detail-condition">${escapeHtml(condition)}</h3>
          <p>${escapeHtml(detailNote)}</p>
          <div class="sheet-hour-detail-grid">
            <span><small>Feels</small><strong>${Math.round(hour.feels)}${deg}</strong></span>
            <span><small>Rain</small><strong>${hour.pop}%</strong></span>
            <span><small>Precip</small><strong>${hour.precip > 0 ? `${formatAmount(hour.precip)} ${precipUnit}` : `0 ${precipUnit}`}</strong></span>
            <span><small>Wind</small><strong>${Math.round(hour.wind)} ${windUnit}</strong></span>
            <span><small>Gust</small><strong>${Math.round(hour.gust)} ${windUnit}</strong></span>
            <span><small>UV</small><strong>${Math.round(hour.uv)}</strong></span>
          </div>
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
  graphMetric = metric === "wind" || metric === "sun" ? metric : "temp";
  if (graphCtx) drawHourlyGraph();
}

function buildHourlyGraph(hrs, tempUnit, windUnit, showNow = false, options = {}) {
  graphCtx = { hrs, tempUnit, windUnit, showNow, ...options };
  drawHourlyGraph();
}

function drawHourlyGraph() {
  if (!graphCtx) return;
  const perf = perfStart();
  const { hrs, tempUnit, windUnit, showNow, data = state.forecast } = graphCtx;
  const isWind = graphMetric === "wind";
  const isSun = graphMetric === "sun";

  // Reflect the active metric in the toggle + hint.
  const tempBtn = document.getElementById("graphTempBtn");
  const windBtn = document.getElementById("graphWindBtn");
  const sunBtn = document.getElementById("graphSunBtn");
  const hint = document.getElementById("graphMetricHint");
  if (tempBtn && windBtn && sunBtn) {
    tempBtn.classList.toggle("active", !isWind && !isSun);
    windBtn.classList.toggle("active", isWind);
    sunBtn.classList.toggle("active", isSun);
    tempBtn.setAttribute("aria-pressed", String(!isWind && !isSun));
    windBtn.setAttribute("aria-pressed", String(isWind));
    sunBtn.setAttribute("aria-pressed", String(isSun));
  }
  if (hint) hint.textContent = isSun ? "orange = higher UV" : isWind ? "dashed = gusts" : "dashed = feels like";
  if (isSun) {
    drawSunGraph();
    perfEnd("drawHourlyGraph", perf);
    return;
  }
  document.getElementById("sheetReadout")?.classList.remove("is-sun");

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
  const firstMs = parseForecastTimestamp(hrs[0].time, data);
  const lastMs = parseForecastTimestamp(hrs[n - 1].time, data);
  const graphEndMs = firstMs !== null && lastMs !== null && lastMs > firstMs
    ? lastMs
    : firstMs !== null ? firstMs + 60 * 60 * 1000 : null;
  const xForMs = (ms) => {
    if (firstMs === null || graphEndMs === null || graphEndMs <= firstMs) return padL + plotW / 2;
    return padL + ((clamp(ms, firstMs, graphEndMs) - firstMs) / (graphEndMs - firstMs)) * plotW;
  };
  const memoryWindows = graphMemoryWindows(hrs, data, graphCtx.eventWindow);
  const memoryBands = renderGraphMemoryBands(memoryWindows, xForMs, {
    top: tempTop,
    bottom: precipBottom,
    labelY: precipTop - 6,
    data
  });
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

  const nowMs = forecastNowMs(data);
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
      ${memoryBands}
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
    const activeMemory = graphMemoryAtMs(p.ms ?? parseForecastTimestamp(p.time, data), memoryWindows);
    const subText = activeMemory ? `During ${activeMemory.label} · ${sub}` : sub;
    callout.innerHTML =
      `<span class="callout-main">${escapeHtml(main)}</span><span class="callout-sub">${escapeHtml(subText)}</span>`;

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
  const now = forecastNowMs(data);
  let def = hrs.findIndex((h) => {
    const ms = parseForecastTimestamp(h.time, data);
    return ms !== null && Math.abs(ms - now) < 1800000;
  });
  if (def < 0) def = 0;
  // Defer to next frame so the sheet has laid out and the callout can be
  // measured/positioned correctly (it's still hidden when this runs).
  graphActiveIndex = def;
  scheduleGraphCalloutReflow();
  perfEnd("drawHourlyGraph", perf);
}

function drawSunGraph() {
  if (!graphCtx) return;
  const perf = perfStart();
  const { hrs, dayIndex = 0, sunriseISO, sunsetISO, showNow, data = state.forecast } = graphCtx;
  const sunriseMs = sunriseISO ? parseForecastTimestamp(sunriseISO, data) : null;
  const sunsetMs = sunsetISO ? parseForecastTimestamp(sunsetISO, data) : null;
  const tomorrowSunriseISO = data?.daily?.sunrise?.[dayIndex + 1];
  const tomorrowSunriseMs = tomorrowSunriseISO ? parseForecastTimestamp(tomorrowSunriseISO, data) : null;
  const fallbackUv = Math.round(data?.daily?.uv_index_max?.[dayIndex] || Math.max(...hrs.map((h) => h.uv || 0), 0));
  const uv = sunRiskWindow(data, sunriseMs, sunsetMs, fallbackUv, dayIndex);
  const chart = sunChartGeometry(data, sunriseMs, sunsetMs, tomorrowSunriseMs, dayIndex);
  const callout = document.getElementById("sheetReadout");
  const wrap = document.getElementById("sheetGraphWrap");
  const graph = document.getElementById("sheetGraph");
  if (!chart) {
    graph.innerHTML = `<div class="sheet-empty">Sun data unavailable.</div>`;
    callout.innerHTML = "";
    callout.classList.remove("is-sun");
    perfEnd("drawSunGraph", perf);
    return;
  }

  const VW = chart.width;
  const showUvBand = uv.showBand && uv.startMs && uv.endMs && uv.endMs > uv.startMs;
  const nightPath = chart.mode === "polar-day" ? "" : sunPathSegment(chart, chart.dayStartMs, chart.dayEndMs, 96);
  const dayPath = chart.mode === "polar-night" ? "" : sunPathSegment(chart, chart.daylightStartMs, chart.daylightEndMs, 64);
  const uvPath = showUvBand ? sunPathSegment(chart, uv.startMs, uv.endMs, 24) : "";
  const peakMs = uv.peakMs || sunPeakMs(chart);
  const peakPoint = peakMs ? sunPathPoint(chart, peakMs) : null;
  const nowMs = forecastNowMs(data);
  const nowPoint = sunPathPoint(chart, nowMs);
  const nowMarker = showNow && nowMs >= chart.dayStartMs && nowMs <= chart.dayEndMs ? `
    <g>
      <line x1="${roundSvg(nowPoint.x)}" y1="12" x2="${roundSvg(nowPoint.x)}" y2="122" class="graph-now-line"/>
      <rect x="${roundSvg(clamp(nowPoint.x - 16, 0, chart.width - 32))}" y="4" width="32" height="16" rx="8" class="graph-now-pill"/>
      <text x="${roundSvg(nowPoint.x)}" y="15" text-anchor="middle" class="graph-now-label">Now</text>
    </g>
  ` : "";
  const uvMarker = peakPoint && uv.showMarker ? `
    <circle cx="${roundSvg(peakPoint.x)}" cy="${roundSvg(peakPoint.y)}" r="3.2" class="sun-uv-dot"/>
  ` : "";
  const activeMs = showNow ? nowMs : parseForecastTimestamp(hrs[0]?.time, data) ?? chart.daylightStartMs;
  const memoryWindows = graphMemoryWindows(hrs, data, graphCtx.eventWindow);
  const sunXForMs = (ms) => sunPathPoint(chart, clamp(ms, chart.dayStartMs, chart.dayEndMs)).x;
  const memoryBands = renderGraphMemoryBands(memoryWindows, sunXForMs, {
    top: 12,
    bottom: 122,
    labelY: 25,
    minLabelWidth: 42,
    data
  });

  graphPts = buildDaylightScrubPoints(data, chart);
  graphActiveIndex = nearestGraphSunIndexByMs(activeMs);
  graphUpdateActive = null;

  graph.innerHTML = `
    <svg viewBox="0 0 ${VW} 152" class="hourly-graph sun-graph uv-${uv.severity}">
      <line class="daylight-horizon" x1="${chart.left}" y1="${chart.horizonY}" x2="${chart.right}" y2="${chart.horizonY}"></line>
      <path class="daylight-night-arc" d="${nightPath}"></path>
      <path class="daylight-fill" d="${dayPath}"></path>
      <path class="daylight-uv-band" d="${uvPath}" ${showUvBand ? "" : "hidden"}></path>
      ${uvMarker}
      ${nowMarker}
      <text x="${chart.left}" y="148" text-anchor="start" class="graph-axis">${escapeHtml(chart.mode === "normal" && sunriseISO ? formatTime(sunriseISO) : chart.mode === "polar-day" ? "All day" : "No sunrise")}</text>
      <text x="${chart.right}" y="148" text-anchor="end" class="graph-axis">${escapeHtml(chart.mode === "normal" && sunsetISO ? formatTime(sunsetISO) : chart.mode === "polar-day" ? "No sunset" : "No sunset")}</text>
      <line id="graphGuide" x1="0" y1="12" x2="0" y2="122" stroke="var(--ink)" stroke-width="1" stroke-dasharray="3 3" opacity="0.4" style="display:none"/>
      <circle id="graphDot" r="4.5" fill="var(--ink)" style="display:none"/>
      <rect id="graphHit" x="0" y="0" width="${VW}" height="136" fill="transparent" style="cursor:crosshair"/>
      ${memoryBands}
    </svg>
  `;

  const svg = graph.querySelector("svg");
  const guide = svg.querySelector("#graphGuide");
  const dot = svg.querySelector("#graphDot");

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

    const copy = daylightReadoutCopy(p, data, chart, uv);
    const activeMemory = graphMemoryAtMs(p.ms, memoryWindows);
    const meta = activeMemory ? `During ${activeMemory.label} · ${copy.meta}` : copy.meta;
    callout.classList.add("is-sun");
    callout.innerHTML =
      `<span class="callout-main">${escapeHtml(copy.time)} · ${escapeHtml(copy.title)}</span><span class="callout-sub">${escapeHtml(meta)}</span>`;

    const wrapWidth = wrap.clientWidth;
    const cw = callout.offsetWidth;
    if (!wrapWidth || !cw) return;
    const px = (p.x / VW) * wrapWidth;
    const minLeft = cw / 2 + 2;
    const maxLeft = Math.max(minLeft, wrapWidth - cw / 2 - 2);
    const left = clamp(px, minLeft, maxLeft);
    const pointerX = clamp(px - (left - cw / 2), 8, cw - 8);
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
  scheduleGraphCalloutReflow();
  perfEnd("drawSunGraph", perf);
}

function nearestGraphSunIndexByMs(ms) {
  if (!graphPts.length) return 0;
  let best = 0, bd = Infinity;
  graphPts.forEach((point, index) => {
    const d = Math.abs(point.ms - ms);
    if (d < bd) { bd = d; best = index; }
  });
  return best;
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
const ALERT_TONE_RANK = { warning: 4, watch: 3, advisory: 2, notice: 1 };
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

function renderAlerts(alerts) {
  activeAlerts = alerts || [];
  const bar = document.getElementById("alertBar");
  if (!activeAlerts.length) {
    bar.hidden = true;
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

function openAlertSheet() {
  if (!activeAlerts.length) return;
  const top = activeAlerts[0];
  const sheet = document.getElementById("alertSheet");
  sheet.className = `day-sheet alert-sheet ${alertSeverityClass(top.severity)} ${alertMotionClass(top)}`.trim();
  document.getElementById("alertSheetKicker").textContent = alertSeverityLabel(top.severity);
  document.getElementById("alertSheetTitle").textContent = top.event;
  document.getElementById("alertSheetSummary").textContent = [
    alertWindow(top),
    activeAlerts.length > 1 ? alertCountLabel(activeAlerts.length) : ""
  ].filter(Boolean).join(" · ");
  document.getElementById("alertList").innerHTML = activeAlerts.map((a) => `
    <article class="alert-item ${alertSeverityClass(a.severity)}">
      ${activeAlerts.length > 1 ? `
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
  showSheet(backdrop, sheet);
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
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
    navigator.serviceWorker.register(new URL("sw.js", window.location.href).pathname)
      .then(registration => registration.update().catch(() => {}))
      .catch(() => {});
  });
}

// Start the app last, after every module-level declaration is initialized,
// so the synchronous startup path can't hit a temporal-dead-zone reference.
init();
