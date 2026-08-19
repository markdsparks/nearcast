import Foundation

let nearcastWidgetSuiteName = "group.app.nearcast.ios"
let nearcastWidgetSnapshotKey = "nearcast.widget.snapshot.v1"
let nearcastWidgetPlaceKey = "nearcast.widget.place.v1"
let nearcastWidgetKind = "NearcastWidget"
let nearcastWidgetAlertWithoutExpiryTTL: TimeInterval = 45 * 60

struct NearcastWidgetSnapshot: Codable {
    var version: Int
    var savedAt: TimeInterval
    var placeName: String
    var placeTimezone: String? = nil
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
    // companion surfaces present these words verbatim instead of independently
    // inferring a different event from the raw hourly rows. Every field is
    // optional so V7 and older snapshots continue to decode unchanged.
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
}

extension NearcastWidgetSnapshot {
    // V9 is the first snapshot contract that can distinguish an absent PoP
    // from a real 0%. Older snapshots only carried the required `rainChance`
    // field, so retain that value when decoding them.
    var forecastRainChanceForDisplay: Int? {
        forecastRainChance ?? (version < 9 ? rainChance : nil)
    }
}

struct NearcastWidgetHour: Codable, Identifiable {
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

    var isMaterialCaution: Bool {
        level == .medium || level == .low
    }
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
}

struct NearcastWidgetDay: Codable, Identifiable {
    var id: String { date }
    var date: String
    var label: String
    var high: Int
    var low: Int
    var rainChance: Int
    var conditionCode: Int
}

/// The provider's raw weather code describes the most significant condition
/// it modeled for an interval. It is not, by itself, a good compact headline:
/// a very small shower or storm chance can otherwise turn an entire hour or
/// day into a rain icon. These inputs let every native surface apply the same
/// conservative presentation policy as the main Nearcast forecast.
struct NearcastForecastSemanticHour {
    var time: String
    var rawCode: Int?
    var precipitationChance: Double
    var precipitationAmount: Double
    var cloudCover: Double?
    var isDay: Bool?

    var dateKey: String {
        String(time.prefix(10))
    }

    var localHour: Int? {
        guard let clock = time.split(separator: "T").last,
              let hour = Int(clock.split(separator: ":").first ?? "") else {
            return nil
        }
        return hour
    }
}

enum NearcastForecastSemantics {
    private static let hourlyLikelyChance = 60.0
    private static let hourlySupportedChance = 30.0
    private static let dailyNoteChance = 20.0
    private static let hourlyAmountThreshold = 0.75 // Open-Meteo is requested in millimeters.
    private static let dailyAmountThreshold = 2.0
    private static let measurableRate = 0.2
    private static let moderateRate = 2.5
    private static let heavyRate = 7.6

    static func currentConditionCode(
        rawCode: Int?,
        precipitationAmount: Double?,
        intervalSeconds: Double?,
        cloudCover: Double?
    ) -> Int? {
        let rate = precipitationRate(
            amount: precipitationAmount ?? 0,
            intervalSeconds: intervalSeconds ?? 3_600
        )
        if let measured = measuredPrecipitationCode(rate: rate, baseCode: rawCode) {
            return strongerPrecipitationCode(rawCode, measured)
        }
        guard let rawCode else { return skyCode(cloudCover: cloudCover) }
        return isPrecipitationCondition(rawCode) ? skyCode(cloudCover: cloudCover) : rawCode
    }

    static func hourlyConditionCode(for hour: NearcastForecastSemanticHour) -> Int {
        let chance = max(0, min(100, hour.precipitationChance))
        let rate = precipitationRate(amount: hour.precipitationAmount, intervalSeconds: 3_600)
        let isPrimary = chance >= hourlyLikelyChance
            || (chance >= hourlySupportedChance && rate >= hourlyAmountThreshold)
        guard isPrimary else { return nonPrecipitationCode(hour.rawCode, cloudCover: hour.cloudCover) }

        if let measured = measuredPrecipitationCode(rate: rate, baseCode: hour.rawCode) {
            return strongerPrecipitationCode(hour.rawCode, measured) ?? measured
        }
        if let rawCode = hour.rawCode, isPrecipitationCondition(rawCode) {
            return rawCode
        }
        // A likely wet hour whose provider code is still a sky condition needs
        // a standard WMO rain code; native symbols do not serialize the web
        // app's internal `rain-likely` sentinel.
        return 61
    }

    /// Returns the condition that should represent a daily card. Callers pass
    /// only hours that remain in the day for "Today"; future days pass their
    /// full hourly window. Daylight owns the headline when there is enough of
    /// it to be representative, otherwise waking or remaining hours are used.
    static func dailyConditionCode(
        hours: [NearcastForecastSemanticHour],
        fallbackCode: Int?
    ) -> Int {
        let scoped = primaryHours(from: hours)
        guard !scoped.isEmpty else {
            return conservativeFallbackCode(fallbackCode)
        }

        var count30 = 0
        var count40 = 0
        var count60 = 0
        var maximumChance = 0.0
        var totalAmount = 0.0
        var bestCode: Int?
        var bestScore = -Double.infinity
        var bestRawCode: Int?
        var bestRawScore = -Double.infinity
        var skyCounts: [Int: Int] = [:]

        for hour in scoped {
            let chance = max(0, min(100, hour.precipitationChance))
            let rate = precipitationRate(amount: hour.precipitationAmount, intervalSeconds: 3_600)
            maximumChance = max(maximumChance, chance)
            totalAmount += max(0, hour.precipitationAmount)
            if chance >= 30 { count30 += 1 }
            if chance >= 40 { count40 += 1 }
            if chance >= 60 { count60 += 1 }

            let sky = nonPrecipitationCode(hour.rawCode, cloudCover: hour.cloudCover)
            skyCounts[sky, default: 0] += 1

            if let rawCode = hour.rawCode, isPrecipitationCondition(rawCode) {
                let score = chance * 1_000 + Double(precipitationWeight(rawCode))
                if score > bestRawScore {
                    bestRawScore = score
                    bestRawCode = rawCode
                }
            }

            guard chance >= 30 || (chance >= dailyNoteChance && rate >= hourlyAmountThreshold) else {
                continue
            }
            let candidate = hourlyConditionCode(for: hour)
            guard isPrecipitationCondition(candidate) else { continue }
            let score = Double(precipitationWeight(candidate)) * 100_000
                + chance * 1_000
                + min(999, (rate * 100).rounded())
            if score > bestScore {
                bestScore = score
                bestCode = candidate
            }
        }

        let amountPrimary = totalAmount >= dailyAmountThreshold && maximumChance >= hourlySupportedChance
        let sustained = count60 >= 2 || count40 >= 3 || count30 >= 4 || amountPrimary
        if sustained {
            if let bestCode { return bestCode }
            if let bestRawCode { return bestRawCode }
            return 61
        }

        if let modalSky = skyCounts.keys.sorted(by: { lhs, rhs in
            let lhsCount = skyCounts[lhs, default: 0]
            let rhsCount = skyCounts[rhs, default: 0]
            return lhsCount == rhsCount ? lhs < rhs : lhsCount > rhsCount
        }).first {
            return modalSky
        }
        return conservativeFallbackCode(fallbackCode)
    }

    private static func primaryHours(from hours: [NearcastForecastSemanticHour]) -> [NearcastForecastSemanticHour] {
        let daytime = hours.filter { $0.isDay == true }
        if daytime.count >= min(4, hours.count) { return daytime }
        let waking = hours.filter { hour in
            guard let localHour = hour.localHour else { return false }
            return localHour >= 6 && localHour < 22
        }
        return waking.isEmpty ? hours : waking
    }

    private static func conservativeFallbackCode(_ rawCode: Int?) -> Int {
        guard let rawCode else { return 2 }
        return isPrecipitationCondition(rawCode) ? 2 : rawCode
    }

    private static func nonPrecipitationCode(_ rawCode: Int?, cloudCover: Double?) -> Int {
        guard let rawCode else { return skyCode(cloudCover: cloudCover) }
        return isPrecipitationCondition(rawCode) ? skyCode(cloudCover: cloudCover) : rawCode
    }

    private static func skyCode(cloudCover: Double?) -> Int {
        guard let cloudCover, cloudCover.isFinite else { return 2 }
        if cloudCover < 15 { return 0 }
        if cloudCover < 45 { return 1 }
        if cloudCover < 75 { return 2 }
        return 3
    }

    private static func precipitationRate(amount: Double, intervalSeconds: Double) -> Double {
        let seconds = intervalSeconds > 0 ? intervalSeconds : 3_600
        return max(0, amount) * 3_600 / seconds
    }

    private static func measuredPrecipitationCode(rate: Double, baseCode: Int?) -> Int? {
        guard rate >= measurableRate else { return nil }
        if let baseCode, isThunderCode(baseCode) { return baseCode }
        if let baseCode, isSnowCode(baseCode) {
            if rate >= heavyRate { return 75 }
            if rate >= moderateRate { return 73 }
            return 71
        }
        if rate >= heavyRate { return 65 }
        if rate >= moderateRate { return 63 }
        return 61
    }

    private static func strongerPrecipitationCode(_ lhs: Int?, _ rhs: Int?) -> Int? {
        guard let lhs else { return rhs }
        guard let rhs else { return lhs }
        return precipitationWeight(rhs) > precipitationWeight(lhs) ? rhs : lhs
    }

    private static func precipitationWeight(_ code: Int) -> Int {
        if isThunderCode(code) { return 70 }
        if [65, 67, 75, 82, 86].contains(code) { return 60 }
        if [63, 73, 80, 81, 85].contains(code) { return 50 }
        if [61, 66, 71, 77].contains(code) { return 40 }
        if (51...57).contains(code) { return 30 }
        return 0
    }

    private static func isThunderCode(_ code: Int) -> Bool {
        code == 95 || code == 96 || code == 99
    }

    private static func isSnowCode(_ code: Int) -> Bool {
        (71...77).contains(code) || code == 85 || code == 86
    }

    private static func isPrecipitationCondition(_ code: Int) -> Bool {
        (51...86).contains(code) || isThunderCode(code)
    }
}

struct NearcastWidgetPlace: Codable {
    var id: String?
    var name: String
    var displayName: String?
    var admin1: String?
    var country: String?
    var countryCode: String?
    var followsCurrentLocation: Bool? = nil
    var latitude: Double
    var longitude: Double
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
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetSnapshotKey),
            let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data)
        else {
            return nil
        }
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

    /// Confidence is useful only while its claim window and generation time
    /// are current. The weather itself may remain projectable for longer, but
    /// an old model-comparison receipt must not quietly survive on a widget.
    func forecastConfidenceBrief(
        at timestamp: TimeInterval = Date().timeIntervalSince1970,
        maximumAge: TimeInterval = 3 * 60 * 60
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
            timeZoneIdentifier: placeTimezone
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
                impact: alert.impact
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
            impact: nil
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
           snapshot.forecastConfidenceBrief(at: timestamp) == nil {
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
        guard stored.hasWeatherData,
              !hasWeatherData || stored.weatherSavedTime > weatherSavedTime else {
            return self
        }
        return mergingWeather(from: stored)
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
        merged.placeName = weather.placeName
        merged.placeTimezone = weather.placeTimezone
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
        merged.timeline = weather.timeline
        merged.daily = weather.daily
        merged.sunriseAt = weather.sunriseAt
        merged.sunsetAt = weather.sunsetAt
        merged.isAvailable = weather.isAvailable
        merged.weatherSavedAt = weather.weatherSavedAt
        return merged
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
    timeZoneIdentifier: String?
) -> String? {
    let timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
    let now = Date(timeIntervalSince1970: timestamp)

    if let startsAt = alert.startsAt, startsAt > timestamp + 60 {
        return "Starts \(companionDateLabel(Date(timeIntervalSince1970: startsAt), relativeTo: now, timeZone: timeZone))"
    }
    if let expiresAt = alert.expiresAt {
        return "Until \(companionDateLabel(Date(timeIntervalSince1970: expiresAt), relativeTo: now, timeZone: timeZone))"
    }
    return "Active now"
}

private func companionDateLabel(_ date: Date, relativeTo now: Date, timeZone: TimeZone) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = calendar.isDate(date, inSameDayAs: now) ? "h:mm a" : "EEE h:mm a"
    return formatter.string(from: date).replacingOccurrences(of: ":00", with: "")
}

extension NearcastWidgetPlace {
    var tracksCurrentLocation: Bool {
        followsCurrentLocation == true
    }

    var displayLabel: String {
        let trimmed = (displayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? name : trimmed
    }

    static func stored() -> NearcastWidgetPlace? {
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetPlaceKey),
            let place = try? JSONDecoder().decode(NearcastWidgetPlace.self, from: data)
        else {
            return nil
        }
        return place
    }
}

enum NearcastWidgetSnapshotStore {
    static let suiteName = nearcastWidgetSuiteName
    static let snapshotKey = nearcastWidgetSnapshotKey
    static let placeKey = nearcastWidgetPlaceKey
    static let widgetKind = nearcastWidgetKind

    static func save(_ snapshot: NearcastWidgetSnapshot) {
        guard let defaults = UserDefaults(suiteName: suiteName),
              let data = try? JSONEncoder().encode(snapshot) else {
            return
        }
        defaults.set(data, forKey: snapshotKey)
    }

    static func saveSnapshotData(_ data: Data) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            return
        }
        defaults.set(data, forKey: snapshotKey)
    }

    static func savePlaceData(_ data: Data) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            return
        }
        defaults.set(data, forKey: placeKey)
    }
}
