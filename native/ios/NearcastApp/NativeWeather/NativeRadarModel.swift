import Foundation
import UIKit
import OSLog

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
    @Published private var displayedInstant: Date?
    @Published private var displayedProduct: NativeRadarProduct?
    @Published private var displayedEnhanced = false
    @Published private(set) var enhancementEnabled = true
    @Published private(set) var timelineHours = 1
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
    @Published private(set) var viewportAlerts: NativeRadarAlertsContract.ViewportSnapshot?
    @Published private(set) var viewportAlertsFailed = false
    @Published private(set) var checkingViewportAlerts = false
    @Published private(set) var transitionApplied = false
    @Published private(set) var transitionExplanation = "Forecast uses the original HRRR model guidance."
    @Published private(set) var accumulationLegend: UIImage?
    @Published var mapFailure = false
    @Published private var timeline = RadarTimelineState(now: Date())
    @Published private var forecastRun: HRRRZarrClient.LoadedRun?
    @Published private var subhourlyFrames: [HRRRSubhourly.Frame] = []
    private let subhourlyClient = try? HRRRSubhourlyClient()
    private var preparedHandoff: NativeRadarTransition.Prepared?
    @Published private var forecastFailed = false
    @Published private var observedFrames: [MRMSContract.AdvertisedFrame] = []
    // Timeline memory stays small; motion estimation also needs advertised
    // metadata around -20 minutes (no images are fetched just by retaining it).
    private var observedHistory: [MRMSContract.AdvertisedFrame] = []
    @Published private var observedFailed = false
    @Published private var rawDiscoveryFinished = false
    @Published private var globalRadar: NativeGlobalRadarSnapshot?
    @Published private var imageMessage: String?
    @Published private var coverageMessage: String?
    @Published private var playbackMessage: String?
    private let clock: RadarTimelineClock
    let timezoneLabel: String
    private let place: NativePreviewPlace
    private var viewport: NativeRadarViewport?
    /// Weather covers a padded envelope independent of the exact camera. The
    /// renderer always positions an image at its own geographic corners.
    private var coverageEnvelope: NativeRadarCoveragePolicy.Envelope?
    private var coverageViewport: NativeRadarViewport? {
        guard let coverageEnvelope else { return nil }
        let bounds = coverageEnvelope.bounds
        return .init(west: bounds.west, south: bounds.south, east: bounds.east,
                     north: bounds.north, zoom: coverageEnvelope.qualityZoom)
    }
    private var viewportAlertTask: Task<Void, Never>?
    private var viewportAlertGeneration = 0
    private var imageTask: Task<Void, Never>?
    private var hourlyImageTask: Task<Void, Never>?
    private var prefetchTask: Task<Void, Never>?
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
    // A retained image may belong to the previous time or camera. Only a
    // successfully published result can satisfy the current request.
    private var displayedImageRequestID: String?
    private var imageUnavailableAtPlace = false
    private struct DisplayedCoverage {
        let width: Int
        let height: Int
        let bounds: NativeRadarViewport
        let bits: [UInt8]
        let fullyCovered: Bool

        func covers(_ index: Int) -> Bool {
            index >= 0 && index < width * height && bits[index / 8] & UInt8(1 << (index % 8)) != 0
        }
    }
    private var displayedCoverage: DisplayedCoverage?
    private let performanceLog = Logger(subsystem: "app.nearcast.ios", category: "RadarPerformance")
    private var performanceHits = 0
    private var performanceMisses = 0
    private var performanceJoins = 0
    private var performanceRenders = 0
    private var lastSourceMilliseconds = 0.0
    private var lastRenderMilliseconds = 0.0
    private var lastPublishMilliseconds = 0.0
    private var selectionStartedAt = ProcessInfo.processInfo.systemUptime
    var performanceDebugSummary: String {
        "Frames: \(performanceHits) hits / \(performanceMisses) misses · \(performanceJoins) joins · \(performanceRenders) renders\n"
            + "Last: source \(Int(lastSourceMilliseconds)) ms · render \(Int(lastRenderMilliseconds)) ms · publish \(Int(lastPublishMilliseconds)) ms\n"
            + "Resident: \((observedRepository.retainedBytes + Self.frameStore.forecast.totalCost + Self.frameStore.evidence.totalCost) / 1_048_576) MiB / 64 MiB"
    }
    private func recordFrameHit(_ hit: Bool) {
        if hit { performanceHits += 1 } else { performanceMisses += 1 }
        performanceLog.debug("frame_cache hit=\(hit, privacy: .public) hits=\(self.performanceHits, privacy: .public) misses=\(self.performanceMisses, privacy: .public)")
    }
    private func recordPublish() {
        displayedImageRequestID = imageRequestID
        lastPublishMilliseconds = max(0, (ProcessInfo.processInfo.systemUptime - selectionStartedAt) * 1000)
        performanceLog.info("frame_published selected_to_publish_ms=\(self.lastPublishMilliseconds, privacy: .public) source_ms=\(self.lastSourceMilliseconds, privacy: .public) render_ms=\(self.lastRenderMilliseconds, privacy: .public)")
    }
    private var active = true
    private var suspended = false
    private var basemapCatalog: NativeBasemapCatalog?
    private var forecastField: HRRRZarrClient.Field?
    private var forecastFieldBounds: NativeRadarViewport?
    /// A finished forecast keeps its display coverage, not a second copy of the
    /// original numeric model field. The source client owns that shared cache.
    private struct CachedForecastFrame {
        let image: NativeRadarImage
        let validTime: Date
        let width: Int
        let height: Int
        let coverageBits: [UInt8]
        let coveredPixels: Int
        let enhanced: Bool
        let explanation: String

        init(image: NativeRadarImage, numeric: NativeRadarSeamEstimation.Frame,
             enhanced: Bool, explanation: String) {
            self.image = image
            validTime = Date(timeIntervalSince1970: Double(numeric.validTimeMilliseconds) / 1000)
            width = numeric.texture.width; height = numeric.texture.height
            var bits = [UInt8](repeating: 0, count: (numeric.validDataMask.count + 7) / 8)
            var count = 0
            for index in numeric.validDataMask.indices where numeric.validDataMask[index] != 0 {
                bits[index / 8] |= UInt8(1 << (index % 8)); count += 1
            }
            coverageBits = bits; coveredPixels = count
            self.enhanced = enhanced; self.explanation = explanation
        }

        var cost: Int { width * height * 4 + coverageBits.count }
        func covers(_ index: Int) -> Bool {
            index >= 0 && index < width * height && coverageBits[index / 8] & UInt8(1 << (index % 8)) != 0
        }
    }
    /// App-lifetime, bounded caches survive dismissal/reopening and A→B→A.
    /// Keys include the immutable source and exact geographic/render identity;
    /// changing the camera never relabels an image or clears unrelated entries.
    @MainActor private final class FrameStore {
        var forecast = NativeRadarFrameCache<String, CachedForecastFrame>(policy: .forecastRenderedAreas)
        var evidence = NativeRadarFrameCache<String, NativeRadarSeamEstimation.Frame>(policy: .transitionEvidence)
        var generation = 0
        var subhourlyMetadata: (frames: [HRRRSubhourly.Frame], at: Date)?
        var forecastMetadata: (run: HRRRZarrClient.LoadedRun, at: Date)?
        var pressureObserver: NSObjectProtocol?

        init() {
            pressureObserver = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.removeAll() }
            }
        }
        func removeAll() {
            generation += 1
            forecast.removeAll(); evidence.removeAll()
            Task {
                await HRRRSubhourlyCache.shared.removeAll()
            }
        }
    }
    private static let frameStore = FrameStore()
    private let observedRepository = NativeRadarObservedRepository.shared
    private enum FrameWorkResult {
        case observed(NativeRadarObservedRepository.RenderedFrame)
        case forecast(CachedForecastFrame)
    }
    private struct FrameWork {
        let token: UUID
        let task: Task<FrameWorkResult, Error>
        var foreground: Bool
    }
    private var frameWork: [String: FrameWork] = [:]
    private let forecastClient = try? HRRRZarrClient()
    private let forecastMetadataClient = try? HRRRZarrClient()
    private let observedClient = try? MRMSClient()
    private let globalClient = NativeGlobalRadarClient()
    private let satelliteClient = NativeSatelliteClient()
    private let alertsClient = NativeRadarAlertsClient()
    private let viewportAlertsClient = NativeRadarAlertsClient()
    private let transport = try? RadarChunkClient(allowedOrigins: [
        URL(string: "https://opengeo.ncep.noaa.gov")!, URL(string: "https://nowcoast.noaa.gov")!])

    init(place: NativePreviewPlace, timezone: String?, uses24HourClock: Bool,
         initialContext: NativeRadarOpeningContext? = nil) {
        self.place = place
        let zone = timezone.flatMap(TimeZone.init(identifier:))?.identifier
        timezoneLabel = zone ?? "UTC · place time zone unavailable"
        clock = RadarTimelineClock(timeZoneIdentifier: zone ?? "UTC", uses24HourClock: uses24HourClock)!
        if isCONUSPlace {
            let now = Date()
            if let cached = observedRepository.cachedRecentFrames(now: now) {
                observedHistory = Array(cached.suffix(24))
                observedFrames = Array(cached.suffix(6))
                rawDiscoveryFinished = true
                selectedInstant = observedFrames.last.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
            }
            if let cached = Self.frameStore.subhourlyMetadata, now.timeIntervalSince(cached.at) < 120 { subhourlyFrames = cached.frames }
            if let cached = Self.frameStore.forecastMetadata, now.timeIntervalSince(cached.at) < 120 { forecastRun = cached.run }
        }
        if let context = initialContext, context.isUsable(for: place) {
            if let observedImage = context.image {
                observedHistory = Array(context.observedFrames.suffix(24))
                let dates = observedHistory.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
                let kept = Set((try? NativeRadarPresentationContract.boundedDates(dates,
                    retaining: context.frameTime, limit: 6)) ?? [])
                observedFrames = observedHistory.filter { kept.contains(Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000)) }
                image = observedImage
            } else if let snapshot = context.globalSnapshot {
                globalRadar = snapshot
                observedHistory = []; observedFrames = []
            }
            rawDiscoveryFinished = true
            selectedInstant = context.frameTime; displayedInstant = context.frameTime
            displayedProduct = .radar; displayedEnhanced = false
            // The preview's image retains its true landscape corners. The
            // first portrait viewport independently requests larger coverage.
        }
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
    private var usableSubhourly: [HRRRSubhourly.Frame] {
        subhourlyFrames.filter { $0.validTime > evaluationTime && evaluationTime.timeIntervalSince($0.cycle) <= 3 * 3600 }
    }
    private var forecastDates: [Date] { usableSubhourly.isEmpty ? forecastSteps.map(\.validTime) : usableSubhourly.map(\.validTime) }
    private var isCONUSPlace: Bool { (20...55).contains(place.latitude) && (-130 ... -60).contains(place.longitude) }
    private var rawIsUsable: Bool {
        let latest = observedFrames.last.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
        return isCONUSPlace && NativeRadarFreshnessPolicy.assess(latest: latest, at: evaluationTime).sourceIsUsable
    }
    private func coverageKey(_ bounds: NativeRadarViewport) -> String {
        NativeRadarCoveragePolicy.Envelope(bounds: .init(west: bounds.west, south: bounds.south,
            east: bounds.east, north: bounds.north), qualityZoom: bounds.zoom).cacheKey
    }
    private func observedCacheKey(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport? = nil) -> String {
        guard let bounds = bounds ?? coverageViewport else { return "observed-no-coverage" }
        return NativeRadarObservedRepository.cacheKey(frame, bounds: bounds)
    }
    private func subhourlySourceKey(_ frame: HRRRSubhourly.Frame) -> String {
        // Length-framed source URL plus advertised record range distinguishes
        // revised records, not merely another timestamp from the same run.
        let url = frame.url.absoluteString
        return "hrrr15-v2|\(url.utf8.count):\(url)|\(frame.range.lowerBound):\(frame.range.upperBound)|\(frame.cycle.timeIntervalSince1970)|\(frame.leadMinutes)"
    }
    private func forecastCacheKey(source: String, cycle: Date, anchor: Date?, target: Date,
                                  bounds: NativeRadarViewport, candidates: [MRMSContract.AdvertisedFrame]) -> String {
        let original = "forecast-render-v4|\(source)|\(cycle.timeIntervalSince1970)|\(target.timeIntervalSince1970)|\(coverageKey(bounds))"
        // An unchanged original model frame does not depend on the moving
        // radar anchor. Its advertised source/future eligibility is validated
        // separately; only enhanced variants need motion freshness identity.
        guard enhancementEnabled, !candidates.isEmpty else { return original + "|original" }
        let iso: (Date) -> String = { RadarNumericContract.isoTime(Int64($0.timeIntervalSince1970 * 1000)) }
        let observations = candidates.compactMap {
            try? NativeRadarTransitionPolicy.ObservationIdentity(sourceID: "\($0.key)|\($0.byteLength)",
                validTime: RadarNumericContract.isoTime($0.validTimeMilliseconds))
        }
        let evidence = try? NativeRadarTransitionPolicy.requestIdentity(observed: observations,
            modelCycleTime: iso(cycle), modelAnchorValidTime: anchor.map(iso),
            targetValidTime: iso(target), requestedAt: iso(Date()))
        return original + "|enhanced-request|" + (evidence?.cacheKey ?? "unavailable")
    }
    private func subhourlyRenderKey(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarViewport) -> String {
        subhourlyInputs(frame, bounds: bounds).key
    }
    private func subhourlyInputs(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarViewport)
        -> (key: String, anchor: HRRRSubhourly.Frame?, candidates: [MRMSContract.AdvertisedFrame]) {
        let anchor = usableSubhourly.first
        let candidates = enhancementEnabled && anchor != nil
            ? transitionCandidates(anchorTime: anchor!.validTime, targetTime: frame.validTime, cycle: frame.cycle) : []
        let source = subhourlySourceKey(frame) + (candidates.isEmpty ? "" : "|anchor:" + (anchor.map(subhourlySourceKey) ?? "missing"))
        return (forecastCacheKey(source: source, cycle: frame.cycle, anchor: anchor?.validTime,
            target: frame.validTime, bounds: bounds, candidates: candidates), anchor, candidates)
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
        if product == .forecast { return forecastDates }
        if product == .radar, !rawDiscoveryFinished && observedFrames.isEmpty { return [] }
        if usesGlobalRadar { return globalFrames.map(\.validTime) }
        if usesNumericRadar { return observedFrames.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) } }
        if !isCONUSPlace { return [] }
        return sourceFrames.map(\.validTime)
    }
    var selectedIndex: Int { (try? NativeRadarPresentationContract.selectedIndex(instant: selectedInstant, dates: frameDates)) ?? -1 }
    // One timeline, retaining each provider's actual timestamps. Rain totals
    // remain a separate product rather than masquerading as storm motion.
    var scrubberDates: [Date] {
        if product == .rainAmount { return frameDates }
        let observed: [Date]
        if rawIsUsable {
            observed = observedFrames.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
        } else if let latest = globalFrames.last, evaluationTime.timeIntervalSince(latest.validTime) <= 1800 {
            observed = globalFrames.map(\.validTime)
        } else { observed = isCONUSPlace ? sourceFrames.map(\.validTime) : [] }
        return (try? NativeRadarPresentationContract.integratedDates(observed: observed,
            forecast: isCONUSPlace ? forecastDates : [], now: evaluationTime, hours: timelineHours)) ?? []
    }
    /// While playing, the thumb represents the frame visible on the map, not
    /// the next selected frame while it is still decoding offscreen.
    var scrubberInstant: Date? { playing ? (displayedInstant ?? selectedInstant) : selectedInstant }
    var scrubberNow: Date { evaluationTime }
    var scrubberStartLabel: String { scrubberDates.first.map(clock.shortLabel) ?? "—" }
    var scrubberEndLabel: String { scrubberDates.last.map(clock.shortLabel) ?? "—" }
    var displayedTimeLabel: String {
        (image == nil ? selectedDate : displayedInstant).map(clock.shortLabel) ?? "Loading…"
    }
    var displayedSourceLabel: String {
        guard image != nil, let displayedProduct else { return selectedSourceLabel }
        return displayedProduct == .radar ? "Observed radar" : displayedEnhanced ? "Radar-guided forecast" : "Model forecast"
    }
    var pendingTimeLabel: String? {
        guard image != nil, displayedInstant != selectedInstant else { return playbackMessage }
        return "\(loadingImage ? "Loading" : "Unavailable") \(selectedTimeLabel) · showing previous frame"
    }
    func selectScrubberTime(_ date: Date, pausePlayback: Bool = true) {
        if pausePlayback { pause() }
        guard let nearest = try? NativeRadarPresentationContract.nearestScrubberDate(date, dates: scrubberDates) else { return }
        guard nearest != selectedInstant else {
            retrySelectedImageForPlayback()
            return
        }
        if product != .rainAmount { product = nearest > evaluationTime ? .forecast : .radar }
        selectedInstant = nearest
        loadSelectedImage()
    }
    func setEnhancement(_ enabled: Bool) {
        pause(); enhancementEnabled = enabled; imageRequestID = nil; loadSelectedImage()
    }
    func setTimelineHours(_ hours: Int) {
        guard hours == 1 || hours == 6 else { return }
        pause(); timelineHours = hours
        if let selectedInstant, !scrubberDates.contains(selectedInstant), let last = scrubberDates.last {
            selectScrubberTime(last)
        }
    }
    func stepScrubber(_ delta: Int) {
        let dates = scrubberDates
        guard let selectedInstant, let index = dates.firstIndex(of: selectedInstant), dates.indices.contains(index + delta) else { return }
        selectScrubberTime(dates[index + delta])
    }
    var selectedDate: Date? { selectedIndex >= 0 ? selectedInstant : nil }
    var wmsFrame: RadarProofFrame? {
        guard isCONUSPlace, product != .forecast, !usesNumericRadar, !usesGlobalRadar,
              sourceFrames.indices.contains(selectedIndex) else { return nil }
        return sourceFrames[selectedIndex].proofFrame
    }
    var firstTimeLabel: String { frameDates.first.map(clock.shortLabel) ?? "—" }
    var lastTimeLabel: String { frameDates.last.map(clock.shortLabel) ?? "—" }
    var selectedTimeLabel: String { selectedDate.map(clock.shortLabel) ?? (refreshing ? "Loading…" : "Unavailable") }
    var selectedSourceLabel: String {
        product == .radar ? "Observed radar" : product == .rainAmount ? "Six-hour total" : transitionApplied ? "Radar-guided forecast" : "Model forecast"
    }
    var selectedDetailLabel: String {
        guard let selectedDate else { return selectedInstant == nil ? "No usable source time" : "Selected source time unavailable" }
        return clock.detailLabel(for: selectedDate)
    }
    var timelineMessage: String {
        if let playbackMessage { return playbackMessage }
        if usesGlobalRadar, let selectedDate {
            return "RainViewer · observed \(max(0, Int(evaluationTime.timeIntervalSince(selectedDate) / 60))) min ago"
        }
        if !isCONUSPlace && product != .radar { return "This forecast layer covers the continental US. Choose radar or satellite for coverage at this place." }
        if product == .forecast {
            if let imageMessage { return imageMessage }
            if displayedProduct == .forecast, let coverageMessage { return coverageMessage }
            if !usableSubhourly.isEmpty { return transitionApplied ? "MRMS motion + 15-minute HRRR guidance · forecast, not live radar" : "NOAA HRRR · actual 15-minute forecast frames" }
            if forecastFailed { return "Forecast refresh unavailable. Any retained times keep their original model run." }
            guard let forecastRun else { return "NOAA HRRR model guidance · US coverage" }
            if transitionApplied { return "MRMS motion + HRRR · forecast, not live radar" }
            return "HRRR model · run \(clock.shortLabel(for: forecastRun.run.cycleTime)) · not live radar"
        }
        if usesNumericRadar, let imageMessage { return imageMessage }
        if usesNumericRadar, displayedProduct == .radar, let coverageMessage { return coverageMessage }
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
        if mapFailure { return "The map could not render. Retry the native map or choose another layer." }
        if basemapStyle == .satellite { return satellite == nil ? satelliteMessage : nil }
        if base == nil { return basemapStatus + " Weather imagery alone is not a complete map." }
        if product == .forecast || usesNumericRadar {
            if let imageMessage { return imageMessage }
            if loadingImage && image == nil { return "Loading weather for this view…" }
            if loadingImage, let image, let viewport,
               !NativeRadarFrameCacheViewport(west: image.west, south: image.south,
                   east: image.east, north: image.north).contains(.init(west: viewport.west,
                       south: viewport.south, east: viewport.east, north: viewport.north)) {
                return "Loading weather beyond the previous view… Blank edges are not yet loaded."
            }
            if let coverageMessage { return coverageMessage }
        } else {
            if wmsFrame == nil && globalTiles == nil { return "Weather imagery is unavailable. This does not mean clear skies." }
            return "Loading or missing weather tiles do not mean clear skies."
        }
        return nil
    }

    /// A visible map problem needs a real native recovery path.  Keep this
    /// separate from ordinary loading, coverage, and freshness messages: those
    /// are useful context, but they are not evidence that the native surface
    /// itself failed.
    var needsMapRecovery: Bool {
        if mapFailure { return true }
        if basemapStyle == .satellite {
            return satellite == nil && !loadingSatellite && satelliteMessage.hasPrefix("No verified")
        }
        if base == nil && !basemapStatus.hasPrefix("Loading") { return true }
        if product == .radar, rawDiscoveryFinished, !usesNumericRadar, wmsFrame == nil, globalTiles == nil { return true }
        guard let imageMessage else { return false }
        let recoverableMarkers = [
            "could not load",
            "imagery unavailable",
            "unavailable for this view",
            "no longer available"
        ]
        return recoverableMarkers.contains { imageMessage.localizedCaseInsensitiveContains($0) }
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
            basemapStatus = "Native map storage could not be prepared. Retry to restore the native map."
            return
        }
        rendererReady = true
        async let maps: Void = loadBasemap()
        async let weather: Void = refresh()
        _ = await (maps, weather)
    }

    private func loadBasemap() async {
        // Keep the preview and full map in the same app credential/cache lane.
        let availability = await NativeBasemapClient(endpoint: NativeBasemapClient.endpoint(
            for: Bundle.main.bundleIdentifier ?? NativeBasemapContract.iosAudience)).load()
        guard active, !suspended, !Task.isCancelled else { return }
        switch availability {
        case let .ready(catalog):
            NativeBasemapNetwork.activate(catalog)
            basemapCatalog = catalog
            selectBasemap(basemapStyle, pausePlayback: false)
        case .unavailable:
            basemapCatalog = nil
            base = nil; labels = nil
            basemapStatus = "Street map unavailable. Try another layer or retry the native map."
        }
        basemapRevision += 1
    }

    var canUseAerial: Bool { basemapCatalog != nil && NativeBasemapCatalog.supportsAerial(latitude: place.latitude, longitude: place.longitude) }
    func selectBasemap(_ style: NativeRadarBasemap, pausePlayback: Bool = true) {
        guard style != .aerial || canUseAerial else { return }
        if pausePlayback { pause() }
        satelliteTask?.cancel(); satelliteTask = nil; satelliteGeneration += 1
        basemapStyle = style
        if style == .satellite {
            prefetchTask?.cancel()
            imageTask?.cancel(); imageTask = nil; imageGeneration += 1
            image = nil; imageRequestID = nil; loadingImage = false
            displayedCoverage = nil; coverageMessage = nil; imageUnavailableAtPlace = false
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
            basemapStatus = "Street map unavailable. Try another layer or retry the native map."
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

    func refresh(forceObserved: Bool = false) async {
        guard !refreshing else { return }
        refreshGeneration += 1
        let generation = refreshGeneration
        refreshing = true
        lastMetadataAttempt = Date()
        mapFailure = false
        weatherRevision += 1
        async let sourceTimes: Void = refreshWMS()
        async let modelTimes: Void = refreshForecast()
        async let subhourlyTimes: Void = refreshSubhourly()
        async let radarTimes: Void = refreshObserved(force: forceObserved)
        async let alerts: Void = refreshAlerts()
        _ = await (sourceTimes, modelTimes, subhourlyTimes, radarTimes, alerts)
        scheduleViewportAlerts(force: true)
        if refreshGeneration == generation {
            refreshing = false
            if !loadingImage && !currentImageReadyForPlayback { loadSelectedImage() }
            if image != nil && !loadingImage { warmNearbyFrames() }
        }
    }

    func requestRefresh() {
        guard active, !refreshing, manualRefreshTask == nil else { return }
        manualRefreshGeneration += 1
        let generation = manualRefreshGeneration
        manualRefreshTask = Task { [weak self] in
            guard let self else { return }
            await self.refresh(forceObserved: true)
            if self.base == nil, !Task.isCancelled { await self.loadBasemap() }
            if self.manualRefreshGeneration == generation { self.manualRefreshTask = nil }
        }
    }

    /// Retry the native renderer, basemap catalog and weather metadata as one
    /// bounded local action.  This deliberately does not hand a native-only
    /// user to a compatibility browser surface when a provider fails.
    func retryMap() {
        guard active, !refreshing else { return }
        mapFailure = false
        let task = Task { [weak self] in
            guard let self, self.active, !Task.isCancelled else { return }
            if !self.rendererReady {
                await self.prepareAndLoad()
            } else {
                await self.loadBasemap()
                await self.refresh()
            }
        }
        startupTask = task
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
            Self.frameStore.forecastMetadata = (forecastResult, Date())
            forecastFailed = false
        } else { forecastFailed = true }
        if product == .forecast { reconcileCurrentSelection() }
    }
    private func refreshSubhourly() async {
        guard isCONUSPlace, let subhourlyClient else { return }
        do {
            let frames = try await subhourlyClient.discover(now: Date())
            guard active, !suspended, !Task.isCancelled else { return }
            if subhourlyFrames != frames {
                preparedHandoff = nil
            }
            // Exact source/run/time keys naturally retire changed records. Keep
            // overlapping verified frames when the rolling window adds a tail.
            subhourlyFrames = frames
            Self.frameStore.subhourlyMetadata = (frames, Date())
            if product == .forecast { reconcileCurrentSelection() }
        } catch { /* Keep advertised, still-fresh data; otherwise hourly fallback. */ }
    }

    private func refreshObserved(force: Bool = false) async {
        let generation = refreshGeneration
        let rawResult = await fetchObserved(force: force)
        guard active, !suspended, !Task.isCancelled, refreshGeneration == generation else { return }
        if let rawResult {
            observedHistory = Array(rawResult.suffix(24))
            let dates = rawResult.map { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) }
            let kept = (try? NativeRadarPresentationContract.boundedDates(dates,
                retaining: product == .radar ? selectedInstant : nil, limit: 6)) ?? []
            let included = Set(kept)
            observedFrames = rawResult.filter { included.contains(Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000)) }
            observedFailed = false
        }
        else { observedFailed = true }
        rawDiscoveryFinished = true
        // Publish useful US radar immediately. A secondary provider must not
        // delay first paint or consume another request when MRMS is healthy.
        if product == .radar || product == .forecast { reconcileCurrentSelection() }
        guard !rawIsUsable else { return }
        let globalResult = await globalClient.load()
        guard active, !suspended, !Task.isCancelled, refreshGeneration == generation else { return }
        if case let .ready(snapshot) = globalResult { globalRadar = snapshot }
        if product == .radar || product == .forecast { reconcileCurrentSelection() }
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
    func alert(_ id: String) -> NativeRadarAlertsContract.Alert? {
        alertSnapshot?.alert(idOrKey: id) ?? viewportAlerts?.snapshot.alert(idOrKey: id)
    }
    func bulletinStatus(_ alert: NativeRadarAlertsContract.Alert) -> String {
        let candidates = [(alertSnapshot, alertRefreshFailed), (viewportAlerts?.snapshot, viewportAlertsFailed)]
        let snapshot = candidates.compactMap { snapshot, failed -> NativeRadarAlertsContract.Snapshot? in
            guard let snapshot, !failed, snapshot.alert(idOrKey: alert.id) != nil,
                  snapshot.isFresh(at: evaluationTime) else { return nil }
            return snapshot
        }.max { ($0.checkedAt ?? .distantPast) < ($1.checkedAt ?? .distantPast) }
        guard let snapshot, alert.isActive(at: evaluationTime) else {
            return "Last-known bulletin · refresh to check its current status"
        }
        return "Current NWS bulletin · checked \(snapshot.checkedAt.map(detailTime) ?? "recently")"
    }
    var visibleAreaAlerts: [NativeRadarAlertsContract.Alert] {
        viewportAlerts?.snapshot.alerts.filter { $0.isActive(at: evaluationTime) } ?? []
    }
    var viewportAlertStatus: String {
        if checkingViewportAlerts { return "Checking this map area…" }
        guard let result = viewportAlerts else { return viewportAlertsFailed ? "Area alert check unavailable" : "Area alerts not checked yet" }
        if result.completeness == .unsupported { return "NWS area alerts unavailable in this region" }
        if viewportAlertsFailed || !result.snapshot.isFresh(at: evaluationTime) { return "Area alert check is out of date" }
        if result.completeness == .partial { return "Some alert outlines may be missing" }
        return visibleAreaAlerts.isEmpty ? "No active NWS alert polygons in this view" : "\(visibleAreaAlerts.count) active NWS alert outlines in this view"
    }
    private func updateAlertGeometry() {
        // Keep place bulletins independent from viewport polygons. Never retain
        // outlines from a previous viewport or an expired/incomplete refresh.
        let placeData = alertRefreshFailed ? nil : try? alertSnapshot?.featureCollection(at: evaluationTime)
        let areaData = viewportAlertsFailed ? nil : try? viewportAlerts?.snapshot.featureCollection(at: evaluationTime)
        var features: [[String: Any]] = [], identifiers = Set<String>()
        for data in [placeData, areaData].compactMap({ $0 }) {
            guard let collection = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let items = collection["features"] as? [[String: Any]] else { continue }
            for item in items {
                guard let props = item["properties"] as? [String: Any], let id = props["alertID"] as? String,
                      identifiers.insert(id).inserted else { continue }
                features.append(item)
            }
        }
        alertGeometry = features.isEmpty ? nil : try? JSONSerialization.data(withJSONObject: ["type": "FeatureCollection", "features": features])
    }
    private func scheduleViewportAlerts(force: Bool = false) {
        viewportAlertTask?.cancel(); viewportAlertGeneration += 1
        checkingViewportAlerts = false
        guard active, !suspended, let viewport,
              let scope = try? NativeRadarAlertsContract.Viewport(west: viewport.west, south: viewport.south,
                  east: viewport.east, north: viewport.north) else { return }
        let generation = viewportAlertGeneration
        let previous = viewportAlertTask
        checkingViewportAlerts = true
        viewportAlertTask = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            do {
                try await Task.sleep(for: .milliseconds(600))
                let result = try await self.viewportAlertsClient.loadViewport(viewport: scope,
                    selectedPlace: try? .init(latitude: self.place.latitude, longitude: self.place.longitude),
                    countryCode: nil, forceRefresh: force)
                guard self.active, !self.suspended, !Task.isCancelled, self.viewportAlertGeneration == generation else { return }
                self.viewportAlerts = result; self.viewportAlertsFailed = false
            } catch {
                guard self.active, !Task.isCancelled, self.viewportAlertGeneration == generation else { return }
                self.viewportAlertsFailed = true
            }
            self.checkingViewportAlerts = false
            self.updateAlertGeometry()
        }
    }
    private func refreshAlerts() async {
        guard let scope = try? NativeRadarAlertsContract.Scope.point(latitude: place.latitude,
            longitude: place.longitude, countryCode: place.countryCode) else { return }
        do {
            let snapshot = try await alertsClient.load(scope: scope)
            guard active, !suspended, !Task.isCancelled else { return }
            alertSnapshot = snapshot; alertRefreshFailed = false
            updateAlertGeometry()
        } catch {
            guard active, !suspended, !Task.isCancelled else { return }
            alertRefreshFailed = true
            updateAlertGeometry()
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

    private func fetchObserved(force: Bool = false) async -> [MRMSContract.AdvertisedFrame]? {
        guard isCONUSPlace else { return nil }
        return try? await observedRepository.recentFrames(force: force)
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

    func updateViewport(_ bounds: NativeRadarViewport, moving: Bool = false) {
        guard bounds != viewport else {
            // Map delegates can finish a gesture at the same bounds as its
            // last moving callback. Still run the settled alert check.
            if !moving { scheduleViewportAlerts() }
            return
        }
        viewport = bounds
        // A pan within the cached envelope still changes which missing pixels
        // are actually on screen, even when no new render is necessary.
        refreshCoverageMessage()
        viewportAlertTask?.cancel(); viewportAlertGeneration += 1
        checkingViewportAlerts = false
        viewportAlerts = nil; viewportAlertsFailed = false
        updateAlertGeometry()
        // Local alert geometry can update immediately. Remote alert discovery
        // waits for the final camera position rather than following every pan.
        if !moving { scheduleViewportAlerts() }
        let next = observedRepository.coverageEnvelope(for: bounds)
        guard next != coverageEnvelope else { return }
        coverageEnvelope = next
        preparedHandoff = nil
        // The cache contains multiple keyed areas. Camera movement is not an
        // invalidation event; exact source/coverage/style keys govern reuse.
        // Keep the numeric HRRR field; its cycle/bounds/index checks below can
        // reuse it after a contained pan or a render-quality-only zoom change.
        // Begin new coverage during the gesture, even when an older area is
        // still loading. Shared producers keep this bounded and preserve useful
        // old-area work; its network delay must not block the current camera.
        loadSelectedImage(debounce: false)
    }
    var renderingZoom: Double { coverageViewport?.zoom ?? viewport?.zoom ?? 6.8 }

    private func loadSelectedImage(debounce: Bool = false) {
        guard active, !suspended, basemapStyle != .satellite else { return }
        if selectedDate == nil {
            prefetchTask?.cancel()
            imageTask?.cancel(); imageTask = nil; imageGeneration += 1
            image = nil; imageRequestID = nil; loadingImage = false
            displayedCoverage = nil; coverageMessage = nil; imageUnavailableAtPlace = false
            transitionApplied = false
            transitionExplanation = "No forecast is displayed for this source time."
            imageMessage = refreshing ? "Loading available source times…" : "Selected time is no longer available. Tap Latest or choose another time."
            return
        }
        let iso: (Date) -> String = { RadarNumericContract.isoTime(Int64($0.timeIntervalSince1970 * 1000)) }
        let identities = observedHistory.suffix(8).compactMap { frame in
            try? NativeRadarTransitionPolicy.ObservationIdentity(sourceID: "\(frame.key)|\(frame.byteLength)",
                validTime: RadarNumericContract.isoTime(frame.validTimeMilliseconds))
        }
        let transitionIdentity = try? NativeRadarTransitionPolicy.requestIdentity(observed: identities,
            modelCycleTime: forecastRun.map { iso($0.run.cycleTime) },
            modelAnchorValidTime: forecastSteps.first.map { iso($0.validTime) },
            targetValidTime: selectedDate.map(iso), requestedAt: iso(Date()))
        let observedIdentity = usesNumericRadar && observedFrames.indices.contains(selectedIndex)
            ? observedCacheKey(observedFrames[selectedIndex]) : ""
        let selectedSubhourly = usableSubhourly.first { $0.validTime == selectedInstant }
        let finishedForecastKey = selectedSubhourly.flatMap { frame in coverageViewport.map { subhourlyRenderKey(frame, bounds: $0) } }
        let requestID = finishedForecastKey ?? "\(product.rawValue)|\(usesNumericRadar)|\(usesGlobalRadar)|\(observedIdentity)|\(selectedInstant?.timeIntervalSince1970 ?? -1)|\(String(describing: coverageViewport))|\(product == .forecast ? transitionIdentity?.cacheKey ?? "unavailable" : "")|\(usableSubhourly.first?.cycle.timeIntervalSince1970 ?? -1)|\(enhancementEnabled)"
        if shouldReuseImageRequest(requestID) { return }
        imageRequestID = requestID
        selectionStartedAt = ProcessInfo.processInfo.systemUptime
        imageGeneration += 1
        let generation = imageGeneration
        let previousImage = imageTask
        previousImage?.cancel(); prefetchTask?.cancel()
        // Cancel only the old UI subscription. Shared frame work continues and
        // the next foreground request joins/promotes it rather than restarting.
        // Only the hourly fallback's single-reader transport needs a legacy
        // barrier. Never await an unrelated shared-render UI subscription.
        let previous: Task<Void, Never>? = hourlyImageTask
        // Hold the last complete image while loading, with its own timestamp.
        // Tile products cannot use a retained numeric image as an overlay.
        if !usesNumericRadar && product != .forecast {
            image = nil; displayedCoverage = nil; coverageMessage = nil
        }
        imageMessage = nil
        imageUnavailableAtPlace = false
        transitionApplied = false
        transitionExplanation = "Forecast uses the original HRRR model guidance."
        loadingImage = false
        if usesNumericRadar {
            loadObservedImage(previous: previous, generation: generation, debounce: debounce)
            return
        }
        guard product == .forecast else { return }
        if let selected = usableSubhourly.first(where: { $0.validTime == selectedInstant }) {
            loadSubhourlyImage(selected, previous: previous, generation: generation, debounce: debounce)
            return
        }
        guard let run = forecastRun, let viewport = coverageViewport, viewport.isUsable,
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
        let anchorStep = available.first
        let observedCandidates = enhancementEnabled ? transitionCandidates(anchorStep: anchorStep, targetStep: step, run: run) : []
        let forecastKey = forecastCacheKey(source: "hrrr-zarr-v2|\(run.run.productRoot.absoluteString)|\(step.sourceIndex)|\(String(describing: run.run.reflectivity))",
            cycle: run.run.cycleTime, anchor: anchorStep?.validTime, target: step.validTime,
            bounds: viewport, candidates: observedCandidates)
        if let cached = Self.frameStore.forecast.value(for: forecastKey) {
            recordFrameHit(true); publishForecast(cached, bounds: viewport); return
        }
        recordFrameHit(false)
        let storeGeneration = Self.frameStore.generation
        var indexes = Array(available.dropFirst((selectedIndex / 8) * 8).prefix(8).map(\.sourceIndex))
        if !observedCandidates.isEmpty, let anchorStep, !indexes.contains(anchorStep.sourceIndex) {
            indexes = [anchorStep.sourceIndex] + Array(indexes.prefix(7))
        }
        loadingImage = true
        imageTask = Task { [weak self] in
            await previous?.value
            guard let self, !Task.isCancelled else { return }
            do {
                if debounce { try await Task.sleep(for: .milliseconds(350)) }
                let field: HRRRZarrClient.Field
                let requestedBounds = RadarChunkContract.Bounds(minLat: viewport.south, minLon: viewport.west,
                    maxLat: viewport.north, maxLon: viewport.east)
                if let cachedBounds = self.forecastFieldBounds, let cached = self.forecastField,
                   NativeRadarTransitionPolicy.canReuseField(cachedCycleTime: iso(cached.loaded.run.cycleTime),
                    requestedCycleTime: iso(run.run.cycleTime),
                    cachedBounds: .init(minLat: cachedBounds.south, minLon: cachedBounds.west, maxLat: cachedBounds.north, maxLon: cachedBounds.east),
                    requestedBounds: requestedBounds, cachedSourceIndexes: cached.steps.map(\.sourceIndex),
                    requiredSourceIndexes: indexes) { field = cached }
                else {
                    field = try await forecastClient.load(run: run,
                        bounds: .init(west: viewport.west, south: viewport.south, east: viewport.east, north: viewport.north),
                        sourceIndexes: indexes, maximumChunks: 8)
                }
                try Task.checkCancellation()
                // Choose the final frame before publishing so optional alignment
                // does not visibly shift an already-displayed forecast twice.
                let baselineTask = Task.detached(priority: .userInitiated) {
                    let original = try NativeRadarModel.renderFrame(field: field, step: step, bounds: viewport)
                    let rgba = Data(try RadarNumericContract.highDetailRGBA(original.texture, encoding: original.encoding, validDataMask: original.validDataMask, zoom: viewport.zoom))
                    let rendered = try NativeRadarModel.makeImage(rgba: rgba, width: original.texture.width, height: original.texture.height)
                    try Task.checkCancellation()
                    return (original, NativeRadarImage(id: forecastKey,
                        image: rendered, west: viewport.west, south: viewport.south, east: viewport.east, north: viewport.north))
                }
                let (original, baseline) = try await withTaskCancellationHandler(operation: {
                    try await baselineTask.value
                }, onCancel: { baselineTask.cancel() })
                try Task.checkCancellation()
                guard self.active, !self.suspended, self.imageGeneration == generation else { return }
                self.forecastField = field; self.forecastFieldBounds = viewport
                guard !observedCandidates.isEmpty else {
                    self.publishForecast(baseline, numeric: original, bounds: viewport,
                        cacheKey: forecastKey, storeGeneration: storeGeneration)
                    return
                }
                // Auxiliary motion evidence is bounded and optional. Failure to
                // obtain it must never hide otherwise usable model guidance.
                let observations = (try? await self.loadTransitionObservations(observedCandidates,
                    bounds: viewport, generation: generation)) ?? []
                try Task.checkCancellation()
                guard observations.count >= 3 else {
                    self.publishForecast(baseline, numeric: original, bounds: viewport,
                        cacheKey: forecastKey, storeGeneration: storeGeneration)
                    return
                }
                let requestedAt = Date()
                let prepared = self.preparedHandoff
                let renderTask = Task.detached(priority: .userInitiated) {
                    var output = original
                    var enhanced = false
                    var nextPrepared: NativeRadarTransition.Prepared?
                    var explanation = "Original HRRR model. Radar alignment was not supported by fresh, consistent motion evidence for this view and time."
                    if observations.count >= 3, let anchorStep {
                        do {
                            let anchor = anchorStep == step ? original : try NativeRadarModel.renderFrame(field: field, step: anchorStep, bounds: viewport)
                            let transition = try NativeRadarTransition.compose(observed: observations,
                                forecastAnchor: anchor, forecastTarget: original,
                                cycleTime: RadarNumericContract.isoTime(Int64(run.run.cycleTime.timeIntervalSince1970 * 1000)),
                                requestedAt: RadarNumericContract.isoTime(Int64(requestedAt.timeIntervalSince1970 * 1000)), prepared: prepared)
                            if case let .ready(result) = transition {
                                output = result.frame
                                enhanced = result.evidence.modelAligned || result.evidence.forecastWeight < 1
                                nextPrepared = result.prepared
                                explanation = result.evidence.modelAligned
                                    ? "This forecast uses recent observed radar motion and aligned HRRR guidance at the exact model time. It is a prediction, not a radar observation. Original model guidance fills the edges of the motion estimate."
                                    : "Recent radar motion bridges into the original HRRR forecast. Model alignment was unavailable. Predictions fade to unmodified guidance, which also fills the edges of the motion estimate."
                            }
                        } catch is CancellationError {
                            throw CancellationError()
                        } catch {
                            // Optional alignment cannot erase a valid forecast.
                            explanation = "Original HRRR model. Radar alignment was unavailable."
                        }
                    }
                    try Task.checkCancellation()
                    let rgba = Data(try RadarNumericContract.highDetailRGBA(output.texture, encoding: output.encoding, validDataMask: output.validDataMask, zoom: viewport.zoom))
                    let rendered = try NativeRadarModel.makeImage(rgba: rgba, width: output.texture.width, height: output.texture.height)
                    let id = forecastKey
                    return (image: NativeRadarImage(id: id, image: rendered, west: viewport.west, south: viewport.south,
                        east: viewport.east, north: viewport.north), numeric: output, enhanced: enhanced, explanation: explanation, prepared: nextPrepared)
                }
                let result = try await withTaskCancellationHandler(operation: {
                    try Task.checkCancellation()
                    return try await renderTask.value
                }, onCancel: { renderTask.cancel() })
                try Task.checkCancellation()
                guard self.active, self.imageGeneration == generation else { return }
                guard self.coverageViewport == viewport else {
                    self.completeImageRequest()
                    return
                }
                self.transitionApplied = result.enhanced
                if let prepared = result.prepared { self.preparedHandoff = prepared }
                self.transitionExplanation = result.explanation
                self.publishForecast(result.image, numeric: result.numeric, bounds: viewport,
                    cacheKey: forecastKey, storeGeneration: storeGeneration)
            } catch {
                guard !Task.isCancelled, self.active, self.imageGeneration == generation else { return }
                if self.coverageViewport != viewport {
                    self.completeImageRequest()
                    return
                }
                self.completeImageRequest()
                if self.displayedImageRequestID != self.imageRequestID {
                    self.imageMessage = "Forecast imagery could not load for this view. Try zooming in or refreshing."
                } else {
                    self.transitionExplanation = "Original HRRR model. Optional radar alignment was unavailable."
                }
            }
        }
        hourlyImageTask = imageTask
    }

    /// Selection changes cancel UI subscriptions, not useful producers. A
    /// selected prefetched frame joins the same Task. Only unrelated work may
    /// be cancelled to admit foreground work; at most two producers are live.
    private func acquireFrameWork(key: String, foreground: Bool,
                                  operation: @escaping @MainActor () async throws -> FrameWorkResult) async throws -> FrameWorkResult {
        try Task.checkCancellation()
        if var existing = frameWork[key] {
            if existing.task.isCancelled {
                _ = try? await existing.task.value
                try Task.checkCancellation()
                return try await acquireFrameWork(key: key, foreground: foreground, operation: operation)
            }
            if foreground { existing.foreground = true; frameWork[key] = existing }
            performanceJoins += 1
            performanceLog.debug("frame_work joined=\(self.performanceJoins, privacy: .public) foreground=\(foreground, privacy: .public)")
            let result = try await existing.task.value
            try Task.checkCancellation()
            return result
        }
        while frameWork.count >= 2 {
            guard foreground else { throw CancellationError() }
            let victim = frameWork.first { !$0.value.foreground } ?? frameWork.first!
            victim.value.task.cancel()
            _ = try? await victim.value.task.value
            try Task.checkCancellation()
            if let existing = frameWork[key] { return try await existing.task.value }
        }
        guard active, !suspended else { throw CancellationError() }
        let token = UUID()
        let task = Task(priority: foreground ? .userInitiated : .utility) { [weak self] in
            guard let self else { throw CancellationError() }
            defer { if self.frameWork[key]?.token == token { self.frameWork.removeValue(forKey: key) } }
            return try await operation()
        }
        frameWork[key] = .init(token: token, task: task, foreground: foreground)
        let result = try await task.value
        try Task.checkCancellation()
        return result
    }

    private func forecastFrame(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarViewport,
                               foreground: Bool) async throws -> CachedForecastFrame {
        // Capture target, exact anchor record and evidence together, before any
        // actor await can observe a metadata revision between those identities.
        let inputs = subhourlyInputs(frame, bounds: bounds)
        let key = inputs.key, anchor = inputs.anchor, candidates = inputs.candidates
        if let cached = Self.frameStore.forecast.value(for: key) { return cached }
        guard let client = subhourlyClient else { throw CancellationError() }
        if foreground, var existing = frameWork[key] {
            // Mark queued render work before awaiting actor promotion, so a
            // producer that starts during that await uses foreground priority.
            existing.foreground = true; frameWork[key] = existing
            await client.promote(frame, bounds: try .init(west: bounds.west, south: bounds.south,
                east: bounds.east, north: bounds.north), width: NativeRadarCoveragePolicy.pixelWidth,
                height: NativeRadarCoveragePolicy.pixelHeight)
        }
        let storeGeneration = Self.frameStore.generation
        let result = try await acquireFrameWork(key: key, foreground: foreground) { [self] in
            // The source client checks its exact numeric cache before I/O;
            // anchor lookups use that same cache even when alignment fails.
            let priority: HRRRSubhourlyCache.Priority = (frameWork[key]?.foreground ?? foreground) ? .foreground : .prefetch
            let sourceStart = ProcessInfo.processInfo.systemUptime
            let original = try await client.load(frame, bounds: .init(west: bounds.west, south: bounds.south,
                east: bounds.east, north: bounds.north), width: NativeRadarCoveragePolicy.pixelWidth,
                height: NativeRadarCoveragePolicy.pixelHeight, priority: priority)
            lastSourceMilliseconds = (ProcessInfo.processInfo.systemUptime - sourceStart) * 1000
            try Task.checkCancellation()
            var observations: [NativeRadarSeamEstimation.Frame] = []
            var anchorField: NativeRadarSeamEstimation.Frame?
            if !candidates.isEmpty, let anchor {
                observations = (try? await loadTransitionObservations(candidates, bounds: bounds)) ?? []
                if observations.count >= 3 {
                    if anchor == frame { anchorField = original }
                    else { anchorField = try? await client.load(anchor, bounds: .init(west: bounds.west,
                        south: bounds.south, east: bounds.east, north: bounds.north),
                        width: NativeRadarCoveragePolicy.pixelWidth, height: NativeRadarCoveragePolicy.pixelHeight,
                        priority: priority) }
                }
            }
            try Task.checkCancellation()
            let evidence = observations, modelAnchor = anchorField, requestedAt = Date()
            let prepared = preparedHandoff
            let renderStart = ProcessInfo.processInfo.systemUptime
            let render = Task.detached(priority: foreground ? .userInitiated : .utility) {
                var output = original, enhanced = false
                var nextPrepared: NativeRadarTransition.Prepared?
                if let modelAnchor, evidence.count >= 3,
                   let transition = try? NativeRadarTransition.compose(observed: evidence, forecastAnchor: modelAnchor,
                    forecastTarget: original, cycleTime: RadarNumericContract.isoTime(Int64(frame.cycle.timeIntervalSince1970 * 1000)),
                    requestedAt: RadarNumericContract.isoTime(Int64(requestedAt.timeIntervalSince1970 * 1000)), prepared: prepared),
                   case let .ready(result) = transition {
                    output = result.frame; enhanced = result.evidence.modelAligned || result.evidence.forecastWeight < 1
                    nextPrepared = result.prepared
                }
                try Task.checkCancellation()
                let rgba = Data(try RadarNumericContract.highDetailRGBA(output.texture, encoding: output.encoding,
                    validDataMask: output.validDataMask, zoom: bounds.zoom))
                let rendered = try Self.makeImage(rgba: rgba, width: output.texture.width, height: output.texture.height)
                return (NativeRadarImage(id: key, image: rendered, west: bounds.west, south: bounds.south,
                    east: bounds.east, north: bounds.north), output, enhanced, nextPrepared)
            }
            let (image, numeric, enhanced, nextPrepared) = try await withTaskCancellationHandler(
                operation: { try await render.value }, onCancel: { render.cancel() })
            try Task.checkCancellation()
            lastRenderMilliseconds = (ProcessInfo.processInfo.systemUptime - renderStart) * 1000
            performanceRenders += 1
            performanceLog.info("forecast_render source_ms=\(self.lastSourceMilliseconds, privacy: .public) render_ms=\(self.lastRenderMilliseconds, privacy: .public)")
            let explanation = enhanced
                ? nextPrepared?.correction == nil
                    ? "Recent radar motion bridges into the original HRRR forecast. Model alignment was unavailable; this is a prediction, not an observation. Original model guidance fills the edges of the motion estimate."
                    : "15-minute HRRR forecast aligned with recent radar motion. This is a prediction, not an observation. Original model guidance fills the edges of the motion estimate."
                : "Original HRRR forecast at genuine 15-minute model intervals."
            let value = CachedForecastFrame(image: image, numeric: numeric, enhanced: enhanced, explanation: explanation)
            if Self.frameStore.generation == storeGeneration, subhourlyFrames.contains(frame) {
                Self.frameStore.forecast.insert(value, for: key, cost: value.cost)
            }
            if Self.frameStore.generation == storeGeneration, coverageViewport == bounds,
               subhourlyRenderKey(frame, bounds: bounds) == key, let nextPrepared { preparedHandoff = nextPrepared }
            return .forecast(value)
        }
        guard case let .forecast(value) = result else { throw CancellationError() }
        return value
    }

    private func loadSubhourlyImage(_ frame: HRRRSubhourly.Frame, previous: Task<Void, Never>?,
                                   generation: Int, debounce: Bool) {
        guard let bounds = coverageViewport, bounds.isUsable,
              bounds.east - bounds.west <= 14, bounds.north - bounds.south <= 14 else {
            imageMessage = "Zoom in to load local forecast detail."; return
        }
        let key = subhourlyRenderKey(frame, bounds: bounds)
        if let cached = Self.frameStore.forecast.value(for: key) {
            recordFrameHit(true); publishForecast(cached, bounds: bounds); return
        }
        recordFrameHit(false); loadingImage = true
        imageTask = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await self.forecastFrame(frame, bounds: bounds, foreground: true)
                try Task.checkCancellation()
                guard self.active, !self.suspended, self.imageGeneration == generation else { return }
                guard self.coverageViewport == bounds else { self.completeImageRequest(); return }
                guard self.subhourlyRenderKey(frame, bounds: bounds) == key else {
                    self.imageRequestID = nil; self.completeImageRequest(); self.loadSelectedImage(); return
                }
                self.publishForecast(result, bounds: bounds)
            } catch {
                guard !Task.isCancelled, self.active, self.imageGeneration == generation else { return }
                self.completeImageRequest()
                if self.coverageViewport == bounds {
                    self.imageMessage = "This forecast frame could not load. Showing the last available image; try another time or refresh."
                }
            }
        }
    }

    private func publishForecast(_ cached: CachedForecastFrame, bounds: NativeRadarViewport) {
        guard coverageViewport == bounds else { completeImageRequest(); return }
        image = cached.image; displayedInstant = cached.validTime; displayedProduct = .forecast
        displayedEnhanced = cached.enhanced; transitionApplied = cached.enhanced
        transitionExplanation = cached.explanation
        displayedCoverage = .init(width: cached.width, height: cached.height, bounds: bounds, bits: cached.coverageBits,
            fullyCovered: cached.coveredPixels == cached.width * cached.height)
        imageMessage = nil
        refreshCoverageMessage()
        recordPublish(); completeImageRequest(); warmNearbyFrames()
    }

    private func publishForecast(_ rendered: NativeRadarImage, numeric: NativeRadarSeamEstimation.Frame,
                                 bounds: NativeRadarViewport, cacheKey: String, storeGeneration: Int) {
        guard coverageViewport == bounds else {
            completeImageRequest()
            return
        }
        let cached = CachedForecastFrame(image: rendered, numeric: numeric, enhanced: transitionApplied,
            explanation: transitionExplanation)
        if Self.frameStore.generation == storeGeneration {
            Self.frameStore.forecast.insert(cached, for: cacheKey, cost: cached.cost)
        }
        publishForecast(cached, bounds: bounds)
    }

    /// Publication guards keep results at their true geographic corners. New
    /// camera requests are already admitted independently by the shared pool.
    private func completeImageRequest() {
        loadingImage = false
    }

    private func observedFrame(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport,
                               foreground: Bool) async throws -> NativeRadarObservedRepository.RenderedFrame {
        let key = observedCacheKey(frame, bounds: bounds)
        if let cached = observedRepository.cachedFrame(frame, bounds: bounds) { return cached }
        if foreground { observedRepository.promote(frame, bounds: bounds) }
        let result = try await acquireFrameWork(key: key, foreground: foreground) { [self] in
            // The model pool retains its bounded observed/forecast scheduling,
            // while the repository owns actual observed producers and leases
            // shared with Today. Leaving either surface does not cancel the
            // other surface's in-flight render.
            let value = try await observedRepository.frame(frame, bounds: bounds,
                foreground: frameWork[key]?.foreground ?? foreground)
            try Task.checkCancellation()
            lastSourceMilliseconds = value.sourceMilliseconds
            lastRenderMilliseconds = value.renderMilliseconds
            performanceRenders += 1
            return .observed(value)
        }
        guard case let .observed(value) = result else { throw CancellationError() }
        return value
    }

    private func publishObserved(_ value: NativeRadarObservedRepository.RenderedFrame, bounds: NativeRadarViewport) {
        guard coverageViewport == bounds else { completeImageRequest(); return }
        image = value.image
        displayedInstant = Date(timeIntervalSince1970: Double(value.numeric.validTimeMilliseconds) / 1000)
        displayedProduct = .radar; displayedEnhanced = false
        var bits = [UInt8](repeating: 0, count: (value.numeric.validDataMask.count + 7) / 8)
        var coveredPixels = 0
        for index in value.numeric.validDataMask.indices where value.numeric.validDataMask[index] != 0 {
            bits[index / 8] |= UInt8(1 << (index % 8))
            coveredPixels += 1
        }
        displayedCoverage = .init(width: value.numeric.texture.width, height: value.numeric.texture.height,
            bounds: bounds, bits: bits, fullyCovered: coveredPixels == value.numeric.validDataMask.count)
        imageMessage = nil
        refreshCoverageMessage()
        recordPublish(); completeImageRequest(); warmNearbyFrames()
    }

    /// Notices follow the actual displayed image and visible map, never the
    /// larger prefetched envelope or transparent-but-valid clear weather.
    private func refreshCoverageMessage() {
        guard image != nil, let displayedCoverage, let viewport else {
            coverageMessage = nil; imageUnavailableAtPlace = false
            return
        }
        let index = Self.placePixelIndex(width: displayedCoverage.width, height: displayedCoverage.height,
            bounds: displayedCoverage.bounds, latitude: place.latitude, longitude: place.longitude)
        imageUnavailableAtPlace = index.map { !displayedCoverage.covers($0) } == true
        let forecast = displayedProduct == .forecast
        if imageUnavailableAtPlace {
            coverageMessage = forecast ? "Forecast coverage is missing at this place." : "Radar coverage is missing at this place."
            return
        }
        let bounds = displayedCoverage.bounds
        let imageBounds = NativeRadarFrameCacheViewport(west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north)
        let visibleBounds = NativeRadarFrameCacheViewport(west: viewport.west, south: viewport.south,
            east: viewport.east, north: viewport.north)
        // Fully covered frames are the normal case. Camera movement should
        // not rescan hundreds of thousands of mask bits for that case.
        if displayedCoverage.fullyCovered, imageBounds.contains(visibleBounds) {
            coverageMessage = nil
            return
        }
        let coverage = NativeRadarVisibleCoverage.fraction(width: displayedCoverage.width, height: displayedCoverage.height,
            imageBounds: imageBounds, visibleBounds: visibleBounds,
            isCovered: displayedCoverage.covers)
        coverageMessage = coverage.map { $0 < 0.98 } == true
            ? (forecast ? "Some visible areas lack forecast data. Blank areas are unavailable."
                        : "Some visible areas lack radar data. Blank areas are unavailable.") : nil
    }

    private func loadObservedImage(previous: Task<Void, Never>?, generation: Int, debounce: Bool) {
        guard let bounds = coverageViewport, bounds.isUsable, observedFrames.indices.contains(selectedIndex) else {
            imageMessage = "Radar imagery unavailable for this view."; return
        }
        let frame = observedFrames[selectedIndex]
        if let cached = observedRepository.cachedFrame(frame, bounds: bounds) {
            recordFrameHit(true); publishObserved(cached, bounds: bounds); return
        }
        recordFrameHit(false); loadingImage = true
        imageTask = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await self.observedFrame(frame, bounds: bounds, foreground: true)
                try Task.checkCancellation()
                guard self.active, !self.suspended, self.imageGeneration == generation else { return }
                guard self.coverageViewport == bounds else { self.completeImageRequest(); return }
                self.publishObserved(result, bounds: bounds)
            } catch {
                guard !Task.isCancelled, self.active, self.imageGeneration == generation else { return }
                self.completeImageRequest()
                if self.coverageViewport == bounds { self.imageMessage = "Radar imagery could not load. Retry or choose another layer." }
            }
        }
    }

    /// Warm only two adjacent source frames after a brief idle period. Never
    /// publish a prefetched image, time, source label or error to the visible map.
    private func warmNearbyFrames(after foregroundBarrier: Task<Void, Never>? = nil) {
        prefetchTask?.cancel()
        guard active, !suspended, !loadingImage, image != nil, product != .rainAmount,
              basemapStyle != .satellite, !ProcessInfo.processInfo.isLowPowerModeEnabled,
              let bounds = coverageViewport, bounds.isUsable, let selected = selectedInstant else { return }
        let radar = rawIsUsable ? observedFrames : []
        let forecasts = usableSubhourly
        let dates = scrubberDates
        var cached = Set<Date>()
        for frame in radar where observedRepository.cachedFrame(frame, bounds: bounds) != nil {
            cached.insert(Date(timeIntervalSince1970: Double(frame.validTimeMilliseconds) / 1000))
        }
        for frame in forecasts where Self.frameStore.forecast.contains(subhourlyRenderKey(frame, bounds: bounds)) {
            cached.insert(frame.validTime)
        }
        let targets = NativeRadarPrefetchPolicy.targets(dates: dates, selected: selected, cached: cached, playing: playing)
        let delay = playing ? 0 : 250
        guard !targets.isEmpty else { return }
        prefetchTask = Task(priority: .utility) { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(delay))
                for date in targets {
                    try Task.checkCancellation()
                    guard let self, self.active, !self.suspended, !self.loadingImage,
                          self.coverageViewport == bounds,
                          self.selectedInstant == selected, !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
                    let radarFrame = radar.first { Date(timeIntervalSince1970: Double($0.validTimeMilliseconds) / 1000) == date }
                    let forecastFrame = forecasts.first { $0.validTime == date }
                    do {
                        if let frame = radarFrame {
                            _ = try await self.observedFrame(frame, bounds: bounds, foreground: false)
                        } else if let frame = forecastFrame,
                                  bounds.east - bounds.west <= 14, bounds.north - bounds.south <= 14 {
                            _ = try await self.forecastFrame(frame, bounds: bounds, foreground: false)
                        } else { continue }
                    } catch is CancellationError { return }
                    catch { continue } // Optional warmup failures never replace valid weather.
                }
            } catch { } // Cancelled idle delay.
        }
    }

    /// Select actual advertised scans near -20/-10/0 minutes. Do not download
    /// an unbounded radar history simply to make a model transition look smooth.
    private func transitionCandidates(anchorStep: HRRRZarrContract.Step?, targetStep: HRRRZarrContract.Step,
                                      run: HRRRZarrClient.LoadedRun) -> [MRMSContract.AdvertisedFrame] {
        guard let anchorStep else { return [] }
        return transitionCandidates(anchorTime: anchorStep.validTime, targetTime: targetStep.validTime, cycle: run.run.cycleTime)
    }
    private func transitionCandidates(anchorTime: Date, targetTime: Date, cycle: Date) -> [MRMSContract.AdvertisedFrame] {
        guard let latest = observedHistory.last else { return [] }
        let anchor = Date(timeIntervalSince1970: Double(latest.validTimeMilliseconds) / 1000)
        let now = Date()
        guard now.timeIntervalSince(anchor) >= 0, now.timeIntervalSince(anchor) <= 8 * 60,
              now.timeIntervalSince(cycle) >= 0, now.timeIntervalSince(cycle) <= 150 * 60,
              anchorTime > now, anchorTime.timeIntervalSince(anchor) <= 30 * 60,
              targetTime.timeIntervalSince(anchor) <= 70 * 60 else { return [] }
        // A clear observed view needs no storm-motion correction. Avoid extra
        // national radar downloads on the most common, quiet-weather path.
        if let bounds = coverageViewport, let cached = observedRepository.cachedFrame(latest, bounds: bounds),
           cached.numeric.texture.bytes.filter({ $0 >= 17 }).count < 32 { return [] }
        var selected: [MRMSContract.AdvertisedFrame] = []
        for lag in [20.0, 10.0] {
            let desired = latest.validTimeMilliseconds - Int64(lag * 60_000)
            if let older = observedHistory.dropLast().filter({ candidate in
                !selected.contains(where: { $0.key == candidate.key })
            }).min(by: { abs($0.validTimeMilliseconds - desired) < abs($1.validTimeMilliseconds - desired) }),
               abs(older.validTimeMilliseconds - desired) <= 6 * 60_000 { selected.append(older) }
        }
        guard selected.count == 2 else { return [] }
        return (selected + [latest]).sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
    }

    private func loadTransitionObservations(_ frames: [MRMSContract.AdvertisedFrame], bounds: NativeRadarViewport,
                                           generation: Int? = nil) async throws -> [NativeRadarSeamEstimation.Frame] {
        guard frames.count == 3, let observedClient else { return [] }
        var output: [NativeRadarSeamEstimation.Frame] = []
        // Latest first: incomplete/clear coverage can stop without fetching history.
        for frame in frames.reversed() {
            try Task.checkCancellation()
            guard active, !suspended else { throw CancellationError() }
            let cacheKey = observedCacheKey(frame, bounds: bounds)
            if let cached = observedRepository.cachedFrame(frame, bounds: bounds) { output.append(cached.numeric) }
            else if let cached = Self.frameStore.evidence.value(for: cacheKey) { output.append(cached) }
            else {
                // MRMSClient owns cancellation-aware shared byte leases. Keep
                // this decode in the producer's cancellation tree; an unrelated
                // foreground request must not await abandoned optional evidence.
                let storeGeneration = Self.frameStore.generation
                let decoded = try await observedClient.decodeFrame(frame,
                    bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
                    width: NativeRadarCoveragePolicy.pixelWidth, height: NativeRadarCoveragePolicy.pixelHeight)
                let numeric = try Self.numericFrame(decoded, bounds: bounds, frame: frame)
                try Task.checkCancellation()
                if Self.frameStore.generation == storeGeneration {
                    Self.frameStore.evidence.insert(numeric, for: cacheKey, cost: numeric.texture.bytes.count * 2)
                }
                guard numeric.completeCoverage else { return [] }
                output.append(numeric)
            }
            if output.count == 1, let latest = output.first,
               (!latest.completeCoverage || latest.texture.bytes.filter({ $0 >= 17 }).count < 32) { return [] }
        }
        return output.sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
    }

    nonisolated private static func numericFrame(_ decoded: MRMSContract.Viewport, bounds: NativeRadarViewport,
                                                 frame: MRMSContract.AdvertisedFrame) throws -> NativeRadarSeamEstimation.Frame {
        try .init(texture: decoded.texture,
            bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
            encoding: decoded.encoding, validTime: RadarNumericContract.isoTime(frame.validTimeMilliseconds),
            validDataMask: decoded.validDataMask)
    }

    nonisolated private static func placeHasRadarCoverage(_ decoded: MRMSContract.Viewport, bounds: NativeRadarViewport,
                                                          latitude: Double, longitude: Double) -> Bool? {
        placeHasCoverage(decoded.validDataMask, width: decoded.texture.width, height: decoded.texture.height,
            bounds: bounds, latitude: latitude, longitude: longitude)
    }

    nonisolated private static func placeHasCoverage(_ mask: [UInt8], width: Int, height: Int, bounds: NativeRadarViewport,
                                                    latitude: Double, longitude: Double) -> Bool? {
        guard let index = placePixelIndex(width: width, height: height, bounds: bounds, latitude: latitude,
            longitude: longitude), mask.indices.contains(index) else { return nil }
        return mask[index] != 0
    }

    nonisolated private static func placePixelIndex(width: Int, height: Int, bounds: NativeRadarViewport,
                                                  latitude: Double, longitude: Double) -> Int? {
        guard latitude >= bounds.south, latitude <= bounds.north,
              longitude >= bounds.west, longitude <= bounds.east else { return nil }
        func mercator(_ value: Double) -> Double { log(tan(.pi / 4 + value * .pi / 360)) }
        let x = min(width - 1, max(0, Int(floor((longitude - bounds.west) / (bounds.east - bounds.west) * Double(width)))))
        let y = min(height - 1, max(0, Int(floor((mercator(bounds.north) - mercator(latitude))
            / (mercator(bounds.north) - mercator(bounds.south)) * Double(height)))))
        return y * width + x
    }

    /// Resample the actual LCC grid into Web Mercator. A four-corner stretch of
    /// the original projected grid would misplace storms between the corners.
    nonisolated private static func renderFrame(field: HRRRZarrClient.Field, step: HRRRZarrContract.Step,
                                           bounds: NativeRadarViewport) throws -> NativeRadarSeamEstimation.Frame {
        let width = NativeRadarCoveragePolicy.pixelWidth, height = NativeRadarCoveragePolicy.pixelHeight
        let encoding = try RadarNumericContract.Encoding()
        var bytes = [UInt8](repeating: 0, count: width * height), mask = bytes, covered = 0
        let viewport = try NativeRadarPresentationContract.Viewport(west: bounds.west, south: bounds.south,
                                                                    east: bounds.east, north: bounds.north)
        for y in 0..<height {
            try Task.checkCancellation()
            for x in 0..<width {
                let point = try viewport.pixelCenter(column: x, row: y, width: width, height: height)
                if let value = field.sample(longitude: point.longitude, latitude: point.latitude, sourceIndex: step.sourceIndex), value.isFinite {
                    covered += 1
                    mask[y * width + x] = 1
                    // Clear-air negative dBZ is valid coverage but remains transparent.
                    if value >= 5 { bytes[y * width + x] = try RadarNumericContract.encodeDbz(Double(value), encoding: encoding) }
                }
            }
        }
        guard covered > 0 else { throw HRRRZarrCodec.Failure.invalidGeometry }
        let texture = try RadarNumericContract.Texture(width: width, height: height, bytes: bytes)
        return try .init(texture: texture, bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
            encoding: encoding, validTime: RadarNumericContract.isoTime(Int64(step.validTime.timeIntervalSince1970 * 1000)), validDataMask: mask)
    }

    nonisolated private static func makeImage(rgba: Data, width: Int, height: Int) throws -> UIImage {
        guard let provider = CGDataProvider(data: rgba as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
                decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw HRRRZarrCodec.Failure.malformedChunk }
        return UIImage(cgImage: image)
    }

    private func shouldReuseImageRequest(_ requestID: String) -> Bool {
        imageRequestID == requestID && (loadingImage || (image != nil && displayedImageRequestID == requestID))
    }

    private var currentImageReadyForPlayback: Bool {
        guard product == .forecast || usesNumericRadar else { return selectedDate != nil }
        return image != nil && imageRequestID != nil && displayedImageRequestID == imageRequestID
            && displayedInstant == selectedInstant && displayedProduct == product && !imageUnavailableAtPlace
    }

    private func retrySelectedImageForPlayback() {
        guard !loadingImage, !currentImageReadyForPlayback else { return }
        // Play is also a retry action. Do not treat an older retained radar
        // image as a successful forecast load, or rejoin a failed identity.
        imageRequestID = nil
        loadSelectedImage()
    }

    func togglePlayback() {
        if playing { pause(); return }
        // The public global fallback has a tight shared-IP tile budget. Keep
        // native preview step-only until a bounded memory tile cache is accepted.
        guard !usesGlobalRadar, basemapStyle != .satellite else { return }
        guard scrubberDates.count > 1 else { return }
        if selectedIndex < 0 || selectedInstant == scrubberDates.last, let first = scrubberDates.first {
            selectScrubberTime(first)
        }
        retrySelectedImageForPlayback()
        playing = true; playbackMessage = nil
        warmNearbyFrames()
        playbackTask = Task { [weak self] in
            while !Task.isCancelled {
                // Poll readiness independently of the display cadence: a slow
                // download must not add another full playback interval.
                guard let self, self.active, self.playing else { return }
                if self.loadingImage || (self.refreshing && !self.currentImageReadyForPlayback) {
                    do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
                    continue
                }
                guard self.currentImageReadyForPlayback else { self.pause(); return }
                let dwell = NativeRadarPresentationContract.playbackDwellMilliseconds(
                    atEnd: self.selectedInstant == self.scrubberDates.last)
                do { try await Task.sleep(for: .milliseconds(dwell)) } catch { return }
                guard !Task.isCancelled, self.active, self.playing else { return }
                if self.loadingImage || (self.refreshing && !self.currentImageReadyForPlayback) { continue }
                guard self.currentImageReadyForPlayback else { self.pause(); return }
                let nextDate = self.scrubberDates.first { $0 > (self.selectedInstant ?? .distantFuture) }
                let crossesBoundary = self.product == .radar && (nextDate ?? .distantPast) > self.evaluationTime
                let limit: TimeInterval = self.product == .rainAmount ? 6 * 60 * 60 : self.product == .forecast || crossesBoundary ? 60 * 60 : 10 * 60
                let decision = try? NativeRadarPresentationContract.nextPlayback(instant: self.selectedInstant,
                    dates: self.scrubberDates, maximumGap: limit, loops: true)
                switch decision {
                case let .advance(instant): self.selectScrubberTime(instant, pausePlayback: false)
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
        updateAlertGeometry()
        if selectedDate == nil { pause(); loadSelectedImage() }
        else if product == .forecast || (image == nil && !loadingImage) { loadSelectedImage() }
        if let lastMetadataAttempt, evaluationTime.timeIntervalSince(lastMetadataAttempt) >= 4 * 60 { requestRefresh() }
        else if lastMetadataAttempt == nil && rendererReady { requestRefresh() }
        if wasSuspended && !rendererReady { Task { await start() } }
    }
    func suspend() {
        suspended = true
        prefetchTask?.cancel()
        for job in frameWork.values { job.task.cancel() }
        pause()
        startupTask?.cancel(); startupTask = nil
        refreshGeneration += 1; manualRefreshGeneration += 1
        refreshing = false; lastMetadataAttempt = nil
        manualRefreshTask?.cancel(); manualRefreshTask = nil
        imageTask?.cancel(); imageTask = nil; imageGeneration += 1
        hourlyImageTask?.cancel(); hourlyImageTask = nil
        loadingImage = false
        satelliteTask?.cancel(); satelliteTask = nil; satelliteGeneration += 1
        viewportAlertTask?.cancel(); viewportAlertTask = nil; viewportAlertGeneration += 1
        checkingViewportAlerts = false
        loadingSatellite = false
        imageRequestID = nil
    }
    func cancel() { active = false; suspend() }
}
