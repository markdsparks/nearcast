#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-watch-receiver.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Generate transport-only fixtures. The production receiver and shared
# snapshot contract are compiled unchanged; no app-group data is touched.
node - "$TEST_ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
fs.writeFileSync(path.join(directory, 'WatchConnectivity.swift'), String.raw`
import Foundation
@_exported import Combine

public enum WCSessionActivationState { case notActivated, inactive, activated }
public protocol WCSessionDelegate: AnyObject {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?)
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any])
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any])
    func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?)
    func sessionReachabilityDidChange(_ session: WCSession)
}
public final class WCSessionUserInfoTransfer: NSObject {
    public let userInfo: [String: Any]
    init(_ userInfo: [String: Any]) { self.userInfo = userInfo }
}
public final class WCSession: NSObject, @unchecked Sendable {
    public static var current = WCSession()
    public static var BACKTICKdefaultBACKTICK: WCSession { current }
    public static func isSupported() -> Bool { true }
    public weak var delegate: (any WCSessionDelegate)?
    public var activationState: WCSessionActivationState = .activated
    public var isReachable = false
    public var receivedApplicationContext: [String: Any] = [:]
    public private(set) var outstandingUserInfoTransfers: [WCSessionUserInfoTransfer] = []
    public private(set) var transfers: [WCSessionUserInfoTransfer] = []
    public private(set) var messageErrors: [(Error) -> Void] = []
    public private(set) var activationCount = 0
    public func activate() { activationCount += 1 }
    public func sendMessage(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)?, errorHandler: ((Error) -> Void)?) {
        precondition(message["type"] as? String == "nearcast.widget.snapshot.request.v1")
        messageErrors.append(errorHandler!)
    }
    @discardableResult public func transferUserInfo(_ userInfo: [String: Any]) -> WCSessionUserInfoTransfer {
        let transfer = WCSessionUserInfoTransfer(userInfo)
        transfers.append(transfer)
        outstandingUserInfoTransfers.append(transfer)
        return transfer
    }
    public func finish(_ transfer: WCSessionUserInfoTransfer, error: Error?) {
        outstandingUserInfoTransfers.removeAll { $0 === transfer }
        delegate?.session(self, didFinish: transfer, error: error)
    }
}
`.replaceAll('BACKTICK', String.fromCharCode(96)));
fs.writeFileSync(path.join(directory, 'WidgetKit.swift'), String.raw`
public final class WidgetCenter {
    public static let shared = WidgetCenter()
    public private(set) var reloads = 0
    public func reloadAllTimelines() { reloads += 1 }
}
`);
fs.writeFileSync(path.join(directory, 'ReceiverTests.swift'), String.raw`
import Foundation
import WatchConnectivity
import WidgetKit

enum NearcastWatchBackgroundRefresh { @MainActor static func schedule() {} }

@MainActor final class TestClock {
    var now = Date(timeIntervalSince1970: 2_000_000_000)
}
@MainActor final class RetryWaiter {
    var delays: [TimeInterval] = []
    var continuations: [CheckedContinuation<Void, Error>] = []
    func sleep(_ delay: TimeInterval) async throws {
        delays.append(delay)
        try await withCheckedThrowingContinuation { continuations.append($0) }
    }
    func resume() { continuations.removeFirst().resume() }
}
@MainActor final class PublicationSink {
    var publication: NearcastWidgetSnapshotStore.Publication?
    func save(_ snapshot: NearcastWidgetSnapshot, _ place: NearcastWidgetPlace?) -> Bool {
        let incoming = NearcastWidgetSnapshotStore.Publication(snapshot: snapshot, place: place)
        guard incoming.canReplace(publication) else { return false }
        publication = incoming
        return true
    }
}
@MainActor struct Fixture {
    let session = WCSession()
    let clock = TestClock()
    let waiter = RetryWaiter()
    let sink = PublicationSink()
    let receiver: NearcastWatchSnapshotReceiver
    init(reachable: Bool = false) {
        WCSession.current = session
        session.isReachable = reachable
        receiver = NearcastWatchSnapshotReceiver(
            now: { [clock] in clock.now },
            waitForRequestRetry: { [waiter] in try await waiter.sleep($0) },
            storedPublication: { [sink] in sink.publication },
            savePublication: { [sink] in sink.save($0, $1) }
        )
    }
}

@main struct ReceiverTests {
    static let failure = NSError(domain: "ReceiverTest", code: 1)
    @MainActor static func settle() async {
        for _ in 0..<40 { await Task.yield() }
    }
    @MainActor static func check(_ condition: @autoclosure () -> Bool, _ label: String) {
        guard condition() else { fatalError(label) }
    }
    static func snapshot(owner: Int = 1, generation: Int = 1, weatherAt: TimeInterval = 2_000_000_000,
                         temperature: Int = 70, available: Bool = true) -> NearcastWidgetSnapshot {
        var value = NearcastWidgetSnapshot.fallback
        value.placeName = "Test place"
        value.ownerRevision = owner
        value.publicationGeneration = generation
        value.savedAt = weatherAt
        value.weatherSavedAt = weatherAt
        value.temperature = temperature
        value.isAvailable = available
        value.nativeWeatherInvalidation = !available
        return value
    }
    static func place(owner: Int = 1, generation: Int = 1) -> NearcastWidgetPlace {
        NearcastWidgetPlace(id: "test-place", name: "Test place", latitude: 41, longitude: -87,
                            ownerRevision: owner, publicationGeneration: generation)
    }
    static func payload(_ snapshot: NearcastWidgetSnapshot, _ place: NearcastWidgetPlace?) -> [String: Any] {
        var value: [String: Any] = ["type": "nearcast.widget.snapshot.v1", "snapshot": try! JSONEncoder().encode(snapshot)]
        if let place { value["place"] = try! JSONEncoder().encode(place) }
        return value
    }

    @MainActor static func main() async {
        // Reachability may disappear without another reachability callback.
        // Its immediate error must itself stage the durable recovery request.
        do {
            let f = Fixture(reachable: true)
            f.receiver.activate()
            check(f.session.messageErrors.count == 1, "initial immediate request")
            f.session.messageErrors[0](failure)
            await settle()
            check(f.session.transfers.count == 1, "send failure immediately queues durable fallback")
            f.clock.now.addTimeInterval(600)
            for _ in 0..<10 {
                f.receiver.activate()
                f.receiver.sessionReachabilityDidChange(f.session)
            }
            await settle()
            check(f.session.transfers.count == 1 && f.session.messageErrors.count == 1, "outstanding request coalesces foreground and reachability events")
            check(f.session.activationCount == 1, "recovery does not reactivate an active session")

            // Three delayed retries, then stop until a later lifecycle event.
            for (index, delay) in [1.0, 3.0, 8.0].enumerated() {
                f.session.finish(f.session.transfers.last!, error: failure)
                await settle()
                check(f.waiter.delays.last == delay, "bounded backoff delay")
                check(f.session.transfers.count == index + 1, "no retry before backoff")
                f.waiter.resume()
                await settle()
                check(f.session.transfers.count == index + 2, "failed durable request retried")
            }
            f.session.finish(f.session.transfers.last!, error: failure)
            await settle()
            check(f.waiter.delays == [1, 3, 8] && f.waiter.continuations.isEmpty, "automatic retry budget is bounded")
            f.receiver.activate()
            check(f.session.transfers.count == 4, "foreground respects cooldown after retry exhaustion")
            f.clock.now.addTimeInterval(61)
            f.session.isReachable = false
            f.receiver.activate()
            check(f.session.transfers.count == 5, "later foreground recovers after retry exhaustion")
        }

        // A relaunch adopts WCSession's already-durable queue instead of
        // issuing another request while the phone remains locked.
        do {
            let f = Fixture()
            f.session.transferUserInfo(["type": "nearcast.widget.snapshot.request.v1"])
            f.receiver.activate()
            check(f.session.transfers.count == 1, "relaunch deduplicates existing durable requests")
            f.session.finish(f.session.transfers[0], error: nil)
            await settle()
            f.receiver.activate()
            check(f.session.transfers.count == 2, "completed prelaunch request does not latch recovery forever")
            f.session.finish(f.session.transfers.last!, error: nil)
            await settle()
            f.receiver.activate()
            check(f.session.transfers.count == 2, "successful transfer awaits response within cooldown")
            f.clock.now.addTimeInterval(61)
            f.receiver.activate()
            check(f.session.transfers.count == 3, "delivered request without weather can recover later")
        }

        // Do not let a late error from a previous immediate request affect a
        // newer request, or resurrect recovery after usable weather arrives.
        do {
            let f = Fixture(reachable: true)
            f.receiver.activate()
            f.clock.now.addTimeInterval(61)
            f.receiver.activate()
            check(f.session.messageErrors.count == 2, "foreground retries an unanswered immediate request")
            f.session.messageErrors[0](failure)
            await settle()
            check(f.session.transfers.isEmpty, "obsolete immediate failure ignored")
            f.session.receivedApplicationContext = payload(snapshot(), place())
            f.receiver.activate()
            check(f.sink.publication?.snapshot.hasWeatherData == true, "foreground consumes newly received application context")
            f.session.messageErrors[1](failure)
            await settle()
            check(f.session.transfers.isEmpty, "late failure cannot restart completed recovery")
        }

        // Recovery never bypasses owner/generation/pair validation. A stale
        // or incoherent payload cannot cancel the pending retry.
        do {
            let f = Fixture()
            check(f.sink.save(snapshot(owner: 2, generation: 4, available: false), place(owner: 2, generation: 4)), "seed invalidated owner")
            f.receiver.activate()
            f.session.finish(f.session.transfers[0], error: failure)
            await settle()
            f.receiver.session(f.session, didReceiveUserInfo: payload(snapshot(owner: 1, generation: 3), place(owner: 1, generation: 3)))
            f.receiver.session(f.session, didReceiveUserInfo: payload(snapshot(owner: 2, generation: 5), place(owner: 2, generation: 4)))
            await settle()
            check(f.receiver.revision == 0 && f.sink.publication?.snapshot.publicationGeneration == 4, "stale owner and mismatched pair rejected")
            f.waiter.resume()
            await settle()
            check(f.session.transfers.count == 2, "rejected payloads leave recovery active")
            f.session.finish(f.session.transfers.last!, error: failure)
            await settle()
            let reloads = WidgetCenter.shared.reloads
            f.receiver.session(f.session, didReceiveUserInfo: payload(snapshot(owner: 2, generation: 5), place(owner: 2, generation: 5)))
            await settle()
            check(f.receiver.revision == 1 && WidgetCenter.shared.reloads == reloads + 1, "accepted coherent weather reloads widgets")
            f.waiter.resume()
            await settle()
            check(f.session.transfers.count == 2, "valid weather cancels queued retry")
            f.receiver.activate()
            check(f.session.transfers.count == 2, "healthy weather suppresses requests")
        }

        // Transport recovery must not regress newer autonomous Watch weather.
        do {
            let f = Fixture()
            check(f.sink.save(snapshot(generation: 2, weatherAt: 2_000_000_100, temperature: 83), place(generation: 2)), "seed fresher Watch weather")
            f.session.receivedApplicationContext = payload(snapshot(generation: 3, weatherAt: 2_000_000_000, temperature: 60), place(generation: 3))
            f.receiver.activate()
            check(f.sink.publication?.snapshot.temperature == 83, "new phone generation preserves fresher same-place weather")
            check(f.sink.publication?.snapshot.publicationGeneration == 3, "new phone authority still advances")
            check(f.session.transfers.isEmpty, "fresh coherent weather requires no recovery request")
        }

        do {
            let f = Fixture()
            f.session.activationState = .notActivated
            f.receiver.activate()
            f.receiver.session(f.session, activationDidCompleteWith: .notActivated, error: failure)
            await settle()
            f.receiver.activate()
            check(f.session.activationCount == 2, "foreground retries failed activation")
            check(f.session.transfers.isEmpty, "no requests before activation")
            f.session.activationState = .activated
            f.receiver.session(f.session, activationDidCompleteWith: .activated, error: nil)
            await settle()
            check(f.session.transfers.count == 1, "completed activation starts recovery")
        }

        print("native Watch receiver recovery tests passed")
    }
}
`);
NODE

xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  -emit-module -emit-library -module-name WatchConnectivity \
  "$TEST_ROOT/WatchConnectivity.swift" \
  -emit-module-path "$TEST_ROOT/WatchConnectivity.swiftmodule" \
  -o "$TEST_ROOT/libWatchConnectivity.dylib"
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  -emit-module -emit-library -module-name WidgetKit \
  "$TEST_ROOT/WidgetKit.swift" \
  -emit-module-path "$TEST_ROOT/WidgetKit.swiftmodule" \
  -o "$TEST_ROOT/libWidgetKit.dylib"
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  -I "$TEST_ROOT" -L "$TEST_ROOT" -lWatchConnectivity -lWidgetKit \
  -Xlinker -rpath -Xlinker "$TEST_ROOT" \
  "$TASK_ROOT/native/ios/Shared/NearcastWidgetSnapshot.swift" \
  "$TASK_ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$TASK_ROOT/native/ios/NearcastWatch/NearcastWatchSnapshotReceiver.swift" \
  "$TEST_ROOT/ReceiverTests.swift" \
  -o "$TEST_ROOT/native-watch-receiver-test"

"$TEST_ROOT/native-watch-receiver-test"
