import Foundation
import WatchConnectivity
import WidgetKit

private let nearcastWatchSnapshotRequestType = "nearcast.widget.snapshot.request.v1"

@MainActor
final class NearcastWatchSnapshotReceiver: NSObject, ObservableObject {
    static let shared = NearcastWatchSnapshotReceiver()

    @Published private(set) var supported = WCSession.isSupported()
    @Published private(set) var activationState = "not activated"
    @Published private(set) var lastReceivedAt: Date?
    @Published private(set) var lastError: String?
    @Published private(set) var revision = 0

    private var didActivate = false
    private var latestSnapshotRequestAt: Date?
    private var immediateRequestID: UUID?
    private var requestRetryTask: Task<Void, Never>?
    private var requestRetryAttempt = 0
    private let requestClock: () -> Date
    private let waitForRequestRetry: (TimeInterval) async throws -> Void
    private let storedPublication: () -> NearcastWidgetSnapshotStore.Publication?
    private let savePublication: (NearcastWidgetSnapshot, NearcastWidgetPlace?) -> Bool

    // Tests inject time and an isolated sink while exercising this receiver
    // and the shared publication contract unchanged.
    init(now: @escaping () -> Date = Date.init,
         waitForRequestRetry: @escaping (TimeInterval) async throws -> Void = {
             try await Task.sleep(for: .seconds($0))
         },
         storedPublication: @escaping () -> NearcastWidgetSnapshotStore.Publication? = NearcastWidgetSnapshotStore.storedPublication,
         savePublication: @escaping (NearcastWidgetSnapshot, NearcastWidgetPlace?) -> Bool = NearcastWidgetSnapshotStore.savePublication) {
        requestClock = now
        self.waitForRequestRetry = waitForRequestRetry
        self.storedPublication = storedPublication
        self.savePublication = savePublication
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
        if !didActivate {
            didActivate = true
            session.activate()
        }
        // Foreground activations must still recover after a transient request
        // failure, even when the WCSession itself was already activated.
        savePayload(session.receivedApplicationContext)
        requestLatestSnapshotIfNeeded(session)
    }

    /// SwiftUI invokes this while completing a WatchConnectivity background
    /// task. Delegate callbacks normally save the transfer; reading the latest
    /// application context as well covers a delivery that arrived before the
    /// receiver finished activating.
    func handleBackgroundDelivery() async {
        // A connectivity wake is also a useful chance to keep the next
        // discretionary weather refresh queued.
        NearcastWatchBackgroundRefresh.schedule()

        let revisionAtEntry = revision
        activate()
        let session = WCSession.default
        savePayload(session.receivedApplicationContext)

        // Activation and the delegate delivery can arrive just after SwiftUI
        // invokes this handler. Keep the task alive briefly, but never depend
        // on an unbounded connectivity callback to complete it.
        guard revision == revisionAtEntry else { return }
        for attempt in 0..<10 {
            guard !Task.isCancelled else { return }
            savePayload(session.receivedApplicationContext)
            if revision != revisionAtEntry { return }
            if attempt < 9 {
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
        }
    }

    private func savePayload(_ payload: [String: Any]) {
        guard !payload.isEmpty else { return }
        guard payload["type"] as? String == "nearcast.widget.snapshot.v1" else { return }
        guard let snapshotData = payload["snapshot"] as? Data else {
            lastError = "Snapshot payload was missing data."
            return
        }
        guard let incoming = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: snapshotData) else {
            lastError = "Snapshot payload could not be decoded."
            return
        }
        // WatchConnectivity's background and complication queues may deliver
        // older phone publications after a newer application context.
        let storedPublication = storedPublication()
        guard incoming.canReplacePublication(storedPublication?.snapshot) else { return }

        let placeData = payload["place"] as? Data
        let incomingPlace = placeData.flatMap { try? JSONDecoder().decode(NearcastWidgetPlace.self, from: $0) }
        let storedPlace = storedPublication?.place
        let isSamePlace = incomingPlace.map { incomingPlace in
            guard let storedPlace else { return false }
            return (incoming.ownerRevision == nil || (incomingPlace.id == storedPlace.id &&
                    incomingPlace.tracksCurrentLocation == storedPlace.tracksCurrentLocation))
                && abs(incomingPlace.latitude - storedPlace.latitude) < 0.00001
                && abs(incomingPlace.longitude - storedPlace.longitude) < 0.00001
        } ?? (incoming.placeName == storedPublication?.snapshot.placeName)

        let now = Date().timeIntervalSince1970
        let resolved: NearcastWidgetSnapshot
        if isSamePlace, let stored = storedPublication?.snapshot {
            resolved = incoming
                .preservingNewerWeather(from: stored)
                .resolvingOfficialAlert(with: stored, at: now)
                .expiringCompanionContent(at: now)
        } else {
            resolved = incoming.expiringCompanionContent(at: now)
        }
        guard savePublication(resolved, incomingPlace) else { return }
        if resolved.hasWeatherData && resolved.nativeWeatherInvalidation != true {
            finishSnapshotRecovery()
        }
        lastReceivedAt = Date()
        lastError = nil
        revision += 1
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// A Watch can be installed after the phone’s latest weather publication.
    /// In that case `receivedApplicationContext` may still be empty and a
    /// normal forecast update may not happen for hours. Ask the paired phone
    /// to restage its durable snapshot; use a background transfer when it is
    /// not reachable so the request survives the phone being locked.
    private func requestLatestSnapshotIfNeeded(_ session: WCSession = .default) {
        guard session.activationState == .activated else { return }
        guard needsLatestSnapshot else {
            finishSnapshotRecovery()
            return
        }
        // WCSession owns this queue across app suspension/relaunch. Never add
        // a duplicate while a durable recovery request is still outstanding.
        guard !hasOutstandingSnapshotRequest(session), requestRetryTask == nil else { return }
        // Sending a request is not proof that a usable snapshot arrived. A
        // later foreground/reachability event may retry, but at most once a
        // minute when the phone cannot yet supply weather.
        guard latestSnapshotRequestAt.map({ requestClock().timeIntervalSince($0) >= 60 }) ?? true else { return }

        latestSnapshotRequestAt = requestClock()
        if session.isReachable {
            let requestID = UUID()
            immediateRequestID = requestID
            session.sendMessage(Self.snapshotRequest, replyHandler: nil) { [weak self] error in
                Task { @MainActor in
                    guard let self, self.immediateRequestID == requestID else { return }
                    self.immediateRequestID = nil
                    guard self.needsLatestSnapshot else { return }
                    self.lastError = "Phone snapshot request failed: \(error.localizedDescription)"
                    // Reachability can disappear between the check and send.
                    // The background lane survives a locked/unreachable phone.
                    self.enqueueSnapshotRequest(session)
                }
            }
        } else {
            enqueueSnapshotRequest(session)
        }
    }

    private static var snapshotRequest: [String: Any] {
        ["type": nearcastWatchSnapshotRequestType]
    }

    private var needsLatestSnapshot: Bool {
        let stored = storedPublication()?.snapshot
        return stored?.hasWeatherData != true || stored?.nativeWeatherInvalidation == true
    }

    private func hasOutstandingSnapshotRequest(_ session: WCSession) -> Bool {
        session.outstandingUserInfoTransfers.contains {
            $0.userInfo["type"] as? String == nearcastWatchSnapshotRequestType
        }
    }

    private func enqueueSnapshotRequest(_ session: WCSession) {
        guard needsLatestSnapshot, !hasOutstandingSnapshotRequest(session) else { return }
        guard session.activationState == .activated else {
            scheduleSnapshotRequestRetry(session)
            return
        }
        immediateRequestID = nil
        latestSnapshotRequestAt = requestClock()
        session.transferUserInfo(Self.snapshotRequest)
    }

    private func scheduleSnapshotRequestRetry(_ session: WCSession) {
        let delays: [TimeInterval] = [1, 3, 8]
        guard needsLatestSnapshot, requestRetryTask == nil,
              requestRetryAttempt < delays.count else { return }
        let delay = delays[requestRetryAttempt]
        requestRetryAttempt += 1
        requestRetryTask = Task { [weak self, waitForRequestRetry] in
            do { try await waitForRequestRetry(delay) }
            catch { return }
            guard let self, !Task.isCancelled else { return }
            self.requestRetryTask = nil
            self.enqueueSnapshotRequest(session)
        }
    }

    private func finishSnapshotRecovery() {
        immediateRequestID = nil
        latestSnapshotRequestAt = nil
        requestRetryTask?.cancel()
        requestRetryTask = nil
        requestRetryAttempt = 0
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
                self.didActivate = false
                self.lastError = "Activation failed: \(error.localizedDescription)"
            } else {
                self.savePayload(session.receivedApplicationContext)
                self.requestLatestSnapshotIfNeeded(session)
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

    nonisolated func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        guard userInfoTransfer.userInfo["type"] as? String == nearcastWatchSnapshotRequestType,
              let error else { return }
        Task { @MainActor in
            guard self.needsLatestSnapshot else { return }
            self.lastError = "Phone snapshot transfer failed: \(error.localizedDescription)"
            self.scheduleSnapshotRequestRetry(session)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.activationState = Self.activationLabel(session.activationState)
            self.requestLatestSnapshotIfNeeded(session)
        }
    }
}
