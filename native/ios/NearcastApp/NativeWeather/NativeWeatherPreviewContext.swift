import Foundation

/// A read-only, allowlisted copy. This is never the owner of saved places,
/// plans, notification selections, or the web app's active location.
struct NativePreviewPlace: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let timezone: String?

    var isValid: Bool {
        !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && id.count <= 160 &&
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 180 &&
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180 &&
        (timezone == nil || TimeZone(identifier: timezone!) != nil)
    }

    var coordinateIdentity: String {
        String(format: "%.5f,%.5f", locale: Locale(identifier: "en_US_POSIX"), latitude, longitude)
    }
}

struct NativePreviewContext: Codable, Equatable, Sendable {
    let version: Int
    let selectedPlace: NativePreviewPlace
    let savedPlaces: [NativePreviewPlace]
    let metric: Bool
    let uses24HourClock: Bool
    let theme: String

    var places: [NativePreviewPlace] {
        var seen = Set<String>()
        return ([selectedPlace] + savedPlaces).filter { seen.insert($0.coordinateIdentity).inserted }
    }

    static func decode(_ data: Data) throws -> Self {
        guard data.count <= 64 * 1_024 else { throw NativePreviewError.invalidContext }
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.version == 1, value.selectedPlace.isValid,
              value.savedPlaces.count <= 60, value.savedPlaces.allSatisfy(\.isValid),
              ["light", "dark", "auto"].contains(value.theme) else {
            throw NativePreviewError.invalidContext
        }
        return value
    }
}

enum NativeWeatherDestination: String, Sendable {
    case today, hourly
}

enum NativeLegacyDestination: String, Codable, Sendable {
    case map, plans, ask, details
}

struct NativePreviewHandoff: Encodable, Sendable {
    let version = 1
    let destination: NativeLegacyDestination
    let place: NativePreviewPlace
    let targetDate: String?

    init(destination: NativeLegacyDestination, place: NativePreviewPlace, date: Date?, timezone: String?) {
        self.destination = destination
        self.place = place
        if let date, let zone = timezone.flatMap(TimeZone.init(identifier:)) {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = zone
            formatter.dateFormat = "yyyy-MM-dd"
            targetDate = formatter.string(from: date)
        } else {
            targetDate = nil
        }
    }
}

enum NativePreviewError: LocalizedError {
    case invalidContext

    var errorDescription: String? {
        "Open a place in Nearcast, then try the native preview again."
    }
}

/// A separate disposable snapshot, never a replacement for browser storage.
enum NativePreviewContextStore {
    private static let key = "nearcast.native-preview.context.v1"

    static func load(defaults: UserDefaults = .standard) -> NativePreviewContext? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? NativePreviewContext.decode(data)
    }

    static func save(_ context: NativePreviewContext, defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(context),
              (try? NativePreviewContext.decode(data)) != nil else { return }
        defaults.set(data, forKey: key)
    }
}
