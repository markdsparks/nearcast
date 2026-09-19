import Foundation
import CoreFoundation

/// Full app weather, separate from the intentionally compact widget snapshot.
/// Temperatures and wind use the requested system; precipitation is always mm.
struct NativeForecastPoint: Codable, Sendable, Identifiable {
    var id: Date { date }
    let date: Date
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

    init(date: Date, temperature: Double? = nil, apparentTemperature: Double? = nil,
         rainProbability: Double? = nil, precipitationMM: Double? = nil,
         windSpeed: Double? = nil, windGusts: Double? = nil, uvIndex: Double? = nil,
         weatherCode: Int? = nil, isDay: Bool? = nil, thunderPossible: Bool = false, rawWeatherCode: Int? = nil,
         relativeHumidity: Double? = nil, dewPoint: Double? = nil, visibilityMeters: Double? = nil, windDirection: Double? = nil,
         cloudCover: Double? = nil) {
        self.date = date
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

    // Presentation windows retain actual service timestamps, including local
    // midnight and the 25th hour of a fall-back day. No samples are synthesized.
    func previewTrendHours(on day: Date, now: Date) -> [NativeForecastPoint] {
        guard calendar.isDate(day, inSameDayAs: now) else { return hours(on: day) }
        let start = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        return Array(hours.filter { $0.date >= start }.prefix(24))
    }

    func previewQuarterHours(on day: Date, now: Date) -> [NativeForecastPoint] {
        let today = calendar.isDate(day, inSameDayAs: now)
        return quarterHours.filter {
            (today || calendar.isDate($0.date, inSameDayAs: day)) && $0.date.addingTimeInterval(900) > now
        }
    }

    func startsPreviewDaySection(_ date: Date, after previous: Date?, selectedDay: Date) -> Bool {
        !calendar.isDate(date, inSameDayAs: previous ?? selectedDay)
    }

    static func decode(data: Data, latitude: Double, longitude: Double, metric: Bool, now: Date) throws -> Self {
        try NativeForecastDecoder.decode(data: data, latitude: latitude, longitude: longitude, metric: metric, now: now)
    }
}

enum NativeForecastError: Error, LocalizedError {
    case invalidCoordinates, invalidPayload, mismatchedPlace, mismatchedUnits, invalidProvenance, invalidTimezone, emptyForecast
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidCoordinates: return "This place does not have valid coordinates."
        case .mismatchedPlace: return "The weather response was for a different place."
        case .mismatchedUnits: return "The weather response used unexpected units."
        case .invalidProvenance: return "The weather response could not be verified."
        case .invalidTimezone: return "The weather's local time zone was unavailable."
        case .emptyForecast: return "No forecast readings were available."
        case .httpStatus: return "The weather service is temporarily unavailable."
        case .invalidPayload: return "The weather response could not be read."
        }
    }
}

private enum NativeWeatherCondition {
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
        func point(_ values: Object, date: Date, interval: TimeInterval, isCurrent: Bool = false, localTime: String? = nil) -> NativeForecastPoint {
            let rawCode = code(values["weather_code"])
            let amount = nonnegative(values["precipitation"])
            let chance = probability(values["precipitation_probability"])
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
                cloudCover: cloud)
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
                let reading = point(row, date: date, interval: interval, localTime: raw as? String)
                return reading.hasReadings ? reading : nil
            }.sorted { $0.date < $1.date }
        }

        let hours = points("hourly", interval: 3600, limit: 400)
        // Only provider-supplied quarter-hours: no interpolation from hourly.
        // Retain the containing interval and at most the next six hours.
        let quarterHours = points("minutely_15", interval: 900, limit: 100).filter {
            $0.date.addingTimeInterval(900) > now && $0.date < now.addingTimeInterval(6 * 3600)
        }
        var current: NativeForecastPoint?
        if let rawCurrent = payload["current"] as? Object,
           let date = clock.date(rawCurrent["time"] as? String, latestAt: now), date <= now,
           date >= generatedAt.addingTimeInterval(-75 * 60), date <= generatedAt.addingTimeInterval(60) {
            let interval = nonnegative(rawCurrent["interval"]) ?? 900
            let reading = point(rawCurrent, date: date, interval: min(3600, max(60, interval)), isCurrent: true)
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
