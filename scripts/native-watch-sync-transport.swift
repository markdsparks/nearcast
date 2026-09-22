import Foundation
@_exported import Combine

public enum WCSessionActivationState { case notActivated, inactive, activated }

public protocol WCSessionDelegate: AnyObject {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?)
    func sessionDidBecomeInactive(_ session: WCSession)
    func sessionDidDeactivate(_ session: WCSession)
    func sessionReachabilityDidChange(_ session: WCSession)
    func sessionWatchStateDidChange(_ session: WCSession)
    func session(_ session: WCSession, didReceiveMessage message: [String: Any])
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any])
}

/// Transport-only test double. All publication, priority, retry, and replay
/// decisions remain in the actual NativeWatchSnapshotSync production source.
public final class WCSession: NSObject, @unchecked Sendable {
    public static let `default` = WCSession()
    public static func isSupported() -> Bool { true }

    public weak var delegate: (any WCSessionDelegate)?
    public var activationState: WCSessionActivationState = .activated
    public var isPaired = true
    public var isWatchAppInstalled = true
    public var isReachable = false
    public var isComplicationEnabled = true
    public var remainingComplicationUserInfoTransfers = 50
    public var failNextContextUpdate = false
    public private(set) var activationAttempts = 0
    public private(set) var contextAttempts: [[String: Any]] = []
    public private(set) var applicationContext: [String: Any] = [:]
    public private(set) var priorityTransfers: [[String: Any]] = []

    public func activate() { activationAttempts += 1 }

    public func failActivation() {
        activationState = .notActivated
        delegate?.session(self, activationDidCompleteWith: .notActivated,
            error: NSError(domain: "FakeWatchConnectivity", code: 2))
    }

    public func updateApplicationContext(_ payload: [String: Any]) throws {
        contextAttempts.append(payload)
        if failNextContextUpdate {
            failNextContextUpdate = false
            throw NSError(domain: "FakeWatchConnectivity", code: 1)
        }
        applicationContext = payload
    }

    public func transferCurrentComplicationUserInfo(_ payload: [String: Any]) {
        priorityTransfers.append(payload)
        remainingComplicationUserInfoTransfers -= 1
    }

    public func finishActivation() {
        activationState = .activated
        delegate?.session(self, activationDidCompleteWith: .activated, error: nil)
    }

    public func notifyWatchStateChange() {
        delegate?.sessionWatchStateDidChange(self)
    }
}
