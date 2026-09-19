import Foundation
import CoreFoundation

/// Portable, I/O-free contract for the existing public HRRR REFC Zarr product.
/// This is hourly source data, not a nowcast, raw-map blend, or cadence promise.
enum HRRRZarrContract {
    typealias Failure = HRRRZarrCodec.Failure
    static let bucket = URL(string: "https://hrrrzarr.s3.amazonaws.com")!
    static let reflectivityPath = "entire_atmosphere/REFC"
    static let coordinatePaths = ["projection_x_coordinate", "projection_y_coordinate", "forecast_period", "time", "forecast_reference_time"]

    struct ArraySpec: Sendable {
        let shape: [Int]
        let chunks: [Int]
        let dtype: String
        let compressed: Bool
        let shuffle: Int
        let fillValue: Double?
        let decodedBytes: Int

        func decode(_ data: Data) throws -> Data {
            if compressed {
                guard data.count >= 16 else { throw Failure.malformedChunk }
                if data[data.startIndex + 2] & 2 == 0 {
                    guard Int(data[data.startIndex + 2] & 1) == shuffle else { throw Failure.unsupportedCodec }
                }
                return try HRRRZarrCodec.blosc(data, expectedBytes: decodedBytes,
                                             elementBytes: HRRRZarrCodec.elementBytes(dtype))
            }
            guard data.count == decodedBytes else { throw Failure.malformedChunk }
            return data
        }
    }

    struct Run: Sendable {
        let cycle: String
        let cycleTime: Date
        let productRoot: URL
        let reflectivity: ArraySpec
        let coordinates: [String: ArraySpec]
    }

    struct Step: Equatable, Sendable {
        let sourceIndex: Int
        let forecastHour: Double
        let validTime: Date
    }

    struct Point: Equatable, Sendable { let longitude: Double; let latitude: Double }
    struct ProjectedPoint: Sendable { let x: Double; let y: Double }
    struct Bounds: Sendable {
        let west: Double, south: Double, east: Double, north: Double
        func validate() throws {
            guard [west, south, east, north].allSatisfy(\.isFinite),
                  west >= -180, east <= 180, south > -90, north < 90,
                  west < east, south < north else { throw Failure.invalidGeometry }
        }
    }

    struct Projection: Sendable {
        let radius: Double
        let longitudeOrigin: Double
        let latitudeOrigin: Double
        let standardParallel: Double

        init(data: Data) throws {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["proj"] as? String == "lcc",
                  let a = object["a"] as? Double, let b = object["b"] as? Double,
                  let lon = object["lon_0"] as? Double, let lat = object["lat_0"] as? Double,
                  let first = object["lat_1"] as? Double, let second = object["lat_2"] as? Double,
                  a == 6_371_229, b == a, lon == 262.5, lat == 38.5,
                  first == 38.5, second == first else { throw Failure.invalidGeometry }
            radius = a; longitudeOrigin = lon - 360; latitudeOrigin = lat; standardParallel = first
        }

        func project(_ point: Point) throws -> ProjectedPoint {
            guard point.longitude.isFinite, point.latitude.isFinite,
                  (-180...180).contains(point.longitude), (-89.999...89.999).contains(point.latitude) else { throw Failure.invalidGeometry }
            let radians = Double.pi / 180
            let phi = point.latitude * radians, phi0 = latitudeOrigin * radians
            let phi1 = standardParallel * radians, n = sin(phi1)
            let f = cos(phi1) * pow(tan(.pi / 4 + phi1 / 2), n) / n
            let rho = radius * f / pow(tan(.pi / 4 + phi / 2), n)
            let rho0 = radius * f / pow(tan(.pi / 4 + phi0 / 2), n)
            var longitudeDelta = (point.longitude - longitudeOrigin) * radians
            if longitudeDelta > .pi { longitudeDelta -= 2 * .pi }
            if longitudeDelta < -.pi { longitudeDelta += 2 * .pi }
            let theta = n * longitudeDelta
            return ProjectedPoint(x: rho * sin(theta), y: rho0 - rho * cos(theta))
        }

        func inverse(x: Double, y: Double) throws -> Point {
            guard x.isFinite, y.isFinite else { throw Failure.invalidGeometry }
            let radians = Double.pi / 180, phi0 = latitudeOrigin * radians
            let phi1 = standardParallel * radians, n = sin(phi1)
            let f = cos(phi1) * pow(tan(.pi / 4 + phi1 / 2), n) / n
            let rho0 = radius * f / pow(tan(.pi / 4 + phi0 / 2), n)
            let rho = hypot(x, rho0 - y)
            guard rho > 0 else { throw Failure.invalidGeometry }
            let latitude = (2 * atan(pow(radius * f / rho, 1 / n)) - .pi / 2) / radians
            var longitude = longitudeOrigin + atan2(x, rho0 - y) / n / radians
            if longitude > 180 { longitude -= 360 }
            if longitude < -180 { longitude += 360 }
            return Point(longitude: longitude, latitude: latitude)
        }
    }

    struct Grid: Sendable {
        let projection: Projection
        let x: [Double], y: [Double]
        let xSpacing: Double, ySpacing: Double
        let steps: [Step]

        init(run: Run, projection: Projection, arrays: [String: [Double]]) throws {
            guard let x = arrays["projection_x_coordinate"], let y = arrays["projection_y_coordinate"],
                  let periods = arrays["forecast_period"], let times = arrays["time"],
                  let reference = arrays["forecast_reference_time"], reference.count == 1,
                  x.count == run.reflectivity.shape[2], y.count == run.reflectivity.shape[1],
                  periods.count == run.reflectivity.shape[0], times.count == periods.count,
                  reference[0].isFinite,
                  abs(reference[0] * 3_600 - run.cycleTime.timeIntervalSince1970) < 0.001 else { throw Failure.invalidTime }
            self.x = x; self.y = y; self.projection = projection
            xSpacing = try Self.spacing(x); ySpacing = try Self.spacing(y)
            var steps = [Step]()
            for index in periods.indices {
                let hour = periods[index], epochHours = times[index]
                guard hour.isFinite, (0...48).contains(hour), epochHours.isFinite,
                      abs(epochHours * 3_600 - (run.cycleTime.timeIntervalSince1970 + hour * 3_600)) < 0.001,
                      index == 0 || times[index] > times[index - 1] else { throw Failure.invalidTime }
                steps.append(Step(sourceIndex: index, forecastHour: hour,
                                  validTime: Date(timeIntervalSince1970: epochHours * 3_600)))
            }
            self.steps = steps
        }

        private static func spacing(_ values: [Double]) throws -> Double {
            guard values.count >= 2, values.allSatisfy(\.isFinite) else { throw Failure.invalidGeometry }
            let spacing = values[1] - values[0]
            guard abs(spacing - 3_000) < 0.01 else { throw Failure.invalidGeometry }
            for index in 1..<values.count {
                guard abs(values[index] - values[index - 1] - spacing) < 0.01 else { throw Failure.invalidGeometry }
            }
            return spacing
        }
    }

    struct Descriptor: Equatable, Sendable {
        let chunkX: Int, chunkY: Int
        let gridOffsetX: Int, gridOffsetY: Int
        let logicalWidth: Int, logicalHeight: Int
        let xMin: Double, xMax: Double, yMin: Double, yMax: Double
        /// SW, SE, NE, NW cell-edge corners. Lambert edges are curved in lon/lat;
        /// these corners alone do NOT make a correctly reprojected map image.
        let corners: [Point]
    }

    struct Chunk: Sendable {
        let descriptor: Descriptor
        let width: Int, height: Int
        let steps: [Step]
        /// [selected time, projected south-to-north row, west-to-east column].
        /// Edge padding is retained in storage but must never be rendered.
        let values: [Float]
        let fillValue: Double?

        func value(step: Int, x: Int, y: Int) -> Float? {
            guard steps.indices.contains(step), x >= 0, y >= 0,
                  x < descriptor.logicalWidth, y < descriptor.logicalHeight else { return nil }
            let value = values[step * width * height + y * width + x]
            guard value.isFinite, fillValue == nil || Double(value) != fillValue,
                  value > -9_000 else { return nil }
            return value
        }
    }

    static func candidate(cycleTime: Date) throws -> (cycle: String, root: URL) {
        guard cycleTime.timeIntervalSince1970.isFinite,
              cycleTime.timeIntervalSince1970 >= 1_577_836_800,
              cycleTime.timeIntervalSince1970.truncatingRemainder(dividingBy: 3_600) == 0 else { throw Failure.invalidTime }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd_HH'z'"
        let cycle = formatter.string(from: cycleTime)
        let date = String(cycle.prefix(8))
        return (cycle, bucket.appendingPathComponent("sfc/\(date)/\(cycle)_fcst.zarr/entire_atmosphere/REFC"))
    }

    static func decodeMetadata(_ data: Data, cycleTime: Date) throws -> Run {
        guard data.count <= 262_144,
              let document = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              integer(document["zarr_consolidated_format"]) == 1,
              let metadata = document["metadata"] as? [String: [String: Any]] else { throw Failure.invalidMetadata }
        let candidate = try candidate(cycleTime: cycleTime)
        let reflectivity = try array(metadata, path: reflectivityPath,
                                     dimensions: ["time", "projection_y_coordinate", "projection_x_coordinate"])
        guard reflectivity.shape.count == 3, reflectivity.dtype == "<f4", reflectivity.compressed,
              reflectivity.shape[0] <= 48, reflectivity.shape[1] <= 4_096, reflectivity.shape[2] <= 4_096,
              reflectivity.chunks[1] <= 256, reflectivity.chunks[2] <= 256 else { throw Failure.invalidMetadata }
        var coordinates: [String: ArraySpec] = [:]
        for path in coordinatePaths {
            let dimensions = path == "forecast_reference_time" ? [] : [path.hasPrefix("projection_") ? path : "time"]
            let spec = try array(metadata, path: path, dimensions: dimensions)
            let expectedCount = path == "projection_x_coordinate" ? reflectivity.shape[2]
                : path == "projection_y_coordinate" ? reflectivity.shape[1] : reflectivity.shape[0]
            guard path == "forecast_reference_time" ? spec.shape.isEmpty : spec.shape == [expectedCount],
                  spec.chunks == spec.shape else { throw Failure.invalidMetadata }
            let attrs = metadata["\(path)/.zattrs"] ?? [:]
            let units = path.hasPrefix("projection_") ? "m" : path == "forecast_period" ? "hours" : "hours since 1970-01-01"
            guard attrs["units"] as? String == units else { throw Failure.invalidMetadata }
            if path == "time" || path == "forecast_reference_time" {
                guard attrs["calendar"] as? String == "gregorian" else { throw Failure.invalidMetadata }
            }
            coordinates[path] = spec
        }
        return Run(cycle: candidate.cycle, cycleTime: cycleTime, productRoot: candidate.root,
                   reflectivity: reflectivity, coordinates: coordinates)
    }

    private static func array(_ metadata: [String: [String: Any]], path: String, dimensions: [String]) throws -> ArraySpec {
        guard let object = metadata["\(path)/.zarray"], integer(object["zarr_format"]) == 2,
              let shape = integers(object["shape"]), let chunks = integers(object["chunks"]),
              shape.count == dimensions.count, chunks.count == shape.count,
              shape.allSatisfy({ $0 > 0 }), chunks.allSatisfy({ $0 > 0 }),
              object["order"] as? String == "C", object["filters"] is NSNull,
              object["dimension_separator"] == nil || object["dimension_separator"] as? String == ".",
              let dtype = object["dtype"] as? String, let fill = object["fill_value"],
              metadata["\(path)/.zattrs"]?["_ARRAY_DIMENSIONS"] as? [String] == dimensions else { throw Failure.invalidMetadata }
        let elementBytes = try HRRRZarrCodec.elementBytes(dtype)
        var count = 1
        for dimension in chunks {
            guard dimension <= HRRRZarrCodec.maximumDecodedBytes / elementBytes / count else { throw Failure.sizeLimit }
            count *= dimension
        }
        let compressed: Bool, shuffle: Int
        if object["compressor"] is NSNull { compressed = false; shuffle = 0 }
        else if let compressor = object["compressor"] as? [String: Any],
                compressor["id"] as? String == "blosc", ["lz4", "lz4hc"].contains(compressor["cname"] as? String ?? ""),
                let mode = integer(compressor["shuffle"]), (0...1).contains(mode),
                let level = integer(compressor["clevel"]), (0...9).contains(level),
                let block = integer(compressor["blocksize"]), (0...HRRRZarrCodec.maximumDecodedBytes).contains(block) {
            compressed = true; shuffle = mode
        } else { throw Failure.unsupportedCodec }
        let fillValue: Double?
        if fill is NSNull { fillValue = nil }
        else if let text = fill as? String, text == "NaN" { fillValue = .nan }
        else if let number = fill as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite { fillValue = number.doubleValue }
        else { throw Failure.invalidMetadata }
        return ArraySpec(shape: shape, chunks: chunks, dtype: dtype, compressed: compressed,
                         shuffle: shuffle, fillValue: fillValue, decodedBytes: count * elementBytes)
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite, value.doubleValue >= 0, value.doubleValue <= Double(Int32.max),
              value.doubleValue.rounded() == value.doubleValue else { return nil }
        return value.intValue
    }
    private static func integers(_ value: Any?) -> [Int]? {
        guard let values = value as? [Any] else { return nil }
        let numbers = values.compactMap(integer)
        return numbers.count == values.count ? numbers : nil
    }

    static func descriptors(run: Run, grid: Grid, bounds: Bounds, maximumChunks: Int = 4) throws -> [Descriptor] {
        try bounds.validate()
        guard (1...8).contains(maximumChunks) else { throw Failure.tooManyChunks }
        var points: [ProjectedPoint] = []
        for index in 0...8 {
            let fraction = Double(index) / 8
            let lon = bounds.west + (bounds.east - bounds.west) * fraction
            let lat = bounds.south + (bounds.north - bounds.south) * fraction
            for point in [Point(longitude: lon, latitude: bounds.south), Point(longitude: lon, latitude: bounds.north),
                          Point(longitude: bounds.west, latitude: lat), Point(longitude: bounds.east, latitude: lat)] {
                points.append(try grid.projection.project(point))
            }
        }
        func range(_ values: [Double], _ minimum: Double, _ maximum: Double) -> ClosedRange<Int>? {
            guard maximum >= values[0], minimum <= values[values.count - 1] else { return nil }
            func lower(_ target: Double) -> Int {
                var low = 0, high = values.count
                while low < high { let middle = (low + high) / 2; if values[middle] < target { low = middle + 1 } else { high = middle } }
                return low
            }
            return max(0, lower(minimum) - 1)...min(values.count - 1, lower(maximum) + 1)
        }
        guard let xr = range(grid.x, points.map(\.x).min()!, points.map(\.x).max()!),
              let yr = range(grid.y, points.map(\.y).min()!, points.map(\.y).max()!) else { return [] }
        let width = run.reflectivity.chunks[2], height = run.reflectivity.chunks[1]
        let xs = (xr.lowerBound / width)...(xr.upperBound / width)
        let ys = (yr.lowerBound / height)...(yr.upperBound / height)
        guard xs.count * ys.count <= maximumChunks else { throw Failure.tooManyChunks }
        var result: [Descriptor] = []
        for cy in ys { for cx in xs {
            let ox = cx * width, oy = cy * height
            let logicalWidth = min(width, grid.x.count - ox), logicalHeight = min(height, grid.y.count - oy)
            let xMin = grid.x[ox] - grid.xSpacing / 2, xMax = grid.x[ox + logicalWidth - 1] + grid.xSpacing / 2
            let yMin = grid.y[oy] - grid.ySpacing / 2, yMax = grid.y[oy + logicalHeight - 1] + grid.ySpacing / 2
            let corners = try [(xMin, yMin), (xMax, yMin), (xMax, yMax), (xMin, yMax)].map { try grid.projection.inverse(x: $0.0, y: $0.1) }
            result.append(Descriptor(chunkX: cx, chunkY: cy, gridOffsetX: ox, gridOffsetY: oy,
                                     logicalWidth: logicalWidth, logicalHeight: logicalHeight,
                                     xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax, corners: corners))
        } }
        return result
    }
}
