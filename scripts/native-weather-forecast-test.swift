import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class ForecastProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var payload = Data()
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.payload)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main
struct NativeWeatherForecastTests {
    typealias Object = [String: Any]
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }
    static func instant(_ string: String) -> Date { ISO8601DateFormatter().date(from: string)! }
    static func data(_ object: Object) throws -> Data { try JSONSerialization.data(withJSONObject: object) }

    static func fixture(now: Date, timezone: String = "America/Chicago", latitude: Double = 38.72,
                        longitude: Double = -89.95, metric: Bool = false) -> Object {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone)!
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        let start = calendar.startOfDay(for: now)
        let dates = (0..<48).map { calendar.date(byAdding: .hour, value: $0, to: start)! }
        let timeStrings = dates.map { formatter.string(from: $0) }
        let quarterStart = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / 900) * 900)
        let quarterTimes = (0..<28).map { formatter.string(from: quarterStart.addingTimeInterval(Double($0) * 900)) }
        func series(_ times: [String]) -> Object {
            let count = times.count
            return ["time": times, "temperature_2m": Array(repeating: 73.5, count: count),
                "apparent_temperature": Array(repeating: 75.0, count: count),
                "precipitation_probability": Array(repeating: 10.0, count: count),
                "precipitation": Array(repeating: 0.0, count: count),
                "wind_speed_10m": Array(repeating: 9.0, count: count),
                "wind_gusts_10m": Array(repeating: 12.0, count: count),
                "wind_direction_10m": Array(repeating: 247.0, count: count),
                "weather_code": Array(repeating: 0, count: count), "cloud_cover": Array(repeating: 0, count: count),
                "is_day": Array(repeating: 1, count: count)]
        }
        let units: Object = ["temperature_2m": metric ? "°C" : "°F", "apparent_temperature": metric ? "°C" : "°F",
            "precipitation_probability": "%", "precipitation": "mm", "wind_speed_10m": metric ? "km/h" : "mp/h",
            "wind_gusts_10m": metric ? "km/h" : "mp/h", "wind_direction_10m": "°", "weather_code": "wmo code", "is_day": ""]
        let current: Object = ["time": formatter.string(from: now), "temperature_2m": 74.25,
            "apparent_temperature": 76.0, "precipitation": 0.0, "weather_code": 0,
            "cloud_cover": 0.0, "wind_speed_10m": 8.0, "wind_gusts_10m": 11.0, "is_day": 1, "interval": 900,
            "basis": "modeled-current"]
        let dailyDates = (0..<3).map { calendar.date(byAdding: .day, value: $0, to: start)! }
        let sunrises = dailyDates.map { formatter.string(from: calendar.date(byAdding: .hour, value: 6, to: $0)!) }
        let sunsets = dailyDates.map { formatter.string(from: calendar.date(byAdding: .hour, value: 19, to: $0)!) }
        formatter.dateFormat = "yyyy-MM-dd"
        return ["timezone": timezone, "_nearcastForecast": ["version": 1,
                "generatedAtMs": now.timeIntervalSince1970 * 1000, "latitude": latitude, "longitude": longitude,
                "unit": metric ? "celsius" : "fahrenheit", "precipitationUnit": "mm"],
            "current": current, "current_units": units, "hourly": series(timeStrings), "hourly_units": units,
            "minutely_15": series(quarterTimes), "minutely_15_units": units,
            "daily": ["time": dailyDates.map { formatter.string(from: $0) }, "temperature_2m_max": [80, 81, 82],
                "temperature_2m_min": [60, 61, 62], "precipitation_probability_max": [10, 20, 30],
                "precipitation_sum": [0.0, 1.0, 2.0], "weather_code": [0, 3, 61], "uv_index_max": [4, 5, 6],
                "sunrise": sunrises, "sunset": sunsets],
            "daily_units": ["temperature_2m_max": metric ? "°C" : "°F", "temperature_2m_min": metric ? "°C" : "°F",
                "precipitation_probability_max": "%", "precipitation_sum": "mm"]]
    }

    static func decode(_ object: Object, now: Date, latitude: Double = 38.72, longitude: Double = -89.95, metric: Bool = false) throws -> NativeWeatherForecast {
        try NativeWeatherForecast.decode(data: data(object), latitude: latitude, longitude: longitude, metric: metric, now: now)
    }

    static func rejects(_ object: Object, now: Date, _ message: String, latitude: Double = 38.72, metric: Bool = false) {
        do {
            _ = try decode(object, now: now, latitude: latitude, metric: metric)
            preconditionFailure(message)
        } catch {}
    }

    static func main() async throws {
        let now = instant("2026-09-18T18:17:00Z")
        let base = fixture(now: now)
        let forecast = try decode(base, now: now)
        expect(forecast.current?.temperature == 74.25, "Service-calibrated current value is not adjusted again")
        expect(forecast.current?.cloudCover == 0, "Current cloud cover remains available for the native atmosphere")
        expect(forecast.hours[0].temperature == 73.5, "Service-calibrated hourly values remain exact")
        expect(forecast.hours[0].cloudCover == 0, "Hourly cloud cover remains available for the native atmosphere")
        expect(forecast.hours[0].windDirection == 247, "Hourly wind direction remains available for the native scan row")
        expect(NativeWindDirection.compassPoint(247) == "WSW", "Wind direction uses a readable 16-point compass")
        expect(NativeWindDirection.spokenCompassPoint(247) == "west-southwest", "Wind direction has an unambiguous spoken form")
        expect(NativeWindDirection.compassPoint(360) == "N" && NativeWindDirection.compassPoint(-1) == nil,
               "Wind direction accepts the provider's inclusive range without wrapping invalid values")
        expect(forecast.current?.date == now, "Current is not the midnight row")
        expect(forecast.generatedAt == now, "Original generation time is retained")
        expect(NativeForecastRetentionPolicy.isUsable(forecast,
            now: now.addingTimeInterval(NativeForecastRetentionPolicy.maximumAge)),
            "A forecast remains usable through the shared retention boundary")
        expect(!NativeForecastRetentionPolicy.isUsable(forecast,
            now: now.addingTimeInterval(NativeForecastRetentionPolicy.maximumAge + 1)),
            "A forecast expires immediately after the shared retention boundary")
        expect(forecast.hours(on: now).count == 24, "Slice in forecast place's calendar")
        expect(forecast.day(containing: now)?.high == 80, "Daily row uses destination calendar")
        expect(forecast.quarterHours.count == 25, "Containing quarter plus upcoming six-hour horizon")
        expect(forecast.quarterHours.last!.date < now.addingTimeInterval(21600), "No expanded quarter-hour horizon")
        expect(forecast.quarterHours.allSatisfy { $0.uvIndex == nil }, "No hourly UV is fabricated for quarter-hours")
        expect(forecast.current?.directRadiation == nil && forecast.current?.lowCloudCover == nil,
               "Absent optional atmosphere inputs remain unavailable")
        expect(forecast.current?.origin == .modeledCurrent && forecast.current?.precipitationIntervalSeconds == 900,
               "The current reading retains explicit origin and its actual accumulation interval")
        expect(forecast.hours.allSatisfy { $0.origin == .hourlyForecast && $0.precipitationIntervalSeconds == 3600 },
               "Hourly rows remain hourly even when used as a fallback")
        expect(forecast.quarterHours.allSatisfy { $0.origin == .quarterHourForecast && $0.precipitationIntervalSeconds == 900 },
               "Quarter-hour rows do not masquerade as current observations")

        var atmosphere = base
        let atmosphereValues: [String: Double] = ["cloud_cover_low": 8, "cloud_cover_mid": 47,
            "cloud_cover_high": 19, "shortwave_radiation": 640, "direct_radiation": 450, "diffuse_radiation": 190]
        var atmosphereCurrent = atmosphere["current"] as! Object
        var atmosphereHours = atmosphere["hourly"] as! Object
        var atmosphereCurrentUnits = atmosphere["current_units"] as! Object
        var atmosphereHourUnits = atmosphere["hourly_units"] as! Object
        for (key, value) in atmosphereValues {
            atmosphereCurrent[key] = value
            atmosphereHours[key] = Array(repeating: value, count: 48)
            let unit = key.hasPrefix("cloud_cover") ? "%" : "W/m²"
            atmosphereCurrentUnits[key] = unit
            atmosphereHourUnits[key] = unit
        }
        atmosphere["current"] = atmosphereCurrent
        atmosphere["hourly"] = atmosphereHours
        atmosphere["current_units"] = atmosphereCurrentUnits
        atmosphere["hourly_units"] = atmosphereHourUnits
        let enriched = try decode(atmosphere, now: now)
        expect(enriched.current?.lowCloudCover == 8 && enriched.current?.midCloudCover == 47 && enriched.current?.highCloudCover == 19,
               "Native current retains existing provider cloud layers")
        expect(enriched.current?.shortwaveRadiation == 640 && enriched.current?.directRadiation == 450 && enriched.current?.diffuseRadiation == 190,
               "Native current retains existing provider W/m² radiation without unit conversion")
        expect(enriched.hours[0].midCloudCover == 47 && enriched.hours[0].directRadiation == 450,
               "Hourly atmosphere enrichment is available without another request")
        let restoredAtmosphere = try JSONDecoder().decode(NativeWeatherForecast.self, from: JSONEncoder().encode(enriched))
        expect(restoredAtmosphere.current?.directRadiation == 450 && restoredAtmosphere.hours[0].lowCloudCover == 8,
               "Optional enrichment survives the existing offline cache")
        atmosphereCurrent["cloud_cover_low"] = -1
        atmosphereCurrent["cloud_cover_mid"] = 101
        atmosphereCurrent["cloud_cover_high"] = true
        atmosphereCurrent["shortwave_radiation"] = -1
        atmosphereCurrent["direct_radiation"] = 2001
        atmosphereCurrent["diffuse_radiation"] = "190"
        atmosphere["current"] = atmosphereCurrent
        let invalidAtmosphere = try decode(atmosphere, now: now)
        expect(invalidAtmosphere.current?.lowCloudCover == nil && invalidAtmosphere.current?.midCloudCover == nil && invalidAtmosphere.current?.highCloudCover == nil,
               "Invalid cloud-layer percentages or booleans cannot influence the sky")
        expect(invalidAtmosphere.current?.shortwaveRadiation == nil && invalidAtmosphere.current?.directRadiation == nil && invalidAtmosphere.current?.diffuseRadiation == nil,
               "Invalid radiation remains missing, not clamped into convincing light")
        atmosphereCurrentUnits["direct_radiation"] = "kW/m²"
        atmosphereCurrent["direct_radiation"] = 0.45
        atmosphere["current_units"] = atmosphereCurrentUnits
        atmosphere["current"] = atmosphereCurrent
        let unknownRadiationUnits = try decode(atmosphere, now: now)
        expect(unknownRadiationUnits.current?.directRadiation == nil,
               "Unknown optional radiation units are ignored without failing the weather load")
        let metricForecast = try decode(fixture(now: now, metric: true), now: now, metric: true)
        expect(metricForecast.metric && metricForecast.current?.temperature == 74.25,
            "Metric payload is already in requested units and is not converted twice")

        var invalidClouds = base
        var invalidCurrent = invalidClouds["current"] as! Object
        invalidCurrent["cloud_cover"] = 101
        invalidClouds["current"] = invalidCurrent
        var invalidCloudHours = invalidClouds["hourly"] as! Object
        invalidCloudHours["cloud_cover"] = Array(repeating: -1, count: 48)
        invalidClouds["hourly"] = invalidCloudHours
        let invalidCloudForecast = try decode(invalidClouds, now: now)
        expect(invalidCloudForecast.current?.cloudCover == nil && invalidCloudForecast.hours[0].cloudCover == nil,
            "Invalid cloud percentages cannot influence the native atmosphere")

        let kolkata = try decode(fixture(now: instant("2026-09-18T20:00:00Z"), timezone: "Asia/Kolkata"), now: instant("2026-09-18T20:00:00Z"))
        expect(kolkata.calendar.component(.day, from: kolkata.days[0].date) == 19, "Half-hour timezone stays on selected place's date")
        expect(kolkata.day(containing: instant("2026-09-18T20:00:00Z"))?.date == kolkata.days[0].date, "Device day cannot select prior daily row")
        let dstNow = instant("2026-03-08T17:00:00Z")
        let dst = try decode(fixture(now: dstNow), now: dstNow)
        expect(dst.hours(on: dstNow).count == 23, "Spring-forward day is 23 hours, not an assumed 24-hour duration")
        let fallNow = instant("2026-11-01T07:17:00Z")
        let fall = try decode(fixture(now: fallNow), now: fallNow)
        expect(fall.hours(on: fallNow).count == 25, "Fall-back preserves both repeated local hours")
        expect(fall.current?.date == fallNow, "Repeated current hour resolves to the occurrence that has happened")
        expect(fall.quarterHours.count == 25, "Quarter-hour horizon beginning after fall-back retains its correct occurrence")
        let beforeFall = instant("2026-11-01T06:17:00Z")
        let firstFall = try decode(fixture(now: beforeFall), now: beforeFall)
        expect(firstFall.current?.date == beforeFall, "First repeated hour never points into the future")

        rejects(base, now: now, "Another place must be rejected", latitude: 39.0)
        rejects(base, now: now, "Unit mismatch must be rejected", metric: true)
        var invalid = base
        invalid["_nearcastForecast"] = nil
        rejects(invalid, now: now, "Missing provenance must not be accepted")
        invalid = base
        var metadata = invalid["_nearcastForecast"] as! Object
        metadata["generatedAtMs"] = now.addingTimeInterval(3600).timeIntervalSince1970 * 1000
        invalid["_nearcastForecast"] = metadata
        rejects(invalid, now: now, "Future generation time cannot look fresh")
        invalid = base
        invalid["timezone"] = "Missing/Zone"
        rejects(invalid, now: now, "Unknown timezone cannot fall back to the device")
        invalid = base
        var units = invalid["hourly_units"] as! Object
        units["precipitation"] = "inch"
        invalid["hourly_units"] = units
        rejects(invalid, now: now, "Metadata alone cannot hide incorrect precipitation units")

        var missing = base
        var hourly = missing["hourly"] as! Object
        hourly["temperature_2m"] = [NSNull(), 12.0] as [Any]
        hourly["precipitation_probability"] = [NSNull(), -1, 101, 0] as [Any]
        hourly["weather_code"] = [NSNull(), 0] as [Any]
        hourly["is_day"] = [NSNull(), 0] as [Any]
        missing["hourly"] = hourly
        missing["minutely_15"] = nil
        let gaps = try decode(missing, now: now)
        expect(gaps.hours[0].temperature == nil && gaps.hours[2].temperature == nil, "Null/short columns are missing, not zero")
        expect(gaps.hours[0].rainProbability == nil && gaps.hours[1].rainProbability == nil && gaps.hours[2].rainProbability == nil, "Invalid probabilities remain unavailable")
        expect(gaps.hours[3].rainProbability == 0, "A genuine zero probability survives")
        expect(gaps.quarterHours.isEmpty, "Hourly data does not generate synthetic quarter-hours")
        expect(NativeForecastPoint(date: now).conditionLabel == "Conditions unavailable", "Missing condition cannot look clear")
        var nullSeries = base
        let quarterTimes = (nullSeries["minutely_15"] as! Object)["time"] as! [String]
        nullSeries["minutely_15"] = ["time": quarterTimes, "temperature_2m": Array(repeating: NSNull(), count: quarterTimes.count),
            "weather_code": Array(repeating: NSNull(), count: quarterTimes.count), "is_day": Array(repeating: 1, count: quarterTimes.count)]
        let noQuarterReadings = try decode(nullSeries, now: now)
        expect(noQuarterReadings.quarterHours.isEmpty, "Time/daylight-only rows cannot advertise 15-minute availability")
        nullSeries["hourly"] = ["time": (base["hourly"] as! Object)["time"]!, "weather_code": Array(repeating: 88, count: 48)]
        let noHourlyReadings = try decode(nullSeries, now: now)
        expect(noHourlyReadings.hours.isEmpty, "Unknown-code/time-only rows cannot masquerade as hourly weather")
        nullSeries["hourly"] = ["time": (base["hourly"] as! Object)["time"]!, "cloud_cover": Array(repeating: 80, count: 48)]
        let cloudOnlyHours = try decode(nullSeries, now: now)
        expect(cloudOnlyHours.hours.isEmpty, "Cloud cover enriches valid weather but cannot create a forecast row alone")
        nullSeries["current"] = ["time": "2026-09-18T13:17", "is_day": 1]
        nullSeries["daily"] = ["time": ["2026-09-18"]]
        rejects(nullSeries, now: now, "An entirely empty forecast cannot become a successful load")

        var noCurrent = base
        var current = noCurrent["current"] as! Object
        current["time"] = "2026-09-18T23:30"
        noCurrent["current"] = current
        let resolved = try decode(noCurrent, now: now)
        expect(resolved.current?.date == instant("2026-09-18T18:00:00Z"), "Reject future current and choose containing hour, not row zero")
        noCurrent["hourly"] = nil
        let unavailable = try decode(noCurrent, now: now)
        expect(unavailable.current == nil, "Future current without an actual containing hour stays unavailable")

        var storms = base
        hourly = storms["hourly"] as! Object
        hourly["weather_code"] = Array(repeating: 95, count: 48)
        hourly["cloud_cover"] = Array(repeating: 80, count: 48)
        storms["hourly"] = hourly
        let possible = try decode(storms, now: now)
        expect(possible.hours[0].weatherCode == 3 && possible.hours[0].thunderPossible, "Small storm chance gets qualified, not a definite storm icon")
        expect(possible.hours[0].conditionLabel == "Thunderstorms possible", "Possibility survives dominant-sky interpretation")
        expect(possible.hours[0].symbolName == "cloud.fill", "Possible thunder is not forced into a definite storm symbol")
        expect(possible.days[0].weatherCode == 3, "Daily headlines reuse shared dominant-condition semantics")
        var quarters = storms["minutely_15"] as! Object
        quarters["weather_code"] = Array(repeating: 61, count: 28)
        quarters["precipitation"] = Array(repeating: 0.25, count: 28)
        quarters["precipitation_probability"] = Array(repeating: 35.0, count: 28)
        storms["minutely_15"] = quarters
        let wetQuarter = try decode(storms, now: now)
        expect(wetQuarter.quarterHours[0].weatherCode == 61, "Quarter amount converted to rate for existing interpretation")
        expect(wetQuarter.quarterHours[0].precipitationMM == 0.25, "Stored quarter accumulation is not multiplied")

        var evidence = base
        metadata = evidence["_nearcastForecast"] as! Object
        metadata["nws"] = ["checkedAt": now.timeIntervalSince1970 * 1000, "periods": [[
            "startMs": now.timeIntervalSince1970 * 1000, "endMs": now.addingTimeInterval(3600).timeIntervalSince1970 * 1000,
            "shortForecast": "Chance Showers And Thunderstorms", "probability": 30]]]
        evidence["_nearcastForecast"] = metadata
        let freshEvidence = try decode(evidence, now: now)
        expect(freshEvidence.current?.thunderPossible == true, "Fresh overlapping official language preserves possible thunder")
        expect(freshEvidence.days[0].thunderPossible && freshEvidence.days[0].conditionLabel == "Thunderstorms possible",
            "Daily outlook preserves qualified thunder already present in its scoped hours")
        expect(freshEvidence.days[0].symbolName == "sun.max.fill",
            "Daily thunder possibility does not override the dominant sky symbol")
        expect(!freshEvidence.days[1].thunderPossible && freshEvidence.days[1].conditionLabel == "Clear",
            "Today's official thunder possibility cannot leak into tomorrow's outlook")
        let oldEvidence = try decode(evidence, now: now.addingTimeInterval(3 * 3600))
        expect(oldEvidence.current?.thunderPossible == false, "Stale official evidence cannot add thunder possibility")
        expect(!oldEvidence.days[0].thunderPossible, "Daily possibility cannot outlive its hourly evidence")
        expect(oldEvidence.generatedAt == now, "Reading old payload cannot renew generation time")

        try currentDecisionTests(now: now)
        try conflictingCurrentGuidanceTests()
        try await repositoryTests()
        print("PASS Native weather: provenance, exact values, units, nulls, civil dates/DST, current selection, authentic quarter-hours, shared weather semantics, scoped thunder, cache and request isolation")
    }

    static func currentDecisionTests(now: Date) throws {
        func decision(amount: Double? = 0.1, interval: Double? = 900,
                      origin: NativeForecastPoint.Origin? = .modeledCurrent,
                      code: Int? = 61, date: Date? = nil, rawCode: Int? = nil,
                      thunderPossible: Bool = false, temperature: Double? = nil) -> NativeCurrentWeatherDecision {
            NativeCurrentWeatherDecision(point: NativeForecastPoint(date: date ?? now,
                temperature: temperature, rainProbability: 100, precipitationMM: amount, weatherCode: code,
                thunderPossible: thunderPossible, rawWeatherCode: rawCode,
                origin: origin, precipitationIntervalSeconds: interval), now: now)
        }

        expect(decision().hasFreshReading && decision().liquidRainRateMMPerHour == 0.4,
               "A real current accumulation is converted to a rate without inventing an observation")
        expect(decision(amount: 0.05).liquidRainRateMMPerHour == 0.2, "The measurable-rate boundary is inclusive")
        expect(decision(amount: 0.049).liquidRainRateMMPerHour == nil, "Trace amounts do not become falling rain")
        expect(decision(date: now.addingTimeInterval(300)).hasFreshReading, "The existing five-minute clock allowance is inclusive")
        expect(!decision(date: now.addingTimeInterval(301)).hasFreshReading, "A future reading cannot drive the current sky")
        expect(decision(date: now.addingTimeInterval(-5399)).hasFreshReading, "A reading inside the existing freshness window stays accepted")
        expect(decision(date: now.addingTimeInterval(-1799)).liquidRainRateMMPerHour == 0.4,
               "Moving rain remains available inside its stricter thirty-minute window")
        expect(decision(date: now.addingTimeInterval(-1800)).hasFreshReading
            && decision(date: now.addingTimeInterval(-1800)).liquidRainRateMMPerHour == nil,
               "At exactly thirty minutes the useful headline remains but active rain expires")
        expect(decision(date: now.addingTimeInterval(300)).liquidRainRateMMPerHour == 0.4,
               "Active rain retains the same bounded five-minute clock allowance")
        expect(!decision(date: now.addingTimeInterval(-5400)).hasFreshReading, "The existing ninety-minute expiry remains exclusive")
        expect(decision(date: now.addingTimeInterval(-5400)).liquidRainRateMMPerHour == nil, "Stale rain never animates")
        expect(NativeCurrentWeatherDecision(point: nil, now: now).acceptedPoint == nil, "Absent weather stays absent")
        expect(NativeCurrentWeatherDecision(forecast: nil, now: now).liquidRainRateMMPerHour == nil, "Absent forecasts cannot imply rain")

        for origin: NativeForecastPoint.Origin? in [nil, .hourlyForecast, .quarterHourForecast] {
            expect(decision(origin: origin).liquidRainRateMMPerHour == nil,
                   "Only explicitly modeled-current input supports active rain, never legacy or forecast buckets")
        }
        for amount: Double? in [nil, 0, -1, .nan, .infinity] {
            expect(decision(amount: amount).liquidRainRateMMPerHour == nil, "Missing, dry and invalid accumulations cannot animate rain")
        }
        for interval: Double? in [nil, 0, -1, 59, 3601, .nan, .infinity] {
            expect(decision(interval: interval).liquidRainRateMMPerHour == nil, "Untrusted accumulation intervals cannot create a rate")
        }
        expect(decision(interval: 60).liquidRainRateMMPerHour == 6, "A credible one-minute interval remains exact")
        expect(decision(amount: 1, interval: 3600).liquidRainRateMMPerHour == 1, "A credible current hour interval remains exact")
        for code in [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99] {
            expect(decision(code: code).liquidRainRateMMPerHour == 0.4, "Normalized liquid rain and supported thunder preserve current rain")
        }
        for code: Int? in [nil, 0, 1, 2, 3, 45, 48, 56, 57, 66, 67, 71, 73, 75, 77, 85, 86] {
            expect(decision(code: code, rawCode: 95, thunderPossible: true).liquidRainRateMMPerHour == nil,
                   "Raw storm codes, high chance, freezing conditions and snow cannot promote a non-liquid normalized sky")
        }

        expect(decision(code: 71).snowWaterEquivalentRateMMPerHour == 0.4,
               "Current snow preserves the measured liquid-equivalent rate without inventing snow depth")
        expect(decision(amount: 0.0125, code: 71).snowWaterEquivalentRateMMPerHour == 0.05,
               "Snow's minimum measurable liquid-equivalent rate is inclusive")
        expect(decision(amount: 0.01249, code: 71).snowWaterEquivalentRateMMPerHour == nil,
               "Trace liquid-equivalent amounts do not become falling snow")
        expect(decision(interval: 60, code: 71).snowWaterEquivalentRateMMPerHour == 6,
               "Snow retains an exact credible one-minute accumulation interval")
        expect(decision(amount: 1, interval: 3600, code: 71).snowWaterEquivalentRateMMPerHour == 1,
               "Snow retains an exact credible current-hour accumulation interval")
        for code in [71, 73, 75, 77, 85, 86] {
            expect(decision(code: code).snowWaterEquivalentRateMMPerHour == 0.4,
                   "Only normalized snow and snow-shower codes support falling snow")
        }
        for code: Int? in [nil, 0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99] {
            expect(decision(code: code, rawCode: 75, thunderPossible: true, temperature: -20).snowWaterEquivalentRateMMPerHour == nil,
                   "Cold temperatures, raw snow codes, high chance, rain and freezing precipitation cannot imply falling snow")
        }
        for amount: Double? in [nil, 0, -1, .nan, .infinity, .greatestFiniteMagnitude] {
            expect(decision(amount: amount, code: 75).snowWaterEquivalentRateMMPerHour == nil,
                   "Missing, dry, invalid and overflowing snow accumulations never animate")
        }
        for interval: Double? in [nil, 0, -1, 59, 3601, .nan, .infinity] {
            expect(decision(interval: interval, code: 75).snowWaterEquivalentRateMMPerHour == nil,
                   "Snow needs a trustworthy original accumulation interval")
        }
        expect(decision(code: 75, date: now.addingTimeInterval(-1799)).snowWaterEquivalentRateMMPerHour == 0.4,
               "Snow remains active just inside the thirty-minute boundary")
        expect(decision(code: 75, date: now.addingTimeInterval(-1800)).snowWaterEquivalentRateMMPerHour == nil,
               "Snow stops at exactly thirty minutes even though its headline remains useful")
        expect(decision(code: 75, date: now.addingTimeInterval(300)).snowWaterEquivalentRateMMPerHour == 0.4,
               "Snow shares the inclusive five-minute clock allowance")
        for offset: TimeInterval in [301, -5400] {
            expect(decision(code: 75, date: now.addingTimeInterval(offset)).snowWaterEquivalentRateMMPerHour == nil,
                   "Future and stale points cannot animate snow")
        }

        for code in [95, 96, 99] {
            expect(decision(amount: nil, interval: nil, code: code).hasCurrentThunderstorm,
                   "A normalized current thunderstorm shapes atmosphere without requiring a rain rate or inferring severity")
        }
        for code: Int? in [nil, 0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86] {
            expect(!decision(code: code, rawCode: 95, thunderPossible: true).hasCurrentThunderstorm,
                   "Raw storm codes and thunder possibility cannot turn another normalized condition into a current storm")
        }
        for amount: Double? in [nil, 0, -1, .nan, .infinity] {
            let storm = decision(amount: amount, interval: nil, code: 95)
            expect(storm.hasCurrentThunderstorm && storm.liquidRainRateMMPerHour == nil,
                   "A storm atmosphere is separate from unsupported rain animation")
        }
        expect(decision(code: 95, date: now.addingTimeInterval(-1799)).hasCurrentThunderstorm,
               "Current storm treatment survives just inside thirty minutes")
        expect(!decision(code: 95, date: now.addingTimeInterval(-1800)).hasCurrentThunderstorm,
               "Current storm treatment expires at exactly thirty minutes")
        expect(decision(code: 95, date: now.addingTimeInterval(300)).hasCurrentThunderstorm,
               "Storm treatment shares the inclusive five-minute clock allowance")
        for offset: TimeInterval in [301, -5400] {
            expect(!decision(code: 95, date: now.addingTimeInterval(offset)).hasCurrentThunderstorm,
                   "Future and stale points cannot shape current storm atmosphere")
        }
        for origin: NativeForecastPoint.Origin? in [nil, .hourlyForecast, .quarterHourForecast] {
            expect(decision(origin: origin, code: 75).snowWaterEquivalentRateMMPerHour == nil,
                   "Legacy and forecast-bucket snow cannot imply snow is falling now")
            expect(!decision(origin: origin, code: 95).hasCurrentThunderstorm,
                   "Legacy and forecast-bucket thunder cannot imply a storm is present now")
        }
        let absent = NativeCurrentWeatherDecision(forecast: nil, now: now)
        expect(absent.snowWaterEquivalentRateMMPerHour == nil && !absent.hasCurrentThunderstorm,
               "Absent forecasts cannot imply snow or current storms")

        var wet = fixture(now: now)
        var current = wet["current"] as! Object
        current["weather_code"] = 61
        current["precipitation"] = 0.1
        current["precipitation_probability"] = 80
        wet["current"] = current
        let decodedWet = try decode(wet, now: now)
        expect(NativeCurrentWeatherDecision(forecast: decodedWet, now: now).liquidRainRateMMPerHour == 0.4,
               "Verified service provenance reaches the shared current decision")
        let encoded = try JSONEncoder().encode(decodedWet)
        let roundTrip = try JSONDecoder().decode(NativeWeatherForecast.self, from: encoded)
        expect(roundTrip.current?.origin == .modeledCurrent && roundTrip.current?.precipitationIntervalSeconds == 900,
               "Codable snapshots preserve current precipitation provenance")
        var legacy = try JSONSerialization.jsonObject(with: encoded) as! Object
        var legacyCurrent = legacy["current"] as! Object
        legacyCurrent.removeValue(forKey: "origin")
        legacyCurrent.removeValue(forKey: "precipitationIntervalSeconds")
        legacy["current"] = legacyCurrent
        let legacyDecoded = try JSONDecoder().decode(NativeWeatherForecast.self, from: data(legacy))
        expect(legacyDecoded.current?.temperature == decodedWet.current?.temperature,
               "Legacy Codable snapshots remain readable after optional evidence fields are added")
        expect(NativeCurrentWeatherDecision(forecast: legacyDecoded, now: now).liquidRainRateMMPerHour == nil,
               "Missing legacy provenance never silently qualifies for active rain")

        for basis: String? in [nil, "hourly-forecast", "unrecognized-source"] {
            current["basis"] = basis
            wet["current"] = current
            let unqualified = try decode(wet, now: now)
            expect(unqualified.current?.weatherCode == 61, "Missing provenance does not rewrite the existing normalized condition")
            expect(NativeCurrentWeatherDecision(forecast: unqualified, now: now).liquidRainRateMMPerHour == nil,
                   "A current-shaped payload alone does not establish current provenance")
        }
        current["basis"] = "modeled-current"
        for rawInterval: Double? in [nil, 0, -1, 59, 3601] {
            current["interval"] = rawInterval
            wet["current"] = current
            let invalidInterval = try decode(wet, now: now)
            expect(invalidInterval.current?.precipitationIntervalSeconds == nil,
                   "Decoder defaults and clamping used by existing semantics cannot legitimize an unknown original interval")
            expect(NativeCurrentWeatherDecision(forecast: invalidInterval, now: now).liquidRainRateMMPerHour == nil,
                   "A missing or invalid service interval never qualifies for active rain")
        }
        wet.removeValue(forKey: "current")
        var hours = wet["hourly"] as! Object
        hours["weather_code"] = Array(repeating: 61, count: 48)
        hours["precipitation_probability"] = Array(repeating: 100, count: 48)
        hours["precipitation"] = Array(repeating: 1, count: 48)
        wet["hourly"] = hours
        let hourlyFallback = try decode(wet, now: now)
        expect(hourlyFallback.current?.origin == .hourlyForecast && hourlyFallback.current?.weatherCode == 61,
               "Rainy hourly fallback preserves its useful forecast headline and original provenance")
        expect(NativeCurrentWeatherDecision(forecast: hourlyFallback, now: now).liquidRainRateMMPerHour == nil,
               "A containing hourly forecast cannot imply precipitation is falling now")

        for code in [75, 95] {
            var conditionPayload = fixture(now: now)
            var conditionCurrent = conditionPayload["current"] as! Object
            conditionCurrent["weather_code"] = code
            conditionCurrent["precipitation"] = 0.1
            conditionCurrent["precipitation_probability"] = 80
            conditionPayload["current"] = conditionCurrent
            let verified = try decode(conditionPayload, now: now)
            let qualified = NativeCurrentWeatherDecision(forecast: verified, now: now)
            expect(code == 75 ? qualified.snowWaterEquivalentRateMMPerHour == 0.4 : qualified.hasCurrentThunderstorm,
                   "Verified service snow and storm provenance reach the shared current decision")
            let conditionEncoded = try JSONEncoder().encode(verified)
            let conditionRoundTrip = try JSONDecoder().decode(NativeWeatherForecast.self, from: conditionEncoded)
            let retained = NativeCurrentWeatherDecision(forecast: conditionRoundTrip, now: now)
            expect(code == 75 ? retained.snowWaterEquivalentRateMMPerHour == 0.4 : retained.hasCurrentThunderstorm,
                   "Codable snapshots retain qualified current snow and storm evidence")

            var conditionLegacy = try JSONSerialization.jsonObject(with: conditionEncoded) as! Object
            var missingOrigin = conditionLegacy["current"] as! Object
            missingOrigin.removeValue(forKey: "origin")
            missingOrigin.removeValue(forKey: "precipitationIntervalSeconds")
            conditionLegacy["current"] = missingOrigin
            let legacyForecast = try JSONDecoder().decode(NativeWeatherForecast.self, from: data(conditionLegacy))
            let unqualified = NativeCurrentWeatherDecision(forecast: legacyForecast, now: now)
            expect(unqualified.snowWaterEquivalentRateMMPerHour == nil && !unqualified.hasCurrentThunderstorm,
                   "Legacy snapshots remain readable without creating current snow or storm evidence")

            conditionPayload.removeValue(forKey: "current")
            var conditionHours = conditionPayload["hourly"] as! Object
            conditionHours["weather_code"] = Array(repeating: code, count: 48)
            conditionHours["precipitation_probability"] = Array(repeating: 100, count: 48)
            conditionHours["precipitation"] = Array(repeating: 1, count: 48)
            conditionPayload["hourly"] = conditionHours
            let fallback = try decode(conditionPayload, now: now)
            let fallbackDecision = NativeCurrentWeatherDecision(forecast: fallback, now: now)
            expect(fallback.current?.origin == .hourlyForecast,
                   "Snow and thunder hourly fallback preserve their forecast provenance")
            expect(fallbackDecision.snowWaterEquivalentRateMMPerHour == nil && !fallbackDecision.hasCurrentThunderstorm,
                   "An hourly fallback can keep its useful forecast headline without active snow or storm treatment")
        }
    }

    static func conflictingCurrentGuidanceTests() throws {
        let now = instant("2026-09-21T00:24:00Z")
        var payload = fixture(now: now)
        var current = payload["current"] as! Object
        current["time"] = "2026-09-20T19:15"
        current["weather_code"] = 53
        current["precipitation"] = 0.2
        current["cloud_cover"] = 100
        current["temperature_2m"] = 85
        payload["current"] = current
        var quarters = payload["minutely_15"] as! Object
        quarters["precipitation_probability"] = [7.0] + Array(repeating: 80.0, count: 27)
        payload["minutely_15"] = quarters
        var hours = payload["hourly"] as! Object
        hours["precipitation_probability"] = Array(repeating: 6.0, count: 48)
        payload["hourly"] = hours

        let forecast = try decode(payload, now: now)
        let decision = NativeCurrentWeatherDecision(forecast: forecast, now: now)
        expect(forecast.current?.rawWeatherCode == 53 && forecast.current?.weatherCode == 61
            && forecast.current?.precipitationMM == 0.2 && forecast.current?.temperature == 85,
            "Maryville's original modeled drizzle and amount remain intact; reconciliation is presentation-only")
        expect(forecast.current?.rainProbability == 7,
            "Current borrows the matching quarter's chance, not the hourly bucket or a later wet quarter")
        expect(decision.hasConflictingPrecipitationGuidance && decision.conditionLabel == "Rain possible"
            && decision.presentationWeatherCode == 3 && decision.liquidRainRateMMPerHour == nil,
            "Conflicting model-only rain is possible, with cloud sky and no asserted falling rain")
        expect(decision.conditionExplanation?.contains("7%") == true,
            "A source explanation retains the provider probability without calling it observation")
        let older = NativeCurrentWeatherDecision(forecast: forecast, now: now.addingTimeInterval(25 * 60))
        expect(older.conditionLabel == "Rain possible" && older.presentationWeatherCode == 3,
            "Expiring the animation window cannot turn uncertain rain into a confident rain headline")
        let roundTrip = try JSONDecoder().decode(NativeWeatherForecast.self, from: JSONEncoder().encode(forecast))
        expect(NativeCurrentWeatherDecision(forecast: roundTrip, now: now).conditionLabel == "Rain possible",
            "Stored native forecasts retain the evidence needed for uncertainty")

        quarters["precipitation_probability"] = [80.0] + Array(repeating: 0.0, count: 27)
        payload["minutely_15"] = quarters
        let supported = NativeCurrentWeatherDecision(forecast: try decode(payload, now: now), now: now)
        expect(!supported.hasConflictingPrecipitationGuidance && supported.liquidRainRateMMPerHour == 0.8,
            "Supported matching quarter rain is preserved despite low hourly probability")

        quarters["precipitation_probability"] = [0.0] + Array(repeating: 80.0, count: 27)
        hours["precipitation_probability"] = Array(repeating: 80.0, count: 48)
        payload["minutely_15"] = quarters
        payload["hourly"] = hours
        let zeroChance = try decode(payload, now: now)
        expect(zeroChance.current?.rainProbability == 0,
            "A genuine zero in the matching quarter does not fall through to the hourly chance")

        current["time"] = "2026-09-20T18:45"
        payload["current"] = current
        let earlierCurrent = try decode(payload, now: now)
        expect(earlierCurrent.current?.rainProbability == 80,
            "An older current model reading cannot borrow a newer quarter's conflicting probability")
        current["time"] = "2026-09-20T19:15"
        payload["current"] = current

        quarters.removeValue(forKey: "precipitation_probability")
        hours["precipitation_probability"] = Array(repeating: 6.0, count: 48)
        payload["minutely_15"] = quarters
        payload["hourly"] = hours
        let hourlyConflict = try decode(payload, now: now)
        expect(hourlyConflict.current?.rainProbability == 6
            && NativeCurrentWeatherDecision(forecast: hourlyConflict, now: now).conditionLabel == "Rain possible",
            "Missing matching quarter probability can use the containing hourly interval")

        hours.removeValue(forKey: "precipitation_probability")
        payload["hourly"] = hours
        let unknown = NativeCurrentWeatherDecision(forecast: try decode(payload, now: now), now: now)
        expect(unknown.acceptedPoint?.rainProbability == nil && !unknown.hasConflictingPrecipitationGuidance
            && unknown.liquidRainRateMMPerHour == 0.8,
            "Missing probabilities remain unknown and cannot silently manufacture a dry reading")

        current["precipitation_probability"] = 29
        payload["current"] = current
        let low = NativeCurrentWeatherDecision(forecast: try decode(payload, now: now), now: now)
        expect(low.conditionLabel == "Rain possible", "Model-only probability below the supported threshold stays qualified")
        current.removeValue(forKey: "precipitation")
        payload["current"] = current
        let incomplete = NativeCurrentWeatherDecision(forecast: try decode(payload, now: now), now: now)
        expect(incomplete.conditionLabel == "Rain possible" && incomplete.liquidRainRateMMPerHour == nil,
            "An unknown accumulation cannot make conflicting modeled rain more certain")
        current["precipitation"] = 0.2
        current["precipitation_probability"] = 30
        payload["current"] = current
        let threshold = NativeCurrentWeatherDecision(forecast: try decode(payload, now: now), now: now)
        expect(!threshold.hasConflictingPrecipitationGuidance && threshold.liquidRainRateMMPerHour == 0.8,
            "Supported current model rain uses the existing 30 percent policy boundary")

        for (code, label) in [(75, "Snow possible"), (95, "Thunderstorms possible"), (66, "Freezing precipitation possible")] {
            current["weather_code"] = code
            current["precipitation_probability"] = 7
            payload["current"] = current
            let uncertainty = NativeCurrentWeatherDecision(forecast: try decode(payload, now: now), now: now)
            expect(uncertainty.conditionLabel == label && uncertainty.presentationWeatherCode == 3
                && uncertainty.liquidRainRateMMPerHour == nil && uncertainty.snowWaterEquivalentRateMMPerHour == nil
                && !uncertainty.hasCurrentThunderstorm,
                "Conflicting \(label) stays qualified without active precipitation or storm treatment")
        }
        print("PASS Current model disagreement: matched intervals, raw evidence, uncertainty, shared sky, missing data, supported rain and persistence")
    }

    static func repositoryTests() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("nearcast-native-forecast-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ForecastProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let repository = NativeForecastRepository(cacheDirectory: root, session: session)
        let now = Date()
        ForecastProtocol.payload = try data(fixture(now: now))
        ForecastProtocol.status = 200
        let fresh = try await repository.fetch(latitude: 38.72, longitude: -89.95, metric: false, now: now)
        let cached = await repository.cached(latitude: 38.72, longitude: -89.95, metric: false)
        expect(cached?.generatedAt == fresh.generatedAt, "Cache fetch preserves source timestamp")
        expect(cached?.current?.origin == .modeledCurrent && cached?.current?.precipitationIntervalSeconds == 900,
               "Network and disk cache preserve the same current origin and accumulation interval")
        let query = URLComponents(url: ForecastProtocol.requests.last!.url!, resolvingAgainstBaseURL: false)!
        expect(query.host == "getnearcast.app" && query.path == "/api/forecast", "Only normalized service is requested")
        expect(query.queryItems?.first(where: { $0.name == "precipitation_unit" })?.value == "mm", "Request mm independently of temperature preference")
        let wrongPlace = await repository.cached(latitude: 39.0, longitude: -89.95, metric: false)
        let wrongUnits = await repository.cached(latitude: 38.72, longitude: -89.95, metric: true)
        expect(wrongPlace == nil && wrongUnits == nil, "Cache cannot cross places or unit systems")
        ForecastProtocol.status = 503
        do {
            _ = try await repository.fetch(latitude: 38.72, longitude: -89.95, metric: false, now: now)
            preconditionFailure("HTTP failure must propagate")
        } catch {}
        let retained = await repository.cached(latitude: 38.72, longitude: -89.95, metric: false)
        expect(retained?.generatedAt == fresh.generatedAt, "Failed refresh preserves valid cached forecast")
        ForecastProtocol.status = 200
        ForecastProtocol.payload = try data(fixture(now: now.addingTimeInterval(-3600)))
        _ = try await repository.fetch(latitude: 38.72, longitude: -89.95, metric: false, now: now)
        let newer = await repository.cached(latitude: 38.72, longitude: -89.95, metric: false)
        expect(newer?.generatedAt == fresh.generatedAt, "Delayed old response cannot replace a newer cached forecast")
        let cacheFiles = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        try Data("interrupted payload".utf8).write(to: cacheFiles[0], options: .atomic)
        let corrupt = await repository.cached(latitude: 38.72, longitude: -89.95, metric: false)
        expect(corrupt == nil, "Corrupt cache is unavailable, not fatal")

        ForecastProtocol.status = 200
        for index in 0..<15 {
            let latitude = 38.72 + Double(index) * 0.01
            ForecastProtocol.payload = try data(fixture(now: now, latitude: latitude))
            _ = try await repository.fetch(latitude: latitude, longitude: -89.95, metric: false, now: now)
        }
        let bounded = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        expect(bounded.count <= 12, "Disk forecast cache is bounded")
        let stale = now.addingTimeInterval(-49 * 3600)
        ForecastProtocol.payload = try data(fixture(now: stale, latitude: 42))
        do {
            _ = try await repository.fetch(latitude: 42, longitude: -89.95, metric: false, now: now)
            preconditionFailure("Expired network forecast must not reach native presentation")
        } catch NativeForecastError.staleForecast {}
        let expired = await repository.cached(latitude: 42, longitude: -89.95, metric: false)
        expect(expired == nil, "Expired network or offline data cannot masquerade as usable weather")
    }
}
