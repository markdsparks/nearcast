import Foundation

@main
struct NativeRadarPresentationTests {
    typealias Contract = NativeRadarPresentationContract
    static func main() throws {
        try selectionTests()
        try boundedHistoryTests()
        try playbackTests()
        try viewportTests()
        try legendTests()
        print("PASS Native radar presentation: exact identity/source races, missing-safe playback, Mercator centers and renderer-matched legend")
    }
    static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        if try !condition() { throw NSError(domain: "NativeRadarPresentationTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func rejects(_ message: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { return }
        throw NSError(domain: "NativeRadarPresentationTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Accepted invalid \(message)"])
    }
    static func date(_ minutes: Double) -> Date { Date(timeIntervalSince1970: 1_789_776_000 + minutes * 60) }

    static func boundedHistoryTests() throws {
        let advertised = (0..<20).map { date(Double($0) * 2) }
        for selected in advertised {
            let sampled = try Contract.boundedDates(advertised, retaining: selected, limit: 6)
            try check(sampled.count == 6 && Set(sampled).count == 6, "history stays within six unique frames")
            try check(sampled.first == advertised.first && sampled.last == advertised.last, "history retains both endpoints")
            try check(sampled.contains(selected), "refresh sampling preserves the exact viewed frame")
            try check(sampled == sampled.sorted() && sampled.allSatisfy(advertised.contains), "history is ordered actual source times")
        }
        try check(!(try Contract.boundedDates(advertised, retaining: date(-1), limit: 6)).contains(date(-1)), "missing selected time is never invented")
        try check(try Contract.boundedDates([], retaining: nil, limit: 6) == [], "empty history remains empty")
        try rejects("invalid history limit") { _ = try Contract.boundedDates(advertised, retaining: nil, limit: 2) }
    }

    static func selectionTests() throws {
        let dates = [date(0), date(2), date(4)]
        let selected = try Contract.Selection(sourceID: "radar", instant: date(2))
        let refresh = try Contract.reconcileRefresh(current: selected, refreshedSourceID: "radar",
            availableDates: [date(2), date(4), date(6)], defaultPosition: .last)
        try check(refresh == selected, "refresh must not silently move to newest observation")
        try check(try Contract.selectedIndex(instant: refresh.instant, dates: [date(2), date(4), date(6)]) == 0, "index moves while identity stays fixed")
        let missing = try Contract.reconcileRefresh(current: selected, refreshedSourceID: "radar",
            availableDates: [date(4), date(6)], defaultPosition: .last)
        try check(missing == selected, "missing exact instant remains selected, not replaced")
        try check(try Contract.selectedIndex(instant: missing.instant, dates: [date(4), date(6)]) == nil, "missing index is optional, never negative")
        try check(try Contract.sliderIndex(instant: missing.instant, dates: [date(4), date(6)]) == 0, "visual thumb stays in range")
        try check(try Contract.sliderIndex(instant: date(2), dates: []) == nil, "empty slider has no fake frame")
        try check(try Contract.selectedIndex(instant: date(3), dates: dates) == nil, "unknown time does not snap to nearest")
        try check(try Contract.selectedIndex(instant: nil, dates: dates) == nil, "nil selection does not select imagery")
        let empty = try Contract.Selection(sourceID: "radar", instant: nil)
        try check(try Contract.reconcileRefresh(current: empty, refreshedSourceID: "radar", availableDates: dates, defaultPosition: .last).instant == date(4), "initial radar can choose latest")
        try check(try Contract.reconcileRefresh(current: empty, refreshedSourceID: "radar", availableDates: [], defaultPosition: .last).instant == nil, "empty refresh has no invented time")
        // A response requested before a source switch must use CURRENT selection.
        let switched = try Contract.selectSource(id: "forecast", dates: [date(60), date(120)], position: .first)
        try check(try Contract.reconcileRefresh(current: switched, refreshedSourceID: "radar", availableDates: dates, defaultPosition: .last) == switched, "older-source response cannot override user source")
        let switchedEmpty = try Contract.Selection(sourceID: "forecast", instant: nil)
        try check(try Contract.reconcileRefresh(current: switchedEmpty, refreshedSourceID: "radar", availableDates: dates, defaultPosition: .last) == switchedEmpty, "older-source response cannot initialize new empty source")
        let newerUserChoice = try Contract.Selection(sourceID: "radar", instant: date(0))
        try check(try Contract.reconcileRefresh(current: newerUserChoice, refreshedSourceID: "radar", availableDates: dates, defaultPosition: .last) == newerUserChoice, "same-source user scrub during refresh wins")
        let oldForecast = try Contract.Selection(sourceID: "forecast", instant: date(60))
        let advertised = [date(60), date(120), date(180)]
        let before = try Contract.futureDates(advertised: advertised, evaluatedAt: date(59.99))
        let after = try Contract.futureDates(advertised: advertised, evaluatedAt: date(60))
        try check(before.count == 3 && after == [date(120), date(180)], "future membership uses explicit clock boundary")
        try check(try Contract.reconcileRefresh(current: oldForecast, refreshedSourceID: "forecast", availableDates: after, defaultPosition: .first) == oldForecast, "clock expiry never relabels old image with next future time")
        try check(try Contract.selectedIndex(instant: oldForecast.instant, dates: after) == nil, "expired model time unavailable")
        try rejects("source") { _ = try Contract.Selection(sourceID: " ", instant: nil) }
        try rejects("nonfinite selection") { _ = try Contract.Selection(sourceID: "radar", instant: Date(timeIntervalSince1970: .nan)) }
        try rejects("duplicate dates") { _ = try Contract.selectedIndex(instant: date(0), dates: [date(0), date(0)]) }
        try rejects("unsorted dates") { _ = try Contract.sliderIndex(instant: date(0), dates: [date(2), date(0)]) }
        try rejects("nonfinite clock") { _ = try Contract.futureDates(advertised: dates, evaluatedAt: Date(timeIntervalSince1970: .infinity)) }
        try rejects("nonfinite advertised time") { _ = try Contract.selectedIndex(instant: nil, dates: [Date(timeIntervalSince1970: .nan)]) }
        try rejects("unbounded dates") { try Contract.validateDates((0...4096).map { date(Double($0)) }) }
    }

    static func playbackTests() throws {
        let dates = [date(0), date(2), date(10)]
        try check(try Contract.nextPlayback(instant: date(0), dates: dates, maximumGap: 120) == .advance(date(2)), "exact gap boundary allowed")
        try check(try Contract.nextPlayback(instant: date(2), dates: dates, maximumGap: 300) == .gap, "gap does not manufacture intermediate frames")
        try check(try Contract.nextPlayback(instant: date(10), dates: dates, maximumGap: 300) == .end, "end does not wrap")
        try check(try Contract.nextPlayback(instant: date(4), dates: dates, maximumGap: 300) == .missingSelection, "missing refresh selection never indexes minus one")
        try check(try Contract.nextPlayback(instant: nil, dates: dates, maximumGap: 300) == .missingSelection, "nil playback requires user/default selection")
        try check(try Contract.nextPlayback(instant: date(0), dates: [], maximumGap: 300) == .unavailable, "no data playback unavailable")
        try check(try Contract.nextPlayback(instant: date(0), dates: [date(0)], maximumGap: 300) == .end, "single frame ends safely")
        for invalid in [0, -1, Double.nan, Double.infinity] {
            try rejects("gap \(invalid)") { _ = try Contract.nextPlayback(instant: date(0), dates: dates, maximumGap: invalid) }
        }
    }

    static func viewportTests() throws {
        let viewport = try Contract.Viewport(west: -100, south: 0, east: -80, north: 60)
        let center = try viewport.pixelCenter(column: 0, row: 0, width: 1, height: 1)
        try check(center.longitude == -90 && abs(center.latitude - 35.264389682754654) < 1e-10, "Mercator midpoint is not arithmetic latitude midpoint")
        let topLeft = try viewport.pixelCenter(column: 0, row: 0, width: 2, height: 2)
        let bottomRight = try viewport.pixelCenter(column: 1, row: 1, width: 2, height: 2)
        try check(topLeft.longitude == -95 && bottomRight.longitude == -85, "half-pixel longitude centers")
        try check(topLeft.latitude > center.latitude && bottomRight.latitude < center.latitude,
                  "rows progress north to south")
        try check(topLeft.latitude < 60 && bottomRight.latitude > 0, "pixels lie inside, not at edge corners")
        let world = try Contract.Viewport(west: -180, south: -80, east: 180, north: 80)
        let worldCenter = try world.pixelCenter(column: 0, row: 0, width: 1, height: 1)
        try check(abs(worldCenter.longitude) < 1e-10 && abs(worldCenter.latitude) < 1e-10, "symmetric world center")
        for invalid in [(-100.0, 0.0, -100.0, 60.0), (170, 0, -170, 60), (-181, 0, 0, 60),
                        (-100, -81, -80, 60), (-100, 0, -80, 81), (-100, 60, -80, 60),
                        (Double.nan, 0, -80, 60), (-100, 0, Double.infinity, 60)] {
            try rejects("viewport \(invalid)") { _ = try Contract.Viewport(west: invalid.0, south: invalid.1, east: invalid.2, north: invalid.3) }
        }
        for invalid in [(0, 0, 0, 1), (0, 0, 1, 0), (-1, 0, 2, 2), (0, -1, 2, 2),
                        (2, 0, 2, 2), (0, 2, 2, 2), (0, 0, Int.max, 1)] {
            try rejects("pixel \(invalid)") { _ = try viewport.pixelCenter(column: invalid.0, row: invalid.1, width: invalid.2, height: invalid.3) }
        }
    }

    static func legendTests() throws {
        let encoding = try RadarNumericContract.Encoding()
        let bands = try Contract.resolvedLegendBands(encoding: encoding)
        try check(bands.map(\.upperDBZ) == [8, 16, 28, 36, 45, 56, 68, 80], "legend thresholds")
        try check(bands.count == 8 && bands.allSatisfy { $0.rgba.count == 4 && $0.rgba[3] > 0 }, "legend visible colors")
        for value in UInt8.min...UInt8.max {
            let texture = try RadarNumericContract.Texture(width: 1, height: 1, bytes: [value])
            let rendered = try RadarNumericContract.resolvedRGBA(texture, encoding: encoding)
            guard let dbz = RadarNumericContract.decodeDbz(value, encoding: encoding), rendered[3] > 0 else {
                try check(rendered[3] == 0, "missing or fully faded reflectivity stays transparent")
                continue
            }
            let band = bands.first(where: { dbz <= $0.upperDBZ }) ?? bands.last!
            try check(Array(rendered.prefix(3)) == Array(band.rgba.prefix(3)), "legend/render agreement at encoded byte \(value), dBZ \(dbz)")
        }
        try rejects("unsupported legend encoding") {
            _ = try Contract.resolvedLegendBands(encoding: RadarNumericContract.Encoding(dbzMin: -10, dbzMax: 90))
        }
    }
}
