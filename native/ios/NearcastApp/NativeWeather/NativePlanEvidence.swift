import Foundation

/// A read-only weather evidence packet for one already-saved plan occurrence.
///
/// This deliberately is not a plan verdict, notification decision, or watch
/// state. It only describes what the native forecast and optional official
/// alert source say about the exact scheduled interval. The legacy plan
/// system remains authoritative for plan management and material-change
/// policy until those systems move together in a later migration phase.
struct NativePlanEvidence: Sendable {
    let item: NativeAgendaItem
    let window: NativePlanEvidenceWindow
    let coverage: NativePlanEvidenceCoverage
    let source: NativePlanEvidenceSource
    let condition: NativePlanConditionEvidence?
    let rain: NativePlanRainEvidence?
    let gust: NativePlanGustEvidence?
    let uv: NativePlanUVEvidence?
    let officialAlerts: NativePlanOfficialAlertsEvidence

    /// Derives evidence from already-normalized native inputs. No raw weather
    /// codes are recalibrated, no interpolation is manufactured, and nothing
    /// is written back to plans or any user-owned store.
    static func make(item: NativeAgendaItem, forecast: NativeWeatherForecast,
                     essentials: NativeWeatherEssentials?, now: Date = Date()) -> Self? {
        guard let window = NativePlanEvidenceWindow(item: item) else { return nil }

        // A plan is defined in its place's civil time. Forecast timestamps are
        // absolute, but a mismatched zone at either endpoint means we cannot
        // safely claim that the returned local forecast represents this saved
        // schedule. Matching offsets permits legitimate canonical time-zone
        // aliases without substituting the device's time zone.
        let planZone = TimeZone(identifier: window.timezoneID)
        let forecastZone = forecast.timeZone
        let timeZoneMatches = planZone?.secondsFromGMT(for: window.startsAt) == forecastZone.secondsFromGMT(for: window.startsAt)
            && planZone?.secondsFromGMT(for: window.endsAt) == forecastZone.secondsFromGMT(for: window.endsAt)

        let overlapping = timeZoneMatches
            ? samples(overlapping: window, points: forecast.hours)
            : []
        let coverage: NativePlanEvidenceCoverage = {
            guard timeZoneMatches else { return .unavailable }
            return coverage(of: window, samples: overlapping)
        }()
        // The model normally guarantees this identity before publishing. Keep
        // the pure constructor equally conservative for future callers.
        let matchingEssentials = essentials.flatMap {
            abs($0.latitude - item.place.latitude) <= 0.000_001 &&
                abs($0.longitude - item.place.longitude) <= 0.000_001 ? $0 : nil
        }
        let source = NativePlanEvidenceSource(forecastGeneratedAt: forecast.generatedAt,
                                               evaluatedAt: now,
                                               forecastTimeZoneID: forecast.timezoneID,
                                               officialAlertsCheckedAt: matchingEssentials?.alerts.checkedAt)

        return Self(item: item,
                    window: window,
                    coverage: coverage,
                    source: source,
                    condition: condition(from: overlapping),
                    rain: rain(from: overlapping),
                    gust: gust(from: overlapping, metric: forecast.metric),
                    uv: uv(from: overlapping),
                    officialAlerts: officialAlerts(from: matchingEssentials?.alerts, window: window, now: now))
    }
}

/// The exact absolute interval that a saved local-time plan means. A missing
/// or non-round-trippable local time (such as a spring-forward gap) fails
/// closed instead of silently moving a family's event.
struct NativePlanEvidenceWindow: Sendable, Equatable {
    let kind: NativeAgendaItemKind
    let startsAt: Date
    let endsAt: Date
    let timezoneID: String

    init?(item: NativeAgendaItem) {
        guard let zoneID = item.place.timezone,
              let zone = TimeZone(identifier: zoneID),
              let start = Self.timestamp(date: item.startDate, hour: item.startHour, timeZone: zone),
              let end = Self.timestamp(date: item.endDate, hour: item.endHour, timeZone: zone),
              end > start else { return nil }
        kind = item.kind
        startsAt = start
        endsAt = end
        timezoneID = zoneID
    }

    private static func timestamp(date: String, hour: Double, timeZone: TimeZone) -> Date? {
        guard hour.isFinite, hour >= 0, hour <= 24,
              abs(hour * 3600 - (hour * 3600).rounded()) < 0.000_001,
              let civil = civilDate(date, timeZone: timeZone) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone
        let startOfDay = calendar.startOfDay(for: civil)
        if hour == 24 {
            return calendar.date(byAdding: .day, value: 1, to: startOfDay)
        }
        let seconds = Int((hour * 3600).rounded())
        var requested = calendar.dateComponents([.year, .month, .day], from: civil)
        requested.hour = seconds / 3600
        requested.minute = (seconds % 3600) / 60
        requested.second = seconds % 60
        guard let value = calendar.date(from: requested) else { return nil }
        // Do not turn a nonexistent local clock time into a later time without
        // telling the user. This comparison is deliberately local to the plan.
        let expectedHour = seconds / 3600
        let expectedMinute = (seconds % 3600) / 60
        let expectedSecond = seconds % 60
        let resolved = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: value)
        let expectedDate = calendar.dateComponents([.year, .month, .day], from: civil)
        guard resolved.year == expectedDate.year, resolved.month == expectedDate.month,
              resolved.day == expectedDate.day, resolved.hour == expectedHour,
              resolved.minute == expectedMinute, resolved.second == expectedSecond else { return nil }
        return value
    }

    private static func civilDate(_ value: String, timeZone: TimeZone) -> Date? {
        let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3, value.utf8.count == 10,
              let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = timeZone
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let result = calendar.date(from: components) else { return nil }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: result)
        guard roundTrip.year == year, roundTrip.month == month, roundTrip.day == day else { return nil }
        return result
    }
}

/// Forecast coverage is about data availability across the plan interval, not
/// about whether the weather will be good. `partial` remains useful evidence,
/// but never carries an implied all-window forecast.
enum NativePlanEvidenceCoverage: String, Sendable, Equatable {
    case complete
    case partial
    case unavailable
}

/// Source metadata lets a view disclose when the forecast was generated and
/// when official-alert evidence was last checked without turning either into a
/// notification or an ownership claim.
struct NativePlanEvidenceSource: Sendable, Equatable {
    let forecastGeneratedAt: Date
    let evaluatedAt: Date
    let forecastTimeZoneID: String
    let officialAlertsCheckedAt: Date?

    /// Recency is a source disclosure only. A forecast can still contain
    /// useful future guidance after this threshold, so callers must not treat
    /// false as a weather verdict.
    var isForecastFresh: Bool {
        let age = evaluatedAt.timeIntervalSince(forecastGeneratedAt)
        return age >= -60 && age <= 6 * 60 * 60
    }
}

/// The first concrete condition sample in the scheduled interval. It is not a
/// promise that a multi-hour or multi-day plan will stay that way.
struct NativePlanConditionEvidence: Sendable, Equatable {
    let label: String
    let symbolName: String
    let at: Date
}

/// Precipitation evidence retains both the highest available chance and its
/// observed forecast label. A snow/freezing/thunder code is never relabeled as
/// ordinary rain merely for compact presentation.
struct NativePlanRainEvidence: Sendable, Equatable {
    let label: String
    let probability: Double?
    let at: Date
}

struct NativePlanGustEvidence: Sendable, Equatable {
    let value: Double
    let at: Date
    let unit: String
}

struct NativePlanUVEvidence: Sendable, Equatable {
    let index: Double
    let at: Date
}

struct NativePlanOfficialAlertEvidence: Sendable, Equatable, Identifiable {
    let id: String
    let event: String
    let headline: String
    let startsAt: Date
    let endsAt: Date
    let sourceURL: URL?

    init(_ alert: NativeOfficialAlert) {
        id = alert.id
        event = alert.event
        headline = alert.headline
        startsAt = alert.startAt
        endsAt = alert.endAt
        sourceURL = alert.sourceURL
    }
}

/// There is no implicit all-clear. A failed, stale, missing, or unsupported
/// official source is explicit so the view can say what it actually knows.
enum NativePlanOfficialAlertsEvidence: Sendable, Equatable {
    case clear(checkedAt: Date)
    case active(alerts: [NativePlanOfficialAlertEvidence], checkedAt: Date)
    case unavailable(message: String?, retainedAlerts: [NativePlanOfficialAlertEvidence])
    case unsupported(message: String?)

    var alerts: [NativePlanOfficialAlertEvidence] {
        switch self {
        case .active(let alerts, _), .unavailable(_, let alerts): return alerts
        case .clear, .unsupported: return []
        }
    }

    var isVerified: Bool {
        switch self {
        case .clear, .active: return true
        case .unavailable, .unsupported: return false
        }
    }
}

private extension NativePlanEvidence {
    struct Sample {
        let point: NativeForecastPoint
        let interval: DateInterval
    }

    static func samples(overlapping window: NativePlanEvidenceWindow,
                        points: [NativeForecastPoint]) -> [Sample] {
        let ordered = points.sorted { $0.date < $1.date }
        return ordered.enumerated().compactMap { index, point in
            guard point.hasReadings else { return nil }
            let defaultInterval: TimeInterval = 60 * 60
            let next = ordered.indices.contains(index + 1) ? ordered[index + 1].date : nil
            let inferred = next.map { $0.timeIntervalSince(point.date) }
            let duration = point.precipitationIntervalSeconds
                ?? inferred.flatMap { $0 > 0 && $0 <= 3 * 60 * 60 ? $0 : nil }
                ?? defaultInterval
            guard duration.isFinite, duration > 0,
                  let end = Calendar(identifier: .gregorian).date(byAdding: .second, value: Int(duration.rounded()), to: point.date),
                  end > point.date else { return nil }
            let interval = DateInterval(start: point.date, end: end)
            guard interval.start < window.endsAt && interval.end > window.startsAt else { return nil }
            return Sample(point: point, interval: interval)
        }
    }

    static func coverage(of window: NativePlanEvidenceWindow, samples: [Sample]) -> NativePlanEvidenceCoverage {
        let intervals = samples.map(\.interval).sorted { $0.start < $1.start }
        guard !intervals.isEmpty else { return .unavailable }
        var cursor = window.startsAt
        var overlaps = false
        for interval in intervals {
            let start = max(interval.start, window.startsAt)
            let end = min(interval.end, window.endsAt)
            guard end > start else { continue }
            overlaps = true
            if start > cursor { return .partial }
            if end > cursor { cursor = end }
            if cursor >= window.endsAt { return .complete }
        }
        return overlaps ? .partial : .unavailable
    }

    static func condition(from samples: [Sample]) -> NativePlanConditionEvidence? {
        guard let sample = samples.first(where: { $0.point.weatherCode != nil || $0.point.thunderPossible }) else { return nil }
        return NativePlanConditionEvidence(label: sample.point.conditionLabel,
                                           symbolName: sample.point.symbolName,
                                           at: sample.point.date)
    }

    static func rain(from samples: [Sample]) -> NativePlanRainEvidence? {
        let ranked = samples.compactMap { sample -> (Sample, Double)? in
            guard let probability = sample.point.rainProbability,
                  probability.isFinite, (0...100).contains(probability) else { return nil }
            return (sample, probability)
        }.sorted { left, right in
            if left.1 != right.1 { return left.1 > right.1 }
            return left.0.point.date < right.0.point.date
        }
        if let peak = ranked.first {
            return NativePlanRainEvidence(label: precipitationLabel(for: peak.0.point),
                                           probability: peak.1, at: peak.0.point.date)
        }
        guard let sample = samples.first(where: { isPrecipitation($0.point) }) else { return nil }
        return NativePlanRainEvidence(label: precipitationLabel(for: sample.point), probability: nil, at: sample.point.date)
    }

    static func gust(from samples: [Sample], metric: Bool) -> NativePlanGustEvidence? {
        guard let peak = samples.compactMap({ sample -> (Sample, Double)? in
            guard let gust = sample.point.windGusts, gust.isFinite, gust >= 0 else { return nil }
            return (sample, gust)
        }).max(by: { left, right in
            left.1 == right.1 ? left.0.point.date > right.0.point.date : left.1 < right.1
        }) else { return nil }
        return NativePlanGustEvidence(value: peak.1, at: peak.0.point.date, unit: metric ? "km/h" : "mph")
    }

    static func uv(from samples: [Sample]) -> NativePlanUVEvidence? {
        guard let peak = samples.compactMap({ sample -> (Sample, Double)? in
            guard let value = sample.point.uvIndex, value.isFinite, value >= 0 else { return nil }
            return (sample, value)
        }).max(by: { left, right in
            left.1 == right.1 ? left.0.point.date > right.0.point.date : left.1 < right.1
        }) else { return nil }
        return NativePlanUVEvidence(index: peak.1, at: peak.0.point.date)
    }

    static func officialAlerts(from state: NativeAlertState?, window: NativePlanEvidenceWindow,
                               now: Date) -> NativePlanOfficialAlertsEvidence {
        guard let state else {
            return .unavailable(message: "Official alerts have not been checked for this plan place.", retainedAlerts: [])
        }
        if state.status == .unsupported {
            return .unsupported(message: state.message)
        }
        let relevant = state.alerts.filter { alert in
            alert.startAt < window.endsAt && alert.endAt > window.startsAt && alert.endAt > now && alert.expiresAt > now
        }.map(NativePlanOfficialAlertEvidence.init)
        guard state.status == .ready, state.isFresh(now: now), let checkedAt = state.checkedAt else {
            return .unavailable(message: state.message ?? "Official alerts could not be verified for this plan place.",
                                retainedAlerts: relevant)
        }
        return relevant.isEmpty ? .clear(checkedAt: checkedAt) : .active(alerts: relevant, checkedAt: checkedAt)
    }

    static func isPrecipitation(_ point: NativeForecastPoint) -> Bool {
        point.thunderPossible || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67,
                                  71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].contains(point.weatherCode ?? -1)
    }

    static func precipitationLabel(for point: NativeForecastPoint) -> String {
        let code = point.weatherCode
        if [95, 96, 99].contains(code ?? -1) || point.thunderPossible { return "Thunderstorms" }
        if [56, 57, 66, 67].contains(code ?? -1) { return "Freezing precipitation" }
        if [71, 73, 75, 77, 85, 86].contains(code ?? -1) { return "Snow" }
        if [51, 53, 55, 61, 63, 65, 80, 81, 82].contains(code ?? -1) { return "Rain" }
        return "Precipitation"
    }
}
