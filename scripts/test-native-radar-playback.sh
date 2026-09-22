#!/bin/bash
set -euo pipefail

PLAYBACK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAYBACK_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-playback.XXXXXX")"
trap 'rm -rf "$PLAYBACK_TEMP"' EXIT

# Run the app's actual readiness, retry, selection and playback methods with
# deterministic frame I/O. No network, provider credentials or copied loop.
node --input-type=module - "$PLAYBACK_ROOT" "$PLAYBACK_TEMP" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root = process.argv[2], temp = process.argv[3];
const model = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeRadarModel.swift`, 'utf8');
function block(start, end) {
  const a = model.indexOf(start), b = model.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production section ${start}`);
  return model.slice(a, b);
}
let playback = block('    private func shouldReuseImageRequest(', '    func advanceClock()');
const selection = block('    func selectScrubberTime(', '    func setEnhancement(');
const loading = block('    private func loadSelectedImage(', '    private func acquireFrameWork(');
const publish = block('    private func recordPublish()', '    private var active');
const refresh = block('    func refresh(forceObserved:', '    func requestRefresh()');
const basemap = block('    private func loadBasemap()', '    var canUseAerial:');
const forecast = block('    private func publishForecast(_ cached:', '    private func publishForecast(_ rendered:');
const coverage = block('    private func refreshCoverageMessage()', '    private func loadObservedImage(');
assert(loading.includes('if shouldReuseImageRequest(requestID) { return }'), 'image loading uses the tested exact-publication dedupe helper');
assert(publish.includes('displayedImageRequestID = imageRequestID'), 'only real publication marks the exact request successful');
assert(!refresh.includes('pause()'), 'background metadata refresh must not stop preview-launched playback');
assert(refresh.includes('!loadingImage && !currentImageReadyForPlayback') && refresh.includes('loadSelectedImage()'), 'metadata completion retries a missing current frame');
assert(basemap.includes('selectBasemap(basemapStyle, pausePlayback: false)'), 'late initial basemap arrival preserves playback');
assert(forecast.includes('refreshCoverageMessage()') && coverage.includes('imageUnavailableAtPlace =')
  && coverage.includes('NativeRadarVisibleCoverage.fraction'), 'missing selected-place coverage is separate from a visible-area coverage notice');
assert(!playback.includes('guard self.imageMessage == nil'), 'informational coverage text is not a playback failure');
console.log('PASS playback wiring: exact published identity, refresh/basemap startup, truthful coverage handling');

// Optional mutation checks alter only this disposable in-memory harness, never
// app source. Each old bug must make the behavior suite fail.
const mutation = process.env.NEARCAST_RADAR_PLAYBACK_MUTATION ?? '';
assert(['', 'warning-gate', 'retained-image-dedupe'].includes(mutation), 'known playback test mutation');
if (mutation === 'warning-gate') {
  playback = playback.replaceAll('guard self.currentImageReadyForPlayback else', 'guard self.imageMessage == nil else');
} else if (mutation === 'retained-image-dedupe') {
  playback = playback.replace('imageRequestID == requestID && (loadingImage || (image != nil && displayedImageRequestID == requestID))',
    'imageRequestID == requestID && (image != nil || loadingImage)');
}
if (mutation) console.log(`TEST MUTATION (temporary harness only): ${mutation}`);

const program = `
import Foundation

enum NativeRadarProduct { case radar, forecast, rainAmount }
enum NativeRadarBasemap { case streets, satellite }

@MainActor final class PlaybackHarness {
    struct FrameBehavior {
        var delay = 0
        var fails = false
        var warning: String?
        var availableAtPlace = true
    }
    var active = true, playing = false, refreshing = false, loadingImage = false
    var usesGlobalRadar = false, numericRadarEnabled = true
    var basemapStyle = NativeRadarBasemap.streets
    var product = NativeRadarProduct.radar
    var image: Int? = 1
    var imageMessage: String?, playbackMessage: String?
    var imageRequestID: String?, displayedImageRequestID: String?
    var imageUnavailableAtPlace = false
    var selectedInstant: Date?, displayedInstant: Date?
    var displayedProduct: NativeRadarProduct?
    let evaluationTime: Date
    let scrubberDates: [Date]
    var playbackTask: Task<Void, Never>?
    var fixtureTask: Task<Void, Never>?
    var fixtureGeneration = 0
    var viewportRevision = 0
    var waitingForMetadata = false
    var behaviors: [Date: [FrameBehavior]] = [:]
    var requests: [Date: Int] = [:]
    var publications: [Date] = []
    var usesNumericRadar: Bool { product == .radar && numericRadarEnabled }
    var selectedIndex: Int { selectedInstant.flatMap { scrubberDates.firstIndex(of: $0) } ?? -1 }
    var selectedDate: Date? { selectedIndex >= 0 ? selectedInstant : nil }

    init() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        evaluationTime = now
        scrubberDates = [now.addingTimeInterval(-120), now.addingTimeInterval(300), now.addingTimeInterval(1200)]
        selectedInstant = scrubberDates[0]
        displayedInstant = scrubberDates[0]; displayedProduct = .radar
        imageRequestID = requestKey(scrubberDates[0]); displayedImageRequestID = imageRequestID
    }

${selection}
${playback}

    // Only the frame transport is a fixture. Selection, deduplication,
    // readiness, retry and loop decisions above come verbatim from the app.
    func loadSelectedImage(debounce: Bool = false) {
        guard let date = selectedInstant else { return }
        let key = requestKey(date)
        if shouldReuseImageRequest(key) { return }
        imageRequestID = key
        fixtureGeneration += 1
        let generation = fixtureGeneration, selectedProduct = product
        fixtureTask?.cancel()
        imageMessage = nil; imageUnavailableAtPlace = false
        if waitingForMetadata {
            loadingImage = false; imageMessage = "Loading model guidance…"
            return
        }
        requests[date, default: 0] += 1
        let options = behaviors[date] ?? [.init()]
        let behavior = options[min(requests[date, default: 1] - 1, options.count - 1)]
        loadingImage = true
        fixtureTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(behavior.delay)) } catch { return }
            guard let self, self.active, !Task.isCancelled, self.fixtureGeneration == generation else { return }
            self.loadingImage = false
            if behavior.fails {
                self.imageMessage = "This forecast frame could not load. Showing the last available image; try another time or refresh."
                return
            }
            self.image = 2
            self.displayedInstant = date; self.displayedProduct = selectedProduct
            self.displayedImageRequestID = key
            self.imageUnavailableAtPlace = !behavior.availableAtPlace
            self.imageMessage = behavior.warning
            self.publications.append(date)
        }
    }
    func warmNearbyFrames() {}
    func requestKey(_ date: Date) -> String { "frame:\\(date.timeIntervalSince1970)|area:\\(viewportRevision)" }
    var ready: Bool { currentImageReadyForPlayback }
    func reusable(_ key: String) -> Bool { shouldReuseImageRequest(key) }
    func finishMetadata() {
        waitingForMetadata = false; refreshing = false
        if !loadingImage && !currentImageReadyForPlayback { loadSelectedImage() }
    }
    func stop() { active = false; pause(); fixtureTask?.cancel() }
}

@main enum PlaybackTests {
    @MainActor static func verify(_ condition: Bool, _ message: String = "playback assertion failed") {
        guard condition else {
            FileHandle.standardError.write(Data(("FAIL: \\(message)\\n").utf8))
            exit(1)
        }
    }
    @MainActor static func wait(_ message: String, timeout: Double = 8,
                               until condition: () -> Bool) async throws {
        let end = ContinuousClock.now.advanced(by: .milliseconds(Int(timeout * 1000)))
        while !condition() {
            guard ContinuousClock.now < end else { fatalError("Timed out: \\(message)") }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    @MainActor static func main() async throws {
        let loop = PlaybackHarness()
        let first = loop.scrubberDates[0], forecast = loop.scrubberDates[1], last = loop.scrubberDates[2]
        loop.behaviors[forecast] = [.init(delay: 650, warning: "Some of this view is outside forecast coverage. Blank areas are unavailable.")]
        loop.behaviors[last] = [.init(warning: "Some of this view is outside forecast coverage. Blank areas are unavailable.")]
        loop.togglePlayback()
        try await wait("first forecast requested") { loop.requests[forecast] == 1 }
        precondition(loop.product == .forecast && loop.loadingImage && loop.displayedInstant == first)
        try await Task.sleep(for: .milliseconds(150))
        precondition(loop.playing && loop.selectedInstant == forecast && loop.displayedInstant == first,
                     "a delayed forecast holds the previous displayed frame instead of advancing its time")
        try await wait("partial-coverage forecast published") { loop.displayedInstant == forecast }
        try await Task.sleep(for: .milliseconds(80))
        precondition(loop.imageMessage != nil && loop.ready && loop.playing,
                     "a peripheral coverage warning is a usable frame, not a playback error")
        try await wait("two complete radar→forecast→radar loops") { loop.publications.filter { $0 == first }.count >= 2 }
        precondition(loop.playing && loop.publications.filter { $0 == last }.count >= 2)
        loop.stop()
        print("PASS actual playback: slow first forecast waits; partial coverage continues; two complete loops")

        let retry = PlaybackHarness()
        retry.behaviors[forecast] = [.init(delay: 20, fails: true), .init(delay: 20)]
        retry.togglePlayback()
        try await wait("failed forecast pauses") { retry.requests[forecast] == 1 && !retry.playing }
        precondition(retry.displayedInstant == first && retry.selectedInstant == forecast && retry.image != nil)
        precondition(!retry.ready && !retry.reusable(retry.requestKey(forecast)),
                     "retaining the old preview/radar image cannot mark a failed forecast request successful")
        retry.togglePlayback()
        try await wait("Play really retries the same failed frame") { retry.requests[forecast] == 2 && retry.displayedInstant == forecast }
        precondition(retry.playing && retry.ready)
        try await wait("recovered playback advances") { retry.displayedInstant == last }
        retry.stop()
        print("PASS actual playback: failure pauses honestly; Play reacquires the failed frame and resumes")

        let sameTimeRetry = PlaybackHarness()
        sameTimeRetry.behaviors[forecast] = [.init(fails: true), .init()]
        sameTimeRetry.selectScrubberTime(forecast)
        try await wait("same-time scrub failure") { !sameTimeRetry.loadingImage }
        precondition(!sameTimeRetry.ready)
        sameTimeRetry.selectScrubberTime(forecast)
        try await wait("scrubbing the failed time retries") { sameTimeRetry.requests[forecast] == 2 && sameTimeRetry.ready }
        sameTimeRetry.stop()
        print("PASS actual selection: selecting the same failed time retries instead of remaining poisoned")

        let metadata = PlaybackHarness()
        metadata.refreshing = true; metadata.waitingForMetadata = true
        metadata.selectScrubberTime(forecast)
        metadata.togglePlayback()
        try await Task.sleep(for: .milliseconds(200))
        precondition(metadata.playing && metadata.displayedInstant == first && !metadata.ready,
                     "startup metadata loading must not be mistaken for a permanent failure")
        metadata.finishMetadata()
        try await wait("metadata completion resumes first forecast") { metadata.displayedInstant == forecast }
        precondition(metadata.playing)
        metadata.stop()
        print("PASS actual playback: preview startup waits for metadata without stopping or inventing readiness")

        let rapid = PlaybackHarness()
        rapid.togglePlayback()
        try await Task.sleep(for: .milliseconds(200))
        rapid.pause(); rapid.togglePlayback()
        try await Task.sleep(for: .milliseconds(250))
        precondition(rapid.selectedInstant == first && rapid.requests[forecast] == nil,
                     "the canceled old loop must not advance the new loop at its old deadline")
        try await wait("new playback advances once") { rapid.displayedInstant == forecast }
        precondition(rapid.requests[forecast] == 1)
        rapid.pause()
        let held = rapid.selectedInstant
        try await Task.sleep(for: .milliseconds(500))
        precondition(rapid.selectedInstant == held && !rapid.playing)
        rapid.stop()
        print("PASS actual playback: rapid pause/play leaves exactly one live loop; pause holds the selected frame")

        let seeded = PlaybackHarness()
        seeded.imageRequestID = nil; seeded.displayedImageRequestID = nil
        seeded.behaviors[first] = [.init(delay: 100)]
        precondition(!seeded.ready, "a landscape preview seed is not already the requested portrait coverage")
        seeded.togglePlayback()
        precondition(seeded.loadingImage && seeded.requests[first] == 1)
        try await wait("seeded preview exact coverage finishes") { seeded.ready }
        let key = seeded.requestKey(first)
        precondition(seeded.reusable(key))
        seeded.viewportRevision += 1
        precondition(!seeded.reusable(seeded.requestKey(first)), "published old-area identity cannot satisfy new coverage")
        seeded.stop()
        print("PASS actual readiness/dedupe: preview seeds and retained old-area images require exact new publication")

        let missing = PlaybackHarness()
        missing.behaviors[forecast] = [.init(warning: "Forecast coverage is missing at this place.", availableAtPlace: false)]
        missing.togglePlayback()
        try await wait("missing selected-place coverage pauses") { missing.displayedInstant == forecast && !missing.playing }
        precondition(!missing.ready)
        missing.stop()
        let global = PlaybackHarness(); global.usesGlobalRadar = true; global.togglePlayback()
        precondition(!global.playing)
        let satellite = PlaybackHarness(); satellite.basemapStyle = .satellite; satellite.togglePlayback()
        precondition(!satellite.playing)
        let wms = PlaybackHarness(); wms.numericRadarEnabled = false; wms.image = nil
        wms.imageRequestID = nil; wms.displayedImageRequestID = nil
        precondition(wms.ready, "WMS tile products do not require a numeric image publication")
        wms.togglePlayback(); precondition(wms.playing); wms.stop()
        let totals = PlaybackHarness(); totals.product = .rainAmount; totals.image = nil
        totals.imageRequestID = nil; totals.displayedImageRequestID = nil
        precondition(totals.ready, "rain-total tiles do not require a numeric image publication")
        totals.togglePlayback(); precondition(totals.playing); totals.stop()
        print("PASS actual safety guards: genuinely missing local data pauses; global and satellite playback remain disabled")
        print("PASS actual tile readiness: WMS radar and rain totals retain their nonnumeric playback path")
    }
}
`;
const binary = `${temp}/radar-playback-test`;
const foundation = `${root}/native/experiments/NativeRadarFoundation`;
// Explicit diagnostics survive optimized Swift builds and avoid crash reports
// when intentionally running one of the old-behavior mutation checks.
const diagnosticProgram = program.replaceAll('precondition(', 'verify(');
const sources = fs.readFileSync(`${foundation}/RadarNumericContract.swift`, 'utf8') + '\n'
  + fs.readFileSync(`${foundation}/NativeRadarPresentationContract.swift`, 'utf8') + '\n' + diagnosticProgram;
const compilation = spawnSync('xcrun', ['swiftc', '-O', '-parse-as-library', '-swift-version', '6',
  '-module-cache-path', `${temp}/modules`, '-', '-o', binary], {input: sources, encoding:'utf8'});
process.stdout.write(compilation.stdout ?? ''); process.stderr.write(compilation.stderr ?? '');
assert.equal(compilation.status, 0, 'production playback test compilation');
const run = spawnSync(binary, [], {encoding:'utf8', timeout:30000});
process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
assert.equal(run.status, 0, 'production playback behavior');
NODE
