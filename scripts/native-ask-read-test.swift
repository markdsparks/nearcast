import Foundation

@main
struct NativeAskReadTests {
    static func at(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) { precondition(condition(), message) }

    static func point(
        _ date: Date,
        temp: Double? = 70,
        feels: Double? = nil,
        code: Int? = 0,
        chance: Double? = 0,
        gust: Double? = nil,
        wind: Double? = nil,
        thunder: Bool = false
    ) -> NativeForecastPoint {
        .init(
            date: date,
            temperature: temp,
            apparentTemperature: feels,
            rainProbability: chance,
            precipitationMM: chance == nil || chance == 0 ? 0 : 1,
            windSpeed: wind,
            windGusts: gust,
            weatherCode: code,
            isDay: true,
            thunderPossible: thunder,
            origin: .hourlyForecast,
            precipitationIntervalSeconds: 3600
        )
    }

    static func forecast(
        now: Date,
        hours: [NativeForecastPoint],
        current: NativeForecastPoint? = nil,
        days: [NativeForecastDay] = [],
        metric: Bool = false,
        zone: String = "America/Chicago"
    ) -> NativeWeatherForecast {
        .init(generatedAt: now.addingTimeInterval(-8 * 60), timezoneID: zone, metric: metric,
              current: current, hours: hours, quarterHours: [], days: days)
    }

    static func ask(
        _ question: String,
        forecast: NativeWeatherForecast,
        selectedDay: Date,
        now: Date,
        clock24: Bool = false,
        source: NativeAskForecastSource = .refreshed
    ) -> NativeAskReadResult {
        NativeAskRead.respond(to: .init(question: question, placeName: "Maryville, Illinois",
            forecast: forecast, selectedDay: selectedDay, now: now, uses24HourClock: clock24,
            forecastSource: source))
    }

    static func main() {
        let now = at("2026-09-20T16:00:00Z") // 11 AM in Maryville.
        let day = NativeForecastDay(date: now, high: 92, low: 68, rainProbability: 70, uvIndex: 8,
            weatherCode: 3, sunrise: at("2026-09-20T11:30:00Z"), sunset: at("2026-09-21T00:30:00Z"))
        let current = NativeForecastPoint(date: now, temperature: 80, apparentTemperature: 84,
            rainProbability: 0, precipitationMM: 0, windGusts: 16, weatherCode: 2, isDay: true,
            origin: .modeledCurrent, precipitationIntervalSeconds: 900)
        let hours = [
            point(now, temp: 80, feels: 84, code: 2, chance: 0, gust: 16, wind: 10),
            point(now.addingTimeInterval(3600), temp: 84, code: 3, chance: 20, gust: 22, wind: 14),
            point(now.addingTimeInterval(7200), temp: 87, code: 95, chance: 70, gust: 32, wind: 19),
            point(now.addingTimeInterval(10800), temp: 85, code: 61, chance: 65, gust: 25, wind: 13)
        ]
        let loaded = forecast(now: now, hours: hours, current: current, days: [day])

        let rain = ask("Will it rain later today?", forecast: loaded, selectedDay: now, now: now)
        expect(rain.disposition == .answered, "A bounded precipitation question is answered natively")
        expect(rain.message == "Thunderstorms possible around 1:00 PM (70% precipitation chance).", "A precipitation probability must not become a thunderstorm probability or upgrade possible thunder to likely")
        expect(rain.evidence == ["Using Today in Maryville, Illinois", "Forecast updated 8 min ago"], "Answer provenance is compact and only forecast-scoped")

        let rainBeforeStorm = forecast(now: now, hours: [
            point(now.addingTimeInterval(3600), code: 61, chance: 65),
            point(now.addingTimeInterval(7200), code: 95, chance: 80)
        ], days: [day])
        let firstSignal = ask("Will it rain?", forecast: rainBeforeStorm, selectedDay: now, now: now)
        expect(firstSignal.message == "Rain likely around 12:00 PM (65% precipitation chance).", "A later storm cannot eclipse an earlier rain signal")

        let possibleThunder = forecast(now: now, hours: [point(now.addingTimeInterval(3600), code: 3, chance: 47, thunder: true)])
        let thunderRead = ask("Will it rain?", forecast: possibleThunder, selectedDay: now, now: now)
        expect(thunderRead.message == "Thunderstorms possible around 12:00 PM (47% precipitation chance).",
               "The simulator's 47% possible-thunder case labels the probability as precipitation, not thunder")
        expect(NativeAskRead.readableDay(now.addingTimeInterval(86_400), calendar: loaded.calendar, now: now,
            locale: Locale(identifier: "en_US")) == "Tomorrow (Mon, Sep 21)", "Quick reads use a readable, anchored day in the place calendar")

        let temperature = ask("How hot will it get today?", forecast: loaded, selectedDay: now, now: now)
        expect(temperature.disposition == .answered && temperature.message.contains("68°F to 92°F"), "Daily high/low answer uses the requested unit")
        expect(temperature.message.contains("current forecast read is 80°F"), "Current is presented as a forecast read, not an observation")

        let wind = ask("How windy will it be?", forecast: loaded, selectedDay: now, now: now)
        expect(wind.disposition == .answered && wind.message.contains("32 mph around 1:00 PM"), "Wind answer uses strongest loaded gust and local clock")

        let uv = ask("What is the UV?", forecast: loaded, selectedDay: now, now: now)
        expect(uv.disposition == .answered && uv.message.contains("UV 8 (very high)"), "UV response is a daily peak rather than a fabricated hourly value")

        let sun = ask("When is sunset?", forecast: loaded, selectedDay: now, now: now)
        expect(sun.disposition == .answered && sun.message == "Sunrise is 6:30 AM and sunset is 7:30 PM. Daylight lasts 13h 0m.", "Sun answer uses place-local sunrise and sunset")

        let outlook = ask("What changes later today?", forecast: loaded, selectedDay: now, now: now)
        expect(outlook.disposition == .answered && outlook.message.hasPrefix("Thunderstorms likely around 1 PM"), "Outlook reuses the deterministic native weather narrative")

        let conditions = ask("What's it like outside now?", forecast: loaded, selectedDay: now, now: now)
        expect(conditions.disposition == .answered && conditions.message == "The current forecast read is Partly cloudy, 80°F, feels 84°F.", "Current-condition wording stays transparent about forecast provenance")

        let savedConditions = ask("What's it like outside now?", forecast: loaded, selectedDay: now, now: now,
                                  source: .savedAfterRefreshFailure)
        expect(savedConditions.message.hasPrefix("The nearest loaded hourly forecast"),
               "A saved fallback cannot be described as a current forecast read")
        expect(savedConditions.evidence == ["Using Today in Maryville, Illinois", "Saved forecast · live refresh unavailable", "Forecast last updated 8 min ago"],
               "Saved fallback reads visibly retain source and freshness evidence")

        let quietHours = [point(now, code: 2, chance: 5), point(now.addingTimeInterval(3600), code: 3, chance: 12)]
        let quiet = ask("Will it rain?", forecast: forecast(now: now, hours: quietHours, days: [day]), selectedDay: now, now: now)
        expect(quiet.disposition == .answered && quiet.message.contains("No precipitation signal") && quiet.message.contains("not a guarantee"), "No-event answer is explicitly not a guarantee")

        let unknownPrecip = ask("Will it rain?", forecast: forecast(now: now, hours: [point(now, temp: nil, code: nil, chance: nil)], days: [day]), selectedDay: now, now: now)
        expect(unknownPrecip.disposition == .unavailable, "Missing precipitation inputs never become a dry answer")

        let plan = ask("Make a plan for soccer practice", forecast: loaded, selectedDay: now, now: now)
        expect(plan.disposition == .handoff && plan.requiresCompatibility, "Plan creation never enters the native read-only path")
        let route = ask("Open the map", forecast: loaded, selectedDay: now, now: now)
        expect(route.disposition == .handoff, "Navigation never enters the native read-only path")
        let showRoute = ask("Show me the hourly forecast", forecast: loaded, selectedDay: now, now: now)
        expect(showRoute.disposition == .handoff, "A routing word at the start of a question is still a handoff")
        let notification = ask("Alert me if it rains", forecast: loaded, selectedDay: now, now: now)
        expect(notification.disposition == .handoff, "Notification language cannot enable a native side effect")
        let settings = ask("Change my settings", forecast: loaded, selectedDay: now, now: now)
        expect(settings.disposition == .handoff, "Settings changes remain outside the native read-only path")
        let anotherPlace = ask("Switch to San Diego, California", forecast: loaded, selectedDay: now, now: now)
        expect(anotherPlace.disposition == .handoff, "Place switching remains outside the native read-only path")
        let unknown = ask("Is it a good day for a picnic?", forecast: loaded, selectedDay: now, now: now)
        expect(unknown.disposition == .handoff, "Open-ended plan reasoning remains with the established assistant")
        let tomorrow = ask("Will it rain tomorrow?", forecast: loaded, selectedDay: now, now: now)
        expect(tomorrow.disposition == .handoff, "The native read does not guess a new day from language")
        let exactTime = ask("Will it rain at 2 PM?", forecast: loaded, selectedDay: now, now: now)
        expect(exactTime.disposition == .handoff, "The native read does not guess a time window from language")
        let exactDate = ask("Will it rain September 22?", forecast: loaded, selectedDay: now, now: now)
        expect(exactDate.disposition == .handoff, "The native read does not guess an exact date from language")
        let ordinaryMay = ask("May rain affect us?", forecast: loaded, selectedDay: now, now: now)
        expect(ordinaryMay.disposition == .answered, "The month parser does not mistake ordinary language for a calendar date")

        let selectedTomorrow = now.addingTimeInterval(24 * 3600)
        let selectedDayForecast = forecast(now: now, hours: [point(selectedTomorrow, temp: 70)],
            days: [NativeForecastDay(date: selectedTomorrow, high: 74, low: 60, weatherCode: 0)])
        let mismatchedToday = ask("What is the temperature today?", forecast: selectedDayForecast, selectedDay: selectedTomorrow, now: now)
        expect(mismatchedToday.disposition == .handoff, "Today cannot silently answer from a selected future day")

        let warsawNow = at("2026-09-20T20:00:00Z") // 22:00 in Warsaw.
        let warsawDay = NativeForecastDay(date: warsawNow, high: 18, low: 11, uvIndex: 3, weatherCode: 3,
            sunrise: at("2026-09-20T04:30:00Z"), sunset: at("2026-09-20T17:00:00Z"))
        let warsaw = forecast(now: warsawNow, hours: [point(warsawNow, temp: 16)], days: [warsawDay], metric: true, zone: "Europe/Warsaw")
        let local = ask("When is sunset?", forecast: warsaw, selectedDay: warsawNow, now: warsawNow, clock24: true)
        expect(local.message.contains("19:00") && !local.message.contains("7:00"), "Sun answer respects the selected place and 24-hour preference")

        print("PASS Native Ask read: deterministic bounded weather reads, local time/units, explicit freshness, and no-write handoff for plans/navigation/notifications/unknown scope")
    }
}
