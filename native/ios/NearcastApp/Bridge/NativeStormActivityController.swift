import ActivityKit
import Foundation

@MainActor
final class NativeStormActivityController {
    static let shared = NativeStormActivityController()

    private var activity: Activity<NearcastStormActivityAttributes>?
    private var pushTokenTask: Task<Void, Never>?
    private let registrationURL = URL(string: "https://getnearcast.app/api/live-activities/register")!
    private let endURL = URL(string: "https://getnearcast.app/api/live-activities/end")!

    private init() {}

    func startOrUpdate(from payload: [String: Any]) async -> [String: Any] {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return ["ok": false, "state": "unavailable", "reason": "live-activities-disabled"]
        }

        let placeName = cleanText(payload["placeName"], fallback: "Saved place", limit: 48)
        let stormName = cleanText(payload["stormName"], fallback: "Storm Watch", limit: 42)
        let status = cleanText(payload["status"], fallback: "Storm nearby", limit: 48)
        let detail = cleanText(payload["detail"], fallback: "Nearcast is tracking this storm.", limit: 86)
        let confidence = cleanText(payload["confidence"], fallback: "Watching", limit: 24)
        let etaMinutes = max(0, min(240, intValue(payload["etaMinutes"], fallback: 0)))
        let motionDegrees = clampedDouble(payload["motionDegrees"], min: 0, max: 360)
        let confidenceValue = clampedDouble(payload["confidenceValue"], min: 0, max: 1)
        let severity = clampedInt(payload["severity"], min: 0, max: 4)
        let rainChance = clampedInt(payload["rainChance"], min: 0, max: 100)
        let geometryQuality = cleanOptionalText(payload["geometryQuality"], limit: 18)
        let now = Date()
        let arrivalAtEpoch = epochValue(payload["arrivalAtEpoch"]) ?? now.addingTimeInterval(Double(etaMinutes) * 60).timeIntervalSince1970
        let expiresAtEpoch = epochValue(payload["expiresAtEpoch"]) ?? max(arrivalAtEpoch + 45 * 60, now.addingTimeInterval(30 * 60).timeIntervalSince1970)
        let deepLink = URL(string: cleanText(payload["url"], fallback: "nearcast://watching?source=live-activity", limit: 400))

        let attributes = NearcastStormActivityAttributes(
            placeName: placeName,
            stormName: stormName,
            deepLink: deepLink
        )
        let state = NearcastStormActivityAttributes.ContentState(
            etaMinutes: etaMinutes,
            status: status,
            detail: detail,
            confidence: confidence,
            updatedAt: now,
            updatedAtEpoch: now.timeIntervalSince1970,
            arrivalAtEpoch: arrivalAtEpoch,
            expiresAtEpoch: expiresAtEpoch,
            motionDegrees: motionDegrees,
            confidenceValue: confidenceValue,
            severity: severity,
            rainChance: rainChance,
            geometryQuality: geometryQuality
        )
        let content = ActivityContent(
            state: state,
            staleDate: now.addingTimeInterval(8 * 60),
            relevanceScore: etaMinutes <= 30 ? 95 : 75
        )

        if let existing = activity ?? Activity<NearcastStormActivityAttributes>.activities.first {
            activity = existing
            await existing.update(content)
            observePushToken(for: existing, payload: payload)
            return response(state: "updated", activityId: existing.id)
        }

        do {
            activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
            if let activity { observePushToken(for: activity, payload: payload) }
            return response(state: "started", activityId: activity?.id)
        } catch {
            return ["ok": false, "state": "failed", "reason": error.localizedDescription]
        }
    }

    func end(_ payload: [String: Any] = [:]) async -> [String: Any] {
        let finalStatus = cleanText(payload["status"], fallback: "Storm watch ended", limit: 48)
        let finalDetail = cleanText(payload["detail"], fallback: "Nearcast is no longer tracking an incoming storm.", limit: 86)
        let finalConfidence = cleanText(payload["confidence"], fallback: "Ended", limit: 24)
        let activityToEnd = activity ?? Activity<NearcastStormActivityAttributes>.activities.first

        guard let activityToEnd else {
            activity = nil
            return ["ok": true, "state": "none"]
        }

        let state = NearcastStormActivityAttributes.ContentState(
            etaMinutes: 0,
            status: finalStatus,
            detail: finalDetail,
            confidence: finalConfidence,
            updatedAt: Date(),
            updatedAtEpoch: Date().timeIntervalSince1970,
            arrivalAtEpoch: Date().timeIntervalSince1970,
            expiresAtEpoch: Date().timeIntervalSince1970,
            motionDegrees: nil,
            confidenceValue: nil,
            severity: nil,
            rainChance: nil,
            geometryQuality: "ended"
        )
        await activityToEnd.end(
            ActivityContent(state: state, staleDate: Date()),
            dismissalPolicy: .after(Date().addingTimeInterval(10 * 60))
        )
        pushTokenTask?.cancel()
        pushTokenTask = nil
        Task { await notifyServerEnded(activityId: activityToEnd.id) }
        activity = nil
        return ["ok": true, "state": "ended", "activityId": activityToEnd.id]
    }

    func status() -> [String: Any] {
        let current = activity ?? Activity<NearcastStormActivityAttributes>.activities.first
        if let current {
            activity = current
            return response(state: "active", activityId: current.id)
        }
        return ["ok": true, "state": "none"]
    }

    private func response(state: String, activityId: String?) -> [String: Any] {
        var payload: [String: Any] = ["ok": true, "state": state]
        if let activityId { payload["activityId"] = activityId }
        return payload
    }

    private func cleanText(_ value: Any?, fallback: String, limit: Int) -> String {
        let text = String(describing: value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = text.isEmpty || text == "nil" ? fallback : text
        if resolved.count <= limit { return resolved }
        return String(resolved.prefix(limit - 1)) + "…"
    }

    private func cleanOptionalText(_ value: Any?, limit: Int) -> String? {
        let text = String(describing: value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text != "nil" else { return nil }
        if text.count <= limit { return text }
        return String(text.prefix(limit - 1)) + "…"
    }

    private func intValue(_ value: Any?, fallback: Int) -> Int {
        if let int = value as? Int { return int }
        if let double = value as? Double { return Int(double.rounded()) }
        if let string = value as? String, let double = Double(string) { return Int(double.rounded()) }
        return fallback
    }

    private func doubleValue(_ value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private func clampedDouble(_ value: Any?, min minValue: Double, max maxValue: Double) -> Double? {
        guard let double = doubleValue(value), double.isFinite else { return nil }
        return Swift.max(minValue, Swift.min(maxValue, double))
    }

    private func clampedInt(_ value: Any?, min minValue: Int, max maxValue: Int) -> Int? {
        let int = intValue(value, fallback: Int.min)
        guard int != Int.min else { return nil }
        return Swift.max(minValue, Swift.min(maxValue, int))
    }

    private func epochValue(_ value: Any?) -> Double? {
        guard let value = doubleValue(value), value.isFinite, value > 0 else { return nil }
        return value > 10_000_000_000 ? value / 1000 : value
    }

    private func observePushToken(for activity: Activity<NearcastStormActivityAttributes>, payload: [String: Any]) {
        pushTokenTask?.cancel()
        pushTokenTask = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                await self?.register(activity: activity, token: token, payload: payload)
            }
        }
    }

    private func register(activity: Activity<NearcastStormActivityAttributes>, token: String, payload: [String: Any]) async {
        var body: [String: Any] = [
            "activityId": activity.id,
            "token": token,
            "environment": apnsEnvironment(),
            "bundleId": Bundle.main.bundleIdentifier ?? "app.nearcast.ios",
            "placeName": cleanText(payload["placeName"], fallback: "Saved place", limit: 48),
            "stormName": cleanText(payload["stormName"], fallback: "Storm Watch", limit: 42),
            "status": cleanText(payload["status"], fallback: "Storm nearby", limit: 48),
            "detail": cleanText(payload["detail"], fallback: "Nearcast is tracking this storm.", limit: 86),
            "confidence": cleanText(payload["confidence"], fallback: "Watching", limit: 24),
            "etaMinutes": max(0, min(240, intValue(payload["etaMinutes"], fallback: 0))),
            "url": cleanText(payload["url"], fallback: "nearcast://weather?source=live-activity", limit: 400)
        ]
        ["latitude", "longitude", "arrivalAtEpoch", "expiresAtEpoch", "confidenceValue", "severity", "rainChance", "motionDegrees", "geometryQuality"].forEach {
            if let value = payload[$0] { body[$0] = value }
        }
        await postJSON(body, to: registrationURL)
    }

    private func notifyServerEnded(activityId: String) async {
        await postJSON(["activityId": activityId], to: endURL)
    }

    private func postJSON(_ body: [String: Any], to url: URL) async {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        _ = try? await URLSession.shared.data(for: request)
    }

    private func apnsEnvironment() -> String {
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }
}
