const CACHE = "nearcast-v21";

// App shell — everything needed to render offline
const SHELL = [
  "/nearcast/",
  "/nearcast/index.html",
  "/nearcast/styles.css",
  "/nearcast/app.js",
  "/nearcast/manifest.json",
  "/nearcast/icons/icon-192.png",
  "/nearcast/icons/icon-512.png"
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
//  - API calls (Open-Meteo, RainViewer) → network-first, no caching
//  - Map tiles (OSM, rainviewer tiles) → network-only (too large to cache)
//  - Everything else (shell) → cache-first, fall back to network
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // External API / tile requests — always go to network
  if (
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("rainviewer.com") ||
    url.hostname.includes("openstreetmap.org") ||
    url.hostname.includes("tile.openstreetmap") ||
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
