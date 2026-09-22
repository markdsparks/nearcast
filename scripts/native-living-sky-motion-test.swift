import Foundation

@main
struct NativeLivingSkyMotionTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func near(_ actual: Double, _ expected: Double, _ message: String,
                     tolerance: Double = 1e-9) {
        expect(actual.isFinite && abs(actual - expected) < tolerance, message)
    }

    static func main() {
        verifyActiveClock()
        verifyCloudPlanes()
        print("PASS Native living sky motion: continuous active time, pause/resume, explicit reset, refresh stability, clock defenses, paired depth planes, invisible recycling, bounded overscan")
    }

    private static func verifyActiveClock() {
        var timeline = NativeSkyDriftTimeline()
        expect(!timeline.isRunning, "A new timeline remains still until explicitly allowed")
        near(timeline.elapsed(at: 1_000), 0, "An idle timeline never starts itself")

        timeline.setRunning(true, at: 1_000)
        expect(timeline.isRunning, "A valid start enables continuous motion")
        near(timeline.elapsed(at: 1_045), 45, "Only elapsed active seconds count")
        timeline.setRunning(false, at: 1_045)
        expect(!timeline.isRunning, "Pause stops the running flag")
        near(timeline.elapsed(at: 100_000), 45, "Background and reading time are excluded")
        timeline.setRunning(false, at: 100_001)
        near(timeline.elapsed(at: 100_002), 45, "Repeated pause is idempotent")

        timeline.setRunning(true, at: 100_010)
        near(timeline.elapsed(at: 100_010), 45, "Resume preserves the paused time")
        near(timeline.elapsed(at: 100_055), 90, "Resume continues banked progress")
        timeline.setRunning(true, at: 100_055)
        near(timeline.elapsed(at: 100_145), 180, "Routine refresh retains accrued active time")
        timeline.setRunning(true, at: 100_145)
        expect(timeline.isRunning, "The former three-minute endpoint no longer stops motion")
        near(timeline.elapsed(at: 101_765), 1_800, "Motion remains active through many image cycles")
        timeline.setRunning(false, at: 101_765)
        near(timeline.elapsed(at: 1_000_000), 1_800, "Long pauses never accrue hidden travel")
        timeline.setRunning(true, at: 1_000_000)
        near(timeline.elapsed(at: 1_000_010), 1_810, "Resume after many cycles never replays the start")

        timeline.reset(at: 1_000_020)
        expect(!timeline.isRunning, "An identity reset stops rather than implicitly opting into motion")
        near(timeline.elapsed(at: 2_000_000), 0, "Identity reset clears all accrued time")
        timeline.setRunning(true, at: 1_000_030)
        near(timeline.elapsed(at: 1_000_060), 30, "A new identity starts its own active clock")

        var backward = NativeSkyDriftTimeline()
        backward.setRunning(true, at: 100)
        near(backward.elapsed(at: 50), 0, "Backward queries never invent negative elapsed time")
        backward.setRunning(false, at: 90)
        near(backward.elapsed(at: 200), 0, "Backward pause clamps to the latest transition")
        backward.setRunning(true, at: 80)
        near(backward.elapsed(at: 110), 10, "Backward resume cannot count earlier time twice")
        backward.setRunning(true, at: 120)
        backward.setRunning(false, at: 115)
        near(backward.elapsed(at: 130), 20, "Backward stop preserves banked progress")
        backward.reset(at: 90)
        backward.setRunning(true, at: 100)
        near(backward.elapsed(at: 130), 10, "Reset preserves the monotonic transition watermark")

        let beforeInvalid = timeline
        for invalid in [Double.nan, .infinity, -.infinity] {
            timeline.setRunning(false, at: invalid)
            expect(timeline == beforeInvalid, "Invalid stop leaves the clock intact")
            timeline.setRunning(true, at: invalid)
            expect(timeline == beforeInvalid, "Invalid start leaves the clock intact")
            timeline.reset(at: invalid)
            expect(timeline == beforeInvalid, "Invalid reset cannot erase progress")
            expect(timeline.elapsed(at: invalid).isFinite, "Invalid query never exposes NaN to the renderer")
        }

        var extreme = NativeSkyDriftTimeline()
        extreme.setRunning(true, at: -Double.greatestFiniteMagnitude)
        near(extreme.elapsed(at: .greatestFiniteMagnitude), .greatestFiniteMagnitude,
             "Finite clock subtraction overflow saturates safely")
        extreme.setRunning(false, at: .greatestFiniteMagnitude)
        expect(!extreme.isRunning && extreme.elapsed(at: 0).isFinite,
               "Extreme pause banks a finite clock")
        extreme.setRunning(true, at: .greatestFiniteMagnitude)
        near(extreme.elapsed(at: .greatestFiniteMagnitude), .greatestFiniteMagnitude,
             "Resuming an extreme clock cannot overflow its banked time")

        var manyPauses = NativeSkyDriftTimeline()
        var clock: Double = 0
        for index in 0..<1_000 {
            manyPauses.setRunning(true, at: clock)
            clock += 1
            manyPauses.setRunning(false, at: clock)
            near(manyPauses.elapsed(at: clock), Double(index + 1), "Many pauses preserve active time exactly")
            clock += 10_000
        }
        manyPauses.setRunning(true, at: clock)
        near(manyPauses.elapsed(at: clock + 10), 1_010, "Repeated lifecycle changes never exhaust motion")
    }

    private static func verifyCloudPlanes() {
        let broken = NativeSkyCloudArtwork.brokenClouds.planes
        expect(broken.map(\.name) == ["far", "near"], "Broken clouds have two ordered depth planes")
        expect(NativeSkyCloudArtwork.canopy.planes.map(\.name) == ["canopy"], "The canopy uses one paired plane")
        let storm = NativeSkyCloudArtwork.stormVeil.planes
        expect(storm.count == 1 && storm[0].name == "storm-veil",
               "Storm depth uses only one extra paired cloud plane, not a flash engine")
        expect(NativeSkyCloudArtwork.stormVeil.assetName == NativeSkyCloudArtwork.brokenClouds.assetName,
               "Storm refinement reuses the approved transparent cloud artwork")
        expect(storm[0].duration != NativeSkyCloudArtwork.canopy.planes[0].duration
               && storm[0].scale > NativeSkyCloudArtwork.canopy.planes[0].scale,
               "A closer crop and independent travel separate storm foreground from its ceiling")
        expect(broken[1].travelX / broken[1].duration > 2 * broken[0].travelX / broken[0].duration,
               "Foreground clouds travel visibly faster than distant clouds")
        expect(broken[0].duration != broken[1].duration && broken[0].scale != broken[1].scale,
               "Depth planes do not share a matching cycle and crop")

        for artwork in NativeSkyCloudArtwork.allCases {
            expect(!artwork.assetName.isEmpty, "Every motion profile has bundled artwork")
            for plane in artwork.planes {
                expect(plane.duration > 0 && plane.travelX > 0 && plane.scale >= 1,
                       "Each plane has a finite forward cycle and a safe crop")
                expect(plane.opacity > 0 && plane.opacity <= 1, "Plane opacity stays bounded")
                for phase in [0.0, 0.25, 0.5, 0.75, 1.0] {
                    let sample = plane.sample(phase: phase)
                    near(sample.phase, phase, "Explicit phase remains exact")
                    near(sample.x, plane.travelX * (phase - 0.5), "Horizontal travel remains linear")
                    near(sample.y, plane.travelY * (phase - 0.5), "Vertical travel remains linear")
                    near(sample.opacity, plane.opacity * pow(sin(.pi * phase), 2), "Visibility follows the smooth envelope")
                }
                near(plane.sample(phase: 0).opacity, 0, "A recycled image begins invisible")
                near(plane.sample(phase: 1).opacity, 0, "An outgoing image ends invisible")
                near(plane.sample(phase: 0.5).opacity, plane.opacity, "Mid-cycle image has its intended exposure")
                let epsilon = 1e-6
                expect(plane.sample(phase: epsilon).opacity / epsilon < 0.000_02
                    && plane.sample(phase: 1 - epsilon).opacity / epsilon < 0.000_02,
                       "Visibility reaches either recycling endpoint with a zero slope")

                for elapsed in [0.0, 5, 45, 180, 1_800, 86_400, 31_536_000, Double.greatestFiniteMagnitude] {
                    let first = plane.sample(elapsed: elapsed, copy: 0)
                    let second = plane.sample(elapsed: elapsed, copy: 1)
                    near(first.opacity + second.opacity, plane.opacity,
                         "Paired visibility envelopes remain complementary (not an alpha-coverage claim)")
                    for sample in [first, second] {
                        expect(sample.phase >= 0 && sample.phase < 1 && sample.x.isFinite && sample.y.isFinite,
                               "Arbitrarily long clocks produce finite bounded phases and transforms")
                        expect(abs(sample.x) <= abs(plane.travelX) / 2 && abs(sample.y) <= abs(plane.travelY) / 2,
                               "Repeated travel never escapes its declared endpoints")
                    }
                }
                for copy in 0..<2 {
                    let a = plane.sample(elapsed: 17, copy: copy)
                    let b = plane.sample(elapsed: 17 + plane.duration * 12, copy: copy)
                    near(a.x, b.x, "Twelve cycles preserve each copy's phase", tolerance: 1e-8)
                    near(a.opacity, b.opacity, "Twelve cycles preserve each copy's visibility")
                    let seam = (2 - plane.phaseOffset - Double(copy) * 0.5) * plane.duration
                    let before = plane.sample(elapsed: seam - epsilon * plane.duration, copy: copy)
                    let after = plane.sample(elapsed: seam + epsilon * plane.duration, copy: copy)
                    expect(before.phase > 0.999 && after.phase < 0.001,
                           "Each copy recycles its bounded position at its own seam")
                    expect(before.opacity < 1e-9 && after.opacity < 1e-9,
                           "Both sides of a recycling seam are invisible")
                    expect(plane.sample(elapsed: seam, copy: 1 - copy).opacity > plane.opacity * 0.999,
                           "The companion covers a copy's recycling seam")
                }
                for invalid in [Double.nan, .infinity, -.infinity, -1] {
                    expect(plane.sample(elapsed: invalid, copy: 0) == plane.sample(elapsed: 0, copy: 0),
                           "Invalid and negative elapsed inputs use a finite initial phase")
                }
                for size in [(160.0, 200.0), (430.0, 932.0), (1_024.0, 1_366.0)] {
                    let width = (size.0 + plane.horizontalOverscan) * plane.scale
                    let height = (size.1 + plane.verticalOverscan) * plane.scale
                    for phase in [0.0, 0.5, 1.0] {
                        let sample = plane.sample(phase: phase)
                        expect(width / 2 >= size.0 / 2 + abs(sample.x) + 3,
                               "Horizontal overscan covers both signed endpoints with margin")
                        expect(height / 2 >= size.1 / 2 + abs(plane.verticalOffset + sample.y) + 3,
                               "Vertical overscan covers the shifted crop and both endpoints")
                    }
                }
            }
        }
    }
}
