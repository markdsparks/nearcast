import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, map, html, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8")
]);

function extractFunction(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.map((marker) => source.indexOf(marker)).find((index) => index >= 0) ?? -1;
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`Could not extract ${name}`);
}

assert.match(app, /const CARTO_BASEMAP_CONFIG_ENDPOINT = "\/api\/map\/config"/, "the client uses the dedicated basemap config endpoint");
assert.match(app, /function cartoBasemapApiKey\(/, "the two map renderers share one basemap-key accessor");
assert.match(map, /cartoBasemapApiKey\(\)/, "CARTO URLs obtain their key from the shared accessor");

const configHarness = new Function(`
  let cartoBasemapConfigRecord = { status: "unknown", checkedAt: 0, apiKey: "" };
  ${extractFunction(app, "cleanCartoBasemapKey")}
  ${extractFunction(app, "normalizeCartoBasemapConfig")}
  ${extractFunction(app, "cartoBasemapApiKey")}
  return {
    normalize: normalizeCartoBasemapConfig,
    setRecord(record) { cartoBasemapConfigRecord = record; },
    key: cartoBasemapApiKey
  };
`)();

const readyConfig = configHarness.normalize({
  provider: "nearcast-map-config",
  version: 1,
  state: "ready",
  carto: { apiKey: "carto-safe-key" }
});
assert.equal(readyConfig.status, "ready", "the exact versioned config contract enables the basemap");
configHarness.setRecord(readyConfig);
assert.equal(configHarness.key(), "carto-safe-key", "the shared accessor exposes only a validated ready key");
for (const payload of [
  null,
  { provider: "nearcast-map-config", version: 1, state: "unavailable", carto: { apiKey: "" } },
  { provider: "wrong-provider", version: 1, state: "ready", carto: { apiKey: "carto-safe-key" } },
  { provider: "nearcast-map-config", version: 2, state: "ready", carto: { apiKey: "carto-safe-key" } },
  { provider: "nearcast-map-config", version: 1, state: "ready", carto: { apiKey: "key with spaces" } }
]) {
  const normalized = configHarness.normalize(payload);
  assert.equal(normalized.status, "unavailable", "malformed or unavailable map config fails closed");
  configHarness.setRecord(normalized);
  assert.equal(configHarness.key(), "", "an unavailable map config cannot leak a tile key");
}
assert.match(extractFunction(app, "loadCartoBasemapConfig"), /cache:\s*"no-store"/, "the runtime key config bypasses browser caches");
const ensureBasemap = extractFunction(map, "ensureMapBasemapConfigured");
assert.match(ensureBasemap, /loadCartoBasemapConfig\(\)/, "map initialization waits for the runtime config instead of racing it");
assert.match(ensureBasemap, /mapBasemapConfigured\(\)/, "a completed config request is revalidated before rendering");
const refreshInlineMap = extractFunction(map, "refreshInlineMap");
assert.match(refreshInlineMap, /!mapBasemapConfigured\(\)[\s\S]*ensureMapBasemapConfigured\(\)[\s\S]*refreshInlineMap\(/, "a delayed key wakes and retries the requested map render");
assert.match(extractFunction(map, "initMap"), /cartoBasemapApiKey[\s\S]*return false/, "map initialization cannot start without a validated CARTO key");
const enterImmersiveMap = extractFunction(map, "enterImmersiveMap");
assert.match(enterImmersiveMap, /await ensureMapBasemapConfigured\(\)[\s\S]*if \(!basemapReady\)[\s\S]*return false/, "the immersive map also fails closed without a basemap key");
assert.ok(
  enterImmersiveMap.indexOf("await ensureMapBasemapConfigured()") < enterImmersiveMap.indexOf("nearcastSuspendDayDetailForMap"),
  "immersive navigation validates the basemap before replacing the current surface"
);

const mapLibreCartoTileUrls = new Function("apiKey", `
  const CARTO_TILE_HOSTS = ["a", "b", "c", "d"];
  function cartoBasemapApiKey() { return apiKey; }
  ${extractFunction(map, "mapCartoTileTemplate")}
  ${extractFunction(map, "mapLibreCartoTileUrls")}
  return mapLibreCartoTileUrls;
`);

const classicCartoTileUrls = new Function("apiKey", `
  const CARTO_TILE_HOSTS = ["a", "b", "c", "d"];
  function cartoBasemapApiKey() { return apiKey; }
  function mapTileStyle() {
    return {
      base: "rastertiles/voyager_nolabels",
      labels: "rastertiles/voyager_only_labels"
    };
  }
  ${extractFunction(map, "mapCartoTileTemplate")}
  ${extractFunction(map, "cartoTileUrl")}
  ${extractFunction(map, "baseTileUrl")}
  ${extractFunction(map, "labelTileUrl")}
  return {
    base: baseTileUrl({ z: 7, x: 31, y: 47 }),
    labels: labelTileUrl({ z: 7, x: 31, y: 47 })
  };
`);

const sampleKey = "domain key+/=?&";
const encodedKey = encodeURIComponent(sampleKey);
const mapLibreUrls = mapLibreCartoTileUrls(sampleKey)("rastertiles/voyager_nolabels");
assert.equal(mapLibreUrls.length, 4, "MapLibre receives one keyed CARTO template per tile host");
for (const url of mapLibreUrls) {
  assert.match(url, /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/rastertiles\/voyager_nolabels\/\{z\}\/\{x\}\/\{y\}\.png\?key=/, "MapLibre retains the CARTO raster template");
  assert.ok(url.endsWith(`?key=${encodedKey}`), "MapLibre safely encodes the basemap key");
  assert.ok(!url.includes(sampleKey), "MapLibre never interpolates the raw basemap key");
}

const classicUrls = classicCartoTileUrls(sampleKey);
assert.match(classicUrls.base, /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/rastertiles\/voyager_nolabels\/7\/31\/47\.png\?key=/, "the classic base layer uses a keyed CARTO URL");
assert.match(classicUrls.labels, /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/rastertiles\/voyager_only_labels\/7\/31\/47\.png\?key=/, "the classic label layer uses a keyed CARTO URL");
assert.ok(classicUrls.base.endsWith(`?key=${encodedKey}`), "the classic base layer safely encodes the basemap key");
assert.ok(classicUrls.labels.endsWith(`?key=${encodedKey}`), "the classic label layer safely encodes the basemap key");

assert.deepEqual(mapLibreCartoTileUrls("")("rastertiles/voyager_nolabels"), [], "MapLibre fails closed instead of requesting unkeyed CARTO tiles");
assert.deepEqual(classicCartoTileUrls(""), { base: "", labels: "" }, "the classic renderer fails closed instead of requesting unkeyed CARTO tiles");

const appVersion = app.match(/const VERSION = "([^"]+)"/)?.[1];
const assetVersion = serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1];
const cacheVersion = serviceWorker.match(/const CACHE = "nearcast-v([^"]+)"/)?.[1];
assert.ok(appVersion, "the app version is declared");
assert.equal(assetVersion, appVersion, "the service-worker asset version matches the app");
assert.equal(cacheVersion, appVersion.replaceAll(".", ""), "the service-worker cache name matches the app release");

const localVersionedAssets = [...html.matchAll(/(?:src|href)="(?!https?:|\/\/|#)([^"?]+)\?v=([^"&]+)"/g)];
assert.ok(localVersionedAssets.length >= 10, "the app shell declares its versioned local assets");
for (const [, asset, version] of localVersionedAssets) {
  assert.equal(version, appVersion, `${asset} uses the current release version`);
}
assert.ok(html.includes(`app.js?v=${appVersion}`), "HTML loads the current app entry point");
assert.ok(html.includes(`map.js?v=${appVersion}`), "HTML loads the current map entry point");
assert.ok(html.includes(`styles.css?v=${appVersion}`), "HTML loads the current map presentation");
assert.match(serviceWorker, /url\.pathname\.includes\("\/api\/"\)/, "runtime map config always bypasses the service-worker cache");

console.log(`CARTO basemap smoke passed for Nearcast ${appVersion}.`);
