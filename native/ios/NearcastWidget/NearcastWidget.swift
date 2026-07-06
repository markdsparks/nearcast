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
    var uv: Int
    var nowLabel: String
    var nowValue: String
    var nextLabel: String
    var nextValue: String
    var laterLabel: String
    var laterValue: String
}

extension NearcastWidgetSnapshot {
    static let fallback = NearcastWidgetSnapshot(
        version: 1,
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
        uv: 4,
        nowLabel: "Now",
        nowValue: "Open Nearcast",
        nextLabel: "Next",
        nextValue: "Load a place",
        laterLabel: "Later",
        laterValue: "Plans stay visible"
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
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 20, to: Date()) ?? Date().addingTimeInterval(20 * 60)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

@main
struct NearcastWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NearcastWidget", provider: NearcastWidgetProvider()) { entry in
            NearcastWidgetView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .widgetURL(URL(string: "nearcast://weather"))
        }
        .configurationDisplayName("Nearcast")
        .description("A glance at the weather that matters next.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct NearcastWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearcastWidgetEntry

    var body: some View {
        ZStack {
            NearcastWidgetBackdrop(snapshot: entry.snapshot)
            switch family {
            case .systemSmall:
                NearcastSmallWidget(snapshot: entry.snapshot)
            case .systemLarge:
                NearcastLargeWidget(snapshot: entry.snapshot)
            default:
                NearcastMediumWidget(snapshot: entry.snapshot)
            }
        }
    }
}

struct NearcastSmallWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(snapshot.placeName)
                .font(.caption.weight(.bold))
                .lineLimit(1)
                .foregroundStyle(.primary.opacity(0.78))

            Spacer(minLength: 0)

            Text(primarySignal(snapshot))
                .font(.system(size: 24, weight: .black, design: .rounded))
                .lineLimit(2)
                .minimumScaleFactor(0.68)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(snapshot.temperature)")
                    .font(.system(size: 42, weight: .black, design: .rounded))
                    .minimumScaleFactor(0.78)
                Text("°")
                    .font(.system(size: 26, weight: .black, design: .rounded))
            }
            .accessibilityLabel("\(snapshot.temperature) degrees")

            Text(snapshot.nextValue)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(.primary.opacity(0.78))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
    }
}

struct NearcastMediumWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(snapshot.placeName)
                    .font(.caption.weight(.bold))
                    .lineLimit(1)
                    .foregroundStyle(.primary.opacity(0.72))

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(snapshot.temperature)")
                        .font(.system(size: 48, weight: .black, design: .rounded))
                    Text("°")
                        .font(.system(size: 28, weight: .black, design: .rounded))
                }
                .minimumScaleFactor(0.75)

                Text(snapshot.condition)
                    .font(.callout.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)

                Text("Feels \(snapshot.feelsLike)°")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary.opacity(0.7))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 7) {
                SignalRow(label: snapshot.nowLabel, value: snapshot.nowValue, tone: .primary)
                SignalRow(label: snapshot.nextLabel, value: snapshot.nextValue, tone: signalColor(snapshot.nextValue))
                SignalRow(label: snapshot.laterLabel, value: snapshot.laterValue, tone: .primary.opacity(0.78))
            }
            .frame(maxWidth: .infinity)
        }
        .padding(15)
    }
}

struct NearcastLargeWidget: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(snapshot.placeName)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.primary.opacity(0.72))
                        .lineLimit(1)
                    Text(primarySignal(snapshot))
                        .font(.system(size: 31, weight: .black, design: .rounded))
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(snapshot.temperature)°")
                        .font(.system(size: 43, weight: .black, design: .rounded))
                    if let high = snapshot.high, let low = snapshot.low {
                        Text("H \(high)°  L \(low)°")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.primary.opacity(0.68))
                    }
                }
            }

            VStack(spacing: 8) {
                SignalRow(label: snapshot.nowLabel, value: snapshot.nowValue, tone: .primary)
                SignalRow(label: snapshot.nextLabel, value: snapshot.nextValue, tone: signalColor(snapshot.nextValue))
                SignalRow(label: snapshot.laterLabel, value: snapshot.laterValue, tone: .primary.opacity(0.78))
            }

            HStack(spacing: 8) {
                MetricTile(label: "Feels", value: "\(snapshot.feelsLike)°")
                MetricTile(label: "Rain", value: "\(snapshot.rainChance)%")
                MetricTile(label: "Wind", value: "\(snapshot.wind) \(snapshot.windUnit)")
                MetricTile(label: "UV", value: "\(snapshot.uv)")
            }
        }
        .padding(16)
    }
}

struct SignalRow: View {
    let label: String
    let value: String
    let tone: Color

    var body: some View {
        HStack(spacing: 8) {
            Text(label.uppercased())
                .font(.caption2.weight(.black))
                .tracking(1.2)
                .foregroundStyle(tone.opacity(0.75))
                .frame(width: 42, alignment: .leading)
            Text(value)
                .font(.caption.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial.opacity(0.78), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct MetricTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 8, weight: .black))
                .tracking(0.8)
                .foregroundStyle(.primary.opacity(0.52))
            Text(value)
                .font(.caption.weight(.black))
                .lineLimit(1)
                .minimumScaleFactor(0.62)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(.ultraThinMaterial.opacity(0.62), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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
