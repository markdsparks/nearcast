import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, serviceWorker, phoneWidget, phoneWidgetInfo, watchApp, watchEntry, watchReceiver, nativeBridge, complications, sync, snapshot, visualSignal] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWidget/NearcastWidget.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWidget/Info.plist"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatch/NearcastWatchRootView.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatch/NearcastWatchApp.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatch/NearcastWatchSnapshotReceiver.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastApp/Bridge/NativeBridge.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastWatchComplications/NearcastWatchComplications.swift"), "utf8"),
  readFile(path.join(root, "native/ios/NearcastApp/Bridge/NativeWatchSnapshotSync.swift"), "utf8"),
  readFile(path.join(root, "native/ios/Shared/NearcastWidgetSnapshot.swift"), "utf8"),
  readFile(path.join(root, "native/ios/Shared/NearcastWatchVisualSignal.swift"), "utf8")
]);

assert.match(phoneWidget, /projectedWidgetEntries[\s\S]*timelineProjection\(at: date, relativeTo: now\)/, "iPhone widgets advance from cached hourly forecast entries");
assert.match(phoneWidget, /nearcastWidgetProjectionHorizon: TimeInterval = 24 \* 60 \* 60/, "iPhone widgets retain a full-day projection horizon");
assert.match(phoneWidget, /start \+ 24/, "native widget refreshes retain 25 hourly rows including the active hour");
assert.match(phoneWidget, /isAuthorizedForWidgetUpdates[\s\S]*2_500_000_000[\s\S]*requestLocation\(\)/, "Current Location uses widget authorization and a bounded one-shot request");
assert.match(phoneWidget, /resolveWidgetPlace[\s\S]*selected\.tracksCurrentLocation/, "only an explicitly marked Current Location requests a live coordinate");
assert.match(phoneWidget, /resolution\.meaningfullyMoved \|\| shouldRefreshWidgetWeather[\s\S]*NearcastWidgetForecastClient\.fetchSnapshot/, "meaningful movement forces a new forecast regardless of cache age");
assert.match(phoneWidget, /sameWidgetSelection[\s\S]*tracksCurrentLocation[\s\S]*latitude[\s\S]*longitude/, "widget refreshes discard a result after the selected place changes");
assert.match(phoneWidget, /canRefreshResolvedPlace[\s\S]*resolution\.usedLiveLocation[\s\S]*refreshWidgetAlert[\s\S]*allowed: canRefreshResolvedPlace/, "Current Location cannot stamp an unconfirmed old coordinate as freshly updated");
assert.match(phoneWidget, /nearcastWidgetResolvedLocationKey[\s\S]*saveWidgetRefreshResult[\s\S]*sameWidgetSelection/, "the widget keeps a separately guarded live-location fallback");
assert.match(phoneWidgetInfo, /<key>NSWidgetWantsLocation<\/key>\s*<true\/>/, "the iPhone widget opts into user-approved WidgetKit location access");
assert.match(app, /followsCurrentLocation: reactiveSkyIsCurrentLocation\(place\)/, "the phone snapshot explicitly identifies Current Location");
assert.match(app, /rows\.length < 25/, "phone-authored snapshots retain a full day of hourly entries");
assert.match(app, /followsCurrentLocation: false/, "saving a GPS-derived place freezes it instead of following the device");
assert.match(app, /typeof place\.followsCurrentLocation === "boolean"[\s\S]*normalized\.followsCurrentLocation = place\.followsCurrentLocation/, "place normalization preserves explicit current-location intent without freezing legacy GPS places");
assert.match(app, /refreshCurrentLocationAfterNativeReopen[\s\S]*requestDeviceLocationOnce[\s\S]*loadPlace\(resolved, true\)/, "the native app quietly re-resolves Current Location on an ordinary reopen");
assert.match(nativeBridge, /resolvedWidgetLocationMeaningfullyDiffers[\s\S]*incoming\.mergingWeather\(from: destination\)/, "a stale web warm start cannot overwrite newer extension-resolved Current Location weather");
assert.match(snapshot, /var followsCurrentLocation: Bool\?[\s\S]*var tracksCurrentLocation: Bool/, "shared place data defaults legacy places to fixed behavior");
assert.match(phoneWidget, /weatherValidUntil[\s\S]*weatherExpired:[\s\S]*date >= weatherValidUntil/, "the iPhone widget appends an explicit expired-weather state");
assert.match(phoneWidget, /NearcastWidgetUpdateNeededView[\s\S]*Weather needs an update/, "expired iPhone widget entries visibly ask for an update");
assert.match(snapshot, /func weatherTimelineValidUntil[\s\S]*lastOffset \+ 1/, "shared forecast validity honors timestamped and legacy offset-only horizons");
assert.match(snapshot, /func shouldPromoteCurrentWeather[\s\S]*activeRow\.startsAt[\s\S]*weatherSavedTime/, "old observations yield to the forecast row active after their save time");

assert.match(complications, /complicationWeatherValidUntil[\s\S]*weatherTimelineValidUntil/, "weather remains useful through the shared final cached forecast interval");
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
assert.match(watchApp, /struct WatchHourlyForecastCard[\s\S]*metricRailWidth[\s\S]*WatchHourlyForecastColumns[\s\S]*WatchHourlyRainBand[\s\S]*WatchHourlyWindBand/, "hourly temperature, rain, and wind share one metric rail and hourly grid");
assert.match(watchApp, /struct WatchHourlyForecastColumns[\s\S]*frame\(width: metricRailWidth\)[\s\S]*watchCompactHourLabel/, "hourly forecast columns reserve the same rail without shrinking full phone time labels");
assert.match(watchApp, /struct WatchHourlyRainBand/, "hourly rain uses one aligned probability band");
assert.match(watchApp, /struct WatchHourlyWindBand/, "hourly wind preserves direction and shows the speed trend");
assert.match(watchApp, /struct WatchHourlyWindTrail[\s\S]*nearcastHourlyColumnCenter/, "wind points sit at the centers of the shared hourly columns");
assert.doesNotMatch(watchApp, /trailWidth:|ViewThatFits\(in: \.horizontal\)[\s\S]{0,500}WatchHourlyWindTrail/, "hourly wind no longer uses a disconnected trailing chart");
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
assert.match(complications, /complicationTimelineDates[\s\S]*24 \* 60 \* 60[\s\S]*compactMap\(\\\.startsAt\)/, "complications advance on cached forecast boundaries across the available day");
assert.match(complications, /let staleDate = complicationWeatherValidUntil\(snapshot\)[\s\S]*dates\.append\(staleDate\)/, "the complication timeline ends with an explicit stale state");
assert.match(complications, /timeoutInterval: 8/, "complication networking leaves time for a cached fallback");
assert.match(complications, /shouldPromoteCurrentWeather\(from: projection\)/, "the current complication entry preserves a newer observation but advances an old one");
assert.match(complications, /latest\.weatherSavedTime >= weather\.weatherSavedTime[\s\S]*return latest/, "cached complication weather cannot overwrite a newer shared snapshot");
assert.match(complications, /let snapshot = NearcastWidgetSnapshot\.stored\(\) \?\? refreshed/, "the complication re-reads the shared winner after an asynchronous refresh");
assert.match(complications, /guard !requestedPlace\.tracksCurrentLocation else \{ return nil \}/, "complications never stamp the phone's old Current Location coordinate as fresh weather");
assert.match(watchApp, /timeoutInterval: 8/, "watch app networking uses a bounded background-safe timeout");
const watchAppInitializer = watchEntry.match(/init\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*var body/)?.[1] ?? "";
assert.doesNotMatch(watchAppInitializer, /NearcastWatchBackgroundRefresh\.schedule\(\)/, "watch app never schedules refresh before SwiftUI installs its background-task handler");
assert.match(watchEntry, /backgroundTask\(\.appRefresh\(NearcastWatchBackgroundRefresh\.identifier\)\)/, "watch app handles scheduled app refreshes");
assert.match(watchEntry, /backgroundTask\(\.watchConnectivity\)/, "watch app handles background WatchConnectivity delivery");
assert.match(watchEntry, /scheduleBackgroundRefresh[\s\S]*static func perform\(\) async[\s\S]*await schedule\(\)[\s\S]*NearcastWatchWeatherClient\.refresh[\s\S]*reloadAllTimelines/, "watch background refresh reschedules before doing bounded network work");
assert.match(watchReceiver, /handleBackgroundDelivery\(\) async[\s\S]*schedule\(\)[\s\S]*activate\(\)[\s\S]*receivedApplicationContext[\s\S]*Task\.sleep/, "background connectivity activation waits briefly for the latest application context");
assert.match(watchApp, /watchSnapshotForDisplay[\s\S]*weatherTimelineValidUntil[\s\S]*shouldPromoteCurrentWeather[\s\S]*projectDailyWeather/, "the Watch app projects cached hourly and daily weather but expires the final forecast");
assert.match(watchApp, /authorizationStatus[\s\S]*authorizedWhenInUse[\s\S]*3_000_000_000[\s\S]*maximumHorizontalAccuracy/, "Current Location uses a bounded, quality-gated Watch fix");
assert.match(watchApp, /allowsLocationAuthorizationRequest: true[\s\S]*notDetermined where allowsAuthorizationRequest[\s\S]*requestWhenInUseAuthorization/, "only the visible Watch app can request its one-time Current Location permission");
assert.match(watchApp, /manager\.location\.map[\s\S]*guard allowsAuthorizationRequest else \{ return nil \}[\s\S]*manager\.requestLocation\(\)/, "a background Watch wake can consume a recent cached fix but never starts a When-In-Use location session");
assert.match(watchEntry, /NearcastWatchWeatherClient\.refresh\(fallback: fallback\)/, "scheduled Watch refresh uses the no-prompt location default");
assert.match(watchApp, /tracksCurrentLocation[\s\S]*NearcastWatchLocationRequest\.current/, "Watch resolves an authorized live coordinate for Current Location");
assert.match(watchApp, /sameSelection\(resolution\.selected, finalPlace\)[\s\S]*NearcastWidgetSnapshotStore\.save/, "Watch rechecks the selected place immediately before saving weather");

assert.match(sync, /snapshotData != lastSnapshotData/, "phone-to-watch snapshots are deduplicated");
assert.doesNotMatch(sync, /session\.transferUserInfo\(payload\)/, "current-state snapshots do not create a stale delivery queue");
assert.match(sync, /remainingComplicationUserInfoTransfers > 0/, "priority transfers respect the system budget");
assert.match(snapshot, /var daily: \[NearcastWidgetDay\]\?/, "shared snapshots carry daily basics");
assert.match(snapshot, /func preservingNewerWeather\(from stored:/, "shared snapshots arbitrate out-of-order weather by freshness");
assert.match(snapshot, /func timelineProjection\(at date:[\s\S]*advancesCurrentWeather/, "shared timeline projection distinguishes current observations from future forecast rows");
assert.match(app, /daily: nativeWidgetDaily\(data\)/, "the phone sends daily basics to the watch");

const version = app.match(/const VERSION = "([^"]+)"/)?.[1];
assert.ok(version, "app version is declared");
assert.equal(serviceWorker.match(/const ASSET_VERSION = "([^"]+)"/)?.[1], version, "service-worker version matches app version");
assert.ok(html.includes(`app.js?v=${version}`), "HTML loads the current app version");

console.log(`Watch basics smoke passed for Nearcast ${version}.`);
