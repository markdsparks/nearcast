import SwiftUI
import Charts

/// An opt-in native weather journey. Explicit Places/Settings edits write
/// through to the existing owner until the separate ownership gate passes.
struct NativeWeatherPreviewView: View {
    @ObservedObject var model: NativeWeatherPreviewModel
    let onClose: () -> Void
    /// Compatibility hosts present Home as a dismissible preview. The
    /// native-only Dev root is the app's primary surface, so it deliberately
    /// omits that control instead of turning a normal close tap into a quiet
    /// WebKit escape.
    var showsCloseControl = true
    /// The retained compatibility host can offer its broader map explicitly.
    /// Native-only Dev does not expose it because a map visit must remain in
    /// the native app rather than becoming a disguised WebKit handoff.
    var allowsExistingMapHandoff = true
    /// If native weather cannot refresh, compatibility hosts may return to
    /// their surrounding preview. The native-only app keeps recovery local so
    /// an ordinary retry failure never sends someone into WebKit.
    var showsCompatibilityRecovery = true
    let onLegacy: (NativeLegacyDestination, String?) -> Void
    var onPlaces: (() -> Void)? = nil
    var onSettings: (() -> Void)? = nil
    /// Native-only hosts can present the verified, read-only Agenda without
    /// routing a tap through the legacy assistant shell. Compatibility hosts
    /// leave this nil and retain their existing Plans behavior unchanged.
    var onNativePlans: (() -> Void)? = nil
    var onNativeAsk: (() -> Void)? = nil
    var onLiveActivity: (() -> Void)? = nil
    /// Lets a native host keep the Plans destination visibly selected while
    /// its Agenda sheet is covering the weather surface.
    var nativePlansPresented = false
    /// A native Agenda can request the existing native Plan composer after it
    /// dismisses. The composer still hands actual plan creation to the proven
    /// compatibility owner on submit; this is not a second plan database.
    var nativePlanComposerPresentationRevision = 0
    /// The full native home persists a place choice through the verified
    /// Places owner. Read-only preview hosts intentionally leave this nil.
    var onSelectPlace: ((NativePreviewPlace) async -> Bool)? = nil
    /// Native-only setup may show cached locations for comparison before their
    /// verified saved-place handover. Keep that temporary state explicit in
    /// every location affordance so it never looks like a persisted switch.
    var usesTemporaryPlaces = false
    /// Hosts must opt in only while no ancestor presentation covers weather.
    /// A preview without lifecycle ownership remains a fully useful still.
    var isUncovered: Bool = false

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityDimFlashingLights) private var dimFlashingLights
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var metric: NativePreviewMetric = .temperature
    @State private var interval: NativePreviewInterval = .hourly
    @State private var dayAtAGlanceExpanded = false
    @State private var dayRhythmMetric: NativeDayRhythmMetric = .temperature
    @State private var legacyDestination: NativeLegacyDestination?
    @State private var confirmingLegacy = false
    @State private var showingNativeMap = false
    @State private var previewOpeningContext: NativeRadarOpeningContext?
    @State private var showEarlierHours = false
    @State private var rollingHourCount = 24
    @State private var hourlyEarlierHoursRevision = 0
    @State private var now = Date()
    @State private var scrollToTopRevision = 0
    @State private var weatherDetail: NativeWeatherDetailKind?
    @State private var switchingPlaceID: String?
    @State private var placeSwitchMessage: String?
    @State private var showingCurrentConditionExplanation = false
    @State private var assistantEntry: NativeAssistantEntryDestination?
    @State private var pendingNativeAssistantTarget: NativeAskForecastTarget?
    @State private var heroIsVisible = false
    @State private var skyHeroFrame: CGRect?
    @State private var scrollViewportHeight: CGFloat = 0
    @State private var isScrolling = false
    @State private var viewIsVisible = false
    @State private var isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    @State private var thermalState = ProcessInfo.processInfo.thermalState

    private var usesLivingSky: Bool { NativeLivingSkyFeature.isEnabled }

    private var isDark: Bool { (preferredScheme ?? colorScheme) == .dark }
    private var accent: Color { isDark ? Color(red: 0.57, green: 0.77, blue: 1) : Color(red: 0.16, green: 0.37, blue: 0.63) }
    private var secondaryInk: Color {
        guard usesLivingSky else { return Color.secondary }
        return isDark ? Color(red: 0.84, green: 0.89, blue: 0.92)
            : Color(red: 0.12, green: 0.19, blue: 0.23)
    }
    private var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: model.forecast?.timezoneID ?? model.selectedPlace.timezone ?? "") ?? .current
        return value
    }
    private var hasUsableForecast: Bool { model.hasUsableForecast(now: now) }
    /// Visual treatment must obey the same expiry boundary as the weather
    /// content. An old storm scene is still a weather claim, even if its rows
    /// have already been hidden.
    private var presentationForecast: NativeWeatherForecast? {
        hasUsableForecast ? model.forecast : nil
    }
    private var displayedDay: Date { model.selectedDay ?? now }
    private var isToday: Bool { calendar.isDate(displayedDay, inSameDayAs: now) }
    private var currentHourStart: Date { calendar.dateInterval(of: .hour, for: now)?.start ?? now }
    private var currentReadingIsStale: Bool {
        guard let current = model.forecast?.current else { return false }
        return now.timeIntervalSince(current.date) > 30 * 60
    }
    private var hasCurrentSkyEvidence: Bool {
        currentWeatherDecision.hasFreshReading
    }
    private var currentWeatherDecision: NativeCurrentWeatherDecision {
        NativeCurrentWeatherDecision(forecast: model.forecast, now: now)
    }
    private var currentReadingTime: String {
        guard let current = model.forecast?.current else { return "" }
        let datePrefix = calendar.isDate(current.date, inSameDayAs: now) ? "" : "\(dayName(current.date)), "
        return "\(datePrefix)\(clock(current.date)) local"
    }
    private var isHourly: Bool { model.destination == .hourly }
    private var isRollingHourly: Bool { isHourly && model.hourlyScope == .next24Hours }
    private var selectedForecastDay: NativeForecastDay? { model.forecast?.day(containing: displayedDay) }
    private var dayHours: [NativeForecastPoint] { model.forecast?.hours(on: displayedDay) ?? [] }
    private var remainingHours: [NativeForecastPoint] { dayHours.filter { $0.date >= currentHourStart } }
    private var previewDays: [NativeForecastDay] {
        let today = calendar.startOfDay(for: now)
        return Array((model.forecast?.days ?? []).filter { $0.date >= today }.prefix(14))
    }
    private var usableQuarterHours: [NativeForecastPoint] {
        if isHourly {
            return model.forecast?.hourlyQuarterHours(on: isRollingHourly ? nil : displayedDay, now: now) ?? []
        }
        return model.forecast?.previewQuarterHours(on: displayedDay, now: now) ?? []
    }
    private var offersQuarterHours: Bool { !usableQuarterHours.isEmpty }
    private var showingQuarterHours: Bool { interval == .quarterHour && offersQuarterHours }
    private var listPoints: [NativeForecastPoint] {
        if showingQuarterHours { return usableQuarterHours }
        if isRollingHourly {
            return model.forecast?.rollingHours(now: now, hours: rollingHourCount,
                includeEarlierToday: showEarlierHours) ?? []
        }
        return isToday && !showEarlierHours ? dayHours.filter { $0.date >= currentHourStart } : dayHours
    }
    private var trendPoints: [NativeForecastPoint] {
        if showingQuarterHours { return Array(usableQuarterHours.prefix(25)) }
        return model.forecast?.outlookTrendHours(on: displayedDay, now: now) ?? []
    }
    /// The compact Home strip is intentionally denser than the detailed
    /// hourly view. It keeps the full row treatment at large Dynamic Type,
    /// where readability wins over simultaneous coverage.
    private var usesDenseOutlookStrip: Bool {
        !showingQuarterHours && !dynamicTypeSize.isAccessibilitySize && dynamicTypeSize < .xxxLarge
    }
    /// The normal hourly screen is a scan surface. At larger accessibility
    /// sizes (and for 15-minute guidance), retain the roomier two-line row so
    /// neither a condition nor a decision cue has to be truncated.
    private var usesDenseHourlyRows: Bool {
        !showingQuarterHours && !dynamicTypeSize.isAccessibilitySize && dynamicTypeSize < .xxxLarge
    }
    private var outlookHasEarlierForecastGuidance: Bool {
        !isHourly && isToday && !showingQuarterHours && trendPoints.contains { $0.date < currentHourStart }
    }
    private var outlookScrollIdentity: String {
        let day = calendar.startOfDay(for: displayedDay).timeIntervalSince1970
        let current = isToday && !showingQuarterHours ? currentHourStart.timeIntervalSince1970 : -1
        return "\(model.selectedPlace.coordinateIdentity)|\(day)|\(showingQuarterHours)|\(current)"
    }
    /// A full native Hourly read is driven by actual hourly forecast rows. It
    /// intentionally leaves the provider's six-hour 15-minute feed as its own
    /// focused mode instead of pretending it can describe an entire day.
    private var dayRhythmPresentation: NativeDayRhythmPresentation? {
        guard !showingQuarterHours, !isRollingHourly, let forecast = presentationForecast else { return nil }
        return NativeDayRhythmPresentation.make(forecast: forecast, day: displayedDay, now: now)
    }
    /// One forecast-derived field drives the screen. It only translates data
    /// already on screen into light and depth; it never creates a stronger
    /// weather claim than the forecast itself.
    private var visualPoint: NativeForecastPoint? {
        guard let forecast = presentationForecast else { return nil }
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

    /// Only navigation to an actual provider-backed hour changes the sky.
    /// A rolling route can focus tomorrow without selecting tomorrow as its
    /// calendar-day scope. Chart inspection and ordinary scrolling never
    /// write this route focus.
    private var explicitHourlySkyFocus: Date? {
        guard isHourly, let focus = model.hourlyFocus, let forecast = presentationForecast,
              isRollingHourly || calendar.isDate(focus, inSameDayAs: displayedDay) else { return nil }
        let hasHourlyEvidence = forecast.hours.contains {
            $0.hasReadings && $0.date <= focus && focus < $0.date.addingTimeInterval(3_600)
        }
        let hasQuarterHourEvidence = forecast.quarterHours.contains {
            $0.hasReadings && $0.date <= focus && focus < $0.date.addingTimeInterval(900)
        }
        return hasHourlyEvidence || hasQuarterHourEvidence ? focus : nil
    }

    private var livingSkyScene: NativeLivingSkyScene {
        if let focus = explicitHourlySkyFocus {
            return .resolve(forecast: presentationForecast, context: .forecast(focus), now: now,
                latitude: model.selectedPlace.latitude, longitude: model.selectedPlace.longitude)
        }
        guard !isToday, let forecast = presentationForecast else {
            return .resolve(forecast: presentationForecast, now: now,
                latitude: model.selectedPlace.latitude, longitude: model.selectedPlace.longitude)
        }
        let noon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: displayedDay) ?? displayedDay
        // The day's summary can set its cloud character, but daily averages
        // are not evidence of direct sunlight at noon. Leave radiation unset.
        let point = selectedForecastDay.map { day in
            NativeForecastPoint(date: noon, weatherCode: day.weatherCode,
                thunderPossible: day.thunderPossible, cloudCover: visualPoint?.cloudCover)
        }
        return .resolve(forecast: forecast, point: point, context: .forecast(noon), now: now,
            latitude: model.selectedPlace.latitude, longitude: model.selectedPlace.longitude)
    }

    private var livingSkyMotionAllowed: Bool {
        // Older systems keep the still rather than animate without a reliable
        // scroll phase signal. All gates are state/notification driven.
        guard #available(iOS 18.0, *) else { return false }
        return usesLivingSky && hasUsableForecast && viewIsVisible && isUncovered && scenePhase == .active
            && isToday && !isHourly && hasCurrentSkyEvidence && heroIsVisible && !isScrolling
            && weatherDetail == nil && assistantEntry == nil && !showingNativeMap && !confirmingLegacy
            && !showingCurrentConditionExplanation
            && switchingPlaceID == nil && !reduceMotion && !reduceTransparency
            && colorSchemeContrast != .increased && !isLowPowerMode
            && (thermalState == .nominal || thermalState == .fair)
    }

    private var radarPreviewWorkAllowed: Bool {
        viewIsVisible && isUncovered && scenePhase == .active && isToday && !isHourly && !isScrolling
            && weatherDetail == nil && assistantEntry == nil && !showingNativeMap && !confirmingLegacy
            && !showingCurrentConditionExplanation && switchingPlaceID == nil
    }

    private var livingSkyIdentity: String {
        let context: String
        if let focus = explicitHourlySkyFocus {
            context = "hour:\(focus.timeIntervalSince1970)"
        } else if isToday {
            context = "current"
        } else {
            context = "day:\(calendar.startOfDay(for: displayedDay).timeIntervalSince1970)"
        }
        // Weather refresh timestamps deliberately do not reset motion. Place
        // and intentional time changes must never crossfade unrelated skies.
        return "\(model.selectedPlace.coordinateIdentity)|\(context)"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                skyBackground
                ScrollViewReader { scroll in
                    ScrollView {
                        VStack(spacing: 20) {
                            Color.clear.frame(height: 0).id("native-preview-top")
                            if let forecast = model.forecast, hasUsableForecast {
                                freshness(forecast)
                                NativeWeatherEssentialNotices(model: model, day: displayedDay, now: now) { weatherDetail = $0 }
                                if isHourly {
                                    hourlyContent
                                } else {
                                    hero
                                    outlookCard
                                    if isToday {
                                        NativeRadarPreviewCard(place: model.selectedPlace, now: now,
                                            viewportHeight: scrollViewportHeight, isActive: radarPreviewWorkAllowed) { context in
                                            previewOpeningContext = context
                                            showingNativeMap = true
                                        }
                                        .id("radar-preview|\(model.selectedPlace.coordinateIdentity)")
                                    }
                                    dailyList
                                    if !usesTemporaryPlaces { familyPlacesRail }
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
                    .coordinateSpace(name: "native-weather-scroll")
                    .onGeometryChange(for: CGFloat.self) { geometry in
                        geometry.size.height
                    } action: { height in
                        scrollViewportHeight = height
                    }
                    .modifier(NativeSkyMotionScrollGate(isScrolling: $isScrolling))
                    .onChange(of: model.destination) { _, _ in
                        scrollToRouteTarget(scroll)
                    }
                    .onChange(of: model.selectedDay) { _, _ in
                        scrollToRouteTarget(scroll)
                    }
                    .onChange(of: model.hourlyFocusRevision) { _, _ in
                        // A Day rhythm selection can intentionally target the
                        // same hour twice. Keep the exact Date stable for the
                        // forecast and sky, but honor each explicit tap by
                        // running the scroll route again.
                        scrollToRouteTarget(scroll)
                    }
                    .onChange(of: hourlyEarlierHoursRevision) { _, _ in
                        DispatchQueue.main.async {
                            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) {
                                // Expanding historical guidance must preserve
                                // the reader's current context, not strand
                                // them at local midnight.
                                scroll.scrollTo(hourlyRowAnchor(currentHourStart), anchor: .center)
                            }
                        }
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
            .safeAreaInset(edge: .top, spacing: 0) { weatherHeader }
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomNavigation }
            .toolbar(.hidden, for: .navigationBar)
            .tint(accent)
            .sheet(item: $weatherDetail) { kind in
                NativeWeatherDetailsSheet(model: model, kind: kind, day: displayedDay)
                    .presentationDragIndicator(.visible)
            }
            .alert("About current conditions", isPresented: $showingCurrentConditionExplanation) {
                Button("Done", role: .cancel) { }
            } message: {
                Text(currentWeatherDecision.conditionExplanation ?? "Current conditions are a weather-model estimate for this location.")
            }
            .fullScreenCover(isPresented: $showingNativeMap) {
                NativeRadarView(
                    place: model.selectedPlace,
                    timezone: model.forecast?.timezoneID ?? model.selectedPlace.timezone,
                    uses24HourClock: model.context.uses24HourClock,
                    initialContext: previewOpeningContext,
                    savedPlaces: model.places,
                    onSelectPlace: onSelectPlace == nil ? nil : { place in
                        await selectPlace(place)
                    },
                    onAskAboutPlace: {
                        showingNativeMap = false
                        if let onNativeAsk { onNativeAsk() } else { assistantEntry = .ask }
                    },
                    onClose: { showingNativeMap = false },
                    onExistingMap: allowsExistingMapHandoff ? {
                        showingNativeMap = false
                        requestLegacy(.map)
                    } : nil
                )
                .id(model.selectedPlace.coordinateIdentity)
            }
            .confirmationDialog("Continue in Nearcast?", isPresented: $confirmingLegacy, titleVisibility: .visible) {
                Button("Open Nearcast") {
                    if let destination = legacyDestination { onLegacy(destination, nil) }
                }
                Button("Stay here", role: .cancel) { legacyDestination = nil }
            } message: {
                Text("Continue with \(model.selectedPlace.name) in Nearcast. Quick forecast reads stay here; broader Ask requests and plan management still continue there while weather, widgets and Watch stay in sync here.")
            }
            .sheet(item: $assistantEntry, onDismiss: {
                guard let target = pendingNativeAssistantTarget else { return }
                pendingNativeAssistantTarget = nil
                Task {
                    let context = NativePreviewContext(version: model.context.version, selectedPlace: target.place,
                        savedPlaces: model.context.savedPlaces, metric: model.context.metric,
                        uses24HourClock: model.context.uses24HourClock, theme: model.context.theme)
                    model.applyManagedContext(context)
                    await model.refresh()
                    model.showHourly(day: target.day, focusedHour: target.hour)
                }
            }) { destination in
                if destination == .ask {
                    NativeAskExperience(context: model.context, day: displayedDay,
                        onDone: { assistantEntry = nil },
                        onHourly: { pendingNativeAssistantTarget = $0; assistantEntry = nil })
                } else {
                    NativePlansExperience(context: model.context, day: displayedDay,
                        onDone: { assistantEntry = nil },
                        onHourly: { item in
                            if let calendar = try? NativePlanSchedule.calendar(item.place),
                               let date = NativePlanSchedule.date(item.startDate, hour: item.startHour, calendar: calendar) {
                                pendingNativeAssistantTarget = .init(place: item.place.previewPlace, day: date, hour: date)
                                assistantEntry = nil
                            }
                        })
                }
            }
            .onChange(of: model.selectedDay) { _, _ in
                if !offersQuarterHours { interval = .hourly }
                showEarlierHours = false
                ensureAvailableMetric()
                dayRhythmMetric = NativeDayRhythmMetric(previewMetric: metric)
            }
            .onChange(of: model.hourlyFocusRevision) { _, _ in
                rollingHourCount = 24
                showEarlierHours = model.hourlyFocus.map { $0 < currentHourStart } ?? false
                if !offersQuarterHours { interval = .hourly }
            }
            .onChange(of: nativePlanComposerPresentationRevision) { _, revision in
                guard revision > 0 else { return }
                assistantEntry = .plans
            }
            .onChange(of: model.selectedPlace.coordinateIdentity) { _, _ in
                interval = .hourly
                rollingHourCount = 24
                showEarlierHours = false
                ensureAvailableMetric()
                dayRhythmMetric = NativeDayRhythmMetric(previewMetric: metric)
            }
            .onChange(of: interval) { _, next in
                ensureAvailableMetric()
                if next == .hourly {
                    dayRhythmMetric = NativeDayRhythmMetric(previewMetric: metric)
                }
            }
            .onChange(of: metric) { _, next in
                guard !showingQuarterHours else { return }
                let mapped = NativeDayRhythmMetric(previewMetric: next)
                if dayRhythmMetric != mapped { dayRhythmMetric = mapped }
            }
            .onChange(of: dayRhythmMetric) { _, next in
                guard !showingQuarterHours, let mapped = next.previewMetric else { return }
                if metric != mapped { metric = mapped }
            }
            .onChange(of: model.forecast?.generatedAt) { _, _ in
                ensureAvailableMetric()
                if !showingQuarterHours, dayRhythmMetric.previewMetric != nil {
                    dayRhythmMetric = NativeDayRhythmMetric(previewMetric: metric)
                }
            }
            .onChange(of: offersQuarterHours) { _, available in
                if !available { interval = .hourly }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                updatePowerState()
                now = Date()
                _ = model.expireForecastIfNeeded(now: now)
                if !model.isLoading && (model.forecast.map { now.timeIntervalSince($0.generatedAt) > 5 * 60 } ?? true) {
                    Task { await model.refresh() }
                }
            }
            .onAppear {
                updatePowerState()
                viewIsVisible = true
                now = Date()
                _ = model.expireForecastIfNeeded(now: now)
            }
            .onDisappear {
                viewIsVisible = false
                isScrolling = false
            }
            .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)
                .receive(on: RunLoop.main)) { _ in
                updatePowerState()
            }
            .onReceive(NotificationCenter.default.publisher(for: ProcessInfo.thermalStateDidChangeNotification)
                .receive(on: RunLoop.main)) { _ in
                updatePowerState()
            }
            .task {
                // The screen must age even without touches. This clock never
                // registers background work or increases notification delivery.
                while !Task.isCancelled {
                    if scenePhase == .active {
                        now = Date()
                        _ = model.expireForecastIfNeeded(now: now)
                        model.refreshEssentialsIfNeeded(now: now)
                    }
                    do { try await Task.sleep(for: .seconds(60)) }
                    catch { return }
                }
            }
        }
        .preferredColorScheme(preferredScheme)
    }

    private func updatePowerState() {
        isLowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        thermalState = ProcessInfo.processInfo.thermalState
    }

    /// Today’s compact trend is useful for scanning. When someone chooses a
    /// specific column, preserve that intent instead of dropping them at the
    /// beginning of the full-day list.
    private func scrollToRouteTarget(_ scroll: ScrollViewProxy) {
        // Route state and the lazy list must settle together before the
        // target can be resolved, particularly for an earlier Home column.
        DispatchQueue.main.async {
            if model.destination == .hourly, let focusedHour = model.hourlyFocus,
               let target = listPoints.min(by: {
                   abs($0.date.timeIntervalSince(focusedHour)) < abs($1.date.timeIntervalSince(focusedHour))
               }) {
                scroll.scrollTo(hourlyRowAnchor(target.date), anchor: .top)
            } else {
                scroll.scrollTo("native-preview-top", anchor: .top)
            }
        }
    }

    private func hourlyRowAnchor(_ date: Date) -> String {
        "native-hourly-row-\(date.timeIntervalSince1970)"
    }

    private var preferredScheme: ColorScheme? {
        switch model.context.theme.lowercased() {
        case "dark": return .dark
        case "light": return .light
        default:
            if explicitHourlySkyFocus != nil, let isDaylight = livingSkyScene.isDaylight {
                return isDaylight ? .light : .dark
            }
            // Nearcast's automatic appearance follows the selected place,
            // not the phone's local clock or its system appearance schedule.
            // Solar events take precedence over the snapshot's stale-safe
            // current reading, so the screen changes at local sunrise/sunset
            // even before the next forecast refresh.
            if let forecast = presentationForecast,
               let isDay = NativeSunDaylight.automaticAppearanceIsDaylight(forecast: forecast, now: now) {
                return isDay ? .light : .dark
            }
            return nil
        }
    }

    @ViewBuilder private var skyBackground: some View {
        if usesLivingSky {
            NativeLivingSkyBackdrop(
                scene: livingSkyScene, isDark: isDark,
                reading: isHourly || !heroIsVisible,
                increasedContrast: colorSchemeContrast == .increased,
                reduceTransparency: reduceTransparency,
                motionAllowed: livingSkyMotionAllowed,
                reduceMotion: reduceMotion,
                dimFlashingLights: dimFlashingLights,
                sceneIdentity: livingSkyIdentity,
                immediateMotionStop: scenePhase != .active || !viewIsVisible || !isUncovered
                    || isLowPowerMode || thermalState == .serious || thermalState == .critical,
                precipitationFocus: skyHeroFrame
            )
            .ignoresSafeArea()
        } else {
            NativeAtmosphericField(
                point: visualPoint, usesMetric: model.context.metric, isDark: isDark,
                reduceMotion: reduceMotion, increasedContrast: colorSchemeContrast == .increased,
                placement: isHourly ? .hourly : .backdrop
            )
            .ignoresSafeArea()
        }
    }

    /// One persistent doorway to Places and one quiet menu. The forecast owns
    /// the rest of the screen; setup guidance belongs beside its Places action.
    private var weatherHeader: some View {
        HStack(spacing: 12) {
            if showsCloseControl {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close weather preview")
            }
            placePicker
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
            Menu {
                if let onPlaces {
                    Button(action: onPlaces) { Label("Places", systemImage: "mappin.and.ellipse") }
                }
                if let onSettings {
                    Button(action: onSettings) { Label("Settings", systemImage: "gearshape") }
                }
                if let onLiveActivity {
                    Button(action: onLiveActivity) { Label("Live Activity", systemImage: "platter.filled.bottom.iphone") }
                }
                Section {
                    Button { weatherDetail = .overview } label: {
                        Label("Weather details", systemImage: "list.bullet")
                    }
                    .disabled(!hasUsableForecast)
                    Button { Task { await model.refresh() } } label: {
                        Label(model.isLoading ? "Updating forecast…" : "Refresh forecast", systemImage: "arrow.clockwise")
                    }
                    .disabled(model.isLoading)
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .background(.primary.opacity(isDark ? 0.08 : 0.045), in: Circle())
                    .contentShape(Circle())
            }
            .accessibilityLabel("More options")
            .accessibilityHint("Places, settings, weather details and refresh")
            .accessibilityIdentifier("nearcast.weather.options")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background {
            // Keep the sky uninterrupted at rest, with a reading surface only
            // when forecast content scrolls behind the pinned controls.
            if isHourly || !heroIsVisible {
                Rectangle().fill(.ultraThinMaterial)
                    .ignoresSafeArea(edges: .top)
            }
        }
    }

    private var placePicker: some View {
        Group {
            if let onPlaces {
                Button(action: onPlaces) { placePickerLabel }
                    .buttonStyle(NativePlacePickerButtonStyle(
                        accent: accent,
                        isDark: isDark,
                        reduceMotion: reduceMotion,
                        increasedContrast: colorSchemeContrast == .increased
                    ))
                    .accessibilityLabel("Places, \(model.selectedPlace.name)")
                    .accessibilityIdentifier("nearcast.weather.places")
                    .accessibilityHint(usesTemporaryPlaces
                        ? "Compare cached places, or finish setup to add and manage saved places."
                        : "Choose, add or edit your saved places.")
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
                    placePickerLabel
                }
                .disabled(model.places.isEmpty)
                .accessibilityLabel("Places, \(model.selectedPlace.name)")
                .accessibilityHint("Choose a temporary place for this preview. Saved places are unchanged.")
            }
        }
    }

    private var placePickerLabel: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(usesTemporaryPlaces ? "NEARCAST · PREVIEW" : "NEARCAST")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .tracking(1.8)
                .foregroundStyle(secondaryInk.opacity(0.72))
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(model.selectedPlace.name)
                    .font(.system(.title3, design: .rounded, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(secondaryInk)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(.primary)
        .frame(minHeight: 44, alignment: .leading)
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var familyPlacesRail: some View {
        if onSelectPlace != nil, model.places.count > 1 {
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Text(usesTemporaryPlaces ? "Places in this preview" : "Family places")
                        .font(.subheadline.weight(.bold))
                    Spacer()
                    if let onPlaces {
                        Button(usesTemporaryPlaces ? "Set up" : "Manage", action: onPlaces)
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
                if usesTemporaryPlaces {
                    Text("Temporary preview only. Set up saved places to keep changes across Nearcast.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let placeSwitchMessage {
                    Text(placeSwitchMessage)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(usesTemporaryPlaces ? "Places in this preview" : "Family places")
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
                    Text(selected ? (usesTemporaryPlaces ? "Viewing now" : "Current place") : localClock(for: place))
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
        .accessibilityLabel("\(place.name), \(selected ? (usesTemporaryPlaces ? "viewing now" : "current place") : "local time \(localClock(for: place))")")
        .accessibilityHint(selected
            ? "Selected weather place"
            : (usesTemporaryPlaces ? "Show this place temporarily in Nearcast." : "Switch weather to this saved place"))
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
            .foregroundStyle(secondaryInk)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var hero: some View {
        let suppressMeasurement = isScrolling
        return VStack(spacing: 6) {
            if !isToday {
                selectedDayNavigation
            } else if currentReadingIsStale {
                Text("Last reading · \(currentReadingTime)")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(secondaryInk)
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
                if currentWeatherDecision.conditionExplanation != nil {
                    Button { showingCurrentConditionExplanation = true } label: {
                        HStack(spacing: 6) {
                            Text(heroCondition(current))
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                            Image(systemName: "info.circle")
                                .font(.caption)
                                .foregroundStyle(secondaryInk)
                        }
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Why the current precipitation estimate is uncertain")
                } else {
                    Text(heroCondition(current))
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if usesLivingSky, hasCurrentSkyEvidence, current.thunderPossible,
                   !NativeWeatherCondition.isThunder(current.weatherCode) {
                    // A forecast possibility must not replace the sky
                    // condition or imply storms are occurring right now.
                    Text("Storm chance in the forecast")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(secondaryInk)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if let day = selectedForecastDay {
                Text(day.conditionLabel)
                    .font(.headline)
                    .multilineTextAlignment(.center)
            }
            if let day = selectedForecastDay {
                Text("High \(temperature(day.high))  ·  Low \(temperature(day.low))")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(secondaryInk)
                    .monospacedDigit()
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .padding(.bottom, 14)
        .onGeometryChange(for: CGRect?.self) { geometry in
            // No forecast/state invalidation every scroll frame. When native
            // scroll tracking settles, its idle state re-samples this geometry.
            suppressMeasurement ? nil : geometry.frame(in: .global).integral
        } action: { frame in
            if let frame, skyHeroFrame != frame { skyHeroFrame = frame }
        }
        .modifier(NativeSkyHeroVisibilityGate(viewportHeight: scrollViewportHeight) { visible in
            guard usesLivingSky, heroIsVisible != visible else { return }
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.35)) {
                heroIsVisible = visible
            }
        })
        .background {
            if !usesLivingSky {
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
    }

    private func heroCondition(_ point: NativeForecastPoint) -> String {
        if !hasCurrentSkyEvidence { return "Current conditions unavailable" }
        let condition = currentWeatherDecision.conditionLabel
        guard let apparent = point.apparentTemperature, let actual = point.temperature,
              abs(apparent - actual) >= (model.context.metric ? 1 : 2) else { return condition }
        return "\(condition) · feels \(temperature(apparent))"
    }

    private var selectedDayNavigation: some View {
        HStack(spacing: 6) {
            dayStepButton(-1)
            VStack(spacing: 3) {
                Text(dayName(displayedDay)).font(.title2.weight(.bold))
                Text(dayName(displayedDay, full: true))
                    .font(.caption).foregroundStyle(secondaryInk)
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
        weatherSymbol(heroSymbolName, size: 60)
            .frame(minWidth: 70, minHeight: 70)
            .accessibilityHidden(true)
    }

    private var heroSymbolName: String {
        guard isToday else { return selectedForecastDay?.symbolName ?? "questionmark.circle" }
        guard currentWeatherDecision.hasFreshReading else { return "questionmark.circle" }
        // Solar time belongs to the selected place, not the interface theme
        // or an isDay bit retained from a reading before sunrise/sunset.
        return NativeWeatherCondition.symbol(currentWeatherDecision.presentationWeatherCode, isDay: livingSkyScene.isDaylight)
    }

    private var outlookCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .center) {
                    Text(outlook?.eyebrow ?? "OUTLOOK")
                        .font(.caption.weight(.heavy))
                        .tracking(1.2)
                    Spacer(minLength: 8)
                    Button { model.showHourly(day: isToday ? nil : model.selectedDay) } label: {
                        Image(systemName: "arrow.up.right")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                        .accessibilityLabel(isToday ? "Open the next 24 hours" : "Open hourly details for \(dayName(displayedDay))")
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
                    .foregroundStyle(secondaryInk)
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
                    if !usesLivingSky {
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
                        .foregroundStyle(secondaryInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !showingQuarterHours && outlookHasEarlierForecastGuidance {
                    Text("Earlier hours · forecast guidance")
                        .font(.caption)
                        .foregroundStyle(secondaryInk)
                }
            } else {
                HStack(spacing: 8) {
                    Text("Hourly · local time")
                    if outlookHasEarlierForecastGuidance {
                        Text("Earlier · forecast guidance")
                            .foregroundStyle(secondaryInk)
                    }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(secondaryInk)
            }
        }
    }

    private func intervalButton(_ title: String, value: NativePreviewInterval) -> some View {
        Button { interval = value } label: {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(interval == value ? accent : secondaryInk)
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
                    .foregroundStyle(secondaryInk)
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
        let dense = usesDenseOutlookStrip
        // Seven 46-point targets fit inside the standard Home card. The
        // timeline remains horizontally scrollable rather than shrinking a
        // tap target below the platform's 44-point minimum.
        let columnWidth: CGFloat = dense ? 46 : (dynamicTypeSize.isAccessibilitySize ? 152 : (dynamicTypeSize >= .xxxLarge ? 108 : 78))
        let plotWidth = max(columnWidth, CGFloat(points.count) * columnWidth)
        let chartHeight: CGFloat = dense ? 68 : (dynamicTypeSize.isAccessibilitySize ? 120 : 92)
        let step = showingQuarterHours ? 15.0 * 60 : 60.0 * 60
        let samples = chartSamples(points, step: step)
        let domain = metric.domain(points)
        let span = max(1, domain.upperBound - domain.lowerBound)
        return ScrollViewReader { scroll in
            ScrollView(.horizontal) {
                VStack(spacing: dense ? 2 : 4) {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(points, id: \.id) { point in
                            compactHourHeader(point, columnWidth: columnWidth, dense: dense)
                        }
                    }
                    .accessibilityHidden(true)
                    Chart(samples) { sample in
                        if let value = metric.value(sample.point) {
                            LineMark(x: .value("Interval", sample.index), y: .value(metric.accessibleLabel, value), series: .value("Continuous coverage", sample.segment))
                                .lineStyle(StrokeStyle(lineWidth: dense ? 2 : 2.5, lineCap: .round, lineJoin: .round))
                                .foregroundStyle(accent)
                            PointMark(x: .value("Interval", sample.index), y: .value(metric.accessibleLabel, value))
                                .symbolSize(dense ? 17 : 23)
                                .foregroundStyle(accent)
                                .annotation(position: .top, spacing: dense ? 3 : 5) {
                                    Text(outlookMetricValue(sample.point, dense: dense))
                                        .font(dense ? .system(size: 13, weight: .bold, design: .rounded) : .system(.body, design: .rounded, weight: .bold))
                                        .monospacedDigit()
                                        .foregroundStyle(isEarlierOutlookPoint(sample.point) ? secondaryInk : accent)
                                        .fixedSize()
                                }
                        }
                    }
                    .chartXScale(domain: -0.5...max(0.5, Double(points.count) - 0.5))
                    // Annotation headroom is real layout space, not clipped text
                    // at 100% rain or the top of a temperature curve.
                    .chartYScale(domain: (domain.lowerBound - span * 0.08)...(domain.upperBound + span * (dense ? 0.25 : 0.30)))
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .chartLegend(.hidden)
                    .frame(width: plotWidth, height: chartHeight)
                    .accessibilityHidden(true)
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(points, id: \.id) { point in
                            compactHourFooter(point, columnWidth: columnWidth, dense: dense)
                        }
                    }
                    .accessibilityHidden(true)
                }
                .background {
                    HStack(spacing: 0) {
                        ForEach(points, id: \.id) { point in
                            RoundedRectangle(cornerRadius: dense ? 12 : 16, style: .continuous)
                                .fill(outlookTileFill(point))
                                .frame(width: columnWidth)
                        }
                    }
                    .accessibilityHidden(true)
                }
                // Each time, icon, chart value, and planning cue form one
                // target. The detailed Hourly view remains the place for the
                // full condition sentence and all readings.
                .overlay {
                    GeometryReader { proxy in
                        HStack(spacing: 0) {
                            ForEach(points, id: \.id) { point in
                                compactHourButton(
                                    point,
                                    columnWidth: columnWidth,
                                    height: proxy.size.height,
                                    dense: dense
                                )
                            }
                        }
                        .frame(width: plotWidth, height: proxy.size.height, alignment: .leading)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .onAppear { positionOutlookTimeline(scroll, points: points) }
            .onChange(of: outlookScrollIdentity) { _, _ in
                positionOutlookTimeline(scroll, points: points, animated: true)
            }
        }
        .accessibilityLabel(outlookHasEarlierForecastGuidance
            ? "Scrollable hourly forecast. Earlier values are forecast guidance, not observations."
            : "Scrollable \(showingQuarterHours ? "15-minute" : "hourly") forecast")
    }

    private func openCompactHour(_ point: NativeForecastPoint) {
        model.showHourly(day: isToday ? nil : point.date, focusedHour: point.date)
    }

    /// The visual header deliberately stays noninteractive: the transparent
    /// control layered over the full column below owns both hit testing and
    /// accessibility. That makes the entire weather tile feel like one native
    /// button while preserving a single continuous chart behind it.
    private func compactHourHeader(_ point: NativeForecastPoint, columnWidth: CGFloat, dense: Bool) -> some View {
        VStack(spacing: dense ? 5 : 8) {
            Text(isOutlookCurrentPoint(point) ? "Now" : (dense ? compactOutlookClock(point.date) : clock(point.date, compact: !showingQuarterHours)))
                .font(dense ? .caption2.weight(.bold) : .caption.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
            weatherSymbol(point.symbolName, size: dense ? 23 : 27)
                .frame(height: dense ? 26 : 32)
                .accessibilityHidden(true)
        }
        .padding(.top, dense ? 8 : 10)
        .padding(.bottom, dense ? 4 : 6)
        .frame(minHeight: dense ? 56 : 76)
        .frame(width: columnWidth)
        .opacity(isEarlierOutlookPoint(point) ? 0.58 : 1)
    }

    /// Isolated from `trendChart` so Swift's type checker does not have to
    /// infer the whole chart, its labels, and this full-column control at once.
    private func compactHourButton(_ point: NativeForecastPoint, columnWidth: CGFloat, height: CGFloat, dense: Bool) -> some View {
        Button { openCompactHour(point) } label: {
            Color.clear
                .frame(width: columnWidth, height: height)
                .contentShape(RoundedRectangle(cornerRadius: dense ? 12 : 16, style: .continuous))
                .accessibilityHidden(true)
        }
        .buttonStyle(NativeCompactHourButtonStyle(
            accent: accent,
            isDark: isDark,
            reduceMotion: reduceMotion,
            increasedContrast: colorSchemeContrast == .increased,
            dense: dense
        ))
        .id(outlookHourAnchor(point.date))
        .accessibilityLabel("Open \(clock(point.date)) hourly details")
        .accessibilityHint("Show the detailed forecast at this time")
    }

    @ViewBuilder
    private func compactHourFooter(_ point: NativeForecastPoint, columnWidth: CGFloat, dense: Bool) -> some View {
        if dense {
            VStack(spacing: 3) {
                HStack(spacing: 2) {
                    Image(systemName: metric == .rain ? "thermometer.medium" : "drop.fill")
                        .font(.system(size: 8, weight: .semibold))
                    Text(denseSecondaryRead(point))
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                }
                .foregroundStyle(isEarlierOutlookPoint(point) ? secondaryInk.opacity(0.72) : secondaryInk)
                if isFirstOutlookDayBoundary(point) {
                    Text(dayName(point.date))
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(accent)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 1)
            .padding(.bottom, 8)
            .frame(minHeight: 27, alignment: .top)
            .frame(width: columnWidth)
        } else {
            VStack(spacing: 5) {
                if metric.value(point) == nil {
                    Text("—").font(.body.weight(.bold)).foregroundStyle(secondaryInk)
                }
                Text(point.conditionLabel.replacingOccurrences(of: "Thunderstorms", with: "Storms"))
                    .font(.caption.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minHeight: 32, alignment: .top)
                Text(secondaryRead(point))
                    .font(.caption)
                    .foregroundStyle(secondaryInk)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if isFirstOutlookDayBoundary(point) {
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

    private func denseSecondaryRead(_ point: NativeForecastPoint) -> String {
        if metric == .rain { return temperature(point.temperature) }
        return point.rainProbability.map { "\(Int($0.rounded()))%" } ?? "—"
    }

    private func outlookMetricValue(_ point: NativeForecastPoint, dense: Bool) -> String {
        guard dense else { return metric.formatted(point, metricUnits: model.context.metric) }
        guard let value = metric.value(point), value.isFinite else { return "—" }
        switch metric {
        case .temperature, .feelsLike:
            return "\(Int(value.rounded()))°"
        case .rain:
            return "\(Int(value.rounded()))%"
        case .wind:
            // The selected Wind control establishes the units; keeping the
            // label compact preserves the 44-point target and seven-hour read.
            return "\(Int(value.rounded()))"
        case .uv:
            return String(format: "%.1f", value)
        }
    }

    private func compactOutlookClock(_ date: Date) -> String {
        guard !model.context.uses24HourClock else { return clock(date, compact: true) }
        let formatter = DateFormatter()
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "ha"
        return formatter.string(from: date).lowercased()
    }

    private func isOutlookCurrentPoint(_ point: NativeForecastPoint) -> Bool {
        isToday && !showingQuarterHours && point.date == currentHourStart
    }

    private func isEarlierOutlookPoint(_ point: NativeForecastPoint) -> Bool {
        isToday && !showingQuarterHours && point.date < currentHourStart
    }

    private func isFirstOutlookDayBoundary(_ point: NativeForecastPoint) -> Bool {
        guard let index = trendPoints.firstIndex(where: { $0.id == point.id }), index > 0 else { return false }
        return !calendar.isDate(point.date, inSameDayAs: trendPoints[index - 1].date)
    }

    private func outlookTileFill(_ point: NativeForecastPoint) -> Color {
        if isOutlookCurrentPoint(point) {
            return accent.opacity(isDark ? 0.15 : 0.09)
        }
        if isEarlierOutlookPoint(point) {
            return secondaryInk.opacity(isDark ? 0.055 : 0.035)
        }
        return .clear
    }

    private func outlookHourAnchor(_ date: Date) -> String {
        "native-outlook-hour-\(date.timeIntervalSince1970)"
    }

    private func positionOutlookTimeline(_ scroll: ScrollViewProxy, points: [NativeForecastPoint], animated: Bool = false) {
        let target: NativeForecastPoint?
        if isToday && !showingQuarterHours {
            target = points.first(where: isOutlookCurrentPoint) ?? points.first
        } else {
            target = points.first
        }
        guard let target else { return }
        DispatchQueue.main.async {
            let action = { scroll.scrollTo(outlookHourAnchor(target.date), anchor: isToday && !showingQuarterHours ? .center : .leading) }
            if animated && !reduceMotion {
                withAnimation(.easeOut(duration: 0.2), action)
            } else {
                action()
            }
        }
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
                Text("Low / High").font(.caption).foregroundStyle(secondaryInk)
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
                Text("Daily forecast is unavailable.").foregroundStyle(secondaryInk)
            }
        }
        .padding(.horizontal, 4)
    }

    private func dailyRow(_ day: NativeForecastDay) -> some View {
        let selected = !isToday && calendar.isDate(day.date, inSameDayAs: displayedDay)
        return Button { model.showHourly(day: day.date) } label: {
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
                            .foregroundStyle(secondaryInk)
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
                    .foregroundStyle(secondaryInk)
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
        .accessibilityHint("Open this day’s hourly forecast")
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
                    Capsule().fill(dailyTemperatureGradient(low: low, high: high))
                        .frame(width: max(3, geometry.size.width * (end - start)))
                        .offset(x: min(geometry.size.width - 3, geometry.size.width * start))
                }
            }
        }
        .accessibilityHidden(true)
    }

    /// The position shows a day against this forecast's overall range; the
    /// fill itself shows how that day will feel. Keeping those two jobs
    /// separate makes a hot day visibly warm even when all seven days are hot.
    private func dailyTemperatureGradient(low: Double, high: Double) -> LinearGradient {
        let middle = low + (high - low) * 0.5
        return LinearGradient(
            colors: [
                dailyTemperatureColor(low),
                dailyTemperatureColor(middle),
                dailyTemperatureColor(high)
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    private func dailyTemperatureColor(_ temperature: Double) -> Color {
        // Forecast values use the selected display system, so normalize the
        // palette stops to Fahrenheit before choosing a semantic color.
        let fahrenheit = model.context.metric ? temperature * 9 / 5 + 32 : temperature
        switch fahrenheit {
        case ..<20:
            return Color(red: 0.22, green: 0.43, blue: 0.82) // bitter cold
        case ..<40:
            return Color(red: 0.20, green: 0.62, blue: 0.88) // cool
        case ..<58:
            return Color(red: 0.15, green: 0.69, blue: 0.68) // mild
        case ..<72:
            return Color(red: 0.35, green: 0.70, blue: 0.36) // comfortable
        case ..<84:
            return Color(red: 0.83, green: 0.70, blue: 0.13) // warm
        case ..<94:
            return Color(red: 0.95, green: 0.47, blue: 0.11) // hot
        default:
            return Color(red: 0.84, green: 0.20, blue: 0.18) // extreme heat
        }
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
            Text(temperature(day.low)).foregroundStyle(secondaryInk)
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

    /// A daypart read belongs above Hourly's exact rows when it changes a
    /// decision. It deliberately stays out of calm, repetitive days so the
    /// detailed forecast remains the first thing someone scans.
    @ViewBuilder
    private var dayAtAGlance: some View {
        if let presentation = dayRhythmPresentation, presentation.isWorthShowing {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    if reduceMotion {
                        dayAtAGlanceExpanded.toggle()
                    } else {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            dayAtAGlanceExpanded.toggle()
                        }
                    }
                } label: {
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("DAY AT A GLANCE")
                                .font(.caption.weight(.heavy))
                                .tracking(1.1)
                                .foregroundStyle(accent)
                            Text(dayAtAGlanceTitle(presentation))
                                .font(.headline.weight(.bold))
                            Text(dayAtAGlanceSummary(presentation))
                                .font(.subheadline)
                                .foregroundStyle(secondaryInk)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: dayAtAGlanceExpanded ? "chevron.up" : "chevron.down")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(accent)
                            .frame(width: 32, height: 44)
                            .contentShape(Rectangle())
                    }
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
                    .contentShape(Rectangle())
                }
                .buttonStyle(NativeCompactHourButtonStyle(
                    accent: accent,
                    isDark: isDark,
                    reduceMotion: reduceMotion,
                    increasedContrast: colorSchemeContrast == .increased,
                    dense: false
                ))
                .accessibilityLabel("Day at a glance, \(dayAtAGlanceTitle(presentation)). \(dayAtAGlanceSummary(presentation))")
                .accessibilityValue(dayAtAGlanceExpanded ? "Expanded" : "Collapsed")
                .accessibilityHint(dayAtAGlanceExpanded ? "Hide period details" : "Show period details")

                if dayAtAGlanceExpanded {
                    Divider().padding(.horizontal, 15)
                    if !presentation.untimedRisks.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(presentation.untimedRisks) { risk in
                                Label(risk.label, systemImage: risk.symbolName)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(hourlyConditionCueColorForThunder)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 12)
                        Divider().padding(.horizontal, 15)
                    }
                    ForEach(Array(presentation.periods.enumerated()), id: \.element.id) { index, period in
                        Button {
                            model.showHourly(day: displayedDay, focusedHour: period.tapTarget)
                        } label: {
                            dayAtAGlancePeriodRow(period)
                        }
                        .buttonStyle(NativeCompactHourButtonStyle(
                            accent: accent,
                            isDark: isDark,
                            reduceMotion: reduceMotion,
                            increasedContrast: colorSchemeContrast == .increased,
                            dense: true
                        ))
                        .accessibilityLabel(dayAtAGlancePeriodAccessibility(period))
                        .accessibilityHint("Open the exact hourly forecast for this period")
                        if index < presentation.periods.count - 1 {
                            Divider().padding(.leading, 55).padding(.trailing, 15)
                        }
                    }
                    if presentation.periods.contains(where: { $0.coverage == .partial }) {
                        Text("Some period coverage is incomplete; the rows above show only available hourly guidance.")
                            .font(.caption)
                            .foregroundStyle(secondaryInk)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 15)
                            .padding(.top, 10)
                            .padding(.bottom, 13)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // It is a sectional read, not another heavyweight card. The
            // rhythm below is the visual surface; this gets just enough
            // glass separation to remain scannable over the living sky.
            .background(
                isDark ? Color.white.opacity(0.045) : Color.white.opacity(0.46),
                in: RoundedRectangle(cornerRadius: 23, style: .continuous)
            )
            .overlay { RoundedRectangle(cornerRadius: 23, style: .continuous).strokeBorder(.primary.opacity(isDark ? 0.11 : 0.08)) }
            .task(id: dayAtAGlanceIdentity(presentation)) {
                dayAtAGlanceExpanded = presentation.defaultIsExpanded
            }
        }
    }

    private var hourlyConditionCueColorForThunder: Color {
        isDark ? Color(red: 1, green: 0.72, blue: 0.34) : Color(red: 0.69, green: 0.32, blue: 0.04)
    }

    private func dayAtAGlanceIdentity(_ presentation: NativeDayRhythmPresentation) -> String {
        "\(model.selectedPlace.coordinateIdentity)|\(presentation.day.timeIntervalSince1970)|\(presentation.periods.count)|\(presentation.hasTimedEvent)|\(presentation.untimedRisks.count)"
    }

    private func dayAtAGlanceTitle(_ presentation: NativeDayRhythmPresentation) -> String {
        presentation.isToday ? "Rest of today" : dayName(presentation.day)
    }

    private func dayAtAGlanceSummary(_ presentation: NativeDayRhythmPresentation) -> String {
        if let event = presentation.periods.compactMap(\.event).sorted(by: { $0.start < $1.start }).first {
            if presentation.isToday && event.start <= now {
                return "\(event.label) this hour"
            }
            return "\(event.label) around \(clock(event.start))"
        }
        if let risk = presentation.untimedRisks.first { return risk.label }
        let ranges = presentation.periods.compactMap(\.temperatureRange)
        if let low = ranges.map(\.low).min(), let high = ranges.map(\.high).max() {
            let start = temperature(low)
            let end = temperature(high)
            return start == end ? "Near \(start)" : "\(start)–\(end) through the day"
        }
        return "Open the hourly forecast"
    }

    private func dayAtAGlancePeriodTitle(_ period: NativeDayRhythmPresentation.Period) -> String {
        period.isCurrentRemainingPeriod ? "Now" : period.daypart.label
    }

    private func dayAtAGlancePeriodTime(_ period: NativeDayRhythmPresentation.Period) -> String {
        if period.isCurrentRemainingPeriod { return "Through \(clock(period.end))" }
        return "\(clock(period.guidanceStart))–\(clock(period.guidanceEnd))"
    }

    private func dayAtAGlancePeriodSummary(_ period: NativeDayRhythmPresentation.Period) -> String {
        guard let event = period.event else { return period.conditionLabel }
        if period.eventBeginsHere(event) {
            if period.isCurrentRemainingPeriod && event.start <= now { return "\(event.label) this hour" }
            return "\(event.label) around \(clock(event.start))"
        }
        if period.eventEndsHere(event) { return "\(event.label) through \(clock(event.end))" }
        return "\(event.label) continues"
    }

    private func dayAtAGlanceTemperatureRange(_ range: NativeDayRhythmPresentation.TemperatureRange?) -> String {
        guard let range else { return "—" }
        let low = temperature(range.low)
        let high = temperature(range.high)
        return range.isSingleValue ? high : "\(low)–\(high)"
    }

    private func dayAtAGlancePeriodAccessibility(_ period: NativeDayRhythmPresentation.Period) -> String {
        var values = [dayAtAGlancePeriodTitle(period), dayAtAGlancePeriodTime(period), dayAtAGlancePeriodSummary(period)]
        if period.temperatureRange != nil { values.append("temperature \(dayAtAGlanceTemperatureRange(period.temperatureRange))") }
        if period.coverage == .partial { values.append("forecast coverage incomplete") }
        return values.joined(separator: ", ")
    }

    @ViewBuilder
    private func dayAtAGlancePeriodRow(_ period: NativeDayRhythmPresentation.Period) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    weatherSymbol(period.event?.symbolName ?? period.symbolName, size: 24)
                        .frame(width: 28)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(dayAtAGlancePeriodTitle(period))
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(period.isCurrentRemainingPeriod ? accent : .primary)
                        Text(dayAtAGlancePeriodTime(period))
                            .font(.caption)
                            .foregroundStyle(secondaryInk)
                            .monospacedDigit()
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
                Text(dayAtAGlancePeriodSummary(period))
                    .font(.caption.weight(period.event == nil ? .regular : .semibold))
                    .foregroundStyle(period.event == nil ? secondaryInk : accent)
                    .fixedSize(horizontal: false, vertical: true)
                Text(dayAtAGlanceTemperatureRange(period.temperatureRange))
                    .font(.subheadline.weight(.bold))
                    .monospacedDigit()
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        } else {
            HStack(spacing: 12) {
                weatherSymbol(period.event?.symbolName ?? period.symbolName, size: 24)
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(dayAtAGlancePeriodTitle(period))
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(period.isCurrentRemainingPeriod ? accent : .primary)
                        Text(dayAtAGlancePeriodTime(period))
                            .font(.caption)
                            .foregroundStyle(secondaryInk)
                            .monospacedDigit()
                    }
                    Text(dayAtAGlancePeriodSummary(period))
                        .font(.caption.weight(period.event == nil ? .regular : .semibold))
                        .foregroundStyle(period.event == nil ? secondaryInk : accent)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(dayAtAGlanceTemperatureRange(period.temperatureRange))
                        .font(.subheadline.weight(.bold))
                        .monospacedDigit()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
    }

    private var hourlyContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            hourlyHeader
            dayPicker
            if offersQuarterHours {
                intervalPicker
            }
            if showingQuarterHours {
                // The short-horizon product remains deliberately literal: a
                // selector plus its real provider intervals, not a synthetic
                // full-day rhythm drawn from six hours of guidance.
                metricPicker
            } else if let forecast = model.forecast {
                dayAtAGlance
                NativeDayRhythmView(
                    forecast: forecast,
                    day: displayedDay,
                    now: now,
                    rollingWindow: isRollingHourly ? forecast.rollingHourlyWindow(now: now) : nil,
                    uses24HourClock: model.context.uses24HourClock,
                    isDark: isDark,
                    accent: accent,
                    focusedHour: model.hourlyFocus,
                    metric: $dayRhythmMetric
                )
            }
            if isToday && !showingQuarterHours && dayHours.contains(where: { $0.date < currentHourStart }) {
                Button {
                    if reduceMotion {
                        showEarlierHours.toggle()
                    } else {
                        withAnimation(.easeInOut(duration: 0.18)) { showEarlierHours.toggle() }
                    }
                    hourlyEarlierHoursRevision += 1
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: showEarlierHours ? "clock.badge.xmark" : "clock.arrow.circlepath")
                        Text(showEarlierHours ? "Hide earlier hours" : "Earlier today")
                        if !showEarlierHours {
                            Text("Forecast guidance")
                                .foregroundStyle(secondaryInk)
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showEarlierHours ? "Hide earlier forecast guidance" : "Show earlier forecast guidance")
                .accessibilityHint("Earlier hourly values are forecast guidance, not observed conditions.")
            }
            if listPoints.isEmpty {
                ContentUnavailableView("No hours available", systemImage: "clock.badge.questionmark", description: Text("Choose another day or refresh the forecast."))
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(listPoints.enumerated()), id: \.element.id) { index, point in
                        if (isRollingHourly && index == 0) || model.forecast?.startsPreviewDaySection(point.date, after: index == 0 ? nil : listPoints[index - 1].date, selectedDay: displayedDay) == true {
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
                if isRollingHourly && !showingQuarterHours {
                    if model.forecast?.hasMoreRollingHours(now: now, hours: rollingHourCount) == true {
                        Button {
                            rollingHourCount = min(14 * 24, rollingHourCount + 24)
                        } label: {
                            Label("Show next 24 hours", systemImage: "plus")
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.bordered)
                        .accessibilityHint("Adds available forecast hours below without changing your position.")
                    } else if let last = listPoints.last {
                        Text("Forecast available through \(dayName(last.date)), \(clock(last.date)).")
                            .font(.caption)
                            .foregroundStyle(secondaryInk)
                            .padding(.vertical, 10)
                    }
                }
            }
        }
    }

    private var hourlyHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(showingQuarterHours ? "Every 15 minutes" : "Hour by hour")
                .font(.title.weight(.bold))
            Text(isRollingHourly
                ? "\(showingQuarterHours ? "Next 6 hours" : "Next \(rollingHourCount) hours") · local time"
                : "\(dayName(displayedDay, full: true)) · local time")
                .font(.subheadline)
                .foregroundStyle(secondaryInk)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 14)
        .padding(.horizontal, 4)
    }

    private var dayPicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Button { model.showHourly() } label: {
                    Text("Next 24h")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .foregroundStyle(isRollingHourly ? accent : Color.primary)
                        .background(isRollingHourly ? accent.opacity(0.14) : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Next 24 hours, across days")
                .accessibilityAddTraits(isRollingHourly ? .isSelected : [])
                ForEach(previewDays, id: \.id) { day in
                    let selected = !isRollingHourly && calendar.isDate(day.date, inSameDayAs: displayedDay)
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
                detailPair("Wind direction", windDirection(point.windDirection))
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
            Group {
                if usesDenseHourlyRows {
                    hourlyDecisionRail(point)
                } else {
                    hourlyExpandedIdentity(point)
                }
            }
            .foregroundStyle(.primary)
            .padding(.vertical, usesDenseHourlyRows ? 8 : 15)
        }
        .id("native-hourly-row-\(point.date.timeIntervalSince1970)")
        .accessibilityLabel(hourlyRowAccessibility(point))
        .accessibilityHint("Double tap to show detailed weather for this hour.")
    }

    /// One line carries the things someone actually compares while scanning a
    /// day: the selected metric, precipitation chance, and wind. The weather
    /// glyph owns routine Clear/Cloudy context; words appear only when an
    /// exception changes the decision (rain, snow, storms, fog or ice).
    private func hourlyDecisionRail(_ point: NativeForecastPoint) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(clock(point.date, compact: true))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                if model.forecast?.isRepeatedLocalHour(point.date) == true {
                    Text(calendar.timeZone.abbreviation(for: point.date) ?? "")
                        .font(.caption2)
                        .foregroundStyle(secondaryInk)
                }
            }
            .frame(width: model.context.uses24HourClock ? 34 : 42, alignment: .leading)
            weatherSymbol(point.symbolName, size: 24)
                .frame(width: 28)
                .accessibilityHidden(true)
            if let cue = hourlyConditionCue(point) {
                Text(cue)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(hourlyConditionCueColor(point))
                    .lineLimit(1)
                    .minimumScaleFactor(0.86)
                    .truncationMode(.tail)
                    .frame(maxWidth: 72, alignment: .leading)
                    .layoutPriority(-1)
            }
            Spacer(minLength: 2)
            hourlyDecisionPrimary(point)
            hourlyDecisionSecondaryFacts(point)
        }
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .contentShape(Rectangle())
    }

    /// Keep the previously spacious identity as the accessibility and
    /// 15-minute fallback. The decision rail above must never make a larger
    /// text size harder to read just to show another column.
    private func hourlyExpandedIdentity(_ point: NativeForecastPoint) -> some View {
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
    }

    private func hourlyDecisionPrimary(_ point: NativeForecastPoint) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(hourlyDecisionPrimaryValue(point))
                .font(.headline.weight(.bold))
                .monospacedDigit()
            if metric == .wind, metric.value(point) != nil {
                Text(model.context.metric ? "km/h" : "mph")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(secondaryInk)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder
    private func hourlyDecisionSecondaryFacts(_ point: NativeForecastPoint) -> some View {
        switch metric {
        case .rain:
            hourlyDecisionTemperatureFact(point)
            hourlyDecisionWindFact(point)
        case .wind:
            hourlyDecisionRainFact(point)
            hourlyDecisionGustFact(point)
        case .temperature, .feelsLike, .uv:
            hourlyDecisionRainFact(point)
            hourlyDecisionWindFact(point)
        }
    }

    private func hourlyDecisionPrimaryValue(_ point: NativeForecastPoint) -> String {
        guard let value = metric.value(point), value.isFinite else { return "—" }
        switch metric {
        case .temperature, .feelsLike:
            return "\(Int(value.rounded()))°"
        case .rain:
            return "\(Int(value.rounded()))%"
        case .wind:
            return "\(Int(value.rounded()))"
        case .uv:
            return "UV \(String(format: "%.1f", value))"
        }
    }

    private func hourlyDecisionRainFact(_ point: NativeForecastPoint) -> some View {
        let signal = rainChanceSignal(point)
        return hourlyDecisionFact(signal.label, symbol: signal.symbol, color: hourlySignalColor(signal))
    }

    private func hourlyDecisionTemperatureFact(_ point: NativeForecastPoint) -> some View {
        hourlyDecisionFact(temperature(point.temperature), symbol: "thermometer.medium", color: secondaryInk)
    }

    /// Direction only appears on verified hourly forecast rows. The 15-minute
    /// provider feed does not promise a direction, so we never decorate that
    /// different data product with a guessed compass value.
    private func hourlyDecisionWindFact(_ point: NativeForecastPoint) -> some View {
        let value: String
        if let wind = point.windSpeed {
            let unit = model.context.metric ? "km/h" : "mph"
            value = "\(Int(wind.rounded())) \(unit)\(hourlyWindDirection(point).map { " \($0)" } ?? "")"
        } else if let gust = point.windGusts {
            value = "g\(Int(gust.rounded()))"
        } else {
            value = "—"
        }
        return hourlyDecisionFact(value, symbol: "wind", color: secondaryInk)
    }

    private func hourlyDecisionGustFact(_ point: NativeForecastPoint) -> some View {
        let signal = gustDeltaSignal(point)
        return hourlyDecisionFact(signal.compactLabel, symbol: signal.symbol, color: hourlySignalColor(signal))
    }

    private func hourlyDecisionFact(_ value: String, symbol: String, color: Color) -> some View {
        Label(value, systemImage: symbol)
            .labelStyle(.titleAndIcon)
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }

    private func hourlyWindDirection(_ point: NativeForecastPoint) -> String? {
        guard point.origin == .hourlyForecast else { return nil }
        return NativeWindDirection.compassPoint(point.windDirection)
    }

    private func hourlyConditionCue(_ point: NativeForecastPoint) -> String? {
        if point.thunderPossible || NativeWeatherCondition.isThunder(point.weatherCode) {
            return "Storms"
        }
        guard let code = point.weatherCode else { return nil }
        switch code {
        case 45, 48:
            return "Fog"
        case 51...86:
            return point.conditionLabel
        default:
            return nil
        }
    }

    private func hourlyConditionCueColor(_ point: NativeForecastPoint) -> Color {
        if point.thunderPossible || NativeWeatherCondition.isThunder(point.weatherCode) {
            return isDark ? Color(red: 1, green: 0.72, blue: 0.34) : Color(red: 0.69, green: 0.32, blue: 0.04)
        }
        if let code = point.weatherCode, [56, 57, 66, 67].contains(code) {
            return isDark ? Color(red: 0.52, green: 0.82, blue: 1) : Color(red: 0.08, green: 0.39, blue: 0.70)
        }
        return accent
    }

    private func hourIdentity(_ point: NativeForecastPoint) -> some View {
        let signals = hourlyRowSignals(point)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(clock(point.date, compact: !showingQuarterHours))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                if model.forecast?.isRepeatedLocalHour(point.date) == true {
                    Text(calendar.timeZone.abbreviation(for: point.date) ?? "")
                        .font(.caption)
                        .foregroundStyle(secondaryInk)
                }
            }
            .frame(minWidth: model.context.uses24HourClock ? 42 : 62, alignment: .leading)
            weatherSymbol(point.symbolName, size: 26)
                .frame(width: 35)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: signals.isEmpty ? 0 : 4) {
                Text(point.conditionLabel)
                    .font(.subheadline)
                    // The forecast condition owns the first line. Keep it
                    // scannable at normal sizes; the utility rail below it
                    // carries the two numeric decision cues.
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                    .minimumScaleFactor(dynamicTypeSize.isAccessibilitySize ? 1 : 0.88)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                if !signals.isEmpty {
                    hourlySignalRail(signals)
                    .accessibilityHidden(true)
                }
            }
            .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? 210 : 180, alignment: .leading)
            .layoutPriority(1)
        }
    }

    /// The list already shows the selected metric at a glance. Its utility rail
    /// keeps the other two planning facts stable: precipitation plus wind. The
    /// Rain and Wind lenses swap in the adjacent fact rather than repeating the
    /// number in the large value at the right edge.
    private func hourlyRowSignals(_ point: NativeForecastPoint) -> [NativeHourlyRowSignal] {
        let rain = rainChanceSignal(point)
        switch metric {
        case .rain:
            // The selected value already is probability. Amount or actual
            // forecast state answers the complementary question: how much is
            // expected in that interval, or whether it is dry.
            return [rainAmountOrStateSignal(point), windSignal(point)]
        case .wind:
            // The selected value already is sustained speed. A gust *delta*
            // is useful without repeating that same speed.
            return [rain, gustDeltaSignal(point)]
        case .temperature, .feelsLike, .uv:
            return [rain, windSignal(point)]
        }
    }

    /// The chance remains present even when an upstream provider omits it.
    /// A visible em dash is more honest than silently implying a dry hour and
    /// preserves a predictable rail shape across hourly rows.
    private func rainChanceSignal(_ point: NativeForecastPoint) -> NativeHourlyRowSignal {
        if let chance = point.rainProbability {
            let value = "\(Int(chance.rounded()))%"
            return NativeHourlyRowSignal(
                id: "rain-chance",
                label: value,
                compactLabel: value,
                accessibilityLabel: "precipitation chance \(Int(chance.rounded())) percent",
                symbol: "drop.fill",
                kind: .precipitation
            )
        }
        return NativeHourlyRowSignal(
            id: "rain-chance-unavailable",
            label: "—",
            compactLabel: "—",
            accessibilityLabel: "precipitation chance unavailable",
            symbol: "drop",
            kind: .precipitation
        )
    }

    /// Prefer the gust reading when it is meaningfully higher than sustained
    /// wind. The unit is intentionally omitted in the compact rail because
    /// the selected metric and disclosure detail retain the full unit.
    private func windSignal(_ point: NativeForecastPoint) -> NativeHourlyRowSignal {
        let materialGustDelta = model.context.metric ? 8.0 : 5.0
        if let gust = point.windGusts,
           point.windSpeed.map({ gust - $0 >= materialGustDelta }) ?? true {
            let value = Int(gust.rounded())
            return NativeHourlyRowSignal(
                id: "gust",
                label: "gust \(value)",
                compactLabel: "g \(value)",
                accessibilityLabel: "gusts \(speed(gust))",
                symbol: "wind",
                kind: .wind
            )
        }
        if let wind = point.windSpeed {
            let value = Int(wind.rounded())
            return NativeHourlyRowSignal(
                id: "wind",
                label: "wind \(value)",
                compactLabel: "w \(value)",
                accessibilityLabel: "wind \(speed(wind))",
                symbol: "wind",
                kind: .wind
            )
        }
        if let gust = point.windGusts {
            let value = Int(gust.rounded())
            return NativeHourlyRowSignal(
                id: "gust-only",
                label: "gust \(value)",
                compactLabel: "g \(value)",
                accessibilityLabel: "gusts \(speed(gust))",
                symbol: "wind",
                kind: .wind
            )
        }
        return NativeHourlyRowSignal(
            id: "wind-unavailable",
            label: "wind —",
            compactLabel: "w —",
            accessibilityLabel: "wind unavailable",
            symbol: "wind",
            kind: .wind
        )
    }

    /// The Wind lens makes the size of the gust jump obvious. It never draws
    /// a directional arrow: 15-minute source rows do not reliably include a
    /// direction, and a decorative arrow would look more precise than the
    /// data actually is.
    private func gustDeltaSignal(_ point: NativeForecastPoint) -> NativeHourlyRowSignal {
        let materialGustDelta = model.context.metric ? 8.0 : 5.0
        if let gust = point.windGusts, let wind = point.windSpeed {
            let delta = max(0, gust - wind)
            let rounded = Int(delta.rounded())
            let label = rounded >= Int(materialGustDelta) ? "gust +\(rounded)" : "gust steady"
            let compact = rounded >= Int(materialGustDelta) ? "g +\(rounded)" : "g steady"
            let accessibility: String
            if rounded >= Int(materialGustDelta) {
                accessibility = "gusts \(speed(gust)), \(speed(delta)) above sustained wind"
            } else {
                accessibility = "gusts \(speed(gust)), near sustained wind"
            }
            return NativeHourlyRowSignal(
                id: "gust-delta",
                label: label,
                compactLabel: compact,
                accessibilityLabel: accessibility,
                symbol: "wind",
                kind: .wind
            )
        }
        if let gust = point.windGusts {
            let value = Int(gust.rounded())
            return NativeHourlyRowSignal(
                id: "gust-only",
                label: "gust \(value)",
                compactLabel: "g \(value)",
                accessibilityLabel: "gusts \(speed(gust))",
                symbol: "wind",
                kind: .wind
            )
        }
        return NativeHourlyRowSignal(
            id: "gust-unavailable",
            label: "gust —",
            compactLabel: "g —",
            accessibilityLabel: "gusts unavailable",
            symbol: "wind",
            kind: .wind
        )
    }

    private func rainAmountOrStateSignal(_ point: NativeForecastPoint) -> NativeHourlyRowSignal {
        if let amount = point.precipitationMM, amount >= 0.05 {
            let amountText = compactPrecipitationAmount(amount)
            return NativeHourlyRowSignal(
                id: "rain-amount",
                label: amountText.full,
                compactLabel: amountText.compact,
                accessibilityLabel: "forecast precipitation amount \(precipitation(amount))",
                symbol: "drop.fill",
                kind: .precipitation
            )
        }
        if let state = activePrecipitationState(point) {
            return NativeHourlyRowSignal(
                id: "rain-state",
                label: state,
                compactLabel: state,
                accessibilityLabel: "forecast precipitation state, \(state.lowercased())",
                symbol: "drop.fill",
                kind: .precipitation
            )
        }
        if point.precipitationMM != nil {
            return NativeHourlyRowSignal(
                id: "dry",
                label: "dry",
                compactLabel: "dry",
                accessibilityLabel: "no forecast precipitation amount",
                symbol: "drop",
                kind: .precipitation
            )
        }
        return NativeHourlyRowSignal(
            id: "rain-amount-unavailable",
            label: "—",
            compactLabel: "—",
            accessibilityLabel: "forecast precipitation amount unavailable",
            symbol: "drop",
            kind: .precipitation
        )
    }

    private func compactPrecipitationAmount(_ millimeters: Double) -> (full: String, compact: String) {
        if model.context.metric {
            let value = millimeters < 1 ? String(format: "%.1f", millimeters) : String(format: "%.0f", millimeters)
            return ("\(value) mm", "\(value)mm")
        }
        let inches = millimeters / 25.4
        if inches < 0.01 { return ("<.01 in", "<.01\"") }
        let value = String(format: "%.2f", inches)
        return ("\(value) in", "\(value)\"")
    }

    /// This is the forecast condition already visible in the row, not a
    /// radar/alert claim. Future rows therefore say Rain or Snow—not "now".
    private func activePrecipitationState(_ point: NativeForecastPoint) -> String? {
        switch point.weatherCode {
        case 71, 73, 75, 77, 85, 86:
            return "snow"
        case 95, 96, 99:
            return "storms"
        case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82:
            return "rain"
        default:
            return point.thunderPossible ? "storms" : nil
        }
    }

    @ViewBuilder
    private func hourlySignalRail(_ signals: [NativeHourlyRowSignal]) -> some View {
        if let primary = signals.first {
            let secondary = signals.dropFirst().first
            // Let the complete second cue fit when it can, then use its compact
            // spelling, then retain the rain/amount cue alone. That prevents the
            // first cue from being truncated away in a narrow condition column.
            ViewThatFits(in: .horizontal) {
                hourlySignalRail(primary: primary, secondary: secondary, compactSecondary: false)
                hourlySignalRail(primary: primary, secondary: secondary, compactSecondary: true)
                hourlySignalRail(primary: primary, secondary: nil, compactSecondary: false)
            }
        }
    }

    private func hourlySignalRail(primary: NativeHourlyRowSignal, secondary: NativeHourlyRowSignal?, compactSecondary: Bool) -> some View {
        HStack(spacing: compactSecondary ? 5 : 8) {
            hourlySignalToken(primary, compact: false)
            if let secondary {
                Text("·")
                    .foregroundStyle(.tertiary)
                hourlySignalToken(secondary, compact: compactSecondary)
            }
        }
        .font(.caption.weight(.semibold))
        .fixedSize(horizontal: true, vertical: false)
    }

    private func hourlySignalToken(_ signal: NativeHourlyRowSignal, compact: Bool) -> some View {
        Label(compact ? signal.compactLabel : signal.label, systemImage: signal.symbol)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(hourlySignalColor(signal))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }

    private func hourlySignalColor(_ signal: NativeHourlyRowSignal) -> Color {
        switch signal.kind {
        case .precipitation:
            return isDark ? Color(red: 0.46, green: 0.77, blue: 1) : Color(red: 0.13, green: 0.42, blue: 0.71)
        case .wind:
            return secondaryInk
        }
    }

    private func hourlyRowAccessibility(_ point: NativeForecastPoint) -> String {
        let zone = model.forecast?.isRepeatedLocalHour(point.date) == true
            ? " \(calendar.timeZone.abbreviation(for: point.date) ?? "")" : ""
        let headline = "\(dayName(point.date)), \(clock(point.date, compact: !showingQuarterHours))\(zone), \(point.conditionLabel), \(metric.accessibleLabel) \(metric.formatted(point, metricUnits: model.context.metric))"
        let directionalWind = hourlyWindDirection(point).flatMap { _ in
            NativeWindDirection.spokenCompassPoint(point.windDirection).map { "wind \(speed(point.windSpeed)) from \($0)" }
        }
        var signals = hourlyRowSignals(point).map { signal in
            metric != .wind && signal.kind == .wind ? (directionalWind ?? signal.accessibilityLabel) : signal.accessibilityLabel
        }
        if metric == .wind, let directionalWind {
            signals.append(directionalWind)
        }
        return ([headline] + signals).joined(separator: ", ")
    }

    private struct NativeHourlyRowSignal: Identifiable {
        enum Kind { case precipitation, wind }

        let id: String
        let label: String
        let compactLabel: String
        let accessibilityLabel: String
        let symbol: String
        let kind: Kind
    }

    private func detailPair(_ label: String, _ value: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).foregroundStyle(secondaryInk)
                Spacer(minLength: 12)
                Text(value).fontWeight(.semibold)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(label).foregroundStyle(secondaryInk)
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
            model.showHourly()
            scrollToTopRevision += 1
        }
        navigationButton("Ask", symbol: "sparkle", selected: assistantEntry == .ask) {
            if let onNativeAsk { onNativeAsk() } else { assistantEntry = .ask }
        }
        navigationButton("Map", symbol: "map", selected: showingNativeMap) {
            previewOpeningContext = nil
            showingNativeMap = true
        }
        navigationButton("Plans", symbol: "calendar", selected: assistantEntry == .plans || nativePlansPresented) {
            if let onNativePlans {
                onNativePlans()
            } else {
                assistantEntry = .plans
            }
        }
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
            .foregroundStyle(selected ? accent : secondaryInk)
            .background(selected ? accent.opacity(0.13) : Color.clear, in: RoundedRectangle(cornerRadius: 21))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier("nearcast.native.navigation.\(title.lowercased())")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var loadingOrUnavailable: some View {
        VStack(spacing: 20) {
            if model.isLoading {
                ProgressView().controlSize(.large)
                Text("Bringing in your forecast")
                    .font(.title2.weight(.semibold))
                Text("Weather for \(model.selectedPlace.name)")
                    .foregroundStyle(secondaryInk)
            } else {
                Image(systemName: "cloud.slash").font(.system(size: 48)).foregroundStyle(secondaryInk)
                Text("Weather is unavailable")
                    .font(.title2.weight(.bold))
                Text(model.errorMessage ?? (model.forecast == nil
                    ? "No forecast is loaded for this place yet."
                    : NativeWeatherPreviewModel.expiredForecastMessage))
                    .foregroundStyle(secondaryInk)
                Button("Try again") { Task { await model.refresh() } }
                    .buttonStyle(.borderedProminent)
                if showsCompatibilityRecovery {
                    Button("Return to existing Nearcast", action: onClose)
                        .font(.subheadline.weight(.semibold))
                }
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
        .foregroundStyle(secondaryInk)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 8)
    }

    private var cardFill: Color {
        if isDark {
            return usesLivingSky
                ? Color(red: 0.075, green: 0.13, blue: 0.18)
                : Color(red: 0.11, green: 0.17, blue: 0.21)
        }
        return Color.white.opacity(usesLivingSky ? 0.94 : 0.76)
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

    private func windDirection(_ degrees: Double?) -> String {
        guard let degrees, let compass = NativeWindDirection.compassPoint(degrees) else { return "Not available" }
        return "\(compass) · \(Int(degrees.rounded()))°"
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


private enum NativePreviewInterval: String, Hashable {
    case hourly
    case quarterHour
}

/// The selected city is the doorway to a family's weather, so it needs a
/// tactile affordance without turning the immersive header into another large
/// toolbar. A chevron supplies the resting affordance; tint and motion supply
/// feedback only while pressed, leaving the sky visible around the city.
private struct NativePlacePickerButtonStyle: ButtonStyle {
    let accent: Color
    let isDark: Bool
    let reduceMotion: Bool
    let increasedContrast: Bool

    func makeBody(configuration: Configuration) -> some View {
        let pressedFill = isDark ? accent.opacity(0.30) : accent.opacity(0.16)

        configuration.label
            .background {
                RoundedRectangle(cornerRadius: 10)
                    .fill(configuration.isPressed ? pressedFill : .clear)
                    .padding(.horizontal, -5)
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// SwiftUI's plain button style intentionally has no pressed treatment. On the
/// compact Home timeline that made a valid hour selection feel inert, especially
/// while it sits inside a horizontal ScrollView. This adds a momentary, high
/// contrast-aware glass tint only after the gesture resolves as a tap; drags
/// remain owned by the scroll view and never navigate to an hour by accident.
private struct NativeCompactHourButtonStyle: ButtonStyle {
    let accent: Color
    let isDark: Bool
    let reduceMotion: Bool
    let increasedContrast: Bool
    let dense: Bool

    func makeBody(configuration: Configuration) -> some View {
        let fillOpacity: Double = increasedContrast
            ? (isDark ? 0.34 : 0.22)
            : (isDark ? 0.24 : 0.14)
        let strokeOpacity: Double = increasedContrast
            ? (isDark ? 0.78 : 0.64)
            : (isDark ? 0.58 : 0.42)
        let cornerRadius: CGFloat = dense ? 12 : 16

        configuration.label
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(configuration.isPressed ? accent.opacity(fillOpacity + (dense ? 0.05 : 0)) : .clear)
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        configuration.isPressed ? accent.opacity(strokeOpacity) : .clear,
                        lineWidth: increasedContrast ? 1.5 : 1
                    )
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.94 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// On motion-capable systems, let the scroll view report clipping and initial
/// visibility directly. The older-system fallback only adjusts its still's
/// reading veil; it cannot enable motion.
private struct NativeSkyHeroVisibilityGate: ViewModifier {
    let viewportHeight: CGFloat
    let onVisibilityChange: (Bool) -> Void

    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollVisibilityChange(threshold: 0.05) { visible in
                onVisibilityChange(visible)
            }
        } else {
            content.onGeometryChange(for: Bool.self) { geometry in
                let frame = geometry.frame(in: .named("native-weather-scroll"))
                return viewportHeight > 0 && frame.maxY > 24 && frame.minY < viewportHeight
            } action: { visible in
                onVisibilityChange(visible)
            }
        }
    }
}

/// Observe native scroll ownership without adding a competing drag gesture.
/// A finger tracking the scroll view and momentum/programmatic scrolling all
/// pause the sky. The parent keeps pre-iOS-18 systems static.
private struct NativeSkyMotionScrollGate: ViewModifier {
    @Binding var isScrolling: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollPhaseChange { _, phase in
                isScrolling = phase != .idle
            }
        } else {
            content
        }
    }
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

private extension NativeDayRhythmMetric {
    init(previewMetric: NativePreviewMetric) {
        switch previewMetric {
        case .temperature: self = .temperature
        case .feelsLike: self = .feelsLike
        case .rain: self = .rain
        case .wind: self = .wind
        case .uv: self = .sun
        }
    }

    var previewMetric: NativePreviewMetric? {
        switch self {
        case .temperature: return .temperature
        case .feelsLike: return .feelsLike
        case .rain: return .rain
        case .wind: return .wind
        case .sun: return nil
        }
    }
}
