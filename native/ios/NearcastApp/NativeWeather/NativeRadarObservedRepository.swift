import Foundation
import UIKit
import OSLog

/// The latest-observed Today snapshot and interactive map share this owner.
/// It starts only requested MRMS metadata/frames: no forecast, alerts, WMS,
/// neighboring-frame warmup, or map model is created by this repository.
@MainActor
final class NativeRadarObservedRepository {
    static let shared = NativeRadarObservedRepository()

    struct RenderedFrame {
        let image: NativeRadarImage
        let numeric: NativeRadarSeamEstimation.Frame
        let sourceMilliseconds: Double
        let renderMilliseconds: Double
        var cost: Int { numeric.texture.bytes.count * 6 }
    }
    struct Statistics {
        let hits: Int
        let misses: Int
        let joins: Int
        let renders: Int
        let activeJobs: Int
        let queuedJobs: Int
        let retainedBytes: Int
    }
    typealias MetadataLoader = @MainActor (Date) async throws -> [MRMSContract.AdvertisedFrame]
    typealias FrameLoader = @MainActor (MRMSContract.AdvertisedFrame, NativeRadarViewport) async throws -> RenderedFrame

    private struct Job {
        let token: UUID
        let sequence: Int
        let generation: Int
        let frame: MRMSContract.AdvertisedFrame
        let bounds: NativeRadarViewport
        var foreground: Bool
        var task: Task<Void, Never>?
        var consumers: [UUID: CheckedContinuation<RenderedFrame, Error>]
    }
    private let metadataLoader: MetadataLoader
    private let frameLoader: FrameLoader
    private var cache = NativeRadarFrameCache<String, RenderedFrame>(policy: .observedAreas)
    private var coverage = NativeRadarCoverageHistory(maximumEntries: 8)
    private var metadata: (frames: [MRMSContract.AdvertisedFrame], at: Date)?
    private var metadataTask: Task<Void, Never>?
    private var metadataToken: UUID?
    private var metadataConsumers: [UUID: CheckedContinuation<[MRMSContract.AdvertisedFrame], Error>] = [:]
    private var jobs: [String: Job] = [:]
    private var running: Set<UUID> = []
    private var generation = 0, sequence = 0
    private var hits = 0, misses = 0, joins = 0, renders = 0
    private var pressureObserver: NSObjectProtocol?
    private let log = Logger(subsystem: "app.nearcast.ios", category: "ObservedRadarRepository")

    init(metadataLoader: MetadataLoader? = nil, frameLoader: FrameLoader? = nil,
         observeMemoryPressure: Bool = true) {
        let client = try? MRMSClient()
        self.metadataLoader = metadataLoader ?? { now in
            guard let client else { throw MRMSContract.Failure.invalidOptions }
            return try await client.listRecentFrames(now: now, historyMinutes: 30, maximumFrames: 24)
        }
        self.frameLoader = frameLoader ?? { frame, bounds in
            guard let client else { throw MRMSContract.Failure.invalidOptions }
            return try await Self.render(frame, bounds: bounds, client: client)
        }
        if observeMemoryPressure {
            pressureObserver = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.removeAll() }
            }
        }
    }

    var retainedBytes: Int { cache.totalCost }
    var statistics: Statistics {
        .init(hits: hits, misses: misses, joins: joins, renders: renders,
            activeJobs: running.count, queuedJobs: jobs.values.filter { $0.task == nil }.count,
            retainedBytes: cache.totalCost)
    }

    func coverageEnvelope(for bounds: NativeRadarViewport) -> NativeRadarCoveragePolicy.Envelope? {
        coverage.envelope(for: .init(west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north),
            zoom: bounds.zoom)
    }

    static func cacheKey(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport) -> String {
        let source = NativeRadarObservedFrameIdentity(sourceKey: frame.key, byteLength: frame.byteLength,
            validTimeMilliseconds: frame.validTimeMilliseconds).cacheKey
        let area = NativeRadarCoveragePolicy.Envelope(bounds: .init(west: bounds.west, south: bounds.south,
            east: bounds.east, north: bounds.north), qualityZoom: bounds.zoom).cacheKey
        return "observed-v2|\(source)|\(area)"
    }

    func cachedFrame(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport) -> RenderedFrame? {
        guard bounds.isUsable else { return nil }
        return cache.value(for: Self.cacheKey(frame, bounds: bounds))
    }

    func cachedRecentFrames(now: Date = Date()) -> [MRMSContract.AdvertisedFrame]? {
        guard now.timeIntervalSince1970.isFinite, let metadata else { return nil }
        let age = now.timeIntervalSince(metadata.at)
        guard age >= 0, age < 120 else { return nil }
        return metadata.frames
    }

    func recentFrames(now: Date = Date(), force: Bool = false) async throws -> [MRMSContract.AdvertisedFrame] {
        try Task.checkCancellation()
        guard now.timeIntervalSince1970.isFinite else { throw MRMSContract.Failure.invalidOptions }
        if !force, let cached = cachedRecentFrames(now: now) { return cached }
        let consumer = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard metadataConsumers.count < 16 else { continuation.resume(throwing: MRMSContract.Failure.invalidOptions); return }
                metadataConsumers[consumer] = continuation
                guard metadataTask == nil else { return }
                let token = UUID()
                metadataToken = token
                metadataTask = Task { [self] in
                    let result: Result<[MRMSContract.AdvertisedFrame], Error>
                    do {
                        let frames = try await metadataLoader(now)
                        try Task.checkCancellation()
                        guard !frames.isEmpty, frames.count <= 24 else { throw MRMSContract.Failure.invalidOptions }
                        result = .success(frames)
                    } catch { result = .failure(error) }
                    guard metadataToken == token else { return }
                    metadataTask = nil; metadataToken = nil
                    let consumers = Array(metadataConsumers.values)
                    metadataConsumers.removeAll()
                    if case let .success(frames) = result { metadata = (frames, now) }
                    for continuation in consumers { continuation.resume(with: result) }
                }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.cancelMetadata(consumer) } })
    }

    private func cancelMetadata(_ consumer: UUID) {
        metadataConsumers.removeValue(forKey: consumer)?.resume(throwing: CancellationError())
        if metadataConsumers.isEmpty {
            metadataTask?.cancel(); metadataTask = nil; metadataToken = nil
        }
    }

    func frame(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport,
               foreground: Bool = true) async throws -> RenderedFrame {
        try Task.checkCancellation()
        guard bounds.isUsable, bounds.zoom.isFinite, (0...24).contains(bounds.zoom) else { throw MRMSContract.Failure.invalidOptions }
        let key = Self.cacheKey(frame, bounds: bounds)
        if let cached = cache.value(for: key) { hits += 1; return cached }
        misses += 1
        let consumer = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                if var job = jobs[key] {
                    guard job.consumers.count < 16 else { continuation.resume(throwing: MRMSContract.Failure.invalidOptions); return }
                    joins += 1; job.foreground = job.foreground || foreground
                    job.consumers[consumer] = continuation; jobs[key] = job
                } else {
                    guard jobs.count < 16 else { continuation.resume(throwing: MRMSContract.Failure.invalidOptions); return }
                    sequence += 1
                    jobs[key] = .init(token: UUID(), sequence: sequence, generation: generation, frame: frame,
                        bounds: bounds, foreground: foreground, task: nil, consumers: [consumer: continuation])
                }
                pump()
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.cancelFrame(key: key, consumer: consumer) } })
    }

    /// A map foreground subscriber may join its own existing warmup wrapper,
    /// rather than adding another repository lease. Promote that queued job
    /// without changing ownership or duplicating its provider work.
    func promote(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport) {
        let key = Self.cacheKey(frame, bounds: bounds)
        if var job = jobs[key] { job.foreground = true; jobs[key] = job; pump() }
    }

    private func pump() {
        while running.count < 2 {
            guard let key = jobs.filter({ $0.value.task == nil && !$0.value.consumers.isEmpty })
                .min(by: { a, b in a.value.foreground == b.value.foreground
                    ? a.value.sequence < b.value.sequence : a.value.foreground && !b.value.foreground })?.key,
                  var job = jobs[key] else { return }
            let token = job.token, frame = job.frame, bounds = job.bounds
            running.insert(token)
            job.task = Task(priority: .userInitiated) { [self] in
                let result: Result<RenderedFrame, Error>
                do {
                    let value = try await frameLoader(frame, bounds)
                    try Task.checkCancellation()
                    result = .success(value)
                } catch { result = .failure(error) }
                finish(key: key, token: token, result: result)
            }
            jobs[key] = job
        }
    }

    private func finish(key: String, token: UUID, result: Result<RenderedFrame, Error>) {
        running.remove(token)
        guard let job = jobs[key], job.token == token else { pump(); return }
        jobs.removeValue(forKey: key)
        if case let .success(value) = result {
            renders += 1
            if job.generation == generation { cache.insert(value, for: key, cost: value.cost) }
            log.info("observed_render source_ms=\(value.sourceMilliseconds, privacy: .public) render_ms=\(value.renderMilliseconds, privacy: .public) joins=\(self.joins, privacy: .public)")
        }
        for continuation in job.consumers.values { continuation.resume(with: result) }
        pump()
    }

    private func cancelFrame(key: String, consumer: UUID) {
        guard var job = jobs[key] else { return }
        job.consumers.removeValue(forKey: consumer)?.resume(throwing: CancellationError())
        if job.consumers.isEmpty { jobs.removeValue(forKey: key); job.task?.cancel() }
        else { jobs[key] = job }
        // Running cancellation retains its slot until the producer actually
        // finishes. A new request never creates a third concurrent decoder.
        pump()
    }

    func removeAll() {
        generation += 1; cache.removeAll(); coverage.removeAll()
        Task { await MRMSScanCache.shared.removeAll() }
    }

    private static func render(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport,
                               client: MRMSClient) async throws -> RenderedFrame {
        let start = ProcessInfo.processInfo.systemUptime
        let decoded = try await client.decodeFrame(frame,
            bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
            width: NativeRadarCoveragePolicy.pixelWidth, height: NativeRadarCoveragePolicy.pixelHeight)
        let sourceMilliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1000
        try Task.checkCancellation()
        guard decoded.hasCoverage else { throw MRMSContract.Failure.invalidOptions }
        let renderStart = ProcessInfo.processInfo.systemUptime
        let task = Task.detached(priority: .userInitiated) {
            let rgba = Data(try RadarNumericContract.highDetailRGBA(decoded.texture, encoding: decoded.encoding,
                validDataMask: decoded.validDataMask, zoom: bounds.zoom))
            try Task.checkCancellation()
            guard let provider = CGDataProvider(data: rgba as CFData),
                  let image = CGImage(width: decoded.texture.width, height: decoded.texture.height, bitsPerComponent: 8,
                    bitsPerPixel: 32, bytesPerRow: decoded.texture.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
                    decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw MRMSContract.Failure.invalidOptions }
            return UIImage(cgImage: image)
        }
        let image = try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
        try Task.checkCancellation()
        let numeric = try NativeRadarSeamEstimation.Frame(texture: decoded.texture,
            bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
            encoding: decoded.encoding, validTime: RadarNumericContract.isoTime(frame.validTimeMilliseconds),
            validDataMask: decoded.validDataMask)
        return .init(image: .init(id: cacheKey(frame, bounds: bounds), image: image, west: bounds.west, south: bounds.south,
            east: bounds.east, north: bounds.north), numeric: numeric, sourceMilliseconds: sourceMilliseconds,
            renderMilliseconds: (ProcessInfo.processInfo.systemUptime - renderStart) * 1000)
    }
}
