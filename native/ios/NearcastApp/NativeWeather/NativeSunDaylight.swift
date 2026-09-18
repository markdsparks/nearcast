import Foundation

/// A presentation model, not an astronomical elevation calculation. It uses the
/// forecast's actual sunrise/sunset and civil-day boundaries, including DST.
struct NativeSunDaylight: Sendable {
    enum Mode: Equatable, Sendable {
        case normal, continuousDaylight, continuousNight, unavailable
    }

    let interval: DateInterval
    let timeZone: TimeZone
    let mode: Mode
    let sunrise: Date?
    let sunset: Date?
    let nextSunrise: Date?
    private let hours: [NativeForecastPoint]

    init(forecast: NativeWeatherForecast, day: Date) {
        let calendar = forecast.calendar
        // Gregorian civil-day intervals are defined for forecast dates. Do not
        // use a fixed 24-hour interval: clock changes have 23 or 25 actual hours.
        let dayInterval = calendar.dateInterval(of: .day, for: day)!
        interval = dayInterval
        timeZone = forecast.timeZone
        hours = forecast.hours(on: day).sorted { $0.date < $1.date }
        let daily = forecast.day(containing: day)
        sunrise = daily?.sunrise.flatMap { dayInterval.contains($0) && $0 < dayInterval.end ? $0 : nil }
        sunset = daily?.sunset.flatMap { dayInterval.contains($0) && $0 < dayInterval.end ? $0 : nil }
        nextSunrise = forecast.day(containing: dayInterval.end)?.sunrise.flatMap {
            guard let nextDay = calendar.dateInterval(of: .day, for: dayInterval.end),
                  $0 >= nextDay.start, $0 < nextDay.end else { return nil }
            return $0
        }

        if let sunrise, let sunset, sunset > sunrise {
            mode = .normal
        } else if daily?.sunrise == nil, daily?.sunset == nil,
                  Self.coversEntireDay(hours, interval: interval) {
            // A missing sunrise alone does not imply polar night. Only a full
            // day of explicit, consistent isDay samples supports an all-day label.
            if hours.allSatisfy({ $0.isDay == true }) { mode = .continuousDaylight }
            else if hours.allSatisfy({ $0.isDay == false }) { mode = .continuousNight }
            else { mode = .unavailable }
        } else {
            mode = .unavailable
        }
    }

    var daylightDuration: TimeInterval? {
        switch mode {
        case .normal: return sunset!.timeIntervalSince(sunrise!)
        case .continuousDaylight: return interval.duration
        case .continuousNight: return 0
        case .unavailable: return nil
        }
    }

    func defaultDate(now: Date) -> Date {
        if now >= interval.start, now < interval.end { return now }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: interval.start) ?? interval.start
    }

    func progress(at date: Date) -> Double {
        min(1, max(0, date.timeIntervalSince(interval.start) / interval.duration))
    }

    func date(at progress: Double) -> Date {
        // End of a chart means the last moment of this day, not tomorrow's date.
        interval.start.addingTimeInterval(min(interval.duration - 1, max(0, progress) * interval.duration))
    }

    /// Relative visual height above (+) or below (-) the horizon. This is a
    /// schematic daylight timeline, not solar altitude or a visibility forecast.
    func height(at date: Date) -> Double? {
        let date = min(max(date, interval.start), interval.end)
        switch mode {
        case .normal:
            let rise = sunrise!, set = sunset!
            if date < rise {
                let duration = rise.timeIntervalSince(interval.start)
                return -0.48 * sin((1 - date.timeIntervalSince(interval.start) / max(1, duration)) * .pi / 2)
            }
            if date <= set {
                return sin(date.timeIntervalSince(rise) / set.timeIntervalSince(rise) * .pi)
            }
            let duration = interval.end.timeIntervalSince(set)
            return -0.48 * sin(date.timeIntervalSince(set) / max(1, duration) * .pi / 2)
        case .continuousDaylight:
            return 0.3 + 0.5 * sin(progress(at: date) * .pi)
        case .continuousNight:
            return -0.3 - 0.15 * sin(progress(at: date) * .pi)
        case .unavailable:
            return nil
        }
    }

    func isDaylight(at date: Date) -> Bool? {
        switch mode {
        case .normal: return date >= sunrise! && date < sunset!
        case .continuousDaylight: return true
        case .continuousNight: return false
        case .unavailable: return nil
        }
    }

    /// Keep forecast UV honest: no interpolation through a missing hour, and a
    /// missing sample is not a zero. Repeated DST hours retain their own samples.
    func uv(at date: Date) -> Double? {
        guard let point = hours.last(where: { $0.date <= date }),
              date.timeIntervalSince(point.date) < 3600,
              let value = point.uvIndex, value.isFinite, value >= 0 else { return nil }
        return value
    }

    func clock(_ date: Date, uses24HourClock: Bool, includeZone: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = (uses24HourClock ? "HH:mm" : "h:mm a") + (includeZone ? " zzz" : "")
        return formatter.string(from: date)
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let minutes = max(0, Int(ceil(seconds / 60)))
        if minutes < 60 { return "\(minutes)m" }
        let remainder = minutes % 60
        return remainder == 0 ? "\(minutes / 60)h" : "\(minutes / 60)h \(remainder)m"
    }

    private static func coversEntireDay(_ hours: [NativeForecastPoint], interval: DateInterval) -> Bool {
        guard let first = hours.first, let last = hours.last,
              abs(first.date.timeIntervalSince(interval.start)) < 1,
              abs(last.date.addingTimeInterval(3600).timeIntervalSince(interval.end)) < 1,
              hours.allSatisfy({ $0.isDay != nil }) else { return false }
        return zip(hours, hours.dropFirst()).allSatisfy {
            abs($1.date.timeIntervalSince($0.date) - 3600) < 1
        }
    }
}
