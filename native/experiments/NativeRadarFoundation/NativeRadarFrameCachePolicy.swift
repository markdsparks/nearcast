import Foundation

/// Hard memory bounds for rendered native radar frames. The cache itself is
/// intentionally not `Sendable`: its value may be a UIKit image and should stay
/// owned by the main-actor model rather than crossing concurrency domains.
struct NativeRadarFrameCachePolicy: Equatable, Sendable {
    static let nativeRadar = NativeRadarFrameCachePolicy(
        maximumEntries: 6,
        maximumCost: 8 * 1_024 * 1_024
    )!

    let maximumEntries: Int
    let maximumCost: Int

    init?(maximumEntries: Int, maximumCost: Int) {
        guard maximumEntries > 0, maximumCost > 0 else { return nil }
        self.maximumEntries = maximumEntries
        self.maximumCost = maximumCost
    }
}

/// Exact rendered viewport identity. Changing any bound invalidates every
/// cached image so a frame from an earlier map extent can never be reused.
struct NativeRadarFrameCacheViewport: Equatable, Sendable {
    let west: Double
    let south: Double
    let east: Double
    let north: Double
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

    /// Returns true when the viewport changed. A changed viewport always clears
    /// the cache before its identity is adopted; an identical viewport is a no-op.
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
