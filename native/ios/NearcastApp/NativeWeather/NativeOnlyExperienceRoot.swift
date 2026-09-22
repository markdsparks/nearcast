import SwiftUI

/// A deliberate, visible compatibility request. Native-only Dev never creates
/// a web hierarchy just because an unfinished feature is tapped or a legacy
/// notification arrives.
private struct NativeOnlyCompatibilityRequest: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let confirmTitle: String
    let launch: NativeCompatibilityLaunch
}

/// The native Home must always give Places and Settings a visible home. Before
/// the one-time verified handover completes, it presents an honest temporary
/// preview instead of silently treating a reduced weather cache as saved data.
private enum NativeOnlyPlacesPresentation: Identifiable {
    case managed(NativePlacesSettingsTab)
    case setup(NativePlacesSettingsTab)

    var id: String {
        switch self {
        case .managed(let tab): "managed-\(tab.rawValue)"
        case .setup(let tab): "setup-\(tab.rawValue)"
        }
    }
}

/// Owns the native-first launch seam. It reads only the already-verified
/// native Places owner (or its deliberately read-only cached preview), and it
/// has no WebKit dependency. This lets Dev exercise the actual native journey
/// while retaining one explicit, user-chosen Places migration exception.
@MainActor
final class NativeOnlyExperienceCoordinator: ObservableObject, NativeNotificationRouteHandling {
    @Published private(set) var context: NativePreviewContext?
    @Published private(set) var canEditPlaces = false
    @Published private(set) var setupMessage = ""
    @Published fileprivate var compatibilityRequest: NativeOnlyCompatibilityRequest?
    @Published fileprivate var nativeRouteUnavailable: NativeRouteUnavailable?

    let placesOwner: NativePlacesOwnerController
    /// Places, retained Agenda, and the P0 rehearsal receipt must always use
    /// one Local/Production source boundary. The native Plan library stays
    /// intentionally global; its handoff receipt carries this same scope.
    private var legacySourceScope: NativeLegacySourceScope
    let router = NativeAppRouter()

    init() {
        // Match the same native owner namespace that the Dev/production
        // compatibility host would use. This does not import or mutate any
        // legacy records; an unowned store remains unowned.
        let sourceScope = NativeLegacySourceScope(
            production: NativeRuntimeConfiguration.storedMode() == .production
        )
        legacySourceScope = sourceScope
        placesOwner = NativePlacesOwnerController(production: sourceScope.isProduction)
        NativeAgendaStore.shared.configure(sourceScope: sourceScope)
        placesOwner.onChange = { [weak self] in self?.synchronizeOwnedContext() }
        synchronizeOwnedContext()
    }

    func activate() {
        NativeNotificationRouter.shared.attach(self)
        let currentScope = NativeLegacySourceScope(
            production: NativeRuntimeConfiguration.storedMode() == .production
        )
        if currentScope != legacySourceScope {
            // Reconfigure the three source-owning local readers as one
            // lifecycle transition before reading any persisted content.
            legacySourceScope = currentScope
            placesOwner.configure(production: currentScope.isProduction)
            NativeAgendaStore.shared.configure(sourceScope: currentScope)
        }
        // A user may have completed the explicit Places handover in the
        // compatibility screen while this native-only root stayed in memory.
        // Read the protected store again rather than making them relaunch.
        placesOwner.refreshFromDisk()
        synchronizeOwnedContext()
    }

    func performPlacesCommand(_ command: NativePlacesCommand) async throws -> NativePlacesReply {
        guard canEditPlaces else { throw NativePlacesOwnerError.unavailable }
        return try await placesOwner.perform(command)
    }

    func open(url: URL) {
        openNativeRoute(NativeDeepLinkRouter.parse(url, acceptedSchemes: [NearcastBuildIdentity.urlScheme]))
    }

    func openNativeNotification(userInfo: [AnyHashable: Any]) {
        // Notification payloads are untrusted input just like URLs. Convert
        // them into the same bounded route grammar, then resolve any place
        // only against the verified native context. This keeps a normal
        // notification tap inside native Nearcast without claiming ownership
        // of a legacy watch or opening WebKit as a side effect.
        openNativeRoute(NativeNotificationRouteParser.parse(
            userInfo,
            acceptedSchemes: [NearcastBuildIdentity.urlScheme]
        ))
    }

    private func openNativeRoute(_ result: NativeDeepLinkResult) {
        switch result {
        case .unavailable(let unavailable):
            nativeRouteUnavailable = unavailable
        case .route(let intent):
            guard let context else {
                nativeRouteUnavailable = .unavailablePlace
                return
            }
            switch intent.resolvedRoute(in: context) {
            case .success(let route):
                nativeRouteUnavailable = nil
                // A second tap on the same URL/notification is a new request,
                // even if the reader has navigated locally since the first.
                router.select(route, reapply: true)
            case .failure(let unavailable):
                nativeRouteUnavailable = unavailable
            }
        }
    }

    /// The one-time Places handover needs the compatibility host to arrive at
    /// its native-preview settings screen, not at an unrelated legacy detail
    /// page. The user still has to choose the alert action and explicitly
    /// approve migration from Settings; this merely routes them to the right
    /// starting point.
    func requestVerifiedPlacesMigration() {
        guard placesOwner.status == "unmigrated", !placesOwner.isActivating else { return }
        compatibilityRequest = NativeOnlyCompatibilityRequest(
            title: "Finish setting up saved places?",
            message: "Nearcast will open the existing screen once so you can verify and approve moving your saved places to this iPhone. Your places, plans, and notification choices stay unchanged until you approve it.",
            confirmTitle: "Open saved-place import",
            launch: .home
        )
    }

    /// A native-only Dev session has no WebKit hierarchy and therefore cannot
    /// discover older Plans by itself. This is an explicit, user-confirmed
    /// bridge to the exact existing Plans screen solely to obtain its already
    /// validated, read-only Agenda export. Returning native still requires a
    /// second confirmation before any schedule records are copied.
    func requestVerifiedPlansHandoff(context: NativePreviewContext) {
        guard compatibilityRequest == nil else { return }
        let place = context.selectedPlace
        compatibilityRequest = NativeOnlyCompatibilityRequest(
            title: "Find existing saved plans?",
            message: "Nearcast will open the existing Plans screen once to verify your saved schedule. Return here afterward to choose whether to copy it into native Plans. Existing plans, notifications, and Watch updates are not changed.",
            confirmTitle: "Open existing Plans",
            launch: .handoff(NativePreviewHandoff(
                destination: .plans,
                place: place,
                date: nil,
                timezone: place.timezone
            ))
        )
    }

    private func synchronizeOwnedContext() {
        guard placesOwner.status == "owned" else {
            canEditPlaces = false
            if placesOwner.status == "unmigrated" {
                // Native cutover starts fresh. A legacy preview cache is not
                // an owned Places list, and must not bypass first-run setup.
                context = nil
                setupMessage = "Choose your first place. Your weather, plans, and settings will live here in native Nearcast."
            } else {
                context = nil
                setupMessage = placesOwner.message ?? "Native saved places could not be verified."
            }
            return
        }

        guard let source = placesOwner.snapshot?.source,
              let verifiedContext = source.toPreviewContext() else {
            context = nil
            canEditPlaces = false
            setupMessage = "Native saved places need attention before weather can open."
            return
        }

        context = verifiedContext
        canEditPlaces = true
        setupMessage = ""
        NativePreviewContextStore.save(verifiedContext)
    }
}

/// The native-first Dev root. It is instantiated before any compatibility
/// host, so a normal native test creates no WKWebView at all.
struct NativeOnlyExperienceRoot: View {
    let onOpenCompatibility: (NativeCompatibilityLaunch) -> Void
    @StateObject private var coordinator = NativeOnlyExperienceCoordinator()

    var body: some View {
        Group {
            if let context = coordinator.context {
                NativeOnlyWeatherContainer(context: context, coordinator: coordinator)
            } else {
                NativeOnlySetupView(
                    message: coordinator.setupMessage,
                    placesOwner: coordinator.placesOwner,
                    onBeginVerifiedPlacesMigration: { coordinator.requestVerifiedPlacesMigration() }
                )
            }
        }
        .accessibilityIdentifier("nearcast.native.root")
        .task {
            coordinator.activate()
        }
        .onAppear { coordinator.activate() }
        .onOpenURL { coordinator.open(url: $0) }
        .alert(item: $coordinator.nativeRouteUnavailable) { unavailable in
            Alert(
                title: Text(unavailable.title),
                message: Text(unavailable.message),
                dismissButton: .default(Text("Stay in native Nearcast"))
            )
        }
        .alert(item: $coordinator.compatibilityRequest) { request in
            Alert(
                title: Text(request.title),
                message: Text(request.message),
                primaryButton: .default(Text(request.confirmTitle), action: {
                    onOpenCompatibility(request.launch)
                }),
                secondaryButton: .cancel(Text("Keep native setup"))
            )
        }
    }
}

private struct NativeOnlySetupView: View {
    let message: String
    @ObservedObject var placesOwner: NativePlacesOwnerController
    let onBeginVerifiedPlacesMigration: () -> Void
    @State private var showingNativePlacesBootstrap = false

    var body: some View {
        VStack(spacing: 20) {
            ContentUnavailableView(
                "Welcome to Nearcast",
                systemImage: "sun.horizon",
                description: Text(message.isEmpty
                    ? "This Dev build starts without the browser so we can finish the native experience cleanly."
                    : message)
            )
            Button("Choose your first place") { showingNativePlacesBootstrap = true }
                .buttonStyle(.borderedProminent)
                .disabled(placesOwner.status != "unmigrated" || placesOwner.isActivating)
            Text("Start fresh with the places that matter to you. Existing native places and plans are kept. No import is needed, and notifications stay off until you choose them.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
        }
        .padding(24)
        .accessibilityIdentifier("nearcast.native.places.bootstrap")
        .sheet(isPresented: $showingNativePlacesBootstrap) {
            NativePlacesBootstrapSheet(
                placesOwner: placesOwner,
                onDone: { showingNativePlacesBootstrap = false },
                showsLegacyImport: false,
                onImportExisting: {
                    showingNativePlacesBootstrap = false
                    DispatchQueue.main.async { onBeginVerifiedPlacesMigration() }
                }
            )
        }
    }
}

/// A useful, native surface for a Dev install that has a read-only weather
/// cache but has not yet set up native Places. It makes the limitation obvious
/// while still letting someone compare cached family locations. Crucially, it
/// never promotes the reduced cache into the source of truth or claims changes
/// will reach the Watch/widgets.
private struct NativeOnlyPlacesSetupSheet: View {
    let context: NativePreviewContext
    let selectedPlace: NativePreviewPlace
    let initialTab: NativePlacesSettingsTab
    let onSelectTemporary: (NativePreviewPlace) -> Void
    let onStartNativeSetup: () -> Void
    let onImportExisting: () -> Void
    let onDone: () -> Void

    @State private var tab: NativePlacesSettingsTab

    init(
        context: NativePreviewContext,
        selectedPlace: NativePreviewPlace,
        initialTab: NativePlacesSettingsTab,
        onSelectTemporary: @escaping (NativePreviewPlace) -> Void,
        onStartNativeSetup: @escaping () -> Void,
        onImportExisting: @escaping () -> Void,
        onDone: @escaping () -> Void
    ) {
        self.context = context
        self.selectedPlace = selectedPlace
        self.initialTab = initialTab
        self.onSelectTemporary = onSelectTemporary
        self.onStartNativeSetup = onStartNativeSetup
        self.onImportExisting = onImportExisting
        self.onDone = onDone
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Show", selection: $tab) {
                    ForEach(NativePlacesSettingsTab.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 10)

                if tab == .places {
                    placesContent
                } else {
                    settingsContent
                }
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle(tab.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: onDone).fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var placesContent: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Temporary weather preview", systemImage: "eye")
                        .font(.body.weight(.semibold))
                    Text("You can compare the places already cached in this Dev build. Choosing one only changes this weather view—it does not update saved places, your Watch, or widgets.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
            }

            Section {
                ForEach(context.places, id: \.coordinateIdentity) { place in
                    temporaryPlaceButton(place)
                }
            } header: {
                Text("Places in this preview")
            } footer: {
                Text("Set up native Places to search for a new location, add it to your family places, rename places, or make a change that follows you across Nearcast.")
            }

            nativeSetupCallToAction
        }
        .listStyle(.insetGrouped)
    }

    private var settingsContent: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Make Nearcast yours", systemImage: "gearshape")
                        .font(.body.weight(.semibold))
                    Text("Choose your first place to set your clock, units, appearance, and sky preferences.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
            }

            nativeSetupCallToAction
        }
        .listStyle(.insetGrouped)
    }

    private func temporaryPlaceButton(_ place: NativePreviewPlace) -> some View {
        let selected = place.coordinateIdentity == selectedPlace.coordinateIdentity
        return Button {
            onSelectTemporary(place)
            onDone()
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: selected ? "checkmark.circle.fill" : "mappin.and.ellipse")
                    .font(.title3)
                    .foregroundStyle(selected ? Color.accentColor : .secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(place.name).font(.body.weight(.semibold))
                    Text(selected ? "Showing now" : "Show temporarily")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    Text("Current")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tint)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(selected)
        .accessibilityLabel("\(place.name), \(selected ? "showing now" : "show temporarily")")
        .accessibilityHint(selected
            ? "This is the weather currently shown."
            : "Changes only this preview until saved places are set up.")
    }

    private var nativeSetupCallToAction: some View {
        Section {
            Button(action: onStartNativeSetup) {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: "iphone.and.arrow.forward")
                        .font(.title3)
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Set up native saved places")
                            .font(.body.weight(.semibold))
                        Text("Choose one location, confirm it, and then add family places and settings here in native Nearcast.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .frame(minHeight: 54)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } footer: {
            Text("This starts a new native list. It does not copy these temporary preview places or change saved places in the existing app.")
        }
    }

    private var importExistingCallToAction: some View {
        Section {
            Button(action: onImportExisting) {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Import existing saved places instead")
                            .font(.body.weight(.semibold))
                        Text("Use the one-time verified handover to keep your older family places and settings.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .frame(minHeight: 54)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } footer: {
            Text("Import is optional. Nearcast opens the existing screen only after you choose it, then asks you to approve the verified handover.")
        }
    }
}

/// Mirrors the native weather container’s verified Places flow, without a
/// web model underneath it. Native first-run setup stays in this surface;
/// importing an older saved-place inventory remains an explicit compatibility
/// action because only that path has the complete verified legacy source.
private struct NativeOnlyWeatherContainer: View {
    @ObservedObject private var coordinator: NativeOnlyExperienceCoordinator
    @ObservedObject private var router: NativeAppRouter
    @StateObject private var preview: NativeWeatherPreviewModel
    @StateObject private var placesControls: NativePlacesControlsModel
    @State private var placesPresentation: NativeOnlyPlacesPresentation?
    @State private var pendingOwnedPlacesTab: NativePlacesSettingsTab?
    @State private var showingAgenda = false
    @State private var showingAsk = false
    @State private var showingLiveActivity = false
    @State private var pendingAskNavigation: NativeAskNavigationAction?
    @ObservedObject private var planLibrary = NativePlanLibrary.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingNativeMap = false
    @State private var showingNativePlacesBootstrap = false
    @State private var nativeBootstrapReturnTab: NativePlacesSettingsTab = .places
    @State private var pendingPlanHourly: NativeAgendaItem?
    @State private var pendingAskHourly: NativeAskForecastTarget?
    @State private var askPlaceOverride: NativePreviewPlace?
    @State private var askAfterPlaces = false
    @State private var routeApplication = NativeAppRouteApplication()

    init(context: NativePreviewContext, coordinator: NativeOnlyExperienceCoordinator) {
        _coordinator = ObservedObject(wrappedValue: coordinator)
        _router = ObservedObject(wrappedValue: coordinator.router)
        _preview = StateObject(wrappedValue: NativeWeatherPreviewModel(context: context))
        _placesControls = StateObject(wrappedValue: NativePlacesControlsModel { command in
            try await coordinator.performPlacesCommand(command)
        })
    }

    var body: some View {
        weatherPreview
        .sheet(item: $placesPresentation, onDismiss: {
            if askAfterPlaces { askAfterPlaces = false; showingAsk = true }
        }) { presentation in
            placesSheet(presentation)
        }
        .sheet(isPresented: $showingNativePlacesBootstrap) {
            nativePlacesBootstrapSheet
        }
        .sheet(isPresented: $showingAgenda, onDismiss: dismissAgenda) {
            agendaSheet
        }
        .sheet(isPresented: $showingAsk, onDismiss: dismissAsk) {
            askSheet
        }
        .sheet(isPresented: $showingLiveActivity) {
            NavigationStack {
                ScrollView {
                    NativeLiveActivityControls(forecast: preview.forecast, essentials: preview.essentials,
                        place: preview.selectedPlace,
                        isOwnedPlace: coordinator.canEditPlaces && coordinator.context?.selectedPlace.id == preview.selectedPlace.id && coordinator.context?.selectedPlace.coordinateIdentity == preview.selectedPlace.coordinateIdentity)
                        .padding(24)
                }
                .navigationTitle("Live Activity")
                .toolbar { Button("Done") { showingLiveActivity = false } }
            }
            .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $showingNativeMap, onDismiss: dismissNativeMap) {
            nativeMapSheet
        }
        .task {
            adoptVerifiedOwnerSource()
            // Consume startup navigation before suspending for weather. A
            // selection made during loading must remain the reader's choice.
            applyRoute()
            await preview.refresh()
            publishNativeCompanionWeather()
            applyRoute()
        }
        .onChange(of: coordinator.placesOwner.snapshot) { _, _ in
            adoptVerifiedOwnerSource()
            publishNativeCompanionWeather()
        }
        .onChange(of: coordinator.context) { _, context in
            guard let context else { return }
            if context.selectedPlace.coordinateIdentity != preview.selectedPlace.coordinateIdentity {
                routeApplication.finish()
            }
            preview.applyManagedContext(context)
            NativePreviewContextStore.save(context)
            adoptVerifiedOwnerSource()
            publishNativeCompanionWeather()
            applyRoute()
        }
        .onChange(of: coordinator.canEditPlaces) { _, canEditPlaces in
            guard canEditPlaces, !showingNativePlacesBootstrap,
                  let pendingTab = pendingOwnedPlacesTab else { return }
            pendingOwnedPlacesTab = nil
            // Do not compete with the returning compatibility cover. The
            // next native frame presents the complete editor automatically.
            DispatchQueue.main.async {
                placesPresentation = .managed(pendingTab)
            }
        }
        .onChange(of: placesControls.source) { _, source in
            guard let context = source?.toPreviewContext() else { return }
            if context.selectedPlace.coordinateIdentity != preview.selectedPlace.coordinateIdentity {
                routeApplication.finish()
            }
            preview.applyManagedContext(context)
            NativePreviewContextStore.save(context)
            publishNativeCompanionWeather()
        }
        .onChange(of: preview.forecast?.generatedAt) { _, _ in
            publishNativeCompanionWeather()
            // A route may have selected another verified place. That selection
            // deliberately clears its old forecast first, so defer the
            // requested day/hour until the new place has a valid forecast.
            applyRoute()
        }
        .onChange(of: router.revision) { _, _ in applyRoute() }
        .onReceive(preview.$essentials) { _ in
            // Published values arrive before assignment; consume on the next
            // main-actor turn so publication sees the matching alert receipt.
            Task { @MainActor in publishNativeCompanionWeather() }
        }
        .onReceive(planLibrary.$archive) { _ in
            Task { @MainActor in
                publishNativeCompanionWeather()
                reconcileNativePlanNotifications()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                coordinator.activate()
                reconcileNativePlanNotifications()
                publishNativeCompanionWeather()
            }
        }
        .onChange(of: preview.context.metric) { _, _ in reconcileNativePlanNotifications() }
        .onDisappear { preview.cancel() }
    }

    private var weatherPreview: some View {
        NativeWeatherPreviewView(
            model: preview,
            onClose: {},
            showsCloseControl: false,
            allowsExistingMapHandoff: false,
            showsCompatibilityRecovery: false,
            onLegacy: { destination, query in
                if destination == .ask { showingAsk = true }
                else if destination == .plans { showingAgenda = true }
                else { coordinator.nativeRouteUnavailable = .unsupportedDestination }
            },
            // Places and Settings never disappear in native-only Dev. Before
            // ownership is ready, these open an honest native setup surface;
            // after the verified handover, they open the complete editor.
            onPlaces: { openPlaces(.places) },
            onSettings: { openPlaces(.settings) },
            onNativePlans: {
                router.select(.plans())
                showingAgenda = true
            },
            onNativeAsk: { showingAsk = true },
            onLiveActivity: { showingLiveActivity = true },
            nativePlansPresented: showingAgenda,
            onSelectPlace: { place in
                await selectPlace(place)
            },
            usesTemporaryPlaces: !coordinator.canEditPlaces,
            isUncovered: placesPresentation == nil && !showingAgenda && !showingAsk && !showingNativeMap &&
                !showingNativePlacesBootstrap && !showingLiveActivity
        )
        .accessibilityIdentifier("nearcast.native.weather")
    }

    @ViewBuilder
    private func placesSheet(_ presentation: NativeOnlyPlacesPresentation) -> some View {
        switch presentation {
        case .managed(let tab):
            NativePlacesSettingsSheet(
                model: placesControls,
                initialTab: tab,
                onDone: { placesPresentation = nil },
                onOpenExisting: {},
                showsExistingAppActions: false,
                onOpenExistingMap: nil,
                onAskAboutPlace: { place in
                    askPlaceOverride = place
                    askAfterPlaces = true
                    placesPresentation = nil
                },
                nativeMapContext: preview.context,
                nativeMapTimezone: preview.forecast?.timezoneID,
                nativeStorageMessage: coordinator.placesOwner.message
            )
        case .setup(let tab):
            NativeOnlyPlacesSetupSheet(
                context: preview.context,
                selectedPlace: preview.selectedPlace,
                initialTab: tab,
                onSelectTemporary: { place in
                    routeApplication.finish()
                    preview.selectPlace(place)
                },
                onStartNativeSetup: { startNativePlacesBootstrap(from: tab) },
                onImportExisting: { beginPlacesSetup(from: tab) },
                onDone: { placesPresentation = nil }
            )
        }
    }

    private var agendaSheet: some View {
        NativePlansExperience(context: assistantContext, day: preview.selectedDay ?? Date(),
            initialPlanID: router.current.section == .plans ? router.current.planID : nil,
            onDone: { showingAgenda = false },
            onHourly: { item in pendingPlanHourly = item; showingAgenda = false })
    }

    private var askSheet: some View {
        NativeAskExperience(context: assistantContext, day: preview.selectedDay ?? Date(),
            hour: preview.hourlyFocus,
            initialQuery: router.current.section == .ask ? router.current.initialQuery : nil,
            onDone: { showingAsk = false },
            onHourly: { target in pendingAskHourly = target; showingAsk = false },
            onNavigate: { action in
                guard action.isValid else { return }
                pendingAskNavigation = action
                showingAsk = false
            })
    }

    private var nativeMapSheet: some View {
        NativeRadarView(
            place: preview.selectedPlace,
            timezone: preview.forecast?.timezoneID ?? preview.selectedPlace.timezone,
            uses24HourClock: preview.context.uses24HourClock,
            focusedAlertID: router.current.section == .map ? router.current.alertID : nil,
            savedPlaces: preview.context.places,
            onSelectPlace: { place in await selectPlace(place) },
            onAskAboutPlace: {
                showingNativeMap = false
                DispatchQueue.main.async { showingAsk = true }
            },
            onClose: { showingNativeMap = false },
            onExistingMap: nil
        )
    }

    private var nativePlacesBootstrapSheet: some View {
        NativePlacesBootstrapSheet(
            placesOwner: coordinator.placesOwner,
            onDone: {
                showingNativePlacesBootstrap = false
                let tab = nativeBootstrapReturnTab
                DispatchQueue.main.async {
                    guard coordinator.canEditPlaces else { return }
                    placesPresentation = .managed(tab)
                }
            },
            showsLegacyImport: false,
            onImportExisting: {
                showingNativePlacesBootstrap = false
                let tab = nativeBootstrapReturnTab
                DispatchQueue.main.async { beginPlacesSetup(from: tab) }
            }
        )
    }

    private func dismissAgenda() {
        if let item = pendingPlanHourly {
            pendingPlanHourly = nil
            if let calendar = try? NativePlanSchedule.calendar(item.place),
               let date = NativePlanSchedule.date(item.startDate, hour: item.startHour, calendar: calendar) {
                Task { await openAskHourly(.init(place: item.place.previewPlace, day: date, hour: date)) }
            }
        } else if router.current.section == .plans { router.select(.today()) }
    }

    private func dismissAsk() {
        askPlaceOverride = nil
        if router.current.section == .ask { router.select(.today()) }
        if let target = pendingAskHourly {
            pendingAskHourly = nil
            Task { await openAskHourly(target) }
        } else if let action = pendingAskNavigation {
            pendingAskNavigation = nil
            Task { await performAskNavigation(action) }
        }
    }

    private func dismissNativeMap() {
        // A URL-selected map is a primary native destination. Once it closes,
        // return to Today instead of leaving an invisible map route that could
        // re-present after the next forecast refresh.
        if router.current.section == .map { router.select(.today()) }
    }

    private func openPlaces(_ tab: NativePlacesSettingsTab) {
        placesPresentation = coordinator.canEditPlaces ? .managed(tab) : .setup(tab)
    }

    private func beginPlacesSetup(from tab: NativePlacesSettingsTab) {
        // Remember the requested destination, so a successful verified
        // handover returns directly to the full native Places or Settings
        // surface instead of leaving the user to find the same control again.
        pendingOwnedPlacesTab = tab
        placesPresentation = nil
        DispatchQueue.main.async {
            coordinator.requestVerifiedPlacesMigration()
        }
    }

    private func startNativePlacesBootstrap(from tab: NativePlacesSettingsTab) {
        // A canceled legacy import may have left a return tab queued. Starting
        // a genuinely new native list supersedes that pending compatibility
        // intent, so its first ownership receipt cannot present two sheets.
        pendingOwnedPlacesTab = nil
        nativeBootstrapReturnTab = tab
        placesPresentation = nil
        DispatchQueue.main.async {
            showingNativePlacesBootstrap = true
        }
    }

    private func selectPlace(_ place: NativePreviewPlace) async -> Bool {
        routeApplication.finish()
        if coordinator.canEditPlaces {
            return await selectVerifiedPlace(place)
        }
        // The setup sheet calls this state out as temporary. It is deliberately
        // a read-only comparison, not an implicit location-setting mutation.
        preview.selectPlace(place)
        return true
    }

    private func adoptVerifiedOwnerSource() {
        guard let source = coordinator.placesOwner.snapshot?.source else { return }
        _ = placesControls.adoptVerifiedSource(source)
    }

    private func selectVerifiedPlace(_ place: NativePreviewPlace) async -> Bool {
        guard let source = placesControls.source else { return false }
        let candidates = [source.selectedPlace].compactMap { $0 } + source.savedPlaces
        guard let stored = candidates.first(where: {
            $0.id == place.id && $0.previewPlace.coordinateIdentity == place.coordinateIdentity
        }) else {
            return false
        }
        guard await placesControls.select(place: stored),
              let context = placesControls.source?.toPreviewContext() else {
            return false
        }
        preview.applyManagedContext(context)
        NativePreviewContextStore.save(context)
        return true
    }

    private func publishNativeCompanionWeather() {
        guard let owner = coordinator.placesOwner.snapshot else { return }
        if let forecast = preview.forecast {
            _ = NativeSnapshotPublicationCoordinator.shared.publishNativeWeather(
                forecast: forecast,
                previewPlace: preview.selectedPlace,
                source: owner.source,
                revision: owner.revision
            )
        }
        _ = NativeSnapshotPublicationCoordinator.shared.publishNativeContent(
            items: planLibrary.error == nil ? NativeAgenda(capturedAt: Date(), plans: planLibrary.plans).items() : nil,
            forecast: preview.forecast,
            previewPlace: preview.selectedPlace,
            essentials: preview.essentials,
            source: owner.source,
            revision: owner.revision
        )
    }

    private func reconcileNativePlanNotifications() {
        guard planLibrary.error == nil else { return }
        NativePlanNotifications.shared.reconcile(plans: planLibrary.plans, metric: preview.context.metric)
    }

    private func performAskNavigation(_ action: NativeAskNavigationAction) async {
        guard action.isValid else { return }
        switch action.destination {
        case .settings: openPlaces(.settings)
        case .places: openPlaces(.places)
        case .switchPlace, .map:
            routeApplication.finish()
            // Ask may resolve a city that isn't saved. Looking at its weather
            // does not silently add it to the user's family-place collection.
            let target = action.target
            let context = NativePreviewContext(version: preview.context.version, selectedPlace: target.place,
                savedPlaces: preview.context.savedPlaces, metric: preview.context.metric,
                uses24HourClock: preview.context.uses24HourClock, theme: preview.context.theme)
            preview.applyManagedContext(context)
            await preview.refresh()
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: target.place.timezone ?? "") ?? .current
            if target.hour != nil || !calendar.isDateInToday(target.day) {
                preview.showHourly(day: target.day, focusedHour: target.hour)
            } else {
                preview.showToday()
            }
            if action.destination == .map {
                showingNativeMap = true
            }
        }
    }

    private var assistantContext: NativePreviewContext {
        let place = askPlaceOverride ?? preview.selectedPlace
        let verified = NativePreviewPlace(id: place.id, name: place.name, latitude: place.latitude,
            longitude: place.longitude, timezone: (askPlaceOverride == nil ? preview.forecast?.timezoneID : nil) ?? place.timezone, countryCode: place.countryCode)
        return NativePreviewContext(version: preview.context.version, selectedPlace: verified,
            savedPlaces: preview.context.savedPlaces, metric: preview.context.metric,
            uses24HourClock: preview.context.uses24HourClock, theme: preview.context.theme)
    }

    private func openAskHourly(_ target: NativeAskForecastTarget) async {
        routeApplication.finish()
        // A looked-up plan place can be read without adding it to saved places.
        let context = NativePreviewContext(version: preview.context.version, selectedPlace: target.place,
            savedPlaces: preview.context.savedPlaces, metric: preview.context.metric,
            uses24HourClock: preview.context.uses24HourClock, theme: preview.context.theme)
        preview.applyManagedContext(context)
        await preview.refresh()
        preview.showHourly(day: target.day, focusedHour: target.hour)
    }

    private func applyRoute() {
        let route = router.current
        let action = routeApplication.begin(revision: router.revision, selectedPlace: preview.selectedPlace)
        guard action != .ignore else { return }
        if action == .start {
            // A URL can arrive while another native sheet is open. Dismiss
            // only presentations created by a *previous* routed destination;
            // direct user taps keep their own native presentation state.
            if route.section != .ask { showingAsk = false; askPlaceOverride = nil }
            if route.section != .plans { showingAgenda = false }
            if route.section != .places { placesPresentation = nil; askAfterPlaces = false }
            if route.section != .map { showingNativeMap = false }
        }

        if route.section == .ask { showingAsk = true; return }
        if route.section == .plans {
            showingAgenda = true
            return
        }

        // Place-free navigation keeps the actively viewed place, including a
        // temporary preview choice not persisted in the saved-place owner.
        let resolvedPlace = action == .resume || route.place == nil
            ? preview.selectedPlace
            : coordinator.context.flatMap { route.resolvedPlace(in: $0) }
        guard let place = resolvedPlace else {
            routeApplication.finish()
            coordinator.nativeRouteUnavailable = .unavailablePlace
            if route.section != .home { router.select(.today()) }
            return
        }

        if action == .start && place.coordinateIdentity != preview.selectedPlace.coordinateIdentity {
            // Navigation can inspect another verified family place without
            // treating that view choice as a saved-place mutation.
            preview.selectPlace(place)
        }

        if (route.selectedDay != nil || route.hourlyFocus != nil) && preview.forecast == nil {
            routeApplication.waitForForecast(at: preview.selectedPlace)
            return
        }
        routeApplication.finish()

        if let requestedDay = route.selectedDay,
           let forecast = preview.forecast,
           forecast.day(containing: requestedDay) == nil {
            coordinator.nativeRouteUnavailable = .forecastDayUnavailable
            router.select(.today(place: NativeAppPlaceReference(place)))
            return
        }

        switch route.section {
        case .ask, .plans:
            // Returned above, kept explicit so all native sections are
            // exhaustively handled here without a legacy default branch.
            return
        case .places:
            if placesPresentation == nil {
                openPlaces(route.placesPresentation == .settings ? .settings : .places)
            }
        case .map:
            showingNativeMap = true
        case .home:
            guard let presentation = route.homePresentation else { return }
            switch presentation {
            case .today:
                if let requestedDay = route.selectedDay { preview.showDay(requestedDay) }
                else { preview.showToday() }
            case .hourly:
                preview.showHourly(day: route.selectedDay, focusedHour: route.hourlyFocus)
            }
        }
    }
}
