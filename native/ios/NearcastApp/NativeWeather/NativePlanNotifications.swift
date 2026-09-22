import Foundation
import Combine
#if os(iOS)
import SwiftUI
#endif

/// Durable native opt-in plus a serialized, latest-intent-wins server drain.
/// A saved choice is never presented as active delivery until acknowledged.
@MainActor
final class NativePlanNotifications: ObservableObject {
    static let shared = NativePlanNotifications()
    @Published private(set) var archive = NativePlanNotificationArchive()
    @Published private(set) var message = "Notifications are off until you choose a plan."
    @Published private var enrolling = false
    @Published private var draining = false
    var isBusy: Bool { enrolling || draining }
    @Published private(set) var isCurrent = false
    private var loadFailed = false
    private var generation = 0
    private var plans: [NativeAgendaPlan] = []
    private var metric = false
    private let store: NativePlanNotificationDiskStore
    private let session: URLSession
    private let base = URL(string: "https://getnearcast.app")!

    init(store: NativePlanNotificationDiskStore? = nil, session: URLSession = .shared) {
        self.store = store ?? .init(file: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NearcastNativePlans/notifications.v1.json"))
        self.session = session
        do {
            archive = try self.store.load()
            if !archive.enabledIDs.isEmpty || archive.subscriptionID != nil {
                message = "Checking notification registration…"
            }
        } catch {
            loadFailed = true
            message = "Notification choices could not be read. Nothing has been replaced."
        }
    }

    func reconcile(plans: [NativeAgendaPlan], metric: Bool) {
        guard !loadFailed else { return }
        self.plans = plans
        self.metric = metric
        var next = archive
        next.enabledIDs.formIntersection(Set(plans.filter { NativePlanNotificationTarget.hasUpcomingWindow($0) }.map(\.id)))
        guard persist(next) else { return }
        generation += 1
        isCurrent = false
        Task { await drain() }
    }

    func setEnabled(_ enabled: Bool, plan: NativeAgendaPlan, plans: [NativeAgendaPlan], metric: Bool) async {
        guard !loadFailed, !isBusy else { return }
        let enrollmentGeneration = generation
        var shouldDrain = false
        enrolling = true
        defer {
            enrolling = false
            if shouldDrain || (generation != enrollmentGeneration && archive.channel != nil) {
                Task { await drain() }
            }
        }
        self.plans = plans
        self.metric = metric
        if enabled {
            guard NativePlanNotificationTarget.hasUpcomingWindow(plan) else {
                message = "This plan has ended. Create or edit a future plan to watch its weather."
                return
            }
            guard NearcastBuildIdentity.remoteDeliveryEnabled else {
                message = "This Dev build has remote delivery disabled. Plans still save and check weather here. A notification-enabled build is required for background alerts."
                return
            }
            // Capability check happens before permission, and critically before
            // a write: an older backend must never overwrite a legacy channel.
            do { try await requireNativeScope(forEnrollment: true) }
            catch { message = error.localizedDescription; return }
            let status = await NativeNotificationRegistry.shared.requestChannel(reason: "native-plan-opt-in")
            // Opening iOS permission UI can cause an identical foreground
            // reconciliation. Compare content, not that lifecycle revision.
            guard self.plans.contains(where: { $0 == plan }), self.metric == metric else {
                message = "This plan changed while notifications were being enabled. Review it and try again."
                return
            }
            guard status["ok"] as? Bool == true,
                  let raw = status["channel"] as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let channel = try? JSONDecoder().decode(NativePlanNotificationChannel.self, from: data), channel.isValid else {
                message = status["permission"] as? String == "denied"
                    ? "Notifications are blocked in iPhone Settings. Allow them there, then try again."
                    : "Could not register this iPhone for notifications. Please try again."
                return
            }
            var next = archive
            // Existing channel is retired by the serialized drain if APNs
            // rotated. Do not discard the identity needed to remove it.
            if next.channel == nil { next.channel = channel }
            next.enabledIDs.insert(plan.id)
            guard persist(next) else { return }
        } else {
            var next = archive
            next.enabledIDs.remove(plan.id)
            guard persist(next) else { return }
        }
        reconcile(plans: self.plans, metric: self.metric)
        shouldDrain = true
    }

    func retry(plans: [NativeAgendaPlan], metric: Bool) { reconcile(plans: plans, metric: metric) }

    private func persist(_ next: NativePlanNotificationArchive) -> Bool {
        do {
            try store.save(next)
            archive = next
            return true
        } catch {
            message = "Could not save notification choices. No new request was sent."
            isCurrent = false
            return false
        }
    }

    private func drain() async {
        guard !draining, !enrolling, !loadFailed else { return }
        draining = true
        defer { draining = false }
        repeat {
            let attemptedGeneration = generation
            do {
                let enabled = plans.filter { archive.enabledIDs.contains($0.id) && NativePlanNotificationTarget.hasUpcomingWindow($0) }.sorted { $0.id < $1.id }
                let targets = try enabled.map { try NativePlanNotificationTarget(plan: $0) }
                let fingerprint = try NativePlanNotificationRequest.fingerprint(plans: targets, metric: metric)
                guard let channel = archive.channel else {
                    message = archive.enabledIDs.isEmpty ? "Notifications are off until you choose a plan." : "Register this iPhone again to enable delivery."
                    isCurrent = archive.enabledIDs.isEmpty
                    return
                }
                guard NearcastBuildIdentity.remoteDeliveryEnabled else {
                    message = "Remote notifications are disabled in this Dev build. No server changes were made."
                    return
                }
                try await requireNativeScope(forEnrollment: !targets.isEmpty)
                if targets.isEmpty {
                    // Derive removal from the channel even if a previous
                    // successful register response was lost in transit.
                    do {
                        try await remove(channel: channel, subscriptionID: archive.subscriptionID)
                    }
                    var next = archive
                    next.subscriptionID = nil
                    next.acknowledgedFingerprint = nil
                    next.expiresAt = nil
                    guard persist(next) else { return }
                    if generation == attemptedGeneration { message = "Native plan notifications are off."; isCurrent = true }
                } else {
                    let status = await NativeNotificationRegistry.shared.refreshAuthorizedChannel()
                    guard status["permission"] as? String == "granted" else { throw DeliveryError.permission }
                    guard status["ok"] as? Bool == true,
                          let raw = status["channel"] as? [String: Any],
                          let data = try? JSONSerialization.data(withJSONObject: raw),
                          let currentChannel = try? JSONDecoder().decode(NativePlanNotificationChannel.self, from: data),
                          currentChannel.isValid else { throw DeliveryError.notReady }
                    if currentChannel != channel {
                        // Retire only our old native namespace before enrolling
                        // the rotated token. Failure retains the old identity.
                        try await remove(channel: channel, subscriptionID: archive.subscriptionID)
                        var next = archive
                        next.channel = currentChannel
                        next.subscriptionID = nil
                        next.acknowledgedFingerprint = nil
                        next.expiresAt = nil
                        guard persist(next) else { return }
                        generation += 1
                        continue
                    }
                    // Refresh registrations well before their server TTL expires.
                    if archive.acknowledgedFingerprint == fingerprint,
                       let expiry = archive.expiresAt, expiry.timeIntervalSinceNow > 24 * 3600 {
                        if generation == attemptedGeneration { message = "Watching for meaningful weather changes."; isCurrent = true }
                    } else {
                        let request = NativePlanNotificationRequest(nativeChannel: channel, plans: targets,
                            client: .init(appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1",
                                locale: Locale.current.identifier, timezone: TimeZone.current.identifier, unit: metric ? "celsius" : "fahrenheit"))
                        let receipt: NativePlanNotificationReceipt = try await post("/api/watch/notifications/register", value: request)
                        // Even a not-ready service may have stored the record;
                        // retain its identifier so disabling can remove it.
                        if receipt.owner == "native-v1", let id = receipt.subscriptionId, !id.isEmpty {
                            var next = archive
                            next.subscriptionID = id
                            guard persist(next) else { return }
                        }
                        guard receipt.confirms(targetCount: targets.count) else { throw DeliveryError.notReady }
                        var next = archive
                        next.acknowledgedFingerprint = fingerprint
                        next.expiresAt = receipt.expiresAt.flatMap { ISO8601DateFormatter().date(from: $0) }
                        if next.expiresAt == nil, let text = receipt.expiresAt {
                            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                            next.expiresAt = formatter.date(from: text)
                        }
                        guard persist(next) else { return }
                        if generation == attemptedGeneration { message = "Watching for meaningful weather changes."; isCurrent = true }
                    }
                }
            } catch {
                if generation == attemptedGeneration {
                    message = archive.enabledIDs.isEmpty && archive.channel != nil
                        ? "Turn-off is pending. Earlier native notifications may still arrive until the server confirms. Retry when connected."
                        : error.localizedDescription
                    isCurrent = false
                }
            }
            if generation == attemptedGeneration { break }
            // A plan edited/deleted during a request gets a new full inventory.
            // Never allow an older completion to acknowledge that newer intent.
        } while true
    }

    private func requireNativeScope(forEnrollment: Bool = false) async throws {
        let url = base.appendingPathComponent("api/watch/notifications/config")
        var request = URLRequest(url: url); request.timeoutInterval = 15; request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try validate(response, path: url.path)
        guard data.count < 100_000,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              (value["nativeOwnerScopes"] as? [String])?.contains("native-v1") == true else { throw DeliveryError.setup }
        if forEnrollment {
            guard let push = value["nativePush"] as? [String: Any], push["state"] as? String == "ready",
                  let storage = value["storage"] as? [String: Any], storage["state"] as? String == "ready",
                  let limits = value["limits"] as? [String: Any],
                  ["production", "on", "enabled", "true"].contains(limits["mode"] as? String ?? "") else { throw DeliveryError.notReady }
        }
    }

    private func remove(channel: NativePlanNotificationChannel, subscriptionID: String?) async throws {
        struct Removal: Encodable {
            let nativeChannel: NativePlanNotificationChannel
            let subscriptionId: String?
            let client: Owner
            struct Owner: Encodable { let owner = "native-v1" }
        }
        let receipt: NativePlanNotificationReceipt = try await post("/api/watch/notifications/unregister",
            value: Removal(nativeChannel: channel, subscriptionId: subscriptionID, client: .init()))
        guard receipt.ok, receipt.owner == "native-v1", receipt.state == "deleted" else { throw DeliveryError.pendingRemoval }
    }

    private func post<Value: Encodable, Reply: Decodable>(_ path: String, value: Value) async throws -> Reply {
        var request = URLRequest(url: base.appendingPathComponent(String(path.dropFirst())))
        request.httpMethod = "POST"; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(value)
        let (data, response) = try await session.data(for: request)
        try validate(response, path: path)
        guard data.count < 100_000 else { throw DeliveryError.notReady }
        return try JSONDecoder().decode(Reply.self, from: data)
    }

    private func validate(_ response: URLResponse, path: String) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              response.url?.scheme == "https", response.url?.host == base.host, response.url?.path == path else { throw DeliveryError.notReady }
    }

    private enum DeliveryError: LocalizedError {
        case setup, notReady, permission, pendingRemoval
        var errorDescription: String? {
            switch self {
            case .setup: "The notification service needs its native update before enrollment. No older notifications were changed."
            case .notReady: "Notification delivery is not confirmed. Your choice is saved; retry when connected."
            case .permission: "Notifications are blocked in iPhone Settings. Allow them there to resume delivery."
            case .pendingRemoval: "Turning notifications off is waiting for server confirmation."
            }
        }
    }
}

#if os(iOS)
struct NativePlanNotificationControls: View {
    let plan: NativeAgendaPlan
    let plans: [NativeAgendaPlan]
    let metric: Bool
    @ObservedObject private var notifications = NativePlanNotifications.shared
    @State private var confirming = false
    private var enabled: Bool { notifications.archive.enabledIDs.contains(plan.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Keep an eye on this plan", systemImage: "bell.badge").font(.headline)
            Text(enabled && notifications.isCurrent ? "On · meaningful weather changes" : enabled ? "Requested · delivery not confirmed" : "Off · checked when you open it")
                .font(.subheadline.weight(.medium))
            Text(notifications.message).font(.footnote).foregroundStyle(.secondary)
            if enabled {
                Button("Turn off plan notifications") { Task { await notifications.setEnabled(false, plan: plan, plans: plans, metric: metric) } }
            } else {
                Button("Notify me of weather changes", systemImage: "bell") { confirming = true }
                    .buttonStyle(.bordered)
                    .disabled(!NativePlanNotificationTarget.hasUpcomingWindow(plan))
            }
            if !notifications.isCurrent && !notifications.isBusy {
                Button("Retry notification sync") { notifications.retry(plans: plans, metric: metric) }
                    .font(.footnote)
            }
            if notifications.isBusy { ProgressView("Updating notification choices…") }
            Text("Forecast changes are guidance, not an emergency warning service. You can turn this off at any time.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .disabled(notifications.isBusy)
        .accessibilityIdentifier("plan.native.notifications")
        .confirmationDialog("Watch this plan in the background?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Enable for this plan") { Task { await notifications.setEnabled(true, plan: plan, plans: plans, metric: metric) } }
        } message: {
            Text("Nearcast will send this plan’s title, place, and schedule to its weather service and register this iPhone for push notifications. Old-app notifications are separate; turn those off in the old app if you enabled them, to avoid duplicates. Saving or deleting a native plan never changes old-app watches.")
        }
    }
}
#endif
