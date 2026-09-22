import Foundation

/// A small, exact-time warmup around the selected frame, never a full-loop download.
enum NativeRadarPrefetchPolicy {
    static func targets(dates: [Date], selected: Date, cached: Set<Date>, playing: Bool) -> [Date] {
        guard selected.timeIntervalSince1970.isFinite, dates.count <= 128 else { return [] }
        let sorted = Array(Set(dates.filter { $0.timeIntervalSince1970.isFinite })).sorted()
        guard let index = sorted.firstIndex(of: selected) else { return [] }
        let offsets = playing ? [1, 2] : [1, -1, 2, -2]
        return Array(offsets.compactMap { offset -> Date? in
            let next = index + offset
            guard sorted.indices.contains(next), !cached.contains(sorted[next]),
                  abs(sorted[next].timeIntervalSince(selected)) <= 3600 else { return nil }
            return sorted[next]
        }.prefix(2))
    }
}

/// Hard memory bounds for rendered native radar frames. The cache itself is
/// intentionally not `Sendable`: its value may be a UIKit image and should stay
/// owned by the main-actor model rather than crossing concurrency domains.
struct NativeRadarFrameCachePolicy: Equatable, Sendable {
    static let nativeRadar = NativeRadarFrameCachePolicy(
        maximumEntries: 6,
        // Six padded 512x672 frames at RGBA + value + coverage bytes each.
        // Keep a complete six-scan observed loop resident instead of trading
        // away playback reuse when adding geographic coverage padding.
        maximumCost: 12 * 1_024 * 1_024
    )!

    // App-lifetime, multi-area stores use complete source + envelope identities
    // as keys, not setViewport(). Together these model-owned stores account for
    // at most 64 MiB. Provider byte/numeric caches and GPU/transient allocations
    // are separate and must not be described as part of this retained budget.
    static let observedAreas = NativeRadarFrameCachePolicy(maximumEntries: 8,
        maximumCost: 16 * 1_024 * 1_024)!
    static let forecastRenderedAreas = NativeRadarFrameCachePolicy(maximumEntries: 30,
        maximumCost: 40 * 1_024 * 1_024)!
    static let transitionEvidence = NativeRadarFrameCachePolicy(maximumEntries: 12,
        maximumCost: 8 * 1_024 * 1_024)!
    static let multiAreaMaximumCost = observedAreas.maximumCost
        + forecastRenderedAreas.maximumCost + transitionEvidence.maximumCost

    let maximumEntries: Int
    let maximumCost: Int

    init?(maximumEntries: Int, maximumCost: Int) {
        guard maximumEntries > 0, maximumCost > 0 else { return nil }
        self.maximumEntries = maximumEntries
        self.maximumCost = maximumCost
    }
}

/// Rendered observations must agree with the advertised source identity just
/// like the underlying compressed-byte cache. A provider can replace bytes at
/// the same path/time; path alone must not keep an old image indefinitely.
struct NativeRadarObservedFrameIdentity: Equatable, Sendable {
    let sourceKey: String
    let byteLength: Int
    let validTimeMilliseconds: Int64

    var cacheKey: String { "\(sourceKey)|\(byteLength)|\(validTimeMilliseconds)" }
}

/// Exact rendered coverage identity, not the camera's constantly moving bounds.
/// Every image keeps these true geographic corners when reused on the map.
struct NativeRadarFrameCacheViewport: Equatable, Sendable {
    let west: Double
    let south: Double
    let east: Double
    let north: Double

    var isUsable: Bool {
        [west, south, east, north].allSatisfy(\.isFinite)
            && west >= -180 && east <= 180 && south >= -85 && north <= 85
            && west < east && south < north
    }

    func contains(_ other: Self) -> Bool {
        isUsable && other.isUsable && west <= other.west && south <= other.south
            && east >= other.east && north >= other.north
    }
}

/// Coverage warnings describe the visible camera, not the padded render/cache
/// envelope. Measure masks in the same Web Mercator space as the image; valid
/// transparent (dry) pixels still count as covered. Off-image areas do not.
enum NativeRadarVisibleCoverage {
    static func fraction(width: Int, height: Int,
                         imageBounds: NativeRadarFrameCacheViewport,
                         visibleBounds: NativeRadarFrameCacheViewport,
                         isCovered: (Int) -> Bool) -> Double? {
        guard width > 0, height > 0, width <= 4096, height <= 4096,
              width <= 4_194_304 / height, imageBounds.isUsable, visibleBounds.isUsable else { return nil }
        func mercator(_ latitude: Double) -> Double { log(tan(.pi / 4 + latitude * .pi / 360)) }
        let north = mercator(imageBounds.north)
        let verticalSpan = north - mercator(imageBounds.south)
        let horizontalSpan = imageBounds.east - imageBounds.west
        let x0 = (visibleBounds.west - imageBounds.west) / horizontalSpan * Double(width)
        let x1 = (visibleBounds.east - imageBounds.west) / horizontalSpan * Double(width)
        let y0 = (north - mercator(visibleBounds.north)) / verticalSpan * Double(height)
        let y1 = (north - mercator(visibleBounds.south)) / verticalSpan * Double(height)
        let area = (x1 - x0) * (y1 - y0)
        guard [x0, x1, y0, y1, area].allSatisfy(\.isFinite), area > 0 else { return nil }
        let left = max(0, min(Double(width), x0)), right = max(0, min(Double(width), x1))
        let top = max(0, min(Double(height), y0)), bottom = max(0, min(Double(height), y1))
        guard left < right, top < bottom else { return 0 }
        var coveredArea = 0.0
        for row in Int(floor(top))..<Int(ceil(bottom)) {
            let rowWeight = min(Double(row + 1), bottom) - max(Double(row), top)
            for column in Int(floor(left))..<Int(ceil(right)) where isCovered(row * width + column) {
                coveredArea += rowWeight * (min(Double(column + 1), right) - max(Double(column), left))
            }
        }
        return min(1, max(0, coveredArea / area))
    }
}

/// Reuse a bounded geographic envelope through nearby camera movements. Small
/// pans do not restart downloads/decodes, but zooming still changes the quality
/// bucket. The envelope never changes the coordinates of an existing image.
enum NativeRadarCoveragePolicy {
    struct Envelope: Equatable, Sendable {
        let bounds: NativeRadarFrameCacheViewport
        let qualityZoom: Double

        /// Exact geographic/quality identity, independent of localized number
        /// formatting and without decimal rounding that could alias two areas.
        var cacheKey: String {
            [bounds.west, bounds.south, bounds.east, bounds.north, qualityZoom]
                .map { String(($0 == 0 ? 0.0 : $0).bitPattern, radix: 16) }.joined(separator: ":")
        }

        func contains(_ visible: NativeRadarFrameCacheViewport, zoom: Double) -> Bool {
            zoom.isFinite && (0...24).contains(zoom) && qualityZoom == floor(zoom * 2) / 2
                && bounds.contains(visible)
        }
    }

    // Padding is at most 31.25% overall after quantization. These dimensions
    // preserve roughly the old 384x512 visible-pixel density within that area.
    // The rendered-frame cache's twelve-MiB cap retains six padded frames.
    static let pixelWidth = 512
    static let pixelHeight = 672

    static func envelope(for visible: NativeRadarFrameCacheViewport, zoom: Double,
                         retaining current: Envelope?) -> Envelope? {
        guard visible.isUsable, zoom.isFinite, (0...24).contains(zoom) else { return nil }
        let quality = floor(zoom * 2) / 2
        if let current, current.qualityZoom == quality, current.bounds.contains(visible) {
            return current
        }
        func padded(_ low: Double, _ high: Double, minimum: Double, maximum: Double) -> (Double, Double) {
            let span = high - low
            let quantum = span / 32
            var start = floor((low - span / 8) / quantum) * quantum
            var end = ceil((high + span / 8) / quantum) * quantum
            // Do not turn an otherwise-supported <=14-degree forecast view
            // into an unsupported large regional request just by padding it.
            if span <= 14 && end - start > 14 {
                let spare = (14 - span) / 2
                start = low - spare; end = high + spare
            }
            return (max(minimum, start), min(maximum, end))
        }
        let longitude = padded(visible.west, visible.east, minimum: -180, maximum: 180)
        let latitude = padded(visible.south, visible.north, minimum: -85, maximum: 85)
        let bounds = NativeRadarFrameCacheViewport(west: longitude.0, south: latitude.0,
                                                   east: longitude.1, north: latitude.1)
        guard bounds.contains(visible) else { return nil }
        return .init(bounds: bounds, qualityZoom: quality)
    }
}

/// Small app-lifetime history of actual coverage envelopes. Returning to a
/// recently visited area/zoom recovers the exact original envelope key even if
/// the new camera corners differ slightly. No field/image data lives here.
/// It never grants wider coverage or a higher rendering quality than cached.
struct NativeRadarCoverageHistory: Sendable {
    let maximumEntries: Int
    private var entries: [NativeRadarCoveragePolicy.Envelope] = [] // LRU -> MRU

    init(maximumEntries: Int = 8) {
        self.maximumEntries = min(16, max(1, maximumEntries))
    }

    var count: Int { entries.count }
    var envelopesInLeastToMostRecentlyUsedOrder: [NativeRadarCoveragePolicy.Envelope] { entries }

    mutating func envelope(for visible: NativeRadarFrameCacheViewport, zoom: Double) -> NativeRadarCoveragePolicy.Envelope? {
        if let index = entries.lastIndex(where: { $0.contains(visible, zoom: zoom) }) {
            let hit = entries.remove(at: index)
            entries.append(hit)
            return hit
        }
        guard let next = NativeRadarCoveragePolicy.envelope(for: visible, zoom: zoom, retaining: nil) else { return nil }
        entries.append(next)
        if entries.count > maximumEntries { entries.removeFirst(entries.count - maximumEntries) }
        return next
    }

    mutating func removeAll() { entries.removeAll(keepingCapacity: false) }
}

/// A deterministic, value-semantic LRU cache for already-rendered frames.
/// Costs are caller-supplied bytes (normally width * height * 4 for RGBA).
/// Insertion is transactional for invalid or oversized values: an existing
/// value for the same key remains available when replacement is rejected.
struct NativeRadarFrameCache<Key: Hashable, Value> {
    private struct Entry {
        let value: Value
        let cost: Int
    }

    let policy: NativeRadarFrameCachePolicy
    private(set) var viewport: NativeRadarFrameCacheViewport?
    private(set) var totalCost = 0
    private var entries: [Key: Entry] = [:]
    private var recency: [Key] = [] // Least recently used to most recently used.

    init(policy: NativeRadarFrameCachePolicy = .nativeRadar) {
        self.policy = policy
    }

    var count: Int { entries.count }
    var isEmpty: Bool { entries.isEmpty }
    var keysInLeastToMostRecentlyUsedOrder: [Key] { recency }

    func contains(_ key: Key) -> Bool { entries[key] != nil }
    func cost(for key: Key) -> Int? { entries[key]?.cost }

    mutating func value(for key: Key) -> Value? {
        guard let entry = entries[key] else { return nil }
        touch(key)
        return entry.value
    }

    /// Returns false without mutating the cache when `cost` is invalid or one
    /// value alone would exceed the whole cache budget.
    @discardableResult
    mutating func insert(_ value: Value, for key: Key, cost: Int) -> Bool {
        guard cost > 0, cost <= policy.maximumCost else { return false }

        if let replaced = entries[key] { totalCost -= replaced.cost }
        entries[key] = Entry(value: value, cost: cost)
        totalCost += cost
        touch(key)
        evictToPolicy()
        return true
    }

    @discardableResult
    mutating func removeValue(for key: Key) -> Value? {
        guard let removed = entries.removeValue(forKey: key) else { return nil }
        totalCost -= removed.cost
        recency.removeAll { $0 == key }
        return removed.value
    }

    /// Compatibility API for single-area owners: a changed viewport clears the
    /// cache. Multi-area owners instead include Envelope.cacheKey in each key
    /// and do NOT call this method when changing the visible camera/area.
    @discardableResult
    mutating func setViewport(_ next: NativeRadarFrameCacheViewport) -> Bool {
        guard viewport != next else { return false }
        removeAll()
        viewport = next
        return true
    }

    /// Clears frame values while retaining the current viewport identity.
    mutating func removeAll() {
        entries.removeAll(keepingCapacity: false)
        recency.removeAll(keepingCapacity: false)
        totalCost = 0
    }

    private mutating func touch(_ key: Key) {
        recency.removeAll { $0 == key }
        recency.append(key)
    }

    private mutating func evictToPolicy() {
        while entries.count > policy.maximumEntries || totalCost > policy.maximumCost {
            guard let oldest = recency.first else {
                entries.removeAll(keepingCapacity: false)
                totalCost = 0
                return
            }
            _ = removeValue(for: oldest)
        }
    }
}
