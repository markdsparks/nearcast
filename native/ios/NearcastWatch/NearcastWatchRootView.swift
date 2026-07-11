import Foundation
import SwiftUI
import WidgetKit

private let watchWeatherStaleInterval: TimeInterval = 2 * 60 * 60
private let watchPlanStaleInterval: TimeInterval = 2 * 60 * 60

private enum WatchSurface: String, Hashable {
    case brief
    case hours
    case plan

    init?(url: URL) {
        guard url.scheme?.lowercased() == "nearcast" else { return nil }
        let surface = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "surface" })?
            .value?
            .lowercased()
        switch surface {
        case "next", "brief": self = .brief
        case "rain", "hours": self = .hours
        case "plan": self = .plan
        default: return nil
        }
    }
}

private enum WatchSyncState: Equatable {
    case idle
    case refreshing
    case missingPlace
    case failed
}

struct NearcastWatchRootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject private var snapshotReceiver = NearcastWatchSnapshotReceiver.shared
    @State private var snapshot = NearcastWidgetSnapshot.current()
    @State private var selectedSurface: WatchSurface = .brief
    @State private var syncState: WatchSyncState = .idle

    var body: some View {
        GeometryReader { proxy in
            let useUltraLayout = proxy.size.width >= 190

            Group {
                if snapshot.hasWeatherData || snapshot.hasPlan {
                    if dynamicTypeSize.isAccessibilitySize {
                        WatchAccessibleOverview(
                            snapshot: snapshot,
                            syncState: syncState,
                            isLuminanceReduced: isLuminanceReduced,
                            useUltraLayout: useUltraLayout,
                            selectedSurface: $selectedSurface
                        )
                    } else {
                        TabView(selection: $selectedSurface) {
                            WatchBriefPage(
                                snapshot: snapshot,
                                syncState: syncState,
                                isLuminanceReduced: isLuminanceReduced,
                                useUltraLayout: useUltraLayout
                            )
                            .tag(WatchSurface.brief)

                            WatchHoursPage(
                                snapshot: snapshot,
                                syncState: syncState,
                                isLuminanceReduced: isLuminanceReduced,
                                useUltraLayout: useUltraLayout
                            )
                            .tag(WatchSurface.hours)

                            WatchPlanPage(
                                snapshot: snapshot,
                                isLuminanceReduced: isLuminanceReduced,
                                useUltraLayout: useUltraLayout
                            )
                            .tag(WatchSurface.plan)
                        }
                        .tabViewStyle(.verticalPage(transitionStyle: .blur))
                    }
                } else {
                    WatchUnavailablePage(
                        syncState: syncState,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(WatchAppBackground(isLuminanceReduced: isLuminanceReduced).ignoresSafeArea())
        .onAppear {
            snapshotReceiver.activate()
            snapshot = NearcastWidgetSnapshot.current()
        }
        .task {
            await refreshWeather()
        }
        .onOpenURL { url in
            guard let surface = WatchSurface(url: url) else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedSurface = surface
            }
        }
        .onChange(of: snapshotReceiver.revision) { _, _ in
            snapshot = NearcastWidgetSnapshot.current()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            snapshotReceiver.activate()
            snapshot = NearcastWidgetSnapshot.current()
            Task { await refreshWeather() }
        }
    }

    @MainActor
    private func refreshWeather() async {
        guard syncState != .refreshing else { return }
        syncState = .refreshing

        switch await NearcastWatchWeatherClient.refresh(fallback: snapshot) {
        case .success(let updated):
            guard !Task.isCancelled else { return }
            snapshot = updated
            syncState = .idle
            WidgetCenter.shared.reloadAllTimelines()
        case .missingPlace:
            guard !Task.isCancelled else { return }
            syncState = .missingPlace
        case .failed:
            guard !Task.isCancelled else { return }
            syncState = .failed
        }
    }
}

private struct WatchAccessibleOverview: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool
    @Binding var selectedSurface: WatchSurface

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(spacing: 16) {
                    WatchBriefPage(
                        snapshot: snapshot,
                        syncState: syncState,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                    .id(WatchSurface.brief)

                    Divider()

                    WatchHoursPage(
                        snapshot: snapshot,
                        syncState: syncState,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                    .id(WatchSurface.hours)

                    Divider()

                    WatchPlanPage(
                        snapshot: snapshot,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                    .id(WatchSurface.plan)
                }
            }
            .onAppear {
                reader.scrollTo(selectedSurface, anchor: .top)
            }
            .onChange(of: selectedSurface) { _, surface in
                withAnimation(.easeInOut(duration: 0.2)) {
                    reader.scrollTo(surface, anchor: .top)
                }
            }
        }
    }
}

private struct WatchBriefPage: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var isStale: Bool {
        !snapshot.hasWeatherData || snapshot.weatherAge > watchWeatherStaleInterval
    }

    var body: some View {
        let decision = weatherDecision(snapshot)

        VStack(alignment: .leading, spacing: useUltraLayout ? 9 : 6) {
            WatchPageHeader(
                section: "Brief",
                context: snapshot.hasWeatherData ? cityName(snapshot.placeName) : "Nearcast",
                trailing: snapshot.hasWeatherData ? (isStale ? "LAST \(snapshot.temperature)°" : "\(snapshot.temperature)°") : nil
            )

            if snapshot.hasWeatherData {
                WatchDecisionHero(
                    eyebrow: "Next",
                    headline: isStale ? "Weather update needed" : decision.headline,
                    detail: isStale
                        ? "Last report: \(snapshot.condition), \(snapshot.temperature)°."
                        : decision.detail,
                    symbol: isStale ? "arrow.triangle.2.circlepath" : decision.symbol,
                    color: isStale ? nearcastAmber : decision.color,
                    isLuminanceReduced: isLuminanceReduced
                )

                NearcastHorizon(
                    snapshot: snapshot,
                    maximumHours: useUltraLayout ? 5 : 4,
                    showsTemperature: false,
                    isStale: isStale,
                    isLuminanceReduced: isLuminanceReduced
                )
            } else {
                WatchNoWeatherMessage(isRefreshing: syncState == .refreshing)
            }

            Spacer(minLength: 0)
            WatchWeatherFreshness(snapshot: snapshot, syncState: syncState)
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Nearcast Brief")
    }
}

private struct WatchHoursPage: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var isStale: Bool {
        !snapshot.hasWeatherData || snapshot.weatherAge > watchWeatherStaleInterval
    }

    var body: some View {
        let rain = rainDecision(snapshot, maximumHours: useUltraLayout ? 6 : 5)

        VStack(alignment: .leading, spacing: useUltraLayout ? 9 : 6) {
            WatchPageHeader(
                section: "Hours",
                context: snapshot.hasWeatherData ? cityName(snapshot.placeName) : "Rain",
                trailing: nil
            )

            if snapshot.hasWeatherData {
                WatchDecisionHero(
                    eyebrow: "Rain next",
                    headline: isStale ? "Rain timing unavailable" : rain.headline,
                    detail: isStale ? "The saved hourly forecast is out of date." : rain.detail,
                    symbol: isStale ? "clock.badge.exclamationmark" : rain.symbol,
                    color: isStale ? nearcastAmber : nearcastCyan,
                    isLuminanceReduced: isLuminanceReduced,
                    compact: true
                )

                NearcastHorizon(
                    snapshot: snapshot,
                    maximumHours: useUltraLayout ? 6 : 5,
                    showsTemperature: true,
                    isStale: isStale,
                    isLuminanceReduced: isLuminanceReduced
                )
            } else {
                WatchNoWeatherMessage(isRefreshing: syncState == .refreshing)
            }

            Spacer(minLength: 0)
            WatchWeatherFreshness(snapshot: snapshot, syncState: syncState)
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Hourly rain forecast")
    }
}

private struct WatchPlanPage: View {
    let snapshot: NearcastWidgetSnapshot
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var isStale: Bool {
        snapshot.hasPlan && snapshot.planAge > watchPlanStaleInterval
    }

    var body: some View {
        let plan = planDecision(snapshot)

        VStack(alignment: .leading, spacing: useUltraLayout ? 10 : 7) {
            WatchPageHeader(
                section: "Plan check",
                context: cleanOptional(snapshot.planPlace) ?? "Watching",
                trailing: nil
            )

            if snapshot.hasPlan {
                WatchDecisionHero(
                    eyebrow: cleanOptional(snapshot.planTitle) ?? "Your plan",
                    headline: isStale ? "Update plan check" : plan.headline,
                    detail: isStale
                        ? "Open Nearcast on iPhone to recalculate this plan. Last result: \(plan.headline)."
                        : plan.detail,
                    symbol: isStale ? "calendar.badge.exclamationmark" : plan.symbol,
                    color: isStale ? nearcastAmber : plan.color,
                    isLuminanceReduced: isLuminanceReduced
                )
            } else {
                WatchEmptyPlan(isLuminanceReduced: isLuminanceReduced)
            }

            Spacer(minLength: 0)
            Text(planFreshnessText(snapshot))
                .watchFooterStyle()
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Plan Check")
    }
}

private struct WatchUnavailablePage: View {
    let syncState: WatchSyncState
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: useUltraLayout ? 12 : 9) {
            Spacer(minLength: 4)
            Image(systemName: syncState == .refreshing ? "arrow.triangle.2.circlepath" : "iphone.and.arrow.forward")
                .font(.system(size: useUltraLayout ? 34 : 29, weight: .semibold))
                .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                .symbolEffect(.pulse, isActive: syncState == .refreshing)
                .accessibilityHidden(true)
            Text(syncState == .refreshing ? "Loading weather" : "Weather unavailable")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.78)
                .fixedSize(horizontal: false, vertical: true)
            Text(unavailableGuidance(syncState))
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(watchSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Text("Nearcast updates automatically")
                .watchFooterStyle()
        }
        .padding(.horizontal, useUltraLayout ? 15 : 11)
        .padding(.vertical, useUltraLayout ? 10 : 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct WatchPageHeader: View {
    let section: String
    let context: String
    let trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(section.uppercased())
                .font(.system(.caption2, design: .rounded, weight: .bold))
                .tracking(0.9)
                .foregroundStyle(nearcastCyan)
            Text(context)
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(watchSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing)
                    .font(.system(.caption2, design: .rounded, weight: .bold).monospacedDigit())
                    .foregroundStyle(watchPrimary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct WatchDecisionHero: View {
    let eyebrow: String
    let headline: String
    let detail: String
    let symbol: String
    let color: Color
    let isLuminanceReduced: Bool
    var compact = false

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: symbol)
                .font(.system(size: compact ? 20 : 24, weight: .semibold))
                .foregroundStyle(isLuminanceReduced ? Color.white : color)
                .frame(width: compact ? 35 : 42, height: compact ? 35 : 42)
                .background(
                    Circle()
                        .fill(isLuminanceReduced ? Color.clear : color.opacity(0.16))
                        .overlay(Circle().stroke(color.opacity(isLuminanceReduced ? 0.7 : 0.22), lineWidth: 1))
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(eyebrow.uppercased())
                    .font(.system(.caption2, design: .rounded, weight: .bold))
                    .tracking(0.7)
                    .foregroundStyle(watchMuted)
                    .lineLimit(1)
                Text(headline)
                    .font(compact
                        ? .system(.title3, design: .rounded, weight: .bold)
                        : .system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(watchPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
                Text(detail)
                    .font(.system(.caption, design: .rounded, weight: .medium))
                    .foregroundStyle(watchSecondary)
                    .lineLimit(compact ? 1 : 2)
                    .minimumScaleFactor(0.75)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(eyebrow), \(headline)")
        .accessibilityValue(detail)
    }
}

private struct NearcastHorizon: View {
    let snapshot: NearcastWidgetSnapshot
    let maximumHours: Int
    let showsTemperature: Bool
    let isStale: Bool
    let isLuminanceReduced: Bool

    private var rows: [NearcastWidgetHour] {
        Array(activeTimeline(snapshot).prefix(maximumHours))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(isStale ? "LAST NEARCAST HORIZON" : "NEARCAST HORIZON")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .tracking(0.75)
                    .foregroundStyle(watchMuted)
                Spacer(minLength: 4)
                if let peak = rows.compactMap(\.rainChance).max() {
                    Text("PEAK \(peak)%")
                        .font(.system(size: 9, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(watchSecondary)
                }
            }

            if rows.isEmpty {
                Text("Hourly forecast unavailable")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(watchSecondary)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .center)
            } else {
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, hour in
                        let chance = max(0, min(100, hour.rainChance ?? 0))
                        VStack(spacing: 2) {
                            if showsTemperature {
                                Text(hour.temperature.map { "\($0)°" } ?? "—")
                                    .font(.system(size: 9, weight: .semibold, design: .rounded).monospacedDigit())
                                    .foregroundStyle(watchSecondary)
                            }
                            Text("\(chance)%")
                                .font(.system(size: 8, weight: .bold, design: .rounded).monospacedDigit())
                                .foregroundStyle(watchPrimary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Capsule()
                                .fill(barColor(index: index, rows: rows))
                                .frame(width: showsTemperature ? 8 : 9, height: max(4, CGFloat(chance) * (showsTemperature ? 0.34 : 0.38)))
                                .frame(height: showsTemperature ? 35 : 39, alignment: .bottom)
                            Text(hour.timeLabel)
                                .font(.system(size: 9, weight: .semibold, design: .rounded).monospacedDigit())
                                .foregroundStyle(watchSecondary)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .opacity(isStale ? 0.55 : 1)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(Color.white.opacity(isLuminanceReduced ? 0.04 : 0.08), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(Color.white.opacity(isLuminanceReduced ? 0.25 : 0.12), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isStale ? "Last Nearcast Horizon, out of date" : "Nearcast Horizon")
        .accessibilityValue(horizonAccessibility(rows))
    }

    private func barColor(index: Int, rows: [NearcastWidgetHour]) -> Color {
        if isLuminanceReduced { return .white.opacity(index == peakIndex(rows) ? 1 : 0.55) }
        if isStale { return .white.opacity(0.45) }
        return nearcastCyan.opacity(index == peakIndex(rows) ? 1 : 0.48)
    }
}

private struct WatchNoWeatherMessage: View {
    let isRefreshing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(isRefreshing ? "Loading weather" : "Weather unavailable", systemImage: isRefreshing ? "arrow.triangle.2.circlepath" : "cloud.slash")
                .font(.system(.headline, design: .rounded, weight: .bold))
                .foregroundStyle(watchPrimary)
            Text("Open Nearcast on iPhone once to share your place. The Watch will refresh directly after that.")
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(watchSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct WatchEmptyPlan: View {
    let isLuminanceReduced: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "calendar.badge.plus")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(isLuminanceReduced ? Color.white : nearcastMint)
                .accessibilityHidden(true)
            Text("No plan watched")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(watchPrimary)
            Text("Create or watch a plan in Nearcast on iPhone. Its weather verdict will appear here.")
                .font(.system(.caption, design: .rounded, weight: .medium))
                .foregroundStyle(watchSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct WatchWeatherFreshness: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState

    var body: some View {
        Text(weatherFreshnessText(snapshot, syncState: syncState))
            .watchFooterStyle()
    }
}

private struct WatchAppBackground: View {
    let isLuminanceReduced: Bool

    var body: some View {
        if isLuminanceReduced {
            Color.black
        } else {
            LinearGradient(
                colors: [Color(red: 0.02, green: 0.09, blue: 0.14), Color.black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

private struct WatchDecision {
    let headline: String
    let detail: String
    let symbol: String
    let color: Color
}

private struct WatchRainDecision {
    let headline: String
    let detail: String
    let symbol: String
    let peak: Int
}

private func weatherDecision(_ snapshot: NearcastWidgetSnapshot) -> WatchDecision {
    let rows = Array(activeTimeline(snapshot).prefix(6))
    let rain = rainDecision(snapshot, maximumHours: 6)
    let lowerCondition = snapshot.condition.lowercased()

    if snapshot.conditionCode >= 95 || lowerCondition.contains("storm") {
        return WatchDecision(
            headline: "Storms possible",
            detail: rain.peak > 0 ? "Rain chance peaks at \(rain.peak)%." : "Stay weather aware.",
            symbol: "cloud.bolt.rain.fill",
            color: nearcastCoral
        )
    }
    if rain.peak >= 30 {
        return WatchDecision(headline: rain.headline, detail: rain.detail, symbol: rain.symbol, color: nearcastCyan)
    }
    if snapshot.feelsLike >= 95 {
        return WatchDecision(
            headline: "Plan around heat",
            detail: "Feels like \(snapshot.feelsLike)° in \(cityName(snapshot.placeName)).",
            symbol: "thermometer.sun.fill",
            color: nearcastAmber
        )
    }
    if snapshot.feelsLike <= 32 {
        return WatchDecision(
            headline: "Freezing now",
            detail: "Feels like \(snapshot.feelsLike)°.",
            symbol: "thermometer.snowflake",
            color: nearcastCyan
        )
    }
    if let gust = rows.compactMap(\.windGust).max(), gust >= 25,
       let gustHour = rows.first(where: { ($0.windGust ?? 0) >= 25 }) {
        return WatchDecision(
            headline: "Gusty by \(gustHour.timeLabel)",
            detail: "Gusts reach \(gust) \(snapshot.windUnit).",
            symbol: "wind",
            color: nearcastCyan
        )
    }
    return WatchDecision(
        headline: "Looks steady",
        detail: "\(snapshot.condition) · Feels \(snapshot.feelsLike)°.",
        symbol: conditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay),
        color: nearcastMint
    )
}

private func rainDecision(_ snapshot: NearcastWidgetSnapshot, maximumHours: Int) -> WatchRainDecision {
    let rows = Array(activeTimeline(snapshot).prefix(maximumHours))
    let chances = rows.map { $0.rainChance ?? 0 }
    let peak = chances.max() ?? snapshot.rainChance
    let peakIndex = chances.firstIndex(of: peak) ?? 0
    let firstWet = rows.first(where: { ($0.rainChance ?? 0) >= 30 })
    let peakTime = rows.indices.contains(peakIndex) ? rows[peakIndex].timeLabel : nil

    if isCurrentRainCondition(snapshot.conditionCode) {
        return WatchRainDecision(
            headline: "Rain now",
            detail: peak > 0
                ? (peakTime.map { "Chance peaks at \(peak)% around \($0)." } ?? "Chance peaks at \(peak)%.")
                : "Rain is being reported now.",
            symbol: snapshot.conditionCode >= 95 ? "cloud.bolt.rain.fill" : "cloud.rain.fill",
            peak: peak
        )
    }

    if let firstWet {
        let isNow = firstWet.offsetHours == 0 || firstWet.timeLabel.lowercased() == "now"
        let chance = firstWet.rainChance ?? peak
        return WatchRainDecision(
            headline: isNow ? "Rain possible now" : "Rain possible near \(firstWet.timeLabel)",
            detail: isNow
                ? "\(chance)% chance now · Peak \(peak)%."
                : (peakTime.map { "Peak \(peak)% around \($0)." } ?? "Peak chance \(peak)%."),
            symbol: "cloud.rain.fill",
            peak: peak
        )
    }

    if peak > 0 {
        return WatchRainDecision(
            headline: "Low rain chance",
            detail: peakTime.map { "Peaks at \(peak)% around \($0)." } ?? "Peak chance is \(peak)%.",
            symbol: "drop.fill",
            peak: peak
        )
    }

    let horizonHours = max(1, rows.count)
    return WatchRainDecision(
        headline: "Dry next \(horizonHours) \(horizonHours == 1 ? "hour" : "hours")",
        detail: "No rain signal in the hourly forecast.",
        symbol: snapshot.isDay ? "cloud.sun.fill" : "cloud.moon.fill",
        peak: peak
    )
}

private func isCurrentRainCondition(_ code: Int) -> Bool {
    (51...67).contains(code) || (80...82).contains(code) || (95...99).contains(code)
}

private func planDecision(_ snapshot: NearcastWidgetSnapshot) -> WatchDecision {
    let headline = cleanOptional(snapshot.planLabel) ?? cleanOptional(snapshot.watchStatus) ?? "Watching"
    let detail = cleanOptional(snapshot.planDetail)
        ?? cleanOptional(snapshot.watchDetail)
        ?? "Nearcast is watching this plan against the forecast."
    let tone = (cleanOptional(snapshot.planTone) ?? cleanOptional(snapshot.watchTone) ?? "").lowercased()
    let changed = headline.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "changed"

    if changed || tone.contains("changed") || tone.contains("danger") || tone.contains("bad") {
        return WatchDecision(headline: headline, detail: detail, symbol: "exclamationmark.triangle.fill", color: nearcastCoral)
    }
    if tone.contains("watch") || tone.contains("caution") {
        return WatchDecision(headline: headline, detail: detail, symbol: "eye.fill", color: nearcastAmber)
    }
    if tone.contains("good") {
        return WatchDecision(headline: headline, detail: detail, symbol: "checkmark.circle.fill", color: nearcastMint)
    }
    return WatchDecision(headline: headline, detail: detail, symbol: "calendar.circle.fill", color: nearcastCyan)
}

private func activeTimeline(_ snapshot: NearcastWidgetSnapshot) -> [NearcastWidgetHour] {
    let rows = snapshot.timeline ?? []
    let currentThreshold = Date().timeIntervalSince1970 - 30 * 60
    let currentRows = rows.filter { hour in
        guard let startsAt = hour.startsAt else { return true }
        return startsAt >= currentThreshold
    }
    return currentRows.isEmpty ? rows : currentRows
}

private func peakIndex(_ rows: [NearcastWidgetHour]) -> Int {
    let values = rows.map { $0.rainChance ?? 0 }
    guard let peak = values.max() else { return 0 }
    return values.firstIndex(of: peak) ?? 0
}

private func horizonAccessibility(_ rows: [NearcastWidgetHour]) -> String {
    guard !rows.isEmpty else { return "Hourly forecast unavailable" }
    return rows.map { hour in
        let chance = hour.rainChance ?? 0
        let temperature = hour.temperature.map { ", \($0) degrees" } ?? ""
        return "\(hour.timeLabel), \(chance) percent rain\(temperature)"
    }.joined(separator: ". ")
}

private func conditionSymbol(_ code: Int, isDay: Bool) -> String {
    if code == 0 { return isDay ? "sun.max.fill" : "moon.stars.fill" }
    if code <= 3 { return isDay ? "cloud.sun.fill" : "cloud.moon.fill" }
    if code <= 48 { return "cloud.fog.fill" }
    if code <= 67 { return "cloud.rain.fill" }
    if code <= 77 { return "cloud.snow.fill" }
    if code <= 82 { return "cloud.heavyrain.fill" }
    if code <= 86 { return "cloud.snow.fill" }
    return "cloud.bolt.rain.fill"
}

private func weatherFreshnessText(_ snapshot: NearcastWidgetSnapshot, syncState: WatchSyncState) -> String {
    if syncState == .refreshing { return "Updating weather…" }
    if !snapshot.hasWeatherData {
        return syncState == .missingPlace ? "Choose a place on iPhone" : "No weather saved"
    }

    let age = durationText(snapshot.weatherAge)
    if snapshot.weatherAge > watchWeatherStaleInterval {
        return syncState == .failed ? "Update failed · Last weather \(age)" : "Weather is \(age) old"
    }
    return syncState == .failed ? "Using saved weather · \(age)" : "Weather updated \(age)"
}

private func planFreshnessText(_ snapshot: NearcastWidgetSnapshot) -> String {
    guard snapshot.hasPlan else { return "Plans sync from Nearcast on iPhone" }
    if snapshot.planAge > watchPlanStaleInterval { return "Plan check is \(durationText(snapshot.planAge)) old" }
    return "Plan checked \(durationText(snapshot.planAge))"
}

private func durationText(_ interval: TimeInterval) -> String {
    guard interval.isFinite else { return "not yet" }
    let minutes = max(0, Int(interval / 60))
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes)m ago" }
    return "\(max(1, minutes / 60))h ago"
}

private func unavailableGuidance(_ syncState: WatchSyncState) -> String {
    switch syncState {
    case .refreshing:
        return "Nearcast is checking your saved place."
    case .missingPlace:
        return "Open Nearcast on iPhone once to choose and share a place."
    case .failed:
        return "Nearcast could not reach the forecast. It will try again when the app opens."
    case .idle:
        return "Open Nearcast on iPhone once. Your place and forecast will sync here."
    }
}

private func cityName(_ value: String) -> String {
    let city = value.split(separator: ",", maxSplits: 1).first.map(String.init) ?? value
    let trimmed = city.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? value : trimmed
}

private func cleanOptional(_ value: String?) -> String? {
    let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private let watchPrimary = Color.white
private let watchSecondary = Color.white.opacity(0.76)
private let watchMuted = Color.white.opacity(0.58)
private let nearcastCyan = Color(red: 0.35, green: 0.79, blue: 1.0)
private let nearcastMint = Color(red: 0.45, green: 0.93, blue: 0.70)
private let nearcastAmber = Color(red: 1.0, green: 0.77, blue: 0.30)
private let nearcastCoral = Color(red: 1.0, green: 0.42, blue: 0.39)

private extension View {
    func watchPagePadding(_ useUltraLayout: Bool) -> some View {
        padding(.horizontal, useUltraLayout ? 11 : 8)
            .padding(.vertical, useUltraLayout ? 8 : 5)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    func watchFooterStyle() -> some View {
        font(.system(.caption2, design: .rounded, weight: .semibold))
            .foregroundStyle(watchMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

private enum NearcastWatchWeatherRefreshResult {
    case success(NearcastWidgetSnapshot)
    case missingPlace
    case failed
}

private enum NearcastWatchWeatherClient {
    static func refresh(fallback: NearcastWidgetSnapshot) async -> NearcastWatchWeatherRefreshResult {
        guard let place = NearcastWidgetPlace.stored() else { return .missingPlace }

        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        let metric = fallback.windUnit.lowercased().contains("km")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.5f", place.latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.5f", place.longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_direction_10m"),
            URLQueryItem(name: "hourly", value: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day"),
            URLQueryItem(name: "temperature_unit", value: metric ? "celsius" : "fahrenheit"),
            URLQueryItem(name: "wind_speed_unit", value: metric ? "kmh" : "mph"),
            URLQueryItem(name: "forecast_hours", value: "8"),
            URLQueryItem(name: "timezone", value: "auto")
        ]
        guard let url = components?.url else { return .failed }

        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            guard !Task.isCancelled,
                  (response as? HTTPURLResponse)?.statusCode == 200 else { return .failed }
            let forecast = try JSONDecoder().decode(WatchForecast.self, from: data)
            guard let current = forecast.current else { return .failed }

            guard let latestPlace = NearcastWidgetPlace.stored(), samePlace(place, latestPlace) else {
                // The paired iPhone changed places while this request was in flight.
                // Keep its newer snapshot instead of writing old-place weather over it.
                return .success(NearcastWidgetSnapshot.current())
            }

            let refreshedAt = Date().timeIntervalSince1970
            // A phone sync may have landed while the request was in flight. Merge
            // weather into the newest stored snapshot so its plan is not replaced.
            var updated = NearcastWidgetSnapshot.stored() ?? fallback
            updated.version = max(5, fallback.version)
            updated.placeName = place.displayLabel
            updated.temperature = Int(current.temperature.rounded())
            updated.feelsLike = Int(current.feelsLike.rounded())
            updated.conditionCode = current.weatherCode
            updated.condition = conditionLabel(current.weatherCode)
            updated.isDay = current.isDay == 1
            updated.wind = Int(current.windSpeed.rounded())
            updated.windDirection = Int(current.windDirection.rounded())
            updated.isAvailable = true
            updated.weatherSavedAt = refreshedAt

            if let hourly = forecast.hourly {
                let rows = hourly.rows(limit: 8, utcOffsetSeconds: forecast.utcOffsetSeconds ?? 0)
                updated.timeline = rows
                updated.rainChance = rows.first?.rainChance ?? fallback.rainChance
                updated.uv = rows.first?.uv ?? fallback.uv
            }

            // savedAt and planSavedAt intentionally stay unchanged. A weather-only
            // refresh cannot make an older plan verdict newly trustworthy.
            NearcastWidgetSnapshotStore.save(updated)
            return .success(updated)
        } catch {
            return .failed
        }
    }

    private static func samePlace(_ lhs: NearcastWidgetPlace, _ rhs: NearcastWidgetPlace) -> Bool {
        abs(lhs.latitude - rhs.latitude) < 0.00001 && abs(lhs.longitude - rhs.longitude) < 0.00001
    }
}

private struct WatchForecast: Decodable {
    let utcOffsetSeconds: Int?
    let current: Current?
    let hourly: Hourly?

    enum CodingKeys: String, CodingKey {
        case utcOffsetSeconds = "utc_offset_seconds"
        case current
        case hourly
    }

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

        func rows(limit: Int, utcOffsetSeconds: Int) -> [NearcastWidgetHour] {
            (0..<min(time.count, limit)).map { index in
                NearcastWidgetHour(
                    offsetHours: index,
                    timeLabel: shortHour(time[index]),
                    temperature: rounded(temperature?[safe: index] ?? nil),
                    feelsLike: rounded(feelsLike?[safe: index] ?? nil),
                    rainChance: rainChance?[safe: index] ?? nil,
                    wind: rounded(wind?[safe: index] ?? nil),
                    windGust: rounded(gust?[safe: index] ?? nil),
                    windDirection: rounded(windDirection?[safe: index] ?? nil),
                    uv: rounded(uv?[safe: index] ?? nil),
                    conditionCode: weatherCode?[safe: index] ?? nil,
                    isDay: (isDay?[safe: index] ?? nil).map { $0 == 1 },
                    startsAt: hourStart(time[index], utcOffsetSeconds: utcOffsetSeconds)
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

private func rounded(_ value: Double?) -> Int? {
    value.map { Int($0.rounded()) }
}

private func shortHour(_ raw: String) -> String {
    guard let hour = Int(raw.split(separator: "T").last?.split(separator: ":").first ?? "") else { return raw }
    if hour == 0 { return "12a" }
    if hour < 12 { return "\(hour)a" }
    if hour == 12 { return "12p" }
    return "\(hour - 12)p"
}

private func hourStart(_ raw: String, utcOffsetSeconds: Int) -> TimeInterval? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
    guard let localClockDate = formatter.date(from: raw) else { return nil }
    return localClockDate.timeIntervalSince1970 - TimeInterval(utcOffsetSeconds)
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
