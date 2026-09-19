import Foundation

private typealias Radar = RadarNumericContract
private struct EncodingFixture: Decodable {
    let dbzMin: Double, dbzMax: Double, threshold: Double
    func native() throws -> Radar.Encoding { try .init(dbzMin: dbzMin, dbzMax: dbzMax, threshold: threshold) }
}
private struct EncodingCase: Decodable {
    let encoding: EncodingFixture
    let values: [Double], encoded: [UInt8], decoded: [Double?]
}
private struct ColorCase: Decodable {
    let encoding: EncodingFixture
    let alpha: Double
    let width: Int, height: Int
    let inputBase64: Data, expectedBase64: Data
}
private struct TranslationCase: Decodable {
    let name: String
    let width: Int, height: Int
    let inputBase64: Data, expectedBase64: Data
    let dx: Double, dy: Double, scale: Double
    let interpolation: String
}
private struct BlendCase: Decodable {
    let width: Int, height: Int
    let observedBase64: Data, forecastBase64: Data, expectedBase64: Data
    let weight: Double
}
private struct FrameFixture: Decodable {
    let width: Int, height: Int
    let validTime: String, bytesBase64: Data
    func native() throws -> Radar.Frame {
        try .init(texture: .init(width: width, height: height, bytes: Array(bytesBase64)), validTime: validTime)
    }
}
private struct CorrectionFixture: Decodable {
    let dx: Double, dy: Double, intensityScale: Double, confidence: Double
    let anchorValidTime: String
    func native() throws -> Radar.Correction {
        try .init(dx: dx, dy: dy, intensityScale: intensityScale, confidence: confidence, anchorValidTime: anchorValidTime)
    }
}
private struct CorrectedFixture: Decodable {
    let width: Int, height: Int
    let validTime: String, bytesBase64: Data
    let correctionFactor: Double, displacementX: Double, displacementY: Double, intensityScale: Double, confidence: Double
}
private struct CorrectionCase: Decodable {
    let input: FrameFixture, correction: CorrectionFixture
    let decayMinutes: Double, interpolation: String, expected: CorrectedFixture
}
private struct NowcastFixture: Decodable {
    let width: Int, height: Int
    let validTime: String, bytesBase64: Data, anchorValidTime: String
    let confidence: Double
    func native() throws -> Radar.NowcastFrame {
        try .init(frame: .init(texture: .init(width: width, height: height, bytes: Array(bytesBase64)), validTime: validTime),
                  anchorValidTime: anchorValidTime, confidence: confidence)
    }
}
private struct ForecastFixture: Decodable {
    let width: Int, height: Int
    let validTime: String, bytesBase64: Data
    let correctionFactor: Double
    func native() throws -> Radar.CorrectedFrame {
        .init(frame: try .init(texture: .init(width: width, height: height, bytes: Array(bytesBase64)), validTime: validTime),
              correctionFactor: correctionFactor, displacementX: 0, displacementY: 0, intensityScale: 1, confidence: 0.82)
    }
}
private struct CompositeFixture: Decodable {
    let width: Int, height: Int
    let validTime: String, bytesBase64: Data, kind: String, sourceProvider: String, anchorValidTime: String, confidenceLevel: String
    let leadMinutes: Double, confidence: Double, observedWeight: Double, forecastWeight: Double, correctionFactor: Double
    let forecastAvailable: Bool
}
private struct CompositeCase: Decodable {
    let scenario: String, correctionConfidence: Double
    let nowcasts: [NowcastFixture], forecasts: [ForecastFixture], expected: [CompositeFixture]
}
private struct TimeCase: Decodable { let input: String, milliseconds: Int64, canonical: String }
private struct TargetLeadCase: Decodable { let validTime: String, anchorValidTime: String, leadMinutes: Double }
private struct Preview: Decodable {
    struct Frame: Decodable { let id: String, label: String, validTime: String, bytesBase64: Data, rgbaBase64: Data }
    let width: Int, height: Int, frames: [Frame]
}
private struct Fixture: Decodable {
    let version: Int
    let encodingCases: [EncodingCase], colors: [ColorCase], translations: [TranslationCase], blends: [BlendCase]
    let corrections: [CorrectionCase], compositing: [CompositeCase], times: [TimeCase], preview: Preview
    let targetLeads: [TargetLeadCase]
}

@main
enum RadarNumericTests {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else { fatalError("Supply synthetic numeric-contract.json") }
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        precondition(data.count < 2_000_000, "Fixture must stay small and synthetic")
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        precondition(fixture.version == 1)
        func near(_ actual: Double, _ expected: Double, _ context: String) {
            precondition(abs(actual - expected) < 1e-10, "\(context): \(actual) != \(expected)")
        }
        func rejects(_ expected: Radar.ContractError, _ operation: () throws -> Void) {
            do { try operation(); preconditionFailure("Expected \(expected)") }
            catch { precondition((error as? Radar.ContractError) == expected, "Unexpected error \(error)") }
        }
        for item in fixture.encodingCases {
            let encoding = try item.encoding.native()
            precondition(item.values.count == item.encoded.count && item.decoded.count == 256)
            for (value, encoded) in zip(item.values, item.encoded) {
                let actual = try Radar.encodeDbz(value, encoding: encoding)
                precondition(actual == encoded, "dBZ encode \(value)")
            }
            for byte in 0...255 {
                let decoded = Radar.decodeDbz(UInt8(byte), encoding: encoding)
                if let expected = item.decoded[byte] { near(decoded!, expected, "dBZ decode \(byte)") }
                else { precondition(decoded == nil && byte == 0) }
            }
        }
        for item in fixture.colors {
            let texture = try Radar.Texture(width: item.width, height: item.height, bytes: Array(item.inputBase64))
            let rgba = try Radar.resolvedRGBA(texture, encoding: item.encoding.native(), alpha: item.alpha)
            precondition(rgba == Array(item.expectedBase64), "Resolved CPU RGBA byte parity")
        }
        for item in fixture.translations {
            let source = try Radar.Texture(width: item.width, height: item.height, bytes: Array(item.inputBase64))
            let result = try Radar.translateTexture(source, dx: item.dx, dy: item.dy,
                                                    interpolation: .init(rawValue: item.interpolation)!, intensityScale: item.scale)
            precondition(result.bytes == Array(item.expectedBase64), "Translation \(item.name)")
            precondition(source.bytes == Array(item.inputBase64), "Translation mutated its input")
        }
        for item in fixture.blends {
            let observed = try Radar.Texture(width: item.width, height: item.height, bytes: Array(item.observedBase64))
            let forecast = try Radar.Texture(width: item.width, height: item.height, bytes: Array(item.forecastBase64))
            let result = try Radar.blendTextures(observed, forecast, forecastWeight: item.weight)
            precondition(result.bytes == Array(item.expectedBase64), "Blend \(item.weight)")
        }
        for item in fixture.corrections {
            let corrected = try Radar.applyForecastCorrection(item.input.native(), correction: item.correction.native(),
                                                              decayMinutes: item.decayMinutes, interpolation: .init(rawValue: item.interpolation)!)
            precondition(corrected.frame.texture.bytes == Array(item.expected.bytesBase64), "Correction bytes at \(item.input.validTime)")
            precondition(corrected.frame.validTime == item.expected.validTime)
            near(corrected.correctionFactor, item.expected.correctionFactor, "Correction decay")
            near(corrected.displacementX, item.expected.displacementX, "Correction dx")
            near(corrected.displacementY, item.expected.displacementY, "Correction dy")
            near(corrected.intensityScale, item.expected.intensityScale, "Correction intensity")
            near(corrected.confidence, item.expected.confidence, "Correction confidence")
        }
        for item in fixture.compositing {
            let result = try Radar.composeSeamFrames(item.nowcasts.map { try $0.native() }, forecasts: item.forecasts.map { try $0.native() },
                                                    correctionConfidence: item.correctionConfidence)
            precondition(result.count == item.expected.count)
            for (actual, expected) in zip(result, item.expected) {
                precondition(actual.frame.texture.bytes == Array(expected.bytesBase64), "Composite \(item.scenario)")
                precondition(actual.frame.validTime == expected.validTime && actual.anchorValidTime == expected.anchorValidTime)
                precondition(actual.kind == expected.kind && actual.sourceProvider == expected.sourceProvider)
                precondition(actual.confidenceLevel == expected.confidenceLevel && actual.forecastAvailable == expected.forecastAvailable)
                near(actual.leadMinutes, expected.leadMinutes, "Lead")
                near(actual.forecastWeight, expected.forecastWeight, "Forecast weight")
                near(actual.observedWeight, expected.observedWeight, "Observed weight")
                near(actual.correctionFactor, expected.correctionFactor, "Blend correction factor")
                near(actual.confidence, expected.confidence, "Blend confidence")
            }
        }
        for item in fixture.times {
            let milliseconds = try Radar.parseTime(item.input)
            precondition(milliseconds == item.milliseconds, "Exact milliseconds")
            precondition(Radar.isoTime(milliseconds) == item.canonical, "Canonical UTC timestamp")
        }
        for item in fixture.preview.frames {
            precondition(item.id.hasPrefix("synthetic-") && item.label.contains("Synthetic"))
            let texture = try Radar.Texture(width: fixture.preview.width, height: fixture.preview.height, bytes: Array(item.bytesBase64))
            let rgba = try Radar.resolvedRGBA(texture, encoding: .init())
            precondition(rgba == Array(item.rgbaBase64), "Preview is native-color reproducible")
        }

        // Native safety checks deliberately reject malformed values that JS may
        // coerce. These are not claimed as matching JavaScript's coercion policy.
        rejects(.invalidDimensions) { _ = try Radar.Texture(width: 0, height: 8, bytes: []) }
        rejects(.invalidDimensions) { _ = try Radar.Texture(width: -8, height: 8, bytes: []) }
        rejects(.textureTooLarge) { _ = try Radar.Texture(width: Int.max, height: Int.max, bytes: []) }
        rejects(.textureTooLarge) { _ = try Radar.Texture(width: 1025, height: 1024, bytes: []) }
        rejects(.lengthMismatch) { _ = try Radar.Texture(width: 8, height: 8, bytes: [0]) }
        rejects(.invalidEncoding) { _ = try Radar.Encoding(dbzMin: .nan) }
        rejects(.invalidEncoding) { _ = try Radar.Encoding(dbzMin: 41, dbzMax: 41) }
        let encoding = try Radar.Encoding()
        rejects(.nonFiniteValue) { _ = try Radar.encodeDbz(.infinity, encoding: encoding) }
        let texture = try Radar.Texture(width: 8, height: 8, bytes: .init(repeating: 20, count: 64))
        for item in fixture.targetLeads {
            let target = try Radar.NowcastFrame(frame: .init(texture: texture, validTime: item.validTime),
                                               anchorValidTime: item.anchorValidTime, confidence: 0.7)
            near(target.leadMinutes, item.leadMinutes, "Three-decimal exact target lead")
        }
        let sourceFrame = try Radar.Frame(texture: texture, validTime: "2026-08-17T18:45:00.000Z")
        let nowcast = try Radar.NowcastFrame(frame: sourceFrame, anchorValidTime: "2026-08-17T18:00:00Z", confidence: 0.7)
        let correction = try Radar.Correction(dx: 1, dy: -1, intensityScale: 1, confidence: 0.8, anchorValidTime: "2026-08-17T18:00:00Z")
        let forecast = try Radar.applyForecastCorrection(sourceFrame, correction: correction)
        rejects(.nonFiniteValue) { _ = try Radar.translateTexture(texture, dx: .nan, dy: 0) }
        rejects(.nonFiniteValue) { _ = try Radar.translateTexture(texture, dx: 0, dy: .infinity) }
        rejects(.nonFiniteValue) { _ = try Radar.translateTexture(texture, dx: 0, dy: 0, intensityScale: .nan) }
        rejects(.nonFiniteValue) { _ = try Radar.blendTextures(texture, texture, forecastWeight: .nan) }
        rejects(.nonFiniteValue) { _ = try Radar.resolvedRGBA(texture, encoding: encoding, alpha: .infinity) }
        rejects(.dimensionMismatch) {
            _ = try Radar.blendTextures(texture, .init(width: 4, height: 16, bytes: texture.bytes), forecastWeight: 0.5)
        }
        rejects(.nonFiniteValue) { _ = try Radar.applyForecastCorrection(sourceFrame, correction: correction, decayMinutes: .nan) }
        rejects(.nonFiniteValue) { _ = try Radar.Correction(dx: .nan, dy: 0, intensityScale: 1, confidence: 1, anchorValidTime: sourceFrame.validTime) }
        rejects(.invalidLead) { _ = try Radar.NowcastFrame(frame: sourceFrame, anchorValidTime: sourceFrame.validTime, confidence: 0.7) }
        rejects(.invalidLead) { _ = try Radar.NowcastFrame(frame: sourceFrame, anchorValidTime: "2026-08-17T16:00:00Z", confidence: 0.7) }
        rejects(.tooManyFrames) { _ = try Radar.composeSeamFrames(.init(repeating: nowcast, count: 7), forecasts: []) }
        rejects(.tooManyFrames) { _ = try Radar.composeSeamFrames([nowcast], forecasts: .init(repeating: forecast, count: 13)) }
        rejects(.nonFiniteValue) { _ = try Radar.composeSeamFrames([nowcast], forecasts: [], blendStartMinutes: .infinity) }
        let empty = try Radar.composeSeamFrames([], forecasts: [])
        precondition(empty.isEmpty)
        for invalid in ["", "bad", "2026-08-17", "2026-08-17T18:00:00", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z",
                        "2026-01-01T24:00:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00.1234Z", "2026-01-01T00:00:00+99:99"] {
            rejects(.invalidTime) { _ = try Radar.parseTime(invalid) }
        }
        let limit = try Radar.Texture(width: 1024, height: 1024, bytes: .init(repeating: 0, count: Radar.maximumTexturePixels))
        precondition(limit.bytes.count == Radar.maximumTexturePixels)
        print("PASS Native radar numeric: 3 dBZ ranges (all 256 decode bytes), 9 full-byte CPU resolved RGBA sweeps, \(fixture.translations.count) translations, \(fixture.blends.count) blends, \(fixture.corrections.count) correction cases, \(fixture.compositing.count) exact-time compositions, \(fixture.times.count) timestamps, \(fixture.targetLeads.count) exact lead rounding cases, 3 synthetic previews, malformed/oversized/nonfinite input rejection")
        print("LIMITED PARITY: decoded synthetic textures only; no decoder, acquisition, motion estimation, full seam/runtime gate, or GPU visual parity claim")
    }
}
