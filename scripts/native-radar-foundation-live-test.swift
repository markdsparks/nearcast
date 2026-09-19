import Foundation

/// Deliberately opt-in and excluded from CI. Reads only the same public NOAA sources
/// as the isolated raster proof; no location, app state, credentials, or writes.
@main
enum NativeRadarFoundationLiveTest {
    struct ProbeError: Error, LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
    struct Metadata {
        let source: RadarTimelineSource
        let times: [String]
        let fetchedAt: Date
    }

    static func main() async {
        do { try await run() }
        catch {
            print("FAIL Native radar foundation live probe: \(error.localizedDescription)")
            exit(1)
        }
    }

    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw ProbeError(message: message) }
    }

    static func run() async throws {
        let arguments = Set(CommandLine.arguments.dropFirst())
        try require(arguments.contains("--live") && arguments.isSubset(of: ["--live", "--tiles"]),
                    "Explicit --live is required; optional --tiles checks one PNG per source.")
        try require(ProcessInfo.processInfo.environment["CI", default: ""].isEmpty,
                    "This point-in-time network probe must not run in CI.")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 25
        configuration.httpMaximumConnectionsPerHost = 2
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        async let observed = fetchMetadata(source: .observed, session: session)
        async let accumulation = fetchMetadata(source: .accumulation, session: session)
        let metadata = try await [observed, accumulation]
        let now = Date()
        var state = RadarTimelineState(now: now)
        let token = state.beginRefresh(at: now)
        let results = Dictionary(uniqueKeysWithValues: metadata.map {
            ($0.source, RadarTimelineLoadResult.success(times: $0.times, fetchedAt: $0.fetchedAt))
        })
        try require(state.applyRefresh(results, token: token, at: now), "Live metadata was not applied.")

        for source in RadarTimelineSource.allCases {
            let advertised = metadata.first { $0.source == source }!.times
            let usableTimes = Set(advertised.compactMap(RadarTimelineTimes.parse).filter {
                source == .observed ? $0 <= now : $0 > now
            })
            let frames = state.frames(for: source)
            try require(frames.count >= 3, "\(source.rawValue) did not advertise several usable actual frames.")
            try require(Set(frames.map(\.validTime)) == usableTimes,
                        "\(source.rawValue) must retain exactly the available provider instants.")
            try require(frames.allSatisfy { advertised.contains($0.sourceTime) },
                        "A frame's source TIME was not actually advertised.")
            try require(state.status(for: source).state == .ready, "\(source.rawValue) did not become available.")
            print("PASS \(source.rawValue): advertised=\(advertised.count), available=\(frames.count), rejected=\(state.status(for: source).rejectedTimeCount)")
            print("  first=\(frames.first!.sourceTime), last=\(frames.last!.sourceTime)")
        }

        let observedFrame = state.selectedFrame!
        try require(observedFrame.source == .observed && observedFrame.validTime == state.frames(for: .observed).last!.validTime,
                    "Initial selection must be the latest nonfuture actual observation.")
        try require(observedFrame.validTime <= now, "A future observation was selected.")
        try require(state.selectFirstForecast(), "Next actual accumulation frame was unavailable.")
        let forecastFrame = state.selectedFrame!
        try require(forecastFrame.source == .accumulation && forecastFrame.validTime == state.frames(for: .accumulation).first!.validTime,
                    "Forecast selection must be the next actual six-hour accumulation valid time.")
        try require(forecastFrame.validTime > now && forecastFrame.proofFrame.kind == .accumulation,
                    "Future guidance must remain six-hour accumulation, never observed radar.")
        print("PASS selected observation TIME=\(observedFrame.sourceTime)")
        print("PASS selected six-hour accumulation TIME=\(forecastFrame.sourceTime)")

        if arguments.contains("--tiles") {
            async let observedTile: Void = checkPNG(frame: observedFrame, session: session)
            async let forecastTile: Void = checkPNG(frame: forecastFrame, session: session)
            _ = try await (observedTile, forecastTile)
        }
        print("PASS Point-in-time availability/contract probe only; not rendering, rain/no-rain, forecast-accuracy, or reliability evidence.")
    }

    static func fetchMetadata(source: RadarTimelineSource, session: URLSession) async throws -> Metadata {
        let endpoint: String
        let layer: String
        switch source {
        case .observed:
            endpoint = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows"
            layer = "conus_bref_qcd"
        case .accumulation:
            endpoint = "https://nowcoast.noaa.gov/geoserver/ndfd_precipitation/wms"
            layer = "conus_6hr_precipitation_amount"
        }
        let url = URL(string: endpoint + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities")!
        let data = try await fetch(url: url, session: session)
        try require(data.count <= 8 * 1_024 * 1_024, "Unexpectedly large public capabilities response.")
        let times = try RadarProofCapabilities.times(in: data, layer: layer)
        return Metadata(source: source, times: times, fetchedAt: Date())
    }

    static func checkPNG(frame: RadarTimelineFrame, session: URLSession) async throws {
        // Public CONUS test tile used by the existing proof. No device/user location.
        let url = try frame.proofFrame.tileURL(x: 16, y: 24, z: 6)
        let data = try await fetch(url: url, session: session)
        try require(Array(data.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10],
                    "\(frame.source.rawValue) did not return a PNG signature for its exact selected TIME.")
        print("PASS selected PNG signature \(frame.source.rawValue) TIME=\(frame.sourceTime)")
    }

    static func fetch(url: URL, session: URLSession) async throws -> Data {
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        let (data, response) = try await session.data(for: request)
        try require((response as? HTTPURLResponse)?.statusCode == 200, "Public NOAA request did not return HTTP 200.")
        return data
    }
}
