import Foundation

/// The provider's raw weather code describes the most significant condition
/// it modeled for an interval. It is not, by itself, a good compact headline:
/// a very small shower or storm chance can otherwise turn an entire hour or
/// day into a rain icon. These inputs let every native surface apply the same
/// conservative presentation policy as the main Nearcast forecast.
struct NearcastForecastSemanticHour {
    var time: String
    var rawCode: Int?
    var precipitationChance: Double
    var precipitationAmount: Double
    var cloudCover: Double?
    var isDay: Bool?

    var dateKey: String {
        String(time.prefix(10))
    }

    var localHour: Int? {
        guard let clock = time.split(separator: "T").last,
              let hour = Int(clock.split(separator: ":").first ?? "") else {
            return nil
        }
        return hour
    }
}

enum NearcastForecastSemantics {
    private static let hourlyLikelyChance = 60.0
    private static let hourlySupportedChance = 30.0
    private static let dailyNoteChance = 20.0
    private static let hourlyAmountThreshold = 0.75 // Open-Meteo is requested in millimeters.
    private static let dailyAmountThreshold = 2.0
    private static let measurableRate = 0.2
    private static let moderateRate = 2.5
    private static let heavyRate = 7.6

    static func currentConditionCode(
        rawCode: Int?,
        precipitationAmount: Double?,
        intervalSeconds: Double?,
        cloudCover: Double?
    ) -> Int? {
        let rate = precipitationRate(
            amount: precipitationAmount ?? 0,
            intervalSeconds: intervalSeconds ?? 3_600
        )
        if let measured = measuredPrecipitationCode(rate: rate, baseCode: rawCode) {
            return strongerPrecipitationCode(rawCode, measured)
        }
        guard let rawCode else { return skyCode(cloudCover: cloudCover) }
        return isPrecipitationCondition(rawCode) ? skyCode(cloudCover: cloudCover) : rawCode
    }

    static func hourlyConditionCode(for hour: NearcastForecastSemanticHour) -> Int {
        let chance = max(0, min(100, hour.precipitationChance))
        let rate = precipitationRate(amount: hour.precipitationAmount, intervalSeconds: 3_600)
        let isPrimary = chance >= hourlyLikelyChance
            || (chance >= hourlySupportedChance && rate >= hourlyAmountThreshold)
        guard isPrimary else { return nonPrecipitationCode(hour.rawCode, cloudCover: hour.cloudCover) }

        if let measured = measuredPrecipitationCode(rate: rate, baseCode: hour.rawCode) {
            return strongerPrecipitationCode(hour.rawCode, measured) ?? measured
        }
        if let rawCode = hour.rawCode, isPrecipitationCondition(rawCode) {
            return rawCode
        }
        // A likely wet hour whose provider code is still a sky condition needs
        // a standard WMO rain code; native symbols do not serialize the web
        // app's internal `rain-likely` sentinel.
        return 61
    }

    /// Returns the condition that should represent a daily card. Callers pass
    /// only hours that remain in the day for "Today"; future days pass their
    /// full hourly window. Daylight owns the headline when there is enough of
    /// it to be representative, otherwise waking or remaining hours are used.
    static func dailyConditionCode(
        hours: [NearcastForecastSemanticHour],
        fallbackCode: Int?
    ) -> Int {
        let scoped = primaryHours(from: hours)
        guard !scoped.isEmpty else {
            return conservativeFallbackCode(fallbackCode)
        }

        var count30 = 0
        var count40 = 0
        var count60 = 0
        var maximumChance = 0.0
        var totalAmount = 0.0
        var bestCode: Int?
        var bestScore = -Double.infinity
        var bestRawCode: Int?
        var bestRawScore = -Double.infinity
        var skyCounts: [Int: Int] = [:]

        for hour in scoped {
            let chance = max(0, min(100, hour.precipitationChance))
            let rate = precipitationRate(amount: hour.precipitationAmount, intervalSeconds: 3_600)
            maximumChance = max(maximumChance, chance)
            totalAmount += max(0, hour.precipitationAmount)
            if chance >= 30 { count30 += 1 }
            if chance >= 40 { count40 += 1 }
            if chance >= 60 { count60 += 1 }

            let sky = nonPrecipitationCode(hour.rawCode, cloudCover: hour.cloudCover)
            skyCounts[sky, default: 0] += 1

            if let rawCode = hour.rawCode, isPrecipitationCondition(rawCode) {
                let score = chance * 1_000 + Double(precipitationWeight(rawCode))
                if score > bestRawScore {
                    bestRawScore = score
                    bestRawCode = rawCode
                }
            }

            guard chance >= 30 || (chance >= dailyNoteChance && rate >= hourlyAmountThreshold) else {
                continue
            }
            let candidate = hourlyConditionCode(for: hour)
            guard isPrecipitationCondition(candidate) else { continue }
            let score = Double(precipitationWeight(candidate)) * 100_000
                + chance * 1_000
                + min(999, (rate * 100).rounded())
            if score > bestScore {
                bestScore = score
                bestCode = candidate
            }
        }

        let amountPrimary = totalAmount >= dailyAmountThreshold && maximumChance >= hourlySupportedChance
        let sustained = count60 >= 2 || count40 >= 3 || count30 >= 4 || amountPrimary
        if sustained {
            if let bestCode { return bestCode }
            if let bestRawCode { return bestRawCode }
            return 61
        }

        if let modalSky = skyCounts.keys.sorted(by: { lhs, rhs in
            let lhsCount = skyCounts[lhs, default: 0]
            let rhsCount = skyCounts[rhs, default: 0]
            return lhsCount == rhsCount ? lhs < rhs : lhsCount > rhsCount
        }).first {
            return modalSky
        }
        return conservativeFallbackCode(fallbackCode)
    }

    private static func primaryHours(from hours: [NearcastForecastSemanticHour]) -> [NearcastForecastSemanticHour] {
        let daytime = hours.filter { $0.isDay == true }
        if daytime.count >= min(4, hours.count) { return daytime }
        let waking = hours.filter { hour in
            guard let localHour = hour.localHour else { return false }
            return localHour >= 6 && localHour < 22
        }
        return waking.isEmpty ? hours : waking
    }

    private static func conservativeFallbackCode(_ rawCode: Int?) -> Int {
        guard let rawCode else { return 2 }
        return isPrecipitationCondition(rawCode) ? 2 : rawCode
    }

    private static func nonPrecipitationCode(_ rawCode: Int?, cloudCover: Double?) -> Int {
        guard let rawCode else { return skyCode(cloudCover: cloudCover) }
        return isPrecipitationCondition(rawCode) ? skyCode(cloudCover: cloudCover) : rawCode
    }

    private static func skyCode(cloudCover: Double?) -> Int {
        guard let cloudCover, cloudCover.isFinite else { return 2 }
        if cloudCover < 15 { return 0 }
        if cloudCover < 45 { return 1 }
        if cloudCover < 75 { return 2 }
        return 3
    }

    private static func precipitationRate(amount: Double, intervalSeconds: Double) -> Double {
        let seconds = intervalSeconds > 0 ? intervalSeconds : 3_600
        return max(0, amount) * 3_600 / seconds
    }

    private static func measuredPrecipitationCode(rate: Double, baseCode: Int?) -> Int? {
        guard rate >= measurableRate else { return nil }
        if let baseCode, isThunderCode(baseCode) { return baseCode }
        if let baseCode, isSnowCode(baseCode) {
            if rate >= heavyRate { return 75 }
            if rate >= moderateRate { return 73 }
            return 71
        }
        if rate >= heavyRate { return 65 }
        if rate >= moderateRate { return 63 }
        return 61
    }

    private static func strongerPrecipitationCode(_ lhs: Int?, _ rhs: Int?) -> Int? {
        guard let lhs else { return rhs }
        guard let rhs else { return lhs }
        return precipitationWeight(rhs) > precipitationWeight(lhs) ? rhs : lhs
    }

    private static func precipitationWeight(_ code: Int) -> Int {
        if isThunderCode(code) { return 70 }
        if [65, 67, 75, 82, 86].contains(code) { return 60 }
        if [63, 73, 80, 81, 85].contains(code) { return 50 }
        if [61, 66, 71, 77].contains(code) { return 40 }
        if (51...57).contains(code) { return 30 }
        return 0
    }

    private static func isThunderCode(_ code: Int) -> Bool {
        code == 95 || code == 96 || code == 99
    }

    private static func isSnowCode(_ code: Int) -> Bool {
        (71...77).contains(code) || code == 85 || code == 86
    }

    private static func isPrecipitationCondition(_ code: Int) -> Bool {
        (51...86).contains(code) || isThunderCode(code)
    }
}
