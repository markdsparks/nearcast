import SwiftUI
import WidgetKit

private let nextKind = "NearcastWatchNext"
private let planKind = "NearcastWatchPlan"
private let rainKind = "NearcastWatchRain"

struct NearcastComplicationEntry: TimelineEntry {
    let date: Date
    let snapshot: NearcastWidgetSnapshot
    let isStale: Bool
}

struct NearcastComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> NearcastComplicationEntry {
        NearcastComplicationEntry(date: Date(), snapshot: .fallback, isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (NearcastComplicationEntry) -> Void) {
        completion(entry(snapshot: .current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NearcastComplicationEntry>) -> Void) {
        Task {
            let cached = NearcastWidgetSnapshot.current()
            let snapshot = await NearcastWatchWeatherRefresh.refresh(fallback: cached) ?? cached
            let now = Date()
            let entries = [0, 30, 60, 120].map { minutes in
                NearcastComplicationEntry(
                    date: now.addingTimeInterval(TimeInterval(minutes * 60)),
                    snapshot: snapshot,
                    isStale: snapshot.age > 2 * 60 * 60
                )
            }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
        }
    }

    private func entry(snapshot: NearcastWidgetSnapshot) -> NearcastComplicationEntry {
        NearcastComplicationEntry(date: Date(), snapshot: snapshot, isStale: snapshot.age > 2 * 60 * 60)
    }
}

@main
struct NearcastWatchComplicationBundle: WidgetBundle {
    var body: some Widget {
        NearcastNextComplication()
        NearcastPlanComplication()
        NearcastRainComplication()
    }
}

struct NearcastNextComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: nextKind, provider: NearcastComplicationProvider()) { entry in
            NearcastNextComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("next"))
        }
        .configurationDisplayName("Nearcast Next")
        .description("The weather change that matters next.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastPlanComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: planKind, provider: NearcastComplicationProvider()) { entry in
            NearcastPlanComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("plan"))
        }
        .configurationDisplayName("Plan Check")
        .description("Keep your watched plan visible on your wrist.")
        .supportedFamilies([.accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

struct NearcastRainComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: rainKind, provider: NearcastComplicationProvider()) { entry in
            NearcastRainComplicationView(entry: entry)
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(nearcastComplicationURL("rain"))
        }
        .configurationDisplayName("Rain Next")
        .description("When rain starts and how likely it is.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
    }
}

private struct NearcastNextComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearcastComplicationEntry

    var body: some View {
        let signal = nextSignal(entry.snapshot)
        switch family {
        case .accessoryInline:
            Label(entry.isStale ? "Nearcast · Update needed" : "Nearcast · \(signal.short)", systemImage: signal.symbol)
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: signal.symbol)
                    .font(.system(size: 13, weight: .black))
                    .widgetAccentable()
                Text("\(entry.snapshot.temperature)°")
                    .font(.system(size: 18, weight: .black, design: .rounded))
                Text(signal.micro)
                    .font(.system(size: 7, weight: .black, design: .rounded))
                    .lineLimit(1)
            }
        case .accessoryCorner:
            VStack(spacing: 0) {
                Image(systemName: signal.symbol)
                    .font(.system(size: 14, weight: .black))
                    .widgetAccentable()
                Text(signal.micro)
                    .font(.system(size: 9, weight: .black, design: .rounded))
                    .lineLimit(1)
            }
        default:
            HStack(spacing: 7) {
                Image(systemName: signal.symbol)
                    .font(.system(size: 18, weight: .black))
                    .widgetAccentable()
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.isStale ? "Update Nearcast" : signal.headline)
                        .font(.system(size: 14, weight: .black, design: .rounded))
                        .lineLimit(1)
                    Text(entry.isStale ? staleText(entry.snapshot) : signal.detail)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text("\(entry.snapshot.temperature)°")
                    .font(.system(size: 20, weight: .black, design: .rounded))
            }
        }
    }
}

private struct NearcastPlanComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearcastComplicationEntry

    var body: some View {
        let plan = planSignal(entry.snapshot)
        switch family {
        case .accessoryInline:
            Label("\(plan.label) · \(plan.short)", systemImage: plan.symbol)
        case .accessoryCorner:
            VStack(spacing: 0) {
                Image(systemName: plan.symbol)
                    .font(.system(size: 14, weight: .black))
                    .widgetAccentable()
                Text(plan.micro)
                    .font(.system(size: 8, weight: .black, design: .rounded))
                    .lineLimit(1)
            }
        default:
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Image(systemName: plan.symbol).widgetAccentable()
                    Text(plan.label.uppercased())
                        .font(.system(size: 9, weight: .black, design: .rounded))
                        .tracking(0.5)
                }
                Text(plan.headline)
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .lineLimit(1)
                Text(plan.detail)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

private struct NearcastRainComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearcastComplicationEntry

    var body: some View {
        let rain = rainSignal(entry.snapshot)
        switch family {
        case .accessoryInline:
            Label("\(rain.headline) · \(rain.peak)%", systemImage: rain.symbol)
        case .accessoryCircular:
            Gauge(value: Double(rain.peak), in: 0...100) {
                Image(systemName: rain.symbol)
            } currentValueLabel: {
                Text("\(rain.peak)")
                    .font(.system(size: 15, weight: .black, design: .rounded))
            }
            .gaugeStyle(.accessoryCircular)
            .widgetAccentable()
        case .accessoryCorner:
            VStack(spacing: 0) {
                Image(systemName: rain.symbol).widgetAccentable()
                Text(rain.micro)
                    .font(.system(size: 9, weight: .black, design: .rounded))
                    .lineLimit(1)
            }
        default:
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Label(rain.headline, systemImage: rain.symbol)
                        .font(.system(size: 13, weight: .black, design: .rounded))
                        .widgetAccentable()
                    Spacer(minLength: 0)
                    Text("\(rain.peak)%")
                        .font(.system(size: 15, weight: .black, design: .rounded))
                }
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(rain.bars.indices, id: \.self) { index in
                        Capsule()
                            .fill(index == rain.peakIndex ? Color.accentColor : Color.secondary.opacity(0.45))
                            .frame(maxWidth: .infinity)
                            .frame(height: max(3, CGFloat(rain.bars[index]) * 0.16))
                    }
                }
                .frame(height: 16, alignment: .bottom)
            }
        }
    }
}

private struct ComplicationSignal {
    let symbol: String
    let headline: String
    let detail: String
    let short: String
    let micro: String
    var label: String = "Plan Check"
}

private struct RainSignal {
    let symbol: String
    let headline: String
    let micro: String
    let peak: Int
    let bars: [Int]
    let peakIndex: Int
}

private func nextSignal(_ snapshot: NearcastWidgetSnapshot) -> ComplicationSignal {
    if let title = clean(snapshot.planTitle), let detail = clean(snapshot.watchDetail ?? snapshot.planDetail) {
        return ComplicationSignal(
            symbol: watchSymbol(snapshot),
            headline: detail,
            detail: title,
            short: detail,
            micro: compact(detail)
        )
    }
    let rain = rainSignal(snapshot)
    if rain.peak >= 30 {
        return ComplicationSignal(
            symbol: rain.symbol,
            headline: rain.headline,
            detail: "Peak \(rain.peak)% · \(snapshot.temperature)°",
            short: "\(rain.headline) \(rain.peak)%",
            micro: rain.micro
        )
    }
    return ComplicationSignal(
        symbol: watchSymbol(snapshot),
        headline: clean(snapshot.watchStatus) ?? snapshot.condition,
        detail: "\(snapshot.temperature)° · Feels \(snapshot.feelsLike)°",
        short: "\(snapshot.temperature)° \(snapshot.condition)",
        micro: "\(snapshot.temperature)°"
    )
}

private func planSignal(_ snapshot: NearcastWidgetSnapshot) -> ComplicationSignal {
    guard let title = clean(snapshot.planTitle) else {
        return ComplicationSignal(
            symbol: "calendar.badge.plus",
            headline: "No plan watched",
            detail: "Open Nearcast to watch a plan",
            short: "No plan",
            micro: "Add plan"
        )
    }
    let detail = clean(snapshot.watchDetail ?? snapshot.planDetail) ?? "Check your plan"
    return ComplicationSignal(
        symbol: watchSymbol(snapshot),
        headline: detail,
        detail: clean(snapshot.planLabel).map { "\($0) · \(title)" } ?? title,
        short: detail,
        micro: compact(detail),
        label: clean(snapshot.planLabel) ?? title
    )
}

private func rainSignal(_ snapshot: NearcastWidgetSnapshot) -> RainSignal {
    let rows = Array((snapshot.timeline ?? []).prefix(4))
    let bars = rows.isEmpty ? [snapshot.rainChance] : rows.map { $0.rainChance ?? snapshot.rainChance }
    let peak = bars.max() ?? snapshot.rainChance
    let peakIndex = bars.firstIndex(of: peak) ?? 0
    let firstWet = rows.first { ($0.rainChance ?? 0) >= 30 }
    let headline: String
    let micro: String
    if let firstWet {
        headline = firstWet.offsetHours == 0 ? "Rain now" : "Rain near \(firstWet.timeLabel)"
        micro = firstWet.offsetHours == 0 ? "Now" : compact(firstWet.timeLabel)
    } else {
        headline = "Dry next"
        micro = "Dry"
    }
    return RainSignal(symbol: peak >= 30 ? "cloud.rain.fill" : "cloud.sun.fill", headline: headline, micro: micro, peak: peak, bars: bars, peakIndex: peakIndex)
}

private func watchSymbol(_ snapshot: NearcastWidgetSnapshot) -> String {
    let tone = (snapshot.watchTone ?? snapshot.planTone ?? "").lowercased()
    if tone.contains("danger") || tone.contains("bad") { return "exclamationmark.triangle.fill" }
    if tone.contains("watch") || tone.contains("caution") || tone.contains("changed") { return "exclamationmark.circle.fill" }
    if snapshot.rainChance >= 35 || (51...82).contains(snapshot.conditionCode) { return "cloud.rain.fill" }
    if snapshot.conditionCode <= 1 { return snapshot.isDay ? "sun.max.fill" : "moon.stars.fill" }
    return "cloud.fill"
}

private func clean(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func compact(_ value: String) -> String {
    value.replacingOccurrences(of: "around ", with: "").replacingOccurrences(of: "near ", with: "")
}

private func staleText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let hours = max(1, Int(snapshot.age / 3600))
    return "Updated \(hours)h ago"
}

private func nearcastComplicationURL(_ surface: String) -> URL? {
    URL(string: "nearcast://weather?source=watch-complication&surface=\(surface)")
}

private enum NearcastWatchWeatherRefresh {
    static func refresh(fallback: NearcastWidgetSnapshot) async -> NearcastWidgetSnapshot? {
        guard let place = NearcastWidgetPlace.stored() else { return nil }
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.5f", place.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.5f", place.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m"),
            URLQueryItem(name: "hourly", value: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day"),
            URLQueryItem(name: "temperature_unit", value: fallback.windUnit.lowercased().contains("km") ? "celsius" : "fahrenheit"),
            URLQueryItem(name: "wind_speed_unit", value: fallback.windUnit.lowercased().contains("km") ? "kmh" : "mph"),
            URLQueryItem(name: "forecast_hours", value: "8"),
            URLQueryItem(name: "timezone", value: "auto")
        ]
        guard let url = components?.url else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            let forecast = try JSONDecoder().decode(WatchForecast.self, from: data)
            guard let current = forecast.current else { return nil }
            var updated = fallback
            updated.savedAt = Date().timeIntervalSince1970
            updated.placeName = place.name
            updated.temperature = Int(current.temperature.rounded())
            updated.feelsLike = Int(current.feelsLike.rounded())
            updated.conditionCode = current.weatherCode
            updated.isDay = current.isDay == 1
            updated.wind = Int(current.windSpeed.rounded())
            updated.windDirection = Int(current.windDirection.rounded())
            updated.condition = conditionLabel(current.weatherCode)
            if let hourly = forecast.hourly {
                let rows = hourly.rows(limit: 8)
                updated.timeline = rows
                updated.rainChance = rows.first?.rainChance ?? fallback.rainChance
                updated.uv = rows.first?.uv ?? fallback.uv
            }
            NearcastWidgetSnapshotStore.save(updated)
            return updated
        } catch {
            return nil
        }
    }
}

private struct WatchForecast: Decodable {
    let current: Current?
    let hourly: Hourly?

    struct Current: Decodable {
        let temperature: Double
        let feelsLike: Double
        let weatherCode: Int
        let isDay: Int
        let windSpeed: Double
        let windDirection: Double

        enum CodingKeys: String, CodingKey {
            case temperature = "temperature_2m"
            case feelsLike = "apparent_temperature"
            case weatherCode = "weather_code"
            case isDay = "is_day"
            case windSpeed = "wind_speed_10m"
            case windDirection = "wind_direction_10m"
        }
    }

    struct Hourly: Decodable {
        let time: [String]
        let temperature: [Double?]?
        let feelsLike: [Double?]?
        let rainChance: [Int?]?
        let weatherCode: [Int?]?
        let wind: [Double?]?
        let gust: [Double?]?
        let windDirection: [Double?]?
        let uv: [Double?]?
        let isDay: [Int?]?

        enum CodingKeys: String, CodingKey {
            case time
            case temperature = "temperature_2m"
            case feelsLike = "apparent_temperature"
            case rainChance = "precipitation_probability"
            case weatherCode = "weather_code"
            case wind = "wind_speed_10m"
            case gust = "wind_gusts_10m"
            case windDirection = "wind_direction_10m"
            case uv = "uv_index"
            case isDay = "is_day"
        }

        func rows(limit: Int) -> [NearcastWidgetHour] {
            let start = 0
            return (start..<min(time.count, start + limit)).map { index in
                NearcastWidgetHour(
                    offsetHours: index - start,
                    timeLabel: shortHour(time[index]),
                    temperature: rounded(temperature?[safe: index] ?? nil),
                    feelsLike: rounded(feelsLike?[safe: index] ?? nil),
                    rainChance: rainChance?[safe: index] ?? nil,
                    wind: rounded(wind?[safe: index] ?? nil),
                    windGust: rounded(gust?[safe: index] ?? nil),
                    windDirection: rounded(windDirection?[safe: index] ?? nil),
                    uv: rounded(uv?[safe: index] ?? nil),
                    conditionCode: weatherCode?[safe: index] ?? nil,
                    isDay: (isDay?[safe: index] ?? nil).map { $0 == 1 }
                )
            }
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private func rounded(_ value: Double?) -> Int? { value.map { Int($0.rounded()) } }

private func shortHour(_ raw: String) -> String {
    guard let hour = Int(raw.split(separator: "T").last?.split(separator: ":").first ?? "") else { return raw }
    if hour == 0 { return "12a" }
    if hour < 12 { return "\(hour)a" }
    if hour == 12 { return "12p" }
    return "\(hour - 12)p"
}

private func conditionLabel(_ code: Int) -> String {
    if code == 0 { return "Clear" }
    if code <= 3 { return "Cloudy" }
    if code <= 48 { return "Fog" }
    if code <= 67 { return "Rain" }
    if code <= 77 { return "Snow" }
    if code <= 82 { return "Showers" }
    if code <= 86 { return "Snow showers" }
    return "Storms"
}
