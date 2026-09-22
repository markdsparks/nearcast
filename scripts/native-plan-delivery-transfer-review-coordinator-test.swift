import Foundation

@main
struct NativePlanDeliveryTransferReviewCoordinatorTests {
    private static let capture = "2026-09-20T01:00:00.000Z"

    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("native-plan-delivery-transfer-review-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let sourceBytes = try sourceData()
        let sourceAgenda = try agenda(from: sourceBytes)
        let plan = nativePlan(from: sourceAgenda.plans[0])
        let remoteArchive = try archive(plan: plan, agenda: sourceAgenda, sourceScope: .remoteProduction)
        let localArchive = try archive(plan: plan, agenda: sourceAgenda, sourceScope: .localDevelopment)
        let ownedPlaces = placesSnapshot()
        let remoteMappings = mappings(archive: remoteArchive, places: ownedPlaces, scope: .remoteProduction)
        let localMappings = mappings(archive: localArchive, places: ownedPlaces, scope: .localDevelopment)

        // A review of an absent stage must not create the root, a scoped
        // directory, a lock, a primary, or a historical backup.
        let absentBase = root.appendingPathComponent("absent", isDirectory: true)
        let absentCoordinator = NativePlanDeliveryTransferReviewCoordinator(
            sourceScope: .remoteProduction,
            stageDirectory: absentBase
        )
        expectUnavailable(
            await absentCoordinator.review(mappings: remoteMappings),
            [.missingStage],
            "missing active-source P0 stage"
        )
        expect(!FileManager.default.fileExists(atPath: absentBase.path),
               "A read-only review must not create its missing stage directory")

        let sharedBase = root.appendingPathComponent("shared", isDirectory: true)
        let localStore = NativePlanNotificationIntentStore(
            directory: NativeLegacySourceScope.localDevelopment.scopedDirectory(from: sharedBase),
            sourceScope: .localDevelopment
        )
        _ = try await localStore.stageVerifiedLegacyExport(sourceBytes, mappings: localMappings)

        let coordinator = NativePlanDeliveryTransferReviewCoordinator(
            sourceScope: .remoteProduction,
            stageDirectory: sharedBase
        )
        expectUnavailable(
            await coordinator.review(mappings: remoteMappings),
            [.missingStage],
            "Local P0 stage must not leak into Production review"
        )
        expect(!FileManager.default.fileExists(atPath: sharedBase
            .appendingPathComponent("notification-intent-stage.v1.json").path),
               "Production review must not create or borrow a Local primary stage")

        let remoteStore = NativePlanNotificationIntentStore(
            directory: sharedBase,
            sourceScope: .remoteProduction
        )
        _ = try await remoteStore.stageVerifiedLegacyExport(sourceBytes, mappings: remoteMappings)
        let primary = sharedBase.appendingPathComponent("notification-intent-stage.v1.json")
        let backup = sharedBase.appendingPathComponent("notification-intent-stage.previous.json")
        let lock = sharedBase.appendingPathComponent(".notification-intent.lock")
        let beforeReview = [fileSnapshot(primary), fileSnapshot(backup), fileSnapshot(lock)]

        let firstReview = await coordinator.review(mappings: remoteMappings)
        guard case .reviewable(let draft) = firstReview else {
            preconditionFailure("A current v3 stage and exact current mappings should be reviewable")
        }
        expect(draft.sourceScope == .remoteProduction && !draft.isNativeDeliveryActive,
               "A review draft keeps Production scope and never claims delivery")
        expect(
            await coordinator.revalidate(draft, mappings: remoteMappings) == .reviewable(draft),
            "An unchanged review draft must revalidate"
        )
        let afterReview = [fileSnapshot(primary), fileSnapshot(backup), fileSnapshot(lock)]
        expect(beforeReview == afterReview,
               "Review/revalidation must not change stage, backup, or lock bytes/metadata")

        var editedArchive = remoteArchive
        editedArchive.plans = [nativePlan(from: sourceAgenda.plans[0], title: "Soccer practice moved")]
        expectUnavailable(
            await coordinator.review(mappings: mappings(
                archive: editedArchive,
                places: ownedPlaces,
                scope: .remoteProduction
            )),
            [.selectedPlanMappingMismatch],
            "P0 v3 semantic Plan digest changed before first review"
        )

        expectUnavailable(
            await coordinator.review(mappings: mappings(
                archive: remoteArchive,
                places: placesSnapshot(owner: "legacy"),
                scope: .remoteProduction
            )),
            [.nativePlacesUnavailable],
            "native Places ownership unavailable"
        )
        expectUnavailable(
            await coordinator.review(mappings: mappings(
                archive: remoteArchive,
                places: placesSnapshot(includeHome: false),
                scope: .remoteProduction
            )),
            [.selectedPlaceMappingMismatch],
            "selected native place deleted"
        )

        await coordinator.configure(production: false)
        expect(await coordinator.currentSourceScope() == .localDevelopment,
               "Coordinator configure must select the Local source scope")
        guard case .reviewable(let localDraft) = await coordinator.review(mappings: localMappings) else {
            preconditionFailure("Local review should read only its matching Local v3 stage")
        }
        expect(localDraft.sourceScope == .localDevelopment,
               "Local review draft must retain its Local source scope")
        expectUnavailable(
            await coordinator.review(mappings: remoteMappings),
            [.sourceScopeMismatch],
            "Production mappings supplied while Local scope is active"
        )
        await coordinator.configure(sourceScope: .remoteProduction)
        expect(await coordinator.currentSourceScope() == .remoteProduction,
               "Coordinator scope reconfiguration must be in-memory and exact")
        expect(await coordinator.review(mappings: remoteMappings) == .reviewable(draft),
               "Reconfigured Production review should return its own prior draft")

        let validPrimary = try Data(contentsOf: primary)
        try Data("corrupt-primary".utf8).write(to: primary)
        let corruptBeforeReview = fileSnapshot(primary)
        expectUnavailable(
            await coordinator.review(mappings: remoteMappings),
            [.staleStage],
            "corrupt active-source P0 primary"
        )
        expect(fileSnapshot(primary) == corruptBeforeReview,
               "A stale-stage review must leave corrupt primary bytes and metadata untouched")
        try validPrimary.write(to: primary)

        let revoked = try await remoteStore.revokeStagedIntent(matchingReceiptDigest: draft.stageReceiptDigest)
        expect(revoked, "The fixture should revoke the exact current remote P0 receipt")
        expectUnavailable(
            await coordinator.review(mappings: remoteMappings),
            [.revokedStage],
            "P0 tombstone remains unavailable through review"
        )

        print("PASS Native Plan delivery transfer review coordinator")
    }

    private struct FileSnapshot: Equatable {
        let exists: Bool
        let data: Data?
        let modificationDate: Date?
    }

    private static func fileSnapshot(_ url: URL) -> FileSnapshot {
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .init(exists: false, data: nil, modificationDate: nil)
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return .init(
            exists: true,
            data: try? Data(contentsOf: url),
            modificationDate: attributes?[.modificationDate] as? Date
        )
    }

    private static func expect(_ condition: Bool, _ message: String) {
        precondition(condition, message)
    }

    private static func expectUnavailable(
        _ value: NativePlanDeliveryTransferDraftReadiness,
        _ reasons: [NativePlanDeliveryTransferDraftUnavailabilityReason],
        _ label: String
    ) {
        guard case .unavailable(let unavailable) = value else {
            preconditionFailure("Expected unavailable review for \(label)")
        }
        expect(unavailable.reasons == reasons,
               "Wrong unavailability reason(s) for \(label): \(unavailable.reasons)")
    }

    private static func sourceData() throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "version": 1,
            "owner": "legacy",
            "hydration": "ready",
            "capturedAt": capture,
            "plans": [sourcePlan()],
            "notificationIntent": [
                "hydration": "ready",
                "globalPreference": "enabled",
                "selectedPlanIDs": ["plan-home"],
                "placeNotificationsEnabled": true,
                "selectedPlaceIDs": ["custom:home"],
                "placeSelectionMode": "explicit"
            ]
        ], options: [.sortedKeys, .withoutEscapingSlashes])
    }

    private static func sourcePlan() -> [String: Any] {
        [
            "id": "plan-home",
            "kind": "plan",
            "title": "Soccer practice",
            "label": "Plan window",
            "original": "Soccer Tuesday 6 to 7",
            "answer": "Bring a rain jacket.",
            "place": [
                "id": "custom:home",
                "name": "Maryville",
                "admin1": "Illinois",
                "country": "United States",
                "countryCode": "US",
                "latitude": 38.7237,
                "longitude": -89.9545,
                "timezone": "America/Chicago"
            ],
            "targetDate": "2026-09-22",
            "startHour": 18,
            "endHour": 19,
            "windows": [[
                "id": "window-plan-home",
                "targetDate": "2026-09-22",
                "startHour": 18,
                "endHour": 19,
                "label": "Plan window"
            ]],
            "scheduleType": "single",
            "span": NSNull(),
            "routine": NSNull(),
            "schemaVersion": 2,
            "scheduleId": "schedule-plan-home",
            "createdAt": 1_790_000_000_000,
            "updatedAt": 1_790_000_000_000
        ]
    }

    private static func agenda(from source: Data) throws -> NativeAgenda {
        guard var object = try JSONSerialization.jsonObject(with: source) as? [String: Any] else {
            preconditionFailure("Expected source object")
        }
        object.removeValue(forKey: "notificationIntent")
        let agendaBytes = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return try NativeAgendaRepository().decode(agendaBytes)
    }

    private static func nativePlan(
        from source: NativeAgendaPlan,
        title: String? = nil
    ) -> NativeAgendaPlan {
        .init(
            id: "native-copy-\(source.id)",
            title: title ?? source.title,
            label: source.label,
            original: source.original,
            answer: source.answer,
            place: source.place,
            targetDate: source.targetDate,
            startHour: source.startHour,
            endHour: source.endHour,
            windows: source.windows,
            scheduleType: source.scheduleType,
            span: source.span,
            routine: source.routine,
            scheduleID: "native-schedule-\(source.id)",
            createdAtMilliseconds: source.createdAtMilliseconds,
            updatedAtMilliseconds: source.updatedAtMilliseconds
        )
    }

    private static func archive(
        plan: NativeAgendaPlan,
        agenda: NativeAgenda,
        sourceScope: NativeLegacySourceScope
    ) throws -> NativePlanArchive {
        var archive = NativePlanArchive()
        archive.plans = [plan]
        archive.importedIDs = ["plan-home": plan.id]
        archive.legacyHandoff = .init(
            version: 1,
            sourceScope: sourceScope,
            sourceDigest: try NativePlanLibrary.legacyAgendaDigest(agenda),
            sourceCapturedAtMilliseconds: Int64((agenda.capturedAt.timeIntervalSince1970 * 1_000).rounded()),
            sourcePlanCount: agenda.plans.count,
            availableNativeCopyCount: agenda.plans.count,
            protectedDeletedCount: 0,
            sourcePlanIDHashes: agenda.plans.map { NativePlanLibrary.legacyIdentifierDigest($0.id) }.sorted()
        )
        return archive
    }

    private static func managedHome() -> NativeManagedPlace {
        .init(
            id: "custom:home",
            legacyIDType: nil,
            name: "Maryville",
            admin1: "Illinois",
            country: "United States",
            countryCode: "US",
            latitude: 38.7237,
            longitude: -89.9545,
            alias: nil,
            timezone: "America/Chicago",
            followsCurrentLocation: nil
        )
    }

    private static func placesSnapshot(
        revision: Int = 1,
        owner: String = "native",
        includeHome: Bool = true
    ) -> NativePlacesOwnerSnapshot {
        let home = managedHome()
        return .init(
            revision: revision,
            source: .init(
                version: 1,
                owner: owner,
                hydration: "ready",
                capturedAt: capture,
                selectedPlace: home,
                lastPlace: home,
                savedPlaces: includeHome ? [home] : [],
                preferences: .init(
                    unit: "fahrenheit",
                    timeFormat: "auto",
                    theme: "auto",
                    reactiveSkyEnabled: true,
                    reactiveSkyMotionAllowed: true
                )
            ),
            pendingDeletions: [],
            deletionWatermark: 0
        )
    }

    private static func mappings(
        archive: NativePlanArchive,
        places: NativePlacesOwnerSnapshot,
        scope: NativeLegacySourceScope
    ) -> NativePlanNotificationIntentMappingSnapshot {
        .init(planArchive: archive, nativePlacesSnapshot: places, sourceScope: scope)
    }
}
