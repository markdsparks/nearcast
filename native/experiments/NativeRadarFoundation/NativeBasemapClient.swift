import Foundation
import CryptoKit

/// End-user CARTO tile cache, separate from MapLibre's URL-keyed database.
/// Only opaque SHA-256 names and validated PNG bytes are persisted: provider
/// URLs/keys, cookies, response headers and configuration envelopes are not.
/// Provider freshness is honored, capped at one day (well below thirty days).
final class NativeBasemapTileCache: URLCache, @unchecked Sendable {
    private struct Entry: Codable {
        let expiry: Date
        let stored: Date
        let bytes: Data
    }
    private struct DiskEntry {
        let bytes: Int
        var expiry: Date
        var previous: String?
        var next: String?
    }
    struct CacheSnapshot {
        let diskEntries: Int
        let directoryScans: Int
        let diskWritesEnabled: Bool
    }
    private let directory: URL?
    private let clock: @Sendable () -> Date
    private let lock = NSLock()
    private let maximumBytes: Int
    private var credentialFingerprint: String?
    private var memory: [String: Entry] = [:]
    private var recency: [String] = []
    private let memoryLimit = 16 * 1024 * 1024
    private var memoryBytes = 0
    // A one-time metadata scan builds an opaque-key, bounded disk LRU. Tile
    // reads only move links in memory; no filesystem timestamps are rewritten.
    private var diskIndex: [String: DiskEntry] = [:]
    private var diskOldest: String?, diskNewest: String?
    private var diskBytes = 0
    private var nextDiskExpiry: Date?
    private var directoryScans = 0
    private var diskWritesEnabled = true
    private let maximumEntries: Int
    private let maximumEncodedEntryBytes = 2 * 1024 * 1024

    init(directory: URL?, maximumBytes: Int = 96 * 1024 * 1024,
         maximumEntries: Int = 8192,
         clock: @escaping @Sendable () -> Date = { Date() }) {
        self.directory = directory
        self.maximumBytes = min(96 * 1024 * 1024, max(0, maximumBytes))
        self.maximumEntries = min(8192, max(0, maximumEntries))
        self.clock = clock
        // A nonzero advertised memory capacity keeps URLSession's cache lookup
        // path enabled. Storage is implemented below; the stock disk store is
        // still disabled so it cannot retain keyed URLs.
        super.init(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 0, diskPath: nil)
        if let directory {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var excluded = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try? excluded.setResourceValues(values)
            credentialFingerprint = try? String(contentsOf: directory.appendingPathComponent("credential.sha256"), encoding: .utf8)
            indexDiskOnce()
        }
    }

    private func identity(_ request: URLRequest) -> (tile: String, credential: String)? {
        guard request.httpMethod == nil || request.httpMethod == "GET",
              request.value(forHTTPHeaderField: "Cookie") == nil,
              request.value(forHTTPHeaderField: "Authorization") == nil,
              let url = request.url, NativeBasemapContract.isCartoResourceURL(url),
              url.path.range(of: #"^/rastertiles/voyager_(nolabels|only_labels)/[0-9]+/[0-9]+/[0-9]+\.png$"#, options: .regularExpression) != nil,
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              query.count == 1, query[0].name == "key", let key = query[0].value, !key.isEmpty else { return nil }
        // CARTO's a/b/c/d hosts serve the same tile. Canonicalize that shard.
        return (Self.digest("carto-v1|\(url.path)|\(key)"), Self.digest(key))
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Called only when a freshly validated configuration selects a credential.
    /// Late responses for the old key may not erase the new key's working set.
    func activateCredential(_ key: String) {
        guard !key.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }; adoptCredential(Self.digest(key))
    }

    private func requestAllowsCache(_ request: URLRequest) -> Bool {
        let control = (request.value(forHTTPHeaderField: "Cache-Control") ?? "").lowercased()
        return !control.contains("no-cache") && !control.contains("no-store")
            && !control.contains("max-age=0")
            && request.value(forHTTPHeaderField: "Pragma")?.lowercased() != "no-cache"
    }

    private func adoptCredential(_ next: String) {
        guard credentialFingerprint != next else { return }
        clearEntries()
        credentialFingerprint = next
        if let directory { try? Data(next.utf8).write(to: directory.appendingPathComponent("credential.sha256"), options: .atomic) }
    }

    override func cachedResponse(for request: URLRequest) -> CachedURLResponse? {
        guard let identity = identity(request), let url = request.url, requestAllowsCache(request),
              request.cachePolicy != .reloadIgnoringLocalCacheData,
              request.cachePolicy != .reloadIgnoringLocalAndRemoteCacheData else { return nil }
        lock.lock(); defer { lock.unlock() }
        if credentialFingerprint == nil { adoptCredential(identity.credential) }
        guard credentialFingerprint == identity.credential else { return nil }
        let entry = memory[identity.tile] ?? readDiskEntry(identity.tile)
        guard let entry, entry.bytes.count <= 1024 * 1024,
              entry.bytes.starts(with: [137,80,78,71,13,10,26,10]),
              entry.expiry > clock(), entry.stored <= clock(),
              entry.expiry.timeIntervalSince(entry.stored) <= 86400 else {
            if let removed = memory.removeValue(forKey: identity.tile) { memoryBytes -= removed.bytes.count }
            recency.removeAll { $0 == identity.tile }
            removeDisk(identity.tile)
            return nil
        }
        remember(entry, key: identity.tile)
        touchDisk(identity.tile)
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "image/png", "Cache-Control": "max-age=\(max(0, Int(entry.expiry.timeIntervalSince(clock()))))"]) else { return nil }
        return CachedURLResponse(response: response, data: entry.bytes, storagePolicy: .allowedInMemoryOnly)
    }

    override func storeCachedResponse(_ cachedResponse: CachedURLResponse, for request: URLRequest) {
        guard let identity = identity(request), requestAllowsCache(request),
              let response = cachedResponse.response as? HTTPURLResponse,
              response.statusCode == 200, response.url == request.url,
              response.value(forHTTPHeaderField: "Set-Cookie") == nil,
              response.value(forHTTPHeaderField: "Vary") == nil,
              cachedResponse.data.count <= 1024 * 1024,
              cachedResponse.data.starts(with: [137,80,78,71,13,10,26,10]) else { return }
        let control = (response.value(forHTTPHeaderField: "Cache-Control") ?? "").lowercased()
        let directives = control.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard !directives.contains(where: { $0 == "no-store" || $0 == "no-cache" || $0.hasPrefix("no-cache=") }),
              let maxAge = directives.first(where: { $0.hasPrefix("max-age=") }).flatMap({ Double($0.dropFirst(8).replacingOccurrences(of: "\"", with: "")) }),
              maxAge.isFinite, maxAge > 0 else { return }
        let now = clock()
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        let apparentAge = response.value(forHTTPHeaderField: "Date").flatMap(formatter.date(from:))
            .map { max(0, now.timeIntervalSince($0)) } ?? 0
        guard let headerAge = Double(response.value(forHTTPHeaderField: "Age") ?? "0"),
              headerAge.isFinite, headerAge >= 0 else { return }
        let age = max(apparentAge, headerAge)
        let lifetime = min(86400, maxAge - age)
        guard lifetime.isFinite, lifetime > 0 else { return }
        let entry = Entry(expiry: now.addingTimeInterval(lifetime), stored: now, bytes: cachedResponse.data)
        let encoded = directory == nil ? nil : try? PropertyListEncoder().encode(entry)
        lock.lock(); defer { lock.unlock() }
        if credentialFingerprint == nil { adoptCredential(identity.credential) }
        guard credentialFingerprint == identity.credential else { return }
        remember(entry, key: identity.tile)
        if diskWritesEnabled, let directory, let data = encoded, data.count <= maximumBytes,
           data.count <= maximumEncodedEntryBytes, maximumEntries > 0 {
            pruneExpiredDisk()
            guard makeDiskRoom(for: data.count, replacing: identity.tile) else { return }
            let file = directory.appendingPathComponent(identity.tile + ".tile")
            do {
            #if os(iOS)
                try data.write(to: file, options: [.atomic, .completeFileProtectionUnlessOpen])
            #else
                try data.write(to: file, options: .atomic)
            #endif
                indexDisk(identity.tile, bytes: data.count, expiry: entry.expiry)
            } catch {
                // File protection, low storage or permissions can temporarily
                // prevent persistence. Fail closed to memory for this session.
                diskWritesEnabled = false
            }
        }
    }

    private func remember(_ entry: Entry, key: String) {
        if let old = memory.removeValue(forKey: key) { memoryBytes -= old.bytes.count }
        memory[key] = entry; memoryBytes += entry.bytes.count
        recency.removeAll { $0 == key }; recency.append(key)
        while memoryBytes > memoryLimit || memory.count > 2048, let oldest = recency.first {
            recency.removeFirst()
            if let old = memory.removeValue(forKey: oldest) { memoryBytes -= old.bytes.count }
        }
    }

    /// Initial order uses file modification time only. Reopening never reads
    /// every PNG payload; the embedded, potentially shorter HTTP expiry is
    /// validated on its first disk lookup. One day is an upper bound only.
    private func indexDiskOnce() {
        guard let directory, let files = try? FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return }
        directoryScans += 1
        let now = clock()
        var retained: [(String, Int, Date)] = []
        for file in files where file.pathExtension == "tile" {
            guard file.lastPathComponent.range(of: #"^[a-f0-9]{64}\.tile$"#, options: .regularExpression) != nil,
                  let values = try? file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]),
                  let date = values.contentModificationDate, date <= now, now.timeIntervalSince(date) < 86400,
                  let bytes = values.fileSize, bytes > 0, bytes <= maximumEncodedEntryBytes,
                  bytes <= maximumBytes, maximumEntries > 0 else {
                _ = deleteDiskFile(file); continue
            }
            retained.append((file.deletingPathExtension().lastPathComponent, bytes, date))
        }
        for entry in retained.sorted(by: { $0.2 < $1.2 }) {
            guard makeDiskRoom(for: entry.1, replacing: entry.0) else { break }
            indexDisk(entry.0, bytes: entry.1, expiry: entry.2.addingTimeInterval(86400))
        }
    }

    private func readDiskEntry(_ key: String) -> Entry? {
        guard let directory, let indexed = diskIndex[key] else { return nil }
        guard indexed.expiry > clock() else { removeDisk(key); return nil }
        let file = directory.appendingPathComponent(key + ".tile")
        guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0, size <= maximumEncodedEntryBytes,
              let data = try? Data(contentsOf: file), data.count <= maximumEncodedEntryBytes,
              let entry = try? PropertyListDecoder().decode(Entry.self, from: data) else {
            removeDisk(key); return nil
        }
        // Refresh accounting if the OS or another cache instance replaced the
        // file. Its embedded HTTP expiry, not mtime, controls the returned hit.
        if data.count <= maximumBytes {
            if makeDiskRoom(for: data.count, replacing: key) {
                indexDisk(key, bytes: data.count, expiry: entry.expiry)
            }
        } else { removeDisk(key) }
        return entry
    }

    private func indexDisk(_ key: String, bytes: Int, expiry: Date) {
        removeDisk(key, deleteFile: false)
        diskIndex[key] = DiskEntry(bytes: bytes, expiry: expiry, previous: diskNewest)
        if let last = diskNewest { diskIndex[last]?.next = key } else { diskOldest = key }
        diskNewest = key
        diskBytes += bytes
        nextDiskExpiry = min(nextDiskExpiry ?? expiry, expiry)
    }

    private func touchDisk(_ key: String) {
        guard let entry = diskIndex[key], diskNewest != key else { return }
        if let previous = entry.previous { diskIndex[previous]?.next = entry.next } else { diskOldest = entry.next }
        if let next = entry.next { diskIndex[next]?.previous = entry.previous }
        diskIndex[key]?.previous = diskNewest
        diskIndex[key]?.next = nil
        if let last = diskNewest { diskIndex[last]?.next = key }
        diskNewest = key
    }

    private func makeDiskRoom(for bytes: Int, replacing key: String) -> Bool {
        guard diskWritesEnabled else { return false }
        let oldBytes = diskIndex[key]?.bytes ?? 0
        let oldCount = diskIndex[key] == nil ? 0 : 1
        while diskBytes - oldBytes > maximumBytes - bytes || diskIndex.count - oldCount >= maximumEntries {
            guard let oldest = diskOldest else { return false }
            let victim = oldest == key ? diskIndex[oldest]?.next : oldest
            guard let victim, removeDisk(victim) else { return false }
        }
        return true
    }

    private func pruneExpiredDisk() {
        let now = clock()
        guard let nextDiskExpiry, nextDiskExpiry <= now else { return }
        let expired = diskIndex.compactMap { $0.value.expiry <= now ? $0.key : nil }
        for key in expired { if !removeDisk(key) { break } }
        self.nextDiskExpiry = diskIndex.values.map(\.expiry).min()
    }

    @discardableResult private func removeDisk(_ key: String, deleteFile: Bool = true) -> Bool {
        guard let entry = diskIndex[key] else { return true }
        if deleteFile, let directory,
           !deleteDiskFile(directory.appendingPathComponent(key + ".tile")) { return false }
        diskIndex.removeValue(forKey: key)
        if let previous = entry.previous { diskIndex[previous]?.next = entry.next } else { diskOldest = entry.next }
        if let next = entry.next { diskIndex[next]?.previous = entry.previous } else { diskNewest = entry.previous }
        diskBytes -= entry.bytes
        return true
    }

    private func deleteDiskFile(_ file: URL) -> Bool {
        do { try FileManager.default.removeItem(at: file); return true }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile { return true }
        catch {
            // Keep the indexed byte cost if deletion failed. Never admit a
            // replacement based on space that was not actually reclaimed.
            diskWritesEnabled = false
            return false
        }
    }

    private func clearEntries() {
        memory.removeAll(); recency.removeAll(); memoryBytes = 0
        for key in Array(diskIndex.keys) { removeDisk(key) }
        nextDiskExpiry = nil
    }

    override func removeAllCachedResponses() {
        lock.lock(); defer { lock.unlock() }; clearEntries()
    }

    override var currentMemoryUsage: Int {
        lock.lock(); defer { lock.unlock() }; return memoryBytes
    }
    override var currentDiskUsage: Int {
        lock.lock(); defer { lock.unlock() }; return diskBytes
    }
    func snapshot() -> CacheSnapshot {
        lock.lock(); defer { lock.unlock() }
        return .init(diskEntries: diskIndex.count, directoryScans: directoryScans, diskWritesEnabled: diskWritesEnabled)
    }
    override func removeCachedResponse(for request: URLRequest) {
        guard let identity = identity(request) else { return }
        lock.lock(); defer { lock.unlock() }
        if let entry = memory.removeValue(forKey: identity.tile) { memoryBytes -= entry.bytes.count }
        recency.removeAll { $0 == identity.tile }
        removeDisk(identity.tile)
    }
    override func removeCachedResponses(since date: Date) {
        lock.lock(); defer { lock.unlock() }
        // Conservative invalidation is safe and infrequent; never leave custom
        // storage behind when the platform requests a cache clear.
        clearEntries()
    }
    override func getCachedResponse(for dataTask: URLSessionDataTask,
                                    completionHandler: @escaping @Sendable (CachedURLResponse?) -> Void) {
        completionHandler((dataTask.currentRequest ?? dataTask.originalRequest).flatMap { cachedResponse(for: $0) })
    }
    override func storeCachedResponse(_ cachedResponse: CachedURLResponse, for dataTask: URLSessionDataTask) {
        if let request = dataTask.currentRequest ?? dataTask.originalRequest { storeCachedResponse(cachedResponse, for: request) }
    }
    override func removeCachedResponse(for dataTask: URLSessionDataTask) {
        if let request = dataTask.currentRequest ?? dataTask.originalRequest { removeCachedResponse(for: request) }
    }
}

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
