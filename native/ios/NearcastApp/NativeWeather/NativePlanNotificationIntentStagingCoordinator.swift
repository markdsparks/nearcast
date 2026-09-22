import Foundation

/// The result of a local P0 staging attempt.
///
/// `.unavailable` deliberately does not distinguish a partial native copy,
/// an unowned Places snapshot, or a damaged local receipt.  Existing Plans
/// remains the only alert owner in each of those cases, and a later verified
/// local state change may safely try again.
enum NativePlanNotificationIntentStagingOutcome: Equatable, Sendable {
    case unavailable
    case staged(NativePlanNotificationIntentStageReport)
}

/// A testable, local-only sequencer for the awkward but normal migration
/// ordering: the compatibility page can finish its verified export before a
/// person imports native schedule copies or approves native Places.
///
/// It retains no browser handle and replays only `NativePlanMigrationStore`'s
/// already verified, durable source.  It owns neither delivery nor a Plan or
/// Places archive; callers supply immutable mapping snapshots when either
/// native archive changes.  This makes a later P1 delivery handoff an
/// explicit, separate protocol rather than an accidental side effect here.
actor NativePlanNotificationIntentStagingCoordinator {
    private let migrationStore: NativePlanMigrationStore
    private let intentStore: NativePlanNotificationIntentStore
    private var latestMappings: NativePlanNotificationIntentMappingSnapshot?
    private var mappingsEpoch = 0

    init(
        migrationStore: NativePlanMigrationStore,
        intentStore: NativePlanNotificationIntentStore
    ) {
        self.migrationStore = migrationStore
        self.intentStore = intentStore
    }

    /// Saves a complete source to the hardened rehearsal receipt first.  A
    /// missing native mapping is expected at this point and only reports
    /// unavailable; it does not discard the receipt or alter legacy delivery.
    func captureVerifiedLegacyHandover(
        _ data: Data,
        mappings: NativePlanNotificationIntentMappingSnapshot
    ) async -> NativePlanNotificationIntentStagingOutcome {
        latestMappings = mappings
        mappingsEpoch &+= 1
        guard !Task.isCancelled,
              (try? await migrationStore.rehearse(data)) != nil,
              !Task.isCancelled else {
            return .unavailable
        }
        return await stageFromPersistedReceipt()
    }

    /// Called after a native schedule import or native Places snapshot change.
    /// It does not revisit WebKit or browser storage; the only source is the
    /// receipt accepted by `captureVerifiedLegacyHandover`.
    func updateMappings(
        _ mappings: NativePlanNotificationIntentMappingSnapshot
    ) async -> NativePlanNotificationIntentStagingOutcome {
        latestMappings = mappings
        mappingsEpoch &+= 1
        return await stageFromPersistedReceipt()
    }

    private func stageFromPersistedReceipt() async -> NativePlanNotificationIntentStagingOutcome {
        // Actor reentrancy matters here: a Plan/Places change can arrive while
        // a receipt is read or written. Only return a result for the newest
        // mapping epoch; otherwise loop and evaluate the current immutable
        // snapshot. This prevents an old Local/partial attempt from revoking
        // or preserving a newer stage.
        while !Task.isCancelled {
            let mappingEpoch = mappingsEpoch
            guard let export = try? await migrationStore.verifiedLegacyHandoverExport(),
                  !Task.isCancelled,
                  let mappings = latestMappings else {
                return .unavailable
            }
            let priorReceiptDigest = try? await intentStore.stagedIntent()?.receiptDigest
            do {
                let report = try await intentStore.stageVerifiedLegacyExport(export, mappings: mappings)
                if mappingEpoch == mappingsEpoch { return .staged(report) }
            } catch NativePlanNotificationIntentError.nativeMappingsUnavailable {
                // A current incomplete/deleted mapping must make the prior
                // local receipt unavailable. Bind revocation to the exact
                // observed receipt so an in-flight newer stage cannot be
                // erased by this earlier attempt.
                guard mappingEpoch == mappingsEpoch else { continue }
                if let priorReceiptDigest {
                    _ = try? await intentStore.revokeStagedIntent(matchingReceiptDigest: priorReceiptDigest)
                }
                if mappingEpoch == mappingsEpoch { return .unavailable }
            } catch {
                if mappingEpoch == mappingsEpoch { return .unavailable }
            }
        }
        return .unavailable
    }
}
