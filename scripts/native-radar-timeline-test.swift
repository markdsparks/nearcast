import Foundation

@main
enum NativeRadarTimelineTests {
    static var assertions = 0
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String,
                       file: StaticString = #file, line: UInt = #line) {
        assertions += 1
        precondition(condition(), message, file: file, line: line)
    }
    static func time(_ value: String) -> Date {
        guard let date = RadarTimelineTimes.parse(value) else { preconditionFailure("Invalid test date: \(value)") }
        return date
    }
    static let now = time("2026-09-18T20:40:00Z")
    static let observations = ["2026-09-18T20:30:11.000Z", "2026-09-18T20:32:11.000Z", "2026-09-18T20:34:11.000Z"]
    static let forecasts = ["2026-09-19T00:00:00.000Z", "2026-09-19T06:00:00.000Z", "2026-09-19T12:00:00.000Z"]

    static func loaded() -> RadarTimelineState {
        var state = RadarTimelineState(now: now)
        let token = state.beginRefresh(at: now)
        expect(state.applyRefresh([
            .observed: .success(times: observations, fetchedAt: now),
            .accumulation: .success(times: forecasts, fetchedAt: now)
        ], token: token, at: now), "Initial metadata should apply")
        return state
    }

    static func main() throws {
        testExplicitInstants()
        try testProviderContract()
        testStableSelection()
        testRefreshFailureAndOrdering()
        testEmptyMissingAndRecovery()
        testClockChanges()
        testPlayback()
        testPlaceClocks()
        print("PASS Native radar timeline: \(assertions) deterministic assertions; provider instants, source semantics, stable/missing selection, stale refresh, gaps, safe playback, place-local 12/24 clocks and DST")
    }

    static func testExplicitInstants() {
        for value in ["bad", "", "2026-09-18", "2026-09-18T20:00:00", " 2026-09-18T20:00:00Z", "2026-09-18T20:00:00Z\n",
                      "2026-09-18T20:00:00Z/2026-09-19T20:00:00Z/PT1H", "2026-09-18T20:00:00Ztrailing",
                      "2026-02-30T20:00:00Z", "2025-02-29T20:00:00Z", "2026-13-01T20:00:00Z", "2026-00-01T20:00:00Z",
                      "2026-09-18T24:00:00Z", "2026-09-18T20:60:00Z", "2026-09-18T20:00:60Z",
                      "2026-09-18T20:00:00+24:00", "2026-09-18T20:00:00+01:60", "0000-01-01T00:00:00Z"] {
            expect(RadarTimelineTimes.parse(value) == nil, "Unsupported or normalized timestamp accepted: \(value)")
        }
        expect(time("2024-02-29T00:00:00Z") < now, "Leap day must parse")
        expect(time("2026-09-18T15:40:00-05:00") == now, "Offset must preserve the same instant")
        expect(time("2026-09-19T02:25:00+05:45") == now, "Quarter-hour offset must parse")
        expect(abs(time("2026-09-18T20:40:00.123456Z").timeIntervalSince(now) - 0.123456) < 0.000001,
               "Sub-millisecond source precision was discarded")
    }

    static func testProviderContract() throws {
        let xml = """
        <WMS_Capabilities><Capability><Layer><Name>parent</Name><Dimension name="time">2000-01-01T00:00:00Z</Dimension>
        <Layer><Name>wrong</Name><Dimension name="time">2001-01-01T00:00:00Z</Dimension></Layer>
        <Layer><Name>conus_bref_qcd</Name><Dimension name="time" default="2099-01-01T00:00:00Z">2026-09-18T20:34:11.000Z,2026-09-18T20:32:11.000Z,2026-09-18T20:34:11Z,garbage,2099-01-01T00:00:00Z,2026-09-18T20:00:00Z/2026-09-19T20:00:00Z/PT1H</Dimension></Layer>
        </Layer></Capability></WMS_Capabilities>
        """
        let times = try RadarProofCapabilities.times(in: Data(xml.utf8), layer: "conus_bref_qcd")
        var state = RadarTimelineState(now: now)
        let token = state.beginRefresh(at: now)
        state.applyRefresh([
            .observed: .success(times: times, fetchedAt: now),
            .accumulation: .success(times: ["2026-09-18T18:00:00Z"] + forecasts.reversed(), fetchedAt: now)
        ], token: token, at: now)
        expect(state.frames(for: .observed).count == 2, "No duplicate, future, interval, malformed, parent, or sibling observations")
        expect(state.status(for: .observed).rejectedTimeCount == 3, "Rejected-time diagnostics should be explicit")
        expect(state.frames(for: .accumulation).map(\.sourceTime) == forecasts, "Only actual future accumulation times, sorted")
        expect(state.selectedFrame?.sourceTime == observations.last, "Initial selection must be actual latest observation")
        expect(state.frames.count == 5, "No hourly or cadence-based synthetic frames")
        let observed = state.selectedFrame!
        let query = URLComponents(url: try observed.proofFrame.tileURL(x: 16, y: 24, z: 6), resolvingAgainstBaseURL: false)!.queryItems!
        expect(query.first { $0.name == "TIME" }?.value == observed.sourceTime, "WMS must receive exact advertised TIME")
        expect(observed.proofFrame.kind == .observed, "Observed source semantics changed")
        expect(observed.observedAge(at: now) == 349, "Age must use observation time, not fetch time")
        state.selectFirstForecast()
        let forecast = state.selectedFrame!
        expect(forecast.proofFrame.kind == .accumulation, "NDFD must stay accumulation")
        expect(forecast.title == "Forecast · 6-hour rain amount", "NDFD must not be labeled radar")
        expect(forecast.source.explanation.contains("not instantaneous radar or storm motion"), "Accumulation explanation missing")
        expect(forecast.observedAge(at: now) == nil, "Forecast must not have an observation age")
        expect(RadarTimelineFrameID(source: .observed, validTime: now) != RadarTimelineFrameID(source: .accumulation, validTime: now),
               "Identity must include source semantics")
    }

    static func testStableSelection() {
        var state = loaded()
        let selected = state.frames(for: .observed)[1]
        expect(state.select(id: selected.id), "Available selection should work")
        let later = now.addingTimeInterval(60)
        let token = state.beginRefresh(at: later)
        let changedEncoding = ["2026-09-18T15:32:11-05:00", "2026-09-18T20:38:23.456Z", observations[0]]
        state.applyRefresh([.observed: .success(times: changedEncoding, fetchedAt: later)], token: token, at: later)
        expect(state.selectedID == selected.id, "Refresh/reorder/add/remove cannot shift selected source+instant")
        expect(state.selectedFrame?.sourceTime == changedEncoding[0], "Retain exact latest advertised encoding for same instant")
        expect(state.selectedFrame?.metadataFetchedAt == later, "Successful metadata fetch provenance must update")
        expect(state.selectedFrame?.validTime == selected.validTime, "Successful refresh must never re-age imagery")
        expect(state.selectedFrame?.observedAge(at: later) == later.timeIntervalSince(selected.validTime), "Age was rebased on metadata")
        expect(state.frames(for: .accumulation).count == 3, "Omitted source should remain unchanged")
        expect(state.selectLatestObserved(), "Latest observed explicit action should work")
        expect(state.selectedFrame?.sourceTime == changedEncoding[1], "Latest must be actual provider time")
        expect(!state.select(id: .init(source: .observed, validTime: time("2026-09-18T20:39:00Z"))), "Unknown target cannot snap to nearest frame")
        expect(state.selectedFrame?.sourceTime == changedEncoding[1], "Invalid target should not alter prior selection")
    }

    static func testRefreshFailureAndOrdering() {
        var state = loaded()
        let original = state.selectedFrame!
        let attempt = now.addingTimeInterval(600)
        let oldToken = state.beginRefresh(at: now.addingTimeInterval(60))
        let token = state.beginRefresh(at: attempt)
        expect(!state.applyRefresh([.observed: .success(times: [], fetchedAt: attempt)], token: oldToken, at: attempt),
               "Out-of-order response must be ignored")
        expect(state.isRefreshing, "Old request cannot finish active refresh")
        expect(state.selectedFrame == original, "Old response changed selected frame")
        expect(state.applyRefresh([.observed: .failure, .accumulation: .failure], token: token, at: attempt), "Current failure must apply")
        expect(!state.isRefreshing, "Current request should finish refresh")
        expect(state.selectedFrame == original, "Failure cannot relabel cached frame or metadata fetch")
        expect(state.status(for: .observed).metadataFetchedAt == now, "Failure cannot stamp fresh metadata")
        expect(state.status(for: .observed).lastAttemptAt == attempt, "Attempt time should be distinct")
        expect(state.selection == .available(original, isFromFailedRefresh: true), "Retained stale data must be explicit")
        expect(state.stepPlayback() == .stopped(.refreshFailed), "Failed source must not silently animate cached data")
        expect(!state.applyRefresh([.observed: .success(times: [], fetchedAt: attempt)], token: token, at: attempt), "Duplicate completion must be ignored")
        let staleToken = state.beginRefresh(at: attempt)
        state.applyRefresh([.observed: .success(times: [], fetchedAt: now.addingTimeInterval(-1))], token: staleToken, at: attempt)
        expect(state.selectedFrame == original, "Older cached metadata must not erase newer frame list")
        expect(state.status(for: .observed).state == .refreshFailed, "Stale cache rejection must be visible")
        let recoveredToken = state.beginRefresh(at: attempt)
        state.applyRefresh([.observed: .success(times: observations, fetchedAt: attempt)], token: recoveredToken, at: attempt)
        expect(state.status(for: .observed).state == .ready, "Valid metadata recovery should clear failure")
        expect(state.selectedFrame?.validTime == original.validTime, "Recovery cannot imply newer observation")
        expect(state.selectedFrame?.observedAge(at: attempt) == 949, "Old weather remains old after successful metadata refresh")
    }

    static func testEmptyMissingAndRecovery() {
        var state = loaded()
        let selectedID = state.selectedID!
        let token = state.beginRefresh(at: now)
        state.applyRefresh([.observed: .success(times: [observations[0]], fetchedAt: now)], token: token, at: now)
        expect(state.selectedID == selectedID, "Missing selection identity must survive refresh")
        expect(state.selectedFrame == nil, "Never replace missing selection with nearest/last/forecast")
        expect(state.selection == .unavailable(selectedID, reason: .selectedFrameMissing), "Missing selection must be explicit")
        expect(state.stepPlayback() == .stopped(.unavailableSelection), "Unavailable selection cannot animate")
        let restore = state.beginRefresh(at: now)
        state.applyRefresh([.observed: .success(times: observations, fetchedAt: now)], token: restore, at: now)
        expect(state.selectedFrame?.id == selectedID, "Returning exact timestamp should restore selected frame")
        let empty = state.beginRefresh(at: now)
        state.applyRefresh([.observed: .success(times: [], fetchedAt: now)], token: empty, at: now)
        expect(state.status(for: .observed).state == .unavailable, "Successful empty source is unavailable, not failed or retained")
        expect(state.frames(for: .observed).isEmpty, "Successful empty metadata must remove old observed stops")
        expect(!state.selectLatestObserved(), "Latest cannot silently switch to forecast")
        expect(state.selectedFrame == nil, "No automatic source substitution")
        expect(state.selectFirstForecast(), "Explicit source switch can recover selection")
        expect(state.selectedFrame?.source == .accumulation, "Explicit forecast selection should succeed")

        var initial = RadarTimelineState(now: now)
        expect(initial.selection == .unavailable(nil, reason: .noFrames), "Initial state should be unavailable")
        let initialToken = initial.beginRefresh(at: now)
        initial.applyRefresh([.observed: .failure, .accumulation: .success(times: forecasts, fetchedAt: now)], token: initialToken, at: now)
        expect(initial.selectedFrame?.sourceTime == forecasts[0], "Initial forecast-only fallback uses first actual forecast")
        expect(initial.status(for: .observed).state == .refreshFailed, "Fallback cannot imply observed radar succeeded")
    }

    static func testClockChanges() {
        var state = loaded()
        let observedID = state.selectedID!
        state.advanceClock(to: time("2026-09-18T20:31:00Z"))
        expect(state.selectedFrame == nil, "Clock rollback cannot expose future observation")
        expect(state.selection == .unavailable(observedID, reason: .futureObservation), "Future observation after clock rollback is explicit")
        expect(state.frames(for: .observed).count == 1, "Future observations must not remain selectable")
        state.advanceClock(to: now)
        expect(state.selectedID == observedID && state.selectedFrame != nil, "Clock recovery preserves identity")
        state.selectFirstForecast()
        let forecastID = state.selectedID!
        state.advanceClock(to: time(forecasts[0]))
        expect(state.selectedFrame == nil, "Passed accumulation frame cannot be presented as future guidance")
        expect(state.selection == .unavailable(forecastID, reason: .expiredForecast), "Forecast expiry is explicit")
        expect(state.selectFirstForecast(), "Explicitly selecting next forecast should recover")
        expect(state.selectedFrame?.sourceTime == forecasts[1], "Expired forecast must be omitted from available stops")

        var boundary = RadarTimelineState(now: now)
        let token = boundary.beginRefresh(at: now)
        boundary.applyRefresh([.observed: .success(times: ["2026-09-18T20:40:00Z", "2026-09-18T20:40:00.001Z"], fetchedAt: now)], token: token, at: now)
        expect(boundary.frames.count == 1, "Even millisecond-future observations must be rejected")
        expect(boundary.selectedFrame?.validTime == now, "Observation at now is allowed")
    }

    static func testPlayback() {
        var state = loaded()
        let observed = state.frames(for: .observed)
        state.select(id: observed[0].id)
        expect(state.stepPlayback() == .advanced(observed[1].id), "Playback should step to real same-source frame")
        expect(state.stepPlayback() == .advanced(observed[2].id), "Playback should retain provider cadence")
        expect(state.stepPlayback() == .stopped(.endOfSource), "Playback cannot cross observed/accumulation boundary or loop")
        expect(state.selectedID == observed[2].id, "Stop cannot alter selection")
        state.selectFirstForecast()
        let future = state.frames(for: .accumulation)
        expect(state.stepPlayback() == .advanced(future[1].id), "Six-hour accumulation sequence can hard-cut to next amount")
        expect(state.stepPlayback() == .advanced(future[2].id), "Six-hour amount is not interpolated hourly")
        expect(state.stepPlayback() == .stopped(.endOfSource), "Forecast must stop at last advertised time")

        let token = state.beginRefresh(at: now)
        state.applyRefresh([
            .observed: .success(times: ["2026-09-18T20:20:00Z", "2026-09-18T20:25:00Z", "2026-09-18T20:30:00.001Z"], fetchedAt: now),
            .accumulation: .success(times: [forecasts[0], forecasts[2]], fetchedAt: now)
        ], token: token, at: now)
        let sparse = state.frames(for: .observed)
        state.select(id: sparse[0].id)
        expect(state.stepPlayback() == .advanced(sparse[1].id), "Exactly five-minute observed policy boundary is allowed")
        let observedGap = RadarTimelineGap(from: sparse[1].id, to: sparse[2].id)
        expect(state.gap(after: sparse[1].id) == observedGap, "Gap must be inspectable without manufacturing stops")
        expect(state.stepPlayback() == .stopped(.gap(observedGap)), "Playback cannot hide a missing observed interval")
        expect(state.selectedID == sparse[1].id, "Gap stop must leave current frame unchanged")
        expect(state.select(id: sparse[2].id), "Explicit scrub can choose real frame across a gap")
        state.selectFirstForecast()
        let amounts = state.frames(for: .accumulation)
        let forecastGap = RadarTimelineGap(from: amounts[0].id, to: amounts[1].id)
        expect(state.stepPlayback() == .stopped(.gap(forecastGap)), "A missing six-hour forecast cannot be blended or stepped across")
        expect(forecastGap.duration == 12 * 3_600, "Gap duration should retain exact real elapsed time")
        expect(state.frames.count == 5, "Playback/gap detection must not insert synthetic frames")
    }

    static func testPlaceClocks() {
        let chicago12 = RadarTimelineClock(timeZoneIdentifier: "America/Chicago", uses24HourClock: false)!
        let chicago24 = RadarTimelineClock(timeZoneIdentifier: "America/Chicago", uses24HourClock: true)!
        let kathmandu24 = RadarTimelineClock(timeZoneIdentifier: "Asia/Kathmandu", uses24HourClock: true)!
        expect(chicago12.shortLabel(for: now) == "3:40 PM", "12-hour place time must be explicit")
        expect(chicago24.shortLabel(for: now) == "15:40", "24-hour preference cannot follow device clock")
        expect(kathmandu24.shortLabel(for: now) == "02:25", "Place timezone must handle fractional offsets/day rollover")
        expect(kathmandu24.detailLabel(for: now).contains("Sep 19, 2026"), "Detail label must show place-local day")
        expect(kathmandu24.offsetLabel(for: now) == "UTC+05:45", "Fractional timezone offset must remain visible")
        expect(RadarTimelineClock(timeZoneIdentifier: "Not/A_TimeZone", uses24HourClock: false) == nil, "Invalid place zone cannot fall back to device timezone")
        expect(chicago12.shortLabel(for: time("2026-09-18T05:00:00Z")) == "12:00 AM", "12-hour midnight")
        expect(chicago24.shortLabel(for: time("2026-09-18T05:00:00Z")) == "00:00", "24-hour midnight")
        expect(chicago12.shortLabel(for: time("2026-09-18T17:00:00Z")) == "12:00 PM", "12-hour noon")
        let beforeSpring = time("2026-03-08T07:59:00Z")
        let afterSpring = time("2026-03-08T08:00:00Z")
        expect(chicago24.shortLabel(for: beforeSpring) == "01:59", "DST spring start")
        expect(chicago24.shortLabel(for: afterSpring) == "03:00", "Nonexistent local hour must not be fabricated")
        let firstFall = time("2026-11-01T06:30:00Z")
        let secondFall = time("2026-11-01T07:30:00Z")
        expect(chicago12.shortLabel(for: firstFall) == "1:30 AM" && chicago12.shortLabel(for: secondFall) == "1:30 AM", "Repeated fall hour should be local")
        expect(chicago12.detailLabel(for: firstFall).contains("UTC−05:00"), "First repeated hour offset")
        expect(chicago12.detailLabel(for: secondFall).contains("UTC−06:00"), "Second repeated hour offset")
        expect(chicago12.detailLabel(for: firstFall) != chicago12.detailLabel(for: secondFall), "DST repeated hours must be distinguishable")
        let frame = RadarTimelineFrame(source: .accumulation, validTime: firstFall, sourceTime: "2026-11-01T06:30:00Z", metadataFetchedAt: now)
        let speech = chicago12.accessibilityLabel(for: frame)
        expect(speech.contains("Forecast · 6-hour rain amount") && speech.contains("America/Chicago") && speech.contains("UTC−05:00"), "A11y needs semantics and unambiguous place-local valid time")
    }
}
