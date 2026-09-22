import Foundation

enum NativePlanWeatherRead {
    static func headline(evidence: NativePlanEvidence, forecast: NativeWeatherForecast?) -> String {
        if !evidence.officialAlerts.alerts.isEmpty { return "An official alert overlaps this plan" }
        guard evidence.coverage == .complete else {
            return evidence.coverage == .unavailable ? "The forecast doesn’t reach this plan yet" : "Only part of this plan has a forecast"
        }
        guard evidence.source.isForecastFresh, let forecast else { return "Check for a newer forecast before you go" }
        let hours = forecast.hours.filter { $0.date >= evidence.window.startsAt.addingTimeInterval(-3599) && $0.date < evidence.window.endsAt }
        if hours.contains(where: { $0.thunderPossible || NativeWeatherCondition.isThunder($0.weatherCode) }) {
            return "Storms could affect this plan"
        }
        if let rain = evidence.rain?.probability, rain >= 60 { return "Rain is likely during this window" }
        if let gust = evidence.gust, gust.value >= (forecast.metric ? 48 : 30) { return "A gusty window outside" }
        let feels = hours.compactMap(\.apparentTemperature)
        if let high = feels.max(), high >= (forecast.metric ? 35 : 95) { return "Heat could make this uncomfortable" }
        if let rain = evidence.rain?.probability, rain >= 30 { return "Keep an indoor option in mind" }
        if let low = feels.min(), low <= (forecast.metric ? 0 : 32) { return "Bundle up for this plan" }
        if let rain = evidence.rain?.probability, rain < 30 { return "A mostly dry-looking window" }
        return "Check the hourly detail before you go"
    }
}
