#if targetEnvironment(simulator)
import SwiftUI
import UIKit
import QuartzCore
import Darwin

/// Real-window renderer checks for the simulator proof only. The shipping rain
/// view is exercised through its normal lifecycle and public CALayer state;
/// there are no test hooks or inspection of private particle implementations.
struct NativeSkyRainVerificationView: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { NativeSkyRainVerificationHost() }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

@MainActor
private final class NativeSkyRainVerificationHost: UIView {
    private let subject = NativeSkyRainView()
    private let status = UILabel()
    private var verificationTask: Task<Void, Never>?
    private var started = false
    private var manuallySized = false
    private let fadeKey = "nearcast.rain-disappear"

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.08, green: 0.14, blue: 0.22, alpha: 1)
        addSubview(subject)
        status.text = "Verifying native rain…"
        status.numberOfLines = 0
        status.textColor = .white
        status.font = .monospacedSystemFont(ofSize: 16, weight: .medium)
        addSubview(status)
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        status.frame = CGRect(x: 20, y: 60, width: max(1, bounds.width - 40), height: 100)
        if !manuallySized { subject.frame = bounds }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            verificationTask?.cancel()
            subject.stopImmediately()
            return
        }
        guard !started else { return }
        started = true
        verificationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(for: .milliseconds(180))
                self.layoutIfNeeded()
                self.subject.layoutIfNeeded()
                try await self.verify()
            } catch {
                self.fail("Verification cancelled before final marker: \(error)")
            }
        }
    }

    private var field: CALayer? {
        subject.layer.sublayers?.first { $0.name == "nearcast.rain-field" }
    }

    private var emitters: [CAEmitterLayer] {
        func descend(_ layer: CALayer) -> [CAEmitterLayer] {
            var result = (layer as? CAEmitterLayer).map { [$0] } ?? []
            for child in layer.sublayers ?? [] { result += descend(child) }
            return result
        }
        return descend(subject.layer)
    }

    private var cells: [CAEmitterCell] { emitters.flatMap { $0.emitterCells ?? [] } }

    private func emit(_ value: String) {
        print(value)
        fflush(stdout)
    }

    private func fail(_ message: String) -> Never {
        status.text = "FAIL\n\(message)"
        emit("FAIL Native sky rain: \(message)")
        emit("DIAGNOSTIC Native sky rain field=\(field != nil) emitters=\(emitters.count) window=\(subject.window != nil) bounds=\(subject.bounds)")
        for emitter in emitters {
            emit("DIAGNOSTIC rain emitter=\(emitter.name ?? "nil") speed=\(emitter.speed) birthRate=\(emitter.birthRate) timeOffset=\(emitter.timeOffset) cells=\(emitter.emitterCells?.count ?? 0)")
        }
        preconditionFailure(message)
    }

    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky rain: \(message)")
    }

    private func configure(_ style: NativeLivingSkyScene.RainStyle = .steady,
                           active: Bool = true, immediateStop: Bool = false,
                           identity: String = "rain-place-one", isNight: Bool = false,
                           focus: CGRect? = nil) {
        subject.configure(style: style, active: active, immediateStop: immediateStop,
                          identity: identity, isNight: isNight, focus: focus)
    }

    private func liveField(_ message: String) {
        check(field != nil && emitters.count == 2 && cells.count == 2
            && emitters.allSatisfy { $0.speed == 1 && $0.birthRate > 0 && $0.timeOffset == 0 }, message)
    }

    private func identitySet(_ layers: [CAEmitterLayer]) -> Set<ObjectIdentifier> {
        Set(layers.map(ObjectIdentifier.init))
    }

    private func maskGradients() -> [CAGradientLayer] {
        func descend(_ layer: CALayer) -> [CAGradientLayer] {
            var values = (layer as? CAGradientLayer).map { [$0] } ?? []
            if let mask = layer.mask { values += descend(mask) }
            for child in layer.sublayers ?? [] { values += descend(child) }
            return values
        }
        return field.map(descend) ?? []
    }

    private func gradientSignature() -> String {
        maskGradients().map { gradient in
            let locations = (gradient.locations ?? []).map(\.doubleValue)
            let colors = (gradient.colors ?? []).map { ($0 as! CGColor).components ?? [] }
            return "\(gradient.bounds)|\(gradient.position)|\(gradient.startPoint)|\(gradient.endPoint)|\(locations)|\(colors)"
        }.joined(separator: ";")
    }

    private func masksAreSafe() -> Bool {
        let gradients = maskGradients()
        return !gradients.isEmpty && gradients.allSatisfy { gradient in
            let geometry = [gradient.bounds.minX, gradient.bounds.minY, gradient.bounds.width,
                            gradient.bounds.height, gradient.startPoint.x, gradient.startPoint.y,
                            gradient.endPoint.x, gradient.endPoint.y]
            let stops = (gradient.locations ?? []).map(\.doubleValue)
            return geometry.allSatisfy(\.isFinite) && gradient.bounds.width >= 0 && gradient.bounds.height >= 0
                && !stops.isEmpty && stops.allSatisfy { $0.isFinite && (0...1).contains($0) }
                && zip(stops, stops.dropFirst()).allSatisfy { $0 <= $1 }
        }
    }

    private func retired(_ oldField: CALayer?, _ oldEmitters: [CAEmitterLayer]) -> Bool {
        oldField?.superlayer == nil && oldEmitters.allSatisfy {
            $0.superlayer == nil && $0.birthRate == 0 && ($0.emitterCells?.isEmpty ?? true)
                && ($0.animationKeys()?.isEmpty ?? true)
        }
    }

    private func verify() async throws {
        check(subject.window != nil && !subject.bounds.isEmpty,
              "Rain view is laid out in a real simulator window")
        check(!subject.isUserInteractionEnabled && subject.accessibilityElementsHidden,
              "Decorative precipitation cannot intercept taps or accessibility navigation")
        configure(.none)
        check(field == nil && emitters.isEmpty, "No precipitation style allocates no emitter field")

        configure()
        liveField("Active rain owns exactly one far and one near emitter")
        check(emitters.allSatisfy {
            let localAge = $0.convertTime(CACurrentMediaTime(), from: nil)
            return $0.beginTime > 0 && localAge >= 0 && localAge < 0.15
        }, "New emitters start at local age zero instead of inheriting process uptime")
        check(Set(emitters.compactMap(\.name)) == ["nearcast.rain-far", "nearcast.rain-near"],
              "Rain depths are explicitly separated")
        check(cells.allSatisfy { $0.contents != nil && $0.birthRate > 0 && $0.lifetime > 0
            && $0.lifetime <= 4.5 && $0.lifetimeRange <= 0.16 && $0.alphaSpeed < 0 },
              "Each depth has a finite-lived, fading streak texture")
        check(emitters.allSatisfy { $0.emitterShape == .line }
            && cells.allSatisfy { abs($0.emissionLongitude - .pi) < 0.1 },
              "Horizontal line emitters send precipitation downward into the viewport, not sideways above it")
        check(field?.mask is CAGradientLayer && field?.sublayers?.first?.mask is CAGradientLayer,
              "Separate edge and reading masks protect the central forecast")
        let firstField = field
        let firstEmitters = emitters
        let firstIdentities = identitySet(firstEmitters)
        try await Task.sleep(for: .milliseconds(250))
        check(field?.presentation() != nil && emitters.allSatisfy { $0.presentation() != nil },
              "Both emitters are attached to the live compositor")
        configure()
        subject.setNeedsLayout()
        subject.layoutIfNeeded()
        check(field === firstField && identitySet(emitters) == firstIdentities,
              "Routine same-state refresh and unchanged layout preserve both emitter instances")

        let focus = subject.convert(CGRect(x: 50, y: subject.bounds.height * 0.42,
                                           width: max(100, subject.bounds.width - 100), height: 185), to: nil)
        configure(focus: focus)
        let focusedMask = gradientSignature()
        configure(focus: focus.offsetBy(dx: 0, dy: 52))
        check(field === firstField && identitySet(emitters) == firstIdentities,
              "A moving hero focus updates masks without restarting either emitter")
        check(focusedMask != gradientSignature(), "Mask geometry follows the actual hero position after layout reflow")
        for candidate: CGRect? in [nil, .zero, CGRect(x: 0, y: -2_000, width: 300, height: 100),
                                  CGRect(x: CGFloat.infinity, y: 0, width: 200, height: 150),
                                  CGRect(x: 0, y: 0, width: CGFloat.nan, height: 150)] {
            configure(focus: candidate)
            check(field === firstField && identitySet(emitters) == firstIdentities && masksAreSafe(),
                  "Missing, offscreen, or malformed hero geometry safely falls back without restarting rain")
        }
        configure(focus: focus)
        check(masksAreSafe(), "Valid hero focus retains finite, ordered readability masks")

        configure(active: false)
        check(emitters.count == 2 && emitters.allSatisfy { $0.speed == 0 && $0.birthRate == 0 }
            && field?.opacity == 0 && field?.animation(forKey: fadeKey) != nil,
              "Ordinary pause stops particle simulation immediately and schedules a short fade")
        try await Task.sleep(for: .milliseconds(320))
        check(field == nil && emitters.isEmpty && retired(firstField, firstEmitters),
              "Pause removes the entire field and particle cells after the fade")
        configure(active: false)
        check(field == nil, "Repeated paused updates do not recreate rain")

        configure()
        liveField("Resume creates fresh active emitters")
        check(identitySet(emitters).isDisjoint(with: firstIdentities),
              "Resume uses new zero-offset emitters rather than replaying frozen particle time")
        let beforeQuickPause = emitters
        let beforeQuickPauseField = field
        configure(active: false)
        try await Task.sleep(for: .milliseconds(50))
        configure()
        let quickResumeField = field
        let quickResumeEmitters = emitters
        check(retired(beforeQuickPauseField, beforeQuickPause)
            && identitySet(emitters).isDisjoint(with: identitySet(beforeQuickPause)),
              "Resume during a fade retires the old field before creating fresh particles")
        try await Task.sleep(for: .milliseconds(270))
        check(field === quickResumeField && identitySet(emitters) == identitySet(quickResumeEmitters),
              "A cancelled fade deadline cannot remove the resumed field")

        let beforeImmediate = emitters
        let beforeImmediateField = field
        configure(immediateStop: true)
        check(field == nil && emitters.isEmpty && retired(beforeImmediateField, beforeImmediate),
              "Immediate-stop accessibility or inactive-app policy clears all rain synchronously")
        configure()
        let previousPlace = emitters
        let previousPlaceField = field
        configure(identity: "rain-place-two")
        liveField("A different place starts one fresh rain field")
        check(retired(previousPlaceField, previousPlace)
            && identitySet(emitters).isDisjoint(with: identitySet(previousPlace)),
              "Place identity changes cannot carry previous-place particles forward")

        let beforeNight = emitters
        configure(identity: "rain-place-two", isNight: true)
        check(identitySet(emitters).isDisjoint(with: identitySet(beforeNight)),
              "Night tint changes rebuild only the bounded rain field")
        let originalSize = subject.bounds.size
        let beforeResize = emitters
        let beforeResizeField = field
        manuallySized = true
        subject.frame.size = CGSize(width: originalSize.width + 31, height: originalSize.height - 48)
        subject.setNeedsLayout()
        subject.layoutIfNeeded()
        liveField("Viewport resize replaces rain with exactly two correctly sized emitters")
        check(retired(beforeResizeField, beforeResize)
            && emitters.allSatisfy { $0.bounds.size == subject.bounds.size
                && $0.emitterSize.width == subject.bounds.width + 160 }
            && field?.bounds.size == subject.bounds.size
            && field?.mask?.bounds.size == subject.bounds.size,
              "Resize clears old geometry and preserves source overscan and readability masks")

        // A large surface must not scale particle work without bound. These
        // checks inspect configuration budgets, not private particle counts.
        subject.frame.size = CGSize(width: 4_000, height: 4_000)
        subject.setNeedsLayout()
        subject.layoutIfNeeded()
        var previousBirths: Float = 0
        for style: NativeLivingSkyScene.RainStyle in [.drizzle, .light, .steady, .heavy] {
            configure(style)
            liveField("\(style) keeps exactly two active depths")
            let births = cells.reduce(Float(0)) { $0 + $1.birthRate }
            let configuredPopulation = cells.reduce(Float(0)) {
                $0 + $1.birthRate * ($1.lifetime + $1.lifetimeRange)
            }
            check(births > previousBirths && births <= 64 && configuredPopulation <= 300,
                  "\(style) density increases while remaining within the large-screen particle budget")
            previousBirths = births
        }
        subject.frame.size = originalSize
        subject.setNeedsLayout()
        subject.layoutIfNeeded()
        let beforeNone = emitters
        let beforeNoneField = field
        configure(.none)
        check(field == nil && retired(beforeNoneField, beforeNone),
              "A dry-weather change clears previous rain synchronously")

        configure()
        let beforeDetach = emitters
        let beforeDetachField = field
        subject.removeFromSuperview()
        check(subject.window == nil && field == nil && retired(beforeDetachField, beforeDetach),
              "Window detachment clears every emitter and particle cell synchronously")
        insertSubview(subject, belowSubview: status)
        subject.layoutIfNeeded()
        liveField("Reattachment can create a fresh field when the current policy still allows it")
        subject.stopImmediately()
        check(field == nil && emitters.isEmpty, "Explicit teardown removes all emitter work")
        subject.removeFromSuperview()
        insertSubview(subject, belowSubview: status)
        try await Task.sleep(for: .milliseconds(220))
        check(field == nil && emitters.isEmpty, "Stopped view remains stopped after reattachment")

        status.text = "PASS\nNative rain lifecycle verified"
        backgroundColor = UIColor(red: 0.06, green: 0.22, blue: 0.13, alpha: 1)
        emit("PASS Native living sky rain renderer verification")
        verificationTask = nil
    }
}

/// Parent-level checks: the actual SwiftUI backdrop must give its UIKit bridge
/// a useful viewport and apply reading, evidence, identity, and accessibility
/// policy. This complements the isolated renderer fixture above.
@MainActor
struct NativeSkyRainBackdropVerificationView: View {
    @State private var scene = Self.fixture()
    @State private var identity = "rain-backdrop-place-one"
    @State private var allowed = true
    @State private var reading = false
    @State private var reduceMotion = false
    @State private var immediateStop = false
    @State private var started = false
    @State private var result = "Verifying rain backdrop integration…"

    var body: some View {
        ZStack(alignment: .topLeading) {
            NativeLivingSkyBackdrop(scene: scene, isDark: true, reading: reading,
                increasedContrast: false, reduceTransparency: false,
                motionAllowed: allowed, reduceMotion: reduceMotion, sceneIdentity: identity,
                immediateMotionStop: immediateStop)
                .ignoresSafeArea()
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

    private static func fixture(revision: Int = 0, family: NativeLivingSkyScene.Family = .rain,
                                style: NativeLivingSkyScene.RainStyle = .steady,
                                source: NativeLivingSkyScene.Source = .currentForecast,
                                context: NativeLivingSkyScene.Context = .current) -> NativeLivingSkyScene {
        let date = Date(timeIntervalSince1970: 1_789_840_000 + Double(revision) * 60)
        return NativeLivingSkyScene(family: family, lightPhase: .night, isDaylight: false,
            cloudCoverage: 0.9, context: context, source: source,
            referenceDate: date, weatherDate: source == .unavailable ? nil : date,
            rainStyle: style)
    }

    private func rainViews() -> [NativeSkyRainView] {
        func descend(_ view: UIView) -> [NativeSkyRainView] {
            var values = (view as? NativeSkyRainView).map { [$0] } ?? []
            for child in view.subviews { values += descend(child) }
            return values
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { !$0.isHidden }.flatMap(descend)
            .filter { $0.window != nil }
    }

    private func emitters() -> [CAEmitterLayer] {
        func descend(_ layer: CALayer) -> [CAEmitterLayer] {
            var values = (layer as? CAEmitterLayer).map { [$0] } ?? []
            for child in layer.sublayers ?? [] { values += descend(child) }
            return values
        }
        return rainViews().flatMap { descend($0.layer) }
    }

    private func emit(_ message: String) {
        print(message)
        fflush(stdout)
    }

    private func diagnostics(_ checkpoint: String) {
        emit("DIAGNOSTIC rain backdrop [\(checkpoint)] views=\(rainViews().count) emitters=\(emitters().count) family=\(scene.family) style=\(scene.rainStyle) source=\(scene.source) allowed=\(allowed) reading=\(reading)")
        for (index, view) in rainViews().enumerated() {
            emit("DIAGNOSTIC rain backdrop view[\(index)] bounds=\(view.bounds) frame=\(view.frame) window=\(view.window != nil) alpha=\(view.alpha) hidden=\(view.isHidden)")
        }
        for (index, layer) in emitters().enumerated() {
            let localAge = layer.convertTime(CACurrentMediaTime(), from: nil)
            emit("DIAGNOSTIC rain backdrop emitter[\(index)] bounds=\(layer.bounds) source=\(layer.emitterPosition) direction=\(layer.emitterCells?.first?.emissionLongitude ?? .nan) births=\(layer.emitterCells?.first?.birthRate ?? 0) begin=\(layer.beginTime) localAge=\(localAge) presentation=\(layer.presentation() != nil)")
        }
    }

    private func fail(_ message: String) -> Never {
        result = "FAIL\n\(message)"
        emit("FAIL Native sky rain backdrop: \(message)")
        diagnostics("failure")
        preconditionFailure(message)
    }

    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky rain backdrop: \(message)")
    }

    private func active(_ message: String) {
        let views = rainViews()
        let layers = emitters()
        check(views.count == 1 && views.allSatisfy { $0.bounds.width > 100 && $0.bounds.height > 300 }
            && layers.count == 2 && layers.allSatisfy { $0.speed == 1 && $0.birthRate > 0 }, message)
    }

    private func verify() async throws {
        try await Task.sleep(for: .milliseconds(500))
        diagnostics("first layout")
        active("Real SwiftUI backdrop gives one rain bridge a full-sized viewport and two active depths")
        check(emitters().allSatisfy { $0.presentation() != nil && $0.beginTime > 0 },
              "Backdrop emitters are in the real compositor with explicit fresh simulation time")
        let original = Set(emitters().map(ObjectIdentifier.init))
        scene = Self.fixture(revision: 1)
        try await Task.sleep(for: .milliseconds(180))
        check(Set(emitters().map(ObjectIdentifier.init)) == original,
              "A normal forecast refresh preserves the backdrop's live rain field")

        reading = true
        try await Task.sleep(for: .milliseconds(310))
        check(emitters().isEmpty, "Reading removes all precipitation after its short exit fade")
        reading = false
        try await Task.sleep(for: .milliseconds(130))
        active("Returning to the hero creates fresh rain")
        allowed = false
        try await Task.sleep(for: .milliseconds(310))
        check(emitters().isEmpty, "motionAllowed=false leaves no active or frozen rain field")
        allowed = true
        try await Task.sleep(for: .milliseconds(130))
        active("Foreground motion permission restores bounded precipitation")

        reduceMotion = true
        try await Task.sleep(for: .milliseconds(80))
        check(emitters().isEmpty, "Reduce Motion removes precipitation without waiting for the exit fade")
        reduceMotion = false
        try await Task.sleep(for: .milliseconds(130))
        active("Leaving Reduce Motion recreates a fresh field")
        immediateStop = true
        try await Task.sleep(for: .milliseconds(80))
        check(emitters().isEmpty, "Immediate power or app-inactive policy clears the backdrop rain synchronously")
        immediateStop = false
        try await Task.sleep(for: .milliseconds(130))
        active("Returning to active policy restores precipitation")

        let previousPlace = emitters()
        reading = true
        try await Task.sleep(for: .milliseconds(40))
        identity = "rain-backdrop-place-two"
        scene = Self.fixture(revision: 2)
        reading = false
        try await Task.sleep(for: .milliseconds(130))
        active("Place changes during an exit fade start exactly one fresh rain field")
        check(previousPlace.allSatisfy { $0.superlayer == nil && ($0.emitterCells?.isEmpty ?? true) }
            && Set(emitters().map(ObjectIdentifier.init)).isDisjoint(with: Set(previousPlace.map(ObjectIdentifier.init))),
              "New-place rain cannot inherit particles from the previous place")
        let newPlace = Set(emitters().map(ObjectIdentifier.init))
        try await Task.sleep(for: .milliseconds(220))
        check(Set(emitters().map(ObjectIdentifier.init)) == newPlace,
              "Cancelled old-place cleanup cannot remove new-place precipitation")

        reading = true
        try await Task.sleep(for: .milliseconds(40))
        scene = Self.fixture(revision: 3, source: .unavailable)
        reading = false
        try await Task.sleep(for: .milliseconds(80))
        check(emitters().isEmpty, "Unavailable current evidence clears rain immediately even during a fade")
        scene = Self.fixture(revision: 4)
        try await Task.sleep(for: .milliseconds(130))
        active("Fresh current evidence restores one bounded rain field")
        scene = Self.fixture(revision: 5, family: .clear, style: .heavy)
        try await Task.sleep(for: .milliseconds(80))
        check(emitters().isEmpty, "A sunny scene cannot inherit rain even if a malformed fixture supplies a heavy style")
        scene = Self.fixture(revision: 6, style: .none)
        try await Task.sleep(for: .milliseconds(100))
        check(emitters().isEmpty, "A static rainy atmosphere with no accepted rain rate has no particle field")
        scene = Self.fixture(revision: 7, source: .selectedForecast,
                             context: .forecast(Date(timeIntervalSince1970: 1_789_850_000)))
        try await Task.sleep(for: .milliseconds(100))
        check(emitters().isEmpty, "A selected future forecast never presents rain as observed current weather")

        result = "PASS\nRain backdrop integration verified"
        emit("PASS Native living sky rain backdrop integration verification")
    }
}
#endif
