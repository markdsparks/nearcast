import Foundation

/// Presentation-neutral meanings used by both the Watch app and its complications.
/// Views own color and layout; this model owns which weather fact matters.
enum NearcastVisualSignalKind: String, Equatable {
    case rain
    case wind
    case temperature
    case condition
    case steady
    case plan
}

enum NearcastVisualSignalTone: String, Equatable {
    case calm
    case rain
    case wind
    case warm
    case cool
    case go
    case watch
    case change
    case neutral
}

enum NearcastVisualMagnitudeKind: String, Equatable {
    case probability
    case speed
    case temperature
}

enum NearcastVisualPlanVerdict: String, Equatable {
    case go = "GO"
    case watch = "WATCH"
    case change = "CHANGE"
    case check = "CHECK"
}

struct NearcastVisualMagnitude: Equatable {
    let kind: NearcastVisualMagnitudeKind
    let value: Int
    let unit: String
    /// A clamped 0...1 value suitable for a gauge or ribbon height.
    let normalizedValue: Double

    var displayValue: String {
        switch kind {
        case .probability:
            return "\(value)%"
        case .temperature:
            return "\(value)°"
        case .speed:
            return "\(value) \(unit)"
        }
    }
}

struct NearcastVisualTimeWindow: Equatable {
    let startAt: TimeInterval
    let endAt: TimeInterval

    init?(startAt: TimeInterval?, endAt: TimeInterval?) {
        guard let startAt, let endAt, startAt > 0, endAt > startAt else { return nil }
        self.startAt = startAt
        self.endAt = endAt
    }

    func contains(_ timestamp: TimeInterval?) -> Bool {
        guard let timestamp else { return false }
        return timestamp >= startAt && timestamp < endAt
    }
}

struct NearcastVisualTimelinePoint: Identifiable, Equatable {
    var id: String {
        let timestamp = startsAt.map { String(Int($0)) } ?? "relative"
        return "\(offsetHours)-\(timestamp)-\(timeLabel)"
    }

    let offsetHours: Int
    let timeLabel: String
    let startsAt: TimeInterval?
    let magnitude: NearcastVisualMagnitude?
    let temperature: Int?
    let conditionCode: Int?
    let symbolName: String
    let isEvent: Bool
    let isInPlanWindow: Bool
}

struct NearcastVisualSignal: Equatable {
    let kind: NearcastVisualSignalKind
    let tone: NearcastVisualSignalTone
    let symbolName: String
    /// Short interpretation copy. The visual may omit this when the symbol/value is clear.
    let headline: String
    let detail: String?
    /// Plan title or current condition; never required to decode the visual.
    let context: String?
    let eventTimeLabel: String?
    let eventStartsAt: TimeInterval?
    let magnitude: NearcastVisualMagnitude?
    let timelinePoints: [NearcastVisualTimelinePoint]
    let timeWindow: NearcastVisualTimeWindow?
    let planVerdict: NearcastVisualPlanVerdict?
    let isActionable: Bool
    let accessibilityDescription: String
}

struct NearcastVisualSignalSet: Equatable {
    /// Includes an urgent watched-plan verdict when one is present.
    let primary: NearcastVisualSignal
    let primaryWeather: NearcastVisualSignal
    let rain: NearcastVisualSignal
    let wind: NearcastVisualSignal
    let temperature: NearcastVisualSignal
    let condition: NearcastVisualSignal
    let steady: NearcastVisualSignal
    let plan: NearcastVisualSignal?
    /// Weather signal that actually explains the watched plan. Nil when the
    /// risk is unsupported or the plan belongs to another saved place.
    let planWeather: NearcastVisualSignal?
}

enum NearcastVisualSignalModel {
    static func make(
        snapshot: NearcastWidgetSnapshot,
        now: Date = Date(),
        horizonHours: Int = 6
    ) -> NearcastVisualSignalSet {
        let rows = activeTimelineRows(snapshot, now: now, maximumHours: horizonHours)
        let window = NearcastVisualTimeWindow(startAt: snapshot.planStartAt, endAt: snapshot.planEndAt)
        let rain = rainSignal(snapshot, rows: rows, planWindow: window)
        let wind = windSignal(snapshot, rows: rows, planWindow: window)
        let temperature = temperatureSignal(snapshot, rows: rows, planWindow: window, now: now)
        let condition = conditionSignal(snapshot, rows: rows, planWindow: window)
        let steady = steadySignal(snapshot, rows: rows, planWindow: window)
        let plan = planSignal(snapshot, timeWindow: window)
        let planWeather = planWeatherSignal(
            snapshot,
            rain: rain,
            wind: wind,
            temperature: temperature,
            steady: steady
        )

        let rainValue = rain.magnitude?.value ?? 0
        let highImpactRain = rain.symbolName.contains("bolt")
            || rain.headline == "Rain now"
            || rain.headline == "Snow now"
            || rainValue >= 60
        let severeWindThreshold = snapshot.windUnit.lowercased().contains("km") ? 65 : 40
        let severeWind = (wind.magnitude?.value ?? 0) >= severeWindThreshold
        let extremeTemperature = temperature.detail == "Heat" || temperature.detail == "Freezing"

        let primaryWeather: NearcastVisualSignal
        if rain.isActionable && highImpactRain {
            primaryWeather = rain
        } else if wind.isActionable && severeWind {
            primaryWeather = wind
        } else if temperature.isActionable && extremeTemperature {
            primaryWeather = temperature
        } else if rain.isActionable {
            primaryWeather = rain
        } else if wind.isActionable {
            primaryWeather = wind
        } else if condition.isActionable {
            primaryWeather = condition
        } else if temperature.isActionable {
            primaryWeather = temperature
        } else {
            primaryWeather = steady
        }

        let primary: NearcastVisualSignal
        if let plan, plan.planVerdict == .change || plan.planVerdict == .watch {
            primary = plan
        } else {
            primary = primaryWeather
        }

        return NearcastVisualSignalSet(
            primary: primary,
            primaryWeather: primaryWeather,
            rain: rain,
            wind: wind,
            temperature: temperature,
            condition: condition,
            steady: steady,
            plan: plan,
            planWeather: planWeather
        )
    }

    static func rain(
        snapshot: NearcastWidgetSnapshot,
        now: Date = Date(),
        horizonHours: Int = 6
    ) -> NearcastVisualSignal {
        let rows = activeTimelineRows(snapshot, now: now, maximumHours: horizonHours)
        return rainSignal(
            snapshot,
            rows: rows,
            planWindow: NearcastVisualTimeWindow(startAt: snapshot.planStartAt, endAt: snapshot.planEndAt)
        )
    }

    static func plan(snapshot: NearcastWidgetSnapshot) -> NearcastVisualSignal? {
        planSignal(
            snapshot,
            timeWindow: NearcastVisualTimeWindow(startAt: snapshot.planStartAt, endAt: snapshot.planEndAt)
        )
    }

    private static func rainSignal(
        _ snapshot: NearcastWidgetSnapshot,
        rows: [NearcastWidgetHour],
        planWindow: NearcastVisualTimeWindow?
    ) -> NearcastVisualSignal {
        let peak = max(snapshot.rainChance, rows.compactMap(\.rainChance).max() ?? 0)
        let observedPrecipitation = isPrecipitationCondition(snapshot.conditionCode)
        let observedSnow = isSnowCondition(snapshot.conditionCode)
        let currentChanceIsMeaningful = snapshot.rainChance >= 30
        let firstPrecipitationIndex = rows.firstIndex {
            ($0.rainChance ?? 0) >= 30 || isPrecipitationCondition($0.conditionCode)
        }
        let eventIndex: Int?
        if observedPrecipitation || currentChanceIsMeaningful {
            eventIndex = rows.isEmpty ? nil : 0
        } else {
            eventIndex = firstPrecipitationIndex
        }
        let event = eventIndex.flatMap { rows.indices.contains($0) ? rows[$0] : nil }
        let last = rows.last
        let headline: String
        let detail: String?
        let symbol: String
        let tone: NearcastVisualSignalTone
        let eventTimeLabel: String?
        let eventStartsAt: TimeInterval?

        if observedPrecipitation {
            headline = observedSnow ? "Snow now" : "Rain now"
            detail = peak > 0 ? "Peak \(peak)%" : nil
            symbol = precipitationSymbol(snapshot.conditionCode)
            tone = observedSnow ? .cool : .rain
            eventTimeLabel = "Now"
            eventStartsAt = event?.startsAt
        } else if currentChanceIsMeaningful {
            headline = "Rain chance"
            detail = "Peak \(peak)%"
            symbol = "cloud.rain.fill"
            tone = .rain
            eventTimeLabel = "Now"
            eventStartsAt = event?.startsAt
        } else if let event {
            let isNow = event.offsetHours == 0 || event.timeLabel.lowercased() == "now"
            let supported = isNow
                ? isPrecipitationCondition(snapshot.conditionCode)
                : isPrecipitationCondition(event.conditionCode)
            let snow = isNow ? observedSnow : isSnowCondition(event.conditionCode)
            headline = supported ? (snow ? (isNow ? "Snow now" : "Snow") : (isNow ? "Rain now" : "Rain")) : "Rain chance"
            detail = peak > 0 ? "Peak \(peak)%" : nil
            symbol = supported ? precipitationSymbol(event.conditionCode) : "cloud.rain.fill"
            tone = snow ? .cool : .rain
            eventTimeLabel = isNow ? "Now" : event.timeLabel
            eventStartsAt = event.startsAt
        } else if peak > 0 {
            headline = "Low chance"
            detail = "Peak \(peak)%"
            symbol = "drop.fill"
            tone = .calm
            eventTimeLabel = rows.max(by: { ($0.rainChance ?? 0) < ($1.rainChance ?? 0) })?.timeLabel
            eventStartsAt = rows.max(by: { ($0.rainChance ?? 0) < ($1.rainChance ?? 0) })?.startsAt
        } else {
            headline = "Dry"
            detail = last.map { "Through \($0.timeLabel)" }
            symbol = conditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay)
            tone = .calm
            eventTimeLabel = last?.timeLabel
            eventStartsAt = last?.startsAt
        }

        let magnitude = probabilityMagnitude(peak)
        let points = rows.enumerated().map { index, row in
            let rowChance = row.rainChance ?? snapshot.rainChance
            let chance = index == 0 ? max(snapshot.rainChance, rowChance) : rowChance
            return point(
                row,
                magnitude: probabilityMagnitude(chance),
                symbol: isPrecipitationCondition(row.conditionCode) ? precipitationSymbol(row.conditionCode) : "drop.fill",
                isEvent: index == eventIndex,
                planWindow: planWindow
            )
        }
        let accessibility: String
        if observedPrecipitation {
            let kind = observedSnow ? "Snow" : "Rain"
            accessibility = peak > 0 ? "\(kind) now, peak chance \(peak) percent" : "\(kind) now"
        } else if currentChanceIsMeaningful {
            accessibility = "Rain chance now, \(peak) percent"
        } else if let event {
            accessibility = "\(headline) near \(event.timeLabel), peak chance \(peak) percent"
        } else if peak > 0 {
            accessibility = "Low rain chance, peaking at \(peak) percent"
        } else if let last {
            accessibility = "Dry through \(last.timeLabel)"
        } else {
            accessibility = "No rain in the available forecast"
        }

        return NearcastVisualSignal(
            kind: .rain,
            tone: tone,
            symbolName: symbol,
            headline: headline,
            detail: detail,
            context: nil,
            eventTimeLabel: eventTimeLabel,
            eventStartsAt: eventStartsAt,
            magnitude: magnitude,
            timelinePoints: points,
            timeWindow: planWindow,
            planVerdict: nil,
            isActionable: observedPrecipitation || currentChanceIsMeaningful || firstPrecipitationIndex != nil,
            accessibilityDescription: accessibility
        )
    }

    private static func windSignal(
        _ snapshot: NearcastWidgetSnapshot,
        rows: [NearcastWidgetHour],
        planWindow: NearcastVisualTimeWindow?
    ) -> NearcastVisualSignal {
        let usesMetric = snapshot.windUnit.lowercased().contains("km")
        let strongThreshold = usesMetric ? 40 : 25
        let pickupFloor = usesMetric ? 32 : 20
        let pickupDelta = usesMetric ? 16 : 10
        let visualMaximum = usesMetric ? 65 : 40
        let values = rows.map { $0.windGust ?? $0.wind ?? snapshot.wind }
        let peak = max(snapshot.wind, values.max() ?? 0)
        let pickupThreshold = max(pickupFloor, snapshot.wind + pickupDelta)
        let eventIndex = values.firstIndex(where: { $0 >= pickupThreshold })
            ?? values.firstIndex(of: peak)
        let event = eventIndex.flatMap { rows.indices.contains($0) ? rows[$0] : nil }
        let hasGusts = rows.contains { $0.windGust != nil }
        let title = hasGusts ? "Gusts" : "Wind"
        let magnitude = speedMagnitude(peak, unit: snapshot.windUnit, visualMaximum: visualMaximum)
        let points = rows.enumerated().map { index, row in
            let value = row.windGust ?? row.wind ?? snapshot.wind
            return point(
                row,
                magnitude: speedMagnitude(value, unit: snapshot.windUnit, visualMaximum: visualMaximum),
                symbol: "wind",
                isEvent: index == eventIndex,
                planWindow: planWindow
            )
        }
        let accessibility = event.map {
            "\(title) reach \(peak) \(snapshot.windUnit) near \($0.timeLabel)"
        } ?? "\(title) \(peak) \(snapshot.windUnit)"

        return NearcastVisualSignal(
            kind: .wind,
            tone: peak >= strongThreshold ? .wind : .calm,
            symbolName: "wind",
            headline: title,
            detail: event.map { "Near \($0.timeLabel)" },
            context: snapshot.windLabel,
            eventTimeLabel: event?.timeLabel,
            eventStartsAt: event?.startsAt,
            magnitude: magnitude,
            timelinePoints: points,
            timeWindow: planWindow,
            planVerdict: nil,
            isActionable: peak >= strongThreshold || values.contains(where: { $0 >= pickupThreshold }),
            accessibilityDescription: accessibility
        )
    }

    private static func temperatureSignal(
        _ snapshot: NearcastWidgetSnapshot,
        rows: [NearcastWidgetHour],
        planWindow: NearcastVisualTimeWindow?,
        now: Date
    ) -> NearcastVisualSignal {
        let temperatureRows = rows.filter { $0.temperature != nil }
        let event = temperatureRows.max {
            abs(($0.temperature ?? snapshot.temperature) - snapshot.temperature)
                < abs(($1.temperature ?? snapshot.temperature) - snapshot.temperature)
        }
        let target = event?.temperature ?? snapshot.temperature
        let delta = target - snapshot.temperature
        let usesMetric = usesMetricTemperature(snapshot)
        let hotThreshold = usesMetric ? 35 : 95
        let coldThreshold = usesMetric ? 0 : 32
        let trendThreshold = usesMetric ? 5 : 8
        let absoluteRange = usesMetric ? (-30, 50) : (-20, 120)
        let isHot = snapshot.feelsLike >= hotThreshold
        let isCold = snapshot.feelsLike <= coldThreshold
        let isTrend = abs(delta) >= trendThreshold
        let headline: String
        let detail: String?
        let symbol: String
        let tone: NearcastVisualSignalTone
        let magnitudeValue: Int
        let eventTimeLabel: String?
        let eventStartsAt: TimeInterval?

        if isHot || isCold {
            headline = "Feels \(snapshot.feelsLike)°"
            detail = isHot ? "Heat" : "Freezing"
            symbol = isHot ? "thermometer.sun.fill" : "thermometer.snowflake"
            tone = isHot ? .warm : .cool
            magnitudeValue = snapshot.feelsLike
            eventTimeLabel = "Now"
            eventStartsAt = now.timeIntervalSince1970
        } else if isTrend {
            headline = delta > 0 ? "Warmer" : "Cooler"
            detail = event.map { "By \($0.timeLabel)" }
            symbol = delta > 0 ? "thermometer.sun.fill" : "thermometer.snowflake"
            tone = delta > 0 ? .warm : .cool
            magnitudeValue = target
            eventTimeLabel = event?.timeLabel
            eventStartsAt = event?.startsAt
        } else {
            headline = "Temperature"
            detail = nil
            symbol = "thermometer.medium"
            tone = .calm
            magnitudeValue = snapshot.temperature
            eventTimeLabel = nil
            eventStartsAt = nil
        }

        let temperatures = temperatureRows.compactMap(\.temperature)
        let minimum = temperatures.min() ?? snapshot.temperature
        let maximum = temperatures.max() ?? snapshot.temperature
        let points = rows.enumerated().map { index, row in
            let value = row.temperature ?? snapshot.temperature
            return point(
                row,
                magnitude: temperatureMagnitude(value, minimum: minimum, maximum: maximum),
                symbol: temperatureSymbol(value: value, baseline: snapshot.temperature),
                isEvent: isTrend && row.id == event?.id,
                planWindow: planWindow
            )
        }
        let accessibility: String
        if isHot || isCold {
            accessibility = "Feels like \(snapshot.feelsLike) degrees now, \(isHot ? "hot" : "freezing")"
        } else if isTrend, let event {
            accessibility = "\(headline) by \(event.timeLabel), \(target) degrees"
        } else {
            accessibility = "Temperature \(snapshot.temperature) degrees, little change expected"
        }

        return NearcastVisualSignal(
            kind: .temperature,
            tone: tone,
            symbolName: symbol,
            headline: headline,
            detail: detail,
            context: nil,
            eventTimeLabel: eventTimeLabel,
            eventStartsAt: eventStartsAt,
            magnitude: temperatureMagnitude(
                magnitudeValue,
                minimum: absoluteRange.0,
                maximum: absoluteRange.1
            ),
            timelinePoints: points,
            timeWindow: planWindow,
            planVerdict: nil,
            isActionable: isHot || isCold || isTrend,
            accessibilityDescription: accessibility
        )
    }

    private static func conditionSignal(
        _ snapshot: NearcastWidgetSnapshot,
        rows: [NearcastWidgetHour],
        planWindow: NearcastVisualTimeWindow?
    ) -> NearcastVisualSignal {
        let currentGroup = conditionGroup(snapshot.conditionCode)
        let eventIndex = rows.indices.dropFirst().first { index in
            guard let code = rows[index].conditionCode else { return false }
            return conditionGroup(code) != currentGroup
        }
        let event = eventIndex.map { rows[$0] }
        let eventCode = event?.conditionCode
        let headline = eventCode.map(transitionLabel) ?? snapshot.condition
        let symbol = eventCode.map {
            conditionSymbol($0, isDay: event?.isDay ?? snapshot.isDay)
        } ?? conditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay)
        let points = rows.enumerated().map { index, row in
            let code = row.conditionCode ?? snapshot.conditionCode
            return point(
                row,
                magnitude: nil,
                symbol: conditionSymbol(code, isDay: row.isDay ?? snapshot.isDay),
                isEvent: index == eventIndex,
                planWindow: planWindow
            )
        }
        let accessibility = event.map {
            "\(headline) near \($0.timeLabel), changing from \(snapshot.condition.lowercased())"
        } ?? "\(snapshot.condition), no meaningful condition change in the next few hours"

        return NearcastVisualSignal(
            kind: .condition,
            tone: eventCode.map(toneForCondition) ?? .calm,
            symbolName: symbol,
            headline: headline,
            detail: event.map { "Near \($0.timeLabel)" },
            context: snapshot.condition,
            eventTimeLabel: event?.timeLabel,
            eventStartsAt: event?.startsAt,
            magnitude: nil,
            timelinePoints: points,
            timeWindow: planWindow,
            planVerdict: nil,
            isActionable: event != nil,
            accessibilityDescription: accessibility
        )
    }

    private static func steadySignal(
        _ snapshot: NearcastWidgetSnapshot,
        rows: [NearcastWidgetHour],
        planWindow: NearcastVisualTimeWindow?
    ) -> NearcastVisualSignal {
        let last = rows.last
        let absoluteRange = usesMetricTemperature(snapshot) ? (-30, 50) : (-20, 120)
        let points = rows.map { row in
            let code = row.conditionCode ?? snapshot.conditionCode
            return point(
                row,
                magnitude: row.temperature.map {
                    temperatureMagnitude($0, minimum: absoluteRange.0, maximum: absoluteRange.1)
                },
                symbol: conditionSymbol(code, isDay: row.isDay ?? snapshot.isDay),
                isEvent: false,
                planWindow: planWindow
            )
        }
        let throughText = last.map { "Through \($0.timeLabel)" }
        let accessibility = throughText.map {
            "Steady \($0.lowercased()), \(snapshot.condition), \(snapshot.temperature) degrees"
        } ?? "Steady, \(snapshot.condition), \(snapshot.temperature) degrees"

        return NearcastVisualSignal(
            kind: .steady,
            tone: .calm,
            symbolName: conditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay),
            headline: "Steady",
            detail: throughText,
            context: snapshot.condition,
            eventTimeLabel: last?.timeLabel,
            eventStartsAt: last?.startsAt,
            magnitude: temperatureMagnitude(
                snapshot.temperature,
                minimum: absoluteRange.0,
                maximum: absoluteRange.1
            ),
            timelinePoints: points,
            timeWindow: planWindow,
            planVerdict: nil,
            isActionable: false,
            accessibilityDescription: accessibility
        )
    }

    private static func planSignal(
        _ snapshot: NearcastWidgetSnapshot,
        timeWindow: NearcastVisualTimeWindow?
    ) -> NearcastVisualSignal? {
        guard snapshot.hasPlan else { return nil }
        let context = clean(snapshot.planTitle) ?? clean(snapshot.planLabel) ?? "Watched plan"
        let toneText = (clean(snapshot.watchTone) ?? clean(snapshot.planTone) ?? "").lowercased()
        let labelText = (clean(snapshot.planLabel) ?? clean(snapshot.watchStatus) ?? "").lowercased()
        let verdict: NearcastVisualPlanVerdict
        let symbol: String
        let tone: NearcastVisualSignalTone

        if toneText.contains("changed") || labelText == "changed" || toneText.contains("danger") || toneText.contains("bad") {
            verdict = .change
            symbol = "exclamationmark.triangle.fill"
            tone = .change
        } else if toneText.contains("watch") || toneText.contains("caution") {
            verdict = .watch
            symbol = "eye.fill"
            tone = .watch
        } else if toneText.contains("good") || toneText.contains("safe") || toneText.contains("clear") {
            verdict = .go
            symbol = "checkmark.circle.fill"
            tone = .go
        } else {
            verdict = .check
            symbol = "questionmark.circle.fill"
            tone = .neutral
        }

        let detail = clean(snapshot.watchDetail)
            ?? clean(snapshot.planDetail)
            ?? "Open Nearcast for the latest check"
        return NearcastVisualSignal(
            kind: .plan,
            tone: tone,
            symbolName: symbol,
            headline: verdict.rawValue,
            detail: detail,
            context: context,
            eventTimeLabel: nil,
            eventStartsAt: timeWindow?.startAt,
            magnitude: nil,
            timelinePoints: [],
            timeWindow: timeWindow,
            planVerdict: verdict,
            isActionable: verdict == .change || verdict == .watch,
            accessibilityDescription: "\(context), \(verdict.rawValue), \(detail)"
        )
    }

    private static func planWeatherSignal(
        _ snapshot: NearcastWidgetSnapshot,
        rain: NearcastVisualSignal,
        wind: NearcastVisualSignal,
        temperature: NearcastVisualSignal,
        steady: NearcastVisualSignal
    ) -> NearcastVisualSignal? {
        // planPlace is only populated when the top watched plan is not for the
        // active forecast place. Its weather cannot honestly share this ribbon.
        guard clean(snapshot.planPlace) == nil,
              let risk = clean(snapshot.planRisk)?.lowercased() else { return nil }

        switch risk {
        case "rain", "flood", "storm":
            return rain
        case "wind":
            return wind
        case "heat", "cold":
            return temperature
        case "good":
            return steady
        default:
            // Air quality, pollen, and unknown risks do not exist in the
            // hourly Watch snapshot. Keep the concise textual reason instead.
            return nil
        }
    }

    static func activeTimelineRows(
        _ snapshot: NearcastWidgetSnapshot,
        now: Date,
        maximumHours: Int
    ) -> [NearcastWidgetHour] {
        let allRows = snapshot.timeline ?? []
        guard !allRows.isEmpty else { return [] }

        let timestamp = now.timeIntervalSince1970
        let currentIndex = allRows.indices.last { index in
            guard let startsAt = allRows[index].startsAt else { return false }
            return startsAt <= timestamp
        }
        let startIndex = currentIndex ?? allRows.indices.first(where: {
            guard let startsAt = allRows[$0].startsAt else { return true }
            return startsAt > timestamp
        }) ?? allRows.startIndex
        let selected = Array(allRows[startIndex...].prefix(max(1, maximumHours)))

        // Offset zero means "Now" throughout the visual grammar. Rebase a
        // cached timeline after the hour changes so the current row stays Now.
        return selected.enumerated().map { offset, source in
            var row = source
            row.offsetHours = offset
            return row
        }
    }

    private static func point(
        _ row: NearcastWidgetHour,
        magnitude: NearcastVisualMagnitude?,
        symbol: String,
        isEvent: Bool,
        planWindow: NearcastVisualTimeWindow?
    ) -> NearcastVisualTimelinePoint {
        NearcastVisualTimelinePoint(
            offsetHours: row.offsetHours,
            timeLabel: row.offsetHours == 0 ? "Now" : row.timeLabel,
            startsAt: row.startsAt,
            magnitude: magnitude,
            temperature: row.temperature,
            conditionCode: row.conditionCode,
            symbolName: symbol,
            isEvent: isEvent,
            isInPlanWindow: planWindow?.contains(row.startsAt) ?? false
        )
    }

    private static func probabilityMagnitude(_ value: Int) -> NearcastVisualMagnitude {
        NearcastVisualMagnitude(
            kind: .probability,
            value: value,
            unit: "%",
            normalizedValue: clamp(Double(value) / 100)
        )
    }

    private static func speedMagnitude(_ value: Int, unit: String, visualMaximum: Int) -> NearcastVisualMagnitude {
        NearcastVisualMagnitude(
            kind: .speed,
            value: value,
            unit: unit,
            normalizedValue: clamp(Double(value) / Double(max(1, visualMaximum)))
        )
    }

    private static func temperatureMagnitude(_ value: Int, minimum: Int, maximum: Int) -> NearcastVisualMagnitude {
        let span = max(1, maximum - minimum)
        let normalized = maximum == minimum ? 0.5 : Double(value - minimum) / Double(span)
        return NearcastVisualMagnitude(
            kind: .temperature,
            value: value,
            unit: "°",
            normalizedValue: clamp(normalized)
        )
    }

    private static func temperatureSymbol(value: Int, baseline: Int) -> String {
        if value >= baseline + 4 { return "thermometer.sun.fill" }
        if value <= baseline - 4 { return "thermometer.snowflake" }
        return "thermometer.medium"
    }

    private static func usesMetricTemperature(_ snapshot: NearcastWidgetSnapshot) -> Bool {
        snapshot.windUnit.lowercased().contains("km")
    }

    private static func clean(_ value: String?) -> String? {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func clamp(_ value: Double) -> Double {
        min(1, max(0, value))
    }

    private enum ConditionGroup: Equatable {
        case clear, cloud, fog, rain, snow, storm
    }

    private static func conditionGroup(_ code: Int) -> ConditionGroup {
        if code <= 1 { return .clear }
        if code <= 3 { return .cloud }
        if code <= 48 { return .fog }
        if code <= 67 { return .rain }
        if code <= 77 { return .snow }
        if code <= 82 { return .rain }
        if code <= 86 { return .snow }
        return .storm
    }

    private static func isPrecipitationCondition(_ code: Int?) -> Bool {
        guard let code else { return false }
        return (51...77).contains(code) || (80...86).contains(code) || (95...99).contains(code)
    }

    private static func isSnowCondition(_ code: Int?) -> Bool {
        guard let code else { return false }
        return (71...77).contains(code) || (85...86).contains(code)
    }

    private static func precipitationSymbol(_ code: Int?) -> String {
        guard let code else { return "cloud.rain.fill" }
        if isSnowCondition(code) { return "cloud.snow.fill" }
        if (95...99).contains(code) { return "cloud.bolt.rain.fill" }
        return "cloud.rain.fill"
    }

    private static func conditionSymbol(_ code: Int, isDay: Bool) -> String {
        switch conditionGroup(code) {
        case .clear: return isDay ? "sun.max.fill" : "moon.stars.fill"
        case .cloud: return isDay ? "cloud.sun.fill" : "cloud.moon.fill"
        case .fog: return "cloud.fog.fill"
        case .rain: return "cloud.rain.fill"
        case .snow: return "cloud.snow.fill"
        case .storm: return "cloud.bolt.rain.fill"
        }
    }

    private static func transitionLabel(_ code: Int) -> String {
        switch conditionGroup(code) {
        case .clear: return "Clearing"
        case .cloud: return "Clouds"
        case .fog: return "Fog"
        case .rain: return "Rain"
        case .snow: return "Snow"
        case .storm: return "Storms"
        }
    }

    private static func toneForCondition(_ code: Int) -> NearcastVisualSignalTone {
        switch conditionGroup(code) {
        case .rain, .storm: return .rain
        case .snow: return .cool
        default: return .calm
        }
    }
}
