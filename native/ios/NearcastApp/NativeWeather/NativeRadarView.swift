import SwiftUI

/// Opt-in native map surface. The existing map remains a single action away for
/// layers whose data/licensing/rendering parity has not yet been accepted.
struct NativeRadarView: View {
    let place: NativePreviewPlace
    let onClose: () -> Void
    let onExistingMap: () -> Void
    let onAskAboutPlace: (() -> Void)?
    let savedPlaces: [NativePreviewPlace]
    let onSelectPlace: ((NativePreviewPlace) async -> Bool)?
    @StateObject private var model: NativeRadarModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var recenter = 0
    @State private var zoomCommand = 0
    @State private var showingInfo = false
    @State private var showingAlerts = false
    @State private var selectedAlertID: String?
    @State private var selectedMarker: NativePreviewPlace?
    @State private var focusPlace: NativePreviewPlace?
    @State private var focusRevision = 0
    @State private var locating = false
    @State private var locationTask: Task<Void, Never>?
    @State private var placeMessage: String?
    @State private var changingPlace = false
    @State private var tileActivity = "No raster tile activity reported yet."
    private let legendBands = (try? NativeRadarPresentationContract.resolvedLegendBands(encoding: .init())) ?? []

    init(place: NativePreviewPlace, timezone: String?, uses24HourClock: Bool,
         savedPlaces: [NativePreviewPlace] = [], onSelectPlace: ((NativePreviewPlace) async -> Bool)? = nil,
         onAskAboutPlace: (() -> Void)? = nil,
         onClose: @escaping () -> Void, onExistingMap: @escaping () -> Void) {
        self.place = place
        self.onClose = onClose
        self.onExistingMap = onExistingMap
        self.onAskAboutPlace = onAskAboutPlace
        self.savedPlaces = savedPlaces
        self.onSelectPlace = onSelectPlace
        _model = StateObject(wrappedValue: NativeRadarModel(place: place,
            timezone: timezone, uses24HourClock: uses24HourClock))
    }

    var body: some View {
        ZStack {
            if model.rendererReady {
                NativeRadarMap(place: place, savedPlaces: savedPlaces, focusPlace: focusPlace,
                    focusRevision: focusRevision, base: model.base, labels: model.labels,
                    basemapRevision: model.basemapRevision,
                    weatherRevision: model.weatherRevision,
                    weather: model.basemapStyle == .satellite ? nil : model.wmsFrame,
                    weatherTiles: model.basemapStyle == .satellite ? nil : model.globalTiles,
                    image: model.basemapStyle == .satellite ? nil : model.image,
                    recenter: recenter, zoomCommand: zoomCommand,
                    maximumZoom: model.basemapStyle == .satellite ? 9 : 16,
                    alerts: model.alertGeometry,
                    onAlert: { selectedAlertID = $0; showingAlerts = true },
                    onPlace: { selectedMarker = $0; placeMessage = nil },
                    onViewport: model.updateViewport,
                    onFailure: { model.mapFailure = true },
                    onTileActivity: { tileActivity = $0 })
                    .ignoresSafeArea()
            } else { Color(red: 0.15, green: 0.21, blue: 0.26).ignoresSafeArea() }
            GeometryReader { geometry in
                if geometry.size.width > geometry.size.height {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(spacing: 12) {
                            header
                            mapTools
                            Spacer(minLength: 0)
                        }
                        ScrollView {
                            VStack(spacing: 10) { statusMessage; bottomPanel }
                        }.frame(width: min(420, geometry.size.width * 0.52))
                    }
                    .padding(12)
                } else {
                    VStack(spacing: 12) {
                        header
                        mapTools
                        Spacer(minLength: 8)
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
        .sheet(isPresented: $showingInfo) { information }
        .sheet(isPresented: $showingAlerts, onDismiss: { selectedAlertID = nil }) { alertInformation }
        .sheet(item: $selectedMarker) { marker in placeInformation(marker) }
        .task { await model.start() }
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

    private var mapTools: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                legend
                Button { selectedAlertID = nil; showingAlerts = true } label: {
                    Label("Alerts", systemImage: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold)).padding(12).frame(minHeight: 44)
                        .background(.regularMaterial, in: Capsule())
                }.foregroundStyle(model.activeAlerts.isEmpty && model.visibleAreaAlerts.isEmpty ? Color.primary : Color.orange)
            }
            Spacer()
            VStack(spacing: 8) {
                mapButton("scope", label: "Recenter on \(place.name)") { recenter += 1 }
                Button { locateOnce() } label: {
                    Group {
                        if locating { ProgressView() }
                        else { Image(systemName: "location").font(.headline) }
                    }.frame(width: 46, height: 46)
                }.foregroundStyle(.primary).background(.regularMaterial, in: Circle())
                    .disabled(locating).accessibilityLabel("Show my location on this map")
            }
        }
    }

    @ViewBuilder private var statusMessage: some View {
        if let message = placeMessage ?? model.mapMessage {
            Text(message).font(.footnote.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        }
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
                  HStack(spacing: 5) {
                    Link("MapLibre", destination: URL(string: "https://maplibre.org/")!)
                    if model.labels != nil {
                        Text("·")
                        Link("© CARTO", destination: URL(string: "https://carto.com/attributions")!)
                        Text("·")
                        Link("© OpenStreetMap contributors", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                    }
                  }
                }.font(.caption2).foregroundStyle(.primary)
                    .padding(.horizontal, 10).padding(.vertical, 4)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: onClose) {
                Image(systemName: "xmark").font(.headline).frame(width: 48, height: 48)
            }.accessibilityLabel("Close map")
            VStack(alignment: .leading, spacing: 2) {
                Text(place.name).font(.headline).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button { showingInfo = true } label: {
                Image(systemName: "square.3.layers.3d").font(.title3).frame(width: 48, height: 48)
            }.accessibilityLabel("Map sources and more layers")
        }
        .padding(.vertical, 5).padding(.trailing, 4)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26))
        .foregroundStyle(.primary)
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
            }.padding(16).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        } else { timeline }
    }

    private var timeline: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { model.togglePlayback() } label: {
                    Image(systemName: model.playing ? "pause.fill" : "play.fill")
                        .font(.title3).frame(width: 44, height: 44)
                        .background(.white.opacity(0.1), in: Circle())
                }.disabled(model.scrubberDates.count < 2 || model.usesGlobalRadar)
                    .accessibilityLabel(model.playing ? "Pause animation" : "Play radar and forecast")
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.displayedTimeLabel).font(.title3.bold()).monospacedDigit()
                    Text(model.displayedSourceLabel).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if model.loadingImage || model.refreshing { ProgressView().controlSize(.small) }
                if model.product != .rainAmount {
                    Menu {
                        Button("Next hour") { model.setTimelineHours(1) }
                        Button("Next 6 hours") { model.setTimelineHours(6) }
                    } label: {
                        Text("\(model.timelineHours)h").font(.subheadline.weight(.semibold)).frame(minWidth: 36, minHeight: 44)
                    }.accessibilityLabel("Timeline range, \(model.timelineHours) hours")
                }
                Button { model.selectProduct(.radar) } label: {
                    Text("Latest").font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }.accessibilityLabel("Latest available radar")
                Button { showingInfo = true } label: {
                    Image(systemName: "info.circle").frame(width: 44, height: 44)
                }.foregroundStyle(.secondary).accessibilityLabel("Map sources, attribution and layers")
            }
            if let first = model.scrubberDates.first, let last = model.scrubberDates.last, first < last {
                Slider(value: Binding(get: {
                    min(last.timeIntervalSince1970, max(first.timeIntervalSince1970,
                        (model.scrubberInstant ?? first).timeIntervalSince1970))
                }, set: { model.selectScrubberTime(Date(timeIntervalSince1970: $0)) }),
                    in: first.timeIntervalSince1970...last.timeIntervalSince1970)
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
                Text(model.product == .rainAmount ? "Rain total" : model.scrubberDates.contains { $0 > model.scrubberNow } ? "Radar → Forecast" : "Observed radar")
                Spacer()
                Text(model.scrubberEndLabel)
            }.font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            Text(model.pendingTimeLabel ?? " ").font(.caption2).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true).frame(minHeight: 26).padding(.top, 4)
                .accessibilityHidden(model.pendingTimeLabel == nil)
            // Provider credits stay visible, but share the timeline surface
            // rather than adding another floating card beneath it.
            credits.padding(.top, 6)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26))
        .overlay(RoundedRectangle(cornerRadius: 26).strokeBorder(.white.opacity(0.16)))
        .shadow(color: .black.opacity(0.18), radius: 16, y: 6)
    }

    private var information: some View {
        NavigationStack {
            List {
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
                Section {
                    if let onAskAboutPlace {
                        Button("Ask about this place") { showingInfo = false; onAskAboutPlace() }
                        Text("Opens Ask with \(place.name). The displayed radar frame and map area are not sent as storm-analysis evidence.").font(.caption)
                    }
                    Button("Open full existing map", action: { showingInfo = false; onExistingMap() })
                    Text("For Storm Check, StormScope and lightning, open the full existing map. Native preview does not replace those tools yet.")
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
                    Text("Only advertised model times appear. Playback stops at the last available frame; gaps are not filled with invented radar scans.")
                    Text("Missing or loading imagery is not evidence of clear weather.")
                    Text("Global RainViewer radar is step-only in this preview to stay within the provider’s shared request limit. The full existing map remains available.")
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
            }
            .navigationTitle("About this map").navigationBarTitleDisplayMode(.inline)
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
}
