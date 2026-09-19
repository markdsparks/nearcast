import Foundation

/// Pure, bounded port of radar-seam-engine.js's DEFAULT search/quality profile.
/// Does not generate images or join a timeline. Inputs must share the same
/// projected bounds/encoding and carry explicit validity masks. Because the JS
/// estimator has no missing-data model, this port conservatively rejects any
/// incomplete mask instead of interpreting unavailable pixels as clear weather.
enum NativeRadarSeamEstimation {
    enum Failure: Error { case invalidFrame, invalidOptions }
    enum Outcome<Value: Sendable>: Sendable {
        case ready(Value)
        case unavailable(String)
    }

    struct Frame: @unchecked Sendable {
        let texture: RadarNumericContract.Texture
        let bounds: RadarChunkContract.Bounds
        let encoding: RadarNumericContract.Encoding
        let validDataMask: [UInt8]
        let validTimeMilliseconds: Int64
        var validTime: String { RadarNumericContract.isoTime(validTimeMilliseconds) }
        var completeCoverage: Bool { validDataMask.allSatisfy { $0 == 1 } }

        init(texture: RadarNumericContract.Texture, bounds: RadarChunkContract.Bounds,
             encoding: RadarNumericContract.Encoding, validTime: String, validDataMask: [UInt8]) throws {
            try bounds.validate()
            guard texture.width >= 8, texture.height >= 8,
                  validDataMask.count == texture.bytes.count,
                  validDataMask.allSatisfy({ $0 <= 1 }) else { throw Failure.invalidFrame }
            self.texture = texture; self.bounds = bounds; self.encoding = encoding
            self.validDataMask = validDataMask
            validTimeMilliseconds = try RadarNumericContract.parseTime(validTime)
        }
    }

    struct Options: Sendable {
        let signalThreshold: Int
        let minimumPairs: Int
        init(signalThreshold: Int = 8, minimumPairs: Int = 1) throws {
            guard (1...254).contains(signalThreshold), (1...3).contains(minimumPairs) else { throw Failure.invalidOptions }
            self.signalThreshold = signalThreshold; self.minimumPairs = minimumPairs
        }
        /// Exact raw-map-runtime defaults for uint8 0...80 dBZ, 5 dBZ threshold.
        static var rawMap: Options { try! .init(signalThreshold: 17, minimumPairs: 2) }
    }

    struct Pair: Equatable, Sendable {
        let dx: Int, dy: Int
        let score: Double, confidence: Double, overlap: Double, precipOverlap: Double
        let ambiguity: Double, ambiguityGap: Double, improvementOverStationary: Double
        let activeSource: Int, activeTarget: Int, sampleStride: Int
        var confidenceLevel: String { NativeRadarSeamEstimation.confidenceLevel(confidence) }
    }
    struct MotionPair: Equatable, Sendable {
        let translation: Pair
        let intervalMinutes: Double, velocityX: Double, velocityY: Double
        let olderValidTime: String, newerValidTime: String
    }
    struct Motion: Equatable, Sendable {
        let velocityX: Double, velocityY: Double, speedPixelsPerMinute: Double
        let directionDegrees: Double?
        let confidence: Double, consistency: Double, meanResidualPixels: Double
        let observedSpanMinutes: Double
        let observedFrameCount: Int, discardedObservedFrameCount: Int
        let anchorValidTime: String
        let width: Int, height: Int, threshold: Int
        let pairs: [MotionPair]
        var confidenceLevel: String { NativeRadarSeamEstimation.confidenceLevel(confidence) }
    }
    struct Correction: Equatable, Sendable {
        let dx: Int, dy: Int
        let phaseLagMinutes: Double?
        let intensityScale: Double, confidence: Double
        let overlap: Double, precipOverlap: Double, score: Double
        let anchorValidTime: String, referenceValidTime: String
        let width: Int, height: Int
        var confidenceLevel: String { NativeRadarSeamEstimation.confidenceLevel(confidence) }
        func numericCorrection() throws -> RadarNumericContract.Correction {
            try .init(dx: Double(dx), dy: Double(dy), intensityScale: intensityScale,
                      confidence: confidence, anchorValidTime: anchorValidTime)
        }
    }

    static func estimateMotion(frames supplied: [Frame], options: Options = try! .init()) throws -> Outcome<Motion> {
        try Task.checkCancellation()
        guard supplied.count >= 2 else { return .unavailable("at-least-two-observed-frames-required") }
        guard supplied.count <= 32 else { return .unavailable("observed-input-exceeds-bounded-history") }
        // Stable chronological suffix matches normalizeObservedInput exactly.
        let ordered = supplied.enumerated().sorted {
            $0.element.validTimeMilliseconds == $1.element.validTimeMilliseconds
                ? $0.offset < $1.offset : $0.element.validTimeMilliseconds < $1.element.validTimeMilliseconds
        }
        let frames = Array(ordered.suffix(8).map(\.element)), latest = frames.last!
        for (index, frame) in frames.enumerated() {
            guard frame.texture.width == latest.texture.width, frame.texture.height == latest.texture.height else {
                return .unavailable("observed-dimensions-mismatch")
            }
            guard frame.bounds == latest.bounds, frame.encoding == latest.encoding else { return .unavailable("spatial-contract-mismatch") }
            guard frame.completeCoverage else { return .unavailable("incomplete-coverage") }
            if index > 0, frame.validTimeMilliseconds == frames[index - 1].validTimeMilliseconds {
                return .unavailable("duplicate-observed-times")
            }
        }
        var selected: [Frame] = [], used = Set<Int64>()
        for lag in [10.0, 20.0, 30.0] {
            var best: Frame?, bestDistance = Double.infinity
            for older in frames.dropLast() {
                let actual = Double(latest.validTimeMilliseconds - older.validTimeMilliseconds) / 60_000
                let distance = abs(actual - lag)
                guard actual > 0, actual <= 45, !used.contains(older.validTimeMilliseconds), distance <= 6,
                      distance < bestDistance else { continue }
                best = older; bestDistance = distance
            }
            if let best { selected.append(best); used.insert(best.validTimeMilliseconds) }
        }
        if selected.isEmpty, let longest = frames.dropLast().first(where: {
            let interval = Double(latest.validTimeMilliseconds - $0.validTimeMilliseconds) / 60_000
            return interval > 0 && interval <= 45
        }) { selected.append(longest) }
        var pairs: [MotionPair] = []
        for older in selected {
            try Task.checkCancellation()
            let interval = Double(latest.validTimeMilliseconds - older.validTimeMilliseconds) / 60_000
            if case let .ready(pair) = try estimatePair(source: older, target: latest, signalThreshold: options.signalThreshold) {
                pairs.append(.init(translation: pair, intervalMinutes: interval,
                    velocityX: Double(pair.dx) / interval, velocityY: Double(pair.dy) / interval,
                    olderValidTime: older.validTime, newerValidTime: latest.validTime))
            }
        }
        guard pairs.count >= options.minimumPairs else { return .unavailable("insufficient-trackable-frame-pairs") }
        let weights = pairs.map { max(0.01, $0.translation.confidence * sqrt($0.intervalMinutes / 10)) }
        let vx = weightedMedian(pairs.map(\.velocityX), weights), vy = weightedMedian(pairs.map(\.velocityY), weights)
        let speed = hypot(vx, vy)
        guard speed.isFinite, speed <= 1.5 else { return .unavailable("motion-outside-safe-bounds") }
        var weightedResidual = 0.0, weightTotal = 0.0
        for (index, pair) in pairs.enumerated() {
            weightedResidual += hypot(pair.velocityX - vx, pair.velocityY - vy) * pair.intervalMinutes * weights[index]
            weightTotal += weights[index]
        }
        let residual = weightTotal > 0 ? weightedResidual / weightTotal : .infinity
        let consistency = clamp01(1 - residual / (max(0.75, speed * 8) * 2))
        let confidence = clamp01(weightedMean(pairs.map { $0.translation.confidence }, weights) * (0.68 + consistency * 0.32))
        guard consistency >= 0.25 else { return .unavailable("inconsistent-observed-motion") }
        guard confidence >= 0.5 else { return .unavailable("low-motion-confidence") }
        let degrees = atan2(vx, -vy) * 180 / .pi
        let direction = speed > 0.001 ? (degrees.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) : nil
        return .ready(Motion(velocityX: vx, velocityY: vy, speedPixelsPerMinute: speed, directionDegrees: direction,
            confidence: confidence, consistency: consistency, meanResidualPixels: residual,
            observedSpanMinutes: pairs.map(\.intervalMinutes).max()!, observedFrameCount: frames.count,
            discardedObservedFrameCount: supplied.count - frames.count, anchorValidTime: latest.validTime,
            width: latest.texture.width, height: latest.texture.height, threshold: options.signalThreshold, pairs: pairs))
    }

    /// Caller must identify the inputs as a real older/newer observation pair.
    /// Times are retained, not shifted/rounded to a desired cadence.
    static func estimatePair(source: Frame, target: Frame, signalThreshold: Int = 8) throws -> Outcome<Pair> {
        try pair(source: source, target: target, threshold: signalThreshold, minimumScore: 0.36, minimumConfidence: 0.42)
    }

    static func estimateForecastCorrection(reference: Frame, forecast: Frame, motion: Motion? = nil,
                                            signalThreshold: Int = 8) throws -> Outcome<Correction> {
        try Task.checkCancellation()
        guard reference.validTimeMilliseconds == forecast.validTimeMilliseconds else { return .unavailable("correction-time-mismatch") }
        let translation: Pair
        switch try pair(source: forecast, target: reference, threshold: signalThreshold, minimumScore: 0.28, minimumConfidence: 0.36) {
        case let .ready(value): translation = value
        case let .unavailable(reason):
            if reason == "incomplete-coverage" || reason == "spatial-contract-mismatch" { return .unavailable(reason) }
            return .unavailable("forecast-alignment-unreliable")
        }
        let w = forecast.texture.width, h = forecast.texture.height, dx = translation.dx, dy = translation.dy
        let source = forecast.texture.bytes, target = reference.texture.bytes
        var ratios: [Double] = []
        for y in max(0, -dy)..<min(h, h - dy) {
            try Task.checkCancellation()
            for x in max(0, -dx)..<min(w, w - dx) {
                let a = source[y * w + x], b = target[(y + dy) * w + x + dx]
                if a >= signalThreshold && b >= signalThreshold { ratios.append(Double(b) / Double(a)) }
            }
        }
        guard ratios.count >= 24 else { return .unavailable("forecast-intensity-overlap-insufficient") }
        ratios.sort()
        let low = ratios[Int(floor(Double(ratios.count) * 0.15))], high = ratios[Int(floor(Double(ratios.count) * 0.85))]
        let trimmed = ratios.filter { $0 >= low && $0 <= high }
        let scale = max(0.65, min(1.5, trimmed[trimmed.count / 2]))
        let intensityConfidence = clamp01(1 - (high - low) / 1.2)
        var phase: Double?
        if let motion {
            guard motion.velocityX.isFinite, motion.velocityY.isFinite else { return .unavailable("motion-outside-safe-bounds") }
            let speedSquared = motion.velocityX * motion.velocityX + motion.velocityY * motion.velocityY
            if speedSquared > 0.0001 { phase = max(-90, min(90, (Double(dx) * motion.velocityX + Double(dy) * motion.velocityY) / speedSquared)) }
        }
        return .ready(Correction(dx: dx, dy: dy, phaseLagMinutes: phase, intensityScale: scale,
            confidence: clamp01(translation.confidence * (0.75 + intensityConfidence * 0.25)),
            overlap: translation.overlap, precipOverlap: translation.precipOverlap, score: translation.score,
            anchorValidTime: forecast.validTime, referenceValidTime: reference.validTime, width: w, height: h))
    }

    private struct Candidate {
        let dx: Int, dy: Int, insertion: Int
        var score = -Double.infinity, precipOverlap = 0.0, overlap = 0.0
    }
    private static func pair(source: Frame, target: Frame, threshold: Int,
                             minimumScore: Double, minimumConfidence: Double) throws -> Outcome<Pair> {
        try Task.checkCancellation()
        guard (1...254).contains(threshold) else { throw Failure.invalidOptions }
        let w = source.texture.width, h = source.texture.height
        guard target.texture.width == w, target.texture.height == h else { return .unavailable("pair-textures-invalid") }
        guard source.bounds == target.bounds, source.encoding == target.encoding else { return .unavailable("spatial-contract-mismatch") }
        guard source.completeCoverage, target.completeCoverage else { return .unavailable("incomplete-coverage") }
        let a = source.texture.bytes, b = target.texture.bytes
        let maximumShift = max(1, min(24, Int(floor(Double(min(w, h)) * 0.2))))
        let sampleStride = min(16, max(1, Int(ceil(sqrt(Double(w * h) / 6000)))))
        let minimumActive = max(16, Int(ceil(Double(w * h) / Double(sampleStride * sampleStride) * 0.001)))
        func countSignal(_ bytes: [UInt8]) -> Int {
            var count = 0
            for y in stride(from: 0, to: h, by: sampleStride) {
                for x in stride(from: 0, to: w, by: sampleStride) where bytes[y * w + x] >= threshold { count += 1 }
            }
            return count
        }
        let activeSource = countSignal(a), activeTarget = countSignal(b)
        guard activeSource >= minimumActive, activeTarget >= minimumActive else { return .unavailable("insufficient-precipitation-signal") }
        func score(_ dx: Int, _ dy: Int, _ insertion: Int) -> Candidate {
            var result = Candidate(dx: dx, dy: dy, insertion: insertion)
            let xStart = max(0, -dx), xEnd = min(w, w - dx), yStart = max(0, -dy), yEnd = min(h, h - dy)
            guard xStart < xEnd, yStart < yEnd else { return result }
            var unionIntensity = 0.0, sharedIntensity = 0.0
            var sourceActive = 0, targetActive = 0, sharedActive = 0, sampled = 0
            for y in stride(from: yStart, to: yEnd, by: sampleStride) {
                for x in stride(from: xStart, to: xEnd, by: sampleStride) {
                    let va = Int(a[y * w + x]), vb = Int(b[(y + dy) * w + x + dx])
                    let aa = va >= threshold, ba = vb >= threshold
                    sampled += 1
                    if !aa && !ba { continue }
                    if aa { sourceActive += 1 }; if ba { targetActive += 1 }; if aa && ba { sharedActive += 1 }
                    sharedIntensity += Double(min(aa ? va : 0, ba ? vb : 0))
                    unionIntensity += Double(max(aa ? va : 0, ba ? vb : 0))
                }
            }
            let activeUnion = sourceActive + targetActive - sharedActive
            guard activeUnion >= minimumActive, unionIntensity > 0 else { return result }
            let intensityIOU = sharedIntensity / unionIntensity
            let dice = sourceActive + targetActive > 0 ? Double(2 * sharedActive) / Double(sourceActive + targetActive) : 0
            result.score = intensityIOU * 0.72 + dice * 0.28
            result.precipOverlap = Double(sharedActive) / Double(activeUnion)
            result.overlap = clamp01(Double(sampled) / ceil(Double(w) / Double(sampleStride)) / ceil(Double(h) / Double(sampleStride)))
            return result
        }
        var candidates: [Candidate] = []
        let coarseStep = maximumShift >= 10 ? 2 : 1
        for dy in stride(from: -maximumShift, through: maximumShift, by: coarseStep) {
            for dx in stride(from: -maximumShift, through: maximumShift, by: coarseStep) {
                try Task.checkCancellation()
                candidates.append(score(dx, dy, candidates.count))
            }
        }
        candidates.sort(by: precedes)
        guard let coarse = candidates.first, coarse.score.isFinite else { return .unavailable("translation-search-empty") }
        if coarseStep > 1 {
            for dy in max(-maximumShift, coarse.dy - 2)...min(maximumShift, coarse.dy + 2) {
                for dx in max(-maximumShift, coarse.dx - 2)...min(maximumShift, coarse.dx + 2) {
                    if (dx - coarse.dx) % coarseStep == 0 && (dy - coarse.dy) % coarseStep == 0 { continue }
                    try Task.checkCancellation()
                    candidates.append(score(dx, dy, candidates.count))
                }
            }
            candidates.sort(by: precedes)
        }
        let best = candidates[0]
        let runner = candidates.first { max(abs($0.dx - best.dx), abs($0.dy - best.dy)) > 2 }
        let zero = candidates.first { $0.dx == 0 && $0.dy == 0 } ?? score(0, 0, -1)
        let gap = runner?.score.isFinite == true ? max(0, best.score - runner!.score) : best.score
        let ambiguity = clamp01(gap / 0.08)
        let improvement = zero.score.isFinite ? max(0, best.score - zero.score) : best.score
        let quality = clamp01((best.score - 0.2) / 0.7)
        let signalQuality = clamp01(Double(min(activeSource, activeTarget)) / Double(minimumActive * 4))
        let confidence = clamp01(quality * 0.48 + best.precipOverlap * 0.18 + best.overlap * 0.10 + ambiguity * 0.14 + signalQuality * 0.10)
        guard best.score >= minimumScore, best.precipOverlap >= 0.12, best.overlap >= 0.68 else { return .unavailable("pair-similarity-too-low") }
        guard ambiguity >= 0.035 else { return .unavailable("translation-ambiguous") }
        guard confidence >= minimumConfidence else { return .unavailable("pair-confidence-too-low") }
        return .ready(Pair(dx: best.dx, dy: best.dy, score: best.score, confidence: confidence,
            overlap: best.overlap, precipOverlap: best.precipOverlap, ambiguity: ambiguity, ambiguityGap: gap,
            improvementOverStationary: improvement, activeSource: activeSource, activeTarget: activeTarget, sampleStride: sampleStride))
    }

    private static func precedes(_ a: Candidate, _ b: Candidate) -> Bool {
        if a.score != b.score { return a.score > b.score }
        let ad = hypot(Double(a.dx), Double(a.dy)), bd = hypot(Double(b.dx), Double(b.dy))
        if ad != bd { return ad < bd }
        return a.insertion < b.insertion // JavaScript's stable Array.sort tie order.
    }
    private static func weightedMedian(_ values: [Double], _ weights: [Double]) -> Double {
        let indexes = values.indices.sorted { values[$0] == values[$1] ? $0 < $1 : values[$0] < values[$1] }
        let total = weights.reduce(0, +)
        var cursor = 0.0
        for index in indexes { cursor += weights[index]; if cursor >= total / 2 { return values[index] } }
        return values[indexes.last!]
    }
    private static func weightedMean(_ values: [Double], _ weights: [Double]) -> Double {
        var sum = 0.0, total = 0.0
        for index in values.indices { sum += values[index] * weights[index]; total += weights[index] }
        return total > 0 ? sum / total : 0
    }
    static func clamp01(_ value: Double) -> Double { max(0, min(1, value)) }
    static func confidenceLevel(_ value: Double) -> String { value >= 0.76 ? "high" : value >= 0.56 ? "moderate" : "low" }
}
