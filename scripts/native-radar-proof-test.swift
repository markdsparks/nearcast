import Foundation

@main
enum RadarProofTests {
    static func main() async throws {
        func near(_ a: Double, _ b: Double) { precondition(abs(a - b) < 0.0001, "Projection mismatch: \(a), \(b)") }
        let world = try RadarProofProjection.bounds(x: 0, y: 0, z: 0)
        near(world[0], -RadarProofProjection.halfWorld)
        near(world[1], -RadarProofProjection.halfWorld)
        near(world[2], RadarProofProjection.halfWorld)
        near(world[3], RadarProofProjection.halfWorld)
        let nw = try RadarProofProjection.bounds(x: 0, y: 0, z: 1)
        near(nw[1], 0); near(nw[2], 0)
        let se = try RadarProofProjection.bounds(x: 1, y: 1, z: 1)
        near(se[0], 0); near(se[3], 0)
        for tile in [(-1, 0, 1), (2, 0, 1), (0, 2, 1), (0, 0, 23)] {
            do { _ = try RadarProofProjection.bounds(x: tile.0, y: tile.1, z: tile.2); preconditionFailure("Invalid tile accepted") }
            catch RadarProofError.invalidTile { }
        }
        let url = try RadarProofFixtures.observed.tileURL(x: 1, y: 1, z: 2)
        let values = Dictionary(uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
        precondition(values["CRS"] == "EPSG:3857")
        precondition(values["TIME"] == "2026-09-18T20:34:11.000Z")
        precondition(values["LAYERS"] == "conus_bref_qcd")
        precondition(values["BBOX"]!.split(separator: ",").count == 4)
        precondition(RadarProofFixtures.forecast.title.contains("6-hour"))
        precondition(RadarProofFixtures.forecast.sourceTime != RadarProofFixtures.observed.sourceTime)
        let xml = """
        <WMS_Capabilities><Capability><Layer><Name>parent</Name><Dimension name="time">2000-01-01T00:00:00Z</Dimension>
        <Layer><Name>unrelated</Name><Dimension name="time">2001-01-01T00:00:00Z</Dimension></Layer>
        <Layer><Name>conus_bref_qcd</Name><Dimension name="time" default="2099-01-01T00:00:00Z">2026-09-18T20:34:11.000Z, 2026-09-18T20:38:00Z, garbage, 2099-01-01T00:00:00Z</Dimension></Layer>
        </Layer></Capability></WMS_Capabilities>
        """
        let times = try RadarProofCapabilities.times(in: Data(xml.utf8), layer: "conus_bref_qcd")
        precondition(times.count == 4 && !times.contains("2000-01-01T00:00:00Z"))
        let observed = try RadarProofTimes.select(times, kind: .observed, now: RadarProofFixtures.now)
        precondition(observed.sourceTime == "2026-09-18T20:38:00Z", "Future/default radar time chosen")
        let future = try RadarProofTimes.select(["2026-09-18T18:00:00Z", "2026-09-19T06:00:00Z", "2026-09-19T00:00:00Z"], kind: .accumulation, now: RadarProofFixtures.now)
        precondition(future.sourceTime == "2026-09-19T00:00:00Z")
        do { _ = try RadarProofTimes.select(["bad", "2026-09-18T20:00:00Z/2026-09-19T20:00:00Z/PT1H"], kind: .observed, now: RadarProofFixtures.now); preconditionFailure("Fabricated interval frames") }
        catch RadarProofError.missingLayer { }
        do { _ = try RadarProofCapabilities.times(in: Data(xml.utf8), layer: "missing"); preconditionFailure("Missing layer accepted") }
        catch RadarProofError.missingLayer { }
        print("PASS Native radar proof: Web Mercator XYZ/WMS bounds, exact source times, layer isolation, observed/accumulation semantics, invalid/missing data")
        if CommandLine.arguments.contains("--live") {
            for kind in [RadarProofFrame.Kind.observed, .accumulation] {
                let template = kind == .observed ? RadarProofFixtures.observed : RadarProofFixtures.forecast
                let endpoint = kind == .observed ? template.endpoint : "https://nowcoast.noaa.gov/geoserver/ndfd_precipitation/wms"
                let url = URL(string: endpoint + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities")!
                let (xml, metadataResponse) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 25))
                precondition((metadataResponse as? HTTPURLResponse)?.statusCode == 200)
                let times = try RadarProofCapabilities.times(in: xml, layer: template.layer)
                let frame = try RadarProofTimes.select(times, kind: kind, now: Date())
                let tileURL = try frame.tileURL(x: 16, y: 24, z: 6)
                let (png, tileResponse) = try await URLSession.shared.data(for: URLRequest(url: tileURL, timeoutInterval: 25))
                precondition((tileResponse as? HTTPURLResponse)?.statusCode == 200)
                precondition(Array(png.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10], "WMS did not return a PNG")
                print("PASS Live NOAA \(kind.rawValue): source valid \(frame.sourceTime), \(png.count)-byte PNG at z6/16/24")
            }
        }
    }
}
