import Foundation

/// A read-only, allowlisted copy. This is never the owner of saved places,
/// plans, notification selections, or the web app's active location.
struct NativePreviewPlace: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let timezone: String?
    let countryCode: String?

    init(id: String, name: String, latitude: Double, longitude: Double, timezone: String?, countryCode: String? = nil) {
        self.id = id
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.timezone = timezone
        self.countryCode = countryCode
    }

    var isValid: Bool {
        !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && id.count <= 160 &&
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 180 &&
        latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180 &&
        (timezone == nil || TimeZone(identifier: timezone!) != nil) &&
        (countryCode == nil || (countryCode!.count == 2 && countryCode!.unicodeScalars.allSatisfy { (65...90).contains($0.value) }))
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
    /// An optional legacy-owned plan identity. Native Agenda can safely use
    /// this to ask the compatibility host for the *same* saved plan without
    /// trying to own its editor, watch choices, or notification policy yet.
    let planID: String?
    /// Optional draft created in a native entry surface. It is deliberately
    /// bounded and only delivered to the already-verified Ask destination.
    let initialQuery: String?

    init(destination: NativeLegacyDestination, place: NativePreviewPlace, date: Date?, timezone: String?,
         planID: String? = nil, initialQuery: String? = nil) {
        self.destination = destination
        let trimmedPlanID = planID?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.planID = (trimmedPlanID?.isEmpty == false && trimmedPlanID!.count <= 160 &&
            !trimmedPlanID!.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) }))
            ? trimmedPlanID
            : nil
        self.place = place
        let trimmedQuery = initialQuery?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.initialQuery = (trimmedQuery?.isEmpty == false) ? String(trimmedQuery!.prefix(500)) : nil
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

    enum CodingKeys: String, CodingKey {
        case version
        case destination
        case place
        case targetDate
        case planID = "planId"
        case initialQuery
    }
}

/// An explicit, one-way escape from the native-only Dev host to the retained
/// compatibility experience. Keeping this typed prevents a native route from
/// being silently flattened into generic web Home while parts of the product
/// are still moving over.
enum NativeCompatibilityLaunch {
    /// The user intentionally opened the existing app with no contextual task.
    case home
    /// Continue a native-originated Ask, Plans, Map, or details request at the
    /// exact verified place and optional date/query.
    case handoff(NativePreviewHandoff)
    /// Preserve a system notification payload for the existing notification
    /// router until native Plans/watch routing is fully owned.
    case notification([AnyHashable: Any])
    /// Preserve an external Nearcast URL that the native root does not own yet.
    case deepLink(URL)
}

enum NativePreviewError: LocalizedError {
    case invalidContext

    var errorDescription: String? {
        "Open a place in Nearcast, then return to Nearcast weather."
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
