import Foundation
import WatchConnectivity

private let nearcastWatchSnapshotRequestType = "nearcast.widget.snapshot.request.v1"

@MainActor
final class NativeWatchSnapshotSync: NSObject, ObservableObject {
    static let shared = NativeWatchSnapshotSync()

    @Published private(set) var supported = WCSession.isSupported()
    @Published private(set) var paired = false
    @Published private(set) var watchAppInstalled = false
    @Published private(set) var reachable = false
    @Published private(set) var activationState = "not activated"
    @Published private(set) var lastSnapshotSentAt: Date?
    @Published private(set) var lastError: String?

    private var didActivate = false
    private var pendingPayload: [String: Any]?
    private var pendingPriorityTransfer = false
    private var lastSnapshotData: Data?
    private var lastPlaceData: Data?
    private var lastPriorityContext: PriorityContext?
    private var lastUrgentAlertIdentity: String?
    private var lastPriorityTransferAt: Date?
    private var pendingFlushTask: Task<Void, Never>?

    /// Publication generations change on every receipt; they are not a place
    /// change and must not consume the Watch's limited priority-transfer budget.
    private struct PriorityContext: Equatable {
        let placeID: String?
        let latitude: Double?
        let longitude: Double?
        let tracksCurrentLocation: Bool
        let windUnit: String
        let uses24HourClock: Bool?
    }

    private override init() {
        super.init()
    }

    func activate() {
        guard supported else {
            activationState = "unsupported"
            return
        }
        let session = WCSession.default
        if session.delegate !== self {
            session.delegate = self
        }
        refreshSessionState(session)
        guard !didActivate else { return }
        didActivate = true
        session.activate()
    }

    func sendSnapshotData(_ snapshotData: Data, placeData: Data?) {
        activate()
        guard supported else {
            lastError = "WatchConnectivity is not supported."
            return
        }

        let placeDataChanged = placeData != lastPlaceData
        let priorityContext = Self.priorityContext(snapshotData: snapshotData, placeData: placeData)
        let placeOrSettingsChanged = priorityContext != lastPriorityContext
        let urgentAlertIdentity = Self.urgentAlertIdentity(in: snapshotData)
        let urgentAlertChanged = urgentAlertIdentity != lastUrgentAlertIdentity
        guard snapshotData != lastSnapshotData || placeDataChanged || pendingPayload != nil else { return }
        lastSnapshotData = snapshotData
        lastPlaceData = placeData
        lastPriorityContext = priorityContext
        lastUrgentAlertIdentity = urgentAlertIdentity

        let payload = Self.payload(snapshotData: snapshotData, placeData: placeData)

        let session = WCSession.default
        refreshSessionState(session)
        guard session.activationState == .activated else {
            pendingPayload = payload
            pendingPriorityTransfer = pendingPriorityTransfer || placeOrSettingsChanged || urgentAlertChanged
            lastError = nil
            schedulePendingFlush()
            return
        }

        sendPayload(payload, session: session, forcePriority: placeOrSettingsChanged || urgentAlertChanged)
    }

    var statusRows: [(String, String)] {
        [
            ("Supported", supported ? "Yes" : "No"),
            ("Paired", paired ? "Yes" : "No"),
            ("Watch app", watchAppInstalled ? "Installed" : "Not installed"),
            ("Reachable", reachable ? "Yes" : "No"),
            ("Activation", activationState),
            ("Last snapshot", lastSnapshotSentAt.map(Self.shortTime) ?? "Not sent"),
            ("Last issue", lastError ?? "None")
        ]
    }

    private func refreshSessionState(_ session: WCSession = .default) {
        supported = WCSession.isSupported()
        paired = session.isPaired
        watchAppInstalled = session.isWatchAppInstalled
        reachable = session.isReachable
        activationState = Self.activationLabel(session.activationState)
    }

    private static func activationLabel(_ state: WCSessionActivationState) -> String {
        switch state {
        case .activated:
            return "activated"
        case .inactive:
            return "inactive"
        case .notActivated:
            return "not activated"
        @unknown default:
            return "unknown"
        }
    }

    private static func shortTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    private static func urgentAlertIdentity(in data: Data) -> String? {
        guard let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data),
              let alert = snapshot.urgentOfficialAlertBrief() else { return nil }
        let expiration = alert.expiresAt.map { String($0) } ?? ""
        return [
            alert.id ?? alert.title,
            alert.title,
            alert.severity ?? "",
            alert.urgency ?? "",
            expiration,
            alert.source
        ].joined(separator: "|")
    }

    private static func priorityContext(snapshotData: Data, placeData: Data?) -> PriorityContext? {
        guard let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: snapshotData) else { return nil }
        let place = placeData.flatMap { try? JSONDecoder().decode(NearcastWidgetPlace.self, from: $0) }
        return PriorityContext(
            placeID: place?.id,
            latitude: place?.latitude,
            longitude: place?.longitude,
            tracksCurrentLocation: place?.tracksCurrentLocation ?? false,
            windUnit: snapshot.windUnit,
            uses24HourClock: snapshot.uses24HourClock
        )
    }

    private static func payload(snapshotData: Data, placeData: Data?) -> [String: Any] {
        var payload: [String: Any] = [
            "type": "nearcast.widget.snapshot.v1",
            "snapshot": snapshotData,
            "sentAt": Date().timeIntervalSince1970
        ]
        if let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: snapshotData) {
            if let revision = snapshot.ownerRevision { payload["ownerRevision"] = revision }
            if let generation = snapshot.publicationGeneration { payload["publicationGeneration"] = generation }
        }
        if let placeData {
            payload["place"] = placeData
        }
        return payload
    }

    private func flushPendingPayload(_ session: WCSession = .default) {
        guard session.activationState == .activated, let payload = pendingPayload else { return }
        let forcePriority = pendingPriorityTransfer
        pendingPayload = nil
        pendingPriorityTransfer = false
        sendPayload(payload, session: session, forcePriority: forcePriority)
    }

    /// `updateApplicationContext` is meant to be durable, but a companion can
    /// be installed or reinstalled after the phone successfully saved its
    /// last context. In that case there is no pending error to flush and the
    /// next identical forecast would otherwise be deduplicated forever for
    /// this process. Restage the latest committed receipt when Watch state
    /// changes; this changes no forecast or owner data.
    private func replayLatestSnapshot(_ session: WCSession = .default) {
        guard session.activationState == .activated,
              let snapshotData = lastSnapshotData else { return }
        sendPayload(
            Self.payload(snapshotData: snapshotData, placeData: lastPlaceData),
            session: session
        )
    }

    /// Handles an explicit recovery request from the Watch. This is important
    /// for a fresh Watch install: the phone may have saved a valid snapshot
    /// before the Watch app existed, so there is no new weather receipt to
    /// trigger a normal push. Re-reading the durable phone publication keeps
    /// this recovery path within the same owner/generation contract.
    private func replayStoredPublication(_ session: WCSession = .default) {
        guard let publication = NearcastWidgetSnapshotStore.storedPublication(),
              publication.isCoherent,
              let snapshotData = try? JSONEncoder().encode(publication.snapshot) else { return }
        let placeData = publication.place.flatMap { try? JSONEncoder().encode($0) }
        lastSnapshotData = snapshotData
        lastPlaceData = placeData
        lastPriorityContext = Self.priorityContext(snapshotData: snapshotData, placeData: placeData)
        lastUrgentAlertIdentity = Self.urgentAlertIdentity(in: snapshotData)
        let payload = Self.payload(snapshotData: snapshotData, placeData: placeData)
        guard session.activationState == .activated else {
            pendingPayload = payload
            pendingPriorityTransfer = true
            schedulePendingFlush()
            return
        }
        // A missing Watch snapshot is a direct user-requested recovery, so it
        // is worth taking the available complication-priority lane as well.
        sendPayload(payload, session: session, forcePriority: true)
    }

    private func handleSnapshotRequest(_ payload: [String: Any], session: WCSession) {
        guard payload["type"] as? String == nearcastWatchSnapshotRequestType else { return }
        refreshSessionState(session)
        replayStoredPublication(session)
    }

    private func sendPayload(_ payload: [String: Any], session: WCSession, forcePriority: Bool = false) {
        // Every attempted send supersedes the older pending context. Otherwise
        // A failing, followed by B succeeding, could leave A queued to overwrite
        // B on the next Watch-state callback (including a fresh Watch install).
        let needsPriorityTransfer = forcePriority || pendingPriorityTransfer
        pendingPayload = payload
        pendingPriorityTransfer = needsPriorityTransfer
        do {
            try session.updateApplicationContext(payload)
            pendingPayload = nil
            pendingPriorityTransfer = false
            lastSnapshotSentAt = Date()
            lastError = nil
            pendingFlushTask?.cancel()
            pendingFlushTask = nil
        } catch {
            pendingPayload = payload
            // Keep the latest receipt available for install/state replays.
            // pendingPayload lets an identical observation retry without
            // pretending its place or urgent-alert identity changed again.
            lastError = "Application context failed: \(error.localizedDescription)"
            schedulePendingFlush()
        }

        guard session.isPaired, session.isWatchAppInstalled, session.isComplicationEnabled else { return }
        let priorityInterval = lastPriorityTransferAt.map { Date().timeIntervalSince($0) } ?? .infinity
        guard needsPriorityTransfer || priorityInterval >= 30 * 60 else { return }
        guard session.remainingComplicationUserInfoTransfers > 0 else { return }
        session.transferCurrentComplicationUserInfo(payload)
        lastPriorityTransferAt = Date()
        // A successful priority transfer need not be repeated if application
        // context itself still needs a retry.
        pendingPriorityTransfer = false
    }

    /// WatchConnectivity commonly comes online just after the app has written
    /// the first native forecast receipt. Application context is durable, but
    /// a failed write does not create a delegate callback of its own. Retry a
    /// few times while this foreground host exists so the Watch cannot remain
    /// stranded on a place-only publication until a later weather change.
    private func schedulePendingFlush() {
        guard pendingFlushTask == nil else { return }
        pendingFlushTask = Task { [weak self] in
            for delay in [1.0, 3.0, 8.0] {
                try? await Task.sleep(for: .seconds(delay))
                guard let self, !Task.isCancelled else { return }
                self.activate()
                self.refreshSessionState()
                self.flushPendingPayload()
                if self.pendingPayload == nil { return }
            }
            self?.pendingFlushTask = nil
        }
    }
}

extension NativeWatchSnapshotSync: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            self.refreshSessionState(session)
            if let error {
                // A transient activation error is recoverable. Leaving this
                // latch set makes every pending retry skip session.activate().
                self.didActivate = false
                self.lastError = "Activation failed: \(error.localizedDescription)"
            } else {
                let hadPendingPayload = self.pendingPayload != nil
                self.flushPendingPayload(session)
                if !hadPendingPayload {
                    self.replayLatestSnapshot(session)
                }
            }
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {
        Task { @MainActor in
            self.refreshSessionState(session)
        }
    }

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
        Task { @MainActor in
            self.refreshSessionState(session)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.refreshSessionState(session)
        }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.refreshSessionState(session)
            if self.pendingPayload != nil {
                self.flushPendingPayload(session)
            } else {
                self.replayLatestSnapshot(session)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in
            self.handleSnapshotRequest(message, session: session)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in
            self.handleSnapshotRequest(userInfo, session: session)
        }
    }
}
