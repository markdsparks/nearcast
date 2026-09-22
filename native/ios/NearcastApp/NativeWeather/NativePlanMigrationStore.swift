import Foundation
import CoreFoundation
import CryptoKit
import Darwin

/// Aggregate-only evidence that a complete legacy Plans inventory was staged.
/// It deliberately contains neither plan text, place values, identifiers, nor
/// any APNs/channel information so diagnostics cannot become another copy of
/// family data.
struct NativePlanMigrationReport: Codable, Equatable, Sendable {
    let owner: String
    let revision: Int
    let planCount: Int
    let selectedPlanCount: Int
    let selectedPlaceCount: Int
    let tombstoneCount: Int
    let unchanged: Bool
    let recoveredFromBackup: Bool
}

enum NativePlanMigrationError: Error, LocalizedError, Equatable {
    case invalidExport
    case unsupportedExport
    case staleExport
    case invalidStore
    case unsupportedStoreVersion
    case storageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidExport:
            return "The Plans handover copy is incomplete or invalid. Existing Plans still owns your records."
        case .unsupportedExport:
            return "This Plans handover copy needs a newer Nearcast reader. Existing Plans still owns your records."
        case .staleExport:
            return "An older Plans handover copy was ignored. Existing Plans still owns your records."
        case .invalidStore:
            return "The staged Plans copy could not be verified. Existing Plans still owns your records."
        case .unsupportedStoreVersion:
            return "This staged Plans copy requires a newer reader. No stored data was changed."
        case .storageUnavailable:
            return "The local Plans handover copy could not be saved. Existing Plans still owns your records."
        }
    }
}

/// A strict rehearsal of the later Plans handover.
///
/// This actor is intentionally not a plan database or a notification owner.
/// Its only public mutation is staging an allowlisted legacy export locally.
/// It never registers, renews, unregisters, requests permission for, or
/// publishes any notification, widget, Watch, or Live Activity state. That
/// makes it safe to run while existing Plans remains the sole writer.
actor NativePlanMigrationStore {
    nonisolated static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Nearcast/NativePlansRehearsal", isDirectory: true)
            .resolvingSymlinksInPath()
    }

    enum WriteStage: Sendable {
        case afterBackupWrite
        case afterPrimaryStaged
        case beforePrimaryReplace
    }
    typealias FailureInjector = @Sendable (WriteStage) throws -> Void

    private static let primaryName = "plans-rehearsal.v1.json"
    private static let backupName = "plans-rehearsal.previous.json"
    private static let maximumExportBytes = 160 * 1_024
    private static let maximumEnvelopeBytes = 4 * 1_024 * 1_024
    private static let maximumPlans = 60
    private static let maximumSelectedPlans = 3
    private static let maximumSelectedPlaces = 3

    private let directory: URL
    private let failureInjector: FailureInjector?

    init(directory: URL) {
        self.directory = directory
        self.failureInjector = nil
    }

    /// Deterministic failure seam for the standalone persistence suite.
    init(directory: URL, failureInjector: @escaping FailureInjector) {
        self.directory = directory
        self.failureInjector = failureInjector
    }

    /// Stages an explicitly complete, legacy-owned snapshot. A later native
    /// ownership cutover must be a separate, user-approved operation.
    func rehearse(_ data: Data) throws -> NativePlanMigrationReport {
        try Task.checkCancellation()
        let source = try Self.decodeExport(data)
        return try withStoreLock {
            try Task.checkCancellation()
            let previous = try load()
            if let previous, source.captureDate < previous.envelope.source.captureDate {
                throw NativePlanMigrationError.staleExport
            }

            let sourceDigest = try Self.semanticDigest(source)
            let unchanged = previous?.envelope.sourceDigest == sourceDigest
            if let previous, unchanged,
               previous.envelope.source.capturedAt == source.capturedAt,
               !previous.recovered {
                return report(previous.envelope, unchanged: true, recovered: false)
            }

            let previousRevision = previous?.envelope.revision ?? 0
            guard previousRevision < Int.max else { throw NativePlanMigrationError.invalidStore }
            let revision = unchanged ? previousRevision : previousRevision + 1
            var tombstones = previous?.envelope.tombstones ?? []
            if !unchanged {
                let activeIDs = Set(source.plans.map(\.id))
                tombstones.removeAll { activeIDs.contains($0.id) }
                for plan in previous?.envelope.source.plans ?? [] where !activeIDs.contains(plan.id) {
                    tombstones.removeAll { $0.id == plan.id }
                    tombstones.append(Tombstone(id: plan.id, revision: revision))
                }
                tombstones.sort { $0.id < $1.id }
            }

            var envelope = Envelope(
                schemaVersion: 1,
                minReaderVersion: 1,
                minWriterVersion: 1,
                owner: "legacy",
                revision: revision,
                sourceDigest: sourceDigest,
                source: source,
                tombstones: tombstones,
                receiptDigest: ""
            )
            envelope.receiptDigest = try Self.receiptDigest(envelope)
            let bytes = try Self.encode(envelope)
            guard bytes.count <= Self.maximumEnvelopeBytes,
                  try Self.decodeEnvelope(bytes) == envelope else {
                throw NativePlanMigrationError.invalidStore
            }

            if let previous {
                try atomicWrite(previous.bytes, name: Self.backupName, primary: false)
                try failureInjector?(.afterBackupWrite)
            }
            try atomicWrite(bytes, name: Self.primaryName, primary: true)
            guard let committed = try readFile(Self.primaryName),
                  try Self.decodeEnvelope(committed) == envelope else {
                throw NativePlanMigrationError.invalidStore
            }
            return report(envelope, unchanged: unchanged, recovered: previous?.recovered ?? false)
        }
    }

    /// This is intentionally a historical receipt only. It is not a live
    /// inventory and callers must never infer a notification target set from
    /// this method.
    func status() throws -> NativePlanMigrationReport? {
        try withStoreLock {
            guard let stored = try load() else { return nil }
            return report(stored.envelope, unchanged: true, recovered: stored.recovered)
        }
    }

    /// Returns a newly encoded version of the *already verified* legacy
    /// handover source. It never reads WebKit, localStorage, preference keys,
    /// APNs state, or a notification registration. The caller must still
    /// independently validate the returned bytes before using them.
    ///
    /// This is intentionally narrower than a live Plans API: it exists so a
    /// later local-only staging pass can run after native schedule copies or
    /// native Places become available, even though the compatibility page has
    /// already been dismissed.
    func verifiedLegacyHandoverExport() throws -> Data? {
        try withStoreLock {
            guard let stored = try load() else { return nil }
            return try Self.reencodeVerifiedLegacyExport(stored.envelope.source)
        }
    }

    private func report(_ value: Envelope, unchanged: Bool, recovered: Bool) -> NativePlanMigrationReport {
        NativePlanMigrationReport(
            owner: "legacy",
            revision: value.revision,
            planCount: value.source.plans.count,
            selectedPlanCount: value.source.notificationIntent.selectedPlanIDs.count,
            selectedPlaceCount: value.source.notificationIntent.selectedPlaceIDs.count,
            tombstoneCount: value.tombstones.count,
            unchanged: unchanged,
            recoveredFromBackup: recovered
        )
    }

    // MARK: - Frozen source contract

    private enum GlobalPreference: String, Codable, Equatable, Sendable {
        case enabled
        case off
        case disabled
    }

    private enum PlaceSelectionMode: String, Codable, Equatable, Sendable {
        case explicit
        case `default`
    }

    private struct NotificationIntent: Codable, Equatable, Sendable {
        let hydration: String
        let globalPreference: GlobalPreference
        let selectedPlanIDs: [String]
        let placeNotificationsEnabled: Bool
        let selectedPlaceIDs: [String]
        let placeSelectionMode: PlaceSelectionMode
    }

    private struct Source: Codable, Equatable, Sendable {
        let version: Int
        let owner: String
        let hydration: String
        let capturedAt: String
        let plans: [NativeAgendaPlan]
        let notificationIntent: NotificationIntent

        var captureDate: Date { Self.captureDate(capturedAt)! }

        static func captureDate(_ text: String) -> Date? {
            guard text.utf8.count <= 40,
                  !text.isEmpty,
                  !text.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) }) else {
                return nil
            }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = formatter.date(from: text) else { return nil }
            // Requiring a canonical UTC millisecond capture eliminates an
            // ambiguous ordering source for stale-export protection.
            let output = DateFormatter()
            output.locale = Locale(identifier: "en_US_POSIX")
            output.calendar = Calendar(identifier: .gregorian)
            output.timeZone = TimeZone(secondsFromGMT: 0)
            output.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
            return output.string(from: date) == text ? date : nil
        }
    }

    private struct SemanticSource: Codable, Equatable, Sendable {
        let plans: [NativeAgendaPlan]
        let notificationIntent: NotificationIntent
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

    private struct Stored {
        let envelope: Envelope
        let bytes: Data
        let recovered: Bool
    }

    private static func decodeExport(_ data: Data) throws -> Source {
        guard !data.isEmpty, data.count <= maximumExportBytes else {
            throw NativePlanMigrationError.invalidExport
        }
        do {
            let object = try object(data)
            try validateExportShape(object)
            let agendaObject: [String: Any] = [
                "version": object["version"] as Any,
                "owner": object["owner"] as Any,
                "hydration": object["hydration"] as Any,
                "capturedAt": object["capturedAt"] as Any,
                "plans": object["plans"] as Any
            ]
            let agenda = try NativeAgendaRepository().decode(
                JSONSerialization.data(withJSONObject: agendaObject, options: [.sortedKeys, .withoutEscapingSlashes])
            )
            guard let capturedAt = object["capturedAt"] as? String,
                  let intentObject = object["notificationIntent"] as? [String: Any] else {
                throw NativePlanMigrationError.invalidExport
            }
            let intent = try notificationIntent(from: intentObject, planIDs: Set(agenda.plans.map(\.id)))
            let source = Source(version: 1, owner: "legacy", hydration: "ready", capturedAt: capturedAt,
                                plans: agenda.plans, notificationIntent: intent)
            guard validSource(source) else { throw NativePlanMigrationError.invalidExport }
            return source
        } catch let error as NativePlanMigrationError {
            throw error
        } catch let error as NativeAgendaRepositoryError {
            switch error {
            case .unsupportedExport, .unsupportedPlanSchema:
                throw NativePlanMigrationError.unsupportedExport
            default:
                throw NativePlanMigrationError.invalidExport
            }
        } catch {
            throw NativePlanMigrationError.invalidExport
        }
    }

    private static func validateExportShape(_ value: [String: Any]) throws {
        try exactKeys(value, ["version", "owner", "hydration", "capturedAt", "plans", "notificationIntent"])
        guard integer(value["version"]) == 1,
              value["owner"] as? String == "legacy",
              value["hydration"] as? String == "ready",
              value["capturedAt"] is String,
              let plans = value["plans"] as? [Any], plans.count <= maximumPlans,
              value["notificationIntent"] is [String: Any] else {
            throw NativePlanMigrationError.unsupportedExport
        }
    }

    /// Rebuild the frozen source in the original allowlisted wire shape,
    /// rather than returning its storage envelope or accepting a caller-owned
    /// payload. Round-tripping through the same strict reader catches any
    /// schema drift before it can feed a later staging protocol.
    private static func reencodeVerifiedLegacyExport(_ source: Source) throws -> Data {
        let object: [String: Any] = [
            "version": 1,
            "owner": "legacy",
            "hydration": "ready",
            "capturedAt": source.capturedAt,
            "plans": try source.plans.map(legacyWirePlan),
            "notificationIntent": [
                "hydration": "ready",
                "globalPreference": source.notificationIntent.globalPreference.rawValue,
                "selectedPlanIDs": source.notificationIntent.selectedPlanIDs,
                "placeNotificationsEnabled": source.notificationIntent.placeNotificationsEnabled,
                "selectedPlaceIDs": source.notificationIntent.selectedPlaceIDs,
                "placeSelectionMode": source.notificationIntent.placeSelectionMode.rawValue
            ]
        ]
        guard JSONSerialization.isValidJSONObject(object) else {
            throw NativePlanMigrationError.invalidStore
        }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= maximumExportBytes, try decodeExport(data) == source else {
            throw NativePlanMigrationError.invalidStore
        }
        return data
    }

    private static func legacyWirePlan(_ plan: NativeAgendaPlan) throws -> [String: Any] {
        let span: Any
        if let value = plan.span {
            span = [
                "startDate": value.startDate,
                "startHour": value.startHour,
                "endDate": value.endDate,
                "endHour": value.endHour
            ]
        } else {
            span = NSNull()
        }
        let routine: Any
        if let value = plan.routine {
            guard let firstWeekday = value.weekdays.first else {
                throw NativePlanMigrationError.invalidStore
            }
            routine = [
                "frequency": "weekly",
                "weekdays": value.weekdays,
                "weekday": firstWeekday,
                "focus": value.focus.map(\.rawValue)
            ]
        } else {
            routine = NSNull()
        }
        return [
            "id": plan.id,
            "kind": "plan",
            "title": plan.title,
            "label": plan.label,
            "original": plan.original,
            "answer": plan.answer,
            "place": try legacyWirePlace(plan.place),
            "targetDate": plan.targetDate,
            "startHour": plan.startHour,
            "endHour": plan.endHour,
            "windows": plan.windows.map {
                [
                    "id": $0.id,
                    "targetDate": $0.targetDate,
                    "startHour": $0.startHour,
                    "endHour": $0.endHour,
                    "label": $0.label
                ]
            },
            "scheduleType": plan.scheduleType.rawValue,
            "span": span,
            "routine": routine,
            "schemaVersion": NativeAgendaRepository.planSchemaVersion,
            "scheduleId": plan.scheduleID,
            "createdAt": NSNumber(value: plan.createdAtMilliseconds),
            "updatedAt": NSNumber(value: plan.updatedAtMilliseconds)
        ]
    }

    private static func legacyWirePlace(_ place: NativeAgendaPlace) throws -> [String: Any] {
        let identifier: Any
        if place.legacyIDType == .number {
            guard let value = Int64(place.id), value > 0,
                  value <= 9_007_199_254_740_991 else {
                throw NativePlanMigrationError.invalidStore
            }
            identifier = NSNumber(value: value)
        } else {
            identifier = place.id
        }
        var result: [String: Any] = [
            "id": identifier,
            "name": place.name,
            "admin1": place.admin1,
            "country": place.country,
            "countryCode": place.countryCode,
            "latitude": place.latitude,
            "longitude": place.longitude
        ]
        if let alias = place.alias { result["alias"] = alias }
        if let timezone = place.timezone { result["timezone"] = timezone }
        if let followsCurrentLocation = place.followsCurrentLocation {
            result["followsCurrentLocation"] = followsCurrentLocation
        }
        return result
    }

    private static func notificationIntent(from value: [String: Any], planIDs: Set<String>) throws -> NotificationIntent {
        try exactKeys(value, ["hydration", "globalPreference", "selectedPlanIDs", "placeNotificationsEnabled", "selectedPlaceIDs", "placeSelectionMode"])
        guard value["hydration"] as? String == "ready",
              let rawPreference = value["globalPreference"] as? String,
              let preference = GlobalPreference(rawValue: rawPreference),
              let rawPlanIDs = value["selectedPlanIDs"] as? [Any],
              let placeNotificationsEnabled = boolean(value["placeNotificationsEnabled"]),
              let rawPlaceIDs = value["selectedPlaceIDs"] as? [Any],
              let rawPlaceMode = value["placeSelectionMode"] as? String,
              let placeMode = PlaceSelectionMode(rawValue: rawPlaceMode) else {
            throw NativePlanMigrationError.invalidExport
        }
        let selectedPlanIDs = try identifiers(rawPlanIDs, maximum: maximumSelectedPlans)
        let selectedPlaceIDs = try identifiers(rawPlaceIDs, maximum: maximumSelectedPlaces)
        // Native must never turn a dangling or only partially hydrated choice
        // into a plan-level opt-out. The legacy exporter waits for complete
        // inventory, so this should be a true integrity failure instead.
        guard Set(selectedPlanIDs).isSubset(of: planIDs) else { throw NativePlanMigrationError.invalidExport }
        if placeMode == .default {
            guard selectedPlaceIDs.isEmpty else { throw NativePlanMigrationError.invalidExport }
        }
        return NotificationIntent(hydration: "ready", globalPreference: preference,
                                  selectedPlanIDs: selectedPlanIDs,
                                  placeNotificationsEnabled: placeNotificationsEnabled,
                                  selectedPlaceIDs: selectedPlaceIDs,
                                  placeSelectionMode: placeMode)
    }

    private static func identifiers(_ values: [Any], maximum: Int) throws -> [String] {
        guard values.count <= maximum else { throw NativePlanMigrationError.invalidExport }
        let identifiers = try values.map { value -> String in
            guard let text = value as? String, validText(text, maximum: 160, required: true) else {
                throw NativePlanMigrationError.invalidExport
            }
            return text
        }
        guard Set(identifiers).count == identifiers.count else { throw NativePlanMigrationError.invalidExport }
        return identifiers
    }

    private static func validSource(_ value: Source) -> Bool {
        guard value.version == 1, value.owner == "legacy", value.hydration == "ready",
              Source.captureDate(value.capturedAt) != nil,
              value.plans.count <= maximumPlans,
              validIntent(value.notificationIntent) else { return false }
        var IDs = Set<String>()
        for plan in value.plans {
            guard IDs.insert(plan.id).inserted, validPlan(plan) else { return false }
        }
        return Set(value.notificationIntent.selectedPlanIDs).isSubset(of: IDs)
    }

    private static func validIntent(_ value: NotificationIntent) -> Bool {
        guard value.hydration == "ready",
              value.selectedPlanIDs.count <= maximumSelectedPlans,
              value.selectedPlaceIDs.count <= maximumSelectedPlaces,
              value.selectedPlanIDs.allSatisfy({ validText($0, maximum: 160, required: true) }),
              value.selectedPlaceIDs.allSatisfy({ validText($0, maximum: 160, required: true) }),
              Set(value.selectedPlanIDs).count == value.selectedPlanIDs.count,
              Set(value.selectedPlaceIDs).count == value.selectedPlaceIDs.count else { return false }
        return value.placeSelectionMode != .default || value.selectedPlaceIDs.isEmpty
    }

    /// Stored envelopes use Codable-native field names, so validate the
    /// semantic schedule a second time rather than trusting a decoded file.
    private static func validPlan(_ value: NativeAgendaPlan) -> Bool {
        guard validText(value.id, maximum: 160, required: true),
              validText(value.title, maximum: 80, required: true),
              validText(value.label, maximum: 80, required: true),
              validText(value.original, maximum: 220),
              validText(value.answer, maximum: 280),
              validText(value.scheduleID, maximum: 160, required: true),
              value.createdAtMilliseconds > 0, value.updatedAtMilliseconds > 0,
              validPlace(value.place),
              validCivilDate(value.targetDate),
              validHour(value.startHour, isStart: true),
              validHour(value.endHour, isStart: false),
              value.endHour > value.startHour,
              !value.windows.isEmpty, value.windows.count <= NativeAgendaRepository.maximumWindowsPerPlan,
              Set(value.windows.map(\.id)).count == value.windows.count,
              let first = value.windows.first,
              first.targetDate == value.targetDate,
              first.startHour == value.startHour,
              first.endHour == value.endHour,
              value.windows.allSatisfy(validWindow) else { return false }

        let span = value.span
        let routine = value.routine
        switch value.scheduleType {
        case .single:
            return span == nil && value.windows.count == 1 && (routine == nil || validRoutine(routine!))
        case .discrete:
            return span == nil && routine == nil && value.windows.count >= 2
        case .continuousSpan:
            guard let span, routine == nil, validSpan(span),
                  span.startDate == value.targetDate, span.startHour == value.startHour else { return false }
            return expectedSpanWindows(span) == value.windows
        }
    }

    private static func validPlace(_ value: NativeAgendaPlace) -> Bool {
        guard validText(value.id, maximum: 160, required: true),
              validText(value.name, maximum: 180, required: true),
              validText(value.admin1, maximum: 180),
              validText(value.country, maximum: 180),
              validCountryCode(value.countryCode),
              value.latitude.isFinite, value.longitude.isFinite,
              abs(value.latitude) <= 90, abs(value.longitude) <= 180,
              value.alias.map({ validText($0, maximum: 36) }) ?? true,
              value.timezone.map({ $0.utf16.count <= 100 && TimeZone(identifier: $0) != nil }) ?? true else { return false }
        if value.legacyIDType == .number {
            guard value.id.range(of: "^[1-9][0-9]{0,15}$", options: .regularExpression) != nil,
                  let number = Int64(value.id), number > 0, number <= 9_007_199_254_740_991 else { return false }
        }
        return true
    }

    private static func validWindow(_ value: NativeAgendaWindow) -> Bool {
        validText(value.id, maximum: 160, required: true) && validCivilDate(value.targetDate) &&
            validHour(value.startHour, isStart: true) && validHour(value.endHour, isStart: false) &&
            value.endHour > value.startHour && validText(value.label, maximum: 80, required: true)
    }

    private static func validSpan(_ value: NativeAgendaSpan) -> Bool {
        guard validCivilDate(value.startDate), validCivilDate(value.endDate), value.startDate <= value.endDate,
              validHour(value.startHour, isStart: true), validHour(value.endHour, isStart: false),
              value.startDate < value.endDate || value.endHour > value.startHour,
              let days = daysBetween(value.startDate, value.endDate), days <= 13 else { return false }
        return true
    }

    private static func validRoutine(_ value: NativeAgendaRoutine) -> Bool {
        !value.weekdays.isEmpty && value.weekdays.count <= 7 &&
            value.weekdays == Array(Set(value.weekdays)).sorted() &&
            value.weekdays.allSatisfy { (0...6).contains($0) } &&
            value.focus.count <= NativeAgendaRoutine.Focus.allCases.count &&
            Set(value.focus).count == value.focus.count
    }

    private static func expectedSpanWindows(_ span: NativeAgendaSpan) -> [NativeAgendaWindow] {
        guard let calendar = utcCalendar(), let count = daysBetween(span.startDate, span.endDate), count <= 13 else { return [] }
        return (0...count).compactMap { index in
            guard let date = addDays(span.startDate, index, calendar: calendar) else { return nil }
            let first = index == 0
            let last = index == count
            return NativeAgendaWindow(id: "span-\(date)", targetDate: date,
                                      startHour: first ? span.startHour : 0,
                                      endHour: last ? span.endHour : 24,
                                      label: first ? "Starts" : (last ? "Ends" : "All day"))
        }
    }

    // MARK: - Durable receipt

    private func load() throws -> Stored? {
        var invalidPrimary = false
        do {
            if let bytes = try readFile(Self.primaryName) {
                do {
                    let envelope = try Self.decodeEnvelope(bytes)
                    do {
                        if let backup = try readFile(Self.backupName) { _ = try Self.decodeEnvelope(backup) }
                    } catch NativePlanMigrationError.unsupportedStoreVersion {
                        throw NativePlanMigrationError.unsupportedStoreVersion
                    } catch {
                        // A complete current generation does not depend on an
                        // old damaged backup.
                    }
                    return Stored(envelope: envelope, bytes: bytes, recovered: false)
                } catch NativePlanMigrationError.unsupportedStoreVersion {
                    throw NativePlanMigrationError.unsupportedStoreVersion
                } catch {
                    invalidPrimary = true
                }
            }
        } catch NativePlanMigrationError.unsupportedStoreVersion {
            throw NativePlanMigrationError.unsupportedStoreVersion
        } catch {
            invalidPrimary = true
        }
        if let bytes = try readFile(Self.backupName) {
            return Stored(envelope: try Self.decodeEnvelope(bytes), bytes: bytes, recovered: true)
        }
        if invalidPrimary { throw NativePlanMigrationError.invalidStore }
        return nil
    }

    private static func decodeEnvelope(_ bytes: Data) throws -> Envelope {
        guard bytes.count <= maximumEnvelopeBytes,
              let raw = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            throw NativePlanMigrationError.invalidStore
        }
        // Ownership is a hard fence, not an ordinary malformed-record case.
        // Once a later native owner or newer writer has claimed this location,
        // this legacy rehearsal must never recover an older backup and replace
        // that primary record.
        if ["schemaVersion", "minReaderVersion", "minWriterVersion"].contains(where: { (integer(raw[$0]) ?? 0) > 1 }) ||
            (raw["owner"] as? String).map({ $0 != "legacy" }) == true {
            throw NativePlanMigrationError.unsupportedStoreVersion
        }
        for key in ["schemaVersion", "minReaderVersion", "minWriterVersion"] {
            guard integer(raw[key]) == 1 else { throw NativePlanMigrationError.unsupportedStoreVersion }
        }
        try exactKeys(raw, ["schemaVersion", "minReaderVersion", "minWriterVersion", "owner", "revision", "sourceDigest", "source", "tombstones", "receiptDigest"])
        guard raw["owner"] as? String == "legacy", integer(raw["revision"]) ?? 0 > 0,
              let tombstones = raw["tombstones"] as? [Any] else {
            throw NativePlanMigrationError.invalidStore
        }
        for tombstone in tombstones {
            guard let object = tombstone as? [String: Any] else { throw NativePlanMigrationError.invalidStore }
            try exactKeys(object, ["id", "revision"])
        }
        let envelope: Envelope
        do { envelope = try JSONDecoder().decode(Envelope.self, from: bytes) }
        catch { throw NativePlanMigrationError.invalidStore }
        guard envelope.schemaVersion == 1, envelope.minReaderVersion == 1, envelope.minWriterVersion == 1,
              envelope.owner == "legacy", envelope.revision > 0,
              validDigest(envelope.sourceDigest), validSource(envelope.source),
              envelope.tombstones.count <= maximumPlans,
              Set(envelope.tombstones.map(\.id)).count == envelope.tombstones.count else {
            throw NativePlanMigrationError.invalidStore
        }
        let active = Set(envelope.source.plans.map(\.id))
        for tombstone in envelope.tombstones {
            guard validText(tombstone.id, maximum: 160, required: true), tombstone.revision > 0,
                  tombstone.revision <= envelope.revision, !active.contains(tombstone.id) else {
                throw NativePlanMigrationError.invalidStore
            }
        }
        guard try semanticDigest(envelope.source) == envelope.sourceDigest else {
            throw NativePlanMigrationError.invalidStore
        }
        var unsigned = envelope
        unsigned.receiptDigest = ""
        guard try receiptDigest(unsigned) == envelope.receiptDigest else {
            throw NativePlanMigrationError.invalidStore
        }
        return envelope
    }

    private func withStoreLock<T>(_ body: () throws -> T) throws -> T {
        do { try Self.prepareDirectory(directory) }
        catch { throw NativePlanMigrationError.storageUnavailable }
        let lock = directory.appendingPathComponent(".rehearsal.lock")
        let descriptor = open(lock.path, O_CREAT | O_RDWR | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlanMigrationError.storageUnavailable }
        defer { close(descriptor) }
        guard fchmod(descriptor, mode_t(0o600)) == 0, flock(descriptor, LOCK_EX) == 0 else {
            throw NativePlanMigrationError.storageUnavailable
        }
        defer { flock(descriptor, LOCK_UN) }
        do {
            try Self.protect(lock, isDirectory: false)
            return try body()
        } catch let error as CancellationError {
            throw error
        } catch let error as NativePlanMigrationError {
            throw error
        } catch {
            throw NativePlanMigrationError.storageUnavailable
        }
    }

    private func readFile(_ name: String) throws -> Data? {
        try Self.readFile(name, directory: directory)
    }

    private static func readFile(_ name: String, directory: URL) throws -> Data? {
        let url = directory.appendingPathComponent(name)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw NativePlanMigrationError.storageUnavailable
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_mode & S_IFMT == S_IFREG,
              status.st_size >= 0, status.st_size <= maximumEnvelopeBytes else {
            throw NativePlanMigrationError.invalidStore
        }
        let bytes = try handle.readToEnd() ?? Data()
        guard bytes.count <= maximumEnvelopeBytes else { throw NativePlanMigrationError.invalidStore }
        try protect(url, isDirectory: false)
        return bytes
    }

    private func atomicWrite(_ data: Data, name: String, primary: Bool) throws {
        let temporary = directory.appendingPathComponent(".pending-\(UUID().uuidString)")
        let destination = directory.appendingPathComponent(name)
        let descriptor = open(temporary.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlanMigrationError.storageUnavailable }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: temporary)
        }
        try Self.protect(temporary, isDirectory: false)
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
        guard try Data(contentsOf: temporary, options: .uncached) == data else {
            throw NativePlanMigrationError.invalidStore
        }
        _ = try Self.decodeEnvelope(data)
        if primary {
            try failureInjector?(.afterPrimaryStaged)
            try failureInjector?(.beforePrimaryReplace)
        }
        try Task.checkCancellation()
        guard rename(temporary.path, destination.path) == 0 else {
            throw NativePlanMigrationError.storageUnavailable
        }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw NativePlanMigrationError.storageUnavailable }
        defer { close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw NativePlanMigrationError.storageUnavailable }
    }

    // MARK: - Validation and encoding helpers

    private static func semanticDigest(_ source: Source) throws -> String {
        try digest(SemanticSource(plans: source.plans, notificationIntent: source.notificationIntent))
    }

    private static func receiptDigest(_ envelope: Envelope) throws -> String { try digest(envelope) }

    private static func digest<T: Encodable>(_ value: T) throws -> String {
        SHA256.hash(data: try encode(value)).map { String(format: "%02x", $0) }.joined()
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private static func object(_ data: Data) throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NativePlanMigrationError.invalidExport
        }
        return object
    }

    private static func exactKeys(_ value: [String: Any], _ expected: [String]) throws {
        guard Set(value.keys) == Set(expected) else { throw NativePlanMigrationError.invalidExport }
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
              let integer = Int(number.stringValue) else { return nil }
        return integer
    }

    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    private static func validText(_ value: String, maximum: Int, required: Bool = false) -> Bool {
        value.utf16.count <= maximum &&
            (!required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) &&
            !value.unicodeScalars.contains { $0.value < 32 || (127...159).contains($0.value) }
    }

    private static func validCountryCode(_ value: String) -> Bool {
        value.isEmpty || (value.utf8.count == 2 && value.unicodeScalars.allSatisfy { (65...90).contains($0.value) })
    }

    private static func validCivilDate(_ value: String) -> Bool {
        guard value.utf8.count == 10, value.split(separator: "-").count == 3,
              let calendar = utcCalendar(), dateFromCivil(value, calendar: calendar) != nil else { return false }
        return value.unicodeScalars.enumerated().allSatisfy { index, scalar in
            [4, 7].contains(index) ? scalar.value == 45 : (48...57).contains(scalar.value)
        }
    }

    private static func validHour(_ value: Double, isStart: Bool) -> Bool {
        guard value.isFinite, value >= 0, value <= 24,
              abs(value * 3600 - (value * 3600).rounded()) < 0.000_001 else { return false }
        return isStart ? value < 24 : value > 0
    }

    private static func utcCalendar() -> Calendar? {
        guard let timezone = TimeZone(secondsFromGMT: 0) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timezone
        return calendar
    }

    private static func daysBetween(_ start: String, _ end: String) -> Int? {
        guard let calendar = utcCalendar(), let first = dateFromCivil(start, calendar: calendar),
              let second = dateFromCivil(end, calendar: calendar) else { return nil }
        return calendar.dateComponents([.day], from: first, to: second).day
    }

    private static func dateFromCivil(_ value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let date = calendar.date(from: components) else { return nil }
        let roundTrip = calendar.dateComponents([.year, .month, .day], from: date)
        return roundTrip.year == year && roundTrip.month == month && roundTrip.day == day ? date : nil
    }

    private static func addDays(_ value: String, _ count: Int, calendar: Calendar) -> String? {
        guard let date = dateFromCivil(value, calendar: calendar),
              let next = calendar.date(byAdding: .day, value: count, to: date) else { return nil }
        let components = calendar.dateComponents([.year, .month, .day], from: next)
        guard let year = components.year, let month = components.month, let day = components.day else { return nil }
        return String(format: "%04d-%02d-%02d", locale: Locale(identifier: "en_US_POSIX"), year, month, day)
    }

    private static func validDigest(_ value: String) -> Bool {
        value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }

    private static func prepareDirectory(_ directory: URL) throws {
        guard directory.isFileURL else { throw NativePlanMigrationError.storageUnavailable }
        var cursor = directory.standardizedFileURL
        while cursor.path != "/" {
            var status = stat()
            if lstat(cursor.path, &status) == 0 {
                let kind = status.st_mode & S_IFMT
                let systemAlias = ["/var": "private/var", "/tmp": "private/tmp"][cursor.path]
                let acceptedAlias = kind == S_IFLNK && status.st_uid == 0 && systemAlias != nil &&
                    (try? FileManager.default.destinationOfSymbolicLink(atPath: cursor.path)) == systemAlias
                guard kind == S_IFDIR || acceptedAlias else { throw NativePlanMigrationError.storageUnavailable }
            } else if errno != ENOENT {
                throw NativePlanMigrationError.storageUnavailable
            }
            cursor.deleteLastPathComponent()
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try protect(directory, isDirectory: true)
    }

    private static func protect(_ url: URL, isDirectory: Bool) throws {
        var attributes: [FileAttributeKey: Any] = [.posixPermissions: isDirectory ? 0o700 : 0o600]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.setAttributes(attributes, ofItemAtPath: url.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var local = url
        try local.setResourceValues(values)
    }
}
