import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, map, html, css, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8")
]);

assert.match(map, /MODIS_Aqua_CorrectedReflectance_TrueColor/, "satellite mode uses MODIS Aqua true color");
assert.match(map, /MODIS_Terra_CorrectedReflectance_TrueColor/, "satellite mode can fall back to MODIS Terra");
assert.match(map, /GoogleMapsCompatible_Level9/, "GIBS requests use the advertised Web Mercator tile matrix");
assert.match(map, /MAP_SATELLITE_MAX_SOURCE_ZOOM = 9/, "satellite detail is capped at the native tile ceiling");
assert.match(map, /for \(let daysAgo = 0; daysAgo <= 3; daysAgo \+= 1\)/, "satellite mode searches recent dates for a local pass");
assert.match(map, /if \(mapSatelliteEnabled\(\)\) \{[\s\S]{0,180}clearMapLibreWeatherRecord/, "satellite mode suppresses MapLibre weather layers");
assert.match(map, /Radar hidden · Regional detail/, "satellite status distinguishes imagery from live radar");
assert.ok(map.indexOf("id: MAPLIBRE_SATELLITE_LAYER_ID") < map.indexOf("id: MAPLIBRE_LABEL_LAYER_ID"), "labels render above satellite imagery");
assert.match(html, /data-map-base-mode="satellite"/, "layer menu exposes satellite mode");
assert.match(html, /id="immSatelliteStatus"/, "immersive map includes capture status");
assert.match(css, /\.imm-aerial-toggle\.is-satellite/, "satellite mode has a distinct control state");
assert.match(css, /\.satellite-base-layer/, "classic satellite tiles have dedicated presentation");

const appVersion = app.match(/const VERSION = "([^"]+)"/)?.[1];
const assetVersion = serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1];
assert.ok(appVersion, "app version is declared");
assert.equal(assetVersion, appVersion, "app and service-worker versions stay synchronized");
assert.ok(html.includes(`app.js?v=${appVersion}`), "HTML loads the current app version");
assert.ok(html.includes(`map.js?v=${appVersion}`), "HTML loads the current map version");
assert.ok(html.includes(`styles.css?v=${appVersion}`), "HTML loads the current style version");

console.log(`Map satellite smoke passed for Nearcast ${appVersion}.`);
