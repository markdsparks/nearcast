#!/usr/bin/env node

import fs from "node:fs";

const DEFAULT_MANIFEST = "radar/mrms/manifest.json";
const DEFAULT_MAX_PROBES = 96;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_FRAME_LIMIT = 6;

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const manifestPath = args.manifest || DEFAULT_MANIFEST;
  const maxProbes = Math.max(1, integerArg(args["max-probes"], DEFAULT_MAX_PROBES));
  const timeoutMs = Math.max(250, integerArg(args.timeout, DEFAULT_TIMEOUT_MS));
  const frameLimit = Math.max(1, integerArg(args.frames || args["frame-limit"], DEFAULT_FRAME_LIMIT));
  const manifest = await loadJson(manifestPath);
  const manifestBaseUrl = args["manifest-url"] || (/^https?:\/\//i.test(manifestPath) ? manifestPath : "");
  const metrics = manifest.metrics || manifest.coverage || {};
  const expectedTiles = Number(metrics.dataTiles ?? metrics.radarTiles ?? metrics.generatedTiles);

  if (Number.isFinite(expectedTiles) && expectedTiles <= 0) {
    console.log(JSON.stringify({
      provider: "nearcast-mrms-public-tile-verify",
      ok: true,
      skipped: true,
      reason: "no-generated-tiles",
      expectedTiles
    }, null, 2));
    return;
  }

  const urls = publicTileProbeUrls(manifest, { maxProbes, frameLimit, manifestBaseUrl });
  if (!urls.length) {
    throw new Error("no public tile probe URLs could be built from manifest");
  }

  const probes = await Promise.all(urls.map((url) => probeUrl(url, timeoutMs)));
  const firstOk = probes.find((probe) => probe.ok);
  const summary = {
    provider: "nearcast-mrms-public-tile-verify",
    ok: Boolean(firstOk),
    manifest: manifestPath,
    generatedAt: manifest.generatedAt || "",
    expiresAt: manifest.expiresAt || "",
    frameCount: Array.isArray(manifest.frames) ? manifest.frames.length : 0,
    expectedTiles: Number.isFinite(expectedTiles) ? expectedTiles : null,
    probes: probes.length,
    firstOk: firstOk?.url || "",
    sampleFailures: probes
      .filter((probe) => !probe.ok)
      .slice(0, 8)
      .map((probe) => ({ url: probe.url, status: probe.status, error: probe.error || "" }))
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!firstOk) process.exit(1);
}

function publicTileProbeUrls(manifest, { maxProbes, frameLimit, manifestBaseUrl }) {
  const frames = (Array.isArray(manifest.frames) ? manifest.frames : [])
    .slice(-frameLimit)
    .reverse();
  const urls = [];
  const seen = new Set();
  for (const frame of frames) {
    const template = frame.dataUrl || frame.dataTileUrl || frame.encodedUrl || frame.encodedTileUrl || frame.url || frame.tileUrl || frame.template || "";
    if (!template) continue;
    const bounds = coverageBounds(frame.coverageBounds) || coverageBounds(manifest.coverageBounds);
    for (const z of probeZooms(frame, manifest)) {
      for (const coord of tileCoordsForBounds(bounds, z)) {
        const url = resolvePublicTileUrl(tileUrl(template, z, coord.x, coord.y), manifestBaseUrl);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
        if (urls.length >= maxProbes) return urls;
      }
    }
  }
  return urls;
}

function probeZooms(frame, manifest) {
  const minZoom = clampZoom(frame.minZoom ?? frame.minzoom ?? manifest.minZoom ?? manifest.minzoom ?? 0);
  const maxZoom = Math.max(minZoom, clampZoom(frame.maxZoom ?? frame.maxzoom ?? manifest.maxZoom ?? manifest.maxzoom ?? 14));
  return [
    minZoom,
    Math.min(maxZoom, Math.max(minZoom, 8)),
    Math.min(maxZoom, Math.max(minZoom, 10)),
    maxZoom
  ].filter((value, index, list) => Number.isFinite(value) && list.indexOf(value) === index);
}

function tileCoordsForBounds(bounds, z) {
  if (!bounds) return [];
  const worldTiles = 2 ** z;
  const nw = projectLatLon(bounds.maxLat, bounds.minLon, z);
  const se = projectLatLon(bounds.minLat, bounds.maxLon, z);
  const minX = Math.floor(Math.min(nw.x, se.x) / 256);
  const maxX = Math.floor(Math.max(nw.x, se.x) / 256);
  const minY = Math.max(0, Math.floor(Math.min(nw.y, se.y) / 256));
  const maxY = Math.min(worldTiles - 1, Math.floor(Math.max(nw.y, se.y) / 256));
  const xs = integerSamples(minX, maxX);
  const ys = integerSamples(minY, maxY);
  const coords = [];
  xs.forEach((x) => ys.forEach((y) => {
    coords.push({
      x: ((x % worldTiles) + worldTiles) % worldTiles,
      y: Math.max(0, Math.min(worldTiles - 1, y))
    });
  }));
  return coords;
}

function coverageBounds(value) {
  if (!value || typeof value !== "object") return null;
  const minLat = Number(value.minLat ?? value.south);
  const minLon = Number(value.minLon ?? value.west);
  const maxLat = Number(value.maxLat ?? value.north);
  const maxLon = Number(value.maxLon ?? value.east);
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return null;
  if (!(minLat < maxLat && minLon < maxLon)) return null;
  return { minLat, minLon, maxLat, maxLon };
}

function projectLatLon(latitude, longitude, zoom) {
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, Number(latitude)));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const worldSize = 256 * 2 ** zoom;
  return {
    x: ((Number(longitude) + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  };
}

function integerSamples(min, max) {
  const start = Math.ceil(Math.min(min, max));
  const end = Math.floor(Math.max(min, max));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  if (end - start <= 2) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return [start, Math.floor((start + end) / 2), end];
}

function tileUrl(template, z, x, y) {
  return String(template || "")
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y));
}

function resolvePublicTileUrl(url, manifestBaseUrl) {
  if (!url || !manifestBaseUrl || /^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, manifestBaseUrl).toString();
  } catch {
    return url;
  }
}

async function probeUrl(url, timeoutMs) {
  const result = { url, ok: false, status: 0, error: "" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal
    });
    result.status = response.status;
    result.ok = response.ok;
  } catch (error) {
    result.error = error?.message || String(error);
  } finally {
    clearTimeout(timer);
  }
  return result;
}

async function loadJson(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const response = await fetch(pathOrUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`failed to fetch ${pathOrUrl}: ${response.status}`);
    return response.json();
  }
  return JSON.parse(fs.readFileSync(pathOrUrl, "utf8"));
}

function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(22, Math.floor(number)));
}

function integerArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
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

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/verify-mrms-public-tiles.mjs --manifest=radar/mrms/manifest.json

Options:
  --manifest=PATH_OR_URL       Manifest to inspect. Defaults to radar/mrms/manifest.json.
  --manifest-url=URL           Base URL for resolving relative tile templates.
  --max-probes=96              Maximum public tile URLs to probe.
  --timeout=3000               Per-request timeout in milliseconds.
  --frames=6                   Recent frame count to sample.
`);
}

main().catch((error) => {
  console.error(`MRMS public tile verification failed: ${error.message}`);
  process.exit(1);
});
