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

    private let readPublication: ReadPublication
    private let writePublication: WritePublication
    private var source: NativePlacesSource?
    private var revision: Int?

    init(readPublication: @escaping ReadPublication = {
        NearcastWidgetSnapshotStore.storedPublication()
    }, writePublication: @escaping WritePublication = NativeSnapshotPublicationCoordinator.writeToCompanions) {
        self.readPublication = readPublication
        self.writePublication = writePublication
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

        // Reopening the same owner does not create false freshness, discard
        // extension weather, or generate redundant Watch transfers.
        if previous?.snapshot.ownerRevision == revision, compatible,
           previous?.snapshot.uses24HourClock == clock,
           previous?.snapshot.placeName == (selected?.displayName ?? "Nearcast") {
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

    @discardableResult
    func acceptLegacySnapshot(snapshot: NearcastWidgetSnapshot, place: NearcastWidgetPlace?, ownerRevision: Int? = nil) -> Bool {
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

    private func publish(_ snapshot: NearcastWidgetSnapshot, place: NearcastWidgetPlace?) -> Bool {
        let previousGeneration = readPublication()?.snapshot.publicationGeneration ?? 0
        guard previousGeneration >= 0, previousGeneration < Int.max else { return false }
        var next = snapshot.expiringCompanionContent(at: Date().timeIntervalSince1970)
        var nextPlace = place
        next.publicationGeneration = previousGeneration + 1
        nextPlace?.ownerRevision = next.ownerRevision
        nextPlace?.publicationGeneration = next.publicationGeneration
        return writePublication(next, nextPlace)
    }

    private static func matches(_ place: NearcastWidgetPlace?, _ selected: NativeManagedPlace?) -> Bool {
        guard let selected else { return place == nil }
        guard let place else { return false }
        return place.id == selected.id && place.latitude == selected.latitude && place.longitude == selected.longitude
            && place.tracksCurrentLocation == (selected.followsCurrentLocation == true)
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
              let committed = NearcastWidgetSnapshotStore.storedPublication(),
              let data = try? JSONEncoder().encode(committed.snapshot) else { return false }
        #if canImport(UIKit) && canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: NearcastWidgetSnapshotStore.widgetKind)
        NativeWatchSnapshotSync.shared.sendSnapshotData(data, placeData: committed.place.flatMap { try? JSONEncoder().encode($0) })
        #endif
        return true
    }
}
