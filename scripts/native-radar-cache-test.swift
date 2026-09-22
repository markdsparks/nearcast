import Foundation

private final class FrameValue {
    let label: String
    init(_ label: String) { self.label = label }
}

@main
enum NativeRadarFrameCacheTests {
    static func main() {
        multiAreaTests()
        let mebibyte = 1_024 * 1_024
        let standard = NativeRadarFrameCachePolicy.nativeRadar
        precondition(standard.maximumEntries == 6)
        precondition(standard.maximumCost == 12 * mebibyte)
        precondition(NativeRadarFrameCachePolicy(maximumEntries: 0, maximumCost: 1) == nil)
        precondition(NativeRadarFrameCachePolicy(maximumEntries: 1, maximumCost: 0) == nil)
        let source = NativeRadarObservedFrameIdentity(sourceKey: "mrms/scan.grib2.gz", byteLength: 1024, validTimeMilliseconds: 1000)
        let revised = NativeRadarObservedFrameIdentity(sourceKey: source.sourceKey, byteLength: 1025, validTimeMilliseconds: 1000)
        let retimed = NativeRadarObservedFrameIdentity(sourceKey: source.sourceKey, byteLength: 1024, validTimeMilliseconds: 2000)
        precondition(source.cacheKey != revised.cacheKey && source.cacheKey != retimed.cacheKey)
        var identityCache = NativeRadarFrameCache<String, String>()
        identityCache.insert("old scan", for: source.cacheKey, cost: 10)
        precondition(identityCache.value(for: revised.cacheKey) == nil && identityCache.value(for: retimed.cacheKey) == nil)
        identityCache.insert("replacement scan", for: revised.cacheKey, cost: 10)
        precondition(identityCache.value(for: source.cacheKey) == "old scan")
        precondition(identityCache.value(for: revised.cacheKey) == "replacement scan")
        print("PASS Native rendered radar identity: source path, advertised length and exact source time distinguish replacement scans")
        let dates = (0..<8).map { Date(timeIntervalSince1970: Double($0) * 900) }
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: dates[3], cached: [], playing: false) == [dates[4], dates[2]])
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: dates[3], cached: [], playing: true) == [dates[4], dates[5]])
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: dates[3], cached: [dates[4], dates[2]], playing: false) == [dates[5], dates[1]])
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: dates[7], cached: [], playing: true).isEmpty)
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: dates[0], cached: [], playing: false) == [dates[1], dates[2]])
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: Date(timeIntervalSince1970: 1), cached: [], playing: false).isEmpty)
        precondition(NativeRadarPrefetchPolicy.targets(dates: dates, selected: dates[3], cached: Set(dates), playing: false).isEmpty)
        let gap = [dates[0], Date(timeIntervalSince1970: 7200)]
        precondition(NativeRadarPrefetchPolicy.targets(dates: gap, selected: dates[0], cached: [], playing: false).isEmpty)
        precondition(NativeRadarPrefetchPolicy.targets(dates: Array(dates.reversed()) + dates, selected: dates[3], cached: [], playing: false) == [dates[4], dates[2]])
        precondition(NativeRadarPrefetchPolicy.targets(dates: Array(repeating: dates[0], count: 129), selected: dates[0], cached: [], playing: false).isEmpty)
        // Inserting warmed neighbors stays inside the same memory budget and
        // keeps the just-used selected frame resident.
        var warmCache = NativeRadarFrameCache<Date, String>()
        for date in dates.prefix(6) { warmCache.insert("frame", for: date, cost: mebibyte) }
        _ = warmCache.value(for: dates[3])
        for date in dates.suffix(2) { warmCache.insert("warm", for: date, cost: mebibyte) }
        precondition(warmCache.count == 6 && warmCache.contains(dates[3]))
        print("PASS Native radar prefetch: two-neighbor cap, forward playback, cached exclusion, exact times, gaps, endpoints and shared memory budget")

        // This reference type deliberately has no Sendable conformance. UIKit
        // images can be cached the same way while the owner stays on MainActor.
        // Exercise generic eviction with an intentionally smaller budget than
        // the production cache, which now fits all six padded source frames.
        var cache = NativeRadarFrameCache<String, FrameValue>(policy:
            .init(maximumEntries: 6, maximumCost: 8 * mebibyte)!)
        let viewportA = NativeRadarFrameCacheViewport(west: -91, south: 37, east: -88, north: 40)
        let viewportB = NativeRadarFrameCacheViewport(west: -90.5, south: 37, east: -87.5, north: 40)
        let envelope = NativeRadarCoveragePolicy.envelope(for: viewportA, zoom: 6.8, retaining: nil)!
        precondition(envelope.bounds.contains(viewportA) && envelope.qualityZoom == 6.5)
        let nearPan = NativeRadarFrameCacheViewport(west: -90.8, south: 37.2, east: -87.8, north: 40.2)
        let retained = NativeRadarCoveragePolicy.envelope(for: nearPan, zoom: 6.9, retaining: envelope)!
        precondition(retained == envelope)
        let distantPan = NativeRadarFrameCacheViewport(west: -88, south: 37, east: -85, north: 40)
        let moved = NativeRadarCoveragePolicy.envelope(for: distantPan, zoom: 6.8, retaining: envelope)!
        precondition(moved != envelope && moved.bounds.contains(distantPan))
        let zoomed = NativeRadarCoveragePolicy.envelope(for: viewportA, zoom: 7.1, retaining: envelope)!
        precondition(zoomed != envelope && zoomed.qualityZoom == 7)
        // Padding does not turn a supported forecast request into an invalid
        // >14-degree field. World/pole edges are clamped, never wrapped/stretched.
        let wide = NativeRadarFrameCacheViewport(west: -100, south: 25, east: -86, north: 39)
        let wideEnvelope = NativeRadarCoveragePolicy.envelope(for: wide, zoom: 4, retaining: nil)!
        precondition(wideEnvelope.bounds == wide)
        let edge = NativeRadarFrameCacheViewport(west: 176, south: 80, east: 179.9, north: 84.9)
        let edgeEnvelope = NativeRadarCoveragePolicy.envelope(for: edge, zoom: 5, retaining: nil)!
        precondition(edgeEnvelope.bounds.contains(edge) && edgeEnvelope.bounds.east <= 180 && edgeEnvelope.bounds.north <= 85)
        let invalid = NativeRadarFrameCacheViewport(west: 179, south: 0, east: -179, north: 1)
        precondition(NativeRadarCoveragePolicy.envelope(for: invalid, zoom: 6, retaining: nil) == nil)
        precondition(NativeRadarCoveragePolicy.envelope(for: viewportA, zoom: .nan, retaining: nil) == nil)
        precondition(NativeRadarCoveragePolicy.envelope(for: viewportA, zoom: 99, retaining: nil) == nil)
        precondition(envelope.bounds.east - envelope.bounds.west <= (viewportA.east - viewportA.west) * 1.3125 + 1e-9)
        precondition(envelope.bounds.north - envelope.bounds.south <= (viewportA.north - viewportA.south) * 1.3125 + 1e-9)
        let renderBytes = NativeRadarCoveragePolicy.pixelWidth * NativeRadarCoveragePolicy.pixelHeight * 6
        precondition(renderBytes <= standard.maximumCost && renderBytes * 6 <= standard.maximumCost)
        var envelopeCache = NativeRadarFrameCache<Int, String>()
        envelopeCache.setViewport(envelope.bounds)
        for index in 0..<6 { envelopeCache.insert("weather", for: index, cost: renderBytes) }
        precondition(envelopeCache.count == 6 && envelopeCache.totalCost <= standard.maximumCost)
        // A whole loop plus a nearby pan stays cache-resident with no reloads.
        for _ in 0..<2 {
            for index in 0..<6 { precondition(envelopeCache.value(for: index) == "weather") }
        }
        precondition(!envelopeCache.setViewport(retained.bounds) && envelopeCache.count == 6)
        envelopeCache.insert("next", for: 6, cost: renderBytes)
        precondition(envelopeCache.count == 6 && !envelopeCache.contains(0))
        precondition(envelopeCache.setViewport(moved.bounds) && envelopeCache.isEmpty)
        print("PASS Native radar coverage: padded nearby-pan reuse, zoom quality buckets, geographic limits, true bounds, forecast span cap, density and six-frame loop reuse within twelve-MiB cap")
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

        print("PASS Native radar frame cache: six-entry/twelve-MiB production bounds, deterministic LRU, recency, transactional replacement rejection, cost eviction, viewport invalidation, and non-Sendable values")
    }

    static func multiAreaTests() {
        let observedPolicy = NativeRadarFrameCachePolicy.observedAreas
        let forecastPolicy = NativeRadarFrameCachePolicy.forecastRenderedAreas
        let evidencePolicy = NativeRadarFrameCachePolicy.transitionEvidence
        precondition(NativeRadarFrameCachePolicy.multiAreaMaximumCost == 64 * 1_024 * 1_024)
        precondition(observedPolicy.maximumEntries == 8 && forecastPolicy.maximumEntries == 30 && evidencePolicy.maximumEntries == 12)
        let visibleA = NativeRadarFrameCacheViewport(west: -91, south: 37, east: -88, north: 40)
        let visibleB = NativeRadarFrameCacheViewport(west: -87, south: 40, east: -84, north: 43)
        let nearbyA = NativeRadarFrameCacheViewport(west: -90.9, south: 37.1, east: -87.9, north: 40.1)
        let wideA = NativeRadarFrameCacheViewport(west: -94, south: 34, east: -85, north: 43)
        var history = NativeRadarCoverageHistory()
        let a = history.envelope(for: visibleA, zoom: 6.8)!
        let b = history.envelope(for: visibleB, zoom: 6.8)!
        precondition(a.cacheKey != b.cacheKey && history.count == 2)
        let returnA = history.envelope(for: nearbyA, zoom: 6.9)!
        precondition(returnA == a && returnA.cacheKey == a.cacheKey && history.count == 2)
        let wide = history.envelope(for: wideA, zoom: 5.8)!
        precondition(wide.cacheKey != a.cacheKey)
        precondition(history.envelope(for: visibleA, zoom: 6.8) == a && history.count == 3)
        let invalid = NativeRadarFrameCacheViewport(west: 179, south: 0, east: -179, north: 1)
        let beforeInvalid = history.envelopesInLeastToMostRecentlyUsedOrder
        precondition(history.envelope(for: invalid, zoom: 6) == nil)
        precondition(history.envelope(for: visibleA, zoom: .infinity) == nil)
        precondition(history.envelopesInLeastToMostRecentlyUsedOrder == beforeInvalid)
        // Exact keys never round distinct coverage/quality into the same image.
        let slight = NativeRadarCoveragePolicy.Envelope(bounds: .init(west: a.bounds.west.nextUp,
            south: a.bounds.south, east: a.bounds.east, north: a.bounds.north), qualityZoom: a.qualityZoom)
        precondition(slight.cacheKey != a.cacheKey)
        let quality = NativeRadarCoveragePolicy.Envelope(bounds: a.bounds, qualityZoom: a.qualityZoom + 0.5)
        precondition(quality.cacheKey != a.cacheKey)
        let zero = NativeRadarCoveragePolicy.Envelope(bounds: .init(west: 0, south: 0, east: 1, north: 1), qualityZoom: 0)
        let negativeZero = NativeRadarCoveragePolicy.Envelope(bounds: .init(west: -0.0, south: -0.0, east: 1, north: 1), qualityZoom: -0.0)
        precondition(zero.cacheKey == negativeZero.cacheKey)

        let pixels = NativeRadarCoveragePolicy.pixelWidth * NativeRadarCoveragePolicy.pixelHeight
        let observedBytes = pixels * 6 // RGBA + original values + coverage mask.
        let finalBytes = pixels * 4 + (pixels + 7) / 8 // RGBA + packed coverage.
        let evidenceBytes = pixels * 2 // Original values + coverage mask only.
        func key(_ area: NativeRadarCoveragePolicy.Envelope, _ slot: Int, source: String = "cycle-A") -> String {
            "\(source)|\(slot)|\(area.cacheKey)"
        }
        var observed = NativeRadarFrameCache<String, String>(policy: observedPolicy)
        var finished = NativeRadarFrameCache<String, String>(policy: forecastPolicy)
        var evidence = NativeRadarFrameCache<String, String>(policy: evidencePolicy)
        // Multi-area stores never invoke setViewport: identity is part of each
        // key. Returning to A after B and a zoom-out keeps the original pixels.
        for index in 0..<6 { precondition(observed.insert("A-\(index)", for: key(a, index), cost: observedBytes)) }
        observed.insert("B", for: key(b, 0), cost: observedBytes)
        observed.insert("wide", for: key(wide, 0), cost: observedBytes)
        for index in 0..<6 { precondition(observed.value(for: key(returnA, index)) == "A-\(index)") }
        precondition(observed.count == 8 && observed.totalCost <= observedPolicy.maximumCost)
        precondition(observed.value(for: key(a, 0, source: "cycle-B")) == nil)

        // The entire 24-frame six-hour forecast remains warm across multiple
        // loops, with space for briefly visited areas/zoom levels as well.
        for index in 0..<24 { precondition(finished.insert("forecast-\(index)", for: key(a, index), cost: finalBytes)) }
        finished.insert("B", for: key(b, 0), cost: finalBytes)
        finished.insert("wide", for: key(wide, 0), cost: finalBytes)
        for _ in 0..<3 {
            for index in 0..<24 { precondition(finished.value(for: key(returnA, index)) == "forecast-\(index)") }
        }
        precondition(finished.count == 26 && finished.totalCost <= forecastPolicy.maximumCost)
        // Broader exploration eventually evicts old areas through byte LRU,
        // not an unbounded second full forecast loop for every visited place.
        for index in 0..<48 { finished.insert("B-\(index)", for: key(b, index), cost: finalBytes) }
        precondition(finished.count <= forecastPolicy.maximumEntries && finished.totalCost <= forecastPolicy.maximumCost)
        precondition(finished.value(for: key(a, 0)) == nil)
        for index in 0..<30 { evidence.insert("sample", for: key(a, index), cost: evidenceBytes) }
        precondition(evidence.count <= evidencePolicy.maximumEntries && evidence.totalCost <= evidencePolicy.maximumCost)
        precondition(observed.totalCost + finished.totalCost + evidence.totalCost <= NativeRadarFrameCachePolicy.multiAreaMaximumCost)

        // App-lifetime owners can purge all retained imagery on memory pressure
        // without changing their policy or permanently disabling future reuse.
        observed.removeAll(); finished.removeAll(); evidence.removeAll(); history.removeAll()
        precondition(observed.totalCost == 0 && finished.totalCost == 0 && evidence.totalCost == 0 && history.count == 0)
        precondition(finished.insert("new", for: key(a, 0), cost: finalBytes))
        precondition(finished.value(for: key(a, 0)) == "new")

        var smallHistory = NativeRadarCoverageHistory(maximumEntries: 2)
        _ = smallHistory.envelope(for: visibleA, zoom: 6.8)
        _ = smallHistory.envelope(for: visibleB, zoom: 6.8)
        _ = smallHistory.envelope(for: nearbyA, zoom: 6.9)
        _ = smallHistory.envelope(for: wideA, zoom: 5.8)
        precondition(smallHistory.count == 2)
        precondition(smallHistory.envelopesInLeastToMostRecentlyUsedOrder.contains(a))
        precondition(!smallHistory.envelopesInLeastToMostRecentlyUsedOrder.contains(b))
        precondition(NativeRadarCoverageHistory(maximumEntries: 1000).maximumEntries == 16)
        precondition(NativeRadarCoverageHistory(maximumEntries: 0).maximumEntries == 1)
        print("PASS Native multi-area cache: A-B-A and zoom-out/back identity, exact area/quality keys, complete 24-frame loops plus visited areas, 64-MiB aggregate model budget, LRU eviction and pressure purge/recovery")
    }
}
