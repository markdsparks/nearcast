import Combine
import Foundation

/// What native Plans knows about its read-only legacy projection. A failed or
/// missing export is deliberately different from a verified empty Agenda: we
/// must never imply that a family has no plans merely because a bridge failed.
enum NativeAgendaAvailability: Equatable {
    case unavailable
    case ready(capturedAt: Date, isEmpty: Bool)
    case retained(capturedAt: Date)
}

/// Holds the last strictly verified plan projection for the native client.
///
/// This is intentionally a cache, not a second plan database. It persists the
/// original envelope only after `NativeAgendaRepository` validates it, makes no
/// edits, and never reads or modifies notification/watch selections.
@MainActor
final class NativeAgendaStore: ObservableObject {
    static let shared = NativeAgendaStore()

    @Published private(set) var agenda: NativeAgenda?
    @Published private(set) var availability: NativeAgendaAvailability

    private static let payloadKey = "nearcast.native.agenda.legacy-export.v1"
    private let defaults: UserDefaults
    private let repository: NativeAgendaRepository
    private(set) var sourceScope: NativeLegacySourceScope

    init(
        defaults: UserDefaults = .standard,
        repository: NativeAgendaRepository = NativeAgendaRepository(),
        sourceScope: NativeLegacySourceScope = .remoteProduction
    ) {
        self.defaults = defaults
        self.repository = repository
        self.sourceScope = sourceScope
        if let payload = defaults.data(forKey: sourceScope.scopedDefaultsKey(Self.payloadKey)),
           let decoded = try? repository.decode(payload) {
            agenda = decoded
            availability = .ready(capturedAt: decoded.capturedAt, isEmpty: decoded.plans.isEmpty)
        } else {
            agenda = nil
            availability = .unavailable
        }
    }

    /// Compatibility source changes are a hard cache boundary. Switch this
    /// before navigating to a different host so a Local Dev agenda can never
    /// be displayed or imported as a production agenda (or the reverse).
    func configure(sourceScope: NativeLegacySourceScope) {
        guard sourceScope != self.sourceScope else { return }
        self.sourceScope = sourceScope
        if let payload = defaults.data(forKey: sourceScope.scopedDefaultsKey(Self.payloadKey)),
           let decoded = try? repository.decode(payload) {
            agenda = decoded
            availability = .ready(capturedAt: decoded.capturedAt, isEmpty: decoded.plans.isEmpty)
        } else {
            agenda = nil
            availability = .unavailable
        }
    }

    /// Receives an explicit export from a trusted legacy page. Invalid data
    /// cannot erase a previously verified cache or turn into a false empty
    /// Agenda. The boolean is only an ingestion acknowledgement; it never
    /// reflects a plan/watch mutation.
    @discardableResult
    func acceptLegacyExport(_ payload: Data, sourceScope: NativeLegacySourceScope? = nil) -> Bool {
        guard sourceScope == nil || sourceScope == self.sourceScope else { return false }
        do {
            let decoded = try repository.decode(payload)
            defaults.set(payload, forKey: self.sourceScope.scopedDefaultsKey(Self.payloadKey))
            agenda = decoded
            availability = .ready(capturedAt: decoded.capturedAt, isEmpty: decoded.plans.isEmpty)
            return true
        } catch {
            if let agenda {
                availability = .retained(capturedAt: agenda.capturedAt)
            } else {
                availability = .unavailable
            }
            return false
        }
    }
}
