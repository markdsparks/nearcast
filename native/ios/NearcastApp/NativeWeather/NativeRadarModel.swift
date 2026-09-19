import Foundation
import UIKit

enum NativeRadarProduct: String, CaseIterable, Identifiable {
    case radar, forecast, rainAmount
    var id: String { rawValue }
    var shortTitle: String {
        switch self { case .radar: return "Radar"; case .forecast: return "Forecast"; case .rainAmount: return "Rain total" }
    }
}

enum NativeRadarBasemap: String, CaseIterable, Identifiable {
    case streets = "Streets", aerial = "Aerial", satellite = "Satellite"
    var id: String { rawValue }
}

@MainActor
final class NativeRadarModel: ObservableObject {
    @Published private(set) var product: NativeRadarProduct = .radar
    @Published private var selectedInstant: Date?
    @Published private var evaluationTime = Date()
    @Published private(set) var refreshing = false
    @Published private(set) var loadingImage = false
    @Published private(set) var playing = false
    @Published private(set) var image: NativeRadarImage?
    @Published private(set) var base: NativeRadarTileLayer?
    @Published private(set) var labels: NativeRadarTileLayer?
    @Published private(set) var basemapRevision = 0
    @Published private(set) var rendererReady = false
    @Published private(set) var weatherRevision = 0
    @Published private(set) var basemapStatus = "Loading street map…"
    @Published private(set) var basemapStyle: NativeRadarBasemap = .streets
    @Published private(set) var satellite: NativeSatelliteDescriptor?
    @Published private(set) var satelliteMessage = "Loading the latest available satellite image…"
    @Published private(set) var loadingSatellite = false
    @Published private(set) var alertSnapshot: NativeRadarAlertsContract.Snapshot?
    @Published private(set) var alertGeometry: Data?
    @Published private(set) var alertRefreshFailed = false
    @Published private(set) var accumulationLegend: UIImage?
    @Published var mapFailure = false
    @Published private var timeline = RadarTimelineState(now: Date())
    @Published private var forecastRun: HRRRZarrClient.LoadedRun?
    @Published private var forecastFailed = false
    @Published private var observedFrames: [MRMSContract.AdvertisedFrame] = []
    @Published private var observedFailed = false
    @Published private var rawDiscoveryFinished = false
    @Published private var globalRadar: NativeGlobalRadarSnapshot?
    @Published private var imageMessage: String?
    @Published private var playbackMessage: String?
    private let clock: RadarTimelineClock
    let timezoneLabel: String
    private let place: NativePreviewPlace
    private var viewport: NativeRadarViewport?
    private var imageTask: Task<Void, Never>?
    private var playbackTask: Task<Void, Never>?
    private var manualRefreshTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var refreshGeneration = 0
    private var manualRefreshGeneration = 0
    private var satelliteTask: Task<Void, Never>?
    private var satelliteGeneration = 0
    private var lastMetadataAttempt: Date?
    private var imageGeneration = 0
    private var imageRequestID: String?
    private var active = true
    private var suspended = false
    private var basemapCatalog: NativeBasemapCatalog?
    private var forecastField: HRRRZarrClient.Field?
    private var forecastFieldBounds: NativeRadarViewport?
    private struct CachedRadarFrame {
        let image: NativeRadarImage
        let message: String?
    }
    private var radarCache = NativeRadarFrameCache<String, CachedRadarFrame>()
    private let forecastClient = try? HRRRZarrClient()
    private let forecastMetadataClient = try? HRRRZarrClient()
    private let observedClient = try? MRMSClient()
    private let globalClient = NativeGlobalRadarClient()
    private let satelliteClient = NativeSatelliteClient()
    private let alertsClient = NativeRadarAlertsClient()
    private let transport = try? RadarChunkClient(allowedOrigins: [
        URL(string: "https://opengeo.ncep.noaa.gov")!, URL(string: "https://nowcoast.noaa.gov")!])

    init(place: NativePreviewPlace, timezone: String?, uses24HourClock: Bool) {
        self.place = place
        let zone = timezone.flatMap(TimeZone.init(identifier:))?.identifier
        timezoneLabel = zone ?? "UTC · place time zone unavailable"
        clock = RadarTimelineClock(timeZoneIdentifier: zone ?? "UTC", uses24HourClock: uses24HourClock)!
    }

    private var timelineSource: RadarTimelineSource { product == .rainAmount ? .accumulation : .observed }
    private var sourceFrames: [RadarTimelineFrame] {
        let frames = timeline.frames(for: timelineSource)
        if timelineSource == .observed,
           !NativeRadarFreshnessPolicy.assess(latest: frames.last?.validTime, at: evaluationTime).sourceIsUsable { return [] }
        return frames
    }
    private var forecastSteps: [HRRRZarrContract.Step] {
        forecastRun?.grid.steps.filter { $0.validTime > evaluationTime } ?? []
    }
    private var isCONUSPlace: Bool { (20...55).contains(place.latitude) && (-130 ... -60).contains(place.longitude) }
    private var rawIsUsable: Bool {
        let latest = observedFrames.last.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
        return isCONUSPlace && NativeRadarFreshnessPolicy.assess(latest: latest, at: evaluationTime).sourceIsUsable
    }
    private var globalFrames: [NativeGlobalRadarFrame] { globalRadar?.frames.filter { $0.validTime <= evaluationTime } ?? [] }
    var usesGlobalRadar: Bool {
        guard product == .radar, let latest = globalFrames.last?.validTime,
              evaluationTime.timeIntervalSince(latest) <= 30 * 60 else { return false }
        return !rawIsUsable
    }
    var usesNumericRadar: Bool { product == .radar && rawIsUsable }
    var globalTiles: NativeRadarTileLayer? {
        guard usesGlobalRadar, globalFrames.indices.contains(selectedIndex) else { return nil }
        let frame = globalFrames[selectedIndex]
        return .init(id: frame.id, templates: [frame.tileURLTemplate], minimumZoom: frame.minimumZoom,
                     maximumZoom: frame.maximumZoom, credits: frame.attributions.map { ($0.title, $0.url) })
    }
    var frameDates: [Date] {
        if product == .forecast { return forecastSteps.map(\.validTime) }
        if product == .radar, !rawDiscoveryFinished && observedFrames.isEmpty { return [] }
        if usesGlobalRadar { return globalFrames.map(\.validTime) }
        if usesNumericRadar { return observedFrames.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) } }
        if !isCONUSPlace { return [] }
        return sourceFrames.map(\.validTime)
    }
    var selectedIndex: Int { (try? NativeRadarPresentationContract.selectedIndex(instant: selectedInstant, dates: frameDates)) ?? -1 }
    var selectedDate: Date? { selectedIndex >= 0 ? selectedInstant : nil }
    var wmsFrame: RadarProofFrame? {
        guard isCONUSPlace, product != .forecast, !usesNumericRadar, !usesGlobalRadar,
              sourceFrames.indices.contains(selectedIndex) else { return nil }
        return sourceFrames[selectedIndex].proofFrame
    }
    var firstTimeLabel: String { frameDates.first.map(clock.shortLabel) ?? "—" }
    var lastTimeLabel: String { frameDates.last.map(clock.shortLabel) ?? "—" }
    var selectedTimeLabel: String { selectedDate.map(clock.shortLabel) ?? (refreshing ? "Loading…" : "Unavailable") }
    var selectedDetailLabel: String {
        guard let selectedDate else { return selectedInstant == nil ? "No usable source time" : "Selected source time unavailable" }
        return clock.detailLabel(for: selectedDate)
    }
    var timelineMessage: String {
        if let playbackMessage { return playbackMessage }
        if usesGlobalRadar, let selectedDate {
            return "RainViewer · observed \(max(0, Int(evaluationTime.timeIntervalSince(selectedDate) / 60))) min ago"
        }
        if !isCONUSPlace && product != .radar { return "This forecast layer covers the continental US. Use the existing map for more layers." }
        if product == .forecast {
            if let imageMessage { return imageMessage }
            if forecastFailed { return "Forecast refresh unavailable. Any retained times keep their original model run." }
            guard let forecastRun else { return "NOAA HRRR model guidance · US coverage" }
            return "HRRR model · run \(clock.shortLabel(for: forecastRun.run.cycleTime)) · not live radar"
        }
        if usesNumericRadar, let imageMessage { return imageMessage }
        if usesNumericRadar && observedFailed { return "Radar refresh failed. The last successful observations retain their original times." }
        if !usesNumericRadar && timeline.status(for: timelineSource).state == .refreshFailed {
            return "Source refresh failed. Retained times are not newer observations."
        }
        if product == .rainAmount { return "NOAA NDFD · Six-hour totals, not storm motion." }
        if let selectedDate {
            let minutes = max(0, Int(Date().timeIntervalSince(selectedDate) / 60))
            let status = NativeRadarFreshnessPolicy.assess(latest: frameDates.last, selected: selectedDate, at: evaluationTime)
            let suffix = status.selectionStatus == .historical ? " · past radar" : status.sourceStatus == .delayed ? " · delayed" : ""
            return "NOAA MRMS · observed \(minutes) min ago\(suffix)"
        }
        return "NOAA MRMS · US radar coverage"
    }
    var mapMessage: String? {
        if mapFailure { return "The map could not render. Try refresh, or open the existing map from Info." }
        if basemapStyle == .satellite { return satellite == nil ? satelliteMessage : nil }
        if base == nil { return basemapStatus + " Weather imagery alone is not a complete map." }
        if product == .forecast || usesNumericRadar {
            if let imageMessage { return imageMessage }
            if loadingImage { return "Loading weather for this view…" }
        } else {
            if wmsFrame == nil && globalTiles == nil { return "Weather imagery is unavailable. This does not mean clear skies." }
            return "Loading or missing weather tiles do not mean clear skies."
        }
        return nil
    }

    func start() async {
        startupTask?.cancel()
        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await self.prepareAndLoad()
        }
        startupTask = task
        await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
    }

    private func prepareAndLoad() async {
        active = true
        suspended = false
        guard await NativeBasemapNetwork.prepareCache(), NativeBasemapNetwork.install(),
              active, !Task.isCancelled else {
            basemapStatus = "Native map storage could not be prepared. Open the existing map from Info."
            return
        }
        rendererReady = true
        async let maps: Void = loadBasemap()
        async let weather: Void = refresh()
        _ = await (maps, weather)
    }

    private func loadBasemap() async {
        let availability = await NativeBasemapClient().load()
        guard active, !suspended, !Task.isCancelled else { return }
        switch availability {
        case let .ready(catalog):
            basemapCatalog = catalog
            selectBasemap(basemapStyle)
        case .unavailable:
            basemapCatalog = nil
            base = nil; labels = nil
            basemapStatus = "Street map unavailable. Open the existing map from Info."
        }
        basemapRevision += 1
    }

    var canUseAerial: Bool { basemapCatalog != nil && NativeBasemapCatalog.supportsAerial(latitude: place.latitude, longitude: place.longitude) }
    func selectBasemap(_ style: NativeRadarBasemap) {
        guard style != .aerial || canUseAerial else { return }
        pause()
        satelliteTask?.cancel(); satelliteTask = nil; satelliteGeneration += 1
        basemapStyle = style
        if style == .satellite {
            imageTask?.cancel(); imageTask = nil; imageGeneration += 1
            image = nil; imageRequestID = nil; loadingImage = false
            base = nil; satellite = nil
            satelliteMessage = "Loading the latest available satellite image…"
            loadingSatellite = true
            basemapRevision += 1
            let generation = satelliteGeneration
            satelliteTask = Task { [weak self] in
                guard let self else { return }
                let result = await self.satelliteClient.resolveLatestAvailable(latitude: self.place.latitude, longitude: self.place.longitude)
                guard self.active, !Task.isCancelled, self.satelliteGeneration == generation, self.basemapStyle == .satellite else { return }
                self.loadingSatellite = false
                switch result {
                case let .ready(descriptor):
                    self.satellite = descriptor
                    self.base = .init(id: descriptor.id, templates: descriptor.tileURLTemplates,
                        minimumZoom: descriptor.minimumZoom, maximumZoom: descriptor.maximumZoom,
                        credits: descriptor.attributions.map { ($0.title, $0.url) })
                case .unavailable:
                    self.satelliteMessage = "No verified recent satellite image is available at this place. Try again or return to radar."
                }
                self.basemapRevision += 1
            }
            return
        }
        satellite = nil; loadingSatellite = false
        guard let catalog = basemapCatalog else {
            base = nil; basemapRevision += 1
            basemapStatus = "Street map unavailable. Open the existing map from Info."
            loadSelectedImage()
            return
        }
        let descriptor = style == .aerial ? catalog.aerial : catalog.streets
        func layer(_ source: NativeBasemapRasterSource) -> NativeRadarTileLayer {
            .init(id: source.id, templates: source.tileURLTemplates, minimumZoom: source.minimumZoom,
                  maximumZoom: source.maximumZoom, credits: source.attributions.map { ($0.title, $0.url) })
        }
        base = layer(descriptor.background); labels = layer(descriptor.labels)
        basemapStatus = style == .aerial ? "Aerial imagery · USGS / USDA · Labels: CARTO / OpenStreetMap" : "Street map · CARTO / OpenStreetMap"
        basemapRevision += 1
        loadSelectedImage()
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshGeneration += 1
        let generation = refreshGeneration
        refreshing = true
        lastMetadataAttempt = Date()
        mapFailure = false
        weatherRevision += 1
        pause()
        async let sourceTimes: Void = refreshWMS()
        async let modelTimes: Void = refreshForecast()
        async let radarTimes: Void = refreshObserved()
        async let alerts: Void = refreshAlerts()
        _ = await (sourceTimes, modelTimes, radarTimes, alerts)
        if refreshGeneration == generation { refreshing = false }
    }

    func requestRefresh() {
        guard active, !refreshing, manualRefreshTask == nil else { return }
        manualRefreshGeneration += 1
        let generation = manualRefreshGeneration
        manualRefreshTask = Task { [weak self] in
            guard let self else { return }
            await self.refresh()
            if self.base == nil, !Task.isCancelled { await self.loadBasemap() }
            if self.manualRefreshGeneration == generation { self.manualRefreshTask = nil }
        }
    }

    private func refreshWMS() async {
        guard isCONUSPlace else { return }
        let token = timeline.beginRefresh(at: Date())
        async let observed = fetch(.observed)
        async let amounts = fetch(.accumulation)
        let (observedResult, amountResult) = await (observed, amounts)
        guard active, !suspended, !Task.isCancelled else { return }
        timeline.applyRefresh([.observed: observedResult, .accumulation: amountResult], token: token, at: Date())
        if product == .rainAmount || (product == .radar && !usesNumericRadar && !usesGlobalRadar) { reconcileCurrentSelection() }
        if accumulationLegend == nil, let transport,
           let url = URL(string: "https://nowcoast.noaa.gov/geoserver/forecasts/ndfd_precipitation/ows?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image%2Fpng&width=283&height=33&layer=conus_6hr_precipitation_amount"),
           let data = try? await transport.fetchBytes(at: url, maximumBytes: 128 * 1024),
           let legend = UIImage(data: data), legend.size.width == 283, legend.size.height == 33,
           active, !suspended, !Task.isCancelled { accumulationLegend = legend }
    }

    private func refreshForecast() async {
        guard isCONUSPlace else { return }
        let forecastResult = await fetchForecast()
        guard active, !suspended, !Task.isCancelled else { return }
        if let forecastResult {
            if forecastRun?.run.cycleTime != forecastResult.run.cycleTime { forecastField = nil }
            forecastRun = forecastResult
            forecastFailed = false
        } else { forecastFailed = true }
        if product == .forecast { reconcileCurrentSelection() }
    }

    private func refreshObserved() async {
        async let raw = fetchObserved()
        async let global = globalClient.load(force: true)
        let (rawResult, globalResult) = await (raw, global)
        guard active, !suspended, !Task.isCancelled else { return }
        if let rawResult {
            let dates = rawResult.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
            let kept = (try? NativeRadarPresentationContract.boundedDates(dates,
                retaining: product == .radar ? selectedInstant : nil, limit: 6)) ?? []
            let included = Set(kept)
            observedFrames = rawResult.filter { included.contains(Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000)) }
            observedFailed = false
        }
        else { observedFailed = true }
        if case let .ready(snapshot) = globalResult { globalRadar = snapshot }
        rawDiscoveryFinished = true
        if product == .radar { reconcileCurrentSelection() }
    }

    var activeAlerts: [NativeRadarAlertsContract.Alert] {
        alertSnapshot?.alerts.filter { $0.isActive(at: evaluationTime) } ?? []
    }
    var alertStatus: String {
        guard let snapshot = alertSnapshot else { return alertRefreshFailed ? "Alert check unavailable" : "Checking place alerts…" }
        if snapshot.quality == .unsupported { return "NWS alerts unavailable in this region" }
        if alertRefreshFailed || !snapshot.isFresh(at: evaluationTime) { return "Last alert check is out of date" }
        if snapshot.isVerifiedEmpty(at: evaluationTime) { return "No active NWS alerts for this place" }
        if activeAlerts.isEmpty { return "Alert coverage could not be verified" }
        return "\(activeAlerts.count) official \(activeAlerts.count == 1 ? "alert" : "alerts") for this place"
    }
    func detailTime(_ date: Date) -> String { clock.detailLabel(for: date) }
    func alert(_ id: String) -> NativeRadarAlertsContract.Alert? { alertSnapshot?.alert(idOrKey: id) }
    private func refreshAlerts() async {
        guard let scope = try? NativeRadarAlertsContract.Scope.point(latitude: place.latitude,
            longitude: place.longitude, countryCode: place.countryCode) else { return }
        do {
            let snapshot = try await alertsClient.load(scope: scope)
            guard active, !suspended, !Task.isCancelled else { return }
            alertSnapshot = snapshot; alertRefreshFailed = false
            alertGeometry = try? snapshot.featureCollection(at: Date())
        } catch {
            guard active, !suspended, !Task.isCancelled else { return }
            alertRefreshFailed = true
            alertGeometry = nil
        }
    }

    private func reconcileCurrentSelection() {
        // Preserve the exact selected instant, even if it disappears. A refresh
        // may not silently move the thumb to another storm/time. A source choice
        // made during loading remains authoritative.
        evaluationTime = Date()
        if let current = try? NativeRadarPresentationContract.Selection(sourceID: product.rawValue, instant: selectedInstant),
           let reconciled = try? NativeRadarPresentationContract.reconcileRefresh(current: current,
                refreshedSourceID: product.rawValue, availableDates: frameDates,
                defaultPosition: product == .radar ? .last : .first) { selectedInstant = reconciled.instant }
        loadSelectedImage()
    }

    private func fetch(_ source: RadarTimelineSource) async -> RadarTimelineLoadResult {
        guard let transport else { return .failure }
        let template = RadarProofFrame(kind: source.proofKind, validTime: Date(), sourceTime: "", metadataFetchedAt: Date())
        guard let url = URL(string: template.endpoint + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities") else { return .failure }
        do {
            let data = try await transport.fetchBytes(at: url, maximumBytes: 3 * 1_024 * 1_024)
            try Task.checkCancellation()
            let times = try RadarProofCapabilities.times(in: data, layer: template.layer)
            guard times.count <= 4096 else { return .failure }
            return .success(times: times, fetchedAt: Date())
        } catch { return .failure }
    }

    private func fetchForecast() async -> HRRRZarrClient.LoadedRun? {
        guard let forecastMetadataClient else { return nil }
        return try? await forecastMetadataClient.loadLatest()
    }

    private func fetchObserved() async -> [MRMSContract.AdvertisedFrame]? {
        guard isCONUSPlace, let observedClient else { return nil }
        return try? await observedClient.listRecentFrames(historyMinutes: 30, maximumFrames: 24)
    }

    func selectProduct(_ next: NativeRadarProduct) {
        pause()
        product = next
        selectedInstant = (try? NativeRadarPresentationContract.selectSource(id: next.rawValue,
            dates: frameDates, position: next == .radar ? .last : .first))?.instant
        loadSelectedImage()
    }

    func selectFrame(_ index: Int) {
        pause()
        guard frameDates.indices.contains(index), selectedIndex != index else { return }
        selectedInstant = frameDates[index]
        loadSelectedImage()
    }
    func step(_ delta: Int) { selectFrame(selectedIndex + delta) }

    func updateViewport(_ bounds: NativeRadarViewport) {
        guard bounds != viewport else { return }
        viewport = bounds
        radarCache.setViewport(.init(west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north))
        forecastField = nil
        loadSelectedImage(debounce: true)
    }

    private func loadSelectedImage(debounce: Bool = false) {
        guard active, !suspended, basemapStyle != .satellite else { return }
        if selectedDate == nil {
            imageTask?.cancel(); imageTask = nil; imageGeneration += 1
            image = nil; imageRequestID = nil; loadingImage = false
            imageMessage = refreshing ? "Loading available source times…" : "Selected source time is unavailable. Choose Radar or Forecast to return to the latest times."
            return
        }
        let requestID = "\(product.rawValue)|\(usesNumericRadar)|\(usesGlobalRadar)|\(selectedInstant?.timeIntervalSince1970 ?? -1)|\(String(describing: viewport))|\(product == .forecast ? forecastRun?.run.cycleTime.timeIntervalSince1970 ?? -1 : -1)"
        if imageRequestID == requestID, image != nil || loadingImage { return }
        imageRequestID = requestID
        imageGeneration += 1
        let generation = imageGeneration
        let previous = imageTask
        previous?.cancel()
        image = nil
        imageMessage = nil
        loadingImage = false
        if usesNumericRadar {
            loadObservedImage(previous: previous, generation: generation, debounce: debounce)
            return
        }
        guard product == .forecast else { return }
        guard let run = forecastRun, let viewport, viewport.isUsable,
              forecastSteps.indices.contains(selectedIndex), let forecastClient else {
            imageMessage = refreshing ? "Loading model guidance…" : "Forecast imagery unavailable for this view."
            return
        }
        guard viewport.east - viewport.west <= 14, viewport.north - viewport.south <= 14 else {
            imageMessage = "Zoom in to load local forecast detail."
            return
        }
        let step = forecastSteps[selectedIndex]
        let available = forecastSteps
        let indexes = Array(available.dropFirst((selectedIndex / 8) * 8).prefix(8).map(\.sourceIndex))
        loadingImage = true
        imageTask = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            do {
                if debounce { try await Task.sleep(for: .milliseconds(350)) }
                let field: HRRRZarrClient.Field
                if self.forecastFieldBounds == viewport, let cached = self.forecastField,
                   cached.loaded.run.cycleTime == run.run.cycleTime,
                   cached.steps.contains(where: { $0.sourceIndex == step.sourceIndex }) { field = cached }
                else {
                    field = try await forecastClient.load(run: run,
                        bounds: .init(west: viewport.west, south: viewport.south, east: viewport.east, north: viewport.north),
                        sourceIndexes: indexes, maximumChunks: 8)
                }
                try Task.checkCancellation()
                let renderTask = Task.detached(priority: .userInitiated) {
                    try NativeRadarModel.render(field: field, step: step, bounds: viewport)
                }
                let result = try await withTaskCancellationHandler(operation: {
                    try Task.checkCancellation()
                    return try await renderTask.value
                }, onCancel: { renderTask.cancel() })
                try Task.checkCancellation()
                guard self.active, self.imageGeneration == generation else { return }
                self.forecastField = field; self.forecastFieldBounds = viewport
                self.image = result.image
                let placeInView = (viewport.south...viewport.north).contains(self.place.latitude)
                    && (viewport.west...viewport.east).contains(self.place.longitude)
                let placeValue = field.sample(longitude: self.place.longitude, latitude: self.place.latitude, sourceIndex: step.sourceIndex)
                self.imageMessage = placeInView && !(placeValue?.isFinite ?? false) ? "Forecast coverage is missing at this place."
                    : result.coverage < 0.98 ? "Some of this view is outside model coverage. Blank areas are unavailable." : nil
                self.loadingImage = false
            } catch {
                guard !Task.isCancelled, self.active, self.imageGeneration == generation else { return }
                self.loadingImage = false
                self.imageMessage = "Forecast imagery could not load for this view. Try zooming in or refreshing."
            }
        }
    }

    private func loadObservedImage(previous: Task<Void, Never>?, generation: Int, debounce: Bool) {
        guard let viewport, viewport.isUsable, observedFrames.indices.contains(selectedIndex), let observedClient else {
            imageMessage = "Radar imagery unavailable for this view."
            return
        }
        let frame = observedFrames[selectedIndex]
        if let cached = radarCache.value(for: frame.key) {
            image = cached.image; imageMessage = cached.message; loadingImage = false
            return
        }
        loadingImage = true
        imageTask = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            do {
                if debounce { try await Task.sleep(for: .milliseconds(350)) }
                let decoded = try await observedClient.decodeFrame(frame,
                    bounds: .init(minLat: viewport.south, minLon: viewport.west, maxLat: viewport.north, maxLon: viewport.east),
                    width: 384, height: 512)
                try Task.checkCancellation()
                guard decoded.hasCoverage else { throw MRMSContract.Failure.invalidOptions }
                let renderTask = Task.detached(priority: .userInitiated) {
                    try Task.checkCancellation()
                    let rgba = Data(try RadarNumericContract.resolvedRGBA(decoded.texture, encoding: decoded.encoding))
                    try Task.checkCancellation()
                    return try Self.makeImage(rgba: rgba, width: decoded.texture.width, height: decoded.texture.height)
                }
                let nativeImage = try await withTaskCancellationHandler(operation: {
                    try Task.checkCancellation()
                    return try await renderTask.value
                }, onCancel: { renderTask.cancel() })
                guard self.active, self.imageGeneration == generation, !Task.isCancelled else { return }
                self.image = .init(id: "mrms:\(frame.validTimeMilliseconds):\(viewport)", image: nativeImage,
                    west: viewport.west, south: viewport.south, east: viewport.east, north: viewport.north)
                let coverage = Double(decoded.validPixelCount) / Double(decoded.validDataMask.count)
                let placeCovered = Self.placeHasRadarCoverage(decoded, bounds: viewport,
                    latitude: self.place.latitude, longitude: self.place.longitude)
                self.imageMessage = placeCovered == false ? "Radar coverage is missing at this place."
                    : coverage < 0.98 ? "Some of this view has no radar coverage. Blank areas are unavailable." : nil
                if let image = self.image {
                    _ = self.radarCache.insert(.init(image: image, message: self.imageMessage), for: frame.key,
                        cost: decoded.texture.width * decoded.texture.height * 4)
                }
                self.loadingImage = false
            } catch {
                guard !Task.isCancelled, self.active, self.imageGeneration == generation else { return }
                self.loadingImage = false
                self.imageMessage = "Radar imagery could not load. Refresh or open the existing map."
            }
        }
    }

    nonisolated private static func placeHasRadarCoverage(_ decoded: MRMSContract.Viewport, bounds: NativeRadarViewport,
                                                          latitude: Double, longitude: Double) -> Bool? {
        guard latitude >= bounds.south, latitude <= bounds.north,
              longitude >= bounds.west, longitude <= bounds.east else { return nil }
        func mercator(_ value: Double) -> Double { log(tan(.pi / 4 + value * .pi / 360)) }
        let x = min(decoded.texture.width - 1, max(0, Int(floor((longitude - bounds.west) / (bounds.east - bounds.west) * Double(decoded.texture.width)))))
        let y = min(decoded.texture.height - 1, max(0, Int(floor((mercator(bounds.north) - mercator(latitude))
            / (mercator(bounds.north) - mercator(bounds.south)) * Double(decoded.texture.height)))))
        return decoded.validDataMask[y * decoded.texture.width + x] != 0
    }

    /// Resample the actual LCC grid into Web Mercator. A four-corner stretch of
    /// the original projected grid would misplace storms between the corners.
    nonisolated private static func render(field: HRRRZarrClient.Field, step: HRRRZarrContract.Step,
                                           bounds: NativeRadarViewport) throws -> (image: NativeRadarImage, coverage: Double) {
        let width = 384, height = 512
        let encoding = try RadarNumericContract.Encoding()
        var bytes = [UInt8](repeating: 0, count: width * height), covered = 0
        let viewport = try NativeRadarPresentationContract.Viewport(west: bounds.west, south: bounds.south,
                                                                    east: bounds.east, north: bounds.north)
        for y in 0..<height {
            try Task.checkCancellation()
            for x in 0..<width {
                let point = try viewport.pixelCenter(column: x, row: y, width: width, height: height)
                if let value = field.sample(longitude: point.longitude, latitude: point.latitude, sourceIndex: step.sourceIndex), value.isFinite {
                    covered += 1
                    // Clear-air negative dBZ is valid coverage but remains transparent.
                    if value >= 5 { bytes[y * width + x] = try RadarNumericContract.encodeDbz(Double(value), encoding: encoding) }
                }
            }
        }
        guard covered > 0 else { throw HRRRZarrCodec.Failure.invalidGeometry }
        let texture = try RadarNumericContract.Texture(width: width, height: height, bytes: bytes)
        let rgba = Data(try RadarNumericContract.resolvedRGBA(texture, encoding: encoding))
        let image = try makeImage(rgba: rgba, width: width, height: height)
        let id = "hrrr:\(field.loaded.run.cycleTime.timeIntervalSince1970):\(step.sourceIndex):\(bounds)"
        return (.init(id: id, image: image, west: bounds.west, south: bounds.south,
                      east: bounds.east, north: bounds.north), Double(covered) / Double(width * height))
    }

    nonisolated private static func makeImage(rgba: Data, width: Int, height: Int) throws -> UIImage {
        guard let provider = CGDataProvider(data: rgba as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
                decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw HRRRZarrCodec.Failure.malformedChunk }
        return UIImage(cgImage: image)
    }

    func togglePlayback() {
        if playing { pause(); return }
        // The public global fallback has a tight shared-IP tile budget. Keep
        // native preview step-only until a bounded memory tile cache is accepted.
        guard !usesGlobalRadar, basemapStyle != .satellite else { return }
        guard frameDates.count > 1 else { return }
        if selectedIndex < 0 || selectedIndex == frameDates.count - 1 { selectedInstant = frameDates.first; loadSelectedImage() }
        playing = true; playbackMessage = nil
        playbackTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(1200)) } catch { return }
                guard let self, self.active else { return }
                if self.loadingImage { continue }
                guard self.imageMessage == nil else { self.pause(); return }
                let limit: TimeInterval = self.product == .radar ? 10 * 60 : self.product == .forecast ? 60 * 60 : 6 * 60 * 60
                let decision = try? NativeRadarPresentationContract.nextPlayback(instant: self.selectedInstant,
                    dates: self.frameDates, maximumGap: limit)
                switch decision {
                case let .advance(instant): self.selectedInstant = instant; self.loadSelectedImage()
                case .end: self.playing = false; self.playbackMessage = "End of available frames."; return
                case .gap: self.playing = false; self.playbackMessage = "Paused at a gap. Choose the next frame to continue."; return
                default: self.playing = false; self.playbackMessage = "Selected time is no longer available."; return
                }
            }
        }
    }

    func pause() { playbackTask?.cancel(); playbackTask = nil; playing = false; playbackMessage = nil }
    func advanceClock() {
        let wasSuspended = suspended
        suspended = false
        if wasSuspended && basemapStyle == .satellite && satellite == nil { selectBasemap(.satellite) }
        evaluationTime = Date()
        timeline.advanceClock(to: evaluationTime)
        alertGeometry = alertRefreshFailed ? nil : try? alertSnapshot?.featureCollection(at: evaluationTime)
        if selectedDate == nil { pause(); loadSelectedImage() }
        else if image == nil && !loadingImage { loadSelectedImage() }
        if let lastMetadataAttempt, evaluationTime.timeIntervalSince(lastMetadataAttempt) >= 4 * 60 { requestRefresh() }
        else if lastMetadataAttempt == nil && rendererReady { requestRefresh() }
        if wasSuspended && !rendererReady { Task { await start() } }
    }
    func suspend() {
        suspended = true
        pause()
        startupTask?.cancel(); startupTask = nil
        refreshGeneration += 1; manualRefreshGeneration += 1
        refreshing = false; lastMetadataAttempt = nil
        manualRefreshTask?.cancel(); manualRefreshTask = nil
        imageTask?.cancel(); imageTask = nil; imageGeneration += 1
        loadingImage = false
        satelliteTask?.cancel(); satelliteTask = nil; satelliteGeneration += 1
        loadingSatellite = false
        imageRequestID = nil
    }
    func cancel() { active = false; suspend() }
}
