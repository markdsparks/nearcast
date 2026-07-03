import Foundation
import WebKit

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var model: NearcastWebModel?

    init(model: NearcastWebModel) {
        self.model = model
    }

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor in
            model?.recordBridgeMessage(message.body)
        }
    }

    static func bootstrapScript() -> WKUserScript {
        let source = """
        (() => {
          if (window.NearcastNative) return;
          window.NearcastNative = {
            platform: "ios",
            postMessage(payload) {
              try {
                window.webkit.messageHandlers.nearcastNative.postMessage(payload || {});
              } catch (error) {
                console.warn("Nearcast native bridge unavailable", error);
              }
            }
          };
          window.dispatchEvent(new CustomEvent("nearcast-native-ready", {
            detail: { platform: "ios", version: "0.1.0" }
          }));
        })();
        """

        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    }
}
