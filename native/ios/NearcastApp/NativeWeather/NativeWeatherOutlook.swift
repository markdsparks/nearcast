import Foundation

/// A short, deterministic weather read. Inputs are the already-resolved native
/// forecast; this layer neither recalibrates values nor interprets raw WMO codes.
struct NativeWeatherOutlook: Equatable, Sendable {
    let eyebrow: String
    let headline: String
    let detail: String?

    static func make(forecast: NativeWeatherForecast, day: Date, now: Date, uses24HourClock: Bool) -> Self {
        let context = Context(forecast: forecast, day: day, now: now, clock24: uses24HourClock)
        let trend = context.temperatureTrend
        let wind = context.windRead

        if let event = context.precipitationEvent {
            let headline = context.timed(event.label, at: event.point.date)
            let detail = context.easingDetail(for: event) ?? wind?.detail ?? trend?.detail
            return Self(eyebrow: context.eyebrow, headline: headline, detail: detail)
        }
        if let wind {
            return Self(eyebrow: context.eyebrow, headline: wind.headline, detail: wind.detail)
        }
        if let transition = context.conditionTransition {
            return Self(eyebrow: context.eyebrow, headline: transition, detail: trend?.detail)
        }
        let condition = context.representativeCondition
        if let trend {
            let headline = condition.map { "\($0) and \(trend.warming ? "warming" : "cooling")" }
                ?? (trend.warming ? "Turning warmer" : "Turning cooler")
            return Self(eyebrow: context.eyebrow, headline: headline, detail: trend.detail)
        }
        if let condition {
            // A plain condition is more useful than filler about a 0% chance or
            // a promise that an incomplete forecast will stay dry all day.
            return Self(eyebrow: context.eyebrow,
                headline: context.quietHours.count >= 3 && context.isToday ? "\(condition) \(context.period)" : condition,
                detail: nil)
        }
        return Self(eyebrow: context.eyebrow, headline: "Outlook unavailable",
            detail: "Hourly conditions aren’t available for this day.")
    }
}

private extension NativeWeatherOutlook {
    struct Event {
        enum Kind { case thunder, freezing, snow, rain }
        let point: NativeForecastPoint
        let kind: Kind
        let label: String
    }

    struct Trend {
        let warming: Bool
        let detail: String
    }

    struct WindRead {
        let headline: String
        let detail: String
    }

    struct Context {
        let forecast: NativeWeatherForecast
        let day: Date
        let now: Date
        let clock24: Bool
        var calendar: Calendar { forecast.calendar }
        var isToday: Bool { calendar.isDate(day, inSameDayAs: now) }
        var localHour: Int { calendar.component(.hour, from: now) }
        var night: Bool { isToday && (localHour < 5 || localHour >= 18) }
        var hourStart: Date { calendar.dateInterval(of: .hour, for: now)?.start ?? now }

        var period: String {
            if night { return "tonight" }
            if localHour < 12 { return "this morning" }
            if localHour < 18 { return "this afternoon" }
            return "today"
        }

        var eyebrow: String {
            guard isToday else { return "\(dateLabel(day).uppercased()) · OUTLOOK" }
            if hours.isEmpty { return "TODAY’S OUTLOOK" }
            if night { return "TONIGHT’S OUTLOOK" }
            return localHour < 12 ? "THIS MORNING" : "THIS AFTERNOON"
        }

        var hours: [NativeForecastPoint] {
            guard let interval = calendar.dateInterval(of: .day, for: day) else { return [] }
            var end = interval.end
            if night {
                let morning = localHour >= 18 ? interval.end : interval.start
                end = calendar.date(bySettingHour: 8, minute: 0, second: 0, of: morning) ?? end
            }
            let start = isToday ? hourStart : interval.start
            return forecast.hours.filter { $0.date >= start && $0.date < end && $0.hasReadings }
                .sorted { $0.date < $1.date }
        }

        var quietHours: [NativeForecastPoint] {
            guard isToday && !night else { return hours }
            let endHour = localHour < 12 ? 12 : 18
            guard let end = calendar.date(bySettingHour: endHour, minute: 0, second: 0, of: now) else { return hours }
            return hours.filter { $0.date < end }
        }

        func clock(_ date: Date) -> String {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.timeZone = forecast.timeZone
            formatter.dateFormat = clock24 ? "HH:mm" : (calendar.component(.minute, from: date) == 0 ? "h a" : "h:mm a")
            return formatter.string(from: date)
        }

        func dateLabel(_ date: Date) -> String {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.timeZone = forecast.timeZone
            formatter.dateFormat = "EEE, MMM d"
            return formatter.string(from: date)
        }

        func timeLabel(_ date: Date) -> String {
            let nextDay = isToday && !calendar.isDate(date, inSameDayAs: now)
            return "\(clock(date))\(nextDay ? " tomorrow" : "")"
        }

        func timed(_ label: String, at date: Date) -> String {
            if isToday && date < hourStart.addingTimeInterval(3600) { return "\(label) this hour" }
            return "\(label) around \(timeLabel(date))"
        }

        func finite(_ value: Double?) -> Double? { value.flatMap { $0.isFinite ? $0 : nil } }
        func chance(_ point: NativeForecastPoint) -> Double? {
            finite(point.rainProbability).flatMap { (0...100).contains($0) ? $0 : nil }
        }

        func event(_ point: NativeForecastPoint) -> Event? {
            let code = point.weatherCode
            if [95, 96, 99].contains(code ?? -1) {
                return Event(point: point, kind: .thunder,
                    label: (chance(point) ?? -1) >= 60 ? "Thunderstorms likely" : "Thunderstorms possible")
            }
            if point.thunderPossible {
                return Event(point: point, kind: .thunder, label: "Thunderstorms possible")
            }
            let likelihood = (chance(point) ?? -1) >= 60 ? "likely" : "possible"
            if [56, 57, 66, 67].contains(code ?? -1) {
                return Event(point: point, kind: .freezing, label: "Freezing precipitation \(likelihood)")
            }
            if [71, 73, 75, 77, 85, 86].contains(code ?? -1) {
                return Event(point: point, kind: .snow, label: "Snow \(likelihood)")
            }
            if [51, 53, 55, 61, 63, 65, 80, 81, 82].contains(code ?? -1) || (chance(point) ?? -1) >= 30 {
                // A probability without type evidence is precipitation, not
                // automatically rain (important during snow/ice conditions).
                let noun = [51, 53, 55, 61, 63, 65, 80, 81, 82].contains(code ?? -1) ? "Rain" : "Precipitation"
                return Event(point: point, kind: .rain, label: "\(noun) \(likelihood)")
            }
            return nil
        }

        var precipitationEvent: Event? {
            let events = hours.compactMap(event)
            for kind in [Event.Kind.thunder, .freezing, .snow, .rain] {
                if let first = events.first(where: { $0.kind == kind }) { return first }
            }
            // A daily-only forecast still carries useful qualified evidence,
            // but does not establish an hourly arrival time.
            return nil
        }

        func easingDetail(for event: Event) -> String? {
            guard event.kind != .thunder,
                  let start = hours.firstIndex(where: { $0.date == event.point.date }) else { return nil }
            var previous = event.point
            for point in hours.dropFirst(start + 1) {
                guard point.date.timeIntervalSince(previous.date) <= 90 * 60 else { return nil }
                if self.event(point) == nil {
                    guard let previousChance = chance(previous), let nextChance = chance(point),
                          previousChance >= 30, nextChance < 30,
                          let amount = finite(point.precipitationMM), amount < 0.2,
                          skyGroup(point.weatherCode) != nil else { return nil }
                    return "Precipitation chances ease around \(timeLabel(point.date))"
                }
                previous = point
            }
            return nil
        }

        var windRead: WindRead? {
            let gustThreshold = forecast.metric ? 48.0 : 30.0
            let windThreshold = forecast.metric ? 32.0 : 20.0
            let gusts = hours.compactMap { point -> (NativeForecastPoint, Double)? in
                finite(point.windGusts).map { (point, $0) }
            }
            if let peak = gusts.max(by: { $0.1 < $1.1 }), peak.1 >= gustThreshold {
                return WindRead(headline: timed("Gusty winds", at: peak.0.date),
                    detail: "Gusts near \(Int(peak.1.rounded())) \(forecast.metric ? "km/h" : "mph")")
            }
            let wind = hours.compactMap { point -> (NativeForecastPoint, Double)? in
                finite(point.windSpeed).map { (point, $0) }
            }
            if let peak = wind.max(by: { $0.1 < $1.1 }), peak.1 >= windThreshold {
                return WindRead(headline: timed("Windy", at: peak.0.date),
                    detail: "Winds near \(Int(peak.1.rounded())) \(forecast.metric ? "km/h" : "mph")")
            }
            return nil
        }

        func skyGroup(_ code: Int?) -> Int? {
            switch code {
            case 0, 1: return 0
            case 2: return 1
            case 3: return 2
            case 45, 48: return 3
            default: return nil
            }
        }

        var conditionTransition: String? {
            guard let first = hours.first, let initial = skyGroup(first.weatherCode) else { return nil }
            for index in hours.indices.dropFirst() {
                let point = hours[index]
                guard point.date.timeIntervalSince(hours[index - 1].date) <= 90 * 60 else { return nil }
                guard let group = skyGroup(point.weatherCode), group != initial,
                      index + 1 < hours.count,
                      skyGroup(hours[index + 1].weatherCode) == group,
                      hours[index + 1].date.timeIntervalSince(point.date) <= 90 * 60 else { continue }
                if initial == 3 && group != 3 { return "Fog clears around \(timeLabel(point.date))" }
                if group == 3 { return "Fog possible around \(timeLabel(point.date))" }
                if initial < 2 && group == 2 { return "Clouds increase around \(timeLabel(point.date))" }
                if initial == 2 && group < 2 { return "Clouds break around \(timeLabel(point.date))" }
            }
            return nil
        }

        var representativeCondition: String? {
            // Quiet wording about "this morning" must not use a cloudier
            // afternoon merely because more afternoon rows are available.
            let valid = quietHours.filter { $0.weatherCode != nil }
            if !valid.isEmpty {
                let counts = Dictionary(grouping: valid, by: { $0.weatherCode! }).mapValues(\.count)
                let selected = valid.max { left, right in
                    counts[left.weatherCode!, default: 0] < counts[right.weatherCode!, default: 0]
                }
                return selected?.conditionLabel
            }
            guard let daily = forecast.day(containing: day), daily.weatherCode != nil || daily.thunderPossible else { return nil }
            if [95, 96, 99].contains(daily.weatherCode ?? -1) {
                return (finite(daily.rainProbability) ?? -1) >= 60 ? "Thunderstorms likely" : "Thunderstorms possible"
            }
            return daily.conditionLabel
        }

        var temperatureTrend: Trend? {
            var samples = hours.filter { finite($0.temperature) != nil }
            if !isToday {
                // The selected-day story starts with the morning, rather than
                // declaring every day "warming" from its overnight low.
                let waking = samples.filter { calendar.component(.hour, from: $0.date) >= 6 }
                if !waking.isEmpty { samples = waking }
            }
            guard let first = samples.first, let firstValue = finite(first.temperature) else { return nil }
            var startDate = first.date
            var startValue = firstValue
            if isToday, let current = forecast.current, let value = finite(current.temperature),
               current.date <= now, now.timeIntervalSince(current.date) <= 75 * 60,
               current.date >= hourStart {
                startDate = current.date
                startValue = value
            }
            let later = samples.filter { $0.date.timeIntervalSince(startDate) >= 2 * 3600 }
            guard !later.isEmpty else { return nil }
            let threshold = forecast.metric ? 3.0 : 5.4
            let rising = later.filter { (finite($0.temperature) ?? startValue) - startValue >= threshold }
                .max { ($0.temperature ?? startValue) < ($1.temperature ?? startValue) }
            let falling = later.filter { startValue - (finite($0.temperature) ?? startValue) >= threshold }
                .min { ($0.temperature ?? startValue) < ($1.temperature ?? startValue) }
            let target: NativeForecastPoint?
            if night { target = falling ?? rising }
            else if let rising, let falling {
                // Prefer the next meaningful part of the day, not its most
                // distant extreme at the expense of what happens this morning.
                target = rising.date <= falling.date ? rising : falling
            } else { target = rising ?? falling }
            guard let target, let value = finite(target.temperature) else { return nil }
            let warming = value > startValue
            return Trend(warming: warming,
                detail: "\(warming ? "Warming" : "Cooling") to \(Int(value.rounded()))°\(forecast.metric ? "C" : "F") around \(timeLabel(target.date))")
        }
    }
}
