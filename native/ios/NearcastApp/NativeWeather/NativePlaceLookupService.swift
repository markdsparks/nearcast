import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CoreLocation) && os(iOS)
import CoreLocation
#endif

enum NativePlaceLookupError: LocalizedError, Equatable {
    case invalidQuery, invalidResponse, unavailable, timedOut, permissionDenied, locationUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidQuery: return "Enter a city or town, optionally followed by its state or country."
        case .invalidResponse, .unavailable: return "Could not search places. Check the connection and try again."
        case .timedOut: return "Place lookup timed out. Search for a place or try again."
        case .permissionDenied: return "Location permission was not granted. Search for a place or enable location in Settings."
        case .locationUnavailable: return "Current location is unavailable. Search for a place or try again."
        }
    }
}

/// Read-only lookup using the same providers as app.js. No saved-place writes,
/// location cache, telemetry, or permission requests occur during search.
struct NativePlaceLookupService: Sendable {
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)
    static let timeout: TimeInterval = 12
    static let maximumResults = 8
    private static let maximumPayloadBytes = 256 * 1_024
    private let transport: Transport
    private let timeoutInterval: TimeInterval

    init(session: URLSession? = nil) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.timeout
        configuration.timeoutIntervalForResource = Self.timeout
        configuration.urlCache = nil
        let session = session ?? URLSession(configuration: configuration)
        transport = { try await session.data(for: $0) }
        timeoutInterval = Self.timeout
    }

    /// The shorter deadline is useful for deterministic transport tests. Callers
    /// cannot increase the production service's twelve-second maximum.
    init(timeout: TimeInterval = Self.timeout, transport: @escaping Transport) {
        self.transport = transport
        timeoutInterval = timeout.isFinite ? min(Self.timeout, max(0.001, timeout)) : Self.timeout
    }

    func search(query: String) async throws -> [NativeManagedPlace] {
        try Task.checkCancellation()
        let parsed = try Query(query)
        guard parsed.primary.count >= 2 else { return [] }
        do {
            return try await withThrowingTaskGroup(of: [NativeManagedPlace].self) { group in
                group.addTask { try await performSearch(parsed) }
                group.addTask {
                    try await Task.sleep(nanoseconds: UInt64(timeoutInterval * 1_000_000_000))
                    throw NativePlaceLookupError.timedOut
                }
                defer { group.cancelAll() }
                guard let result = try await group.next() else { throw CancellationError() }
                try Task.checkCancellation()
                return result
            }
        } catch {
            throw Self.safeError(error)
        }
    }

    private func performSearch(_ query: Query) async throws -> [NativeManagedPlace] {
        // Qualified searches need a wider bounded candidate pool so a smaller
        // town is not hidden by a more populous namesake in another state.
        for name in query.variants {
            try Task.checkCancellation()
            var components = URLComponents(string: "https://geocoding-api.open-meteo.com/v1/search")!
            components.queryItems = [URLQueryItem(name: "name", value: name),
                URLQueryItem(name: "count", value: query.isQualified ? "100" : "12"),
                URLQueryItem(name: "language", value: "en"), URLQueryItem(name: "format", value: "json")]
            if let country = query.countryCode { components.queryItems?.append(URLQueryItem(name: "countryCode", value: country)) }
            let data = try await fetch(components.url!, timeout: timeoutInterval)
            let results = try Self.parseSearchResponse(data, query: query)
            if !results.isEmpty { return results }
        }
        return []
    }

    private func fetch(_ url: URL, timeout: TimeInterval) async throws -> Data {
        var request = URLRequest(url: url)
        request.timeoutInterval = min(timeout, Self.timeout)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await transport(request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              response.url?.scheme == "https", response.url?.host == url.host, response.url?.path == url.path,
              data.count <= Self.maximumPayloadBytes else { throw NativePlaceLookupError.invalidResponse }
        return data
    }

    static func parseSearchResponse(_ data: Data, query: String) throws -> [NativeManagedPlace] {
        try parseSearchResponse(data, query: Query(query))
    }

    private static func parseSearchResponse(_ data: Data, query: Query) throws -> [NativeManagedPlace] {
        guard data.count <= maximumPayloadBytes,
              let envelope = try? JSONDecoder().decode(SearchEnvelope.self, from: data),
              envelope.error != true, (envelope.results?.count ?? 0) <= 100 else { throw NativePlaceLookupError.invalidResponse }
        var seen = Set<String>()
        return (envelope.results ?? []).compactMap(\.value).enumerated().compactMap { index, candidate -> (NativeManagedPlace, Double, Int)? in
            guard let place = candidate.place, query.matches(place), seen.insert(place.id).inserted else { return nil }
            return (place, candidate.score(query), index)
        }.sorted { $0.1 == $1.1 ? $0.2 < $1.2 : $0.1 > $1.1 }.prefix(maximumResults).map(\.0)
    }

    private struct SearchEnvelope: Decodable {
        let results: [LossyPlace]?
        let error: Bool?
    }

    private struct LossyPlace: Decodable {
        let value: ProviderPlace?
        init(from decoder: Decoder) throws { value = try? ProviderPlace(from: decoder) }
    }

    private struct ProviderPlace: Decodable {
        let id: UInt64
        let name: String
        let admin1: String?
        let country: String
        let country_code: String
        let latitude: Double
        let longitude: Double
        let timezone: String
        let feature_code: String?
        let population: Double?

        var place: NativeManagedPlace? {
            let code = country_code.uppercased()
            guard id > 0, id <= 9_007_199_254_740_991, Self.validCountry(code),
                  !country.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !timezone.isEmpty else { return nil }
            let value = NativeManagedPlace(id: String(id), legacyIDType: "number", name: name,
                admin1: admin1 ?? "", country: country, countryCode: code,
                latitude: latitude, longitude: longitude, timezone: timezone, followsCurrentLocation: false)
            return value.isValid ? value : nil
        }

        private static func validCountry(_ code: String) -> Bool { NativePlaceLookupService.countryCodes.contains(code) }

        func score(_ query: Query) -> Double {
            let nameKey = NativePlaceLookupService.key(name)
            let primaryKey = NativePlaceLookupService.key(query.primary)
            var score: Double = nameKey == primaryKey ? 35 : (nameKey.hasPrefix(primaryKey) ? 18 : (nameKey.contains(primaryKey) ? 8 : 0))
            if query.countryCode == country_code.uppercased() { score += 70 }
            if let region = query.region, NativePlaceLookupService.key(admin1 ?? "") == NativePlaceLookupService.key(region) { score += 80 }
            switch feature_code {
            case "PPLC": score += 35
            case "PPLA": score += 18
            case "PPLA2", "PPLA3": score += 10
            default: break
            }
            if let population, population.isFinite, population > 0 { score += min(32, log10(population) * 5) }
            return score
        }
    }

    private struct Query {
        let primary: String
        let region: String?
        let countryCode: String?
        var isQualified: Bool { region != nil || countryCode != nil }

        init(_ value: String) throws {
            guard value.utf16.count <= 180, !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
                throw NativePlaceLookupError.invalidQuery
            }
            let raw = value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            var name = parts.first ?? raw
            var region: String?
            var country: String?
            if parts.count > 1 {
                let qualifier = parts.dropFirst().joined(separator: " ")
                if let state = NativePlaceLookupService.state(qualifier) {
                    region = state; country = "US"
                } else if let code = NativePlaceLookupService.country(qualifier) {
                    country = code
                } else if let suffix = Self.suffix(qualifier, resolve: NativePlaceLookupService.country) {
                    country = suffix.resolved
                    region = country == "US" ? NativePlaceLookupService.state(suffix.primary) ?? suffix.primary : suffix.primary
                } else {
                    region = qualifier
                }
            } else if let suffix = Self.suffix(raw, resolve: NativePlaceLookupService.state) {
                name = suffix.primary; region = suffix.resolved; country = "US"
            } else if let suffix = Self.suffix(raw, resolve: NativePlaceLookupService.country) {
                name = suffix.primary; country = suffix.resolved
                if country == "US", let stateSuffix = Self.suffix(name, resolve: NativePlaceLookupService.state) {
                    name = stateSuffix.primary; region = stateSuffix.resolved
                }
            }
            primary = name; self.region = region; countryCode = country
        }

        private static func suffix(_ value: String, resolve: (String) -> String?) -> (primary: String, resolved: String)? {
            let tokens = value.split(separator: " ")
            guard tokens.count > 1 else { return nil }
            for count in stride(from: min(tokens.count - 1, 5), through: 1, by: -1) {
                if let result = resolve(tokens.suffix(count).joined(separator: " ")) {
                    return (tokens.dropLast(count).joined(separator: " "), result)
                }
            }
            return nil
        }

        var variants: [String] {
            let apostrophe = primary.replacingOccurrences(of: "[‘’ʼʻ`´]", with: "'", options: .regularExpression)
            var values = [primary, apostrophe]
            let tokens = apostrophe.split(separator: " ", maxSplits: 1)
            if tokens.count == 2, tokens[0].count == 1 { values.append(tokens.joined(separator: "'")) }
            var seen = Set<String>()
            return values.filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
        }

        func matches(_ place: NativeManagedPlace) -> Bool {
            if let countryCode, place.countryCode != countryCode { return false }
            if let region, NativePlaceLookupService.key(place.admin1) != NativePlaceLookupService.key(region) { return false }
            return true
        }
    }

    private static func key(_ value: String) -> String {
        value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: "&", with: " and ")
            .replacingOccurrences(of: "[^\\p{L}\\p{N}]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func state(_ value: String) -> String? {
        let compact = value.replacingOccurrences(of: ".", with: "").uppercased()
        return states[compact] ?? states.values.first { key($0) == key(value) }
    }

    private static let states = [
        "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
        "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
        "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
        "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
        "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
        "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
        "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
        "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
        "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia"
    ]

    private static let countryCodes = Set(Locale.Region.isoRegions.map(\.identifier) + ["XK"])
    private static let countries: [String: String] = {
        let locale = Locale(identifier: "en_US")
        var values: [String: String] = [:]
        for code in countryCodes {
            values[key(code)] = code
            if let name = locale.localizedString(forRegionCode: code) { values[key(name)] = code }
        }
        let aliases = ["america": "US", "united states of america": "US", "usa": "US", "u s": "US", "u s a": "US",
            "uk": "GB", "u k": "GB", "britain": "GB", "great britain": "GB", "england": "GB", "scotland": "GB",
            "wales": "GB", "northern ireland": "GB", "uae": "AE", "u a e": "AE", "south korea": "KR", "north korea": "KP",
            "czech republic": "CZ", "russia": "RU", "ivory coast": "CI", "cote d ivoire": "CI", "bolivia": "BO",
            "brunei": "BN", "iran": "IR", "laos": "LA", "macedonia": "MK", "moldova": "MD", "palestine": "PS",
            "syria": "SY", "tanzania": "TZ", "turkey": "TR", "venezuela": "VE", "vietnam": "VN", "aland": "AX",
            "aland islands": "AX", "curacao": "CW", "reunion": "RE", "kosovo": "XK"]
        for (alias, code) in aliases { values[key(alias)] = code }
        return values
    }()

    private static func country(_ value: String) -> String? { countries[key(value)] }

    private static func safeError(_ error: Error) -> Error {
        if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { return CancellationError() }
        if let error = error as? NativePlaceLookupError { return error }
        if (error as? URLError)?.code == .timedOut { return NativePlaceLookupError.timedOut }
        return NativePlaceLookupError.unavailable
    }

    #if canImport(CoreLocation) && os(iOS)
    /// Call only in direct response to the user's Current Location action.
    /// Permission is checked before any fix can be consumed or reverse lookup sent.
    @MainActor
    func currentLocation() async throws -> NativeManagedPlace {
        try Task.checkCancellation()
        return try await withThrowingTaskGroup(of: NativeManagedPlace.self) { group in
            group.addTask { try await resolveCurrentLocation() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeoutInterval * 1_000_000_000))
                throw NativePlaceLookupError.timedOut
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else { throw CancellationError() }
            try Task.checkCancellation()
            return result
        }
    }

    @MainActor
    private func resolveCurrentLocation() async throws -> NativeManagedPlace {
        try Task.checkCancellation()
        let request = NativePlaceLocationRequest()
        let location = try await request.start()
        try Task.checkCancellation()
        guard request.isAuthorized else { throw NativePlaceLookupError.permissionDenied }
        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        let format: (Double) -> String = { String(format: "%.3f", locale: Locale(identifier: "en_US_POSIX"), $0) }
        let fallback = NativeManagedPlace(id: "gps-\(format(latitude))-\(format(longitude))", name: "Current Location",
            admin1: "", country: "", latitude: latitude, longitude: longitude, followsCurrentLocation: true)
        // The web implementation already uses Nominatim for this exact action.
        // A name failure may use this newly authorized fix, never a stored fix.
        var components = URLComponents(string: "https://nominatim.openstreetmap.org/reverse")!
        components.queryItems = [URLQueryItem(name: "format", value: "jsonv2"),
            URLQueryItem(name: "lat", value: String(format: "%.5f", locale: Locale(identifier: "en_US_POSIX"), latitude)),
            URLQueryItem(name: "lon", value: String(format: "%.5f", locale: Locale(identifier: "en_US_POSIX"), longitude)),
            URLQueryItem(name: "zoom", value: "12"), URLQueryItem(name: "addressdetails", value: "1"),
            URLQueryItem(name: "layer", value: "address"), URLQueryItem(name: "accept-language", value: "en")]
        do {
            let data = try await fetch(components.url!, timeout: 4)
            try Task.checkCancellation()
            guard request.isAuthorized else { throw NativePlaceLookupError.permissionDenied }
            return Self.parseReverseResponse(data, fallback: fallback) ?? fallback
        } catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            guard request.isAuthorized else { throw NativePlaceLookupError.permissionDenied }
            return fallback
        }
    }
    #endif

    static func parseReverseResponse(_ data: Data, fallback: NativeManagedPlace) -> NativeManagedPlace? {
        guard fallback.isValid, fallback.followsCurrentLocation == true, data.count <= maximumPayloadBytes,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let address = json["address"] as? [String: Any] else { return nil }
        let names = ["city", "town", "village", "municipality", "hamlet", "suburb", "county"]
        guard let name = names.compactMap({ address[$0] as? String }).first(where: { !$0.isEmpty }),
              let country = address["country"] as? String, !country.isEmpty,
              let code = (address["country_code"] as? String)?.uppercased(), countryCodes.contains(code) else { return nil }
        var result = fallback
        result.name = name
        result.admin1 = ["state", "region", "state_district"].compactMap { address[$0] as? String }.first ?? ""
        result.country = country
        result.countryCode = code
        return result.isValid ? result : nil
    }
}

#if canImport(CoreLocation) && os(iOS)
@MainActor
private final class NativePlaceLocationRequest: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var timeoutTask: Task<Void, Never>?
    private var requestedFix = false

    var isAuthorized: Bool { manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func start() async throws -> CLLocation {
        try Task.checkCancellation()
        guard manager.authorizationStatus != .denied, manager.authorizationStatus != .restricted else {
            throw NativePlaceLookupError.permissionDenied
        }
        guard CLLocationManager.locationServicesEnabled() else { throw NativePlaceLookupError.locationUnavailable }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                timeoutTask = Task { @MainActor [weak self] in
                    do { try await Task.sleep(nanoseconds: 12_000_000_000) } catch { return }
                    self?.finish(.failure(NativePlaceLookupError.timedOut))
                }
                if Task.isCancelled { finish(.failure(CancellationError())); return }
                if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
                else { requestFix() }
            }
        } onCancel: {
            Task { @MainActor in self.finish(.failure(CancellationError())) }
        }
    }

    private func requestFix() {
        guard continuation != nil, isAuthorized, !requestedFix else { return }
        requestedFix = true
        manager.requestLocation()
    }

    private func finish(_ result: Result<CLLocation, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        manager.stopUpdatingLocation()
        continuation.resume(with: result)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: requestFix()
        case .denied, .restricted: finish(.failure(NativePlaceLookupError.permissionDenied))
        case .notDetermined: break
        @unknown default: finish(.failure(NativePlaceLookupError.locationUnavailable))
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isAuthorized else { finish(.failure(NativePlaceLookupError.permissionDenied)); return }
        let now = Date()
        guard let fix = locations.filter({
            let age = now.timeIntervalSince($0.timestamp)
            return CLLocationCoordinate2DIsValid($0.coordinate) && $0.horizontalAccuracy >= 0 &&
                $0.horizontalAccuracy <= 5_000 && age >= -30 && age <= 60
        }).max(by: { $0.timestamp < $1.timestamp }) else { return }
        finish(.success(fix))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let value = error as NSError
        if value.domain == kCLErrorDomain, value.code == CLError.locationUnknown.rawValue { return }
        finish(.failure(isAuthorized ? NativePlaceLookupError.locationUnavailable : NativePlaceLookupError.permissionDenied))
    }
}
#endif
