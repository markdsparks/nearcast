import Foundation
import CryptoKit

@main
@MainActor
struct NativePlanMigrationTests {
    static let firstCapture = "2026-09-19T15:30:00.000Z"
    static let secondCapture = "2026-09-19T15:31:00.000Z"
    static let thirdCapture = "2026-09-19T15:32:00.000Z"
    static let primaryName = "plans-rehearsal.v1.json"
    static let backupName = "plans-rehearsal.previous.json"

    static func expect(_ condition: Bool, _ message: String) {
        precondition(condition, message)
    }

    static func plan(_ id: String = "plan-home", targetDate: String = "2026-09-23", startHour: Double = 18, endHour: Double = 19) -> [String: Any] {
        [
            "id": id,
            "kind": "plan",
            "title": id == "plan-home" ? "Soccer practice" : "Dinner outside",
            "label": "Plan window",
            "original": "A local plan",
            "answer": "Saved historical answer",
            "place": [
                "id": "custom:home",
                "name": "Springfield",
                "admin1": "Illinois",
                "country": "United States",
                "countryCode": "US",
                "latitude": 39.7817,
                "longitude": -89.6501,
                "timezone": "America/Chicago"
            ],
            "targetDate": targetDate,
            "startHour": startHour,
            "endHour": endHour,
            "windows": [[
                "id": "window-\(id)",
                "targetDate": targetDate,
                "startHour": startHour,
                "endHour": endHour,
                "label": "Plan window"
            ]],
            "scheduleType": "single",
            "span": NSNull(),
            "routine": NSNull(),
            "schemaVersion": 2,
            "scheduleId": "schedule-\(id)",
            "createdAt": 1_790_000_000_000,
            "updatedAt": 1_790_000_000_000
        ]
    }

    static func source(_ plans: [[String: Any]]? = nil,
                       capturedAt: String = firstCapture,
                       selectedPlanIDs: [String] = ["plan-home"],
                       selectedPlaceIDs: [String] = ["custom:home"],
                       placeSelectionMode: String = "explicit",
                       placeNotificationsEnabled: Bool = true,
                       globalPreference: String = "enabled") -> [String: Any] {
        [
            "version": 1,
            "owner": "legacy",
            "hydration": "ready",
            "capturedAt": capturedAt,
            "plans": plans ?? [plan()],
            "notificationIntent": [
                "hydration": "ready",
                "globalPreference": globalPreference,
                "selectedPlanIDs": selectedPlanIDs,
                "placeNotificationsEnabled": placeNotificationsEnabled,
                "selectedPlaceIDs": selectedPlaceIDs,
                "placeSelectionMode": placeSelectionMode
            ]
        ]
    }

    static func data(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func object(_ data: Data) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    static func read(_ directory: URL, name: String = primaryName) throws -> [String: Any] {
        try object(Data(contentsOf: directory.appendingPathComponent(name)))
    }

    static func assertRejected(_ source: [String: Any], store: NativePlanMigrationStore,
                               label: String, expected: NativePlanMigrationError? = nil) async throws {
        do {
            _ = try await store.rehearse(data(source))
            preconditionFailure("Accepted invalid plan migration source: \(label)")
        } catch let error as NativePlanMigrationError {
            if let expected { expect(error == expected, "Wrong rejection for \(label): \(error)") }
        }
    }

    static func assertStatusRejected(_ store: NativePlanMigrationStore,
                                     expected: NativePlanMigrationError) async throws {
        do {
            _ = try await store.status()
            preconditionFailure("Accepted an invalid stored plan migration envelope")
        } catch let error as NativePlanMigrationError {
            expect(error == expected, "Wrong stored-envelope rejection: \(error)")
        }
    }

    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("native-plan-migration-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let directory = root.appendingPathComponent("roundtrip", isDirectory: true)
        let store = NativePlanMigrationStore(directory: directory)
        expect(try await store.status() == nil, "An absent plan handover has no receipt")

        let first = try await store.rehearse(data(source()))
        expect(first.owner == "legacy" && first.revision == 1 && first.planCount == 1,
               "First rehearsal stages one legacy-owned plan")
        expect(first.selectedPlanCount == 1 && first.selectedPlaceCount == 1 && first.tombstoneCount == 0,
               "Report contains only aggregate selection counts")
        let originalBytes = try Data(contentsOf: directory.appendingPathComponent(primaryName))
        let staged = try read(directory)
        expect(staged["schemaVersion"] as? Int == 1 && staged["owner"] as? String == "legacy",
               "Envelope version and ownership are explicit")
        let stagedSource = staged["source"] as! [String: Any]
        let stagedPlans = stagedSource["plans"] as! [[String: Any]]
        expect(stagedPlans.count == 1 && stagedPlans[0]["id"] as? String == "plan-home",
               "Stable plan ID survives untouched")
        let stagedIntent = stagedSource["notificationIntent"] as! [String: Any]
        expect(stagedIntent["selectedPlanIDs"] as? [String] == ["plan-home"],
               "Only explicit plan selection is staged")
        expect(stagedIntent["placeNotificationsEnabled"] as? Bool == true,
               "Enabled saved-place watches remain explicitly enabled in the receipt")
        expect(stagedIntent["selectedPlaceIDs"] as? [String] == ["custom:home"],
               "Only explicit saved-place selection is staged")

        let duplicate = try await store.rehearse(data(source()))
        expect(duplicate.unchanged && duplicate.revision == 1,
               "Exact duplicate is idempotent")
        expect(try Data(contentsOf: directory.appendingPathComponent(primaryName)) == originalBytes,
               "Exact duplicate avoids a write")

        let laterCapture = try await store.rehearse(data(source(capturedAt: secondCapture)))
        expect(laterCapture.unchanged && laterCapture.revision == 1,
               "Capture time alone is not a semantic plan or notification change")
        let laterStored = try read(directory)
        expect((laterStored["source"] as! [String: Any])["capturedAt"] as? String == secondCapture,
               "Latest verified source capture is retained")
        expect(laterStored["sourceDigest"] as? String == staged["sourceDigest"] as? String,
               "Source digest excludes capture timestamp")
        try await assertRejected(source(capturedAt: firstCapture), store: store,
                                 label: "older otherwise identical capture", expected: .staleExport)

        var invalid = source(capturedAt: thirdCapture)
        invalid.removeValue(forKey: "notificationIntent")
        try await assertRejected(invalid, store: store, label: "missing notification selection")
        invalid = source(capturedAt: thirdCapture)
        var intent = invalid["notificationIntent"] as! [String: Any]
        intent["hydration"] = "loading"
        invalid["notificationIntent"] = intent
        try await assertRejected(invalid, store: store, label: "notification selection not hydrated")
        intent["hydration"] = "ready"
        intent.removeValue(forKey: "placeNotificationsEnabled")
        invalid["notificationIntent"] = intent
        try await assertRejected(invalid, store: store, label: "missing saved-place watch enablement")
        intent["placeNotificationsEnabled"] = 1
        invalid["notificationIntent"] = intent
        try await assertRejected(invalid, store: store, label: "non-boolean saved-place watch enablement")
        intent["placeNotificationsEnabled"] = true
        intent["selectedPlanIDs"] = ["not-a-current-plan"]
        invalid["notificationIntent"] = intent
        try await assertRejected(invalid, store: store, label: "dangling selected plan")
        intent["selectedPlanIDs"] = ["plan-home", "plan-home"]
        invalid["notificationIntent"] = intent
        try await assertRejected(invalid, store: store, label: "duplicate selected plan")
        intent["selectedPlanIDs"] = []
        intent["selectedPlaceIDs"] = ["custom:home"]
        intent["placeSelectionMode"] = "default"
        invalid["notificationIntent"] = intent
        try await assertRejected(invalid, store: store, label: "default mode invents explicit places")
        invalid = source(capturedAt: thirdCapture)
        invalid["version"] = 2
        try await assertRejected(invalid, store: store, label: "future source version", expected: .unsupportedExport)
        invalid["version"] = true
        try await assertRejected(invalid, store: store, label: "boolean source version", expected: .unsupportedExport)
        invalid = source(capturedAt: thirdCapture)
        invalid["privateAPNSToken"] = "never-copy-this"
        try await assertRejected(invalid, store: store, label: "unallowlisted sensitive top-level data")
        invalid = source(capturedAt: thirdCapture)
        var corruptedPlan = plan()
        corruptedPlan["schemaVersion"] = 3
        invalid["plans"] = [corruptedPlan]
        try await assertRejected(invalid, store: store, label: "future plan schema", expected: .unsupportedExport)
        invalid = source(capturedAt: thirdCapture)
        invalid["plans"] = [plan(), plan()]
        try await assertRejected(invalid, store: store, label: "duplicate plan IDs")
        expect(try await store.status()?.revision == 1,
               "Bad exports never replace a previous staged source")

        let changedPlans = [plan("plan-dinner")]
        let deletion = try await store.rehearse(data(source(changedPlans, capturedAt: thirdCapture,
                                                            selectedPlanIDs: [], selectedPlaceIDs: [],
                                                            placeSelectionMode: "default", globalPreference: "off")))
        expect(deletion.revision == 2 && deletion.planCount == 1 && deletion.tombstoneCount == 1,
               "A removed plan creates an inert deletion tombstone")
        let deletionEnvelope = try read(directory)
        let tombstones = deletionEnvelope["tombstones"] as! [[String: Any]]
        expect(tombstones.count == 1 && tombstones[0]["id"] as? String == "plan-home" && tombstones[0]["revision"] as? Int == 2,
               "Tombstone refers to exact removed plan ID only")
        let receipt = String(decoding: try JSONEncoder().encode(deletion), as: UTF8.self)
        for privateValue in ["Soccer practice", "Springfield", "plan-home", "custom:home", "sourceDigest", "capturedAt"] {
            expect(!receipt.contains(privateValue), "Aggregate receipt must not disclose \(privateValue)")
        }

        let readded = try await store.rehearse(data(source([plan(), plan("plan-dinner")], capturedAt: "2026-09-19T15:33:00.000Z",
                                                            selectedPlanIDs: ["plan-home"], selectedPlaceIDs: [],
                                                            placeSelectionMode: "default")))
        expect(readded.revision == 3 && readded.tombstoneCount == 0,
               "Re-adding the exact ID supersedes its own tombstone")

        let emptyDirectory = root.appendingPathComponent("empty", isDirectory: true)
        let emptyStore = NativePlanMigrationStore(directory: emptyDirectory)
        let empty = try await emptyStore.rehearse(data(source([], selectedPlanIDs: [], selectedPlaceIDs: [],
                                                               placeSelectionMode: "default", globalPreference: "off")))
        expect(empty.revision == 1 && empty.planCount == 0 && empty.selectedPlanCount == 0,
               "An explicit ready empty Plans inventory is valid")

        let pausedPlacesDirectory = root.appendingPathComponent("paused-places", isDirectory: true)
        let pausedPlaces = try await NativePlanMigrationStore(directory: pausedPlacesDirectory).rehearse(
            data(source(selectedPlaceIDs: ["custom:home"], placeSelectionMode: "explicit", placeNotificationsEnabled: false))
        )
        expect(pausedPlaces.selectedPlaceCount == 1,
               "A paused explicit place selection remains an inert historical choice")
        let pausedIntent = try read(pausedPlacesDirectory)["source"] as! [String: Any]
        let pausedNotificationIntent = pausedIntent["notificationIntent"] as! [String: Any]
        expect(pausedNotificationIntent["placeNotificationsEnabled"] as? Bool == false,
               "A paused saved-place watch is never rewritten as an active default watch")

        // Interrupted writes never replace a full primary generation. A fresh
        // store can resume without interpreting the orphan as a real handover.
        for stage in [NativePlanMigrationStore.WriteStage.afterBackupWrite,
                      .afterPrimaryStaged, .beforePrimaryReplace] {
            let interruptedDirectory = root.appendingPathComponent("interrupted-\(String(describing: stage))")
            let baseline = NativePlanMigrationStore(directory: interruptedDirectory)
            _ = try await baseline.rehearse(data(source()))
            let before = try Data(contentsOf: interruptedDirectory.appendingPathComponent(primaryName))
            let failing = NativePlanMigrationStore(directory: interruptedDirectory) { current in
                if current == stage { throw NativePlanMigrationError.storageUnavailable }
            }
            try await assertRejected(source([], capturedAt: secondCapture, selectedPlanIDs: [], selectedPlaceIDs: [], placeSelectionMode: "default"),
                                     store: failing, label: "interrupted primary write", expected: .storageUnavailable)
            expect(try Data(contentsOf: interruptedDirectory.appendingPathComponent(primaryName)) == before,
                   "Interrupted write preserves committed primary")
            try Data("orphan stage".utf8).write(to: interruptedDirectory.appendingPathComponent(".pending-crash"))
            let restarted = NativePlanMigrationStore(directory: interruptedDirectory)
            expect(try await restarted.status()?.revision == 1,
                   "Restart ignores incomplete pending data")
            let resumed = try await restarted.rehearse(data(source([], capturedAt: secondCapture, selectedPlanIDs: [], selectedPlaceIDs: [], placeSelectionMode: "default")))
            expect(resumed.revision == 2, "Retry commits one new generation")
        }

        // A damaged primary may recover a complete previous generation, but a
        // newer/unreadable version is never overwritten as if it were empty.
        let recoveryDirectory = root.appendingPathComponent("recovery", isDirectory: true)
        let recovery = NativePlanMigrationStore(directory: recoveryDirectory)
        _ = try await recovery.rehearse(data(source()))
        _ = try await recovery.rehearse(data(source([plan("plan-dinner")], capturedAt: secondCapture,
                                                     selectedPlanIDs: [], selectedPlaceIDs: [], placeSelectionMode: "default")))
        try Data("broken primary".utf8).write(to: recoveryDirectory.appendingPathComponent(primaryName))
        let recovered = try await NativePlanMigrationStore(directory: recoveryDirectory).status()
        expect(recovered?.recoveredFromBackup == true && recovered?.revision == 1,
               "A damaged primary recovers only the last complete backup")
        var future = try read(recoveryDirectory, name: backupName)
        future["schemaVersion"] = 2
        try data(future).write(to: recoveryDirectory.appendingPathComponent(backupName))
        try await assertStatusRejected(NativePlanMigrationStore(directory: recoveryDirectory), expected: .unsupportedStoreVersion)

        // A future/native owner is a hard fence even if an old valid backup is
        // present. Rehearsal must not use that backup as permission to replace
        // the primary record or reassert legacy ownership.
        let nativeOwnedDirectory = root.appendingPathComponent("native-owned", isDirectory: true)
        let nativeOwnedStore = NativePlanMigrationStore(directory: nativeOwnedDirectory)
        _ = try await nativeOwnedStore.rehearse(data(source()))
        _ = try await nativeOwnedStore.rehearse(data(source([plan("plan-dinner")], capturedAt: secondCapture,
                                                            selectedPlanIDs: [], selectedPlaceIDs: [], placeSelectionMode: "default")))
        var nativeOwnedEnvelope = try read(nativeOwnedDirectory)
        nativeOwnedEnvelope["owner"] = "native"
        let nativeOwnedBytes = try data(nativeOwnedEnvelope)
        try nativeOwnedBytes.write(to: nativeOwnedDirectory.appendingPathComponent(primaryName))
        try await assertRejected(source(capturedAt: thirdCapture), store: nativeOwnedStore,
                                 label: "future/native-owned primary", expected: .unsupportedStoreVersion)
        expect(try Data(contentsOf: nativeOwnedDirectory.appendingPathComponent(primaryName)) == nativeOwnedBytes,
               "A future/native-owned primary is never overwritten from an older backup")
        try await assertStatusRejected(nativeOwnedStore, expected: .unsupportedStoreVersion)

        print("Native plan migration tests passed")
    }
}
