#if targetEnvironment(simulator)
import SwiftUI
import UIKit
import QuartzCore
import Darwin

/// Simulator-only checks against real compositor presentation layers. This
/// proof complements the pure clock/phase tests; mount with -verify-motion.
struct NativeSkyMotionVerificationView: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { NativeSkyMotionVerificationHost() }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

@MainActor
private final class NativeSkyMotionVerificationHost: UIView {
    private let subject = NativeSkyCloudImageView()
    private let status = UILabel()
    private var verificationTask: Task<Void, Never>?
    private var started = false
    private var manuallySized = false
    private let key = "nearcast.cloud-drift"

    private struct Frame {
        let x: Double
        let y: Double
        let opacity: Double
        init(_ layer: CALayer) {
            x = layer.transform.m41
            y = layer.transform.m42
            opacity = Double(layer.opacity)
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.10, green: 0.18, blue: 0.30, alpha: 1)
        status.text = "Verifying continuous native cloud motion…"
        status.numberOfLines = 0
        status.textColor = .white
        status.font = .monospacedSystemFont(ofSize: 16, weight: .medium)
        addSubview(subject)
        addSubview(status)
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        status.frame = CGRect(x: 20, y: 20, width: max(1, bounds.width - 40), height: 80)
        if !manuallySized {
            subject.frame = CGRect(x: 20, y: 110, width: max(160, bounds.width - 40),
                                   height: max(200, bounds.height - 140))
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            verificationTask?.cancel()
            subject.stop()
            return
        }
        guard !started else { return }
        started = true
        verificationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(for: .milliseconds(150))
                self.layoutIfNeeded()
                self.subject.layoutIfNeeded()
                try await self.verify()
            } catch {
                self.fail("Verification cancelled before final marker: \(error)")
            }
        }
    }

    private func emit(_ value: String) {
        print(value)
        fflush(stdout)
    }

    private func fail(_ message: String) -> Never {
        status.text = "FAIL\n\(message)"
        emit("FAIL Native sky motion: \(message)")
        for layer in subject.layer.sublayers ?? [] {
            let shown = layer.presentation().map(Frame.init)
            emit("DIAGNOSTIC \(layer.name ?? "unnamed") keys=\(layer.animationKeys() ?? []) model=(\(layer.transform.m41),\(layer.transform.m42),\(layer.opacity)) shown=(\(shown?.x ?? .nan),\(shown?.y ?? .nan),\(shown?.opacity ?? .nan))")
            if let group = layer.animation(forKey: key) as? CAAnimationGroup {
                emit("DIAGNOSTIC begin=\(group.beginTime) duration=\(group.duration) local=\(layer.convertTime(CACurrentMediaTime(), from: nil)) repeats=\(group.repeatCount) speed=\(group.speed) offset=\(group.timeOffset)")
            }
        }
        preconditionFailure(message)
    }

    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky motion: \(message)")
    }

    private func close(_ actual: Double, _ expected: Double, tolerance: Double = 0.000_01) -> Bool {
        actual.isFinite && abs(actual - expected) <= tolerance
    }

    private func layer(_ plane: NativeSkyCloudPlane, _ copy: Int) -> CALayer {
        let name = "nearcast.cloud.\(plane.name).\(copy)"
        guard let value = subject.layer.sublayers?.first(where: { $0.name == name }) else {
            fail("Named cloud layer exists: \(name)")
        }
        return value
    }

    private func presentation(_ layer: CALayer) -> Frame {
        guard let shown = layer.presentation() else { fail("A real compositor presentation layer is available") }
        return Frame(shown)
    }

    private func animation(_ layer: CALayer) -> CAAnimationGroup {
        guard let group = layer.animation(forKey: key) as? CAAnimationGroup else {
            fail("Paired transform/opacity animation group is installed on \(layer.name ?? "cloud")")
        }
        return group
    }

    private func matches(_ frame: Frame, _ sample: NativeSkyCloudPlane.Sample,
                         positionTolerance: Double = 0.000_01, opacityTolerance: Double = 0.000_001) -> Bool {
        close(frame.x, sample.x, tolerance: positionTolerance)
            && close(frame.y, sample.y, tolerance: positionTolerance)
            && close(frame.opacity, sample.opacity, tolerance: opacityTolerance)
    }

    private func modelMatches(_ artwork: NativeSkyCloudArtwork, elapsed: Double,
                              tolerance: Double = 0.000_01) -> Bool {
        artwork.planes.allSatisfy { plane in
            (0..<2).allSatisfy { copy in
                matches(Frame(layer(plane, copy)), plane.sample(elapsed: elapsed, copy: copy),
                        positionTolerance: tolerance, opacityTolerance: max(0.000_001, tolerance))
            }
        }
    }

    private func noAnimations(_ root: CALayer) -> Bool {
        (root.animationKeys() ?? []).isEmpty && (root.sublayers ?? []).allSatisfy { noAnimations($0) }
    }

    private func verifyAnimations(_ artwork: NativeSkyCloudArtwork) {
        for plane in artwork.planes {
            for copy in 0..<2 {
                let cloud = layer(plane, copy)
                let group = animation(cloud)
                check(cloud.contents != nil, "\(plane.name).\(copy) has cached bundled artwork")
                check(group.repeatCount.isInfinite && !group.autoreverses && close(group.duration, plane.duration),
                      "\(plane.name).\(copy) repeats its bounded forward cycle without reversal")
                guard let travel = group.animations?.compactMap({ $0 as? CABasicAnimation })
                    .first(where: { $0.keyPath == "transform" }),
                      let opacity = group.animations?.compactMap({ $0 as? CAKeyframeAnimation })
                    .first(where: { $0.keyPath == "opacity" }),
                      let from = (travel.fromValue as? NSValue)?.caTransform3DValue,
                      let to = (travel.toValue as? NSValue)?.caTransform3DValue,
                      let values = opacity.values as? [Double] else {
                    fail("Cloud group contains an explicit transform and opacity envelope")
                }
                check(close(from.m41, -plane.travelX / 2) && close(to.m41, plane.travelX / 2)
                    && close(from.m42, -plane.travelY / 2) && close(to.m42, plane.travelY / 2),
                      "\(plane.name).\(copy) travels between the declared signed endpoints")
                check(values.count == 121 && close(values.first ?? -1, 0) && close(values.last ?? -1, 0)
                    && close(values[60], plane.opacity) && close(opacity.duration, group.duration),
                      "\(plane.name).\(copy) reaches zero opacity at both recycling endpoints")
            }
        }
    }

    private func verifyCoverage(_ artwork: NativeSkyCloudArtwork) {
        for plane in artwork.planes {
            for copy in 0..<2 {
                let cloud = layer(plane, copy)
                check(close(cloud.bounds.width, (subject.bounds.width + plane.horizontalOverscan) * plane.scale)
                    && close(cloud.bounds.height, (subject.bounds.height + plane.verticalOverscan) * plane.scale),
                      "\(plane.name).\(copy) retains its scaled overscan after layout")
                for phase in [0.0, 0.5, 1.0] {
                    let sample = plane.sample(phase: phase)
                    let covered = CGRect(x: cloud.position.x - cloud.bounds.width / 2 + sample.x,
                                         y: cloud.position.y - cloud.bounds.height / 2 + sample.y,
                                         width: cloud.bounds.width, height: cloud.bounds.height)
                    check(covered.insetBy(dx: 3, dy: 3).contains(subject.bounds),
                          "\(plane.name).\(copy) covers the viewport with margin at phase \(phase)")
                }
            }
        }
    }

    private func verify() async throws {
        check(subject.window != nil && !subject.bounds.isEmpty, "Subject is laid out in a real simulator window")
        let artwork = NativeSkyCloudArtwork.brokenClouds
        let far = artwork.planes[0]
        let near = artwork.planes[1]
        let identity = "verification-active"
        let start = CACurrentMediaTime()
        let initialElapsed = 45.0
        subject.configure(elapsed: initialElapsed, sampledAt: start, running: true, identity: identity)
        check(subject.layer.sublayers?.count == 4, "Broken clouds contain exactly two paired depth planes")
        verifyAnimations(artwork)
        verifyCoverage(artwork)
        try await Task.sleep(for: .milliseconds(500))
        let movingTime = CACurrentMediaTime()
        for plane in artwork.planes {
            for copy in 0..<2 {
                let shown = presentation(layer(plane, copy))
                check(matches(shown, plane.sample(elapsed: initialElapsed + movingTime - start, copy: copy),
                              positionTolerance: 0.16, opacityTolerance: 0.003),
                      "\(plane.name).\(copy) presentation advances at its intended transform and visibility")
            }
        }
        check(presentation(layer(near, 0)).x > near.sample(elapsed: initialElapsed, copy: 0).x + 0.4,
              "Foreground presentation moves perceptibly within half a second")

        let pauseTime = CACurrentMediaTime()
        let pausedElapsed = initialElapsed + pauseTime - start
        subject.configure(elapsed: pausedElapsed, sampledAt: pauseTime, running: false, identity: identity)
        check(noAnimations(subject.layer) && modelMatches(artwork, elapsed: pausedElapsed),
              "Pause removes every animation and banks exact transforms and opacity")
        try await Task.sleep(for: .milliseconds(150))
        let pausedFrames = artwork.planes.flatMap { plane in (0..<2).map { presentation(layer(plane, $0)) } }
        try await Task.sleep(for: .milliseconds(200))
        let heldFrames = artwork.planes.flatMap { plane in (0..<2).map { presentation(layer(plane, $0)) } }
        check(zip(pausedFrames, heldFrames).allSatisfy {
            close($0.x, $1.x, tolerance: 0.001) && close($0.y, $1.y, tolerance: 0.001)
                && close($0.opacity, $1.opacity, tolerance: 0.000_001)
        }, "Paused presentation remains completely still, including opacity")

        let resumeTime = CACurrentMediaTime()
        subject.configure(elapsed: pausedElapsed, sampledAt: resumeTime, running: true, identity: identity)
        check(modelMatches(artwork, elapsed: pausedElapsed, tolerance: 0.02),
              "Resume begins at the paused phase without replay or visible jump")
        try await Task.sleep(for: .milliseconds(350))
        check(presentation(layer(near, 0)).x > heldFrames[2].x + 0.25,
              "Resumed compositor continues the foreground travel")

        let beginBeforeRefresh = artwork.planes.flatMap { plane in (0..<2).map { animation(layer(plane, $0)).beginTime } }
        let refreshTime = CACurrentMediaTime()
        let refreshElapsed = pausedElapsed + refreshTime - resumeTime
        subject.configure(elapsed: refreshElapsed, sampledAt: refreshTime, running: true, identity: identity)
        let beginAfterRefresh = artwork.planes.flatMap { plane in (0..<2).map { animation(layer(plane, $0)).beginTime } }
        check(beginBeforeRefresh == beginAfterRefresh, "Routine refresh preserves every compositor animation beginTime")

        manuallySized = true
        subject.frame.size = CGSize(width: subject.bounds.width + 24, height: max(120, subject.bounds.height - 32))
        subject.setNeedsLayout()
        subject.layoutIfNeeded()
        let resizeElapsed = refreshElapsed + CACurrentMediaTime() - refreshTime
        check(modelMatches(artwork, elapsed: resizeElapsed, tolerance: 0.02),
              "Resize continues the same active-time phase for all copies")
        verifyCoverage(artwork)
        try await Task.sleep(for: .milliseconds(150))
        check(matches(presentation(layer(near, 0)), near.sample(elapsed: refreshElapsed + CACurrentMediaTime() - refreshTime, copy: 0),
                      positionTolerance: 0.16, opacityTolerance: 0.003),
              "Resized presentation continues from the active clock")

        // Advance the active clock close to a seam instead of waiting minutes.
        // Copy zero must reset only while invisible; its companion stays lit.
        let seamElapsed = (1 - near.phaseOffset) * near.duration
        let seamStart = CACurrentMediaTime()
        subject.configure(elapsed: seamElapsed - 0.65, sampledAt: seamStart, running: true,
                          identity: "verification-seam")
        try await Task.sleep(for: .milliseconds(120))
        let beforeSeam = presentation(layer(near, 0))
        check(beforeSeam.x > near.travelX / 2 - 2 && beforeSeam.opacity < 0.001,
              "Outgoing copy approaches its endpoint already invisible")
        let seamBeginTime = animation(layer(near, 0)).beginTime
        try await Task.sleep(for: .milliseconds(700))
        let afterSeam = presentation(layer(near, 0))
        let companion = presentation(layer(near, 1))
        check(afterSeam.x < -near.travelX / 2 + 2 && afterSeam.opacity < 0.001,
              "Compositor recycles the copy only at zero visibility")
        check(companion.opacity > 0.999 && abs(companion.x) < 2,
              "The companion remains fully visible through the recycling seam")
        check(animation(layer(near, 0)).beginTime == seamBeginTime,
              "Looping crosses the seam without a timer, restart, or replacement animation")

        let seamPauseTime = CACurrentMediaTime()
        let seamPausedElapsed = seamElapsed - 0.65 + seamPauseTime - seamStart
        subject.configure(elapsed: seamPausedElapsed, sampledAt: seamPauseTime, running: false,
                          identity: "verification-seam")
        check(noAnimations(subject.layer) && modelMatches(artwork, elapsed: seamPausedElapsed),
              "Pause immediately after a seam preserves the recycled phase and visibility")
        try await Task.sleep(for: .milliseconds(120))
        let seamResume = CACurrentMediaTime()
        subject.configure(elapsed: seamPausedElapsed, sampledAt: seamResume, running: true,
                          identity: "verification-seam")
        try await Task.sleep(for: .milliseconds(150))
        check(matches(presentation(layer(near, 0)), near.sample(elapsed: seamPausedElapsed + CACurrentMediaTime() - seamResume, copy: 0),
                      positionTolerance: 0.16, opacityTolerance: 0.003),
              "Resume immediately after a seam does not replay the outgoing image")

        subject.configure(elapsed: 0, sampledAt: CACurrentMediaTime(), running: false,
                          identity: "verification-new-place")
        check(noAnimations(subject.layer) && modelMatches(artwork, elapsed: 0),
              "Explicit identity reset returns all copies to their initial still phases")
        subject.configure(elapsed: 86_400, sampledAt: CACurrentMediaTime(), running: true,
                          identity: "verification-long-running")
        try await Task.sleep(for: .milliseconds(120))
        check(animation(layer(far, 0)).repeatCount.isInfinite && animation(layer(near, 0)).repeatCount.isInfinite,
              "A full day of accrued active time still schedules continuous motion")

        let retiredClouds = subject.layer.sublayers ?? []
        let canopyTime = CACurrentMediaTime()
        let canopyElapsed = 2_500.0
        subject.configure(elapsed: canopyElapsed, sampledAt: canopyTime, running: true,
                          identity: "verification-long-running", artwork: .canopy)
        check(retiredClouds.allSatisfy { $0.superlayer == nil && noAnimations($0) },
              "A same-identity profile change detaches and retires all prior cloud animations")
        check(subject.layer.sublayers?.count == 3, "Canopy contains a stable opaque ceiling plus two moving copies")
        guard let ceiling = subject.layer.sublayers?.first(where: { $0.name == "nearcast.cloud.ceiling" }) else {
            fail("Canopy has a complete ceiling beneath the crossfade")
        }
        check(ceiling.contents != nil && ceiling.opacity == 1 && ceiling.frame == subject.bounds && noAnimations(ceiling),
              "Canopy ceiling covers the viewport at full opacity without animation")
        verifyAnimations(.canopy)
        verifyCoverage(.canopy)
        try await Task.sleep(for: .milliseconds(200))
        let canopy = NativeSkyCloudArtwork.canopy.planes[0]
        check(matches(presentation(layer(canopy, 0)), canopy.sample(elapsed: canopyElapsed + CACurrentMediaTime() - canopyTime, copy: 0),
                      positionTolerance: 0.16, opacityTolerance: 0.003),
              "Canopy presentation uses its slower motion profile and the same active clock")

        let canopyChildren = subject.layer.sublayers ?? []
        subject.configure(elapsed: 2_501, sampledAt: CACurrentMediaTime(), running: false,
                          identity: "verification-long-running", artwork: .brokenClouds)
        check(canopyChildren.allSatisfy { $0.superlayer == nil && noAnimations($0) }
            && subject.layer.sublayers?.count == 4 && noAnimations(subject.layer),
              "Returning to paused broken clouds removes the ceiling and all canopy animations")

        let removalStart = CACurrentMediaTime()
        subject.configure(elapsed: 30, sampledAt: removalStart, running: true,
                          identity: "verification-removal")
        try await Task.sleep(for: .milliseconds(200))
        check(!noAnimations(subject.layer), "Window-removal fixture is actively animating")
        subject.removeFromSuperview()
        let removalElapsed = 30 + CACurrentMediaTime() - removalStart
        check(subject.window == nil && noAnimations(subject.layer)
            && modelMatches(artwork, elapsed: removalElapsed, tolerance: 0.02),
              "Window removal removes all animation groups at their current phases")
        let removedFrames = artwork.planes.flatMap { plane in (0..<2).map { Frame(layer(plane, $0)) } }
        try await Task.sleep(for: .milliseconds(150))
        let detachedFrames = artwork.planes.flatMap { plane in (0..<2).map { Frame(layer(plane, $0)) } }
        check(zip(removedFrames, detachedFrames).allSatisfy {
            close($0.x, $1.x) && close($0.y, $1.y) && close($0.opacity, $1.opacity)
        }, "Detached copies hold still with no remaining compositor animation")

        status.text = "PASS\nContinuous native cloud motion verified"
        backgroundColor = UIColor(red: 0.06, green: 0.22, blue: 0.13, alpha: 1)
        emit("PASS Native living sky UIKit motion verification")
        verificationTask = nil
    }
}
#endif
