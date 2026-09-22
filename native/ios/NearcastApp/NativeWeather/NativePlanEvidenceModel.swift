import Combine
import Foundation

/// Loads weather evidence for one saved plan occurrence without participating
/// in main-place selection or any plan/watch ownership. This is intentionally
/// a short-lived, separate read: opening a trip or a family member's plan can
/// never make the home forecast jump to that remote location.
@MainActor
final class NativePlanEvidenceModel: ObservableObject {
    let item: NativeAgendaItem
    let metric: Bool

    @Published private(set) var forecast: NativeWeatherForecast?
    @Published private(set) var essentials: NativeWeatherEssentials?
    @Published private(set) var evidence: NativePlanEvidence?
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingEssentials = false
    @Published private(set) var errorMessage: String?

    private let forecastRepository: NativeForecastRepository
    private let essentialsRepository: NativeEssentialsRepository?
    private var forecastTask: Task<Void, Never>?
    private var essentialsTask: Task<Void, Never>?
    private var requestRevision = 0

    init(item: NativeAgendaItem,
         metric: Bool,
         forecastRepository: NativeForecastRepository = NativeForecastRepository(),
         essentialsRepository: NativeEssentialsRepository? = NativeEssentialsRepository()) {
        self.item = item
        self.metric = metric
        self.forecastRepository = forecastRepository
        self.essentialsRepository = essentialsRepository
    }

    deinit { forecastTask?.cancel(); essentialsTask?.cancel() }

    /// Starts an independent refresh for the plan place. There is deliberately
    /// no Places controller, preview model, plan store, App Group, widget,
    /// Watch, or notification call in this path.
    func load(force: Bool = false) {
        forecastTask?.cancel()
        essentialsTask?.cancel()
        requestRevision += 1
        let revision = requestRevision

        guard NativePlanEvidenceWindow(item: item) != nil else {
            forecast = nil
            essentials = nil
            evidence = nil
            isLoading = false
            isLoadingEssentials = false
            errorMessage = "This plan’s local time window could not be verified."
            return
        }
        guard Self.valid(latitude: item.place.latitude, longitude: item.place.longitude) else {
            forecast = nil
            essentials = nil
            evidence = nil
            isLoading = false
            isLoadingEssentials = false
            errorMessage = "This plan place does not have valid coordinates."
            return
        }

        isLoading = true
        isLoadingEssentials = essentialsRepository != nil
        errorMessage = nil
        forecastTask = Task { [weak self] in
            guard let self else { return }
            await self.loadForecast(revision: revision)
        }
        if essentialsRepository != nil {
            essentialsTask = Task { [weak self] in
                guard let self else { return }
                await self.loadEssentials(revision: revision, force: force)
            }
        }
    }

    /// Cancelling only stops this evidence request. It does not remove, update,
    /// or otherwise alter the saved plan or any background watch target.
    func cancel() {
        requestRevision += 1
        forecastTask?.cancel()
        essentialsTask?.cancel()
        isLoading = false
        isLoadingEssentials = false
    }

    private func loadForecast(revision: Int) async {
        let place = item.place
        let now = Date()

        // A direct cache read gives a remote plan something useful quickly, but
        // it remains scoped to this model and never publishes into home.
        if let cached = await forecastRepository.cached(latitude: place.latitude,
                                                        longitude: place.longitude,
                                                        metric: metric) {
            guard isCurrent(revision) else { return }
            forecast = cached
            rebuildEvidence(now: now)
        }

        do {
            let loaded = try await forecastRepository.fetch(latitude: place.latitude,
                                                             longitude: place.longitude,
                                                             metric: metric,
                                                             now: now)
            guard isCurrent(revision) else { return }
            forecast = loaded
            errorMessage = nil
            rebuildEvidence(now: Date())
        } catch is CancellationError {
            // Closing a detail sheet or choosing another occurrence is not a
            // user-facing weather failure.
        } catch {
            guard isCurrent(revision) else { return }
            errorMessage = forecast == nil
                ? "Couldn’t load forecast evidence for this plan place. Check your connection and try again."
                : "Couldn’t refresh plan evidence. Showing the saved forecast with its original update time."
        }
        if isCurrent(revision) { isLoading = false }
    }

    private func loadEssentials(revision: Int, force: Bool) async {
        guard let essentialsRepository else { return }
        let place = item.place
        let loaded = await essentialsRepository.fetch(latitude: place.latitude,
                                                      longitude: place.longitude,
                                                      countryCode: place.countryCode,
                                                      now: Date(),
                                                      force: force)
        guard isCurrent(revision), Self.matches(loaded, place: place) else { return }
        essentials = loaded
        isLoadingEssentials = false
        rebuildEvidence(now: Date())
    }

    private func rebuildEvidence(now: Date) {
        evidence = forecast.flatMap { NativePlanEvidence.make(item: item, forecast: $0, essentials: essentials, now: now) }
    }

    private func isCurrent(_ revision: Int) -> Bool {
        revision == requestRevision && !Task.isCancelled
    }

    private static func valid(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180
    }

    private static func matches(_ essentials: NativeWeatherEssentials, place: NativeAgendaPlace) -> Bool {
        abs(essentials.latitude - place.latitude) <= 0.000_001 &&
            abs(essentials.longitude - place.longitude) <= 0.000_001
    }
}
