import SwiftUI
import MapKit

@main
struct RadarProofApp: App {
    var body: some Scene { WindowGroup { RadarProofView() } }
}

@MainActor
final class RadarProofModel: ObservableObject {
    @Published var frames: [RadarProofFrame] = []
    @Published var error: String?
    @Published var loading = false
    @Published var generation = 0

    func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            async let observed = fetch(kind: .observed)
            async let forecast = fetch(kind: .accumulation)
            frames = try await [observed, forecast]
            generation += 1
        } catch {
            // Existing frames retain their original valid and fetched times on refresh failure.
            self.error = error.localizedDescription
        }
    }

    private func fetch(kind: RadarProofFrame.Kind) async throws -> RadarProofFrame {
        let template = kind == .observed ? RadarProofFixtures.observed : RadarProofFixtures.forecast
        let endpoint = kind == .observed ? template.endpoint : "https://nowcoast.noaa.gov/geoserver/ndfd_precipitation/wms"
        let url = URL(string: endpoint + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities")!
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw RadarProofError.invalidResponse }
        let times = try RadarProofCapabilities.times(in: data, layer: template.layer)
        return try RadarProofTimes.select(times, kind: kind, now: Date())
    }
}

struct RadarProofView: View {
    @StateObject private var model = RadarProofModel()
    @State private var selection = 0.0
    @State private var recenter = 0
    @State private var tileStatus = "Weather tiles not loaded"
    private var frame: RadarProofFrame? {
        let index = min(Int(selection.rounded()), model.frames.count - 1)
        return model.frames.indices.contains(index) ? model.frames[index] : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Native radar proof").font(.headline)
                    Text("Raster substrate only · not the shipping map").font(.caption)
                }
                Spacer()
                Button { recenter += 1 } label: { Image(systemName: "scope").frame(width: 44, height: 44) }
                    .accessibilityLabel("Recenter test location")
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                    .accessibilityLabel("Refresh source times").disabled(model.loading)
            }.padding(.horizontal)
            RadarProofMap(frame: frame, generation: model.generation, recenter: recenter) { id, generation, message in
                guard id == frame?.id, generation == model.generation else { return }
                tileStatus = message
            }
            .overlay(alignment: .topLeading) {
                Text("Maryville, Illinois · public test location")
                    .font(.caption).padding(8).background(.regularMaterial, in: Capsule()).padding(8)
            }
            VStack(alignment: .leading, spacing: 8) {
                if let frame {
                    Text(frame.title).font(.headline)
                    Text("Valid \(frame.validTime.formatted(date: .abbreviated, time: .standard))").font(.subheadline).monospacedDigit()
                    if frame.kind == .observed {
                        Text("Observed \(max(0, Int(Date().timeIntervalSince(frame.validTime) / 60))) min ago").font(.caption)
                    } else {
                        Text("Accumulated rain, not instantaneous radar. The source transition is not storm motion.").font(.caption)
                    }
                    Slider(value: $selection, in: 0...1, step: 1)
                        .accessibilityLabel("Weather source frame")
                        .accessibilityValue(frame.title)
                    HStack {
                        Button("Observed") { selection = 0 }.frame(minHeight: 44)
                        Spacer()
                        Button("6h forecast") { selection = 1 }.frame(minHeight: 44)
                    }
                    Text("\(frame.attribution) · Frame clock: device local time").font(.caption2)
                    Text(tileStatus).font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text(model.loading ? "Loading actual source times…" : "No weather frame available").font(.headline)
                }
                if let error = model.error { Text(error).font(.caption).foregroundStyle(.red) }
            }.padding().background(.regularMaterial)
        }
        .task { await model.refresh() }
        .onChange(of: frame?.id) { _, _ in tileStatus = "Loading selected frame…" }
    }
}

private final class RadarProofTileOverlay: MKTileOverlay {
    let frame: RadarProofFrame
    let status: (String, String) -> Void
    private let session: URLSession
    private let progressLock = NSLock()
    private var received = 0
    private var failed = 0
    init(frame: RadarProofFrame, status: @escaping (String, String) -> Void) {
        self.frame = frame
        self.status = status
        let config = URLSessionConfiguration.ephemeral
        config.httpMaximumConnectionsPerHost = 6
        config.timeoutIntervalForRequest = 12
        self.session = URLSession(configuration: config)
        super.init(urlTemplate: nil)
        tileSize = CGSize(width: 256, height: 256)
        minimumZ = 0
        maximumZ = frame.maximumZoom
        canReplaceMapContent = false
    }
    deinit { session.invalidateAndCancel() }

    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, (any Error)?) -> Void) {
        do {
            let request = URLRequest(url: try frame.tileURL(x: path.x, y: path.y, z: path.z), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
            session.dataTask(with: request) { [weak self, frame, status] data, response, error in
                let outcome: (Data?, Error?)
                if let error { outcome = (nil, error) }
                else if (response as? HTTPURLResponse)?.statusCode != 200 { outcome = (nil, RadarProofError.invalidResponse) }
                else if let data, UIImage(data: data) != nil { outcome = (data, nil) }
                else { outcome = (nil, RadarProofError.nonImageTile) }
                result(outcome.0, outcome.1)
                guard let self else { return }
                self.progressLock.lock()
                if outcome.1 == nil { self.received += 1 } else { self.failed += 1 }
                let message = "Tiles received: \(self.received) · unavailable: \(self.failed)"
                self.progressLock.unlock()
                DispatchQueue.main.async {
                    status(frame.id, message)
                }
            }.resume()
        } catch { result(nil, error) }
    }
}

private struct RadarProofMap: UIViewRepresentable {
    let frame: RadarProofFrame?
    let generation: Int
    let recenter: Int
    let status: (String, Int, String) -> Void
    private static let center = CLLocationCoordinate2D(latitude: 38.7237, longitude: -89.9557)
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.isPitchEnabled = false
        map.showsUserLocation = false
        map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
        map.cameraZoomRange = MKMapView.CameraZoomRange(minCenterCoordinateDistance: 100_000, maxCenterCoordinateDistance: 8_000_000)
        center(map)
        let pin = MKPointAnnotation()
        pin.coordinate = Self.center
        pin.title = "Test location"
        map.addAnnotation(pin)
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        if context.coordinator.recenter != recenter {
            context.coordinator.recenter = recenter
            center(map)
        }
        guard context.coordinator.frameID != frame?.id || context.coordinator.generation != generation else { return }
        map.removeOverlays(map.overlays)
        context.coordinator.frameID = frame?.id
        context.coordinator.generation = generation
        if let frame {
            let selectedGeneration = generation
            map.addOverlay(RadarProofTileOverlay(frame: frame) { id, message in
                status(id, selectedGeneration, message)
            }, level: .aboveRoads)
        }
        // Intentionally no blend across sources: NDFD amount is not a radar motion frame.
    }
    private func center(_ map: MKMapView) {
        map.setRegion(MKCoordinateRegion(center: Self.center, latitudinalMeters: 850_000, longitudinalMeters: 850_000), animated: false)
    }
    final class Coordinator: NSObject, MKMapViewDelegate {
        var frameID: String?
        var generation = 0
        var recenter = 0
        func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
            guard let tiles = overlay as? MKTileOverlay else { return MKOverlayRenderer(overlay: overlay) }
            let renderer = MKTileOverlayRenderer(tileOverlay: tiles)
            renderer.alpha = 0.78
            return renderer
        }
    }
}
