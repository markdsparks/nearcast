#if targetEnvironment(simulator)
import SwiftUI
import UIKit
import QuartzCore
import Darwin

/// Simulator-only parent integration test. The real SwiftUI backdrop owns its
/// real child image views, timeline, crossfade, and cancellation tasks. Only
/// public UIView/CALayer state is inspected; no production test hooks are used.
@MainActor
struct NativeSkyBackdropVerificationView: View {
    @State private var scene = Self.fixture()
    @State private var identity = "verification-place-one"
    @State private var allowed = true
    @State private var reading = false
    @State private var reduceMotion = false
    @State private var started = false
    @State private var result = "Verifying backdrop integration…"

    private let key = "nearcast.cloud-drift"

    var body: some View {
        ZStack(alignment: .topLeading) {
            NativeLivingSkyBackdrop(scene: scene, isDark: true, reading: reading,
                increasedContrast: false, reduceTransparency: false,
                motionAllowed: allowed, reduceMotion: reduceMotion, sceneIdentity: identity)
            Text(result)
                .font(.system(size: 16, weight: .medium, design: .monospaced))
                .foregroundStyle(.white)
                .padding(24)
                .padding(.top, 40)
        }
        .task {
            guard !started else { return }
            started = true
            do { try await verify() }
            catch { fail("Verification cancelled before final marker: \(error)") }
        }
    }

    private static func fixture(revision: Int = 0, family: NativeLivingSkyScene.Family = .brokenClouds,
                                warmth: Double = 0.36, sunStrength: Double = 0.65,
                                lightPhase: NativeLivingSkyScene.LightPhase = .day,
                                unavailable: Bool = false) -> NativeLivingSkyScene {
        let date = Date(timeIntervalSince1970: 1_789_840_000 + Double(revision) * 60)
        return NativeLivingSkyScene(family: family, lightPhase: lightPhase,
            isDaylight: lightPhase == .unknown ? nil : lightPhase != .night,
            cloudCoverage: family == .clear ? 0 : 0.5, context: .current,
            source: unavailable ? .unavailable : .currentForecast,
            referenceDate: date, weatherDate: unavailable ? nil : date,
            illumination: unavailable ? .neutral : .init(solarElevation: 15, directness: 0.7, warmth: warmth,
                                                          sunStrength: sunStrength, cloudIllumination: 0.65))
    }

    private func cloudViews() -> [NativeSkyCloudImageView] {
        func descend(_ view: UIView) -> [NativeSkyCloudImageView] {
            var result = (view as? NativeSkyCloudImageView).map { [$0] } ?? []
            for child in view.subviews { result += descend(child) }
            return result
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { !$0.isHidden }.flatMap(descend)
            .filter { $0.window != nil }
    }

    private func movingLayers(_ view: NativeSkyCloudImageView) -> [CALayer] {
        (view.layer.sublayers ?? []).filter {
            guard let name = $0.name else { return false }
            return name.hasPrefix("nearcast.cloud.") && name != "nearcast.cloud.ceiling"
        }
    }

    private func cloud(_ view: NativeSkyCloudImageView) -> CALayer {
        guard let layer = movingLayers(view).first(where: {
            $0.name == "nearcast.cloud.near.0" || $0.name == "nearcast.cloud.canopy.0"
        }) else { fail("Cloud view has no named near or canopy plane") }
        return layer
    }

    private func animation(_ layer: CALayer) -> CAAnimationGroup? {
        layer.animation(forKey: key) as? CAAnimationGroup
    }

    private func isAnimating(_ view: NativeSkyCloudImageView) -> Bool {
        let layers = movingLayers(view)
        return !layers.isEmpty && layers.allSatisfy {
            guard let group = animation($0) else { return false }
            return group.repeatCount.isInfinite && group.duration > 0
                && group.animations?.contains(where: {
                    ($0 as? CABasicAnimation)?.keyPath == "transform"
                }) == true
                && group.animations?.contains(where: {
                    ($0 as? CAKeyframeAnimation)?.keyPath == "opacity"
                }) == true
        }
    }

    private func isPaused(_ view: NativeSkyCloudImageView) -> Bool {
        movingLayers(view).allSatisfy { $0.animation(forKey: key) == nil }
    }

    private func profile(_ layer: CALayer) -> (plane: NativeSkyCloudPlane, copy: Int) {
        for artwork in NativeSkyCloudArtwork.allCases {
            for plane in artwork.planes {
                for copy in 0..<2 where layer.name == "nearcast.cloud.\(plane.name).\(copy)" {
                    return (plane, copy)
                }
            }
        }
        fail("Cloud layer does not match a known motion plane")
    }

    private func phaseSample(_ layer: CALayer, at time: Double) -> NativeSkyCloudPlane.Sample? {
        guard let group = animation(layer) else { return nil }
        let localTime = layer.convertTime(time, from: nil)
        let phase = max(0, localTime - group.beginTime)
            .truncatingRemainder(dividingBy: group.duration) / group.duration
        return profile(layer).plane.sample(phase: phase)
    }

    private func matchesPhase(_ layer: CALayer, at time: Double, tolerance: Double = 0.25) -> Bool {
        guard let sample = phaseSample(layer, at: time),
              let shown = layer.presentation()?.transform else { return false }
        return abs(shown.m41 - sample.x) < tolerance && abs(shown.m42 - sample.y) < tolerance
    }

    private func emit(_ message: String) {
        print(message)
        fflush(stdout)
    }

    private func fail(_ message: String) -> Never {
        result = "FAIL\n\(message)"
        emit("FAIL Native sky backdrop: \(message)")
        let views = cloudViews()
        emit("DIAGNOSTIC backdrop clouds=\(views.count) identity=\(identity) family=\(scene.family) source=\(scene.source) allowed=\(allowed) reading=\(reading) reduceMotion=\(reduceMotion)")
        for (index, view) in views.enumerated() {
            for layer in view.layer.sublayers ?? [] {
                let transform = layer.transform
                let presentation = layer.presentation()?.transform
                let active = layer.animation(forKey: key)
                emit("DIAGNOSTIC cloud[\(index)] view=\(ObjectIdentifier(view)) layer=\(layer.name ?? "unnamed") keys=\(layer.animationKeys() ?? []) begin=\(active?.beginTime ?? -1) duration=\(active?.duration ?? -1) model=(\(transform.m41),\(transform.m42)) presentation=(\(presentation?.m41 ?? .nan),\(presentation?.m42 ?? .nan))")
            }
        }
        preconditionFailure(message)
    }

    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky backdrop: \(message)")
    }

    private func activePair(_ message: String) {
        let views = cloudViews()
        check(views.count == 2 && views.allSatisfy(isAnimating), message)
    }

    private func pausedPair(_ message: String) {
        let views = cloudViews()
        check(views.count == 2 && views.allSatisfy(isPaused), message)
    }

    private func verify() async throws {
        try await Task.sleep(for: .milliseconds(400))
        activePair("Active backdrop owns one base and one light-tinted continuously animated cloud view")
        check(cloudViews().allSatisfy { movingLayers($0).count == 4 },
              "Both broken-cloud views have two independently moving depth pairs")
        let originalBegins = Dictionary(uniqueKeysWithValues: cloudViews().flatMap(movingLayers).map {
            (ObjectIdentifier($0), animation($0)!.beginTime)
        })

        scene = Self.fixture(revision: 1)
        try await Task.sleep(for: .milliseconds(180))
        let refreshed = cloudViews()
        check(refreshed.count == 2 && refreshed.flatMap(movingLayers).allSatisfy {
            originalBegins[ObjectIdentifier($0)] == animation($0)?.beginTime
        }, "Routine same-identity forecast refresh preserves every animation beginTime")

        allowed = false
        try await Task.sleep(for: .milliseconds(180))
        pausedPair("motionAllowed=false pauses both cloud layers")
        let paused = Dictionary(uniqueKeysWithValues: cloudViews().flatMap(movingLayers).map {
            (ObjectIdentifier($0), $0.transform)
        })
        try await Task.sleep(for: .milliseconds(180))
        check(cloudViews().flatMap(movingLayers).allSatisfy {
            guard let old = paused[ObjectIdentifier($0)] else { return false }
            return abs($0.transform.m41 - old.m41) < 0.000_01
                && abs($0.transform.m42 - old.m42) < 0.000_01
        }, "Paused parent preserves exact placement without background drift")

        allowed = true
        try await Task.sleep(for: .milliseconds(160))
        activePair("Re-enabling motion resumes the same cloud composition")
        check(cloudViews().flatMap(movingLayers).allSatisfy {
            guard let old = paused[ObjectIdentifier($0)] else { return false }
            return abs($0.transform.m41 - old.m41) < 0.05 && abs($0.transform.m42 - old.m42) < 0.05
        }, "Parent resume uses banked active progress instead of restarting")
        let resumedAt = CACurrentMediaTime()
        check(cloudViews().flatMap(movingLayers).allSatisfy { matchesPhase($0, at: resumedAt) },
              "Resumed presentation follows each depth plane's active-time animation phase")

        reading = true
        try await Task.sleep(for: .milliseconds(160))
        pausedPair("Reading mode pauses motion even while the app remains active")
        reading = false
        try await Task.sleep(for: .milliseconds(160))
        activePair("Leaving reading mode resumes the cloud pair")

        reduceMotion = true
        try await Task.sleep(for: .milliseconds(160))
        pausedPair("Reduce Motion pauses both compositor layers")
        reduceMotion = false
        try await Task.sleep(for: .milliseconds(160))
        activePair("Leaving Reduce Motion respects preserved progress")

        // Accumulate enough movement that a failed place reset is observable.
        try await Task.sleep(for: .milliseconds(800))
        scene = Self.fixture(revision: 2, warmth: 0.80)
        try await Task.sleep(for: .milliseconds(140))
        let fading = cloudViews()
        check(fading.count == 4 && fading.filter(isAnimating).count == 2
                && fading.filter(isPaused).count == 2,
              "Accepted same-place weather change crossfades one outgoing still pair over one active pair")
        check(fading.filter(isAnimating).allSatisfy {
            let layer = cloud($0)
            let motion = profile(layer)
            let origin = motion.plane.sample(elapsed: 0, copy: motion.copy)
            return (layer.presentation()?.transform.m41 ?? -.infinity) > origin.x + 0.20
        }, "Pre-reset near-cloud drift is visibly beyond its initial phase")

        identity = "verification-place-two"
        scene = Self.fixture(revision: 3, warmth: 0.42)
        try await Task.sleep(for: .milliseconds(180))
        activePair("Place change during a fade discards the old outgoing cloud pair")
        check(cloudViews().allSatisfy {
            let layer = cloud($0)
            let motion = profile(layer)
            let origin = motion.plane.sample(elapsed: 0, copy: motion.copy)
            guard let sample = phaseSample(layer, at: CACurrentMediaTime()) else { return false }
            return abs(layer.transform.m41 - origin.x) < 0.08
                && abs(layer.transform.m42 - origin.y) < 0.02
                && sample.x >= origin.x && sample.x < origin.x + 0.80
                && matchesPhase(layer, at: CACurrentMediaTime())
        }, "New place starts at its plane's initial phase rather than inheriting old active time")

        scene = Self.fixture(revision: 4, warmth: 0.85)
        try await Task.sleep(for: .milliseconds(120))
        check(cloudViews().count == 4, "Second transition has an outgoing pair before evidence disappears")
        scene = Self.fixture(revision: 5, family: .unknown, unavailable: true)
        try await Task.sleep(for: .milliseconds(180))
        check(cloudViews().isEmpty, "Unavailable evidence immediately drops outgoing weather and all cloud animations")

        scene = Self.fixture(revision: 6)
        try await Task.sleep(for: .milliseconds(160))
        activePair("Fresh evidence restores exactly one active cloud pair")
        for revision in 7...11 {
            scene = Self.fixture(revision: revision, family: revision == 7 || revision == 10 ? .clear : .brokenClouds,
                                 warmth: revision.isMultiple(of: 2) ? 0.82 : 0.18)
            try await Task.sleep(for: .milliseconds(90))
            check(cloudViews().count <= 4, "Rapid update \(revision) never accumulates more than one outgoing pair")
        }
        try await Task.sleep(for: .milliseconds(1750))
        activePair("Rapid weather changes settle with no orphaned outgoing cloud views or animations")

        // Identity changes avoid blending test families. Canopy evidence is
        // intentionally sunless, so no sun-break alpha pass is expected.
        for family: NativeLivingSkyScene.Family in [.overcast, .rain, .snow] {
            identity = "verification-\(family.rawValue)"
            scene = Self.fixture(family: family, warmth: 0, sunStrength: 0)
            try await Task.sleep(for: .milliseconds(180))
            let views = cloudViews()
            check(views.count == 1 && views.allSatisfy(isAnimating),
                  "\(family.rawValue) owns exactly one continuously animated canopy")
            check(views.allSatisfy {
                movingLayers($0).count == 2
                    && $0.layer.sublayers?.contains(where: {
                        $0.name == "nearcast.cloud.ceiling" && $0.opacity == 1 && $0.animationKeys() == nil
                    }) == true
            }, "\(family.rawValue) retains an opaque, nonanimated ceiling beneath the drifting pair")
            let starting = cloud(views[0]).presentation()?.transform.m41 ?? .nan
            try await Task.sleep(for: .milliseconds(220))
            let layer = cloud(views[0])
            check((layer.presentation()?.transform.m41 ?? .nan) > starting + 0.05
                    && matchesPhase(layer, at: CACurrentMediaTime()),
                  "\(family.rawValue) visibly advances on the canopy's slower motion phase")
        }

        for family: NativeLivingSkyScene.Family in [.clear, .fog, .unknown] {
            identity = "verification-still-\(family.rawValue)"
            scene = Self.fixture(family: family, warmth: 0, sunStrength: 0)
            try await Task.sleep(for: .milliseconds(180))
            let views = cloudViews()
            check(views.allSatisfy(isPaused) && (family == .fog ? views.count == 1 : views.isEmpty),
                  "\(family.rawValue) remains still without inventing moving cloud layers")
        }

        identity = "verification-unknown-light"
        scene = Self.fixture(family: .overcast, warmth: 0, sunStrength: 0, lightPhase: .unknown)
        try await Task.sleep(for: .milliseconds(180))
        check(cloudViews().count == 1 && cloudViews().allSatisfy(isPaused),
              "Unknown light keeps an overcast canopy still")

        identity = "verification-zero-tint"
        scene = Self.fixture(warmth: 0)
        try await Task.sleep(for: .milliseconds(180))
        check(cloudViews().count == 1 && cloudViews().allSatisfy(isAnimating),
              "Zero warmth creates no invisible animated tint pass")

        identity = "verification-moonless"
        scene = Self.fixture(warmth: 0, sunStrength: 0, lightPhase: .night)
        try await Task.sleep(for: .milliseconds(180))
        check(cloudViews().count == 1 && cloudViews().allSatisfy(isAnimating),
              "Moonless broken clouds create no invisible animated moonlight pass")
        result = "PASS\nBackdrop lifecycle and transitions verified"
        emit("PASS Native living sky backdrop integration verification")
    }
}
#endif
