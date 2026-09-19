import Foundation

/// Cache/orchestration decisions without UI, networking, or device-clock reads.
/// The host retains its own exact viewport/product identity alongside this key.
enum NativeRadarTransitionPolicy {
    enum Failure: Error { case invalidObservationIdentity, excessiveHistory }
    enum Freshness: String, Equatable, Sendable { case missing, future, fresh, stale }

    struct ObservationIdentity: Equatable, Sendable {
        let sourceID: String
        let validTime: String

        /// Include the immutable provider key and any advertised content revision
        /// (for MRMS: "key|byteLength"). No URLs with credentials belong here.
        init(sourceID: String, validTime: String) throws {
            guard !sourceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  sourceID.utf8.count <= 1_024 else { throw Failure.invalidObservationIdentity }
            self.sourceID = sourceID
            self.validTime = RadarNumericContract.isoTime(try RadarNumericContract.parseTime(validTime))
        }
    }

    struct RequestIdentity: Equatable, Sendable {
        let cacheKey: String
        let observedFreshness: Freshness
        let modelFreshness: Freshness
        let modelAnchorIsFuture: Bool
        let targetIsFuture: Bool

        var freshnessAllowsTransition: Bool {
            observedFreshness == .fresh && modelFreshness == .fresh && modelAnchorIsFuture && targetIsFuture
        }
    }

    /// Clock movement alone does not cause repeated downloads/renders. The key
    /// DOES change when freshness crosses a gate (including one millisecond past
    /// it), a source identity changes, or a selected/anchor time ceases to be
    /// future. Caller must reevaluate on clock ticks/refresh/resume and must still
    /// run compose's motion/coverage gates before claiming a radar-guided frame.
    static func requestIdentity(observed: [ObservationIdentity], modelCycleTime: String?,
                                modelAnchorValidTime: String?, targetValidTime: String?,
                                requestedAt: String) throws -> RequestIdentity {
        guard observed.count <= 8 else { throw Failure.excessiveHistory }
        let now = try RadarNumericContract.parseTime(requestedAt)
        let cycle = try modelCycleTime.map(RadarNumericContract.parseTime)
        let anchor = try modelAnchorValidTime.map(RadarNumericContract.parseTime)
        let target = try targetValidTime.map(RadarNumericContract.parseTime)
        var entries: [(sourceID: String, time: Int64)] = []
        for item in observed { entries.append((item.sourceID, try RadarNumericContract.parseTime(item.validTime))) }
        entries.sort { $0.time == $1.time ? $0.sourceID < $1.sourceID : $0.time < $1.time }
        let observationState = freshness(at: entries.last?.time, now: now, maximumAge: 8 * 60_000)
        let modelState = freshness(at: cycle, now: now, maximumAge: 150 * 60_000)
        let anchorFuture = anchor.map { $0 > now } ?? false
        let targetFuture = target.map { $0 > now } ?? false
        var components: [String] = ["native-radar-transition-v1", cycle.map { String($0) } ?? "missing",
            anchor.map { String($0) } ?? "missing", target.map { String($0) } ?? "missing",
            observationState.rawValue, modelState.rawValue, String(anchorFuture), String(targetFuture)]
        for item in entries { components.append(String(item.time)); components.append(item.sourceID) }
        // Length framing avoids collisions from delimiters inside a provider ID.
        let key = components.map { "\($0.utf8.count):\($0)" }.joined()
        return RequestIdentity(cacheKey: key, observedFreshness: observationState,
            modelFreshness: modelState, modelAnchorIsFuture: anchorFuture, targetIsFuture: targetFuture)
    }

    /// Pass the actual indices that will be sampled (target plus optional seam
    /// anchor), not only the selected target. A field missing the anchor must
    /// not enter the optional compositor and accidentally blank valid HRRR.
    static func canReuseField(cachedCycleTime: String, requestedCycleTime: String,
                              cachedBounds: RadarChunkContract.Bounds, requestedBounds: RadarChunkContract.Bounds,
                              cachedSourceIndexes: [Int], requiredSourceIndexes: [Int]) -> Bool {
        guard let cachedCycle = try? RadarNumericContract.parseTime(cachedCycleTime),
              let requestedCycle = try? RadarNumericContract.parseTime(requestedCycleTime),
              cachedCycle == requestedCycle, cachedBounds == requestedBounds,
              (try? cachedBounds.validate()) != nil,
              (1...8).contains(cachedSourceIndexes.count), (1...8).contains(requiredSourceIndexes.count),
              cachedSourceIndexes.allSatisfy({ $0 >= 0 }), requiredSourceIndexes.allSatisfy({ $0 >= 0 }),
              Set(cachedSourceIndexes).count == cachedSourceIndexes.count,
              Set(requiredSourceIndexes).count == requiredSourceIndexes.count else { return false }
        return Set(requiredSourceIndexes).isSubset(of: Set(cachedSourceIndexes))
    }

    private static func freshness(at source: Int64?, now: Int64, maximumAge: Int64) -> Freshness {
        guard let source else { return .missing }
        let age = now - source
        return age < 0 ? .future : age <= maximumAge ? .fresh : .stale
    }
}

/// An opt-in, I/O-free observed→model handoff for already reprojected MRMS/HRRR
/// fields. It never creates a time slot, shifts a timestamp, or calls predicted
/// pixels observed radar. An unavailable result means use the ORIGINAL model
/// field and identify it as model guidance, not a seamless/confirmed forecast.
enum NativeRadarTransition {
    typealias Frame = NativeRadarSeamEstimation.Frame
    typealias Outcome<Value: Sendable> = NativeRadarSeamEstimation.Outcome<Value>

    struct Evidence: Equatable, Sendable {
        let observedAt: String
        let modelCycleTime: String
        let modelAnchorValidTime: String
        let targetValidTime: String
        let observedAgeMinutes: Double
        let cycleAgeMinutes: Double
        let leadMinutes: Double
        let forecastWeight: Double
        let confidence: Double
        let validCoverage: Double
        let alignmentCoverage: Double
        let correctionX: Double, correctionY: Double
        let correctionFactor: Double
        let motion: NativeRadarSeamEstimation.Motion

        /// These are all predictions, including radar extrapolation at weight 0.
        var guidanceType: String { forecastWeight < 0.08 ? "radar-nowcast" : "blended-forecast" }
        var method: String { "mrms-motion-hrrr-phase-alignment" }
    }

    struct Result: Sendable {
        let frame: Frame
        let evidence: Evidence
    }

    /// `forecastAnchor` must be the FIRST advertised future model frame, while
    /// `forecastTarget` is the exact advertised frame selected by the user. Both
    /// must belong to `cycleTime` and be projected onto the observation viewport.
    /// At most eight real observations are accepted; three with two independently
    /// trackable pairs are needed. Caller must not pass interpolated observations.
    static func compose(observed: [Frame], forecastAnchor: Frame, forecastTarget: Frame,
                        cycleTime: String, requestedAt: String) throws -> Outcome<Result> {
        try Task.checkCancellation()
        guard (3...8).contains(observed.count) else { return .unavailable("bounded-observed-history-required") }
        let anchor = observed.max { $0.validTimeMilliseconds < $1.validTimeMilliseconds }!
        let fields = observed + [forecastAnchor, forecastTarget]
        guard fields.allSatisfy({ $0.bounds == anchor.bounds && $0.encoding == anchor.encoding
            && $0.texture.width == anchor.texture.width && $0.texture.height == anchor.texture.height }) else {
            return .unavailable("spatial-contract-mismatch")
        }
        // The estimator is deliberately conservative about source holes. A
        // decoded zero return is permitted when its separate coverage mask is 1.
        guard fields.allSatisfy(\.completeCoverage) else { return .unavailable("incomplete-source-coverage") }
        let requested = try RadarNumericContract.parseTime(requestedAt)
        let cycle = try RadarNumericContract.parseTime(cycleTime)
        guard forecastAnchor.validTimeMilliseconds >= cycle,
              forecastTarget.validTimeMilliseconds >= forecastAnchor.validTimeMilliseconds,
              forecastAnchor.validTimeMilliseconds > requested else { return .unavailable("model-time-contract-mismatch") }
        guard forecastAnchor.validTimeMilliseconds != forecastTarget.validTimeMilliseconds
            || forecastAnchor.texture == forecastTarget.texture else { return .unavailable("model-frame-identity-mismatch") }
        let targetLead = Double(forecastTarget.validTimeMilliseconds - anchor.validTimeMilliseconds) / 60_000
        guard targetLead > 0, targetLead <= 70 else { return .unavailable("target-outside-handoff-window") }
        let targetTimes = forecastAnchor.validTimeMilliseconds == forecastTarget.validTimeMilliseconds
            ? [forecastAnchor.validTime] : [forecastAnchor.validTime, forecastTarget.validTime]
        let readiness: NativeRadarSeamGates.RuntimeReadiness
        switch try NativeRadarSeamGates.runtimeReadiness(observedTimes: observed.map(\.validTime),
            forecastTimes: targetTimes, cycleTime: cycleTime, requestedAt: requestedAt) {
        case let .ready(value): readiness = value
        case let .unavailable(reason): return .unavailable(reason)
        }
        let threshold = Int(try RadarNumericContract.encodeDbz(anchor.encoding.threshold, encoding: anchor.encoding))
        guard (1...254).contains(threshold) else { return .unavailable("unsupported-signal-threshold") }
        let motion: NativeRadarSeamEstimation.Motion
        switch try NativeRadarSeamEstimation.estimateMotion(frames: observed,
            options: .init(signalThreshold: threshold, minimumPairs: 2)) {
        case let .ready(value): motion = value
        case let .unavailable(reason): return .unavailable(reason)
        }
        let targets: [NativeRadarSeamGates.AdvectedTarget]
        switch try NativeRadarSeamGates.advectionTargets(motion: motion, targetValidTimes: targetTimes) {
        case let .ready(value): targets = value
        case let .unavailable(reason): return .unavailable(reason)
        }
        guard let alignmentTarget = targets.first, let selectedTarget = targets.last else {
            return .unavailable("no-safe-handoff-targets")
        }
        let reference = try translated(anchor, dx: alignmentTarget.displacementX, dy: alignmentTarget.displacementY,
            validTime: forecastAnchor.validTime)
        // Translation exposes unknown edges. Estimate on the complete common
        // interior only; never pass those unknown edges as clear weather. The
        // crop changes neither pixel size nor displacement units.
        guard let rect = completeInterior(width: anchor.texture.width, height: anchor.texture.height,
            dx: alignmentTarget.displacementX, dy: alignmentTarget.displacementY),
            rect.coverage(width: anchor.texture.width, height: anchor.texture.height) >= 0.58 else {
            return .unavailable("alignment-leaves-observed-domain")
        }
        let croppedReference = try cropped(reference, to: rect)
        let croppedForecast = try cropped(forecastAnchor, to: rect)
        let correction: NativeRadarSeamEstimation.Correction
        switch try NativeRadarSeamEstimation.estimateForecastCorrection(reference: croppedReference,
            forecast: croppedForecast, motion: motion, signalThreshold: threshold) {
        case let .ready(value): correction = value
        case let .unavailable(reason): return .unavailable(reason)
        }
        // Stricter than the JS minimum: don't advertise a locally aligned field
        // when the model and extrapolated radar only weakly resemble each other.
        guard correction.confidence >= 0.56 else { return .unavailable("forecast-alignment-confidence-too-low") }
        let corrected = try RadarNumericContract.applyForecastCorrection(
            .init(texture: forecastTarget.texture, validTime: forecastTarget.validTime),
            correction: correction.numericCorrection())
        let model = try translated(forecastTarget, dx: corrected.displacementX, dy: corrected.displacementY,
            validTime: forecastTarget.validTime, intensityScale: corrected.intensityScale)
        let predicted = try translated(anchor, dx: selectedTarget.displacementX, dy: selectedTarget.displacementY,
            validTime: forecastTarget.validTime)
        let composites = try RadarNumericContract.composeSeamFrames([
            .init(frame: .init(texture: predicted.texture, validTime: predicted.validTime),
                  anchorValidTime: anchor.validTime, confidence: selectedTarget.confidence)
        ], forecasts: [corrected], correctionConfidence: correction.confidence)
        guard let composite = composites.first else { return .unavailable("composition-unavailable") }
        var bytes = composite.frame.texture.bytes
        var mask = [UInt8](repeating: 0, count: bytes.count)
        var valid = 0
        for index in bytes.indices {
            if index % anchor.texture.width == 0 { try Task.checkCancellation() }
            let validPrediction = composite.observedWeight == 0 || predicted.validDataMask[index] == 1
            let validModel = composite.forecastWeight == 0 || model.validDataMask[index] == 1
            if validPrediction && validModel { mask[index] = 1; valid += 1 }
            else { bytes[index] = 0 }
        }
        let coverage = Double(valid) / Double(bytes.count)
        guard coverage >= 0.58 else { return .unavailable("composite-coverage-too-small") }
        let texture = try RadarNumericContract.Texture(width: anchor.texture.width, height: anchor.texture.height, bytes: bytes)
        let frame = try Frame(texture: texture, bounds: anchor.bounds, encoding: anchor.encoding,
            validTime: forecastTarget.validTime, validDataMask: mask)
        return .ready(Result(frame: frame, evidence: Evidence(observedAt: anchor.validTime,
            modelCycleTime: readiness.cycleTime, modelAnchorValidTime: forecastAnchor.validTime,
            targetValidTime: forecastTarget.validTime, observedAgeMinutes: readiness.observedAgeMinutes,
            cycleAgeMinutes: readiness.cycleAgeMinutes, leadMinutes: composite.leadMinutes,
            forecastWeight: composite.forecastWeight, confidence: composite.confidence,
            validCoverage: coverage, alignmentCoverage: rect.coverage(width: anchor.texture.width, height: anchor.texture.height),
            correctionX: corrected.displacementX, correctionY: corrected.displacementY,
            correctionFactor: corrected.correctionFactor, motion: motion)))
    }

    private struct Rectangle {
        let x0: Int, y0: Int, x1: Int, y1: Int
        var width: Int { x1 - x0 + 1 }
        var height: Int { y1 - y0 + 1 }
        func coverage(width: Int, height: Int) -> Double { Double(self.width * self.height) / Double(width * height) }
    }

    private static func completeInterior(width: Int, height: Int, dx: Double, dy: Double) -> Rectangle? {
        let rect = Rectangle(x0: max(0, Int(ceil(dx))), y0: max(0, Int(ceil(dy))),
            x1: min(width - 1, Int(floor(Double(width - 1) + dx))),
            y1: min(height - 1, Int(floor(Double(height - 1) + dy))))
        return rect.width >= 8 && rect.height >= 8 ? rect : nil
    }

    private static func translated(_ frame: Frame, dx: Double, dy: Double, validTime: String,
                                   intensityScale: Double = 1) throws -> Frame {
        let translated = try RadarNumericContract.translateTexture(frame.texture, dx: dx, dy: dy, intensityScale: intensityScale)
        let width = frame.texture.width, height = frame.texture.height
        var bytes = translated.bytes, mask = [UInt8](repeating: 0, count: bytes.count)
        for row in 0..<height {
            try Task.checkCancellation()
            let y = Double(row) - dy
            guard y >= 0, y <= Double(height - 1) else { continue }
            let y0 = Int(floor(y)), y1 = min(height - 1, y0 + 1)
            for column in 0..<width {
                let index = row * width + column, x = Double(column) - dx
                guard x >= 0, x <= Double(width - 1) else { continue }
                let x0 = Int(floor(x)), x1 = min(width - 1, x0 + 1)
                if [y0 * width + x0, y0 * width + x1, y1 * width + x0, y1 * width + x1]
                    .allSatisfy({ frame.validDataMask[$0] == 1 }) { mask[index] = 1 }
                else { bytes[index] = 0 }
            }
        }
        return try Frame(texture: .init(width: width, height: height, bytes: bytes), bounds: frame.bounds,
            encoding: frame.encoding, validTime: validTime, validDataMask: mask)
    }

    private static func cropped(_ frame: Frame, to rect: Rectangle) throws -> Frame {
        var bytes: [UInt8] = [], mask: [UInt8] = []
        bytes.reserveCapacity(rect.width * rect.height); mask.reserveCapacity(rect.width * rect.height)
        for row in rect.y0...rect.y1 {
            try Task.checkCancellation()
            let start = row * frame.texture.width + rect.x0, end = row * frame.texture.width + rect.x1
            bytes.append(contentsOf: frame.texture.bytes[start...end])
            mask.append(contentsOf: frame.validDataMask[start...end])
        }
        let west = frame.bounds.minLon, east = frame.bounds.maxLon
        let northY = log(tan(.pi / 4 + frame.bounds.maxLat * .pi / 360))
        let southY = log(tan(.pi / 4 + frame.bounds.minLat * .pi / 360))
        func latitude(edge: Int) -> Double {
            let y = northY + (southY - northY) * Double(edge) / Double(frame.texture.height)
            return (2 * atan(exp(y)) - .pi / 2) * 180 / .pi
        }
        let bounds = RadarChunkContract.Bounds(minLat: latitude(edge: rect.y1 + 1),
            minLon: west + (east - west) * Double(rect.x0) / Double(frame.texture.width),
            maxLat: latitude(edge: rect.y0),
            maxLon: west + (east - west) * Double(rect.x1 + 1) / Double(frame.texture.width))
        return try Frame(texture: .init(width: rect.width, height: rect.height, bytes: bytes), bounds: bounds,
            encoding: frame.encoding, validTime: frame.validTime, validDataMask: mask)
    }
}
