import Foundation

/// Every source/layer exists before the static renderer starts. Mutating a
/// loaded background-only style can race its already-complete first frame.
enum NativeRadarPreviewSnapshotStyle {
    static let seedRGB: [UInt8] = [20, 35, 47]
    struct Raster {
        let templates: [String]
        let tileSize: Int, minimumZoom: Int, maximumZoom: Int
    }
    struct GeographicImage {
        let url: URL
        let west: Double, south: Double, east: Double, north: Double
    }
    static func data(base: Raster, labels: Raster, weather: Raster?, image: GeographicImage?,
                     latitude: Double, longitude: Double) throws -> Data {
        func source(_ raster: Raster) -> [String: Any] {
            ["type": "raster", "tiles": raster.templates, "tileSize": raster.tileSize,
             "minzoom": raster.minimumZoom, "maxzoom": raster.maximumZoom]
        }
        func layer(_ id: String, opacity: Double = 1) -> [String: Any] {
            ["id": id, "type": "raster", "source": id + "-source",
             "paint": ["raster-opacity": opacity, "raster-fade-duration": 0]]
        }
        var sources: [String: Any] = ["preview-base-source": source(base),
            "preview-labels-source": source(labels),
            "preview-place-source": ["type": "geojson", "data": ["type": "Feature",
                "geometry": ["type": "Point", "coordinates": [longitude, latitude]], "properties": [:]]]]
        if let image {
            sources["preview-weather-source"] = ["type": "image", "url": image.url.absoluteString,
                "coordinates": [[image.west, image.north], [image.east, image.north],
                                [image.east, image.south], [image.west, image.south]]]
        } else if let weather { sources["preview-weather-source"] = source(weather) }
        else { throw Failure.noWeather }
        let layers: [[String: Any]] = [
            ["id": "preview-background", "type": "background", "paint": ["background-color": "#14232f"]],
            layer("preview-base"), layer("preview-weather", opacity: image == nil ? 0.76 : 1),
            layer("preview-labels"),
            ["id": "preview-place", "type": "circle", "source": "preview-place-source",
             "paint": ["circle-radius": 4.5, "circle-color": "#2166b0",
                       "circle-stroke-color": "#ffffff", "circle-stroke-width": 2]]]
        return try JSONSerialization.data(withJSONObject: ["version": 8, "sources": sources, "layers": layers])
    }
    /// Check the final composite, not precipitation pixels: a fully transparent
    /// radar overlay is valid dry weather. Ignore the central marker footprint
    /// so a marker alone cannot make an otherwise empty snapshot look ready.
    static func hasMapContent(rgba: [UInt8], width: Int, height: Int) -> Bool {
        guard width >= 16, height >= 16, rgba.count == width * height * 4 else { return false }
        var inspected = 0, mapped = 0
        for y in 0..<height {
            for x in 0..<width {
                if abs(x - width / 2) <= max(2, width / 20), abs(y - height / 2) <= max(2, height / 20) { continue }
                let i = (y * width + x) * 4
                inspected += 1
                if rgba[i + 3] >= 250 && (0..<3).contains(where: { abs(Int(rgba[i + $0]) - Int(seedRGB[$0])) > 4 }) {
                    mapped += 1
                }
            }
        }
        return mapped * 10 >= inspected
    }
    private enum Failure: Error { case noWeather }
}

#if canImport(UIKit) && canImport(MapLibre)
import UIKit
import MapLibre

/// A single short-lived renderer. The complete style and optional radar PNG
/// are served through an opaque memory-only lease, never a credentialed file.
@MainActor
final class NativeRadarPreviewSnapshotter: NSObject, @preconcurrency MLNMapSnapshotterDelegate {
    private var snapshotter: MLNMapSnapshotter?
    private var continuation: CheckedContinuation<UIImage, Error>?
    private var resources: NativeBasemapMemoryResourceProtocol.Lease?
    private var started = false
    private var cancelled = false

    func render(place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera,
                basemap: NativeBasemapDescriptor, weatherImage: NativeRadarImage?,
                weatherTiles: NativeRadarTileLayer?) async throws -> UIImage {
        try Task.checkCancellation()
        guard !started else { throw Failure.unavailable }
        started = true
        let lease = NativeBasemapMemoryResourceProtocol.Lease()
        func raster(_ source: NativeBasemapRasterSource) -> NativeRadarPreviewSnapshotStyle.Raster {
            .init(templates: source.tileURLTemplates, tileSize: source.tileSize,
                  minimumZoom: source.minimumZoom, maximumZoom: source.maximumZoom)
        }
        let image = weatherImage.map { NativeRadarPreviewSnapshotStyle.GeographicImage(
            url: lease.url("weather.png"), west: $0.west, south: $0.south, east: $0.east, north: $0.north) }
        let tiles = weatherTiles.map { NativeRadarPreviewSnapshotStyle.Raster(templates: $0.templates,
            tileSize: 256, minimumZoom: $0.minimumZoom, maximumZoom: $0.maximumZoom) }
        let style = try NativeRadarPreviewSnapshotStyle.data(base: raster(basemap.background),
            labels: raster(basemap.labels), weather: tiles, image: image,
            latitude: place.latitude, longitude: place.longitude)
        var payloads = ["style.json": NativeBasemapMemoryResourceProtocol.Resource(data: style, mimeType: "application/json")]
        if let weatherImage {
            guard let png = weatherImage.image.pngData() else { throw Failure.unavailable }
            payloads["weather.png"] = .init(data: png, mimeType: "image/png")
        }
        guard lease.install(payloads) else { throw Failure.unavailable }
        resources = lease
        defer { lease.release() }
        let center = CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude)
        let options = MLNMapSnapshotOptions(styleURL: lease.url("style.json"),
            camera: MLNMapCamera(lookingAtCenter: center, altitude: 0, pitch: 0, heading: 0),
            size: CGSize(width: camera.width, height: camera.height))
        options.zoomLevel = camera.zoom; options.scale = camera.scale
        // Required credits remain visible and tappable on the native map.
        options.showsLogo = false; options.showsAttribution = false
        let snapshotter = MLNMapSnapshotter(options: options)
        self.snapshotter = snapshotter
        snapshotter.delegate = self
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard !cancelled else { continuation.resume(throwing: CancellationError()); return }
                self.continuation = continuation
                snapshotter.start { [weak self] snapshot, error in
                    // The SDK's start(completionHandler:) dispatches on main.
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        if error == nil, let image = snapshot?.image, Self.isValid(image, camera: camera) {
                            self.finish(.success(image))
                        } else { self.finish(.failure(Failure.unavailable)) }
                    }
                }
            }
        }, onCancel: { Task { @MainActor [weak self] in self?.cancel() } })
    }

    private static func isValid(_ image: UIImage, camera: NativeRadarPreviewPolicy.Camera) -> Bool {
        guard let bitmap = image.cgImage,
              bitmap.width == Int(camera.width * camera.scale),
              bitmap.height == Int(camera.height * camera.scale) else { return false }
        let width = 64, height = 32
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = pixels.withUnsafeMutableBytes { storage -> Bool in
            guard let context = CGContext(data: storage.baseAddress, width: width, height: height,
                bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.interpolationQuality = .low
            context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return rendered && NativeRadarPreviewSnapshotStyle.hasMapContent(rgba: pixels, width: width, height: height)
    }
    private func cancel() { cancelled = true; finish(.failure(CancellationError())) }
    private func finish(_ result: Result<UIImage, Error>) {
        let continuation = continuation; self.continuation = nil
        snapshotter?.delegate = nil
        snapshotter?.cancel(); snapshotter = nil
        resources?.release(); resources = nil
        continuation?.resume(with: result)
    }
    func mapSnapshotterDidFail(_ snapshotter: MLNMapSnapshotter, withError error: Error) {
        // Provider errors can contain keyed URLs; expose a generic state only.
        // Leave the native observer stack before cancelling its renderer.
        Task { @MainActor [weak self] in self?.finish(.failure(Failure.unavailable)) }
    }
    private enum Failure: Error { case unavailable }
}
#endif
