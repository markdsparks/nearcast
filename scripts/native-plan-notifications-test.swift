import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
    print("PASS \(message)")
}

@MainActor enum NearcastBuildIdentity {
    static var remoteDeliveryEnabled = true
}

/// No system permission prompt, APNs registration or user account is touched.
@MainActor final class NativeNotificationRegistry {
    static let shared = NativeNotificationRegistry()
    var channel = NativePlanNotificationChannel(kind: "ios-apns", token: String(repeating: "a", count: 64), environment: "production", bundleId: "app.nearcast.ios")
    var permission = "granted"
    var requests = 0
    var refreshes = 0
    func requestChannel(reason: String) async -> [String: Any] {
        requests += 1
        expect(reason == "native-plan-opt-in", "permission request comes only from explicit native opt-in")
        return result()
    }
    func currentStatus() async -> [String: Any] { result() }
    func refreshAuthorizedChannel() async -> [String: Any] { refreshes += 1; return result() }
    private func result() -> [String: Any] {
        ["ok": permission == "granted", "permission": permission,
         "channel": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(channel))]
    }
    func reset() {
        channel = .init(kind: "ios-apns", token: String(repeating: "a", count: 64), environment: "production", bundleId: "app.nearcast.ios")
        permission = "granted"; requests = 0; refreshes = 0
        NearcastBuildIdentity.remoteDeliveryEnabled = true
    }
}

@MainActor private final class FakeNotificationServer {
    struct Request {
        let path: String
        let method: String
        let body: [String: Any]
    }
    enum Reply: Sendable {
        case json(Data), failure(URLError.Code)
        static func object(_ value: [String: Any]) -> Self {
            .json(try! JSONSerialization.data(withJSONObject: value))
        }
    }
    var requests: [Request] = []
    var supportsNativeScope = true
    var deliveryReady = true
    var loseNextRegisterReply = false
    var loseNextRemovalReply = false
    var wrongOwnerReceipt = false
    var holdNextPath: String?
    var pending: (CheckedContinuation<Reply, Never>, Reply)?
    var inFlight = 0
    var maximumInFlight = 0
    var registrations: [Request] { requests.filter { $0.path.hasSuffix("/register") } }
    var removals: [Request] { requests.filter { $0.path.hasSuffix("/unregister") } }
    var writes: [Request] { requests.filter { $0.method == "POST" } }

    func handle(_ request: URLRequest) async -> Reply {
        guard let url = request.url, url.scheme == "https", url.host == "getnearcast.app",
              url.path.hasPrefix("/api/watch/notifications/") else {
            fatalError("Unexpected network destination in isolated notification test")
        }
        let captured = Request(path: url.path, method: request.httpMethod ?? "GET", body: Self.body(request))
        requests.append(captured)
        inFlight += 1; maximumInFlight = max(maximumInFlight, inFlight)
        defer { inFlight -= 1 }
        let reply: Reply
        if url.path.hasSuffix("/config") {
            reply = .object(["nativeOwnerScopes": supportsNativeScope ? ["native-v1"] : [],
                           "nativePush": ["state": deliveryReady ? "ready" : "missing-apns-config"],
                           "storage": ["state": "ready"], "limits": ["mode": "production"]])
        } else if url.path.hasSuffix("/unregister") {
            if loseNextRemovalReply { loseNextRemovalReply = false; reply = .failure(.notConnectedToInternet) }
            else { reply = .object(["ok": true, "owner": "native-v1", "state": "deleted"]) }
        } else if url.path.hasSuffix("/register") {
            if loseNextRegisterReply { loseNextRegisterReply = false; reply = .failure(.networkConnectionLost) }
            else {
                reply = .object(["ok": true, "owner": wrongOwnerReceipt ? "legacy" : "native-v1", "state": "stored",
                               "subscriptionId": "native-v1-fixture",
                               "planCount": (captured.body["plans"] as? [Any])?.count ?? 0,
                               "expiresAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(7 * 24 * 3600))])
            }
        } else { fatalError("Unexpected notification route") }
        if holdNextPath == url.path {
            holdNextPath = nil
            return await withCheckedContinuation { continuation in pending = (continuation, reply) }
        }
        return reply
    }

    func release() {
        guard let (continuation, reply) = pending else { fatalError("No intercepted response is held") }
        pending = nil
        continuation.resume(returning: reply)
    }

    private static func body(_ request: URLRequest) -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
        }
        return data.isEmpty ? [:] : (try! JSONSerialization.jsonObject(with: data) as! [String: Any])
    }
}

private final class NotificationURLProtocol: URLProtocol, @unchecked Sendable {
    @MainActor static var server: FakeNotificationServer?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task { @MainActor in
            guard let server = Self.server else { fatalError("Missing isolated fixture server") }
            switch await server.handle(request) {
            case .failure(let code): client?.urlProtocol(self, didFailWithError: URLError(code))
            case .json(let data):
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            }
        }
    }
    override func stopLoading() {}
}

@main struct NativePlanNotificationsTests {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("Fixtures")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let preview = NativePreviewPlace(id: "away", name: "Los Angeles", latitude: 34, longitude: -118,
            timezone: "America/Los_Angeles", countryCode: "US")
        let place = NativeAgendaPlace(preview: preview)
        let calendar = try NativePlanSchedule.calendar(place)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: Date())!
        let start = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: tomorrow)!
        let end = start.addingTimeInterval(3600)
        let plan = try NativePlanSchedule.make(title: "Soccer", place: place, start: start, end: end, weekdays: [1, 3])
        let edited = try NativePlanSchedule.make(title: "Soccer practice", place: place, start: start, end: end,
            weekdays: [1, 3], existing: plan)
        let finalPlan = try NativePlanSchedule.make(title: "Final soccer time", place: place, start: start.addingTimeInterval(1800),
            end: end.addingTimeInterval(1800), weekdays: [1, 3], existing: edited)
        let registry = NativeNotificationRegistry.shared
        func fixture(_ name: String, seed: NativePlanNotificationArchive? = nil) throws -> (NativePlanNotifications, FakeNotificationServer, NativePlanNotificationDiskStore) {
            registry.reset()
            let server = FakeNotificationServer()
            NotificationURLProtocol.server = server
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [NotificationURLProtocol.self]
            let store = NativePlanNotificationDiskStore(file: directory.appendingPathComponent(name + ".json"))
            if let seed { try store.save(seed) }
            return (NativePlanNotifications(store: store, session: URLSession(configuration: config)), server, store)
        }
        func seeded(acknowledged: Bool = false) throws -> NativePlanNotificationArchive {
            var seed = NativePlanNotificationArchive()
            seed.enabledIDs = [plan.id]; seed.channel = registry.channel
            if acknowledged {
                seed.subscriptionID = "native-v1-fixture"
                seed.acknowledgedFingerprint = try NativePlanNotificationRequest.fingerprint(plans: [.init(plan: plan)], metric: false)
                seed.expiresAt = Date().addingTimeInterval(7 * 24 * 3600)
            }
            return seed
        }

        let target = try NativePlanNotificationTarget(plan: plan)
        expect(target.timezone == "America/Los_Angeles" && target.routine?.weekdays == [1, 3], "wire target preserves plan timezone and durable weekly schedule")
        let reference = Date()
        let pastStart = calendar.date(byAdding: .day, value: -3, to: start)!
        let ended = try NativePlanSchedule.make(title: "Finished", place: place, start: pastStart, end: pastStart.addingTimeInterval(3600))
        expect(!NativePlanNotificationTarget.hasUpcomingWindow(ended, now: reference), "completed one-off plans are not eligible for enrollment")
        do { _ = try NativePlanNotificationTarget(plan: ended, now: reference); fatalError("Ended plan accepted") } catch {}
        let oldRoutine = try NativePlanSchedule.make(title: "Weekly", place: place, start: pastStart, end: pastStart.addingTimeInterval(3600), weekdays: [1, 3])
        let routineTarget = try NativePlanNotificationTarget(plan: oldRoutine, now: reference)
        expect(NativePlanNotificationTarget.hasUpcomingWindow(oldRoutine, now: reference) && routineTarget.targetDate == oldRoutine.targetDate,
            "weekly enrollment retains durable anchor after its original occurrence ends")
        let trip = try NativePlanSchedule.make(title: "Trip", place: place, start: pastStart, end: end)
        let tripTarget = try NativePlanNotificationTarget(plan: trip, now: reference)
        expect(tripTarget.windows.count < trip.windows.count && tripTarget.targetDate == tripTarget.windows.first?.targetDate,
            "in-progress multi-day enrollment prunes completed windows and reanchors its target")
        let request = NativePlanNotificationRequest(nativeChannel: registry.channel, plans: [target],
            client: .init(appVersion: "test", locale: "en-US", timezone: "America/Chicago", unit: "fahrenheit"))
        let wire = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        expect((wire["client"] as? [String: Any])?["owner"] as? String == "native-v1", "native request has independent explicit owner scope")

        let (off, offServer, _) = try fixture("off")
        off.reconcile(plans: [plan], metric: false)
        await settle(off)
        expect(offServer.requests.isEmpty && registry.requests == 0 && off.archive.enabledIDs.isEmpty,
            "saving and reconciling a native plan does not opt in or contact delivery")

        let (unsupported, oldServer, _) = try fixture("unsupported")
        oldServer.supportsNativeScope = false
        await unsupported.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(unsupported)
        expect(oldServer.writes.isEmpty && registry.requests == 0 && unsupported.archive.enabledIDs.isEmpty,
            "old backend is blocked before permission or any POST")
        expect(unsupported.message.contains("native update") && !unsupported.isCurrent,
            "failed preflight keeps its actionable error instead of an automatic off-state drain")
        let (notReady, notReadyServer, _) = try fixture("not-ready")
        notReadyServer.deliveryReady = false
        await notReady.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(notReady)
        expect(notReadyServer.writes.isEmpty && registry.requests == 0, "missing delivery configuration cannot be presented as enrollment")

        let (denied, deniedServer, _) = try fixture("permission-denied")
        registry.permission = "denied"
        await denied.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(denied)
        expect(deniedServer.writes.isEmpty && denied.archive.enabledIDs.isEmpty && denied.message.contains("Settings"),
            "denied system permission never enrolls and points to Settings")

        let (enabled, enabledServer, enabledStore) = try fixture("enabled")
        await enabled.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(enabled)
        expect(enabled.isCurrent && enabled.archive.enabledIDs == [plan.id] && enabledServer.registrations.count == 1,
            "explicit opt-in becomes active only after scoped stored receipt")
        let reopened = try enabledStore.load()
        expect(reopened == enabled.archive, "acknowledged native notification intent survives reopening")
        let registration = enabledServer.registrations[0].body
        expect((registration["client"] as? [String: Any])?["owner"] as? String == "native-v1" &&
            ((registration["plans"] as? [[String: Any]])?.first?["timezone"] as? String) == place.timezone,
            "actual enrollment sends native owner and per-plan civil timezone")
        enabled.retry(plans: [plan], metric: false)
        await settle(enabled)
        expect(enabledServer.registrations.count == 1 && enabled.isCurrent && registry.refreshes >= 2,
            "same channel and current acknowledged fingerprint avoid duplicate registration")

        let (lost, lostServer, _) = try fixture("lost-response")
        lostServer.loseNextRegisterReply = true
        await lost.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(lost)
        expect(!lost.isCurrent && lost.archive.subscriptionID == nil && lost.archive.enabledIDs.contains(plan.id),
            "lost enrollment response retains intent without claiming active delivery")
        await lost.setEnabled(false, plan: plan, plans: [plan], metric: false)
        await settle(lost)
        expect(lostServer.removals.count == 1 && lost.isCurrent && lost.archive.enabledIDs.isEmpty,
            "disable unregisters by native channel even without a known receipt")
        expect((lostServer.removals[0].body["client"] as? [String: Any])?["owner"] as? String == "native-v1",
            "lost-response cleanup stays inside native owner namespace")

        for (name, newerPlans) in [("delete-during-optin", [NativeAgendaPlan]()), ("edit-during-optin", [edited])] {
            let (model, server, _) = try fixture(name)
            server.holdNextPath = "/api/watch/notifications/config"
            let task = Task { await model.setEnabled(true, plan: plan, plans: [plan], metric: false) }
            await waitUntil("held opt-in capability response") { server.pending != nil }
            model.reconcile(plans: newerPlans, metric: true)
            server.release()
            await task.value
            await settle(model)
            expect(server.registrations.isEmpty && model.archive.enabledIDs.isEmpty,
                "\(name) cannot restore the earlier plan or enroll its stale schedule")
        }

        let (foreground, foregroundServer, _) = try fixture("foreground-during-optin")
        foregroundServer.holdNextPath = "/api/watch/notifications/config"
        let foregroundTask = Task { await foreground.setEnabled(true, plan: plan, plans: [plan], metric: false) }
        await waitUntil("held capability check during foreground") { foregroundServer.pending != nil }
        foreground.reconcile(plans: [plan], metric: false)
        foregroundServer.release()
        await foregroundTask.value
        await settle(foreground)
        expect(foreground.isCurrent && foregroundServer.registrations.count == 1,
            "identical foreground reconciliation does not cancel explicit opt-in")

        var completedSeed = try seeded()
        completedSeed.enabledIDs = [ended.id]
        let (completed, completedServer, _) = try fixture("completed-pruning", seed: completedSeed)
        completed.reconcile(plans: [ended], metric: false)
        await settle(completed)
        expect(completed.archive.enabledIDs.isEmpty && completedServer.registrations.isEmpty && completedServer.removals.count == 1,
            "completed one-off watch is pruned and its native enrollment removed")

        let (serialized, serialServer, _) = try fixture("serial-edits", seed: seeded())
        serialServer.holdNextPath = "/api/watch/notifications/register"
        serialized.reconcile(plans: [plan], metric: false)
        await waitUntil("held original registration") { serialServer.pending != nil }
        serialized.reconcile(plans: [edited], metric: false)
        serialized.reconcile(plans: [finalPlan], metric: true)
        expect(!serialized.isCurrent, "new edits immediately invalidate an in-flight older acknowledgment")
        serialServer.release()
        await settle(serialized)
        expect(serialServer.registrations.count == 2 && serialServer.maximumInFlight == 1,
            "in-flight edits are serialized and coalesced into one latest inventory")
        let last = serialServer.registrations.last!.body
        expect((last["plans"] as? [[String: Any]])?.first?["title"] as? String == finalPlan.title &&
            (last["client"] as? [String: Any])?["unit"] as? String == "celsius",
            "latest edited schedule and units win after older request completion")
        let finalFingerprint = try NativePlanNotificationRequest.fingerprint(plans: [.init(plan: finalPlan)], metric: true)
        expect(serialized.archive.acknowledgedFingerprint == finalFingerprint && serialized.isCurrent,
            "only final native intent is acknowledged as current")

        let (deleted, deleteServer, _) = try fixture("delete-inflight", seed: seeded())
        deleteServer.holdNextPath = "/api/watch/notifications/register"
        deleted.reconcile(plans: [plan], metric: false)
        await waitUntil("held registration before deletion") { deleteServer.pending != nil }
        deleted.reconcile(plans: [], metric: false)
        deleteServer.release()
        await settle(deleted)
        expect(deleteServer.registrations.count == 1 && deleteServer.removals.count == 1 && deleted.archive.enabledIDs.isEmpty && deleted.archive.subscriptionID == nil,
            "deletion during registration is followed by scoped removal, never resurrection")

        let (rotated, rotateServer, _) = try fixture("rotation", seed: seeded(acknowledged: true))
        let oldToken = rotated.archive.channel!.token
        registry.channel = .init(kind: "ios-apns", token: String(repeating: "b", count: 64), environment: "production", bundleId: "app.nearcast.ios")
        rotated.retry(plans: [plan], metric: false)
        await settle(rotated)
        expect(rotateServer.writes.map(\.path) == ["/api/watch/notifications/unregister", "/api/watch/notifications/register"],
            "rotated APNs channel removes old native enrollment before new registration")
        expect((rotateServer.removals.first?.body["nativeChannel"] as? [String: Any])?["token"] as? String == oldToken &&
            (rotateServer.registrations.first?.body["nativeChannel"] as? [String: Any])?["token"] as? String == registry.channel.token,
            "token rotation cleanup and enrollment use their exact separate identities")
        expect(rotated.archive.channel == registry.channel && rotated.isCurrent, "rotated token receives its own current acknowledgment")

        registry.reset()
        let (rotationFailure, rotationFailureServer, _) = try fixture("rotation-cleanup-failure", seed: seeded(acknowledged: true))
        let retainedChannel = rotationFailure.archive.channel
        registry.channel = .init(kind: "ios-apns", token: String(repeating: "c", count: 64), environment: "production", bundleId: "app.nearcast.ios")
        rotationFailureServer.loseNextRemovalReply = true
        rotationFailure.retry(plans: [plan], metric: false)
        await settle(rotationFailure)
        expect(rotationFailureServer.registrations.isEmpty && rotationFailure.archive.channel == retainedChannel && !rotationFailure.isCurrent,
            "failed old-token removal retains its cleanup identity and blocks new enrollment")
        rotationFailure.retry(plans: [plan], metric: false)
        await settle(rotationFailure)
        expect(rotationFailureServer.removals.count == 2 && rotationFailureServer.registrations.count == 1 && rotationFailure.isCurrent,
            "retry finishes old-token retirement before registering the replacement")

        let (wrong, wrongServer, _) = try fixture("wrong-receipt")
        wrongServer.wrongOwnerReceipt = true
        await wrong.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(wrong)
        expect(!wrong.isCurrent && wrong.archive.acknowledgedFingerprint == nil && wrong.archive.subscriptionID == nil,
            "unscoped or wrong-owner receipt cannot acknowledge native intent")

        let corruptStore = NativePlanNotificationDiskStore(file: directory.appendingPathComponent("corrupt.json"))
        let corruptBytes = Data("invalid user choices".utf8)
        try corruptBytes.write(to: corruptStore.file)
        let corruptServer = FakeNotificationServer(); NotificationURLProtocol.server = corruptServer
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NotificationURLProtocol.self]
        let corrupt = NativePlanNotifications(store: corruptStore, session: URLSession(configuration: config))
        corrupt.reconcile(plans: [plan], metric: false)
        await corrupt.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(corrupt)
        let retainedCorruptBytes = try Data(contentsOf: corruptStore.file)
        expect(corruptServer.requests.isEmpty && !corrupt.isCurrent && retainedCorruptBytes == corruptBytes,
            "corrupt notification persistence fails closed without writes or network")

        let (dev, devServer, _) = try fixture("dev-disabled")
        NearcastBuildIdentity.remoteDeliveryEnabled = false
        await dev.setEnabled(true, plan: plan, plans: [plan], metric: false)
        await settle(dev)
        expect(devServer.requests.isEmpty && dev.archive.enabledIDs.isEmpty, "remote-disabled Dev cannot opt in or mutate server state")
    }

    @MainActor private static func waitUntil(_ message: String, condition: () -> Bool) async {
        for _ in 0..<2000 {
            if condition() { return }
            try? await Task.sleep(nanoseconds: 2_000_000)
        }
        fatalError("Timed out: \(message)")
    }

    @MainActor private static func settle(_ model: NativePlanNotifications) async {
        // Start scheduled drain tasks before testing their busy state.
        try? await Task.sleep(nanoseconds: 10_000_000)
        await waitUntil("native enrollment drain") { !model.isBusy }
        try? await Task.sleep(nanoseconds: 10_000_000)
        expect(!model.isBusy, "serialized notification work settles")
    }
}
