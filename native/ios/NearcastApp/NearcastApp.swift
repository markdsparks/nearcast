import SwiftUI

@main
struct NearcastApp: App {
    @UIApplicationDelegateAdaptor(NearcastAppDelegate.self) private var appDelegate
    @StateObject private var webModel = NearcastWebModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: webModel)
        }
    }
}
