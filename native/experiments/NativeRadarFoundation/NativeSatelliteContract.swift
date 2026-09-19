import Foundation

enum NativeSatelliteProduct: String, CaseIterable, Sendable {
    case modisAqua
    case modisTerra

    var layerIdentifier: String {
        switch self {
        case .modisAqua: return "MODIS_Aqua_CorrectedReflectance_TrueColor"
        case .modisTerra: return "MODIS_Terra_CorrectedReflectance_TrueColor"
        }
    }

    var displayName: String {
        switch self {
        case .modisAqua: return "MODIS Aqua"
        case .modisTerra: return "MODIS Terra"
        }
    }
}

/// GIBS true-color layers are daily products. A calendar-only type prevents a
/// UI from presenting midnight/noon as a measured satellite overpass time.
struct NativeSatelliteAcquisitionDate: Equatable, Hashable, Sendable {
    let year: Int
    let month: Int
    let day: Int

    var iso8601: String { String(format: "%04d-%02d-%02d", year, month, day) }

    init?(year: Int, month: Int, day: Int) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = DateComponents(timeZone: calendar.timeZone, year: year, month: month, day: day)
        guard let date = calendar.date(from: components) else { return nil }
        let checked = calendar.dateComponents([.year, .month, .day], from: date)
        guard checked.year == year, checked.month == month, checked.day == day else { return nil }
        self.year = year; self.month = month; self.day = day
    }

    init?(iso8601: String) {
        guard iso8601.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil else {
            return nil
        }
        let parts = iso8601.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    static func daysAgo(_ days: Int, from now: Date) -> NativeSatelliteAcquisitionDate? {
        guard (0...3).contains(days), now.timeIntervalSince1970.isFinite else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(byAdding: .day, value: -days, to: now) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
        return .init(year: year, month: month, day: day)
    }
}

struct NativeSatelliteAttribution: Equatable, Sendable {
    let title: String
    let url: URL
}

enum NativeSatelliteContentKind: String, Equatable, Sendable {
    case acquiredTrueColorImagery
}

/// Renderer-ready satellite imagery. It replaces the weather raster while
/// selected and remains beneath the separately authorized CARTO label layer.
struct NativeSatelliteDescriptor: Equatable, Sendable {
    let id: String
    let product: NativeSatelliteProduct
    let acquisitionDate: NativeSatelliteAcquisitionDate
    let tileURLTemplates: [String]
    let tileSize: Int
    let minimumZoom: Int
    let maximumZoom: Int
    let attributions: [NativeSatelliteAttribution]
    let contentKind = NativeSatelliteContentKind.acquiredTrueColorImagery
    let suppressesPrecipitation = true

    var isRadar: Bool { false }
    var isForecast: Bool { false }
    var sourceLabel: String { "Satellite \(product.displayName)" }
}

enum NativeSatelliteUnavailableReason: Equatable, Sendable {
    case invalidCoordinate
    case noRecentLocalPass
    case transport
    case responseTooLarge
    case invalidResponse
    case cancelled
}

enum NativeSatelliteAvailability: Equatable, Sendable {
    case ready(NativeSatelliteDescriptor)
    case unavailable(NativeSatelliteUnavailableReason)
}

enum NativeSatelliteContract {
    static let origin = "https://gibs.earthdata.nasa.gov"
    static let tileMatrixSet = "GoogleMapsCompatible_Level9"
    static let tileSize = 256
    static let minimumZoom = 4
    static let maximumZoom = 9
    static let maximumProbeBytes = 2 * 1_024 * 1_024
    static let maximumProbeCount = 8
    static let mercatorLatitudeLimit = 85.05112878
    static let attribution = NativeSatelliteAttribution(
        title: "NASA Global Imagery Browse Services (GIBS)",
        url: URL(string: "https://nasa-gibs.github.io/gibs-api-docs/")!
    )

    struct Tile: Equatable, Sendable {
        let z: Int
        let x: Int
        let y: Int
    }

    static func probeTile(latitude: Double, longitude: Double) -> Tile? {
        guard latitude.isFinite, longitude.isFinite,
              (-mercatorLatitudeLimit...mercatorLatitudeLimit).contains(latitude),
              (-180...180).contains(longitude) else { return nil }
        let z = maximumZoom
        let count = 1 << z
        let radians = latitude * .pi / 180
        let projectedX = (longitude + 180) / 360 * Double(count)
        let projectedY = (1 - asinh(tan(radians)) / .pi) / 2 * Double(count)
        guard projectedX.isFinite, projectedY.isFinite else { return nil }
        return .init(z: z,
                     x: min(count - 1, max(0, Int(floor(projectedX)))),
                     y: min(count - 1, max(0, Int(floor(projectedY)))))
    }

    static func descriptor(product: NativeSatelliteProduct,
                           date: NativeSatelliteAcquisitionDate) -> NativeSatelliteDescriptor {
        .init(
            id: "nasa-gibs-\(product.rawValue)-\(date.iso8601)",
            product: product,
            acquisitionDate: date,
            tileURLTemplates: [tileTemplate(product: product, date: date)],
            tileSize: tileSize,
            minimumZoom: minimumZoom,
            maximumZoom: maximumZoom,
            attributions: [attribution]
        )
    }

    static func tileTemplate(product: NativeSatelliteProduct,
                             date: NativeSatelliteAcquisitionDate) -> String {
        "\(origin)/wmts/epsg3857/best/\(product.layerIdentifier)/default/\(date.iso8601)/\(tileMatrixSet)/{z}/{y}/{x}.jpeg"
    }

    static func probeURL(product: NativeSatelliteProduct, date: NativeSatelliteAcquisitionDate,
                         tile: Tile) -> URL? {
        guard tile.z == maximumZoom,
              (0..<(1 << tile.z)).contains(tile.x),
              (0..<(1 << tile.z)).contains(tile.y) else { return nil }
        return URL(string: tileTemplate(product: product, date: date)
            .replacingOccurrences(of: "{z}", with: String(tile.z))
            .replacingOccurrences(of: "{x}", with: String(tile.x))
            .replacingOccurrences(of: "{y}", with: String(tile.y)))
    }

    static func isAuthorizedTileURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "gibs.earthdata.nasa.gov",
              url.port == nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else { return false }
        let pieces = url.path.split(separator: "/").map(String.init)
        guard pieces.count == 10,
              Array(pieces[0...2]) == ["wmts", "epsg3857", "best"],
              NativeSatelliteProduct.allCases.contains(where: { $0.layerIdentifier == pieces[3] }),
              pieces[4] == "default",
              NativeSatelliteAcquisitionDate(iso8601: pieces[5]) != nil,
              pieces[6] == tileMatrixSet,
              let z = Int(pieces[7]), (0...maximumZoom).contains(z),
              let y = Int(pieces[8]),
              pieces[9].hasSuffix(".jpeg"),
              let x = Int(pieces[9].dropLast(5)),
              (0..<(1 << z)).contains(x), (0..<(1 << z)).contains(y) else { return false }
        return true
    }

    static func acceptsProbe(data: Data, mimeType: String?, requestedProduct: NativeSatelliteProduct,
                             requestedDate: NativeSatelliteAcquisitionDate,
                             requestedLayerHeader: String?, actualLayerHeader: String?,
                             requestedTimeHeader: String?, actualTimeHeader: String?) -> Bool {
        let type = mimeType?.lowercased().split(separator: ";", maxSplits: 1).first
            .map { $0.trimmingCharacters(in: .whitespaces) }
        let expectedLayer = requestedProduct.layerIdentifier
        guard let dimensions = jpegDimensions(data),
              type == "image/jpeg",
              requestedLayerHeader == expectedLayer,
              actualLayerHeader == expectedLayer || actualLayerHeader?.hasPrefix(expectedLayer + "_") == true,
              requestedTimeHeader == requestedDate.iso8601,
              actualTimeHeader == requestedDate.iso8601 + "T00:00:00Z",
              dimensions.0 == tileSize, dimensions.1 == tileSize else { return false }
        return true
    }

    private static func jpegDimensions(_ data: Data) -> (Int, Int)? {
        let bytes = [UInt8](data)
        guard bytes.count >= 12, bytes[0] == 0xff, bytes[1] == 0xd8,
              bytes[bytes.count - 2] == 0xff, bytes[bytes.count - 1] == 0xd9 else { return nil }
        let startOfFrame: Set<UInt8> = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
        var offset = 2
        while offset + 3 < bytes.count {
            guard bytes[offset] == 0xff else { return nil }
            while offset < bytes.count && bytes[offset] == 0xff { offset += 1 }
            guard offset < bytes.count else { return nil }
            let marker = bytes[offset]
            offset += 1
            if marker == 0xd9 || marker == 0xda { return nil }
            if marker == 0x01 || (0xd0...0xd7).contains(marker) { continue }
            guard offset + 1 < bytes.count else { return nil }
            let length = Int(bytes[offset]) << 8 | Int(bytes[offset + 1])
            guard length >= 2, offset + length <= bytes.count else { return nil }
            if startOfFrame.contains(marker) {
                guard length >= 7 else { return nil }
                let height = Int(bytes[offset + 3]) << 8 | Int(bytes[offset + 4])
                let width = Int(bytes[offset + 5]) << 8 | Int(bytes[offset + 6])
                return (width, height)
            }
            offset += length
        }
        return nil
    }
}
