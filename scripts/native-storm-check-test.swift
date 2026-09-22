import Foundation

@main enum NativeStormCheckTests {
    static let now = ISO8601DateFormatter().date(from: "2026-09-21T01:00:00Z")!
    static let bounds = RadarChunkContract.Bounds(minLat: 37, minLon: -91, maxLat: 39, maxLon: -89)
    static func location(_ id: String, x: Double, y: Double) -> NativeStormCheck.Location {
        let north = log(tan(.pi / 4 + bounds.maxLat * .pi / 360))
        let south = log(tan(.pi / 4 + bounds.minLat * .pi / 360))
        let latitude = (2 * atan(exp(north - y / 64 * (north - south))) - .pi / 2) * 180 / .pi
        return .init(id: id, name: id, latitude: latitude, longitude: bounds.minLon + x / 64 * 2)
    }
    static func frame(centerX: Int, minutesAgo: Int, missing: Int? = nil, empty: Bool = false) throws -> NativeRadarSeamEstimation.Frame {
        let encoding = try RadarNumericContract.Encoding()
        var bytes = [UInt8](repeating: 0, count: 64 * 64)
        var mask = [UInt8](repeating: 1, count: bytes.count)
        if let missing { mask[missing] = 0 }
        if !empty {
            for y in 0..<64 {
                for x in 0..<64 {
                    let dx = x - centerX, dy = y - 32
                    if Double(dx * dx) / 81 + Double(dy * dy) / 121 < 1 {
                        bytes[y * 64 + x] = try RadarNumericContract.encodeDbz(Double(28 + (x + y * 3) % 12), encoding: encoding)
                    }
                }
            }
        }
        let date = now.addingTimeInterval(-Double(minutesAgo) * 60)
        return try .init(texture: .init(width: 64, height: 64, bytes: bytes), bounds: bounds,
            encoding: encoding, validTime: RadarNumericContract.isoTime(Int64(date.timeIntervalSince1970 * 1000)), validDataMask: mask)
    }
    static func main() throws {
        let target = location("Selected area", x: 28.5, y: 32.5)
        let over = location("Over", x: 28.5, y: 32.5)
        let ahead = location("Ahead", x: 44.5, y: 32.5)
        let away = location("Away", x: 15.5, y: 12.5)
        let outside = NativeStormCheck.Location(id: "Outside", name: "Outside", latitude: 45, longitude: -90)
        let frames = try [frame(centerX: 20, minutesAgo: 20), frame(centerX: 24, minutesAgo: 10), frame(centerX: 28, minutesAgo: 0)]
        let report = try NativeStormCheck.analyze(observedFrames: frames, target: target, places: [over, ahead, away, outside], now: now)
        precondition(report.hasSelectedRain && report.observedAt == now && report.peakDBZ != nil)
        precondition(report.hasQualifiedMotion, "A consistent translated observed rain area has usable motion")
        precondition(report.places[0].status == .observed)
        precondition(report.places[1].status == .possible && report.places[1].earliestMinutes != nil
            && report.places[1].latestMinutes! <= 45, "Arrival is a bounded uncertain window")
        precondition(report.places[2].status == .noOverlap)
        precondition(report.places[3].status == .outside, "Outside sample is not treated as clear")
        precondition(report.method.contains("not confirm lightning"))

        let stale = try NativeStormCheck.analyze(observedFrames: frames, target: target, places: [over], now: now.addingTimeInterval(9 * 60))
        precondition(stale.state == .unavailable && stale.places.isEmpty, "Stale observations cannot produce current arrival estimates")
        let future = try NativeStormCheck.analyze(observedFrames: [frame(centerX: 28, minutesAgo: -1)], target: target, places: [over], now: now)
        precondition(future.state == .unavailable, "Future frames cannot be interpreted as observed radar")
        let missing = try NativeStormCheck.analyze(observedFrames: [frame(centerX: 28, minutesAgo: 0, missing: 32 * 64 + 28)], target: target, places: [over], now: now)
        precondition(missing.state == .unavailable, "Missing coverage at the tap is not a dry report")
        let empty = try NativeStormCheck.analyze(observedFrames: [frame(centerX: 28, minutesAgo: 0, empty: true)], target: target, places: [over], now: now)
        precondition(empty.state == .noEcho && empty.places.isEmpty, "A clear sample does not invent a storm to track")
        let one = try NativeStormCheck.analyze(observedFrames: [frames.last!], target: target, places: [over, ahead], now: now)
        precondition(one.places[0].status == .observed && one.places[1].status == .unavailable && !one.hasQualifiedMotion,
            "A single real observation supports location but never invented motion")
        let partial = try NativeStormCheck.analyze(observedFrames: [frame(centerX: 20, minutesAgo: 20, missing: 0), frames[1], frames[2]], target: target, places: [over, ahead], now: now)
        precondition(!partial.hasQualifiedMotion && partial.places[1].status == .unavailable,
            "Incomplete historical coverage cannot produce a motion estimate")
        let edge = location("Edge", x: 2.5, y: 32.5)
        let clipped = try NativeStormCheck.analyze(observedFrames: [frame(centerX: 2, minutesAgo: 20), frame(centerX: 2, minutesAgo: 10), frame(centerX: 2, minutesAgo: 0)], target: edge, places: [edge, ahead], now: now)
        precondition(clipped.hasSelectedRain && !clipped.hasQualifiedMotion, "Clipped storm area never gets a guessed arrival")
        let invalid = NativeStormCheck.Location(id: "Invalid", name: "Invalid", latitude: .nan, longitude: -90)
        let rejected = try NativeStormCheck.analyze(observedFrames: frames, target: invalid, places: [], now: now)
        precondition(rejected.state == .unavailable)
        print("PASS Native Storm Check: real observation time, selected footprint, qualified motion, bounded arrival windows, coverage, freshness, no false lightning, and missing evidence")
    }
}
