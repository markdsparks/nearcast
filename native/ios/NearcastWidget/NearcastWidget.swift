import Foundation
import SwiftUI
import WidgetKit

private let nearcastWidgetSuiteName = "group.app.nearcast.ios"
private let nearcastWidgetSnapshotKey = "nearcast.widget.snapshot.v1"
private let nearcastWidgetPlaceKey = "nearcast.widget.place.v1"
private let nearcastWidgetStaleInterval: TimeInterval = 25 * 60

struct NearcastWidgetSnapshot: Codable {
    var version: Int
    var savedAt: TimeInterval
    var placeName: String
    var temperature: Int
    var feelsLike: Int
    var high: Int?
    var low: Int?
    var condition: String
    var conditionCode: Int
    var isDay: Bool
    var rainChance: Int
    var wind: Int
    var windUnit: String
    var windDirection: Int?
    var windLabel: String?
    var uv: Int
    var nowLabel: String
    var nowValue: String
    var nextLabel: String
    var nextValue: String
    var laterLabel: String
    var laterValue: String
    var planTitle: String?
    var planLabel: String?
    var planDetail: String?
    var planPlace: String?
    var planTone: String?
}

struct NearcastWidgetPlace: Codable {
    var name: String
    var latitude: Double
    var longitude: Double
}

extension NearcastWidgetSnapshot {
    static let fallback = NearcastWidgetSnapshot(
        version: 2,
        savedAt: Date().timeIntervalSince1970,
        placeName: "Nearcast",
        temperature: 82,
        feelsLike: 84,
        high: nil,
        low: nil,
        condition: "Weather that matters",
        conditionCode: 1,
        isDay: true,
        rainChance: 0,
        wind: 5,
        windUnit: "mph",
        windDirection: nil,
        windLabel: nil,
        uv: 4,
        nowLabel: "Now",
        nowValue: "Open Nearcast",
        nextLabel: "Next",
        nextValue: "Load a place",
        laterLabel: "Later",
        laterValue: "Plans stay visible",
        planTitle: nil,
        planLabel: nil,
        planDetail: nil,
        planPlace: nil,
        planTone: nil
    )

    static func current() -> NearcastWidgetSnapshot {
        stored() ?? fallback
    }

    static func stored() -> NearcastWidgetSnapshot? {
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetSnapshotKey),
            let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data)
        else {
            return nil
        }
        return snapshot
    }

    var age: TimeInterval {
        Date().timeIntervalSince1970 - savedAt
    }
}

extension NearcastWidgetPlace {
    static func stored() -> NearcastWidgetPlace? {
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetPlaceKey),
            let place = try? JSONDecoder().decode(NearcastWidgetPlace.self, from: data)
        else {
            return nil
        }
        return place
    }
}

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

enum NearcastWidgetSnapshotStore {
    static func save(_ snapshot: NearcastWidgetSnapshot) {
        guard let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
              let data = try? JSONEncoder().encode(snapshot) else {
            return
        }
        defaults.set(data, forKey: nearcastWidgetSnapshotKey)
    }
}

enum NearcastWidgetForecastClient {
    static func fetchSnapshot(for place: NearcastWidgetPlace, fallback: NearcastWidgetSnapshot) async throws -> NearcastWidgetSnapshot {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.5f", place.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.5f", place.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day"),
            URLQueryItem(name: "hourly", value: "precipitation_probability,uv_index"),
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

        return NearcastWidgetSnapshot(
            version: max(fallback.version, 2),
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
            planTone: fallback.planTone
        )
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
        let precipitationProbability: [Double?]?
        let uvIndex: [Double?]?

        enum CodingKeys: String, CodingKey {
            case time
            case precipitationProbability = "precipitation_probability"
            case uvIndex = "uv_index"
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
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else { return nil }
        return self[index]
    }
}

@main
struct NearcastWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NearcastWidget", provider: NearcastWidgetProvider()) { entry in
            NearcastWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    NearcastWidgetBackdrop(snapshot: entry.snapshot)
                }
                .widgetURL(URL(string: "nearcast://weather"))
        }
        .configurationDisplayName("Nearcast")
        .description("A glance at the weather that matters next.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
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

struct NearcastSmallWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        let palette = widgetPalette(snapshot)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(cityName(snapshot.placeName))
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 4)
                Image(systemName: conditionSymbol(snapshot))
                    .font(.system(size: 18, weight: .bold))
                    .accessibilityHidden(true)
            }

            Spacer(minLength: 0)

            Text("\(snapshot.temperature)°")
                .font(.system(size: 54, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.62)

            Text(snapshot.condition)
                .font(.system(size: 18, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.68)

            HStack(spacing: 6) {
                MiniPill(text: "Feels \(snapshot.feelsLike)°", palette: palette)
                MiniPill(text: compactSignalValue(snapshot.nextValue), tone: signalColor(snapshot.nextValue), palette: palette)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(16)
    }
}

struct NearcastMediumWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        let palette = widgetPalette(snapshot)
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(shortPlaceName(snapshot.placeName))
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .foregroundStyle(palette.secondary)

                Text("\(snapshot.temperature)°")
                    .font(.system(size: 52, weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Text(snapshot.condition)
                    .font(.system(size: 17, weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Text(mediumMetaText(snapshot))
                    .font(.system(size: 12, weight: .heavy, design: .rounded))
                    .foregroundStyle(palette.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 8) {
                SignalRow(label: snapshot.nowLabel, value: snapshot.nowValue, tone: palette.primary, palette: palette)
                SignalRow(label: snapshot.nextLabel, value: snapshot.nextValue, tone: signalColor(snapshot.nextValue), palette: palette)
                SignalRow(label: snapshot.laterLabel, value: snapshot.laterValue, tone: palette.secondary, palette: palette)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(18)
    }
}

struct NearcastLargeWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        let palette = widgetPalette(snapshot)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shortPlaceName(snapshot.placeName))
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .foregroundStyle(palette.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text(primarySignal(snapshot))
                        .font(.system(size: 29, weight: .black, design: .rounded))
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(snapshot.temperature)°")
                        .font(.system(size: 43, weight: .black, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    if let high = snapshot.high, let low = snapshot.low {
                        Text("H \(high)°  L \(low)°")
                            .font(.system(size: 14, weight: .heavy, design: .rounded))
                            .foregroundStyle(palette.secondary)
                    }
                }
            }

            VStack(spacing: 8) {
                SignalRow(label: snapshot.nowLabel, value: snapshot.nowValue, tone: palette.primary, palette: palette)
                SignalRow(label: snapshot.nextLabel, value: snapshot.nextValue, tone: signalColor(snapshot.nextValue), palette: palette)
                SignalRow(label: snapshot.laterLabel, value: snapshot.laterValue, tone: palette.secondary, palette: palette)
            }

            if hasPlanSummary(snapshot) {
                PlanSummaryStrip(snapshot: snapshot, palette: palette)
            }

            HStack(spacing: 8) {
                MetricTile(label: "Feels", value: "\(snapshot.feelsLike)°", palette: palette)
                MetricTile(label: "Rain", value: "\(snapshot.rainChance)%", palette: palette)
                WindMetricTile(snapshot: snapshot, palette: palette)
                UvMetricTile(value: snapshot.uv, palette: palette)
            }

            Text(freshnessText(snapshot))
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .foregroundStyle(palette.subtle)
                .lineLimit(1)
        }
        .padding(18)
    }
}

struct MiniPill: View {
    let text: String
    var tone: Color? = nil
    let palette: WidgetPalette

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .foregroundStyle((tone ?? palette.primary).opacity(0.90))
            .lineLimit(1)
            .minimumScaleFactor(0.66)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(palette.surfaceStrong, in: Capsule())
    }
}

struct PlanSummaryStrip: View {
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette

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
                        .font(.system(size: 13, weight: .black, design: .rounded))
                        .foregroundStyle(palette.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                    if let place = cleanOptional(snapshot.planPlace) {
                        Text(cityName(place))
                            .font(.system(size: 9, weight: .black, design: .rounded))
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                            .foregroundStyle(planToneColor(snapshot).opacity(0.88))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(planToneColor(snapshot).opacity(0.13), in: Capsule())
                    }
                }
                Text(cleanOptional(snapshot.planDetail) ?? "Plan checked against the forecast.")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(palette.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(planSurfaceColor(snapshot), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(planStrokeColor(snapshot), lineWidth: 1)
        )
    }
}

struct SignalRow: View {
    let label: String
    let value: String
    let tone: Color
    let palette: WidgetPalette

    var body: some View {
        HStack(spacing: 9) {
            Text(compactSignalLabel(label))
                .font(.system(size: 10, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(tone.opacity(0.75))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(width: 44, alignment: .leading)
            Text(compactSignalValue(value))
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .foregroundStyle(palette.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct MetricTile: View {
    let label: String
    let value: String
    var detail: String? = nil
    let palette: WidgetPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(palette.muted)
            Text(value)
                .font(.system(size: 15, weight: .black, design: .rounded))
                .foregroundStyle(palette.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            if let detail = cleanOptional(detail) {
                Text(detail)
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .padding(9)
        .background(palette.surfaceSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct WindMetricTile: View {
    let snapshot: NearcastWidgetSnapshot
    let palette: WidgetPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("WIND")
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(palette.muted)
            HStack(alignment: .center, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(snapshot.wind)")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .foregroundStyle(palette.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .fixedSize(horizontal: true, vertical: false)
                    Text(snapshot.windUnit)
                        .font(.system(size: 8, weight: .black, design: .rounded))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .layoutPriority(3)
                Spacer(minLength: 0)
                if let direction = snapshot.windDirection {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(palette.primary)
                        .rotationEffect(.degrees(Double((direction + 180) % 360)))
                        .frame(width: 24, height: 24)
                        .background(palette.surfaceStrong, in: Circle())
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .padding(9)
        .background(palette.surfaceSoft, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct UvMetricTile: View {
    let value: Int
    let palette: WidgetPalette

    var body: some View {
        let color = uvToneColor(value)
        VStack(alignment: .leading, spacing: 5) {
            Text("UV")
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(palette.muted)
            HStack(spacing: 5) {
                Text("\(value)")
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .foregroundStyle(palette.primary)
                    .lineLimit(1)
                Text(uvRiskLabel(value))
                    .font(.system(size: 8, weight: .black, design: .rounded))
                    .foregroundStyle(color.opacity(0.95))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .padding(9)
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
        LinearGradient(
            colors: backdropColors(snapshot),
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
        .overlay(alignment: .topTrailing) {
            if snapshot.isDay {
                Circle()
                    .fill(.white.opacity(0.28))
                    .blur(radius: 16)
                    .frame(width: 96, height: 96)
                    .offset(x: 24, y: -28)
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

private func primarySignal(_ snapshot: NearcastWidgetSnapshot) -> String {
    let next = snapshot.nextValue.lowercased()
    let now = snapshot.nowValue.lowercased()
    if next.contains("rain") || next.contains("storm") { return snapshot.nextValue }
    if now.contains("rain") || now.contains("snow") || now.contains("storm") { return snapshot.nowValue }
    if snapshot.feelsLike >= 95 { return "Serious heat" }
    if snapshot.feelsLike <= 32 { return "Freezing" }
    return snapshot.condition
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
    let wind = windSummary(snapshot, includeDirection: true).replacingOccurrences(of: "Wind ", with: "")
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
        .replacingOccurrences(of: "next 2 hours", with: "2h", options: .caseInsensitive)
        .replacingOccurrences(of: "next two hours", with: "2h", options: .caseInsensitive)
        .replacingOccurrences(of: " PM", with: "", options: .caseInsensitive)
        .replacingOccurrences(of: " AM", with: "", options: .caseInsensitive)
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

private func conditionSymbol(_ snapshot: NearcastWidgetSnapshot) -> String {
    let code = snapshot.conditionCode
    if (95...99).contains(code) { return "cloud.bolt.rain.fill" }
    if (71...86).contains(code) { return "snowflake" }
    if (51...67).contains(code) || (80...82).contains(code) { return "cloud.rain.fill" }
    if !snapshot.isDay { return "moon.stars.fill" }
    if (1...3).contains(code) { return "cloud.sun.fill" }
    return "sun.max.fill"
}

private func signalColor(_ value: String) -> Color {
    let lower = value.lowercased()
    if lower.contains("storm") || lower.contains("rain") { return Color(red: 0.18, green: 0.42, blue: 0.82) }
    if lower.contains("dry") { return Color(red: 0.12, green: 0.48, blue: 0.34) }
    if lower.contains("gust") || lower.contains("wind") { return Color(red: 0.38, green: 0.39, blue: 0.72) }
    return .primary
}

private func backdropColors(_ snapshot: NearcastWidgetSnapshot) -> [Color] {
    let code = snapshot.conditionCode
    let stormy = code >= 95
    let wet = (51...82).contains(code)
    let snowy = (71...86).contains(code)
    let hot = snapshot.feelsLike >= 95
    if !snapshot.isDay {
        if wet || stormy { return [Color(red: 0.06, green: 0.10, blue: 0.18), Color(red: 0.15, green: 0.22, blue: 0.36), Color(red: 0.03, green: 0.05, blue: 0.10)] }
        return [Color(red: 0.03, green: 0.06, blue: 0.13), Color(red: 0.10, green: 0.15, blue: 0.27), Color(red: 0.02, green: 0.03, blue: 0.08)]
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
