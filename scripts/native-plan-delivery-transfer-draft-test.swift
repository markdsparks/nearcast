import Foundation

@main
struct NativePlanDeliveryTransferDraftTests {
    private static let capture = "2026-09-20T01:00:00.000Z"
    private static let digestA = String(repeating: "a", count: 64)
    private static let digestB = String(repeating: "b", count: 64)
    private static let digestC = String(repeating: "c", count: 64)
    private static let digestD = String(repeating: "d", count: 64)

    static func main() {
        let plan = nativePlan()
        let archive = verifiedArchive(plan: plan)
        let places = ownedPlacesSnapshot()
        let mappings = mappingSnapshot(archive: archive, places: places)
        let planSemanticDigest = mappings.planCopies["legacy-plan"]!.semanticDigest
        let currentStage = stage(nativePlanID: plan.id, semanticDigest: planSemanticDigest)

        let ready = NativePlanDeliveryTransferDraftValidator.readiness(
            stage: currentStage,
            mappings: mappings,
            sourceScope: .remoteProduction
        )
        guard case .reviewable(let draft) = ready else {
            preconditionFailure("A current P0 stage and exact native mappings should produce a review-only draft")
        }
        expect(draft.version == 1 && draft.sourceScope == .remoteProduction,
               "Draft must retain the active source scope")
        expect(draft.planTargets == [.init(
            legacyPlanID: "legacy-plan",
            nativePlanID: plan.id,
            semanticDigest: mappings.planCopies["legacy-plan"]!.semanticDigest
        )], "Draft must retain the exact native plan semantic identity")
        expect(draft.placeTargets == [.init(legacyPlaceID: "custom:home", nativePlaceID: "custom:home")],
               "Draft must retain the exact native place identity")
        expect(draft.notificationIntent.globalPreference == .enabled && !draft.isNativeDeliveryActive,
               "A review draft must preserve legacy intent without claiming native delivery")
        expect(NativePlanDeliveryTransferDraftValidator.validate(
            draft,
            stage: currentStage,
            mappings: mappings,
            sourceScope: .remoteProduction
        ) == .reviewable(draft), "An unchanged draft must revalidate")

        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: nil, mappings: mappings, sourceScope: .remoteProduction
            ), [.missingStage], "missing P0 stage"
        )

        var revoked = currentStage
        revoked.isRevoked = true
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: revoked, mappings: mappings, sourceScope: .remoteProduction
            ), [.revokedStage], "revoked P0 stage"
        )

        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: stage(nativePlanID: plan.id, semanticDigest: planSemanticDigest, stagingEpoch: 0),
                mappings: mappings,
                sourceScope: .remoteProduction
            ), [.staleStage], "malformed/stale P0 stage"
        )

        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: stage(nativePlanID: plan.id, semanticDigest: planSemanticDigest, scope: .localDevelopment),
                mappings: mappings,
                sourceScope: .remoteProduction
            ), [.sourceScopeMismatch], "stage from another source scope"
        )

        let receiptFromProduction = mappingSnapshot(
            archive: archive,
            places: places,
            scope: .localDevelopment
        )
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: stage(nativePlanID: plan.id, semanticDigest: planSemanticDigest, scope: .localDevelopment),
                mappings: receiptFromProduction,
                sourceScope: .localDevelopment
            ), [.sourceScopeMismatch], "Plan handoff receipt from another source scope"
        )

        var deletedArchive = archive
        deletedArchive.plans = []
        let deletedPlanMappings = mappingSnapshot(archive: deletedArchive, places: places)
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: currentStage,
                mappings: deletedPlanMappings,
                sourceScope: .remoteProduction
            ), [.selectedPlanMappingMismatch], "deleted native selected plan"
        )

        var remappedArchive = archive
        remappedArchive.importedIDs["legacy-plan"] = "a-different-native-id"
        let remappedPlanMappings = mappingSnapshot(archive: remappedArchive, places: places)
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: currentStage,
                mappings: remappedPlanMappings,
                sourceScope: .remoteProduction
            ), [.selectedPlanMappingMismatch], "remapped native selected plan"
        )

        // P0 v3's mapping receipt includes each selected Plan's semantic
        // digest, so a native edit is rejected
        // before the first draft and after any later review.
        var editedArchive = archive
        editedArchive.plans = [nativePlan(title: "School pickup moved")]
        let editedPlanMappings = mappingSnapshot(archive: editedArchive, places: places)
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: currentStage,
                mappings: editedPlanMappings,
                sourceScope: .remoteProduction
            ), [.selectedPlanMappingMismatch], "native selected plan semantic change before draft"
        )
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.validate(
                draft,
                stage: currentStage,
                mappings: editedPlanMappings,
                sourceScope: .remoteProduction
            ), [.selectedPlanMappingMismatch], "native selected plan semantic change after draft"
        )

        let unownedPlaces = ownedPlacesSnapshot(owner: "legacy")
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: currentStage,
                mappings: mappingSnapshot(archive: archive, places: unownedPlaces),
                sourceScope: .remoteProduction
            ), [.nativePlacesUnavailable], "native Places ownership unavailable"
        )

        let deletedPlace = ownedPlacesSnapshot(includeHome: false)
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.readiness(
                stage: currentStage,
                mappings: mappingSnapshot(archive: archive, places: deletedPlace),
                sourceScope: .remoteProduction
            ), [.selectedPlaceMappingMismatch], "deleted explicit native saved place"
        )

        let defaultStage = stage(
            nativePlanID: plan.id,
            semanticDigest: planSemanticDigest,
            selectedPlaceIDs: [],
            placeSelectionMode: .default,
            defaultBinding: .init(nativePlaceIDs: ["custom:home"], nativePlacesRevision: 1)
        )
        let defaultReady = NativePlanDeliveryTransferDraftValidator.readiness(
            stage: defaultStage,
            mappings: mappings,
            sourceScope: .remoteProduction
        )
        guard case .reviewable(let defaultDraft) = defaultReady else {
            preconditionFailure("A pinned default native place set should be reviewable")
        }
        let movedDefaultPlaces = ownedPlacesSnapshot(revision: 2)
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.validate(
                defaultDraft,
                stage: defaultStage,
                mappings: mappingSnapshot(archive: archive, places: movedDefaultPlaces),
                sourceScope: .remoteProduction
            ), [.selectedPlaceMappingMismatch], "default native Places revision changed after draft"
        )

        for preference in [NativePlanNotificationPreference.off, .disabled] {
            let preserved = NativePlanDeliveryTransferDraftValidator.readiness(
                stage: stage(nativePlanID: plan.id, semanticDigest: planSemanticDigest, preference: preference),
                mappings: mappings,
                sourceScope: .remoteProduction
            )
            guard case .reviewable(let preferenceDraft) = preserved else {
                preconditionFailure("A valid legacy \(preference.rawValue) preference should be preserved for review")
            }
            expect(preferenceDraft.notificationIntent.globalPreference == preference,
                   "The draft must never reinterpret \(preference.rawValue) as enabled")
        }

        var newerStage = currentStage
        newerStage.stagingEpoch = 2
        newerStage.receiptDigest = digestD
        expectUnavailable(
            NativePlanDeliveryTransferDraftValidator.validate(
                draft,
                stage: newerStage,
                mappings: mappings,
                sourceScope: .remoteProduction
            ), [.staleStage], "P0 stage changed after review"
        )

        print("PASS Native Plan delivery transfer draft")
    }

    private static func expect(_ condition: Bool, _ message: String) {
        precondition(condition, message)
    }

    private static func expectUnavailable(
        _ result: NativePlanDeliveryTransferDraftReadiness,
        _ reasons: [NativePlanDeliveryTransferDraftUnavailabilityReason],
        _ label: String
    ) {
        guard case .unavailable(let value) = result else {
            preconditionFailure("Expected unavailable for \(label)")
        }
        expect(value.reasons == reasons, "Wrong reason(s) for \(label): \(value.reasons)")
    }

    private static func agendaPlace() -> NativeAgendaPlace {
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

    private static func nativePlan(title: String = "School pickup") -> NativeAgendaPlan {
        .init(
            id: "native-plan-copy",
            title: title,
            label: "Plan window",
            original: "Pick up from school",
            answer: "Bring an umbrella.",
            place: agendaPlace(),
            targetDate: "2026-09-22",
            startHour: 18,
            endHour: 19,
            windows: [.init(
                id: "window-home",
                targetDate: "2026-09-22",
                startHour: 18,
                endHour: 19,
                label: "Plan window"
            )],
            scheduleType: .single,
            span: nil,
            routine: nil,
            scheduleID: "native-schedule-copy",
            createdAtMilliseconds: 1_790_000_000_000,
            updatedAtMilliseconds: 1_790_000_000_000
        )
    }

    private static func verifiedArchive(
        plan: NativeAgendaPlan,
        scope: NativeLegacySourceScope = .remoteProduction
    ) -> NativePlanArchive {
        var archive = NativePlanArchive()
        archive.plans = [plan]
        archive.importedIDs = ["legacy-plan": plan.id]
        archive.legacyHandoff = .init(
            version: 1,
            sourceScope: scope,
            sourceDigest: digestA,
            sourceCapturedAtMilliseconds: 1_790_000_000_000,
            sourcePlanCount: 1,
            availableNativeCopyCount: 1,
            protectedDeletedCount: 0,
            sourcePlanIDHashes: [NativePlanLibrary.legacyIdentifierDigest("legacy-plan")]
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

    private static func ownedPlacesSnapshot(
        revision: Int = 1,
        owner: String = "native",
        includeHome: Bool = true
    ) -> NativePlacesOwnerSnapshot {
        let home = managedHome()
        let source = NativePlacesSource(
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
        )
        return .init(revision: revision, source: source, pendingDeletions: [], deletionWatermark: 0)
    }

    private static func mappingSnapshot(
        archive: NativePlanArchive,
        places: NativePlacesOwnerSnapshot,
        scope: NativeLegacySourceScope = .remoteProduction
    ) -> NativePlanNotificationIntentMappingSnapshot {
        .init(planArchive: archive, nativePlacesSnapshot: places, sourceScope: scope)
    }

    private static func stage(
        nativePlanID: String,
        semanticDigest: String,
        scope: NativeLegacySourceScope = .remoteProduction,
        stagingEpoch: Int = 1,
        preference: NativePlanNotificationPreference = .enabled,
        selectedPlaceIDs: [String] = ["custom:home"],
        placeSelectionMode: NativePlanNotificationPlaceSelectionMode = .explicit,
        defaultBinding: NativePlanNotificationDefaultPlaceBinding? = nil
    ) -> NativePlanNotificationIntentStage {
        .init(
            schemaVersion: 3,
            minReaderVersion: 3,
            minWriterVersion: 3,
            owner: "legacy",
            stagingEpoch: stagingEpoch,
            sourceScope: scope,
            sourceDigest: digestA,
            sourceCapturedAt: capture,
            notificationIntent: .init(
                hydration: "ready",
                globalPreference: preference,
                selectedPlanIDs: ["legacy-plan"],
                placeNotificationsEnabled: true,
                selectedPlaceIDs: selectedPlaceIDs,
                placeSelectionMode: placeSelectionMode
            ),
            planMappings: [.init(
                legacyID: "legacy-plan",
                nativePlanID: nativePlanID,
                semanticDigest: semanticDigest
            )],
            placeMappings: selectedPlaceIDs.map {
                .init(legacyID: $0, nativePlaceID: $0)
            },
            defaultPlaceBinding: defaultBinding,
            mappingDigest: digestB,
            isRevoked: false,
            receiptDigest: digestC
        )
    }
}
