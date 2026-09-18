import Foundation
import Combine

/// Allowlisted receipts from the verified owner. Legacy is authoritative before
/// handover; native storage is authoritative afterward. The controls never
/// manufacture an optimistic inventory or a second independently mutable copy.
struct NativeManagedPlace: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var legacyIDType: String? = nil
    var name: String
    var admin1: String
    var country: String
    var countryCode: String? = nil
    var latitude: Double
    var longitude: Double
    var alias: String? = nil
    var timezone: String? = nil
    var followsCurrentLocation: Bool? = nil

    enum CodingKeys: String, CodingKey, CaseIterable {
        case id, legacyIDType, name, admin1, country, countryCode, latitude, longitude, alias, timezone, followsCurrentLocation
    }

    var displayName: String {
        if let alias, !alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return alias }
        return name
    }

    var subtitle: String {
        var parts: [String] = []
        for part in [name, admin1, country] where !part.isEmpty {
            if !parts.contains(part) { parts.append(part) }
        }
        return parts.joined(separator: ", ")
    }

    var previewPlace: NativePreviewPlace {
        // Navigation handoffs compare this label with the existing app's
        // placeLabel/nativePreviewPlaceRecord, which intentionally ignores aliases.
        let qualifiers = Set([admin1, country].map(Self.qualifierKey).filter { !$0.isEmpty })
        var parts = name.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        while parts.count > 1, Self.qualifierKey(parts[parts.count - 1]) == Self.qualifierKey(parts[parts.count - 2]) { parts.removeLast() }
        while parts.count > 1, qualifiers.contains(Self.qualifierKey(parts[parts.count - 1])) { parts.removeLast() }
        let canonicalName = parts.isEmpty ? "Selected Place" : parts.joined(separator: ", ")
        let labels = !admin1.isEmpty && !country.isEmpty && countryCode != nil && countryCode != "US"
            ? [canonicalName, admin1, country] : [canonicalName, admin1.isEmpty ? country : admin1]
        var seen = Set<String>()
        let label = labels.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter {
            let key = Self.qualifierKey($0)
            return !key.isEmpty && seen.insert(key).inserted
        }.joined(separator: ", ")
        return NativePreviewPlace(id: id.trimmingCharacters(in: .whitespacesAndNewlines),
            name: String(decoding: label.utf16.prefix(180), as: UTF16.self),
            latitude: latitude, longitude: longitude, timezone: timezone, countryCode: countryCode)
    }

    private static func qualifierKey(_ value: String) -> String {
        value.decomposedStringWithCanonicalMapping
            .replacingOccurrences(of: "[\u{0300}-\u{036f}]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&", with: " and ")
            .replacingOccurrences(of: "[^a-zA-Z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var isValid: Bool {
        guard NativePlacesValidation.text(id, max: 160, nonblank: true),
              NativePlacesValidation.text(name, max: 180, nonblank: true),
              NativePlacesValidation.text(admin1, max: 180), NativePlacesValidation.text(country, max: 180),
              latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180,
              alias.map({ NativePlacesValidation.text($0, max: 36) }) ?? true,
              timezone.map({ $0.utf16.count <= 100 && TimeZone(identifier: $0) != nil }) ?? true,
              countryCode.map({ $0.utf8.count == 2 && $0.unicodeScalars.allSatisfy { (65...90).contains($0.value) } }) ?? true else { return false }
        if let legacyIDType {
            guard legacyIDType == "number", let numericID = UInt64(id), numericID > 0,
                  numericID <= 9_007_199_254_740_991, String(numericID) == id else { return false }
        }
        return true
    }

    func hasSameIdentity(as other: Self) -> Bool {
        id == other.id && legacyIDType == other.legacyIDType && latitude == other.latitude && longitude == other.longitude
    }
}

struct NativePlacesPreferences: Codable, Equatable, Sendable {
    var unit: String
    var timeFormat: String
    var theme: String
    var reactiveSkyEnabled: Bool
    var reactiveSkyMotionAllowed: Bool

    enum CodingKeys: String, CodingKey, CaseIterable {
        case unit, timeFormat, theme, reactiveSkyEnabled, reactiveSkyMotionAllowed
    }

    var isValid: Bool {
        ["fahrenheit", "celsius"].contains(unit) && ["auto", "12", "24"].contains(timeFormat) &&
        ["auto", "light", "dark"].contains(theme)
    }
}

struct NativePlacesSource: Codable, Equatable, Sendable {
    var version: Int = 1
    var owner: String = "legacy"
    var hydration: String = "ready"
    var capturedAt: String
    var selectedPlace: NativeManagedPlace?
    var lastPlace: NativeManagedPlace?
    var savedPlaces: [NativeManagedPlace]
    var preferences: NativePlacesPreferences

    enum CodingKeys: String, CodingKey, CaseIterable {
        case version, owner, hydration, capturedAt, selectedPlace, lastPlace, savedPlaces, preferences
    }

    var captureDate: Date? { NativePlacesValidation.captureDate(capturedAt) }

    var isValid: Bool {
        version == 1 && ["legacy", "native"].contains(owner) && hydration == "ready" && captureDate != nil &&
        (selectedPlace?.isValid ?? true) && (lastPlace?.isValid ?? true) && savedPlaces.count <= 60 &&
        savedPlaces.allSatisfy(\.isValid) && Set(savedPlaces.map(\.id)).count == savedPlaces.count && preferences.isValid
    }

    func toPreviewContext(locale: Locale = .current) -> NativePreviewContext? {
        guard isValid, let selectedPlace else { return nil }
        let uses24Hours: Bool
        switch preferences.timeFormat {
        case "24": uses24Hours = true
        case "12": uses24Hours = false
        default:
            // The localized hour cycle honors the user's device clock preference.
            // Do not derive Auto from the selected city's country or time zone.
            let format = DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: locale) ?? "h a"
            uses24Hours = format.contains("H") || format.contains("k")
        }
        let context = NativePreviewContext(version: 1, selectedPlace: selectedPlace.previewPlace,
            // Match the existing preview builder: an unsupported display label
            // may be omitted from this disposable context, never from saved data.
            savedPlaces: savedPlaces.map(\.previewPlace).filter(\.isValid), metric: preferences.unit == "celsius",
            uses24HourClock: uses24Hours, theme: preferences.theme)
        // The legacy navigation label may be unavailable even for valid stored
        // records (for example entirely non-Latin qualifiers). Never replace a
        // usable native forecast with a context that its reader would reject.
        guard let encoded = try? JSONEncoder().encode(context) else { return nil }
        return try? NativePreviewContext.decode(encoded)
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(version, forKey: .version)
        try values.encode(owner, forKey: .owner)
        try values.encode(hydration, forKey: .hydration)
        try values.encode(capturedAt, forKey: .capturedAt)
        // Explicit nulls are part of the migration schema's complete-inventory contract.
        try values.encode(selectedPlace, forKey: .selectedPlace)
        try values.encode(lastPlace, forKey: .lastPlace)
        try values.encode(savedPlaces, forKey: .savedPlaces)
        try values.encode(preferences, forKey: .preferences)
    }
}

struct NativePlacesPreferencePatch: Codable, Equatable, Sendable {
    var unit: String? = nil
    var timeFormat: String? = nil
    var theme: String? = nil
    var reactiveSkyEnabled: Bool? = nil
    var reactiveSkyMotionAllowed: Bool? = nil

    enum CodingKeys: String, CodingKey, CaseIterable {
        case unit, timeFormat, theme, reactiveSkyEnabled, reactiveSkyMotionAllowed
    }

    var isValid: Bool {
        (unit != nil || timeFormat != nil || theme != nil || reactiveSkyEnabled != nil || reactiveSkyMotionAllowed != nil) &&
        (unit.map { ["fahrenheit", "celsius"].contains($0) } ?? true) &&
        (timeFormat.map { ["auto", "12", "24"].contains($0) } ?? true) &&
        (theme.map { ["auto", "light", "dark"].contains($0) } ?? true)
    }
}

struct NativePlacesCommand: Codable, Equatable, Sendable {
    var version: Int = 1
    var requestID: String = UUID().uuidString
    var action: String
    var place: NativeManagedPlace? = nil
    var id: String? = nil
    var query: String? = nil
    var alias: String? = nil
    var direction: Int? = nil
    var preferences: NativePlacesPreferencePatch? = nil
    var expectedSource: NativePlacesSource? = nil
}

struct NativePlacesReply: Codable, Equatable, Sendable {
    var version: Int = 1
    var requestID: String
    var ok: Bool
    var source: NativePlacesSource? = nil
    var results: [NativeManagedPlace]? = nil
    var message: String? = nil
    var code: String? = nil

    enum CodingKeys: String, CodingKey, CaseIterable {
        case version, requestID, ok, source, results, message, code
    }

    func isValid(for command: NativePlacesCommand) -> Bool {
        version == 1 && requestID == command.requestID && UUID(uuidString: requestID) != nil &&
        (source?.isValid ?? true) && (results.map { $0.count <= 60 && $0.allSatisfy(\.isValid) && Set($0.map(\.id)).count == $0.count } ?? true) &&
        (message.map { NativePlacesValidation.text($0, max: 500) } ?? true) &&
        (code.map { NativePlacesValidation.text($0, max: 80) } ?? true)
    }
}

@MainActor
final class NativePlacesControlsModel: ObservableObject {
    typealias Transport = @MainActor (NativePlacesCommand) async throws -> NativePlacesReply

    @Published private(set) var source: NativePlacesSource?
    @Published private(set) var searchResults: [NativeManagedPlace] = []
    @Published private(set) var isBusy = false
    @Published private(set) var isSearching = false
    @Published private(set) var errorMessage: String?

    private let transport: Transport
    private var searchRevision: UInt64 = 0
    private var stateRevision: UInt64 = 0
    private let verificationMessage = "The change could not be verified. Reopen Places before trying again."
    private let uncertainMessage = "The change may have been saved. Reopen Places to verify before trying again."

    init(transport: @escaping Transport) { self.transport = transport }

    /// The container may receive a committed native record while this sheet is
    /// open, including during another request. Showing that verified truth does
    /// not cancel or replay the request; its later receipt must still pass the
    /// same monotonic acceptance check and cannot roll this record back.
    @discardableResult
    func adoptVerifiedSource(_ incoming: NativePlacesSource) -> Bool {
        guard incoming.owner == "native" else { return false }
        let changed = incoming != source
        guard accept(incoming) else { return false }
        if changed { stateRevision &+= 1 }
        if !isBusy { errorMessage = nil }
        return true
    }

    func reload() async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        stateRevision &+= 1
        defer { isBusy = false }
        let command = NativePlacesCommand(action: "snapshot")
        do {
            try Task.checkCancellation()
            let reply = try await transport(command)
            try Task.checkCancellation()
            guard reply.isValid(for: command) else {
                errorMessage = "Could not verify Places and Settings. Your last confirmed information is still shown."
                return
            }
            guard let incoming = reply.source, accept(incoming) else {
                errorMessage = !reply.ok ? (reply.message ?? "Places and Settings could not be loaded. Try again.") :
                    "Could not verify Places and Settings. Your last confirmed information is still shown."
                return
            }
            if !reply.ok { errorMessage = reply.message ?? "Places and Settings could not be loaded. Try again." }
        } catch is CancellationError { /* A dismissed read must not overwrite later UI state. */ }
        catch { errorMessage = "Places and Settings could not be loaded. Your last confirmed information is still shown." }
    }

    func search(query: String) async {
        searchRevision &+= 1
        let revision = searchRevision
        let existingStateRevision = stateRevision
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchResults = []
        isSearching = false
        guard cleanQuery.count >= 2 else { return }
        guard NativePlacesValidation.text(cleanQuery, max: 160, nonblank: true) else {
            errorMessage = "Enter a shorter place name."
            return
        }
        isSearching = true
        if !isBusy { errorMessage = nil }
        defer { if revision == searchRevision { isSearching = false } }
        let command = NativePlacesCommand(action: "search", query: cleanQuery)
        do {
            try Task.checkCancellation()
            let reply = try await transport(command)
            try Task.checkCancellation()
            guard revision == searchRevision else { return }
            guard reply.isValid(for: command), reply.ok, let results = reply.results else {
                if existingStateRevision == stateRevision { errorMessage = reply.isValid(for: command) ? (reply.message ?? "Could not search places. Try again.") : "Could not verify the place results. Try again." }
                return
            }
            // Search never replaces the active inventory or settings snapshot.
            searchResults = results
        } catch is CancellationError { }
        catch {
            if revision == searchRevision, existingStateRevision == stateRevision { errorMessage = "Could not search places. Try again." }
        }
    }

    func select(place: NativeManagedPlace) async -> Bool {
        guard place.isValid else { return invalidInput() }
        guard place.previewPlace.isValid else {
            if !isBusy { errorMessage = "This place cannot be shown in the native preview yet. Open existing Nearcast to use it." }
            return false
        }
        return await mutate(NativePlacesCommand(action: "select", place: place)) { $0.selectedPlace?.hasSameIdentity(as: place) == true }
    }

    func save(place: NativeManagedPlace) async -> Bool {
        guard place.isValid else { return invalidInput() }
        return await mutate(NativePlacesCommand(action: "save", place: place)) { $0.savedPlaces.contains { $0.hasSameIdentity(as: place) } }
    }

    func rename(id: String, alias: String) async -> Bool {
        let cleanAlias = alias.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard source?.savedPlaces.contains(where: { $0.id == id }) == true,
              NativePlacesValidation.text(cleanAlias, max: 36) else { return invalidInput() }
        return await mutate(NativePlacesCommand(action: "rename", id: id, alias: cleanAlias)) { value in
            guard let saved = value.savedPlaces.first(where: { $0.id == id }) else { return false }
            return (saved.alias ?? "") == cleanAlias
        }
    }

    func move(id: String, direction: Int) async -> Bool {
        guard direction == -1 || direction == 1, let saved = source?.savedPlaces,
              let index = saved.firstIndex(where: { $0.id == id }), saved.indices.contains(index + direction) else { return invalidInput() }
        var expectedIDs = saved.map(\.id)
        expectedIDs.swapAt(index, index + direction)
        return await mutate(NativePlacesCommand(action: "move", id: id, direction: direction)) { $0.savedPlaces.map(\.id) == expectedIDs }
    }

    func remove(id: String) async -> Bool {
        guard source?.savedPlaces.contains(where: { $0.id == id }) == true else { return invalidInput() }
        return await mutate(NativePlacesCommand(action: "remove", id: id)) { !$0.savedPlaces.contains { $0.id == id } }
    }

    func setPreference(unit: String? = nil, clock: String? = nil, theme: String? = nil,
                       reactiveSkyEnabled: Bool? = nil, reactiveSkyMotionAllowed: Bool? = nil) async -> Bool {
        let patch = NativePlacesPreferencePatch(unit: unit, timeFormat: clock, theme: theme,
            reactiveSkyEnabled: reactiveSkyEnabled, reactiveSkyMotionAllowed: reactiveSkyMotionAllowed)
        guard patch.isValid else { return invalidInput() }
        return await mutate(NativePlacesCommand(action: "preferences", preferences: patch)) { value in
            (unit == nil || value.preferences.unit == unit) && (clock == nil || value.preferences.timeFormat == clock) &&
            (theme == nil || value.preferences.theme == theme) &&
            (reactiveSkyEnabled == nil || value.preferences.reactiveSkyEnabled == reactiveSkyEnabled) &&
            (reactiveSkyMotionAllowed == nil || value.preferences.reactiveSkyMotionAllowed == reactiveSkyMotionAllowed)
        }
    }

    func useCurrentLocation() async -> Bool {
        await mutate(NativePlacesCommand(action: "currentLocation")) { $0.selectedPlace?.followsCurrentLocation == true }
    }

    private func invalidInput() -> Bool {
        if !isBusy { errorMessage = "This change is not available. Reload Places and try again." }
        return false
    }

    private func mutate(_ request: NativePlacesCommand, verified: (NativePlacesSource) -> Bool) async -> Bool {
        guard !isBusy else { return false }
        guard let expected = source, expected.isValid else { return invalidInput() }
        isBusy = true
        errorMessage = nil
        stateRevision &+= 1
        defer { isBusy = false }
        var command = request
        command.expectedSource = expected
        do {
            try Task.checkCancellation()
            let reply = try await transport(command)
            try Task.checkCancellation()
            guard reply.isValid(for: command), let incoming = reply.source, accept(incoming) else {
                errorMessage = uncertainMessage
                return false
            }
            // A partial failure may still carry a verified, newer inventory. Show
            // that truth, but never present the original command as successful.
            guard reply.ok else {
                errorMessage = reply.message ?? uncertainMessage
                return false
            }
            guard verified(incoming) else {
                errorMessage = verificationMessage
                return false
            }
            guard incoming.toPreviewContext() != nil else {
                // The writer succeeded, but closing Places would strand the
                // user on an older forecast. Keep the receipt and the sheet,
                // explain the display limitation, and do not replay the write.
                errorMessage = "Your change is saved, but this place cannot be shown in the native preview yet. Open existing Nearcast to continue."
                return false
            }
            return true
        } catch {
            // Cancellation/timeout is not proof that the existing writer did not
            // commit. Preserve the last receipt and never retry a write here.
            errorMessage = uncertainMessage
            return false
        }
    }

    private func accept(_ incoming: NativePlacesSource) -> Bool {
        guard incoming.isValid, let incomingDate = incoming.captureDate else { return false }
        if let previous = source, let previousDate = previous.captureDate {
            guard incomingDate >= previousDate else { return false }
            // A newly loaded fallback is not a transfer back to legacy ownership.
            guard previous.owner != "native" || incoming.owner == "native" else { return false }
            if incoming.owner == "native", incomingDate == previousDate {
                var sameOwner = incoming
                sameOwner.owner = previous.owner
                guard sameOwner == previous else { return false }
            }
        }
        source = incoming
        return true
    }
}

private enum NativePlacesValidation {
    struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    static func keys(_ decoder: Decoder, required: Set<String>, optional: Set<String> = []) throws {
        let actual = Set(try decoder.container(keyedBy: Key.self).allKeys.map(\.stringValue))
        guard required.isSubset(of: actual), actual.isSubset(of: required.union(optional)) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid places receipt fields."))
        }
    }

    static func text(_ text: String, max: Int, nonblank: Bool = false) -> Bool {
        text.utf16.count <= max && !text.unicodeScalars.contains { $0.value < 32 || (127...159).contains($0.value) } &&
        (!nonblank || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    static func captureDate(_ text: String) -> Date? {
        guard text.utf8.count <= 30,
              text.range(of: #"^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$"#, options: .regularExpression) != nil else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = text.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        guard let date = formatter.date(from: text) else { return nil }
        let day = DateFormatter()
        day.calendar = Calendar(identifier: .gregorian)
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"
        return day.string(from: date) == String(text.prefix(10)) ? date : nil
    }
}

private extension KeyedDecodingContainer {
    /// Optional place fields may be absent, but explicit null is not the export schema.
    func strictOptional<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        contains(key) ? try decode(type, forKey: key) : nil
    }
}

extension NativeManagedPlace {
    init(from decoder: Decoder) throws {
        try NativePlacesValidation.keys(decoder, required: ["id", "name", "admin1", "country", "latitude", "longitude"],
            optional: ["legacyIDType", "countryCode", "alias", "timezone", "followsCurrentLocation"])
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(id: try values.decode(String.self, forKey: .id),
            legacyIDType: try values.strictOptional(String.self, forKey: .legacyIDType),
            name: try values.decode(String.self, forKey: .name), admin1: try values.decode(String.self, forKey: .admin1),
            country: try values.decode(String.self, forKey: .country), countryCode: try values.strictOptional(String.self, forKey: .countryCode),
            latitude: try values.decode(Double.self, forKey: .latitude), longitude: try values.decode(Double.self, forKey: .longitude),
            alias: try values.strictOptional(String.self, forKey: .alias), timezone: try values.strictOptional(String.self, forKey: .timezone),
            followsCurrentLocation: try values.strictOptional(Bool.self, forKey: .followsCurrentLocation))
    }
}

extension NativePlacesPreferences {
    init(from decoder: Decoder) throws {
        try NativePlacesValidation.keys(decoder, required: Set(CodingKeys.allCases.map(\.rawValue)))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(unit: try values.decode(String.self, forKey: .unit), timeFormat: try values.decode(String.self, forKey: .timeFormat),
            theme: try values.decode(String.self, forKey: .theme), reactiveSkyEnabled: try values.decode(Bool.self, forKey: .reactiveSkyEnabled),
            reactiveSkyMotionAllowed: try values.decode(Bool.self, forKey: .reactiveSkyMotionAllowed))
    }
}

extension NativePlacesSource {
    init(from decoder: Decoder) throws {
        try NativePlacesValidation.keys(decoder, required: Set(CodingKeys.allCases.map(\.rawValue)))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(version: try values.decode(Int.self, forKey: .version), owner: try values.decode(String.self, forKey: .owner),
            hydration: try values.decode(String.self, forKey: .hydration), capturedAt: try values.decode(String.self, forKey: .capturedAt),
            selectedPlace: try values.decodeIfPresent(NativeManagedPlace.self, forKey: .selectedPlace),
            lastPlace: try values.decodeIfPresent(NativeManagedPlace.self, forKey: .lastPlace),
            savedPlaces: try values.decode([NativeManagedPlace].self, forKey: .savedPlaces), preferences: try values.decode(NativePlacesPreferences.self, forKey: .preferences))
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid places receipt."))
        }
    }
}

extension NativePlacesPreferencePatch {
    init(from decoder: Decoder) throws {
        try NativePlacesValidation.keys(decoder, required: [], optional: Set(CodingKeys.allCases.map(\.rawValue)))
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(unit: try values.strictOptional(String.self, forKey: .unit),
            timeFormat: try values.strictOptional(String.self, forKey: .timeFormat),
            theme: try values.strictOptional(String.self, forKey: .theme),
            reactiveSkyEnabled: try values.strictOptional(Bool.self, forKey: .reactiveSkyEnabled),
            reactiveSkyMotionAllowed: try values.strictOptional(Bool.self, forKey: .reactiveSkyMotionAllowed))
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid preference patch."))
        }
    }
}

extension NativePlacesReply {
    init(from decoder: Decoder) throws {
        try NativePlacesValidation.keys(decoder, required: ["version", "requestID", "ok"], optional: ["source", "results", "message", "code"])
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(version: try values.decode(Int.self, forKey: .version), requestID: try values.decode(String.self, forKey: .requestID),
            ok: try values.decode(Bool.self, forKey: .ok), source: try values.decodeIfPresent(NativePlacesSource.self, forKey: .source),
            results: try values.decodeIfPresent([NativeManagedPlace].self, forKey: .results),
            message: try values.decodeIfPresent(String.self, forKey: .message), code: try values.decodeIfPresent(String.self, forKey: .code))
    }
}
