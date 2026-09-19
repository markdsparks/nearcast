import Foundation
import zlib

/// Bounded port of experimental/raw-weather/mrms-browser-worker.js for the
/// existing public CONUS MergedReflectivityQCComposite_00.50 product only.
/// Not a general GRIB/PNG decoder. No image color management, invented times,
/// motion estimation, freshness policy or substitution of unavailable data.
enum MRMSContract {
    static let origin = URL(string: "https://noaa-mrms-pds.s3.amazonaws.com")!
    static let product = "MergedReflectivityQCComposite_00.50"
    static let maximumDownloadBytes = 8 * 1024 * 1024
    static let maximumGRIBBytes = 8 * 1024 * 1024
    static let maximumInflatedPNGBytes = 64 * 1024 * 1024

    enum Failure: Error, Equatable {
        case invalidSource, invalidTime, invalidOptions, sizeLimit, invalidGRIB
        case unsupportedGrid, unsupportedProduct, unsupportedPacking, invalidPNG
        case unsupportedPNG, invalidChecksum, invalidCompression, metadataMismatch
        case invalidListing, listingLimit, requestLimit
    }

    struct AdvertisedFrame: Equatable, Sendable {
        let key: String
        let byteLength: Int
        let validTimeMilliseconds: Int64
        var observedAt: String { RadarNumericContract.isoTime(validTimeMilliseconds) }
        var url: URL { MRMSContract.origin.appendingPathComponent(key) }
        let sourceProvider = "noaa-mrms-direct"

        /// A descriptor must come from an actual source listing. The key's time,
        /// never LastModified, target cadence, or the device clock, is valid time.
        init(key: String, byteLength: Int) throws {
            let pattern = #"^CONUS/MergedReflectivityQCComposite_00\.50/([0-9]{8})/MRMS_MergedReflectivityQCComposite_00\.50_([0-9]{8})-([0-9]{6})\.grib2\.gz$"#
            guard key.utf8.count < 256,
                  let expression = try? NSRegularExpression(pattern: pattern),
                  let match = expression.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)),
                  let dayRange = Range(match.range(at: 1), in: key),
                  let dateRange = Range(match.range(at: 2), in: key),
                  let timeRange = Range(match.range(at: 3), in: key),
                  key[dayRange] == key[dateRange],
                  (1...MRMSContract.maximumDownloadBytes).contains(byteLength) else {
                throw Failure.invalidSource
            }
            let date = Array(key[dateRange]), time = Array(key[timeRange])
            let timestamp = "\(String(date[0..<4]))-\(String(date[4..<6]))-\(String(date[6..<8]))T\(String(time[0..<2])):\(String(time[2..<4])):\(String(time[4..<6]))Z"
            do { validTimeMilliseconds = try RadarNumericContract.parseTime(timestamp) }
            catch { throw Failure.invalidTime }
            self.key = key
            self.byteLength = byteLength
        }
    }

    struct Grid: Equatable, Sendable {
        let width: Int, height: Int
        let latitudeFirst: Double, longitudeFirst: Double
        let latitudeStep: Double, longitudeStep: Double
        let scansEast: Bool, scansNorth: Bool
    }

    struct Viewport: @unchecked Sendable {
        let frame: AdvertisedFrame
        let texture: RadarNumericContract.Texture
        let encoding: RadarNumericContract.Encoding
        let bounds: RadarChunkContract.Bounds
        /// 1 means all four source samples were usable; 0 means unknown/outside.
        /// A zero texture byte by itself must NOT be presented as clear weather.
        let validDataMask: [UInt8]
        let grid: Grid
        let sourceRowsReconstructed: Int
        let validPixelCount: Int
        let precipitationPixelCount: Int
        var observedAt: String { frame.observedAt }
        var sourceProvider: String { frame.sourceProvider }
        var hasCoverage: Bool { validPixelCount > 0 }
    }

    static func decode(_ downloaded: Data, frame: AdvertisedFrame,
                       bounds: RadarChunkContract.Bounds, width: Int = 512, height: Int = 384,
                       encoding: RadarNumericContract.Encoding = try! .init()) throws -> Viewport {
        try Task.checkCancellation()
        try bounds.validate()
        guard bounds.minLat >= -85, bounds.maxLat <= 85,
              (64...1024).contains(width), (64...1024).contains(height),
              width <= RadarNumericContract.maximumTexturePixels / height,
              encoding.dbzMax <= 100, encoding.threshold <= 80 else { throw Failure.invalidOptions }
        guard downloaded.count == frame.byteLength, downloaded.count <= maximumDownloadBytes else {
            throw Failure.sizeLimit
        }
        guard downloaded.starts(with: [0x1f, 0x8b]) else { throw Failure.invalidCompression }
        var grib = Data()
        try inflate(downloaded, windowBits: MAX_WBITS + 16, maximumBytes: maximumGRIBBytes) {
            grib.append(contentsOf: $0)
        }
        let parsed = try parseGRIB(grib, frame: frame)
        let png = try parsePNG(parsed.png, grid: parsed.grid)
        return try sample(png, grid: parsed.grid, packing: parsed.packing,
                          frame: frame, bounds: bounds, width: width, height: height, encoding: encoding)
    }

    private struct Packing {
        let reference: Double, binaryMultiplier: Double, decimalDivisor: Double
        func value(_ row: [UInt8], _ offset: Int) -> Double? {
            let sample = Double(Int(row[offset]) << 8 | Int(row[offset + 1]))
            let value = (reference + sample * binaryMultiplier) / decimalDivisor
            guard value.isFinite, value >= -100, value <= 100 else { return nil }
            return value <= -90 ? 0 : value
        }
    }

    private static func parseGRIB(_ data: Data, frame: AdvertisedFrame) throws -> (grid: Grid, packing: Packing, png: Data) {
        let b = [UInt8](data)
        guard b.count >= 20, b.prefix(4) == Array("GRIB".utf8)[...], b[7] == 2,
              b[6] == 209, u32(b, 8) == 0, Int(u32(b, 12)) == b.count,
              b.suffix(4) == Array("7777".utf8)[...] else { throw Failure.invalidGRIB }
        var sections: [Int: [UInt8]] = [:], offset = 16, previous = 0
        while offset < b.count - 4 {
            try Task.checkCancellation()
            guard offset + 5 <= b.count - 4 else { throw Failure.invalidGRIB }
            let length = Int(u32(b, offset)), number = Int(b[offset + 4])
            guard length >= 5, length <= b.count - 4 - offset,
                  (1...7).contains(number), number > previous else { throw Failure.invalidGRIB }
            sections[number] = Array(b[offset..<(offset + length)])
            previous = number; offset += length
        }
        guard offset == b.count - 4, let identification = sections[1], identification.count == 21,
              let g = sections[3], g.count == 72,
              let product = sections[4], product.count == 34,
              let p = sections[5], p.count == 21,
              let bitmap = sections[6], bitmap.count == 6, bitmap[5] == 255,
              let payload = sections[7], payload.count > 5 else { throw Failure.invalidGRIB }
        let referenceTime = String(format: "%04d-%02d-%02dT%02d:%02d:%02dZ", Int(u16(identification, 12)),
                                   Int(identification[14]), Int(identification[15]), Int(identification[16]),
                                   Int(identification[17]), Int(identification[18]))
        guard (try? RadarNumericContract.parseTime(referenceTime)) == frame.validTimeMilliseconds else {
            throw Failure.metadataMismatch
        }
        // Product definition 4.0, local MRMS discipline 209/category 10/parameter 0,
        // zero forecast duration. Other product/time-range templates fail closed.
        guard u16(product, 5) == 0, u16(product, 7) == 0, product[9] == 10,
              product[10] == 0, u32(product, 18) == 0 else { throw Failure.unsupportedProduct }
        let ni = Int(u32(g, 30)), nj = Int(u32(g, 34)), scan = g[71]
        let angle = u32(g, 38), subdivisions = u32(g, 42)
        guard g[5] == 0, g[10] == 0, u16(g, 12) == 0,
              (2...10_000).contains(ni), (2...10_000).contains(nj), ni <= 30_000_000 / nj,
              Int(u32(g, 6)) == ni * nj, scan & 0x3f == 0,
              (angle == 0 || (angle == 1 && subdivisions == 1_000_000)) else { throw Failure.unsupportedGrid }
        // Existing CONUS files use positive latitudes and 0...360 longitudes.
        // Negative sign-magnitude coordinate/scaling variants are not guessed.
        let lat1 = Double(u32(g, 46)) / 1e6, lat2 = Double(u32(g, 55)) / 1e6
        let rawLon1 = Double(u32(g, 50)) / 1e6, rawLon2 = Double(u32(g, 59)) / 1e6
        let lon1 = rawLon1 > 180 ? rawLon1 - 360 : rawLon1
        let lon2 = rawLon2 > 180 ? rawLon2 - 360 : rawLon2
        let dx = Double(u32(g, 63)) / 1e6, dy = Double(u32(g, 67)) / 1e6
        let east = scan & 0x80 == 0, north = scan & 0x40 != 0
        guard (0...85).contains(lat1), (0...85).contains(lat2),
              (0...360).contains(rawLon1), (0...360).contains(rawLon2), dx > 0, dy > 0,
              abs(lat2 - (lat1 + Double(nj - 1) * dy * (north ? 1 : -1))) <= 0.00001,
              abs(lon2 - (lon1 + Double(ni - 1) * dx * (east ? 1 : -1))) <= 0.00001 else {
            throw Failure.unsupportedGrid
        }
        let reference = Double(Float(bitPattern: u32(p, 11)))
        let binaryScale = Int(u16(p, 15)), decimalScale = Int(u16(p, 17))
        guard u16(p, 9) == 41, Int(u32(p, 5)) == ni * nj, p[19] == 16,
              reference.isFinite, binaryScale <= 30, decimalScale <= 30 else { throw Failure.unsupportedPacking }
        let grid = Grid(width: ni, height: nj, latitudeFirst: lat1, longitudeFirst: lon1,
                        latitudeStep: dy, longitudeStep: dx, scansEast: east, scansNorth: north)
        return (grid, Packing(reference: reference, binaryMultiplier: pow(2, Double(binaryScale)),
                              decimalDivisor: pow(10, Double(decimalScale))), Data(payload.dropFirst(5)))
    }

    private struct PNG { let compressed: Data; let rowBytes: Int; let height: Int }
    private static func parsePNG(_ data: Data, grid: Grid) throws -> PNG {
        let b = [UInt8](data)
        guard b.count >= 45, b.prefix(8) == [137, 80, 78, 71, 13, 10, 26, 10][...] else { throw Failure.invalidPNG }
        var offset = 8, seenHeader = false, seenData = false, endedData = false, seenEnd = false
        var compressed = Data(), chunkCount = 0
        while offset < b.count {
            try Task.checkCancellation()
            chunkCount += 1
            guard chunkCount <= 4096, offset + 12 <= b.count else { throw Failure.invalidPNG }
            let length = Int(u32(b, offset)), start = offset + 8
            guard length <= b.count - start - 4 else { throw Failure.invalidPNG }
            let end = start + length, type = String(bytes: b[(offset + 4)..<start], encoding: .ascii) ?? ""
            let crc = b.withUnsafeBufferPointer { ptr in
                crc32(0, ptr.baseAddress!.advanced(by: offset + 4), uInt(length + 4))
            }
            guard UInt32(crc) == u32(b, end) else { throw Failure.invalidChecksum }
            if !seenHeader && type != "IHDR" { throw Failure.invalidPNG }
            switch type {
            case "IHDR":
                guard !seenHeader, length == 13, Int(u32(b, start)) == grid.width,
                      Int(u32(b, start + 4)) == grid.height else { throw Failure.metadataMismatch }
                guard Array(b[(start + 8)..<end]) == [16, 0, 0, 0, 0] else { throw Failure.unsupportedPNG }
                seenHeader = true
            case "IDAT":
                guard !endedData else { throw Failure.invalidPNG }
                seenData = true
                compressed.append(contentsOf: b[start..<end])
            case "IEND":
                guard length == 0, seenData, end + 4 == b.count else { throw Failure.invalidPNG }
                seenEnd = true
            default:
                // Unknown critical chunks (including palettes) are unsupported.
                guard type.utf8.count == 4, b[offset + 4] & 0x20 != 0 else { throw Failure.unsupportedPNG }
                if seenData { endedData = true }
            }
            offset = end + 4
        }
        let rowBytes = grid.width * 2
        guard seenEnd, !compressed.isEmpty,
              rowBytes + 1 <= maximumInflatedPNGBytes / grid.height else { throw Failure.sizeLimit }
        return PNG(compressed: compressed, rowBytes: rowBytes, height: grid.height)
    }

    private static func sample(_ png: PNG, grid: Grid, packing: Packing, frame: AdvertisedFrame,
                               bounds: RadarChunkContract.Bounds, width: Int, height: Int,
                               encoding: RadarNumericContract.Encoding) throws -> Viewport {
        var output = [UInt8](repeating: 0, count: width * height), mask = output
        let xSamples: [(valid: Bool, index: Int, fraction: Double)] = (0..<width).map { x in
            let lon = bounds.minLon + (Double(x) + 0.5) / Double(width) * (bounds.maxLon - bounds.minLon)
            let adjusted = lon < grid.longitudeFirst && grid.longitudeFirst > 0 ? lon + 360 : lon
            let source = (grid.scansEast ? adjusted - grid.longitudeFirst : grid.longitudeFirst - adjusted) / grid.longitudeStep
            return (source >= 0 && source < Double(grid.width - 1), Int(floor(source)), source - floor(source))
        }
        var buckets: [Int: [(row: Int, fraction: Double)]] = [:]
        let north = mercatorY(bounds.maxLat), south = mercatorY(bounds.minLat)
        for y in 0..<height {
            let world = north + (Double(y) + 0.5) / Double(height) * (south - north)
            let latitude = atan(sinh(Double.pi * (1 - 2 * world))) * 180 / Double.pi
            let source = (grid.scansNorth ? latitude - grid.latitudeFirst : grid.latitudeFirst - latitude) / grid.latitudeStep
            guard source >= 0, source < Double(grid.height - 1) else { continue }
            buckets[Int(floor(source)), default: []].append((y, source - floor(source)))
        }
        let lastRow = xSamples.contains(where: \.valid) ? (buckets.keys.max().map { $0 + 1 } ?? -1) : -1
        var packet = [UInt8](repeating: 0, count: png.rowBytes + 1), packetCount = 0
        var previous = [UInt8](repeating: 0, count: png.rowBytes), current = previous
        var sourceRow = 0, reconstructed = 0, validCount = 0, precipCount = 0
        try inflate(png.compressed, windowBits: MAX_WBITS, maximumBytes: (png.rowBytes + 1) * png.height) { chunk in
            var inputOffset = 0
            while inputOffset < chunk.count {
                let count = min(packet.count - packetCount, chunk.count - inputOffset)
                packet.replaceSubrange(packetCount..<(packetCount + count), with: chunk[inputOffset..<(inputOffset + count)])
                packetCount += count; inputOffset += count
                guard packetCount == packet.count else { continue }
                try Task.checkCancellation()
                guard packet[0] <= 4, sourceRow < png.height else { throw Failure.invalidPNG }
                if sourceRow <= lastRow {
                    for i in 0..<png.rowBytes {
                        let left = i >= 2 ? Int(current[i - 2]) : 0, up = Int(previous[i])
                        let upLeft = i >= 2 ? Int(previous[i - 2]) : 0
                        let predictor: Int
                        switch packet[0] {
                        case 0: predictor = 0
                        case 1: predictor = left
                        case 2: predictor = up
                        case 3: predictor = (left + up) / 2
                        default:
                            let p = left + up - upLeft
                            let a = abs(p - left), b = abs(p - up), c = abs(p - upLeft)
                            predictor = a <= b && a <= c ? left : b <= c ? up : upLeft
                        }
                        current[i] = UInt8((Int(packet[i + 1]) + predictor) & 255)
                    }
                    reconstructed += 1
                    for target in buckets[sourceRow - 1] ?? [] {
                        for (x, sample) in xSamples.enumerated() where sample.valid {
                            let index = sample.index * 2
                            guard let a = packing.value(previous, index), let b = packing.value(previous, index + 2),
                                  let c = packing.value(current, index), let d = packing.value(current, index + 2) else { continue }
                            let top = a * (1 - sample.fraction) + b * sample.fraction
                            let bottom = c * (1 - sample.fraction) + d * sample.fraction
                            let value = top * (1 - target.fraction) + bottom * target.fraction
                            let out = target.row * width + x
                            mask[out] = 1; validCount += 1
                            if value >= encoding.threshold {
                                output[out] = try RadarNumericContract.encodeDbz(value, encoding: encoding)
                                precipCount += 1
                            }
                        }
                    }
                    swap(&previous, &current)
                }
                sourceRow += 1; packetCount = 0
            }
        }
        // Drain the complete stream for checksum/length validation, but reconstruct
        // only rows needed by this viewport. No full national decoded grid exists.
        guard packetCount == 0, sourceRow == png.height else { throw Failure.invalidCompression }
        return Viewport(frame: frame, texture: try .init(width: width, height: height, bytes: output), encoding: encoding,
                        bounds: bounds, validDataMask: mask, grid: grid, sourceRowsReconstructed: reconstructed,
                        validPixelCount: validCount, precipitationPixelCount: precipCount)
    }

    private static func mercatorY(_ latitude: Double) -> Double {
        let sine = sin(latitude * Double.pi / 180)
        return 0.5 - log((1 + sine) / (1 - sine)) / (4 * Double.pi)
    }
    private static func u16(_ b: [UInt8], _ i: Int) -> UInt16 { UInt16(b[i]) << 8 | UInt16(b[i + 1]) }
    private static func u32(_ b: [UInt8], _ i: Int) -> UInt32 {
        UInt32(b[i]) << 24 | UInt32(b[i + 1]) << 16 | UInt32(b[i + 2]) << 8 | UInt32(b[i + 3])
    }

    private static func inflate(_ data: Data, windowBits: Int32, maximumBytes: Int,
                                receive: (ArraySlice<UInt8>) throws -> Void) throws {
        var stream = z_stream()
        guard inflateInit2_(&stream, windowBits, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw Failure.invalidCompression
        }
        defer { inflateEnd(&stream) }
        try data.withUnsafeBytes { raw in
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: raw.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uInt(data.count)
            var buffer = [UInt8](repeating: 0, count: 16_384), total = 0
            while true {
                try Task.checkCancellation()
                let status: Int32 = buffer.withUnsafeMutableBytes { output in
                    stream.next_out = output.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(output.count)
                    return zlib.inflate(&stream, Z_NO_FLUSH)
                }
                let produced = buffer.count - Int(stream.avail_out)
                guard produced <= maximumBytes - total else { throw Failure.sizeLimit }
                total += produced
                try receive(buffer.prefix(produced))
                if status == Z_STREAM_END {
                    guard stream.avail_in == 0 else { throw Failure.invalidCompression }
                    return
                }
                guard status == Z_OK, produced > 0 || stream.avail_in > 0 else { throw Failure.invalidCompression }
            }
        }
    }
}
