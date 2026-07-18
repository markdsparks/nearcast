import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [daygraph, styles] = await Promise.all([
  readFile(path.join(root, "daygraph.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);

const rowMarkup = daygraph.match(/function renderHourlyRowsMarkup\([\s\S]*?\n}\n\nfunction renderHourlyList/)?.[0] || "";
assert.ok(rowMarkup, "hourly row renderer is present");
assert.doesNotMatch(rowMarkup, /sheet-hour-badges|sheet-hour-chip/, "collapsed hourly rows contain no repeated exception pills");
assert.match(rowMarkup, /sheet-hour-temp[\s\S]*Math\.round\(hour\.temp\)}°/, "collapsed temperature uses one compact degree value");
assert.match(rowMarkup, /sheet-hour-wind[\s\S]*<strong>\$\{windSpeed}/, "collapsed wind keeps its arrow and numeric speed without a clipped unit");
assert.match(rowMarkup, /sheet-hour-wind[\s\S]*sheet-hour-cue/, "the disclosure cue is its own grid item after the core metrics");
assert.match(daygraph, /hourlyAlertDividerHtml\([\s\S]*sheet-hour-alert-divider/, "hourly alerts appear once as a block divider");
assert.match(daygraph, /<button class="sheet-hour-alert-divider[\s\S]*type="button"[\s\S]*data-alert-key/, "hourly alert dividers are native buttons with stable alert identity");
assert.match(daygraph, /aria-label="\$\{escapeHtml\(`Open \$\{event\} details/, "hourly alert buttons announce their action");
assert.match(daygraph, /sheet-hour-alert-cue" aria-hidden="true">›/, "hourly alert buttons expose a visual disclosure cue");
assert.match(daygraph, /previousAlertKey:[\s\S]*lastAlertKey/, "rolling hourly pages preserve alert-divider continuity");

assert.doesNotMatch(styles, /\.sheet-hour-chip/, "obsolete microtext chip styling is removed");
assert.match(styles, /\.sheet-hour-time\s*\{[\s\S]*white-space:\s*nowrap/, "hour labels cannot wrap into stacked text");
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*grid-template-columns:\s*46px 26px minmax\(46px, 1fr\) minmax\(44px, 1fr\) minmax\(56px, 1fr\) 14px/, "phone rows share spare width across the three metric columns");
assert.match(styles, /\.sheet-hour-temp,[\s\S]*\.sheet-hour-wind\s*\{[\s\S]*justify-self:\s*center/, "hourly metrics sit in the center of their shared tracks");
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.sheet-hour-rain,[\s\S]*font-size:\s*0\.84rem/, "phone rain and wind values retain a readable visual size");
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.sheet-hour-rain span,[\s\S]*width:\s*13px;[\s\S]*height:\s*13px/, "phone rain and wind symbols remain visually legible");
assert.match(styles, /\.sheet-hour-alert-divider\s*\{[\s\S]*grid-template-columns:\s*8px minmax\(0, 1fr\) auto 14px/, "alert buttons protect their title, timing, and cue");
assert.match(styles, /\.sheet-hour-alert-divider\s*\{[\s\S]*min-height:\s*44px/, "alert buttons keep a full touch target");
assert.match(styles, /\.sheet-hour-alert-divider:focus-visible\s*\{[\s\S]*outline:/, "alert buttons expose keyboard focus");

console.log("Hourly row layout smoke passed.");
