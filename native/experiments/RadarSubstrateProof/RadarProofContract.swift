import Foundation

/// Deliberately independent of the shipping app: a raster substrate proof, not radar parity.
enum RadarProofError: Error, LocalizedError {
    case invalidTile, invalidTime, missingLayer, invalidResponse, nonImageTile
    var errorDescription: String? {
        switch self {
        case .invalidTile: return "The map requested a tile outside the supported world."
        case .invalidTime: return "The source did not provide a supported, explicit frame time."
        case .missingLayer: return "The requested weather layer has no usable times."
        case .invalidResponse: return "The weather source could not be loaded. Try again."
        case .nonImageTile: return "The weather source returned an error instead of a map tile."
        }
    }
}

struct RadarProofFrame: Equatable, Identifiable {
    enum Kind: String { case observed, accumulation }
    let kind: Kind
    let validTime: Date
    /// The exact advertised time is retained rather than replaced with the scrubber's time.
    let sourceTime: String
    let metadataFetchedAt: Date
    var id: String { "\(kind.rawValue):\(sourceTime)" }
    var title: String { kind == .observed ? "Observed radar" : "Forecast · 6-hour rain amount" }
    var attribution: String { kind == .observed ? "NOAA/NWS MRMS" : "NOAA/NWS NDFD" }
    var endpoint: String {
        kind == .observed
            ? "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows"
            : "https://nowcoast.noaa.gov/geoserver/forecasts/ndfd_precipitation/ows"
    }
    var layer: String { kind == .observed ? "conus_bref_qcd" : "conus_6hr_precipitation_amount" }
    var style: String { kind == .observed ? "radar_reflectivity" : "precipitation_amount" }
    var maximumZoom: Int { kind == .observed ? 8 : 7 }

    func tileURL(x: Int, y: Int, z: Int) throws -> URL {
        let bounds = try RadarProofProjection.bounds(x: x, y: y, z: z)
        var url = URLComponents(string: endpoint)!
        url.queryItems = [
            .init(name: "SERVICE", value: "WMS"), .init(name: "VERSION", value: "1.3.0"),
            .init(name: "REQUEST", value: "GetMap"), .init(name: "LAYERS", value: layer),
            .init(name: "STYLES", value: style), .init(name: "CRS", value: "EPSG:3857"),
            .init(name: "BBOX", value: bounds.map { String(format: "%.8f", locale: Locale(identifier: "en_US_POSIX"), $0) }.joined(separator: ",")),
            .init(name: "WIDTH", value: "256"), .init(name: "HEIGHT", value: "256"),
            .init(name: "FORMAT", value: "image/png"), .init(name: "TRANSPARENT", value: "true"),
            .init(name: "TIME", value: sourceTime)
        ]
        return url.url!
    }
}

enum RadarProofProjection {
    static let halfWorld = 20_037_508.342789244
    /// XYZ origin is top-left; WMS EPSG:3857 expects west,south,east,north in metres.
    static func bounds(x: Int, y: Int, z: Int) throws -> [Double] {
        guard (0...22).contains(z) else { throw RadarProofError.invalidTile }
        let count = 1 << z
        guard (0..<count).contains(x), (0..<count).contains(y) else { throw RadarProofError.invalidTile }
        let span = 2 * halfWorld / Double(count)
        let west = -halfWorld + Double(x) * span
        let north = halfWorld - Double(y) * span
        return [west, north - span, west + span, north]
    }
}

enum RadarProofTimes {
    static func parse(_ value: String) -> Date? {
        // ISO8601DateFormatter may accept a valid prefix before an interval suffix.
        // This proof consumes advertised instants only; unsupported ranges must stay unavailable.
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let time = parser.date(from: value) { return time }
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: value)
    }

    static func select(_ values: [String], kind: RadarProofFrame.Kind, now: Date) throws -> RadarProofFrame {
        let pairs = values.compactMap { value -> (String, Date)? in
            guard let time = parse(value) else { return nil }
            return (value, time)
        }.sorted { $0.1 < $1.1 }
        let selected = kind == .observed
            ? pairs.last(where: { $0.1 <= now })
            : pairs.first(where: { $0.1 > now })
        guard let selected else { throw RadarProofError.missingLayer }
        return RadarProofFrame(kind: kind, validTime: selected.1, sourceTime: selected.0, metadataFetchedAt: now)
    }
}

/// Parses only the matching layer's direct time dimension. Never use the WMS default time:
/// it can be the last forecast day, and a parent/sibling layer can advertise other intervals.
final class RadarProofCapabilities: NSObject, XMLParserDelegate {
    private struct Layer { var name = ""; var times: [String] = [] }
    private let target: String
    private var layers: [Layer] = []
    private var depth = 0
    private var layerDepths: [Int] = []
    private var collecting: String?
    private var text = ""
    private(set) var times: [String] = []
    init(layer: String) { target = layer }

    static func times(in data: Data, layer: String) throws -> [String] {
        let delegate = RadarProofCapabilities(layer: layer)
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse(), !delegate.times.isEmpty else { throw RadarProofError.missingLayer }
        return delegate.times
    }

    func parser(_ parser: XMLParser, didStartElement element: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        depth += 1
        if element == "Layer" { layers.append(Layer()); layerDepths.append(depth) }
        guard let layerDepth = layerDepths.last, depth == layerDepth + 1 else { return }
        if element == "Name" || (element == "Dimension" && attributes["name"] == "time") {
            collecting = element
            text = ""
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if collecting != nil { text += string }
    }

    func parser(_ parser: XMLParser, didEndElement element: String, namespaceURI: String?, qualifiedName: String?) {
        if element == collecting, !layers.isEmpty {
            if element == "Name" { layers[layers.count - 1].name = text.trimmingCharacters(in: .whitespacesAndNewlines) }
            if element == "Dimension" { layers[layers.count - 1].times = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } }
            collecting = nil
        }
        if element == "Layer", let layer = layers.popLast() {
            layerDepths.removeLast()
            if layer.name == target { times = layer.times }
        }
        depth -= 1
    }
}

enum RadarProofFixtures {
    static let now = RadarProofTimes.parse("2026-09-18T20:40:00Z")!
    static let observed = try! RadarProofTimes.select(["2026-09-18T20:34:11.000Z"], kind: .observed, now: now)
    static let forecast = try! RadarProofTimes.select(["2026-09-19T00:00:00.000Z"], kind: .accumulation, now: now)
}
