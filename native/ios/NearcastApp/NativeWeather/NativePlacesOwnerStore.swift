import Foundation
import CoreFoundation
import CryptoKit
import Darwin

struct NativePlacesOwnerDeletion: Codable, Equatable, Sendable {
    let sequence: Int
    let id: String
}

/// Canonical native state plus the outstanding, ordered legacy stop-watch work.
/// A re-added place never erases an earlier deletion event.
struct NativePlacesOwnerSnapshot: Codable, Equatable, Sendable {
    var version: Int = 1
    var revision: Int
    var source: NativePlacesSource
    var pendingDeletions: [NativePlacesOwnerDeletion]
    var deletionWatermark: Int
}

enum NativePlacesOwnerBootstrap: Equatable, Sendable {
    case unmigrated
    case owned(NativePlacesOwnerSnapshot)
    case blocked
}

enum NativePlacesOwnerError: Error, LocalizedError, Equatable {
    case invalid, unavailable, stale, limit, storage, unsupported, busy

    var errorDescription: String? {
        switch self {
        case .invalid: return "This places action could not be understood."
        case .unavailable: return "Native places are not ready. Reopen Places and try again."
        case .stale: return "Places or settings changed. Review the refreshed list and try again."
        case .limit: return "You can save eight places. Remove a saved place before adding another."
        case .storage: return "The places change could not be verified. Reopen Places before trying again."
        case .unsupported: return "Stored places require a newer reader. No stored data was changed."
        case .busy: return "Places cannot accept another change yet. Reopen Places and try again."
        }
    }

    var code: String {
        switch self {
        case .invalid: return "invalid"
        case .unavailable: return "unavailable"
        case .stale: return "stale"
        case .limit: return "limit"
        case .storage, .unsupported: return "storage"
        case .busy: return "busy"
        }
    }
}

/// One owner, one atomic generation. Both actor isolation and a filesystem lock
/// protect read-modify-write across independently created store instances.
actor NativePlacesOwnerStore {
    nonisolated static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Nearcast/NativePlacesOwner", isDirectory: true)
            .resolvingSymlinksInPath()
    }

    enum WriteStage: Sendable, CaseIterable {
        case afterSourceExportStaged, afterSourceExportReplace, afterSourceExportReadback
        case afterBackupWrite, afterPrimaryStaged, beforePrimaryReplace, afterPrimaryReplace, afterPrimaryReadback
    }
    typealias FailureInjector = @Sendable (WriteStage) throws -> Void

    private let directory: URL
    private let failureInjector: FailureInjector?
    private static let primaryName = "places-owner.v1.json"
    private static let backupName = "places-owner.previous.json"
    private static let sourceExportName = "places-owner.legacy-source.v1.json"
    private static let activationName = "ownership-activated.v1"
    private static let activationBytes = Data("nearcast-native-owner:1\n".utf8)
    private static let maximumBytes = 4 * 1_024 * 1_024
    private static let maximumReceipts = 256
    private static let maximumPendingDeletions = 4096

    init(directory: URL) {
        self.directory = directory
        self.failureInjector = nil
    }

    init(directory: URL, failureInjector: @escaping FailureInjector) {
        self.directory = directory
        self.failureInjector = failureInjector
    }

    /// Safe for a document-start seed: absence is different from unreadable,
    /// corrupt, future-version, or incompletely recovered owner state.
    nonisolated static func readBootstrap(directory: URL = defaultDirectory) -> NativePlacesOwnerBootstrap {
        do {
            return try withLock(directory: directory) {
                guard let stored = try load(directory: directory) else { return .unmigrated }
                return .owned(stored.envelope.snapshot)
            }
        } catch { return .blocked }
    }

    func snapshot() throws -> NativePlacesOwnerSnapshot? {
        try Self.withLock(directory: directory) { try Self.load(directory: directory)?.envelope.snapshot }
    }

    /// The first verified legacy inventory is imported once. Later activation
    /// attempts cannot overwrite native edits, even with a newer legacy capture.
    func activate(source: NativePlacesSource) throws -> NativePlacesOwnerSnapshot {
        try Task.checkCancellation()
        guard Self.validSource(source, owner: "legacy") else { throw NativePlacesOwnerError.invalid }
        return try Self.withLock(directory: directory) {
            if let stored = try Self.load(directory: directory) { return stored.envelope.snapshot }
            try retainLegacySourceExport(source)
            var nativeSource = source
            nativeSource.owner = "native"
            nativeSource.capturedAt = try Self.nextCapture(after: source.capturedAt)
            let snapshot = NativePlacesOwnerSnapshot(revision: 1, source: nativeSource,
                pendingDeletions: [], deletionWatermark: 0)
            let envelope = Envelope(snapshot: snapshot, receipts: [])
            return try commit(envelope, previous: nil).snapshot
        }
    }

    /// Searches and sensor permission requests remain host operations. Their
    /// resolved selection enters this store as an ordinary select command.
    func perform(command: NativePlacesCommand) -> NativePlacesReply {
        let requestID = UUID(uuidString: command.requestID) == nil ? "" : command.requestID
        do {
            return try Self.withLock(directory: directory) {
                guard let stored = try Self.load(directory: directory) else { throw NativePlacesOwnerError.unavailable }
                try Self.validate(command)
                let before = stored.envelope.snapshot
                if command.action == "snapshot" {
                    return NativePlacesReply(requestID: requestID, ok: true, source: before.source)
                }
                var canonicalCommand = command
                canonicalCommand.requestID = command.requestID.lowercased()
                let fingerprint = try Self.digest(canonicalCommand)
                if let receipt = stored.envelope.receipts.first(where: { $0.requestID == canonicalCommand.requestID }) {
                    guard receipt.fingerprint == fingerprint else { throw NativePlacesOwnerError.invalid }
                    // A retained receipt never replays a write. If the world has
                    // moved on, return a fresh stale receipt, not obsolete data.
                    // ACK-only revisions do not change user state or invalidate
                    // the latest mutation receipt. Any later mutation appends a
                    // receipt with a strictly newer user-state capture.
                    guard receipt.revision == stored.envelope.receipts.last?.revision else { throw NativePlacesOwnerError.stale }
                    return NativePlacesReply(requestID: requestID, ok: true, source: before.source)
                }
                guard let expected = command.expectedSource, expected == before.source else { throw NativePlacesOwnerError.stale }
                var next = stored.envelope
                try Self.apply(command, to: &next.snapshot)
                try Self.advance(&next.snapshot)
                next.receipts.append(Receipt(requestID: canonicalCommand.requestID,
                    fingerprint: fingerprint, revision: next.snapshot.revision))
                if next.receipts.count > Self.maximumReceipts { next.receipts.removeFirst(next.receipts.count - Self.maximumReceipts) }
                // Even a successful no-op advances capture/revision. Thus an
                // evicted request's expectedSource can never become fresh again.
                let committed = try commit(next, previous: stored)
                return NativePlacesReply(requestID: requestID, ok: true, source: committed.snapshot.source)
            }
        } catch {
            let failure = (error as? NativePlacesOwnerError) ?? .storage
            // Read back after releasing the mutation lock: an uncertain write
            // may have committed. Never publish an unverified in-memory result.
            let current = try? snapshot()
            return NativePlacesReply(requestID: requestID, ok: false, source: current?.source,
                message: failure.errorDescription, code: failure.code)
        }
    }

    /// ACK only an observed prefix. Concurrent later deletions remain pending;
    /// old ACKs are harmless and future ACKs cannot skip unseen work.
    func ackDeletions(through sequence: Int) throws -> NativePlacesOwnerSnapshot {
        try Self.withLock(directory: directory) {
            guard let stored = try Self.load(directory: directory) else { throw NativePlacesOwnerError.unavailable }
            let before = stored.envelope.snapshot
            guard sequence >= 0, sequence <= (before.pendingDeletions.last?.sequence ?? before.deletionWatermark) else {
                throw NativePlacesOwnerError.invalid
            }
            if sequence <= before.deletionWatermark { return before }
            var next = stored.envelope
            next.snapshot.pendingDeletions.removeAll { $0.sequence <= sequence }
            next.snapshot.deletionWatermark = sequence
            guard next.snapshot.revision < Int.max else { throw NativePlacesOwnerError.storage }
            next.snapshot.revision += 1
            // Reconciliation changes no owned place/preference. Keeping the
            // source capture stable lets the originating edit receipt and a
            // concurrent native UI edit remain fresh after the web ACK.
            return try commit(next, previous: stored).snapshot
        }
    }

    private struct Receipt: Codable, Equatable, Sendable {
        let requestID: String
        let fingerprint: String
        let revision: Int
    }

    private struct Envelope: Codable, Equatable, Sendable {
        var schemaVersion: Int = 1
        var minReaderVersion: Int = 1
        var minWriterVersion: Int = 1
        var snapshot: NativePlacesOwnerSnapshot
        var receipts: [Receipt]
        var integrity: String = ""
    }

    private struct Stored {
        let envelope: Envelope
        let bytes: Data
    }

    private static func validate(_ command: NativePlacesCommand) throws {
        guard command.version == 1, UUID(uuidString: command.requestID) != nil,
              try encode(command).count <= 280 * 1024 else { throw NativePlacesOwnerError.invalid }
        let populated: Set<String> = Set([
            command.place == nil ? nil : "place", command.id == nil ? nil : "id", command.query == nil ? nil : "query",
            command.alias == nil ? nil : "alias", command.direction == nil ? nil : "direction",
            command.preferences == nil ? nil : "preferences"
        ].compactMap { $0 })
        let required: Set<String>
        switch command.action {
        case "snapshot": required = []
        case "select":
            guard (command.id == nil) != (command.place == nil) else { throw NativePlacesOwnerError.invalid }
            required = command.id == nil ? ["place"] : ["id"]
        case "save": required = ["place"]
        case "rename": required = ["id", "alias"]
        case "move": required = ["id", "direction"]
        case "remove": required = ["id"]
        case "preferences": required = ["preferences"]
        default: throw NativePlacesOwnerError.invalid
        }
        guard populated == required, command.id.map({ validText($0, maximum: 160, nonblank: true) }) ?? true,
              command.place?.isValid ?? true,
              command.alias.map({ validText($0, maximum: 36) }) ?? true,
              command.direction.map({ [-1, 1].contains($0) }) ?? true,
              command.preferences?.isValid ?? true else { throw NativePlacesOwnerError.invalid }
        if command.action != "snapshot" {
            guard let expected = command.expectedSource, validSource(expected, owner: "native") else { throw NativePlacesOwnerError.invalid }
        }
    }

    private static func apply(_ command: NativePlacesCommand, to snapshot: inout NativePlacesOwnerSnapshot) throws {
        switch command.action {
        case "select":
            let place: NativeManagedPlace
            if let id = command.id {
                guard let saved = snapshot.source.savedPlaces.first(where: { $0.id == id }) else { throw NativePlacesOwnerError.stale }
                place = saved
            } else if let requested = command.place { place = requested }
            else { throw NativePlacesOwnerError.invalid }
            snapshot.source.selectedPlace = place
            snapshot.source.lastPlace = place
        case "save":
            guard var place = command.place else { throw NativePlacesOwnerError.invalid }
            if let saved = snapshot.source.savedPlaces.first(where: { $0.id == place.id }) {
                guard saved.hasSameIdentity(as: place) else { throw NativePlacesOwnerError.stale }
                return
            }
            guard snapshot.source.savedPlaces.count < 8 else { throw NativePlacesOwnerError.limit }
            place.followsCurrentLocation = false
            snapshot.source.savedPlaces.insert(place, at: 0)
        case "rename":
            guard let index = snapshot.source.savedPlaces.firstIndex(where: { $0.id == command.id }),
                  let raw = command.alias else { throw NativePlacesOwnerError.stale }
            let alias = raw.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            let place = snapshot.source.savedPlaces[index]
            snapshot.source.savedPlaces[index].alias = alias
            if snapshot.source.selectedPlace?.id == place.id && snapshot.source.selectedPlace?.legacyIDType == place.legacyIDType {
                snapshot.source.selectedPlace?.alias = alias
            }
            if snapshot.source.lastPlace?.id == place.id && snapshot.source.lastPlace?.legacyIDType == place.legacyIDType {
                snapshot.source.lastPlace?.alias = alias
            }
        case "move":
            guard let from = snapshot.source.savedPlaces.firstIndex(where: { $0.id == command.id }),
                  let direction = command.direction else { throw NativePlacesOwnerError.stale }
            let to = from + direction
            if snapshot.source.savedPlaces.indices.contains(to) { snapshot.source.savedPlaces.swapAt(from, to) }
        case "remove":
            guard let index = snapshot.source.savedPlaces.firstIndex(where: { $0.id == command.id }) else { throw NativePlacesOwnerError.stale }
            guard snapshot.pendingDeletions.count < maximumPendingDeletions else { throw NativePlacesOwnerError.busy }
            let last = snapshot.pendingDeletions.last?.sequence ?? snapshot.deletionWatermark
            guard last < Int.max else { throw NativePlacesOwnerError.storage }
            let place = snapshot.source.savedPlaces.remove(at: index)
            snapshot.pendingDeletions.append(NativePlacesOwnerDeletion(sequence: last + 1, id: place.id))
        case "preferences":
            guard let patch = command.preferences else { throw NativePlacesOwnerError.invalid }
            if let value = patch.unit { snapshot.source.preferences.unit = value }
            if let value = patch.timeFormat { snapshot.source.preferences.timeFormat = value }
            if let value = patch.theme { snapshot.source.preferences.theme = value }
            if let value = patch.reactiveSkyEnabled { snapshot.source.preferences.reactiveSkyEnabled = value }
            if let value = patch.reactiveSkyMotionAllowed { snapshot.source.preferences.reactiveSkyMotionAllowed = value }
        default: throw NativePlacesOwnerError.invalid
        }
    }

    private static func advance(_ snapshot: inout NativePlacesOwnerSnapshot) throws {
        guard snapshot.revision < Int.max else { throw NativePlacesOwnerError.storage }
        snapshot.revision += 1
        snapshot.source.capturedAt = try nextCapture(after: snapshot.source.capturedAt)
    }

    private static func nextCapture(after previous: String) throws -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = previous.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        guard let date = parser.date(from: previous) else { throw NativePlacesOwnerError.invalid }
        let milliseconds = max(floor(Date().timeIntervalSince1970 * 1000), (date.timeIntervalSince1970 * 1000).rounded() + 1)
        let output = DateFormatter()
        output.locale = Locale(identifier: "en_US_POSIX")
        output.calendar = Calendar(identifier: .gregorian)
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        let text = output.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let next = parser.date(from: text), next > date, text.utf8.count == 24 else { throw NativePlacesOwnerError.storage }
        return text
    }

    private static func validSource(_ source: NativePlacesSource, owner: String) -> Bool {
        guard source.owner == owner, let bytes = try? encode(source), bytes.count <= 128 * 1024 else { return false }
        // Share the established field validation without making activation
        // dependent on which owners a particular presentation reader accepts.
        var validated = source
        validated.owner = "legacy"
        return validated.isValid
    }

    private static func validText(_ value: String, maximum: Int, nonblank: Bool = false) -> Bool {
        value.utf16.count <= maximum && !value.unicodeScalars.contains { $0.value < 32 || (127...159).contains($0.value) } &&
            (!nonblank || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    /// Retain only the validated, allowlisted source, before changing owner or
    /// capture. This is protected recovery evidence until migration acceptance,
    /// never live state and never an automatic fallback. A retry before cutover
    /// can replace the staged export with its newly verified legacy inventory;
    /// once any owner exists, activation returns before reaching this writer.
    private func retainLegacySourceExport(_ source: NativePlacesSource) throws {
        try Task.checkCancellation()
        let bytes = try Self.encode(source)
        guard bytes.count <= 128 * 1024 else { throw NativePlacesOwnerError.invalid }
        try Self.atomicWrite(bytes, name: Self.sourceExportName, directory: directory, beforeReplace: {
            try self.failureInjector?(.afterSourceExportStaged)
            try Task.checkCancellation()
        })
        try failureInjector?(.afterSourceExportReplace)
        guard let readback = try Self.readFile(Self.sourceExportName, directory: directory),
              readback == bytes,
              (try? JSONDecoder().decode(NativePlacesSource.self, from: readback)) == source else {
            throw NativePlacesOwnerError.storage
        }
        try failureInjector?(.afterSourceExportReadback)
    }

    private func commit(_ proposed: Envelope, previous: Stored?) throws -> Envelope {
        try Task.checkCancellation()
        var next = proposed
        next.integrity = ""
        next.integrity = try Self.digest(next)
        let bytes = try Self.encode(next)
        guard bytes.count <= Self.maximumBytes, try Self.decode(bytes) == next else { throw NativePlacesOwnerError.storage }
        if let previous {
            try Self.atomicWrite(previous.bytes, name: Self.backupName, directory: directory)
            try failureInjector?(.afterBackupWrite)
        }
        try Self.atomicWrite(bytes, name: Self.primaryName, directory: directory, beforeReplace: {
            try self.failureInjector?(.afterPrimaryStaged)
            try self.failureInjector?(.beforePrimaryReplace)
            try Task.checkCancellation()
        })
        try failureInjector?(.afterPrimaryReplace)
        guard let readback = try Self.readFile(Self.primaryName, directory: directory),
              try Self.decode(readback) == next else { throw NativePlacesOwnerError.storage }
        // A small independent barrier distinguishes a missing owner generation
        // from a never-migrated installation. It contains no family records.
        try Self.atomicWrite(Self.activationBytes, name: Self.activationName, directory: directory)
        try failureInjector?(.afterPrimaryReadback)
        return next
    }

    private static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    private static func digest<T: Encodable>(_ value: T) throws -> String {
        SHA256.hash(data: try encode(value)).map { String(format: "%02x", $0) }.joined()
    }

    private static func exactKeys(_ value: Any?, _ required: Set<String>) throws -> [String: Any] {
        guard let object = value as? [String: Any], Set(object.keys) == required else { throw NativePlacesOwnerError.storage }
        return object
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
              let integer = Int(number.stringValue) else { return nil }
        return integer
    }

    private static func decode(_ bytes: Data) throws -> Envelope {
        guard bytes.count <= maximumBytes, let raw = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
            throw NativePlacesOwnerError.storage
        }
        // Look at version barriers before ordinary shape/integrity validation.
        for key in ["schemaVersion", "minReaderVersion", "minWriterVersion"] {
            guard let version = integer(raw[key]) else { throw NativePlacesOwnerError.storage }
            guard version == 1 else { throw NativePlacesOwnerError.unsupported }
        }
        if let value = raw["snapshot"] as? [String: Any] {
            if let version = integer(value["version"]), version != 1 { throw NativePlacesOwnerError.unsupported }
            if let source = value["source"] as? [String: Any] {
                if let version = integer(source["version"]), version != 1 { throw NativePlacesOwnerError.unsupported }
                if let owner = source["owner"] as? String, owner != "native" { throw NativePlacesOwnerError.unsupported }
            }
        }
        _ = try exactKeys(raw, ["schemaVersion", "minReaderVersion", "minWriterVersion", "snapshot", "receipts", "integrity"])
        let snapshot = try exactKeys(raw["snapshot"], ["version", "revision", "source", "pendingDeletions", "deletionWatermark"])
        guard let deletions = snapshot["pendingDeletions"] as? [Any], let receipts = raw["receipts"] as? [Any] else {
            throw NativePlacesOwnerError.storage
        }
        for value in deletions { _ = try exactKeys(value, ["sequence", "id"]) }
        for value in receipts { _ = try exactKeys(value, ["requestID", "fingerprint", "revision"]) }
        let value: Envelope
        do { value = try JSONDecoder().decode(Envelope.self, from: bytes) }
        catch { throw NativePlacesOwnerError.storage }
        let state = value.snapshot
        guard state.version == 1, state.revision > 0, state.deletionWatermark >= 0,
              validSource(state.source, owner: "native"), state.pendingDeletions.count <= maximumPendingDeletions,
              value.receipts.count <= maximumReceipts, Set(value.receipts.map(\.requestID)).count == value.receipts.count else {
            throw NativePlacesOwnerError.storage
        }
        var sequence = state.deletionWatermark
        for deletion in state.pendingDeletions {
            guard sequence < Int.max, deletion.sequence == sequence + 1, validText(deletion.id, maximum: 160, nonblank: true) else {
                throw NativePlacesOwnerError.storage
            }
            sequence = deletion.sequence
        }
        var revision = 0
        for receipt in value.receipts {
            guard UUID(uuidString: receipt.requestID) != nil, receipt.requestID == receipt.requestID.lowercased(),
                  receipt.revision > revision, receipt.revision <= state.revision,
                  receipt.fingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NativePlacesOwnerError.storage }
            revision = receipt.revision
        }
        var unsigned = value
        unsigned.integrity = ""
        guard try digest(unsigned) == value.integrity else { throw NativePlacesOwnerError.storage }
        return value
    }

    private static func load(directory: URL) throws -> Stored? {
        let primary = try readFile(primaryName, directory: directory)
        let backup = try readFile(backupName, directory: directory)
        let barrier = try readFile(activationName, directory: directory)
        if let barrier, barrier != activationBytes { throw NativePlacesOwnerError.unsupported }
        guard let primary else {
            // Never resurrect a deleted place by automatically replaying a
            // previous generation. Backup recovery requires an explicit tool.
            guard backup == nil && barrier == nil else { throw NativePlacesOwnerError.storage }
            return nil
        }
        let envelope = try decode(primary)
        if let backup {
            do { _ = try decode(backup) }
            catch NativePlacesOwnerError.unsupported { throw NativePlacesOwnerError.unsupported }
            catch { /* A valid current owner does not depend on an older damaged backup. */ }
        }
        // Complete an interrupted first activation before making its verified
        // state available. Missing current state can never later look like a
        // never-migrated installation after a successful owner read.
        if barrier == nil { try atomicWrite(activationBytes, name: activationName, directory: directory) }
        return Stored(envelope: envelope, bytes: primary)
    }

    private nonisolated static func withLock<T>(directory: URL, _ body: () throws -> T) throws -> T {
        do {
            try prepareDirectory(directory)
            let lock = directory.appendingPathComponent(".owner.lock")
            let descriptor = open(lock.path, O_CREAT | O_RDWR | O_NOFOLLOW, mode_t(0o600))
            guard descriptor >= 0 else { throw NativePlacesOwnerError.storage }
            defer { close(descriptor) }
            guard fchmod(descriptor, mode_t(0o600)) == 0, flock(descriptor, LOCK_EX) == 0 else { throw NativePlacesOwnerError.storage }
            defer { flock(descriptor, LOCK_UN) }
            try protect(lock, isDirectory: false)
            return try body()
        } catch let error as NativePlacesOwnerError { throw error }
        catch let error as CancellationError { throw error }
        catch { throw NativePlacesOwnerError.storage }
    }

    private static func prepareDirectory(_ directory: URL) throws {
        guard directory.isFileURL else { throw NativePlacesOwnerError.storage }
        var cursor = directory.standardizedFileURL
        while cursor.path != "/" {
            var status = stat()
            if lstat(cursor.path, &status) == 0 {
                let kind = status.st_mode & S_IFMT
                let systemAlias = ["/var": "private/var", "/tmp": "private/tmp"][cursor.path]
                let acceptedAlias = kind == S_IFLNK && status.st_uid == 0 && systemAlias != nil &&
                    (try? FileManager.default.destinationOfSymbolicLink(atPath: cursor.path)) == systemAlias
                guard kind == S_IFDIR || acceptedAlias else { throw NativePlacesOwnerError.storage }
            } else if errno != ENOENT { throw NativePlacesOwnerError.storage }
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
        var localURL = url
        try localURL.setResourceValues(values)
    }

    private static func readFile(_ name: String, directory: URL) throws -> Data? {
        let path = directory.appendingPathComponent(name)
        let descriptor = open(path.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw NativePlacesOwnerError.storage
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var status = stat()
        guard fstat(descriptor, &status) == 0, status.st_mode & S_IFMT == S_IFREG,
              status.st_size >= 0, status.st_size <= maximumBytes else { throw NativePlacesOwnerError.storage }
        let bytes = try handle.readToEnd() ?? Data()
        guard bytes.count <= maximumBytes else { throw NativePlacesOwnerError.storage }
        try protect(path, isDirectory: false)
        return bytes
    }

    private static func atomicWrite(_ bytes: Data, name: String, directory: URL, beforeReplace: (() throws -> Void)? = nil) throws {
        let temporary = directory.appendingPathComponent(".pending-owner-\(UUID().uuidString)")
        let destination = directory.appendingPathComponent(name)
        let descriptor = open(temporary.path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw NativePlacesOwnerError.storage }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: temporary)
        }
        try protect(temporary, isDirectory: false)
        try handle.write(contentsOf: bytes)
        try handle.synchronize()
        try handle.close()
        guard try Data(contentsOf: temporary, options: .uncached) == bytes else { throw NativePlacesOwnerError.storage }
        try beforeReplace?()
        guard rename(temporary.path, destination.path) == 0 else { throw NativePlacesOwnerError.storage }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw NativePlacesOwnerError.storage }
        defer { close(directoryDescriptor) }
        guard fsync(directoryDescriptor) == 0 else { throw NativePlacesOwnerError.storage }
    }
}
