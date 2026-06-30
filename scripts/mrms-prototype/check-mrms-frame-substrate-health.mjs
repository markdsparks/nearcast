#!/usr/bin/env node

const DEFAULT_INDEX_URL = "https://radar.getnearcast.app/radar/mrms/frame-substrate/latest-frame-index.json";
const DEFAULT_CAPABILITY_URL = "https://getnearcast.app/api/radar/capability";
const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_FRAME_AGE_MINUTES = 20;
const DEFAULT_MIN_EXPIRES_IN_MINUTES = 1;
const DEFAULT_MIN_DATA_TILES = 1;
const DEFAULT_VIEWPORT = {
  latitude: 44.5133,
  longitude: -88.0133,
  zoom: 18,
  spanLat: 0.42,
  spanLon: 0.58
};

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const options = healthOptions(args);
  const checks = [];
  const index = await fetchJson(options.indexUrl, { timeoutMs: options.timeoutMs });
  const pack = selectFramePack(index);
  const sourceTime = newestIso([
    ...frames(index).flatMap((frame) => [
      frame.time,
      frame.validTime,
      frame.sourceObject?.observedAt,
      frame.sourceObject?.lastModified
    ]),
    ...(Array.isArray(index?.source?.objects) ? index.source.objects : []).flatMap((object) => [
      object.observedAt,
      object.lastModified
    ]),
    index?.generatedAt
  ]);
  const generatedAt = isoString(index?.generatedAt || pack?.generatedAt || "");
  const expiresAt = isoString(index?.expiresAt || pack?.expiresAt || "");
  const frameAgeMinutes = minutesSince(sourceTime || generatedAt);
  const expiresInMinutes = minutesUntil(expiresAt);
  const metrics = mergedMetrics(index, pack);
  const manifestUrl = resolveUrl(pack?.manifestUrl || index?.manifestUrl || "", options.indexUrl);

  addCheck(checks, "index-provider", index?.provider === "nearcast-mrms-frame-index", {
    provider: index?.provider || ""
  });
  addCheck(checks, "index-pack", Boolean(pack), {
    packId: pack?.id || "",
    packCount: Array.isArray(index?.packs) ? index.packs.length : 0
  });
  addCheck(checks, "manifest-url", Boolean(manifestUrl), { manifestUrl });
  addCheck(checks, "source-fresh", !Number.isFinite(options.maxFrameAgeMinutes) || frameAgeMinutes <= options.maxFrameAgeMinutes, {
    sourceTime: sourceTime || generatedAt || "",
    frameAgeMinutes,
    maxFrameAgeMinutes: options.maxFrameAgeMinutes
  });
  addCheck(checks, "index-not-expiring", Number.isFinite(expiresInMinutes) && expiresInMinutes >= options.minExpiresInMinutes, {
    expiresAt,
    expiresInMinutes,
    minExpiresInMinutes: options.minExpiresInMinutes
  });
  addCheck(checks, "data-tiles", Number(metrics.dataTiles || metrics.radarTiles || 0) >= options.minDataTiles, {
    dataTiles: Number(metrics.dataTiles || 0),
    radarTiles: Number(metrics.radarTiles || 0),
    minDataTiles: options.minDataTiles
  });

  const manifestProbe = manifestUrl
    ? await probeUrl(manifestUrl, { timeoutMs: options.timeoutMs })
    : { ok: false, status: 0, error: "missing-manifest-url" };
  addCheck(checks, "manifest-public", manifestProbe.ok, manifestProbe);

  let capability = null;
  if (!options.skipCapability) {
    capability = await fetchCapability(options);
    addCheck(checks, "capability-ready", capability?.enhanced?.state === "ready", {
      state: capability?.enhanced?.state || "",
      reason: capability?.enhanced?.reason || ""
    });
    addCheck(checks, "capability-frame-index", capability?.enhanced?.selectionSource === "frame-index", {
      selectionSource: capability?.enhanced?.selectionSource || "",
      reason: capability?.enhanced?.reason || ""
    });
    addCheck(checks, "capability-reason", capability?.enhanced?.reason === "fresh-frame-substrate", {
      reason: capability?.enhanced?.reason || ""
    });
  }

  const summary = {
    provider: "nearcast-mrms-frame-substrate-health",
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    indexUrl: options.indexUrl,
    capabilityUrl: options.skipCapability ? "" : options.capabilityUrl,
    packId: pack?.id || "",
    generatedAt,
    sourceTime: sourceTime || generatedAt || "",
    frameAgeMinutes,
    expiresAt,
    expiresInMinutes,
    metrics: {
      candidateTiles: numberOrNull(metrics.candidateTiles),
      generatedTiles: numberOrNull(metrics.generatedTiles),
      radarTiles: numberOrNull(metrics.radarTiles),
      dataTiles: numberOrNull(metrics.dataTiles)
    },
    manifest: {
      url: manifestUrl,
      ok: manifestProbe.ok,
      status: manifestProbe.status,
      error: manifestProbe.error || ""
    },
    capability: capability
      ? {
          state: capability.enhanced?.state || "",
          reason: capability.enhanced?.reason || "",
          selectionSource: capability.enhanced?.selectionSource || "",
          packId: capability.enhanced?.packId || "",
          manifestUrl: capability.enhanced?.manifestUrl || "",
          indexUrl: capability.enhanced?.indexUrl || "",
          generationState: capability.generation?.state || "",
          generationReason: capability.generation?.reason || ""
        }
      : null,
    checks
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

function healthOptions(parsed) {
  const latitude = numberArg(parsed.lat ?? parsed.latitude, DEFAULT_VIEWPORT.latitude);
  const longitude = numberArg(parsed.lon ?? parsed.lng ?? parsed.longitude, DEFAULT_VIEWPORT.longitude);
  const zoom = numberArg(parsed.zoom, DEFAULT_VIEWPORT.zoom);
  return {
    indexUrl: String(parsed["index-url"] || parsed.indexUrl || DEFAULT_INDEX_URL),
    capabilityUrl: String(parsed["capability-url"] || parsed.capabilityUrl || DEFAULT_CAPABILITY_URL),
    timeoutMs: Math.max(500, Math.round(numberArg(parsed.timeout ?? parsed["timeout-ms"], DEFAULT_TIMEOUT_MS))),
    maxFrameAgeMinutes: nonNegativeNumberOrInfinity(parsed["max-frame-age-minutes"], DEFAULT_MAX_FRAME_AGE_MINUTES),
    minExpiresInMinutes: Math.max(0, numberArg(parsed["min-expires-in-minutes"], DEFAULT_MIN_EXPIRES_IN_MINUTES)),
    minDataTiles: Math.max(0, numberArg(parsed["min-data-tiles"], DEFAULT_MIN_DATA_TILES)),
    skipCapability: booleanArg(parsed["skip-capability"], false),
    viewport: {
      latitude,
      longitude,
      zoom,
      bounds: viewportBounds(parsed.bounds, {
        latitude,
        longitude,
        spanLat: numberArg(parsed["span-lat"], DEFAULT_VIEWPORT.spanLat),
        spanLon: numberArg(parsed["span-lon"], DEFAULT_VIEWPORT.spanLon)
      })
    }
  };
}

async function fetchCapability(options) {
  return fetchJson(options.capabilityUrl, {
    timeoutMs: options.timeoutMs,
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      provider: "nearcast-radar-capability-request",
      version: 1,
      requestedAt: new Date().toISOString(),
      viewport: capabilityViewport(options.viewport),
      preferences: {
        radarProvider: "auto",
        mapRenderer: "gl",
        timelineKind: "radar",
        immersive: false
      },
      generation: {
        request: false,
        reason: "frame-substrate-health"
      }
    })
  });
}

function capabilityViewport(viewport) {
  const point = {
    latitude: viewport.latitude,
    longitude: viewport.longitude
  };
  return {
    center: point,
    activePoint: point,
    zoom: viewport.zoom,
    bounds: viewport.bounds,
    key: `${viewport.latitude.toFixed(2)},${viewport.longitude.toFixed(2)},z${viewport.zoom}`
  };
}

async function fetchJson(url, options = {}) {
  const method = options.method || "GET";
  const response = await fetchWithTimeout(url, {
    ...options,
    method,
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`${method} ${url} failed with ${response.status}`);
  return response.json();
}

async function probeUrl(url, options = {}) {
  const head = await probeUrlMethod(url, "HEAD", options);
  if (head.ok || ![405, 501].includes(head.status)) return head;
  return probeUrlMethod(url, "GET", options);
}

async function probeUrlMethod(url, method, options = {}) {
  try {
    const response = await fetchWithTimeout(url, {
      method,
      timeoutMs: options.timeoutMs,
      headers: { "cache-control": "no-cache" }
    });
    return {
      ok: response.ok,
      status: response.status,
      method
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      method,
      error: error?.message || String(error)
    };
  }
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Math.max(500, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function selectFramePack(index) {
  const packs = Array.isArray(index?.packs) ? index.packs : [];
  const defaultPack = String(index?.defaultPack || "");
  return packs.find((pack) => pack?.id === defaultPack && pack?.kind === "frame-substrate") ||
    packs.find((pack) => pack?.kind === "frame-substrate") ||
    packs[0] ||
    null;
}

function frames(index) {
  return Array.isArray(index?.frames) ? index.frames : [];
}

function mergedMetrics(index, pack) {
  return {
    ...(index?.metrics || {}),
    ...(pack?.metrics || {})
  };
}

function addCheck(checks, name, ok, detail = {}) {
  checks.push({
    name,
    ok: Boolean(ok),
    ...detail
  });
}

function newestIso(values) {
  let newest = 0;
  values.forEach((value) => {
    const timestamp = Date.parse(value || "");
    if (Number.isFinite(timestamp) && timestamp > newest) newest = timestamp;
  });
  return newest ? new Date(newest).toISOString() : "";
}

function isoString(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function minutesSince(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? round((Date.now() - timestamp) / 60000, 1) : null;
}

function minutesUntil(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? round((timestamp - Date.now()) / 60000, 1) : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** Math.max(0, digits);
  return Math.round(number * factor) / factor;
}

function resolveUrl(value, base) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text, base).toString();
  } catch {
    return "";
  }
}

function viewportBounds(value, fallback) {
  if (value) {
    const parts = String(value).split(",").map((part) => Number(part.trim()));
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[0] < parts[2] && parts[1] < parts[3]) {
      return {
        minLat: parts[0],
        minLon: parts[1],
        maxLat: parts[2],
        maxLon: parts[3]
      };
    }
    throw new Error("--bounds must be minLat,minLon,maxLat,maxLon");
  }
  const latitude = Number(fallback.latitude);
  const longitude = Number(fallback.longitude);
  const spanLat = Math.max(0.01, Number(fallback.spanLat));
  const spanLon = Math.max(0.01, Number(fallback.spanLon));
  return {
    minLat: round(latitude - spanLat / 2, 5),
    minLon: round(longitude - spanLon / 2, 5),
    maxLat: round(latitude + spanLat / 2, 5),
    maxLon: round(longitude + spanLon / 2, 5)
  };
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumberOrInfinity(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["off", "none", "infinity", "inf"].includes(text)) return Infinity;
  return Math.max(0, numberArg(value, fallback));
}

function booleanArg(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/check-mrms-frame-substrate-health.mjs

Options:
  --index-url=URL                  Public latest frame index URL.
  --capability-url=URL             Radar capability endpoint URL.
  --max-frame-age-minutes=20       Fail when newest source frame is older than this.
  --min-expires-in-minutes=1       Fail when the index is expired or almost expired.
  --min-data-tiles=1               Require active encoded data tiles.
  --lat=44.5133 --lon=-88.0133     Capability viewport center.
  --zoom=18                        Capability viewport zoom.
  --bounds=minLat,minLon,maxLat,maxLon
  --skip-capability                Only validate the public frame substrate artifacts.
  --timeout-ms=6000                Per-request timeout.
`);
}

main().catch((error) => {
  console.error(JSON.stringify({
    provider: "nearcast-mrms-frame-substrate-health",
    ok: false,
    checkedAt: new Date().toISOString(),
    error: error?.message || String(error)
  }, null, 2));
  process.exit(1);
});
