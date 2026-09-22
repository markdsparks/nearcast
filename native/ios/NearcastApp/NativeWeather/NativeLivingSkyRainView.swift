import SwiftUI
import UIKit

/// A small, native particle field. Core Animation advances the rain; there is
/// no display link, SwiftUI frame clock, forecast work, or network dependency.
struct NativeLivingSkyRainView: UIViewRepresentable {
    let style: NativeLivingSkyScene.RainStyle
    let active: Bool
    let immediateStop: Bool
    let identity: String
    let isNight: Bool
    /// Hero bounds in window coordinates; layout changes never restart rain.
    var focus: CGRect? = nil

    func makeUIView(context: Context) -> NativeSkyRainView { NativeSkyRainView() }

    func updateUIView(_ view: NativeSkyRainView, context: Context) {
        view.configure(style: style, active: active, immediateStop: immediateStop,
                       identity: identity, isNight: isNight, focus: focus)
    }

    static func dismantleUIView(_ view: NativeSkyRainView, coordinator: ()) {
        view.stopImmediately()
    }
}

/// Snow shares rain's small, cancellable compositor lifecycle. Only the
/// particle profile changes; there is no separate simulation or frame clock.
struct NativeLivingSkySnowView: UIViewRepresentable {
    let style: NativeLivingSkyScene.SnowStyle
    let active: Bool
    let immediateStop: Bool
    let identity: String
    let isNight: Bool

    func makeUIView(context: Context) -> NativeSkyRainView { NativeSkyRainView() }

    func updateUIView(_ view: NativeSkyRainView, context: Context) {
        view.configureSnow(style: style, active: active, immediateStop: immediateStop,
                           identity: identity, isNight: isNight)
    }

    static func dismantleUIView(_ view: NativeSkyRainView, coordinator: ()) {
        view.stopImmediately()
    }
}

/// Intentionally separate from the sky plate: disabling motion leaves a
/// complete still sky, not suspended precipitation. The historical class name
/// preserves the rain host API; both precipitation types use this lifecycle.
/// Two emitter layers own finite-lived particles and cached alpha textures.
final class NativeSkyRainView: UIView {
    private enum Precipitation: Equatable {
        case rain(NativeLivingSkyScene.RainStyle)
        case snow(NativeLivingSkyScene.SnowStyle)

        var isSnow: Bool {
            if case .snow = self { return true }
            return false
        }

        var namespace: String { isSnow ? "nearcast.snow" : "nearcast.rain" }

        var isNone: Bool {
            switch self {
            case .rain(let style): return style == .none
            case .snow(let style): return style == .none
            }
        }
    }

    private struct ParticleTuning {
        let farBirths: Float
        let nearBirths: Float
        let farSpeed: CGFloat
        let nearSpeed: CGFloat
        let farScale: CGFloat
        let nearScale: CGFloat
        let opacity: Float

        static func forRain(_ style: NativeLivingSkyScene.RainStyle) -> ParticleTuning? {
            switch style {
            case .none: return nil
            case .drizzle:
                return ParticleTuning(farBirths: 11, nearBirths: 2, farSpeed: 225, nearSpeed: 350,
                                  farScale: 0.36, nearScale: 0.54, opacity: 0.38)
            case .light:
                return ParticleTuning(farBirths: 19, nearBirths: 5, farSpeed: 260, nearSpeed: 415,
                                  farScale: 0.52, nearScale: 0.76, opacity: 0.55)
            case .steady:
                return ParticleTuning(farBirths: 28, nearBirths: 9, farSpeed: 295, nearSpeed: 475,
                                  farScale: 0.62, nearScale: 0.91, opacity: 0.60)
            case .heavy:
                return ParticleTuning(farBirths: 36, nearBirths: 14, farSpeed: 335, nearSpeed: 535,
                                  farScale: 0.72, nearScale: 1.0, opacity: 0.64)
            }
        }

        static func forSnow(_ style: NativeLivingSkyScene.SnowStyle) -> ParticleTuning? {
            switch style {
            case .none: return nil
            case .light:
                return ParticleTuning(farBirths: 2.8, nearBirths: 0.8, farSpeed: 30, nearSpeed: 52,
                                      farScale: 0.38, nearScale: 0.66, opacity: 0.54)
            case .steady:
                return ParticleTuning(farBirths: 4.8, nearBirths: 1.5, farSpeed: 34, nearSpeed: 60,
                                      farScale: 0.43, nearScale: 0.74, opacity: 0.64)
            case .heavy:
                return ParticleTuning(farBirths: 7.8, nearBirths: 2.4, farSpeed: 37, nearSpeed: 68,
                                      farScale: 0.47, nearScale: 0.81, opacity: 0.70)
            }
        }

        static func forPrecipitation(_ precipitation: Precipitation) -> ParticleTuning? {
            switch precipitation {
            case .rain(let style): return forRain(style)
            case .snow(let style): return forSnow(style)
            }
        }
    }

    private var configured = false
    private var precipitation: Precipitation = .rain(.none)
    private var requestedActive = false
    private var immediateStop = false
    private var identity = ""
    private var isNight = false
    private var focus: CGRect?
    private var renderedSize = CGSize.zero
    private var field: CALayer?
    private var emitters: [CAEmitterLayer] = []
    private var removalTask: Task<Void, Never>?
    private static let fadeDuration = 0.18
    private static let streak = makeStreak()
    private static let flake = makeFlake()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        clipsToBounds = true
    }

    required init?(coder: NSCoder) { nil }

    func configure(style: NativeLivingSkyScene.RainStyle, active: Bool,
                   immediateStop: Bool, identity: String, isNight: Bool, focus: CGRect? = nil) {
        configure(precipitation: .rain(style), active: active, immediateStop: immediateStop,
                  identity: identity, isNight: isNight, focus: focus)
    }

    func configureSnow(style: NativeLivingSkyScene.SnowStyle, active: Bool,
                       immediateStop: Bool, identity: String, isNight: Bool) {
        configure(precipitation: .snow(style), active: active, immediateStop: immediateStop,
                  identity: identity, isNight: isNight, focus: nil)
    }

    private func configure(precipitation: Precipitation, active: Bool,
                           immediateStop: Bool, identity: String, isNight: Bool, focus: CGRect?) {
        let contentChanged = !configured || self.identity != identity || self.precipitation != precipitation
            || self.isNight != isNight
        self.precipitation = precipitation
        self.requestedActive = active
        self.immediateStop = immediateStop
        self.identity = identity
        self.isNight = isNight
        self.focus = focus
        configured = true

        if contentChanged { clearField() }
        if immediateStop || precipitation.isNone {
            clearField()
        } else if shouldRun {
            // A return during the short fade starts fresh. Frozen particles
            // cannot resume with stale time, and refreshes do not restart them.
            if removalTask != nil { clearField() }
            if field == nil { buildField() }
            else { updateReadingMask() }
        } else {
            stopWithFade()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard renderedSize != bounds.size else { return }
        renderedSize = bounds.size
        // The narrow, overscanned source follows the actual viewport. Rebuild
        // only on a size change, never on a normal weather-state refresh.
        clearField()
        if shouldRun { buildField() }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { clearField() }
        else if shouldRun, field == nil { buildField() }
    }

    func stopImmediately() {
        requestedActive = false
        clearField()
    }

    private var shouldRun: Bool {
        configured && requestedActive && !immediateStop && !precipitation.isNone
            && window != nil && !bounds.isEmpty
    }

    private func buildField() {
        guard shouldRun, field == nil,
              let tuning = ParticleTuning.forPrecipitation(precipitation),
              let texture = precipitation.isSnow ? Self.flake : Self.streak else { return }
        let size = bounds.size
        let root = CALayer()
        root.name = "\(precipitation.namespace)-field"
        root.frame = bounds
        root.masksToBounds = true

        // Keep the text quiet, not the entire lower half of the screen. Rain
        // needs visible side gutters beside a hero displaced by places/alerts.
        let sideMask = CAGradientLayer()
        sideMask.frame = root.bounds
        sideMask.startPoint = CGPoint(x: 0, y: 0.5)
        sideMask.endPoint = CGPoint(x: 1, y: 0.5)
        sideMask.locations = precipitation.isSnow ? [0, 0.14, 0.36, 0.64, 0.86, 1]
            : [0, 0.14, 0.29, 0.71, 0.86, 1]
        let sideOpacity = precipitation.isSnow ? [0.82, 0.68, 0.10, 0.10, 0.68, 0.82]
            : [0.95, 1.0, 0.14, 0.14, 1.0, 0.95]
        sideMask.colors = sideOpacity.map {
            UIColor.white.withAlphaComponent($0).cgColor
        }
        root.mask = sideMask

        let particleGroup = CALayer()
        particleGroup.name = "\(precipitation.namespace)-depths"
        particleGroup.frame = root.bounds
        let readingMask = CAGradientLayer()
        readingMask.name = "\(precipitation.namespace)-reading-mask"
        readingMask.frame = particleGroup.bounds
        readingMask.startPoint = CGPoint(x: 0.5, y: 0)
        readingMask.endPoint = CGPoint(x: 0.5, y: 1)
        readingMask.locations = [0, 0.12, 0.35, 0.58, 0.82, 1]
        readingMask.colors = [0.65, 1.0, 0.72, 0.28, 0.0, 0.0].map {
            UIColor.white.withAlphaComponent($0).cgColor
        }
        particleGroup.mask = readingMask
        root.addSublayer(particleGroup)

        // Emission is capped independently of screen area. Even a large
        // viewport cannot turn the field into an unbounded particle budget.
        let widthFactor = Float(min(1.35, max(0.65, size.width / 430)))
        // Against bright overcast, a quiet slate reflection reads more
        // naturally than pale streaks that disappear into the cloud plate.
        // Night rain instead catches a little cool light.
        let tint: CGColor
        if precipitation.isSnow {
            tint = (isNight ? UIColor(red: 0.82, green: 0.88, blue: 0.94, alpha: 1)
                    : UIColor(red: 0.43, green: 0.51, blue: 0.58, alpha: 1)).cgColor
        } else {
            tint = (isNight ? UIColor(red: 0.70, green: 0.81, blue: 0.91, alpha: 1)
                    : UIColor(red: 0.32, green: 0.45, blue: 0.54, alpha: 1)).cgColor
        }
        let far = makeEmitter(name: "\(precipitation.namespace)-far", seed: 0x4e434631,
                              births: min(46, tuning.farBirths * widthFactor),
                              speed: tuning.farSpeed, scale: tuning.farScale,
                              opacity: tuning.opacity * 0.78, tint: tint, texture: texture,
                              isNear: false)
        let near = makeEmitter(name: "\(precipitation.namespace)-near", seed: 0x4e434e32,
                               births: min(18, tuning.nearBirths * widthFactor),
                               speed: tuning.nearSpeed, scale: tuning.nearScale,
                               opacity: tuning.opacity, tint: tint, texture: texture,
                               isNear: true)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        particleGroup.addSublayer(far)
        particleGroup.addSublayer(near)
        layer.addSublayer(root)
        // CAEmitterLayer's simulation begins at its layer beginTime. Start
        // each new field at zero local age, in its actual parent's time space,
        // rather than inheriting the default origin at system boot. This is
        // also what makes reappearance a fresh shower instead of a time jump.
        let start = particleGroup.convertTime(CACurrentMediaTime(), from: nil)
        far.beginTime = start
        near.beginTime = start
        CATransaction.commit()
        emitters = [far, near]
        field = root
        updateReadingMask()
    }

    /// Global SwiftUI geometry and UIKit's window coordinates share the same
    /// origin. Convert here so safe-area/navigation offsets aren't guessed.
    /// A missing/invalid/offscreen focus has a safe, visible fallback.
    private func updateReadingMask() {
        guard !precipitation.isSnow, bounds.height > 0,
              let mask = field?.sublayers?.first?.mask as? CAGradientLayer else { return }
        var locations: [CGFloat] = [0, 0.12, 0.68, 0.86, 1]
        if let focus, [focus.minX, focus.minY, focus.width, focus.height].allSatisfy(\.isFinite),
           focus.width > 0, focus.height > 0 {
            let local = convert(focus, from: nil).intersection(bounds)
            if !local.isNull && !local.isEmpty {
                let top = max(0, local.minY / bounds.height - 0.08)
                let bottom = min(1, local.maxY / bounds.height + 0.025)
                locations = [0, top, bottom, min(1, bottom + 0.10), 1]
            }
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        mask.locations = locations.map { NSNumber(value: Double($0)) }
        mask.colors = [0.65, 1.0, 1.0, 0.0, 0.0].map {
            UIColor.white.withAlphaComponent($0).cgColor
        }
        CATransaction.commit()
    }

    private func makeEmitter(name: String, seed: UInt32, births: Float, speed: CGFloat,
                             scale: CGFloat, opacity: Float, tint: CGColor,
                             texture: CGImage, isNear: Bool) -> CAEmitterLayer {
        let snow = precipitation.isSnow
        let emitter = CAEmitterLayer()
        emitter.name = name
        emitter.frame = bounds
        emitter.emitterShape = .line
        emitter.emitterMode = .surface
        emitter.emitterPosition = CGPoint(x: bounds.midX - (snow ? 0 : 24), y: snow ? -8 : -30)
        emitter.emitterSize = CGSize(width: bounds.width + 160, height: 1)
        emitter.renderMode = .unordered
        emitter.seed = seed

        let cell = CAEmitterCell()
        cell.name = snow ? "snow-speck" : "streak"
        cell.contents = texture
        cell.contentsScale = 2
        cell.color = tint
        cell.birthRate = births
        // Fade below the visible field before particles expire. Short bounded
        // lifetimes also make the renderer's steady-state budget predictable.
        cell.lifetime = Float(min(snow ? 16 : 4.5,
                                  max(snow ? 3 : 1.1, (bounds.height * 0.88 + 40) / speed)))
        cell.lifetimeRange = snow ? 0.45 : 0.16
        cell.velocity = speed
        cell.velocityRange = speed * (snow ? 0.27 : 0.13)
        // A horizontal .line's natural direction is upward, so pi turns its
        // local emission downward. pi/2 would send rain sideways above the
        // viewport. The small offset adds a restrained rightward slant.
        cell.emissionLongitude = .pi - (snow ? (isNear ? 0.11 : -0.08) : 0.055)
        cell.emissionRange = snow ? 0.28 : 0.045
        // Tiny opposing lateral acceleration makes individual snow paths
        // drift gently rather than forming a repeated diagonal pattern.
        // It is compositor-owned and bounded by the finite cell lifetime.
        cell.xAcceleration = snow ? (isNear ? -0.48 : 0.34) : 0
        cell.scale = scale
        cell.scaleRange = scale * (snow ? 0.28 : 0.16)
        // Snow's soft fade is unchanged. Rain keeps its contrast through the
        // hero; the layout-aware mask handles the exit below the reading zone.
        // The former full-lifetime fade multiplied two masks to near-zero.
        cell.alphaSpeed = -(snow ? opacity : opacity * 0.22) / max(0.8, cell.lifetime)
        cell.alphaRange = 0.06
        // Tint supplies hue; opacity stays modest before the readability masks.
        cell.color = UIColor(cgColor: tint).withAlphaComponent(CGFloat(opacity)).cgColor
        emitter.emitterCells = [cell]
        return emitter
    }

    private func stopWithFade() {
        guard let field, removalTask == nil else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for emitter in emitters {
            let localTime = emitter.convertTime(CACurrentMediaTime(), from: nil)
            emitter.speed = 0
            emitter.timeOffset = localTime
            emitter.birthRate = 0
        }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = field.presentation()?.opacity ?? field.opacity
        fade.toValue = 0
        fade.duration = Self.fadeDuration
        fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
        fade.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
        field.opacity = 0
        field.add(fade, forKey: "\(precipitation.namespace)-disappear")
        CATransaction.commit()
        removalTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(Self.fadeDuration)) }
            catch { return }
            guard !Task.isCancelled else { return }
            self?.clearField()
        }
    }

    private func clearField() {
        removalTask?.cancel()
        removalTask = nil
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for emitter in emitters {
            emitter.birthRate = 0
            emitter.emitterCells = nil
            emitter.removeAllAnimations()
            emitter.removeFromSuperlayer()
        }
        field?.removeAllAnimations()
        field?.removeFromSuperlayer()
        CATransaction.commit()
        emitters.removeAll()
        field = nil
    }

    private static func makeStreak() -> CGImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: 3, height: 24), format: format).image { renderer in
            let context = renderer.cgContext
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0.35, y: 0))
            path.addLine(to: CGPoint(x: 1.05, y: 0))
            path.addLine(to: CGPoint(x: 2.35, y: 24))
            path.addLine(to: CGPoint(x: 1.65, y: 24))
            path.closeSubpath()
            context.addPath(path)
            context.clip()
            let colors = [UIColor.white.withAlphaComponent(0).cgColor,
                          UIColor.white.withAlphaComponent(0.9).cgColor,
                          UIColor.white.withAlphaComponent(0).cgColor] as CFArray
            guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                            colors: colors, locations: [0, 0.68, 1]) else { return }
            context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: 24), options: [])
        }.cgImage
    }

    private static func makeFlake() -> CGImage? {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4), format: format).image { renderer in
            let context = renderer.cgContext
            let colors = [UIColor.white.cgColor,
                          UIColor.white.withAlphaComponent(0.88).cgColor,
                          UIColor.white.withAlphaComponent(0).cgColor] as CFArray
            guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                            colors: colors, locations: [0, 0.36, 1]) else { return }
            // An irregularly scaled, feather-edged speck reads as snow at
            // these sizes. No crystal icons, large bokeh circles, or blur pass.
            context.translateBy(x: 2, y: 2)
            context.scaleBy(x: 0.86, y: 1)
            context.drawRadialGradient(gradient, startCenter: .zero, startRadius: 0,
                                       endCenter: .zero, endRadius: 2, options: [])
        }.cgImage
    }
}
