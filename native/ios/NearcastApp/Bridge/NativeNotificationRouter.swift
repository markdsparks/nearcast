import Foundation

/// The app can now be hosted either by the compatibility web surface or by a
/// native-only root. Notification delivery belongs to the active root, not to
/// WebKit. A queued notification is delivered only after one has attached.
@MainActor
protocol NativeNotificationRouteHandling: AnyObject {
    func openNativeNotification(userInfo: [AnyHashable: Any])
}

@MainActor
final class NativeNotificationRouter {
    static let shared = NativeNotificationRouter()

    private weak var model: NearcastWebModel?
    private weak var nativeHandler: (any NativeNotificationRouteHandling)?
    private var pendingUserInfo: [AnyHashable: Any]?

    private init() {}

    func attach(_ model: NearcastWebModel) {
        self.model = model
        nativeHandler = nil
        deliverPendingIfNeeded()
    }

    /// Native-first hosts attach here before rendering their first weather
    /// surface. This keeps an incoming notification observable in native-only
    /// Dev even while an exact Plans route is still being migrated.
    func attach(_ handler: any NativeNotificationRouteHandling) {
        nativeHandler = handler
        model = nil
        deliverPendingIfNeeded()
    }

    func route(userInfo: [AnyHashable: Any]) {
        if let nativeHandler {
            nativeHandler.openNativeNotification(userInfo: userInfo)
            return
        }
        if let model {
            model.openNotification(userInfo: userInfo)
            return
        }
        pendingUserInfo = userInfo
    }

    private func deliverPendingIfNeeded() {
        guard let pendingUserInfo else { return }
        self.pendingUserInfo = nil
        if let nativeHandler {
            nativeHandler.openNativeNotification(userInfo: pendingUserInfo)
        } else if let model {
            model.openNotification(userInfo: pendingUserInfo)
        } else {
            self.pendingUserInfo = pendingUserInfo
        }
    }
}
