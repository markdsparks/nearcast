import Foundation
import UIKit

/// No family store, WebView, provider key or notification side effect is reachable
/// from this laboratory. Its only location is a public city coordinate.
@MainActor
final class RadarFoundationModel: ObservableObject {
    @Published var timeline = RadarTimelineState(now: Date())
    @Published var source: RadarTimelineSource = .observed
    @Published var fixtureMode = UserDefaults.standard.bool(forKey: "radar-fixtures")
    @Published var fixtureIndex = 0
    @Published var uses24HourClock = true
    @Published var playing = false
    @Published var playbackMessage: String?
    @Published var renderDiagnostic = "Waiting for renderer"
    @Published var fixtureError: String?
    @Published private(set) var fixtures: [SyntheticRadarFrame] = []
    private var playback: Task<Void, Never>?
    private var pendingSourceChoice: RadarTimelineSource?
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 22
        configuration.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: configuration)
        do { fixtures = try SyntheticRadarFrame.load() }
        catch { fixtureError = "Synthetic comparison could not be verified. No test texture is displayed." }
    }

    var clock: RadarTimelineClock {
        RadarTimelineClock(timeZoneIdentifier: "America/Chicago", uses24HourClock: uses24HourClock)!
    }
    var frames: [RadarTimelineFrame] { timeline.frames(for: source) }
    var selectedFrame: RadarTimelineFrame? {
        guard !fixtureMode, timeline.selectedFrame?.source == source else { return nil }
        return timeline.selectedFrame
    }
    var syntheticFrame: SyntheticRadarFrame? {
        guard fixtureMode, fixtures.indices.contains(fixtureIndex) else { return nil }
        return fixtures[fixtureIndex]
    }
    var selectedIndex: Int { frames.firstIndex(where: { $0.id == timeline.selectedID }) ?? 0 }
    var sourceMessage: String? {
        if timeline.status(for: source).state == .refreshFailed {
            return "Refresh failed. Retained source times have not been made newer."
        }
        if timeline.status(for: source).state == .unavailable { return "No usable advertised frames for this source." }
        if case let .unavailable(_, reason) = timeline.selection { return reason.explanation }
        return nil
    }

    func refresh() async {
        guard !timeline.isRefreshing else { return }
        pause()
        let token = timeline.beginRefresh(at: Date())
        async let observed = fetch(.observed)
        async let accumulation = fetch(.accumulation)
        let results = await [RadarTimelineSource.observed: observed, .accumulation: accumulation]
        guard !Task.isCancelled else {
            timeline.applyRefresh([.observed: .failure, .accumulation: .failure], token: token, at: Date())
            return
        }
        timeline.applyRefresh(results, token: token, at: Date())
        if let requested = pendingSourceChoice {
            source = requested
            let selected = requested == .observed ? timeline.selectLatestObserved() : timeline.selectFirstForecast()
            if selected { pendingSourceChoice = nil }
        } else if let selected = timeline.selectedFrame { source = selected.source }
    }

    private func fetch(_ source: RadarTimelineSource) async -> RadarTimelineLoadResult {
        let endpoint = source == .observed
            ? "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows"
            : "https://nowcoast.noaa.gov/geoserver/ndfd_precipitation/wms"
        let layer = source == .observed ? "conus_bref_qcd" : "conus_6hr_precipitation_amount"
        guard let url = URL(string: endpoint + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities") else { return .failure }
        do {
            let (data, response) = try await session.data(for: URLRequest(url: url,
                cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 18))
            guard !Task.isCancelled, (response as? HTTPURLResponse)?.statusCode == 200,
                  data.count <= 3 * 1024 * 1024 else { return .failure }
            let times = try RadarProofCapabilities.times(in: data, layer: layer)
            guard times.count <= 4096 else { return .failure }
            return .success(times: times, fetchedAt: Date())
        } catch { return .failure }
    }

    func chooseSource(_ value: RadarTimelineSource) {
        pause()
        fixtureMode = false
        source = value
        timeline.advanceClock(to: Date())
        let selected = value == .observed ? timeline.selectLatestObserved() : timeline.selectFirstForecast()
        pendingSourceChoice = selected ? nil : value
    }

    func chooseFrame(at index: Int) {
        pause()
        guard frames.indices.contains(index) else { return }
        timeline.select(id: frames[index].id)
    }

    func chooseFixtures() {
        pause()
        fixtureMode = true
    }

    func pause() {
        playback?.cancel()
        playback = nil
        playing = false
        playbackMessage = nil
    }

    func togglePlayback() {
        if playing { pause(); return }
        guard !fixtureMode, !timeline.isRefreshing, frames.count > 1,
              timeline.status(for: source).state == .ready else { return }
        // The button explicitly says "Play from first frame" at the last stop.
        if selectedIndex == frames.count - 1, let first = frames.first { timeline.select(id: first.id) }
        playing = true
        playbackMessage = nil
        playback = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(1100)) } catch { return }
                guard let self, !Task.isCancelled else { return }
                self.timeline.advanceClock(to: Date())
                switch self.timeline.stepPlayback() {
                case .advanced: break
                case let .stopped(reason):
                    self.playing = false
                    switch reason {
                    case .gap: self.playbackMessage = "Paused at a gap in source times. Choose a later frame to continue."
                    case .endOfSource: self.playbackMessage = "End of available frames."
                    case .refreshFailed: self.playbackMessage = "Refresh the source before playing again."
                    case .unavailableSelection: self.playbackMessage = "Select an available frame."
                    }
                    return
                }
            }
        }
    }
}

struct SyntheticRadarFrame: Identifiable {
    let id: String
    let label: String
    let validTime: String
    let image: UIImage

    private struct Document: Decodable {
        let preview: Preview
        struct Preview: Decodable { let width: Int; let height: Int; let frames: [Frame] }
        struct Frame: Decodable {
            let id: String; let label: String; let validTime: String
            let bytesBase64: String; let rgbaBase64: String
        }
    }
    enum Invalid: Error { case fixture }
    static func load() throws -> [Self] {
        guard let url = Bundle.main.url(forResource: "numeric-contract", withExtension: "json") else { throw Invalid.fixture }
        let data = try Data(contentsOf: url)
        guard data.count <= 2 * 1024 * 1024 else { throw Invalid.fixture }
        let preview = try JSONDecoder().decode(Document.self, from: data).preview
        let encoding = try RadarNumericContract.Encoding()
        return try preview.frames.map { frame in
            guard let bytes = Data(base64Encoded: frame.bytesBase64),
                  let expected = Data(base64Encoded: frame.rgbaBase64) else { throw Invalid.fixture }
            let texture = try RadarNumericContract.Texture(width: preview.width, height: preview.height, bytes: Array(bytes))
            let actual = Data(try RadarNumericContract.resolvedRGBA(texture, encoding: encoding))
            // The displayed image comes from Swift, and must match the checked-in
            // JavaScript fixture byte for byte before it reaches MapLibre.
            guard actual == expected, let provider = CGDataProvider(data: actual as CFData),
                  let image = CGImage(width: preview.width, height: preview.height, bitsPerComponent: 8,
                    bitsPerPixel: 32, bytesPerRow: preview.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider,
                    decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { throw Invalid.fixture }
            return Self(id: frame.id, label: frame.label, validTime: frame.validTime, image: UIImage(cgImage: image))
        }
    }
}
