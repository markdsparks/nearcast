import Foundation

enum NativeGlobalRadarUnavailableReason: Equatable, Sendable {
    case unsafeEndpoint
    case transport
    case responseTooLarge
    case invalidManifest
    case stale
    case noObservedFrames
    case cancelled
}

struct NativeGlobalRadarAttribution: Equatable, Sendable {
    let title: String
    let url: URL
}

/// One exact past observation advertised by RainViewer. The URL is a public,
/// renderer-ready XYZ template; its time is the separately advertised source
/// time, never inferred from the provider's current opaque path token.
struct NativeGlobalRadarFrame: Equatable, Sendable {
    let id: String
    let validTime: Date
    let tileURLTemplate: String
    let tileSize: Int
    let minimumZoom: Int
    let maximumZoom: Int
    let attributions: [NativeGlobalRadarAttribution]

    let sourceProvider = "rainviewer"
    let observationKind = "observed"
}

struct NativeGlobalRadarSnapshot: Equatable, Sendable {
    let generatedAt: Date
    let fetchedAt: Date
    let frames: [NativeGlobalRadarFrame]
}

enum NativeGlobalRadarAvailability: Equatable, Sendable {
    case ready(NativeGlobalRadarSnapshot)
    case unavailable(NativeGlobalRadarUnavailableReason)
}

/// Strict native counterpart to the shipping web map's RainViewer fallback.
/// RainViewer discontinued its public nowcast on January 1, 2026, so this
/// contract intentionally reads `radar.past` only and exposes no forecast API.
enum NativeGlobalRadarContract {
    static let metadataEndpoint = URL(string: "https://api.rainviewer.com/public/weather-maps.json")!
    static let tileOrigin = "https://tilecache.rainviewer.com"
    static let maximumMetadataBytes = 64 * 1_024
    static let metadataCacheAge: TimeInterval = 4 * 60
    static let maximumFutureSkew: TimeInterval = 2 * 60
    /// The documented archive is two hours. One extra half hour accommodates
    /// its ten-minute cadence and bounded upstream publication delay.
    static let maximumHistoryAge: TimeInterval = 150 * 60
    static let maximumLatestObservationAge: TimeInterval = 30 * 60
    static let maximumManifestAge: TimeInterval = 30 * 60
    static let maximumFrames = 24

    private static let attribution = NativeGlobalRadarAttribution(
        title: "Weather data by RainViewer",
        url: URL(string: "https://www.rainviewer.com/")!
    )

    private struct WireManifest: Decodable {
        struct Radar: Decodable {
            struct Frame: Decodable {
                let time: Int64
                let path: String
            }
            let past: [Frame]
        }
        let version: String
        let generated: Int64
        let host: String
        let radar: Radar
    }

    static func isAuthorizedMetadataEndpoint(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https"
            && url.host?.lowercased() == "api.rainviewer.com"
            && url.port == nil && url.user == nil && url.password == nil
            && url.fragment == nil && url.query == nil
            && url.path == "/public/weather-maps.json"
    }

    static func decodeManifest(_ data: Data, fetchedAt: Date, now: Date) -> NativeGlobalRadarAvailability {
        guard !data.isEmpty else { return .unavailable(.invalidManifest) }
        guard data.count <= maximumMetadataBytes else { return .unavailable(.responseTooLarge) }
        guard fetchedAt.timeIntervalSince1970.isFinite, now.timeIntervalSince1970.isFinite,
              fetchedAt.timeIntervalSince(now) <= maximumFutureSkew,
              now.timeIntervalSince(fetchedAt) <= metadataCacheAge,
              let wire = try? JSONDecoder().decode(WireManifest.self, from: data),
              wire.version.range(of: #"^2\.[0-9]+(?:\.[0-9]+)?$"#, options: .regularExpression) != nil,
              wire.version.utf8.count <= 8,
              wire.host == tileOrigin else {
            return .unavailable(.invalidManifest)
        }
        guard !wire.radar.past.isEmpty else { return .unavailable(.noObservedFrames) }
        guard wire.radar.past.count <= maximumFrames else { return .unavailable(.invalidManifest) }

        let generated = TimeInterval(wire.generated)
        guard generated.isFinite, generated >= 0 else { return .unavailable(.invalidManifest) }
        let generatedAt = Date(timeIntervalSince1970: generated)
        if now.timeIntervalSince(generatedAt) > maximumManifestAge {
            return .unavailable(.stale)
        }
        guard generatedAt.timeIntervalSince(now) <= maximumFutureSkew else {
            return .unavailable(.invalidManifest)
        }

        var seenTimes = Set<Int64>()
        var seenPaths = Set<String>()
        var frames: [NativeGlobalRadarFrame] = []
        frames.reserveCapacity(wire.radar.past.count)
        for advertised in wire.radar.past {
            guard seenTimes.insert(advertised.time).inserted,
                  seenPaths.insert(advertised.path).inserted,
                  validFramePath(advertised.path) else {
                return .unavailable(.invalidManifest)
            }
            let seconds = TimeInterval(advertised.time)
            guard seconds.isFinite, seconds >= 0 else { return .unavailable(.invalidManifest) }
            let validTime = Date(timeIntervalSince1970: seconds)
            guard validTime.timeIntervalSince(now) <= maximumFutureSkew else {
                return .unavailable(.invalidManifest)
            }
            let age = now.timeIntervalSince(validTime)
            guard age <= maximumHistoryAge else {
                return .unavailable(.stale)
            }
            frames.append(.init(
                id: "rainviewer-observed-\(advertised.time)",
                validTime: validTime,
                tileURLTemplate: "\(tileOrigin)\(advertised.path)/256/{z}/{x}/{y}/2/1_1.png",
                tileSize: 256,
                minimumZoom: 0,
                maximumZoom: 7,
                attributions: [attribution]
            ))
        }

        frames.sort { $0.validTime < $1.validTime }
        guard let latest = frames.last else { return .unavailable(.noObservedFrames) }
        if now.timeIntervalSince(latest.validTime) > maximumLatestObservationAge {
            return .unavailable(.stale)
        }
        guard generatedAt >= latest.validTime else { return .unavailable(.invalidManifest) }
        return .ready(.init(generatedAt: generatedAt, fetchedAt: fetchedAt, frames: frames))
    }

    private static func validFramePath(_ path: String) -> Bool {
        path.utf8.count <= 64
            && path.range(of: #"^/v2/radar/(?:[0-9]{10}|[0-9a-f]{12})$"#,
                          options: .regularExpression) != nil
    }

}
