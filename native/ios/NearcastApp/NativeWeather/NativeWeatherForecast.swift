import Foundation
import CoreFoundation

/// Full app weather, separate from the intentionally compact widget snapshot.
/// Temperatures and wind use the requested system; precipitation is always mm.
struct NativeForecastPoint: Codable, Sendable, Identifiable {
    enum Origin: String, Codable, Sendable {
        case modeledCurrent = "modeled-current"
        case hourlyForecast = "hourly-forecast"
        case quarterHourForecast = "15-minute-forecast"
    }

    var id: Date { date }
    let date: Date
    /// Explicit provenance survives both the normalized service and local
    /// Codable snapshots. A missing legacy origin is deliberately unknown.
    let origin: Origin?
    /// Accumulation interval, not an assumed hourly rate. Unknown or invalid
    /// intervals remain unavailable for active precipitation presentation.
    let precipitationIntervalSeconds: Double?
    let temperature: Double?
    let apparentTemperature: Double?
    let rainProbability: Double?
    let precipitationMM: Double?
    let windSpeed: Double?
    let windGusts: Double?
    let uvIndex: Double?
    let weatherCode: Int?
    let rawWeatherCode: Int?
    let isDay: Bool?
    let thunderPossible: Bool
    let relativeHumidity: Double?
    let dewPoint: Double?
    /// Visibility stays in meters regardless of the selected display units.
    let visibilityMeters: Double?
    let windDirection: Double?
    /// Cloud density is useful visual context, but it never changes the
    /// deterministic condition label by itself.
    let cloudCover: Double?
    /// Optional atmosphere enrichment already supplied by the forecast API.
    /// Cloud layers are percentages; radiation is W/m² in either unit system.
    let lowCloudCover: Double?
    let midCloudCover: Double?
    let highCloudCover: Double?
    let shortwaveRadiation: Double?
    let directRadiation: Double?
    let diffuseRadiation: Double?

    init(date: Date, temperature: Double? = nil, apparentTemperature: Double? = nil,
         rainProbability: Double? = nil, precipitationMM: Double? = nil,
         windSpeed: Double? = nil, windGusts: Double? = nil, uvIndex: Double? = nil,
         weatherCode: Int? = nil, isDay: Bool? = nil, thunderPossible: Bool = false, rawWeatherCode: Int? = nil,
         relativeHumidity: Double? = nil, dewPoint: Double? = nil, visibilityMeters: Double? = nil, windDirection: Double? = nil,
         cloudCover: Double? = nil, lowCloudCover: Double? = nil, midCloudCover: Double? = nil,
         highCloudCover: Double? = nil, shortwaveRadiation: Double? = nil,
         directRadiation: Double? = nil, diffuseRadiation: Double? = nil,
         origin: Origin? = nil, precipitationIntervalSeconds: Double? = nil) {
        self.date = date
        self.origin = origin
        self.precipitationIntervalSeconds = Self.valid(precipitationIntervalSeconds, in: 60...3600)
        self.temperature = temperature
        self.apparentTemperature = apparentTemperature
        self.rainProbability = rainProbability
        self.precipitationMM = precipitationMM
        self.windSpeed = windSpeed
        self.windGusts = windGusts
        self.uvIndex = uvIndex
        self.weatherCode = weatherCode
        self.rawWeatherCode = rawWeatherCode
        self.isDay = isDay
        self.thunderPossible = thunderPossible
        self.relativeHumidity = relativeHumidity
        self.dewPoint = dewPoint
        self.visibilityMeters = visibilityMeters
        self.windDirection = windDirection
        self.cloudCover = cloudCover.flatMap { $0.isFinite ? min(100, max(0, $0)) : nil }
        self.lowCloudCover = Self.valid(lowCloudCover, in: 0...100)
        self.midCloudCover = Self.valid(midCloudCover, in: 0...100)
        self.highCloudCover = Self.valid(highCloudCover, in: 0...100)
        self.shortwaveRadiation = Self.valid(shortwaveRadiation, in: 0...2000)
        self.directRadiation = Self.valid(directRadiation, in: 0...2000)
        self.diffuseRadiation = Self.valid(diffuseRadiation, in: 0...2000)
    }

    private static func valid(_ value: Double?, in range: ClosedRange<Double>) -> Double? {
        value.flatMap { $0.isFinite && range.contains($0) ? $0 : nil }
    }

    var conditionLabel: String {
        if thunderPossible && !NativeWeatherCondition.isThunder(weatherCode) { return "Thunderstorms possible" }
        return NativeWeatherCondition.label(weatherCode)
    }

    /// Possibility alone does not turn a sky/rain symbol into a definite storm.
    var symbolName: String { NativeWeatherCondition.symbol(weatherCode, isDay: isDay) }

    var hasReadings: Bool {
        temperature != nil || apparentTemperature != nil || rainProbability != nil || precipitationMM != nil
            || windSpeed != nil || windGusts != nil || uvIndex != nil || weatherCode != nil
            || relativeHumidity != nil || dewPoint != nil || visibilityMeters != nil || windDirection != nil
    }
}

/// A small, shared presentation helper for wind values that came from the
/// forecast provider. Directions describe where the wind comes *from*; that
/// convention is kept explicit in accessibility copy wherever it is shown.
enum NativeWindDirection {
    private static let compassPoints = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
    ]

    private static let spokenCompassPoints = [
        "north", "north-northeast", "northeast", "east-northeast",
        "east", "east-southeast", "southeast", "south-southeast",
        "south", "south-southwest", "southwest", "west-southwest",
        "west", "west-northwest", "northwest", "north-northwest"
    ]

    static func compassPoint(_ degrees: Double?) -> String? {
        guard let degrees, degrees.isFinite, (0...360).contains(degrees) else { return nil }
        return compassPoints[Int((degrees / 22.5).rounded()) % compassPoints.count]
    }

    static func spokenCompassPoint(_ degrees: Double?) -> String? {
        guard let degrees, degrees.isFinite, (0...360).contains(degrees) else { return nil }
        return spokenCompassPoints[Int((degrees / 22.5).rounded()) % spokenCompassPoints.count]
    }
}

struct NativeForecastDay: Codable, Sendable, Identifiable {
    var id: Date { date }
    let date: Date
    let high: Double?
    let low: Double?
    let rainProbability: Double?
    let precipitationMM: Double?
    let uvIndex: Double?
    let weatherCode: Int?
    let sunrise: Date?
    let sunset: Date?
    let thunderPossible: Bool

    init(date: Date, high: Double? = nil, low: Double? = nil, rainProbability: Double? = nil,
         precipitationMM: Double? = nil, uvIndex: Double? = nil, weatherCode: Int? = nil,
         sunrise: Date? = nil, sunset: Date? = nil, thunderPossible: Bool = false) {
        self.date = date
        self.high = high
        self.low = low
        self.rainProbability = rainProbability
        self.precipitationMM = precipitationMM
        self.uvIndex = uvIndex
        self.weatherCode = weatherCode
        self.sunrise = sunrise
        self.sunset = sunset
        self.thunderPossible = thunderPossible
    }

    var conditionLabel: String {
        if thunderPossible && !NativeWeatherCondition.isThunder(weatherCode) { return "Thunderstorms possible" }
        return NativeWeatherCondition.label(weatherCode)
    }
    var symbolName: String { NativeWeatherCondition.symbol(weatherCode, isDay: true) }
}

struct NativeWeatherForecast: Codable, Sendable {
    let generatedAt: Date
    let timezoneID: String
    let metric: Bool
    let current: NativeForecastPoint?
    let hours: [NativeForecastPoint]
    let quarterHours: [NativeForecastPoint]
    let days: [NativeForecastDay]

    var timeZone: TimeZone { TimeZone(identifier: timezoneID) ?? TimeZone(secondsFromGMT: 0)! }
    var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = timeZone
        return value
    }

    func hours(on date: Date) -> [NativeForecastPoint] {
        guard let interval = calendar.dateInterval(of: .day, for: date) else { return [] }
        return hours.filter { $0.date >= interval.start && $0.date < interval.end }
    }

    func day(containing date: Date) -> NativeForecastDay? {
        days.first { calendar.isDate($0.date, inSameDayAs: date) }
    }

    /// A rolling window is elapsed time, not a civil day or a count of rows.
    /// DST repeats keep their distinct timestamps, and provider gaps do not
    /// silently stretch "24 hours" into a longer forecast.
    func rollingHourlyWindow(now: Date, hours count: Int = 24) -> DateInterval {
        let start = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        return DateInterval(start: start, duration: Double(min(14 * 24, max(1, count))) * 3_600)
    }

    func rollingHours(now: Date, hours count: Int = 24, includeEarlierToday: Bool = false) -> [NativeForecastPoint] {
        let window = rollingHourlyWindow(now: now, hours: count)
        let start = includeEarlierToday ? calendar.startOfDay(for: now) : window.start
        return hours.filter {
            $0.origin != .quarterHourForecast && $0.hasReadings && $0.date >= start && $0.date < window.end
        }.sorted { $0.date < $1.date }
    }

    func hasMoreRollingHours(now: Date, hours count: Int) -> Bool {
        guard count < 14 * 24 else { return false }
        let end = rollingHourlyWindow(now: now, hours: count).end
        let limit = rollingHourlyWindow(now: now, hours: 14 * 24).end
        return hours.contains { $0.hasReadings && $0.origin != .quarterHourForecast && $0.date >= end && $0.date < limit }
    }

    func isRepeatedLocalHour(_ date: Date) -> Bool {
        let components: Set<Calendar.Component> = [.year, .month, .day, .hour]
        let value = calendar.dateComponents(components, from: date)
        return [-3_600.0, 3_600.0].contains { offset in
            calendar.dateComponents(components, from: date.addingTimeInterval(offset)) == value
        }
    }

    // Presentation windows retain actual service timestamps, including local
    // midnight and the 25th hour of a fall-back day. No samples are synthesized.
    func previewTrendHours(on day: Date, now: Date) -> [NativeForecastPoint] {
        guard calendar.isDate(day, inSameDayAs: now) else { return hours(on: day) }
        let start = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        return Array(hours.filter { $0.date >= start }.prefix(24))
    }

    /// Home's compact outlook has room to give "Now" useful context. It may
    /// retain a small number of provider-supplied earlier hourly *forecast*
    /// values, but it never synthesizes intervals or treats them as observed
    /// history. The analytical Hourly surface owns its broader lookback.
    func outlookTrendHours(on day: Date, now: Date, earlierHourCount: Int = 2) -> [NativeForecastPoint] {
        guard calendar.isDate(day, inSameDayAs: now) else { return hours(on: day) }
        let currentHour = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        // Never reach into a prior civil day merely to fill the Home lookback.
        // Midnight gets no invented predecessor; future coverage can still
        // continue across the following midnight.
        let earlier = Array(hours(on: day).filter { $0.date < currentHour }.suffix(max(0, earlierHourCount)))
        let onward = Array(hours.filter { $0.date >= currentHour }.prefix(24))
        return earlier + onward
    }

    func previewQuarterHours(on day: Date, now: Date) -> [NativeForecastPoint] {
        let today = calendar.isDate(day, inSameDayAs: now)
        return quarterHours.filter {
            (today || calendar.isDate($0.date, inSameDayAs: day)) && $0.date.addingTimeInterval(900) > now
        }
    }

    /// Native Hourly distinguishes a rolling near-term read from an explicitly
    /// selected civil day. Both use only the real six-hour service feed.
    func hourlyQuarterHours(on day: Date?, now: Date) -> [NativeForecastPoint] {
        quarterHours.filter { point in
            point.hasReadings && point.date.addingTimeInterval(900) > now
                && point.date < now.addingTimeInterval(6 * 3_600)
                && (day.map { calendar.isDate(point.date, inSameDayAs: $0) } ?? true)
        }.sorted { $0.date < $1.date }
    }

    func startsPreviewDaySection(_ date: Date, after previous: Date?, selectedDay: Date) -> Bool {
        !calendar.isDate(date, inSameDayAs: previous ?? selectedDay)
    }

    static func decode(data: Data, latitude: Double, longitude: Double, metric: Bool, now: Date) throws -> Self {
        try NativeForecastDecoder.decode(data: data, latitude: latitude, longitude: longitude, metric: metric, now: now)
    }
}

/// The hero and immersive sky share one freshness decision. Active weather
/// treatment is narrower than a forecast headline: only an explicitly
/// identified current model point can support it. This is not radar observation.
struct NativeCurrentWeatherDecision: Sendable {
    let acceptedPoint: NativeForecastPoint?
    private let evaluatedAt: Date

    init(forecast: NativeWeatherForecast?, now: Date) {
        self.init(point: forecast?.current, now: now)
    }

    init(point: NativeForecastPoint?, now: Date) {
        evaluatedAt = now
        acceptedPoint = point.flatMap { value in
            let age = now.timeIntervalSince(value.date)
            return age >= -5 * 60 && age < 90 * 60 ? value : nil
        }
    }

    var hasFreshReading: Bool { acceptedPoint != nil }

    /// A wet deterministic model and unlikely matching probability guidance
    /// describe an uncertain signal. Preserve both readings; only presentation
    /// is reconciled. Nearby temperature observations cannot settle this.
    var hasConflictingPrecipitationGuidance: Bool {
        guard let point = acceptedPoint, point.origin == .modeledCurrent,
              let chance = point.rainProbability,
              chance.isFinite, (0..<30).contains(chance),
              Self.isPrecipitationCode(point.weatherCode) else { return false }
        return true
    }

    var presentationWeatherCode: Int? {
        guard let point = acceptedPoint else { return nil }
        guard hasConflictingPrecipitationGuidance else { return point.weatherCode }
        return NearcastForecastSemantics.currentConditionCode(rawCode: point.weatherCode,
            precipitationAmount: point.precipitationMM, intervalSeconds: point.precipitationIntervalSeconds,
            cloudCover: point.cloudCover, modeledPrecipitationChance: point.rainProbability)
    }

    var conditionLabel: String {
        guard hasConflictingPrecipitationGuidance else {
            return NativeWeatherCondition.label(acceptedPoint?.weatherCode)
        }
        switch acceptedPoint?.rawWeatherCode ?? acceptedPoint?.weatherCode {
        case 71, 73, 75, 77, 85, 86: return "Snow possible"
        case 56, 57, 66, 67: return "Freezing precipitation possible"
        case 95, 96, 99: return "Thunderstorms possible"
        default: return "Rain possible"
        }
    }

    var conditionExplanation: String? {
        guard hasConflictingPrecipitationGuidance,
              let chance = acceptedPoint?.rainProbability else { return nil }
        return "The current weather model suggests precipitation, but matching forecast guidance gives a \(Int(chance.rounded()))% chance. These signals disagree; precipitation has not been confirmed at this location."
    }

    private static func isPrecipitationCode(_ code: Int?) -> Bool {
        code.map { (51...86).contains($0) || [95, 96, 99].contains($0) } ?? false
    }

    var liquidRainRateMMPerHour: Double? {
        guard !hasConflictingPrecipitationGuidance, let point = freshModeledPoint,
              let code = point.weatherCode,
              [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].contains(code) else { return nil }
        // Freezing precipitation and snow use separate treatment. Raw codes,
        // probability, and thunderPossible cannot promote a dry normalized sky.
        return precipitationRate(for: point, minimum: 0.2)
    }

    /// Liquid-equivalent precipitation, not snowfall depth or a snow-to-water
    /// ratio. Cold temperature alone never establishes that snow is falling.
    var snowWaterEquivalentRateMMPerHour: Double? {
        guard !hasConflictingPrecipitationGuidance, let point = freshModeledPoint, let code = point.weatherCode,
              [71, 73, 75, 77, 85, 86].contains(code) else { return nil }
        return precipitationRate(for: point, minimum: 0.05)
    }

    /// A qualified current thunderstorm may shape the cloud atmosphere even
    /// when no credible rain accumulation is available. It does not establish
    /// storm severity, a lightning observation, or falling rain by itself.
    var hasCurrentThunderstorm: Bool {
        guard !hasConflictingPrecipitationGuidance,
              let code = freshModeledPoint?.weatherCode else { return false }
        return [95, 96, 99].contains(code)
    }

    private var freshModeledPoint: NativeForecastPoint? {
        guard let point = acceptedPoint, point.origin == .modeledCurrent,
              // A saved headline can remain useful after active weather has
              // stopped being a timely depiction of conditions now.
              evaluatedAt.timeIntervalSince(point.date) < 30 * 60 else { return nil }
        return point
    }

    private func precipitationRate(for point: NativeForecastPoint, minimum: Double) -> Double? {
        guard let interval = point.precipitationIntervalSeconds,
              interval.isFinite, (60...3600).contains(interval),
              let amount = point.precipitationMM, amount.isFinite, amount >= 0 else { return nil }
        let rate = amount * 3600 / interval
        return rate.isFinite && rate >= minimum ? rate : nil
    }
}

enum NativeForecastError: Error, LocalizedError {
    case invalidCoordinates, invalidPayload, mismatchedPlace, mismatchedUnits, invalidProvenance, invalidTimezone, emptyForecast, staleForecast
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidCoordinates: return "This place does not have valid coordinates."
        case .mismatchedPlace: return "The weather response was for a different place."
        case .mismatchedUnits: return "The weather response used unexpected units."
        case .invalidProvenance: return "The weather response could not be verified."
        case .invalidTimezone: return "The weather's local time zone was unavailable."
        case .emptyForecast: return "No forecast readings were available."
        case .staleForecast: return "The weather response is too old to show."
        case .httpStatus: return "The weather service is temporarily unavailable."
        case .invalidPayload: return "The weather response could not be read."
        }
    }
}

enum NativeWeatherCondition {
    static func isThunder(_ code: Int?) -> Bool { code.map { [95, 96, 99].contains($0) } ?? false }

    static func label(_ code: Int?) -> String {
        switch code {
        case 0: return "Clear"
        case 1: return "Mostly clear"
        case 2: return "Partly cloudy"
        case 3: return "Cloudy"
        case 45, 48: return "Fog"
        case 51: return "Light drizzle"
        case 53, 55: return "Drizzle"
        case 56, 57: return "Freezing drizzle"
        case 61: return "Light rain"
        case 63: return "Rain"
        case 65: return "Heavy rain"
        case 66, 67: return "Freezing rain"
        case 71: return "Light snow"
        case 73: return "Snow"
        case 75: return "Heavy snow"
        case 77: return "Snow grains"
        case 80, 81: return "Rain showers"
        case 82: return "Heavy showers"
        case 85, 86: return "Snow showers"
        case 95: return "Thunderstorms"
        case 96, 99: return "Thunderstorms with hail"
        default: return "Conditions unavailable"
        }
    }

    static func symbol(_ code: Int?, isDay: Bool?) -> String {
        switch code {
        case 0, 1: return isDay == false ? "moon.stars.fill" : "sun.max.fill"
        case 2: return isDay == false ? "cloud.moon.fill" : "cloud.sun.fill"
        case 3: return "cloud.fill"
        case 45, 48: return "cloud.fog.fill"
        case 51, 53, 55: return "cloud.drizzle.fill"
        case 56, 57, 66, 67: return "cloud.sleet.fill"
        case 61, 63, 80, 81: return "cloud.rain.fill"
        case 65, 82: return "cloud.heavyrain.fill"
        case 71, 73, 75, 77, 85, 86: return "cloud.snow.fill"
        case 95, 96, 99: return "cloud.bolt.rain.fill"
        default: return "questionmark"
        }
    }
}

private enum NativeForecastDecoder {
    typealias Object = [String: Any]

    static func number(_ raw: Any?) -> Double? {
        guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID() else { return nil }
        let number = value.doubleValue
        return number.isFinite ? number : nil
    }

    static func nonnegative(_ raw: Any?) -> Double? { number(raw).flatMap { $0 >= 0 ? $0 : nil } }
    static func probability(_ raw: Any?) -> Double? { number(raw).flatMap { (0...100).contains($0) ? $0 : nil } }
    static func code(_ raw: Any?) -> Int? {
        guard let value = number(raw), value.rounded() == value, (0...99).contains(value) else { return nil }
        let code = Int(value)
        return [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].contains(code) ? code : nil
    }

    static func decode(data: Data, latitude: Double, longitude: Double, metric: Bool, now: Date) throws -> NativeWeatherForecast {
        guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 else {
            throw NativeForecastError.invalidCoordinates
        }
        guard data.count <= 4_000_000,
              let payload = try JSONSerialization.jsonObject(with: data) as? Object else { throw NativeForecastError.invalidPayload }
        guard let metadata = payload["_nearcastForecast"] as? Object,
              number(metadata["version"]) == 1,
              let generatedMS = number(metadata["generatedAtMs"]), generatedMS > 0,
              generatedMS / 1000 <= now.timeIntervalSince1970 + 60 else { throw NativeForecastError.invalidProvenance }
        guard let responseLatitude = number(metadata["latitude"]),
              let responseLongitude = number(metadata["longitude"]),
              abs(latitude - responseLatitude) <= 0.0011,
              abs(longitude - responseLongitude) <= 0.0011 else { throw NativeForecastError.mismatchedPlace }
        guard metadata["unit"] as? String == (metric ? "celsius" : "fahrenheit"),
              metadata["precipitationUnit"] as? String == "mm" else { throw NativeForecastError.mismatchedUnits }
        guard let timezoneID = payload["timezone"] as? String,
              let timeZone = TimeZone(identifier: timezoneID) else { throw NativeForecastError.invalidTimezone }
        let generatedAt = Date(timeIntervalSince1970: generatedMS / 1000)
        let clock = ForecastClock(timeZone: timeZone)

        for section in ["current", "hourly", "minutely_15", "daily"] {
            if let values = payload[section] as? Object, !values.isEmpty {
                try validateUnits(values: values, units: payload[section + "_units"] as? Object, metric: metric)
            }
        }

        let possibleThunder: (Date, TimeInterval) -> Bool = { date, interval in
            guard let nws = metadata["nws"] as? Object,
                  let checkedMS = number(nws["checkedAt"]), checkedMS > 0,
                  checkedMS / 1000 <= now.timeIntervalSince1970 + 60,
                  now.timeIntervalSince1970 - checkedMS / 1000 <= 7200 else { return false }
            return (nws["periods"] as? [Object] ?? []).contains { period in
                guard let start = number(period["startMs"]), let end = number(period["endMs"]), end > start,
                      start / 1000 < date.timeIntervalSince1970 + interval,
                      end / 1000 > date.timeIntervalSince1970,
                      let text = (period["shortForecast"] as? String)?.lowercased(),
                      text.contains("thunder"), !text.contains("no thunder") else { return false }
                return period["probability"] == nil || period["probability"] is NSNull || (probability(period["probability"]) ?? 0) > 0
            }
        }

        var semanticHours: [Date: NearcastForecastSemanticHour] = [:]
        func point(_ values: Object, units: Object?, date: Date, interval: TimeInterval, isCurrent: Bool = false,
                   localTime: String? = nil, origin: NativeForecastPoint.Origin? = nil,
                   precipitationIntervalSeconds: Double? = nil,
                   matchingCurrentChance: Double? = nil) -> NativeForecastPoint {
            // Optional enrichment with absent/unrecognized units is ignored,
            // not a reason to fail otherwise useful temperature/forecast data.
            func radiation(_ key: String) -> Double? {
                guard units?[key] as? String == "W/m²" else { return nil }
                return number(values[key]).flatMap { (0...2000).contains($0) ? $0 : nil }
            }
            func cloudLayer(_ key: String) -> Double? {
                guard units?[key] as? String == "%" else { return nil }
                return probability(values[key])
            }
            let rawCode = code(values["weather_code"])
            let amount = nonnegative(values["precipitation"])
            let chance = probability(values["precipitation_probability"]) ?? matchingCurrentChance
            let cloud = probability(values["cloud_cover"])
            let isDay = number(values["is_day"]).flatMap { $0 == 1 ? true : $0 == 0 ? false : nil }
            var resolvedCode = rawCode
            // Reuse the same interpretation as widgets/Watch. Missing values
            // do not become zero rain/chance inputs to the semantic policy.
            if isCurrent, let amount, rawCode != nil || cloud != nil {
                resolvedCode = NearcastForecastSemantics.currentConditionCode(rawCode: rawCode,
                    precipitationAmount: amount, intervalSeconds: interval, cloudCover: cloud)
            } else if let chance, let amount, rawCode != nil || cloud != nil {
                let semantic = NearcastForecastSemanticHour(time: localTime ?? "", rawCode: rawCode,
                    precipitationChance: chance, precipitationAmount: amount * 3600 / interval,
                    cloudCover: cloud, isDay: isDay)
                resolvedCode = NearcastForecastSemantics.hourlyConditionCode(for: semantic)
                if interval == 3600 { semanticHours[date] = semantic }
            }
            return NativeForecastPoint(date: date, temperature: number(values["temperature_2m"]),
                apparentTemperature: number(values["apparent_temperature"]),
                rainProbability: chance, precipitationMM: amount,
                windSpeed: nonnegative(values["wind_speed_10m"]), windGusts: nonnegative(values["wind_gusts_10m"]),
                uvIndex: nonnegative(values["uv_index"]), weatherCode: resolvedCode,
                isDay: isDay, thunderPossible: possibleThunder(date, interval)
                    || (NativeWeatherCondition.isThunder(rawCode) && !NativeWeatherCondition.isThunder(resolvedCode) && (chance ?? 0) > 0),
                rawWeatherCode: rawCode, relativeHumidity: probability(values["relative_humidity_2m"]),
                dewPoint: number(values["dew_point_2m"]), visibilityMeters: nonnegative(values["visibility"]),
                windDirection: number(values["wind_direction_10m"]).flatMap { (0...360).contains($0) ? $0 : nil },
                cloudCover: cloud, lowCloudCover: cloudLayer("cloud_cover_low"),
                midCloudCover: cloudLayer("cloud_cover_mid"), highCloudCover: cloudLayer("cloud_cover_high"),
                shortwaveRadiation: radiation("shortwave_radiation"), directRadiation: radiation("direct_radiation"),
                diffuseRadiation: radiation("diffuse_radiation"), origin: origin,
                precipitationIntervalSeconds: precipitationIntervalSeconds)
        }

        func points(_ section: String, interval: TimeInterval, limit: Int) -> [NativeForecastPoint] {
            guard let series = payload[section] as? Object, let times = series["time"] as? [Any] else { return [] }
            var seen = Set<Date>()
            var previous: Date?
            return times.prefix(limit).enumerated().compactMap { index, raw in
                guard let date = clock.date(raw as? String, after: previous,
                    latestAt: section == "minutely_15" && previous == nil ? now : nil), seen.insert(date).inserted else { return nil }
                previous = date
                var row: Object = [:]
                for (key, value) in series where key != "time" {
                    if let array = value as? [Any], index < array.count { row[key] = array[index] }
                }
                let reading = point(row, units: payload[section + "_units"] as? Object, date: date, interval: interval,
                    localTime: raw as? String, origin: section == "minutely_15" ? .quarterHourForecast : .hourlyForecast,
                    precipitationIntervalSeconds: interval)
                return reading.hasReadings ? reading : nil
            }.sorted { $0.date < $1.date }
        }

        let hours = points("hourly", interval: 3600, limit: 400)
        // Only provider-supplied quarter-hours: no interpolation from hourly.
        // Retain the containing interval and at most the next six hours.
        let allQuarterHours = points("minutely_15", interval: 900, limit: 100)
        let quarterHours = allQuarterHours.filter {
            $0.date.addingTimeInterval(900) > now && $0.date < now.addingTimeInterval(6 * 3600)
        }
        var current: NativeForecastPoint?
        if let rawCurrent = payload["current"] as? Object,
           let date = clock.date(rawCurrent["time"] as? String, latestAt: now), date <= now,
           date >= generatedAt.addingTimeInterval(-75 * 60), date <= generatedAt.addingTimeInterval(60) {
            let interval = nonnegative(rawCurrent["interval"]) ?? 900
            let origin = (rawCurrent["basis"] as? String).flatMap(NativeForecastPoint.Origin.init(rawValue:))
            // Match the model reading's actual timestamp, never the next wet
            // interval or the time this response happened to be decoded.
            let matchingChance = allQuarterHours.last {
                $0.date <= date && $0.date.addingTimeInterval(900) > date
            }?.rainProbability ?? hours.last {
                $0.date <= date && $0.date.addingTimeInterval(3600) > date
            }?.rainProbability
            let reading = point(rawCurrent, units: payload["current_units"] as? Object, date: date,
                interval: min(3600, max(60, interval)), isCurrent: true, origin: origin,
                precipitationIntervalSeconds: number(rawCurrent["interval"]),
                matchingCurrentChance: origin == .modeledCurrent ? matchingChance : nil)
            current = reading.hasReadings ? reading : nil
        }
        if current == nil {
            // Midnight (row zero) and a future row are never substitutes for Now.
            current = hours.last { $0.date <= generatedAt && $0.date <= now && $0.date.addingTimeInterval(3600) > generatedAt }
        }

        var days: [NativeForecastDay] = []
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        if let daily = payload["daily"] as? Object, let times = daily["time"] as? [Any] {
            func value(_ key: String, _ index: Int) -> Any? {
                guard let array = daily[key] as? [Any], index < array.count else { return nil }
                return array[index]
            }
            var seen = Set<Date>()
            days = times.prefix(16).enumerated().compactMap { index, raw in
                guard let date = clock.date(raw as? String), seen.insert(date).inserted else { return nil }
                let rawCode = code(value("weather_code", index))
                let remainingHours = hours.filter { hour in
                    calendar.isDate(hour.date, inSameDayAs: date)
                        && (!calendar.isDate(date, inSameDayAs: now) || hour.date.addingTimeInterval(3600) > now)
                }
                let inputs = remainingHours.compactMap { semanticHours[$0.date] }
                // Do not derive a whole-day headline from a tiny subset of
                // complete readings when other hours have missing evidence.
                let dailyCode = !inputs.isEmpty && inputs.count == remainingHours.count
                    ? NearcastForecastSemantics.dailyConditionCode(hours: inputs, fallbackCode: rawCode) : rawCode
                let reading = NativeForecastDay(date: date, high: number(value("temperature_2m_max", index)),
                    low: number(value("temperature_2m_min", index)), rainProbability: probability(value("precipitation_probability_max", index)),
                    precipitationMM: nonnegative(value("precipitation_sum", index)), uvIndex: nonnegative(value("uv_index_max", index)),
                    weatherCode: dailyCode, sunrise: clock.date(value("sunrise", index) as? String),
                    sunset: clock.date(value("sunset", index) as? String),
                    thunderPossible: remainingHours.contains { $0.thunderPossible })
                return reading.high != nil || reading.low != nil || reading.rainProbability != nil
                    || reading.precipitationMM != nil || reading.uvIndex != nil || reading.weatherCode != nil
                    || reading.sunrise != nil || reading.sunset != nil ? reading : nil
            }.sorted { $0.date < $1.date }
        }
        guard current != nil || !hours.isEmpty || !days.isEmpty else { throw NativeForecastError.emptyForecast }
        return NativeWeatherForecast(generatedAt: generatedAt, timezoneID: timezoneID, metric: metric,
            current: current, hours: hours, quarterHours: quarterHours, days: days)
    }

    private static func validateUnits(values: Object, units: Object?, metric: Bool) throws {
        let expectedTemperature = metric ? "°C" : "°F"
        for key in ["temperature_2m", "apparent_temperature", "temperature_2m_min", "temperature_2m_max", "dew_point_2m"] where values[key] != nil {
            guard units?[key] as? String == expectedTemperature else { throw NativeForecastError.mismatchedUnits }
        }
        for key in ["wind_speed_10m", "wind_gusts_10m"] where values[key] != nil {
            let unit = units?[key] as? String
            guard metric ? ["km/h", "kmh"].contains(unit ?? "") : unit == "mp/h" || unit == "mph" else {
                throw NativeForecastError.mismatchedUnits
            }
        }
        for key in ["precipitation", "precipitation_sum"] where values[key] != nil {
            guard units?[key] as? String == "mm" else { throw NativeForecastError.mismatchedUnits }
        }
        for key in ["precipitation_probability", "precipitation_probability_max", "relative_humidity_2m"] where values[key] != nil {
            guard units?[key] as? String == "%" else { throw NativeForecastError.mismatchedUnits }
        }
        if values["visibility"] != nil, units?["visibility"] as? String != "m" { throw NativeForecastError.mismatchedUnits }
        if values["wind_direction_10m"] != nil, units?["wind_direction_10m"] as? String != "°" { throw NativeForecastError.mismatchedUnits }
    }

    private struct ForecastClock {
        let timeZone: TimeZone

        func date(_ raw: String?, after previous: Date? = nil, latestAt reference: Date? = nil) -> Date? {
            guard let raw, !raw.isEmpty else { return nil }
            let iso = ISO8601DateFormatter()
            if let date = iso.date(from: raw) { return date }
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso.date(from: raw) { return date }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = timeZone
            formatter.isLenient = false
            for pattern in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd"] {
                formatter.dateFormat = pattern
                if let date = formatter.date(from: raw) {
                    guard pattern != "yyyy-MM-dd" else { return date }
                    var calendar = Calendar(identifier: .gregorian)
                    calendar.timeZone = timeZone
                    let components = calendar.dateComponents([.hour, .minute, .second], from: date)
                    let day = calendar.startOfDay(for: date)
                    guard let hour = components.hour, let minute = components.minute, let second = components.second,
                          let first = calendar.date(bySettingHour: hour, minute: minute, second: second, of: day,
                            matchingPolicy: .strict, repeatedTimePolicy: .first),
                          let last = calendar.date(bySettingHour: hour, minute: minute, second: second, of: day,
                            matchingPolicy: .strict, repeatedTimePolicy: .last) else { return date }
                    // During fall-back the provider can include both wall-clock
                    // 01:00 rows. Preserve their distinct instants in order.
                    if let previous, first <= previous, last > previous { return last }
                    // Current follows the latest occurrence that has happened;
                    // the first occurrence must not point into the future.
                    if let reference, last <= reference { return last }
                    return first
                }
            }
            return nil
        }
    }
}
