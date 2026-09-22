#!/bin/bash
set -euo pipefail

PREVIEW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-preview-lifecycle.XXXXXX")"
trap 'rm -rf "$PREVIEW_TEMP"' EXIT

# Compile the app's actual lifecycle and cache with deterministic frame I/O.
# UIKit, publication wrappers and provider value types alone are stand-ins.
node --input-type=module - "$PREVIEW_ROOT" "$PREVIEW_TEMP" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root = process.argv[2], temp = process.argv[3];
const source = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeRadarPreviewModel.swift`, 'utf8');
function block(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production section ${start}`);
  return source.slice(a, b);
}
const policy = source.slice(0, source.indexOf('#if canImport(UIKit)'));
let model = block('@MainActor\nfinal class NativeRadarPreviewModel', '    private func acquire(');
const weather = model.indexOf('    private struct Weather {');
const store = model.indexOf('    @MainActor private final class Store {', weather);
assert(weather > 0 && store > weather, 'known value-only weather dependency');
model = model.slice(0, weather) + model.slice(store);
model = model.replace('    private let observed = NativeRadarObservedRepository.shared\n', '')
  .replace('    private let global = NativeGlobalRadarClient()\n', '');
const mutation = process.env.NEARCAST_PREVIEW_LIFECYCLE_MUTATION ?? '';
assert(['', 'restart-same-request'].includes(mutation), 'known temporary lifecycle mutation');
if (mutation === 'restart-same-request') {
  model = model.replace('if sameRequest, let worker {', 'if false, let worker {');
  console.log('TEST MUTATION (temporary harness only): restart same request');
}
const publication = block('    private func publish(', '    private static func styleIdentity(');
const handoff = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeRadarOpeningContext.swift`, 'utf8');
const freshness = fs.readFileSync(`${root}/native/experiments/NativeRadarFoundation/NativeRadarFreshnessPolicy.swift`, 'utf8');

const program = String.raw`
import Foundation
protocol ObservableObject {}
@propertyWrapper struct Published<Value> {
    var wrappedValue: Value
    init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
}
struct UIImage: Equatable { let fixtureID: Int }
enum UIApplication { static let didReceiveMemoryWarningNotification = Notification.Name("fixtureMemoryPressure") }
struct NativePreviewPlace {
    let latitude: Double, longitude: Double
    var coordinateIdentity: String { "\(latitude),\(longitude)" }
    var isValid: Bool { latitude.isFinite && longitude.isFinite && (-85...85).contains(latitude) && (-180...180).contains(longitude) }
}
struct NativeRadarImage { let west: Double, south: Double, east: Double, north: Double }
struct NativeRadarViewport {
    let west: Double, south: Double, east: Double, north: Double
    var isUsable: Bool { [west, south, east, north].allSatisfy(\.isFinite) && west < east && south < north }
}
enum MRMSContract { struct AdvertisedFrame { let validTimeMilliseconds: Int64 } }
struct NativeGlobalRadarFrame { let validTime: Date }
struct NativeGlobalRadarSnapshot { let frames: [NativeGlobalRadarFrame] }

MODEL_SOURCE
PUBLICATION_SOURCE
    private enum Failure: Error { case unavailable }
    private struct PendingFixture {
        let place: NativePreviewPlace
        let camera: NativeRadarPreviewPolicy.Camera
        let continuation: CheckedContinuation<Output, Error>
    }
    private var pendingFixtures: [Int: PendingFixture] = [:]
    private(set) var fixtureRequests = 0
    private(set) var canceledFixtureCompletions = 0

    // Transport/rendering is the sole injected implementation. It deliberately
    // permits late completion after cancellation to exercise publication guards.
    private func acquire(place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera) async throws -> Output {
        fixtureRequests += 1
        let id = fixtureRequests
        let output: Output = try await withCheckedThrowingContinuation { continuation in
            pendingFixtures[id] = PendingFixture(place: place, camera: camera, continuation: continuation)
        }
        if Task.isCancelled { canceledFixtureCompletions += 1 }
        else {
            Self.store.cache.insert(output, for: .init(place: place.coordinateIdentity, camera: camera,
                source: "fixture-\(id)", style: "offline-style"), cost: 1024,
                sourceTime: output.context.frameTime, maximumSourceAge: output.maximumAge, now: Date())
        }
        return output
    }
    func finishFixture(_ id: Int, age: TimeInterval = 60, failure: Bool = false) {
        guard let pending = pendingFixtures.removeValue(forKey: id) else { fatalError("No pending fixture \(id)") }
        if failure { pending.continuation.resume(throwing: Failure.unavailable); return }
        let context = fixtureContext(place: pending.place, camera: pending.camera, age: age)
        pending.continuation.resume(returning: .init(image: UIImage(fixtureID: id), context: context,
            credits: [], maximumAge: 30 * 60, partialCoverage: false))
    }
    private func fixtureContext(place: NativePreviewPlace, camera: NativeRadarPreviewPolicy.Camera,
                                age: TimeInterval) -> NativeRadarOpeningContext {
        let time = Date().addingTimeInterval(-age)
        return .init(placeIdentity: place.coordinateIdentity, latitude: place.latitude, longitude: place.longitude,
            zoom: camera.zoom, frameTime: time, image: nil, observedFrames: [],
            globalSnapshot: .init(frames: [.init(validTime: time)]))
    }
    func expireDisplayedFixture() {
        guard let place, let camera else { fatalError("A ready fixture is required") }
        context = fixtureContext(place: place, camera: camera, age: 40 * 60)
        freshnessDate = context?.frameTime
        Self.store.cache.removeAll()
    }
    func expireFixtureRetry() { retryAfter = Date().addingTimeInterval(-1) }
    func expireFixtureDeadline() { timedOut = generation.value; worker?.cancel() }
    static func resetFixtureCache() { store.cache.removeAll() }
}

@main enum PreviewLifecycleTests {
    @MainActor static func verify(_ condition: Bool, _ message: String) {
        guard condition else {
            FileHandle.standardError.write(Data(("FAIL: " + message + "\n").utf8)); exit(1)
        }
    }
    @MainActor static func wait(_ message: String, until condition: () -> Bool) async throws {
        let end = ContinuousClock.now.advanced(by: .seconds(3))
        while !condition() {
            guard ContinuousClock.now < end else { fatalError("Timed out: \(message)") }
            try await Task.sleep(for: .milliseconds(2))
        }
    }
    @MainActor static func settle() async throws { try await Task.sleep(for: .milliseconds(20)) }
    @MainActor static func main() async throws {
        let bengaluru = NativePreviewPlace(latitude: 12.9716, longitude: 77.5946)
        let maryville = NativePreviewPlace(latitude: 38.7237, longitude: -89.9559)
        let size = CGSize(width: 392.2, height: 200)

        // Global render requests are slower; repeated appearance/camera tasks
        // must join the same operation instead of restarting its loading state.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let first = Task { await model.load(place: bengaluru, size: size) }
            try await wait("global fixture started") { model.fixtureRequests == 1 }
            let duplicate = Task { await model.load(place: bengaluru, size: CGSize(width: 392.6, height: 200)) }
            let third = Task { await model.load(place: bengaluru, size: size) }
            try await settle()
            verify(model.fixtureRequests == 1 && model.state == .loading,
                   "repeated same quantized camera joins slow global acquisition")
            duplicate.cancel()
            model.finishFixture(1)
            await first.value; await duplicate.value; await third.value
            verify(model.state == .ready && model.image?.fixtureID == 1 && model.openingContext?.matches(bengaluru) == true,
                   "one global acquisition publishes the right location")
            verify(model.canceledFixtureCompletions == 0, "canceling a joined waiter does not cancel the shared producer")
            await model.load(place: bengaluru, size: size)
            verify(model.fixtureRequests == 1 && model.state == .ready, "same-camera cached success never flashes loading")
            let reused = NativeRadarPreviewModel()
            await reused.load(place: bengaluru, size: size)
            verify(reused.fixtureRequests == 0 && reused.state == .ready, "shared snapshot cache survives card recreation")
            print("PASS actual lifecycle: Bengaluru-style slow global acquisition coalesces and reuses a ready snapshot")
        }

        // An already-canceled SwiftUI task may start after its replacement. It
        // must not call cancel() and tear down the replacement's live renderer.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let live = Task { await model.load(place: bengaluru, size: size) }
            try await wait("live global fixture") { model.fixtureRequests == 1 }
            let stale = Task { await model.load(place: maryville, size: size) }
            stale.cancel()
            await stale.value
            verify(model.fixtureRequests == 1 && model.state == .loading,
                   "already-canceled load cannot alter the active place or renderer")
            model.finishFixture(1); await live.value
            verify(model.state == .ready && model.openingContext?.matches(bengaluru) == true,
                   "live global fixture survives late canceled task")
            print("PASS actual lifecycle: canceled-before-admission tasks leave the current worker untouched")
        }

        // A replacement task may join a producer whose original caller has
        // just been canceled. Once that producer drains, retry immediately.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let canceled = Task { await model.load(place: bengaluru, size: size) }
            try await wait("cancelable producer started") { model.fixtureRequests == 1 }
            canceled.cancel()
            let replacement = Task { await model.load(place: bengaluru, size: size) }
            try await settle()
            verify(model.fixtureRequests == 1, "replacement waits for canceled producer to drain")
            model.finishFixture(1)
            try await wait("drained producer replaced") { model.fixtureRequests == 2 }
            model.finishFixture(2)
            await canceled.value; await replacement.value
            verify(model.state == .ready && model.image?.fixtureID == 2 && model.canceledFixtureCompletions == 1,
                   "replacement recovers immediately from a joined canceled producer")
            print("PASS actual lifecycle: joined canceled producer drains and admits a fresh worker")
        }

        // Parent cancellation and a cancellation-ignoring old provider both
        // arrive after the second location has acquired its own live worker.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let first = Task { await model.load(place: maryville, size: size) }
            try await wait("first place request") { model.fixtureRequests == 1 }
            let second = Task { await model.load(place: bengaluru, size: size) }
            try await wait("second place request") { model.fixtureRequests == 2 }
            first.cancel(); model.finishFixture(1); await first.value
            verify(model.state == .loading && model.image == nil,
                   "late first-place completion cannot publish or clear second-place loading")
            model.finishFixture(2); await second.value
            verify(model.state == .ready && model.image?.fixtureID == 2 && model.openingContext?.matches(bengaluru) == true,
                   "second place remains publishable after stale parent cancellation")
            verify(model.canceledFixtureCompletions == 1, "late completion really exercised canceled producer")
            print("PASS actual lifecycle: place A→B rejects late A and does not cancel B")
        }

        // Failed worldwide requests must not start a loading/unavailable loop
        // as view geometry and appearance tasks repeat.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let first = Task { await model.load(place: bengaluru, size: size) }
            try await wait("failing request started") { model.fixtureRequests == 1 }
            model.finishFixture(1, failure: true); await first.value
            verify(model.state == .unavailable && model.image == nil, "failed request settles unavailable")
            for _ in 0..<8 {
                await model.load(place: bengaluru, size: size)
                verify(model.state == .unavailable, "cooldown preserves unavailable without loading flashes")
            }
            verify(model.fixtureRequests == 1, "same failed request is not retried during cooldown")
            model.expireFixtureRetry()
            let retry = Task { await model.load(place: bengaluru, size: size) }
            try await wait("expired failure cooldown retries") { model.fixtureRequests == 2 }
            model.finishFixture(2, failure: true); await retry.value
            let changed = Task { await model.load(place: maryville, size: size) }
            try await wait("new place bypasses old failure cooldown") { model.fixtureRequests == 3 }
            model.finishFixture(3); await changed.value
            verify(model.state == .ready && model.openingContext?.matches(maryville) == true,
                   "failure cooldown is exact-location scoped")
            print("PASS actual lifecycle: failed global request remains stably unavailable; different location still loads")
        }

        // Fire the production deadline's state/cancellation deterministically,
        // rather than making the suite wait 22 seconds for a fixture network.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let first = Task { await model.load(place: bengaluru, size: size) }
            try await wait("timeout fixture started") { model.fixtureRequests == 1 }
            model.expireFixtureDeadline(); model.finishFixture(1); await first.value
            verify(model.state == .unavailable && model.image == nil,
                   "timed-out producer settles unavailable rather than idle")
            await model.load(place: bengaluru, size: size)
            verify(model.fixtureRequests == 1 && model.state == .unavailable,
                   "timeout uses failure cooldown instead of a loading loop")
            print("PASS actual lifecycle: render timeout settles unavailable and respects the retry cooldown")
        }

        // Refresh failure should preserve a still-valid map instead of making
        // the image disappear. The retention cannot outlive source freshness.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let first = Task { await model.load(place: bengaluru, size: size) }
            try await wait("initial reusable source") { model.fixtureRequests == 1 }
            model.finishFixture(1); await first.value
            NativeRadarPreviewModel.resetFixtureCache()
            let refresh = Task { await model.load(place: bengaluru, size: size) }
            try await wait("refresh of still-valid image") { model.fixtureRequests == 2 }
            verify(model.image?.fixtureID == 1, "usable image remains visible while refreshing")
            model.finishFixture(2, failure: true); await refresh.value
            verify(model.state == .ready && model.image?.fixtureID == 1 && model.status.contains("unavailable"),
                   "failed update retains valid image and truthfully labels the failure")
            await model.load(place: bengaluru, size: size)
            verify(model.fixtureRequests == 2 && model.state == .ready, "failed update cooldown does not replace usable map")
            model.expireDisplayedFixture()
            await model.load(place: bengaluru, size: size)
            verify(model.state == .unavailable && model.image == nil && model.fixtureRequests == 2,
                   "retained source still expires during cooldown")
            print("PASS actual lifecycle: failed refresh retains only a usable image and expires it honestly")
        }

        // Source-age limits apply even when the StateObject outlives its cache;
        // a delayed valid image is labeled, an expired one cannot masquerade as
        // current while replacement transport is running.
        do {
            NativeRadarPreviewModel.resetFixtureCache()
            let model = NativeRadarPreviewModel()
            let first = Task { await model.load(place: bengaluru, size: size) }
            try await wait("delayed source request") { model.fixtureRequests == 1 }
            model.finishFixture(1, age: 16 * 60); await first.value
            verify(model.state == .ready && model.isStale && model.status.hasPrefix("Delayed radar"),
                   "usable delayed global image is honestly labeled")
            model.expireDisplayedFixture()
            let second = Task { await model.load(place: bengaluru, size: size) }
            try await wait("expired source refresh") { model.fixtureRequests == 2 }
            verify(model.image == nil && model.state == .loading, "expired image is cleared before replacement")
            model.finishFixture(2); await second.value
            verify(model.state == .ready && !model.isStale, "fresh replacement resets stale status")
            let resized = Task { await model.load(place: bengaluru, size: CGSize(width: 450, height: 200)) }
            try await wait("meaningful camera change") { model.fixtureRequests == 3 }
            verify(model.image == nil, "different camera does not reuse an incorrectly framed snapshot")
            model.finishFixture(3); await resized.value
            verify(model.state == .ready, "new camera can publish normally")
            print("PASS actual lifecycle: delayed labeling, expired-source refresh and meaningful camera changes")
        }
    }
}
`.replace('MODEL_SOURCE', model).replace('PUBLICATION_SOURCE', publication);
const binary = `${temp}/preview-lifecycle-test`;
const compilation = spawnSync('xcrun', ['swiftc', '-O', '-parse-as-library', '-swift-version', '6',
  '-module-cache-path', `${temp}/modules`, '-', '-o', binary], {
    input: [policy, handoff, freshness, program].join('\n'), encoding: 'utf8'
  });
process.stdout.write(compilation.stdout ?? ''); process.stderr.write(compilation.stderr ?? '');
assert.equal(compilation.status, 0, 'actual preview lifecycle test compilation');
const run = spawnSync(binary, [], {encoding:'utf8', timeout:15000});
process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
assert.equal(run.status, 0, 'actual preview lifecycle behavior');
NODE
