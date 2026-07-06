import Foundation
import UIKit
import UserNotifications

@MainActor
final class NativeNotificationRegistry: NSObject {
    static let shared = NativeNotificationRegistry()

    private let tokenKey = "nearcast.native.apnsToken"
    private var pendingTokenContinuations: [CheckedContinuation<String?, Never>] = []
    private var lastRegistrationError = ""

    private override init() {
        super.init()
    }

    func currentStatus() async -> [String: Any] {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return [
            "ok": notificationPermission(settings) == "granted",
            "permission": notificationPermission(settings),
            "state": "status",
            "channel": nativeChannelPayload(token: storedToken()) as Any
        ]
    }

    func requestChannel(reason: String) async -> [String: Any] {
        let center = UNUserNotificationCenter.current()
        var settings = await center.notificationSettings()
        var permission = notificationPermission(settings)

        if settings.authorizationStatus == .denied {
            return [
                "ok": false,
                "permission": permission,
                "state": "denied",
                "reason": "permission-denied"
            ]
        }

        if settings.authorizationStatus == .notDetermined {
            let granted = await requestAuthorization(center)
            settings = await center.notificationSettings()
            permission = granted ? "granted" : notificationPermission(settings)
        }

        guard permission == "granted" else {
            return [
                "ok": false,
                "permission": permission,
                "state": "not-authorized",
                "reason": "permission-not-granted"
            ]
        }

        let token = await remoteNotificationToken()
        guard let token, !token.isEmpty else {
            return [
                "ok": false,
                "permission": permission,
                "state": "token-unavailable",
                "reason": lastRegistrationError.isEmpty ? "apns-token-unavailable" : lastRegistrationError
            ]
        }

        return [
            "ok": true,
            "permission": permission,
            "state": "ready",
            "reason": reason,
            "channel": nativeChannelPayload(token: token) as Any
        ]
    }

    func updateDeviceToken(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: tokenKey)
        lastRegistrationError = ""
        resolveTokenContinuations(token)
    }

    func updateRegistrationError(_ error: Error) {
        lastRegistrationError = error.localizedDescription
        resolveTokenContinuations(nil)
    }

    private func requestAuthorization(_ center: UNUserNotificationCenter) async -> Bool {
        await withCheckedContinuation { continuation in
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                continuation.resume(returning: granted)
            }
        }
    }

    private func remoteNotificationToken() async -> String? {
        if let token = storedToken(), !token.isEmpty {
            return token
        }

        return await withCheckedContinuation { continuation in
            pendingTokenContinuations.append(continuation)
            UIApplication.shared.registerForRemoteNotifications()
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                await MainActor.run {
                    self?.resolveTokenContinuations(nil)
                }
            }
        }
    }

    private func storedToken() -> String? {
        let token = UserDefaults.standard.string(forKey: tokenKey) ?? ""
        return token.isEmpty ? nil : token
    }

    private func resolveTokenContinuations(_ token: String?) {
        guard !pendingTokenContinuations.isEmpty else { return }
        let continuations = pendingTokenContinuations
        pendingTokenContinuations = []
        continuations.forEach { $0.resume(returning: token) }
    }

    private func notificationPermission(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return "granted"
        case .denied:
            return "denied"
        case .notDetermined:
            return "default"
        @unknown default:
            return "default"
        }
    }

    private func nativeChannelPayload(token: String?) -> [String: Any]? {
        guard let token, !token.isEmpty else { return nil }
        return [
            "kind": "ios-apns",
            "token": token,
            "environment": apnsEnvironment(),
            "bundleId": Bundle.main.bundleIdentifier ?? "app.nearcast.ios",
            "deviceModel": UIDevice.current.model,
            "systemVersion": UIDevice.current.systemVersion
        ]
    }

    private func apnsEnvironment() -> String {
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }
}
