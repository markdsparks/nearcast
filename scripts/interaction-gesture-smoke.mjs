import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, map, styles, html, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8")
]);

assert.match(styles, /#weatherMap\s*\{[\s\S]*?touch-action: pan-y pinch-zoom;/, "the inline map yields vertical gestures to page scrolling");
assert.match(styles, /\.immersive-map \.tile-map\s*\{[\s\S]*?touch-action: none;/, "the immersive map keeps direct pan and pinch control");
assert.match(map, /function bindMapDrag\(\)[\s\S]*?addEventListener\("pointerdown"[\s\S]*?addEventListener\("pointermove"[\s\S]*?addEventListener\("pointerup"[\s\S]*?addEventListener\("pointercancel"/, "the preview uses one pointer gesture recognizer");
assert.match(map, /duration <= MAP_PREVIEW_TAP_MAX_MS/, "a held preview gesture cannot become a late map-opening tap");
assert.doesNotMatch(map, /document\.addEventListener\("(?:pointerup|touchend)", openMapLibrePreviewFromEvent/, "document-level release handlers cannot race page scrolling");
assert.doesNotMatch(map, /hitbox\.addEventListener\("(?:pointerup|touchend)"/, "the GL hitbox does not add a competing release path");

assert.match(app, /function bindSheetPullToDismiss\(sheet, dismiss\)/, "explainer sheets have a reusable pull-dismiss gesture");
assert.match(app, /bindSheetPullToDismiss\(els\.glanceDetailSheet, closeGlanceDetail\)/, "weather explainers opt into pull dismissal");
assert.match(app, /distanceThreshold[\s\S]*velocity >= 0\.65/, "sheet dismissal supports deliberate pulls and downward flicks");
assert.match(app, /pointercancel[\s\S]*finish\(event, true\)/, "cancelled sheet gestures snap back instead of dismissing");
assert.match(styles, /\.day-sheet\.show\s*\{[\s\S]*?--sheet-drag-y/, "the sheet follows the pull distance");
assert.match(styles, /\.day-sheet\.is-dragging\s*\{[\s\S]*?transition: none;/, "the sheet tracks the finger without transition lag");
assert.match(styles, /\.sheet-grabber\s*\{[\s\S]*?width: 64px;[\s\S]*?height: 28px;[\s\S]*?touch-action: none;/, "the visible grabber has a usable gesture lane");
assert.match(app, /glanceDetailClose\?\.focus/, "the open explainer receives keyboard and VoiceOver focus");
assert.match(app, /returnFocus\?\.isConnected/, "closing an explainer restores its launch point");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service worker and app versions match");
assert.ok(html.includes(`app.js?v=${version}`), "HTML loads the current app version");
assert.ok(html.includes(`map.js?v=${version}`), "HTML loads the current map gesture code");
assert.ok(html.includes(`styles.css?v=${version}`), "HTML loads the current interaction styles");

console.log(`Interaction gesture smoke passed for Nearcast ${version}.`);
