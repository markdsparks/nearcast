import Foundation

@main
struct NearcastNativeSharedForecastTest {
    static func main() throws {
        let now = ISO8601DateFormatter().date(from: "2026-09-07T15:30:00Z")!.timeIntervalSince1970
        let generatedAt = now - 35 * 60
        let hourStart = now - 30 * 60
        let metadata = try JSONDecoder().decode(NearcastSharedForecastMetadata.self, from: Data("""
        {"version":1,"generatedAtMs":\(generatedAt * 1000),"nws":{"checkedAt":\((now - 300) * 1000),"periods":[{"startMs":\(hourStart * 1000),"endMs":\((hourStart + 3600) * 1000),"shortForecast":"Chance Showers And Thunderstorms","probability":30}]}}
        """.utf8))
        precondition(metadata.weatherSavedAt(now: now) == generatedAt, "Cache retrieval cannot renew the weather's age")
        precondition(metadata.thunderPossible(startAt: hourStart, endAt: hourStart + 3600, now: now))
        precondition(!metadata.thunderPossible(startAt: hourStart + 3600, endAt: hourStart + 7200, now: now), "Evidence is scoped to the exact hour")
        precondition(!metadata.thunderPossible(startAt: hourStart, endAt: hourStart + 3600, now: now + 3 * 3600), "Stale official language cannot add new thunder qualifiers")

        let times = (0..<48).map { hour in
            String(format: "2026-09-%02dT%02d:00", 7 + hour / 24, hour % 24)
        }
        precondition(NearcastSharedForecastClock.currentIndex(times: times, currentTime: "2026-09-07T10:30", timezone: "America/Chicago", fallbackAt: now) == 10, "Full-day data starts at midnight, not at Now")
        precondition(NearcastSharedForecastClock.currentIndex(times: times, currentTime: "2026-09-08T01:15", timezone: "America/Chicago", fallbackAt: now) == 25, "The next day keeps its actual offset")
        precondition(NearcastSharedForecastClock.currentIndex(times: times, currentTime: "2026-09-07T15:30:00.000Z", timezone: "America/Chicago", fallbackAt: 0) == 10, "UTC observation timestamps retain their true instant")
        precondition(NearcastSharedForecastClock.currentIndex(times: times, currentTime: nil, timezone: "America/Chicago", fallbackAt: now) == 10)
        precondition(NearcastSharedForecastClock.weatherSavedAt(metadata: metadata, currentTime: "2026-09-07T10:30", timezone: "America/Chicago", now: now) == generatedAt)
        precondition(NearcastSharedForecastClock.weatherSavedAt(metadata: nil, currentTime: "2026-09-07T10:00", timezone: "America/Chicago", now: now) == hourStart, "Older servers fall back to data time, never fetch time")
        precondition(NearcastSharedForecastClock.weatherSavedAt(metadata: nil, currentTime: nil, timezone: nil, now: now) == nil)

        let zeroChance = try JSONDecoder().decode(NearcastSharedForecastMetadata.self, from: Data("""
        {"version":1,"generatedAtMs":\(now * 1000),"nws":{"checkedAt":\(now * 1000),"periods":[{"startMs":\(hourStart * 1000),"endMs":\((hourStart + 3600) * 1000),"shortForecast":"Thunderstorms","probability":0}]}}
        """.utf8))
        precondition(!zeroChance.thunderPossible(startAt: hourStart, endAt: hourStart + 3600, now: now))
        let future = try JSONDecoder().decode(NearcastSharedForecastMetadata.self, from: Data("{\"version\":1,\"generatedAtMs\":\((now + 3600) * 1000)}".utf8))
        precondition(future.weatherSavedAt(now: now) == nil)
        let identity = try JSONDecoder().decode(NearcastSharedForecastMetadata.self, from: Data("""
        {"version":1,"generatedAtMs":\(now * 1000),"latitude":38.72,"longitude":-89.95,"unit":"fahrenheit","precipitationUnit":"mm"}
        """.utf8))
        precondition(identity.matchesRequest(latitude: 38.7205, longitude: -89.9505, metric: false), "Cache-cell rounding is allowed")
        precondition(!identity.matchesRequest(latitude: 39.12, longitude: -89.95, metric: false), "Another place is rejected")
        precondition(!identity.matchesRequest(latitude: 38.72, longitude: -90.95, metric: false), "Mismatched longitude is rejected")
        precondition(!identity.matchesRequest(latitude: 38.72, longitude: -89.95, metric: true), "Response units must match the request")
        precondition(!NearcastSharedForecastClock.unitsMatch("km/h", requestedMetric: false), "A new metric preference rejects an in-flight Fahrenheit refresh")
        precondition(!NearcastSharedForecastClock.unitsMatch("mph", requestedMetric: true), "A new Fahrenheit preference rejects an in-flight metric refresh")
        precondition(NearcastSharedForecastClock.unitsMatch("km/h", requestedMetric: true))
        precondition(NearcastSharedForecastClock.unitsMatch("mph", requestedMetric: false))
        print("PASS Native shared forecast: source freshness, local/UTC current-hour indexing, missing data, and qualified time-scoped thunder")
    }
}
