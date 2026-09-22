#if targetEnvironment(simulator)
import SwiftUI
import UIKit
import QuartzCore
import Darwin

/// Simulator-only proof against public Core Animation state, without a display
/// link, production test hooks, or a replacement rendering path.
struct NativeSkyStarsVerificationView: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { NativeSkyStarsVerificationHost() }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

@MainActor
private final class NativeSkyStarsVerificationHost: UIView {
    private let subject = NativeSkyStarsView()
    private let label = UILabel()
    private var task: Task<Void, Never>?
    private var started = false
    private let key = NativeSkyStarsProbe.key

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.014, green: 0.027, blue: 0.060, alpha: 1)
        addSubview(subject)
        label.text = "Verifying restrained native star twinkle…"
        label.numberOfLines = 0
        label.textColor = .white
        label.font = .monospacedSystemFont(ofSize: 16, weight: .medium)
        addSubview(label)
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        subject.frame = bounds
        label.frame = CGRect(x: 20, y: 60, width: max(1, bounds.width - 40), height: 110)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { task?.cancel(); subject.stop(); return }
        guard !started else { return }
        started = true
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(for: .milliseconds(180))
                self.layoutIfNeeded(); self.subject.layoutIfNeeded()
                try await self.verify()
            } catch { self.fail("Verification cancelled before final marker: \(error)") }
        }
    }

    private var stars: [CALayer] { NativeSkyStarsProbe.twinklers(in: subject.layer) }
    private var allLayers: [CALayer] { NativeSkyStarsProbe.layers(in: subject.layer) }
    private func emit(_ message: String) { print(message); fflush(stdout) }
    private func fail(_ message: String) -> Never {
        label.text = "FAIL\n\(message)"
        emit("FAIL Native sky stars: \(message)")
        for layer in allLayers {
            emit("DIAGNOSTIC stars \(layer.name ?? "nil") keys=\(layer.animationKeys() ?? []) position=\(layer.position) bounds=\(layer.bounds) opacity=\(layer.opacity) shown=\(layer.presentation()?.opacity ?? -1)")
        }
        preconditionFailure(message)
    }
    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky stars: \(message)")
    }
    private func configure(elapsed: Double = 0, sampledAt: Double = CACurrentMediaTime(),
                           running: Bool = true, identity: String = "stars-one",
                           visibility: Double = 0.95, moonCenter: UnitPoint? = nil,
                           moonDiameter: CGFloat = 54) {
        subject.configure(visibility: visibility, moonCenter: moonCenter, moonDiameter: moonDiameter,
                          elapsed: elapsed, sampledAt: sampledAt, running: running, identity: identity)
    }
    private func begins() -> [ObjectIdentifier: Double] {
        Dictionary(uniqueKeysWithValues: stars.compactMap { layer in
            layer.animation(forKey: key).map { (ObjectIdentifier(layer), $0.beginTime) }
        })
    }
    private func noAnimations() -> Bool { allLayers.allSatisfy { ($0.animationKeys() ?? []).isEmpty } }
    private func live(_ message: String) {
        let count = NativeSkyStarField.stars.filter { $0.twinkle != nil }.count
        check(stars.count == count && count <= 6 && stars.allSatisfy {
            $0.animation(forKey: key)?.repeatCount.isInfinite == true
        }, message)
    }
    private func opacityOnly(_ animation: CAAnimation) -> Bool {
        if let property = animation as? CAPropertyAnimation { return property.keyPath == "opacity" }
        if let group = animation as? CAAnimationGroup {
            return !(group.animations ?? []).isEmpty && (group.animations ?? []).allSatisfy(opacityOnly)
        }
        return false
    }

    private func verify() async throws {
        check(subject.window != nil && subject.bounds.width > 100 && subject.bounds.height > 300,
              "Star renderer is laid out in a real simulator window")
        check(!subject.isUserInteractionEnabled && subject.accessibilityElementsHidden,
              "Stars cannot intercept interaction or accessibility navigation")
        let start = CACurrentMediaTime()
        configure(elapsed: 21, sampledAt: start)
        live("Only the few selected bright stars have perpetual animations")
        check(allLayers.contains { $0.name == "nearcast.stars.steady" && $0.contents != nil
            && ($0.animationKeys() ?? []).isEmpty },
              "The remaining stars use one cached nonanimated raster")
        check(stars.allSatisfy {
            guard let animation = $0.animation(forKey: key) else { return false }
            return opacityOnly(animation) && animation.duration >= 8 && animation.duration <= 18
                && !animation.autoreverses
        }, "Star animations affect only opacity, with slow independent forward loops")

        let geometry = Dictionary(uniqueKeysWithValues: stars.map { (ObjectIdentifier($0), ($0.position, $0.bounds, $0.transform)) })
        try await Task.sleep(for: .milliseconds(200))
        let firstBrightness = stars.map { $0.presentation()?.opacity ?? -1 }
        check(firstBrightness.allSatisfy { $0 >= 0 && $0 <= 1 }, "Every twinkler reaches the real compositor")
        try await Task.sleep(for: .milliseconds(500))
        check(zip(stars, firstBrightness).contains { abs(($0.0.presentation()?.opacity ?? -1) - $0.1) > 0.001 },
              "Compositor brightness changes subtly over time")
        check(stars.allSatisfy {
            guard let old = geometry[ObjectIdentifier($0)], let shown = $0.presentation() else { return false }
            return $0.position == old.0 && $0.bounds == old.1 && CATransform3DEqualToTransform($0.transform, old.2)
                && abs(shown.position.x - old.0.x) < 0.001 && abs(shown.position.y - old.0.y) < 0.001
                && abs(shown.bounds.width - old.1.width) < 0.001 && abs(shown.bounds.height - old.1.height) < 0.001
                && CATransform3DEqualToTransform(shown.transform, old.2)
        }, "Twinkle never moves, resizes or transforms a star")

        let oldBegins = begins()
        let refresh = CACurrentMediaTime()
        configure(elapsed: 21 + refresh - start, sampledAt: refresh)
        subject.setNeedsLayout(); subject.layoutIfNeeded()
        check(begins() == oldBegins, "A routine refresh and unchanged layout preserve every animation beginTime")
        let pause = CACurrentMediaTime()
        let pausedElapsed = 21 + pause - start
        configure(elapsed: pausedElapsed, sampledAt: pause, running: false)
        check(noAnimations(), "Pause synchronously removes all star animation work")
        let held = stars.map(\.opacity)
        try await Task.sleep(for: .milliseconds(220))
        check(stars.map(\.opacity) == held && stars.allSatisfy {
            abs(($0.presentation()?.opacity ?? -1) - $0.opacity) < 0.000_01
        }, "Paused stars remain completely still at their banked brightness")
        configure(elapsed: pausedElapsed + 10_000, running: false)
        check(stars.map(\.opacity) == held && noAnimations(),
              "A paused refresh ignores advancing cloud time and preserves star brightness")
        configure(elapsed: pausedElapsed + 10_000)
        live("Resume restores only the sparse opacity animations")
        check(zip(stars, held).allSatisfy { abs($0.0.opacity - $0.1) < 0.002 },
              "Resume begins at the held brightness without replaying the start")

        subject.isHidden = true
        check(noAnimations(), "A hidden star view stops all compositor loops immediately")
        let hiddenBrightness = stars.map(\.opacity)
        try await Task.sleep(for: .milliseconds(200))
        subject.isHidden = false
        live("Showing the star view restores motion only while requested")
        check(zip(stars, hiddenBrightness).allSatisfy { abs($0.0.opacity - $0.1) < 0.002 },
              "Hidden time is excluded from the star phase")
        subject.alpha = 0
        check(noAnimations(), "A fully transparent view performs no invisible twinkle work")
        subject.alpha = 1
        live("Restoring view visibility resumes the existing star field")
        configure(visibility: 0)
        check(noAnimations(), "Zero evidence visibility stops every twinkle animation")
        configure(identity: "stars-moon")
        live("Visible night evidence restores the bounded star field")

        guard let selected = NativeSkyStarField.stars.enumerated().first(where: { $0.element.twinkle != nil }),
              let chosenLayer = stars.first(where: { $0.name == "nearcast.star.\(selected.offset)" }) else {
            fail("The original deterministic index identifies a selected bright star")
        }
        let unoccludedBegins = begins()
        configure(identity: "stars-moon", moonCenter: UnitPoint(x: selected.element.x, y: selected.element.y))
        check(chosenLayer.isHidden || chosenLayer.opacity == 0 || chosenLayer.superlayer == nil,
              "The full moon silhouette hides a star even behind its dark hemisphere")
        check(chosenLayer.animation(forKey: key) == nil,
              "Moon-occluded stars do not keep invisible animation work alive")
        check(stars.filter { $0 !== chosenLayer && $0.animation(forKey: key) != nil }.allSatisfy {
            unoccludedBegins[ObjectIdentifier($0)] == $0.animation(forKey: key)?.beginTime
        }, "Moving moon occlusion does not restart unaffected stars")
        configure(identity: "stars-moon")
        live("Exposed stars return at the current shared active phase")

        let profile = selected.element.twinkle!
        let seam = (1 - profile.phaseOffset) * profile.duration
        let seamTime = CACurrentMediaTime()
        configure(elapsed: seam - 0.35, sampledAt: seamTime, identity: "stars-loop")
        let loopBegins = begins()
        try await Task.sleep(for: .milliseconds(120))
        let beforeSeam = chosenLayer.presentation()?.opacity ?? -1
        let beforeExpected = selected.element.opacity(elapsed: seam - 0.35 + CACurrentMediaTime() - seamTime)
        try await Task.sleep(for: .milliseconds(440))
        let afterSeam = chosenLayer.presentation()?.opacity ?? -1
        let afterExpected = selected.element.opacity(elapsed: seam - 0.35 + CACurrentMediaTime() - seamTime)
        check(beforeSeam >= 0 && afterSeam >= 0
            && abs(Double(beforeSeam) - beforeExpected) < 0.006
            && abs(Double(afterSeam) - afterExpected) < 0.006,
              "A real compositor loop crosses its seam without a brightness flash")
        check(begins() == loopBegins, "The loop seam needs no timer, replacement or animation reset")

        configure(elapsed: 0, running: false, identity: "stars-new-place")
        check(noAnimations(), "A new place can reset cleanly to a still star composition")
        let identityBrightness = stars.map(\.opacity)
        configure(elapsed: 0, identity: "stars-new-place")
        live("A new place starts only its own sparse twinkle phase")
        check(zip(stars, identityBrightness).allSatisfy { abs($0.0.opacity - $0.1) < 0.002 },
              "New-place motion begins at the new-place zero-time appearance")
        configure(elapsed: 86_400, identity: "stars-long-running")
        try await Task.sleep(for: .milliseconds(130))
        live("A full day of active time still uses the same bounded perpetual animations")
        subject.removeFromSuperview()
        check(subject.window == nil && noAnimations(), "Detaching synchronously clears all compositor loops")
        let detachedBrightness = stars.map(\.opacity)
        try await Task.sleep(for: .milliseconds(150))
        check(stars.map(\.opacity) == detachedBrightness, "Detached stars do not accumulate hidden work")
        insertSubview(subject, belowSubview: label)
        subject.layoutIfNeeded()
        live("Reattachment resumes only the previously requested star motion")
        subject.stop()
        subject.removeFromSuperview()
        insertSubview(subject, belowSubview: label)
        check(noAnimations(), "Explicit teardown remains stopped across reattachment")
        label.text = "PASS\nNative star twinkle lifecycle verified"
        emit("PASS Native living sky star renderer verification")
        task = nil
    }
}

/// The real SwiftUI bridge owns policy changes, the shared active clock and
/// outgoing compositions. This verifies those boundaries in a live window.
@MainActor
struct NativeSkyStarsBackdropVerificationView: View {
    @State private var scene = Self.fixture()
    @State private var identity = "stars-backdrop-one"
    @State private var allowed = true
    @State private var reading = false
    @State private var reduceMotion = false
    @State private var contrast = false
    @State private var opaque = false
    @State private var dimFlashes = false
    @State private var immediateStop = false
    @State private var started = false
    @State private var result = "Verifying star backdrop integration…"

    var body: some View {
        ZStack(alignment: .topLeading) {
            NativeLivingSkyBackdrop(scene: scene, isDark: true, reading: reading,
                increasedContrast: contrast, reduceTransparency: opaque,
                motionAllowed: allowed, reduceMotion: reduceMotion, dimFlashingLights: dimFlashes,
                sceneIdentity: identity, immediateMotionStop: immediateStop).ignoresSafeArea()
            Text(result).font(.system(size: 16, weight: .medium, design: .monospaced))
                .foregroundStyle(.white).padding(24).padding(.top, 40)
        }
        .task {
            guard !started else { return }; started = true
            do { try await verify() }
            catch { fail("Verification cancelled before final marker: \(error)") }
        }
    }

    private static func fixture(revision: Int = 0, family: NativeLivingSkyScene.Family = .clear,
                                phase: NativeLivingSkyScene.LightPhase = .night,
                                source: NativeLivingSkyScene.Source = .currentForecast,
                                context: NativeLivingSkyScene.Context = .current) -> NativeLivingSkyScene {
        let date = Date(timeIntervalSince1970: 1_789_840_000 + Double(revision) * 60)
        let visible = phase == .night && source != .unavailable && (family == .clear || family == .brokenClouds)
        return NativeLivingSkyScene(family: family, lightPhase: phase,
            isDaylight: phase == .unknown ? nil : phase != .night, cloudCoverage: family == .clear ? 0 : 0.4,
            context: context, source: source, referenceDate: date, weatherDate: source == .unavailable ? nil : date,
            nightSky: .init(moonElevation: -18, starVisibility: visible ? 0.95 : 0))
    }
    private func fail(_ message: String) -> Never {
        result = "FAIL\n\(message)"
        print("FAIL Native sky stars backdrop: \(message)"); fflush(stdout)
        preconditionFailure(message)
    }
    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        print("PASS Native sky stars backdrop: \(message)"); fflush(stdout)
    }
    private func views() -> [NativeSkyStarsView] { NativeSkyStarsProbe.views(of: NativeSkyStarsView.self) }
    private func layers() -> [CALayer] { views().flatMap { NativeSkyStarsProbe.twinklers(in: $0.layer) } }
    private func animated() -> [CALayer] { layers().filter { $0.animation(forKey: NativeSkyStarsProbe.key) != nil } }
    private func active(_ message: String) {
        check(views().count == 1 && views().allSatisfy { $0.bounds.width > 100 && $0.bounds.height > 300 }
            && !animated().isEmpty && animated().count <= 6, message)
    }
    private func paused(_ message: String) { check(animated().isEmpty, message) }
    private func settle() async throws { try await Task.sleep(for: .milliseconds(160)) }

    private func verify() async throws {
        try await Task.sleep(for: .milliseconds(500))
        active("A current clear night owns one full-size field and at most six opacity loops")
        let originalBegins = Dictionary(uniqueKeysWithValues: animated().map {
            (ObjectIdentifier($0), $0.animation(forKey: NativeSkyStarsProbe.key)!.beginTime)
        })
        scene = Self.fixture(revision: 1)
        try await settle()
        check(animated().count == originalBegins.count && animated().allSatisfy {
            originalBegins[ObjectIdentifier($0)] == $0.animation(forKey: NativeSkyStarsProbe.key)?.beginTime
        }, "An accepted forecast refresh does not reset the star phase")
        reading = true; try await settle()
        paused("Reading mode leaves the stars still")
        let held = Dictionary(uniqueKeysWithValues: layers().map { (ObjectIdentifier($0), $0.opacity) })
        try await settle()
        check(layers().allSatisfy { held[ObjectIdentifier($0)] == $0.opacity },
              "Reading time does not advance hidden star brightness")
        reading = false; try await settle(); active("Leaving reading resumes a single star field")
        allowed = false; try await settle(); paused("Motion permission loss removes star loops")
        allowed = true; try await settle(); active("Motion permission restores star loops")
        reduceMotion = true; try await settle(); paused("Reduce Motion freezes star twinkle")
        reduceMotion = false; try await settle(); active("Leaving Reduce Motion resumes stars")
        contrast = true; try await settle(); paused("Increased Contrast keeps star brightness still")
        contrast = false; try await settle(); active("Normal contrast restores eligible motion")
        opaque = true; try await settle(); paused("Reduce Transparency suppresses twinkle work")
        opaque = false; try await settle(); active("Leaving Reduce Transparency restores eligible motion")
        dimFlashes = true; try await settle(); paused("Dim Flashing Lights suppresses even restrained star twinkle")
        dimFlashes = false; try await settle(); active("Leaving Dim Flashing Lights resumes eligible star motion")
        immediateStop = true; try await settle(); paused("Inactive-app and low-power restrictions stop twinkle")
        immediateStop = false; try await settle(); active("Foreground policy restores one active field")

        identity = "stars-backdrop-two"
        scene = Self.fixture(revision: 2)
        try await settle(); active("A place change leaves exactly one active star field")
        let resetTime = CACurrentMediaTime()
        check(animated().allSatisfy {
            guard let name = $0.name, let index = Int(name.replacingOccurrences(of: "nearcast.star.", with: "")),
                  let profile = NativeSkyStarField.stars[index].twinkle,
                  let animation = $0.animation(forKey: NativeSkyStarsProbe.key) else { return false }
            let age = $0.convertTime(resetTime, from: nil) - animation.beginTime - profile.phaseOffset * profile.duration
            return age >= 0 && age < 0.75
        }, "A new place uses a new zero-time phase instead of inheriting the old active clock")
        scene = Self.fixture(revision: 3, family: .brokenClouds)
        try await settle()
        check(views().count <= 2 && animated().count <= 6,
              "A weather crossfade never runs outgoing and incoming star loops together")
        scene = Self.fixture(revision: 4, source: .unavailable)
        try await settle()
        check(views().isEmpty && animated().isEmpty, "Unavailable evidence clears both active and outgoing stars")
        for phase: NativeLivingSkyScene.LightPhase in [.day, .unknown] {
            identity = "stars-\(phase.rawValue)"
            scene = Self.fixture(phase: phase)
            try await settle()
            check(views().isEmpty && animated().isEmpty, "\(phase) creates no star rendering or motion")
        }
        scene = Self.fixture(revision: 5, source: .selectedForecast,
                             context: .forecast(Date(timeIntervalSince1970: 1_789_850_000)))
        try await settle()
        paused("A selected future forecast is not animated as current night evidence")
        scene = Self.fixture(revision: 6)
        identity = "stars-restored"
        try await settle(); active("Fresh current evidence restores exactly one bounded field")
        result = "PASS\nNative star backdrop integration verified"
        print("PASS Native living sky stars backdrop integration verification"); fflush(stdout)
    }
}

/// Storm refinement stays in the slow cloud compositor: one extra paired veil,
/// the same rain engine, and no flash, lightning or periodic brightness work.
@MainActor
struct NativeSkyStormDepthVerificationView: View {
    @State private var scene = Self.fixture()
    @State private var identity = "storm-depth-one"
    @State private var allowed = true
    @State private var reading = false
    @State private var reduceMotion = false
    @State private var immediateStop = false
    @State private var started = false
    @State private var result = "Verifying slow storm cloud depth…"
    private let cloudKey = "nearcast.cloud-drift"

    var body: some View {
        ZStack(alignment: .topLeading) {
            NativeLivingSkyBackdrop(scene: scene, isDark: true, reading: reading,
                increasedContrast: false, reduceTransparency: false,
                motionAllowed: allowed, reduceMotion: reduceMotion, sceneIdentity: identity,
                immediateMotionStop: immediateStop).ignoresSafeArea()
            Text(result).font(.system(size: 16, weight: .medium, design: .monospaced))
                .foregroundStyle(.white).padding(24).padding(.top, 40)
        }
        .task {
            guard !started else { return }; started = true
            do { try await verify() }
            catch { fail("Verification cancelled before final marker: \(error)") }
        }
    }

    private static func fixture(revision: Int = 0, storm: NativeLivingSkyScene.StormStyle = .thunderstorm,
                                rain: NativeLivingSkyScene.RainStyle = .heavy,
                                source: NativeLivingSkyScene.Source = .currentForecast) -> NativeLivingSkyScene {
        let date = Date(timeIntervalSince1970: 1_789_840_000 + Double(revision) * 60)
        return NativeLivingSkyScene(family: .rain, lightPhase: .night, isDaylight: false,
            cloudCoverage: 0.98, context: .current, source: source,
            referenceDate: date, weatherDate: source == .unavailable ? nil : date,
            rainStyle: rain, stormStyle: storm)
    }
    private func fail(_ message: String) -> Never {
        result = "FAIL\n\(message)"
        print("FAIL Native sky storm depth: \(message)"); fflush(stdout)
        preconditionFailure(message)
    }
    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        print("PASS Native sky storm depth: \(message)"); fflush(stdout)
    }
    private func cloudLayers() -> [CALayer] {
        NativeSkyStarsProbe.views(of: NativeSkyCloudImageView.self).flatMap { $0.layer.sublayers ?? [] }
    }
    private func veil() -> [CALayer] { cloudLayers().filter { $0.name?.hasPrefix("nearcast.cloud.storm-veil.") == true } }
    private func activeVeil() -> [CALayer] { veil().filter { $0.animation(forKey: cloudKey) != nil } }
    private func rain() -> [CAEmitterLayer] {
        NativeSkyStarsProbe.views(of: NativeSkyRainView.self)
            .flatMap { NativeSkyStarsProbe.layers(in: $0.layer).compactMap { $0 as? CAEmitterLayer } }
    }
    private func settle() async throws { try await Task.sleep(for: .milliseconds(180)) }
    private func active(_ message: String) {
        check(veil().count == 2 && activeVeil().count == 2 && activeVeil().allSatisfy {
            guard let group = $0.animation(forKey: cloudKey) as? CAAnimationGroup else { return false }
            return group.duration >= 180 && group.repeatCount.isInfinite && !group.autoreverses
                && group.animations?.count == 2
        }, message)
    }
    private func noFlashes() -> Bool {
        NativeSkyStarsProbe.windows().flatMap { NativeSkyStarsProbe.layers(in: $0.layer) }.allSatisfy {
            layer in (layer.animationKeys() ?? []).allSatisfy { key in
                guard !key.localizedCaseInsensitiveContains("flash") && !key.localizedCaseInsensitiveContains("lightning")
                    else { return false }
                guard let animation = layer.animation(forKey: key) else { return true }
                // Infinite atmosphere animation belongs only to the already
                // bounded, multi-minute cloud compositor, never a light pulse.
                return !animation.repeatCount.isInfinite || (key == cloudKey && animation.duration >= 180)
            }
        }
    }

    private func verify() async throws {
        try await Task.sleep(for: .milliseconds(500))
        active("A thunderstorm adds exactly one slow paired cloud-depth veil")
        check(Set(veil().compactMap(\.name)) == ["nearcast.cloud.storm-veil.0", "nearcast.cloud.storm-veil.1"],
              "Storm depth uses its dedicated single-plane profile")
        let ceiling = cloudLayers().filter { $0.name == "nearcast.cloud.ceiling" }
        check(ceiling.count == 1 && ceiling.allSatisfy { $0.opacity == 1 && ($0.animationKeys() ?? []).isEmpty },
              "The storm preserves an opaque, stationary ceiling beneath drifting clouds")
        check(rain().count == 2 && rain().allSatisfy { $0.name?.hasPrefix("nearcast.rain-") == true },
              "Storm depth reuses the two existing rain depths without another emitter")
        check(NativeSkyStarsProbe.views(of: NativeSkyStarsView.self).isEmpty && noFlashes(),
              "A dense storm has no stars, lightning loop or flash animation")
        let before = veil().compactMap { $0.presentation()?.transform.m41 }
        try await Task.sleep(for: .milliseconds(320))
        check(before.count == 2 && zip(veil(), before).allSatisfy {
            ($0.0.presentation()?.transform.m41 ?? -.infinity) > $0.1 + 0.1
        }, "The storm's extra cloud depth moves slowly in the live compositor")
        let rainIDs = Set(rain().map(ObjectIdentifier.init))
        let beginTimes = Dictionary(uniqueKeysWithValues: veil().map { (ObjectIdentifier($0), $0.animation(forKey: cloudKey)!.beginTime) })
        scene = Self.fixture(revision: 1)
        try await settle()
        check(Set(rain().map(ObjectIdentifier.init)) == rainIDs && veil().allSatisfy {
            beginTimes[ObjectIdentifier($0)] == $0.animation(forKey: cloudKey)?.beginTime
        }, "A routine storm refresh restarts neither rain nor the slow cloud veil")
        reading = true; try await settle()
        check(activeVeil().isEmpty, "Reading pauses all storm-depth movement")
        reading = false; try await settle(); active("Leaving reading resumes one slow storm veil")
        reduceMotion = true; try await settle()
        check(activeVeil().isEmpty && rain().isEmpty, "Reduce Motion stops storm clouds and precipitation")
        reduceMotion = false; try await settle(); active("Removing the restriction restores the bounded storm layers")
        allowed = false; try await settle()
        check(activeVeil().isEmpty, "Motion permission loss pauses the storm veil")
        allowed = true; try await settle(); active("Motion permission restores one paired veil")
        immediateStop = true; try await settle()
        check(activeVeil().isEmpty && rain().isEmpty, "Inactive-app or power policy stops storm work immediately")
        immediateStop = false; try await settle(); active("Foreground policy restores the same restrained storm depth")

        let oldVeil = veil()
        let rainBeforeChange = Set(rain().map(ObjectIdentifier.init))
        scene = Self.fixture(revision: 2, storm: .none)
        try await settle()
        check(activeVeil().isEmpty && Set(rain().map(ObjectIdentifier.init)) == rainBeforeChange,
              "Removing storm classification stops its veil without restarting accepted rain")
        try await Task.sleep(for: .milliseconds(1_600))
        check(veil().isEmpty && oldVeil.allSatisfy { $0.animation(forKey: cloudKey) == nil },
              "The outgoing storm veil retires with no orphaned animation")
        scene = Self.fixture(revision: 3, rain: .none)
        identity = "storm-depth-dry"
        try await settle(); active("Accepted thunder classification can retain cloud depth without inventing rain")
        check(rain().isEmpty && noFlashes(), "A rain-free storm classification creates no precipitation or lightning work")
        scene = Self.fixture(revision: 4, source: .unavailable)
        try await settle()
        check(activeVeil().isEmpty && rain().isEmpty && noFlashes(),
              "Unavailable evidence stops storm-specific animation and all precipitation")
        result = "PASS\nSlow storm cloud depth verified"
        print("PASS Native living sky storm depth integration verification"); fflush(stdout)
    }
}

@MainActor
private enum NativeSkyStarsProbe {
    static let key = "nearcast.star-twinkle"
    static func layers(in layer: CALayer) -> [CALayer] {
        [layer] + (layer.sublayers ?? []).flatMap { layers(in: $0) }
    }
    static func twinklers(in layer: CALayer) -> [CALayer] {
        layers(in: layer).filter {
            guard let name = $0.name, name.hasPrefix("nearcast.star.") else { return false }
            return Int(name.replacingOccurrences(of: "nearcast.star.", with: "")) != nil
        }
    }
    static func windows() -> [UIWindow] {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { !$0.isHidden }
    }
    static func views<T: UIView>(of type: T.Type) -> [T] {
        func descend(_ view: UIView) -> [T] {
            ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap(descend)
        }
        return windows().flatMap(descend).filter { $0.window != nil }
    }
}
#endif
