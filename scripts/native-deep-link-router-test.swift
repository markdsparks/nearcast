import Foundation

@main
struct NativeDeepLinkRouterTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func route(_ raw: String) -> NativeDeepLinkIntent {
        let result = NativeDeepLinkRouter.parse(URL(string: raw)!, acceptedSchemes: ["nearcast-dev"])
        guard case .route(let route) = result else {
            preconditionFailure("Expected native route for \(raw), got \(result)")
        }
        return route
    }

    static func unavailable(_ raw: String, _ expected: NativeRouteUnavailable) {
        let result = NativeDeepLinkRouter.parse(URL(string: raw)!, acceptedSchemes: ["nearcast-dev"])
        guard case .unavailable(let actual) = result else {
            preconditionFailure("Expected unavailable route for \(raw), got \(result)")
        }
        expect(actual == expected, "\(raw) returns \(expected.rawValue), not \(actual.rawValue)")
    }

    static func dateParts(_ date: Date, timeZone: TimeZone) -> DateComponents {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.dateComponents([.year, .month, .day, .hour], from: date)
    }

    static func main() {
        let home = NativePreviewPlace(id: "home", name: "Home", latitude: 38.72, longitude: -89.95,
            timezone: "America/Chicago")
        let away = NativePreviewPlace(id: "away", name: "Away", latitude: 41.88, longitude: -87.63,
            timezone: "America/Chicago")
        let context = NativePreviewContext(version: 1, selectedPlace: home, savedPlaces: [away],
            metric: false, uses24HourClock: false, theme: "auto")
        let chicago = TimeZone(identifier: "America/Chicago")!

        let hourly = route("nearcast-dev://weather?target=hourly&date=2026-09-22&hour=15&placeId=away&lat=41.88000&lon=-87.63000")
        expect(hourly.destination == .hourly && hourly.day == NativeRouteCivilDay("2026-09-22") && hourly.focusedHour == 15,
            "A weather URL keeps an explicit hourly day and hour")
        guard case .success(let hourlyRoute) = hourly.resolvedRoute(in: context,
            now: ISO8601DateFormatter().date(from: "2026-09-20T12:00:00Z")!) else {
            preconditionFailure("Saved place hourly route should resolve natively")
        }
        expect(hourlyRoute.section == .home && hourlyRoute.homePresentation == .hourly && hourlyRoute.place?.matches(away) == true,
            "Hourly URL resolves only against the verified saved place")
        expect(hourlyRoute.selectedDay.map { dateParts($0, timeZone: chicago) }?.day == 22,
            "A civil date resolves in the selected place’s local calendar")
        expect(hourlyRoute.hourlyFocus.map { dateParts($0, timeZone: chicago) }?.hour == 15,
            "The hourly focus remains at the requested local clock hour")

        let widgetHours = route("nearcast-dev://weather?surface=hours")
        expect(widgetHours.destination == .hourly,
            "Existing weather surface=hours links open the native hourly route")
        let directHourly = route("nearcast-dev:///hourly?day=2026-09-23")
        expect(directHourly.destination == .hourly && directHourly.day == NativeRouteCivilDay("2026-09-23"),
            "Path-form custom URLs keep their selected day")

        let ask = route("nearcast-dev://ask?query=Will%20it%20rain%20after%20school%3F&date=2026-09-23")
        expect(ask.destination == .ask && ask.initialQuery == "Will it rain after school?",
            "Ask keeps a bounded intentional draft inside native routing")
        guard case .success(let askRoute) = ask.resolvedRoute(in: context) else {
            preconditionFailure("Ask route should resolve")
        }
        expect(askRoute.section == .ask && askRoute.initialQuery == "Will it rain after school?",
            "Ask route preserves the native draft rather than changing shells")

        let plans = route("nearcast-dev://weather?target=plan&planId=weekend-walk_1")
        guard case .success(let plansRoute) = plans.resolvedRoute(in: context) else {
            preconditionFailure("Plans route should resolve")
        }
        expect(plansRoute.section == .plans && plansRoute.planID == "weekend-walk_1",
            "Plan identity is normalized and retained for later native focusing")
        let widgetPlan = route("nearcast-dev://weather?surface=plan")
        expect(widgetPlan.destination == .plans, "Existing widget plan links select native Plans")

        let map = route("nearcast-dev://map?alertId=flood-watch-42&layer=radar")
        guard case .success(let mapRoute) = map.resolvedRoute(in: context) else {
            preconditionFailure("Map route should resolve")
        }
        expect(mapRoute.section == .map && mapRoute.alertID == "flood-watch-42",
            "Map identity is retained for future native alert focus")

        let settings = route("nearcast-dev://settings")
        guard case .success(let settingsRoute) = settings.resolvedRoute(in: context) else {
            preconditionFailure("Settings route should resolve")
        }
        expect(settingsRoute.section == .places && settingsRoute.placesPresentation == .settings,
            "Settings stays an explicit native Places presentation")
        let places = route("nearcast-dev://weather?target=places")
        guard case .success(let placesRoute) = places.resolvedRoute(in: context) else {
            preconditionFailure("Places route should resolve")
        }
        expect(placesRoute.section == .places && placesRoute.placesPresentation == .places,
            "Weather target=places enters native place management")

        unavailable("nearcast://weather", .unsupportedScheme)
        unavailable("nearcast-dev://details", .unsupportedDestination)
        unavailable("nearcast-dev://weather?target=map&layer=stormscope", .unsupportedMapMode)
        unavailable("nearcast-dev://weather?target=hourly&target=map", .conflictingDestination)
        unavailable("nearcast-dev://hourly?date=2026-02-30", .invalidDate)
        let unknownPlace = route("nearcast-dev://hourly?placeId=not-saved")
        guard case .failure(let unavailablePlace) = unknownPlace.resolvedRoute(in: context) else {
            preconditionFailure("Unknown places never create an unverified native location")
        }
        expect(unavailablePlace == .unsavedPlace,
            "Unknown place links remain a clear native unavailable state")

        print("PASS Native deep-link router: typed routes, native query semantics, safe place resolution, and no implicit web fallback")
    }
}
