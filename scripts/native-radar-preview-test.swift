import Foundation

@main enum NativeRadarPreviewTests {
    static func main() {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let camera = NativeRadarPreviewPolicy.camera(latitude: 38.72, longitude: -89.95, width: 369, height: 190)!
        precondition(camera.width == 372 && camera.height == 192 && camera.scale == 2 && camera.zoom == 6.8)
        precondition(camera.west < camera.longitude && camera.east > camera.longitude)
        precondition(camera.south < camera.latitude && camera.north > camera.latitude)
        // Web-Mercator geometry uses the same512-point world and zoom as the
        // snapshot camera, with an exact center rather than degrees-per-pixel.
        func mercator(_ latitude: Double) -> Double { log(tan(.pi / 4 + latitude * .pi / 360)) }
        let center = (mercator(camera.south) + mercator(camera.north)) / 2
        precondition(abs(center - mercator(camera.latitude)) < 1e-12)
        let world = 512 * pow(2.0, camera.zoom)
        precondition(abs((camera.east - camera.west) / 360 * world - camera.width) < 1e-8)
        precondition(abs((mercator(camera.north) - mercator(camera.south)) / (2 * .pi) * world - camera.height) < 1e-8)
        precondition(NativeRadarPreviewPolicy.camera(latitude: 38.72, longitude: -89.95, width: 370, height: 191) == camera)
        for args in [(Double.nan, 0.0, 300.0, 180.0), (86.0, 0.0, 300.0, 180.0),
                     (0.0, 181.0, 300.0, 180.0), (0.0, 0.0, Double.infinity, 180.0),
                     (0.0, 0.0, 0.0, 180.0), (0.0, 0.0, 300.0, 0.0)] {
            precondition(NativeRadarPreviewPolicy.camera(latitude: args.0, longitude: args.1, width: args.2, height: args.3) == nil)
        }
        let capped = NativeRadarPreviewPolicy.camera(latitude: 80, longitude: 179.99, width: 4000, height: 2000)!
        precondition(capped.width == 600 && capped.height == 320 && capped.east <= 180 && capped.north <= 85)

        var generation = NativeRadarPreviewPolicy.Generation()
        let firstPlace = generation.next()
        precondition(generation.accepts(firstPlace))
        let secondPlace = generation.next()
        precondition(!generation.accepts(firstPlace) && generation.accepts(secondPlace), "A late old-place completion may publish")
        _ = generation.next() // offscreen or explicit cancellation
        precondition(!generation.accepts(secondPlace), "Canceled preview completion may publish")

        func key(_ source: String, place: String = "place-a", style: String = "streets-hash",
                 camera: NativeRadarPreviewPolicy.Camera = camera) -> NativeRadarPreviewPolicy.Key {
            .init(place: place, camera: camera, source: source, style: style)
        }
        var cache = NativeRadarPreviewCache<String>()
        func insert(_ value: String, cost: Int = 100, sourceTime: Date = now, at instant: Date = now) {
            cache.insert(value, for: key(value), cost: cost, sourceTime: sourceTime, maximumSourceAge: 2100, now: instant)
        }
        insert("scan-a")
        precondition(cache.value(for: key("scan-a"), now: now) == "scan-a")
        precondition(cache.value(for: key("different-scan"), now: now) == nil)
        precondition(cache.value(for: key("scan-a", place: "place-b"), now: now) == nil)
        precondition(cache.value(for: key("scan-a", style: "new-style-hash"), now: now) == nil)
        let otherSize = NativeRadarPreviewPolicy.camera(latitude: 38.72, longitude: -89.95, width: 400, height: 190)!
        precondition(cache.value(for: key("scan-a", camera: otherSize), now: now) == nil)
        precondition(cache.recent(place: "place-a", camera: camera, now: now.addingTimeInterval(119)) == "scan-a")
        precondition(cache.recent(place: "place-a", camera: camera, now: now.addingTimeInterval(120)) == nil)
        precondition(cache.cost == 0 && cache.count == 0)

        insert("scan-a"); insert("scan-b"); insert("scan-c"); insert("scan-d")
        _ = cache.value(for: key("scan-a"), now: now)
        insert("scan-e")
        precondition(cache.count == 4 && cache.cost == 400)
        precondition(cache.value(for: key("scan-b"), now: now) == nil, "LRU did not evict oldest preview")
        precondition(cache.value(for: key("scan-a"), now: now) == "scan-a")
        cache.removeAll()
        insert("scan-a", cost: 8 * 1024 * 1024)
        insert("scan-b", cost: 8 * 1024 * 1024)
        precondition(cache.count == 1 && cache.cost == 8 * 1024 * 1024)
        insert("too-big", cost: NativeRadarPreviewPolicy.maximumBytes + 1)
        precondition(cache.count == 1 && cache.value(for: key("too-big"), now: now) == nil)
        cache.removeAll()
        insert("future", sourceTime: now.addingTimeInterval(1))
        insert("stale", sourceTime: now.addingTimeInterval(-2101))
        precondition(cache.count == 0, "Future/stale source image was retained")
        insert("almost-old", sourceTime: now.addingTimeInterval(-2099))
        precondition(cache.value(for: key("almost-old"), now: now.addingTimeInterval(2)) == nil,
                     "Source freshness was extended by snapshot cache time")
        insert("rollback")
        precondition(cache.value(for: key("rollback"), now: now.addingTimeInterval(-1)) == nil)
        insert("pressure")
        cache.removeAll()
        precondition(cache.count == 0 && cache.cost == 0)
        print("PASS Today radar preview: bounded Mercator camera/scale, size quantization, old-place and cancellation generation gates, exact snapshot identity, fresh revisibility reuse, source-time expiry, clock rollback, LRU/count/byte caps and purge")
    }
}
