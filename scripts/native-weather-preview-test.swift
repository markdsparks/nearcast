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

    static func payload(place: NativePreviewPlace, now: Date, temperature: Double, metric: Bool = false) throws -> Data {
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
                "unit": metric ? "celsius" : "fahrenheit", "precipitationUnit": "mm", "generatedAtMs": now.timeIntervalSince1970 * 1000],
            "current": ["time": current, "temperature_2m": temperature, "weather_code": 0, "is_day": 1],
            "current_units": ["temperature_2m": metric ? "°C" : "°F"],
            "daily": ["time": dates.map { formatter.string(from: $0) },
                "temperature_2m_max": [temperature + 5, temperature + 6, temperature + 7], "weather_code": [0, 0, 0]],
            "daily_units": ["temperature_2m_max": metric ? "°C" : "°F"]]
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
    static func verifyRoutePublicationIsolation(session: URLSession) async throws {
        let cache = FileManager.default.temporaryDirectory
            .appendingPathComponent("nearcast-preview-route-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let repository = NativeForecastRepository(cacheDirectory: cache, session: session)
        // All successive provider timestamps remain in the past: future
        // current readings are correctly rejected by the forecast decoder.
        let now = Date().addingTimeInterval(-10)
        PreviewForecastProtocol.configure("38.72000", response: .init(
            data: try payload(place: placeA, now: now, temperature: 71), status: 200, delay: 0))
        PreviewForecastProtocol.configure("39.72000", response: .init(
            data: try payload(place: placeB, now: now.addingTimeInterval(-60), temperature: 80), status: 200, delay: 0))
        _ = try await repository.fetch(latitude: placeB.latitude, longitude: placeB.longitude, metric: false, now: now)
        let model = NativeWeatherPreviewModel(context: context(), repository: repository, essentialsRepository: nil)
        defer { model.cancel() }
        let router = NativeAppRouter()
        var application = NativeAppRouteApplication()
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .start,
            "Startup consumes its route before awaiting the forecast")
        model.showToday()
        application.finish()
        model.showHourly()
        await model.refresh()
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore &&
            model.destination == .hourly,
            "Finishing startup weather preserves Hourly opened during initial loading")

        PreviewForecastProtocol.configure("39.72000", response: .init(
            data: try payload(place: placeB, now: now, temperature: 84), status: 200, delay: 0.2))
        model.selectPlace(placeB)
        expect(model.forecast == nil && model.selectedPlace == placeB && model.context.selectedPlace == placeA,
            "A temporary selection immediately chooses B while its saved context still names A")
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore,
            "Clearing A's forecast must not replay the saved A route")
        try await waitUntil("B cached weather visible before network completion") {
            model.forecast?.current?.temperature == 80 && model.isLoading
        }
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore &&
            model.selectedPlace == placeB,
            "Publishing B's cached forecast keeps the temporary B selection")
        try await waitUntil("B fresh weather visible") {
            model.forecast?.current?.temperature == 84 && !model.isLoading
        }
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore &&
            model.selectedPlace == placeB,
            "Publishing B's fresh forecast keeps the temporary B selection")

        let tomorrow = model.forecast!.days[1].date
        let focusedHour = tomorrow.addingTimeInterval(9 * 60 * 60)
        model.showHourly(day: tomorrow, focusedHour: focusedHour)
        PreviewForecastProtocol.configure("39.72000", response: .init(
            data: try payload(place: placeB, now: now.addingTimeInterval(1), temperature: 86), status: 200, delay: 0))
        await model.refresh()
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore &&
            model.forecast?.current?.temperature == 86 &&
            model.destination == .hourly && model.selectedDay == tomorrow && model.hourlyFocus == focusedHour,
            "A fresh weather update preserves the user's Hourly day and focused hour")

        model.selectPlace(placeA)
        try await waitUntil("A weather restored before a B deep link") {
            model.forecast?.current?.temperature == 71 && !model.isLoading
        }
        router.select(.hourly(place: NativeAppPlaceReference(placeB), day: tomorrow, focusedHour: focusedHour))
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .start,
            "A new B hourly link is consumed while A is visible")
        PreviewForecastProtocol.configure("39.72000", response: .init(
            data: try payload(place: placeB, now: now.addingTimeInterval(2), temperature: 87), status: 200, delay: 0.2))
        model.selectPlace(placeB)
        application.waitForForecast(at: placeB)
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .resume &&
            model.forecast == nil,
            "A deferred hourly request remains attached to B while its weather is loading")
        try await waitUntil("B cache arrives for the deferred day") { model.forecast != nil }
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .resume,
            "The destination forecast resumes the waiting hourly request")
        model.showHourly(day: router.current.selectedDay, focusedHour: router.current.hourlyFocus)
        application.finish()
        try await waitUntil("B fresh weather follows deferred route") {
            model.forecast?.current?.temperature == 87 && !model.isLoading
        }
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore &&
            model.destination == .hourly && model.selectedDay == tomorrow && model.hourlyFocus == focusedHour,
            "A deferred B route applies once and its fresh response preserves the requested hour")

        router.select(.hourly(place: NativeAppPlaceReference(placeA), day: tomorrow, focusedHour: focusedHour))
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .start,
            "A later A link starts a new forecast wait")
        model.selectPlace(placeA)
        application.waitForForecast(at: placeA)
        model.selectPlace(placeB)
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore,
            "Choosing B while A is loading cancels A's deferred navigation")
        try await waitUntil("B wins over canceled A navigation") { model.forecast != nil && !model.isLoading }
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .ignore &&
            model.selectedPlace == placeB && model.destination == .today,
            "The canceled A request cannot restore either A or its Hourly destination")
        router.select(router.current, reapply: true)
        expect(application.begin(revision: router.revision, selectedPlace: model.selectedPlace) == .start,
            "Opening the same external link again starts a fresh request after cancellation")
    }

    @MainActor
    static func main() async throws {
        let sameCoordinates = NativePreviewPlace(id: "alias", name: "Saved alias", latitude: 38.72, longitude: -89.95, timezone: "America/Chicago")
        let decoded = try NativePreviewContext.decode(JSONEncoder().encode(context(saved: [sameCoordinates, placeB])))
        expect(decoded.places == [placeA, placeB], "Coordinate dedup preserves the selected place and its display name")
        expect(decoded.uses24HourClock, "Explicit 24-hour preference survives native import")
        expect(!context(clock24: false).uses24HourClock, "12-hour preference stays distinct from device locale")
        expect(decoded.selectedPlace.countryCode == nil, "Old v1 contexts without country remain compatible")
        let qualifiedPlace = NativePreviewPlace(id: "country", name: "Test", latitude: 38.72, longitude: -89.95,
            timezone: "America/Chicago", countryCode: "US")
        let countryContext = try NativePreviewContext.decode(JSONEncoder().encode(context(selected: qualifiedPlace)))
        expect(countryContext.selectedPlace.countryCode == "US", "Declared country survives allowlisted import for alert coverage")
        try rejects(context(selected: NativePreviewPlace(id: "bad-country", name: "Test", latitude: 38, longitude: -90,
            timezone: nil, countryCode: "USA")), "Malformed country code must not establish alert coverage")
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
        let planHandoff = NativePreviewHandoff(destination: .plans, place: remotePlace, date: remoteDate,
            timezone: remotePlace.timezone, planID: "soccer-plan")
        let planHandoffJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(planHandoff)) as! [String: Any]
        expect(planHandoffJSON["planId"] as? String == "soccer-plan",
            "A native Agenda handoff preserves the exact legacy plan identity")
        expect(NativePreviewHandoff(destination: .plans, place: remotePlace, date: nil,
            timezone: remotePlace.timezone, planID: " \n ").planID == nil,
            "An empty plan identity cannot become an ambiguous compatibility handoff")
        let compatibilityLaunch = NativeCompatibilityLaunch.handoff(handoff)
        switch compatibilityLaunch {
        case .handoff(let preserved):
            expect(preserved.destination == .details && preserved.place == remotePlace && preserved.targetDate == "2026-09-19",
                "A user-approved compatibility escape preserves its exact native place and civil day")
        default:
            preconditionFailure("Compatibility handoff unexpectedly lost its typed destination")
        }

        let lateNight = ISO8601DateFormatter().date(from: "2026-09-19T04:50:00Z")! // Sep 18, 23:50 Chicago
        let nightStart = ISO8601DateFormatter().date(from: "2026-09-19T04:00:00Z")!
        let actualHours = (0..<30).map { NativeForecastPoint(date: nightStart.addingTimeInterval(Double($0) * 3600), temperature: 60) }
        let actualQuarters = (0..<6).map { NativeForecastPoint(date: nightStart.addingTimeInterval(2700 + Double($0) * 900), temperature: 60) }
        let nightForecast = NativeWeatherForecast(generatedAt: lateNight, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: actualHours, quarterHours: actualQuarters, days: [])
        expect(nightForecast.previewTrendHours(on: lateNight, now: lateNight).count == 24,
            "Tonight's trend continues across midnight instead of collapsing to one hour")
        expect(nightForecast.outlookTrendHours(on: lateNight, now: lateNight).count == 24,
            "Outlook does not fabricate earlier hours when the provider supplied none")
        let lookbackHours = (-2..<30).map { NativeForecastPoint(date: nightStart.addingTimeInterval(Double($0) * 3600), temperature: 60) }
        let lookbackForecast = NativeWeatherForecast(generatedAt: lateNight, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: lookbackHours, quarterHours: [], days: [])
        let outlookLookback = lookbackForecast.outlookTrendHours(on: lateNight, now: lateNight)
        expect(outlookLookback.count == 26 && outlookLookback.prefix(2).allSatisfy { $0.date < nightStart },
            "Home outlook keeps at most two real earlier forecast hours for context")
        expect(outlookLookback.dropFirst(2).first?.date == nightStart,
            "The current hour remains the boundary between earlier guidance and the live outlook")
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

        expect(nightForecast.rollingHours(now: lateNight).count == 24 &&
            nightForecast.rollingHours(now: lateNight).first?.date == nightStart,
            "The main hourly route includes the current hour and continues for 24 actual hours across midnight")
        expect(nightForecast.hasMoreRollingHours(now: lateNight, hours: 24) &&
            !nightForecast.hasMoreRollingHours(now: lateNight, hours: 48),
            "Continuation is offered only while actual forecast coverage remains")
        expect(nightForecast.rollingHours(now: lateNight, hours: 48).count == 30,
            "Continuing the list stops at real provider coverage rather than inventing missing hours")
        expect(lookbackForecast.rollingHours(now: lateNight).count == 24 &&
            lookbackForecast.rollingHours(now: lateNight, includeEarlierToday: true).count == 26,
            "Earlier guidance is an explicit opt-in and does not shorten the forward window")
        let gappedForecast = NativeWeatherForecast(generatedAt: lateNight, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: actualHours.enumerated().filter { $0.offset != 4 }.map(\.element),
            quarterHours: [], days: [])
        expect(gappedForecast.rollingHours(now: lateNight).count == 23 &&
            gappedForecast.rollingHours(now: lateNight).last?.date == actualHours[23].date,
            "Missing data stays missing: 24 hours means elapsed time, not 24 available samples")
        expect(nightForecast.hourlyQuarterHours(on: nil, now: lateNight).count == 6 &&
            nightForecast.hourlyQuarterHours(on: lateNight, now: lateNight).count == 1 &&
            nightForecast.hourlyQuarterHours(on: midnight, now: lateNight).count == 5,
            "Rolling real quarter-hours cross midnight while a chosen day is civil-day bounded")
        expect(nightForecast.hourlyQuarterHours(on: nil, now: lateNight.addingTimeInterval(6 * 3_600)).isEmpty,
            "Aged-out quarter-hours cannot advertise availability")
        expect(fallForecast.rollingHours(now: fallDay).count == 24 &&
            fallForecast.calendar.component(.hour, from: fallForecast.rollingHours(now: fallDay)[1].date) == 1 &&
            fallForecast.calendar.component(.hour, from: fallForecast.rollingHours(now: fallDay)[2].date) == 1 &&
            fallForecast.rollingHours(now: fallDay)[1].date != fallForecast.rollingHours(now: fallDay)[2].date,
            "The two fall-back 1 AM hours remain distinct in a 24-hour elapsed-time window")
        expect(fallForecast.isRepeatedLocalHour(fallHours[1].date) && fallForecast.isRepeatedLocalHour(fallHours[2].date)
            && !fallForecast.isRepeatedLocalHour(fallHours[3].date),
            "Both repeated local hours ask the UI for a zone label, while ordinary hours stay compact")
        let springStart = ISO8601DateFormatter().date(from: "2026-03-08T06:00:00Z")!
        let springHours = (0..<30).map { NativeForecastPoint(date: springStart.addingTimeInterval(Double($0) * 3_600), temperature: 50) }
        let springForecast = NativeWeatherForecast(generatedAt: springStart, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: springHours, quarterHours: [], days: [])
        expect(springForecast.rollingHours(now: springStart).count == 24 &&
            springForecast.calendar.component(.hour, from: springForecast.rollingHours(now: springStart)[2].date) == 3 &&
            springForecast.hours(on: springStart).count == 23,
            "Spring-forward rolling hours preserve real timestamps and can continue past the shorter civil day")
        expect(nightForecast.rollingHourlyWindow(now: lateNight, hours: 10_000).duration == 14 * 24 * 3_600 &&
            !nightForecast.hasMoreRollingHours(now: lateNight, hours: 14 * 24),
            "Rolling continuation has a finite fourteen-day safety boundary")

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
        let model = NativeWeatherPreviewModel(context: decoded, repository: repository, essentialsRepository: nil)
        await model.refresh()
        expect(model.forecast?.current?.temperature == 71 && !model.isLoading && model.errorMessage == nil,
            "Initial refresh publishes exact selected-place weather")
        let tomorrow = model.forecast!.days[1].date
        model.showDay(tomorrow)
        expect(model.selectedDay == tomorrow && model.destination == .today, "Selected-day route preserves exact date")
        model.showHourly(day: tomorrow)
        expect(model.selectedDay == tomorrow && model.destination == .hourly && model.hourlyFocus == nil,
            "Selecting a daily outlook day opens its hourly forecast without inventing an hour focus")
        expect(model.hourlyScope == .day, "A daily row or dated Ask route explicitly selects a calendar day")
        model.showHourly(focusedHour: tomorrow)
        expect(model.hourlyScope == .next24Hours && model.selectedDay == nil && model.hourlyFocus == tomorrow,
            "A Tomorrow column in Today's outlook focuses tomorrow without switching out of the rolling window")
        model.showHourly()
        expect(model.hourlyScope == .next24Hours && model.hourlyFocus == nil,
            "The Hourly tab starts a clean rolling window rather than retaining a previously selected day")
        model.showHourly(day: tomorrow, focusedHour: tomorrow)
        expect(model.selectedDay == tomorrow && model.destination == .hourly && model.hourlyFocus == tomorrow,
            "Compact-hour handoff preserves the exact selected-day scroll target")
        let firstFocusedRevision = model.hourlyFocusRevision
        model.showHourly(day: tomorrow, focusedHour: tomorrow)
        expect(model.hourlyFocusRevision == firstFocusedRevision + 1,
            "Repeating an explicit hour target retains the date while preserving the new scroll intent")
        model.showToday()
        expect(model.selectedDay == nil && model.destination == .today && model.hourlyFocus == nil,
            "Today clears both the date route and an old compact-hour target")
        expect(model.hourlyScope == .next24Hours, "Returning Home restores the default next-24-hour intent")
        model.showDay(Date.distantFuture)
        expect(model.selectedDay == nil, "Unavailable day cannot become a misleading selected-day forecast")
        model.selectPlace(remotePlace)
        expect(model.selectedPlace == placeA, "Preview cannot select unimported places")

        PreviewForecastProtocol.configure("38.72000", response: .init(data: Data(), status: 503, delay: 0))
        await model.refresh()
        expect(model.forecast?.current?.temperature == 71 && model.errorMessage?.contains("saved forecast") == true,
            "Refresh failure retains weather and discloses saved-data state")
        let cachedModel = NativeWeatherPreviewModel(context: decoded, repository: repository, essentialsRepository: nil)
        await cachedModel.refresh()
        expect(cachedModel.forecast?.generatedAt == model.forecast?.generatedAt,
            "Fresh preview loads cached weather without renewing its generation time")

        // A cold launch with neither a usable disk receipt nor a network
        // response must finish honestly. In particular, it must not leave the
        // loading state spinning or manufacture a reading from another place.
        let coldCache = FileManager.default.temporaryDirectory
            .appendingPathComponent("nearcast-preview-cold-failure-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: coldCache) }
        let coldRepository = NativeForecastRepository(cacheDirectory: coldCache, session: session)
        let coldModel = NativeWeatherPreviewModel(context: decoded, repository: coldRepository, essentialsRepository: nil)
        await coldModel.refresh()
        expect(coldModel.forecast == nil && !coldModel.isLoading &&
            coldModel.errorMessage?.contains("Couldn't update this place") == true,
            "Cold offline launch finishes with an explicit retryable weather error")

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
        model.showHourly(day: tomorrow)
        model.applyManagedContext(context(selected: placeB, saved: [placeA], theme: "dark", clock24: false))
        expect(model.context.theme == "dark" && !model.context.uses24HourClock &&
            model.selectedDay == tomorrow && model.forecast?.current?.temperature == 84,
            "Verified clock/appearance edits preserve the selected day and displayed forecast")
        PreviewForecastProtocol.configure("39.72000", response: .init(
            data: try payload(place: placeB, now: now, temperature: 24, metric: true), status: 200, delay: 0))
        model.applyManagedContext(context(selected: placeB, saved: [placeA], metric: true, clock24: false))
        expect(model.forecast == nil && model.selectedDay == tomorrow && model.context.metric,
            "A verified units change clears old-unit weather without losing the selected day")
        try await waitUntil("metric weather loaded") { model.forecast?.metric == true && !model.isLoading }
        expect(model.forecast?.current?.temperature == 24, "Unit changes use the matching native forecast, not relabeled numbers")
        PreviewForecastProtocol.configure("38.72000", response: .init(data: dataA, status: 200, delay: 0))
        model.applyManagedContext(context(selected: placeA, saved: []))
        expect(model.selectedPlace == placeA && model.selectedDay == nil && model.destination == .today && model.forecast == nil,
            "A verified saved-place selection resets date and removes previous-place weather")
        try await waitUntil("managed place loaded") { model.forecast?.current?.temperature == 71 && !model.isLoading }
        expect(model.places == [placeA], "Verified saved-place removal updates available preview places")
        guard let retainedForecast = model.forecast else { preconditionFailure("Expected the managed-place forecast") }
        let retentionBoundary = retainedForecast.generatedAt.addingTimeInterval(NativeForecastRetentionPolicy.maximumAge)
        expect(model.hasUsableForecast(now: retentionBoundary),
            "Native Today and Hourly keep a forecast through the shared disk-cache boundary")
        expect(!model.expireForecastIfNeeded(now: retentionBoundary),
            "A boundary-valid forecast is not removed from an active native screen")
        expect(model.expireForecastIfNeeded(now: retentionBoundary.addingTimeInterval(1)),
            "An active native screen removes a forecast immediately after the shared retention boundary")
        expect(model.forecast == nil && model.errorMessage == NativeWeatherPreviewModel.expiredForecastMessage &&
            model.selectedPlace == placeA && !model.context.metric,
            "Expired screen weather becomes an honest local retry state without changing place or units")
        model.cancel()
        try await verifyRoutePublicationIsolation(session: session)
        print("PASS Native preview: context validation, forecast publication isolation, deferred navigation, place races, preferences, storage, warm/cold outage recovery, retention, cancellation and verified Places/Settings updates")
    }
}
