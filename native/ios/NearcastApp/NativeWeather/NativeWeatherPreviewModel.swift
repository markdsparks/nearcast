import Foundation
import Combine

@MainActor
final class NativeWeatherPreviewModel: ObservableObject {
    @Published private(set) var context: NativePreviewContext
    @Published private(set) var places: [NativePreviewPlace]
    @Published private(set) var selectedPlace: NativePreviewPlace
    @Published private(set) var forecast: NativeWeatherForecast?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var essentials: NativeWeatherEssentials?
    @Published private(set) var isLoadingEssentials = false
    @Published var selectedDay: Date?
    @Published var destination: NativeWeatherDestination = .today
    /// A compact outlook column can hand the user directly to the matching
    /// detailed hour. The view consumes this only as a scroll target; it never
    /// changes the forecast selection or fabricates a time reading.
    @Published private(set) var hourlyFocus: Date?

    private let repository: NativeForecastRepository
    private let essentialsRepository: NativeEssentialsRepository?
    private var requestRevision = 0
    private var essentialsRevision = 0
    private var placeTask: Task<Void, Never>?
    private var essentialsTask: Task<Void, Never>?
    private var lastEssentialsAttempt: Date?

    init(context: NativePreviewContext, repository: NativeForecastRepository = NativeForecastRepository(),
         essentialsRepository: NativeEssentialsRepository? = NativeEssentialsRepository()) {
        self.context = context
        places = context.places
        selectedPlace = context.selectedPlace
        self.repository = repository
        self.essentialsRepository = essentialsRepository
    }

    deinit { placeTask?.cancel(); essentialsTask?.cancel() }

    /// Called only after Places/Settings has received a verified owner reply.
    /// Display-only changes preserve the current day; location changes reset it.
    func applyManagedContext(_ next: NativePreviewContext) {
        guard next != context else { return }
        let placeChanged = next.selectedPlace.id != selectedPlace.id ||
            next.selectedPlace.coordinateIdentity != selectedPlace.coordinateIdentity
        let unitsChanged = next.metric != context.metric
        let placeMetadataChanged = next.selectedPlace != selectedPlace
        context = next
        places = next.places
        selectedPlace = next.selectedPlace
        guard placeChanged || unitsChanged else {
            if placeMetadataChanged {
                // A receipt may enrich or omit a stored time zone/country while
                // keeping the same coordinates. Replace that supplemental task
                // so its strict identity guard cannot leave loading stuck true.
                essentialsTask?.cancel()
                essentialsRevision += 1
                isLoadingEssentials = false
                lastEssentialsAttempt = nil
                essentials = nil
                refreshEssentials()
            }
            return
        }
        placeTask?.cancel()
        essentialsTask?.cancel()
        requestRevision += 1
        essentialsRevision += 1
        isLoadingEssentials = false
        lastEssentialsAttempt = nil
        forecast = nil
        essentials = nil
        errorMessage = nil
        if placeChanged {
            selectedDay = nil
            hourlyFocus = nil
            destination = .today
        }
        placeTask = Task { [weak self] in await self?.refresh() }
    }

    func selectPlace(_ place: NativePreviewPlace) {
        guard places.contains(place), place != selectedPlace else { return }
        placeTask?.cancel()
        essentialsTask?.cancel()
        essentialsRevision += 1
        isLoadingEssentials = false
        lastEssentialsAttempt = nil
        requestRevision += 1
        selectedPlace = place
        forecast = nil
        essentials = nil
        errorMessage = nil
        selectedDay = nil
        hourlyFocus = nil
        destination = .today
        placeTask = Task { [weak self] in await self?.refresh() }
    }

    func refresh() async {
        requestRevision += 1
        let revision = requestRevision
        let place = selectedPlace
        isLoading = true
        errorMessage = nil
        refreshEssentials()
        defer { if revision == requestRevision { isLoading = false } }

        if forecast == nil {
            let cached = await repository.cached(latitude: place.latitude, longitude: place.longitude, metric: context.metric)
            guard revision == requestRevision, !Task.isCancelled else { return }
            forecast = cached
        }
        do {
            let loaded = try await repository.fetch(latitude: place.latitude, longitude: place.longitude, metric: context.metric, now: Date())
            guard revision == requestRevision, !Task.isCancelled else { return }
            forecast = loaded
            if let selectedDay, loaded.day(containing: selectedDay) == nil { self.selectedDay = nil }
        } catch is CancellationError {
            // Closing a preview or switching places isn't a weather failure.
        } catch {
            guard revision == requestRevision, !Task.isCancelled else { return }
            errorMessage = forecast == nil
                ? "Couldn't update this place. Check your connection and try again."
                : "Couldn't refresh. Showing the saved forecast with its original update time."
        }
    }

    /// Supplemental inputs never hold up the first useful forecast. They have
    /// their own revision guard so a late AQI/alert response cannot cross places.
    func refreshEssentials(force: Bool = false) {
        guard let essentialsRepository else { return }
        guard !isLoadingEssentials || force else { return }
        essentialsTask?.cancel()
        essentialsRevision += 1
        let revision = essentialsRevision
        let place = selectedPlace
        isLoadingEssentials = true
        lastEssentialsAttempt = Date()
        essentialsTask = Task { [weak self] in
            let result = await essentialsRepository.fetch(latitude: place.latitude, longitude: place.longitude,
                countryCode: place.countryCode, now: Date(), force: force)
            guard let self, !Task.isCancelled, revision == self.essentialsRevision,
                  place == self.selectedPlace else { return }
            self.essentials = result
            self.isLoadingEssentials = false
        }
    }

    func refreshEssentialsIfNeeded(now: Date) {
        guard !isLoadingEssentials else { return }
        let sinceAttempt = lastEssentialsAttempt.map { now.timeIntervalSince($0) } ?? .infinity
        let expiredBulletin = essentials?.alerts.validUntil.map { now >= $0 } ?? false
        guard sinceAttempt >= 5 * 60 || (expiredBulletin && sinceAttempt >= 60) else { return }
        refreshEssentials()
    }

    func showToday() {
        selectedDay = nil
        hourlyFocus = nil
        destination = .today
    }

    func showHourly(day: Date? = nil, focusedHour: Date? = nil) {
        if let day, forecast?.day(containing: day) == nil { return }
        selectedDay = day
        hourlyFocus = focusedHour
        destination = .hourly
    }

    func showDay(_ date: Date) {
        guard forecast?.day(containing: date) != nil else { return }
        selectedDay = date
        hourlyFocus = nil
        destination = .today
    }

    func cancel() {
        requestRevision += 1
        essentialsRevision += 1
        placeTask?.cancel()
        essentialsTask?.cancel()
        isLoading = false
        isLoadingEssentials = false
    }
}
