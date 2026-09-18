import Foundation
import Combine

/// Native actions do not depend on the web document, its forecast, or its cache.
@MainActor
final class NativePlacesOwnerController: ObservableObject {
    @Published private(set) var status = "unmigrated"
    @Published private(set) var snapshot: NativePlacesOwnerSnapshot?
    @Published var isActivating = false
    @Published var message: String?
    var onChange: (@MainActor () -> Void)?

    private var directory: URL
    private var store: NativePlacesOwnerStore
    private let lookup = NativePlaceLookupService()
    private var generation = 0
    private var publishesCompanions: Bool
    private var publicationRetry: Task<Void, Never>?
    private var publicationRetryToken: UUID?

    init(production: Bool) {
        directory = Self.directory(production: production)
        store = NativePlacesOwnerStore(directory: directory)
        publishesCompanions = production
        apply(NativePlacesOwnerStore.readBootstrap(directory: directory))
    }

    private static func directory(production: Bool) -> URL {
        production ? NativePlacesOwnerStore.defaultDirectory :
            NativePlacesOwnerStore.defaultDirectory.appendingPathComponent("DevelopmentOnly", isDirectory: true)
    }

    func configure(production: Bool) {
        publicationRetry?.cancel()
        publicationRetry = nil
        publicationRetryToken = nil
        generation += 1
        directory = Self.directory(production: production)
        store = NativePlacesOwnerStore(directory: directory)
        publishesCompanions = production
        isActivating = false
        snapshot = nil
        status = "unmigrated"
        apply(NativePlacesOwnerStore.readBootstrap(directory: directory))
    }

    func activate(_ source: NativePlacesSource) async throws -> NativePlacesOwnerSnapshot {
        guard status == "unmigrated", source.owner == "legacy", source.isValid else {
            throw NativePlacesOwnerError.unavailable
        }
        let started = generation
        do {
            let saved = try await store.activate(source: source)
            guard started == generation else { throw NativePlacesOwnerError.stale }
            apply(.owned(saved))
            return saved
        } catch {
            // A failed readback can follow a successful atomic replace. Inspect
            // the store; never invite a second legacy import over that commit.
            if started == generation { apply(NativePlacesOwnerStore.readBootstrap(directory: directory)) }
            throw error
        }
    }

    func perform(_ command: NativePlacesCommand,
                 isCurrent: @escaping @MainActor () -> Bool = { true }) async throws -> NativePlacesReply {
        guard status == "owned", !isActivating, isCurrent(), command.version == 1,
              UUID(uuidString: command.requestID) != nil else { throw NativePlacesOwnerError.unavailable }
        let started = generation
        let activeStore = store
        var resolved = command
        if command.action == "search" {
            guard let query = command.query, query.utf16.count <= 160,
                  !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  query.unicodeScalars.allSatisfy({ $0.value >= 32 && !(127...159).contains($0.value) }) else {
                throw NativePlacesOwnerError.invalid
            }
            let results = try await lookup.search(query: query)
            guard started == generation, isCurrent(), !Task.isCancelled else { throw NativePlacesOwnerError.stale }
            guard let current = try await activeStore.snapshot() else { throw NativePlacesOwnerError.unavailable }
            guard started == generation, isCurrent(), !Task.isCancelled else { throw NativePlacesOwnerError.stale }
            apply(.owned(current))
            return NativePlacesReply(requestID: command.requestID, ok: true, source: current.source, results: results)
        }
        if command.action == "currentLocation" {
            guard command.expectedSource == snapshot?.source else { throw NativePlacesOwnerError.stale }
            let place = try await lookup.currentLocation()
            guard started == generation, isCurrent(), !Task.isCancelled else { throw NativePlacesOwnerError.stale }
            resolved.action = "select"
            resolved.place = place
        }
        guard started == generation, isCurrent(), !Task.isCancelled else { throw NativePlacesOwnerError.stale }
        let reply = await activeStore.perform(command: resolved)
        guard started == generation else { throw NativePlacesOwnerError.stale }
        do {
            let current = try await activeStore.snapshot()
            guard started == generation else { throw NativePlacesOwnerError.stale }
            if let current { apply(.owned(current)) }
            else { apply(.blocked) }
        } catch { if started == generation { apply(.blocked) } }
        guard started == generation else { throw NativePlacesOwnerError.stale }
        return reply
    }

    func acknowledgeDeletions(through: Int) async throws -> NativePlacesOwnerSnapshot {
        guard status == "owned", !isActivating else { throw NativePlacesOwnerError.unavailable }
        let started = generation
        let saved = try await store.ackDeletions(through: through)
        guard started == generation else { throw NativePlacesOwnerError.stale }
        apply(.owned(saved))
        return saved
    }

    private func apply(_ bootstrap: NativePlacesOwnerBootstrap) {
        if case .owned(let value) = bootstrap, status == "owned", snapshot == value {
            retryCompanionPublication()
            return
        }
        if case .owned(let value) = bootstrap, let previous = snapshot, value.revision < previous.revision { return }
        switch bootstrap {
        case .unmigrated:
            snapshot = nil
            status = "unmigrated"
        case .blocked:
            snapshot = nil
            status = "blocked"
            message = "Saved native places could not be verified. Nothing was replaced. Reopen the app after unlocking your phone."
        case .owned(let value):
            snapshot = value
            status = "owned"
            message = value.pendingDeletions.isEmpty ? nil :
                "Places are saved. Notification cleanup will finish when the existing app reconnects."
            retryCompanionPublication()
        }
        onChange?()
    }

    func retryCompanionPublication() {
        guard publishesCompanions, status == "owned", let snapshot else { return }
        if NativeSnapshotPublicationCoordinator.shared.publishNative(source: snapshot.source, revision: snapshot.revision) {
            publicationRetry?.cancel()
            publicationRetry = nil
            publicationRetryToken = nil
            return
        }
        guard publicationRetry == nil else { return }
        let started = generation
        let token = UUID()
        publicationRetryToken = token
        publicationRetry = Task { [weak self] in
            defer {
                if self?.publicationRetryToken == token {
                    self?.publicationRetry = nil
                    self?.publicationRetryToken = nil
                }
            }
            for _ in 0..<5 {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                guard let self, !Task.isCancelled, self.generation == started,
                      self.publishesCompanions, self.status == "owned", let latest = self.snapshot else { return }
                if NativeSnapshotPublicationCoordinator.shared.publishNative(source: latest.source, revision: latest.revision) { return }
            }
        }
    }
}
