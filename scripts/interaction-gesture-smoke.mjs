import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, map, planner, daygraph, styles, html, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "map.js"), "utf8"),
  readFile(path.join(root, "planner.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8"),
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

assert.match(app, /function bindSheetPullToDismiss\(sheet, dismiss, canDismiss = null\)/, "sheets share one configurable pull-dismiss gesture");
assert.match(app, /function showSheet\(backdrop, sheet, options = \{\}\)[\s\S]*?onPullDismiss[\s\S]*?bindSheetPullToDismiss/, "the shared show contract registers pull dismissal");
assert.match(app, /distanceThreshold[\s\S]*recentVelocity >= 0\.65/, "sheet dismissal supports deliberate pulls and recent downward flicks");
assert.match(app, /pointercancel[\s\S]*finish\(cancelEvent, true\)/, "cancelled sheet gestures snap back instead of dismissing");
assert.match(app, /isTopmostShownSheet\(sheet\)/, "only the top visible sheet can claim the pull gesture");
assert.match(app, /sheet\.classList\.contains\("sheet-keyboard-active"\)/, "keyboard-active forms cannot be pulled away");
assert.match(app, /const remainsDismissible =[\s\S]*?isTopmostShownSheet\(sheet\)[\s\S]*?gesture\.canDismiss[\s\S]*?const shouldDismiss =[\s\S]*?remainsDismissible/, "top-sheet and busy guards are rechecked when the pull ends");
assert.match(app, /const snapBack = \(\) => \{[\s\S]*?const pointerId = gesture\.pointerId[\s\S]*?releasePointerCapture\(pointerId\)/, "interrupted pulls release pointer capture before snapping back");
assert.match(app, /showSheet\(els\.installBackdrop[\s\S]*?onPullDismiss: \(\) => closeInstallSheet/, "install help uses its real close path");
assert.match(app, /showSheet\(els\.placeBackdrop[\s\S]*?onPullDismiss: closePlaceSheet/, "places uses its real close path");
assert.match(app, /showSheet\(els\.glanceDetailBackdrop[\s\S]*?onPullDismiss: closeGlanceDetail/, "weather explainers use their real close path");
assert.match(app, /showSheet\(backdrop, sheet,[\s\S]*?onPullDismiss: closeAlertSheet/, "alerts use their real close path");
assert.match(app, /bindTapDelegate\(sheetHourlyList, "\.sheet-hour-alert-divider"[\s\S]*?openAlertSheet\(alertKey, \{ returnFocus: alertDivider \}\)/, "hourly alert buttons open their exact alert without toggling an hour row");
assert.match(app, /event\.key === "Escape"[\s\S]*?!sheet\.hidden && isTopmostShownSheet\(sheet\)[\s\S]*?closeAlertSheet\(\)/, "Escape closes only the topmost alert sheet");
assert.match(app, /function closeAlertSheet\([\s\S]*?#dayDetail:not\(\[hidden\]\)[\s\S]*?keepLocked \? "hidden" : ""/, "closing nested alert detail keeps the hourly sheet scroll lock");
assert.match(app, /alertSheetUnderlyingDayDetail\.inert = true[\s\S]*?underlyingDayDetail\.inert = alertSheetUnderlyingWasInert/, "nested alert detail isolates and then restores the hourly sheet");
assert.match(app, /alertSheetClose"\)\?\.focus[\s\S]*?canRestoreAlertSheetFocus\(returnFocus\)[\s\S]*?focusTarget\?\.focus/, "alert detail receives focus and returns it to a visible launch point or stable parent control");
assert.match(styles, /#alertBackdrop\s*\{[\s\S]*?z-index:\s*323[\s\S]*?\.day-sheet\.alert-sheet\s*\{[\s\S]*?z-index:\s*324/, "nested alert detail renders above hourly detail");
assert.match(styles, /body\.map-immersive-active #alertBackdrop\s*\{[\s\S]*?z-index:\s*1123[\s\S]*?body\.map-immersive-active \.day-sheet\.alert-sheet\s*\{[\s\S]*?z-index:\s*1124/, "alert detail remains topmost over immersive map sheets");
assert.match(app, /showSheet\(els\.liveActivityBackdrop[\s\S]*?onPullDismiss: closeLiveActivityLab[\s\S]*?canPullDismiss/, "Live Activity protects in-flight native actions");
assert.match(daygraph, /showSheet\(backdrop, sheet,[\s\S]*?onPullDismiss: closeDayDetail/, "day detail preserves its custom close cleanup");
assert.match(planner, /showSheet\(els\.memoryDetailBackdrop[\s\S]*?onPullDismiss: navigateBackFromMemoryDetail/, "plan detail pull gestures follow the nested navigation stack");
assert.match(planner, /function navigateBackFromMemoryDetail\([\s\S]*?closeMemoryDetail\(\)/, "root plan detail still preserves its custom close cleanup");
assert.match(planner, /showSheet\(els\.memoryBackdrop[\s\S]*?onPullDismiss: closeGlobalMemorySheet/, "Watching preserves its custom close cleanup");
assert.match(planner, /showSheet\(els\.aiBackdrop[\s\S]*?onPullDismiss: closeAISheet[\s\S]*?canPullDismiss/, "Plan Check protects active generation");
assert.match(map, /function openXweatherStormReceiptSheet[\s\S]*?showSheet\(backdrop, sheet, \{\s*onPullDismiss: closeXweatherStormReceiptSheet/, "StormScope receipts preserve receipt cleanup");
assert.match(map, /function openXweatherStormSheet[\s\S]*?showSheet\(backdrop, sheet, \{\s*onPullDismiss: closeXweatherStormSheet/, "StormScope preserves map cleanup");

const classifiedSheets = [...html.matchAll(/<aside class="[^"]*\bday-sheet\b[^"]*" id="([^"]+)"[^>]*data-pull-dismiss="(enabled|disabled)"/g)]
  .map(([, id, mode]) => ({ id, mode }));
assert.equal(classifiedSheets.length, 12, "every sheet explicitly declares its pull-dismiss policy");
assert.equal(classifiedSheets.filter(({ mode }) => mode === "enabled").length, 11, "all informational sheets expose pull dismissal");
assert.deepEqual(
  classifiedSheets.filter(({ mode }) => mode === "disabled").map(({ id }) => id),
  ["memoryEditSheet"],
  "the unsaved structured editor is the only non-dismissible sheet"
);
assert.equal((html.match(/class="sheet-grabber"/g) || []).length, 11, "only pull-enabled sheets render a grabber");
assert.match(styles, /\.day-sheet\.show\s*\{[\s\S]*?--sheet-drag-y/, "the sheet follows the pull distance");
assert.match(styles, /\.day-sheet\.is-dragging\s*\{[\s\S]*?transition: none;/, "the sheet tracks the finger without transition lag");
assert.match(styles, /body\.map-immersive-active \.day-sheet\.show\s*\{[\s\S]*?--sheet-drag-y/, "immersive-map sheets visibly follow the pull");
assert.match(styles, /\.sheet-grabber\s*\{[\s\S]*?position: sticky;[\s\S]*?width: 80px;[\s\S]*?height: 44px;[\s\S]*?touch-action: none;/, "the sticky grabber keeps a full touch lane in reach");
assert.match(app, /glanceDetailClose\?\.focus/, "the open explainer receives keyboard and VoiceOver focus");
assert.match(app, /returnFocus\?\.isConnected/, "closing an explainer restores its launch point");

assert.match(styles, /Atomic controls should feel pressable[\s\S]*?-webkit-user-select: none;[\s\S]*?user-select: none;[\s\S]*?-webkit-touch-callout: none;/, "atomic controls suppress accidental iOS selection and callouts");
assert.match(styles, /\.sheet-hour-row:not\(\.is-expanded\)[\s\S]*?\.sheet-hour-detail/, "expanded hourly prose remains outside the row-selection suppression");
assert.match(styles, /input:not\(\[type="range"\]\)[\s\S]*?textarea[\s\S]*?\[contenteditable="true"\][\s\S]*?-webkit-user-select: text;/, "forms and deliberate text surfaces remain selectable");
assert.match(styles, /:where\(\.tile-layer img, img\[alt=""\]\)[\s\S]*?-webkit-user-drag: none;/, "decorative and map images do not open image callouts");
const globalSelectionBlocks = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selectors, declarations]) => /(?:^|;)\s*(?:-webkit-)?user-select:\s*none\s*;?/m.test(declarations)
    && selectors.split(",").some((selector) => /^(?:html|body)(?:$|[.#[\]:])/.test(selector.trim())));
assert.equal(globalSelectionBlocks.length, 0, "selection is not disabled on html, body, or a global body state");
assert.match(app, /classList\.add\("tap-action-target"\)/, "custom tap targets opt into the non-selectable control policy");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service worker and app versions match");
assert.ok(html.includes(`app.js?v=${version}`), "HTML loads the current app version");
assert.ok(html.includes(`map.js?v=${version}`), "HTML loads the current map gesture code");
assert.ok(html.includes(`styles.css?v=${version}`), "HTML loads the current interaction styles");
assert.ok([...html.matchAll(/\?v=([\d.]+)/g)].every(([, assetVersion]) => assetVersion === version), "all versioned HTML assets use the current app version");
assert.equal(serviceWorker.match(/const CACHE = "nearcast-v(\d+)"/)?.[1], version.replaceAll(".", ""), "the service-worker cache key follows the current app version");

console.log(`Interaction gesture smoke passed for Nearcast ${version}.`);
