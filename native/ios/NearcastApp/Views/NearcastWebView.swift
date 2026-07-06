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
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 0.94, green: 0.98, blue: 1.0, alpha: 1.0)
        webView.scrollView.backgroundColor = webView.backgroundColor

        model.attach(webView)
        webView.load(URLRequest(url: model.currentURL, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url?.absoluteString != model.currentURL.absoluteString else { return }
        guard !model.isLoading else { return }
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
            model?.startLoading()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model?.finishLoading()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard !Self.isCancelledNavigation(error) else {
                model?.ignoreCancelledNavigation()
                return
            }
            model?.setError(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !Self.isCancelledNavigation(error) else {
                model?.ignoreCancelledNavigation()
                return
            }
            model?.setError(error)
        }

        private static func isCancelledNavigation(_ error: Error) -> Bool {
            let nsError = error as NSError
            return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
        }
    }
}
