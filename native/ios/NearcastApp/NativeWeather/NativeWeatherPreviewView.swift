import SwiftUI
import Charts

/// An opt-in native weather journey. Explicit Places/Settings edits write
/// through to the existing owner until the separate ownership gate passes.
struct NativeWeatherPreviewView: View {
    @ObservedObject var model: NativeWeatherPreviewModel
    let onClose: () -> Void
    let onLegacy: (NativeLegacyDestination, String?) -> Void
    var onPlaces: (() -> Void)? = nil
    var onSettings: (() -> Void)? = nil
    /// The full native home persists a place choice through the verified
    /// Places owner. Read-only preview hosts intentionally leave this nil.
    var onSelectPlace: ((NativePreviewPlace) async -> Bool)? = nil

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var metric: NativePreviewMetric = .temperature
    @State private var interval: NativePreviewInterval = .hourly
    @State private var legacyDestination: NativeLegacyDestination?
    @State private var confirmingLegacy = false
    @State private var showingNativeMap = false
    @State private var showEarlierHours = false
    @State private var now = Date()
    @State private var scrollToTopRevision = 0
    @State private var weatherDetail: NativeWeatherDetailKind?
    @State private var switchingPlaceID: String?
    @State private var placeSwitchMessage: String?
    @State private var assistantEntry: NativeAssistantEntryDestination?

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
        model.forecast?.previewQuarterHours(on: displayedDay, now: now) ?? []
    }
    private var offersQuarterHours: Bool { !usableQuarterHours.isEmpty }
    private var showingQuarterHours: Bool { interval == .quarterHour && offersQuarterHours }
    private var listPoints: [NativeForecastPoint] {
        if showingQuarterHours { return usableQuarterHours }
        return isToday && !showEarlierHours ? dayHours.filter { $0.date >= currentHourStart } : dayHours
    }
    private var trendPoints: [NativeForecastPoint] {
        if showingQuarterHours { return Array(usableQuarterHours.prefix(25)) }
        return model.forecast?.previewTrendHours(on: displayedDay, now: now) ?? []
    }
    private var atmosphericTraceSamples: [NativeAtmosphericTraceSample] {
        let points = Array((isHourly ? listPoints : trendPoints).prefix(showingQuarterHours ? 25 : 8))
        let currentDate = isToday ? points.last(where: { $0.date <= now })?.date : nil
        let samples = points.map { point in
            NativeAtmosphericTraceSample(
                value: metric.value(point),
                isCurrent: currentDate.map { point.date == $0 } ?? false
            )
        }
        let finiteValueCount = samples.compactMap(\.value).filter(\.isFinite).count
        return finiteValueCount >= 2 ? samples : []
    }
    private var atmosphericTraceAccessibilityLabel: String {
        let intervalLabel = showingQuarterHours ? "15-minute" : "hourly"
        return "\(intervalLabel) \(metric.accessibleLabel.lowercased()) trend for \(dayName(displayedDay))."
    }
    /// One forecast-derived field drives the screen. It only translates data
    /// already on screen into light and depth; it never creates a stronger
    /// weather claim than the forecast itself.
    private var visualPoint: NativeForecastPoint? {
        guard let forecast = model.forecast else { return nil }
        // Hourly is an analytical surface. Its atmosphere represents the
        // first time being read, not a potentially unrelated current scene.
        if isHourly, let firstVisible = listPoints.first { return firstVisible }
        if isToday { return forecast.current ?? trendPoints.first }
        guard let day = selectedForecastDay else { return forecast.current }
        let points = forecast.hours(on: displayedDay)
        let cloudValues = points.compactMap(\.cloudCover)
        let averageCloud = cloudValues.isEmpty ? nil : cloudValues.reduce(0, +) / Double(cloudValues.count)
        return NativeForecastPoint(
            date: day.date,
            temperature: day.high,
            rainProbability: day.rainProbability,
            precipitationMM: day.precipitationMM,
            uvIndex: day.uvIndex,
            weatherCode: day.weatherCode,
            isDay: true,
            thunderPossible: day.thunderPossible,
            cloudCover: averageCloud
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                skyBackground
                ScrollViewReader { scroll in
                    ScrollView {
                        VStack(spacing: 20) {
                            placePicker.id("native-preview-top")
                            familyPlacesRail
                            if let forecast = model.forecast {
                                freshness(forecast)
                                NativeWeatherEssentialNotices(model: model, day: displayedDay, now: now) { weatherDetail = $0 }
                                if isHourly {
                                    hourlyContent
                                } else {
                                    hero
                                    outlookCard
                                    dailyList
                                }
                                NativeWeatherEssentialsSection(model: model, day: displayedDay, now: now) { weatherDetail = $0 }
                                attribution
                            } else {
                                loadingOrUnavailable
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 2)
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
                    .onChange(of: scrollToTopRevision) { _, _ in
                        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                            scroll.scrollTo("native-preview-top", anchor: .top)
                        }
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomNavigation }
            .navigationTitle("Nearcast")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) { Image(systemName: "xmark") }
                        .accessibilityLabel("Open existing Nearcast")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let onSettings {
                        Button(action: onSettings) { Image(systemName: "gearshape") }
                            .accessibilityLabel("Places and settings")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { weatherDetail = .overview } label: { Image(systemName: "list.bullet") }
                        .accessibilityLabel("Weather details")
                        .accessibilityHint("Air quality, sun, wind, UV and official alerts")
                        .disabled(model.forecast == nil)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.refresh() } } label: {
                        if model.isLoading { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                    }
                    .disabled(model.isLoading)
                    .accessibilityLabel("Refresh forecast")
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .tint(accent)
            .sheet(item: $weatherDetail) { kind in
                NativeWeatherDetailsSheet(model: model, kind: kind, day: displayedDay)
                    .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: $showingNativeMap) {
                NativeRadarView(
                    place: model.selectedPlace,
                    timezone: model.forecast?.timezoneID ?? model.selectedPlace.timezone,
                    uses24HourClock: model.context.uses24HourClock,
                    savedPlaces: model.places,
                    onSelectPlace: onSelectPlace == nil ? nil : { place in
                        await selectPlace(place)
                    },
                    onAskAboutPlace: {
                        showingNativeMap = false
                        assistantEntry = .ask
                    },
                    onClose: { showingNativeMap = false },
                    onExistingMap: {
                        showingNativeMap = false
                        requestLegacy(.map)
                    }
                )
                .id(model.selectedPlace.coordinateIdentity)
            }
            .confirmationDialog("Continue in Nearcast?", isPresented: $confirmingLegacy, titleVisibility: .visible) {
                Button("Open Nearcast") {
                    if let destination = legacyDestination { onLegacy(destination, nil) }
                }
                Button("Stay here", role: .cancel) { legacyDestination = nil }
            } message: {
                Text("Continue with \(model.selectedPlace.name) in Nearcast. Ask and Plans remain there while weather, widgets and Watch stay in sync here.")
            }
            .sheet(item: $assistantEntry) { destination in
                NativeAssistantEntryView(
                    destination: destination,
                    place: model.selectedPlace,
                    day: displayedDay,
                    timezone: model.forecast?.timezoneID ?? model.selectedPlace.timezone,
                    uses24HourClock: model.context.uses24HourClock,
                    onClose: { assistantEntry = nil },
                    onOpenExisting: { requestedDestination, query in
                        assistantEntry = nil
                        onLegacy(requestedDestination, query)
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
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
                    if scenePhase == .active {
                        now = Date()
                        model.refreshEssentialsIfNeeded(now: now)
                    }
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
            // Solar events take precedence over the snapshot's stale-safe
            // current reading, so the screen changes at local sunrise/sunset
            // even before the next forecast refresh.
            if let forecast = model.forecast,
               let isDay = NativeSunDaylight.automaticAppearanceIsDaylight(forecast: forecast, now: now) {
                return isDay ? .light : .dark
            }
            return nil
        }
    }

    private var skyBackground: some View {
        NativeAtmosphericField(
            point: visualPoint,
            usesMetric: model.context.metric,
            isDark: isDark,
            reduceMotion: reduceMotion,
            increasedContrast: colorSchemeContrast == .increased,
            placement: isHourly ? .hourly : .backdrop
        )
            .ignoresSafeArea()
    }

    private var placePicker: some View {
        Group {
          if let onPlaces {
            Button(action: onPlaces) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(model.selectedPlace.name)
                        .font(.system(.headline, design: .rounded, weight: .semibold))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .foregroundStyle(.primary)
            .accessibilityLabel("Places, \(model.selectedPlace.name)")
            .accessibilityHint("Choose, add or edit your saved places")
          } else {
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
                    .font(.system(.headline, design: .rounded, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if model.places.count > 1 {
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .disabled(model.places.isEmpty)
        .foregroundStyle(.primary)
        .accessibilityHint("Choose a temporary place for this preview. Saved places are unchanged.")
          }
        }
    }

    @ViewBuilder
    private var familyPlacesRail: some View {
        if onSelectPlace != nil, model.places.count > 1 {
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Text("Family places")
                        .font(.subheadline.weight(.bold))
                    Spacer()
                    if let onPlaces {
                        Button("Manage", action: onPlaces)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(accent)
                    }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 9) {
                        ForEach(model.places, id: \.coordinateIdentity) { place in
                            familyPlaceButton(place)
                        }
                    }
                    .padding(.horizontal, 1)
                }
                if let placeSwitchMessage {
                    Text(placeSwitchMessage)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Family places")
        }
    }

    private func familyPlaceButton(_ place: NativePreviewPlace) -> some View {
        let selected = place.coordinateIdentity == model.selectedPlace.coordinateIdentity
        let switching = switchingPlaceID == place.id
        return Button {
            Task { await selectPlace(place) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text(place.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    if selected { Image(systemName: "checkmark.circle.fill").font(.caption) }
                }
                if switching {
                    ProgressView().controlSize(.small)
                } else {
                    Text(selected ? "Current place" : localClock(for: place))
                        .font(.caption.weight(.medium))
                }
            }
            .foregroundStyle(selected ? accent : Color.primary)
            .frame(minWidth: 112, alignment: .leading)
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(selected ? accent.opacity(0.14) : Color.primary.opacity(isDark ? 0.10 : 0.06), in: RoundedRectangle(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? accent.opacity(0.42) : .primary.opacity(0.08)) }
        }
        .buttonStyle(.plain)
        .disabled(switchingPlaceID != nil || selected)
        .accessibilityLabel("\(place.name), \(selected ? "current place" : "local time \(localClock(for: place))")")
        .accessibilityHint(selected ? "Selected weather place" : "Switch weather to this saved place")
    }

    private func localClock(for place: NativePreviewPlace) -> String {
        guard let timeZone = place.timezone.flatMap(TimeZone.init(identifier:)) else { return "Local time unavailable" }
        return nearcastClockLabel(now, timeZone: timeZone, uses24HourClock: model.context.uses24HourClock, compact: true)
    }

    private func selectPlace(_ place: NativePreviewPlace) async -> Bool {
        guard place.coordinateIdentity != model.selectedPlace.coordinateIdentity else { return true }
        placeSwitchMessage = nil
        if let onSelectPlace {
            switchingPlaceID = place.id
            let changed = await onSelectPlace(place)
            switchingPlaceID = nil
            if !changed { placeSwitchMessage = "Couldn’t change places. Your current weather is unchanged." }
            return changed
        }
        model.selectPlace(place)
        return true
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
        VStack(spacing: 6) {
            if !isToday {
                selectedDayNavigation
            } else if currentReadingIsStale {
                Text("Last reading · \(currentReadingTime)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 18) {
                    heroTemperature
                    heroIcon
                }
                VStack(spacing: 8) {
                    heroTemperature
                    heroIcon
                }
            }
            if isToday, let current = model.forecast?.current {
                Text(heroCondition(current))
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let day = selectedForecastDay {
                Text(day.conditionLabel)
                    .font(.headline)
                    .multilineTextAlignment(.center)
            }
            if let day = selectedForecastDay {
                Text("High \(temperature(day.high))  ·  Low \(temperature(day.low))")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .padding(.top, 2)
            }
            if !atmosphericTraceSamples.isEmpty {
                NativeAtmosphericTrace(
                    samples: atmosphericTraceSamples,
                    tint: accent,
                    label: atmosphericTraceAccessibilityLabel
                )
                .frame(height: 30)
                .padding(.top, 5)
                .padding(.horizontal, 20)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .padding(.bottom, 14)
        .background {
            NativeAtmosphericField(
                point: visualPoint,
                usesMetric: model.context.metric,
                isDark: isDark,
                reduceMotion: reduceMotion,
                increasedContrast: colorSchemeContrast == .increased,
                placement: .hero
            )
                .clipShape(RoundedRectangle(cornerRadius: 42, style: .continuous))
        }
    }

    private func heroCondition(_ point: NativeForecastPoint) -> String {
        guard let apparent = point.apparentTemperature, let actual = point.temperature,
              abs(apparent - actual) >= (model.context.metric ? 1 : 2) else { return point.conditionLabel }
        return "\(point.conditionLabel) · feels \(temperature(apparent))"
    }

    private var selectedDayNavigation: some View {
        HStack(spacing: 6) {
            dayStepButton(-1)
            VStack(spacing: 3) {
                Text(dayName(displayedDay)).font(.title2.weight(.bold))
                Text(dayName(displayedDay, full: true))
                    .font(.caption).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            dayStepButton(1)
        }
        .padding(.bottom, 8)
    }

    private func adjacentDay(_ offset: Int) -> NativeForecastDay? {
        guard let index = previewDays.firstIndex(where: { calendar.isDate($0.date, inSameDayAs: displayedDay) }),
              previewDays.indices.contains(index + offset) else { return nil }
        return previewDays[index + offset]
    }

    private func dayStepButton(_ offset: Int) -> some View {
        let day = adjacentDay(offset)
        return Button {
            if let day { model.showDay(day.date) }
        } label: {
            Image(systemName: offset < 0 ? "chevron.left" : "chevron.right")
                .font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .background(.primary.opacity(isDark ? 0.07 : 0.04), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(day == nil)
        .opacity(day == nil ? 0.25 : 1)
        .accessibilityLabel(day.map { "Open \(dayName($0.date))" } ?? (offset < 0 ? "Previous day" : "Next day"))
    }

    private var heroTemperature: some View {
        Text(temperature(isToday ? model.forecast?.current?.temperature : selectedForecastDay?.high))
            .font(.system(size: dynamicTypeSize.isAccessibilitySize ? 76 : 100, weight: .semibold, design: .rounded))
            .tracking(-5)
            .contentTransition(.numericText())
            .accessibilityLabel(isToday ? (currentReadingIsStale ? "Last reading temperature, \(currentReadingTime)" : "Current temperature") : "Forecast high")
            .accessibilityValue(temperature(isToday ? model.forecast?.current?.temperature : selectedForecastDay?.high, withUnit: true))
    }

    private var heroIcon: some View {
        weatherSymbol(isToday ? (model.forecast?.current?.symbolName ?? "questionmark.circle") : (selectedForecastDay?.symbolName ?? "questionmark.circle"), size: 60)
            .frame(minWidth: 70, minHeight: 70)
            .accessibilityHidden(true)
    }

    private var outlookCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .center) {
                    Text(outlook?.eyebrow ?? "OUTLOOK")
                        .font(.caption.weight(.heavy))
                        .tracking(1.2)
                    Spacer(minLength: 8)
                    Button { model.showHourly(day: model.selectedDay) } label: {
                        Image(systemName: "arrow.up.right")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Open hourly details for \(dayName(displayedDay))")
                }
                .foregroundStyle(accent)
                Text(outlookHeadline)
                    .font(.title2.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = outlookDetail {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.primary.opacity(isDark ? 0.82 : 0.78))
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
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(cardFill)
                .overlay {
                    NativeAtmosphericField(
                        point: visualPoint,
                        usesMetric: model.context.metric,
                        isDark: isDark,
                        reduceMotion: reduceMotion,
                        increasedContrast: colorSchemeContrast == .increased,
                        placement: .card
                    )
                        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                }
        }
        .overlay { RoundedRectangle(cornerRadius: 28).strokeBorder(.primary.opacity(0.07)) }
        .shadow(color: .black.opacity(isDark ? 0.10 : 0.045), radius: 18, y: 8)
    }

    private var outlook: NativeWeatherOutlook? {
        model.forecast.map {
            NativeWeatherOutlook.make(forecast: $0, day: displayedDay, now: now, uses24HourClock: model.context.uses24HourClock)
        }
    }

    private var outlookHeadline: String { keepClockTogether(outlook?.headline ?? "Daily forecast unavailable") }
    private var outlookDetail: String? { outlook?.detail.map(keepClockTogether) }

    private func keepClockTogether(_ text: String) -> String {
        text.replacingOccurrences(of: " AM", with: "\u{00a0}AM")
            .replacingOccurrences(of: " PM", with: "\u{00a0}PM")
    }

    private var intervalPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            if offersQuarterHours {
                HStack(spacing: 20) {
                    intervalButton("Hourly", value: .hourly)
                    intervalButton("15 min", value: .quarterHour)
                    Spacer(minLength: 0)
                }
                if showingQuarterHours, let first = usableQuarterHours.first, let last = usableQuarterHours.last {
                    let firstDay = calendar.isDate(first.date, inSameDayAs: displayedDay) ? "" : "\(dayName(first.date)), "
                    let lastDay = calendar.isDate(first.date, inSameDayAs: last.date) ? "" : "\(dayName(last.date)), "
                    Text("\(firstDay)\(clock(first.date))–\(lastDay)\(clock(last.date)) · local time")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("Hourly · local time")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func intervalButton(_ title: String, value: NativePreviewInterval) -> some View {
        Button { interval = value } label: {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(interval == value ? accent : Color.secondary)
                .frame(minHeight: 44)
                .overlay(alignment: .bottom) {
                    Capsule().fill(interval == value ? accent : Color.clear).frame(height: 2)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(value == .hourly ? "Hourly intervals" : "15-minute intervals")
        .accessibilityAddTraits(interval == value ? .isSelected : [])
    }

    private var metricPicker: some View {
        VStack(alignment: .leading, spacing: 7) {
            ScrollView(.horizontal) {
                HStack(spacing: 3) {
                    ForEach(NativePreviewMetric.allCases) { item in
                        Button {
                            if reduceMotion { metric = item }
                            else { withAnimation(.easeInOut(duration: 0.18)) { metric = item } }
                        } label: {
                            Text(item.label)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 11)
                                .frame(minHeight: 44)
                                .foregroundStyle(metric == item ? accent : Color.primary.opacity(0.72))
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
        let columnWidth: CGFloat = dynamicTypeSize.isAccessibilitySize ? 152 : (dynamicTypeSize >= .xxxLarge ? 108 : 78)
        let plotWidth = max(columnWidth, CGFloat(points.count) * columnWidth)
        let step = showingQuarterHours ? 15.0 * 60 : 60.0 * 60
        let samples = chartSamples(points, step: step)
        let domain = metric.domain(points)
        let span = max(1, domain.upperBound - domain.lowerBound)
        return ScrollView(.horizontal) {
            VStack(spacing: 4) {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(points, id: \.id) { point in
                        VStack(spacing: 8) {
                            Text(clock(point.date, compact: !showingQuarterHours))
                                .font(.caption.weight(.semibold))
                                .monospacedDigit()
                            weatherSymbol(point.symbolName, size: 27)
                                .frame(height: 32)
                                .accessibilityHidden(true)
                        }
                        .padding(.top, 10)
                        .frame(width: columnWidth)
                    }
                }
                Chart(samples) { sample in
                    if let value = metric.value(sample.point) {
                        LineMark(x: .value("Interval", sample.index), y: .value(metric.accessibleLabel, value), series: .value("Continuous coverage", sample.segment))
                            .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                            .foregroundStyle(accent)
                        PointMark(x: .value("Interval", sample.index), y: .value(metric.accessibleLabel, value))
                            .symbolSize(23)
                            .foregroundStyle(accent)
                            .annotation(position: .top, spacing: 5) {
                                Text(metric.formatted(sample.point, metricUnits: model.context.metric))
                                    .font(.system(.body, design: .rounded, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(accent)
                                    .fixedSize()
                            }
                    }
                }
                .chartXScale(domain: -0.5...max(0.5, Double(points.count) - 0.5))
                // Annotation headroom is real layout space, not clipped text
                // at 100% rain or the top of a temperature curve.
                .chartYScale(domain: (domain.lowerBound - span * 0.08)...(domain.upperBound + span * 0.30))
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartLegend(.hidden)
                .frame(width: plotWidth, height: dynamicTypeSize.isAccessibilitySize ? 120 : 92)
                .accessibilityHidden(true)
                HStack(alignment: .top, spacing: 0) {
                    ForEach(points, id: \.id) { point in
                        VStack(spacing: 5) {
                            if metric.value(point) == nil {
                                Text("—").font(.body.weight(.bold)).foregroundStyle(.secondary)
                            }
                            Text(point.conditionLabel.replacingOccurrences(of: "Thunderstorms", with: "Storms"))
                                .font(.caption.weight(.semibold))
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(minHeight: 32, alignment: .top)
                            Text(secondaryRead(point))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                            if !calendar.isDate(point.date, inSameDayAs: displayedDay) {
                                Text(dayName(point.date))
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(accent)
                            }
                        }
                        .padding(.horizontal, 4)
                        .padding(.bottom, 10)
                        .frame(width: columnWidth)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("\(dayName(point.date)), \(clock(point.date)), \(point.conditionLabel), \(metric.accessibleLabel) \(metric.formatted(point, metricUnits: model.context.metric)), \(secondaryRead(point))")
                    }
                }
            }
            .background {
                HStack(spacing: 0) {
                    ForEach(Array(points.enumerated()), id: \.element.id) { index, _ in
                        RoundedRectangle(cornerRadius: 16)
                            .fill(index == 0 && isToday ? accent.opacity(isDark ? 0.11 : 0.055) : Color.clear)
                            .frame(width: columnWidth)
                    }
                }
                .accessibilityHidden(true)
            }
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
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Daily outlook").font(.title3.weight(.bold))
                Spacer()
                Text("Low / High").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.bottom, 12)
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
        let selected = !isToday && calendar.isDate(day.date, inSameDayAs: displayedDay)
        return Button { model.showDay(day.date) } label: {
            VStack(alignment: .leading, spacing: 7) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        Text(dayName(day.date))
                            .font(.subheadline.weight(.semibold))
                            .frame(minWidth: 94, alignment: .leading)
                            .fixedSize(horizontal: true, vertical: false)
                        weatherSymbol(day.symbolName, size: 23)
                            .frame(width: 28)
                            .accessibilityHidden(true)
                        Spacer(minLength: 0)
                        Text(temperature(day.low))
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 27, alignment: .trailing)
                        dailyRange(day).frame(minWidth: 40, idealWidth: 64, maxWidth: 80, minHeight: 6, maxHeight: 6)
                        Text(temperature(day.high)).fontWeight(.bold)
                            .frame(minWidth: 29, alignment: .leading)
                        Text(day.rainProbability.map { "\(Int($0.rounded()))%" } ?? "—")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(accent)
                            .frame(minWidth: 34, alignment: .trailing)
                    }
                    .font(.subheadline)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 10) {
                        dailyIdentity(day)
                        dailyValues(day)
                    }
                }
                Text(day.conditionLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 5)
            .background(selected ? accent.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(dayName(day.date)), \(day.conditionLabel), low \(temperature(day.low)), high \(temperature(day.high)), precipitation chance \(percentage(day.rainProbability))")
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Open this day’s native forecast")
        .overlay(alignment: .bottom) { Divider().allowsHitTesting(false) }
    }

    private func dailyRange(_ day: NativeForecastDay) -> some View {
        GeometryReader { geometry in
            if let low = day.low, let high = day.high, low <= high {
                let minimum = previewDays.compactMap(\.low).min() ?? low
                let maximum = previewDays.compactMap(\.high).max() ?? high
                let span = max(1, maximum - minimum)
                let start = max(0, min(1, (low - minimum) / span))
                let end = max(start, min(1, (high - minimum) / span))
                ZStack(alignment: .leading) {
                    Capsule().fill(.primary.opacity(0.10))
                    Capsule().fill(LinearGradient(colors: [accent.opacity(0.65), accent], startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(3, geometry.size.width * (end - start)))
                        .offset(x: min(geometry.size.width - 3, geometry.size.width * start))
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func dailyIdentity(_ day: NativeForecastDay) -> some View {
        HStack(alignment: .center, spacing: 12) {
            weatherSymbol(day.symbolName, size: 26)
                .frame(width: 34)
                .accessibilityHidden(true)
            Text(dayName(day.date)).font(.headline)
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
        VStack(alignment: .leading, spacing: 14) {
            hourlyHeader
            dayPicker
            if offersQuarterHours {
                intervalPicker
            }
            metricPicker
            if !atmosphericTraceSamples.isEmpty {
                NativeAtmosphericTrace(
                    samples: atmosphericTraceSamples,
                    tint: accent,
                    label: atmosphericTraceAccessibilityLabel
                )
                .frame(height: 42)
                .padding(.horizontal, 4)
            }
            if isToday && !showingQuarterHours && dayHours.contains(where: { $0.date < currentHourStart }) {
                Button(showEarlierHours ? "Hide earlier hours" : "Show earlier hours") {
                    showEarlierHours.toggle()
                }
                .font(.subheadline.weight(.semibold))
            }
            if listPoints.isEmpty {
                ContentUnavailableView("No hours available", systemImage: "clock.badge.questionmark", description: Text("Choose another day or refresh the forecast."))
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(listPoints.enumerated()), id: \.element.id) { index, point in
                        if model.forecast?.startsPreviewDaySection(point.date, after: index == 0 ? nil : listPoints[index - 1].date, selectedDay: displayedDay) == true {
                            Text(dayName(point.date, full: true))
                                .font(.headline)
                                .foregroundStyle(accent)
                                .padding(.top, 22)
                                .padding(.bottom, 8)
                                .accessibilityAddTraits(.isHeader)
                        }
                        hourlyRow(point)
                        Divider()
                    }
                }
            }
        }
    }

    private var hourlyHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(showingQuarterHours ? "Every 15 minutes" : "Hour by hour")
                .font(.title.weight(.bold))
            Text("\(dayName(displayedDay, full: true)) · local time")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14)
        .padding(.horizontal, 4)
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
                detailPair("Temperature", temperature(point.temperature, withUnit: true))
                detailPair("Feels like", temperature(point.apparentTemperature, withUnit: true))
                detailPair("Precipitation chance", percentage(point.rainProbability))
                detailPair("Precipitation amount", precipitation(point.precipitationMM))
                detailPair("Wind", speed(point.windSpeed))
                detailPair("Gusts", speed(point.windGusts))
                detailPair("UV index", point.uvIndex.map { String(format: "%.1f", $0) } ?? "Not available")
                detailPair("Humidity", percentage(point.relativeHumidity))
                detailPair("Dew point", temperature(point.dewPoint, withUnit: true))
                if let forecast = model.forecast {
                    detailPair("Visibility", NativeWeatherDetailPresentation(forecast: forecast, day: displayedDay, now: now,
                        uses24HourClock: model.context.uses24HourClock).formatted(point.visibilityMeters, kind: .visibility))
                }
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
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? 210 : 180, alignment: .leading)
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
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 4)], spacing: 6) {
                    navigationButtons
                }
            } else {
                HStack(spacing: 0) { navigationButtons }
            }
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

    @ViewBuilder
    private var navigationButtons: some View {
        navigationButton("Today", symbol: "sun.max", selected: !isHourly && isToday) {
            model.showToday()
            scrollToTopRevision += 1
        }
        navigationButton("Hourly", symbol: "clock", selected: isHourly) {
            model.showHourly(day: model.selectedDay)
            scrollToTopRevision += 1
        }
        navigationButton("Ask", symbol: "sparkle", selected: assistantEntry == .ask) { assistantEntry = .ask }
        navigationButton("Map", symbol: "map", selected: showingNativeMap) { showingNativeMap = true }
        navigationButton("Plans", symbol: "calendar", selected: assistantEntry == .plans) { assistantEntry = .plans }
    }

    private func navigationButton(_ title: String, symbol: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 20, weight: selected ? .semibold : .regular))
                Text(title).font(.caption2.weight(.semibold))
                    .fixedSize(horizontal: true, vertical: false)
            }
            .frame(width: dynamicTypeSize.isAccessibilitySize ? 112 : nil)
            .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? nil : .infinity, minHeight: 49)
            .foregroundStyle(selected ? accent : Color.secondary)
            .background(selected ? accent.opacity(0.13) : Color.clear, in: RoundedRectangle(cornerRadius: 21))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
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
            Text(onPlaces == nil
                ? "Weather shown here does not change saved places, plans or notifications"
                : "Nearcast weather · Places and Settings stay in sync")
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
            return point.rainProbability.map { "\(Int($0.rounded()))% precip." } ?? "Chance unavailable"
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

/// Native starting points for the workflows still backed by the proven
/// Nearcast planner. They preserve the selected place and day rather than
/// recreating another, potentially stale, plan or agent store.
private enum NativeAssistantEntryDestination: String, Identifiable {
    case ask, plans
    var id: String { rawValue }
}

private struct NativeAssistantEntryView: View {
    let destination: NativeAssistantEntryDestination
    let place: NativePreviewPlace
    let day: Date
    let timezone: String?
    let uses24HourClock: Bool
    let onClose: () -> Void
    let onOpenExisting: (NativeLegacyDestination, String?) -> Void

    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    private var isAsk: Bool { destination == .ask }
    private var trimmedDraft: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var timeZone: TimeZone { timezone.flatMap(TimeZone.init(identifier:)) ?? .current }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 7) {
                        Label(isAsk ? "Ask Nearcast" : "Plans", systemImage: isAsk ? "sparkle" : "calendar")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.tint)
                        Text(isAsk ? "Ask a useful weather question" : "Make a weather-aware plan")
                            .font(.largeTitle.weight(.bold))
                        Text(isAsk
                             ? "Your question will open in Nearcast with this exact forecast already selected."
                             : "Start with what matters. Nearcast checks the right place and time before saving anything.")
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    contextCard

                    VStack(alignment: .leading, spacing: 10) {
                        Text(isAsk ? "Your question" : "What are you planning?")
                            .font(.headline)
                        TextField(
                            isAsk ? "Will it be comfortable outside?" : "Soccer practice Tuesday at 6 PM",
                            text: $draft,
                            axis: .vertical
                        )
                        .lineLimit(2...5)
                        .textInputAutocapitalization(.sentences)
                        .submitLabel(.go)
                        .onSubmit(openDraft)
                        .focused($composerFocused)
                        .padding(14)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))

                        if isAsk {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    suggestion("Will rain affect my plans?")
                                    suggestion("When is the best time to be outside?")
                                    suggestion("What changes later today?")
                                }
                            }
                        } else {
                            Text("Nothing is saved until you review it in Nearcast.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button(action: openDraft) {
                        Label(isAsk ? "Ask Nearcast" : "Check this plan", systemImage: isAsk ? "arrow.up.circle.fill" : "sparkle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(trimmedDraft.isEmpty)

                    if !isAsk {
                        Button {
                            onOpenExisting(.plans, nil)
                        } label: {
                            Label("Review saved plans", systemImage: "list.bullet")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        Text("Saved plans and notification choices remain in sync in Nearcast while this native flow is being brought over.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(20)
            }
            .navigationTitle(isAsk ? "Ask" : "Plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", action: onClose)
                }
            }
            .onAppear { composerFocused = true }
        }
    }

    private var contextCard: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label("Using this forecast", systemImage: "location.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
            Text(place.name).font(.headline)
            Text(dayLabel).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.08)) }
        .accessibilityElement(children: .combine)
    }

    private var dayLabel: String {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: day)
    }

    private func suggestion(_ value: String) -> some View {
        Button(value) { draft = value }
            .font(.subheadline.weight(.medium))
            .buttonStyle(.bordered)
            .tint(.secondary)
    }

    private func openDraft() {
        guard !trimmedDraft.isEmpty else { return }
        let query = isAsk ? trimmedDraft : "Help me plan: \(trimmedDraft)"
        onOpenExisting(.ask, query)
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
