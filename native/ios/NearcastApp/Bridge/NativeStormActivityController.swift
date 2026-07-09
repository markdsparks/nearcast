import ActivityKit
import Foundation

@MainActor
final class NativeStormActivityController {
    static let shared = NativeStormActivityController()

    private var activity: Activity<NearcastStormActivityAttributes>?

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
            updatedAt: Date(),
            motionDegrees: motionDegrees,
            confidenceValue: confidenceValue,
            severity: severity,
            rainChance: rainChance,
            geometryQuality: geometryQuality
        )
        let content = ActivityContent(
            state: state,
            staleDate: Date().addingTimeInterval(12 * 60),
            relevanceScore: etaMinutes <= 30 ? 95 : 75
        )

        if let existing = activity ?? Activity<NearcastStormActivityAttributes>.activities.first {
            activity = existing
            await existing.update(content)
            return response(state: "updated", activityId: existing.id)
        }

        do {
            activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
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
}
