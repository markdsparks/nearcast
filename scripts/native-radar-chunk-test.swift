import Foundation
import CryptoKit

private typealias Contract = RadarChunkContract
private struct MockReply: Sendable {
    let data: Data
    var status = 200
    var declaredLength: Int?
    var hold = false
}
private final class MockStore: @unchecked Sendable {
    private let lock = NSLock()
    private var replies: [String: MockReply] = [:]
    private var starts: Set<String> = []
    func set(_ path: String, _ reply: MockReply) { lock.lock(); replies[path] = reply; lock.unlock() }
    func start(_ path: String) -> MockReply? {
        lock.lock(); defer { lock.unlock() }; starts.insert(path); return replies[path]
    }
    func started(_ path: String) -> Bool { lock.lock(); defer { lock.unlock() }; return starts.contains(path) }
}
private final class MockRadarProtocol: URLProtocol, @unchecked Sendable {
    static let store = MockStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let reply = Self.store.start(url.path) else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)); return
        }
        if reply.hold { return }
        var headers: [String: String] = [:]
        if let length = reply.declaredLength { headers["Content-Length"] = String(length) }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        let middle = reply.data.count / 2
        client?.urlProtocol(self, didLoad: reply.data.prefix(middle))
        client?.urlProtocol(self, didLoad: reply.data.suffix(from: middle))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main
enum RadarChunkTests {
    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("scripts/fixtures/native-radar/chunk-contract.json"))) as! [String: Any]
        func json(_ object: Any) throws -> Data { try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) }
        func digest(_ bytes: [UInt8]) -> String { SHA256.hash(data: Data(bytes)).map { String(format: "%02x", $0) }.joined() }
        func rejects(_ failure: Contract.Failure, _ action: () throws -> Void) {
            do { try action(); preconditionFailure("Expected \(failure)") }
            catch { precondition((error as? Contract.Failure) == failure, "Expected \(failure), got \(error)") }
        }
        let vectors = fixture["vectors"] as! [[String: Any]]
        for item in vectors {
            let manifest = try Contract.decodeManifest(json(item["manifest"]!))
            let bytes = Data(base64Encoded: item["bytesBase64"] as! String)!
            let decoded = try Contract.decodeChunk(bytes, descriptor: manifest.descriptors[0], manifest: manifest)
            precondition(digest(decoded.texture.bytes) == item["payloadSHA256"] as! String)
            precondition(decoded.identity.kind.rawValue == item["kind"] as! String)
            precondition(decoded.identity.sourceValidTime == item["validTime"] as! String)
            precondition(decoded.timeBinding == .embeddedAndManifest)
            precondition(decoded.texture.width == 16 && decoded.texture.height == 16)
        }
        for item in fixture["legacy"] as! [[String: Any]] {
            let manifest = try Contract.decodeManifest(Data(contentsOf: root.appendingPathComponent(item["indexPath"] as! String)))
            let bytes = try Data(contentsOf: root.appendingPathComponent(item["chunkPath"] as! String))
            let decoded = try Contract.decodeChunk(bytes, descriptor: manifest.descriptors[0], manifest: manifest)
            precondition(digest(decoded.texture.bytes) == item["payloadSHA256"] as! String)
            precondition(decoded.identity.kind.rawValue == item["kind"] as! String)
            precondition(decoded.identity.sourceValidTime == item["validTime"] as! String)
            precondition(decoded.timeBinding == .manifestOnly)
            precondition(decoded.texture.width == 256 && decoded.texture.height == 256)
        }
        let originalJSON = vectors[0]["manifest"] as! [String: Any]
        let manifest = try Contract.decodeManifest(json(originalJSON))
        let originalBytes = Data(base64Encoded: vectors[0]["bytesBase64"] as! String)!
        func decodeAltered(_ bytes: Data) throws {
            let d = manifest.descriptors[0]
            let resized = Contract.Descriptor(zoom: d.zoom, x: d.x, y: d.y, chunkSize: d.chunkSize, path: d.path, byteLength: bytes.count, bounds: d.bounds)
            let m = Contract.Manifest(provider: manifest.provider, identity: manifest.identity, encoding: manifest.encoding, bounds: manifest.bounds,
                                      descriptors: [resized], timeBinding: manifest.timeBinding, expectedViewportPixels: manifest.expectedViewportPixels)
            _ = try Contract.decodeChunk(bytes, descriptor: resized, manifest: m)
        }
        var bytes = originalBytes; bytes[0] = 0
        rejects(.invalidBinary) { try decodeAltered(bytes) }
        bytes = originalBytes; bytes[5] = 2
        rejects(.unsupportedVersion) { try decodeAltered(bytes) }
        rejects(.truncatedBinary) { try decodeAltered(originalBytes.prefix(8)) }
        rejects(.truncatedBinary) { try decodeAltered(originalBytes.dropLast()) }
        rejects(.trailingBytes) { try decodeAltered(originalBytes + Data([0])) }
        bytes = originalBytes; bytes[8] = 0x7f
        rejects(.sizeLimit) { try decodeAltered(bytes) }
        bytes = originalBytes; bytes[12] = 0xff
        rejects(.invalidJSON) { try decodeAltered(bytes) }
        rejects(.sizeLimit) { try decodeAltered(Data(base64Encoded: fixture["gzipBombBase64"] as! String)!) }
        let gzip = Data(base64Encoded: vectors[2]["bytesBase64"] as! String)!
        rejects(.invalidCompression) { try decodeAltered(gzip.dropLast(4)) }
        rejects(.trailingBytes) { try decodeAltered(gzip + gzip) }
        func alteredManifest(_ key: String, _ value: Any) throws -> Contract.Manifest {
            var object = originalJSON; object[key] = value; return try Contract.decodeManifest(json(object))
        }
        rejects(.unsupportedVersion) { _ = try alteredManifest("version", 2) }
        rejects(.unsupportedProvider) { _ = try alteredManifest("provider", "not-weather") }
        rejects(.invalidBounds) { _ = try alteredManifest("bounds", ["minLat": -90, "maxLat": 90, "minLon": -180, "maxLon": 180]) }
        var wrongFrame = originalJSON["frame"] as! [String: Any]; wrongFrame["timestamp"] = "2026-09-19T01:21:00Z"
        rejects(.inconsistentMetadata) { _ = try alteredManifest("frame", wrongFrame) }
        var encoding = originalJSON["valueEncoding"] as! [String: Any]; encoding["noData"] = 255
        rejects(.unsupportedEncoding) { _ = try alteredManifest("valueEncoding", encoding) }
        var unsafe = originalJSON["levels"] as! [[String: Any]]
        var chunks = unsafe[0]["chunks"] as! [[String: Any]]
        for path in ["https://other.test/frame", "//other.test/frame", "../frame", "%2e%2e/frame", "blob:frame", "frame?token=secret", "/absolute", "a//b"] {
            chunks[0]["path"] = path; unsafe[0]["chunks"] = chunks
            rejects(.unsafeURL) { _ = try alteredManifest("levels", unsafe) }
        }
        // Header is a different valid instant but unchanged byte length.
        let changedTime = Data(String(data: originalBytes, encoding: .isoLatin1)!.replacingOccurrences(of: "01:20:00", with: "01:21:00").data(using: .isoLatin1)!)
        rejects(.inconsistentMetadata) { try decodeAltered(changedTime) }
        let indexURL = URL(string: "https://radar.example.test/index.json")!
        let resolved = try Contract.resolve(manifest.descriptors[0], relativeTo: indexURL)
        precondition(resolved.absoluteString == "https://radar.example.test/frames/noaa-mrms-direct.ncrd")

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockRadarProtocol.self]
        let client = try RadarChunkClient(allowedOrigins: [indexURL], configuration: config)
        MockRadarProtocol.store.set("/index.json", .init(data: try json(originalJSON)))
        MockRadarProtocol.store.set("/frames/noaa-mrms-direct.ncrd", .init(data: originalBytes))
        let loaded = try await client.loadManifest(at: indexURL)
        let loadedChunk = try await client.loadChunk(loaded.manifest.descriptors[0], from: loaded)
        precondition(loadedChunk.texture.bytes == Array(0...255))
        func asyncRejects(_ expected: Contract.Failure, _ action: () async throws -> Void) async {
            do { try await action(); preconditionFailure("Expected \(expected)") }
            catch { precondition((error as? Contract.Failure) == expected, "Expected \(expected), got \(error)") }
        }
        for value in ["https://other.test/index.json", "http://radar.example.test/index.json", "https://user:password@radar.example.test/index.json", "https://radar.example.test:8443/index.json", "https://radar.example.test/index.json#fragment"] {
            await asyncRejects(.unsafeURL) { _ = try await client.loadManifest(at: URL(string: value)!) }
        }
        MockRadarProtocol.store.set("/status", .init(data: Data(), status: 503))
        await asyncRejects(.httpStatus(503)) { _ = try await client.fetchBytes(at: indexURL.appendingPathComponent("../status").standardized, maximumBytes: 64) }
        MockRadarProtocol.store.set("/declared", .init(data: Data(), declaredLength: 999))
        await asyncRejects(.sizeLimit) { _ = try await client.fetchBytes(at: URL(string: "https://radar.example.test/declared")!, maximumBytes: 8) }
        MockRadarProtocol.store.set("/overflow", .init(data: Data(repeating: 0, count: 9)))
        await asyncRejects(.sizeLimit) { _ = try await client.fetchBytes(at: URL(string: "https://radar.example.test/overflow")!, maximumBytes: 8) }
        MockRadarProtocol.store.set("/hold1", .init(data: Data(), hold: true))
        MockRadarProtocol.store.set("/hold2", .init(data: Data(), hold: true))
        let first = Task { try await client.fetchBytes(at: URL(string: "https://radar.example.test/hold1")!, maximumBytes: 8) }
        let second = Task { try await client.fetchBytes(at: URL(string: "https://radar.example.test/hold2")!, maximumBytes: 8) }
        for _ in 0..<200 {
            if MockRadarProtocol.store.started("/hold1") && MockRadarProtocol.store.started("/hold2") { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        precondition(MockRadarProtocol.store.started("/hold1") && MockRadarProtocol.store.started("/hold2"))
        await asyncRejects(.requestLimit) { _ = try await client.fetchBytes(at: indexURL, maximumBytes: 64) }
        first.cancel(); second.cancel()
        for task in [first, second] {
            do { _ = try await task.value; preconditionFailure("Cancellation was ignored") }
            catch is CancellationError { }
        }
        _ = try await client.loadManifest(at: indexURL)
        print("PASS Native NCRD: production encoder/index parity, 3 gzip coverage assets, source/time binding, strict envelope/metadata/size/path rejection, ephemeral bounded fetch, declared/streaming limits, cancellation, concurrency cap and recovery")
        print("No live provider requests. Historical/synthetic fixtures do not establish live weather or radar parity.")
    }
}
