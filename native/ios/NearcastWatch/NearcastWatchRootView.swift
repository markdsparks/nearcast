import Foundation
import SwiftUI
import WidgetKit

private let watchWeatherStaleInterval: TimeInterval = 12 * 60 * 60
private let watchPlanStaleInterval: TimeInterval = 2 * 60 * 60

private enum WatchSurface: String, Hashable {
    case today
    case hours
    case days
    case plan

    init?(url: URL) {
        guard url.scheme?.lowercased() == "nearcast" else { return nil }
        let surface = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "surface" })?
            .value?
            .lowercased()
        switch surface {
        case "next", "brief", "temperature", "today": self = .today
        case "rain", "hours": self = .hours
        case "wind": self = .today
        case "days": self = .days
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
    @State private var snapshot = watchSnapshotForDisplay()
    @State private var selectedSurface: WatchSurface = .today
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
                            WatchTodayBasicsPage(
                                snapshot: snapshot,
                                syncState: syncState,
                                isLuminanceReduced: isLuminanceReduced,
                                useUltraLayout: useUltraLayout
                            )
                            .tag(WatchSurface.today)

                            WatchBasicHoursPage(
                                snapshot: snapshot,
                                syncState: syncState,
                                isLuminanceReduced: isLuminanceReduced,
                                useUltraLayout: useUltraLayout
                            )
                            .tag(WatchSurface.hours)

                            WatchThreeDayPage(
                                snapshot: snapshot,
                                isLuminanceReduced: isLuminanceReduced,
                                useUltraLayout: useUltraLayout
                            )
                            .tag(WatchSurface.days)

                            if snapshot.hasPlan {
                                WatchPlanPage(
                                    snapshot: snapshot,
                                    isLuminanceReduced: isLuminanceReduced,
                                    useUltraLayout: useUltraLayout
                                )
                                .tag(WatchSurface.plan)
                            }
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
            applySnapshot(watchSnapshotForDisplay())
        }
        .task {
            await refreshWeather()
        }
        .onOpenURL { url in
            guard let surface = WatchSurface(url: url) else { return }
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedSurface = safeWatchSurface(surface, snapshot: snapshot)
            }
        }
        .onChange(of: snapshotReceiver.revision) { _, _ in
            applySnapshot(watchSnapshotForDisplay())
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            snapshotReceiver.activate()
            applySnapshot(watchSnapshotForDisplay())
            Task { await refreshWeather() }
        }
    }

    @MainActor
    private func applySnapshot(_ updated: NearcastWidgetSnapshot) {
        snapshot = updated
        selectedSurface = safeWatchSurface(selectedSurface, snapshot: updated)
    }

    @MainActor
    private func refreshWeather() async {
        guard syncState != .refreshing else { return }
        syncState = .refreshing

        switch await NearcastWatchWeatherClient.refresh(fallback: snapshot) {
        case .success(let updated):
            guard !Task.isCancelled else { return }
            applySnapshot(updated)
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
                    WatchTodayBasicsPage(
                        snapshot: snapshot,
                        syncState: syncState,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                    .id(WatchSurface.today)

                    Divider()

                    WatchBasicHoursPage(
                        snapshot: snapshot,
                        syncState: syncState,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                    .id(WatchSurface.hours)

                    Divider()

                    WatchThreeDayPage(
                        snapshot: snapshot,
                        isLuminanceReduced: isLuminanceReduced,
                        useUltraLayout: useUltraLayout
                    )
                    .id(WatchSurface.days)

                    if snapshot.hasPlan {
                        Divider()

                        WatchPlanPage(
                            snapshot: snapshot,
                            isLuminanceReduced: isLuminanceReduced,
                            useUltraLayout: useUltraLayout
                        )
                        .id(WatchSurface.plan)
                    }
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

private struct WatchTodayBasicsPage: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: useUltraLayout ? 10 : 7) {
            if snapshot.hasWeatherData {
                HStack(spacing: 7) {
                    Image(systemName: watchConditionSymbol(snapshot.conditionCode, isDay: snapshot.isDay))
                        .font(.system(size: useUltraLayout ? 22 : 20, weight: .semibold))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                        .accessibilityHidden(true)
                    Text(cityName(snapshot.placeName))
                        .font(.system(size: useUltraLayout ? 17 : 15, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 0)
                }

                WatchTodayInfographic(
                    snapshot: snapshot,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            } else {
                WatchNoWeatherMessage(
                    isRefreshing: syncState == .refreshing,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            }

            Spacer(minLength: 0)
            WatchSavedForecastStatus(snapshot: snapshot, syncState: syncState)
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Today in \(cityName(snapshot.placeName))")
    }
}

private struct WatchTodayInfographic: View {
    let snapshot: NearcastWidgetSnapshot
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        HStack(spacing: useUltraLayout ? 11 : 8) {
            WatchTemperatureRange(
                snapshot: snapshot,
                isLuminanceReduced: isLuminanceReduced,
                useUltraLayout: useUltraLayout
            )
            .frame(maxWidth: .infinity)

            Rectangle()
                .fill(Color.white.opacity(0.13))
                .frame(width: 1)

            VStack(spacing: useUltraLayout ? 10 : 8) {
                WatchWindVector(
                    snapshot: snapshot,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
                WatchRainProbability(
                    snapshot: snapshot,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, useUltraLayout ? 12 : 9)
        .padding(.vertical, useUltraLayout ? 12 : 10)
        .frame(maxWidth: .infinity)
        .frame(height: useUltraLayout ? 126 : 116)
        .background(Color.white.opacity(isLuminanceReduced ? 0 : 0.075), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.white.opacity(isLuminanceReduced ? 0.32 : 0.10), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(snapshot.temperature) degrees, low \(snapshot.low.map(String.init) ?? "unavailable"), high \(snapshot.high.map(String.init) ?? "unavailable"), wind from \(watchWindCardinal(snapshot)) at \(snapshot.wind) \(snapshot.windUnit), rain chance \(snapshot.rainChance) percent")
    }
}

private struct WatchTemperatureRange: View {
    let snapshot: NearcastWidgetSnapshot
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: useUltraLayout ? 8 : 6) {
            Text("\(snapshot.temperature)°")
                .font(.system(size: useUltraLayout ? 47 : 42, weight: .bold, design: .rounded).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            GeometryReader { proxy in
                let progress = temperatureProgress(snapshot)
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.14))
                    LinearGradient(
                        colors: isLuminanceReduced ? [.white, .white] : [nearcastCyan, nearcastAmber],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .clipShape(Capsule())
                    Circle()
                        .fill(Color.white)
                        .frame(width: 10, height: 10)
                        .shadow(color: .black.opacity(0.45), radius: 2)
                        .offset(x: max(0, (proxy.size.width - 10) * progress))
                }
            }
            .frame(height: 10)

            HStack {
                Text(snapshot.low.map { "\($0)°" } ?? "—")
                Spacer(minLength: 4)
                Text(snapshot.high.map { "\($0)°" } ?? "—")
            }
            .font(.system(size: useUltraLayout ? 16 : 14, weight: .bold, design: .rounded).monospacedDigit())
            .foregroundStyle(watchSecondary)
        }
    }
}

private struct WatchWindVector: View {
    let snapshot: NearcastWidgetSnapshot
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: useUltraLayout ? 8 : 6) {
                Image(systemName: snapshot.windDirection == nil ? "wind" : "location.north.fill")
                    .font(.system(size: useUltraLayout ? 25 : 22, weight: .bold))
                    .foregroundStyle(isLuminanceReduced ? Color.white : nearcastMint)
                    .rotationEffect(.degrees(Double(snapshot.windDirection ?? 0)))
                    .frame(width: useUltraLayout ? 29 : 26)
                Text("\(snapshot.wind)")
                    .font(.system(size: useUltraLayout ? 27 : 24, weight: .bold, design: .rounded).monospacedDigit())
                    .lineLimit(1)
            }
            HStack(spacing: 5) {
                Text(watchWindCardinal(snapshot))
                    .font(.system(size: useUltraLayout ? 15 : 13, weight: .bold, design: .rounded))
                    .foregroundStyle(watchSecondary)
                Text(shortWatchWindUnit(snapshot.windUnit))
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(watchMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WatchRainProbability: View {
    let snapshot: NearcastWidgetSnapshot
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var values: [Int] {
        let hourly = (snapshot.timeline ?? []).prefix(4).compactMap(\.rainChance)
        return hourly.isEmpty ? [snapshot.rainChance] : hourly
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: useUltraLayout ? 7 : 5) {
                Image(systemName: "drop.fill")
                    .font(.system(size: useUltraLayout ? 23 : 20, weight: .bold))
                    .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                Text("\(snapshot.rainChance)%")
                    .font(.system(size: useUltraLayout ? 25 : 22, weight: .bold, design: .rounded).monospacedDigit())
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                    Capsule()
                        .fill(isLuminanceReduced ? Color.white : nearcastCyan)
                        .frame(maxWidth: .infinity)
                        .frame(height: max(2, CGFloat(value) / 100 * CGFloat(useUltraLayout ? 18 : 16)))
                }
            }
            .frame(maxWidth: useUltraLayout ? 58 : 50)
            .frame(height: useUltraLayout ? 18 : 16, alignment: .bottom)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct WatchBasicHoursPage: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: useUltraLayout ? 8 : 6) {
            if snapshot.hasWeatherData, let timeline = snapshot.timeline, !timeline.isEmpty {
                HStack(alignment: .top, spacing: useUltraLayout ? 6 : 4) {
                    ForEach(Array(timeline.prefix(3))) { hour in
                        VStack(spacing: useUltraLayout ? 6 : 4) {
                            Text(hour.offsetHours == 0 ? "Now" : hour.timeLabel)
                                .font(.system(size: useUltraLayout ? 13 : 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(hour.offsetHours == 0 ? watchPrimary : watchMuted)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Image(systemName: watchConditionSymbol(hour.conditionCode ?? snapshot.conditionCode, isDay: hour.isDay ?? snapshot.isDay))
                                .font(.system(size: useUltraLayout ? 29 : 25, weight: .semibold))
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                            Text(hour.temperature.map { "\($0)°" } ?? "—")
                                .font(.system(size: useUltraLayout ? 22 : 20, weight: .bold, design: .rounded).monospacedDigit())
                            HStack(spacing: 2) {
                                Image(systemName: "drop.fill")
                                    .font(.system(size: 10, weight: .bold))
                                Text(hour.rainChance.map { "\($0)%" } ?? "—")
                                    .font(.system(size: useUltraLayout ? 13 : 12, weight: .semibold, design: .rounded).monospacedDigit())
                            }
                            .foregroundStyle((hour.rainChance ?? 0) >= 30 ? nearcastCyan : watchMuted)
                        }
                        .padding(.vertical, useUltraLayout ? 8 : 6)
                        .frame(maxWidth: .infinity)
                        .background(
                            Color.white.opacity(hour.offsetHours == 0 && !isLuminanceReduced ? 0.11 : 0.05),
                            in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                        )
                    }
                }
            } else {
                WatchNoWeatherMessage(
                    isRefreshing: syncState == .refreshing,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            }
            Spacer(minLength: 0)
            WatchSavedForecastStatus(snapshot: snapshot, syncState: syncState)
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Next hours basics")
    }
}

private struct WatchThreeDayPage: View {
    let snapshot: NearcastWidgetSnapshot
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: useUltraLayout ? 8 : 6) {
            if let days = snapshot.daily, !days.isEmpty {
                ForEach(Array(days.prefix(3))) { day in
                    HStack(spacing: useUltraLayout ? 9 : 7) {
                        Text(day.label)
                            .font(.system(size: useUltraLayout ? 15 : 14, weight: .bold, design: .rounded))
                            .foregroundStyle(watchSecondary)
                            .frame(width: useUltraLayout ? 48 : 43, alignment: .leading)
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                        Image(systemName: watchConditionSymbol(day.conditionCode, isDay: true))
                            .font(.system(size: useUltraLayout ? 27 : 24, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                            .frame(width: useUltraLayout ? 29 : 25)
                        HStack(alignment: .lastTextBaseline, spacing: 4) {
                            Text("\(day.high)°")
                                .font(.system(size: useUltraLayout ? 22 : 20, weight: .bold, design: .rounded).monospacedDigit())
                            Text("\(day.low)°")
                                .font(.system(size: useUltraLayout ? 17 : 15, weight: .semibold, design: .rounded).monospacedDigit())
                                .foregroundStyle(watchMuted)
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        Label("\(day.rainChance)%", systemImage: "drop.fill")
                            .font(.system(size: useUltraLayout ? 14 : 13, weight: .bold, design: .rounded).monospacedDigit())
                            .foregroundStyle(day.rainChance >= 30 ? nearcastCyan : watchSecondary)
                            .frame(width: 43, alignment: .trailing)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, useUltraLayout ? 8 : 6)
                    .background(Color.white.opacity(isLuminanceReduced ? 0 : 0.055), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "calendar")
                        .font(.system(size: 31, weight: .semibold))
                        .foregroundStyle(watchSecondary)
                    Text("3-day forecast loading")
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .foregroundStyle(watchSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Spacer(minLength: 0)
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Three day forecast")
    }
}

private struct WatchSavedForecastStatus: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState

    var body: some View {
        if syncState == .failed, snapshot.hasWeatherData {
            Label("Saved forecast", systemImage: "wifi.slash")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(watchMuted)
                .frame(maxWidth: .infinity, alignment: .center)
        } else if snapshot.hasWeatherData && snapshot.weatherAge > 2 * 60 * 60 {
            Label(durationText(snapshot.weatherAge), systemImage: "clock")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(watchMuted)
                .frame(maxWidth: .infinity, alignment: .center)
        } else if syncState == .refreshing {
            Label("Refreshing", systemImage: "arrow.triangle.2.circlepath")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(watchMuted)
                .frame(maxWidth: .infinity, alignment: .center)
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
        let visualSignal = NearcastVisualSignalModel.make(
            snapshot: snapshot,
            horizonHours: useUltraLayout ? 6 : 5
        ).primaryWeather
        let signal = WatchVisualSignal(visualSignal, isStale: isStale)

        VStack(alignment: .leading, spacing: useUltraLayout ? 10 : 7) {
            WatchPlaceHeader(snapshot.hasWeatherData ? cityName(snapshot.placeName) : "Nearcast")

            if snapshot.hasWeatherData {
                WatchVisualHero(
                    signal: signal,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )

                NearcastWeatherRibbon(
                    signal: visualSignal,
                    isStale: isStale,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            } else {
                WatchNoWeatherMessage(
                    isRefreshing: syncState == .refreshing,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            }

            Spacer(minLength: 0)
            WatchExceptionalWeatherStatus(snapshot: snapshot, syncState: syncState)
        }
        .watchPagePadding(useUltraLayout)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Nearcast weather brief for \(cityName(snapshot.placeName))")
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
        let visualSignal = NearcastVisualSignalModel.make(
            snapshot: snapshot,
            horizonHours: useUltraLayout ? 6 : 5
        ).rain
        let signal = WatchVisualSignal(visualSignal, isStale: isStale)

        VStack(alignment: .leading, spacing: useUltraLayout ? 10 : 7) {
            WatchPlaceHeader(snapshot.hasWeatherData ? cityName(snapshot.placeName) : "Rain")

            if snapshot.hasWeatherData {
                WatchVisualHero(
                    signal: signal,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )

                NearcastWeatherRibbon(
                    signal: visualSignal,
                    isStale: isStale,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            } else {
                WatchNoWeatherMessage(
                    isRefreshing: syncState == .refreshing,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            }

            Spacer(minLength: 0)
            WatchExceptionalWeatherStatus(snapshot: snapshot, syncState: syncState)
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
        let signals = NearcastVisualSignalModel.make(
            snapshot: snapshot,
            horizonHours: useUltraLayout ? 6 : 5
        )
        let plan = signals.plan

        VStack(spacing: useUltraLayout ? 10 : 7) {
            if snapshot.hasPlan, let plan {
                WatchPlanVerdict(
                    snapshot: snapshot,
                    signal: plan,
                    weatherSignal: signals.planWeather,
                    isStale: isStale,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            } else {
                WatchEmptyPlan(
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            }
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

    private var title: String {
        switch syncState {
        case .refreshing: return "Loading"
        case .failed: return "Couldn't load"
        case .missingPlace, .idle: return "Add a place"
        }
    }

    var body: some View {
        VStack(spacing: useUltraLayout ? 12 : 9) {
            Spacer(minLength: 4)
            Image(systemName: syncState == .refreshing ? "arrow.triangle.2.circlepath" : "iphone.and.arrow.forward")
                .font(.system(size: useUltraLayout ? 48 : 40, weight: .semibold))
                .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                .symbolEffect(.pulse, isActive: syncState == .refreshing)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
            Text(unavailableVisualGuidance(syncState))
                .font(.system(.body, design: .rounded, weight: .medium))
                .foregroundStyle(watchSecondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
        }
        .padding(.horizontal, useUltraLayout ? 15 : 11)
        .padding(.vertical, useUltraLayout ? 10 : 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct WatchPlaceHeader: View {
    let place: String

    init(_ place: String) {
        self.place = place
    }

    var body: some View {
        HStack {
            Text(place)
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .foregroundStyle(watchSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 56)
        }
        .accessibilityLabel("Weather for \(place)")
    }
}

private enum WatchRibbonMetric: Equatable {
    case rain
    case wind
    case temperature
}

private struct WatchVisualSignal {
    let metric: String
    let unit: String?
    let caption: String
    let support: String?
    let symbol: String
    let color: Color

    init(_ signal: NearcastVisualSignal, isStale: Bool) {
        let display = watchMagnitudeDisplay(signal)
        metric = display.metric
        unit = display.unit

        if isStale {
            caption = "Update needed"
            support = "Saved outlook"
            symbol = "arrow.triangle.2.circlepath"
            color = nearcastAmber
        } else {
            caption = watchSignalCaption(signal)
            support = watchSignalSupport(signal)
            symbol = signal.symbolName
            color = watchSignalColor(signal.tone)
        }

    }
}

private struct WatchVisualHero: View {
    let signal: WatchVisualSignal
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool
    @ScaledMetric(relativeTo: .largeTitle) private var ultraMetricSize: CGFloat = 41
    @ScaledMetric(relativeTo: .largeTitle) private var standardMetricSize: CGFloat = 35
    @ScaledMetric(relativeTo: .title2) private var ultraWordMetricSize: CGFloat = 30
    @ScaledMetric(relativeTo: .title2) private var standardWordMetricSize: CGFloat = 26
    @ScaledMetric(relativeTo: .title) private var ultraSymbolSize: CGFloat = 34
    @ScaledMetric(relativeTo: .title) private var standardSymbolSize: CGFloat = 29

    var body: some View {
        HStack(alignment: .center, spacing: useUltraLayout ? 12 : 9) {
            Image(systemName: signal.symbol)
                .font(.system(size: useUltraLayout ? ultraSymbolSize : standardSymbolSize, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(isLuminanceReduced ? Color.white : signal.color)
                .frame(
                    width: useUltraLayout ? 58 : 50,
                    height: useUltraLayout ? 58 : 50
                )
                .background(
                    Circle()
                        .fill(isLuminanceReduced ? Color.clear : signal.color.opacity(0.15))
                        .overlay(
                            Circle()
                                .stroke(
                                    isLuminanceReduced ? Color.white.opacity(0.65) : signal.color.opacity(0.28),
                                    lineWidth: 1.5
                                )
                        )
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(signal.metric)
                        .font(.system(
                            size: signal.metric.count > 5
                                ? (useUltraLayout ? ultraWordMetricSize : standardWordMetricSize)
                                : (useUltraLayout ? ultraMetricSize : standardMetricSize),
                            weight: .bold,
                            design: .rounded
                        ).monospacedDigit())
                        .foregroundStyle(watchPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if let unit = signal.unit {
                        Text(unit)
                            .font(.system(.headline, design: .rounded, weight: .bold))
                            .foregroundStyle(watchSecondary)
                            .lineLimit(1)
                    }
                }

                Text(signal.caption)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(watchPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)

                if let support = signal.support, !isLuminanceReduced {
                    Text(support)
                        .font(.system(.body, design: .rounded, weight: .medium))
                        .foregroundStyle(watchSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.88)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(signal.caption), \(signal.metric)\(signal.unit.map { " \($0)" } ?? "")")
        .accessibilityValue(signal.support ?? "")
    }
}

private struct NearcastWeatherRibbon: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let signal: NearcastVisualSignal
    let isStale: Bool
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var points: [NearcastVisualTimelinePoint] {
        sampledSignalPoints(
            signal.timelinePoints,
            maximumPoints: useUltraLayout ? 4 : 3
        )
    }

    private var metric: WatchRibbonMetric {
        watchRibbonMetric(signal.kind)
    }

    var body: some View {
        Group {
            if points.isEmpty {
                Image(systemName: "ellipsis")
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(watchMuted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if metric == .rain && signal.headline == "Dry" {
                WatchDryRibbon(
                    points: points,
                    startSymbol: signal.symbolName,
                    color: ribbonColor,
                    useUltraLayout: useUltraLayout
                )
            } else if metric == .rain && !signal.isActionable {
                WatchQuietRainRibbon(
                    points: points,
                    color: ribbonColor,
                    useUltraLayout: useUltraLayout
                )
            } else if metric == .rain && points.allSatisfy({ ($0.magnitude?.value ?? 0) == 0 }) {
                WatchConditionRibbon(
                    points: points,
                    color: ribbonColor,
                    showsTemperature: false,
                    useUltraLayout: useUltraLayout
                )
            } else if metric == .temperature {
                WatchConditionRibbon(
                    points: points,
                    color: ribbonColor,
                    showsTemperature: signal.kind == .temperature,
                    useUltraLayout: useUltraLayout
                )
            } else {
                WatchMetricRibbon(
                    points: points,
                    metric: metric,
                    color: ribbonColor,
                    useUltraLayout: useUltraLayout
                )
            }
        }
        .padding(.horizontal, useUltraLayout ? 11 : 9)
        .padding(.vertical, useUltraLayout ? 8 : 6)
        .frame(minHeight: useUltraLayout ? 76 : 66)
        .frame(height: dynamicTypeSize.isAccessibilitySize ? nil : (useUltraLayout ? 76 : 66))
        .background(
            isLuminanceReduced ? Color.clear : ribbonColor.opacity(0.09),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    isLuminanceReduced ? Color.white.opacity(0.38) : ribbonColor.opacity(0.25),
                    lineWidth: 1.25
                )
        )
        .opacity(isStale ? 0.62 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isStale ? "Saved weather ribbon, out of date" : ribbonAccessibilityLabel)
        .accessibilityValue(signal.accessibilityDescription)
    }

    private var ribbonColor: Color {
        if isLuminanceReduced { return .white }
        switch metric {
        case .rain, .wind: return nearcastCyan
        case .temperature: return nearcastMint
        }
    }

    private var ribbonAccessibilityLabel: String {
        switch metric {
        case .rain: return "Rain outlook"
        case .wind: return "Wind outlook"
        case .temperature: return "Weather outlook"
        }
    }

}

private struct WatchConditionRibbon: View {
    let points: [NearcastVisualTimelinePoint]
    let color: Color
    let showsTemperature: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: 3) {
            ZStack {
                Capsule()
                    .fill(color.opacity(0.32))
                    .frame(height: 2)
                    .padding(.horizontal, 10)
                    .offset(y: -8)

                HStack(spacing: 4) {
                    ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                        VStack(spacing: 1) {
                            Image(systemName: point.symbolName)
                            .font(.system(size: useUltraLayout ? 19 : 17, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(color)
                            .frame(width: useUltraLayout ? 26 : 22, height: 23)
                            .background(Color.black, in: Circle())

                            if showsTemperature,
                               index == 0 || index == points.count - 1 || point.isEvent {
                                Text(point.temperature.map { "\($0)°" } ?? "—")
                                    .font(.system(.body, design: .rounded, weight: .bold).monospacedDigit())
                                    .foregroundStyle(watchPrimary)
                                    .lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }

            WatchRibbonEndpoints(
                start: points.first?.timeLabel ?? "Now",
                end: points.last?.timeLabel ?? "Later"
            )
        }
    }
}

private struct WatchDryRibbon: View {
    let points: [NearcastVisualTimelinePoint]
    let startSymbol: String
    let color: Color
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 7) {
                Image(systemName: startSymbol)
                .font(.system(size: useUltraLayout ? 19 : 17, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(color)
                .frame(width: useUltraLayout ? 30 : 26, height: useUltraLayout ? 30 : 26)
                .background(color.opacity(0.13), in: Circle())

                Capsule()
                    .fill(color.opacity(0.55))
                    .frame(height: 4)
                    .overlay(alignment: .trailing) {
                        Circle()
                            .fill(color)
                            .frame(width: 9, height: 9)
                    }

                Image(systemName: "checkmark")
                    .font(.system(size: useUltraLayout ? 17 : 15, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: useUltraLayout ? 30 : 26, height: useUltraLayout ? 30 : 26)
                    .overlay(Circle().stroke(color.opacity(0.7), lineWidth: 1.5))
            }

            WatchRibbonEndpoints(
                start: points.first?.timeLabel ?? "Now",
                end: points.last?.timeLabel ?? "Later"
            )
        }
    }
}

private struct WatchQuietRainRibbon: View {
    let points: [NearcastVisualTimelinePoint]
    let color: Color
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: 5) {
            HStack(spacing: 7) {
                Image(systemName: "drop.fill")
                    .font(.system(size: useUltraLayout ? 18 : 16, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: useUltraLayout ? 30 : 26, height: useUltraLayout ? 30 : 26)
                    .background(color.opacity(0.13), in: Circle())

                Capsule()
                    .fill(color.opacity(0.42))
                    .frame(height: 3)
                    .overlay(alignment: .trailing) {
                        Circle()
                            .fill(color)
                            .frame(width: 7, height: 7)
                    }

                Circle()
                    .stroke(color.opacity(0.7), lineWidth: 1.5)
                    .frame(width: useUltraLayout ? 12 : 10, height: useUltraLayout ? 12 : 10)
                    .frame(width: useUltraLayout ? 30 : 26, height: useUltraLayout ? 30 : 26)
            }

            WatchRibbonEndpoints(
                start: points.first?.timeLabel ?? "Now",
                end: points.last?.timeLabel ?? "Later"
            )
        }
    }
}

private struct WatchMetricRibbon: View {
    let points: [NearcastVisualTimelinePoint]
    let metric: WatchRibbonMetric
    let color: Color
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: 3) {
            if metric == .rain {
                WatchRainBars(points: points, color: color)
                    .frame(height: useUltraLayout ? 36 : 30)
            } else {
                WatchRibbonGraph(points: points, color: color)
                    .frame(height: useUltraLayout ? 36 : 30)
            }
            WatchRibbonEndpoints(
                start: points.first?.timeLabel ?? "Now",
                end: points.last?.timeLabel ?? "Later"
            )
        }
    }
}

private struct WatchRainBars: View {
    let points: [NearcastVisualTimelinePoint]
    let color: Color

    var body: some View {
        GeometryReader { proxy in
            let positions = watchTimelineXPositions(points, width: proxy.size.width, inset: 6)
            ZStack(alignment: .bottomLeading) {
                ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                    let value = point.magnitude?.normalizedValue ?? 0
                    let height = max(5, 5 + CGFloat(min(1, max(0, value))) * max(0, proxy.size.height - 9))
                    Capsule()
                        .fill(point.isEvent ? color : color.opacity(0.45))
                        .frame(width: point.isEvent ? 12 : 9, height: height)
                        .overlay {
                            if point.isEvent {
                                Capsule().stroke(Color.white.opacity(0.8), lineWidth: 1)
                            }
                        }
                        .position(x: positions[index], y: proxy.size.height - height / 2)
                }
            }
        }
    }
}

private struct WatchRibbonGraph: View {
    let points: [NearcastVisualTimelinePoint]
    let color: Color

    var body: some View {
        GeometryReader { proxy in
            let drawnPoints = graphPoints(in: proxy.size)
            let emphasized = points.firstIndex(where: { $0.isEvent }) ?? peakGraphIndex

            ZStack {
                if drawnPoints.count > 1 {
                    Path { path in
                        guard let first = drawnPoints.first, let last = drawnPoints.last else { return }
                        path.move(to: CGPoint(x: first.x, y: proxy.size.height))
                        path.addLine(to: first)
                        for point in drawnPoints.dropFirst() {
                            path.addLine(to: point)
                        }
                        path.addLine(to: CGPoint(x: last.x, y: proxy.size.height))
                        path.closeSubpath()
                    }
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(0.34), color.opacity(0.03)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                    Path { path in
                        guard let first = drawnPoints.first else { return }
                        path.move(to: first)
                        for point in drawnPoints.dropFirst() {
                            path.addLine(to: point)
                        }
                    }
                    .stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                }

                ForEach(Array(drawnPoints.enumerated()), id: \.offset) { index, point in
                    Circle()
                        .fill(index == emphasized ? color : Color.black)
                        .frame(width: index == emphasized ? 10 : 7, height: index == emphasized ? 10 : 7)
                        .overlay(Circle().stroke(color, lineWidth: 2))
                        .position(point)
                }
            }
        }
    }

    private var peakGraphIndex: Int {
        let values = points.map { $0.magnitude?.normalizedValue ?? 0 }
        guard let peak = values.max() else { return 0 }
        return values.firstIndex(of: peak) ?? 0
    }

    private func graphPoints(in size: CGSize) -> [CGPoint] {
        guard !points.isEmpty else { return [] }

        let drawableHeight = max(0, size.height - 10)
        let xPositions = watchTimelineXPositions(points, width: size.width, inset: 6)
        return points.enumerated().map { index, point in
            let value = point.magnitude?.normalizedValue ?? 0
            let normalized = min(1, max(0, value))
            return CGPoint(
                x: xPositions[index],
                y: 5 + drawableHeight * (1 - normalized)
            )
        }
    }
}

private struct WatchRibbonEndpoints: View {
    let start: String
    let end: String

    var body: some View {
        HStack {
            Text(start)
            Spacer()
            Text(end)
        }
        .font(.system(.caption, design: .rounded, weight: .semibold).monospacedDigit())
        .foregroundStyle(watchSecondary)
        .lineLimit(1)
        .accessibilityHidden(true)
    }
}

private struct WatchPlanVerdict: View {
    let snapshot: NearcastWidgetSnapshot
    let signal: NearcastVisualSignal
    let weatherSignal: NearcastVisualSignal?
    let isStale: Bool
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var verdict: String {
        isStale ? "UPDATE" : (signal.planVerdict?.rawValue ?? signal.headline.uppercased())
    }

    private var color: Color {
        isLuminanceReduced ? .white : (isStale ? nearcastAmber : watchSignalColor(signal.tone))
    }

    private var symbol: String {
        isStale ? "arrow.triangle.2.circlepath" : signal.symbolName
    }

    private var planContext: String {
        let rawTitle = signal.context ?? cleanOptional(snapshot.planTitle) ?? "Your plan"
        guard let place = cleanOptional(snapshot.planPlace) else {
            return conciseWatchWords(rawTitle, maximumCharacters: 22)
        }
        let title = conciseWatchWords(rawTitle, maximumCharacters: 12)
        return "\(title) · \(cityName(place))"
    }

    private var showsPlanOverlap: Bool {
        guard !isStale,
              cleanOptional(snapshot.planPlace) == nil,
              let weatherSignal,
              let planWindow = signal.timeWindow,
              let forecastWindow = watchTimelineBounds(weatherSignal.timelinePoints)
        else { return false }
        return planWindow.endAt > forecastWindow.startAt && planWindow.startAt < forecastWindow.endAt
    }

    var body: some View {
        VStack(spacing: useUltraLayout ? 8 : 6) {
            Spacer(minLength: 0)

            Image(systemName: symbol)
                .font(.system(size: useUltraLayout ? 34 : 30, weight: .bold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(color)
                .frame(width: useUltraLayout ? 64 : 56, height: useUltraLayout ? 64 : 56)
                .background(isLuminanceReduced ? Color.clear : color.opacity(0.14), in: Circle())
                .overlay(Circle().stroke(color.opacity(0.7), lineWidth: 2))
                .accessibilityHidden(true)

            Text(verdict)
                .font(.system(size: useUltraLayout ? 32 : 27, weight: .heavy, design: .rounded))
                .foregroundStyle(watchPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)

            Text(planContext)
                .font(.system(.headline, design: .rounded, weight: .semibold))
                .foregroundStyle(watchSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)

            if showsPlanOverlap, let weatherSignal, let planWindow = signal.timeWindow {
                WatchPlanOverlapRibbon(
                    signal: weatherSignal,
                    planWindow: planWindow,
                    color: color,
                    isLuminanceReduced: isLuminanceReduced,
                    useUltraLayout: useUltraLayout
                )
            } else if !isLuminanceReduced {
                Text(isStale ? "Open Nearcast on iPhone" : (signal.detail ?? "Open Nearcast for details"))
                    .font(.system(.body, design: .rounded, weight: .medium))
                    .foregroundStyle(isStale ? nearcastAmber : watchSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.9)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Plan check, \(verdict), \(planContext)")
        .accessibilityValue(isStale ? "Update needed. Open Nearcast on iPhone." : signal.accessibilityDescription)
    }
}

private struct WatchPlanOverlapRibbon: View {
    let signal: NearcastVisualSignal
    let planWindow: NearcastVisualTimeWindow
    let color: Color
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    private var points: [NearcastVisualTimelinePoint] {
        sampledSignalPoints(signal.timelinePoints, maximumPoints: useUltraLayout ? 5 : 4)
    }

    var body: some View {
        VStack(spacing: 3) {
            GeometryReader { proxy in
                let positions = watchTimelineXPositions(points, width: proxy.size.width, inset: 12)
                let planStartX = watchTimelineXPosition(
                    timestamp: planWindow.startAt,
                    points: points,
                    width: proxy.size.width,
                    inset: 12
                )
                let planEndX = watchTimelineXPosition(
                    timestamp: planWindow.endAt,
                    points: points,
                    width: proxy.size.width,
                    inset: 12
                )

                ZStack {
                    Capsule()
                        .fill(Color.white.opacity(isLuminanceReduced ? 0.35 : 0.16))
                        .frame(height: 3)

                    if let planStartX, let planEndX {
                        Capsule()
                            .stroke(color, lineWidth: 2)
                            .frame(width: max(24, planEndX - planStartX), height: useUltraLayout ? 36 : 32)
                            .position(x: (planStartX + planEndX) / 2, y: proxy.size.height / 2)
                    }

                    ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                        let isInPlanWindow = planWindow.contains(point.startsAt)
                        Image(systemName: point.symbolName)
                            .font(.system(size: isInPlanWindow ? 17 : 14, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(isInPlanWindow ? color : watchMuted)
                            .frame(width: 24, height: 24)
                            .background(Color.black, in: Circle())
                            .position(x: positions[index], y: proxy.size.height / 2)
                    }
                }
            }
            .frame(height: useUltraLayout ? 38 : 34)

            WatchRibbonEndpoints(
                start: points.first?.timeLabel ?? "Now",
                end: points.last?.timeLabel ?? "Later"
            )
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(
            isLuminanceReduced ? Color.clear : color.opacity(0.08),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(color.opacity(isLuminanceReduced ? 0.55 : 0.22), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Weather during your plan")
        .accessibilityValue(signal.accessibilityDescription)
    }

}

private struct WatchNoWeatherMessage: View {
    let isRefreshing: Bool
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: isRefreshing ? "arrow.triangle.2.circlepath" : "iphone.and.arrow.forward")
                .font(.system(size: useUltraLayout ? 42 : 36, weight: .semibold))
                .foregroundStyle(isLuminanceReduced ? Color.white : nearcastCyan)
                .symbolEffect(.pulse, isActive: isRefreshing)
                .accessibilityHidden(true)
            Text(isRefreshing ? "Loading" : "Open on iPhone")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(watchPrimary)
            Text(isRefreshing ? "Checking your place" : "Share your saved place")
                .font(.system(.body, design: .rounded, weight: .medium))
                .foregroundStyle(watchSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct WatchEmptyPlan: View {
    let isLuminanceReduced: Bool
    let useUltraLayout: Bool

    var body: some View {
        VStack(spacing: useUltraLayout ? 12 : 9) {
            Spacer(minLength: 2)
            Image(systemName: "calendar.badge.plus")
                .font(.system(size: useUltraLayout ? 52 : 44, weight: .semibold))
                .foregroundStyle(isLuminanceReduced ? Color.white : nearcastMint)
                .accessibilityHidden(true)
            Text("No plan yet")
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(watchPrimary)
            Text("Add one on iPhone")
                .font(.system(.body, design: .rounded, weight: .medium))
                .foregroundStyle(watchSecondary)
            Spacer(minLength: 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct WatchExceptionalWeatherStatus: View {
    let snapshot: NearcastWidgetSnapshot
    let syncState: WatchSyncState

    private var status: (symbol: String, text: String, color: Color)? {
        if snapshot.hasWeatherData && snapshot.weatherAge > watchWeatherStaleInterval {
            return ("clock.badge.exclamationmark", durationText(snapshot.weatherAge), nearcastAmber)
        }
        if syncState == .failed {
            return ("wifi.exclamationmark", "Couldn't update", nearcastAmber)
        }
        if syncState == .refreshing {
            return ("arrow.triangle.2.circlepath", "Refreshing", nearcastCyan)
        }
        return nil
    }

    var body: some View {
        if let status {
            Label(status.text, systemImage: status.symbol)
                .font(.system(.body, design: .rounded, weight: .semibold))
                .foregroundStyle(status.color)
                .frame(maxWidth: .infinity, alignment: .center)
                .lineLimit(1)
                .accessibilityLabel(status.text)
        }
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

private func watchMagnitudeDisplay(_ signal: NearcastVisualSignal) -> (metric: String, unit: String?) {
    if signal.kind == .rain, signal.headline == "Dry" {
        return ("Dry", nil)
    }

    guard let magnitude = signal.magnitude else {
        return (signal.headline, nil)
    }

    switch magnitude.kind {
    case .probability:
        return ("\(magnitude.value)%", nil)
    case .temperature:
        return ("\(magnitude.value)°", nil)
    case .speed:
        return ("\(magnitude.value)", magnitude.unit)
    }
}

private func watchSignalCaption(_ signal: NearcastVisualSignal) -> String {
    switch signal.kind {
    case .rain:
        if signal.headline == "Dry" { return signal.detail ?? "Next hours" }
        if signal.eventTimeLabel == "Now" { return signal.headline }
        return [signal.headline, signal.eventTimeLabel].compactMap { $0 }.joined(separator: " · ")
    case .wind:
        return [signal.headline, signal.eventTimeLabel].compactMap { $0 }.joined(separator: " · ")
    case .temperature:
        let label = signal.headline.hasPrefix("Feels ") ? "Feels" : signal.headline
        return [label, signal.eventTimeLabel].compactMap { $0 }.joined(separator: " · ")
    case .condition:
        return signal.detail ?? signal.eventTimeLabel ?? "Next"
    case .steady:
        return "Steady"
    case .plan:
        return signal.headline
    }
}

private func watchSignalSupport(_ signal: NearcastVisualSignal) -> String? {
    nil
}

private func watchRibbonMetric(_ kind: NearcastVisualSignalKind) -> WatchRibbonMetric {
    switch kind {
    case .rain: return .rain
    case .wind: return .wind
    case .temperature, .condition, .steady, .plan: return .temperature
    }
}

private func watchSignalColor(_ tone: NearcastVisualSignalTone) -> Color {
    switch tone {
    case .rain, .wind, .cool: return nearcastCyan
    case .warm, .watch: return nearcastAmber
    case .change: return nearcastCoral
    case .go, .calm: return nearcastMint
    case .neutral: return nearcastCyan
    }
}

private func sampledSignalPoints(
    _ points: [NearcastVisualTimelinePoint],
    maximumPoints: Int
) -> [NearcastVisualTimelinePoint] {
    guard maximumPoints > 1, points.count > maximumPoints else { return points }

    let last = points.count - 1
    var indices = [0, last]

    func appendIfNeeded(_ index: Int?) {
        guard let index, !indices.contains(index), indices.count < maximumPoints else { return }
        indices.append(index)
    }

    appendIfNeeded(points.firstIndex(where: { $0.isEvent }))

    let evenlySpaced = (0..<maximumPoints).map { slot in
        Int((Double(slot) * Double(last) / Double(maximumPoints - 1)).rounded())
    }
    for index in evenlySpaced {
        appendIfNeeded(index)
    }

    return indices.sorted().map { points[$0] }
}

private func watchTimelineBounds(
    _ points: [NearcastVisualTimelinePoint]
) -> (startAt: TimeInterval, endAt: TimeInterval)? {
    let timestamps = points.compactMap(\.startsAt)
    guard timestamps.count == points.count,
          let startAt = timestamps.first,
          let endAt = timestamps.last,
          endAt > startAt else { return nil }
    return (startAt, endAt)
}

private func watchTimelineXPositions(
    _ points: [NearcastVisualTimelinePoint],
    width: CGFloat,
    inset: CGFloat
) -> [CGFloat] {
    guard !points.isEmpty else { return [] }
    guard let bounds = watchTimelineBounds(points) else {
        if points.count == 1 { return [width / 2] }
        let drawableWidth = max(0, width - inset * 2)
        return points.indices.map { index in
            inset + drawableWidth * CGFloat(index) / CGFloat(points.count - 1)
        }
    }

    return points.map { point in
        guard let startsAt = point.startsAt else { return width / 2 }
        return watchTimelineXPosition(
            timestamp: startsAt,
            bounds: bounds,
            width: width,
            inset: inset
        )
    }
}

private func watchTimelineXPosition(
    timestamp: TimeInterval,
    points: [NearcastVisualTimelinePoint],
    width: CGFloat,
    inset: CGFloat
) -> CGFloat? {
    guard let bounds = watchTimelineBounds(points) else { return nil }
    return watchTimelineXPosition(
        timestamp: timestamp,
        bounds: bounds,
        width: width,
        inset: inset
    )
}

private func watchTimelineXPosition(
    timestamp: TimeInterval,
    bounds: (startAt: TimeInterval, endAt: TimeInterval),
    width: CGFloat,
    inset: CGFloat
) -> CGFloat {
    let clamped = min(bounds.endAt, max(bounds.startAt, timestamp))
    let fraction = (clamped - bounds.startAt) / (bounds.endAt - bounds.startAt)
    return inset + max(0, width - inset * 2) * CGFloat(fraction)
}

private func durationText(_ interval: TimeInterval) -> String {
    guard interval.isFinite else { return "not yet" }
    let minutes = max(0, Int(interval / 60))
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes)m ago" }
    return "\(max(1, minutes / 60))h ago"
}

private func unavailableVisualGuidance(_ syncState: WatchSyncState) -> String {
    switch syncState {
    case .refreshing:
        return "Checking your saved place"
    case .missingPlace:
        return "Open Nearcast on iPhone"
    case .failed:
        return "Try again when connected"
    case .idle:
        return "Open Nearcast on iPhone"
    }
}

private func cityName(_ value: String) -> String {
    let city = value.split(separator: ",", maxSplits: 1).first.map(String.init) ?? value
    let trimmed = city.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? value : trimmed
}

private func temperatureProgress(_ snapshot: NearcastWidgetSnapshot) -> Double {
    guard let low = snapshot.low, let high = snapshot.high, high > low else { return 0.55 }
    return min(1, max(0, Double(snapshot.temperature - low) / Double(high - low)))
}

private func shortWatchWindUnit(_ unit: String) -> String {
    unit.lowercased().contains("km") ? "km/h" : "mph"
}

private func watchWindCardinal(_ snapshot: NearcastWidgetSnapshot) -> String {
    if let label = cleanOptional(snapshot.windLabel) { return label }
    guard let degrees = snapshot.windDirection else { return "—" }
    let labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    let normalized = (degrees % 360 + 360) % 360
    return labels[Int((Double(normalized) + 22.5) / 45.0) % labels.count]
}

private func watchConditionSymbol(_ code: Int, isDay: Bool) -> String {
    switch code {
    case 0: return isDay ? "sun.max.fill" : "moon.stars.fill"
    case 1: return isDay ? "sun.min.fill" : "moon.fill"
    case 2: return isDay ? "cloud.sun.fill" : "cloud.moon.fill"
    case 3: return "cloud.fill"
    case 45, 48: return "cloud.fog.fill"
    case 51...67, 80...82: return "cloud.rain.fill"
    case 71...77, 85...86: return "cloud.snow.fill"
    case 95...99: return "cloud.bolt.rain.fill"
    default: return "cloud.fill"
    }
}

private func cleanOptional(_ value: String?) -> String? {
    let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func conciseWatchWords(_ value: String, maximumCharacters: Int) -> String {
    let words = value.split(whereSeparator: \.isWhitespace).map(String.init)
    guard !words.isEmpty else { return "Your plan" }
    var result = ""
    for word in words {
        let candidate = result.isEmpty ? word : "\(result) \(word)"
        if candidate.count > maximumCharacters { break }
        result = candidate
    }
    return result.isEmpty ? String(words[0].prefix(maximumCharacters)) : result
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

}

private func safeWatchSurface(_ surface: WatchSurface, snapshot: NearcastWidgetSnapshot) -> WatchSurface {
    surface == .plan && !snapshot.hasPlan ? .today : surface
}

private func watchSnapshotForDisplay() -> NearcastWidgetSnapshot {
#if DEBUG
    if ProcessInfo.processInfo.arguments.contains("-nearcastPreviewWeather") {
        return watchPreviewSnapshot()
    }
#endif
    return .current()
}

#if DEBUG
private func watchPreviewSnapshot() -> NearcastWidgetSnapshot {
    let now = Date().timeIntervalSince1970
    var snapshot = NearcastWidgetSnapshot.fallback
    snapshot.version = 6
    snapshot.savedAt = now
    snapshot.weatherSavedAt = now
    snapshot.placeName = "Maryville, Illinois"
    snapshot.temperature = 72
    snapshot.feelsLike = 72
    snapshot.high = 88
    snapshot.low = 64
    snapshot.condition = "Mostly sunny"
    snapshot.conditionCode = 1
    snapshot.isDay = true
    snapshot.rainChance = 42
    snapshot.wind = 12
    snapshot.windUnit = "mph"
    snapshot.windDirection = 285
    snapshot.windLabel = "WNW"
    snapshot.isAvailable = true
    snapshot.timeline = (0..<6).map { offset in
        NearcastWidgetHour(
            offsetHours: offset,
            timeLabel: offset == 0 ? "Now" : "+\(offset)h",
            temperature: 72 + offset,
            feelsLike: 72 + offset,
            rainChance: [42, 36, 24, 15, 8, 5][offset],
            wind: 12 + offset,
            windGust: 18 + offset,
            windDirection: 285,
            uv: 4,
            conditionCode: offset < 2 ? 2 : 1,
            isDay: true,
            startsAt: now + Double(offset * 3600)
        )
    }
    snapshot.daily = [
        NearcastWidgetDay(date: "preview-0", label: "Today", high: 88, low: 64, rainChance: 42, conditionCode: 1),
        NearcastWidgetDay(date: "preview-1", label: "Tomorrow", high: 84, low: 63, rainChance: 28, conditionCode: 2),
        NearcastWidgetDay(date: "preview-2", label: "Thursday", high: 79, low: 59, rainChance: 12, conditionCode: 0)
    ]
    return snapshot
}
#endif

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
            URLQueryItem(name: "daily", value: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            URLQueryItem(name: "temperature_unit", value: metric ? "celsius" : "fahrenheit"),
            URLQueryItem(name: "wind_speed_unit", value: metric ? "kmh" : "mph"),
            URLQueryItem(name: "forecast_hours", value: "24"),
            URLQueryItem(name: "forecast_days", value: "4"),
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
            updated.version = max(6, max(updated.version, fallback.version))
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
                let rows = hourly.rows(limit: 24, utcOffsetSeconds: forecast.utcOffsetSeconds ?? 0)
                updated.timeline = rows
                updated.rainChance = rows.first?.rainChance ?? fallback.rainChance
                updated.uv = rows.first?.uv ?? fallback.uv
            }
            if let daily = forecast.daily {
                updated.daily = daily.rows(limit: 3)
                updated.high = updated.daily?.first?.high
                updated.low = updated.daily?.first?.low
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
    let daily: Daily?

    enum CodingKeys: String, CodingKey {
        case utcOffsetSeconds = "utc_offset_seconds"
        case current
        case hourly
        case daily
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

    struct Daily: Decodable {
        let time: [String]
        let weatherCode: [Int?]?
        let high: [Double?]?
        let low: [Double?]?
        let rainChance: [Int?]?

        enum CodingKeys: String, CodingKey {
            case time
            case weatherCode = "weather_code"
            case high = "temperature_2m_max"
            case low = "temperature_2m_min"
            case rainChance = "precipitation_probability_max"
        }

        func rows(limit: Int) -> [NearcastWidgetDay] {
            (0..<min(time.count, limit)).compactMap { index -> NearcastWidgetDay? in
                guard let high = rounded(high?[safe: index] ?? nil),
                      let low = rounded(low?[safe: index] ?? nil) else { return nil }
                return NearcastWidgetDay(
                    date: time[index],
                    label: watchDayLabel(time[index], index: index),
                    high: high,
                    low: low,
                    rainChance: (rainChance?[safe: index] ?? nil) ?? 0,
                    conditionCode: (weatherCode?[safe: index] ?? nil) ?? 0
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

private func watchDayLabel(_ raw: String, index: Int) -> String {
    if index == 0 { return "Today" }
    if index == 1 { return "Tomorrow" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    guard let date = formatter.date(from: raw) else { return raw }
    formatter.dateFormat = "EEE"
    return formatter.string(from: date)
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
