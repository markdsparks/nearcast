import Foundation

@main
struct NativeNotificationRouteTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func route(_ payload: [AnyHashable: Any]) -> NativeDeepLinkResult {
        NativeNotificationRouteParser.parse(payload, acceptedSchemes: ["nearcast-dev"])
    }

    static func resolved(_ result: NativeDeepLinkResult, context: NativePreviewContext) -> NativeAppRoute? {
        guard case .route(let intent) = result,
              case .success(let route) = intent.resolvedRoute(in: context,
                now: Date(timeIntervalSince1970: 1_789_300_800)) else { return nil }
        return route
    }

    static func main() {
        let home = NativePreviewPlace(id: "home", name: "Home", latitude: 38.72, longitude: -89.95,
            timezone: "America/Chicago")
        let away = NativePreviewPlace(id: "away", name: "Away", latitude: 41.88, longitude: -87.63,
            timezone: "America/Chicago")
        let context = NativePreviewContext(version: 1, selectedPlace: home, savedPlaces: [away],
            metric: false, uses24HourClock: false, theme: "auto")

        let plan = resolved(route([
            "aps": ["alert": "A plan changed"],
            "data": ["memoryId": "plan-123"]
        ]), context: context)
        expect(plan?.section == .plans && plan?.planID == "plan-123",
            "A nested plan notification opens native Plans with its stable target")

        let nativePlan = resolved(route([
            "url": "nearcast-dev://plans?planId=plan-456"
        ]), context: context)
        expect(nativePlan?.section == .plans && nativePlan?.planID == "plan-456",
            "A native notification URL preserves its routed query identity")

        let hourly = resolved(route([
            "url": "https://getnearcast.app/hourly?placeId=away&date=2026-09-22&hour=9"
        ]), context: context)
        expect(hourly?.section == .home && hourly?.homePresentation == .hourly,
            "A trusted public hourly URL becomes a native hourly route")
        expect(hourly?.resolvedPlace(in: context) == away,
            "A notification may inspect only an already-saved native place")

        let alert = resolved(route(["nearcast": ["alertId": "alert-1"]]), context: context)
        expect(alert?.section == .map && alert?.alertID == "alert-1",
            "An alert notification opens native Map and retains its alert identity")

        let generic = resolved(route(["aps": ["alert": "Weather updated"]]), context: context)
        expect(generic?.section == .home && generic?.homePresentation == .today,
            "A generic notification safely returns to native Today")

        let conflicting = route(["planId": "one", "data": ["memoryId": "two"]])
        expect(conflicting == .unavailable(.conflictingDestination),
            "Conflicting notification identifiers never choose a plan silently")

        let foreign = route(["url": "https://example.com/plans?planId=plan-123"])
        expect(foreign == .unavailable(.unsupportedScheme),
            "Notifications never grant arbitrary web URLs control of native navigation")

        let unsaved = route(["placeId": "not-saved", "target": "hourly"])
        guard case .route(let intent) = unsaved,
              case .failure(let unavailable) = intent.resolvedRoute(in: context) else {
            preconditionFailure("An unsaved notification place must remain unresolvable")
        }
        expect(unavailable == .unsavedPlace,
            "Notification places must resolve only against verified saved places")

        print("PASS Native notification routing: bounded payloads, trusted links, and verified native destinations")
    }
}
