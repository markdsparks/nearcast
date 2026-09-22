import Foundation

@main
struct NativePlanEvidenceTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }

    static func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    static let place = NativeAgendaPlace(id: "maryville", legacyIDType: nil, name: "Maryville",
                                         admin1: "Illinois", country: "United States", countryCode: "US",
                                         latitude: 38.72, longitude: -89.95, alias: nil,
                                         timezone: "America/Chicago", followsCurrentLocation: false)

    static func item(kind: NativeAgendaItemKind = .scheduledWindow,
                     startDate: String = "2026-09-21", startHour: Double = 9,
                     endDate: String = "2026-09-21", endHour: Double = 11) -> NativeAgendaItem {
        NativeAgendaItem(id: "soccer::occurrence", planID: "soccer", title: "Soccer", label: "Practice",
                         place: place, kind: kind, startDate: startDate, startHour: startHour,
                         endDate: endDate, endHour: endHour, isInProgress: false)
    }

    static func forecast(timeZone: String = "America/Chicago", metric: Bool = false) -> NativeWeatherForecast {
        let points = [
            NativeForecastPoint(date: date("2026-09-21T14:00:00Z"), temperature: 62, rainProbability: 45,
                                windGusts: 20, uvIndex: 3, weatherCode: 61, isDay: true,
                                origin: .hourlyForecast, precipitationIntervalSeconds: 3600),
            NativeForecastPoint(date: date("2026-09-21T15:00:00Z"), temperature: 64, rainProbability: 70,
                                windGusts: 35, uvIndex: 6, weatherCode: 63, isDay: true,
                                origin: .hourlyForecast, precipitationIntervalSeconds: 3600),
            NativeForecastPoint(date: date("2026-09-21T16:00:00Z"), temperature: 66, rainProbability: 10,
                                windGusts: 16, uvIndex: 4, weatherCode: 3, isDay: true,
                                origin: .hourlyForecast, precipitationIntervalSeconds: 3600)
        ]
        return NativeWeatherForecast(generatedAt: date("2026-09-21T13:55:00Z"), timezoneID: timeZone,
                                     metric: metric, current: nil, hours: points, quarterHours: [], days: [])
    }

    static func alert(id: String = "alert", start: Date = date("2026-09-21T14:30:00Z"),
                      end: Date = date("2026-09-21T15:30:00Z")) -> NativeOfficialAlert {
        NativeOfficialAlert(id: id, event: "Flood Watch", headline: "A test flood watch", description: "",
                            instruction: "", areaDescription: "", severity: "Moderate", urgency: "Future",
                            sent: date("2026-09-21T13:00:00Z"), startAt: start, endAt: end, eventEndsAt: end,
                            expiresAt: date("2026-09-21T20:00:00Z"), sourceURL: URL(string: "https://weather.gov/test"))
    }

    static func essentials(status: NativeEssentialsStatus = .ready, alerts: [NativeOfficialAlert] = [alert()], checkedAt: Date? = date("2026-09-21T14:00:00Z")) -> NativeWeatherEssentials {
        NativeWeatherEssentials(latitude: place.latitude, longitude: place.longitude,
            airQuality: NativeAirQualityState(status: .unavailable, checkedAt: nil, snapshot: nil, message: nil),
            alerts: NativeAlertState(status: status, checkedAt: checkedAt, alerts: alerts,
                                     message: status == .ready ? nil : "Official source unavailable"))
    }

    static func main() {
        let now = date("2026-09-21T14:00:00Z")
        let scheduled = item()
        let loaded = NativePlanEvidence.make(item: scheduled, forecast: forecast(), essentials: essentials(), now: now)!
        expect(loaded.window.kind == .scheduledWindow && loaded.window.startsAt == date("2026-09-21T14:00:00Z") &&
               loaded.window.endsAt == date("2026-09-21T16:00:00Z"),
               "Scheduled windows resolve in the plan place’s local time, not the device time")
        expect(loaded.coverage == .complete, "Adjacent exact hourly intervals cover a two-hour plan window")
        expect(NativePlanWeatherRead.headline(evidence: loaded, forecast: forecast()) == "An official alert overlaps this plan",
               "Official alert outranks an otherwise useful outdoor window")
        expect(loaded.condition?.label == "Light rain" && loaded.condition?.at == date("2026-09-21T14:00:00Z"),
               "Condition evidence preserves the first concrete in-window forecast sample")
        expect(loaded.rain?.label == "Rain" && loaded.rain?.probability == 70 && loaded.rain?.at == date("2026-09-21T15:00:00Z"),
               "Rain evidence preserves the peak available chance and its forecast type")
        expect(loaded.gust?.value == 35 && loaded.gust?.unit == "mph" && loaded.gust?.at == date("2026-09-21T15:00:00Z"),
               "Gust evidence reports an exact peak rather than a fabricated average")
        expect(loaded.uv?.index == 6 && loaded.uv?.at == date("2026-09-21T15:00:00Z"),
               "UV evidence reports the exact highest available in-window sample")
        guard case let .active(alerts, checkedAt) = loaded.officialAlerts else {
            preconditionFailure("A fresh official alert overlapping the plan must remain visible")
        }
        expect(alerts.map(\.event) == ["Flood Watch"] && checkedAt == date("2026-09-21T14:00:00Z"),
               "Official-alert evidence keeps a verified overlapping bulletin and its check time")
        expect(loaded.source.isForecastFresh && loaded.source.forecastTimeZoneID == "America/Chicago",
               "Evidence carries a source stamp without pretending to own forecast policy")

        let routine = item(kind: .weeklyRoutine)
        let routineEvidence = NativePlanEvidence.make(item: routine, forecast: forecast(), essentials: essentials(alerts: []), now: now)!
        expect(routineEvidence.window.kind == .weeklyRoutine && routineEvidence.coverage == .complete,
               "A rolled-forward weekly routine uses its derived occurrence, without changing stored routine memory")
        guard case .clear = routineEvidence.officialAlerts else {
            preconditionFailure("A fresh verified empty official result is the only all-clear state")
        }

        let span = item(kind: .continuousSpan, startDate: "2026-09-21", startHour: 9,
                        endDate: "2026-09-23", endHour: 10)
        let spanEvidence = NativePlanEvidence.make(item: span, forecast: forecast(), essentials: essentials(alerts: []), now: now)!
        expect(spanEvidence.window.kind == .continuousSpan && spanEvidence.coverage == .partial,
               "A continuous multi-day plan can expose partial forecast coverage without pretending it covers the whole trip")

        let unknownOfficial = NativePlanEvidence.make(item: scheduled, forecast: forecast(), essentials: nil, now: now)!
        guard case .unavailable = unknownOfficial.officialAlerts else {
            preconditionFailure("A missing official alert response must not become an all-clear")
        }
        let foreignEssentials = NativeWeatherEssentials(latitude: 32.72, longitude: -117.16,
            airQuality: NativeAirQualityState(status: .unavailable, checkedAt: nil, snapshot: nil, message: nil),
            alerts: essentials().alerts)
        let foreignOfficial = NativePlanEvidence.make(item: scheduled, forecast: forecast(), essentials: foreignEssentials, now: now)!
        guard case .unavailable = foreignOfficial.officialAlerts else {
            preconditionFailure("A foreign place’s official evidence cannot cross into this plan")
        }
        let stale = NativePlanEvidence.make(item: scheduled, forecast: forecast(),
                                            essentials: essentials(status: .stale, alerts: [alert()]), now: now)!
        guard case let .unavailable(_, retained) = stale.officialAlerts else {
            preconditionFailure("Stale official-alert state must remain unavailable, not clear")
        }
        expect(retained.count == 1, "Stale relevant bulletins remain evidence but lose verification status")
        let unsupported = NativePlanEvidence.make(item: scheduled, forecast: forecast(),
                                                  essentials: essentials(status: .unsupported, alerts: []), now: now)!
        guard case .unsupported = unsupported.officialAlerts else {
            preconditionFailure("Unsupported official coverage stays distinct from a failed check")
        }

        let otherZone = NativePlanEvidence.make(item: scheduled, forecast: forecast(timeZone: "Europe/Warsaw"), essentials: nil, now: now)!
        expect(otherZone.coverage == .unavailable && otherZone.condition == nil && otherZone.rain == nil,
               "A remote/mismatched forecast cannot be substituted for a saved plan place")

        let springGap = item(startDate: "2026-03-08", startHour: 2.5, endDate: "2026-03-08", endHour: 3.5)
        expect(NativePlanEvidenceWindow(item: springGap) == nil,
               "A nonexistent local daylight-saving time fails closed instead of shifting a saved plan")

        print("PASS Native plan evidence: isolated plan-place forecast facts and truthful official-alert semantics")
    }
}
