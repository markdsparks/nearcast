import SwiftUI

struct NearcastWatchRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var snapshotReceiver = NearcastWatchSnapshotReceiver.shared
    @State private var snapshot = NearcastWidgetSnapshot.current()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                WatchHeader(snapshot: snapshot) {
                    snapshot = NearcastWidgetSnapshot.current()
                }
                WatchNowCard(snapshot: snapshot)
                WatchStatusCard(snapshot: snapshot)
                WatchMetricsGrid(snapshot: snapshot)
                WatchFreshness(snapshot: snapshot)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(watchBackground(snapshot).ignoresSafeArea())
        .onAppear {
            snapshotReceiver.activate()
            snapshot = NearcastWidgetSnapshot.current()
        }
        .onChange(of: snapshotReceiver.revision) { _, _ in
            snapshot = NearcastWidgetSnapshot.current()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                snapshotReceiver.activate()
                snapshot = NearcastWidgetSnapshot.current()
            }
        }
    }
}

struct WatchHeader: View {
    let snapshot: NearcastWidgetSnapshot
    let refresh: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(cityName(snapshot.placeName))
                    .font(.system(size: 18, weight: .black, design: .rounded))
                    .foregroundStyle(watchPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(snapshot.condition)
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(watchMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 6)
            Button(action: refresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 15, weight: .black))
                    .foregroundStyle(.black)
                    .frame(width: 34, height: 34)
                    .background(watchAccent(snapshot), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Refresh Nearcast")
        }
        .padding(.horizontal, 2)
    }
}

struct WatchNowCard: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(watchStatus(snapshot))
                        .font(.system(size: 18, weight: .black, design: .rounded))
                        .foregroundStyle(watchPrimary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.68)
                    Text(snapshot.condition)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(watchSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                Text("\(snapshot.temperature)°")
                    .font(.system(size: 36, weight: .black, design: .rounded))
                    .foregroundStyle(watchPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }

            HStack(spacing: 6) {
                WatchPill(label: "Feels", value: "\(snapshot.feelsLike)°")
                WatchPill(label: "Rain", value: "\(snapshot.rainChance)%")
            }
        }
        .padding(12)
        .background(watchCardFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(watchCardStroke, lineWidth: 1)
        )
    }
}

struct WatchStatusCard: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                Image(systemName: watchSymbol(snapshot))
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(watchToneColor(snapshot))
                    .frame(width: 24, height: 24)
                    .background(watchToneColor(snapshot).opacity(0.18), in: Circle())
                    .accessibilityHidden(true)
                Text(hasPlanSummary(snapshot) ? "Watching" : "Next")
                    .font(.system(size: 11, weight: .black, design: .rounded))
                    .tracking(0.7)
                    .textCase(.uppercase)
                    .foregroundStyle(watchMuted)
            }
            if hasPlanSummary(snapshot) {
                Text([snapshot.planLabel, snapshot.planTitle].compactMap(cleanOptional).joined(separator: " · "))
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .foregroundStyle(watchPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.68)
            }
            Text(watchDetail(snapshot))
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .foregroundStyle(watchSecondary)
                .lineLimit(3)
                .minimumScaleFactor(0.68)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(watchToneColor(snapshot).opacity(0.20), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(watchToneColor(snapshot).opacity(0.32), lineWidth: 1)
        )
    }
}

struct WatchMetricsGrid: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 7) {
            WatchMetric(label: "Now", value: compactSignalValue(snapshot.nowValue))
            WatchMetric(label: "Next", value: compactSignalValue(snapshot.nextValue))
            WatchMetric(label: "Wind", value: windText(snapshot))
            WatchMetric(label: "UV", value: "\(uvRiskLabel(snapshot.uv)) \(snapshot.uv)")
        }
    }
}

struct WatchMetric: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .black, design: .rounded))
                .tracking(0.7)
                .foregroundStyle(watchMuted)
            Text(value)
                .font(.system(size: 12, weight: .black, design: .rounded))
                .foregroundStyle(watchPrimary)
                .lineLimit(2)
                .minimumScaleFactor(0.62)
        }
        .frame(maxWidth: .infinity, minHeight: 42, alignment: .topLeading)
        .padding(8)
        .background(watchMetricFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(watchCardStroke, lineWidth: 1)
        )
    }
}

struct WatchPill: View {
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .foregroundStyle(watchMuted)
            Text(value)
                .fontWeight(.black)
                .foregroundStyle(watchPrimary)
        }
        .font(.system(size: 11, weight: .heavy, design: .rounded))
        .lineLimit(1)
        .minimumScaleFactor(0.72)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(watchPillFill, in: Capsule())
    }
}

struct WatchFreshness: View {
    let snapshot: NearcastWidgetSnapshot

    var body: some View {
        Text(freshnessText(snapshot))
            .font(.system(size: 10, weight: .heavy, design: .rounded))
            .foregroundStyle(watchMuted)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

private func watchBackground(_ snapshot: NearcastWidgetSnapshot) -> LinearGradient {
    if snapshot.isDay {
        return LinearGradient(
            colors: [Color(red: 0.05, green: 0.12, blue: 0.17), Color(red: 0.02, green: 0.05, blue: 0.08)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
    return LinearGradient(
        colors: [Color(red: 0.03, green: 0.05, blue: 0.09), Color(red: 0.01, green: 0.02, blue: 0.04)],
        startPoint: .top,
        endPoint: .bottom
    )
}

private let watchPrimary = Color.white
private let watchSecondary = Color.white.opacity(0.78)
private let watchMuted = Color.white.opacity(0.58)
private let watchCardFill = Color.white.opacity(0.13)
private let watchMetricFill = Color.white.opacity(0.10)
private let watchPillFill = Color.black.opacity(0.34)
private let watchCardStroke = Color.white.opacity(0.18)

private func watchAccent(_ snapshot: NearcastWidgetSnapshot) -> Color {
    if (51...82).contains(snapshot.conditionCode) || snapshot.rainChance >= 40 {
        return Color(red: 0.56, green: 0.78, blue: 1.0)
    }
    if snapshot.feelsLike >= 90 {
        return Color(red: 1.0, green: 0.68, blue: 0.36)
    }
    if !snapshot.isDay {
        return Color(red: 0.62, green: 0.72, blue: 1.0)
    }
    return Color(red: 0.54, green: 0.93, blue: 0.78)
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
        if (51...82).contains(snapshot.conditionCode) { return "cloud.rain.fill" }
        if !snapshot.isDay { return "moon.stars.fill" }
        return "sun.max.fill"
    }
}

private func watchToneColor(_ snapshot: NearcastWidgetSnapshot) -> Color {
    let tone = cleanOptional(snapshot.watchTone)?.lowercased() ?? cleanOptional(snapshot.planTone)?.lowercased() ?? ""
    switch tone {
    case "watch", "caution":
        return Color(red: 0.95, green: 0.55, blue: 0.28)
    case "changed":
        return Color(red: 0.45, green: 0.66, blue: 1.0)
    case "good":
        return Color(red: 0.28, green: 0.78, blue: 0.50)
    default:
        return Color(red: 0.54, green: 0.74, blue: 0.98)
    }
}

private func hasPlanSummary(_ snapshot: NearcastWidgetSnapshot) -> Bool {
    cleanOptional(snapshot.planTitle) != nil || cleanOptional(snapshot.planDetail) != nil
}

private func windText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let base = "\(snapshot.wind) \(snapshot.windUnit)"
    guard let label = cleanOptional(snapshot.windLabel) else { return base }
    return "\(base) \(label)"
}

private func uvRiskLabel(_ value: Int) -> String {
    if value >= 11 { return "Extreme" }
    if value >= 8 { return "Very high" }
    if value >= 6 { return "High" }
    if value >= 3 { return "Moderate" }
    return "Low"
}

private func freshnessText(_ snapshot: NearcastWidgetSnapshot) -> String {
    let saved = Date(timeIntervalSince1970: snapshot.savedAt)
    let minutes = max(0, Int(Date().timeIntervalSince(saved) / 60))
    if minutes < 1 { return "Updated just now" }
    if minutes < 60 { return "Updated \(minutes)m ago" }
    let hours = max(1, minutes / 60)
    return "Updated \(hours)h ago"
}

private func cityName(_ value: String) -> String {
    let city = value
        .split(separator: ",", maxSplits: 1)
        .first
        .map { String($0) } ?? value
    let trimmed = city.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? value : trimmed
}

private func cleanOptional(_ value: String?) -> String? {
    let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
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
    if lower.hasPrefix("hot - feels") {
        text = text.replacingOccurrences(of: "Hot - feels", with: "Feels", options: .caseInsensitive)
    }
    if lower.hasPrefix("dangerously hot - feels") {
        text = text.replacingOccurrences(of: "Dangerously hot - feels", with: "Feels", options: .caseInsensitive)
    }
    if lower.contains("rain near") || lower.contains("rain nearby") {
        return "Rain nearby"
    }
    if lower.contains("thunderstorm") {
        return "Storms possible"
    }
    if text.isEmpty {
        return "Check Nearcast"
    }
    return text
}
