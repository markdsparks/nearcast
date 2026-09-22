import Foundation

/// A slow, smooth brightness change around the star's original brightness.
/// Elapsed time is active time supplied by the sky owner, never wall time.
/// Profiles cannot blink out: their multiplier stays between 0.78 and 1.22.
struct NativeSkyTwinkleProfile: Equatable, Sendable {
    let duration: Double
    let phaseOffset: Double
    let amplitude: Double

    init(duration: Double, phaseOffset: Double, amplitude: Double) {
        self.duration = duration.isFinite ? min(15, max(8, duration)) : 12
        self.phaseOffset = phaseOffset.isFinite
            ? (phaseOffset.truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1) : 0
        self.amplitude = amplitude.isFinite ? min(0.22, max(0, amplitude)) : 0
    }

    func phase(elapsed: Double) -> Double {
        let safe = elapsed.isFinite ? max(0, elapsed) : 0
        let cycle = safe.truncatingRemainder(dividingBy: duration) / duration
        return (cycle + phaseOffset).truncatingRemainder(dividingBy: 1)
    }

    func multiplier(elapsed: Double) -> Double {
        multiplier(phase: phase(elapsed: elapsed))
    }

    /// The renderer samples one cycle into a compositor-only opacity curve.
    /// No scale, position, size, or color is animated.
    func multiplier(phase: Double) -> Double {
        let safe = phase.isFinite ? phase.truncatingRemainder(dividingBy: 1) : 0
        return 1 + amplitude * sin(2 * .pi * safe)
    }
}

/// Stable editorial stars, not constellation data or a local visibility claim.
/// The original 78 coordinates, radii, opacity values, and central quiet
/// region are unchanged. Six of the brightest stars gain optional profiles;
/// the other 72 stars remain a single, steady cached image.
enum NativeSkyStarField {
    struct Star: Equatable, Sendable {
        let x: Double
        let y: Double
        let radius: Double
        let opacity: Double
        let twinkle: NativeSkyTwinkleProfile?

        /// Bounded visible core opacity before the scene's visibility factor.
        func opacity(elapsed: Double) -> Double {
            min(1, max(0, opacity * (twinkle?.multiplier(elapsed: elapsed) ?? 1)))
        }

        /// The moon's full disc occludes stars, including its dark hemisphere.
        /// Coordinates are normalized; dimensions and radius are in points.
        func isOccluded(width: Double, height: Double, moonX: Double?, moonY: Double?,
                        moonDiameter: Double) -> Bool {
            guard width.isFinite, height.isFinite, width > 0, height > 0,
                  let moonX, let moonY, moonX.isFinite, moonY.isFinite,
                  moonDiameter.isFinite else { return false }
            return hypot(width * x - width * moonX, height * y - height * moonY)
                < max(0, moonDiameter) / 2 + radius
        }
    }

    static let stars: [Star] = {
        var state: UInt64 = 0x4E45415243415354
        func next() -> Double {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Double(state >> 11) / 9007199254740992
        }
        var values: [Star] = []
        for index in 0..<78 {
            let x = 0.03 + next() * 0.94
            let y = 0.035 + next() * 0.68
            let radius = index % 13 == 0 ? 1.05 : 0.40 + next() * 0.35
            let opacity = 0.36 + next() * 0.55
            // Leave the core forecast region quiet without a rectangular hole.
            let central = exp(-pow((x - 0.5) / 0.25, 2) - pow((y - 0.39) / 0.17, 2))
            values.append(Star(x: x, y: y, radius: radius,
                opacity: opacity * (1 - central * 0.83), twinkle: nil))
        }
        // Integrated brightness favors the established brighter/larger stars
        // without introducing points into the quiet center or moving any star.
        let brightest = values.indices.sorted {
            let lhs = values[$0].opacity * values[$0].radius * values[$0].radius
            let rhs = values[$1].opacity * values[$1].radius * values[$1].radius
            return lhs == rhs ? $0 < $1 : lhs > rhs
        }.prefix(6)
        let profiles: [NativeSkyTwinkleProfile] = [
            .init(duration: 8.9, phaseOffset: 0.06, amplitude: 0.20),
            .init(duration: 10.7, phaseOffset: 0.39, amplitude: 0.22),
            .init(duration: 12.3, phaseOffset: 0.73, amplitude: 0.18),
            .init(duration: 14.1, phaseOffset: 0.21, amplitude: 0.21),
            .init(duration: 9.8, phaseOffset: 0.57, amplitude: 0.19),
            .init(duration: 13.4, phaseOffset: 0.88, amplitude: 0.22)
        ]
        for (rank, index) in brightest.enumerated() {
            let star = values[index]
            values[index] = Star(x: star.x, y: star.y, radius: star.radius,
                opacity: star.opacity, twinkle: profiles[rank])
        }
        return values
    }()
}
