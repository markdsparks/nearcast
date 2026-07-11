import Foundation
import ActivityKit
import SwiftUI
import WidgetKit

private let nearcastWidgetStaleInterval: TimeInterval = 25 * 60

struct NearcastWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: NearcastWidgetSnapshot
}

struct NearcastWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> NearcastWidgetEntry {
        NearcastWidgetEntry(date: Date(), snapshot: .fallback)
    }

    func getSnapshot(in context: Context, completion: @escaping (NearcastWidgetEntry) -> Void) {
        completion(NearcastWidgetEntry(date: Date(), snapshot: NearcastWidgetSnapshot.current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NearcastWidgetEntry>) -> Void) {
        Task {
            let snapshot = await refreshedWidgetSnapshot()
            let entry = NearcastWidgetEntry(date: Date(), snapshot: snapshot)
            let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(15 * 60)
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }
}

private func refreshedWidgetSnapshot() async -> NearcastWidgetSnapshot {
    let cached = NearcastWidgetSnapshot.current()
    guard cached.age > nearcastWidgetStaleInterval, let place = NearcastWidgetPlace.stored() else {
        return cached
    }
    do {
        let snapshot = try await NearcastWidgetForecastClient.fetchSnapshot(for: place, fallback: cached)
        NearcastWidgetSnapshotStore.save(snapshot)
        return snapshot
    } catch {
        return cached
    }
}

enum NearcastWidgetForecastClient {
    static func fetchSnapshot(for place: NearcastWidgetPlace, fallback: NearcastWidgetSnapshot) async throws -> NearcastWidgetSnapshot {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.5f", place.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.5f", place.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day"),
            URLQueryItem(name: "hourly", value: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day"),
            URLQueryItem(name: "daily", value: "temperature_2m_max,temperature_2m_min,sunrise,sunset"),
            URLQueryItem(name: "temperature_unit", value: "fahrenheit"),
            URLQueryItem(name: "wind_speed_unit", value: "mph"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "forecast_days", value: "2")
        ]
        guard let url = components?.url else { throw URLError(.badURL) }

        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.cachePolicy = .reloadRevalidatingCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let forecast = try JSONDecoder().decode(WidgetForecastResponse.self, from: data)
        return buildSnapshot(from: forecast, place: place, fallback: fallback)
    }

    private static func buildSnapshot(from forecast: WidgetForecastResponse, place: NearcastWidgetPlace, fallback: NearcastWidgetSnapshot) -> NearcastWidgetSnapshot {
        let current = forecast.current
        let currentIndex = hourlyIndex(hourlyTimes: forecast.hourly?.time, currentTime: current.time)
        let rainChance = roundedValue(flatValue(forecast.hourly?.precipitationProbability?[safe: currentIndex])) ?? fallback.rainChance
        let uv = roundedValue(flatValue(forecast.hourly?.uvIndex?[safe: currentIndex])) ?? fallback.uv
        let high = roundedValue(flatValue(forecast.daily?.temperatureMax?.first)) ?? fallback.high
        let low = roundedValue(flatValue(forecast.daily?.temperatureMin?.first)) ?? fallback.low
        let windDirection = roundedValue(current.windDirection)
        let wind = roundedValue(current.windSpeed) ?? fallback.wind
        let feels = roundedValue(current.apparentTemperature) ?? fallback.feelsLike
        let temp = roundedValue(current.temperature) ?? fallback.temperature
        let isDay = current.isDay.map { $0 == 1 } ?? fallback.isDay
        let conditionCode = current.weatherCode ?? fallback.conditionCode
        let nextRainChance = nextTwoHourRainChance(hourly: forecast.hourly, currentIndex: currentIndex)
        let sunriseAt = forecast.daily?.sunrise?.first.flatMap { forecastDate($0, timezone: forecast.timezone) }?.timeIntervalSince1970 ?? fallback.sunriseAt
        let sunsetAt = forecast.daily?.sunset?.first.flatMap { forecastDate($0, timezone: forecast.timezone) }?.timeIntervalSince1970 ?? fallback.sunsetAt

        return NearcastWidgetSnapshot(
            version: max(fallback.version, 4),
            savedAt: Date().timeIntervalSince1970,
            placeName: place.name,
            temperature: temp,
            feelsLike: feels,
            high: high,
            low: low,
            condition: conditionLabel(code: conditionCode, isDay: isDay),
            conditionCode: conditionCode,
            isDay: isDay,
            rainChance: rainChance,
            wind: wind,
            windUnit: "mph",
            windDirection: windDirection,
            windLabel: windDirection.map(windDirectionLabel),
            uv: uv,
            nowLabel: "Now",
            nowValue: nowValue(feelsLike: feels, code: conditionCode),
            nextLabel: "Next",
            nextValue: nextValue(rainChance: nextRainChance),
            laterLabel: "Later",
            laterValue: laterValue(forecast: forecast, wind: wind),
            planTitle: fallback.planTitle,
            planLabel: fallback.planLabel,
            planDetail: fallback.planDetail,
            planPlace: fallback.planPlace,
            planTone: fallback.planTone,
            watchStatus: fallback.watchStatus,
            watchDetail: fallback.watchDetail,
            watchTone: fallback.watchTone,
            timeline: buildTimeline(from: forecast, currentIndex: currentIndex),
            sunriseAt: sunriseAt,
            sunsetAt: sunsetAt
        )
    }

    private static func buildTimeline(from forecast: WidgetForecastResponse, currentIndex: Int) -> [NearcastWidgetHour] {
        guard let hourly = forecast.hourly, let times = hourly.time, !times.isEmpty else { return [] }
        let start = max(0, min(currentIndex, times.count - 1))
        let end = min(times.count - 1, start + 5)
        guard start <= end else { return [] }
        return (start...end).map { index in
            NearcastWidgetHour(
                offsetHours: max(0, index - start),
                timeLabel: shortClockTime(times[index]) ?? "\(max(0, index - start))h",
                temperature: roundedValue(flatValue(hourly.temperature?[safe: index])),
                feelsLike: roundedValue(flatValue(hourly.apparentTemperature?[safe: index])),
                rainChance: roundedValue(flatValue(hourly.precipitationProbability?[safe: index])),
                wind: roundedValue(flatValue(hourly.windSpeed?[safe: index])),
                windGust: roundedValue(flatValue(hourly.windGusts?[safe: index])),
                windDirection: roundedValue(flatValue(hourly.windDirection?[safe: index])),
                uv: roundedValue(flatValue(hourly.uvIndex?[safe: index])),
                conditionCode: hourly.weatherCode?[safe: index].flatMap { $0 },
                isDay: hourly.isDay?[safe: index].flatMap { $0 }.map { $0 == 1 }
            )
        }
    }

    private static func hourlyIndex(hourlyTimes: [String]?, currentTime: String?) -> Int {
        guard let hourlyTimes, !hourlyTimes.isEmpty else { return 0 }
        if let currentTime, let exact = hourlyTimes.firstIndex(of: currentTime) {
            return exact
        }
        let hourPrefix = currentTime.map { String($0.prefix(13)) }
        if let hourPrefix, let match = hourlyTimes.firstIndex(where: { $0.hasPrefix(hourPrefix) }) {
            return match
        }
        return 0
    }

    private static func nextTwoHourRainChance(hourly: WidgetForecastResponse.Hourly?, currentIndex: Int) -> Int {
        guard let probabilities = hourly?.precipitationProbability, !probabilities.isEmpty else { return 0 }
        let end = min(probabilities.count - 1, currentIndex + 2)
        guard currentIndex <= end else { return 0 }
        return (currentIndex...end)
            .compactMap { roundedValue(flatValue(probabilities[safe: $0])) }
            .max() ?? 0
    }

    private static func nowValue(feelsLike: Int, code: Int) -> String {
        if code >= 95 { return "Storms nearby" }
        if (51...82).contains(code) { return "Rain nearby" }
        if feelsLike >= 95 { return "Feels \(feelsLike)°" }
        if feelsLike <= 32 { return "Feels \(feelsLike)°" }
        return "Feels \(feelsLike)°"
    }

    private static func nextValue(rainChance: Int) -> String {
        rainChance >= 20 ? "Rain \(rainChance)%" : "Dry 2h"
    }

    private static func laterValue(forecast: WidgetForecastResponse, wind: Int) -> String {
        if let sunset = forecast.daily?.sunset?.first, let short = shortClockTime(sunset) {
            return "Sunset \(short)"
        }
        return "Wind \(wind) mph"
    }

    private static func shortClockTime(_ value: String) -> String? {
        let rawTime = value.split(separator: "T").last.map(String.init) ?? value
        let pieces = rawTime.split(separator: ":").compactMap { Int($0) }
        guard pieces.count >= 2 else { return nil }
        let hour24 = pieces[0]
        let minute = pieces[1]
        let hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12
        return minute == 0 ? "\(hour12)" : "\(hour12):\(String(format: "%02d", minute))"
    }

    private static func forecastDate(_ value: String, timezone: String?) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        if let timezone, let zone = TimeZone(identifier: timezone) {
            formatter.timeZone = zone
        }
        return formatter.date(from: value)
    }

    private static func conditionLabel(code: Int, isDay: Bool) -> String {
        switch code {
        case 0:
            return isDay ? "Clear" : "Clear night"
        case 1:
            return "Mostly clear"
        case 2:
            return "Partly cloudy"
        case 3:
            return "Cloudy"
        case 45, 48:
            return "Fog"
        case 51...67:
            return "Drizzle"
        case 71...77:
            return "Snow"
        case 80...82:
            return "Showers"
        case 85...86:
            return "Snow showers"
        case 95...99:
            return "Thunderstorms"
        default:
            return "Weather"
        }
    }

    private static func windDirectionLabel(_ degrees: Int) -> String {
        let normalized = ((degrees % 360) + 360) % 360
        let labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        let index = Int((Double(normalized) / 45.0).rounded()) % labels.count
        return labels[index]
    }

    private static func roundedValue(_ value: Double?) -> Int? {
        guard let value, value.isFinite else { return nil }
        return Int(value.rounded())
    }

    private static func flatValue(_ value: Double??) -> Double? {
        value.flatMap { $0 }
    }
}

struct WidgetForecastResponse: Decodable {
    struct Current: Decodable {
        let time: String?
        let temperature: Double?
        let apparentTemperature: Double?
        let weatherCode: Int?
        let windSpeed: Double?
        let windDirection: Double?
        let isDay: Int?

        enum CodingKeys: String, CodingKey {
            case time
            case temperature = "temperature_2m"
            case apparentTemperature = "apparent_temperature"
            case weatherCode = "weather_code"
            case windSpeed = "wind_speed_10m"
            case windDirection = "wind_direction_10m"
            case isDay = "is_day"
        }
    }

    struct Hourly: Decodable {
        let time: [String]?
        let temperature: [Double?]?
        let apparentTemperature: [Double?]?
        let precipitationProbability: [Double?]?
        let weatherCode: [Int?]?
        let windSpeed: [Double?]?
        let windGusts: [Double?]?
        let windDirection: [Double?]?
        let uvIndex: [Double?]?
        let isDay: [Int?]?

        enum CodingKeys: String, CodingKey {
            case time
            case temperature = "temperature_2m"
            case apparentTemperature = "apparent_temperature"
            case precipitationProbability = "precipitation_probability"
            case weatherCode = "weather_code"
            case windSpeed = "wind_speed_10m"
            case windGusts = "wind_gusts_10m"
            case windDirection = "wind_direction_10m"
            case uvIndex = "uv_index"
            case isDay = "is_day"
        }
    }

    struct Daily: Decodable {
        let temperatureMax: [Double?]?
        let temperatureMin: [Double?]?
        let sunrise: [String]?
        let sunset: [String]?

        enum CodingKeys: String, CodingKey {
            case temperatureMax = "temperature_2m_max"
            case temperatureMin = "temperature_2m_min"
            case sunrise
            case sunset
        }
    }

    let current: Current
    let hourly: Hourly?
    let daily: Daily?
    let timezone: String?
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else { return nil }
        return self[index]
    }
}

@main
struct NearcastWidgetBundle: WidgetBundle {
    var body: some Widget {
        NearcastWidget()
        NearcastStormActivityWidget()
    }
}

struct NearcastWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NearcastWidget", provider: NearcastWidgetProvider()) { entry in
            NearcastWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    NearcastWidgetBackdrop(snapshot: entry.snapshot)
                }
                .widgetURL(nearcastWidgetURL(snapshot: entry.snapshot))
        }
        .configurationDisplayName("Nearcast")
        .description("A glance at the weather that matters next.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
        .contentMarginsDisabled()
    }
}

private func nearcastWidgetURL(snapshot: NearcastWidgetSnapshot) -> URL? {
    var components = URLComponents()
    components.scheme = "nearcast"
    components.host = "weather"
    var items = [
        URLQueryItem(name: "source", value: "widget"),
        URLQueryItem(name: "placeName", value: snapshot.placeName)
    ]
    if let place = NearcastWidgetPlace.stored() {
        items.append(URLQueryItem(name: "latitude", value: String(format: "%.5f", place.latitude)))
        items.append(URLQueryItem(name: "longitude", value: String(format: "%.5f", place.longitude)))
    }
    components.queryItems = items
    return components.url
}

struct NearcastStormActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NearcastStormActivityAttributes.self) { context in
            NearcastStormActivityLockView(context: context)
                .activityBackgroundTint(Color(red: 0.05, green: 0.08, blue: 0.13))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.deepLink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 5) {
                            Image(systemName: "location.north.line.fill")
                                .font(.system(size: 8, weight: .black))
                                .foregroundStyle(.cyan.opacity(0.82))
                            Text("StormScope")
                                .font(.system(size: 8, weight: .black, design: .rounded))
                                .tracking(0.7)
                                .textCase(.uppercase)
                                .foregroundStyle(.cyan.opacity(0.82))
                                .lineLimit(1)
                        }
                        Text(cityName(context.attributes.placeName))
                            .font(.system(size: 14, weight: .black, design: .rounded))
                            .lineLimit(1)
                        Text(context.state.geometryQualityLabel)
                            .font(.system(size: 9, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.58))
                            .lineLimit(1)
                    }
                    .padding(.leading, 7)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 0) {
                        HStack(alignment: .firstTextBaseline, spacing: 1) {
                            StormArrivalCountdown(state: context.state, compact: true)
                            Text("min")
                                .font(.system(size: 9, weight: .black, design: .rounded))
                                .foregroundStyle(.white.opacity(0.78))
                        }
                        .lineLimit(1)
                        Text("ETA")
                            .font(.system(size: 8, weight: .black, design: .rounded))
                            .tracking(0.8)
                            .foregroundStyle(.white.opacity(0.54))
                        Text(context.state.confidence)
                            .font(.system(size: 8.5, weight: .black, design: .rounded))
                            .foregroundStyle(context.state.confidenceAccent)
                            .lineLimit(1)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 9) {
                        Image(systemName: context.state.severityLevel >= 3 ? "cloud.bolt.rain.fill" : "cloud.rain.fill")
                            .font(.system(size: 15, weight: .black))
                            .foregroundStyle(context.state.confidenceAccent)
                            .frame(width: 24, height: 24)
                            .background(.white.opacity(0.10), in: Circle())

                        VStack(alignment: .leading, spacing: 2) {
                            Text(context.state.status)
                                .font(.system(size: 11.5, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.78)
                            Text(context.state.detail)
                                .font(.system(size: 9.5, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white.opacity(0.66))
                                .lineLimit(1)
                                .minimumScaleFactor(0.78)
                        }

                        Spacer(minLength: 0)
                    }
                    .padding(.top, 1)
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                Image(systemName: "cloud.bolt.rain.fill")
                    .foregroundStyle(.yellow)
            } compactTrailing: {
                StormArrivalCountdown(state: context.state, compact: true, suffix: "m")
            } minimal: {
                Image(systemName: "cloud.bolt.fill")
                    .foregroundStyle(.yellow)
            }
            .widgetURL(context.attributes.deepLink)
            .keylineTint(.yellow)
        }
    }
}

struct NearcastStormActivityLockView: View {
    let context: ActivityViewContext<NearcastStormActivityAttributes>

    var body: some View {
        ZStack {
            StormActivityBackdrop(severity: context.state.severityLevel)
            StormActivityPathVisual(state: context.state)
                .padding(.horizontal, 18)
                .padding(.top, 46)
                .padding(.bottom, 46)
            StormActivityTextScrim()

            VStack(alignment: .leading, spacing: 11) {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("StormScope")
                            .font(.system(size: 10, weight: .black, design: .rounded))
                            .tracking(1.5)
                            .textCase(.uppercase)
                            .foregroundStyle(.cyan.opacity(0.82))
                            .lineLimit(1)
                        Text(lockTitle)
                            .font(.system(size: 18, weight: .black, design: .rounded))
                            .lineLimit(2)
                            .minimumScaleFactor(0.72)
                        Text(lockDetail)
                            .font(.system(size: 12, weight: .heavy, design: .rounded))
                            .foregroundStyle(.white.opacity(0.78))
                            .lineLimit(2)
                            .minimumScaleFactor(0.72)
                    }

                    Spacer(minLength: 14)

                    VStack(alignment: .trailing, spacing: 0) {
                        StormArrivalCountdown(state: context.state)
                            .lineLimit(1)
                            .minimumScaleFactor(0.70)
                        Text(context.state.arrivalDate == nil ? "min" : "until arrival")
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundStyle(.white.opacity(0.72))
                        Text(context.isStale ? "Update delayed" : context.state.confidence)
                            .font(.system(size: 10, weight: .black, design: .rounded))
                            .foregroundStyle(confidenceColor)
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                        if !geometryLabel.isEmpty {
                            Text(geometryLabel)
                                .font(.system(size: 8, weight: .black, design: .rounded))
                                .foregroundStyle(.white.opacity(0.48))
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                        }
                    }
                }

                Spacer(minLength: 18)

                HStack(spacing: 8) {
                    StormFactPill(label: "Confidence", value: context.state.confidence, tone: confidenceColor)
                    StormFactPill(label: middleFactLabel, value: middleFactValue, tone: .white.opacity(0.92))
                    StormFactPill(label: "Updated", value: updatedText, tone: .white.opacity(0.92))
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 20)
        }
        .foregroundStyle(.white)
        .frame(minHeight: 170)
    }

    private var lockTitle: String {
        let status = context.state.status.trimmingCharacters(in: .whitespacesAndNewlines)
        if !status.isEmpty { return status }
        return "Storm tracking toward \(cityName(context.attributes.placeName))"
    }

    private var lockDetail: String {
        let detail = context.state.detail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !detail.isEmpty { return detail }
        return "Nearcast is watching this storm path."
    }

    private var confidenceColor: Color {
        if let value = context.state.confidenceValue {
            if value >= 0.72 { return .yellow }
            if value >= 0.45 { return .cyan.opacity(0.88) }
            return .white.opacity(0.76)
        }
        let confidence = context.state.confidence.lowercased()
        if confidence.contains("likely") || confidence.contains("sample") { return .yellow }
        if confidence.contains("possible") || confidence.contains("watch") { return .cyan.opacity(0.88) }
        return .white.opacity(0.86)
    }

    private var updatedText: String {
        let age = max(0, Date().timeIntervalSince(context.state.updatedDate))
        if age < 90 { return "Just now" }
        return "\(Int(age / 60))m ago"
    }

    private var middleFactLabel: String {
        rainChanceText == nil ? "Place" : "Rain"
    }

    private var middleFactValue: String {
        rainChanceText ?? cityName(context.attributes.placeName)
    }

    private var rainChanceText: String? {
        if let rainChance = context.state.rainChance {
            return "\(rainChance)%"
        }
        let tokens = lockDetail
            .replacingOccurrences(of: ",", with: " ")
            .replacingOccurrences(of: ".", with: " ")
            .split(separator: " ")
        for token in tokens.reversed() where token.contains("%") {
            let digits = token.filter(\.isNumber)
            if !digits.isEmpty { return "\(digits)%" }
        }
        return nil
    }

    private var geometryLabel: String {
        switch context.state.geometryQuality?.lowercased() {
        case "tracked", "radar":
            return "Tracked path"
        case "forecast":
            return "Forecast path"
        case "approx", "estimated", "sample":
            return "Approx path"
        default:
            return ""
        }
    }
}

struct StormArrivalCountdown: View {
    let state: NearcastStormActivityAttributes.ContentState
    var compact = false
    var suffix = ""

    var body: some View {
        Group {
            if let arrival = state.arrivalDate, arrival > Date() {
                Text(timerInterval: Date()...arrival, countsDown: true, showsHours: false)
            } else if state.etaMinutes <= 0 {
                Text("Now")
            } else {
                Text("\(state.etaMinutes)\(suffix)")
            }
        }
        .font(.system(size: compact ? 23 : 41, weight: .black, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.68)
    }
}

struct StormActivityBackdrop: View {
    let severity: Int

    var body: some View {
        LinearGradient(
            colors: [
                Color(red: 0.02, green: 0.05, blue: 0.10),
                severity >= 3 ? Color(red: 0.13, green: 0.07, blue: 0.08) : Color(red: 0.04, green: 0.10, blue: 0.17),
                Color(red: 0.02, green: 0.07, blue: 0.10)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topLeading) {
            Circle()
                .fill(.cyan.opacity(0.16))
                .frame(width: 180, height: 180)
                .blur(radius: 42)
                .offset(x: -46, y: -68)
        }
        .overlay(alignment: .bottomTrailing) {
            Circle()
                .fill((severity >= 2 ? Color.orange : Color.yellow).opacity(0.10))
                .frame(width: 150, height: 150)
                .blur(radius: 46)
                .offset(x: 50, y: 34)
        }
    }
}

struct StormActivityTextScrim: View {
    var body: some View {
        LinearGradient(
            colors: [
                .black.opacity(0.62),
                .black.opacity(0.34),
                .black.opacity(0.48)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(.white.opacity(0.06))
                .frame(width: 170, height: 170)
                .blur(radius: 54)
                .offset(x: 34, y: -82)
        }
    }
}

struct StormActivityPathVisual: View {
    let state: NearcastStormActivityAttributes.ContentState

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height

            ZStack {
                ZStack {
                    StormBlob(severity: state.severityLevel)
                        .frame(width: width * 0.58, height: height * 0.68)
                        .rotationEffect(.degrees(-16))
                        .offset(x: -width * 0.30, y: height * 0.07)

                    StormBlob(severity: max(1, state.severityLevel - 1))
                        .frame(width: width * 0.34, height: height * 0.42)
                        .rotationEffect(.degrees(20))
                        .opacity(0.46)
                        .offset(x: -width * 0.02, y: -height * 0.19)

                    StormPathCone()
                        .fill(pathFill)
                        .overlay {
                            StormPathCone()
                                .stroke(pathStroke, lineWidth: state.pathStrokeWidth)
                        }
                        .frame(width: width * state.coneWidthScale, height: height * 0.58)
                        .offset(x: width * 0.09, y: height * 0.06)

                    Image(systemName: "arrow.right")
                        .font(.system(size: 30, weight: .black))
                        .foregroundStyle(.white.opacity(state.motionDegrees == nil ? 0.24 : state.isApproximateGeometry ? 0.38 : 0.56))
                        .offset(x: -width * 0.04, y: height * 0.08)

                    Circle()
                        .fill(.white.opacity(0.92))
                        .frame(width: 12, height: 12)
                        .shadow(color: .white.opacity(0.34), radius: 7)
                        .overlay {
                            Circle()
                                .stroke(placeRingColor, lineWidth: state.placeRingWidth)
                        }
                        .offset(x: width * 0.28, y: height * 0.08)
                }
                .rotationEffect(.degrees(state.motionRotationDegrees))
                .offset(x: state.motionDegrees == nil ? 0 : width * 0.02, y: 0)
                .opacity(state.visualOpacity)
                .blur(radius: state.isApproximateGeometry ? 1.2 : 0.4)

                if state.motionDegrees == nil {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(.white.opacity(0.18), lineWidth: 1)
                        .frame(width: width * 0.52, height: height * 0.46)
                        .offset(x: width * 0.10, y: height * 0.08)
                }
            }
            .frame(width: width, height: height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var pathFill: Color {
        if state.motionDegrees == nil { return .white.opacity(0.045) }
        let base = state.isApproximateGeometry ? 0.045 : 0.070
        return .cyan.opacity(base + min(0.045, state.confidenceScore * 0.045))
    }

    private var pathStroke: Color {
        if state.motionDegrees == nil { return .white.opacity(0.16) }
        let base = state.isApproximateGeometry ? 0.18 : 0.26
        return .white.opacity(base + min(0.14, state.confidenceScore * 0.14))
    }

    private var placeRingColor: Color {
        if state.etaMinutes <= 5 { return .red.opacity(state.isApproximateGeometry ? 0.18 : 0.26) }
        if state.etaMinutes <= 20 { return .yellow.opacity(state.isApproximateGeometry ? 0.18 : 0.25) }
        return .white.opacity(state.isApproximateGeometry ? 0.13 : 0.20)
    }
}

struct StormBlob: View {
    let severity: Int

    var body: some View {
        ZStack {
            Capsule()
                .fill(baseColor.opacity(0.48))
                .blur(radius: 9)
            Capsule()
                .fill(baseColor.opacity(0.34))
                .scaleEffect(x: 0.82, y: 0.74)
                .offset(x: 8, y: -4)
                .blur(radius: 12)
            Capsule()
                .fill(coreColor.opacity(0.38))
                .scaleEffect(x: 0.52, y: 0.48)
                .offset(x: 6, y: -2)
                .blur(radius: 11)
            Capsule()
                .fill(hotColor.opacity(severity >= 2 ? 0.34 : 0.16))
                .scaleEffect(x: 0.32, y: 0.30)
                .offset(x: -6, y: 2)
                .blur(radius: 10)
        }
        .shadow(color: baseColor.opacity(0.12), radius: 22)
    }

    private var baseColor: Color {
        severity >= 3 ? Color(red: 0.18, green: 0.72, blue: 0.50) : Color(red: 0.22, green: 0.70, blue: 0.86)
    }

    private var coreColor: Color {
        severity >= 2 ? Color(red: 0.98, green: 0.75, blue: 0.28) : Color(red: 0.30, green: 0.78, blue: 0.58)
    }

    private var hotColor: Color {
        severity >= 4 ? Color(red: 0.78, green: 0.34, blue: 0.92) : Color(red: 0.95, green: 0.36, blue: 0.28)
    }
}

struct StormPathCone: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.06, y: rect.midY))
        path.addCurve(
            to: CGPoint(x: rect.maxX * 0.95, y: rect.minY + rect.height * 0.14),
            control1: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.minY + rect.height * 0.08),
            control2: CGPoint(x: rect.minX + rect.width * 0.70, y: rect.minY - rect.height * 0.03)
        )
        path.addCurve(
            to: CGPoint(x: rect.maxX * 0.92, y: rect.maxY * 0.85),
            control1: CGPoint(x: rect.maxX + rect.width * 0.10, y: rect.minY + rect.height * 0.40),
            control2: CGPoint(x: rect.maxX + rect.width * 0.04, y: rect.minY + rect.height * 0.70)
        )
        path.addCurve(
            to: CGPoint(x: rect.minX + rect.width * 0.06, y: rect.midY),
            control1: CGPoint(x: rect.minX + rect.width * 0.66, y: rect.maxY + rect.height * 0.02),
            control2: CGPoint(x: rect.minX + rect.width * 0.32, y: rect.maxY * 0.88)
        )
        path.closeSubpath()
        return path
    }
}

extension NearcastStormActivityAttributes.ContentState {
    var arrivalDate: Date? {
        guard let arrivalAtEpoch, arrivalAtEpoch > 0 else { return nil }
        return Date(timeIntervalSince1970: arrivalAtEpoch)
    }

    var updatedDate: Date {
        if let updatedAtEpoch, updatedAtEpoch > 0 { return Date(timeIntervalSince1970: updatedAtEpoch) }
        return updatedAt ?? Date.distantPast
    }

    var severityLevel: Int {
        max(0, min(4, severity ?? inferredSeverity))
    }

    var confidenceScore: Double {
        if let confidenceValue { return max(0, min(1, confidenceValue)) }
        let lower = confidence.lowercased()
        if lower.contains("likely") || lower.contains("sample") { return 0.78 }
        if lower.contains("possible") || lower.contains("watch") { return 0.52 }
        return 0.38
    }

    var motionRotationDegrees: Double {
        guard let motionDegrees else { return -10 }
        return motionDegrees - 90
    }

    var coneWidthScale: Double {
        let spread = 0.54 - confidenceScore * 0.18
        return max(0.36, min(0.56, spread))
    }

    var pathStrokeWidth: Double {
        motionDegrees == nil ? 1.5 : 1.8 + confidenceScore * 1.2
    }

    var placeRingWidth: Double {
        etaMinutes <= 5 ? 12 : 8 + confidenceScore * 4
    }

    var isApproximateGeometry: Bool {
        guard let geometryQuality else { return true }
        let quality = geometryQuality.lowercased()
        return quality == "approx" || quality == "estimated" || quality == "sample" || quality == "forecast"
    }

    var geometryQualityLabel: String {
        switch geometryQuality?.lowercased() {
        case "tracked", "radar":
            return "Tracked path"
        case "forecast":
            return "Forecast path"
        case "approx", "estimated", "sample":
            return "Approx path"
        default:
            return "Storm watch"
        }
    }

    var confidenceAccent: Color {
        if let confidenceValue {
            if confidenceValue >= 0.72 { return .yellow }
            if confidenceValue >= 0.45 { return .cyan.opacity(0.88) }
            return .white.opacity(0.78)
        }
        let lower = confidence.lowercased()
        if lower.contains("likely") || lower.contains("sample") { return .yellow }
        if lower.contains("possible") || lower.contains("watch") { return .cyan.opacity(0.88) }
        return .white.opacity(0.82)
    }

    var visualOpacity: Double {
        guard let geometryQuality else { return 0.42 }
        switch geometryQuality.lowercased() {
        case "tracked", "radar":
            return 0.70
        case "forecast":
            return 0.52
        case "approx", "estimated", "sample":
            return 0.44
        default:
            return 0.42
        }
    }

    private var inferredSeverity: Int {
        let lower = "\(status) \(detail)".lowercased()
        if lower.contains("severe") { return 4 }
        if lower.contains("thunder") || lower.contains("storm") { return 3 }
        if (rainChance ?? 0) >= 75 { return 2 }
        return 1
    }
}

struct StormFactPill: View {
    let label: String
    let value: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 7.5, weight: .black, design: .rounded))
                .foregroundStyle(.white.opacity(0.54))
                .lineLimit(1)
            Text(value)
                .font(.system(size: 10.5, weight: .black, design: .rounded))
                .foregroundStyle(tone)
                .lineLimit(1)
                .minimumScaleFactor(0.66)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct NearcastWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearcastWidgetEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                NearcastSmallWidget(snapshot: entry.snapshot)
            case .systemLarge:
                NearcastLargeWidget(snapshot: entry.snapshot)
            case .accessoryCircular:
                NearcastCircularAccessory(snapshot: entry.snapshot)
            case .accessoryRectangular:
                NearcastRectangularAccessory(snapshot: entry.snapshot)
            case .accessoryInline:
                NearcastInlineAccessory(snapshot: entry.snapshot)
            default:
                NearcastMediumWidget(snapshot: entry.snapshot)
            }
        }
        .foregroundStyle(widgetPalette(entry.snapshot).primary)
    }
}

struct WidgetPalette {
    let primary: Color
    let secondary: Color
    let muted: Color
    let subtle: Color
    let surface: Color
    let surfaceStrong: Color
    let surfaceSoft: Color
    let stroke: Color
}

private enum WidgetText {
    // Home Screen widgets should summarize before they drop into micro text.
    static let minScale: CGFloat = 0.88
    static let tinyScale: CGFloat = 0.92

    static let eyebrow = Font.system(size: 13, weight: .black, design: .rounded)
    static let caption = Font.system(size: 14, weight: .heavy, design: .rounded)
    static let body = Font.system(size: 16, weight: .black, design: .rounded)
    static let bodyLarge = Font.system(size: 19, weight: .black, design: .rounded)
    static let rowValue = Font.system(size: 18, weight: .black, design: .rounded)
    static let metricLabel = Font.system(size: 13, weight: .black, design: .rounded)
    static let metricValue = Font.system(size: 34, weight: .black, design: .rounded)
}

private struct MediumSignalSpec: Identifiable {
    let id: String
    let label: String
    let value: String
    let tone: Color
}

private enum LargeMetricKind {
    case feels
    case rain
    case wind
    case uv
}

private struct LargeMetricSpec: Identifiable {
    let id: String
    let kind: LargeMetricKind
    let label: String
    let value: String
    let tone: Color?
}

private enum LargeWidgetDensity {
    case compact
    case regular

    init(size: CGSize) {
        self = size.height < 410 || size.width < 360 ? .compact : .regular
    }

    var isCompact: Bool { self == .compact }
    var outerHorizontalPadding: CGFloat { isCompact ? 16 : 20 }
    var outerTopPadding: CGFloat { isCompact ? 14 : 22 }
    var outerBottomPadding: CGFloat { isCompact ? 14 : 24 }
    var sectionSpacing: CGFloat { isCompact ? 6 : 8 }
    var placeFont: Font { .system(size: isCompact ? 17 : 19, weight: .black, design: .rounded) }
    var headlineFont: Font { .system(size: isCompact ? 24 : 28, weight: .black, design: .rounded) }
    var temperatureFont: Font { .system(size: isCompact ? 40 : 45, weight: .black, design: .rounded) }
    var timelineLimit: Int { isCompact ? 4 : 5 }
}

private func widgetPalette(_ snapshot: NearcastWidgetSnapshot) -> WidgetPalette {
    if snapshot.isDay {
        return WidgetPalette(
            primary: .black.opacity(0.84),
            secondary: .black.opacity(0.62),
            muted: .black.opacity(0.48),
            subtle: .black.opacity(0.36),
            surface: .white.opacity(0.28),
            surfaceStrong: .white.opacity(0.34),
            surfaceSoft: .white.opacity(0.20),
            stroke: .white.opacity(0.22)
        )
    }
    return WidgetPalette(
        primary: .white.opacity(0.94),
        secondary: .white.opacity(0.72),
        muted: .white.opacity(0.56),
        subtle: .white.opacity(0.40),
        surface: .white.opacity(0.15),
        surfaceStrong: .white.opacity(0.20),
        surfaceSoft: .white.opacity(0.10),
        stroke: .white.opacity(0.16)
    )
}

struct NearcastCircularAccessory: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: watchSymbol(snapshot))
                .font(.system(size: 15, weight: .black))
                .widgetAccentable()
                .accessibilityHidden(true)
            Text("\(snapshot.temperature)°")
                .font(.system(size: 20, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(watchStatus(snapshot))
                .font(.system(size: 8, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.55)
        }
        .containerBackground(.clear, for: .widget)
        .accessibilityLabel("\(watchStatus(snapshot)), \(snapshot.temperature) degrees")
    }
}

struct NearcastRectangularAccessory: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        HStack(alignment: .center, spacing: 7) {
            Image(systemName: watchSymbol(snapshot))
                .font(.system(size: 16, weight: .black))
                .widgetAccentable()
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(watchStatus(snapshot))
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.62)
                Text(watchDetail(snapshot))
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Spacer(minLength: 0)
            Text("\(snapshot.temperature)°")
                .font(.system(size: 20, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .containerBackground(.clear, for: .widget)
        .accessibilityLabel("\(watchStatus(snapshot)), \(watchDetail(snapshot)), \(snapshot.temperature) degrees")
    }
}

struct NearcastInlineAccessory: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        Text("\(watchStatus(snapshot)) · \(snapshot.temperature)°")
            .widgetAccentable()
    }
}

struct NearcastSmallWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        let palette = widgetPalette(snapshot)
        VStack(alignment: .leading, spacing: 5) {
            Text(cityName(snapshot.placeName))
                .font(.system(size: 18, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.84)

            Spacer(minLength: 0)

            Text("\(snapshot.temperature)°")
                .font(.system(size: 54, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity, alignment: .leading)

            SmallHighLowLine(snapshot: snapshot, palette: palette)

            Text(widgetConditionTitle(snapshot))
                .font(.system(size: 22, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.82)

            MiniPill(text: smallWidgetChip(snapshot), tone: smallWidgetChipTone(snapshot), palette: palette)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.top, 23)
        .padding(.horizontal, 22)
        .padding(.bottom, 22)
    }
}

struct SmallHighLowLine: View {
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette

    var body: some View {
        if let high = snapshot.high, let low = snapshot.low {
            HStack(spacing: 9) {
                Text("H \(high)°")
                    .foregroundStyle(palette.primary.opacity(0.88))
                Text("L \(low)°")
                    .foregroundStyle(palette.secondary)
            }
            .font(.system(size: 14, weight: .black, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(WidgetText.minScale)
            .padding(.top, -5)
        } else {
            EmptyView()
        }
    }
}

struct NearcastMediumWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        let palette = widgetPalette(snapshot)
        let rows = mediumSignalRows(snapshot, palette: palette)
        GeometryReader { proxy in
            let contentWidth = max(0, proxy.size.width - 40)
            let leftWidth = min(170, max(138, contentWidth * 0.45))
            let rightWidth = max(128, contentWidth - leftWidth - 10)

            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(shortPlaceName(snapshot.placeName))
                        .font(.system(size: 18, weight: .black, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .foregroundStyle(palette.secondary)

                    Text("\(snapshot.temperature)°")
                        .font(.system(size: 52, weight: .black, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    Text(widgetConditionTitle(snapshot))
                        .font(.system(size: 21, weight: .black, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    Text(mediumMetaText(snapshot))
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .foregroundStyle(palette.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
                .frame(width: leftWidth, alignment: .leading)

                VStack(spacing: 10) {
                    ForEach(rows) { row in
                        SignalRow(label: row.label, value: row.value, tone: row.tone, palette: palette)
                    }
                }
                .frame(width: rightWidth)
            }
            .padding(.top, 20)
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
        }
    }
}

struct NearcastLargeWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        GeometryReader { proxy in
            let density = LargeWidgetDensity(size: proxy.size)
            NearcastLargeWidgetContent(snapshot: snapshot, density: density)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
    }
}

private struct NearcastLargeWidgetContent: View {
    let snapshot: NearcastWidgetSnapshot
    let density: LargeWidgetDensity

    var body: some View {
        let palette = widgetPalette(snapshot)
        let focus = nextFocus(snapshot)
        let metrics = largeMetricSpecs(snapshot, focus: focus)
        VStack(alignment: .leading, spacing: density.sectionSpacing) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shortPlaceName(snapshot.placeName))
                        .font(density.placeFont)
                        .foregroundStyle(palette.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.84)
                    Text(largeWidgetHeadline(snapshot, focus: focus))
                        .font(density.headlineFont)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(snapshot.temperature)°")
                        .font(density.temperatureFont)
                        .lineLimit(1)
                        .minimumScaleFactor(WidgetText.minScale)
                    if let high = snapshot.high, let low = snapshot.low {
                        Text("H \(high)°  L \(low)°")
                            .font(density.isCompact ? WidgetText.caption : WidgetText.body)
                            .foregroundStyle(palette.secondary)
                            .lineLimit(1)
                    }
                }
            }

            NextWeatherPanel(snapshot: snapshot, focus: focus, palette: palette, density: density)

            if hasPlanSummary(snapshot) {
                PlanSummaryStrip(snapshot: snapshot, palette: palette, compact: density.isCompact)
            }

            HStack(spacing: density.sectionSpacing) {
                ForEach(metrics) { metric in
                    LargeMetricTile(metric: metric, snapshot: snapshot, palette: palette, compact: density.isCompact)
                }
            }

            if !density.isCompact, isWidgetSnapshotStale(snapshot) {
                Text(freshnessText(snapshot))
                    .font(WidgetText.eyebrow)
                    .foregroundStyle(palette.subtle)
                    .lineLimit(1)
            }
        }
        .padding(.top, density.outerTopPadding)
        .padding(.horizontal, density.outerHorizontalPadding)
        .padding(.bottom, density.outerBottomPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MiniPill: View {
    let text: String
    var tone: Color? = nil
    let palette: WidgetPalette

    var body: some View {
        Text(text)
            .font(WidgetText.eyebrow)
            .foregroundStyle(palette.primary.opacity(0.92))
            .lineLimit(1)
            .minimumScaleFactor(WidgetText.tinyScale)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background((tone ?? palette.primary).opacity(tone == nil ? 0.0 : 0.12), in: Capsule())
            .background(palette.surfaceStrong, in: Capsule())
    }
}

struct PlanSummaryStrip: View {
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette
    var compact = false

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: planSymbol(snapshot))
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(planToneColor(snapshot))
                .frame(width: 24, height: 24)
                .background(planToneColor(snapshot).opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text([snapshot.planLabel, snapshot.planTitle].compactMap(cleanOptional).joined(separator: " · "))
                        .font(WidgetText.body)
                        .foregroundStyle(palette.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(WidgetText.minScale)
                    if let place = cleanOptional(snapshot.planPlace) {
                        Text(cityName(place))
                            .font(WidgetText.eyebrow)
                            .lineLimit(1)
                            .minimumScaleFactor(WidgetText.tinyScale)
                            .foregroundStyle(planToneColor(snapshot).opacity(0.88))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(planToneColor(snapshot).opacity(0.13), in: Capsule())
                    }
                }
                Text(cleanOptional(snapshot.planDetail) ?? "Plan checked against the forecast.")
                    .font(WidgetText.caption)
                    .foregroundStyle(palette.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(WidgetText.minScale)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, compact ? 8 : 10)
        .padding(.vertical, compact ? 5 : 7)
        .background(planSurfaceColor(snapshot), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(planStrokeColor(snapshot), lineWidth: 1)
        )
    }
}

enum WidgetNextFocus {
    case rain
    case wind
    case sun
    case quiet
}

private struct NextWeatherPanel: View {
    let snapshot: NearcastWidgetSnapshot
    let focus: WidgetNextFocus
    let palette: WidgetPalette
    let density: LargeWidgetDensity

    var body: some View {
        VStack(alignment: .leading, spacing: density.isCompact ? 4 : 7) {
            HStack(alignment: .center, spacing: density.isCompact ? 8 : 10) {
                Image(systemName: nextFocusSymbol(focus, snapshot: snapshot))
                    .font(.system(size: density.isCompact ? 18 : 20, weight: .black))
                    .foregroundStyle(nextFocusColor(focus, snapshot: snapshot))
                    .frame(width: density.isCompact ? 29 : 33, height: density.isCompact ? 29 : 33)
                    .background(nextFocusColor(focus, snapshot: snapshot).opacity(snapshot.isDay ? 0.14 : 0.22), in: Circle())

                VStack(alignment: .leading, spacing: 1) {
                    Text(nextFocusTitle(focus, snapshot: snapshot))
                        .font(density.isCompact ? WidgetText.body : WidgetText.bodyLarge)
                        .foregroundStyle(palette.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.84)
                    Text(nextFocusDetail(focus, snapshot: snapshot))
                        .font(density.isCompact ? WidgetText.caption : WidgetText.body)
                        .foregroundStyle(palette.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
                Spacer(minLength: 0)
            }

            if let rows = snapshot.timeline, !rows.isEmpty {
                WidgetTimelineStrip(
                    rows: Array(rows.prefix(density.timelineLimit)),
                    focus: focus,
                    snapshot: snapshot,
                    palette: palette,
                    compact: density.isCompact
                )
            } else {
                HStack(spacing: 6) {
                    MiniPill(text: compactSignalValue(snapshot.nowValue), palette: palette)
                    MiniPill(text: compactSignalValue(snapshot.nextValue), tone: signalColor(snapshot.nextValue), palette: palette)
                    MiniPill(text: compactSignalValue(snapshot.laterValue), palette: palette)
                }
            }
        }
        .padding(.horizontal, density.isCompact ? 8 : 10)
        .padding(.vertical, density.isCompact ? 5 : 8)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(palette.stroke, lineWidth: 1)
        )
    }
}

struct WidgetTimelineStrip: View {
    let rows: [NearcastWidgetHour]
    let focus: WidgetNextFocus
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette
    let compact: Bool

    var body: some View {
        if focus == .rain {
            RainTimelineStrip(rows: rows, snapshot: snapshot, palette: palette, compact: compact)
        } else if focus == .sun {
            UvTimelineStrip(rows: rows, snapshot: snapshot, palette: palette)
        } else {
            SummaryTimelineStrip(rows: rows, focus: focus, snapshot: snapshot, palette: palette)
        }
    }
}

struct RainTimelineStrip: View {
    let rows: [NearcastWidgetHour]
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette
    let compact: Bool

    var body: some View {
        let displayRows = normalizedRainTimelineRows(rows)
        let peak = peakTimelinePoint(rows: displayRows, focus: .rain, snapshot: snapshot)
        ZStack(alignment: .bottom) {
            Capsule()
                .fill(palette.stroke.opacity(snapshot.isDay ? 0.72 : 0.55))
                .frame(height: 2)
                .padding(.horizontal, 12)
                .offset(y: -19)

            HStack(alignment: .bottom, spacing: 0) {
                ForEach(Array(displayRows.enumerated()), id: \.offset) { index, row in
                    RainTimelinePoint(
                        row: row,
                        label: rainTimelineDisplayLabel(index),
                        snapshot: snapshot,
                        palette: palette,
                        isPeak: row.id == peak.row?.id && displayRows.count > 1
                    )
                    .frame(maxWidth: .infinity, alignment: .bottom)
                }
            }
        }
        .frame(height: compact ? 52 : 58, alignment: .bottom)
    }
}

struct RainTimelinePoint: View {
    let row: NearcastWidgetHour
    let label: String
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette
    let isPeak: Bool

    var body: some View {
        let value = timelineMetricValue(row: row, focus: .rain, snapshot: snapshot)
        let color = timelineColor(row: row, focus: .rain, snapshot: snapshot)
        VStack(spacing: 3) {
            Text("\(value)%")
                .font(WidgetText.eyebrow)
                .foregroundStyle(isPeak ? palette.primary.opacity(0.96) : palette.secondary)
                .lineLimit(1)
                .minimumScaleFactor(WidgetText.tinyScale)

            Capsule()
                .fill(
                    LinearGradient(
                        colors: [color.opacity(0.48), color],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: isPeak ? 13 : 11, height: rainTimelineHeight(value))
                .overlay(alignment: .top) {
                    if isPeak {
                        Capsule()
                            .fill(color.opacity(0.96))
                            .frame(width: 18, height: 5)
                            .offset(y: -4)
                    }
                }

            Text(label)
                .font(WidgetText.eyebrow)
                .foregroundStyle(isPeak ? palette.primary.opacity(0.88) : palette.secondary)
                .lineLimit(1)
                .minimumScaleFactor(WidgetText.tinyScale)
        }
    }
}

struct SummaryTimelineStrip: View {
    let rows: [NearcastWidgetHour]
    let focus: WidgetNextFocus
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette

    var body: some View {
        let peak = peakTimelinePoint(rows: rows, focus: focus, snapshot: snapshot)
        VStack(spacing: 3) {
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(rows) { row in
                    let value = timelineMetricValue(row: row, focus: focus, snapshot: snapshot)
                    SummaryTimelineMark(
                        row: row,
                        focus: focus,
                        snapshot: snapshot,
                        palette: palette,
                        isPeak: row.id == peak.row?.id && rows.count > 1
                    )
                    .frame(maxWidth: .infinity, alignment: .bottom)
                    .accessibilityLabel("\(row.timeLabel) \(timelineDisplayValue(value, focus: focus, snapshot: snapshot))")
                }
            }
            .frame(height: 40, alignment: .bottom)

            HStack {
                if let first = rows.first {
                    Text(timelineAnchorText(label: "Now", row: first, focus: focus, snapshot: snapshot))
                }
                Spacer(minLength: 8)
                Text(timelinePeakText(peak: peak, focus: focus, snapshot: snapshot))
                Spacer(minLength: 8)
                if let last = rows.last {
                    Text(timelineAnchorText(label: last.timeLabel, row: last, focus: focus, snapshot: snapshot))
                }
            }
            .font(WidgetText.eyebrow)
            .foregroundStyle(palette.secondary)
            .lineLimit(1)
            .minimumScaleFactor(WidgetText.tinyScale)
        }
    }
}

struct SummaryTimelineMark: View {
    let row: NearcastWidgetHour
    let focus: WidgetNextFocus
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette
    let isPeak: Bool

    var body: some View {
        let color = timelineColor(row: row, focus: focus, snapshot: snapshot)
        if focus == .quiet, let code = row.conditionCode {
            Image(systemName: conditionSymbol(code: code, isDay: row.isDay ?? snapshot.isDay))
                .font(.system(size: isPeak ? 20 : 17, weight: .black))
                .foregroundStyle(color)
                .frame(height: 32, alignment: .bottom)
        } else {
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [color.opacity(0.45), color],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(
                    width: isPeak ? summaryTimelineWidth(focus) + 3 : summaryTimelineWidth(focus),
                    height: summaryTimelineHeight(row: row, focus: focus, snapshot: snapshot)
                )
                .overlay(alignment: .top) {
                    if isPeak {
                        Capsule()
                            .fill(color.opacity(0.95))
                            .frame(width: summaryTimelineWidth(focus) + 5, height: 5)
                            .offset(y: -4)
                    }
                }
                .frame(height: 38, alignment: .bottom)
        }
    }
}

struct UvTimelineStrip: View {
    let rows: [NearcastWidgetHour]
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette

    var body: some View {
        let peak = peakUvHour(snapshot)
        let first = rows.first
        VStack(spacing: 3) {
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(rows) { row in
                    let value = row.uv ?? snapshot.uv
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [
                                    uvToneColor(value).opacity(snapshot.isDay ? 0.56 : 0.46),
                                    uvToneColor(value)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: value == peak.value ? 16 : 13, height: uvPillarHeight(value))
                        .overlay(alignment: .top) {
                            if value == peak.value {
                                Capsule()
                                    .fill(uvToneColor(value).opacity(0.94))
                                    .frame(width: 18, height: 5)
                                    .offset(y: -4)
                            }
                        }
                    .frame(maxWidth: .infinity, alignment: .bottom)
                }
            }
            .frame(height: 42, alignment: .bottom)

            HStack {
                Text("Now \(first?.uv ?? snapshot.uv)")
                Spacer(minLength: 8)
                Text("Peak \(peak.value) \(peak.timeLabel)")
                Spacer(minLength: 8)
                if let last = rows.last {
                    Text("\(last.timeLabel) \(last.uv ?? snapshot.uv)")
                }
            }
            .font(WidgetText.eyebrow)
            .foregroundStyle(palette.secondary)
            .lineLimit(1)
            .minimumScaleFactor(WidgetText.tinyScale)
        }
    }

    private func uvPillarHeight(_ value: Int) -> CGFloat {
        max(14, min(36, 12 + CGFloat(value) * 2.8))
    }
}

struct SignalRow: View {
    let label: String
    let value: String
    let tone: Color
    let palette: WidgetPalette

    var body: some View {
        HStack(spacing: 7) {
            Text(compactSignalLabel(label))
                .font(WidgetText.eyebrow)
                .tracking(0.4)
                .foregroundStyle(tone.opacity(0.75))
                .lineLimit(1)
                .minimumScaleFactor(WidgetText.tinyScale)
                .frame(width: 42, alignment: .leading)
            Text(value)
                .font(.system(size: 17, weight: .black, design: .rounded))
                .foregroundStyle(palette.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.80)
                .layoutPriority(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 11)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct LargeMetricTile: View {
    let metric: LargeMetricSpec
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(metric.label.uppercased())
                .font(WidgetText.metricLabel)
                .tracking(0.5)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
            Spacer(minLength: 8)
            switch metric.kind {
            case .wind:
                HStack(alignment: .center, spacing: compact ? 6 : 8) {
                    Text(metric.value)
                        .font(.system(size: compact ? 30 : 34, weight: .black, design: .rounded))
                        .foregroundStyle(palette.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.86)
                        .fixedSize(horizontal: true, vertical: false)
                        .layoutPriority(3)
                    Spacer(minLength: 0)
                    if let direction = snapshot.windDirection {
                        Image(systemName: "arrow.up")
                            .font(.system(size: compact ? 14 : 16, weight: .black))
                            .foregroundStyle(palette.primary)
                            .rotationEffect(.degrees(Double((direction + 180) % 360)))
                            .frame(width: compact ? 28 : 32, height: compact ? 28 : 32)
                            .background(palette.surfaceStrong, in: Circle())
                    }
                }
            case .uv:
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(metric.value)
                        .font(.system(size: compact ? 30 : 34, weight: .black, design: .rounded))
                        .foregroundStyle(palette.primary)
                        .lineLimit(1)
                    Text(uvRiskLabel(snapshot.uv))
                        .font(WidgetText.body)
                        .foregroundStyle(uvRiskForeground(snapshot.uv, palette: palette))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
            default:
                Text(metric.value)
                    .font(.system(size: compact ? 30 : 34, weight: .black, design: .rounded))
                    .foregroundStyle(palette.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.86)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: compact ? 58 : 72, maxHeight: compact ? 58 : 72, alignment: .topLeading)
        .padding(compact ? 8 : 10)
        .background(metricSurface(metric, palette: palette), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(metricStroke(metric, palette: palette), lineWidth: 1)
        )
        .accessibilityLabel(metricAccessibility(metric, snapshot: snapshot))
    }
}

struct MetricTile: View {
    let label: String
    let value: String
    var detail: String? = nil
    let palette: WidgetPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased())
                .font(WidgetText.metricLabel)
                .tracking(0.5)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
            Spacer(minLength: 7)
            Text(value)
                .font(WidgetText.metricValue)
                .foregroundStyle(palette.primary)
                .lineLimit(1)
                .minimumScaleFactor(WidgetText.minScale)
            if let detail = cleanOptional(detail) {
                Text(detail)
                    .font(WidgetText.caption)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(WidgetText.minScale)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 78, maxHeight: 78, alignment: .topLeading)
        .padding(10)
        .background(palette.surfaceSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct WindMetricTile: View {
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WIND")
                .font(WidgetText.metricLabel)
                .tracking(0.5)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
            Spacer(minLength: 7)
            HStack(alignment: .center, spacing: 6) {
                Text("\(snapshot.wind)")
                    .font(WidgetText.metricValue)
                    .foregroundStyle(palette.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(WidgetText.minScale)
                    .fixedSize(horizontal: true, vertical: false)
                    .layoutPriority(3)
                Spacer(minLength: 0)
                if let direction = snapshot.windDirection {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(palette.primary)
                        .rotationEffect(.degrees(Double((direction + 180) % 360)))
                        .frame(width: 27, height: 27)
                        .background(palette.surfaceStrong, in: Circle())
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 78, maxHeight: 78, alignment: .topLeading)
        .padding(10)
        .background(palette.surfaceSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct UvMetricTile: View {
    let value: Int
    let palette: WidgetPalette

    var body: some View {
        let color = uvToneColor(value)
        VStack(alignment: .leading, spacing: 0) {
            Text("UV")
                .font(WidgetText.metricLabel)
                .tracking(0.5)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
            Spacer(minLength: 7)
            HStack(spacing: 5) {
                Text("\(value)")
                    .font(WidgetText.metricValue)
                    .foregroundStyle(palette.primary)
                    .lineLimit(1)
                Text(uvRiskLabel(value))
                    .font(WidgetText.caption)
                    .foregroundStyle(uvRiskForeground(value, palette: palette))
                    .lineLimit(1)
                    .minimumScaleFactor(WidgetText.minScale)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 78, maxHeight: 78, alignment: .topLeading)
        .padding(10)
        .background(uvSurfaceColor(value), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(color.opacity(0.26), lineWidth: 1)
        )
    }
}

struct NearcastWidgetBackdrop: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        let solarMoment = widgetSolarMoment(snapshot)
        LinearGradient(
            colors: backdropColors(snapshot, solarMoment: solarMoment),
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay {
            let accent = placeAccentColor(snapshot)
            RadialGradient(
                colors: [accent.opacity(snapshot.isDay ? 0.24 : 0.18), .clear],
                center: .bottomTrailing,
                startRadius: 0,
                endRadius: 190
            )
        }
        .overlay {
            if solarMoment != .none {
                SolarGlow(moment: solarMoment, isDay: snapshot.isDay)
            }
        }
        .overlay(alignment: .topTrailing) {
            if snapshot.isDay {
                Circle()
                    .fill(solarMoment == .none ? .white.opacity(0.28) : Color(red: 1.0, green: 0.76, blue: 0.34).opacity(0.30))
                    .blur(radius: solarMoment == .none ? 16 : 18)
                    .frame(width: solarMoment == .none ? 96 : 116, height: solarMoment == .none ? 96 : 116)
                    .offset(x: solarMoment == .none ? 24 : 18, y: solarMoment == .none ? -28 : -34)
            } else {
                ZStack {
                    Circle().fill(.white.opacity(0.62)).frame(width: 54, height: 54)
                    Circle().fill(.black.opacity(0.22)).frame(width: 52, height: 52).offset(x: 16, y: -8)
                }
                .blur(radius: 0.4)
                .offset(x: 16, y: -20)
            }
        }
        .overlay {
            LinearGradient(
                colors: [.white.opacity(snapshot.isDay ? 0.25 : 0.05), .clear, .black.opacity(snapshot.isDay ? 0.03 : 0.18)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }
}

enum WidgetSolarMoment {
    case none
    case sunrise
    case sunset
}

struct SolarGlow: View {
    let moment: WidgetSolarMoment
    let isDay: Bool

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 1.0, green: 0.58, blue: 0.28).opacity(isDay ? 0.34 : 0.22),
                    Color(red: 1.0, green: 0.82, blue: 0.54).opacity(isDay ? 0.22 : 0.14),
                    .clear
                ],
                startPoint: moment == .sunrise ? .bottomLeading : .topLeading,
                endPoint: .topTrailing
            )
            RadialGradient(
                colors: [
                    Color(red: 1.0, green: 0.72, blue: 0.30).opacity(isDay ? 0.44 : 0.30),
                    Color(red: 1.0, green: 0.47, blue: 0.28).opacity(isDay ? 0.20 : 0.14),
                    .clear
                ],
                center: moment == .sunrise ? .topLeading : .bottomTrailing,
                startRadius: 8,
                endRadius: 220
            )
        }
        .blendMode(isDay ? .softLight : .screen)
    }
}

private func widgetConditionTitle(_ snapshot: NearcastWidgetSnapshot) -> String {
    let condition = snapshot.condition.trimmingCharacters(in: .whitespacesAndNewlines)
    if condition.count <= 18 { return condition }
    if condition.lowercased().contains("thunder") { return "Storms" }
    if condition.lowercased().contains("partly") { return "Partly cloudy" }
    return citySafePhrase(condition, maxCharacters: 18)
}

private func smallWidgetChip(_ snapshot: NearcastWidgetSnapshot) -> String {
    let focus = nextFocus(snapshot)
    switch focus {
    case .rain:
        let peak = peakRainHour(snapshot)
        if peak.isStorm {
            return compactTimeSuffix(peak.timeLabel).map { "Storm \($0)" } ?? "Storms"
        }
        if peak.value >= 20 {
            return compactTimeSuffix(peak.timeLabel).map { "Rain \($0)" } ?? "Rain \(peak.value)%"
        }
        return "Rain nearby"
    case .wind:
        let peak = peakWindHour(snapshot)
        return "Gust \(peak.value)"
    case .sun:
        return "UV \(peakUvHour(snapshot).value)"
    case .quiet:
        if snapshot.feelsLike != snapshot.temperature {
            return "Feels \(snapshot.feelsLike)°"
        }
        return compactSignalValue(snapshot.nextValue)
    }
}

private func smallWidgetChipTone(_ snapshot: NearcastWidgetSnapshot) -> Color? {
    switch nextFocus(snapshot) {
    case .rain:
        return rainAccentColor(snapshot)
    case .wind:
        return signalColor("gust")
    case .sun:
        return uvToneColor(snapshot.uv)
    case .quiet:
        return signalColor(snapshot.nextValue)
    }
}

private func mediumSignalRows(_ snapshot: NearcastWidgetSnapshot, palette: WidgetPalette) -> [MediumSignalSpec] {
    let focus = nextFocus(snapshot)
    let first = MediumSignalSpec(
        id: "now",
        label: "Now",
        value: mediumNowValue(snapshot),
        tone: palette.primary
    )
    let second = MediumSignalSpec(
        id: "next",
        label: focus == .quiet ? "Next" : focusLabel(focus),
        value: mediumFocusValue(snapshot, focus: focus),
        tone: nextFocusColor(focus, snapshot: snapshot)
    )
    return [first, second]
}

private func mediumNowValue(_ snapshot: NearcastWidgetSnapshot) -> String {
    if snapshot.feelsLike != snapshot.temperature {
        return "Feels \(snapshot.feelsLike)°"
    }
    if snapshot.rainChance >= 20 { return "Rain \(snapshot.rainChance)%" }
    return widgetConditionTitle(snapshot)
}

private func focusLabel(_ focus: WidgetNextFocus) -> String {
    switch focus {
    case .rain:
        return "Rain"
    case .wind:
        return "Wind"
    case .sun:
        return "UV"
    case .quiet:
        return "Next"
    }
}

private func mediumFocusValue(_ snapshot: NearcastWidgetSnapshot, focus: WidgetNextFocus) -> String {
    switch focus {
    case .rain:
        let peak = peakRainHour(snapshot)
        if peak.isStorm {
            return compactTimeSuffix(peak.timeLabel).map { "Storm \($0)" } ?? "Storms"
        }
        return compactTimeSuffix(peak.timeLabel).map { "Rain \($0)" } ?? "Rain \(peak.value)%"
    case .wind:
        return "Gust \(peakWindHour(snapshot).value)"
    case .sun:
        let peak = peakUvHour(snapshot)
        return "UV \(peak.value)"
    case .quiet:
        return compactSignalValue(snapshot.nextValue)
    }
}

private func largeWidgetHeadline(_ snapshot: NearcastWidgetSnapshot, focus: WidgetNextFocus) -> String {
    switch focus {
    case .rain:
        let peak = peakRainHour(snapshot)
        if peak.isStorm {
            return compactTimeSuffix(peak.timeLabel).map { "Storms \($0)" } ?? "Storms nearby"
        }
        if peak.value >= 20 {
            return compactTimeSuffix(peak.timeLabel).map { "Rain \($0)" } ?? "Rain nearby"
        }
        return "Rain nearby"
    case .wind:
        return "Gusts \(peakWindHour(snapshot).value)"
    case .sun:
        return "UV \(uvRiskLabel(peakUvHour(snapshot).value))"
    case .quiet:
        return primarySignal(snapshot)
    }
}

private func largeMetricSpecs(_ snapshot: NearcastWidgetSnapshot, focus: WidgetNextFocus) -> [LargeMetricSpec] {
    var specs: [LargeMetricSpec] = [
        LargeMetricSpec(id: "feels", kind: .feels, label: "Feels", value: "\(snapshot.feelsLike)°", tone: nil)
    ]

    if focus != .rain {
        specs.append(LargeMetricSpec(id: "rain", kind: .rain, label: "Rain", value: "\(snapshot.rainChance)%", tone: rainAccentColor(snapshot)))
    }
    if focus != .wind {
        specs.append(LargeMetricSpec(id: "wind", kind: .wind, label: "Wind", value: "\(snapshot.wind)", tone: signalColor("wind")))
    }
    if focus != .sun {
        specs.append(LargeMetricSpec(id: "uv", kind: .uv, label: "UV", value: "\(snapshot.uv)", tone: uvToneColor(snapshot.uv)))
    }
    if specs.count < 3 {
        if !specs.contains(where: { $0.id == "rain" }) {
            specs.append(LargeMetricSpec(id: "rain", kind: .rain, label: "Rain", value: "\(snapshot.rainChance)%", tone: rainAccentColor(snapshot)))
        } else if !specs.contains(where: { $0.id == "wind" }) {
            specs.append(LargeMetricSpec(id: "wind", kind: .wind, label: "Wind", value: "\(snapshot.wind)", tone: signalColor("wind")))
        } else if !specs.contains(where: { $0.id == "uv" }) {
            specs.append(LargeMetricSpec(id: "uv", kind: .uv, label: "UV", value: "\(snapshot.uv)", tone: uvToneColor(snapshot.uv)))
        }
    }
    return Array(specs.prefix(3))
}

private func metricSurface(_ metric: LargeMetricSpec, palette: WidgetPalette) -> Color {
    guard let tone = metric.tone else { return palette.surfaceSoft }
    return tone.opacity(metric.kind == .uv ? 0.24 : 0.11)
}

private func metricStroke(_ metric: LargeMetricSpec, palette: WidgetPalette) -> Color {
    guard let tone = metric.tone else { return .clear }
    return tone.opacity(metric.kind == .uv ? 0.28 : 0.12)
}

private func metricAccessibility(_ metric: LargeMetricSpec, snapshot: NearcastWidgetSnapshot) -> String {
    switch metric.kind {
    case .wind:
        return "Wind \(snapshot.wind) \(snapshot.windUnit)"
    case .uv:
        return "UV \(snapshot.uv), \(uvRiskLabel(snapshot.uv))"
    default:
        return "\(metric.label) \(metric.value)"
    }
}

private func primarySignal(_ snapshot: NearcastWidgetSnapshot) -> String {
    let next = snapshot.nextValue.lowercased()
    let now = snapshot.nowValue.lowercased()
    if next.contains("rain") || next.contains("storm") { return compactSignalValue(snapshot.nextValue) }
    if now.contains("rain") || now.contains("snow") || now.contains("storm") { return compactSignalValue(snapshot.nowValue) }
    if snapshot.feelsLike >= 95 { return "Serious heat" }
    if snapshot.feelsLike <= 32 { return "Freezing" }
    return widgetConditionTitle(snapshot)
}

private func watchStatus(_ snapshot: NearcastWidgetSnapshot) -> String {
    if let status = cleanOptional(snapshot.watchStatus) { return status }
    if let label = cleanOptional(snapshot.planLabel), label != "Watching" { return label }
    if snapshot.nextValue.lowercased().contains("rain") { return compactSignalValue(snapshot.nextValue) }
    if snapshot.nowValue.lowercased().contains("rain") { return compactSignalValue(snapshot.nowValue) }
    if snapshot.feelsLike >= 95 { return "Plan around heat" }
    if snapshot.feelsLike <= 32 { return "Freezing" }
    return "Looks good"
}

private func watchDetail(_ snapshot: NearcastWidgetSnapshot) -> String {
    if let detail = cleanOptional(snapshot.watchDetail) { return detail }
    if let detail = cleanOptional(snapshot.planDetail) { return detail }
    return "\(cityName(snapshot.placeName)) · \(compactSignalValue(snapshot.nextValue))"
}

private func watchSymbol(_ snapshot: NearcastWidgetSnapshot) -> String {
    let tone = cleanOptional(snapshot.watchTone)?.lowercased() ?? cleanOptional(snapshot.planTone)?.lowercased() ?? ""
    switch tone {
    case "watch", "caution":
        return "exclamationmark.triangle.fill"
    case "changed":
        return "bell.badge.fill"
    case "good":
        return "checkmark.circle.fill"
    default:
        let lower = "\(snapshot.nowValue) \(snapshot.nextValue) \(snapshot.condition)".lowercased()
        if lower.contains("storm") { return "cloud.bolt.rain.fill" }
        if lower.contains("rain") { return "cloud.rain.fill" }
        if snapshot.feelsLike >= 95 { return "thermometer.sun.fill" }
        return conditionSymbol(snapshot)
    }
}

private func cityName(_ value: String) -> String {
    let city = value
        .split(separator: ",", maxSplits: 1)
        .first
        .map { String($0) } ?? value
    let trimmed = city.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? value : trimmed
}

private func shortPlaceName(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count <= 20 { return trimmed }
    return cityName(trimmed)
}

private func citySafePhrase(_ value: String, maxCharacters: Int) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count > maxCharacters else { return trimmed }
    if let beforeDash = trimmed.split(separator: "-", maxSplits: 1).first {
        let candidate = beforeDash.trimmingCharacters(in: .whitespacesAndNewlines)
        if !candidate.isEmpty, candidate.count <= maxCharacters { return candidate }
    }
    let words = trimmed.split(separator: " ")
    var result = ""
    for word in words {
        let next = result.isEmpty ? String(word) : "\(result) \(word)"
        if next.count > maxCharacters { break }
        result = next
    }
    return result.isEmpty ? String(trimmed.prefix(maxCharacters)) : result
}

private func cleanOptional(_ value: String?) -> String? {
    let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func highLowText(_ snapshot: NearcastWidgetSnapshot) -> String? {
    guard let high = snapshot.high, let low = snapshot.low else { return nil }
    return "H\(high) L\(low)"
}

private func mediumMetaText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let feels = "Feels \(snapshot.feelsLike)°"
    let wind = windSummary(snapshot, includeDirection: false).replacingOccurrences(of: "Wind ", with: "")
    return "\(feels) · \(wind)"
}

private func windSummary(_ snapshot: NearcastWidgetSnapshot, includeDirection: Bool) -> String {
    let base = "\(snapshot.wind) \(snapshot.windUnit)"
    guard includeDirection, let label = cleanOptional(snapshot.windLabel) else { return "Wind \(base)" }
    return "Wind \(base) \(label)"
}

private func hasPlanSummary(_ snapshot: NearcastWidgetSnapshot) -> Bool {
    cleanOptional(snapshot.planTitle) != nil || cleanOptional(snapshot.planDetail) != nil
}

private func uvRiskLabel(_ value: Int) -> String {
    if value >= 11 { return "Extreme" }
    if value >= 8 { return "Very high" }
    if value >= 6 { return "High" }
    if value >= 3 { return "Moderate" }
    return "Low"
}

private func uvToneColor(_ value: Int) -> Color {
    if value >= 8 { return Color(red: 0.80, green: 0.18, blue: 0.16) }
    if value >= 6 { return Color(red: 0.88, green: 0.55, blue: 0.10) }
    if value >= 3 { return Color(red: 0.78, green: 0.62, blue: 0.12) }
    return Color(red: 0.15, green: 0.50, blue: 0.32)
}

private func uvSurfaceColor(_ value: Int) -> Color {
    uvToneColor(value).opacity(value >= 6 ? 0.24 : 0.16)
}

private func uvRiskForeground(_ value: Int, palette: WidgetPalette) -> Color {
    if value >= 6 {
        return palette.primary.opacity(0.82)
    }
    return uvToneColor(value).opacity(0.95)
}

private func planToneColor(_ snapshot: NearcastWidgetSnapshot) -> Color {
    switch cleanOptional(snapshot.planTone)?.lowercased() {
    case "watch", "caution":
        return Color(red: 0.78, green: 0.33, blue: 0.28)
    case "changed":
        return Color(red: 0.29, green: 0.43, blue: 0.82)
    case "good":
        return Color(red: 0.14, green: 0.48, blue: 0.34)
    default:
        return Color(red: 0.22, green: 0.35, blue: 0.55)
    }
}

private func planSurfaceColor(_ snapshot: NearcastWidgetSnapshot) -> Color {
    planToneColor(snapshot).opacity(snapshot.isDay ? 0.10 : 0.20)
}

private func planStrokeColor(_ snapshot: NearcastWidgetSnapshot) -> Color {
    planToneColor(snapshot).opacity(snapshot.isDay ? 0.18 : 0.34)
}

private func planSymbol(_ snapshot: NearcastWidgetSnapshot) -> String {
    switch cleanOptional(snapshot.planTone)?.lowercased() {
    case "watch", "caution":
        return "exclamationmark.triangle.fill"
    case "good":
        return "checkmark.circle.fill"
    default:
        return "calendar.badge.clock"
    }
}

private func freshnessText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let saved = Date(timeIntervalSince1970: snapshot.savedAt)
    let minutes = max(0, Int(Date().timeIntervalSince(saved) / 60))
    if minutes < 1 { return "Updated just now" }
    if minutes < 60 { return "Updated \(minutes)m ago" }
    let hours = max(1, minutes / 60)
    return "Updated \(hours)h ago"
}

private func compactSignalLabel(_ value: String) -> String {
    let upper = value.uppercased()
    if upper.contains("LATER") { return "LATER" }
    if upper.contains("NEXT") { return "NEXT" }
    if upper.contains("NOW") { return "NOW" }
    return String(upper.prefix(5))
}

private func compactSignalValue(_ value: String) -> String {
    var text = value
        .replacingOccurrences(of: "°F", with: "°")
        .replacingOccurrences(of: ":00 PM", with: "p", options: .caseInsensitive)
        .replacingOccurrences(of: ":00 AM", with: "a", options: .caseInsensitive)
        .replacingOccurrences(of: " PM", with: "p", options: .caseInsensitive)
        .replacingOccurrences(of: " AM", with: "a", options: .caseInsensitive)
        .replacingOccurrences(of: "next 2 hours", with: "2h", options: .caseInsensitive)
        .replacingOccurrences(of: "next two hours", with: "2h", options: .caseInsensitive)
        .trimmingCharacters(in: .whitespacesAndNewlines)

    let lower = text.lowercased()
    if let feelsRange = text.range(of: "feels ", options: .caseInsensitive) {
        let suffix = text[feelsRange.lowerBound...]
        if lower.contains("comfortable") || lower.contains("hot") || lower.contains("cold") || lower.contains("cool") || lower.contains("warm") {
            return String(suffix).capitalized
        }
    }
    if lower.hasPrefix("hot - feels") {
        text = text.replacingOccurrences(of: "Hot - feels", with: "Feels", options: .caseInsensitive)
    }
    if lower.hasPrefix("dangerously hot - feels") {
        text = text.replacingOccurrences(of: "Dangerously hot - feels", with: "Feels", options: .caseInsensitive)
    }
    if lower.hasPrefix("dry ") {
        text = text.replacingOccurrences(of: "Dry next", with: "Dry", options: .caseInsensitive)
    }
    if lower.contains("rain near") {
        return compactTimeSuffix(text).map { "Rain \($0)" } ?? "Rain nearby"
    }
    if lower.contains("rain nearby") {
        return "Rain nearby"
    }
    if lower.hasPrefix("low ") && lower.contains(" overnight") {
        return text.replacingOccurrences(of: " overnight", with: "", options: .caseInsensitive)
    }
    if lower.contains("thunderstorm") {
        return "Storms possible"
    }
    if lower.contains("sunset") {
        return text.replacingOccurrences(of: "Sunset ", with: "Sunset ", options: .caseInsensitive)
    }
    return text
}

private func compactTimeSuffix(_ value: String) -> String? {
    let separators = CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters.subtracting(CharacterSet(charactersIn: ":")))
    let tokens = value
        .lowercased()
        .components(separatedBy: separators)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    for token in tokens.reversed() {
        if token == "now" { return "now" }
        guard let suffix = token.last, suffix == "p" || suffix == "a" else { continue }
        let core = String(token.dropLast())
        if let hour = Int(core), (1...12).contains(hour) {
            return "\(hour)\(suffix)"
        }
        let pieces = core.split(separator: ":")
        if let first = pieces.first, let hour = Int(first), (1...12).contains(hour) {
            return "\(hour)\(suffix)"
        }
    }
    return nil
}

private func nextFocus(_ snapshot: NearcastWidgetSnapshot) -> WidgetNextFocus {
    let rows = snapshot.timeline ?? []
    let maxRain = rows.compactMap(\.rainChance).max() ?? snapshot.rainChance
    let maxWind = rows.compactMap { $0.windGust ?? $0.wind }.max() ?? snapshot.wind
    let hasStorm = rows.contains { row in
        guard let code = row.conditionCode else { return false }
        return (95...99).contains(code)
    }
    let nextText = "\(snapshot.nextValue) \(snapshot.nowValue)".lowercased()
    if hasStorm || maxRain >= 35 || nextText.contains("rain") || nextText.contains("storm") {
        return .rain
    }
    if maxWind >= max(24, snapshot.wind + 8) || snapshot.laterValue.lowercased().contains("gust") {
        return .wind
    }
    if snapshot.isDay && snapshot.uv >= 6 {
        return .sun
    }
    return .quiet
}

private func nextFocusTitle(_ focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> String {
    switch focus {
    case .rain:
        let peak = peakRainHour(snapshot)
        if peak.isStorm {
            return compactTimeSuffix(peak.timeLabel).map { "Storms near \($0)" } ?? "Storms nearby"
        }
        if peak.value >= 35 {
            return compactTimeSuffix(peak.timeLabel).map { "Rain near \($0)" } ?? "Rain nearby"
        }
        return "Rain nearby"
    case .wind:
        let peak = peakWindHour(snapshot)
        return "Gusts \(peak.value)"
    case .sun:
        let peak = peakUvHour(snapshot)
        return "UV \(uvRiskLabel(peak.value))"
    case .quiet:
        return compactSignalValue(snapshot.nextValue)
    }
}

private func nextFocusDetail(_ focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> String {
    switch focus {
    case .rain:
        let peak = peakRainHour(snapshot)
        if let time = compactTimeSuffix(peak.timeLabel), peak.value >= 35 {
            return "Peak \(peak.value)% around \(time)"
        }
        return "Peak \(peak.value)% in the next few hours"
    case .wind:
        let peak = peakWindHour(snapshot)
        return compactTimeSuffix(peak.timeLabel).map { "Strongest around \($0)" } ?? "Strongest wind nearby"
    case .sun:
        let peak = peakUvHour(snapshot)
        return compactTimeSuffix(peak.timeLabel).map { "Peak UV \(peak.value) near \($0)" } ?? "Peak UV \(peak.value) today"
    case .quiet:
        if let highLow = highLowText(snapshot) { return "\(highLow) · \(windSummary(snapshot, includeDirection: false))" }
        return windSummary(snapshot, includeDirection: false)
    }
}

private func nextFocusSymbol(_ focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> String {
    switch focus {
    case .rain:
        return peakRainHour(snapshot).isStorm ? "cloud.bolt.rain.fill" : "cloud.rain.fill"
    case .wind:
        return "wind"
    case .sun:
        return "sun.max.fill"
    case .quiet:
        return conditionSymbol(snapshot)
    }
}

private func nextFocusColor(_ focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> Color {
    switch focus {
    case .rain:
        return rainAccentColor(snapshot)
    case .wind:
        return Color(red: 0.45, green: 0.44, blue: 0.82)
    case .sun:
        return uvToneColor(snapshot.uv)
    case .quiet:
        return snapshot.isDay ? Color(red: 0.92, green: 0.56, blue: 0.10) : Color(red: 0.58, green: 0.72, blue: 0.94)
    }
}

private func rainAccentColor(_ snapshot: NearcastWidgetSnapshot) -> Color {
    snapshot.isDay
        ? Color(red: 0.16, green: 0.45, blue: 0.86)
        : Color(red: 0.48, green: 0.76, blue: 1.00)
}

private func rainTimelineColor(chance: Int, snapshot: NearcastWidgetSnapshot) -> Color {
    if snapshot.isDay {
        if chance >= 70 { return Color(red: 0.08, green: 0.31, blue: 0.78) }
        if chance >= 40 { return Color(red: 0.12, green: 0.52, blue: 0.86) }
        return Color(red: 0.40, green: 0.68, blue: 0.90)
    }
    if chance >= 70 { return Color(red: 0.42, green: 0.72, blue: 1.00) }
    if chance >= 40 { return Color(red: 0.34, green: 0.68, blue: 0.98) }
    return Color(red: 0.62, green: 0.84, blue: 1.00)
}

private func peakRainHour(_ snapshot: NearcastWidgetSnapshot) -> (value: Int, timeLabel: String, isStorm: Bool) {
    let rows = snapshot.timeline ?? []
    let best = rows.max { lhs, rhs in
        (lhs.rainChance ?? -1) < (rhs.rainChance ?? -1)
    }
    let value = best?.rainChance ?? snapshot.rainChance
    let label = best?.offsetHours == 0 ? "Now" : best?.timeLabel ?? "soon"
    let storm = best?.conditionCode.map { (95...99).contains($0) } ?? (snapshot.conditionCode >= 95)
    return (value, label, storm)
}

private func peakWindHour(_ snapshot: NearcastWidgetSnapshot) -> (value: Int, timeLabel: String) {
    let rows = snapshot.timeline ?? []
    let best = rows.max { lhs, rhs in
        (lhs.windGust ?? lhs.wind ?? -1) < (rhs.windGust ?? rhs.wind ?? -1)
    }
    let value = best?.windGust ?? best?.wind ?? snapshot.wind
    let label = best?.offsetHours == 0 ? "Now" : best?.timeLabel ?? "soon"
    return (value, label)
}

private func peakUvHour(_ snapshot: NearcastWidgetSnapshot) -> (value: Int, timeLabel: String) {
    let rows = snapshot.timeline ?? []
    let best = rows.max { lhs, rhs in
        (lhs.uv ?? -1) < (rhs.uv ?? -1)
    }
    let value = best?.uv ?? snapshot.uv
    let label = best?.offsetHours == 0 ? "Now" : best?.timeLabel ?? "soon"
    return (value, label)
}

private func timelineMetricValue(row: NearcastWidgetHour, focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> Int {
    switch focus {
    case .rain:
        return row.rainChance ?? snapshot.rainChance
    case .wind:
        return row.windGust ?? row.wind ?? snapshot.wind
    case .sun:
        return row.uv ?? snapshot.uv
    case .quiet:
        return row.temperature ?? snapshot.temperature
    }
}

private func timelineDisplayValue(_ value: Int, focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> String {
    switch focus {
    case .rain:
        return "\(value)%"
    case .wind:
        return "\(value)"
    case .sun:
        return "\(value)"
    case .quiet:
        return "\(value)°"
    }
}

private func timelineAnchorText(label: String, row: NearcastWidgetHour, focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> String {
    "\(label) \(timelineDisplayValue(timelineMetricValue(row: row, focus: focus, snapshot: snapshot), focus: focus, snapshot: snapshot))"
}

private func timelinePeakText(peak: (value: Int, timeLabel: String, row: NearcastWidgetHour?), focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> String {
    switch focus {
    case .rain:
        return "Peak \(peak.value)% \(peak.timeLabel)"
    case .wind:
        return "Peak \(peak.value) \(peak.timeLabel)"
    case .sun:
        return "Peak \(peak.value) \(peak.timeLabel)"
    case .quiet:
        return "High \(peak.value)° \(peak.timeLabel)"
    }
}

private func peakTimelinePoint(rows: [NearcastWidgetHour], focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> (value: Int, timeLabel: String, row: NearcastWidgetHour?) {
    let best = rows.max { lhs, rhs in
        timelineMetricValue(row: lhs, focus: focus, snapshot: snapshot) < timelineMetricValue(row: rhs, focus: focus, snapshot: snapshot)
    }
    let value = best.map { timelineMetricValue(row: $0, focus: focus, snapshot: snapshot) } ?? snapshotMetricValue(focus: focus, snapshot: snapshot)
    let label = best?.offsetHours == 0 ? "Now" : best?.timeLabel ?? "soon"
    return (value, label, best)
}

private func snapshotMetricValue(focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> Int {
    switch focus {
    case .rain:
        return snapshot.rainChance
    case .wind:
        return snapshot.wind
    case .sun:
        return snapshot.uv
    case .quiet:
        return snapshot.temperature
    }
}

private func summaryTimelineWidth(_ focus: WidgetNextFocus) -> CGFloat {
    switch focus {
    case .rain:
        return 14
    case .wind, .sun:
        return 13
    case .quiet:
        return 14
    }
}

private func relativeTimelineLabel(_ row: NearcastWidgetHour) -> String {
    row.offsetHours == 0 ? "Now" : "+\(row.offsetHours)h"
}

private func rainTimelineDisplayLabel(_ index: Int) -> String {
    index == 0 ? "Now" : "+\(index)h"
}

private func normalizedRainTimelineRows(_ rows: [NearcastWidgetHour]) -> [NearcastWidgetHour] {
    Array(rows.prefix(5))
}

private func rainTimelineHeight(_ value: Int) -> CGFloat {
    max(11, min(32, 9 + CGFloat(value) * 0.32))
}

private func summaryTimelineHeight(row: NearcastWidgetHour, focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> CGFloat {
    switch focus {
    case .rain:
        let value = CGFloat(row.rainChance ?? snapshot.rainChance)
        return max(11, min(34, 10 + value * 0.20))
    case .wind:
        let value = CGFloat(row.windGust ?? row.wind ?? snapshot.wind)
        return max(12, min(36, 8 + value * 0.85))
    case .sun:
        let value = CGFloat(row.uv ?? snapshot.uv)
        return max(12, min(36, 10 + value * 2.4))
    case .quiet:
        return 22
    }
}

private func timelineColor(row: NearcastWidgetHour, focus: WidgetNextFocus, snapshot: NearcastWidgetSnapshot) -> Color {
    switch focus {
    case .rain:
        if let code = row.conditionCode, (95...99).contains(code) {
            return Color(red: 0.93, green: 0.68, blue: 0.10)
        }
        let chance = row.rainChance ?? snapshot.rainChance
        return rainTimelineColor(chance: chance, snapshot: snapshot)
    case .wind:
        return Color(red: 0.45, green: 0.44, blue: 0.82)
    case .sun:
        return uvToneColor(row.uv ?? snapshot.uv)
    case .quiet:
        if let code = row.conditionCode, (51...82).contains(code) { return Color(red: 0.18, green: 0.48, blue: 0.82) }
        return (row.isDay ?? snapshot.isDay)
            ? Color(red: 0.92, green: 0.56, blue: 0.10)
            : Color(red: 0.58, green: 0.72, blue: 0.94)
    }
}

private func isWidgetSnapshotStale(_ snapshot: NearcastWidgetSnapshot) -> Bool {
    snapshot.age > 90 * 60
}

private func conditionSymbol(_ snapshot: NearcastWidgetSnapshot) -> String {
    conditionSymbol(code: snapshot.conditionCode, isDay: snapshot.isDay)
}

private func conditionSymbol(code: Int, isDay: Bool) -> String {
    if (95...99).contains(code) { return "cloud.bolt.rain.fill" }
    if (71...86).contains(code) { return "snowflake" }
    if (51...67).contains(code) || (80...82).contains(code) { return "cloud.rain.fill" }
    if !isDay { return "moon.stars.fill" }
    if (1...3).contains(code) { return "cloud.sun.fill" }
    return "sun.max.fill"
}

private func smallConditionSymbol(_ snapshot: NearcastWidgetSnapshot) -> String? {
    let code = snapshot.conditionCode
    if (95...99).contains(code) { return "cloud.bolt.rain.fill" }
    if (71...86).contains(code) { return "snowflake" }
    if (51...67).contains(code) || (80...82).contains(code) { return "cloud.rain.fill" }
    return nil
}

private func signalColor(_ value: String) -> Color {
    let lower = value.lowercased()
    if lower.contains("storm") || lower.contains("rain") { return Color(red: 0.18, green: 0.42, blue: 0.82) }
    if lower.contains("dry") { return Color(red: 0.12, green: 0.48, blue: 0.34) }
    if lower.contains("gust") || lower.contains("wind") { return Color(red: 0.38, green: 0.39, blue: 0.72) }
    return .primary
}

private func widgetSolarMoment(_ snapshot: NearcastWidgetSnapshot, now: Date = Date()) -> WidgetSolarMoment {
    let nowTime = now.timeIntervalSince1970
    let window: TimeInterval = 90 * 60
    if let sunriseAt = snapshot.sunriseAt, abs(nowTime - sunriseAt) <= window {
        return .sunrise
    }
    if let sunsetAt = snapshot.sunsetAt, abs(nowTime - sunsetAt) <= window {
        return .sunset
    }
    return .none
}

private func backdropColors(_ snapshot: NearcastWidgetSnapshot, solarMoment: WidgetSolarMoment = .none) -> [Color] {
    let code = snapshot.conditionCode
    let stormy = code >= 95
    let wet = (51...82).contains(code)
    let snowy = (71...86).contains(code)
    let hot = snapshot.feelsLike >= 95
    if !snapshot.isDay {
        if solarMoment == .sunrise {
            return [Color(red: 0.13, green: 0.12, blue: 0.22), Color(red: 0.55, green: 0.36, blue: 0.35), Color(red: 0.04, green: 0.07, blue: 0.13)]
        }
        if solarMoment == .sunset {
            return [Color(red: 0.08, green: 0.08, blue: 0.16), Color(red: 0.42, green: 0.24, blue: 0.29), Color(red: 0.02, green: 0.04, blue: 0.09)]
        }
        if wet || stormy { return [Color(red: 0.06, green: 0.10, blue: 0.18), Color(red: 0.15, green: 0.22, blue: 0.36), Color(red: 0.03, green: 0.05, blue: 0.10)] }
        return [Color(red: 0.03, green: 0.06, blue: 0.13), Color(red: 0.10, green: 0.15, blue: 0.27), Color(red: 0.02, green: 0.03, blue: 0.08)]
    }
    if solarMoment == .sunrise {
        return [Color(red: 1.0, green: 0.78, blue: 0.54), Color(red: 0.74, green: 0.88, blue: 0.98), Color(red: 1.0, green: 0.91, blue: 0.58)]
    }
    if solarMoment == .sunset {
        return [Color(red: 1.0, green: 0.67, blue: 0.45), Color(red: 0.76, green: 0.80, blue: 0.92), Color(red: 1.0, green: 0.84, blue: 0.52)]
    }
    if stormy { return [Color(red: 0.74, green: 0.80, blue: 0.90), Color(red: 0.42, green: 0.53, blue: 0.68), Color(red: 0.95, green: 0.78, blue: 0.38)] }
    if wet { return [Color(red: 0.75, green: 0.88, blue: 0.96), Color(red: 0.54, green: 0.71, blue: 0.86), Color(red: 0.28, green: 0.48, blue: 0.68)] }
    if snowy { return [Color(red: 0.92, green: 0.97, blue: 1.0), Color(red: 0.75, green: 0.84, blue: 0.93), Color(red: 0.64, green: 0.74, blue: 0.86)] }
    if hot { return [Color(red: 1.0, green: 0.89, blue: 0.50), Color(red: 0.96, green: 0.62, blue: 0.33), Color(red: 0.55, green: 0.78, blue: 0.96)] }
    return [Color(red: 0.74, green: 0.90, blue: 1.0), Color(red: 0.58, green: 0.80, blue: 0.96), Color(red: 0.98, green: 0.88, blue: 0.55)]
}

private func placeAccentColor(_ snapshot: NearcastWidgetSnapshot) -> Color {
    let hue = stableHue(snapshot.placeName)
    return Color(hue: hue, saturation: snapshot.isDay ? 0.36 : 0.46, brightness: snapshot.isDay ? 0.96 : 0.56)
}

private func stableHue(_ value: String) -> Double {
    var hash: UInt32 = 2166136261
    for byte in value.utf8 {
        hash ^= UInt32(byte)
        hash = hash &* 16777619
    }
    return Double(hash % 360) / 360.0
}
