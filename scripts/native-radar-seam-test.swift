import Foundation

typealias Seam = NativeRadarSeamEstimation

@main
enum NativeRadarSeamTests {
    static func compare(_ actual: Any, _ expected: Any, path: String) {
        if let expected = expected as? [String: Any] {
            guard let actual = actual as? [String: Any] else { preconditionFailure("\(path): expected dictionary") }
            precondition(Set(actual.keys) == Set(expected.keys), "\(path): keys \(actual.keys) != \(expected.keys)")
            for key in expected.keys { compare(actual[key]!, expected[key]!, path: path + "." + key) }
        } else if let expected = expected as? [Any] {
            guard let actual = actual as? [Any] else { preconditionFailure("\(path): expected array") }
            precondition(actual.count == expected.count, "\(path): count mismatch")
            for index in expected.indices { compare(actual[index], expected[index], path: path + "[\(index)]") }
        } else if let expected = expected as? String {
            precondition(actual as? String == expected, "\(path): \(actual) != \(expected)")
        } else if expected is NSNull { precondition(actual is NSNull, "\(path): expected null") }
        else {
            guard let actual = actual as? NSNumber, let expected = expected as? NSNumber else { preconditionFailure("\(path): expected number") }
            precondition(abs(actual.doubleValue - expected.doubleValue) <= 1e-10, "\(path): \(actual) != \(expected)")
        }
    }
    static func pair(_ p: Seam.Pair) -> [String: Any] {
        ["dx": p.dx, "dy": p.dy, "score": p.score, "confidence": p.confidence, "confidenceLevel": p.confidenceLevel,
         "overlap": p.overlap, "precipOverlap": p.precipOverlap, "ambiguity": p.ambiguity, "ambiguityGap": p.ambiguityGap,
         "improvementOverStationary": p.improvementOverStationary, "activeSource": p.activeSource, "activeTarget": p.activeTarget, "sampleStride": p.sampleStride]
    }
    static func motion(_ m: Seam.Motion) -> [String: Any] {
        var result: [String: Any] = ["velocityX": m.velocityX, "velocityY": m.velocityY, "speedPixelsPerMinute": m.speedPixelsPerMinute,
            "directionDegrees": m.directionDegrees as Any? ?? NSNull(), "confidence": m.confidence, "confidenceLevel": m.confidenceLevel,
            "consistency": m.consistency, "meanResidualPixels": m.meanResidualPixels, "observedSpanMinutes": m.observedSpanMinutes,
            "observedFrameCount": m.observedFrameCount, "discardedObservedFrameCount": m.discardedObservedFrameCount,
            "anchorValidTime": m.anchorValidTime, "width": m.width, "height": m.height, "threshold": m.threshold]
        result["pairs"] = m.pairs.map { p -> [String: Any] in
            var data = pair(p.translation)
            data["intervalMinutes"] = p.intervalMinutes; data["velocityX"] = p.velocityX; data["velocityY"] = p.velocityY
            data["olderValidTime"] = p.olderValidTime; data["newerValidTime"] = p.newerValidTime
            return data
        }
        return result
    }
    static func correction(_ c: Seam.Correction) -> [String: Any] {
        ["dx": c.dx, "dy": c.dy, "phaseLagMinutes": c.phaseLagMinutes as Any? ?? NSNull(), "intensityScale": c.intensityScale,
         "confidence": c.confidence, "confidenceLevel": c.confidenceLevel, "overlap": c.overlap, "precipOverlap": c.precipOverlap,
         "score": c.score, "anchorValidTime": c.anchorValidTime, "referenceValidTime": c.referenceValidTime,
         "width": c.width, "height": c.height]
    }
    static func dictionary<T>(_ outcome: Seam.Outcome<T>, _ serialize: (T) -> [String: Any]) -> [String: Any] {
        switch outcome {
        case let .unavailable(reason): return ["status": "unavailable", "reason": reason]
        case let .ready(value): var result = serialize(value); result["status"] = "ready"; return result
        }
    }
    static func rejected<T>(_ reason: String, _ outcome: Seam.Outcome<T>) {
        guard case let .unavailable(actual) = outcome else { preconditionFailure("Expected \(reason)") }
        precondition(actual == reason, "Expected \(reason), got \(actual)")
    }
    static func main() async throws {
        let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("scripts/fixtures/native-radar/seam-estimation.json")
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as! [String: Any]
        let bounds = RadarChunkContract.Bounds(minLat: 38, minLon: -91, maxLat: 39, maxLon: -90)
        let encoding = try RadarNumericContract.Encoding()
        var textures: [String: RadarNumericContract.Texture] = [:]
        for (id, raw) in fixture["textures"] as! [String: [String: Any]] {
            let rle = raw["rle"] as! [Int], width = raw["width"] as! Int, height = raw["height"] as! Int
            precondition(rle.count % 2 == 0)
            var bytes: [UInt8] = []
            for index in stride(from: 0, to: rle.count, by: 2) {
                precondition(rle[index] > 0 && rle[index] <= width * height - bytes.count)
                bytes.append(contentsOf: repeatElement(UInt8(rle[index + 1]), count: rle[index]))
            }
            textures[id] = try .init(width: width, height: height, bytes: bytes)
        }
        func frame(_ object: [String: Any]) throws -> Seam.Frame {
            let texture = textures[object["texture"] as! String]!
            return try .init(texture: texture, bounds: bounds, encoding: encoding, validTime: object["validTime"] as! String,
                             validDataMask: [UInt8](repeating: 1, count: texture.bytes.count))
        }
        for item in fixture["pairs"] as! [[String: Any]] {
            let actual = try Seam.estimatePair(source: frame(item["source"] as! [String: Any]),
                target: frame(item["target"] as! [String: Any]), signalThreshold: item["threshold"] as! Int)
            compare(dictionary(actual, pair), item["expected"]!, path: "pair." + (item["name"] as! String))
        }
        var motions: [String: Seam.Motion] = [:]
        for item in fixture["motions"] as! [[String: Any]] {
            let frames = try (item["frames"] as! [[String: Any]]).map(frame), name = item["name"] as! String
            let snapshots = frames.map { ($0.texture.bytes, $0.validDataMask, $0.validTime) }
            let result = try Seam.estimateMotion(frames: frames, options: .init(signalThreshold: item["threshold"] as! Int,
                                                                            minimumPairs: item["minimumPairs"] as! Int))
            compare(dictionary(result, motion), item["expected"]!, path: "motion." + name)
            if case let .ready(value) = result { motions[name] = value }
            for index in frames.indices {
                precondition(frames[index].texture.bytes == snapshots[index].0 && frames[index].validDataMask == snapshots[index].1
                             && frames[index].validTime == snapshots[index].2)
            }
        }
        for item in fixture["corrections"] as! [[String: Any]] {
            let result = try Seam.estimateForecastCorrection(reference: frame(item["reference"] as! [String: Any]),
                forecast: frame(item["forecast"] as! [String: Any]), motion: (item["motionName"] as? String).flatMap { motions[$0] },
                signalThreshold: item["threshold"] as! Int)
            compare(dictionary(result, correction), item["expected"]!, path: "correction." + (item["name"] as! String))
            if case let .ready(value) = result {
                let numeric = try value.numericCorrection()
                precondition(numeric.dx == Double(value.dx) && numeric.dy == Double(value.dy) && numeric.intensityScale == value.intensityScale)
            }
        }
        for item in fixture["advection"] as! [[String: Any]] {
            let result = try NativeRadarSeamGates.advectionTargets(motion: motions[item["motionName"] as! String]!,
                                                                  targetValidTimes: item["targets"] as! [String])
            let actual = dictionary(result) { targets in
                ["targets": targets.map { t -> [String: Any] in
                    ["targetValidTime": t.targetValidTime, "anchorValidTime": t.anchorValidTime, "leadMinutes": t.leadMinutes,
                     "displacementX": t.displacementX, "displacementY": t.displacementY, "coverage": t.geometricCoverage,
                     "confidence": t.confidence, "confidenceLevel": t.confidenceLevel]
                }]
            }
            compare(actual, item["expected"]!, path: "advection." + (item["name"] as! String))
        }
        for item in fixture["runtime"] as! [[String: Any]] {
            let result = try NativeRadarSeamGates.runtimeReadiness(observedTimes: item["observedTimes"] as! [String],
                forecastTimes: item["forecastTimes"] as! [String], cycleTime: item["cycleTime"] as! String,
                requestedAt: item["requestedAt"] as! String)
            if let stricterReason = item["nativeOnlyReason"] as? String { rejected(stricterReason, result) }
            else { compare(dictionary(result) { ["targetValidTimes": $0.targetValidTimes] }, item["expected"]!, path: "runtime." + (item["name"] as! String)) }
        }

        // Native safety extensions: explicit geometry/encoding/mask/time contracts.
        let first = (fixture["motions"] as! [[String: Any]])[0]
        let frames = try (first["frames"] as! [[String: Any]]).map(frame), original = frames[0]
        func changed(mask: [UInt8]? = nil, bounds changedBounds: RadarChunkContract.Bounds? = nil,
                     encoding changedEncoding: RadarNumericContract.Encoding? = nil, time: String? = nil) throws -> Seam.Frame {
            try .init(texture: original.texture, bounds: changedBounds ?? original.bounds, encoding: changedEncoding ?? original.encoding,
                      validTime: time ?? original.validTime, validDataMask: mask ?? original.validDataMask)
        }
        var missing = original.validDataMask; missing[0] = 0
        rejected("incomplete-coverage", try Seam.estimatePair(source: changed(mask: missing), target: original))
        rejected("incomplete-coverage", try Seam.estimateMotion(frames: [changed(mask: missing)] + frames.dropFirst()))
        rejected("incomplete-coverage", try Seam.estimateForecastCorrection(reference: changed(mask: missing), forecast: original))
        rejected("spatial-contract-mismatch", try Seam.estimatePair(source: changed(bounds: .init(minLat: 38, minLon: -92, maxLat: 39, maxLon: -90)), target: original))
        rejected("spatial-contract-mismatch", try Seam.estimateMotion(frames: [changed(encoding: .init(threshold: 8))] + frames.dropFirst()))
        rejected("correction-time-mismatch", try Seam.estimateForecastCorrection(reference: changed(time: frames[1].validTime), forecast: original))
        do { _ = try changed(mask: []); preconditionFailure("Missing mask accepted") } catch Seam.Failure.invalidFrame { }
        missing[0] = 2
        do { _ = try changed(mask: missing); preconditionFailure("Invalid mask accepted") } catch Seam.Failure.invalidFrame { }
        do { _ = try Seam.Options(signalThreshold: 0); preconditionFailure("Bad options accepted") } catch Seam.Failure.invalidOptions { }
        do { _ = try Seam.Options(minimumPairs: 4); preconditionFailure("Unbounded pairs accepted") } catch Seam.Failure.invalidOptions { }
        rejected("duplicate-source-times", try NativeRadarSeamGates.runtimeReadiness(observedTimes: [frames[0].validTime, frames[0].validTime],
            forecastTimes: [frames.last!.validTime], cycleTime: frames[0].validTime, requestedAt: frames.last!.validTime))
        let cancelled = Task.detached { try Seam.estimateMotion(frames: frames, options: .rawMap) }
        cancelled.cancel()
        do { _ = try await cancelled.value; preconditionFailure("Cancellation ignored") } catch is CancellationError { }
        print("PASS Native seam: exact JS default pair/motion/correction statistics and rejection reasons; exact source times, advection confidence/coverage and raw-runtime gates; stricter future/mask/spatial checks, bounded history and cancellation")
        print("No I/O, generated frame scheduling, mask advection or UI seam integration. Partial masks fail closed; this is not full seam parity.")
    }
}
