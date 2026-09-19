import Foundation

@main
enum NativeRadarFreshnessTests {
    static func main() {
        typealias Policy = NativeRadarFreshnessPolicy
        let now = Date(timeIntervalSince1970: 1_789_784_400)
        for (age, source, selection) in [
            (0.0, Policy.SourceStatus.current, Policy.SelectionStatus.current),
            (899.999, .current, .current), (900.0, .current, .current),
            (900.001, .delayed, .delayed), (2099.999, .delayed, .delayed),
            (2100.0, .delayed, .delayed), (2100.001, .unavailable, .unavailable),
            (86_400.0, .unavailable, .unavailable)
        ] {
            let latest = now.addingTimeInterval(-age)
            let result = Policy.assess(latest: latest, selected: latest, at: now)
            precondition(result.sourceStatus == source && result.selectionStatus == selection)
            precondition(result.isLatestSelection && result.sourceIsUsable == (source != .unavailable))
            precondition(abs(result.latestAgeSeconds! - age) < 0.000001)
            precondition(result.selectedAgeSeconds == result.latestAgeSeconds)
        }
        let recent = now.addingTimeInterval(-120), historical = now.addingTimeInterval(-3600)
        let history = Policy.assess(latest: recent, selected: historical, at: now)
        precondition(history.sourceStatus == .current && history.selectionStatus == .historical)
        precondition(history.selectedAgeSeconds == 3600 && !history.isLatestSelection)
        let delayedHistory = Policy.assess(latest: now.addingTimeInterval(-1800), selected: historical, at: now)
        precondition(delayedHistory.sourceStatus == .delayed && delayedHistory.selectionStatus == .historical)
        let staleHistory = Policy.assess(latest: now.addingTimeInterval(-2400), selected: historical, at: now)
        precondition(staleHistory.sourceStatus == .unavailable && staleHistory.selectionStatus == .historical)
        precondition(!staleHistory.sourceIsUsable)

        for futureOffset in [0.001, 60.0, 3600.0] {
            let future = now.addingTimeInterval(futureOffset)
            let result = Policy.assess(latest: future, selected: future, at: now)
            precondition(result.sourceStatus == .unavailable && result.selectionStatus == .unavailable)
            precondition(result.latestAgeSeconds == nil && result.selectedAgeSeconds == nil && !result.isLatestSelection)
        }
        let afterLatest = Policy.assess(latest: recent, selected: recent.addingTimeInterval(1), at: now)
        precondition(afterLatest.sourceStatus == .current && afterLatest.selectionStatus == .unavailable)
        let futureSelection = Policy.assess(latest: recent, selected: now.addingTimeInterval(1), at: now)
        precondition(futureSelection.sourceStatus == .current && futureSelection.selectionStatus == .unavailable)
        let missingSelection = Policy.assess(latest: recent, at: now)
        precondition(missingSelection.sourceStatus == .current && missingSelection.selectionStatus == .unavailable)
        let missingLatest = Policy.assess(latest: nil, selected: historical, at: now)
        precondition(missingLatest.sourceStatus == .unavailable && missingLatest.selectionStatus == .unavailable)
        for invalid in [Double.nan, .infinity, -.infinity] {
            let badDate = Date(timeIntervalSince1970: invalid)
            precondition(Policy.assess(latest: badDate, selected: recent, at: now).sourceStatus == .unavailable)
            precondition(Policy.assess(latest: recent, selected: recent, at: badDate).sourceStatus == .unavailable)
            precondition(Policy.assess(latest: recent, selected: badDate, at: now).selectionStatus == .unavailable)
        }
        // Crossing a clock boundary changes source status, not the selected time.
        let boundary = now.addingTimeInterval(-2100)
        precondition(Policy.assess(latest: boundary, selected: boundary, at: now).sourceStatus == .delayed)
        precondition(Policy.assess(latest: boundary, selected: boundary, at: now.addingTimeInterval(0.001)).sourceStatus == .unavailable)
        print("PASS Native radar freshness: inclusive 15/35-minute source boundaries, historical selections, separate feed state, missing/future/nonfinite rejection and clock-boundary expiry")
    }
}
