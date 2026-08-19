import Foundation
import AVFoundation
import CoreMotion
import CoreLocation
import Speech
import UIKit
import WebKit
import WidgetKit

private let nearcastNativeResolvedWidgetLocationKey = "nearcast.widget.resolved-location.v1"

private enum NativeBridgeOperonError: LocalizedError {
    case cancelled
    case timedOut
    case invalidResult
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .cancelled: return "The native Operon request was cancelled."
        case .timedOut: return "Nearcast timed out while completing an Operon capability."
        case .invalidResult: return "Nearcast returned an invalid Operon capability result."
        case .commandFailed(let message): return message
        }
    }
}

private struct NearcastNativeResolvedWidgetLocation: Decodable {
    let selectionIdentity: String
    let latitude: Double
    let longitude: Double
    let horizontalAccuracy: Double
    let resolvedAt: TimeInterval
    let requiresWeatherRefresh: Bool
}

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler, @preconcurrency CLLocationManagerDelegate {
    weak var model: NearcastWebModel?
    weak var webView: WKWebView?

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private var pendingLocationRequests: [String: Task<Void, Never>] = [:]
    private var pendingAIRequests: [String: Task<Void, Never>] = [:]
    private var pendingOperonCommands: [String: CheckedContinuation<String, Error>] = [:]
    private var pendingOperonTimeouts: [String: Task<Void, Never>] = [:]
    private var operonCommandSequence = 0
    private let speechAudioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var speechRecognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var speechRecognitionTask: SFSpeechRecognitionTask?
    private var speechPermissionTask: Task<Void, Never>?
    private var speechFinishTask: Task<Void, Never>?
    private var speechRequestId = ""
    private var speechTranscript = ""
    private var speechTapInstalled = false
    private var speechStopRequested = false
    private var speechLastLevelDelivery = Date.distantPast
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
        speechPermissionTask?.cancel()
        speechFinishTask?.cancel()
        speechRecognitionTask?.cancel()
        speechAudioEngine.stop()
        motionManager.stopDeviceMotionUpdates()
        locationManager.stopUpdatingHeading()
        ambientMotionObservers.forEach(NotificationCenter.default.removeObserver)
        pendingLocationRequests.values.forEach { $0.cancel() }
        pendingAIRequests.values.forEach { $0.cancel() }
        pendingOperonTimeouts.values.forEach { $0.cancel() }
        pendingOperonCommands.values.forEach {
            $0.resume(throwing: NativeBridgeOperonError.cancelled)
        }
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

          const pendingAIRequests = new Map();
          const pendingOperonRuns = new Map();
          let nativeAIRequestId = 0;
          window.NearcastNative.__resolveAIRequest = function(result) {
            const requestId = result && result.requestId ? String(result.requestId) : "";
            const pending = pendingAIRequests.get(requestId);
            if (!pending) return;
            pendingAIRequests.delete(requestId);
            pendingOperonRuns.delete(requestId);
            if (pending.timer) window.clearTimeout(pending.timer);
            if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
            pending.resolve(result || {
              ok: false,
              available: false,
              reason: "native-ai-empty-result"
            });
          };

          function nativeAIRequest(type, options, timeoutMs, signal, handlers) {
            const requestId = String(++nativeAIRequestId);
            return new Promise((resolve) => {
              const timer = window.setTimeout(() => {
                const pending = pendingAIRequests.get(requestId);
                if (!pending) return;
                pendingAIRequests.delete(requestId);
                pendingOperonRuns.delete(requestId);
                if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
                window.NearcastNative.postMessage({
                  type: "ai.cancel",
                  requestId: `timeout-${requestId}`,
                  options: { targetRequestId: requestId }
                });
                resolve({
                  ok: false,
                  available: false,
                  reason: "native-ai-timeout",
                  message: "The on-device model timed out."
                });
              }, timeoutMs);
              const onAbort = () => {
                if (!pendingAIRequests.has(requestId)) return;
                pendingAIRequests.delete(requestId);
                pendingOperonRuns.delete(requestId);
                window.clearTimeout(timer);
                window.NearcastNative.postMessage({
                  type: "ai.cancel",
                  requestId: `cancel-${requestId}`,
                  options: { targetRequestId: requestId }
                });
                resolve({
                  ok: false,
                  available: true,
                  reason: "cancelled",
                  message: "The on-device model request was cancelled."
                });
              };
              pendingAIRequests.set(requestId, { resolve, timer, signal, onAbort });
              if (handlers) pendingOperonRuns.set(requestId, handlers);
              if (signal && typeof signal.addEventListener === "function") {
                if (signal.aborted) {
                  onAbort();
                  return;
                }
                signal.addEventListener("abort", onAbort, { once: true });
              }
              window.NearcastNative.postMessage({
                type,
                requestId,
                options: options || {}
              });
            });
          }

          window.NearcastNative.__receiveOperonCommand = function(command) {
            const runId = command && command.runId ? String(command.runId) : "";
            const commandId = command && command.commandId ? String(command.commandId) : "";
            const handlers = pendingOperonRuns.get(runId);
            const kind = String(command && command.kind || "");
            const handlerName = {
              load_session: "loadSession",
              search_memory: "searchMemory",
              prepare_skill: "prepareSkill",
              invoke_skill: "invokeSkill"
            }[kind];
            const handler = handlers && handlerName ? handlers[handlerName] : null;
            handlers && handlers.onProgress && handlers.onProgress({
              kind: "command_started",
              command: { kind }
            });
            Promise.resolve()
              .then(() => {
                if (typeof handler !== "function") throw new Error(`Nearcast does not implement ${kind}.`);
                return handler(command.payload || {});
              })
              .then((result) => {
                window.NearcastNative.postMessage({
                  type: "ai.operonEvent",
                  requestId: `event-${commandId}`,
                  options: { commandId, result }
                });
              })
              .catch((error) => {
                window.NearcastNative.postMessage({
                  type: "ai.operonEvent",
                  requestId: `event-${commandId}`,
                  options: { commandId, error: String(error && error.message || error || "Nearcast command failed") }
                });
              });
          };

          window.NearcastNative.__receiveOperonProgress = function(payload) {
            const runId = payload && payload.runId ? String(payload.runId) : "";
            const handlers = pendingOperonRuns.get(runId);
            if (!handlers || typeof handlers.onProgress !== "function") return;
            handlers.onProgress(payload && payload.event && typeof payload.event === "object"
              ? payload.event
              : {});
          };

          window.NearcastNative.ai = {
            supported: true,
            availability() {
              return nativeAIRequest("ai.availability", {}, 5000);
            },
            generate(options, signal) {
              return nativeAIRequest("ai.generate", options || {}, 70000, signal);
            },
            runAgent(options, handlers, signal) {
              return nativeAIRequest("ai.operonRun", options || {}, 120000, signal, handlers || {});
            }
          };

          let nativeSpeechRequestId = 0;
          window.NearcastNative.__receiveSpeechEvent = function(payload) {
            window.dispatchEvent(new CustomEvent("nearcast-native-speech", {
              detail: payload && typeof payload === "object" ? payload : {}
            }));
          };
          window.NearcastNative.speech = {
            supported: true,
            start(options) {
              const requestId = `speech-${++nativeSpeechRequestId}`;
              window.NearcastNative.postMessage({
                type: "speech.start",
                requestId,
                options: options || {}
              });
              return requestId;
            },
            stop(requestId) {
              window.NearcastNative.postMessage({
                type: "speech.stop",
                requestId: String(requestId || "")
              });
            },
            cancel(requestId) {
              window.NearcastNative.postMessage({
                type: "speech.cancel",
                requestId: String(requestId || "")
              });
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
            detail: { platform: "ios", version: "0.4.0" }
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

        if type.hasPrefix("ai.") {
            guard isTrustedAmbientFrame(url: frameURL, isMainFrame: isMainFrame) else {
                rejectNativeAIRequest(payload, reason: "untrusted-frame")
                return
            }
            if type == "ai.availability" {
                sendNativeAIAvailability(payload)
            } else if type == "ai.generate" {
                generateWithNativeAI(payload)
            } else if type == "ai.cancel" {
                cancelNativeAI(payload)
            } else if type == "ai.operonRun" {
                runWithNativeOperon(payload)
            } else if type == "ai.operonEvent" {
                receiveNativeOperonEvent(payload)
            } else {
                rejectNativeAIRequest(payload, reason: "unsupported-request")
            }
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

        if type.hasPrefix("speech.") {
            guard isTrustedAmbientFrame(url: frameURL, isMainFrame: isMainFrame) else {
                sendSpeechEvent(requestId: payload["requestId"] as? String ?? "", state: "error", reason: "untrusted-frame")
                return
            }
            if type == "speech.start" {
                startNativeSpeech(payload)
            } else if type == "speech.stop" {
                stopNativeSpeech(payload)
            } else if type == "speech.cancel" {
                cancelNativeSpeech(payload)
            } else {
                sendSpeechEvent(requestId: payload["requestId"] as? String ?? "", state: "error", reason: "unsupported-request")
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

    private func startNativeSpeech(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        let localeIdentifier = options["locale"] as? String ?? Locale.current.identifier
        guard !requestId.isEmpty, !hasTornDown else { return }
        guard UIApplication.shared.applicationState == .active else {
            sendSpeechEvent(requestId: requestId, state: "unavailable", reason: "app-not-active")
            return
        }

        endSpeechSession(notify: false, finalState: "cancelled")
        speechRequestId = requestId
        speechTranscript = ""
        speechStopRequested = false
        speechLastLevelDelivery = .distantPast
        sendSpeechEvent(requestId: requestId, state: "starting")

        speechPermissionTask = Task { [weak self] in
            guard let self else { return }
            let speechAuthorization = await Self.requestSpeechAuthorization()
            guard !Task.isCancelled, self.speechRequestId == requestId else { return }
            guard speechAuthorization == .authorized else {
                self.endSpeechSession(notify: true, finalState: "denied", reason: "speech-permission-denied")
                return
            }
            let microphoneAllowed = await Self.requestMicrophoneAuthorization()
            guard !Task.isCancelled, self.speechRequestId == requestId else { return }
            guard microphoneAllowed else {
                self.endSpeechSession(notify: true, finalState: "denied", reason: "microphone-permission-denied")
                return
            }
            if self.speechStopRequested {
                self.endSpeechSession(notify: true, finalState: "finished")
                return
            }
            self.beginSpeechRecognition(requestId: requestId, localeIdentifier: localeIdentifier)
        }
    }

    private static func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private static func requestMicrophoneAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func beginSpeechRecognition(requestId: String, localeIdentifier: String) {
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)) ?? SFSpeechRecognizer()
        guard let recognizer, recognizer.isAvailable else {
            endSpeechSession(notify: true, finalState: "unavailable", reason: "speech-recognizer-unavailable")
            return
        }
        guard recognizer.supportsOnDeviceRecognition else {
            endSpeechSession(notify: true, finalState: "unavailable", reason: "on-device-speech-unavailable")
            return
        }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = true
            request.addsPunctuation = true
            let inputNode = speechAudioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw NSError(domain: "NearcastSpeech", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone audio format is available."])
            }

            speechRecognizer = recognizer
            speechRecognitionRequest = request
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self, weak request] buffer, _ in
                request?.append(buffer)
                let level = Self.normalizedSpeechLevel(buffer)
                Task { @MainActor in
                    self?.deliverSpeechLevel(level, requestId: requestId)
                }
            }
            speechTapInstalled = true
            speechAudioEngine.prepare()
            try speechAudioEngine.start()

            speechRecognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    self?.receiveSpeechRecognition(result: result, error: error, requestId: requestId)
                }
            }
            sendSpeechEvent(requestId: requestId, state: "listening")
        } catch {
            endSpeechSession(notify: true, finalState: "error", reason: error.localizedDescription)
        }
    }

    private static func normalizedSpeechLevel(_ buffer: AVAudioPCMBuffer) -> Double {
        guard let channel = buffer.floatChannelData?.pointee else { return 0 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for index in 0..<count {
            let sample = channel[index]
            sum += sample * sample
        }
        let rms = sqrt(Double(sum) / Double(count))
        let decibels = 20 * log10(max(rms, 0.000_01))
        return min(1, max(0, (decibels + 55) / 45))
    }

    private func deliverSpeechLevel(_ level: Double, requestId: String) {
        guard speechRequestId == requestId, speechAudioEngine.isRunning else { return }
        let now = Date()
        guard now.timeIntervalSince(speechLastLevelDelivery) >= 1.0 / 18.0 else { return }
        speechLastLevelDelivery = now
        sendSpeechEvent(requestId: requestId, state: "listening", kind: "level", level: level)
    }

    private func receiveSpeechRecognition(result: SFSpeechRecognitionResult?, error: Error?, requestId: String) {
        guard speechRequestId == requestId else { return }
        if let result {
            speechTranscript = result.bestTranscription.formattedString
            sendSpeechEvent(
                requestId: requestId,
                state: speechStopRequested ? "processing" : "listening",
                kind: "transcript",
                transcript: speechTranscript
            )
            if result.isFinal {
                endSpeechSession(notify: true, finalState: "finished")
                return
            }
        }
        if let error {
            if speechStopRequested, !speechTranscript.isEmpty {
                endSpeechSession(notify: true, finalState: "finished")
            } else {
                endSpeechSession(notify: true, finalState: "error", reason: error.localizedDescription)
            }
        }
    }

    private func stopNativeSpeech(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        guard !requestId.isEmpty, requestId == speechRequestId else { return }
        speechStopRequested = true
        stopSpeechAudioCapture()
        speechRecognitionRequest?.endAudio()
        sendSpeechEvent(requestId: requestId, state: "processing", transcript: speechTranscript)
        speechFinishTask?.cancel()
        speechFinishTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1400))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard self?.speechRequestId == requestId else { return }
                self?.endSpeechSession(notify: true, finalState: "finished")
            }
        }
    }

    private func cancelNativeSpeech(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        guard requestId.isEmpty || requestId == speechRequestId else { return }
        endSpeechSession(notify: true, finalState: "cancelled")
    }

    private func stopSpeechAudioCapture() {
        if speechAudioEngine.isRunning { speechAudioEngine.stop() }
        if speechTapInstalled {
            speechAudioEngine.inputNode.removeTap(onBus: 0)
            speechTapInstalled = false
        }
    }

    private func endSpeechSession(notify: Bool, finalState: String, reason: String? = nil) {
        let requestId = speechRequestId
        let transcript = speechTranscript
        speechPermissionTask?.cancel()
        speechPermissionTask = nil
        speechFinishTask?.cancel()
        speechFinishTask = nil
        stopSpeechAudioCapture()
        speechRecognitionRequest?.endAudio()
        speechRecognitionTask?.cancel()
        speechRecognitionTask = nil
        speechRecognitionRequest = nil
        speechRecognizer = nil
        speechRequestId = ""
        speechTranscript = ""
        speechStopRequested = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard notify, !requestId.isEmpty else { return }
        sendSpeechEvent(requestId: requestId, state: finalState, transcript: transcript, reason: reason)
    }

    private func sendSpeechEvent(
        requestId: String,
        state: String,
        kind: String = "state",
        transcript: String? = nil,
        level: Double? = nil,
        reason: String? = nil
    ) {
        var result: [String: Any] = [
            "requestId": requestId,
            "kind": kind,
            "state": state,
            "onDevice": true,
            "timestamp": Self.currentTimestampMilliseconds()
        ]
        if let transcript { result["transcript"] = transcript }
        if let level { result["level"] = level }
        if let reason { result["reason"] = reason }
        sendJavaScriptCallback(result, resolver: "__receiveSpeechEvent")
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
        endSpeechSession(notify: false, finalState: "cancelled")
        stopAmbientMotion(reason: "teardown", notifyJavaScript: false)
        ambientMotionObservers.forEach(NotificationCenter.default.removeObserver)
        ambientMotionObservers.removeAll()
        pendingLocationRequests.values.forEach { $0.cancel() }
        pendingLocationRequests.removeAll()
        pendingAIRequests.values.forEach { $0.cancel() }
        pendingAIRequests.removeAll()
        pendingOperonTimeouts.values.forEach { $0.cancel() }
        pendingOperonTimeouts.removeAll()
        pendingOperonCommands.values.forEach {
            $0.resume(throwing: NativeBridgeOperonError.cancelled)
        }
        pendingOperonCommands.removeAll()
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

        var incomingSnapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data)
        var resolvedData = data

        // The web view can restore an older localStorage coordinate before its
        // live-location request completes. If the widget extension has already
        // resolved this same Current Location intent elsewhere, do not let that
        // warm-start render replace destination weather on widgets or Watch.
        if var place = incomingPlace,
           let resolution = resolvedWidgetLocation(for: place),
           resolvedWidgetLocationMeaningfullyDiffers(resolution, from: place) {
            place.latitude = resolution.latitude
            place.longitude = resolution.longitude
            place.name = "Current Location"
            place.displayName = "Current Location"
            place.admin1 = nil
            place.country = nil
            place.countryCode = nil
            if let adjustedPlaceData = try? JSONEncoder().encode(place) {
                placeData = adjustedPlaceData
                incomingPlace = place
            }

            if let incoming = incomingSnapshot,
               let stored = NearcastWidgetSnapshot.stored() {
                let destination = stored.expiringCompanionContent(at: Date().timeIntervalSince1970)
                var protected = incoming.mergingWeather(from: destination)
                protected = protected.preservingOfficialAlert(from: destination)
                incomingSnapshot = protected
                if let encoded = try? JSONEncoder().encode(protected) {
                    resolvedData = encoded
                }
            }
        }

        if let incoming = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: resolvedData),
           let incomingPlace,
           let storedPlace = NearcastWidgetPlace.stored(),
           abs(incomingPlace.latitude - storedPlace.latitude) < 0.00001,
           abs(incomingPlace.longitude - storedPlace.longitude) < 0.00001,
           let stored = NearcastWidgetSnapshot.stored() {
            let currentStored = stored.expiringCompanionContent(at: Date().timeIntervalSince1970)
            let resolved = incoming.resolvingOfficialAlert(with: currentStored)
            if let encoded = try? JSONEncoder().encode(resolved) {
                resolvedData = encoded
            }
        }

        if let decoded = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: resolvedData),
           let encoded = try? JSONEncoder().encode(
               decoded.expiringCompanionContent(at: Date().timeIntervalSince1970)
           ) {
            resolvedData = encoded
        }

        NearcastWidgetSnapshotStore.saveSnapshotData(resolvedData)
        if let placeData {
            NearcastWidgetSnapshotStore.savePlaceData(placeData)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: NearcastWidgetSnapshotStore.widgetKind)
        NativeWatchSnapshotSync.shared.sendSnapshotData(resolvedData, placeData: placeData)
    }

    private func resolvedWidgetLocation(
        for place: NearcastWidgetPlace
    ) -> NearcastNativeResolvedWidgetLocation? {
        guard place.tracksCurrentLocation,
              let defaults = UserDefaults(suiteName: NearcastWidgetSnapshotStore.suiteName),
              let data = defaults.data(forKey: nearcastNativeResolvedWidgetLocationKey),
              let resolution = try? JSONDecoder().decode(NearcastNativeResolvedWidgetLocation.self, from: data),
              resolution.selectionIdentity == widgetSelectionIdentity(place),
              CLLocationCoordinate2DIsValid(CLLocationCoordinate2D(
                latitude: resolution.latitude,
                longitude: resolution.longitude
              )) else { return nil }
        return resolution
    }

    private func widgetSelectionIdentity(_ place: NearcastWidgetPlace) -> String {
        let id = (place.id ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !id.isEmpty { return "\(place.tracksCurrentLocation ? "live" : "fixed")|\(id)" }
        return String(
            format: "%@|%.5f|%.5f",
            place.tracksCurrentLocation ? "live" : "fixed",
            place.latitude,
            place.longitude
        )
    }

    private func resolvedWidgetLocationMeaningfullyDiffers(
        _ resolution: NearcastNativeResolvedWidgetLocation,
        from place: NearcastWidgetPlace
    ) -> Bool {
        let incoming = CLLocation(latitude: place.latitude, longitude: place.longitude)
        let resolved = CLLocation(latitude: resolution.latitude, longitude: resolution.longitude)
        let uncertaintyThreshold = max(2_000, max(0, resolution.horizontalAccuracy) * 1.5)
        return incoming.distance(from: resolved) >= uncertaintyThreshold
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

    private func sendNativeAIAvailability(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        var result: [String: Any]
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            result = NativeLanguageModelController.availability()
        } else {
            result = nativeAIUnavailable(reason: "os-not-supported")
        }
        #else
        result = nativeAIUnavailable(reason: "framework-unavailable")
        #endif
        result["operon"] = true
        result["operonVersion"] = "0.4.0"
        result["protocolVersion"] = "0.3"
        result["requestId"] = requestId
        sendJavaScriptCallback(result, resolver: "__resolveAIRequest")
    }

    private func generateWithNativeAI(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            pendingAIRequests[requestId]?.cancel()
            pendingAIRequests[requestId] = Task { @MainActor [weak self] in
                var result = await NativeLanguageModelController.generate(options: options)
                guard !Task.isCancelled else { return }
                result["requestId"] = requestId
                self?.pendingAIRequests.removeValue(forKey: requestId)
                self?.sendJavaScriptCallback(result, resolver: "__resolveAIRequest")
            }
            return
        }
        #endif
        var result = nativeAIUnavailable(reason: "os-not-supported")
        result["requestId"] = requestId
        sendJavaScriptCallback(result, resolver: "__resolveAIRequest")
    }

    private func cancelNativeAI(_ payload: [String: Any]) {
        let options = payload["options"] as? [String: Any] ?? [:]
        let targetRequestId = options["targetRequestId"] as? String ?? ""
        pendingAIRequests.removeValue(forKey: targetRequestId)?.cancel()
    }

    private func runWithNativeOperon(_ payload: [String: Any]) {
        let requestId = payload["requestId"] as? String ?? ""
        let options = payload["options"] as? [String: Any] ?? [:]
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            pendingAIRequests[requestId]?.cancel()
            pendingAIRequests[requestId] = Task { @MainActor [weak self] in
                guard let self else { return }
                var result = await NativeOperonController.runAgent(
                    runID: requestId,
                    options: options,
                    bridge: { [weak self] command in
                        guard let self else { throw NativeBridgeOperonError.cancelled }
                        return try await self.requestNativeOperonCommand(command)
                    },
                    progress: { [weak self] event in
                        self?.sendNativeOperonProgress(event)
                    }
                )
                guard !Task.isCancelled else { return }
                result["requestId"] = requestId
                self.pendingAIRequests.removeValue(forKey: requestId)
                self.sendJavaScriptCallback(result, resolver: "__resolveAIRequest")
            }
            return
        }
        #endif
        var result = nativeAIUnavailable(reason: "os-not-supported")
        result["requestId"] = requestId
        sendJavaScriptCallback(result, resolver: "__resolveAIRequest")
    }

    private func requestNativeOperonCommand(_ command: NativeOperonBridgeCommand) async throws -> String {
        guard !hasTornDown, webView != nil else { throw NativeBridgeOperonError.cancelled }
        operonCommandSequence += 1
        let commandId = "\(command.runID)-\(operonCommandSequence)"
        let payload = (try? JSONSerialization.jsonObject(with: Data(command.payloadJSON.utf8))) ?? [:]
        return try await withCheckedThrowingContinuation { continuation in
            pendingOperonCommands[commandId] = continuation
            pendingOperonTimeouts[commandId]?.cancel()
            pendingOperonTimeouts[commandId] = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(45))
                guard !Task.isCancelled, let self,
                      let pending = self.pendingOperonCommands.removeValue(forKey: commandId) else { return }
                self.pendingOperonTimeouts.removeValue(forKey: commandId)
                pending.resume(throwing: NativeBridgeOperonError.timedOut)
            }
            sendJavaScriptCallback([
                "runId": command.runID,
                "commandId": commandId,
                "kind": command.kind,
                "payload": payload
            ], resolver: "__receiveOperonCommand")
        }
    }

    private func sendNativeOperonProgress(_ progress: NativeOperonProgressEvent) {
        guard let event = try? JSONSerialization.jsonObject(with: Data(progress.eventJSON.utf8)) else { return }
        sendJavaScriptCallback([
            "runId": progress.runID,
            "event": event
        ], resolver: "__receiveOperonProgress")
    }

    private func receiveNativeOperonEvent(_ payload: [String: Any]) {
        let options = payload["options"] as? [String: Any] ?? [:]
        let commandId = options["commandId"] as? String ?? ""
        guard let continuation = pendingOperonCommands.removeValue(forKey: commandId) else { return }
        pendingOperonTimeouts.removeValue(forKey: commandId)?.cancel()
        if let error = options["error"] as? String, !error.isEmpty {
            continuation.resume(throwing: NativeBridgeOperonError.commandFailed(error))
            return
        }
        let result: Any = options["result"] ?? [:]
        guard JSONSerialization.isValidJSONObject(result),
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else {
            continuation.resume(throwing: NativeBridgeOperonError.invalidResult)
            return
        }
        continuation.resume(returning: json)
    }

    private func rejectNativeAIRequest(_ payload: [String: Any], reason: String) {
        let requestId = payload["requestId"] as? String ?? ""
        var result = nativeAIUnavailable(reason: reason)
        result["requestId"] = requestId
        sendJavaScriptCallback(result, resolver: "__resolveAIRequest")
    }

    private func nativeAIUnavailable(reason: String) -> [String: Any] {
        [
            "ok": false,
            "available": false,
            "reason": reason,
            "model": "apple-system-language-model"
        ]
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
