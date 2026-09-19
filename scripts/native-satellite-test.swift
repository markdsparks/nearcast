import Foundation

private struct MockSatelliteReply: Sendable {
    var status = 200
    var data = Data()
    var declaredLength: Int? = nil
    var headers: [String: String] = [:]
}

private final class MockSatelliteStore: @unchecked Sendable {
    private let lock = NSLock()
    private var replies: [MockSatelliteReply] = []
    private(set) var requests: [URLRequest] = []

    func set(_ values: [MockSatelliteReply]) {
        lock.lock(); replies = values; requests = []; lock.unlock()
    }

    func take(_ request: URLRequest) -> MockSatelliteReply? {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        return replies.isEmpty ? nil : replies.removeFirst()
    }
}

private final class MockSatelliteProtocol: URLProtocol, @unchecked Sendable {
    static let store = MockSatelliteStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let reply = Self.store.take(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)); return
        }
        let pieces = url.path.split(separator: "/").map(String.init)
        let layer = pieces.count > 5 ? pieces[3] : ""
        let date = pieces.count > 6 ? pieces[5] : ""
        var headers = [
            "Content-Type": "image/jpeg",
            "Layer-Identifier-Request": layer,
            "Layer-Identifier-Actual": layer + "_v6.1_NRT",
            "Layer-Time-Request": date,
            "Layer-Time-Actual": date + "T00:00:00Z"
        ]
        for (name, value) in reply.headers { headers[name] = value }
        if let length = reply.declaredLength { headers["Content-Length"] = String(length) }
        let response = HTTPURLResponse(url: url, statusCode: reply.status,
            httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !reply.data.isEmpty { client?.urlProtocol(self, didLoad: reply.data) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main
enum NativeSatelliteTests {
    static func main() async {
        let now = Date(timeIntervalSince1970: 1_789_786_414) // 2026-09-19 UTC
        let jpeg256 = Data([
            0xff, 0xd8,
            0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x01, 0x00, 0x03,
            0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
            0xff, 0xd9
        ])
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockSatelliteProtocol.self]

        let day = NativeSatelliteAcquisitionDate(iso8601: "2026-09-18")!
        precondition(day.iso8601 == "2026-09-18")
        precondition(NativeSatelliteAcquisitionDate(iso8601: "2026-02-29") == nil)
        precondition(NativeSatelliteAcquisitionDate(iso8601: "2024-02-29") != nil)
        precondition(NativeSatelliteAcquisitionDate.daysAgo(1, from: now)?.iso8601 == "2026-09-18")

        let maryville = NativeSatelliteContract.probeTile(latitude: 38.72, longitude: -89.96)
        precondition(maryville == .init(z: 9, x: 128, y: 196))
        precondition(NativeSatelliteContract.probeTile(latitude: 52.52, longitude: 13.405) != nil)
        precondition(NativeSatelliteContract.probeTile(latitude: 52.2297, longitude: 21.0122) != nil)
        precondition(NativeSatelliteContract.probeTile(latitude: 90, longitude: 0) == nil)
        precondition(NativeSatelliteContract.probeTile(latitude: 0, longitude: 181) == nil)

        let descriptor = NativeSatelliteContract.descriptor(product: .modisAqua, date: day)
        precondition(descriptor.id == "nasa-gibs-modisAqua-2026-09-18")
        precondition(descriptor.product == .modisAqua && descriptor.acquisitionDate == day)
        precondition(descriptor.tileSize == 256 && descriptor.minimumZoom == 4 && descriptor.maximumZoom == 9)
        precondition(descriptor.tileURLTemplates == [
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-09-18/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg"
        ])
        precondition(descriptor.contentKind == .acquiredTrueColorImagery)
        precondition(descriptor.suppressesPrecipitation && !descriptor.isRadar && !descriptor.isForecast)
        precondition(descriptor.sourceLabel == "Satellite MODIS Aqua")
        precondition(descriptor.attributions == [.init(
            title: "NASA Global Imagery Browse Services (GIBS)",
            url: URL(string: "https://nasa-gibs.github.io/gibs-api-docs/")!
        )])

        let probe = NativeSatelliteContract.probeURL(product: .modisAqua, date: day, tile: maryville!)!
        precondition(probe.absoluteString.hasSuffix("/GoogleMapsCompatible_Level9/9/196/128.jpeg"))
        precondition(NativeSatelliteContract.isAuthorizedTileURL(probe))
        for value in [
            "http://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-09-18/GoogleMapsCompatible_Level9/9/196/128.jpeg",
            "https://gibs.earthdata.nasa.gov.evil.example/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-09-18/GoogleMapsCompatible_Level9/9/196/128.jpeg",
            "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-09-18/GoogleMapsCompatible_Level9/9/196/128.jpeg",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Other/default/2026-09-18/GoogleMapsCompatible_Level9/9/196/128.jpeg",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-09-18/GoogleMapsCompatible_Level9/10/196/128.jpeg",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-09-18/GoogleMapsCompatible_Level9/9/196/128.jpeg?x=1"
        ] {
            precondition(!NativeSatelliteContract.isAuthorizedTileURL(URL(string: value)!))
        }

        func accepts(_ data: Data = jpeg256, type: String? = "image/jpeg",
                     requestedLayer: String? = NativeSatelliteProduct.modisAqua.layerIdentifier,
                     actualLayer: String? = NativeSatelliteProduct.modisAqua.layerIdentifier + "_v6.1_NRT",
                     requestedTime: String? = "2026-09-18",
                     actualTime: String? = "2026-09-18T00:00:00Z") -> Bool {
            NativeSatelliteContract.acceptsProbe(
                data: data, mimeType: type, requestedProduct: .modisAqua, requestedDate: day,
                requestedLayerHeader: requestedLayer, actualLayerHeader: actualLayer,
                requestedTimeHeader: requestedTime, actualTimeHeader: actualTime)
        }
        precondition(accepts())
        precondition(!accepts(type: "image/png"))
        precondition(!accepts(actualLayer: "Other"))
        precondition(!accepts(actualTime: "2026-09-17T00:00:00Z"))
        precondition(!accepts(Data([0xff, 0xd8, 0xff, 0xd9])))

        let client = NativeSatelliteClient(configuration: configuration)
        MockSatelliteProtocol.store.set([
            .init(status: 404), .init(status: 404), .init(data: jpeg256)
        ])
        let resolved = await client.resolveLatestAvailable(latitude: 38.72, longitude: -89.96, now: now)
        guard case .ready(let selected) = resolved else { preconditionFailure("Recent local pass not resolved") }
        precondition(selected.product == .modisAqua)
        precondition(selected.acquisitionDate.iso8601 == "2026-09-18")
        let requests = MockSatelliteProtocol.store.requests
        precondition(requests.count == 3)
        precondition(requests[0].url!.path.contains("MODIS_Aqua") && requests[0].url!.path.contains("2026-09-19"))
        precondition(requests[1].url!.path.contains("MODIS_Terra") && requests[1].url!.path.contains("2026-09-19"))
        precondition(requests[2].url!.path.contains("MODIS_Aqua") && requests[2].url!.path.contains("2026-09-18"))
        precondition(requests.allSatisfy { $0.httpMethod == "GET" })
        precondition(requests.allSatisfy { $0.value(forHTTPHeaderField: "Accept") == "image/jpeg" })
        precondition(requests.allSatisfy { $0.value(forHTTPHeaderField: "Cache-Control") == "no-cache" })
        precondition(requests.allSatisfy { $0.cachePolicy == .reloadIgnoringLocalCacheData })

        let terraClient = NativeSatelliteClient(configuration: configuration)
        MockSatelliteProtocol.store.set([.init(status: 404), .init(data: jpeg256)])
        let terraResolved = await terraClient.resolveLatestAvailable(
            latitude: 38.72, longitude: -89.96, now: now)
        guard case .ready(let terra) = terraResolved else { preconditionFailure("Terra fallback was not selected") }
        precondition(terra.product == .modisTerra && terra.acquisitionDate.iso8601 == "2026-09-19")

        func reason(_ value: NativeSatelliteAvailability) -> NativeSatelliteUnavailableReason? {
            guard case .unavailable(let reason) = value else { return nil }
            return reason
        }
        let unavailable = NativeSatelliteClient(configuration: configuration)
        MockSatelliteProtocol.store.set(Array(repeating: .init(status: 404), count: 8))
        let missing = await unavailable.resolveLatestAvailable(latitude: 38.72, longitude: -89.96, now: now)
        precondition(reason(missing) == .noRecentLocalPass)
        precondition(MockSatelliteProtocol.store.requests.count == 8)

        let invalid = NativeSatelliteClient(configuration: configuration)
        MockSatelliteProtocol.store.set([.init(data: jpeg256, headers: ["Layer-Time-Actual": "2026-09-18T00:00:00Z"])]
            + Array(repeating: .init(status: 404), count: 7))
        let invalidResponse = await invalid.resolveLatestAvailable(latitude: 38.72, longitude: -89.96, now: now)
        precondition(reason(invalidResponse) == .invalidResponse)

        let oversized = NativeSatelliteClient(configuration: configuration)
        MockSatelliteProtocol.store.set([
            .init(declaredLength: NativeSatelliteContract.maximumProbeBytes + 1)
        ] + Array(repeating: .init(status: 404), count: 7))
        let tooLarge = await oversized.resolveLatestAvailable(latitude: 38.72, longitude: -89.96, now: now)
        precondition(reason(tooLarge) == .responseTooLarge)

        let badCoordinate = await client.resolveLatestAvailable(latitude: .nan, longitude: 0, now: now)
        precondition(reason(badCoordinate) == .invalidCoordinate)

        print("PASS Native satellite: actual local-date probe, Aqua/Terra fallback, explicit acquisition date, strict NASA GIBS Mercator tiles, 256px JPEG/header evidence, attribution, precipitation suppression semantics, and bounded failure states")
        print("The descriptor is acquired true-color imagery only: never radar and never a weather forecast.")
    }
}
