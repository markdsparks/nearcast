import Foundation

enum NativeWeatherDetailKind: String, Identifiable, CaseIterable {
    case overview, air, sun, wind, uv, humidity, visibility, precipitation, alerts
    var id: String { rawValue }
    var title: String {
        switch self {
        case .overview: return "Weather details"
        case .air: return "Air quality"
        case .sun: return "Sun & daylight"
        case .wind: return "Wind & gusts"
        case .uv: return "UV index"
        case .humidity: return "Humidity & dew point"
        case .visibility: return "Visibility"
        case .precipitation: return "Precipitation"
        case .alerts: return "Official alerts"
        }
    }
    var symbol: String {
        switch self {
        case .overview: return "list.bullet"
        case .air: return "aqi.medium"
        case .sun: return "sun.horizon"
        case .wind: return "wind"
        case .uv: return "sun.max"
        case .humidity: return "humidity"
        case .visibility: return "eye"
        case .precipitation: return "drop"
        case .alerts: return "exclamationmark.triangle"
        }
    }
    var keyPath: KeyPath<NativeForecastPoint, Double?>? {
        switch self {
        case .wind: return \.windSpeed
        case .uv: return \.uvIndex
        case .humidity: return \.relativeHumidity
        case .visibility: return \.visibilityMeters
        case .precipitation: return \.rainProbability
        default: return nil
        }
    }
}

/// Presentation of the existing canonical forecast; no new weather inference.
/// In particular a future-day headline never takes today's current reading.
struct NativeWeatherDetailPresentation {
    let forecast: NativeWeatherForecast
    let day: Date
    let now: Date
    let uses24HourClock: Bool

    struct Fact: Identifiable {
        let label: String
        let value: String
        var id: String { label }
    }
    var isToday: Bool { forecast.calendar.isDate(day, inSameDayAs: now) }
    var dayReading: NativeForecastDay? { forecast.day(containing: day) }
    var hours: [NativeForecastPoint] { forecast.hours(on: day) }
    var upcomingHours: [NativeForecastPoint] {
        isToday ? hours.filter { $0.date.addingTimeInterval(3600) > now } : hours
    }
    var dayLabel: String {
        if isToday { return "Today" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = "EEE, MMM d"
        return formatter.string(from: day)
    }
    func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = uses24HourClock ? "HH:mm" : "h:mm a"
        return formatter.string(from: date)
    }
    func timestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = "MMM d"
        let prefix = forecast.calendar.isDate(date, inSameDayAs: now) ? "" : formatter.string(from: date) + " · "
        return prefix + clock(date) + " local"
    }
    func current(_ path: KeyPath<NativeForecastPoint, Double?>) -> Double? {
        guard isToday else { return nil }
        if let current = forecast.current, current.date <= now,
           now.timeIntervalSince(current.date) <= 30 * 60,
           let value = current[keyPath: path], value.isFinite { return value }
        return hours.last { $0.date <= now && $0.date.addingTimeInterval(3600) > now }?[keyPath: path]
    }
    func peak(_ path: KeyPath<NativeForecastPoint, Double?>, remaining: Bool = false) -> NativeForecastPoint? {
        (remaining ? upcomingHours : hours).filter { $0[keyPath: path] != nil }
            .max { $0[keyPath: path]! < $1[keyPath: path]! }
    }
    func lowest(_ path: KeyPath<NativeForecastPoint, Double?>) -> NativeForecastPoint? {
        upcomingHours.filter { $0[keyPath: path] != nil }.min { $0[keyPath: path]! < $1[keyPath: path]! }
    }
    func formatted(_ value: Double?, kind: NativeWeatherDetailKind) -> String {
        guard let value, value.isFinite else { return "Unavailable" }
        switch kind {
        case .wind: return "\(Int(value.rounded())) \(forecast.metric ? "km/h" : "mph")"
        case .humidity, .precipitation: return "\(Int(value.rounded()))%"
        case .uv: return String(format: "%.1f", value)
        case .visibility:
            let distance = value / (forecast.metric ? 1000 : 1609.344)
            let unit = forecast.metric ? "km" : "mi"
            if distance > 0 && distance < 0.1 { return "<0.1 \(unit)" }
            return String(format: distance < 10 ? "%.1f %@" : "%.0f %@", distance, unit)
        default: return "\(Int(value.rounded()))"
        }
    }
    func temperature(_ value: Double?) -> String {
        value.map { "\(Int($0.rounded()))°\(forecast.metric ? "C" : "F")" } ?? "Unavailable"
    }
    func amount(_ value: Double?) -> String {
        value.map { forecast.metric ? String(format: "%.1f mm", $0) : String(format: "%.2f in", $0 / 25.4) } ?? "Unavailable"
    }
    func headline(_ kind: NativeWeatherDetailKind) -> String {
        if kind == .precipitation { return formatted(dayReading?.rainProbability, kind: kind) }
        guard let path = kind.keyPath else { return "" }
        if isToday { return formatted(current(path), kind: kind) }
        if kind == .uv { return formatted(dayReading?.uvIndex ?? peak(path)?[keyPath: path], kind: kind) }
        if kind == .visibility { return formatted(lowest(path)?[keyPath: path], kind: kind) }
        if kind == .humidity {
            let values = hours.compactMap { $0.relativeHumidity }
            guard let low = values.min(), let high = values.max() else { return "Unavailable" }
            return low.rounded() == high.rounded() ? formatted(low, kind: kind) : "\(Int(low.rounded()))–\(Int(high.rounded()))%"
        }
        return formatted(peak(path)?[keyPath: path], kind: kind)
    }
    func headlineLabel(_ kind: NativeWeatherDetailKind) -> String {
        if kind == .precipitation { return "\(dayLabel) · forecast chance" }
        if isToday { return "Current forecast estimate" }
        switch kind {
        case .humidity: return "\(dayLabel) · hourly range"
        case .visibility: return "\(dayLabel) · lowest forecast"
        default: return "\(dayLabel) · forecast peak"
        }
    }
    func facts(_ kind: NativeWeatherDetailKind) -> [Fact] {
        switch kind {
        case .wind:
            let gust = peak(\.windGusts, remaining: true)
            return [Fact(label: isToday ? "Current gusts" : "Peak sustained wind", value: isToday ? formatted(current(\.windGusts), kind: .wind) : headline(.wind)),
                    Fact(label: isToday ? "Strongest gusts ahead" : "Peak gusts", value: timed(gust, path: \.windGusts, kind: .wind)),
                    Fact(label: isToday ? "Wind from" : "Direction at peak wind", value: direction(isToday ? current(\.windDirection) : peak(\.windSpeed)?.windDirection))]
        case .uv:
            return [Fact(label: "Daily forecast maximum", value: formatted(dayReading?.uvIndex ?? peak(\.uvIndex)?.uvIndex, kind: .uv)),
                    Fact(label: isToday ? "Highest UV ahead" : "Highest hourly UV", value: timed(peak(\.uvIndex, remaining: true), path: \.uvIndex, kind: .uv))]
        case .humidity:
            let dew = hours.compactMap { $0.dewPoint }
            let dewText = isToday ? temperature(current(\.dewPoint)) : (dew.min().flatMap { low in dew.max().map { high in "\(temperature(low)) – \(temperature(high))" } } ?? "Unavailable")
            return [Fact(label: isToday ? "Dew point" : "Dew point range", value: dewText),
                    Fact(label: isToday ? "Air temperature" : "High / low", value: isToday ? temperature(current(\.temperature)) : "\(temperature(dayReading?.high)) / \(temperature(dayReading?.low))")]
        case .visibility:
            return [Fact(label: isToday ? "Lowest ahead today" : "Lowest hourly estimate", value: timed(lowest(\.visibilityMeters), path: \.visibilityMeters, kind: .visibility))]
        case .precipitation:
            return [Fact(label: "Daily total forecast", value: amount(dayReading?.precipitationMM)),
                    Fact(label: isToday ? "Highest hourly chance ahead" : "Highest hourly chance", value: timed(peak(\.rainProbability, remaining: true), path: \.rainProbability, kind: .precipitation))]
        default: return []
        }
    }
    func explanation(_ kind: NativeWeatherDetailKind) -> String {
        switch kind {
        case .wind: return "Sustained wind describes the general flow; gusts are short bursts. Wind direction names where the wind comes from. Hourly peaks reflect the available forecast hours, not a guarantee of conditions at every spot."
        case .uv: return "UV is a forecast estimate, not a reading from your phone. Clouds can reduce UV, but do not block it completely. Changing cloud cover makes the exact level less certain; cloudy does not mean no UV."
        case .humidity: return "Relative humidity changes as the air warms or cools. Dew point helps compare moisture across different temperatures: a higher dew point means more moisture."
        case .visibility: return "This is a forecast estimate, not a road-level observation. Fog, precipitation and airborne particles can reduce visibility; conditions along a route can differ."
        case .precipitation: return "Chance and amount answer different questions: how likely precipitation is, and how much is forecast. A daily total is not the amount expected in every hour. This view is forecast guidance, not live radar."
        default: return ""
        }
    }
    private func timed(_ point: NativeForecastPoint?, path: KeyPath<NativeForecastPoint, Double?>, kind: NativeWeatherDetailKind) -> String {
        guard let point, let value = point[keyPath: path] else { return "Unavailable" }
        return "\(formatted(value, kind: kind)) · \(clock(point.date))"
    }
    private func direction(_ degrees: Double?) -> String {
        guard let degrees, let compass = NativeWindDirection.compassPoint(degrees) else { return "Unavailable" }
        return "\(compass) · \(Int(degrees.rounded()))°"
    }
}
