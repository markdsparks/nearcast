import Foundation

/// Active time, not wall time: reading, backgrounding and accessibility/power
/// pauses bank progress without restarting the weather when motion resumes.
/// No timer or display link lives here; Core Animation owns drawing frames.
struct NativeSkyDriftTimeline: Equatable, Sendable {
    private(set) var isRunning = false
    private var accumulated: Double = 0
    private var segmentStart: Double?
    private var lastTransition: Double?

    mutating func setRunning(_ running: Bool, at time: Double) {
        guard time.isFinite else { return }
        let instant = max(time, lastTransition ?? time)
        accumulated = elapsed(at: instant)
        lastTransition = instant
        isRunning = running
        segmentStart = running ? instant : nil
    }

    func elapsed(at time: Double) -> Double {
        guard isRunning, let segmentStart, time.isFinite else { return accumulated }
        let delta = max(0, time - segmentStart)
        let total = accumulated + delta
        return total.isFinite ? total : Double.greatestFiniteMagnitude
    }

    mutating func reset(at time: Double) {
        guard time.isFinite else { return }
        accumulated = 0
        segmentStart = nil
        isRunning = false
        lastTransition = max(time, lastTransition ?? time)
    }
}

enum NativeSkyCloudArtwork: String, CaseIterable, Sendable {
    case brokenClouds
    case canopy
    case stormVeil

    var assetName: String {
        self == .canopy ? "LivingSkyOvercast" : "LivingSkyCloudLayer"
    }

    /// Different periods and crops prevent two copies of the same photograph
    /// from looking like stacked wallpaper. The near field travels ~8 points
    /// in five seconds; the distant field is less than half as fast.
    var planes: [NativeSkyCloudPlane] {
        switch self {
        case .brokenClouds:
            return [
                .init(name: "far", duration: 227, travelX: 160, travelY: -12,
                      opacity: 0.24, scale: 1.18, verticalOffset: -48, phaseOffset: 0.19),
                .init(name: "near", duration: 163, travelX: 256, travelY: -20,
                      opacity: 1, scale: 1, verticalOffset: 0, phaseOffset: 0.5)
            ]
        case .canopy:
            return [.init(name: "canopy", duration: 223, travelX: 192, travelY: -12,
                          opacity: 1, scale: 1, verticalOffset: 0, phaseOffset: 0.5)]
        case .stormVeil:
            // A larger, closer cloud mass passes the diffuse light opening.
            // Different travel/crop from the ceiling supplies depth without
            // a flashing light source or a claim of observed lightning.
            return [.init(name: "storm-veil", duration: 197, travelX: 236, travelY: -14,
                          opacity: 1, scale: 1.22, verticalOffset: -58, phaseOffset: 0.37)]
        }
    }
}

struct NativeSkyCloudPlane: Equatable, Sendable {
    let name: String
    let duration: Double
    let travelX: Double
    let travelY: Double
    let opacity: Double
    let scale: Double
    let verticalOffset: Double
    let phaseOffset: Double

    struct Sample: Equatable, Sendable {
        let phase: Double
        let x: Double
        let y: Double
        let opacity: Double
    }

    // Overscan covers BOTH signed endpoints, shifted crops and a small
    // interpolation margin. It is independent of the current animation phase.
    var horizontalOverscan: Double { abs(travelX) + 8 }
    var verticalOverscan: Double { abs(travelY) + abs(verticalOffset) * 2 + 8 }

    func phase(elapsed: Double, copy: Int) -> Double {
        let safe = elapsed.isFinite ? max(0, elapsed) : 0
        let cycle = safe.truncatingRemainder(dividingBy: duration) / duration
        return (cycle + phaseOffset + Double(copy) * 0.5).truncatingRemainder(dividingBy: 1)
    }

    /// Recycling occurs only at zero opacity with zero opacity slope. The
    /// pair overlaps by half a cycle; there is no visible positional reset or
    /// reversing cloud, and the second depth plane has an unrelated period.
    func sample(elapsed: Double, copy: Int) -> Sample {
        sample(phase: phase(elapsed: elapsed, copy: copy))
    }

    func sample(phase: Double) -> Sample {
        let bounded = phase.isFinite ? min(1, max(0, phase)) : 0
        let envelope = pow(sin(.pi * bounded), 2)
        return Sample(phase: bounded, x: travelX * (bounded - 0.5),
                      y: travelY * (bounded - 0.5), opacity: opacity * envelope)
    }
}
