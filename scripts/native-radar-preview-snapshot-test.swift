import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

private final class ProtocolClient: NSObject, URLProtocolClient, @unchecked Sendable {
    var events = 0
    func urlProtocol(_ p: URLProtocol, wasRedirectedTo request: URLRequest, redirectResponse: URLResponse) { events += 1 }
    func urlProtocol(_ p: URLProtocol, cachedResponseIsValid cachedResponse: CachedURLResponse) { events += 1 }
    func urlProtocol(_ p: URLProtocol, didReceive response: URLResponse, cacheStoragePolicy policy: URLCache.StoragePolicy) { events += 1 }
    func urlProtocol(_ p: URLProtocol, didLoad data: Data) { events += 1 }
    func urlProtocolDidFinishLoading(_ p: URLProtocol) { events += 1 }
    func urlProtocol(_ p: URLProtocol, didFailWithError error: Error) { events += 1 }
    func urlProtocol(_ p: URLProtocol, didReceive challenge: URLAuthenticationChallenge) { events += 1 }
    func urlProtocol(_ p: URLProtocol, didCancel challenge: URLAuthenticationChallenge) { events += 1 }
}

@main struct NativeRadarPreviewSnapshotTests {
    static func main() async throws {
        let raster = NativeRadarPreviewSnapshotStyle.Raster(templates: ["https://tiles.example/{z}/{x}/{y}.png?key=fixture-only"],
            tileSize: 256, minimumZoom: 0, maximumZoom: 20)
        let imageURL = URL(string: "https://nearcast-map-memory.invalid/fixture/weather.png")!
        let data = try NativeRadarPreviewSnapshotStyle.data(base: raster, labels: raster, weather: nil,
            image: .init(url: imageURL, west: -92, south: 37, east: -89, north: 40), latitude: 38.7, longitude: -89.9)
        let style = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let sources = style["sources"] as! [String: [String: Any]]
        expect(sources.count == 4, "Static renderer must receive all four sources at style creation")
        let layers = style["layers"] as! [[String: Any]]
        expect(layers.compactMap { $0["id"] as? String } == ["preview-background", "preview-base", "preview-weather", "preview-labels", "preview-place"],
               "Basemap/weather/labels/place ordering changed")
        expect(sources["preview-weather-source"]?["coordinates"] as? [[Double]] == [[-92,40],[-89,40],[-89,37],[-92,37]],
               "Geographic PNG must keep real NW/NE/SE/SW bounds")
        let tiled = try JSONSerialization.jsonObject(with: NativeRadarPreviewSnapshotStyle.data(base: raster, labels: raster,
            weather: raster, image: nil, latitude: 52, longitude: 21)) as! [String: Any]
        expect(((tiled["sources"] as! [String: [String: Any]])["preview-weather-source"]?["type"] as? String) == "raster",
               "Global observed tiles missing from initial style")
        do {
            _ = try NativeRadarPreviewSnapshotStyle.data(base: raster, labels: raster, weather: nil, image: nil, latitude: 0, longitude: 0)
            fatalError("No-weather style was accepted")
        } catch {}

        let width = 64, height = 32
        func pixels(_ color: [UInt8]) -> [UInt8] { Array(repeating: color, count: width * height).flatMap { $0 } }
        var blank = pixels([20,35,47,255])
        expect(!NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: blank, width: width, height: height), "Seed-only bitmap became ready")
        for y in 14...18 { for x in 30...34 { let i = (y * width + x) * 4; blank.replaceSubrange(i..<(i+4), with: [255,255,255,255]) } }
        expect(!NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: blank, width: width, height: height), "Place marker masked blank map")
        expect(!NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: pixels([255,255,255,0]), width: width, height: height), "Transparent snapshot became ready")
        expect(NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: pixels([230,237,240,255]), width: width, height: height), "Dry/clear basemap was rejected")
        expect(NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: pixels([96,148,172,255]), width: width, height: height), "Uniform ocean basemap was rejected")
        expect(!NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: [], width: width, height: height), "Wrong-sized bitmap accepted")

        typealias Memory = NativeBasemapMemoryResourceProtocol
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Memory.self]
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        expect(!Memory.canInit(with: URLRequest(url: URL(string: "https://basemaps.cartocdn.com/tile.png")!)), "Provider traffic was intercepted")
        expect(Memory.retainedResourceBytes == 0, "Initial registry not empty")
        var urls = Set<URL>()
        for _ in 0..<12 {
            let lease = Memory.Lease()
            expect(lease.install(["style.json": .init(data: data, mimeType: "application/json")]), "Resource installation failed")
            let url = lease.url("style.json")
            expect(urls.insert(url).inserted, "Place switch reused prior style URL")
            expect(!url.absoluteString.contains("fixture-only"), "Credential escaped into style URL")
            let (received, response) = try await session.data(from: url)
            expect(received == data, "In-memory style changed")
            expect((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Cache-Control") == "no-store", "Style was cacheable")
            lease.release(); lease.release()
            expect(Memory.retainedResourceBytes == 0 && Memory.retainedResourceCount == 0, "Released snapshot retained style bytes")
            expect(Memory.canInit(with: URLRequest(url: url)), "Expired style fell through to network")
            do { _ = try await session.data(from: url); fatalError("Expired style loaded") } catch {}
            expect(!lease.install(["style.json": .init(data: data, mimeType: "application/json")]), "Released lease resurrected")
        }
        let cancelledLease = Memory.Lease()
        expect(cancelledLease.install(["style.json": .init(data: data, mimeType: "application/json")]), "Cancellation fixture failed")
        let client = ProtocolClient()
        let cancelled = Memory(request: URLRequest(url: cancelledLease.url("style.json")), cachedResponse: nil, client: client)
        cancelled.stopLoading(); cancelled.startLoading()
        expect(client.events == 0, "Cancelled protocol delivered callbacks")
        cancelledLease.release()

        let oversized = Memory.Lease()
        expect(!oversized.install(["weather.png": .init(data: Data(repeating: 0, count: Memory.maximumLeaseBytes + 1), mimeType: "image/png")]), "Oversized lease admitted")
        let large1 = Memory.Lease(), large2 = Memory.Lease(), large3 = Memory.Lease()
        let large = ["weather.png": Memory.Resource(data: Data(repeating: 0, count: Memory.maximumLeaseBytes), mimeType: "image/png")]
        expect(large1.install(large) && large2.install(large), "Within-budget leases rejected")
        expect(!large3.install(["style.json": .init(data: data, mimeType: "application/json")]), "Global memory budget exceeded")
        large1.release(); large2.release()
        var leases: [Memory.Lease] = []
        for _ in 0..<Memory.maximumLeases {
            let lease = Memory.Lease()
            expect(lease.install(["style.json": .init(data: data, mimeType: "application/json")]), "Lease count filled too soon")
            leases.append(lease)
        }
        expect(!Memory.Lease().install(["style.json": .init(data: data, mimeType: "application/json")]), "Lease count bound exceeded")
        leases.removeAll()
        expect(Memory.retainedResourceBytes == 0 && Memory.retainedResourceCount == 0, "Lease deinit did not release resources")
        print("PASS radar snapshot: atomic complete style, geographic order, seed/marker/transparent rejection, dry map acceptance, opaque isolated repeated leases, no-store responses, expired fail-closed, cancellation and byte/count bounds")
    }
}
