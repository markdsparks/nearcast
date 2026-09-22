import SwiftUI

@main
struct NearcastApp: App {
    @UIApplicationDelegateAdaptor(NearcastAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            NearcastLaunchRoot()
        }
    }
}

/// Chooses the app shell before a compatibility web model exists. In a Dev
/// native-only session this is the important boundary: `NearcastWebModel` and
/// its WKWebView cannot be created accidentally just because the app launched.
/// Release keeps the established compatibility host until every route has a
/// native implementation.
private struct NearcastLaunchRoot: View {
    private struct Presentation: Identifiable {
        let id = UUID()
        let launch: NativeCompatibilityLaunch
    }
    @State private var compatibilityLaunch: Presentation?

    var body: some View {
        if NativeRuntimeConfiguration.isNativeOnlyExperience {
            NativeOnlyExperienceRoot { launch in
                compatibilityLaunch = Presentation(launch: launch)
            }
            .fullScreenCover(item: $compatibilityLaunch) { presentation in
                // This is the only normal native-only Dev construction of the
                // retained compatibility host. It follows an explicit,
                // confirmed migration/recovery request in NativeOnlyExperienceRoot.
                NearcastCompatibilityRoot(
                    launch: presentation.launch,
                    allowNativeOnlyCompatibility: true
                )
                    .safeAreaInset(edge: .top, spacing: 0) {
                        HStack {
                            Text("Nearcast").font(.headline)
                            Spacer()
                            Button("Done") { compatibilityLaunch = nil }
                                .font(.headline)
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(.regularMaterial)
                    }
            }
        } else {
            NearcastCompatibilityRoot(launch: nil)
        }
    }
}

private struct NearcastCompatibilityRoot: View {
    let launch: NativeCompatibilityLaunch?
    let allowNativeOnlyCompatibility: Bool
    @StateObject private var webModel: NearcastWebModel
    @State private var didApplyLaunch = false

    init(launch: NativeCompatibilityLaunch?, allowNativeOnlyCompatibility: Bool = false) {
        self.launch = launch
        self.allowNativeOnlyCompatibility = allowNativeOnlyCompatibility
        _webModel = StateObject(wrappedValue: NearcastWebModel(
            allowNativeOnlyCompatibility: allowNativeOnlyCompatibility
        ))
    }

    var body: some View {
        ContentView(model: webModel, automaticallyOpenNativeHome: automaticallyOpenNativeHome)
            .accessibilityIdentifier("nearcast.compatibility.root")
            .onOpenURL { url in
                webModel.openDeepLink(url)
            }
            .task {
                guard !didApplyLaunch else { return }
                didApplyLaunch = true
                if let launch {
                    webModel.openCompatibilityLaunch(launch)
                }
            }
    }

    private var automaticallyOpenNativeHome: Bool {
        switch launch {
        // The native-only Places setup handoff deliberately opens the
        // compatibility host at Home so it can present the proven native
        // migration controls. Contextual Ask/Plans/map handoffs must still
        // stay in their requested existing-app route.
        case .none, .some(.home): true
        case .some: false
        }
    }
}
