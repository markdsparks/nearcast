import Foundation

private final class SubhourlyMockStore: @unchecked Sendable {
    private let lock = NSLock()
    private var active = 0, peak = 0, ranges = 0, requests = 0
    private var failingStamp: String?
    func reset(failingStamp: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        precondition(active == 0)
        peak = 0; ranges = 0; requests = 0; self.failingStamp = failingStamp
    }
    func begin(isRange: Bool, stamp: String, hour: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if isRange { ranges += 1 }
        else { active += 1; peak = max(peak, active); requests += 1 }
        return !isRange && failingStamp == stamp && hour == 2
    }
    func end(isRange: Bool) { lock.lock(); if !isRange { active -= 1 }; lock.unlock() }
    func snapshot() -> (active: Int, peak: Int, ranges: Int, requests: Int) {
        lock.lock(); defer { lock.unlock() }; return (active, peak, ranges, requests)
    }
}

private final class SubhourlyMockProtocol: URLProtocol, @unchecked Sendable {
    static let store = SubhourlyMockStore()
    private let lock = NSLock()
    private var finished = false, started = false, isRange = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, url.host == "noaa-hrrr-bdp-pds.s3.amazonaws.com",
              request.value(forHTTPHeaderField: "Authorization") == nil,
              request.value(forHTTPHeaderField: "Cookie") == nil else { preconditionFailure("Unsafe mock HRRR request") }
        let parts = url.pathComponents
        let day = parts[1].replacingOccurrences(of: "hrrr.", with: "")
        let name = url.lastPathComponent
        let cycle = String(name.dropFirst(6).prefix(2))
        let hour = Int(name.components(separatedBy: "wrfsubhf")[1].prefix(2))!
        let stamp = day + cycle
        lock.lock()
        guard !finished else { lock.unlock(); return }
        isRange = request.value(forHTTPHeaderField: "Range") != nil
        let fail = Self.store.begin(isRange: isRange, stamp: stamp, hour: hour)
        started = true
        lock.unlock()
        let rows = (0..<4).map { index in
            "\(index + 1):\(index * 100):d=\(stamp):REFC:entire atmosphere:\((hour - 1) * 60 + (index + 1) * 15) min fcst:"
        } + ["5:400:d=\(stamp):TMP:surface:\(hour * 60) min fcst:"]
        let data = isRange ? Data(repeating: 0, count: 100) : Data(rows.joined(separator: "\n").utf8)
        let status = fail ? 503 : isRange ? 206 : 200
        var headers = ["Content-Length": String(data.count)]
        if isRange { headers["Content-Range"] = "bytes 0-99/1000" }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(40)) { [self] in
            guard finish() else { return }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    private func finish() -> Bool {
        lock.lock()
        guard !finished else { lock.unlock(); return false }
        finished = true
        let didStart = started
        lock.unlock()
        if didStart { Self.store.end(isRange: isRange) }
        return true
    }
    override func stopLoading() { _ = finish() }
}

private final class DecodeCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func record() { lock.lock(); count += 1; lock.unlock() }
    func value() -> Int { lock.lock(); defer { lock.unlock() }; return count }
}

/// Deterministic, cancellation-aware stand-in for range transport. No test
/// reaches a provider or sleeps through a slow/abandoned network operation.
private actor RangeGate {
    private var waiting: [UUID: (Int, CheckedContinuation<Void, Error>)] = [:]
    private var opened = false
    private var started: [Int] = [], canceled = 0
    func fetch(_ id: Int, bytes: Int = 100) async throws -> Data {
        let token = UUID()
        started.append(id)
        do {
            try await withTaskCancellationHandler(operation: {
                try Task.checkCancellation()
                if !opened {
                    try await withCheckedThrowingContinuation { waiting[token] = (id, $0) }
                }
                try Task.checkCancellation()
            }, onCancel: { Task { await self.cancel(token) } })
            return Data(repeating: 0, count: bytes)
        } catch { canceled += 1; throw error }
    }
    private func cancel(_ token: UUID) { waiting.removeValue(forKey: token)?.1.resume(throwing: CancellationError()) }
    func release(_ id: Int) {
        for (token, waiter) in waiting where waiter.0 == id {
            waiting.removeValue(forKey: token)?.1.resume()
        }
    }
    func releaseAll() {
        opened = true
        let pending = waiting; waiting.removeAll()
        for (_, waiter) in pending { waiter.1.resume() }
    }
    func snapshot() -> (started: [Int], canceled: Int, waiting: Int) { (started, canceled, waiting.count) }
}

@main enum SubhourlyTests {
    static func waitUntil(_ reason: String, _ condition: () async -> Bool) async throws {
        for _ in 0..<1000 {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(2))
        }
        preconditionFailure(reason)
    }
    static func sourceFrame(_ cycle: Date, _ lead: Int, range: ClosedRange<Int> = 0...99) throws -> HRRRSubhourly.Frame {
        .init(url: try HRRRSubhourly.urls(cycle: cycle, hour: (lead + 59) / 60).data,
              range: range, cycle: cycle, leadMinutes: lead)
    }
    static func sampled(_ frame: HRRRSubhourly.Frame, _ bounds: NativeRadarPresentationContract.Viewport,
                        width: Int = 8, height: Int = 8) throws -> NativeRadarSeamEstimation.Frame {
        try .init(texture: .init(width: width, height: height, bytes: [UInt8](repeating: 30, count: width * height)),
                  bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
                  encoding: .init(), validTime: RadarNumericContract.isoTime(Int64(frame.validTime.timeIntervalSince1970 * 1000)),
                  validDataMask: [UInt8](repeating: 1, count: width * height))
    }
    private static func cachedLoad(_ cache: HRRRSubhourlyCache, _ frame: HRRRSubhourly.Frame,
                           _ bounds: NativeRadarPresentationContract.Viewport, gate: RangeGate,
                           decodes: DecodeCounter, width: Int = 8, height: Int = 8,
                           priority: HRRRSubhourlyCache.Priority = .foreground) async throws -> NativeRadarSeamEstimation.Frame {
        try await cache.load(frame, bounds: bounds, width: width, height: height, priority: priority,
            fetch: { try await gate.fetch(frame.leadMinutes, bytes: frame.range.count) },
            decode: { _ in decodes.record(); return try sampled(frame, bounds, width: width, height: height) })
    }

    static func cacheTests(cycle: Date) async throws {
        let a = try NativeRadarPresentationContract.Viewport(west: -91, south: 38, east: -89, north: 40)
        let b = try NativeRadarPresentationContract.Viewport(west: -92, south: 38, east: -90, north: 40)
        let frame = try sourceFrame(cycle, 15)

        // A foreground request joins the exact prefetch job and upgrades it.
        // Canceling that speculative subscriber cannot cancel the foreground.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            let prefetch = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes, priority: .prefetch) }
            try await waitUntil("Prefetch did not start") { await gate.snapshot().started.count == 1 }
            let foreground = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes) }
            try await waitUntil("Foreground did not join prefetch") { await cache.snapshot().numeric.joins == 1 }
            await cache.cancelPrefetch()
            do { _ = try await prefetch.value; preconditionFailure("Speculative subscriber was not canceled") } catch is CancellationError { }
            await gate.releaseAll()
            _ = try await foreground.value
            _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes)
            let state = await cache.snapshot(), network = await gate.snapshot()
            precondition(network.started.count == 1 && network.canceled == 0 && decodes.value() == 1)
            precondition(state.numeric.hits == 1 && state.numeric.promotions == 1 && state.numeric.cachedEntries == 1)
            precondition(state.source.cachedEntries == 1 && state.numeric.activeJobs == 0)
        }

        // Distinct cameras use distinct sampled fields, but their range bytes
        // are shared even when both requests arrive before the source finishes.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            let first = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes) }
            let second = Task { try await cachedLoad(cache, frame, b, gate: gate, decodes: decodes) }
            try await waitUntil("Cross-camera source was not joined") { await cache.snapshot().source.joins == 1 }
            await gate.releaseAll()
            _ = try await (first.value, second.value)
            _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes, width: 16)
            let state = await cache.snapshot(), network = await gate.snapshot()
            precondition(network.started.count == 1 && decodes.value() == 3)
            precondition(state.source.hits == 1 && state.source.cachedEntries == 1 && state.numeric.cachedEntries == 3)
        }

        // Joining at the rendered tier promotes the one existing numeric
        // producer without manufacturing a second field/download subscriber.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            let producer = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes, priority: .prefetch) }
            try await waitUntil("Render producer source did not start") { await gate.snapshot().started.count == 1 }
            await cache.promote(frame, bounds: a, width: 8, height: 8)
            await cache.cancelPrefetch()
            await gate.releaseAll()
            _ = try await producer.value
            let state = await cache.snapshot(), network = await gate.snapshot()
            precondition(state.numeric.promotions == 1 && state.numeric.joins == 0 && state.numeric.loads == 1)
            precondition(network.started.count == 1 && network.canceled == 0 && decodes.value() == 1)
        }

        // The complete 24-frame loop at the native padded resolution survives
        // an immediate second pass with zero new acquisition or sampling work.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            await gate.releaseAll()
            for _ in 0..<2 {
                for index in 1...24 {
                    _ = try await cachedLoad(cache, sourceFrame(cycle, index * 15), a,
                                             gate: gate, decodes: decodes, width: 512, height: 672)
                }
            }
            let state = await cache.snapshot(), network = await gate.snapshot()
            precondition(network.started.count == 24 && decodes.value() == 24)
            precondition(state.numeric.hits == 24 && state.numeric.cachedEntries == 24)
            precondition(state.numeric.cachedBytes == 24 * 512 * 672 * 2 && state.numeric.cachedBytes <= 24 * 1024 * 1024)
            precondition(state.source.totalLoadMilliseconds >= 0 && state.numeric.totalLoadMilliseconds > 0)
        }

        // Full provenance matters: same valid time with a different cycle,
        // and a replaced advertised range, must never return an old field.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            await gate.releaseAll()
            let otherCycle = try sourceFrame(cycle.addingTimeInterval(-3600), 75)
            let otherRange = try sourceFrame(cycle, 15, range: 100...199)
            precondition(frame.validTime == otherCycle.validTime)
            precondition(HRRRSubhourlyCache.SourceKey(frame) != HRRRSubhourlyCache.SourceKey(otherCycle))
            precondition(HRRRSubhourlyCache.SourceKey(frame) != HRRRSubhourlyCache.SourceKey(otherRange))
            for value in [frame, otherCycle, otherRange] {
                _ = try await cachedLoad(cache, value, a, gate: gate, decodes: decodes)
            }
            let network = await gate.snapshot()
            precondition(network.started.count == 3 && decodes.value() == 3)
        }

        // Invalid decode/time, partial bytes, and untrusted URLs never become
        // reusable values. A subsequent corrected request can retry normally.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            await gate.releaseAll()
            do {
                _ = try await cache.load(frame, bounds: a, width: 8, height: 8,
                    fetch: { try await gate.fetch(15) }, decode: { _ in throw HRRRSubhourly.Failure.malformed })
                preconditionFailure("Invalid decode accepted")
            } catch HRRRSubhourly.Failure.malformed { }
            do {
                _ = try await cache.load(frame, bounds: a, width: 8, height: 8,
                    fetch: { try await gate.fetch(15, bytes: 99) }, decode: { _ in try sampled(frame, a) })
                preconditionFailure("Partial source bytes accepted")
            } catch HRRRSubhourly.Failure.malformed { }
            do {
                _ = try await cache.load(frame, bounds: a, width: 8, height: 8,
                    fetch: { try await gate.fetch(15) }, decode: { _ in try sampled(sourceFrame(cycle, 30), a) })
                preconditionFailure("Mismatched numeric valid time accepted")
            } catch HRRRSubhourly.Failure.timeMismatch { }
            let invalid = HRRRSubhourly.Frame(url: URL(string: "https://example.invalid/private?token=secret")!,
                                              range: frame.range, cycle: cycle, leadMinutes: 15)
            do {
                _ = try await cachedLoad(cache, invalid, a, gate: gate, decodes: decodes)
                preconditionFailure("Noncanonical URL accepted")
            } catch HRRRSubhourly.Failure.invalidIndex { }
            let failed = await cache.snapshot(), network = await gate.snapshot()
            precondition(failed.source.cachedEntries == 0 && failed.numeric.cachedEntries == 0 && network.started.count == 3)
            _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes)
            let recovered = await cache.snapshot()
            precondition(recovered.source.cachedEntries == 1 && recovered.numeric.cachedEntries == 1)
        }

        // Cancel the last subscriber while bytes are in flight, then retry.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            let abandoned = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes) }
            try await waitUntil("Cancellation source did not start") { await gate.snapshot().started.count == 1 }
            abandoned.cancel()
            do { _ = try await abandoned.value; preconditionFailure("Last consumer cancellation ignored") } catch is CancellationError { }
            try await waitUntil("Canceled source remained active") {
                let state = await cache.snapshot()
                return state.source.activeJobs == 0 && state.numeric.activeJobs == 0
            }
            let canceled = await gate.snapshot(), state = await cache.snapshot()
            precondition(canceled.canceled == 1 && state.source.cachedEntries == 0 && state.numeric.cachedEntries == 0)
            await gate.releaseAll()
            _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes)
            precondition(decodes.value() == 1)
        }

        // Two jobs run; queued foreground work outranks speculative work, and
        // promoting a queued exact-key request does not start a second job.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            let f30 = try sourceFrame(cycle, 30), f45 = try sourceFrame(cycle, 45), f60 = try sourceFrame(cycle, 60)
            let t1 = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes, priority: .prefetch) }
            let t2 = Task { try await cachedLoad(cache, f30, a, gate: gate, decodes: decodes, priority: .prefetch) }
            try await waitUntil("Two source lanes did not run") { await gate.snapshot().started.count == 2 }
            let t3 = Task { try await cachedLoad(cache, f45, a, gate: gate, decodes: decodes, priority: .prefetch) }
            try await waitUntil("First queued prefetch missing") { await cache.snapshot().numeric.queuedJobs == 1 }
            let t4 = Task { try await cachedLoad(cache, f60, a, gate: gate, decodes: decodes, priority: .prefetch) }
            try await waitUntil("Second queued prefetch missing") { await cache.snapshot().numeric.queuedJobs == 2 }
            let selected = Task { try await cachedLoad(cache, f60, a, gate: gate, decodes: decodes) }
            try await waitUntil("Queued foreground did not promote") { await cache.snapshot().numeric.promotions == 1 }
            await gate.release(15)
            try await waitUntil("Promoted forecast did not start next") { await gate.snapshot().started.count == 3 }
            let promoted = await gate.snapshot(), state = await cache.snapshot()
            precondition(promoted.started.last == 60 && state.source.activeJobs <= 2 && state.numeric.activeJobs <= 2)
            await gate.releaseAll()
            _ = try await (t1.value, t2.value, t3.value, t4.value, selected.value)
            precondition(decodes.value() == 4)
        }

        // Small independent budgets exercise LRU ordering in both tiers.
        do {
            let cache = HRRRSubhourlyCache(sourceByteBudget: 200, numericByteBudget: 256, maximumEntries: 2)
            let gate = RangeGate(), decodes = DecodeCounter()
            await gate.releaseAll()
            for lead in [15, 30, 15, 45, 30] {
                _ = try await cachedLoad(cache, sourceFrame(cycle, lead), a, gate: gate, decodes: decodes)
            }
            let state = await cache.snapshot(), network = await gate.snapshot()
            precondition(state.source.cachedBytes <= 200 && state.numeric.cachedBytes <= 256)
            precondition(state.source.cachedEntries == 2 && state.numeric.cachedEntries == 2 && state.numeric.evictions == 2)
            // Source LRU is independent: the numeric hit on 15 never touched
            // source bytes, so the final 30 resamples without a new download.
            precondition(network.started.count == 3 && decodes.value() == 4 && state.source.hits == 1)
        }

        // Memory pressure flush does not disrupt active consumers, and old
        // jobs must not repopulate the just-purged retained values afterward.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            let active = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes) }
            let otherFrame = try sourceFrame(cycle, 30), queuedFrame = try sourceFrame(cycle, 45)
            let active2 = Task { try await cachedLoad(cache, otherFrame, a, gate: gate, decodes: decodes) }
            try await waitUntil("Memory-pressure sources did not start") { await gate.snapshot().started.count == 2 }
            let queued = Task { try await cachedLoad(cache, queuedFrame, a, gate: gate, decodes: decodes) }
            try await waitUntil("Pre-pressure queued field missing") { await cache.snapshot().numeric.queuedJobs == 1 }
            await cache.removeAll()
            await gate.releaseAll()
            _ = try await (active.value, active2.value, queued.value)
            let cleared = await cache.snapshot()
            precondition(cleared.source.cachedEntries == 0 && cleared.numeric.cachedEntries == 0)
            _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes)
            let network = await gate.snapshot()
            precondition(network.started.count == 4 && decodes.value() == 4)
        }

        // Admission is bounded in both dimensions: distinct fields and
        // subscribers to one field. Cancellation drains queued work promptly.
        do {
            let cache = HRRRSubhourlyCache(), gate = RangeGate(), decodes = DecodeCounter()
            var tasks: [Task<NativeRadarSeamEstimation.Frame, Error>] = []
            for lead in stride(from: 15, through: 480, by: 15) {
                let value = try sourceFrame(cycle, lead)
                tasks.append(Task { try await cachedLoad(cache, value, a, gate: gate, decodes: decodes, priority: .prefetch) })
            }
            try await waitUntil("Bounded field queue did not fill") { await cache.snapshot().numeric.queuedJobs == 30 }
            do {
                _ = try await cachedLoad(cache, sourceFrame(cycle, 495), a, gate: gate, decodes: decodes)
                preconditionFailure("Field job queue grew without limit")
            } catch RadarChunkContract.Failure.requestLimit { }
            await cache.cancelPrefetch()
            for task in tasks {
                do { _ = try await task.value; preconditionFailure("Canceled queue returned a field") } catch is CancellationError { }
            }
            try await waitUntil("Canceled field queue leaked work") {
                let value = await cache.snapshot()
                return value.numeric.activeJobs == 0 && value.numeric.queuedJobs == 0 && value.source.activeJobs == 0
            }
            let state = await cache.snapshot()
            precondition(state.numeric.consumers == 0 && state.source.consumers == 0)

            tasks.removeAll()
            for _ in 0..<16 {
                tasks.append(Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes, priority: .prefetch) })
            }
            try await waitUntil("Consumer cap fixture did not join") { await cache.snapshot().numeric.consumers == 16 }
            do {
                _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes)
                preconditionFailure("Field consumers grew without limit")
            } catch RadarChunkContract.Failure.requestLimit { }
            await cache.cancelPrefetch()
            for task in tasks {
                do { _ = try await task.value; preconditionFailure("Canceled joined subscriber returned a field") } catch is CancellationError { }
            }
            try await waitUntil("Canceled joined work leaked") {
                let value = await cache.snapshot()
                return value.numeric.activeJobs == 0 && value.source.activeJobs == 0
            }
            for _ in 0..<20 {
                let immediatelyCanceled = Task { try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes) }
                immediatelyCanceled.cancel()
                do { _ = try await immediatelyCanceled.value; preconditionFailure("Immediate cancellation ignored") } catch is CancellationError { }
            }
            try await waitUntil("Immediate cancellation leaked work") {
                let value = await cache.snapshot()
                return value.numeric.activeJobs == 0 && value.source.activeJobs == 0 && value.numeric.consumers == 0
            }
        }

        // Both caches expire independently; disabling byte retention also
        // leaves useful acquisition semantics without retaining any payload.
        do {
            let cache = HRRRSubhourlyCache(maximumAge: 0.02), gate = RangeGate(), decodes = DecodeCounter()
            await gate.releaseAll()
            _ = try await cachedLoad(cache, frame, a, gate: gate, decodes: decodes)
            try await Task.sleep(for: .milliseconds(30))
            let expired = await cache.snapshot()
            precondition(expired.source.cachedEntries == 0 && expired.numeric.cachedEntries == 0)
            let disabled = HRRRSubhourlyCache(sourceByteBudget: 0, numericByteBudget: 0)
            _ = try await cachedLoad(disabled, frame, a, gate: gate, decodes: decodes)
            let empty = await disabled.snapshot()
            precondition(empty.source.cachedBytes == 0 && empty.numeric.cachedBytes == 0)
        }
        print("PASS HRRR shared cache: 24-frame warm loop, cross-camera bytes, exact field identity, priority promotion, consumer cancellation, validated-only retention, LRU caps and memory-pressure purge")
    }

    static func acquisitionTests(cycle: Date, frame: HRRRSubhourly.Frame) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SubhourlyMockProtocol.self]
        configuration.httpAdditionalHeaders = ["Authorization": "must-be-removed", "Cookie": "must-be-removed"]
        let client = try HRRRSubhourlyClient(configuration: configuration)
        let discovery = Task { try await client.discover(now: cycle) }
        for _ in 0..<200 {
            if SubhourlyMockProtocol.store.snapshot().active == 2 { break }
            try await Task.sleep(for: .milliseconds(2))
        }
        precondition(SubhourlyMockProtocol.store.snapshot().active == 2, "Independent metadata indexes remained serial")
        // Deliberately malformed frame bytes prove this foreground request got
        // its own transport lane instead of failing admission behind metadata.
        do {
            _ = try await client.load(frame, bounds: .init(west: -91, south: 38, east: -89, north: 40), width: 512, height: 672)
            preconditionFailure("Mock malformed forecast frame decoded")
        } catch HRRRSubhourly.Failure.malformed { }
        let frames = try await discovery.value
        let first = SubhourlyMockProtocol.store.snapshot()
        precondition(first.peak == 2 && first.requests == 6 && first.ranges == 1)
        precondition(frames.count == 24 && frames.allSatisfy { $0.cycle == cycle })
        for index in 0..<24 { precondition(frames[index].validTime == cycle.addingTimeInterval(Double(index + 1) * 900)) }

        SubhourlyMockProtocol.store.reset(failingStamp: "2026091812")
        let fallback = try await client.discover(now: cycle)
        precondition(fallback.count == 24 && fallback.allSatisfy { $0.cycle == cycle.addingTimeInterval(-3600) }, "Partial/failing cycle was mixed into forecast")
        precondition(SubhourlyMockProtocol.store.snapshot().peak <= 2)

        SubhourlyMockProtocol.store.reset()
        let canceled = Task { try await client.discover(now: cycle) }
        for _ in 0..<200 {
            if SubhourlyMockProtocol.store.snapshot().active == 2 { break }
            try await Task.sleep(for: .milliseconds(2))
        }
        canceled.cancel()
        do { _ = try await canceled.value; preconditionFailure("Metadata cancellation ignored") } catch is CancellationError { }
        for _ in 0..<200 {
            if SubhourlyMockProtocol.store.snapshot().active == 0 { break }
            try await Task.sleep(for: .milliseconds(2))
        }
        precondition(SubhourlyMockProtocol.store.snapshot().active == 0)
        print("PASS HRRR metadata acquisition: two-request batches, independent selected-frame lane, complete-cycle fallback, ordered real timestamps, stripped credentials and cancellation")
    }

    static func main() async throws {
        let cycle = ISO8601DateFormatter().date(from: "2026-09-18T12:00:00Z")!
        let rows = ["1:0:d=2026091812:REFC:entire atmosphere:15 min fcst:",
                    "2:100:d=2026091812:REFC:entire atmosphere:30 min fcst:",
                    "3:200:d=2026091812:REFC:entire atmosphere:45 min fcst:",
                    "4:300:d=2026091812:REFC:entire atmosphere:60 min fcst:",
                    "5:400:d=2026091812:TMP:surface:60 min fcst:"].joined(separator: "\n")
        let frames = try HRRRSubhourly.parseIndex(Data(rows.utf8), cycle: cycle, hour: 1)
        precondition(frames.map(\.leadMinutes) == [15,30,45,60])
        precondition(frames[0].range == 0...99 && frames[3].range == 300...399)
        try await acquisitionTests(cycle: cycle, frame: frames[0])
        try await cacheTests(cycle: cycle)
        for bad in [rows.replacingOccurrences(of: "15 min", with: "16 min"),
                    rows.replacingOccurrences(of: "d=2026091812", with: "d=2026091811"),
                    rows.replacingOccurrences(of: "2:100", with: "2:0"),
                    rows.replacingOccurrences(of: "5:400", with: "5:99999999")] {
            do { _ = try HRRRSubhourly.parseIndex(Data(bad.utf8), cycle: cycle, hour: 1); fatalError("Accepted bad index") }
            catch HRRRSubhourly.Failure.invalidIndex { }
        }
        do {
            _ = try HRRRSubhourly.decode(Data(repeating: 0, count: 100), frame: frames[0],
                bounds: .init(west: -91, south: 38, east: -89, north: 40))
            fatalError("Accepted malformed GRIB")
        } catch { }
        print("PASS real quarter-hour index selection, bounded ranges, invalid metadata/GRIB rejection")
        if let directory = ProcessInfo.processInfo.environment["NEARCAST_HRRR15_FIXTURE"] {
            let base = URL(fileURLWithPath: directory)
            let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: base.appendingPathComponent("metadata.json"))) as! [String: Any]
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let frame = HRRRSubhourly.Frame(url: URL(string: metadata["url"] as! String)!,
                range: (metadata["start"] as! Int)...(metadata["end"] as! Int),
                cycle: formatter.date(from: metadata["cycle"] as! String)!, leadMinutes: metadata["leadMinutes"] as! Int)
            let actual = try HRRRSubhourly.decode(Data(contentsOf: base.appendingPathComponent("record.grib2")), frame: frame,
                bounds: .init(west: -105, south: 30, east: -85, north: 44), width: 160, height: 120)
            let expected = Array(try Data(contentsOf: base.appendingPathComponent("expected.bin")))
            precondition(actual.texture.bytes == expected, "Native forecast differs from established web decoder")
            print("PASS all 19,200 native pixels match independent web decoder")
        }
        if CommandLine.arguments.contains("--live") {
            let client = try HRRRSubhourlyClient()
            let advertised = try await client.discover(now: Date())
            precondition(advertised.count == 24)
            for i in 1..<advertised.count { precondition(advertised[i].validTime.timeIntervalSince(advertised[i-1].validTime) == 900) }
            for frame in advertised.prefix(4) {
                let decoded = try await client.load(frame, bounds: .init(west: -93, south: 36, east: -87, north: 41))
                precondition(decoded.validDataMask.contains(1))
                print("PASS live frame \(decoded.validTime), \(frame.range.count) bytes; coverage \(decoded.validDataMask.filter { $0 == 1 }.count)")
            }
        }
    }
}
