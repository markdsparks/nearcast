const CACHE = "nearcast-v3038";
const ASSET_VERSION = "3.0.38";
const NAVIGATION_TIMEOUT_MS = 1600;

// App shell — everything needed to render offline
const BASE = new URL("./", self.location.href).pathname;
const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}styles.css?v=${ASSET_VERSION}`,
  `${BASE}planner.js?v=${ASSET_VERSION}`,
  `${BASE}app.js?v=${ASSET_VERSION}`,
  `${BASE}map.js?v=${ASSET_VERSION}`,
  `${BASE}sky.js?v=${ASSET_VERSION}`,
  `${BASE}daygraph.js?v=${ASSET_VERSION}`,
  `${BASE}boot.js?v=${ASSET_VERSION}`,
  `${BASE}ai.js?v=${ASSET_VERSION}`,
  `${BASE}ai-worker.js?v=${ASSET_VERSION}`,
  `${BASE}manifest.json`,
  `${BASE}manifest.json?v=${ASSET_VERSION}`,
  `${BASE}icons/nearcast-mark.svg`,
  `${BASE}icons/nearcast-glyph.svg`,
  `${BASE}icons/nearcast-icon.svg`,
  `${BASE}icons/nearcast-icon-maskable.svg`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-192.png?v=${ASSET_VERSION}`,
  `${BASE}icons/icon-512.png`,
  `${BASE}icons/icon-512.png?v=${ASSET_VERSION}`,
  `${BASE}icons/icon-maskable-512.png`,
  `${BASE}icons/icon-maskable-512.png?v=${ASSET_VERSION}`
];

// Install: cache the shell
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting();
});

// Activate: drop old caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function navigationFallback() {
  return caches.match(`${BASE}index.html`).then(cached =>
    cached || caches.match(BASE) || Response.error()
  );
}

function navigationTimeout() {
  return new Promise(resolve => {
    setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS);
  });
}

function freshNavigation(request) {
  const network = fetch(request).then(response => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => {
        cache.put(`${BASE}index.html`, copy).catch(() => {});
      }).catch(() => {});
    }
    return response;
  }).catch(() => null);
  return Promise.race([network, navigationTimeout()]).then(response =>
    response || navigationFallback()
  );
}

function networkOnly(request) {
  return fetch(request).catch(() => Response.error());
}

// Fetch strategy:
//  - API calls (Open-Meteo, RainViewer, NWS/NOAA) → network-first, no caching
//  - Map tiles (OSM, radar/forecast tiles) → network-only (too large to cache)
//  - HTML navigations → network-first, so users do not get trapped on old app versions
//  - Versioned shell assets → cache-first, fall back to network
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // External API / tile requests — always go to network
  if (
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("rainviewer.com") ||
    url.hostname.includes("geojs.io") ||
    url.hostname.includes("ipapi.co") ||
    url.hostname.includes("ipwho.is") ||
    url.hostname.includes("weather.gov") ||
    url.hostname.includes("nowcoast.noaa.gov") ||
    url.hostname.includes("opengeo.ncep.noaa.gov") ||
    url.hostname.includes("mrms.ncep.noaa.gov") ||
    url.hostname.includes("nominatim.openstreetmap.org") ||
    url.hostname.includes("openstreetmap.org") ||
    url.hostname.includes("tile.openstreetmap") ||
    url.hostname.includes("basemaps.cartocdn.com") ||
    url.hostname.includes("tilecache") ||
    url.pathname.includes("/v2/radar/") ||
    url.pathname.includes("/nowcast/")
  ) {
    e.respondWith(networkOnly(e.request));
    return;
  }

  if (e.request.mode === "navigate" || e.request.headers.get("accept")?.includes("text/html")) {
    e.respondWith(freshNavigation(e.request));
    return;
  }

  // Versioned app shell assets — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
