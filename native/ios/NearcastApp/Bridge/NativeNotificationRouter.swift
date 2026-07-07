import Foundation

@MainActor
final class NativeNotificationRouter {
    static let shared = NativeNotificationRouter()

    private weak var model: NearcastWebModel?
    private var pendingUserInfo: [AnyHashable: Any]?

    private init() {}

    func attach(_ model: NearcastWebModel) {
        self.model = model
        if let pendingUserInfo {
            self.pendingUserInfo = nil
            route(userInfo: pendingUserInfo)
        }
    }

    func route(userInfo: [AnyHashable: Any]) {
        guard let model else {
            pendingUserInfo = userInfo
            return
        }

        model.openNotification(userInfo: userInfo)
    }
}
