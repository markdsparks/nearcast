import SwiftUI
import WidgetKit

private let nextKind = "NearcastWatchNext"
private let planKind = "NearcastWatchPlan"
private let rainKind = "NearcastWatchRain"
private let windKind = "NearcastWatchWind"
private let briefKind = "NearcastWatchBrief"
private let staleAfter: TimeInterval = 12 * 60 * 60
private let planStaleAfter: TimeInterval = 2 * 60 * 60

private enum NearcastComplicationColor {
    static let rain = Color(red: 0.35, green: 0.79, blue: 1.0)
    static let wind = Color(red: 0.45, green: 0.93, blue: 0.70)
    static let warm = Color(red: 1.0, green: 0.77, blue: 0.30)
    static let change = Color(red: 1.0, green: 0.42, blue: 0.39)

    static func condition(code: Int, isDay: Bool) -> Color {
        isDay && (0...2).contains(code) ? warm : rain
    }

    static func signal(_ tone: NearcastVisualSignalTone) -> Color {
        switch tone {
        case .rain, .cool, .neutral: return rain
        case .wind, .go, .calm: return wind
        case .warm, .watch: return warm
        case .change: return change
        }
    }
}

private struct NearcastComplicationTint: ViewModifier {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let color: Color

    func body(content: Content) -> some View {
        content
            .foregroundStyle(renderingMode == .fullColor && !isLuminanceReduced ? color : Color.primary)
            .widgetAccentable()
    }
}

private extension View {
    func nearcastComplicationTint(_ color: Color) -> some View {
        modifier(NearcastComplicationTint(color: color))
    }
}

private struct NearcastInlineAccentLabelStyle: LabelStyle {
    let color: Color

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon
                .nearcastComplicationTint(color)
            configuration.title
        }
    }
}

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
            let offsets = [0, 30, 60, 90, 120, 180, 240, 360, 480, 720]
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
        NearcastWindComplication()
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
        .configurationDisplayName("Temperature")
        .description("The current temperature, always in the same place.")
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
        .configurationDisplayName("Rain")
        .description("Rain chance over the next few hours.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastWindComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: windKind, provider: NearcastComplicationProvider()) { entry in
            NearcastWindComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("wind"))
        }
        .configurationDisplayName("Wind")
        .description("Current wind speed and direction.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastBriefWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: briefKind, provider: NearcastComplicationProvider()) { entry in
            NearcastBriefView(entry: entry)
                .widgetURL(nearcastComplicationURL("brief"))
        }
        .configurationDisplayName("Today Basics")
        .description("Temperature, high and low, rain, and wind.")
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
                title: "Temperature",
                detail: "Nearcast",
                cornerLabel: "TEMPERATURE",
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
        Group {
            switch family {
            case .accessoryInline:
                ViewThatFits {
                    Label(temperatureInlineText(entry.snapshot, includesRange: true), systemImage: "thermometer.medium")
                    Label(temperatureInlineText(entry.snapshot, includesRange: false), systemImage: "thermometer.medium")
                    Text("\(entry.snapshot.temperature)°")
                }
                .labelStyle(
                    NearcastInlineAccentLabelStyle(
                        color: NearcastComplicationColor.condition(
                            code: entry.snapshot.conditionCode,
                            isDay: entry.snapshot.isDay
                        )
                    )
                )
            case .accessoryCircular:
                NearcastTemperatureMark(snapshot: entry.snapshot, compact: showsWidgetLabel)
                    .widgetLabel {
                        Text(highLowText(entry.snapshot))
                    }
            case .accessoryCorner:
                NearcastTemperatureMark(snapshot: entry.snapshot, compact: true)
                    .widgetLabel {
                        ComplicationTemperatureBezel(snapshot: entry.snapshot)
                    }
            default:
                NearcastTemperatureRectangle(snapshot: entry.snapshot)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Temperature")
        .accessibilityValue("\(entry.snapshot.temperature) degrees, \(entry.snapshot.condition)")
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
                    .labelStyle(NearcastInlineAccentLabelStyle(color: NearcastComplicationColor.signal(plan.tone)))
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
                title: "Rain",
                detail: "Next 4 hours",
                cornerLabel: "RAIN",
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
        let probability = max(0, rain.magnitude?.value ?? entry.snapshot.rainChance)
        switch family {
        case .accessoryInline:
            ViewThatFits {
                Label(rainInlineText(rain, probability: probability, includesHorizon: true), systemImage: rain.symbolName)
                Label(rainInlineText(rain, probability: probability, includesHorizon: false), systemImage: rain.symbolName)
                Text("\(probability)%")
            }
                .labelStyle(NearcastInlineAccentLabelStyle(color: NearcastComplicationColor.rain))
                .accessibilityLabel("Rain, \(rain.accessibilityDescription)")
        case .accessoryCircular:
            NearcastRainMark(probability: probability, compact: showsWidgetLabel)
                .widgetLabel { Text(rainBezelText(rain)) }
                .accessibilityLabel("Rain")
                .accessibilityValue(rain.accessibilityDescription)
        case .accessoryCorner:
            NearcastRainMark(probability: probability, compact: true)
                .widgetLabel { Text(cornerText(rain)) }
                .accessibilityLabel("Rain")
                .accessibilityValue(rain.accessibilityDescription)
        default:
            NearcastRainInstrument(signal: rain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Rain")
            .accessibilityValue(rain.accessibilityDescription)
        }
    }
}

private struct NearcastWindComplicationView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.showsWidgetLabel) private var showsWidgetLabel
    let entry: NearcastComplicationEntry

    @ViewBuilder
    var body: some View {
        if entry.weatherState == .placeholder {
            ComplicationStateView(
                family: family,
                symbol: "wind",
                title: "Wind",
                detail: "Speed and direction",
                cornerLabel: "WIND",
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
        let wind = visualSignalSet(entry).wind
        switch family {
        case .accessoryInline:
            ViewThatFits {
                Label(windInlineText(entry.snapshot, includesUnit: true), systemImage: "wind")
                Label(windInlineText(entry.snapshot, includesUnit: false), systemImage: "wind")
                Text("\(entry.snapshot.wind)")
            }
                .labelStyle(NearcastInlineAccentLabelStyle(color: NearcastComplicationColor.wind))
                .accessibilityLabel("Wind from \(complicationCardinalDirection(entry.snapshot)) at \(entry.snapshot.wind) \(entry.snapshot.windUnit)")
        case .accessoryCircular:
            NearcastWindMark(snapshot: entry.snapshot, compact: showsWidgetLabel)
                .widgetLabel { Text(windBezelText(entry.snapshot)) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Wind")
                .accessibilityValue("From \(complicationCardinalDirection(entry.snapshot)) at \(entry.snapshot.wind) \(entry.snapshot.windUnit)")
        case .accessoryCorner:
            NearcastWindMark(snapshot: entry.snapshot, compact: true)
                .widgetLabel { Text(windBezelText(entry.snapshot)) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Wind")
                .accessibilityValue("From \(complicationCardinalDirection(entry.snapshot)) at \(entry.snapshot.wind) \(entry.snapshot.windUnit)")
        default:
            NearcastWindInstrument(snapshot: entry.snapshot)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Wind")
                .accessibilityValue("Current wind from \(complicationCardinalDirection(entry.snapshot)) at \(entry.snapshot.wind) \(entry.snapshot.windUnit). \(wind.accessibilityDescription)")
        }
    }
}

private struct NearcastBriefView: View {
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
            Color.clear
        }
    }

    private var briefPlaceholder: some View {
        NearcastBasicsRectangle(snapshot: .fallback)
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
        .accessibilityLabel("Today basics unavailable")
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
        .accessibilityLabel("Today basics needs an update")
        .accessibilityValue(weatherAgeText(entry))
    }

    @ViewBuilder
    private var briefFresh: some View {
        NearcastBasicsRectangle(snapshot: entry.snapshot)
        .foregroundStyle(Color.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Today basics")
        .accessibilityValue("\(entry.snapshot.temperature) degrees, \(entry.snapshot.condition), \(highLowText(entry.snapshot)), rain \(entry.snapshot.rainChance) percent, wind \(windBasicsText(entry.snapshot))")
    }
}

private struct NearcastTemperatureRectangle: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Image(systemName: complicationConditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay))
                    .font(.system(size: 25, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .nearcastComplicationTint(NearcastComplicationColor.condition(code: snapshot.conditionCode, isDay: snapshot.isDay))
                    .frame(width: 30)

                Text("\(snapshot.temperature)°")
                    .font(.system(size: 29, weight: .bold, design: .rounded).monospacedDigit())
                    .minimumScaleFactor(0.8)
            }
            .layoutPriority(1)

            ComplicationTemperatureTrack(snapshot: snapshot)
                .frame(maxWidth: .infinity)
        }
    }
}

private struct NearcastBasicsRectangle: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        GeometryReader { proxy in
            let metricsWidth = complicationBasicsMetricsWidth(proxy.size.width)

            HStack(spacing: 5) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Image(systemName: complicationConditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay))
                            .font(.system(size: 16, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .nearcastComplicationTint(NearcastComplicationColor.condition(code: snapshot.conditionCode, isDay: snapshot.isDay))
                        Text("\(snapshot.temperature)°")
                            .font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
                    }
                    ComplicationTemperatureTrack(snapshot: snapshot)
                }
                .frame(maxWidth: .infinity)

                Rectangle()
                    .fill(Color.primary.opacity(0.20))
                    .frame(width: 1, height: 43)

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 4) {
                        Image(systemName: snapshot.windDirection == nil ? "wind" : "location.north.fill")
                            .font(.system(size: 14, weight: .bold))
                            .rotationEffect(.degrees(Double(snapshot.windDirection ?? 0)))
                            .nearcastComplicationTint(NearcastComplicationColor.wind)
                            .frame(width: 16)
                        Text("\(snapshot.wind)")
                            .font(.system(size: 16, weight: .bold, design: .rounded).monospacedDigit())
                            .fixedSize(horizontal: true, vertical: false)
                        Text(complicationCardinalDirection(snapshot))
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    HStack(spacing: 4) {
                        Image(systemName: "drop.fill")
                            .font(.system(size: 14, weight: .bold))
                            .nearcastComplicationTint(NearcastComplicationColor.rain)
                            .frame(width: 16)
                        Text("\(snapshot.rainChance)%")
                            .font(.system(size: 16, weight: .bold, design: .rounded).monospacedDigit())
                            .fixedSize(horizontal: true, vertical: false)
                        ComplicationRainBars(values: complicationRainValues(snapshot))
                            .frame(minWidth: 16, idealWidth: 27, maxWidth: 27, minHeight: 13, maxHeight: 13)
                            .layoutPriority(-1)
                    }
                }
                .frame(width: metricsWidth, alignment: .leading)
                .layoutPriority(1)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

private struct NearcastTemperatureMark: View {
    let snapshot: NearcastWidgetSnapshot
    var compact = false

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: complicationConditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay))
                .font(.system(size: compact ? 12 : 14, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .nearcastComplicationTint(NearcastComplicationColor.condition(code: snapshot.conditionCode, isDay: snapshot.isDay))
            Text("\(snapshot.temperature)°")
                .font(.system(size: compact ? 18 : 21, weight: .bold, design: .rounded).monospacedDigit())
                .minimumScaleFactor(0.75)
        }
    }
}

private struct ComplicationTemperatureTrack: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(spacing: 2) {
            GeometryReader { proxy in
                let progress = complicationTemperatureProgress(snapshot)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: renderingMode == .fullColor && !isLuminanceReduced
                                    ? [NearcastComplicationColor.rain, NearcastComplicationColor.warm]
                                    : [Color.primary.opacity(0.42), Color.primary],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(height: 4)
                        .widgetAccentable()
                    Circle()
                        .fill(Color.primary)
                        .frame(width: 7, height: 7)
                        .offset(x: max(0, (proxy.size.width - 7) * progress))
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 7)

            HStack {
                Text(snapshot.low.map { "\($0)°" } ?? "—")
                Spacer(minLength: 4)
                Text(snapshot.high.map { "\($0)°" } ?? "—")
            }
            .font(.system(size: 12, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Today's temperature range")
        .accessibilityValue(highLowText(snapshot))
    }
}

private struct ComplicationTemperatureBezel: View {
    let snapshot: NearcastWidgetSnapshot

    @ViewBuilder
    var body: some View {
        if let low = snapshot.low, let high = snapshot.high, high > low {
            Gauge(
                value: min(Double(high), max(Double(low), Double(snapshot.temperature))),
                in: Double(low)...Double(high)
            ) {
                Text("Temperature")
            } currentValueLabel: {
                Text("\(snapshot.temperature)°")
            } minimumValueLabel: {
                Text("\(low)°")
            } maximumValueLabel: {
                Text("\(high)°")
            }
        } else {
            Text(snapshot.condition.uppercased())
        }
    }
}

private struct NearcastRainMark: View {
    let probability: Int
    var compact = false

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "drop.fill")
                .font(.system(size: compact ? 15 : 18, weight: .bold))
                .nearcastComplicationTint(NearcastComplicationColor.rain)
            Text("\(probability)%")
                .font(.system(size: compact ? 12 : 14, weight: .bold, design: .rounded).monospacedDigit())
                .minimumScaleFactor(0.72)
        }
    }
}

private struct NearcastWindMark: View {
    let snapshot: NearcastWidgetSnapshot
    var compact = false

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: snapshot.windDirection == nil ? "wind" : "location.north.fill")
                .font(.system(size: compact ? 15 : 18, weight: .bold))
                .rotationEffect(.degrees(Double(snapshot.windDirection ?? 0)))
                .nearcastComplicationTint(NearcastComplicationColor.wind)
            Text("\(snapshot.wind)")
                .font(.system(size: compact ? 12 : 14, weight: .bold, design: .rounded).monospacedDigit())
                .minimumScaleFactor(0.72)
        }
    }
}

private struct ComplicationRainBars: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let values: [Int]

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(values.prefix(4).enumerated()), id: \.offset) { _, value in
                Capsule()
                    .fill(renderingMode == .fullColor && !isLuminanceReduced ? NearcastComplicationColor.rain : Color.primary)
                    .frame(maxWidth: .infinity)
                    .frame(height: max(2, CGFloat(value) / 100 * 13))
                    .widgetAccentable()
            }
        }
        .frame(maxHeight: .infinity, alignment: .bottom)
        .accessibilityHidden(true)
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

private struct NearcastRainInstrument: View {
    let signal: NearcastVisualSignal

    private var probability: Int {
        signal.magnitude?.value ?? 0
    }

    private var values: [Double] {
        signal.timelinePoints.prefix(5).compactMap { $0.magnitude?.normalizedValue }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: signal.symbolName)
                .font(.system(size: 25, weight: .bold))
                .nearcastComplicationTint(NearcastComplicationColor.rain)
            Text("\(probability)%")
                .font(.system(size: 25, weight: .bold, design: .rounded).monospacedDigit())
                .minimumScaleFactor(0.8)
            Spacer(minLength: 2)
            VStack(alignment: .trailing, spacing: 2) {
                if let time = signal.eventTimeLabel {
                    Text(time)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                NearcastTrail(values: values, style: .rainBars)
                    .frame(width: 53, height: 25)
            }
        }
    }
}

private struct NearcastWindInstrument: View {
    let snapshot: NearcastWidgetSnapshot

    private var trail: [Double] {
        let maximum = snapshot.windUnit.lowercased().contains("km") ? 65.0 : 40.0
        let speeds = (snapshot.timeline ?? []).prefix(5).compactMap(\.wind)
        let values = speeds.isEmpty ? [snapshot.wind] : speeds
        return values.map { min(1, max(0, Double($0) / maximum)) }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: snapshot.windDirection == nil ? "wind" : "location.north.fill")
                .font(.system(size: 26, weight: .bold))
                .rotationEffect(.degrees(Double(snapshot.windDirection ?? 0)))
                .nearcastComplicationTint(NearcastComplicationColor.wind)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .lastTextBaseline, spacing: 3) {
                    Text("\(snapshot.wind)")
                        .font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
                    Text(shortComplicationWindUnit(snapshot.windUnit))
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Text(complicationCardinalDirection(snapshot))
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 2)
            NearcastTrail(values: trail, style: .line)
                .frame(width: 48, height: 27)
        }
    }
}

private enum NearcastTrailStyle {
    case rainBars
    case line
}

private struct NearcastTrail: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let values: [Double]
    let style: NearcastTrailStyle

    private var metricColor: Color {
        switch style {
        case .rainBars: return NearcastComplicationColor.rain
        case .line: return NearcastComplicationColor.wind
        }
    }

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
                            .fill(
                                renderingMode == .fullColor && !isLuminanceReduced
                                    ? metricColor.opacity(index == peakIndex ? 1 : 0.48)
                                    : Color.primary.opacity(index == peakIndex ? 1 : 0.48)
                            )
                            .frame(maxWidth: .infinity)
                            .frame(height: max(3, CGFloat(visible[index]) * proxy.size.height))
                            .widgetAccentable()
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
                    .stroke(
                        renderingMode == .fullColor && !isLuminanceReduced ? metricColor.opacity(0.58) : Color.primary.opacity(0.58),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
                    )
                    .widgetAccentable()
                    ForEach(positions.indices, id: \.self) { index in
                        Circle()
                            .fill(
                                renderingMode == .fullColor && !isLuminanceReduced
                                    ? metricColor.opacity(index == peakIndex ? 1 : 0.62)
                                    : Color.primary.opacity(index == peakIndex ? 1 : 0.62)
                            )
                            .frame(width: index == peakIndex ? 7 : 5, height: index == peakIndex ? 7 : 5)
                            .position(positions[index])
                            .widgetAccentable()
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

private struct NearcastPlanMark: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    let plan: NearcastVisualSignal
    var compact = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(
                    renderingMode == .fullColor && !isLuminanceReduced
                        ? NearcastComplicationColor.signal(plan.tone).opacity(0.48)
                        : Color.secondary.opacity(0.35),
                    lineWidth: compact ? 2 : 3
                )
            Image(systemName: plan.symbolName)
                .font(.system(size: compact ? 19 : 25, weight: .bold))
                .nearcastComplicationTint(NearcastComplicationColor.signal(plan.tone))
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
                    .nearcastComplicationTint(NearcastComplicationColor.signal(plan.tone))
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
    } else if age(at: date, savedAt: snapshot.planSavedTime) > planStaleAfter {
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
        projected.windLabel = nil
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
    let currentRainChance = signals.rain.timelinePoints.first?.magnitude?.value ?? snapshot.rainChance
    if currentRainChance >= 30 {
        return TimelineEntryRelevance(score: 90, duration: 60 * 60)
    }
    if signals.rain.magnitude?.value ?? 0 >= 30 {
        return TimelineEntryRelevance(score: 70, duration: 2 * 60 * 60)
    }
    return TimelineEntryRelevance(score: 20, duration: 30 * 60)
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

private func highLowText(_ snapshot: NearcastWidgetSnapshot) -> String {
    switch (snapshot.high, snapshot.low) {
    case let (high?, low?): return "H \(high)° · L \(low)°"
    case let (high?, nil): return "High \(high)°"
    case let (nil, low?): return "Low \(low)°"
    default: return "Today"
    }
}

private func temperatureInlineText(_ snapshot: NearcastWidgetSnapshot, includesRange: Bool) -> String {
    guard includesRange, let low = snapshot.low, let high = snapshot.high else {
        return "\(snapshot.temperature)° · \(snapshot.condition)"
    }
    return "\(snapshot.temperature)° · \(low)–\(high)°"
}

private func rainInlineText(_ signal: NearcastVisualSignal, probability: Int, includesHorizon: Bool) -> String {
    if signal.headline == "Dry" || probability == 0 {
        return includesHorizon ? "Dry next 4h" : "Dry"
    }
    guard includesHorizon else { return "\(probability)%" }
    return ["\(probability)%", signal.eventTimeLabel ?? "next 4h"].joined(separator: " · ")
}

private func rainBezelText(_ signal: NearcastVisualSignal) -> String {
    if signal.headline == "Dry" { return "DRY NEXT 4H" }
    return (signal.eventTimeLabel ?? "NEXT 4H").uppercased()
}

private func windInlineText(_ snapshot: NearcastWidgetSnapshot, includesUnit: Bool) -> String {
    let direction = complicationCardinalDirection(snapshot)
    let unit = includesUnit ? " \(shortComplicationWindUnit(snapshot.windUnit))" : ""
    return "\(direction) \(snapshot.wind)\(unit)"
}

private func windBezelText(_ snapshot: NearcastWidgetSnapshot) -> String {
    "\(complicationCardinalDirection(snapshot)) · \(snapshot.wind) \(shortComplicationWindUnit(snapshot.windUnit))"
}

private func complicationTemperatureProgress(_ snapshot: NearcastWidgetSnapshot) -> CGFloat {
    guard let low = snapshot.low, let high = snapshot.high, high > low else { return 0.5 }
    return CGFloat(min(1, max(0, Double(snapshot.temperature - low) / Double(high - low))))
}

private func complicationBasicsMetricsWidth(_ totalWidth: CGFloat) -> CGFloat {
    min(92, max(78, totalWidth * 0.47))
}

private func windBasicsText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let direction = snapshot.windLabel ?? snapshot.windDirection.map(cardinalDirection) ?? ""
    return direction.isEmpty
        ? "\(snapshot.wind) \(snapshot.windUnit)"
        : "\(snapshot.wind) \(snapshot.windUnit) \(direction)"
}

private func complicationRainValues(_ snapshot: NearcastWidgetSnapshot) -> [Int] {
    let values = (snapshot.timeline ?? []).prefix(4).compactMap(\.rainChance)
    return values.isEmpty ? [snapshot.rainChance] : values
}

private func complicationCardinalDirection(_ snapshot: NearcastWidgetSnapshot) -> String {
    if let degrees = snapshot.windDirection {
        return cardinalDirection(degrees)
    }
    let label = (snapshot.windLabel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard let candidate = label.split(whereSeparator: \.isWhitespace).last else { return "—" }
    switch candidate.uppercased() {
    case "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
         "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW":
        return candidate.uppercased()
    default:
        return "—"
    }
}

private func shortComplicationWindUnit(_ unit: String) -> String {
    unit.lowercased().contains("km") ? "km/h" : "mph"
}

private func complicationConditionSymbol(_ code: Int, isDay: Bool) -> String {
    switch code {
    case 0: return isDay ? "sun.max.fill" : "moon.stars.fill"
    case 1: return isDay ? "sun.min.fill" : "moon.fill"
    case 2: return isDay ? "cloud.sun.fill" : "cloud.moon.fill"
    case 3: return "cloud.fill"
    case 45, 48: return "cloud.fog.fill"
    case 51...67, 80...82: return "cloud.rain.fill"
    case 71...77, 85...86: return "cloud.snow.fill"
    case 95...99: return "cloud.bolt.rain.fill"
    default: return "cloud.fill"
    }
}

private func cardinalDirection(_ degrees: Int) -> String {
    let labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    let normalized = (degrees % 360 + 360) % 360
    return labels[Int((Double(normalized) + 22.5) / 45.0) % labels.count]
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
            URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            URLQueryItem(name: "temperature_unit", value: metricUnits ? "celsius" : "fahrenheit"),
            URLQueryItem(name: "wind_speed_unit", value: metricUnits ? "kmh" : "mph"),
            URLQueryItem(name: "forecast_hours", value: "24"),
            URLQueryItem(name: "forecast_days", value: "4"),
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
                let rows = hourly.rows(limit: 24, utcOffsetSeconds: forecast.utcOffsetSeconds ?? 0)
                weather.timeline = rows
                weather.rainChance = rows.first?.rainChance ?? fallback.rainChance
                weather.uv = rows.first?.uv ?? fallback.uv
            }
            if let daily = forecast.daily {
                weather.daily = daily.rows(limit: 3)
                weather.high = weather.daily?.first?.high
                weather.low = weather.daily?.first?.low
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
        updated.daily = weather.daily
        updated.high = weather.high
        updated.low = weather.low

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
    let daily: Daily?
    let utcOffsetSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case current
        case hourly
        case daily
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

    struct Daily: Decodable {
        let time: [String]
        let weatherCode: [Int?]?
        let high: [Double?]?
        let low: [Double?]?
        let rainChance: [Int?]?

        enum CodingKeys: String, CodingKey {
            case time
            case weatherCode = "weather_code"
            case high = "temperature_2m_max"
            case low = "temperature_2m_min"
            case rainChance = "precipitation_probability_max"
        }

        func rows(limit: Int) -> [NearcastWidgetDay] {
            (0..<min(time.count, limit)).compactMap { index -> NearcastWidgetDay? in
                guard let high = rounded(high?[safe: index] ?? nil),
                      let low = rounded(low?[safe: index] ?? nil) else { return nil }
                return NearcastWidgetDay(
                    date: time[index],
                    label: dayLabel(time[index], index: index),
                    high: high,
                    low: low,
                    rainChance: (rainChance?[safe: index] ?? nil) ?? 0,
                    conditionCode: (weatherCode?[safe: index] ?? nil) ?? 0
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

private func dayLabel(_ raw: String, index: Int) -> String {
    if index == 0 { return "Today" }
    if index == 1 { return "Tomorrow" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let date = formatter.date(from: raw) else { return raw }
    formatter.dateFormat = "EEE"
    return formatter.string(from: date)
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
