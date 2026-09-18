import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class EssentialsProtocol: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    nonisolated(unsafe) static var air = Data()
    nonisolated(unsafe) static var alerts = Data()
    nonisolated(unsafe) static var airStatus = 200
    nonisolated(unsafe) static var alertStatus = 200
    nonisolated(unsafe) static var delay: TimeInterval = 0
    nonisolated(unsafe) static var requests: [URLRequest] = []

    static func configure(air: Data, alerts: Data, airStatus: Int = 200, alertStatus: Int = 200, delay: TimeInterval = 0) {
        lock.lock(); defer { lock.unlock() }
        self.air = air; self.alerts = alerts; self.airStatus = airStatus; self.alertStatus = alertStatus; self.delay = delay
    }
    static func requestCount() -> Int { lock.lock(); defer { lock.unlock() }; return requests.count }
    static func requestSnapshot() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        Self.requests.append(request)
        let isAir = request.url!.host == "air-quality-api.open-meteo.com"
        let payload = isAir ? Self.air : Self.alerts
        let status = isAir ? Self.airStatus : Self.alertStatus
        let delay = Self.delay
        Self.lock.unlock()
        let work: @Sendable () -> Void = { [self] in
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: payload)
            client?.urlProtocolDidFinishLoading(self)
        }
        if delay > 0 { DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work) } else { work() }
    }
    override func stopLoading() {}
}

@main
struct NativeWeatherEssentialsTests {
    typealias Object = [String: Any]
    static func expect(_ condition: Bool, _ message: String) { precondition(condition, message) }
    static func instant(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    static func data(_ value: Object) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    static let now = instant("2026-09-18T18:17:00Z")
    static func airFixture(value: Any = 118, sample: String = "2026-09-18T13:00") -> Object {
        ["latitude": 38.7, "longitude": -89.9, "timezone": "America/Chicago",
         "current": ["time": sample, "us_aqi": value, "pm2_5": 12.0, "pm10": 21.0],
         "current_units": ["time": "iso8601", "us_aqi": "USAQI", "pm2_5": "μg/m³", "pm10": "μg/m³"]]
    }
    static func air(_ value: Object, at: Date = now, latitude: Double = 38.72, longitude: Double = -89.95) throws -> NativeAirQualityState {
        try NativeEssentialsDecoder.airQuality(data: data(value), latitude: latitude, longitude: longitude, now: at)
    }
    static func feature(id: String = "https://api.weather.gov/alerts/test", start: String = "2026-09-18T17:00:00Z",
                        end: String = "2026-09-19T02:00:00Z", geometry: Any = NSNull()) -> Object {
        ["type": "Feature", "geometry": geometry,
         "properties": ["id": id, "event": "Severe Thunderstorm Warning", "headline": "Official warning",
            "description": "Official description", "instruction": "Official instruction", "areaDesc": "Selected region",
            "severity": "Severe", "urgency": "Immediate", "status": "Actual", "messageType": "Alert",
            "sent": "2026-09-18T16:00:00Z", "effective": "2026-09-18T16:00:00Z", "onset": start, "expires": end]]
    }
    static func collection(_ features: [Object]) -> Object { ["type": "FeatureCollection", "features": features] }
    static func alerts(_ features: [Object], country: String? = "US", latitude: Double = 38.72, longitude: Double = -89.95,
                       at: Date = now) throws -> NativeAlertState {
        try NativeEssentialsDecoder.alerts(data: data(collection(features)), latitude: latitude, longitude: longitude, countryCode: country, now: at)
    }
    static func rejects(_ message: String, _ body: () throws -> Void) {
        do { try body(); preconditionFailure(message) } catch {}
    }

    static func main() async throws {
        let estimate = try air(airFixture())
        expect(estimate.current(at: now)?.usAQI == 118 && estimate.snapshot?.band?.rank == 2, "Actual current AQI and US category retained")
        expect(estimate.snapshot?.sampleAt == instant("2026-09-18T18:00:00Z"), "Place timezone, not device timezone, determines sample time")
        expect(estimate.current(at: now.addingTimeInterval(1801)) == nil, "Thirty-minute check-age limit prevents endless promotion")
        expect(NativeAQIBand.value(100.4)?.rank == 1 && NativeAQIBand.value(100.5)?.rank == 2, "Category matches rounded display")
        let zero = try air(airFixture(value: 0))
        expect(zero.snapshot?.usAQI == 0, "Genuine zero is valid")
        let null = try air(airFixture(value: NSNull()))
        expect(null.snapshot?.usAQI == nil && null.snapshot?.band == nil, "Pollutants without AQI never imply good air")
        let boolean = try air(airFixture(value: true))
        expect(boolean.snapshot?.usAQI == nil, "Boolean AQI is not one")
        expect(try air(airFixture(sample: "2026-09-18T10:00")).snapshot == nil, "Old current snapshot is unavailable")
        expect(try air(airFixture(sample: "2026-09-19T13:00")).snapshot == nil, "Tomorrow's air quality is not current")
        var fallback = airFixture(sample: "2026-09-17T13:00")
        fallback["hourly"] = ["time": ["2026-09-18T13:00", "2026-09-18T14:00"], "us_aqi": [61, 159]]
        fallback["hourly_units"] = ["us_aqi": "USAQI"]
        let recovered = try air(fallback)
        expect(recovered.snapshot?.usAQI == 61 && recovered.snapshot?.pm25 == nil, "Current-hour fallback does not mix old pollutants or use future AQI")
        var broken = airFixture()
        broken["timezone"] = "Fake/Zone"
        rejects("Invalid timezone must fail") { _ = try air(broken) }
        broken = airFixture(); broken["current_units"] = ["us_aqi": "European AQI"]
        rejects("Wrong AQI units must fail") { _ = try air(broken) }
        rejects("Wrong place must fail") { _ = try air(airFixture(), latitude: 52, longitude: 10) }
        let fall = instant("2026-11-01T07:17:00Z")
        let repeated = try air(airFixture(sample: "2026-11-01T01:00"), at: fall)
        expect(repeated.snapshot?.sampleAt == instant("2026-11-01T07:00:00Z"), "AQI repeated local hour uses occurrence that has happened")

        let live = try alerts([feature()])
        expect(live.isFresh(now: now) && live.activeAlerts(at: now).count == 1, "Supported point query covers geometry-null official alert")
        expect(live.alerts[0].instruction == "Official instruction" && live.alerts[0].sourceURL?.host == "api.weather.gov", "Official wording and safe source URL survive")
        expect(!live.isFresh(now: now.addingTimeInterval(301)), "Alert freshness expires after five minutes")
        let empty = try alerts([])
        expect(empty.status == .ready && empty.alerts.isEmpty, "Verified empty response distinguished from failure")
        expect(try alerts([], country: nil).status == .unavailable, "Unknown country cannot claim no alerts")
        expect(try alerts([feature()], country: "DE").status == .unsupported, "Foreign coverage never becomes all-clear")
        expect(try alerts([feature(end: "2026-09-18T18:16:00Z")]).alerts.isEmpty, "Expired alert removed")
        var testFeature = feature(); var props = testFeature["properties"] as! Object
        props["status"] = "Test"; testFeature["properties"] = props
        expect(try alerts([testFeature]).alerts.isEmpty, "Test alerts never appear as live")
        props["status"] = "Actual"; props["messageType"] = "Cancel"; testFeature["properties"] = props
        expect(try alerts([testFeature]).alerts.isEmpty, "Cancellation records never appear as active warnings")
        props["messageType"] = "Alert"; props["expires"] = NSNull(); testFeature["properties"] = props
        expect(try alerts([testFeature]).status == .unavailable, "Malformed time cannot become a verified empty response")
        props["expires"] = "2026-09-19T18:00:00Z/2026-09-20T18:00:00Z"; testFeature["properties"] = props
        expect(try alerts([testFeature]).status == .unavailable, "Date ranges cannot masquerade as bulletin expiry instants")
        props = feature()["properties"] as! Object; props["web"] = "https://evil.example/alert"; testFeature = feature(); testFeature["properties"] = props
        expect(try alerts([testFeature]).alerts[0].sourceURL?.host == "api.weather.gov", "Untrusted source URL is not offered")

        let square: Object = ["type": "Polygon", "coordinates": [[[-91.0, 38], [-89, 38], [-89, 40], [-91, 40]]]]
        expect(try alerts([feature(geometry: square)]).alerts.count == 1, "Open official rings close without dropped vertices")
        expect(try alerts([feature(geometry: square)], longitude: -88).alerts.isEmpty, "Outside polygon is excluded")
        expect(try alerts([feature(geometry: square)], longitude: -91).alerts.count == 1, "Exact official boundary counts as covered")
        let hole: Object = ["type": "Polygon", "coordinates": [[[-91.0, 38], [-89, 38], [-89, 40], [-91, 40]],
            [[-90.5, 38.5], [-89.5, 38.5], [-89.5, 39.5], [-90.5, 39.5]]]]
        expect(try alerts([feature(geometry: hole)]).alerts.isEmpty, "Polygon hole excludes selected point")
        expect(try alerts([feature(geometry: hole)], longitude: -90.5).alerts.count == 1, "Hole boundary conservatively counts as covered")
        let dateline: Object = ["type": "Polygon", "coordinates": [[[179.0, 10], [-179, 10], [-179, 12], [179, 12]]]]
        expect(try alerts([feature(geometry: dateline)], latitude: 11, longitude: 179.5).alerts.count == 1, "Dateline crossing contains correct side")
        expect(try alerts([feature(geometry: dateline)], latitude: 11, longitude: 0).alerts.isEmpty, "Dateline polygon does not cover nearly whole globe")
        let invalidGeometry: Object = ["type": "Polygon", "coordinates": [[[-91.0, 38], [999, 39], [-89, 40]]]]
        expect(try alerts([feature(geometry: invalidGeometry)]).status == .unavailable, "Damaged geometry is unknown, never point-query fallback")
        let multi: Object = ["type": "MultiPolygon", "coordinates": [square["coordinates"]!, dateline["coordinates"]!]]
        expect(try alerts([feature(geometry: multi)], latitude: 11, longitude: -179.5).alerts.count == 1, "MultiPolygon component and dateline work together")

        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now)!
        let future = try alerts([feature(start: "2026-09-19T10:00:00Z", end: "2026-09-20T01:00:00Z")])
        expect(future.activeAlerts(at: now).isEmpty && future.relevantAlerts(on: now, calendar: calendar, now: now).isEmpty, "Future alert is not today's banner")
        expect(future.relevantAlerts(on: tomorrow, calendar: calendar, now: now).count == 1, "Future interval belongs to selected day")
        expect(live.relevantAlerts(on: tomorrow, calendar: calendar, now: now).isEmpty, "Today's alert does not leak into tomorrow")
        var longerEvent = feature(end: "2026-09-19T10:00:00Z")
        props = longerEvent["properties"] as! Object
        props["ends"] = "2026-09-20T01:00:00Z"
        longerEvent["properties"] = props
        let eventSpansTomorrow = try alerts([longerEvent])
        expect(eventSpansTomorrow.alerts[0].endAt == instant("2026-09-20T01:00:00Z")
            && eventSpansTomorrow.alerts[0].expiresAt == instant("2026-09-19T10:00:00Z"),
            "Hazard end is not truncated to the earlier bulletin-refresh time")
        expect(eventSpansTomorrow.relevantAlerts(on: tomorrow, calendar: calendar, now: now).count == 1,
            "Fresh issued bulletin describes tomorrow's full hazard window")
        let afterBulletinExpiry = instant("2026-09-19T10:01:00Z")
        expect(eventSpansTomorrow.relevantAlerts(on: tomorrow, calendar: calendar, now: afterBulletinExpiry).count == 1
            && !eventSpansTomorrow.isFresh(now: afterBulletinExpiry) && eventSpansTomorrow.activeAlerts(at: afterBulletinExpiry).isEmpty,
            "Expired bulletin is retained only as last-known event information, never fresh/current guidance")
        expect(live.alerts[0].eventEndsAt == nil, "Unknown hazard end remains distinct from product expiry")
        var nearExpiry = feature(end: "2026-09-18T18:18:00Z")
        props = nearExpiry["properties"] as! Object
        props["ends"] = "2026-09-18T20:00:00Z"
        nearExpiry["properties"] = props
        let expiresBeforeCacheTTL = try alerts([nearExpiry])
        expect(!expiresBeforeCacheTTL.isFresh(now: instant("2026-09-18T18:18:00Z")),
            "A bulletin is already stale at expiry, even inside five-minute request TTL")
        var futureEffective = feature(end: "2026-09-20T01:00:00Z")
        props = futureEffective["properties"] as! Object
        props["effective"] = "2026-09-19T10:00:00Z"
        futureEffective["properties"] = props
        let notEffectiveYet = try alerts([futureEffective])
        expect(notEffectiveYet.status == .ready && notEffectiveYet.activeAlerts(at: now).isEmpty
            && notEffectiveYet.relevantAlerts(on: tomorrow, calendar: calendar, now: now).count == 1,
            "Published future-effective alerts belong to future day, not current banner")

        // Optional forecast essentials retain source units and missing values.
        var forecastPayload: Object = ["timezone": "America/Chicago", "_nearcastForecast": ["version": 1,
            "generatedAtMs": now.timeIntervalSince1970 * 1000, "latitude": 38.72, "longitude": -89.95,
            "unit": "fahrenheit", "precipitationUnit": "mm"],
            "current": ["time": "2026-09-18T18:17:00Z", "temperature_2m": 74, "relative_humidity_2m": 0,
                "dew_point_2m": 63, "visibility": 0, "wind_direction_10m": 360],
            "current_units": ["temperature_2m": "°F", "relative_humidity_2m": "%", "dew_point_2m": "°F", "visibility": "m", "wind_direction_10m": "°"]]
        let forecast = try NativeWeatherForecast.decode(data: data(forecastPayload), latitude: 38.72, longitude: -89.95, metric: false, now: now)
        expect(forecast.current?.relativeHumidity == 0 && forecast.current?.visibilityMeters == 0 && forecast.current?.dewPoint == 63 && forecast.current?.windDirection == 360,
            "Native details preserve zero, wind direction, source temperature and visibility meters")
        forecastPayload["current"] = ["time": "2026-09-18T18:17:00Z", "temperature_2m": 74, "relative_humidity_2m": 101, "visibility": -1, "wind_direction_10m": 361]
        let missing = try NativeWeatherForecast.decode(data: data(forecastPayload), latitude: 38.72, longitude: -89.95, metric: false, now: now)
        expect(missing.current?.relativeHumidity == nil && missing.current?.visibilityMeters == nil && missing.current?.windDirection == nil, "Out-of-range details stay missing")

        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [EssentialsProtocol.self]
        let session = URLSession(configuration: configuration)
        let repository = NativeEssentialsRepository(session: session)
        EssentialsProtocol.configure(air: try data(airFixture()), alerts: try data(collection([])))
        let initial = await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now)
        expect(initial.airQuality.status == .ready && initial.alerts.status == .ready, "Both independent sources load")
        let count = EssentialsProtocol.requestCount()
        let requests = EssentialsProtocol.requestSnapshot()
        let airRequest = requests.first { $0.url?.host == "air-quality-api.open-meteo.com" }!
        let alertRequest = requests.first { $0.url?.host == "api.weather.gov" }!
        let airQuery = URLComponents(url: airRequest.url!, resolvingAgainstBaseURL: false)!.queryItems!
        expect(airQuery.first { $0.name == "timezone" }?.value == "auto" && airQuery.first { $0.name == "latitude" }?.value == "38.72000",
            "Air-quality request uses exact selected point and selected-place local timezone")
        expect(URLComponents(url: alertRequest.url!, resolvingAgainstBaseURL: false)!.queryItems?.first?.value == "38.7200,-89.9500",
            "Official alert request is point-scoped, never regional defaults")
        _ = await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now.addingTimeInterval(60))
        expect(EssentialsProtocol.requestCount() == count, "Fresh per-place cache avoids repeated requests")
        EssentialsProtocol.configure(air: Data(), alerts: Data(), airStatus: 503, alertStatus: 503)
        let failed = await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now.addingTimeInterval(61), force: true)
        expect(failed.airQuality.status == .stale && failed.airQuality.current(at: now) == nil, "Failed AQI refresh retains labeled last estimate but cannot promote it")
        expect(failed.alerts.status == .stale && !failed.alerts.isFresh(now: now), "Failed alert refresh with cached empty list is not all-clear")
        expect(failed.airQuality.checkedAt == initial.airQuality.checkedAt, "Failure does not reset saved source check time")
        let beforeForeign = EssentialsProtocol.requestCount()
        let other = await repository.fetch(latitude: 52, longitude: 10, countryCode: "DE", now: now)
        expect(other.airQuality.snapshot == nil && other.alerts.status == .unsupported, "A different place cannot inherit cached weather/alerts")
        expect(EssentialsProtocol.requestCount() == beforeForeign + 1, "Known foreign places do not request unsupported NWS alerts")
        EssentialsProtocol.configure(air: try data(airFixture(value: 61)), alerts: Data(), alertStatus: 503)
        let partial = await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now.addingTimeInterval(62), force: true)
        expect(partial.airQuality.status == .ready && partial.alerts.status == .stale, "Alert failure does not take down air quality")

        EssentialsProtocol.configure(air: try data(airFixture(value: 40)), alerts: try data(collection([])), delay: 0.2)
        let requestCount = EssentialsProtocol.requestCount()
        let older = Task { await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now.addingTimeInterval(63), force: true) }
        for _ in 0..<100 where EssentialsProtocol.requestCount() < requestCount + 2 { try await Task.sleep(for: .milliseconds(5)) }
        EssentialsProtocol.configure(air: try data(airFixture(value: 81)), alerts: try data(collection([])))
        _ = await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now.addingTimeInterval(64), force: true)
        _ = await older.value
        let final = await repository.fetch(latitude: 38.72, longitude: -89.95, countryCode: "US", now: now.addingTimeInterval(65))
        expect(final.airQuality.snapshot?.usAQI == 81, "Older late response cannot roll newer per-place cache backward")
        session.invalidateAndCancel()
        print("PASS Native essentials: AQI missing/stale/current-only/units/timezone; official point geometry/holes/dateline/time/coverage; independent failures, cache freshness and late-response safety")
    }
}
