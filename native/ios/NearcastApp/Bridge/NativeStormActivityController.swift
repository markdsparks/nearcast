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
        let nativeEvidence = payload["nativeEvidence"] as? Bool == true
        let arrivalAtEpoch = nativeEvidence ? nil : (epochValue(payload["arrivalAtEpoch"]) ?? now.addingTimeInterval(Double(etaMinutes) * 60).timeIntervalSince1970)
        let expiresAtEpoch = epochValue(payload["expiresAtEpoch"]) ?? max((arrivalAtEpoch ?? now.timeIntervalSince1970) + 45 * 60, now.addingTimeInterval(30 * 60).timeIntervalSince1970)
        guard expiresAtEpoch > now.timeIntervalSince1970 else {
            return ["ok": false, "state": "unavailable", "reason": "weather-evidence-expired"]
        }
        let evidenceUpdatedAt = nativeEvidence ? epochValue(payload["evidenceUpdatedAtEpoch"]).map(Date.init(timeIntervalSince1970:)) ?? now : now
        let staleDate = nativeEvidence ? epochValue(payload["evidenceStaleAtEpoch"]).map(Date.init(timeIntervalSince1970:)) ?? now : now.addingTimeInterval(8 * 60)
        let remoteUpdates = NearcastBuildIdentity.remoteDeliveryEnabled && !nativeEvidence
        let deepLink = nativeDeepLinkURL(
            from: payload["url"],
            fallbackRoute: "watching?source=live-activity"
        )

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
            updatedAt: evidenceUpdatedAt,
            updatedAtEpoch: evidenceUpdatedAt.timeIntervalSince1970,
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
            staleDate: min(staleDate, Date(timeIntervalSince1970: expiresAtEpoch)),
            relevanceScore: etaMinutes <= 30 ? 95 : 75
        )

        if let existing = currentActivity(),
           existing.attributes.placeName == attributes.placeName,
           existing.attributes.stormName == attributes.stormName,
           existing.attributes.deepLink == attributes.deepLink,
           isNativeEvidence(existing.content.state) == nativeEvidence {
            activity = existing
            await existing.update(content)
            if remoteUpdates {
                observePushToken(for: existing, payload: payload)
            }
            return response(state: "updated", activityId: existing.id, remoteUpdates: remoteUpdates)
        }

        // Activity attributes cannot be replaced by update(). A user choosing
        // another place/notice explicitly replaces the old display, otherwise
        // its old title and deep link would mislabel the new weather.
        if currentActivity() != nil { _ = await end() }

        do {
            if remoteUpdates {
                activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
            } else {
                activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
            }
            if remoteUpdates, let activity {
                observePushToken(for: activity, payload: payload)
            }
            return response(state: "started", activityId: activity?.id, remoteUpdates: remoteUpdates)
        } catch {
            return ["ok": false, "state": "failed", "reason": error.localizedDescription]
        }
    }

    func end(_ payload: [String: Any] = [:]) async -> [String: Any] {
        let finalStatus = cleanText(payload["status"], fallback: "Storm watch ended", limit: 48)
        let finalDetail = cleanText(payload["detail"], fallback: "Nearcast is no longer tracking an incoming storm.", limit: 86)
        let finalConfidence = cleanText(payload["confidence"], fallback: "Ended", limit: 24)
        let activityToEnd = currentActivity()

        guard let activityToEnd else {
            activity = nil
            return ["ok": true, "state": "none"]
        }
        let nativeEvidence = isNativeEvidence(activityToEnd.content.state)
        let shouldNotifyServer = NearcastBuildIdentity.remoteDeliveryEnabled && !nativeEvidence

        let state = NearcastStormActivityAttributes.ContentState(
            etaMinutes: 0,
            status: finalStatus,
            detail: finalDetail,
            confidence: finalConfidence,
            updatedAt: Date(),
            updatedAtEpoch: Date().timeIntervalSince1970,
            arrivalAtEpoch: nativeEvidence ? nil : Date().timeIntervalSince1970,
            expiresAtEpoch: Date().timeIntervalSince1970,
            motionDegrees: nil,
            confidenceValue: nil,
            severity: nil,
            rainChance: nil,
            geometryQuality: nativeEvidence ? activityToEnd.content.state.geometryQuality : "ended"
        )
        await activityToEnd.end(
            ActivityContent(state: state, staleDate: Date()),
            dismissalPolicy: nativeEvidence ? .immediate : .after(Date().addingTimeInterval(10 * 60))
        )
        pushTokenTask?.cancel()
        pushTokenTask = nil
        if shouldNotifyServer {
            Task { await notifyServerEnded(activityId: activityToEnd.id) }
        }
        activity = nil
        return ["ok": true, "state": "ended", "activityId": activityToEnd.id]
    }

    func status() -> [String: Any] {
        let current = currentActivity()
        if let current {
            activity = current
            var result = response(state: "active", activityId: current.id,
                remoteUpdates: NearcastBuildIdentity.remoteDeliveryEnabled && !isNativeEvidence(current.content.state))
            result["placeName"] = current.attributes.placeName
            result["stormName"] = current.attributes.stormName
            return result
        }
        return ["ok": true, "state": "none"]
    }

    private func currentActivity() -> Activity<NearcastStormActivityAttributes>? {
        let current = ([activity].compactMap { $0 } + Activity<NearcastStormActivityAttributes>.activities).first(where: {
            $0.activityState == .active || $0.activityState == .stale
        })
        guard let current, current.activityState == .active || current.activityState == .stale else {
            activity = nil
            return nil
        }
        return current
    }

    private func isNativeEvidence(_ state: NearcastStormActivityAttributes.ContentState) -> Bool {
        ["official-alert", "hourly-forecast"].contains(state.geometryQuality ?? "")
    }

    private func response(state: String, activityId: String?, remoteUpdates: Bool) -> [String: Any] {
        var payload: [String: Any] = [
            "ok": true,
            "state": state,
            "remoteUpdates": remoteUpdates
        ]
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

    private func nativeDeepLinkURL(from value: Any?, fallbackRoute: String) -> URL? {
        let fallback = "\(NearcastBuildIdentity.urlScheme)://\(fallbackRoute)"
        let raw = cleanText(value, fallback: fallback, limit: 400)
        guard var components = URLComponents(string: raw) else {
            return URL(string: fallback)
        }
        let incomingScheme = components.scheme?.lowercased()
        guard incomingScheme == "nearcast" || incomingScheme == NearcastBuildIdentity.urlScheme else {
            return URL(string: fallback)
        }
        components.scheme = NearcastBuildIdentity.urlScheme
        return components.url ?? URL(string: fallback)
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
            "url": nativeDeepLinkURL(
                from: payload["url"],
                fallbackRoute: "weather?source=live-activity"
            )?.absoluteString ?? "\(NearcastBuildIdentity.urlScheme)://weather?source=live-activity"
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
