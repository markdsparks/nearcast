import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// Configuration that must agree across the phone app, WidgetKit extension,
/// Watch app, and Watch complication extension. The values live in each
/// target's Info.plist so a development install can be fully isolated from
/// the App Store/TestFlight install while the shared source stays one file.
enum NearcastBuildIdentity {
    private static func configuredValue(_ key: String, fallback: String) -> String {
        let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        // An unexpanded build setting is never a safe runtime identifier.
        return value.isEmpty || value.contains("$(") ? fallback : value
    }

    static let appGroupIdentifier: String = {
        let value = configuredValue("NearcastAppGroupIdentifier", fallback: "group.app.nearcast.ios")
        guard value.hasPrefix("group."), !value.contains(where: \.isWhitespace) else {
            return "group.app.nearcast.ios"
        }
        return value
    }()

    static let urlScheme: String = {
        let value = configuredValue("NearcastURLScheme", fallback: "nearcast").lowercased()
        guard value.range(of: "^[a-z][a-z0-9+.-]*$", options: .regularExpression) != nil else {
            return "nearcast"
        }
        return value
    }()

    static let defaultWebMode: String = {
        let value = configuredValue("NearcastDefaultWebMode", fallback: "production").lowercased()
        return ["local", "production"].contains(value) ? value : "production"
    }()

    static let remoteDeliveryEnabled: Bool = {
        let value = configuredValue("NearcastRemoteDeliveryEnabled", fallback: "true").lowercased()
        return ["1", "true", "yes", "on"].contains(value)
    }()

    static let watchRefreshIdentifier = configuredValue(
        "NearcastWatchRefreshIdentifier",
        fallback: "app.nearcast.watch.weather-refresh"
    )
}

let nearcastWidgetSuiteName = NearcastBuildIdentity.appGroupIdentifier
let nearcastWidgetSnapshotKey = "nearcast.widget.snapshot.v1"
let nearcastWidgetPlaceKey = "nearcast.widget.place.v1"
let nearcastWidgetKind = "NearcastWidget"
let nearcastWidgetAlertWithoutExpiryTTL: TimeInterval = 45 * 60

struct NearcastWidgetSnapshot: Codable, Sendable {
    var version: Int
    var savedAt: TimeInterval
    var placeName: String
    var placeTimezone: String? = nil
    // Resolved phone preference (including Auto). Older payloads omit this and
    // follow the companion's system clock; weather refreshes never own it.
    var uses24HourClock: Bool? = nil
    var temperature: Int
    var feelsLike: Int
    var high: Int?
    var low: Int?
    var condition: String
    var conditionCode: Int
    var isDay: Bool
    var rainChance: Int
    var wind: Int
    var windUnit: String
    var windDirection: Int?
    var windLabel: String?
    var uv: Int
    var nowLabel: String
    var nowValue: String
    var nextLabel: String
    var nextValue: String
    var laterLabel: String
    var laterValue: String
    // Nearcast's web forecast engine owns the next meaningful event. Native
    // companions retain the exact story for accessibility and detail, then
    // derive a bounded Watch-sized title and clock cue from its semantic kind
    // and timestamps. Every field is optional so older snapshots continue to
    // decode unchanged.
    var canonicalEventId: String? = nil
    var canonicalEventHeadline: String? = nil
    var canonicalEventTiming: String? = nil
    var canonicalEventStartAt: TimeInterval? = nil
    var canonicalEventEndAt: TimeInterval? = nil
    var canonicalEventKind: String? = nil
    // Optional forecast-confidence evidence authored by Nearcast's web
    // consensus engine. Timestamps are seconds since 1970 at the native
    // boundary. Keeping the entire contract optional preserves snapshots from
    // older app builds and lets native-only refreshes retain phone-authored
    // evidence without trying to recreate it from a single forecast source.
    var confidenceLevel: String? = nil
    var confidenceHeadline: String? = nil
    var confidenceSummary: String? = nil
    var confidenceWindowStartAt: TimeInterval? = nil
    var confidenceWindowEndAt: TimeInterval? = nil
    var confidenceGeneratedAt: TimeInterval? = nil
    // Native companions never infer whether model disagreement matters to a
    // person. Only the phone's editorial forecast contract can promote a
    // confidence receipt into short, actionable advice. Older snapshots omit
    // this field and therefore remain quietly non-actionable.
    var confidenceActionable: Bool? = nil
    var planTitle: String?
    var planLabel: String?
    var planDetail: String?
    var planPlace: String?
    var planTone: String?
    var watchStatus: String?
    var watchDetail: String?
    var watchTone: String?
    // Official alert metadata is optional so snapshots written before V7
    // continue to decode. The identifier matches the web alert identity key,
    // which lets a widget deep link reopen the same alert in Nearcast.
    var alertId: String? = nil
    var alertTitle: String? = nil
    var alertSeverity: String? = nil
    var alertStartsAt: TimeInterval? = nil
    var alertExpiresAt: TimeInterval? = nil
    var alertImpact: String? = nil
    var alertSource: String? = nil
    var alertUrgency: String? = nil
    var alertCertainty: String? = nil
    var alertCount: Int? = nil
    var alertSavedAt: TimeInterval? = nil
    // False means the phone refreshed weather while its alert request was
    // still unresolved. Native receivers preserve same-place alert metadata
    // until a successful alert response makes this true.
    var alertStateReady: Bool? = nil
    var timeline: [NearcastWidgetHour]?
    var daily: [NearcastWidgetDay]? = nil
    var sunriseAt: TimeInterval?
    var sunsetAt: TimeInterval?
    var isAvailable: Bool?
    var weatherSavedAt: TimeInterval?
    var planSavedAt: TimeInterval?
    var planId: String?
    var planAvailable: Bool?
    // Stable risk category (rain, wind, heat, etc.) used to pair a watched
    // plan with the correct visual weather signal. Optional for V4/V5 data.
    var planRisk: String? = nil
    // Optional so snapshots written by older app builds continue to decode.
    // Milliseconds from the web payload are converted to seconds before storage.
    var planStartAt: TimeInterval? = nil
    var planEndAt: TimeInterval? = nil
    // Current precipitation observation is deliberately separate from PoP.
    // `rainChance` remains forecast guidance even when radar says rain is
    // occurring now, so native surfaces never turn an observation into 100%.
    var precipitationNowLabel: String? = nil
    var precipitationNowBasis: String? = nil
    var precipitationNowObserved: Bool? = nil
    var precipitationNowDetail: String? = nil
    var forecastRainChance: Int? = nil
    // Phone publication authority is independent of weather freshness. Optional
    // fields keep pre-handover snapshots readable without granting them the
    // right to replace a later native-owned selection or preference.
    var ownerRevision: Int? = nil
    var publicationGeneration: Int? = nil
    var nativeWeatherInvalidation: Bool? = nil
}

extension NearcastWidgetSnapshot {
    // V9 is the first snapshot contract that can distinguish an absent PoP
    // from a real 0%. Older snapshots only carried the required `rainChance`
    // field, so retain that value when decoding them.
    var forecastRainChanceForDisplay: Int? {
        forecastRainChance ?? (version < 9 ? rainChance : nil)
    }
}

struct NearcastWidgetHour: Codable, Identifiable, Sendable {
    var id: String { "\(offsetHours)-\(timeLabel)" }
    var offsetHours: Int
    var timeLabel: String
    var temperature: Int?
    var feelsLike: Int?
    var rainChance: Int?
    var wind: Int?
    var windGust: Int?
    var windDirection: Int?
    var uv: Int?
    var conditionCode: Int?
    var isDay: Bool?
    var startsAt: TimeInterval?
    var precipitationLabel: String? = nil
    var precipitationBasis: String? = nil
    var precipitationObserved: Bool? = nil
    var precipitationDetail: String? = nil
    var thunderPossible: Bool? = nil
}

struct NearcastWidgetTimelineProjection {
    var rows: [NearcastWidgetHour]
    var advancesCurrentWeather: Bool
}

struct NearcastCanonicalEventBrief: Equatable {
    let id: String?
    let headline: String
    let timing: String?
    let startAt: TimeInterval?
    let endAt: TimeInterval?
    let kind: String?
}

enum NearcastForecastConfidenceLevel: String, Equatable {
    case high
    case medium
    case low
}

/// A validated, presentation-neutral confidence receipt for native companion
/// surfaces. `unavailable` and stale/ended receipts are intentionally omitted:
/// compact surfaces must never imply confidence that the current snapshot no
/// longer supports.
struct NearcastForecastConfidenceBrief: Equatable {
    let level: NearcastForecastConfidenceLevel
    let headline: String
    let summary: String
    let windowStartAt: TimeInterval
    let windowEndAt: TimeInterval
    let generatedAt: TimeInterval
}

struct NearcastOfficialAlertBrief: Equatable {
    let id: String?
    let title: String
    let severity: String?
    let startsAt: TimeInterval?
    let expiresAt: TimeInterval?
    let impact: String?
    let source: String
    let urgency: String?
    let certainty: String?
    let placeName: String

    var isUrgent: Bool {
        let normalizedTitle = title.lowercased()
        // Watches and advisories are important planning context, but they do
        // not replace the family's immediate forecast story. Warnings and
        // emergencies do, as do provider-marked immediate severe hazards.
        if normalizedTitle.contains("watch")
            || normalizedTitle.contains("advisory")
            || normalizedTitle.contains("statement")
            || normalizedTitle.contains("outlook") {
            return false
        }
        if normalizedTitle.contains("warning") || normalizedTitle.contains("emergency") {
            return true
        }
        let severe = ["extreme", "severe"].contains(severity?.lowercased() ?? "")
        let immediate = ["immediate", "expected"].contains(urgency?.lowercased() ?? "")
        return severe && immediate
    }
}

enum NearcastCompanionStoryKind: Equatable {
    case officialAlert
    case forecastEvent
}

/// A single truthful headline contract for compact native surfaces. The web
/// forecast remains the author of forecast-event language; native companions
/// only allow an active urgent official alert to preempt it.
struct NearcastCompanionStory: Equatable {
    let kind: NearcastCompanionStoryKind
    let id: String?
    let headline: String
    let timing: String?
    let startsAt: TimeInterval?
    let endsAt: TimeInterval?
    let source: String?
    let placeName: String
    let impact: String?
    /// Forecast-event kind authored by Nearcast (rain, storm, snow, wind,
    /// etc.). Compact surfaces use this instead of trying to recover meaning
    /// from a sentence that was written for the phone.
    let semanticKind: String?
}

/// Deliberately small copy for Watch complications and the Watch Today header.
/// The complete canonical story remains untouched for accessibility and deeper
/// detail; this projection is sized for one title line and one clock line.
struct NearcastCompactStoryCopy: Equatable {
    let title: String
    let timing: String?
}

let nearcastCompactStoryTitleMaximumCharacters = 20
let nearcastCompactStoryTimingMaximumCharacters = 22

func nearcastCompactStoryCopy(
    _ story: NearcastCompanionStory,
    at timestamp: TimeInterval = Date().timeIntervalSince1970,
    timeZoneIdentifier: String? = nil,
    uses24HourClock: Bool? = nil
) -> NearcastCompactStoryCopy {
    let title = nearcastCompactStoryTitle(story)
    let timing = nearcastCompactStoryTiming(
        story,
        at: timestamp,
        timeZoneIdentifier: timeZoneIdentifier,
        uses24HourClock: uses24HourClock
    )
    return NearcastCompactStoryCopy(
        title: nearcastCompactWords(title, maximumCharacters: nearcastCompactStoryTitleMaximumCharacters),
        timing: timing.map {
            nearcastCompactWords($0, maximumCharacters: nearcastCompactStoryTimingMaximumCharacters)
        }
    )
}

private func nearcastCompactStoryTitle(_ story: NearcastCompanionStory) -> String {
    let raw = [story.semanticKind, story.headline]
        .compactMap { $0 }
        .joined(separator: " ")
        .lowercased()

    if story.kind == .officialAlert {
        if raw.contains("tornado") { return "Tornado warning" }
        if raw.contains("flash flood") { return "Flash flood warning" }
        if raw.contains("flood") { return "Flood warning" }
        if raw.contains("blizzard") { return "Blizzard warning" }
        if raw.contains("winter storm") { return "Winter storm warning" }
        if raw.contains("severe") && (raw.contains("storm") || raw.contains("thunder")) {
            return "Severe storm warning"
        }
        if raw.contains("heat") { return "Heat warning" }
        return "Weather warning"
    }

    let isNow = raw.range(of: #"\b(now|currently)\b"#, options: .regularExpression) != nil
    let likelihood = raw.contains("likely")
        ? "likely"
        : (raw.contains("possible") || raw.contains("chance") || raw.contains(" may ") ? "possible" : nil)

    func eventTitle(_ noun: String, fallback: String) -> String {
        if isNow { return "\(noun) now" }
        if let likelihood { return "\(noun) \(likelihood)" }
        return fallback
    }

    if raw.contains("storm") || raw.contains("thunder") {
        return eventTitle("Storms", fallback: "Storms ahead")
    }
    if raw.contains("snow") {
        return eventTitle("Snow", fallback: "Snow ahead")
    }
    if raw.contains("ice") || raw.contains("icing") || raw.contains("freezing rain") {
        return eventTitle("Icing", fallback: "Icing ahead")
    }
    if raw.contains("rain") || raw.contains("shower") || raw.contains("precip") {
        return eventTitle("Rain", fallback: "Rain ahead")
    }
    if raw.contains("wind") || raw.contains("gust") {
        return isNow ? "Strong winds now" : "Strong winds"
    }
    if raw.contains("fog") || raw.contains("visibility") {
        return isNow ? "Fog now" : "Fog possible"
    }
    if raw.contains("heat") || raw.contains("hot") {
        return "Heat builds"
    }
    if raw.contains("cold") || raw.contains("freeze") {
        return "Cold ahead"
    }
    if raw.contains("clear") || raw.contains("sun") {
        return "Clearing"
    }
    if raw.contains("cloud") {
        return "Clouds building"
    }
    return "Weather changing"
}

private func nearcastCompactStoryTiming(
    _ story: NearcastCompanionStory,
    at timestamp: TimeInterval,
    timeZoneIdentifier: String?,
    uses24HourClock: Bool?
) -> String? {
    let start = story.startsAt.flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0) : nil }
    let end = story.endsAt.flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0) : nil }
    guard start != nil || end != nil else { return nil }

    let now = Date(timeIntervalSince1970: timestamp)
    let timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone

    if let end, end > now, start.map({ $0 <= now }) ?? true {
        return "Until \(nearcastCompactClock(end, calendar: calendar, uses24HourClock: uses24HourClock))"
    }

    guard let start, start > now else { return nil }
    let dayPrefix = calendar.isDate(start, inSameDayAs: now)
        ? nil
        : nearcastCompactWeekday(start, calendar: calendar)

    if let end, end > start {
        let range = nearcastClockRange(start: start, end: end, timeZone: timeZone, uses24HourClock: uses24HourClock, namedNoonMidnight: true)
        return [dayPrefix, range].compactMap { $0 }.joined(separator: " · ")
    }

    let point = "Near \(nearcastCompactClock(start, calendar: calendar, uses24HourClock: uses24HourClock))"
    return [dayPrefix, point].compactMap { $0 }.joined(separator: " · ")
}

func nearcastClockRange(
    start: Date,
    end: Date,
    timeZone: TimeZone,
    uses24HourClock: Bool? = nil,
    namedNoonMidnight: Bool = false
) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let startParts = nearcastCompactClockParts(start, calendar: calendar)
    let endParts = nearcastCompactClockParts(end, calendar: calendar)
    if nearcastResolved24HourClock(uses24HourClock) {
        return "\(nearcastClockLabel(start, timeZone: timeZone, uses24HourClock: true))–\(nearcastClockLabel(end, timeZone: timeZone, uses24HourClock: true))"
    }
    if namedNoonMidnight && endParts.hour24 == 0 && endParts.minute == 0 {
        return "\(nearcastCompactClock(start, calendar: calendar, uses24HourClock: false))–midnight"
    }
    if namedNoonMidnight && endParts.hour24 == 12 && endParts.minute == 0 {
        return "\(nearcastCompactClock(start, calendar: calendar, uses24HourClock: false))–noon"
    }
    if startParts.meridiem == endParts.meridiem {
        return "\(startParts.clock)–\(endParts.clock) \(endParts.meridiem)"
    }
    return "\(startParts.clock) \(startParts.meridiem)–\(endParts.clock) \(endParts.meridiem)"
}

private func nearcastCompactClock(_ date: Date, calendar: Calendar, uses24HourClock: Bool?) -> String {
    let parts = nearcastCompactClockParts(date, calendar: calendar)
    if nearcastResolved24HourClock(uses24HourClock) {
        return nearcastClockLabel(date, timeZone: calendar.timeZone, uses24HourClock: true)
    }
    if parts.hour24 == 0 && parts.minute == 0 { return "midnight" }
    if parts.hour24 == 12 && parts.minute == 0 { return "noon" }
    return "\(parts.clock) \(parts.meridiem)"
}

private func nearcastCompactClockParts(
    _ date: Date,
    calendar: Calendar
) -> (clock: String, meridiem: String, hour24: Int, minute: Int) {
    let components = calendar.dateComponents([.hour, .minute], from: date)
    let hour24 = components.hour ?? 0
    let minute = components.minute ?? 0
    let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
    let clock = minute == 0 ? "\(hour12)" : String(format: "%d:%02d", hour12, minute)
    return (clock, hour24 < 12 ? "AM" : "PM", hour24, minute)
}

/// One clock policy for phone-authored snapshots and independent native
/// refreshes. A nil preference is only the legacy/system fallback.
func nearcastResolved24HourClock(_ preference: Bool?, locale: Locale = .current) -> Bool {
    if let preference { return preference }
    let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: locale) ?? "h a"
    return format.contains("H") || format.contains("k")
}

func nearcastClockLabel(
    _ date: Date,
    timeZone: TimeZone,
    uses24HourClock: Bool? = nil,
    compact: Bool = false
) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.hour, .minute], from: date)
    return nearcastClockLabel(hour: parts.hour ?? 0, minute: parts.minute ?? 0, uses24HourClock: uses24HourClock, compact: compact)
}

func nearcastClockLabel(hour: Int, minute: Int, uses24HourClock: Bool? = nil, compact: Bool = false) -> String {
    if nearcastResolved24HourClock(uses24HourClock) {
        return String(format: "%02d:%02d", hour, minute)
    }
    let hour12 = hour % 12 == 0 ? 12 : hour % 12
    let clock = minute == 0 ? "\(hour12)" : String(format: "%d:%02d", hour12, minute)
    return compact ? "\(clock)\(hour < 12 ? "a" : "p")" : "\(clock) \(hour < 12 ? "AM" : "PM")"
}

/// Provider timestamps without a zone already describe the selected place's
/// local clock. Do not accidentally interpret them in the device timezone.
func nearcastLocalClockLabel(_ value: String, uses24HourClock: Bool? = nil, compact: Bool = true) -> String? {
    let raw = value.split(separator: "T").last.map(String.init) ?? value
    let parts = raw.split(separator: ":")
    guard parts.count >= 2, let hour = Int(parts[0]), let minute = Int(parts[1].prefix(2)),
          (0...23).contains(hour), (0...59).contains(minute) else { return nil }
    return nearcastClockLabel(hour: hour, minute: minute, uses24HourClock: uses24HourClock, compact: compact)
}

private func nearcastCompactWeekday(_ date: Date, calendar: Calendar) -> String {
    let symbols = calendar.shortWeekdaySymbols
    let weekday = max(1, min(symbols.count, calendar.component(.weekday, from: date)))
    return String(symbols[weekday - 1].prefix(3))
}

private func nearcastCompactWords(_ value: String, maximumCharacters: Int) -> String {
    let words = value.split(whereSeparator: \.isWhitespace).map(String.init)
    guard !words.isEmpty else { return "Weather" }
    var result = ""
    for word in words {
        let candidate = result.isEmpty ? word : "\(result) \(word)"
        if candidate.count > maximumCharacters { break }
        result = candidate
    }
    return result.isEmpty ? String(words[0].prefix(maximumCharacters)) : result
}

struct NearcastWidgetDay: Codable, Identifiable, Sendable {
    var id: String { date }
    var date: String
    var label: String
    var high: Int
    var low: Int
    var rainChance: Int
    var conditionCode: Int
    var thunderPossible: Bool? = nil
}

struct NearcastWidgetPlace: Codable, Equatable, Sendable {
    var id: String?
    var name: String
    var displayName: String?
    var admin1: String?
    var country: String?
    var countryCode: String?
    var followsCurrentLocation: Bool? = nil
    var latitude: Double
    var longitude: Double
    var ownerRevision: Int? = nil
    var publicationGeneration: Int? = nil
}

extension NearcastWidgetSnapshot {
    static let fallback = NearcastWidgetSnapshot(
        version: 9,
        savedAt: 0,
        placeName: "Nearcast",
        temperature: 0,
        feelsLike: 0,
        high: nil,
        low: nil,
        condition: "Open Nearcast on iPhone",
        conditionCode: 0,
        isDay: true,
        rainChance: 0,
        wind: 0,
        windUnit: "mph",
        windDirection: nil,
        windLabel: nil,
        uv: 0,
        nowLabel: "Now",
        nowValue: "No weather loaded",
        nextLabel: "Next",
        nextValue: "Open the iPhone app",
        laterLabel: "Later",
        laterValue: "Your weather will appear here",
        planTitle: nil,
        planLabel: nil,
        planDetail: nil,
        planPlace: nil,
        planTone: nil,
        watchStatus: nil,
        watchDetail: nil,
        watchTone: "neutral",
        timeline: nil,
        daily: nil,
        sunriseAt: nil,
        sunsetAt: nil,
        isAvailable: false,
        weatherSavedAt: nil,
        planSavedAt: nil,
        planId: nil,
        planAvailable: false
    )

    static func current() -> NearcastWidgetSnapshot {
        stored() ?? fallback
    }

    static func stored() -> NearcastWidgetSnapshot? {
        guard var snapshot = NearcastWidgetSnapshotStore.storedPublication()?.snapshot else { return nil }
        snapshot.refreshTimelineClockLabels()
        return snapshot
    }

    var hasWeatherData: Bool {
        isAvailable ?? (savedAt > 0 && placeName != "Nearcast")
    }

    var hasPlan: Bool {
        if let planAvailable { return planAvailable }
        return [planTitle, planLabel, planDetail].contains { value in
            guard let value else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    /// Returns the exact next-event language authored by Nearcast's canonical
    /// forecast contract. An explicitly ended event is no longer eligible;
    /// legacy snapshots and incomplete payloads fall back to their existing
    /// native presentation without inventing missing canonical copy.
    func canonicalEventBrief(at timestamp: TimeInterval = Date().timeIntervalSince1970) -> NearcastCanonicalEventBrief? {
        guard let headline = canonicalEventHeadline?.trimmingCharacters(in: .whitespacesAndNewlines),
              !headline.isEmpty else {
            return nil
        }
        if let canonicalEventEndAt, canonicalEventEndAt <= timestamp {
            return nil
        }
        let timing = canonicalEventTiming?.trimmingCharacters(in: .whitespacesAndNewlines)
        let identifier = canonicalEventId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let kind = canonicalEventKind?.trimmingCharacters(in: .whitespacesAndNewlines)
        return NearcastCanonicalEventBrief(
            id: identifier?.isEmpty == false ? identifier : nil,
            headline: headline,
            timing: timing?.isEmpty == false ? timing : nil,
            startAt: canonicalEventStartAt,
            endAt: canonicalEventEndAt,
            kind: kind?.isEmpty == false ? kind : nil
        )
    }

    /// Returns forecast advice only when the web forecast editor explicitly
    /// says uncertainty changes what the family should do. Confidence grades
    /// alone are never promoted on compact native surfaces.
    func forecastConfidenceBrief(
        at timestamp: TimeInterval = Date().timeIntervalSince1970,
        maximumAge: TimeInterval = 3 * 60 * 60
    ) -> NearcastForecastConfidenceBrief? {
        guard confidenceActionable == true else { return nil }
        return validatedForecastConfidenceBrief(at: timestamp, maximumAge: maximumAge)
    }

    /// Validates freshness independently from presentation gating so native
    /// refreshes can retain a quiet receipt until its real validity expires.
    private func validatedForecastConfidenceBrief(
        at timestamp: TimeInterval,
        maximumAge: TimeInterval
    ) -> NearcastForecastConfidenceBrief? {
        guard let rawLevel = cleanCompanionText(confidenceLevel)?.lowercased(),
              let level = NearcastForecastConfidenceLevel(rawValue: rawLevel),
              let headline = cleanCompanionText(confidenceHeadline),
              let summary = cleanCompanionText(confidenceSummary),
              let windowStartAt = confidenceWindowStartAt,
              let windowEndAt = confidenceWindowEndAt,
              let generatedAt = confidenceGeneratedAt,
              windowStartAt > 0,
              windowEndAt > windowStartAt,
              windowEndAt > timestamp,
              generatedAt > 0,
              generatedAt <= timestamp + 5 * 60,
              max(0, timestamp - generatedAt) <= maximumAge else {
            return nil
        }
        return NearcastForecastConfidenceBrief(
            level: level,
            headline: headline,
            summary: summary,
            windowStartAt: windowStartAt,
            windowEndAt: windowEndAt,
            generatedAt: generatedAt
        )
    }

    func officialAlertBrief(
        at timestamp: TimeInterval = Date().timeIntervalSince1970,
        missingExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> NearcastOfficialAlertBrief? {
        guard hasCurrentOfficialAlert(at: timestamp, missingExpiryTTL: missingExpiryTTL),
              let title = cleanCompanionText(alertTitle) else {
            return nil
        }
        return NearcastOfficialAlertBrief(
            id: cleanCompanionText(alertId),
            title: title,
            severity: cleanCompanionText(alertSeverity),
            startsAt: alertStartsAt,
            expiresAt: alertExpiresAt,
            impact: cleanCompanionText(alertImpact),
            // Nearcast's current official-alert feed is weather.gov. Newer
            // snapshots preserve the issuing office verbatim when available;
            // this fallback keeps legacy V7/V8 snapshots honestly sourced.
            source: cleanCompanionText(alertSource) ?? "National Weather Service",
            urgency: cleanCompanionText(alertUrgency),
            certainty: cleanCompanionText(alertCertainty),
            placeName: placeName
        )
    }

    func urgentOfficialAlertBrief(
        at timestamp: TimeInterval = Date().timeIntervalSince1970,
        missingExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> NearcastOfficialAlertBrief? {
        guard let alert = officialAlertBrief(at: timestamp, missingExpiryTTL: missingExpiryTTL),
              alert.isUrgent else { return nil }
        return alert
    }

    func officialAlertTiming(
        at timestamp: TimeInterval = Date().timeIntervalSince1970,
        missingExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> String? {
        guard let alert = officialAlertBrief(at: timestamp, missingExpiryTTL: missingExpiryTTL) else {
            return nil
        }
        return companionAlertTiming(
            alert,
            at: timestamp,
            timeZoneIdentifier: placeTimezone,
            uses24HourClock: uses24HourClock
        )
    }

    func companionStory(
        at timestamp: TimeInterval = Date().timeIntervalSince1970,
        missingExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> NearcastCompanionStory? {
        if let alert = urgentOfficialAlertBrief(at: timestamp, missingExpiryTTL: missingExpiryTTL) {
            return NearcastCompanionStory(
                kind: .officialAlert,
                id: alert.id,
                headline: alert.title,
                timing: officialAlertTiming(at: timestamp, missingExpiryTTL: missingExpiryTTL),
                startsAt: alert.startsAt,
                endsAt: alert.expiresAt,
                source: alert.source,
                placeName: alert.placeName,
                impact: alert.impact,
                semanticKind: alert.title
            )
        }
        guard let event = canonicalEventBrief(at: timestamp) else { return nil }
        return NearcastCompanionStory(
            kind: .forecastEvent,
            id: event.id,
            headline: event.headline,
            timing: event.timing,
            startsAt: event.startAt,
            endsAt: event.endAt,
            source: nil,
            placeName: placeName,
            impact: nil,
            semanticKind: event.kind
        )
    }

    mutating func clearCanonicalEvent() {
        canonicalEventId = nil
        canonicalEventHeadline = nil
        canonicalEventTiming = nil
        canonicalEventStartAt = nil
        canonicalEventEndAt = nil
        canonicalEventKind = nil
    }

    mutating func clearForecastConfidence() {
        confidenceLevel = nil
        confidenceHeadline = nil
        confidenceSummary = nil
        confidenceWindowStartAt = nil
        confidenceWindowEndAt = nil
        confidenceGeneratedAt = nil
        confidenceActionable = nil
    }

    func expiringCompanionContent(
        at timestamp: TimeInterval,
        missingAlertExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> NearcastWidgetSnapshot {
        var snapshot = expiringOfficialAlert(
            at: timestamp,
            missingExpiryTTL: missingAlertExpiryTTL
        )
        if let eventEndAt = snapshot.canonicalEventEndAt, eventEndAt <= timestamp {
            snapshot.clearCanonicalEvent()
        }
        if snapshot.confidenceLevel != nil,
           snapshot.validatedForecastConfidenceBrief(
               at: timestamp,
               maximumAge: 3 * 60 * 60
           ) == nil {
            snapshot.clearForecastConfidence()
        }
        return snapshot
    }

    var weatherSavedTime: TimeInterval {
        weatherSavedAt ?? savedAt
    }

    var planSavedTime: TimeInterval {
        planSavedAt ?? (hasPlan ? savedAt : 0)
    }

    var weatherAge: TimeInterval {
        guard weatherSavedTime > 0 else { return .infinity }
        return max(0, Date().timeIntervalSince1970 - weatherSavedTime)
    }

    var planAge: TimeInterval {
        guard planSavedTime > 0 else { return .infinity }
        return max(0, Date().timeIntervalSince1970 - planSavedTime)
    }

    var age: TimeInterval {
        weatherAge
    }

    /// NWS alerts normally include an explicit end time. If one does not, keep
    /// it only briefly so a failed refresh cannot leave an open-ended alert on
    /// the widget indefinitely.
    func hasCurrentOfficialAlert(
        at timestamp: TimeInterval,
        missingExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> Bool {
        guard let title = alertTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
            return false
        }
        if let alertExpiresAt {
            return alertExpiresAt > timestamp
        }
        guard let alertSavedAt, alertSavedAt > 0 else { return false }
        return max(0, timestamp - alertSavedAt) < missingExpiryTTL
    }

    mutating func clearOfficialAlert(checkedAt: TimeInterval? = nil) {
        alertId = nil
        alertTitle = nil
        alertSeverity = nil
        alertStartsAt = nil
        alertExpiresAt = nil
        alertImpact = nil
        alertSource = nil
        alertUrgency = nil
        alertCertainty = nil
        alertCount = 0
        alertSavedAt = checkedAt
        alertStateReady = true
    }

    func preservingOfficialAlert(from stored: NearcastWidgetSnapshot) -> NearcastWidgetSnapshot {
        var snapshot = self
        snapshot.alertId = stored.alertId
        snapshot.alertTitle = stored.alertTitle
        snapshot.alertSeverity = stored.alertSeverity
        snapshot.alertStartsAt = stored.alertStartsAt
        snapshot.alertExpiresAt = stored.alertExpiresAt
        snapshot.alertImpact = stored.alertImpact
        snapshot.alertSource = stored.alertSource
        snapshot.alertUrgency = stored.alertUrgency
        snapshot.alertCertainty = stored.alertCertainty
        snapshot.alertCount = stored.alertCount
        snapshot.alertSavedAt = stored.alertSavedAt
        return snapshot
    }

    /// Arbitrates alert metadata independently from weather freshness. This
    /// prevents a delayed phone or Watch payload from resurrecting an expired
    /// alert, clearing a newer warning, or losing the issuing source.
    func resolvingOfficialAlert(
        with stored: NearcastWidgetSnapshot,
        at timestamp: TimeInterval = Date().timeIntervalSince1970
    ) -> NearcastWidgetSnapshot {
        let incoming = expiringOfficialAlert(at: timestamp)
        let existing = stored.expiringOfficialAlert(at: timestamp)
        let incomingCheckedAt = incoming.alertSavedAt ?? 0
        let existingCheckedAt = existing.alertSavedAt ?? 0
        let shouldKeepExisting = incoming.alertStateReady != true
            || existingCheckedAt > incomingCheckedAt
        guard shouldKeepExisting else { return incoming }

        var resolved = incoming.preservingOfficialAlert(from: existing)
        if existingCheckedAt > incomingCheckedAt {
            resolved.alertStateReady = existing.alertStateReady
        }
        return resolved
    }

    func expiringOfficialAlert(
        at timestamp: TimeInterval,
        missingExpiryTTL: TimeInterval = nearcastWidgetAlertWithoutExpiryTTL
    ) -> NearcastWidgetSnapshot {
        guard alertTitle != nil, !hasCurrentOfficialAlert(at: timestamp, missingExpiryTTL: missingExpiryTTL) else {
            return self
        }
        var snapshot = self
        snapshot.clearOfficialAlert()
        return snapshot
    }

    /// Keeps the receiver's incoming plan and metadata, but refuses to let an
    /// older weather payload replace a fresher observation already on Watch.
    func preservingNewerWeather(from stored: NearcastWidgetSnapshot) -> NearcastWidgetSnapshot {
        guard nativeWeatherInvalidation != true,
              hasCompatibleWeatherUnits(with: stored),
              stored.hasWeatherData,
              !hasWeatherData || stored.weatherSavedTime > weatherSavedTime else {
            var resolved = self
            resolved.uses24HourClock = uses24HourClock ?? stored.uses24HourClock
            resolved.refreshTimelineClockLabels()
            return resolved
        }
        return mergingWeather(from: stored)
    }

    func hasCompatibleWeatherUnits(with other: NearcastWidgetSnapshot) -> Bool {
        func metric(_ value: String) -> Bool? {
            switch value.lowercased() {
            case "mph": return false
            case "km/h", "kmh", "kph": return true
            default: return nil
            }
        }
        guard let ours = metric(windUnit), let theirs = metric(other.windUnit) else { return false }
        return ours == theirs
    }

    /// Shared by the host, extensions and Watch. Generation orders phone
    /// publications, not weather fetch timestamps. Same-generation extension
    /// weather refreshes are permitted; an old phone transfer is not.
    func canReplacePublication(_ stored: NearcastWidgetSnapshot?) -> Bool {
        guard ownerRevision.map({ $0 > 0 }) ?? true,
              publicationGeneration.map({ $0 > 0 }) ?? true,
              ownerRevision == nil || publicationGeneration != nil else { return false }
        guard let stored else { return true }
        if let revision = stored.ownerRevision {
            guard let incoming = ownerRevision, incoming >= revision else { return false }
        }
        if let generation = stored.publicationGeneration {
            guard let incoming = publicationGeneration, incoming >= generation else { return false }
            if incoming == generation && ownerRevision != stored.ownerRevision { return false }
        }
        return true
    }

    /// Selects the forecast rows active at a future complication entry. The
    /// current hourly row is useful for the ribbon, but it must not replace the
    /// API's true current observation until the timeline advances to a new row.
    func timelineProjection(at date: Date, relativeTo now: Date) -> NearcastWidgetTimelineProjection? {
        guard let timeline, !timeline.isEmpty else { return nil }

        let rows: [NearcastWidgetHour]
        let advancesCurrentWeather: Bool
        if timeline.contains(where: { $0.startsAt != nil }) {
            let nowTimestamp = now.timeIntervalSince1970
            let projectedTimestamp = date.timeIntervalSince1970
            let currentIndex = timeline.lastIndex(where: { ($0.startsAt ?? .infinity) <= nowTimestamp }) ?? 0
            let projectedIndex = timeline.lastIndex(where: { ($0.startsAt ?? .infinity) <= projectedTimestamp }) ?? currentIndex
            rows = Array(timeline.suffix(from: projectedIndex))
            advancesCurrentWeather = projectedIndex > currentIndex
        } else {
            let hoursAhead = max(0, Int(date.timeIntervalSince(now) / 3600))
            rows = timeline.filter { $0.offsetHours >= hoursAhead }
            advancesCurrentWeather = hoursAhead > 0
        }

        guard !rows.isEmpty else { return nil }
        let shiftedRows = rows.enumerated().map { index, row in
            var shifted = row
            shifted.offsetHours = index
            return shifted
        }
        return NearcastWidgetTimelineProjection(
            rows: shiftedRows,
            advancesCurrentWeather: advancesCurrentWeather
        )
    }

    /// A true current observation wins while it is newer than the active
    /// hourly forecast row. If a background request fails after an hourly
    /// boundary, the active forecast row is the more honest current value.
    func shouldPromoteCurrentWeather(from projection: NearcastWidgetTimelineProjection) -> Bool {
        guard let activeRow = projection.rows.first else { return false }
        return projection.advancesCurrentWeather
            || (activeRow.startsAt ?? -.infinity) > weatherSavedTime
    }

    /// Cached forecast weather is truthful only through the end of its final
    /// row. This shared boundary keeps iPhone widgets and Watch complications
    /// from leaving the final projected value displayed indefinitely.
    func weatherTimelineValidUntil(
        currentOnlyLifetime: TimeInterval = 2 * 60 * 60
    ) -> Date {
        let timestamps = (timeline ?? []).compactMap(\.startsAt).sorted()
        if let last = timestamps.last {
            let rowDuration: TimeInterval
            if timestamps.count >= 2 {
                rowDuration = min(3 * 60 * 60, max(15 * 60, last - timestamps[timestamps.count - 2]))
            } else {
                rowDuration = 60 * 60
            }
            return Date(timeIntervalSince1970: last + rowDuration)
        }

        if let timeline, !timeline.isEmpty {
            // Older snapshots carried offset rows but no absolute timestamp.
            // Their useful life is the final offset plus one hourly interval,
            // not an assumed full day.
            let lastOffset = max(0, timeline.map(\.offsetHours).max() ?? 0)
            let lifetime = TimeInterval((lastOffset + 1) * 60 * 60)
            return Date(timeIntervalSince1970: weatherSavedTime + lifetime)
        }
        return Date(timeIntervalSince1970: weatherSavedTime + currentOnlyLifetime)
    }

    /// Rolls daily basics at the selected place's midnight so a future entry
    /// never pairs tomorrow's current temperature with today's high/low.
    mutating func projectDailyWeather(at date: Date) {
        guard let daily, !daily.isEmpty else { return }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = placeTimezone.flatMap { TimeZone(identifier: $0) } ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        let dateKey = formatter.string(from: date)
        guard let dayIndex = daily.firstIndex(where: { $0.date == dateKey }) else { return }

        var projectedDays = Array(daily.suffix(from: dayIndex))
        for index in projectedDays.indices {
            if index == 0 {
                projectedDays[index].label = "Today"
            } else if index == 1 {
                projectedDays[index].label = "Tomorrow"
            } else {
                formatter.dateFormat = "yyyy-MM-dd"
                if let day = formatter.date(from: projectedDays[index].date) {
                    formatter.dateFormat = "EEE"
                    projectedDays[index].label = formatter.string(from: day)
                }
            }
        }
        self.daily = projectedDays
        high = projectedDays.first?.high ?? high
        low = projectedDays.first?.low ?? low
    }

    /// Replaces only forecast fields, preserving plan and official-alert
    /// metadata delivered while a network request was in flight.
    func mergingWeather(
        from weather: NearcastWidgetSnapshot,
        minimumVersion: Int = 8
    ) -> NearcastWidgetSnapshot {
        var merged = self
        merged.version = max(minimumVersion, max(version, weather.version))
        // A weather response must not restore an alias from an older phone
        // publication. Legacy snapshots keep their historical merge behavior.
        merged.placeName = ownerRevision == nil ? weather.placeName : placeName
        merged.placeTimezone = weather.placeTimezone ?? placeTimezone
        // Settings belong to the receiving (latest phone-authored) snapshot,
        // not to a weather request that may have started before they changed.
        merged.uses24HourClock = uses24HourClock ?? weather.uses24HourClock
        merged.temperature = weather.temperature
        merged.feelsLike = weather.feelsLike
        merged.high = weather.high
        merged.low = weather.low
        merged.condition = weather.condition
        merged.conditionCode = weather.conditionCode
        merged.isDay = weather.isDay
        merged.rainChance = weather.rainChance
        merged.precipitationNowLabel = weather.precipitationNowLabel
        merged.precipitationNowBasis = weather.precipitationNowBasis
        merged.precipitationNowObserved = weather.precipitationNowObserved
        merged.precipitationNowDetail = weather.precipitationNowDetail
        merged.forecastRainChance = weather.forecastRainChance
        merged.wind = weather.wind
        merged.windUnit = weather.windUnit
        merged.windDirection = weather.windDirection
        merged.windLabel = weather.windLabel
        merged.uv = weather.uv
        merged.nowLabel = weather.nowLabel
        merged.nowValue = weather.nowValue
        merged.nextLabel = weather.nextLabel
        merged.nextValue = weather.nextValue
        merged.laterLabel = weather.laterLabel
        merged.laterValue = weather.laterValue
        merged.canonicalEventId = weather.canonicalEventId
        merged.canonicalEventHeadline = weather.canonicalEventHeadline
        merged.canonicalEventTiming = weather.canonicalEventTiming
        merged.canonicalEventStartAt = weather.canonicalEventStartAt
        merged.canonicalEventEndAt = weather.canonicalEventEndAt
        merged.canonicalEventKind = weather.canonicalEventKind
        merged.confidenceLevel = weather.confidenceLevel
        merged.confidenceHeadline = weather.confidenceHeadline
        merged.confidenceSummary = weather.confidenceSummary
        merged.confidenceWindowStartAt = weather.confidenceWindowStartAt
        merged.confidenceWindowEndAt = weather.confidenceWindowEndAt
        merged.confidenceGeneratedAt = weather.confidenceGeneratedAt
        merged.confidenceActionable = weather.confidenceActionable
        merged.timeline = weather.timeline
        merged.daily = weather.daily
        merged.sunriseAt = weather.sunriseAt
        merged.sunsetAt = weather.sunsetAt
        merged.isAvailable = weather.isAvailable
        merged.weatherSavedAt = weather.weatherSavedAt
        merged.nativeWeatherInvalidation = weather.hasWeatherData ? false : weather.nativeWeatherInvalidation
        merged.refreshTimelineClockLabels()
        return merged
    }

    mutating func refreshTimelineClockLabels() {
        guard let timezone = placeTimezone.flatMap(TimeZone.init(identifier:)), let timeline else { return }
        self.timeline = timeline.map { row in
            guard let startsAt = row.startsAt, startsAt.isFinite, startsAt > 0 else { return row }
            var formatted = row
            formatted.timeLabel = nearcastClockLabel(
                Date(timeIntervalSince1970: startsAt),
                timeZone: timezone,
                uses24HourClock: uses24HourClock,
                compact: true
            )
            return formatted
        }
    }
}

private func cleanCompanionText(_ value: String?) -> String? {
    let cleaned = (value ?? "")
        .components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
    return cleaned.isEmpty ? nil : cleaned
}

private func companionAlertTiming(
    _ alert: NearcastOfficialAlertBrief,
    at timestamp: TimeInterval,
    timeZoneIdentifier: String?,
    uses24HourClock: Bool?
) -> String? {
    let timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
    let now = Date(timeIntervalSince1970: timestamp)

    if let startsAt = alert.startsAt, startsAt > timestamp + 60 {
        return "Starts \(companionDateLabel(Date(timeIntervalSince1970: startsAt), relativeTo: now, timeZone: timeZone, uses24HourClock: uses24HourClock))"
    }
    if let expiresAt = alert.expiresAt {
        return "Until \(companionDateLabel(Date(timeIntervalSince1970: expiresAt), relativeTo: now, timeZone: timeZone, uses24HourClock: uses24HourClock))"
    }
    return "Active now"
}

private func companionDateLabel(_ date: Date, relativeTo now: Date, timeZone: TimeZone, uses24HourClock: Bool?) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let clock = nearcastClockLabel(date, timeZone: timeZone, uses24HourClock: uses24HourClock)
    return calendar.isDate(date, inSameDayAs: now) ? clock : "\(nearcastCompactWeekday(date, calendar: calendar)) \(clock)"
}

extension NearcastWidgetPlace {
    /// Weather belongs to a selected identity, not just a nearby coordinate.
    /// Publication metadata and aliases may change without changing that identity.
    func hasSameWeatherSelection(as other: NearcastWidgetPlace) -> Bool {
        id == other.id && tracksCurrentLocation == other.tracksCurrentLocation &&
            latitude == other.latitude && longitude == other.longitude
    }

    var tracksCurrentLocation: Bool {
        followsCurrentLocation == true
    }

    var displayLabel: String {
        let trimmed = (displayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? name : trimmed
    }

    static func stored() -> NearcastWidgetPlace? {
        NearcastWidgetSnapshotStore.storedPublication()?.place
    }
}

enum NearcastWidgetSnapshotStore {
    static let suiteName = nearcastWidgetSuiteName
    static let snapshotKey = nearcastWidgetSnapshotKey
    static let placeKey = nearcastWidgetPlaceKey
    static let widgetKind = nearcastWidgetKind
    private static let publicationKey = "nearcast.widget.publication.v1"

    struct Publication: Codable, Sendable {
        var snapshot: NearcastWidgetSnapshot
        var place: NearcastWidgetPlace?

        var isCoherent: Bool {
            guard snapshot.canReplacePublication(nil) else { return false }
            guard let place else { return snapshot.ownerRevision == nil || !snapshot.hasWeatherData }
            return place.ownerRevision == snapshot.ownerRevision &&
                place.publicationGeneration == snapshot.publicationGeneration &&
                place.latitude.isFinite && place.longitude.isFinite &&
                abs(place.latitude) <= 90 && abs(place.longitude) <= 180
        }

        func canReplace(_ previous: Publication?) -> Bool {
            guard isCoherent, snapshot.canReplacePublication(previous?.snapshot) else { return false }
            if let previous, let generation = snapshot.publicationGeneration,
               generation == previous.snapshot.publicationGeneration {
                // Extension weather may advance within a phone generation,
                // but it cannot change its selection or preference authority.
                return place == previous.place && snapshot.windUnit == previous.snapshot.windUnit &&
                    snapshot.uses24HourClock == previous.snapshot.uses24HourClock
            }
            return true
        }
    }

    enum ReadResult: Sendable { case missing, valid(Publication), blocked }

    private static var fileStore: NearcastWidgetPublicationFileStore? {
        #if canImport(Darwin)
        guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName) else { return nil }
        return NearcastWidgetPublicationFileStore(directory: group.appendingPathComponent("NearcastWidgetPublication", isDirectory: true))
        #else
        return nil
        #endif
    }

    static func storedPublication() -> Publication? {
        switch fileStore?.read() ?? .missing {
        case .valid(let publication): return publication
        case .blocked: return nil // Corrupt/future authority must never fall back to stale defaults.
        case .missing:
            if case .valid(let publication) = legacyPublication() { return publication }
            return nil
        }
    }

    private static func legacyPublication() -> ReadResult {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return .blocked }
        if let data = defaults.data(forKey: publicationKey) {
            guard data.count <= NearcastWidgetPublicationFileStore.maximumBytes,
                  let publication = try? JSONDecoder().decode(Publication.self, from: data), publication.isCoherent else { return .blocked }
            return .valid(publication)
        }
        guard let snapshotData = defaults.data(forKey: snapshotKey) else { return .missing }
        guard snapshotData.count <= NearcastWidgetPublicationFileStore.maximumBytes,
              let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: snapshotData) else { return .blocked }
        var place: NearcastWidgetPlace?
        if let placeData = defaults.data(forKey: placeKey) {
            guard placeData.count <= NearcastWidgetPublicationFileStore.maximumBytes,
                  let decoded = try? JSONDecoder().decode(NearcastWidgetPlace.self, from: placeData) else { return .blocked }
            place = decoded
        }
        let publication = Publication(snapshot: snapshot, place: place)
        return publication.isCoherent ? .valid(publication) : .blocked
    }

    @discardableResult
    static func savePublication(_ snapshot: NearcastWidgetSnapshot, place: NearcastWidgetPlace?) -> Bool {
        // No App Group container means there is no shared writer. Portable
        // tests inject a sink or an explicit temporary file-store directory.
        guard let fileStore else { return false }
        return fileStore.commit(Publication(snapshot: snapshot, place: place), legacy: legacyPublication) { committed in
            // Compatibility mirrors are written while the same cross-process
            // lock is held. Current readers use the authoritative pair file.
            guard let defaults = UserDefaults(suiteName: suiteName) else { return }
            if let data = try? JSONEncoder().encode(committed) { defaults.set(data, forKey: publicationKey) }
            if let data = try? JSONEncoder().encode(committed.snapshot) { defaults.set(data, forKey: snapshotKey) }
            if let place = committed.place, let data = try? JSONEncoder().encode(place) { defaults.set(data, forKey: placeKey) }
            else { defaults.removeObject(forKey: placeKey) }
        }
    }

    @discardableResult
    static func save(_ snapshot: NearcastWidgetSnapshot) -> Bool {
        savePublication(snapshot, place: storedPublication()?.place)
    }

    @discardableResult
    static func saveSnapshotData(_ data: Data) -> Bool {
        guard let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data) else { return false }
        return save(snapshot)
    }

    @discardableResult
    static func savePlaceData(_ data: Data) -> Bool {
        guard let place = try? JSONDecoder().decode(NearcastWidgetPlace.self, from: data),
              let snapshot = storedPublication()?.snapshot else { return false }
        return savePublication(snapshot, place: place)
    }

    /// A rejected extension write must not escape into its returned timeline.
    /// Read again after either result so a concurrent phone commit wins there too.
    static func saveRefreshResult(_ snapshot: NearcastWidgetSnapshot,
                                  commit: (NearcastWidgetSnapshot) -> Bool = NearcastWidgetSnapshotStore.save,
                                  current: () -> NearcastWidgetSnapshot = NearcastWidgetSnapshot.current) -> NearcastWidgetSnapshot {
        _ = commit(snapshot)
        return current()
    }
}

/// The app and extensions are separate processes. UserDefaults caching and a
/// read/check/set sequence cannot serialize their writes. A bounded flock plus
/// an atomically replaced pair file makes the generation check and commit one
/// cross-process operation; corrupt or future files fail closed.
struct NearcastWidgetPublicationFileStore {
    typealias Publication = NearcastWidgetSnapshotStore.Publication
    typealias ReadResult = NearcastWidgetSnapshotStore.ReadResult
    static let maximumBytes = 1_024 * 1_024
    static let fileName = "publication.v1.json"

    let directory: URL
    private let beforeReplace: (() -> Void)?

    init(directory: URL, beforeReplace: (() -> Void)? = nil) {
        self.directory = directory
        self.beforeReplace = beforeReplace
    }

    private struct Envelope: Codable {
        let version: Int
        let publication: Publication
    }

    func read() -> ReadResult {
        let url = directory.appendingPathComponent(Self.fileName)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { return errno == ENOENT ? .missing : .blocked }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var attributes = stat()
        guard fstat(descriptor, &attributes) == 0, (attributes.st_mode & S_IFMT) == S_IFREG,
              attributes.st_size >= 0, attributes.st_size <= Self.maximumBytes,
              let data = try? handle.readToEnd(), data.count <= Self.maximumBytes,
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data), envelope.version == 1,
              envelope.publication.isCoherent else { return .blocked }
        return .valid(envelope.publication)
    }

    @discardableResult
    func commit(_ publication: Publication, legacy: () -> ReadResult = { .missing },
                didCommit: (Publication) -> Void = { _ in }) -> Bool {
        guard publication.isCoherent else { return false }
        do {
            try prepareDirectory()
            let lock = open(directory.appendingPathComponent("publication.lock").path,
                O_CREAT | O_RDWR | O_NOFOLLOW, mode_t(0o600))
            guard lock >= 0 else { return false }
            defer { close(lock) }
            // A suspended extension must not block the phone's main actor.
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { return false }
            defer { _ = flock(lock, LOCK_UN) }
            let state: ReadResult
            switch read() {
            case .missing: state = legacy()
            case let value: state = value
            }
            let previous: Publication?
            switch state {
            case .blocked: return false
            case .missing: previous = nil
            case .valid(let value): previous = value
            }
            guard publication.canReplace(previous) else { return false }
            var committed = publication
            // A successful refresh may have copied an unavailable fallback's
            // marker. Actual weather must participate in freshness arbitration.
            if committed.snapshot.hasWeatherData { committed.snapshot.nativeWeatherInvalidation = false }
            if let previous, let place = committed.place, let previousPlace = previous.place,
               place.hasSameWeatherSelection(as: previousPlace),
               committed.snapshot.hasCompatibleWeatherUnits(with: previous.snapshot) {
                // This also covers a native metadata publication built just
                // before an extension committed fresher same-place weather.
                // The merge retains incoming owner/plan/settings authority.
                committed.snapshot = committed.snapshot
                    .preservingNewerWeather(from: previous.snapshot)
                    .resolvingOfficialAlert(with: previous.snapshot)
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(Envelope(version: 1, publication: committed))
            guard data.count <= Self.maximumBytes else { return false }
            beforeReplace?() // Deterministic interleaving seam for the file-store tests.
            try atomicWrite(data)
            guard case .valid = read() else { return false }
            didCommit(committed)
            return true
        } catch { return false }
    }

    private func prepareDirectory() throws {
        guard directory.isFileURL else { throw CocoaError(.fileWriteInvalidFileName) }
        var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
        #if os(iOS) || os(watchOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
        let descriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        close(descriptor)
    }

    private func atomicWrite(_ data: Data) throws {
        let temporary = directory.appendingPathComponent(".pending-\(UUID().uuidString)")
        let descriptor = open(temporary.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: temporary)
        }
        #if os(iOS) || os(watchOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
        #endif
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
        guard try Data(contentsOf: temporary, options: .uncached) == data,
              rename(temporary.path, directory.appendingPathComponent(Self.fileName).path) == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        defer { close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw CocoaError(.fileWriteUnknown) }
    }
}
