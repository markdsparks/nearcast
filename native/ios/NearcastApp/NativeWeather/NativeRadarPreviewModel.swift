import Foundation

/// Portable geometry, admission and retention rules for the static Today map.
/// A preview is a real latest observation, never a synthetic "Now" frame.
enum NativeRadarPreviewPolicy {
    static let reuseAge: TimeInterval = 120
    static let maximumEntries = 4
    static let maximumBytes = 12 * 1024 * 1024
    static let failureRetryDelay: TimeInterval = 60

    /// Loading/placeholder layout and pressed feedback must not change the
    /// snapshot request. Real size changes (rotation/split view) still do.
    static func stableWidth(current: Double, measured: Double) -> Double {
        guard measured.isFinite, measured >= 80 else { return current }
        let next = min(600, max(160, ceil(measured / 4) * 4))
        return current < 80 || abs(next - current) >= 8 ? next : current
    }

    struct Camera: Hashable, Sendable {
        let latitude: Double, longitude: Double, zoom: Double
        let width: Double, height: Double, scale: Double
        let west: Double, south: Double, east: Double, north: Double
    }
    struct Key: Hashable, Sendable {
        let place: String
        let camera: Camera
        let source: String
        let style: String
    }

    static func camera(latitude: Double, longitude: Double, width: Double, height: Double) -> Camera? {
        guard [latitude, longitude, width, height].allSatisfy(\.isFinite), abs(latitude) <= 85,
              abs(longitude) <= 180, width >= 80, height >= 60 else { return nil }
        let width = min(600, max(160, ceil(width / 4) * 4))
        let height = min(320, max(96, ceil(height / 4) * 4))
        let zoom = 6.8, world = 512 * pow(2.0, zoom)
        let centerY = (1 - log(tan(.pi / 4 + latitude * .pi / 360)) / .pi) / 2
        func latitudeAt(_ y: Double) -> Double { atan(sinh(.pi * (1 - 2 * y))) * 180 / .pi }
        let south = max(-85, latitudeAt(centerY + height / world / 2))
        let north = min(85, latitudeAt(centerY - height / world / 2))
        let west = max(-180, longitude - width / world * 180)
        let east = min(180, longitude + width / world * 180)
        guard south < north, west < east else { return nil }
        return .init(latitude: latitude, longitude: longitude, zoom: zoom, width: width, height: height, scale: 2,
                     west: west, south: south, east: east, north: north)
    }

    struct Generation {
        private(set) var value: UInt64 = 0
        mutating func next() -> UInt64 { value &+= 1; return value }
        func accepts(_ candidate: UInt64) -> Bool { value == candidate }
    }
}

/// The cost includes both the composited bitmap and geographic handoff image.
/// No snapshots, tile URLs, configuration or place information goes to disk.
struct NativeRadarPreviewCache<Value> {
    private struct Entry {
        let value: Value, cost: Int, storedAt: Date, sourceTime: Date, maximumSourceAge: TimeInterval
        var access: UInt64
    }
    private var entries: [NativeRadarPreviewPolicy.Key: Entry] = [:]
    private var sequence: UInt64 = 0
    private(set) var cost = 0
    var count: Int { entries.count }

    mutating func value(for key: NativeRadarPreviewPolicy.Key, now: Date) -> Value? {
        prune(now: now)
        guard var entry = entries[key] else { return nil }
        sequence &+= 1; entry.access = sequence; entries[key] = entry
        return entry.value
    }
    mutating func recent(place: String, camera: NativeRadarPreviewPolicy.Camera, now: Date) -> Value? {
        prune(now: now)
        guard let key = entries.filter({ $0.key.place == place && $0.key.camera == camera })
            .max(by: { $0.value.access < $1.value.access })?.key else { return nil }
        return value(for: key, now: now)
    }
    mutating func insert(_ value: Value, for key: NativeRadarPreviewPolicy.Key, cost newCost: Int,
                         sourceTime: Date, maximumSourceAge: TimeInterval, now: Date) {
        prune(now: now)
        guard newCost > 0, newCost <= NativeRadarPreviewPolicy.maximumBytes,
              sourceTime.timeIntervalSince1970.isFinite, now.timeIntervalSince1970.isFinite,
              sourceTime <= now, maximumSourceAge.isFinite, maximumSourceAge > 0,
              now.timeIntervalSince(sourceTime) <= maximumSourceAge else { return }
        remove(key)
        while entries.count >= NativeRadarPreviewPolicy.maximumEntries || cost > NativeRadarPreviewPolicy.maximumBytes - newCost {
            guard let oldest = entries.min(by: { $0.value.access < $1.value.access })?.key else { break }
            remove(oldest)
        }
        sequence &+= 1
        entries[key] = .init(value: value, cost: newCost, storedAt: now, sourceTime: sourceTime,
                             maximumSourceAge: maximumSourceAge, access: sequence)
        cost += newCost
    }
    mutating func removeAll() { entries.removeAll(); cost = 0 }
    private mutating func prune(now: Date) {
        for (key, entry) in entries where !now.timeIntervalSince1970.isFinite || now < entry.storedAt
            || now.timeIntervalSince(entry.storedAt) >= NativeRadarPreviewPolicy.reuseAge
            || now < entry.sourceTime || now.timeIntervalSince(entry.sourceTime) > entry.maximumSourceAge { remove(key) }
    }
    private mutating func remove(_ key: NativeRadarPreviewPolicy.Key) {
        if let entry = entries.removeValue(forKey: key) { cost -= entry.cost }
    }
}

#if canImport(UIKit) && canImport(MapLibre)
import UIKit
import Combine
import CryptoKit

@MainActor
final class NativeRadarPreviewModel: ObservableObject {
    enum State: Equatable { case idle, loading, ready, unavailable }
    struct Attribution: Identifiable, Equatable {
        let title: String
        let url: URL
        var id: String { title + "|" + url.absoluteString }
    }
    @Published private(set) var image: UIImage?
    @Published private(set) var state: State = .idle
    @Published private(set) var status = "Latest radar"
    @Published private(set) var freshnessDate: Date?
    @Published private(set) var isStale = false
    @Published private(set) var attributions: [Attribution] = []
    private var context: NativeRadarOpeningContext?
    private var partialCoverage = false
    var openingContext: NativeRadarOpeningContext? {
        guard let context, let place, context.isUsable(for: place) else { return nil }
        return context
    }

    private struct Output {
        let image: UIImage
        let context: NativeRadarOpeningContext
        let credits: [Attribution]
        let maximumAge: TimeInterval
        let partialCoverage: Bool
    }
    private struct Weather {
        let image: NativeRadarImage?
        let tiles: NativeRadarTileLayer?
        let frames: [MRMSContract.AdvertisedFrame]
        let global: NativeGlobalRadarSnapshot?
        let time: Date
        let identity: String
        let credits: [Attribution]
        let maximumAge: TimeInterval
        let partialCoverage: Bool
    }
    @MainActor private final class Store {
        var cache = NativeRadarPreviewCache<Output>()
        var generation: UInt64 = 0
        private var observer: NSObjectProtocol?
        init() {
            observer = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.generation &+= 1; self?.cache.removeAll() }
                }
        }
    }
    private static let store = Store()
    private let observed = NativeRadarObservedRepository.shared
    private let global = NativeGlobalRadarClient()
    private var place: NativePreviewPlace?
    private var camera: NativeRadarPreviewPolicy.Camera?
    private var generation = NativeRadarPreviewPolicy.Generation()
    private var worker: Task<Void, Never>?
    private var timedOut: UInt64?
    private var retryAfter: Date?
    private var updateFailed = false

    /// The card owns visibility, scrolling and refresh cadence. This performs
    /// at most one static latest-frame request, never a playback warmup.
    func load(place: NativePreviewPlace, size: CGSize) async {
        // A superseded SwiftUI task must not cancel the newer place's worker.
        guard !Task.isCancelled else { return }
        guard place.isValid, let camera = NativeRadarPreviewPolicy.camera(latitude: place.latitude,
            longitude: place.longitude, width: size.width, height: size.height) else {
            cancel(); clear(); state = .unavailable; status = "Radar preview unavailable"
            return
        }
        let sameRequest = self.place?.coordinateIdentity == place.coordinateIdentity && self.camera == camera
        if sameRequest, let worker {
            // Join one producer; cancellation of this extra waiter does not
            // own or cancel the original request. Card disappearance does.
            let joinedGeneration = generation.value
            await worker.value
            if !Task.isCancelled, worker.isCancelled, generation.accepts(joinedGeneration) {
                // A new visible task can arrive while its canceled predecessor
                // is unwinding. Drain it, then admit a fresh producer rather
                // than waiting four minutes with an idle placeholder.
                self.worker = nil
                await load(place: place, size: size)
            }
            return
        }
        if sameRequest, let retryAfter, Date() < retryAfter {
            if let context, !context.isUsable(for: place) {
                clear(); state = .unavailable; status = "Radar preview unavailable"
            }
            return
        }
        cancel()
        if !sameRequest { clear(); retryAfter = nil; updateFailed = false }
        self.place = place; self.camera = camera
        let request = generation.next()
        let now = Date()
        // A StateObject may outlive its offscreen bitmap cache entry. Never
        // keep an hours-old image visible while a fresh request is starting.
        if let context, !context.isUsable(for: place, at: now) { clear() }
        else if let freshnessDate { updateStatus(sourceTime: freshnessDate, now: now) }
        if let cached = Self.store.cache.recent(place: place.coordinateIdentity, camera: camera, now: now),
           cached.context.isUsable(for: place, at: now) {
            publish(cached, now: now)
            return
        }
        state = .loading
        if image == nil { status = "Loading latest radar…" }
        timedOut = nil
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                let output = try await self.acquire(place: place, camera: camera)
                try Task.checkCancellation()
                guard self.generation.accepts(request) else { return }
                self.publish(output, now: Date())
            } catch {
                guard self.generation.accepts(request) else { return }
                if error is CancellationError, self.timedOut != request {
                    self.state = self.image == nil ? .idle : .ready
                    if self.image == nil { self.status = "Latest radar" }
                } else {
                    self.retryAfter = Date().addingTimeInterval(NativeRadarPreviewPolicy.failureRetryDelay)
                    if let context = self.context, context.isUsable(for: place), self.image != nil {
                        self.updateFailed = true
                        self.updateStatus(sourceTime: context.frameTime, now: Date())
                        self.state = .ready
                    } else {
                        self.clear(); self.state = .unavailable
                        self.status = "Radar preview unavailable"
                    }
                }
            }
        }
        worker = task
        let deadline = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(22)) } catch { return }
            guard let self, self.generation.accepts(request) else { return }
            self.timedOut = request
            task.cancel()
        }
        await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
        deadline.cancel()
        if generation.accepts(request) { worker = nil }
    }

    func cancel() {
        _ = generation.next()
        worker?.cancel(); worker = nil
        if state == .loading {
            state = image == nil ? .idle : .ready
            if image == nil { status = "Latest radar" }
        }
    }

    private func acquire(place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera) async throws -> Output {
        let retentionGeneration = Self.store.generation
        guard await NativeBasemapNetwork.prepareCache(), NativeBasemapNetwork.install() else { throw Failure.unavailable }
        try Task.checkCancellation()
        async let basemap = NativeBasemapClient(endpoint: NativeBasemapClient.endpoint(
            for: Bundle.main.bundleIdentifier ?? NativeBasemapContract.iosAudience)).load()
        let weather = try await latestWeather(place: place, camera: camera)
        guard case .ready(let catalog) = await basemap else { throw Failure.unavailable }
        try Task.checkCancellation()
        NativeBasemapNetwork.activate(catalog)
        let style = catalog.streets
        let key = NativeRadarPreviewPolicy.Key(place: place.coordinateIdentity, camera: camera,
            source: weather.identity, style: Self.styleIdentity(style))
        if let cached = Self.store.cache.value(for: key, now: Date()) { return cached }
        let renderer = NativeRadarPreviewSnapshotter()
        let bitmap = try await renderer.render(place: place, camera: camera, basemap: style,
                                                weatherImage: weather.image, weatherTiles: weather.tiles)
        try Task.checkCancellation()
        let context = NativeRadarOpeningContext(placeIdentity: place.coordinateIdentity, latitude: place.latitude,
            longitude: place.longitude, zoom: camera.zoom, frameTime: weather.time,
            image: weather.image, observedFrames: weather.frames, globalSnapshot: weather.global)
        guard context.isUsable(for: place) else { throw Failure.unavailable }
        let mapCredits = style.background.attributions + style.labels.attributions
        var credits = [Attribution(title: "MapLibre", url: URL(string: "https://maplibre.org/")!)]
        credits += mapCredits.map { .init(title: $0.title, url: $0.url) } + weather.credits
        var seen = Set<String>()
        credits = credits.filter { seen.insert($0.id).inserted }
        let output = Output(image: bitmap, context: context, credits: credits, maximumAge: weather.maximumAge,
                            partialCoverage: weather.partialCoverage)
        if retentionGeneration == Self.store.generation {
            let cost = Self.cost(bitmap) + (weather.image.map { Self.cost($0.image) } ?? 0)
            Self.store.cache.insert(output, for: key, cost: cost, sourceTime: weather.time,
                                    maximumSourceAge: weather.maximumAge, now: Date())
        }
        return output
    }

    private func latestWeather(place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera) async throws -> Weather {
        let now = Date()
        if (20...55).contains(place.latitude), (-130 ... -60).contains(place.longitude) {
            do {
                let frames = try await observed.recentFrames(now: now)
                guard let latest = frames.filter({ Double($0.validTimeMilliseconds) / 1000 <= now.timeIntervalSince1970 })
                    .max(by: { $0.validTimeMilliseconds < $1.validTimeMilliseconds }) else { throw Failure.unavailable }
                let time = Date(timeIntervalSince1970: Double(latest.validTimeMilliseconds) / 1000)
                guard NativeRadarFreshnessPolicy.assess(latest: time, selected: time, at: now).sourceIsUsable else { throw Failure.unavailable }
                let viewport = NativeRadarViewport(west: camera.west, south: camera.south, east: camera.east,
                                                   north: camera.north, zoom: camera.zoom)
                guard let coverage = observed.coverageEnvelope(for: viewport) else { throw Failure.unavailable }
                let bounds = NativeRadarViewport(west: coverage.bounds.west, south: coverage.bounds.south,
                    east: coverage.bounds.east, north: coverage.bounds.north, zoom: coverage.qualityZoom)
                let field = try await observed.frame(latest, bounds: bounds, foreground: false)
                try Task.checkCancellation()
                guard Self.hasCoverage(field.numeric, at: place) else { throw Failure.unavailable }
                let identity = NativeRadarObservedFrameIdentity(sourceKey: latest.key, byteLength: latest.byteLength,
                    validTimeMilliseconds: latest.validTimeMilliseconds).cacheKey + "|" + coverage.cacheKey
                return .init(image: field.image, tiles: nil, frames: frames, global: nil, time: time,
                    identity: "mrms-preview-v1|" + identity,
                    credits: [.init(title: "NOAA / NWS", url: URL(string: "https://www.weather.gov/")!)],
                    maximumAge: NativeRadarFreshnessPolicy.maximumDelayedAge,
                    partialCoverage: field.numeric.validDataMask.contains(0))
            } catch is CancellationError { throw CancellationError() }
            catch { /* The independently validated global observed feed may still be usable. */ }
        }
        try Task.checkCancellation()
        let fallbackNow = Date()
        guard case .ready(let snapshot) = await global.load(now: fallbackNow),
              let latest = snapshot.frames.filter({ $0.validTime <= fallbackNow }).max(by: { $0.validTime < $1.validTime }),
              fallbackNow.timeIntervalSince(latest.validTime) <= NativeGlobalRadarContract.maximumLatestObservationAge else {
            try Task.checkCancellation()
            throw Failure.unavailable
        }
        return .init(image: nil, tiles: .init(id: latest.id, templates: [latest.tileURLTemplate],
            minimumZoom: latest.minimumZoom, maximumZoom: latest.maximumZoom,
            credits: latest.attributions.map { ($0.title, $0.url) }), frames: [], global: snapshot,
            time: latest.validTime, identity: latest.id + "|" + latest.tileURLTemplate,
            credits: latest.attributions.map { .init(title: $0.title, url: $0.url) },
            maximumAge: NativeGlobalRadarContract.maximumLatestObservationAge, partialCoverage: false)
    }

    private func publish(_ output: Output, now: Date) {
        guard let place, output.context.isUsable(for: place, at: now) else {
            clear(); state = .unavailable; status = "Radar preview unavailable"; return
        }
        image = output.image; context = output.context; attributions = output.credits
        retryAfter = nil; updateFailed = false
        freshnessDate = output.context.frameTime
        partialCoverage = output.partialCoverage
        updateStatus(sourceTime: output.context.frameTime, now: now)
        state = .ready
    }
    private func updateStatus(sourceTime: Date, now: Date) {
        isStale = now.timeIntervalSince(sourceTime) > NativeRadarFreshnessPolicy.maximumCurrentAge
        status = (updateFailed ? "Radar update unavailable · last image" : isStale ? "Delayed radar" : "Observed radar")
            + (partialCoverage ? " · partial coverage" : "")
    }
    private func clear() {
        image = nil; context = nil; freshnessDate = nil; attributions = []; isStale = false; partialCoverage = false
        updateFailed = false
    }
    private static func styleIdentity(_ style: NativeBasemapDescriptor) -> String {
        let value = (style.background.tileURLTemplates + style.labels.tileURLTemplates).joined(separator: "|")
        return SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func cost(_ image: UIImage) -> Int {
        guard let bitmap = image.cgImage else { return NativeRadarPreviewPolicy.maximumBytes }
        return bitmap.bytesPerRow * bitmap.height
    }
    private static func hasCoverage(_ field: NativeRadarSeamEstimation.Frame, at place: NativePreviewPlace) -> Bool {
        let bounds = field.bounds
        guard place.longitude >= bounds.minLon, place.longitude <= bounds.maxLon,
              place.latitude >= bounds.minLat, place.latitude <= bounds.maxLat else { return false }
        func mercator(_ latitude: Double) -> Double { log(tan(.pi / 4 + latitude * .pi / 360)) }
        let width = field.texture.width, height = field.texture.height
        let x = min(width - 1, max(0, Int((place.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon) * Double(width))))
        let y = min(height - 1, max(0, Int((mercator(bounds.maxLat) - mercator(place.latitude)) /
            (mercator(bounds.maxLat) - mercator(bounds.minLat)) * Double(height))))
        return field.validDataMask[y * width + x] != 0
    }
    private enum Failure: Error { case unavailable }
}
#endif
