import Foundation

@main
struct NativeSunDaylightTests {
    static func at(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) { precondition(condition(), message) }
    static func forecast(day: Date, zone: String = "America/Chicago", rise: Date? = nil, set: Date? = nil,
                         hours: [NativeForecastPoint] = [], moreDays: [NativeForecastDay] = []) -> NativeWeatherForecast {
        NativeWeatherForecast(generatedAt: day, timezoneID: zone, metric: false, current: nil,
            hours: hours, quarterHours: [], days: [NativeForecastDay(date: day, sunrise: rise, sunset: set)] + moreDays)
    }

    static func main() {
        let midnight = at("2026-09-18T05:00:00Z")
        let rise = at("2026-09-18T11:40:00Z")
        let set = at("2026-09-19T00:00:00Z")
        let nextRise = at("2026-09-19T11:41:00Z")
        let hours = [NativeForecastPoint(date: at("2026-09-18T17:00:00Z"), uvIndex: 5),
                     NativeForecastPoint(date: at("2026-09-18T18:00:00Z"), uvIndex: nil),
                     NativeForecastPoint(date: at("2026-09-18T19:00:00Z"), uvIndex: 0)]
        let model = NativeSunDaylight(forecast: forecast(day: midnight, rise: rise, set: set, hours: hours,
            moreDays: [NativeForecastDay(date: at("2026-09-19T05:00:00Z"), sunrise: nextRise)]), day: midnight)
        expect(model.mode == .normal, "Actual sunrise and sunset enable the curve")
        expect(model.interval.start == midnight && model.interval.duration == 86400, "Civil day is selected place local")
        expect(model.daylightDuration == 12 * 3600 + 20 * 60, "Daylight uses actual events")
        expect(model.nextSunrise == nextRise, "Next sunrise comes from tomorrow, not fabricated recurrence")
        expect(model.height(at: midnight)! < 0 && abs(model.height(at: rise)!) < 0.001, "Night marker remains visible below horizon, rise meets horizon")
        expect(abs(model.height(at: set)!) < 0.001 && model.height(at: set.addingTimeInterval(3600))! < 0, "Sunset returns to horizon, night stays below")
        expect(model.isDaylight(at: rise) == true && model.isDaylight(at: set) == false, "Exact event boundary states")
        let staleNightCurrent = NativeWeatherForecast(generatedAt: midnight, timezoneID: "America/Chicago", metric: false,
            current: NativeForecastPoint(date: midnight, isDay: false), hours: hours, quarterHours: [],
            days: [NativeForecastDay(date: midnight, sunrise: rise, sunset: set)])
        expect(NativeSunDaylight.automaticAppearanceIsDaylight(forecast: staleNightCurrent, now: rise.addingTimeInterval(60)) == true,
               "Solar events override a stale night current reading after sunrise")
        let staleDayCurrent = NativeWeatherForecast(generatedAt: midnight, timezoneID: "America/Chicago", metric: false,
            current: NativeForecastPoint(date: midnight, isDay: true), hours: hours, quarterHours: [],
            days: [NativeForecastDay(date: midnight, sunrise: rise, sunset: set)])
        expect(NativeSunDaylight.automaticAppearanceIsDaylight(forecast: staleDayCurrent, now: set.addingTimeInterval(60)) == false,
               "Solar events override a stale day current reading after sunset")
        expect(model.uv(at: at("2026-09-18T17:59:00Z")) == 5, "UV readout uses the available containing hour")
        expect(model.uv(at: at("2026-09-18T18:30:00Z")) == nil, "Missing UV cannot become zero or inherit prior hour")
        expect(model.uv(at: at("2026-09-18T19:30:00Z")) == 0, "Real zero UV is retained")
        expect(model.uv(at: at("2026-09-18T20:00:00Z")) == nil, "UV never extends beyond last sample")
        expect(model.clock(rise, uses24HourClock: true) == "06:40", "24-hour clock is honored")
        expect(model.clock(rise, uses24HourClock: false) == "6:40 AM", "12-hour clock is honored")
        expect(model.date(at: 1) < model.interval.end && model.date(at: -2) == midnight, "Slider clamps within selected day")
        let now = at("2026-09-18T22:12:00Z")
        expect(model.defaultDate(now: now) == now, "Today opens at actual current time")
        expect(model.clock(model.defaultDate(now: nextRise), uses24HourClock: true) == "12:00", "Other days open at local noon")
        expect(NativeSunDaylight.duration(3601) == "1h 1m", "Remaining light does not understate partial minutes")

        let missing = NativeSunDaylight(forecast: forecast(day: midnight), day: midnight)
        expect(missing.mode == .unavailable && missing.height(at: midnight) == nil, "Missing events do not imply polar night or draw a decorative arc")
        expect(missing.daylightDuration == nil, "Unknown daylight is not zero")
        let freshFallback = NativeWeatherForecast(generatedAt: midnight, timezoneID: "America/Chicago", metric: false,
            current: NativeForecastPoint(date: midnight.addingTimeInterval(60), isDay: true), hours: [], quarterHours: [], days: [])
        expect(NativeSunDaylight.automaticAppearanceIsDaylight(forecast: freshFallback, now: midnight) == true,
               "Fresh current state is a fallback when solar data is absent")
        let expiredFallback = NativeWeatherForecast(generatedAt: midnight, timezoneID: "America/Chicago", metric: false,
            current: NativeForecastPoint(date: midnight, isDay: false), hours: [], quarterHours: [], days: [])
        expect(NativeSunDaylight.automaticAppearanceIsDaylight(forecast: expiredFallback, now: midnight.addingTimeInterval(91 * 60)) == nil,
               "Old current state cannot keep automatic appearance in night mode")
        let partial = NativeSunDaylight(forecast: forecast(day: midnight, rise: rise), day: midnight)
        expect(partial.mode == .unavailable && partial.sunrise == rise, "One known event remains available without inventing the other")
        let bad = NativeSunDaylight(forecast: forecast(day: midnight, rise: set, set: rise), day: midnight)
        expect(bad.mode == .unavailable, "Reversed events are not a valid daylight interval")
        let wrongDay = NativeSunDaylight(forecast: forecast(day: midnight, rise: nextRise, set: set), day: midnight)
        expect(wrongDay.sunrise == nil && wrongDay.mode == .unavailable, "Wrong-day events are rejected")

        let allDayHours = (0..<24).map { NativeForecastPoint(date: midnight.addingTimeInterval(Double($0) * 3600), isDay: true) }
        let continuous = NativeSunDaylight(forecast: forecast(day: midnight, hours: allDayHours), day: midnight)
        expect(continuous.mode == .continuousDaylight && continuous.daylightDuration == 86400, "Full explicit day samples support continuous daylight")
        let allNightHours = allDayHours.map { NativeForecastPoint(date: $0.date, isDay: false) }
        let continuousNight = NativeSunDaylight(forecast: forecast(day: midnight, hours: allNightHours), day: midnight)
        expect(continuousNight.mode == .continuousNight && continuousNight.height(at: now)! < 0, "Full explicit night samples support below-horizon all day")
        let incomplete = NativeSunDaylight(forecast: forecast(day: midnight, hours: Array(allDayHours.prefix(10))), day: midnight)
        expect(incomplete.mode == .unavailable, "Partial daytime rows cannot imply all-day daylight")
        let gap = NativeSunDaylight(forecast: forecast(day: midnight, hours: allDayHours.filter { $0.date != midnight.addingTimeInterval(7200) }), day: midnight)
        expect(gap.mode == .unavailable, "A gap prevents a complete-day claim")

        let springStart = at("2026-03-08T06:00:00Z")
        let springHours = (0..<23).map { NativeForecastPoint(date: springStart.addingTimeInterval(Double($0) * 3600), isDay: true) }
        let spring = NativeSunDaylight(forecast: forecast(day: springStart, hours: springHours), day: springStart)
        expect(spring.interval.duration == 23 * 3600 && spring.mode == .continuousDaylight, "Spring-forward day has 23 actual hours")
        let fallStart = at("2026-11-01T05:00:00Z")
        let fallHours = (0..<25).map { NativeForecastPoint(date: fallStart.addingTimeInterval(Double($0) * 3600), uvIndex: Double($0), isDay: false) }
        let fall = NativeSunDaylight(forecast: forecast(day: fallStart, hours: fallHours), day: fallStart)
        expect(fall.interval.duration == 25 * 3600 && fall.mode == .continuousNight, "Fall-back day has 25 actual hours")
        expect(fall.uv(at: fallStart.addingTimeInterval(5400)) == 1 && fall.uv(at: fallStart.addingTimeInterval(9000)) == 2, "Repeated local hour selects distinct UV samples")
        expect(fall.clock(fallStart.addingTimeInterval(5400), uses24HourClock: true, includeZone: true) != fall.clock(fallStart.addingTimeInterval(9000), uses24HourClock: true, includeZone: true), "Time zone disambiguates repeated local hours")
        let berlinDay = at("2026-09-17T22:00:00Z")
        let berlin = NativeSunDaylight(forecast: forecast(day: berlinDay, zone: "Europe/Berlin", rise: at("2026-09-18T05:00:00Z"), set: at("2026-09-18T17:00:00Z")), day: at("2026-09-18T15:00:00Z"))
        expect(berlin.interval.start == berlinDay && berlin.clock(berlin.sunrise!, uses24HourClock: true) == "07:00", "Travel uses selected place date and clock, not device zone")
        print("PASS Native sun/daylight: real events, interactive date mapping, missing/polar evidence, hourly UV, local clocks and 23/25-hour DST days")
    }
}
