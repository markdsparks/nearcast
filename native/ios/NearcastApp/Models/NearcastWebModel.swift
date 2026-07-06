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
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
    }

    func load(_ nextMode: NearcastWebMode) {
        mode = nextMode
        NativeRuntimeConfiguration.storeMode(nextMode)
        currentURL = nextMode == .local ? localURL : NativeRuntimeConfiguration.productionURL
        hasLoadedPage = false
        lastError = nil
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
            currentURL = url
        }
        lastError = nil
    }

    func reload() {
        hasLoadedPage = false
        lastError = nil
        webView?.reloadFromOrigin()
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

    func recordBridgeMessage(_ body: Any) {
        if let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted]),
           let value = String(data: data, encoding: .utf8) {
            lastBridgeMessage = value
        } else {
            lastBridgeMessage = String(describing: body)
        }
    }
}
