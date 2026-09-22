import SwiftUI

/// Native map surface. Compatibility hosts may offer their established map as
/// an explicit bridge for tools that have not yet moved over; native-only Dev
/// keeps recovery inside this native screen.
struct NativeRadarView: View {
    let place: NativePreviewPlace
    let initialContext: NativeRadarOpeningContext?
    /// An exact, already-normalized official-alert identity from a native
    /// notification or deep link. It is deliberately not a weather claim: the
    /// native alert feed must still match it before the map treats it as
    /// current or draws an official area.
    let focusedAlertID: String?
    let onClose: () -> Void
    /// Compatibility hosts may expose their established map as an explicit
    /// bridge while parity work continues. Native-only Dev intentionally
    /// leaves this nil so its information panel never offers a WebKit exit.
    let onExistingMap: (() -> Void)?
    let onAskAboutPlace: (() -> Void)?
    let savedPlaces: [NativePreviewPlace]
    let onSelectPlace: ((NativePreviewPlace) async -> Bool)?
    @StateObject private var model: NativeRadarModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var recenter = 0
    @State private var zoomCommand = 0
    @State private var showingInfo = false
    @State private var showingLegend = false
    @State private var alertsAfterTools = false
    @State private var showingAlerts = false
    @State private var selectedAlertID: String?
    @State private var highlightedAlertID: String?
    @State private var alertFocusRevision = 0
    @State private var routeAlertState: RouteAlertState = .none
    @State private var routeAlertResolved = false
    @State private var selectedMarker: NativePreviewPlace?
    @State private var focusPlace: NativePreviewPlace?
    @State private var focusRevision = 0
    @State private var locating = false
    @State private var locationTask: Task<Void, Never>?
    @State private var placeMessage: String?
    @State private var changingPlace = false
    @State private var dragTime: Double?
    @State private var draggingTimeline = false
    @State private var tileActivity = "No raster tile activity reported yet."
    private var legendBands: [NativeRadarPresentationContract.LegendBand] {
        (try? NativeRadarPresentationContract.highDetailLegendBands(encoding: .init(), zoom: model.renderingZoom)) ?? []
    }

    init(place: NativePreviewPlace, timezone: String?, uses24HourClock: Bool,
         initialContext: NativeRadarOpeningContext? = nil,
         focusedAlertID: String? = nil,
         savedPlaces: [NativePreviewPlace] = [], onSelectPlace: ((NativePreviewPlace) async -> Bool)? = nil,
         onAskAboutPlace: (() -> Void)? = nil,
         onClose: @escaping () -> Void, onExistingMap: (() -> Void)? = nil) {
        self.place = place
        self.initialContext = initialContext?.matches(place) == true ? initialContext : nil
        self.focusedAlertID = Self.normalizedAlertID(focusedAlertID)
        self.onClose = onClose
        self.onExistingMap = onExistingMap
        self.onAskAboutPlace = onAskAboutPlace
        self.savedPlaces = savedPlaces
        self.onSelectPlace = onSelectPlace
        _model = StateObject(wrappedValue: NativeRadarModel(place: place,
            timezone: timezone, uses24HourClock: uses24HourClock, initialContext: initialContext))
    }

    var body: some View {
        ZStack {
            if model.rendererReady {
                NativeRadarMap(place: place, initialContext: initialContext, savedPlaces: savedPlaces, focusPlace: focusPlace,
                    focusRevision: focusRevision, base: model.base, labels: model.labels,
                    basemapRevision: model.basemapRevision,
                    weatherRevision: model.weatherRevision,
                    weather: model.basemapStyle == .satellite ? nil : model.wmsFrame,
                    weatherTiles: model.basemapStyle == .satellite ? nil : model.globalTiles,
                    image: model.basemapStyle == .satellite ? nil : model.image,
                    recenter: recenter, zoomCommand: zoomCommand,
                    maximumZoom: model.basemapStyle == .satellite ? 9 : 16,
                    alerts: model.alertGeometry,
                    highlightedAlertID: highlightedAlertID,
                    alertFocusRevision: alertFocusRevision,
                    onAlert: {
                        highlightedAlertID = $0
                        selectedAlertID = $0
                        showingAlerts = true
                    },
                    onPlace: { selectedMarker = $0; placeMessage = nil },
                    onViewport: { viewport, moving in model.updateViewport(viewport, moving: moving) },
                    onFailure: { model.mapFailure = true },
                    onTileActivity: { tileActivity = $0 })
                    .ignoresSafeArea()
            } else { Color(red: 0.15, green: 0.21, blue: 0.26).ignoresSafeArea() }
            GeometryReader { geometry in
                if geometry.size.width > geometry.size.height {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(spacing: 8) {
                            header
                            alertChip
                            Spacer(minLength: 0)
                            recenterControl
                        }
                        ScrollView {
                            VStack(spacing: 10) { statusMessage; bottomPanel }
                        }.frame(width: min(420, geometry.size.width * 0.52))
                    }
                    .padding(12)
                } else {
                    VStack(spacing: 8) {
                        header
                        alertChip
                        Spacer(minLength: 8)
                        recenterControl
                        if dynamicTypeSize.isAccessibilitySize {
                            ScrollView { VStack(spacing: 10) { statusMessage; bottomPanel } }
                                .frame(maxHeight: geometry.size.height * 0.62)
                        } else {
                            statusMessage
                            bottomPanel
                        }
                    }.padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 8)
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingInfo, onDismiss: {
            if alertsAfterTools {
                alertsAfterTools = false
                selectedAlertID = nil
                showingAlerts = true
            }
        }) { information }
        .sheet(isPresented: $showingLegend) { legendInformation }
        .sheet(isPresented: $showingAlerts, onDismiss: { selectedAlertID = nil }) { alertInformation }
        .sheet(item: $selectedMarker) { marker in placeInformation(marker) }
        .task { await model.start() }
        .task(id: focusedAlertID) { resetRouteAlertFocus() }
        .onChange(of: model.alertSnapshot?.checkedAt) { _, _ in resolveRouteAlertIfPossible() }
        .onChange(of: model.viewportAlerts?.snapshot.checkedAt) { _, _ in resolveRouteAlertIfPossible() }
        .onDisappear { locationTask?.cancel(); locationTask = nil; model.cancel() }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            if scenePhase == .active { model.advanceClock() }
        }
        .onChange(of: scenePhase) { _, phase in
            // The system permission prompt temporarily makes the app inactive.
            // Cancel location only on background, not while awaiting that choice.
            if phase == .background { locationTask?.cancel(); locationTask = nil; locating = false; model.suspend() }
            else if phase == .inactive { model.suspend() }
            else { model.advanceClock() }
        }
    }

    private var hasRelevantAlerts: Bool {
        !model.activeAlerts.isEmpty || !model.visibleAreaAlerts.isEmpty
    }

    private var needsAlertAttention: Bool {
        model.alertRefreshFailed || model.viewportAlertsFailed ||
            model.alertSnapshot.map { $0.quality != .verified || !$0.isFresh(at: model.scrubberNow) } == true ||
            model.viewportAlerts.map { $0.snapshot.quality != .verified || !$0.snapshot.isFresh(at: model.scrubberNow) } == true
    }

    private var alertChipTitle: String {
        if hasRelevantAlerts { return "Official alerts" }
        if model.alertRefreshFailed || model.viewportAlertsFailed { return "Alert check unavailable" }
        return "Alert coverage limited"
    }

    /// Quiet in ordinary weather, but never bury current alerts or a failed
    /// check. The complete bulletin list is also always available in Map tools.
    @ViewBuilder private var alertChip: some View {
        if hasRelevantAlerts || needsAlertAttention {
            HStack {
                Button { selectedAlertID = nil; showingAlerts = true } label: {
                    Label(alertChipTitle,
                          systemImage: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12).frame(minHeight: 44)
                        .background(.regularMaterial, in: Capsule())
                }
                .foregroundStyle(.orange)
                .accessibilityHint("Review official bulletins and alert data freshness.")
                Spacer(minLength: 0)
            }
        }
    }

    private var recenterControl: some View {
        HStack {
            Spacer()
            mapButton("scope", label: "Recenter on \(place.name)") { recenter += 1 }
        }
    }

    @ViewBuilder private var statusMessage: some View {
        if let routeAlertMessage {
            VStack(alignment: .leading, spacing: 8) {
                Label(routeAlertMessage.title, systemImage: routeAlertMessage.symbol)
                    .font(.footnote.weight(.semibold))
                Text(routeAlertMessage.detail)
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
                if routeAlertState == .unavailable {
                    Button("Review current official alerts") {
                        selectedAlertID = nil
                        showingAlerts = true
                    }
                    .font(.footnote.weight(.semibold))
                    .frame(minHeight: 36)
                }
                if model.needsMapRecovery {
                    if let mapMessage = model.mapMessage {
                        Text(mapMessage)
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    mapRecoveryActions
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        } else if let message = placeMessage ?? model.mapMessage {
            VStack(alignment: .leading, spacing: 10) {
                Text(message).font(.footnote.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                if model.needsMapRecovery { mapRecoveryActions }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    /// Native-only Dev cannot pretend that a compatibility route is available
    /// when a map source fails. Give that path a real, bounded local recovery
    /// instead: retry the renderer/data, choose a supported layer, or close.
    @ViewBuilder private var mapRecoveryActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { model.retryMap() } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.refreshing)
                .accessibilityLabel("Retry native map")

                Button { showingInfo = true } label: {
                    Label("Layers", systemImage: "square.3.layers.3d")
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Choose a map layer")

                Button(action: onClose) {
                    Label("Close", systemImage: "xmark")
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Close map")
            }
            .font(.footnote.weight(.semibold))
            .controlSize(.small)

            // Compatibility hosts retain their deliberate map handoff. This
            // branch is unreachable from NativeOnlyExperienceRoot, which
            // supplies nil and therefore exposes only the native actions.
            if let onExistingMap {
                Button("Open full existing map") {
                    showingInfo = false
                    onExistingMap()
                }
                .font(.footnote.weight(.semibold))
                .frame(minHeight: 36)
            }
        }
        .accessibilityIdentifier("nearcast.native.map.recovery")
    }

    private var credits: some View {
                VStack(spacing: 3) {
                  if model.basemapStyle == .satellite {
                    Link("NASA GIBS imagery", destination: NativeSatelliteContract.attribution.url)
                  } else if model.usesGlobalRadar {
                    Link("Weather data by RainViewer", destination: URL(string: "https://www.rainviewer.com/")!)
                  }
                  if model.basemapStyle == .aerial {
                    Link("USGS / USDA imagery", destination: URL(string: "https://www.usgs.gov/the-national-map-data-delivery")!)
                  }
                  ViewThatFits(in: .horizontal) {
                    HStack(spacing: 4) {
                        Link("MapLibre", destination: URL(string: "https://maplibre.org/")!)
                        if model.labels != nil {
                            Text("·")
                            Link("© CARTO", destination: URL(string: "https://carto.com/attributions")!)
                            Text("·")
                            Link("© OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                        }
                    }.fixedSize(horizontal: true, vertical: false)
                    VStack(spacing: 3) {
                        Link("MapLibre", destination: URL(string: "https://maplibre.org/")!)
                        if model.labels != nil {
                            Link("© CARTO", destination: URL(string: "https://carto.com/attributions")!)
                            Link("© OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                        }
                    }
                  }
                }.font(.caption2).foregroundStyle(.primary)
                    .padding(.horizontal, 10).padding(.vertical, 4)
    }

    private var header: some View {
        HStack(spacing: 8) {
            mapButton("xmark", label: "Close map", action: onClose)
            Text(place.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("Selected place: \(place.name)")
            mapButton("square.3.layers.3d", label: "Map tools and layers") { showingInfo = true }
        }
        .foregroundStyle(.primary)
    }

    private var legendInformation: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                legend
                Text(model.product == .rainAmount
                     ? "Accumulated rainfall is a forecast total over six hours, not current rain intensity."
                     : "Reflectivity measures radar return strength. The colors do not indicate lightning or an official warning.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                .navigationTitle("Map color scale").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingLegend = false } } }
        }
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.medium, .large] : [.height(260), .medium])
        .presentationDragIndicator(.visible)
    }

    private var legendControl: some View {
        Button { showingLegend = true } label: {
            HStack(spacing: 6) {
                if model.product == .forecast || model.usesNumericRadar {
                    HStack(spacing: 0) {
                        ForEach(Array(legendBands.enumerated()), id: \.offset) { _, band in
                            Color(red: Double(band.rgba[0]) / 255,
                                  green: Double(band.rgba[1]) / 255, blue: Double(band.rgba[2]) / 255)
                        }
                    }.frame(width: 44, height: 4).clipShape(Capsule())
                    Text("dBZ")
                } else {
                    Text(model.product == .rainAmount ? "Rain scale" : "Color scale")
                }
                Image(systemName: "chevron.up").font(.system(size: 8, weight: .semibold))
            }.font(.caption2).frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show map color scale and explanation")
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 6) {
            if model.basemapStyle == .satellite {
                Text("Satellite imagery").font(.caption.weight(.semibold))
                Text("Not live radar").font(.caption2).foregroundStyle(.secondary)
            } else if model.product == .forecast || model.usesNumericRadar {
                Text(model.product == .forecast ? "Model reflectivity" : "Radar reflectivity").font(.caption.weight(.semibold))
                HStack(spacing: 0) {
                    ForEach(Array(legendBands.enumerated()), id: \.offset) { _, band in
                        Color(red: Double(band.rgba[0]) / 255,
                              green: Double(band.rgba[1]) / 255, blue: Double(band.rgba[2]) / 255)
                    }
                }.frame(width: 120, height: 6).clipShape(Capsule())
                HStack { Text("5 dBZ"); Spacer(); Text("80 dBZ") }.font(.caption2).frame(width: 120)
            } else if model.product == .rainAmount {
                Text("6-hour forecast total (in)").font(.caption.weight(.semibold))
                if let image = model.accumulationLegend {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: 283)
                        .background(.white).accessibilityLabel("NOAA rainfall color scale, 0.01 to 30 inches")
                } else { Text("Source legend unavailable").font(.caption2).foregroundStyle(.secondary) }
            } else {
                Text(model.product == .rainAmount ? "Six-hour rainfall total" : model.usesGlobalRadar ? "RainViewer radar" : "NOAA radar imagery")
                    .font(.caption.weight(.semibold))
                Text("Provider colors").font(.caption2).foregroundStyle(.secondary)
            }
        }.padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityElement(children: .combine)
    }

    private func mapButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).font(.headline).frame(width: 46, height: 46) }
            .foregroundStyle(.primary).background(.regularMaterial, in: Circle()).accessibilityLabel(label)
    }

    @ViewBuilder private var bottomPanel: some View {
        if model.basemapStyle == .satellite {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Satellite").font(.title2.bold())
                    Spacer()
                    if model.loadingSatellite { ProgressView() }
                    Button { model.selectBasemap(.satellite) } label: {
                        Image(systemName: "arrow.clockwise").frame(width: 44, height: 44)
                    }.disabled(model.loadingSatellite).accessibilityLabel("Refresh satellite imagery")
                }
                if let satellite = model.satellite {
                    Text("\(satellite.product.displayName) · \(satellite.acquisitionDate.iso8601)").font(.headline)
                    Text("Acquisition date · daily true-color imagery, not current conditions. Missing areas can reflect no satellite pass.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button("Return to radar") { model.selectBasemap(.streets); model.selectProduct(.radar) }
                    .frame(minHeight: 44)
                credits
            }.padding(16).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        } else { timeline }
    }

    private var timeline: some View {
        VStack(spacing: 0) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 4) {
                    HStack(spacing: 10) { playbackControl; timelineReading; Spacer(minLength: 0) }
                    HStack { Spacer(minLength: 0); timelineActions }
                }
            } else {
                HStack(spacing: 8) {
                    playbackControl
                    timelineReading.layoutPriority(1)
                    Spacer(minLength: 0)
                    timelineActions
                }
            }
            if let first = model.scrubberDates.first, let last = model.scrubberDates.last, first < last {
                Slider(value: Binding(get: {
                    min(last.timeIntervalSince1970, max(first.timeIntervalSince1970,
                        dragTime ?? (model.scrubberInstant ?? first).timeIntervalSince1970))
                }, set: {
                    dragTime = $0
                    model.selectScrubberTime(Date(timeIntervalSince1970: $0))
                }), in: first.timeIntervalSince1970...last.timeIntervalSince1970,
                    onEditingChanged: { editing in
                        draggingTimeline = editing
                        if !editing { dragTime = nil }
                    })
                    .onChange(of: model.scrubberInstant) { _, _ in
                        if !draggingTimeline { dragTime = nil }
                    }
                    .tint(.cyan).frame(minHeight: 44)
                    .overlay(alignment: .bottomLeading) {
                        if model.product != .rainAmount, first < model.scrubberNow, model.scrubberNow < last {
                            GeometryReader { geometry in
                                let fraction = model.scrubberNow.timeIntervalSince(first) / last.timeIntervalSince(first)
                                VStack(spacing: 1) {
                                    Rectangle().fill(.secondary).frame(width: 1, height: 5)
                                    Text("Now").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                                }.position(x: 14 + (geometry.size.width - 28) * fraction, y: 7)
                            }.allowsHitTesting(false).accessibilityHidden(true)
                        }
                    }
                    .accessibilityLabel("Radar and forecast time")
                    .accessibilityValue(model.selectedDetailLabel)
                    .accessibilityAdjustableAction { direction in
                        if direction == .increment { model.stepScrubber(1) }
                        else if direction == .decrement { model.stepScrubber(-1) }
                    }
            } else {
                Capsule().fill(.white.opacity(0.15)).frame(height: 4).padding(.vertical, 20)
            }
            HStack {
                Text(model.scrubberStartLabel)
                Spacer()
                legendControl
                Spacer()
                Text(model.scrubberEndLabel)
            }.font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            // Provider credits stay visible, but share the timeline surface
            // rather than adding another floating card beneath it.
            credits
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(.white.opacity(0.12)))
        .shadow(color: .black.opacity(0.14), radius: 12, y: 4)
    }

    private var playbackControl: some View {
        Button { model.togglePlayback() } label: {
            Image(systemName: model.playing ? "pause.fill" : "play.fill")
                .font(.title3).frame(width: 44, height: 44)
                .background(.white.opacity(0.08), in: Circle())
        }.disabled(model.scrubberDates.count < 2 || model.usesGlobalRadar)
            .accessibilityLabel(model.playing ? "Pause animation" : "Play radar and forecast")
    }

    private var timelineReading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.displayedTimeLabel).font(.headline).monospacedDigit()
            // This always describes the visible image, not a requested frame
            // that may still be loading. Compactness must not hide that distinction.
            Text(model.displayedSourceLabel).font(.caption).foregroundStyle(.secondary)
            if let pending = model.pendingTimeLabel {
                Text(pending).font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var timelineActions: some View {
        HStack(spacing: 6) {
            if model.loadingImage || model.refreshing { ProgressView().controlSize(.mini) }
            if model.product != .rainAmount {
                Menu {
                    Button("Next hour") { model.setTimelineHours(1) }
                    Button("Next 6 hours") { model.setTimelineHours(6) }
                } label: {
                    Text("\(model.timelineHours)h").font(.caption.weight(.semibold)).frame(minWidth: 44, minHeight: 44)
                }.accessibilityLabel("Timeline range, \(model.timelineHours) hours")
            }
            Button { model.selectProduct(.radar) } label: {
                Text("Latest").font(.caption.weight(.semibold)).frame(minWidth: 44, minHeight: 44)
            }.accessibilityLabel("Latest available radar")
        }
    }

    private var information: some View {
        NavigationStack {
            List {
                Section("Explore") {
                    Button { recenter += 1; showingInfo = false } label: {
                        Label("Recenter on \(place.name)", systemImage: "scope")
                    }
                    Button { showingInfo = false; locateOnce() } label: {
                        Label(locating ? "Finding your location…" : "Show my location", systemImage: "location")
                    }.disabled(locating)
                    Button { alertsAfterTools = true; showingInfo = false } label: {
                        Label("Alerts", systemImage: "exclamationmark.triangle")
                    }
                    Text(model.alertStatus).font(.caption).foregroundStyle(.secondary)
                }
                Section("Weather layers") {
                    Button("Radar & forecast") { model.selectProduct(.radar); showingInfo = false }
                    Button("Six-hour rain totals") { model.selectProduct(.rainAmount); showingInfo = false }
                    Toggle("Radar-guided forecast", isOn: Binding(get: { model.enhancementEnabled }, set: model.setEnhancement))
                    Text("Aligns near-term model guidance with recent radar motion only when the evidence supports it. This is separate from StormScope.").font(.caption)
                    Button("Refresh weather") { model.requestRefresh() }
                    HStack {
                        Button("Zoom out") { zoomCommand -= 1 }
                        Spacer()
                        Button("Zoom in") { zoomCommand += 1 }
                    }
                }
                Section("Attribution") { credits }
                Section("Lightning") {
                    Label("StormScope unavailable", systemImage: "cloud.bolt")
                        .foregroundStyle(.secondary)
                    Text("StormScope and observed lightning are not connected in this native build. Nearcast’s enhanced radar remains available. Radar alone cannot tell whether lightning is present.")
                        .font(.caption)
                }
                if onAskAboutPlace != nil || onExistingMap != nil {
                    Section {
                        if let onAskAboutPlace {
                            Button("Ask about this place") { showingInfo = false; onAskAboutPlace() }
                            Text("Opens Ask with \(place.name). The displayed radar frame and map area are not sent as storm-analysis evidence.").font(.caption)
                        }
                        if let onExistingMap {
                            Button("Open full existing map", action: { showingInfo = false; onExistingMap() })
                            Text("Opens the compatibility map.")
                        }
                    }
                }
                Section("Basemap") {
                    Button { model.selectBasemap(.streets) } label: {
                        Label("Streets", systemImage: model.basemapStyle == .streets ? "checkmark.circle.fill" : "map")
                    }
                    Button { model.selectBasemap(.aerial) } label: {
                        Label("Aerial", systemImage: model.basemapStyle == .aerial ? "checkmark.circle.fill" : "photo")
                    }.disabled(!model.canUseAerial)
                    if !model.canUseAerial { Text("Aerial needs an authorized basemap and USGS coverage at this place.").font(.caption) }
                    Button { model.selectBasemap(.satellite); showingInfo = false } label: {
                        Label("Satellite", systemImage: model.basemapStyle == .satellite ? "checkmark.circle.fill" : "globe.americas")
                    }
                    Text("Satellite replaces precipitation with the latest verified local true-color image and its acquisition date.").font(.caption)
                }
                Section("What the timeline means") {
                    Text(model.timelineMessage).font(.headline)
                    Text(model.selectedDetailLabel).font(.subheadline)
                    Text("Radar shows observations at their original source time. Forecast is model guidance, not a live observation or a promise of the exact storm position.")
                    Text("Rain total is a six-hour accumulation, not storm motion. We keep it separate from radar and model reflectivity.")
                    Text("Forecast may use recent radar motion only when source age, storm motion and coverage checks pass. It remains a forecast, never a new observation. Otherwise the original model is shown.")
                    Text(model.transitionExplanation).font(.footnote)
                    Text("Playback cycles through available frames. Gaps are not filled with invented radar scans, and forecast remains model guidance.")
                    Text("Missing or loading imagery is not evidence of clear weather.")
                    Text("Global RainViewer radar is step-only in this native map to stay within the provider’s shared request limit.")
                    if onExistingMap != nil {
                        Text("The full Nearcast map remains available in this compatibility experience.")
                    }
                }
                Section("Time and place") {
                    Text(place.name)
                    Text(model.timezoneLabel)
                    Text("Uses your 12/24-hour clock setting. Panning the map does not change your selected place or notification settings.")
                }
                Section("Sources") {
                    Text(tileActivity).font(.caption)
                    Text(model.basemapStatus)
                    Link("NOAA / National Weather Service", destination: URL(string: "https://www.weather.gov/")!)
                    Link("RainViewer · global observed fallback", destination: URL(string: "https://www.rainviewer.com/")!)
                    Link("CARTO", destination: URL(string: "https://carto.com/attributions")!)
                    Link("OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                    Link("MapLibre Native", destination: URL(string: "https://maplibre.org/")!)
                }
                #if DEBUG
                Section("Performance diagnostics") {
                    Text(model.performanceDebugSummary).font(.caption.monospacedDigit())
                        .textSelection(.enabled)
                    Text("Local counters only. Timings measure preparation and publication to the map, not final screen drawing. Provider keys and locations are not logged.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                #endif
            }
            .navigationTitle("Map tools").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingInfo = false } } }
        }
    }

    private var alertInformation: some View {
        NavigationStack {
            Group {
                if let selectedAlertID, let alert = model.alert(selectedAlertID) {
                    alertDetail(alert)
                } else {
                    List {
                        Section {
                            Text(model.alertStatus).font(.headline)
                            Text("For \(place.name). Official bulletins, independent of the radar time; check status above for freshness.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        ForEach(model.activeAlerts, id: \.id) { alert in
                            NavigationLink { alertDetail(alert) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(alert.event).font(.headline)
                                    Text(alert.headline).font(.subheadline).foregroundStyle(.secondary)
                                    if alert.geometry == nil { Text("Bulletin only · no official area outline supplied").font(.caption) }
                                }.fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Section("Across this map") {
                            Text(model.viewportAlertStatus).font(.headline)
                            ForEach(model.visibleAreaAlerts.filter { area in !model.activeAlerts.contains(where: { $0.id == area.id }) }, id: \.id) { alert in
                                NavigationLink { alertDetail(alert) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(alert.event).font(.headline)
                                        Text(alert.areaDescription).font(.subheadline).foregroundStyle(.secondary)
                                    }.fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        Section {
                            Text("Area outlines are checked after you move the map. Some official bulletins have no polygon, so an unshaded area is not an all-clear. Place alerts above include those bulletin-only alerts.")
                                .font(.footnote)
                            Link("National Weather Service", destination: URL(string: "https://www.weather.gov/")!)
                        }
                    }
                }
            }
            .navigationTitle("Official alerts").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingAlerts = false } } }
        }
    }

    private func locateOnce() {
        guard !locating else { return }
        locating = true; placeMessage = nil
        locationTask = Task { @MainActor in
            defer { locating = false }
            do {
                let result = try await NativePlaceLookupService().currentLocation()
                try Task.checkCancellation()
                focusPlace = result.previewPlace; focusRevision += 1
            } catch {
                guard !Task.isCancelled else { return }
                placeMessage = (error as? NativePlaceLookupError)?.errorDescription ?? "Location unavailable. You can still explore the map."
            }
        }
    }

    /// Never turn an identifier in a route into an alert claim by itself. The
    /// exact current native feed has to recognize it first. If it was retired,
    /// updated, or belongs to a different location, we leave the map honest
    /// and explain why instead of inventing an outline.
    private func resetRouteAlertFocus() {
        selectedAlertID = nil
        highlightedAlertID = nil
        routeAlertResolved = false
        routeAlertState = focusedAlertID == nil ? .none : .lookingUp
        resolveRouteAlertIfPossible()
    }

    private func resolveRouteAlertIfPossible() {
        guard let requestedID = focusedAlertID, !routeAlertResolved else { return }

        if let active = activeAlert(idOrKey: requestedID) {
            routeAlertResolved = true
            selectedAlertID = active.id
            highlightedAlertID = active.id
            if active.geometry == nil {
                routeAlertState = .bulletinOnly
            } else {
                routeAlertState = .focused
                alertFocusRevision += 1
            }
            showingAlerts = true
            return
        }

        // A feed can retain a cancelled/expired bulletin long enough to show
        // its last-known details. It must never be drawn as a current area.
        if let known = model.alert(requestedID) {
            routeAlertResolved = true
            selectedAlertID = known.id
            routeAlertState = .notCurrent
            showingAlerts = true
            return
        }

        // The selected-place request is the only authoritative source for a
        // route carrying just an alert identity and a place. Do not broaden a
        // failed match into a national hunt or guess where the bulletin was.
        guard model.alertSnapshot != nil || model.alertRefreshFailed else { return }
        routeAlertResolved = true
        routeAlertState = .unavailable
    }

    private func activeAlert(idOrKey identifier: String) -> NativeRadarAlertsContract.Alert? {
        (model.activeAlerts + model.visibleAreaAlerts).first {
            $0.id == identifier || $0.key == identifier
        }
    }

    private var routeAlertMessage: RouteAlertMessage? {
        switch routeAlertState {
        case .none:
            return nil
        case .lookingUp:
            return .init(title: "Finding linked official alert", detail: "Checking the current official alert feed for \(place.name).", symbol: "exclamationmark.triangle")
        case .focused:
            return .init(title: "Official alert highlighted", detail: "Its current official area is outlined on the map. Read the bulletin below for instructions.", symbol: "exclamationmark.triangle.fill")
        case .bulletinOnly:
            return .init(title: "Official bulletin opened", detail: "Its source did not include an official map outline, so Nearcast has not guessed at an affected area.", symbol: "exclamationmark.triangle")
        case .notCurrent:
            return .init(title: "Linked bulletin is no longer current", detail: "Last-known official details are open below. Nearcast does not draw expired or cancelled alert areas.", symbol: "clock.badge.exclamationmark")
        case .unavailable:
            return .init(title: "Linked alert could not be matched", detail: "It may have expired, been updated, or belong to a different area. Review the current official alerts for \(place.name).", symbol: "exclamationmark.triangle")
        }
    }

    private static func normalizedAlertID(_ input: String?) -> String? {
        guard let value = input?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    private func placeInformation(_ marker: NativePreviewPlace) -> some View {
        NavigationStack {
            List {
                Section {
                    Text(marker.name).font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
                    Button("Center map here") {
                        focusPlace = marker; focusRevision += 1; selectedMarker = nil
                    }.frame(minHeight: 44)
                    if let onSelectPlace, savedPlaces.contains(where: { $0.id == marker.id && $0.coordinateIdentity == marker.coordinateIdentity }) {
                        Button(changingPlace ? "Opening…" : "Use this place for weather") {
                            changingPlace = true
                            Task { @MainActor in
                                let success = await onSelectPlace(marker)
                                changingPlace = false
                                if success { selectedMarker = nil }
                                else { placeMessage = "Could not change places. Your current place has not changed." }
                            }
                        }.disabled(changingPlace).frame(minHeight: 44)
                    }
                    Text("Centering only moves the map. It does not change your saved places or notification choices.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let placeMessage { Text(placeMessage).foregroundStyle(.orange) }
                }
            }
            .navigationTitle("Map place").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { selectedMarker = nil }.disabled(changingPlace) } }
            .interactiveDismissDisabled(changingPlace)
        }
    }

    private func alertDetail(_ alert: NativeRadarAlertsContract.Alert) -> some View {
        List {
            Section {
                Text(alert.event).font(.title2.bold())
                Text(alert.headline).font(.headline)
                Text(model.bulletinStatus(alert)).font(.caption).foregroundStyle(.secondary)
                Text("Bulletin expires \(model.detailTime(min(alert.endAt, alert.expiresAt)))").font(.subheadline)
            }
            if !alert.instruction.isEmpty { Section("Official instructions") { Text(alert.instruction).textSelection(.enabled) } }
            if !alert.description.isEmpty { Section("Official bulletin") { Text(alert.description).textSelection(.enabled) } }
            Section("Area") {
                Text(alert.areaDescription)
                if alert.geometry == nil { Text("The source did not include a map outline for this bulletin.").font(.footnote) }
            }
            if let url = alert.sourceURL { Section { Link("Open official source", destination: url) } }
        }
    }

    private enum RouteAlertState: Equatable {
        case none, lookingUp, focused, bulletinOnly, notCurrent, unavailable
    }

    private struct RouteAlertMessage {
        let title: String
        let detail: String
        let symbol: String
    }
}
