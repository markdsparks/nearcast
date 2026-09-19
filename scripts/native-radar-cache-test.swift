import Foundation

private final class FrameValue {
    let label: String
    init(_ label: String) { self.label = label }
}

@main
enum NativeRadarFrameCacheTests {
    static func main() {
        let mebibyte = 1_024 * 1_024
        let standard = NativeRadarFrameCachePolicy.nativeRadar
        precondition(standard.maximumEntries == 6)
        precondition(standard.maximumCost == 8 * mebibyte)
        precondition(NativeRadarFrameCachePolicy(maximumEntries: 0, maximumCost: 1) == nil)
        precondition(NativeRadarFrameCachePolicy(maximumEntries: 1, maximumCost: 0) == nil)

        // This reference type deliberately has no Sendable conformance. UIKit
        // images can be cached the same way while the owner stays on MainActor.
        var cache = NativeRadarFrameCache<String, FrameValue>()
        let viewportA = NativeRadarFrameCacheViewport(west: -91, south: 37, east: -88, north: 40)
        let viewportB = NativeRadarFrameCacheViewport(west: -90.5, south: 37, east: -87.5, north: 40)
        precondition(cache.setViewport(viewportA))
        precondition(!cache.setViewport(viewportA))

        for index in 0..<6 {
            precondition(cache.insert(FrameValue("frame-\(index)"), for: "k\(index)", cost: mebibyte))
        }
        precondition(cache.count == 6 && cache.totalCost == 6 * mebibyte)
        precondition(cache.keysInLeastToMostRecentlyUsedOrder == ["k0", "k1", "k2", "k3", "k4", "k5"])

        // A read refreshes recency; entry pressure then removes the true LRU.
        precondition(cache.value(for: "k0")?.label == "frame-0")
        precondition(cache.keysInLeastToMostRecentlyUsedOrder.last == "k0")
        precondition(cache.insert(FrameValue("frame-6"), for: "k6", cost: mebibyte))
        precondition(!cache.contains("k1") && cache.contains("k0") && cache.contains("k6"))
        precondition(cache.count == 6 && cache.totalCost == 6 * mebibyte)

        // Replacement is one entry, becomes MRU, and can evict older entries to
        // satisfy total cost. A rejected replacement preserves that value/cost.
        precondition(cache.insert(FrameValue("frame-0-replaced"), for: "k0", cost: 4 * mebibyte))
        precondition(cache.value(for: "k0")?.label == "frame-0-replaced")
        precondition(cache.count == 5 && cache.totalCost == 8 * mebibyte)
        let beforeOrder = cache.keysInLeastToMostRecentlyUsedOrder
        precondition(!cache.insert(FrameValue("too-large"), for: "k0", cost: 8 * mebibyte + 1))
        precondition(!cache.insert(FrameValue("invalid"), for: "k0", cost: 0))
        precondition(cache.value(for: "k0")?.label == "frame-0-replaced")
        precondition(cache.totalCost == 8 * mebibyte)
        precondition(Set(cache.keysInLeastToMostRecentlyUsedOrder) == Set(beforeOrder))

        // Identical viewports preserve cache contents; any bound change clears
        // all values and accounting before the new viewport becomes current.
        precondition(!cache.setViewport(viewportA) && cache.contains("k0"))
        precondition(cache.setViewport(viewportB))
        precondition(cache.viewport == viewportB && cache.isEmpty && cache.totalCost == 0)

        // Cost pressure can evict more than one old entry deterministically.
        let tiny = NativeRadarFrameCachePolicy(maximumEntries: 6, maximumCost: 10)!
        var bounded = NativeRadarFrameCache<String, String>(policy: tiny)
        precondition(bounded.insert("a", for: "a", cost: 4))
        precondition(bounded.insert("b", for: "b", cost: 4))
        precondition(bounded.insert("c", for: "c", cost: 7))
        precondition(bounded.keysInLeastToMostRecentlyUsedOrder == ["c"])
        precondition(bounded.totalCost == 7)
        precondition(bounded.removeValue(for: "c") == "c")
        precondition(bounded.isEmpty && bounded.totalCost == 0)

        print("PASS Native radar frame cache: six-entry/eight-MiB bounds, deterministic LRU, recency, transactional replacement rejection, cost eviction, viewport invalidation, and non-Sendable values")
    }
}
