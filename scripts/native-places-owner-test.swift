import Foundation
import CryptoKit
import Darwin

@main
@MainActor
struct NativePlacesOwnerTests {
    static let primaryName = "places-owner.v1.json"
    static let backupName = "places-owner.previous.json"
    static let sourceExportName = "places-owner.legacy-source.v1.json"

    static func expect(_ value: Bool, _ message: String) { precondition(value, message) }

    static func place(_ id: String = "4250542", numeric: Bool = true) -> NativeManagedPlace {
        NativeManagedPlace(id: id, legacyIDType: numeric ? "number" : nil, name: "Springfield",
            admin1: "Illinois", country: "United States", countryCode: "US", latitude: 39.7817,
            longitude: -89.6501, alias: "  Home 👨‍👩‍👧  ", timezone: "America/Chicago", followsCurrentLocation: nil)
    }

    static func source(_ places: [NativeManagedPlace]? = nil) -> NativePlacesSource {
        let saved = places ?? [place(), place("work", numeric: false)]
        return NativePlacesSource(capturedAt: "2026-09-18T16:00:00.001Z", selectedPlace: saved.first,
            lastPlace: saved.last, savedPlaces: saved,
            preferences: NativePlacesPreferences(unit: "fahrenheit", timeFormat: "auto", theme: "auto",
                reactiveSkyEnabled: true, reactiveSkyMotionAllowed: false))
    }

    static func command(_ action: String, _ source: NativePlacesSource) -> NativePlacesCommand {
        NativePlacesCommand(action: action, expectedSource: source)
    }

    static func bytes(_ directory: URL, _ name: String = primaryName) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(name))
    }

    static func object(_ directory: URL, _ name: String = primaryName) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: bytes(directory, name)) as! [String: Any]
    }

    static func write(_ object: [String: Any], _ directory: URL, _ name: String = primaryName) throws {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
            .write(to: directory.appendingPathComponent(name))
    }

    static func expectBlocked(_ directory: URL, _ label: String) async throws {
        expect(NativePlacesOwnerStore.readBootstrap(directory: directory) == .blocked, "Bootstrap must block: \(label)")
        let store = NativePlacesOwnerStore(directory: directory)
        do { _ = try await store.snapshot(); preconditionFailure("Read unexpectedly allowed: \(label)") }
        catch is NativePlacesOwnerError { }
        do { _ = try await store.activate(source: source()); preconditionFailure("Reimport unexpectedly allowed: \(label)") }
        catch is NativePlacesOwnerError { }
        let reply = await store.perform(command: NativePlacesCommand(action: "snapshot"))
        expect(!reply.ok && reply.source == nil, "Blocked storage cannot present an empty or stale source")
    }

    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("native-places-owner-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let directory = root.appendingPathComponent("roundtrip")
        let store = NativePlacesOwnerStore(directory: directory)
        expect(NativePlacesOwnerStore.readBootstrap(directory: directory) == .unmigrated, "Fresh install is explicitly unmigrated")
        expect(try await store.snapshot() == nil, "Absence is not an empty owner inventory")

        // A fresh native-only install can start a new owner from a place that
        // native search/current-location resolved. It must not manufacture an
        // owner from a preview cache or retain fake legacy-import evidence.
        let nativeBootstrapDirectory = root.appendingPathComponent("native-bootstrap")
        let nativeBootstrapStore = NativePlacesOwnerStore(directory: nativeBootstrapDirectory)
        let nativeStartingPlace = place("native-start", numeric: false)
        let nativePreferences = NativePlacesPreferences(unit: "fahrenheit", timeFormat: "auto", theme: "auto",
            reactiveSkyEnabled: false, reactiveSkyMotionAllowed: false)
        let nativeBootstrap = try await nativeBootstrapStore.bootstrapNative(place: nativeStartingPlace, preferences: nativePreferences)
        var expectedNativeSavedPlace = nativeStartingPlace
        expectedNativeSavedPlace.followsCurrentLocation = false
        expect(nativeBootstrap.revision == 1 && nativeBootstrap.source.owner == "native" &&
            nativeBootstrap.source.selectedPlace == nativeStartingPlace && nativeBootstrap.source.lastPlace == nativeStartingPlace,
            "Explicit native bootstrap commits the selected native place as a first owner generation")
        expect(nativeBootstrap.source.savedPlaces == [expectedNativeSavedPlace] && nativeBootstrap.source.preferences == nativePreferences,
            "Explicit native bootstrap saves exactly its chosen place and native defaults")
        expect(!FileManager.default.fileExists(atPath: nativeBootstrapDirectory.appendingPathComponent(sourceExportName).path),
            "Native bootstrap never fabricates legacy import evidence")
        expect(NativePlacesOwnerStore.readBootstrap(directory: nativeBootstrapDirectory) == .owned(nativeBootstrap),
            "Native bootstrap survives a fresh reader as a verified owner")
        let attemptedLegacyReplacement = try await nativeBootstrapStore.activate(source: source())
        expect(attemptedLegacyReplacement == nativeBootstrap,
            "A later legacy handover cannot replace an explicit native owner")

        var nativeRemove = command("remove", nativeBootstrap.source)
        nativeRemove.id = nativeStartingPlace.id
        let nativeRemoved = await nativeBootstrapStore.perform(command: nativeRemove)
        expect(nativeRemoved.ok, "Fresh native place removal succeeds")
        let nativeAfterRemoval = try await nativeBootstrapStore.snapshot()!
        expect(nativeAfterRemoval.source.savedPlaces.isEmpty && nativeAfterRemoval.pendingDeletions.isEmpty,
            "Fresh native removal does not create legacy notification work")
        expect(nativeAfterRemoval.source.selectedPlace == nativeStartingPlace,
            "Removing a bookmark does not discard the viewed forecast")

        // Exercise the same writer as the old queue-producing path, then
        // remove the test-only import evidence to model a pre-fix fresh profile.
        var nativeSave = command("save", nativeAfterRemoval.source)
        nativeSave.place = nativeStartingPlace
        let nativeSaved = await nativeBootstrapStore.perform(command: nativeSave)
        expect(nativeSaved.ok, "Re-save native test bookmark")
        let testExport = nativeBootstrapDirectory.appendingPathComponent(sourceExportName)
        try JSONEncoder().encode(source()).write(to: testExport)
        var priorRemove = command("remove", nativeSaved.source!)
        priorRemove.id = nativeStartingPlace.id
        let priorRemoved = await nativeBootstrapStore.perform(command: priorRemove)
        expect(priorRemoved.ok, "Prior queue-producing remove succeeds")
        try FileManager.default.removeItem(at: testExport)
        let reconciledNative = try await nativeBootstrapStore.snapshot()!
        expect(reconciledNative.pendingDeletions.isEmpty && reconciledNative.deletionWatermark == 1,
            "Pre-fix native-only cleanup queue is durably retired")
        expect(reconciledNative.source == priorRemoved.source,
            "Queue repair preserves user state and mutation receipts")
        expect(await nativeBootstrapStore.perform(command: priorRemove).ok,
            "An acknowledged native remove retry stays idempotent")

        var liveStartingPlace = place("native-live", numeric: false)
        liveStartingPlace.followsCurrentLocation = true
        let liveBootstrap = try await NativePlacesOwnerStore(directory: root.appendingPathComponent("native-live-bootstrap"))
            .bootstrapNative(place: liveStartingPlace, preferences: nativePreferences)
        expect(liveBootstrap.source.selectedPlace?.followsCurrentLocation == true &&
            liveBootstrap.source.lastPlace?.followsCurrentLocation == true &&
            liveBootstrap.source.savedPlaces.first?.followsCurrentLocation == false,
            "Native bootstrap preserves a live selected location but freezes the first saved place")

        let stagedImportDirectory = root.appendingPathComponent("staged-import-before-native-bootstrap")
        try FileManager.default.createDirectory(at: stagedImportDirectory, withIntermediateDirectories: true)
        try JSONEncoder().encode(source()).write(to: stagedImportDirectory.appendingPathComponent(sourceExportName))
        do {
            _ = try await NativePlacesOwnerStore(directory: stagedImportDirectory)
                .bootstrapNative(place: nativeStartingPlace, preferences: nativePreferences)
            preconditionFailure("Native bootstrap overwrote a staged verified legacy import")
        } catch NativePlacesOwnerError.busy { }
        expect(NativePlacesOwnerStore.readBootstrap(directory: stagedImportDirectory) == .unmigrated,
            "A staged legacy import stays unmigrated instead of becoming a mixed native owner")

        let legacy = source()
        let first = try await store.activate(source: legacy)
        expect(first.version == 1 && first.revision == 1 && first.source.owner == "native", "Activation commits native ownership")
        expect(first.source.savedPlaces == legacy.savedPlaces && first.source.selectedPlace == legacy.selectedPlace && first.source.lastPlace == legacy.lastPlace,
            "Migration preserves numeric IDs, exact aliases, metadata, order, selected and last")
        expect(first.source.preferences == legacy.preferences && first.pendingDeletions.isEmpty && first.deletionWatermark == 0,
            "Migration preserves all preferences with no invented deletion history")
        expect(first.source.captureDate! > legacy.captureDate!, "Native capture is strictly newer than import")
        let initialExport = try bytes(directory, sourceExportName)
        expect(try JSONDecoder().decode(NativePlacesSource.self, from: initialExport) == legacy,
            "Protected source export retains exact legacy capture, IDs, optional metadata and preferences")
        expect(Set(try object(directory, sourceExportName).keys) ==
            ["version", "owner", "hydration", "capturedAt", "selectedPlace", "lastPlace", "savedPlaces", "preferences"],
            "Recovery evidence contains only the allowlisted source export")
        let original = try bytes(directory)
        expect(try await store.activate(source: source([])) == first, "Repeat import never replaces the owner, even with empty legacy data")
        expect(try bytes(directory) == original, "Repeat import performs no owner rewrite")
        expect(try bytes(directory, sourceExportName) == initialExport, "Repeat import never replaces accepted source evidence")
        let restarted = NativePlacesOwnerStore(directory: directory)
        expect(try await restarted.snapshot() == first, "Restart reads canonical owner generation")
        expect(NativePlacesOwnerStore.readBootstrap(directory: directory) == .owned(first), "Document-start receives the verified owner snapshot")
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(primaryName).path)
        let exportURL = directory.appendingPathComponent(sourceExportName)
        let exportAttributes = try FileManager.default.attributesOfItem(atPath: exportURL.path)
        expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700, "Owner directory is private")
        expect((fileAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Owner generation is private")
        expect((exportAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Source export is private")
        #if os(macOS)
        // Foundation may report false inside the already-excluded temporary
        // directory; its persisted exclusion attribute still proves protection.
        expect(getxattr(exportURL.path, "com.apple.metadata:com_apple_backup_excludeItem", nil, 0, 0, 0) > 0,
            "Source export persists local backup-exclusion protection")
        #else
        expect(try exportURL.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true,
            "Source export remains local and excluded from device backup")
        #endif

        var rename = command("rename", first.source)
        rename.id = "4250542"
        rename.alias = " Our   home 👨‍👩‍👧 "
        let renamed = await store.perform(command: rename)
        expect(renamed.ok && renamed.source?.savedPlaces[0].alias == "Our home 👨‍👩‍👧", "Rename is committed and normalized")
        expect(renamed.source?.selectedPlace?.alias == "Our home 👨‍👩‍👧", "Selected matching numeric ID receives alias")
        expect(renamed.source?.lastPlace?.alias == legacy.lastPlace?.alias, "An unrelated last place is retained")
        expect(try await store.snapshot()?.revision == 2, "Edit advances revision")
        let renamedBytes = try bytes(directory)
        let replay = await restarted.perform(command: rename)
        let replayBytes = try bytes(directory)
        expect(replay == renamed && replayBytes == renamedBytes, "Restarted UUID replay returns same receipt without rewriting")
        var changedUUID = rename
        changedUUID.alias = "Different request"
        let collision = await store.perform(command: changedUUID)
        expect(!collision.ok && collision.code == "invalid", "UUID reused with altered payload is rejected")
        var stale = command("remove", first.source)
        stale.id = "4250542"
        let staleReply = await store.perform(command: stale)
        expect(!staleReply.ok && staleReply.code == "stale" && staleReply.source == renamed.source, "Full stale expectedSource is rejected with fresh source")
        var timestampOnly = rename
        timestampOnly.requestID = UUID().uuidString
        timestampOnly.expectedSource = renamed.source
        timestampOnly.expectedSource?.capturedAt = first.source.capturedAt
        expect(!(await store.perform(command: timestampOnly)).ok, "Capture mismatch alone rejects a competing writer")

        var select = command("select", renamed.source!)
        select.id = "work"
        let selected = await store.perform(command: select)
        expect(selected.ok && selected.source?.selectedPlace == legacy.savedPlaces[1] && selected.source?.lastPlace == legacy.savedPlaces[1],
            "Selection commits independently of forecast availability")
        let obsoleteReplay = await store.perform(command: rename)
        expect(!obsoleteReplay.ok && obsoleteReplay.code == "stale" && obsoleteReplay.source == selected.source,
            "An old successful receipt never reexecutes over a newer selection")

        var preferences = command("preferences", selected.source!)
        preferences.preferences = NativePlacesPreferencePatch(unit: "celsius", timeFormat: "24", theme: "dark",
            reactiveSkyEnabled: false, reactiveSkyMotionAllowed: true)
        let preferred = await store.perform(command: preferences)
        expect(preferred.ok && preferred.source?.preferences == NativePlacesPreferences(unit: "celsius", timeFormat: "24", theme: "dark",
            reactiveSkyEnabled: false, reactiveSkyMotionAllowed: true), "All five preferences mutate together")

        var move = command("move", preferred.source!)
        move.id = "4250542"; move.direction = 1
        let moved = await store.perform(command: move)
        expect(moved.ok && moved.source?.savedPlaces.map(\.id) == ["work", "4250542"], "Reorder changes only saved order")

        var remove = command("remove", moved.source!)
        remove.id = "4250542"
        let removed = await store.perform(command: remove)
        expect(removed.ok && removed.source?.savedPlaces.count == 1, "Removal is committed")
        let deletion = try await store.snapshot()!
        expect(deletion.pendingDeletions == [NativePlacesOwnerDeletion(sequence: 1, id: "4250542")], "Removal queues durable stop-watch event")
        var readd = command("save", deletion.source)
        readd.place = place()
        let readded = await store.perform(command: readd)
        expect(readded.ok && readded.source?.savedPlaces.first?.followsCurrentLocation == false, "Save freezes Current Location semantics")
        expect(try await restarted.snapshot()?.pendingDeletions == deletion.pendingDeletions, "Re-add does not erase unacknowledged deletion")
        var removeAgain = command("remove", readded.source!)
        removeAgain.id = "4250542"
        let removedAgain = await store.perform(command: removeAgain)
        expect(removedAgain.ok, "Re-added place can be deleted again")
        let twice = try await store.snapshot()!
        expect(twice.pendingDeletions.map(\.sequence) == [1, 2] && twice.pendingDeletions.map(\.id) == ["4250542", "4250542"],
            "Repeated ID deletion events remain ordered and distinct")
        let ack = try await restarted.ackDeletions(through: 1)
        expect(ack.deletionWatermark == 1 && ack.pendingDeletions == [NativePlacesOwnerDeletion(sequence: 2, id: "4250542")],
            "Stale ACK removes only its observed prefix and retains later event")
        expect(ack.revision == twice.revision + 1 && ack.source == twice.source,
            "ACK advances durable reconciliation revision without invalidating the user-data capture")
        expect(try await store.ackDeletions(through: 0) == ack, "Old ACK cannot move watermark backwards")
        let deletionReplayAfterACK = await store.perform(command: removeAgain)
        expect(deletionReplayAfterACK.ok && deletionReplayAfterACK == removedAgain,
            "Latest mutation receipt remains replayable after ACK without deleting again")
        expect(try await store.snapshot() == ack, "Replaying a deletion after ACK performs no write")
        do { _ = try await store.ackDeletions(through: 3); preconditionFailure("Future ACK accepted") }
        catch NativePlacesOwnerError.invalid { }
        let allAck = try await store.ackDeletions(through: 2)
        expect(allAck.pendingDeletions.isEmpty && allAck.deletionWatermark == 2, "Acknowledged events are durably retired")
        var nextSave = command("save", twice.source)
        nextSave.place = place()
        let savedAgain = await store.perform(command: nextSave)
        expect(savedAgain.ok, "A user edit based on pre-ACK canonical source remains fresh")
        var nextRemoval = command("remove", savedAgain.source!)
        nextRemoval.id = "4250542"
        _ = await store.perform(command: nextRemoval)
        expect(try await store.snapshot()?.pendingDeletions.first?.sequence == 3, "Deletion sequence never resets after ACK")

        // Separate actor instances must serialize the same expected generation.
        let raceSource = try await store.snapshot()!.source
        var raceA = command("rename", raceSource)
        raceA.id = "work"; raceA.alias = "Writer A"
        var raceB = command("rename", raceSource)
        raceB.id = "work"; raceB.alias = "Writer B"
        async let resultA = store.perform(command: raceA)
        async let resultB = restarted.perform(command: raceB)
        let race = await [resultA, resultB]
        expect(race.filter(\.ok).count == 1 && race.filter { $0.code == "stale" }.count == 1, "flock prevents multi-instance lost updates")
        expect(try bytes(directory, sourceExportName) == initialExport,
            "Source evidence survives all mutations, rotating backups, deletion ACKs and actor restarts unchanged")

        let overLimit = root.appendingPathComponent("imported-sixty")
        let sixty = NativePlacesOwnerStore(directory: overLimit)
        let imported = try await sixty.activate(source: source((0..<60).map { place("place-\($0)", numeric: false) }))
        expect(imported.source.savedPlaces.count == 60, "All historical imports up to sixty are preserved")
        var ninth = command("save", imported.source)
        ninth.place = place("new", numeric: false)
        let capped = await sixty.perform(command: ninth)
        expect(!capped.ok && capped.code == "limit" && capped.source?.savedPlaces.count == 60, "Add at/above eight never evicts imported records")
        var duplicate = command("save", imported.source)
        duplicate.place = imported.source.savedPlaces[0]
        expect((await sixty.perform(command: duplicate)).ok, "Saving an existing exact identity is safe at the cap")
        var wrongIdentity = command("save", try await sixty.snapshot()!.source)
        wrongIdentity.place = imported.source.savedPlaces[0]
        wrongIdentity.place?.latitude += 1
        expect((await sixty.perform(command: wrongIdentity)).code == "stale", "ID collision does not replace coordinates")

        let emptyDirectory = root.appendingPathComponent("empty")
        let emptyStore = NativePlacesOwnerStore(directory: emptyDirectory)
        let empty = try await emptyStore.activate(source: source([]))
        expect(empty.source.selectedPlace == nil && empty.source.lastPlace == nil && empty.source.savedPlaces.isEmpty,
            "Validated empty inventory migrates with explicit null selections")
        var invalidSource = source()
        invalidSource.savedPlaces[0].latitude = .nan
        do { _ = try await emptyStore.activate(source: invalidSource); preconditionFailure("Invalid import accepted") }
        catch NativePlacesOwnerError.invalid { }
        var invalid = command("select", empty.source)
        invalid.place = place(); invalid.id = "4250542"
        expect((await emptyStore.perform(command: invalid)).code == "invalid", "Ambiguous select is rejected")
        invalid = command("preferences", empty.source)
        invalid.preferences = NativePlacesPreferencePatch(unit: "kelvin")
        expect((await emptyStore.perform(command: invalid)).code == "invalid", "Invalid preference rejected")
        invalid = command("currentLocation", empty.source)
        expect((await emptyStore.perform(command: invalid)).code == "invalid", "Unresolved location cannot mutate the store")

        var currentPlace = place("device-location", numeric: false)
        currentPlace.followsCurrentLocation = true
        var chooseCurrent = command("select", empty.source); chooseCurrent.place = currentPlace
        let choseCurrent = await emptyStore.perform(command: chooseCurrent)
        expect(choseCurrent.ok && choseCurrent.source?.selectedPlace == currentPlace, "Resolved live location selection preserves provenance")
        var saveCurrent = command("save", choseCurrent.source!); saveCurrent.place = currentPlace
        let savedCurrent = await emptyStore.perform(command: saveCurrent)
        expect(savedCurrent.ok && savedCurrent.source?.savedPlaces[0].followsCurrentLocation == false &&
            savedCurrent.source?.selectedPlace?.followsCurrentLocation == true, "Save freezes a copy without changing live selected location")

        // Export staging is a prerequisite, not an ownership marker. Failed
        // preparation leaves legacy authoritative and may be safely retried
        // with a fresh complete export, including intervening legacy changes.
        for stage in [NativePlacesOwnerStore.WriteStage.afterSourceExportStaged, .afterSourceExportReplace, .afterSourceExportReadback] {
            let target = root.appendingPathComponent("source-export-\(stage)")
            let failing = NativePlacesOwnerStore(directory: target) { current in
                if current == stage { throw NativePlacesOwnerError.storage }
            }
            do { _ = try await failing.activate(source: legacy); preconditionFailure("Source export injection did not fail") }
            catch NativePlacesOwnerError.storage { }
            expect(NativePlacesOwnerStore.readBootstrap(directory: target) == .unmigrated,
                "Failed export preparation never establishes or substitutes for an owner")
            expect(!FileManager.default.fileExists(atPath: target.appendingPathComponent(primaryName).path),
                "Ownership is not committed before source export readback succeeds")
            if stage == .afterSourceExportStaged {
                expect(!FileManager.default.fileExists(atPath: target.appendingPathComponent(sourceExportName).path),
                    "An interrupted export staging write is not published")
            } else {
                expect(try JSONDecoder().decode(NativePlacesSource.self, from: bytes(target, sourceExportName)) == legacy,
                    "Failed activation retains the complete staged legacy evidence")
            }
            var refreshedLegacy = legacy
            refreshedLegacy.capturedAt = "2026-09-18T16:00:01.002Z"
            refreshedLegacy.savedPlaces[0].alias = "Updated before retry"
            let retryStore = NativePlacesOwnerStore(directory: target)
            let retried = try await retryStore.activate(source: refreshedLegacy)
            expect(retried.revision == 1 && retried.source.savedPlaces == refreshedLegacy.savedPlaces,
                "Failed activation can retry against the latest exact validated legacy source")
            let retained = try bytes(target, sourceExportName)
            expect(try JSONDecoder().decode(NativePlacesSource.self, from: retained) == refreshedLegacy,
                "The successful cutover retains its actual source, not an earlier failed attempt")
            var edit = command("remove", retried.source); edit.id = "4250542"
            expect((await retryStore.perform(command: edit)).ok, "Retried owner accepts normal mutations")
            _ = try await NativePlacesOwnerStore(directory: target).activate(source: legacy)
            expect(try bytes(target, sourceExportName) == retained, "Post-cutover retry and mutation preserve initial accepted evidence")
        }
        let exportReadbackFailure = root.appendingPathComponent("source-export-readback-failure")
        let corruptExportURL = exportReadbackFailure.appendingPathComponent(sourceExportName)
        let corruptingExport = NativePlacesOwnerStore(directory: exportReadbackFailure) { stage in
            if stage == .afterSourceExportReplace {
                try Data("{broken".utf8).write(to: corruptExportURL)
            }
        }
        do { _ = try await corruptingExport.activate(source: legacy); preconditionFailure("Corrupt source export readback accepted") }
        catch NativePlacesOwnerError.storage { }
        expect(NativePlacesOwnerStore.readBootstrap(directory: exportReadbackFailure) == .unmigrated &&
            !FileManager.default.fileExists(atPath: exportReadbackFailure.appendingPathComponent(primaryName).path),
            "A corrupt export readback prevents the ownership commit")
        let repairedExport = try await NativePlacesOwnerStore(directory: exportReadbackFailure).activate(source: legacy)
        let repairedSource = try JSONDecoder().decode(NativePlacesSource.self, from: bytes(exportReadbackFailure, sourceExportName))
        expect(repairedExport.revision == 1 && repairedSource == legacy,
            "A fresh validated activation can replace a failed preparatory export")

        // All pre-replacement failures retain the complete old generation.
        for stage in [NativePlacesOwnerStore.WriteStage.afterBackupWrite, .afterPrimaryStaged, .beforePrimaryReplace] {
            let target = root.appendingPathComponent("pre-\(stage)")
            let baseline = NativePlacesOwnerStore(directory: target)
            let old = try await baseline.activate(source: source())
            let oldBytes = try bytes(target)
            let failing = NativePlacesOwnerStore(directory: target) { current in
                if current == stage { throw NativePlacesOwnerError.storage }
            }
            var edit = command("remove", old.source); edit.id = "4250542"
            let failed = await failing.perform(command: edit)
            let interruptedBytes = try bytes(target)
            expect(!failed.ok && failed.source == old.source && interruptedBytes == oldBytes, "Pre-commit interruption retains old state: \(stage)")
            try Data("incomplete orphan".utf8).write(to: target.appendingPathComponent(".pending-owner-orphan"))
            expect(NativePlacesOwnerStore.readBootstrap(directory: target) == .owned(old), "Orphan staged bytes are not state")
            let retry = await baseline.perform(command: edit)
            let retriedSnapshot = try await baseline.snapshot()
            expect(retry.ok && retriedSnapshot?.revision == old.revision + 1, "Retry commits exactly once after interrupted staging")
        }
        for stage in [NativePlacesOwnerStore.WriteStage.afterPrimaryReplace, .afterPrimaryReadback] {
            let target = root.appendingPathComponent("post-\(stage)")
            let baseline = NativePlacesOwnerStore(directory: target)
            let old = try await baseline.activate(source: source())
            let failing = NativePlacesOwnerStore(directory: target) { current in
                if current == stage { throw NativePlacesOwnerError.storage }
            }
            var edit = command("remove", old.source); edit.id = "4250542"
            let uncertain = await failing.perform(command: edit)
            expect(!uncertain.ok && uncertain.source?.savedPlaces.count == 1, "Uncertain post-commit reply reads back committed owner")
            let retry = await baseline.perform(command: edit)
            let retriedSnapshot = try await baseline.snapshot()
            expect(retry.ok && retriedSnapshot?.revision == old.revision + 1, "Uncertain retry uses durable receipt, never deletes twice")
        }
        let firstFailure = root.appendingPathComponent("first-staged-failure")
        let firstFailing = NativePlacesOwnerStore(directory: firstFailure) { stage in
            if stage == .beforePrimaryReplace { throw NativePlacesOwnerError.storage }
        }
        do { _ = try await firstFailing.activate(source: source()); preconditionFailure("Activation injection did not fail") }
        catch NativePlacesOwnerError.storage { }
        expect(NativePlacesOwnerStore.readBootstrap(directory: firstFailure) == .unmigrated, "Before first atomic cutover there is no owner")
        expect(try JSONDecoder().decode(NativePlacesSource.self, from: bytes(firstFailure, sourceExportName)) == source(),
            "Failure after export verification retains recovery evidence without claiming ownership")
        let firstUncertain = root.appendingPathComponent("first-replaced-failure")
        let uncertainActivation = NativePlacesOwnerStore(directory: firstUncertain) { stage in
            if stage == .afterPrimaryReplace { throw NativePlacesOwnerError.storage }
        }
        do { _ = try await uncertainActivation.activate(source: source()); preconditionFailure("Activation post-commit injection did not fail") }
        catch NativePlacesOwnerError.storage { }
        if case .owned = NativePlacesOwnerStore.readBootstrap(directory: firstUncertain) {} else { preconditionFailure("Atomic cutover was lost") }
        expect(FileManager.default.fileExists(atPath: firstUncertain.appendingPathComponent("ownership-activated.v1").path),
            "Restart completes a missing activation barrier before returning owner")
        try FileManager.default.removeItem(at: firstUncertain.appendingPathComponent(primaryName))
        try await expectBlocked(firstUncertain, "missing initial owner after interrupted activation")

        // Corrupt current data must not resurrect the previous saved-place list.
        let corruption = root.appendingPathComponent("corruption")
        let corruptStore = NativePlacesOwnerStore(directory: corruption)
        let prior = try await corruptStore.activate(source: source())
        var deletionCommand = command("remove", prior.source); deletionCommand.id = "4250542"
        _ = await corruptStore.perform(command: deletionCommand)
        let backup = try bytes(corruption, backupName)
        let retainedCorruptionExport = try bytes(corruption, sourceExportName)
        expect(!backup.isEmpty, "Previous generation exists for explicit recovery only")
        try Data("{broken".utf8).write(to: corruption.appendingPathComponent(primaryName))
        try await expectBlocked(corruption, "corrupt current with valid backup")
        expect(try bytes(corruption, backupName) == backup, "Failed reads preserve explicit recovery backup")
        try FileManager.default.removeItem(at: corruption.appendingPathComponent(primaryName))
        try await expectBlocked(corruption, "missing current with valid backup")
        expect(try bytes(corruption, sourceExportName) == retainedCorruptionExport,
            "Corrupt or missing current state never restores or rewrites the initial source export")

        for key in ["schemaVersion", "minReaderVersion", "minWriterVersion"] {
            let future = root.appendingPathComponent("future-\(key)")
            _ = try await NativePlacesOwnerStore(directory: future).activate(source: source())
            var value = try object(future); value[key] = 2
            try write(value, future)
            let before = try bytes(future)
            try await expectBlocked(future, "future \(key)")
            expect(try bytes(future) == before, "Future bytes never rewritten")
        }
        let futureBackup = root.appendingPathComponent("future-backup")
        _ = try await NativePlacesOwnerStore(directory: futureBackup).activate(source: source())
        var futureValue = try object(futureBackup); futureValue["minWriterVersion"] = 2
        try write(futureValue, futureBackup, backupName)
        try await expectBlocked(futureBackup, "future backup barrier despite valid current")

        let tamper = root.appendingPathComponent("tamper")
        _ = try await NativePlacesOwnerStore(directory: tamper).activate(source: source())
        var changed = try object(tamper)
        var changedSnapshot = changed["snapshot"] as! [String: Any]
        changedSnapshot["revision"] = 44; changed["snapshot"] = changedSnapshot
        try write(changed, tamper)
        try await expectBlocked(tamper, "integrity mismatch")
        let symlink = root.appendingPathComponent("symlink")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: directory)
        expect(NativePlacesOwnerStore.readBootstrap(directory: symlink) == .blocked, "Caller-controlled directory symlink is rejected")

        // Force receipt eviction. Old expectedSource still cannot become valid,
        // including when every accepted edit was a semantic no-op.
        let boundedDirectory = root.appendingPathComponent("bounded-receipts")
        let bounded = NativePlacesOwnerStore(directory: boundedDirectory)
        var current = try await bounded.activate(source: source()).source
        var oldest = command("rename", current); oldest.id = "4250542"; oldest.alias = "Home"
        let oldestReply = await bounded.perform(command: oldest)
        expect(oldestReply.ok, "First receipt committed")
        current = oldestReply.source!
        for _ in 0..<257 {
            var noop = command("rename", current); noop.id = "4250542"; noop.alias = "Home"
            let previousCapture = current.captureDate!
            let reply = await bounded.perform(command: noop)
            expect(reply.ok && reply.source!.captureDate! > previousCapture, "Even same-millisecond no-op commits advance capture strictly")
            current = reply.source!
        }
        let receiptEnvelope = try object(boundedDirectory)
        expect((receiptEnvelope["receipts"] as! [Any]).count == 256, "Persistent receipt history remains bounded")
        let evicted = await NativePlacesOwnerStore(directory: boundedDirectory).perform(command: oldest)
        expect(!evicted.ok && evicted.code == "stale" && evicted.source == current, "Evicted retry after restart cannot reexecute")

        print("native places owner: protected source export, cutover, restart, all edits, deletion ACK, stale/replay, concurrency, atomic failures, corruption and version barriers passed")
    }
}
