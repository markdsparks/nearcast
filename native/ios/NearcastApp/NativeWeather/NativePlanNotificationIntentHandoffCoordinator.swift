import Foundation
import Combine

/// Coordinates only the local P0 receipt sequence:
///
/// 1. a trusted compatibility page writes a complete legacy handover receipt;
/// 2. the person may separately copy schedules and approve native Places;
/// 3. after both native mappings exist, this stages the preserved choices.
///
/// It observes immutable native snapshots and never mutates a Plan, a Place,
/// delivery registration, permission, Watch, widget, or remote service. A
/// failed/partial mapping remains unavailable and is retried only on a later
/// verified local state change.
@MainActor
final class NativePlanNotificationIntentHandoffCoordinator {
    private let placesOwner: NativePlacesOwnerController
    private var sourceScope: NativeLegacySourceScope
    private var stagingCoordinator: NativePlanNotificationIntentStagingCoordinator
    private var generation = 0
    private var planArchiveObservation: AnyCancellable?
    private var placesObservation: AnyCancellable?
    private var captureTask: Task<Void, Never>?
    private var mappingTask: Task<Void, Never>?

    init(production: Bool, placesOwner: NativePlacesOwnerController) {
        self.placesOwner = placesOwner
        let sourceScope = NativeLegacySourceScope(production: production)
        self.sourceScope = sourceScope
        let migrationStore = Self.migrationStore(scope: sourceScope)
        let intentStore = Self.intentStore(scope: sourceScope)
        stagingCoordinator = NativePlanNotificationIntentStagingCoordinator(
            migrationStore: migrationStore,
            intentStore: intentStore
        )

        // The publisher sends the current value immediately, which covers a
        // previous app session. Later schedule imports or native-Places
        // approval get a fresh attempt without requiring WebKit to remain open.
        planArchiveObservation = NativePlanLibrary.shared.$archive
            .sink { [weak self] _ in self?.attemptStageFromPersistedReceipt() }
        placesObservation = placesOwner.$snapshot
            .sink { [weak self] _ in self?.attemptStageFromPersistedReceipt() }
    }

    /// Dev's local compatibility host and production must not share a receipt.
    /// Changing source invalidates in-flight work before selecting the new
    /// local-only directories.
    func configure(production: Bool) {
        generation &+= 1
        captureTask?.cancel()
        mappingTask?.cancel()
        let sourceScope = NativeLegacySourceScope(production: production)
        self.sourceScope = sourceScope
        let migrationStore = Self.migrationStore(scope: sourceScope)
        let intentStore = Self.intentStore(scope: sourceScope)
        stagingCoordinator = NativePlanNotificationIntentStagingCoordinator(
            migrationStore: migrationStore,
            intentStore: intentStore
        )
        attemptStageFromPersistedReceipt()
    }

    /// The bridge receiver supplies only a trusted, bounded legacy export.
    /// Persist it first; if that fails, no staging attempt occurs. All errors
    /// are intentionally silent here because legacy remains the delivery owner.
    func receiveVerifiedLegacyHandover(_ data: Data) {
        let coordinator = stagingCoordinator
        let mappings = currentMappings()
        let generation = generation
        captureTask?.cancel()
        captureTask = Task { @MainActor [weak self] in
            // Configure cancels this task and advances the generation before
            // replacing its source-scoped stores. Check both sides of the
            // actor hop so a queued Local task cannot publish a result into a
            // later Production lifecycle (or the reverse).
            guard let self, self.generation == generation, !Task.isCancelled else { return }
            _ = await coordinator.captureVerifiedLegacyHandover(data, mappings: mappings)
            guard self.generation == generation, !Task.isCancelled else { return }
        }
    }

    /// A schedule import or native-Places change can happen long after the
    /// compatibility page closes. Re-read only the hardened local receipt, not
    /// browser storage, and independently validate it in the intent store.
    func attemptStageFromPersistedReceipt() {
        let coordinator = stagingCoordinator
        let mappings = currentMappings()
        let generation = generation
        mappingTask?.cancel()
        mappingTask = Task { @MainActor [weak self] in
            guard let self, self.generation == generation, !Task.isCancelled else { return }
            _ = await coordinator.updateMappings(mappings)
            guard self.generation == generation, !Task.isCancelled else { return }
        }
    }

    private func currentMappings() -> NativePlanNotificationIntentMappingSnapshot {
        NativePlanNotificationIntentMappingSnapshot(
            planArchive: NativePlanLibrary.shared.archive,
            nativePlacesSnapshot: placesOwner.snapshot,
            sourceScope: sourceScope
        )
    }

    private static func migrationStore(scope: NativeLegacySourceScope) -> NativePlanMigrationStore {
        NativePlanMigrationStore(
            directory: scope.scopedDirectory(from: NativePlanMigrationStore.defaultDirectory)
        )
    }

    private static func intentStore(scope: NativeLegacySourceScope) -> NativePlanNotificationIntentStore {
        NativePlanNotificationIntentStore(
            directory: scope.scopedDirectory(from: NativePlanNotificationIntentStore.defaultDirectory),
            sourceScope: scope
        )
    }
}
