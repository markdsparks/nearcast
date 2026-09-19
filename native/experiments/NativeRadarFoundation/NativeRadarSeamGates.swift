import Foundation

/// Prerequisites only. A passed gate does NOT itself authorize a displayed
/// nowcast or claim storm-motion accuracy. Actual estimation must also succeed.
enum NativeRadarSeamGates {
    typealias Outcome<Value: Sendable> = NativeRadarSeamEstimation.Outcome<Value>
    struct RuntimeReadiness: Equatable, Sendable {
        let anchorValidTime: String
        let cycleTime: String
        let observedAgeMinutes: Double
        let cycleAgeMinutes: Double
        let firstForecastLeadMinutes: Double
        let targetValidTimes: [String]
    }

    /// Matches raw-map-runtime's fresh anchor (8 minutes), first model lead
    /// (0...30, exclusive at zero), cycle age (150 minutes), and first six exact
    /// targets through +70. Intentionally stricter than JS: no future observed
    /// anchor/cycle grace, no unbound explicit cycle-age override, no duplicates.
    static func runtimeReadiness(observedTimes: [String], forecastTimes: [String],
                                  cycleTime: String, requestedAt: String) throws -> Outcome<RuntimeReadiness> {
        try Task.checkCancellation()
        guard observedTimes.count >= 2, !forecastTimes.isEmpty else { return .unavailable("observed-and-forecast-frames-required") }
        guard observedTimes.count <= 32, forecastTimes.count <= 12 else { return .unavailable("frame-budget-exceeded") }
        let observed = try observedTimes.map(RadarNumericContract.parseTime).sorted()
        let forecast = try forecastTimes.map(RadarNumericContract.parseTime).sorted()
        guard Set(observed).count == observed.count, Set(forecast).count == forecast.count else { return .unavailable("duplicate-source-times") }
        let requested = try RadarNumericContract.parseTime(requestedAt), cycle = try RadarNumericContract.parseTime(cycleTime)
        let anchor = observed.last!, observedAge = Double(requested - anchor) / 60_000
        guard observedAge >= 0, observedAge <= 8 else { return .unavailable("observed-frame-too-old") }
        let firstLead = Double(forecast[0] - anchor) / 60_000
        guard firstLead > 0, firstLead <= 30 else { return .unavailable("forecast-boundary-outside-safe-window") }
        let cycleAge = Double(requested - cycle) / 60_000
        guard cycleAge >= 0, cycleAge <= 150 else { return .unavailable("forecast-cycle-too-old") }
        let targets = Array(forecast.filter {
            let lead = Double($0 - anchor) / 60_000
            return lead > 0 && lead <= 70
        }.prefix(6)).map(RadarNumericContract.isoTime)
        guard !targets.isEmpty else { return .unavailable("no-safe-handoff-targets") }
        return .ready(RuntimeReadiness(anchorValidTime: RadarNumericContract.isoTime(anchor),
            cycleTime: RadarNumericContract.isoTime(cycle), observedAgeMinutes: observedAge,
            cycleAgeMinutes: cycleAge, firstForecastLeadMinutes: firstLead, targetValidTimes: targets))
    }

    struct AdvectedTarget: Equatable, Sendable {
        let targetValidTime: String
        let anchorValidTime: String
        let leadMinutes: Double
        let displacementX: Double, displacementY: Double
        let geometricCoverage: Double
        let confidence: Double
        var confidenceLevel: String { NativeRadarSeamEstimation.confidenceLevel(confidence) }
    }

    /// Port of generateNowcast's target/coverage/confidence gates, but WITHOUT
    /// allocating or labeling forecast pixels. Coverage is rectangular geometry,
    /// not a replacement for a translated per-pixel validity mask. A later native
    /// advector must preserve that mask and pass it through all derived frames.
    static func advectionTargets(motion: NativeRadarSeamEstimation.Motion,
                                  targetValidTimes: [String]) throws -> Outcome<[AdvectedTarget]> {
        try Task.checkCancellation()
        guard !targetValidTimes.isEmpty, targetValidTimes.count <= 6 else { return .unavailable("too-many-nowcast-targets") }
        guard motion.width >= 8, motion.height >= 8,
              motion.width <= RadarNumericContract.maximumTexturePixels / motion.height,
              motion.velocityX.isFinite, motion.velocityY.isFinite, motion.confidence.isFinite,
              hypot(motion.velocityX, motion.velocityY) <= 1.5,
              (0.5...1).contains(motion.confidence) else { return .unavailable("supplied-motion-does-not-match-observed-anchor") }
        let anchor = try RadarNumericContract.parseTime(motion.anchorValidTime)
        let times = Array(Set(try targetValidTimes.map(RadarNumericContract.parseTime))).sorted()
        let leads = times.map { Double($0 - anchor) / 60_000 }
        guard leads.allSatisfy({ $0 > 0 && $0 <= 90 }) else { return .unavailable("nowcast-target-outside-safe-bounds") }
        let roundedLeads = leads.map(roundThreeDecimals)
        let maximumLead = roundedLeads.last!
        guard maximumLead > 0 else { return .unavailable("nowcast-target-outside-safe-bounds") }
        let maximumCoverage = coverage(width: motion.width, height: motion.height,
                                       dx: motion.velocityX * maximumLead, dy: motion.velocityY * maximumLead)
        guard maximumCoverage >= 0.58 else { return .unavailable("nowcast-leaves-observed-domain") }
        return .ready(times.indices.map { index in
            let lead = roundedLeads[index], dx = motion.velocityX * lead, dy = motion.velocityY * lead
            let retained = coverage(width: motion.width, height: motion.height, dx: dx, dy: dy)
            return AdvectedTarget(targetValidTime: RadarNumericContract.isoTime(times[index]), anchorValidTime: motion.anchorValidTime,
                leadMinutes: lead, displacementX: dx, displacementY: dy, geometricCoverage: retained,
                confidence: NativeRadarSeamEstimation.clamp01(motion.confidence * retained * (1 - 0.28 * (lead / maximumLead))))
        })
    }

    private static func coverage(width: Int, height: Int, dx: Double, dy: Double) -> Double {
        NativeRadarSeamEstimation.clamp01(max(0, Double(width) - abs(dx)) * max(0, Double(height) - abs(dy)) / Double(width * height))
    }
    private static func roundThreeDecimals(_ lead: Double) -> Double {
        // Exact Number(lead.toFixed(3)), preserving decimal-half tie behavior.
        let bits = lead.bitPattern
        let significand = (bits & ((UInt64(1) << 52) - 1)) | (UInt64(1) << 52)
        let shift = 1075 - Int((bits >> 52) & 0x7ff), numerator = significand * 1000
        guard shift < 64 else { return 0 }
        let integer = numerator >> shift, remainder = numerator & ((UInt64(1) << shift) - 1)
        return Double(integer + (remainder >= (UInt64(1) << (shift - 1)) ? 1 : 0)) / 1000
    }
}
