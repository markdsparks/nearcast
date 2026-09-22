import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
    print("PASS \(message)")
}

@MainActor private final class Memory {
    var publication: NearcastWidgetSnapshotStore.Publication?
    var writes = 0
    var failWrites = false
    lazy var publisher = NativeSnapshotPublicationCoordinator(readPublication: { self.publication }, writePublication: { snapshot, place in
        guard !self.failWrites else { return false }
        self.publication = .init(snapshot: snapshot, place: place)
        self.writes += 1
        return true
    }, replayPublication: { _ in true })
}

@main struct NativeCompanionContentTests {
    @MainActor static func main() {
        let now = Date()
        let zone = TimeZone(identifier: "UTC")!
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let day = DateFormatter(); day.timeZone = zone; day.dateFormat = "yyyy-MM-dd"
        let hour = Double(calendar.component(.hour, from: now))
        // Keep the plan within this UTC day even when the test runs near midnight.
        let start = min(hour, 22), end = start + 2
        let planPlace = NativeAgendaPlace(id: "home", legacyIDType: nil, name: "Home", admin1: "", country: "US", countryCode: "US",
            latitude: 38, longitude: -90, alias: nil, timezone: "UTC", followsCurrentLocation: false)
        let preview = NativePreviewPlace(id: "home", name: "Home", latitude: 38, longitude: -90, timezone: "UTC", countryCode: "US")
        let item = NativeAgendaItem(id: "native-one-window", planID: "native-one", title: "Soccer", label: "Plan window", place: planPlace,
            kind: .scheduledWindow, startDate: day.string(from: now), startHour: start,
            endDate: day.string(from: now), endHour: end, isInProgress: true)
        let window = NativePlanEvidenceWindow(item: item)!
        let hours = [0, 1].map { offset in
            NativeForecastPoint(date: window.startsAt.addingTimeInterval(Double(offset) * 3600), temperature: 75,
                apparentTemperature: 74, rainProbability: 70, windSpeed: 5, weatherCode: 95, isDay: true)
        }
        func forecast(at date: Date) -> NativeWeatherForecast {
            NativeWeatherForecast(generatedAt: date, timezoneID: "UTC", metric: false, current: hours.first, hours: hours, quarterHours: [], days: [])
        }
        let fresh = forecast(at: now.addingTimeInterval(-60))
        var old = NearcastWidgetSnapshot.fallback
        old.weatherSavedAt = now.addingTimeInterval(-120).timeIntervalSince1970
        old.temperature = 75; old.isAvailable = true
        old.planId = "legacy"; old.planTitle = "Old plan"; old.planAvailable = true
        old.watchStatus = "Watching"; old.watchDetail = "Old delivery state"; old.watchTone = "watch"
        func content(items: [NativeAgendaItem]? = [item], weather: NativeWeatherForecast? = nil,
                     place: NativePreviewPlace? = nil, essentials: NativeWeatherEssentials? = nil,
                     base: NearcastWidgetSnapshot? = nil) -> NearcastWidgetSnapshot {
            NativeCompanionContent.applying(to: base ?? old, items: items, forecast: weather ?? fresh,
                previewPlace: place ?? preview, essentials: essentials, now: now)
        }
        let native = content()
        expect(native.planId == "native-one" && native.planTitle == "Soccer", "native schedule replaces legacy plan identity and title")
        expect(native.planDetail == "Storms could affect this plan" && native.planRisk == "storm", "deterministic native forecast evidence supplies plan detail")
        expect(native.planStartAt == window.startsAt.timeIntervalSince1970 && native.planEndAt == window.endsAt.timeIntervalSince1970,
            "plan companion times retain the exact occurrence window")
        expect(native.watchStatus == nil && native.watchDetail == nil && native.watchTone == nil, "native display never inherits legacy watch or delivery claims")
        expect(native.weatherSavedAt == old.weatherSavedAt && native.temperature == old.temperature, "plan publication preserves existing weather and freshness")
        expect(native.planSavedAt == fresh.generatedAt.timeIntervalSince1970, "plan evidence uses forecast generation rather than publication time")
        let empty = content(items: [])
        expect(empty.planId == nil && empty.planAvailable == false && empty.planRisk == nil, "deleting the last native plan clears all companion plan content")
        expect(content(items: nil).planId == nil, "unverified native library never resurrects legacy plan content")
        let remote = NativePreviewPlace(id: "away", name: "Away", latitude: 40, longitude: -80, timezone: "UTC")
        let remoteContent = content(place: remote)
        expect(remoteContent.planId == item.planID && remoteContent.planRisk == nil && remoteContent.planSavedAt == 0,
            "a remote plan keeps its schedule without borrowing selected-place weather")
        let stale = content(weather: forecast(at: now.addingTimeInterval(-7 * 3600)))
        expect(stale.planDetail?.contains("Saved forecast") == true && stale.planRisk == nil, "stale plan evidence is labeled and never carries a current risk verdict")
        let partial = NativeWeatherForecast(generatedAt: now, timezoneID: "UTC", metric: false, current: nil, hours: [hours[0]], quarterHours: [], days: [])
        expect(content(weather: partial).planDetail?.contains("Only part") == true, "partial coverage is not a complete-window verdict")

        func alert(start: Date? = nil, expires: Date? = nil) -> NativeOfficialAlert {
            NativeOfficialAlert(id: "nws-one", event: "Severe Thunderstorm Warning", headline: "Take shelter now", description: "", instruction: "Shelter",
                areaDescription: "Home", severity: "Severe", urgency: "Immediate", sent: now.addingTimeInterval(-120),
                startAt: start ?? now.addingTimeInterval(-600), endAt: now.addingTimeInterval(3600), eventEndsAt: now.addingTimeInterval(3600),
                expiresAt: expires ?? now.addingTimeInterval(600), sourceURL: URL(string: "https://www.weather.gov/"))
        }
        func essentials(status: NativeEssentialsStatus = .ready, alerts: [NativeOfficialAlert] = [], checked: Date? = nil,
                        latitude: Double = 38) -> NativeWeatherEssentials {
            NativeWeatherEssentials(latitude: latitude, longitude: -90,
                airQuality: .init(status: .unavailable, checkedAt: nil, snapshot: nil, message: nil),
                alerts: .init(status: status, checkedAt: checked ?? now, alerts: alerts, message: nil))
        }
        let activeEssentials = essentials(alerts: [alert()])
        let warning = content(essentials: activeEssentials)
        expect(warning.alertId == "nws-one" && warning.alertSource == "National Weather Service", "native current official alerts reach companion metadata")
        expect(warning.alertExpiresAt == now.addingTimeInterval(600).timeIntervalSince1970, "alert display expires at product expiry even when hazard ends later")
        expect(warning.alertSavedAt == now.timeIntervalSince1970 && warning.alertStateReady == true, "alert metadata preserves the successful source check")
        expect(content(essentials: essentials(), base: warning).alertId == nil, "verified empty current response clears a previous alert")
        expect(content(essentials: essentials(status: .unavailable), base: warning).alertId == "nws-one", "failed alert refresh does not invent all-clear")
        expect(content(essentials: essentials(alerts: [alert()], checked: now.addingTimeInterval(-600))).alertId == nil,
            "stale alert source is not promoted as new current metadata")
        expect(content(essentials: essentials(alerts: [alert(start: now.addingTimeInterval(300))])).alertId == nil,
            "future official alerts do not become a current-place banner")
        expect(content(essentials: essentials(alerts: [alert()], latitude: 39)).alertId == nil, "other-place alerts cannot enter current companion metadata")

        let candidate = NativeLiveActivityCandidate.make(forecast: fresh, essentials: activeEssentials, place: preview, isOwnedPlace: true, now: now)!
        expect(candidate.payload["nativeEvidence"] as? Bool == true && candidate.payload["geometryQuality"] as? String == "official-alert",
            "official alert Live Activity declares non-arrival native evidence")
        expect(candidate.payload["arrivalAtEpoch"] == nil && candidate.payload["motionDegrees"] == nil && candidate.payload["confidenceValue"] == nil,
            "native Live Activity never invents arrival, trajectory or numeric confidence")
        expect(candidate.payload["evidenceUpdatedAtEpoch"] as? Double == now.timeIntervalSince1970, "Live Activity source timestamp is not button time")
        expect(NativeLiveActivityCandidate.make(forecast: fresh, essentials: activeEssentials, place: preview, isOwnedPlace: false, now: now) == nil,
            "temporary unowned preview cannot start a Live Activity")
        let thunder = NativeLiveActivityCandidate.make(forecast: fresh, essentials: nil, place: preview, isOwnedPlace: true, now: now)
        expect(thunder?.payload["geometryQuality"] as? String == "hourly-forecast", "near-term native thunder supports an explicitly hourly notice")
        expect(NativeLiveActivityCandidate.make(forecast: forecast(at: now.addingTimeInterval(-3601)), essentials: nil,
            place: preview, isOwnedPlace: true, now: now) == nil, "outdated thunder forecast cannot start a Live Activity")
        expect(NativeLiveActivityCandidate.make(forecast: nil, essentials: essentials(status: .stale, alerts: [alert()]),
            place: preview, isOwnedPlace: true, now: now) == nil, "retained unverified alert cannot start a Live Activity")
        expect(NativeLiveActivityCandidate.make(forecast: nil, essentials: essentials(alerts: [alert(start: now.addingTimeInterval(300))]),
            place: preview, isOwnedPlace: true, now: now) == nil, "future official alert cannot start a current-alert Live Activity")

        let selected = NativeManagedPlace(id: "home", name: "Home", admin1: "", country: "US", countryCode: "US",
            latitude: 38, longitude: -90, alias: nil, timezone: "UTC", followsCurrentLocation: false)
        let source = NativePlacesSource(capturedAt: ISO8601DateFormatter().string(from: now), selectedPlace: selected, lastPlace: selected,
            savedPlaces: [selected], preferences: .init(unit: "fahrenheit", timeFormat: "12", theme: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false))
        let memory = Memory()
        expect(!memory.publisher.publishNativeContent(items: [item], forecast: fresh, previewPlace: remote, essentials: nil, source: source, revision: 1, now: now),
            "publication rejects a temporary/unselected preview before writing")
        expect(memory.writes == 0, "rejected temporary content performs no companion writes")
        expect(memory.publisher.publishNativeWeather(forecast: fresh, previewPlace: preview, source: source, revision: 1, now: now), "native weather establishes authoritative selected-place publication")
        expect(memory.publisher.publishNativeContent(items: [item], forecast: fresh, previewPlace: preview, essentials: activeEssentials, source: source, revision: 1, now: now),
            "native plan and alert content publish together after weather")
        let count = memory.writes, generation = memory.publication?.snapshot.publicationGeneration
        expect(memory.publisher.publishNativeContent(items: [item], forecast: fresh, previewPlace: preview, essentials: activeEssentials, source: source, revision: 1, now: now),
            "duplicate native content stays accepted")
        expect(memory.writes == count && memory.publication?.snapshot.publicationGeneration == generation, "unchanged native content does not manufacture a generation")
        expect(!memory.publisher.acceptLegacySnapshot(snapshot: old, place: memory.publication?.place, ownerRevision: 1), "late legacy content cannot overwrite native plan and alert authority")
        memory.failWrites = true
        expect(!memory.publisher.publishNativeContent(items: [], forecast: fresh, previewPlace: preview, essentials: activeEssentials, source: source, revision: 1, now: now),
            "failed plan deletion publication is reported")
        memory.failWrites = false
        expect(memory.publisher.publishNativeContent(items: [], forecast: fresh, previewPlace: preview, essentials: activeEssentials, source: source, revision: 1, now: now),
            "failed companion content can be retried without a new forecast")
        expect(memory.publication?.snapshot.planId == nil && memory.publication?.snapshot.weatherSavedAt == fresh.generatedAt.timeIntervalSince1970,
            "deletion retry clears plan without disturbing forecast freshness")
    }
}
