import Foundation

/// A deterministic presentation decision, not another weather model. It keeps
/// solar time separate from interface appearance and never calls a data service.
/// The first still-composition phase uses forecast conditions only: none of
/// these values claim that rain or snow has been observed at the ground.
struct NativeLivingSkyScene: Equatable, Sendable {
    enum Family: String, Equatable, Sendable {
        case clear, brokenClouds, overcast, rain, snow, fog, unknown
    }

    enum LightPhase: String, Equatable, Sendable {
        case dawn, day, dusk, night, unknown
    }

    /// A semantic composition choice, deliberately independent of filenames
    /// and renderer technology. Some approved plates have baked-in weather or
    /// stars, so they cannot be recolored into arbitrary conditions safely.
    enum Artwork: String, Equatable, Sendable {
        case openAir, sunClouds, rainClouds, twilightClouds, nightClouds, overcast, neutral
    }

    enum Context: Equatable, Sendable {
        /// Always the selected place now, independent of list scroll position.
        case current
        /// An intentionally selected forecast time, not a passing hourly row.
        case forecast(Date)
    }

    enum Source: String, Equatable, Sendable {
        case currentForecast, selectedForecast, unavailable
    }

    /// A rendering tier, not a second weather classification. Only a fresh,
    /// explicit modeled-current liquid precipitation amount can enable it.
    /// Matching probability can qualify a conflicting model-only signal, but
    /// probability alone never starts precipitation.
    enum RainStyle: String, Equatable, Sendable {
        case none, drizzle, light, steady, heavy

        static func resolve(_ decision: NativeCurrentWeatherDecision) -> RainStyle {
            guard let rate = decision.liquidRainRateMMPerHour else { return .none }
            if rate >= 7.6 { return .heavy }
            if rate >= 2.5 { return .steady }
            if let code = decision.acceptedPoint?.weatherCode,
               [51, 53, 55, 56, 57].contains(code) { return .drizzle }
            return .light
        }
    }

    /// Optical tiers follow the normalized snow condition. Liquid-equivalent
    /// precipitation only confirms an active sample; it is not snow depth and
    /// must never be converted with an assumed snow-to-water ratio.
    enum SnowStyle: String, Equatable, Sendable {
        case none, light, steady, heavy

        static func resolve(_ decision: NativeCurrentWeatherDecision) -> SnowStyle {
            guard decision.snowWaterEquivalentRateMMPerHour != nil else { return .none }
            switch decision.acceptedPoint?.weatherCode {
            case 75, 86: return .heavy
            case 73: return .steady
            case 71, 77, 85: return .light
            default: return .none
            }
        }
    }

    /// Cloud treatment, not a lightning observation or severe-weather alert.
    /// Possibility flags and raw provider codes never enable this treatment.
    enum StormStyle: String, Equatable, Sendable {
        case none, thunderstorm
    }

    struct Illumination: Equatable, Sendable {
        /// Geometric altitude, not an exact terrain/refraction visibility claim.
        let solarElevation: Double?
        let directness: Double
        let warmth: Double
        let sunStrength: Double
        let cloudIllumination: Double

        static let neutral = Illumination()

        init(solarElevation: Double? = nil, directness: Double = 0, warmth: Double = 0,
             sunStrength: Double = 0, cloudIllumination: Double = 0) {
            self.solarElevation = solarElevation.flatMap { $0.isFinite && (-90...90).contains($0) ? $0 : nil }
            self.directness = Self.unit(directness)
            self.warmth = Self.unit(warmth)
            self.sunStrength = Self.unit(sunStrength)
            self.cloudIllumination = Self.unit(cloudIllumination)
        }

        private static func unit(_ value: Double) -> Double { value.isFinite ? min(1, max(0, value)) : 0 }
    }

    /// A restrained night composition, not a star chart or visibility report.
    /// Geometry is independent of weather; visibility requires fresh weather.
    struct NightSky: Equatable, Sendable {
        let moonIllumination: Double
        let waxing: Bool
        /// Approximate topocentric geometric altitude in degrees. No terrain,
        /// atmospheric-refraction, or exact moonrise/moonset claim is made.
        let moonElevation: Double?
        /// CLOCKWISE degrees from an always-RIGHT-lit phase mask. This already
        /// includes local orientation: never mirror it again for waxing/latitude.
        let moonRotation: Double
        let moonVisibility: Double
        let starVisibility: Double
        let moonlightStrength: Double

        static let neutral = NightSky()

        init(moonIllumination: Double = 0, waxing: Bool = false, moonElevation: Double? = nil,
             moonRotation: Double = 0, moonVisibility: Double = 0,
             starVisibility: Double = 0, moonlightStrength: Double = 0) {
            self.moonIllumination = Self.unit(moonIllumination)
            self.waxing = waxing
            self.moonElevation = moonElevation.flatMap { $0.isFinite && (-90...90).contains($0) ? $0 : nil }
            let angle = moonRotation.isFinite ? moonRotation.truncatingRemainder(dividingBy: 360) * .pi / 180 : 0
            self.moonRotation = atan2(sin(angle), cos(angle)) * 180 / .pi
            let aboveHorizon = (self.moonElevation ?? -90) > 0
            self.moonVisibility = aboveHorizon ? Self.unit(moonVisibility) : 0
            self.starVisibility = Self.unit(starVisibility)
            self.moonlightStrength = aboveHorizon ? Self.unit(moonlightStrength) : 0
        }

        private static func unit(_ value: Double) -> Double { value.isFinite ? min(1, max(0, value)) : 0 }
    }

    let family: Family
    let lightPhase: LightPhase
    let isDaylight: Bool?
    let cloudCoverage: Double
    let context: Context
    let source: Source
    let referenceDate: Date
    let weatherDate: Date?
    let illumination: Illumination
    let nightSky: NightSky
    let rainStyle: RainStyle
    let snowStyle: SnowStyle
    let stormStyle: StormStyle

    init(family: Family, lightPhase: LightPhase, isDaylight: Bool?, cloudCoverage: Double,
         context: Context, source: Source, referenceDate: Date, weatherDate: Date?,
         illumination: Illumination = .neutral, nightSky: NightSky = .neutral,
         rainStyle: RainStyle = .none, snowStyle: SnowStyle = .none,
         stormStyle: StormStyle = .none) {
        self.family = family
        self.lightPhase = lightPhase
        self.isDaylight = isDaylight
        self.cloudCoverage = cloudCoverage.isFinite ? min(1, max(0, cloudCoverage)) : 0.7
        self.context = context
        self.source = source
        self.referenceDate = referenceDate
        self.weatherDate = weatherDate
        self.illumination = illumination
        self.nightSky = nightSky
        // Hand-built fixtures and future-day scenes cannot accidentally
        // animate precipitation in an unrelated or unavailable context.
        self.rainStyle = family == .rain && context == .current && source == .currentForecast
            ? rainStyle : .none
        self.snowStyle = family == .snow && context == .current && source == .currentForecast
            ? snowStyle : .none
        self.stormStyle = family == .rain && context == .current && source == .currentForecast
            ? stormStyle : .none
    }

    var artwork: Artwork {
        switch family {
        case .clear:
            // An analytic open-sky field can become day, dawn, dusk or night
            // without importing cloud silhouettes from a cloudy photograph.
            return lightPhase == .unknown ? .neutral : .openAir
        case .brokenClouds:
            switch lightPhase {
            case .day: return .sunClouds
            case .dawn, .dusk: return .twilightClouds
            case .night: return .nightClouds
            case .unknown: return .neutral
            }
        case .rain:
            // Use precipitation-free artwork in every phase. Falling rain is
            // a separate evidence-gated layer, never baked-in slash wallpaper.
            return .overcast
        case .overcast, .snow, .fog:
            // The neutral overcast plate has no baked precipitation or stars.
            // The renderer supplies phase-appropriate exposure and fog veil.
            return .overcast
        case .unknown:
            return .neutral
        }
    }

    static func resolve(
        forecast: NativeWeatherForecast?,
        point: NativeForecastPoint? = nil,
        context: Context = .current,
        now: Date,
        latitude: Double? = nil,
        longitude: Double? = nil
    ) -> NativeLivingSkyScene {
        let date: Date
        let candidate: NativeForecastPoint?
        let source: Source
        let maximumAge: TimeInterval
        switch context {
        case .current:
            date = now
            // An arbitrary selected row cannot accidentally control Today.
            candidate = forecast == nil ? point : forecast?.current
            source = .currentForecast
            maximumAge = 90 * 60
        case .forecast(let selectedDate):
            date = selectedDate
            candidate = point ?? forecast?.hours.last(where: { $0.date <= selectedDate })
            source = .selectedForecast
            maximumAge = 60 * 60
        }

        // Current samples can arrive just ahead of our clock. A stale sample or
        // unrelated future point must not carry its condition into this scene.
        let currentDecision = NativeCurrentWeatherDecision(point: candidate, now: date)
        let validPoint = context == .current ? currentDecision.acceptedPoint : candidate.flatMap { value -> NativeForecastPoint? in
            let age = date.timeIntervalSince(value.date)
            return age >= -5 * 60 && age < maximumAge ? value : nil
        }
        let sun = forecast.map { NativeSunDaylight(forecast: $0, day: date) }
        let elevation = NativeSkySolarGeometry.elevation(at: date, latitude: latitude, longitude: longitude)
        // Actual forecast solar events remain authoritative. In their absence,
        // coordinate-based geometry is safer than a cached provider isDay bit.
        let daylight = sun?.isDaylight(at: date) ?? elevation.map { $0 > -0.833 } ?? validPoint?.isDay
        let phase = lightPhase(sun: sun, date: date, fallbackDaylight: daylight)
        let presentationCode = context == .current ? currentDecision.presentationWeatherCode : validPoint?.weatherCode
        let baseFamily = family(for: presentationCode)
        // Current APIs sometimes omit radiation while the containing hourly
        // row already carries it. Only Current may use that bounded sample.
        // An explicit future hour carries its own fields; a synthetic daily
        // summary must not silently borrow radiation/layers from a noon hour.
        // Never interpolate, borrow a future hour, or revive expired weather.
        let enrichment: NativeForecastPoint?
        if context == .current && validPoint != nil {
            enrichment = forecast?.hours.last(where: {
                $0.date <= date && date.timeIntervalSince($0.date) < 3600
            })
        } else {
            enrichment = nil
        }
        func optional(_ key: KeyPath<NativeForecastPoint, Double?>, maximum: Double) -> Double? {
            (validPoint?[keyPath: key] ?? enrichment?[keyPath: key]).flatMap {
                $0.isFinite && (0...maximum).contains($0) ? $0 : nil
            }
        }
        let lowCloud = optional(\.lowCloudCover, maximum: 100).map { $0 / 100 }
        let midCloud = optional(\.midCloudCover, maximum: 100).map { $0 / 100 }
        let highCloud = optional(\.highCloudCover, maximum: 100).map { $0 / 100 }
        let explicitCover = optional(\.cloudCover, maximum: 100).map { $0 / 100 }
        let layerCover = [lowCloud, midCloud, highCloud].compactMap { $0 }.max()
        let cover = max(explicitCover ?? layerCover ?? defaultCloudCoverage(family: baseFamily, code: presentationCode), layerCover ?? 0)
        // "Mostly clear" is still the condition label; sufficient real cloud
        // cover earns a broken-cloud composition instead of empty blue sky.
        let family: Family = presentationCode == 1 && cover >= 0.35 ? .brokenClouds : baseFamily
        let illumination = illumination(family: family, validWeather: validPoint != nil, daylight: daylight,
            elevation: elevation, cover: cover, lowCloud: lowCloud, midCloud: midCloud, highCloud: highCloud,
            shortwave: optional(\.shortwaveRadiation, maximum: 2000),
            direct: optional(\.directRadiation, maximum: 2000), diffuse: optional(\.diffuseRadiation, maximum: 2000))
        let nightSky = nightSky(family: family, validWeather: validPoint != nil, daylight: daylight,
            solarElevation: elevation, cover: cover,
            moon: NativeSkyLunarGeometry.position(at: date, latitude: latitude, longitude: longitude))

        return NativeLivingSkyScene(
            family: family,
            lightPhase: phase,
            isDaylight: daylight,
            cloudCoverage: cover,
            context: context,
            source: family == .unknown ? .unavailable : source,
            referenceDate: date,
            weatherDate: validPoint?.date,
            illumination: illumination,
            nightSky: nightSky,
            rainStyle: context == .current ? RainStyle.resolve(currentDecision) : .none,
            snowStyle: context == .current ? SnowStyle.resolve(currentDecision) : .none,
            stormStyle: context == .current && currentDecision.hasCurrentThunderstorm ? .thunderstorm : .none
        )
    }

    private static func nightSky(family: Family, validWeather: Bool, daylight: Bool?,
                                 solarElevation: Double?, cover: Double,
                                 moon: NativeSkyLunarGeometry.Position?) -> NightSky {
        // Preserve independently knowable geometry even when weather is absent,
        // while never making absent/stale conditions look confidently clear.
        let allowed = validWeather && (family == .clear || family == .brokenClouds)
            && daylight == false && solarElevation != nil
        let darkness = solarElevation.map { 1 - smoothstep(-16, -5, $0) } ?? 0
        let moonDarkness = solarElevation.map { 1 - smoothstep(-8, -1, $0) } ?? 0
        let cloudTransmission = 1 - smoothstep(0.2, 0.88, cover)
        // This small safety margin avoids popping a disc at the exact horizon
        // where low-precision ephemeris, refraction and terrain matter most.
        let horizon = moon.map { smoothstep(1, 9, $0.elevation) } ?? 0
        let visiblePhase = moon.map { smoothstep(0.008, 0.055, $0.illumination) } ?? 0
        let moonVisibility = allowed ? moonDarkness * horizon * visiblePhase * cloudTransmission : 0
        let moonlight = moonVisibility * pow(moon?.illumination ?? 0, 2)
            * (0.3 + 0.7 * smoothstep(0, 60, moon?.elevation ?? 0))
        let stars = allowed ? darkness * cloudTransmission * (1 - moonlight * 0.48) : 0
        return NightSky(moonIllumination: moon?.illumination ?? 0, waxing: moon?.waxing ?? false,
            moonElevation: moon?.elevation, moonRotation: moon?.rotation ?? 0,
            moonVisibility: moonVisibility, starVisibility: stars, moonlightStrength: moonlight)
    }

    private static func illumination(family: Family, validWeather: Bool, daylight: Bool?, elevation: Double?,
                                     cover: Double, lowCloud: Double?, midCloud: Double?, highCloud: Double?,
                                     shortwave: Double?, direct: Double?, diffuse: Double?) -> Illumination {
        guard validWeather, family != .unknown else { return Illumination(solarElevation: elevation) }
        let denseCloud = max(cover * 0.7, (lowCloud ?? 0) * 0.9 + (midCloud ?? 0) * 0.55 + (highCloud ?? 0) * 0.25)
        let shade = min(1, denseCloud)
        let lift = elevation.map { smoothstep(0, 55, $0) } ?? (daylight == true ? 0.6 : 0)
        let expectedRadiation = elevation.map { max(45, 1000 * max(0, sin($0 * .pi / 180))) } ?? 700
        let totalRadiation = shortwave ?? direct.flatMap { direct in diffuse.map { direct + $0 } } ?? direct
        let radiationFactor = totalRadiation.map { min(1, max(0, $0 / expectedRadiation)) } ?? 1
        var directness = 1 - cover * 0.78
        if let shortwave, let direct, shortwave > 0, direct <= shortwave + 1 {
            directness = min(1, direct / shortwave)
        } else if let shortwave, let diffuse, shortwave > 0, diffuse <= shortwave + 1 {
            directness = min(1, max(0, (shortwave - diffuse) / shortwave))
        } else if shortwave == 0 {
            directness = 0
        } else if let direct, let diffuse, direct + diffuse > 0 {
            directness = direct / (direct + diffuse)
        }
        // A sun shower requires actual optional modeled radiation and an
        // open-enough cloud field. Neither a rain code nor clock time alone
        // creates a sunny break in an otherwise dense precipitation ceiling.
        let rainSunBreak = family == .rain && cover < 0.82
            && (direct ?? 0) > 60 && (totalRadiation ?? 0) > 90
        let sunFamily = family == .clear || family == .brokenClouds || rainSunBreak
        let sunAboveHorizon = elevation.map { $0 > 0 } ?? (daylight == true)
        if daylight != true || !sunAboveHorizon || !sunFamily || cover >= 0.9 { directness = 0 }
        let strength = directness * (1 - shade * 0.4) * sqrt(radiationFactor) * (0.52 + lift * 0.48)

        // Geometry alone determines golden-hour color. Low noon radiation can
        // soften light, but must never turn noon into an orange sunset. Unknown
        // elevation gets no invented golden hour. Twilight remains possible
        // below the horizon without drawing a visible sun.
        let golden = elevation.map {
            smoothstep(-6, 1, $0) * (1 - smoothstep(5, 24, $0))
        } ?? 0
        let warmthLimit: Double = sunFamily ? 1 : (family == .rain ? 0.32 : 0.12)
        let consistentSolar = daylight != false || (elevation ?? 0) <= 0
        let warmth = consistentSolar ? golden * (0.45 + directness * 0.55) * (1 - shade * 0.35) * warmthLimit : 0
        let diffuseLift = diffuse.map { min(1, $0 / 300) } ?? cover * 0.4
        let cloudLight: Double
        if daylight == true {
            cloudLight = (0.18 + lift * 0.55) * (0.45 + radiationFactor * 0.55) + diffuseLift * 0.2
        } else if let elevation {
            cloudLight = 0.06 + smoothstep(-9, 0, elevation) * 0.22
        } else {
            cloudLight = daylight == false ? 0.06 : 0
        }
        return Illumination(solarElevation: elevation, directness: directness, warmth: warmth,
            sunStrength: strength, cloudIllumination: cloudLight)
    }

    private static func smoothstep(_ lower: Double, _ upper: Double, _ value: Double) -> Double {
        let fraction = min(1, max(0, (value - lower) / (upper - lower)))
        return fraction * fraction * (3 - 2 * fraction)
    }

    private static func family(for code: Int?) -> Family {
        switch code {
        case 0, 1: return .clear
        case 2: return .brokenClouds
        case 3: return .overcast
        case 45, 48: return .fog
        case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99:
            // A supported thunder condition earns a rain-cloud composition,
            // not lightning flashes. thunderPossible and probability are not
            // consulted here, nor is rawWeatherCode allowed to bypass the
            // shared forecast's normalized condition.
            return .rain
        case 71, 73, 75, 77, 85, 86: return .snow
        default: return .unknown
        }
    }

    private static func lightPhase(sun: NativeSunDaylight?, date: Date, fallbackDaylight: Bool?) -> LightPhase {
        if let sun, sun.mode == .normal, let rise = sun.sunrise, let set = sun.sunset {
            // This is a restrained artistic transition, not a calculation or
            // claim about civil twilight. Shrink it for unusually short days so
            // dawn and dusk cannot overlap.
            let transition = min(30 * 60, set.timeIntervalSince(rise) / 4)
            if abs(date.timeIntervalSince(rise)) < transition { return .dawn }
            if abs(date.timeIntervalSince(set)) < transition { return .dusk }
        }
        switch fallbackDaylight {
        case true: return .day
        case false: return .night
        case nil: return .unknown
        }
    }

    private static func defaultCloudCoverage(family: Family, code: Int?) -> Double {
        switch family {
        case .clear: return code == 1 ? 0.15 : 0
        case .brokenClouds: return 0.45
        case .overcast: return 0.92
        case .rain: return 0.93
        case .snow: return 0.9
        case .fog: return 1
        case .unknown: return 0.7
        }
    }
}

/// The same fractional-year / equation-of-time approximation used by sky.js.
/// UTC and geographic coordinates are sufficient: the phone's timezone never
/// affects the sun. Sunrise/sunset events, when provided, remain authoritative
/// in the scene resolver. No refraction or local-terrain claim is made here.
enum NativeSkySolarGeometry {
    static func elevation(at date: Date, latitude: Double?, longitude: Double?) -> Double? {
        guard let latitude, let longitude, latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude),
              date.timeIntervalSince1970.isFinite else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let day = calendar.ordinality(of: .day, in: .year, for: date) else { return nil }
        let clock = calendar.dateComponents([.hour, .minute, .second], from: date)
        let minutes = Double(clock.hour ?? 0) * 60 + Double(clock.minute ?? 0) + Double(clock.second ?? 0) / 60
        let gamma = 2 * Double.pi / 365 * (Double(day) - 1 + (minutes / 60 - 12) / 24)
        let equation = 229.18 * (0.000075 + 0.001868 * cos(gamma) - 0.032077 * sin(gamma)
            - 0.014615 * cos(2 * gamma) - 0.040849 * sin(2 * gamma))
        let declination = 0.006918 - 0.399912 * cos(gamma) + 0.070257 * sin(gamma)
            - 0.006758 * cos(2 * gamma) + 0.000907 * sin(2 * gamma)
            - 0.002697 * cos(3 * gamma) + 0.00148 * sin(3 * gamma)
        let rawSolarMinutes = (minutes + equation + 4 * longitude).truncatingRemainder(dividingBy: 1440)
        let solarMinutes = (rawSolarMinutes + 1440).truncatingRemainder(dividingBy: 1440)
        let hourAngle = (solarMinutes / 4 - 180) * .pi / 180
        let latitudeRadians = latitude * .pi / 180
        let cosineZenith = min(1, max(-1, sin(latitudeRadians) * sin(declination)
            + cos(latitudeRadians) * cos(declination) * cos(hourAngle)))
        let result = 90 - acos(cosineZenith) * 180 / .pi
        return result.isFinite ? result : nil
    }
}

/// Low-precision SunCalc 1.9.0 lunar coordinates, illumination and limb angle,
/// adapted to Swift. Suitable for this small atmospheric composition, not an
/// ephemeris UI. UTC and the selected place alone determine the result. The
/// SunCalc refraction correction is intentionally NOT applied; a spherical
/// observer offset supplies geometric topocentric altitude instead.
/// Sources: https://github.com/mourner/suncalc/tree/v1.9.0
/// https://aa.quae.nl/en/reken/hemelpositie.html
///
/// SunCalc license (BSD-2-Clause):
/// Copyright (c) 2014, Vladimir Agafonkin
/// All rights reserved.
///
/// Redistribution and use in source and binary forms, with or without
/// modification, are permitted provided that the following conditions are met:
/// 1. Redistributions of source code must retain the above copyright notice,
///    this list of conditions and the following disclaimer.
/// 2. Redistributions in binary form must reproduce the above copyright notice,
///    this list of conditions and the following disclaimer in the documentation
///    and/or other materials provided with the distribution.
/// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
/// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
/// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
/// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
/// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
/// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
/// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
/// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
/// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
/// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
/// POSSIBILITY OF SUCH DAMAGE.
enum NativeSkyLunarGeometry {
    struct Position: Equatable, Sendable {
        let illumination: Double
        let waxing: Bool
        let phase: Double
        let elevation: Double
        let geocentricElevation: Double
        let distance: Double
        /// Radians, eastward from celestial north (SunCalc convention).
        let brightLimbAngle: Double
        let parallacticAngle: Double
        /// Clockwise degrees from a right-lit mask in a y-down view.
        let rotation: Double
    }

    private static let radians = Double.pi / 180
    private static let obliquity = 23.4397 * radians

    static func position(at date: Date, latitude: Double?, longitude: Double?) -> Position? {
        guard let latitude, let longitude, latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude),
              date.timeIntervalSince1970.isFinite else { return nil }
        let days = date.timeIntervalSince1970 / 86400 + 2440587.5 - 2451545
        // Keep absurd dates out of trigonometry rather than manufacture a
        // plausible scene from overflow. Real current/forecast dates are tiny.
        guard days.isFinite, abs(days) < 365250 else { return nil }

        let meanLongitude = radians * (218.316 + 13.176396 * days)
        let lunarAnomaly = radians * (134.963 + 13.064993 * days)
        let meanDistance = radians * (93.272 + 13.229350 * days)
        let lunarLongitude = meanLongitude + radians * 6.289 * sin(lunarAnomaly)
        let lunarLatitude = radians * 5.128 * sin(meanDistance)
        let distance = 385001 - 20905 * cos(lunarAnomaly)
        let moon = equatorial(longitude: lunarLongitude, latitude: lunarLatitude)

        let observerLatitude = latitude * radians
        let hourAngle = radians * (280.16 + 360.9856235 * days + longitude) - moon.rightAscension
        let geometricAltitude = asin(bounded(sin(observerLatitude) * sin(moon.declination)
            + cos(observerLatitude) * cos(moon.declination) * cos(hourAngle)))
        // Translate the geocentric vector to a sea-level spherical observer:
        // its horizontal component is unchanged, vertical loses Earth radius.
        // This accounts for lunar parallax without claiming terrain/refraction.
        let topocentricAltitude = atan2(distance * sin(geometricAltitude) - 6371,
                                       distance * cos(geometricAltitude))
        let parallacticAngle = atan2(sin(hourAngle),
            tan(observerLatitude) * cos(moon.declination) - sin(moon.declination) * cos(hourAngle))

        // Solar coordinates here only establish the lunar phase/bright limb;
        // existing solar geometry/events still exclusively govern scene light.
        let solarAnomaly = radians * (357.5291 + 0.98560028 * days)
        let center = radians * (1.9148 * sin(solarAnomaly) + 0.02 * sin(2 * solarAnomaly)
            + 0.0003 * sin(3 * solarAnomaly))
        let sun = equatorial(longitude: solarAnomaly + center + radians * 102.9372 + .pi, latitude: 0)
        let separation = acos(bounded(sin(sun.declination) * sin(moon.declination)
            + cos(sun.declination) * cos(moon.declination) * cos(sun.rightAscension - moon.rightAscension)))
        let incidence = atan2(149598000 * sin(separation), distance - 149598000 * cos(separation))
        let limbAngle = atan2(cos(sun.declination) * sin(sun.rightAscension - moon.rightAscension),
            sin(sun.declination) * cos(moon.declination)
                - cos(sun.declination) * sin(moon.declination) * cos(sun.rightAscension - moon.rightAscension))
        let illumination = (1 + cos(incidence)) / 2
        let phase = 0.5 + 0.5 * incidence * (limbAngle < 0 ? -1 : 1) / .pi
        // SunCalc documents (limb - parallactic) as anticlockwise from zenith.
        // A y-down renderer needs clockwise from RIGHT, hence -zenith - 90°.
        let rotation = -(limbAngle - parallacticAngle) - .pi / 2
        return Position(illumination: illumination, waxing: phase < 0.5, phase: phase,
            elevation: topocentricAltitude / radians, geocentricElevation: geometricAltitude / radians,
            distance: distance, brightLimbAngle: limbAngle, parallacticAngle: parallacticAngle,
            rotation: atan2(sin(rotation), cos(rotation)) / radians)
    }

    private static func bounded(_ value: Double) -> Double { min(1, max(-1, value)) }

    private static func equatorial(longitude: Double, latitude: Double)
        -> (rightAscension: Double, declination: Double) {
        (atan2(sin(longitude) * cos(obliquity) - tan(latitude) * sin(obliquity), cos(longitude)),
         asin(bounded(sin(latitude) * cos(obliquity) + cos(latitude) * sin(obliquity) * sin(longitude))))
    }
}
