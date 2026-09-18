import Foundation
import CoreFoundation

enum NativeEssentialsStatus: String, Sendable {
    case ready, stale, unavailable, unsupported
}

struct NativeAQIBand: Sendable, Equatable {
    let label: String
    let rank: Int
    let advice: String

    static func value(_ aqi: Double) -> Self? {
        guard aqi.isFinite, aqi >= 0 else { return nil }
        // Match the existing app's displayed US AQI category and advice.
        switch aqi.rounded() {
        case ...50: return Self(label: "Good", rank: 0, advice: "Air looks good")
        case ...100: return Self(label: "Moderate", rank: 1, advice: "Fine for most people")
        case ...150: return Self(label: "Unhealthy for sensitive groups", rank: 2, advice: "Sensitive folks should ease up")
        case ...200: return Self(label: "Unhealthy", rank: 3, advice: "Keep hard efforts short")
        case ...300: return Self(label: "Very unhealthy", rank: 4, advice: "Limit outdoor time")
        default: return Self(label: "Hazardous", rank: 5, advice: "Stay inside if possible")
        }
    }
}

/// Regional model guidance, not a measurement from a nearby air sensor.
/// `sampleAt` is the estimate's valid time, not its model-run or download time.
struct NativeAirQualitySnapshot: Sendable {
    let sampleAt: Date
    let usAQI: Double?
    let pm25: Double?
    let pm10: Double?
    var band: NativeAQIBand? { usAQI.flatMap(NativeAQIBand.value) }
    static let source = "Open-Meteo / CAMS"
}

struct NativeAirQualityState: Sendable {
    let status: NativeEssentialsStatus
    let checkedAt: Date?
    let snapshot: NativeAirQualitySnapshot?
    let message: String?
    static let source = NativeAirQualitySnapshot.source

    var validUntil: Date? {
        guard let checkedAt, let snapshot else { return nil }
        return min(checkedAt.addingTimeInterval(30 * 60), snapshot.sampleAt.addingTimeInterval(90 * 60))
    }
    func isFresh(now: Date = Date()) -> Bool {
        guard status == .ready, let checkedAt, let snapshot, let validUntil else { return false }
        return checkedAt <= now.addingTimeInterval(60) && snapshot.sampleAt <= now.addingTimeInterval(60) && now <= validUntil
    }
    func current(at now: Date = Date()) -> NativeAirQualitySnapshot? { isFresh(now: now) ? snapshot : nil }
}

struct NativeOfficialAlert: Sendable, Identifiable {
    let id: String
    let event: String
    let headline: String
    let description: String
    let instruction: String
    let areaDescription: String
    let severity: String
    let urgency: String
    let sent: Date?
    let startAt: Date
    /// Event ending time is distinct from the product's refresh/expiry time.
    let endAt: Date
    let eventEndsAt: Date?
    let expiresAt: Date
    let sourceURL: URL?

    var priority: Int {
        let severityRank = ["Extreme": 4, "Severe": 3, "Moderate": 2, "Minor": 1][severity] ?? 0
        let lower = event.lowercased()
        let tone = lower.contains("warning") ? 4 : lower.contains("watch") ? 3 : lower.contains("advisory") ? 2 : 1
        return tone * 10 + severityRank
    }
    func isActive(at now: Date) -> Bool { startAt <= now && endAt > now && expiresAt > now }
}

struct NativeAlertState: Sendable {
    let status: NativeEssentialsStatus
    /// The last successful check, retained when a refresh fails.
    let checkedAt: Date?
    let alerts: [NativeOfficialAlert]
    let message: String?
    static let source = "National Weather Service"
    var validUntil: Date? {
        guard let checkedAt else { return nil }
        return min(checkedAt.addingTimeInterval(5 * 60), alerts.map(\.expiresAt).min() ?? .distantFuture)
    }

    func isFresh(now: Date = Date()) -> Bool {
        guard status == .ready, let checkedAt, let validUntil else { return false }
        return checkedAt <= now.addingTimeInterval(60) && now < validUntil
    }
    func activeAlerts(at now: Date = Date()) -> [NativeOfficialAlert] { alerts.filter { $0.isActive(at: now) } }
    /// Future alerts are scoped to their actual interval. Today's results omit
    /// already-ended alerts; selecting another day never copies today's banner.
    func relevantAlerts(on day: Date, calendar: Calendar, now: Date = Date()) -> [NativeOfficialAlert] {
        guard let interval = calendar.dateInterval(of: .day, for: day) else { return [] }
        let start = calendar.isDate(day, inSameDayAs: now) ? max(interval.start, now) : interval.start
        // Retain a last-known event window for an explicitly unverified detail;
        // isFresh becomes false at product expiry and must govern any wording.
        return alerts.filter { $0.startAt < interval.end && $0.endAt > start && $0.endAt > now }
    }
}

struct NativeWeatherEssentials: Sendable {
    let latitude: Double
    let longitude: Double
    let airQuality: NativeAirQualityState
    let alerts: NativeAlertState
}

enum NativeEssentialsError: Error {
    case invalidCoordinates, invalidPayload, mismatchedPlace, invalidTimezone, mismatchedUnits
    case httpStatus(Int)
}

enum NativeEssentialsDecoder {
    typealias Object = [String: Any]
    static let nwsCountries: Set<String> = ["US", "PR", "GU", "VI", "AS", "MP"]

    static func airQuality(data: Data, latitude: Double, longitude: Double, now: Date) throws -> NativeAirQualityState {
        guard valid(latitude: latitude, longitude: longitude) else { throw NativeEssentialsError.invalidCoordinates }
        guard data.count <= 2_000_000, let payload = try JSONSerialization.jsonObject(with: data) as? Object,
              payload["error"] as? Bool != true else { throw NativeEssentialsError.invalidPayload }
        // CAMS returns a grid-cell center, not the requested coordinate. Keep a
        // bounded geographic check without pretending it is a point observation.
        guard let gridLat = number(payload["latitude"]), let gridLon = number(payload["longitude"]),
              valid(latitude: gridLat, longitude: gridLon),
              distanceKM(latitude, longitude, gridLat, gridLon) <= 100 else { throw NativeEssentialsError.mismatchedPlace }
        guard let zoneName = payload["timezone"] as? String, let zone = TimeZone(identifier: zoneName) else {
            throw NativeEssentialsError.invalidTimezone
        }
        let current = payload["current"] as? Object
        let hourly = payload["hourly"] as? Object
        for (section, values) in [("current", current), ("hourly", hourly)] {
            guard let values else { continue }
            let units = payload[section + "_units"] as? Object
            if values["us_aqi"] != nil, units?["us_aqi"] as? String != "USAQI" { throw NativeEssentialsError.mismatchedUnits }
            for field in ["pm2_5", "pm10"] where values[field] != nil {
                guard ["μg/m³", "µg/m³", "ug/m3"].contains(units?[field] as? String ?? "") else {
                    throw NativeEssentialsError.mismatchedUnits
                }
            }
        }

        func reading(_ values: Object, sampleAt: Date) -> NativeAirQualitySnapshot? {
            let aqi = nonnegative(values["us_aqi"])
            let pm25 = nonnegative(values["pm2_5"])
            let pm10 = nonnegative(values["pm10"])
            guard aqi != nil || pm25 != nil || pm10 != nil else { return nil }
            return NativeAirQualitySnapshot(sampleAt: sampleAt, usAQI: aqi, pm25: pm25, pm10: pm10)
        }
        func currentTime(_ date: Date) -> Bool {
            // Current means the containing/recent model hour, never a future
            // day's air quality. Missing and stale values are not good air.
            date <= now.addingTimeInterval(60) && date >= now.addingTimeInterval(-90 * 60)
        }
        var snapshot: NativeAirQualitySnapshot?
        if let current, let sample = localDate(current["time"] as? String, zone: zone, latestAt: now), currentTime(sample) {
            snapshot = reading(current, sampleAt: sample)
        }
        if snapshot?.usAQI == nil, let hourly, let times = hourly["time"] as? [Any] {
            var candidates: [NativeAirQualitySnapshot] = []
            for (index, raw) in times.prefix(72).enumerated() {
                guard let sample = localDate(raw as? String, zone: zone, latestAt: now), currentTime(sample) else { continue }
                var values: Object = [:]
                for key in ["us_aqi", "pm2_5", "pm10"] {
                    if let array = hourly[key] as? [Any], index < array.count { values[key] = array[index] }
                }
                if let candidate = reading(values, sampleAt: sample) { candidates.append(candidate) }
            }
            // Do not mix pollutants from different timestamps in one estimate.
            snapshot = candidates.filter { $0.usAQI != nil }.max { $0.sampleAt < $1.sampleAt }
                ?? snapshot ?? candidates.max { $0.sampleAt < $1.sampleAt }
        }
        return NativeAirQualityState(status: snapshot == nil ? .unavailable : .ready, checkedAt: now, snapshot: snapshot,
            message: snapshot == nil ? "A current air-quality estimate isn't available for this place." : nil)
    }

    static func alerts(data: Data, latitude: Double, longitude: Double, countryCode: String?, now: Date) throws -> NativeAlertState {
        guard valid(latitude: latitude, longitude: longitude) else { throw NativeEssentialsError.invalidCoordinates }
        guard data.count <= 4_000_000, let payload = try JSONSerialization.jsonObject(with: data) as? Object,
              payload["type"] as? String == "FeatureCollection", let features = payload["features"] as? [Object],
              features.count <= 500 else { throw NativeEssentialsError.invalidPayload }
        let country = normalizedCountry(countryCode)
        let knownCoverage = country.map { nwsCountries.contains($0) } ?? false
        if let country, !nwsCountries.contains(country) {
            return NativeAlertState(status: .unsupported, checkedAt: nil, alerts: [], message: "Official alerts are not available here from our current source.")
        }
        var incomplete = false
        var decoded: [String: NativeOfficialAlert] = [:]
        for feature in features {
            guard let p = feature["properties"] as? Object else { incomplete = true; continue }
            // CAP test/exercise/cancel records never become live weather alerts.
            if let status = p["status"] as? String, status != "Actual" { continue }
            if let type = p["messageType"] as? String, !["Alert", "Update"].contains(type) { continue }
            guard let expires = isoDate(p["expires"] as? String) else { incomplete = true; continue }
            let ends = isoDate(p["ends"] as? String)
            // CAP expiry is when the bulletin must be updated, not when the
            // hazard necessarily ends. See NWS CAP User Training, slide 15:
            // https://www.weather.gov/media/wrn/calendar/2023NWS-CAP-User-Training.pdf
            let end = ends ?? expires
            if expires <= now { incomplete = true }
            if end <= now { continue }
            let sent = isoDate(p["sent"] as? String)
            let effective = isoDate(p["effective"] as? String)
            let onset = isoDate(p["onset"] as? String)
            guard let weatherStart = onset ?? effective ?? sent else { incomplete = true; continue }
            let start = max(weatherStart, effective ?? weatherStart)
            guard start < end else { incomplete = true; continue }
            if let sent, sent > now.addingTimeInterval(60) { incomplete = true; continue }
            let rawGeometry = feature["geometry"]
            if rawGeometry == nil || rawGeometry is NSNull {
                // For supported countries, a successful NWS point query is an
                // authoritative fallback for county/zone-based alerts.
                guard knownCoverage else { incomplete = true; continue }
            } else {
                guard let geometry = AlertGeometry(raw: rawGeometry) else { incomplete = true; continue }
                guard geometry.contains(latitude: latitude, longitude: longitude) else { continue }
            }
            guard let event = string(p["event"], maximum: 250), !event.isEmpty,
                  let id = string(p["id"] ?? feature["id"], maximum: 500), !id.isEmpty else { incomplete = true; continue }
            let headline = string(p["headline"], maximum: 3_000) ?? event
            let sourceURL = (p["web"] as? String).flatMap(officialURL)
                ?? (p["@id"] as? String).flatMap(officialURL)
                ?? officialURL(id)
            let alert = NativeOfficialAlert(id: id, event: event, headline: headline,
                description: string(p["description"], maximum: 40_000) ?? "",
                instruction: string(p["instruction"], maximum: 20_000) ?? "",
                areaDescription: string(p["areaDesc"], maximum: 10_000) ?? "",
                severity: string(p["severity"], maximum: 30) ?? "Unknown",
                urgency: string(p["urgency"], maximum: 30) ?? "Unknown", sent: sent,
                startAt: start, endAt: end, eventEndsAt: ends, expiresAt: expires, sourceURL: sourceURL)
            if let prior = decoded[id], (prior.sent ?? .distantPast) > (alert.sent ?? .distantPast) { continue }
            decoded[id] = alert
        }
        let alerts = decoded.values.sorted { a, b in
            if a.priority != b.priority { return a.priority > b.priority }
            if a.startAt != b.startAt { return a.startAt < b.startAt }
            return a.id < b.id
        }
        let ready = knownCoverage && !incomplete
        return NativeAlertState(status: ready ? .ready : .unavailable, checkedAt: now, alerts: alerts,
            message: ready ? nil : !knownCoverage
                ? "Official alert coverage couldn't be confirmed for this place."
                : "Some official alert information couldn't be verified. Check local guidance.")
    }

    static func normalizedCountry(_ value: String?) -> String? {
        guard let code = value?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), code.count == 2 else { return nil }
        return code
    }
    static func valid(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180
    }
    static func number(_ raw: Any?) -> Double? {
        guard let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return nil }
        return value.doubleValue
    }
    private static func nonnegative(_ raw: Any?) -> Double? { number(raw).flatMap { $0 >= 0 ? $0 : nil } }
    private static func string(_ raw: Any?, maximum: Int) -> String? {
        guard let value = raw as? String, value.count <= maximum else { return nil }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private static func officialURL(_ value: String) -> URL? {
        guard let url = URL(string: value), url.scheme == "https", let host = url.host?.lowercased(),
              host == "weather.gov" || host.hasSuffix(".weather.gov"), url.user == nil, url.password == nil else { return nil }
        return url
    }
    private static func isoDate(_ raw: String?) -> Date? {
        guard let raw, raw.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil else { return nil }
        let formatter = ISO8601DateFormatter()
        if let value = formatter.date(from: raw) { return value }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: raw)
    }
    private static func localDate(_ raw: String?, zone: TimeZone, latestAt now: Date) -> Date? {
        if let absolute = isoDate(raw) { return absolute }
        guard let raw, raw.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.isLenient = false
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        guard let parsed = formatter.date(from: raw) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let components = calendar.dateComponents([.hour, .minute], from: parsed)
        guard let hour = components.hour, let minute = components.minute,
              let last = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: parsed,
                matchingPolicy: .strict, repeatedTimePolicy: .last) else { return parsed }
        return last <= now ? last : parsed
    }
    private static func distanceKM(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let radians = Double.pi / 180
        let dLat = (lat2 - lat1) * radians, dLon = (lon2 - lon1) * radians
        let a = pow(sin(dLat / 2), 2) + cos(lat1 * radians) * cos(lat2 * radians) * pow(sin(dLon / 2), 2)
        return 6371 * 2 * atan2(sqrt(max(0, min(1, a))), sqrt(max(0, 1 - min(1, a))))
    }

    /// Same official polygon policy as the existing web map: polygon holes,
    /// dateline wrapping and exact boundaries are respected. Damaged geometry
    /// is unknown; it is never silently downgraded to a point-query fallback.
    private struct AlertGeometry {
        typealias Point = [Double]
        typealias Ring = [Point]
        typealias Polygon = [Ring]
        let polygons: [Polygon]

        init?(raw: Any?) {
            guard let object = raw as? Object, let type = object["type"] as? String else { return nil }
            let inputs: [Any]
            if type == "Polygon", let polygon = object["coordinates"] { inputs = [polygon] }
            else if type == "MultiPolygon", let polygons = object["coordinates"] as? [Any] { inputs = polygons }
            else { return nil }
            guard !inputs.isEmpty, inputs.count <= 300 else { return nil }
            var result: [Polygon] = []
            var vertexCount = 0
            for input in inputs {
                guard let rawRings = input as? [Any], !rawRings.isEmpty else { return nil }
                var polygon: Polygon = []
                for rawRing in rawRings {
                    guard let positions = rawRing as? [Any], positions.count >= 3 else { return nil }
                    var ring: Ring = []
                    for position in positions {
                        vertexCount += 1
                        guard vertexCount <= 100_000, let xy = position as? [Any], xy.count >= 2,
                              let lon = number(xy[0]), let lat = number(xy[1]), valid(latitude: lat, longitude: lon) else { return nil }
                        ring.append([lon, lat])
                    }
                    if ring.first != ring.last { ring.append(ring[0]) }
                    let distinct = Set(ring.dropLast().map { "\($0[0]),\($0[1])" })
                    guard ring.count >= 4, distinct.count >= 3 else { return nil }
                    polygon.append(ring)
                }
                result.append(polygon)
            }
            polygons = result
        }

        func contains(latitude: Double, longitude: Double) -> Bool {
            let point = [longitude, latitude]
            return polygons.contains { polygon in
                let outer = relation(point, polygon[0])
                guard outer.inside else { return false }
                if outer.boundary { return true }
                for ring in polygon.dropFirst() {
                    let hole = relation(point, ring)
                    if hole.boundary { return true }
                    if hole.inside { return false }
                }
                return true
            }
        }

        private func relation(_ point: Point, _ input: Ring) -> (inside: Bool, boundary: Bool) {
            var ring: Ring = [input[0]]
            for next in input.dropFirst() {
                var lon = next[0]
                let previous = ring.last![0]
                while lon - previous > 180 { lon -= 360 }
                while lon - previous < -180 { lon += 360 }
                ring.append([lon, next[1]])
            }
            for x in [point[0] - 360, point[0], point[0] + 360] {
                let y = point[1]
                var inside = false
                for index in ring.indices {
                    let a = ring[index == 0 ? ring.count - 1 : index - 1], b = ring[index]
                    let cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])
                    let tolerance = 1e-9 * max(1, abs(b[0] - a[0]) + abs(b[1] - a[1]))
                    if abs(cross) <= tolerance && x >= min(a[0], b[0]) - tolerance && x <= max(a[0], b[0]) + tolerance
                        && y >= min(a[1], b[1]) - tolerance && y <= max(a[1], b[1]) + tolerance {
                        return (true, true)
                    }
                    if (a[1] > y) != (b[1] > y), x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0] { inside.toggle() }
                }
                if inside { return (true, false) }
            }
            return (false, false)
        }
    }
}
