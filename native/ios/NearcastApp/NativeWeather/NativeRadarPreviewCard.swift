import SwiftUI

/// A still, observed-radar window into the full map. The preview owns no
/// timeline or playback engine; its loader shares the map's frame repository.
struct NativeRadarPreviewCard: View {
    let place: NativePreviewPlace
    let now: Date
    let viewportHeight: CGFloat
    let isActive: Bool
    let onOpen: (NativeRadarOpeningContext?) -> Void

    @StateObject private var model = NativeRadarPreviewModel()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var mapFrame = CGRect.null
    @State private var isVisible = false
    @State private var snapshotWidth: Double = 0
    @State private var tapRevision = 0

    private var isDark: Bool { colorScheme == .dark }
    private var accent: Color {
        isDark ? Color(red: 0.60, green: 0.79, blue: 1) : Color(red: 0.15, green: 0.36, blue: 0.59)
    }
    private var shouldLoad: Bool { isActive && scenePhase == .active && isVisible }
    private var snapshotSize: CGSize {
        CGSize(width: snapshotWidth, height: 200)
    }
    private var requestIdentity: String {
        "\(place.coordinateIdentity)|\(Int(snapshotSize.width))|\(shouldLoad)"
    }
    private var age: String? {
        guard let date = model.freshnessDate else { return nil }
        let elapsed = now.timeIntervalSince(date)
        guard elapsed.isFinite, elapsed >= 0 else { return nil }
        let minutes = Int(elapsed / 60)
        return minutes < 1 ? "just now" : "\(minutes) min ago"
    }
    private var sourceLabel: String { model.status }
    private var freshnessNoticeLabel: String {
        if model.state == .unavailable { return model.status.isEmpty ? "Radar unavailable" : model.status }
        if let date = model.freshnessDate {
            let freshness = NativeRadarFreshnessPolicy.assess(latest: date, at: now)
            if freshness.sourceStatus == .unavailable { return "Radar out of date" }
            if freshness.sourceStatus == .delayed { return "Delayed radar" }
        }
        return model.status
    }
    private var needsFreshnessNotice: Bool {
        model.isStale || model.freshnessDate.map {
            NativeRadarFreshnessPolicy.assess(latest: $0, at: now).sourceStatus != .current
        } == true
    }
    private var compactStatus: String {
        let status = needsFreshnessNotice || model.state == .unavailable
            ? freshnessNoticeLabel : sourceLabel.replacingOccurrences(of: "Observed radar", with: "Radar")
        // Partial coverage remains explicit even when a freshness warning wins.
        let coverage = sourceLabel.contains("partial coverage") && !status.contains("partial coverage")
            ? " · partial coverage" : ""
        return [status + coverage, age].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Button {
                tapRevision += 1
                onOpen(model.openingContext)
            } label: {
                mapContent
                    .frame(height: 200)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .overlay(alignment: .topLeading) {
                        if model.image != nil {
                            Text(compactStatus)
                                .font(.caption.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .shadow(color: .black.opacity(0.7), radius: 2, y: 1)
                                .padding(12)
                                .allowsHitTesting(false)
                        }
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(NativeRadarPreviewButtonStyle(accent: accent, reduceMotion: reduceMotion,
                increasedContrast: contrast == .increased))
            .sensoryFeedback(.selection, trigger: tapRevision)
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Radar near \(place.name). \(compactStatus).")
            .accessibilityHint("Opens the full weather map in this area.")
            .accessibilityIdentifier("nearcast.native.radar-preview.open")

            // Required credits sit on the map itself. They remain separate
            // controls, never links nested inside the full-map Button.
            if !model.attributions.isEmpty {
                NativeRadarPreviewCreditLayout {
                    ForEach(Array(model.attributions.enumerated()), id: \.offset) { _, credit in
                        creditLink(credit)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 5)
                .padding(.top, 18)
                .background(alignment: .bottom) {
                    LinearGradient(colors: [.clear, .black.opacity(0.72)],
                        startPoint: .top, endPoint: .bottom)
                        .allowsHitTesting(false)
                }
                .accessibilityIdentifier("nearcast.native.radar-preview.credits")
            }
        }
        .frame(height: 200)
        .frame(maxWidth: .infinity)
        // Measure the stable card, not the image/placeholder inside the
        // animated ButtonStyle. Pressing cannot resize the network request.
        .onGeometryChange(for: CGRect.self) { geometry in
            geometry.frame(in: .named("native-weather-scroll")).integral
        } action: { frame in
            mapFrame = frame
            snapshotWidth = NativeRadarPreviewPolicy.stableWidth(current: snapshotWidth, measured: frame.width)
            updateVisibility()
        }
        .onChange(of: viewportHeight) { _, _ in updateVisibility() }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.primary.opacity(contrast == .increased ? 0.35 : 0.10), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .task(id: requestIdentity) {
            guard !Task.isCancelled else { return }
            guard shouldLoad else { model.cancel(); return }
            do {
                // Scroll gestures own the screen. A settled, genuinely visible
                // card may refresh; appearing in a VStack alone is not enough.
                try await Task.sleep(for: .milliseconds(300))
                while !Task.isCancelled {
                    await model.load(place: place, size: snapshotSize)
                    try Task.checkCancellation()
                    try await Task.sleep(for: .seconds(4 * 60))
                }
            } catch { /* Cancellation is ordinary viewport/lifecycle behavior. */ }
        }
        .onChange(of: shouldLoad) { _, eligible in
            if !eligible { model.cancel() }
        }
        .onDisappear { model.cancel() }
    }

    private func updateVisibility() {
        isVisible = NativeRadarPreviewVisibility.isVisible(frame: mapFrame, viewportHeight: viewportHeight,
            wasVisible: isVisible)
    }

    @ViewBuilder private var mapContent: some View {
        if let image = model.image {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .overlay(alignment: .top) {
                    LinearGradient(colors: [.black.opacity(0.46), .clear],
                        startPoint: .top, endPoint: .bottom)
                        .frame(height: 60)
                        .allowsHitTesting(false)
                }
                .accessibilityHidden(true)
        } else {
            ZStack {
                LinearGradient(colors: isDark
                    ? [Color(red: 0.10, green: 0.18, blue: 0.23), Color(red: 0.08, green: 0.13, blue: 0.18)]
                    : [Color(red: 0.87, green: 0.92, blue: 0.93), Color(red: 0.80, green: 0.87, blue: 0.90)],
                    startPoint: .topLeading, endPoint: .bottomTrailing)
                VStack(spacing: 10) {
                    if model.state == .loading {
                        ProgressView().tint(accent)
                        Text("Loading radar…").font(.subheadline)
                    } else {
                        Image(systemName: model.state == .unavailable ? "wifi.exclamationmark" : "map")
                            .font(.system(size: 27, weight: .light))
                            .foregroundStyle(accent)
                        Text(model.state == .unavailable ? "Radar unavailable" : "See weather around this place")
                            .font(.subheadline.weight(.medium))
                    }
                }
                .multilineTextAlignment(.center)
                .padding(20)
            }
        }
    }

    private func creditLink(_ credit: NativeRadarPreviewModel.Attribution) -> some View {
        Link(credit.title, destination: credit.url)
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.94))
            .shadow(color: .black.opacity(0.7), radius: 1, y: 1)
            .padding(.vertical, 3)
            .accessibilityLabel("Map attribution: \(credit.title)")
    }
}

/// Geometry-only so visibility behavior can be exercised without a map SDK.
enum NativeRadarPreviewVisibility {
    static func isVisible(frame: CGRect, viewportHeight: CGFloat, wasVisible: Bool = false) -> Bool {
        guard !frame.isNull, !frame.isInfinite, viewportHeight.isFinite, viewportHeight > 0,
              frame.origin.x.isFinite, frame.origin.y.isFinite,
              frame.width.isFinite, frame.height.isFinite, frame.width > 0, frame.height > 0 else { return false }
        let overlap = max(0, min(frame.maxY, viewportHeight) - max(frame.minY, 0))
        // Enter only with a useful amount visible; a small scroll/layout wobble
        // near that threshold must not repeatedly cancel a slower raster load.
        let threshold = wasVisible ? min(20, frame.height * 0.10) : min(60, frame.height * 0.25)
        return overlap >= threshold
    }
}

private struct NativeRadarPreviewButtonStyle: ButtonStyle {
    let accent: Color
    let reduceMotion: Bool
    let increasedContrast: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                accent.opacity(configuration.isPressed ? (increasedContrast ? 0.25 : 0.13) : 0)
                    .allowsHitTesting(false)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(configuration.isPressed ? accent.opacity(0.8) : .clear, lineWidth: 2)
                    .allowsHitTesting(false)
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Attribution wraps as a small text overlay, instead of growing a separate
/// footer or shrinking provider names to unreadable sizes on a narrow phone.
private struct NativeRadarPreviewCreditLayout: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(width: proposal.width, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = arrangement(width: bounds.width, subviews: subviews)
        for (index, frame) in layout.frames.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrangement(width: CGFloat?, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let limit = max(1, width ?? 600)
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: limit, height: nil))
            if x > 0, x + size.width > limit {
                x = 0; y += rowHeight; rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + 8
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: limit, height: y + rowHeight), frames)
    }
}
