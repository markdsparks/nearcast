import Foundation
import CoreMotion
import CoreLocation
import UIKit
import WebKit
import WidgetKit

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler, @preconcurrency CLLocationManagerDelegate {
    weak var model: NearcastWebModel?
    weak var webView: WKWebView?

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private var pendingLocationRequests: [String: Task<Void, Never>] = [:]
    private var ambientMotionActive = false
    private var ambientMotionFrequencyHz = 8.0
    private var ambientMotionHeading: CLHeading?
    private var ambientMotionLatestSample: [String: Any]?
    private var ambientMotionObservers: [NSObjectProtocol] = []
    private var hasTornDown = false

    init(model: NearcastWebModel) {
        self.model = model
        super.init()
        locationManager.delegate = self
        observeApplicationLifecycle()
        NativeWatchSnapshotSync.shared.activate()
    }

    deinit {
        motionManager.stopDeviceMotionUpdates()
        locationManager.stopUpdatingHeading()
        ambientMotionObservers.forEach(NotificationCenter.default.removeObserver)
        pendingLocationRequests.values.forEach { $0.cancel() }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let frameURL = message.frameInfo.request.url
        let isMainFrame = message.frameInfo.isMainFrame
        model?.recordBridgeMessage(message.body)
        handleBridgeMessage(message.body, frameURL: frameURL, isMainFrame: isMainFrame)
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

          const pendingStormActivityRequests = new Map();
          let nativeStormActivityRequestId = 0;
          window.NearcastNative.__resolveStormActivityRequest = function(result) {
            const requestId = result && result.requestId ? String(result.requestId) : "";
            const pending = pendingStormActivityRequests.get(requestId);
            if (!pending) return;
            pendingStormActivityRequests.delete(requestId);
            if (pending.timer) window.clearTimeout(pending.timer);
            pending.resolve(result || { ok: false, state: "failed", reason: "native-storm-activity-empty-result" });
          };

          function nativeStormActivityRequest(type, options) {
            const requestId = String(++nativeStormActivityRequestId);
            return new Promise((resolve) => {
              const timer = window.setTimeout(() => {
                if (!pendingStormActivityRequests.has(requestId)) return;
                pendingStormActivityRequests.delete(requestId);
                resolve({ ok: false, state: "timeout", reason: "native-storm-activity-timeout" });
              }, 8000);
              pendingStormActivityRequests.set(requestId, { resolve, timer });
              window.NearcastNative.postMessage({
                type,
                requestId,
                options: options || {}
              });
            });
          }

          window.NearcastNative.stormActivity = {
            supported: true,
            start(options) {
              return nativeStormActivityRequest("stormActivity.start", options);
            },
            update(options) {
              return nativeStormActivityRequest("stormActivity.update", options);
            },
            end(options) {
              return nativeStormActivityRequest("stormActivity.end", options || {});
            },
            status() {
              return nativeStormActivityRequest("stormActivity.status", {});
            }
          };

          if (window.self === window.top) {
            const pendingAmbientMotionRequests = new Map();
            let nativeAmbientMotionRequestId = 0;

            window.NearcastNative.__resolveAmbientMotionRequest = function(result) {
              const requestId = result && result.requestId ? String(result.requestId) : "";
              if (result && typeof result.active === "boolean") {
                window.NearcastNative.ambientMotion.active = result.active;
              }
              if (result && result.latest && typeof result.latest === "object") {
                window.NearcastNative.ambientMotion.latest = result.latest;
              } else if (result && result.active === false) {
                window.NearcastNative.ambientMotion.latest = null;
              }
              const pending = pendingAmbientMotionRequests.get(requestId);
              if (!pending) return;
              pendingAmbientMotionRequests.delete(requestId);
              if (pending.timer) window.clearTimeout(pending.timer);
              pending.resolve(result || {
                ok: false,
                active: false,
                state: "failed",
                reason: "native-ambient-motion-empty-result"
              });
            };

            function nativeAmbientMotionRequest(type, options) {
              const requestId = String(++nativeAmbientMotionRequestId);
              return new Promise((resolve) => {
                const timer = window.setTimeout(() => {
                  if (!pendingAmbientMotionRequests.has(requestId)) return;
                  pendingAmbientMotionRequests.delete(requestId);
                  resolve({
                    ok: false,
                    active: !!window.NearcastNative.ambientMotion.active,
                    state: "timeout",
                    reason: "native-ambient-motion-timeout"
                  });
                }, 5000);
                pendingAmbientMotionRequests.set(requestId, { resolve, timer });
                window.NearcastNative.postMessage({
                  type,
                  requestId,
                  options: options || {}
                });
              });
            }

            window.NearcastNative.__receiveAmbientMotion = function(payload) {
              const detail = payload || {};
              if (typeof detail.active === "boolean") {
                window.NearcastNative.ambientMotion.active = detail.active;
              }
              if (detail.kind === "sample") {
                window.NearcastNative.ambientMotion.latest = detail;
              } else if (detail.active === false) {
                window.NearcastNative.ambientMotion.latest = null;
              }
              window.dispatchEvent(new CustomEvent("nearcast-ambient-motion", { detail }));
            };

            window.NearcastNative.ambientMotion = {
              supported: true,
              active: false,
              latest: null,
              start(options) {
                return nativeAmbientMotionRequest("ambientMotion.start", options || {});
              },
              stop() {
                return nativeAmbientMotionRequest("ambientMotion.stop", {});
              },
              status() {
                return nativeAmbientMotionRequest("ambientMotion.status", {});
              }
            };
          }

          window.dispatchEvent(new CustomEvent("nearcast-native-ready", {
            detail: { platform: "ios", version: "0.2.0" }
          }));
        })();
        """

        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    private func handleBridgeMessage(_ body: Any, frameURL: URL?, isMainFrame: Bool) {
        guard let payload = body as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }

        if type.hasPrefix("ambientMotion.") {
            guard isTrustedAmbientFrame(url: frameURL, isMainFrame: isMainFrame) else {
                rejectAmbientMotionRequest(payload, reason: "untrusted-frame")
                return
            }

            if type == "ambientMotion.start" {
                startAmbientMotion(payload)
            } else if type == "ambientMotion.stop" {
                stopAmbientMotionRequest(payload)
            } else if type == "ambientMotion.status" {
                sendAmbientMotionStatus(payload)
            } else {
                rejectAmbientMotionRequest(payload, reason: "unsupported-request")
            }
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
        } else if type == "stormActivity.start" || type == "stormActivity.update" {
            startOrUpdateStormActivity(payload)
        } else if type == "stormActivity.end" {
            endStormActivity(payload)
        } else if type == "stormActivity.status" {
            sendStormActivityStatus(payload)
        }
    }

    private func isTrustedAmbientFrame(url: URL?, isMainFrame: Bool) -> Bool {
        guard isMainFrame,
              let url,
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased() else {
            return false
        }

        if scheme == "https" && host == "getnearcast.app" {
            return true
        }

        #if DEBUG
        guard let configuredURL = model?.currentURL else { return false }
        return Self.sameOrigin(url, configuredURL)
        #else
        return false
        #endif
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        guard let lhsScheme = lhs.scheme?.lowercased(),
              let rhsScheme = rhs.scheme?.lowercased(),
              let lhsHost = lhs.host?.lowercased(),
              let rhsHost = rhs.host?.lowercased() else {
            return false
        }

        return lhsScheme == rhsScheme &&
            lhsHost == rhsHost &&
            normalizedPort(lhs) == normalizedPort(rhs)
    }

    private static func normalizedPort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "https":
            return 443
        case "http":
            return 80
        default:
            return nil
        }
    }

    private func startAmbientMotion(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        let unboundedFrequency = (options["frequencyHz"] as? NSNumber)?.doubleValue ?? 8.0
        let requestedFrequency = unboundedFrequency.isFinite ? unboundedFrequency : 8.0
        let frequencyHz = min(10.0, max(4.0, requestedFrequency))

        guard !hasTornDown else {
            sendAmbientMotionResult(
                requestId: requestId,
                ok: false,
                state: "unavailable",
                reason: "bridge-torn-down"
            )
            return
        }

        guard UIApplication.shared.applicationState == .active else {
            sendAmbientMotionResult(
                requestId: requestId,
                ok: false,
                state: "inactive",
                reason: "app-not-active"
            )
            return
        }

        let motionAvailable = motionManager.isDeviceMotionAvailable
        let headingAvailable = CLLocationManager.headingAvailable()
        guard motionAvailable || headingAvailable else {
            sendAmbientMotionResult(
                requestId: requestId,
                ok: false,
                state: "unavailable",
                reason: "sensors-unavailable"
            )
            return
        }

        if ambientMotionActive {
            stopAmbientMotion(reason: "restarting", notifyJavaScript: false)
        }

        ambientMotionFrequencyHz = frequencyHz
        ambientMotionActive = true
        ambientMotionHeading = nil
        ambientMotionLatestSample = nil

        if headingAvailable {
            locationManager.headingFilter = 2.0
            locationManager.headingOrientation = currentHeadingOrientation()
            locationManager.startUpdatingHeading()
        }

        if motionAvailable {
            motionManager.deviceMotionUpdateInterval = 1.0 / frequencyHz
            let frames = CMMotionManager.availableAttitudeReferenceFrames()
            let referenceFrame: CMAttitudeReferenceFrame = frames.contains(.xArbitraryCorrectedZVertical)
                ? .xArbitraryCorrectedZVertical
                : .xArbitraryZVertical

            motionManager.startDeviceMotionUpdates(using: referenceFrame, to: .main) { [weak self] motion, _ in
                guard let motion else { return }
                let pitch = motion.attitude.pitch
                let roll = motion.attitude.roll
                Task { @MainActor in
                    self?.deliverAmbientMotionSample(pitch: pitch, roll: roll)
                }
            }
        }

        sendAmbientMotionEvent([
            "kind": "state",
            "active": true,
            "state": "active",
            "frequencyHz": frequencyHz,
            "timestamp": Self.currentTimestampMilliseconds()
        ])
        sendAmbientMotionResult(requestId: requestId, ok: true, state: "active")
    }

    private func stopAmbientMotionRequest(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        stopAmbientMotion(reason: "requested", notifyJavaScript: true)
        sendAmbientMotionResult(requestId: requestId, ok: true, state: "stopped")
    }

    private func sendAmbientMotionStatus(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        sendAmbientMotionResult(
            requestId: requestId,
            ok: true,
            state: ambientMotionActive ? "active" : "stopped"
        )
    }

    private func rejectAmbientMotionRequest(_ payload: [String: Any], reason: String) {
        let requestId = payload["requestId"] as? String ?? ""
        sendAmbientMotionResult(requestId: requestId, ok: false, state: "rejected", reason: reason)
    }

    private func sendAmbientMotionResult(
        requestId: String,
        ok: Bool,
        state: String,
        reason: String? = nil
    ) {
        var result: [String: Any] = [
            "requestId": requestId,
            "ok": ok,
            "supported": true,
            "active": ambientMotionActive,
            "state": state,
            "motionAvailable": motionManager.isDeviceMotionAvailable,
            "headingAvailable": CLLocationManager.headingAvailable(),
            "frequencyHz": ambientMotionFrequencyHz,
            "latest": ambientMotionLatestSample ?? NSNull()
        ]
        if let reason {
            result["reason"] = reason
        }
        sendJavaScriptCallback(result, resolver: "__resolveAmbientMotionRequest")
    }

    private func deliverAmbientMotionSample(pitch: Double?, roll: Double?) {
        guard ambientMotionActive else { return }

        let heading = usableAmbientHeading()
        let boundedPitch = Self.boundedAttitudeValue(pitch)
        let boundedRoll = Self.boundedAttitudeValue(roll)
        let sample: [String: Any] = [
            "kind": "sample",
            "active": true,
            "heading": heading.value ?? NSNull(),
            "headingReference": heading.reference,
            "headingAccuracy": heading.accuracy ?? NSNull(),
            "pitch": boundedPitch ?? NSNull(),
            "roll": boundedRoll ?? NSNull(),
            "timestamp": Self.currentTimestampMilliseconds()
        ]
        ambientMotionLatestSample = sample
        sendAmbientMotionEvent(sample)
    }

    private func usableAmbientHeading() -> (value: Double?, reference: String, accuracy: Double?) {
        guard let ambientMotionHeading else {
            return (nil, "unavailable", nil)
        }

        guard ambientMotionHeading.headingAccuracy >= 0,
              ambientMotionHeading.headingAccuracy.isFinite else {
            return (nil, "unavailable", nil)
        }
        let accuracy = ambientMotionHeading.headingAccuracy
        if ambientMotionHeading.trueHeading >= 0, ambientMotionHeading.trueHeading.isFinite {
            return (ambientMotionHeading.trueHeading, "true", accuracy)
        }
        if ambientMotionHeading.magneticHeading >= 0, ambientMotionHeading.magneticHeading.isFinite {
            return (ambientMotionHeading.magneticHeading, "magnetic", accuracy)
        }
        return (nil, "unavailable", accuracy)
    }

    private static func boundedAttitudeValue(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        let limit = Double.pi / 3.0
        return min(limit, max(-limit, value))
    }

    private static func currentTimestampMilliseconds() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }

    private func sendAmbientMotionEvent(_ payload: [String: Any]) {
        sendJavaScriptCallback(payload, resolver: "__receiveAmbientMotion")
    }

    private func currentHeadingOrientation() -> CLDeviceOrientation {
        guard let orientation = webView?.window?.windowScene?.interfaceOrientation else {
            return .portrait
        }

        switch orientation {
        case .portrait:
            return .portrait
        case .portraitUpsideDown:
            return .portraitUpsideDown
        case .landscapeLeft:
            return .landscapeLeft
        case .landscapeRight:
            return .landscapeRight
        default:
            return .portrait
        }
    }

    private func observeApplicationLifecycle() {
        let center = NotificationCenter.default
        ambientMotionObservers = [
            center.addObserver(
                forName: UIApplication.willResignActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.stopAmbientMotion(reason: "app-inactive", notifyJavaScript: true)
                }
            },
            center.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.stopAmbientMotion(reason: "background", notifyJavaScript: true)
                }
            }
        ]
    }

    private func stopAmbientMotion(reason: String, notifyJavaScript: Bool) {
        let wasActive = ambientMotionActive
        motionManager.stopDeviceMotionUpdates()
        locationManager.stopUpdatingHeading()
        ambientMotionActive = false
        ambientMotionHeading = nil
        ambientMotionLatestSample = nil

        guard notifyJavaScript, wasActive else { return }
        sendAmbientMotionEvent([
            "kind": "state",
            "active": false,
            "state": "stopped",
            "reason": reason,
            "timestamp": Self.currentTimestampMilliseconds()
        ])
    }

    func stopAmbientMotionForNavigation() {
        stopAmbientMotion(reason: "navigation", notifyJavaScript: true)
    }

    func tearDown() {
        guard !hasTornDown else { return }
        hasTornDown = true
        stopAmbientMotion(reason: "teardown", notifyJavaScript: false)
        ambientMotionObservers.forEach(NotificationCenter.default.removeObserver)
        ambientMotionObservers.removeAll()
        pendingLocationRequests.values.forEach { $0.cancel() }
        pendingLocationRequests.removeAll()
        webView = nil
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

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard ambientMotionActive else { return }
        ambientMotionHeading = newHeading
        if !motionManager.isDeviceMotionActive {
            deliverAmbientMotionSample(pitch: nil, roll: nil)
        }
    }

    func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        false
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

        var placeData: Data?
        var incomingPlace: NearcastWidgetPlace?
        if let place = payload["place"] as? [String: Any],
           JSONSerialization.isValidJSONObject(place),
           let encodedPlace = try? JSONSerialization.data(withJSONObject: place, options: []) {
            placeData = encodedPlace
            incomingPlace = try? JSONDecoder().decode(NearcastWidgetPlace.self, from: encodedPlace)
        }

        var resolvedData = data
        if let incoming = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data),
           incoming.alertStateReady != true,
           let incomingPlace,
           let storedPlace = NearcastWidgetPlace.stored(),
           abs(incomingPlace.latitude - storedPlace.latitude) < 0.00001,
           abs(incomingPlace.longitude - storedPlace.longitude) < 0.00001,
           let stored = NearcastWidgetSnapshot.stored() {
            let currentStored = stored.expiringOfficialAlert(at: Date().timeIntervalSince1970)
            let resolved = incoming.preservingOfficialAlert(from: currentStored)
            if let encoded = try? JSONEncoder().encode(resolved) {
                resolvedData = encoded
            }
        }

        NearcastWidgetSnapshotStore.saveSnapshotData(resolvedData)
        if let placeData {
            NearcastWidgetSnapshotStore.savePlaceData(placeData)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: NearcastWidgetSnapshotStore.widgetKind)
        NativeWatchSnapshotSync.shared.sendSnapshotData(resolvedData, placeData: placeData)
    }

    private func startOrUpdateStormActivity(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        Task { @MainActor in
            var result = await NativeStormActivityController.shared.startOrUpdate(from: options)
            result["requestId"] = requestId
            sendJavaScriptCallback(result, resolver: "__resolveStormActivityRequest")
        }
    }

    private func endStormActivity(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        Task { @MainActor in
            var result = await NativeStormActivityController.shared.end(options)
            result["requestId"] = requestId
            sendJavaScriptCallback(result, resolver: "__resolveStormActivityRequest")
        }
    }

    private func sendStormActivityStatus(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        var result = NativeStormActivityController.shared.status()
        result["requestId"] = requestId
        sendJavaScriptCallback(result, resolver: "__resolveStormActivityRequest")
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
