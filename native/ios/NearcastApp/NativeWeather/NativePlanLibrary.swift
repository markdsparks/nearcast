import Foundation
import Combine
import CryptoKit

enum NativePlanWriteError: LocalizedError {
    case invalid(String), conflict, damagedStore
    var errorDescription: String? {
        switch self {
        case .invalid(let message): return message
        case .conflict: return "This plan changed while you were editing. Close the editor and reopen it before saving."
        case .damagedStore: return "Your saved plans could not be read. Nothing has been replaced. Try reopening Nearcast."
        }
    }
}

/// A durable receipt for the one user-approved copy of already-verified
/// earlier Plans. It records aggregate provenance plus one-way source-ID
/// fingerprints, never a second schedule copy. Those fingerprints let a
/// later local deletion update the honest handoff summary without treating an
/// older unrelated imported mapping as part of this one-time transfer.
struct NativePlanLegacyHandoffReceipt: Codable, Equatable, Sendable {
    let version: Int
    /// Nil is a receipt from a build before source scopes existed. It remains
    /// readable for schedule history, but P0 notification staging must reject
    /// it rather than guessing whether it came from Local or Production.
    let sourceScope: NativeLegacySourceScope?
    let sourceDigest: String
    let sourceCapturedAtMilliseconds: Int64
    let sourcePlanCount: Int
    let availableNativeCopyCount: Int
    let protectedDeletedCount: Int
    let sourcePlanIDHashes: [String]?
}

/// What a native Plans screen can safely offer for the retained, verified
/// earlier Agenda projection. This is intentionally a presentation state, not
/// a claim that Nearcast owns earlier plan watches or delivery.
enum NativePlanLegacyHandoffState: Equatable {
    case unavailable
    case ready(planCount: Int)
    case empty
    case completed(NativePlanLegacyHandoffReceipt)
}

enum NativePlanLegacyHandoffResult: Equatable {
    case imported(NativePlanLegacyHandoffReceipt)
    case alreadyCompleted(NativePlanLegacyHandoffReceipt)

    var receipt: NativePlanLegacyHandoffReceipt {
        switch self {
        case .imported(let receipt), .alreadyCompleted(let receipt): return receipt
        }
    }
}

enum NativePlanLegacyHandoffError: LocalizedError, Equatable {
    case unavailable
    case unsafePlan

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Saved Plans are not verified on this iPhone yet. Nothing was imported."
        case .unsafePlan:
            return "One or more saved Plans cannot be scheduled safely in native Nearcast. Nothing was imported."
        }
    }
}

/// Native records own their own schedule identity. A handoff preserves an
/// earlier plan identifier only when it cannot collide with native identity;
/// it always gives the local schedule a new native-only ID so a copied plan
/// can never retarget an earlier planner's watch or delivery record.
struct NativePlanArchive: Codable, Equatable {
    var version = 1
    var plans: [NativeAgendaPlan] = []
    var importedIDs: [String: String] = [:]
    var legacyHandoff: NativePlanLegacyHandoffReceipt? = nil
}

/// The safe outcome of resolving a native Plans navigation request.
///
/// A route may contain either a locally-created native plan ID or the ID of
/// an earlier plan that was copied into the native library during the explicit
/// import. Resolving the latter opens the *local copy only*; it never adopts,
/// edits, enables, or otherwise changes an earlier plan's notification watch.
enum NativePlanRouteMatch: Equatable {
    case local(NativeAgendaPlan)
    case importedCopy(NativeAgendaPlan)
    case unavailable

    var plan: NativeAgendaPlan? {
        switch self {
        case .local(let plan), .importedCopy(let plan): return plan
        case .unavailable: return nil
        }
    }

    var isImportedCopy: Bool {
        if case .importedCopy = self { return true }
        return false
    }
}

struct NativePlanDiskStore {
    let directory: URL
    private var file: URL { directory.appendingPathComponent("plans.v1.json") }
    private var backup: URL { directory.appendingPathComponent("plans.previous.json") }

    func load() throws -> NativePlanArchive {
        guard FileManager.default.fileExists(atPath: file.path) else { return NativePlanArchive() }
        // A corrupt primary is not a license to replace newer user edits with
        // an older backup. Retain both files and surface the recovery error.
        let data = try Data(contentsOf: file)
        guard data.count <= 2_000_000,
              let value = try? JSONDecoder().decode(NativePlanArchive.self, from: data) else {
            throw NativePlanWriteError.damagedStore
        }
        try validate(value)
        return value
    }

    func save(_ archive: NativePlanArchive) throws {
        try validate(archive)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(archive)
        if FileManager.default.fileExists(atPath: file.path) {
            _ = try load() // Never overwrite an unreadable store.
            try Data(contentsOf: file).write(to: backup, options: .atomic)
        }
        try data.write(to: file, options: .atomic)
    }

    private func validate(_ archive: NativePlanArchive) throws {
        guard archive.version == 1,
              archive.plans.count <= 60,
              Set(archive.plans.map(\.id)).count == archive.plans.count,
              archive.importedIDs.count <= 600,
              archive.importedIDs.allSatisfy({
                  Self.validIdentifier($0.key) && Self.validIdentifier($0.value)
              }) else {
            throw NativePlanWriteError.damagedStore
        }
        if let receipt = archive.legacyHandoff {
            guard receipt.version == 1,
                  receipt.sourceDigest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  receipt.sourceCapturedAtMilliseconds > 0,
                  (0...60).contains(receipt.sourcePlanCount),
                  (0...receipt.sourcePlanCount).contains(receipt.availableNativeCopyCount),
                  (0...receipt.sourcePlanCount).contains(receipt.protectedDeletedCount),
                  receipt.availableNativeCopyCount + receipt.protectedDeletedCount <= receipt.sourcePlanCount else {
                throw NativePlanWriteError.damagedStore
            }
            if let hashes = receipt.sourcePlanIDHashes {
                guard hashes.count == receipt.sourcePlanCount,
                      Set(hashes).count == hashes.count,
                      hashes.allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }) else {
                    throw NativePlanWriteError.damagedStore
                }
            }
        }
        for plan in archive.plans { try NativePlanSchedule.validate(plan) }
    }

    private static func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf16.count <= 160 &&
            !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}

enum NativePlanSchedule {
    static func calendar(_ place: NativeAgendaPlace) throws -> Calendar {
        guard let id = place.timezone, let zone = TimeZone(identifier: id) else {
            throw NativePlanWriteError.invalid("Choose a place with a known local time zone.")
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }

    static func civil(_ date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    static func hour(_ date: Date, calendar: Calendar) -> Double {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return Double(parts.hour!) + Double(parts.minute!) / 60
    }

    static func date(_ day: String, hour: Double, calendar: Calendar) -> Date? {
        let pieces = day.split(separator: "-").compactMap { Int($0) }
        guard pieces.count == 3, hour.isFinite, (0...24).contains(hour) else { return nil }
        let minutes = Int((hour * 60).rounded())
        guard let noon = calendar.date(from: DateComponents(year: pieces[0], month: pieces[1], day: pieces[2], hour: 12)),
              civil(noon, calendar: calendar) == day else { return nil }
        if minutes == 1440 { return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: noon)) }
        guard let value = calendar.date(from: DateComponents(year: pieces[0], month: pieces[1], day: pieces[2], hour: minutes / 60, minute: minutes % 60)),
              civil(value, calendar: calendar) == day,
              abs(Self.hour(value, calendar: calendar) - hour) < 0.001 else { return nil }
        return value
    }

    static func make(title: String, place: NativeAgendaPlace, start: Date, end: Date,
                     weekdays: [Int] = [], existing: NativeAgendaPlan? = nil, now: Date = Date()) throws -> NativeAgendaPlan {
        let calendar = try calendar(place)
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.utf16.count <= 80 else { throw NativePlanWriteError.invalid("Give your plan a name of 1–80 characters.") }
        guard end > start else { throw NativePlanWriteError.invalid("The end must be after the start.") }
        let firstDay = civil(start, calendar: calendar), lastDay = civil(end, calendar: calendar)
        let firstHour = hour(start, calendar: calendar), lastHour = hour(end, calendar: calendar)
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: start), to: calendar.startOfDay(for: end)).day ?? 99
        guard days <= 13 else { throw NativePlanWriteError.invalid("Keep a continuous plan within 14 days.") }
        guard weekdays.isEmpty || firstDay == lastDay else { throw NativePlanWriteError.invalid("A weekly routine must start and end on the same day.") }
        var windows: [NativeAgendaWindow] = []
        for offset in 0...days {
            let day = civil(calendar.date(byAdding: .day, value: offset, to: start)!, calendar: calendar)
            let lower = offset == 0 ? firstHour : 0
            let upper = offset == days ? lastHour : 24
            if upper > lower {
                windows.append(.init(id: "window-\(day)", targetDate: day, startHour: lower, endHour: upper, label: "Plan window"))
            }
        }
        guard let first = windows.first, let last = windows.last else { throw NativePlanWriteError.invalid("Choose a time window.") }
        let span = windows.count > 1 ? NativeAgendaSpan(startDate: first.targetDate, startHour: first.startHour, endDate: last.targetDate, endHour: last.endHour) : nil
        let stamp = Int64(now.timeIntervalSince1970 * 1000)
        let id = existing?.id ?? "native-\(UUID().uuidString.lowercased())"
        let plan = NativeAgendaPlan(id: id, title: title, label: "Plan window", original: title, answer: "",
            place: place, targetDate: first.targetDate, startHour: first.startHour, endHour: first.endHour,
            windows: windows, scheduleType: span == nil ? .single : .continuousSpan, span: span,
            routine: weekdays.isEmpty ? nil : NativeAgendaRoutine(weekdays: Array(Set(weekdays)).sorted(), focus: []),
            scheduleID: existing?.scheduleID ?? id, createdAtMilliseconds: existing?.createdAtMilliseconds ?? stamp,
            updatedAtMilliseconds: max(stamp, (existing?.updatedAtMilliseconds ?? 0) + 1))
        try validate(plan)
        return plan
    }

    static func validate(_ plan: NativeAgendaPlan) throws {
        let calendar = try calendar(plan.place)
        guard !plan.id.isEmpty, !plan.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              plan.title.utf16.count <= 80, !plan.windows.isEmpty, plan.windows.count <= 60,
              !plan.title.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              Set(plan.windows.map(\.id)).count == plan.windows.count,
              plan.createdAtMilliseconds > 0, plan.updatedAtMilliseconds >= plan.createdAtMilliseconds,
              plan.place.latitude.isFinite, plan.place.longitude.isFinite,
              abs(plan.place.latitude) <= 90, abs(plan.place.longitude) <= 180 else {
            throw NativePlanWriteError.invalid("This plan has an invalid name, place, or schedule.")
        }
        for window in plan.windows {
            guard let start = date(window.targetDate, hour: window.startHour, calendar: calendar),
                  let end = date(window.targetDate, hour: window.endHour, calendar: calendar), end > start else {
                throw NativePlanWriteError.invalid("A plan time does not exist in this place’s time zone. Choose another time.")
            }
        }
        guard let first = plan.windows.first, first.targetDate == plan.targetDate,
              first.startHour == plan.startHour, first.endHour == plan.endHour else {
            throw NativePlanWriteError.invalid("This plan’s schedule is inconsistent.")
        }
        switch plan.scheduleType {
        case .single:
            guard plan.windows.count == 1, plan.span == nil else { throw NativePlanWriteError.damagedStore }
        case .discrete:
            guard plan.windows.count >= 2, plan.span == nil, plan.routine == nil else { throw NativePlanWriteError.damagedStore }
        case .continuousSpan:
            guard let span = plan.span, plan.routine == nil,
                  let start = date(span.startDate, hour: span.startHour, calendar: calendar),
                  let end = date(span.endDate, hour: span.endHour, calendar: calendar), end > start,
                  span.startDate == first.targetDate, span.startHour == first.startHour,
                  span.endDate == plan.windows.last?.targetDate, span.endHour == plan.windows.last?.endHour,
                  (calendar.dateComponents([.day], from: start, to: end).day ?? 99) <= 13 else {
                throw NativePlanWriteError.damagedStore
            }
        }
        if let routine = plan.routine {
            guard !routine.weekdays.isEmpty, routine.weekdays.allSatisfy({ (0...6).contains($0) }), plan.windows.count == 1 else {
                throw NativePlanWriteError.invalid("Choose valid days for this weekly routine.")
            }
        }
    }

    static func item(_ plan: NativeAgendaPlan, now: Date = Date()) -> NativeAgendaItem {
        if let next = NativeAgenda(capturedAt: now, plans: [plan]).items(from: now).first { return next }
        return NativeAgendaItem(id: plan.id, planID: plan.id, title: plan.title, label: plan.label, place: plan.place,
            kind: plan.span == nil ? (plan.routine == nil ? .scheduledWindow : .weeklyRoutine) : .continuousSpan,
            startDate: plan.span?.startDate ?? plan.targetDate, startHour: plan.span?.startHour ?? plan.startHour,
            endDate: plan.span?.endDate ?? plan.targetDate, endHour: plan.span?.endHour ?? plan.endHour, isInProgress: false)
    }
}

extension NativeAgendaPlace {
    init(preview: NativePreviewPlace, timezone: String? = nil) {
        self.init(id: preview.id, legacyIDType: nil, name: preview.name, admin1: "", country: "",
            countryCode: preview.countryCode ?? "", latitude: preview.latitude, longitude: preview.longitude,
            alias: nil, timezone: timezone ?? preview.timezone, followsCurrentLocation: nil)
    }
    var previewPlace: NativePreviewPlace {
        .init(id: id, name: name, latitude: latitude, longitude: longitude, timezone: timezone, countryCode: countryCode.isEmpty ? nil : countryCode)
    }
}

@MainActor
final class NativePlanLibrary: ObservableObject {
    static let shared = NativePlanLibrary(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Nearcast/NativePlans", isDirectory: true))
    @Published private(set) var archive = NativePlanArchive()
    @Published private(set) var error: String?
    private let disk: NativePlanDiskStore
    var plans: [NativeAgendaPlan] { archive.plans }

    init(directory: URL) {
        disk = .init(directory: directory)
        do { archive = try disk.load() } catch { self.error = error.localizedDescription }
    }

    func save(_ plan: NativeAgendaPlan, replacing original: NativeAgendaPlan?) throws {
        guard error == nil else { throw NativePlanWriteError.damagedStore }
        var next = archive
        if let original {
            guard next.plans.first(where: { $0.id == original.id }) == original else { throw NativePlanWriteError.conflict }
        } else if next.plans.contains(where: { $0.id == plan.id }) || next.importedIDs.values.contains(plan.id) {
            // An imported-copy mapping survives deletion as a tombstone. A
            // later create using that local ID would silently revive an
            // earlier schedule, so it must use a genuinely new native ID.
            throw NativePlanWriteError.conflict
        }
        next.plans.removeAll { $0.id == plan.id }
        next.plans.append(plan)
        try disk.save(next)
        archive = next // Publish success only after durable write.
    }

    func delete(_ plan: NativeAgendaPlan) throws {
        guard error == nil else { throw NativePlanWriteError.damagedStore }
        guard archive.plans.first(where: { $0.id == plan.id }) == plan else { throw NativePlanWriteError.conflict }
        var next = archive
        next.plans.removeAll { $0.id == plan.id }
        let protectedMappings: Int
        if let receipt = next.legacyHandoff,
           let sourcePlanIDHashes = receipt.sourcePlanIDHashes {
            let sourceSet = Set(sourcePlanIDHashes)
            protectedMappings = next.importedIDs.reduce(into: 0) { count, entry in
                guard entry.value == plan.id,
                      sourceSet.contains(Self.legacyIdentifierDigest(entry.key)) else { return }
                count += 1
            }
        } else {
            // A receipt written by an earlier native build did not retain
            // source membership fingerprints. Do not guess that an arbitrary
            // historical mapping belongs to it; its summary stays conservative.
            protectedMappings = 0
        }
        if protectedMappings > 0, let receipt = next.legacyHandoff {
            // Keep the one-time source receipt but update only its aggregate
            // local availability. The mapping itself stays as the tombstone
            // that prevents a replay from restoring the deleted schedule.
            next.legacyHandoff = NativePlanLegacyHandoffReceipt(
                version: receipt.version,
                sourceScope: receipt.sourceScope,
                sourceDigest: receipt.sourceDigest,
                sourceCapturedAtMilliseconds: receipt.sourceCapturedAtMilliseconds,
                sourcePlanCount: receipt.sourcePlanCount,
                availableNativeCopyCount: max(0, receipt.availableNativeCopyCount - protectedMappings),
                protectedDeletedCount: min(receipt.sourcePlanCount, receipt.protectedDeletedCount + protectedMappings),
                sourcePlanIDHashes: receipt.sourcePlanIDHashes
            )
        }
        try disk.save(next)
        archive = next // importedIDs survives deletion, preventing resurrection.
    }

    /// Resolves a bounded Plans route without treating route data as an
    /// authority to recreate a deleted plan or touch any earlier watch.
    ///
    /// `importedIDs` intentionally remains after deletion as a tombstone, so
    /// an old notification or deep link cannot silently bring a native copy
    /// back. In that case this returns `.unavailable` and the UI can explain
    /// that the plan is not on this iPhone.
    func resolveRoutePlan(id routeID: String?) -> NativePlanRouteMatch {
        guard let routeID = Self.normalizedRoutePlanID(routeID) else {
            return .unavailable
        }
        // Look through the earlier-ID mapping first. A safely preserved
        // imported ID can equal its local ID, but it is still an imported
        // copy—not permission to revive or edit an earlier notification watch.
        if let copiedID = archive.importedIDs[routeID],
           let copied = archive.plans.first(where: { $0.id == copiedID }) {
            return .importedCopy(copied)
        }
        if let local = archive.plans.first(where: { $0.id == routeID }) {
            return .local(local)
        }
        return .unavailable
    }

    func isImportedCopy(_ plan: NativeAgendaPlan) -> Bool {
        archive.importedIDs.values.contains(plan.id)
    }

    private static func normalizedRoutePlanID(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf16.count <= 160,
              !trimmed.unicodeScalars.contains(where: { scalar in
                  CharacterSet.controlCharacters.contains(scalar)
              }) else {
            return nil
        }
        return trimmed
    }

    /// The read-only legacy Agenda is only eligible to move after the person
    /// explicitly asks for this handoff in native Plans. The operation is
    /// all-or-nothing: any plan that cannot be represented natively aborts the
    /// whole copy, so an incomplete handoff cannot look like a real one.
    ///
    /// This copies schedule records only. It never reads, writes, enables,
    /// renews, or transfers notification, Watch, widget, or Live Activity
    /// delivery. A durable receipt closes this handoff after the first success;
    /// newer legacy projections are intentionally ignored rather than replayed
    /// into native-owned Plans.
    @discardableResult
    func handoffVerifiedLegacyAgenda(
        _ agenda: NativeAgenda?,
        sourceScope: NativeLegacySourceScope = .remoteProduction
    ) throws -> NativePlanLegacyHandoffResult {
        guard error == nil else { throw NativePlanWriteError.damagedStore }
        guard let agenda else { throw NativePlanLegacyHandoffError.unavailable }
        if let receipt = archive.legacyHandoff {
            guard receipt.sourceScope == sourceScope else {
                // One global local library deliberately never treats a Plan
                // copy from another compatibility host as this scope's
                // verified import. A later app version can offer an explicit
                // user-directed archive migration; P0 must fail closed.
                throw NativePlanLegacyHandoffError.unavailable
            }
            return .alreadyCompleted(receipt)
        }

        let sourceDigest = try Self.legacyAgendaDigest(agenda)
        var next = archive
        // Reserve both plan and schedule identities. Even though this phase
        // never registers delivery, keeping those namespaces disjoint avoids
        // making a copied record look like it owns an earlier/native schedule.
        var occupiedIDs = Set(next.plans.map(\.id))
        occupiedIDs.formUnion(next.plans.map(\.scheduleID))
        var copies: [(sourceID: String, plan: NativeAgendaPlan)] = []

        // Validate every new copy before mutating or writing anything. A
        // source ID already represented in `importedIDs` is deliberately a
        // completed import or tombstone, never an invitation to resurrect it.
        for source in agenda.plans where next.importedIDs[source.id] == nil {
            let identifier = Self.nativeIdentifier(for: source.id, occupied: occupiedIDs)
            occupiedIDs.insert(identifier)
            let scheduleIdentifier = Self.nativeScheduleIdentifier(occupied: occupiedIDs)
            occupiedIDs.insert(scheduleIdentifier)
            let copy = NativeAgendaPlan(
                id: identifier,
                title: source.title,
                label: source.label,
                original: source.original,
                answer: source.answer,
                place: source.place,
                targetDate: source.targetDate,
                startHour: source.startHour,
                endHour: source.endHour,
                windows: source.windows,
                scheduleType: source.scheduleType,
                span: source.span,
                routine: source.routine,
                scheduleID: scheduleIdentifier,
                createdAtMilliseconds: source.createdAtMilliseconds,
                updatedAtMilliseconds: source.updatedAtMilliseconds
            )
            do {
                try NativePlanSchedule.validate(copy)
            } catch {
                throw NativePlanLegacyHandoffError.unsafePlan
            }
            copies.append((source.id, copy))
        }

        guard next.plans.count + copies.count <= 60 else {
            throw NativePlanWriteError.invalid("Native Plans can hold up to 60 plans. Nothing was imported.")
        }

        for copy in copies {
            next.plans.append(copy.plan)
            next.importedIDs[copy.sourceID] = copy.plan.id
        }

        let availableNativeCopyCount = agenda.plans.reduce(into: 0) { total, source in
            guard let identifier = next.importedIDs[source.id],
                  next.plans.contains(where: { $0.id == identifier }) else { return }
            total += 1
        }
        let protectedDeletedCount = agenda.plans.reduce(into: 0) { total, source in
            guard let identifier = next.importedIDs[source.id],
                  !next.plans.contains(where: { $0.id == identifier }) else { return }
            total += 1
        }
        let receipt = NativePlanLegacyHandoffReceipt(
            version: 1,
            sourceScope: sourceScope,
            sourceDigest: sourceDigest,
            sourceCapturedAtMilliseconds: Int64((agenda.capturedAt.timeIntervalSince1970 * 1_000).rounded()),
            sourcePlanCount: agenda.plans.count,
            availableNativeCopyCount: availableNativeCopyCount,
            protectedDeletedCount: protectedDeletedCount,
            sourcePlanIDHashes: agenda.plans.map { Self.legacyIdentifierDigest($0.id) }.sorted()
        )
        next.legacyHandoff = receipt
        try disk.save(next)
        archive = next // Publish only after the complete handoff is durable.
        return .imported(receipt)
    }

    func legacyHandoffState(
        for agenda: NativeAgenda?,
        sourceScope: NativeLegacySourceScope = .remoteProduction
    ) -> NativePlanLegacyHandoffState {
        if let receipt = archive.legacyHandoff, receipt.sourceScope == sourceScope {
            return .completed(receipt)
        }
        // A completed handoff from an older unscoped build or different
        // compatibility source is not an authority to import/reuse records in
        // this source scope.
        if archive.legacyHandoff != nil { return .unavailable }
        guard let agenda else { return .unavailable }
        return agenda.plans.isEmpty ? .empty : .ready(planCount: agenda.plans.count)
    }

    private static func nativeIdentifier(for sourceID: String, occupied: Set<String>) -> String {
        // The `native-` namespace belongs to locally created records. Do not
        // preserve an earlier ID in that namespace even if it currently looks
        // free: retaining it could make an old schedule look native-owned.
        let lowercased = sourceID.lowercased()
        if !lowercased.hasPrefix("native-"),
           !occupied.contains(sourceID) {
            return sourceID
        }
        var candidate: String
        repeat {
            candidate = "native-import-\(UUID().uuidString.lowercased())"
        } while occupied.contains(candidate)
        return candidate
    }

    private static func nativeScheduleIdentifier(occupied: Set<String>) -> String {
        var candidate: String
        repeat {
            candidate = "native-schedule-\(UUID().uuidString.lowercased())"
        } while occupied.contains(candidate)
        return candidate
    }

    /// Shared provenance check for P0 notification-intent staging. This is
    /// intentionally derived from the exact agenda receipt used for the
    /// explicit native schedule handoff, not merely from historical IDs.
    nonisolated static func legacyHandoffMatches(
        _ receipt: NativePlanLegacyHandoffReceipt,
        agenda: NativeAgenda,
        sourceScope: NativeLegacySourceScope
    ) -> Bool {
        guard receipt.version == 1,
              receipt.sourceScope == sourceScope,
              receipt.sourcePlanCount == agenda.plans.count,
              receipt.sourceCapturedAtMilliseconds == Int64((agenda.capturedAt.timeIntervalSince1970 * 1_000).rounded()),
              receipt.availableNativeCopyCount >= 0,
              receipt.protectedDeletedCount >= 0,
              receipt.availableNativeCopyCount + receipt.protectedDeletedCount == receipt.sourcePlanCount,
              let sourcePlanIDHashes = receipt.sourcePlanIDHashes,
              sourcePlanIDHashes == agenda.plans.map({ legacyIdentifierDigest($0.id) }).sorted(),
              let expectedDigest = try? legacyAgendaDigest(agenda) else {
            return false
        }
        return receipt.sourceDigest == expectedDigest
    }

    nonisolated static func legacyAgendaDigest(_ agenda: NativeAgenda) throws -> String {
        struct Source: Codable {
            let capturedAtMilliseconds: Int64
            let plans: [NativeAgendaPlan]
        }
        let source = Source(
            capturedAtMilliseconds: Int64((agenda.capturedAt.timeIntervalSince1970 * 1_000).rounded()),
            plans: agenda.plans
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(source)
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated static func legacyIdentifierDigest(_ identifier: String) -> String {
        SHA256.hash(data: Data(identifier.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
