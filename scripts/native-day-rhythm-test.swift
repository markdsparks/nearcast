import Foundation

@main
struct NativeDayRhythmPresentationTests {
    static func at(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func point(_ date: Date, temperature: Double? = nil, code: Int? = 0,
                      chance: Double? = 0, thunderPossible: Bool = false,
                      rawCode: Int? = nil, isDay: Bool? = true) -> NativeForecastPoint {
        NativeForecastPoint(
            date: date,
            temperature: temperature,
            rainProbability: chance,
            precipitationMM: chance.map { $0 >= 60 ? 1 : 0 },
            weatherCode: code,
            isDay: isDay,
            thunderPossible: thunderPossible,
            rawWeatherCode: rawCode,
            origin: .hourlyForecast,
            precipitationIntervalSeconds: 3_600
        )
    }

    static func forecast(_ hours: [NativeForecastPoint], now: Date,
                         zone: String = "America/Chicago", metric: Bool = false) -> NativeWeatherForecast {
        NativeWeatherForecast(
            generatedAt: now,
            timezoneID: zone,
            metric: metric,
            current: nil,
            hours: hours,
            quarterHours: [],
            days: []
        )
    }

    static func hours(_ start: Date, count: Int, temperature: (Int) -> Double? = { _ in 70 },
                      code: (Int) -> Int? = { _ in 0 }, chance: (Int) -> Double? = { _ in 0 },
                      thunder: (Int) -> Bool = { _ in false }, raw: (Int) -> Int? = { _ in nil }) -> [NativeForecastPoint] {
        (0..<count).map { offset in
            point(start.addingTimeInterval(Double(offset) * 3_600), temperature: temperature(offset),
                  code: code(offset), chance: chance(offset), thunderPossible: thunder(offset), rawCode: raw(offset),
                  isDay: offset >= 6 && offset < 18)
        }
    }

    static func period(_ rhythm: NativeDayRhythmPresentation, _ part: NativeDayRhythmPresentation.Daypart) -> NativeDayRhythmPresentation.Period {
        guard let result = rhythm.periods.first(where: { $0.daypart == part }) else {
            preconditionFailure("Missing \(part) period")
        }
        return result
    }

    static func main() {
        // Midnight September 20 in Chicago (UTC−05:00). The selected date is
        // the following complete local day; all ranges must derive from actual
        // hourly rows, never from a daily aggregate.
        let todayStart = at("2026-09-20T05:00:00Z")
        let futureStart = at("2026-09-21T05:00:00Z")
        let completeHours = hours(futureStart, count: 24, temperature: { 56 + Double($0) })
        let futureForecast = forecast(completeHours, now: todayStart)
        let fullDay = NativeDayRhythmPresentation.make(forecast: futureForecast, day: futureStart, now: todayStart)!
        expect(fullDay.periods.map(\.daypart) == [.overnight, .morning, .afternoon, .evening],
               "A fully covered future local day has four ordered civil periods")
        expect(fullDay.periods.allSatisfy { $0.coverage == .complete },
               "Six continuous hourly values cover each ordinary six-hour period")
        expect(period(fullDay, .morning).tapTarget == futureStart.addingTimeInterval(6 * 3_600),
               "A period taps its first actual provider hour, not a synthesized value")
        expect(period(fullDay, .morning).temperatureRange == .init(low: 62, high: 67),
               "Temperature ranges use only that period's canonical hourly readings")

        // Today at 09:30 local. Completed hourly forecast rows must not leak
        // into either visible periods or the remaining-day temperature range.
        let now = todayStart.addingTimeInterval(9.5 * 3_600)
        let todayHours = hours(todayStart, count: 24, temperature: { $0 < 9 ? -50 : 70 + Double($0) })
        let todayForecast = forecast(todayHours, now: now)
        let remaining = NativeDayRhythmPresentation.make(forecast: todayForecast, day: todayStart, now: now)!
        expect(remaining.periods.map(\.daypart) == [.morning, .afternoon, .evening],
               "Today omits fully completed dayparts rather than presenting forecast history as current")
        let morning = period(remaining, .morning)
        expect(morning.isCurrentRemainingPeriod && morning.guidanceStart == todayStart.addingTimeInterval(9 * 3_600),
               "The current hour remains eligible while completed rows are excluded")
        expect(morning.tapTarget == todayStart.addingTimeInterval(9 * 3_600),
               "The remaining morning opens the current actual provider hour")
        expect(morning.temperatureRange == .init(low: 79, high: 81),
               "A completed overnight/morning low cannot contaminate the remaining-day range")

        // A resolved WMO thunderstorm is specific hourly forecast evidence:
        // it may earn a precise window and a likely/possible qualification.
        let stormHours = hours(futureStart, count: 24, temperature: { _ in 72 }, code: { $0 == 13 ? 95 : 3 }, chance: { $0 == 13 ? 80 : 10 })
        let stormRhythm = NativeDayRhythmPresentation.make(forecast: forecast(stormHours, now: todayStart), day: futureStart, now: todayStart)!
        let stormPeriod = period(stormRhythm, .afternoon)
        expect(stormPeriod.event?.kind == .thunderstorm && stormPeriod.event?.likelihood == .likely,
               "Resolved hourly thunder stays a timed, qualified thunder event")
        expect(stormPeriod.event?.start == futureStart.addingTimeInterval(13 * 3_600)
                && stormPeriod.event?.end == futureStart.addingTimeInterval(14 * 3_600)
                && stormPeriod.event?.endIsKnown == true,
               "A following non-storm hourly reading establishes a real event end")
        expect(stormRhythm.untimedRisks.isEmpty,
               "Timed resolved thunder does not duplicate itself as a broad risk")
        expect(!stormRhythm.defaultIsExpanded,
               "A material event keeps its supported time in the compact read instead of hiding the chart and exact hours by default")

        // The NWS-derived flag is intentionally broader than an hourly WMO
        // reading. It must not become four fake storm windows or a timed row.
        let broadThunderHours = hours(futureStart, count: 24, temperature: { _ in 72 }, code: { _ in 3 }, chance: { _ in 20 }, thunder: { _ in true })
        let broadThunder = NativeDayRhythmPresentation.make(forecast: forecast(broadThunderHours, now: todayStart), day: futureStart, now: todayStart)!
        expect(broadThunder.untimedRisks == [.thunderstormPotential],
               "Broad thunder potential is one day-level risk")
        expect(broadThunder.periods.allSatisfy { $0.event == nil },
               "Thunder possible alone does not invent a period timing")
        expect(!broadThunder.defaultIsExpanded,
               "An untimed day-level risk does not force four period rows open before the hourly forecast")

        // A raw code may be retained for diagnosis, but it cannot override
        // resolved native semantics or turn an otherwise cloudy hour into a
        // precise storm claim.
        let rawThunderHours = hours(futureStart, count: 24, temperature: { _ in 72 }, code: { _ in 3 }, chance: { $0 == 10 ? 35 : 10 }, thunder: { $0 == 10 }, raw: { $0 == 10 ? 95 : nil })
        let rawThunder = NativeDayRhythmPresentation.make(forecast: forecast(rawThunderHours, now: todayStart), day: futureStart, now: todayStart)!
        expect(rawThunder.untimedRisks == [.thunderstormPotential]
                && rawThunder.periods.allSatisfy { $0.event?.kind != .thunderstorm },
               "Raw thunder and broad potential never override the resolved hourly condition")

        // A timed probability with no resolved precipitation type remains
        // explicitly type-agnostic. It must not receive a rain/snow label.
        let unknownPrecipHours = hours(futureStart, count: 24, temperature: { _ in 72 }, code: { $0 == 14 ? nil : 3 }, chance: { $0 == 14 ? 50 : 10 })
        let unknownPrecip = NativeDayRhythmPresentation.make(forecast: forecast(unknownPrecipHours, now: todayStart), day: futureStart, now: todayStart)!
        let unknownPeriod = period(unknownPrecip, .afternoon)
        expect(unknownPeriod.event?.kind == .precipitation && unknownPeriod.event?.label == "Precipitation possible",
               "Unknown precipitation type stays precipitation rather than becoming rain")

        // A missing hourly value is visible as limited coverage, not silently
        // filled with an interpolated interval or a pretend six-hour range.
        let partialHours = [
            point(futureStart.addingTimeInterval(6 * 3_600), temperature: 65, code: 0),
            point(futureStart.addingTimeInterval(8 * 3_600), temperature: 68, code: 0)
        ]
        let partial = NativeDayRhythmPresentation.make(forecast: forecast(partialHours, now: todayStart), day: futureStart, now: todayStart)!
        let partialMorning = period(partial, .morning)
        expect(partialMorning.coverage == .partial && partialMorning.sourceHourCount == 2,
               "A one-hour gap remains partial forecast coverage")
        expect(partialMorning.guidanceEnd == futureStart.addingTimeInterval(9 * 3_600),
               "The available forecast end reflects the last real hourly interval")

        let missingTemperatureHours = hours(futureStart, count: 6, temperature: { _ in nil }, code: { _ in 0 })
        let missingTemperature = NativeDayRhythmPresentation.make(forecast: forecast(missingTemperatureHours, now: todayStart), day: futureStart, now: todayStart)!
        expect(period(missingTemperature, .overnight).temperatureRange == nil,
               "Missing temperatures remain unavailable instead of becoming zero or a daily value")

        // Spring-forward has no 02:00 local hour. Five actual contiguous
        // one-hour intervals still fully cover the overnight civil window;
        // the model must not fabricate a skipped timestamp or call it a gap.
        let springStart = at("2026-03-08T06:00:00Z") // Midnight Chicago before DST starts.
        let springHours = [0, 1, 2, 3, 4].map { offset in
            point(springStart.addingTimeInterval(Double(offset) * 3_600), temperature: 40 + Double(offset), code: 0)
        }
        let springNow = at("2026-03-07T18:00:00Z")
        let spring = NativeDayRhythmPresentation.make(
            forecast: forecast(springHours, now: springNow), day: springStart, now: springNow
        )!
        expect(period(spring, .overnight).coverage == .complete,
               "The DST skip does not create an invented missing 02:00 forecast interval")

        // Fall-back repeats 01:00 local time. Seven actual provider rows are
        // continuous coverage for this six-hour civil window; the model must
        // retain them instead of collapsing the repeated clock hour.
        let fallStart = at("2026-11-01T05:00:00Z") // Midnight Chicago before the repeat.
        let fallHours = (0..<7).map { offset in
            point(fallStart.addingTimeInterval(Double(offset) * 3_600), temperature: 48 + Double(offset), code: 0)
        }
        let fallNow = at("2026-10-31T18:00:00Z")
        let fall = NativeDayRhythmPresentation.make(
            forecast: forecast(fallHours, now: fallNow), day: fallStart, now: fallNow
        )!
        expect(period(fall, .overnight).coverage == .complete && period(fall, .overnight).sourceHourCount == 7,
               "The fall-back repeat stays as real coverage instead of a duplicated or missing hour")

        expect(NativeDayRhythmPresentation.make(forecast: futureForecast, day: todayStart, now: futureStart) == nil,
               "A completed selected day is not repackaged as a historical weather story")
        print("PASS Native day rhythm: civil dayparts, remaining-day scope, tap targets, resolved thunder timing, untimed thunder risk, partial coverage, missing values, and DST")
    }
}
