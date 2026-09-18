import Foundation

@main
struct NativeWeatherDetailTests {
    static func at(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) { precondition(condition(), message) }
    static func forecast(now: Date, metric: Bool = false, zone: String = "America/Chicago",
                         current: NativeForecastPoint? = nil, hours: [NativeForecastPoint] = [], days: [NativeForecastDay] = []) -> NativeWeatherForecast {
        NativeWeatherForecast(generatedAt: now, timezoneID: zone, metric: metric, current: current,
            hours: hours, quarterHours: [], days: days)
    }
    static func presentation(_ forecast: NativeWeatherForecast, day: Date, now: Date, clock24: Bool = true) -> NativeWeatherDetailPresentation {
        NativeWeatherDetailPresentation(forecast: forecast, day: day, now: now, uses24HourClock: clock24)
    }
    static func fact(_ p: NativeWeatherDetailPresentation, _ kind: NativeWeatherDetailKind, _ label: String) -> String? {
        p.facts(kind).first { $0.label == label }?.value
    }

    static func main() {
        let now = at("2026-09-18T15:30:00Z") // Friday, 10:30 in Chicago.
        let today = at("2026-09-18T05:00:00Z")
        let tomorrow = at("2026-09-19T05:00:00Z")
        let current = NativeForecastPoint(date: now.addingTimeInterval(-300), temperature: 78, windSpeed: 7, windGusts: 10,
            uvIndex: 3, relativeHumidity: 55, dewPoint: 60, visibilityMeters: 16093.44, windDirection: 270)
        let hours = [
            NativeForecastPoint(date: at("2026-09-18T14:00:00Z"), rainProbability: 95, windSpeed: 20, windGusts: 45, uvIndex: 2, relativeHumidity: 80, dewPoint: 55, visibilityMeters: 100, windDirection: 0),
            NativeForecastPoint(date: at("2026-09-18T15:00:00Z"), rainProbability: 20, windSpeed: 8, windGusts: 12, uvIndex: 3, relativeHumidity: 57, dewPoint: 61, visibilityMeters: 15000, windDirection: 280),
            NativeForecastPoint(date: at("2026-09-18T16:00:00Z"), rainProbability: 40, windSpeed: 9, windGusts: 20, uvIndex: 6, relativeHumidity: 50, dewPoint: 62, visibilityMeters: 9000, windDirection: 300),
            NativeForecastPoint(date: at("2026-09-19T11:00:00Z"), rainProbability: 10, windSpeed: 12, windGusts: 18, uvIndex: 1, relativeHumidity: 60, dewPoint: 52, visibilityMeters: 12000, windDirection: 90),
            NativeForecastPoint(date: at("2026-09-19T17:00:00Z"), rainProbability: 65, windSpeed: 18, windGusts: 28, uvIndex: 5, relativeHumidity: 45, dewPoint: 57, visibilityMeters: 4000, windDirection: 180)
        ]
        let daily = [NativeForecastDay(date: today, high: 81, low: 57, rainProbability: 60, precipitationMM: 2.54, uvIndex: 7),
                     NativeForecastDay(date: tomorrow, high: 80, low: 56, rainProbability: 70, precipitationMM: 25.4, uvIndex: 6)]
        let source = forecast(now: now, current: current, hours: hours, days: daily)
        let p = presentation(source, day: now, now: now)
        expect(p.isToday && p.dayLabel == "Today", "Today follows place calendar")
        expect(p.headline(.wind) == "7 mph", "Fresh current wind is used for Today")
        expect(p.headline(.humidity) == "55%", "Today humidity is current, not all-day peak")
        expect(p.headline(.visibility) == "10 mi", "Visibility converts canonical meters to miles")
        expect(p.headline(.precipitation) == "60%", "Precipitation headline uses the daily chance, not a current-hour percentage")
        expect(p.headlineLabel(.precipitation) == "Today · forecast chance", "Daily precipitation meaning is explicit")
        expect(fact(p, .wind, "Strongest gusts ahead") == "20 mph · 11:00", "Past gust maxima are excluded from ahead wording")
        expect(fact(p, .visibility, "Lowest ahead today") == "5.6 mi · 11:00", "Past poor visibility is not described as ahead")
        expect(fact(p, .precipitation, "Highest hourly chance ahead") == "40% · 11:00", "Past rain peak is not described as ahead")
        expect(fact(p, .uv, "Daily forecast maximum") == "7.0", "Daily UV maximum remains distinct from current")
        expect(fact(p, .wind, "Wind from") == "W · 270°", "Wind names where it comes from")
        expect(fact(p, .precipitation, "Daily total forecast") == "0.10 in", "Canonical mm converts to inches")

        let future = presentation(source, day: tomorrow, now: now)
        expect(!future.isToday && future.current(\.windSpeed) == nil, "Future day never borrows current readings")
        expect(future.headline(.wind) == "18 mph", "Future wind is selected-day peak")
        expect(future.headline(.uv) == "6.0", "Future UV headline uses selected day's maximum")
        expect(future.headline(.humidity) == "45–60%", "Future humidity is a range of actual hourly values")
        expect(future.headline(.visibility) == "2.5 mi", "Future visibility uses selected-day minimum")
        expect(future.headline(.precipitation) == "70%", "Future chance uses selected day's forecast")
        expect(future.headlineLabel(.humidity) == "Sat, Sep 19 · hourly range", "Future range has its own day label")
        expect(fact(future, .humidity, "Dew point range") == "52°F – 57°F", "Future dew point range cannot use current dew point")
        expect(fact(future, .wind, "Direction at peak wind") == "S · 180°", "Future wind direction belongs to selected-day peak")

        let stale = NativeForecastPoint(date: now.addingTimeInterval(-2 * 3600), windSpeed: 99, relativeHumidity: 99)
        let staleWithHours = presentation(forecast(now: now, current: stale, hours: hours, days: daily), day: today, now: now)
        expect(staleWithHours.headline(.wind) == "8 mph", "Expired current data yields to actual containing forecast hour")
        let recentlyStale = NativeForecastPoint(date: now.addingTimeInterval(-31 * 60), windSpeed: 99)
        let thirtyMinuteBoundary = NativeForecastPoint(date: now.addingTimeInterval(-30 * 60), windSpeed: 11)
        let recentStaleP = presentation(forecast(now: now, current: recentlyStale, hours: hours), day: today, now: now)
        expect(recentStaleP.headline(.wind) == "8 mph", "Over-30-minute current data yields to current-hour forecast consistently with the main hero")
        let boundaryP = presentation(forecast(now: now, current: thirtyMinuteBoundary, hours: hours), day: today, now: now)
        expect(boundaryP.headline(.wind) == "11 mph", "Exactly 30-minute current data remains within freshness limit")
        let recentStaleNoHours = presentation(forecast(now: now, current: recentlyStale), day: today, now: now)
        expect(recentStaleNoHours.headline(.wind) == "Unavailable", "31-minute current data is not labeled current with no hourly fallback")
        let staleWithoutHours = presentation(forecast(now: now, current: stale), day: today, now: now)
        expect(staleWithoutHours.headline(.wind) == "Unavailable", "Expired current data with no hourly evidence stays unavailable")
        let futureCurrent = NativeForecastPoint(date: now.addingTimeInterval(600), windSpeed: 99)
        let futureCurrentP = presentation(forecast(now: now, current: futureCurrent, hours: hours), day: today, now: now)
        expect(futureCurrentP.headline(.wind) == "8 mph", "Future-dated current readings are not displayed as now")
        let afterCoverage = presentation(source, day: today, now: at("2026-09-19T04:00:00Z"))
        expect(afterCoverage.headline(.wind) == "Unavailable", "Earlier hours do not extend indefinitely to now")
        expect(fact(afterCoverage, .wind, "Strongest gusts ahead") == "Unavailable", "No remaining hours does not borrow tomorrow")

        let missing = presentation(forecast(now: now), day: tomorrow, now: now)
        for kind in [NativeWeatherDetailKind.wind, .uv, .humidity, .visibility, .precipitation] {
            expect(missing.headline(kind) == "Unavailable", "Missing \(kind) is not zero")
        }
        let zeros = NativeForecastPoint(date: now, windSpeed: 0, windGusts: 0, uvIndex: 0, relativeHumidity: 0, dewPoint: 0, visibilityMeters: 0, windDirection: 0)
        let zerosP = presentation(forecast(now: now, current: zeros), day: today, now: now)
        expect(zerosP.headline(.wind) == "0 mph" && zerosP.headline(.uv) == "0.0" && zerosP.headline(.humidity) == "0%", "Actual zero values remain legitimate data")
        expect(zerosP.formatted(nil, kind: .visibility) == "Unavailable", "Missing distance remains unknown")
        expect(zerosP.formatted(40, kind: .visibility) == "<0.1 mi", "Small nonzero distance must not round to zero")
        expect(zerosP.formatted(.infinity, kind: .wind) == "Unavailable", "Nonfinite displayed metric is rejected")

        let metric = presentation(forecast(now: now, metric: true, current: current, hours: hours, days: daily), day: now, now: now)
        expect(metric.headline(.wind) == "7 km/h", "Wind uses requested forecast system without a second conversion")
        expect(metric.headline(.visibility) == "16 km", "Metric visibility converts canonical meters")
        expect(metric.amount(25.4) == "25.4 mm" && metric.temperature(12) == "12°C", "Metric amount and temperature units are explicit")
        expect(future.clock(at("2026-09-19T17:00:00Z")) == "12:00", "Selected place local 24-hour time")
        expect(presentation(source, day: tomorrow, now: now, clock24: false).clock(at("2026-09-19T17:00:00Z")) == "12:00 PM", "Clock setting affects detail timing")

        let same = NativeForecastPoint(date: tomorrow.addingTimeInterval(3600), relativeHumidity: 60)
        let same2 = NativeForecastPoint(date: tomorrow.addingTimeInterval(7200), relativeHumidity: 60)
        let flat = presentation(forecast(now: now, hours: [same, same2]), day: tomorrow, now: now)
        expect(flat.headline(.humidity) == "60%", "Identical humidity bounds do not create a redundant range")
        let dayInBerlin = at("2026-09-18T22:10:00Z")
        let berlin = presentation(forecast(now: dayInBerlin, zone: "Europe/Berlin", current: current, hours: hours), day: dayInBerlin, now: dayInBerlin)
        expect(berlin.isToday && berlin.clock(dayInBerlin) == "00:10", "Today and clock use selected place across device-midnight differences")
        let chicagoSameTime = presentation(source, day: dayInBerlin, now: dayInBerlin)
        expect(chicagoSameTime.clock(dayInBerlin) == "17:10", "Clock remains correct in source timezone")
        expect(p.timestamp(tomorrow).contains("Sep 19") && p.timestamp(tomorrow).contains("00:00 local"), "Cross-day timestamps include local civil date")
        print("PASS Native weather detail: selected-day semantics, fresh/stale/missing values, explicit units, hourly ranges, local dates and clock preferences")
    }
}
