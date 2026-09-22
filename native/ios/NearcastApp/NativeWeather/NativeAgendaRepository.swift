import Foundation

/// A verified, read-only projection of the legacy plan memory.
///
/// This deliberately has no persistence, notification, widget, Watch, or
/// plan-editing API. Before native Plans owns those behaviors, an unavailable
/// or invalid source must remain unavailable rather than becoming an empty
/// agenda that could be mistaken for an authoritative inventory.
enum NativeAgendaRepositoryError: Error, LocalizedError, Equatable, Sendable {
    case payloadTooLarge
    case malformedPayload
    case unsupportedExport
    case unsupportedPlanSchema
    case invalidPlan
    case duplicatePlanID

    var errorDescription: String? {
        switch self {
        case .payloadTooLarge:
            return "The plan agenda export is too large to verify."
        case .malformedPayload:
            return "The plan agenda export is incomplete or malformed."
        case .unsupportedExport:
            return "This plan agenda export needs a newer Nearcast reader."
        case .unsupportedPlanSchema:
            return "This plan format needs a newer Nearcast reader."
        case .invalidPlan:
            return "A saved plan could not be verified safely."
        case .duplicatePlanID:
            return "Saved plans must have distinct identifiers."
        }
    }
}

/// Preserves whether an existing legacy place identifier was numeric. That
/// distinction matters when an eventual native route joins a saved place; it
/// must never coerce an ID into a different identity.
enum NativeAgendaLegacyIDType: String, Codable, Equatable, Hashable, Sendable {
    case number
}

struct NativeAgendaPlace: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let legacyIDType: NativeAgendaLegacyIDType?
    let name: String
    let admin1: String
    let country: String
    let countryCode: String
    let latitude: Double
    let longitude: Double
    let alias: String?
    let timezone: String?
    let followsCurrentLocation: Bool?

    var displayName: String {
        if let alias, !alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return alias }
        return name
    }
}

struct NativeAgendaWindow: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let targetDate: String
    let startHour: Double
    let endHour: Double
    let label: String
}

struct NativeAgendaSpan: Codable, Equatable, Hashable, Sendable {
    let startDate: String
    let startHour: Double
    let endDate: String
    let endHour: Double
}

struct NativeAgendaRoutine: Codable, Equatable, Hashable, Sendable {
    enum Focus: String, Codable, CaseIterable, Hashable, Sendable {
        case rain
        case wind
        case heat
    }

    let weekdays: [Int] // Sunday = 0, matching the persisted legacy record.
    let focus: [Focus]
}

enum NativeAgendaScheduleType: String, Codable, CaseIterable, Hashable, Sendable {
    case single
    case discrete
    case continuousSpan = "continuous_span"
}

/// A plan's stable schedule only. Weather verdicts, material changes, receipt
/// state, and notification selections intentionally live outside this model
/// until the native client can prove equivalent ownership of those systems.
struct NativeAgendaPlan: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let title: String
    let label: String
    let original: String
    let answer: String
    let place: NativeAgendaPlace
    let targetDate: String
    let startHour: Double
    let endHour: Double
    let windows: [NativeAgendaWindow]
    let scheduleType: NativeAgendaScheduleType
    let span: NativeAgendaSpan?
    let routine: NativeAgendaRoutine?
    let scheduleID: String
    let createdAtMilliseconds: Int64
    let updatedAtMilliseconds: Int64
}

enum NativeAgendaItemKind: String, Codable, CaseIterable, Hashable, Sendable {
    case scheduledWindow
    case weeklyRoutine
    case continuousSpan
}

/// A derived presentation occurrence. It is calculated in the plan place's
/// timezone and is never written back to plan memory (notably for routines).
struct NativeAgendaItem: Codable, Equatable, Hashable, Identifiable, Sendable {
    let id: String
    let planID: String
    let title: String
    let label: String
    let place: NativeAgendaPlace
    let kind: NativeAgendaItemKind
    let startDate: String
    let startHour: Double
    let endDate: String
    let endHour: Double
    let isInProgress: Bool
}

/// An imported agenda is only usable after its explicit legacy export has
/// passed validation. A valid, explicit empty export remains distinguishable
/// from an unavailable/corrupt source because the latter throws on decode.
struct NativeAgenda: Equatable, Sendable {
    let capturedAt: Date
    let plans: [NativeAgendaPlan]

    /// Returns active first, then chronological items intersecting the next
    /// seven local civil days. Plans without a verified IANA timezone are not
    /// placed on a time-sensitive agenda; callers should keep their legacy
    /// compatibility route available rather than guessing with the device zone.
    func items(from referenceDate: Date = Date(), horizonDays: Int = 7) -> [NativeAgendaItem] {
        guard (0...7).contains(horizonDays) else { return [] }
        return plans.flatMap { plan in
            Self.items(for: plan, referenceDate: referenceDate, horizonDays: horizonDays)
        }.sorted {
            if $0.isInProgress != $1.isInProgress { return $0.isInProgress && !$1.isInProgress }
            if $0.startDate != $1.startDate { return $0.startDate < $1.startDate }
            if $0.startHour != $1.startHour { return $0.startHour < $1.startHour }
            if $0.endDate != $1.endDate { return $0.endDate < $1.endDate }
            return $0.id < $1.id
        }
    }

    private static func items(for plan: NativeAgendaPlan, referenceDate: Date, horizonDays: Int) -> [NativeAgendaItem] {
        guard let timezoneID = plan.place.timezone, let timezone = TimeZone(identifier: timezoneID) else { return [] }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timezone
        guard let today = civilDate(referenceDate, calendar: calendar),
              let finalDate = addDays(today, horizonDays, calendar: calendar) else { return [] }

        switch plan.scheduleType {
        case .continuousSpan:
            guard let span = plan.span,
                  span.startDate <= finalDate,
                  span.endDate >= today else { return [] }
            let value = item(plan: plan, kind: .continuousSpan, identifier: "span", startDate: span.startDate,
                             startHour: span.startHour, endDate: span.endDate, endHour: span.endHour,
                             referenceDate: referenceDate, calendar: calendar)
            // A span can intersect today by calendar date but already be over
            // by clock time. Treat it exactly like a completed single or
            // discrete window; Agenda should never keep a finished trip in
            // the user's "In progress" or "Today" section until midnight.
            return isPast(value, referenceDate: referenceDate, calendar: calendar) ? [] : [value]

        case .single, .discrete:
            if let routine = plan.routine {
                return routineItems(plan: plan, routine: routine, today: today, finalDate: finalDate,
                                    referenceDate: referenceDate, calendar: calendar)
            }
            return plan.windows.compactMap { window in
                guard window.targetDate >= today, window.targetDate <= finalDate else { return nil }
                let value = item(plan: plan, kind: .scheduledWindow, identifier: window.id,
                                 startDate: window.targetDate, startHour: window.startHour,
                                 endDate: window.targetDate, endHour: window.endHour,
                                 referenceDate: referenceDate, calendar: calendar)
                return isPast(value, referenceDate: referenceDate, calendar: calendar) ? nil : value
            }
        }
    }

    private static func routineItems(plan: NativeAgendaPlan, routine: NativeAgendaRoutine, today: String,
                                     finalDate: String, referenceDate: Date, calendar: Calendar) -> [NativeAgendaItem] {
        guard let template = plan.windows.first else { return [] }
        var results: [NativeAgendaItem] = []
        var date = today
        while date <= finalDate {
            guard let dateValue = dateFromCivil(date, calendar: calendar) else { return [] }
            // Calendar weekday is 1...7 (Sunday...Saturday); persisted plan
            // weekdays are 0...6.
            let weekday = calendar.component(.weekday, from: dateValue) - 1
            if routine.weekdays.contains(weekday) {
                let value = item(plan: plan, kind: .weeklyRoutine, identifier: "routine-\(date)",
                                 startDate: date, startHour: template.startHour,
                                 endDate: date, endHour: template.endHour,
                                 referenceDate: referenceDate, calendar: calendar)
                if !isPast(value, referenceDate: referenceDate, calendar: calendar) { results.append(value) }
            }
            guard let next = addDays(date, 1, calendar: calendar) else { return [] }
            date = next
        }
        return results
    }

    private static func item(plan: NativeAgendaPlan, kind: NativeAgendaItemKind, identifier: String,
                             startDate: String, startHour: Double, endDate: String, endHour: Double,
                             referenceDate: Date, calendar: Calendar) -> NativeAgendaItem {
        let startsAt = timestamp(date: startDate, hour: startHour, calendar: calendar)
        let endsAt = timestamp(date: endDate, hour: endHour, calendar: calendar)
        return NativeAgendaItem(id: "\(plan.id)::\(identifier)", planID: plan.id, title: plan.title,
                                label: plan.label, place: plan.place, kind: kind,
                                startDate: startDate, startHour: startHour, endDate: endDate, endHour: endHour,
                                isInProgress: startsAt.map { $0 <= referenceDate } == true &&
                                    endsAt.map { $0 >= referenceDate } == true)
    }

    private static func isPast(_ item: NativeAgendaItem, referenceDate: Date, calendar: Calendar) -> Bool {
        guard let end = timestamp(date: item.endDate, hour: item.endHour, calendar: calendar) else { return true }
        return end < referenceDate
    }

    private static func civilDate(_ date: Date, calendar: Calendar) -> String? {
        let values = calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = values.year, let month = values.month, let day = values.day else { return nil }
        return String(format: "%04d-%02d-%02d", locale: Locale(identifier: "en_US_POSIX"), year, month, day)
    }

    fileprivate static func dateFromCivil(_ value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        var components = DateComponents()
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let date = calendar.date(from: components), civilDate(date, calendar: calendar) == value else { return nil }
        return date
    }

    fileprivate static func addDays(_ value: String, _ count: Int, calendar: Calendar) -> String? {
        guard let date = dateFromCivil(value, calendar: calendar),
              let next = calendar.date(byAdding: .day, value: count, to: date) else { return nil }
        return civilDate(next, calendar: calendar)
    }

    private static func timestamp(date: String, hour: Double, calendar: Calendar) -> Date? {
        guard let day = dateFromCivil(date, calendar: calendar) else { return nil }
        let seconds = Int((hour * 3600).rounded())
        if seconds == 86400 { return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: day)) }
        var parts = calendar.dateComponents([.year, .month, .day], from: day)
        parts.hour = seconds / 3600; parts.minute = (seconds % 3600) / 60; parts.second = seconds % 60
        guard let value = calendar.date(from: parts),
              calendar.component(.hour, from: value) == parts.hour,
              calendar.component(.minute, from: value) == parts.minute else { return nil }
        return value
    }
}

/// Decodes only a verified, explicitly supplied legacy export. It never reads
/// WKWebView local storage, UserDefaults, notification preference keys, or any
/// watch registration state.
struct NativeAgendaRepository: Sendable {
    static let exportVersion = 1
    static let planSchemaVersion = 2
    static let maximumPayloadBytes = 128 * 1_024
    static let maximumPlans = 60
    static let maximumWindowsPerPlan = 60

    init() {}

    func decode(_ payload: Data) throws -> NativeAgenda {
        guard !payload.isEmpty, payload.count <= Self.maximumPayloadBytes else {
            throw NativeAgendaRepositoryError.payloadTooLarge
        }
        try Self.validateJSONShape(payload)
        let export: Export
        do {
            export = try JSONDecoder().decode(Export.self, from: payload)
        } catch {
            throw NativeAgendaRepositoryError.malformedPayload
        }
        guard export.version == Self.exportVersion, export.owner == "legacy", export.hydration == "ready" else {
            throw NativeAgendaRepositoryError.unsupportedExport
        }
        guard let capturedAt = Self.parseTimestamp(export.capturedAt), export.plans.count <= Self.maximumPlans else {
            throw NativeAgendaRepositoryError.malformedPayload
        }

        var planIDs = Set<String>()
        let plans = try export.plans.map { wire in
            let plan = try Self.plan(from: wire)
            guard planIDs.insert(plan.id).inserted else { throw NativeAgendaRepositoryError.duplicatePlanID }
            return plan
        }
        return NativeAgenda(capturedAt: capturedAt, plans: plans)
    }

    private struct Export: Decodable {
        let version: Int
        let owner: String
        let hydration: String
        let capturedAt: String
        let plans: [WirePlan]
    }

    private struct WirePlan: Decodable {
        let id: String
        let kind: String
        let title: String
        let label: String
        let original: String
        let answer: String
        let place: WirePlace
        let targetDate: String
        let startHour: Double
        let endHour: Double
        let windows: [WireWindow]
        let scheduleType: String
        let span: WireSpan?
        let routine: WireRoutine?
        let schemaVersion: Int
        let scheduleID: String
        let createdAt: Double
        let updatedAt: Double

        enum CodingKeys: String, CodingKey {
            case id, kind, title, label, original, answer, place, targetDate, startHour, endHour, windows, scheduleType, span, routine, schemaVersion, scheduleID = "scheduleId", createdAt, updatedAt
        }
    }

    private struct WirePlace: Decodable {
        let id: WireIdentifier
        let name: String
        let admin1: String
        let country: String
        let countryCode: String
        let latitude: Double
        let longitude: Double
        let alias: String?
        let timezone: String?
        let followsCurrentLocation: Bool?
    }

    private enum WireIdentifier: Decodable {
        case string(String)
        case number(Int64)

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let text = try? container.decode(String.self) {
                self = .string(text)
                return
            }
            self = .number(try container.decode(Int64.self))
        }
    }

    private struct WireWindow: Decodable {
        let id: String
        let targetDate: String
        let startHour: Double
        let endHour: Double
        let label: String
    }

    private struct WireSpan: Decodable {
        let startDate: String
        let startHour: Double
        let endDate: String
        let endHour: Double
    }

    private struct WireRoutine: Decodable {
        let frequency: String
        let weekdays: [Int]
        let weekday: Int
        let focus: [String]
    }

    private static func plan(from wire: WirePlan) throws -> NativeAgendaPlan {
        guard wire.kind == "plan" else { throw NativeAgendaRepositoryError.invalidPlan }
        guard wire.schemaVersion == planSchemaVersion else { throw NativeAgendaRepositoryError.unsupportedPlanSchema }
        guard validText(wire.id, maximum: 160, required: true),
              validText(wire.title, maximum: 80, required: true),
              validText(wire.label, maximum: 80, required: true),
              validText(wire.original, maximum: 220), validText(wire.answer, maximum: 280),
              validText(wire.scheduleID, maximum: 160, required: true), validCivilDate(wire.targetDate),
              validHour(wire.startHour, isStart: true), validHour(wire.endHour, isStart: false),
              wire.endHour > wire.startHour,
              wire.windows.count > 0, wire.windows.count <= maximumWindowsPerPlan,
              validLegacyTimestamp(wire.createdAt), validLegacyTimestamp(wire.updatedAt) else {
            throw NativeAgendaRepositoryError.invalidPlan
        }

        let place = try place(from: wire.place)
        let windows = try wire.windows.map(window(from:))
        guard Set(windows.map(\.id)).count == windows.count else { throw NativeAgendaRepositoryError.invalidPlan }
        guard let first = windows.first, first.targetDate == wire.targetDate,
              first.startHour == wire.startHour, first.endHour == wire.endHour else {
            throw NativeAgendaRepositoryError.invalidPlan
        }
        guard let scheduleType = NativeAgendaScheduleType(rawValue: wire.scheduleType) else {
            throw NativeAgendaRepositoryError.invalidPlan
        }

        let span = try wire.span.map(span(from:))
        let routine = try wire.routine.map(routine(from:))
        switch scheduleType {
        case .single:
            guard span == nil, windows.count == 1 else { throw NativeAgendaRepositoryError.invalidPlan }
        case .discrete:
            guard span == nil, routine == nil, windows.count >= 2 else { throw NativeAgendaRepositoryError.invalidPlan }
        case .continuousSpan:
            guard let span, routine == nil,
                  span.startDate == wire.targetDate, span.startHour == wire.startHour,
                  expectedSpanWindows(span) == windows else { throw NativeAgendaRepositoryError.invalidPlan }
        }

        return NativeAgendaPlan(id: wire.id, title: wire.title, label: wire.label, original: wire.original,
                                answer: wire.answer, place: place, targetDate: wire.targetDate,
                                startHour: wire.startHour, endHour: wire.endHour, windows: windows,
                                scheduleType: scheduleType, span: span, routine: routine,
                                scheduleID: wire.scheduleID, createdAtMilliseconds: Int64(wire.createdAt.rounded()),
                                updatedAtMilliseconds: Int64(wire.updatedAt.rounded()))
    }

    private static func place(from wire: WirePlace) throws -> NativeAgendaPlace {
        let identifier: (String, NativeAgendaLegacyIDType?)
        switch wire.id {
        case .string(let value):
            guard validText(value, maximum: 160, required: true) else { throw NativeAgendaRepositoryError.invalidPlan }
            identifier = (value, nil)
        case .number(let value):
            guard value > 0, value <= 9_007_199_254_740_991 else { throw NativeAgendaRepositoryError.invalidPlan }
            identifier = (String(value), .number)
        }
        guard validText(wire.name, maximum: 180, required: true), validText(wire.admin1, maximum: 180),
              validText(wire.country, maximum: 180), validCountryCode(wire.countryCode),
              wire.latitude.isFinite, wire.longitude.isFinite, abs(wire.latitude) <= 90, abs(wire.longitude) <= 180,
              wire.alias.map({ validText($0, maximum: 36) }) ?? true,
              wire.timezone.map({ $0.utf16.count <= 100 && TimeZone(identifier: $0) != nil }) ?? true else {
            throw NativeAgendaRepositoryError.invalidPlan
        }
        return NativeAgendaPlace(id: identifier.0, legacyIDType: identifier.1, name: wire.name,
                                 admin1: wire.admin1, country: wire.country, countryCode: wire.countryCode,
                                 latitude: wire.latitude, longitude: wire.longitude, alias: wire.alias,
                                 timezone: wire.timezone, followsCurrentLocation: wire.followsCurrentLocation)
    }

    private static func window(from wire: WireWindow) throws -> NativeAgendaWindow {
        guard validText(wire.id, maximum: 160, required: true), validCivilDate(wire.targetDate),
              validHour(wire.startHour, isStart: true), validHour(wire.endHour, isStart: false),
              wire.endHour > wire.startHour, validText(wire.label, maximum: 80, required: true) else {
            throw NativeAgendaRepositoryError.invalidPlan
        }
        return NativeAgendaWindow(id: wire.id, targetDate: wire.targetDate, startHour: wire.startHour,
                                  endHour: wire.endHour, label: wire.label)
    }

    private static func span(from wire: WireSpan) throws -> NativeAgendaSpan {
        guard validCivilDate(wire.startDate), validCivilDate(wire.endDate), wire.startDate <= wire.endDate,
              validHour(wire.startHour, isStart: true), validHour(wire.endHour, isStart: false),
              (wire.startDate < wire.endDate || wire.endHour > wire.startHour),
              let dayCount = daysBetween(wire.startDate, wire.endDate), dayCount <= 13 else {
            throw NativeAgendaRepositoryError.invalidPlan
        }
        return NativeAgendaSpan(startDate: wire.startDate, startHour: wire.startHour,
                                endDate: wire.endDate, endHour: wire.endHour)
    }

    private static func routine(from wire: WireRoutine) throws -> NativeAgendaRoutine {
        let decodedFocus = wire.focus.map(NativeAgendaRoutine.Focus.init(rawValue:))
        guard wire.frequency == "weekly", !wire.weekdays.isEmpty, wire.weekdays.count <= 7,
              wire.weekdays == Array(Set(wire.weekdays)).sorted(), wire.weekday == wire.weekdays.first,
              wire.weekdays.allSatisfy({ (0...6).contains($0) }),
              wire.focus.count <= NativeAgendaRoutine.Focus.allCases.count,
              Set(wire.focus).count == wire.focus.count,
              decodedFocus.allSatisfy({ $0 != nil }) else {
            throw NativeAgendaRepositoryError.invalidPlan
        }
        return NativeAgendaRoutine(weekdays: wire.weekdays, focus: decodedFocus.compactMap { $0 })
    }

    private static func expectedSpanWindows(_ span: NativeAgendaSpan) -> [NativeAgendaWindow] {
        guard let calendar = utcCalendar(), let count = daysBetween(span.startDate, span.endDate), count <= 13 else { return [] }
        return (0...count).compactMap { index in
            guard let date = NativeAgenda.addDays(span.startDate, index, calendar: calendar) else { return nil }
            let first = index == 0
            let last = index == count
            return NativeAgendaWindow(id: "span-\(date)", targetDate: date,
                                      startHour: first ? span.startHour : 0,
                                      endHour: last ? span.endHour : 24,
                                      label: first ? "Starts" : (last ? "Ends" : "All day"))
        }
    }

    private static func validText(_ value: String, maximum: Int, required: Bool = false) -> Bool {
        value.utf16.count <= maximum && (!required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) &&
            !value.unicodeScalars.contains(where: { (0...31).contains($0.value) || (127...159).contains($0.value) })
    }

    private static func validCountryCode(_ value: String) -> Bool {
        value.isEmpty || (value.utf8.count == 2 && value.unicodeScalars.allSatisfy { (65...90).contains($0.value) })
    }

    private static func validCivilDate(_ value: String) -> Bool {
        guard value.utf8.count == 10, value.split(separator: "-").count == 3,
              let calendar = utcCalendar(), NativeAgenda.dateFromCivil(value, calendar: calendar) != nil else { return false }
        return value.unicodeScalars.enumerated().allSatisfy { index, scalar in
            [4, 7].contains(index) ? scalar.value == 45 : (48...57).contains(scalar.value)
        }
    }

    private static func validHour(_ value: Double, isStart: Bool) -> Bool {
        guard value.isFinite, value >= 0, value <= 24 else { return false }
        // Persisted legacy values can contain fractional windows. Preserve those
        // exactly, but reject arbitrary floating-point noise beyond one second.
        guard abs(value * 3600 - (value * 3600).rounded()) < 0.000_001 else { return false }
        return isStart ? value < 24 : value > 0
    }

    private static func validLegacyTimestamp(_ value: Double) -> Bool {
        value.isFinite && value > 0 && value.rounded() == value && value <= 9_007_199_254_740_991
    }

    private static func utcCalendar() -> Calendar? {
        guard let timezone = TimeZone(secondsFromGMT: 0) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timezone
        return calendar
    }

    private static func daysBetween(_ start: String, _ end: String) -> Int? {
        guard let calendar = utcCalendar(), let startDate = NativeAgenda.dateFromCivil(start, calendar: calendar),
              let endDate = NativeAgenda.dateFromCivil(end, calendar: calendar) else { return nil }
        return calendar.dateComponents([.day], from: startDate, to: endDate).day
    }

    private static func parseTimestamp(_ value: String) -> Date? {
        guard validText(value, maximum: 40, required: true) else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    /// Reject unknown fields before decoding. A future writer must intentionally
    /// bump the export/schema version instead of being silently interpreted by an
    /// older native reader.
    private static func validateJSONShape(_ data: Data) throws {
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        } catch {
            throw NativeAgendaRepositoryError.malformedPayload
        }
        guard let export = object as? [String: Any] else { throw NativeAgendaRepositoryError.malformedPayload }
        try exactKeys(export, ["version", "owner", "hydration", "capturedAt", "plans"])
        guard let plans = export["plans"] as? [[String: Any]], plans.count <= maximumPlans else {
            throw NativeAgendaRepositoryError.malformedPayload
        }
        for plan in plans {
            try exactKeys(plan, ["id", "kind", "title", "label", "original", "answer", "place", "targetDate", "startHour", "endHour", "windows", "scheduleType", "span", "routine", "schemaVersion", "scheduleId", "createdAt", "updatedAt"])
            guard let place = plan["place"] as? [String: Any] else { throw NativeAgendaRepositoryError.malformedPayload }
            let placeRequired = ["id", "name", "admin1", "country", "countryCode", "latitude", "longitude"]
            let placeOptional = ["alias", "timezone", "followsCurrentLocation"]
            try keys(place, required: placeRequired, optional: placeOptional)
            guard let windows = plan["windows"] as? [[String: Any]],
                  !windows.isEmpty, windows.count <= maximumWindowsPerPlan else {
                throw NativeAgendaRepositoryError.malformedPayload
            }
            for window in windows {
                try exactKeys(window, ["id", "targetDate", "startHour", "endHour", "label"])
            }
            if !(plan["span"] is NSNull) {
                guard let span = plan["span"] as? [String: Any] else { throw NativeAgendaRepositoryError.malformedPayload }
                try exactKeys(span, ["startDate", "startHour", "endDate", "endHour"])
            }
            if !(plan["routine"] is NSNull) {
                guard let routine = plan["routine"] as? [String: Any] else { throw NativeAgendaRepositoryError.malformedPayload }
                try exactKeys(routine, ["frequency", "weekdays", "weekday", "focus"])
            }
        }
    }

    private static func exactKeys(_ value: [String: Any], _ required: [String]) throws {
        try keys(value, required: required, optional: [])
    }

    private static func keys(_ value: [String: Any], required: [String], optional: [String]) throws {
        let actual = Set(value.keys)
        let requiredSet = Set(required)
        let allowed = requiredSet.union(optional)
        guard requiredSet.isSubset(of: actual), actual.isSubset(of: allowed) else {
            throw NativeAgendaRepositoryError.malformedPayload
        }
    }
}
