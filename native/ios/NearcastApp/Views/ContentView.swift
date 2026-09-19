import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var model: NearcastWebModel

    #if DEBUG
    @State private var showingDiagnostics = false
    #endif

    var body: some View {
        ZStack {
            NearcastWebView(model: model)
                .ignoresSafeArea()

            if shouldShowStartupOverlay {
                startupOverlay
                    .transition(.opacity)
            }

            #if DEBUG
            VStack {
                debugBar
                Spacer()
            }
            .padding(.top, 10)
            .padding(.horizontal, 12)
            #endif
        }
        #if DEBUG
        .sheet(isPresented: $showingDiagnostics) {
            NativeDiagnosticsView(model: model)
        }
        #endif
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            model.recoverIfNeededOnActivation()
        }
        .task { model.openNativeHomeIfAvailable() }
        .fullScreenCover(isPresented: $model.showingNativePreview) {
            if let context = model.nativePreviewContext {
                NativeWeatherPreviewContainer(context: context, webModel: model)
            } else if model.placesOwner.status == "owned" {
                NativePlacesEmptyContainer(webModel: model)
            } else {
                VStack(spacing: 18) {
                    ContentUnavailableView("Saved places unavailable", systemImage: "externaldrive.badge.exclamationmark",
                        description: Text(model.placesOwner.message ?? "Your saved records could not be verified. Nothing was replaced."))
                    Button("Open existing Nearcast") { model.showingNativePreview = false }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
            }
        }
        .alert("Nearcast weather", isPresented: Binding(
            get: { model.nativePreviewError != nil },
            set: { if !$0 { model.nativePreviewError = nil } }
        )) {
            Button("OK") { model.nativePreviewError = nil }
        } message: {
            Text(model.nativePreviewError ?? "")
        }
    }

    private var shouldShowStartupOverlay: Bool {
        !model.hasLoadedPage || model.lastError != nil
    }

    private var startupOverlay: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.72, green: 0.89, blue: 0.96),
                    Color(red: 0.95, green: 0.98, blue: 0.99),
                    Color(red: 1.0, green: 0.83, blue: 0.42)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 18) {
                ZStack {
                    Circle()
                        .fill(.white.opacity(0.78))
                        .frame(width: 84, height: 84)
                        .shadow(color: .black.opacity(0.12), radius: 18, y: 10)

                    Image(systemName: "location.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Color(red: 0.16, green: 0.43, blue: 0.75))
                }

                VStack(spacing: 6) {
                    Text(model.lastError == nil ? "Loading Nearcast" : "Nearcast could not load")
                        .font(.title2.weight(.heavy))
                        .foregroundStyle(Color(red: 0.05, green: 0.09, blue: 0.14))

                    Text(model.lastError ?? "Bringing in your latest forecast.")
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color(red: 0.18, green: 0.28, blue: 0.36))
                        .padding(.horizontal, 24)
                }

                if model.lastError != nil {
                    Button {
                        model.reload()
                    } label: {
                        Text("Try again")
                            .font(.headline.weight(.heavy))
                            .padding(.horizontal, 22)
                            .padding(.vertical, 12)
                            .background(Color(red: 0.05, green: 0.09, blue: 0.14), in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .padding(.top, 4)
                } else {
                    ProgressView()
                        .tint(Color(red: 0.16, green: 0.43, blue: 0.75))
                        .padding(.top, 4)
                }
                if model.nativePreviewContext != nil || model.placesOwner.status == "owned" {
                    Button("Open Nearcast weather") {
                        model.openCachedNativePreview()
                    }
                    .font(.subheadline.weight(.semibold))
                    .padding(.top, 4)
                }
            }
            .padding(28)
        }
    }

    #if DEBUG
    private var debugBar: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(model.isLoading ? Color.yellow : Color.green)
                .frame(width: 8, height: 8)

            Text("Native \(model.mode.label)")
                .font(.caption.weight(.semibold))

            Spacer(minLength: 8)

            Button {
                model.reload()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .accessibilityLabel("Reload Nearcast")

            Button {
                showingDiagnostics = true
            } label: {
                Image(systemName: "slider.horizontal.3")
            }
            .accessibilityLabel("Open native diagnostics")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(.black.opacity(0.58), in: Capsule())
        .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
    }
    #endif
}

/// An empty inventory must not require a web forecast to reach native search.
private struct NativePlacesEmptyContainer: View {
    @ObservedObject var webModel: NearcastWebModel
    @StateObject private var controls: NativePlacesControlsModel

    init(webModel: NearcastWebModel) {
        self.webModel = webModel
        _controls = StateObject(wrappedValue: NativePlacesControlsModel { command in
            try await webModel.performPlacesCommand(command)
        })
    }

    var body: some View {
        NativePlacesSettingsSheet(model: controls, initialTab: .places,
            onDone: { webModel.showingNativePreview = false },
            onOpenExisting: { webModel.openExistingPlacesSettings() },
            nativeStorageMessage: webModel.placesOwner.message)
    }
}

private struct NativeWeatherPreviewContainer: View {
    @StateObject private var preview: NativeWeatherPreviewModel
    @StateObject private var placesControls: NativePlacesControlsModel
    @ObservedObject var webModel: NearcastWebModel
    @ObservedObject private var placesOwner: NativePlacesOwnerController
    // The destination is the presentation identity. Two independent state writes
    // can present a sheet with yesterday's tab before SwiftUI applies the new one.
    @State private var placesSettingsTab: NativePlacesSettingsTab?

    init(context: NativePreviewContext, webModel: NearcastWebModel) {
        _preview = StateObject(wrappedValue: NativeWeatherPreviewModel(context: context))
        _placesControls = StateObject(wrappedValue: NativePlacesControlsModel { command in
            try await webModel.performPlacesCommand(command)
        })
        self.webModel = webModel
        self.placesOwner = webModel.placesOwner
    }

    var body: some View {
        NativeWeatherPreviewView(
            model: preview,
            onClose: { webModel.showingNativePreview = false },
            onLegacy: { destination in
                openExisting(destination)
            },
            onPlaces: {
                placesSettingsTab = .places
            },
            onSettings: {
                placesSettingsTab = .settings
            },
            onSelectPlace: placesControls.source == nil ? nil : { place in
                await selectVerifiedPlace(place)
            }
        )
        .sheet(item: $placesSettingsTab) { tab in
            NativePlacesSettingsSheet(model: placesControls, initialTab: tab,
                onDone: { placesSettingsTab = nil },
                onOpenExisting: {
                    placesSettingsTab = nil
                    webModel.openExistingPlacesSettings()
                },
                onOpenExistingMap: {
                    placesSettingsTab = nil
                    openExisting(.map)
                },
                onAskAboutPlace: { place in
                    placesSettingsTab = nil
                    webModel.handoffNativePreview(NativePreviewHandoff(destination: .ask,
                        place: place, date: nil, timezone: place.timezone))
                },
                nativeMapContext: preview.context,
                nativeMapTimezone: preview.forecast?.timezoneID,
                onEnableNativeStorage: { Task { await webModel.enableNativePlacesStorage() } },
                nativeStorageMessage: placesOwner.message,
                isEnablingNativeStorage: placesOwner.isActivating)
        }
        .onChange(of: placesControls.source) { _, source in
            guard let context = source?.toPreviewContext() else { return }
            preview.applyManagedContext(context)
            NativePreviewContextStore.save(context)
        }
        .onChange(of: placesOwner.snapshot) { _, value in
            if let source = value?.source { placesControls.adoptVerifiedSource(source) }
            publishNativeCompanionWeather()
        }
        .task {
            if let source = placesOwner.snapshot?.source { placesControls.adoptVerifiedSource(source) }
            await preview.refresh()
            publishNativeCompanionWeather()
        }
        .onChange(of: preview.forecast?.generatedAt) { _, _ in publishNativeCompanionWeather() }
        .onDisappear { preview.cancel() }
    }

    private func publishNativeCompanionWeather() {
        guard let forecast = preview.forecast, let owner = placesOwner.snapshot else { return }
        _ = NativeSnapshotPublicationCoordinator.shared.publishNativeWeather(
            forecast: forecast,
            previewPlace: preview.selectedPlace,
            source: owner.source,
            revision: owner.revision
        )
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
        // Apply the verified receipt immediately. The source observation below
        // will see the same value; applyManagedContext is idempotent.
        preview.applyManagedContext(context)
        NativePreviewContextStore.save(context)
        return true
    }

    private func openExisting(_ destination: NativeLegacyDestination) {
        webModel.handoffNativePreview(NativePreviewHandoff(destination: destination,
            place: preview.selectedPlace, date: preview.selectedDay,
            timezone: preview.forecast?.timezoneID ?? preview.selectedPlace.timezone))
    }
}
