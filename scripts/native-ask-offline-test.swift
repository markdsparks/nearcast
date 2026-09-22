import Foundation

@main
struct NativeAskOfflineTests {
    @MainActor static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1])
        let place = NativePreviewPlace(id: "maryville", name: "Maryville, Illinois", latitude: 38.72, longitude: -89.95,
            timezone: "America/Chicago", countryCode: "US")
        let chicago = NativePreviewPlace(id: "chicago", name: "Chicago, Illinois", latitude: 41.88, longitude: -87.63,
            timezone: "America/Chicago", countryCode: "US")
        let calendar = try NativePlanSchedule.calendar(NativeAgendaPlace(preview: place))
        func date(_ day: String, _ hour: Double) -> Date { NativePlanSchedule.date(day, hour: hour, calendar: calendar)! }
        let now = date("2026-09-20", 10)
        let tomorrowLabel = NativeAskRead.readableDay(date("2026-09-21", 12), calendar: calendar, now: now)
        let tuesdayLabel = NativeAskRead.readableDay(date("2026-09-22", 12), calendar: calendar, now: now)
        let wednesdayLabel = NativeAskRead.readableDay(date("2026-09-23", 12), calendar: calendar, now: now)
        let context = NativePreviewContext(version: 1, selectedPlace: place, savedPlaces: [chicago], metric: false,
            uses24HourClock: false, theme: "auto")
        let hours = ["2026-09-21", "2026-09-22", "2026-09-23"].flatMap { day in [
            NativeForecastPoint(date: date(day, 9), temperature: 68, rainProbability: 10, windSpeed: 5,
                windGusts: 8, weatherCode: 1, isDay: true, origin: .hourlyForecast),
            NativeForecastPoint(date: date(day, 18), temperature: 77, rainProbability: 70, windSpeed: 14,
                windGusts: 21, weatherCode: 61, isDay: true, origin: .hourlyForecast)
        ] }
        let forecast = NativeWeatherForecast(generatedAt: now, timezoneID: "America/Chicago", metric: false,
            current: nil, hours: hours, quarterHours: [], days: [])
        let unavailable: NativeAskConversation.Generator = { _ in ["ok": false, "message": "Unavailable"] }
        var requestedPlaces: [NativePreviewPlace] = []
        let file = directory.appendingPathComponent("offline.json")
        let chat = NativeAskConversation(file: file, generator: unavailable, forecastLoader: { place, _ in
            requestedPlaces.append(place)
            return .init(forecast: forecast, source: .refreshed)
        }, now: { now })

        chat.send("Will it rain tomorrow?", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.text.contains("\(tomorrowLabel): Rain likely around 6:00 PM (70% precipitation chance).") == true)
        assert(chat.messages.last?.text.contains("2026-09-21:") == false, "Quick-read presentation does not expose an ISO-only date heading")
        assert(chat.messages.last?.usedQuickRead == true && chat.messages.last?.forecastSource == .refreshed)
        chat.send("What about Tuesday?", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.text.contains("\(tuesdayLabel): Rain likely") == true, "A no-model follow-up keeps its weather topic")
        chat.send("And Wednesday?", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.text.contains("\(wednesdayLabel): Rain likely") == true, "Topic survives more than one follow-up")

        chat.send("What is the temperature tomorrow at 9 AM?", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.text.contains("68°F to 68°F") == true)
        assert(chat.messages.last?.text.contains("77°F") == false, "An explicit hour cannot use daily temperatures")
        chat.send("Compare tomorrow and the next day for a walk.", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.text.contains("\(tomorrowLabel):") == true && chat.messages.last?.text.contains("\(tuesdayLabel):") == true)
        assert(chat.messages.last?.text.contains("9:00 AM") == true)
        assert(chat.messages.last?.text.contains("not overall safety") == true)

        chat.send("Create a walk tomorrow from 5 to 6 PM", context: context, day: now)
        await settle(chat)
        // A request that omitted the word plan still must not silently become
        // a forecast if its time range is ambiguous.
        assert(chat.messages.last?.plan == nil)
        chat.send("Help me plan a walk tomorrow from 5 to 6 PM", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.showsPlanComposer == true && chat.messages.last?.plan == nil)

        chat.send("Switch to Chicago tomorrow at 6 PM", context: context, day: now)
        await settle(chat)
        guard let navigation = chat.messages.last?.navigation else { fatalError("Missing reviewed navigation") }
        assert(navigation.destination == .switchPlace && navigation.target.place == chicago)
        assert(navigation.requiresConfirmation && navigation.isValid)
        assert(chat.activePlaceName == place.name, "An unconfirmed switch cannot change conversation context")
        assert(NativeAskConversation(file: file).activePlaceName == place.name, "Restoring an unconfirmed switch does not accept it")
        chat.navigationAccepted(navigation)
        assert(chat.activePlaceName == chicago.name)
        chat.send("Open Map", context: context, day: now)
        await settle(chat)
        let map = chat.messages.last!.navigation!
        assert(map.destination == .map && map.target == navigation.target, "Map preserves exact accepted place/day/hour")
        chat.send("Show radar next Tuesday", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.navigation == nil, "Recent radar must not masquerade as a future weather map")
        assert(chat.messages.last?.text.contains("latest available radar frames") == true)
        assert(chat.messages.last?.target != nil, "An unsupported radar time still offers that date in native hourly")
        let clarifiedTarget = chat.messages.last!.target!
        chat.send("Open Settings", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.navigation?.destination == .settings)
        assert(chat.messages.last?.navigation?.target == clarifiedTarget)
        chat.send("Open Places", context: context, day: now)
        await settle(chat)
        assert(chat.messages.last?.navigation?.destination == .places)
        assert(NativeAskConversation(file: file).activePlaceName == chicago.name)

        let saved = NativeAskConversation(file: directory.appendingPathComponent("saved.json"), generator: unavailable,
            forecastLoader: { _, _ in .init(forecast: forecast, source: .savedAfterRefreshFailure) }, now: { now })
        saved.send("Will it rain tomorrow?", context: context, day: now)
        await settle(saved)
        assert(saved.messages.last?.text.contains("saved forecast from") == true)
        assert(saved.messages.last?.forecastSource == .savedAfterRefreshFailure)
        saved.send("Weather on 2026-10-20", context: context, day: now)
        await settle(saved)
        assert(saved.messages.last?.text.contains("doesn’t cover that time") == true, "Out-of-range dates never extrapolate")

        let finalFailure = NativeAskConversation(file: directory.appendingPathComponent("answer-failure.json"), generator: { options in
            let schema = options["schema"] as? [String: Any]
            let properties = schema?["properties"] as? [String: Any]
            if properties?["answer"] != nil { return ["ok": false] }
            return ["ok": true, "text": #"{"action":"forecast","placeIndex":0,"placeQuery":"","dates":["2026-09-21"],"startHour":-1,"endHour":-1,"title":"","weekdays":[],"clarification":""}"#]
        }, forecastLoader: { _, _ in .init(forecast: forecast, source: .refreshed) }, now: { now })
        finalFailure.send("Will it rain tomorrow?", context: context, day: now)
        await settle(finalFailure)
        assert(finalFailure.messages.last?.usedQuickRead == true && finalFailure.messages.last?.text.contains("70% precipitation chance") == true,
               "A model that becomes unavailable after routing still returns an evidence-based quick answer")

        var lookups = 0
        let lookup = NativeAskConversation(file: directory.appendingPathComponent("lookup.json"), generator: unavailable,
            forecastLoader: { _, _ in fatalError("Navigation must not fetch weather or mutate saved places") },
            placeLookup: { query in lookups += 1; assert(query == "madison, wisconsin"); return [
                .init(id: "madison", name: "Madison, Wisconsin", latitude: 43.07, longitude: -89.4, timezone: "America/Chicago", countryCode: "US")
            ] }, now: { now })
        lookup.send("Switch to Madison, Wisconsin tomorrow at 6 PM", context: context, day: now)
        await settle(lookup)
        assert(lookups == 1 && lookup.messages.last?.navigation?.target.place.name == "Madison, Wisconsin")

        let tokyo = NativePreviewPlace(id: "tokyo", name: "Tokyo, Japan", latitude: 35.68, longitude: 139.69,
            timezone: "Asia/Tokyo", countryCode: "JP")
        let distant = NativeAskConversation(file: directory.appendingPathComponent("timezone.json"), generator: unavailable,
            placeLookup: { _ in [tokyo] }, now: { now })
        distant.send("Switch to Tokyo, Japan tomorrow at 6 PM", context: context, day: now)
        await settle(distant)
        let tokyoCalendar = try NativePlanSchedule.calendar(NativeAgendaPlace(preview: tokyo))
        assert(NativePlanSchedule.civil(distant.messages.last!.navigation!.target.day, calendar: tokyoCalendar) == "2026-09-22",
               "Looked-up tomorrow is resolved in the destination's time zone, not the old place's day")
        assert(!NativeAskForecastTarget(place: place, day: now, hour: date("2026-09-23", 17)).isValid,
               "Persisted navigation cannot carry an hour on a different local day")

        let ambiguous = NativeAskConversation(file: directory.appendingPathComponent("ambiguous.json"), generator: unavailable,
            placeLookup: { _ in [place, chicago] }, now: { now })
        ambiguous.send("Switch to Springfield", context: context, day: now)
        await settle(ambiguous)
        assert(ambiguous.messages.last?.navigation == nil && ambiguous.messages.last?.text.hasPrefix("Which place") == true)

        let malicious = NativeAskConversation(file: directory.appendingPathComponent("invalid-navigation.json"), generator: { _ in
            ["ok": true, "text": #"{"action":"switchPlace","placeIndex":1,"placeQuery":"","dates":["2026-09-21"],"startHour":-1,"endHour":-1,"title":"","weekdays":[],"clarification":""}"#]
        }, now: { now })
        malicious.send("Will it rain tomorrow?", context: context, day: now)
        await settle(malicious)
        assert(malicious.messages.last?.navigation == nil, "A model cannot invent navigation authorization")
        malicious.send("Switch to Maryville", context: context, day: now)
        await settle(malicious)
        assert(malicious.messages.last?.navigation == nil, "A model cannot switch to a different supplied place than requested")

        let pending = NativeAskConversation(file: directory.appendingPathComponent("cancel.json"), generator: { _ in
            try? await Task.sleep(for: .milliseconds(80)); return ["ok": false]
        }, forecastLoader: { _, _ in fatalError("Cancelled requests must never reach the fallback fetch") }, now: { now })
        pending.send("Will it rain tomorrow?", context: context, day: now)
        pending.cancel()
        try? await Task.sleep(for: .milliseconds(120))
        assert(pending.messages.last?.text.hasPrefix("Stopped") == true && !pending.isWorking)

        let firstNavigation = NativeAskConversation(file: directory.appendingPathComponent("initial-hour.json"), generator: unavailable, now: { now })
        firstNavigation.send("Open Map", context: context, day: date("2026-09-22", 12), hour: date("2026-09-22", 17))
        await settle(firstNavigation)
        assert(firstNavigation.messages.last?.navigation?.target.hour == date("2026-09-22", 17), "Initial screen hour survives navigation")
        assert(!requestedPlaces.isEmpty)
        print("PASS Native Ask without AI: forecast/date/time reads, comparisons, persisted topic/context, review-only plans, safe navigation/lookup, saved provenance, cancellation")
    }

    @MainActor static func settle(_ chat: NativeAskConversation) async {
        for _ in 0..<1000 {
            if !chat.isWorking { return }
            try? await Task.sleep(for: .milliseconds(5))
        }
        fatalError("Ask did not settle")
    }
}
