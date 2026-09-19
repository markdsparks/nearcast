import SwiftUI

#if NEARCAST_RADAR_STANDALONE
@main
struct RadarFoundationApp: App {
    var body: some Scene { WindowGroup { RadarFoundationView() } }
}
#endif

struct RadarFoundationView: View {
    var onClose: (() -> Void)? = nil
    @StateObject private var model = RadarFoundationModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var recenter = 0
    @State private var showDetails = false
    private var fixture: SyntheticRadarFrame? { model.syntheticFrame }
    private var frame: RadarTimelineFrame? { model.selectedFrame }

    var body: some View {
        VStack(spacing: 0) {
            header
            RadarFoundationMap(frame: frame?.proofFrame, syntheticImage: fixture?.image,
                syntheticID: fixture?.id, recenter: recenter) { model.renderDiagnostic = $0 }
                .overlay(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(model.fixtureMode ? "SYNTHETIC · NOT WEATHER" : "NOAA SOURCE IMAGERY", systemImage: model.fixtureMode ? "testtube.2" : "dot.radiowaves.left.and.right")
                            .font(.caption.weight(.bold))
                        Text("Coordinate grid · no production basemap").font(.caption2)
                        if !model.fixtureMode {
                            Text("Blank areas may be missing tiles—not clear weather.").font(.caption2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }.padding(10).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14)).padding(12)
                        .allowsHitTesting(false)
                }
            timeline
        }
        .background(Color(uiColor: .systemBackground))
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showDetails) { details }
        .task { if !model.fixtureMode { await model.refresh() } }
        .onDisappear { model.pause() }
        .onReceive(Timer.publish(every: 15, on: .main, in: .common).autoconnect()) { now in
            if scenePhase == .active { model.timeline.advanceClock(to: now) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.pause() }
            else { model.timeline.advanceClock(to: Date()) }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text("Radar Lab").font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button { recenter += 1 } label: { Image(systemName: "scope").frame(width: 44, height: 44) }
                    .accessibilityLabel("Recenter on public test location")
                Button { showDetails = true } label: { Image(systemName: "info.circle").frame(width: 44, height: 44) }
                    .accessibilityLabel("Source, limits and diagnostics")
                if let onClose {
                    Button(action: onClose) { Image(systemName: "xmark").frame(width: 44, height: 44) }
                        .accessibilityLabel("Close Radar Lab")
                }
            }
            Text("Experimental · Maryville, Illinois · public test location")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }.padding(.horizontal, 16).padding(.vertical, 5)
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                sourceButton("Radar", source: .observed)
                sourceButton("6h rain total", source: .accumulation)
                Button("Fixtures") { model.chooseFixtures() }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(model.fixtureMode ? Color.orange : Color.secondary)
                    .frame(minHeight: 44)
                Spacer(minLength: 0)
                Button { Task { await model.refresh() } } label: {
                    Image(systemName: "arrow.clockwise").frame(width: 44, height: 44)
                }.disabled(model.timeline.isRefreshing).accessibilityLabel("Refresh advertised source times")
            }
            if model.fixtureMode { syntheticTimeline }
            else { liveTimeline }
        }
        .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 8)
        .background(.regularMaterial)
    }

    private func sourceButton(_ title: String, source: RadarTimelineSource) -> some View {
        Button(title) {
            model.chooseSource(source)
            if model.timeline.status(for: source).state == .notLoaded { Task { await model.refresh() } }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(!model.fixtureMode && model.source == source ? Color.cyan : Color.secondary)
        .frame(minHeight: 44)
        .accessibilityAddTraits(!model.fixtureMode && model.source == source ? .isSelected : [])
    }

    private var syntheticTimeline: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(fixture?.label ?? "Fixture unavailable").font(.title3.weight(.bold))
            if fixture != nil {
                Text("Swift-colored test texture · verified against JavaScript").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                ForEach(Array(model.fixtures.enumerated()), id: \.element.id) { index, value in
                    Button("\(index + 1)") { model.fixtureIndex = index }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(model.fixtureIndex == index ? Color.orange.opacity(0.2) : Color.clear, in: Capsule())
                        .accessibilityLabel(value.label)
                        .accessibilityAddTraits(model.fixtureIndex == index ? .isSelected : [])
                }
            }
            Text(model.fixtureError ?? "Test bounds and corner markers are diagnostic. This is not a live forecast.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var liveTimeline: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.source.title).font(.title3.weight(.bold))
                    if let frame {
                        Text(model.clock.shortLabel(for: frame.validTime)).font(.title2.weight(.semibold)).monospacedDigit()
                        Text(model.clock.detailLabel(for: frame.validTime)).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(model.timeline.isRefreshing ? "Loading source times…" : "No selected frame").font(.subheadline)
                    }
                }
                Spacer(minLength: 6)
                Button { model.togglePlayback() } label: {
                    Image(systemName: model.playing ? "pause.fill" : "play.fill")
                        .font(.title3).frame(width: 48, height: 48).background(.thinMaterial, in: Circle())
                }
                .disabled(frame == nil || model.frames.count < 2 || model.timeline.status(for: model.source).state != .ready)
                .accessibilityLabel(model.playing ? "Pause radar" : model.selectedIndex == model.frames.count - 1 ? "Play from first frame" : "Play available frames")
            }
            if model.frames.count > 1 {
                Slider(value: Binding(get: { Double(model.selectedIndex) }, set: { model.chooseFrame(at: Int($0.rounded())) }),
                    in: 0...Double(model.frames.count - 1), step: 1)
                    .tint(.cyan).frame(minHeight: 44)
                    .accessibilityLabel("Advertised source frame")
                    .accessibilityValue(frame.map { model.clock.accessibilityLabel(for: $0) } ?? "Selected frame unavailable")
                HStack {
                    Text(model.frames.first.map { model.clock.shortLabel(for: $0.validTime) } ?? "")
                    Spacer()
                    Text("\(model.frames.count) source frames")
                    Spacer()
                    Text(model.frames.last.map { model.clock.shortLabel(for: $0.validTime) } ?? "")
                }.font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
            if model.source == .accumulation {
                Text("Six-hour rain amounts—not a storm-motion forecast.").font(.caption.weight(.semibold)).foregroundStyle(.orange)
            } else if let age = frame?.observedAge(at: Date()) {
                Text("Observed \(max(0, Int(age / 60))) min ago").font(.caption).foregroundStyle(.secondary)
            }
            Text(model.playbackMessage ?? model.sourceMessage ?? "Tap info for source and coverage limits")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text(model.source.attribution).font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var details: some View {
        NavigationStack {
            List {
                Section("Scope") {
                    Text("Isolated native-renderer experiment. This does not replace Nearcast’s map or read family places, settings or plans.")
                    Text("The grid is a local alignment aid, not a geographic basemap. Production basemap credentials and rights are not activated here.")
                }
                Section("Source meaning") {
                    Text(RadarTimelineSource.observed.explanation)
                    Text(RadarTimelineSource.accumulation.explanation)
                    Text("Loading and missing imagery must not be read as clear weather. A renderer completion callback does not prove tile availability or forecast accuracy.")
                    Text("Playback stops at source gaps and never crosses between reflectivity and rainfall totals. A missing selection after refresh stays unavailable until you choose another frame.")
                }
                Section("Selected-place clock") {
                    Toggle("24-hour time", isOn: $model.uses24HourClock)
                    Text("America/Chicago · public Maryville test location. This does not modify Nearcast preferences.")
                }
                Section("Diagnostics") {
                    Text(model.renderDiagnostic).font(.caption.monospaced()).textSelection(.enabled)
                    Text("MapLibre 6.31.0 · exact binary checksum verified at build")
                    if let frame { Text("Provider TIME: \(frame.sourceTime)").font(.caption.monospaced()) }
                    Text("Renderer callback timings are not network-load or hardware-performance acceptance measurements.")
                }
                Section("Attribution") {
                    Link("NOAA / National Weather Service", destination: URL(string: "https://www.weather.gov/")!)
                    Link("MapLibre Native", destination: URL(string: "https://maplibre.org/")!)
                    Text("MapLibre BSD-2-Clause and third-party notices are bundled with this app.")
                    ForEach(["MapLibre-LICENSE", "MapLibre-iOS-NOTICES", "MapLibre-core-NOTICES"], id: \.self) { name in
                        if let url = Bundle.main.url(forResource: name, withExtension: "md"),
                           let text = try? String(contentsOf: url, encoding: .utf8) {
                            NavigationLink(name) { ScrollView { Text(text).font(.caption).padding().textSelection(.enabled) } }
                        }
                    }
                }
            }
            .navigationTitle("Radar foundation")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showDetails = false } } }
        }
    }
}
