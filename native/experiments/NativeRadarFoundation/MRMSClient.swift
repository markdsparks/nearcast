import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

/// Direct, read-only public NOAA MRMS access. At most two concurrent decodes per
/// client; source discovery is bounded to two UTC days, three pages/day and 24
/// advertised frames. No persisted cache, cookies, credentials or location upload.
final class MRMSClient: @unchecked Sendable {
    private let transport: RadarChunkClient
    private let listingTransport: RadarChunkClient
    private let scanCache: MRMSScanCache
    private let lock = NSLock()
    private var activeDecodes = 0

    init(configuration: URLSessionConfiguration = .ephemeral, scanCache: MRMSScanCache = .shared) throws {
        transport = try RadarChunkClient(allowedOrigins: [MRMSContract.origin], configuration: configuration)
        // Discovery must not contend with two selected/warming frame jobs.
        // This isolated public-only lane keeps its own bounded admission.
        listingTransport = try RadarChunkClient(allowedOrigins: [MRMSContract.origin], configuration: configuration)
        self.scanCache = scanCache
    }

    func listRecentFrames(now: Date = Date(), historyMinutes: Int = 90, maximumFrames: Int = 10,
                          targetTimes: [Date] = [], toleranceMinutes: Int = 6) async throws -> [MRMSContract.AdvertisedFrame] {
        guard (1...180).contains(historyMinutes), (1...24).contains(maximumFrames),
              (1...15).contains(toleranceMinutes), targetTimes.count <= 24 else { throw MRMSContract.Failure.invalidOptions }
        let nowMS = try Self.milliseconds(now), earliest = nowMS - Int64(historyMinutes) * 60_000
        let targets = try targetTimes.map(Self.milliseconds).sorted()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var day = calendar.startOfDay(for: Date(timeIntervalSince1970: Double(earliest) / 1000))
        let finalDay = calendar.startOfDay(for: now)
        var found: [String: MRMSContract.AdvertisedFrame] = [:], dayCount = 0
        while day <= finalDay {
            try Task.checkCancellation()
            dayCount += 1
            guard dayCount <= 2 else { throw MRMSContract.Failure.invalidOptions }
            let parts = calendar.dateComponents([.year, .month, .day], from: day)
            let date = String(format: "%04d%02d%02d", parts.year!, parts.month!, parts.day!)
            let prefix = "CONUS/\(MRMSContract.product)/\(date)/"
            var token: String?, seenTokens = Set<String>()
            for pageIndex in 0..<3 {
                let url = try Self.listingURL(prefix: prefix, continuationToken: token)
                let data = try await listingTransport.fetchBytes(at: url, maximumBytes: 2 * 1024 * 1024)
                let page = try Self.parseListing(data, expectedPrefix: prefix)
                for frame in page.frames where frame.validTimeMilliseconds >= earliest && frame.validTimeMilliseconds <= nowMS {
                    if let old = found[frame.key], old != frame { throw MRMSContract.Failure.invalidListing }
                    found[frame.key] = frame
                }
                guard page.isTruncated else { break }
                guard pageIndex < 2, let next = page.continuationToken, seenTokens.insert(next).inserted else {
                    throw MRMSContract.Failure.listingLimit
                }
                token = next
            }
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else { throw MRMSContract.Failure.invalidTime }
            day = nextDay
        }
        return Self.selectFrames(Array(found.values), targets: targets, maximumFrames: maximumFrames,
                                 toleranceMilliseconds: Int64(toleranceMinutes) * 60_000)
    }

    func decodeFrame(_ frame: MRMSContract.AdvertisedFrame, bounds: RadarChunkContract.Bounds,
                     width: Int = 512, height: Int = 384,
                     encoding: RadarNumericContract.Encoding = try! .init()) async throws -> MRMSContract.Viewport {
        guard admitDecode() else { throw MRMSContract.Failure.requestLimit }
        defer { releaseDecode() }
        try Task.checkCancellation()
        // Validate caller-controlled allocation geometry before downloading.
        try bounds.validate()
        guard (64...1024).contains(width), (64...1024).contains(height),
              width <= RadarNumericContract.maximumTexturePixels / height else { throw MRMSContract.Failure.invalidOptions }
        let lease = try await scanCache.acquire(frame) { [transport] in
            try await transport.fetchBytes(at: frame.url, maximumBytes: frame.byteLength)
        }
        do {
            try Task.checkCancellation()
            let job = Task.detached(priority: .userInitiated) {
                try MRMSContract.decode(lease.data, frame: frame, bounds: bounds, width: width, height: height, encoding: encoding)
            }
            let result = try await withTaskCancellationHandler(operation: {
                try Task.checkCancellation()
                return try await job.value
            }, onCancel: { job.cancel() })
            try Task.checkCancellation()
            // A completed HTTP response alone is not cacheable: source time,
            // GRIB/PNG checksums, compressed data and viewport decoding must pass.
            await scanCache.release(lease, validated: true)
            try Task.checkCancellation()
            return result
        } catch {
            await scanCache.release(lease, validated: false)
            throw error
        }
    }

    private func admitDecode() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard activeDecodes < 2 else { return false }
        activeDecodes += 1; return true
    }
    private func releaseDecode() { lock.lock(); activeDecodes -= 1; lock.unlock() }

    private static func milliseconds(_ date: Date) throws -> Int64 {
        let seconds = date.timeIntervalSince1970
        guard seconds.isFinite, seconds >= 0, seconds < 253_402_300_800 else { throw MRMSContract.Failure.invalidTime }
        return Int64(floor(seconds * 1000))
    }

    static func listingURL(prefix: String, continuationToken: String?) throws -> URL {
        guard prefix.range(of: #"^CONUS/MergedReflectivityQCComposite_00\.50/[0-9]{8}/$"#,
                           options: .regularExpression) != nil,
              continuationToken.map({ !$0.isEmpty && $0.utf8.count <= 4096 && !$0.contains(where: { $0.isNewline }) }) ?? true else {
            throw MRMSContract.Failure.invalidListing
        }
        var components = URLComponents(url: MRMSContract.origin, resolvingAgainstBaseURL: false)!
        components.path = "/"
        components.queryItems = [URLQueryItem(name: "list-type", value: "2"), URLQueryItem(name: "max-keys", value: "1000"),
                                 URLQueryItem(name: "prefix", value: prefix)]
        if let continuationToken { components.queryItems!.append(.init(name: "continuation-token", value: continuationToken)) }
        guard let url = components.url else { throw MRMSContract.Failure.invalidListing }
        return url
    }

    struct ListingPage {
        let frames: [MRMSContract.AdvertisedFrame]
        let isTruncated: Bool
        let continuationToken: String?
    }

    static func parseListing(_ data: Data, expectedPrefix: String) throws -> ListingPage {
        try Task.checkCancellation()
        guard data.count <= 2 * 1024 * 1024, let xml = String(data: data, encoding: .utf8),
              !xml.localizedCaseInsensitiveContains("<!DOCTYPE"), !xml.localizedCaseInsensitiveContains("<!ENTITY") else {
            throw MRMSContract.Failure.invalidListing
        }
        let delegate = MRMSListingParser()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        let parsed = parser.parse()
        try Task.checkCancellation()
        guard parsed, !delegate.failed, delegate.stack.isEmpty,
              delegate.fields["Name"] == "noaa-mrms-pds", delegate.fields["Prefix"] == expectedPrefix,
              let countText = delegate.fields["KeyCount"], let count = Int(countText), count == delegate.entries.count,
              count <= 1000, let truncated = delegate.fields["IsTruncated"], ["true", "false"].contains(truncated) else {
            throw MRMSContract.Failure.invalidListing
        }
        let token = delegate.fields["NextContinuationToken"]
        guard truncated != "true" || (token.map { !$0.isEmpty && $0.utf8.count <= 4096 } ?? false) else {
            throw MRMSContract.Failure.invalidListing
        }
        var frames: [MRMSContract.AdvertisedFrame] = [], keys = Set<String>()
        for entry in delegate.entries {
            guard let key = entry["Key"], key.hasPrefix(expectedPrefix), keys.insert(key).inserted,
                  let sizeText = entry["Size"], let size = Int(sizeText), size > 0 else { throw MRMSContract.Failure.invalidListing }
            guard size <= MRMSContract.maximumDownloadBytes else { continue }
            frames.append(try MRMSContract.AdvertisedFrame(key: key, byteLength: size))
        }
        return ListingPage(frames: frames, isTruncated: truncated == "true", continuationToken: token)
    }

    /// Matches the browser adapter's earliest tie, always-retain-newest and even
    /// subsampling rules. Input is already filtered to non-future observations.
    static func selectFrames(_ frames: [MRMSContract.AdvertisedFrame], targets: [Int64], maximumFrames: Int,
                             toleranceMilliseconds: Int64) -> [MRMSContract.AdvertisedFrame] {
        guard maximumFrames > 0 else { return [] }
        let sorted = frames.sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
        var selected = sorted
        if !targets.isEmpty {
            var byKey: [String: MRMSContract.AdvertisedFrame] = [:]
            for target in targets {
                var nearest: MRMSContract.AdvertisedFrame?, delta = Int64.max
                for frame in sorted {
                    let subtraction = frame.validTimeMilliseconds >= target
                        ? frame.validTimeMilliseconds.subtractingReportingOverflow(target)
                        : target.subtractingReportingOverflow(frame.validTimeMilliseconds)
                    guard !subtraction.overflow else { continue }
                    let difference = subtraction.partialValue
                    if difference < delta { nearest = frame; delta = difference }
                }
                if let nearest, delta <= toleranceMilliseconds { byKey[nearest.key] = nearest }
            }
            if let newest = sorted.last { byKey[newest.key] = newest }
            selected = byKey.values.sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
        }
        guard selected.count > maximumFrames else { return selected }
        if maximumFrames == 1 { return [selected.last!] }
        return (0..<maximumFrames).map { index in
            selected[Int(floor(Double(index) * Double(selected.count - 1) / Double(maximumFrames - 1) + 0.5))]
        }
    }
}

/// Shares only immutable, validated public MRMS scan bytes. A pan changes the
/// decoded viewport, not the national source file. At most 32 MiB / 8 completed
/// scans and two in-flight scans (each <= 8 MiB) are retained in memory. Nothing
/// is persisted and no URLSession response, cookies or credentials are cached.
///
/// Every consumer still decodes and validates its advertised frame. This cache
/// grants no freshness: discovery and presentation retain their existing rules
/// for historical/stale/future observations. The key includes all advertised
/// identity fields, so a changed length/time cannot reuse the old source bytes.
actor MRMSScanCache {
    static let shared = MRMSScanCache()

    struct Key: Hashable, Sendable {
        let source: String
        let byteLength: Int
        let validTimeMilliseconds: Int64
        init(_ frame: MRMSContract.AdvertisedFrame) {
            source = frame.key
            byteLength = frame.byteLength
            validTimeMilliseconds = frame.validTimeMilliseconds
        }
    }
    struct Lease: Sendable {
        let data: Data
        fileprivate let key: Key
        fileprivate let flightID: UUID?
        fileprivate let consumerID: UUID
    }
    struct Snapshot: Sendable {
        let cachedBytes: Int
        let cachedScans: Int
        let inFlightScans: Int
        let consumers: Int
    }
    private struct Cached {
        let data: Data
        let storedAt: Date
        var access: UInt64
    }
    private struct Flight {
        let id: UUID
        let generation: UInt64
        var task: Task<Void, Never>?
        var waiters: [UUID: MRMSScanWaiter] = [:]
        var leases: Set<UUID> = []
        var data: Data?
    }

    private let maximumBytes: Int
    private let maximumScans: Int
    private let maximumAge: TimeInterval
    private var cached: [Key: Cached] = [:]
    private var flights: [Key: Flight] = [:]
    private var cachedBytes = 0
    private var access: UInt64 = 0
    private var generation: UInt64 = 0

    init(maximumBytes: Int = 32 * 1024 * 1024, maximumScans: Int = 8, maximumAge: TimeInterval = 15 * 60) {
        // Small limits can be injected in offline tests; production can never
        // accidentally request an unbounded cache through configuration.
        self.maximumBytes = min(32 * 1024 * 1024, max(0, maximumBytes))
        self.maximumScans = min(8, max(0, maximumScans))
        self.maximumAge = maximumAge.isFinite ? min(15 * 60, max(0, maximumAge)) : 0
    }

    func acquire(_ frame: MRMSContract.AdvertisedFrame,
                 load: @escaping @Sendable () async throws -> Data) async throws -> Lease {
        let key = Key(frame), consumerID = UUID(), waiter = MRMSScanWaiter()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                waiter.attach(continuation)
                guard !waiter.isFinished else { return }
                evictExpired()
                if var hit = cached[key] {
                    access &+= 1
                    hit.access = access
                    cached[key] = hit
                    waiter.finish(.success(.init(data: hit.data, key: key, flightID: nil, consumerID: consumerID)))
                    return
                }
                if var flight = flights[key] {
                    guard flight.waiters.count + flight.leases.count < 16 else {
                        waiter.finish(.failure(MRMSContract.Failure.requestLimit)); return
                    }
                    if let data = flight.data {
                        if waiter.finish(.success(.init(data: data, key: key, flightID: flight.id, consumerID: consumerID))) {
                            flight.leases.insert(consumerID)
                        }
                    } else {
                        flight.waiters[consumerID] = waiter
                    }
                    flights[key] = flight
                    return
                }
                guard flights.count < 2 else {
                    waiter.finish(.failure(MRMSContract.Failure.requestLimit)); return
                }
                let flightID = UUID()
                let task = Task.detached(priority: .userInitiated) { [self] in
                    let result: Result<Data, Error>
                    do {
                        let data = try await load()
                        try Task.checkCancellation()
                        guard data.count == key.byteLength else { throw MRMSContract.Failure.sizeLimit }
                        guard data.starts(with: [0x1f, 0x8b]) else { throw MRMSContract.Failure.invalidCompression }
                        result = .success(data)
                    } catch { result = .failure(error) }
                    await complete(key: key, flightID: flightID, result: result)
                }
                flights[key] = Flight(id: flightID, generation: generation, task: task, waiters: [consumerID: waiter])
            }
        }, onCancel: {
            // Do not wait for the shared request to finish to release a canceled
            // caller. Its cancellation cannot cancel another caller's scan.
            waiter.finish(.failure(CancellationError()))
            Task { await self.cancel(key: key, consumerID: consumerID) }
        })
    }

    func release(_ lease: Lease, validated: Bool) {
        guard var flight = flights[lease.key], flight.id == lease.flightID,
              flight.leases.remove(lease.consumerID) != nil else { return }
        if validated, flight.generation == generation, cached[lease.key] == nil, maximumScans > 0, maximumAge > 0,
           lease.data.count <= maximumBytes {
            evictExpired()
            while cached.count >= maximumScans || cachedBytes > maximumBytes - lease.data.count {
                guard let oldest = cached.min(by: { $0.value.access < $1.value.access })?.key else { break }
                remove(oldest)
            }
            access &+= 1
            cached[lease.key] = Cached(data: lease.data, storedAt: Date(), access: access)
            cachedBytes += lease.data.count
        }
        if flight.waiters.isEmpty && flight.leases.isEmpty { flights.removeValue(forKey: lease.key) }
        else { flights[lease.key] = flight }
    }

    /// Keep live consumers working, but do not repopulate retained storage with
    /// a download/validation that was already in flight at memory pressure.
    func removeAll() { generation &+= 1; cached.removeAll(); cachedBytes = 0 }

    func snapshot() -> Snapshot {
        evictExpired()
        return .init(cachedBytes: cachedBytes, cachedScans: cached.count, inFlightScans: flights.count,
                     consumers: flights.values.reduce(0) { $0 + $1.waiters.count + $1.leases.count })
    }

    private func complete(key: Key, flightID: UUID, result: Result<Data, Error>) {
        guard var flight = flights[key], flight.id == flightID else { return }
        flight.task = nil
        switch result {
        case .success(let data):
            flight.data = data
            for (consumerID, waiter) in flight.waiters {
                if waiter.finish(.success(.init(data: data, key: key, flightID: flightID, consumerID: consumerID))) {
                    flight.leases.insert(consumerID)
                }
            }
            flight.waiters.removeAll()
            if flight.leases.isEmpty { flights.removeValue(forKey: key) }
            else { flights[key] = flight }
        case .failure(let error):
            flights.removeValue(forKey: key)
            for waiter in flight.waiters.values { waiter.finish(.failure(error)) }
        }
    }

    private func cancel(key: Key, consumerID: UUID) {
        guard var flight = flights[key] else { return }
        flight.waiters.removeValue(forKey: consumerID)
        flight.leases.remove(consumerID)
        if flight.waiters.isEmpty && flight.leases.isEmpty {
            flights.removeValue(forKey: key)
            flight.task?.cancel()
        } else { flights[key] = flight }
    }

    private func evictExpired() {
        let now = Date()
        for (key, value) in cached where now.timeIntervalSince(value.storedAt) >= maximumAge || now < value.storedAt {
            remove(key)
        }
    }
    private func remove(_ key: Key) {
        if let value = cached.removeValue(forKey: key) { cachedBytes -= value.data.count }
    }
}

/// A cancellation may precede continuation installation or race with successful
/// completion. Locking the small per-consumer slot guarantees one resume only;
/// continuations are always resumed outside the lock.
private final class MRMSScanWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<MRMSScanCache.Lease, Error>?
    private var result: Result<MRMSScanCache.Lease, Error>?
    var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return result != nil }

    func attach(_ continuation: CheckedContinuation<MRMSScanCache.Lease, Error>) {
        lock.lock()
        if let result { lock.unlock(); continuation.resume(with: result) }
        else { self.continuation = continuation; lock.unlock() }
    }
    @discardableResult
    func finish(_ result: Result<MRMSScanCache.Lease, Error>) -> Bool {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return false }
        self.result = result
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
        return true
    }
}

private final class MRMSListingParser: NSObject, XMLParserDelegate {
    var stack: [String] = [], fields: [String: String] = [:], entries: [[String: String]] = []
    var failed = false
    private var current: [String: String]?, text = "", elementCount = 0
    private let rootFields: Set<String> = ["Name", "Prefix", "KeyCount", "IsTruncated", "NextContinuationToken"]
    private let objectFields: Set<String> = ["Key", "Size"]
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?,
                attributes attributeDict: [String: String]) {
        elementCount += 1
        guard stack.count < 8, elementCount <= 20_000,
              !stack.isEmpty || elementName == "ListBucketResult" else { fail(parser); return }
        if elementName == "Contents" {
            guard stack == ["ListBucketResult"], current == nil, entries.count < 1000 else { fail(parser); return }
            current = [:]
        }
        stack.append(elementName); text = ""
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard text.utf8.count + string.utf8.count <= 8192 else { fail(parser); return }
        text += string
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName: String?) {
        guard stack.last == elementName else { fail(parser); return }
        if stack.count == 2, rootFields.contains(elementName) {
            guard fields[elementName] == nil else { fail(parser); return }
            fields[elementName] = text
        } else if stack.count == 3, stack[1] == "Contents", objectFields.contains(elementName) {
            guard current?[elementName] == nil else { fail(parser); return }
            current?[elementName] = text
        } else if elementName == "Contents" {
            guard let current else { fail(parser); return }
            entries.append(current); self.current = nil
        }
        stack.removeLast(); text = ""
    }
    func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) { failed = true }
    func parser(_ parser: XMLParser, resolveExternalEntityName name: String, systemID: String?) -> Data? {
        fail(parser); return nil
    }
    private func fail(_ parser: XMLParser) { failed = true; parser.abortParsing() }
}
