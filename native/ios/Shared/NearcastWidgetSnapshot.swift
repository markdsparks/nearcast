import Foundation

let nearcastWidgetSuiteName = "group.app.nearcast.ios"
let nearcastWidgetSnapshotKey = "nearcast.widget.snapshot.v1"
let nearcastWidgetPlaceKey = "nearcast.widget.place.v1"
let nearcastWidgetKind = "NearcastWidget"

struct NearcastWidgetSnapshot: Codable {
    var version: Int
    var savedAt: TimeInterval
    var placeName: String
    var temperature: Int
    var feelsLike: Int
    var high: Int?
    var low: Int?
    var condition: String
    var conditionCode: Int
    var isDay: Bool
    var rainChance: Int
    var wind: Int
    var windUnit: String
    var windDirection: Int?
    var windLabel: String?
    var uv: Int
    var nowLabel: String
    var nowValue: String
    var nextLabel: String
    var nextValue: String
    var laterLabel: String
    var laterValue: String
    var planTitle: String?
    var planLabel: String?
    var planDetail: String?
    var planPlace: String?
    var planTone: String?
    var watchStatus: String?
    var watchDetail: String?
    var watchTone: String?
    var timeline: [NearcastWidgetHour]?
    var sunriseAt: TimeInterval?
    var sunsetAt: TimeInterval?
    var isAvailable: Bool?
    var weatherSavedAt: TimeInterval?
    var planSavedAt: TimeInterval?
    var planId: String?
    var planAvailable: Bool?
}

struct NearcastWidgetHour: Codable, Identifiable {
    var id: String { "\(offsetHours)-\(timeLabel)" }
    var offsetHours: Int
    var timeLabel: String
    var temperature: Int?
    var feelsLike: Int?
    var rainChance: Int?
    var wind: Int?
    var windGust: Int?
    var windDirection: Int?
    var uv: Int?
    var conditionCode: Int?
    var isDay: Bool?
    var startsAt: TimeInterval?
}

struct NearcastWidgetPlace: Codable {
    var id: String?
    var name: String
    var displayName: String?
    var admin1: String?
    var country: String?
    var countryCode: String?
    var latitude: Double
    var longitude: Double
}

extension NearcastWidgetSnapshot {
    static let fallback = NearcastWidgetSnapshot(
        version: 5,
        savedAt: 0,
        placeName: "Nearcast",
        temperature: 0,
        feelsLike: 0,
        high: nil,
        low: nil,
        condition: "Open Nearcast on iPhone",
        conditionCode: 0,
        isDay: true,
        rainChance: 0,
        wind: 0,
        windUnit: "mph",
        windDirection: nil,
        windLabel: nil,
        uv: 0,
        nowLabel: "Now",
        nowValue: "No weather loaded",
        nextLabel: "Next",
        nextValue: "Open the iPhone app",
        laterLabel: "Later",
        laterValue: "Your weather will appear here",
        planTitle: nil,
        planLabel: nil,
        planDetail: nil,
        planPlace: nil,
        planTone: nil,
        watchStatus: nil,
        watchDetail: nil,
        watchTone: "neutral",
        timeline: nil,
        sunriseAt: nil,
        sunsetAt: nil,
        isAvailable: false,
        weatherSavedAt: nil,
        planSavedAt: nil,
        planId: nil,
        planAvailable: false
    )

    static func current() -> NearcastWidgetSnapshot {
        stored() ?? fallback
    }

    static func stored() -> NearcastWidgetSnapshot? {
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetSnapshotKey),
            let snapshot = try? JSONDecoder().decode(NearcastWidgetSnapshot.self, from: data)
        else {
            return nil
        }
        return snapshot
    }

    var hasWeatherData: Bool {
        isAvailable ?? (savedAt > 0 && placeName != "Nearcast")
    }

    var hasPlan: Bool {
        if let planAvailable { return planAvailable }
        return [planTitle, planLabel, planDetail].contains { value in
            guard let value else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    var weatherSavedTime: TimeInterval {
        weatherSavedAt ?? savedAt
    }

    var planSavedTime: TimeInterval {
        planSavedAt ?? (hasPlan ? savedAt : 0)
    }

    var weatherAge: TimeInterval {
        guard weatherSavedTime > 0 else { return .infinity }
        return max(0, Date().timeIntervalSince1970 - weatherSavedTime)
    }

    var planAge: TimeInterval {
        guard planSavedTime > 0 else { return .infinity }
        return max(0, Date().timeIntervalSince1970 - planSavedTime)
    }

    var age: TimeInterval {
        weatherAge
    }
}

extension NearcastWidgetPlace {
    var displayLabel: String {
        let trimmed = (displayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? name : trimmed
    }

    static func stored() -> NearcastWidgetPlace? {
        guard
            let defaults = UserDefaults(suiteName: nearcastWidgetSuiteName),
            let data = defaults.data(forKey: nearcastWidgetPlaceKey),
            let place = try? JSONDecoder().decode(NearcastWidgetPlace.self, from: data)
        else {
            return nil
        }
        return place
    }
}

enum NearcastWidgetSnapshotStore {
    static let suiteName = nearcastWidgetSuiteName
    static let snapshotKey = nearcastWidgetSnapshotKey
    static let placeKey = nearcastWidgetPlaceKey
    static let widgetKind = nearcastWidgetKind

    static func save(_ snapshot: NearcastWidgetSnapshot) {
        guard let defaults = UserDefaults(suiteName: suiteName),
              let data = try? JSONEncoder().encode(snapshot) else {
            return
        }
        defaults.set(data, forKey: snapshotKey)
    }

    static func saveSnapshotData(_ data: Data) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            return
        }
        defaults.set(data, forKey: snapshotKey)
    }

    static func savePlaceData(_ data: Data) {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            return
        }
        defaults.set(data, forKey: placeKey)
    }
}
