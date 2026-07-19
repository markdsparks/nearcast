import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, daygraph, html, styles, serviceWorker] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "daygraph.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8")
]);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Found ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `Found ${name} signature`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
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

const sandbox = {
  localDateTimeParts: () => null,
  forecastOffsetMs: (data) => Number(data?.offsetMs) || 0,
  formatClock: (hour, _minute, compact) => {
    const normalized = ((Number(hour) % 24) + 24) % 24;
    const display = normalized % 12 || 12;
    const suffix = normalized < 12 ? "AM" : "PM";
    return compact ? `${display}${suffix[0].toLowerCase()}` : `${display} ${suffix}`;
  }
};
vm.createContext(sandbox);
vm.runInContext(`
  ${extractFunction(daygraph, "precipGraphChance")}
  ${extractFunction(daygraph, "precipGraphAmount")}
  ${extractFunction(daygraph, "precipGraphScaleMax")}
  ${extractFunction(daygraph, "precipGraphAmountLabel")}
  ${extractFunction(daygraph, "formatPrecipGraphAmount")}
  ${extractFunction(daygraph, "formatPrecipGraphTotal")}
  ${extractFunction(daygraph, "formatPrecipGraphPeak")}
  ${extractFunction(daygraph, "precipGraphHourLabel")}
  ${extractFunction(daygraph, "precipGraphState")}
  ${extractFunction(daygraph, "precipStepPaths")}
  ${extractFunction(app, "formatHour")}
  globalThis.graphTest = {
    chance: precipGraphChance,
    amount: precipGraphAmount,
    scale: precipGraphScaleMax,
    amountText: formatPrecipGraphAmount,
    totalText: formatPrecipGraphTotal,
    peakText: formatPrecipGraphPeak,
    hourText: precipGraphHourLabel,
    safeHour: formatHour,
    state: precipGraphState,
    paths: precipStepPaths
  };
`, sandbox);

const graph = sandbox.graphTest;
assert.equal(graph.chance({ forecastPop: 120, popAvailable: true }), 100, "chance is capped at 100%");
assert.equal(graph.chance({ forecastPop: -4, popAvailable: true }), 0, "chance is floored at zero");
assert.equal(graph.chance({ forecastPop: "70", popAvailable: true }), null, "nonnumeric chance remains unavailable");
assert.equal(graph.chance({ pop: 70, popAvailable: false }), null, "missing chance is not coerced to zero");
assert.equal(graph.amount({ forecastPrecip: -1, precipAvailable: true }), 0, "negative amount is sanitized");
assert.equal(graph.amount({ precip: 0.2, precipAvailable: false }), null, "missing amount is not replaced by live truth");
assert.equal(graph.amount({ forecastPrecip: 0.2, precip: 2, precipAvailable: true }), 0.2, "raw forecast amount wins over boosted current truth");

assert.equal(graph.scale([], "in"), 0.05, "dry imperial graphs keep a semantic scale");
assert.equal(graph.scale([0.08], "in"), 0.1, "imperial scale rounds to a readable ceiling");
assert.equal(graph.scale([0.31], "in"), 0.5, "imperial downpours do not redefine the scale to their exact peak");
assert.equal(graph.scale([3], "mm"), 7.5, "metric scale rounds to a readable ceiling");
assert.equal(graph.amountText(0.004, "in"), "Trace this hour", "tiny imperial accumulation is shown as trace");
assert.equal(graph.amountText(0.05, "mm"), "Trace this hour", "tiny metric accumulation is shown as trace");
assert.equal(graph.amountText(0.01, "in"), "0.01 in this hour", "measurable imperial accumulation stays numeric");
assert.equal(graph.amountText(0, "in"), "No forecast amount", "a legitimate zero stays distinct from missing data");
assert.equal(graph.amountText(null, "mm"), "Forecast amount unavailable", "missing amount is explicit");
assert.equal(graph.totalText(0.004, "in"), "Trace", "a trace total never contradicts the hourly trace label with 0.00");
assert.equal(graph.totalText(0.42, "in"), "0.42 in", "a measurable total keeps its unit");
assert.equal(graph.peakText(0.004, "in"), "peak trace", "a trace-only graph never labels its peak as zero");
assert.equal(graph.peakText(0.22, "in"), "peak 0.22 in", "a measurable peak reports the actual forecast value");
assert.equal(
  graph.hourText({ time: "not-a-time", ms: Date.UTC(2026, 0, 1, 15) }, { offsetMs: 0 }),
  "3 PM",
  "an invalid provider timestamp still has a safe fallback readout"
);
assert.equal(graph.safeHour("not-a-time"), "--", "the full day-detail sheet safely formats an invalid hourly timestamp");

assert.equal(graph.state([{ forecastPop: 0, popAvailable: true, forecastPrecip: 0, precipAvailable: true }]).kind, "dry", "all-zero data renders the calm dry state");
assert.equal(graph.state([{ forecastPop: 70, popAvailable: true, forecastPrecip: 0, precipAvailable: true }]).kind, "chance-only", "chance remains visible without accumulation");
assert.equal(graph.state([{ forecastPop: 0, popAvailable: true, forecastPrecip: 0.2, precipAvailable: true }]).kind, "wet", "amount is not discarded when chance is low");
assert.equal(graph.state([{ popAvailable: false, precipAvailable: false }]).kind, "unavailable", "fully missing data is not called dry");
assert.equal(
  graph.state([{ forecastPop: 0, popAvailable: true, forecastPrecip: 0, precipAvailable: true, activePrecip: true }]).label,
  "No additional precipitation forecast",
  "active radar truth is not contradicted by the dry forecast message"
);
assert.equal(
  graph.state([
    { forecastPop: 0, popAvailable: true, forecastPrecip: 0, precipAvailable: true },
    { popAvailable: false, precipAvailable: false }
  ]).label,
  "Available hours are dry",
  "partial dry data is qualified rather than presented as a complete forecast"
);
assert.equal(
  graph.state([{ popAvailable: false, precipAvailable: false, activePrecip: true }]).label,
  "Forecast data unavailable",
  "active radar detection is not contradicted when forecast data is unavailable"
);
assert.equal(
  graph.state([
    { forecastPop: 10, popAvailable: true, forecastPrecip: 0.1, precipAvailable: true },
    { forecastPop: 20, popAvailable: true, precipAvailable: false }
  ]).hasMissingAmount,
  true,
  "partial amount coverage is carried into the visual state"
);

const continuous = graph.paths([
  { chance: 20, xStart: 0, xEnd: 10, chanceY: 80 },
  { chance: 80, xStart: 10, xEnd: 20, chanceY: 20 }
], 100);
assert.equal(continuous.length, 1, "adjacent probability bins form one stepped area");
assert.match(continuous[0].line, /H 10\.0 V 20\.0 H 20\.0/, "probability changes with a vertical step, not an overshooting spline");
const gapped = graph.paths([
  { chance: 20, xStart: 0, xEnd: 10, chanceY: 80 },
  { chance: null, xStart: 10, xEnd: 20, chanceY: 100 },
  { chance: 40, xStart: 20, xEnd: 30, chanceY: 60 }
], 100);
assert.equal(gapped.length, 2, "missing probability leaves a visible gap");

const tempIndex = html.indexOf('id="graphTempBtn"');
const precipIndex = html.indexOf('id="graphPrecipBtn"');
const windIndex = html.indexOf('id="graphWindBtn"');
const sunIndex = html.indexOf('id="graphSunBtn"');
assert.ok(tempIndex < precipIndex && precipIndex < windIndex && windIndex < sunIndex, "tabs read Temp, Precip, Wind, Sun");
assert.match(app, /graphPrecipBtn"\), \(\) => setGraphMetric\("precip"\)/, "Precip tab has a tap binding");
assert.match(daygraph, /metric === "precip" \|\| metric === "wind" \|\| metric === "sun"/, "metric state accepts Precip");
assert.match(daygraph, /precipBtn\.setAttribute\("aria-pressed", String\(isPrecip\)\)/, "Precip participates in exclusive pressed state");
assert.match(daygraph, /if \(isPrecip\) \{\s*drawPrecipGraph\(\)/, "Precip uses its dedicated renderer");
assert.doesNotMatch(daygraph, /const precipBars|\$\{precipBars\}/, "Temp and Wind no longer carry the ambiguous mini probability strip");
assert.match(daygraph, /const tempTop = 34, tempBottom = 136/, "Temp and Wind keep a label lane while reclaiming the former mini-strip space");
assert.match(daygraph, /labelY: 28/, "Temp and Wind memory labels clear both their curves and the Now pill");
assert.match(daygraph, /const rawForecastPop = data\.hourly\.precipitation_probability\?\.\[h\]/, "hour records preserve raw forecast chance availability");
assert.match(daygraph, /const rawForecastPrecip = data\.hourly\.precipitation\?\.\[h\]/, "hour records preserve raw forecast amount availability");
assert.match(daygraph, /const truth = data === state\.forecast \? state\.weatherTruth : null/, "live radar truth cannot leak into another place's retained forecast");
assert.match(daygraph, /return forecastUsesInches\(data\) \? "in" : "mm"/, "precipitation labels follow the supplied forecast's units");
assert.match(daygraph, /xStart = xForMs\(ms\)[\s\S]*xEnd = xForMs\(ms \+ hourMs\)/, "amount bins use the same start-hour convention as Nearcast's hourly rows");
assert.match(daygraph, /fallbackBaseMs = firstValidMs - Math\.max\(firstValidIndex, 0\) \* hourMs/, "invalid timestamps stay aligned to the valid hourly domain");
assert.doesNotMatch(daygraph, /const long = formatHour\(point\.time\)/, "invalid timestamps are never passed to the throwing generic hour formatter");
assert.match(daygraph, /Math\.max\(4, Math\.min\(9, binWidth \* 0\.68\)\)/, "amount bars remain readable without becoming enormous");
assert.match(daygraph, /graph-precip-detected/, "live precipitation is a marker separate from forecast amount bars");
assert.match(daygraph, /cx="\$\{nowX\.toFixed\(1\)\}"/, "live precipitation is drawn at the actual Now position");
assert.match(daygraph, /const cy = chanceTop \+ 8/, "live detection has a fixed position independent of forecast accumulation");
assert.match(daygraph, /formatPrecipGraphPeak\(stateForGraph\.maxAmount, precipUnit\)/, "the visible peak label reports the actual trace-aware forecast value, not the chart ceiling");
assert.match(daygraph, /x="\$\{points\[index\]\.x\.toFixed\(1\)\}"/, "axis labels align with their bars and scrub points");
assert.match(daygraph, /graph-precip-amount-missing/, "partial amount coverage has a visible missing-bin treatment");
assert.match(daygraph, /graph-precip-chance-missing/, "partial chance coverage has a visible missing-bin treatment");
assert.match(daygraph, /dashed = missing/, "the Precip legend explains visible chance or amount gaps");
assert.match(daygraph, /minLabelWidth: Infinity/, "Precip memory bands stay interactive without colliding annotation text");
assert.match(daygraph, /role="group" aria-labelledby="precipGraphTitle precipGraphDescription"/, "the interactive chart is exposed as a labelled group");
assert.match(daygraph, /role="slider"[\s\S]*aria-valuetext/, "the precipitation scrubber exposes accessible slider values");
assert.match(daygraph, /setAttribute\("aria-live", isPrecip \? "off" : "polite"\)/, "the slider owns Precip announcements without pointer-move chatter");
assert.match(daygraph, /hit\.addEventListener\("pointerdown"[\s\S]*event\.preventDefault\(\)[\s\S]*update\(nearest\(event\.clientX\)\)/, "pointer inspection does not leave keyboard focus styling behind");
assert.match(daygraph, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowDown"[\s\S]*event\.key === "ArrowRight" \|\| event\.key === "ArrowUp"[\s\S]*event\.key === "Home"[\s\S]*event\.key === "End"/, "keyboard users can scrub the graph in either axis");
assert.match(daygraph, /points\.findIndex\(\(point\) => isCurrentHour\(point\.time, data\)\)/, "current-day graphs default to the current hourly row for the whole hour");
assert.match(daygraph, /forecastAmounts\.length < hrs\.length[\s\S]*≥\$\{formatPrecipGraphTotal/, "partial precipitation totals preserve known accumulation without appearing complete");
assert.match(daygraph, /\? "Trace\+"/, "a partial trace total stays readable");
assert.match(daygraph, /hour\?\.popAvailable === false\) return "—"/, "hourly rows do not turn missing rain chance into zero percent");
assert.match(daygraph, /hour\.precipAvailable === false[\s\S]*\? "Unavailable"/, "hourly detail does not turn missing accumulation into zero");
assert.match(daygraph, /some rain data unavailable/, "partial rain-chance summaries disclose forecast gaps at every risk level");
assert.match(styles, /\.graph-metric\.is-precip \.graph-metric-hint[\s\S]*flex:\s*1 0 100%/, "the longer Precip legend wraps below four tabs");
assert.match(styles, /\.graph-precip-amount-bar\.is-selected/, "the selected accumulation bar has a non-color highlight");
assert.match(styles, /#graphPrecipHit:focus-visible \+ \.graph-precip-focus-ring/, "keyboard focus is visible without persisting after touch input");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker assets match the app version");
assert.equal(serviceWorker.match(/const CACHE = "nearcast-v(\d+)"/)?.[1], version.replaceAll(".", ""), "cache key follows the app version");
assert.ok([...html.matchAll(/\?v=([\d.]+)/g)].every(([, assetVersion]) => assetVersion === version), "all HTML assets use the new graph version");

console.log(`Hourly precipitation graph smoke passed for Nearcast ${version}.`);
