import Foundation
import WatchConnectivity

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
    private var lastUrgentAlertIdentity: String?
    private var lastPriorityTransferAt: Date?
    private var pendingFlushTask: Task<Void, Never>?

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

        let placeChanged = placeData != lastPlaceData
        let urgentAlertIdentity = Self.urgentAlertIdentity(in: snapshotData)
        let urgentAlertChanged = urgentAlertIdentity != lastUrgentAlertIdentity
        guard snapshotData != lastSnapshotData || placeChanged else { return }
        lastSnapshotData = snapshotData
        lastPlaceData = placeData
        lastUrgentAlertIdentity = urgentAlertIdentity

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

        let session = WCSession.default
        refreshSessionState(session)
        guard session.activationState == .activated else {
            pendingPayload = payload
            pendingPriorityTransfer = pendingPriorityTransfer || placeChanged || urgentAlertChanged
            lastError = nil
            schedulePendingFlush()
            return
        }

        sendPayload(payload, session: session, forcePriority: placeChanged || urgentAlertChanged)
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

    private func flushPendingPayload(_ session: WCSession = .default) {
        guard session.activationState == .activated, let payload = pendingPayload else { return }
        let forcePriority = pendingPriorityTransfer
        pendingPayload = nil
        pendingPriorityTransfer = false
        sendPayload(payload, session: session, forcePriority: forcePriority)
    }

    private func sendPayload(_ payload: [String: Any], session: WCSession, forcePriority: Bool = false) {
        do {
            try session.updateApplicationContext(payload)
            lastSnapshotSentAt = Date()
            lastError = nil
            pendingFlushTask?.cancel()
            pendingFlushTask = nil
        } catch {
            pendingPayload = payload
            lastSnapshotData = nil
            lastPlaceData = nil
            lastError = "Application context failed: \(error.localizedDescription)"
            schedulePendingFlush()
        }

        guard session.isPaired, session.isWatchAppInstalled, session.isComplicationEnabled else { return }
        let priorityInterval = lastPriorityTransferAt.map { Date().timeIntervalSince($0) } ?? .infinity
        guard forcePriority || priorityInterval >= 30 * 60 else { return }
        guard session.remainingComplicationUserInfoTransfers > 0 else { return }
        session.transferCurrentComplicationUserInfo(payload)
        lastPriorityTransferAt = Date()
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
                self.lastError = "Activation failed: \(error.localizedDescription)"
            } else {
                self.flushPendingPayload(session)
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
            self.flushPendingPayload(session)
        }
    }
}
