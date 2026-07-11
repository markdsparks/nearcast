import ActivityKit
import Foundation

struct NearcastStormActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var etaMinutes: Int
        var status: String
        var detail: String
        var confidence: String
        var updatedAt: Date?
        var updatedAtEpoch: Double?
        var arrivalAtEpoch: Double?
        var expiresAtEpoch: Double?
        var motionDegrees: Double?
        var confidenceValue: Double?
        var severity: Int?
        var rainChance: Int?
        var geometryQuality: String?
    }

    var placeName: String
    var stormName: String
    var deepLink: URL?
}
