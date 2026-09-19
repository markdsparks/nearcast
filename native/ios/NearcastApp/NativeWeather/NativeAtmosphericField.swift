import SwiftUI

/// Nearcast's visual weather language is a field, not an illustration.  It
/// translates conditions we already have into light, depth, and a restrained
/// horizon without inventing a rain shower, lightning strike, or exact sky.
enum NativeAtmospherePlacement {
    case backdrop
    case hero
    case card
    case hourly
}

struct NativeAtmosphericField: View {
    let point: NativeForecastPoint?
    let usesMetric: Bool
    let isDark: Bool
    let reduceMotion: Bool
    let increasedContrast: Bool
    let placement: NativeAtmospherePlacement

    @State private var drift = false

    private var code: Int { point?.weatherCode ?? -1 }
    private var isStorm: Bool { [95, 96, 99].contains(code) }
    private var isPrecipitation: Bool {
        (51...67).contains(code) || (80...82).contains(code) || (71...77).contains(code)
            || (85...86).contains(code) || isStorm
    }
    private var isFog: Bool { [45, 48].contains(code) }
    private var cloudCover: Double {
        if let cloudCover = point?.cloudCover, cloudCover.isFinite { return min(100, max(0, cloudCover)) }
        if isPrecipitation || isFog { return 88 }
        if code == 3 { return 92 }
        if code == 2 { return 56 }
        if code == 1 { return 28 }
        return 8
    }
    private var isDay: Bool { point?.isDay ?? !isDark }
    private var isForecastRisk: Bool { point?.thunderPossible == true && !isStorm }
    private var warmth: Double {
        guard let temperature = point?.temperature, temperature.isFinite else { return 0.5 }
        // The color responds to a broad comfort band, never a literal heat
        // scale. The unit comes from the forecast context rather than a
        // temperature guess so cold Fahrenheit remains visually cold.
        let normalized = usesMetric ? (temperature + 6) / 34 : (temperature - 18) / 82
        return min(1, max(0, normalized))
    }
    private var strength: Double {
        if increasedContrast { return 0.28 }
        switch placement {
        case .backdrop: return 1
        case .hero: return 0.58
        case .card: return 0.24
        case .hourly: return 0.42
        }
    }
    private var canDrift: Bool { placement == .backdrop && !reduceMotion && !increasedContrast }
    private var allowsConditionTexture: Bool { placement != .hourly && placement != .card }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                base
                directionalLight(size: size)
                airMass(size: size)
                if allowsConditionTexture && isPrecipitation { moistureField(size: size) }
                if allowsConditionTexture && isFog { mistField(size: size) }
                forecastHorizon(size: size)
            }
            .compositingGroup()
            .onAppear(perform: updateDrift)
            .onChange(of: reduceMotion) { _, _ in updateDrift() }
            .onChange(of: increasedContrast) { _, _ in updateDrift() }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var base: some View {
        if placement == .backdrop || placement == .hourly {
            LinearGradient(colors: baseColors, startPoint: .topLeading, endPoint: .bottomTrailing)
        } else {
            Color.clear
        }
    }

    private var baseColors: [Color] {
        if isDark {
            let depth = isStorm ? 0.055 : isFog ? 0.09 : 0.045
            let blue = isStorm ? 0.15 : isFog ? 0.20 : 0.25
            return [
                Color(red: depth, green: depth + 0.03, blue: blue),
                Color(red: depth + 0.03, green: depth + 0.055, blue: blue + 0.04)
            ]
        }
        if isStorm { return [Color(red: 0.38, green: 0.49, blue: 0.61), Color(red: 0.76, green: 0.82, blue: 0.84)] }
        if isPrecipitation { return [Color(red: 0.54, green: 0.69, blue: 0.80), Color(red: 0.86, green: 0.92, blue: 0.93)] }
        if isFog { return [Color(red: 0.70, green: 0.77, blue: 0.79), Color(red: 0.91, green: 0.94, blue: 0.93)] }
        if cloudCover >= 72 { return [Color(red: 0.62, green: 0.73, blue: 0.81), Color(red: 0.89, green: 0.93, blue: 0.94)] }
        return [Color(red: 0.48, green: 0.72, blue: 0.91), Color(red: 0.88, green: 0.95, blue: 0.95)]
    }

    private func directionalLight(size: CGSize) -> some View {
        let tone = isDay
            ? Color(red: 1, green: 0.79 + 0.10 * warmth, blue: 0.42)
            : Color(red: 0.53, green: 0.69, blue: 1)
        return Ellipse()
            .fill(
                RadialGradient(colors: [tone.opacity((isDay ? 0.18 : 0.12) * strength), .clear],
                               center: .center, startRadius: 0, endRadius: max(size.width, size.height) * 0.52)
            )
            .frame(width: max(120, size.width * 0.94), height: max(96, size.height * 0.64))
            .blur(radius: max(18, size.width * 0.075))
            .offset(x: size.width * (drift ? 0.21 : 0.16), y: -size.height * 0.20)
    }

    private func airMass(size: CGSize) -> some View {
        let density = 0.06 + cloudCover / 100 * 0.17
        let shade = isDark ? Color(red: 0.64, green: 0.75, blue: 0.84) : Color.white
        return ZStack {
            Ellipse()
                .fill(shade.opacity(density * strength))
                .frame(width: size.width * 1.10, height: max(70, size.height * 0.40))
                .blur(radius: max(18, size.width * 0.10))
                .offset(x: -size.width * 0.24, y: -size.height * 0.06)
            Ellipse()
                .fill((isDark ? Color.black : Color(red: 0.18, green: 0.31, blue: 0.40)).opacity(density * 0.62 * strength))
                .frame(width: size.width * 0.96, height: max(56, size.height * 0.28))
                .blur(radius: max(16, size.width * 0.09))
                .offset(x: size.width * (drift ? 0.16 : 0.10), y: size.height * 0.25)
        }
    }

    private func moistureField(size: CGSize) -> some View {
        let tone = isStorm ? Color(red: 0.45, green: 0.75, blue: 0.92) : Color(red: 0.56, green: 0.83, blue: 0.96)
        return RoundedRectangle(cornerRadius: size.width)
            .fill(
                LinearGradient(colors: [.clear, tone.opacity(0.12 * strength), .clear],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            )
            .frame(width: size.width * 1.28, height: max(90, size.height * 0.52))
            .blur(radius: max(22, size.width * 0.11))
            .rotationEffect(.degrees(-8))
            .offset(x: -size.width * 0.05, y: size.height * 0.22)
    }

    private func mistField(size: CGSize) -> some View {
        LinearGradient(colors: [.clear, Color.white.opacity(0.15 * strength), .clear],
                       startPoint: .top, endPoint: .bottom)
            .frame(height: max(80, size.height * 0.36))
            .blur(radius: 16)
            .offset(y: size.height * 0.19)
    }

    private func forecastHorizon(size: CGSize) -> some View {
        let tone: Color
        if isStorm { tone = Color(red: 0.88, green: 0.62, blue: 0.31) }
        else if isForecastRisk { tone = Color(red: 0.78, green: 0.56, blue: 0.30) }
        else if isPrecipitation { tone = Color(red: 0.27, green: 0.69, blue: 0.89) }
        else { tone = isDay ? Color(red: 1, green: 0.76, blue: 0.28) : Color(red: 0.48, green: 0.71, blue: 1) }
        let opacity = (isForecastRisk && !isStorm ? 0.12 : 0.22) * strength
        return Capsule()
            .fill(LinearGradient(colors: [.clear, tone.opacity(opacity), .clear], startPoint: .leading, endPoint: .trailing))
            .frame(width: size.width * 1.12, height: max(3, size.height * 0.022))
            .blur(radius: max(2, size.width * 0.007))
            .rotationEffect(.degrees(isForecastRisk ? -2 : 1))
            .offset(y: size.height * 0.27)
    }

    private func updateDrift() {
        guard canDrift else {
            drift = false
            return
        }
        drift = false
        withAnimation(.easeInOut(duration: 18).repeatForever(autoreverses: true)) { drift = true }
    }
}

/// A small, honest cue for how a selected metric evolves. It deliberately
/// separates the current point from projected values without pretending the
/// forecast is an observed trace.
struct NativeAtmosphericTraceSample: Sendable {
    let value: Double?
    let isCurrent: Bool

    init(value: Double?, isCurrent: Bool) {
        self.value = value
        self.isCurrent = isCurrent
    }
}

struct NativeAtmosphericTrace: View {
    let samples: [NativeAtmosphericTraceSample]
    let tint: Color
    let label: String

    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                let finite = samples.enumerated().compactMap { index, sample -> (Int, Double)? in
                    guard let value = sample.value, value.isFinite else { return nil }
                    return (index, value)
                }
                guard finite.count >= 2 else { return }
                let low = finite.map(\.1).min() ?? 0
                let high = finite.map(\.1).max() ?? low + 1
                let span = max(1, high - low)
                let inset = min(CGFloat(5), size.width / CGFloat(max(3, samples.count * 2)))
                let x: (Int) -> CGFloat = { index in
                    samples.count <= 1 ? size.width / 2 : inset + (size.width - inset * 2) * CGFloat(index) / CGFloat(samples.count - 1)
                }
                let y: (Double) -> CGFloat = { value in
                    let fraction = (value - low) / span
                    return size.height * (0.82 - 0.62 * CGFloat(fraction))
                }

                var trace = Path()
                var previous: Int?
                for (index, sample) in samples.enumerated() {
                    guard let value = sample.value, value.isFinite else { previous = nil; continue }
                    let position = CGPoint(x: x(index), y: y(value))
                    if let previous, index == previous + 1 { trace.addLine(to: position) }
                    else { trace.move(to: position) }
                    previous = index
                }
                context.stroke(trace, with: .color(tint.opacity(0.43)), style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))

                for (index, sample) in samples.enumerated() {
                    guard let value = sample.value, value.isFinite else { continue }
                    let radius: CGFloat = sample.isCurrent ? 4.2 : 2.4
                    let marker = CGRect(x: x(index) - radius, y: y(value) - radius, width: radius * 2, height: radius * 2)
                    context.fill(Path(ellipseIn: marker), with: .color(tint.opacity(sample.isCurrent ? 1 : 0.60)))
                    if sample.isCurrent {
                        context.stroke(Path(ellipseIn: marker.insetBy(dx: 1.1, dy: 1.1)), with: .color(.white.opacity(0.86)), lineWidth: 1)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

/// Shared certainty grammar for the map: solid is observed radar, softened is
/// model guidance. It sits inside the existing timeline rather than covering
/// the actual radar raster.
struct NativeRadarContinuityTrace: View {
    let start: Date
    let end: Date
    let now: Date
    let selected: Date?
    let tint: Color

    private var split: CGFloat {
        guard end > start else { return 0 }
        return min(1, max(0, CGFloat(now.timeIntervalSince(start) / end.timeIntervalSince(start))))
    }
    private var selectedFraction: CGFloat? {
        guard let selected, end > start else { return nil }
        return min(1, max(0, CGFloat(selected.timeIntervalSince(start) / end.timeIntervalSince(start))))
    }

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let y = proxy.size.height * 0.56
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.16)).frame(height: 2)
                Capsule().fill(tint.opacity(0.74)).frame(width: max(2, width * split), height: 2)
                Capsule()
                    .stroke(tint.opacity(0.38), style: StrokeStyle(lineWidth: 2, dash: [3, 4], dashPhase: 1))
                    .frame(width: max(0, width * (1 - split)), height: 2)
                    .offset(x: width * split)
                if let selectedFraction {
                    Circle().fill(.white).frame(width: 6, height: 6)
                        .shadow(color: .black.opacity(0.28), radius: 1)
                        .offset(x: max(0, min(width - 6, width * selectedFraction - 3)))
                }
            }
            .frame(height: proxy.size.height, alignment: .center)
            .offset(y: y - proxy.size.height / 2)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
