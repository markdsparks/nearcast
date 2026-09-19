import Foundation

private struct AlertsReply: Sendable {
    let data: Data
    var status = 200
    var declaredLength: Int?
    var hold = false
    var redirect = false
}
private final class AlertsMockStore: @unchecked Sendable {
    private let lock = NSLock()
    private var reply = AlertsReply(data: Data())
    private var count = 0
    private var headers: [String: String] = [:]
    private var replies: [AlertsReply] = []
    private var urls: [URL] = []
    func set(_ value: AlertsReply) { lock.lock(); reply = value; replies = []; urls = []; lock.unlock() }
    func setSequence(_ values: [AlertsReply]) { lock.lock(); replies = values; urls = []; lock.unlock() }
    func start(_ request: URLRequest) -> AlertsReply {
        lock.lock(); defer { lock.unlock() }; count += 1; headers = request.allHTTPHeaderFields ?? [:]
        if let url = request.url { urls.append(url) }
        return replies.isEmpty ? reply : replies.removeFirst()
    }
    func state() -> (Int, [String: String]) { lock.lock(); defer { lock.unlock() }; return (count, headers) }
    func requestedURLs() -> [URL] { lock.lock(); defer { lock.unlock() }; return urls }
}
private final class AlertsMockProtocol: URLProtocol, @unchecked Sendable {
    static let store = AlertsMockStore()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let reply = Self.store.start(request), url = request.url!
        if reply.hold { return }
        if reply.redirect {
            let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": "https://example.invalid/alerts"])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: "https://example.invalid/alerts")!), redirectResponse: response)
            return
        }
        var headers: [String: String] = ["Content-Type": "application/geo+json"]
        if let length = reply.declaredLength { headers["Content-Length"] = String(length) }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        let middle = reply.data.count / 2
        client?.urlProtocol(self, didLoad: reply.data.prefix(middle))
        client?.urlProtocol(self, didLoad: reply.data.suffix(from: middle))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}

@main
enum NativeRadarAlertsTests {
    typealias C = NativeRadarAlertsContract
    static let now = ISO8601DateFormatter().date(from: "2026-09-19T02:00:00Z")!
    static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw NSError(domain: "NativeRadarAlertsTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func rejects(_ message: String, _ action: () throws -> Void) throws {
        do { try action() } catch { return }
        throw NSError(domain: "NativeRadarAlertsTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Accepted invalid \(message)"])
    }
    static func data(_ features: [[String: Any]], extra: [String: Any] = [:]) throws -> Data {
        var document: [String: Any] = ["type": "FeatureCollection", "features": features]
        extra.forEach { document[$0] = $1 }
        return try JSONSerialization.data(withJSONObject: document)
    }
    static func feature(id: String = "urn:nws:alert:one", geometry: Any = NSNull(), changes: [String: Any] = [:]) -> [String: Any] {
        var properties: [String: Any] = ["id": id, "event": "Severe Thunderstorm Warning", "headline": "Official headline",
            "description": "Official bulletin text", "instruction": "Follow local official guidance.", "areaDesc": "Test area",
            "status": "Actual", "messageType": "Alert", "severity": "Severe", "urgency": "Immediate", "certainty": "Observed",
            "sent": "2026-09-19T00:00:00Z", "effective": "2026-09-19T00:00:00Z", "onset": "2026-09-19T01:00:00Z",
            "expires": "2026-09-19T03:00:00Z", "ends": "2026-09-19T04:00:00Z",
            "@id": "https://api.weather.gov/alerts/urn:nws:alert:one"]
        changes.forEach { properties[$0] = $1 }
        return ["type": "Feature", "id": id, "geometry": geometry, "properties": properties]
    }
    static var square: [String: Any] { ["type": "Polygon", "coordinates": [[[-91.0, 37], [-88, 37], [-88, 40], [-91, 40]]]] }
    static var hole: [String: Any] { ["type": "Polygon", "coordinates": [
        [[-91.0, 37], [-88, 37], [-88, 40], [-91, 40], [-91, 37]],
        [[-90.0, 38], [-89, 38], [-89, 39], [-90, 39], [-90, 38]]]] }

    static func main() async throws {
        try contractTests()
        try geometryTests()
        try await transportTests()
        try viewportContractTests()
        try await viewportTransportTests()
        if CommandLine.arguments.contains("--live") {
            let scope = try C.Scope.point(latitude: 38.7237, longitude: -89.9557, countryCode: "US")
            let snapshot = try await NativeRadarAlertsClient().load(scope: scope)
            let collection = try snapshot.featureCollection(at: Date())
            let features = (try JSONSerialization.jsonObject(with: collection) as! [String: Any])["features"] as! [Any]
            print("LIVE NWS selected-point result: quality=\(snapshot.quality.rawValue), bulletins=\(snapshot.alerts.count), polygons=\(features.count), rejected=\(snapshot.rejectedFeatureCount). Not a viewport-wide check.")
        }
        if CommandLine.arguments.contains("--live-viewport") {
            let client = NativeRadarAlertsClient()
            let result = try await client.loadViewport(viewport: C.Viewport(west: -93, south: 36, east: -87, north: 41),
                selectedPlace: C.Point(latitude: 38.7237, longitude: -89.9557))
            print("LIVE NWS polygon feed: \(result.completeness.rawValue), viewport bulletins=\(result.snapshot.alerts.count), unmapped nationwide=\(result.unmappedBulletinCount), rejected=\(result.snapshot.rejectedFeatureCount), pages=\(result.pageCount). Not an all-clear or county-boundary check.")
            let wide = try await client.loadViewport(viewport: C.Viewport(west: -180, south: -90, east: 180, north: 90))
            try check(wide.wasCached, "live wide pan uses same in-memory feed")
            print("LIVE cached world pan: official polygon bulletins=\(wide.snapshot.alerts.count), current renderable polygons=\(try renderedCount(wide.snapshot, at: Date())).")
        }
        print("PASS Native official alerts: CAP intervals/status, null geometry, holes/dateline, point/viewport routes, pagination budgets/cache/cancellation")
    }

    static func contractTests() throws {
        let scope = try C.Scope.point(latitude: 38.5, longitude: -89.5, countryCode: "us")
        try check(scope.url.absoluteString == "https://api.weather.gov/alerts/active?point=38.5000,-89.5000", "same bounded point endpoint")
        let area = try C.Scope.area(code: "il", selectedPlace: scope.selectedPlace)
        try check(area.url.absoluteString == "https://api.weather.gov/alerts/active?area=IL", "explicit known area endpoint")
        try rejects("inferred/global area") { _ = try C.Scope.area(code: "US") }
        try rejects("invalid point") { _ = try C.Scope.point(latitude: .nan, longitude: 0, countryCode: "US") }
        let nullData = try data([feature()])
        let null = try C.decode(nullData, scope: scope, now: now)
        try check(null.quality == .verified && null.alerts.count == 1, "verified null-geometry county bulletin retained")
        let alert = null.alerts[0]
        try check(alert.coverage == .inside && alert.coverageBasis == .pointQuery && alert.geometry == nil, "point query fallback never manufactures polygon")
        try check(alert.startAt == now.addingTimeInterval(-3600) && alert.endAt == now.addingTimeInterval(7200) && alert.expiresAt == now.addingTimeInterval(3600), "onset/ends/expiry remain distinct")
        try check(alert.isActive(at: now) && null.isFresh(at: now) && !null.isVerifiedEmpty(at: now), "actual current bulletin")
        try check(null.alert(idOrKey: "id:urn:nws:alert:one")?.id == alert.id && null.alert(idOrKey: "unknown") == nil, "exact map tap routing")
        try check(try renderedCount(null) == 0, "null geometry not drawn")
        let native = try NativeEssentialsDecoder.alerts(data: nullData, latitude: 38.5, longitude: -89.5, countryCode: "US", now: now)
        try check(native.alerts.first?.startAt == alert.startAt && native.alerts.first?.endAt == alert.endAt && native.alerts.first?.expiresAt == alert.expiresAt, "existing native time policy parity")
        let nullArea = try C.decode(nullData, scope: area, now: now)
        try check(nullArea.alerts[0].coverage == .unknown && nullArea.alerts[0].geometry == nil, "area null geometry never claims selected-point coverage")
        let unknown = try C.decode(data([]), scope: .point(latitude: 38.5, longitude: -89.5, countryCode: nil), now: now)
        try check(unknown.quality == .unknownCoverage && !unknown.isVerifiedEmpty(at: now), "unknown coverage empty not all-clear")
        let unsupported = try C.decode(Data(), scope: .point(latitude: 45, longitude: -75, countryCode: "CA"), now: now)
        try check(unsupported.quality == .unsupported && unsupported.checkedAt == nil, "unsupported does not pretend checked")
        let empty = try C.decode(data([]), scope: scope, now: now)
        try check(empty.isVerifiedEmpty(at: now) && !empty.isVerifiedEmpty(at: now.addingTimeInterval(300)), "confirmed empty expires after five minutes")

        for changes in [["status": "Test"], ["status": "Exercise"], ["messageType": "Cancel"], ["messageType": "Ack"]] {
            try check(try C.decode(data([feature(changes: changes)]), scope: scope, now: now).alerts.isEmpty, "non-live CAP excluded")
        }
        for changes: [String: Any] in [["status": NSNull()], ["status": "bogus"], ["messageType": "bogus"],
            ["expires": "2026-02-30T03:00:00Z"], ["onset": "2026-09-19T25:00:00Z"], ["ends": "2026-09-19T03:00:00"],
            ["sent": "2026-09-19T03:00:00Z"], ["onset": "2026-09-19T05:00:00Z"], ["description": 1]] {
            let decoded = try C.decode(data([feature(changes: changes)]), scope: scope, now: now)
            try check(decoded.quality == .incomplete && decoded.alerts.isEmpty && !decoded.isVerifiedEmpty(at: now), "malformed CAP never all-clear")
        }
        let expired = try C.decode(data([feature(geometry: square, changes: ["expires": "2026-09-19T01:30:00Z"])]), scope: scope, now: now)
        try check(expired.alerts.count == 1 && expired.alerts[0].endAt > now && !expired.isFresh(at: now), "expired product does not invent event end")
        try check(try renderedCount(expired) == 0, "expired product not drawn as current")
        let future = try C.decode(data([feature(geometry: square, changes: ["onset": "2026-09-19T02:30:00Z"])]), scope: scope, now: now)
        try check(future.alerts.count == 1 && !future.alerts[0].isActive(at: now) && !future.isVerifiedEmpty(at: now), "scheduled alert is not active now or all-clear")
        try check(try renderedCount(future) == 0, "future alert not drawn as active now")
        let effective = try C.decode(data([feature(changes: ["effective": "2026-09-19T02:15:00Z", "onset": "2026-09-19T01:00:00Z"])]), scope: scope, now: now)
        try check(effective.alerts[0].startAt == now.addingTimeInterval(900), "later effective time gates earlier onset")
        let noEnds = try C.decode(data([feature(changes: ["ends": NSNull()])]), scope: scope, now: now)
        try check(noEnds.alerts[0].eventEndsAt == nil && noEnds.alerts[0].endAt == noEnds.alerts[0].expiresAt, "explicit expiry fallback only when ends absent")
        let offset = try C.decode(data([feature(changes: ["onset": "2026-09-18T20:00:00-05:00"])]), scope: scope, now: now)
        try check(offset.alerts[0].startAt == alert.startAt, "absolute timezone-qualified CAP time")
        let duplicate = try C.decode(data([feature(changes: ["sent": "2026-09-19T01:00:00Z", "headline": "New"]), feature()]), scope: scope, now: now)
        try check(duplicate.alerts.count == 1 && duplicate.alerts[0].headline == "New", "duplicate exact ID keeps newest sent")
        let cancel = feature(id: "urn:nws:cancel", changes: ["messageType": "Cancel", "sent": "2026-09-19T01:00:00Z", "references": [["identifier": "urn:nws:alert:one"]]])
        try check(try C.decode(data([feature(), cancel]), scope: scope, now: now).alerts.isEmpty, "actual exact CAP cancellation retires older bulletin")
        let update = feature(id: "urn:nws:update", changes: ["messageType": "Update", "sent": "2026-09-19T01:00:00Z", "references": [["identifier": "urn:nws:alert:one"]]])
        let updated = try C.decode(data([feature(), update]), scope: scope, now: now)
        try check(updated.alerts.count == 1 && updated.alerts[0].id == "urn:nws:update", "valid update replaces exact referenced bulletin")
        let unsafeURL = try C.decode(data([feature(changes: ["web": "https://weather.gov.attacker.invalid/a", "@id": "https://user:secret@weather.gov/a"])]), scope: scope, now: now)
        try check(unsafeURL.alerts[0].sourceURL == nil, "unsafe source link omitted without rewriting bulletin")
        let paginated = try C.decode(data([], extra: ["pagination": ["next": "https://example.invalid/all"]]), scope: scope, now: now)
        try check(paginated.quality == .incomplete && !paginated.isVerifiedEmpty(at: now), "pagination cannot produce false complete empty")
        try rejects("huge payload") { _ = try C.decode(Data(repeating: 0, count: C.maximumBytes + 1), scope: scope, now: now) }
        try rejects("too many features") { _ = try C.decode(data(Array(repeating: feature(), count: 501)), scope: scope, now: now) }
    }

    static func geometryTests() throws {
        let inside = try C.Point(latitude: 38.5, longitude: -89.5)
        let geometry = try C.Geometry(raw: square)
        try check(geometry.contains(inside) && geometry.polygons[0][0].first == geometry.polygons[0][0].last, "official ring closed without losing vertices")
        let holed = try C.Geometry(raw: hole)
        try check(!holed.contains(inside) && holed.contains(C.Point(latitude: 38.5, longitude: -90)), "hole interior excluded, boundary conservatively covered")
        try check(!holed.intersects(C.Viewport(west: -89.8, south: 38.2, east: -89.2, north: 38.8)), "viewport fully inside hole excluded")
        try check(holed.intersects(C.Viewport(west: -90.1, south: 38.2, east: -89.9, north: 38.8)), "viewport intersects official hole boundary")
        try check(holed.intersects(C.Viewport(west: -92, south: 36, east: -87, north: 41)), "viewport contains full polygon")
        let dateline: [String: Any] = ["type": "Polygon", "coordinates": [[[179.0, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]]]
        let wrapped = try C.Geometry(raw: dateline)
        try check(wrapped.contains(C.Point(latitude: 11, longitude: 179.5)) && wrapped.contains(C.Point(latitude: 11, longitude: -179.5)), "dateline containment parity")
        try check(!wrapped.contains(C.Point(latitude: 11, longitude: 0)), "dateline does not cover most of world")
        let multi: [String: Any] = ["type": "MultiPolygon", "coordinates": [square["coordinates"]!, dateline["coordinates"]!]]
        try check(try C.Geometry(raw: multi).contains(inside), "multipolygon first component")
        try check(try C.Geometry(raw: multi).contains(C.Point(latitude: 11, longitude: -179.5)), "multipolygon second component")
        for invalid: Any in [["type": "Point", "coordinates": [-89, 38]], ["type": "Polygon", "coordinates": []],
            ["type": "Polygon", "coordinates": [[[0, 0], [1, 1], [2, 2]]]],
            ["type": "Polygon", "coordinates": [[[0, 0], [1, 1], [181, 1]]]],
            ["type": "Polygon", "coordinates": [[[false, 0], [1, 1], [2, 0]]]]] {
            try rejects("geometry") { _ = try C.Geometry(raw: invalid) }
        }
        try rejects("vertex budget") { _ = try C.Geometry(raw: square, remainingVertices: 3) }
        let scope = try C.Scope.point(latitude: 38.5, longitude: -89.5, countryCode: "US")
        let invalidFeature = feature(geometry: ["type": "Point", "coordinates": [-89.5, 38.5]])
        let invalid = try C.decode(data([invalidFeature]), scope: scope, now: now)
        try check(invalid.alerts.isEmpty && invalid.quality == .incomplete, "malformed supplied geometry never uses null/point fallback")
        let insideHole = try C.decode(data([feature(geometry: hole)]), scope: scope, now: now)
        try check(insideHole.alerts.isEmpty, "selected point inside hole not affected")
        let area = try C.Scope.area(code: "IL", selectedPlace: scope.selectedPlace)
        let snapshot = try C.decode(data([feature(geometry: hole)]), scope: area, now: now)
        try check(snapshot.alerts[0].coverage == .outside && snapshot.alerts[0].geometry != nil, "area query retains official nearby polygon without claiming point inside")
        let output = try JSONSerialization.jsonObject(with: snapshot.featureCollection(at: now, selectedID: snapshot.alerts[0].id)) as! [String: Any]
        let rendered = (output["features"] as! [[String: Any]])[0]
        try check(rendered["id"] as? String == snapshot.alerts[0].key, "shape hit-test ID routes to exact bulletin")
        let properties = rendered["properties"] as! [String: Any]
        try check(properties["tone"] as? String == "warning" && properties["selected"] as? Int == 1, "map color/selected properties")
        let coordinates = (rendered["geometry"] as! [String: Any])["coordinates"] as! [[[Double]]]
        try check(coordinates.count == 2 && coordinates[1].count == 5, "GeoJSON preserves holes")
        try check(try renderedCount(snapshot, at: now.addingTimeInterval(301)) == 0, "stale snapshot never called active map geometry")
        let native = try NativeEssentialsDecoder.alerts(data: data([feature(geometry: hole)]), latitude: 38.5, longitude: -89.5, countryCode: "US", now: now)
        try check(native.alerts.isEmpty, "existing native hole policy parity")
    }

    static func renderedCount(_ snapshot: C.Snapshot, at date: Date = now) throws -> Int {
        let object = try JSONSerialization.jsonObject(with: snapshot.featureCollection(at: date)) as! [String: Any]
        return (object["features"] as! [Any]).count
    }

    static func viewportContractTests() throws {
        let box = try C.Viewport(west: -90.5, south: 37.5, east: -89, north: 39)
        let place = try C.Point(latitude: 38.5, longitude: -89.5)
        let scope = try C.Scope.viewport(box, selectedPlace: place)
        try check(scope.url.absoluteString == "https://api.weather.gov/alerts/active", "viewport never becomes a point query")
        let outside: [String: Any] = ["type": "Polygon", "coordinates": [[[-80.0, 30], [-79, 30], [-79, 31], [-80, 31]]]]
        let page = try data([feature(geometry: square), feature(id: "null"), feature(id: "outside", geometry: outside)])
        let result = try C.decodeViewport([page], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(result.snapshot.alerts.count == 1 && result.snapshot.alerts[0].id == "urn:nws:alert:one", "only intersecting official polygon enters viewport list")
        try check(result.snapshot.alerts[0].coverage == .inside && result.snapshot.alerts[0].coverageBasis == .featureGeometry, "selected-place relation remains exact geometry")
        try check(result.completeness == .polygonFeedComplete && result.unmappedBulletinCount == 1, "null bulletins counted honestly without wrong-area assignment")
        let empty = try C.decodeViewport([data([])], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(!empty.snapshot.isVerifiedEmpty(at: now) && empty.snapshot.quality == .unknownCoverage, "empty polygon viewport never becomes no-alerts claim")
        let partial = try C.decodeViewport([page], scope: scope, checkedAt: now, now: now, transportComplete: false)
        try check(partial.completeness == .partial && partial.snapshot.alerts.count == 1, "partial feed retains known polygons")
        let old = try C.decodeViewport([page], scope: scope, checkedAt: now.addingTimeInterval(-301), now: now, transportComplete: true, wasCached: true)
        try check(!old.snapshot.isFresh(at: now) && old.wasCached && renderedCount(old.snapshot) == 0, "cache reprojection cannot freshen checked time")
        let cancel = feature(id: "cancel", changes: ["messageType": "Cancel", "sent": "2026-09-19T01:00:00Z", "references": [["identifier": "urn:nws:alert:one"]]])
        let cancelled = try C.decodeViewport([data([feature(geometry: square)]), data([cancel])], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(cancelled.snapshot.alerts.isEmpty, "later-page CAP cancellation retires first-page polygon")
        let update = feature(geometry: square, changes: ["sent": "2026-09-19T01:00:00Z", "headline": "Updated"])
        let duplicate = try C.decodeViewport([data([feature(geometry: square)]), data([update])], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(duplicate.snapshot.alerts.count == 1 && duplicate.snapshot.alerts[0].headline == "Updated", "newest same ID deduplicated across pages")
        let malformed = try C.decodeViewport([data([feature(geometry: ["type": "Point", "coordinates": [-89, 38]])])], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(malformed.completeness == .partial, "malformed geometry invalidates feed completeness")
        let expiredProduct = feature(id: "expired", geometry: square, changes: ["expires": "2026-09-19T01:30:00Z"])
        let mixedExpiry = try C.decodeViewport([data([expiredProduct, feature(geometry: square)])], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(mixedExpiry.completeness == .partial && mixedExpiry.snapshot.alerts.count == 1 && renderedCount(mixedExpiry.snapshot) == 1, "expired product cannot blank a current valid viewport warning")
        let dateline: [String: Any] = ["type": "Polygon", "coordinates": [[[179.0, 10], [-179, 10], [-179, 12], [179, 12]]]]
        let wrapped = try C.Viewport(west: 178, south: 9, east: -178, north: 13)
        let geometry = try C.Geometry(raw: dateline)
        try check(geometry.intersects(wrapped) && !C.Geometry(raw: square).intersects(wrapped), "wrapped viewport intersects only dateline-local geometry")
        let wrappedResult = try C.decodeViewport([data([feature(geometry: dateline), feature(id: "inland", geometry: square)])], scope: C.Scope.viewport(wrapped), checkedAt: now, now: now, transportComplete: true)
        try check(wrappedResult.snapshot.alerts.count == 1 && renderedCount(wrappedResult.snapshot) == 1, "wrapped viewport collection safe and visible")
        try rejects("invalid viewport west") { _ = try C.Viewport(west: 181, south: 1, east: -179, north: 2) }
        try rejects("zero-width wrapped viewport") { _ = try C.Viewport(west: 180, south: 1, east: -180, north: 2) }
        let allowed = "https://api.weather.gov/alerts?active=true&limit=500&cursor=abc%2Bdef"
        let next = try C.viewportNextPage(data([], extra: ["pagination": ["next": allowed]]))
        try check(next?.host == "api.weather.gov" && URLComponents(url: next!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "cursor" })?.value == "abc+def", "only explicit active continuation is rebuilt")
        for unsafe in ["https://evil.invalid/alerts?active=true&cursor=a", "http://api.weather.gov/alerts?active=true&cursor=a",
            "https://api.weather.gov/alerts?cursor=a", "https://api.weather.gov/alerts?active=false&cursor=a",
            "https://api.weather.gov/alerts?active=true&limit=501&cursor=a", "https://api.weather.gov/alerts?active=true&cursor=a&point=1,1",
            "https://api.weather.gov/alerts?active=true&cursor=a&cursor=b", "https://user@api.weather.gov/alerts?active=true&cursor=a",
            "https://api.weather.gov/alerts/active?cursor=a#fragment", "https://api.weather.gov/alerts/active?cursor=%0A"] {
            try rejects("pagination \(unsafe)") { _ = try C.viewportNextPage(data([], extra: ["pagination": ["next": unsafe]])) }
        }
        let oversized = try data(Array(repeating: feature(geometry: square), count: C.maximumViewportFeatures + 1))
        let limited = try C.decodeViewport([oversized], scope: scope, checkedAt: now, now: now, transportComplete: true)
        try check(limited.completeness == .partial && limited.snapshot.alerts.count == 1, "aggregate feature cap is partial, not silently complete")
    }

    static func viewportTransportTests() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AlertsMockProtocol.self]
        let box = try C.Viewport(west: -91, south: 37, east: -88, north: 40)
        let first = try data([feature(geometry: square)], extra: ["pagination": ["next": "https://api.weather.gov/alerts?active=true&cursor=page2"]])
        AlertsMockProtocol.store.setSequence([.init(data: first), .init(data: try data([feature(id: "second", geometry: square), feature(id: "null")]))])
        let client = NativeRadarAlertsClient(configuration: config)
        let loaded = try await client.loadViewport(viewport: box, now: now)
        try check(loaded.completeness == .polygonFeedComplete && loaded.pageCount == 2 && loaded.snapshot.alerts.count == 2, "bounded pagination collects nearby official polygons")
        let before = AlertsMockProtocol.store.state().0
        let cached = try await client.loadViewport(viewport: C.Viewport(west: -80, south: 30, east: -79, north: 31), now: now.addingTimeInterval(299))
        try check(cached.wasCached && cached.snapshot.alerts.isEmpty && AlertsMockProtocol.store.state().0 == before, "camera pans reproject five-minute feed without extra requests")
        AlertsMockProtocol.store.set(.init(data: try data([])))
        let refreshed = try await client.loadViewport(viewport: box, now: now.addingTimeInterval(300))
        try check(!refreshed.wasCached && refreshed.snapshot.checkedAt == now.addingTimeInterval(300) && AlertsMockProtocol.store.state().0 == before + 1, "expired feed requires network and new checked time")
        _ = try await client.loadViewport(viewport: box, now: now.addingTimeInterval(301), forceRefresh: true)
        try check(AlertsMockProtocol.store.state().0 == before + 2, "explicit refresh bypasses memory cache")
        AlertsMockProtocol.store.set(.init(data: try data([feature(geometry: square, changes: ["expires": "2026-09-19T01:30:00Z"])])))
        let rejectedSourceClient = NativeRadarAlertsClient(configuration: config)
        _ = try await rejectedSourceClient.loadViewport(viewport: box, now: now)
        let sourceRetryCount = AlertsMockProtocol.store.state().0
        let reusedPartial = try await rejectedSourceClient.loadViewport(viewport: box, now: now.addingTimeInterval(60))
        try check(reusedPartial.wasCached && reusedPartial.completeness == .partial && AlertsMockProtocol.store.state().0 == sourceRetryCount, "expired source product does not provoke national refetch on every pan")

        AlertsMockProtocol.store.setSequence([.init(data: first), .init(data: Data(), status: 503)])
        let failedPage = try await NativeRadarAlertsClient(configuration: config).loadViewport(viewport: box, now: now)
        try check(failedPage.completeness == .partial && failedPage.snapshot.alerts.count == 1 && failedPage.pageCount == 1, "later-page provider failure leaves honest partial known alerts")
        let unsafe = try data([feature(geometry: square)], extra: ["pagination": ["next": "https://example.invalid/steal"]])
        AlertsMockProtocol.store.set(.init(data: unsafe))
        let rejected = try await NativeRadarAlertsClient(configuration: config).loadViewport(viewport: box, now: now)
        try check(rejected.completeness == .partial && AlertsMockProtocol.store.requestedURLs().count == 1, "unsafe pagination is not followed")
        let repeated = try data([feature(geometry: square)], extra: ["pagination": ["next": "https://api.weather.gov/alerts?active=true&cursor=same"]])
        AlertsMockProtocol.store.set(.init(data: repeated))
        let cycle = try await NativeRadarAlertsClient(configuration: config).loadViewport(viewport: box, now: now)
        try check(cycle.completeness == .partial && cycle.pageCount == 2, "repeated cursor cannot loop")
        let pages = try (1...6).map { index in AlertsReply(data: try data([feature(id: "\(index)", geometry: square)], extra: ["pagination": ["next": "https://api.weather.gov/alerts?active=true&cursor=\(index)"]])) }
        AlertsMockProtocol.store.setSequence(pages)
        let capped = try await NativeRadarAlertsClient(configuration: config).loadViewport(viewport: box, now: now)
        try check(capped.completeness == .partial && capped.pageCount == C.maximumViewportPages && AlertsMockProtocol.store.requestedURLs().count == C.maximumViewportPages, "pagination request cap enforced")
        let featurePages = try (1...4).map { index in AlertsReply(data: try data(Array(repeating: feature(id: "\(index)", geometry: square), count: 700), extra: ["pagination": ["next": "https://api.weather.gov/alerts?active=true&cursor=\(index)"]])) }
        AlertsMockProtocol.store.setSequence(featurePages)
        let featureCap = try await NativeRadarAlertsClient(configuration: config).loadViewport(viewport: box, now: now)
        try check(featureCap.completeness == .partial && featureCap.pageCount == 3 && AlertsMockProtocol.store.requestedURLs().count == 3, "feature count caps request work before fourth page")
        let bytePages = try (1...4).map { index in AlertsReply(data: try data([feature(id: "\(index)", geometry: square)], extra: ["padding": String(repeating: "x", count: 2_900_000), "pagination": ["next": "https://api.weather.gov/alerts?active=true&cursor=\(index)"]])) }
        AlertsMockProtocol.store.setSequence(bytePages)
        let byteCap = try await NativeRadarAlertsClient(configuration: config).loadViewport(viewport: box, now: now)
        try check(byteCap.completeness == .partial && byteCap.pageCount == 2 && AlertsMockProtocol.store.requestedURLs().count == 3, "third response cannot exceed remaining aggregate byte allowance")
        let unsupportedCount = AlertsMockProtocol.store.state().0
        let unsupported = try await client.loadViewport(viewport: box, countryCode: "CA", now: now)
        try check(unsupported.completeness == .unsupported && AlertsMockProtocol.store.state().0 == unsupportedCount, "unsupported country never downloads national feed")
        AlertsMockProtocol.store.setSequence([.init(data: first), .init(data: Data(), hold: true)])
        let cancelClient = NativeRadarAlertsClient(configuration: config)
        let held = Task { try await cancelClient.loadViewport(viewport: box, now: now) }
        for _ in 0..<200 {
            if AlertsMockProtocol.store.requestedURLs().count == 2 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        try check(AlertsMockProtocol.store.requestedURLs().count == 2, "second page request began")
        held.cancel()
        do { _ = try await held.value; throw NSError(domain: "NativeRadarAlertsTests", code: 5) }
        catch { try check(error is CancellationError, "page cancellation propagates rather than publishing partial success") }
        AlertsMockProtocol.store.set(.init(data: try data([])))
        let recovery = try await cancelClient.loadViewport(viewport: box, now: now)
        try check(!recovery.wasCached && recovery.snapshot.alerts.isEmpty, "cancelled feed not cached and single-flight slot released")
    }

    static func transportTests() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AlertsMockProtocol.self]
        config.httpAdditionalHeaders = ["Authorization": "must-not-leak", "Cookie": "must-not-leak"]
        let client = NativeRadarAlertsClient(configuration: config)
        let scope = try C.Scope.point(latitude: 38.5, longitude: -89.5, countryCode: "US")
        AlertsMockProtocol.store.set(.init(data: try data([feature()])))
        let loaded = try await client.load(scope: scope, now: now)
        try check(loaded.alerts.count == 1, "bounded client decodes selected point")
        let headers = AlertsMockProtocol.store.state().1
        try check(headers["Accept"] == "application/geo+json" && headers["User-Agent"] == "Nearcast/1.0 (https://getnearcast.app)", "NWS headers identify existing app")
        try check(headers["Authorization"] == nil && headers["Cookie"] == nil, "public transport cannot inherit credentials")
        func fails(_ expected: C.Failure) async throws {
            do { _ = try await client.load(scope: scope, now: now) }
            catch { try check(error as? C.Failure == expected, "transport expected \(expected), got \(error)"); return }
            throw NSError(domain: "NativeRadarAlertsTests", code: 3)
        }
        AlertsMockProtocol.store.set(.init(data: Data(), status: 503)); try await fails(.httpStatus(503))
        AlertsMockProtocol.store.set(.init(data: Data(), declaredLength: C.maximumBytes + 1)); try await fails(.sizeLimit)
        AlertsMockProtocol.store.set(.init(data: Data(repeating: 0, count: C.maximumBytes + 1))); try await fails(.sizeLimit)
        AlertsMockProtocol.store.set(.init(data: Data(), redirect: true)); try await fails(.redirect)
        let count = AlertsMockProtocol.store.state().0
        let unsupported = try await client.load(scope: .point(latitude: 45, longitude: -75, countryCode: "CA"), now: now)
        try check(unsupported.quality == .unsupported && AlertsMockProtocol.store.state().0 == count, "unsupported country makes no network request")
        AlertsMockProtocol.store.set(.init(data: Data(), hold: true))
        let held = Task { try await client.load(scope: scope, now: now) }
        for _ in 0..<200 {
            if AlertsMockProtocol.store.state().0 > count { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        try check(AlertsMockProtocol.store.state().0 > count, "held request started")
        try await fails(.requestInFlight)
        held.cancel()
        do { _ = try await held.value; throw NSError(domain: "NativeRadarAlertsTests", code: 4) }
        catch { try check(error is CancellationError, "underlying request cancellation propagated") }
        AlertsMockProtocol.store.set(.init(data: try data([])))
        let recovered = try await client.load(scope: scope, now: now)
        try check(recovered.isVerifiedEmpty(at: now), "cancelled client admission recovers")
    }
}
