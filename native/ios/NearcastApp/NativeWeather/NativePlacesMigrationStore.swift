import Foundation
import CoreFoundation
import CryptoKit
import Darwin

/// An aggregate-only receipt. Never include place values, identifiers, or digests here.
struct NativePlacesMigrationReport: Codable, Equatable, Sendable {
    let owner: String
    let revision: Int
    let savedPlaceCount: Int
    let selectedPlaceCount: Int
    let lastPlaceCount: Int
    let tombstoneCount: Int
    let unchanged: Bool
    let recoveredFromBackup: Bool
}

enum NativePlacesMigrationError: Error, LocalizedError, Equatable {
    case invalidExport, unsupportedExport, staleExport, invalidStore, unsupportedStoreVersion, storageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidExport: return "The legacy places export is incomplete or invalid. Legacy still owns your places."
        case .unsupportedExport: return "This legacy places export is not supported. Legacy still owns your places."
        case .staleExport: return "An older places export was ignored. Legacy still owns your places."
        case .invalidStore: return "The rehearsal copy could not be verified. Legacy still owns your places."
        case .unsupportedStoreVersion: return "This rehearsal copy requires a newer reader. No stored data was changed."
        case .storageUnavailable: return "The local rehearsal copy could not be saved. Legacy still owns your places."
        }
    }
}

/// Local rehearsal only: no activation, mutation, or native-preview read API exists.
/// The actor serializes callers; an advisory lock also serializes separate instances.
actor NativePlacesMigrationStore {
    nonisolated static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Nearcast/NativePlacesRehearsal", isDirectory: true)
            .resolvingSymlinksInPath()
    }

    enum WriteStage: Sendable { case afterBackupWrite, afterPrimaryStaged, beforePrimaryReplace }
    typealias FailureInjector = @Sendable (WriteStage) throws -> Void

    private let directory: URL
    private let failureInjector: FailureInjector?
    private static let primaryName = "places-rehearsal.v1.json"
    private static let backupName = "places-rehearsal.previous.json"
    private static let maximumExportBytes = 128 * 1_024
    private static let maximumEnvelopeBytes = 4 * 1_024 * 1_024

    init(directory: URL) {
        self.directory = directory
        self.failureInjector = nil
    }

    /// Internal deterministic failure seam, used by standalone persistence tests.
    init(directory: URL, failureInjector: @escaping FailureInjector) {
        self.directory = directory
        self.failureInjector = failureInjector
    }

    func rehearse(_ data: Data) throws -> NativePlacesMigrationReport {
        try Task.checkCancellation()
        let source = try Self.decodeExport(data)
        return try withStoreLock {
            try Task.checkCancellation()
            let previous = try load()
            if let previous, source.date < previous.envelope.source.date {
                throw NativePlacesMigrationError.staleExport
            }
            let digest = try Self.sourceDigest(source)
            let unchanged = previous?.envelope.sourceDigest == digest
            if let previous, unchanged, previous.envelope.source.capturedAt == source.capturedAt,
               !previous.recovered {
                return report(previous.envelope, unchanged: true, recovered: false)
            }
            let oldRevision = previous?.envelope.revision ?? 0
            guard oldRevision < Int.max else { throw NativePlacesMigrationError.invalidStore }
            let revision = unchanged ? oldRevision : oldRevision + 1
            let activeIDs = Set(source.savedPlaces.map(\.id))
            var tombstones = previous?.envelope.tombstones ?? []
            // Re-adding an ID supersedes that ID's old deletion marker, without coordinate matching.
            tombstones.removeAll { activeIDs.contains($0.id) }
            for place in previous?.envelope.source.savedPlaces ?? [] where !activeIDs.contains(place.id) {
                tombstones.removeAll { $0.id == place.id }
                tombstones.append(Tombstone(id: place.id, revision: revision))
            }
            tombstones.sort { $0.id < $1.id }
            var envelope = Envelope(schemaVersion: 1, minReaderVersion: 1, minWriterVersion: 1,
                owner: "legacy", revision: revision, sourceDigest: digest, source: source,
                tombstones: tombstones, receiptDigest: "")
            envelope.receiptDigest = try Self.receiptDigest(envelope)
            let bytes = try Self.encode(envelope)
            guard bytes.count <= Self.maximumEnvelopeBytes else { throw NativePlacesMigrationError.storageUnavailable }
            guard try Self.decodeEnvelope(bytes) == envelope else { throw NativePlacesMigrationError.invalidStore }
            // A backup is always a validated, complete previous generation, never corrupt primary bytes.
            if let previous {
                try atomicWrite(previous.bytes, name: Self.backupName, primary: false)
                try failureInjector?(.afterBackupWrite)
            }
            try atomicWrite(bytes, name: Self.primaryName, primary: true)
            guard let committed = try readFile(Self.primaryName),
                  try Self.decodeEnvelope(committed) == envelope else {
                throw NativePlacesMigrationError.invalidStore
            }
            return report(envelope, unchanged: unchanged, recovered: previous?.recovered ?? false)
        }
    }

    /// A historical receipt, not a claim that the legacy inventory is currently fresh.
    func status() throws -> NativePlacesMigrationReport? {
        try withStoreLock {
            guard let stored = try load() else { return nil }
            return report(stored.envelope, unchanged: true, recovered: stored.recovered)
        }
    }

    private func report(_ value: Envelope, unchanged: Bool, recovered: Bool) -> NativePlacesMigrationReport {
        NativePlacesMigrationReport(owner: "legacy", revision: value.revision,
            savedPlaceCount: value.source.savedPlaces.count,
            selectedPlaceCount: value.source.selectedPlace == nil ? 0 : 1,
            lastPlaceCount: value.source.lastPlace == nil ? 0 : 1,
            tombstoneCount: value.tombstones.count, unchanged: unchanged, recoveredFromBackup: recovered)
    }

    private struct Stored {
        let envelope: Envelope
        let bytes: Data
        let recovered: Bool
    }

    private func load() throws -> Stored? {
        var foundInvalidPrimary = false
        do {
            if let bytes = try readFile(Self.primaryName) {
                do {
                    let envelope = try Self.decodeEnvelope(bytes)
                    // A future backup also indicates ownership/version state we cannot safely replace.
                    do {
                        if let backup = try readFile(Self.backupName) { _ = try Self.decodeEnvelope(backup) }
                    } catch NativePlacesMigrationError.unsupportedStoreVersion {
                        throw NativePlacesMigrationError.unsupportedStoreVersion
                    } catch { /* A valid primary may replace a damaged older backup. */ }
                    return Stored(envelope: envelope, bytes: bytes, recovered: false)
                } catch NativePlacesMigrationError.unsupportedStoreVersion {
                    // Never downgrade a future schema or an owner this rehearsal does not control.
                    throw NativePlacesMigrationError.unsupportedStoreVersion
                } catch { foundInvalidPrimary = true }
            }
        } catch NativePlacesMigrationError.unsupportedStoreVersion {
            throw NativePlacesMigrationError.unsupportedStoreVersion
        } catch { foundInvalidPrimary = true }
        if let bytes = try readFile(Self.backupName) {
            let envelope = try Self.decodeEnvelope(bytes)
            return Stored(envelope: envelope, bytes: bytes, recovered: true)
        }
        if foundInvalidPrimary { throw NativePlacesMigrationError.invalidStore }
        return nil
    }

    private func withStoreLock<T>(_ body: () throws -> T) throws -> T {
        do { try prepareDirectory() } catch { throw NativePlacesMigrationError.storageUnavailable }
        let lockURL = directory.appendingPathComponent(".rehearsal.lock")
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlacesMigrationError.storageUnavailable }
        defer { close(descriptor) }
        guard fchmod(descriptor, mode_t(0o600)) == 0, flock(descriptor, LOCK_EX) == 0 else {
            throw NativePlacesMigrationError.storageUnavailable
        }
        defer { flock(descriptor, LOCK_UN) }
        do {
            try protect(lockURL, directory: false)
            return try body()
        } catch let error as CancellationError { throw error }
        catch let error as NativePlacesMigrationError { throw error }
        catch { throw NativePlacesMigrationError.storageUnavailable }
    }

    private func prepareDirectory() throws {
        guard directory.isFileURL else { throw NativePlacesMigrationError.storageUnavailable }
        // Reject caller-controlled symlink components. Apple system aliases are root-owned;
        // Foundation intentionally retains /var in sandbox and temporary-directory URLs.
        let standardized = directory.standardizedFileURL
        var cursor = standardized
        while cursor.path != "/" {
            if FileManager.default.fileExists(atPath: cursor.path) {
                let attributes = try FileManager.default.attributesOfItem(atPath: cursor.path)
                let systemAlias = ["/var": "private/var", "/tmp": "private/tmp"][cursor.path]
                let isSystemAlias = systemAlias != nil &&
                    (try? FileManager.default.destinationOfSymbolicLink(atPath: cursor.path)) == systemAlias &&
                    (attributes[.ownerAccountID] as? NSNumber)?.intValue == 0
                guard attributes[.type] as? FileAttributeType == .typeDirectory || isSystemAlias else {
                    throw NativePlacesMigrationError.storageUnavailable
                }
            }
            cursor.deleteLastPathComponent()
        }
        try FileManager.default.createDirectory(at: standardized, withIntermediateDirectories: true,
            attributes: directoryAttributes)
        try protect(standardized, directory: true)
    }

    private var directoryAttributes: [FileAttributeKey: Any] {
        var values: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
        #if os(iOS)
        values[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        return values
    }

    private func protect(_ url: URL, directory isDirectory: Bool) throws {
        var values: [FileAttributeKey: Any] = [.posixPermissions: isDirectory ? 0o700 : 0o600]
        #if os(iOS)
        values[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.setAttributes(values, ofItemAtPath: url.path)
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        var localURL = url
        try localURL.setResourceValues(resourceValues)
    }

    private func readFile(_ name: String) throws -> Data? {
        let url = directory.appendingPathComponent(name)
        let attributes: [FileAttributeKey: Any]
        do { attributes = try FileManager.default.attributesOfItem(atPath: url.path) }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile { return nil }
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let count = attributes[.size] as? NSNumber,
              count.intValue <= Self.maximumEnvelopeBytes else { throw NativePlacesMigrationError.invalidStore }
        try protect(url, directory: false)
        let data = try Data(contentsOf: url, options: .uncached)
        guard data.count <= Self.maximumEnvelopeBytes else { throw NativePlacesMigrationError.invalidStore }
        return data
    }

    private func atomicWrite(_ data: Data, name: String, primary: Bool) throws {
        let temporary = directory.appendingPathComponent(".pending-\(UUID().uuidString)")
        let destination = directory.appendingPathComponent(name)
        let descriptor = open(temporary.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlacesMigrationError.storageUnavailable }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: temporary)
        }
        try protect(temporary, directory: false)
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
        let readback = try Data(contentsOf: temporary, options: .uncached)
        guard readback == data else { throw NativePlacesMigrationError.invalidStore }
        _ = try Self.decodeEnvelope(readback)
        if primary {
            try failureInjector?(.afterPrimaryStaged)
            try failureInjector?(.beforePrimaryReplace)
        }
        try Task.checkCancellation()
        // POSIX rename replaces one file atomically within this protected local directory.
        guard rename(temporary.path, destination.path) == 0 else { throw NativePlacesMigrationError.storageUnavailable }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw NativePlacesMigrationError.storageUnavailable }
        defer { close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw NativePlacesMigrationError.storageUnavailable }
    }

    private struct Place: Codable, Equatable, Sendable {
        let id: String
        let legacyIDType: String?
        let name: String
        let admin1: String
        let country: String
        let countryCode: String?
        let latitude: Double
        let longitude: Double
        let alias: String?
        let timezone: String?
        let followsCurrentLocation: Bool?
    }

    private struct Preferences: Codable, Equatable, Sendable {
        let unit: String
        let timeFormat: String
        let theme: String
        let reactiveSkyEnabled: Bool
        let reactiveSkyMotionAllowed: Bool
    }

    private struct Source: Codable, Equatable, Sendable {
        let version: Int
        let owner: String
        let hydration: String
        let capturedAt: String
        let selectedPlace: Place?
        let lastPlace: Place?
        let savedPlaces: [Place]
        let preferences: Preferences

        var date: Date { NativePlacesMigrationStore.captureDate(capturedAt)! }

        // Preserve required explicit nulls in the frozen export schema.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(version, forKey: .version)
            try container.encode(owner, forKey: .owner)
            try container.encode(hydration, forKey: .hydration)
            try container.encode(capturedAt, forKey: .capturedAt)
            try container.encode(selectedPlace, forKey: .selectedPlace)
            try container.encode(lastPlace, forKey: .lastPlace)
            try container.encode(savedPlaces, forKey: .savedPlaces)
            try container.encode(preferences, forKey: .preferences)
        }
    }

    private struct Tombstone: Codable, Equatable, Sendable {
        let id: String
        let revision: Int
    }

    private struct Envelope: Codable, Equatable, Sendable {
        let schemaVersion: Int
        let minReaderVersion: Int
        let minWriterVersion: Int
        let owner: String
        let revision: Int
        let sourceDigest: String
        let source: Source
        let tombstones: [Tombstone]
        var receiptDigest: String
    }

    private static func decodeExport(_ data: Data) throws -> Source {
        guard data.count <= maximumExportBytes else { throw NativePlacesMigrationError.invalidExport }
        do {
            let object = try object(data)
            try validateSource(object)
            // Decode the exact object just validated, independent of parser duplicate-key policies.
            return try JSONDecoder().decode(Source.self, from: JSONSerialization.data(withJSONObject: object))
        } catch let error as NativePlacesMigrationError { throw error }
        catch { throw NativePlacesMigrationError.invalidExport }
    }

    private static func validateSource(_ source: [String: Any]) throws {
        try keys(source, required: ["version", "owner", "hydration", "capturedAt", "selectedPlace", "lastPlace", "savedPlaces", "preferences"])
        guard integer(source["version"]) == 1, source["owner"] as? String == "legacy",
              source["hydration"] as? String == "ready" else { throw NativePlacesMigrationError.unsupportedExport }
        guard let capture = source["capturedAt"] as? String, captureDate(capture) != nil,
              let saved = source["savedPlaces"] as? [Any], saved.count <= 60,
              let preferences = source["preferences"] as? [String: Any] else { throw NativePlacesMigrationError.invalidExport }
        for key in ["selectedPlace", "lastPlace"] {
            if source[key] is NSNull { continue }
            guard let place = source[key] as? [String: Any] else { throw NativePlacesMigrationError.invalidExport }
            try validatePlace(place)
        }
        var ids = Set<String>()
        for value in saved {
            guard let place = value as? [String: Any] else { throw NativePlacesMigrationError.invalidExport }
            try validatePlace(place)
            guard ids.insert(place["id"] as! String).inserted else { throw NativePlacesMigrationError.invalidExport }
        }
        try keys(preferences, required: ["unit", "timeFormat", "theme", "reactiveSkyEnabled", "reactiveSkyMotionAllowed"])
        guard let unit = preferences["unit"] as? String, ["fahrenheit", "celsius"].contains(unit),
              let clock = preferences["timeFormat"] as? String, ["auto", "12", "24"].contains(clock),
              let theme = preferences["theme"] as? String, ["auto", "light", "dark"].contains(theme),
              isBoolean(preferences["reactiveSkyEnabled"]), isBoolean(preferences["reactiveSkyMotionAllowed"]) else {
            throw NativePlacesMigrationError.invalidExport
        }
    }

    private static func validatePlace(_ place: [String: Any]) throws {
        try keys(place, required: ["id", "name", "admin1", "country", "latitude", "longitude"],
            optional: ["countryCode", "alias", "timezone", "followsCurrentLocation", "legacyIDType"])
        guard validString(place["id"], max: 160, nonblank: true), validString(place["name"], max: 180, nonblank: true),
              validString(place["admin1"], max: 180), validString(place["country"], max: 180),
              let latitude = number(place["latitude"]), abs(latitude) <= 90,
              let longitude = number(place["longitude"]), abs(longitude) <= 180 else {
            throw NativePlacesMigrationError.invalidExport
        }
        if let alias = place["alias"], !validString(alias, max: 36) { throw NativePlacesMigrationError.invalidExport }
        if let raw = place["legacyIDType"] {
            guard raw as? String == "number", let id = place["id"] as? String,
                  let number = UInt64(id), number > 0, number <= 9_007_199_254_740_991,
                  String(number) == id else { throw NativePlacesMigrationError.invalidExport }
        }
        if let raw = place["countryCode"] {
            guard let code = raw as? String, code.utf8.count == 2,
                  code.unicodeScalars.allSatisfy({ (65...90).contains($0.value) }) else { throw NativePlacesMigrationError.invalidExport }
        }
        if let raw = place["timezone"] {
            guard let zone = raw as? String, zone.utf16.count <= 100, TimeZone(identifier: zone) != nil else {
                throw NativePlacesMigrationError.invalidExport
            }
        }
        if let raw = place["followsCurrentLocation"], !isBoolean(raw) { throw NativePlacesMigrationError.invalidExport }
    }

    private static func decodeEnvelope(_ data: Data) throws -> Envelope {
        do {
            guard data.count <= maximumEnvelopeBytes else { throw NativePlacesMigrationError.invalidStore }
            let value = try object(data)
            // Inspect upgrade/owner barriers before ordinary validation or backup recovery.
            if ["schemaVersion", "minReaderVersion", "minWriterVersion"].contains(where: { (number(value[$0]) ?? 0) > 1 }) ||
                (value["owner"] as? String).map({ $0 != "legacy" }) == true {
                throw NativePlacesMigrationError.unsupportedStoreVersion
            }
            try keys(value, required: ["schemaVersion", "minReaderVersion", "minWriterVersion", "owner", "revision", "sourceDigest", "source", "tombstones", "receiptDigest"])
            guard integer(value["schemaVersion"]) == 1, integer(value["minReaderVersion"]) == 1,
                  integer(value["minWriterVersion"]) == 1, value["owner"] as? String == "legacy",
                  let revision = integer(value["revision"]), revision > 0,
                  let source = value["source"] as? [String: Any], let deleted = value["tombstones"] as? [Any] else {
                throw NativePlacesMigrationError.invalidStore
            }
            try validateSource(source)
            let active = Set((source["savedPlaces"] as! [[String: Any]]).map { $0["id"] as! String })
            var seen = Set<String>()
            for raw in deleted {
                guard let marker = raw as? [String: Any] else { throw NativePlacesMigrationError.invalidStore }
                try keys(marker, required: ["id", "revision"])
                guard validString(marker["id"], max: 160, nonblank: true), let id = marker["id"] as? String,
                      let deletedRevision = integer(marker["revision"]), deletedRevision > 0, deletedRevision <= revision,
                      !active.contains(id), seen.insert(id).inserted else { throw NativePlacesMigrationError.invalidStore }
            }
            let envelope = try JSONDecoder().decode(Envelope.self, from: JSONSerialization.data(withJSONObject: value))
            guard try sourceDigest(envelope.source) == envelope.sourceDigest,
                  try receiptDigest(envelope) == envelope.receiptDigest else { throw NativePlacesMigrationError.invalidStore }
            return envelope
        } catch NativePlacesMigrationError.unsupportedStoreVersion { throw NativePlacesMigrationError.unsupportedStoreVersion }
        catch { throw NativePlacesMigrationError.invalidStore }
    }

    private static func sourceDigest(_ source: Source) throws -> String {
        var value = try object(encode(source))
        value.removeValue(forKey: "capturedAt")
        return try digest(value)
    }

    private static func receiptDigest(_ envelope: Envelope) throws -> String {
        var value = try object(encode(envelope))
        value.removeValue(forKey: "receiptDigest")
        return try digest(value)
    }

    private static func digest(_ value: [String: Any]) throws -> String {
        let canonical = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        return SHA256.hash(data: canonical).map { String(format: "%02x", $0) }.joined()
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private static func object(_ data: Data) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NativePlacesMigrationError.invalidExport
        }
        return value
    }

    private static func keys(_ value: [String: Any], required: Set<String>, optional: Set<String> = []) throws {
        let actual = Set(value.keys)
        guard required.isSubset(of: actual), actual.isSubset(of: required.union(optional)) else {
            throw NativePlacesMigrationError.invalidExport
        }
    }

    private static func validString(_ value: Any?, max: Int, nonblank: Bool = false) -> Bool {
        guard let text = value as? String, text.utf16.count <= max,
              !text.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) }) else { return false }
        return !nonblank || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func isBoolean(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    private static func number(_ value: Any?) -> Double? {
        guard !isBoolean(value), let value = value as? NSNumber, value.doubleValue.isFinite else { return nil }
        return value.doubleValue
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let value = number(value), value.rounded(.towardZero) == value,
              value > Double(Int.min), value < Double(Int.max) else { return nil }
        return Int(value)
    }

    private static func captureDate(_ text: String) -> Date? {
        guard text.utf8.count <= 30,
              text.range(of: #"^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$"#, options: .regularExpression) != nil else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = text.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        guard let date = formatter.date(from: text) else { return nil }
        // ISO8601DateFormatter normalizes impossible dates on some OS releases; reject them.
        let day = String(text.prefix(10))
        let dayFormatter = DateFormatter()
        dayFormatter.calendar = Calendar(identifier: .gregorian)
        dayFormatter.locale = Locale(identifier: "en_US_POSIX")
        dayFormatter.timeZone = TimeZone(secondsFromGMT: 0)
        dayFormatter.dateFormat = "yyyy-MM-dd"
        return dayFormatter.string(from: date) == day ? date : nil
    }
}
