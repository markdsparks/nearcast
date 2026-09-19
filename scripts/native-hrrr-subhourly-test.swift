import Foundation

@main enum SubhourlyTests {
    static func main() async throws {
        let cycle = ISO8601DateFormatter().date(from: "2026-09-18T12:00:00Z")!
        let rows = ["1:0:d=2026091812:REFC:entire atmosphere:15 min fcst:",
                    "2:100:d=2026091812:REFC:entire atmosphere:30 min fcst:",
                    "3:200:d=2026091812:REFC:entire atmosphere:45 min fcst:",
                    "4:300:d=2026091812:REFC:entire atmosphere:60 min fcst:",
                    "5:400:d=2026091812:TMP:surface:60 min fcst:"].joined(separator: "\n")
        let frames = try HRRRSubhourly.parseIndex(Data(rows.utf8), cycle: cycle, hour: 1)
        precondition(frames.map(\.leadMinutes) == [15,30,45,60])
        precondition(frames[0].range == 0...99 && frames[3].range == 300...399)
        for bad in [rows.replacingOccurrences(of: "15 min", with: "16 min"),
                    rows.replacingOccurrences(of: "d=2026091812", with: "d=2026091811"),
                    rows.replacingOccurrences(of: "2:100", with: "2:0"),
                    rows.replacingOccurrences(of: "5:400", with: "5:99999999")] {
            do { _ = try HRRRSubhourly.parseIndex(Data(bad.utf8), cycle: cycle, hour: 1); fatalError("Accepted bad index") }
            catch HRRRSubhourly.Failure.invalidIndex { }
        }
        do {
            _ = try HRRRSubhourly.decode(Data(repeating: 0, count: 100), frame: frames[0],
                bounds: .init(west: -91, south: 38, east: -89, north: 40))
            fatalError("Accepted malformed GRIB")
        } catch { }
        print("PASS real quarter-hour index selection, bounded ranges, invalid metadata/GRIB rejection")
        if let directory = ProcessInfo.processInfo.environment["NEARCAST_HRRR15_FIXTURE"] {
            let base = URL(fileURLWithPath: directory)
            let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: base.appendingPathComponent("metadata.json"))) as! [String: Any]
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let frame = HRRRSubhourly.Frame(url: URL(string: metadata["url"] as! String)!,
                range: (metadata["start"] as! Int)...(metadata["end"] as! Int),
                cycle: formatter.date(from: metadata["cycle"] as! String)!, leadMinutes: metadata["leadMinutes"] as! Int)
            let actual = try HRRRSubhourly.decode(Data(contentsOf: base.appendingPathComponent("record.grib2")), frame: frame,
                bounds: .init(west: -105, south: 30, east: -85, north: 44), width: 160, height: 120)
            let expected = Array(try Data(contentsOf: base.appendingPathComponent("expected.bin")))
            precondition(actual.texture.bytes == expected, "Native forecast differs from established web decoder")
            print("PASS all 19,200 native pixels match independent web decoder")
        }
        if CommandLine.arguments.contains("--live") {
            let client = try HRRRSubhourlyClient()
            let advertised = try await client.discover(now: Date())
            precondition(advertised.count == 24)
            for i in 1..<advertised.count { precondition(advertised[i].validTime.timeIntervalSince(advertised[i-1].validTime) == 900) }
            for frame in advertised.prefix(4) {
                let decoded = try await client.load(frame, bounds: .init(west: -93, south: 36, east: -87, north: 41))
                precondition(decoded.validDataMask.contains(1))
                print("PASS live frame \(decoded.validTime), \(frame.range.count) bytes; coverage \(decoded.validDataMask.filter { $0 == 1 }.count)")
            }
        }
    }
}
