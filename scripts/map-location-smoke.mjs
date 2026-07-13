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

assert.match(app, /navigator\.geolocation\.watchPosition\(/, "foreground location uses a position watcher");
assert.match(app, /navigator\.geolocation\.clearWatch\(watchId\)/, "location watcher can be stopped");
assert.match(map, /document\.hidden\) stopImmersiveLocationWatch\(\)/, "backgrounding stops location updates");
assert.match(map, /stopImmersiveLocationWatch\(\);[\s\S]{0,180}immersiveLocationState\.following = false/, "closing the immersive map stops following");
assert.match(map, /event\?\.originalEvent\) disengageDeviceLocationFollow\(\)/, "manual MapLibre movement disengages follow mode");
assert.match(map, /if \(mapState\.immersive\) disengageDeviceLocationFollow\(\)/, "manual classic-map movement disengages follow mode");
assert.match(html, /See yourself on the map/, "first-use prompt explains the location benefit");
assert.match(html, /id="immLocation"/, "immersive map includes a recenter control");
assert.match(css, /\.imm-location\.is-following/, "follow mode has a visible control state");

const appVersion = app.match(/const VERSION = "([^"]+)"/)?.[1];
const assetVersion = serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1];
assert.ok(appVersion, "app version is declared");
assert.equal(assetVersion, appVersion, "app and service-worker versions stay synchronized");
assert.ok(html.includes(`app.js?v=${appVersion}`), "HTML loads the current app version");
assert.ok(html.includes(`map.js?v=${appVersion}`), "HTML loads the current map version");
assert.ok(html.includes(`styles.css?v=${appVersion}`), "HTML loads the current style version");

console.log(`Map location smoke passed for Nearcast ${appVersion}.`);
