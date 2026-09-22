import Foundation

/// The native enrollment namespace is separate from earlier web enrollments.
/// No migration, inheritance of consent, or automatic retirement is implied.
struct NativePlanNotificationArchive: Codable, Equatable {
    var version = 1
    var enabledIDs: Set<String> = []
    var subscriptionID: String?
    var channel: NativePlanNotificationChannel?
    var acknowledgedFingerprint: Data?
    var expiresAt: Date?
}

struct NativePlanNotificationChannel: Codable, Equatable {
    let kind: String
    let token: String
    let environment: String
    let bundleId: String

    var isValid: Bool {
        kind == "ios-apns" && ["production", "development"].contains(environment) &&
        ["app.nearcast.ios", "app.nearcast.ios.dev"].contains(bundleId) &&
        token.range(of: "^[a-f0-9]{32,200}$", options: .regularExpression) != nil && token.count.isMultiple(of: 2)
    }
}

struct NativePlanNotificationTarget: Codable, Equatable {
    struct Place: Codable, Equatable {
        let name: String
        let admin1: String
        let country: String
        let countryCode: String
        let latitude: Double
        let longitude: Double
    }
    struct Window: Codable, Equatable {
        let id: String
        let targetDate: String
        let startHour: Double
        let endHour: Double
    }
    struct Routine: Codable, Equatable {
        let weekdays: [Int]
    }
    let id: String
    let title: String
    let targetDate: String
    let startHour: Double
    let endHour: Double
    let scheduleType: String
    let windows: [Window]
    let place: Place
    let timezone: String
    let routine: Routine?

    static func hasUpcomingWindow(_ plan: NativeAgendaPlan, now: Date = Date()) -> Bool {
        plan.routine != nil || !remainingWindows(plan, now: now).isEmpty
    }

    private static func remainingWindows(_ plan: NativeAgendaPlan, now: Date) -> [NativeAgendaWindow] {
        guard let calendar = try? NativePlanSchedule.calendar(plan.place) else { return [] }
        return plan.windows.filter {
            guard let end = NativePlanSchedule.date($0.targetDate, hour: $0.endHour, calendar: calendar) else { return false }
            return end > now
        }
    }

    init(plan: NativeAgendaPlan, now: Date = Date()) throws {
        try NativePlanSchedule.validate(plan)
        let calendar = try NativePlanSchedule.calendar(plan.place)
        let activeWindows = plan.routine == nil ? Self.remainingWindows(plan, now: now) : plan.windows
        guard let first = activeWindows.first else { throw NativePlanWriteError.invalid("This plan has ended.") }
        id = plan.id
        title = plan.title
        timezone = calendar.timeZone.identifier
        targetDate = first.targetDate
        startHour = first.startHour
        endHour = first.endHour
        scheduleType = plan.scheduleType.rawValue
        // The durable schedule is used here, not an AI sentence or weather
        // verdict. The server computes its own evidence and change baseline.
        windows = activeWindows.map { .init(id: $0.id, targetDate: $0.targetDate, startHour: $0.startHour, endHour: $0.endHour) }
        place = .init(name: plan.place.name, admin1: plan.place.admin1, country: plan.place.country,
            countryCode: plan.place.countryCode, latitude: plan.place.latitude, longitude: plan.place.longitude)
        routine = plan.routine.map { .init(weekdays: $0.weekdays) }
    }
}

struct NativePlanNotificationRequest: Encodable {
    struct Client: Encodable {
        let owner = "native-v1"
        let appVersion: String
        let locale: String
        let timezone: String
        let unit: String
    }
    let provider = "nearcast-native-plan-notification-client"
    let version = 1
    let nativeChannel: NativePlanNotificationChannel
    let plans: [NativePlanNotificationTarget]
    let places: [String] = []
    let client: Client

    static func fingerprint(plans: [NativePlanNotificationTarget], metric: Bool) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(Fingerprint(plans: plans, metric: metric))
    }
    private struct Fingerprint: Encodable { let plans: [NativePlanNotificationTarget]; let metric: Bool }
}

struct NativePlanNotificationReceipt: Decodable {
    let ok: Bool
    let state: String?
    let subscriptionId: String?
    let planCount: Int?
    let expiresAt: String?
    let owner: String?

    func confirms(targetCount: Int) -> Bool {
        ok && owner == "native-v1" && state == "stored" &&
        subscriptionId?.isEmpty == false && planCount == targetCount
    }
}

struct NativePlanNotificationDiskStore {
    let file: URL

    func load() throws -> NativePlanNotificationArchive {
        guard FileManager.default.fileExists(atPath: file.path) else { return .init() }
        let data = try Data(contentsOf: file)
        guard data.count <= 500_000 else { throw NativePlanWriteError.damagedStore }
        let value = try JSONDecoder().decode(NativePlanNotificationArchive.self, from: data)
        guard value.version == 1, value.enabledIDs.count <= 60,
              value.enabledIDs.allSatisfy({ !$0.isEmpty && $0.count <= 96 }),
              value.channel == nil || value.channel?.isValid == true else { throw NativePlanWriteError.damagedStore }
        return value
    }

    func save(_ value: NativePlanNotificationArchive) throws {
        // Refuse to silently overwrite unreadable consent/subscription data.
        _ = try load()
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(value)
        #if os(iOS)
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: file, options: .atomic)
        #endif
    }
}
