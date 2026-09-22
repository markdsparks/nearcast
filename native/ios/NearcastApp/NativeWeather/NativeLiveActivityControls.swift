import Foundation

/// An explicit user-selected weather notice, never a radar arrival estimate.
/// The payload opts out of legacy server tracking: native evidence supplies
/// neither a measured storm path nor a push-refresh contract.
struct NativeLiveActivityCandidate {
    let title: String
    let detail: String
    let payload: [String: Any]

    static func make(forecast: NativeWeatherForecast?, essentials: NativeWeatherEssentials?,
                     place: NativePreviewPlace, isOwnedPlace: Bool, now: Date = Date()) -> Self? {
        guard isOwnedPlace else { return nil }
        var route = URLComponents()
        route.scheme = "nearcast"
        route.host = "weather"
        route.queryItems = [URLQueryItem(name: "source", value: "live-activity"),
                            URLQueryItem(name: "placeId", value: place.id)]
        var payload: [String: Any] = ["placeName": place.name, "url": route.url?.absoluteString ?? "nearcast://weather",
                                      "nativeEvidence": true, "etaMinutes": 0]
        if let essentials,
           abs(essentials.latitude - place.latitude) <= 0.000_001,
           abs(essentials.longitude - place.longitude) <= 0.000_001,
           essentials.alerts.isFresh(now: now),
           let alert = essentials.alerts.activeAlerts(at: now).sorted(by: { $0.priority > $1.priority }).first {
            payload["stormName"] = alert.event
            payload["status"] = alert.event
            payload["detail"] = "Official alert for \(place.name). Open Nearcast for instructions."
            payload["confidence"] = "Official alert"
            payload["geometryQuality"] = "official-alert"
            payload["expiresAtEpoch"] = min(alert.endAt, alert.expiresAt).timeIntervalSince1970
            payload["evidenceUpdatedAtEpoch"] = essentials.alerts.checkedAt?.timeIntervalSince1970
            payload["evidenceStaleAtEpoch"] = essentials.alerts.validUntil?.timeIntervalSince1970
            payload["severity"] = ["Extreme": 4, "Severe": 3, "Moderate": 2, "Minor": 1][alert.severity] ?? 0
            return Self(title: alert.event, detail: "Current National Weather Service alert for \(place.name). No storm-arrival estimate.", payload: payload)
        }
        guard let forecast,
              now.timeIntervalSince(forecast.generatedAt) >= -60,
              now.timeIntervalSince(forecast.generatedAt) <= 60 * 60,
              let hour = forecast.hours.first(where: {
                  $0.date >= now.addingTimeInterval(-3599) && $0.date <= now.addingTimeInterval(4 * 60 * 60)
                      && ($0.thunderPossible || NativeWeatherCondition.isThunder($0.weatherCode))
              }) else { return nil }
        let time = nearcastClockLabel(hour.date, timeZone: forecast.timeZone, uses24HourClock: nearcastResolved24HourClock(nil), compact: true)
        let detail = "Thunder is possible around \(time). Hourly guidance, not an arrival estimate."
        payload["stormName"] = "Thunder forecast"
        payload["status"] = "Thunder possible around \(time)"
        payload["detail"] = detail
        payload["confidence"] = "Hourly forecast"
        payload["geometryQuality"] = "hourly-forecast"
        payload["expiresAtEpoch"] = hour.date.addingTimeInterval(60 * 60).timeIntervalSince1970
        payload["evidenceUpdatedAtEpoch"] = forecast.generatedAt.timeIntervalSince1970
        payload["evidenceStaleAtEpoch"] = forecast.generatedAt.addingTimeInterval(60 * 60).timeIntervalSince1970
        if let rain = hour.rainProbability, rain.isFinite { payload["rainChance"] = Int(rain.rounded()) }
        return Self(title: "Thunder forecast", detail: detail, payload: payload)
    }
}

#if os(iOS) && canImport(SwiftUI) && canImport(ActivityKit)
import SwiftUI

@MainActor
final class NativeLiveActivityModel: ObservableObject {
    @Published private(set) var isActive = false
    @Published private(set) var activePlace: String?
    @Published private(set) var isBusy = false
    @Published private(set) var message: String?

    func refreshStatus() {
        let status = NativeStormActivityController.shared.status()
        isActive = status["state"] as? String == "active"
        activePlace = status["placeName"] as? String
    }

    func start(_ candidate: NativeLiveActivityCandidate) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        let result = await NativeStormActivityController.shared.startOrUpdate(from: candidate.payload)
        message = result["ok"] as? Bool == true
            ? "Live Activity updated. Open Nearcast to refresh this saved reading."
            : ((result["reason"] as? String) == "live-activities-disabled"
                ? "Live Activities are disabled. You can enable them in iPhone Settings for Nearcast."
                : "Couldn’t start the Live Activity. Try again while Nearcast is open.")
        refreshStatus()
    }

    func end() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        let result = await NativeStormActivityController.shared.end([
            "status": "Weather notice ended", "detail": "This Live Activity has been ended on this iPhone."
        ])
        message = result["ok"] as? Bool == true ? "Live Activity ended." : "Couldn’t end the Live Activity. Try again."
        refreshStatus()
    }
}

/// Embeddable native controls. Merely opening this view only reads status.
struct NativeLiveActivityControls: View {
    let forecast: NativeWeatherForecast?
    let essentials: NativeWeatherEssentials?
    let place: NativePreviewPlace
    let isOwnedPlace: Bool
    @StateObject private var model = NativeLiveActivityModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Live Activity", systemImage: "platter.filled.bottom.iphone")
                .font(.headline)
            if model.isActive {
                Text("Active for \(model.activePlace ?? "your place")")
                    .font(.subheadline.weight(.semibold))
            }
            Text(candidate?.detail ?? (isOwnedPlace
                ? "A Live Activity is available when a current official alert or near-term thunder forecast is available."
                : "Choose a saved native place before starting a Live Activity."))
                .font(.subheadline)
            Text("Starts only when you choose. This is a saved weather reading, not continuous storm tracking or an emergency warning service. Open Nearcast and tap Update to refresh it.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let candidate {
                Button(model.isActive ? "Update Live Activity" : "Start Live Activity") {
                    // Revalidate freshness at the exact user action; a view
                    // that remained open cannot start with expired evidence.
                    guard let current = self.candidate else { return }
                    Task { await model.start(current) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isBusy)
                .accessibilityIdentifier("nearcast.native.live-activity.start")
                .accessibilityHint(candidate.title)
            }
            if model.isActive {
                Button("End Live Activity", role: .destructive) { Task { await model.end() } }
                    .disabled(model.isBusy)
                    .accessibilityIdentifier("nearcast.native.live-activity.end")
            }
            if let message = model.message {
                Text(message).font(.caption).accessibilityIdentifier("nearcast.native.live-activity.status")
            }
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .task { model.refreshStatus() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.refreshStatus() }
        }
    }

    private var candidate: NativeLiveActivityCandidate? {
        NativeLiveActivityCandidate.make(forecast: forecast, essentials: essentials,
            place: place, isOwnedPlace: isOwnedPlace)
    }
}
#endif
