import Foundation
import CryptoKit
import zlib

private struct Fixture: Decodable {
    struct Vector: Decodable {
        struct Encoding: Decodable { let dbzMin: Double, dbzMax: Double, threshold: Double }
        let name: String, key: String, gzipBase64: String, gribBase64: String, textureSHA256: String
        let bounds: RadarChunkContract.Bounds, encoding: Encoding
        let width: Int, height: Int, precipitationPixels: Int, sourceRowsReconstructed: Int
    }
    struct Listing: Decodable { let prefix: String, xml: String }
    struct Selection: Decodable { let name: String, maximumFrames: Int, targetTimes: [String], expectedKeys: [String] }
    struct Malformed: Decodable { let name: String, failure: String, gzipBase64: String }
    let vectors: [Vector], listings: [Listing], selectionCases: [Selection], malformed: [Malformed]
    let gribExpansionBombBase64: String
}
private struct MockReply: Sendable { let data: Data; var hold = false }
private final class MockStore: @unchecked Sendable {
    private let lock = NSLock()
    private var replies: [String: MockReply] = [:]
    private var starts = 0
    func set(_ key: String, _ reply: MockReply) { lock.lock(); replies[key] = reply; lock.unlock() }
    func reply(_ key: String) -> MockReply? { lock.lock(); defer { lock.unlock() }; starts += 1; return replies[key] }
    func requestCount() -> Int { lock.lock(); defer { lock.unlock() }; return starts }
}
private final class MockMRMSProtocol: URLProtocol, @unchecked Sendable {
    static let store = MockStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, url.host == "noaa-mrms-pds.s3.amazonaws.com",
              request.value(forHTTPHeaderField: "Authorization") == nil,
              request.value(forHTTPHeaderField: "Cookie") == nil else { preconditionFailure("Unexpected provider/credentials") }
        let key = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "prefix" })?.value ?? url.path
        guard let reply = Self.store.reply(key) else { client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)); return }
        if reply.hold { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Length": String(reply.data.count)])!, cacheStoragePolicy: .notAllowed)
        let middle = reply.data.count / 2
        client?.urlProtocol(self, didLoad: reply.data.prefix(middle))
        client?.urlProtocol(self, didLoad: reply.data.suffix(from: middle))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

/// Offline controllable transport for cache concurrency/cancellation tests. Real
/// GRIB validation remains covered by the client/URLProtocol integration above.
private actor MockScanTransport {
    private var pending: [UUID: CheckedContinuation<Data, Error>] = [:]
    private(set) var starts = 0
    private(set) var cancellations = 0
    func fetch() async throws -> Data {
        starts += 1
        let id = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { pending[id] = $0 }
        }, onCancel: { Task { await self.cancel(id) } })
    }
    func resolve(_ result: Result<Data, Error>) {
        let waiters = Array(pending.values)
        pending.removeAll()
        for waiter in waiters { waiter.resume(with: result) }
    }
    private func cancel(_ id: UUID) {
        if let waiter = pending.removeValue(forKey: id) {
            cancellations += 1
            waiter.resume(throwing: CancellationError())
        }
    }
}

@main
enum MRMSTests {
    static func digest(_ bytes: [UInt8]) -> String { SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined() }
    static func rejects(_ failure: MRMSContract.Failure, _ action: () throws -> Void) {
        do { try action(); preconditionFailure("Expected \(failure)") }
        catch { precondition(error as? MRMSContract.Failure == failure, "Expected \(failure), got \(error)") }
    }
    static func gzip(_ data: Data) -> Data {
        var stream = z_stream()
        precondition(deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, MAX_WBITS + 16, 8,
                                  Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK)
        defer { deflateEnd(&stream) }
        return data.withUnsafeBytes { input in
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: input.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uInt(input.count)
            var result = Data(), buffer = [UInt8](repeating: 0, count: 16_384)
            while true {
                let status = buffer.withUnsafeMutableBytes { output in
                    stream.next_out = output.bindMemory(to: Bytef.self).baseAddress; stream.avail_out = uInt(output.count)
                    return deflate(&stream, Z_FINISH)
                }
                result.append(contentsOf: buffer.prefix(buffer.count - Int(stream.avail_out)))
                if status == Z_STREAM_END { return result }
                precondition(status == Z_OK)
            }
        }
    }
    static func date(_ string: String) throws -> Date {
        Date(timeIntervalSince1970: Double(try RadarNumericContract.parseTime(string)) / 1000)
    }

    static func waitFor(_ condition: @escaping @Sendable () async -> Bool) async throws {
        for _ in 0..<200 {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        preconditionFailure("Timed out waiting for offline cache test")
    }

    static func cacheTests() async throws {
        func check(_ value: Bool, _ message: String = "Cache invariant failed") { precondition(value, message) }
        func frame(_ minute: Int, count: Int = 32) throws -> MRMSContract.AdvertisedFrame {
            try .init(key: String(format: "CONUS/MergedReflectivityQCComposite_00.50/20260919/MRMS_MergedReflectivityQCComposite_00.50_20260919-00%02d41.grib2.gz", minute), byteLength: count)
        }
        let a = try frame(0), b = try frame(2), c = try frame(4)
        let bytes = Data([0x1f, 0x8b] + [UInt8](repeating: 7, count: 30))
        let cache = MRMSScanCache(maximumBytes: 64, maximumScans: 2)
        let transport = MockScanTransport()
        let first = Task { try await cache.acquire(a) { try await transport.fetch() } }
        let second = Task { try await cache.acquire(a) { try await transport.fetch() } }
        try await waitFor {
            let snapshot = await cache.snapshot(), starts = await transport.starts
            return snapshot.consumers == 2 && starts == 1
        }
        first.cancel()
        do { _ = try await first.value; preconditionFailure("Canceled coalesced consumer succeeded") } catch is CancellationError { }
        check(await transport.cancellations == 0, "Canceling one consumer canceled the shared source")
        await transport.resolve(.success(bytes))
        let retained = try await second.value
        precondition(retained.data == bytes)
        // Until a consumer validates the GRIB, there are no completed cache hits.
        check(await cache.snapshot().cachedScans == 0)
        await cache.release(retained, validated: true)
        let hit = try await cache.acquire(a) { preconditionFailure("Validated scan downloaded twice") }
        precondition(hit.data == bytes)
        await cache.release(hit, validated: true)
        check(await cache.snapshot().inFlightScans == 0)

        let abandoned = Task { try await cache.acquire(b) { try await transport.fetch() } }
        try await waitFor { await transport.starts == 2 }
        abandoned.cancel()
        do { _ = try await abandoned.value; preconditionFailure("Last consumer failed to cancel") } catch is CancellationError { }
        try await waitFor {
            let snapshot = await cache.snapshot(), cancellations = await transport.cancellations
            return snapshot.inFlightScans == 0 && cancellations == 1
        }
        let retry = Task { try await cache.acquire(b) { try await transport.fetch() } }
        try await waitFor { await transport.starts == 3 }
        await transport.resolve(.success(bytes))
        let retryLease = try await retry.value
        await cache.release(retryLease, validated: false)
        let beforeRetry = await transport.starts
        let failedDecodeRetry = try await cache.acquire(b) { bytes }
        await cache.release(failedDecodeRetry, validated: false)
        check(await cache.snapshot().cachedScans == 1, "Failed decode cached an unvalidated source")
        check(await transport.starts == beforeRetry)

        // A failed transfer, short body, or non-gzip body can never be retained.
        do {
            _ = try await cache.acquire(b) { throw RadarChunkContract.Failure.transport }
            preconditionFailure("Failed transfer succeeded")
        } catch RadarChunkContract.Failure.transport { }
        do {
            _ = try await cache.acquire(b) { bytes.dropLast() }
            preconditionFailure("Partial transfer succeeded")
        } catch MRMSContract.Failure.sizeLimit { }
        do {
            _ = try await cache.acquire(b) { Data(repeating: 0, count: 32) }
            preconditionFailure("Non-gzip transfer succeeded")
        } catch MRMSContract.Failure.invalidCompression { }
        check(await cache.snapshot().inFlightScans == 0)

        // LRU and exact advertised-size identity, without any credentials or a
        // generic URL cache. Marking validated is the MRMSClient's responsibility.
        let bLease = try await cache.acquire(b) { bytes }; await cache.release(bLease, validated: true)
        _ = try await cache.acquire(a) { preconditionFailure("Expected a cache hit") }
        let cLease = try await cache.acquire(c) { bytes }; await cache.release(cLease, validated: true)
        let full = await cache.snapshot()
        precondition(full.cachedBytes == 64 && full.cachedScans == 2)
        _ = try await cache.acquire(a) { preconditionFailure("LRU evicted recently accessed scan") }
        let bAgain = try await cache.acquire(b) { bytes }; await cache.release(bAgain, validated: false)
        let changed = try frame(0, count: 33), changedBytes = bytes + Data([1])
        let changedLease = try await cache.acquire(changed) { changedBytes }
        precondition(changedLease.data.count == 33, "Changed descriptor reused another byte length")
        await cache.release(changedLease, validated: true)
        check(await cache.snapshot().cachedBytes <= 64)

        // Resource caps apply to pending source work as well as completed scans.
        await cache.removeAll()
        let heldA = Task { try await cache.acquire(a) { try await transport.fetch() } }
        let heldB = Task { try await cache.acquire(b) { try await transport.fetch() } }
        try await waitFor { await cache.snapshot().inFlightScans == 2 }
        do {
            _ = try await cache.acquire(c) { bytes }
            preconditionFailure("Unbounded source downloads")
        } catch MRMSContract.Failure.requestLimit { }
        heldA.cancel(); heldB.cancel()
        for task in [heldA, heldB] { do { _ = try await task.value; preconditionFailure("Canceled held source succeeded") } catch is CancellationError { } }
        try await waitFor { await cache.snapshot().inFlightScans == 0 }
        for _ in 0..<20 {
            let task = Task { try await cache.acquire(a) { try await transport.fetch() } }
            task.cancel()
            do { _ = try await task.value; preconditionFailure("Immediate cancellation ignored") } catch is CancellationError { }
        }
        try await waitFor { await cache.snapshot().inFlightScans == 0 }

        let pressure = MRMSScanCache()
        let beforePressure = await transport.starts
        let pressureTask = Task { try await pressure.acquire(a) { try await transport.fetch() } }
        try await waitFor { await transport.starts == beforePressure + 1 }
        await pressure.removeAll()
        await transport.resolve(.success(bytes))
        let lateLease = try await pressureTask.value
        await pressure.release(lateLease, validated: true)
        check(await pressure.snapshot().cachedScans == 0, "Pre-pressure work repopulated the MRMS cache")
        let postPressure = try await pressure.acquire(a) { bytes }
        await pressure.release(postPressure, validated: true)
        check(await pressure.snapshot().cachedScans == 1, "Post-pressure work failed to cache")

        let expiring = MRMSScanCache(maximumAge: 0.02)
        let expiringLease = try await expiring.acquire(a) { bytes }
        await expiring.release(expiringLease, validated: true)
        try await Task.sleep(for: .milliseconds(30))
        check(await expiring.snapshot().cachedScans == 0, "Expired source retained")
        let disabled = MRMSScanCache(maximumBytes: 0)
        let uncached = try await disabled.acquire(a) { bytes }; await disabled.release(uncached, validated: true)
        check(await disabled.snapshot().cachedBytes == 0)
        print("PASS MRMS source cache: coalesced acquisition, independent cancellation, last-consumer cancellation/retry, validated-only retention, short/failed transfers, advertised identity, LRU byte/count caps, bounded pending work and expiry")
    }

    static func main() async throws {
        try await cacheTests()
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("scripts/fixtures/native-radar/mrms-contract.json")))
        for vector in fixture.vectors {
            let data = Data(base64Encoded: vector.gzipBase64)!
            let frame = try MRMSContract.AdvertisedFrame(key: vector.key, byteLength: data.count)
            let result = try MRMSContract.decode(data, frame: frame, bounds: vector.bounds, width: vector.width, height: vector.height,
                                                encoding: .init(dbzMin: vector.encoding.dbzMin, dbzMax: vector.encoding.dbzMax, threshold: vector.encoding.threshold))
            precondition(digest(result.texture.bytes) == vector.textureSHA256, "\(vector.name) pixel mismatch")
            precondition(result.sourceRowsReconstructed == vector.sourceRowsReconstructed)
            precondition(result.precipitationPixelCount == vector.precipitationPixels)
            precondition(result.texture.bytes.count == result.validDataMask.count)
            precondition(result.validPixelCount == result.validDataMask.filter { $0 == 1 }.count)
            precondition(zip(result.texture.bytes, result.validDataMask).allSatisfy { $0 == 0 || $1 == 1 })
            precondition(result.validPixelCount > result.precipitationPixelCount && result.hasCoverage)
            let expectedTime = try RadarNumericContract.parseTime("2026-09-19T00:06:41Z")
            precondition(result.frame.validTimeMilliseconds == expectedTime)
            precondition(result.sourceProvider == "noaa-mrms-direct")
        }
        let vector = fixture.vectors[0], bytes = Data(base64Encoded: vector.gzipBase64)!, raw = Data(base64Encoded: vector.gribBase64)!
        let frame = try MRMSContract.AdvertisedFrame(key: vector.key, byteLength: bytes.count)
        func decode(_ data: Data) throws {
            _ = try MRMSContract.decode(data, frame: .init(key: vector.key, byteLength: data.count), bounds: vector.bounds, width: 64, height: 64)
        }
        func mutate(_ offset: Int, _ value: UInt8) -> Data { var modified = raw; modified[offset] = value; return gzip(modified) }
        var section: [Int: Int] = [:], offset = 16
        func u32(_ b: Data, _ i: Int) -> Int { Int(b[i]) << 24 | Int(b[i+1]) << 16 | Int(b[i+2]) << 8 | Int(b[i+3]) }
        while offset < raw.count - 4 { section[Int(raw[offset + 4])] = offset; offset += u32(raw, offset) }
        rejects(.invalidGRIB) { try decode(mutate(0, 0)) }
        rejects(.invalidGRIB) { try decode(mutate(7, 1)) }
        rejects(.invalidGRIB) { try decode(mutate(15, 0)) }
        rejects(.invalidGRIB) { try decode(mutate(raw.count - 1, 0)) }
        rejects(.invalidGRIB) { try decode(mutate(section[6]! + 5, 0)) }
        rejects(.invalidGRIB) { try decode(mutate(section[4]! + 4, 3)) }
        rejects(.metadataMismatch) { try decode(mutate(section[1]! + 18, 42)) }
        rejects(.unsupportedProduct) { try decode(mutate(section[4]! + 10, 1)) }
        rejects(.unsupportedProduct) { try decode(mutate(section[4]! + 21, 1)) }
        rejects(.unsupportedGrid) { try decode(mutate(section[3]! + 13, 1)) }
        rejects(.unsupportedGrid) { try decode(mutate(section[3]! + 71, 0x20)) }
        rejects(.unsupportedGrid) { try decode(mutate(section[3]! + 30, 0xff)) }
        rejects(.unsupportedGrid) { try decode(mutate(section[3]! + 6, 1)) }
        rejects(.unsupportedGrid) { try decode(mutate(section[3]! + 63, 1)) }
        rejects(.unsupportedPacking) { try decode(mutate(section[5]! + 10, 0)) }
        rejects(.unsupportedPacking) { try decode(mutate(section[5]! + 19, 8)) }
        rejects(.unsupportedPacking) { try decode(mutate(section[5]! + 15, 0x80)) }
        rejects(.invalidPNG) { try decode(mutate(section[7]! + 5, 0)) }
        rejects(.invalidChecksum) { try decode(mutate(section[7]! + 5 + 29, 1)) }
        rejects(.invalidCompression) { try decode(bytes.dropLast()) }
        rejects(.invalidCompression) { try decode(bytes + bytes) }
        var badCRC = bytes; badCRC[badCRC.count - 8] ^= 1
        rejects(.invalidCompression) { try decode(badCRC) }
        rejects(.invalidCompression) { try decode(raw) }
        rejects(.sizeLimit) { try decode(Data(base64Encoded: fixture.gribExpansionBombBase64)!) }
        let failures: [String: MRMSContract.Failure] = ["invalidPNG": .invalidPNG, "unsupportedPNG": .unsupportedPNG,
            "sizeLimit": .sizeLimit, "invalidCompression": .invalidCompression]
        for malformed in fixture.malformed { rejects(failures[malformed.failure]!) { try decode(Data(base64Encoded: malformed.gzipBase64)!) } }
        rejects(.sizeLimit) { _ = try MRMSContract.decode(bytes.dropLast(), frame: frame, bounds: vector.bounds) }
        rejects(.invalidOptions) { _ = try MRMSContract.decode(bytes, frame: frame, bounds: vector.bounds, width: Int.max) }
        rejects(.invalidSource) { _ = try MRMSContract.AdvertisedFrame(key: "https://other.test/" + vector.key, byteLength: bytes.count) }
        rejects(.invalidSource) { _ = try MRMSContract.AdvertisedFrame(key: vector.key.replacingOccurrences(of: "/20260919/", with: "/20260918/"), byteLength: bytes.count) }
        rejects(.invalidTime) { _ = try MRMSContract.AdvertisedFrame(key: vector.key.replacingOccurrences(of: "-000641", with: "-250641"), byteLength: bytes.count) }
        let empty = try MRMSContract.decode(bytes, frame: frame, bounds: .init(minLat: 4, minLon: 10, maxLat: 5, maxLon: 11), width: 64, height: 64)
        precondition(!empty.hasCoverage && empty.sourceRowsReconstructed == 0 && empty.validDataMask.allSatisfy { $0 == 0 })
        let cancelled = Task.detached { try MRMSContract.decode(bytes, frame: frame, bounds: vector.bounds, width: 64, height: 64) }
        cancelled.cancel()
        do { _ = try await cancelled.value; preconditionFailure("Cancellation ignored") } catch is CancellationError { }

        let allFrames = try fixture.listings.flatMap { try MRMSClient.parseListing(Data($0.xml.utf8), expectedPrefix: $0.prefix).frames }
        precondition(allFrames.count == 5)
        for selection in fixture.selectionCases {
            let targets = try selection.targetTimes.map(RadarNumericContract.parseTime)
            let frames = MRMSClient.selectFrames(allFrames, targets: targets, maximumFrames: selection.maximumFrames, toleranceMilliseconds: 360_000)
            precondition(frames.map(\.key) == selection.expectedKeys, selection.name)
        }
        let listing = fixture.listings[1]
        for xml in [listing.xml.replacingOccurrences(of: "<KeyCount>4", with: "<KeyCount>3"),
                    listing.xml.replacingOccurrences(of: "<IsTruncated>false", with: "<IsTruncated>true"),
                    listing.xml.replacingOccurrences(of: "noaa-mrms-pds", with: "other-bucket"),
                    listing.xml.replacingOccurrences(of: "<Size>1024", with: "<Size>-1"),
                    listing.xml.replacingOccurrences(of: "<KeyCount>", with: "<Name>duplicate</Name><KeyCount>"),
                    listing.xml.replacingOccurrences(of: "<?xml version=\"1.0\"?>", with: "<!DOCTYPE x [<!ENTITY secret SYSTEM 'file:///etc/passwd'>]>"),
                    String(listing.xml.dropLast(20))] {
            rejects(.invalidListing) { _ = try MRMSClient.parseListing(Data(xml.utf8), expectedPrefix: listing.prefix) }
        }
        let url = try MRMSClient.listingURL(prefix: listing.prefix, continuationToken: "a+b/c==")
        precondition(URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.last!.value == "a+b/c==")
        rejects(.invalidListing) { _ = try MRMSClient.listingURL(prefix: "../other", continuationToken: nil) }

        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MockMRMSProtocol.self]
        config.httpAdditionalHeaders = ["Authorization": "test-only-must-be-removed", "Cookie": "test-only-must-be-removed"]
        let scanCache = MRMSScanCache()
        let client = try MRMSClient(configuration: config, scanCache: scanCache)
        for listing in fixture.listings { MockMRMSProtocol.store.set(listing.prefix, .init(data: Data(listing.xml.utf8))) }
        let history = try await client.listRecentFrames(now: date("2026-09-19T00:07:45Z"), historyMinutes: 20, maximumFrames: 3)
        precondition(history.map(\.key) == fixture.selectionCases[0].expectedKeys)
        // Unlike permissive browser discovery, future objects never become observations.
        let earlier = try await client.listRecentFrames(now: date("2026-09-19T00:03:00Z"), historyMinutes: 20, maximumFrames: 10)
        precondition(earlier.count == 3 && earlier.last!.observedAt == "2026-09-19T00:02:41.000Z")
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes))
        let loaded = try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64)
        precondition(digest(loaded.texture.bytes) == vector.textureSHA256)
        let afterFirstViewport = MockMRMSProtocol.store.requestCount()
        let anotherClient = try MRMSClient(configuration: config, scanCache: scanCache)
        _ = try await anotherClient.decodeFrame(frame, bounds: vector.bounds, width: 128, height: 128)
        precondition(MockMRMSProtocol.store.requestCount() == afterFirstViewport, "A second viewport/client redownloaded the same national scan")
        let invalidCache = MRMSScanCache()
        let invalidClient = try MRMSClient(configuration: config, scanCache: invalidCache)
        let beforeInvalid = MockMRMSProtocol.store.requestCount()
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: badCRC))
        for _ in 0..<2 {
            do {
                _ = try await invalidClient.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64)
                preconditionFailure("Invalid compressed scan decoded")
            } catch MRMSContract.Failure.invalidCompression { }
        }
        let invalidSnapshot = await invalidCache.snapshot()
        precondition(invalidSnapshot.cachedBytes == 0 && invalidSnapshot.inFlightScans == 0)
        precondition(MockMRMSProtocol.store.requestCount() == beforeInvalid + 2, "Failed decoding source entered the cache")
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes))
        let loopingXML = listing.xml.replacingOccurrences(of: "<IsTruncated>false</IsTruncated>", with: "<IsTruncated>true</IsTruncated><NextContinuationToken>repeat</NextContinuationToken>")
        MockMRMSProtocol.store.set(listing.prefix, .init(data: Data(loopingXML.utf8)))
        do { _ = try await client.listRecentFrames(now: date("2026-09-19T00:07:45Z")); preconditionFailure("Looping listing accepted") }
        catch { precondition(error as? MRMSContract.Failure == .listingLimit) }
        await scanCache.removeAll()
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes, hold: true))
        let initialRequests = MockMRMSProtocol.store.requestCount()
        let first = Task { try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64) }
        let second = Task { try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64) }
        for _ in 0..<200 {
            if await scanCache.snapshot().consumers == 2 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        precondition(MockMRMSProtocol.store.requestCount() == initialRequests + 1, "Concurrent viewports did not coalesce")
        do { _ = try await client.decodeFrame(frame, bounds: vector.bounds); preconditionFailure("Unbounded decode admission") }
        catch { precondition(error as? MRMSContract.Failure == .requestLimit) }
        first.cancel(); second.cancel()
        for task in [first, second] { do { _ = try await task.value; preconditionFailure("Held request did not cancel") } catch { } }
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes))
        _ = try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64)

        // The new frame scheduler can hold both source slots while refreshing
        // discovery. Metadata has an independent bounded transport lane.
        let isolatedClient = try MRMSClient(configuration: config, scanCache: MRMSScanCache())
        let otherFrame = allFrames.first(where: { $0.key != frame.key })!
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes, hold: true))
        MockMRMSProtocol.store.set("/" + otherFrame.key, .init(data: Data(), hold: true))
        for listing in fixture.listings { MockMRMSProtocol.store.set(listing.prefix, .init(data: Data(listing.xml.utf8))) }
        let beforeTwo = MockMRMSProtocol.store.requestCount()
        let download1 = Task { try await isolatedClient.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64) }
        let download2 = Task { try await isolatedClient.decodeFrame(otherFrame, bounds: vector.bounds, width: 64, height: 64) }
        try await waitFor { MockMRMSProtocol.store.requestCount() == beforeTwo + 2 }
        let whileBusy = try await isolatedClient.listRecentFrames(now: date("2026-09-19T00:07:45Z"), historyMinutes: 20, maximumFrames: 3)
        precondition(whileBusy.map(\.key) == fixture.selectionCases[0].expectedKeys, "Two frame transfers blocked listing refresh")
        download1.cancel(); download2.cancel()
        for task in [download1, download2] {
            do { _ = try await task.value; preconditionFailure("Held isolated download ignored cancellation") } catch is CancellationError { }
        }
        print("PASS Native MRMS: exact browser viewport bytes, five PNG filters, both scan directions, Mercator alignment, missing-data mask, source/key time binding, malformed GRIB/PNG/gzip rejection, XML/URL limits, selection parity, future exclusion, bounded client, shared viewport downloads and cancellation recovery")

        if CommandLine.arguments.contains("--live") {
            let client = try MRMSClient()
            let frames = try await client.listRecentFrames(historyMinutes: 30, maximumFrames: 2)
            guard let latest = frames.last else { preconditionFailure("No current public MRMS frame available") }
            let bounds = CommandLine.arguments.contains("--live-national")
                ? RadarChunkContract.Bounds(minLat: 20, minLon: -130, maxLat: 55, maxLon: -60)
                : RadarChunkContract.Bounds(minLat: 38.35, minLon: -90.65, maxLat: 39.25, maxLon: -89.25)
            let viewport = try await client.decodeFrame(latest, bounds: bounds, width: 320, height: 200)
            precondition(viewport.texture.bytes.count == 64_000 && viewport.hasCoverage)
            let result: [String: Any] = ["liveKey": latest.key, "observedAt": latest.observedAt, "textureSHA256": digest(viewport.texture.bytes),
                "grid": "\(viewport.grid.width)x\(viewport.grid.height)", "validPixels": viewport.validPixelCount,
                "precipitationPixels": viewport.precipitationPixelCount, "sourceRowsReconstructed": viewport.sourceRowsReconstructed]
            print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
        } else { print("No live provider requests. Synthetic fixtures are not live weather.") }
    }
}
