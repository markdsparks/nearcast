import Foundation

/// Identifies the one legacy compatibility source whose retained data may be
/// read by native migration code.  A Local Dev page and the production page
/// are different authorities even on the same phone; their verified exports
/// and local rehearsal receipts must never be joined by accident.
enum NativeLegacySourceScope: String, Codable, CaseIterable, Equatable, Sendable {
    case remoteProduction
    case localDevelopment

    init(production: Bool) {
        self = production ? .remoteProduction : .localDevelopment
    }

    var isProduction: Bool { self == .remoteProduction }

    /// Keeps every local-development rehearsal physically separate from its
    /// production counterpart while retaining stable existing production paths.
    func scopedDirectory(from base: URL) -> URL {
        switch self {
        case .remoteProduction:
            return base
        case .localDevelopment:
            return base.appendingPathComponent("DevelopmentOnly", isDirectory: true)
        }
    }

    /// UserDefaults has no directory boundary, so cache keys carry the scope.
    func scopedDefaultsKey(_ base: String) -> String {
        "\(base).\(rawValue)"
    }
}
