import Foundation

/// Bounded native reader of the same public NOAA HRRR bucket as the web adapter.
/// HTTP transport is shared with NCRD: streaming byte caps, exact-origin allowlist,
/// no redirects, no cookies/credentials, cancellation and short request deadlines.
/// No cache is retained; callers own their small selected-frame result.
actor HRRRZarrClient {
    typealias Contract = HRRRZarrContract
    typealias Failure = HRRRZarrCodec.Failure

    struct LoadedRun: Sendable {
        let run: Contract.Run
        let grid: Contract.Grid
    }

    struct Field: Sendable {
        let loaded: LoadedRun
        let steps: [Contract.Step]
        let chunks: [Contract.Chunk]

        /// Explicit nearest source-cell sampling. Reproject each target Mercator
        /// pixel through this function; drawing only four LCC corners is inaccurate.
        /// nil means missing/unloaded/outside, NOT a zero-rain measurement.
        func sample(longitude: Double, latitude: Double, sourceIndex: Int) -> Float? {
            guard let point = try? loaded.grid.projection.project(.init(longitude: longitude, latitude: latitude)) else { return nil }
            return sampleProjected(x: point.x, y: point.y, sourceIndex: sourceIndex)
        }

        func sampleProjected(x: Double, y: Double, sourceIndex: Int) -> Float? {
            guard x.isFinite, y.isFinite,
                  let selectedIndex = steps.firstIndex(where: { $0.sourceIndex == sourceIndex }) else { return nil }
            let grid = loaded.grid
            let column = (x - grid.x[0]) / grid.xSpacing, row = (y - grid.y[0]) / grid.ySpacing
            guard column >= -0.5, row >= -0.5,
                  column < Double(grid.x.count) - 0.5, row < Double(grid.y.count) - 0.5 else { return nil }
            let ix = Int(floor(column + 0.5)), iy = Int(floor(row + 0.5))
            for chunk in chunks {
                let localX = ix - chunk.descriptor.gridOffsetX, localY = iy - chunk.descriptor.gridOffsetY
                if localX >= 0, localY >= 0,
                   localX < chunk.descriptor.logicalWidth, localY < chunk.descriptor.logicalHeight {
                    return chunk.value(step: selectedIndex, x: localX, y: localY)
                }
            }
            return nil
        }
    }

    private let transport: RadarChunkClient
    private var busy = false

    init(configuration: URLSessionConfiguration = .ephemeral) throws {
        transport = try RadarChunkClient(allowedOrigins: [Contract.bucket], configuration: configuration)
    }

    /// Discovers by bounded deterministic hourly candidates, newest first. A
    /// metadata/coordinate outage fails that candidate; no hardcoded grid/time
    /// fallback is substituted. Root UI must still apply its freshness policy.
    func loadLatest(now: Date = Date(), maximumLookbackHours: Int = 6) async throws -> LoadedRun {
        guard !busy else { throw RadarChunkContract.Failure.requestLimit }
        guard (1...12).contains(maximumLookbackHours), now.timeIntervalSince1970.isFinite else { throw Failure.invalidTime }
        busy = true
        defer { busy = false }
        let hour = floor(now.timeIntervalSince1970 / 3_600) * 3_600
        // Projection is fetched once for this operation. Failure is not replaced
        // with an assumed projection, even though the current parameters are known.
        let projectionBytes = try await transport.fetchBytes(at: Contract.bucket.appendingPathComponent("grid/projparams.json"), maximumBytes: 4_096)
        let projection = try Contract.Projection(data: projectionBytes)
        for offset in 0..<maximumLookbackHours {
            try Task.checkCancellation()
            let cycleTime = Date(timeIntervalSince1970: hour - Double(offset) * 3_600)
            do {
                let candidate = try Contract.candidate(cycleTime: cycleTime)
                let metadata = try await transport.fetchBytes(at: candidate.root.appendingPathComponent(".zmetadata"), maximumBytes: 262_144)
                let run = try Contract.decodeMetadata(metadata, cycleTime: cycleTime)
                let grid = try await loadGrid(run: run, projection: projection)
                guard grid.steps.count >= 6, grid.steps.contains(where: { $0.validTime > now }) else { continue }
                return LoadedRun(run: run, grid: grid)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                try Task.checkCancellation()
                // A run still being published may have incomplete metadata or
                // coordinates. The next explicit cycle is separately validated.
                continue
            }
        }
        throw Failure.noRun
    }

    /// Fetches only advertised source indices, never nearest/inferred timestamps.
    /// All selected data must succeed before a Field is returned. No partial field
    /// is silently presented as clear weather. At most 8 frames × 8 chunks retained.
    func load(run loaded: LoadedRun, bounds: Contract.Bounds, sourceIndexes: [Int], maximumChunks: Int = 4) async throws -> Field {
        guard !busy else { throw RadarChunkContract.Failure.requestLimit }
        guard !sourceIndexes.isEmpty, sourceIndexes.count <= 8,
              Set(sourceIndexes).count == sourceIndexes.count,
              sourceIndexes.allSatisfy({ loaded.grid.steps.indices.contains($0) }) else { throw Failure.noSteps }
        busy = true
        defer { busy = false }
        try Task.checkCancellation()
        let run = loaded.run, spec = run.reflectivity
        let steps = sourceIndexes.sorted().map { loaded.grid.steps[$0] }
        let descriptors = try Contract.descriptors(run: run, grid: loaded.grid, bounds: bounds, maximumChunks: maximumChunks)
        guard !descriptors.isEmpty else { throw Failure.invalidGeometry }
        let timeChunks = Set(steps.map { $0.sourceIndex / spec.chunks[0] }).sorted()
        // Limits total requests too, even if future metadata changes time chunking.
        guard timeChunks.count * descriptors.count <= 16 else { throw Failure.tooManyChunks }
        let plane = spec.chunks[1] * spec.chunks[2]
        var result: [Contract.Chunk] = []
        // Spatial chunks are independent. Two lanes match the transport cap;
        // there is no unbounded fan-out or partially published forecast field.
        for start in stride(from: 0, to: descriptors.count, by: 2) {
            try Task.checkCancellation()
            let batch = Array(descriptors[start..<min(descriptors.count, start + 2)].enumerated())
            let chunks = try await withThrowingTaskGroup(of: (Int, Contract.Chunk).self) { group in
                for (index, descriptor) in batch {
                    group.addTask { [transport] in
                        var values = [Float](repeating: .nan, count: steps.count * plane)
                        for timeChunk in timeChunks {
                            try Task.checkCancellation()
                            let key = "\(timeChunk).\(descriptor.chunkY).\(descriptor.chunkX)"
                            let url = run.productRoot.appendingPathComponent("\(Contract.reflectivityPath)/\(key)")
                            let encoded = try await transport.fetchBytes(at: url, maximumBytes: spec.decodedBytes + 65_536)
                            let decoded = try spec.decode(encoded)
                            let numeric = try HRRRZarrCodec.floats(decoded, dtype: spec.dtype)
                            for (outputIndex, step) in steps.enumerated() where step.sourceIndex / spec.chunks[0] == timeChunk {
                                let sourceStart = (step.sourceIndex % spec.chunks[0]) * plane
                                guard sourceStart <= numeric.count - plane else { throw Failure.malformedChunk }
                                values.replaceSubrange((outputIndex * plane)..<((outputIndex + 1) * plane),
                                                       with: numeric[sourceStart..<(sourceStart + plane)])
                            }
                        }
                        try Task.checkCancellation()
                        return (index, Contract.Chunk(descriptor: descriptor, width: spec.chunks[2], height: spec.chunks[1],
                                                     steps: steps, values: values, fillValue: spec.fillValue))
                    }
                }
                var loaded: [(Int, Contract.Chunk)] = []
                for try await chunk in group { loaded.append(chunk) }
                return loaded.sorted { $0.0 < $1.0 }.map(\.1)
            }
            result += chunks
        }
        try Task.checkCancellation()
        return Field(loaded: loaded, steps: steps, chunks: result)
    }

    private func loadGrid(run: Contract.Run, projection: Contract.Projection) async throws -> Contract.Grid {
        var arrays: [String: [Double]] = [:]
        for start in stride(from: 0, to: Contract.coordinatePaths.count, by: 2) {
            try Task.checkCancellation()
            let paths = Array(Contract.coordinatePaths[start..<min(Contract.coordinatePaths.count, start + 2)])
            let values = try await withThrowingTaskGroup(of: (String, [Double]).self) { group in
                for path in paths {
                    guard let spec = run.coordinates[path] else { throw Failure.invalidMetadata }
                    group.addTask { [transport] in
                        let encoded = try await transport.fetchBytes(at: run.productRoot.appendingPathComponent("\(path)/0"),
                                                                    maximumBytes: spec.decodedBytes + 65_536)
                        return (path, try HRRRZarrCodec.numbers(spec.decode(encoded), dtype: spec.dtype))
                    }
                }
                var loaded: [String: [Double]] = [:]
                for try await (path, numbers) in group { loaded[path] = numbers }
                return loaded
            }
            arrays.merge(values, uniquingKeysWith: { _, new in new })
        }
        return try Contract.Grid(run: run, projection: projection, arrays: arrays)
    }
}
