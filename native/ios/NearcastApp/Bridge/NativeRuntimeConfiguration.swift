import Foundation

enum NearcastWebMode: String, CaseIterable, Identifiable {
    case local
    case production

    var id: String { rawValue }

    var label: String {
        switch self {
        case .local:
            return "Local"
        case .production:
            return "Production"
        }
    }
}

struct NativeRuntimeConfiguration {
    static let productionURL = URL(string: "https://getnearcast.app")!
    static let defaultLocalURL = URL(string: "http://127.0.0.1:4177")!

    private static let modeKey = "nearcast.native.webMode"
    private static let localURLKey = "nearcast.native.localURL"

    static var defaultMode: NearcastWebMode {
        #if DEBUG
        return .local
        #else
        return .production
        #endif
    }

    static func storedMode() -> NearcastWebMode {
        #if DEBUG
        guard let rawValue = UserDefaults.standard.string(forKey: modeKey),
              let mode = NearcastWebMode(rawValue: rawValue) else {
            return defaultMode
        }
        return mode
        #else
        return .production
        #endif
    }

    static func storeMode(_ mode: NearcastWebMode) {
        #if DEBUG
        UserDefaults.standard.set(mode.rawValue, forKey: modeKey)
        #endif
    }

    static func storedLocalURL() -> URL {
        guard let value = UserDefaults.standard.string(forKey: localURLKey),
              let url = normalizedURL(value) else {
            return defaultLocalURL
        }
        return url
    }

    static func storeLocalURL(_ url: URL) {
        UserDefaults.standard.set(url.absoluteString, forKey: localURLKey)
    }

    static func normalizedURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let url = URL(string: trimmed), url.scheme != nil {
            return url
        }

        return URL(string: "http://\(trimmed)")
    }
}
