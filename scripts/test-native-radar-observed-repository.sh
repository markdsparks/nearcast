#!/bin/bash
set -euo pipefail

OBSERVED_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OBSERVED_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-observed-repository.XXXXXX")"
trap 'rm -rf "$OBSERVED_TEMP"' EXIT

# Compile the actual repository owner/scheduler/cache with injected value-only
# loaders. Only its UIKit raster adapter is excluded from the portable harness;
# the integrated iOS build typechecks that adapter. No provider calls are made.
node --input-type=module - "$OBSERVED_ROOT" "$OBSERVED_TEMP" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root = process.argv[2], temp = process.argv[3];
const source = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeRadarObservedRepository.swift`, 'utf8');
const boundary = source.indexOf('    private static func render(');
assert(boundary > 0, 'native rendering adapter boundary');
assert(source.includes('static let shared = NativeRadarObservedRepository()'));
assert(source.includes('historyMinutes: 30, maximumFrames: 24'));
assert(!/HRRR|WMS|AlertsClient|warmNearbyFrames/.test(source.replace(/\/\/[^\n]*/g, '')), 'latest repository does not start secondary weather');
assert(source.includes('sourceMilliseconds') && source.includes('renderMilliseconds'));
assert(source.includes('try Task.checkCancellation()'));
const repository = source.slice(0, boundary).replace('import UIKit\n', '') + `
    private static func render(_ frame: MRMSContract.AdvertisedFrame, bounds: NativeRadarViewport,
                               client: MRMSClient) async throws -> RenderedFrame {
        fatalError("A live raster adapter must never be called by repository tests")
    }
}
`;
const fixtures = `
import Foundation
enum UIApplication { static let didReceiveMemoryWarningNotification = Notification.Name("test-pressure") }
struct NativeRadarViewport: Equatable, Sendable {
    let west: Double, south: Double, east: Double, north: Double
    var zoom: Double = 6.8
    var isUsable: Bool { NativeRadarFrameCacheViewport(west: west, south: south, east: east, north: north).isUsable }
}
struct NativeRadarImage: Sendable {
    let id: String
    let west: Double, south: Double, east: Double, north: Double
}
enum NativeRadarSeamEstimation {
    struct Texture: Sendable { let bytes: [UInt8] }
    struct Frame: Sendable { let texture: Texture; let validTimeMilliseconds: Int64 }
}
enum MRMSContract {
    enum Failure: Error { case invalidOptions }
    struct AdvertisedFrame: Equatable, Sendable {
        let key: String, byteLength: Int, validTimeMilliseconds: Int64
    }
}
struct MRMSClient: Sendable {
    init() throws {}
    func listRecentFrames(now: Date, historyMinutes: Int, maximumFrames: Int) async throws -> [MRMSContract.AdvertisedFrame] {
        fatalError("A live metadata adapter must never be called by repository tests")
    }
}
actor MRMSScanCache {
    static let shared = MRMSScanCache()
    func removeAll() {}
}
@MainActor final class Probe {
    var metadataCalls = 0, frameCalls = 0, active = 0, maximum = 0
    var starts: [String] = []
    var delay = 60
    func metadata(_ now: Date) async throws -> [MRMSContract.AdvertisedFrame] {
        metadataCalls += 1
        try await Task.sleep(for: .milliseconds(delay))
        return [Self.advertised(0)]
    }
    static func advertised(_ index: Int, bytes: Int = 10) -> MRMSContract.AdvertisedFrame {
        .init(key: "advertised-" + String(index), byteLength: bytes, validTimeMilliseconds: Int64(index) * 120000)
    }
    func render(_ frame: MRMSContract.AdvertisedFrame, _ bounds: NativeRadarViewport) async throws -> NativeRadarObservedRepository.RenderedFrame {
        frameCalls += 1; active += 1; maximum = max(maximum, active); starts.append(frame.key)
        defer { active -= 1 }
        try await Task.sleep(for: .milliseconds(delay))
        return .init(image: .init(id: NativeRadarObservedRepository.cacheKey(frame, bounds: bounds),
            west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north),
            numeric: .init(texture: .init(bytes: [UInt8](repeating: 1, count: 512 * 672)), validTimeMilliseconds: frame.validTimeMilliseconds),
            sourceMilliseconds: 1, renderMilliseconds: 2)
    }
    func repository() -> NativeRadarObservedRepository {
        .init(metadataLoader: { try await self.metadata($0) },
            frameLoader: { try await self.render($0, $1) }, observeMemoryPressure: false)
    }
}
@main enum ObservedRepositoryTests {
    @MainActor static func main() async throws {
        let a = NativeRadarViewport(west: -91, south: 37, east: -88, north: 40, zoom: 6.5)
        let b = NativeRadarViewport(west: -88, south: 37, east: -85, north: 40, zoom: 6.5)
        let now = Date(timeIntervalSince1970: 1000)
        let metadataProbe = Probe(), metadata = metadataProbe.repository()
        let abandonedMetadata = Task { try await metadata.recentFrames(now: now) }
        let retainedMetadata = Task { try await metadata.recentFrames(now: now) }
        try await Task.sleep(for: .milliseconds(15)); abandonedMetadata.cancel()
        let descriptors = try await retainedMetadata.value
        _ = try? await abandonedMetadata.value
        precondition(descriptors.count == 1 && metadataProbe.metadataCalls == 1)
        _ = try await metadata.recentFrames(now: now.addingTimeInterval(119))
        precondition(metadataProbe.metadataCalls == 1)
        precondition(metadata.cachedRecentFrames(now: now.addingTimeInterval(-1)) == nil)
        precondition(metadata.cachedRecentFrames(now: now.addingTimeInterval(120)) == nil)
        let forcedA = Task { try await metadata.recentFrames(now: now, force: true) }
        let forcedB = Task { try await metadata.recentFrames(now: now, force: true) }
        _ = try await forcedA.value; _ = try await forcedB.value
        precondition(metadataProbe.metadataCalls == 2)
        print("PASS observed metadata: preview/map single flight, independent cancellation, 120-second freshness and forced refresh")

        let sharedProbe = Probe(), shared = sharedProbe.repository(), frame = Probe.advertised(1)
        let preview = Task { try await shared.frame(frame, bounds: a, foreground: false) }
        let map = Task { try await shared.frame(frame, bounds: a) }
        try await Task.sleep(for: .milliseconds(15)); preview.cancel()
        let mapValue = try await map.value
        do { _ = try await preview.value; fatalError("Canceled preview received frame") } catch is CancellationError {} catch { throw error }
        precondition(sharedProbe.frameCalls == 1 && shared.statistics.joins == 1)
        let reopened = try await shared.frame(frame, bounds: a)
        precondition(reopened.image.id == mapValue.image.id && sharedProbe.frameCalls == 1)
        let moved = try await shared.frame(frame, bounds: b)
        let revised = try await shared.frame(Probe.advertised(1, bytes: 11), bounds: a)
        var zoomed = a; zoomed.zoom = 7
        let zoomedValue = try await shared.frame(frame, bounds: zoomed)
        precondition(Set([mapValue.image.id, moved.image.id, revised.image.id, zoomedValue.image.id]).count == 4)
        _ = try await shared.frame(frame, bounds: a)
        precondition(sharedProbe.frameCalls == 4)
        precondition(mapValue.image.west == a.west && moved.image.west == b.west)
        print("PASS observed sharing: canceled preview preserves map lease; reopen and A-B-A reuse; source/coverage/zoom stay exact")

        let boundedProbe = Probe(), bounded = boundedProbe.repository()
        boundedProbe.delay = 100
        let first = Task { try await bounded.frame(Probe.advertised(0), bounds: a, foreground: false) }
        let second = Task { try await bounded.frame(Probe.advertised(1), bounds: a, foreground: false) }
        try await Task.sleep(for: .milliseconds(15))
        let queued = Task { try await bounded.frame(Probe.advertised(2), bounds: a, foreground: false) }
        let priority = Task { try await bounded.frame(Probe.advertised(3), bounds: a, foreground: true) }
        let canceled = Task { try await bounded.frame(Probe.advertised(4), bounds: a, foreground: false) }
        try await Task.sleep(for: .milliseconds(15)); canceled.cancel()
        _ = try await first.value; _ = try await second.value
        _ = try await priority.value; _ = try await queued.value; _ = try? await canceled.value
        precondition(boundedProbe.maximum == 2 && boundedProbe.active == 0)
        precondition(boundedProbe.starts.count == 4 && boundedProbe.starts[2] == "advertised-3")
        precondition(bounded.statistics.activeJobs == 0 && bounded.statistics.queuedJobs == 0)
        print("PASS observed admission: at most two producers, foreground before queued prefetch, canceled queued work never starts")

        let recoveryProbe = Probe(), recovery = recoveryProbe.repository()
        let abandoned = Task { try await recovery.frame(frame, bounds: a) }
        try await Task.sleep(for: .milliseconds(15)); abandoned.cancel()
        _ = try? await abandoned.value
        let recovered = try await recovery.frame(frame, bounds: a)
        precondition(recovered.numeric.validTimeMilliseconds == frame.validTimeMilliseconds)
        precondition(recoveryProbe.frameCalls == 2 && recoveryProbe.maximum <= 2)
        print("PASS observed cancellation: last lease cancels producer; same-key request recovers without poisoned work")

        let pressureProbe = Probe(), pressure = pressureProbe.repository()
        let inFlight = Task { try await pressure.frame(frame, bounds: a) }
        try await Task.sleep(for: .milliseconds(15)); pressure.removeAll()
        _ = try await inFlight.value
        precondition(pressure.cachedFrame(frame, bounds: a) == nil && pressure.retainedBytes == 0)
        _ = try await pressure.frame(frame, bounds: a)
        precondition(pressureProbe.frameCalls == 2 && pressure.retainedBytes == 512 * 672 * 6)
        pressure.removeAll(); precondition(pressure.retainedBytes == 0)
        print("PASS observed pressure: live caller completes, pre-purge work cannot repopulate retention, next request recovers")

        let loopProbe = Probe(), loop = loopProbe.repository(); loopProbe.delay = 1
        for index in 0..<6 { _ = try await loop.frame(Probe.advertised(index), bounds: a) }
        _ = try await loop.frame(frame, bounds: b)
        _ = try await loop.frame(frame, bounds: zoomed)
        for _ in 0..<3 { for index in 0..<6 { _ = try await loop.frame(Probe.advertised(index), bounds: a) } }
        precondition(loopProbe.frameCalls == 8 && loop.retainedBytes <= 16 * 1024 * 1024)
        _ = try await loop.frame(Probe.advertised(20), bounds: b)
        precondition(loop.retainedBytes <= 16 * 1024 * 1024)
        let envelopeA = loop.coverageEnvelope(for: a)
        _ = loop.coverageEnvelope(for: b)
        precondition(loop.coverageEnvelope(for: a) == envelopeA)
        print("PASS observed retention: three six-frame loops stay warm across preview areas; byte-bounded LRU and shared envelopes")
    }
}
`;
const binary = `${temp}/observed-repository-test`;
const cachePolicy = fs.readFileSync(`${root}/native/experiments/NativeRadarFoundation/NativeRadarFrameCachePolicy.swift`, 'utf8');
const compilation = spawnSync('xcrun', ['swiftc', '-O', '-parse-as-library', '-swift-version', '6',
  '-module-cache-path', `${temp}/modules`, '-', '-o', binary], {input: cachePolicy + fixtures + repository, encoding:'utf8'});
process.stdout.write(compilation.stdout ?? ''); process.stderr.write(compilation.stderr ?? '');
assert.equal(compilation.status, 0, 'production repository compilation');
const run = spawnSync(binary, [], {encoding:'utf8', timeout:15000});
process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
assert.equal(run.status, 0, 'production repository behavior');
NODE
