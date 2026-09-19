import Foundation
import CoreFoundation

/// Official NWS CAP/GeoJSON map foundation. No notification settings, generated
/// county outlines, cached all-clear claims, or model-weather time coupling.
enum NativeRadarAlertsContract {
    static let maximumBytes = 4_000_000
    static let maximumFeatures = 500
    static let maximumVertices = 100_000
    static let maximumViewportPages = 4
    static let maximumViewportBytes = 8_000_000
    static let maximumViewportFeatures = 2_000
    static let countries: Set<String> = ["US", "PR", "GU", "VI", "AS", "MP"]
    private static let areas = Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP".split(separator: " ").map(String.init))

    enum Failure: Error, Equatable { case invalidScope, invalidPayload, invalidGeometry, invalidTime, sizeLimit, requestInFlight, transport, redirect, httpStatus(Int) }
    enum Quality: String, Sendable { case verified, incomplete, unknownCoverage, unsupported }
    enum Coverage: String, Sendable { case inside, outside, unknown }
    enum CoverageBasis: String, Sendable { case featureGeometry = "feature-geometry", pointQuery = "nws-point-query", unavailable }
    enum Tone: String, Sendable {
        case warning, watch, advisory, notice
        var rank: Int { switch self { case .warning: 4; case .watch: 3; case .advisory: 2; case .notice: 1 } }
        /// Same source-color categories as map.js; not hazard probability.
        var rgb: [UInt8] { switch self { case .warning: [224, 67, 62]; case .watch: [236, 155, 44]; case .advisory: [236, 194, 72]; case .notice: [104, 166, 222] } }
    }

    struct Point: Equatable, Sendable {
        let latitude: Double, longitude: Double
        init(latitude: Double, longitude: Double) throws {
            guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 else { throw Failure.invalidScope }
            self.latitude = latitude; self.longitude = longitude
        }
    }

    struct Viewport: Equatable, Sendable {
        let west: Double, south: Double, east: Double, north: Double
        init(west: Double, south: Double, east: Double, north: Double) throws {
            guard [west, south, east, north].allSatisfy(\.isFinite), abs(west) <= 180, abs(east) <= 180,
                  south >= -90, north <= 90, west != east, !(west == 180 && east == -180), south < north else { throw Failure.invalidScope }
            self.west = west; self.south = south; self.east = east; self.north = north
        }

        /// Two ordinary boxes represent a dateline crossing; no polygon is
        /// stretched across the globe or modified to fit the camera.
        fileprivate var parts: [Viewport] {
            if west < east { return [self] }
            return [try? Viewport(west: west, south: south, east: 180, north: north),
                    try? Viewport(west: -180, south: south, east: east, north: north)].compactMap { $0 }
        }
    }

    struct Scope: Equatable, Sendable {
        enum Kind: String, Sendable { case point, area, viewport }
        let kind: Kind
        let selectedPlace: Point?
        let countryCode: String?
        let areaCode: String?
        let viewport: Viewport?

        static func point(latitude: Double, longitude: Double, countryCode: String?) throws -> Scope {
            let point = try Point(latitude: latitude, longitude: longitude)
            let country = countryCode?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard country == nil || country?.count == 2 else { throw Failure.invalidScope }
            return Scope(kind: .point, selectedPlace: point, countryCode: country, areaCode: nil, viewport: nil)
        }

        /// Caller must supply a KNOWN state/territory, never infer it from viewport
        /// corners. A view crossing a state border is not complete for other states.
        /// Marine area codes are not supported here.
        static func area(code: String, selectedPlace: Point? = nil, viewport: Viewport? = nil) throws -> Scope {
            let code = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard areas.contains(code) else { throw Failure.invalidScope }
            return Scope(kind: .area, selectedPlace: selectedPlace, countryCode: "US", areaCode: code, viewport: viewport)
        }

        static func viewport(_ viewport: Viewport, selectedPlace: Point? = nil, countryCode: String? = "US") throws -> Scope {
            let country = countryCode?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard country == nil || country?.count == 2 else { throw Failure.invalidScope }
            return Scope(kind: .viewport, selectedPlace: selectedPlace, countryCode: country, areaCode: nil, viewport: viewport)
        }

        var isSupported: Bool { countryCode.map { countries.contains($0) } ?? true }
        var hasKnownCoverage: Bool { kind != .viewport && (kind == .area || countryCode.map { countries.contains($0) } == true) }
        var url: URL {
            var url = URLComponents(string: "https://api.weather.gov/alerts/active")!
            if let areaCode { url.queryItems = [.init(name: "area", value: areaCode)] }
            else if kind == .point, let point = selectedPlace {
                let value = String(format: "%.4f,%.4f", locale: Locale(identifier: "en_US_POSIX"), point.latitude, point.longitude)
                url.queryItems = [.init(name: "point", value: value)]
            }
            return url.url!
        }
    }

    struct Geometry: Sendable {
        typealias Ring = [Point]
        typealias Polygon = [Ring]
        let type: String
        let polygons: [Polygon]
        let vertexCount: Int

        init(raw: Any, remainingVertices: Int = maximumVertices) throws {
            guard let object = raw as? [String: Any], let type = object["type"] as? String else { throw Failure.invalidGeometry }
            let inputs: [Any]
            if type == "Polygon", let coordinates = object["coordinates"] { inputs = [coordinates] }
            else if type == "MultiPolygon", let coordinates = object["coordinates"] as? [Any] { inputs = coordinates }
            else { throw Failure.invalidGeometry }
            guard !inputs.isEmpty, inputs.count <= 300 else { throw Failure.invalidGeometry }
            var result: [Polygon] = [], count = 0
            for input in inputs {
                guard let rawRings = input as? [Any], !rawRings.isEmpty, rawRings.count <= 300 else { throw Failure.invalidGeometry }
                var polygon: Polygon = []
                for rawRing in rawRings {
                    guard let positions = rawRing as? [Any], positions.count >= 3 else { throw Failure.invalidGeometry }
                    var ring: Ring = []
                    for rawPosition in positions {
                        count += 1
                        guard count <= remainingVertices, let xy = rawPosition as? [Any], (2...3).contains(xy.count),
                              let longitude = number(xy[0]), let latitude = number(xy[1]) else { throw Failure.invalidGeometry }
                        if xy.count == 3, number(xy[2]) == nil { throw Failure.invalidGeometry }
                        ring.append(try Point(latitude: latitude, longitude: longitude))
                    }
                    if ring.first != ring.last { ring.append(ring[0]); count += 1 }
                    guard count <= remainingVertices, ring.count >= 4,
                          Set(ring.dropLast().map { "\($0.longitude),\($0.latitude)" }).count >= 3 else { throw Failure.invalidGeometry }
                    let unwrapped = Self.unwrap(ring)
                    var area = 0.0
                    for index in 1..<unwrapped.count { area += unwrapped[index - 1].0 * unwrapped[index].1 - unwrapped[index].0 * unwrapped[index - 1].1 }
                    guard abs(area) > 1e-12 else { throw Failure.invalidGeometry }
                    polygon.append(ring)
                }
                result.append(polygon)
            }
            self.type = type; polygons = result; vertexCount = count
        }

        func contains(_ point: Point) -> Bool {
            polygons.contains { polygon in
                let outer = Self.relation(point, polygon[0])
                guard outer.inside else { return false }
                if outer.boundary { return true }
                for ring in polygon.dropFirst() {
                    let hole = Self.relation(point, ring)
                    if hole.boundary { return true }
                    if hole.inside { return false }
                }
                return true
            }
        }

        /// Used only to restrict rendering within a requested viewport. This is
        /// geometry intersection, not a claim that null county alerts are absent.
        func intersects(_ viewport: Viewport) -> Bool {
            if viewport.west > viewport.east { return viewport.parts.contains { intersects($0) } }
            let corners = [(viewport.west, viewport.south), (viewport.east, viewport.south),
                           (viewport.east, viewport.north), (viewport.west, viewport.north)]
            if corners.contains(where: { contains(try! Point(latitude: $0.1, longitude: $0.0)) }) { return true }
            for polygon in polygons { for ring in polygon {
                let unwrapped = Self.unwrap(ring)
                for shift in [-360.0, 0, 360] {
                    for index in 1..<unwrapped.count {
                        let a = (unwrapped[index - 1].0 + shift, unwrapped[index - 1].1)
                        let b = (unwrapped[index].0 + shift, unwrapped[index].1)
                        if Self.segmentIntersectsViewport(a, b, viewport) { return true }
                    }
                }
            } }
            return false
        }

        var json: [String: Any] {
            let coordinates = polygons.map { $0.map { $0.map { [$0.longitude, $0.latitude] } } }
            return ["type": type, "coordinates": type == "Polygon" ? coordinates[0] as Any : coordinates as Any]
        }

        private static func unwrap(_ ring: Ring) -> [(Double, Double)] {
            var output = [(ring[0].longitude, ring[0].latitude)]
            for point in ring.dropFirst() {
                var longitude = point.longitude
                let previous = output.last!.0
                while longitude - previous > 180 { longitude -= 360 }
                while longitude - previous < -180 { longitude += 360 }
                output.append((longitude, point.latitude))
            }
            return output
        }

        private static func relation(_ point: Point, _ input: Ring) -> (inside: Bool, boundary: Bool) {
            let ring = unwrap(input)
            for longitude in [point.longitude - 360, point.longitude, point.longitude + 360] {
                var inside = false
                for index in 1..<ring.count {
                    let a = ring[index - 1], b = ring[index], latitude = point.latitude
                    let cross = (longitude - a.0) * (b.1 - a.1) - (latitude - a.1) * (b.0 - a.0)
                    let tolerance = 1e-9 * max(1, abs(b.0 - a.0) + abs(b.1 - a.1))
                    if abs(cross) <= tolerance, longitude >= min(a.0, b.0) - tolerance, longitude <= max(a.0, b.0) + tolerance,
                       latitude >= min(a.1, b.1) - tolerance, latitude <= max(a.1, b.1) + tolerance { return (true, true) }
                    if (a.1 > latitude) != (b.1 > latitude), longitude < (b.0 - a.0) * (latitude - a.1) / (b.1 - a.1) + a.0 { inside.toggle() }
                }
                if inside { return (true, false) }
            }
            return (false, false)
        }

        private static func segmentIntersectsViewport(_ a: (Double, Double), _ b: (Double, Double), _ v: Viewport) -> Bool {
            // Liang–Barsky clipping tests whether an existing edge intersects;
            // the clipped coordinates are never substituted into official data.
            let dx = b.0 - a.0, dy = b.1 - a.1
            let p = [-dx, dx, -dy, dy], q = [a.0 - v.west, v.east - a.0, a.1 - v.south, v.north - a.1]
            var low = 0.0, high = 1.0
            for index in 0..<4 {
                if p[index] == 0 { if q[index] < 0 { return false }; continue }
                let t = q[index] / p[index]
                if p[index] < 0 { low = max(low, t) } else { high = min(high, t) }
                if low > high { return false }
            }
            return true
        }
    }

    struct Alert: Sendable {
        let id: String
        var key: String { "id:" + id }
        let event: String, headline: String, description: String, instruction: String, areaDescription: String
        let severity: String, urgency: String, certainty: String
        let status: String, messageType: String
        let sent: Date?, effective: Date?, onset: Date?, eventEndsAt: Date?
        let startAt: Date, endAt: Date, expiresAt: Date
        let sourceURL: URL?
        let geometry: Geometry?
        let coverage: Coverage, coverageBasis: CoverageBasis
        let tone: Tone
        var priority: Int { tone.rank * 100 + (["Extreme": 4, "Severe": 3, "Moderate": 2, "Minor": 1][severity] ?? 0) * 10 }
        func isActive(at now: Date) -> Bool { now.timeIntervalSince1970.isFinite && startAt <= now && endAt > now && expiresAt > now }
    }

    struct Snapshot: Sendable {
        let scope: Scope
        let checkedAt: Date?
        let quality: Quality
        let rejectedFeatureCount: Int
        let alerts: [Alert]
        var validUntil: Date? {
            guard let checkedAt else { return nil }
            return min(checkedAt.addingTimeInterval(300), alerts.map(\.expiresAt).min() ?? .distantFuture)
        }
        func isFresh(at now: Date) -> Bool {
            guard let checkedAt, let validUntil, now.timeIntervalSince1970.isFinite else { return false }
            return checkedAt <= now.addingTimeInterval(60) && now < validUntil
        }
        /// An empty/failed/incomplete/unknown result must not be an all-clear.
        func isVerifiedEmpty(at now: Date) -> Bool {
            quality == .verified && isFresh(at: now) && alerts.isEmpty
        }
        func alert(idOrKey: String) -> Alert? { alerts.first { $0.id == idOrKey || $0.key == idOrKey } }

        /// Active NOW, independently of the weather-map timeline. Stale checks
        /// render no official-current polygons. Bulletins stay available above
        /// for explicitly last-known detail; no geometry is created for them.
        func featureCollection(at now: Date, selectedID: String? = nil) throws -> Data {
            guard now.timeIntervalSince1970.isFinite else { throw Failure.invalidTime }
            let renderable = isFresh(at: now) ? alerts.filter { $0.isActive(at: now) && $0.geometry != nil } : []
            let features: [[String: Any]] = renderable.compactMap { alert in
                guard let geometry = alert.geometry else { return nil }
                if let viewport = scope.viewport, !geometry.intersects(viewport) { return nil }
                return ["type": "Feature", "id": alert.key,
                        "properties": ["key": alert.key, "alertID": alert.id, "tone": alert.tone.rawValue,
                                       "selected": selectedID == alert.id || selectedID == alert.key ? 1 : 0,
                                       "coverage": alert.coverage.rawValue, "coverageBasis": alert.coverageBasis.rawValue],
                        "geometry": geometry.json]
            }
            return try JSONSerialization.data(withJSONObject: ["type": "FeatureCollection", "features": features], options: [.sortedKeys])
        }
    }

    /// "Complete" refers only to the bounded NWS polygon feed. Many valid NWS
    /// county/zone bulletins have no geometry. They cannot be assigned to a
    /// viewport from this feed, so this result must never mean "no alerts".
    struct ViewportSnapshot: Sendable {
        enum Completeness: String, Sendable { case polygonFeedComplete, partial, unsupported }
        let snapshot: Snapshot
        let completeness: Completeness
        let unmappedBulletinCount: Int
        let pageCount: Int
        let wasCached: Bool
    }

    static func decodeViewport(_ pages: [Data], scope: Scope, checkedAt: Date, now: Date,
                               transportComplete: Bool, wasCached: Bool = false) throws -> ViewportSnapshot {
        guard scope.kind == .viewport, let viewport = scope.viewport, checkedAt.timeIntervalSince1970.isFinite,
              now.timeIntervalSince1970.isFinite, checkedAt <= now.addingTimeInterval(60) else { throw Failure.invalidScope }
        guard scope.isSupported else {
            return ViewportSnapshot(snapshot: .init(scope: scope, checkedAt: nil, quality: .unsupported,
                rejectedFeatureCount: 0, alerts: []), completeness: .unsupported, unmappedBulletinCount: 0,
                pageCount: 0, wasCached: false)
        }
        guard !pages.isEmpty, pages.count <= maximumViewportPages,
              pages.reduce(0, { $0 + $1.count }) <= maximumViewportBytes else { throw Failure.sizeLimit }
        var features: [Any] = [], rejected = transportComplete ? 0 : 1
        for page in pages {
            let document = try pageDocument(page)
            let entries = document["features"] as! [Any]
            let remaining = maximumViewportFeatures - features.count
            features.append(contentsOf: entries.prefix(remaining))
            if entries.count > remaining { rejected += 1 }
        }
        // Decode together so cancellations, updates, and duplicate CAP IDs work
        // across page boundaries, not just within one page.
        let decoded = try decodeFeatures(features, scope: scope, now: now, rejected: rejected)
        let unmapped = decoded.alerts.filter { $0.geometry == nil && $0.expiresAt > now }.count
        // Expired products still present in the provider's active feed must not
        // blank otherwise current, valid polygons through Snapshot.validUntil.
        // Their rejection keeps completeness partial; no stale shape is drawn.
        let visible = decoded.alerts.filter { $0.expiresAt > now && $0.geometry?.intersects(viewport) == true }
        let snapshot = Snapshot(scope: scope, checkedAt: checkedAt, quality: .unknownCoverage,
            rejectedFeatureCount: decoded.rejectedFeatureCount, alerts: visible)
        return ViewportSnapshot(snapshot: snapshot,
            completeness: decoded.rejectedFeatureCount == 0 ? .polygonFeedComplete : .partial,
            unmappedBulletinCount: unmapped, pageCount: pages.count, wasCached: wasCached)
    }

    /// Pagination is data, not authority to contact another host or broaden the
    /// query to historical alerts. Reconstruct only the public active endpoint.
    /// NWS documents cursors/limit on /alerts; its active filter is preserved:
    /// https://api.weather.gov/openapi.json
    static func viewportNextPage(_ data: Data) throws -> URL? {
        let document = try pageDocument(data)
        guard let raw = document["pagination"], !(raw is NSNull) else { return nil }
        guard let pagination = raw as? [String: Any] else { throw Failure.invalidPayload }
        guard let next = pagination["next"], !(next is NSNull) else { return nil }
        guard let value = next as? String, value.utf8.count <= 4_000,
              let supplied = URLComponents(string: value), supplied.scheme == "https", supplied.host == "api.weather.gov",
              supplied.user == nil, supplied.password == nil, supplied.port == nil || supplied.port == 443,
              supplied.fragment == nil, ["/alerts", "/alerts/active"].contains(supplied.path),
              let items = supplied.queryItems, !items.isEmpty else { throw Failure.invalidPayload }
        var values: [String: String] = [:]
        for item in items {
            guard ["active", "limit", "cursor"].contains(item.name), values[item.name] == nil,
                  let value = item.value, !value.isEmpty else { throw Failure.invalidPayload }
            values[item.name] = value
        }
        guard supplied.path == "/alerts/active" || values["active"] == "true",
              values["active"] == nil || values["active"] == "true",
              let cursor = values["cursor"], cursor.utf8.count <= 3_000,
              !cursor.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw Failure.invalidPayload }
        if let limit = values["limit"] { guard let n = Int(limit), (1...500).contains(n) else { throw Failure.invalidPayload } }
        var url = URLComponents(string: "https://api.weather.gov/alerts")!
        url.queryItems = [.init(name: "active", value: "true"), .init(name: "limit", value: values["limit"] ?? "500"),
                          .init(name: "cursor", value: cursor)]
        return url.url!
    }

    static func viewportFeatureCount(_ data: Data) throws -> Int {
        (try pageDocument(data)["features"] as! [Any]).count
    }

    private static func pageDocument(_ data: Data) throws -> [String: Any] {
        guard data.count <= maximumBytes else { throw Failure.sizeLimit }
        guard let document = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              document["type"] as? String == "FeatureCollection", document["features"] is [Any] else { throw Failure.invalidPayload }
        return document
    }

    static func decode(_ data: Data, scope: Scope, now: Date) throws -> Snapshot {
        guard now.timeIntervalSince1970.isFinite else { throw Failure.invalidTime }
        guard scope.isSupported else { return Snapshot(scope: scope, checkedAt: nil, quality: .unsupported, rejectedFeatureCount: 0, alerts: []) }
        guard data.count <= maximumBytes, let document = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              document["type"] as? String == "FeatureCollection", let features = document["features"] as? [Any],
              features.count <= maximumFeatures else { throw Failure.invalidPayload }
        var rejected = 0
        // Never follow pagination to an unbounded/global URL. A truncated result
        // can still contain useful bulletins, but cannot establish completeness.
        if let pagination = document["pagination"] as? [String: Any], pagination["next"] != nil && !(pagination["next"] is NSNull) { rejected += 1 }
        return try decodeFeatures(features, scope: scope, now: now, rejected: rejected)
    }

    private static func decodeFeatures(_ features: [Any], scope: Scope, now: Date, rejected initialRejected: Int) throws -> Snapshot {
        var rejected = initialRejected, vertices = 0, decoded: [String: Alert] = [:]
        var retiredAt: [String: Date] = [:]
        for raw in features {
            guard let feature = raw as? [String: Any], feature["type"] as? String == "Feature",
                  let p = feature["properties"] as? [String: Any],
                  let status = p["status"] as? String, let messageType = p["messageType"] as? String else { rejected += 1; continue }
            guard ["Actual", "Exercise", "System", "Test", "Draft"].contains(status),
                  ["Alert", "Update", "Cancel", "Ack", "Error"].contains(messageType) else { rejected += 1; continue }
            if status != "Actual" || ["Ack", "Error"].contains(messageType) { continue }
            if messageType == "Cancel" {
                // The active endpoint normally omits cancellations. If included,
                // only exact CAP identifiers with a valid issued time retire an
                // older record; no fuzzy event/headline matching or new request.
                do {
                    let sent = try requiredDate(p["sent"])
                    guard sent <= now.addingTimeInterval(60) else { throw Failure.invalidTime }
                    let id = try text(p["id"] ?? feature["id"], maximum: 500, required: true)
                    for identifier in try references(p["references"]) + [id] {
                        retiredAt[identifier] = max(retiredAt[identifier] ?? .distantPast, sent)
                    }
                } catch { rejected += 1 }
                continue
            }
            do {
                let expires = try requiredDate(p["expires"])
                let ends = try optionalDate(p["ends"]), sent = try optionalDate(p["sent"])
                let effective = try optionalDate(p["effective"]), onset = try optionalDate(p["onset"])
                let end = ends ?? expires
                guard let weatherStart = onset ?? effective ?? sent else { throw Failure.invalidTime }
                let start = max(weatherStart, effective ?? weatherStart)
                guard start < end, sent == nil || sent! <= now.addingTimeInterval(60) else { throw Failure.invalidTime }
                if expires <= now && end > now { rejected += 1 }
                let geometry: Geometry?, coverage: Coverage, basis: CoverageBasis
                if let rawGeometry = feature["geometry"], !(rawGeometry is NSNull) {
                    geometry = try Geometry(raw: rawGeometry, remainingVertices: maximumVertices - vertices)
                    vertices += geometry!.vertexCount
                    if let point = scope.selectedPlace {
                        coverage = geometry!.contains(point) ? .inside : .outside
                    } else { coverage = .unknown }
                    basis = .featureGeometry
                } else {
                    geometry = nil
                    if scope.kind == .point && scope.hasKnownCoverage { coverage = .inside; basis = .pointQuery }
                    else { coverage = .unknown; basis = .unavailable }
                }
                let event = try text(p["event"], maximum: 250, required: true)
                let id = try text(p["id"] ?? feature["id"], maximum: 500, required: true)
                let headline = try text(p["headline"], maximum: 3_000, fallback: event)
                let severity = try text(p["severity"], maximum: 30, fallback: "Unknown")
                let urgency = try text(p["urgency"], maximum: 30, fallback: "Unknown")
                let certainty = try text(p["certainty"], maximum: 30, fallback: "Unknown")
                guard ["Extreme", "Severe", "Moderate", "Minor", "Unknown"].contains(severity),
                      ["Immediate", "Expected", "Future", "Past", "Unknown"].contains(urgency),
                      ["Observed", "Likely", "Possible", "Unlikely", "Unknown"].contains(certainty) else { throw Failure.invalidPayload }
                let lower = event.lowercased()
                let tone: Tone = lower.contains("warning") ? .warning : lower.contains("watch") ? .watch : lower.contains("advisory") ? .advisory
                    : ["Extreme", "Severe"].contains(severity) ? .warning : ["Moderate", "Minor"].contains(severity) ? .advisory : .notice
                let alert = Alert(id: id, event: event, headline: headline,
                    description: try text(p["description"], maximum: 40_000), instruction: try text(p["instruction"], maximum: 20_000),
                    areaDescription: try text(p["areaDesc"], maximum: 10_000), severity: severity, urgency: urgency, certainty: certainty,
                    status: status, messageType: messageType, sent: sent, effective: effective, onset: onset, eventEndsAt: ends,
                    startAt: start, endAt: end, expiresAt: expires,
                    sourceURL: officialURL(p["web"]) ?? officialURL(p["@id"]) ?? officialURL(id),
                    geometry: geometry, coverage: coverage, coverageBasis: basis, tone: tone)
                if messageType == "Update", let sent {
                    for identifier in try references(p["references"]) where identifier != id {
                        retiredAt[identifier] = max(retiredAt[identifier] ?? .distantPast, sent)
                    }
                }
                if end <= now || (scope.kind == .point && coverage == .outside) { continue }
                if let previous = decoded[id], (previous.sent ?? .distantPast) > (sent ?? .distantPast) { continue }
                decoded[id] = alert
            } catch { rejected += 1 }
        }
        let alerts = decoded.values.filter { alert in
            guard let retired = retiredAt[alert.id] else { return true }
            return (alert.sent ?? .distantPast) > retired
        }.sorted {
            if $0.priority != $1.priority { return $0.priority > $1.priority }
            if $0.startAt != $1.startAt { return $0.startAt < $1.startAt }
            return $0.id < $1.id
        }
        let quality: Quality = !scope.hasKnownCoverage ? .unknownCoverage : rejected > 0 ? .incomplete : .verified
        return Snapshot(scope: scope, checkedAt: now, quality: quality, rejectedFeatureCount: rejected, alerts: alerts)
    }

    private static func number(_ raw: Any) -> Double? {
        guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return nil }
        return number.doubleValue
    }
    private static func references(_ raw: Any?) throws -> [String] {
        if raw == nil || raw is NSNull { return [] }
        guard let entries = raw as? [[String: Any]], entries.count <= 100 else { throw Failure.invalidPayload }
        return try entries.map { try text($0["identifier"], maximum: 500, required: true) }
    }
    private static func text(_ raw: Any?, maximum: Int, required: Bool = false, fallback: String = "") throws -> String {
        if raw == nil || raw is NSNull { if required { throw Failure.invalidPayload }; return fallback }
        guard let string = raw as? String, string.count <= maximum else { throw Failure.invalidPayload }
        let value = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !required || !value.isEmpty else { throw Failure.invalidPayload }
        return value.isEmpty ? fallback : value
    }
    private static func officialURL(_ raw: Any?) -> URL? {
        guard let string = raw as? String, string.utf8.count <= 2_000, let url = URL(string: string),
              url.scheme == "https", let host = url.host?.lowercased(), host == "weather.gov" || host.hasSuffix(".weather.gov"),
              url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return nil }
        return url
    }
    private static func optionalDate(_ raw: Any?) throws -> Date? {
        if raw == nil || raw is NSNull { return nil }
        return try requiredDate(raw)
    }
    private static func requiredDate(_ raw: Any?) throws -> Date {
        guard let string = raw as? String, string.utf8.count <= 40,
              string.range(of: #"^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$"#, options: .regularExpression) != nil else { throw Failure.invalidTime }
        let bytes = Array(string.utf8)
        func number(_ start: Int, _ length: Int) -> Int { bytes[start..<(start + length)].reduce(0) { $0 * 10 + Int($1 - 48) } }
        let year = number(0, 4), month = number(5, 2), day = number(8, 2)
        guard (1...12).contains(month), (1...31).contains(day), number(11, 2) < 24, number(14, 2) < 60, number(17, 2) < 60 else { throw Failure.invalidTime }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
              calendar.component(.year, from: date) == year, calendar.component(.month, from: date) == month, calendar.component(.day, from: date) == day else { throw Failure.invalidTime }
        if string.last != "Z" { guard number(bytes.count - 5, 2) < 24, number(bytes.count - 2, 2) < 60 else { throw Failure.invalidTime } }
        let formatter = ISO8601DateFormatter()
        if string.contains(".") { formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds] }
        guard let result = formatter.date(from: string), result.timeIntervalSince1970.isFinite else { throw Failure.invalidTime }
        return result
    }
}
