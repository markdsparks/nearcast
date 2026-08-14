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
    var alertExpiresAt: TimeInterval? = nil
    var alertImpact: String? = nil
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
}

struct NearcastWidgetTimelineProjection {
    var rows: [NearcastWidgetHour]
    var advancesCurrentWeather: Bool
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
        version: 7,
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
        alertExpiresAt = nil
        alertImpact = nil
        alertCount = 0
        alertSavedAt = checkedAt
        alertStateReady = true
    }

    func preservingOfficialAlert(from stored: NearcastWidgetSnapshot) -> NearcastWidgetSnapshot {
        var snapshot = self
        snapshot.alertId = stored.alertId
        snapshot.alertTitle = stored.alertTitle
        snapshot.alertSeverity = stored.alertSeverity
        snapshot.alertExpiresAt = stored.alertExpiresAt
        snapshot.alertImpact = stored.alertImpact
        snapshot.alertCount = stored.alertCount
        snapshot.alertSavedAt = stored.alertSavedAt
        return snapshot
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
        minimumVersion: Int = 7
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
        merged.timeline = weather.timeline
        merged.daily = weather.daily
        merged.sunriseAt = weather.sunriseAt
        merged.sunsetAt = weather.sunsetAt
        merged.isAvailable = weather.isAvailable
        merged.weatherSavedAt = weather.weatherSavedAt
        return merged
    }
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
