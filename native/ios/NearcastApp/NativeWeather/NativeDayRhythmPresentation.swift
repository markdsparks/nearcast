import Foundation

/// The concise, source-honest day story behind Hourly's “Day at a glance”.
///
/// This is deliberately derived only from canonical *hourly forecast* rows.
/// It does not promote a current reading, 15-minute guidance, radar, a daily
/// aggregate, or an official thunder bulletin into an hourly fact. In
/// particular, `thunderPossible` can originate in a broad NWS period. Without
/// a resolved hourly thunder code, it remains a day-level risk with no
/// invented arrival or departure time.
struct NativeDayRhythmPresentation: Equatable, Sendable {
    enum Daypart: String, CaseIterable, Identifiable, Sendable {
        case overnight
        case morning
        case afternoon
        case evening

        var id: String { rawValue }

        var label: String {
            switch self {
            case .overnight: return "Overnight"
            case .morning: return "Morning"
            case .afternoon: return "Afternoon"
            case .evening: return "Evening"
            }
        }

        fileprivate var startHour: Int {
            switch self {
            case .overnight: return 0
            case .morning: return 6
            case .afternoon: return 12
            case .evening: return 18
            }
        }

        fileprivate var endHour: Int {
            switch self {
            case .overnight: return 6
            case .morning: return 12
            case .afternoon: return 18
            case .evening: return 24
            }
        }
    }

    enum Coverage: String, Equatable, Sendable {
        /// Provider rows continuously cover the whole displayed daypart.
        case complete
        /// At least one provider row is useful, but one or more intervals are
        /// missing. UI must not word this as a full-period guarantee.
        case partial
    }

    enum EventKind: String, Equatable, Sendable {
        case thunderstorm
        case freezingPrecipitation
        case snow
        case rain
        /// The provider supplies a probability but not precipitation type.
        case precipitation

        var label: String {
            switch self {
            case .thunderstorm: return "Thunderstorms"
            case .freezingPrecipitation: return "Freezing precipitation"
            case .snow: return "Snow"
            case .rain: return "Rain"
            case .precipitation: return "Precipitation"
            }
        }

        var symbolName: String {
            switch self {
            case .thunderstorm: return "cloud.bolt.rain.fill"
            case .freezingPrecipitation: return "cloud.sleet.fill"
            case .snow: return "cloud.snow.fill"
            case .rain: return "cloud.rain.fill"
            case .precipitation: return "drop.fill"
            }
        }

        fileprivate var priority: Int {
            switch self {
            case .thunderstorm: return 5
            case .freezingPrecipitation: return 4
            case .snow: return 3
            case .rain: return 2
            case .precipitation: return 1
            }
        }
    }

    enum Likelihood: String, Equatable, Sendable {
        case likely
        case possible

        fileprivate var priority: Int { self == .likely ? 1 : 0 }
    }

    /// A weather risk that the available input does not support timing. It is
    /// intentionally separate from `Event`, whose dates are safe tap targets.
    enum UntimedRisk: String, Equatable, Sendable, Identifiable {
        case thunderstormPotential

        var id: String { rawValue }

        var label: String {
            switch self {
            // The presentation is also used for a selected future day; the
            // view owns the local “today”/date framing around this neutral
            // source statement.
            case .thunderstormPotential: return "Thunderstorms possible"
            }
        }

        var symbolName: String {
            switch self {
            case .thunderstormPotential: return "cloud.bolt"
            }
        }
    }

    struct TemperatureRange: Equatable, Sendable {
        let low: Double
        let high: Double

        var isSingleValue: Bool { low.rounded() == high.rounded() }
    }

    /// A contiguous sequence of explicit hourly forecast evidence. `end` is
    /// the end of the final provider interval; `endIsKnown` is false when the
    /// data simply runs out, so the UI can say “from” rather than promising an
    /// ending time.
    struct Event: Equatable, Sendable {
        let kind: EventKind
        let likelihood: Likelihood
        let start: Date
        let end: Date
        let endIsKnown: Bool
        let maximumProbability: Double?
        let sourceHourCount: Int

        var label: String { "\(kind.label) \(likelihood.rawValue)" }
        var symbolName: String { kind.symbolName }
    }

    /// A canonical civil-time part of the selected day. `start`/`end` always
    /// describe the actual local civil period. `guidanceStart`/`guidanceEnd`
    /// describe the subset backed by the source forecast—important for today
    /// and for incomplete provider coverage.
    struct Period: Equatable, Sendable, Identifiable {
        let daypart: Daypart
        let start: Date
        let end: Date
        let guidanceStart: Date
        let guidanceEnd: Date
        let tapTarget: Date
        let isCurrentRemainingPeriod: Bool
        let coverage: Coverage
        let sourceHourCount: Int
        let temperatureRange: TemperatureRange?
        let conditionLabel: String
        let symbolName: String
        let event: Event?

        var id: String { "\(daypart.rawValue)-\(start.timeIntervalSince1970)" }

        /// Only report a start as belonging to this visible row when it is
        /// actually within the row's available forecast window.
        func eventBeginsHere(_ event: Event) -> Bool {
            event.start >= guidanceStart && event.start < end
        }

        /// An end is displayable only when a contiguous subsequent hourly row
        /// proves that the event stopped, and it ends within this row.
        func eventEndsHere(_ event: Event) -> Bool {
            event.endIsKnown && event.end > guidanceStart && event.end <= end
        }
    }

    let day: Date
    let isToday: Bool
    /// The forecast's display system is part of the normalized input, so
    /// threshold decisions never assume the phone's locale or units.
    let metric: Bool
    let periods: [Period]
    let untimedRisks: [UntimedRisk]

    var hasTimedEvent: Bool { periods.contains { $0.event != nil } }

    /// Keep exact hours on the first screen even when the day matters. The
    /// compact Day-at-a-glance header carries the first supported timing; the
    /// period breakdown is there when someone asks for it, rather than pushing
    /// the visual rhythm and dense hourly rows out of reach by default.
    var defaultIsExpanded: Bool { false }

    /// A calm single leftover hour should not produce a second top-of-screen
    /// card. Two remaining dayparts, or any material forecast signal, earns
    /// the affordance; a real thermal or sky change also earns it on longer
    /// days.
    var isWorthShowing: Bool {
        guard !periods.isEmpty else { return false }
        if hasTimedEvent || !untimedRisks.isEmpty { return true }
        guard periods.count >= 2 else { return false }
        if hasMeaningfulConditionChange || hasMeaningfulTemperatureSwing { return true }
        return false
    }

    static func make(forecast: NativeWeatherForecast, day: Date, now: Date) -> Self? {
        let calendar = forecast.calendar
        guard let dayInterval = calendar.dateInterval(of: .day, for: day), dayInterval.end > now else {
            // Forecast rows before now are not observation history. A past
            // selected date gets no retrospective Day-at-a-glance story.
            return nil
        }
        let isToday = calendar.isDate(day, inSameDayAs: now)
        let currentHourStart = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        let sourceHours = forecast.hours
            .filter { point in
                // The canonical `hours` collection is hourly in production.
                // Preserve nil origin for locally cached legacy forecasts, but
                // never blend another explicit data resolution into this read.
                (point.origin == nil || point.origin == .hourlyForecast)
                    && point.hasReadings
                    && point.date >= dayInterval.start
                    && point.date < dayInterval.end
                    && (!isToday || point.date.addingTimeInterval(hourInterval) > now)
            }
            .sorted { $0.date < $1.date }
        guard !sourceHours.isEmpty else { return nil }

        let timedSegments = eventSegments(hours: sourceHours, dayEnd: dayInterval.end)
        let hasTimedThunder = timedSegments.contains { $0.event.kind == .thunderstorm }
        let hasBroadThunderRisk = sourceHours.contains { point in
            point.thunderPossible && !hasTimeableThunder(point)
        }

        var periods: [Period] = []
        for daypart in Daypart.allCases {
            guard let window = window(for: daypart, in: dayInterval, calendar: calendar) else { continue }
            if isToday && window.end <= now { continue }
            // We retain the forecast row containing now, while omitting all
            // completed hourly rows. Its time is still a valid scroll target.
            let expectedStart = isToday ? max(window.start, currentHourStart) : window.start
            let points = sourceHours.filter { point in
                point.date < window.end && point.date.addingTimeInterval(hourInterval) > expectedStart
            }
            guard let first = points.first, let last = points.last else { continue }

            let intersects = timedSegments.filter { segment in
                segment.event.start < window.end && segment.event.end > expectedStart
            }
            let selectedEvent = strongestSegment(from: intersects)?.event
            let representative = representativeCondition(from: points)
            let temperatureRange = range(points.compactMap { finite($0.temperature) })
            let coverage = coverage(for: points, expectedStart: expectedStart, end: window.end)
            let guidanceStart = max(expectedStart, first.date)
            let guidanceEnd = min(window.end, last.date.addingTimeInterval(hourInterval))
            let isCurrentRemainingPeriod = isToday && now > window.start && now < window.end
            periods.append(Period(
                daypart: daypart,
                start: window.start,
                end: window.end,
                guidanceStart: guidanceStart,
                guidanceEnd: guidanceEnd,
                tapTarget: first.date,
                isCurrentRemainingPeriod: isCurrentRemainingPeriod,
                coverage: coverage,
                sourceHourCount: points.count,
                temperatureRange: temperatureRange,
                conditionLabel: representative.label,
                symbolName: representative.symbolName,
                event: selectedEvent
            ))
        }
        guard !periods.isEmpty else { return nil }
        let risks: [UntimedRisk] = hasBroadThunderRisk && !hasTimedThunder ? [.thunderstormPotential] : []
        return Self(day: dayInterval.start, isToday: isToday, metric: forecast.metric,
                    periods: periods, untimedRisks: risks)
    }
}

private extension NativeDayRhythmPresentation {
    static let hourInterval: TimeInterval = 60 * 60
    static let continuityTolerance: TimeInterval = 90 * 60
    static let fullCoverageTolerance: TimeInterval = 60

    struct Signal {
        let kind: EventKind
        let likelihood: Likelihood
        let probability: Double?
    }

    struct Segment {
        let event: Event
    }

    struct RepresentativeCondition {
        let label: String
        let symbolName: String
    }

    static func finite(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }

    static func validProbability(_ point: NativeForecastPoint) -> Double? {
        finite(point.rainProbability).flatMap { (0...100).contains($0) ? $0 : nil }
    }

    static func hasTimeableThunder(_ point: NativeForecastPoint) -> Bool {
        // `weatherCode` is the app's resolved hourly WMO interpretation. Do
        // not let a raw provider code overrule it: the shared semantics layer
        // may have intentionally suppressed a weak or unsupported raw storm
        // code. The separate `thunderPossible` flag therefore stays untimed.
        NativeWeatherCondition.isThunder(point.weatherCode)
    }

    static func signal(for point: NativeForecastPoint) -> Signal? {
        let chance = validProbability(point)
        let likelihood: Likelihood = (chance ?? -1) >= 60 ? .likely : .possible
        if hasTimeableThunder(point) {
            return Signal(kind: .thunderstorm, likelihood: likelihood, probability: chance)
        }
        switch point.weatherCode {
        case 56, 57, 66, 67:
            return Signal(kind: .freezingPrecipitation, likelihood: likelihood, probability: chance)
        case 71, 73, 75, 77, 85, 86:
            return Signal(kind: .snow, likelihood: likelihood, probability: chance)
        case 51, 53, 55, 61, 63, 65, 80, 81, 82:
            return Signal(kind: .rain, likelihood: likelihood, probability: chance)
        default:
            // A probability alone is useful timing evidence, but the source
            // did not identify rain versus snow or ice.
            guard (chance ?? -1) >= 30 else { return nil }
            return Signal(kind: .precipitation, likelihood: likelihood, probability: chance)
        }
    }

    static func eventSegments(hours: [NativeForecastPoint], dayEnd: Date) -> [Segment] {
        let candidates = hours.compactMap { point -> (point: NativeForecastPoint, signal: Signal)? in
            signal(for: point).map { (point, $0) }
        }
        guard !candidates.isEmpty else { return [] }

        var groups: [[(point: NativeForecastPoint, signal: Signal)]] = []
        for candidate in candidates {
            if var previous = groups.popLast() {
                let last = previous[previous.count - 1]
                if last.signal.kind == candidate.signal.kind
                    && candidate.point.date.timeIntervalSince(last.point.date) <= continuityTolerance {
                    previous.append(candidate)
                    groups.append(previous)
                } else {
                    groups.append(previous)
                    groups.append([candidate])
                }
            } else {
                groups.append([candidate])
            }
        }

        return groups.compactMap { group in
            guard let first = group.first, let last = group.last else { return nil }
            let next = hours.first { $0.date > last.point.date }
            let endIsKnown: Bool
            if let next, next.date.timeIntervalSince(last.point.date) <= continuityTolerance {
                // A following dry/sky hour proves the event ended just as
                // surely as a following different precipitation type does.
                endIsKnown = signal(for: next).map { $0.kind != first.signal.kind } ?? true
            } else {
                endIsKnown = false
            }
            let maximumProbability = group.compactMap { $0.signal.probability }.max()
            let likelihood: Likelihood = group.contains { $0.signal.likelihood == .likely } ? .likely : .possible
            return Segment(event: Event(
                kind: first.signal.kind,
                likelihood: likelihood,
                start: first.point.date,
                end: min(dayEnd, last.point.date.addingTimeInterval(hourInterval)),
                endIsKnown: endIsKnown,
                maximumProbability: maximumProbability,
                sourceHourCount: group.count
            ))
        }
    }

    static func strongestSegment(from segments: [Segment]) -> Segment? {
        segments.sorted { lhs, rhs in
            if lhs.event.kind.priority != rhs.event.kind.priority {
                return lhs.event.kind.priority > rhs.event.kind.priority
            }
            if lhs.event.likelihood.priority != rhs.event.likelihood.priority {
                return lhs.event.likelihood.priority > rhs.event.likelihood.priority
            }
            let leftChance = lhs.event.maximumProbability ?? -1
            let rightChance = rhs.event.maximumProbability ?? -1
            if leftChance != rightChance { return leftChance > rightChance }
            if lhs.event.sourceHourCount != rhs.event.sourceHourCount {
                return lhs.event.sourceHourCount > rhs.event.sourceHourCount
            }
            return lhs.event.start < rhs.event.start
        }.first
    }

    static func representativeCondition(from points: [NativeForecastPoint]) -> RepresentativeCondition {
        var counts: [Int: Int] = [:]
        var firstIndex: [Int: Int] = [:]
        var representativeDayValue: [Int: Bool?] = [:]
        for (index, point) in points.enumerated() {
            guard let code = point.weatherCode else { continue }
            counts[code, default: 0] += 1
            if firstIndex[code] == nil {
                firstIndex[code] = index
                representativeDayValue[code] = point.isDay
            }
        }
        guard let code = counts.keys.sorted(by: { left, right in
            let leftCount = counts[left, default: 0]
            let rightCount = counts[right, default: 0]
            if leftCount != rightCount { return leftCount > rightCount }
            let leftFirst = firstIndex[left, default: .max]
            let rightFirst = firstIndex[right, default: .max]
            if leftFirst != rightFirst { return leftFirst < rightFirst }
            return left < right
        }).first else {
            return RepresentativeCondition(label: "Conditions unavailable", symbolName: "questionmark")
        }
        return RepresentativeCondition(
            label: NativeWeatherCondition.label(code),
            symbolName: NativeWeatherCondition.symbol(code, isDay: representativeDayValue[code] ?? nil)
        )
    }

    static func range(_ values: [Double]) -> TemperatureRange? {
        guard let low = values.min(), let high = values.max() else { return nil }
        return TemperatureRange(low: low, high: high)
    }

    static func coverage(for points: [NativeForecastPoint], expectedStart: Date, end: Date) -> Coverage {
        guard let first = points.first, let last = points.last else { return .partial }
        let startsAtBeginning = first.date <= expectedStart.addingTimeInterval(fullCoverageTolerance)
        let endsAtBoundary = last.date.addingTimeInterval(hourInterval) >= end.addingTimeInterval(-fullCoverageTolerance)
        let hasGap = zip(points, points.dropFirst()).contains {
            $1.date.timeIntervalSince($0.date) > continuityTolerance
        }
        return startsAtBeginning && endsAtBoundary && !hasGap ? .complete : .partial
    }

    static func window(for daypart: Daypart, in day: DateInterval, calendar: Calendar) -> DateInterval? {
        guard let start = calendar.date(bySettingHour: daypart.startHour, minute: 0, second: 0, of: day.start) else {
            return nil
        }
        let end: Date
        if daypart.endHour == 24 {
            end = day.end
        } else if let value = calendar.date(bySettingHour: daypart.endHour, minute: 0, second: 0, of: day.start) {
            end = value
        } else {
            return nil
        }
        guard end > start else { return nil }
        return DateInterval(start: start, end: end)
    }

    var hasMeaningfulConditionChange: Bool {
        let labels = Set(periods.map(\.conditionLabel).filter { $0 != "Conditions unavailable" })
        return labels.count >= 2
    }

    var hasMeaningfulTemperatureSwing: Bool {
        let values = periods.compactMap(\.temperatureRange).flatMap { [$0.low, $0.high] }
        guard let low = values.min(), let high = values.max() else { return false }
        let threshold = metric ? 5.5 : 10.0
        return high - low >= threshold
    }
}
