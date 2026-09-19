import Foundation
import MapLibre

/// Installs the provider-required iOS identity header on CARTO requests only.
/// Call before constructing the first MLNMapView. MapLibre retains its delegate
/// weakly, so this owner keeps the immutable transformer alive for the process.
@MainActor
enum NativeBasemapNetwork {
    private static var retainedDelegate: NativeBasemapNetworkDelegate?
    private static var cachePrepared = false

    /// CARTO permits end-user caching for at most thirty days. Nearcast's
    /// simpler, fail-closed policy is no persistent provider cache at all:
    /// disable MapLibre's ambient cache, then remove any prior ambient entries
    /// (whose database keys may contain an older provider credential). The app
    /// does not create MapLibre offline packs.
    static func prepareCache(bundleIdentifier: String? = Bundle.main.bundleIdentifier) async -> Bool {
        guard configureTransport(bundleIdentifier: bundleIdentifier) else { return false }
        guard !cachePrepared else { return true }
        let storage = MLNOfflineStorage.shared
        let disabled: Bool = await withCheckedContinuation { continuation in
            storage.setMaximumAmbientCacheSize(0) { error in
                continuation.resume(returning: error == nil)
            }
        }
        guard disabled else { return false }
        let cleared: Bool = await withCheckedContinuation { continuation in
            storage.clearAmbientCache { error in
                continuation.resume(returning: error == nil)
            }
        }
        cachePrepared = cleared
        return cleared
    }

    static func install(bundleIdentifier: String? = Bundle.main.bundleIdentifier) -> Bool {
        guard configureTransport(bundleIdentifier: bundleIdentifier), cachePrepared else { return false }
        return true
    }

    private static func configureTransport(bundleIdentifier: String?) -> Bool {
        guard let audience = NativeBasemapContract.audience(for: bundleIdentifier),
              bundleIdentifier == audience else { return false }
        if retainedDelegate != nil { return true }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let delegate = NativeBasemapNetworkDelegate(bundleIdentifier: audience)
        // Provider keys are necessarily embedded in MapLibre tile URLs. Keep
        // SDK URL/error logging disabled; Nearcast exposes only redacted states.
        MLNLoggingConfiguration.shared.loggingLevel = .none
        let manager = MLNNetworkConfiguration.sharedManager
        manager.sessionConfiguration = configuration
        manager.delegate = delegate
        retainedDelegate = delegate
        return true
    }
}

private final class NativeBasemapNetworkDelegate: NSObject, MLNNetworkConfigurationDelegate, @unchecked Sendable {
    private let bundleIdentifier: String

    init(bundleIdentifier: String) {
        self.bundleIdentifier = bundleIdentifier
    }

    func willSend(_ request: NSMutableURLRequest) -> NSMutableURLRequest {
        NativeBasemapContract.authorizeCartoRequest(request, bundleIdentifier: bundleIdentifier)
    }
}
