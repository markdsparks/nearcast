import Foundation

enum NativeBasemapUnavailableReason: Equatable, Sendable {
    case unsafeEndpoint
    case transport
    case responseTooLarge
    case invalidConfiguration
    case notConfigured
    case cancelled
}

struct NativeBasemapAttribution: Equatable, Sendable {
    let title: String
    let url: URL
}

/// A renderer-ready raster source. The URL templates contain the client-visible
/// provider credential required by MapLibre and must never be persisted or
/// included in diagnostics. Its description is deliberately redacted.
struct NativeBasemapRasterSource: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let id: String
    let tileURLTemplates: [String]
    let tileSize: Int
    let minimumZoom: Int
    let maximumZoom: Int
    let attributions: [NativeBasemapAttribution]

    var description: String { "NativeBasemapRasterSource(\(id), templates: <redacted>)" }
    var debugDescription: String { description }
}

/// Background is inserted below weather. Labels are always inserted above
/// weather, including over the public USGS aerial source.
struct NativeBasemapDescriptor: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let background: NativeBasemapRasterSource
    let labels: NativeBasemapRasterSource

    var description: String { "NativeBasemapDescriptor(background: \(background.id), labels: \(labels.id))" }
    var debugDescription: String { description }
}

struct NativeBasemapCatalog: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let streets: NativeBasemapDescriptor
    let aerial: NativeBasemapDescriptor

    /// Mirrors the shipping web map's deliberately conservative USGS coverage
    /// gate. This is source availability, not a promise of tile coverage.
    static func supportsAerial(latitude: Double, longitude: Double) -> Bool {
        guard latitude.isFinite, longitude.isFinite else { return false }
        let lon = ((longitude + 180).truncatingRemainder(dividingBy: 360) + 360)
            .truncatingRemainder(dividingBy: 360) - 180
        if latitude >= 13 && latitude <= 15 && lon >= 143 && lon <= 146 { return true }
        if latitude >= 17 && latitude <= 23 && lon >= -161 && lon <= -65 { return true }
        if latitude >= 51 && latitude <= 72 && lon >= -170 && lon <= -129 { return true }
        return latitude >= 20 && latitude <= 55 && lon >= -130 && lon <= -60
    }

    var description: String { "NativeBasemapCatalog(streets, aerial; credentials: <redacted>)" }
    var debugDescription: String { description }
}

enum NativeBasemapAvailability: Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    case ready(NativeBasemapCatalog)
    case unavailable(NativeBasemapUnavailableReason)

    var description: String {
        switch self {
        case .ready: return "NativeBasemapAvailability.ready(<redacted>)"
        case .unavailable(let reason): return "NativeBasemapAvailability.unavailable(\(reason))"
        }
    }
    var debugDescription: String { description }
}

enum NativeBasemapContract {
    static let provider = "nearcast-map-config"
    static let version = 1
    static let productionAudience = "app.nearcast.ios"
    static let developmentAudience = "app.nearcast.ios.dev"
    static let productionClient = "ios"
    static let developmentClient = "ios-dev"

    /// The map endpoint is deliberately a closed mapping rather than a
    /// reflection of a caller-supplied bundle id. This lets the side-by-side
    /// development app use its own provider credential without ever allowing
    /// an arbitrary app identity to select a credential lane.
    static func audience(for bundleIdentifier: String? = Bundle.main.bundleIdentifier) -> String? {
        switch bundleIdentifier {
        case productionAudience: return productionAudience
        case developmentAudience: return developmentAudience
        default: return nil
        }
    }

    static func client(for bundleIdentifier: String? = Bundle.main.bundleIdentifier) -> String? {
        switch audience(for: bundleIdentifier) {
        case productionAudience: return productionClient
        case developmentAudience: return developmentClient
        default: return nil
        }
    }

    /// Keeps standalone contract tests deterministic while production and
    /// development app builds resolve their exact allowlisted identity above.
    static var iosAudience: String {
        audience(for: Bundle.main.bundleIdentifier) ?? productionAudience
    }
    static let maximumConfigurationBytes = 4 * 1_024
    /// CARTO's current terms cap end-user/browser retention at thirty days.
    /// The renderer must enforce this separately for MapLibre's ambient cache
    /// and must not create offline packs from these sources.
    static let maximumDeviceCacheAge: TimeInterval = 30 * 24 * 60 * 60

    private static let cartoHosts = ["a", "b", "c", "d"]
    private static let cartoAttribution = NativeBasemapAttribution(
        title: "© CARTO", url: URL(string: "https://carto.com/attributions")!)
    private static let osmAttribution = NativeBasemapAttribution(
        title: "© OpenStreetMap contributors", url: URL(string: "https://www.openstreetmap.org/copyright")!)
    private static let usgsAttribution = NativeBasemapAttribution(
        title: "USGS/USDA The National Map",
        url: URL(string: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer")!)

    private struct WireConfiguration: Decodable {
        struct Carto: Decodable { let apiKey: String }
        let provider: String
        let version: Int
        let state: String
        let audience: String
        let carto: Carto
    }

    static func decodeConfiguration(_ data: Data,
                                    bundleIdentifier: String = iosAudience) -> NativeBasemapAvailability {
        guard let expectedAudience = audience(for: bundleIdentifier) else {
            return .unavailable(.invalidConfiguration)
        }
        guard !data.isEmpty, data.count <= maximumConfigurationBytes,
              let wire = try? JSONDecoder().decode(WireConfiguration.self, from: data),
              wire.provider == provider, wire.version == version,
              wire.audience == expectedAudience,
              ["ready", "unavailable"].contains(wire.state) else {
            return .unavailable(.invalidConfiguration)
        }
        if wire.state == "unavailable" {
            return wire.carto.apiKey.isEmpty
                ? .unavailable(.notConfigured)
                : .unavailable(.invalidConfiguration)
        }
        guard let catalog = catalog(apiKey: wire.carto.apiKey) else {
            return .unavailable(.invalidConfiguration)
        }
        return .ready(catalog)
    }

    static func isAuthorizedConfigurationEndpoint(_ url: URL,
                                                  bundleIdentifier: String = iosAudience) -> Bool {
        guard let expectedClient = client(for: bundleIdentifier) else { return false }
        guard url.scheme?.lowercased() == "https", url.host?.lowercased() == "getnearcast.app",
              url.port == nil, url.user == nil, url.password == nil, url.fragment == nil,
              url.path == "/api/map/config",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems == [URLQueryItem(name: "client", value: expectedClient)] else { return false }
        return true
    }

    static func isCartoResourceURL(_ url: URL?) -> Bool {
        guard let url, url.scheme?.lowercased() == "https", url.port == nil,
              url.user == nil, url.password == nil, url.fragment == nil,
              let host = url.host?.lowercased() else { return false }
        return host == "basemaps.cartocdn.com" || host.hasSuffix(".basemaps.cartocdn.com")
    }

    /// Shared pure request transformation used by the MapLibre delegate and
    /// deterministic tests. It never adds a Referer and never touches another
    /// provider's request.
    static func authorizeCartoRequest(_ request: NSMutableURLRequest,
                                      bundleIdentifier: String = iosAudience) -> NSMutableURLRequest {
        guard let audience = audience(for: bundleIdentifier),
              bundleIdentifier == audience,
              isCartoResourceURL(request.url) else { return request }
        request.setValue(audience, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
        return request
    }

    private static func catalog(apiKey: String) -> NativeBasemapCatalog? {
        guard isValidAPIKey(apiKey) else { return nil }
        let encoded = percentEncode(apiKey)
        let baseTemplates = cartoTemplates(style: "rastertiles/voyager_nolabels", encodedKey: encoded)
        let labelTemplates = cartoTemplates(style: "rastertiles/voyager_only_labels", encodedKey: encoded)
        let cartoCredits = [cartoAttribution, osmAttribution]
        let streetBase = NativeBasemapRasterSource(id: "nearcast-base", tileURLTemplates: baseTemplates,
            tileSize: 256, minimumZoom: 4, maximumZoom: 18, attributions: cartoCredits)
        let streetLabels = NativeBasemapRasterSource(id: "nearcast-labels", tileURLTemplates: labelTemplates,
            tileSize: 256, minimumZoom: 4, maximumZoom: 18, attributions: cartoCredits)
        let aerialBase = NativeBasemapRasterSource(id: "nearcast-aerial",
            tileURLTemplates: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256, minimumZoom: 4, maximumZoom: 16, attributions: [usgsAttribution])
        let aerialLabels = NativeBasemapRasterSource(id: "nearcast-aerial-labels", tileURLTemplates: labelTemplates,
            tileSize: 256, minimumZoom: 4, maximumZoom: 18, attributions: cartoCredits)
        return NativeBasemapCatalog(streets: .init(background: streetBase, labels: streetLabels),
                                    aerial: .init(background: aerialBase, labels: aerialLabels))
    }

    private static func isValidAPIKey(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && value.utf8.allSatisfy { (33...126).contains($0) }
    }

    private static func cartoTemplates(style: String, encodedKey: String) -> [String] {
        cartoHosts.map { "https://\($0).basemaps.cartocdn.com/\(style)/{z}/{x}/{y}.png?key=\(encodedKey)" }
    }

    private static func percentEncode(_ value: String) -> String {
        let unreserved = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~".utf8)
        return value.utf8.map { byte in
            unreserved.contains(byte) ? String(UnicodeScalar(byte)) : String(format: "%%%02X", byte)
        }.joined()
    }
}

/// Fetches only the small same-origin configuration envelope. The CARTO key is
/// never persisted; it lives solely inside the returned in-memory descriptors.
final class NativeBasemapClient: @unchecked Sendable {
    static func endpoint(for bundleIdentifier: String = NativeBasemapContract.iosAudience) -> URL {
        let client = NativeBasemapContract.client(for: bundleIdentifier) ?? NativeBasemapContract.productionClient
        return URL(string: "https://getnearcast.app/api/map/config?client=\(client)")!
    }

    static var configurationEndpoint: URL { endpoint() }
    /// Retained for callers compiled against the initial native-map rollout.
    /// Its value follows the active app identity, so Debug always stays in the
    /// isolated development credential lane.
    static var productionEndpoint: URL { configurationEndpoint }

    private let endpoint: URL
    private let configuration: URLSessionConfiguration

    init(endpoint: URL = configurationEndpoint, configuration: URLSessionConfiguration = .ephemeral) {
        self.endpoint = endpoint
        let isolated = configuration.copy() as! URLSessionConfiguration
        isolated.urlCache = nil
        isolated.httpCookieStorage = nil
        isolated.urlCredentialStorage = nil
        isolated.httpShouldSetCookies = false
        isolated.requestCachePolicy = .reloadIgnoringLocalCacheData
        isolated.timeoutIntervalForRequest = 8
        isolated.timeoutIntervalForResource = 10
        isolated.httpMaximumConnectionsPerHost = 1
        self.configuration = isolated
    }

    func load() async -> NativeBasemapAvailability {
        guard NativeBasemapContract.isAuthorizedConfigurationEndpoint(endpoint) else {
            return .unavailable(.unsafeEndpoint)
        }
        do {
            let operation = NativeBasemapConfigurationDownload(url: endpoint,
                maximumBytes: NativeBasemapContract.maximumConfigurationBytes,
                configuration: configuration.copy() as! URLSessionConfiguration)
            return NativeBasemapContract.decodeConfiguration(try await operation.value())
        } catch is CancellationError {
            return .unavailable(.cancelled)
        } catch NativeBasemapConfigurationDownload.Failure.sizeLimit {
            return .unavailable(.responseTooLarge)
        } catch {
            return .unavailable(.transport)
        }
    }
}

private final class NativeBasemapConfigurationDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    enum Failure: Error { case transport, status, redirect, sizeLimit, unexpectedResponse }

    private let url: URL
    private let maximumBytes: Int
    private let configuration: URLSessionConfiguration
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var received = Data()
    private var finished = false

    init(url: URL, maximumBytes: Int, configuration: URLSessionConfiguration) {
        self.url = url
        self.maximumBytes = maximumBytes
        self.configuration = configuration
    }

    func value() async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation(start)
        } onCancel: {
            self.finish(.failure(CancellationError()))
        }
    }

    private func start(_ continuation: CheckedContinuation<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let task = session.dataTask(with: request)
        self.session = session
        self.task = task
        lock.unlock()
        task.resume()
    }

    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = self.continuation
        let session = self.session
        let task = self.task
        self.continuation = nil
        self.session = nil
        self.task = nil
        received.removeAll(keepingCapacity: false)
        lock.unlock()
        task?.cancel()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(Failure.redirect))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, response.url == url, http.statusCode == 200,
              http.value(forHTTPHeaderField: "Cache-Control")?.lowercased()
                .split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }).contains("no-store") == true else {
            completionHandler(.cancel)
            finish(.failure(Failure.unexpectedResponse))
            return
        }
        guard response.expectedContentLength < 0 || response.expectedContentLength <= maximumBytes else {
            completionHandler(.cancel)
            finish(.failure(Failure.sizeLimit))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= maximumBytes - received.count else {
            lock.unlock()
            finish(.failure(Failure.sizeLimit))
            return
        }
        received.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            finish(.failure((error as? URLError)?.code == .cancelled
                ? CancellationError() : Failure.transport))
            return
        }
        lock.lock(); let result = received; lock.unlock()
        finish(.success(result))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
            completionHandler(.performDefaultHandling, nil)
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
