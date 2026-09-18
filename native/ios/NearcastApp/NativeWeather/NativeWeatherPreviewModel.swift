import Foundation
import Combine

@MainActor
final class NativeWeatherPreviewModel: ObservableObject {
    let context: NativePreviewContext
    let places: [NativePreviewPlace]
    @Published private(set) var selectedPlace: NativePreviewPlace
    @Published private(set) var forecast: NativeWeatherForecast?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published var selectedDay: Date?
    @Published var destination: NativeWeatherDestination = .today

    private let repository: NativeForecastRepository
    private var requestRevision = 0
    private var placeTask: Task<Void, Never>?

    init(context: NativePreviewContext, repository: NativeForecastRepository = NativeForecastRepository()) {
        self.context = context
        places = context.places
        selectedPlace = context.selectedPlace
        self.repository = repository
    }

    deinit { placeTask?.cancel() }

    func selectPlace(_ place: NativePreviewPlace) {
        guard places.contains(place), place != selectedPlace else { return }
        placeTask?.cancel()
        requestRevision += 1
        selectedPlace = place
        forecast = nil
        errorMessage = nil
        selectedDay = nil
        destination = .today
        placeTask = Task { [weak self] in await self?.refresh() }
    }

    func refresh() async {
        requestRevision += 1
        let revision = requestRevision
        let place = selectedPlace
        isLoading = true
        errorMessage = nil
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

    func showToday() {
        selectedDay = nil
        destination = .today
    }

    func showHourly(day: Date? = nil) {
        if let day, forecast?.day(containing: day) == nil { return }
        selectedDay = day
        destination = .hourly
    }

    func showDay(_ date: Date) {
        guard forecast?.day(containing: date) != nil else { return }
        selectedDay = date
        destination = .today
    }

    func cancel() {
        requestRevision += 1
        placeTask?.cancel()
        isLoading = false
    }
}
