import Foundation

/// Narrow, bounded reader for the public HRRR archive's Zarr-v2/Blosc-v1 LZ4
/// chunks. No system codec, web worker, or executable downloaded code is used.
enum HRRRZarrCodec {
    static let maximumDecodedBytes = 8 * 1_024 * 1_024

    enum Failure: Error, Equatable {
        case invalidMetadata, unsupportedCodec, malformedChunk, sizeLimit
        case invalidNumericType, invalidNumericValue, invalidTime, invalidGeometry
        case noRun, noSteps, tooManyChunks
    }

    static func blosc(_ data: Data, expectedBytes: Int, elementBytes: Int) throws -> Data {
        guard expectedBytes > 0, expectedBytes <= maximumDecodedBytes, (1...16).contains(elementBytes),
              data.count >= 16, data.count <= maximumDecodedBytes + 65_536 else { throw Failure.sizeLimit }
        let input = [UInt8](data)
        let flags = input[2], typeSize = Int(input[3])
        let count = int32(input, 4), blockSize = int32(input, 8), compressed = int32(input, 12)
        guard input[0] == 2, input[1] == 1, flags & 0x0c == 0,
              typeSize == elementBytes, count == expectedBytes,
              blockSize > 0, blockSize <= count, compressed == input.count else { throw Failure.malformedChunk }
        if flags & 2 != 0 {
            guard input.count == count + 16 else { throw Failure.malformedChunk }
            return Data(input[16...])
        }
        // Blosc format enumeration 1 is LZ4/LZ4HC; 2 is Snappy, not LZ4.
        guard flags >> 5 == 1 else { throw Failure.unsupportedCodec }
        let blockCount = (count + blockSize - 1) / blockSize
        guard blockCount <= (input.count - 16) / 4 else { throw Failure.malformedChunk }
        let tableEnd = 16 + blockCount * 4
        var output = [UInt8](repeating: 0, count: count)
        var ranges: [Range<Int>] = []
        for index in 0..<blockCount {
            let offset = index * blockSize
            let blockBytes = min(blockSize, count - offset)
            let splitCount = flags & 0x10 == 0 && blockBytes == blockSize
                && typeSize <= 16 && blockSize / typeSize >= 128 ? typeSize : 1
            guard blockBytes % splitCount == 0 else { throw Failure.malformedChunk }
            let splitBytes = blockBytes / splitCount
            let start = int32(input, 16 + index * 4)
            guard start >= tableEnd, start <= input.count - 4 else { throw Failure.malformedChunk }
            var cursor = start
            var block = [UInt8]()
            block.reserveCapacity(blockBytes)
            for _ in 0..<splitCount {
                guard cursor <= input.count - 4 else { throw Failure.malformedChunk }
                let size = int32(input, cursor)
                cursor += 4
                guard size > 0, size <= input.count - cursor else { throw Failure.malformedChunk }
                if size == splitBytes {
                    block.append(contentsOf: input[cursor..<(cursor + size)])
                } else {
                    block.append(contentsOf: try lz4(input, offset: cursor, count: size, expected: splitBytes))
                }
                cursor += size
            }
            let range = start..<cursor
            ranges.append(range)
            if flags & 1 != 0 && typeSize > 1 {
                let elements = blockBytes / typeSize, mainBytes = elements * typeSize
                for byte in 0..<typeSize {
                    for element in 0..<elements {
                        output[offset + element * typeSize + byte] = block[byte * elements + element]
                    }
                }
                if mainBytes < blockBytes {
                    for byte in mainBytes..<blockBytes { output[offset + byte] = block[byte] }
                }
            } else {
                output.replaceSubrange(offset..<(offset + blockBytes), with: block)
            }
        }
        // Parallel Blosc writers may store blocks out of logical order. Accept
        // that, but reject overlaps, holes and trailing unaccounted payloads.
        var end = tableEnd
        for range in ranges.sorted(by: { $0.lowerBound < $1.lowerBound }) {
            guard range.lowerBound == end else { throw Failure.malformedChunk }
            end = range.upperBound
        }
        guard end == input.count else { throw Failure.malformedChunk }
        return Data(output)
    }

    private static func lz4(_ input: [UInt8], offset: Int, count: Int, expected: Int) throws -> [UInt8] {
        let end = offset + count
        var cursor = offset, output = [UInt8]()
        output.reserveCapacity(expected)
        func extensionLength(_ initial: Int) throws -> Int {
            var length = initial
            if initial == 15 {
                var extra: Int
                repeat {
                    guard cursor < end else { throw Failure.malformedChunk }
                    extra = Int(input[cursor]); cursor += 1
                    guard length <= expected - extra else { throw Failure.malformedChunk }
                    length += extra
                } while extra == 255
            }
            return length
        }
        while cursor < end {
            let token = input[cursor]; cursor += 1
            let literals = try extensionLength(Int(token >> 4))
            guard literals <= end - cursor, literals <= expected - output.count else { throw Failure.malformedChunk }
            output.append(contentsOf: input[cursor..<(cursor + literals)])
            cursor += literals
            if cursor == end { break }
            guard cursor <= end - 2 else { throw Failure.malformedChunk }
            let distance = Int(input[cursor]) | Int(input[cursor + 1]) << 8
            cursor += 2
            guard distance > 0, distance <= output.count else { throw Failure.malformedChunk }
            let length = try extensionLength(Int(token & 15)) + 4
            guard length <= expected - output.count else { throw Failure.malformedChunk }
            for _ in 0..<length { output.append(output[output.count - distance]) }
        }
        guard output.count == expected else { throw Failure.malformedChunk }
        return output
    }

    static func elementBytes(_ dtype: String) throws -> Int {
        switch dtype {
        case "<f4", ">f4", "<i4", ">i4", "<u4", ">u4": return 4
        case "<f8", ">f8", "<i8", ">i8", "<u8", ">u8": return 8
        default: throw Failure.invalidNumericType
        }
    }

    static func numbers(_ data: Data, dtype: String) throws -> [Double] {
        let size = try elementBytes(dtype)
        guard data.count % size == 0, data.count <= maximumDecodedBytes else { throw Failure.malformedChunk }
        let bytes = [UInt8](data), little = dtype.first == "<"
        return try stride(from: 0, to: bytes.count, by: size).map { offset in
            let bits = uint(bytes, offset, size, little)
            switch dtype.dropFirst() {
            case "f4": return Double(Float(bitPattern: UInt32(bits)))
            case "f8": return Double(bitPattern: bits)
            case "i4": return Double(Int32(bitPattern: UInt32(bits)))
            case "u4": return Double(bits)
            case "i8":
                let value = Int64(bitPattern: bits)
                guard value >= -9_007_199_254_740_991, value <= 9_007_199_254_740_991 else { throw Failure.invalidNumericValue }
                return Double(value)
            case "u8":
                guard bits <= 9_007_199_254_740_991 else { throw Failure.invalidNumericValue }
                return Double(bits)
            default: throw Failure.invalidNumericType
            }
        }
    }

    static func floats(_ data: Data, dtype: String) throws -> [Float] {
        guard dtype == "<f4" || dtype == ">f4", data.count % 4 == 0,
              data.count <= maximumDecodedBytes else { throw Failure.invalidNumericType }
        let bytes = [UInt8](data), little = dtype == "<f4"
        return stride(from: 0, to: bytes.count, by: 4).map { Float(bitPattern: UInt32(uint(bytes, $0, 4, little))) }
    }

    private static func uint(_ bytes: [UInt8], _ offset: Int, _ size: Int, _ little: Bool) -> UInt64 {
        var result: UInt64 = 0
        for index in 0..<size { result |= UInt64(bytes[offset + index]) << (8 * (little ? index : size - index - 1)) }
        return result
    }

    private static func int32(_ bytes: [UInt8], _ offset: Int) -> Int {
        Int(uint(bytes, offset, 4, true))
    }
}
