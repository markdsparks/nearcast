import Foundation

private struct MockReply: Sendable {
    let data: Data
    var status = 200
    var declaredLength: Int? = nil
    var cacheControl: String? = "no-store"
}

private final class MockBasemapStore: @unchecked Sendable {
    private let lock = NSLock()
    private var reply: MockReply?
    private(set) var lastRequest: URLRequest?

    func set(_ value: MockReply) { lock.lock(); reply = value; lock.unlock() }
    func take(_ request: URLRequest) -> MockReply? {
        lock.lock(); defer { lock.unlock() }
        lastRequest = request
        return reply
    }
}

private final class MockBasemapProtocol: URLProtocol, @unchecked Sendable {
    static let store = MockBasemapStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let reply = Self.store.take(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)); return
        }
        var headers = ["Content-Type": "application/json"]
        if let cacheControl = reply.cacheControl { headers["Cache-Control"] = cacheControl }
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
enum NativeBasemapClientTests {
    static func main() async {
        func json(_ value: Any) -> Data {
            try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        }
        func payload(state: String = "ready", key: String = "native-key",
                     audience: String = NativeBasemapContract.productionAudience,
                     provider: String = "nearcast-map-config", version: Int = 1) -> Data {
            json(["provider": provider, "version": version, "state": state,
                  "audience": audience, "carto": ["apiKey": key]])
        }
        func reason(_ availability: NativeBasemapAvailability) -> NativeBasemapUnavailableReason? {
            guard case .unavailable(let value) = availability else { return nil }
            return value
        }

        let specialKey = "mobile+key/?=&"
        let ready = NativeBasemapContract.decodeConfiguration(payload(key: specialKey))
        guard case .ready(let catalog) = ready else { preconditionFailure("Valid mobile config was rejected") }
        precondition(catalog.streets.background.id == "nearcast-base")
        precondition(catalog.streets.labels.id == "nearcast-labels")
        precondition(catalog.aerial.background.id == "nearcast-aerial")
        precondition(catalog.aerial.labels.id == "nearcast-aerial-labels")
        precondition(catalog.streets.background.tileURLTemplates.count == 4)
        precondition(catalog.streets.background.tileURLTemplates.allSatisfy {
            $0.contains("/rastertiles/voyager_nolabels/{z}/{x}/{y}.png?key=mobile%2Bkey%2F%3F%3D%26")
        })
        precondition(catalog.streets.labels.tileURLTemplates.allSatisfy {
            $0.contains("/rastertiles/voyager_only_labels/{z}/{x}/{y}.png?key=")
        })
        precondition(catalog.aerial.background.tileURLTemplates == [
            "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
        ])
        precondition(catalog.streets.background.tileSize == 256)
        precondition(catalog.streets.background.minimumZoom == 4 && catalog.streets.background.maximumZoom == 18)
        precondition(catalog.aerial.background.maximumZoom == 16)
        precondition(catalog.streets.background.attributions.map(\.title) == ["© CARTO", "© OpenStreetMap contributors"])
        precondition(catalog.aerial.background.attributions.map(\.title) == ["USGS/USDA The National Map"])
        precondition(!String(describing: ready).contains(specialKey))
        precondition(!String(reflecting: catalog.streets.background).contains(specialKey))

        precondition(NativeBasemapCatalog.supportsAerial(latitude: 38.72, longitude: -89.96))
        precondition(NativeBasemapCatalog.supportsAerial(latitude: 21.3, longitude: -157.8))
        precondition(NativeBasemapCatalog.supportsAerial(latitude: 13.5, longitude: 144.8))
        precondition(!NativeBasemapCatalog.supportsAerial(latitude: 51.5, longitude: -0.1))
        precondition(!NativeBasemapCatalog.supportsAerial(latitude: .nan, longitude: -89.96))

        precondition(NativeBasemapContract.audience(for: NativeBasemapContract.productionAudience) == NativeBasemapContract.productionAudience)
        precondition(NativeBasemapContract.audience(for: NativeBasemapContract.developmentAudience) == NativeBasemapContract.developmentAudience)
        precondition(NativeBasemapContract.audience(for: "app.nearcast.ios.other") == nil)
        precondition(NativeBasemapContract.client(for: NativeBasemapContract.productionAudience) == NativeBasemapContract.productionClient)
        precondition(NativeBasemapContract.client(for: NativeBasemapContract.developmentAudience) == NativeBasemapContract.developmentClient)
        precondition(NativeBasemapContract.client(for: "app.nearcast.ios.other") == nil)
        guard case .ready = NativeBasemapContract.decodeConfiguration(
            payload(audience: NativeBasemapContract.developmentAudience),
            bundleIdentifier: NativeBasemapContract.developmentAudience
        ) else {
            preconditionFailure("Valid development mobile config was rejected")
        }
        precondition(reason(NativeBasemapContract.decodeConfiguration(
            payload(audience: NativeBasemapContract.productionAudience),
            bundleIdentifier: NativeBasemapContract.developmentAudience
        )) == .invalidConfiguration)

        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(state: "unavailable", key: ""))) == .notConfigured)
        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(state: "unavailable", key: "unexpected"))) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(audience: "web"))) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(provider: "wrong"))) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(version: 2))) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(state: "loading"))) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(payload(key: " leading"))) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(Data())) == .invalidConfiguration)
        precondition(reason(NativeBasemapContract.decodeConfiguration(Data(repeating: 0, count: 4_097))) == .invalidConfiguration)

        let endpoint = NativeBasemapClient.configurationEndpoint
        precondition(NativeBasemapContract.isAuthorizedConfigurationEndpoint(endpoint))
        let developmentEndpoint = NativeBasemapClient.endpoint(for: NativeBasemapContract.developmentAudience)
        precondition(NativeBasemapContract.isAuthorizedConfigurationEndpoint(
            developmentEndpoint, bundleIdentifier: NativeBasemapContract.developmentAudience
        ))
        precondition(!NativeBasemapContract.isAuthorizedConfigurationEndpoint(
            developmentEndpoint, bundleIdentifier: NativeBasemapContract.productionAudience
        ))
        for unsafe in [
            "http://getnearcast.app/api/map/config?client=ios",
            "https://www.getnearcast.app/api/map/config?client=ios",
            "https://getnearcast.app/api/map/config",
            "https://getnearcast.app/api/map/config?client=web",
            "https://getnearcast.app/api/map/config?client=ios&client=ios",
            "https://getnearcast.app/api/map/config?client=ios#fragment"
        ] {
            precondition(!NativeBasemapContract.isAuthorizedConfigurationEndpoint(URL(string: unsafe)!))
        }

        let carto = NSMutableURLRequest(url: URL(string: "https://a.basemaps.cartocdn.com/rastertiles/voyager/1/2/3.png")!)
        _ = NativeBasemapContract.authorizeCartoRequest(carto)
        precondition(carto.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier") == "app.nearcast.ios")
        precondition(carto.value(forHTTPHeaderField: "Referer") == nil)
        let developmentCarto = NSMutableURLRequest(url: URL(string: "https://a.basemaps.cartocdn.com/rastertiles/voyager/1/2/3.png")!)
        _ = NativeBasemapContract.authorizeCartoRequest(
            developmentCarto, bundleIdentifier: NativeBasemapContract.developmentAudience
        )
        precondition(developmentCarto.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier") == "app.nearcast.ios.dev")
        let unauthorizedCarto = NSMutableURLRequest(url: URL(string: "https://a.basemaps.cartocdn.com/rastertiles/voyager/1/2/3.png")!)
        _ = NativeBasemapContract.authorizeCartoRequest(unauthorizedCarto, bundleIdentifier: "app.nearcast.ios.other")
        precondition(unauthorizedCarto.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier") == nil)
        for value in [
            "http://a.basemaps.cartocdn.com/tile.png",
            "https://basemaps.cartocdn.com.evil.example/tile.png",
            "https://basemap.nationalmap.gov/tile.png",
            "https://getnearcast.app/api/map/config?client=ios"
        ] {
            let request = NSMutableURLRequest(url: URL(string: value)!)
            _ = NativeBasemapContract.authorizeCartoRequest(request)
            precondition(request.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier") == nil)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockBasemapProtocol.self]
        let client = NativeBasemapClient(configuration: configuration)
        MockBasemapProtocol.store.set(.init(data: payload(key: "transport-key")))
        let loaded = await client.load()
        guard case .ready(let loadedCatalog) = loaded else { preconditionFailure("Transport fixture failed") }
        precondition(loadedCatalog.streets.background.tileURLTemplates[0].contains("key=transport-key"))
        let request = MockBasemapProtocol.store.lastRequest
        precondition(request?.url == endpoint)
        precondition(request?.httpMethod == "GET")
        precondition(request?.value(forHTTPHeaderField: "Accept") == "application/json")
        precondition(request?.value(forHTTPHeaderField: "Cache-Control") == "no-cache")
        precondition(request?.cachePolicy == .reloadIgnoringLocalCacheData)

        MockBasemapProtocol.store.set(.init(data: payload(state: "unavailable", key: "")))
        let notConfigured = await client.load()
        precondition(reason(notConfigured) == .notConfigured)
        MockBasemapProtocol.store.set(.init(data: payload(), status: 503))
        let failedStatus = await client.load()
        precondition(reason(failedStatus) == .transport)
        MockBasemapProtocol.store.set(.init(data: payload(), declaredLength: 4_097))
        let oversized = await client.load()
        precondition(reason(oversized) == .responseTooLarge)
        MockBasemapProtocol.store.set(.init(data: Data(repeating: 0x20, count: 4_097)))
        let streamedOversized = await client.load()
        precondition(reason(streamedOversized) == .responseTooLarge)
        MockBasemapProtocol.store.set(.init(data: payload(), cacheControl: nil))
        let cacheable = await client.load()
        precondition(reason(cacheable) == .transport)

        let unsafeClient = NativeBasemapClient(endpoint: URL(string: "https://example.com/api/map/config?client=ios")!,
                                                configuration: configuration)
        let unsafe = await unsafeClient.load()
        precondition(reason(unsafe) == .unsafeEndpoint)
        precondition(NativeBasemapContract.maximumDeviceCacheAge == 30 * 24 * 60 * 60)

        print("PASS Native basemap: strict iOS config/audience, memory-only redacted descriptors, keyed street + public aerial sources, attribution, host-scoped bundle header, bounded no-cache transport, and fail-closed states")
        print("No live endpoint or provider tile was requested; mobile key restriction and MapLibre's <=30-day ambient-cache policy remain production gates.")
    }
}
