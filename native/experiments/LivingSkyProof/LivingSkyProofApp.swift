import SwiftUI

/// Simulator-only art review. Uses the real renderer and bundled assets, with
/// visibly illustrative content. Not linked into the Nearcast app target.
@main
struct LivingSkyProofApp: App {
    private let arguments = ProcessInfo.processInfo.arguments
    @Environment(\.scenePhase) private var scenePhase
    @State private var motionEnabled = true
    @State private var alternateWeather = false
    @State private var readingEnabled = false
    private func value(_ name: String) -> String? {
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private func resolvedScene(fallback: NativeLivingSkyScene) -> NativeLivingSkyScene {
        guard let raw = value("-at"), let date = ISO8601DateFormatter().date(from: raw) else { return fallback }
        return .resolve(forecast: nil,
            point: NativeForecastPoint(date: date, weatherCode: Int(value("-code") ?? "0") ?? 0),
            now: date, latitude: Double(value("-latitude") ?? "39.7684"),
            longitude: Double(value("-longitude") ?? "-86.1581"))
    }

    var body: some Scene {
        let family = alternateWeather ? NativeLivingSkyScene.Family.clear
            : (NativeLivingSkyScene.Family(rawValue: value("-family") ?? "brokenClouds") ?? .unknown)
        let snow = family == .snow
        let phase = NativeLivingSkyScene.LightPhase(rawValue: value("-phase") ?? "day") ?? .unknown
        let dark = arguments.contains("-dark")
        let reading = arguments.contains("-reading") || readingEnabled
        let sunFamily = family == .clear || family == .brokenClouds
            || (family == .rain && arguments.contains("-sun-break"))
        let golden = phase == .dawn || phase == .dusk
        let daylight = phase != .night && phase != .unknown
        let illumination = NativeLivingSkyScene.Illumination(
            solarElevation: daylight ? (golden ? 5 : 42) : -24,
            directness: sunFamily && daylight ? 0.82 : 0,
            warmth: golden ? (sunFamily ? 0.82 : (family == .rain ? 0.24 : 0)) : 0,
            sunStrength: sunFamily && daylight ? (golden ? 0.45 : 0.82) : 0,
            cloudIllumination: daylight ? (golden ? 0.28 : 0.8) : 0.06)
        let moon = value("-moon") ?? "gibbous"
        let moonless = moon == "moonless"
        let moonFraction = moon == "full" ? 1.0 : (moon == "quarter" ? 0.5 : (moon == "crescent" ? 0.14 : 0.62))
        let nightSky = NativeLivingSkyScene.NightSky(
            moonIllumination: moonFraction, waxing: true, moonElevation: moonless ? -18 : 48,
            moonRotation: Double(value("-moon-rotation") ?? "-24") ?? -24,
            moonVisibility: sunFamily && !daylight && !moonless ? 0.98 : 0,
            starVisibility: sunFamily && !daylight ? (moonless ? 0.96 : 0.52) : 0,
            moonlightStrength: sunFamily && !daylight && !moonless ? moonFraction * 0.86 : 0)
        let illustrativeScene = NativeLivingSkyScene(family: family, lightPhase: phase,
            isDaylight: phase == .unknown ? nil : phase != .night, cloudCoverage: 0.6,
            context: .current, source: .currentForecast, referenceDate: Date(), weatherDate: Date(),
            illumination: illumination, nightSky: nightSky,
            rainStyle: NativeLivingSkyScene.RainStyle(rawValue: value("-rain-style") ?? "steady") ?? .none,
            snowStyle: NativeLivingSkyScene.SnowStyle(rawValue: value("-snow-style") ?? "steady") ?? .none,
            stormStyle: arguments.contains("-storm") ? .thunderstorm : .none)
        let scene = resolvedScene(fallback: illustrativeScene)
        WindowGroup {
            if arguments.contains("-rain-readability") || arguments.contains("-verify-rain-readability") {
                NativeSkyRainReadabilityView()
            } else if arguments.contains("-verify-motion") {
                NativeSkyMotionVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-backdrop") {
                NativeSkyBackdropVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-rain") {
                NativeSkyRainVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-rain-backdrop") {
                NativeSkyRainBackdropVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-snow") {
                NativeSkySnowVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-snow-backdrop") {
                NativeSkySnowBackdropVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-stars") {
                NativeSkyStarsVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-stars-backdrop") {
                NativeSkyStarsBackdropVerificationView().ignoresSafeArea()
            } else if arguments.contains("-verify-storm-depth") {
                NativeSkyStormDepthVerificationView().ignoresSafeArea()
            } else {
            ZStack {
                NativeLivingSkyBackdrop(scene: scene, isDark: dark, reading: reading,
                    increasedContrast: arguments.contains("-contrast"),
                    reduceTransparency: arguments.contains("-opaque"),
                    motionAllowed: arguments.contains("-motion") && motionEnabled && scenePhase == .active,
                    reduceMotion: arguments.contains("-reduce-motion"),
                    dimFlashingLights: arguments.contains("-dim-flashes"), sceneIdentity: "proof",
                    immediateMotionStop: scenePhase != .active)
                    .ignoresSafeArea()
                if !arguments.contains("-sky-only") {
                 VStack(spacing: 24) {
                    Text("SKY COMPOSITION REVIEW").font(.caption.weight(.bold))
                    Text("\(scene.stormStyle == .thunderstorm ? "thunderstorm" : scene.family.rawValue) · \(scene.lightPhase.rawValue) · sample data")
                        .font(.caption).multilineTextAlignment(.center)
                    Text("Maryville, Illinois").font(.headline)
                    Spacer(minLength: 30)
                    if reading {
                        VStack(spacing: 0) {
                            ForEach(9..<16) { hour in
                                HStack {
                                    Text("\(hour):00").font(.subheadline)
                                    Image(systemName: "cloud").frame(width: 36)
                                    Text("68°").font(.headline)
                                    Spacer()
                                    Text("20% rain").font(.subheadline)
                                }
                                .padding(.vertical, 20)
                                Divider()
                            }
                        }
                    } else {
                        Text(snow ? "31°" : "68°").font(.system(size: 100, weight: .semibold, design: .rounded))
                        Text("Forecast comes first").font(.title3.weight(.semibold))
                        Text(snow ? "High 34° · Low 25°" : "High 72° · Low 59°")
                            .foregroundStyle(dark ? Color(red: 0.84, green: 0.89, blue: 0.92) : Color(red: 0.12, green: 0.19, blue: 0.23))
                        Spacer(minLength: 30)
                        VStack(alignment: .leading, spacing: 14) {
                            Text("TODAY’S OUTLOOK").font(.caption.weight(.bold))
                            Text("A clear answer, at a glance.").font(.title2.weight(.bold))
                            Text("The composition stays behind the weather, never on top of it.")
                        }
                        .padding(24).frame(maxWidth: .infinity, alignment: .leading)
                        .background(dark ? Color(red: 0.075, green: 0.13, blue: 0.18) : Color.white.opacity(0.94),
                            in: RoundedRectangle(cornerRadius: 28))
                    }
                    Spacer(minLength: 30)
                }
                .padding(24)
                }
            }
            .overlay(alignment: .bottom) {
                if arguments.contains("-motion") {
                    HStack {
                        Button(motionEnabled ? "Pause" : "Resume") { motionEnabled.toggle() }
                        Button(alternateWeather ? "Clouds" : "Clear") { alternateWeather.toggle() }
                        Button(readingEnabled ? "Hero" : "Read") { readingEnabled.toggle() }
                    }
                    .buttonStyle(.borderedProminent)
                    .padding()
                }
            }
            .preferredColorScheme(dark ? .dark : .light)
            .dynamicTypeSize(arguments.contains("-large-type") ? .accessibility1 : .large)
            }
        }
    }
}
