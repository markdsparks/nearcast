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
        let signal = nextSignal(entry.snapshot)
        let rain = rainSignal(entry.snapshot)
        switch family {
        case .accessoryInline:
            Label(signal.inline, systemImage: signal.symbol)
                .accessibilityLabel("Nearcast Next, \(signal.accessibility)")
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: signal.symbol)
                    .font(.system(size: 13, weight: .bold))
                    .widgetAccentable()
                Text(signal.micro)
                    .font(.system(size: signal.micro.count > 4 ? 10 : 14, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if signal.isSteady {
                    Text("STEADY")
                        .font(.system(size: 6, weight: .semibold, design: .rounded))
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Nearcast Next")
            .accessibilityValue(signal.accessibility)
        case .accessoryCorner:
            VStack(spacing: 0) {
                Image(systemName: signal.symbol)
                    .font(.system(size: 15, weight: .bold))
                    .widgetAccentable()
                if !showsWidgetLabel {
                    Text(signal.micro)
                        .font(.system(size: 9, weight: .bold, design: .rounded))
                        .lineLimit(1)
                }
            }
            .widgetLabel { Text(signal.cornerLabel) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Nearcast Next")
            .accessibilityValue(signal.accessibility)
        default:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Image(systemName: signal.symbol).widgetAccentable()
                    Text(signal.headline)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text("\(entry.snapshot.temperature)°")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
                if rain.peak >= 30 {
                    NearcastHorizon(points: rain.points)
                } else {
                    Text(signal.detail)
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Nearcast Next")
            .accessibilityValue(signal.accessibility)
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
        let plan = planSignal(entry.snapshot)
        switch family {
        case .accessoryInline:
            Label(plan.inline, systemImage: plan.symbol)
                .accessibilityLabel("Plan Check, \(plan.accessibility)")
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: plan.symbol)
                    .font(.system(size: 15, weight: .bold))
                    .widgetAccentable()
                Text(plan.verdict)
                    .font(.system(size: plan.verdict.count > 4 ? 8 : 12, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.65)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Plan Check")
            .accessibilityValue(plan.accessibility)
        case .accessoryCorner:
            VStack(spacing: 0) {
                Image(systemName: plan.symbol)
                    .font(.system(size: 15, weight: .bold))
                    .widgetAccentable()
                if !showsWidgetLabel {
                    Text(plan.verdict)
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .lineLimit(1)
                }
            }
            .widgetLabel { Text(plan.cornerLabel) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Plan Check")
            .accessibilityValue(plan.accessibility)
        default:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Image(systemName: plan.symbol).widgetAccentable()
                    Text(plan.title.uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(plan.verdict)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                }
                Text(plan.detail)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .lineLimit(1)
                if let place = clean(entry.snapshot.planPlace) {
                    Text(place)
                        .font(.system(size: 8, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Plan Check")
            .accessibilityValue(plan.accessibility)
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
        let rain = rainSignal(entry.snapshot)
        switch family {
        case .accessoryInline:
            Label(rain.inline, systemImage: rain.symbol)
                .accessibilityLabel("Rain Next, \(rain.accessibility)")
        case .accessoryCircular:
            Gauge(value: Double(rain.peak), in: 0...100) {
                Text("Rain")
            } currentValueLabel: {
                VStack(spacing: -1) {
                    Text("\(rain.peak)%")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                    Text(rain.micro)
                        .font(.system(size: 7, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                }
            }
            .gaugeStyle(.accessoryCircular)
            .widgetAccentable()
            .accessibilityLabel("Rain Next")
            .accessibilityValue(rain.accessibility)
        case .accessoryCorner:
            Gauge(value: Double(rain.peak), in: 0...100) {
                Image(systemName: rain.symbol)
            } currentValueLabel: {
                if !showsWidgetLabel {
                    Text("\(rain.peak)")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                }
            }
            .gaugeStyle(.accessoryCircular)
            .widgetAccentable()
            .widgetLabel {
                Gauge(value: Double(rain.peak), in: 0...100) {
                    Text(rain.cornerLabel)
                }
            }
            .accessibilityLabel("Rain Next")
            .accessibilityValue(rain.accessibility)
        default:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Image(systemName: rain.symbol).widgetAccentable()
                    Text(rain.headline)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text("\(rain.peak)%")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                }
                NearcastHorizon(points: rain.points)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Rain Next")
            .accessibilityValue(rain.accessibility)
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
        VStack(alignment: .leading, spacing: 3) {
            Label("NEARCAST BRIEF", systemImage: "cloud.sun.fill")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
            Text("What matters next")
                .font(.system(size: 14, weight: .bold, design: .rounded))
        }
        .redacted(reason: .placeholder)
    }

    private var briefUnavailable: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("NEARCAST BRIEF", systemImage: "iphone.and.arrow.forward")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
            Text("Open Nearcast on iPhone")
                .font(.system(size: 14, weight: .bold, design: .rounded))
            Text("Choose a place to begin")
                .font(.system(size: 9, weight: .medium, design: .rounded))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nearcast Brief unavailable")
        .accessibilityValue("Open Nearcast on iPhone and choose a place")
    }

    private var briefStale: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("UPDATE NEEDED", systemImage: "arrow.clockwise")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
            Text("Weather may be out of date")
                .font(.system(size: 14, weight: .bold, design: .rounded))
            Text(weatherAgeText(entry))
                .font(.system(size: 9, weight: .medium, design: .rounded))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nearcast Brief needs an update")
        .accessibilityValue(weatherAgeText(entry))
    }

    @ViewBuilder
    private var briefFresh: some View {
        let content = briefSignal(entry)
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Image(systemName: content.symbol).widgetAccentable()
                Text(content.eyebrow.uppercased())
                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 2)
                Text("\(entry.snapshot.temperature)°")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
            }
            Text(content.headline)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .lineLimit(1)
            if content.showsHorizon {
                NearcastHorizon(points: rainSignal(entry.snapshot).points)
            } else {
                Text(content.detail)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .lineLimit(1)
            }
        }
        .foregroundStyle(renderingMode == .fullColor ? Color.white : Color.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Nearcast Brief, \(content.eyebrow)")
        .accessibilityValue("\(content.headline). \(content.detail)")
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
            VStack(spacing: 1) {
                Image(systemName: symbol).widgetAccentable()
                Text(title)
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        case .accessoryCorner:
            VStack(spacing: 0) {
                Image(systemName: symbol).widgetAccentable()
                if !showsWidgetLabel {
                    Text(detail)
                        .font(.system(size: 8, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                }
            }
            .widgetLabel { Text(cornerLabel) }
        default:
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .bold))
                    .widgetAccentable()
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                    Text(detail)
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct HorizonPoint {
    let label: String
    let chance: Int
}

private struct NearcastHorizon: View {
    let points: [HorizonPoint]

    var body: some View {
        let visible = Array(points.prefix(4))
        let peak = visible.map(\.chance).max() ?? 0
        VStack(spacing: 1) {
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(visible.indices, id: \.self) { index in
                    Capsule()
                        .fill(visible[index].chance == peak && peak > 0 ? Color.accentColor : Color.secondary.opacity(0.5))
                        .frame(maxWidth: .infinity)
                        .frame(height: max(2, CGFloat(visible[index].chance) * 0.08))
                }
            }
            .frame(height: 8, alignment: .bottom)
            HStack(spacing: 4) {
                ForEach(visible.indices, id: \.self) { index in
                    Text(visible[index].label)
                        .font(.system(size: 7, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

private struct NextSignal {
    let symbol: String
    let headline: String
    let detail: String
    let inline: String
    let micro: String
    let cornerLabel: String
    let accessibility: String
    let isSteady: Bool
}

private struct RainSignal {
    let symbol: String
    let headline: String
    let inline: String
    let micro: String
    let cornerLabel: String
    let peak: Int
    let points: [HorizonPoint]
    let accessibility: String
}

private struct PlanSignal {
    let symbol: String
    let title: String
    let verdict: String
    let detail: String
    let inline: String
    let cornerLabel: String
    let accessibility: String
}

private struct BriefSignal {
    let symbol: String
    let eyebrow: String
    let headline: String
    let detail: String
    let showsHorizon: Bool
}

private func nextSignal(_ snapshot: NearcastWidgetSnapshot) -> NextSignal {
    let rows = Array((snapshot.timeline ?? []).prefix(6))
    let currentGroup = conditionGroup(snapshot.conditionCode)
    let peakRainChance = max(snapshot.rainChance, rows.compactMap(\.rainChance).max() ?? 0)

    if supportsRain(snapshot.conditionCode) {
        return NextSignal(
            symbol: "cloud.rain.fill",
            headline: "Rain now",
            detail: "Peak chance \(peakRainChance)% in the next few hours",
            inline: "Rain now · peak \(peakRainChance)%",
            micro: "NOW",
            cornerLabel: "RAIN NOW",
            accessibility: "Rain now, peak chance \(peakRainChance) percent",
            isSteady: false
        )
    }

    if let wet = rows.first(where: { ($0.rainChance ?? 0) >= 30 || supportsRain($0.conditionCode) }) {
        let peak = peakRainChance
        // Only the current observation can justify definitive "Rain now"
        // language. The hourly row is still a forecast, even at offset zero.
        let supported = wet.offsetHours == 0
            ? supportsRain(snapshot.conditionCode)
            : supportsRain(wet.conditionCode)
        let headline: String
        let inline: String
        let cornerLabel: String
        let accessibility: String
        if wet.offsetHours == 0 {
            headline = supported ? "Rain now" : "Rain possible now"
            inline = supported ? "Rain now · peak \(peak)%" : "Rain chance now · peak \(peak)%"
            cornerLabel = supported ? "RAIN NOW" : "RAIN CHANCE NOW"
            accessibility = supported
                ? "Rain now, peak chance \(peak) percent"
                : "Rain is possible now, peak chance \(peak) percent"
        } else {
            headline = supported ? "Rain near \(wet.timeLabel)" : "Rain possible near \(wet.timeLabel)"
            inline = supported ? "Rain \(wet.timeLabel) · peak \(peak)%" : "Rain chance \(wet.timeLabel) · peak \(peak)%"
            cornerLabel = supported
                ? "RAIN NEAR \(wet.timeLabel.uppercased())"
                : "RAIN CHANCE \(wet.timeLabel.uppercased())"
            accessibility = supported
                ? "Rain near \(wet.timeLabel), peak chance \(peak) percent"
                : "Rain is possible near \(wet.timeLabel), peak chance \(peak) percent"
        }
        return NextSignal(
            symbol: "cloud.rain.fill",
            headline: headline,
            detail: "Peak chance \(peak)% in the next few hours",
            inline: inline,
            micro: wet.offsetHours == 0 ? "NOW" : wet.timeLabel,
            cornerLabel: cornerLabel,
            accessibility: accessibility,
            isSteady: false
        )
    }

    if let changed = rows.dropFirst().first(where: { row in
        guard let code = row.conditionCode else { return false }
        return conditionGroup(code) != currentGroup
    }), let code = changed.conditionCode {
        let transition = transitionLabel(code)
        return NextSignal(
            symbol: conditionSymbol(code, isDay: changed.isDay ?? snapshot.isDay),
            headline: "\(transition) near \(changed.timeLabel)",
            detail: "Changing from \(snapshot.condition.lowercased())",
            inline: "\(transition) near \(changed.timeLabel)",
            micro: changed.timeLabel,
            cornerLabel: "\(transition.uppercased()) \(changed.timeLabel.uppercased())",
            accessibility: "\(transition) near \(changed.timeLabel)",
            isSteady: false
        )
    }

    let windThreshold = max(20, snapshot.wind + 10)
    if let windy = rows.first(where: { ($0.windGust ?? 0) >= windThreshold }) {
        let gust = windy.windGust ?? windThreshold
        return NextSignal(
            symbol: "wind",
            headline: "Gusts pick up near \(windy.timeLabel)",
            detail: "Up to \(gust) \(snapshot.windUnit)",
            inline: "Gusts \(gust) \(snapshot.windUnit) near \(windy.timeLabel)",
            micro: windy.timeLabel,
            cornerLabel: "GUSTS \(gust) NEAR \(windy.timeLabel.uppercased())",
            accessibility: "Wind gusts up to \(gust) \(snapshot.windUnit) near \(windy.timeLabel)",
            isSteady: false
        )
    }

    if let last = rows.last, let laterTemperature = last.temperature,
       abs(laterTemperature - snapshot.temperature) >= 8 {
        let direction = laterTemperature > snapshot.temperature ? "Warmer" : "Cooler"
        return NextSignal(
            symbol: laterTemperature > snapshot.temperature ? "thermometer.sun.fill" : "thermometer.snowflake",
            headline: "\(direction) by \(last.timeLabel)",
            detail: "\(laterTemperature)° later",
            inline: "\(direction) by \(last.timeLabel) · \(laterTemperature)°",
            micro: last.timeLabel,
            cornerLabel: "\(direction.uppercased()) BY \(last.timeLabel.uppercased())",
            accessibility: "\(direction) by \(last.timeLabel), \(laterTemperature) degrees",
            isSteady: false
        )
    }

    return NextSignal(
        symbol: conditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay),
        headline: "Steady next 4 hours",
        detail: "\(snapshot.condition) · \(snapshot.temperature)°",
        inline: "Steady · \(snapshot.temperature)° \(snapshot.condition)",
        micro: "\(snapshot.temperature)°",
        cornerLabel: "STEADY · \(snapshot.temperature)°",
        accessibility: "Steady for the next 4 hours, \(snapshot.temperature) degrees and \(snapshot.condition)",
        isSteady: true
    )
}

private func rainSignal(_ snapshot: NearcastWidgetSnapshot) -> RainSignal {
    let rows = Array((snapshot.timeline ?? []).prefix(4))
    var points = rows.map {
        HorizonPoint(label: $0.offsetHours == 0 ? "Now" : $0.timeLabel, chance: $0.rainChance ?? snapshot.rainChance)
    }
    if points.isEmpty {
        points = [HorizonPoint(label: "Now", chance: snapshot.rainChance)]
    }
    let peak = max(snapshot.rainChance, points.map(\.chance).max() ?? 0)
    let observedRain = supportsRain(snapshot.conditionCode)
    let firstWet = rows.first { ($0.rainChance ?? 0) >= 30 || supportsRain($0.conditionCode) }
    let headline: String
    let inline: String
    let micro: String
    let cornerLabel: String
    if observedRain {
        headline = "Rain now"
        inline = "Rain now · peak \(peak)%"
        micro = "NOW"
        cornerLabel = "RAIN NOW · \(peak)%"
    } else if let firstWet {
        // Keep current-hour forecast codes probabilistic unless the current
        // observation also reports a wet condition.
        let supported = firstWet.offsetHours == 0
            ? supportsRain(snapshot.conditionCode)
            : supportsRain(firstWet.conditionCode)
        if firstWet.offsetHours == 0 {
            headline = supported ? "Rain now" : "Rain possible now"
            inline = supported ? "Rain now · peak \(peak)%" : "Rain chance now · peak \(peak)%"
            micro = "NOW"
            cornerLabel = supported ? "RAIN NOW · \(peak)%" : "RAIN CHANCE NOW · \(peak)%"
        } else {
            headline = supported ? "Rain near \(firstWet.timeLabel)" : "Rain possible near \(firstWet.timeLabel)"
            inline = supported
                ? "Rain \(firstWet.timeLabel) · peak \(peak)%"
                : "Rain chance \(firstWet.timeLabel) · peak \(peak)%"
            micro = firstWet.timeLabel
            cornerLabel = supported
                ? "RAIN \(firstWet.timeLabel.uppercased()) · \(peak)%"
                : "RAIN CHANCE \(firstWet.timeLabel.uppercased()) · \(peak)%"
        }
    } else if peak > 0 {
        headline = "Low rain chance"
        inline = "Low rain chance · peak \(peak)%"
        micro = "\(peak)%"
        cornerLabel = "LOW RAIN CHANCE · \(peak)%"
    } else {
        headline = "No rain showing"
        inline = "No rain showing next 4h"
        micro = "NONE"
        cornerLabel = "NO RAIN SHOWING"
    }
    return RainSignal(
        symbol: observedRain || firstWet != nil ? "cloud.rain.fill" : "drop.fill",
        headline: headline,
        inline: inline,
        micro: micro,
        cornerLabel: cornerLabel,
        peak: peak,
        points: points,
        accessibility: "\(headline), peak chance \(peak) percent"
    )
}

private func planSignal(_ snapshot: NearcastWidgetSnapshot) -> PlanSignal {
    let title = clean(snapshot.planTitle) ?? clean(snapshot.planLabel) ?? "Watched plan"
    let tone = (clean(snapshot.watchTone) ?? clean(snapshot.planTone) ?? "").lowercased()
    let verdict: String
    let symbol: String
    if planIsChanged(snapshot) {
        verdict = "CHANGE"
        symbol = "arrow.triangle.2.circlepath.circle.fill"
    } else if tone.contains("danger") || tone.contains("bad") {
        verdict = "CHANGE"
        symbol = "exclamationmark.triangle.fill"
    } else if tone.contains("watch") || tone.contains("caution") {
        verdict = "WATCH"
        symbol = "eye.fill"
    } else if tone.contains("good") || tone.contains("safe") || tone.contains("clear") {
        verdict = "GO"
        symbol = "checkmark.circle.fill"
    } else {
        verdict = "CHECK"
        symbol = "questionmark.circle.fill"
    }
    let detail = clean(snapshot.watchDetail) ?? clean(snapshot.planDetail) ?? "Open Nearcast for the latest check"
    return PlanSignal(
        symbol: symbol,
        title: title,
        verdict: verdict,
        detail: detail,
        inline: "\(title) · \(verdict): \(detail)",
        cornerLabel: "\(title.uppercased()) · \(verdict)",
        accessibility: "\(title), \(verdict), \(detail)"
    )
}

private func briefSignal(_ entry: NearcastComplicationEntry) -> BriefSignal {
    let rain = rainSignal(entry.snapshot)
    if entry.planState == .fresh {
        let plan = planSignal(entry.snapshot)
        let tone = (clean(entry.snapshot.watchTone) ?? clean(entry.snapshot.planTone) ?? "").lowercased()
        if planIsChanged(entry.snapshot) || tone.contains("danger") || tone.contains("watch") || tone.contains("caution") {
            return BriefSignal(symbol: plan.symbol, eyebrow: plan.title, headline: plan.detail, detail: plan.verdict, showsHorizon: false)
        }
    }
    if rain.peak >= 30 {
        return BriefSignal(symbol: rain.symbol, eyebrow: "Rain next", headline: rain.headline, detail: "Peak chance \(rain.peak)%", showsHorizon: true)
    }
    let next = nextSignal(entry.snapshot)
    return BriefSignal(symbol: next.symbol, eyebrow: "Nearcast next", headline: next.headline, detail: next.detail, showsHorizon: false)
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
        relevance: isPlaceholder ? nil : briefRelevance(snapshot: snapshot, weatherState: weatherState, planState: planState)
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

private func briefRelevance(snapshot: NearcastWidgetSnapshot, weatherState: WeatherDataState, planState: PlanDataState) -> TimelineEntryRelevance? {
    guard weatherState == .fresh else { return TimelineEntryRelevance(score: 5, duration: 30 * 60) }
    let tone = (clean(snapshot.watchTone) ?? clean(snapshot.planTone) ?? "").lowercased()
    if planState == .fresh && (tone.contains("danger") || planIsChanged(snapshot)) {
        return TimelineEntryRelevance(score: 100, duration: 2 * 60 * 60)
    }
    if planState == .fresh && (tone.contains("watch") || tone.contains("caution")) {
        return TimelineEntryRelevance(score: 85, duration: 90 * 60)
    }
    let rain = rainSignal(snapshot)
    if rain.points.first?.chance ?? 0 >= 30 {
        return TimelineEntryRelevance(score: 90, duration: 60 * 60)
    }
    if rain.peak >= 30 {
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
    let tone = (clean(entry.snapshot.watchTone) ?? clean(entry.snapshot.planTone) ?? "").lowercased()
    if entry.planState == .fresh && planIsChanged(entry.snapshot) {
        return Color(red: 0.68, green: 0.18, blue: 0.12)
    }
    if entry.planState == .fresh && (tone.contains("danger") || tone.contains("bad")) {
        return Color(red: 0.53, green: 0.12, blue: 0.12)
    }
    if entry.planState == .fresh && (tone.contains("watch") || tone.contains("caution")) {
        return Color(red: 0.50, green: 0.28, blue: 0.05)
    }
    if rainSignal(entry.snapshot).peak >= 30 {
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

private func clean(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func planIsChanged(_ snapshot: NearcastWidgetSnapshot) -> Bool {
    let tone = (clean(snapshot.watchTone) ?? clean(snapshot.planTone) ?? "").lowercased()
    let label = (clean(snapshot.planLabel) ?? clean(snapshot.watchStatus) ?? "").lowercased()
    return tone.contains("changed") || label == "changed"
}

private enum ConditionGroup: Equatable {
    case clear, cloud, fog, rain, snow, storm
}

private func conditionGroup(_ code: Int) -> ConditionGroup {
    if code <= 1 { return .clear }
    if code <= 3 { return .cloud }
    if code <= 48 { return .fog }
    if code <= 67 { return .rain }
    if code <= 77 { return .snow }
    if code <= 82 { return .rain }
    if code <= 86 { return .snow }
    return .storm
}

private func supportsRain(_ code: Int?) -> Bool {
    guard let code else { return false }
    return (51...67).contains(code) || (80...82).contains(code) || (95...99).contains(code)
}

private func transitionLabel(_ code: Int) -> String {
    switch conditionGroup(code) {
    case .clear: return "Clearing"
    case .cloud: return "Clouds move in"
    case .fog: return "Fog develops"
    case .rain: return "Rain arrives"
    case .snow: return "Snow arrives"
    case .storm: return "Storms develop"
    }
}

private func conditionSymbol(_ code: Int, isDay: Bool) -> String {
    switch conditionGroup(code) {
    case .clear: return isDay ? "sun.max.fill" : "moon.stars.fill"
    case .cloud: return isDay ? "cloud.sun.fill" : "cloud.moon.fill"
    case .fog: return "cloud.fog.fill"
    case .rain: return "cloud.rain.fill"
    case .snow: return "cloud.snow.fill"
    case .storm: return "cloud.bolt.rain.fill"
    }
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
            weather.placeName = requestedPlace.name
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
        if updated.hasPlan, updated.planSavedAt == nil, updated.savedAt > 0 {
            updated.planSavedAt = updated.savedAt
        }
        updated.savedAt = weather.savedAt
        updated.weatherSavedAt = weather.weatherSavedAt
        updated.isAvailable = true
        updated.placeName = requestedPlace.name
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
