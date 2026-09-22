import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var instant: Date
    init(_ date: Date) { instant = date }
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return instant }
    func advance(_ seconds: TimeInterval) { lock.lock(); instant.addTimeInterval(seconds); lock.unlock() }
    func reset(_ date: Date) { lock.lock(); instant = date; lock.unlock() }
}

private final class TileProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var count = 0
    static func requests() -> Int { lock.lock(); defer { lock.unlock() }; return count }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.count += 1; Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "image/png", "Cache-Control": "public, max-age=3600"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
        client?.urlProtocol(self, didLoad: BasemapTileCacheTests.png)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main
enum BasemapTileCacheTests {
    static let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")!
    static func request(shard: String = "a", key: String = "fixture-key-never-persist-this", x: Int = 0) -> URLRequest {
        URLRequest(url: URL(string: "https://\(shard).basemaps.cartocdn.com/rastertiles/voyager_nolabels/8/\(x)/0.png?key=\(key)")!)
    }
    static func response(_ request: URLRequest, control: String = "public, max-age=600",
                         headers: [String: String] = [:], data: Data = png, status: Int = 200) -> CachedURLResponse {
        let all = ["Content-Type": "image/png", "Cache-Control": control].merging(headers, uniquingKeysWith: { _, new in new })
        return .init(response: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: all)!, data: data)
    }
    static func noisePNG() throws -> Data {
        let size = 480
        var bytes = [UInt8](repeating: 255, count: size * size * 4)
        var state: UInt32 = 0x12345678
        for i in bytes.indices {
            state ^= state << 13; state ^= state >> 17; state ^= state << 5
            bytes[i] = UInt8(truncatingIfNeeded: state)
        }
        let provider = CGDataProvider(data: Data(bytes) as CFData)!
        let image = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32,
            bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
            decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw URLError(.cannotDecodeContentData) }
        return data as Data
    }

    static func main() async throws {
        var failures: [String] = []
        func check(_ condition: @autoclosure () -> Bool, _ label: String) { if !condition() { failures.append(label) } }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("nearcast-basemap-cache-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        // File mtimes come from the real clock; keep the injected clock just
        // ahead so deterministic freshness tests don't treat a newly-written
        // fixture as a clock-rollback artifact a few microseconds in the future.
        let clock = TestClock(Date().addingTimeInterval(2))
        let cache = NativeBasemapTileCache(directory: temporary, clock: { clock.now() })
        let original = request()
        cache.storeCachedResponse(response(original), for: original)
        check(cache.cachedResponse(for: original)?.data == png, "direct cache hit")
        check(cache.cachedResponse(for: request(shard: "d"))?.data == png, "canonical CARTO shard hit")
        let reopened = NativeBasemapTileCache(directory: temporary, clock: { clock.now() })
        check(reopened.cachedResponse(for: original)?.data == png, "persistent reopen")
        let files = try FileManager.default.contentsOfDirectory(at: temporary, includingPropertiesForKeys: nil)
        let forbidden = ["fixture-key-never-persist-this", "basemaps.cartocdn.com", "https://", "Cookie", "Authorization"]
        for file in files {
            let data = try Data(contentsOf: file)
            for text in forbidden {
                check(!file.lastPathComponent.contains(text) && data.range(of: Data(text.utf8)) == nil, "opaque disk storage excludes credential/URL/header")
            }
            check(file.lastPathComponent == "credential.sha256" || file.lastPathComponent.range(of: #"^[a-f0-9]{64}\.tile$"#, options: .regularExpression) != nil, "opaque cache filename")
        }
        check(cache.cachedResponse(for: original)?.response.url == original.url, "returned response belongs to requested shard")
        check((cache.cachedResponse(for: original)?.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Set-Cookie") == nil, "returned headers redacted")
        clock.advance(601)
        check(cache.cachedResponse(for: original) == nil, "expiry removes stale hit")
        cache.removeAllCachedResponses()

        let denied = NativeBasemapTileCache(directory: nil)
        let unsafeURLs = [
            "https://getnearcast.app/api/map/config?key=fixture",
            "https://a.basemaps.cartocdn.com.attacker.test/rastertiles/voyager_nolabels/8/0/0.png?key=fixture",
            "http://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/8/0/0.png?key=fixture",
            "https://user:password@a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/8/0/0.png?key=fixture",
            "https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/8/0/0.png?key=fixture&token=other",
            "https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/8/0/0.png?key=fixture#fragment"
        ]
        for (index, string) in unsafeURLs.enumerated() {
            let r = URLRequest(url: URL(string: string)!)
            denied.storeCachedResponse(response(r), for: r)
            check(denied.cachedResponse(for: r) == nil, "unauthorized tile request rejected: \(index)")
        }
        var post = request(); post.httpMethod = "POST"
        denied.storeCachedResponse(response(post), for: post)
        check(denied.cachedResponse(for: post) == nil, "non-GET rejected")
        denied.storeCachedResponse(response(original, status: 404), for: original)
        check(denied.cachedResponse(for: original) == nil, "non-200 rejected")
        denied.storeCachedResponse(response(original, data: Data("not a png".utf8)), for: original)
        check(denied.cachedResponse(for: original) == nil, "non-PNG rejected")
        denied.storeCachedResponse(response(original, data: png + Data(repeating: 0, count: 1024 * 1024)), for: original)
        check(denied.cachedResponse(for: original) == nil, "oversized tile rejected")
        denied.storeCachedResponse(response(request(x: 99)), for: original)
        check(denied.cachedResponse(for: original) == nil, "response URL mismatch rejected")

        for (index, control) in ["no-store, max-age=600", "no-cache, max-age=600", "no-cache=\"Set-Cookie\", max-age=600", "max-age=0", "max-age=-1", "max-age=nan", "public"].enumerated() {
            let r = request(x: index + 1)
            cache.storeCachedResponse(response(r, control: control), for: r)
            check(cache.cachedResponse(for: r) == nil, "response freshness directive rejected: \(index)")
        }
        for (index, header) in [["Set-Cookie": "session=fixture-cookie"], ["Vary": "*"], ["Age": "600"], ["Age": "invalid"]].enumerated() {
            let r = request(x: index + 20)
            cache.storeCachedResponse(response(r, headers: header), for: r)
            check(cache.cachedResponse(for: r) == nil, "response cache restriction rejected: \(index)")
        }
        let aged = request(x: 30)
        cache.storeCachedResponse(response(aged, headers: ["Age": "590"]), for: aged)
        check(cache.cachedResponse(for: aged) != nil, "positive remaining Age lifetime")
        clock.advance(11)
        check(cache.cachedResponse(for: aged) == nil, "Age shortens freshness")
        let staleDate = request(x: 31)
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        cache.storeCachedResponse(response(staleDate, headers: ["Date": formatter.string(from: clock.now().addingTimeInterval(-3600))]), for: staleDate)
        check(cache.cachedResponse(for: staleDate) == nil, "HTTP Date apparent age respected")
        let capped = request(x: 32)
        cache.storeCachedResponse(response(capped, control: "max-age=2592000"), for: capped)
        clock.advance(86401)
        check(cache.cachedResponse(for: capped) == nil, "one-day retention cap")
        clock.reset(Date().addingTimeInterval(2))
        for (index, header) in [["Cookie": "session=fixture-cookie"], ["Authorization": "Bearer fixture-token"], ["Cache-Control": "no-store"], ["Cache-Control": "no-cache"], ["Cache-Control": "max-age=0"]].enumerated() {
            var r = request(x: 40 + index)
            for (key, value) in header { r.setValue(value, forHTTPHeaderField: key) }
            cache.storeCachedResponse(response(r), for: r)
            check(cache.cachedResponse(for: r) == nil, "request restriction rejected: \(index)")
        }
        let bypass = request(x: 50)
        cache.storeCachedResponse(response(bypass), for: bypass)
        var reloading = bypass; reloading.cachePolicy = .reloadIgnoringLocalCacheData
        check(cache.cachedResponse(for: reloading) == nil, "reload bypass")
        cache.removeCachedResponse(for: bypass)
        check(cache.cachedResponse(for: bypass) == nil, "request removal reaches custom store")

        let rotationA = request(x: 60)
        let rotationB = request(key: "second-fixture-key", x: 60)
        cache.storeCachedResponse(response(rotationA), for: rotationA)
        cache.activateCredential("second-fixture-key")
        cache.storeCachedResponse(response(rotationB), for: rotationB)
        check(cache.cachedResponse(for: rotationB)?.data == png, "new credential hit")
        cache.storeCachedResponse(response(rotationA), for: rotationA)
        check(cache.cachedResponse(for: rotationA) == nil, "late retired credential cannot reenter cache")
        check(cache.cachedResponse(for: rotationB)?.data == png, "late retired credential cannot purge current cache")
        let afterRotation = try FileManager.default.contentsOfDirectory(at: temporary, includingPropertiesForKeys: nil)
        check(afterRotation.filter { $0.pathExtension == "tile" }.count == 1, "credential rotation purges prior tiles")

        // URLSession's data-task entry points must forward to the custom store,
        // not URLCache's disabled backing store. They can be tested without I/O.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = cache; configuration.protocolClasses = [TileProtocol.self]
        configuration.requestCachePolicy = .useProtocolCachePolicy
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let taskRequest = request(key: "second-fixture-key", x: 61)
        let task = session.dataTask(with: taskRequest)
        cache.storeCachedResponse(response(taskRequest), for: task)
        let taskCached = await withCheckedContinuation { continuation in
            cache.getCachedResponse(for: task) { continuation.resume(returning: $0) }
        }
        check(taskCached?.data == png, "URLSession data-task store/lookup overrides")
        cache.removeCachedResponse(for: task)
        check(cache.cachedResponse(for: taskRequest) == nil, "URLSession data-task removal override")
        task.cancel()
        let networkRequest = request(key: "second-fixture-key", x: 62)
        let (download, _) = try await session.data(for: networkRequest)
        check(download == png && TileProtocol.requests() == 1, "mock URLSession tile acquisition")
        // Custom URLProtocol caching is not guaranteed by every Foundation
        // implementation; direct task APIs above are the deterministic gate.
        print("INFO mocked URLSession automatic cache retained: \(cache.cachedResponse(for: networkRequest) != nil)")

        // Small injected disk budget verifies the real serialized-file budget;
        // valid incompressible PNGs exercise the separate16-MiB memory bound.
        let limitDirectory = temporary.appendingPathComponent("bounded", isDirectory: true)
        let bounded = NativeBasemapTileCache(directory: limitDirectory, maximumBytes: 1024, clock: { clock.now() })
        for index in 0..<20 {
            let r = request(key: "bounded-fixture", x: index)
            bounded.storeCachedResponse(response(r), for: r)
        }
        let diskFiles = try FileManager.default.contentsOfDirectory(at: limitDirectory, includingPropertiesForKeys: [.fileSizeKey])
        let diskBytes = try diskFiles.filter { $0.pathExtension == "tile" }.reduce(0) { $0 + (try $1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
        check(diskBytes <= 1024, "serialized disk cost stays bounded")
        check(bounded.currentDiskUsage == diskBytes, "metadata index accounts for exact serialized file bytes")
        check(bounded.snapshot().directoryScans == 1, "tile writes do not rescan the cache directory")

        // Disk LRU must reflect reads, including memory hits. Reopen afterward
        // to distinguish actual persistent eviction from the separate memory
        // working set. Hits never rewrite file timestamps or enumerate files.
        let lruDirectory = temporary.appendingPathComponent("indexed-lru", isDirectory: true)
        let lru = NativeBasemapTileCache(directory: lruDirectory, maximumEntries: 3, clock: { clock.now() })
        for index in 0..<3 {
            let r = request(key: "lru-fixture", x: index)
            lru.storeCachedResponse(response(r), for: r)
        }
        let beforeHits = try FileManager.default.contentsOfDirectory(at: lruDirectory, includingPropertiesForKeys: [.contentModificationDateKey])
            .filter { $0.pathExtension == "tile" }
            .map { ($0, try $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) }
        let beforeHitBytes = lru.currentDiskUsage
        for _ in 0..<100 { _ = lru.cachedResponse(for: request(key: "lru-fixture", x: 0)) }
        check(lru.snapshot().directoryScans == 1 && lru.currentDiskUsage == beforeHitBytes, "repeated cache hits and usage checks do not scan disk")
        for (file, date) in beforeHits {
            let afterDate = try file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
            check(afterDate == date, "LRU read does not touch file modification time")
        }
        let fourth = request(key: "lru-fixture", x: 3)
        lru.storeCachedResponse(response(fourth), for: fourth)
        check(lru.snapshot().diskEntries == 3, "disk metadata entry count is bounded")
        let lruReopened = NativeBasemapTileCache(directory: lruDirectory, maximumEntries: 3, clock: { clock.now() })
        check(lruReopened.cachedResponse(for: request(key: "lru-fixture", x: 0)) != nil, "disk LRU retains recently read tile")
        check(lruReopened.cachedResponse(for: request(key: "lru-fixture", x: 1)) == nil, "disk LRU evicts least recently read tile")
        check(lruReopened.cachedResponse(for: request(key: "lru-fixture", x: 2)) != nil && lruReopened.cachedResponse(for: fourth) != nil, "disk LRU preserves unrelated retained tiles")
        clock.advance(601)
        let afterExpiry = request(key: "lru-fixture", x: 4)
        lru.storeCachedResponse(response(afterExpiry), for: afterExpiry)
        check(lru.snapshot().diskEntries == 1, "known HTTP expiry prunes index and files before another write")
        check(lru.snapshot().directoryScans == 1, "expiry pruning uses the metadata index")
        lru.removeCachedResponse(for: afterExpiry)
        check(lru.currentDiskUsage == 0 && lru.snapshot().diskEntries == 0, "per-request removal updates disk metadata accounting")
        clock.reset(Date().addingTimeInterval(2))

        // If the filesystem refuses eviction, do not deduct phantom free
        // space or spin. Keep serving memory and disable further disk writes.
        let lockedDirectory = temporary.appendingPathComponent("eviction-denied", isDirectory: true)
        let locked = NativeBasemapTileCache(directory: lockedDirectory, maximumEntries: 1, clock: { clock.now() })
        let heldTile = request(key: "locked-fixture", x: 1)
        locked.storeCachedResponse(response(heldTile), for: heldTile)
        let heldCost = locked.currentDiskUsage
        try FileManager.default.setAttributes([.posixPermissions: NSNumber(value: 0o555)], ofItemAtPath: lockedDirectory.path)
        let deniedReplacement = request(key: "locked-fixture", x: 2)
        locked.storeCachedResponse(response(deniedReplacement), for: deniedReplacement)
        // Restore permissions before assertions/cleanup, including failures.
        try FileManager.default.setAttributes([.posixPermissions: NSNumber(value: 0o755)], ofItemAtPath: lockedDirectory.path)
        check(!locked.snapshot().diskWritesEnabled, "failed eviction disables new disk writes")
        check(locked.currentDiskUsage == heldCost && locked.snapshot().diskEntries == 1, "failed eviction retains indexed byte cost")
        check(locked.cachedResponse(for: deniedReplacement)?.data == png, "failed disk eviction preserves memory fallback")
        let laterReplacement = request(key: "locked-fixture", x: 3)
        locked.storeCachedResponse(response(laterReplacement), for: laterReplacement)
        check(locked.currentDiskUsage == heldCost && locked.snapshot().diskEntries == 1, "disk writes remain fail-closed after eviction failure")
        let largePNG = try noisePNG()
        check(largePNG.count < 1024 * 1024, "large fixture is within permitted tile size")
        let memoryOnly = NativeBasemapTileCache(directory: nil)
        for index in 0..<24 {
            let r = request(x: index)
            memoryOnly.storeCachedResponse(response(r, data: largePNG), for: r)
        }
        check(memoryOnly.currentMemoryUsage > 0 && memoryOnly.currentMemoryUsage <= 16 * 1024 * 1024, "reported memory cost bounded16MiB")
        check(memoryOnly.cachedResponse(for: request(x: 0)) == nil, "memory LRU evicts old tile")
        check(memoryOnly.cachedResponse(for: request(x: 23))?.data == largePNG, "memory LRU retains newest tile")
        memoryOnly.removeAllCachedResponses()
        check(memoryOnly.currentMemoryUsage == 0, "memory-pressure purge releases cache")

        // Treat on-disk data as untrusted after process restart. An entry with
        // a valid filename but invalid bytes/lifetime never becomes an image.
        let corruptDirectory = temporary.appendingPathComponent("corrupt", isDirectory: true)
        let corruptRequest = request(key: "corrupt-fixture", x: 1)
        for (index, badBytes) in [Data("not an image".utf8), Data(repeating: 0, count: 1024 * 1024 + 1)].enumerated() {
            let writer = NativeBasemapTileCache(directory: corruptDirectory, clock: { clock.now() })
            writer.storeCachedResponse(response(corruptRequest), for: corruptRequest)
            let file = try FileManager.default.contentsOfDirectory(at: corruptDirectory, includingPropertiesForKeys: nil).first { $0.pathExtension == "tile" }!
            let corrupt = try PropertyListSerialization.data(fromPropertyList: ["bytes": badBytes,
                "stored": clock.now(), "expiry": clock.now().addingTimeInterval(300)], format: .binary, options: 0)
            try corrupt.write(to: file, options: .atomic)
            let reader = NativeBasemapTileCache(directory: corruptDirectory, clock: { clock.now() })
            check(reader.cachedResponse(for: corruptRequest) == nil, "corrupt disk entry rejected: \(index)")
        }
        // Even a caller asking for an unlimited disk cache cannot exceed the
        // production96-MiB ceiling; no actual network or credentials are used.
        let cappedDirectory = temporary.appendingPathComponent("hard-cap", isDirectory: true)
        let hardCap = NativeBasemapTileCache(directory: cappedDirectory, maximumBytes: Int.max)
        for index in 0..<112 {
            let r = request(key: "cap-fixture", x: index)
            hardCap.storeCachedResponse(response(r, data: largePNG), for: r)
        }
        check(hardCap.currentDiskUsage > 90 * 1024 * 1024 && hardCap.currentDiskUsage <= 96 * 1024 * 1024, "production96-MiB disk ceiling cannot be enlarged")
        hardCap.removeCachedResponses(since: .distantPast)
        check(hardCap.currentDiskUsage == 0 && hardCap.currentMemoryUsage == 0, "platform time-based removal purges custom storage")
        if failures.isEmpty {
            print("PASS Native basemap tile cache: redacted persistence, canonical shards, reopening, HTTP freshness/restrictions, rotation cleanup, request/task APIs, mocked acquisition and bounded retention")
        } else {
            for failure in failures { print("FAIL " + failure) }
            exit(1)
        }
    }
}
