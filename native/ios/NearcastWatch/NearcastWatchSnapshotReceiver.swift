import Foundation
import WatchConnectivity

@MainActor
final class NearcastWatchSnapshotReceiver: NSObject, ObservableObject {
    static let shared = NearcastWatchSnapshotReceiver()

    @Published private(set) var supported = WCSession.isSupported()
    @Published private(set) var activationState = "not activated"
    @Published private(set) var lastReceivedAt: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var revision = 0

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
        activationState = Self.activationLabel(session.activationState)
        guard !didActivate else { return }
        didActivate = true
        session.activate()
        savePayload(session.receivedApplicationContext)
    }

    private func savePayload(_ payload: [String: Any]) {
        guard !payload.isEmpty else { return }
        guard payload["type"] as? String == "nearcast.widget.snapshot.v1" else { return }
        guard let snapshotData = payload["snapshot"] as? Data else {
            lastError = "Snapshot payload was missing data."
            return
        }
        NearcastWidgetSnapshotStore.saveSnapshotData(snapshotData)
        if let placeData = payload["place"] as? Data {
            NearcastWidgetSnapshotStore.savePlaceData(placeData)
        }
        lastReceivedAt = Date()
        lastError = nil
        revision += 1
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
}

extension NearcastWatchSnapshotReceiver: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            self.activationState = Self.activationLabel(activationState)
            if let error {
                self.lastError = "Activation failed: \(error.localizedDescription)"
            } else {
                self.savePayload(session.receivedApplicationContext)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in
            self.savePayload(applicationContext)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in
            self.savePayload(userInfo)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.activationState = Self.activationLabel(session.activationState)
        }
    }
}
