import Foundation

@main
enum NativeRadarTransitionTests {
    typealias Frame = NativeRadarSeamEstimation.Frame
    typealias Transition = NativeRadarTransition

    static func expect(_ condition: Bool) { precondition(condition) }

    static func rejected(_ reason: String, _ outcome: Transition.Outcome<Transition.Result>) {
        guard case let .unavailable(actual) = outcome else { preconditionFailure("Expected \(reason)") }
        precondition(actual == reason, "Expected \(reason), got \(actual)")
    }
    static func ready(_ outcome: Transition.Outcome<Transition.Result>) -> Transition.Result {
        guard case let .ready(result) = outcome else { preconditionFailure("Expected ready, got \(outcome)") }
        return result
    }

    static func main() async throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf:
            root.appendingPathComponent("scripts/fixtures/native-radar/seam-estimation.json"))) as! [String: Any]
        let bounds = RadarChunkContract.Bounds(minLat: 38, minLon: -91, maxLat: 39, maxLon: -90)
        let encoding = try RadarNumericContract.Encoding()
        let raw = fixture["textures"] as! [String: [String: Any]]
        func texture(_ id: String) throws -> RadarNumericContract.Texture {
            let definition = raw[id]!, runs = definition["rle"] as! [Int]
            var bytes: [UInt8] = []
            for index in stride(from: 0, to: runs.count, by: 2) {
                bytes.append(contentsOf: repeatElement(UInt8(runs[index + 1]), count: runs[index]))
            }
            return try .init(width: definition["width"] as! Int, height: definition["height"] as! Int, bytes: bytes)
        }
        func frame(_ texture: RadarNumericContract.Texture, _ time: String,
                   mask: [UInt8]? = nil, changedBounds: RadarChunkContract.Bounds? = nil,
                   changedEncoding: RadarNumericContract.Encoding? = nil) throws -> Frame {
            try .init(texture: texture, bounds: changedBounds ?? bounds, encoding: changedEncoding ?? encoding,
                validTime: time, validDataMask: mask ?? [UInt8](repeating: 1, count: texture.bytes.count))
        }
        let track = (fixture["motions"] as! [[String: Any]]).first { $0["name"] as? String == "raw-map-track" }!
        let observed = try (track["frames"] as! [[String: Any]]).map { try frame(texture($0["texture"] as! String), $0["validTime"] as! String) }
        let snapshots = observed.map { ($0.texture.bytes, $0.validDataMask, $0.validTime) }
        let latest = observed.last!, width = latest.texture.width, height = latest.texture.height
        let anchor = try frame(RadarNumericContract.translateTexture(latest.texture, dx: 2, dy: -3), "2026-08-17T18:30:00Z")
        let target = try frame(RadarNumericContract.translateTexture(latest.texture, dx: 14, dy: -9), "2026-08-17T19:00:00Z")
        func compose(_ observations: [Frame] = observed, anchor a: Frame? = nil, target t: Frame? = nil,
                     cycle: String = "2026-08-17T18:00:00Z", now: String = "2026-08-17T18:17:00Z") throws -> Transition.Outcome<Transition.Result> {
            try Transition.compose(observed: observations, forecastAnchor: a ?? anchor, forecastTarget: t ?? target,
                cycleTime: cycle, requestedAt: now)
        }
        let first = ready(try compose(target: anchor))
        let result = ready(try compose())
        precondition(first.evidence.forecastWeight == 0 && first.evidence.guidanceType == "radar-nowcast")
        precondition(result.evidence.forecastWeight == 0.5 && result.evidence.guidanceType == "blended-forecast")
        precondition(result.evidence.observedAt == latest.validTime && result.evidence.targetValidTime == target.validTime)
        precondition(result.evidence.modelAnchorValidTime == anchor.validTime && result.evidence.modelCycleTime == "2026-08-17T18:00:00.000Z")
        precondition(first.evidence.correctionX == 4 && first.evidence.correctionY == 0)
        precondition(abs(result.evidence.correctionX - 2.4) < 1e-12 && result.evidence.correctionY == 0)
        precondition(result.frame.validTime == target.validTime && result.frame.bounds == bounds && result.frame.encoding == encoding)
        precondition(result.evidence.observedAgeMinutes == 2 && result.evidence.cycleAgeMinutes == 17)
        precondition(result.frame.completeCoverage && result.evidence.validCoverage == 1)
        precondition(result.evidence.enhancementCoverage < 1)
        // Expected pixels use the already oracle-tested numeric composition;
        // source support and feathering are independently checked from exact
        // backward coordinates. Crop boundaries are not model coverage holes.
        let expectedPrediction = try RadarNumericContract.translateTexture(latest.texture, dx: 18, dy: -9)
        let expectedModel = try RadarNumericContract.translateTexture(target.texture, dx: 2.4, dy: 0)
        let expected = try RadarNumericContract.blendTextures(expectedPrediction, expectedModel, forecastWeight: 0.5)
        func assertEdgeFallback(_ actual: Transition.Result, original: RadarNumericContract.Texture,
                                enhanced: RadarNumericContract.Texture,
                                shifts: [(Double, Double)]) {
            var validEnhancement = 0, unchangedInterior = 0, feathered = 0, originalEdges = 0
            for row in 0..<height {
                for column in 0..<width {
                    let index = row * width + column
                    let sourceCoordinates = shifts.map { (Double(column) - $0.0, Double(row) - $0.1) }
                    let supported = sourceCoordinates.allSatisfy {
                        $0.0 >= 0 && $0.0 <= Double(width - 1) && $0.1 >= 0 && $0.1 <= Double(height - 1)
                    }
                    var edgeDistances: [Double] = [8]
                    for (offset, source) in zip(shifts, sourceCoordinates) {
                        if offset.0 > 0 { edgeDistances.append(source.0) }
                        if offset.0 < 0 { edgeDistances.append(Double(width - 1) - source.0) }
                        if offset.1 > 0 { edgeDistances.append(source.1) }
                        if offset.1 < 0 { edgeDistances.append(Double(height - 1) - source.1) }
                    }
                    let linear = supported ? max(0, min(1, edgeDistances.min()! / 8)) : 0
                    let enhancedWeight = 3 * linear * linear - 2 * linear * linear * linear
                    let value = Double(original.bytes[index])
                        + (Double(enhanced.bytes[index]) - Double(original.bytes[index])) * enhancedWeight
                    let expectedByte = UInt8(max(0, min(255, floor(value + 0.5))))
                    precondition(actual.frame.validDataMask[index] == 1, "Available original model became unavailable")
                    precondition(actual.frame.texture.bytes[index] == expectedByte, "Unexpected edge blend at \(column),\(row)")
                    if supported { validEnhancement += 1 }
                    if linear == 1 {
                        unchangedInterior += 1
                        precondition(actual.frame.texture.bytes[index] == enhanced.bytes[index])
                    } else if linear == 0 {
                        originalEdges += 1
                        precondition(actual.frame.texture.bytes[index] == original.bytes[index])
                    } else { feathered += 1 }
                }
            }
            precondition(unchangedInterior > 0 && feathered > 0 && originalEdges > 0)
            precondition(actual.evidence.enhancementCoverage == Double(validEnhancement) / Double(width * height))
            precondition(actual.evidence.validCoverage == 1)
        }
        assertEdgeFallback(result, original: target.texture, enhanced: expected, shifts: [(18, -9), (2.4, 0)])
        for row in 0..<height {
            for column in 0..<width {
                let index = row * width + column
                if column >= 26 && row <= height - 18 {
                    precondition(result.frame.texture.bytes[index] == expected.bytes[index], "Interior changed")
                }
            }
        }
        let firstExpected = try RadarNumericContract.translateTexture(latest.texture, dx: 6, dy: -3)
        assertEdgeFallback(first, original: anchor.texture, enhanced: firstExpected, shifts: [(6, -3)])
        // Nonzero original guidance at every crop edge proves fallback preserves
        // actual forecast echoes instead of merely relabeling missing/clear data.
        let edgeSignal = try RadarNumericContract.Texture(width: width, height: height,
            bytes: [UInt8](repeating: 128, count: width * height))
        let edgeTarget = try frame(edgeSignal, target.validTime)
        let edgeResult = ready(try compose(target: edgeTarget))
        let edgeEnhanced = try RadarNumericContract.blendTextures(expectedPrediction,
            RadarNumericContract.translateTexture(edgeSignal, dx: 2.4, dy: 0), forecastWeight: 0.5)
        assertEdgeFallback(edgeResult, original: edgeSignal, enhanced: edgeEnhanced, shifts: [(18, -9), (2.4, 0)])
        precondition(edgeResult.frame.texture.bytes[0] == 128)
        precondition(edgeResult.frame.texture.bytes[(height - 1) * width + width - 1] == 128)
        // At a clear-prediction scanline the eight-pixel seam is deterministic,
        // monotonic and reaches the unchanged interior without a one-pixel jump.
        var seamValues: [UInt8] = []
        for column in 18...26 { seamValues.append(edgeResult.frame.texture.bytes[column]) }
        precondition(seamValues.first == 128 && seamValues.last == 64)
        precondition(zip(seamValues, seamValues.dropFirst()).allSatisfy { $0 >= $1 })
        precondition(Set(seamValues).count > 4)
        // The result is independent of supplied history order, but never time identity.
        let reordered = ready(try compose(Array(observed.reversed())))
        precondition(reordered.frame.texture == result.frame.texture && reordered.evidence == result.evidence)
        // Opposite motion exercises the other two unknown edges and proves the
        // crop preserves displacement units rather than accidentally recentering.
        func reversed(_ source: Frame) throws -> Frame {
            try frame(.init(width: width, height: height, bytes: Array(source.texture.bytes.reversed())), source.validTime)
        }
        let reverse = ready(try compose(observed.map(reversed), anchor: reversed(anchor), target: reversed(anchor)))
        precondition(reverse.evidence.motion.velocityX == -first.evidence.motion.velocityX)
        precondition(reverse.evidence.motion.velocityY == -first.evidence.motion.velocityY)
        precondition(reverse.evidence.correctionX == -first.evidence.correctionX)
        precondition(reverse.frame.texture.bytes == Array(first.frame.texture.bytes.reversed()))
        precondition(reverse.frame.validDataMask == Array(first.frame.validDataMask.reversed()))

        rejected("bounded-observed-history-required", try compose(Array(observed.prefix(2))))
        rejected("bounded-observed-history-required", try compose(Array(repeating: latest, count: 9)))
        rejected("duplicate-source-times", try compose([observed[0], observed[0], latest]))
        rejected("observed-frame-too-old", try compose(now: "2026-08-17T18:23:00.001Z"))
        _ = ready(try compose(now: "2026-08-17T18:23:00Z"))
        rejected("observed-frame-too-old", try compose(now: "2026-08-17T18:14:59Z"))
        rejected("forecast-cycle-too-old", try compose(cycle: "2026-08-17T15:46:59Z"))
        _ = ready(try compose(cycle: "2026-08-17T15:47:00Z"))
        rejected("forecast-cycle-too-old", try compose(cycle: "2026-08-17T18:18:00Z"))
        rejected("model-time-contract-mismatch", try compose(cycle: "2026-08-17T18:31:00Z"))
        rejected("model-time-contract-mismatch", try compose(now: anchor.validTime))
        rejected("model-time-contract-mismatch", try compose(target: frame(target.texture, "2026-08-17T18:29:00Z")))
        rejected("model-frame-identity-mismatch", try compose(target: frame(target.texture, anchor.validTime)))
        rejected("forecast-boundary-outside-safe-window", try compose(anchor: frame(anchor.texture, "2026-08-17T18:45:00.001Z")))
        rejected("target-outside-handoff-window", try compose(target: frame(target.texture, "2026-08-17T19:25:00.001Z")))
        rejected("nowcast-leaves-observed-domain", try compose(target: frame(target.texture, "2026-08-17T19:25:00Z")))
        var missing = latest.validDataMask; missing[missing.count / 2] = 0
        rejected("incomplete-source-coverage", try compose([observed[0], observed[1], frame(latest.texture, latest.validTime, mask: missing)]))
        rejected("incomplete-source-coverage", try compose(anchor: frame(anchor.texture, anchor.validTime, mask: missing)))
        rejected("incomplete-source-coverage", try compose(target: frame(target.texture, target.validTime, mask: missing)))
        rejected("spatial-contract-mismatch", try compose(target: frame(target.texture, target.validTime,
            changedBounds: .init(minLat: 38, minLon: -92, maxLat: 39, maxLon: -90))))
        rejected("spatial-contract-mismatch", try compose(target: frame(target.texture, target.validTime, changedEncoding: .init(threshold: 8))))
        let clearTexture = try RadarNumericContract.Texture(width: width, height: height, bytes: [UInt8](repeating: 0, count: width * height))
        let clear = try observed.map { try frame(clearTexture, $0.validTime) }
        rejected("insufficient-trackable-frame-pairs", try compose(clear))
        let mismatched = try frame(clearTexture, anchor.validTime)
        let bridge = ready(try compose(anchor: mismatched, target: mismatched))
        precondition(!bridge.evidence.modelAligned && bridge.evidence.forecastWeight == 0)
        assertEdgeFallback(bridge, original: mismatched.texture, enhanced: firstExpected, shifts: [(6, -3)])
        precondition(bridge.frame.texture.bytes[30 * width + 40] == first.frame.texture.bytes[30 * width + 40],
            "Model mismatch must not erase reliable radar motion in the interior")
        precondition(bridge.evidence.correctionX == 0 && bridge.evidence.correctionFactor == 0)
        let laterBridge = ready(try compose(anchor: mismatched))
        precondition(laterBridge.evidence.forecastWeight > 0 && laterBridge.evidence.forecastWeight < 1)
        let end = try frame(target.texture, "2026-08-17T19:15:00Z")
        let completed = ready(try compose(anchor: mismatched, target: end))
        precondition(completed.evidence.forecastWeight == 1 && completed.frame.texture == end.texture)
        let reused = ready(try Transition.compose(observed: observed, forecastAnchor: anchor, forecastTarget: target,
            cycleTime: "2026-08-17T18:00:00Z", requestedAt: "2026-08-17T18:17:00Z", prepared: first.prepared))
        precondition(reused.frame.texture == result.frame.texture && reused.evidence == result.evidence)
        let reusedBridge = ready(try Transition.compose(observed: observed, forecastAnchor: mismatched, forecastTarget: target,
            cycleTime: "2026-08-17T18:00:00Z", requestedAt: "2026-08-17T18:17:00Z", prepared: bridge.prepared))
        precondition(reusedBridge.frame.texture == laterBridge.frame.texture)
        precondition(!first.prepared.matches(observed, mismatched, "2026-08-17T18:00:00Z"))
        precondition(!first.prepared.matches(observed, anchor, "2026-08-17T17:00:00Z"))
        precondition(!first.prepared.matches(clear, anchor, "2026-08-17T18:00:00Z"))
        precondition(bridge.evidence.method == "mrms-motion-hrrr-bridge")
        var previousWeight = -1.0
        for minute in [30, 45, 60] {
            let instant = RadarNumericContract.isoTime(latest.validTimeMilliseconds + Int64(minute * 60_000))
            let target = try frame(clearTexture, instant)
            let blended = ready(try Transition.compose(observed: observed, forecastAnchor: mismatched, forecastTarget: target,
                cycleTime: "2026-08-17T18:00:00Z", requestedAt: "2026-08-17T18:17:00Z", prepared: bridge.prepared))
            precondition(blended.evidence.forecastWeight > previousWeight)
            previousWeight = blended.evidence.forecastWeight
        }
        rejected("observed-frame-too-old", try Transition.compose(observed: observed, forecastAnchor: anchor, forecastTarget: target,
            cycleTime: "2026-08-17T18:00:00Z", requestedAt: "2026-08-17T18:23:00.001Z", prepared: first.prepared))
        // A valid but nonuniform stationary echo is not manufactured motion.
        let stationary = try observed.map { try frame(latest.texture, $0.validTime) }
        let still = ready(try compose(stationary, anchor: frame(latest.texture, anchor.validTime), target: frame(latest.texture, target.validTime)))
        precondition(still.evidence.motion.speedPixelsPerMinute == 0 && still.evidence.validCoverage == 1
            && still.evidence.enhancementCoverage == 1)
        precondition(still.frame.texture == latest.texture && still.frame.validDataMask == latest.validDataMask)
        for index in observed.indices {
            precondition(observed[index].texture.bytes == snapshots[index].0 && observed[index].validDataMask == snapshots[index].1
                && observed[index].validTime == snapshots[index].2)
        }
        let cancelled = Task.detached { try Transition.compose(observed: observed, forecastAnchor: anchor, forecastTarget: target,
            cycleTime: "2026-08-17T18:00:00Z", requestedAt: "2026-08-17T18:17:00Z") }
        cancelled.cancel()
        do { _ = try await cancelled.value; preconditionFailure("Cancellation ignored") } catch is CancellationError { }
        // Independent orchestration policy checks. Production must actually use
        // these decisions on refresh/clock ticks; numeric parity cannot test UI races.
        typealias Policy = NativeRadarTransitionPolicy
        let identityFrames = try observed.enumerated().map {
            try Policy.ObservationIdentity(sourceID: "scan-\($0.offset)|1024", validTime: $0.element.validTime)
        }
        func identity(_ history: [Policy.ObservationIdentity]? = nil,
                      cycle: String? = "2026-08-17T18:00:00Z", anchor a: String? = "2026-08-17T18:30:00Z",
                      target t: String? = "2026-08-17T19:00:00Z", now: String = "2026-08-17T18:17:00Z") throws -> Policy.RequestIdentity {
            try Policy.requestIdentity(observed: history ?? identityFrames, modelCycleTime: cycle,
                modelAnchorValidTime: a, targetValidTime: t, requestedAt: now)
        }
        let initialID = try identity()
        precondition(initialID.freshnessAllowsTransition)
        try expect(identity(Array(identityFrames.reversed())) == initialID)
        try expect(identity(now: "2026-08-17T18:17:00.001Z") == initialID)
        let observationAtLimit = try identity(now: "2026-08-17T18:23:00Z")
        let observationExpired = try identity(now: "2026-08-17T18:23:00.001Z")
        precondition(observationAtLimit == initialID && observationAtLimit.observedFreshness == .fresh)
        precondition(observationExpired.observedFreshness == .stale && observationExpired.cacheKey != initialID.cacheKey)
        precondition(!observationExpired.freshnessAllowsTransition)
        let cycleAtLimit = try identity(cycle: "2026-08-17T15:47:00Z")
        let cycleExpired = try identity(cycle: "2026-08-17T15:47:00Z", now: "2026-08-17T18:17:00.001Z")
        precondition(cycleAtLimit.modelFreshness == .fresh && cycleExpired.modelFreshness == .stale)
        precondition(cycleAtLimit.cacheKey != cycleExpired.cacheKey && !cycleExpired.freshnessAllowsTransition)
        let futureObservation = try identity(now: "2026-08-17T18:14:59.999Z")
        precondition(futureObservation.observedFreshness == .future && !futureObservation.freshnessAllowsTransition)
        try expect(identity(now: latest.validTime).observedFreshness == .fresh)
        try expect(identity(cycle: "2026-08-17T18:17:00.001Z").modelFreshness == .future)
        try expect(identity(cycle: "2026-08-17T18:17:00Z").modelFreshness == .fresh)
        let beforeAnchor = try identity(now: "2026-08-17T18:29:59.999Z")
        let atAnchor = try identity(now: "2026-08-17T18:30:00Z")
        precondition(beforeAnchor.modelAnchorIsFuture && !atAnchor.modelAnchorIsFuture && beforeAnchor.cacheKey != atAnchor.cacheKey)
        let beforeTarget = try identity(now: "2026-08-17T18:59:59.999Z")
        let atTarget = try identity(now: target.validTime)
        precondition(beforeTarget.targetIsFuture && !atTarget.targetIsFuture && beforeTarget.cacheKey != atTarget.cacheKey)
        var changedIdentity = identityFrames
        changedIdentity[0] = try .init(sourceID: "scan-0|1025", validTime: observed[0].validTime)
        try expect(identity(changedIdentity).cacheKey != initialID.cacheKey)
        changedIdentity = identityFrames
        changedIdentity[3] = try .init(sourceID: "scan-4|1024", validTime: "2026-08-17T18:16:00Z")
        try expect(identity(changedIdentity).cacheKey != initialID.cacheKey)
        try expect(identity(cycle: "2026-08-17T17:00:00Z").cacheKey != initialID.cacheKey)
        try expect(identity(target: "2026-08-17T19:00:00.001Z").cacheKey != initialID.cacheKey)
        try expect(identity(cycle: "2026-08-17T13:00:00-05:00").cacheKey == initialID.cacheKey)
        let absent = try identity([], cycle: nil, anchor: nil, target: nil)
        precondition(absent.observedFreshness == .missing && absent.modelFreshness == .missing && !absent.freshnessAllowsTransition)
        do { _ = try Policy.ObservationIdentity(sourceID: " ", validTime: latest.validTime); preconditionFailure("Empty ID accepted") }
        catch Policy.Failure.invalidObservationIdentity { }
        do { _ = try identity(Array(repeating: identityFrames[0], count: 9)); preconditionFailure("Unbounded ID accepted") }
        catch Policy.Failure.excessiveHistory { }
        func reusable(_ cached: [Int], _ required: [Int], cycle: String = "2026-08-17T18:00:00Z",
                      newBounds: RadarChunkContract.Bounds? = nil) -> Bool {
            Policy.canReuseField(cachedCycleTime: "2026-08-17T18:00:00Z", requestedCycleTime: cycle,
                cachedBounds: bounds, requestedBounds: newBounds ?? bounds,
                cachedSourceIndexes: cached, requiredSourceIndexes: required)
        }
        precondition(reusable([1, 2, 3, 4], [3, 1]))
        precondition(!reusable([2, 3, 4], [3, 1]), "Missing anchor accepted")
        precondition(!reusable([1, 2], [3, 1]), "Missing target accepted")
        precondition(!reusable([1, 2], [1], cycle: "2026-08-17T19:00:00Z"))
        precondition(!reusable([1, 2], [1], newBounds: .init(minLat: 38, minLon: -92, maxLat: 39, maxLon: -90)))
        precondition(reusable([1, 2], [1], cycle: "2026-08-17T13:00:00-05:00"))
        precondition(!reusable([1, 2], []) && !reusable([], [1]))
        precondition(!reusable([1, 1], [1]) && !reusable([1, 2], [1, 1]))
        precondition(!reusable([-1, 1], [1]) && !reusable([1, 2], [-1]))
        precondition(!reusable(Array(0...8), [1]) && !reusable([1, 2], [1], cycle: "invalid"))
        print("PASS Native transition: gated motion and correction, exact advertised times, independent enhancement-edge fallback/feather/interior checks, genuine source coverage rejection, stationary signal, immutable inputs, cancellation, source/cycle/time/conflict fallback")
        print("PASS Transition orchestration policy: exact freshness/future boundaries, changed scan metadata, stable clock identity, canonical times, and complete target+anchor field reuse")
        print("No invented intermediate slots; derived fields remain predictions. This is not physical-device or live-model validation.")
    }
}
