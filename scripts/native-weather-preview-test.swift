import Foundation
import Combine

private final class PreviewForecastProtocol: URLProtocol, @unchecked Sendable {
    struct Response: Sendable {
        let data: Data
        let status: Int
        let delay: TimeInterval
    }
    private static let stateLock = NSLock()
    nonisolated(unsafe) private static var responses: [String: Response] = [:]
    nonisolated(unsafe) private static var requestCounts: [String: Int] = [:]
    private let completionLock = NSLock()
    private var stopped = false

    static func configure(_ key: String, response: Response) {
        stateLock.lock()
        responses[key] = response
        stateLock.unlock()
    }
    static func count(_ key: String) -> Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return requestCounts[key, default: 0]
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let parts = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
        let key = parts.queryItems!.first { $0.name == "lat" }!.value!
        Self.stateLock.lock()
        let response = Self.responses[key]!
        Self.requestCounts[key, default: 0] += 1
        Self.stateLock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + response.delay) { [self] in
            completionLock.lock()
            defer { completionLock.unlock() }
            guard !stopped else { return }
            let http = HTTPURLResponse(url: request.url!, statusCode: response.status,
                httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {
        completionLock.lock()
        stopped = true
        completionLock.unlock()
    }
}

@main
struct NativeWeatherPreviewTests {
    static let placeA = NativePreviewPlace(id: "test-home", name: "Home", latitude: 38.72, longitude: -89.95, timezone: "America/Chicago")
    static let placeB = NativePreviewPlace(id: "test-other", name: "Other", latitude: 39.72, longitude: -88.95, timezone: "America/Chicago")

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func context(selected: NativePreviewPlace = placeA, saved: [NativePreviewPlace] = [placeB],
                        version: Int = 1, theme: String = "auto", metric: Bool = false, clock24: Bool = true) -> NativePreviewContext {
        NativePreviewContext(version: version, selectedPlace: selected, savedPlaces: saved,
            metric: metric, uses24HourClock: clock24, theme: theme)
    }

    static func rejects(_ value: NativePreviewContext, _ message: String) throws {
        do {
            _ = try NativePreviewContext.decode(JSONEncoder().encode(value))
            preconditionFailure(message)
        } catch {}
    }

    static func payload(place: NativePreviewPlace, now: Date, temperature: Double) throws -> Data {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: place.timezone!)!
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        let current = formatter.string(from: now)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = formatter.timeZone
        let dates = (0..<3).map { calendar.date(byAdding: .day, value: $0, to: calendar.startOfDay(for: now))! }
        formatter.dateFormat = "yyyy-MM-dd"
        let value: [String: Any] = ["timezone": place.timezone!,
            "_nearcastForecast": ["version": 1, "latitude": place.latitude, "longitude": place.longitude,
                "unit": "fahrenheit", "precipitationUnit": "mm", "generatedAtMs": now.timeIntervalSince1970 * 1000],
            "current": ["time": current, "temperature_2m": temperature, "weather_code": 0, "is_day": 1],
            "current_units": ["temperature_2m": "°F"],
            "daily": ["time": dates.map { formatter.string(from: $0) },
                "temperature_2m_max": [temperature + 5, temperature + 6, temperature + 7], "weather_code": [0, 0, 0]],
            "daily_units": ["temperature_2m_max": "°F"]]
        return try JSONSerialization.data(withJSONObject: value)
    }

    @MainActor
    static func waitUntil(_ message: String, condition: () -> Bool) async throws {
        for _ in 0..<250 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        preconditionFailure("Timed out: \(message)")
    }

    @MainActor
    static func main() async throws {
        let sameCoordinates = NativePreviewPlace(id: "alias", name: "Saved alias", latitude: 38.72, longitude: -89.95, timezone: "America/Chicago")
        let decoded = try NativePreviewContext.decode(JSONEncoder().encode(context(saved: [sameCoordinates, placeB])))
        expect(decoded.places == [placeA, placeB], "Coordinate dedup preserves the selected place and its display name")
        expect(decoded.uses24HourClock, "Explicit 24-hour preference survives native import")
        expect(!context(clock24: false).uses24HourClock, "12-hour preference stays distinct from device locale")
        try rejects(context(version: 2), "Unknown bridge context versions must fail closed")
        try rejects(context(theme: "other"), "Unsupported theme must fail validation")
        try rejects(context(saved: Array(repeating: placeB, count: 61)), "Context import is bounded")
        let invalidPlace = NativePreviewPlace(id: "invalid", name: "Bad place", latitude: 91, longitude: 0, timezone: nil)
        try rejects(context(selected: invalidPlace), "Out-of-range latitude must be rejected")
        let missingName = NativePreviewPlace(id: "invalid", name: " ", latitude: 0, longitude: 0, timezone: nil)
        try rejects(context(saved: [missingName]), "Invalid saved records are not silently imported")
        let invalidZone = NativePreviewPlace(id: "invalid", name: "Bad zone", latitude: 0, longitude: 0, timezone: "Wrong/Zone")
        try rejects(context(selected: invalidZone), "Invalid timezone cannot fall back to the phone clock")
        expect(!NativePreviewPlace(id: "nan", name: "NaN", latitude: .nan, longitude: 0, timezone: nil).isValid, "Nonfinite coordinates rejected")
        let overflow = Data(repeating: 32, count: 64 * 1024 + 1)
        do { _ = try NativePreviewContext.decode(overflow); preconditionFailure("Oversized context must fail") } catch {}

        let remoteDate = ISO8601DateFormatter().date(from: "2026-09-18T23:30:00Z")!
        let remotePlace = NativePreviewPlace(id: "remote", name: "Remote", latitude: 52.23, longitude: 21.01, timezone: "Europe/Warsaw")
        let handoff = NativePreviewHandoff(destination: .details, place: remotePlace, date: remoteDate, timezone: remotePlace.timezone)
        expect(handoff.targetDate == "2026-09-19", "Handoff preserves the selected destination's civil date, not the phone's")
        let handoffJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(handoff)) as! [String: Any]
        let handoffPlace = handoffJSON["place"] as! [String: Any]
        expect(handoffJSON["destination"] as? String == "details" && handoffJSON["version"] as? Int == 1,
            "Handoff uses a versioned exact destination")
        expect(handoffPlace["id"] as? String == "remote" && handoffPlace["latitude"] as? Double == 52.23,
            "Handoff cannot substitute the previously authoritative location")
        expect(NativePreviewHandoff(destination: .map, place: placeA, date: nil, timezone: placeA.timezone).targetDate == nil,
            "No date is fabricated for a date-free handoff")

        let lateNight = ISO8601DateFormatter().date(from: "2026-09-19T04:50:00Z")! // Sep 18, 23:50 Chicago
        let nightStart = ISO8601DateFormatter().date(from: "2026-09-19T04:00:00Z")!
        let actualHours = (0..<30).map { NativeForecastPoint(date: nightStart.addingTimeInterval(Double($0) * 3600), temperature: 60) }
        let actualQuarters = (0..<6).map { NativeForecastPoint(date: nightStart.addingTimeInterval(2700 + Double($0) * 900), temperature: 60) }
        let nightForecast = NativeWeatherForecast(generatedAt: lateNight, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: actualHours, quarterHours: actualQuarters, days: [])
        expect(nightForecast.previewTrendHours(on: lateNight, now: lateNight).count == 24,
            "Tonight's trend continues across midnight instead of collapsing to one hour")
        expect(nightForecast.previewQuarterHours(on: lateNight, now: lateNight).count == 6,
            "Actual quarter-hour coverage continues across midnight")
        let midnight = actualQuarters[1].date
        expect(nightForecast.startsPreviewDaySection(midnight, after: nil, selectedDay: lateNight),
            "If the first available interval is tomorrow, it gets a date heading")
        expect(nightForecast.startsPreviewDaySection(midnight, after: actualQuarters[0].date, selectedDay: lateNight),
            "Crossing midnight adds a date heading")
        expect(!nightForecast.startsPreviewDaySection(actualQuarters[2].date, after: midnight, selectedDay: lateNight),
            "Rows within the same new day do not repeat the heading")
        expect(nightForecast.previewTrendHours(on: midnight, now: lateNight).allSatisfy { nightForecast.calendar.isDate($0.date, inSameDayAs: midnight) },
            "A selected-day trend stays bounded to that local day")
        let fallDay = ISO8601DateFormatter().date(from: "2026-11-01T05:00:00Z")!
        let fallHours = (0..<25).map { NativeForecastPoint(date: fallDay.addingTimeInterval(Double($0) * 3600), temperature: 50) }
        let fallForecast = NativeWeatherForecast(generatedAt: lateNight, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: fallHours, quarterHours: [], days: [])
        expect(fallForecast.previewTrendHours(on: fallDay, now: lateNight).count == 25,
            "Selected-day trends preserve all 25 actual hours on fall-back day")

        let suite = "nearcast-native-preview-tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("untouched", forKey: "legacy-user-records")
        NativePreviewContextStore.save(decoded, defaults: defaults)
        expect(NativePreviewContextStore.load(defaults: defaults) == decoded, "Read-only context copy survives relaunch")
        expect(defaults.string(forKey: "legacy-user-records") == "untouched", "Preview storage does not replace existing user records")
        NativePreviewContextStore.save(context(version: 99), defaults: defaults)
        expect(NativePreviewContextStore.load(defaults: defaults) == decoded, "Invalid export cannot overwrite last valid preview context")

        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("nearcast-preview-model-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PreviewForecastProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let repository = NativeForecastRepository(cacheDirectory: cache, session: session)
        let now = Date()
        let dataA = try payload(place: placeA, now: now, temperature: 71)
        let dataB = try payload(place: placeB, now: now, temperature: 84)
        PreviewForecastProtocol.configure("38.72000", response: .init(data: dataA, status: 200, delay: 0))
        PreviewForecastProtocol.configure("39.72000", response: .init(data: dataB, status: 200, delay: 0))
        let model = NativeWeatherPreviewModel(context: decoded, repository: repository)
        await model.refresh()
        expect(model.forecast?.current?.temperature == 71 && !model.isLoading && model.errorMessage == nil,
            "Initial refresh publishes exact selected-place weather")
        let tomorrow = model.forecast!.days[1].date
        model.showDay(tomorrow)
        expect(model.selectedDay == tomorrow && model.destination == .today, "Selected-day route preserves exact date")
        model.showHourly(day: tomorrow)
        expect(model.selectedDay == tomorrow && model.destination == .hourly, "Hourly route preserves exact selected day")
        model.showToday()
        expect(model.selectedDay == nil && model.destination == .today, "Today resets only the date/destination")
        model.showDay(Date.distantFuture)
        expect(model.selectedDay == nil, "Unavailable day cannot become a misleading selected-day forecast")
        model.selectPlace(remotePlace)
        expect(model.selectedPlace == placeA, "Preview cannot select unimported places")

        PreviewForecastProtocol.configure("38.72000", response: .init(data: Data(), status: 503, delay: 0))
        await model.refresh()
        expect(model.forecast?.current?.temperature == 71 && model.errorMessage?.contains("saved forecast") == true,
            "Refresh failure retains weather and discloses saved-data state")
        let cachedModel = NativeWeatherPreviewModel(context: decoded, repository: repository)
        await cachedModel.refresh()
        expect(cachedModel.forecast?.generatedAt == model.forecast?.generatedAt,
            "Fresh preview loads cached weather without renewing its generation time")

        PreviewForecastProtocol.configure("38.72000", response: .init(data: dataA, status: 200, delay: 0.3))
        let oldCount = PreviewForecastProtocol.count("38.72000")
        let initial = Task { await model.refresh() }
        try await waitUntil("old place request started") { PreviewForecastProtocol.count("38.72000") > oldCount }
        model.showHourly(day: tomorrow)
        model.selectPlace(placeB)
        expect(model.forecast == nil && model.selectedDay == nil && model.destination == .today,
            "Place switch immediately removes previous-place data and date context")
        try await waitUntil("new place loaded") { model.forecast?.current?.temperature == 84 && !model.isLoading }
        await initial.value
        expect(model.selectedPlace == placeB && model.forecast?.current?.temperature == 84,
            "Late old-place response cannot publish over the new place")

        PreviewForecastProtocol.configure("39.72000", response: .init(data: try payload(place: placeB, now: now, temperature: 99), status: 200, delay: 0.25))
        let pendingCount = PreviewForecastProtocol.count("39.72000")
        let pending = Task { await model.refresh() }
        try await waitUntil("cancel candidate started") { PreviewForecastProtocol.count("39.72000") > pendingCount }
        model.cancel()
        await pending.value
        expect(model.forecast?.current?.temperature == 84 && !model.isLoading && model.errorMessage == nil,
            "Closing preview suppresses in-flight response publication and is not an error")

        let cancelledCount = PreviewForecastProtocol.count("39.72000")
        let cancelledTask = Task { await model.refresh() }
        try await waitUntil("task cancellation candidate started") { PreviewForecastProtocol.count("39.72000") > cancelledCount }
        cancelledTask.cancel()
        await cancelledTask.value
        expect(model.forecast?.current?.temperature == 84 && !model.isLoading && model.errorMessage == nil,
            "Task cancellation does not replace weather or display a spurious failure")
        print("PASS Native preview: allowlisted context validation, coordinate dedup, preferences, storage isolation, exact date/place handoff, route behavior, cached failure recovery, place races and cancellation")
    }
}
