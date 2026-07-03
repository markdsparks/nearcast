import Foundation
import WebKit

@MainActor
final class NearcastWebModel: ObservableObject {
    @Published private(set) var mode: NearcastWebMode
    @Published private(set) var currentURL: URL
    @Published var localURLText: String
    @Published var isLoading = false
    @Published var lastError: String?
    @Published var lastBridgeMessage = "No bridge messages yet"

    private weak var webView: WKWebView?
    private var localURL: URL

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
        webView?.reloadFromOrigin()
    }

    func goBackIfPossible() {
        guard let webView, webView.canGoBack else { return }
        webView.goBack()
    }

    func setLoading(_ value: Bool) {
        isLoading = value
    }

    func setError(_ error: Error?) {
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
