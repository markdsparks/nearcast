import Foundation
#if canImport(MapLibre)
import MapLibre

/// Installs the provider-required iOS identity header on CARTO requests only.
/// Call before constructing the first MLNMapView. MapLibre retains its delegate
/// weakly, so this owner keeps the immutable transformer alive for the process.
@MainActor
enum NativeBasemapNetwork {
    private static var retainedDelegate: NativeBasemapNetworkDelegate?
    private static var cachePrepared = false
    private static var tileCache: NativeBasemapTileCache?

    static func activate(_ catalog: NativeBasemapCatalog) {
        guard let template = catalog.streets.background.tileURLTemplates.first,
              let components = URLComponents(string: template),
              let key = components.queryItems?.first(where: { $0.name == "key" })?.value else { return }
        tileCache?.activateCredential(key)
    }

    /// Keep MapLibre's URL-keyed database disabled so it cannot persist provider
    /// credentials. A separate bounded PNG cache below retains opaque hashes,
    /// respects HTTP freshness, caps age at one day and purges on key rotation.
    /// The app does not create offline packs or cache configuration envelopes.
    static func prepareCache(bundleIdentifier: String? = Bundle.main.bundleIdentifier) async -> Bool {
        guard configureTransport(bundleIdentifier: bundleIdentifier) else { return false }
        guard !cachePrepared else { return true }
        let storage = MLNOfflineStorage.shared
        let disabled: Bool = await withCheckedContinuation { continuation in
            storage.setMaximumAmbientCacheSize(0) { error in
                continuation.resume(returning: error == nil)
            }
        }
        guard disabled else { return false }
        let cleared: Bool = await withCheckedContinuation { continuation in
            storage.clearAmbientCache { error in
                continuation.resume(returning: error == nil)
            }
        }
        cachePrepared = cleared
        return cleared
    }

    static func install(bundleIdentifier: String? = Bundle.main.bundleIdentifier) -> Bool {
        guard configureTransport(bundleIdentifier: bundleIdentifier), cachePrepared else { return false }
        return true
    }

    private static func configureTransport(bundleIdentifier: String?) -> Bool {
        guard let audience = NativeBasemapContract.audience(for: bundleIdentifier),
              bundleIdentifier == audience else { return false }
        if retainedDelegate != nil { return true }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeBasemapMemoryResourceProtocol.self] + (configuration.protocolClasses ?? [])
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("NearcastBasemapTiles-v1", isDirectory: true)
        let cache = NativeBasemapTileCache(directory: directory)
        tileCache = cache
        configuration.urlCache = cache
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .useProtocolCachePolicy
        let delegate = NativeBasemapNetworkDelegate(bundleIdentifier: audience)
        // Provider keys are necessarily embedded in MapLibre tile URLs. Keep
        // SDK URL/error logging disabled; Nearcast exposes only redacted states.
        MLNLoggingConfiguration.shared.loggingLevel = .none
        let manager = MLNNetworkConfiguration.sharedManager
        manager.sessionConfiguration = configuration
        manager.delegate = delegate
        retainedDelegate = delegate
        return true
    }
}

private final class NativeBasemapNetworkDelegate: NSObject, MLNNetworkConfigurationDelegate, @unchecked Sendable {
    private let bundleIdentifier: String

    init(bundleIdentifier: String) {
        self.bundleIdentifier = bundleIdentifier
    }

    func willSend(_ request: NSMutableURLRequest) -> NSMutableURLRequest {
        // Only validated CARTO PNG resources enter our provider-aware cache.
        request.cachePolicy = NativeBasemapContract.isCartoResourceURL(request.url)
            ? .useProtocolCachePolicy : .reloadIgnoringLocalCacheData
        return NativeBasemapContract.authorizeCartoRequest(request, bundleIdentifier: bundleIdentifier)
    }
}
#endif

/// Ephemeral, renderer-local resources. Complete snapshot styles must be loaded
/// atomically; putting their authorized tile URLs in a temporary JSON file would
/// leak credentials. This reserved origin never makes a network request, even
/// after a render's lease has expired. Provider traffic is not intercepted.
final class NativeBasemapMemoryResourceProtocol: URLProtocol, @unchecked Sendable {
    static let host = "nearcast-map-memory.invalid"
    static let maximumBytes = 16 * 1024 * 1024
    static let maximumLeaseBytes = 8 * 1024 * 1024
    static let maximumLeases = 8
    static var retainedResourceCount: Int { store.count }
    static var retainedResourceBytes: Int { store.retainedBytes }
    struct Resource: Sendable { let data: Data; let mimeType: String }
    final class Lease: @unchecked Sendable {
        let identifier = UUID().uuidString
        private let lock = NSLock()
        private var released = false
        func url(_ name: String) -> URL {
            URL(string: "https://\(NativeBasemapMemoryResourceProtocol.host)/\(identifier)/\(name)")!
        }
        func install(_ resources: [String: Resource]) -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard !released else { return false }
            return store.install(resources, for: identifier)
        }
        func release() {
            lock.lock(); defer { lock.unlock() }
            guard !released else { return }
            released = true; store.remove(identifier)
        }
        deinit { release() }
    }
    private final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var entries: [String: [String: Resource]] = [:]
        private var bytes = 0
        func install(_ resources: [String: Resource], for identifier: String) -> Bool {
            let cost = resources.values.reduce(0) { $0 + $1.data.count }
            guard !resources.isEmpty, resources.count <= 8, cost > 0, cost <= maximumLeaseBytes,
                  resources.keys.allSatisfy({ name in
                      !name.isEmpty && name.count <= 48 && name.unicodeScalars.allSatisfy {
                          CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.").contains($0)
                      } && (name.hasSuffix(".json") || name.hasSuffix(".png"))
                  }) else { return false }
            lock.lock(); defer { lock.unlock() }
            guard entries[identifier] == nil, entries.count < maximumLeases,
                  bytes <= maximumBytes - cost else { return false }
            entries[identifier] = resources; bytes += cost
            return true
        }
        func resource(_ url: URL) -> Resource? {
            let path = url.pathComponents
            guard path.count == 3 else { return nil }
            lock.lock(); defer { lock.unlock() }
            return entries[path[1]]?[path[2]]
        }
        func remove(_ identifier: String) {
            lock.lock(); defer { lock.unlock() }
            if let removed = entries.removeValue(forKey: identifier) {
                bytes -= removed.values.reduce(0) { $0 + $1.data.count }
            }
        }
        var count: Int {
            lock.lock(); defer { lock.unlock() }; return entries.values.reduce(0) { $0 + $1.count }
        }
        var retainedBytes: Int {
            lock.lock(); defer { lock.unlock() }; return bytes
        }
    }
    private static let store = Store()
    private let cancellationLock = NSLock()
    private var stopped = false
    private var isStopped: Bool {
        cancellationLock.lock(); defer { cancellationLock.unlock() }; return stopped
    }
    override class func canInit(with request: URLRequest) -> Bool {
        // Claim the whole reserved origin, including malformed/expired paths,
        // so a released resource can never fall through to DNS or networking.
        request.url?.scheme == "https" && request.url?.host == host
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard !isStopped else { return }
        guard let url = request.url, let resource = Self.store.resource(url),
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": resource.mimeType, "Cache-Control": "no-store",
                               "Content-Length": String(resource.data.count)]) else {
            if !isStopped { client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable)) }
            return
        }
        guard !isStopped else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        guard !isStopped else { return }
        client?.urlProtocol(self, didLoad: resource.data)
        guard !isStopped else { return }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {
        cancellationLock.lock(); stopped = true; cancellationLock.unlock()
    }
}
