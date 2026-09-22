import XCTest
import UIKit
@testable import Nearcast

/// Opt-in, app-hosted MapLibre integration coverage. Run on a disposable iPhone
/// simulator with the “Nearcast Radar Snapshot Tests” scheme (DevPerformance).
/// The default suite uses only in-memory raster fixtures; it never fetches
/// weather or edits the host application's places, plans or preferences.
@MainActor
final class NativeRadarPreviewSnapshotTests: XCTestCase {
    private let maryville = NativePreviewPlace(id: "snapshot-maryville", name: "Maryville, Illinois",
        latitude: 38.7237, longitude: -89.9559, timezone: "America/Chicago", countryCode: "US")
    private let nokomis = NativePreviewPlace(id: "snapshot-nokomis", name: "Nokomis, Illinois",
        latitude: 39.3012, longitude: -89.2851, timezone: "America/Chicago", countryCode: "US")
    private let indianapolis = NativePreviewPlace(id: "snapshot-indianapolis", name: "Indianapolis, Indiana",
        latitude: 39.7684, longitude: -86.1581, timezone: "America/Indiana/Indianapolis", countryCode: "US")
    private let bengaluru = NativePreviewPlace(id: "snapshot-bengaluru", name: "Bengaluru, Karnataka, India",
        latitude: 12.9716, longitude: 77.5946, timezone: "Asia/Kolkata", countryCode: "IN")

    private var places: [NativePreviewPlace] { [maryville, nokomis, indianapolis, maryville, nokomis] }
    private struct Resources: Equatable { let count: Int; let bytes: Int }
    private var resources: Resources {
        Resources(count: NativeBasemapMemoryResourceProtocol.retainedResourceCount,
                  bytes: NativeBasemapMemoryResourceProtocol.retainedResourceBytes)
    }

    func testRepeatedPlaceSwitchesRenderDryMapsWithCorrectDimensionsAndReleaseResources() async throws {
        try await prepareTransport()
        let initial = resources
        let fixture = try makeBasemap()
        defer { fixture.lease.release() }
        let retainedFixture = resources
        // A single first render is not enough to reproduce the original race.
        for pass in 0..<2 {
            for place in places {
                let camera = try camera(for: place)
                let image = try await render(place, camera: camera, basemap: fixture.basemap, wet: false)
                assertMap(image, camera: camera, context: "dry pass \(pass), \(place.name)")
                XCTAssertEqual(resources, retainedFixture, "A finished snapshot must release its style and weather PNG lease")
            }
        }
        fixture.lease.release()
        XCTAssertEqual(resources, initial, "The fixture lease must also be recoverable")
    }

    func testWetOverlayCompositesOverMapAndDoesNotLeakAcrossFollowingDryRender() async throws {
        try await prepareTransport()
        let fixture = try makeBasemap()
        defer { fixture.lease.release() }
        let baseline = resources
        let camera = try camera(for: nokomis)
        let dry = try await render(nokomis, camera: camera, basemap: fixture.basemap, wet: false)
        let wet = try await render(nokomis, camera: camera, basemap: fixture.basemap, wet: true)
        let dryAgain = try await render(nokomis, camera: camera, basemap: fixture.basemap, wet: false)
        for image in [dry, wet, dryAgain] { assertMap(image, camera: camera, context: "wet/dry transition") }
        XCTAssertGreaterThan(try greenPixelCount(wet), try greenPixelCount(dry) + 20,
                             "The geographic fixture rain image must actually be drawn")
        XCTAssertEqual(try greenPixelCount(dryAgain), try greenPixelCount(dry),
                       "A new dry snapshot must not retain the previous render's rain image")
        XCTAssertEqual(resources, baseline)
    }

    func testBengaluruRasterWeatherSurvivesRepeatedSwitchesToUSImageWeather() async throws {
        try await prepareTransport()
        let initial = resources
        let fixture = try makeBasemap()
        let weather = try makeWeatherRaster()
        defer { fixture.lease.release(); weather.lease.release() }
        let baseline = resources
        let globalCamera = try camera(for: bengaluru)
        let usCamera = try camera(for: maryville)
        // Outside the MRMS region, weather is an XYZ raster source rather
        // than a geographic PNG. Exercise the real SDK on that distinct path,
        // including transparent (dry) tiles, without contacting any provider.
        for pass in 0..<2 {
            let dry = try await render(bengaluru, camera: globalCamera, basemap: fixture.basemap,
                                       weatherImage: nil, weatherTiles: weather.dry)
            assertMap(dry, camera: globalCamera, context: "Bengaluru dry raster, pass \(pass)")
            XCTAssertEqual(resources, baseline)

            let usWet = try await render(maryville, camera: usCamera, basemap: fixture.basemap, wet: true)
            assertMap(usWet, camera: usCamera, context: "US image after global raster")
            XCTAssertEqual(resources, baseline)

            let wet = try await render(bengaluru, camera: globalCamera, basemap: fixture.basemap,
                                       weatherImage: nil, weatherTiles: weather.wet)
            assertMap(wet, camera: globalCamera, context: "Bengaluru wet raster, pass \(pass)")
            XCTAssertGreaterThan(try greenPixelCount(wet), try greenPixelCount(dry) + 20,
                                 "Global weather raster tiles must actually composite over the basemap")
            XCTAssertEqual(resources, baseline)

            let usDry = try await render(maryville, camera: usCamera, basemap: fixture.basemap, wet: false)
            assertMap(usDry, camera: usCamera, context: "US dry image after global wet raster")
            XCTAssertEqual(try greenPixelCount(usDry), 0, "Global rain must not leak into the next US render")
            XCTAssertEqual(resources, baseline)

            let dryAgain = try await render(bengaluru, camera: globalCamera, basemap: fixture.basemap,
                                            weatherImage: nil, weatherTiles: weather.dry)
            assertMap(dryAgain, camera: globalCamera, context: "Bengaluru returning dry raster")
            XCTAssertEqual(try greenPixelCount(dryAgain), try greenPixelCount(dry),
                           "Returning to Bengaluru must not retain a prior wet raster or US image")
            XCTAssertEqual(resources, baseline, "Every source transition must release its renderer lease")
        }
        fixture.lease.release(); weather.lease.release()
        XCTAssertEqual(resources, initial)
    }

    func testSeedOnlySnapshotIsRejectedAndReleasesResources() async throws {
        try await prepareTransport()
        let fixture = try makeBasemap(seedOnly: true)
        defer { fixture.lease.release() }
        let baseline = resources
        do {
            _ = try await render(nokomis, camera: camera(for: nokomis), basemap: fixture.basemap, wet: false)
            XCTFail("A diagnostic-color bitmap with only a center marker must never become a ready map")
        } catch is CancellationError {
            XCTFail("Seed-only output should fail validation, not wait for the bounded-render timeout")
        } catch {
            // Deliberately do not stringify provider/SDK errors or descriptors.
        }
        XCTAssertEqual(resources, baseline, "Rejected bitmap output must release the renderer's memory resources")
    }

    func testCancelledRendersReleaseResourcesAndNextPlaceStillRenders() async throws {
        try await prepareTransport()
        let fixture = try makeBasemap()
        defer { fixture.lease.release() }
        let baseline = resources
        var cancellationCount = 0
        for index in 0..<6 {
            let place = places[index % places.count]
            let camera = try camera(for: place)
            let weather = weatherImage(camera: camera, wet: false)
            let renderer = NativeRadarPreviewSnapshotter()
            let operation = Task { @MainActor in
                try await renderer.render(place: place, camera: camera, basemap: fixture.basemap,
                                          weatherImage: weather, weatherTiles: nil)
            }
            // Give render() one actor turn to install its lease and suspend in
            // the SDK. Cancellation is also correct if it wins before start.
            await Task.yield()
            operation.cancel()
            do {
                let image = try await operation.value
                // Completion may legitimately win a cancellation race.
                assertMap(image, camera: camera, context: "completion won cancellation race")
            } catch is CancellationError {
                cancellationCount += 1
            } catch { XCTFail("Cancellation must not become an unrelated snapshot error") }
            await Task.yield()
            XCTAssertEqual(resources, baseline, "Cancellation must release both style and weather resources")
        }
        XCTAssertGreaterThan(cancellationCount, 0, "The cancellation path must actually be exercised")
        let camera = try camera(for: indianapolis)
        let image = try await render(indianapolis, camera: camera, basemap: fixture.basemap, wet: false)
        assertMap(image, camera: camera, context: "first complete render after cancellation")
        XCTAssertEqual(resources, baseline)
    }

    func testMissingWeatherInputFailsWithoutLeakingALease() async throws {
        try await prepareTransport()
        let fixture = try makeBasemap()
        defer { fixture.lease.release() }
        let baseline = resources
        do {
            _ = try await NativeRadarPreviewSnapshotter().render(place: maryville, camera: camera(for: maryville),
                basemap: fixture.basemap, weatherImage: nil, weatherTiles: nil)
            XCTFail("No weather source must fail before a snapshot is presented")
        } catch { }
        XCTAssertEqual(resources, baseline)
    }

    /// This makes live provider traffic only when explicitly opted in. All
    /// configuration and tile URLs stay inside the redacting production APIs.
    func testOptInAuthorizedLiveBasemapAcrossReportedPlaces() async throws {
        guard ProcessInfo.processInfo.environment["NEARCAST_TEST_LIVE_BASEMAP"] == "1" else {
            throw XCTSkip("Live basemap checks are opt-in; offline renderer regressions remain the default")
        }
        try await prepareTransport()
        let client = NativeBasemapClient(endpoint: NativeBasemapClient.endpoint(for: "app.nearcast.ios.dev"))
        guard case .ready(let catalog) = await client.load() else {
            XCTFail("Authorized development basemap configuration was unavailable")
            return
        }
        NativeBasemapNetwork.activate(catalog)
        let baseline = resources
        for place in places {
            let camera = try camera(for: place)
            let image = try await render(place, camera: camera, basemap: catalog.streets, wet: false)
            assertMap(image, camera: camera, context: "live dry map, \(place.name)")
            XCTAssertEqual(resources, baseline)
        }
        let camera = try camera(for: nokomis)
        let wet = try await render(nokomis, camera: camera, basemap: catalog.streets, wet: true)
        assertMap(wet, camera: camera, context: "live basemap with fixture rain")
        XCTAssertEqual(resources, baseline)
    }

    private func prepareTransport() async throws {
        guard await NativeBasemapNetwork.prepareCache(bundleIdentifier: "app.nearcast.ios.dev"),
              NativeBasemapNetwork.install(bundleIdentifier: "app.nearcast.ios.dev") else {
            XCTFail("Could not prepare the production snapshot transport")
            throw FixtureFailure.unavailable
        }
    }

    private func camera(for place: NativePreviewPlace) throws -> NativeRadarPreviewPolicy.Camera {
        try XCTUnwrap(NativeRadarPreviewPolicy.camera(latitude: place.latitude, longitude: place.longitude,
                                                     width: 360, height: 200))
    }

    private func render(_ place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera,
                        basemap: NativeBasemapDescriptor, wet: Bool) async throws -> UIImage {
        try await render(place, camera: camera, basemap: basemap,
                         weatherImage: weatherImage(camera: camera, wet: wet), weatherTiles: nil)
    }

    private func render(_ place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera,
                        basemap: NativeBasemapDescriptor, weatherImage: NativeRadarImage?,
                        weatherTiles: NativeRadarTileLayer?) async throws -> UIImage {
        let renderer = NativeRadarPreviewSnapshotter()
        let operation = Task { @MainActor in
            try await renderer.render(place: place, camera: camera, basemap: basemap,
                                      weatherImage: weatherImage, weatherTiles: weatherTiles)
        }
        let deadline = Task { @MainActor in
            try await Task.sleep(nanoseconds: 20_000_000_000)
            operation.cancel()
        }
        defer { deadline.cancel() }
        return try await operation.value
    }

    private func makeBasemap(seedOnly: Bool = false) throws -> (lease: NativeBasemapMemoryResourceProtocol.Lease, basemap: NativeBasemapDescriptor) {
        let lease = NativeBasemapMemoryResourceProtocol.Lease()
        let base = image { context in
            (seedOnly ? UIColor(red: 20 / 255, green: 35 / 255, blue: 47 / 255, alpha: 1)
                      : UIColor(red: 0.30, green: 0.42, blue: 0.55, alpha: 1)).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 256, height: 256))
            guard !seedOnly else { return }
            UIColor(red: 0.12, green: 0.27, blue: 0.47, alpha: 1).setFill()
            context.fill(CGRect(x: 30, y: 0, width: 38, height: 256))
            UIColor(white: 0.86, alpha: 1).setStroke()
            context.cgContext.setLineWidth(6)
            context.cgContext.move(to: CGPoint(x: 0, y: 30))
            context.cgContext.addLine(to: CGPoint(x: 256, y: 210))
            context.cgContext.move(to: CGPoint(x: 0, y: 180))
            context.cgContext.addLine(to: CGPoint(x: 256, y: 70))
            context.cgContext.strokePath()
        }
        let transparent = image { _ in }
        guard let basePNG = base.pngData(), let transparentPNG = transparent.pngData(),
              lease.install(["base.png": .init(data: basePNG, mimeType: "image/png"),
                             "labels.png": .init(data: transparentPNG, mimeType: "image/png")]) else {
            throw FixtureFailure.unavailable
        }
        func source(_ name: String) -> NativeBasemapRasterSource {
            .init(id: "fixture-" + name, tileURLTemplates: [lease.url(name + ".png").absoluteString],
                  tileSize: 256, minimumZoom: 0, maximumZoom: 18, attributions: [])
        }
        return (lease, NativeBasemapDescriptor(background: source("base"), labels: source("labels")))
    }

    private func makeWeatherRaster() throws -> (lease: NativeBasemapMemoryResourceProtocol.Lease,
                                                dry: NativeRadarTileLayer, wet: NativeRadarTileLayer) {
        let lease = NativeBasemapMemoryResourceProtocol.Lease()
        let dry = image { _ in }
        let wet = image { context in
            UIColor(red: 0.10, green: 0.92, blue: 0.24, alpha: 0.94).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 24, y: 24, width: 208, height: 208))
        }
        guard let dryPNG = dry.pngData(), let wetPNG = wet.pngData(),
              lease.install(["dry.png": .init(data: dryPNG, mimeType: "image/png"),
                             "wet.png": .init(data: wetPNG, mimeType: "image/png")]) else {
            throw FixtureFailure.unavailable
        }
        func layer(_ name: String) -> NativeRadarTileLayer {
            // Each requested XYZ resolves to the same in-memory 256px tile.
            // Zoom limits match the global provider, including overzooming.
            .init(id: "fixture-global-" + name, templates: [lease.url(name + ".png").absoluteString],
                  minimumZoom: 0, maximumZoom: 7, credits: [])
        }
        return (lease, layer("dry"), layer("wet"))
    }

    private func weatherImage(camera: NativeRadarPreviewPolicy.Camera, wet: Bool) -> NativeRadarImage {
        let bitmap = image { context in
            guard wet else { return }
            UIColor(red: 0.10, green: 0.92, blue: 0.24, alpha: 0.94).setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 28, y: 56, width: 156, height: 144))
        }
        return NativeRadarImage(id: "fixture-" + UUID().uuidString, image: bitmap,
            west: camera.west, south: camera.south, east: camera.east, north: camera.north)
    }

    private func image(_ draw: (UIGraphicsImageRendererContext) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256), format: format).image(actions: draw)
    }

    private func assertMap(_ image: UIImage, camera: NativeRadarPreviewPolicy.Camera, context: String,
                           file: StaticString = #filePath, line: UInt = #line) {
        guard let bitmap = image.cgImage else { XCTFail("Missing rendered bitmap: " + context, file: file, line: line); return }
        XCTAssertEqual(bitmap.width, Int(camera.width * camera.scale), context, file: file, line: line)
        XCTAssertEqual(bitmap.height, Int(camera.height * camera.scale), context, file: file, line: line)
        guard let pixels = try? pixels(image) else { XCTFail("Unreadable rendered bitmap: " + context, file: file, line: line); return }
        var opaque = 0, nonSeed = 0
        var colors = Set<Int>()
        for i in stride(from: 0, to: pixels.count, by: 4) {
            if pixels[i + 3] >= 250 { opaque += 1 }
            if abs(Int(pixels[i]) - 20) + abs(Int(pixels[i + 1]) - 35) + abs(Int(pixels[i + 2]) - 47) > 20 { nonSeed += 1 }
            colors.insert((Int(pixels[i]) / 16 << 8) | (Int(pixels[i + 1]) / 16 << 4) | Int(pixels[i + 2]) / 16)
        }
        XCTAssertGreaterThan(opaque, 1900, "Map should be opaque: " + context, file: file, line: line)
        XCTAssertGreaterThan(nonSeed, 1000, "Map must not be the diagnostic background: " + context, file: file, line: line)
        XCTAssertGreaterThan(colors.count, 3, "Map must contain geographic detail, not a flat color: " + context, file: file, line: line)
    }

    private func greenPixelCount(_ image: UIImage) throws -> Int {
        let values = try pixels(image)
        return stride(from: 0, to: values.count, by: 4).filter { i in
            Int(values[i + 1]) > Int(values[i]) + 60 && Int(values[i + 1]) > Int(values[i + 2]) + 60
        }.count
    }

    private func pixels(_ image: UIImage) throws -> [UInt8] {
        let bitmap = try XCTUnwrap(image.cgImage)
        var values = [UInt8](repeating: 0, count: 64 * 32 * 4)
        let success = values.withUnsafeMutableBytes { storage -> Bool in
            guard let context = CGContext(data: storage.baseAddress, width: 64, height: 32,
                bitsPerComponent: 8, bytesPerRow: 64 * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(bitmap, in: CGRect(x: 0, y: 0, width: 64, height: 32))
            return true
        }
        guard success else { throw FixtureFailure.unavailable }
        return values
    }

    private enum FixtureFailure: Error { case unavailable }
}
