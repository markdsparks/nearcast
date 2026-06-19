const CACHE = "nearcast-v147";
const ASSET_VERSION = "1.10.106";

// App shell — everything needed to render offline
const BASE = new URL("./", self.location.href).pathname;
const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}styles.css?v=${ASSET_VERSION}`,
  `${BASE}app.js?v=${ASSET_VERSION}`,
  `${BASE}ai.js?v=${ASSET_VERSION}`,
  `${BASE}ai-worker.js?v=${ASSET_VERSION}`,
  `${BASE}manifest.json`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`
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

// Fetch strategy:
//  - API calls (Open-Meteo, RainViewer, NWS/NOAA) → network-first, no caching
//  - Map tiles (OSM, radar/forecast tiles) → network-only (too large to cache)
//  - Everything else (shell) → cache-first, fall back to network
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // External API / tile requests — always go to network
  if (
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("rainviewer.com") ||
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
    e.respondWith(fetch(e.request));
    return;
  }

  // App shell — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
