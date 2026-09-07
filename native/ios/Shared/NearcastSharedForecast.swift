import Foundation

/// Provenance accompanying the same normalized forecast used by Nearcast on
/// iPhone. A cache hit must retain its original weather time, not the fetch time.
struct NearcastSharedForecastMetadata: Decodable {
    let version: Int?
    let generatedAtMs: Double?
    let latitude: Double?
    let longitude: Double?
    let unit: String?
    let precipitationUnit: String?
    let nws: NWS?

    struct NWS: Decodable {
        let checkedAt: Double?
        let periods: [Period]?
    }

    struct Period: Decodable {
        let startMs: Double?
        let endMs: Double?
        let shortForecast: String?
        let probability: Double?
    }

    func matchesRequest(latitude requestedLatitude: Double, longitude requestedLongitude: Double, metric: Bool) -> Bool {
        // The shared service caches coordinates in 0.001-degree cells. Allow
        // only that tiny rounding distance, not a different family place.
        if let latitude, !latitude.isFinite || abs(latitude - requestedLatitude) > 0.0011 { return false }
        if let longitude, !longitude.isFinite || abs(longitude - requestedLongitude) > 0.0011 { return false }
        if let unit, unit != (metric ? "celsius" : "fahrenheit") { return false }
        if let precipitationUnit, precipitationUnit != "mm" { return false }
        return true
    }

    func weatherSavedAt(now: TimeInterval = Date().timeIntervalSince1970) -> TimeInterval? {
        guard version == 1, let generatedAtMs, generatedAtMs.isFinite else { return nil }
        let timestamp = generatedAtMs / 1_000
        guard timestamp > 0, timestamp <= now + 60 else { return nil }
        return min(now, timestamp)
    }

    /// Official forecast language is evidence of possibility, never an
    /// observation and never a reason to force a definite thunderstorm icon.
    func thunderPossible(startAt: TimeInterval?, endAt: TimeInterval?, now: TimeInterval = Date().timeIntervalSince1970) -> Bool {
        guard version == 1, let startAt, let endAt, startAt.isFinite, endAt > startAt,
              let checkedAt = nws?.checkedAt, checkedAt.isFinite,
              checkedAt / 1_000 <= now + 60, now - checkedAt / 1_000 <= 2 * 60 * 60 else { return false }
        return (nws?.periods ?? []).contains { period in
            guard let start = period.startMs, let end = period.endMs,
                  start.isFinite, end.isFinite, end > start,
                  start / 1_000 < endAt, end / 1_000 > startAt,
                  let text = period.shortForecast?.lowercased(), text.contains("thunder"),
                  !text.contains("no thunder") else { return false }
            return period.probability.map { $0.isFinite && $0 > 0 } ?? true
        }
    }
}

enum NearcastSharedForecastClock {
    static func unitsMatch(_ windUnit: String, requestedMetric: Bool) -> Bool {
        windUnit.lowercased().contains("km") == requestedMetric
    }

    static func timestamp(_ raw: String?, timezone: String?, utcOffsetSeconds: Int = 0) -> TimeInterval? {
        guard let raw, !raw.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        if let date = iso.date(from: raw) { return date.timeIntervalSince1970 }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date.timeIntervalSince1970 }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? TimeZone(secondsFromGMT: utcOffsetSeconds)
        for pattern in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
            formatter.dateFormat = pattern
            if let date = formatter.date(from: raw) { return date.timeIntervalSince1970 }
        }
        return nil
    }

    static func currentIndex(times: [String], currentTime: String?, timezone: String?, utcOffsetSeconds: Int = 0, fallbackAt: TimeInterval) -> Int {
        guard !times.isEmpty else { return 0 }
        let reference = timestamp(currentTime, timezone: timezone, utcOffsetSeconds: utcOffsetSeconds) ?? fallbackAt
        // Full-day payloads begin at midnight. Never treat row zero as Now.
        return times.indices.last { index in
            guard let start = timestamp(times[index], timezone: timezone, utcOffsetSeconds: utcOffsetSeconds) else { return false }
            return start <= reference
        } ?? 0
    }

    static func weatherSavedAt(metadata: NearcastSharedForecastMetadata?, currentTime: String?, timezone: String?, utcOffsetSeconds: Int = 0, now: TimeInterval = Date().timeIntervalSince1970) -> TimeInterval? {
        if let timestamp = metadata?.weatherSavedAt(now: now) { return timestamp }
        guard let timestamp = timestamp(currentTime, timezone: timezone, utcOffsetSeconds: utcOffsetSeconds),
              timestamp > 0, timestamp <= now + 60 else { return nil }
        return min(now, timestamp)
    }
}
