import SwiftUI
import WebKit

struct NearcastWebView: UIViewRepresentable {
    @ObservedObject var model: NearcastWebModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "NearcastNative/0.1"
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(NativeBridge.bootstrapScript())
        configuration.userContentController.add(context.coordinator.bridge, name: "nearcastNative")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear

        model.attach(webView)
        webView.load(URLRequest(url: model.currentURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url?.absoluteString != model.currentURL.absoluteString else { return }
        webView.load(URLRequest(url: model.currentURL, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let bridge: NativeBridge
        private weak var model: NearcastWebModel?

        init(model: NearcastWebModel) {
            self.model = model
            bridge = NativeBridge(model: model)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            model?.setLoading(true)
            model?.setError(nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model?.setLoading(false)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            model?.setLoading(false)
            model?.setError(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            model?.setLoading(false)
            model?.setError(error)
        }
    }
}
