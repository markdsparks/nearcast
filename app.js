const VERSION = "1.0.1";

const state = {
  unit: localStorage.getItem("weather-unit") || "fahrenheit",
  theme: localStorage.getItem("weather-theme") || "auto",
  sunriseMs: null,
  sunsetMs: null,
  view: "forecast",
  activePlace: null,
  savedPlaces: JSON.parse(localStorage.getItem("weather-places") || "[]"),
  searchResults: [],
  skyCode: null,
  skyIsDay: null
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
  _normalEls: null
};

const dragState = {
  active: false,
  startX: 0,
  startY: 0,
  startPanX: 0,
  startPanY: 0
};

const els = {
  themeToggle: document.querySelector("#themeToggle"),
  unitToggle: document.querySelector("#unitToggle"),
  locateButton: document.querySelector("#locateButton"),
  forecastTab: document.querySelector("#forecastTab"),
  mapTab: document.querySelector("#mapTab"),
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

  if (state.savedPlaces.length) {
    loadPlace(state.savedPlaces[0]);
  } else {
    loadPlace({
      id: "springfield-mo",
      name: "Springfield",
      admin1: "Missouri",
      country: "United States",
      latitude: 37.2089,
      longitude: -93.2923
    });
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

  document.addEventListener("click", (event) => {
    const inSearch = els.searchForm.contains(event.target) || els.searchResults.contains(event.target);
    if (!inSearch) clearSearchResults();
  });

  els.unitToggle.addEventListener("click", () => {
    state.unit = state.unit === "fahrenheit" ? "celsius" : "fahrenheit";
    localStorage.setItem("weather-unit", state.unit);
    updateUnitButton();
    if (state.activePlace) loadPlace(state.activePlace);
  });

  els.themeToggle.addEventListener("click", toggleTheme);
  els.locateButton.addEventListener("click", useCurrentLocation);
  els.savePlace.addEventListener("click", () => {
    if (!state.activePlace) return;
    savePlace(state.activePlace);
    setStatus(`${state.activePlace.name} saved.`);
  });
  els.forecastTab.addEventListener("click", () => showView("forecast"));
  els.mapTab.addEventListener("click", () => showView("map"));
  els.radarMode.addEventListener("click", () => setMapMode("radar"));
  els.futureMode.addEventListener("click", () => setMapMode("future"));
  els.zoomOutMap.addEventListener("click", () => setMapZoom(mapState.zoom - 1));
  els.zoomInMap.addEventListener("click", () => setMapZoom(mapState.zoom + 1));
  els.playRadar.addEventListener("click", toggleRadarPlayback);
  els.frameSlider.addEventListener("input", () => showFrame(Number(els.frameSlider.value)));
  document.getElementById("expandMap").addEventListener("click", enterImmersiveMap);
}

function applyTheme() {
  let isDark;
  if (state.theme === "auto") {
    if (state.sunriseMs && state.sunsetMs) {
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

function updateUnitButton() {
  els.unitToggle.textContent = state.unit === "fahrenheit" ? "F" : "C";
  els.unitToggle.title = state.unit === "fahrenheit" ? "Switch to Celsius" : "Switch to Fahrenheit";
}

async function searchPlaces(query) {
  setStatus("Searching places...");
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.search = new URLSearchParams({
      name: query,
      count: "6",
      language: "en",
      format: "json"
    }).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error("Place search failed.");
    const data = await response.json();
    state.searchResults = data.results || [];
    renderSearchResults();
    setStatus(state.searchResults.length ? "" : "No matching places found.", !state.searchResults.length);
  } catch (error) {
    setStatus("Could not search places. Check the connection and try again.", true);
  }
}

function clearSearchResults() {
  state.searchResults = [];
  els.searchResults.hidden = true;
  els.searchResults.innerHTML = "";
  els.placeSearch.value = "";
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
      clearSearchResults();
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

function renderSavedPlaces() {
  els.savedPlaces.innerHTML = "";
  updateSaveButton();

  state.savedPlaces.forEach((place) => {
    const chip = document.createElement("button");
    chip.className = `place-chip${state.activePlace && state.activePlace.id === place.id ? " active" : ""}`;
    chip.type = "button";
    chip.innerHTML = `
      <span>${escapeHtml(place.name)}</span>
      <span class="remove" aria-hidden="true">x</span>
    `;
    chip.addEventListener("click", (event) => {
      if (event.target.classList.contains("remove")) {
        removeSavedPlace(place.id);
      } else {
        loadPlace(place);
      }
    });
    els.savedPlaces.appendChild(chip);
  });
  renderMapMarkers();
}

async function loadPlace(place) {
  state.activePlace = normalizePlace(place);
  mapState.panX = 0;
  mapState.panY = 0;
  renderSavedPlaces();
  updateMapPlace();
  syncMapToPlace();
  setStatus(`Loading ${state.activePlace.name}...`);

  try {
    const data = await fetchForecast(state.activePlace);
    renderForecast(data, state.activePlace);
    setStatus("");
  } catch (error) {
    setStatus("Could not load weather data. Try another place or reload the page.", true);
  }
}

function showView(view) {
  state.view = view;
  els.forecastTab.classList.toggle("active", view === "forecast");
  els.mapTab.classList.toggle("active", view === "map");
  els.forecastView.hidden = view !== "forecast";
  els.mapView.hidden = view !== "map";

  if (view === "map") {
    initMap();
    syncMapToPlace();
    loadMapFrames();
  } else {
    stopRadarPlayback();
  }
}

async function fetchForecast(place) {
  const cacheKey = `forecast:${state.unit}:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
  const maxCacheAge = 15 * 60 * 1000;

  if (cached && Date.now() - cached.savedAt < maxCacheAge) {
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
  const tempUnit = state.unit === "fahrenheit" ? "F" : "C";
  const precipUnit = state.unit === "fahrenheit" ? "in" : "mm";
  const windUnit = state.unit === "fahrenheit" ? "mph" : "km/h";
  const current = data.current;
  const firstRainChance = data.hourly.precipitation_probability[0] ?? data.daily.precipitation_probability_max[0];
  const todayCode = weatherCodes[current.weather_code] || "Weather";

  const isDay = current.is_day !== undefined ? Boolean(current.is_day) : true;
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

  if (data.daily.sunrise[0] && data.daily.sunset[0]) {
    state.sunriseMs = new Date(data.daily.sunrise[0]).getTime();
    state.sunsetMs = new Date(data.daily.sunset[0]).getTime();
    if (state.theme === "auto") applyTheme();
  }

  const heroIcon = document.getElementById("heroIcon");
  if (heroIcon) heroIcon.innerHTML = weatherIcon(current.weather_code, isDay);

  renderInsights(data, windUnit);
  renderHourly(data, tempUnit);
  renderDaily(data, tempUnit, precipUnit);
  updateMapPlace();
  bindMetricTips(data, tempUnit, windUnit);
  updateSkyCanvas(current.weather_code, isDay);
}

function buildSummary(data) {
  const daily = data.daily;
  const now = Date.now();
  const sunriseMs = state.sunriseMs || (daily.sunrise[0] ? new Date(daily.sunrise[0]).getTime() : null);
  const sunsetMs = state.sunsetMs || (daily.sunset[0] ? new Date(daily.sunset[0]).getTime() : null);
  const twoHoursMs = 2 * 60 * 60 * 1000;

  const high0 = Math.round(daily.temperature_2m_max[0]);
  const low0 = Math.round(daily.temperature_2m_min[0]);
  const rain0 = daily.precipitation_probability_max[0] || 0;
  const gust0 = Math.round(daily.wind_gusts_10m_max[0] || data.current.wind_gusts_10m || 0);

  const high1 = Math.round(daily.temperature_2m_max[1]);
  const rain1 = daily.precipitation_probability_max[1] || 0;
  const gust1 = Math.round(daily.wind_gusts_10m_max[1] || 0);

  const rainPhrase = (pct) =>
    pct >= 70 ? "rain is likely" : pct >= 40 ? "rain is possible" : "rain chances stay low";
  const gustPhrase = (g) =>
    g > 0 ? `Gusts may reach ${g}.` : "";

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

function renderInsights(data, windUnit) {
  const now = Date.now();
  const sunsetMs = state.sunsetMs;
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const noonMs = new Date().setHours(12, 0, 0, 0);

  const isEvening = sunsetMs && now >= sunsetMs - twoHoursMs;
  const isMorning = now < noonMs;

  const cards = isEvening
    ? buildEveningInsights(data, windUnit)
    : isMorning
      ? buildMorningInsights(data, windUnit)
      : buildAfternoonInsights(data, windUnit);

  els.insights.innerHTML = cards.map(({ label, value }) => `
    <article class="insight">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join("");
}

function hoursInRange(data, fromMs, toMs) {
  return data.hourly.time
    .map((t, i) => ({ ms: new Date(t).getTime(), i }))
    .filter(({ ms }) => ms >= fromMs && ms < toMs);
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
  const now = Date.now();
  const noonMs = new Date().setHours(12, 0, 0, 0);
  const sixPmMs = new Date().setHours(18, 0, 0, 0);
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
  const now = Date.now();
  const sunsetMs = state.sunsetMs;
  const midnightMs = new Date().setHours(24, 0, 0, 0);
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
  const now = Date.now();
  const midnightMs = new Date().setHours(24, 0, 0, 0);
  const sixAmMs = new Date(now + 86400000).setHours(6, 0, 0, 0);
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
  const now = Date.now();
  const rows = data.hourly.time
    .map((time, index) => ({ time, index }))
    .filter((row) => new Date(row.time).getTime() >= now - 60 * 60 * 1000)
    .slice(0, 24);

  els.hourly.innerHTML = rows.map(({ time, index }) => {
    const rain = data.hourly.precipitation_probability[index] || 0;
    const wcode = data.hourly.weather_code[index];
    const code = weatherCodes[wcode] || "Weather";
    const isHourDay = data.hourly.is_day ? Boolean(data.hourly.is_day[index]) : true;
    return `
      <article class="hour-card">
        <span>${formatHour(time)}</span>
        <strong>${Math.round(data.hourly.temperature_2m[index])}${degree(tempUnit)}</strong>
        <div class="hour-icon" aria-hidden="true">${weatherIcon(wcode, isHourDay)}</div>
        <div class="code">${escapeHtml(code)}</div>
        <span>${rain}% rain</span>
        <div class="rain-bar" aria-hidden="true"><i style="width: ${rain}%"></i></div>
      </article>
    `;
  }).join("");
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
    const width = Math.max(((high - low) / spread) * 100, 8);
    const rain = data.daily.precipitation_probability_max[index] || 0;
    const precip = data.daily.precipitation_sum[index] || 0;
    const wcode = data.daily.weather_code[index];
    const code = weatherCodes[wcode] || "Weather";
    return `
      <article class="day-row">
        <div class="day-label">
          <div class="day-icon" aria-hidden="true">${weatherIcon(wcode, true)}</div>
          <div>
            <div class="day-name">${formatDay(time, index)}</div>
            <div class="day-meta">${escapeHtml(code)}</div>
          </div>
        </div>
        <div class="day-range">${low}${degree(tempUnit)} / ${high}${degree(tempUnit)}</div>
        <div class="temp-track" aria-hidden="true">
          <i style="margin-left: ${start}%; width: ${width}%"></i>
        </div>
        <div class="day-meta">${rain}% rain<br>${formatAmount(precip)} ${precipUnit}</div>
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
}

function bindMapDrag() {
  const el = els.weatherMap;

  function onDragStart(x, y) {
    dragState.active = true;
    dragState.startX = x;
    dragState.startY = y;
    dragState.startPanX = mapState.panX;
    dragState.startPanY = mapState.panY;
    el.style.cursor = "grabbing";
  }

  function onDragMove(x, y) {
    if (!dragState.active) return;
    mapState.panX = dragState.startPanX + (x - dragState.startX);
    mapState.panY = dragState.startPanY + (y - dragState.startY);
    renderTileMap();
  }

  function onDragEnd() {
    if (!dragState.active) return;
    dragState.active = false;
    el.style.cursor = "grab";
  }

  el.addEventListener("mousedown", (e) => { e.preventDefault(); onDragStart(e.clientX, e.clientY); });
  window.addEventListener("mousemove", (e) => onDragMove(e.clientX, e.clientY));
  window.addEventListener("mouseup", onDragEnd);

  el.addEventListener("touchstart", (e) => { const t = e.touches[0]; onDragStart(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener("touchmove", (e) => { const t = e.touches[0]; onDragMove(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener("touchend", onDragEnd);
}

function updateMapPlace() {
  els.mapPlace.textContent = state.activePlace ? `Centered on ${placeLabel(state.activePlace)}` : "Centered on selected place";
}

function syncMapToPlace() {
  if (!mapState.initialized || !state.activePlace) return;
  renderTileMap();
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
  if (state.view !== "map" || !mapState.initialized) return;
  if (!force && mapState.frames.length) {
    showFrame(mapState.frameIndex);
    return;
  }

  setMapLoading(true);
  clearMapLayers();

  try {
    mapState.frames = mapState.mode === "future" ? await fetchNoaaFutureRainFrames() : await fetchRainViewerFrames();

    if (!mapState.frames.length) {
      setFrameLabel(mapState.mode === "future" ? "No NWS forecast frames" : "No radar frames");
      return;
    }

    mapState.frameIndex = mapState.mode === "future" ? 0 : mapState.frames.length - 1;
    els.frameSlider.max = String(mapState.frames.length - 1);
    showFrame(mapState.frameIndex);
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

function getNoaaRegion() {
  const place = state.activePlace;
  if (!place) return "conus";
  const { latitude, longitude } = place;

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

function toggleRadarPlayback() {
  if (!mapState.frames.length) return;
  if (mapState.playing) {
    stopRadarPlayback();
    return;
  }

  mapState.playing = true;
  els.playRadar.textContent = "Pause";
  mapState.timer = window.setInterval(() => {
    const next = mapState.frameIndex >= mapState.frames.length - 1 ? 0 : mapState.frameIndex + 1;
    showFrame(next);
  }, 850);
}

function stopRadarPlayback() {
  mapState.playing = false;
  els.playRadar.textContent = "Play";
  if (mapState.timer) {
    window.clearInterval(mapState.timer);
    mapState.timer = null;
  }
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

function setMapZoom(nextZoom) {
  const newZoom = Math.min(Math.max(nextZoom, 4), 7);
  if (newZoom === mapState.zoom) return;
  const scale = 2 ** (newZoom - mapState.zoom);
  mapState.panX *= scale;
  mapState.panY *= scale;
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
  renderWeatherTiles(viewport);
  renderMapMarkers();
}

function renderWeatherTiles(viewport = null) {
  if (!mapState.initialized || !els.weatherTileLayer) return;
  els.weatherTileLayer.innerHTML = "";
  const frame = mapState.frames[mapState.frameIndex];
  if (!frame || !state.activePlace) return;

  const tileViewport = viewport || getMapViewport();

  const layers = frame.layers || [{ url: frame.url, opacity: 0.78 }];
  layers.forEach((weatherLayer, index) => {
    if (weatherLayer.opacity <= 0.01) return;
    renderTileLayer(els.weatherTileLayer, tileViewport, ({ z, x, y }) => {
      return weatherLayer.url
        .replace("{z}", z)
        .replace("{x}", x)
        .replace("{y}", y)
        .replace("%7Bbbox%7D", tileBbox3857(z, x, y))
        .replace("{bbox}", tileBbox3857(z, x, y));
    }, { append: index > 0, opacity: weatherLayer.opacity });
  });
}

function renderTileLayer(layer, viewport, urlForTile, options = {}) {
  if (!options.append) layer.innerHTML = "";
  const z = mapState.zoom;
  const tileSize = 256;
  const worldTiles = 2 ** z;
  const topLeft = {
    x: viewport.center.x - viewport.width / 2,
    y: viewport.center.y - viewport.height / 2
  };
  const startX = Math.floor(topLeft.x / tileSize);
  const endX = Math.floor((topLeft.x + viewport.width) / tileSize);
  const startY = Math.floor(topLeft.y / tileSize);
  const endY = Math.floor((topLeft.y + viewport.height) / tileSize);

  for (let tileX = startX; tileX <= endX; tileX += 1) {
    for (let tileY = startY; tileY <= endY; tileY += 1) {
      if (tileY < 0 || tileY >= worldTiles) continue;
      const wrappedX = ((tileX % worldTiles) + worldTiles) % worldTiles;
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.loading = "eager";
      img.src = urlForTile({ z, x: wrappedX, y: tileY });
      img.addEventListener("error", () => handleWeatherTileError(layer));
      if (typeof options.opacity === "number") {
        img.style.opacity = String(options.opacity);
      }
      img.style.left = `${Math.round(tileX * tileSize - topLeft.x)}px`;
      img.style.top = `${Math.round(tileY * tileSize - topLeft.y)}px`;
      layer.appendChild(img);
    }
  }
}

function handleWeatherTileError(layer) {
  if (layer !== els.weatherTileLayer || mapState.mode !== "future") return;
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
    (position) => {
      loadPlace({
        id: `gps-${position.coords.latitude.toFixed(3)}-${position.coords.longitude.toFixed(3)}`,
        name: "Current Location",
        admin1: "",
        country: "",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });
    },
    () => setStatus("Location permission was not granted.", true),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
}

function savePlace(place) {
  const normalized = normalizePlace(place);
  if (!state.savedPlaces.some((saved) => saved.id === normalized.id)) {
    state.savedPlaces = [normalized, ...state.savedPlaces].slice(0, 8);
    localStorage.setItem("weather-places", JSON.stringify(state.savedPlaces));
    renderSavedPlaces();
  }
}

function removeSavedPlace(id) {
  state.savedPlaces = state.savedPlaces.filter((place) => place.id !== id);
  localStorage.setItem("weather-places", JSON.stringify(state.savedPlaces));
  renderSavedPlaces();
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

  // Tap: toggle tip. touchstart fires before any synthetic mouse events,
  // so we handle it here and stopPropagation to prevent the click handler below.
  metricsEl.addEventListener("touchstart", (event) => {
    const card = event.target.closest(".has-tip");
    if (!card) return;
    event.preventDefault(); // block the subsequent synthetic click
    if (activeTipCard === card) {
      hideMetricTip();
    } else {
      showMetricTip(card);
    }
  }, { passive: false });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".hero-metrics") && !event.target.closest("#metricTip")) {
      hideMetricTip();
    }
  });
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

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatHour(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(value));
}

function formatDay(value, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
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

  if (immersiveDragAbort) { immersiveDragAbort.abort(); immersiveDragAbort = null; }
  document.removeEventListener("keydown", onImmersiveKey);

  setTimeout(() => { renderTileMap(); renderMapLegend(); }, 40);
}

function onImmersiveKey(e) {
  if (e.key === "Escape") exitImmersiveMap();
}

function updateImmersiveHUD() {
  if (!state.activePlace) return;
  const loc  = document.getElementById("immLocation");
  const temp = document.getElementById("immTemp");
  const icon = document.getElementById("immIcon");
  if (loc)  loc.textContent  = placeLabel(state.activePlace);
  if (temp) temp.textContent = document.getElementById("nowTemp").textContent;
  if (icon) icon.innerHTML   = document.getElementById("heroIcon").innerHTML;
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
  document.getElementById("immSlider").oninput    = (e) => showFrame(Number(e.target.value));
  immRadar.onclick  = () => { setMapMode("radar");  immRadar.classList.add("imm-active");  immFuture.classList.remove("imm-active"); };
  immFuture.onclick = () => { setMapMode("future"); immFuture.classList.add("imm-active"); immRadar.classList.remove("imm-active"); };
}

function bindImmersiveDrag() {
  immersiveDragAbort = new AbortController();
  const sig = immersiveDragAbort.signal;
  const canvas = document.getElementById("immersiveMapCanvas");

  const move = (x, y) => {
    if (!dragState.active) return;
    mapState.panX = dragState.startPanX + (x - dragState.startX);
    mapState.panY = dragState.startPanY + (y - dragState.startY);
    renderTileMap();
  };

  canvas.addEventListener("mousedown", (e) => {
    dragState.active = true;
    dragState.startX = e.clientX; dragState.startY = e.clientY;
    dragState.startPanX = mapState.panX; dragState.startPanY = mapState.panY;
  }, { signal: sig });
  window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY), { signal: sig });
  window.addEventListener("mouseup",   ()  => { dragState.active = false; },  { signal: sig });

  canvas.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    dragState.active = true;
    dragState.startX = t.clientX; dragState.startY = t.clientY;
    dragState.startPanX = mapState.panX; dragState.startPanY = mapState.panY;
  }, { passive: true, signal: sig });
  window.addEventListener("touchmove", (e) => {
    if (dragState.active) move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true, signal: sig });
  window.addEventListener("touchend", () => { dragState.active = false; }, { signal: sig });
}

init();

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
    clear:           { bg: "linear-gradient(180deg,#1260a8 0%,#1e90d8 45%,#56b8f0 100%)", stars: 0, moon: false, moonGlow: false, sun: true,  clouds: 0, rain: false, snow: false, lightning: false },
    "partly-cloudy": { bg: "linear-gradient(180deg,#1470b8 0%,#40a8e8 100%)",             stars: 0, moon: false, moonGlow: false, sun: true,  clouds: 2, rain: false, snow: false, lightning: false },
    overcast:        { bg: "linear-gradient(180deg,#46606c 0%,#6a8490 100%)",             stars: 0, moon: false, moonGlow: false, sun: false, clouds: 5, rain: false, snow: false, lightning: false },
    rain:            { bg: "linear-gradient(180deg,#303840 0%,#485460 100%)",             stars: 0, moon: false, moonGlow: false, sun: false, clouds: 4, rain: true,  snow: false, lightning: false },
    snow:            { bg: "linear-gradient(180deg,#586070 0%,#7a8898 100%)",             stars: 0, moon: false, moonGlow: false, sun: false, clouds: 3, rain: false, snow: true,  lightning: false },
    thunder:         { bg: "linear-gradient(180deg,#1e2028 0%,#2e3038 100%)",             stars: 0, moon: false, moonGlow: false, sun: false, clouds: 5, rain: true,  snow: false, lightning: true  }
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

// Register service worker for PWA / offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
