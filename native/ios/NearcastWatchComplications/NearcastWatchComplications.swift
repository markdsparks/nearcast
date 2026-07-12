import SwiftUI
import WidgetKit

private let nextKind = "NearcastWatchNext"
private let planKind = "NearcastWatchPlan"
private let rainKind = "NearcastWatchRain"
private let briefKind = "NearcastWatchBrief"
private let staleAfter: TimeInterval = 2 * 60 * 60

private enum WeatherDataState: Equatable {
    case placeholder
    case unavailable
    case fresh
    case stale
}

private enum PlanDataState: Equatable {
    case placeholder
    case unavailable
    case empty
    case fresh
    case stale
}

private struct NearcastComplicationEntry: TimelineEntry {
    let date: Date
    let snapshot: NearcastWidgetSnapshot
    let weatherState: WeatherDataState
    let planState: PlanDataState
    let relevance: TimelineEntryRelevance?
}

private struct NearcastComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> NearcastComplicationEntry {
        makeEntry(date: Date(), snapshot: .fallback, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (NearcastComplicationEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        completion(makeEntry(date: Date(), snapshot: .current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NearcastComplicationEntry>) -> Void) {
        Task {
            let cached = NearcastWidgetSnapshot.stored()
            let snapshot = await NearcastWatchWeatherRefresh.refresh(fallback: cached ?? .fallback) ?? cached ?? .fallback
            let now = Date()
            let offsets = [0, 30, 60, 90, 120, 180]
            let entries = offsets.map { minutes in
                let date = now.addingTimeInterval(TimeInterval(minutes * 60))
                return makeEntry(
                    date: date,
                    snapshot: projectedSnapshot(snapshot, at: date, relativeTo: now)
                )
            }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
        }
    }
}

@main
struct NearcastWatchComplicationBundle: WidgetBundle {
    var body: some Widget {
        NearcastNextComplication()
        NearcastPlanComplication()
        NearcastRainComplication()
        NearcastBriefWidget()
    }
}

struct NearcastNextComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: nextKind, provider: NearcastComplicationProvider()) { entry in
            NearcastNextComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("next"))
        }
        .configurationDisplayName("Nearcast Next")
        .description("The meaningful weather change coming next.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastPlanComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: planKind, provider: NearcastComplicationProvider()) { entry in
            NearcastPlanComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("plan"))
        }
        .configurationDisplayName("Plan Check")
        .description("Whether your watched plan is still okay.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastRainComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: rainKind, provider: NearcastComplicationProvider()) { entry in
            NearcastRainComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("rain"))
        }
        .configurationDisplayName("Rain Next")
        .description("When rain starts and how likely it is.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastBriefWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: briefKind, provider: NearcastComplicationProvider()) { entry in
            NearcastBriefView(entry: entry)
                .widgetURL(nearcastComplicationURL("brief"))
        }
        .configurationDisplayName("Nearcast Brief")
        .description("The most relevant weather or plan signal right now.")
        .supportedFamilies([.accessoryRectangular])
    }
}

private struct NearcastNextComplicationView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.showsWidgetLabel) private var showsWidgetLabel
    let entry: NearcastComplicationEntry

    @ViewBuilder
    var body: some View {
        if entry.weatherState == .placeholder {
            ComplicationStateView(
                family: family,
                symbol: "cloud.sun.fill",
                title: "Weather next",
                detail: "Nearcast",
                cornerLabel: "WEATHER NEXT",
                showsWidgetLabel: showsWidgetLabel
            )
            .redacted(reason: .placeholder)
        } else if entry.weatherState == .unavailable {
            unavailableState(family: family, showsWidgetLabel: showsWidgetLabel)
        } else if entry.weatherState == .stale {
            staleState(entry: entry, family: family, showsWidgetLabel: showsWidgetLabel, subject: "weather")
        } else {
            freshBody
        }
    }

    @ViewBuilder
    private var freshBody: some View {
        let signal = visualSignalSet(entry).primaryWeather
        let instrument = instrumentSignal(signal)
        switch family {
        case .accessoryInline:
            Label(inlineText(signal), systemImage: signal.symbolName)
                .accessibilityLabel("Nearcast Next, \(signal.accessibilityDescription)")
        case .accessoryCircular:
            NearcastSignalDial(signal: instrument)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Nearcast Next")
            .accessibilityValue(signal.accessibilityDescription)
        case .accessoryCorner:
            NearcastSignalDial(signal: instrument, compact: true, showsPlainValue: false)
                .widgetLabel { Text(cornerText(signal)) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Nearcast Next")
            .accessibilityValue(signal.accessibilityDescription)
        default:
            NearcastWeatherInstrument(signal: instrument)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Nearcast Next")
            .accessibilityValue(signal.accessibilityDescription)
        }
    }
}

private struct NearcastPlanComplicationView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.showsWidgetLabel) private var showsWidgetLabel
    let entry: NearcastComplicationEntry

    @ViewBuilder
    var body: some View {
        switch entry.planState {
        case .placeholder:
            ComplicationStateView(
                family: family,
                symbol: "checkmark.circle.fill",
                title: "Plan Check",
                detail: "Watching",
                cornerLabel: "PLAN CHECK",
                showsWidgetLabel: showsWidgetLabel
            )
            .redacted(reason: .placeholder)
        case .unavailable:
            unavailableState(family: family, showsWidgetLabel: showsWidgetLabel)
        case .empty:
            planEmptyState(family: family, showsWidgetLabel: showsWidgetLabel)
        case .stale:
            staleState(entry: entry, family: family, showsWidgetLabel: showsWidgetLabel, subject: "plan")
        case .fresh:
            freshBody
        }
    }

    @ViewBuilder
    private var freshBody: some View {
        if let plan = visualSignalSet(entry).plan {
            switch family {
            case .accessoryInline:
                Label(planInlineText(plan, risk: entry.snapshot.planRisk), systemImage: plan.symbolName)
                    .accessibilityLabel("Plan Check, \(plan.accessibilityDescription)")
            case .accessoryCircular:
                NearcastPlanMark(plan: plan)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Plan Check")
                .accessibilityValue(plan.accessibilityDescription)
            case .accessoryCorner:
                NearcastPlanMark(plan: plan, compact: true)
                    .widgetLabel { Text(cornerText(plan)) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Plan Check")
                .accessibilityValue(plan.accessibilityDescription)
            default:
                NearcastPlanInstrument(plan: plan, risk: entry.snapshot.planRisk)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Plan Check")
                .accessibilityValue(plan.accessibilityDescription)
            }
        } else {
            planEmptyState(family: family, showsWidgetLabel: showsWidgetLabel)
        }
    }
}

private struct NearcastRainComplicationView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.showsWidgetLabel) private var showsWidgetLabel
    let entry: NearcastComplicationEntry

    @ViewBuilder
    var body: some View {
        if entry.weatherState == .placeholder {
            ComplicationStateView(
                family: family,
                symbol: "drop.fill",
                title: "Rain next",
                detail: "Next 4 hours",
                cornerLabel: "RAIN NEXT",
                showsWidgetLabel: showsWidgetLabel
            )
            .redacted(reason: .placeholder)
        } else if entry.weatherState == .unavailable {
            unavailableState(family: family, showsWidgetLabel: showsWidgetLabel)
        } else if entry.weatherState == .stale {
            staleState(entry: entry, family: family, showsWidgetLabel: showsWidgetLabel, subject: "weather")
        } else {
            freshBody
        }
    }

    @ViewBuilder
    private var freshBody: some View {
        let rain = NearcastVisualSignalModel.rain(snapshot: entry.snapshot, now: entry.date, horizonHours: 4)
        let instrument = instrumentSignal(rain)
        switch family {
        case .accessoryInline:
            Label(inlineText(rain), systemImage: rain.symbolName)
                .accessibilityLabel("Rain Next, \(rain.accessibilityDescription)")
        case .accessoryCircular:
            NearcastSignalDial(signal: instrument)
            .accessibilityLabel("Rain Next")
            .accessibilityValue(rain.accessibilityDescription)
        case .accessoryCorner:
            NearcastSignalDial(signal: instrument, compact: true, showsPlainValue: false)
                .widgetLabel { Text(cornerText(rain)) }
            .accessibilityLabel("Rain Next")
            .accessibilityValue(rain.accessibilityDescription)
        default:
            NearcastWeatherInstrument(signal: instrument)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Rain Next")
            .accessibilityValue(rain.accessibilityDescription)
        }
    }
}

private struct NearcastBriefView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: NearcastComplicationEntry

    var body: some View {
        Group {
            if entry.weatherState == .placeholder {
                briefPlaceholder
            } else if entry.weatherState == .unavailable {
                briefUnavailable
            } else if entry.weatherState == .stale {
                briefStale
            } else {
                briefFresh
            }
        }
        .containerBackground(for: .widget) {
            if renderingMode == .fullColor {
                briefBackground(entry)
            } else {
                Color.clear
            }
        }
    }

    private var briefPlaceholder: some View {
        HStack(spacing: 9) {
            Image(systemName: "cloud.sun.fill")
                .font(.system(size: 25, weight: .semibold))
            Text("Weather next")
                .font(.system(size: 17, weight: .bold, design: .rounded))
        }
        .redacted(reason: .placeholder)
    }

    private var briefUnavailable: some View {
        HStack(spacing: 9) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.system(size: 24, weight: .semibold))
                .widgetAccentable()
            Text("Open iPhone")
                .font(.system(size: 17, weight: .bold, design: .rounded))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nearcast Brief unavailable")
        .accessibilityValue("Open Nearcast on iPhone and choose a place")
    }

    private var briefStale: some View {
        HStack(spacing: 9) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 24, weight: .bold))
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 1) {
                Text("Update needed")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                Text(weatherAgeText(entry))
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nearcast Brief needs an update")
        .accessibilityValue(weatherAgeText(entry))
    }

    @ViewBuilder
    private var briefFresh: some View {
        let signals = visualSignalSet(entry)
        let content = entry.planState == .fresh ? signals.primary : signals.primaryWeather
        Group {
            if content.kind == .plan {
                NearcastPlanInstrument(plan: content, risk: entry.snapshot.planRisk)
            } else {
                NearcastWeatherInstrument(signal: instrumentSignal(content))
            }
        }
        .foregroundStyle(renderingMode == .fullColor ? Color.white : Color.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nearcast Brief")
        .accessibilityValue(content.accessibilityDescription)
    }
}

private struct ComplicationStateView: View {
    let family: WidgetFamily
    let symbol: String
    let title: String
    let detail: String
    let cornerLabel: String
    let showsWidgetLabel: Bool

    @ViewBuilder
    var body: some View {
        switch family {
        case .accessoryInline:
            Label(title, systemImage: symbol)
        case .accessoryCircular:
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .bold))
                .widgetAccentable()
        case .accessoryCorner:
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .bold))
                .widgetAccentable()
            .widgetLabel { Text(cornerLabel) }
        default:
            HStack(spacing: 9) {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .bold))
                    .widgetAccentable()
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .lineLimit(1)
                    Text(detail)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

private enum NearcastInstrumentEncoding {
    case rain(probability: Int)
    case wind(speed: Int, ceiling: Int)
    case symbol
}

private struct NearcastInstrumentSignal {
    let symbol: String
    let primary: String
    let secondary: String
    let encoding: NearcastInstrumentEncoding
    let trail: [Double]
}

private struct NearcastSignalDial: View {
    let signal: NearcastInstrumentSignal
    var compact = false
    var showsPlainValue = true

    @ViewBuilder
    var body: some View {
        switch signal.encoding {
        case .rain(let probability):
            Gauge(value: Double(probability), in: 0...100) {
                Image(systemName: signal.symbol)
            } currentValueLabel: {
                Text("\(probability)%")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
            }
            .gaugeStyle(.accessoryCircular)
            .widgetAccentable()
        case .wind(let speed, let ceiling):
            Gauge(value: Double(speed), in: 0...Double(max(1, ceiling))) {
                Image(systemName: signal.symbol)
            } currentValueLabel: {
                Text("\(speed)")
                    .font(.system(size: compact ? 12 : 14, weight: .bold, design: .rounded))
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
        case .symbol:
            ZStack {
                Circle()
                    .stroke(.secondary.opacity(0.35), lineWidth: compact ? 2 : 3)
                VStack(spacing: 0) {
                    Image(systemName: signal.symbol)
                        .font(.system(size: showsPlainValue ? (compact ? 15 : 18) : 21, weight: .bold))
                        .widgetAccentable()
                    if showsPlainValue {
                        Text(signal.primary)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .lineLimit(1)
                    }
                }
            }
        }
    }
}

private struct NearcastWeatherInstrument: View {
    let signal: NearcastInstrumentSignal

    var body: some View {
        HStack(spacing: 8) {
            NearcastSignalDial(signal: signal, compact: true, showsPlainValue: false)
                .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 0) {
                Text(signal.primary)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.75)
                    .lineLimit(1)
                if !signal.secondary.isEmpty {
                    Text(signal.secondary)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .layoutPriority(1)
            Spacer(minLength: 0)
            if signal.trail.count > 1 {
                NearcastTrail(
                    values: signal.trail,
                    style: signal.encoding.isRain ? .rainBars : .line
                )
                    .frame(width: 48, height: 30)
            }
        }
    }
}

private enum NearcastTrailStyle {
    case rainBars
    case line
}

private struct NearcastTrail: View {
    let values: [Double]
    let style: NearcastTrailStyle

    var body: some View {
        let visible = Array(values.prefix(4)).map { min(1, max(0, $0)) }
        let peakIndex = visible.indices.max(by: { visible[$0] < visible[$1] }) ?? 0
        GeometryReader { proxy in
            let width = max(1, proxy.size.width - 6)
            let height = max(1, proxy.size.height - 6)
            let step = visible.count > 1 ? width / CGFloat(visible.count - 1) : 0
            let positions = visible.indices.map { index in
                CGPoint(
                    x: 3 + (CGFloat(index) * step),
                    y: 3 + ((1 - CGFloat(visible[index])) * height)
                )
            }
            switch style {
            case .rainBars:
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(visible.indices, id: \.self) { index in
                        Capsule()
                            .fill(index == peakIndex ? Color.accentColor : Color.secondary.opacity(0.55))
                            .frame(maxWidth: .infinity)
                            .frame(height: max(3, CGFloat(visible[index]) * proxy.size.height))
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            case .line:
                ZStack {
                    Path { path in
                        guard let first = positions.first else { return }
                        path.move(to: first)
                        for point in positions.dropFirst() {
                            path.addLine(to: point)
                        }
                    }
                    .stroke(.secondary.opacity(0.55), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    ForEach(positions.indices, id: \.self) { index in
                        Circle()
                            .fill(index == peakIndex ? Color.accentColor : Color.secondary)
                            .frame(width: index == peakIndex ? 7 : 5, height: index == peakIndex ? 7 : 5)
                            .position(positions[index])
                    }
                }
            }
        }
        .widgetAccentable()
        .accessibilityHidden(true)
    }
}

private extension NearcastInstrumentEncoding {
    var isRain: Bool {
        if case .rain = self { return true }
        return false
    }
}

private struct NearcastPlanMark: View {
    let plan: NearcastVisualSignal
    var compact = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(.secondary.opacity(0.35), lineWidth: compact ? 2 : 3)
            Image(systemName: plan.symbolName)
                .font(.system(size: compact ? 19 : 25, weight: .bold))
                .widgetAccentable()
        }
    }
}

private struct NearcastPlanInstrument: View {
    let plan: NearcastVisualSignal
    let risk: String?

    var body: some View {
        HStack(spacing: 9) {
            NearcastPlanMark(plan: plan, compact: true)
                .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 0) {
                Text(plan.planVerdict?.rawValue ?? plan.headline)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Text(planComplicationCue(plan, risk: risk))
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .layoutPriority(1)
            Spacer(minLength: 0)
        }
    }
}

private func visualSignalSet(_ entry: NearcastComplicationEntry) -> NearcastVisualSignalSet {
    NearcastVisualSignalModel.make(snapshot: entry.snapshot, now: entry.date, horizonHours: 6)
}

private func instrumentSignal(_ signal: NearcastVisualSignal) -> NearcastInstrumentSignal {
    let encoding: NearcastInstrumentEncoding
    if signal.kind == .rain,
       signal.headline != "Dry",
       (signal.magnitude?.value ?? 0) > 0 {
        encoding = .rain(probability: signal.magnitude?.value ?? 0)
    } else if signal.kind == .wind, let magnitude = signal.magnitude {
        let ceiling: Int
        if magnitude.normalizedValue > 0 {
            ceiling = max(magnitude.value, Int((Double(magnitude.value) / magnitude.normalizedValue).rounded()))
        } else {
            ceiling = max(1, magnitude.value)
        }
        encoding = .wind(speed: magnitude.value, ceiling: ceiling)
    } else {
        encoding = .symbol
    }

    let primary: String
    let secondary: String
    switch signal.kind {
    case .rain:
        if signal.headline == "Dry" {
            primary = "Dry"
            secondary = signal.detail ?? signal.eventTimeLabel ?? ""
        } else {
            primary = signal.eventTimeLabel ?? signal.headline
            secondary = signal.headline
        }
    case .wind:
        primary = signal.headline
        secondary = signal.eventTimeLabel.map { "Near \($0)" }
            ?? signal.magnitude?.displayValue
            ?? ""
    case .temperature:
        primary = signal.magnitude?.displayValue ?? signal.headline
        secondary = signal.eventTimeLabel ?? signal.headline
    case .condition:
        primary = signal.eventTimeLabel ?? signal.headline
        secondary = signal.headline
    case .steady:
        primary = signal.magnitude?.displayValue ?? signal.headline
        secondary = signal.headline
    case .plan:
        primary = signal.planVerdict?.rawValue ?? signal.headline
        secondary = signal.context ?? "Watched plan"
    }

    let trail = signal.timelinePoints.prefix(4).compactMap { $0.magnitude?.normalizedValue }
    let shouldShowTrail = trail.count > 1
        && !(signal.kind == .rain && (signal.magnitude?.value ?? 0) == 0)
        && Set(trail.map { Int(($0 * 100).rounded()) }).count > 1

    return NearcastInstrumentSignal(
        symbol: signal.symbolName,
        primary: primary,
        secondary: secondary == primary ? "" : secondary,
        encoding: encoding,
        trail: shouldShowTrail ? trail : []
    )
}

private func inlineText(_ signal: NearcastVisualSignal) -> String {
    let value = signal.magnitude?.displayValue
    switch signal.kind {
    case .rain:
        if signal.headline == "Dry" {
            return ["Dry", signal.detail].compactMap { $0 }.joined(separator: " · ")
        }
        return [signal.headline, signal.eventTimeLabel, value].compactMap { $0 }.uniqued().joined(separator: " · ")
    case .wind:
        return [signal.headline, value, signal.eventTimeLabel].compactMap { $0 }.uniqued().joined(separator: " · ")
    case .temperature:
        return [value ?? signal.headline, signal.eventTimeLabel].compactMap { $0 }.uniqued().joined(separator: " · ")
    case .condition:
        return [signal.headline, signal.eventTimeLabel].compactMap { $0 }.uniqued().joined(separator: " · ")
    case .steady:
        return [value, "Steady"].compactMap { $0 }.joined(separator: " · ")
    case .plan:
        return signal.planVerdict?.rawValue ?? signal.headline
    }
}

private func cornerText(_ signal: NearcastVisualSignal) -> String {
    let value = signal.magnitude?.displayValue
    switch signal.kind {
    case .rain:
        if signal.headline == "Dry" {
            return ["DRY", signal.eventTimeLabel?.uppercased()].compactMap { $0 }.joined(separator: " · ")
        }
        return (signal.eventTimeLabel ?? "RAIN").uppercased()
    case .wind:
        return [signal.headline.uppercased(), signal.eventTimeLabel?.uppercased()].compactMap { $0 }.joined(separator: " · ")
    case .temperature, .condition:
        return (signal.eventTimeLabel ?? value ?? signal.headline).uppercased()
    case .steady:
        return (value ?? "STEADY").uppercased()
    case .plan:
        return signal.planVerdict?.rawValue ?? signal.headline.uppercased()
    }
}

private func planComplicationCue(_ plan: NearcastVisualSignal, risk: String?) -> String {
    let riskLabel: String?
    switch (risk ?? "").lowercased() {
    case "rain", "flood": riskLabel = "Rain"
    case "storm": riskLabel = "Storm"
    case "wind": riskLabel = "Wind"
    case "heat": riskLabel = "Heat"
    case "cold": riskLabel = "Cold"
    case "air": riskLabel = "Air"
    case "pollen": riskLabel = "Pollen"
    case "good": riskLabel = "Clear"
    default: riskLabel = nil
    }

    if let riskLabel {
        let title = conciseComplicationWords(plan.context, maximumCharacters: 12)
        return [riskLabel, title].compactMap { $0 }.joined(separator: " · ")
    }
    return conciseComplicationWords(plan.detail ?? plan.context, maximumCharacters: 22)
        ?? "Watched plan"
}

private func planInlineText(_ plan: NearcastVisualSignal, risk: String?) -> String {
    let verdict = plan.planVerdict?.rawValue ?? plan.headline
    let reason = planComplicationCue(plan, risk: risk)
        .components(separatedBy: " · ")
        .first
    return [verdict, reason].compactMap { $0 }.uniqued().joined(separator: " · ")
}

private func conciseComplicationWords(_ value: String?, maximumCharacters: Int) -> String? {
    let words = (value ?? "")
        .split(whereSeparator: \.isWhitespace)
        .map(String.init)
    guard !words.isEmpty else { return nil }

    var result = ""
    for word in words {
        let candidate = result.isEmpty ? word : "\(result) \(word)"
        if candidate.count > maximumCharacters { break }
        result = candidate
    }
    if !result.isEmpty { return result }
    return String(words[0].prefix(maximumCharacters))
}

private extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}

private func makeEntry(date: Date, snapshot: NearcastWidgetSnapshot, isPlaceholder: Bool = false) -> NearcastComplicationEntry {
    let weatherState: WeatherDataState
    if isPlaceholder {
        weatherState = .placeholder
    } else if !snapshot.hasWeatherData {
        weatherState = .unavailable
    } else if age(at: date, savedAt: snapshot.weatherSavedTime) > staleAfter {
        weatherState = .stale
    } else {
        weatherState = .fresh
    }

    let planState: PlanDataState
    if isPlaceholder {
        planState = .placeholder
    } else if !snapshot.hasWeatherData && !snapshot.hasPlan {
        planState = .unavailable
    } else if !snapshot.hasPlan || snapshot.planAvailable == false {
        planState = .empty
    } else if age(at: date, savedAt: snapshot.planSavedTime) > staleAfter {
        planState = .stale
    } else {
        planState = .fresh
    }

    return NearcastComplicationEntry(
        date: date,
        snapshot: snapshot,
        weatherState: weatherState,
        planState: planState,
        relevance: isPlaceholder ? nil : briefRelevance(
            snapshot: snapshot,
            at: date,
            weatherState: weatherState,
            planState: planState
        )
    )
}

private func projectedSnapshot(_ base: NearcastWidgetSnapshot, at date: Date, relativeTo now: Date) -> NearcastWidgetSnapshot {
    guard let timeline = base.timeline, !timeline.isEmpty else { return base }
    let rows: [NearcastWidgetHour]
    if timeline.contains(where: { $0.startsAt != nil }) {
        let timestamp = date.timeIntervalSince1970
        let activeIndex = timeline.lastIndex(where: { ($0.startsAt ?? .infinity) <= timestamp }) ?? 0
        rows = Array(timeline.suffix(from: activeIndex))
    } else {
        let hoursAhead = max(0, Int(date.timeIntervalSince(now) / 3600))
        rows = timeline.filter { $0.offsetHours >= hoursAhead }
    }
    guard !rows.isEmpty else { return base }
    var projected = base
    projected.timeline = rows.enumerated().map { index, row in
        var shifted = row
        shifted.offsetHours = index
        return shifted
    }
    if let current = projected.timeline?.first {
        projected.temperature = current.temperature ?? projected.temperature
        projected.feelsLike = current.feelsLike ?? projected.feelsLike
        projected.rainChance = current.rainChance ?? projected.rainChance
        projected.wind = current.wind ?? projected.wind
        projected.windDirection = current.windDirection ?? projected.windDirection
        projected.uv = current.uv ?? projected.uv
        projected.conditionCode = current.conditionCode ?? projected.conditionCode
        projected.isDay = current.isDay ?? projected.isDay
        projected.condition = conditionLabel(projected.conditionCode)
    }
    return projected
}

private func briefRelevance(
    snapshot: NearcastWidgetSnapshot,
    at date: Date,
    weatherState: WeatherDataState,
    planState: PlanDataState
) -> TimelineEntryRelevance? {
    guard weatherState == .fresh else { return TimelineEntryRelevance(score: 5, duration: 30 * 60) }
    let signals = NearcastVisualSignalModel.make(snapshot: snapshot, now: date, horizonHours: 6)
    if planState == .fresh && signals.plan?.planVerdict == .change {
        return TimelineEntryRelevance(score: 100, duration: 2 * 60 * 60)
    }
    if planState == .fresh && signals.plan?.planVerdict == .watch {
        return TimelineEntryRelevance(score: 85, duration: 90 * 60)
    }
    let currentRainChance = signals.rain.timelinePoints.first?.magnitude?.value ?? snapshot.rainChance
    if currentRainChance >= 30 {
        return TimelineEntryRelevance(score: 90, duration: 60 * 60)
    }
    if signals.rain.magnitude?.value ?? 0 >= 30 {
        return TimelineEntryRelevance(score: 70, duration: 2 * 60 * 60)
    }
    if planState == .fresh {
        return TimelineEntryRelevance(score: 55, duration: 60 * 60)
    }
    return TimelineEntryRelevance(score: 20, duration: 30 * 60)
}

private func briefBackground(_ entry: NearcastComplicationEntry) -> Color {
    if entry.weatherState == .unavailable || entry.weatherState == .stale {
        return Color(red: 0.12, green: 0.15, blue: 0.20)
    }
    let signals = visualSignalSet(entry)
    if entry.planState == .fresh && signals.plan?.planVerdict == .change {
        return Color(red: 0.68, green: 0.18, blue: 0.12)
    }
    if entry.planState == .fresh && signals.plan?.planVerdict == .watch {
        return Color(red: 0.50, green: 0.28, blue: 0.05)
    }
    if signals.rain.magnitude?.value ?? 0 >= 30 {
        return Color(red: 0.04, green: 0.26, blue: 0.48)
    }
    return Color(red: 0.05, green: 0.32, blue: 0.25)
}

@ViewBuilder
private func unavailableState(family: WidgetFamily, showsWidgetLabel: Bool) -> some View {
    ComplicationStateView(
        family: family,
        symbol: "iphone.and.arrow.forward",
        title: family == .accessoryInline ? "Open Nearcast on iPhone" : "Open iPhone",
        detail: "Set up",
        cornerLabel: "OPEN NEARCAST ON IPHONE",
        showsWidgetLabel: showsWidgetLabel
    )
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Nearcast unavailable")
    .accessibilityValue("Open Nearcast on iPhone and choose a place")
}

@ViewBuilder
private func planEmptyState(family: WidgetFamily, showsWidgetLabel: Bool) -> some View {
    ComplicationStateView(
        family: family,
        symbol: "calendar.badge.plus",
        title: family == .accessoryInline ? "No plan watched" : "Add a plan",
        detail: "On iPhone",
        cornerLabel: "ADD A PLAN IN NEARCAST",
        showsWidgetLabel: showsWidgetLabel
    )
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Plan Check has no watched plan")
    .accessibilityValue("Open Nearcast on iPhone to watch a plan")
}

@ViewBuilder
private func staleState(entry: NearcastComplicationEntry, family: WidgetFamily, showsWidgetLabel: Bool, subject: String) -> some View {
    let detail = subject == "plan" ? planAgeText(entry) : weatherAgeText(entry)
    ComplicationStateView(
        family: family,
        symbol: "arrow.clockwise",
        title: family == .accessoryInline ? "Nearcast · Update needed" : "Update needed",
        detail: detail,
        cornerLabel: "UPDATE NEARCAST · \(detail.uppercased())",
        showsWidgetLabel: showsWidgetLabel
    )
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Nearcast \(subject) needs an update")
    .accessibilityValue(detail)
}

private func weatherAgeText(_ entry: NearcastComplicationEntry) -> String {
    ageText(age(at: entry.date, savedAt: entry.snapshot.weatherSavedTime))
}

private func planAgeText(_ entry: NearcastComplicationEntry) -> String {
    ageText(age(at: entry.date, savedAt: entry.snapshot.planSavedTime))
}

private func ageText(_ age: TimeInterval) -> String {
    guard age.isFinite else { return "No recent update" }
    let hours = max(1, Int(age / 3600))
    return "Updated \(hours)h ago"
}

private func age(at date: Date, savedAt: TimeInterval) -> TimeInterval {
    guard savedAt > 0 else { return .infinity }
    return max(0, date.timeIntervalSince1970 - savedAt)
}

private func nearcastComplicationURL(_ surface: String) -> URL? {
    URL(string: "nearcast://weather?source=watch-complication&surface=\(surface)")
}

private enum NearcastWatchWeatherRefresh {
    private static let coordinator = NearcastWatchWeatherRefreshCoordinator()

    static func refresh(fallback: NearcastWidgetSnapshot) async -> NearcastWidgetSnapshot? {
        await coordinator.refresh(fallback: fallback)
    }

    static func fetch(
        requestedPlace: NearcastWidgetPlace,
        fallback: NearcastWidgetSnapshot
    ) async -> NearcastWidgetSnapshot? {
        let metricUnits = usesMetricUnits(fallback.windUnit)
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.5f", requestedPlace.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.5f", requestedPlace.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m"),
            URLQueryItem(name: "hourly", value: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day"),
            URLQueryItem(name: "temperature_unit", value: metricUnits ? "celsius" : "fahrenheit"),
            URLQueryItem(name: "wind_speed_unit", value: metricUnits ? "kmh" : "mph"),
            URLQueryItem(name: "forecast_hours", value: "8"),
            URLQueryItem(name: "timezone", value: "auto")
        ]
        guard let url = components?.url else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            let forecast = try JSONDecoder().decode(WatchForecast.self, from: data)
            guard let current = forecast.current else { return nil }
            let refreshedAt = Date().timeIntervalSince1970
            var weather = NearcastWidgetSnapshot.fallback
            weather.savedAt = refreshedAt
            weather.weatherSavedAt = refreshedAt
            weather.isAvailable = true
            weather.placeName = requestedPlace.displayLabel
            weather.temperature = Int(current.temperature.rounded())
            weather.feelsLike = Int(current.feelsLike.rounded())
            weather.conditionCode = current.weatherCode
            weather.isDay = current.isDay == 1
            weather.wind = Int(current.windSpeed.rounded())
            weather.windUnit = fallback.windUnit
            weather.windDirection = Int(current.windDirection.rounded())
            weather.condition = conditionLabel(current.weatherCode)
            if let hourly = forecast.hourly {
                let rows = hourly.rows(limit: 8, utcOffsetSeconds: forecast.utcOffsetSeconds ?? 0)
                weather.timeline = rows
                weather.rainChance = rows.first?.rainChance ?? fallback.rainChance
                weather.uv = rows.first?.uv ?? fallback.uv
            }
            return mergeWeather(
                weather,
                into: NearcastWidgetSnapshot.stored() ?? fallback,
                requestedPlace: requestedPlace,
                metricUnits: metricUnits
            )
        } catch {
            return nil
        }
    }

    static func reuse(
        weather: NearcastWidgetSnapshot,
        requestedPlace: NearcastWidgetPlace,
        fallback: NearcastWidgetSnapshot
    ) -> NearcastWidgetSnapshot? {
        mergeWeather(
            weather,
            into: NearcastWidgetSnapshot.stored() ?? fallback,
            requestedPlace: requestedPlace,
            metricUnits: usesMetricUnits(weather.windUnit)
        )
    }

    private static func mergeWeather(
        _ weather: NearcastWidgetSnapshot,
        into latest: NearcastWidgetSnapshot,
        requestedPlace: NearcastWidgetPlace,
        metricUnits: Bool
    ) -> NearcastWidgetSnapshot? {
        guard let currentPlace = NearcastWidgetPlace.stored(), samePlace(currentPlace, requestedPlace) else {
            return nil
        }
        guard usesMetricUnits(latest.windUnit) == metricUnits || !latest.hasWeatherData else {
            return nil
        }

        var updated = latest
        updated.version = max(6, max(updated.version, weather.version))
        if updated.hasPlan, updated.planSavedAt == nil, updated.savedAt > 0 {
            updated.planSavedAt = updated.savedAt
        }
        updated.savedAt = weather.savedAt
        updated.weatherSavedAt = weather.weatherSavedAt
        updated.isAvailable = true
        updated.placeName = requestedPlace.displayLabel
        updated.temperature = weather.temperature
        updated.feelsLike = weather.feelsLike
        updated.condition = weather.condition
        updated.conditionCode = weather.conditionCode
        updated.isDay = weather.isDay
        updated.rainChance = weather.rainChance
        updated.wind = weather.wind
        updated.windUnit = weather.windUnit
        updated.windDirection = weather.windDirection
        updated.windLabel = nil
        updated.uv = weather.uv
        updated.timeline = weather.timeline

        guard let placeBeforeSave = NearcastWidgetPlace.stored(), samePlace(placeBeforeSave, requestedPlace) else {
            return nil
        }
        NearcastWidgetSnapshotStore.save(updated)
        return updated
    }

    private static func samePlace(_ lhs: NearcastWidgetPlace, _ rhs: NearcastWidgetPlace) -> Bool {
        lhs.name == rhs.name
            && abs(lhs.latitude - rhs.latitude) < 0.00001
            && abs(lhs.longitude - rhs.longitude) < 0.00001
    }

    private static func usesMetricUnits(_ windUnit: String) -> Bool {
        windUnit.lowercased().contains("km")
    }
}

private actor NearcastWatchWeatherRefreshCoordinator {
    private struct RecentRefresh {
        let snapshot: NearcastWidgetSnapshot
        let completedAt: Date
    }

    private let reuseWindow: TimeInterval = 45
    private var inFlight: [String: Task<NearcastWidgetSnapshot?, Never>] = [:]
    private var recent: [String: RecentRefresh] = [:]

    func refresh(fallback: NearcastWidgetSnapshot) async -> NearcastWidgetSnapshot? {
        guard let requestedPlace = NearcastWidgetPlace.stored() else { return nil }
        let key = placeKey(requestedPlace)

        if let recent = recent[key], Date().timeIntervalSince(recent.completedAt) <= reuseWindow {
            return NearcastWatchWeatherRefresh.reuse(
                weather: recent.snapshot,
                requestedPlace: requestedPlace,
                fallback: fallback
            )
        }

        if let task = inFlight[key] {
            guard let result = await task.value else { return nil }
            return NearcastWatchWeatherRefresh.reuse(
                weather: result,
                requestedPlace: requestedPlace,
                fallback: fallback
            )
        }

        let task = Task {
            await NearcastWatchWeatherRefresh.fetch(
                requestedPlace: requestedPlace,
                fallback: fallback
            )
        }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        if let result {
            recent[key] = RecentRefresh(snapshot: result, completedAt: Date())
            return NearcastWatchWeatherRefresh.reuse(
                weather: result,
                requestedPlace: requestedPlace,
                fallback: fallback
            )
        }
        return nil
    }

    private func placeKey(_ place: NearcastWidgetPlace) -> String {
        "\(place.name)|\(String(format: "%.5f", place.latitude))|\(String(format: "%.5f", place.longitude))"
    }
}

private struct WatchForecast: Decodable {
    let current: Current?
    let hourly: Hourly?
    let utcOffsetSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case current
        case hourly
        case utcOffsetSeconds = "utc_offset_seconds"
    }

    struct Current: Decodable {
        let temperature: Double
        let feelsLike: Double
        let weatherCode: Int
        let isDay: Int
        let windSpeed: Double
        let windDirection: Double

        enum CodingKeys: String, CodingKey {
            case temperature = "temperature_2m"
            case feelsLike = "apparent_temperature"
            case weatherCode = "weather_code"
            case isDay = "is_day"
            case windSpeed = "wind_speed_10m"
            case windDirection = "wind_direction_10m"
        }
    }

    struct Hourly: Decodable {
        let time: [String]
        let temperature: [Double?]?
        let feelsLike: [Double?]?
        let rainChance: [Int?]?
        let weatherCode: [Int?]?
        let wind: [Double?]?
        let gust: [Double?]?
        let windDirection: [Double?]?
        let uv: [Double?]?
        let isDay: [Int?]?

        enum CodingKeys: String, CodingKey {
            case time
            case temperature = "temperature_2m"
            case feelsLike = "apparent_temperature"
            case rainChance = "precipitation_probability"
            case weatherCode = "weather_code"
            case wind = "wind_speed_10m"
            case gust = "wind_gusts_10m"
            case windDirection = "wind_direction_10m"
            case uv = "uv_index"
            case isDay = "is_day"
        }

        func rows(limit: Int, utcOffsetSeconds: Int) -> [NearcastWidgetHour] {
            let start = 0
            return (start..<min(time.count, start + limit)).map { index in
                NearcastWidgetHour(
                    offsetHours: index - start,
                    timeLabel: shortHour(time[index]),
                    temperature: rounded(temperature?[safe: index] ?? nil),
                    feelsLike: rounded(feelsLike?[safe: index] ?? nil),
                    rainChance: rainChance?[safe: index] ?? nil,
                    wind: rounded(wind?[safe: index] ?? nil),
                    windGust: rounded(gust?[safe: index] ?? nil),
                    windDirection: rounded(windDirection?[safe: index] ?? nil),
                    uv: rounded(uv?[safe: index] ?? nil),
                    conditionCode: weatherCode?[safe: index] ?? nil,
                    isDay: (isDay?[safe: index] ?? nil).map { $0 == 1 },
                    startsAt: hourTimestamp(time[index], utcOffsetSeconds: utcOffsetSeconds)
                )
            }
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private func rounded(_ value: Double?) -> Int? { value.map { Int($0.rounded()) } }

private func shortHour(_ raw: String) -> String {
    guard let hour = Int(raw.split(separator: "T").last?.split(separator: ":").first ?? "") else { return raw }
    if hour == 0 { return "12a" }
    if hour < 12 { return "\(hour)a" }
    if hour == 12 { return "12p" }
    return "\(hour - 12)p"
}

private func hourTimestamp(_ raw: String, utcOffsetSeconds: Int) -> TimeInterval? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: utcOffsetSeconds)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
    return formatter.date(from: raw)?.timeIntervalSince1970
}

private func conditionLabel(_ code: Int) -> String {
    if code == 0 { return "Clear" }
    if code <= 3 { return "Cloudy" }
    if code <= 48 { return "Fog" }
    if code <= 67 { return "Rain" }
    if code <= 77 { return "Snow" }
    if code <= 82 { return "Showers" }
    if code <= 86 { return "Snow showers" }
    return "Storms"
}
