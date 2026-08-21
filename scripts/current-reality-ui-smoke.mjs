import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, css, app] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "app.js"), "utf8")
]);

assert.match(html, /id="localReadingMark"[^>]*hidden/, "Home has one Local reading marker that begins quietly hidden");
assert.match(html, /id="localReadingMark"[\s\S]*?<span>Local reading<\/span>/, "the marker uses human language instead of implementation vocabulary");
assert.ok(html.indexOf('id="localReadingMark"') > html.indexOf('id="heroRange"'), "Local reading follows the temperature range instead of competing with the hero number");
assert.match(css, /\.local-reading-mark\s*\{[\s\S]*?font-size:\s*0\.68rem[\s\S]*?\}/, "the marker stays visually secondary");
assert.match(css, /\.local-reading-mark\[hidden\]\s*\{\s*display:\s*none/, "normal estimated conditions never reserve space for a missing marker");
assert.match(css, /data-tone="localized"/, "the existing evidence affordance gains a calm localized state instead of another card");

assert.match(app, /localReadingMark:\s*document\.querySelector\("#localReadingMark"\)/, "Home binds the Local reading marker once");
assert.match(app, /const localized = Boolean\(reality\?\.applied\)/, "the marker appears only when observations actually changed the reading");
assert.match(app, /trigger = "Local reading"/, "the existing evidence line explains a localized current reading");
assert.match(app, /if \(!radarObserved[\s\S]*?reality\?\.applied\)[\s\S]*?trigger = "Local reading"/, "radar remains the primary explanation whenever it has a direct precipitation observation");
assert.doesNotMatch(app, /confidence[^\n]{0,40}Local reading/i, "the Local reading state does not repurpose forecast-confidence language");

console.log("PASS  Local reading stays earned, quiet, and subordinate to radar");
