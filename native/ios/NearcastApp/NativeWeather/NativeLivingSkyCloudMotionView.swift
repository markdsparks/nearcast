import SwiftUI
import UIKit

/// Cached artwork, translated by the compositor. Base and light-tinted
/// instances share active time, so cloud silhouettes and illumination agree.
struct NativeLivingSkyCloudMotionView: UIViewRepresentable {
    let elapsed: Double
    let sampledAt: Double
    let running: Bool
    let identity: String
    var artwork: NativeSkyCloudArtwork = .brokenClouds

    func makeUIView(context: Context) -> NativeSkyCloudImageView { NativeSkyCloudImageView() }

    func updateUIView(_ view: NativeSkyCloudImageView, context: Context) {
        view.configure(elapsed: elapsed, sampledAt: sampledAt, running: running,
                       identity: identity, artwork: artwork)
    }

    static func dismantleUIView(_ view: NativeSkyCloudImageView, coordinator: ()) { view.stop() }
}

final class NativeSkyCloudImageView: UIView {
    private struct CloudCopy {
        let layer: CALayer
        let plane: NativeSkyCloudPlane
        let index: Int
    }

    private var clouds: [CloudCopy] = []
    private var opaqueBase: CALayer?
    private var artwork: NativeSkyCloudArtwork = .brokenClouds
    private var elapsed = 0.0
    private var sampledAt = 0.0
    private var running = false
    private var identity = ""
    private var renderedSize = CGSize.zero
    private var configured = false
    private static let images: [NativeSkyCloudArtwork: CGImage] = {
        Dictionary(uniqueKeysWithValues: NativeSkyCloudArtwork.allCases.compactMap { artwork in
            UIImage(named: artwork.assetName)?.cgImage.map { (artwork, $0) }
        })
    }()
    private static let animationKey = "nearcast.cloud-drift"

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
        accessibilityElementsHidden = true
        clipsToBounds = true
        buildClouds()
    }

    required init?(coder: NSCoder) { nil }

    func configure(elapsed: Double, sampledAt: Double, running: Bool, identity: String,
                   artwork: NativeSkyCloudArtwork = .brokenClouds) {
        let profileChanged = self.artwork != artwork
        let needsUpdate = !configured || self.running != running || self.identity != identity || profileChanged
        self.elapsed = elapsed.isFinite ? max(0, elapsed) : 0
        self.sampledAt = sampledAt.isFinite ? sampledAt : CACurrentMediaTime()
        self.running = running
        self.identity = identity
        self.artwork = artwork
        configured = true
        if profileChanged { buildClouds() }
        if needsUpdate || !running { applyMotion() }
    }

    private func imageLayer(name: String) -> CALayer {
        let value = CALayer()
        value.name = name
        value.contents = Self.images[artwork]
        value.contentsGravity = .resizeAspectFill
        value.magnificationFilter = .linear
        value.minificationFilter = .trilinear
        layer.addSublayer(value)
        return value
    }

    private func buildClouds() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        clouds.forEach { $0.layer.removeAllAnimations(); $0.layer.removeFromSuperlayer() }
        clouds.removeAll()
        opaqueBase?.removeFromSuperlayer()
        opaqueBase = nil
        if artwork == .canopy {
            // Source-over crossfades of opaque copies are NOT opaque at their
            // midpoint. Keep a complete ceiling underneath, so recycling can
            // never invent a bright sky opening in overcast/rain/snow.
            opaqueBase = imageLayer(name: "nearcast.cloud.ceiling")
        }
        for plane in artwork.planes {
            for index in 0..<2 {
                clouds.append(CloudCopy(layer: imageLayer(name: "nearcast.cloud.\(plane.name).\(index)"),
                                        plane: plane, index: index))
            }
        }
        layoutClouds()
        CATransaction.commit()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard renderedSize != bounds.size else { return }
        renderedSize = bounds.size
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layoutClouds()
        CATransaction.commit()
        applyMotion()
    }

    private func layoutClouds() {
        opaqueBase?.frame = bounds
        for cloud in clouds {
            cloud.layer.bounds = CGRect(origin: .zero, size: CGSize(
                width: (bounds.width + cloud.plane.horizontalOverscan) * cloud.plane.scale,
                height: (bounds.height + cloud.plane.verticalOverscan) * cloud.plane.scale))
            cloud.layer.position = CGPoint(x: bounds.midX, y: bounds.midY + cloud.plane.verticalOffset)
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { stop() } else { applyMotion() }
    }

    func stop() {
        elapsed = activeElapsed(at: CACurrentMediaTime())
        sampledAt = CACurrentMediaTime()
        running = false
        applyMotion()
    }

    private func activeElapsed(at time: Double) -> Double {
        let total = elapsed + (running ? max(0, time - sampledAt) : 0)
        return total.isFinite ? total : Double.greatestFiniteMagnitude
    }

    private func transform(_ sample: NativeSkyCloudPlane.Sample) -> CATransform3D {
        CATransform3DMakeTranslation(sample.x, sample.y, 0)
    }

    private func applyMotion() {
        let time = CACurrentMediaTime()
        let current = activeElapsed(at: time)
        let shouldRun = running && window != nil && !bounds.isEmpty
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for cloud in clouds {
            let plane = cloud.plane
            let sample = plane.sample(elapsed: current, copy: cloud.index)
            cloud.layer.removeAnimation(forKey: Self.animationKey)
            cloud.layer.transform = transform(sample)
            cloud.layer.opacity = Float(sample.opacity)
            guard shouldRun else { continue }

            let travel = CABasicAnimation(keyPath: "transform")
            travel.fromValue = NSValue(caTransform3D: transform(plane.sample(phase: 0)))
            travel.toValue = NSValue(caTransform3D: transform(plane.sample(phase: 1)))
            travel.duration = plane.duration
            travel.timingFunction = CAMediaTimingFunction(name: .linear)

            let visibility = CAKeyframeAnimation(keyPath: "opacity")
            visibility.values = (0...120).map { plane.sample(phase: Double($0) / 120).opacity }
            visibility.duration = plane.duration
            visibility.calculationMode = .linear

            let group = CAAnimationGroup()
            group.animations = [travel, visibility]
            group.duration = plane.duration
            group.repeatCount = .infinity
            group.timingFunction = CAMediaTimingFunction(name: .linear)
            group.beginTime = cloud.layer.convertTime(time, from: nil) - sample.phase * plane.duration
            group.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
            cloud.layer.add(group, forKey: Self.animationKey)
        }
        CATransaction.commit()
    }
}
