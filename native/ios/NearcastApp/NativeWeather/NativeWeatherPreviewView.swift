import SwiftUI
import Charts

/// An opt-in, read-only native weather journey. Durable records and publishers
/// remain owned by the existing app until their separate migration gate passes.
struct NativeWeatherPreviewView: View {
    @ObservedObject var model: NativeWeatherPreviewModel
    let onClose: () -> Void
    let onLegacy: (NativeLegacyDestination) -> Void

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @ScaledMetric(relativeTo: .subheadline) private var minimumConditionWidth: CGFloat = 112
    @State private var metric: NativePreviewMetric = .temperature
    @State private var interval: NativePreviewInterval = .hourly
    @State private var legacyDestination: NativeLegacyDestination?
    @State private var confirmingLegacy = false
    @State private var showEarlierHours = false
    @State private var now = Date()

    private var isDark: Bool { (preferredScheme ?? colorScheme) == .dark }
    private var accent: Color { isDark ? Color(red: 0.57, green: 0.77, blue: 1) : Color(red: 0.16, green: 0.37, blue: 0.63) }
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: model.forecast?.timezoneID ?? model.selectedPlace.timezone ?? "") ?? .current
        return value
    }
    private var displayedDay: Date { model.selectedDay ?? now }
    private var isToday: Bool { calendar.isDate(displayedDay, inSameDayAs: now) }
    private var currentHourStart: Date { calendar.dateInterval(of: .hour, for: now)?.start ?? now }
    private var currentReadingIsStale: Bool {
        guard let current = model.forecast?.current else { return false }
        return now.timeIntervalSince(current.date) > 30 * 60
    }
    private var currentReadingTime: String {
        guard let current = model.forecast?.current else { return "" }
        let datePrefix = calendar.isDate(current.date, inSameDayAs: now) ? "" : "\(dayName(current.date)), "
        return "\(datePrefix)\(clock(current.date)) local"
    }
    private var isHourly: Bool { model.destination == .hourly }
    private var selectedForecastDay: NativeForecastDay? { model.forecast?.day(containing: displayedDay) }
    private var dayHours: [NativeForecastPoint] { model.forecast?.hours(on: displayedDay) ?? [] }
    private var remainingHours: [NativeForecastPoint] { dayHours.filter { $0.date >= currentHourStart } }
    private var previewDays: [NativeForecastDay] {
        let today = calendar.startOfDay(for: now)
        return Array((model.forecast?.days ?? []).filter { $0.date >= today }.prefix(14))
    }
    private var usableQuarterHours: [NativeForecastPoint] {
        guard let forecast = model.forecast else { return [] }
        return forecast.quarterHours.filter {
            calendar.isDate($0.date, inSameDayAs: displayedDay) && $0.date.addingTimeInterval(15 * 60) > now
        }
    }
    private var offersQuarterHours: Bool { !usableQuarterHours.isEmpty }
    private var showingQuarterHours: Bool { interval == .quarterHour && offersQuarterHours }
    private var listPoints: [NativeForecastPoint] {
        if showingQuarterHours { return usableQuarterHours }
        return isToday && !showEarlierHours ? dayHours.filter { $0.date >= currentHourStart } : dayHours
    }
    private var trendPoints: [NativeForecastPoint] {
        if showingQuarterHours { return Array(usableQuarterHours.prefix(25)) }
        let points = isToday ? dayHours.filter { $0.date >= currentHourStart } : dayHours
        return Array(points.prefix(24))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                skyBackground
                ScrollViewReader { scroll in
                    ScrollView {
                        VStack(spacing: 24) {
                            placePicker.id("native-preview-top")
                            if let forecast = model.forecast {
                                freshness(forecast)
                                if isHourly {
                                    hourlyContent
                                } else {
                                    hero
                                    outlookCard
                                    dailyList
                                }
                                Button { requestLegacy(.details) } label: {
                                    Label("More weather details", systemImage: "arrow.up.forward.app")
                                        .font(.subheadline.weight(.semibold))
                                }
                                attribution
                            } else {
                                loadingOrUnavailable
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 24)
                        .frame(maxWidth: 760)
                        .frame(maxWidth: .infinity)
                    }
                    .refreshable { await model.refresh() }
                    .onChange(of: model.destination) { _, _ in
                        scroll.scrollTo("native-preview-top", anchor: .top)
                    }
                    .onChange(of: model.selectedDay) { _, _ in
                        scroll.scrollTo("native-preview-top", anchor: .top)
                    }
                    .onChange(of: model.selectedPlace.coordinateIdentity) { _, _ in
                        scroll.scrollTo("native-preview-top", anchor: .top)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomNavigation }
            .navigationTitle("Native preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) { Image(systemName: "xmark") }
                        .accessibilityLabel("Close native preview")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.refresh() } } label: {
                        if model.isLoading { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                    }
                    .disabled(model.isLoading)
                    .accessibilityLabel("Refresh forecast")
                }
            }
            .tint(accent)
            .confirmationDialog("Open in existing Nearcast?", isPresented: $confirmingLegacy, titleVisibility: .visible) {
                Button("Open in existing Nearcast") {
                    if let destination = legacyDestination { onLegacy(destination) }
                }
                Button("Stay in native preview", role: .cancel) { legacyDestination = nil }
            } message: {
                Text("Continue with \(model.selectedPlace.name) in the existing app. This may change its selected place and update its normal widget and Watch weather. Closing the preview instead leaves your selected place unchanged.")
            }
            .onChange(of: model.selectedDay) { _, _ in
                if !offersQuarterHours { interval = .hourly }
                showEarlierHours = false
                ensureAvailableMetric()
            }
            .onChange(of: model.selectedPlace.coordinateIdentity) { _, _ in
                interval = .hourly
                showEarlierHours = false
            }
            .onChange(of: interval) { _, _ in ensureAvailableMetric() }
            .onChange(of: model.forecast?.generatedAt) { _, _ in ensureAvailableMetric() }
            .onChange(of: offersQuarterHours) { _, available in
                if !available { interval = .hourly }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                now = Date()
                if !model.isLoading && (model.forecast.map { now.timeIntervalSince($0.generatedAt) > 5 * 60 } ?? true) {
                    Task { await model.refresh() }
                }
            }
            .task {
                // The screen must age even without touches. This clock never
                // registers background work or increases notification delivery.
                while !Task.isCancelled {
                    if scenePhase == .active { now = Date() }
                    do { try await Task.sleep(for: .seconds(60)) }
                    catch { return }
                }
            }
        }
        .preferredColorScheme(preferredScheme)
    }

    private var preferredScheme: ColorScheme? {
        switch model.context.theme.lowercased() {
        case "dark": return .dark
        case "light": return .light
        default:
            // Nearcast's automatic appearance follows the selected place,
            // not the phone's local clock or its system appearance schedule.
            if let isDay = model.forecast?.current?.isDay { return isDay ? .light : .dark }
            return nil
        }
    }

    private var skyBackground: some View {
        LinearGradient(
            colors: isDark
                ? [Color(red: 0.08, green: 0.15, blue: 0.24), Color(red: 0.08, green: 0.11, blue: 0.16)]
                : [Color(red: 0.73, green: 0.86, blue: 0.95), Color(red: 0.93, green: 0.96, blue: 0.97)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(isDark ? Color.blue.opacity(0.08) : Color.white.opacity(0.28))
                .frame(width: 300, height: 300)
                .blur(radius: 60)
                .offset(x: 110, y: -100)
                .accessibilityHidden(true)
        }
        .ignoresSafeArea()
    }

    private var placePicker: some View {
        Menu {
            ForEach(model.places, id: \.coordinateIdentity) { place in
                Button { model.selectPlace(place) } label: {
                    if place.coordinateIdentity == model.selectedPlace.coordinateIdentity {
                        Label(place.name, systemImage: "checkmark")
                    } else {
                        Text(place.name)
                    }
                }
            }
            Section {
                Text("Preview only. Your saved place and Watch stay unchanged.")
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(model.selectedPlace.name)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if model.places.count > 1 {
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .disabled(model.places.isEmpty)
        .foregroundStyle(.primary)
        .accessibilityHint("Choose a temporary place for this preview. Saved places are unchanged.")
    }

    @ViewBuilder
    private func freshness(_ forecast: NativeWeatherForecast) -> some View {
        let stale = now.timeIntervalSince(forecast.generatedAt) > 60 * 60
        if let error = model.errorMessage {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Showing the last available forecast").font(.subheadline.weight(.semibold))
                    Text(error).font(.caption)
                }
            } icon: {
                Image(systemName: "wifi.exclamationmark")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        } else if stale {
            Label {
                Text("Saved forecast · updated \(relativeAge(forecast.generatedAt))")
            } icon: {
                Image(systemName: "clock")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var hero: some View {
        VStack(spacing: 12) {
            if !isToday {
                Button { model.showToday() } label: {
                    Label("Back to Today", systemImage: "arrow.left")
                        .font(.subheadline.weight(.semibold))
                }
                Text(dayName(displayedDay, full: true)).font(.title2.weight(.bold))
            } else if currentReadingIsStale {
                Text("Last reading · \(currentReadingTime)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 20) {
                    heroTemperature
                    heroIcon
                }
                VStack(spacing: 8) {
                    heroTemperature
                    heroIcon
                }
            }
            if let day = selectedForecastDay {
                Text("H \(temperature(day.high)) · L \(temperature(day.low))")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            if isToday, let current = model.forecast?.current {
                VStack(spacing: 5) {
                    Text(current.conditionLabel).font(.title3.weight(.semibold))
                    if let apparent = current.apparentTemperature,
                       let actual = current.temperature, abs(apparent - actual) >= 2 {
                        Text("Feels like \(temperature(apparent))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .multilineTextAlignment(.center)
            } else if let day = selectedForecastDay {
                Text(day.conditionLabel)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private var heroTemperature: some View {
        Text(temperature(isToday ? model.forecast?.current?.temperature : selectedForecastDay?.high))
            .font(.system(size: dynamicTypeSize.isAccessibilitySize ? 68 : 92, weight: .bold, design: .rounded))
            .tracking(-4)
            .accessibilityLabel(isToday ? (currentReadingIsStale ? "Last reading temperature, \(currentReadingTime)" : "Current temperature") : "Forecast high")
            .accessibilityValue(temperature(isToday ? model.forecast?.current?.temperature : selectedForecastDay?.high, withUnit: true))
    }

    private var heroIcon: some View {
        weatherSymbol(isToday ? (model.forecast?.current?.symbolName ?? "questionmark.circle") : (selectedForecastDay?.symbolName ?? "questionmark.circle"), size: 64)
            .frame(minWidth: 70, minHeight: 74)
            .accessibilityHidden(true)
    }

    private var outlookCard: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 7) {
                Text(isToday ? (remainingHours.isEmpty ? "DAILY OUTLOOK" : "REST OF TODAY") : "\(dayName(displayedDay).uppercased())’S OUTLOOK")
                    .font(.caption.weight(.heavy))
                    .tracking(1.5)
                    .foregroundStyle(accent)
                Text(outlookHeadline)
                    .font(.title2.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = outlookDetail {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            intervalPicker
            if trendPoints.isEmpty {
                Label("Hourly details aren’t available for this day.", systemImage: "clock.badge.questionmark")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                trendChart
                metricPicker
                Button {
                    model.showHourly(day: model.selectedDay)
                } label: {
                    HStack {
                        Text("Explore \(showingQuarterHours ? "15-minute" : "hourly") details")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardFill, in: RoundedRectangle(cornerRadius: 28))
        .overlay { RoundedRectangle(cornerRadius: 28).strokeBorder(.primary.opacity(0.07)) }
    }

    private var outlookHeadline: String {
        if isToday, !remainingHours.isEmpty {
            // Use the already-resolved hourly evidence, never a raw severe
            // code that the shared semantics qualified as only a possibility.
            if let storm = remainingHours.first(where: { [95, 96, 99].contains($0.weatherCode ?? -1) }) {
                return timedHeadline(storm)
            }
            if let possibleStorm = remainingHours.first(where: \.thunderPossible) {
                return timedHeadline(possibleStorm)
            }
            let precipitationCodes: Set<Int> = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86]
            if let wet = remainingHours.first(where: { precipitationCodes.contains($0.weatherCode ?? -1) }) {
                return timedHeadline(wet)
            }
            if let next = remainingHours.first { return timedHeadline(next) }
        }
        if let day = selectedForecastDay { return day.conditionLabel }
        return "Daily forecast unavailable"
    }

    private func timedHeadline(_ point: NativeForecastPoint) -> String {
        if point.date < currentHourStart.addingTimeInterval(60 * 60) {
            return "\(point.conditionLabel) this hour"
        }
        return "\(point.conditionLabel) around \(clock(point.date))"
    }

    private var outlookDetail: String? {
        var parts: [String] = []
        if isToday && !remainingHours.isEmpty {
            let temperatures = remainingHours.compactMap(\.temperature)
            if let low = temperatures.min(), let high = temperatures.max() {
                if Int(low.rounded()) == Int(high.rounded()) {
                    parts.append("Near \(temperature(high)) in the remaining hours")
                } else {
                    parts.append("\(temperature(low))–\(temperature(high)) in the remaining hours")
                }
            }
            if let probability = remainingHours.compactMap(\.rainProbability).max() {
                parts.append("Precipitation chance up to \(Int(probability.rounded()))%")
            }
        } else if let day = selectedForecastDay {
            if let high = day.high { parts.append("High near \(temperature(high))") }
            if let probability = day.rainProbability { parts.append("\(Int(probability.rounded()))% precipitation chance") }
        }
        if parts.isEmpty { return nil }
        return parts.joined(separator: " · ")
    }

    private var intervalPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            if offersQuarterHours {
                Picker("Forecast interval", selection: $interval) {
                    Text("Hourly").tag(NativePreviewInterval.hourly)
                    Text("15 min").tag(NativePreviewInterval.quarterHour)
                }
                .pickerStyle(.segmented)
                if showingQuarterHours, let first = usableQuarterHours.first, let last = usableQuarterHours.last {
                    Text("Available \(clock(first.date))–\(clock(last.date)) · local time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("Hourly · local time")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var metricPicker: some View {
        VStack(alignment: .leading, spacing: 7) {
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(NativePreviewMetric.allCases) { item in
                        Button {
                            if reduceMotion { metric = item }
                            else { withAnimation(.easeInOut(duration: 0.18)) { metric = item } }
                        } label: {
                            Text(item.label)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 13)
                                .padding(.vertical, 12)
                                .foregroundStyle(metric == item ? accent : Color.secondary)
                                .background(metric == item ? accent.opacity(isDark ? 0.18 : 0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                        .disabled(!metricIsAvailable(item))
                        .accessibilityLabel(item.accessibleLabel)
                        .accessibilityAddTraits(metric == item ? .isSelected : [])
                    }
                }
            }
            .scrollIndicators(.hidden)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Forecast metric")
            let unavailable = NativePreviewMetric.allCases.filter { !metricIsAvailable($0) }.map(\.accessibleLabel)
            if showingQuarterHours && !unavailable.isEmpty {
                Text("\(unavailable.joined(separator: ", ")) not included in this 15-minute forecast.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func metricIsAvailable(_ item: NativePreviewMetric) -> Bool {
        let points = isHourly ? listPoints : trendPoints
        return points.contains { item.value($0) != nil }
    }

    private func ensureAvailableMetric() {
        guard !metricIsAvailable(metric), let available = NativePreviewMetric.allCases.first(where: metricIsAvailable) else { return }
        metric = available
    }

    private var trendChart: some View {
        let points = trendPoints
        let columnWidth: CGFloat = dynamicTypeSize.isAccessibilitySize ? 150 : 104
        let plotWidth = max(columnWidth, CGFloat(points.count) * columnWidth)
        let step = showingQuarterHours ? 15.0 * 60 : 60.0 * 60
        let samples = chartSamples(points, step: step)
        return ScrollView(.horizontal) {
            VStack(spacing: 10) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(points, id: \.id) { point in
                        VStack(spacing: 12) {
                            Text(clock(point.date, compact: !showingQuarterHours))
                                .font(.subheadline.weight(.semibold))
                            weatherSymbol(point.symbolName, size: 29)
                                .frame(height: 38)
                                .accessibilityHidden(true)
                        }
                        .frame(width: columnWidth)
                    }
                }
                Chart(samples) { sample in
                    if let value = metric.value(sample.point) {
                        LineMark(x: .value("Interval", sample.index), y: .value(metric.accessibleLabel, value), series: .value("Continuous coverage", sample.segment))
                            .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                            .foregroundStyle(accent)
                        PointMark(x: .value("Interval", sample.index), y: .value(metric.accessibleLabel, value))
                            .symbolSize(27)
                            .foregroundStyle(accent)
                    }
                }
                .chartXScale(domain: -0.5...max(0.5, Double(points.count) - 0.5))
                .chartYScale(domain: metric.domain(points))
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartLegend(.hidden)
                .frame(width: plotWidth, height: 72)
                .accessibilityHidden(true)
                HStack(alignment: .top, spacing: 0) {
                    ForEach(points, id: \.id) { point in
                        VStack(spacing: 8) {
                            Text(metric.formatted(point, metricUnits: model.context.metric))
                                .font(.title3.weight(.bold))
                                .foregroundStyle(accent)
                            Text(point.conditionLabel)
                                .font(.caption.weight(.semibold))
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(secondaryRead(point))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, 7)
                        .frame(width: columnWidth)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(clock(point.date)), \(point.conditionLabel), \(metric.accessibleLabel) \(metric.formatted(point, metricUnits: model.context.metric)), \(secondaryRead(point))")
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel("Scrollable \(showingQuarterHours ? "15-minute" : "hourly") forecast")
    }

    private func chartSamples(_ points: [NativeForecastPoint], step: TimeInterval) -> [NativePreviewChartSample] {
        var segment = 0
        return points.enumerated().map { index, point in
            if index > 0 {
                let previous = points[index - 1]
                if metric.value(previous) == nil || point.date.timeIntervalSince(previous.date) > step * 1.01 {
                    segment += 1
                }
            }
            return NativePreviewChartSample(index: Double(index), point: point, segment: segment)
        }
    }

    private var dailyList: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Daily outlook")
                .font(.title3.weight(.bold))
            if !previewDays.isEmpty {
                ForEach(Array(previewDays.prefix(7)), id: \.id) { day in
                    dailyRow(day)
                }
                if previewDays.count > 7 {
                    DisclosureGroup("Extended outlook") {
                        ForEach(Array(previewDays.dropFirst(7)), id: \.id) { day in
                            dailyRow(day)
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                }
            } else {
                Text("Daily forecast is unavailable.").foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 4)
    }

    private func dailyRow(_ day: NativeForecastDay) -> some View {
        Button { model.showDay(day.date) } label: {
            VStack(alignment: .leading, spacing: 8) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) {
                        dailyIdentity(day)
                        Spacer(minLength: 8)
                        dailyValues(day)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        dailyIdentity(day)
                        dailyValues(day)
                    }
                }
                Divider().padding(.top, 9)
            }
            .padding(.top, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Open this day’s native forecast")
    }

    private func dailyIdentity(_ day: NativeForecastDay) -> some View {
        HStack(alignment: .center, spacing: 12) {
            weatherSymbol(day.symbolName, size: 26)
                .frame(width: 34)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(dayName(day.date)).font(.headline)
                Text(day.conditionLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func dailyValues(_ day: NativeForecastDay) -> some View {
        HStack(spacing: 14) {
            Text(temperature(day.low)).foregroundStyle(.secondary)
            Text(temperature(day.high)).fontWeight(.bold)
            if let probability = day.rainProbability {
                Label("\(Int(probability.rounded()))%", systemImage: "drop.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(accent)
                    .accessibilityLabel("Precipitation chance \(Int(probability.rounded())) percent")
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .font(.subheadline)
        .monospacedDigit()
        .fixedSize(horizontal: true, vertical: false)
    }

    private var hourlyContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text(showingQuarterHours ? "15-minute forecast" : "Hourly forecast")
                    .font(.largeTitle.weight(.bold))
                Text(dayName(displayedDay, full: true))
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            dayPicker
            intervalPicker
            metricPicker
            if isToday && !showingQuarterHours && dayHours.contains(where: { $0.date < currentHourStart }) {
                Button(showEarlierHours ? "Hide earlier hours" : "Show earlier hours") {
                    showEarlierHours.toggle()
                }
                .font(.subheadline.weight(.semibold))
            }
            if listPoints.isEmpty {
                ContentUnavailableView("No hours available", systemImage: "clock.badge.questionmark", description: Text("Choose another day or refresh the forecast."))
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(listPoints, id: \.id) { point in
                        hourlyRow(point)
                        Divider()
                    }
                }
            }
        }
    }

    private var dayPicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(previewDays, id: \.id) { day in
                    let selected = calendar.isDate(day.date, inSameDayAs: displayedDay)
                    Button { model.showHourly(day: day.date) } label: {
                        Text(dayName(day.date))
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .foregroundStyle(selected ? accent : Color.primary)
                            .background(selected ? accent.opacity(0.14) : Color.clear, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func hourlyRow(_ point: NativeForecastPoint) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                Text(point.conditionLabel).font(.headline)
                detailPair("Temperature", temperature(point.temperature, withUnit: true))
                detailPair("Feels like", temperature(point.apparentTemperature, withUnit: true))
                detailPair("Precipitation chance", percentage(point.rainProbability))
                detailPair("Precipitation amount", precipitation(point.precipitationMM))
                detailPair("Wind", speed(point.windSpeed))
                detailPair("Gusts", speed(point.windGusts))
                detailPair("UV index", point.uvIndex.map { String(format: "%.1f", $0) } ?? "Not available")
                if point.thunderPossible {
                    Label("Thunderstorms possible", systemImage: "cloud.bolt")
                        .font(.subheadline.weight(.semibold))
                }
            }
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 14) {
                    hourIdentity(point)
                    Spacer(minLength: 6)
                    Text(metric.formatted(point, metricUnits: model.context.metric))
                        .font(.title3.weight(.bold))
                        .monospacedDigit()
                        .fixedSize(horizontal: true, vertical: false)
                }
                VStack(alignment: .leading, spacing: 10) {
                    hourIdentity(point)
                    Text("\(metric.accessibleLabel): \(metric.formatted(point, metricUnits: model.context.metric))")
                        .font(.headline)
                }
            }
            .foregroundStyle(.primary)
            .padding(.vertical, 15)
        }
    }

    private func hourIdentity(_ point: NativeForecastPoint) -> some View {
        HStack(spacing: 12) {
            Text(clock(point.date, compact: !showingQuarterHours))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .frame(minWidth: model.context.uses24HourClock ? 42 : 62, alignment: .leading)
            weatherSymbol(point.symbolName, size: 26)
                .frame(width: 35)
                .accessibilityHidden(true)
            Text(point.conditionLabel)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minWidth: minimumConditionWidth, alignment: .leading)
                .layoutPriority(1)
        }
    }

    private func detailPair(_ label: String, _ value: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(value).fontWeight(.semibold)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(label).foregroundStyle(.secondary)
                Text(value).fontWeight(.semibold)
            }
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    private var bottomNavigation: some View {
        HStack(spacing: 0) {
            navigationButton("Today", symbol: "sun.max", selected: !isHourly) { model.showToday() }
            navigationButton("Hourly", symbol: "clock", selected: isHourly) { model.showHourly(day: model.selectedDay) }
            navigationButton("Ask", symbol: "sparkle", selected: false) { requestLegacy(.ask) }
            navigationButton("Map", symbol: "map", selected: false) { requestLegacy(.map) }
            navigationButton("Plans", symbol: "calendar", selected: false) { requestLegacy(.plans) }
        }
        .padding(7)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 27))
        .overlay { RoundedRectangle(cornerRadius: 27).strokeBorder(.primary.opacity(0.08)) }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .frame(maxWidth: 620)
        .frame(maxWidth: .infinity)
    }

    private func navigationButton(_ title: String, symbol: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 20, weight: selected ? .semibold : .regular))
                Text(title).font(.caption2.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 49)
            .foregroundStyle(selected ? accent : Color.secondary)
            .background(selected ? accent.opacity(0.13) : Color.clear, in: RoundedRectangle(cornerRadius: 21))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var loadingOrUnavailable: some View {
        VStack(spacing: 20) {
            if model.isLoading {
                ProgressView().controlSize(.large)
                Text("Bringing in your forecast")
                    .font(.title2.weight(.semibold))
                Text("Weather for \(model.selectedPlace.name)")
                    .foregroundStyle(.secondary)
            } else {
                Image(systemName: "cloud.slash").font(.system(size: 48)).foregroundStyle(.secondary)
                Text("Weather is unavailable")
                    .font(.title2.weight(.bold))
                Text(model.errorMessage ?? "No forecast is loaded for this place yet.")
                    .foregroundStyle(.secondary)
                Button("Try again") { Task { await model.refresh() } }
                    .buttonStyle(.borderedProminent)
                Button("Return to existing Nearcast", action: onClose)
                    .font(.subheadline.weight(.semibold))
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
    }

    private var attribution: some View {
        VStack(spacing: 7) {
            if let generatedAt = model.forecast?.generatedAt {
                Text("Forecast updated \(relativeAge(generatedAt))")
            }
            Link("Weather data: Open-Meteo · Nearcast", destination: URL(string: "https://open-meteo.com/")!)
            Text("Preview only · saved places, plans, notifications and Watch are unchanged")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 8)
    }

    private var cardFill: Color {
        isDark ? Color(red: 0.11, green: 0.17, blue: 0.21) : Color.white.opacity(0.76)
    }

    private func weatherSymbol(_ name: String, size: CGFloat) -> some View {
        // Multicolor SF weather symbols can contain white moon/cloud layers,
        // which disappear on a light outlook card. Explicit semantic palettes
        // keep every layer visible without changing the forecast's condition.
        let cloud = isDark ? Color(red: 0.72, green: 0.82, blue: 0.88) : Color(red: 0.29, green: 0.39, blue: 0.47)
        let sun = isDark ? Color(red: 1, green: 0.78, blue: 0.30) : Color(red: 0.73, green: 0.43, blue: 0.03)
        let moon = isDark ? Color(red: 0.70, green: 0.82, blue: 1) : Color(red: 0.19, green: 0.39, blue: 0.65)
        let precipitation = isDark ? Color(red: 0.41, green: 0.77, blue: 1) : Color(red: 0.10, green: 0.41, blue: 0.70)
        let primary = name.contains("cloud") ? cloud : name.contains("sun") ? sun : name.contains("moon") ? moon : cloud
        let secondary = name.contains("bolt") || name.contains("sun") ? sun : name.contains("moon") ? moon : precipitation
        return Image(systemName: name)
            .symbolRenderingMode(.palette)
            .foregroundStyle(primary, secondary, precipitation)
            .font(.system(size: size))
    }

    private func requestLegacy(_ destination: NativeLegacyDestination) {
        legacyDestination = destination
        confirmingLegacy = true
    }

    private func temperature(_ value: Double?, withUnit: Bool = false) -> String {
        guard let value, value.isFinite else { return withUnit ? "Not available" : "—" }
        return "\(Int(value.rounded()))°\(withUnit ? (model.context.metric ? "C" : "F") : "")"
    }

    private func percentage(_ value: Double?) -> String {
        guard let value else { return "Not available" }
        return "\(Int(value.rounded()))%"
    }

    private func speed(_ value: Double?) -> String {
        guard let value else { return "Not available" }
        return "\(Int(value.rounded())) \(model.context.metric ? "km/h" : "mph")"
    }

    private func precipitation(_ millimeters: Double?) -> String {
        guard let millimeters else { return "Not available" }
        return model.context.metric ? String(format: "%.1f mm", millimeters) : String(format: "%.2f in", millimeters / 25.4)
    }

    private func secondaryRead(_ point: NativeForecastPoint) -> String {
        if metric == .temperature {
            return point.rainProbability.map { "\(Int($0.rounded()))% precip." } ?? "Precip. unavailable"
        }
        return "Air \(temperature(point.temperature))"
    }

    private func clock(_ date: Date, compact: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = model.context.uses24HourClock ? (compact ? "HH" : "HH:mm") : (compact ? "h a" : "h:mm a")
        return formatter.string(from: date)
    }

    private func dayName(_ date: Date, full: Bool = false) -> String {
        let today = calendar.isDate(date, inSameDayAs: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now).map { calendar.isDate(date, inSameDayAs: $0) } ?? false
        if !full {
            if today { return "Today" }
            if tomorrow { return "Tomorrow" }
        }
        let formatter = DateFormatter()
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = full ? "EEEE, MMMM d" : "EEE, MMM d"
        return formatter.string(from: date)
    }

    private func relativeAge(_ date: Date) -> String {
        let age = max(0, now.timeIntervalSince(date))
        if age < 60 { return "just now" }
        if age < 60 * 60 { return "\(Int(age / 60)) min ago" }
        if age < 24 * 60 * 60 { return "\(Int(age / 3600)) hr ago" }
        return "\(Int(age / 86400)) day\(age < 2 * 86400 ? "" : "s") ago"
    }
}

private enum NativePreviewInterval: String, Hashable {
    case hourly
    case quarterHour
}

private struct NativePreviewChartSample: Identifiable {
    var id: Date { point.date }
    let index: Double
    let point: NativeForecastPoint
    let segment: Int
}

private enum NativePreviewMetric: String, CaseIterable, Identifiable {
    case temperature, feelsLike, rain, wind, uv
    var id: String { rawValue }
    var label: String {
        switch self {
        case .temperature: return "Temp"
        case .feelsLike: return "Feels"
        case .rain: return "Rain"
        case .wind: return "Wind"
        case .uv: return "UV"
        }
    }
    var accessibleLabel: String {
        switch self {
        case .temperature: return "Temperature"
        case .feelsLike: return "Feels like"
        case .rain: return "Precipitation chance"
        case .wind: return "Wind speed"
        case .uv: return "UV index"
        }
    }
    func value(_ point: NativeForecastPoint) -> Double? {
        switch self {
        case .temperature: return point.temperature
        case .feelsLike: return point.apparentTemperature
        case .rain: return point.rainProbability
        case .wind: return point.windSpeed
        case .uv: return point.uvIndex
        }
    }
    func formatted(_ point: NativeForecastPoint, metricUnits: Bool) -> String {
        guard let value = value(point), value.isFinite else { return "—" }
        switch self {
        case .temperature, .feelsLike: return "\(Int(value.rounded()))°"
        case .rain: return "\(Int(value.rounded()))%"
        case .wind: return "\(Int(value.rounded())) \(metricUnits ? "km/h" : "mph")"
        case .uv: return String(format: "%.1f", value)
        }
    }
    func domain(_ points: [NativeForecastPoint]) -> ClosedRange<Double> {
        let values = points.compactMap(value).filter(\.isFinite)
        let low = values.min() ?? 0
        let high = values.max() ?? 1
        switch self {
        case .rain: return 0...100
        case .uv: return 0...max(3, high + 1)
        case .wind: return 0...max(10, high * 1.2)
        case .temperature, .feelsLike:
            let padding = max(3, (high - low) * 0.25)
            return (low - padding)...(high + padding)
        }
    }
}
