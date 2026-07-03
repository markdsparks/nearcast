import SwiftUI

@main
struct NearcastApp: App {
    @StateObject private var webModel = NearcastWebModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: webModel)
        }
    }
}
