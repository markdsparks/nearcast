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

    static func main() async throws {
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
        let client = try MRMSClient(configuration: config)
        for listing in fixture.listings { MockMRMSProtocol.store.set(listing.prefix, .init(data: Data(listing.xml.utf8))) }
        let history = try await client.listRecentFrames(now: date("2026-09-19T00:07:45Z"), historyMinutes: 20, maximumFrames: 3)
        precondition(history.map(\.key) == fixture.selectionCases[0].expectedKeys)
        // Unlike permissive browser discovery, future objects never become observations.
        let earlier = try await client.listRecentFrames(now: date("2026-09-19T00:03:00Z"), historyMinutes: 20, maximumFrames: 10)
        precondition(earlier.count == 3 && earlier.last!.observedAt == "2026-09-19T00:02:41.000Z")
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes))
        let loaded = try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64)
        precondition(digest(loaded.texture.bytes) == vector.textureSHA256)
        let loopingXML = listing.xml.replacingOccurrences(of: "<IsTruncated>false</IsTruncated>", with: "<IsTruncated>true</IsTruncated><NextContinuationToken>repeat</NextContinuationToken>")
        MockMRMSProtocol.store.set(listing.prefix, .init(data: Data(loopingXML.utf8)))
        do { _ = try await client.listRecentFrames(now: date("2026-09-19T00:07:45Z")); preconditionFailure("Looping listing accepted") }
        catch { precondition(error as? MRMSContract.Failure == .listingLimit) }
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes, hold: true))
        let initialRequests = MockMRMSProtocol.store.requestCount()
        let first = Task { try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64) }
        let second = Task { try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64) }
        for _ in 0..<200 where MockMRMSProtocol.store.requestCount() < initialRequests + 2 { try await Task.sleep(for: .milliseconds(5)) }
        precondition(MockMRMSProtocol.store.requestCount() == initialRequests + 2)
        do { _ = try await client.decodeFrame(frame, bounds: vector.bounds); preconditionFailure("Unbounded decode admission") }
        catch { precondition(error as? MRMSContract.Failure == .requestLimit) }
        first.cancel(); second.cancel()
        for task in [first, second] { do { _ = try await task.value; preconditionFailure("Held request did not cancel") } catch { } }
        MockMRMSProtocol.store.set("/" + frame.key, .init(data: bytes))
        _ = try await client.decodeFrame(frame, bounds: vector.bounds, width: 64, height: 64)
        print("PASS Native MRMS: exact browser viewport bytes, five PNG filters, both scan directions, Mercator alignment, missing-data mask, source/key time binding, malformed GRIB/PNG/gzip rejection, XML/URL limits, selection parity, future exclusion, bounded client and cancellation recovery")

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
