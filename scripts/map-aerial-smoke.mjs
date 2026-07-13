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

assert.match(map, /USGSImageryOnly\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/, "USGS aerial source uses its documented z/y/x tile order");
assert.match(map, /MAP_AERIAL_MAX_SOURCE_ZOOM = 16/, "aerial imagery respects the service's native zoom ceiling");
assert.match(map, /localStorage\.getItem\(MAP_BASE_MODE_KEY\) === "aerial"/, "the experimental basemap choice persists");
assert.match(map, /function mapAerialSupported\(/, "aerial mode is guarded by a coverage check");
assert.match(map, /function renderClassicBaseTiles\(/, "the classic renderer supports the aerial experiment");
assert.match(map, /syncMapLibreAerialVisibility\(record\)/, "the MapLibre renderer synchronizes aerial visibility");
assert.ok(map.indexOf("id: MAPLIBRE_AERIAL_LAYER_ID") < map.indexOf("id: MAPLIBRE_LABEL_LAYER_ID"), "labels render above aerial imagery");
assert.match(map, /USGS\/USDA/, "aerial attribution is visible in the map credit");
assert.match(html, /id="immAerialToggle"/, "immersive map includes the aerial toggle");
assert.match(css, /\.imm-aerial-toggle\.is-active/, "the aerial toggle has a visible active state");

const appVersion = app.match(/const VERSION = "([^"]+)"/)?.[1];
const assetVersion = serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1];
assert.ok(appVersion, "app version is declared");
assert.equal(assetVersion, appVersion, "app and service-worker versions stay synchronized");
assert.ok(html.includes(`app.js?v=${appVersion}`), "HTML loads the current app version");
assert.ok(html.includes(`map.js?v=${appVersion}`), "HTML loads the current map version");
assert.ok(html.includes(`styles.css?v=${appVersion}`), "HTML loads the current style version");

console.log(`Map aerial smoke passed for Nearcast ${appVersion}.`);
