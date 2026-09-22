import Foundation
import CoreFoundation
import WebKit
import UIKit

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
    @Published var showingNativePreview = false
    @Published private(set) var nativePreviewContext = NativePreviewContextStore.load()
    @Published var nativePreviewError: String?
    @Published private(set) var isOpeningAssistant = false
    private var failedPreviewHandoff: NativePreviewHandoff?
    @Published private(set) var placesMigrationReport: NativePlacesMigrationReport?
    @Published private(set) var placesMigrationMessage = "Not checked. The existing app still owns places and settings."
    @Published private(set) var isCheckingPlacesMigration = false
    let placesOwner: NativePlacesOwnerController

    private weak var webView: WKWebView?
    /// An explicit native-only escape can arrive before the retained page has
    /// mounted. Hold only the validated handoff until the trusted page reports
    /// ready; never flatten it into generic web Home.
    private var pendingNativePreviewHandoff: NativePreviewHandoff?
    private var localURL: URL
    private var loadTimeoutTask: Task<Void, Never>?
    private var placesMigrationTask: Task<Void, Never>?
    private var placesMigrationRevision = 0
    // One launch decision per process. Closing Nearcast weather is an
    // intentional request to see the existing app, not a cue to reopen it.
    private var didAttemptNativeHome = false
    private var ownerDocumentID: String?
    private let productionMigrationStore = NativePlacesMigrationStore(directory: NativePlacesMigrationStore.defaultDirectory)
    // Development fixtures must never replace a production migration receipt.
    private let developmentMigrationStore = NativePlacesMigrationStore(
        directory: NativePlacesMigrationStore.defaultDirectory.appendingPathComponent("DevelopmentOnly", isDirectory: true)
    )
    // This observer coordinates only a local, legacy-owned receipt. It is
    // lazy so ordinary compatibility browsing does not create a Plans handoff
    // store until a trusted Plans export actually arrives.
    private var planNotificationIntentCoordinator: NativePlanNotificationIntentHandoffCoordinator?
    // Legacy planner code may publish on ordinary settings changes. Native
    // consumes exactly one export only after the user confirmed an exact
    // native-to-existing Plans bridge.
    private var planHandoverCompatibilityConsent = false
    private var planHandoverExportArmed = false
    /// The consent is tied to the exact compatibility document that will
    /// receive the handoff. A queued first load may consume one navigation;
    /// any later navigation, mode change, or timeout invalidates the grant.
    private var planHandoverConsentRevision: Int?
    private var planHandoverArmRevision: Int?
    private var planHandoverExportArmTask: Task<Void, Never>?

    /// The browser-backed model is unavailable during an ordinary native-only
    /// Dev session.  The one retained compatibility cover is created only
    /// after a person has confirmed a bounded migration/recovery action, and
    /// passes this capability explicitly.  Keeping the check at construction
    /// time means a future view refactor cannot quietly recreate WebKit below
    /// the native root.
    init(allowNativeOnlyCompatibility: Bool = false) {
        #if DEBUG
        precondition(
            !NativeRuntimeConfiguration.isNativeOnlyExperience || allowNativeOnlyCompatibility,
            "NearcastWebModel requires an explicit native-only compatibility handoff."
        )
        #endif
        let storedMode = NativeRuntimeConfiguration.storedMode()
        let storedLocalURL = NativeRuntimeConfiguration.storedLocalURL()
        mode = storedMode
        localURL = storedLocalURL
        localURLText = storedLocalURL.absoluteString
        currentURL = storedMode == .local ? storedLocalURL : NativeRuntimeConfiguration.productionURL
        placesOwner = NativePlacesOwnerController(production: storedMode == .production)
        NativeAgendaStore.shared.configure(
            sourceScope: NativeLegacySourceScope(production: storedMode == .production)
        )
        placesOwner.onChange = { [weak self] in self?.placesOwnerDidChange() }
        placesOwnerDidChange()
        NativeNotificationRouter.shared.attach(self)
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
        installOwnerScripts(in: webView)
        deliverPendingNativePreviewHandoffIfReady()
    }

    func load(_ nextMode: NearcastWebMode) {
        ownerDocumentID = nil
        clearPlanHandoverExportArm(clearConsent: true)
        mode = nextMode
        NativeRuntimeConfiguration.storeMode(nextMode)
        let scope = NativeLegacySourceScope(production: nextMode == .production)
        // Reconfigure all retained source readers before a new host can emit
        // an Agenda or P0 handover export.
        NativeAgendaStore.shared.configure(sourceScope: scope)
        placesOwner.configure(production: nextMode == .production)
        planNotificationIntentCoordinator?.configure(production: nextMode == .production)
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
        ownerDocumentID = nil
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
        // A slow successful navigation must dismiss an earlier timeout banner.
        lastError = nil
        installAgendaCompatibilityExport()
        deliverPendingNativePreviewHandoffIfReady()
    }

    private func installAgendaCompatibilityExport() {
        guard let webView,
              let url = Bundle.main.url(forResource: "NativeAgendaExport", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8) else { return }
        webView.callAsyncJavaScript("""
            const deadline = Date.now() + 15000;
            while (typeof savePlanMemories !== 'function' || typeof normalizePlanMemory !== 'function') {
                if (Date.now() >= deadline) return false;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (typeof publishLegacyAgendaSnapshot === 'function') {
                publishLegacyAgendaSnapshot();
            } else {
                \(script)
            }
            return true;
            """, arguments: [:], in: nil, in: .page) { _ in }
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
        placesOwner.retryCompanionPublication()
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

    /// Ingests only the strict, trusted legacy Agenda projection. A rejected
    /// export leaves the last verified cache intact; Plans and watch choices
    /// remain legacy-owned until their native replacements are complete.
    func receiveLegacyAgendaExport(_ data: Data) {
        _ = NativeAgendaStore.shared.acceptLegacyExport(
            data,
            sourceScope: NativeLegacySourceScope(production: mode == .production)
        )
    }

    /// Stages only a complete, allowlisted legacy Plan/export receipt. This
    /// method intentionally has no result surface: a rejected rehearsal must
    /// not cause a retry, an empty plan view, or any notification action.
    func receiveLegacyPlanHandoverExport(_ data: Data) {
        guard planHandoverExportArmed,
              planHandoverArmRevision == navigationRevision else { return }
        // Consume before decoding so a legacy settings mutation cannot replay
        // another export after the one explicit compatibility request.
        clearPlanHandoverExportArm(clearConsent: true)
        if planNotificationIntentCoordinator == nil {
            planNotificationIntentCoordinator = NativePlanNotificationIntentHandoffCoordinator(
                production: mode == .production,
                placesOwner: placesOwner
            )
        }
        planNotificationIntentCoordinator?.receiveVerifiedLegacyHandover(data)
    }

    func openNotification(userInfo: [AnyHashable: Any]) {
        showingNativePreview = false
        requestNavigation(to: notificationTargetURL(userInfo: userInfo, baseURL: currentBaseURL), force: true)
    }

    func openDeepLink(_ url: URL) {
        if url.scheme?.lowercased() == NearcastBuildIdentity.urlScheme, url.host == "native-preview" {
            openCachedNativePreview()
            return
        }
        showingNativePreview = false
        requestNavigation(to: deepLinkTargetURL(url, baseURL: currentBaseURL), force: shouldForceDeepLinkNavigation(url))
    }

    /// Continues a user-approved native-only escape after the compatibility
    /// host exists. It is deliberately not called during ordinary launch:
    /// native-only Dev must never construct this model or WebKit by accident.
    func openCompatibilityLaunch(_ launch: NativeCompatibilityLaunch) {
        // A fresh explicit request never inherits a one-shot arm from a prior
        // Plan attempt, even if that prior page is still visible.
        if planHandoverExportArmed {
            clearPlanHandoverExportArm(clearConsent: true)
        }
        if case .handoff(let handoff) = launch, handoff.destination == .plans {
            planHandoverCompatibilityConsent = true
            // If the compatibility page is already live, the request belongs
            // to that document. Otherwise permit exactly the initial queued
            // navigation that will load it.
            planHandoverConsentRevision = hasLoadedPage && !isLoading
                ? navigationRevision
                : navigationRevision + 1
        } else {
            clearPlanHandoverExportArm(clearConsent: true)
        }
        switch launch {
        case .home:
            showingNativePreview = false
        case .handoff(let handoff):
            queueNativePreviewHandoff(handoff)
        case .notification(let userInfo):
            openNotification(userInfo: userInfo)
        case .deepLink(let url):
            openDeepLink(url)
        }
    }

    func openNativePreview(data: Data, migrationData: Data? = nil) {
        if placesOwner.status == "owned" {
            placesOwnerDidChange()
            openCachedNativePreview()
            return
        }
        guard placesOwner.status == "unmigrated" else {
            nativePreviewError = placesOwner.message
            return
        }
        do {
            let context = try NativePreviewContext.decode(data)
            nativePreviewContext = context
            NativePreviewContextStore.save(context)
            nativePreviewError = nil
            showingNativePreview = true
            rehearsePlacesMigration(migrationData, preview: context)
        } catch {
            nativePreviewError = NativePreviewError.invalidContext.localizedDescription
        }
    }

    private var placesMigrationStore: NativePlacesMigrationStore {
        mode == .production ? productionMigrationStore : developmentMigrationStore
    }

    /// Stages an allowlisted copy only. Weather continues using the preview
    /// context; neither this report nor the staged records are live app state.
    private func rehearsePlacesMigration(_ data: Data?, preview: NativePreviewContext) {
        cancelPlacesMigrationCheck()
        placesMigrationReport = nil
        guard let data, data.count <= 128 * 1_024,
              let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let selected = payload["selectedPlace"] as? [String: Any],
              selected["id"] as? String == preview.selectedPlace.id,
              selected["latitude"] as? Double == preview.selectedPlace.latitude,
              selected["longitude"] as? Double == preview.selectedPlace.longitude else {
            placesMigrationMessage = "No compatible migration copy was provided. Existing records are unchanged."
            return
        }
        isCheckingPlacesMigration = true
        placesMigrationMessage = "Verifying a local copy; existing records remain authoritative."
        let revision = placesMigrationRevision
        let store = placesMigrationStore
        placesMigrationTask = Task { [weak self] in
            do {
                let report = try await store.rehearse(data)
                guard let self, !Task.isCancelled, revision == self.placesMigrationRevision else { return }
                self.placesMigrationReport = report
                self.placesMigrationMessage = report.recoveredFromBackup
                    ? "Verified using the prior rehearsal copy. No ownership transfer."
                    : "Local copy saved and read back successfully. No ownership transfer."
                self.isCheckingPlacesMigration = false
            } catch is CancellationError {
                // A reload or a newer preview supersedes this check.
            } catch {
                guard let self, !Task.isCancelled, revision == self.placesMigrationRevision else { return }
                // Never expose a decoding error that could contain private data.
                self.placesMigrationMessage = "Migration check could not complete. Existing app records are unchanged; the rehearsal remains unverified."
                self.isCheckingPlacesMigration = false
            }
        }
    }

    func refreshPlacesMigrationStatus() {
        guard !isCheckingPlacesMigration else { return }
        cancelPlacesMigrationCheck()
        let revision = placesMigrationRevision
        let store = placesMigrationStore
        isCheckingPlacesMigration = true
        placesMigrationTask = Task { [weak self] in
            do {
                let report = try await store.status()
                guard let self, !Task.isCancelled, revision == self.placesMigrationRevision else { return }
                self.placesMigrationReport = report
                self.placesMigrationMessage = report == nil
                    ? "No rehearsal copy yet. Open the native preview from a compatible page."
                    : "Saved rehearsal only—not current ownership or a new import."
                self.isCheckingPlacesMigration = false
            } catch {
                guard let self, !Task.isCancelled, revision == self.placesMigrationRevision else { return }
                self.placesMigrationReport = nil
                self.placesMigrationMessage = "Saved rehearsal could not be verified. Existing app records are unchanged."
                self.isCheckingPlacesMigration = false
            }
        }
    }

    private func cancelPlacesMigrationCheck() {
        placesMigrationRevision += 1
        placesMigrationTask?.cancel()
        placesMigrationTask = nil
        isCheckingPlacesMigration = false
    }

    /// Transitional write-through: the hydrated existing app is still the sole
    /// writer and publisher. The native UI receives only a verified read-back,
    /// never an optimistic copy or an independently mutable second database.
    func performPlacesCommand(_ command: NativePlacesCommand) async throws -> NativePlacesReply {
        if placesOwner.status != "unmigrated" {
            guard showingNativePreview, UIApplication.shared.applicationState == .active else {
                throw NativePlacesTransportError.unavailable
            }
            return try await placesOwner.perform(command)
        }
        guard showingNativePreview, hasLoadedPage, !isLoading,
              UIApplication.shared.applicationState == .active,
              let webView, let documentURL = webView.url,
              isTrustedPlacesDocument(documentURL) else {
            throw NativePlacesTransportError.unavailable
        }
        let revision = navigationRevision
        let modeAtStart = mode
        let store = placesMigrationStore
        let bytes = try JSONEncoder().encode(command)
        guard bytes.count <= 256 * 1_024,
              let payload = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            throw NativePlacesTransportError.unavailable
        }
        let response: Any
        do {
            // Use the completion API explicitly. With an `Any` result Swift can
            // otherwise select WebKit's Void-returning overload and never wait
            // for the JavaScript promise (including its durable save receipt).
            response = try await withCheckedThrowingContinuation { continuation in
                webView.callAsyncJavaScript("""
                    if (window.NearcastNative?.preview?.controlsVersion !== 1 ||
                        window.NearcastPlacesControls?.version !== 1) {
                        return { version: 1, requestID: payload.requestID, ok: false,
                            code: 'unavailable', message: 'Reload Nearcast to use Places and Settings here.' };
                    }
                    return await window.NearcastPlacesControls.perform(payload);
                    """, arguments: ["payload": payload], in: nil, in: .page) { result in
                        continuation.resume(with: result)
                    }
            }
        } catch {
            // A JS failure can occur after a write. Never automatically replay.
            throw command.action == "snapshot" || command.action == "search"
                ? NativePlacesTransportError.unavailable : NativePlacesTransportError.unverified
        }
        guard !Task.isCancelled, revision == navigationRevision, modeAtStart == mode,
              webView === self.webView, webView.url == documentURL,
              isTrustedPlacesDocument(documentURL), UIApplication.shared.applicationState == .active else {
            throw NativePlacesTransportError.unverified
        }
        guard JSONSerialization.isValidJSONObject(response) else { throw NativePlacesTransportError.unverified }
        let replyData = try JSONSerialization.data(withJSONObject: response)
        guard replyData.count <= 256 * 1_024 else { throw NativePlacesTransportError.unverified }
        let reply = try JSONDecoder().decode(NativePlacesReply.self, from: replyData)
        guard reply.version == 1, reply.requestID == command.requestID else { throw NativePlacesTransportError.unverified }
        if let source = reply.source {
            do {
                let sourceData = try JSONEncoder().encode(source)
                let report = try await store.rehearse(sourceData)
                guard revision == navigationRevision, modeAtStart == mode, !Task.isCancelled else {
                    throw NativePlacesTransportError.unverified
                }
                placesMigrationReport = report
                placesMigrationMessage = "Verified the existing app's saved records. No ownership transfer."
                if let context = source.toPreviewContext() {
                    nativePreviewContext = context
                    NativePreviewContextStore.save(context)
                }
            } catch {
                // The authoritative save may already have completed. A local
                // verification failure is not a safe instruction to repeat it.
                throw NativePlacesTransportError.unverified
            }
        }
        return reply
    }

    func openExistingPlacesSettings() {
        showingNativePreview = false
        guard hasLoadedPage, let webView, let url = webView.url, isTrustedPlacesDocument(url) else {
            nativePreviewError = "Let Nearcast finish loading, then open its menu for settings."
            return
        }
        webView.callAsyncJavaScript("""
            if (typeof window.NearcastPlacesControls?.openExistingSettings !== 'function') return false;
            return window.NearcastPlacesControls.openExistingSettings();
            """, arguments: [:], in: nil, in: .page) { [weak self] result in
                if case .success(let opened) = result, (opened as? Bool) == true {
                    return
                } else {
                    self?.nativePreviewError = "Close any open editor, then open Nearcast’s menu to find the remaining settings."
                }
            }
    }

    private func isTrustedPlacesDocument(_ url: URL) -> Bool {
        func origin(_ url: URL) -> String {
            let scheme = url.scheme?.lowercased() ?? ""
            let port = url.port ?? (scheme == "https" ? 443 : 80)
            return "\(scheme)://\(url.host?.lowercased() ?? ""):\(port)"
        }
        if mode == .production {
            return origin(url) == origin(NativeRuntimeConfiguration.productionURL)
        }
        #if DEBUG
        return origin(url) == origin(currentURL)
        #else
        return false
        #endif
    }

    func installOwnerScripts(in webView: WKWebView) {
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(NativeBridge.bootstrapScript())
        content.addUserScript(NativePlacesOwnerBridge.script(status: placesOwner.isActivating ? "activating" : placesOwner.status,
            snapshot: placesOwner.snapshot, origin: currentBaseURL))
    }

    private func placesOwnerDidChange() {
        if placesOwner.status == "owned" {
            nativePreviewContext = placesOwner.snapshot?.source.toPreviewContext()
            if let context = nativePreviewContext { NativePreviewContextStore.save(context) }
            placesMigrationMessage = "Native storage owns saved places and settings on this iPhone."
        } else if placesOwner.status == "blocked" {
            nativePreviewContext = nil
        }
        if let webView {
            installOwnerScripts(in: webView)
            guard let documentID = ownerDocumentID, let url = webView.url, isTrustedPlacesDocument(url) else { return }
            var seed = NativePlacesOwnerBridge.seed(status: placesOwner.isActivating ? "activating" : placesOwner.status, snapshot: placesOwner.snapshot)
            seed["documentID"] = documentID
            guard let data = try? JSONSerialization.data(withJSONObject: seed) else { return }
            webView.evaluateJavaScript("window.NearcastNative?.__updatePlacesOwner?.(\(String(decoding: data, as: UTF8.self)))", completionHandler: nil)
        }
        openNativeHomeIfAvailable()
    }

    /// Called only from the explicit native Settings confirmation. No page or
    /// cached export can silently acquire ownership during ordinary startup.
    func enableNativePlacesStorage() async {
        guard !placesOwner.isActivating, placesOwner.status == "unmigrated",
              showingNativePreview, hasLoadedPage, !isLoading,
              UIApplication.shared.applicationState == .active,
              let webView, let documentURL = webView.url, isTrustedPlacesDocument(documentURL) else {
            placesOwner.message = "Open the existing app online once before moving Places into native storage."
            return
        }
        placesOwner.isActivating = true
        placesOwner.message = "Verifying saved places and existing notification choices…"
        let revision = navigationRevision
        let startingMode = mode
        defer {
            placesOwner.isActivating = false
            placesOwnerDidChange()
            webView.evaluateJavaScript("window.NearcastNativePlacesOwner?.finishActivation?.()", completionHandler: nil)
        }
        do {
            let result: Any = try await withCheckedThrowingContinuation { continuation in
                webView.callAsyncJavaScript("""
                    if (typeof window.NearcastNativePlacesOwner?.prepareActivation !== 'function') {
                        throw new Error('Reload Nearcast to prepare native storage.');
                    }
                    const source = await window.NearcastNativePlacesOwner.prepareActivation();
                    window.NearcastNative.__updatePlacesOwner({status:'activating', snapshot:{source},
                        documentID: window.NearcastNative.placesOwner.documentID});
                    return source;
                    """, arguments: [:], in: nil, in: .page) { continuation.resume(with: $0) }
            }
            guard revision == navigationRevision, startingMode == mode, webView.url == documentURL,
                  UIApplication.shared.applicationState == .active, !Task.isCancelled,
                  JSONSerialization.isValidJSONObject(result) else { throw NativePlacesTransportError.unverified }
            let data = try JSONSerialization.data(withJSONObject: result)
            guard data.count <= 128 * 1_024 else { throw NativePlacesTransportError.unverified }
            let source = try JSONDecoder().decode(NativePlacesSource.self, from: data)
            _ = try await placesOwner.activate(source)
        } catch {
            if placesOwner.status == "unmigrated" {
                placesOwner.message = "The handover could not be verified. Existing records are unchanged. Reload Nearcast and try again."
            }
        }
    }

    /// Correlates every asynchronous request to the exact trusted document.
    func receivePlacesOwnerMessage(_ payload: [String: Any], frameURL: URL?, isMainFrame: Bool) {
        guard isMainFrame, let frameURL, isTrustedPlacesDocument(frameURL),
              let webView, webView.url == frameURL,
              let documentID = payload["documentID"] as? String, UUID(uuidString: documentID) != nil else { return }
        let type = payload["type"] as? String
        if type == "placesOwner.ready" {
            let revision = navigationRevision
            webView.callAsyncJavaScript("return window.NearcastNative?.placesOwner?.documentID === documentID;",
                arguments: ["documentID": documentID], in: nil, in: .page) { [weak self, weak webView] result in
                    guard let self, let webView, self.navigationRevision == revision, webView.url == frameURL,
                          case .success(let matches) = result, (matches as? Bool) == true else { return }
                    self.ownerDocumentID = documentID
                    self.placesOwnerDidChange()
                }
            return
        }
        guard ownerDocumentID == documentID, UIApplication.shared.applicationState == .active,
              let requestID = payload["requestId"] as? String, UUID(uuidString: requestID) != nil else { return }
        let revision = navigationRevision
        let startingMode = mode
        Task { @MainActor [weak self, weak webView] in
            guard let self, let webView else { return }
            let current: @MainActor () -> Bool = { [weak self, weak webView] in
                guard let self, let webView else { return false }
                return self.ownerDocumentID == documentID && self.navigationRevision == revision &&
                    self.mode == startingMode && webView.url == frameURL &&
                    UIApplication.shared.applicationState == .active
            }
            var response: [String: Any] = ["requestId": requestID, "documentID": documentID, "ok": false]
            do {
                guard current() else { return }
                let data: Data
                if type == "placesOwner.perform", let raw = payload["command"] as? [String: Any] {
                    let actionFields: [String: Set<String>] = [
                        "snapshot": [], "search": ["query"], "select": ["place", "id"], "save": ["place"],
                        "rename": ["id", "alias"], "move": ["id", "direction"], "remove": ["id"],
                        "preferences": ["preferences"], "currentLocation": []
                    ]
                    guard let action = raw["action"] as? String, let fields = actionFields[action],
                          Set(raw.keys).isSubset(of: fields.union(["version", "requestID", "action", "expectedSource"])) else {
                        throw NativePlacesOwnerError.invalid
                    }
                    let commandData = try JSONSerialization.data(withJSONObject: raw)
                    guard commandData.count <= 256 * 1_024 else { throw NativePlacesOwnerError.invalid }
                    let command = try JSONDecoder().decode(NativePlacesCommand.self, from: commandData)
                    data = try JSONEncoder().encode(try await self.placesOwner.perform(command, isCurrent: current))
                } else if type == "placesOwner.acknowledge", let number = payload["through"] as? NSNumber,
                          CFGetTypeID(number) != CFBooleanGetTypeID(),
                          number.doubleValue >= 0, number.doubleValue <= 9_007_199_254_740_991,
                          number.doubleValue.rounded(.towardZero) == number.doubleValue {
                    let through = number.intValue
                    data = try JSONEncoder().encode(try await self.placesOwner.acknowledgeDeletions(through: through))
                } else { throw NativePlacesOwnerError.invalid }
                response["ok"] = true
                response["value"] = try JSONSerialization.jsonObject(with: data)
            } catch { response["message"] = "Native places could not be verified. Reopen Places before retrying." }
            guard current(), let data = try? JSONSerialization.data(withJSONObject: response) else { return }
            webView.evaluateJavaScript("window.NearcastNative?.__resolvePlacesOwner?.(\(String(decoding: data, as: UTF8.self)))", completionHandler: nil)
        }
    }

    func openCachedNativePreview() {
        guard nativePreviewContext != nil || placesOwner.status == "owned" else {
            nativePreviewError = "Open a place, then choose Native weather preview from the Nearcast menu first."
            return
        }
        showingNativePreview = true
    }

    /// Native weather is the default home when this device already has a
    /// verified, allowlisted place context. A first-run device without one
    /// stays in the existing app until it can establish that context safely.
    func openNativeHomeIfAvailable() {
        guard !didAttemptNativeHome,
              nativePreviewContext != nil || placesOwner.status == "owned" else { return }
        didAttemptNativeHome = true
        showingNativePreview = true
    }

    /// Explicitly leaves the preview. The fully hydrated existing app
    /// owns subsequent place changes/publication and any requested mutations.
    func handoffNativePreview(_ handoff: NativePreviewHandoff) {
        showingNativePreview = false
        failedPreviewHandoff = handoff
        guard hasLoadedPage, let webView,
              let data = try? JSONEncoder().encode(handoff),
              let payload = try? JSONSerialization.jsonObject(with: data) else {
            nativePreviewError = "The existing app is not ready. Return to Nearcast and let it finish loading before opening this view."
            return
        }
        let requestsPlanHandover = handoff.destination == .plans &&
            planHandoverCompatibilityConsent &&
            planHandoverConsentRevision == navigationRevision &&
            !planHandoverExportArmed
        if requestsPlanHandover {
            // The bridge consumes this single arm. The JavaScript completion
            // is not the acknowledgement: postMessage arrives separately.
            armPlanHandoverExport()
        }
        isOpeningAssistant = handoff.destination == .ask
        webView.callAsyncJavaScript("""
            // Page navigation can finish before Places hydration and the
            // planner scripts. Wait for readiness before submitting once.
            const deadline = Date.now() + 15000;
            while (window.NearcastNativePreview?.version !== 1 ||
                   (payload.destination === 'ask' && typeof runAsk !== 'function')) {
                if (Date.now() >= deadline) throw new Error('The assistant is still loading. Please try again.');
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (typeof nativeOwnerWeatherLoad !== 'undefined' && nativeOwnerWeatherLoad) {
                await nativeOwnerWeatherLoad;
            }
            if (payload.destination === 'ask' &&
                ((typeof askStreaming !== 'undefined' && askStreaming) ||
                 (typeof aiState !== 'undefined' && aiState.phase === 'generating'))) {
                throw new Error('Wait for the current answer to finish, then try again.');
            }
            if (window.NearcastNativePreview?.version !== 1) {
                throw new Error('Reload Nearcast to enable this preview handoff.');
            }
            const response = await window.NearcastNativePreview.handoff(payload);
            const safeResponse = response && typeof response === 'object' ? response : { ok: false };
            const planHandoverPublished = requestPlanHandover && safeResponse.ok === true &&
                typeof publishLegacyPlanHandoverSnapshot === 'function'
                ? publishLegacyPlanHandoverSnapshot() === true
                : false;
            return { ...safeResponse, nativePlanHandoverPublished: planHandoverPublished };
            """, arguments: ["payload": payload, "requestPlanHandover": requestsPlanHandover], in: nil, in: .page) { [weak self] result in
                self?.isOpeningAssistant = false
                switch result {
                case .success(let value):
                    let response = value as? [String: Any]
                    // `publishLegacyPlanHandoverSnapshot()` posts through
                    // WebKit asynchronously. Keep the exact arm alive until
                    // `receiveLegacyPlanHandoverExport` consumes it. If this
                    // request did not publish, there is nothing to accept.
                    if requestsPlanHandover,
                       response?["nativePlanHandoverPublished"] as? Bool != true {
                        self?.clearPlanHandoverExportArm(clearConsent: true)
                    }
                    if response?["reason"] as? String == "map-date-unavailable" {
                        self?.nativePreviewError = "The map forecast doesn't reach that day yet. Its timeline has a shorter range than the daily forecast."
                    } else if response?["ok"] as? Bool != true {
                        self?.nativePreviewError = "That view did not finish opening. Return to Nearcast and try again."
                    } else {
                        self?.failedPreviewHandoff = nil
                    }
                case .failure:
                    if requestsPlanHandover {
                        self?.clearPlanHandoverExportArm(clearConsent: true)
                    }
                    self?.nativePreviewError = "Could not open that exact place and view. Reload Nearcast and try again."
                }
            }
    }

    var canRetryPreviewHandoff: Bool { failedPreviewHandoff != nil && !isOpeningAssistant }

    func retryPreviewHandoff() {
        guard let handoff = failedPreviewHandoff else { return }
        nativePreviewError = nil
        queueNativePreviewHandoff(handoff)
    }

    /// A compatibility root is allowed to wait for its trusted page. This is
    /// distinct from a live preview handoff, where an unavailable page is a
    /// user-visible error rather than an instruction to retry a mutation.
    private func queueNativePreviewHandoff(_ handoff: NativePreviewHandoff) {
        showingNativePreview = false
        pendingNativePreviewHandoff = handoff
        if hasLoadedPage, !isLoading, webView != nil {
            deliverPendingNativePreviewHandoffIfReady()
        } else {
            requestNavigation(to: currentBaseURL, force: true)
        }
    }

    private func deliverPendingNativePreviewHandoffIfReady() {
        guard let handoff = pendingNativePreviewHandoff,
              hasLoadedPage,
              !isLoading,
              webView != nil else { return }
        pendingNativePreviewHandoff = nil
        handoffNativePreview(handoff)
    }

    private var currentBaseURL: URL {
        mode == .local ? localURL : NativeRuntimeConfiguration.productionURL
    }

    private func requestNavigation(to targetURL: URL, force: Bool) {
        ownerDocumentID = nil
        cancelPlacesMigrationCheck()
        let sameTarget = Self.normalizedURLString(targetURL) == Self.normalizedURLString(currentURL)
        currentURL = targetURL
        lastError = nil

        if sameTarget, hasLoadedPage, !force {
            loadTimeoutTask?.cancel()
            loadTimeoutTask = nil
            isLoading = false
            return
        }

        // A live arm is document-bound. An initial compatibility navigation
        // is the only navigation that may retain consent before an arm exists.
        if planHandoverExportArmed ||
            (planHandoverCompatibilityConsent &&
             planHandoverConsentRevision != navigationRevision + 1) {
            clearPlanHandoverExportArm(clearConsent: true)
        }

        hasLoadedPage = false
        navigationRevision &+= 1
    }

    /// Arms exactly one trusted bridge message after an explicit Plans
    /// compatibility action. PostMessage is asynchronous, so this stays
    /// armed after JavaScript returns and is instead consumed by the native
    /// bridge, invalidated by navigation/mode change, or expired shortly.
    private func armPlanHandoverExport() {
        planHandoverExportArmTask?.cancel()
        let revision = navigationRevision
        planHandoverExportArmed = true
        planHandoverArmRevision = revision
        planHandoverExportArmTask = Task { @MainActor [weak self] in
            // The trusted page may spend up to 15 seconds waiting for its
            // own hydration before it calls the publisher. Leave room for
            // that bounded wait plus the asynchronous bridge delivery, while
            // still making this a short-lived, document-bound capability.
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            guard !Task.isCancelled,
                  let self,
                  self.planHandoverExportArmed,
                  self.planHandoverArmRevision == revision,
                  self.navigationRevision == revision else { return }
            self.clearPlanHandoverExportArm(clearConsent: true)
        }
    }

    private func clearPlanHandoverExportArm(clearConsent: Bool) {
        planHandoverExportArmTask?.cancel()
        planHandoverExportArmTask = nil
        planHandoverExportArmed = false
        planHandoverArmRevision = nil
        if clearConsent {
            planHandoverCompatibilityConsent = false
            planHandoverConsentRevision = nil
        }
    }

    private func shouldForceDeepLinkNavigation(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == NearcastBuildIdentity.urlScheme else { return true }
        let route = (url.host ?? "").lowercased()
        if route == "weather" || route.isEmpty {
            let sourceItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            return !sourceItems.isEmpty
        }
        return true
    }

    private func deepLinkTargetURL(_ url: URL, baseURL: URL) -> URL {
        guard url.scheme?.lowercased() == NearcastBuildIdentity.urlScheme else {
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

private enum NativePlacesTransportError: LocalizedError {
    case unavailable, unverified

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Places and Settings need the existing app to finish loading. Return to Nearcast, reload, and try again."
        case .unverified:
            return "The change may have been saved, but could not be verified. Reopen Places before trying it again."
        }
    }
}
