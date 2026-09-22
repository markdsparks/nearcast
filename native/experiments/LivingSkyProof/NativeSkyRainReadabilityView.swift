#if targetEnvironment(simulator)
import SwiftUI
import UIKit
import QuartzCore
import Darwin

/// An explicitly illustrative reproduction of the crowded Today layout that
/// hid light rain: a real navigation header, places rail, alert, then the hero.
/// Geometry, visibility, and scroll phase are native callbacks, not fake gates.
@MainActor
struct NativeSkyRainReadabilityView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var heroFrame = CGRect.zero
    @State private var viewportFrame = CGRect.zero
    @State private var heroVisible = false
    @State private var scrolling = false
    @State private var appeared = false
    @State private var alertHeight: CGFloat = 102
    @State private var started = false
    @State private var outcome = "Illustrative fixture · light rain"
    private let automated = ProcessInfo.processInfo.arguments.contains("-verify-rain-readability")
    private static let fixture: NativeLivingSkyScene = {
        let date = Date(timeIntervalSince1970: 1_789_867_200)
        return NativeLivingSkyScene(family: .rain, lightPhase: .night, isDaylight: false,
            cloudCoverage: 0.88, context: .current, source: .currentForecast,
            referenceDate: date, weatherDate: date, rainStyle: .light)
    }()

    var body: some View {
        NavigationStack {
            ZStack {
                NativeLivingSkyBackdrop(scene: Self.fixture, isDark: true,
                    reading: !heroVisible, increasedContrast: false, reduceTransparency: false,
                    motionAllowed: appeared && scenePhase == .active && heroVisible && !scrolling,
                    sceneIdentity: "aurora-rain-layout-fixture",
                    immediateMotionStop: !appeared || scenePhase != .active,
                    precipitationFocus: heroFrame.isEmpty ? nil : heroFrame)
                    .ignoresSafeArea()
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 20) {
                            HStack(spacing: 7) {
                                Text("Aurora, Illinois").font(.headline)
                                Image(systemName: "chevron.down").font(.caption.bold())
                            }.frame(maxWidth: .infinity).id("rain-fixture-top")
                            places
                            Text(outcome).font(.caption2).foregroundStyle(.white.opacity(0.65))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                                VStack(alignment: .leading, spacing: 7) {
                                    Text("Official alert").font(.headline)
                                    Text("Flood watch in the area").font(.subheadline)
                                    Text("Illustrative alert — not live weather").font(.caption)
                                        .foregroundStyle(.white.opacity(0.7))
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption)
                            }
                            .padding(16).frame(maxWidth: .infinity, minHeight: alertHeight, alignment: .leading)
                            .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 20))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(.orange.opacity(0.35)))
                            hero
                            VStack(alignment: .leading, spacing: 12) {
                                Text("TONIGHT’S OUTLOOK").font(.caption.weight(.bold)).tracking(1.4)
                                Text("Rain easing later tonight").font(.title2.bold())
                                Text("A calm, readable forecast stays in front of the weather.")
                                    .font(.subheadline).foregroundStyle(.white.opacity(0.72))
                                HStack {
                                    ForEach(["Now", "21", "22", "23", "00"], id: \.self) { hour in
                                        VStack(spacing: 12) {
                                            Text(hour).font(.caption.bold())
                                            Image(systemName: "cloud.rain.fill").symbolRenderingMode(.hierarchical)
                                            Text("68°").font(.headline)
                                        }.frame(maxWidth: .infinity)
                                    }
                                }.padding(.top, 10)
                            }
                            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.black.opacity(0.23), in: RoundedRectangle(cornerRadius: 26))
                            ForEach(0..<12) { index in
                                HStack {
                                    Text(index == 0 ? "Tomorrow" : "Forecast day \(index + 1)")
                                    Spacer()
                                    Image(systemName: "cloud.fill")
                                    Text("61°  —  73°").monospacedDigit()
                                }.padding(.vertical, 20)
                                Divider().overlay(.white.opacity(0.12))
                            }
                            Color.clear.frame(height: 1).id("rain-fixture-bottom")
                        }
                        .padding(.horizontal, 16).padding(.top, 2).padding(.bottom, 24)
                        .frame(maxWidth: 760).frame(maxWidth: .infinity)
                    }
                    .coordinateSpace(name: "native-weather-scroll")
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global).integral } action: { viewportFrame = $0 }
                    .onScrollPhaseChange { _, phase in scrolling = phase != .idle }
                    .task {
                        guard automated, !started else { return }; started = true
                        do { try await verify(proxy) }
                        catch { fail("Verification interrupted: \(error)") }
                    }
                }
            }
            .foregroundStyle(.white)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                HStack {
                    ForEach([("sun.max", "Today"), ("clock", "Hourly"), ("sparkle", "Ask"),
                             ("map", "Map"), ("calendar", "Plans")], id: \.1) { symbol, title in
                        VStack(spacing: 5) {
                            Image(systemName: symbol).font(.title3)
                            Text(title).font(.caption2.bold())
                        }.frame(maxWidth: .infinity)
                    }
                }
                .padding(.vertical, 12).background(.regularMaterial, in: Capsule())
                .padding(.horizontal, 16).padding(.bottom, 4)
            }
            .navigationTitle("Nearcast").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Image(systemName: "xmark") }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Image(systemName: "gearshape")
                    Image(systemName: "list.bullet")
                    Image(systemName: "arrow.clockwise")
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .onAppear { appeared = true }
            .onDisappear { appeared = false; scrolling = false }
        }.preferredColorScheme(.dark)
    }

    private var places: some View {
        HStack(spacing: 10) {
            ForEach([("Aurora", "68°"), ("Home", "73°"), ("Warsaw", "52°")], id: \.0) { name, value in
                VStack(alignment: .leading, spacing: 10) {
                    HStack { Text(name).font(.subheadline.bold()); Spacer(minLength: 3); Text(value).font(.headline) }
                    Label("Cloudy", systemImage: "cloud.fill").font(.caption)
                    Text("Rain this evening").font(.caption2).foregroundStyle(.white.opacity(0.65))
                }
                .padding(12).frame(maxWidth: .infinity)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
            }
        }
    }

    private var hero: some View {
        let suppressMeasurement = scrolling
        return VStack(spacing: 8) {
            HStack(spacing: 20) {
                Text("68°").font(.system(size: 84, weight: .semibold, design: .rounded))
                Image(systemName: "cloud.rain.fill").symbolRenderingMode(.hierarchical)
                    .font(.system(size: 58)).foregroundStyle(Color(red: 0.73, green: 0.86, blue: 0.91))
            }
            Text("Light rain · feels 68°").font(.headline)
            Text("High 72° · Low 59°").font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.72))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 18).padding(.bottom, 14)
        .onGeometryChange(for: CGRect?.self) { geometry in
            suppressMeasurement ? nil : geometry.frame(in: .global).integral
        } action: { frame in
            if let frame, frame != heroFrame { heroFrame = frame }
        }
        .onScrollVisibilityChange(threshold: 0.05) { heroVisible = $0 }
        .id("rain-fixture-hero")
    }

    private func emit(_ value: String) { print(value); fflush(stdout) }
    private func fail(_ message: String) -> Never {
        outcome = "FAIL: \(message)"
        emit("FAIL Native rain readability: \(message) hero=\(heroFrame) visible=\(heroVisible) scroll=\(scrolling) layers=\(emitters().count)")
        preconditionFailure(message)
    }
    private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        guard condition() else { fail(message) }
        emit("PASS Native rain readability: \(message)")
    }
    private func emitters() -> [CAEmitterLayer] {
        func descend(_ layer: CALayer) -> [CAEmitterLayer] {
            ((layer as? CAEmitterLayer).map { [$0] } ?? []) + (layer.sublayers ?? []).flatMap(descend)
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).filter { !$0.isHidden }.flatMap { descend($0.layer) }
    }
    private func ids() -> Set<ObjectIdentifier> { Set(emitters().map(ObjectIdentifier.init)) }
    private func verify(_ proxy: ScrollViewProxy) async throws {
        try await Task.sleep(for: .milliseconds(750))
        // The task may begin while the environment still has its launch-time
        // inactive snapshot. Live emitter presence below verifies the body's
        // current scenePhase gate; State-backed geometry remains live here.
        check(appeared && heroVisible && !scrolling,
              "Actual native callbacks allow the visible, settled Aurora hero")
        check(heroFrame.minY > 250 && heroFrame.height > 130,
              "The family rail and alert shift the real hero into the middle of the screen")
        check(emitters().count == 2 && emitters().allSatisfy { $0.speed == 1 && $0.birthRate > 0 },
              "Accepted light rain renders in the real crowded Today layout")
        let original = ids()
        let originalFrame = heroFrame
        alertHeight += 36
        try await Task.sleep(for: .milliseconds(300))
        check(heroFrame.minY > originalFrame.minY && heroVisible && ids() == original,
              "Alert reflow updates the global hero focus without restarting precipitation")
        withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo("rain-fixture-bottom", anchor: .bottom) }
        try await Task.sleep(for: .milliseconds(90))
        check(scrolling && emitters().allSatisfy { $0.speed == 0 && $0.birthRate == 0 },
              "Native scrolling pauses simulation immediately rather than fighting the gesture")
        try await Task.sleep(for: .milliseconds(650))
        check(!heroVisible && !scrolling && emitters().isEmpty,
              "Settling away from the hero leaves no invisible or frozen particle work")
        let focusBeforeReturn = heroFrame
        withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo("rain-fixture-hero", anchor: .center) }
        try await Task.sleep(for: .milliseconds(800))
        check(heroVisible && !scrolling && emitters().count == 2
            && emitters().allSatisfy { $0.speed == 1 && $0.birthRate > 0 },
              "Returning to the hero automatically resumes fresh rain after scroll settles")
        check(ids().isDisjoint(with: original), "Returning rain uses fresh particles rather than stale frozen positions")
        check(heroFrame != focusBeforeReturn && abs(heroFrame.midY - viewportFrame.midY) < 8,
              "Idle geometry resamples the partly returned hero after suppressing updates during scrolling")
        outcome = "PASS · native scroll and rain focus"
        emit("PASS Native living sky rain readability verification")
    }
}
#endif
