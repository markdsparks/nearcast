const CACHE = "nearcast-v30176";
const ASSET_VERSION = "3.0.177";
const NAVIGATION_TIMEOUT_MS = 1600;

// App shell — everything needed to render offline
const BASE = new URL("./", self.location.href).pathname;
const SHELL = [
  BASE,
  `${BASE}index.html`,
  `${BASE}styles.css?v=${ASSET_VERSION}`,
  `${BASE}weather-truth.js?v=${ASSET_VERSION}`,
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
    url.pathname.includes("/radar/chunks/") ||
    url.pathname.includes("/radar/mrms/") ||
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

function pushNotificationPayload(data) {
  if (!data) return {};
  try {
    const text = data.text();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : { body: text };
    } catch {
      return { body: text };
    }
  } catch {
    return {};
  }
}

function hasPushNotificationContent(payload) {
  return Boolean(payload && (payload.title || payload.body));
}

function nearcastNotificationTargetUrl(payload = {}) {
  const rawUrl = payload.url || BASE;
  let url;
  try {
    url = new URL(rawUrl, self.location.origin + BASE);
  } catch {
    url = new URL(BASE, self.location.origin + BASE);
  }
  if (url.origin !== self.location.origin) {
    url = new URL(BASE, self.location.origin + BASE);
  }

  const memoryId = String(payload.memoryId || "").trim();
  const placeId = String(payload.placeId || "").trim();
  const target = memoryId ? "plan" : placeId ? "place" : "watching";
  url.searchParams.set("nearcast", "notification");
  url.searchParams.set("target", target);
  if (memoryId) url.searchParams.set("memoryId", memoryId);
  if (placeId) url.searchParams.set("placeId", placeId);
  if (payload.source) url.searchParams.set("source", String(payload.source).slice(0, 64));
  return url.href;
}

async function pendingPlanWatchNotificationPayload() {
  try {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return {};
    const response = await fetch(new URL("api/watch/notifications/pending", self.location.origin + BASE), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: "nearcast-plan-watch-service-worker",
        version: 1,
        subscription: subscription.toJSON()
      })
    });
    if (!response.ok) return {};
    const body = await response.json().catch(() => null);
    return body?.notification && typeof body.notification === "object" ? body.notification : {};
  } catch {
    return {};
  }
}

async function showPlanWatchPushNotification(data) {
  const directPayload = pushNotificationPayload(data);
  const payload = hasPushNotificationContent(directPayload)
    ? directPayload
    : await pendingPlanWatchNotificationPayload();
  const title = payload.title || "Nearcast";
  const options = {
    body: payload.body || "A watched plan changed.",
    tag: payload.tag || "nearcast-plan-watch",
    renotify: Boolean(payload.renotify),
    icon: payload.icon || `${BASE}icons/icon-192.png`,
    badge: payload.badge || `${BASE}icons/icon-192.png`,
    data: {
      url: nearcastNotificationTargetUrl(payload),
      memoryId: payload.memoryId || "",
      placeId: payload.placeId || "",
      source: payload.source || "plan-watch-push"
    }
  };
  return self.registration.showNotification(title, options);
}

self.addEventListener("push", event => {
  event.waitUntil(showPlanWatchPushNotification(event.data));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = nearcastNotificationTargetUrl(event.notification.data || {});
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
      const existing = clients.find(client => client.url.startsWith(self.location.origin + BASE));
      if (existing) {
        if (existing.navigate && existing.url !== targetUrl) {
          try {
            const navigated = await existing.navigate(targetUrl);
            if (navigated?.focus) return navigated.focus();
          } catch {
            /* Focus the existing app if navigation is unavailable. */
          }
        }
        return existing.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
