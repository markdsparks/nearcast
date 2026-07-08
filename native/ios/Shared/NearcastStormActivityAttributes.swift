import ActivityKit
import Foundation

struct NearcastStormActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var etaMinutes: Int
        var status: String
        var detail: String
        var confidence: String
        var updatedAt: Date
    }

    var placeName: String
    var stormName: String
    var deepLink: URL?
}

