import SwiftUI
import UIKit

/// A cached, anchored star field with at most six compositor opacity curves.
/// The caller seeds active time on creation/identity changes. The view banks
/// its own phase while paused, including star-only accessibility pauses when
/// clouds may still advance. Weather updates never restart an existing loop.
struct NativeLivingSkyStarsView: UIViewRepresentable {
    let visibility: Double
    let moonCenter: UnitPoint?
    let moonDiameter: CGFloat
    let elapsed: Double
    let sampledAt: Double
    let running: Bool
    let identity: String

    func makeUIView(context: Context) -> NativeSkyStarsView { NativeSkyStarsView() }

    func updateUIView(_ view: NativeSkyStarsView, context: Context) {
        view.configure(visibility: visibility, moonCenter: moonCenter, moonDiameter: moonDiameter,
            elapsed: elapsed, sampledAt: sampledAt, running: running, identity: identity)
    }

    static func dismantleUIView(_ view: NativeSkyStarsView, coordinator: ()) { view.stop() }
}

/// One steady image and six fixed star layers. No timers, display links,
/// per-frame SwiftUI state, transform animations, or asynchronous work exist.
final class NativeSkyStarsView: UIView {
    private struct TwinklingStar {
        let star: NativeSkyStarField.Star
        let layer: CALayer
    }

    private let field = CALayer()
    private let steady = CALayer()
    private var twinklers: [TwinklingStar] = []
    private var visibility = 0.0
    private var moonCenter: UnitPoint?
    private var moonDiameter: CGFloat = 0
    private var elapsed = 0.0
    private var sampledAt = 0.0
    private var requestedRunning = false
    private var clockRunning = false
    private var identity = ""
    private var configured = false
    private var renderedSize = CGSize.zero
    private var renderedScale: CGFloat = 0
    private static let animationKey = "nearcast.star-twinkle"

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        clipsToBounds = true
        field.name = "nearcast.stars.field"
        field.allowsGroupOpacity = false
        steady.name = "nearcast.stars.steady"
        layer.addSublayer(field)
        field.addSublayer(steady)
        buildTwinklers()
    }

    required init?(coder: NSCoder) { nil }

    override var isHidden: Bool {
        didSet { if oldValue != isHidden { reconcileAnimations() } }
    }

    override var alpha: CGFloat {
        didSet { if oldValue != alpha { reconcileAnimations() } }
    }

    func configure(visibility: Double, moonCenter: UnitPoint?, moonDiameter: CGFloat,
                   elapsed: Double, sampledAt: Double, running: Bool, identity: String) {
        let now = CACurrentMediaTime()
        let nextMoon: UnitPoint? = moonCenter.flatMap {
            $0.x.isFinite && $0.y.isFinite && moonDiameter.isFinite ? $0 : nil
        }
        let nextDiameter = moonDiameter.isFinite ? max(0, moonDiameter) : 0
        let moonChanged = self.moonCenter != nextMoon || self.moonDiameter != nextDiameter
        let identityChanged = !configured || self.identity != identity
        self.visibility = visibility.isFinite ? min(1, max(0, visibility)) : 0
        self.moonCenter = nextMoon
        self.moonDiameter = nextDiameter
        self.identity = identity
        self.requestedRunning = running
        if identityChanged {
            let inputElapsed = elapsed.isFinite ? max(0, elapsed) : 0
            let inputTime = sampledAt.isFinite ? sampledAt : now
            let total = inputElapsed + (running ? max(0, now - inputTime) : 0)
            self.elapsed = total.isFinite ? total : Double.greatestFiniteMagnitude
            self.sampledAt = now
        }
        configured = true
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        field.opacity = Float(self.visibility)
        if moonChanged { redrawSteadyField() }
        CATransaction.commit()
        reconcileAnimations(reset: identityChanged)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = max(1, contentScaleFactor)
        guard renderedSize != bounds.size || renderedScale != scale else { return }
        renderedSize = bounds.size
        renderedScale = scale
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        field.frame = bounds
        steady.frame = field.bounds
        steady.contentsScale = scale
        for value in twinklers {
            value.layer.position = CGPoint(x: bounds.width * value.star.x, y: bounds.height * value.star.y)
            value.layer.contentsScale = scale
            value.layer.sublayers?.forEach { $0.contentsScale = scale }
        }
        redrawSteadyField()
        CATransaction.commit()
        // A resize changes positions only; existing opacity clocks survive.
        reconcileAnimations()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Detachment banks active progress and immediately removes all loops.
        // Reattachment can resume the same phase if the owner still allows it.
        reconcileAnimations()
    }

    /// Final teardown clears intent as well as every compositor animation.
    func stop() {
        requestedRunning = false
        reconcileAnimations()
    }

    private var validBounds: Bool {
        bounds.width.isFinite && bounds.height.isFinite && bounds.width > 0 && bounds.height > 0
    }

    private func activeElapsed(at time: Double) -> Double {
        let total = elapsed + (clockRunning ? max(0, time - sampledAt) : 0)
        return total.isFinite ? total : Double.greatestFiniteMagnitude
    }

    private func occluded(_ star: NativeSkyStarField.Star) -> Bool {
        star.isOccluded(width: bounds.width, height: bounds.height,
            moonX: moonCenter.map { Double($0.x) }, moonY: moonCenter.map { Double($0.y) },
            moonDiameter: Double(moonDiameter))
    }

    private func buildTwinklers() {
        for (index, star) in NativeSkyStarField.stars.enumerated() where star.twinkle != nil {
            let value = CALayer()
            value.name = "nearcast.star.\(index)"
            // Apply brightness to the halo and core separately, retaining
            // the original source-over drawing at baseline opacity.
            value.allowsGroupOpacity = false
            // Retain precisely the original 3.6-diameter halo and core radius.
            let extent = star.radius > 1 ? star.radius * 3.6 : star.radius
            value.bounds = CGRect(x: 0, y: 0, width: extent * 2, height: extent * 2)
            if star.radius > 1 {
                let halo = CAShapeLayer()
                halo.name = "nearcast.star.\(index).halo"
                halo.frame = value.bounds
                halo.path = CGPath(ellipseIn: value.bounds, transform: nil)
                halo.fillColor = UIColor(red: 0.64, green: 0.77, blue: 0.96, alpha: 0.06).cgColor
                value.addSublayer(halo)
            }
            let core = CAShapeLayer()
            core.name = "nearcast.star.\(index).core"
            core.frame = value.bounds
            core.path = CGPath(ellipseIn: CGRect(x: extent - star.radius, y: extent - star.radius,
                width: star.radius * 2, height: star.radius * 2), transform: nil)
            core.fillColor = UIColor(red: 0.87, green: 0.93, blue: 1, alpha: 1).cgColor
            value.addSublayer(core)
            value.opacity = Float(star.opacity)
            field.addSublayer(value)
            twinklers.append(TwinklingStar(star: star, layer: value))
        }
    }

    private func redrawSteadyField() {
        guard validBounds else { steady.contents = nil; return }
        let format = UIGraphicsImageRendererFormat()
        format.opaque = false
        format.scale = max(1, contentScaleFactor)
        let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { renderer in
            let context = renderer.cgContext
            for star in NativeSkyStarField.stars where star.twinkle == nil && !occluded(star) {
                let point = CGPoint(x: bounds.width * star.x, y: bounds.height * star.y)
                let diameter = star.radius * 2
                if star.radius > 1 {
                    context.setFillColor(UIColor(red: 0.64, green: 0.77, blue: 0.96,
                        alpha: star.opacity * 0.06).cgColor)
                    context.fillEllipse(in: CGRect(x: point.x - diameter * 1.8, y: point.y - diameter * 1.8,
                        width: diameter * 3.6, height: diameter * 3.6))
                }
                context.setFillColor(UIColor(red: 0.87, green: 0.93, blue: 1, alpha: star.opacity).cgColor)
                context.fillEllipse(in: CGRect(x: point.x - star.radius, y: point.y - star.radius,
                    width: diameter, height: diameter))
            }
        }
        steady.contents = image.cgImage
    }

    private func reconcileAnimations(reset: Bool = false) {
        let now = CACurrentMediaTime()
        let current = activeElapsed(at: now)
        let shouldRun = configured && requestedRunning && window != nil
            && !isHidden && alpha.isFinite && alpha > 0 && visibility > 0 && validBounds
        if clockRunning != shouldRun {
            elapsed = current
            sampledAt = now
            clockRunning = shouldRun
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for value in twinklers {
            let hidden = !validBounds || occluded(value.star)
            value.layer.isHidden = hidden
            if reset || !shouldRun || hidden { value.layer.removeAnimation(forKey: Self.animationKey) }
            value.layer.opacity = Float(value.star.opacity(elapsed: current))
            guard shouldRun, !hidden, value.layer.animation(forKey: Self.animationKey) == nil,
                  let profile = value.star.twinkle else { continue }
            let animation = CAKeyframeAnimation(keyPath: "opacity")
            animation.values = (0...120).map {
                min(1, max(0, value.star.opacity * profile.multiplier(phase: Double($0) / 120)))
            }
            animation.duration = profile.duration
            animation.calculationMode = .linear
            animation.timingFunction = CAMediaTimingFunction(name: .linear)
            animation.repeatCount = .infinity
            animation.beginTime = value.layer.convertTime(now, from: nil) - profile.phase(elapsed: current) * profile.duration
            animation.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
            value.layer.add(animation, forKey: Self.animationKey)
        }
        CATransaction.commit()
    }
}
