import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const styles = readFileSync(new URL("styles.css", root), "utf8");
const app = readFileSync(new URL("app.js", root), "utf8");

const menu = html.match(/<div class="app-menu"[\s\S]*?<\/div>\s*<\/section>\s*<section class="welcome"/)?.[0] || "";
assert.ok(menu, "weather controls menu is present");

assert.match(menu, /data-label="Find"/, "place search has a visible family-facing label");
assert.match(menu, /data-label="Appearance"/, "appearance control has a visible label");
assert.match(menu, /data-label="Units"/, "unit control has a visible label");
assert.match(menu, /Living sky[\s\S]*Weather &amp; privacy/, "primary settings use human language and expose a quiet trust disclosure");
assert.match(menu, /Forecast updates[\s\S]*Notifications are your choice[\s\S]*No account needed/, "trust disclosure explains freshness, notification choice, and privacy");
assert.match(menu, /id="appVersion"[^>]*data-debug-setting[^>]*hidden/, "version detail stays out of the primary family menu");
assert.match(menu, /id="nativeLiveActivitySetting"[^>]*data-debug-setting[^>]*hidden/, "the native activity lab remains diagnostic-only");
assert.match(menu, /class="menu-diagnostics-label"[^>]*data-debug-setting[^>]*hidden/, "technical controls have an explicit secondary diagnostics group");
assert.doesNotMatch(menu.match(/<strong id="reactiveSkyLabel">([\s\S]*?)<\/strong>/)?.[1] || "", /Experimental|WebGL|provider/i, "the visible sky setting avoids implementation language");

assert.match(html, /class="welcome-privacy">No account needed · location is used only to load your weather\.<\/p>/, "first run explains location use without adding a permission gate");
assert.match(html, /id="welcomeLocate"[\s\S]*Use my location[\s\S]*class="welcome-privacy"/, "first run remains weather-first with location as a direct action");
assert.match(html, /id="installSheetSummary">[^<]*Notifications stay off until you choose something to watch\./, "install help does not imply notification opt-in");

assert.match(styles, /\.app-menu \{[\s\S]*max-height:[^;]+;[\s\S]*overflow-y: auto;/, "expanded settings remain scrollable on short phones");
assert.match(styles, /\.app-menu \.icon-button::after[\s\S]*content: attr\(data-label\)/, "compact preference controls render their labels");
assert.match(styles, /\.menu-trust-details[\s\S]*\.menu-trust-body/, "trust details have a polished disclosure layout");
assert.match(styles, /\.mode-welcome \.welcome-privacy[\s\S]*display: block/, "privacy reassurance is visible only in first-run mode");

assert.match(app, /Notifications stay off until you choose something to watch\./, "runtime install copy preserves explicit notification choice");
assert.match(app, /nativeLiveActivitySetting\.hidden = !DEBUG_SETTINGS_ENABLED \|\| !isNativeNearcastApp\(\)/, "native labs cannot leak into production settings");
assert.match(app, /themeToggle\.setAttribute\("aria-label", els\.themeToggle\.title\)/, "appearance control announces its current action");
assert.match(app, /unitToggle\.setAttribute\("aria-label", els\.unitToggle\.title\)/, "unit control announces its current action");

console.log("PASS settings and first-run onboarding stay quiet, human, and privacy-clear");
