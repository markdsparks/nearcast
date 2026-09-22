import SwiftUI
import Charts

/// The lenses used by Hourly's overview chart. The numeric lenses also steer
/// the dense forecast rows; Sun remains a visual daylight read so it never
/// turns an otherwise useful temperature row into an unavailable UV value.
enum NativeDayRhythmMetric: String, CaseIterable, Identifiable {
    case temperature
    case feelsLike
    case rain
    case wind
    case sun

    var id: String { rawValue }

    var title: String {
        switch self {
        case .temperature: return "Temp"
        case .feelsLike: return "Feels"
        case .rain: return "Rain"
        case .wind: return "Wind"
        case .sun: return "Sun"
        }
    }

    var accessibilityTitle: String {
        switch self {
        case .temperature: return "Temperature"
        case .feelsLike: return "Feels like temperature"
        case .rain: return "Precipitation chance"
        case .wind: return "Wind"
        case .sun: return "Sun and daylight"
        }
    }

    func value(_ point: NativeForecastPoint) -> Double? {
        switch self {
        case .temperature: return point.temperature
        case .feelsLike: return point.apparentTemperature
        case .rain: return point.rainProbability
        case .wind: return point.windSpeed
        case .sun: return nil
        }
    }
}

/// A compact, touch-first view of the *available* hourly forecast. It is
/// deliberately separate from the hourly list: touching it inspects an hour
/// in place instead of hijacking the person's scroll position or pretending a
/// chart point is an observation.
struct NativeDayRhythmView: View {
    let forecast: NativeWeatherForecast
    let day: Date
    let now: Date
    /// The main Hourly route reads across midnight. A nil window retains the
    /// explicit civil-day chart used by date and plan navigation.
    var rollingWindow: DateInterval? = nil
    let uses24HourClock: Bool
    let isDark: Bool
    let accent: Color
    let focusedHour: Date?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var metric: NativeDayRhythmMetric
    /// Keeps a finger-led selection responsive without asking the parent to
    /// scroll the hourly list for every movement.
    @State private var localSelection: Date?
    /// The chart deliberately yields vertical drags to the enclosing hourly
    /// ScrollView. Without this latch, beginning a normal page scroll on the
    /// chart could leave a misleading inspection cursor behind.
    @State private var chartGestureBecameVertical = false

    private struct Sample: Identifiable {
        let point: NativeForecastPoint
        let value: Double
        let segment: Int

        var id: Date { point.date }
        var date: Date { point.date }
    }

    private var calendar: Calendar { forecast.calendar }
    private var isToday: Bool { calendar.isDate(day, inSameDayAs: now) }
    private var currentHourStart: Date {
        calendar.dateInterval(of: .hour, for: now)?.start ?? now
    }

    /// These are provider-supplied hourly timestamps only. In particular, the
    /// chart never fills a missing hour or turns past forecast guidance into an
    /// observed history.
    private var points: [NativeForecastPoint] {
        let source = rollingWindow.map { window in
            forecast.hours.filter { $0.date >= window.start && $0.date < window.end }
        } ?? forecast.hours(on: day)
        return source
            .filter { $0.origin != .quarterHourForecast }
            .filter { $0.hasReadings && (rollingWindow != nil || !isToday || $0.date >= currentHourStart) }
            .sorted { $0.date < $1.date }
    }

    private var daylight: NativeSunDaylight { NativeSunDaylight(forecast: forecast, day: day) }
    private var daylightDays: [NativeSunDaylight] {
        guard rollingWindow != nil else { return [daylight] }
        let days = Set(points.map { calendar.startOfDay(for: $0.date) }).sorted()
        return days.map { NativeSunDaylight(forecast: forecast, day: $0) }
    }

    private func daylight(at date: Date) -> NativeSunDaylight? {
        daylightDays.first { date >= $0.interval.start && date < $0.interval.end }
    }

    private struct SunEvent: Identifiable {
        let date: Date
        let title: String
        var id: Date { date }
    }

    private var sunEvents: [SunEvent] {
        daylightDays.flatMap { value -> [SunEvent] in
            [value.sunrise.map { SunEvent(date: $0, title: "Sunrise") },
             value.sunset.map { SunEvent(date: $0, title: "Sunset") }].compactMap { $0 }
        }.filter { plotDomain.contains($0.date) }.sorted { $0.date < $1.date }
    }

    private var primarySamples: [Sample] {
        switch metric {
        case .sun:
            return samples { point in daylight(at: point.date)?.height(at: point.date) }
        default:
            return samples { metric.value($0) }
        }
    }

    private var comparisonSamples: [Sample] {
        switch metric {
        case .temperature:
            return samples { $0.apparentTemperature }
        case .feelsLike:
            return samples { $0.temperature }
        case .wind:
            return samples { $0.windGusts }
        case .rain, .sun:
            return []
        }
    }

    private func samples(value: (NativeForecastPoint) -> Double?) -> [Sample] {
        var result: [Sample] = []
        var segment = 0
        var previousDate: Date?

        for point in points {
            guard let rawValue = value(point), rawValue.isFinite else {
                previousDate = nil
                segment += 1
                continue
            }
            if let previousDate, point.date.timeIntervalSince(previousDate) > 5_400 {
                // A provider coverage gap remains a gap in the chart. A DST
                // transition is still an actual continuous hour apart.
                segment += 1
            }
            result.append(Sample(point: point, value: rawValue, segment: segment))
            previousDate = point.date
        }
        return result
    }

    private var plotDomain: ClosedRange<Date> {
        guard let first = points.first?.date else {
            let interval = calendar.dateInterval(of: .day, for: day)!
            return interval.start...interval.end
        }
        guard let last = points.last?.date, last > first else {
            return first...first.addingTimeInterval(3_600)
        }
        return first...last
    }

    private var valueDomain: ClosedRange<Double> {
        let primary = primarySamples.map(\.value)
        let comparison = comparisonSamples.map(\.value)
        switch metric {
        case .rain:
            return 0...100
        case .sun:
            // NativeSunDaylight's schematic stays in this bounded horizon
            // range. It is not presented as a solar-elevation measurement.
            return -0.58...1.08
        case .wind:
            let top = max(10, (primary + comparison).max() ?? 10)
            return 0...max(10, top * 1.18)
        case .temperature, .feelsLike:
            let values = primary + comparison
            let low = values.min() ?? 0
            let high = values.max() ?? low
            let padding = max(3, (high - low) * 0.24)
            return (low - padding)...(high + padding)
        }
    }

    private var selectedSample: Sample? {
        let focusedForThisDay = focusedHour.flatMap { focus in
            points.contains(where: { $0.date == focus }) ? focus : nil
        }
        let target = localSelection ?? focusedForThisDay ?? (isToday ? primarySamples.first?.date : nil)
        guard let target else { return nil }
        return primarySamples.min {
            abs($0.date.timeIntervalSince(target)) < abs($1.date.timeIntervalSince(target))
        }
    }

    private var panelFill: Color {
        isDark ? Color.white.opacity(0.055) : Color.white.opacity(0.48)
    }

    private var panelStroke: Color {
        isDark ? Color.white.opacity(0.13) : Color.black.opacity(0.08)
    }

    private var comparisonColor: Color {
        isDark ? Color.white.opacity(0.62) : Color(red: 0.25, green: 0.31, blue: 0.37).opacity(0.62)
    }

    private var metricColor: Color {
        if let selected = selectedSample {
            return semanticColor(for: selected.value)
        }
        switch metric {
        case .temperature, .feelsLike: return accent
        case .rain: return Color(red: 0.24, green: 0.62, blue: 0.94)
        case .wind: return Color(red: 0.29, green: 0.67, blue: 0.67)
        case .sun: return Color(red: 0.95, green: 0.65, blue: 0.22)
        }
    }

    /// A restrained semantic palette gives the line useful meaning without
    /// turning the chart into a novelty heat map. The exact numeric value is
    /// still always in the header and selected cursor.
    private func semanticColor(for value: Double) -> Color {
        switch metric {
        case .temperature, .feelsLike:
            return temperatureColor(value)
        case .rain:
            return precipitationColor(value)
        case .wind:
            return windColor(value)
        case .sun:
            return daylightColor(value)
        }
    }

    private func temperatureColor(_ temperature: Double) -> Color {
        let fahrenheit = forecast.metric ? (temperature * 9 / 5) + 32 : temperature
        switch fahrenheit {
        case ..<32: return Color(red: 0.24, green: 0.56, blue: 0.88)
        case ..<50: return Color(red: 0.18, green: 0.68, blue: 0.82)
        case ..<65: return Color(red: 0.27, green: 0.66, blue: 0.56)
        case ..<78: return Color(red: 0.55, green: 0.69, blue: 0.32)
        case ..<88: return Color(red: 0.91, green: 0.63, blue: 0.16)
        case ..<98: return Color(red: 0.91, green: 0.36, blue: 0.12)
        default: return Color(red: 0.78, green: 0.20, blue: 0.17)
        }
    }

    private func precipitationColor(_ chance: Double) -> Color {
        switch chance {
        case ..<10: return Color(red: 0.44, green: 0.72, blue: 0.88)
        case ..<30: return Color(red: 0.24, green: 0.65, blue: 0.90)
        case ..<60: return Color(red: 0.16, green: 0.49, blue: 0.82)
        case ..<85: return Color(red: 0.20, green: 0.36, blue: 0.73)
        default: return Color(red: 0.39, green: 0.26, blue: 0.68)
        }
    }

    private func windColor(_ speed: Double) -> Color {
        let mph = forecast.metric ? speed / 1.609_344 : speed
        switch mph {
        case ..<8: return Color(red: 0.28, green: 0.66, blue: 0.65)
        case ..<18: return Color(red: 0.18, green: 0.56, blue: 0.77)
        case ..<30: return Color(red: 0.30, green: 0.42, blue: 0.78)
        case ..<45: return Color(red: 0.89, green: 0.55, blue: 0.18)
        default: return Color(red: 0.82, green: 0.27, blue: 0.17)
        }
    }

    private func daylightColor(_ height: Double) -> Color {
        switch height {
        case ..<0: return Color(red: 0.38, green: 0.51, blue: 0.72)
        case ..<0.28: return Color(red: 0.89, green: 0.53, blue: 0.24)
        case ..<0.72: return Color(red: 0.96, green: 0.70, blue: 0.24)
        default: return Color(red: 1.0, green: 0.82, blue: 0.38)
        }
    }

    private func primaryGradient(for samples: [Sample]) -> LinearGradient {
        guard let first = samples.first, let last = samples.last, last.date > first.date else {
            let color = samples.first.map { semanticColor(for: $0.value) } ?? metricColor
            return LinearGradient(colors: [color, color], startPoint: .leading, endPoint: .trailing)
        }
        let span = last.date.timeIntervalSince(first.date)
        let stops = samples.map { sample in
            Gradient.Stop(
                color: semanticColor(for: sample.value),
                location: min(1, max(0, sample.date.timeIntervalSince(first.date) / span))
            )
        }
        return LinearGradient(gradient: Gradient(stops: stops), startPoint: .leading, endPoint: .trailing)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            metricTabs
            if primarySamples.isEmpty {
                unavailableState
            } else {
                rhythmChart
                chartCaption
            }
        }
        .padding(18)
        .background(panelFill, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(panelStroke, lineWidth: 1)
        }
        .onAppear(perform: ensureAvailableMetric)
        .onChange(of: day) { _, _ in
            localSelection = nil
            ensureAvailableMetric()
        }
        .onChange(of: rollingWindow) { _, _ in
            localSelection = nil
            ensureAvailableMetric()
        }
        .onChange(of: forecast.generatedAt) { _, _ in
            ensureAvailableMetric()
        }
        .onChange(of: focusedHour) { _, focus in
            guard let focus, points.contains(where: { $0.date == focus }) else { return }
            localSelection = focus
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var header: some View {
        // The selected hour is an inspection result, not a competing title.
        // Giving both a horizontal claim made the chip win on narrower phones
        // and crushed “Day rhythm” into a column. Let the title read at full
        // width, then place the selected read directly beneath it.
        VStack(alignment: .leading, spacing: 8) {
            headerTitle
            selectedReadout
        }
    }

    private var headerTitle: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(rollingWindow == nil ? "Day rhythm" : "Next 24 hours")
                .font(.headline.weight(.bold))
                .accessibilityAddTraits(.isHeader)
            Text(headerDetail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var selectedReadout: some View {
        if let sample = selectedSample {
            // Keep the inspected time and its useful companion fact in one
            // deliberate unit. The old right-aligned two-line treatment let
            // the colored dot float between the label and value, which read
            // more like a broken badge than a selected forecast hour.
            HStack(alignment: .top, spacing: 7) {
                Circle()
                    .fill(metricColor)
                    .frame(width: 7, height: 7)
                    .padding(.top, 5)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        Text(selectionLabel.capitalized)
                            .font(.caption.weight(.bold))
                        Text("·")
                            .foregroundStyle(.secondary)
                        Text(time(sample.date))
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(metricColor)
                    .monospacedDigit()
                    Text(selectedValue(for: sample))
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .foregroundStyle(.primary)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .multilineTextAlignment(.leading)
            .padding(.vertical, 1)
            .accessibilityLabel("\(selectionLabel.capitalized), \(readout(for: sample))")
        }
    }

    /// The selected read keeps the precise time separate from the actual
    /// weather facts. Wind and rain each have a second fact that is too useful
    /// to make someone infer from the secondary chart trace.
    private func selectedValue(for sample: Sample) -> String {
        switch metric {
        case .temperature, .feelsLike:
            return "\(Int(sample.value.rounded()))°"
        case .rain:
            return rainReadout(for: sample)
        case .wind:
            return windReadout(for: sample)
        case .sun:
            return sunReadout(for: sample)
        }
    }

    private func windReadout(for sample: Sample) -> String {
        let units = forecast.metric ? "km/h" : "mph"
        let sustained = "\(Int(sample.value.rounded())) \(units)"
        guard let gust = sample.point.windGusts, gust.isFinite, gust >= 0 else {
            return sustained
        }
        return "\(sustained) · Gust \(Int(gust.rounded())) \(units)"
    }

    private func rainReadout(for sample: Sample) -> String {
        let chance: String
        if let value = sample.point.rainProbability, value.isFinite, (0...100).contains(value) {
            chance = "\(Int(value.rounded()))% chance"
        } else {
            // The selected sample only exists when the charted probability is
            // valid, but preserve an honest fallback if an older cached point
            // and its source field ever disagree.
            chance = "\(Int(sample.value.rounded()))% chance"
        }
        guard let amount = sample.point.precipitationMM, amount.isFinite, amount >= 0 else {
            return chance
        }
        return "\(chance) · Accum. \(precipitationAmount(amount, interval: sample.point.precipitationIntervalSeconds))"
    }

    private func precipitationAmount(_ millimeters: Double, interval: Double?) -> String {
        let amount: String
        if forecast.metric {
            let value = millimeters < 1 ? String(format: "%.1f", millimeters) : String(format: "%.0f", millimeters)
            amount = "\(value) mm"
        } else {
            let inches = millimeters / 25.4
            amount = inches > 0 && inches < 0.01 ? "<.01 in" : String(format: "%.2f in", inches)
        }
        guard let interval, interval.isFinite, (60...3_600).contains(interval) else { return amount }
        let minutes = Int((interval / 60).rounded())
        return minutes == 60 ? "\(amount) this hour" : "\(amount) in \(minutes) min"
    }

    private func sunReadout(for sample: Sample) -> String {
        let state: String
        switch daylight(at: sample.date)?.isDaylight(at: sample.date) {
        case true: state = "Daylight"
        case false: state = "Nighttime"
        case nil: state = "Sun timing unavailable"
        }
        if let uv = sample.point.uvIndex, uv.isFinite, uv >= 0 {
            return "\(state) · UV \(uv.formatted(.number.precision(.fractionLength(0...1))))"
        }
        return state
    }

    private var selectionLabel: String {
        if localSelection != nil { return "Viewing" }
        if focusedHour != nil { return "Selected" }
        return selectedSample.map { $0.date >= currentHourStart && $0.date < currentHourStart.addingTimeInterval(3_600) } == true
            ? "Now" : "Forecast"
    }

    private var metricTabs: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 18) {
                ForEach(NativeDayRhythmMetric.allCases) { choice in
                    let available = isAvailable(choice)
                    Button {
                        metric = choice
                        localSelection = nil
                    } label: {
                        VStack(spacing: 7) {
                            Text(choice.title)
                                .font(.subheadline.weight(metric == choice ? .bold : .semibold))
                                .foregroundStyle(metric == choice ? metricColor : Color.primary.opacity(available ? 0.72 : 0.34))
                            Capsule()
                                .fill(metric == choice ? metricColor : .clear)
                                .frame(height: 3)
                        }
                        .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(NativeDayRhythmTabButtonStyle(
                        tint: metricColor,
                        isDark: isDark,
                        reduceMotion: reduceMotion
                    ))
                    .disabled(!available)
                    .accessibilityLabel(choice.accessibilityTitle)
                    .accessibilityAddTraits(metric == choice ? .isSelected : [])
                }
            }
            .padding(.horizontal, 2)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Day rhythm metric")
    }

    private var rhythmChart: some View {
        let primary = primarySamples
        let comparison = comparisonSamples
        let selected = selectedSample
        let range = valueDomain
        return Chart {
            daylightMarks()
            rainAreaMarks(primary, range: range)
            primaryLineMarks(primary)
            comparisonMarks(comparison)
            selectionMarks(selected)
        }
        .chartXScale(domain: plotDomain)
        .chartYScale(domain: range)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: dynamicTypeSize.isAccessibilitySize ? 2 : 5)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [2, 4]))
                    .foregroundStyle(Color.secondary.opacity(0.20))
                AxisValueLabel(collisionResolution: .greedy(minimumSpacing: 18)) {
                    if let date = value.as(Date.self) {
                        Text(axisTime(date))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                }
            }
        }
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .frame(height: dynamicTypeSize.isAccessibilitySize ? 212 : 184)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                if let plotFrame = proxy.plotFrame {
                    let frame = geometry[plotFrame]
                    Rectangle()
                        .fill(.clear)
                        // Make the hit surface exactly the plot. Gesture
                        // coordinates are therefore already plot-local; this
                        // avoids a hidden chart-margin offset selecting an
                        // earlier hour than the one under a finger.
                        .frame(width: frame.width, height: frame.height)
                        .position(x: frame.midX, y: frame.midY)
                        .contentShape(Rectangle())
                        .simultaneousGesture(
                            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                                .onChanged { gesture in
                                    updateChartSelection(for: gesture, plotWidth: frame.width, proxy: proxy)
                                }
                                .onEnded { gesture in
                                    finishChartSelection(for: gesture, plotWidth: frame.width, proxy: proxy)
                                }
                        )
                        .accessibilityHidden(true)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(rollingWindow == nil ? "Day rhythm" : "Next 24 hours"), \(metric.accessibilityTitle.lowercased()) forecast")
        .accessibilityValue(chartAccessibilityValue)
        .accessibilityHint("Swipe up or down to inspect an hour. The selected value updates here without leaving the hourly forecast.")
        .accessibilityAdjustableAction { direction in
            moveAccessibleSelection(direction)
        }
    }

    @ChartContentBuilder
    private func daylightMarks() -> some ChartContent {
        if metric == .sun {
            ForEach(sunEvents) { event in
                RuleMark(x: .value(event.title, event.date))
                    .foregroundStyle(metricColor.opacity(0.42))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .annotation(position: .top, alignment: .center) {
                        Text(event.title)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(metricColor)
                    }
            }
        }
    }

    @ChartContentBuilder
    private func rainAreaMarks(_ samples: [Sample], range: ClosedRange<Double>) -> some ChartContent {
        if metric == .rain {
            ForEach(samples) { sample in
                AreaMark(
                    x: .value("Local time", sample.date),
                    yStart: .value("Baseline", range.lowerBound),
                    yEnd: .value(metric.accessibilityTitle, sample.value),
                    series: .value("Plot series", "primary-\(metric.rawValue)-\(sample.segment)")
                )
                .foregroundStyle(primaryGradient(for: samples).opacity(0.18))
                .interpolationMethod(.linear)
            }
        }
    }

    @ChartContentBuilder
    private func primaryLineMarks(_ samples: [Sample]) -> some ChartContent {
        ForEach(samples) { sample in
            LineMark(
                x: .value("Local time", sample.date),
                y: .value(metric.accessibilityTitle, sample.value),
                series: .value("Plot series", "primary-\(metric.rawValue)-\(sample.segment)")
            )
            .foregroundStyle(primaryGradient(for: samples))
            .lineStyle(StrokeStyle(lineWidth: 2.8, lineCap: .round, lineJoin: .round))
            .interpolationMethod(.linear)

            PointMark(
                x: .value("Local time", sample.date),
                y: .value(metric.accessibilityTitle, sample.value)
            )
            .foregroundStyle(semanticColor(for: sample.value))
            .symbolSize(18)
        }
    }

    @ChartContentBuilder
    private func comparisonMarks(_ samples: [Sample]) -> some ChartContent {
        if metric != .rain && metric != .sun {
            ForEach(samples) { sample in
                LineMark(
                    x: .value("Local time", sample.date),
                    y: .value(comparisonTitle, sample.value),
                    series: .value("Plot series", "comparison-\(metric.rawValue)-\(sample.segment)")
                )
                .foregroundStyle(comparisonColor)
                .lineStyle(StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round, dash: [2, 5]))
                .interpolationMethod(.linear)
            }
        }
    }

    @ChartContentBuilder
    private func selectionMarks(_ selected: Sample?) -> some ChartContent {
        if let selected {
            RuleMark(x: .value("Selected hour", selected.date))
                .foregroundStyle(metricColor.opacity(0.58))
                .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [2, 4]))
            PointMark(
                x: .value("Selected hour halo", selected.date),
                y: .value(metric.accessibilityTitle, selected.value)
            )
            .foregroundStyle(isDark ? Color.black.opacity(0.86) : Color.white.opacity(0.96))
            .symbolSize(150)
            PointMark(
                x: .value("Selected hour", selected.date),
                y: .value(metric.accessibilityTitle, selected.value)
            )
            .foregroundStyle(metricColor)
            .symbolSize(58)
        }
    }

    private var chartCaption: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: captionSymbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(metricColor)
                .padding(.top, 1)
            Text(caption)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private var unavailableState: some View {
        Label("No \(metric.accessibilityTitle.lowercased()) forecast is available for these hours.", systemImage: "chart.line.downtrend.xyaxis")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(minHeight: 132, alignment: .center)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headerDetail: String {
        switch metric {
        case .temperature:
            return comparisonSamples.isEmpty ? "Hourly air temperature" : "Air temperature · dotted feels like"
        case .feelsLike:
            return comparisonSamples.isEmpty ? "Hourly feels-like temperature" : "Feels like · dotted air temperature"
        case .rain:
            return "Hourly chance · forecast accumulation"
        case .wind:
            return comparisonSamples.isEmpty ? "Hourly sustained wind" : "Sustained wind · dashed gusts"
        case .sun:
            return sunDetail
        }
    }

    private var comparisonTitle: String {
        switch metric {
        case .temperature: return "Feels like"
        case .feelsLike: return "Air temperature"
        case .wind: return "Wind gusts"
        case .rain, .sun: return "Comparison"
        }
    }

    private var sunDetail: String {
        let peakUV = points.compactMap(\.uvIndex).filter { $0.isFinite && $0 >= 0 }.max()
        var details: [String] = []
        if rollingWindow != nil {
            details += sunEvents.map { "\($0.title) \(time($0.date))" }
        } else if let sunrise = daylight.sunrise {
            details.append("Sunrise \(clock(sunrise))")
        }
        if rollingWindow == nil, let sunset = daylight.sunset {
            details.append("Sunset \(clock(sunset))")
        }
        if let peakUV {
            details.append("UV peak \(peakUV.formatted(.number.precision(.fractionLength(0...1))))")
        }
        if !details.isEmpty { return details.joined(separator: " · ") }
        switch daylight.mode {
        case .continuousDaylight: return "Sun above the horizon all day"
        case .continuousNight: return "Sun below the horizon all day"
        case .normal, .unavailable: return "Daylight timing unavailable"
        }
    }

    private var caption: String {
        switch metric {
        case .temperature:
            return comparisonSamples.isEmpty
                ? "Provider-supplied hourly temperature forecast."
                : "Color follows temperature from cool blue to hot orange; solid is air, dotted is provider-supplied feels like."
        case .feelsLike:
            return comparisonSamples.isEmpty
                ? "Provider-supplied hourly feels-like forecast."
                : "Color follows feels-like temperature from cool blue to hot orange; solid is feels like, dotted is provider-supplied air temperature."
        case .rain:
            return "Blue follows hourly precipitation chance. The selected hour also shows the provider’s forecast accumulation for its actual interval."
        case .wind:
            return comparisonSamples.isEmpty
                ? "Solid line is provider-supplied sustained wind."
                : "Color strengthens with wind speed; solid is sustained wind, dotted is provider-supplied gusts, and the selected hour lists both."
        case .sun:
            return "The arc follows this place’s forecast sunrise and sunset; UV uses available hourly forecast samples."
        }
    }

    private var captionSymbol: String {
        switch metric {
        case .temperature, .feelsLike: return "thermometer.medium"
        case .rain: return "drop.fill"
        case .wind: return "wind"
        case .sun: return "sun.max.fill"
        }
    }

    private var chartAccessibilityValue: String {
        guard !primarySamples.isEmpty else { return "Unavailable" }
        let count = primarySamples.count
        if let selected = selectedSample {
            return "\(count) available forecast hours. Selected \(time(selected.date)): \(readout(for: selected))."
        }
        return "\(count) available forecast hours."
    }

    private func isAvailable(_ choice: NativeDayRhythmMetric) -> Bool {
        switch choice {
        case .sun:
            // UV enriches a daylight chart, but it cannot manufacture one
            // when the provider omitted sunrise/sunset and did not establish
            // continuous day or night.
            return daylightDays.contains { $0.mode != .unavailable }
        default:
            return points.contains { point in
                guard let value = choice.value(point) else { return false }
                return value.isFinite
            }
        }
    }

    private func ensureAvailableMetric() {
        guard !isAvailable(metric), let replacement = NativeDayRhythmMetric.allCases.first(where: isAvailable) else { return }
        metric = replacement
    }

    private func updateLocalSelection(at x: CGFloat, proxy: ChartProxy) {
        guard let date: Date = proxy.value(atX: x, as: Date.self),
              let sample = nearestSample(to: date) else { return }
        if localSelection != sample.date {
            localSelection = sample.date
        }
    }

    private func updateChartSelection(for gesture: DragGesture.Value, plotWidth: CGFloat, proxy: ChartProxy) {
        let translation = gesture.translation
        let horizontalDistance = abs(translation.width)
        let verticalDistance = abs(translation.height)
        if verticalDistance > horizontalDistance, verticalDistance >= 7 {
            chartGestureBecameVertical = true
        }

        // A deliberate horizontal scrub (or an initial tap) owns the chart.
        // A vertical scroll stays with the page and never changes the eventual
        // inspection target.
        guard !chartGestureBecameVertical,
              horizontalDistance >= verticalDistance || max(horizontalDistance, verticalDistance) < 7 else { return }
        let x = min(max(gesture.location.x, 0), plotWidth)
        updateLocalSelection(at: x, proxy: proxy)
    }

    /// A chart tap or horizontal scrub ends as an in-place inspection. It is
    /// intentionally not a navigation event: the hourly list stays put and
    /// the header plus cursor make the inspected hour explicit.
    private func finishChartSelection(for gesture: DragGesture.Value, plotWidth: CGFloat, proxy: ChartProxy) {
        defer { chartGestureBecameVertical = false }

        let horizontalDistance = abs(gesture.translation.width)
        let verticalDistance = abs(gesture.translation.height)
        let isTap = max(horizontalDistance, verticalDistance) < 7
        let isHorizontalScrub = horizontalDistance >= 7 && horizontalDistance > verticalDistance
        guard !chartGestureBecameVertical, isTap || isHorizontalScrub else { return }

        // Fingers often finish just outside the visible plot after a valid
        // horizontal scrub. Clamp that last x value instead of silently
        // dropping the person's intended final hour.
        let x = min(max(gesture.location.x, 0), plotWidth)
        updateLocalSelection(at: x, proxy: proxy)
    }

    private func nearestSample(to date: Date) -> Sample? {
        primarySamples.min {
            abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date))
        }
    }

    private func moveAccessibleSelection(_ direction: AccessibilityAdjustmentDirection) {
        guard !primarySamples.isEmpty else { return }
        let current = selectedSample.flatMap { sample in
            primarySamples.firstIndex(where: { $0.id == sample.id })
        } ?? 0
        let next: Int
        switch direction {
        case .increment: next = min(primarySamples.count - 1, current + 1)
        case .decrement: next = max(0, current - 1)
        @unknown default: return
        }
        let sample = primarySamples[next]
        localSelection = sample.date
    }

    private func readout(for sample: Sample) -> String {
        "\(time(sample.date)) · \(selectedValue(for: sample))"
    }

    private func axisTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = forecast.timeZone
        let isMidnight = calendar.component(.hour, from: date) == 0
        formatter.dateFormat = (rollingWindow != nil && isMidnight ? "EEE\n" : "") + (uses24HourClock ? "HH" : "h a")
        return formatter.string(from: date)
    }

    private func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = (rollingWindow != nil ? "EEE " : "") + (uses24HourClock ? "HH:mm" : "h:mm a")
            + (forecast.isRepeatedLocalHour(date) ? " zzz" : "")
        return formatter.string(from: date)
    }

    private func clock(_ date: Date) -> String {
        daylight.clock(date, uses24HourClock: uses24HourClock)
    }
}

/// The rhythm tabs intentionally stay light (their underline carries the
/// selected state), but a real press still gets a momentary tactile surface.
/// That keeps the control obvious without turning five choices into five
/// persistent pills.
private struct NativeDayRhythmTabButtonStyle: ButtonStyle {
    let tint: Color
    let isDark: Bool
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 6)
            .background(
                configuration.isPressed ? tint.opacity(isDark ? 0.22 : 0.14) : .clear,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
