import Foundation

@main
@MainActor
struct NativePlanHandoffTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func place(timezone: String? = "America/Chicago") -> NativeAgendaPlace {
        .init(
            id: "legacy:home",
            legacyIDType: nil,
            name: "Maryville",
            admin1: "Illinois",
            country: "United States",
            countryCode: "US",
            latitude: 38.7231,
            longitude: -89.9557,
            alias: "Home",
            timezone: timezone,
            followsCurrentLocation: false
        )
    }

    static func plan(
        id: String,
        scheduleID: String,
        place: NativeAgendaPlace? = nil,
        title: String = "Soccer practice"
    ) -> NativeAgendaPlan {
        let place = place ?? self.place()
        return .init(
            id: id,
            title: title,
            label: "Plan window",
            original: "A weather-aware plan",
            answer: "Historical forecast note",
            place: place,
            targetDate: "2026-09-23",
            startHour: 17,
            endHour: 19,
            windows: [.init(id: "window-\(id)", targetDate: "2026-09-23", startHour: 17, endHour: 19, label: "Plan window")],
            scheduleType: .single,
            span: nil,
            routine: nil,
            scheduleID: scheduleID,
            createdAtMilliseconds: 1_790_000_000_000,
            updatedAtMilliseconds: 1_790_000_010_000
        )
    }

    static func preservesSchedule(_ source: NativeAgendaPlan, _ copy: NativeAgendaPlan) -> Bool {
        source.title == copy.title &&
            source.label == copy.label &&
            source.original == copy.original &&
            source.answer == copy.answer &&
            source.place == copy.place &&
            source.targetDate == copy.targetDate &&
            source.startHour == copy.startHour &&
            source.endHour == copy.endHour &&
            source.windows == copy.windows &&
            source.scheduleType == copy.scheduleType &&
            source.span == copy.span &&
            source.routine == copy.routine &&
            source.createdAtMilliseconds == copy.createdAtMilliseconds &&
            source.updatedAtMilliseconds == copy.updatedAtMilliseconds
    }

    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let library = NativePlanLibrary(directory: root.appendingPathComponent("Plans", isDirectory: true))
        let sourceSafeID = plan(id: "legacy-soccer", scheduleID: "legacy-schedule-soccer")
        let sourceNativeNamespace = plan(id: "native-earlier-plan", scheduleID: "legacy-schedule-native", title: "School pickup")
        let sourceCollidingID = plan(id: "legacy-collision", scheduleID: "legacy-schedule-collision", title: "Dinner outside")
        let earlier = NativeAgenda(
            capturedAt: Date(timeIntervalSince1970: 1_790_000_100),
            plans: [sourceSafeID, sourceNativeNamespace, sourceCollidingID]
        )

        // An existing native record owns its ID. The import must generate a
        // new local copy for a colliding earlier ID rather than overwrite it.
        let existingNative = plan(id: "legacy-collision", scheduleID: "native-schedule-existing", title: "Existing native plan")
        try library.save(existingNative, replacing: nil)
        expect(library.plans == [existingNative], "Opening native Plans must not import a retained agenda automatically")
        guard case .ready(planCount: 3) = library.legacyHandoffState(for: earlier) else {
            preconditionFailure("A verified earlier Agenda should wait for explicit handoff")
        }

        let result = try library.handoffVerifiedLegacyAgenda(earlier)
        guard case .imported(let receipt) = result else { preconditionFailure("First explicit handoff should import") }
        expect(receipt.sourcePlanCount == 3 && receipt.availableNativeCopyCount == 3 && receipt.protectedDeletedCount == 0,
               "The receipt records only aggregate native-copy state")
        expect(library.plans.count == 4 && library.archive.legacyHandoff == receipt,
               "The complete handoff becomes durable only after every plan is copied")

        guard case .importedCopy(let safeCopy) = library.resolveRoutePlan(id: sourceSafeID.id) else {
            preconditionFailure("A safely preserved earlier ID must resolve to its local imported copy")
        }
        expect(safeCopy.id == sourceSafeID.id, "A non-conflicting non-native earlier plan ID is preserved")
        expect(safeCopy.scheduleID != sourceSafeID.scheduleID && safeCopy.scheduleID.hasPrefix("native-schedule-"),
               "A copied plan always receives a native-only schedule identity")
        expect(preservesSchedule(sourceSafeID, safeCopy), "Schedule and historical plan data are copied without alteration")

        guard case .importedCopy(let nativeNamespaceCopy) = library.resolveRoutePlan(id: sourceNativeNamespace.id) else {
            preconditionFailure("A native-namespace earlier ID should still route to its local copy")
        }
        expect(nativeNamespaceCopy.id.hasPrefix("native-import-") && nativeNamespaceCopy.id != sourceNativeNamespace.id,
               "An earlier ID in the native namespace is remapped rather than claimed")
        expect(preservesSchedule(sourceNativeNamespace, nativeNamespaceCopy),
               "Namespace remapping does not alter the copied schedule")

        guard case .importedCopy(let collisionCopy) = library.resolveRoutePlan(id: sourceCollidingID.id) else {
            preconditionFailure("A colliding earlier ID should route to its separate imported copy")
        }
        expect(collisionCopy.id.hasPrefix("native-import-") && collisionCopy.id != existingNative.id,
               "An earlier ID collision never overwrites a native record")
        expect(library.plans.contains(existingNative),
               "The earlier mapping never overwrites the existing native record")

        let changedEarlier = NativeAgenda(
            capturedAt: Date(timeIntervalSince1970: 1_790_000_200),
            plans: [sourceSafeID, sourceNativeNamespace, sourceCollidingID,
                    plan(id: "legacy-later-change", scheduleID: "legacy-later", title: "Later legacy change")]
        )
        guard case .alreadyCompleted(let replayReceipt) = try library.handoffVerifiedLegacyAgenda(changedEarlier) else {
            preconditionFailure("A later earlier projection must not replay into native Plans")
        }
        expect(replayReceipt == receipt && library.plans.count == 4,
               "One-time handoff ignores later earlier changes instead of duplicating or rewriting native Plans")

        try library.delete(safeCopy)
        expect(library.resolveRoutePlan(id: sourceSafeID.id) == .unavailable,
               "Deleting an imported copy leaves an earlier-ID tombstone")
        expect(library.archive.legacyHandoff?.availableNativeCopyCount == 2 &&
                   library.archive.legacyHandoff?.protectedDeletedCount == 1,
               "Deleting an imported copy updates only the local handoff summary, not its source receipt")
        _ = try library.handoffVerifiedLegacyAgenda(earlier)
        expect(!library.plans.contains(where: { $0.id == safeCopy.id }),
               "A replay cannot resurrect a deleted imported plan")
        let reopened = NativePlanLibrary(directory: root.appendingPathComponent("Plans", isDirectory: true))
        expect(reopened.resolveRoutePlan(id: sourceSafeID.id) == .unavailable,
               "Deleted imported-plan tombstones survive a process restart")
        guard case .completed(let reopenedReceipt) = reopened.legacyHandoffState(for: changedEarlier) else {
            preconditionFailure("The completed handoff receipt must survive a restart")
        }
        expect(reopenedReceipt.sourceDigest == receipt.sourceDigest &&
                   reopenedReceipt.sourceCapturedAtMilliseconds == receipt.sourceCapturedAtMilliseconds &&
                   reopenedReceipt.availableNativeCopyCount == 2 && reopenedReceipt.protectedDeletedCount == 1,
               "Restart retains the original one-time source receipt and current local tombstone summary")

        // A source that was verified for read-only presentation but cannot be
        // placed safely in a native timezone fails before any plan or receipt
        // is written. A partial schedule import would be worse than no import.
        let unsafeLibrary = NativePlanLibrary(directory: root.appendingPathComponent("Unsafe", isDirectory: true))
        let unsafeAgenda = NativeAgenda(
            capturedAt: Date(timeIntervalSince1970: 1_790_000_300),
            plans: [sourceSafeID, plan(id: "legacy-no-timezone", scheduleID: "legacy-no-timezone", place: place(timezone: nil))]
        )
        do {
            _ = try unsafeLibrary.handoffVerifiedLegacyAgenda(unsafeAgenda)
            preconditionFailure("A native-unsafe source plan must not create a partial handoff")
        } catch NativePlanLegacyHandoffError.unsafePlan {
            // Expected: no native records, receipt, or delivery behavior changed.
        }
        expect(unsafeLibrary.plans.isEmpty && unsafeLibrary.archive.legacyHandoff == nil,
               "An unsafe handoff leaves native Plans untouched")

        // A prior build may have a protected historical mapping that was not
        // part of this source snapshot. Deleting it cannot rewrite the new
        // handoff summary; source-ID fingerprints keep those boundaries exact.
        let mixedDirectory = root.appendingPathComponent("MixedHistory", isDirectory: true)
        let oldMapped = plan(id: "native-import-old", scheduleID: "native-schedule-old", title: "Older imported plan")
        try NativePlanDiskStore(directory: mixedDirectory).save(
            NativePlanArchive(plans: [oldMapped], importedIDs: ["legacy-outside-this-handoff": oldMapped.id])
        )
        let mixedLibrary = NativePlanLibrary(directory: mixedDirectory)
        let onePlanAgenda = NativeAgenda(capturedAt: Date(timeIntervalSince1970: 1_790_000_400), plans: [sourceSafeID])
        _ = try mixedLibrary.handoffVerifiedLegacyAgenda(onePlanAgenda)
        try mixedLibrary.delete(oldMapped)
        expect(mixedLibrary.archive.legacyHandoff?.availableNativeCopyCount == 1 &&
                   mixedLibrary.archive.legacyHandoff?.protectedDeletedCount == 0,
               "A deletion outside this handoff does not distort its native-copy summary")

        // The archive addition is deliberately backward-compatible: an
        // existing native-only Plans file has no handoff receipt and must stay
        // readable rather than looking damaged or triggering an import.
        let legacyArchiveDirectory = root.appendingPathComponent("PreHandoffArchive", isDirectory: true)
        try FileManager.default.createDirectory(at: legacyArchiveDirectory, withIntermediateDirectories: true)
        let oldPlan = plan(id: "native-existing", scheduleID: "native-schedule-existing")
        let oldPlanObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(oldPlan))
        let oldArchive: [String: Any] = [
            "version": 1,
            "plans": [oldPlanObject],
            "importedIDs": [:]
        ]
        try JSONSerialization.data(withJSONObject: oldArchive, options: [.sortedKeys]).write(
            to: legacyArchiveDirectory.appendingPathComponent("plans.v1.json")
        )
        let preHandoffLibrary = NativePlanLibrary(directory: legacyArchiveDirectory)
        expect(preHandoffLibrary.plans == [oldPlan] && preHandoffLibrary.archive.legacyHandoff == nil,
               "A pre-handoff native Plans archive remains readable and does not claim migration")

        print("PASS Native Plans handoff: explicit one-time verified copy, safe IDs, replay/tombstone protection, no partial schedule import")
    }
}
