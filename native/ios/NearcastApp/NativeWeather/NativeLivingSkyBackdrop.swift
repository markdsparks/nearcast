import SwiftUI

/// Ship the reviewed sky in native Release; retain the Dev comparison switch.
enum NativeLivingSkyFeature {
    static var isEnabled: Bool {
        #if DEBUG
        return !ProcessInfo.processInfo.arguments.contains("-nearcast-classic-sky")
        #else
        return true
        #endif
    }
}

/// One lifecycle-owned backdrop. Continuous drift is compositor-only; a short
/// task exists only while an accepted same-place weather scene crossfades.
struct NativeLivingSkyBackdrop: View {
    let scene: NativeLivingSkyScene
    let isDark: Bool
    let reading: Bool
    let increasedContrast: Bool
    let reduceTransparency: Bool
    var motionAllowed: Bool = false
    var reduceMotion: Bool = false
    var dimFlashingLights: Bool = false
    var sceneIdentity: String = ""
    /// Backgrounding and power/accessibility restrictions stop all atmospheric
    /// motion synchronously; reading may use a short precipitation exit fade.
    var immediateMotionStop: Bool = false
    /// Actual on-screen hero bounds. Alerts/places may push it well below the
    /// upper third; precipitation should frame that hero, not a fixed band.
    var precipitationFocus: CGRect? = nil

    @State private var timeline = NativeSkyDriftTimeline()
    @State private var displayedScene: NativeLivingSkyScene?
    @State private var displayedIdentity: String?
    @State private var outgoingScene: NativeLivingSkyScene?
    @State private var outgoingOpacity = 1.0
    @State private var transitionTask: Task<Void, Never>?

    private var canMove: Bool {
        motionAllowed && !immediateMotionStop && !reduceMotion && !reading
            && !increasedContrast && !reduceTransparency
    }
    private var canDrift: Bool {
        guard canMove, scene.source != .unavailable, scene.lightPhase != .unknown else { return false }
        switch scene.family {
        case .brokenClouds, .overcast, .rain, .snow: return true
        case .clear, .fog, .unknown: return false
        }
    }
    private var canTwinkle: Bool {
        canMove && !dimFlashingLights && scene.source == .currentForecast
            && scene.context == .current && scene.lightPhase != .unknown
            && scene.nightSky.starVisibility > 0
    }
    private var canAnimate: Bool { canDrift || canTwinkle }

    var body: some View {
        let sampleTime = CACurrentMediaTime()
        let sameIdentity = displayedIdentity == sceneIdentity
        let elapsed = sameIdentity ? timeline.elapsed(at: sampleTime) : 0
        ZStack {
            composition(displayedIdentity == sceneIdentity ? (displayedScene ?? scene) : scene,
                elapsed: elapsed, time: sampleTime, running: sameIdentity && timeline.isRunning)
            // Exactly one precipitation owner; outgoing compositions never
            // retain particles when accepted weather changes rain ↔ snow.
            if scene.family == .snow {
                NativeLivingSkySnowView(style: scene.snowStyle,
                    active: canMove && sameIdentity && scene.source != .unavailable,
                    immediateStop: immediateMotionStop || reduceMotion || reduceTransparency || increasedContrast
                        || scene.source == .unavailable,
                    identity: sceneIdentity, isNight: scene.isDaylight == false)
            } else {
                NativeLivingSkyRainView(style: scene.rainStyle,
                    active: canMove && sameIdentity && scene.source != .unavailable,
                    immediateStop: immediateMotionStop || reduceMotion || reduceTransparency || increasedContrast
                        || scene.source == .unavailable,
                    identity: sceneIdentity, isNight: scene.isDaylight == false,
                    focus: precipitationFocus)
            }
            if displayedIdentity == sceneIdentity, let outgoingScene {
                composition(outgoingScene, elapsed: elapsed, time: sampleTime, running: false)
                    .opacity(outgoingOpacity)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            if displayedIdentity != sceneIdentity {
                endTransition()
                timeline.reset(at: CACurrentMediaTime())
            }
            displayedScene = scene
            displayedIdentity = sceneIdentity
            timeline.setRunning(canAnimate, at: CACurrentMediaTime())
        }
        .onChange(of: canAnimate) { _, allowed in timeline.setRunning(allowed, at: CACurrentMediaTime()) }
        .onChange(of: canMove) { _, allowed in
            if !allowed { endTransition() }
        }
        .onChange(of: scene) { _, newScene in accept(newScene) }
        .onChange(of: sceneIdentity) { _, _ in
            // Never retain another place's scene behind a newly selected name.
            endTransition()
            displayedScene = scene
            displayedIdentity = sceneIdentity
            timeline.reset(at: CACurrentMediaTime())
            timeline.setRunning(canAnimate, at: CACurrentMediaTime())
        }
        .onDisappear {
            timeline.setRunning(false, at: CACurrentMediaTime())
            endTransition()
        }
    }

    private func composition(_ value: NativeLivingSkyScene, elapsed: Double, time: Double, running: Bool) -> some View {
        NativeLivingSkyComposition(scene: value, isDark: isDark, reading: reading,
            increasedContrast: increasedContrast, reduceTransparency: reduceTransparency,
            driftElapsed: elapsed, driftSampleTime: time, drifting: running && canDrift,
            twinkling: running && canTwinkle, sceneIdentity: sceneIdentity)
    }

    private func accept(_ value: NativeLivingSkyScene) {
        // Forecast updates preserve continuous active-time cloud travel; this
        // never schedules another clock or restarts the accrued motion phase.
        timeline.setRunning(canAnimate, at: CACurrentMediaTime())
        guard displayedIdentity == sceneIdentity, let old = displayedScene, canMove,
              old.source != .unavailable, value.source != .unavailable else {
            endTransition()
            displayedScene = value
            displayedIdentity = sceneIdentity
            return
        }
        let changed = old.family != value.family || old.lightPhase != value.lightPhase
            || old.stormStyle != value.stormStyle
            || abs(old.illumination.sunStrength - value.illumination.sunStrength) > 0.12
            || abs(old.illumination.warmth - value.illumination.warmth) > 0.10
            || abs(old.nightSky.moonVisibility - value.nightSky.moonVisibility) > 0.15
        guard changed, outgoingScene == nil else { displayedScene = value; return }
        outgoingScene = old
        outgoingOpacity = 1
        displayedScene = value
        transitionTask = Task { @MainActor in
            do {
                // Commit the old opaque composition over the new one first.
                try await Task.sleep(for: .milliseconds(20))
                guard !Task.isCancelled else { return }
                withAnimation(.easeInOut(duration: 1.4)) { outgoingOpacity = 0 }
                try await Task.sleep(for: .milliseconds(1450))
                guard !Task.isCancelled else { return }
                outgoingScene = nil
                transitionTask = nil
            } catch { }
        }
    }

    private func endTransition() {
        transitionTask?.cancel()
        transitionTask = nil
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            outgoingScene = nil
            outgoingOpacity = 1
        }
    }
}

/// The approved composition, with continuous compositor-driven cloud layers.
/// Sun, moon, stars, light masks and reading protection stay anchored. Only a
/// few star opacities vary; cloud and star motion share one active-time clock.
private struct NativeLivingSkyComposition: View {
    let scene: NativeLivingSkyScene
    let isDark: Bool
    let reading: Bool
    let increasedContrast: Bool
    let reduceTransparency: Bool
    let driftElapsed: Double
    let driftSampleTime: Double
    let drifting: Bool
    let twinkling: Bool
    let sceneIdentity: String

    private var night: Bool { scene.isDaylight == false }
    private var light: NativeLivingSkyScene.Illumination { scene.illumination }
    private var warmth: Double { light.warmth }
    private var usesAlphaClouds: Bool {
        scene.family == .brokenClouds && scene.lightPhase != .unknown
    }
    private var paper: Color {
        isDark ? Color(red: 0.055, green: 0.10, blue: 0.15)
            : Color(red: 0.93, green: 0.96, blue: 0.97)
    }
    /// An editorial light position, not a compass direction. Only elevation
    /// changes its vertical composition; no device orientation is implied.
    private var sunCenter: UnitPoint {
        let altitude = min(1, max(0, (light.solarElevation ?? 35) / 65))
        return UnitPoint(x: 0.80, y: 0.16 + (1 - altitude) * 0.23)
    }
    private var sunlightColor: Color {
        mix((1, 0.98, 0.89), (1, 0.66, 0.32), warmth)
    }
    private var moonCenter: UnitPoint {
        let altitude = min(1, max(0, (scene.nightSky.moonElevation ?? 0) / 75))
        // An editorial composition, not a compass or an AR sky map.
        return UnitPoint(x: 0.82, y: 0.17 + (1 - altitude) * 0.12)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(colors: airColors, startPoint: .top, endPoint: .bottom)
                if light.sunStrength > 0.01 || warmth > 0.01 {
                    sunlight(size: geometry.size)
                }
                celestialNight(size: geometry.size)
                artwork(size: geometry.size)
                if scene.artwork == .overcast && night && scene.family != .rain && scene.family != .snow {
                    Color(red: 0.025, green: 0.065, blue: 0.12).opacity(0.78)
                }
                if scene.family == .fog {
                    (night ? Color(red: 0.23, green: 0.30, blue: 0.35)
                        : Color(red: 0.76, green: 0.81, blue: 0.82)).opacity(0.62)
                }
                readingVeil
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder private func celestialNight(size: CGSize) -> some View {
        let diameter = min(34, max(25, size.width * 0.075))
        if scene.nightSky.starVisibility > 0 {
            NativeLivingSkyStarsView(visibility: scene.nightSky.starVisibility,
                moonCenter: scene.nightSky.moonVisibility > 0 ? moonCenter : nil,
                moonDiameter: diameter, elapsed: driftElapsed, sampledAt: driftSampleTime,
                running: twinkling, identity: sceneIdentity)
        }
        if scene.nightSky.moonVisibility > 0 {
            let moonlight = scene.nightSky.moonlightStrength
            RadialGradient(stops: [
                .init(color: Color(red: 0.66, green: 0.77, blue: 0.90).opacity(0.16 * moonlight), location: 0),
                .init(color: Color(red: 0.40, green: 0.57, blue: 0.76).opacity(0.07 * moonlight), location: 0.35),
                .init(color: .clear, location: 1)
            ], center: moonCenter, startRadius: 0, endRadius: size.width * 0.63)
            Image("LivingSkyMoon")
                .resizable().interpolation(.high)
                .brightness(0.08)
                .frame(width: diameter, height: diameter)
                .clipShape(Circle())
                .mask(NativeMoonPhaseShape(illumination: scene.nightSky.moonIllumination)
                    .rotationEffect(.degrees(scene.nightSky.moonRotation)))
                .opacity(scene.nightSky.moonVisibility)
                .position(x: size.width * moonCenter.x, y: size.height * moonCenter.y)
        }
    }

    private func sunlight(size: CGSize) -> some View {
        ZStack {
            // Broad atmospheric scatter connects the small source to the sky.
            // No rays, lens flares, yellow icon, or hard-edged decorative disc.
            RadialGradient(stops: [
                .init(color: sunlightColor.opacity(0.63 * light.sunStrength), location: 0),
                .init(color: sunlightColor.opacity(0.29 * light.sunStrength), location: 0.22),
                .init(color: sunlightColor.opacity(0.08 * light.sunStrength), location: 0.57),
                .init(color: sunlightColor.opacity(0), location: 1)
            ], center: sunCenter, startRadius: 0, endRadius: size.width * 0.94)
            // A restrained low-sun wash, below the cool upper air. Radiation
            // cannot create this color: warmth is derived from solar altitude.
            RadialGradient(colors: [
                Color(red: 1, green: 0.61, blue: 0.30).opacity(warmth * 0.53), .clear
            ], center: UnitPoint(x: 0.84, y: 0.49), startRadius: 0, endRadius: size.width * 1.15)
            if light.sunStrength > 0.04 {
                let diameter = size.width * (0.075 + warmth * 0.025)
                RadialGradient(stops: [
                    .init(color: Color(red: 1, green: 0.995, blue: 0.94), location: 0),
                    .init(color: Color(red: 1, green: 0.985, blue: 0.88).opacity(0.96), location: 0.22),
                    .init(color: sunlightColor.opacity(0.54), location: 0.46),
                    .init(color: sunlightColor.opacity(0), location: 1)
                ], center: .center, startRadius: 0, endRadius: diameter * 1.6)
                .frame(width: diameter * 3.2, height: diameter * 3.2)
                .opacity(min(1, light.sunStrength * 1.45))
                .position(x: size.width * sunCenter.x, y: size.height * sunCenter.y)
            }
        }
    }

    @ViewBuilder private func artwork(size: CGSize) -> some View {
        if usesAlphaClouds {
            if night {
                // Cloud alpha occludes every celestial object. Keeping stars
                // and the moon below this layer avoids a cut-out pasted on top.
                cloudLayer(size: size)
                    .colorMultiply(Color(red: 0.16, green: 0.24, blue: 0.35))
                if scene.nightSky.moonlightStrength > 0.01 {
                    cloudLayer(size: size)
                        .colorMultiply(Color(red: 0.47, green: 0.60, blue: 0.74))
                        .mask(RadialGradient(colors: [.white, .white.opacity(0.42), .clear],
                            center: moonCenter, startRadius: 0, endRadius: size.width * 0.90))
                        .opacity(scene.nightSky.moonlightStrength * 0.64)
                }
            } else {
                let exposure = 0.67 + light.cloudIllumination * 0.33
                cloudLayer(size: size)
                    .colorMultiply(mix((0.53, 0.65, 0.78), (1, 1, 1), exposure))
                if warmth > 0.01 {
                    // Preserve premultiplied alpha when tinting fine vapor.
                    cloudLayer(size: size)
                        .colorMultiply(sunlightColor)
                        .mask(RadialGradient(colors: [.white, .white.opacity(0.7), .clear],
                            center: sunCenter, startRadius: 0, endRadius: size.width * 1.1))
                        .opacity(warmth * 0.88)
                }
            }
        } else if scene.family == .rain {
            rainCanopy(size: size)
        } else if scene.family == .snow {
            snowCanopy(size: size)
        } else if let column = atlasColumn {
            Canvas(opaque: true, rendersAsynchronously: true) { context, canvasSize in
                let image = context.resolve(Image("LivingSkyReference"))
                let scale = max(canvasSize.width / 380, canvasSize.height / 1024)
                context.draw(image, in: CGRect(
                    x: (canvasSize.width - 380 * scale) / 2 - CGFloat(column * 384 + 2) * scale,
                    y: 0, width: 1536 * scale, height: 1024 * scale))
            }
        } else if scene.artwork == .overcast {
            cloudLayer(size: size, artwork: .canopy)
        }
    }

    /// The precipitation-free ceiling lets light and rain remain separate.
    /// Current modeled sunlight can reveal a break; rain alone never invents
    /// either a glowing sun or an apocalyptic black storm.
    private func rainCanopy(size: CGSize) -> some View {
        let sunBreak = light.sunStrength > 0.04
        let weight = scene.rainStyle == .heavy ? 0.18 : scene.rainStyle == .steady ? 0.09 : 0.0
        return ZStack {
            cloudLayer(size: size, artwork: .canopy)
                .colorMultiply(night ? Color(red: 0.16, green: 0.23, blue: 0.33)
                    : Color(red: 0.88 - weight, green: 0.94 - weight, blue: 0.98 - weight))
                .opacity(sunBreak ? 0.38 : 1)
            if sunBreak {
                cloudLayer(size: size)
                    .colorMultiply(Color(red: 0.74, green: 0.81, blue: 0.86))
            }
            if scene.stormStyle == .thunderstorm {
                stormCanopy(size: size)
            }
            // A broad, localized low-sun reflection, never diagonal rays or
            // a full-screen orange wash. Geometry already bounds its warmth.
            RadialGradient(colors: [sunlightColor.opacity(warmth * 0.55), .clear],
                center: sunCenter, startRadius: 0, endRadius: size.width * 1.15)
            LinearGradient(colors: [.clear,
                (night ? Color(red: 0.11, green: 0.17, blue: 0.23)
                    : Color(red: 0.62, green: 0.70, blue: 0.75)).opacity(0.16 + weight)],
                startPoint: .top, endPoint: .bottom)
        }
    }

    /// A broad graphite ceiling, diffuse light behind it, and a closer cloud
    /// veil. Movement reveals light through cloud alpha, never by pulsing the
    /// screen. This is modeled storm atmosphere, not detected lightning or a
    /// severity claim; the single existing cloud clock owns its movement.
    private func stormCanopy(size: CGSize) -> some View {
        ZStack {
            LinearGradient(stops: [
                .init(color: Color(red: 0.08, green: 0.13, blue: 0.19).opacity(night ? 0.30 : 0.38), location: 0),
                .init(color: Color(red: 0.20, green: 0.27, blue: 0.32).opacity(0.17), location: 0.33),
                .init(color: .clear, location: 0.69)
            ], startPoint: .topLeading, endPoint: .bottomTrailing)
            // Fixed indirect silver light, partially veiled by foreground
            // clouds. Keep it diffuse: not a sun disc or electrical flash.
            RadialGradient(stops: [
                .init(color: (night ? Color(red: 0.40, green: 0.49, blue: 0.58)
                    : Color(red: 0.85, green: 0.86, blue: 0.82)).opacity(night ? 0.14 : 0.28), location: 0),
                .init(color: (night ? Color(red: 0.29, green: 0.39, blue: 0.48)
                    : Color(red: 0.67, green: 0.74, blue: 0.76)).opacity(night ? 0.06 : 0.12), location: 0.43),
                .init(color: .clear, location: 1)
            ], center: UnitPoint(x: 0.88, y: 0.32), startRadius: 0, endRadius: size.width * 0.89)
            cloudLayer(size: size, artwork: .stormVeil)
                .colorMultiply(night ? Color(red: 0.06, green: 0.10, blue: 0.16)
                    : Color(red: 0.27, green: 0.34, blue: 0.39))
                .mask(LinearGradient(stops: [
                    .init(color: .white, location: 0),
                    .init(color: .white.opacity(0.84), location: 0.23),
                    .init(color: .white.opacity(0.28), location: 0.49),
                    .init(color: .clear, location: 0.70)
                ], startPoint: .top, endPoint: .bottom))
                .opacity(night ? 0.44 : 0.57)
        }
    }

    /// Snow has diffuse winter light, not a blue filter or a whiteout. The
    /// complete still remains when particles are disabled for reading/power.
    private func snowCanopy(size: CGSize) -> some View {
        ZStack {
            cloudLayer(size: size, artwork: .canopy)
                .colorMultiply(night ? Color(red: 0.20, green: 0.27, blue: 0.36)
                    : Color(red: 0.75, green: 0.83, blue: 0.87))
            LinearGradient(colors: [
                (night ? Color(red: 0.14, green: 0.21, blue: 0.30)
                    : Color(red: 0.66, green: 0.74, blue: 0.78)).opacity(0.22),
                (night ? Color(red: 0.28, green: 0.35, blue: 0.42)
                    : Color(red: 0.90, green: 0.92, blue: 0.91)).opacity(0.30), .clear
            ], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [sunlightColor.opacity(warmth * 0.55), .clear],
                center: sunCenter, startRadius: 0, endRadius: size.width * 1.15)
        }
    }

    private func cloudLayer(size: CGSize, artwork: NativeSkyCloudArtwork = .brokenClouds) -> some View {
        NativeLivingSkyCloudMotionView(elapsed: driftElapsed, sampledAt: driftSampleTime,
            running: drifting, identity: sceneIdentity, artwork: artwork)
            .frame(width: size.width, height: size.height)
    }

    private var atlasColumn: Int? {
        switch scene.artwork {
        case .rainClouds: return 1
        default: return nil
        }
    }

    private var airColors: [Color] {
        if scene.artwork == .neutral {
            return night
                ? [Color(red: 0.06, green: 0.10, blue: 0.15), Color(red: 0.20, green: 0.27, blue: 0.32)]
                : [Color(red: 0.40, green: 0.49, blue: 0.55), Color(red: 0.68, green: 0.75, blue: 0.78)]
        }
        if scene.lightPhase == .night {
            return [
                mix((0.014, 0.027, 0.060), (0.025, 0.055, 0.105), scene.nightSky.moonlightStrength),
                mix((0.045, 0.082, 0.145), (0.085, 0.15, 0.23), scene.nightSky.moonlightStrength)
            ]
        }
        return [
            mix((0.10, 0.36, 0.62), (0.12, 0.24, 0.39), warmth),
            mix((0.42, 0.67, 0.84), (0.56, 0.61, 0.66), warmth),
            mix((0.76, 0.87, 0.92), (0.94, 0.72, 0.51), warmth)
        ]
    }

    private func mix(_ cool: (Double, Double, Double), _ warm: (Double, Double, Double), _ fraction: Double) -> Color {
        Color(red: cool.0 + (warm.0 - cool.0) * fraction,
              green: cool.1 + (warm.1 - cool.1) * fraction,
              blue: cool.2 + (warm.2 - cool.2) * fraction)
    }

    private var readingVeil: some View {
        let dense = reading || increasedContrast || reduceTransparency
        // A forced light interface must remain readable over a local night or
        // rain scene. Appearance changes exposure, never the weather family.
        let lightExposure: Double = night || scene.source == .unavailable ? 0.64
            : (scene.family == .rain ? 0.60 : (scene.artwork == .overcast ? 0.54 : 0.40))
        // Broad ink protection covers the complete hero, never a visible
        // circle around the temperature. The edges retain atmospheric detail.
        // Night artwork is already low-luminance. A lighter hero veil keeps
        // silver moonlight visible; daytime and dense reading stay protected.
        let upper = dense ? (isDark ? 0.86 : 0.91) : (isDark ? (night ? 0.22 : 0.68) : lightExposure)
        let middle = dense ? upper : (isDark ? (night ? 0.40 : 0.70) : lightExposure + 0.06)
        let lower = dense ? 0.98 : (isDark ? 0.92 : 0.94)
        return LinearGradient(stops: [
            .init(color: paper.opacity(upper), location: 0),
            .init(color: paper.opacity(middle), location: 0.42),
            .init(color: paper.opacity(dense ? lower : middle), location: 0.62),
            .init(color: paper.opacity(lower), location: 1)
        ], startPoint: .top, endPoint: .bottom)
    }
}

/// The projected terminator of a lit sphere, not an offset-circle crescent.
/// At 0.5 this is exactly a half disc; at 1 it is the complete disc. Rotation
/// comes from the bright limb relative to local zenith, so don't mirror again
/// for waxing, waning, or the Southern Hemisphere.
private struct NativeMoonPhaseShape: Shape {
    let illumination: Double

    func path(in rect: CGRect) -> Path {
        let fraction = min(1, max(0, illumination))
        guard fraction > 0 else { return Path() }
        let radius = min(rect.width, rect.height) / 2
        let terminator = 1 - 2 * fraction
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.midY - radius))
        for index in 1...80 {
            let y = -1 + 2 * Double(index) / 80
            path.addLine(to: CGPoint(x: rect.midX + radius * sqrt(max(0, 1 - y * y)),
                y: rect.midY + radius * y))
        }
        for index in stride(from: 79, through: 0, by: -1) {
            let y = -1 + 2 * Double(index) / 80
            path.addLine(to: CGPoint(x: rect.midX + radius * terminator * sqrt(max(0, 1 - y * y)),
                y: rect.midY + radius * y))
        }
        path.closeSubpath()
        return path
    }
}
