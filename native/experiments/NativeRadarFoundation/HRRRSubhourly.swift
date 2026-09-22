import Foundation

/// Native counterpart of the existing hrrr-subhourly-adapter/worker. Real
/// advertised REFC records only: no interpolated or relabeled hourly frames.
enum HRRRSubhourly {
    enum Failure: Error { case invalidIndex, unavailable, malformed, unsupported, timeMismatch, coverage }
    static let origin = URL(string: "https://noaa-hrrr-bdp-pds.s3.amazonaws.com")!
    struct Frame: Sendable, Equatable {
        let url: URL
        let range: ClosedRange<Int>
        let cycle: Date
        let leadMinutes: Int
        var validTime: Date { cycle.addingTimeInterval(Double(leadMinutes) * 60) }
    }
    static func urls(cycle: Date, hour: Int) throws -> (data: URL, index: URL) {
        guard cycle.timeIntervalSince1970.isFinite, (1...18).contains(hour) else { throw Failure.invalidIndex }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "yyyyMMdd"; let day = f.string(from: cycle)
        f.dateFormat = "HH"; let h = f.string(from: cycle)
        let path = "hrrr.\(day)/conus/hrrr.t\(h)z.wrfsubhf\(String(format: "%02d", hour)).grib2"
        let data = origin.appendingPathComponent(path)
        return (data, URL(string: data.absoluteString + ".idx")!)
    }
    static func parseIndex(_ data: Data, cycle: Date, hour: Int) throws -> [Frame] {
        guard data.count <= 2 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else { throw Failure.invalidIndex }
        let url = try urls(cycle: cycle, hour: hour).data
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyyMMddHH"
        let stamp = "d=" + f.string(from: cycle)
        let rows = text.split(whereSeparator: \.isNewline).map { $0.split(separator: ":", omittingEmptySubsequences: false).map(String.init) }
        guard (2...10000).contains(rows.count) else { throw Failure.invalidIndex }
        var offsets: [Int] = []
        for row in rows {
            guard row.count >= 6, let offset = Int(row[1]), (0..<2_000_000_000).contains(offset),
                  offsets.last.map({ offset > $0 }) ?? true else { throw Failure.invalidIndex }
            offsets.append(offset)
        }
        var result: [Frame] = []
        for i in 0..<(rows.count - 1) {
            let row = rows[i]
            guard row[3] == "REFC", row[4] == "entire atmosphere" else { continue }
            guard row[2] == stamp, row[5].hasSuffix(" min fcst"),
                  let minutes = Int(row[5].dropLast(9)), minutes > 0, minutes <= 1080, minutes % 15 == 0,
                  (minutes + 59) / 60 == hour else { throw Failure.invalidIndex }
            let range = offsets[i]...(offsets[i + 1] - 1)
            guard range.count <= 4 * 1024 * 1024 else { throw Failure.invalidIndex }
            result.append(.init(url: url, range: range, cycle: cycle, leadMinutes: minutes))
        }
        guard result.count == 4, Set(result.map(\.leadMinutes)).count == 4 else { throw Failure.invalidIndex }
        return result.sorted { $0.validTime < $1.validTime }
    }

    /// Bounds-checked big-endian section reader; no untrusted offsets escape it.
    private struct Bytes {
        let b: [UInt8]
        func u(_ offset: Int, _ count: Int = 1) throws -> Int {
            guard offset >= 0, (1...8).contains(count), offset <= b.count - count else { throw Failure.malformed }
            var value: UInt64 = 0
            for x in b[offset..<(offset + count)] { value = value << 8 | UInt64(x) }
            guard value <= UInt64(Int.max) else { throw Failure.malformed }
            return Int(value)
        }
        func sm(_ offset: Int, _ count: Int) throws -> Int {
            let value = try u(offset, count), sign = 1 << (count * 8 - 1)
            return value & sign == 0 ? value : -(value & (sign - 1))
        }
        func signed32(_ offset: Int) throws -> Double { Double(Int32(bitPattern: UInt32(try u(offset, 4)))) }
    }
    private struct Bits {
        let bytes: Bytes
        var position: Int
        mutating func read(_ count: Int) throws -> Int {
            guard (0...31).contains(count), position <= bytes.b.count * 8 - count else { throw Failure.malformed }
            var value = 0
            for _ in 0..<count {
                value = value << 1 | Int((bytes.b[position / 8] >> (7 - position % 8)) & 1); position += 1
            }
            return value
        }
        mutating func align() { position = (position + 7) / 8 * 8 }
    }
    static func decode(_ data: Data, frame: Frame, bounds: NativeRadarPresentationContract.Viewport,
                       width: Int = 384, height: Int = 512) throws -> NativeRadarSeamEstimation.Frame {
        guard data.count == frame.range.count, data.count >= 20, data.count <= 4 * 1024 * 1024,
              width > 0, height > 0, width <= 1024, height <= 1024 else { throw Failure.malformed }
        let raw = Bytes(b: Array(data))
        guard Array(raw.b.prefix(4)) == Array("GRIB".utf8), try raw.u(7) == 2,
              try raw.u(8, 8) == data.count, Array(raw.b.suffix(4)) == Array("7777".utf8) else { throw Failure.malformed }
        var sections: [Int: Bytes] = [:], offset = 16
        while offset < data.count - 4 {
            let length = try raw.u(offset, 4), number = try raw.u(offset + 4)
            guard length >= 5, length <= data.count - 4 - offset, (1...7).contains(number), sections[number] == nil else { throw Failure.malformed }
            sections[number] = Bytes(b: Array(raw.b[offset..<(offset + length)])); offset += length
        }
        guard offset == data.count - 4, let id = sections[1], let grid = sections[3], let product = sections[4],
              let rep = sections[5], let bitmap = sections[6], let payload = sections[7],
              try bitmap.u(5) == 255, try grid.u(12, 2) == 30, try grid.u(14) == 6,
              try product.u(7, 2) == 0, try rep.u(9, 2) == 3 else { throw Failure.unsupported }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let dc = try DateComponents(year: id.u(12, 2), month: id.u(14), day: id.u(15), hour: id.u(16), minute: id.u(17), second: id.u(18))
        guard let cycle = calendar.date(from: dc), cycle == frame.cycle else { throw Failure.timeMismatch }
        let unit = try product.u(17), lead = try product.u(18, 4)
        guard unit == 0 || unit == 1, lead * (unit == 1 ? 60 : 1) == frame.leadMinutes else { throw Failure.timeMismatch }
        let ni = try grid.u(30, 4), nj = try grid.u(34, 4), points = try grid.u(6, 4)
        guard (1...3_000_000).contains(ni), (1...3_000_000).contains(nj), ni * nj == points,
              points <= 3_000_000, try rep.u(5, 4) == points else { throw Failure.malformed }
        let scan = try grid.u(64)
        guard scan & 0x30 == 0 else { throw Failure.unsupported }
        let lat0 = try grid.signed32(47) / 1e6, lon0Raw = try grid.signed32(51) / 1e6
        let lat1 = try grid.signed32(65) / 1e6, lat2 = try grid.signed32(69) / 1e6
        // Restrict to the actual HRRR projection instead of accepting arbitrary
        // untested Lambert metadata from a remote record.
        guard lat0 == 38.5, lat1 == 38.5, lat2 == 38.5, lon0Raw == 262.5 || lon0Raw == -97.5 else { throw Failure.unsupported }
        let projection = try HRRRZarrContract.Projection(data: Data(#"{"proj":"lcc","a":6371229,"b":6371229,"lon_0":262.5,"lat_0":38.5,"lat_1":38.5,"lat_2":38.5}"#.utf8))
        let startLat = try grid.signed32(38) / 1e6, rawLon = try grid.signed32(42) / 1e6
        let originPoint = try projection.project(.init(longitude: rawLon > 180 ? rawLon - 360 : rawLon, latitude: startLat))
        let dx = Double(try grid.u(55, 4)) / 1000, dy = Double(try grid.u(59, 4)) / 1000
        guard dx == 3000, dy == 3000 else { throw Failure.unsupported }
        let order = try rep.u(47), octets = try rep.u(48), groups = try rep.u(31, 4)
        let referenceBits = try rep.u(19), widthBits = try rep.u(36), lengthBits = try rep.u(46)
        guard (1...2).contains(order), points >= order, (1...4).contains(octets), (1...points).contains(groups),
              referenceBits <= 31, widthBits <= 31, lengthBits <= 31, try rep.u(22) == 0 else { throw Failure.unsupported }
        var initial: [Int64] = []
        for i in 0..<order { initial.append(Int64(try payload.sm(5 + i * octets, octets))) }
        let minimum = Int64(try payload.sm(5 + order * octets, octets))
        var bits = Bits(bytes: payload, position: (5 + (order + 1) * octets) * 8)
        var references = [Int](), widths = [Int](), lengths = [Int]()
        for group in 0..<groups {
            if group % 4096 == 0 { try Task.checkCancellation() }
            references.append(try bits.read(referenceBits))
        }; bits.align()
        let baseWidth = try rep.u(35)
        for group in 0..<groups {
            if group % 4096 == 0 { try Task.checkCancellation() }
            let value = try baseWidth + bits.read(widthBits)
            guard value <= 31 else { throw Failure.malformed }; widths.append(value)
        }; bits.align()
        let baseLength = try rep.u(37, 4), increment = try rep.u(41), lastLength = try rep.u(42, 4)
        var total = 0
        for i in 0..<groups {
            if i % 4096 == 0 { try Task.checkCancellation() }
            let scaled = try bits.read(lengthBits)
            let length = i == groups - 1 ? lastLength : baseLength + scaled * increment
            guard length <= points - total else { throw Failure.malformed }
            total += length; lengths.append(length)
        }; bits.align()
        guard total == points else { throw Failure.malformed }
        var values = [Int64](); values.reserveCapacity(points)
        for g in 0..<groups {
            try Task.checkCancellation()
            for index in 0..<lengths[g] {
                if index % 4096 == 0 { try Task.checkCancellation() }
                let value = try references[g] + bits.read(widths[g])
                guard value <= Int32.max else { throw Failure.malformed }; values.append(Int64(value))
            }
        }
        for i in 0..<order { values[i] = initial[i] }
        for i in order..<points {
            if i % 4096 == 0 { try Task.checkCancellation() }
            values[i] += minimum + (order == 1 ? values[i - 1] : 2 * values[i - 1] - values[i - 2])
            guard abs(values[i]) <= 10_000_000 else { throw Failure.malformed }
        }
        let reference = Double(Float(bitPattern: UInt32(try rep.u(11, 4))))
        let binary = try rep.sm(15, 2), decimal = try rep.sm(17, 2)
        guard reference.isFinite, (-32...32).contains(binary), (-12...12).contains(decimal) else { throw Failure.malformed }
        let scale = pow(2.0, Double(binary)), decimalScale = pow(10.0, -Double(decimal))
        var pixels = [UInt8](repeating: 0, count: width * height), mask = pixels
        let encoding = try RadarNumericContract.Encoding()
        for y in 0..<height {
            try Task.checkCancellation()
            for x in 0..<width {
                let point = try bounds.pixelCenter(column: x, row: y, width: width, height: height)
                let projected = try projection.project(.init(longitude: point.longitude, latitude: point.latitude))
                let sx = (projected.x - originPoint.x) / (dx * (scan & 0x80 == 0 ? 1 : -1))
                let sy = (projected.y - originPoint.y) / (dy * (scan & 0x40 != 0 ? 1 : -1))
                guard sx >= 0, sy >= 0, sx <= Double(ni - 1), sy <= Double(nj - 1) else { continue }
                let x0 = Int(sx), y0 = Int(sy), x1 = min(ni - 1, x0 + 1), y1 = min(nj - 1, y0 + 1)
                let tx = sx - Double(x0), ty = sy - Double(y0)
                let top = Double(values[y0 * ni + x0]) * (1 - tx) + Double(values[y0 * ni + x1]) * tx
                let bottom = Double(values[y1 * ni + x0]) * (1 - tx) + Double(values[y1 * ni + x1]) * tx
                let dbz = (reference + (top * (1 - ty) + bottom * ty) * scale) * decimalScale
                guard dbz.isFinite else { continue }
                mask[y * width + x] = 1
                if dbz >= encoding.threshold { pixels[y * width + x] = try RadarNumericContract.encodeDbz(dbz, encoding: encoding) }
            }
        }
        guard mask.contains(1) else { throw Failure.coverage }
        return try .init(texture: .init(width: width, height: height, bytes: pixels),
            bounds: .init(minLat: bounds.south, minLon: bounds.west, maxLat: bounds.north, maxLon: bounds.east),
            encoding: encoding, validTime: RadarNumericContract.isoTime(Int64(frame.validTime.timeIntervalSince1970 * 1000)), validDataMask: mask)
    }
}

final class HRRRSubhourlyClient: Sendable {
    private let transport: RadarChunkClient
    private let metadataTransport: RadarChunkClient
    private let cache: HRRRSubhourlyCache
    init(configuration: URLSessionConfiguration = .ephemeral, cache: HRRRSubhourlyCache = .shared) throws {
        transport = try RadarChunkClient(allowedOrigins: [HRRRSubhourly.origin], configuration: configuration)
        self.cache = cache
        // A two-index metadata batch must not consume the selected frame's two
        // acquisition slots during refresh/playback. Both lanes remain bounded
        // and use the same origin-only, credential-free transport policy.
        metadataTransport = try RadarChunkClient(allowedOrigins: [HRRRSubhourly.origin], configuration: configuration)
    }
    func discover(now: Date) async throws -> [HRRRSubhourly.Frame] {
        guard now.timeIntervalSince1970.isFinite else { throw HRRRSubhourly.Failure.invalidIndex }
        let first = floor(now.timeIntervalSince1970 / 900) * 900 + 900
        let targets = (0..<24).map { Date(timeIntervalSince1970: first + Double($0) * 900) }
        for age in 0..<3 {
            try Task.checkCancellation()
            let cycle = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / 3600) * 3600 - Double(age) * 3600)
            do {
                let hours = Set(targets.map { Int(ceil($0.timeIntervalSince(cycle) / 3600)) }).sorted()
                var result: [HRRRSubhourly.Frame] = []
                // Independent advertised-hour indexes can arrive together. Keep
                // exactly two requests in flight, matching the transport limit;
                // a partial cycle still fails as a whole and is never published.
                for start in stride(from: 0, to: hours.count, by: 2) {
                    try Task.checkCancellation()
                    let batch = Array(hours[start..<min(hours.count, start + 2)])
                    result += try await withThrowingTaskGroup(of: [HRRRSubhourly.Frame].self) { group in
                        for hour in batch {
                            group.addTask { [metadataTransport] in
                                let urls = try HRRRSubhourly.urls(cycle: cycle, hour: hour)
                                let data = try await metadataTransport.fetchBytes(at: urls.index, maximumBytes: 2 * 1024 * 1024)
                                return try HRRRSubhourly.parseIndex(data, cycle: cycle, hour: hour)
                            }
                        }
                        var frames: [HRRRSubhourly.Frame] = []
                        for try await values in group { frames += values }
                        return frames
                    }
                }
                let selected = result.filter { targets.contains($0.validTime) }.sorted { $0.validTime < $1.validTime }
                guard selected.count == 24 else { throw HRRRSubhourly.Failure.unavailable }
                return selected
            } catch is CancellationError { throw CancellationError() } catch { continue }
        }
        throw HRRRSubhourly.Failure.unavailable
    }
    func load(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarPresentationContract.Viewport,
              width: Int = 384, height: Int = 512,
              priority: HRRRSubhourlyCache.Priority = .foreground) async throws -> NativeRadarSeamEstimation.Frame {
        try await cache.load(frame, bounds: bounds, width: width, height: height, priority: priority,
            fetch: { [transport] in try await transport.fetchRange(at: frame.url, range: frame.range) },
            decode: { try HRRRSubhourly.decode($0, frame: frame, bounds: bounds, width: width, height: height) })
    }
    /// A rendered-frame producer may gain a foreground subscriber without
    /// making a second numeric request. Promote its existing acquisition too.
    func promote(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarPresentationContract.Viewport,
                 width: Int = 384, height: Int = 512) async {
        await cache.promote(frame, bounds: bounds, width: width, height: height)
    }
}

/// App-lifetime, public-source-only acquisition and sampled-field retention.
/// Source ranges are independent of the camera; sampled fields include exact
/// geometry. No national decoded grid is retained. A successful field has only
/// one UInt8 texture and one UInt8 validity mask (24 regular forecast frames fit
/// within the default 24 MiB numeric budget).
actor HRRRSubhourlyCache {
    static let shared = HRRRSubhourlyCache()
    enum Priority: Int, Sendable { case prefetch = 0, foreground = 1 }

    struct SourceKey: Hashable, Sendable {
        let url: String
        let lowerByte: Int, upperByte: Int
        let cycle: Date
        let leadMinutes: Int
        let decoderVersion = 1
        init(_ frame: HRRRSubhourly.Frame) {
            url = frame.url.absoluteString
            lowerByte = frame.range.lowerBound; upperByte = frame.range.upperBound
            cycle = frame.cycle; leadMinutes = frame.leadMinutes
        }
    }
    struct FieldKey: Hashable, Sendable {
        let source: SourceKey
        let west: Double, south: Double, east: Double, north: Double
        let width: Int, height: Int
        init(frame: HRRRSubhourly.Frame, bounds: NativeRadarPresentationContract.Viewport, width: Int, height: Int) {
            source = SourceKey(frame)
            west = bounds.west; south = bounds.south; east = bounds.east; north = bounds.north
            self.width = width; self.height = height
        }
    }
    struct Snapshot: Sendable {
        let source: HRRRWorkCacheStatistics
        let numeric: HRRRWorkCacheStatistics
    }

    private let source: HRRRSharedWorkStore<SourceKey, Data>
    private let numeric: HRRRSharedWorkStore<FieldKey, NativeRadarSeamEstimation.Frame>
    private var generation: UInt64 = 0

    init(sourceByteBudget: Int = 32 * 1024 * 1024, numericByteBudget: Int = 24 * 1024 * 1024,
         maximumEntries: Int = 32, maximumAge: TimeInterval = 30 * 60) {
        source = .init(byteBudget: min(32 * 1024 * 1024, max(0, sourceByteBudget)), maximumEntries: maximumEntries,
                       maximumAge: maximumAge, maximumValueBytes: 4 * 1024 * 1024, cost: { $0.count })
        numeric = .init(byteBudget: min(24 * 1024 * 1024, max(0, numericByteBudget)), maximumEntries: maximumEntries,
                        maximumAge: maximumAge, maximumValueBytes: 2 * 1024 * 1024,
                        cost: { $0.texture.bytes.count + $0.validDataMask.count })
    }

    func load(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarPresentationContract.Viewport,
              width: Int, height: Int, priority: Priority = .foreground,
              fetch: @escaping @Sendable () async throws -> Data,
              decode: @escaping @Sendable (Data) throws -> NativeRadarSeamEstimation.Frame) async throws -> NativeRadarSeamEstimation.Frame {
        try Task.checkCancellation()
        guard (1...1080).contains(frame.leadMinutes), frame.leadMinutes % 15 == 0,
              frame.range.lowerBound >= 0, frame.range.upperBound < 2_000_000_000,
              frame.range.count <= 4 * 1024 * 1024,
              frame.cycle.timeIntervalSince1970.isFinite, frame.cycle.timeIntervalSince1970 >= 0,
              frame.validTime.timeIntervalSince1970 < 253_402_300_800 else { throw HRRRSubhourly.Failure.invalidIndex }
        let expectedURL = try HRRRSubhourly.urls(cycle: frame.cycle, hour: (frame.leadMinutes + 59) / 60).data
        guard frame.url == expectedURL else { throw HRRRSubhourly.Failure.invalidIndex }
        guard (8...1024).contains(width), (8...1024).contains(height) else { throw HRRRSubhourly.Failure.malformed }
        let key = FieldKey(frame: frame, bounds: bounds, width: width, height: height)
        let expectedBounds = RadarChunkContract.Bounds(minLat: bounds.south, minLon: bounds.west,
                                                       maxLat: bounds.north, maxLon: bounds.east)
        try expectedBounds.validate()
        let expectedTime = Int64(frame.validTime.timeIntervalSince1970 * 1000)
        let requestGeneration = generation
        if priority == .foreground { await source.promote(key.source) }
        let lease = try await numeric.acquire(key, priority: priority) { [self, source] jobPriority in
            let bytes = try await source.acquire(key.source, priority: jobPriority) { _ in
                let data = try await fetch()
                try Task.checkCancellation()
                guard data.count == frame.range.count else { throw HRRRSubhourly.Failure.malformed }
                return data
            }
            do {
                try Task.checkCancellation()
                // This closure runs on the shared store's bounded detached job,
                // never on the UI or cache actor. Full GRIB decode precedes raw
                // byte retention, including cycle/time and source-grid checks.
                let field = try decode(bytes.value)
                try Task.checkCancellation()
                guard field.bounds == expectedBounds, field.texture.width == width, field.texture.height == height,
                      field.validTimeMilliseconds == expectedTime else { throw HRRRSubhourly.Failure.timeMismatch }
                // A field queued before memory pressure may only start its
                // source request after the purge. Carry the outer generation
                // as well, so that late request cannot refill raw retention.
                await source.release(bytes, validated: mayRetain(requestGeneration))
                return field
            } catch {
                await source.release(bytes, validated: false)
                throw error
            }
        }
        do {
            try Task.checkCancellation()
            await numeric.release(lease, validated: mayRetain(requestGeneration))
            try Task.checkCancellation()
            return lease.value
        } catch {
            await numeric.release(lease, validated: false)
            throw error
        }
    }

    /// Purge retained values without disrupting current consumers. In-flight
    /// work from before this purge cannot repopulate either completed cache.
    func removeAll() async {
        generation &+= 1
        await numeric.removeAll()
        await source.removeAll()
    }
    /// Only speculative consumers are canceled. A foreground subscriber that
    /// joined the same work keeps the download/decode alive.
    func cancelPrefetch() async { await numeric.cancelPrefetch() }
    func promote(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarPresentationContract.Viewport,
                 width: Int, height: Int) async {
        let key = FieldKey(frame: frame, bounds: bounds, width: width, height: height)
        await numeric.promote(key, protectConsumers: true)
        await source.promote(key.source)
    }
    func snapshot() async -> Snapshot { .init(source: await source.snapshot(), numeric: await numeric.snapshot()) }
    private func mayRetain(_ requestGeneration: UInt64) -> Bool { requestGeneration == generation }
}

/// Counters contain no URL, source key, coordinates, credentials or user data.
struct HRRRWorkCacheStatistics: Sendable {
    let cachedBytes: Int, cachedEntries: Int, activeJobs: Int, queuedJobs: Int, consumers: Int
    let hits: Int, joins: Int, loads: Int, failures: Int, cancellations: Int, promotions: Int, evictions: Int
    let totalLoadMilliseconds: Double
}

/// Two concurrent jobs, a bounded priority queue, consumer-safe cancellation,
/// and validated-only LRU retention. Separate instantiations own source bytes
/// and sampled fields, so one viewport cannot cancel another viewport's bytes.
private actor HRRRSharedWorkStore<Key: Hashable & Sendable, Value: Sendable> {
    typealias Priority = HRRRSubhourlyCache.Priority
    typealias Loader = @Sendable (Priority) async throws -> Value
    struct Lease: Sendable {
        let value: Value
        fileprivate let key: Key
        fileprivate let jobID: UUID?
        fileprivate let consumerID: UUID
    }
    private struct Cached {
        let value: Value, bytes: Int, storedAt: Date
        var access: UInt64
    }
    private struct Consumer {
        let waiter: HRRRWorkWaiter<Lease>
        var priority: Priority
    }
    private struct Job {
        let id: UUID, sequence: UInt64, generation: UInt64, load: Loader
        var priority: Priority
        var task: Task<Void, Never>?
        var consumers: [UUID: Consumer]
        var leases: [UUID: Priority] = [:]
        var value: Value?
    }
    private let byteBudget: Int, maximumEntries: Int, maximumValueBytes: Int
    private let maximumAge: TimeInterval
    private let cost: @Sendable (Value) -> Int
    private var cached: [Key: Cached] = [:], jobs: [Key: Job] = [:]
    private var running: Set<UUID> = []
    private var cachedBytes = 0, hits = 0, joins = 0, loads = 0, failures = 0, cancellations = 0, promotions = 0, evictions = 0
    private var sequence: UInt64 = 0, generation: UInt64 = 0
    private var totalLoadMilliseconds = 0.0

    init(byteBudget: Int, maximumEntries: Int, maximumAge: TimeInterval, maximumValueBytes: Int,
         cost: @escaping @Sendable (Value) -> Int) {
        self.byteBudget = byteBudget
        self.maximumEntries = min(32, max(0, maximumEntries))
        self.maximumAge = maximumAge.isFinite ? min(3600, max(0, maximumAge)) : 0
        self.maximumValueBytes = maximumValueBytes
        self.cost = cost
    }

    func acquire(_ key: Key, priority: Priority, load: @escaping Loader) async throws -> Lease {
        let consumerID = UUID(), waiter = HRRRWorkWaiter<Lease>()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                waiter.attach(continuation)
                guard !waiter.isFinished else { return }
                evictExpired()
                if var hit = cached[key] {
                    hits += 1; sequence &+= 1; hit.access = sequence; cached[key] = hit
                    waiter.finish(.success(.init(value: hit.value, key: key, jobID: nil, consumerID: consumerID)))
                    return
                }
                if var job = jobs[key] {
                    guard job.consumers.count + job.leases.count < 16 else {
                        waiter.finish(.failure(RadarChunkContract.Failure.requestLimit)); return
                    }
                    joins += 1
                    if priority.rawValue > job.priority.rawValue { job.priority = priority; promotions += 1 }
                    if let value = job.value {
                        if waiter.finish(.success(.init(value: value, key: key, jobID: job.id, consumerID: consumerID))) {
                            job.leases[consumerID] = priority
                        }
                    } else { job.consumers[consumerID] = Consumer(waiter: waiter, priority: priority) }
                    jobs[key] = job
                    pump()
                    return
                }
                guard jobs.count < 32 else { waiter.finish(.failure(RadarChunkContract.Failure.requestLimit)); return }
                sequence &+= 1
                jobs[key] = Job(id: UUID(), sequence: sequence, generation: generation, load: load, priority: priority,
                                consumers: [consumerID: Consumer(waiter: waiter, priority: priority)])
                pump()
            }
        }, onCancel: {
            waiter.finish(.failure(CancellationError()))
            Task { await self.cancel(key: key, consumerID: consumerID) }
        })
    }

    func promote(_ key: Key, protectConsumers: Bool = false) {
        guard var job = jobs[key] else { return }
        if job.priority == .prefetch { job.priority = .foreground; promotions += 1 }
        if protectConsumers {
            // This producer now has a foreground consumer in the rendered
            // tier. Keep its single numeric subscription alive; the producer
            // task still owns cancellation when its last render consumer goes.
            for id in job.consumers.keys { job.consumers[id]?.priority = .foreground }
        }
        jobs[key] = job
        pump()
    }

    func release(_ lease: Lease, validated: Bool) {
        guard var job = jobs[lease.key], job.id == lease.jobID,
              job.leases.removeValue(forKey: lease.consumerID) != nil else { return }
        let bytes = cost(lease.value)
        if validated, job.generation == generation, cached[lease.key] == nil,
           maximumEntries > 0, maximumAge > 0, bytes <= byteBudget {
            evictExpired()
            while cached.count >= maximumEntries || cachedBytes > byteBudget - bytes {
                guard let oldest = cached.min(by: { $0.value.access < $1.value.access })?.key else { break }
                remove(oldest)
            }
            sequence &+= 1
            cached[lease.key] = Cached(value: lease.value, bytes: bytes, storedAt: Date(), access: sequence)
            cachedBytes += bytes
        }
        if job.consumers.isEmpty && job.leases.isEmpty { jobs.removeValue(forKey: lease.key) }
        else { jobs[lease.key] = job }
    }

    func removeAll() { generation &+= 1; cached.removeAll(); cachedBytes = 0 }
    func cancelPrefetch() {
        for (key, job) in jobs {
            for (id, consumer) in job.consumers where consumer.priority == .prefetch {
                consumer.waiter.finish(.failure(CancellationError()))
                cancel(key: key, consumerID: id)
            }
        }
    }
    func snapshot() -> HRRRWorkCacheStatistics {
        evictExpired()
        return .init(cachedBytes: cachedBytes, cachedEntries: cached.count, activeJobs: running.count,
                     queuedJobs: jobs.values.filter { $0.task == nil && $0.value == nil }.count,
                     consumers: jobs.values.reduce(0) { $0 + $1.consumers.count + $1.leases.count },
                     hits: hits, joins: joins, loads: loads, failures: failures, cancellations: cancellations,
                     promotions: promotions, evictions: evictions, totalLoadMilliseconds: totalLoadMilliseconds)
    }

    private func pump() {
        while running.count < 2 {
            guard let key = jobs.filter({ $0.value.task == nil && $0.value.value == nil && !$0.value.consumers.isEmpty })
                .min(by: { a, b in
                    a.value.priority == b.value.priority ? a.value.sequence < b.value.sequence : a.value.priority.rawValue > b.value.priority.rawValue
                })?.key, var job = jobs[key] else { return }
            let id = job.id, load = job.load, priority = job.priority
            running.insert(id); loads += 1
            // Speculative work is bounded and ordered by the logical queue.
            // Running at userInitiated avoids leaving a foreground subscriber
            // joined to work at a permanently lower executor priority.
            job.task = Task.detached(priority: .userInitiated) { [self] in
                let start = ContinuousClock.now
                let result: Result<Value, Error>
                do {
                    let value = try await load(priority)
                    try Task.checkCancellation()
                    let bytes = cost(value)
                    guard bytes > 0 && bytes <= maximumValueBytes else { throw HRRRSubhourly.Failure.malformed }
                    result = .success(value)
                } catch { result = .failure(error) }
                let duration = start.duration(to: .now).components
                let milliseconds = Double(duration.seconds) * 1000 + Double(duration.attoseconds) / 1e15
                await complete(key: key, id: id, result: result, milliseconds: milliseconds)
            }
            jobs[key] = job
        }
    }

    private func complete(key: Key, id: UUID, result: Result<Value, Error>, milliseconds: Double) {
        running.remove(id)
        totalLoadMilliseconds += max(0, milliseconds)
        guard var job = jobs[key], job.id == id else { pump(); return }
        job.task = nil
        switch result {
        case .success(let value):
            job.value = value
            for (consumerID, consumer) in job.consumers {
                if consumer.waiter.finish(.success(.init(value: value, key: key, jobID: id, consumerID: consumerID))) {
                    job.leases[consumerID] = consumer.priority
                }
            }
            job.consumers.removeAll()
            if job.leases.isEmpty { jobs.removeValue(forKey: key) }
            else { jobs[key] = job }
        case .failure(let error):
            if error is CancellationError { cancellations += 1 } else { failures += 1 }
            jobs.removeValue(forKey: key)
            for consumer in job.consumers.values { consumer.waiter.finish(.failure(error)) }
        }
        pump()
    }

    private func cancel(key: Key, consumerID: UUID) {
        guard var job = jobs[key] else { return }
        let removed = job.consumers.removeValue(forKey: consumerID) != nil || job.leases.removeValue(forKey: consumerID) != nil
        guard removed else { return }
        if job.consumers.isEmpty && job.leases.isEmpty {
            jobs.removeValue(forKey: key)
            cancellations += 1
            job.task?.cancel()
        } else { jobs[key] = job }
        pump()
    }
    private func evictExpired() {
        let now = Date()
        for (key, entry) in cached where now < entry.storedAt || now.timeIntervalSince(entry.storedAt) >= maximumAge { remove(key) }
    }
    private func remove(_ key: Key) {
        if let entry = cached.removeValue(forKey: key) { cachedBytes -= entry.bytes; evictions += 1 }
    }
}

private final class HRRRWorkWaiter<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var result: Result<Value, Error>?
    var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return result != nil }
    func attach(_ continuation: CheckedContinuation<Value, Error>) {
        lock.lock()
        if let result { lock.unlock(); continuation.resume(with: result) }
        else { self.continuation = continuation; lock.unlock() }
    }
    @discardableResult func finish(_ result: Result<Value, Error>) -> Bool {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return false }
        self.result = result
        let continuation = continuation; self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
        return true
    }
}
