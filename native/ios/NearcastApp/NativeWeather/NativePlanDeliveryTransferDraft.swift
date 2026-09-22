import Foundation

/// Why a future, explicit native delivery transfer cannot be reviewed yet.
///
/// These reasons deliberately describe only local evidence. They do not
/// request notification permission, talk to a server, obtain a token, or
/// change who currently delivers alerts. Existing Plans remains the only
/// delivery owner for every result produced by this model.
enum NativePlanDeliveryTransferDraftUnavailabilityReason: String, Codable, CaseIterable, Equatable, Sendable {
    /// There is no P0 receipt for the active legacy source.
    case missingStage
    /// P0 retained a tombstone after a native Plan or Place changed.
    case revokedStage
    /// The supplied stage is not a complete current P0-shaped receipt.
    case staleStage
    /// The stage or its imported Plan receipt belongs to a different source.
    case sourceScopeMismatch
    /// A selected legacy plan no longer resolves to its verified native copy.
    case selectedPlanMappingMismatch
    /// Native Places is not yet the verified owner needed by this selection.
    case nativePlacesUnavailable
    /// A selected/default legacy place no longer resolves to its native copy.
    case selectedPlaceMappingMismatch
}

/// A structured, safe-to-render explanation for why a transfer review is
/// unavailable. It intentionally carries no delivery credentials or remote
/// identifiers.
struct NativePlanDeliveryTransferDraftUnavailability: Equatable, Sendable {
    let reasons: [NativePlanDeliveryTransferDraftUnavailabilityReason]
}

/// The exact native plan target that P0's selected legacy plan still resolves
/// to. `semanticDigest` is intentionally captured so a later review/commit
/// can reject a plan that was edited after this draft was made.
struct NativePlanDeliveryTransferDraftPlanTarget: Codable, Equatable, Sendable {
    let legacyPlanID: String
    let nativePlanID: String
    let semanticDigest: String
}

/// The exact native saved place that P0's selected legacy place still resolves
/// to. This is identity mapping only; it never guesses a nearby replacement.
struct NativePlanDeliveryTransferDraftPlaceTarget: Codable, Equatable, Sendable {
    let legacyPlaceID: String
    let nativePlaceID: String
}

/// A local snapshot that a later, user-confirmed transfer protocol may show
/// for review.
///
/// This is not a delivery registration and it is not an ownership record.
/// It exists solely to prove that the already-verified P0 receipt still maps
/// to the currently owned native Plans and Places state. In particular it
/// contains no APNs token, server capability, permission state, Watch state,
/// widget state, network endpoint, or mutable storage handle.
struct NativePlanDeliveryTransferDraft: Codable, Equatable, Sendable {
    let version: Int
    let sourceScope: NativeLegacySourceScope
    let sourceCapturedAt: String
    let stagingEpoch: Int
    let stageReceiptDigest: String
    let sourceDigest: String
    let mappingDigest: String
    let notificationIntent: NativePlanNotificationIntentSnapshot
    let planTargets: [NativePlanDeliveryTransferDraftPlanTarget]
    let placeTargets: [NativePlanDeliveryTransferDraftPlaceTarget]
    let defaultPlaceBinding: NativePlanNotificationDefaultPlaceBinding?

    /// This must remain false until a separately designed, explicit,
    /// server-acknowledged ownership-transfer protocol has completed.
    var isNativeDeliveryActive: Bool { false }
}

/// The only two outcomes available before an explicit P1 transfer protocol
/// exists. `.reviewable` means a review screen could safely show an exact
/// local target set; it never means that native notifications have been
/// enabled.
enum NativePlanDeliveryTransferDraftReadiness: Equatable, Sendable {
    case reviewable(NativePlanDeliveryTransferDraft)
    case unavailable(NativePlanDeliveryTransferDraftUnavailability)

    var draft: NativePlanDeliveryTransferDraft? {
        guard case .reviewable(let draft) = self else { return nil }
        return draft
    }

    var unavailability: NativePlanDeliveryTransferDraftUnavailability? {
        guard case .unavailable(let value) = self else { return nil }
        return value
    }
}

/// A pure validator for the pre-delivery transfer boundary.
///
/// P0 owns validation and durable storage of `NativePlanNotificationIntentStage`.
/// This type deliberately does not open that store or any other persistent
/// state. Its caller supplies the already-read current receipt plus immutable
/// Plan/Places mapping snapshots, so evaluating it cannot race a local write
/// or create a hidden path to notification delivery.
enum NativePlanDeliveryTransferDraftValidator {
    /// Validates that a current legacy-owned P0 stage still maps to the native
    /// Plan archive and native Places owner for the same source scope.
    ///
    /// The result is intentionally fail-closed. Any malformed receipt or
    /// changed mapping is unavailable; no best-effort identity matching or
    /// proximity-based place matching is ever attempted.
    static func readiness(
        stage: NativePlanNotificationIntentStage?,
        mappings: NativePlanNotificationIntentMappingSnapshot,
        sourceScope: NativeLegacySourceScope
    ) -> NativePlanDeliveryTransferDraftReadiness {
        guard let stage else {
            return unavailable(.missingStage)
        }
        guard !stage.isRevoked else {
            return unavailable(.revokedStage)
        }
        guard isCurrentStageShape(stage) else {
            return unavailable(.staleStage)
        }
        guard stage.sourceScope == sourceScope, mappings.sourceScope == sourceScope else {
            return unavailable(.sourceScopeMismatch)
        }

        // A Plan copy is authority only when it was made by the explicit,
        // source-scoped Plans handoff. Historical imported IDs alone are not
        // sufficient, even if an identically named plan still exists.
        guard let planReceipt = mappings.nativePlanHandoff else {
            return unavailable(.selectedPlanMappingMismatch)
        }
        guard planReceipt.sourceScope == sourceScope else {
            return unavailable(.sourceScopeMismatch)
        }

        var reasons: [NativePlanDeliveryTransferDraftUnavailabilityReason] = []
        let planTargets: [NativePlanDeliveryTransferDraftPlanTarget]
        if let targets = planTargetsStillResolve(stage.planMappings, in: mappings, receipt: planReceipt) {
            planTargets = targets
        } else {
            planTargets = []
            reasons.append(.selectedPlanMappingMismatch)
        }

        let places = validatePlaces(stage: stage, mappings: mappings)
        if let placesReason = places.reason {
            reasons.append(placesReason)
        }

        guard reasons.isEmpty else {
            return .unavailable(.init(reasons: reasons))
        }

        return .reviewable(
            NativePlanDeliveryTransferDraft(
                version: 1,
                sourceScope: sourceScope,
                sourceCapturedAt: stage.sourceCapturedAt,
                stagingEpoch: stage.stagingEpoch,
                stageReceiptDigest: stage.receiptDigest,
                sourceDigest: stage.sourceDigest,
                mappingDigest: stage.mappingDigest,
                notificationIntent: stage.notificationIntent,
                planTargets: planTargets,
                placeTargets: places.targets,
                defaultPlaceBinding: stage.defaultPlaceBinding
            )
        )
    }

    /// Rechecks a previously made review snapshot immediately before any
    /// future confirmation step. It never upgrades or rewrites the draft: if
    /// a Plan, Place, receipt, or source changed, the caller must begin a new
    /// explicit review.
    static func validate(
        _ draft: NativePlanDeliveryTransferDraft,
        stage: NativePlanNotificationIntentStage?,
        mappings: NativePlanNotificationIntentMappingSnapshot,
        sourceScope: NativeLegacySourceScope
    ) -> NativePlanDeliveryTransferDraftReadiness {
        let current = readiness(stage: stage, mappings: mappings, sourceScope: sourceScope)
        guard case .reviewable(let refreshed) = current else { return current }
        guard refreshed == draft else {
            return .unavailable(.init(reasons: driftReasons(from: draft, to: refreshed)))
        }
        return current
    }

    private static func unavailable(
        _ reason: NativePlanDeliveryTransferDraftUnavailabilityReason
    ) -> NativePlanDeliveryTransferDraftReadiness {
        .unavailable(.init(reasons: [reason]))
    }

    /// This repeats only the non-cryptographic envelope invariants needed to
    /// reject an incompatible in-memory value. P0's store remains the sole
    /// verifier of the signed/encoded receipt itself; this model must not
    /// recreate, write, or reinterpret P0 storage.
    private static func isCurrentStageShape(_ stage: NativePlanNotificationIntentStage) -> Bool {
        // P0 v3 is the first stage shape that pins each selected Plan's
        // semantics. A v2 stage might retain the same identifiers after an
        // edit, so it is intentionally unavailable until fresh v3 staging.
        guard stage.schemaVersion == 3,
              stage.minReaderVersion == 3,
              stage.minWriterVersion == 3,
              stage.owner == "legacy",
              stage.stagingEpoch > 0,
              validDigest(stage.sourceDigest),
              validDigest(stage.mappingDigest),
              validDigest(stage.receiptDigest),
              validCaptureDate(stage.sourceCapturedAt),
              stage.notificationIntent.hydration == "ready",
              stage.notificationIntent.selectedPlanIDs.count <= 3,
              stage.notificationIntent.selectedPlaceIDs.count <= 3,
              allDistinctAndValid(stage.notificationIntent.selectedPlanIDs),
              allDistinctAndValid(stage.notificationIntent.selectedPlaceIDs),
              stage.planMappings.count == stage.notificationIntent.selectedPlanIDs.count,
              stage.placeMappings.count == stage.notificationIntent.selectedPlaceIDs.count,
              stage.planMappings.map(\.legacyID) == stage.notificationIntent.selectedPlanIDs,
              stage.placeMappings.map(\.legacyID) == stage.notificationIntent.selectedPlaceIDs,
              allDistinctAndValid(stage.planMappings.map(\.legacyID)),
              allDistinctAndValid(stage.planMappings.map(\.nativePlanID)),
              stage.planMappings.allSatisfy({ validDigest($0.semanticDigest) }),
              allDistinctAndValid(stage.placeMappings.map(\.legacyID)),
              allDistinctAndValid(stage.placeMappings.map(\.nativePlaceID)) else {
            return false
        }

        switch stage.notificationIntent.placeSelectionMode {
        case .explicit:
            return stage.defaultPlaceBinding == nil
        case .default:
            guard stage.placeMappings.isEmpty,
                  let binding = stage.defaultPlaceBinding else { return false }
            return binding.nativePlacesRevision > 0 &&
                binding.nativePlaceIDs.count <= 3 &&
                allDistinctAndValid(binding.nativePlaceIDs)
        }
    }

    private static func planTargetsStillResolve(
        _ mappings: [NativePlanNotificationPlanMapping],
        in currentMappings: NativePlanNotificationIntentMappingSnapshot,
        receipt: NativePlanLegacyHandoffReceipt
    ) -> [NativePlanDeliveryTransferDraftPlanTarget]? {
        guard receipt.version == 1,
              receipt.sourcePlanCount >= 0,
              receipt.availableNativeCopyCount >= 0,
              receipt.protectedDeletedCount >= 0,
              receipt.availableNativeCopyCount + receipt.protectedDeletedCount == receipt.sourcePlanCount,
              let sourcePlanIDHashes = receipt.sourcePlanIDHashes else {
            return nil
        }
        let sourceIDs = Set(sourcePlanIDHashes)
        var targets: [NativePlanDeliveryTransferDraftPlanTarget] = []
        for mapping in mappings {
            guard let copy = currentMappings.planCopies[mapping.legacyID],
                  copy.nativePlanID == mapping.nativePlanID,
                  validDigest(copy.semanticDigest),
                  copy.semanticDigest == mapping.semanticDigest,
                  sourceIDs.contains(NativePlanLibrary.legacyIdentifierDigest(mapping.legacyID)) else {
                return nil
            }
            targets.append(.init(
                legacyPlanID: mapping.legacyID,
                nativePlanID: mapping.nativePlanID,
                semanticDigest: mapping.semanticDigest
            ))
        }
        return targets
    }

    private struct PlacesValidation {
        let reason: NativePlanDeliveryTransferDraftUnavailabilityReason?
        let targets: [NativePlanDeliveryTransferDraftPlaceTarget]
    }

    private static func validatePlaces(
        stage: NativePlanNotificationIntentStage,
        mappings: NativePlanNotificationIntentMappingSnapshot
    ) -> PlacesValidation {
        let needsNativePlaces: Bool
        switch stage.notificationIntent.placeSelectionMode {
        case .explicit:
            needsNativePlaces = stage.notificationIntent.placeNotificationsEnabled ||
                !stage.notificationIntent.selectedPlaceIDs.isEmpty
        case .default:
            needsNativePlaces = true
        }
        guard needsNativePlaces else { return .init(reason: nil, targets: []) }

        guard mappings.nativePlacesVerified else {
            return .init(reason: .nativePlacesUnavailable, targets: [])
        }

        switch stage.notificationIntent.placeSelectionMode {
        case .explicit:
            var targets: [NativePlanDeliveryTransferDraftPlaceTarget] = []
            for mapping in stage.placeMappings {
                guard mappings.nativePlaceIDsByLegacyID[mapping.legacyID] == mapping.nativePlaceID else {
                    return .init(reason: .selectedPlaceMappingMismatch, targets: [])
                }
                targets.append(.init(legacyPlaceID: mapping.legacyID, nativePlaceID: mapping.nativePlaceID))
            }
            return .init(reason: nil, targets: targets)
        case .default:
            guard stage.defaultPlaceBinding == mappings.defaultPlaceBinding else {
                return .init(reason: .selectedPlaceMappingMismatch, targets: [])
            }
            return .init(reason: nil, targets: [])
        }
    }

    private static func driftReasons(
        from draft: NativePlanDeliveryTransferDraft,
        to refreshed: NativePlanDeliveryTransferDraft
    ) -> [NativePlanDeliveryTransferDraftUnavailabilityReason] {
        if draft.sourceScope != refreshed.sourceScope {
            return [.sourceScopeMismatch]
        }
        var reasons: [NativePlanDeliveryTransferDraftUnavailabilityReason] = []
        if draft.stageReceiptDigest != refreshed.stageReceiptDigest ||
            draft.sourceCapturedAt != refreshed.sourceCapturedAt ||
            draft.stagingEpoch != refreshed.stagingEpoch ||
            draft.sourceDigest != refreshed.sourceDigest ||
            draft.mappingDigest != refreshed.mappingDigest ||
            draft.notificationIntent != refreshed.notificationIntent {
            reasons.append(.staleStage)
        }
        if draft.planTargets != refreshed.planTargets {
            reasons.append(.selectedPlanMappingMismatch)
        }
        if draft.placeTargets != refreshed.placeTargets ||
            draft.defaultPlaceBinding != refreshed.defaultPlaceBinding {
            reasons.append(.selectedPlaceMappingMismatch)
        }
        return reasons.isEmpty ? [.staleStage] : reasons
    }

    private static func validDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (97...102).contains($0.value)
        }
    }

    private static func validCaptureDate(_ value: String) -> Bool {
        guard validIdentifier(value), value.utf8.count <= 40 else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) != nil
    }

    private static func allDistinctAndValid(_ values: [String]) -> Bool {
        Set(values).count == values.count && values.allSatisfy(validIdentifier)
    }

    private static func validIdentifier(_ value: String) -> Bool {
        value.utf16.count <= 160 &&
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !value.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) })
    }
}
