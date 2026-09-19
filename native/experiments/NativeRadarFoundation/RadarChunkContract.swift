import Foundation
import zlib

/// Bounded decoding of Nearcast's existing NCRD v1 transport. This is not a
/// GRIB/Zarr decoder, source-discovery service, motion estimator, or freshness
/// guarantee. Browser blob: URLs cannot be acquired by the native HTTPS client.
enum RadarChunkContract {
    static let maximumManifestBytes = 2 * 1_024 * 1_024
    static let maximumHeaderBytes = 65_535
    static let maximumPayloadBytes = RadarNumericContract.maximumTexturePixels
    static let maximumExpandedBytes = 12 + maximumHeaderBytes + maximumPayloadBytes
    static let maximumDownloadBytes = maximumExpandedBytes + 65_536
    static let maximumLevels = 16
    static let maximumChunks = 4096

    enum Failure: Error, Equatable {
        case sizeLimit, invalidJSON, unsupportedVersion, unsupportedProvider, unsupportedEncoding
        case invalidBounds, invalidDimensions, invalidTime, inconsistentMetadata, invalidManifest
        case unsafeURL, invalidBinary, truncatedBinary, invalidCompression, trailingBytes, cancelled
        case transport, httpStatus(Int), redirect, unexpectedResponse, requestLimit
    }

    struct Bounds: Codable, Equatable, Sendable {
        let minLat: Double
        let minLon: Double
        let maxLat: Double
        let maxLon: Double

        func validate() throws {
            guard [minLat, minLon, maxLat, maxLon].allSatisfy(\.isFinite),
                  minLon >= -180, maxLon <= 180, minLon < maxLon,
                  minLat >= -85.05112878, maxLat <= 85.05112878, minLat < maxLat else {
                throw Failure.invalidBounds
            }
        }
    }

    struct Encoding: Codable, Equatable, Sendable {
        let type: String
        let dbzMin: Double
        let dbzMax: Double
        let threshold: Double
        let noData: Int
        let valueMin: Int
        let valueMax: Int

        func numeric() throws -> RadarNumericContract.Encoding {
            guard type == "uint8-dbz", noData == 0, valueMin == 1, valueMax == 255 else {
                throw Failure.unsupportedEncoding
            }
            do { return try .init(dbzMin: dbzMin, dbzMax: dbzMax, threshold: threshold) }
            catch { throw Failure.unsupportedEncoding }
        }
    }

    enum Kind: String, Sendable { case observed, forecast, synthetic }
    enum TimeBinding: String, Sendable {
        /// Raw viewport NCRD carries source, kind and exact time in its own header.
        case embeddedAndManifest
        /// Legacy coverage NCRD carries no time/source identity; only its index
        /// supplies those fields. Never describe this as intrinsic content proof.
        case manifestOnly
    }
    struct Identity: Equatable, Sendable {
        let kind: Kind
        let sourceProvider: String
        let validTimeMilliseconds: Int64
        let sourceValidTime: String
        let cycleTimeMilliseconds: Int64?
        var canonicalValidTime: String { RadarNumericContract.isoTime(validTimeMilliseconds) }
        func observedAge(at now: Date) -> TimeInterval? {
            guard kind == .observed else { return nil }
            return now.timeIntervalSince1970 - Double(validTimeMilliseconds) / 1000
        }
    }

    struct Descriptor: Equatable, Sendable {
        let zoom: Int
        let x: Int
        let y: Int
        let chunkSize: Int
        let path: String
        let byteLength: Int
        let bounds: Bounds
        var key: String { "\(zoom)/\(x)/\(y)" }
    }
    struct Manifest: Sendable {
        let provider: String
        let identity: Identity
        let encoding: Encoding
        let bounds: Bounds
        let descriptors: [Descriptor]
        let timeBinding: TimeBinding
        let expectedViewportPixels: Int?
        var availableZooms: [Int] { Array(Set(descriptors.map(\.zoom))).sorted() }
    }
    // All stored data is immutable value storage, including Numeric.Texture's
    // [UInt8]; the pre-existing texture type itself predates Sendable annotation.
    struct DecodedChunk: @unchecked Sendable {
        let texture: RadarNumericContract.Texture
        let bounds: Bounds
        let encoding: Encoding
        let identity: Identity
        let timeBinding: TimeBinding
        let descriptor: Descriptor
    }

    private struct IndexJSON: Decodable {
        struct Source: Decodable { let kind: String? }
        struct Frame: Decodable {
            let kind: String?
            let provider: String?
            let validTime: String?
            let timestamp: String?
            let observedAt: String?
            let cycleTime: String?
            let sourceType: String?
        }
        struct Canonical: Decodable { let pixels: Int? }
        struct Level: Decodable {
            struct Chunk: Decodable { let x: Int; let y: Int; let path: String; let byteLength: Int; let bounds: Bounds }
            let zoom: Int
            let chunkSize: Int
            let chunkCount: Int
            let bounds: Bounds
            let chunks: [Chunk]
        }
        let provider: String
        let version: Int
        let product: String
        let source: Source?
        let bounds: Bounds
        let frame: Frame
        let valueEncoding: Encoding
        let canonical: Canonical?
        let levels: [Level]
    }
    private struct Header: Decodable {
        let provider: String
        let version: Int
        let width: Int
        let height: Int
        let bounds: Bounds
        let valueEncoding: Encoding
        let zoom: Int?
        let x: Int?
        let y: Int?
        let kind: String?
        let sourceProvider: String?
        let validTime: String?
        let timestamp: String?
        let visualMetric: String?
        let projection: String?
    }

    static func decodeManifest(_ data: Data) throws -> Manifest {
        guard !data.isEmpty, data.count <= maximumManifestBytes else { throw Failure.sizeLimit }
        try Task.checkCancellation()
        let index: IndexJSON = try json(data)
        guard index.version == 1 else { throw Failure.unsupportedVersion }
        try index.bounds.validate()
        _ = try index.valueEncoding.numeric()
        let identity: Identity
        let binding: TimeBinding
        let viewportPixels: Int?
        switch index.provider {
        case "nearcast-raw-map":
            guard let kindValue = index.frame.kind, let kind = Kind(rawValue: kindValue), kind != .synthetic,
                  let provider = index.frame.provider, let sourceTime = index.frame.validTime else { throw Failure.invalidManifest }
            // Derived seam frames are intentionally not accepted as raw model or
            // observed data until their separate provenance contract is ported.
            guard kind == .observed ? provider == "noaa-mrms-direct"
                    : ["noaa-hrrr-subhourly", "noaa-hrrr-zarr"].contains(provider) else { throw Failure.unsupportedProvider }
            let time = try parseTime(sourceTime)
            for alias in [index.frame.timestamp, index.frame.observedAt].compactMap({ $0 }) {
                guard try parseTime(alias) == time else { throw Failure.inconsistentMetadata }
            }
            if kind == .forecast, index.frame.observedAt != nil { throw Failure.inconsistentMetadata }
            let cycle = try index.frame.cycleTime.map(parseTime)
            if kind == .forecast {
                guard let cycle, cycle <= time else { throw Failure.invalidTime }
            } else if cycle != nil { throw Failure.inconsistentMetadata }
            identity = .init(kind: kind, sourceProvider: provider, validTimeMilliseconds: time,
                             sourceValidTime: sourceTime, cycleTimeMilliseconds: cycle)
            binding = .embeddedAndManifest
            guard let pixels = index.canonical?.pixels, pixels > 0, pixels <= maximumPayloadBytes,
                  index.levels.count == 1, index.levels.first?.zoom == 0,
                  index.levels.first?.chunks.count == 1 else { throw Failure.invalidManifest }
            viewportPixels = pixels
        case "nearcast-radar-coverage-chunks":
            guard let sourceTime = index.frame.observedAt else { throw Failure.invalidTime }
            let time = try parseTime(sourceTime)
            let kind: Kind
            let provider: String
            if index.frame.sourceType == "synthetic", index.source?.kind == "synthetic" {
                kind = .synthetic; provider = "synthetic"
            } else if index.frame.sourceType == "mrms-grib2", index.source?.kind == "url-or-latest",
                      index.product == "MergedReflectivityQCComposite_00.50" {
                kind = .observed; provider = "noaa-mrms-direct"
            } else { throw Failure.unsupportedProvider }
            identity = .init(kind: kind, sourceProvider: provider, validTimeMilliseconds: time,
                             sourceValidTime: sourceTime, cycleTimeMilliseconds: nil)
            binding = .manifestOnly; viewportPixels = nil
        default: throw Failure.unsupportedProvider
        }
        guard !index.levels.isEmpty, index.levels.count <= maximumLevels else { throw Failure.sizeLimit }
        var descriptors: [Descriptor] = []
        var zooms = Set<Int>(), keys = Set<String>(), paths = Set<String>()
        for level in index.levels {
            try Task.checkCancellation()
            guard (0...22).contains(level.zoom), zooms.insert(level.zoom).inserted,
                  level.chunkSize > 0, level.chunkSize <= 1024,
                  level.chunkCount == level.chunks.count, !level.chunks.isEmpty else { throw Failure.invalidManifest }
            try level.bounds.validate()
            guard descriptors.count + level.chunks.count <= maximumChunks else { throw Failure.sizeLimit }
            for chunk in level.chunks {
                guard chunk.x >= 0, chunk.y >= 0, chunk.x < (1 << level.zoom), chunk.y < (1 << level.zoom),
                      chunk.byteLength >= 12, chunk.byteLength <= maximumDownloadBytes else { throw Failure.invalidManifest }
                try validateRelativePath(chunk.path)
                try chunk.bounds.validate()
                let descriptor = Descriptor(zoom: level.zoom, x: chunk.x, y: chunk.y, chunkSize: level.chunkSize,
                                            path: chunk.path, byteLength: chunk.byteLength, bounds: chunk.bounds)
                guard keys.insert(descriptor.key).inserted, paths.insert(chunk.path).inserted else { throw Failure.invalidManifest }
                if binding == .embeddedAndManifest, chunk.bounds != index.bounds || level.bounds != index.bounds {
                    throw Failure.inconsistentMetadata
                }
                descriptors.append(descriptor)
            }
        }
        return .init(provider: index.provider, identity: identity, encoding: index.valueEncoding, bounds: index.bounds,
                     descriptors: descriptors, timeBinding: binding, expectedViewportPixels: viewportPixels)
    }

    static func decodeChunk(_ downloaded: Data, descriptor: Descriptor, manifest: Manifest) throws -> DecodedChunk {
        try Task.checkCancellation()
        guard manifest.descriptors.contains(descriptor) else { throw Failure.inconsistentMetadata }
        guard downloaded.count == descriptor.byteLength else { throw Failure.truncatedBinary }
        guard downloaded.count <= maximumDownloadBytes else { throw Failure.sizeLimit }
        let bytes = downloaded.starts(with: [0x1f, 0x8b]) ? try gunzip(downloaded) : downloaded
        guard bytes.count >= 12 else { throw Failure.truncatedBinary }
        guard bytes.prefix(4).elementsEqual([0x4e, 0x43, 0x52, 0x44]) else { throw Failure.invalidBinary }
        func unsigned(_ offset: Int, _ count: Int) -> Int {
            bytes[offset..<(offset + count)].reduce(0) { ($0 << 8) | Int($1) }
        }
        guard unsigned(4, 2) == 1 else { throw Failure.unsupportedVersion }
        let headerCount = unsigned(6, 2), payloadCount = unsigned(8, 4)
        guard headerCount > 0, headerCount <= maximumHeaderBytes, payloadCount > 0, payloadCount <= maximumPayloadBytes else {
            throw Failure.sizeLimit
        }
        let expectedLength = 12 + headerCount + payloadCount
        guard bytes.count >= expectedLength else { throw Failure.truncatedBinary }
        guard bytes.count == expectedLength else { throw Failure.trailingBytes }
        let header: Header = try json(bytes.subdata(in: 12..<(12 + headerCount)))
        guard header.version == 1 else { throw Failure.unsupportedVersion }
        guard header.width > 0, header.height > 0, header.width <= maximumPayloadBytes,
              header.height <= maximumPayloadBytes / header.width,
              header.width * header.height == payloadCount else { throw Failure.invalidDimensions }
        try header.bounds.validate()
        _ = try header.valueEncoding.numeric()
        guard header.bounds == descriptor.bounds, header.valueEncoding == manifest.encoding else { throw Failure.inconsistentMetadata }
        if manifest.timeBinding == .embeddedAndManifest {
            guard header.provider == "nearcast-raw-map", header.projection == "web-mercator-bounds",
                  header.kind == manifest.identity.kind.rawValue, header.sourceProvider == manifest.identity.sourceProvider,
                  let validTime = header.validTime, try parseTime(validTime) == manifest.identity.validTimeMilliseconds,
                  manifest.expectedViewportPixels == payloadCount,
                  max(header.width, header.height) == descriptor.chunkSize,
                  header.visualMetric == (manifest.identity.kind == .observed ? "reflectivity" : "simulated-reflectivity") else {
                throw Failure.inconsistentMetadata
            }
            if let timestamp = header.timestamp, try parseTime(timestamp) != manifest.identity.validTimeMilliseconds {
                throw Failure.inconsistentMetadata
            }
        } else {
            guard header.provider == "nearcast-radar-chunk", header.zoom == descriptor.zoom,
                  header.x == descriptor.x, header.y == descriptor.y,
                  header.width == descriptor.chunkSize, header.height == descriptor.chunkSize,
                  header.validTime == nil, header.kind == nil, header.sourceProvider == nil else { throw Failure.inconsistentMetadata }
        }
        try Task.checkCancellation()
        let texture = try RadarNumericContract.Texture(width: header.width, height: header.height,
                                                       bytes: Array(bytes[(12 + headerCount)...]))
        return .init(texture: texture, bounds: header.bounds, encoding: header.valueEncoding, identity: manifest.identity,
                     timeBinding: manifest.timeBinding, descriptor: descriptor)
    }

    static func resolve(_ descriptor: Descriptor, relativeTo indexURL: URL) throws -> URL {
        try validateRelativePath(descriptor.path)
        try validateHTTPS(indexURL)
        guard let resolved = URL(string: descriptor.path, relativeTo: indexURL)?.absoluteURL,
              origin(resolved) == origin(indexURL) else { throw Failure.unsafeURL }
        try validateHTTPS(resolved)
        return resolved
    }

    static func validateHTTPS(_ url: URL) throws {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: true), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.fragment == nil, parts.port == nil || parts.port == 443 else { throw Failure.unsafeURL }
    }

    static func origin(_ url: URL) -> String { "https://\(url.host?.lowercased() ?? ""):\(url.port ?? 443)" }

    private static func validateRelativePath(_ path: String) throws {
        // Existing generated paths use plain relative path components. Reject
        // URLs, queries, fragments and percent-encoded traversal rather than
        // letting a manifest introduce another provider or credential-bearing URL.
        guard !path.isEmpty, path.utf8.count <= 1024, !path.hasPrefix("/"),
              path.range(of: #"^[A-Za-z0-9_./-]+$"#, options: .regularExpression) != nil,
              path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw Failure.unsafeURL
        }
    }

    private static func parseTime(_ text: String) throws -> Int64 {
        do { return try RadarNumericContract.parseTime(text) }
        catch { throw Failure.invalidTime }
    }
    private static func json<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw Failure.invalidJSON }
    }

    /// Handles gzip, not zlib/raw deflate. A fixed output buffer plus an expansion
    /// ceiling prevents zip bombs; CRC/trailer, truncation and concatenated/trailing
    /// members are checked before returning any decoded bytes.
    private static func gunzip(_ data: Data) throws -> Data {
        var stream = z_stream()
        guard inflateInit2_(&stream, MAX_WBITS + 16, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw Failure.invalidCompression
        }
        defer { inflateEnd(&stream) }
        return try data.withUnsafeBytes { raw in
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: raw.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uInt(data.count)
            var result = Data(), buffer = [UInt8](repeating: 0, count: 16_384)
            while true {
                try Task.checkCancellation()
                let status: Int32 = buffer.withUnsafeMutableBytes { output in
                    stream.next_out = output.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(output.count)
                    return inflate(&stream, Z_NO_FLUSH)
                }
                let produced = buffer.count - Int(stream.avail_out)
                guard result.count + produced <= maximumExpandedBytes else { throw Failure.sizeLimit }
                result.append(contentsOf: buffer.prefix(produced))
                if status == Z_STREAM_END {
                    guard stream.avail_in == 0 else { throw Failure.trailingBytes }
                    return result
                }
                guard status == Z_OK, produced > 0 || stream.avail_in > 0 else { throw Failure.invalidCompression }
            }
        }
    }
}
