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
        for _ in 0..<groups { references.append(try bits.read(referenceBits)) }; bits.align()
        let baseWidth = try rep.u(35)
        for _ in 0..<groups {
            let value = try baseWidth + bits.read(widthBits)
            guard value <= 31 else { throw Failure.malformed }; widths.append(value)
        }; bits.align()
        let baseLength = try rep.u(37, 4), increment = try rep.u(41), lastLength = try rep.u(42, 4)
        var total = 0
        for i in 0..<groups {
            let scaled = try bits.read(lengthBits)
            let length = i == groups - 1 ? lastLength : baseLength + scaled * increment
            guard length <= points - total else { throw Failure.malformed }
            total += length; lengths.append(length)
        }; bits.align()
        guard total == points else { throw Failure.malformed }
        var values = [Int64](); values.reserveCapacity(points)
        for g in 0..<groups {
            try Task.checkCancellation()
            for _ in 0..<lengths[g] {
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
    init(configuration: URLSessionConfiguration = .ephemeral) throws {
        transport = try RadarChunkClient(allowedOrigins: [HRRRSubhourly.origin], configuration: configuration)
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
                for hour in hours {
                    let urls = try HRRRSubhourly.urls(cycle: cycle, hour: hour)
                    let data = try await transport.fetchBytes(at: urls.index, maximumBytes: 2 * 1024 * 1024)
                    result += try HRRRSubhourly.parseIndex(data, cycle: cycle, hour: hour)
                }
                let selected = result.filter { targets.contains($0.validTime) }.sorted { $0.validTime < $1.validTime }
                guard selected.count == 24 else { throw HRRRSubhourly.Failure.unavailable }
                return selected
            } catch is CancellationError { throw CancellationError() } catch { continue }
        }
        throw HRRRSubhourly.Failure.unavailable
    }
    func load(_ frame: HRRRSubhourly.Frame, bounds: NativeRadarPresentationContract.Viewport) async throws -> NativeRadarSeamEstimation.Frame {
        let expected = try HRRRSubhourly.urls(cycle: frame.cycle, hour: (frame.leadMinutes + 59) / 60).data
        guard expected == frame.url else { throw HRRRSubhourly.Failure.invalidIndex }
        let data = try await transport.fetchRange(at: frame.url, range: frame.range)
        let task = Task.detached(priority: .userInitiated) { try HRRRSubhourly.decode(data, frame: frame, bounds: bounds) }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
}
