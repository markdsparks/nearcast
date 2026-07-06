import SwiftUI
import WidgetKit

private let nearcastWidgetSuiteName = "group.app.nearcast.ios"
private let nearcastWidgetSnapshotKey = "nearcast.widget.snapshot.v1"

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
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetSnapshotKey),
            let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data)
        else {
            return fallback
        }
        return snapshot
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
        let entry = NearcastWidgetEntry(date: Date(), snapshot: NearcastWidgetSnapshot.current())
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(15 * 60)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
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
        .foregroundStyle(.black.opacity(0.84))
    }
}

struct NearcastSmallWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
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
                MiniPill(text: "Feels \(snapshot.feelsLike)°")
                MiniPill(text: compactSignalValue(snapshot.nextValue), tone: signalColor(snapshot.nextValue))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(16)
    }
}

struct NearcastMediumWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(shortPlaceName(snapshot.placeName))
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .foregroundStyle(.black.opacity(0.62))

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
                    .foregroundStyle(.black.opacity(0.58))
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 8) {
                SignalRow(label: snapshot.nowLabel, value: snapshot.nowValue, tone: .primary)
                SignalRow(label: snapshot.nextLabel, value: snapshot.nextValue, tone: signalColor(snapshot.nextValue))
                SignalRow(label: snapshot.laterLabel, value: snapshot.laterValue, tone: .primary.opacity(0.78))
            }
            .frame(maxWidth: .infinity)
        }
        .padding(18)
    }
}

struct NearcastLargeWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shortPlaceName(snapshot.placeName))
                        .font(.system(size: 16, weight: .black, design: .rounded))
                        .foregroundStyle(.black.opacity(0.62))
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
                            .foregroundStyle(.black.opacity(0.58))
                    }
                }
            }

            VStack(spacing: 8) {
                SignalRow(label: snapshot.nowLabel, value: snapshot.nowValue, tone: .primary)
                SignalRow(label: snapshot.nextLabel, value: snapshot.nextValue, tone: signalColor(snapshot.nextValue))
                SignalRow(label: snapshot.laterLabel, value: snapshot.laterValue, tone: .primary.opacity(0.78))
            }

            if hasPlanSummary(snapshot) {
                PlanSummaryStrip(snapshot: snapshot)
            }

            HStack(spacing: 8) {
                MetricTile(label: "Feels", value: "\(snapshot.feelsLike)°")
                MetricTile(label: "Rain", value: "\(snapshot.rainChance)%")
                WindMetricTile(snapshot: snapshot)
                UvMetricTile(value: snapshot.uv)
            }

            Text(footerText(snapshot))
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .foregroundStyle(.black.opacity(0.34))
                .lineLimit(1)
        }
        .padding(18)
    }
}

struct MiniPill: View {
    let text: String
    var tone: Color = .primary

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .foregroundStyle(tone.opacity(0.88))
            .lineLimit(1)
            .minimumScaleFactor(0.66)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(.white.opacity(0.30), in: Capsule())
    }
}

struct PlanSummaryStrip: View {
    let snapshot: NearcastWidgetSnapshot

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
                    .foregroundStyle(.black.opacity(0.55))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(planToneColor(snapshot).opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(planToneColor(snapshot).opacity(0.18), lineWidth: 1)
        )
    }
}

struct SignalRow: View {
    let label: String
    let value: String
    let tone: Color

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
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.white.opacity(0.28), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct MetricTile: View {
    let label: String
    let value: String
    var detail: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(.black.opacity(0.46))
            Text(value)
                .font(.system(size: 15, weight: .black, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            if let detail = cleanOptional(detail) {
                Text(detail)
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .foregroundStyle(.black.opacity(0.48))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 54)
        .padding(9)
        .background(.white.opacity(0.24), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct WindMetricTile: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("WIND")
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(.black.opacity(0.46))
            HStack(spacing: 5) {
                Text("\(snapshot.wind)")
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .lineLimit(1)
                Text(snapshot.windUnit)
                    .font(.system(size: 9, weight: .black, design: .rounded))
                    .foregroundStyle(.black.opacity(0.50))
                Spacer(minLength: 0)
                if let direction = snapshot.windDirection {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .black))
                        .rotationEffect(.degrees(Double((direction + 180) % 360)))
                        .frame(width: 22, height: 22)
                        .background(.black.opacity(0.08), in: Circle())
                    Text(windShortLabel(snapshot))
                        .font(.system(size: 8, weight: .black, design: .rounded))
                        .foregroundStyle(.black.opacity(0.50))
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 54)
        .padding(9)
        .background(.white.opacity(0.24), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct UvMetricTile: View {
    let value: Int

    var body: some View {
        let color = uvToneColor(value)
        VStack(alignment: .leading, spacing: 5) {
            Text("UV")
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(.black.opacity(0.48))
            HStack(spacing: 5) {
                Text("\(value)")
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .lineLimit(1)
                Text(uvRiskLabel(value))
                    .font(.system(size: 8, weight: .black, design: .rounded))
                    .foregroundStyle(color.opacity(0.95))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 54)
        .padding(9)
        .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(color.opacity(0.18), lineWidth: 1)
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
        .overlay {
            if snapshot.isDay {
                Circle()
                    .fill(.white.opacity(0.34))
                    .blur(radius: 16)
                    .frame(width: 96, height: 96)
                    .offset(x: 78, y: -70)
            } else {
                ZStack {
                    Circle().fill(.white.opacity(0.72)).frame(width: 54, height: 54)
                    Circle().fill(.black.opacity(0.18)).frame(width: 52, height: 52).offset(x: 16, y: -8)
                }
                .blur(radius: 0.4)
                .offset(x: 82, y: -72)
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

private func windShortLabel(_ snapshot: NearcastWidgetSnapshot) -> String {
    let label = cleanOptional(snapshot.windLabel) ?? ""
    return label
        .replacingOccurrences(of: "from ", with: "", options: .caseInsensitive)
        .uppercased()
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

private func footerText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let wind = windSummary(snapshot, includeDirection: true)
    return "\(wind) · \(freshnessText(snapshot))"
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
