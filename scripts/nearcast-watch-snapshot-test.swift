import Foundation

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL  \(message)\n".utf8))
        exit(1)
    }
    print("PASS  \(message)")
}

let encoder = JSONEncoder()
let decoder = JSONDecoder()
let now = Date().timeIntervalSince1970

var legacyObject = try JSONSerialization.jsonObject(with: encoder.encode(NearcastWidgetSnapshot.fallback)) as! [String: Any]
legacyObject["version"] = 4
legacyObject["savedAt"] = now - 10 * 60
legacyObject["placeName"] = "Maryville, Illinois"
legacyObject["temperature"] = 74
legacyObject["feelsLike"] = 76
legacyObject["condition"] = "Cloudy"
legacyObject["watchStatus"] = "Looks good"
legacyObject["watchDetail"] = "Dry through 2p"
legacyObject.removeValue(forKey: "isAvailable")
legacyObject.removeValue(forKey: "weatherSavedAt")
legacyObject.removeValue(forKey: "planSavedAt")
legacyObject.removeValue(forKey: "planId")
legacyObject.removeValue(forKey: "planAvailable")

let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)
let legacy = try decoder.decode(NearcastWidgetSnapshot.self, from: legacyData)
require(legacy.hasWeatherData, "V4 snapshots remain readable and available")
require(legacy.weatherAge >= 9 * 60, "V4 savedAt remains the weather freshness fallback")
require(!legacy.hasPlan, "V4 snapshots without plan fields do not invent a plan")

var splitFreshness = legacy
splitFreshness.version = 5
splitFreshness.isAvailable = true
splitFreshness.savedAt = now
splitFreshness.weatherSavedAt = now
splitFreshness.planTitle = "Ballgame"
splitFreshness.planLabel = "Keep an eye on it"
splitFreshness.planDetail = "Rain becomes possible after 3p"
splitFreshness.planAvailable = true
splitFreshness.planSavedAt = now - 3 * 60 * 60
require(splitFreshness.weatherAge < 10, "direct weather freshness is current")
require(splitFreshness.planAge > 2 * 60 * 60, "plan freshness can age independently")

let unavailable = NearcastWidgetSnapshot.fallback
require(!unavailable.hasWeatherData, "runtime fallback is explicitly unavailable")
require(unavailable.temperature == 0 && unavailable.rainChance == 0, "runtime fallback contains no believable fake weather")
require(!unavailable.hasPlan && unavailable.planSavedTime == 0, "runtime fallback contains no fake plan")

print("PASS  Nearcast Watch snapshot trust contract")
