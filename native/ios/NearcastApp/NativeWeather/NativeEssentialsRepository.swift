import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Independent read-only enrichment using the app's existing public sources.
/// Its bounded memory cache never writes user preferences, App Group records,
/// Watch/widget snapshots, plans, or notification registrations.
actor NativeEssentialsRepository {
    private let session: URLSession
    private var airCache: [String: NativeAirQualityState] = [:]
    private var alertCache: [String: NativeAlertState] = [:]
    private static let maximumEntries = 12

    init(session: URLSession = .shared) { self.session = session }

    func fetch(latitude: Double, longitude: Double, countryCode: String? = nil,
               now: Date = Date(), force: Bool = false) async -> NativeWeatherEssentials {
        guard NativeEssentialsDecoder.valid(latitude: latitude, longitude: longitude) else {
            return NativeWeatherEssentials(latitude: latitude, longitude: longitude,
                airQuality: NativeAirQualityState(status: .unavailable, checkedAt: nil, snapshot: nil, message: "This place has invalid coordinates."),
                alerts: NativeAlertState(status: .unavailable, checkedAt: nil, alerts: [], message: "This place has invalid coordinates."))
        }
        async let air = loadAir(latitude: latitude, longitude: longitude, now: now, force: force)
        async let alerts = loadAlerts(latitude: latitude, longitude: longitude, countryCode: countryCode, now: now, force: force)
        return await NativeWeatherEssentials(latitude: latitude, longitude: longitude, airQuality: air, alerts: alerts)
    }

    private func loadAir(latitude: Double, longitude: Double, now: Date, force: Bool) async -> NativeAirQualityState {
        let key = coordinateKey(latitude, longitude)
        if !force, let cached = airCache[key], cached.isFresh(now: now) { return cached }
        do {
            var url = URLComponents(string: "https://air-quality-api.open-meteo.com/v1/air-quality")!
            // Same CAMS source and current/hourly request as the existing app;
            // pollen isn't requested because it is not part of this checkpoint.
            let fields = "us_aqi,pm2_5,pm10"
            url.queryItems = [URLQueryItem(name: "latitude", value: coordinate(latitude)),
                URLQueryItem(name: "longitude", value: coordinate(longitude)),
                URLQueryItem(name: "current", value: fields), URLQueryItem(name: "hourly", value: fields),
                URLQueryItem(name: "forecast_days", value: "2"), URLQueryItem(name: "timezone", value: "auto")]
            let data = try await request(url.url!, accept: "application/json", maximumBytes: 2_000_000)
            let state = try NativeEssentialsDecoder.airQuality(data: data, latitude: latitude, longitude: longitude, now: now)
            try Task.checkCancellation()
            if (airCache[key]?.checkedAt ?? .distantPast) <= now {
                airCache[key] = state
                trimCaches()
            }
            return state
        } catch {
            let cached = airCache[key]
            let usable = cached?.checkedAt.map { now.timeIntervalSince($0) >= -60 && now.timeIntervalSince($0) <= 24 * 3600 } ?? false
            let snapshot = usable ? cached?.snapshot : nil
            let state = NativeAirQualityState(status: snapshot == nil ? .unavailable : .stale,
                checkedAt: usable ? cached?.checkedAt : nil, snapshot: snapshot,
                message: snapshot == nil ? "Air quality couldn't be loaded. Try again shortly." : "Couldn't update air quality. This is the last saved estimate.")
            // Cancelled/older requests cannot invalidate a newer successful check.
            if !Task.isCancelled, (cached?.checkedAt ?? .distantPast) <= now { airCache[key] = state; trimCaches() }
            return state
        }
    }

    private func loadAlerts(latitude: Double, longitude: Double, countryCode: String?, now: Date, force: Bool) async -> NativeAlertState {
        let country = NativeEssentialsDecoder.normalizedCountry(countryCode)
        if let country, !NativeEssentialsDecoder.nwsCountries.contains(country) {
            return NativeAlertState(status: .unsupported, checkedAt: nil, alerts: [], message: "Official alerts are not available here from our current source.")
        }
        let key = coordinateKey(latitude, longitude) + ":" + (country ?? "unknown")
        if !force, let cached = alertCache[key], cached.isFresh(now: now) { return cached }
        do {
            var url = URLComponents(string: "https://api.weather.gov/alerts/active")!
            url.queryItems = [URLQueryItem(name: "point", value: coordinate(latitude, digits: 4) + "," + coordinate(longitude, digits: 4))]
            let data = try await request(url.url!, accept: "application/geo+json", maximumBytes: 4_000_000)
            let state = try NativeEssentialsDecoder.alerts(data: data, latitude: latitude, longitude: longitude, countryCode: country, now: now)
            try Task.checkCancellation()
            if (alertCache[key]?.checkedAt ?? .distantPast) <= now { alertCache[key] = state; trimCaches() }
            return state
        } catch {
            let cached = alertCache[key]
            let usable = cached?.checkedAt.map { now.timeIntervalSince($0) >= -60 && now.timeIntervalSince($0) <= 24 * 3600 } ?? false
            let alerts = usable ? (cached?.alerts ?? []).filter { $0.endAt > now } : []
            let state = NativeAlertState(status: usable ? .stale : .unavailable,
                checkedAt: usable ? cached?.checkedAt : nil, alerts: alerts,
                message: "Couldn't check official alerts. Check local guidance and try again.")
            // Even a cached empty result is explicitly stale, never all-clear.
            if !Task.isCancelled, (cached?.checkedAt ?? .distantPast) <= now { alertCache[key] = state; trimCaches() }
            return state
        }
    }

    private func request(_ url: URL, accept: String, maximumBytes: Int) async throws -> Data {
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue(accept, forHTTPHeaderField: "Accept")
        request.setValue("Nearcast/1.0 (https://getnearcast.app)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw NativeEssentialsError.invalidPayload }
        guard (200..<300).contains(http.statusCode) else { throw NativeEssentialsError.httpStatus(http.statusCode) }
        guard response.url?.scheme == "https", response.url?.host == url.host, response.url?.path == url.path,
              data.count <= maximumBytes else { throw NativeEssentialsError.invalidPayload }
        return data
    }

    private func coordinate(_ value: Double, digits: Int = 5) -> String {
        String(format: "%.*f", locale: Locale(identifier: "en_US_POSIX"), digits, value)
    }
    private func coordinateKey(_ latitude: Double, _ longitude: Double) -> String { coordinate(latitude) + "," + coordinate(longitude) }
    private func trimCaches() {
        if airCache.count > Self.maximumEntries {
            for key in airCache.keys.sorted(by: { (airCache[$0]?.checkedAt ?? .distantPast) > (airCache[$1]?.checkedAt ?? .distantPast) }).dropFirst(Self.maximumEntries) {
                airCache.removeValue(forKey: key)
            }
        }
        if alertCache.count > Self.maximumEntries {
            for key in alertCache.keys.sorted(by: { (alertCache[$0]?.checkedAt ?? .distantPast) > (alertCache[$1]?.checkedAt ?? .distantPast) }).dropFirst(Self.maximumEntries) {
                alertCache.removeValue(forKey: key)
            }
        }
    }
}
