import Foundation
import CryptoKit

@main
struct NativePlanNotificationIntentTests {
    static let capture = "2026-09-20T01:00:00.000Z"
    static let laterCapture = "2026-09-20T01:01:00.000Z"

    static func expect(_ condition: Bool, _ message: String) {
        precondition(condition, message)
    }

    static func plan(_ id: String = "plan-home") -> [String: Any] {
        [
            "id": id,
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
                "id": "window-\(id)",
                "targetDate": "2026-09-22",
                "startHour": 18,
                "endHour": 19,
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

    static func source(
        capturedAt: String = capture,
        globalPreference: String = "enabled",
        selectedPlanIDs: [String] = ["plan-home"],
        placeNotificationsEnabled: Bool = true,
        selectedPlaceIDs: [String] = ["custom:home"],
        placeSelectionMode: String = "explicit"
    ) -> [String: Any] {
        [
            "version": 1,
            "owner": "legacy",
            "hydration": "ready",
            "capturedAt": capturedAt,
            "plans": [plan()],
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

    /// Builds an authentic v2 fixture from a real v3 write. It deliberately
    /// removes the v3-only per-plan semantic evidence, recomputes the old
    /// mapping receipt, and then recomputes the v2 envelope receipt. This
    /// lets the test prove that v2 is rejected for normal reads but can be
    /// safely replaced only from fresh retained legacy source.
    static func validV2StageBytes(from v3Bytes: Data) throws -> Data {
        guard var raw = try JSONSerialization.jsonObject(with: v3Bytes) as? [String: Any],
              let planMappings = raw["planMappings"] as? [[String: Any]] else {
            preconditionFailure("Expected a complete v3 stage fixture")
        }
        raw["schemaVersion"] = 2
        raw["minReaderVersion"] = 2
        raw["minWriterVersion"] = 2
        raw["planMappings"] = planMappings.map { mapping in
            var v2 = mapping
            v2.removeValue(forKey: "semanticDigest")
            return v2
        }

        var mappingSource: [String: Any] = [
            "planMappings": raw["planMappings"] as Any,
            "placeMappings": raw["placeMappings"] as Any,
            "sourceScope": raw["sourceScope"] as Any
        ]
        // MappingSemanticSource used synthesized Codable in v2, which omits
        // a nil optional rather than emitting the explicit envelope null.
        if let defaultBinding = raw["defaultPlaceBinding"], !(defaultBinding is NSNull) {
            mappingSource["defaultPlaceBinding"] = defaultBinding
        }
        raw["mappingDigest"] = digest(try data(mappingSource))
        raw["receiptDigest"] = ""
        raw["receiptDigest"] = digest(try data(raw))
        return try data(raw)
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func agenda(from source: [String: Any]) throws -> NativeAgenda {
        var agendaOnly = source
        agendaOnly.removeValue(forKey: "notificationIntent")
        return try NativeAgendaRepository().decode(data(agendaOnly))
    }

    static func nativeCopy(_ source: NativeAgendaPlan, title: String? = nil) -> NativeAgendaPlan {
        NativeAgendaPlan(
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

    static func verifiedArchive(
        copy: NativeAgendaPlan,
        agenda: NativeAgenda,
        sourceScope: NativeLegacySourceScope = .remoteProduction,
        receiptScope: NativeLegacySourceScope? = nil
    ) throws -> NativePlanArchive {
        var value = NativePlanArchive()
        value.plans = [copy]
        value.importedIDs = ["plan-home": copy.id]
        value.legacyHandoff = NativePlanLegacyHandoffReceipt(
            version: 1,
            sourceScope: receiptScope ?? sourceScope,
            sourceDigest: try NativePlanLibrary.legacyAgendaDigest(agenda),
            sourceCapturedAtMilliseconds: Int64((agenda.capturedAt.timeIntervalSince1970 * 1_000).rounded()),
            sourcePlanCount: agenda.plans.count,
            availableNativeCopyCount: agenda.plans.count,
            protectedDeletedCount: 0,
            sourcePlanIDHashes: agenda.plans.map { NativePlanLibrary.legacyIdentifierDigest($0.id) }.sorted()
        )
        return value
    }

    static func archiveWithoutReceipt(copy: NativeAgendaPlan) -> NativePlanArchive {
        var value = NativePlanArchive()
        value.plans = [copy]
        value.importedIDs = ["plan-home": copy.id]
        return value
    }

    static func nativePlaces(owner: String = "native", includeHome: Bool = true) -> NativePlacesSource {
        let home = NativeManagedPlace(
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
        return NativePlacesSource(
            version: 1,
            owner: owner,
            hydration: "ready",
            capturedAt: capture,
            selectedPlace: home,
            lastPlace: home,
            savedPlaces: includeHome ? [home] : [],
            preferences: NativePlacesPreferences(
                unit: "fahrenheit",
                timeFormat: "auto",
                theme: "auto",
                reactiveSkyEnabled: true,
                reactiveSkyMotionAllowed: true
            )
        )
    }

    static func ownedPlacesSnapshot(revision: Int = 1, includeHome: Bool = true) -> NativePlacesOwnerSnapshot {
        NativePlacesOwnerSnapshot(
            revision: revision,
            source: nativePlaces(includeHome: includeHome),
            pendingDeletions: [],
            deletionWatermark: 0
        )
    }

    static func mappings(
        archive: NativePlanArchive,
        places: NativePlacesSource? = nil,
        scope: NativeLegacySourceScope = .remoteProduction
    ) -> NativePlanNotificationIntentMappingSnapshot {
        NativePlanNotificationIntentMappingSnapshot(
            planArchive: archive,
            nativePlaces: places,
            sourceScope: scope
        )
    }

    static func mappings(
        archive: NativePlanArchive,
        snapshot: NativePlacesOwnerSnapshot?,
        scope: NativeLegacySourceScope = .remoteProduction
    ) -> NativePlanNotificationIntentMappingSnapshot {
        NativePlanNotificationIntentMappingSnapshot(
            planArchive: archive,
            nativePlacesSnapshot: snapshot,
            sourceScope: scope
        )
    }

    static func expectRejected(
        _ expected: NativePlanNotificationIntentError,
        store: NativePlanNotificationIntentStore,
        source value: [String: Any],
        mappings: NativePlanNotificationIntentMappingSnapshot,
        label: String
    ) async throws {
        do {
            _ = try await store.stageVerifiedLegacyExport(data(value), mappings: mappings)
            preconditionFailure("Accepted unsafe intent stage: \(label)")
        } catch let received as NativePlanNotificationIntentError {
            expect(received == expected, "Wrong rejection for \(label): \(received)")
        }
    }

    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("native-plan-notification-intent-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let sourceObject = source()
        let sourceBytes = try data(sourceObject)
        let sourceAgenda = try agenda(from: sourceObject)
        let copy = nativeCopy(sourceAgenda.plans[0])
        let verifiedPlanArchive = try verifiedArchive(copy: copy, agenda: sourceAgenda)
        let verifiedMappings = mappings(archive: verifiedPlanArchive, places: nativePlaces())
        let store = NativePlanNotificationIntentStore(directory: root.appendingPathComponent("stage", isDirectory: true))

        expect(NativeLegacySourceScope.remoteProduction.scopedDirectory(from: root) == root &&
               NativeLegacySourceScope.localDevelopment.scopedDirectory(from: root) != root,
               "Local development and production must have physically separate P0 directories")

        // Historical IDs are never enough. A P0 mapping must be tied to the
        // exact native copy receipt created by the explicit Plan handoff.
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: store,
            source: sourceObject,
            mappings: mappings(archive: archiveWithoutReceipt(copy: copy), places: nativePlaces()),
            label: "historical imported ID with no explicit handoff receipt"
        )
        let wrongReceiptScope = try verifiedArchive(
            copy: copy,
            agenda: sourceAgenda,
            receiptScope: .localDevelopment
        )
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: store,
            source: sourceObject,
            mappings: mappings(archive: wrongReceiptScope, places: nativePlaces()),
            label: "receipt from another Local/Production source"
        )
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: store,
            source: source(capturedAt: laterCapture),
            mappings: verifiedMappings,
            label: "receipt for a different verified explicit handoff source"
        )
        let localStore = NativePlanNotificationIntentStore(
            directory: root.appendingPathComponent("local-stage", isDirectory: true),
            sourceScope: .localDevelopment
        )
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: localStore,
            source: sourceObject,
            mappings: verifiedMappings,
            label: "production receipt supplied to a Local P0 store"
        )

        // The retained rehearsal source is the only post-WebKit input. It can
        // be captured first, then stage after independent native imports.
        let rehearsalStore = NativePlanMigrationStore(directory: root.appendingPathComponent("rehearsal", isDirectory: true))
        _ = try await rehearsalStore.rehearse(sourceBytes)
        guard let persistedSource = try await rehearsalStore.verifiedLegacyHandoverExport() else {
            preconditionFailure("A verified rehearsal should provide its own strict source")
        }
        let persistedObject = try JSONSerialization.jsonObject(with: persistedSource) as! [String: Any]
        expect(Set(persistedObject.keys) == Set(["version", "owner", "hydration", "capturedAt", "plans", "notificationIntent"]) &&
               persistedObject["owner"] as? String == "legacy",
               "Post-import staging sees only a strict legacy-shaped locally verified source")
        let postImportStore = NativePlanNotificationIntentStore(directory: root.appendingPathComponent("post-import", isDirectory: true))
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: postImportStore,
            source: persistedObject,
            mappings: mappings(archive: NativePlanArchive(), places: nativePlaces()),
            label: "receipt captured before native Plan import"
        )
        let postImport = try await postImportStore.stageVerifiedLegacyExport(persistedSource, mappings: verifiedMappings)
        expect(postImport.owner == "legacy" && postImport.stagingEpoch == 1 && !postImport.isNativeDeliveryActive,
               "A verified persisted receipt stages after native mappings arrive, with legacy still owner")

        // Prove the real sequencing component: capture -> no import ->
        // unowned Places -> verified maps -> revoke on deletion -> restore.
        let sequencedMigrationStore = NativePlanMigrationStore(
            directory: root.appendingPathComponent("sequenced-rehearsal", isDirectory: true)
        )
        let sequencedIntentStore = NativePlanNotificationIntentStore(
            directory: root.appendingPathComponent("sequenced-stage", isDirectory: true)
        )
        let sequencer = NativePlanNotificationIntentStagingCoordinator(
            migrationStore: sequencedMigrationStore,
            intentStore: sequencedIntentStore
        )
        let capturedBeforeImport = await sequencer.captureVerifiedLegacyHandover(
            sourceBytes,
            mappings: mappings(archive: NativePlanArchive(), places: nil)
        )
        expect(capturedBeforeImport == .unavailable,
               "A receipt captured before native imports remains unavailable rather than creating a partial stage")
        let unownedOutcome = await sequencer.updateMappings(
            mappings(archive: verifiedPlanArchive, places: nativePlaces(owner: "legacy"))
        )
        let stageAfterUnownedPlaces = try await sequencedIntentStore.stagedIntent()
        expect(unownedOutcome == .unavailable && stageAfterUnownedPlaces == nil,
               "A copied plan with unowned Places cannot stage a notification intent")
        guard case .staged(let initialSequence) = await sequencer.updateMappings(verifiedMappings) else {
            preconditionFailure("Verified native Plan and Places mappings should stage the retained receipt")
        }
        expect(initialSequence.owner == "legacy" && initialSequence.stagingEpoch == 1,
               "The delayed sequence creates a local legacy-only stage")

        var planDeletedArchive = verifiedPlanArchive
        planDeletedArchive.plans = []
        let deletedPlanOutcome = await sequencer.updateMappings(
            mappings(archive: planDeletedArchive, places: nativePlaces())
        )
        let stageAfterPlanDeletion = try await sequencedIntentStore.stagedIntent()
        let readinessAfterPlanDeletion = try await sequencedIntentStore.readiness()
        expect(deletedPlanOutcome == .unavailable && stageAfterPlanDeletion == nil &&
               readinessAfterPlanDeletion == .unavailable,
               "Deleting a selected native Plan revokes the stale local receipt")
        guard case .staged(let planRestored) = await sequencer.updateMappings(verifiedMappings) else {
            preconditionFailure("Restoring verified current mappings should re-stage locally")
        }
        expect(planRestored.stagingEpoch > initialSequence.stagingEpoch,
               "A revocation never lets the local staging epoch reset")

        let deletedPlaceOutcome = await sequencer.updateMappings(
            mappings(archive: verifiedPlanArchive, places: nativePlaces(includeHome: false))
        )
        let stageAfterPlaceDeletion = try await sequencedIntentStore.stagedIntent()
        expect(deletedPlaceOutcome == .unavailable && stageAfterPlaceDeletion == nil,
               "Deleting a selected native saved place revokes the stale local receipt")
        guard case .staged(let placeRestored) = await sequencer.updateMappings(verifiedMappings) else {
            preconditionFailure("Restoring the exact verified saved place should allow a new local stage")
        }
        guard case .staged(let repeatedReport) = await sequencer.updateMappings(verifiedMappings) else {
            preconditionFailure("A repeated verified local state should remain stageable")
        }
        expect(placeRestored.stagingEpoch > planRestored.stagingEpoch &&
               repeatedReport.unchanged && repeatedReport.stagingEpoch == placeRestored.stagingEpoch,
               "The coordinator revokes stale state and remains idempotent after restoration")

        // P0 v3 treats an edited native copy as a new semantic target even
        // when its identifier is unchanged. It must revoke the old receipt
        // rather than leave a later delivery review a narrow semantic race.
        let editedCopy = nativeCopy(sourceAgenda.plans[0], title: "Soccer practice moved")
        let editedArchive = try verifiedArchive(copy: editedCopy, agenda: sourceAgenda)
        let semanticDriftOutcome = await sequencer.updateMappings(
            mappings(archive: editedArchive, places: nativePlaces())
        )
        let stageAfterSemanticDrift = try await sequencedIntentStore.stagedIntent()
        expect(semanticDriftOutcome == .unavailable && stageAfterSemanticDrift == nil,
               "An edited selected native Plan revokes the v3 semantic receipt")
        guard case .staged(let semanticRestored) = await sequencer.updateMappings(verifiedMappings) else {
            preconditionFailure("Restoring the exact selected native Plan semantics should re-stage locally")
        }
        expect(semanticRestored.stagingEpoch > placeRestored.stagingEpoch,
               "A semantic-drift revocation preserves P0's monotonic stage epoch")

        let first = try await store.stageVerifiedLegacyExport(sourceBytes, mappings: verifiedMappings)
        expect(first.owner == "legacy" && first.stagingEpoch == 1 && !first.unchanged,
               "The first complete receipt begins a local legacy-owned staging epoch")
        let firstStage = try await store.stagedIntent()
        expect(firstStage?.schemaVersion == 3 &&
               firstStage?.minReaderVersion == 3 &&
               firstStage?.minWriterVersion == 3 &&
               firstStage?.planMappings.first?.semanticDigest == verifiedMappings.planCopies["plan-home"]?.semanticDigest,
               "P0 v3 must pin the exact selected native Plan semantics in its receipt")
        let disabled = try await store.stageVerifiedLegacyExport(
            data(source(globalPreference: "disabled", placeNotificationsEnabled: false)),
            mappings: verifiedMappings
        )
        expect(disabled.stagingEpoch == 2 && disabled.globalPreference == .disabled && !disabled.placeNotificationsEnabled,
               "Selection and opt-out semantics survive without claiming native delivery")

        // Default places cannot be guessed from an unversioned source list.
        // They bind to concrete IDs and the native Places revision that made
        // that implicit default meaningful.
        let defaultSource = source(
            globalPreference: "off",
            selectedPlaceIDs: [],
            placeSelectionMode: "default"
        )
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: store,
            source: defaultSource,
            mappings: verifiedMappings,
            label: "default places without a pinned native Places revision"
        )
        let defaultV1 = mappings(archive: verifiedPlanArchive, snapshot: ownedPlacesSnapshot(revision: 1))
        let defaultStage = try await store.stageVerifiedLegacyExport(data(defaultSource), mappings: defaultV1)
        let storedDefaultV1 = try await store.stagedIntent()
        expect(defaultStage.stagingEpoch == 3 &&
               storedDefaultV1?.defaultPlaceBinding?.nativePlaceIDs == ["custom:home"] &&
               storedDefaultV1?.defaultPlaceBinding?.nativePlacesRevision == 1,
               "A default selection pins concrete native IDs and its verified Places revision")
        let defaultV2 = mappings(archive: verifiedPlanArchive, snapshot: ownedPlacesSnapshot(revision: 2))
        let revalidatedDefault = try await store.stageVerifiedLegacyExport(data(defaultSource), mappings: defaultV2)
        let storedDefaultV2 = try await store.stagedIntent()
        expect(revalidatedDefault.stagingEpoch == 4 &&
               storedDefaultV2?.defaultPlaceBinding?.nativePlacesRevision == 2,
               "A changed native Places revision must revalidate the pinned default rather than silently reuse it")

        // Regression: if the primary is damaged but a validated backup exists,
        // the next save must preserve the validated backup bytes—not overwrite
        // it with corrupt primary content.
        let recoveryStore = NativePlanNotificationIntentStore(directory: root.appendingPathComponent("recovery", isDirectory: true))
        _ = try await recoveryStore.stageVerifiedLegacyExport(sourceBytes, mappings: verifiedMappings)
        _ = try await recoveryStore.stageVerifiedLegacyExport(
            data(source(globalPreference: "disabled")),
            mappings: verifiedMappings
        )
        let recoveryPrimary = root.appendingPathComponent("recovery/notification-intent-stage.v1.json")
        try Data("corrupt-primary".utf8).write(to: recoveryPrimary)
        _ = try await recoveryStore.stageVerifiedLegacyExport(
            data(source(globalPreference: "off")),
            mappings: verifiedMappings
        )
        try Data("corrupt-primary-again".utf8).write(to: recoveryPrimary)
        let recoveredStage = try await recoveryStore.stagedIntent()
        expect(recoveredStage?.notificationIntent.globalPreference == .enabled,
               "A later recovery preserves validated backup bytes after a corrupt primary")

        // A valid v2 receipt has no per-plan semantic pin, so ordinary reads
        // fail closed. It can only be replaced when the retained legacy
        // handover is freshly verified against current Plan/Places mappings.
        let v2Directory = root.appendingPathComponent("v2-restage", isDirectory: true)
        let v2Store = NativePlanNotificationIntentStore(directory: v2Directory)
        _ = try await v2Store.stageVerifiedLegacyExport(sourceBytes, mappings: verifiedMappings)
        let v2Primary = v2Directory.appendingPathComponent("notification-intent-stage.v1.json")
        let v2Bytes = try validV2StageBytes(from: Data(contentsOf: v2Primary))
        try v2Bytes.write(to: v2Primary)
        do {
            _ = try await v2Store.stagedIntent()
            preconditionFailure("A v2 P0 stage must not remain readable")
        } catch let error as NativePlanNotificationIntentError {
            expect(error == .unsupportedStoreVersion,
                   "A v2 P0 stage must fail closed rather than become reviewable")
        }
        try await expectRejected(
            .nativeMappingsUnavailable,
            store: v2Store,
            source: sourceObject,
            mappings: mappings(archive: archiveWithoutReceipt(copy: copy), places: nativePlaces()),
            label: "v2 restage without current explicit native Plan evidence"
        )
        expect(try Data(contentsOf: v2Primary) == v2Bytes,
               "Incomplete current mappings must not overwrite an unsupported v2 receipt")
        try await expectRejected(
            .staleExport,
            store: v2Store,
            source: source(globalPreference: "off"),
            mappings: verifiedMappings,
            label: "same-capture v2 restage with a different retained source"
        )
        expect(try Data(contentsOf: v2Primary) == v2Bytes,
               "A non-identical same-capture retained source must not overwrite v2")
        let v3Restage = try await v2Store.stageVerifiedLegacyExport(sourceBytes, mappings: verifiedMappings)
        let v3RestagedStage = try await v2Store.stagedIntent()
        expect(v3Restage.stagingEpoch == 2 &&
               v3RestagedStage?.schemaVersion == 3 &&
               v3RestagedStage?.planMappings.first?.semanticDigest == verifiedMappings.planCopies["plan-home"]?.semanticDigest,
               "A fresh retained source creates a new v3 semantic receipt after v2")
        expect(!FileManager.default.fileExists(atPath: v2Directory
            .appendingPathComponent("notification-intent-stage.previous.json").path),
               "A protocol-incompatible v2 stage must never become a v3 fallback backup")

        let staged = try await store.stagedIntent()
        expect(staged?.owner == "legacy" && staged?.sourceScope == .remoteProduction,
               "P0 cannot claim native delivery ownership or blur its source scope")
        let storedText = String(decoding: try JSONEncoder().encode(staged), as: UTF8.self)
        for forbidden in ["apns", "token", "subscription", "permission", "watch", "widget", "http"] {
            expect(!storedText.lowercased().contains(forbidden), "P0 receipt has no \(forbidden) delivery state")
        }

        let primary = root.appendingPathComponent("stage/notification-intent-stage.v1.json")
        try Data("{\"owner\":\"native\"}".utf8).write(to: primary)
        do {
            _ = try await store.readiness()
            preconditionFailure("A future native owner was overwritten by legacy staging")
        } catch let error as NativePlanNotificationIntentError {
            expect(error == .unsupportedStoreVersion, "A non-legacy owner is a hard P0 fence")
        }

        print("PASS Native Plan notification intent: source-scoped explicit provenance, delayed local staging, revocation, default-place revalidation, monotonic epochs, and no delivery ownership")
    }
}
