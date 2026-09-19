import Foundation

/// Pure presentation policies shared by the opt-in native weather view and its
/// portable tests. These helpers never infer a source timestamp or clear weather.
enum NativeRadarPresentationContract {
    enum Failure: Error, Equatable {
        case invalidSource, invalidTime, invalidDates, invalidGap
        case invalidViewport, invalidPixel, invalidLegend
    }

    enum Position { case first, last }

    /// Combine real observations with future guidance. No synthetic Now frame,
    /// repeated last scan, or interpolation fills the source boundary.
    static func integratedDates(observed: [Date], forecast: [Date], now: Date, hours: Int = 6) throws -> [Date] {
        try validateDates(observed); try validateDates(forecast); try validateTime(now)
        guard hours == 1 || hours == 6 else { throw Failure.invalidGap }
        return observed.filter { $0 <= now } + forecast.filter { $0 > now && $0 <= now.addingTimeInterval(Double(hours) * 3600) }
    }

    static func nearestScrubberDate(_ requested: Date, dates: [Date]) throws -> Date? {
        try validateTime(requested); try validateDates(dates)
        return dates.min { abs($0.timeIntervalSince(requested)) < abs($1.timeIntervalSince(requested)) }
    }

    struct Selection: Equatable {
        let sourceID: String
        let instant: Date?

        init(sourceID: String, instant: Date?) throws {
            guard !sourceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  sourceID.utf8.count <= 128 else { throw Failure.invalidSource }
            if let instant { try validateTime(instant) }
            self.sourceID = sourceID
            self.instant = instant
        }
    }

    enum PlaybackDecision: Equatable {
        case advance(Date)
        case end
        case missingSelection
        case gap
        case unavailable
    }

    /// Pass the CURRENT selection when the response completes, not a snapshot
    /// captured at request start. An older source's response cannot select a time
    /// in a source the user switched to. A nonnil instant remains exact even when
    /// absent: the UI must show unavailable until the user makes another choice.
    static func reconcileRefresh(current: Selection, refreshedSourceID: String,
                                 availableDates: [Date], defaultPosition: Position) throws -> Selection {
        try validateDates(availableDates)
        guard current.sourceID == refreshedSourceID, current.instant == nil else { return current }
        return try Selection(sourceID: current.sourceID,
                             instant: defaultPosition == .first ? availableDates.first : availableDates.last)
    }

    /// An explicit user source choice may establish that source's default frame;
    /// this is intentionally a different operation from refresh reconciliation.
    static func selectSource(id: String, dates: [Date], position: Position) throws -> Selection {
        try validateDates(dates)
        return try Selection(sourceID: id, instant: position == .first ? dates.first : dates.last)
    }

    static func selectedIndex(instant: Date?, dates: [Date]) throws -> Int? {
        try validateDates(dates)
        guard let instant else { return nil }
        try validateTime(instant)
        var low = 0, high = dates.count
        while low < high {
            let middle = (low + high) / 2
            if dates[middle] < instant { low = middle + 1 } else { high = middle }
        }
        return low < dates.count && dates[low] == instant ? low : nil
    }

    /// A slider requires an in-range thumb even while an exact selection is
    /// unavailable. This is VISUAL ONLY: never use the fallback 0 to choose an
    /// image, timestamp, accessibility value, or playback source identity.
    static func sliderIndex(instant: Date?, dates: [Date]) throws -> Int? {
        let selected = try selectedIndex(instant: instant, dates: dates)
        return dates.isEmpty ? nil : (selected ?? 0)
    }

    /// Short endpoint dwell makes a loop reset distinct from forward storm motion.
    static func playbackDwellMilliseconds(atEnd: Bool) -> Int { atEnd ? 800 : 400 }

    static func nextPlayback(instant: Date?, dates: [Date], maximumGap: TimeInterval, loops: Bool = false) throws -> PlaybackDecision {
        guard maximumGap.isFinite, maximumGap > 0 else { throw Failure.invalidGap }
        let selected = try selectedIndex(instant: instant, dates: dates)
        guard !dates.isEmpty else { return .unavailable }
        guard let selected else { return .missingSelection }
        guard selected + 1 < dates.count else {
            return loops && dates.count > 1 ? .advance(dates[0]) : .end
        }
        guard dates[selected + 1].timeIntervalSince(dates[selected]) <= maximumGap else { return .gap }
        return .advance(dates[selected + 1])
    }

    /// Evaluate future membership only against an explicit clock snapshot. A
    /// computed property calling Date() independently for labels and images can
    /// otherwise change index identity between two reads at an hourly boundary.
    static func futureDates(advertised: [Date], evaluatedAt: Date) throws -> [Date] {
        try validateDates(advertised)
        try validateTime(evaluatedAt)
        return advertised.filter { $0 > evaluatedAt }
    }

    static func validateDates(_ dates: [Date]) throws {
        guard dates.count <= 4_096 else { throw Failure.invalidDates }
        var previous: Date?
        for date in dates {
            try validateTime(date)
            if let previous, date <= previous { throw Failure.invalidDates }
            previous = date
        }
    }

    /// Downsample metadata without dropping an exact time the user is viewing.
    /// The retained time must still be advertised; never manufacture a frame.
    static func boundedDates(_ dates: [Date], retaining instant: Date?, limit: Int) throws -> [Date] {
        try validateDates(dates)
        guard (3...24).contains(limit) else { throw Failure.invalidDates }
        if let instant { try validateTime(instant) }
        guard dates.count > limit else { return dates }
        var chosen = (0..<limit).map { index in
            dates[Int((Double(index) * Double(dates.count - 1) / Double(limit - 1)).rounded())]
        }
        if let instant, dates.contains(instant), !chosen.contains(instant),
           let replace = (1..<(chosen.count - 1)).min(by: {
               abs(chosen[$0].timeIntervalSince(instant)) < abs(chosen[$1].timeIntervalSince(instant))
           }) {
            chosen[replace] = instant
            chosen.sort()
        }
        return chosen
    }

    private static func validateTime(_ date: Date) throws {
        guard date.timeIntervalSince1970.isFinite else { throw Failure.invalidTime }
    }

    struct PixelCoordinate: Equatable, Sendable {
        let longitude: Double
        let latitude: Double
    }

    struct Viewport: Equatable, Sendable {
        let west: Double, south: Double, east: Double, north: Double
        private let mercatorNorth: Double, mercatorSouth: Double

        /// Requires already-normalized [-180,180] longitudes and the native map's
        /// supported [-80,80] latitudes. Dateline-wrapped/empty/degenerate views
        /// fail explicitly; silently swapping or wrapping corners would misplace
        /// weather. Coordinates are edges, not the centers of outer pixels.
        init(west: Double, south: Double, east: Double, north: Double) throws {
            guard [west, south, east, north].allSatisfy(\.isFinite),
                  west >= -180, east <= 180, west < east,
                  south >= -80, north <= 80, south < north else { throw Failure.invalidViewport }
            self.west = west; self.south = south; self.east = east; self.north = north
            mercatorNorth = log(tan(.pi / 4 + north * .pi / 360))
            mercatorSouth = log(tan(.pi / 4 + south * .pi / 360))
            guard mercatorNorth.isFinite, mercatorSouth.isFinite, mercatorNorth > mercatorSouth else { throw Failure.invalidViewport }
        }

        /// North-up Web Mercator target pixel center. The source's own geographic
        /// projection/sampler must be called with this lon/lat; it is not a claim
        /// that the HRRR Lambert grid itself is rectangular in geographic space.
        func pixelCenter(column: Int, row: Int, width: Int, height: Int) throws -> PixelCoordinate {
            guard width > 0, height > 0, width <= 4_096, height <= 4_096,
                  column >= 0, row >= 0, column < width, row < height else { throw Failure.invalidPixel }
            let longitude = west + (east - west) * (Double(column) + 0.5) / Double(width)
            let y = mercatorNorth + (mercatorSouth - mercatorNorth) * (Double(row) + 0.5) / Double(height)
            let latitude = (2 * atan(exp(y)) - .pi / 2) * 180 / .pi
            guard longitude.isFinite, latitude.isFinite else { throw Failure.invalidPixel }
            return PixelCoordinate(longitude: longitude, latitude: latitude)
        }
    }

    struct LegendBand: Equatable {
        let upperDBZ: Double
        /// Color is read from the actual CPU renderer, not a decorative gradient.
        /// Use RGB for opaque swatches; alpha still records the source renderer's
        /// result at this band's representative dBZ (low returns can fade).
        let rgba: [UInt8]
    }

    /// Only the native numeric CPU `resolvedRGBA` reflectivity palette. Not a
    /// NOAA WMS radar/QPF legend, precipitation rate conversion, or rain total.
    /// Threshold boundaries are checked against EVERY encoded byte in tests so
    /// any renderer-palette change requires this legend contract to stay aligned.
    static func resolvedLegendBands(encoding: RadarNumericContract.Encoding) throws -> [LegendBand] {
        let stops: [Double] = [8, 16, 28, 36, 45, 56, 68, 80]
        guard encoding.dbzMin == 0, encoding.dbzMax == 80, encoding.threshold == 5 else { throw Failure.invalidLegend }
        var lower = encoding.threshold
        return try stops.map { upper in
            let representative = (lower + upper) / 2
            lower = upper
            let byte = try RadarNumericContract.encodeDbz(representative, encoding: encoding)
            let texture = try RadarNumericContract.Texture(width: 1, height: 1, bytes: [byte])
            let rgba = try RadarNumericContract.resolvedRGBA(texture, encoding: encoding)
            return LegendBand(upperDBZ: upper, rgba: rgba)
        }
    }

    static func highDetailLegendBands(encoding: RadarNumericContract.Encoding, zoom: Double) throws -> [LegendBand] {
        let stops: [Double] = [10, 18, 28, 36, 45, 56, 68, 80]
        var lower = encoding.threshold
        return try stops.map { upper in
            let value = (lower + upper) / 2
            lower = upper
            let texture = try RadarNumericContract.Texture(width: 1, height: 1,
                bytes: [RadarNumericContract.encodeDbz(value, encoding: encoding)])
            return LegendBand(upperDBZ: upper, rgba: try RadarNumericContract.highDetailRGBA(texture,
                encoding: encoding, validDataMask: [1], zoom: zoom))
        }
    }
}
