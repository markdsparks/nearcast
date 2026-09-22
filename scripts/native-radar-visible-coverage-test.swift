import Foundation

@main
enum NativeRadarVisibleCoverageTests {
    typealias Bounds = NativeRadarFrameCacheViewport

    static func verify(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
            exit(1)
        }
    }

    static func approximately(_ actual: Double?, _ expected: Double, _ message: String,
                              tolerance: Double = 1e-10) {
        guard let actual, actual.isFinite, abs(actual - expected) <= tolerance else {
            fatalError("\(message): expected \(expected), got \(String(describing: actual))")
        }
    }

    // Fixtures use known raster-cell edges in Web Mercator, not latitude-linear
    // interpolation. This is also how the app projects its rendered fields.
    static func mercatorY(_ latitude: Double) -> Double {
        log(tan(.pi / 4 + latitude * .pi / 360))
    }

    static func latitude(_ y: Double) -> Double {
        (2 * atan(exp(y)) - .pi / 2) * 180 / .pi
    }

    static func crop(_ image: Bounds, left: Double, top: Double,
                     right: Double, bottom: Double) -> Bounds {
        let yNorth = mercatorY(image.north), ySouth = mercatorY(image.south)
        let xSpan = image.east - image.west, ySpan = yNorth - ySouth
        return .init(west: image.west + left * xSpan,
                     south: latitude(yNorth - bottom * ySpan),
                     east: image.west + right * xSpan,
                     north: latitude(yNorth - top * ySpan))
    }

    static func main() {
        let image = Bounds(west: -10, south: -10, east: 10, north: 10)
        let width = 100, height = 100
        let visible = crop(image, left: 0.2, top: 0.2, right: 0.8, bottom: 0.8)
        func interiorCovered(_ index: Int) -> Bool {
            let x = index % width, y = index / width
            return (20..<80).contains(x) && (20..<80).contains(y)
        }
        func fraction(_ viewport: Bounds, _ mask: (Int) -> Bool) -> Double? {
            NativeRadarVisibleCoverage.fraction(width: width, height: height,
                imageBounds: image, visibleBounds: viewport, isCovered: mask)
        }

        approximately(fraction(visible, interiorCovered), 1,
            "Offscreen padding holes must not report missing on-screen coverage")
        approximately(fraction(image, interiorCovered), 0.36,
            "Real holes remain unavailable when the whole envelope is visible")

        // The image/envelope stays the same; only the camera moves. A cached
        // frame's coverage must therefore be recomputed for the new visible crop.
        let paddedEdge = crop(image, left: 0, top: 0.2, right: 0.2, bottom: 0.8)
        approximately(fraction(paddedEdge, interiorCovered), 0,
            "Panning into cached-envelope holes must reveal missing coverage")
        let crossingEdge = crop(image, left: 0.1, top: 0.2, right: 0.7, bottom: 0.8)
        approximately(fraction(crossingEdge, interiorCovered), 5.0 / 6,
            "Mixed valid and invalid visible pixels count only their on-screen area")
        approximately(fraction(visible, interiorCovered), 1,
            "Panning back must clear the peripheral warning without reloading imagery")
        print("PASS visible coverage: padded-edge holes, same-envelope pans, real holes, and return-to-view")

        // Clear weather is valid data. This fixture has no positive reflectivity
        // anywhere; its coverage mask still says every pixel was supplied.
        let clearReflectivity = Array(repeating: UInt8(0), count: width * height)
        let clearCoverage = Array(repeating: true, count: width * height)
        verify(clearReflectivity.allSatisfy { $0 == 0 }, "clear-weather fixture is entirely dry")
        approximately(fraction(visible) { clearCoverage[$0] }, 1,
            "No precipitation must never be mistaken for no coverage")
        approximately(fraction(visible) { _ in false }, 0,
            "An entirely missing visible mask is genuinely unavailable")
        approximately(fraction(visible) { index in
            interiorCovered(index) && !(48..<52).contains(index % width)
        }, 56.0 / 60, "Interior mask holes must not disappear behind an envelope check")

        // Exact overlap weighting matters along subpixel geographic boundaries.
        let fractional = crop(image, left: 0.195, top: 0.2, right: 0.205, bottom: 0.8)
        approximately(fraction(fractional, interiorCovered), 0.5,
            "A half-covered cell boundary must have half coverage, not be rounded to full or empty")
        let tinyCovered = crop(image, left: 0.201, top: 0.201, right: 0.202, bottom: 0.202)
        approximately(fraction(tinyCovered, interiorCovered), 1,
            "A subpixel visible crop is valid when its intersecting source cell is covered")

        // The denominator is the entire visible camera area, not merely the
        // portion that intersects a previously rendered image.
        let halfOutside = crop(image, left: -0.5, top: 0, right: 0.5, bottom: 1)
        approximately(fraction(halfOutside) { _ in true }, 0.5,
            "Visible area outside the image must remain unavailable")
        let expanded = crop(image, left: -0.5, top: -0.5, right: 1.5, bottom: 1.5)
        approximately(fraction(expanded) { _ in true }, 0.25,
            "A smaller image must not claim complete coverage of a larger camera")
        var samples = 0
        let disjoint = Bounds(west: 20, south: -10, east: 30, north: 10)
        approximately(fraction(disjoint) { _ in samples += 1; return true }, 0,
            "Entirely disjoint visible area has zero coverage")
        let touching = Bounds(west: 10, south: -10, east: 20, north: 10)
        approximately(fraction(touching) { _ in samples += 1; return true }, 0,
            "Touching edges have no positive area")
        verify(samples == 0, "Disjoint/touching bounds must not inspect unrelated source pixels")
        print("PASS visible coverage: clear versus missing data, partial pixels, zoomed-out and disjoint cameras")

        // Northern latitudes expose a latitude-linear crop bug. The geographic
        // midpoint is not the projected raster's midpoint.
        let northImage = Bounds(west: -20, south: 50, east: 20, north: 80)
        let southHalf = crop(northImage, left: 0, top: 0.5, right: 1, bottom: 1)
        verify(southHalf.north > 65, "high-latitude fixture must differ from latitude-linear midpoint")
        approximately(NativeRadarVisibleCoverage.fraction(width: 20, height: 20,
            imageBounds: northImage, visibleBounds: southHalf, isCovered: { $0 / 20 >= 10 }), 1,
            "Coverage raster rows must be cropped using Web Mercator at high latitudes")
        let northHalf = crop(northImage, left: 0, top: 0, right: 1, bottom: 0.5)
        approximately(NativeRadarVisibleCoverage.fraction(width: 20, height: 20,
            imageBounds: northImage, visibleBounds: northHalf, isCovered: { $0 / 20 >= 10 }), 0,
            "Northern uncovered half must not include southern covered rows")
        approximately(NativeRadarVisibleCoverage.fraction(width: 20, height: 20,
            imageBounds: northImage, visibleBounds: northImage, isCovered: { $0 / 20 >= 10 }), 0.5,
            "Projected equal-height mask halves have equal on-screen area")

        let southImage = Bounds(west: -20, south: -80, east: 20, north: -50)
        let southernTop = crop(southImage, left: 0, top: 0, right: 1, bottom: 0.5)
        approximately(NativeRadarVisibleCoverage.fraction(width: 20, height: 20,
            imageBounds: southImage, visibleBounds: southernTop, isCovered: { $0 / 20 < 10 }), 1,
            "Web Mercator row direction must also work in the southern hemisphere")
        print("PASS visible coverage: northern and southern high-latitude projected raster clipping")

        // The warning threshold concerns missing supplied pixels, not a tiny
        // floating point difference around a completely covered visible area.
        let wide = Bounds(west: -100, south: 30, east: -90, north: 40)
        let onePercentMissing = NativeRadarVisibleCoverage.fraction(width: 100, height: 1,
            imageBounds: wide, visibleBounds: wide, isCovered: { $0 != 0 })!
        let threePercentMissing = NativeRadarVisibleCoverage.fraction(width: 100, height: 1,
            imageBounds: wide, visibleBounds: wide, isCovered: { $0 >= 3 })!
        verify(onePercentMissing >= 0.98, "One percent missing should stay below the warning's significance threshold")
        verify(threePercentMissing < 0.98, "Three percent missing must still be noticeable to warning policy")

        var invalidSamples = 0
        func invalid(_ width: Int, _ height: Int, _ imageBounds: Bounds = image,
                     _ visibleBounds: Bounds = visible) {
            let result = NativeRadarVisibleCoverage.fraction(width: width, height: height,
                imageBounds: imageBounds, visibleBounds: visibleBounds,
                isCovered: { _ in invalidSamples += 1; return true })
            verify(result == nil, "Invalid dimensions/bounds must return no coverage estimate")
        }
        invalid(0, 100); invalid(100, 0); invalid(-1, 100); invalid(100, -1)
        invalid(Int.max, 2); invalid(2, Int.max)
        invalid(4097, 1); invalid(1, 4097); invalid(4096, 2048)
        invalid(100, 100, .init(west: 1, south: 0, east: 0, north: 1))
        invalid(100, 100, .init(west: 0, south: 1, east: 1, north: 0))
        invalid(100, 100, .init(west: .nan, south: 0, east: 1, north: 1))
        invalid(100, 100, .init(west: 0, south: 0, east: .infinity, north: 1))
        invalid(100, 100, image, .init(west: -181, south: 0, east: 1, north: 1))
        invalid(100, 100, image, .init(west: 0, south: -86, east: 1, north: 1))
        invalid(100, 100, image, .init(west: 0, south: 0, east: 181, north: 1))
        invalid(100, 100, image, .init(west: 0, south: 0, east: 1, north: 86))
        invalid(100, 100, image, .init(west: 0, south: 0, east: 0, north: 1))
        verify(invalidSamples == 0, "Invalid requests must be rejected before raster sampling")

        var checkedIndices = Set<Int>()
        approximately(fraction(image) { index in
            verify((0..<(width * height)).contains(index), "Mask callback index remains inside its source raster")
            checkedIndices.insert(index)
            return true
        }, 1, "A fully covered full-raster view remains fully covered")
        verify(checkedIndices.count == width * height, "Every full-raster cell is considered exactly once")
        print("PASS visible coverage: warning significance, invalid-input bounds, finite geography, overflow guards, and valid mask indices")
    }
}
