import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One retention boundary for every native presentation of a forecast. A
/// successful fetch may be saved locally for short outages, but neither a disk
/// receipt nor an already-open screen may make the same old forecast look
/// current forever.
enum NativeForecastRetentionPolicy {
    static let maximumAge: TimeInterval = 48 * 60 * 60

    static func isUsable(_ forecast: NativeWeatherForecast, now: Date) -> Bool {
        now.timeIntervalSince(forecast.generatedAt) <= maximumAge
    }
}

/// Read-only preview weather. This never writes the App Group, user records,
/// widgets, Watch snapshots, or notification registrations.
actor NativeForecastRepository {
    private let directory: URL
    private let session: URLSession
    private let fileManager = FileManager.default
    private static let maximumEntries = 12
    private static let maximumPayloadBytes = 4_000_000
    private static let cacheVersion = 1

    private struct CacheEnvelope: Codable {
        let version: Int
        let latitude: Double
        let longitude: Double
        let metric: Bool
        let payload: Data
    }

    init(cacheDirectory: URL? = nil, session: URLSession = .shared) {
        self.session = session
        directory = cacheDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NearcastNativePreviewWeather", isDirectory: true)
    }

    func cached(latitude: Double, longitude: Double, metric: Bool) async -> NativeWeatherForecast? {
        guard Self.valid(latitude: latitude, longitude: longitude) else { return nil }
        let url = cacheURL(latitude: latitude, longitude: longitude, metric: metric)
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= Self.maximumPayloadBytes * 2,
              let data = try? Data(contentsOf: url),
              let envelope = try? JSONDecoder().decode(CacheEnvelope.self, from: data),
              envelope.version == Self.cacheVersion, envelope.metric == metric,
              abs(envelope.latitude - latitude) <= 0.0011, abs(envelope.longitude - longitude) <= 0.0011,
              let forecast = try? NativeWeatherForecast.decode(data: envelope.payload, latitude: latitude,
                  longitude: longitude, metric: metric, now: Date()),
              NativeForecastRetentionPolicy.isUsable(forecast, now: Date()) else { return nil }
        return forecast
    }

    func fetch(latitude: Double, longitude: Double, metric: Bool, now: Date = Date()) async throws -> NativeWeatherForecast {
        guard Self.valid(latitude: latitude, longitude: longitude) else { throw NativeForecastError.invalidCoordinates }
        var components = URLComponents(string: "https://getnearcast.app/api/forecast")!
        components.queryItems = [
            URLQueryItem(name: "lat", value: Self.coordinate(latitude)),
            URLQueryItem(name: "lon", value: Self.coordinate(longitude)),
            URLQueryItem(name: "unit", value: metric ? "celsius" : "fahrenheit"),
            URLQueryItem(name: "precipitation_unit", value: "mm")
        ]
        guard let url = components.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw NativeForecastError.invalidPayload }
        guard (200..<300).contains(http.statusCode) else { throw NativeForecastError.httpStatus(http.statusCode) }
        guard response.url?.scheme == "https", response.url?.host == "getnearcast.app", response.url?.path == "/api/forecast",
              data.count <= Self.maximumPayloadBytes else { throw NativeForecastError.invalidPayload }
        let forecast = try NativeWeatherForecast.decode(data: data, latitude: latitude, longitude: longitude, metric: metric, now: now)
        guard NativeForecastRetentionPolicy.isUsable(forecast, now: now) else {
            throw NativeForecastError.staleForecast
        }
        try Task.checkCancellation()
        // Cache failures must not discard a valid network forecast. Atomic writes
        // preserve the prior entry if a process is interrupted mid-refresh.
        try? writeCache(data, latitude: latitude, longitude: longitude, metric: metric, generatedAt: forecast.generatedAt)
        return forecast
    }

    private func writeCache(_ payload: Data, latitude: Double, longitude: Double, metric: Bool, generatedAt: Date) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = cacheURL(latitude: latitude, longitude: longitude, metric: metric)
        // Actor calls can interleave while requests await the network. An older
        // response arriving last must not roll a place's offline cache backward.
        if let existingData = try? Data(contentsOf: destination),
           let existing = try? JSONDecoder().decode(CacheEnvelope.self, from: existingData),
           existing.version == Self.cacheVersion, existing.metric == metric,
           let forecast = try? NativeWeatherForecast.decode(data: existing.payload, latitude: latitude,
               longitude: longitude, metric: metric, now: Date()), forecast.generatedAt > generatedAt {
            return
        }
        let envelope = CacheEnvelope(version: Self.cacheVersion, latitude: latitude, longitude: longitude, metric: metric, payload: payload)
        let data = try JSONEncoder().encode(envelope)
        try data.write(to: destination, options: .atomic)
        try? fileManager.setAttributes([.modificationDate: generatedAt], ofItemAtPath: destination.path)
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        let entries = try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))
            .filter { $0.lastPathComponent.hasPrefix("forecast-v1-") && $0.pathExtension == "json" }
            .compactMap { url -> (URL, Date)? in
                guard let values = try? url.resourceValues(forKeys: keys), values.isRegularFile == true else { return nil }
                return (url, values.contentModificationDate ?? .distantPast)
            }.sorted { $0.1 > $1.1 }
        for (index, entry) in entries.enumerated() where index >= Self.maximumEntries || Date().timeIntervalSince(entry.1) > NativeForecastRetentionPolicy.maximumAge {
            try? fileManager.removeItem(at: entry.0)
        }
    }

    private func cacheURL(latitude: Double, longitude: Double, metric: Bool) -> URL {
        let latitudeCell = Int((latitude * 1000).rounded())
        let longitudeCell = Int((longitude * 1000).rounded())
        return directory.appendingPathComponent("forecast-v1-\(latitudeCell)-\(longitudeCell)-\(metric ? "c" : "f").json")
    }

    private static func coordinate(_ value: Double) -> String {
        String(format: "%.5f", locale: Locale(identifier: "en_US_POSIX"), value)
    }

    private static func valid(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180
    }
}
