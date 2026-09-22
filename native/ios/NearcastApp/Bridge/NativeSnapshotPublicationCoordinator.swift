import Foundation
#if canImport(UIKit) && canImport(WidgetKit)
import WidgetKit
#endif

/// The only phone publisher. Native storage owns selection/preferences after
/// handover; legacy contributes weather and plan content only for the exact
/// acknowledged owner revision. A forecast failure never changes ownership.
@MainActor
final class NativeSnapshotPublicationCoordinator {
    static let shared = NativeSnapshotPublicationCoordinator()

    typealias ReadPublication = @MainActor () -> NearcastWidgetSnapshotStore.Publication?
    typealias WritePublication = @MainActor (NearcastWidgetSnapshot, NearcastWidgetPlace?) -> Bool
    /// Re-delivery is deliberately separate from persistence. A newly
    /// installed Watch can need the already-committed phone receipt even when
    /// the forecast itself has not changed since the app last ran.
    typealias ReplayPublication = @MainActor (NearcastWidgetSnapshotStore.Publication) -> Bool

    private let readPublication: ReadPublication
    private let writePublication: WritePublication
    private let replayPublication: ReplayPublication
    private var source: NativePlacesSource?
    private var revision: Int?
    private var lastReplaySignature: String?
    private var nativeContentAuthoritative = false

    init(readPublication: @escaping ReadPublication = {
        NearcastWidgetSnapshotStore.storedPublication()
    }, writePublication: @escaping WritePublication = NativeSnapshotPublicationCoordinator.writeToCompanions,
       replayPublication: @escaping ReplayPublication = NativeSnapshotPublicationCoordinator.replayToCompanions) {
        self.readPublication = readPublication
        self.writePublication = writePublication
        self.replayPublication = replayPublication
        // A cold host must reject old legacy publications even before its
        // authoritative owner store finishes loading.
        self.revision = readPublication()?.snapshot.ownerRevision
    }

    @discardableResult
    func activateOwner(source: NativePlacesSource, revision: Int) -> Bool {
        publishNative(source: source, revision: revision)
    }

    /// Places/settings are usable with no loaded WebView. If compatible weather
    /// is absent, publish an unavailable state; the existing extension refresh
    /// may fetch real weather. This API deliberately does not accept an unbound
    /// NativeWeatherForecast, whose type has no coordinate provenance.
    @discardableResult
    func publishNative(source: NativePlacesSource, revision: Int) -> Bool {
        guard revision > 0, source.hydration == "ready", source.preferences.isValid,
              source.selectedPlace?.isValid ?? true,
              self.revision.map({ revision >= $0 }) ?? true else { return false }
        if revision == self.revision, let previousSource = self.source, previousSource != source { return false }

        let previous = readPublication()
        // The native record is already committed. Companion IO can fail, but
        // that must never leave an older legacy revision authorized to publish.
        // A retry with this same source/revision remains safe and supported.
        self.source = source
        self.revision = revision
        let selected = source.selectedPlace
        let clock = Self.uses24Hours(source.preferences.timeFormat)
        let unit = source.preferences.unit == "celsius" ? "km/h" : "mph"
        let matches = Self.matches(previous?.place, selected)
        let compatible = matches && previous?.snapshot.windUnit == unit

        // Reopening the same owner does not create false freshness or discard
        // extension weather. It *does* replay the already-committed receipt
        // once for this process: a Watch app or widget can have been installed
        // after the phone last wrote its snapshot, and no new forecast is
        // required for that companion to catch up.
        if previous?.snapshot.ownerRevision == revision, compatible,
           previous?.snapshot.uses24HourClock == clock,
           previous?.snapshot.placeName == (selected?.displayName ?? "Nearcast"),
           let previous {
            replayCurrentPublication(previous)
            return true
        }

        var snapshot = compatible ? previous!.snapshot : .fallback
        if !compatible {
            snapshot.nativeWeatherInvalidation = true
            snapshot.isAvailable = false
            snapshot.weatherSavedAt = 0
            snapshot.condition = "Weather update needed"
            snapshot.nowValue = "Weather update needed"
            snapshot.nextValue = "Open Nearcast for weather"
            snapshot.laterValue = "Waiting for an updated forecast"
        }
        // Native places edits cannot vouch for a legacy plan contribution from
        // another owner generation. Re-publication never invents an empty plan
        // inventory: these are disposable companion display fields only.
        if previous?.snapshot.ownerRevision != revision { Self.clearPlanDisplay(&snapshot) }
        snapshot.ownerRevision = revision
        snapshot.placeName = selected?.displayName ?? "Nearcast"
        snapshot.placeTimezone = selected?.timezone ?? (compatible ? snapshot.placeTimezone : nil)
        snapshot.windUnit = unit
        snapshot.uses24HourClock = clock
        snapshot.refreshTimelineClockLabels()
        let place = selected.map(Self.widgetPlace)
        guard publish(snapshot, place: place) else { return false }
        return true
    }

    /// A verified native forecast is the authoritative weather refresh once
    /// native Places ownership is active. This keeps the phone widget and the
    /// Watch in step with the native screen instead of waiting for a WebView
    /// bridge that may not be running.
    @discardableResult
    func publishNativeWeather(
        forecast: NativeWeatherForecast,
        previewPlace: NativePreviewPlace,
        source: NativePlacesSource,
        revision: Int,
        now: Date = Date()
    ) -> Bool {
        guard revision > 0, source.hydration == "ready", source.preferences.isValid,
              let selected = source.selectedPlace,
              Self.matches(selected, previewPlace),
              forecast.metric == (source.preferences.unit == "celsius"),
              self.revision.map({ revision >= $0 }) ?? true,
              let current = forecast.current ?? forecast.hours.last(where: { $0.date <= now }),
              current.hasReadings else { return false }

        // Establish or verify the native owner before publishing weather. The
        // owner gate is what prevents a late legacy response from overwriting
        // this exact place and its clock/unit preferences.
        guard publishNative(source: source, revision: revision) else { return false }

        let existing = readPublication()
        let owner = existing?.snapshot ?? .fallback
        // SwiftUI can deliver both the forecast-change observation and the
        // enclosing refresh task. One forecast receipt should produce one
        // companion generation, not two *writes*. A cold phone process still
        // replays the receipt once so a newly installed/reconnected Watch is
        // not left behind until weather changes again.
        if owner.ownerRevision == revision,
           owner.weatherSavedAt == forecast.generatedAt.timeIntervalSince1970,
           owner.nativeWeatherInvalidation == false,
           Self.matches(existing?.place, selected),
           let existing {
            replayCurrentPublication(existing)
            return true
        }
        var snapshot = owner.mergingWeather(from: Self.weatherSnapshot(
            forecast: forecast,
            selected: selected,
            current: current,
            uses24HourClock: Self.uses24Hours(source.preferences.timeFormat),
            now: now
        ))
        snapshot.version = max(9, snapshot.version)
        snapshot.ownerRevision = revision
        snapshot.placeName = selected.displayName
        snapshot.placeTimezone = selected.timezone ?? forecast.timezoneID
        snapshot.windUnit = source.preferences.unit == "celsius" ? "km/h" : "mph"
        snapshot.uses24HourClock = Self.uses24Hours(source.preferences.timeFormat)
        snapshot.nativeWeatherInvalidation = false
        snapshot.refreshTimelineClockLabels()
        return publish(snapshot, place: Self.widgetPlace(selected))
    }

    @discardableResult
    func acceptLegacySnapshot(snapshot: NearcastWidgetSnapshot, place: NearcastWidgetPlace?, ownerRevision: Int? = nil) -> Bool {
        guard !nativeContentAuthoritative else { return false }
        var accepted = snapshot
        var acceptedPlace = place
        if let revision {
            guard let source, let selected = source.selectedPlace,
                  (ownerRevision ?? snapshot.ownerRevision) == revision,
                  snapshot.ownerRevision == nil || snapshot.ownerRevision == revision,
                  Self.matches(place, selected),
                  snapshot.windUnit == (source.preferences.unit == "celsius" ? "km/h" : "mph"),
                  snapshot.uses24HourClock == Self.uses24Hours(source.preferences.timeFormat) else { return false }
            accepted.ownerRevision = revision
            accepted.placeName = selected.displayName
            acceptedPlace = Self.widgetPlace(selected)
        } else {
            guard snapshot.ownerRevision == nil, ownerRevision == nil,
                  readPublication()?.snapshot.ownerRevision == nil else { return false }
        }
        accepted.nativeWeatherInvalidation = accepted.hasWeatherData ? false : accepted.nativeWeatherInvalidation
        return publish(accepted, place: acceptedPlace)
    }

    /// Native plan edits and alert completions are independent of forecast
    /// refreshes. Never skip them just because weather's generation is equal.
    /// `nil` items means the native library could not be verified, not empty.
    @discardableResult
    func publishNativeContent(items: [NativeAgendaItem]?, forecast: NativeWeatherForecast?,
                              previewPlace: NativePreviewPlace, essentials: NativeWeatherEssentials?,
                              source: NativePlacesSource, revision: Int, now: Date = Date()) -> Bool {
        guard let selected = source.selectedPlace, Self.matches(selected, previewPlace),
              forecast.map({ $0.metric == (source.preferences.unit == "celsius") }) ?? true,
              publishNative(source: source, revision: revision),
              let existing = readPublication(), existing.snapshot.ownerRevision == revision,
              Self.matches(existing.place, selected) else { return false }
        nativeContentAuthoritative = true
        let next = NativeCompanionContent.applying(to: existing.snapshot, items: items,
            forecast: forecast, previewPlace: previewPlace, essentials: essentials, now: now)
        // Avoid manufacturing freshness/generations during observation churn;
        // the content's own timestamps remain the source timestamps.
        if let oldData = try? JSONEncoder().encode(existing.snapshot),
           let newData = try? JSONEncoder().encode(next),
           let oldObject = try? JSONSerialization.jsonObject(with: oldData) as? NSDictionary,
           let newObject = try? JSONSerialization.jsonObject(with: newData) as? NSDictionary,
           oldObject == newObject {
            replayCurrentPublication(existing)
            return true
        }
        return publish(next, place: Self.widgetPlace(selected))
    }

    private func publish(_ snapshot: NearcastWidgetSnapshot, place: NearcastWidgetPlace?) -> Bool {
        let previousGeneration = readPublication()?.snapshot.publicationGeneration ?? 0
        guard previousGeneration >= 0, previousGeneration < Int.max else { return false }
        var next = snapshot.expiringCompanionContent(at: Date().timeIntervalSince1970)
        var nextPlace = place
        next.publicationGeneration = previousGeneration + 1
        nextPlace?.ownerRevision = next.ownerRevision
        nextPlace?.publicationGeneration = next.publicationGeneration
        guard writePublication(next, nextPlace) else { return false }
        // A successful normal publication already delivers to WidgetKit and
        // WatchConnectivity. Remember it here so the very next duplicate
        // SwiftUI observation cannot turn into a redundant re-delivery.
        lastReplaySignature = Self.replaySignature(snapshot: next, place: nextPlace)
        return true
    }

    /// Sends the durable, already-validated publication to system companions
    /// without changing ownership, weather freshness, or generation. Keep
    /// this bounded to one replay per publication state during a phone process
    /// so SwiftUI observation churn cannot turn into WidgetKit reload churn.
    private func replayCurrentPublication(_ publication: NearcastWidgetSnapshotStore.Publication) {
        guard publication.isCoherent else { return }
        let signature = Self.replaySignature(for: publication)
        guard signature != lastReplaySignature else { return }
        guard replayPublication(publication) else { return }
        lastReplaySignature = signature
    }

    private static func replaySignature(for publication: NearcastWidgetSnapshotStore.Publication) -> String {
        replaySignature(snapshot: publication.snapshot, place: publication.place)
    }

    private static func replaySignature(snapshot: NearcastWidgetSnapshot, place: NearcastWidgetPlace?) -> String {
        return [
            String(snapshot.ownerRevision ?? 0),
            String(snapshot.publicationGeneration ?? 0),
            String(snapshot.weatherSavedAt ?? 0),
            snapshot.nativeWeatherInvalidation == true ? "invalid" : "valid",
            place?.id ?? "",
            place.map { String(format: "%.5f,%.5f", $0.latitude, $0.longitude) } ?? ""
        ].joined(separator: "|")
    }

    private static func matches(_ place: NearcastWidgetPlace?, _ selected: NativeManagedPlace?) -> Bool {
        guard let selected else { return place == nil }
        guard let place else { return false }
        return place.id == selected.id && place.latitude == selected.latitude && place.longitude == selected.longitude
            && place.tracksCurrentLocation == (selected.followsCurrentLocation == true)
    }

    private static func matches(_ selected: NativeManagedPlace, _ preview: NativePreviewPlace) -> Bool {
        selected.id == preview.id && selected.latitude == preview.latitude && selected.longitude == preview.longitude
    }

    private static func weatherSnapshot(
        forecast: NativeWeatherForecast,
        selected: NativeManagedPlace,
        current: NativeForecastPoint,
        uses24HourClock: Bool,
        now: Date
    ) -> NearcastWidgetSnapshot {
        let day = forecast.day(containing: now)
        let future = forecast.hours.filter { $0.date > now }
        let next = future.first
        let later = future.dropFirst(2).first ?? future.last
        let unit = forecast.metric ? "km/h" : "mph"
        let displayTimezone = selected.timezone ?? forecast.timezoneID

        var snapshot = NearcastWidgetSnapshot.fallback
        snapshot.version = 9
        snapshot.savedAt = now.timeIntervalSince1970
        snapshot.weatherSavedAt = forecast.generatedAt.timeIntervalSince1970
        snapshot.weatherLocation = NearcastCompanionLocation(latitude: selected.latitude,
            longitude: selected.longitude, resolvedAt: forecast.generatedAt.timeIntervalSince1970)
        snapshot.placeName = selected.displayName
        snapshot.placeTimezone = displayTimezone
        snapshot.uses24HourClock = uses24HourClock
        snapshot.temperature = rounded(current.temperature)
        snapshot.feelsLike = rounded(current.apparentTemperature ?? current.temperature)
        snapshot.high = day?.high.map(rounded)
        snapshot.low = day?.low.map(rounded)
        snapshot.condition = current.conditionLabel
        snapshot.conditionCode = current.weatherCode ?? 0
        snapshot.isDay = current.isDay ?? true
        snapshot.rainChance = rounded(current.rainProbability)
        snapshot.forecastRainChance = current.rainProbability.map(rounded)
        snapshot.wind = rounded(current.windSpeed)
        snapshot.windUnit = unit
        snapshot.windDirection = current.windDirection.map(rounded)
        snapshot.uv = rounded(current.uvIndex)
        snapshot.nowLabel = "Now"
        snapshot.nowValue = current.conditionLabel
        snapshot.nextLabel = next.map { clock($0.date, forecast: forecast, uses24HourClock: uses24HourClock) } ?? "Next"
        snapshot.nextValue = next?.conditionLabel ?? "No later reading"
        snapshot.laterLabel = later.map { clock($0.date, forecast: forecast, uses24HourClock: uses24HourClock) } ?? "Later"
        snapshot.laterValue = later?.conditionLabel ?? "Forecast updating"
        snapshot.timeline = Array(future.prefix(12)).enumerated().map { index, point in
            NearcastWidgetHour(
                offsetHours: index + 1,
                timeLabel: clock(point.date, forecast: forecast, uses24HourClock: uses24HourClock),
                temperature: point.temperature.map(rounded),
                feelsLike: point.apparentTemperature.map(rounded),
                rainChance: point.rainProbability.map(rounded),
                wind: point.windSpeed.map(rounded),
                windGust: point.windGusts.map(rounded),
                windDirection: point.windDirection.map(rounded),
                uv: point.uvIndex.map(rounded),
                conditionCode: point.weatherCode,
                isDay: point.isDay,
                startsAt: point.date.timeIntervalSince1970,
                thunderPossible: point.thunderPossible
            )
        }
        snapshot.daily = Array(forecast.days.filter { $0.date >= forecast.calendar.startOfDay(for: now) }.prefix(10)).enumerated().map { index, value in
            NearcastWidgetDay(
                date: dayKey(value.date, forecast: forecast),
                label: index == 0 ? "Today" : (index == 1 ? "Tomorrow" : weekday(value.date, forecast: forecast)),
                high: rounded(value.high), low: rounded(value.low), rainChance: rounded(value.rainProbability),
                conditionCode: value.weatherCode ?? 0, thunderPossible: value.thunderPossible
            )
        }
        snapshot.sunriseAt = day?.sunrise?.timeIntervalSince1970
        snapshot.sunsetAt = day?.sunset?.timeIntervalSince1970
        snapshot.isAvailable = true
        snapshot.nativeWeatherInvalidation = false
        return snapshot
    }

    private static func rounded(_ value: Double?) -> Int {
        guard let value, value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    private static func clock(_ date: Date, forecast: NativeWeatherForecast, uses24HourClock: Bool) -> String {
        nearcastClockLabel(date, timeZone: forecast.timeZone, uses24HourClock: uses24HourClock, compact: true)
    }

    private static func dayKey(_ date: Date, forecast: NativeWeatherForecast) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = forecast.calendar
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func weekday(_ date: Date, forecast: NativeWeatherForecast) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.calendar = forecast.calendar
        formatter.timeZone = forecast.timeZone
        formatter.dateFormat = "EEE"
        return formatter.string(from: date)
    }

    private static func widgetPlace(_ selected: NativeManagedPlace) -> NearcastWidgetPlace {
        NearcastWidgetPlace(id: selected.id, name: selected.name, displayName: selected.displayName,
            admin1: selected.admin1, country: selected.country, countryCode: selected.countryCode,
            followsCurrentLocation: selected.followsCurrentLocation == true,
            latitude: selected.latitude, longitude: selected.longitude)
    }

    private static func uses24Hours(_ preference: String) -> Bool {
        if preference == "24" { return true }
        if preference == "12" { return false }
        return nearcastResolved24HourClock(nil)
    }

    private static func clearPlanDisplay(_ snapshot: inout NearcastWidgetSnapshot) {
        snapshot.planTitle = nil
        snapshot.planLabel = nil
        snapshot.planDetail = nil
        snapshot.planPlace = nil
        snapshot.planTone = nil
        snapshot.planSavedAt = nil
        snapshot.planId = nil
        snapshot.planAvailable = false
        snapshot.planRisk = nil
        snapshot.planStartAt = nil
        snapshot.planEndAt = nil
        snapshot.watchStatus = nil
        snapshot.watchDetail = nil
        snapshot.watchTone = nil
    }

    private static func writeToCompanions(_ snapshot: NearcastWidgetSnapshot, _ place: NearcastWidgetPlace?) -> Bool {
        guard NearcastWidgetSnapshotStore.savePublication(snapshot, place: place),
              let committed = NearcastWidgetSnapshotStore.storedPublication() else { return false }
        return replayToCompanions(committed)
    }

    /// A delivery replay is intentionally non-mutating. It lets WidgetKit and
    /// WatchConnectivity receive a committed state after an app restart,
    /// companion install, or delayed activation without manufacturing a newer
    /// weather timestamp or owner generation.
    private static func replayToCompanions(_ publication: NearcastWidgetSnapshotStore.Publication) -> Bool {
        guard publication.isCoherent,
              let data = try? JSONEncoder().encode(publication.snapshot) else { return false }
        #if canImport(UIKit) && canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: NearcastWidgetSnapshotStore.widgetKind)
        // A prior timeline can remain alive while WidgetKit coalesces a
        // kind-specific reload during a fresh app install/update. Reloading
        // the app's companion timelines makes the newly committed shared
        // receipt visible without relying on the next discretionary refresh.
        WidgetCenter.shared.reloadAllTimelines()
        NativeWatchSnapshotSync.shared.sendSnapshotData(data, placeData: publication.place.flatMap { try? JSONEncoder().encode($0) })
        #endif
        return true
    }
}
