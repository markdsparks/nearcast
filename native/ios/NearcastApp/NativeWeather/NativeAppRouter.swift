import Combine
import Foundation

/// The durable, user-facing sections of the native Nearcast experience.
///
/// This deliberately describes *where* the app is showing, rather than how a
/// screen obtains data or performs a mutation. That keeps native navigation
/// independent from WebKit while the existing Places ownership handoff remains
/// authoritative during migration.
enum NativeAppSection: String, CaseIterable, Codable, Hashable, Sendable, Identifiable {
    case home
    case places
    case ask
    case plans
    case map

    var id: String { rawValue }
}

/// Home can show the concise daily surface or the selected day's detailed
/// hourly surface. It is separate from `NativeWeatherDestination` so this
/// router remains a UI-boundary type rather than a dependency of the forecast
/// model.
enum NativeAppHomePresentation: String, Codable, Hashable, Sendable {
    case today
    case hourly
}

/// A native Places route is intentionally explicit about which safe sheet the
/// reader asked for. Keeping Settings as a typed presentation avoids treating
/// a settings deep link as a generic web-detail link during the cutover.
enum NativeAppPlacesPresentation: String, Codable, Hashable, Sendable {
    case places
    case settings
}

/// A stable identity for a route's place context. Routes do not retain a full
/// mutable saved-place record: the native root resolves this reference against
/// the verified context it was given at render time.
struct NativeAppPlaceReference: Codable, Hashable, Sendable {
    let id: String
    let coordinateIdentity: String

    init?(_ place: NativePreviewPlace) {
        guard place.isValid else { return nil }
        self.init(id: place.id, coordinateIdentity: place.coordinateIdentity)
    }

    init?(id: String, coordinateIdentity: String) {
        let trimmedID = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCoordinates = coordinateIdentity.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedID.isEmpty, trimmedID.count <= 160,
              !trimmedCoordinates.isEmpty, trimmedCoordinates.count <= 64,
              let separator = trimmedCoordinates.firstIndex(of: ",") else {
            return nil
        }
        let latitude = Double(trimmedCoordinates[..<separator])
        let longitude = Double(trimmedCoordinates[trimmedCoordinates.index(after: separator)...])
        guard let latitude, let longitude,
              latitude.isFinite, longitude.isFinite,
              abs(latitude) <= 90, abs(longitude) <= 180 else {
            return nil
        }
        self.id = trimmedID
        self.coordinateIdentity = trimmedCoordinates
    }

    func matches(_ place: NativePreviewPlace) -> Bool {
        id == place.id && coordinateIdentity == place.coordinateIdentity
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let id = try values.decode(String.self, forKey: .id)
        let coordinateIdentity = try values.decode(String.self, forKey: .coordinateIdentity)
        guard let value = Self(id: id, coordinateIdentity: coordinateIdentity) else {
            throw DecodingError.dataCorruptedError(forKey: .coordinateIdentity, in: values,
                debugDescription: "The place route reference is invalid.")
        }
        self = value
    }
}

/// A complete, canonical native navigation request. It is intentionally
/// value-based so it can be used by `NavigationStack`, restored safely later,
/// and tested without launching a web view or making a network request.
struct NativeAppRoute: Codable, Hashable, Sendable {
    let section: NativeAppSection
    let place: NativeAppPlaceReference?
    let selectedDay: Date?
    let hourlyFocus: Date?
    let homePresentation: NativeAppHomePresentation?
    let placesPresentation: NativeAppPlacesPresentation?
    let initialQuery: String?
    /// Preserved only for a native Plans route. The native Plans surface can
    /// later use this identity to focus the exact item without a URL being
    /// reinterpreted by a compatibility shell.
    let planID: String?
    /// Preserved only for a native Map route. This lets notification routing
    /// retain a verified alert identity while alert-focused map presentation
    /// finishes moving into the native surface.
    let alertID: String?

    init(section: NativeAppSection,
         place: NativeAppPlaceReference? = nil,
         selectedDay: Date? = nil,
         hourlyFocus: Date? = nil,
         homePresentation: NativeAppHomePresentation? = nil,
         placesPresentation: NativeAppPlacesPresentation? = nil,
         initialQuery: String? = nil,
         planID: String? = nil,
         alertID: String? = nil) {
        self.section = section
        self.place = place

        let validDay = Self.validDate(selectedDay)
        let validFocusedHour = Self.validDate(hourlyFocus)

        switch section {
        case .home:
            let presentation = homePresentation ?? .today
            self.homePresentation = presentation
            self.selectedDay = validDay
            self.hourlyFocus = presentation == .hourly ? validFocusedHour : nil
            self.placesPresentation = nil
            self.initialQuery = nil
            self.planID = nil
            self.alertID = nil

        case .ask:
            self.homePresentation = nil
            self.selectedDay = validDay
            self.hourlyFocus = nil
            self.placesPresentation = nil
            self.initialQuery = Self.normalizedQuery(initialQuery)
            self.planID = nil
            self.alertID = nil

        case .plans:
            self.homePresentation = nil
            self.selectedDay = validDay
            self.hourlyFocus = nil
            self.placesPresentation = nil
            self.initialQuery = nil
            self.planID = Self.normalizedIdentifier(planID)
            self.alertID = nil

        case .map:
            self.homePresentation = nil
            self.selectedDay = validDay
            self.hourlyFocus = nil
            self.placesPresentation = nil
            self.initialQuery = nil
            self.planID = nil
            self.alertID = Self.normalizedIdentifier(alertID)

        case .places:
            self.homePresentation = nil
            self.selectedDay = nil
            self.hourlyFocus = nil
            self.placesPresentation = placesPresentation ?? .places
            self.initialQuery = nil
            self.planID = nil
            self.alertID = nil
        }
    }

    static func today(place: NativeAppPlaceReference? = nil, day: Date? = nil) -> Self {
        Self(section: .home, place: place, selectedDay: day, homePresentation: .today)
    }

    static func hourly(place: NativeAppPlaceReference? = nil, day: Date? = nil, focusedHour: Date? = nil) -> Self {
        Self(section: .home, place: place, selectedDay: day, hourlyFocus: focusedHour, homePresentation: .hourly)
    }

    static func places(place: NativeAppPlaceReference? = nil,
                       presentation: NativeAppPlacesPresentation = .places) -> Self {
        Self(section: .places, place: place, placesPresentation: presentation)
    }

    static func ask(place: NativeAppPlaceReference? = nil, day: Date? = nil, initialQuery: String? = nil) -> Self {
        Self(section: .ask, place: place, selectedDay: day, initialQuery: initialQuery)
    }

    static func plans(place: NativeAppPlaceReference? = nil, day: Date? = nil,
                      planID: String? = nil) -> Self {
        Self(section: .plans, place: place, selectedDay: day, planID: planID)
    }

    static func map(place: NativeAppPlaceReference? = nil, day: Date? = nil,
                    alertID: String? = nil) -> Self {
        Self(section: .map, place: place, selectedDay: day, alertID: alertID)
    }

    /// A nil route place means “use the currently verified selected place.”
    /// An explicit place must match both its immutable ID and coordinates so a
    /// stale route cannot silently resolve to a moved/replaced record.
    func resolvedPlace(in context: NativePreviewContext) -> NativePreviewPlace? {
        guard let place else { return context.selectedPlace }
        return context.places.first(where: place.matches)
    }

    private static func validDate(_ value: Date?) -> Date? {
        guard let value, value.timeIntervalSinceReferenceDate.isFinite else { return nil }
        return value
    }

    private static func normalizedQuery(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(500))
    }

    private static func normalizedIdentifier(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 160,
              trimmed.unicodeScalars.allSatisfy({ scalar in
                  (48...57).contains(scalar.value) ||
                  (65...90).contains(scalar.value) ||
                  (97...122).contains(scalar.value) ||
                  scalar.value == 46 || scalar.value == 95 || scalar.value == 45 || scalar.value == 58
              }) else {
            return nil
        }
        return trimmed
    }
}

/// Owns native navigation state only. It performs no web calls, mutations,
/// migration reads, or persistence. The root composition layer remains
/// responsible for supplying a verified forecast/Places context and for
/// deciding which feature implementations are ready to render natively.
@MainActor
final class NativeAppRouter: ObservableObject {
    @Published private(set) var root: NativeAppRoute
    @Published private(set) var path: [NativeAppRoute]
    @Published private(set) var revision = 0

    init(initialRoute: NativeAppRoute = .today()) {
        root = initialRoute
        path = []
    }

    var current: NativeAppRoute { path.last ?? root }
    var section: NativeAppSection { root.section }
    var canGoBack: Bool { !path.isEmpty }

    /// Select a primary destination such as a tab. It dismisses transient
    /// children, even when the primary section itself did not change.
    func select(_ route: NativeAppRoute, reapply: Bool = false) {
        guard reapply || root != route || !path.isEmpty else { return }
        root = route
        path.removeAll()
        revision &+= 1
    }

    /// Navigate to a contextual native child without discarding the primary
    /// destination underneath it. Duplicate current routes are ignored to
    /// prevent accidental repeated pushes from taps/scene restoration.
    func push(_ route: NativeAppRoute) {
        guard current != route else { return }
        path.append(route)
        revision &+= 1
    }

    @discardableResult
    func pop() -> NativeAppRoute? {
        guard let removed = path.popLast() else { return nil }
        revision &+= 1
        return removed
    }

    func popToRoot() {
        guard !path.isEmpty else { return }
        path.removeAll()
        revision &+= 1
    }
}

/// Forecast and saved-context publications are not navigation requests. Each
/// route is consumed once, with a narrow continuation for a day/hour that
/// needs the destination's forecast. A later user place choice cancels that
/// continuation instead of letting an old route take over the screen again.
struct NativeAppRouteApplication {
    enum Action: Equatable {
        case start
        case resume
        case ignore
    }

    private var appliedRevision: Int?
    private var pendingPlace: NativeAppPlaceReference?

    mutating func begin(revision: Int, selectedPlace: NativePreviewPlace) -> Action {
        guard appliedRevision == revision else {
            appliedRevision = revision
            pendingPlace = nil
            return .start
        }
        guard let pendingPlace else { return .ignore }
        guard pendingPlace.matches(selectedPlace) else {
            finish()
            return .ignore
        }
        return .resume
    }

    mutating func waitForForecast(at place: NativePreviewPlace) {
        pendingPlace = NativeAppPlaceReference(place)
    }

    mutating func finish() {
        pendingPlace = nil
    }
}

// MARK: - External native routes

/// A civil date stays civil until Nearcast has resolved the destination
/// place. This prevents a link for (for example) Tokyo from becoming the
/// previous day just because the phone happens to be in Chicago.
struct NativeRouteCivilDay: Codable, Hashable, Sendable {
    let year: Int
    let month: Int
    let day: Int

    init?(year: Int, month: Int, day: Int) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        let candidate = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12))
        let parts = candidate.map { calendar.dateComponents([.year, .month, .day], from: $0) }
        guard let parts, parts.year == year, parts.month == month, parts.day == day else { return nil }
        self.year = year
        self.month = month
        self.day = day
    }

    init?(_ value: String) {
        let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3,
              pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
              let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]) else {
            return nil
        }
        self.init(year: year, month: month, day: day)
    }

    func date(in timeZone: TimeZone) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12))
    }

    static func today(in timeZone: TimeZone, now: Date = Date()) -> Self? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: now)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
        return Self(year: year, month: month, day: day)
    }
}

struct NativeRouteCoordinate: Codable, Hashable, Sendable {
    let latitude: Double
    let longitude: Double

    init?(latitude: Double, longitude: Double) {
        guard latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 else {
            return nil
        }
        self.latitude = latitude
        self.longitude = longitude
    }

    func matches(_ place: NativePreviewPlace) -> Bool {
        // Preview place identity is intentionally rounded to five decimal
        // places, so a standard URL coordinate should resolve at that same
        // precision without a fuzzy, potentially-wrong place selection.
        abs(place.latitude - latitude) < 0.000_005 && abs(place.longitude - longitude) < 0.000_005
    }
}

struct NativeRoutePlaceSelector: Codable, Hashable, Sendable {
    let placeID: String?
    let coordinate: NativeRouteCoordinate?

    init(placeID: String? = nil, coordinate: NativeRouteCoordinate? = nil) {
        self.placeID = placeID
        self.coordinate = coordinate
    }
}

enum NativeDeepLinkDestination: String, Codable, Hashable, Sendable {
    case today
    case hourly
    case ask
    case plans
    case map
    case places
    case settings
}

/// The parser never grants a URL the ability to create or alter a saved
/// place. It carries a bounded selector until the root resolves it against the
/// verified native Places context.
struct NativeDeepLinkIntent: Codable, Hashable, Sendable {
    let destination: NativeDeepLinkDestination
    let place: NativeRoutePlaceSelector
    let day: NativeRouteCivilDay?
    let focusedHour: Int?
    let initialQuery: String?
    let planID: String?
    let alertID: String?

    func resolvedRoute(in context: NativePreviewContext, now: Date = Date()) -> Result<NativeAppRoute, NativeRouteUnavailable> {
        let matches = context.places.filter { candidate in
            let idMatches = place.placeID.map { candidate.id == $0 } ?? true
            let coordinatesMatch = place.coordinate.map { $0.matches(candidate) } ?? true
            return idMatches && coordinatesMatch
        }

        let selectedPlace: NativePreviewPlace
        if place.placeID == nil && place.coordinate == nil {
            selectedPlace = context.selectedPlace
        } else if matches.count == 1, let match = matches.first {
            selectedPlace = match
        } else if matches.isEmpty {
            return .failure(.unsavedPlace)
        } else {
            return .failure(.ambiguousPlace)
        }

        guard let placeReference = NativeAppPlaceReference(selectedPlace) else {
            return .failure(.unavailablePlace)
        }
        let timeZone = selectedPlace.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        let selectedDay = day?.date(in: timeZone)
        if day != nil && selectedDay == nil { return .failure(.invalidDate) }

        let resolvedFocusedHour: Date?
        if let hour = self.focusedHour {
            let focusDay = day ?? NativeRouteCivilDay.today(in: timeZone, now: now)
            guard let focusDay, let base = focusDay.date(in: timeZone) else {
                return .failure(.invalidDate)
            }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = timeZone
            resolvedFocusedHour = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: base)
        } else {
            resolvedFocusedHour = nil
        }

        switch destination {
        case .today:
            return .success(.today(place: placeReference, day: selectedDay))
        case .hourly:
            return .success(.hourly(place: placeReference, day: selectedDay, focusedHour: resolvedFocusedHour))
        case .ask:
            return .success(.ask(place: placeReference, day: selectedDay, initialQuery: initialQuery))
        case .plans:
            return .success(.plans(place: placeReference, day: selectedDay, planID: planID))
        case .map:
            return .success(.map(place: placeReference, day: selectedDay, alertID: alertID))
        case .places:
            return .success(.places(place: placeReference, presentation: .places))
        case .settings:
            return .success(.places(place: placeReference, presentation: .settings))
        }
    }
}

/// A native-only build responds to unsupported URLs with a clear in-app state
/// rather than silently opening the old web shell. The value is deliberately
/// URL-free so untrusted query text cannot become UI or diagnostics content.
enum NativeRouteUnavailable: String, Codable, Hashable, Sendable, Error, Identifiable {
    case unsupportedScheme
    case malformedURL
    case unsupportedDestination
    case conflictingDestination
    case unsupportedMapMode
    case invalidParameter
    case invalidDate
    case forecastDayUnavailable
    case unsavedPlace
    case ambiguousPlace
    case unavailablePlace

    var id: String { rawValue }

    var title: String {
        switch self {
        case .unsupportedScheme, .unsupportedDestination, .unsupportedMapMode:
            return "This link is not available in native Nearcast"
        case .unsavedPlace, .ambiguousPlace, .unavailablePlace:
            return "This place is not ready in native Nearcast"
        case .malformedURL, .conflictingDestination, .invalidParameter, .invalidDate, .forecastDayUnavailable:
            return "Nearcast could not safely open this link"
        }
    }

    var message: String {
        switch self {
        case .unsupportedScheme:
            return "This build only opens its own Nearcast links. Your current native weather screen is still available."
        case .malformedURL:
            return "The link was incomplete or too long. Your current native weather screen is still available."
        case .unsupportedDestination:
            return "That destination has not moved to the native experience yet. Your current native weather screen is still available."
        case .conflictingDestination:
            return "The link requested more than one destination, so Nearcast left your current native weather screen unchanged."
        case .unsupportedMapMode:
            return "That specific map layer has not moved to the native map yet. Your current native weather screen is still available."
        case .invalidParameter, .invalidDate:
            return "The link included an invalid weather context, so Nearcast left your current native weather screen unchanged."
        case .forecastDayUnavailable:
            return "That day is not in the weather currently loaded for this place. Nearcast left your current native weather screen unchanged."
        case .unsavedPlace:
            return "This link refers to a place that is not in this native build’s saved places. Add it in Places, then try again."
        case .ambiguousPlace:
            return "Nearcast could not safely tell which saved place this link meant. Your current native weather screen is still available."
        case .unavailablePlace:
            return "The selected native place is not available yet. Finish setting up saved places, then try again."
        }
    }
}

enum NativeDeepLinkResult: Equatable, Sendable {
    case route(NativeDeepLinkIntent)
    case unavailable(NativeRouteUnavailable)
}

/// A strict, dependency-free parser for incoming Nearcast URLs. It is shared
/// by the app root and future notification/widget routing, and deliberately
/// turns unknown or ambiguous inputs into a native unavailable state instead
/// of passing them into WebKit.
enum NativeDeepLinkRouter {
    static func parse(_ url: URL, acceptedSchemes: Set<String>) -> NativeDeepLinkResult {
        guard url.absoluteString.utf8.count <= 4_096,
              url.user == nil, url.password == nil,
              let scheme = url.scheme?.lowercased(),
              acceptedSchemes.contains(scheme) else {
            return .unavailable(url.scheme == nil ? .malformedURL : .unsupportedScheme)
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return .unavailable(.malformedURL)
        }

        let query = Query(components.queryItems ?? [])
        let path = components.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        let host = normalizedToken(components.host)

        let directDestination: NativeDeepLinkDestination?
        if let host, !host.isEmpty {
            if isNeutralHost(host) {
                if path.count > 1 { return .unavailable(.unsupportedDestination) }
                if let pathToken = path.first {
                    guard let parsed = destination(for: pathToken) else { return .unavailable(.unsupportedDestination) }
                    directDestination = parsed
                } else {
                    directDestination = nil
                }
            } else {
                guard path.isEmpty, let parsed = destination(for: host) else {
                    return .unavailable(.unsupportedDestination)
                }
                directDestination = parsed
            }
        } else if path.count <= 1 {
            if let pathToken = path.first {
                guard let parsed = destination(for: pathToken) else { return .unavailable(.unsupportedDestination) }
                directDestination = parsed
            } else {
                directDestination = nil
            }
        } else {
            return .unavailable(.unsupportedDestination)
        }

        let explicitDestination = queryDestination(in: query)
        switch explicitDestination {
        case .failure(let unavailable):
            return .unavailable(unavailable)
        case .success(let queryDestination):
            if let directDestination, let queryDestination, directDestination != queryDestination {
                return .unavailable(.conflictingDestination)
            }
            let destination = directDestination ?? queryDestination ?? .today

            switch parseIntent(destination: destination, query: query) {
            case .success(let intent): return .route(intent)
            case .failure(let unavailable): return .unavailable(unavailable)
            }
        }
    }

    private static func parseIntent(destination: NativeDeepLinkDestination, query: Query) -> Result<NativeDeepLinkIntent, NativeRouteUnavailable> {
        let placeID: String?
        switch query.value(for: ["placeid", "savedplaceid", "place"]) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let value):
            guard let value else { placeID = nil; break }
            guard let cleaned = normalizedIdentifier(value) else { return .failure(.invalidParameter) }
            placeID = cleaned
        }

        let latitude: String?
        let longitude: String?
        switch query.value(for: ["lat", "latitude"]) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let value): latitude = value
        }
        switch query.value(for: ["lon", "lng", "longitude"]) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let value): longitude = value
        }
        let coordinate: NativeRouteCoordinate?
        if latitude != nil || longitude != nil {
            guard let latitude, let longitude,
                  let parsedLatitude = Double(latitude), let parsedLongitude = Double(longitude),
                  let parsed = NativeRouteCoordinate(latitude: parsedLatitude, longitude: parsedLongitude) else {
                return .failure(.invalidParameter)
            }
            coordinate = parsed
        } else {
            coordinate = nil
        }

        let day: NativeRouteCivilDay?
        switch query.value(for: ["date", "day", "targetdate", "target_date"]) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let value):
            guard let value else { day = nil; break }
            guard let parsed = NativeRouteCivilDay(value) else { return .failure(.invalidDate) }
            day = parsed
        }

        let focusedHour: Int?
        switch query.value(for: ["hour", "focusedhour", "focushour"]) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let value):
            guard let value else { focusedHour = nil; break }
            guard let parsed = Int(value), (0...23).contains(parsed) else { return .failure(.invalidParameter) }
            focusedHour = parsed
        }

        let initialQuery: String?
        if destination == .ask {
            switch query.value(for: ["query", "q", "prompt", "initialquery"]) {
            case .failure(let unavailable): return .failure(unavailable)
            case .success(let value):
                guard let value else { initialQuery = nil; break }
                let normalized = normalizedText(value, limit: 500)
                guard !normalized.isEmpty else { return .failure(.invalidParameter) }
                initialQuery = normalized
            }
        } else {
            initialQuery = nil
        }

        let planID: String?
        if destination == .plans {
            switch query.value(for: ["planid", "memoryid", "plan"]) {
            case .failure(let unavailable): return .failure(unavailable)
            case .success(let value):
                guard let value else { planID = nil; break }
                guard let normalized = normalizedIdentifier(value) else { return .failure(.invalidParameter) }
                planID = normalized
            }
        } else {
            planID = nil
        }

        let alertID: String?
        if destination == .map {
            switch query.value(for: ["alertid", "alert"]) {
            case .failure(let unavailable): return .failure(unavailable)
            case .success(let value):
                guard let value else { alertID = nil; break }
                guard let normalized = normalizedIdentifier(value) else { return .failure(.invalidParameter) }
                alertID = normalized
            }
            switch query.value(for: ["mode", "layer"]) {
            case .failure(let unavailable): return .failure(unavailable)
            case .success(let value):
                if let value, !allowedMapModes.contains(normalizedToken(value) ?? "") {
                    return .failure(.unsupportedMapMode)
                }
            }
        } else {
            alertID = nil
        }

        return .success(NativeDeepLinkIntent(
            destination: destination,
            place: NativeRoutePlaceSelector(placeID: placeID, coordinate: coordinate),
            day: day,
            focusedHour: focusedHour,
            initialQuery: initialQuery,
            planID: planID,
            alertID: alertID
        ))
    }

    private static let allowedMapModes: Set<String> = [
        "radar", "observed", "forecast", "satellite", "aerial", "rain", "rainfall"
    ]

    private static func queryDestination(in query: Query) -> Result<NativeDeepLinkDestination?, NativeRouteUnavailable> {
        let primaryKeys = ["target", "nearcasttarget", "route", "view", "screen", "destination", "tab"]
        switch query.values(for: primaryKeys) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let values):
            let candidates = values.compactMap { destination(for: $0) }
            if values.contains(where: { destination(for: $0) == nil }) { return .failure(.unsupportedDestination) }
            let unique = Set(candidates)
            if unique.count > 1 { return .failure(.conflictingDestination) }
            if let destination = unique.first { return .success(destination) }
        }

        switch query.values(for: ["surface"]) {
        case .failure(let unavailable): return .failure(unavailable)
        case .success(let values):
            let candidates = values.compactMap(surfaceDestination(for:))
            if values.contains(where: { surfaceDestination(for: $0) == nil }) { return .failure(.unsupportedDestination) }
            let unique = Set(candidates)
            if unique.count > 1 { return .failure(.conflictingDestination) }
            return .success(unique.first)
        }
    }

    private static func destination(for raw: String) -> NativeDeepLinkDestination? {
        switch normalizedToken(raw) {
        case "", "weather", "native-preview", "home", "today", "current", "brief", "next", "temperature":
            return .today
        case "hourly", "hours", "hour", "day", "rain":
            return .hourly
        case "ask", "assistant", "ai":
            return .ask
        case "plans", "plan", "agenda":
            return .plans
        case "map", "radar", "watching", "alert", "alerts":
            return .map
        case "places", "place":
            return .places
        case "settings", "preferences":
            return .settings
        default:
            return nil
        }
    }

    private static func surfaceDestination(for raw: String) -> NativeDeepLinkDestination? {
        switch normalizedToken(raw) {
        case "today", "next", "brief", "temperature", "wind", "days":
            return .today
        case "hours", "hourly", "rain":
            return .hourly
        case "plan", "plans":
            return .plans
        default:
            return nil
        }
    }

    private static func isNeutralHost(_ value: String) -> Bool {
        ["", "weather", "native-preview", "home"].contains(value)
    }

    private static func normalizedToken(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return normalized.isEmpty ? "" : normalized
    }

    private static func normalizedText(_ value: String, limit: Int) -> String {
        let compact = value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(compact.prefix(limit))
    }

    private static func normalizedIdentifier(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 160,
              trimmed.unicodeScalars.allSatisfy({ scalar in
                  (48...57).contains(scalar.value) ||
                  (65...90).contains(scalar.value) ||
                  (97...122).contains(scalar.value) ||
                  scalar.value == 46 || scalar.value == 95 || scalar.value == 45 || scalar.value == 58
              }) else {
            return nil
        }
        return trimmed
    }

    private struct Query {
        let items: [URLQueryItem]

        init(_ items: [URLQueryItem]) {
            self.items = items
        }

        func value(for keys: [String]) -> Result<String?, NativeRouteUnavailable> {
            switch values(for: keys) {
            case .failure(let unavailable): return .failure(unavailable)
            case .success(let values):
                let unique = Set(values)
                guard unique.count <= 1 else { return .failure(.conflictingDestination) }
                return .success(unique.first)
            }
        }

        func values(for keys: [String]) -> Result<[String], NativeRouteUnavailable> {
            let allowed = Set(keys.map { $0.lowercased() })
            let values = items.compactMap { item -> String? in
                guard allowed.contains(item.name.lowercased()), let value = item.value else { return nil }
                let normalized = NativeDeepLinkRouter.normalizedText(value, limit: 1_024)
                return normalized.isEmpty ? nil : normalized
            }
            return .success(values)
        }
    }
}

// MARK: - Native notification routes

/// Converts a bounded, untrusted APNs payload into the same typed route used
/// for app, widget, Watch, and Live Activity links. The notification boundary
/// deliberately accepts only Nearcast's own URL schemes or its public domain;
/// it never opens an arbitrary URL and never lets a payload create a place.
///
/// A notification can arrive before the phone has a foreground scene, so this
/// type remains pure. The native root resolves the returned intent only after
/// it has loaded a verified Places context.
enum NativeNotificationRouteParser {
    static func parse(_ userInfo: [AnyHashable: Any], acceptedSchemes: Set<String>) -> NativeDeepLinkResult {
        let normalizedSchemes = Set(acceptedSchemes.map { $0.lowercased() })
        guard let primaryScheme = normalizedSchemes.sorted().first, !primaryScheme.isEmpty else {
            return .unavailable(.unsupportedScheme)
        }

        let payload = Payload(userInfo)
        let rawURL: String?
        switch payload.value(for: ["url", "link", "deeplink", "deep_link", "targeturl"]) {
        case .failure(let unavailable): return .unavailable(unavailable)
        case .success(let value): rawURL = value
        }

        var components = URLComponents()
        components.scheme = primaryScheme
        components.host = "weather"

        if let rawURL, !rawURL.isEmpty {
            guard rawURL.utf8.count <= 4_096,
                  let source = URL(string: rawURL),
                  source.user == nil, source.password == nil,
                  let sourceScheme = source.scheme?.lowercased() else {
                return .unavailable(.malformedURL)
            }

            if normalizedSchemes.contains(sourceScheme) {
                guard let sourceComponents = URLComponents(url: source, resolvingAgainstBaseURL: false) else {
                    return .unavailable(.malformedURL)
                }
                components.host = sourceComponents.host ?? "weather"
                components.path = sourceComponents.path
                payload.absorbQuery(sourceComponents.queryItems ?? [])
            } else if sourceScheme == "https",
                      let host = source.host?.lowercased(),
                      ["getnearcast.app", "www.getnearcast.app"].contains(host),
                      source.port == nil || source.port == 443 {
                // Preserve only a shallow public path. The deep-link parser
                // remains the one source of truth for its exact grammar.
                let path = source.path.split(separator: "/", omittingEmptySubsequences: true)
                guard path.count <= 1 else { return .unavailable(.unsupportedDestination) }
                if let destination = path.first, !destination.isEmpty {
                    components.path = "/\(destination)"
                }
                payload.absorbQuery(URLComponents(url: source, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            } else {
                return .unavailable(.unsupportedScheme)
            }
        }

        let target: String?
        switch payload.value(for: ["target", "nearcasttarget", "route", "view", "screen", "destination", "tab"]) {
        case .failure(let unavailable): return .unavailable(unavailable)
        case .success(let value): target = value
        }

        let planID: String?
        switch payload.value(for: ["planid", "memoryid", "plan"]) {
        case .failure(let unavailable): return .unavailable(unavailable)
        case .success(let value): planID = value
        }

        let alertID: String?
        switch payload.value(for: ["alertid", "alert"]) {
        case .failure(let unavailable): return .unavailable(unavailable)
        case .success(let value): alertID = value
        }

        var query: [URLQueryItem] = []
        if let target { query.append(URLQueryItem(name: "target", value: target)) }
        else if components.host == "weather", components.path.isEmpty {
            // An old watch notification may not include an explicit route. A
            // stable plan/alert identifier is enough to open the safest
            // native summary rather than asking WebKit to interpret it.
            if planID != nil { query.append(URLQueryItem(name: "target", value: "plans")) }
            else if alertID != nil { query.append(URLQueryItem(name: "target", value: "map")) }
        }

        let fields: [(canonical: String, aliases: [String])] = [
            ("placeId", ["placeid", "savedplaceid", "place"]),
            ("lat", ["lat", "latitude"]),
            ("lon", ["lon", "lng", "longitude"]),
            ("date", ["date", "day", "targetdate", "target_date"]),
            ("hour", ["hour", "focusedhour", "focushour"]),
            ("query", ["query", "q", "prompt", "initialquery"]),
            ("planId", ["planid", "memoryid", "plan"]),
            ("alertId", ["alertid", "alert"]),
            ("mode", ["mode", "layer"])
        ]

        for field in fields {
            switch payload.value(for: field.aliases) {
            case .failure(let unavailable): return .unavailable(unavailable)
            case .success(let value):
                if let value { query.append(URLQueryItem(name: field.canonical, value: value)) }
            }
        }
        components.queryItems = query.isEmpty ? nil : query

        guard let url = components.url else { return .unavailable(.malformedURL) }
        return NativeDeepLinkRouter.parse(url, acceptedSchemes: normalizedSchemes)
    }

    /// `aps` is presentation metadata, not routing input. Treat all useful
    /// data as plain text and reject conflicting values instead of guessing
    /// which source should win.
    private final class Payload {
        private var values: [String: [String]] = [:]

        init(_ userInfo: [AnyHashable: Any]) {
            absorb(userInfo)
            for key in ["data", "notification", "nearcast"] {
                if let nested = userInfo[key] as? [AnyHashable: Any] {
                    absorb(nested)
                } else if let nested = userInfo[key] as? [String: Any] {
                    absorb(nested)
                }
            }
        }

        func absorbQuery(_ items: [URLQueryItem]) {
            for item in items {
                guard let value = item.value else { continue }
                append(name: item.name, value: value)
            }
        }

        func value(for aliases: [String]) -> Result<String?, NativeRouteUnavailable> {
            let names = Set(aliases.map(Self.normalizeName))
            let candidates = names.flatMap { values[$0] ?? [] }
            let unique = Array(Set(candidates)).sorted()
            guard unique.count <= 1 else { return .failure(.conflictingDestination) }
            return .success(unique.first)
        }

        private func absorb(_ source: [AnyHashable: Any]) {
            for (key, value) in source {
                guard let name = key as? String, name.lowercased() != "aps" else { continue }
                append(name: name, value: value)
            }
        }

        private func absorb(_ source: [String: Any]) {
            for (name, value) in source where name.lowercased() != "aps" {
                append(name: name, value: value)
            }
        }

        private func append(name: String, value: Any) {
            let text: String
            switch value {
            case let value as String: text = value
            case let value as NSNumber: text = value.stringValue
            default: return
            }
            let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleaned.isEmpty, cleaned.utf8.count <= 4_096 else { return }
            values[Self.normalizeName(name), default: []].append(cleaned)
        }

        private static func normalizeName(_ value: String) -> String {
            value.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "_", with: "")
                .replacingOccurrences(of: "-", with: "")
                .lowercased()
        }
    }
}
