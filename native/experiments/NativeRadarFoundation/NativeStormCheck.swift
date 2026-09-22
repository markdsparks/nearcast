import Foundation

/// On-demand analysis of actual MRMS reflectivity. Future display frames and
/// weather codes never enter this contract. A projected overlap is a bounded
/// persistence estimate, not a lightning observation or severe-weather alert.
enum NativeStormCheck {
    struct Location: Equatable, Sendable {
        let id: String
        let name: String
        let latitude: Double
        let longitude: Double
        var isValid: Bool {
            latitude.isFinite && longitude.isFinite && abs(latitude) <= 85 && abs(longitude) <= 180
        }
    }

    struct PlaceRead: Identifiable, Equatable, Sendable {
        enum Status: Equatable, Sendable { case observed, possible, noOverlap, outside, unavailable }
        let place: Location
        let status: Status
        let earliestMinutes: Int?
        let latestMinutes: Int?
        var id: String { place.id }
        var title: String {
            switch status {
            case .observed: return "Selected precipitation area over this place"
            case .possible:
                guard let first = earliestMinutes, let last = latestMinutes else { return "May reach this place" }
                return first == 0 ? "May reach this place within \(last) min" : "May reach this place in \(first)–\(last) min"
            case .noOverlap: return "No projected overlap in the next 45 min"
            case .outside: return "Outside this local check"
            case .unavailable: return "Not enough radar evidence"
            }
        }
    }

    struct Report: Sendable {
        enum State: Sendable { case ready, noEcho, unavailable }
        let target: Location
        let checkedAt: Date
        let observedAt: Date?
        let state: State
        let title: String
        let detail: String
        let peakDBZ: Double?
        let motionDirection: Double?
        let places: [PlaceRead]
        let hasQualifiedMotion: Bool
        var hasSelectedRain: Bool { state == .ready }
        var method: String {
            "NOAA MRMS observed reflectivity. Any arrival window assumes this precipitation area keeps its recent motion and holds together. New growth, weakening and direction changes can alter it. This check does not distinguish rain from snow. Radar does not confirm lightning or severe weather and cannot replace official alerts."
        }
    }

    static let maximumObservationAge: TimeInterval = 8 * 60
    static let lookaheadMinutes = 45
    static let minimumDBZ = 20.0

    static func unavailable(target: Location, now: Date, detail: String) -> Report {
        Report(target: target, checkedAt: now, observedAt: nil, state: .unavailable,
            title: "Storm Check unavailable", detail: detail, peakDBZ: nil,
            motionDirection: nil, places: [], hasQualifiedMotion: false)
    }

    static func analyze(observedFrames: [NativeRadarSeamEstimation.Frame], target: Location,
                        places: [Location], now: Date) throws -> Report {
        try Task.checkCancellation()
        guard target.isValid, now.timeIntervalSince1970.isFinite,
              !observedFrames.isEmpty, observedFrames.count <= 4 else {
            return unavailable(target: target, now: now, detail: "Recent observed radar is unavailable for this spot.")
        }
        let frames = observedFrames.sorted { $0.validTimeMilliseconds < $1.validTimeMilliseconds }
        let latest = frames.last!
        let observedAt = Date(timeIntervalSince1970: Double(latest.validTimeMilliseconds) / 1000)
        let age = now.timeIntervalSince(observedAt)
        guard age >= 0, age <= maximumObservationAge else {
            return unavailable(target: target, now: now, detail: "The latest radar is too old to estimate where this precipitation area may go. Refresh and try again.")
        }
        guard let point = pixel(target, frame: latest) else {
            return unavailable(target: target, now: now, detail: "The selected spot is outside this radar sample.")
        }
        let width = latest.texture.width, height = latest.texture.height
        guard width <= 512, height <= 512,
              frames.allSatisfy({ $0.bounds == latest.bounds && $0.encoding == latest.encoding
                  && $0.texture.width == width && $0.texture.height == height }),
              latest.validDataMask[point.y * width + point.x] == 1 else {
            return unavailable(target: target, now: now, detail: "Radar coverage is missing at this spot. An empty area does not mean clear weather.")
        }
        let threshold = try RadarNumericContract.encodeDbz(minimumDBZ, encoding: latest.encoding)
        func wet(_ x: Int, _ y: Int) -> Bool {
            let index = y * width + x
            return latest.validDataMask[index] == 1 && latest.texture.bytes[index] >= threshold
        }
        // Select the nearest substantive return within roughly 5 km of the
        // tap. This accommodates touch precision without selecting another
        // distant storm just to manufacture an answer.
        let kmPerPixel = max(0.01, (latest.bounds.maxLat - latest.bounds.minLat) * 111.2 / Double(height))
        let radius = min(12, max(1, Int((5 / kmPerPixel).rounded(.up))))
        var seed: (x: Int, y: Int)?, nearest = Double.infinity
        for y in max(0, point.y - radius)...min(height - 1, point.y + radius) {
            for x in max(0, point.x - radius)...min(width - 1, point.x + radius) where wet(x, y) {
                let distance = hypot(Double(x - point.x), Double(y - point.y))
                if distance <= Double(radius), distance < nearest { seed = (x, y); nearest = distance }
            }
        }
        guard let seed else {
            return Report(target: target, checkedAt: now, observedAt: observedAt, state: .noEcho,
                title: "No precipitation area selected", detail: "Recent radar has no substantive return at this spot. Tap a visible precipitation area to check its possible path. Very light precipitation may be below this check’s threshold.",
                peakDBZ: nil, motionDirection: nil, places: [], hasQualifiedMotion: false)
        }
        var component = Set<Int>(), queue = [seed.y * width + seed.x], cursor = 0
        component.insert(queue[0])
        var clipped = false, peak = 0.0
        while cursor < queue.count {
            if cursor % 512 == 0 { try Task.checkCancellation() }
            let index = queue[cursor], x = index % width, y = index / width
            cursor += 1
            peak = max(peak, RadarNumericContract.decodeDbz(latest.texture.bytes[index], encoding: latest.encoding) ?? 0)
            if x == 0 || y == 0 || x == width - 1 || y == height - 1 { clipped = true }
            for dy in -1...1 {
                for dx in -1...1 where dx != 0 || dy != 0 {
                    let nextX = x + dx, nextY = y + dy
                    guard nextX >= 0, nextX < width, nextY >= 0, nextY < height else { continue }
                    let next = nextY * width + nextX
                    if latest.validDataMask[next] == 0 { clipped = true }
                    if wet(nextX, nextY), component.insert(next).inserted { queue.append(next) }
                }
            }
        }
        guard component.count >= 4 else {
            return unavailable(target: target, now: now, detail: "This radar return is too small to track reliably. Try a larger precipitation area.")
        }
        var motion: NativeRadarSeamEstimation.Motion?
        let significantPixels = latest.texture.bytes.indices.filter {
            latest.validDataMask[$0] == 1 && latest.texture.bytes[$0] >= threshold
        }.count
        // Whole-sample correlation must not assign a different, dominant rain
        // area's motion to a small selected cell. In that case show observed
        // evidence and withhold arrival estimates.
        let selectedDominates = Double(component.count) / Double(max(1, significantPixels)) >= 0.55
        if !clipped, selectedDominates, frames.count >= 3,
           case let .ready(value) = try NativeRadarSeamEstimation.estimateMotion(frames: frames, options: .rawMap),
           value.confidence >= 0.56, value.consistency >= 0.5, value.observedSpanMinutes >= 12,
           value.speedPixelsPerMinute >= 0.05 {
            motion = value
        }
        let placeReads = places.filter(\.isValid).prefix(60).map { place -> PlaceRead in
            guard let p = pixel(place, frame: latest) else {
                return .init(place: place, status: .outside, earliestMinutes: nil, latestMinutes: nil)
            }
            guard latest.validDataMask[p.y * width + p.x] == 1 else {
                return .init(place: place, status: .unavailable, earliestMinutes: nil, latestMinutes: nil)
            }
            if component.contains(p.y * width + p.x) {
                return .init(place: place, status: .observed, earliestMinutes: nil, latestMinutes: nil)
            }
            guard let motion else {
                return .init(place: place, status: .unavailable, earliestMinutes: nil, latestMinutes: nil)
            }
            // Move the selected observed footprint only. Never extrapolate all
            // unrelated cells in the sample into the selected storm's path.
            for minutes in stride(from: 0, through: lookaheadMinutes, by: 3) {
                let elapsed = age / 60 + Double(minutes)
                let x = Int((Double(p.x) - motion.velocityX * elapsed).rounded())
                let y = Int((Double(p.y) - motion.velocityY * elapsed).rounded())
                if x >= 0, x < width, y >= 0, y < height, component.contains(y * width + x) {
                    let first = max(0, ((minutes - 6) / 5) * 5)
                    let last = min(lookaheadMinutes, Int((Double(minutes + 9) / 5).rounded(.up)) * 5)
                    return .init(place: place, status: .possible, earliestMinutes: first, latestMinutes: last)
                }
            }
            return .init(place: place, status: .noOverlap, earliestMinutes: nil, latestMinutes: nil)
        }
        let detail = motion != nil
            ? "Possible paths use recent radar motion. Arrival windows assume the precipitation area holds together."
            : clipped ? "The selected precipitation area extends beyond this sample or into missing coverage, so an arrival estimate is unavailable."
            : "Radar shows this precipitation area, but its recent motion is not consistent enough for an arrival estimate."
        return Report(target: target, checkedAt: now, observedAt: observedAt, state: .ready,
            title: "Selected precipitation area", detail: detail, peakDBZ: peak,
            motionDirection: motion?.directionDegrees, places: placeReads, hasQualifiedMotion: motion != nil)
    }

    private static func pixel(_ place: Location, frame: NativeRadarSeamEstimation.Frame) -> (x: Int, y: Int)? {
        let bounds = frame.bounds
        guard place.latitude >= bounds.minLat, place.latitude <= bounds.maxLat,
              place.longitude >= bounds.minLon, place.longitude <= bounds.maxLon else { return nil }
        func mercator(_ latitude: Double) -> Double { log(tan(.pi / 4 + latitude * .pi / 360)) }
        let x = (place.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon) * Double(frame.texture.width)
        let y = (mercator(bounds.maxLat) - mercator(place.latitude))
            / (mercator(bounds.maxLat) - mercator(bounds.minLat)) * Double(frame.texture.height)
        guard x.isFinite, y.isFinite else { return nil }
        return (min(frame.texture.width - 1, max(0, Int(x))), min(frame.texture.height - 1, max(0, Int(y))))
    }
}
