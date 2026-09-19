import Foundation

/// Standalone portable contract tests, compiled separately from the app target.
@main
struct HRRRZarrTests {
    static func main() async throws {
        try codecTests()
        try metadataAndGeometryTests()
        if CommandLine.arguments.contains("--live") { try await liveTest() }
        else { print("PASS HRRR native: codec, strict metadata, exact time, geometry and sampling") }
    }

    static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw NSError(domain: "HRRRZarrTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func rejects(_ message: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { return }
        throw NSError(domain: "HRRRZarrTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Did not reject: \(message)"])
    }
    static func word(_ value: Int) -> [UInt8] { (0..<4).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) } }
    static func header(count: Int, block: Int, size: Int, type: Int = 4, flags: UInt8) -> [UInt8] {
        [2, 1, flags, UInt8(type)] + word(count) + word(block) + word(size)
    }

    static func codecTests() throws {
        let raw: [UInt8] = [0, 0, 128, 63, 0, 0, 0, 192, 0, 0, 192, 127]
        let memcpy = Data(header(count: 12, block: 12, size: 28, flags: 0x22) + raw)
        let decoded = try HRRRZarrCodec.blosc(memcpy, expectedBytes: 12, elementBytes: 4)
        let values = try HRRRZarrCodec.floats(decoded, dtype: "<f4")
        try check(values[0] == 1 && values[1] == -2 && values[2].isNaN, "float memcpy and NaN")
        let big = try HRRRZarrCodec.numbers(Data([0x3f, 0x80, 0, 0, 0xc0, 0, 0, 0]), dtype: ">f4")
        try check(big == [1, -2], "big endian floats")
        let signed = try HRRRZarrCodec.numbers(Data([UInt8](repeating: 255, count: 8)), dtype: "<i8")
        try check(signed == [-1], "signed i64")
        try rejects("inexact i64") { _ = try HRRRZarrCodec.numbers(Data([0, 0, 0, 0, 0, 0, 0x40, 0]), dtype: "<i8") }
        // Four byte planes, not element-interleaved; Blosc unshuffle must restore.
        let shuffled: [UInt8] = [0, 0, 0, 0, 128, 0, 63, 192]
        let shuffle = Data(header(count: 8, block: 8, size: 32, flags: 0x31) + word(20) + word(8) + shuffled)
        let unshuffled = try HRRRZarrCodec.blosc(shuffle, expectedBytes: 8, elementBytes: 4)
        try check(try HRRRZarrCodec.numbers(unshuffled, dtype: "<f4") == [1, -2], "byte shuffle")
        // LZ4 one literal + overlapping distance-one match expands 1 to 8 bytes.
        let lz4: [UInt8] = [0x13, 7, 1, 0]
        let compressed = Data(header(count: 8, block: 8, size: 28, type: 1, flags: 0x30) + word(20) + word(4) + lz4)
        try check(try HRRRZarrCodec.blosc(compressed, expectedBytes: 8, elementBytes: 1) == Data(repeating: 7, count: 8), "LZ4 overlap")
        // Physical blocks can be out of logical order in parallel Blosc output.
        let reversed = Data(header(count: 8, block: 4, size: 40, type: 1, flags: 0x30)
                            + word(32) + word(24) + word(4) + [5, 6, 7, 8] + word(4) + [1, 2, 3, 4])
        try check(try HRRRZarrCodec.blosc(reversed, expectedBytes: 8, elementBytes: 1) == Data(1...8), "unordered block starts")
        // A normal-sized Blosc block splits into one stream per element byte.
        var splitPayload = [UInt8]()
        for byte in 1...4 { splitPayload += word(128) + [UInt8](repeating: UInt8(byte), count: 128) }
        let split = Data(header(count: 512, block: 512, size: 20 + splitPayload.count, flags: 0x21) + word(20) + splitPayload)
        let splitDecoded = try HRRRZarrCodec.blosc(split, expectedBytes: 512, elementBytes: 4)
        try check(splitDecoded == Data((0..<128).flatMap { _ in [UInt8(1), 2, 3, 4] }), "Blosc split streams plus shuffle")
        for flag: UInt8 in [0x34, 0x38, 0x50] {
            var bytes = compressed; bytes[2] = flag
            try rejects("unsupported flags \(flag)") { _ = try HRRRZarrCodec.blosc(bytes, expectedBytes: 8, elementBytes: 1) }
        }
        try rejects("short input") { _ = try HRRRZarrCodec.blosc(Data(), expectedBytes: 8, elementBytes: 1) }
        try rejects("size bomb") { _ = try HRRRZarrCodec.blosc(compressed, expectedBytes: Int.max, elementBytes: 1) }
        try rejects("wrong type size") { _ = try HRRRZarrCodec.blosc(compressed, expectedBytes: 8, elementBytes: 4) }
        try rejects("zero type size") { _ = try HRRRZarrCodec.blosc(compressed, expectedBytes: 8, elementBytes: 0) }
        var badMatch = compressed; badMatch[26] = 0
        try rejects("zero LZ4 distance") { _ = try HRRRZarrCodec.blosc(badMatch, expectedBytes: 8, elementBytes: 1) }
        var overlap = reversed; overlap.replaceSubrange(16..<20, with: word(24))
        try rejects("overlapping blocks") { _ = try HRRRZarrCodec.blosc(overlap, expectedBytes: 8, elementBytes: 1) }
        for count in 0..<memcpy.count {
            try rejects("truncation \(count)") { _ = try HRRRZarrCodec.blosc(memcpy.prefix(count), expectedBytes: 12, elementBytes: 4) }
        }
        // Deterministic mutations exercise bounds checks without assuming every
        // changed literal must be invalid (some are another valid payload).
        for offset in compressed.indices {
            for byte: UInt8 in [0, 1, 127, 255] {
                var mutation = compressed; mutation[offset] = byte
                _ = try? HRRRZarrCodec.blosc(mutation, expectedBytes: 8, elementBytes: 1)
            }
        }
    }

    static func metadata() throws -> [String: Any] {
        var entries: [String: Any] = [:]
        func add(_ path: String, shape: [Int], chunks: [Int], dtype: String, dims: [String], units: String? = nil, compressed: Bool = true) {
            var attrs: [String: Any] = ["_ARRAY_DIMENSIONS": dims]
            if let units { attrs["units"] = units }
            if path == "time" || path == "forecast_reference_time" { attrs["calendar"] = "gregorian" }
            entries["\(path)/.zattrs"] = attrs
            entries["\(path)/.zarray"] = ["zarr_format": 2, "shape": shape, "chunks": chunks, "dtype": dtype,
                "order": "C", "filters": NSNull(), "fill_value": -9999,
                "compressor": compressed ? ["id": "blosc", "cname": "lz4", "clevel": 5, "shuffle": 1, "blocksize": 0] : NSNull()]
        }
        add(HRRRZarrContract.reflectivityPath, shape: [2, 3, 4], chunks: [2, 2, 3], dtype: "<f4", dims: ["time", "projection_y_coordinate", "projection_x_coordinate"])
        add("projection_x_coordinate", shape: [4], chunks: [4], dtype: "<f8", dims: ["projection_x_coordinate"], units: "m")
        add("projection_y_coordinate", shape: [3], chunks: [3], dtype: "<f8", dims: ["projection_y_coordinate"], units: "m")
        add("forecast_period", shape: [2], chunks: [2], dtype: "<i8", dims: ["time"], units: "hours")
        add("time", shape: [2], chunks: [2], dtype: "<f8", dims: ["time"], units: "hours since 1970-01-01")
        add("forecast_reference_time", shape: [], chunks: [], dtype: "<f8", dims: [], units: "hours since 1970-01-01", compressed: false)
        return ["zarr_consolidated_format": 1, "metadata": entries]
    }

    static func metadataAndGeometryTests() throws {
        let document = try metadata(), cycle = Date(timeIntervalSince1970: 1_789_776_000)
        let run = try HRRRZarrContract.decodeMetadata(JSONSerialization.data(withJSONObject: document), cycleTime: cycle)
        let projection = try HRRRZarrContract.Projection(data: Data(#"{"a":6371229,"b":6371229,"proj":"lcc","lon_0":262.5,"lat_0":38.5,"lat_1":38.5,"lat_2":38.5}"#.utf8))
        let maryville = HRRRZarrContract.Point(longitude: -89.9559, latitude: 38.7237)
        let xy = try projection.project(maryville), point = try projection.inverse(x: xy.x, y: xy.y)
        try check(abs(point.longitude - maryville.longitude) < 1e-8 && abs(point.latitude - maryville.latitude) < 1e-8, "LCC round trip")
        // Fixed comparison generated by the existing JavaScript projection.
        try check(abs(xy.x - 653755.1553602777) < 0.00001 && abs(xy.y - 51683.159416067414) < 0.00001, "JavaScript LCC projection parity")
        let hours = cycle.timeIntervalSince1970 / 3_600
        var arrays = ["projection_x_coordinate": [xy.x - 3_000, xy.x, xy.x + 3_000, xy.x + 6_000],
                      "projection_y_coordinate": [xy.y - 3_000, xy.y, xy.y + 3_000],
                      "forecast_period": [1, 3], "time": [hours + 1, hours + 3], "forecast_reference_time": [hours]]
        let grid = try HRRRZarrContract.Grid(run: run, projection: projection, arrays: arrays)
        try check(grid.steps.map(\.forecastHour) == [1, 3], "do not invent missing cadence/zero-hour")
        try check(grid.steps[0].validTime == cycle.addingTimeInterval(3_600), "exact valid time")
        let bounds = HRRRZarrContract.Bounds(west: maryville.longitude - 0.02, south: maryville.latitude - 0.02,
                                             east: maryville.longitude + 0.1, north: maryville.latitude + 0.1)
        let descriptors = try HRRRZarrContract.descriptors(run: run, grid: grid, bounds: bounds)
        try check(descriptors.contains(where: { $0.logicalWidth == 1 && $0.logicalHeight == 1 }), "logical edge padding")
        try rejects("chunk budget") { _ = try HRRRZarrContract.descriptors(run: run, grid: grid, bounds: bounds, maximumChunks: 1) }
        arrays["time"] = [hours + 2, hours + 3]
        try rejects("time disagreement") { _ = try HRRRZarrContract.Grid(run: run, projection: projection, arrays: arrays) }
        arrays["time"] = [hours + 1, hours + 3]; arrays["projection_x_coordinate"]?[2] += 1
        try rejects("nonuniform grid") { _ = try HRRRZarrContract.Grid(run: run, projection: projection, arrays: arrays) }
        for (key, value) in [("order", "F" as Any), ("dtype", ">f4" as Any), ("shape", [2, 0, 4] as Any), ("filters", [["id": "delta"]] as Any), ("dimension_separator", "/" as Any)] {
            var bad = document, entries = document["metadata"] as! [String: Any]
            var spec = entries["entire_atmosphere/REFC/.zarray"] as! [String: Any]
            spec[key] = value; entries["entire_atmosphere/REFC/.zarray"] = spec; bad["metadata"] = entries
            try rejects("metadata \(key)") { _ = try HRRRZarrContract.decodeMetadata(JSONSerialization.data(withJSONObject: bad), cycleTime: cycle) }
        }
        let descriptor = descriptors[0]
        let chunk = HRRRZarrContract.Chunk(descriptor: descriptor, width: 3, height: 2, steps: grid.steps,
                                          values: [10, 20, 30, 40, 50, -9999, 11, 21, 31, 41, 51, 61], fillValue: -9999)
        let field = HRRRZarrClient.Field(loaded: .init(run: run, grid: grid), steps: grid.steps, chunks: [chunk])
        try check(field.sample(longitude: maryville.longitude, latitude: maryville.latitude, sourceIndex: 0) == 50, "projected nearest-cell sample")
        try check(chunk.value(step: 0, x: 2, y: 1) == nil, "fill is missing, not clear")
        try check(field.sample(longitude: 0, latitude: 0, sourceIndex: 0) == nil, "outside is missing")
        try check(field.sample(longitude: maryville.longitude, latitude: maryville.latitude, sourceIndex: 9) == nil, "unknown step missing")
    }

    static func liveTest() async throws {
        let client = try HRRRZarrClient()
        let loaded = try await client.loadLatest()
        let field = try await client.load(run: loaded, bounds: .init(west: -90.4, south: 38.4, east: -89.7, north: 39), sourceIndexes: [0, 1, 2])
        var records: [[String: Any]] = []
        for chunk in field.chunks {
            var hash: UInt64 = 14_695_981_039_346_656_037
            for value in chunk.values {
                let bits = value.bitPattern
                for byte in 0..<4 { hash = (hash ^ UInt64(UInt8(truncatingIfNeeded: bits >> (byte * 8)))) &* 1_099_511_628_211 }
            }
            records.append(["key": "\(chunk.descriptor.chunkY).\(chunk.descriptor.chunkX)", "fnv1a64": String(hash, radix: 16), "count": chunk.values.count,
                            "logicalWidth": chunk.descriptor.logicalWidth, "logicalHeight": chunk.descriptor.logicalHeight,
                            "minimum": chunk.values.filter { $0.isFinite && $0 > -9000 }.min() ?? .nan,
                            "maximum": chunk.values.filter { $0.isFinite && $0 > -9000 }.max() ?? .nan])
        }
        let formatter = ISO8601DateFormatter()
        let report: [String: Any] = ["cycle": loaded.run.cycle, "forecastHours": field.steps.map(\.forecastHour),
                                   "validTimes": field.steps.map { formatter.string(from: $0.validTime) }, "chunks": records,
                                   "maryvilleDbz": field.sample(longitude: -89.9559, latitude: 38.7237, sourceIndex: 0) as Any]
        print(String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self))
    }
}
