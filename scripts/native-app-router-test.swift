import Foundation

@main
struct NativeAppRouterTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    @MainActor
    static func main() {
        let home = NativePreviewPlace(id: "home", name: "Home", latitude: 38.72, longitude: -89.95,
            timezone: "America/Chicago")
        let away = NativePreviewPlace(id: "away", name: "Away", latitude: 41.88, longitude: -87.63,
            timezone: "America/Chicago")
        let context = NativePreviewContext(version: 1, selectedPlace: home, savedPlaces: [away],
            metric: false, uses24HourClock: false, theme: "auto")
        let awayReference = NativeAppPlaceReference(away)!

        expect(NativeAppPlaceReference(id: "home", coordinateIdentity: "91.00000,-89.95000") == nil,
            "Out-of-range route locations do not establish a native route")
        expect(NativeAppPlaceReference(id: " ", coordinateIdentity: home.coordinateIdentity) == nil,
            "Blank route IDs cannot resolve a native place")
        expect(awayReference.matches(away) && !awayReference.matches(home),
            "Route references require both the stable ID and coordinate identity")

        let selectedDay = Date(timeIntervalSince1970: 1_789_300_800)
        let focusedHour = selectedDay.addingTimeInterval(9 * 60 * 60)
        let hourly = NativeAppRoute.hourly(place: awayReference, day: selectedDay, focusedHour: focusedHour)
        expect(hourly.section == .home && hourly.homePresentation == .hourly,
            "A selected day can open directly in native hourly")
        expect(hourly.selectedDay == selectedDay && hourly.hourlyFocus == focusedHour,
            "Native hourly retains exact selected-day and hour context")
        expect(hourly.resolvedPlace(in: context) == away,
            "A route resolves only against the verified native context")
        expect(NativeAppRoute.today().resolvedPlace(in: context) == home,
            "An unspecified route place uses the verified selected place")

        let today = NativeAppRoute(section: .home, selectedDay: selectedDay, hourlyFocus: focusedHour,
            homePresentation: .today, initialQuery: "should not survive")
        expect(today.homePresentation == .today && today.hourlyFocus == nil && today.initialQuery == nil,
            "Today does not carry stale hourly focus or Ask text")

        let ask = NativeAppRoute.ask(place: awayReference, day: selectedDay,
            initialQuery: "  Will rain after school?  ")
        expect(ask.initialQuery == "Will rain after school?" && ask.selectedDay == selectedDay,
            "Ask keeps a bounded intentional draft and day context")
        let map = NativeAppRoute(section: .map, place: awayReference, selectedDay: selectedDay,
            hourlyFocus: focusedHour, homePresentation: .hourly, initialQuery: "discard")
        expect(map.selectedDay == selectedDay && map.hourlyFocus == nil && map.initialQuery == nil && map.homePresentation == nil,
            "Non-home routes cannot inherit hidden home or Ask state")
        expect(NativeAppRoute.ask(initialQuery: String(repeating: "a", count: 501)).initialQuery?.count == 500,
            "Native Ask drafts are bounded before a view ever handles them")

        let router = NativeAppRouter(initialRoute: .today(place: NativeAppPlaceReference(home)))
        expect(router.current.section == .home && !router.canGoBack && router.revision == 0,
            "Router starts at a native primary route")
        router.push(hourly)
        expect(router.current == hourly && router.canGoBack && router.revision == 1,
            "Contextual hourly routing pushes over the selected primary surface")
        router.push(hourly)
        expect(router.path.count == 1 && router.revision == 1,
            "Repeated taps cannot build duplicate native routes")
        expect(router.pop() == hourly && !router.canGoBack && router.current.section == .home,
            "Back restores the existing native root without a web dependency")
        router.push(ask)
        router.select(.map(place: awayReference, day: selectedDay))
        expect(router.section == .map && router.path.isEmpty && router.current.section == .map,
            "Primary selection clears transient routes and owns the new native surface")
        let revision = router.revision
        router.select(.map(place: awayReference, day: selectedDay))
        expect(router.revision == revision,
            "Selecting the already-settled route does not churn root state")
        router.select(.map(place: awayReference, day: selectedDay), reapply: true)
        expect(router.revision == revision + 1 && router.current == map && router.path.isEmpty,
            "A repeated external link is a fresh navigation intent even after the prior route settled")

        var application = NativeAppRouteApplication()
        expect(application.begin(revision: 0, selectedPlace: home) == .start,
            "Initial navigation is consumed before weather finishes loading")
        application.finish()
        expect(application.begin(revision: 0, selectedPlace: away) == .ignore,
            "A forecast publication cannot replay the old route over a new place selection")
        expect(application.begin(revision: 1, selectedPlace: home) == .start,
            "A new route revision can navigate from the active place")
        application.waitForForecast(at: away)
        expect(application.begin(revision: 1, selectedPlace: away) == .resume,
            "A requested day can continue when its destination forecast becomes available")
        application.finish()
        expect(application.begin(revision: 1, selectedPlace: away) == .ignore,
            "Later refreshes cannot replay a completed day or hour selection")
        expect(application.begin(revision: 2, selectedPlace: away) == .start,
            "The next navigation request starts independently")
        application.waitForForecast(at: away)
        expect(application.begin(revision: 2, selectedPlace: home) == .ignore,
            "A newer user place selection cancels the waiting route")
        expect(application.begin(revision: 2, selectedPlace: away) == .ignore,
            "Returning to a previous place cannot revive its canceled route")
        expect(application.begin(revision: 3, selectedPlace: away) == .start,
            "Canceling an older route does not block a later explicit navigation request")

        print("PASS Native app router: canonical routes, repeated external intent, stack ownership, and forecast publication isolation")
    }
}
