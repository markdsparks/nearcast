import Foundation

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
    print("PASS \(message)")
}

@MainActor
private final class PublicationMemory {
    var value: NearcastWidgetSnapshotStore.Publication?
    var writes = 0
    var failWrites = false

    func coordinator() -> NativeSnapshotPublicationCoordinator {
        NativeSnapshotPublicationCoordinator(readPublication: { self.value }, writePublication: { snapshot, place in
            guard !self.failWrites, snapshot.canReplacePublication(self.value?.snapshot),
                  place == nil || (place?.ownerRevision == snapshot.ownerRevision &&
                    place?.publicationGeneration == snapshot.publicationGeneration) else { return false }
            self.value = .init(snapshot: snapshot, place: place)
            self.writes += 1
            return true
        })
    }
}

@main
struct NativeSnapshotPublicationTests {
    @MainActor static func main() throws {
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--try-stale-publication" {
            let store = NearcastWidgetPublicationFileStore(directory: URL(fileURLWithPath: CommandLine.arguments[2]))
            exit(store.commit(publication(generation: 1)) ? 1 : 0)
        }
        let selected = NativeManagedPlace(id: "maryville", name: "Maryville", admin1: "Illinois", country: "United States",
            countryCode: "US", latitude: 38.7237, longitude: -89.9559, alias: "Home", timezone: "America/Chicago", followsCurrentLocation: false)
        var source = NativePlacesSource(capturedAt: "2026-09-18T19:00:00.000Z", selectedPlace: selected, lastPlace: selected,
            savedPlaces: [selected], preferences: .init(unit: "fahrenheit", timeFormat: "12", theme: "auto", reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false))
        let place = NearcastWidgetPlace(id: selected.id, name: selected.name, displayName: selected.displayName,
            admin1: selected.admin1, country: selected.country, countryCode: selected.countryCode,
            followsCurrentLocation: false, latitude: selected.latitude, longitude: selected.longitude)
        var weather = NearcastWidgetSnapshot.fallback
        weather.placeName = "Home"
        weather.savedAt = Date().timeIntervalSince1970
        weather.weatherSavedAt = weather.savedAt
        weather.isAvailable = true
        weather.temperature = 74
        weather.uses24HourClock = false
        weather.planId = "private-plan"
        weather.planTitle = "Plan"
        weather.planAvailable = true
        weather.planSavedAt = weather.savedAt

        let memory = PublicationMemory()
        let coordinator = memory.coordinator()
        expect(coordinator.acceptLegacySnapshot(snapshot: weather, place: place), "legacy publications work before handover")
        expect(memory.value?.snapshot.publicationGeneration == 1, "one coordinator stamps the publication generation")
        expect(coordinator.activateOwner(source: source, revision: 1), "native handover publishes without a WebView")
        expect(memory.value?.snapshot.temperature == 74 && memory.value?.snapshot.hasWeatherData == true, "handover keeps compatible actual weather")
        expect(memory.value?.snapshot.planId == nil, "handover does not vouch for an unproven legacy plan contribution")
        expect(!coordinator.acceptLegacySnapshot(snapshot: weather, place: place), "native owner rejects unproven legacy snapshots")
        expect(coordinator.acceptLegacySnapshot(snapshot: weather, place: place, ownerRevision: 1), "exact acknowledged owner contribution is accepted")
        expect(memory.value?.snapshot.planId == "private-plan", "matching-generation plan metadata can be published")

        var wrongPlace = place
        wrongPlace.id = "other-id"
        expect(!coordinator.acceptLegacySnapshot(snapshot: weather, place: wrongPlace, ownerRevision: 1), "same coordinates do not substitute for exact selected identity")
        wrongPlace = place
        wrongPlace.followsCurrentLocation = true
        expect(!coordinator.acceptLegacySnapshot(snapshot: weather, place: wrongPlace, ownerRevision: 1), "fixed and current-location intent cannot be interchanged")

        source.preferences.unit = "celsius"
        source.preferences.timeFormat = "24"
        expect(coordinator.publishNative(source: source, revision: 2), "native preferences commit without legacy hydration")
        expect(memory.value?.snapshot.windUnit == "km/h" && memory.value?.snapshot.uses24HourClock == true, "publication carries the authoritative units and clock together")
        expect(memory.value?.snapshot.hasWeatherData == false && memory.value?.snapshot.weatherSavedAt == 0, "unit changes invalidate incompatible weather without inventing freshness")
        expect(memory.value?.snapshot.planId == nil, "unacknowledged plan content does not cross owner revisions")
        expect(!coordinator.acceptLegacySnapshot(snapshot: weather, place: place, ownerRevision: 1), "stale owner contributions are rejected")
        expect(!coordinator.acceptLegacySnapshot(snapshot: weather, place: place, ownerRevision: 2), "matching revision alone cannot relabel imperial values")
        weather.windUnit = "km/h"
        weather.uses24HourClock = true
        weather.temperature = 23
        expect(coordinator.acceptLegacySnapshot(snapshot: weather, place: place, ownerRevision: 2), "matching metric weather replaces the explicit unavailable state")
        expect(memory.value?.snapshot.nativeWeatherInvalidation == false, "real accepted weather clears the invalidation marker")

        let beforeReopen = memory.writes
        let reopened = memory.coordinator()
        expect(!reopened.acceptLegacySnapshot(snapshot: weather, place: place, ownerRevision: 2), "cold startup blocks publication until the native owner is loaded")
        expect(reopened.activateOwner(source: source, revision: 2), "cold owner hydration restores the publication gate")
        expect(memory.writes == beforeReopen, "same-revision reopen keeps extension weather and avoids redundant transfer")
        var nextSource = source
        nextSource.selectedPlace?.id = "new-selection"
        nextSource.selectedPlace?.alias = "Second place"
        expect(reopened.publishNative(source: nextSource, revision: 3), "a new native selection publishes one coherent pair")
        expect(memory.value?.place?.id == "new-selection" && memory.value?.snapshot.placeName == "Second place", "snapshot and place identify the same native selection")
        expect(memory.value?.snapshot.hasWeatherData == false, "same-coordinate different identity does not borrow weather")
        expect(memory.value?.place?.publicationGeneration == memory.value?.snapshot.publicationGeneration, "place and snapshot share a single publication generation")
        expect(!reopened.publishNative(source: source, revision: 2), "native publication cannot downgrade the owner revision")

        memory.failWrites = true
        nextSource.preferences.timeFormat = "12"
        expect(!reopened.publishNative(source: nextSource, revision: 4), "failed companion persistence does not report successful publication")
        memory.failWrites = false
        let priorPublication = memory.value!
        expect(!reopened.acceptLegacySnapshot(snapshot: priorPublication.snapshot, place: priorPublication.place, ownerRevision: 3),
            "a failed companion write never reauthorizes the previous legacy owner revision")
        expect(reopened.publishNative(source: nextSource, revision: 4), "failed publication can be retried from the authoritative native record")
        nextSource.selectedPlace = nil
        expect(reopened.publishNative(source: nextSource, revision: 5), "an explicitly empty selected place remains distinct from unknown hydration")
        expect(memory.value?.place == nil && memory.value?.snapshot.hasWeatherData == false, "clearing selection leaves no stale companion location")
        try fileStoreAndRefreshResults()
    }

    private static func publication(generation: Int) -> NearcastWidgetSnapshotStore.Publication {
        var snapshot = NearcastWidgetSnapshot.fallback
        snapshot.savedAt = 1_700_000_000
        snapshot.weatherSavedAt = 1_700_000_000
        snapshot.isAvailable = true
        snapshot.placeName = "Public test city"
        snapshot.temperature = 70
        snapshot.uses24HourClock = false
        snapshot.ownerRevision = 1
        snapshot.publicationGeneration = generation
        let place = NearcastWidgetPlace(id: "test-city", name: "Public test city", displayName: nil,
            admin1: nil, country: nil, countryCode: nil, followsCurrentLocation: false,
            latitude: 38, longitude: -90, ownerRevision: 1, publicationGeneration: generation)
        return .init(snapshot: snapshot, place: place)
    }

    private static func read(_ store: NearcastWidgetPublicationFileStore) -> NearcastWidgetSnapshotStore.Publication? {
        if case .valid(let value) = store.read() { return value }
        return nil
    }

    private static func fileStoreAndRefreshResults() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nearcast-publication-file-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NearcastWidgetPublicationFileStore(directory: directory)
        if case .missing = store.read() { } else { fatalError("Fresh file store is not missing") }
        let first = publication(generation: 1)
        expect(store.commit(first), "first coherent publication is committed to the atomic pair file")
        expect(read(store)?.snapshot.publicationGeneration == 1 && read(store)?.place == first.place,
            "authoritative file reads keep snapshot and selection together")

        let executable = CommandLine.arguments[0]
        let interleavedStore = NearcastWidgetPublicationFileStore(directory: directory, beforeReplace: {
            // This runs after generation validation and before replacement.
            // A separate process tries the formerly vulnerable stale write.
            let child = Process()
            child.executableURL = URL(fileURLWithPath: executable)
            child.arguments = ["--try-stale-publication", directory.path]
            do { try child.run() } catch { fatalError("Could not start isolated lock test") }
            child.waitUntilExit()
            expect(child.terminationReason == .exit && child.terminationStatus == 0,
                "a concurrent process cannot enter the compare/write window while publication lock is held")
        })
        let second = publication(generation: 2)
        expect(interleavedStore.commit(second), "current publication completes after rejecting the interleaved stale writer")
        expect(!store.commit(first), "stale generation is rejected against the uncached authoritative file")
        expect(read(store)?.snapshot.publicationGeneration == 2, "rejected stale commit does not revert the stored generation")

        var wrongSelection = second
        wrongSelection.place?.id = "other-place"
        expect(!store.commit(wrongSelection), "same-generation weather writes cannot change place identity")
        var wrongUnits = second
        wrongUnits.snapshot.windUnit = "km/h"
        expect(!store.commit(wrongUnits), "same-generation weather writes cannot change units")
        var wrongClock = second
        wrongClock.snapshot.uses24HourClock = true
        expect(!store.commit(wrongClock), "same-generation weather writes cannot change clock settings")
        var newerWeather = second
        newerWeather.snapshot.weatherSavedAt = 1_700_000_500
        newerWeather.snapshot.temperature = 80
        expect(store.commit(newerWeather), "an extension may refresh weather within the current phone generation")
        expect(store.commit(second), "older same-generation weather can be safely merged without rejecting unrelated alert work")
        expect(read(store)?.snapshot.temperature == 80, "same-generation merging preserves the freshest weather under the lock")
        var inheritedInvalidation = second
        inheritedInvalidation.snapshot.nativeWeatherInvalidation = true
        expect(store.commit(inheritedInvalidation), "actual refreshed weather clears an inherited unavailable marker before arbitration")
        expect(read(store)?.snapshot.temperature == 80 && read(store)?.snapshot.nativeWeatherInvalidation == false,
            "an inherited invalidation cannot bypass newer same-generation weather")

        let staleTimeline = NearcastWidgetSnapshotStore.saveRefreshResult(first.snapshot,
            commit: { _ in store.commit(first) }, current: { read(store)!.snapshot })
        expect(staleTimeline.publicationGeneration == 2 && staleTimeline.temperature == 80,
            "rejected extension commit returns current stored weather instead of its stale timeline candidate")
        let concurrentTimeline = NearcastWidgetSnapshotStore.saveRefreshResult(second.snapshot,
            commit: { _ in store.commit(publication(generation: 3)) }, current: { read(store)!.snapshot })
        expect(concurrentTimeline.publicationGeneration == 3,
            "refresh result rereads current publication even after successful persistence")

        var metadataEdit = publication(generation: 4)
        metadataEdit.snapshot.ownerRevision = 2
        metadataEdit.place?.ownerRevision = 2
        metadataEdit.snapshot.placeName = "Renamed home"
        metadataEdit.place?.displayName = "Renamed home"
        metadataEdit.snapshot.uses24HourClock = true
        expect(store.commit(metadataEdit), "new native metadata can commit after an extension forecast wins the race")
        let mergedMetadata = read(store)!
        expect(mergedMetadata.snapshot.temperature == 80 && mergedMetadata.snapshot.weatherSavedAt == 1_700_000_500,
            "native metadata publication preserves newer exact-place weather discovered under the lock")
        expect(mergedMetadata.snapshot.ownerRevision == 2 && mergedMetadata.snapshot.publicationGeneration == 4 &&
            mergedMetadata.snapshot.placeName == "Renamed home" && mergedMetadata.snapshot.uses24HourClock == true &&
            mergedMetadata.snapshot.planId == nil,
            "weather arbitration never replaces incoming owner, alias, clock or plan authority")
        var invalidation = mergedMetadata
        invalidation.snapshot.publicationGeneration = 5
        invalidation.place?.publicationGeneration = 5
        invalidation.snapshot.nativeWeatherInvalidation = true
        invalidation.snapshot.isAvailable = false
        invalidation.snapshot.weatherSavedAt = 0
        expect(store.commit(invalidation) && read(store)?.snapshot.hasWeatherData == false,
            "explicit native unavailable publication is not undone by same-place stored weather")

        let identityDirectory = directory.appendingPathComponent("identity-check", isDirectory: true)
        let identityStore = NearcastWidgetPublicationFileStore(directory: identityDirectory)
        expect(identityStore.commit(newerWeather), "identity arbitration fixture stores real newer weather")
        var otherIdentity = publication(generation: 3)
        otherIdentity.place?.id = "other-identity"
        expect(identityStore.commit(otherIdentity) && read(identityStore)?.snapshot.temperature == 70,
            "new publication does not borrow weather from another identity at the same coordinates")
        var otherUnits = publication(generation: 4)
        otherUnits.place?.id = "other-identity"
        otherUnits.snapshot.windUnit = "km/h"
        otherUnits.snapshot.temperature = 21
        expect(identityStore.commit(otherUnits) && read(identityStore)?.snapshot.temperature == 21,
            "cross-generation arbitration cannot carry temperatures across unit systems")

        let file = directory.appendingPathComponent(NearcastWidgetPublicationFileStore.fileName)
        let validData = try Data(contentsOf: file)
        var future = try JSONSerialization.jsonObject(with: validData) as! [String: Any]
        future["version"] = 2
        let futureData = try JSONSerialization.data(withJSONObject: future)
        try futureData.write(to: file, options: .atomic)
        if case .blocked = store.read() { } else { fatalError("Future schema was not blocked") }
        expect(!store.commit(publication(generation: 4), legacy: { .valid(first) }),
            "future authority cannot be replaced or downgraded through a legacy-defaults fallback")
        let futureReadback = try Data(contentsOf: file)
        expect(futureReadback == futureData, "rejected future-schema write preserves its original bytes")
        let corrupt = Data("{broken".utf8)
        try corrupt.write(to: file, options: .atomic)
        if case .blocked = store.read() { } else { fatalError("Corrupt authority was not blocked") }
        expect(!store.commit(publication(generation: 4), legacy: { .valid(first) }),
            "corrupt authoritative pair never falls back to stale defaults or silently overwrites itself")
        let corruptReadback = try Data(contentsOf: file)
        expect(corruptReadback == corrupt, "failed corrupt-store recovery leaves original evidence unchanged")

        let legacyDirectory = directory.appendingPathComponent("legacy-import", isDirectory: true)
        let legacyStore = NearcastWidgetPublicationFileStore(directory: legacyDirectory)
        let legacy = publication(generation: 5)
        expect(!legacyStore.commit(publication(generation: 4), legacy: { .valid(legacy) }),
            "first file commit respects newer existing compatibility metadata")
        expect(legacyStore.commit(publication(generation: 6), legacy: { .valid(legacy) }),
            "legacy defaults are imported only while the authoritative pair file is absent")
        expect(read(legacyStore)?.snapshot.publicationGeneration == 6, "migration to file authority keeps monotonic generation")
    }
}
