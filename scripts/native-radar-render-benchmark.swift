import Foundation

/// Synthetic CPU-stage benchmark, not an iPhone/network or end-to-end map SLA.
@main
enum NativeRadarRenderBenchmark {
    static func main() throws {
        let width = 512, height = 672
        let encoding = try RadarNumericContract.Encoding()
        let mask = [UInt8](repeating: 1, count: width * height)
        var checksum: UInt64 = 0
        for density in [20, 100] {
            let bytes: [UInt8] = (0..<(width * height)).map { index in
                let mixed = (index &* 73 &+ (index / width) &* 17) % 100
                return mixed < density ? UInt8(40 + index % 190) : 1
            }
            let texture = try RadarNumericContract.Texture(width: width, height: height, bytes: bytes)
            var durations: [Double] = []
            for _ in 0..<3 {
                let start = DispatchTime.now().uptimeNanoseconds
                let rgba = try RadarNumericContract.highDetailRGBA(texture, encoding: encoding, validDataMask: mask, zoom: 7)
                durations.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
                // Include every pixel, outside the measured stage.
                for byte in rgba { checksum = (checksum &* 1_099_511_628_211) ^ UInt64(byte) }
            }
            print("coverage=\(density)% render_ms=\(durations.map { String(format: "%.2f", $0) }.joined(separator: ","))")
        }
        print("checksum=\(checksum)")
    }
}
