import Foundation

@main
struct NativeLivingSkyTests {
    static func at(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) { precondition(condition(), message) }
    static func forecast(current: NativeForecastPoint?, zone: String = "America/Chicago",
                         days: [NativeForecastDay] = [], hours: [NativeForecastPoint] = []) -> NativeWeatherForecast {
        NativeWeatherForecast(generatedAt: current?.date ?? at("2026-09-19T17:00:00Z"), timezoneID: zone,
            metric: false, current: current, hours: hours, quarterHours: [], days: days)
    }

    static func main() {
        let noon = at("2026-09-19T17:00:00Z")
        let rise = at("2026-09-19T11:45:00Z")
        let set = at("2026-09-20T00:00:00Z")
        let day = NativeForecastDay(date: at("2026-09-19T05:00:00Z"), sunrise: rise, sunset: set)
        let codeFamilies: [(NativeLivingSkyScene.Family, [Int])] = [
            (.clear, [0, 1]), (.brokenClouds, [2]), (.overcast, [3]), (.fog, [45, 48]),
            (.rain, [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]),
            (.snow, [71, 73, 75, 77, 85, 86])
        ]
        for (family, codes) in codeFamilies {
            for code in codes {
                let point = NativeForecastPoint(date: noon, weatherCode: code, isDay: true)
                let scene = NativeLivingSkyScene.resolve(forecast: forecast(current: point, days: [day]), now: noon)
                expect(scene.family == family, "Condition \(code) maps to \(family)")
                expect(scene.source == .currentForecast && scene.lightPhase == .day, "Known present conditions retain honest forecast provenance")
            }
        }

        let possibility = NativeForecastPoint(date: noon, rainProbability: 100, precipitationMM: 1,
            weatherCode: 2, isDay: true, thunderPossible: true, rawWeatherCode: 95)
        let possibilities = NativeLivingSkyScene.resolve(forecast: forecast(current: possibility, days: [day]), now: noon)
        expect(possibilities.family == .brokenClouds, "Probability, amount, thunder possibility, and raw code never overrule the normalized condition")
        expect(possibilities.cloudCoverage == 0.45, "Default cloud coverage follows the known family")
        let cloudy = NativeForecastPoint(date: noon, weatherCode: 2, cloudCover: 80)
        expect(NativeLivingSkyScene.resolve(forecast: forecast(current: cloudy, days: [day]), now: noon).cloudCoverage == 0.8,
               "Valid provider cloud cover refines composition, not condition wording")

        let staleNight = NativeForecastPoint(date: rise.addingTimeInterval(-4 * 3600), weatherCode: 0, isDay: false)
        let cached = forecast(current: staleNight, days: [day])
        let afterRise = NativeLivingSkyScene.resolve(forecast: cached, now: rise.addingTimeInterval(60))
        expect(afterRise.isDaylight == true && afterRise.lightPhase == .dawn, "Actual solar events override stale isDay after sunrise")
        expect(afterRise.family == .unknown && afterRise.source == .unavailable, "Expired weather does not pretend to be a fresh clear scene")
        let afterSet = NativeLivingSkyScene.resolve(forecast: forecast(current: NativeForecastPoint(date: noon, weatherCode: 0, isDay: true), days: [day]), now: set.addingTimeInterval(60))
        expect(afterSet.isDaylight == false && afterSet.lightPhase == .dusk, "Solar sunset wins over cached daytime")
        expect(NativeLivingSkyScene.resolve(forecast: cached, now: rise).isDaylight == true, "Exact sunrise is daylight")
        expect(NativeLivingSkyScene.resolve(forecast: cached, now: set).isDaylight == false, "Exact sunset is night even during dusk palette")
        expect(NativeLivingSkyScene.resolve(forecast: cached, now: rise.addingTimeInterval(-31 * 60)).lightPhase == .night, "Night remains night before dawn transition")
        expect(NativeLivingSkyScene.resolve(forecast: cached, now: rise.addingTimeInterval(31 * 60)).lightPhase == .day, "Dawn settles to day")
        expect(NativeLivingSkyScene.resolve(forecast: cached, now: set.addingTimeInterval(31 * 60)).lightPhase == .night, "Dusk settles to night")

        let noData = NativeLivingSkyScene.resolve(forecast: nil, now: noon)
        expect(noData.family == .unknown && noData.lightPhase == .unknown && noData.isDaylight == nil,
               "No data is neutral, not confidently sunny or based on device clock")
        for code in [nil, -1, 4, 100] as [Int?] {
            let unknown = NativeForecastPoint(date: noon, weatherCode: code, isDay: false)
            let scene = NativeLivingSkyScene.resolve(forecast: forecast(current: unknown), now: noon)
            expect(scene.family == .unknown && scene.source == .unavailable && scene.lightPhase == .night,
                   "Unknown condition at known night never becomes sunny")
        }
        let expired = NativeForecastPoint(date: noon.addingTimeInterval(-90 * 60), weatherCode: 61, isDay: false)
        expect(NativeLivingSkyScene.resolve(forecast: forecast(current: expired), now: noon).lightPhase == .unknown,
               "Expired isDay has no authority when solar data is unavailable")
        let future = NativeForecastPoint(date: noon.addingTimeInterval(3600), weatherCode: 61, isDay: true)
        expect(NativeLivingSkyScene.resolve(forecast: forecast(current: future), now: noon).family == .unknown,
               "An unrelated future reading cannot become current rain")

        let futureDate = at("2026-09-20T17:00:00Z")
        let selected = NativeForecastPoint(date: futureDate, weatherCode: 73, isDay: true)
        let current = NativeForecastPoint(date: noon, weatherCode: 0, isDay: true)
        let both = forecast(current: current, days: [day], hours: [selected])
        let selectedScene = NativeLivingSkyScene.resolve(forecast: both, point: selected, context: .forecast(futureDate), now: noon)
        expect(selectedScene.family == .snow && selectedScene.source == .selectedForecast && selectedScene.referenceDate == futureDate,
               "Explicit selection uses future weather with future provenance")
        let currentScene = NativeLivingSkyScene.resolve(forecast: both, point: selected, now: noon)
        expect(currentScene.family == .clear && currentScene.referenceDate == noon, "A selected/passing hour never changes the current scene")
        expect(NativeLivingSkyScene.resolve(forecast: forecast(current: nil), point: current, now: noon).family == .unknown,
               "A loaded forecast without current weather cannot substitute an arbitrary list point")
        expect(NativeLivingSkyScene.resolve(forecast: both, context: .forecast(futureDate), now: noon) == selectedScene,
               "Exact hourly evidence may resolve without an explicit point")
        expect(NativeLivingSkyScene.resolve(forecast: both, context: .forecast(futureDate.addingTimeInterval(3600)), now: noon).family == .unknown,
               "Missing selected-hour evidence does not borrow weather beyond its hour")

        let berlinDate = at("2026-09-19T17:45:00Z")
        let berlin = forecast(current: NativeForecastPoint(date: berlinDate, weatherCode: 2, isDay: true), zone: "Europe/Berlin", days: [
            NativeForecastDay(date: at("2026-09-18T22:00:00Z"), sunrise: at("2026-09-19T05:00:00Z"), sunset: at("2026-09-19T17:00:00Z"))
        ])
        let foreign = NativeLivingSkyScene.resolve(forecast: berlin, now: berlinDate)
        expect(foreign.lightPhase == .night && foreign.isDaylight == false, "Selected-place solar day overrides device time and provider isDay")
        let futureBerlinDay = NativeForecastDay(date: at("2026-09-19T22:00:00Z"), weatherCode: 63,
            sunrise: at("2026-09-20T05:02:00Z"), sunset: at("2026-09-20T16:58:00Z"))
        let berlinFuture = forecast(current: nil, zone: "Europe/Berlin", days: [futureBerlinDay])
        let representativeNoon = berlinFuture.calendar.date(bySettingHour: 12, minute: 0, second: 0, of: futureBerlinDay.date)!
        let dailyPoint = NativeForecastPoint(date: representativeNoon, weatherCode: futureBerlinDay.weatherCode)
        let dailyScene = NativeLivingSkyScene.resolve(forecast: berlinFuture, point: dailyPoint,
            context: .forecast(representativeNoon), now: noon)
        expect(representativeNoon == at("2026-09-20T10:00:00Z") && dailyScene.lightPhase == .day && dailyScene.family == .rain,
               "A deliberate daily overview uses the selected place's representative local noon, not its midnight aggregate timestamp")
        let polarStart = at("2026-12-19T00:00:00Z")
        let polarHours = (0..<24).map { NativeForecastPoint(date: polarStart.addingTimeInterval(Double($0) * 3600), weatherCode: 3, isDay: false) }
        let polar = forecast(current: polarHours[12], zone: "UTC", days: [NativeForecastDay(date: polarStart)], hours: polarHours)
        expect(NativeLivingSkyScene.resolve(forecast: polar, now: polarHours[12].date).lightPhase == .night,
               "Established continuous polar night stays night at local noon")

        let deterministic = NativeLivingSkyScene.resolve(forecast: both, now: noon)
        expect(deterministic == NativeLivingSkyScene.resolve(forecast: both, now: noon), "Resolver is deterministic and has no animation/random/network state")

        let phases: [NativeLivingSkyScene.LightPhase] = [.dawn, .day, .dusk, .night, .unknown]
        let artworkMatrix: [(NativeLivingSkyScene.Family, [NativeLivingSkyScene.Artwork])] = [
            (.clear, [.openAir, .openAir, .openAir, .openAir, .neutral]),
            (.brokenClouds, [.twilightClouds, .sunClouds, .twilightClouds, .nightClouds, .neutral]),
            (.overcast, [.overcast, .overcast, .overcast, .overcast, .overcast]),
            (.rain, [.overcast, .overcast, .overcast, .overcast, .overcast]),
            (.snow, [.overcast, .overcast, .overcast, .overcast, .overcast]),
            (.fog, [.overcast, .overcast, .overcast, .overcast, .overcast]),
            (.unknown, [.neutral, .neutral, .neutral, .neutral, .neutral])
        ]
        for (family, expectedArtworks) in artworkMatrix {
            for (phase, expectedArtwork) in zip(phases, expectedArtworks) {
                let scene = NativeLivingSkyScene(family: family, lightPhase: phase, isDaylight: nil,
                    cloudCoverage: 0.5, context: .current, source: .currentForecast,
                    referenceDate: noon, weatherDate: noon)
                expect(scene.artwork == expectedArtwork, "Artwork for \(family) / \(phase) is \(expectedArtwork)")
                if [.snow, .fog, .overcast, .unknown].contains(family) {
                    expect(scene.artwork != .rainClouds && scene.artwork != .nightClouds,
                           "Non-rain / obscured conditions cannot borrow baked rain or stars")
                }
                if phase == .night || phase == .unknown {
                    expect(scene.artwork != .sunClouds && scene.artwork != .rainClouds,
                           "Night or unknown solar phase never borrows a daytime plate")
                }
            }
        }

        // Values independently captured from the existing sky.js solar helper;
        // retaining its geometry avoids another conflicting sun calculation.
        let sanDiegoNoon = at("2026-09-19T20:00:00Z")
        let indianapolisLowSun = at("2026-09-19T22:30:00Z")
        let indianapolisNearSet = at("2026-09-19T23:30:00Z")
        expect(abs(NativeSkySolarGeometry.elevation(at: sanDiegoNoon, latitude: 32.7157, longitude: -117.1611)! - 58.68129208802303) < 0.00000001,
               "San Diego geometry matches existing sky.js")
        expect(abs(NativeSkySolarGeometry.elevation(at: indianapolisLowSun, latitude: 39.7684, longitude: -86.1581)! - 14.11490300132185) < 0.00000001,
               "Indianapolis low sun matches existing sky.js outside the old 30-minute dusk bucket")
        expect(abs(NativeSkySolarGeometry.elevation(at: indianapolisNearSet, latitude: 39.7684, longitude: -86.1581)! - 2.628427515167772) < 0.00000001,
               "Near-horizon geometry remains continuous")
        let sanDiegoPoint = NativeForecastPoint(date: sanDiegoNoon, weatherCode: 0, isDay: true, cloudCover: 2,
            shortwaveRadiation: 820, directRadiation: 680, diffuseRadiation: 140)
        let sanDiego = NativeLivingSkyScene.resolve(forecast: forecast(current: sanDiegoPoint, zone: "America/Los_Angeles"),
            now: sanDiegoNoon, latitude: 32.7157, longitude: -117.1611)
        expect(sanDiego.family == .clear && sanDiego.artwork == .openAir && sanDiego.illumination.sunStrength > 0.7,
               "Fresh clear San Diego-style daytime earns an unmistakable sun-led field")
        expect(sanDiego.illumination.warmth < 0.05 && sanDiego.illumination.cloudIllumination > 0.6,
               "High sun is luminous without a sunset wash")

        let indyPoint = NativeForecastPoint(date: indianapolisLowSun, rainProbability: 45, weatherCode: 1,
            isDay: true, thunderPossible: true, cloudCover: 40, lowCloudCover: 0, midCloudCover: 47,
            highCloudCover: 3, shortwaveRadiation: 190, directRadiation: 150, diffuseRadiation: 40)
        let indyForecast = forecast(current: indyPoint, zone: "America/Indiana/Indianapolis")
        let indy = NativeLivingSkyScene.resolve(forecast: indyForecast, now: indianapolisLowSun,
            latitude: 39.7684, longitude: -86.1581)
        expect(indy.family == .brokenClouds && indy.cloudCoverage == 0.47 && indy.artwork == .sunClouds,
               "Real midlevel clouds add a broken composition even under a mostly-clear condition code")
        expect(indy.illumination.warmth > 0.3 && indy.illumination.sunStrength > 0.2,
               "Low afternoon sun gets continuous warmth and illumination instead of storm darkness")
        let noRisk = NativeForecastPoint(date: indianapolisLowSun, weatherCode: 1, isDay: true,
            cloudCover: 40, lowCloudCover: 0, midCloudCover: 47, highCloudCover: 3,
            shortwaveRadiation: 190, directRadiation: 150, diffuseRadiation: 40)
        let noRiskScene = NativeLivingSkyScene.resolve(forecast: forecast(current: noRisk), now: indianapolisLowSun,
            latitude: 39.7684, longitude: -86.1581)
        expect(indy.illumination == noRiskScene.illumination && indy.family == noRiskScene.family,
               "Rain/thunder possibility does not alter the actual light or invent a storm")
        let dimNoon = NativeForecastPoint(date: sanDiegoNoon, weatherCode: 1, isDay: true,
            cloudCover: 30, shortwaveRadiation: 8, directRadiation: 5, diffuseRadiation: 3)
        let dimNoonScene = NativeLivingSkyScene.resolve(forecast: forecast(current: dimNoon), now: sanDiegoNoon,
            latitude: 32.7157, longitude: -117.1611)
        expect(dimNoonScene.illumination.sunStrength < 0.1 && dimNoonScene.illumination.warmth == 0,
               "Low measured noon radiation softens sunlight but never invents golden hour")

        for code in [3, 45, 48, 61, 71, 73, 75, 95] {
            let dense = NativeForecastPoint(date: sanDiegoNoon, weatherCode: code, isDay: true,
                cloudCover: 90, shortwaveRadiation: 400, directRadiation: 300, diffuseRadiation: 100)
            let scene = NativeLivingSkyScene.resolve(forecast: forecast(current: dense), now: sanDiegoNoon,
                latitude: 32.7157, longitude: -117.1611)
            expect(scene.illumination.sunStrength == 0 && scene.illumination.directness == 0,
                   "Overcast/fog/snow/rain/storm code \(code) never adds a visible sun")
            expect(scene.illumination.cloudIllumination > 0.3, "Daytime dense weather still receives diffuse sky light")
        }
        let sanDiegoNight = at("2026-09-20T06:00:00Z")
        let incorrectDayBit = NativeForecastPoint(date: sanDiegoNight, weatherCode: 0, isDay: true,
            shortwaveRadiation: 500, directRadiation: 400)
        let nightGeometry = NativeLivingSkyScene.resolve(forecast: forecast(current: incorrectDayBit, zone: "Asia/Tokyo"),
            now: sanDiegoNight, latitude: 32.7157, longitude: -117.1611)
        expect(nightGeometry.lightPhase == .night && nightGeometry.isDaylight == false && nightGeometry.illumination.sunStrength == 0,
               "Coordinates/UTC prevent a false sun despite an opposite timezone label and incorrect isDay")
        expect(nightGeometry.illumination.warmth == 0, "Deep night does not inherit warm daytime radiation")
        let eventAuthority = forecast(current: sanDiegoPoint, zone: "America/Los_Angeles", days: [
            NativeForecastDay(date: sanDiegoNoon, sunrise: sanDiegoNoon.addingTimeInterval(1800), sunset: sanDiegoNoon.addingTimeInterval(7200))
        ])
        let eventScene = NativeLivingSkyScene.resolve(forecast: eventAuthority, now: sanDiegoNoon,
            latitude: 32.7157, longitude: -117.1611)
        expect(eventScene.isDaylight == false && eventScene.illumination.sunStrength == 0 && eventScene.illumination.warmth == 0,
               "Forecast solar events remain authoritative even when approximate geometry disagrees")

        let fallbackLight = NativeLivingSkyScene.resolve(forecast: forecast(current: sanDiegoPoint), now: sanDiegoNoon)
        expect(fallbackLight.illumination.solarElevation == nil && fallbackLight.illumination.warmth == 0,
               "Missing coordinates never invent a vivid solar phase")
        let noWeatherLight = NativeLivingSkyScene.resolve(forecast: nil, now: sanDiegoNoon,
            latitude: 32.7157, longitude: -117.1611)
        expect(noWeatherLight.illumination.sunStrength == 0 && noWeatherLight.illumination.warmth == 0,
               "Knowing the sun position does not pretend missing weather is clear")
        let oldSunnyPoint = NativeForecastPoint(date: sanDiegoNoon.addingTimeInterval(-2 * 3600), weatherCode: 0,
            isDay: true, shortwaveRadiation: 900, directRadiation: 850)
        let oldLight = NativeLivingSkyScene.resolve(forecast: forecast(current: oldSunnyPoint, hours: [sanDiegoPoint]), now: sanDiegoNoon,
            latitude: 32.7157, longitude: -117.1611)
        expect(oldLight.illumination.sunStrength == 0 && oldLight.family == .unknown,
               "Fresh auxiliary hourly light cannot revive expired current weather")
        let futureSunDate = sanDiegoNoon.addingTimeInterval(24 * 3600)
        let futureSun = NativeForecastPoint(date: futureSunDate, weatherCode: 0, isDay: false,
            shortwaveRadiation: 820, directRadiation: 680, diffuseRadiation: 140)
        let futureSunScene = NativeLivingSkyScene.resolve(forecast: forecast(current: sanDiegoPoint, hours: [futureSun]),
            context: .forecast(futureSunDate), now: sanDiegoNoon, latitude: 32.7157, longitude: -117.1611)
        expect(futureSunScene.source == .selectedForecast && futureSunScene.isDaylight == true && futureSunScene.illumination.sunStrength > 0.7,
               "An explicit future selection uses that timestamp's actual solar geometry")
        let noCurrentLight = NativeForecastPoint(date: sanDiegoNoon, weatherCode: 1, isDay: true)
        let layeredHour = NativeForecastPoint(date: sanDiegoNoon, weatherCode: 1, isDay: true,
            midCloudCover: 47, shortwaveRadiation: 700, directRadiation: 600, diffuseRadiation: 100)
        let enrichedScene = NativeLivingSkyScene.resolve(forecast: forecast(current: noCurrentLight, hours: [layeredHour]),
            now: sanDiegoNoon, latitude: 32.7157, longitude: -117.1611)
        expect(enrichedScene.family == .brokenClouds && enrichedScene.cloudCoverage == 0.47 && enrichedScene.illumination.directness > 0.8,
               "Already-loaded containing hourly radiation/clouds enrich current without another request")
        let syntheticDaily = NativeForecastPoint(date: futureSunDate, weatherCode: 0)
        let darkNoonHour = NativeForecastPoint(date: futureSunDate, weatherCode: 3, isDay: true,
            cloudCover: 100, lowCloudCover: 100, shortwaveRadiation: 12, directRadiation: 0, diffuseRadiation: 12)
        let dailyWithHours = NativeLivingSkyScene.resolve(forecast: forecast(current: sanDiegoPoint, hours: [darkNoonHour]),
            point: syntheticDaily, context: .forecast(futureSunDate), now: sanDiegoNoon,
            latitude: 32.7157, longitude: -117.1611)
        let dailyWithoutHours = NativeLivingSkyScene.resolve(forecast: forecast(current: sanDiegoPoint),
            point: syntheticDaily, context: .forecast(futureSunDate), now: sanDiegoNoon,
            latitude: 32.7157, longitude: -117.1611)
        expect(dailyWithHours == dailyWithoutHours,
               "Synthetic day summary cannot silently inherit actual noon radiation or cloud layers")
        let selectedActualHour = NativeLivingSkyScene.resolve(forecast: forecast(current: sanDiegoPoint, hours: [darkNoonHour]),
            context: .forecast(futureSunDate), now: sanDiegoNoon, latitude: 32.7157, longitude: -117.1611)
        expect(selectedActualHour.family == .overcast && selectedActualHour.cloudCoverage == 1 && selectedActualHour.illumination.sunStrength == 0,
               "Explicit selected hour naturally uses its own decoded light and cloud evidence")
        let clearWithLayer = NativeForecastPoint(date: sanDiegoNoon, weatherCode: 0, isDay: true, midCloudCover: 47)
        let clearLayerScene = NativeLivingSkyScene.resolve(forecast: forecast(current: clearWithLayer),
            now: sanDiegoNoon, latitude: 32.7157, longitude: -117.1611)
        expect(clearLayerScene.family == .clear && clearLayerScene.artwork == .openAir && clearLayerScene.cloudCoverage == 0.47,
               "Conflicting layers can attenuate clear-code light without reclassifying the normalized condition")

        expect(NativeSkySolarGeometry.elevation(at: sanDiegoNoon, latitude: 91, longitude: 0) == nil
               && NativeSkySolarGeometry.elevation(at: sanDiegoNoon, latitude: 30, longitude: .nan) == nil,
               "Invalid coordinates do not enter solar math")
        let invalidLightPoint = NativeForecastPoint(date: sanDiegoNoon, weatherCode: 0, isDay: true,
            lowCloudCover: -1, midCloudCover: 101, highCloudCover: .nan,
            shortwaveRadiation: .infinity, directRadiation: -10, diffuseRadiation: 2001)
        expect(invalidLightPoint.lowCloudCover == nil && invalidLightPoint.midCloudCover == nil && invalidLightPoint.highCloudCover == nil
               && invalidLightPoint.shortwaveRadiation == nil && invalidLightPoint.directRadiation == nil && invalidLightPoint.diffuseRadiation == nil,
               "Synthetic/native inputs get the same finite physical-range sanitation as decoded inputs")
        let bounded = NativeLivingSkyScene.Illumination(solarElevation: 200, directness: .nan, warmth: 2, sunStrength: -1, cloudIllumination: .infinity)
        expect(bounded.solarElevation == nil && bounded.directness == 0 && bounded.warmth == 1 && bounded.sunStrength == 0 && bounded.cloudIllumination == 0,
               "Renderer illumination inputs remain immutable finite bounded values")
        testNightSky()
        testRain()
        testSnowAndStorm()
        print("PASS Native living sky: condition/phase/artwork semantics, solar and lunar geometry, independent USNO references, lunar orientation, twilight/cloud/horizon attenuation, polar and invalid inputs, selected time, and no-data/stale safeguards")
    }

    static func testRain() {
        let now = at("2026-09-19T17:00:00Z")
        func rain(code: Int = 61, amount: Double? = 0.25,
                  origin: NativeForecastPoint.Origin? = .modeledCurrent,
                  age: Double = 0, direct: Double? = nil, cover: Double? = nil,
                  date: Date? = nil) -> NativeForecastPoint {
            NativeForecastPoint(date: (date ?? now).addingTimeInterval(-age),
                rainProbability: 100, precipitationMM: amount, weatherCode: code,
                isDay: true, thunderPossible: true, rawWeatherCode: 95, cloudCover: cover,
                shortwaveRadiation: direct.map { $0 + 80 }, directRadiation: direct,
                diffuseRadiation: direct.map { _ in 80 }, origin: origin, precipitationIntervalSeconds: 900)
        }
        func scene(_ point: NativeForecastPoint, date: Date? = nil) -> NativeLivingSkyScene {
            .resolve(forecast: forecast(current: point), now: date ?? now,
                latitude: 38.72, longitude: -89.96)
        }
        for (code, amount, expected) in [(51, 0.06, NativeLivingSkyScene.RainStyle.drizzle),
            (61, 0.25, .light), (63, 1.0, .steady), (65, 2.0, .heavy),
            (95, 0.25, .light), (95, 2.0, .heavy)] {
            expect(scene(rain(code: code, amount: amount)).rainStyle == expected,
                "Rain rendering tier follows supported rate; thunder does not automatically mean heavy rain")
        }
        for point in [rain(code: 2), rain(amount: 0), rain(amount: nil),
                      rain(origin: nil), rain(origin: .hourlyForecast), rain(origin: .quarterHourForecast),
                      rain(age: 1800), rain(age: 5400), rain(age: -3600),
                      rain(code: 71), rain(code: 66), rain(code: 56)] {
            expect(scene(point).rainStyle == .none,
                "Chance, raw storms, missing, fallback, expired, snow and freezing evidence cannot animate liquid rain")
        }
        let selected = NativeLivingSkyScene.resolve(forecast: nil, point: rain(), context: .forecast(now), now: now,
            latitude: 38.72, longitude: -89.96)
        expect(selected.family == .rain && selected.rainStyle == .none,
            "An explicitly dated rainy forecast keeps its still without becoming current rain")
        for code in [61, 75, 95] {
            let uncertain = NativeForecastPoint(date: now, rainProbability: 7,
                precipitationMM: 0.2, weatherCode: code, rawWeatherCode: code,
                cloudCover: 100, origin: .modeledCurrent, precipitationIntervalSeconds: 900)
            let uncertainScene = scene(uncertain)
            expect(uncertainScene.family == .overcast && uncertainScene.rainStyle == .none
                && uncertainScene.snowStyle == .none && uncertainScene.stormStyle == .none,
                "Low-confidence modeled precipitation keeps the provider's cloud context without asserting active rain, snow or storms")
            expect(uncertain.weatherCode == code && uncertain.precipitationMM == 0.2,
                "Sky presentation never rewrites underlying precipitation evidence")
        }
        expect(scene(rain()).artwork == .overcast, "Rain never reuses baked-in precipitation artwork")
        expect(scene(rain()).illumination.sunStrength == 0,
            "A rain condition alone never invents direct sunlight")
        let sunShower = scene(rain(direct: 450, cover: 40))
        expect(sunShower.illumination.sunStrength > 0.1 && sunShower.rainStyle == .light,
            "Explicit sunlight and cloud openings can coexist with supported light rain")
        expect(scene(rain(direct: 450, cover: 96)).illumination.sunStrength == 0,
            "Dense cloud suppresses an inconsistent sun break")
        let dusk = at("2026-09-20T00:00:00Z")
        let warm = scene(rain(date: dusk), date: dusk)
        expect(warm.illumination.warmth > 0 && warm.illumination.warmth <= 0.32,
            "Low sun gives rain a restrained warm cloud reflection without inventing a sun disc")
        let night = at("2026-09-20T05:00:00Z")
        let dark = scene(rain(date: night), date: night)
        expect(dark.isDaylight == false && dark.rainStyle == .light && dark.illumination.sunStrength == 0
            && dark.nightSky.starVisibility == 0 && dark.nightSky.moonVisibility == 0,
            "Night rain stays rain without a baked daytime plate, false sunshine or stars")
        print("PASS Native rain scene: shared current decision, rate tiers, exact provenance, freshness, no baked rain, sun showers, dusk and night")
    }

    static func testSnowAndStorm() {
        let now = at("2026-12-19T18:00:00Z")
        func sample(_ code: Int, amount: Double? = 0.05,
                    origin: NativeForecastPoint.Origin? = .modeledCurrent,
                    age: Double = 0, date: Date? = nil) -> NativeForecastPoint {
            NativeForecastPoint(date: (date ?? now).addingTimeInterval(-age),
                temperature: 28, rainProbability: 100, precipitationMM: amount,
                weatherCode: code, isDay: true, thunderPossible: true, rawWeatherCode: 99,
                origin: origin, precipitationIntervalSeconds: 900)
        }
        func scene(_ point: NativeForecastPoint, date: Date? = nil) -> NativeLivingSkyScene {
            .resolve(forecast: forecast(current: point), now: date ?? now,
                latitude: 38.72, longitude: -89.96)
        }
        for (code, style) in [(71, NativeLivingSkyScene.SnowStyle.light), (73, .steady),
                              (75, .heavy), (77, .light), (85, .light), (86, .heavy)] {
            let snow = scene(sample(code))
            expect(snow.family == .snow && snow.snowStyle == style && snow.rainStyle == .none
                && snow.stormStyle == .none && snow.artwork == .overcast,
                "Snow tiers use normalized condition, not an invented snow/water ratio or raw thunder")
            expect(snow.illumination.sunStrength == 0 && snow.nightSky.starVisibility == 0,
                "Snow is diffuse winter light, never a baked clear sky")
        }
        for point in [sample(73, amount: nil), sample(73, amount: 0), sample(73, amount: 0.001),
                      sample(73, origin: nil), sample(73, origin: .hourlyForecast),
                      sample(73, origin: .quarterHourForecast), sample(73, age: 1800),
                      sample(73, age: 5400), sample(73, age: -301), sample(2),
                      sample(56), sample(57), sample(66), sample(67), sample(61), sample(95)] {
            expect(scene(point).snowStyle == .none,
                "Cold, chance, raw snow/storms, freezing rain, old and incomplete evidence cannot animate snow")
        }
        for code in [95, 96, 99] {
            let dryStorm = scene(sample(code, amount: nil))
            expect(dryStorm.family == .rain && dryStorm.stormStyle == .thunderstorm
                && dryStorm.rainStyle == .none && dryStorm.snowStyle == .none,
                "A supported current storm has cloud depth without inventing rainfall or hail particles")
            expect(scene(sample(code, amount: 0.25)).rainStyle == .light,
                "A thunderstorm does not inflate light rain to heavy")
        }
        for point in [sample(0), sample(2), sample(63), sample(95, origin: nil),
                      sample(95, origin: .hourlyForecast), sample(95, origin: .quarterHourForecast),
                      sample(95, age: 1800), sample(95, age: 5400), sample(95, age: -301)] {
            expect(scene(point).stormStyle == .none,
                "Storm possibility, raw codes, fallback and stale thunder do not earn current storm treatment")
        }
        for code in [73, 95] {
            let selected = NativeLivingSkyScene.resolve(forecast: nil, point: sample(code),
                context: .forecast(now), now: now, latitude: 38.72, longitude: -89.96)
            expect(selected.snowStyle == .none && selected.rainStyle == .none && selected.stormStyle == .none,
                "Selected forecast weather is static and never presented as active current snow/storm")
        }
        let nightDate = at("2026-12-20T05:00:00Z")
        let night = scene(sample(75, date: nightDate), date: nightDate)
        expect(night.isDaylight == false && night.snowStyle == .heavy
            && night.nightSky.moonVisibility == 0 && night.nightSky.starVisibility == 0,
            "Night snow preserves local night without decorative clear-sky objects")
        for family in [NativeLivingSkyScene.Family.clear, .snow, .rain, .unknown] {
            let value = NativeLivingSkyScene(family: family, lightPhase: .day, isDaylight: true,
                cloudCoverage: 0.8, context: .current, source: .currentForecast,
                referenceDate: now, weatherDate: now, rainStyle: .heavy, snowStyle: .heavy, stormStyle: .thunderstorm)
            expect(value.snowStyle == (family == .snow ? .heavy : .none)
                && value.rainStyle == (family == .rain ? .heavy : .none)
                && value.stormStyle == (family == .rain ? .thunderstorm : .none),
                "Even hand-built scenes cannot mix incompatible particle families")
        }
        print("PASS Native snow/storm scenes: honest current evidence, mutually exclusive particles, optical snow tiers, no probability-driven storms, static future and night")
    }

    static func testNightSky() {
        // Independent published upstream fixtures, not values generated by the
        // Swift implementation: github.com/mourner/suncalc/blob/v1.9.0/test.js.
        let upstreamDate = at("2013-03-05T00:00:00Z")
        let upstream = NativeSkyLunarGeometry.position(at: upstreamDate, latitude: 50.5, longitude: 30.5)!
        expect(abs(upstream.illumination - 0.4848068202456373) < 1e-10,
               "Lunar illumination matches the published SunCalc reference")
        expect(abs(upstream.phase - 0.7548368838538762) < 1e-10 && !upstream.waxing,
               "A last-quarter fixture is waning, not a mirrored waxing crescent")
        expect(abs(upstream.brightLimbAngle - 1.6732942678578346) < 1e-10,
               "Bright-limb position angle matches the upstream reference")
        expect(abs(upstream.distance - 364121.37256256194) < 1e-7,
               "Lunar distance is retained for the observer/parallax correction")
        let h = max(0, upstream.geocentricElevation * .pi / 180)
        let upstreamRefraction = 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179))
        expect(abs(upstream.geocentricElevation * .pi / 180 + upstreamRefraction - 0.014551482243892251) < 1e-10,
               "Unrefracted internal altitude reproduces the upstream apparent-altitude fixture")
        expect(upstream.elevation < upstream.geocentricElevation,
               "Topocentric parallax lowers a near-horizon Moon instead of adding refraction")

        // Independent USNO API v4.0.1 reference observations, retrieved 2026-09-19:
        // aa.usno.navy.mil/api/celnav?date=2026-09-20&time=03:00:00&coords=39.7684,-86.1581
        // Moon hc=15.525841°, parallax=0.874258°, illumination=62%, waxing gibbous.
        // Same endpoint, date=2026-09-20&time=10:00:00&coords=-33.8688,151.2093:
        // hc=75.435139°, parallax=0.230003°, illumination=65%, waxing gibbous.
        // The intentionally low-precision orbital model is checked to 1.5° and
        // 3 percentage points, not presented as a navigation-grade ephemeris.
        let nightDate = at("2026-09-20T03:00:00Z")
        let indy = NativeSkyLunarGeometry.position(at: nightDate, latitude: 39.7684, longitude: -86.1581)!
        let sydney = NativeSkyLunarGeometry.position(at: at("2026-09-20T10:00:00Z"), latitude: -33.8688, longitude: 151.2093)!
        expect(abs(indy.geocentricElevation - 15.525841) < 1.5 && abs(indy.elevation - 14.651583) < 1.5,
               "Indianapolis lunar altitude agrees with independent USNO: \(indy.elevation)")
        expect(abs(indy.illumination - 0.62) < 0.03 && indy.waxing,
               "Indianapolis lunar phase agrees with independent USNO")
        expect(abs(sydney.geocentricElevation - 75.435139) < 1.5 && abs(sydney.elevation - 75.205136) < 1.5,
               "Southern-hemisphere lunar altitude agrees with independent USNO: \(sydney.elevation)")
        expect(abs(sydney.illumination - 0.65) < 0.03 && sydney.waxing,
               "The same waxing phase is not reversed in the southern hemisphere")
        // USNO primary phases: api/moon/phases/date?date=2026-09-01&nump=5.
        let phaseFixtures: [(String, Double)] = [
            ("2026-09-04T07:51:00Z", 0.5), // Last quarter
            ("2026-09-11T03:27:00Z", 0),   // New
            ("2026-09-18T20:44:00Z", 0.5), // First quarter
            ("2026-09-26T16:49:00Z", 1)    // Full
        ]
        for (date, fraction) in phaseFixtures {
            let phase = NativeSkyLunarGeometry.position(at: at(date), latitude: 0, longitude: 0)!
            expect(abs(phase.illumination - fraction) < 0.035,
                   "Approximate illuminated fraction follows independent new/quarter/full dates")
        }
        // Independently computed Sun altitude from that API at San Diego,
        // date=2026-09-19&time=20:00:00&coords=32.7157,-117.1611: hc=58.242714°.
        expect(abs(NativeSkySolarGeometry.elevation(at: at("2026-09-19T20:00:00Z"),
            latitude: 32.7157, longitude: -117.1611)! - 58.242714) < 0.6,
            "Existing solar approximation also agrees with independent USNO")

        for position in [upstream, indy, sydney] {
            let zenithAngle = position.brightLimbAngle - position.parallacticAngle
            let rotation = position.rotation * .pi / 180
            expect(abs(cos(rotation) + sin(zenithAngle)) < 1e-10
                && abs(sin(rotation) + cos(zenithAngle)) < 1e-10,
                "Right-lit clockwise mask points toward the Sun in y-down screen coordinates")
        }
        let southernSameTime = NativeSkyLunarGeometry.position(at: nightDate, latitude: -39.7684, longitude: -86.1581)!
        expect(southernSameTime.illumination == indy.illumination && southernSameTime.waxing == indy.waxing
            && abs(southernSameTime.rotation - indy.rotation) > 45,
            "Observer orientation changes across hemispheres without flipping lunar phase")

        func scene(_ date: Date = nightDate, code: Int? = 0, cloud: Double = 0,
                   latitude: Double? = 39.7684, longitude: Double? = -86.1581,
                   weatherAge: TimeInterval = 0) -> NativeLivingSkyScene {
            let point = NativeForecastPoint(date: date.addingTimeInterval(-weatherAge),
                weatherCode: code, isDay: false, cloudCover: cloud)
            return NativeLivingSkyScene.resolve(forecast: forecast(current: point), now: date,
                latitude: latitude, longitude: longitude)
        }
        let clear = scene()
        expect(clear.nightSky.moonVisibility > 0.9 && clear.nightSky.starVisibility > 0.6,
               "Fresh dark clear sky shows both an above-horizon Moon and restrained stars")
        expect(clear.nightSky.moonIllumination == indy.illumination && clear.nightSky.moonElevation == indy.elevation,
               "The immutable scene carries the chosen time/place lunar geometry")
        expect(clear == scene(), "Nocturnal resolution is deterministic")

        // USNO one-day endpoint for the same place/date gives Moon Set=05:02Z,
        // Moon Rise=20:47Z. Two hours after set is safely below the horizon.
        let below = scene(at("2026-09-20T07:00:00Z"))
        expect((below.nightSky.moonElevation ?? 0) < -10 && below.nightSky.moonVisibility == 0
            && below.nightSky.moonlightStrength == 0 && below.nightSky.starVisibility > 0.9,
            "A clear moonless night retains stars without inventing a moon or lunar glow")
        let cloudy = scene(code: 2, cloud: 58)
        expect(cloudy.nightSky.moonVisibility > 0 && cloudy.nightSky.moonVisibility < clear.nightSky.moonVisibility
            && cloudy.nightSky.starVisibility < clear.nightSky.starVisibility,
            "Broken clouds attenuate celestial visibility without discarding phase/geometry")
        expect(scene(cloud: 95).nightSky.moonVisibility == 0 && scene(cloud: 95).nightSky.starVisibility == 0,
               "Dense measured cover hides objects even with a conflicting clear code")
        for code in [3, 45, 48, 61, 71, 75, 95, -1] {
            let obscured = scene(code: code, cloud: 0)
            expect(obscured.nightSky.moonVisibility == 0 && obscured.nightSky.starVisibility == 0
                && obscured.nightSky.moonlightStrength == 0,
                "Overcast, fog, rain, snow, storms and unknown conditions suppress decorative celestial objects")
        }
        let stale = scene(weatherAge: 90 * 60)
        expect(stale.family == .unknown && stale.nightSky.moonVisibility == 0 && stale.nightSky.starVisibility == 0
            && stale.nightSky.moonElevation != nil,
            "Stale weather preserves geometry without pretending a clear sky")
        let noWeather = NativeLivingSkyScene.resolve(forecast: nil, now: nightDate, latitude: 39.7684, longitude: -86.1581)
        expect(noWeather.nightSky.moonVisibility == 0 && noWeather.nightSky.starVisibility == 0,
               "Missing weather cannot light a lunar composition")
        expect(scene(latitude: nil, longitude: nil).nightSky == .neutral,
               "An isDay bit without coordinates cannot invent lunar position or deep darkness")
        let day = scene(at("2026-09-19T20:00:00Z"))
        expect(day.isDaylight == true && day.nightSky.moonVisibility == 0 && day.nightSky.starVisibility == 0,
               "This initial nocturnal composition intentionally excludes daytime Moon and stars")

        let civil = scene(at("2026-09-20T00:00:00Z"))
        let nautical = scene(at("2026-09-20T00:30:00Z"))
        let dark = scene(at("2026-09-20T01:30:00Z"))
        expect(civil.nightSky.starVisibility == 0 && nautical.nightSky.starVisibility > 0
            && nautical.nightSky.starVisibility < dark.nightSky.starVisibility,
            "Stars emerge continuously through actual solar twilight, not a flat night switch")
        expect(civil.nightSky.moonVisibility < dark.nightSky.moonVisibility,
               "Twilight also softens the Moon")

        let later = at("2026-09-20T07:00:00Z")
        let currentPoint = NativeForecastPoint(date: nightDate, weatherCode: 0, isDay: false)
        let selectedPoint = NativeForecastPoint(date: later, weatherCode: 0, isDay: false)
        let timeline = forecast(current: currentPoint, hours: [selectedPoint])
        let selected = NativeLivingSkyScene.resolve(forecast: timeline, context: .forecast(later), now: nightDate,
            latitude: 39.7684, longitude: -86.1581)
        expect(selected.referenceDate == later && selected.source == .selectedForecast
            && selected.nightSky.moonVisibility == 0 && selected.nightSky.moonElevation == below.nightSky.moonElevation,
            "A deliberately selected future hour uses that hour's lunar altitude")
        let today = NativeLivingSkyScene.resolve(forecast: timeline, point: selectedPoint, now: nightDate,
            latitude: 39.7684, longitude: -86.1581)
        expect(today.nightSky.moonVisibility > 0, "A passing/focused hourly point cannot advance Today's Moon")

        for latitude in [-90.0, -89.9, 0, 89.9, 90] {
            for longitude in [-180.0, 0, 180] {
                let position = NativeSkyLunarGeometry.position(at: nightDate, latitude: latitude, longitude: longitude)!
                expect(position.elevation.isFinite && (-90...90).contains(position.elevation)
                    && position.rotation.isFinite && (-180...180).contains(position.rotation),
                    "Polar and antimeridian observers remain finite without rise/set events")
            }
        }
        let polarDay = scene(at("2026-06-21T12:00:00Z"), latitude: 89, longitude: 0)
        let polarNight = scene(at("2026-12-21T12:00:00Z"), latitude: 89, longitude: 0)
        expect(polarDay.nightSky.starVisibility == 0 && polarNight.nightSky.starVisibility > 0,
               "Polar daylight/night is determined geometrically, independent of noon or missing solar events")
        for (latitude, longitude) in [(91.0, 0.0), (-91, 0), (0, 181), (0, -181), (.nan, 0), (0, .infinity)] {
            expect(NativeSkyLunarGeometry.position(at: nightDate, latitude: latitude, longitude: longitude) == nil,
                   "Invalid coordinates never enter lunar trigonometry")
        }
        expect(NativeSkyLunarGeometry.position(at: Date(timeIntervalSince1970: .nan), latitude: 0, longitude: 0) == nil,
               "Invalid timestamps cannot produce a lunar state")
        let bounded = NativeLivingSkyScene.NightSky(moonIllumination: 2, waxing: true, moonElevation: 100,
            moonRotation: .infinity, moonVisibility: 1, starVisibility: .nan, moonlightStrength: 1)
        expect(bounded.moonIllumination == 1 && bounded.moonElevation == nil && bounded.moonRotation == 0
            && bounded.moonVisibility == 0 && bounded.starVisibility == 0 && bounded.moonlightStrength == 0,
            "Nocturnal renderer contract rejects invalid altitude and bounds all presentation strengths")
        let belowHorizon = NativeLivingSkyScene.NightSky(moonElevation: -1, moonVisibility: 1, moonlightStrength: 1)
        expect(belowHorizon.moonVisibility == 0 && belowHorizon.moonlightStrength == 0,
               "Even hand-constructed scenes cannot display a below-horizon moon")
        expect(NativeLivingSkyScene.NightSky(moonRotation: .greatestFiniteMagnitude).moonRotation.isFinite,
               "Large finite angles are reduced before conversion, never overflowing the renderer contract")
    }
}
