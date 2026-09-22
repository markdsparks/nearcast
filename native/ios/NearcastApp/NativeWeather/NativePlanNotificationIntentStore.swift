import Foundation
import CryptoKit
import CoreFoundation
import Darwin

/// The stable, user-visible choice from the legacy Plans notification UI.
///
/// This is deliberately separate from operating-system permission and delivery
/// registration. In particular, `.enabled` means the person previously chose
/// notifications in legacy Plans; it never means native delivery is active.
enum NativePlanNotificationPreference: String, Codable, Equatable, Sendable {
    case enabled
    case off
    case disabled
}

/// Legacy Places distinguishes a deliberate explicit empty selection from the
/// implicit saved-place default. Native must retain that distinction even while
/// it is only staging an eventual handoff.
enum NativePlanNotificationPlaceSelectionMode: String, Codable, Equatable, Sendable {
    case explicit
    case `default`
}

struct NativePlanNotificationIntentSnapshot: Codable, Equatable, Sendable {
    let hydration: String
    let globalPreference: NativePlanNotificationPreference
    let selectedPlanIDs: [String]
    let placeNotificationsEnabled: Bool
    let selectedPlaceIDs: [String]
    let placeSelectionMode: NativePlanNotificationPlaceSelectionMode
}

struct NativePlanNotificationPlanMapping: Codable, Equatable, Sendable {
    let legacyID: String
    let nativePlanID: String
    /// P0 pins the source-verified semantics of the exact native Plan copy.
    /// Identity alone is not enough: an edited copy must require a fresh
    /// verified stage before any later delivery-transfer review can proceed.
    let semanticDigest: String
}

struct NativePlanNotificationPlaceMapping: Codable, Equatable, Sendable {
    let legacyID: String
    let nativePlaceID: String
}

/// The resolved meaning of a legacy default-place selection at one verified
/// native Places revision.  Legacy default means “the first saved places at
/// that time,” so P0 must pin that concrete set rather than later treating a
/// reordered/deleted list as the same selection.
struct NativePlanNotificationDefaultPlaceBinding: Codable, Equatable, Sendable {
    let nativePlaceIDs: [String]
    let nativePlacesRevision: Int
}

/// A strictly local, legacy-owned receipt. It contains no APNs token, network
/// endpoint, worker subscription ID, notification permission, Watch state, or
/// widget state. A later explicit delivery handoff must use a distinct owner
/// epoch and an acknowledged server transaction.
struct NativePlanNotificationIntentStage: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let minReaderVersion: Int
    let minWriterVersion: Int
    let owner: String
    var stagingEpoch: Int
    let sourceScope: NativeLegacySourceScope
    let sourceDigest: String
    let sourceCapturedAt: String
    let notificationIntent: NativePlanNotificationIntentSnapshot
    let planMappings: [NativePlanNotificationPlanMapping]
    let placeMappings: [NativePlanNotificationPlaceMapping]
    let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?
    let mappingDigest: String
    /// A revoked receipt is retained only to preserve a monotonic local epoch.
    /// It is intentionally unavailable through `stagedIntent()`/readiness.
    var isRevoked: Bool
    var receiptDigest: String

    enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, minReaderVersion, minWriterVersion, owner, stagingEpoch
        case sourceScope, sourceDigest, sourceCapturedAt, notificationIntent
        case planMappings, placeMappings, defaultPlaceBinding, mappingDigest
        case isRevoked, receiptDigest
    }

    /// The durable receipt is a complete-envelope protocol. Swift's
    /// synthesized encoder drops `nil` optionals, which would make an
    /// explicit-place receipt fail the exact-key reader on its next load.
    /// Encode the null deliberately so the signed JSON shape stays stable.
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(schemaVersion, forKey: .schemaVersion)
        try values.encode(minReaderVersion, forKey: .minReaderVersion)
        try values.encode(minWriterVersion, forKey: .minWriterVersion)
        try values.encode(owner, forKey: .owner)
        try values.encode(stagingEpoch, forKey: .stagingEpoch)
        try values.encode(sourceScope, forKey: .sourceScope)
        try values.encode(sourceDigest, forKey: .sourceDigest)
        try values.encode(sourceCapturedAt, forKey: .sourceCapturedAt)
        try values.encode(notificationIntent, forKey: .notificationIntent)
        try values.encode(planMappings, forKey: .planMappings)
        try values.encode(placeMappings, forKey: .placeMappings)
        try values.encode(defaultPlaceBinding, forKey: .defaultPlaceBinding)
        try values.encode(mappingDigest, forKey: .mappingDigest)
        try values.encode(isRevoked, forKey: .isRevoked)
        try values.encode(receiptDigest, forKey: .receiptDigest)
    }
}

/// Small, safe-to-render readiness data for a future native Plans surface.
/// It intentionally cannot be interpreted as "notifications are ready".
struct NativePlanNotificationIntentStageReport: Codable, Equatable, Sendable {
    let owner: String
    let stagingEpoch: Int
    let sourceScope: NativeLegacySourceScope
    let sourceCapturedAt: String
    let globalPreference: NativePlanNotificationPreference
    let selectedPlanCount: Int
    let placeNotificationsEnabled: Bool
    let selectedPlaceCount: Int
    let placeSelectionMode: NativePlanNotificationPlaceSelectionMode
    let unchanged: Bool

    var isNativeDeliveryActive: Bool { false }
}

enum NativePlanNotificationIntentReadiness: Equatable, Sendable {
    case unavailable
    case staged(NativePlanNotificationIntentStageReport)
}

enum NativePlanNotificationIntentError: Error, LocalizedError, Equatable, Sendable {
    case invalidExport
    case unsupportedExport
    case staleExport
    case nativeMappingsUnavailable
    case invalidStore
    case unsupportedStoreVersion
    case storageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidExport:
            return "The Plans notification choices could not be verified. Existing Plans still owns alerts."
        case .unsupportedExport:
            return "This Plans notification handoff needs a newer Nearcast reader. Existing Plans still owns alerts."
        case .staleExport:
            return "An older Plans notification handoff was ignored. Existing Plans still owns alerts."
        case .nativeMappingsUnavailable:
            return "Nearcast could not verify every selected native plan or saved place. Existing Plans still owns alerts."
        case .invalidStore:
            return "The staged Plans notification choices could not be verified. Existing Plans still owns alerts."
        case .unsupportedStoreVersion:
            return "This staged Plans notification handoff is not compatible with this Nearcast reader. Existing Plans was not changed."
        case .storageUnavailable:
            return "Nearcast could not safely save the staged Plans notification choices. Existing Plans still owns alerts."
        }
    }
}

/// An immutable mapping snapshot supplied by existing native archives. The
/// store never opens or mutates those archives. This keeps P0 isolated from
/// the native Plan library and Places owner while still refusing to stage an
/// unresolvable legacy selection.
struct NativePlanNotificationIntentMappingSnapshot: Codable, Equatable, Sendable {
    struct PlanCopy: Codable, Equatable, Sendable {
        let nativePlanID: String
        let semanticDigest: String
    }

    let planCopies: [String: PlanCopy]
    let nativePlanHandoff: NativePlanLegacyHandoffReceipt?
    let sourceScope: NativeLegacySourceScope
    let nativePlaceIDsByLegacyID: [String: String]
    let nativePlacesVerified: Bool
    let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?

    /// An older call site can validate explicit saved-place IDs with this
    /// initializer, but cannot pin a default selection because it has no
    /// native Places revision. Default mode therefore remains unavailable.
    init(
        planArchive: NativePlanArchive,
        nativePlaces: NativePlacesSource?,
        sourceScope: NativeLegacySourceScope = .remoteProduction
    ) {
        self.init(planArchive: planArchive, nativePlacesSnapshot: nil,
                  fallbackNativePlaces: nativePlaces, sourceScope: sourceScope)
    }

    init(
        planArchive: NativePlanArchive,
        nativePlacesSnapshot: NativePlacesOwnerSnapshot?,
        sourceScope: NativeLegacySourceScope
    ) {
        self.init(planArchive: planArchive, nativePlacesSnapshot: nativePlacesSnapshot,
                  fallbackNativePlaces: nil, sourceScope: sourceScope)
    }

    private init(
        planArchive: NativePlanArchive,
        nativePlacesSnapshot: NativePlacesOwnerSnapshot?,
        fallbackNativePlaces: NativePlacesSource?,
        sourceScope: NativeLegacySourceScope
    ) {
        var copies: [String: PlanCopy] = [:]
        let plansByID = Dictionary(uniqueKeysWithValues: planArchive.plans.map { ($0.id, $0) })
        for (legacyID, nativeID) in planArchive.importedIDs {
            guard NativePlanNotificationIntentStore.validIdentifier(legacyID),
                  NativePlanNotificationIntentStore.validIdentifier(nativeID),
                  let plan = plansByID[nativeID],
                  let semanticDigest = NativePlanNotificationIntentSemantics.planDigest(plan) else {
                continue
            }
            copies[legacyID] = PlanCopy(nativePlanID: nativeID, semanticDigest: semanticDigest)
        }

        let nativePlaces = nativePlacesSnapshot?.source ?? fallbackNativePlaces
        let verifiedPlaces = nativePlaces?.owner == "native" && nativePlaces?.hydration == "ready" && nativePlaces?.isValid == true
        var places: [String: String] = [:]
        if verifiedPlaces, let nativePlaces {
            // Native Places currently retains compatible saved-place IDs. Do
            // not infer a renamed/translated identity from proximity or text.
            for place in nativePlaces.savedPlaces where place.isValid && NativePlanNotificationIntentStore.validIdentifier(place.id) {
                places[place.id] = place.id
            }
        }
        planCopies = copies
        nativePlanHandoff = planArchive.legacyHandoff
        self.sourceScope = sourceScope
        nativePlaceIDsByLegacyID = places
        nativePlacesVerified = verifiedPlaces
        if verifiedPlaces, let snapshot = nativePlacesSnapshot, snapshot.revision > 0,
           let nativePlaces {
            let ids = nativePlaces.savedPlaces.prefix(NativePlanNotificationIntentStore.maximumSelectedPlaces)
                .map(\.id)
            defaultPlaceBinding = NativePlanNotificationDefaultPlaceBinding(
                nativePlaceIDs: ids,
                nativePlacesRevision: snapshot.revision
            )
        } else {
            defaultPlaceBinding = nil
        }
    }
}

/// Stages a complete, verified legacy notification selection for a later,
/// explicit native delivery handoff. This actor has no APNs, URLSession,
/// UserNotifications, WatchConnectivity, WidgetKit, or worker dependency.
///
/// It never activates native ownership. Every stored envelope remains
/// `owner: "legacy"`; a future native owner must be a separate protocol and
/// must not reuse this writer to overwrite a later owner record.
actor NativePlanNotificationIntentStore {
    nonisolated static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Nearcast/NativePlanNotificationIntent", isDirectory: true)
            .resolvingSymlinksInPath()
    }

    private static let primaryName = "notification-intent-stage.v1.json"
    private static let backupName = "notification-intent-stage.previous.json"
    /// Version 3 adds the per-Plan semantic digest that closes the gap between
    /// identity mapping and a later transfer review. Version 2 stages are
    /// deliberately unsupported for review: they remain legacy-owned, and a
    /// retained verified legacy handover can create a fresh v3 stage later.
    private static let schemaVersion = 3
    private static let maximumExportBytes = 160 * 1_024
    private static let maximumStoredBytes = 512 * 1_024
    fileprivate static let maximumSelectedPlans = 3
    fileprivate static let maximumSelectedPlaces = 3

    private let directory: URL
    private let sourceScope: NativeLegacySourceScope

    init(
        directory: URL = NativePlanNotificationIntentStore.defaultDirectory,
        sourceScope: NativeLegacySourceScope = .remoteProduction
    ) {
        self.directory = directory
        self.sourceScope = sourceScope
    }

    /// Validates the *complete* legacy export, verifies every preserved
    /// selected ID against native copies/Places, and durably stages a
    /// legacy-owned receipt. No notification state outside this directory is
    /// changed.
    @discardableResult
    func stageVerifiedLegacyExport(
        _ data: Data,
        mappings: NativePlanNotificationIntentMappingSnapshot
    ) throws -> NativePlanNotificationIntentStageReport {
        let source = try Self.decodeLegacyExport(data)
        let resolvedMappings = try Self.resolveMappings(source: source, mappings: mappings, sourceScope: sourceScope)
        let sourceDigest = try Self.digest(SemanticSource(plans: source.agenda.plans, notificationIntent: source.intent))
        let mappingDigest = try Self.digest(MappingSemanticSource(planMappings: resolvedMappings.planMappings,
                                                                   placeMappings: resolvedMappings.placeMappings,
                                                                   defaultPlaceBinding: resolvedMappings.defaultPlaceBinding,
                                                                   sourceScope: sourceScope))

        return try withStoreLock {
            // v2 receipts are never readable or reviewable. A fresh,
            // independently verified retained legacy handover is the only
            // path allowed to replace one with v3, retaining its monotonic
            // epoch only. A v2 backup must never become a later fallback.
            let previous: Stored?
            let legacyV2: LegacyV2Stored?
            do {
                previous = try load()
                legacyV2 = nil
            } catch NativePlanNotificationIntentError.unsupportedStoreVersion {
                guard let recoveredV2 = try loadLegacyV2PrimaryForRestage() else {
                    throw NativePlanNotificationIntentError.unsupportedStoreVersion
                }
                previous = nil
                legacyV2 = recoveredV2
            }
            let previousCapture = previous?.stage.sourceCapturedAt ?? legacyV2?.stage.sourceCapturedAt
            if let previousCapture, source.capturedAt < previousCapture {
                throw NativePlanNotificationIntentError.staleExport
            }
            if let legacyV2,
               source.capturedAt == legacyV2.stage.sourceCapturedAt,
               sourceDigest != legacyV2.stage.sourceDigest {
                throw NativePlanNotificationIntentError.staleExport
            }

            let unchanged = previous?.stage.sourceDigest == sourceDigest &&
                previous?.stage.mappingDigest == mappingDigest &&
                previous?.stage.sourceScope == sourceScope &&
                previous?.stage.isRevoked == false
            if let previous, unchanged, previous.stage.sourceCapturedAt == source.capturedAt {
                return Self.report(previous.stage, unchanged: true)
            }

            let previousEpoch = previous?.stage.stagingEpoch ?? legacyV2?.stage.stagingEpoch ?? 0
            guard previousEpoch < Int.max else { throw NativePlanNotificationIntentError.invalidStore }
            var next = NativePlanNotificationIntentStage(
                schemaVersion: Self.schemaVersion,
                minReaderVersion: Self.schemaVersion,
                minWriterVersion: Self.schemaVersion,
                owner: "legacy",
                stagingEpoch: unchanged ? previousEpoch : previousEpoch + 1,
                sourceScope: sourceScope,
                sourceDigest: sourceDigest,
                sourceCapturedAt: source.capturedAt,
                notificationIntent: source.intent,
                planMappings: resolvedMappings.planMappings,
                placeMappings: resolvedMappings.placeMappings,
                defaultPlaceBinding: resolvedMappings.defaultPlaceBinding,
                mappingDigest: mappingDigest,
                isRevoked: false,
                receiptDigest: ""
            )
            next.receiptDigest = try Self.digest(next)
            try save(next, previousBytes: previous?.bytes)
            return Self.report(next, unchanged: unchanged)
        }
    }

    func stagedIntent() throws -> NativePlanNotificationIntentStage? {
        try withStoreLock {
            guard let stage = try load()?.stage, !stage.isRevoked else { return nil }
            return stage
        }
    }

    func readiness() throws -> NativePlanNotificationIntentReadiness {
        try withStoreLock {
            guard let stage = try load()?.stage, !stage.isRevoked else { return .unavailable }
            return .staged(Self.report(stage, unchanged: true))
        }
    }

    /// Revokes only the exact receipt the caller observed.  This is a local
    /// availability transition—not notification cleanup—and retains a signed
    /// tombstone so a future re-stage cannot reset the epoch back to one.
    @discardableResult
    func revokeStagedIntent(matchingReceiptDigest receiptDigest: String) throws -> Bool {
        guard Self.validDigest(receiptDigest) else { return false }
        return try withStoreLock {
            guard let previous = try load(),
                  previous.stage.receiptDigest == receiptDigest,
                  !previous.stage.isRevoked else {
                return false
            }
            guard previous.stage.stagingEpoch < Int.max else {
                throw NativePlanNotificationIntentError.invalidStore
            }
            var revoked = previous.stage
            revoked.stagingEpoch += 1
            revoked.isRevoked = true
            revoked.receiptDigest = ""
            revoked.receiptDigest = try Self.digest(revoked)
            try save(revoked, previousBytes: previous.bytes)
            return true
        }
    }

    // MARK: - Frozen legacy input

    private struct LegacySource {
        let capturedAt: String
        let agenda: NativeAgenda
        let intent: NativePlanNotificationIntentSnapshot
    }

    private struct SemanticSource: Codable {
        let plans: [NativeAgendaPlan]
        let notificationIntent: NativePlanNotificationIntentSnapshot
    }

    private struct MappingSemanticSource: Codable {
        let planMappings: [NativePlanNotificationPlanMapping]
        let placeMappings: [NativePlanNotificationPlaceMapping]
        let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?
        let sourceScope: NativeLegacySourceScope
    }

    private struct ResolvedMappings {
        let planMappings: [NativePlanNotificationPlanMapping]
        let placeMappings: [NativePlanNotificationPlaceMapping]
        let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?
    }

    private struct Stored {
        let stage: NativePlanNotificationIntentStage
        let bytes: Data
    }

    /// This is intentionally only a migration reader. It is never surfaced
    /// to readiness/review and cannot create a delivery draft. Its job is to
    /// retain the old monotonic epoch while a fresh verified legacy handover
    /// replaces an otherwise unsupported v2 receipt with a v3 receipt.
    private struct LegacyV2PlanMapping: Codable, Equatable {
        let legacyID: String
        let nativePlanID: String
    }

    private struct LegacyV2Stage: Codable, Equatable {
        let schemaVersion: Int
        let minReaderVersion: Int
        let minWriterVersion: Int
        let owner: String
        let stagingEpoch: Int
        let sourceScope: NativeLegacySourceScope
        let sourceDigest: String
        let sourceCapturedAt: String
        let notificationIntent: NativePlanNotificationIntentSnapshot
        let planMappings: [LegacyV2PlanMapping]
        let placeMappings: [NativePlanNotificationPlaceMapping]
        let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?
        let mappingDigest: String
        let isRevoked: Bool
        var receiptDigest: String

        enum CodingKeys: String, CodingKey, CaseIterable {
            case schemaVersion, minReaderVersion, minWriterVersion, owner, stagingEpoch
            case sourceScope, sourceDigest, sourceCapturedAt, notificationIntent
            case planMappings, placeMappings, defaultPlaceBinding, mappingDigest
            case isRevoked, receiptDigest
        }

        /// Match the v2 durable envelope exactly, including an explicit null
        /// default binding, so its old receipt digest can be verified before
        /// we preserve its epoch/history for a fresh v3 restage.
        func encode(to encoder: Encoder) throws {
            var values = encoder.container(keyedBy: CodingKeys.self)
            try values.encode(schemaVersion, forKey: .schemaVersion)
            try values.encode(minReaderVersion, forKey: .minReaderVersion)
            try values.encode(minWriterVersion, forKey: .minWriterVersion)
            try values.encode(owner, forKey: .owner)
            try values.encode(stagingEpoch, forKey: .stagingEpoch)
            try values.encode(sourceScope, forKey: .sourceScope)
            try values.encode(sourceDigest, forKey: .sourceDigest)
            try values.encode(sourceCapturedAt, forKey: .sourceCapturedAt)
            try values.encode(notificationIntent, forKey: .notificationIntent)
            try values.encode(planMappings, forKey: .planMappings)
            try values.encode(placeMappings, forKey: .placeMappings)
            try values.encode(defaultPlaceBinding, forKey: .defaultPlaceBinding)
            try values.encode(mappingDigest, forKey: .mappingDigest)
            try values.encode(isRevoked, forKey: .isRevoked)
            try values.encode(receiptDigest, forKey: .receiptDigest)
        }
    }

    private struct LegacyV2Stored {
        let stage: LegacyV2Stage
    }

    private struct LegacyV2MappingSemanticSource: Codable {
        let planMappings: [LegacyV2PlanMapping]
        let placeMappings: [NativePlanNotificationPlaceMapping]
        let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?
        let sourceScope: NativeLegacySourceScope
    }

    private static func decodeLegacyExport(_ data: Data) throws -> LegacySource {
        guard !data.isEmpty, data.count <= maximumExportBytes,
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NativePlanNotificationIntentError.invalidExport
        }
        try exactKeys(raw, ["version", "owner", "hydration", "capturedAt", "plans", "notificationIntent"], error: .unsupportedExport)
        guard integer(raw["version"]) == 1,
              raw["owner"] as? String == "legacy",
              raw["hydration"] as? String == "ready",
              let capturedAt = raw["capturedAt"] as? String,
              canonicalCaptureDate(capturedAt) != nil,
              let plans = raw["plans"] as? [Any], plans.count <= NativeAgendaRepository.maximumPlans,
              let rawIntent = raw["notificationIntent"] as? [String: Any] else {
            throw NativePlanNotificationIntentError.unsupportedExport
        }

        let agendaObject: [String: Any] = [
            "version": raw["version"] as Any,
            "owner": raw["owner"] as Any,
            "hydration": raw["hydration"] as Any,
            "capturedAt": capturedAt,
            "plans": plans
        ]
        let agenda: NativeAgenda
        do {
            agenda = try NativeAgendaRepository().decode(
                JSONSerialization.data(withJSONObject: agendaObject, options: [.sortedKeys, .withoutEscapingSlashes])
            )
        } catch let error as NativeAgendaRepositoryError {
            switch error {
            case .unsupportedExport, .unsupportedPlanSchema:
                throw NativePlanNotificationIntentError.unsupportedExport
            default:
                throw NativePlanNotificationIntentError.invalidExport
            }
        } catch {
            throw NativePlanNotificationIntentError.invalidExport
        }

        let intent = try decodeIntent(rawIntent, validPlanIDs: Set(agenda.plans.map(\.id)))
        return LegacySource(capturedAt: capturedAt, agenda: agenda, intent: intent)
    }

    private static func decodeIntent(
        _ raw: [String: Any],
        validPlanIDs: Set<String>
    ) throws -> NativePlanNotificationIntentSnapshot {
        try exactKeys(raw, ["hydration", "globalPreference", "selectedPlanIDs", "placeNotificationsEnabled", "selectedPlaceIDs", "placeSelectionMode"], error: .invalidExport)
        guard raw["hydration"] as? String == "ready",
              let preferenceText = raw["globalPreference"] as? String,
              let preference = NativePlanNotificationPreference(rawValue: preferenceText),
              let selectedPlans = raw["selectedPlanIDs"] as? [Any],
              let placesEnabled = boolean(raw["placeNotificationsEnabled"]),
              let selectedPlaces = raw["selectedPlaceIDs"] as? [Any],
              let modeText = raw["placeSelectionMode"] as? String,
              let mode = NativePlanNotificationPlaceSelectionMode(rawValue: modeText) else {
            throw NativePlanNotificationIntentError.invalidExport
        }
        let planIDs = try identifiers(selectedPlans, maximum: maximumSelectedPlans)
        let placeIDs = try identifiers(selectedPlaces, maximum: maximumSelectedPlaces)
        guard Set(planIDs).isSubset(of: validPlanIDs), mode != .default || placeIDs.isEmpty else {
            throw NativePlanNotificationIntentError.invalidExport
        }
        return NativePlanNotificationIntentSnapshot(
            hydration: "ready",
            globalPreference: preference,
            selectedPlanIDs: planIDs,
            placeNotificationsEnabled: placesEnabled,
            selectedPlaceIDs: placeIDs,
            placeSelectionMode: mode
        )
    }

    private static func resolveMappings(
        source: LegacySource,
        mappings: NativePlanNotificationIntentMappingSnapshot,
        sourceScope: NativeLegacySourceScope
    ) throws -> ResolvedMappings {
        // Historical imported IDs are never sufficient evidence: the active
        // native archive must carry the exact source-scoped receipt created by
        // the explicit user-approved schedule handoff.
        guard mappings.sourceScope == sourceScope,
              let nativeHandoff = mappings.nativePlanHandoff,
              NativePlanLibrary.legacyHandoffMatches(nativeHandoff, agenda: source.agenda, sourceScope: sourceScope) else {
            throw NativePlanNotificationIntentError.nativeMappingsUnavailable
        }
        var resolvedPlans: [NativePlanNotificationPlanMapping] = []
        let sourcePlans = Dictionary(uniqueKeysWithValues: source.agenda.plans.map { ($0.id, $0) })
        for legacyID in source.intent.selectedPlanIDs {
            guard let sourcePlan = sourcePlans[legacyID],
                  let copy = mappings.planCopies[legacyID],
                  validIdentifier(copy.nativePlanID),
                  validDigest(copy.semanticDigest),
                  copy.semanticDigest == NativePlanNotificationIntentSemantics.planDigest(sourcePlan) else {
                throw NativePlanNotificationIntentError.nativeMappingsUnavailable
            }
            resolvedPlans.append(.init(
                legacyID: legacyID,
                nativePlanID: copy.nativePlanID,
                semanticDigest: copy.semanticDigest
            ))
        }

        var resolvedPlaces: [NativePlanNotificationPlaceMapping] = []
        let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?
        switch source.intent.placeSelectionMode {
        case .explicit:
            let needsNativePlaces = source.intent.placeNotificationsEnabled || !source.intent.selectedPlaceIDs.isEmpty
            guard !needsNativePlaces || mappings.nativePlacesVerified else {
                throw NativePlanNotificationIntentError.nativeMappingsUnavailable
            }
            for legacyID in source.intent.selectedPlaceIDs {
                guard let nativeID = mappings.nativePlaceIDsByLegacyID[legacyID],
                      validIdentifier(nativeID) else {
                    throw NativePlanNotificationIntentError.nativeMappingsUnavailable
                }
                resolvedPlaces.append(.init(legacyID: legacyID, nativePlaceID: nativeID))
            }
            defaultPlaceBinding = nil
        case .default:
            // A default selection must be tied to concrete native saved-place
            // IDs *and* the exact native revision that supplied their order.
            // A source-only snapshot is insufficient because it cannot prove
            // that a later Places mutation did not alter the default set.
            guard mappings.nativePlacesVerified,
                  let binding = mappings.defaultPlaceBinding,
                  validDefaultPlaceBinding(binding) else {
                throw NativePlanNotificationIntentError.nativeMappingsUnavailable
            }
            defaultPlaceBinding = binding
        }
        return ResolvedMappings(planMappings: resolvedPlans, placeMappings: resolvedPlaces,
                                defaultPlaceBinding: defaultPlaceBinding)
    }

    // MARK: - Durable local staging

    private func load() throws -> Stored? {
        var invalidPrimary = false
        do {
            if let bytes = try readFile(Self.primaryName) {
                do { return Stored(stage: try Self.decodeStage(bytes), bytes: bytes) }
                catch NativePlanNotificationIntentError.unsupportedStoreVersion {
                    throw NativePlanNotificationIntentError.unsupportedStoreVersion
                } catch { invalidPrimary = true }
            }
        } catch NativePlanNotificationIntentError.invalidStore {
            invalidPrimary = true
        } catch {
            throw error
        }
        do {
            if let backup = try readFile(Self.backupName) {
                return Stored(stage: try Self.decodeStage(backup), bytes: backup)
            }
        } catch NativePlanNotificationIntentError.unsupportedStoreVersion {
            throw NativePlanNotificationIntentError.unsupportedStoreVersion
        } catch NativePlanNotificationIntentError.invalidStore {
            throw NativePlanNotificationIntentError.invalidStore
        } catch {
            throw error
        }
        if invalidPrimary { throw NativePlanNotificationIntentError.invalidStore }
        return nil
    }

    /// Returns a verified, local v2 receipt only for a fresh v3 restage. This
    /// intentionally reads the current primary only: a backup is historical
    /// data and must never become an implicit current source or fallback.
    private func loadLegacyV2PrimaryForRestage() throws -> LegacyV2Stored? {
        guard let bytes = try readFile(Self.primaryName) else { return nil }
        let stage = try Self.decodeLegacyV2Stage(bytes)
        guard stage.sourceScope == sourceScope else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        return LegacyV2Stored(stage: stage)
    }

    private func save(_ stage: NativePlanNotificationIntentStage, previousBytes: Data?) throws {
        let bytes = try Self.encode(stage)
        guard bytes.count <= Self.maximumStoredBytes, try Self.decodeStage(bytes) == stage else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        if let previousBytes {
            // If the primary was corrupt but a validated backup was recovered,
            // preserve those validated bytes—not the corrupt primary—as the
            // next backup before committing this new stage. A v2 receipt is
            // never retained as a fallback for a v3 primary.
            try atomicWrite(previousBytes, name: Self.backupName)
        }
        try atomicWrite(bytes, name: Self.primaryName)
    }

    private static func decodeStage(_ bytes: Data) throws -> NativePlanNotificationIntentStage {
        guard bytes.count <= maximumStoredBytes,
              let raw = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        // Owner is an irreversible fence. Do not recover an earlier legacy
        // backup over a later owner should a future P1 implementation claim it.
        if ["schemaVersion", "minReaderVersion", "minWriterVersion"].contains(where: { (integer(raw[$0]) ?? 0) != Self.schemaVersion }) ||
            (raw["owner"] as? String).map({ $0 != "legacy" }) == true {
            throw NativePlanNotificationIntentError.unsupportedStoreVersion
        }
        try exactKeys(raw, ["schemaVersion", "minReaderVersion", "minWriterVersion", "owner", "stagingEpoch", "sourceScope", "sourceDigest", "sourceCapturedAt", "notificationIntent", "planMappings", "placeMappings", "defaultPlaceBinding", "mappingDigest", "isRevoked", "receiptDigest"], error: .invalidStore)
        let value: NativePlanNotificationIntentStage
        do { value = try JSONDecoder().decode(NativePlanNotificationIntentStage.self, from: bytes) }
        catch { throw NativePlanNotificationIntentError.invalidStore }
        guard validStage(value) else { throw NativePlanNotificationIntentError.invalidStore }
        var unsigned = value
        unsigned.receiptDigest = ""
        guard (try? digest(unsigned)) == value.receiptDigest else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        return value
    }

    /// v2 is deliberately not a readable P0 stage anymore: it lacks a
    /// per-Plan semantic digest. This private verifier exists only to retain
    /// a valid old epoch while `stageVerifiedLegacyExport` creates a fresh v3
    /// receipt from independently verified retained legacy source data.
    private static func decodeLegacyV2Stage(_ bytes: Data) throws -> LegacyV2Stage {
        guard bytes.count <= maximumStoredBytes,
              let raw = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        guard ["schemaVersion", "minReaderVersion", "minWriterVersion"].allSatisfy({ integer(raw[$0]) == 2 }),
              raw["owner"] as? String == "legacy" else {
            throw NativePlanNotificationIntentError.unsupportedStoreVersion
        }
        try exactKeys(raw, ["schemaVersion", "minReaderVersion", "minWriterVersion", "owner", "stagingEpoch", "sourceScope", "sourceDigest", "sourceCapturedAt", "notificationIntent", "planMappings", "placeMappings", "defaultPlaceBinding", "mappingDigest", "isRevoked", "receiptDigest"], error: .invalidStore)
        let value: LegacyV2Stage
        do { value = try JSONDecoder().decode(LegacyV2Stage.self, from: bytes) }
        catch { throw NativePlanNotificationIntentError.invalidStore }
        guard validLegacyV2Stage(value) else { throw NativePlanNotificationIntentError.invalidStore }
        guard (try? digest(LegacyV2MappingSemanticSource(
            planMappings: value.planMappings,
            placeMappings: value.placeMappings,
            defaultPlaceBinding: value.defaultPlaceBinding,
            sourceScope: value.sourceScope
        ))) == value.mappingDigest else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        var unsigned = value
        unsigned.receiptDigest = ""
        guard (try? digest(unsigned)) == value.receiptDigest else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        return value
    }

    private static func validStage(_ value: NativePlanNotificationIntentStage) -> Bool {
        guard value.schemaVersion == Self.schemaVersion,
              value.minReaderVersion == Self.schemaVersion,
              value.minWriterVersion == Self.schemaVersion,
              value.owner == "legacy",
              value.stagingEpoch > 0,
              validDigest(value.sourceDigest),
              validDigest(value.mappingDigest),
              validDigest(value.receiptDigest),
              canonicalCaptureDate(value.sourceCapturedAt) != nil,
              validIntent(value.notificationIntent),
              value.planMappings.count == value.notificationIntent.selectedPlanIDs.count,
              value.placeMappings.count == value.notificationIntent.selectedPlaceIDs.count,
              value.planMappings.map(\.legacyID) == value.notificationIntent.selectedPlanIDs,
              value.placeMappings.map(\.legacyID) == value.notificationIntent.selectedPlaceIDs,
              value.planMappings.allSatisfy({
                  validIdentifier($0.legacyID) &&
                      validIdentifier($0.nativePlanID) &&
                      validDigest($0.semanticDigest)
              }),
              value.placeMappings.allSatisfy({ validIdentifier($0.legacyID) && validIdentifier($0.nativePlaceID) }) else {
            return false
        }
        let defaultBindingValid: Bool
        switch value.notificationIntent.placeSelectionMode {
        case .explicit:
            defaultBindingValid = value.defaultPlaceBinding == nil
        case .default:
            defaultBindingValid = value.placeMappings.isEmpty &&
                value.defaultPlaceBinding.map(validDefaultPlaceBinding) == true
        }
        return defaultBindingValid &&
            Set(value.planMappings.map(\.legacyID)).count == value.planMappings.count &&
            Set(value.planMappings.map(\.nativePlanID)).count == value.planMappings.count &&
            Set(value.placeMappings.map(\.legacyID)).count == value.placeMappings.count &&
            Set(value.placeMappings.map(\.nativePlaceID)).count == value.placeMappings.count
    }

    private static func validLegacyV2Stage(_ value: LegacyV2Stage) -> Bool {
        guard value.schemaVersion == 2,
              value.minReaderVersion == 2,
              value.minWriterVersion == 2,
              value.owner == "legacy",
              value.stagingEpoch > 0,
              validDigest(value.sourceDigest),
              validDigest(value.mappingDigest),
              validDigest(value.receiptDigest),
              canonicalCaptureDate(value.sourceCapturedAt) != nil,
              validIntent(value.notificationIntent),
              value.planMappings.count == value.notificationIntent.selectedPlanIDs.count,
              value.placeMappings.count == value.notificationIntent.selectedPlaceIDs.count,
              value.planMappings.map(\.legacyID) == value.notificationIntent.selectedPlanIDs,
              value.placeMappings.map(\.legacyID) == value.notificationIntent.selectedPlaceIDs,
              value.planMappings.allSatisfy({ validIdentifier($0.legacyID) && validIdentifier($0.nativePlanID) }),
              value.placeMappings.allSatisfy({ validIdentifier($0.legacyID) && validIdentifier($0.nativePlaceID) }) else {
            return false
        }
        let defaultBindingValid: Bool
        switch value.notificationIntent.placeSelectionMode {
        case .explicit:
            defaultBindingValid = value.defaultPlaceBinding == nil
        case .default:
            defaultBindingValid = value.placeMappings.isEmpty &&
                value.defaultPlaceBinding.map(validDefaultPlaceBinding) == true
        }
        return defaultBindingValid &&
            Set(value.planMappings.map(\.legacyID)).count == value.planMappings.count &&
            Set(value.planMappings.map(\.nativePlanID)).count == value.planMappings.count &&
            Set(value.placeMappings.map(\.legacyID)).count == value.placeMappings.count &&
            Set(value.placeMappings.map(\.nativePlaceID)).count == value.placeMappings.count
    }

    private static func validIntent(_ value: NativePlanNotificationIntentSnapshot) -> Bool {
        value.hydration == "ready" &&
            value.selectedPlanIDs.count <= maximumSelectedPlans &&
            value.selectedPlaceIDs.count <= maximumSelectedPlaces &&
            value.selectedPlanIDs.allSatisfy(validIdentifier) &&
            value.selectedPlaceIDs.allSatisfy(validIdentifier) &&
            Set(value.selectedPlanIDs).count == value.selectedPlanIDs.count &&
            Set(value.selectedPlaceIDs).count == value.selectedPlaceIDs.count &&
            (value.placeSelectionMode != .default || value.selectedPlaceIDs.isEmpty)
    }

    private static func validDefaultPlaceBinding(_ value: NativePlanNotificationDefaultPlaceBinding) -> Bool {
        value.nativePlacesRevision > 0 &&
            value.nativePlaceIDs.count <= maximumSelectedPlaces &&
            value.nativePlaceIDs.allSatisfy(validIdentifier) &&
            Set(value.nativePlaceIDs).count == value.nativePlaceIDs.count
    }

    private func readFile(_ name: String) throws -> Data? {
        let url = directory.appendingPathComponent(name)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw NativePlanNotificationIntentError.storageUnavailable
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var status = stat()
        guard fstat(descriptor, &status) == 0,
              status.st_mode & S_IFMT == S_IFREG,
              status.st_size >= 0,
              status.st_size <= Self.maximumStoredBytes else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        let data = try handle.readToEnd() ?? Data()
        guard data.count <= Self.maximumStoredBytes else { throw NativePlanNotificationIntentError.invalidStore }
        try Self.protect(url, isDirectory: false)
        return data
    }

    private func atomicWrite(_ data: Data, name: String) throws {
        let temporary = directory.appendingPathComponent(".pending-\(UUID().uuidString)")
        let destination = directory.appendingPathComponent(name)
        let descriptor = open(temporary.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlanNotificationIntentError.storageUnavailable }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: temporary)
        }
        try Self.protect(temporary, isDirectory: false)
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
        guard try Data(contentsOf: temporary, options: .uncached) == data else {
            throw NativePlanNotificationIntentError.invalidStore
        }
        guard rename(temporary.path, destination.path) == 0 else {
            throw NativePlanNotificationIntentError.storageUnavailable
        }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw NativePlanNotificationIntentError.storageUnavailable }
        defer { close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw NativePlanNotificationIntentError.storageUnavailable }
    }

    private func withStoreLock<T>(_ body: () throws -> T) throws -> T {
        do { try Self.prepareDirectory(directory) }
        catch { throw NativePlanNotificationIntentError.storageUnavailable }
        let lock = directory.appendingPathComponent(".notification-intent.lock")
        let descriptor = open(lock.path, O_CREAT | O_RDWR | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlanNotificationIntentError.storageUnavailable }
        defer { close(descriptor) }
        guard fchmod(descriptor, mode_t(0o600)) == 0, flock(descriptor, LOCK_EX) == 0 else {
            throw NativePlanNotificationIntentError.storageUnavailable
        }
        defer { flock(descriptor, LOCK_UN) }
        do {
            try Self.protect(lock, isDirectory: false)
            return try body()
        } catch let error as NativePlanNotificationIntentError {
            throw error
        } catch {
            throw NativePlanNotificationIntentError.storageUnavailable
        }
    }

    // MARK: - Validation and encoding

    fileprivate static func validIdentifier(_ value: String) -> Bool {
        value.utf16.count <= 160 &&
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !value.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) })
    }

    private static func identifiers(_ values: [Any], maximum: Int) throws -> [String] {
        guard values.count <= maximum else { throw NativePlanNotificationIntentError.invalidExport }
        let identifiers = try values.map { value -> String in
            guard let identifier = value as? String, validIdentifier(identifier) else {
                throw NativePlanNotificationIntentError.invalidExport
            }
            return identifier
        }
        guard Set(identifiers).count == identifiers.count else {
            throw NativePlanNotificationIntentError.invalidExport
        }
        return identifiers
    }

    private static func exactKeys(_ value: [String: Any], _ expected: [String], error: NativePlanNotificationIntentError) throws {
        guard Set(value.keys) == Set(expected) else { throw error }
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite,
              number.doubleValue.rounded() == number.doubleValue,
              let integer = Int(number.stringValue) else { return nil }
        return integer
    }

    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    private static func canonicalCaptureDate(_ value: String) -> Date? {
        guard validIdentifier(value), value.utf8.count <= 40 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value) else { return nil }
        let output = DateFormatter()
        output.locale = Locale(identifier: "en_US_POSIX")
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return output.string(from: date) == value ? date : nil
    }

    private static func validDigest(_ value: String) -> Bool {
        value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }

    private static func digest<T: Encodable>(_ value: T) throws -> String {
        SHA256.hash(data: try encode(value)).map { String(format: "%02x", $0) }.joined()
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private static func report(_ stage: NativePlanNotificationIntentStage, unchanged: Bool) -> NativePlanNotificationIntentStageReport {
        NativePlanNotificationIntentStageReport(
            owner: stage.owner,
            stagingEpoch: stage.stagingEpoch,
            sourceScope: stage.sourceScope,
            sourceCapturedAt: stage.sourceCapturedAt,
            globalPreference: stage.notificationIntent.globalPreference,
            selectedPlanCount: stage.notificationIntent.selectedPlanIDs.count,
            placeNotificationsEnabled: stage.notificationIntent.placeNotificationsEnabled,
            selectedPlaceCount: stage.notificationIntent.selectedPlaceIDs.count,
            placeSelectionMode: stage.notificationIntent.placeSelectionMode,
            unchanged: unchanged
        )
    }

    private static func prepareDirectory(_ directory: URL) throws {
        guard directory.isFileURL else { throw NativePlanNotificationIntentError.storageUnavailable }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try protect(directory, isDirectory: true)
    }

    private static func protect(_ url: URL, isDirectory: Bool) throws {
        var attributes: [FileAttributeKey: Any] = [.posixPermissions: isDirectory ? 0o700 : 0o600]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.setAttributes(attributes, ofItemAtPath: url.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var local = url
        try local.setResourceValues(values)
    }
}

private enum NativePlanNotificationIntentSemantics {
    private struct PlanSemanticIdentity: Codable {
        let title: String
        let label: String
        let original: String
        let answer: String
        let place: NativeAgendaPlace
        let targetDate: String
        let startHour: Double
        let endHour: Double
        let windows: [NativeAgendaWindow]
        let scheduleType: NativeAgendaScheduleType
        let span: NativeAgendaSpan?
        let routine: NativeAgendaRoutine?
        let createdAtMilliseconds: Int64
        let updatedAtMilliseconds: Int64
    }

    static func planDigest(_ plan: NativeAgendaPlan) -> String? {
        let value = PlanSemanticIdentity(
            title: plan.title,
            label: plan.label,
            original: plan.original,
            answer: plan.answer,
            place: plan.place,
            targetDate: plan.targetDate,
            startHour: plan.startHour,
            endHour: plan.endHour,
            windows: plan.windows,
            scheduleType: plan.scheduleType,
            span: plan.span,
            routine: plan.routine,
            createdAtMilliseconds: plan.createdAtMilliseconds,
            updatedAtMilliseconds: plan.updatedAtMilliseconds
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
