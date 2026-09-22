import Foundation

/// How a native Ask response obtained its forecast. A saved fallback is never
/// equivalent to current conditions, even when it is still valid enough to
/// answer a bounded forecast question.
enum NativeAskForecastSource: String, Codable, Equatable, Sendable {
    /// A network refresh completed for this request.
    case refreshed
    /// A repository-validated device cache was used only after the network
    /// refresh failed. It is useful evidence, but not a current observation.
    case savedAfterRefreshFailure

    var isSavedFallback: Bool { self == .savedAfterRefreshFailure }
}

/// A deliberately small, read-only native Ask foundation.
///
/// This is not a second planner, a model prompt, or an owner for plans and
/// places. It answers only a short list of deterministic questions from the
/// already-loaded forecast. Everything involving a different time/place,
/// navigation, saved data, watches, or notifications belongs to the native
/// conversation/router and requires an explicit user action.
struct NativeAskReadRequest: Sendable {
    let question: String
    let placeName: String
    let forecast: NativeWeatherForecast
    /// The day the native weather surface is currently reading. The caller
    /// chooses it explicitly; this type never guesses a date from language.
    let selectedDay: Date
    let now: Date
    let uses24HourClock: Bool
    /// Callers must preserve forecast retrieval provenance. It defaults to a
    /// completed refresh for existing native readers, while saved fallbacks
    /// suppress any "current" wording below.
    let forecastSource: NativeAskForecastSource
    let resolvedScope: Bool
    let startHour: Double
    let endHour: Double

    init(
        question: String,
        placeName: String,
        forecast: NativeWeatherForecast,
        selectedDay: Date,
        now: Date,
        uses24HourClock: Bool,
        forecastSource: NativeAskForecastSource = .refreshed,
        resolvedScope: Bool = false,
        startHour: Double = -1,
        endHour: Double = -1
    ) {
        self.question = question
        self.placeName = placeName
        self.forecast = forecast
        self.selectedDay = selectedDay
        self.now = now
        self.uses24HourClock = uses24HourClock
        self.forecastSource = forecastSource
        self.resolvedScope = resolvedScope
        self.startHour = startHour
        self.endHour = endHour
    }
}

struct NativeAskReadResult: Equatable, Sendable {
    enum Disposition: String, Sendable {
        /// A deterministic answer that has no side effects.
        case answered
        /// The question is intentionally outside the small native read-only
        /// scope. The native conversation can clarify or offer a native editor;
        /// this reader must never automatically open it or mutate state.
        case handoff
        /// The loaded forecast does not contain enough relevant evidence.
        case unavailable
    }

    let disposition: Disposition
    let title: String
    let message: String
    /// Short provenance lines for a native UI. They contain only the active
    /// forecast's freshness and scope, never user-entered plan data.
    let evidence: [String]

    var requiresCompatibility: Bool { disposition == .handoff }
}

enum NativeAskRead {
    /// Human-readable scope uses the forecast place's calendar, never the
    /// phone's potentially different local date. Include an absolute date so
    /// a persisted "Tomorrow" answer remains understandable when reopened.
    static func readableDay(_ date: Date, calendar: Calendar, now: Date, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        formatter.setLocalizedDateFormatFromTemplate(sameYear ? "EEE MMM d" : "EEE MMM d y")
        let absolute = formatter.string(from: date)
        if calendar.isDate(date, inSameDayAs: now) { return "Today (\(absolute))" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: tomorrow) {
            return "Tomorrow (\(absolute))"
        }
        return absolute
    }

    /// Follow-ups inherit only a recognized weather topic, not instructions or
    /// a date/place from the previous question. Scope is resolved separately.
    static func resolvedQuestion(_ question: String, previous: String?) -> String {
        let value = normalized(question)
        guard classify(value) == .unsupported,
              containsAny(value, ["what about", "how about", "and ", "same "]), let previous else { return question }
        switch classify(normalized(previous)) {
        case .precipitation: return "Will it rain?"
        case .temperature: return "What is the temperature?"
        case .wind: return "How windy will it be?"
        case .uv: return "What is the UV?"
        case .sun: return "When is sunset?"
        case .bestTime: return "What is the best time for a walk?"
        case .outlook, .summary, .currentConditions: return "What is the weather?"
        case .unsupported: return question
        }
    }
    /// Answers a narrow, transparent set of forecast reads. This function has
    /// no networking, model invocation, persistence, notifications, routing,
    /// or mutable shared state.
    static func respond(to request: NativeAskReadRequest) -> NativeAskReadResult {
        let question = normalized(request.question)
        guard !question.isEmpty else {
            return handoff(
                "Ask a weather question",
                "Ask about rain, temperature, wind, UV, sunrise, sunset, or the best time for a walk."
            )
        }
        guard question.count <= 1200 else {
            return handoff(
                "Shorten the question",
                "Please keep this quick forecast question under 1,200 characters."
            )
        }
        if !request.resolvedScope && asksForMutationOrNavigation(question) {
            return handoff(
                "Review in the native app",
                "This request can affect places, plans, notifications, or navigation. The native quick read will not change anything."
            )
        }
        if !request.resolvedScope && asksForUnselectedTime(question, request: request) {
            return handoff(
                "Choose the forecast time",
                "This asks about a different day or time. The native quick read only uses the day currently on screen."
            )
        }

        let intent = classify(question)
        switch intent {
        case .precipitation:
            return precipitation(request)
        case .temperature:
            return temperature(request)
        case .wind:
            return wind(request)
        case .uv:
            return ultraviolet(request)
        case .sun:
            return sun(request)
        case .outlook:
            return outlook(request)
        case .currentConditions:
            return currentConditions(request)
        case .summary:
            return summary(request)
        case .bestTime:
            return bestTime(request)
        case .unsupported:
            return handoff(
                "Try a forecast question",
                "Quick forecast reads work without on-device AI. Ask about rain, temperature, wind, UV, sunrise, sunset, or the best time for a walk."
            )
        }
    }
}

private extension NativeAskRead {
    enum Intent {
        case precipitation
        case temperature
        case wind
        case uv
        case sun
        case outlook
        case currentConditions
        case summary
        case bestTime
        case unsupported
    }

    enum PrecipitationKind: Int {
        case thunder = 0
        case freezing = 1
        case snow = 2
        case rain = 3
        case precipitation = 4

        var noun: String {
            switch self {
            case .thunder: return "Thunderstorms"
            case .freezing: return "Freezing precipitation"
            case .snow: return "Snow"
            case .rain: return "Rain"
            case .precipitation: return "Precipitation"
            }
        }
    }

    struct PrecipitationSignal {
        let point: NativeForecastPoint
        let kind: PrecipitationKind
        let probability: Double?

        var likelihood: String {
            // This payload supplies precipitation probability, not the
            // probability of thunder. A wet hour cannot promote a possible
            // thunderstorm to "likely".
            if kind == .thunder { return "possible" }
            guard let probability else { return "possible" }
            return probability >= 60 ? "likely" : "possible"
        }

        var label: String { "\(kind.noun) \(likelihood)" }
    }

    static func normalized(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: "’", with: "'")
            .replacingOccurrences(of: #"[^a-z0-9%:'\-\s]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func containsAny(_ text: String, _ values: [String]) -> Bool {
        values.contains { text.contains($0) }
    }

    static func classify(_ question: String) -> Intent {
        if containsAny(question, ["best time", "best window", "good time", "when should", "for a walk", "for running"]) { return .bestTime }
        if containsAny(question, ["rain", "precip", "drizzle", "shower", "storm", "thunder", "snow", "sleet", "ice", "wet"]) {
            return .precipitation
        }
        if containsAny(question, ["uv", "sunburn", "sunscreen", "ultraviolet"]) { return .uv }
        if containsAny(question, ["sunrise", "sunset", "daylight", "dawn", "dusk"]) { return .sun }
        if containsAny(question, ["wind", "gust", "breez"]) { return .wind }
        if containsAny(question, ["temperature", " temp", " hot", " cold", " warm", " cool", "high", "low"]) {
            return .temperature
        }
        if containsAny(question, ["what changes", "changes later", "later today", "outlook", "what happens later"]) {
            return .outlook
        }
        if containsAny(question, ["weather now", "current weather", "current conditions", "conditions now", "what's it like", "what is it like", "outside now"]) {
            return .currentConditions
        }
        if containsAny(question, ["weather", "forecast", "conditions", "compare"]) { return .summary }
        return .unsupported
    }

    static func asksForMutationOrNavigation(_ question: String) -> Bool {
        let words = Set(question.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
        let actionWords: Set<String> = [
            "save", "add", "remove", "delete", "forget", "watch", "unwatch", "notify", "notification",
            "remind", "plan", "schedule", "routine", "switch", "open", "show", "map", "radar", "hourly",
            "settings", "theme", "unit"
        ]
        if !words.isDisjoint(with: actionWords) { return true }
        return containsAny(question, ["alert me", "change place", "change location", "take me"])
    }

    static func asksForUnselectedTime(_ question: String, request: NativeAskReadRequest) -> Bool {
        let calendar = request.forecast.calendar
        let selectedIsToday = calendar.isDate(request.selectedDay, inSameDayAs: request.now)
        // This first native slice does not parse dates. "Today" is supported
        // only while Today is actually selected; all other named periods need
        // the compatibility assistant's established date parser.
        if question.contains("today") && !selectedIsToday { return true }
        if let expression = try? NSRegularExpression(pattern: #"\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b"#),
           expression.firstMatch(in: question, range: NSRange(question.startIndex..., in: question)) != nil {
            return true
        }
        if let expression = try? NSRegularExpression(pattern: #"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b"#),
           expression.firstMatch(in: question, range: NSRange(question.startIndex..., in: question)) != nil {
            return true
        }
        return containsAny(question, [
            "tomorrow", "tonight", "next ", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            " at ", " between ", " from ", " after ", " before "
        ])
    }

    static func evidence(for request: NativeAskReadRequest) -> [String] {
        let scope = "Using \(dayLabel(request.selectedDay, request: request)) in \(request.placeName)"
        if request.forecastSource.isSavedFallback {
            return [scope,
                    "Saved forecast · live refresh unavailable",
                    "Forecast last updated \(relativeAge(request.forecast.generatedAt, now: request.now))"]
        }
        return [scope, "Forecast updated \(relativeAge(request.forecast.generatedAt, now: request.now))"]
    }

    static func answer(_ title: String, _ message: String, request: NativeAskReadRequest) -> NativeAskReadResult {
        .init(disposition: .answered, title: title, message: message, evidence: evidence(for: request))
    }

    static func unavailable(_ title: String, _ message: String, request: NativeAskReadRequest) -> NativeAskReadResult {
        .init(disposition: .unavailable, title: title, message: message, evidence: evidence(for: request))
    }

    static func handoff(_ title: String, _ message: String) -> NativeAskReadResult {
        .init(disposition: .handoff, title: title, message: message, evidence: [])
    }

    static func scopedHours(_ request: NativeAskReadRequest) -> [NativeForecastPoint] {
        let hours = request.forecast.hours(on: request.selectedDay)
            .filter(\.hasReadings)
            .filter { point in
                let components = request.forecast.calendar.dateComponents([.hour, .minute], from: point.date)
                let hour = Double(components.hour ?? 0) + Double(components.minute ?? 0) / 60
                return (request.startHour < 0 || hour >= request.startHour) && (request.endHour < 0 || hour < request.endHour)
            }
            .sorted { $0.date < $1.date }
        guard request.forecast.calendar.isDate(request.selectedDay, inSameDayAs: request.now) else { return hours }
        let start = request.forecast.calendar.dateInterval(of: .hour, for: request.now)?.start ?? request.now
        return hours.filter { $0.date >= start }
    }

    static func freshCurrent(_ request: NativeAskReadRequest) -> NativeForecastPoint? {
        guard !request.forecastSource.isSavedFallback,
              request.startHour < 0, request.endHour < 0,
              request.forecast.calendar.isDate(request.selectedDay, inSameDayAs: request.now),
              let current = request.forecast.current,
              current.hasReadings else { return nil }
        let age = request.now.timeIntervalSince(current.date)
        return (-5 * 60...75 * 60).contains(age) ? current : nil
    }

    static func signal(for point: NativeForecastPoint) -> PrecipitationSignal? {
        let chance = finiteProbability(point.rainProbability)
        let code = point.weatherCode
        if [95, 96, 99].contains(code ?? -1) || point.thunderPossible {
            return .init(point: point, kind: .thunder, probability: chance)
        }
        if [56, 57, 66, 67].contains(code ?? -1) {
            return .init(point: point, kind: .freezing, probability: chance)
        }
        if [71, 73, 75, 77, 85, 86].contains(code ?? -1) {
            return .init(point: point, kind: .snow, probability: chance)
        }
        if [51, 53, 55, 61, 63, 65, 80, 81, 82].contains(code ?? -1) {
            return .init(point: point, kind: .rain, probability: chance)
        }
        if let chance, chance >= 30 {
            return .init(point: point, kind: .precipitation, probability: chance)
        }
        return nil
    }

    static func precipitation(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        let hours = scopedHours(request)
        guard !hours.isEmpty else {
            return unavailable("Precipitation outlook", "There are no loaded hourly readings for this day.", request: request)
        }
        let currentSignal = freshCurrent(request).flatMap(signal)
        let hourlySignals = hours.compactMap(signal)
        // Lead with when the first qualified weather signal arrives. A later
        // thunder interval should not eclipse an earlier rain answer merely
        // because it is more severe.
        let first = currentSignal ?? hourlySignals.sorted { left, right in
            if left.point.date != right.point.date { return left.point.date < right.point.date }
            return left.kind.rawValue < right.kind.rawValue
        }.first
        if let first {
            let isCurrent = currentSignal?.point.date == first.point.date
            let timing = isCurrent ? "in the current forecast read" : "around \(clock(first.point.date, request: request))"
            let chance = first.probability.map { " (\(Int($0.rounded()))% precipitation chance)" } ?? ""
            return answer("Precipitation outlook", "\(first.label) \(timing)\(chance).", request: request)
        }
        // A zero accumulation by itself does not tell us whether the provider
        // supplied a condition/type or a probability. Do not turn that sparse
        // field into a reassuring "no rain" answer.
        let hasPrecipitationEvidence = hours.contains { point in
            point.weatherCode != nil || finiteProbability(point.rainProbability) != nil
        }
        guard hasPrecipitationEvidence else {
            return unavailable("Precipitation outlook", "The loaded hourly forecast does not include enough precipitation evidence for this day.", request: request)
        }
        let end = hours.last?.date
        let scope = end.map { " through \(clock($0, request: request))" } ?? ""
        return answer("Precipitation outlook", "No precipitation signal appears in the loaded hourly forecast\(scope). That is not a guarantee.", request: request)
    }

    static func temperature(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        let day = request.forecast.day(containing: request.selectedDay)
        let unit = request.forecast.metric ? "C" : "F"
        let high = finite(day?.high)
        let low = finite(day?.low)
        if request.startHour < 0, request.endHour < 0, let high, let low {
            var message = "The loaded forecast ranges from \(degree(low, unit: unit)) to \(degree(high, unit: unit))."
            if let current = freshCurrent(request), let currentTemperature = finite(current.temperature) {
                message += " The current forecast read is \(degree(currentTemperature, unit: unit))."
            }
            return answer("Temperature", message, request: request)
        }
        let values = scopedHours(request).compactMap { finite($0.temperature) }
        guard let low = values.min(), let high = values.max() else {
            return unavailable("Temperature", "The loaded forecast does not include enough temperature readings for this day.", request: request)
        }
        return answer("Temperature", "Loaded hourly temperatures range from \(degree(low, unit: unit)) to \(degree(high, unit: unit)).", request: request)
    }

    static func wind(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        let hours = scopedHours(request)
        let unit = request.forecast.metric ? "km/h" : "mph"
        let gusts = hours.compactMap { point -> (NativeForecastPoint, Double)? in finite(point.windGusts).map { (point, $0) } }
        if let peak = gusts.max(by: { $0.1 < $1.1 }) {
            return answer("Wind", "The strongest loaded forecast gust is \(Int(peak.1.rounded())) \(unit) around \(clock(peak.0.date, request: request)).", request: request)
        }
        let winds = hours.compactMap { point -> (NativeForecastPoint, Double)? in finite(point.windSpeed).map { (point, $0) } }
        if let peak = winds.max(by: { $0.1 < $1.1 }) {
            return answer("Wind", "The strongest loaded forecast wind is \(Int(peak.1.rounded())) \(unit) around \(clock(peak.0.date, request: request)).", request: request)
        }
        return unavailable("Wind", "The loaded hourly forecast does not include wind readings for this day.", request: request)
    }

    static func ultraviolet(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        guard let uv = finite(request.forecast.day(containing: request.selectedDay)?.uvIndex) else {
            return unavailable("UV", "The loaded daily forecast does not include a peak UV index for this day.", request: request)
        }
        let level: String
        switch uv {
        case ..<3: level = "low"
        case ..<6: level = "moderate"
        case ..<8: level = "high"
        case ..<11: level = "very high"
        default: level = "extreme"
        }
        return answer("UV", "The loaded daily forecast peaks at UV \(Int(uv.rounded())) (\(level)). A daily peak is not the UV level for the entire day.", request: request)
    }

    static func sun(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        guard let day = request.forecast.day(containing: request.selectedDay) else {
            return unavailable("Sun & daylight", "The loaded daily forecast does not include sunrise or sunset for this day.", request: request)
        }
        let sunrise = day.sunrise.map { clock($0, request: request) }
        let sunset = day.sunset.map { clock($0, request: request) }
        switch (sunrise, sunset, day.sunrise, day.sunset) {
        case let (.some(sunrise), .some(sunset), .some(start), .some(end)) where end > start:
            let daylight = end.timeIntervalSince(start)
            return answer("Sun & daylight", "Sunrise is \(sunrise) and sunset is \(sunset). Daylight lasts \(duration(daylight)).", request: request)
        case let (.some(sunrise), nil, _, _):
            return answer("Sun & daylight", "Sunrise is \(sunrise). Sunset is unavailable in the loaded forecast.", request: request)
        case let (nil, .some(sunset), _, _):
            return answer("Sun & daylight", "Sunset is \(sunset). Sunrise is unavailable in the loaded forecast.", request: request)
        default:
            return unavailable("Sun & daylight", "The loaded daily forecast does not include sunrise or sunset for this day.", request: request)
        }
    }

    static func outlook(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        if request.startHour >= 0 || request.endHour >= 0 { return summary(request) }
        let outlook = NativeWeatherOutlook.make(
            forecast: request.forecast,
            day: request.selectedDay,
            now: request.now,
            uses24HourClock: request.uses24HourClock
        )
        guard outlook.headline != "Outlook unavailable" else {
            return unavailable("What changes", outlook.detail ?? "The loaded hourly forecast is unavailable for this day.", request: request)
        }
        let message = [outlook.headline, outlook.detail].compactMap { $0 }.joined(separator: ". ")
        return answer("What changes", message.hasSuffix(".") ? message : message + ".", request: request)
    }

    static func currentConditions(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        if let current = freshCurrent(request) {
            let unit = request.forecast.metric ? "C" : "F"
            var values = [current.conditionLabel]
            if let temperature = finite(current.temperature) { values.append(degree(temperature, unit: unit)) }
            if let apparent = finite(current.apparentTemperature), apparent != current.temperature {
                values.append("feels \(degree(apparent, unit: unit))")
            }
            return answer("Current conditions", "The current forecast read is \(values.joined(separator: ", ")).", request: request)
        }
        guard let next = scopedHours(request).first else {
            return unavailable("Current conditions", "There is no current or upcoming loaded hourly forecast for this day.", request: request)
        }
        let unit = request.forecast.metric ? "C" : "F"
        var values = [next.conditionLabel]
        if let temperature = finite(next.temperature) { values.append(degree(temperature, unit: unit)) }
        return answer("Current conditions", "The nearest loaded hourly forecast is \(values.joined(separator: ", ")) around \(clock(next.date, request: request)).", request: request)
    }

    static func summary(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        guard !scopedHours(request).isEmpty else {
            return unavailable("Forecast", "The loaded hourly forecast does not cover that time.", request: request)
        }
        let parts = [temperature(request), precipitation(request), wind(request)]
            .filter { $0.disposition == .answered }.map(\.message)
        guard !parts.isEmpty else { return unavailable("Forecast", "There is not enough forecast evidence for that time.", request: request) }
        return answer("Forecast", parts.joined(separator: " "), request: request)
    }

    static func bestTime(_ request: NativeAskReadRequest) -> NativeAskReadResult {
        let candidates = scopedHours(request).filter { point in
            point.isDay == true && finiteProbability(point.rainProbability) != nil && finite(point.windSpeed) != nil
        }
        // Do not turn missing evidence into a recommendation. The rule is
        // explicit: avoid thunder, then prefer lower rain chance and wind.
        let ranked = candidates.sorted { left, right in
            func score(_ point: NativeForecastPoint) -> Double {
                (point.thunderPossible || [95, 96, 99].contains(point.weatherCode ?? -1) ? 10_000 : 0) +
                (point.rainProbability ?? 100) * 10 + (point.windSpeed ?? 100)
            }
            return score(left) == score(right) ? left.date < right.date : score(left) < score(right)
        }
        guard let best = ranked.first else {
            return unavailable("Best time", "There are not enough daylight hours with both rain and wind forecasts to compare that time window.", request: request)
        }
        let rain = Int(best.rainProbability!.rounded())
        let wind = Int(best.windSpeed!.rounded())
        let unit = request.forecast.metric ? "km/h" : "mph"
        let temperature = finite(best.temperature).map { ", \(degree($0, unit: request.forecast.metric ? "C" : "F"))" } ?? ""
        let warning = best.thunderPossible || [95, 96, 99].contains(best.weatherCode ?? -1)
            ? " Thunderstorms remain possible. Check official alerts before heading out." : ""
        return answer("Best time", "Among the loaded daylight hours, \(clock(best.date, request: request)) has the lowest rain-and-wind score: \(rain)% precipitation chance and \(wind) \(unit) wind\(temperature). This compares rain and wind, not overall safety.\(warning)", request: request)
    }

    static func finite(_ value: Double?) -> Double? {
        value.flatMap { $0.isFinite ? $0 : nil }
    }

    static func finiteProbability(_ value: Double?) -> Double? {
        finite(value).flatMap { (0...100).contains($0) ? $0 : nil }
    }

    static func degree(_ value: Double, unit: String) -> String {
        "\(Int(value.rounded()))°\(unit)"
    }

    static func clock(_ date: Date, request: NativeAskReadRequest) -> String {
        let calendar = request.forecast.calendar
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = request.forecast.timeZone
        formatter.dateFormat = request.uses24HourClock ? "HH:mm" : "h:mm a"
        return formatter.string(from: date)
    }

    static func dayLabel(_ date: Date, request: NativeAskReadRequest) -> String {
        let calendar = request.forecast.calendar
        if calendar.isDate(date, inSameDayAs: request.now) { return "Today" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = request.forecast.timeZone
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: date)
    }

    static func relativeAge(_ generatedAt: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(generatedAt))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(Int(seconds / 60)) min ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600)) hr ago" }
        return "\(Int(seconds / 86_400)) days ago"
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let totalMinutes = max(0, Int((seconds / 60).rounded()))
        return "\(totalMinutes / 60)h \(totalMinutes % 60)m"
    }
}
