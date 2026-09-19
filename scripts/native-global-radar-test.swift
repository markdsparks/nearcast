import Foundation

private struct MockReply: Sendable {
    let data: Data
    var status = 200
    var declaredLength: Int? = nil
}

private final class MockGlobalRadarStore: @unchecked Sendable {
    private let lock = NSLock()
    private var reply: MockReply?
    private(set) var lastRequest: URLRequest?
    private(set) var requestCount = 0

    func set(_ value: MockReply) { lock.lock(); reply = value; lock.unlock() }
    func take(_ request: URLRequest) -> MockReply? {
        lock.lock(); defer { lock.unlock() }
        lastRequest = request
        requestCount += 1
        return reply
    }
}

private final class MockGlobalRadarProtocol: URLProtocol, @unchecked Sendable {
    static let store = MockGlobalRadarStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let reply = Self.store.take(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)); return
        }
        var headers = ["Content-Type": "application/json"]
        if let length = reply.declaredLength { headers["Content-Length"] = String(length) }
        let response = HTTPURLResponse(url: url, statusCode: reply.status,
            httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main
enum NativeGlobalRadarTests {
    static func main() async {
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        func json(_ value: Any) -> Data {
            try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        }
        func frame(_ offset: Int64, path: String? = nil) -> [String: Any] {
            let time = Int64(now.timeIntervalSince1970) + offset
            return ["time": time, "path": path ?? String(format: "/v2/radar/%012llx", time)]
        }
        func payload(version: String = "2.0", generatedOffset: Int64 = -30,
                     host: String = "https://tilecache.rainviewer.com",
                     past: [[String: Any]]? = nil, nowcast: [[String: Any]] = []) -> Data {
            json([
                "version": version,
                "generated": Int64(now.timeIntervalSince1970) + generatedOffset,
                "host": host,
                "radar": [
                    "past": past ?? [frame(-600), frame(-1_200), frame(-1_800)],
                    "nowcast": nowcast
                ],
                "satellite": ["infrared": []]
            ])
        }
        func reason(_ value: NativeGlobalRadarAvailability) -> NativeGlobalRadarUnavailableReason? {
            guard case .unavailable(let reason) = value else { return nil }
            return reason
        }

        let decoded = NativeGlobalRadarContract.decodeManifest(
            payload(nowcast: [frame(600)]), fetchedAt: now, now: now)
        guard case .ready(let snapshot) = decoded else { preconditionFailure("Valid observed manifest rejected") }
        precondition(snapshot.frames.count == 3, "Nowcast must never enter observed frames")
        precondition(snapshot.frames.map(\.validTime) == snapshot.frames.map(\.validTime).sorted())
        precondition(snapshot.frames.last?.id == "rainviewer-observed-1799999400")
        precondition(snapshot.frames.allSatisfy { $0.sourceProvider == "rainviewer" && $0.observationKind == "observed" })
        precondition(snapshot.frames.allSatisfy { $0.tileSize == 256 && $0.minimumZoom == 0 && $0.maximumZoom == 7 })
        precondition(snapshot.frames.allSatisfy {
            $0.tileURLTemplate.hasPrefix("https://tilecache.rainviewer.com/v2/radar/")
                && $0.tileURLTemplate.hasSuffix("/256/{z}/{x}/{y}/2/1_1.png")
        })
        precondition(snapshot.frames.first?.attributions == [
            .init(title: "Weather data by RainViewer", url: URL(string: "https://www.rainviewer.com/")!)
        ])

        let legacy = NativeGlobalRadarContract.decodeManifest(
            payload(past: [frame(-600, path: "/v2/radar/1799999400")]), fetchedAt: now, now: now)
        guard case .ready = legacy else { preconditionFailure("Documented timestamp path rejected") }

        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(past: []), fetchedAt: now, now: now)) == .noObservedFrames)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(version: "3.0"), fetchedAt: now, now: now)) == .invalidManifest)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(host: "https://tilecache.rainviewer.com.evil.example"), fetchedAt: now, now: now)) == .invalidManifest)
        for path in [
            "/v2/radar/ABCDEF123456", "/v2/radar/abcdef12345", "/v2/radar/abcdef123456/extra",
            "/v2/radar/abcdef123456?x=1", "/v2/radar/../../public/weather-maps.json"
        ] {
            precondition(reason(NativeGlobalRadarContract.decodeManifest(
                payload(past: [frame(-600, path: path)]), fetchedAt: now, now: now)) == .invalidManifest)
        }
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(past: [frame(-600), frame(-600)]), fetchedAt: now, now: now)) == .invalidManifest)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(past: [frame(180)]), fetchedAt: now, now: now)) == .invalidManifest)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(generatedOffset: -1_900, past: [frame(-1_920)]), fetchedAt: now, now: now)) == .stale)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(generatedOffset: -30, past: [frame(-1_900)]), fetchedAt: now, now: now)) == .stale)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            payload(generatedOffset: -700, past: [frame(-600)]), fetchedAt: now, now: now)) == .invalidManifest)
        precondition(reason(NativeGlobalRadarContract.decodeManifest(
            Data(repeating: 0x20, count: NativeGlobalRadarContract.maximumMetadataBytes + 1),
            fetchedAt: now, now: now)) == .responseTooLarge)

        precondition(NativeGlobalRadarContract.isAuthorizedMetadataEndpoint(NativeGlobalRadarContract.metadataEndpoint))
        for value in [
            "http://api.rainviewer.com/public/weather-maps.json",
            "https://api.rainviewer.com.evil.example/public/weather-maps.json",
            "https://api.rainviewer.com/public/weather-maps.json?x=1",
            "https://api.rainviewer.com/public/weather-maps.json#fragment",
            "https://api.rainviewer.com:443/public/weather-maps.json",
            "https://api.rainviewer.com/public/other.json"
        ] {
            precondition(!NativeGlobalRadarContract.isAuthorizedMetadataEndpoint(URL(string: value)!))
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockGlobalRadarProtocol.self]
        let client = NativeGlobalRadarClient(configuration: configuration)
        MockGlobalRadarProtocol.store.set(.init(data: payload()))
        let loaded = await client.load(now: now)
        guard case .ready = loaded else { preconditionFailure("Bounded transport fixture failed") }
        let request = MockGlobalRadarProtocol.store.lastRequest
        precondition(request?.url == NativeGlobalRadarContract.metadataEndpoint)
        precondition(request?.httpMethod == "GET")
        precondition(request?.value(forHTTPHeaderField: "Accept") == "application/json")
        precondition(request?.value(forHTTPHeaderField: "Cache-Control") == "no-cache")
        precondition(request?.cachePolicy == .reloadIgnoringLocalCacheData)

        let initialCount = MockGlobalRadarProtocol.store.requestCount
        MockGlobalRadarProtocol.store.set(.init(data: Data()))
        guard case .ready = await client.load(now: now.addingTimeInterval(120)) else {
            preconditionFailure("Four-minute memory cache was not reused")
        }
        precondition(MockGlobalRadarProtocol.store.requestCount == initialCount)
        let forced = await client.load(now: now.addingTimeInterval(120), force: true)
        precondition(reason(forced) == .invalidManifest)
        precondition(MockGlobalRadarProtocol.store.requestCount == initialCount + 1)
        guard case .ready = await client.load(now: now.addingTimeInterval(239)) else {
            preconditionFailure("Memory cache expired before the web-parity four-minute window")
        }
        precondition(MockGlobalRadarProtocol.store.requestCount == initialCount + 1)
        let expired = await client.load(now: now.addingTimeInterval(241))
        precondition(reason(expired) == .invalidManifest)
        precondition(MockGlobalRadarProtocol.store.requestCount == initialCount + 2)

        let statusClient = NativeGlobalRadarClient(configuration: configuration)
        MockGlobalRadarProtocol.store.set(.init(data: payload(), status: 503))
        let failedStatus = await statusClient.load(now: now)
        precondition(reason(failedStatus) == .transport)
        let declaredClient = NativeGlobalRadarClient(configuration: configuration)
        MockGlobalRadarProtocol.store.set(.init(data: payload(), declaredLength: NativeGlobalRadarContract.maximumMetadataBytes + 1))
        let declaredOversized = await declaredClient.load(now: now)
        precondition(reason(declaredOversized) == .responseTooLarge)
        let streamedClient = NativeGlobalRadarClient(configuration: configuration)
        MockGlobalRadarProtocol.store.set(.init(data: Data(repeating: 0x20,
            count: NativeGlobalRadarContract.maximumMetadataBytes + 1)))
        let streamedOversized = await streamedClient.load(now: now)
        precondition(reason(streamedOversized) == .responseTooLarge)
        let unsafeClient = NativeGlobalRadarClient(
            endpoint: URL(string: "https://example.com/public/weather-maps.json")!, configuration: configuration)
        let unsafe = await unsafeClient.load(now: now)
        precondition(reason(unsafe) == .unsafeEndpoint)

        print("PASS Native global radar: observed-only RainViewer parity, strict advertised time/path and HTTPS hosts, source freshness, attribution, 4-minute memory cache, and bounded fail-closed transport")
        print("Public nowcast/forecast remains intentionally unavailable; no live provider request was made.")
    }
}
