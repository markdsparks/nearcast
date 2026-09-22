#if targetEnvironment(simulator)
import SwiftUI
import UIKit
import QuartzCore
import Darwin

/// Simulator-only checks against the shared precipitation backend. Public
/// layer configuration and lifetime are inspected, never private particles.
struct NativeSkySnowVerificationView: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView { NativeSkySnowVerificationHost() }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

@MainActor
private final class NativeSkySnowVerificationHost: UIView {
    private let subject = NativeSkyRainView()
    private let label = UILabel()
    private var task: Task<Void, Never>?
    private var started = false
    private var manualSize = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.07, green: 0.13, blue: 0.21, alpha: 1)
        addSubview(subject)
        label.text = "Verifying native snow…"
        label.numberOfLines = 0
        label.textColor = .white
        label.font = .monospacedSystemFont(ofSize: 16, weight: .medium)
        addSubview(label)
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        if !manualSize { subject.frame = bounds }
        label.frame = CGRect(x: 20, y: 60, width: max(1, bounds.width - 40), height: 100)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { task?.cancel(); subject.stopImmediately(); return }
        guard !started else { return }
        started = true
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(for: .milliseconds(180))
                self.layoutIfNeeded()
                self.subject.layoutIfNeeded()
                try await self.verify()
            } catch { self.fail("Verification cancelled before final marker: \(error)") }
        }
    }

    private var field: CALayer? { subject.layer.sublayers?.first { $0.name == "nearcast.snow-field" } }
    private var emitters: [CAEmitterLayer] { NativeSkySnowProbe.emitters(in: subject.layer) }
    private var cells: [CAEmitterCell] { emitters.flatMap { $0.emitterCells ?? [] } }
    private func ids(_ layers: [CAEmitterLayer]) -> Set<ObjectIdentifier> { Set(layers.map(ObjectIdentifier.init)) }

    private func emit(_ message: String) { print(message); fflush(stdout) }
    private func fail(_ message: String) -> Never {
        label.text = "FAIL\n\(message)"
        emit("FAIL Native sky snow: \(message)")
        emit("DIAGNOSTIC snow bounds=\(subject.bounds) field=\(field != nil) emitters=\(emitters.count)")
        for emitter in emitters {
            emit("DIAGNOSTIC snow name=\(emitter.name ?? "nil") speed=\(emitter.speed) births=\(emitter.birthRate) time=\(emitter.convertTime(CACurrentMediaTime(), from: nil))")
        }
        preconditionFailure(message)
    }
    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky snow: \(message)")
    }
    private func configure(_ style: NativeLivingSkyScene.SnowStyle = .steady,
                           active: Bool = true, immediateStop: Bool = false,
                           identity: String = "snow-place-one", isNight: Bool = false) {
        subject.configureSnow(style: style, active: active, immediateStop: immediateStop,
                              identity: identity, isNight: isNight)
    }
    private func live(_ message: String) {
        check(field != nil && emitters.count == 2 && cells.count == 2
            && emitters.allSatisfy { $0.speed == 1 && $0.birthRate > 0 && $0.timeOffset == 0 }, message)
    }
    private func retired(_ field: CALayer?, _ emitters: [CAEmitterLayer]) -> Bool {
        field?.superlayer == nil && emitters.allSatisfy {
            $0.superlayer == nil && $0.birthRate == 0 && ($0.emitterCells?.isEmpty ?? true)
                && ($0.animationKeys()?.isEmpty ?? true)
        }
    }

    private func verify() async throws {
        check(subject.window != nil && subject.bounds.width > 100 && subject.bounds.height > 300,
              "Snow backend is laid out in a real simulator window")
        check(!subject.isUserInteractionEnabled && subject.accessibilityElementsHidden,
              "Snow cannot intercept touches or accessibility navigation")
        configure(.none)
        check(field == nil && emitters.isEmpty, "No accepted snow allocates no particles")
        configure()
        live("Active snow has exactly two finite-lifetime depths")
        check(Set(emitters.compactMap(\.name)) == ["nearcast.snow-far", "nearcast.snow-near"],
              "Snow has named independent far and near layers")
        check(emitters.allSatisfy {
            let age = $0.convertTime(CACurrentMediaTime(), from: nil)
            return $0.beginTime > 0 && age >= 0 && age < 0.15
        }, "New snow starts at local age zero")
        check(cells.allSatisfy { $0.contents != nil && $0.lifetime > 0 && $0.lifetime.isFinite
            && $0.birthRate > 0 && $0.alphaSpeed < 0 }, "Snow has cached contents and bounded fading lifetimes")
        check(emitters.allSatisfy { $0.emitterShape == .line }
            && cells.allSatisfy { abs($0.emissionLongitude - .pi) < 0.4 },
              "Snow is directed downward into the viewport")
        check(field?.mask is CAGradientLayer && field?.sublayers?.first?.mask is CAGradientLayer,
              "Hero and reading masks protect the weather content")
        let first = emitters
        let firstField = field
        try await Task.sleep(for: .milliseconds(250))
        check(emitters.allSatisfy { $0.presentation() != nil }, "Snow reaches the live compositor")
        configure()
        subject.setNeedsLayout()
        subject.layoutIfNeeded()
        check(field === firstField && ids(emitters) == ids(first),
              "Routine refresh and unchanged layout preserve the snow simulation")

        configure(active: false)
        check(emitters.count == 2 && emitters.allSatisfy { $0.speed == 0 && $0.birthRate == 0 }
            && field?.opacity == 0 && !(field?.animationKeys()?.isEmpty ?? true),
              "Pause immediately freezes simulation and fades only the field")
        try await Task.sleep(for: .milliseconds(320))
        check(field == nil && emitters.isEmpty && retired(firstField, first),
              "The exit fade retires all snow layers and cell work")
        configure(active: false)
        check(emitters.isEmpty, "Repeated paused updates allocate no snow")
        configure()
        live("Resume creates fresh snow")
        check(ids(emitters).isDisjoint(with: ids(first)), "Resumed snow never replays frozen particles")
        let quickOld = emitters
        let quickOldField = field
        configure(active: false)
        try await Task.sleep(for: .milliseconds(40))
        configure()
        let quickNew = emitters
        check(retired(quickOldField, quickOld) && ids(quickNew).isDisjoint(with: ids(quickOld)),
              "Resume during fade retires the old field before starting a new one")
        try await Task.sleep(for: .milliseconds(270))
        check(ids(emitters) == ids(quickNew), "Cancelled cleanup cannot remove the resumed snow")

        let restricted = emitters
        let restrictedField = field
        configure(immediateStop: true)
        check(emitters.isEmpty && retired(restrictedField, restricted),
              "Power, inactive-app, and accessibility restrictions clear snow synchronously")
        configure()
        let previousPlace = emitters
        let previousPlaceField = field
        configure(identity: "snow-place-two")
        live("A new place starts exactly one new snow field")
        check(retired(previousPlaceField, previousPlace) && ids(emitters).isDisjoint(with: ids(previousPlace)),
              "Snow cannot cross place identities")
        let beforeNight = emitters
        configure(identity: "snow-place-two", isNight: true)
        check(ids(emitters).isDisjoint(with: ids(beforeNight)), "Night tint starts a fresh bounded field")

        let normalSize = subject.bounds.size
        let beforeResize = emitters
        let beforeResizeField = field
        manualSize = true
        subject.frame.size = CGSize(width: normalSize.width + 25, height: normalSize.height - 45)
        subject.setNeedsLayout(); subject.layoutIfNeeded()
        live("Resizing keeps only two correctly sized depths")
        check(retired(beforeResizeField, beforeResize) && field?.bounds.size == subject.bounds.size
            && emitters.allSatisfy { $0.bounds.size == subject.bounds.size && $0.emitterSize.width > subject.bounds.width },
              "Resize retires old geometry and retains source overscan")

        subject.frame.size = CGSize(width: 4_000, height: 4_000)
        subject.setNeedsLayout(); subject.layoutIfNeeded()
        var previousBirths: Float = 0
        for style: NativeLivingSkyScene.SnowStyle in [.light, .steady, .heavy] {
            configure(style)
            live("\(style) snow keeps two particle depths")
            let births = cells.reduce(Float(0)) { $0 + $1.birthRate }
            let population = cells.reduce(Float(0)) { $0 + $1.birthRate * ($1.lifetime + $1.lifetimeRange) }
            check(births > previousBirths && population < 300,
                  "\(style) snow increases density within a finite under-300 large-screen budget")
            previousBirths = births
        }
        subject.frame.size = normalSize
        subject.setNeedsLayout(); subject.layoutIfNeeded()
        let oldSnow = emitters
        let oldSnowField = field
        subject.configure(style: .steady, active: true, immediateStop: false, identity: "snow-place-one", isNight: false)
        check(field == nil && emitters.count == 2 && retired(oldSnowField, oldSnow)
            && emitters.allSatisfy { $0.name?.hasPrefix("nearcast.rain-") == true },
              "The shared backend switches snow to rain without running both engines")
        let oldRain = emitters
        configure()
        live("Switching rain back to snow yields exactly one fresh snow field")
        check(oldRain.allSatisfy { $0.superlayer == nil && ($0.emitterCells?.isEmpty ?? true) },
              "Snow does not inherit rain cells")
        configure(.none)
        check(emitters.isEmpty, "Dry style clears snow synchronously")
        configure()
        let beforeDetach = emitters
        let beforeDetachField = field
        subject.removeFromSuperview()
        check(subject.window == nil && emitters.isEmpty && retired(beforeDetachField, beforeDetach),
              "Detaching removes snow synchronously")
        insertSubview(subject, belowSubview: label)
        subject.layoutIfNeeded()
        live("Reattachment starts fresh snow only while policy permits")
        subject.stopImmediately()
        subject.removeFromSuperview()
        insertSubview(subject, belowSubview: label)
        try await Task.sleep(for: .milliseconds(220))
        check(emitters.isEmpty, "Explicit teardown stays stopped across reattachment")
        label.text = "PASS\nNative snow lifecycle verified"
        emit("PASS Native living sky snow renderer verification")
        task = nil
    }
}

/// Cross-surface verification uses the real Backdrop and real SwiftUI bridge,
/// including evidence invalidation and rain/snow/storm scene transitions.
@MainActor
struct NativeSkySnowBackdropVerificationView: View {
    @State private var scene = Self.fixture()
    @State private var identity = "snow-backdrop-one"
    @State private var allowed = true
    @State private var reading = false
    @State private var reduceMotion = false
    @State private var immediateStop = false
    @State private var started = false
    @State private var result = "Verifying snow and storm backdrop…"

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

    private static func fixture(revision: Int = 0, family: NativeLivingSkyScene.Family = .snow,
                                snow: NativeLivingSkyScene.SnowStyle = .steady,
                                rain: NativeLivingSkyScene.RainStyle = .none,
                                storm: NativeLivingSkyScene.StormStyle = .none,
                                source: NativeLivingSkyScene.Source = .currentForecast,
                                context: NativeLivingSkyScene.Context = .current) -> NativeLivingSkyScene {
        let date = Date(timeIntervalSince1970: 1_789_840_000 + Double(revision) * 60)
        return NativeLivingSkyScene(family: family, lightPhase: .night, isDaylight: false,
            cloudCoverage: 0.9, context: context, source: source,
            referenceDate: date, weatherDate: source == .unavailable ? nil : date,
            rainStyle: rain, snowStyle: snow, stormStyle: storm)
    }
    private func emit(_ value: String) { print(value); fflush(stdout) }
    private func fail(_ message: String) -> Never {
        result = "FAIL\n\(message)"
        emit("FAIL Native sky snow backdrop: \(message)")
        for view in NativeSkySnowProbe.views() {
            emit("DIAGNOSTIC snow backdrop bounds=\(view.bounds) window=\(view.window != nil) emitters=\(NativeSkySnowProbe.emitters(in: view.layer).map { $0.name ?? "nil" })")
        }
        preconditionFailure(message)
    }
    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native sky snow backdrop: \(message)")
    }
    private func emitters() -> [CAEmitterLayer] { NativeSkySnowProbe.views().flatMap { NativeSkySnowProbe.emitters(in: $0.layer) } }
    private func ids() -> Set<ObjectIdentifier> { Set(emitters().map(ObjectIdentifier.init)) }
    private func active(_ prefix: String = "snow", _ message: String) {
        let views = NativeSkySnowProbe.views().filter { !NativeSkySnowProbe.emitters(in: $0.layer).isEmpty }
        let layers = emitters()
        check(views.count == 1 && views.allSatisfy { $0.bounds.width > 100 && $0.bounds.height > 300 }
            && layers.count == 2 && layers.allSatisfy {
                $0.speed == 1 && $0.birthRate > 0 && $0.name?.hasPrefix("nearcast.\(prefix)-") == true
            }, message)
    }
    private func verify() async throws {
        try await Task.sleep(for: .milliseconds(500))
        active("snow", "SwiftUI gives snow a full viewport with exactly two active depths")
        check(emitters().allSatisfy { $0.presentation() != nil && $0.beginTime > 0 },
              "Snow is attached to the real compositor with fresh simulation time")
        let original = ids()
        scene = Self.fixture(revision: 1)
        try await Task.sleep(for: .milliseconds(120))
        check(ids() == original, "A forecast refresh does not restart snow")
        reading = true
        try await Task.sleep(for: .milliseconds(310))
        check(emitters().isEmpty, "Reading leaves no frozen or active snow")
        reading = false
        try await Task.sleep(for: .milliseconds(110))
        active("snow", "Returning to the hero restores fresh snow")
        allowed = false
        try await Task.sleep(for: .milliseconds(310))
        check(emitters().isEmpty, "Motion permission loss retires snow")
        allowed = true
        try await Task.sleep(for: .milliseconds(110))
        active("snow", "Foreground policy restores snow")
        reduceMotion = true
        try await Task.sleep(for: .milliseconds(70))
        check(emitters().isEmpty, "Reduce Motion removes particles before the fade deadline")
        reduceMotion = false
        try await Task.sleep(for: .milliseconds(110))
        immediateStop = true
        try await Task.sleep(for: .milliseconds(70))
        check(emitters().isEmpty, "Power or inactive-app policy immediately clears particles")
        immediateStop = false
        try await Task.sleep(for: .milliseconds(110))
        let beforePlace = emitters()
        reading = true
        try await Task.sleep(for: .milliseconds(35))
        identity = "snow-backdrop-two"
        scene = Self.fixture(revision: 2)
        reading = false
        try await Task.sleep(for: .milliseconds(110))
        active("snow", "A place change during fade starts only new-place snow")
        check(beforePlace.allSatisfy { $0.superlayer == nil && ($0.emitterCells?.isEmpty ?? true) },
              "Previous-place particles are fully retired")
        let afterPlace = ids()
        try await Task.sleep(for: .milliseconds(230))
        check(ids() == afterPlace, "Cancelled old-place cleanup cannot destroy new-place snow")

        for revision in 3...6 {
            let rain = revision.isMultiple(of: 2)
            scene = Self.fixture(revision: revision, family: rain ? .rain : .snow,
                                 snow: rain ? .none : .steady, rain: rain ? .steady : .none)
            try await Task.sleep(for: .milliseconds(70))
            active(rain ? "rain" : "snow", "Rain/snow transition \(revision) never runs both particle types")
        }
        scene = Self.fixture(revision: 7, family: .rain, snow: .none, rain: .heavy, storm: .thunderstorm)
        try await Task.sleep(for: .milliseconds(130))
        active("rain", "A thunderstorm uses the existing two rain depths, not another particle engine")
        check(Set(NativeSkySnowProbe.windowLayers().flatMap { NativeSkySnowProbe.emitters(in: $0) }
            .map(ObjectIdentifier.init)) == ids(),
              "No additional storm emitter exists elsewhere in the backdrop window")
        let rainBeforeStormRefresh = ids()
        scene = Self.fixture(revision: 8, family: .rain, snow: .none, rain: .heavy, storm: .none)
        try await Task.sleep(for: .milliseconds(100))
        check(ids() == rainBeforeStormRefresh, "Storm atmosphere changes do not restart precipitation")
        check(NativeSkySnowProbe.windowLayers().allSatisfy { NativeSkySnowProbe.flashAnimations(in: $0).isEmpty },
              "The entire storm backdrop creates no lightning or flash animation")
        scene = Self.fixture(revision: 9, family: .rain, snow: .none, rain: .none, storm: .thunderstorm)
        try await Task.sleep(for: .milliseconds(70))
        check(emitters().isEmpty, "Storm classification without accepted rain creates no rain particles")

        scene = Self.fixture(revision: 10)
        try await Task.sleep(for: .milliseconds(110))
        reading = true
        try await Task.sleep(for: .milliseconds(35))
        scene = Self.fixture(revision: 11, source: .unavailable)
        reading = false
        try await Task.sleep(for: .milliseconds(70))
        check(emitters().isEmpty, "Unavailable evidence immediately clears snow during an exit fade")
        scene = Self.fixture(revision: 12, family: .clear, snow: .heavy, rain: .heavy)
        try await Task.sleep(for: .milliseconds(90))
        check(emitters().isEmpty, "A malformed sunny fixture cannot show rain or snow particles")
        scene = Self.fixture(revision: 13, snow: .none)
        try await Task.sleep(for: .milliseconds(90))
        check(emitters().isEmpty, "A snow atmosphere without an accepted current rate remains still")
        scene = Self.fixture(revision: 14, source: .selectedForecast,
                             context: .forecast(Date(timeIntervalSince1970: 1_789_850_000)))
        try await Task.sleep(for: .milliseconds(90))
        check(emitters().isEmpty, "A selected future forecast does not present snow as occurring now")
        result = "PASS\nSnow and storm backdrop verified"
        emit("PASS Native living sky snow backdrop integration verification")
    }
}

@MainActor
private enum NativeSkySnowProbe {
    static func windowLayers() -> [CALayer] {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { !$0.isHidden }.map(\.layer)
    }
    static func emitters(in layer: CALayer) -> [CAEmitterLayer] {
        ((layer as? CAEmitterLayer).map { [$0] } ?? []) + (layer.sublayers ?? []).flatMap { emitters(in: $0) }
    }
    static func views() -> [NativeSkyRainView] {
        func descend(_ view: UIView) -> [NativeSkyRainView] {
            ((view as? NativeSkyRainView).map { [$0] } ?? []) + view.subviews.flatMap(descend)
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { !$0.isHidden }.flatMap(descend).filter { $0.window != nil }
    }
    static func flashAnimations(in layer: CALayer) -> [String] {
        let keys = (layer.animationKeys() ?? []).filter {
            $0.localizedCaseInsensitiveContains("flash") || $0.localizedCaseInsensitiveContains("lightning")
        }
        return keys + (layer.sublayers ?? []).flatMap { flashAnimations(in: $0) }
    }
}
#endif
