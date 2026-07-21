import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL  \(message)\n".utf8))
        exit(1)
    }
    print("PASS  \(message)")
}

let encoder = JSONEncoder()
let decoder = JSONDecoder()
let now = Date().timeIntervalSince1970

var legacyObject = try JSONSerialization.jsonObject(with: encoder.encode(NearcastWidgetSnapshot.fallback)) as! [String: Any]
legacyObject["version"] = 4
legacyObject["savedAt"] = now - 10 * 60
legacyObject["placeName"] = "Maryville, Illinois"
legacyObject["temperature"] = 74
legacyObject["feelsLike"] = 76
legacyObject["condition"] = "Cloudy"
legacyObject["watchStatus"] = "Looks good"
legacyObject["watchDetail"] = "Dry through 2p"
legacyObject.removeValue(forKey: "isAvailable")
legacyObject.removeValue(forKey: "weatherSavedAt")
legacyObject.removeValue(forKey: "planSavedAt")
legacyObject.removeValue(forKey: "planId")
legacyObject.removeValue(forKey: "planAvailable")
legacyObject.removeValue(forKey: "planRisk")
legacyObject.removeValue(forKey: "planStartAt")
legacyObject.removeValue(forKey: "planEndAt")

let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)
let legacy = try decoder.decode(NearcastWidgetSnapshot.self, from: legacyData)
require(legacy.hasWeatherData, "V4 snapshots remain readable and available")
require(legacy.weatherAge >= 9 * 60, "V4 savedAt remains the weather freshness fallback")
require(!legacy.hasPlan, "V4 snapshots without plan fields do not invent a plan")
require(legacy.planStartAt == nil && legacy.planEndAt == nil, "V4 snapshots decode without a plan window")

var splitFreshness = legacy
splitFreshness.version = 5
splitFreshness.isAvailable = true
splitFreshness.savedAt = now
splitFreshness.weatherSavedAt = now
splitFreshness.planTitle = "Ballgame"
splitFreshness.planLabel = "Keep an eye on it"
splitFreshness.planDetail = "Rain becomes possible after 3p"
splitFreshness.planAvailable = true
splitFreshness.planSavedAt = now - 3 * 60 * 60
require(splitFreshness.weatherAge < 10, "direct weather freshness is current")
require(splitFreshness.planAge > 2 * 60 * 60, "plan freshness can age independently")

let unavailable = NearcastWidgetSnapshot.fallback
require(!unavailable.hasWeatherData, "runtime fallback is explicitly unavailable")
require(unavailable.temperature == 0 && unavailable.rainChance == 0, "runtime fallback contains no believable fake weather")
require(!unavailable.hasPlan && unavailable.planSavedTime == 0, "runtime fallback contains no fake plan")

let legacyPlaceData = Data(#"{"name":"Maryville","latitude":38.7237,"longitude":-89.9559}"#.utf8)
let legacyPlace = try decoder.decode(NearcastWidgetPlace.self, from: legacyPlaceData)
require(legacyPlace.displayLabel == "Maryville", "legacy widget places remain decodable")

let structuredPlaceData = Data(#"{"id":"maryville","name":"Maryville","displayName":"Maryville, Illinois","admin1":"Illinois","country":"United States","countryCode":"US","latitude":38.7237,"longitude":-89.9559}"#.utf8)
let structuredPlace = try decoder.decode(NearcastWidgetPlace.self, from: structuredPlaceData)
require(structuredPlace.name == "Maryville", "widget place keeps a canonical locality name")
require(structuredPlace.displayLabel == "Maryville, Illinois", "widget place keeps a separate display label")
require(!structuredPlace.tracksCurrentLocation, "legacy widget places remain fixed by default")

let currentPlaceData = Data(#"{"id":"gps-maryville","name":"Maryville","displayName":"Maryville, Illinois","followsCurrentLocation":true,"latitude":38.7237,"longitude":-89.9559}"#.utf8)
let currentPlace = try decoder.decode(NearcastWidgetPlace.self, from: currentPlaceData)
require(currentPlace.tracksCurrentLocation, "widget places explicitly identify Current Location")

func hour(
    _ offset: Int,
    _ label: String,
    startsAt: TimeInterval,
    temperature: Int = 64,
    rain: Int = 0,
    wind: Int = 8,
    gust: Int? = nil,
    code: Int = 2
) -> NearcastWidgetHour {
    NearcastWidgetHour(
        offsetHours: offset,
        timeLabel: label,
        temperature: temperature,
        feelsLike: temperature,
        rainChance: rain,
        wind: wind,
        windGust: gust,
        windDirection: 270,
        uv: 0,
        conditionCode: code,
        isDay: false,
        startsAt: startsAt
    )
}

let baseTime = floor(now / 3600) * 3600
var visual = NearcastWidgetSnapshot.fallback
visual.version = 6
visual.savedAt = now
visual.weatherSavedAt = now
visual.isAvailable = true
visual.placeName = "London"
visual.placeTimezone = "Europe/London"
visual.temperature = 64
visual.feelsLike = 62
visual.condition = "Cloudy"
visual.conditionCode = 2
visual.isDay = false
visual.wind = 8
visual.high = 70
visual.low = 56
visual.daily = [
    NearcastWidgetDay(date: "2026-07-14", label: "Today", high: 70, low: 56, rainChance: 10, conditionCode: 2),
    NearcastWidgetDay(date: "2026-07-15", label: "Tomorrow", high: 74, low: 59, rainChance: 35, conditionCode: 61),
    NearcastWidgetDay(date: "2026-07-16", label: "Thu", high: 77, low: 61, rainChance: 20, conditionCode: 1),
    NearcastWidgetDay(date: "2026-07-17", label: "Fri", high: 79, low: 62, rainChance: 5, conditionCode: 0)
]
visual.timeline = (0..<6).map { offset in
    hour(offset, offset == 0 ? "Now" : "\(3 + offset)a", startsAt: baseTime + Double(offset * 3600))
}

var visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .steady, "flat weather resolves to one steady primary signal")
require(visualSet.rain.headline == "Dry", "zero rain becomes a dry visual state")
require(visualSet.rain.timelinePoints.count == 6, "visual rain ribbon preserves the requested horizon")
require(visualSet.rain.magnitude?.normalizedValue == 0, "zero rain has a zero-height magnitude")

let halfHourSet = NearcastVisualSignalModel.make(
    snapshot: visual,
    now: Date(timeIntervalSince1970: baseTime + 45 * 60)
)
require(halfHourSet.steady.timelinePoints.first?.startsAt == baseTime, "the current hourly row remains visible after the half-hour")
require(halfHourSet.steady.timelinePoints.first?.timeLabel == "Now", "the active hourly row retains the Now label")

var metricVisual = visual
metricVisual.windUnit = "km/h"
metricVisual.temperature = 20
metricVisual.feelsLike = 20
metricVisual.timeline = metricVisual.timeline?.map { row in
    var metricRow = row
    metricRow.temperature = 20
    metricRow.feelsLike = 20
    return metricRow
}
var metricSet = NearcastVisualSignalModel.make(snapshot: metricVisual, now: Date(timeIntervalSince1970: baseTime))
require(metricSet.temperature.detail != "Freezing", "comfortable Celsius weather is not evaluated with Fahrenheit thresholds")
metricVisual.feelsLike = -1
metricSet = NearcastVisualSignalModel.make(snapshot: metricVisual, now: Date(timeIntervalSince1970: baseTime))
require(metricSet.temperature.detail == "Freezing", "Celsius freezing weather uses a zero-degree threshold")

visual.timeline?[2].windGust = 21
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .wind, "a meaningful gust pickup outranks steady weather")
require(visualSet.wind.magnitude?.value == 21, "wind signal exposes the exact gust magnitude")
require(visualSet.wind.eventTimeLabel == "5a", "wind signal exposes its event time")
visual.timeline?[4].temperature = 73
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .wind, "actionable wind outranks a non-extreme temperature trend")
visual.timeline?[4].temperature = 64

visual.wind = 28
visual.timeline = visual.timeline?.map { row in
    var steadyWind = row
    steadyWind.wind = 28
    steadyWind.windGust = 28
    return steadyWind
}
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .wind, "strong wind already in progress remains a primary signal")

visual.wind = 8
visual.timeline = visual.timeline?.map { row in
    var calmWind = row
    calmWind.wind = 8
    calmWind.windGust = nil
    return calmWind
}

visual.timeline?[3].rainChance = 54
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .rain, "meaningful rain outranks other forecast signals")
require(visualSet.rain.magnitude?.value == 54, "rain signal exposes the peak chance")
require(visualSet.rain.eventTimeLabel == "6a", "rain signal exposes the first meaningful time")
require(visualSet.rain.accessibilityDescription.contains("54 percent"), "rain visual includes a complete accessibility description")

var truthRain = visual
truthRain.rainChance = 54
truthRain.timeline = truthRain.timeline?.map { row in
    var dryHourlyRow = row
    dryHourlyRow.rainChance = 0
    return dryHourlyRow
}
let truthRainSet = NearcastVisualSignalModel.make(snapshot: truthRain, now: Date(timeIntervalSince1970: baseTime))
require(truthRainSet.rain.isActionable && truthRainSet.rain.eventTimeLabel == "Now", "a meaningful current rain truth remains actionable when raw hourly rows lag")
require(truthRainSet.primaryWeather.kind == .rain, "current rain truth can own the Brief surface")

var hotWithRoutineRain = truthRain
hotWithRoutineRain.feelsLike = 110
let hotRainSet = NearcastVisualSignalModel.make(snapshot: hotWithRoutineRain, now: Date(timeIntervalSince1970: baseTime))
require(hotRainSet.primaryWeather.kind == .temperature, "dangerous heat outranks a routine rain chance")

var severeWindWithRoutineRain = truthRain
severeWindWithRoutineRain.timeline?[2].windGust = 50
let severeWindRainSet = NearcastVisualSignalModel.make(snapshot: severeWindWithRoutineRain, now: Date(timeIntervalSince1970: baseTime))
require(severeWindRainSet.primaryWeather.kind == .wind, "dangerous wind outranks a routine rain chance")

var activeRainAndWind = severeWindWithRoutineRain
activeRainAndWind.conditionCode = 61
activeRainAndWind.condition = "Rain"
let activeRainWindSet = NearcastVisualSignalModel.make(snapshot: activeRainAndWind, now: Date(timeIntervalSince1970: baseTime))
require(activeRainWindSet.primaryWeather.kind == .rain, "active precipitation remains visible ahead of a competing hazard")

var snow = visual
snow.condition = "Snow"
snow.conditionCode = 71
snow.rainChance = 0
let snowSet = NearcastVisualSignalModel.make(snapshot: snow, now: Date(timeIntervalSince1970: baseTime))
require(snowSet.rain.headline == "Snow now", "active snowfall never renders as Dry")
require(snowSet.rain.symbolName == "cloud.snow.fill", "snowfall uses a snow visual signal")

visual.timeline?[3].rainChance = 0
visual.timeline?[4].temperature = 73
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .temperature, "a meaningful temperature change becomes primary")
require(visualSet.temperature.magnitude?.value == 73, "temperature signal exposes the destination value")

visual.timeline?[4].temperature = 64
visual.timeline?[2].conditionCode = 45
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primaryWeather.kind == .condition, "a meaningful condition transition becomes primary")
require(visualSet.condition.symbolName == "cloud.fog.fill", "condition signal owns its presentation-neutral SF Symbol name")

visual.timeline?[2].conditionCode = 2
visual.planTitle = "Ballgame"
visual.planAvailable = true
visual.watchTone = "watch"
visual.watchDetail = "Rain after 3"
visual.planRisk = "rain"
visual.planStartAt = baseTime + 2 * 3600
visual.planEndAt = baseTime + 4 * 3600
visualSet = NearcastVisualSignalModel.make(snapshot: visual, now: Date(timeIntervalSince1970: baseTime))
require(visualSet.primary.kind == .plan && visualSet.plan?.planVerdict == .watch, "an urgent plan verdict can own the Brief surface")
require(visualSet.plan?.timeWindow?.startAt == visual.planStartAt, "plan signal exposes its exact time window")
require(visualSet.planWeather?.kind == .rain, "a rain plan is paired with the rain visual signal")
require(visualSet.rain.timelinePoints[2].isInPlanWindow, "weather ribbon points identify plan-window overlap")
require(!visualSet.rain.timelinePoints[4].isInPlanWindow, "plan-window overlap ends at the exclusive boundary")

var awayPlan = visual
awayPlan.planPlace = "Chicago, Illinois"
let awaySet = NearcastVisualSignalModel.make(snapshot: awayPlan, now: Date(timeIntervalSince1970: baseTime))
require(awaySet.planWeather == nil, "a plan for another place cannot reuse the active-place weather ribbon")

var unsupportedPlan = visual
unsupportedPlan.planRisk = "air"
let unsupportedSet = NearcastVisualSignalModel.make(snapshot: unsupportedPlan, now: Date(timeIntervalSince1970: baseTime))
require(unsupportedSet.planWeather == nil, "unsupported plan risks fall back to the concise reason")

let visualRoundTrip = try decoder.decode(NearcastWidgetSnapshot.self, from: encoder.encode(visual))
require(visualRoundTrip.planStartAt == visual.planStartAt && visualRoundTrip.planEndAt == visual.planEndAt, "V6 round trips the exact plan window")
require(visualRoundTrip.planRisk == "rain", "V6 round trips the plan risk category")
require(visualRoundTrip.daily?.count == 4, "snapshots round trip today plus three future daily rows")
require(visualRoundTrip.daily?[1].rainChance == 35, "daily basics preserve rain chance")
require(visualRoundTrip.placeTimezone == "Europe/London", "snapshots preserve the forecast timezone for plan timing")

var alertSnapshot = visual
alertSnapshot.version = 7
alertSnapshot.alertId = "id:urn:oid:example-alert"
alertSnapshot.alertTitle = "Severe Thunderstorm Warning"
alertSnapshot.alertSeverity = "Severe"
alertSnapshot.alertExpiresAt = baseTime + 2 * 3600
alertSnapshot.alertImpact = "Damaging wind and hail may affect travel and outdoor plans."
alertSnapshot.alertCount = 2
alertSnapshot.alertSavedAt = now
alertSnapshot.alertStateReady = true
let alertRoundTrip = try decoder.decode(NearcastWidgetSnapshot.self, from: encoder.encode(alertSnapshot))
require(alertRoundTrip.alertId == alertSnapshot.alertId, "V7 round trips the official alert identity")
require(alertRoundTrip.alertExpiresAt == alertSnapshot.alertExpiresAt, "V7 round trips the official alert window")
require(alertRoundTrip.alertImpact == alertSnapshot.alertImpact && alertRoundTrip.alertCount == 2 && alertRoundTrip.alertSavedAt == now, "V7 round trips official alert context")
require(alertRoundTrip.alertStateReady == true, "V7 round trips authoritative alert readiness")

var alertPendingSnapshot = alertSnapshot
alertPendingSnapshot.alertId = nil
alertPendingSnapshot.alertTitle = nil
alertPendingSnapshot.alertSeverity = nil
alertPendingSnapshot.alertExpiresAt = nil
alertPendingSnapshot.alertImpact = nil
alertPendingSnapshot.alertCount = 0
alertPendingSnapshot.alertSavedAt = nil
alertPendingSnapshot.alertStateReady = false
let alertPendingResolved = alertPendingSnapshot.preservingOfficialAlert(from: alertSnapshot)
require(
    alertPendingResolved.alertId == alertSnapshot.alertId && alertPendingResolved.alertTitle == alertSnapshot.alertTitle,
    "an unresolved same-place phone alert refresh preserves the last authoritative alert"
)
require(alertPendingResolved.alertStateReady == false, "preserving alert data keeps the incoming unresolved state")

var noExpiryAlert = alertSnapshot
noExpiryAlert.alertExpiresAt = nil
noExpiryAlert.alertSavedAt = now
require(
    noExpiryAlert.hasCurrentOfficialAlert(at: now + nearcastWidgetAlertWithoutExpiryTTL - 1),
    "an official alert without an end time survives briefly through refresh failures"
)
require(
    !noExpiryAlert.hasCurrentOfficialAlert(at: now + nearcastWidgetAlertWithoutExpiryTTL),
    "an official alert without an end time expires at the fallback TTL"
)
let expiredNoExpiryAlert = noExpiryAlert.expiringOfficialAlert(at: now + nearcastWidgetAlertWithoutExpiryTTL)
require(
    expiredNoExpiryAlert.alertTitle == nil && expiredNoExpiryAlert.alertId == nil && expiredNoExpiryAlert.alertCount == 0,
    "expiring an open-ended alert clears all visible official-alert metadata"
)

var legacyOpenEndedAlert = noExpiryAlert
legacyOpenEndedAlert.alertSavedAt = nil
require(
    !legacyOpenEndedAlert.hasCurrentOfficialAlert(at: now),
    "a legacy open-ended alert without freshness metadata cannot persist indefinitely"
)

var inFlightWeather = visual
inFlightWeather.temperature = 71
inFlightWeather.weatherSavedAt = now + 5
inFlightWeather.planTitle = "Older plan"
inFlightWeather.planStartAt = baseTime
var newestPlan = visual
newestPlan.planTitle = "Newest plan"
newestPlan.planDetail = "New rain timing"
newestPlan.planStartAt = baseTime + 3 * 3600
newestPlan.planEndAt = baseTime + 5 * 3600
newestPlan.alertId = alertSnapshot.alertId
newestPlan.alertTitle = alertSnapshot.alertTitle
newestPlan.alertExpiresAt = alertSnapshot.alertExpiresAt
newestPlan.alertSavedAt = alertSnapshot.alertSavedAt
let mergedSnapshot = newestPlan.mergingWeather(from: inFlightWeather)
require(mergedSnapshot.temperature == 71, "an in-flight refresh merges its newer weather")
require(mergedSnapshot.planTitle == "Newest plan" && mergedSnapshot.planStartAt == newestPlan.planStartAt, "an in-flight refresh preserves a newer plan and exact window")
require(mergedSnapshot.planRisk == "rain", "an in-flight refresh preserves the plan risk")
require(mergedSnapshot.alertId == alertSnapshot.alertId && mergedSnapshot.alertTitle == alertSnapshot.alertTitle, "an in-flight refresh preserves official alert metadata")
require(mergedSnapshot.daily?.first?.high == 70, "an in-flight refresh merges daily weather basics")

var delayedPhoneSnapshot = newestPlan
delayedPhoneSnapshot.temperature = 69
delayedPhoneSnapshot.weatherSavedAt = now - 60
delayedPhoneSnapshot.planTitle = "Phone plan"
var freshWatchSnapshot = newestPlan
freshWatchSnapshot.temperature = 72
freshWatchSnapshot.weatherSavedAt = now
freshWatchSnapshot.planTitle = "Watch plan"
let freshnessResolved = delayedPhoneSnapshot.preservingNewerWeather(from: freshWatchSnapshot)
require(freshnessResolved.temperature == 72, "a delayed phone payload cannot replace fresher Watch weather")
require(freshnessResolved.planTitle == "Phone plan", "freshness arbitration preserves the incoming plan domain")

var newestPhoneSnapshot = delayedPhoneSnapshot
newestPhoneSnapshot.temperature = 74
newestPhoneSnapshot.weatherSavedAt = now + 1
let newestPhoneResolved = newestPhoneSnapshot.preservingNewerWeather(from: freshWatchSnapshot)
require(newestPhoneResolved.temperature == 74, "newer incoming weather still replaces the Watch cache")

var projectionSnapshot = visual
projectionSnapshot.temperature = 72
projectionSnapshot.timeline = [
    hour(0, "Now", startsAt: baseTime, temperature: 69),
    hour(1, "+1h", startsAt: baseTime + 3600, temperature: 70),
    hour(2, "+2h", startsAt: baseTime + 7200, temperature: 71)
]
let projectionNow = Date(timeIntervalSince1970: baseTime + 20 * 60)
let currentProjection = projectionSnapshot.timelineProjection(at: projectionNow, relativeTo: projectionNow)
require(currentProjection?.advancesCurrentWeather == false, "the first complication entry keeps the true current observation")
require(currentProjection?.rows.first?.temperature == 69, "the current hourly row remains available to the forecast ribbon")
require(
    currentProjection.map { !projectionSnapshot.shouldPromoteCurrentWeather(from: $0) } == true,
    "a current observation newer than the active hourly row remains authoritative"
)
var delayedProjectionSnapshot = projectionSnapshot
delayedProjectionSnapshot.weatherSavedAt = baseTime - 60
require(
    currentProjection.map { delayedProjectionSnapshot.shouldPromoteCurrentWeather(from: $0) } == true,
    "an active forecast row replaces an observation saved before its hourly boundary"
)
let futureProjection = projectionSnapshot.timelineProjection(
    at: Date(timeIntervalSince1970: baseTime + 3600),
    relativeTo: projectionNow
)
require(futureProjection?.advancesCurrentWeather == true, "a future hourly boundary advances complication weather")
require(futureProjection?.rows.first?.temperature == 70, "future complication entries select the matching forecast hour")
require(
    projectionSnapshot.weatherTimelineValidUntil().timeIntervalSince1970 == baseTime + 3 * 3600,
    "timestamped weather expires at the end of its final forecast interval"
)

var legacyOffsetSnapshot = projectionSnapshot
legacyOffsetSnapshot.weatherSavedAt = baseTime
legacyOffsetSnapshot.timeline = (0..<6).map { offset in
    var row = hour(offset, offset == 0 ? "Now" : "+\(offset)h", startsAt: baseTime + Double(offset * 3600))
    row.startsAt = nil
    return row
}
require(
    legacyOffsetSnapshot.weatherTimelineValidUntil().timeIntervalSince1970 == baseTime + 6 * 3600,
    "legacy offset-only weather expires after its actual final hourly row"
)

var dailyProjectionSnapshot = projectionSnapshot
dailyProjectionSnapshot.placeTimezone = "UTC"
dailyProjectionSnapshot.daily = [
    NearcastWidgetDay(date: "2026-07-20", label: "Today", high: 80, low: 60, rainChance: 10, conditionCode: 1),
    NearcastWidgetDay(date: "2026-07-21", label: "Tomorrow", high: 72, low: 55, rainChance: 30, conditionCode: 61)
]
dailyProjectionSnapshot.high = 80
dailyProjectionSnapshot.low = 60
let utcFormatter = DateFormatter()
utcFormatter.locale = Locale(identifier: "en_US_POSIX")
utcFormatter.timeZone = TimeZone(secondsFromGMT: 0)
utcFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
dailyProjectionSnapshot.projectDailyWeather(at: utcFormatter.date(from: "2026-07-21T01:00:00Z")!)
require(
    dailyProjectionSnapshot.high == 72 && dailyProjectionSnapshot.low == 55,
    "projected weather rolls high and low at the selected place's midnight"
)
require(
    dailyProjectionSnapshot.daily?.first?.label == "Today",
    "the newly active daily row is relabeled Today"
)

require(nearcastWindFlowDegrees(from: 0) == 180, "a north wind flows toward the south")
require(nearcastWindFlowDegrees(from: 225) == 45, "a southwest wind flows toward the northeast")
require(nearcastWindFlowDegrees(from: -90) == 90, "negative provider bearings normalize before becoming flow directions")
require(nearcastWindFlowDegrees(from: nil) == 0, "an unknown wind direction keeps the unrotated fallback")
require(nearcastHourlyColumnCenter(index: 0, columnCount: 4, totalWidth: 120) == 15, "the first wind point uses the first hourly column center")
require(nearcastHourlyColumnCenter(index: 3, columnCount: 4, totalWidth: 120) == 105, "the last wind point uses the last hourly column center")
require(nearcastHourlyColumnCenter(index: 1, columnCount: 3, totalWidth: 120) == 60, "three-column Watch layouts share the same center geometry")

print("PASS  Nearcast Watch snapshot trust contract")
