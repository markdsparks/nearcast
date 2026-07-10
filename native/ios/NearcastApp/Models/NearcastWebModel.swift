import Foundation
import WebKit

@MainActor
final class NearcastWebModel: ObservableObject {
    @Published private(set) var mode: NearcastWebMode
    @Published private(set) var currentURL: URL
    @Published var localURLText: String
    @Published var isLoading = false
    @Published var hasLoadedPage = false
    @Published var lastError: String?
    @Published var lastBridgeMessage = "No bridge messages yet"
    @Published private(set) var navigationRevision = 0

    private weak var webView: WKWebView?
    private var localURL: URL
    private var loadTimeoutTask: Task<Void, Never>?

    init() {
        let storedMode = NativeRuntimeConfiguration.storedMode()
        let storedLocalURL = NativeRuntimeConfiguration.storedLocalURL()
        mode = storedMode
        localURL = storedLocalURL
        localURLText = storedLocalURL.absoluteString
        currentURL = storedMode == .local ? storedLocalURL : NativeRuntimeConfiguration.productionURL
        NativeNotificationRouter.shared.attach(self)
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
    }

    func load(_ nextMode: NearcastWebMode) {
        mode = nextMode
        NativeRuntimeConfiguration.storeMode(nextMode)
        requestNavigation(to: nextMode == .local ? localURL : NativeRuntimeConfiguration.productionURL, force: true)
    }

    func saveLocalURL() {
        guard let url = NativeRuntimeConfiguration.normalizedURL(localURLText) else {
            lastError = "Enter a valid local URL."
            return
        }

        localURL = url
        localURLText = url.absoluteString
        NativeRuntimeConfiguration.storeLocalURL(url)
        if mode == .local {
            requestNavigation(to: url, force: true)
        }
        lastError = nil
    }

    func reload() {
        requestNavigation(to: currentURL, force: true)
    }

    func goBackIfPossible() {
        guard let webView, webView.canGoBack else { return }
        webView.goBack()
    }

    func startLoading() {
        isLoading = true
        lastError = nil
        loadTimeoutTask?.cancel()
        loadTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.isLoading, !self.hasLoadedPage else { return }
                self.lastError = "Nearcast is taking longer than expected to load."
            }
        }
    }

    func finishLoading() {
        loadTimeoutTask?.cancel()
        loadTimeoutTask = nil
        isLoading = false
        hasLoadedPage = true
    }

    func setError(_ error: Error?) {
        loadTimeoutTask?.cancel()
        loadTimeoutTask = nil
        isLoading = false
        lastError = error?.localizedDescription
    }

    func ignoreCancelledNavigation() {
        lastError = nil
    }

    func recoverIfNeededOnActivation() {
        guard !hasLoadedPage, !isLoading, lastError == nil else { return }
        requestNavigation(to: currentURL, force: true)
    }

    func recoverFromWebContentTermination() {
        requestNavigation(to: currentURL, force: true)
    }

    func recordBridgeMessage(_ body: Any) {
        if let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted]),
           let value = String(data: data, encoding: .utf8) {
            lastBridgeMessage = value
        } else {
            lastBridgeMessage = String(describing: body)
        }
    }

    func openNotification(userInfo: [AnyHashable: Any]) {
        requestNavigation(to: notificationTargetURL(userInfo: userInfo, baseURL: currentBaseURL), force: true)
    }

    func openDeepLink(_ url: URL) {
        requestNavigation(to: deepLinkTargetURL(url, baseURL: currentBaseURL), force: shouldForceDeepLinkNavigation(url))
    }

    private var currentBaseURL: URL {
        mode == .local ? localURL : NativeRuntimeConfiguration.productionURL
    }

    private func requestNavigation(to targetURL: URL, force: Bool) {
        let sameTarget = Self.normalizedURLString(targetURL) == Self.normalizedURLString(currentURL)
        currentURL = targetURL
        lastError = nil

        if sameTarget, hasLoadedPage, !force {
            loadTimeoutTask?.cancel()
            loadTimeoutTask = nil
            isLoading = false
            return
        }

        hasLoadedPage = false
        navigationRevision &+= 1
    }

    private func shouldForceDeepLinkNavigation(_ url: URL) -> Bool {
        guard url.scheme == "nearcast" else { return true }
        let route = (url.host ?? "").lowercased()
        if route == "weather" || route.isEmpty {
            let sourceItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            return !sourceItems.isEmpty
        }
        return true
    }

    private func deepLinkTargetURL(_ url: URL, baseURL: URL) -> URL {
        guard url.scheme == "nearcast" else {
            return Self.notificationURL(url.absoluteString, baseURL: baseURL)
        }

        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        var items = components.queryItems ?? []
        let sourceItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []

        sourceItems.forEach { item in
            Self.upsertQueryItem(item.name, value: Self.cleanText(item.value, limit: 160), in: &items)
        }

        let route = (url.host ?? "").lowercased()
        if route == "weather" || route.isEmpty {
            components.queryItems = items.isEmpty ? nil : items
            return components.url ?? baseURL
        }

        if Self.queryValue("nearcast", in: items) == nil {
            Self.upsertQueryItem("nearcast", value: "live-activity", in: &items)
        }
        if Self.queryValue("source", in: items) == nil {
            Self.upsertQueryItem("source", value: "ios-deeplink", in: &items)
        }

        components.queryItems = items
        return components.url ?? baseURL
    }

    private func notificationTargetURL(userInfo: [AnyHashable: Any], baseURL: URL) -> URL {
        let payload = notificationPayload(from: userInfo)
        let rawURL = payload["url"] ?? payload["link"] ?? payload["deepLink"] ?? payload["deeplink"] ?? ""
        let candidate = Self.notificationURL(String(describing: rawURL), baseURL: baseURL)
        var components = URLComponents(url: candidate, resolvingAgainstBaseURL: false) ??
            URLComponents(url: baseURL, resolvingAgainstBaseURL: false) ??
            URLComponents()

        var items = components.queryItems ?? []
        let memoryId = Self.cleanText(payload["memoryId"] ?? payload["planId"] ?? payload["plan"] ?? Self.queryValue("memoryId", in: items) ?? Self.queryValue("planId", in: items) ?? Self.queryValue("plan", in: items), limit: 96)
        let placeId = Self.cleanText(payload["placeId"] ?? payload["place"] ?? Self.queryValue("placeId", in: items) ?? Self.queryValue("place", in: items), limit: 96)
        let target = Self.cleanToken(payload["target"] ?? payload["nearcastTarget"] ?? Self.queryValue("target", in: items) ?? Self.queryValue("nearcastTarget", in: items), limit: 40)
        let detail = Self.cleanToken(payload["detail"] ?? payload["kind"] ?? Self.queryValue("detail", in: items) ?? Self.queryValue("kind", in: items), limit: 32)
        let signal = Self.cleanToken(payload["signal"] ?? payload["type"] ?? Self.queryValue("signal", in: items) ?? Self.queryValue("type", in: items), limit: 64)
        let timeScope = Self.cleanToken(payload["timeScope"] ?? payload["scope"] ?? Self.queryValue("timeScope", in: items) ?? Self.queryValue("scope", in: items), limit: 32)
        let mode = Self.cleanToken(payload["mode"] ?? payload["layer"] ?? Self.queryValue("mode", in: items) ?? Self.queryValue("layer", in: items), limit: 40)
        let source = Self.cleanToken(payload["source"] ?? Self.queryValue("source", in: items), limit: 64)

        Self.upsertQueryItem("nearcast", value: "notification", in: &items)
        Self.upsertQueryItem("target", value: target.isEmpty ? (memoryId.isEmpty ? (placeId.isEmpty ? "watching" : "place") : "plan") : target, in: &items)
        Self.upsertQueryItem("memoryId", value: memoryId, in: &items)
        Self.upsertQueryItem("placeId", value: placeId, in: &items)
        Self.upsertQueryItem("detail", value: detail, in: &items)
        Self.upsertQueryItem("signal", value: signal, in: &items)
        Self.upsertQueryItem("timeScope", value: timeScope, in: &items)
        Self.upsertQueryItem("mode", value: mode, in: &items)
        Self.upsertQueryItem("source", value: source.isEmpty ? "ios-apns" : source, in: &items)
        components.queryItems = items

        return components.url ?? baseURL
    }

    private func notificationPayload(from userInfo: [AnyHashable: Any]) -> [String: Any] {
        var payload: [String: Any] = [:]
        mergeNotificationPayload(userInfo, into: &payload)

        ["data", "notification", "nearcast"].forEach { key in
            if let nested = userInfo[key] as? [AnyHashable: Any] {
                mergeNotificationPayload(nested, into: &payload)
            } else if let nested = userInfo[key] as? [String: Any] {
                nested.forEach { payload[$0.key] = $0.value }
            }
        }

        return payload
    }

    private func mergeNotificationPayload(_ source: [AnyHashable: Any], into payload: inout [String: Any]) {
        source.forEach { key, value in
            guard let name = key as? String, name != "aps" else { return }
            payload[name] = value
        }
    }

    private static func notificationURL(_ value: String, baseURL: URL) -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed, relativeTo: baseURL)?.absoluteURL else {
            return baseURL
        }

        guard url.host == "getnearcast.app" || url.host == "www.getnearcast.app" || url.host == baseURL.host else {
            return baseURL
        }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return baseURL
        }
        if let baseComponents = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) {
            components.scheme = baseComponents.scheme
            components.host = baseComponents.host
            components.port = baseComponents.port
        }
        return components.url ?? baseURL
    }

    private static func upsertQueryItem(_ name: String, value: String, in items: inout [URLQueryItem]) {
        items.removeAll { $0.name == name }
        guard !value.isEmpty else { return }
        items.append(URLQueryItem(name: name, value: value))
    }

    private static func queryValue(_ name: String, in items: [URLQueryItem]) -> String? {
        items.first { $0.name == name }?.value
    }

    private static func normalizedURLString(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }

        components.scheme = components.scheme?.lowercased()
        components.host = components.host?.lowercased()

        if components.path == "/" {
            components.path = ""
        }

        return components.string ?? url.absoluteString
    }

    private static func cleanText(_ value: Any?, limit: Int) -> String {
        String(describing: value ?? "")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .prefix(limit)
            .description
    }

    private static func cleanToken(_ value: Any?, limit: Int) -> String {
        cleanText(value, limit: limit)
            .replacingOccurrences(of: "[^a-zA-Z0-9._:-]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
}
