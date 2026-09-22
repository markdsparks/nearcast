import SwiftUI

enum NativePlacesSettingsTab: String, CaseIterable, Identifiable {
    case places
    case settings

    var id: String { rawValue }
    var title: String { self == .places ? "Places" : "Settings" }
}

/// Native controls for the verified owner's saved records. The confirmed source is
/// always the UI's truth; tapping a row never moves a checkmark optimistically.
struct NativePlacesSettingsSheet: View {
    @ObservedObject var model: NativePlacesControlsModel
    let onDone: () -> Void
    let onOpenExisting: () -> Void
    /// Compatibility hosts still show their retained settings bridge.
    /// Native-only Dev hides it rather than advertising an old app route.
    let showsExistingAppActions: Bool
    let onOpenExistingMap: (() -> Void)?
    let onAskAboutPlace: ((NativePreviewPlace) -> Void)?
    let nativeMapContext: NativePreviewContext?
    let nativeMapTimezone: String?
    let onEnableNativeStorage: (() -> Void)?
    let nativeStorageMessage: String?
    let isEnablingNativeStorage: Bool

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var tab: NativePlacesSettingsTab
    @State private var searchQuery = ""
    @State private var waitingToSearch = false
    @State private var renameTarget: NativeManagedPlace?
    @State private var renameText = ""
    @State private var showingRename = false
    @State private var removeTarget: NativeManagedPlace?
    @State private var showingRemove = false
    @State private var showingNativeStorageConfirmation = false
    @State private var showingRadarLab = false
    @State private var showingNativeMap = false

    init(
        model: NativePlacesControlsModel,
        initialTab: NativePlacesSettingsTab = .places,
        onDone: @escaping () -> Void,
        onOpenExisting: @escaping () -> Void,
        showsExistingAppActions: Bool = true,
        onOpenExistingMap: (() -> Void)? = nil,
        onAskAboutPlace: ((NativePreviewPlace) -> Void)? = nil,
        nativeMapContext: NativePreviewContext? = nil,
        nativeMapTimezone: String? = nil,
        onEnableNativeStorage: (() -> Void)? = nil,
        nativeStorageMessage: String? = nil,
        isEnablingNativeStorage: Bool = false
    ) {
        self.model = model
        self.onDone = onDone
        self.onOpenExisting = onOpenExisting
        self.showsExistingAppActions = showsExistingAppActions
        self.onOpenExistingMap = onOpenExistingMap
        self.onAskAboutPlace = onAskAboutPlace
        self.nativeMapContext = nativeMapContext
        self.nativeMapTimezone = nativeMapTimezone
        self.onEnableNativeStorage = onEnableNativeStorage
        self.nativeStorageMessage = nativeStorageMessage
        self.isEnablingNativeStorage = isEnablingNativeStorage
        _tab = State(initialValue: initialTab)
    }

    private var searching: Bool {
        !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var queryIsReady: Bool {
        searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                tabPicker
                if model.source == nil {
                    unavailableOrLoading
                } else if tab == .places {
                    placesList
                        .searchable(text: $searchQuery, placement: .navigationBarDrawer(displayMode: .always), prompt: "City or ZIP code")
                } else {
                    settingsList
                }
            }
            .disabled(isEnablingNativeStorage)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle(tab.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: onDone)
                        .fontWeight(.semibold)
                        .disabled(model.isBusy || isEnablingNativeStorage)
                }
            }
            .task { await model.reload() }
            .task(id: searchQuery) {
                // Clear the old query immediately, before the short debounce.
                // A tap must never select a result from the previous query.
                await model.search(query: "")
                guard queryIsReady else {
                    waitingToSearch = false
                    return
                }
                waitingToSearch = true
                do { try await Task.sleep(for: .milliseconds(250)) }
                catch { return }
                guard !Task.isCancelled else { return }
                waitingToSearch = false
                await model.search(query: searchQuery)
            }
            .onChange(of: tab) { _, _ in searchQuery = "" }
            .alert("Rename place", isPresented: $showingRename) {
                TextField("Name, such as Home", text: $renameText)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                Button("Save") {
                    guard let target = renameTarget else { return }
                    let alias = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task { _ = await model.rename(id: target.id, alias: alias) }
                }
                .disabled(model.isBusy || renameText.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 36)
                Button("Cancel", role: .cancel) { renameTarget = nil }
            } message: {
                Text("Give this place a name of up to 36 characters. Leave it blank to use the city name.")
            }
            .confirmationDialog("Remove saved place?", isPresented: $showingRemove, titleVisibility: .visible, presenting: removeTarget) { place in
                Button("Remove \(place.displayName)", role: .destructive) {
                    Task { _ = await model.remove(id: place.id) }
                }
                Button("Cancel", role: .cancel) { removeTarget = nil }
            } message: { _ in
                Text(NativeRuntimeConfiguration.isNativeOnlyExperience
                    ? "This removes the place from your saved list. Your plans stay saved."
                    : model.source?.owner == "native"
                    ? "Your plans stay saved. Watching this saved place will stop after notification settings finish syncing."
                    : "Your plans stay saved. Watching this saved place for weather changes will stop.")
            }
            .confirmationDialog("Use native storage?", isPresented: $showingNativeStorageConfirmation, titleVisibility: .visible) {
                Button("Use native storage") {
                    guard !model.isBusy, !isEnablingNativeStorage else { return }
                    onEnableNativeStorage?()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Saved places and these settings will move to native storage on this iPhone. Plans and notification choices stay in the existing app. This handover has no automatic rollback.")
            }
        }
        .interactiveDismissDisabled(model.isBusy || isEnablingNativeStorage)
        .fullScreenCover(isPresented: $showingRadarLab) {
            RadarFoundationView(onClose: { showingRadarLab = false })
        }
        .fullScreenCover(isPresented: $showingNativeMap) {
            if let context = model.source?.toPreviewContext() ?? nativeMapContext {
                NativeRadarView(place: context.selectedPlace,
                    timezone: context.selectedPlace.timezone ?? (context.selectedPlace.coordinateIdentity == nativeMapContext?.selectedPlace.coordinateIdentity ? nativeMapTimezone : nil),
                    uses24HourClock: context.uses24HourClock,
                    savedPlaces: context.places,
                    onSelectPlace: { place in
                        guard let current = model.source,
                              let stored = ([current.selectedPlace].compactMap { $0 } + current.savedPlaces).first(where: {
                                  $0.id == place.id && $0.previewPlace.coordinateIdentity == place.coordinateIdentity
                              }) else { return false }
                        return await model.select(place: stored)
                    },
                    onAskAboutPlace: onAskAboutPlace.map { action in
                        { showingNativeMap = false; action(context.selectedPlace) }
                    },
                    onClose: { showingNativeMap = false },
                    onExistingMap: onOpenExistingMap.map { action in
                        { showingNativeMap = false; action() }
                    })
                    .id(context.selectedPlace.coordinateIdentity)
            }
        }
    }

    private var tabPicker: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                Picker("Show", selection: $tab) {
                    ForEach(NativePlacesSettingsTab.allCases) { item in Text(item.title).tag(item) }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Picker("Show", selection: $tab) {
                    ForEach(NativePlacesSettingsTab.allCases) { item in Text(item.title).tag(item) }
                }
                .pickerStyle(.segmented)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .disabled(model.isBusy)
    }

    @ViewBuilder private var unavailableOrLoading: some View {
        if model.isBusy || model.errorMessage == nil {
            VStack(spacing: 14) {
                ProgressView()
                Text("Getting your places and settings…")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "icloud.slash")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(tab == .places ? "Couldn’t open your places" : "Couldn’t open your settings")
                        .font(.title2.weight(.bold))
                    Text(model.errorMessage ?? "These controls couldn’t load. Try again or continue in the existing app.")
                        .foregroundStyle(.secondary)
                    Button("Try again") { Task { await model.reload() } }
                        .buttonStyle(.borderedProminent)
                    if showsExistingAppActions {
                        Button("Open existing Nearcast", action: onOpenExisting)
                            .buttonStyle(.bordered)
                    }
                    if nativeMapContext != nil, onOpenExistingMap != nil {
                        Button("Try native weather map") { showingNativeMap = true }
                            .buttonStyle(.bordered)
                    }
                }
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity)
                .padding(28)
            }
        }
    }

    private var placesList: some View {
        List {
            statusSection
            if searching {
                searchSection
            } else {
                Section {
                    Button {
                        Task { if await model.useCurrentLocation() { onDone() } }
                    } label: {
                        HStack(alignment: .center, spacing: 12) {
                            Image(systemName: "location.fill")
                                .font(.title3)
                                .foregroundStyle(.tint)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Use my current location").font(.body.weight(.semibold))
                                Text("Show weather where I am.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isBusy)
                }

                if let current = model.source?.selectedPlace,
                   !isSaved(current) {
                    Section("Current place") {
                        placeRow(current, accessory: .save)
                    }
                }

                Section {
                    if let places = model.source?.savedPlaces, !places.isEmpty {
                        ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
                            savedPlaceRow(place, index: index, count: places.count)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("No saved places yet").font(.headline)
                            Text("Search for a city above, then tap its bookmark to keep it here.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 8)
                    }
                } header: {
                    Text("Saved places")
                } footer: {
                    Text("Tap a place to show its weather. Changes are saved in Nearcast.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.reload() }
    }

    @ViewBuilder private var statusSection: some View {
        if let error = model.errorMessage {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Couldn’t finish that", systemImage: "exclamationmark.circle")
                        .font(.headline)
                    Text(error).font(.subheadline).foregroundStyle(.secondary)
                    Button("Refresh places and settings") { Task { await model.reload() } }
                        .disabled(model.isBusy)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 4)
            }
        }
        if model.isBusy {
            Section {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Updating Nearcast…").font(.subheadline).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder private var searchSection: some View {
        Section("Search results") {
            if !queryIsReady {
                Text("Enter at least two characters to find a place.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if waitingToSearch || model.isSearching {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Finding places…").foregroundStyle(.secondary)
                }
            } else if model.searchResults.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No places found").font(.headline)
                    Text("Try a city with its state or country, or a ZIP code.")
                        .foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(model.searchResults, id: \.id) { place in
                    placeRow(place, accessory: .save)
                }
            }
        }
    }

    private enum PlaceAccessory { case save, none }

    private func placeRow(_ place: NativeManagedPlace, accessory: PlaceAccessory) -> some View {
        HStack(alignment: .center, spacing: 8) {
            placeSelectionButton(place)
            if accessory == .save {
                Button {
                    Task { _ = await model.save(place: place) }
                } label: {
                    Image(systemName: isSaved(place) ? "bookmark.fill" : "bookmark")
                        .font(.body.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .disabled(model.isBusy || isSaved(place))
                .accessibilityLabel(isSaved(place) ? "\(place.displayName), saved" : "Save \(place.displayName)")
            }
        }
        .padding(.vertical, 3)
    }

    private func savedPlaceRow(_ place: NativeManagedPlace, index: Int, count: Int) -> some View {
        HStack(alignment: .center, spacing: 8) {
            placeSelectionButton(place)
            Menu {
                Button {
                    renameTarget = place
                    renameText = place.alias ?? ""
                    showingRename = true
                } label: { Label("Rename", systemImage: "pencil") }
                Button {
                    Task { _ = await model.move(id: place.id, direction: -1) }
                } label: { Label("Move up", systemImage: "arrow.up") }
                .disabled(index == 0)
                Button {
                    Task { _ = await model.move(id: place.id, direction: 1) }
                } label: { Label("Move down", systemImage: "arrow.down") }
                .disabled(index == count - 1)
                Divider()
                Button(role: .destructive) {
                    removeTarget = place
                    showingRemove = true
                } label: { Label("Remove saved place", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .disabled(model.isBusy)
            .accessibilityLabel("Options for \(place.displayName)")
        }
        .padding(.vertical, 3)
    }

    private func placeSelectionButton(_ place: NativeManagedPlace) -> some View {
        let selected = model.source?.selectedPlace?.id == place.id
        return Button {
            Task { if await model.select(place: place) { onDone() } }
        } label: {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(place.displayName).font(.body.weight(.semibold))
                    if !placeSubtitle(place).isEmpty {
                        Text(placeSubtitle(place)).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.isBusy)
        .accessibilityElement(children: .combine)
        .accessibilityValue(selected ? "Selected" : "")
        .accessibilityHint("Show weather for this place")
    }

    private func isSaved(_ place: NativeManagedPlace) -> Bool {
        model.source?.savedPlaces.contains { $0.id == place.id } ?? false
    }

    private func placeSubtitle(_ place: NativeManagedPlace) -> String {
        if let alias = place.alias, !alias.isEmpty { return place.subtitle }
        return [place.admin1, place.country].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private var settingsList: some View {
        List {
            statusSection
            nativeStorageSection
            Section {
                ForEach(PreferenceKind.allCases) { kind in
                    NavigationLink {
                        preferencePage(kind)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Label(kind.title, systemImage: kind.symbol).font(.body.weight(.semibold))
                            Text(kind.label(for: preferenceValue(kind)))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 5)
                    }
                    .disabled(model.isBusy)
                }
            } header: {
                Text("Make it yours")
            } footer: {
                Text("Changes are saved in Nearcast.")
            }
            Section {
                Toggle("Reactive sky", isOn: Binding(
                    get: { model.source?.preferences.reactiveSkyEnabled ?? false },
                    set: { value in Task { _ = await model.setPreference(reactiveSkyEnabled: value) } }
                ))
                .frame(minHeight: 44)
                Toggle("Device motion for sky", isOn: Binding(
                    get: { model.source?.preferences.reactiveSkyMotionAllowed ?? false },
                    set: { value in Task { _ = await model.setPreference(reactiveSkyMotionAllowed: value) } }
                ))
                .frame(minHeight: 44)
            } header: {
                Text("Sky effects")
            } footer: {
                Text(model.source?.owner == "native"
                    ? "These settings save your sky preferences. Motion access is requested separately when you use sky effects in existing Nearcast."
                    : "Move Places and Settings to native storage to edit sky preferences here. Until then, use existing settings.")
            }
            .disabled(model.isBusy || model.source?.owner != "native")
            Section {
                if onOpenExistingMap != nil {
                    Button { showingNativeMap = true } label: {
                        Label("Try native weather map", systemImage: "map")
                            .font(.body.weight(.semibold)).frame(minHeight: 44)
                    }
                }
                Button { showingRadarLab = true } label: {
                    Label("Open Radar Lab", systemImage: "dot.radiowaves.left.and.right")
                        .font(.body.weight(.semibold))
                        .frame(minHeight: 44)
                }
            } header: {
                Text("Experimental")
            } footer: {
                Text("Try native radar and model forecasts at your selected place. The regular Map stays unchanged while required layers are migrated. Radar Lab is a separate fixed-location diagnostic.")
            }
            if showsExistingAppActions {
                Section {
                    Button(action: onOpenExisting) {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("Open existing settings").font(.body.weight(.semibold))
                                Text("Plans, notifications and other options.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right").font(.subheadline)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isBusy)
                }
            }
            Section("About") {
                NavigationLink {
                    NativeAcknowledgmentsView()
                } label: {
                    Label("Acknowledgments", systemImage: "doc.text")
                        .frame(minHeight: 44)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder private var nativeStorageSection: some View {
        if model.source?.owner == "native" {
            Section {
                Label("Saved on this iPhone", systemImage: "iphone")
                    .font(.subheadline)
                if let nativeStorageMessage, !nativeStorageMessage.isEmpty {
                    Text(nativeStorageMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Storage")
            }
        } else if model.source?.owner == "legacy", onEnableNativeStorage != nil {
            Section {
                Text("Move saved places and these settings onto this iPhone. Existing screens will use the same records.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    showingNativeStorageConfirmation = true
                } label: {
                    HStack(spacing: 10) {
                        if isEnablingNativeStorage { ProgressView() }
                        Text(isEnablingNativeStorage ? "Moving saved settings…" : "Use native storage")
                    }
                    .frame(minHeight: 44)
                }
                .disabled(model.isBusy || isEnablingNativeStorage)
                if let nativeStorageMessage, !nativeStorageMessage.isEmpty {
                    Text(nativeStorageMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Native migration")
            }
        }
    }

    private enum PreferenceKind: String, CaseIterable, Identifiable {
        case unit, clock, theme

        var id: String { rawValue }
        var title: String {
            switch self { case .unit: "Units"; case .clock: "Clock"; case .theme: "Appearance" }
        }
        var symbol: String {
            switch self { case .unit: "thermometer.medium"; case .clock: "clock"; case .theme: "circle.lefthalf.filled" }
        }
        var options: [String] {
            switch self {
            case .unit: ["fahrenheit", "celsius"]
            case .clock: ["auto", "12", "24"]
            case .theme: ["auto", "light", "dark"]
            }
        }
        var explanation: String {
            switch self {
            case .unit: "Fahrenheit uses miles per hour and inches. Celsius uses kilometers per hour and millimeters."
            case .clock: "Auto follows this iPhone’s clock preference. Times use each place’s local time."
            case .theme: "Auto follows day and night at the selected place."
            }
        }
        func label(for value: String) -> String {
            switch (self, value) {
            case (.unit, "fahrenheit"): "Fahrenheit · °F"
            case (.unit, "celsius"): "Celsius · °C"
            case (.clock, "12"): "12-hour"
            case (.clock, "24"): "24-hour"
            case (_, "auto"): "Auto"
            case (.theme, "light"): "Light"
            case (.theme, "dark"): "Dark"
            default: "Unavailable"
            }
        }
    }

    private func preferenceValue(_ kind: PreferenceKind) -> String {
        guard let preferences = model.source?.preferences else { return "" }
        switch kind {
        case .unit: return preferences.unit
        case .clock: return preferences.timeFormat
        case .theme: return preferences.theme
        }
    }

    private func preferencePage(_ kind: PreferenceKind) -> some View {
        List {
            statusSection
            Section {
                ForEach(kind.options, id: \.self) { value in
                    Button {
                        Task {
                            switch kind {
                            case .unit: _ = await model.setPreference(unit: value)
                            case .clock: _ = await model.setPreference(clock: value)
                            case .theme: _ = await model.setPreference(theme: value)
                            }
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Text(kind.label(for: value))
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if preferenceValue(kind) == value {
                                Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint)
                                    .accessibilityHidden(true)
                            }
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isBusy)
                    .accessibilityValue(preferenceValue(kind) == value ? "Selected" : "")
                }
            } footer: {
                Text(kind.explanation)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// First-run native Places setup. It deliberately starts with a location that
/// this native process resolved after a direct user action; it never converts
/// a weather-preview cache into saved family places. Existing-app import stays
/// a separate, explicit option at the bottom of this sheet.
struct NativePlacesBootstrapSheet: View {
    @ObservedObject var placesOwner: NativePlacesOwnerController
    let onDone: () -> Void
    var showsLegacyImport: Bool = true
    let onImportExisting: () -> Void

    @State private var query = ""
    @State private var results: [NativeManagedPlace] = []
    @State private var pendingPlace: NativeManagedPlace?
    @State private var isSearching = false
    @State private var isLocating = false
    @State private var isCreating = false
    @State private var errorMessage: String?
    @State private var showStartConfirmation = false

    private var canStart: Bool {
        placesOwner.status == "unmigrated" && !placesOwner.isActivating && !isCreating
    }

    private var cleanQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Group {
                if placesOwner.status == "owned" {
                    ContentUnavailableView(
                        "Native Places are ready",
                        systemImage: "checkmark.circle.fill",
                        description: Text("Your saved places are now owned by native Nearcast."))
                } else if placesOwner.status == "blocked" {
                    blockedContent
                } else {
                    setupContent
                }
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Set up Places")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(placesOwner.status == "owned" ? "Done" : "Cancel", action: onDone)
                        .fontWeight(.semibold)
                        .disabled(isCreating)
                }
            }
            .task(id: query) { await searchForStartingPlace() }
            .confirmationDialog("Start native saved places?", isPresented: $showStartConfirmation,
                titleVisibility: .visible, presenting: pendingPlace) { place in
                    Button("Start with \(place.displayName)") {
                        Task { await createNativePlaces(startingAt: place) }
                    }
                    Button("Cancel", role: .cancel) { pendingPlace = nil }
                } message: { place in
                    Text("This starts a new native Places list with \(place.displayName). It does not copy the temporary weather preview or change saved places in the existing app. You can add family places next.")
                }
        }
        .interactiveDismissDisabled(isCreating)
    }

    private var setupContent: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Start with one place", systemImage: "mappin.and.ellipse")
                        .font(.body.weight(.semibold))
                    Text("Choose your current location or search for a city. Nearcast will create a new native saved-places list only after you confirm the exact place.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
            }

            Section {
                Button {
                    Task { await resolveCurrentLocation() }
                } label: {
                    HStack(spacing: 12) {
                        if isLocating { ProgressView() }
                        else {
                            Image(systemName: "location.fill")
                                .foregroundStyle(.tint)
                                .accessibilityHidden(true)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(isLocating ? "Finding your location…" : "Use my current location")
                                .font(.body.weight(.semibold))
                            Text("Nearcast asks for location only after you tap this.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canStart || isLocating || isSearching)
            }

            Section("Or search for a place") {
                TextField("City or ZIP code", text: $query)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .disabled(!canStart || isLocating)

                if cleanQuery.count == 1 {
                    Text("Enter at least two characters to search.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else if isSearching {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Finding places…").foregroundStyle(.secondary)
                    }
                } else if cleanQuery.count >= 2, results.isEmpty {
                    Text("No places found. Try a city with its state or country, or a ZIP code.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(results) { place in
                        Button { choose(place) } label: { placeLabel(place) }
                            .buttonStyle(.plain)
                            .disabled(!canStart)
                    }
                }
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.circle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if showsLegacyImport { Section {
                Button(action: onImportExisting) {
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Import existing saved places instead")
                                .font(.body.weight(.semibold))
                            Text("Use the one-time verified handover if you want to keep your older family-place list and settings.")
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
                .disabled(isCreating || isLocating)
            } footer: {
                Text("Import is optional. Starting native places above never copies temporary preview data.")
            } }
        }
        .listStyle(.insetGrouped)
    }

    private var blockedContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "lock.trianglebadge.exclamationmark")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("Saved places need attention")
                    .font(.title2.weight(.bold))
                Text(placesOwner.message ?? "Nearcast could not verify existing native places, so it will not replace them with a new list.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Check again") { placesOwner.refreshFromDisk() }
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
            .padding(28)
        }
    }

    private func placeLabel(_ place: NativeManagedPlace) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "mappin.circle.fill")
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(place.displayName).font(.body.weight(.semibold))
                let subtitle = [place.admin1, place.country].filter { !$0.isEmpty }.joined(separator: ", ")
                if !subtitle.isEmpty {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityHint("Choose this as the first native saved place")
    }

    private func searchForStartingPlace() async {
        let queryAtStart = cleanQuery
        results = []
        guard queryAtStart.count >= 2 else {
            isSearching = false
            return
        }
        guard canStart, !isLocating else { return }
        isSearching = true
        errorMessage = nil
        defer {
            if cleanQuery == queryAtStart { isSearching = false }
        }
        do {
            try await Task.sleep(for: .milliseconds(250))
            try Task.checkCancellation()
            let found = try await placesOwner.searchForNativeBootstrap(query: queryAtStart)
            guard !Task.isCancelled, cleanQuery == queryAtStart else { return }
            results = found
        } catch is CancellationError { }
        catch {
            guard cleanQuery == queryAtStart else { return }
            errorMessage = error.localizedDescription
        }
    }

    private func resolveCurrentLocation() async {
        guard canStart, !isLocating else { return }
        isLocating = true
        errorMessage = nil
        defer { isLocating = false }
        do {
            let place = try await placesOwner.currentLocationForNativeBootstrap()
            guard !Task.isCancelled else { return }
            choose(place)
        } catch is CancellationError { }
        catch { errorMessage = error.localizedDescription }
    }

    private func choose(_ place: NativeManagedPlace) {
        guard canStart, place.isValid, place.previewPlace.isValid else { return }
        pendingPlace = place
        showStartConfirmation = true
    }

    private func createNativePlaces(startingAt place: NativeManagedPlace) async {
        guard canStart else { return }
        isCreating = true
        errorMessage = nil
        defer { isCreating = false }
        do {
            _ = try await placesOwner.createNativePlaces(startingAt: place)
            guard placesOwner.status == "owned" else {
                errorMessage = "Nearcast could not verify the new saved places. Nothing else was changed."
                return
            }
            onDone()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct NativeAcknowledgmentsView: View {
    private enum Notice: String, CaseIterable, Identifiable {
        case sunCalc = "SunCalc-LICENSE.txt"
        case mapLibre = "MapLibre-LICENSE.md"
        case mapLibreCore = "MapLibre-core-NOTICES.md"
        case mapLibreIOS = "MapLibre-iOS-NOTICES.md"

        var id: String { rawValue }
        var title: String {
            switch self {
            case .sunCalc: "SunCalc"
            case .mapLibre: "MapLibre"
            case .mapLibreCore: "MapLibre Core notices"
            case .mapLibreIOS: "MapLibre iOS notices"
            }
        }

        var text: String? {
            guard let url = Bundle.main.url(forResource: rawValue, withExtension: nil) else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }
    }

    var body: some View {
        List {
            Section {
                ForEach(Notice.allCases) { notice in
                    NavigationLink(notice.title) {
                        ScrollView {
                            Text(verbatim: notice.text ?? "This acknowledgment could not be loaded.")
                                .font(.footnote)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(20)
                        }
                        .navigationTitle(notice.title)
                        .navigationBarTitleDisplayMode(.inline)
                    }
                }
            } footer: {
                Text("Nearcast includes these open-source components and adaptations. Their licenses and notices are reproduced here.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Acknowledgments")
        .navigationBarTitleDisplayMode(.inline)
    }
}
