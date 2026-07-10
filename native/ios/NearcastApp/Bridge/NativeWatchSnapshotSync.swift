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

        var payload: [String: Any] = [
            "type": "nearcast.widget.snapshot.v1",
            "snapshot": snapshotData,
            "sentAt": Date().timeIntervalSince1970
        ]
        if let placeData {
            payload["place"] = placeData
        }

        let session = WCSession.default
        refreshSessionState(session)

        do {
            try session.updateApplicationContext(payload)
            lastSnapshotSentAt = Date()
            lastError = nil
        } catch {
            lastError = "Application context failed: \(error.localizedDescription)"
        }

        if session.isPaired && session.isWatchAppInstalled {
            session.transferUserInfo(payload)
            if session.isComplicationEnabled {
                session.transferCurrentComplicationUserInfo(payload)
            }
        }
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
}

extension NativeWatchSnapshotSync: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            self.refreshSessionState(session)
            if let error {
                self.lastError = "Activation failed: \(error.localizedDescription)"
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
        }
    }
}
