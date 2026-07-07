import Foundation
import CoreLocation
import WebKit
import WidgetKit

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {
    weak var model: NearcastWebModel?
    weak var webView: WKWebView?

    private let locationManager = CLLocationManager()
    private var pendingLocationRequests: [String: Task<Void, Never>] = [:]

    init(model: NearcastWebModel) {
        self.model = model
        super.init()
        locationManager.delegate = self
    }

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor in
            model?.recordBridgeMessage(message.body)
            handleBridgeMessage(message.body)
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
          const pendingGeolocation = new Map();
          let nativeGeolocationRequestId = 0;

          window.NearcastNative.__resolveGeolocation = function(result) {
            const requestId = result && result.requestId ? String(result.requestId) : "";
            const pending = pendingGeolocation.get(requestId);
            if (!pending) return;
            pendingGeolocation.delete(requestId);
            if (pending.timer) window.clearTimeout(pending.timer);

            if (result.ok) {
              const coords = result.coords || {};
              pending.success({
                coords: {
                  latitude: Number(coords.latitude),
                  longitude: Number(coords.longitude),
                  accuracy: Number(coords.accuracy || 0),
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null
                },
                timestamp: Number(result.timestamp || Date.now())
              });
              return;
            }

            const code = Number(result.code || 2);
            pending.error({
              code,
              message: result.message || "Location is unavailable.",
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            });
          };

          function nativeGetCurrentPosition(success, error, options) {
            if (typeof success !== "function") {
              throw new TypeError("getCurrentPosition requires a success callback");
            }

            const failure = typeof error === "function" ? error : function() {};
            const requestId = String(++nativeGeolocationRequestId);
            const timeoutValue = options && Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 10000;
            const timeoutMs = Math.max(1000, timeoutValue);
            const timer = window.setTimeout(() => {
              if (!pendingGeolocation.has(requestId)) return;
              pendingGeolocation.delete(requestId);
              failure({
                code: 3,
                message: "Location lookup timed out.",
                PERMISSION_DENIED: 1,
                POSITION_UNAVAILABLE: 2,
                TIMEOUT: 3
              });
            }, timeoutMs + 1000);

            pendingGeolocation.set(requestId, { success, error: failure, timer });
            window.NearcastNative.postMessage({
              type: "geolocation.getCurrentPosition",
              requestId,
              options: {
                enableHighAccuracy: !!(options && options.enableHighAccuracy),
                timeout: timeoutMs,
                maximumAge: options && Number.isFinite(Number(options.maximumAge)) ? Number(options.maximumAge) : 0
              }
            });
          }

          if (navigator.geolocation) {
            try {
              Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
                value: nativeGetCurrentPosition,
                configurable: true
              });
            } catch (error) {
              try {
                navigator.geolocation.getCurrentPosition = nativeGetCurrentPosition;
              } catch (assignError) {
                console.warn("Nearcast native geolocation bridge unavailable", assignError);
              }
            }
          }

          const pendingNotificationRequests = new Map();
          let nativeNotificationRequestId = 0;

          window.NearcastNative.notificationPermission = "default";
          window.NearcastNative.notificationChannel = null;
          window.NearcastNative.__resolveNotificationRequest = function(result) {
            const requestId = result && result.requestId ? String(result.requestId) : "";
            if (result && typeof result.permission === "string") {
              window.NearcastNative.notificationPermission = result.permission;
            }
            if (result && result.channel) {
              window.NearcastNative.notificationChannel = result.channel;
            }
            const pending = pendingNotificationRequests.get(requestId);
            if (!pending) return;
            pendingNotificationRequests.delete(requestId);
            if (pending.timer) window.clearTimeout(pending.timer);
            pending.resolve(result || { ok: false, permission: "default", reason: "native-notification-empty-result" });
          };

          function nativeNotificationRequest(type, options) {
            const requestId = String(++nativeNotificationRequestId);
            return new Promise((resolve) => {
              const timer = window.setTimeout(() => {
                if (!pendingNotificationRequests.has(requestId)) return;
                pendingNotificationRequests.delete(requestId);
                resolve({
                  ok: false,
                  permission: window.NearcastNative.notificationPermission || "default",
                  state: "timeout",
                  reason: "native-notification-timeout"
                });
              }, 12000);
              pendingNotificationRequests.set(requestId, { resolve, timer });
              window.NearcastNative.postMessage({
                type,
                requestId,
                options: options || {}
              });
            });
          }

          window.NearcastNative.notifications = {
            supported: true,
            permission() {
              return window.NearcastNative.notificationPermission || "default";
            },
            channel() {
              return window.NearcastNative.notificationChannel || null;
            },
            requestPermission(options) {
              return nativeNotificationRequest("notifications.request", options);
            },
            status() {
              return nativeNotificationRequest("notifications.status", {});
            }
          };

          window.NearcastNative.notifications.status().catch(() => {});

          window.dispatchEvent(new CustomEvent("nearcast-native-ready", {
            detail: { platform: "ios", version: "0.1.0" }
          }));
        })();
        """

        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false)
    }

    private func handleBridgeMessage(_ body: Any) {
        guard let payload = body as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }

        if type == "geolocation.getCurrentPosition" {
            requestCurrentLocation(payload)
        } else if type == "notifications.request" {
            requestNativeNotifications(payload)
        } else if type == "notifications.status" {
            sendNativeNotificationStatus(payload)
        } else if type == "widget.snapshot" {
            saveWidgetSnapshot(payload)
        }
    }

    private func requestCurrentLocation(_ payload: [String: Any]) {
        guard let requestId = payload["requestId"] as? String else { return }

        let options = payload["options"] as? [String: Any] ?? [:]
        let enableHighAccuracy = options["enableHighAccuracy"] as? Bool ?? false
        let timeout = options["timeout"] as? Double ?? 10_000

        pendingLocationRequests[requestId]?.cancel()
        pendingLocationRequests[requestId] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(1_000, timeout + 1_500) * 1_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.rejectLocationRequest(requestId, code: 3, message: "Location lookup timed out.")
            }
        }

        locationManager.desiredAccuracy = enableHighAccuracy ? kCLLocationAccuracyBest : kCLLocationAccuracyKilometer

        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            locationManager.requestLocation()
        case .denied, .restricted:
            rejectLocationRequest(requestId, code: 1, message: "Location permission was not granted.")
        @unknown default:
            rejectLocationRequest(requestId, code: 2, message: "Location is unavailable.")
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !pendingLocationRequests.isEmpty else { return }

        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            rejectAllLocationRequests(code: 1, message: "Location permission was not granted.")
        case .notDetermined:
            break
        @unknown default:
            rejectAllLocationRequests(code: 2, message: "Location is unavailable.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else {
            rejectAllLocationRequests(code: 2, message: "Location is unavailable.")
            return
        }

        let requestIds = Array(pendingLocationRequests.keys)
        requestIds.forEach { resolveLocationRequest($0, location: location) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let nsError = error as NSError
        if nsError.domain == kCLErrorDomain && nsError.code == CLError.Code.denied.rawValue {
            rejectAllLocationRequests(code: 1, message: "Location permission was not granted.")
        } else {
            rejectAllLocationRequests(code: 2, message: "Current location is unavailable.")
        }
    }

    private func resolveLocationRequest(_ requestId: String, location: CLLocation) {
        completeLocationRequest(
            requestId,
            payload: [
                "requestId": requestId,
                "ok": true,
                "timestamp": Int(location.timestamp.timeIntervalSince1970 * 1000),
                "coords": [
                    "latitude": location.coordinate.latitude,
                    "longitude": location.coordinate.longitude,
                    "accuracy": location.horizontalAccuracy
                ]
            ]
        )
    }

    private func rejectLocationRequest(_ requestId: String, code: Int, message: String) {
        completeLocationRequest(
            requestId,
            payload: [
                "requestId": requestId,
                "ok": false,
                "code": code,
                "message": message
            ]
        )
    }

    private func rejectAllLocationRequests(code: Int, message: String) {
        let requestIds = Array(pendingLocationRequests.keys)
        requestIds.forEach { rejectLocationRequest($0, code: code, message: message) }
    }

    private func completeLocationRequest(_ requestId: String, payload: [String: Any]) {
        pendingLocationRequests[requestId]?.cancel()
        pendingLocationRequests[requestId] = nil
        sendJavaScriptCallback(payload, resolver: "__resolveGeolocation")
    }

    private func requestNativeNotifications(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        let reason = options["reason"] as? String ?? "plan-watch"
        Task { @MainActor in
            var result = await NativeNotificationRegistry.shared.requestChannel(reason: reason)
            result["requestId"] = requestId
            sendJavaScriptCallback(result, resolver: "__resolveNotificationRequest")
        }
    }

    private func sendNativeNotificationStatus(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        Task { @MainActor in
            var result = await NativeNotificationRegistry.shared.currentStatus()
            result["requestId"] = requestId
            sendJavaScriptCallback(result, resolver: "__resolveNotificationRequest")
        }
    }

    private func saveWidgetSnapshot(_ payload: [String: Any]) {
        guard let snapshot = payload["snapshot"] as? [String: Any],
              JSONSerialization.isValidJSONObject(snapshot),
              let data = try? JSONSerialization.data(withJSONObject: snapshot, options: []) else {
            return
        }
        guard let defaults = UserDefaults(suiteName: NativeWidgetSnapshotStore.suiteName) else {
            return
        }
        defaults.set(data, forKey: NativeWidgetSnapshotStore.snapshotKey)
        if let place = payload["place"] as? [String: Any],
           JSONSerialization.isValidJSONObject(place),
           let placeData = try? JSONSerialization.data(withJSONObject: place, options: []) {
            defaults.set(placeData, forKey: NativeWidgetSnapshotStore.placeKey)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: NativeWidgetSnapshotStore.widgetKind)
    }

    private func sendJavaScriptCallback(_ payload: [String: Any], resolver: String) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        let script = "window.NearcastNative&&window.NearcastNative.\(resolver)&&window.NearcastNative.\(resolver)(\(json));"
        webView?.evaluateJavaScript(script)
    }
}

enum NativeWidgetSnapshotStore {
    static let suiteName = "group.app.nearcast.ios"
    static let snapshotKey = "nearcast.widget.snapshot.v1"
    static let placeKey = "nearcast.widget.place.v1"
    static let widgetKind = "NearcastWidget"
}
