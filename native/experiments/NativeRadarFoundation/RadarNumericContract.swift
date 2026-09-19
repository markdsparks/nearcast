import Foundation

/// Experimental, I/O-free numeric contract for already-decoded MRMS/HRRR textures.
/// Matches the named web primitives, not the complete radar pipeline. In particular,
/// this does NOT decode GRIB/Zarr/NCRD, estimate motion or corrections, enforce the
/// raw-map runtime's freshness/quality gates, fetch weather, or reproduce the GPU
/// shader's zoom-dependent neighborhood/color treatment. `resolvedRGBA` matches
/// only map.js's CPU `resolved` style. Zero is the shared no-data byte, not 0 dBZ.
enum RadarNumericContract {
    static let maximumTexturePixels = 1_048_576

    enum ContractError: Error, Equatable {
        case invalidDimensions, textureTooLarge, lengthMismatch, invalidEncoding
        case nonFiniteValue, invalidTime, invalidLead, tooManyFrames, dimensionMismatch
    }

    struct Encoding: Equatable {
        let dbzMin: Double
        let dbzMax: Double
        let threshold: Double

        /// Inputs must already satisfy raw-map's normalized encoding bounds.
        /// Unlike JavaScript's coercion helpers, invalid native input fails closed.
        init(dbzMin: Double = 0, dbzMax: Double = 80, threshold: Double = 5) throws {
            guard [dbzMin, dbzMax, threshold].allSatisfy(\.isFinite),
                  (-20...40).contains(dbzMin), (41...120).contains(dbzMax),
                  dbzMax > dbzMin, (-10...dbzMax).contains(threshold) else {
                throw ContractError.invalidEncoding
            }
            self.dbzMin = dbzMin
            self.dbzMax = dbzMax
            self.threshold = threshold
        }
    }

    struct Texture: Equatable {
        let width: Int
        let height: Int
        let bytes: [UInt8]

        init(width: Int, height: Int, bytes: [UInt8]) throws {
            guard width > 0, height > 0 else { throw ContractError.invalidDimensions }
            // Division before multiplication prevents malicious dimensions overflowing.
            guard width <= maximumTexturePixels, height <= maximumTexturePixels / width else {
                throw ContractError.textureTooLarge
            }
            guard bytes.count == width * height else { throw ContractError.lengthMismatch }
            self.width = width
            self.height = height
            self.bytes = bytes
        }
    }

    struct Frame: Equatable {
        let texture: Texture
        let validTimeMilliseconds: Int64
        var validTime: String { RadarNumericContract.isoTime(validTimeMilliseconds) }

        init(texture: Texture, validTime: String) throws {
            self.texture = texture
            self.validTimeMilliseconds = try RadarNumericContract.parseTime(validTime)
        }
    }

    enum Interpolation: String { case nearest, bilinear }

    static func encodeDbz(_ value: Double, encoding: Encoding) throws -> UInt8 {
        guard value.isFinite else { throw ContractError.nonFiniteValue }
        let value = clamp(value, encoding.dbzMin, encoding.dbzMax)
        return byte(1 + (value - encoding.dbzMin) / (encoding.dbzMax - encoding.dbzMin) * 254)
    }

    static func decodeDbz(_ encoded: UInt8, encoding: Encoding) -> Double? {
        guard encoded != 0 else { return nil }
        return encoding.dbzMin + Double(Int(encoded) - 1) / 254 * (encoding.dbzMax - encoding.dbzMin)
    }

    /// Thresholding/provider sentinel removal belongs to the caller, just as in
    /// raw-map-runtime.js; encodeDbz itself clamps and never manufactures no-data.
    static func translateTexture(_ source: Texture, dx: Double, dy: Double,
                                 interpolation: Interpolation = .bilinear,
                                 intensityScale: Double = 1) throws -> Texture {
        guard [dx, dy, intensityScale].allSatisfy(\.isFinite) else { throw ContractError.nonFiniteValue }
        let scale = clamp(intensityScale, 0.5, 2)
        var output = [UInt8](repeating: 0, count: source.bytes.count)
        for y in 0..<source.height {
            let sy = Double(y) - dy
            guard sy >= 0, sy <= Double(source.height - 1) else { continue }
            for x in 0..<source.width {
                let sx = Double(x) - dx
                guard sx >= 0, sx <= Double(source.width - 1) else { continue }
                let value: Double
                if interpolation == .nearest {
                    value = Double(source.bytes[Int(floor(sy + 0.5)) * source.width + Int(floor(sx + 0.5))])
                } else {
                    let x0 = Int(floor(sx)), y0 = Int(floor(sy))
                    let x1 = min(source.width - 1, x0 + 1), y1 = min(source.height - 1, y0 + 1)
                    let fx = sx - Double(x0), fy = sy - Double(y0)
                    let top = Double(source.bytes[y0 * source.width + x0]) * (1 - fx)
                        + Double(source.bytes[y0 * source.width + x1]) * fx
                    let bottom = Double(source.bytes[y1 * source.width + x0]) * (1 - fx)
                        + Double(source.bytes[y1 * source.width + x1]) * fx
                    value = top * (1 - fy) + bottom * fy
                }
                output[y * source.width + x] = byte(value * scale)
            }
        }
        return try Texture(width: source.width, height: source.height, bytes: output)
    }

    static func blendTextures(_ observed: Texture, _ forecast: Texture,
                              forecastWeight: Double) throws -> Texture {
        guard observed.width == forecast.width, observed.height == forecast.height else {
            throw ContractError.dimensionMismatch
        }
        guard forecastWeight.isFinite else { throw ContractError.nonFiniteValue }
        let weight = clamp(forecastWeight, 0, 1)
        let output = zip(observed.bytes, forecast.bytes).map {
            byte(Double($0) * (1 - weight) + Double($1) * weight)
        }
        return try Texture(width: observed.width, height: observed.height, bytes: output)
    }

    struct Correction {
        let dx: Double
        let dy: Double
        let intensityScale: Double
        let confidence: Double
        let anchorTimeMilliseconds: Int64

        init(dx: Double, dy: Double, intensityScale: Double, confidence: Double, anchorValidTime: String) throws {
            guard [dx, dy, intensityScale, confidence].allSatisfy(\.isFinite) else {
                throw ContractError.nonFiniteValue
            }
            self.dx = dx; self.dy = dy
            self.intensityScale = intensityScale; self.confidence = confidence
            self.anchorTimeMilliseconds = try RadarNumericContract.parseTime(anchorValidTime)
        }
    }

    struct CorrectedFrame {
        let frame: Frame
        let correctionFactor: Double
        let displacementX: Double
        let displacementY: Double
        let intensityScale: Double
        let confidence: Double
    }

    /// Applies a supplied correction only; it is NOT a correction estimator.
    static func applyForecastCorrection(_ frame: Frame, correction: Correction,
                                        decayMinutes: Double = 75,
                                        interpolation: Interpolation = .bilinear) throws -> CorrectedFrame {
        guard frame.texture.width >= 8, frame.texture.height >= 8 else { throw ContractError.invalidDimensions }
        guard decayMinutes.isFinite else { throw ContractError.nonFiniteValue }
        let elapsed = max(0, Double(frame.validTimeMilliseconds - correction.anchorTimeMilliseconds) / 60_000)
        let decay = clamp(1 - elapsed / clamp(decayMinutes, 15, 180), 0, 1)
        let dx = correction.dx * decay, dy = correction.dy * decay
        let scale = 1 + (correction.intensityScale - 1) * decay
        let texture = decay <= 0.0001 ? frame.texture : try translateTexture(
            frame.texture, dx: dx, dy: dy, interpolation: interpolation, intensityScale: scale)
        return CorrectedFrame(frame: try Frame(texture: texture, validTime: frame.validTime),
                              correctionFactor: decay, displacementX: dx, displacementY: dy,
                              intensityScale: scale, confidence: clamp(correction.confidence * (0.7 + decay * 0.3), 0, 1))
    }

    struct NowcastFrame {
        let frame: Frame
        let anchorValidTime: String
        let leadMinutes: Double
        let confidence: Double

        /// Extrapolation/motion confidence is supplied, never inferred here.
        init(frame: Frame, anchorValidTime: String, confidence: Double) throws {
            let anchor = try RadarNumericContract.parseTime(anchorValidTime)
            let lead = Double(frame.validTimeMilliseconds - anchor) / 60_000
            guard lead > 0, lead <= 90 else { throw ContractError.invalidLead }
            guard confidence.isFinite, (0...1).contains(confidence) else { throw ContractError.nonFiniteValue }
            self.frame = frame
            self.anchorValidTime = RadarNumericContract.isoTime(anchor)
            // Mirrors normalizeTargets' three-decimal lead minutes for exact slots.
            self.leadMinutes = RadarNumericContract.roundLeadToThreeDecimals(lead)
            self.confidence = confidence
        }
    }

    struct CompositeFrame {
        let frame: Frame
        let kind: String
        let sourceProvider: String
        let anchorValidTime: String
        let leadMinutes: Double
        let observedWeight: Double
        let forecastWeight: Double
        let forecastAvailable: Bool
        let correctionFactor: Double
        let confidence: Double
        var confidenceLevel: String { confidence >= 0.76 ? "high" : confidence >= 0.56 ? "moderate" : "low" }
    }

    /// Only exactly matching valid times blend. No nearest-frame substitution.
    /// Missing forecast preserves a copied observed-nowcast texture and provenance.
    static func composeSeamFrames(_ nowcast: [NowcastFrame], forecasts: [CorrectedFrame],
                                  correctionConfidence: Double? = nil,
                                  blendStartMinutes: Double = 15,
                                  blendCompleteMinutes: Double = 75) throws -> [CompositeFrame] {
        guard nowcast.count <= 6, forecasts.count <= 12 else { throw ContractError.tooManyFrames }
        guard [blendStartMinutes, blendCompleteMinutes, correctionConfidence ?? 0].allSatisfy(\.isFinite) else {
            throw ContractError.nonFiniteValue
        }
        var byTime: [Int64: CorrectedFrame] = [:]
        for forecast in forecasts { byTime[forecast.frame.validTimeMilliseconds] = forecast }
        let start = clamp(blendStartMinutes, 0, 89)
        let complete = max(start + 1, clamp(blendCompleteMinutes, start + 1, 180))
        return try nowcast.map { observed in
            let forecast = byTime[observed.frame.validTimeMilliseconds]
            let weight = forecast == nil ? 0 : smoothstep((observed.leadMinutes - start) / (complete - start))
            let texture = try forecast.map { try blendTextures(observed.frame.texture, $0.frame.texture, forecastWeight: weight) }
                ?? observed.frame.texture
            return CompositeFrame(frame: try Frame(texture: texture, validTime: observed.frame.validTime),
                                  kind: forecast == nil ? "observed-nowcast" : "radar-seam-blend",
                                  sourceProvider: forecast == nil ? "mrms-advection" : "mrms-hrrr-seam",
                                  anchorValidTime: observed.anchorValidTime, leadMinutes: observed.leadMinutes,
                                  observedWeight: 1 - weight, forecastWeight: weight, forecastAvailable: forecast != nil,
                                  correctionFactor: forecast?.correctionFactor ?? 0,
                                  confidence: clamp(observed.confidence * (1 - weight)
                                    + (correctionConfidence ?? observed.confidence) * weight, 0, 1))
        }
    }

    /// Flat, non-premultiplied RGBA bytes. Only the web CPU `resolved` style;
    /// neither the raw-radar GPU shader nor banded/continuous styles are claimed.
    static func resolvedRGBA(_ texture: Texture, encoding: Encoding, alpha: Double = 1.22) throws -> [UInt8] {
        guard alpha.isFinite else { throw ContractError.nonFiniteValue }
        let stops: [(Double, [UInt8])] = [
            (8, [66, 174, 214, 204]), (16, [62, 204, 105, 228]), (28, [20, 154, 74, 248]),
            (36, [238, 188, 42, 255]), (45, [230, 111, 36, 255]), (56, [214, 55, 43, 255]),
            (68, [154, 64, 188, 255]), (80, [238, 220, 244, 255])
        ]
        var result = [UInt8](repeating: 0, count: texture.bytes.count * 4)
        for (index, encoded) in texture.bytes.enumerated() {
            guard let dbz = decodeDbz(encoded, encoding: encoding) else { continue }
            let fade = smoothstep((dbz - (encoding.threshold - 5)) / 6.75)
            guard fade > 0 else { continue }
            let color = stops.first(where: { dbz <= $0.0 })?.1 ?? stops.last!.1
            result[index * 4] = color[0]
            result[index * 4 + 1] = color[1]
            result[index * 4 + 2] = color[2]
            result[index * 4 + 3] = byte(min(1, Double(color[3]) / 255 * fade * max(alpha, 1.22)) * 255)
        }
        return result
    }

    /// Deliberately narrower than Date.parse: timezone-qualified ISO seconds,
    /// optional 1–3 fractional digits, years 0001–9999. No local/ambiguous dates.
    static func parseTime(_ value: String) throws -> Int64 {
        let pattern = #"^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$"#
        guard value.range(of: pattern, options: .regularExpression) != nil else { throw ContractError.invalidTime }
        let digits = Array(value.utf8)
        func number(_ start: Int, _ count: Int) -> Int {
            digits[start..<(start + count)].reduce(0) { $0 * 10 + Int($1 - 48) }
        }
        let year = number(0, 4), month = number(5, 2), day = number(8, 2)
        guard (1...12).contains(month), (1...31).contains(day), number(11, 2) < 24,
              number(14, 2) < 60, number(17, 2) < 60 else { throw ContractError.invalidTime }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let calendarDate = calendar.date(from: DateComponents(year: year, month: month, day: day)),
              calendar.component(.year, from: calendarDate) == year,
              calendar.component(.month, from: calendarDate) == month,
              calendar.component(.day, from: calendarDate) == day else { throw ContractError.invalidTime }
        if value.last != "Z" {
            guard number(digits.count - 5, 2) < 24, number(digits.count - 2, 2) < 60 else {
                throw ContractError.invalidTime
            }
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = value.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        guard let date = formatter.date(from: value) else { throw ContractError.invalidTime }
        let milliseconds = date.timeIntervalSince1970 * 1000
        guard milliseconds.isFinite, milliseconds >= -62_135_596_800_000,
              milliseconds <= 253_402_300_799_999 else { throw ContractError.invalidTime }
        return Int64(milliseconds.rounded())
    }

    static func isoTime(_ milliseconds: Int64) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: Date(timeIntervalSince1970: Double(milliseconds) / 1000))
    }

    private static func byte(_ value: Double) -> UInt8 { UInt8(clamp(floor(value + 0.5), 0, 255)) }
    private static func roundLeadToThreeDecimals(_ lead: Double) -> Double {
        // Number(lead.toFixed(3)), not Math.round(lead * 1000) / 1000:
        // multiplying first can erase the binary representation's side of a
        // decimal half tie (e.g. 12.5005). Leads are positive and <=90, so this
        // exact significand product fits UInt64. Round the rational directly.
        let bits = lead.bitPattern
        let significand = (bits & ((UInt64(1) << 52) - 1)) | (UInt64(1) << 52)
        let shift = 1075 - Int((bits >> 52) & 0x7ff)
        let numerator = significand * 1000
        guard shift < 64 else { return 0 }
        let integer = numerator >> shift
        let remainder = numerator & ((UInt64(1) << shift) - 1)
        let rounded = integer + (remainder >= (UInt64(1) << (shift - 1)) ? 1 : 0)
        return Double(rounded) / 1000
    }
    private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double { max(lower, min(upper, value)) }
    private static func smoothstep(_ value: Double) -> Double {
        let x = clamp(value, 0, 1)
        return x * x * (3 - 2 * x)
    }
}
