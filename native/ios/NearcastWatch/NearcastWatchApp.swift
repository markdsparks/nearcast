import SwiftUI
import WatchKit
import WidgetKit

@main
struct NearcastWatchApp: App {
    init() {
        // WatchConnectivity must be active before a background transfer wakes
        // the app; waiting for the first view appearance can miss that window.
        NearcastWatchSnapshotReceiver.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            NearcastWatchRootView()
        }
        .backgroundTask(.appRefresh(NearcastWatchBackgroundRefresh.identifier)) {
            await NearcastWatchBackgroundRefresh.perform()
        }
        .backgroundTask(.watchConnectivity) {
            await NearcastWatchSnapshotReceiver.shared.handleBackgroundDelivery()
        }
    }
}

enum NearcastWatchBackgroundRefresh {
    static let identifier = "app.nearcast.watch.weather-refresh"
    private static let preferredInterval: TimeInterval = 60 * 60

    @MainActor
    static func schedule(from now: Date = Date()) {
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: now.addingTimeInterval(preferredInterval),
            userInfo: identifier as NSString
        ) { _ in
            // Scheduling is best effort. A future foreground launch will try
            // again if watchOS declines this request.
        }
    }

    static func perform() async {
        // Queue the successor before doing any network work. watchOS can end a
        // background task early, so rescheduling at the end is not reliable.
        await schedule()

        let fallback = NearcastWidgetSnapshot.current()
        _ = await NearcastWatchWeatherClient.refresh(fallback: fallback)

        // A failed fetch deliberately leaves the cached snapshot untouched;
        // reloading still lets the complication rebuild its projected entries
        // relative to the new current time.
        WidgetCenter.shared.reloadAllTimelines()
    }
}
