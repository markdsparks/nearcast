import Foundation
import Combine

private final class EssentialsLifecycleProtocol: URLProtocol, @unchecked Sendable {
    struct Response: Sendable { let data: Data; let status: Int; let delay: TimeInterval }
    private static let stateLock = NSLock()
    nonisolated(unsafe) private static var responses: [String: Response] = [:]
    nonisolated(unsafe) private static var counts: [String: Int] = [:]
    private let completionLock = NSLock()
    private var stopped = false

    static func configure(_ key: String, data: Data, status: Int = 200, delay: TimeInterval = 0.01) {
        stateLock.lock(); defer { stateLock.unlock() }
        responses[key] = Response(data: data, status: status, delay: delay)
    }
    static func count(_ key: String) -> Int { stateLock.lock(); defer { stateLock.unlock() }; return counts[key, default: 0] }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        let key: String
        if url.host == "getnearcast.app" { key = "forecast:" + query.first { $0.name == "lat" }!.value! }
        else if url.host == "air-quality-api.open-meteo.com" { key = "air:" + query.first { $0.name == "latitude" }!.value! }
        else { key = "alerts:" + query.first { $0.name == "point" }!.value! }
        Self.stateLock.lock()
        let response = Self.responses[key]!
        Self.counts[key, default: 0] += 1
        Self.stateLock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + response.delay) { [self] in
            completionLock.lock(); defer { completionLock.unlock() }
            guard !stopped else { return }
            let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { completionLock.lock(); stopped = true; completionLock.unlock() }
}

@main
struct NativeEssentialsModelTests {
    static let placeA = NativePreviewPlace(id: "home-test", name: "Home test", latitude: 38.72, longitude: -89.95, timezone: "America/Chicago", countryCode: "US")
    static let placeB = NativePreviewPlace(id: "other-test", name: "Other test", latitude: 39.72, longitude: -88.95, timezone: "America/Chicago", countryCode: "US")
    static func expect(_ condition: Bool, _ message: String) { precondition(condition, message) }
    static func data(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object) }
    static func forecast(_ place: NativePreviewPlace, now: Date, temperature: Double) throws -> Data {
        try data(["timezone": place.timezone!, "_nearcastForecast": ["version": 1, "latitude": place.latitude,
            "longitude": place.longitude, "unit": "fahrenheit", "precipitationUnit": "mm", "generatedAtMs": now.timeIntervalSince1970 * 1000],
            "current": ["time": ISO8601DateFormatter().string(from: now), "temperature_2m": temperature], "current_units": ["temperature_2m": "°F"]])
    }
    static func air(_ place: NativePreviewPlace, now: Date, value: Double) throws -> Data {
        try data(["latitude": place.latitude, "longitude": place.longitude, "timezone": place.timezone!,
            "current": ["time": ISO8601DateFormatter().string(from: now), "us_aqi": value], "current_units": ["us_aqi": "USAQI"]])
    }
    @MainActor static func waitUntil(_ message: String, condition: () -> Bool) async throws {
        for _ in 0..<250 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        preconditionFailure("Timed out: \(message)")
    }

    @MainActor static func main() async throws {
        let now = Date()
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("native-essentials-model-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: cache) }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [EssentialsLifecycleProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let emptyAlerts = try data(["type": "FeatureCollection", "features": []])
        EssentialsLifecycleProtocol.configure("forecast:38.72000", data: try forecast(placeA, now: now, temperature: 74))
        EssentialsLifecycleProtocol.configure("forecast:39.72000", data: try forecast(placeB, now: now, temperature: 63))
        EssentialsLifecycleProtocol.configure("air:38.72000", data: try air(placeA, now: now, value: 120), delay: 0.4)
        EssentialsLifecycleProtocol.configure("alerts:38.7200,-89.9500", data: emptyAlerts, delay: 0.4)
        EssentialsLifecycleProtocol.configure("air:39.72000", data: try air(placeB, now: now, value: 28))
        EssentialsLifecycleProtocol.configure("alerts:39.7200,-88.9500", data: Data(), status: 503)

        let context = NativePreviewContext(version: 1, selectedPlace: placeA, savedPlaces: [placeB], metric: false, uses24HourClock: true, theme: "auto")
        let model = NativeWeatherPreviewModel(context: context,
            repository: NativeForecastRepository(cacheDirectory: cache, session: session),
            essentialsRepository: NativeEssentialsRepository(session: session))
        await model.refresh()
        expect(model.forecast?.current?.temperature == 74 && !model.isLoading, "Main forecast becomes usable independently of supplemental sources")
        expect(model.isLoadingEssentials && model.essentials == nil, "Delayed AQI and alerts are still loading after main forecast finishes")
        try await waitUntil("Initial essentials") { !model.isLoadingEssentials }
        expect(model.essentials?.airQuality.snapshot?.usAQI == 120 && model.essentials?.alerts.status == .ready, "Essentials load for the selected place")

        // Start a slow forced recheck, then change places while it is in flight.
        let airACount = EssentialsLifecycleProtocol.count("air:38.72000")
        model.refreshEssentials(force: true)
        try await waitUntil("A request started") { EssentialsLifecycleProtocol.count("air:38.72000") > airACount }
        model.selectPlace(placeB)
        expect(model.essentials == nil && model.forecast == nil, "Place change clears old readings immediately")
        try await waitUntil("B loaded") { model.forecast != nil && model.essentials != nil && !model.isLoadingEssentials }
        expect(model.selectedPlace == placeB && model.forecast?.current?.temperature == 63, "New place forecast wins")
        expect(model.essentials?.latitude == placeB.latitude && model.essentials?.airQuality.snapshot?.usAQI == 28, "New place essentials win")
        expect(model.essentials?.alerts.status == .unavailable && model.errorMessage == nil, "Failed alerts do not fail the main forecast or air quality")
        try await Task.sleep(for: .milliseconds(450))
        expect(model.selectedPlace == placeB && model.essentials?.latitude == placeB.latitude && model.essentials?.airQuality.snapshot?.usAQI == 28,
            "Cancelled/late previous-place essentials cannot leak into the new place")

        // Closing a preview cancels supplemental work and cannot republish it.
        EssentialsLifecycleProtocol.configure("air:39.72000", data: try air(placeB, now: now, value: 155), delay: 0.35)
        EssentialsLifecycleProtocol.configure("alerts:39.7200,-88.9500", data: emptyAlerts, delay: 0.35)
        let airBCount = EssentialsLifecycleProtocol.count("air:39.72000")
        model.refreshEssentials(force: true)
        try await waitUntil("B recheck started") { EssentialsLifecycleProtocol.count("air:39.72000") > airBCount }
        model.cancel()
        expect(!model.isLoadingEssentials && !model.isLoading, "Closing clears both loading indicators")
        try await Task.sleep(for: .milliseconds(400))
        expect(model.essentials?.airQuality.snapshot?.usAQI == 28 && model.forecast?.current?.temperature == 63,
            "Cancelled response cannot publish after the preview closes")

        // Opposite partial failure: alerts succeed while AQI retains labeled
        // stale data; no retry can erase the main forecast.
        EssentialsLifecycleProtocol.configure("air:39.72000", data: Data(), status: 503)
        EssentialsLifecycleProtocol.configure("alerts:39.7200,-88.9500", data: emptyAlerts)
        model.refreshEssentials(force: true)
        try await waitUntil("Partial recovery") { !model.isLoadingEssentials }
        expect(model.essentials?.airQuality.status == .stale && model.essentials?.airQuality.current(at: Date()) == nil,
            "AQI failure cannot promote an old poor-air estimate")
        expect(model.essentials?.alerts.status == .ready && model.essentials?.alerts.isFresh(now: Date()) == true,
            "Official alerts can recover independently of AQI")
        expect(model.forecast?.current?.temperature == 63 && model.errorMessage == nil, "Supplemental failures leave usable forecast intact")
        let checkCount = EssentialsLifecycleProtocol.count("air:39.72000")
        model.refreshEssentialsIfNeeded(now: Date())
        try await Task.sleep(for: .milliseconds(30))
        expect(EssentialsLifecycleProtocol.count("air:39.72000") == checkCount, "Periodic refresh is throttled after a recent attempt")
        model.cancel()
        print("PASS Native essentials model: nonblocking forecast, place changes/late replies, cancellation, independent failures, truthful stale AQI and throttled refresh")
    }
}
