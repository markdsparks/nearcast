import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, serviceWorker, watchApp, complications, sync, snapshot, visualSignal] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatch/NearcastWatchRootView.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatchComplications/NearcastWatchComplications.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastApp/Bridge/NativeWatchSnapshotSync.swift"), "utf8"),
  readFile(path.join(root, "native/ios/Shared/NearcastWidgetSnapshot.swift"), "utf8"),
  readFile(path.join(root, "native/ios/Shared/NearcastWatchVisualSignal.swift"), "utf8")
]);

assert.match(complications, /staleAfter: TimeInterval = 12 \* 60 \* 60/, "weather remains useful through ordinary WidgetKit delays");
assert.match(complications, /configurationDisplayName\("Temperature"\)/, "temperature complication has a stable identity");
assert.match(complications, /configurationDisplayName\("Rain"\)/, "rain complication has a stable identity");
assert.match(complications, /configurationDisplayName\("Wind"\)/, "wind complication has a stable identity");
assert.match(complications, /configurationDisplayName\("Today Basics"\)/, "rectangular complication exposes fixed basics");
assert.match(complications, /Text\("\\\(entry\.snapshot\.temperature\)°"\)/, "temperature complication uses the current temperature directly");
assert.match(complications, /struct NearcastBasicsRectangle/, "rectangular complication has a dedicated visual composition");
assert.match(complications, /struct ComplicationTemperatureTrack/, "rectangular complications preserve the daily temperature range");
assert.match(complications, /struct ComplicationTemperatureBezel[\s\S]*Gauge\(/, "only temperature uses a meaningful low-to-high corner gauge");
assert.equal(complications.match(/\bGauge\(/g)?.length, 1, "temperature is the only complication encoded as a gauge");
assert.match(complications, /struct ComplicationRainBars/, "rain chance uses a short hourly bar sequence");
assert.match(complications, /Image\(systemName: "drop\.fill"\)[\s\S]*Text\("\\\(snapshot\.rainChance\)%"\)/, "rain is encoded as a drop and value without a repeated label");
assert.match(complications, /NearcastWindMark\(snapshot: entry\.snapshot/, "small wind complications pair current speed with current direction");
assert.match(complications, /struct NearcastComplicationTint[\s\S]*widgetRenderingMode[\s\S]*\.fullColor/, "complication colors adapt to the watch face rendering mode");
assert.match(complications, /struct NearcastInlineAccentLabelStyle[\s\S]*configuration\.icon[\s\S]*configuration\.title/, "inline complications accent only their icon");
assert.match(complications, /NearcastComplicationColor\.rain[\s\S]*NearcastComplicationColor\.warm/, "temperature ranges use a cool-to-warm color track");
assert.match(complications, /NearcastRainMark[\s\S]*nearcastComplicationTint\(NearcastComplicationColor\.rain\)/, "small rain complications carry the rain accent");
assert.match(complications, /NearcastWindMark[\s\S]*nearcastComplicationTint\(NearcastComplicationColor\.wind\)/, "small wind complications carry the wind accent");
assert.match(complications, /NearcastPlanMark[\s\S]*NearcastComplicationColor\.signal\(plan\.tone\)/, "Plan Check color follows its verdict");
assert.match(complications, /complicationBasicsMetricsWidth[\s\S]*totalWidth \* 0\.47/, "Today Basics protects nearly half its width for wind and rain");
assert.match(complications, /Text\(complicationCardinalDirection\(snapshot\)\)[\s\S]*fixedSize\(horizontal: true/, "wind direction cannot collapse into an ellipsis");
assert.match(complications, /ComplicationRainBars[\s\S]*minWidth: 16[\s\S]*idealWidth: 27/, "rain bars yield before metric text");
assert.match(complications, /complicationCardinalDirection[\s\S]*if let degrees = snapshot\.windDirection[\s\S]*cardinalDirection\(degrees\)/, "the complication uses a compact cardinal instead of a verbose phone label");
assert.match(visualSignal, /func nearcastWindFlowDegrees\(from sourceDegrees: Int\?\)[\s\S]*normalizedSource \+ 180/, "Watch arrows convert meteorological source bearings into flow directions");
assert.equal(watchApp.match(/nearcastWindFlowDegrees\(from:/g)?.length, 2, "both Watch app wind arrows use the shared flow direction");
assert.equal(complications.match(/nearcastWindFlowDegrees\(from:/g)?.length, 3, "all Watch complications use the shared flow direction");
assert.doesNotMatch(complications, /Label\("Rain \\\(entry\.snapshot\.rainChance\)%"/, "rectangular complication does not spell out an icon's meaning");
assert.doesNotMatch(complications, /transferUserInfo/, "complication source contains no queued phone transfer behavior");

assert.match(watchApp, /case today[\s\S]*case hours[\s\S]*case days[\s\S]*case plan/, "watch navigation uses stable surfaces");
assert.match(watchApp, /struct WatchTodayBasicsPage/, "watch app includes Today basics");
assert.match(watchApp, /struct WatchBasicHoursPage/, "watch app includes fixed hourly rows");
assert.match(watchApp, /struct WatchThreeDayPage/, "watch app includes a three-day view");
assert.match(watchApp, /struct WatchTodayInfographic/, "Today uses one unified infographic instead of copied gauges");
assert.match(watchApp, /struct WatchTemperatureRange/, "temperature preserves current, low, and high as a truthful range");
assert.match(watchApp, /struct WatchWindVector/, "wind uses direction plus speed");
assert.match(watchApp, /struct WatchRainProbability/, "rain uses probability plus an hourly sequence");
assert.match(watchApp, /struct WatchHourlyForecastCard/, "hourly weather uses one continuous forecast composition");
assert.match(watchApp, /struct WatchHourlyForecastCard[\s\S]*VStack\(spacing: useUltraLayout \? 5 : 3\)[\s\S]*frame\(height: useUltraLayout \? 34 : 30\)/, "hourly time, condition, and temperature use shared rows with a fixed condition height");
assert.match(watchApp, /struct WatchHourlyRainBand/, "hourly rain uses one aligned probability band");
assert.match(watchApp, /struct WatchHourlyWindBand/, "hourly wind preserves direction and shows the speed trend");
assert.match(watchApp, /struct WatchDailyTemperatureTrack/, "daily rows compare low-to-high ranges on one shared scale");
assert.match(watchApp, /Text\(watchCompactDayLabel\(day\.label\)\)[\s\S]*frame\(width: useUltraLayout \? 47 : 43, alignment: \.leading\)/, "daily labels occupy a stable column");
assert.match(watchApp, /watchConditionSymbol\(day\.conditionCode, isDay: true\)[\s\S]*frame\(width: useUltraLayout \? 34 : 31, height: useUltraLayout \? 27 : 25\)/, "daily condition symbols occupy a stable column");
assert.match(watchApp, /struct WatchPlanMetricPlot/, "plan weather uses the visual instrument for its explicit risk");
assert.match(watchApp, /updated\.windLabel = nil/, "watch refresh cannot retain a stale cardinal label after direction changes");
assert.match(watchApp, /safeWatchSurface/, "conditionally absent Plan pages cannot leave the pager on a blank selection");
assert.match(watchApp, /-nearcastPreviewWeather/, "populated Watch layouts can be exercised in the simulator");
assert.doesNotMatch(watchApp, /Text\("RAIN"\)|Text\("TEMP"\)|Text\("WIND"\)/, "hourly weather does not use redundant table headings");
assert.match(watchApp, /forecast_hours", value: "24"/, "watch app caches a full day of hourly values");
assert.match(complications, /forecast_hours", value: "24"/, "complications can project a full day without a fresh wake-up");

assert.match(sync, /snapshotData != lastSnapshotData/, "phone-to-watch snapshots are deduplicated");
assert.doesNotMatch(sync, /session\.transferUserInfo\(payload\)/, "current-state snapshots do not create a stale delivery queue");
assert.match(sync, /remainingComplicationUserInfoTransfers > 0/, "priority transfers respect the system budget");
assert.match(snapshot, /var daily: \[NearcastWidgetDay\]\?/, "shared snapshots carry daily basics");
assert.match(app, /daily: nativeWidgetDaily\(data\)/, "the phone sends daily basics to the watch");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker version matches app version");
assert.ok(html.includes(`app.js?v=${version}`), "HTML loads the current app version");

console.log(`Watch basics smoke passed for Nearcast ${version}.`);
