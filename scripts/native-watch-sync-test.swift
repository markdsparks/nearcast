import Foundation
import WatchConnectivity

@main
struct NativeWatchSyncTests {
    @MainActor
    static func main() async throws {
        let transport = WCSession.default
        let sync = NativeWatchSnapshotSync.shared
        var generation = 1
        var owner = 1
        var place = NearcastWidgetPlace(id: "home", name: "Home", latitude: 41, longitude: -87)
        var snapshot = NearcastWidgetSnapshot.fallback
        snapshot.isAvailable = true
        snapshot.temperature = 70
        snapshot.placeName = "Home"
        snapshot.windUnit = "mph"
        snapshot.uses24HourClock = false
        snapshot.weatherSavedAt = Date().timeIntervalSince1970

        func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
            guard condition() else {
                print("FAIL  \(message)")
                exit(1)
            }
        }

        func send() throws {
            snapshot.ownerRevision = owner
            snapshot.publicationGeneration = generation
            place.ownerRevision = owner
            place.publicationGeneration = generation
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            sync.sendSnapshotData(try encoder.encode(snapshot), placeData: try encoder.encode(place))
        }

        func currentGeneration() -> Int? {
            transport.applicationContext["publicationGeneration"] as? Int
        }

        try send()
        expect(transport.priorityTransfers.count == 1, "initial selected place uses priority")
        let attemptsBeforeDuplicate = transport.contextAttempts.count
        try send()
        expect(transport.contextAttempts.count == attemptsBeforeDuplicate, "identical successful receipt is deduplicated")
        generation += 1
        snapshot.temperature = 71
        try send()
        expect(transport.priorityTransfers.count == 1, "generation-only weather update respects priority interval")

        generation += 1
        owner += 1
        place.displayName = "My home"
        snapshot.placeName = "My home"
        try send()
        expect(transport.priorityTransfers.count == 1, "owner revision and display alias alone do not consume priority")

        generation += 1
        snapshot.windUnit = "km/h"
        try send()
        expect(transport.priorityTransfers.count == 2, "unit change is promptly delivered")
        generation += 1
        snapshot.uses24HourClock = true
        try send()
        expect(transport.priorityTransfers.count == 3, "clock preference change is promptly delivered")
        generation += 1
        place.id = "work"
        try send()
        expect(transport.priorityTransfers.count == 4, "selection identity change is promptly delivered")
        generation += 1
        place.followsCurrentLocation = true
        try send()
        expect(transport.priorityTransfers.count == 5, "Current Location intent change is promptly delivered")
        generation += 1
        place.latitude += 0.01
        try send()
        expect(transport.priorityTransfers.count == 6, "selected coordinate change is promptly delivered")

        // A failed context must never outlive a subsequent successful B.
        generation += 1
        transport.failNextContextUpdate = true
        try send()
        expect(sync.lastError != nil, "transport failure is visible")
        generation += 1
        let winningGeneration = generation
        try send()
        expect(currentGeneration() == winningGeneration, "B replaces failed A")
        transport.notifyWatchStateChange()
        await drainCallbacks()
        expect(currentGeneration() == winningGeneration, "Watch-state replay cannot restore pending A after B succeeded")
        expect(sync.lastError == nil, "successful recovery clears transport error")

        // Activation coalesces many publications into the newest receipt while
        // retaining a semantic priority change that happened in the queue.
        transport.activationState = .notActivated
        let attemptsBeforeActivation = transport.contextAttempts.count
        let priorityBeforeActivation = transport.priorityTransfers.count
        generation += 1
        place.id = "away"
        try send()
        generation += 1
        try send()
        expect(transport.contextAttempts.count == attemptsBeforeActivation, "inactive transport queues without sending")
        transport.finishActivation()
        await drainCallbacks()
        expect(currentGeneration() == generation, "activation flushes only newest publication")
        expect(transport.contextAttempts.count == attemptsBeforeActivation + 1, "activation sends one coalesced context")
        expect(transport.priorityTransfers.count == priorityBeforeActivation + 1, "activation preserves semantic priority")

        // If both lanes are initially unavailable, a subsequent context retry
        // must preserve the priority reason until the budget allows delivery.
        generation += 1
        place.id = "return"
        transport.remainingComplicationUserInfoTransfers = 0
        transport.failNextContextUpdate = true
        try send()
        let priorityBeforeRetry = transport.priorityTransfers.count
        transport.remainingComplicationUserInfoTransfers = 50
        transport.notifyWatchStateChange()
        await drainCallbacks()
        expect(currentGeneration() == generation, "pending context retries after failure")
        expect(transport.priorityTransfers.count == priorityBeforeRetry + 1, "failed context preserves its pending priority reason")
        let attemptsAfterRetry = transport.contextAttempts.count
        transport.notifyWatchStateChange()
        await drainCallbacks()
        expect(transport.contextAttempts.count == attemptsAfterRetry + 1, "successful retry retains receipt for a later Watch installation replay")
        expect(currentGeneration() == generation, "later installation replay keeps recovered receipt")

        // A priority transfer that succeeded despite a context failure is not
        // charged again on the context retry.
        generation += 1
        place.id = "final"
        transport.failNextContextUpdate = true
        try send()
        let priorityAfterPartialSuccess = transport.priorityTransfers.count
        transport.notifyWatchStateChange()
        await drainCallbacks()
        expect(transport.priorityTransfers.count == priorityAfterPartialSuccess, "context retry does not duplicate successful priority delivery")
        expect(currentGeneration() == generation, "partial delivery converges to latest context")

        generation += 1
        transport.failNextContextUpdate = true
        try send()
        let attemptsBeforeIdenticalRetry = transport.contextAttempts.count
        try send()
        expect(transport.contextAttempts.count == attemptsBeforeIdenticalRetry + 1, "identical failed receipt can retry through normal publication")
        expect(currentGeneration() == generation, "identical retry successfully stages the current receipt")

        let priorityBeforeAlert = transport.priorityTransfers.count
        generation += 1
        snapshot.alertId = "warning"
        snapshot.alertTitle = "Severe Thunderstorm Warning"
        snapshot.alertExpiresAt = Date().addingTimeInterval(3600).timeIntervalSince1970
        snapshot.alertSavedAt = Date().timeIntervalSince1970
        snapshot.alertStateReady = true
        try send()
        expect(transport.priorityTransfers.count == priorityBeforeAlert + 1, "new urgent warning bypasses routine throttle")
        generation += 1
        try send()
        expect(transport.priorityTransfers.count == priorityBeforeAlert + 1, "same warning in a new generation does not spend priority")
        generation += 1
        snapshot.clearOfficialAlert(checkedAt: Date().timeIntervalSince1970)
        try send()
        expect(transport.priorityTransfers.count == priorityBeforeAlert + 2, "cleared urgent warning promptly removes stale alert")

        // A failed WCSession activation must not latch the phone sender off
        // until its process restarts. The same receipt can trigger recovery.
        transport.failActivation()
        await drainCallbacks()
        let activationsBeforeRetry = transport.activationAttempts
        generation += 1
        let attemptsBeforeActivationRecovery = transport.contextAttempts.count
        try send()
        expect(transport.activationAttempts == activationsBeforeRetry + 1,
               "transient activation failure allows a new activation attempt")
        expect(transport.contextAttempts.count == attemptsBeforeActivationRecovery,
               "recovering session queues weather until activated")
        transport.finishActivation()
        await drainCallbacks()
        expect(currentGeneration() == generation && sync.lastError == nil,
               "activation recovery publishes the latest queued weather")

        // Exercise the real timer, not only delegate-driven flushes. A failed
        // foreground send gets another chance without a new weather receipt.
        generation += 1
        transport.failNextContextUpdate = true
        try send()
        let attemptsBeforeTimedRetry = transport.contextAttempts.count
        let retryDeadline = Date().addingTimeInterval(5)
        while currentGeneration() != generation && Date() < retryDeadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        expect(currentGeneration() == generation && sync.lastError == nil,
               "bounded foreground timer recovers a failed context without new input")
        expect(transport.contextAttempts.count == attemptsBeforeTimedRetry + 1,
               "successful timed retry does not create additional sends")

        print("PASS  Native Watch sender transport regressions")
    }

    @MainActor
    private static func drainCallbacks() async {
        // The real WCSession delegate forwards to MainActor using Task. This
        // short suspension lets that callback run without waiting for retries.
        try? await Task.sleep(for: .milliseconds(20))
    }
}
