import Foundation

@main
struct NativeWeatherOutlookTests {
    static func at(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) { precondition(condition(), message) }

    static func point(_ date: Date, temperature: Double? = nil, code: Int? = 0,
                      chance: Double? = 0, amount: Double? = 0, gust: Double? = nil,
                      possibleThunder: Bool = false, rawCode: Int? = nil) -> NativeForecastPoint {
        NativeForecastPoint(date: date, temperature: temperature, rainProbability: chance, precipitationMM: amount,
            windGusts: gust, weatherCode: code, isDay: true, thunderPossible: possibleThunder, rawWeatherCode: rawCode)
    }

    static func forecast(_ hours: [NativeForecastPoint], now: Date, zone: String = "America/Chicago",
                         metric: Bool = false, current: NativeForecastPoint? = nil,
                         days: [NativeForecastDay] = []) -> NativeWeatherForecast {
        NativeWeatherForecast(generatedAt: now, timezoneID: zone, metric: metric, current: current,
            hours: hours, quarterHours: [], days: days)
    }

    static func read(_ forecast: NativeWeatherForecast, day: Date? = nil, now: Date, clock24: Bool = true) -> NativeWeatherOutlook {
        NativeWeatherOutlook.make(forecast: forecast, day: day ?? now, now: now, uses24HourClock: clock24)
    }

    static func main() {
        let morning = at("2026-09-18T14:00:00Z") // 09:00 in the forecast place.
        let warming = [65.0, 67, 70, 74, 78].enumerated().map {
            point(morning.addingTimeInterval(Double($0.offset) * 3600), temperature: $0.element)
        }
        let sunny = read(forecast(warming, now: morning), now: morning)
        expect(sunny.eyebrow == "THIS MORNING", "Morning is chosen in the forecast place's timezone")
        expect(sunny.headline == "Clear and warming", "Calm weather leads with a useful trend")
        expect(sunny.detail == "Warming to 78°F around 13:00", "Trend has a grounded target temperature and local time")
        let twelve = read(forecast(warming, now: morning), now: morning, clock24: false)
        expect(twelve.detail == "Warming to 78°F around 1 PM", "12-hour clock preference is respected")

        let stable = (0..<5).map { point(morning.addingTimeInterval(Double($0) * 3600), temperature: 70) }
        let quiet = read(forecast(stable, now: morning), now: morning)
        expect(quiet.headline == "Clear this morning" && quiet.detail == nil, "Quiet weather does not produce decorative filler")
        let quietText = "\(quiet.headline) \(quiet.detail ?? "")".lowercased()
        expect(!quietText.contains("0%") && !quietText.contains("dry") && !quietText.contains("up to"), "Zero chance is not a dry guarantee or filler")

        let afternoon = at("2026-09-18T19:00:00Z")
        let gusts = (0..<4).map { point(afternoon.addingTimeInterval(Double($0) * 3600), temperature: 75,
            gust: $0 == 2 ? 34 : 15) }
        let windy = read(forecast(gusts, now: afternoon), now: afternoon)
        expect(windy.eyebrow == "THIS AFTERNOON", "Afternoon framing is local")
        expect(windy.headline == "Gusty winds around 16:00" && windy.detail == "Gusts near 34 mph", "Meaningful gusts replace calm filler")
        let lowMetricGusts = gusts.map { point($0.date, temperature: 22, gust: 34) }
        let metricWind = read(forecast(lowMetricGusts, now: afternoon, metric: true), now: afternoon)
        expect(!metricWind.headline.contains("Gusty"), "34 km/h is not interpreted as 34 mph")

        let night = at("2026-09-19T03:00:00Z") // 22:00 Friday.
        let cooling = [72.0, 69, 67, 65, 63, 61, 60].enumerated().map {
            point(night.addingTimeInterval(Double($0.offset) * 3600), temperature: $0.element)
        }
        let overnight = read(forecast(cooling, now: night), now: night)
        expect(overnight.eyebrow == "TONIGHT’S OUTLOOK", "Late-night outlook includes the actual overnight hours")
        expect(overnight.headline == "Clear and cooling", "Night cooling is a relevant trend")
        expect(overnight.detail == "Cooling to 60°F around 04:00 tomorrow", "After-midnight timing is explicit, not assigned to the wrong day")
        let veryLate = at("2026-09-19T06:00:00Z") // 01:00 Saturday.
        let remainingNight = read(forecast(cooling, now: veryLate), now: veryLate)
        expect(remainingNight.eyebrow == "TONIGHT’S OUTLOOK", "Early hours use tonight rather than yesterday's date")
        expect(remainingNight.detail?.contains("tomorrow") != true, "After midnight today's early morning is not tomorrow")

        let futureMorning = at("2026-09-19T13:00:00Z")
        let futureRain = [
            point(futureMorning, temperature: 66, code: 2, chance: 10),
            point(futureMorning.addingTimeInterval(3600), temperature: 68, code: 3, chance: 20),
            point(futureMorning.addingTimeInterval(7200), temperature: 69, code: 61, chance: 70, amount: 1),
            point(futureMorning.addingTimeInterval(10800), temperature: 69, code: 61, chance: 65, amount: 0.8),
            point(futureMorning.addingTimeInterval(14400), temperature: 68, code: 3, chance: 10)
        ]
        let rainy = read(forecast(futureRain, now: morning), day: futureMorning, now: morning)
        expect(rainy.eyebrow == "SAT, SEP 19 · OUTLOOK", "Selected-day eyebrow names its own civil date")
        expect(rainy.headline == "Rain likely around 10:00", "Selected day describes its actual weather window")
        expect(rainy.detail == "Precipitation chances ease around 12:00", "A supported easing time is more useful than repeating the day's high")

        let thunderHours = [
            point(morning, temperature: 70, code: 3, chance: 10),
            point(morning.addingTimeInterval(3600), temperature: 71, code: 3, chance: 20, possibleThunder: true, rawCode: 95),
            point(morning.addingTimeInterval(7200), temperature: 72, code: 3, chance: 20)
        ]
        let possible = read(forecast(thunderHours, now: morning), now: morning)
        expect(possible.headline == "Thunderstorms possible around 10:00", "Qualified thunder is preserved without becoming likely or observed")
        let rawOnly = thunderHours.map { point($0.date, temperature: 70, code: 3, chance: 10, rawCode: 95) }
        let suppressedRaw = read(forecast(rawOnly, now: morning), now: morning)
        expect(!suppressedRaw.headline.lowercased().contains("storm"), "Raw weather code cannot override resolved weather semantics")
        let likely = read(forecast([point(morning, temperature: 70, code: 95, chance: 80, amount: 2)], now: morning), now: morning)
        expect(likely.headline == "Thunderstorms likely this hour", "Resolved storm guidance stays forecast likelihood, not observed lightning")
        let lowerChance = read(forecast([point(morning, code: 95, chance: 35, amount: 1)], now: morning), now: morning)
        expect(lowerChance.headline == "Thunderstorms possible this hour", "A storm-type interval at 35 percent cannot be promoted to likely")
        let unknownChance = read(forecast([point(morning, code: 95, chance: nil, amount: nil)], now: morning), now: morning)
        expect(unknownChance.headline == "Thunderstorms possible this hour", "Missing storm probability cannot establish likely wording")

        let cloudyLater = [0, 0, 3, 3].enumerated().map { point(morning.addingTimeInterval(Double($0.offset) * 3600), temperature: 70, code: $0.element) }
        let clouds = read(forecast(cloudyLater, now: morning), now: morning)
        expect(clouds.headline == "Clouds increase around 11:00", "A sustained condition transition gets useful timing")
        let briefCloud = [0, 0, 3, 0].enumerated().map { point(morning.addingTimeInterval(Double($0.offset) * 3600), temperature: 70, code: $0.element) }
        expect(!read(forecast(briefCloud, now: morning), now: morning).headline.contains("increase"), "A single noisy hour does not become a transition headline")
        let cloudGap = [point(morning, temperature: 70), point(morning.addingTimeInterval(4 * 3600), temperature: 70, code: 3),
            point(morning.addingTimeInterval(5 * 3600), temperature: 70, code: 3)]
        let gappedCloudRead = read(forecast(cloudGap, now: morning), now: morning)
        expect(gappedCloudRead.headline == "Clear", "Missing coverage cannot establish cloud-transition timing or move afternoon clouds into the morning")

        let missing = [point(morning, code: nil, chance: nil, amount: nil)]
        let unknown = read(forecast(missing, now: morning), now: morning)
        expect(unknown.headline == "Outlook unavailable", "Missing readings are not described as clear or dry")
        expect(unknown.detail?.contains("0%") != true, "Missing probabilities do not become zero")
        let onlyChance = [point(morning, code: nil, chance: 40, amount: nil)]
        expect(read(forecast(onlyChance, now: morning), now: morning).headline == "Precipitation possible this hour",
            "Unknown precipitation type is not automatically called rain")
        let gapAfterRain = [futureRain[2], futureRain[4]]
        let gapRead = read(forecast(gapAfterRain, now: morning), day: futureMorning, now: morning)
        expect(gapRead.detail == nil, "Missing intervening hours cannot establish an easing time")

        let metricSmallTrend = [20.0, 21, 22].enumerated().map { point(morning.addingTimeInterval(Double($0.offset) * 3600), temperature: $0.element) }
        expect(read(forecast(metricSmallTrend, now: morning, metric: true), now: morning).detail == nil, "Two Celsius degrees do not trigger the meaningful trend threshold")
        let metricTrend = [20.0, 21, 23].enumerated().map { point(morning.addingTimeInterval(Double($0.offset) * 3600), temperature: $0.element) }
        expect(read(forecast(metricTrend, now: morning, metric: true), now: morning).detail == "Warming to 23°C around 11:00", "Metric trend threshold and displayed units remain coherent")

        let warsawNow = at("2026-09-18T23:00:00Z")
        let warsawHours = [17.0, 15, 13].enumerated().map { point(warsawNow.addingTimeInterval(Double($0.offset) * 3600), temperature: $0.element) }
        let remote = read(forecast(warsawHours, now: warsawNow, zone: "Europe/Warsaw", metric: true), now: warsawNow)
        expect(remote.eyebrow == "TONIGHT’S OUTLOOK" && remote.detail == "Cooling to 13°C around 03:00", "Narrative and clock follow the destination across the phone's midnight")
        let spring = at("2026-03-08T07:00:00Z") // 01:00 before the skip.
        let springHours = [point(spring, temperature: 40), point(spring.addingTimeInterval(7200), temperature: 33)]
        let springRead = read(forecast(springHours, now: spring), now: spring)
        expect(springRead.detail == "Cooling to 33°F around 04:00", "DST elapsed time does not invent the skipped hour")
        let fall = at("2026-11-01T06:00:00Z") // First 01:00.
        let fallHours = [point(fall, temperature: 40), point(fall.addingTimeInterval(7200), temperature: 33)]
        let fallRead = read(forecast(fallHours, now: fall), now: fall)
        expect(fallRead.detail == "Cooling to 33°F around 02:00", "Fall-back uses the real local clock, not elapsed-hour arithmetic")

        let dailyOnly = NativeForecastDay(date: futureMorning, high: 80, low: 60, weatherCode: 3, thunderPossible: true)
        let dailyRead = read(forecast([], now: morning, days: [dailyOnly]), day: futureMorning, now: morning)
        expect(dailyRead.headline == "Thunderstorms possible" && dailyRead.detail == nil, "Daily fallback retains qualification without inventing hourly timing or repeating high/low")
        print("PASS Native outlook: local dayparts, actual timed weather, qualified thunder, no raw-code promotion, temperature/wind units, useful daily narrative, missing/zero data, overnight and DST clocks")
    }
}
