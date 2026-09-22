import Foundation

@main
struct NativeSkyStarsTests {
    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    private static func near(_ value: Double, _ expected: Double, _ message: String,
                             tolerance: Double = 1e-9) {
        expect(value.isFinite && abs(value - expected) <= tolerance, message)
    }

    static func main() {
        verifyEditorialField()
        verifyBoundedTwinkle()
        verifyMoonOcclusion()
        print("PASS Native sky stars: stable 78-star field, bounded sparse opacity-only twinkle, quiet forecast region, smooth perpetual loops, finite input handling, full moon-disc occlusion")
    }

    private static func verifyEditorialField() {
        let stars = NativeSkyStarField.stars
        expect(stars.count == 78 && stars == NativeSkyStarField.stars,
               "The field keeps exactly 78 deterministic editorial stars")
        var state: UInt64 = 0x4E45415243415354
        func next() -> Double {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Double(state >> 11) / 9007199254740992
        }
        for (index, star) in stars.enumerated() {
            let x = 0.03 + next() * 0.94
            let y = 0.035 + next() * 0.68
            let radius = index % 13 == 0 ? 1.05 : 0.40 + next() * 0.35
            let opacity = 0.36 + next() * 0.55
            let central = exp(-pow((x - 0.5) / 0.25, 2) - pow((y - 0.39) / 0.17, 2))
            near(star.x, x, "Twinkle does not reshuffle horizontal star placement")
            near(star.y, y, "Twinkle does not reshuffle vertical star placement")
            near(star.radius, radius, "Twinkle does not enlarge or shrink stars")
            near(star.opacity, opacity * (1 - central * 0.83),
                 "The original soft quiet region behind the forecast is retained")
            expect((0.03...0.97).contains(star.x) && (0.035...0.715).contains(star.y)
                && star.radius > 0 && star.radius <= 1.05 && star.opacity > 0 && star.opacity <= 0.91,
                   "Star placement, size and baseline visibility are finite and bounded")
        }
        let animated = stars.filter { $0.twinkle != nil }
        let steady = stars.filter { $0.twinkle == nil }
        expect(animated.count > 0 && animated.count <= 6 && steady.count >= 72,
               "Only a few bright stars twinkle; at least 72 remain steady")
        let brightness: (NativeSkyStarField.Star) -> Double = { $0.radius * $0.radius * $0.opacity }
        expect((animated.map(brightness).min() ?? 0) >= (steady.map(brightness).max() ?? 1),
               "Twinklers are selected by the existing field's brightness, not arbitrary new points")
        for star in steady {
            for elapsed in [0.0, 1, 25, 86_400, Double.greatestFiniteMagnitude] {
                near(star.opacity(elapsed: elapsed), star.opacity, "Most stars remain perfectly steady")
            }
        }
    }

    private static func verifyBoundedTwinkle() {
        let animated = NativeSkyStarField.stars.filter { $0.twinkle != nil }
        let profiles = animated.compactMap(\.twinkle)
        expect(Set(profiles.map(\.duration)).count == profiles.count
            && Set(profiles.map(\.phaseOffset)).count == profiles.count,
               "Different slow periods and phase offsets prevent synchronized flashing")
        for star in animated {
            guard let profile = star.twinkle else { preconditionFailure("A selected star has a profile") }
            expect(profile.duration >= 8 && profile.duration <= 18
                && profile.amplitude > 0 && profile.amplitude <= 0.25
                && profile.phaseOffset >= 0 && profile.phaseOffset < 1,
                   "Every profile is a slow, shallow, bounded brightness change")
            for phase in stride(from: 0.0, through: 1.0, by: 0.001) {
                let multiplier = profile.multiplier(phase: phase)
                expect(multiplier.isFinite && multiplier >= 1 - profile.amplitude - 1e-9
                    && multiplier <= 1 + profile.amplitude + 1e-9,
                       "Twinkle stays inside its declared shallow opacity envelope")
            }
            near(profile.multiplier(phase: 0), profile.multiplier(phase: 1),
                 "Loop endpoints have identical brightness")
            let epsilon = 1e-6
            expect(abs(profile.multiplier(phase: epsilon) - profile.multiplier(phase: 1 - epsilon)) < 0.000_01,
                   "Brightness is continuous on both sides of every loop seam")
            let leftSlope = (profile.multiplier(phase: 1) - profile.multiplier(phase: 1 - epsilon)) / epsilon
            let rightSlope = (profile.multiplier(phase: epsilon) - profile.multiplier(phase: 0)) / epsilon
            expect(abs(leftSlope - rightSlope) < 0.000_1,
                   "Twinkle has no abrupt speed change when the loop repeats")
            for elapsed in [0.0, 1, 31, 180, 86_400, 31_536_000, Double.greatestFiniteMagnitude] {
                let phase = profile.phase(elapsed: elapsed)
                let opacity = star.opacity(elapsed: elapsed)
                expect(phase.isFinite && phase >= 0 && phase < 1 && opacity.isFinite && opacity > 0 && opacity <= 1,
                       "Arbitrarily long running time stays within finite phase and opacity bounds")
                near(opacity, min(1, star.opacity * profile.multiplier(elapsed: elapsed)),
                     "Only the star's own existing opacity is modulated")
            }
            near(profile.multiplier(elapsed: 2.37), profile.multiplier(elapsed: 2.37 + 12 * profile.duration),
                 "Twelve complete loops preserve brightness", tolerance: 1e-8)
            for invalid in [Double.nan, .infinity, -.infinity, -1] {
                near(profile.multiplier(elapsed: invalid), profile.multiplier(elapsed: 0),
                     "Invalid and negative elapsed inputs fall back to a finite initial phase")
                expect(star.opacity(elapsed: invalid).isFinite, "Invalid time cannot expose NaN to Core Animation")
            }
        }
    }

    private static func verifyMoonOcclusion() {
        for size in [(160.0, 200.0), (430.0, 932.0), (1_024.0, 1_366.0)] {
            for star in NativeSkyStarField.stars {
                expect(!star.isOccluded(width: size.0, height: size.1,
                                        moonX: nil, moonY: nil, moonDiameter: 54),
                       "Moonless skies retain every editorial star")
                expect(star.isOccluded(width: size.0, height: size.1,
                                       moonX: star.x, moonY: star.y, moonDiameter: 54),
                       "The entire moon disc occludes stars, independent of illuminated crescent")
                let boundary = (27 + star.radius) / size.0
                expect(star.isOccluded(width: size.0, height: size.1,
                                       moonX: star.x + boundary * 0.999, moonY: star.y, moonDiameter: 54),
                       "A star touching the moon is hidden including its point radius")
                expect(!star.isOccluded(width: size.0, height: size.1,
                                        moonX: star.x + boundary * 1.001, moonY: star.y, moonDiameter: 54),
                       "Stars outside the moon silhouette remain in place")
            }
        }
    }
}
