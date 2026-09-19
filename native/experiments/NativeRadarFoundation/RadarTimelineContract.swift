import Foundation

/// Pure source/time policy for the isolated native foundation. No networking, UI, or
/// production-provider selection belongs here. The old raster proof supplies WMS URLs.
enum RadarTimelineSource: String, CaseIterable, Hashable {
    case observed = "noaa-mrms-conus-reflectivity"
    case accumulation = "noaa-ndfd-conus-six-hour-amount"

    var title: String {
        self == .observed ? "Observed radar" : "Forecast · 6-hour rain amount"
    }
    var attribution: String { self == .observed ? "NOAA/NWS MRMS" : "NOAA/NWS NDFD" }
    var explanation: String {
        self == .observed
            ? "Observed reflectivity at the provider's exact valid time."
            : "Six-hour accumulated precipitation guidance, not instantaneous radar or storm motion."
    }
    var proofKind: RadarProofFrame.Kind { self == .observed ? .observed : .accumulation }
    /// Conservative playback policy, not a claim that the provider advertises a fixed cadence.
    var maximumContinuousStep: TimeInterval { self == .observed ? 5 * 60 : 6 * 60 * 60 }
}

struct RadarTimelineFrameID: Hashable {
    let source: RadarTimelineSource
    let validTime: Date
}

struct RadarTimelineFrame: Equatable, Identifiable {
    let source: RadarTimelineSource
    let validTime: Date
    /// Never substitute a rounded scrubber position, generated interval, or metadata-fetch time.
    let sourceTime: String
    let metadataFetchedAt: Date
    var id: RadarTimelineFrameID { .init(source: source, validTime: validTime) }
    var title: String { source.title }
    var attribution: String { source.attribution }
    var proofFrame: RadarProofFrame {
        .init(kind: source.proofKind, validTime: validTime, sourceTime: sourceTime,
              metadataFetchedAt: metadataFetchedAt)
    }
    func observedAge(at now: Date) -> TimeInterval? {
        guard source == .observed, validTime <= now else { return nil }
        return now.timeIntervalSince(validTime)
    }
}

enum RadarTimelineTimes {
    /// Explicit instants only. Calendar round-trip prevents ISO parsers normalizing invalid
    /// days or 24:00 into a different instant. Fractions and offsets remain in sourceTime.
    static func parse(_ value: String) -> Date? {
        let expression = try! NSRegularExpression(pattern:
            #"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$"#)
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        guard let match = expression.firstMatch(in: value, range: range), match.range == range else { return nil }
        func component(_ index: Int) -> String? {
            guard let range = Range(match.range(at: index), in: value) else { return nil }
            return String(value[range])
        }
        guard let year = component(1).flatMap(Int.init), year > 0,
              let month = component(2).flatMap(Int.init),
              let day = component(3).flatMap(Int.init),
              let hour = component(4).flatMap(Int.init), (0...23).contains(hour),
              let minute = component(5).flatMap(Int.init), (0...59).contains(minute),
              let second = component(6).flatMap(Int.init), (0...59).contains(second),
              let zone = component(8) else { return nil }
        var offset = 0
        if zone != "Z" {
            let parts = zone.dropFirst().split(separator: ":")
            guard let hours = Int(parts[0]), hours <= 23,
                  let minutes = Int(parts[1]), minutes <= 59 else { return nil }
            offset = (hours * 60 + minutes) * 60 * (zone.first == "-" ? -1 : 1)
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let expected = DateComponents(year: year, month: month, day: day,
                                      hour: hour, minute: minute, second: second)
        guard let date = calendar.date(from: expected) else { return nil }
        let actual = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        guard expected == actual else { return nil }
        let fraction = component(7).flatMap(Double.init) ?? 0
        return date.addingTimeInterval(fraction - Double(offset))
    }
}

enum RadarTimelineLoadResult {
    case success(times: [String], fetchedAt: Date)
    case failure
}

struct RadarTimelineSourceStatus: Equatable {
    enum State: Equatable { case notLoaded, ready, unavailable, refreshFailed }
    var state: State = .notLoaded
    var metadataFetchedAt: Date?
    var lastAttemptAt: Date?
    var rejectedTimeCount = 0
}

enum RadarTimelineUnavailableReason: Equatable {
    case noFrames, selectedFrameMissing, futureObservation, expiredForecast
    var explanation: String {
        switch self {
        case .noFrames: return "No provider frame is available."
        case .selectedFrameMissing: return "The selected source time is no longer available. Choose an available frame."
        case .futureObservation: return "An observed frame cannot be displayed in the future."
        case .expiredForecast: return "The selected forecast valid time has passed. Choose an available frame."
        }
    }
}

enum RadarTimelineSelection: Equatable {
    case available(RadarTimelineFrame, isFromFailedRefresh: Bool)
    case unavailable(RadarTimelineFrameID?, reason: RadarTimelineUnavailableReason)
}

struct RadarTimelineGap: Equatable {
    let from: RadarTimelineFrameID
    let to: RadarTimelineFrameID
    var duration: TimeInterval { to.validTime.timeIntervalSince(from.validTime) }
}

enum RadarTimelinePlaybackStep: Equatable {
    enum StopReason: Equatable { case unavailableSelection, refreshFailed, endOfSource, gap(RadarTimelineGap) }
    case advanced(RadarTimelineFrameID)
    case stopped(StopReason)
}

/// State is keyed by source + valid instant, never by array index. A missing selection
/// stays missing after refresh until the user explicitly chooses another frame.
struct RadarTimelineState {
    private var storedFrames: [RadarTimelineFrame] = []
    private(set) var selectedID: RadarTimelineFrameID?
    private(set) var sourceStatuses: [RadarTimelineSource: RadarTimelineSourceStatus] = [:]
    private(set) var evaluationTime: Date
    private(set) var isRefreshing = false
    private var refreshGeneration: UInt64 = 0

    init(now: Date) { evaluationTime = now }

    /// Only usable, advertised instants are exposed as scrubber stops.
    var frames: [RadarTimelineFrame] { storedFrames.filter { isUsable($0) } }
    var selectedFrame: RadarTimelineFrame? {
        guard let selectedID else { return nil }
        return frames.first { $0.id == selectedID }
    }
    var selection: RadarTimelineSelection {
        guard let selectedID else { return .unavailable(nil, reason: .noFrames) }
        guard let frame = storedFrames.first(where: { $0.id == selectedID }) else {
            return .unavailable(selectedID, reason: .selectedFrameMissing)
        }
        guard isUsable(frame) else {
            return .unavailable(selectedID, reason: frame.source == .observed ? .futureObservation : .expiredForecast)
        }
        return .available(frame, isFromFailedRefresh: status(for: frame.source).state == .refreshFailed)
    }
    func frames(for source: RadarTimelineSource) -> [RadarTimelineFrame] { frames.filter { $0.source == source } }
    func status(for source: RadarTimelineSource) -> RadarTimelineSourceStatus { sourceStatuses[source] ?? .init() }

    mutating func advanceClock(to now: Date) { evaluationTime = now }

    @discardableResult
    mutating func beginRefresh(at now: Date) -> UInt64 {
        evaluationTime = now
        refreshGeneration += 1
        isRefreshing = true
        return refreshGeneration
    }

    /// A completed refresh is applied atomically. Omitted sources are unchanged. A failed
    /// source keeps cached data and original timestamps; success with zero usable times
    /// intentionally removes that source. Older concurrent responses cannot overwrite state.
    @discardableResult
    mutating func applyRefresh(_ results: [RadarTimelineSource: RadarTimelineLoadResult], token: UInt64, at now: Date) -> Bool {
        guard token == refreshGeneration, isRefreshing else { return false }
        evaluationTime = now
        isRefreshing = false
        for source in RadarTimelineSource.allCases {
            guard let result = results[source] else { continue }
            var status = status(for: source)
            status.lastAttemptAt = now
            switch result {
            case .failure:
                status.state = .refreshFailed
            case let .success(times, fetchedAt):
                // A stale metadata cache must not roll back a newer successful snapshot.
                if let previous = status.metadataFetchedAt, fetchedAt < previous {
                    status.state = .refreshFailed
                    sourceStatuses[source] = status
                    continue
                }
                var byID: [RadarTimelineFrameID: RadarTimelineFrame] = [:]
                var rejected = 0
                for sourceTime in times {
                    guard let validTime = RadarTimelineTimes.parse(sourceTime),
                          source == .observed ? validTime <= now : validTime > now else {
                        rejected += 1
                        continue
                    }
                    let frame = RadarTimelineFrame(source: source, validTime: validTime,
                                                   sourceTime: sourceTime, metadataFetchedAt: fetchedAt)
                    // Equivalent advertised encodings share one identity; use the first
                    // exact provider string. Refresh may change its encoding without selection drift.
                    if byID[frame.id] == nil { byID[frame.id] = frame }
                }
                storedFrames.removeAll { $0.source == source }
                storedFrames.append(contentsOf: byID.values)
                status.metadataFetchedAt = fetchedAt
                status.rejectedTimeCount = rejected
                status.state = byID.isEmpty ? .unavailable : .ready
            }
            sourceStatuses[source] = status
        }
        storedFrames.sort {
            if $0.validTime == $1.validTime { return $0.source.rawValue < $1.source.rawValue }
            return $0.validTime < $1.validTime
        }
        if selectedID == nil {
            selectedID = frames(for: .observed).last?.id ?? frames(for: .accumulation).first?.id
        }
        return true
    }

    /// Invalid IDs are not silently clamped or substituted with a nearest frame.
    @discardableResult
    mutating func select(id: RadarTimelineFrameID) -> Bool {
        guard frames.contains(where: { $0.id == id }) else { return false }
        selectedID = id
        return true
    }

    @discardableResult
    mutating func selectLatestObserved() -> Bool {
        guard let id = frames(for: .observed).last?.id else { return false }
        return select(id: id)
    }

    @discardableResult
    mutating func selectFirstForecast() -> Bool {
        guard let id = frames(for: .accumulation).first?.id else { return false }
        return select(id: id)
    }

    func gap(after id: RadarTimelineFrameID) -> RadarTimelineGap? {
        let candidates = frames(for: id.source)
        guard let index = candidates.firstIndex(where: { $0.id == id }), index + 1 < candidates.count else { return nil }
        let next = candidates[index + 1]
        guard next.validTime.timeIntervalSince(id.validTime) > id.source.maximumContinuousStep else { return nil }
        return .init(from: id, to: next.id)
    }

    /// Advance only by advertised same-product stops. There is no interpolation, crossfade,
    /// nearest-time fallback, source crossover, or implicit loop. The renderer must hard-cut.
    @discardableResult
    mutating func stepPlayback() -> RadarTimelinePlaybackStep {
        guard let frame = selectedFrame else { return .stopped(.unavailableSelection) }
        guard status(for: frame.source).state != .refreshFailed else { return .stopped(.refreshFailed) }
        if let gap = gap(after: frame.id) { return .stopped(.gap(gap)) }
        let candidates = frames(for: frame.source)
        guard let index = candidates.firstIndex(where: { $0.id == frame.id }), index + 1 < candidates.count else {
            return .stopped(.endOfSource)
        }
        let next = candidates[index + 1].id
        selectedID = next
        return .advanced(next)
    }

    private func isUsable(_ frame: RadarTimelineFrame) -> Bool {
        frame.source == .observed ? frame.validTime <= evaluationTime : frame.validTime > evaluationTime
    }
}

/// Timezone comes from the selected place, never from the device's current timezone.
/// Offset remains visible in detail/a11y labels to disambiguate repeated DST hours.
struct RadarTimelineClock {
    let timeZone: TimeZone
    let uses24HourClock: Bool
    init?(timeZoneIdentifier: String, uses24HourClock: Bool) {
        guard let zone = TimeZone(identifier: timeZoneIdentifier) else { return nil }
        timeZone = zone
        self.uses24HourClock = uses24HourClock
    }
    func shortLabel(for date: Date) -> String { format(date, pattern: uses24HourClock ? "HH:mm" : "h:mm a") }
    func detailLabel(for date: Date) -> String {
        let pattern = uses24HourClock ? "EEE, MMM d, yyyy · HH:mm:ss" : "EEE, MMM d, yyyy · h:mm:ss a"
        return "\(format(date, pattern: pattern)) · \(offsetLabel(for: date))"
    }
    func accessibilityLabel(for frame: RadarTimelineFrame) -> String {
        "\(frame.title). Valid \(detailLabel(for: frame.validTime)), \(timeZone.identifier). \(frame.source.explanation)"
    }
    func offsetLabel(for date: Date) -> String {
        let seconds = timeZone.secondsFromGMT(for: date)
        let sign = seconds < 0 ? "−" : "+"
        return String(format: "UTC%@%02d:%02d", sign, abs(seconds) / 3_600, (abs(seconds) / 60) % 60)
    }
    private func format(_ date: Date, pattern: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}
