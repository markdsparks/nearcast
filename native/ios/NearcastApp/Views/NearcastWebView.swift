import SwiftUI
import UIKit
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
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.delegate = context.coordinator
        webView.scrollView.pinchGestureRecognizer?.delegate = context.coordinator
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 0.94, green: 0.98, blue: 1.0, alpha: 1.0)
        webView.scrollView.backgroundColor = webView.backgroundColor

        context.coordinator.bridge.webView = webView
        model.attach(webView)
        context.coordinator.load(model.currentURL, revision: model.navigationRevision, in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard !context.coordinator.hasRequested(model.currentURL, revision: model.navigationRevision) else { return }
        context.coordinator.load(model.currentURL, revision: model.navigationRevision, in: webView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        let bridge: NativeBridge
        private weak var model: NearcastWebModel?
        private var requestedURL: URL?
        private var requestedRevision: Int?

        init(model: NearcastWebModel) {
            self.model = model
            bridge = NativeBridge(model: model)
        }

        func load(_ url: URL, revision: Int, in webView: WKWebView) {
            requestedURL = url
            requestedRevision = revision
            DispatchQueue.main.async { [weak self] in
                self?.model?.startLoading()
            }
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
        }

        func hasRequested(_ url: URL, revision: Int) -> Bool {
            guard let requestedURL else { return false }
            return requestedRevision == revision &&
                Self.normalizedURLString(requestedURL) == Self.normalizedURLString(url)
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

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            model?.recoverFromWebContentTermination()
        }

        private static func isCancelledNavigation(_ error: Error) -> Bool {
            let nsError = error as NSError
            return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
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

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }
    }
}
