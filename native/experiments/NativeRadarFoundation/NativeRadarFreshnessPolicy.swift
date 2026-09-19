import Foundation

/// Observation-display freshness, matching map.js's 15/35-minute latest-frame
/// boundaries. This is NOT the raw-map seam's stricter 8-minute motion-anchor
/// gate and must not be used to authorize a nowcast, blending or a clear claim.
enum NativeRadarFreshnessPolicy {
    static let maximumCurrentAge: TimeInterval = 15 * 60
    static let maximumDelayedAge: TimeInterval = 35 * 60

    enum SourceStatus: String, Equatable, Sendable { case current, delayed, unavailable }
    enum SelectionStatus: String, Equatable, Sendable { case current, delayed, unavailable, historical }

    struct Assessment: Equatable, Sendable {
        let sourceStatus: SourceStatus
        let selectionStatus: SelectionStatus
        let latestAgeSeconds: TimeInterval?
        let selectedAgeSeconds: TimeInterval?
        let isLatestSelection: Bool
        var sourceIsUsable: Bool { sourceStatus != .unavailable }
    }

    /// Evaluate against ONE explicit clock snapshot. `latest` must be the actual
    /// newest advertised observation from this source, not the selected frame or
    /// the metadata fetch time. Membership of `selected` in that source's exact
    /// advertised times remains the timeline's responsibility.
    ///
    /// A valid historical selection stays historical even if the feed is stale;
    /// sourceStatus separately reports that current radar is unavailable. No
    /// clamping/rounding can turn a future scan into a current observation.
    static func assess(latest: Date?, selected: Date? = nil, at now: Date) -> Assessment {
        guard let latest, let latestAge = age(of: latest, at: now) else {
            return Assessment(sourceStatus: .unavailable, selectionStatus: .unavailable,
                              latestAgeSeconds: nil, selectedAgeSeconds: nil, isLatestSelection: false)
        }
        let source: SourceStatus = latestAge <= maximumCurrentAge ? .current
            : latestAge <= maximumDelayedAge ? .delayed : .unavailable
        guard let selected, let selectedAge = age(of: selected, at: now), selected <= latest else {
            return Assessment(sourceStatus: source, selectionStatus: .unavailable,
                              latestAgeSeconds: latestAge, selectedAgeSeconds: nil, isLatestSelection: false)
        }
        let isLatest = selected == latest
        let selection: SelectionStatus
        if !isLatest { selection = .historical }
        else {
            switch source {
            case .current: selection = .current
            case .delayed: selection = .delayed
            case .unavailable: selection = .unavailable
            }
        }
        return Assessment(sourceStatus: source, selectionStatus: selection,
                          latestAgeSeconds: latestAge, selectedAgeSeconds: selectedAge, isLatestSelection: isLatest)
    }

    private static func age(of instant: Date, at now: Date) -> TimeInterval? {
        guard instant.timeIntervalSince1970.isFinite, now.timeIntervalSince1970.isFinite else { return nil }
        let elapsed = now.timeIntervalSince(instant)
        guard elapsed.isFinite, elapsed >= 0 else { return nil }
        return elapsed
    }
}
