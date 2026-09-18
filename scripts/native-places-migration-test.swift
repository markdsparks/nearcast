import Foundation
import CryptoKit

@main
@MainActor
struct NativePlacesMigrationTests {
    static func expect(_ condition: Bool, _ message: String) {
        precondition(condition, message)
    }

    static let initialCapture = "2026-09-18T15:30:00.000Z"
    static let secondCapture = "2026-09-18T15:31:00.000Z"
    static let thirdCapture = "2026-09-18T15:32:00.000Z"
    static let primaryName = "places-rehearsal.v1.json"
    static let backupName = "places-rehearsal.previous.json"

    static func place(_ id: String = "custom:home", alias: String = "  My home  ") -> [String: Any] {
        ["id": id, "name": "Springfield", "admin1": "Illinois", "country": "United States",
         "countryCode": "US", "latitude": 39.7817, "longitude": -89.6501,
         "alias": alias, "timezone": "America/Chicago"]
    }

    static func source(_ places: [[String: Any]]? = nil, capturedAt: String = initialCapture) -> [String: Any] {
        let saved = places ?? [place(), place("custom:work", alias: "Work")]
        return ["version": 1, "owner": "legacy", "hydration": "ready", "capturedAt": capturedAt,
                "selectedPlace": saved.first ?? NSNull(), "lastPlace": saved.last ?? NSNull(), "savedPlaces": saved,
                "preferences": ["unit": "fahrenheit", "timeFormat": "auto", "theme": "auto",
                                "reactiveSkyEnabled": true, "reactiveSkyMotionAllowed": false]]
    }

    static func data(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func object(_ bytes: Data) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
    }

    static func read(_ directory: URL, _ name: String = primaryName) throws -> [String: Any] {
        try object(Data(contentsOf: directory.appendingPathComponent(name)))
    }

    static func write(_ value: [String: Any], to directory: URL, name: String = primaryName) throws {
        try data(value).write(to: directory.appendingPathComponent(name))
    }

    static func assertRejected(_ value: [String: Any], by store: NativePlacesMigrationStore, _ label: String,
                               expected: NativePlacesMigrationError? = nil) async throws {
        do {
            _ = try await store.rehearse(data(value))
            preconditionFailure("Accepted invalid export: \(label)")
        } catch let error as NativePlacesMigrationError {
            if let expected { expect(error == expected, "Unexpected error for \(label): \(error)") }
        }
    }

    static func assertStoreRejected(_ store: NativePlacesMigrationStore, expected: NativePlacesMigrationError) async throws {
        do {
            _ = try await store.status()
            preconditionFailure("Accepted invalid stored envelope")
        } catch let error as NativePlacesMigrationError { expect(error == expected, "Unexpected stored error: \(error)") }
    }

    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("native-places-migration-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let directory = root.appendingPathComponent("roundtrip", isDirectory: true)
        let store = NativePlacesMigrationStore(directory: directory)
        expect(try await store.status() == nil, "An absent inventory has no receipt")
        let initial = source()
        let first = try await store.rehearse(data(initial))
        expect(first.owner == "legacy" && first.revision == 1 && first.savedPlaceCount == 2 && !first.unchanged,
               "First rehearsal creates only a legacy-owned revision")
        expect(first.selectedPlaceCount == 1 && first.lastPlaceCount == 1 && first.tombstoneCount == 0,
               "Receipt exposes only aggregate counts")
        let primary = try Data(contentsOf: directory.appendingPathComponent(primaryName))
        let stored = try read(directory)
        let storedSource = stored["source"] as! [String: Any]
        let saved = storedSource["savedPlaces"] as! [[String: Any]]
        expect(saved.map { $0["id"] as! String } == ["custom:home", "custom:work"], "IDs/order are exact; matching coordinates do not deduplicate")
        expect(saved[0]["alias"] as? String == "  My home  ", "Aliases are not trimmed or rewritten")
        expect(saved[0]["followsCurrentLocation"] == nil, "Missing GPS provenance remains missing")
        expect((storedSource["preferences"] as! [String: Any])["timeFormat"] as? String == "auto", "Raw clock preference remains auto")
        expect(stored["schemaVersion"] as? Int == 1 && stored["minReaderVersion"] as? Int == 1 && stored["minWriterVersion"] as? Int == 1,
               "Envelope versions are explicit")
        let duplicate = try await store.rehearse(data(initial))
        expect(duplicate.unchanged && duplicate.revision == 1, "Identical reimport is idempotent")
        expect(try Data(contentsOf: directory.appendingPathComponent(primaryName)) == primary, "Exact duplicate avoids a rewrite")

        let timeOnly = try await store.rehearse(data(source(capturedAt: secondCapture)))
        expect(timeOnly.unchanged && timeOnly.revision == 1, "Capture-time-only change does not advance revision")
        let timeStored = try read(directory)
        expect((timeStored["source"] as! [String: Any])["capturedAt"] as? String == secondCapture, "Latest capture high-water persists")
        expect(timeStored["sourceDigest"] as? String == stored["sourceDigest"] as? String, "Capture time is not part of source digest")
        try await assertRejected(initial, by: store, "older identical capture", expected: .staleExport)
        let restarted = NativePlacesMigrationStore(directory: directory)
        try await assertRejected(initial, by: restarted, "older capture after restart", expected: .staleExport)

        var invalid = source(capturedAt: thirdCapture)
        invalid.removeValue(forKey: "preferences")
        try await assertRejected(invalid, by: store, "missing preferences")
        invalid = source(capturedAt: thirdCapture)
        invalid["hydration"] = "loading"
        try await assertRejected(invalid, by: store, "unfinished hydration", expected: .unsupportedExport)
        invalid["hydration"] = "ready"
        invalid["version"] = 2
        try await assertRejected(invalid, by: store, "future export", expected: .unsupportedExport)
        invalid["version"] = true
        try await assertRejected(invalid, by: store, "boolean version")
        invalid["version"] = 1
        invalid["owner"] = "native"
        try await assertRejected(invalid, by: store, "nonlegacy export", expected: .unsupportedExport)
        invalid = source(capturedAt: thirdCapture)
        invalid["privatePlan"] = ["notificationToken": "do-not-retain"]
        try await assertRejected(invalid, by: store, "unknown top-level private data")
        invalid = source(capturedAt: thirdCapture)
        var badPreferences = invalid["preferences"] as! [String: Any]
        for (key, badValue) in [("unit", "kelvin"), ("timeFormat", "true"), ("theme", "system")] {
            var preferences = badPreferences
            preferences[key] = badValue
            invalid["preferences"] = preferences
            try await assertRejected(invalid, by: store, "invalid \(key)")
        }
        badPreferences["reactiveSkyEnabled"] = 1
        invalid["preferences"] = badPreferences
        try await assertRejected(invalid, by: store, "numeric boolean")
        badPreferences["reactiveSkyEnabled"] = true
        badPreferences["notificationToken"] = "private"
        invalid["preferences"] = badPreferences
        try await assertRejected(invalid, by: store, "unknown nested preference")

        for (key, badValue): (String, Any) in [
            ("latitude", "39.7817"), ("latitude", true), ("latitude", 90.00001), ("longitude", -180.01),
            ("alias", String(repeating: "a", count: 37)), ("id", "  "), ("name", String(repeating: "x", count: 181)),
            ("countryCode", "us"), ("countryCode", NSNull()), ("timezone", "Not/A_Timezone"),
            ("followsCurrentLocation", NSNull()), ("followsCurrentLocation", "false"),
            ("plan", ["private": true]), ("legacyIDType", "string")
        ] {
            var badPlace = place()
            badPlace[key] = badValue
            try await assertRejected(source([badPlace], capturedAt: thirdCapture), by: store, "invalid place \(key)")
        }
        try await assertRejected(source([place(), place()], capturedAt: thirdCapture), by: store, "duplicate saved ID")
        try await assertRejected(source((0...60).map { place("id:\($0)") }, capturedAt: thirdCapture), by: store, "too many saved places")
        for timestamp in ["2026-09-18T15:32:00-05:00", "2026-09-18", "2026-02-30T15:32:00Z", "2026-09-18T15:60:00Z", "2026-09-18T24:00:00Z"] {
            try await assertRejected(source(capturedAt: timestamp), by: store, "invalid UTC capture")
        }
        do {
            _ = try await store.rehearse(Data(repeating: 32, count: 128 * 1_024 + 1))
            preconditionFailure("Oversized payload was accepted")
        } catch NativePlacesMigrationError.invalidExport { }
        do {
            _ = try await store.rehearse(Data("{\"version\":1,".utf8))
            preconditionFailure("Truncated JSON was accepted")
        } catch NativePlacesMigrationError.invalidExport { }
        expect(try await store.status()?.revision == 1, "Failed exports do not mark a newer receipt or change revision")

        var noGPS = place("custom:work", alias: "Work")
        noGPS["followsCurrentLocation"] = false
        let deletion = try await store.rehearse(data(source([noGPS], capturedAt: thirdCapture)))
        expect(deletion.revision == 2 && deletion.savedPlaceCount == 1 && deletion.tombstoneCount == 1, "Deletion records a local tombstone")
        var deletionEnvelope = try read(directory)
        let tombstone = (deletionEnvelope["tombstones"] as! [[String: Any]])[0]
        expect(tombstone["id"] as? String == "custom:home" && tombstone["revision"] as? Int == 2, "Tombstones preserve removed ID and revision locally")
        let deletionSource = deletionEnvelope["source"] as! [String: Any]
        expect((deletionSource["savedPlaces"] as! [[String: Any]])[0]["followsCurrentLocation"] as? Bool == false, "Explicit false is distinct from absence")
        let receipt = String(decoding: try JSONEncoder().encode(deletion), as: UTF8.self)
        for secret in ["custom:home", "custom:work", "Springfield", "39.7817", "sourceDigest", "capturedAt"] {
            expect(!receipt.contains(secret), "Receipt must not disclose \(secret)")
        }

        var numericPlace = place("4250542")
        numericPlace["legacyIDType"] = "number"
        let numeric = try await store.rehearse(data(source([numericPlace], capturedAt: thirdCapture)))
        expect(numeric.revision == 3, "Changed content with equal millisecond capture is accepted")
        let numericEnvelope = try read(directory)
        let numericSaved = (numericEnvelope["source"] as! [String: Any])["savedPlaces"] as! [[String: Any]]
        expect(numericSaved[0]["id"] as? String == "4250542" && numericSaved[0]["legacyIDType"] as? String == "number", "Original numeric ID kind roundtrips")
        for id in ["0", "-1", "0042", "42.0", "9007199254740992", "+42"] {
            var bad = numericPlace
            bad["id"] = id
            try await assertRejected(source([bad], capturedAt: thirdCapture), by: store, "noncanonical numeric ID")
        }
        var stringID = numericPlace
        stringID.removeValue(forKey: "legacyIDType")
        try await assertRejected(source([numericPlace, stringID], capturedAt: thirdCapture), by: store, "numeric/string ID collision")

        let readded = try await store.rehearse(data(source(capturedAt: thirdCapture)))
        expect(readded.revision == 4 && readded.tombstoneCount == 1, "Re-added IDs supersede their own tombstones; removed numeric ID remains")
        let readdMarkers = try read(directory)["tombstones"] as! [[String: Any]]
        expect(readdMarkers.map { $0["id"] as! String } == ["4250542"], "Tombstones use IDs, never coordinate identity")

        let emptyDirectory = root.appendingPathComponent("empty")
        let emptyStore = NativePlacesMigrationStore(directory: emptyDirectory)
        let empty = try await emptyStore.rehearse(data(source([])))
        expect(empty.revision == 1 && empty.savedPlaceCount == 0 && empty.selectedPlaceCount == 0 && empty.lastPlaceCount == 0,
               "Ready empty inventory and explicit nulls are valid")
        let emptySource = try read(emptyDirectory)["source"] as! [String: Any]
        expect(emptySource["selectedPlace"] is NSNull && emptySource["lastPlace"] is NSNull, "Explicit required nulls survive encoding")

        let emojiAlias = "Home 👨‍👩‍👧‍👦"
        _ = try await emptyStore.rehearse(data(source([place(alias: emojiAlias)], capturedAt: secondCapture)))
        let emojiSource = try read(emptyDirectory)["source"] as! [String: Any]
        expect((emojiSource["savedPlaces"] as! [[String: Any]])[0]["alias"] as? String == emojiAlias,
               "Unicode format characters in emoji aliases are preserved losslessly")

        // Stage failures never replace the committed generation; restart ignores orphan pending files.
        for stage in [NativePlacesMigrationStore.WriteStage.afterBackupWrite, .afterPrimaryStaged, .beforePrimaryReplace] {
            let interruptionDirectory = root.appendingPathComponent("interruption-\(String(describing: stage))")
            let baseline = NativePlacesMigrationStore(directory: interruptionDirectory)
            _ = try await baseline.rehearse(data(source()))
            let before = try Data(contentsOf: interruptionDirectory.appendingPathComponent(primaryName))
            let failing = NativePlacesMigrationStore(directory: interruptionDirectory) { current in
                if current == stage { throw NativePlacesMigrationError.storageUnavailable }
            }
            try await assertRejected(source([], capturedAt: secondCapture), by: failing, "injected interruption", expected: .storageUnavailable)
            expect(try Data(contentsOf: interruptionDirectory.appendingPathComponent(primaryName)) == before, "Failure leaves committed primary intact")
            try Data("incomplete staged data".utf8).write(to: interruptionDirectory.appendingPathComponent(".pending-crash-orphan"))
            let afterRestart = NativePlacesMigrationStore(directory: interruptionDirectory)
            expect(try await afterRestart.status()?.revision == 1, "Restart uses complete committed envelope only")
            let resumed = try await afterRestart.rehearse(data(source([], capturedAt: secondCapture)))
            expect(resumed.revision == 2, "Retry after interruption can commit exactly once")
        }

        let recoveryDirectory = root.appendingPathComponent("recovery")
        let recoveryStore = NativePlacesMigrationStore(directory: recoveryDirectory)
        _ = try await recoveryStore.rehearse(data(source()))
        _ = try await recoveryStore.rehearse(data(source([], capturedAt: secondCapture)))
        try Data("{broken".utf8).write(to: recoveryDirectory.appendingPathComponent(primaryName))
        let recovered = try await NativePlacesMigrationStore(directory: recoveryDirectory).status()
        expect(recovered?.revision == 1 && recovered?.recoveredFromBackup == true && recovered?.savedPlaceCount == 2,
               "Corrupt primary recovers validated prior generation with explicit recovery receipt")
        let repaired = try await recoveryStore.rehearse(data(source([], capturedAt: thirdCapture)))
        expect(repaired.revision == 2 && repaired.recoveredFromBackup, "New rehearsal replaces damaged primary using validated backup")
        expect(try await NativePlacesMigrationStore(directory: recoveryDirectory).status()?.recoveredFromBackup == false, "Repaired primary validates after restart")
        var tampered = try read(recoveryDirectory)
        tampered["revision"] = 99
        try write(tampered, to: recoveryDirectory)
        expect(try await recoveryStore.status()?.recoveredFromBackup == true, "Receipt checksum detects non-source metadata tampering")
        try Data("broken backup".utf8).write(to: recoveryDirectory.appendingPathComponent(backupName))
        let invalidPrimaryBytes = try Data(contentsOf: recoveryDirectory.appendingPathComponent(primaryName))
        try await assertStoreRejected(recoveryStore, expected: .invalidStore)
        try await assertRejected(source(capturedAt: thirdCapture), by: recoveryStore, "both generations invalid", expected: .invalidStore)
        expect(try Data(contentsOf: recoveryDirectory.appendingPathComponent(primaryName)) == invalidPrimaryBytes, "Invalid primary and backup are never silently overwritten")

        for field in ["schemaVersion", "minReaderVersion", "minWriterVersion", "owner"] {
            for target in [primaryName, backupName] {
                let futureDirectory = root.appendingPathComponent("future-\(field)-\(target)")
                let futureStore = NativePlacesMigrationStore(directory: futureDirectory)
                _ = try await futureStore.rehearse(data(source()))
                _ = try await futureStore.rehearse(data(source([], capturedAt: secondCapture)))
                var future = try read(futureDirectory, target)
                future[field] = field == "owner" ? "native" : 2
                try write(future, to: futureDirectory, name: target)
                let before = try Data(contentsOf: futureDirectory.appendingPathComponent(primaryName))
                try await assertStoreRejected(futureStore, expected: .unsupportedStoreVersion)
                try await assertRejected(source(capturedAt: thirdCapture), by: futureStore, "future envelope barrier", expected: .unsupportedStoreVersion)
                expect(try Data(contentsOf: futureDirectory.appendingPathComponent(primaryName)) == before, "Future-owned/versioned data is not overwritten")
            }
        }

        let cancellationDirectory = root.appendingPathComponent("cancelled")
        let cancelledStore = NativePlacesMigrationStore(directory: cancellationDirectory)
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await cancelledStore.rehearse(data(source()))
        }
        do { _ = try await task.value; preconditionFailure("Cancelled rehearsal committed") }
        catch is CancellationError { }
        expect(try await cancelledStore.status() == nil, "Cancelled export never creates a receipt")

        let directoryPermissions = try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as! NSNumber
        expect(directoryPermissions.intValue == 0o700, "Local rehearsal directory is owner-only")
        for filename in [primaryName, backupName, ".rehearsal.lock"] {
            let permissions = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(filename).path)[.posixPermissions] as! NSNumber
            expect(permissions.intValue == 0o600, "Local rehearsal files are owner-only")
        }
        let unsafeDirectory = root.appendingPathComponent("symlink")
        try FileManager.default.createSymbolicLink(at: unsafeDirectory, withDestinationURL: directory)
        try await assertStoreRejected(NativePlacesMigrationStore(directory: unsafeDirectory), expected: .storageUnavailable)

        // Validate canonical SHA-256 independently of the store's receipt implementation.
        deletionEnvelope = try read(directory)
        var canonicalSource = deletionEnvelope["source"] as! [String: Any]
        canonicalSource.removeValue(forKey: "capturedAt")
        let digest = SHA256.hash(data: try data(canonicalSource)).map { String(format: "%02x", $0) }.joined()
        expect(deletionEnvelope["sourceDigest"] as? String == digest, "Source digest is canonical sorted JSON without capture time")

        if CommandLine.arguments.count > 1, !CommandLine.arguments[1].isEmpty {
            let fixtureData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
            let fixture = try object(fixtureData)
            let fixtureDirectory = root.appendingPathComponent("production-js-fixture")
            let fixtureStore = NativePlacesMigrationStore(directory: fixtureDirectory)
            let fixtureReport = try await fixtureStore.rehearse(fixtureData)
            let fixtureSaved = fixture["savedPlaces"] as! [[String: Any]]
            let persisted = try read(fixtureDirectory)["source"] as! [String: Any]
            expect(fixtureReport.savedPlaceCount == fixtureSaved.count && fixtureReport.savedPlaceCount > 0 &&
                   fixtureReport.selectedPlaceCount == 1 && fixtureReport.lastPlaceCount == 1,
                   "Production JavaScript export imports with expected aggregate counts")
            expect((persisted["preferences"] as! [String: Any])["timeFormat"] as? String == "auto",
                   "Production exporter preserves raw Auto clock preference")
            expect(fixtureSaved.contains { $0["legacyIDType"] as? String == "number" },
                   "Production fixture exercises numeric legacy ID provenance")
            expect(fixtureSaved.contains { $0["alias"] is String }, "Production fixture exercises aliases")
            expect(NSDictionary(dictionary: fixture).isEqual(to: persisted),
                   "Production JS to Swift roundtrip is lossless across the full allowlisted export")
            let replay = try await fixtureStore.rehearse(fixtureData)
            expect(replay.unchanged && replay.revision == fixtureReport.revision,
                   "Production fixture replay is idempotent")
        }
        print("Native places migration rehearsal tests passed")
    }
}
