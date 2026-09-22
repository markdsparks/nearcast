#!/bin/bash
set -euo pipefail

PIPELINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIPELINE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-model-pipeline.XXXXXX")"
trap 'rm -rf "$PIPELINE_TEMP"' EXIT

# Compile the actual production scheduler function with value-only result
# fixtures. No copied scheduler implementation can drift away from the app.
node --input-type=module - "$PIPELINE_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarModel.swift" "$PIPELINE_TEMP" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const model = fs.readFileSync(process.argv[2], 'utf8');
const temp = process.argv[3];
function block(start, end) {
  const a = model.indexOf(start), b = model.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production section ${start}`);
  return model.slice(a, b);
}
const scheduler = block('    private func acquireFrameWork(', '    private func forecastFrame(');
const viewport = block('    func updateViewport(', '    var renderingZoom:');
const refresh = block('    private func refreshSubhourly(', '    private func refreshObserved(');
const forecast = block('    private func loadSubhourlyImage(', '    private func publishForecast(_ cached:');
const warm = block('    private func warmNearbyFrames(', '    /// Select actual advertised scans');
const evidence = block('    private func loadTransitionObservations(', '    nonisolated private static func numericFrame(');
assert(model.includes('private static let frameStore = FrameStore()'), 'rendered cache survives map dismissal');
assert(!viewport.includes('removeAll()') && !viewport.includes('setViewport('), 'camera movement does not destroy cached areas');
assert(viewport.includes('observedRepository.coverageEnvelope(for: bounds)'), 'returning areas recover their exact shared envelope');
assert(viewport.includes('loadSelectedImage(debounce: false)') && !viewport.includes('if loadingImage'), 'new coverage starts during movement without awaiting old-area I/O');
assert(!refresh.includes('removeAll()') && !refresh.includes('NativeRadarFrameCache'), 'metadata retains unchanged overlap');
assert(forecast.indexOf('frameStore.forecast.value(for: key)') < forecast.indexOf('loadingImage = true'), 'finished cache hit is immediate');
assert(forecast.includes('self.imageGeneration == generation') && forecast.includes('self.coverageViewport == bounds'));
assert(forecast.includes('self.subhourlyRenderKey(frame, bounds: bounds) == key'), 'late enhanced result rechecks evidence/freshness');
assert(model.includes('NativeRadarTransitionPolicy.requestIdentity') && model.includes('requestedAt: iso(Date())'));
assert(model.includes('frame.range.lowerBound') && model.includes('frame.range.upperBound'), 'advertised source revision/range is in forecast key');
assert(model.includes('anchor.map(subhourlySourceKey)'), 'enhanced output includes the exact anchor record, not only its time');
assert(model.includes('guard enhancementEnabled, !candidates.isEmpty else { return original + "|original" }'), 'unmodified forecasts do not churn when the radar anchor advances');
assert(model.includes('subhourlyRenderKey(frame, bounds: bounds) == key, let nextPrepared'), 'old anchor work cannot repopulate prepared alignment after revision');
assert(model.indexOf('let inputs = subhourlyInputs(frame, bounds: bounds)') < model.indexOf('await client.promote(frame'), 'source/evidence snapshot is captured before promotion awaits');
assert(model.includes('coverageBits.count') && model.includes('(numeric.validDataMask.count + 7) / 8'));
assert(model.includes('Self.frameStore.generation == storeGeneration'), 'pressure purge excludes old in-flight retention');
assert(warm.includes('self.forecastFrame(frame, bounds: bounds, foreground: false)'), 'warmup builds final forecast variants');
assert(!warm.includes('highDetailRGBA'), 'warmup uses the shared producer instead of a throwaway second renderer');
assert(evidence.includes('frameStore.evidence.insert') && !evidence.includes('radarCache.insert'), 'motion evidence cannot evict the observed loop');
assert(!evidence.includes('evidenceWork'), 'optional evidence remains in the producer cancellation tree');
assert(model.includes('recordPublish()') && model.includes('performanceDebugSummary'), 'runtime timing is inspectable');
assert(model.includes('private let observedRepository = NativeRadarObservedRepository.shared'), 'Today and map share one observed owner');
assert(model.includes('observedRepository.frame(frame, bounds: bounds'), 'map observed renders lease the shared repository');
assert(!model.includes('var observed = NativeRadarFrameCache') && !model.includes('radarCache'), 'model does not duplicate observed retention');
assert(model.includes('initialContext: NativeRadarOpeningContext? = nil') && model.includes('context.isUsable(for: place)'), 'map handoff checks exact place and source freshness');
console.log('PASS model cache contracts: exact render/evidence identity, overlap, area reuse, pressure, final-frame warmup, coverage and stale publication');

const program = `
import Foundation
import OSLog

@MainActor final class PipelineHarness {
    enum FrameWorkResult { case observed(Int), forecast(Int) }
    struct FrameWork {
        let token: UUID
        let task: Task<FrameWorkResult, Error>
        var foreground: Bool
    }
    var active = true, suspended = false
    var frameWork: [String: FrameWork] = [:]
    var performanceJoins = 0
    let performanceLog = Logger(subsystem: "app.nearcast.tests", category: "RadarPipeline")
${scheduler}
    func load(_ key: String, foreground: Bool, operation: @escaping @MainActor () async throws -> Int) async throws -> Int {
        let result = try await acquireFrameWork(key: key, foreground: foreground) { .forecast(try await operation()) }
        guard case let .forecast(value) = result else { fatalError("wrong fixture type") }
        return value
    }
    func cancel(_ key: String) { frameWork[key]?.task.cancel() }
}

@main enum PipelineTests {
    @MainActor static func main() async throws {
        let shared = PipelineHarness()
        var starts = 0
        let warm = Task { try await shared.load("next", foreground: false) {
            starts += 1; try await Task.sleep(for: .milliseconds(100)); return 42
        } }
        try await Task.sleep(for: .milliseconds(20))
        warm.cancel() // cancel the speculative subscription, not its producer
        let foreground = Task { try await shared.load("next", foreground: true) {
            starts += 1; return -1
        } }
        let value = try await foreground.value
        precondition(value == 42 && starts == 1 && shared.performanceJoins == 1)
        do { _ = try await warm.value; fatalError("cancelled subscriber succeeded") } catch is CancellationError {} catch { throw error }
        precondition(shared.frameWork.isEmpty)
        print("PASS actual scheduler: foreground promotes/joins prefetch; canceled UI subscription does not restart work")

        let bounded = PipelineHarness()
        var active = 0, maximum = 0
        func work(_ value: Int, delay: Int) async throws -> Int {
            active += 1; maximum = max(maximum, active)
            defer { active -= 1 }
            try await Task.sleep(for: .milliseconds(delay)); return value
        }
        let a = Task { try await bounded.load("a", foreground: false) { try await work(1, delay: 150) } }
        let b = Task { try await bounded.load("b", foreground: false) { try await work(2, delay: 150) } }
        try await Task.sleep(for: .milliseconds(20))
        let c = try await bounded.load("c", foreground: true) { try await work(3, delay: 10) }
        _ = try? await a.value; _ = try? await b.value
        precondition(c == 3 && maximum <= 2 && active == 0 && bounded.frameWork.isEmpty)
        print("PASS actual scheduler: unrelated speculative work yields to foreground; producer count never exceeds two")

        let recovery = PipelineHarness()
        var attempts = 0
        let abandoned = Task { try await recovery.load("same", foreground: false) {
            attempts += 1; try await Task.sleep(for: .seconds(1)); return 1
        } }
        try await Task.sleep(for: .milliseconds(20))
        recovery.cancel("same")
        let recovered = try await recovery.load("same", foreground: true) { attempts += 1; return 2 }
        _ = try? await abandoned.value
        precondition(recovered == 2 && attempts == 2 && recovery.frameWork.isEmpty)
        print("PASS actual scheduler: canceled producer is drained and retried, not reused as a poisoned cache hit")
    }
}
`;
const binary = `${temp}/model-pipeline-test`;
const compilation = spawnSync('xcrun', ['swiftc', '-O', '-parse-as-library', '-swift-version', '6',
  '-module-cache-path', `${temp}/modules`, '-', '-o', binary], {input: program, encoding:'utf8'});
process.stdout.write(compilation.stdout ?? ''); process.stderr.write(compilation.stderr ?? '');
assert.equal(compilation.status, 0, 'production scheduler test compilation');
const run = spawnSync(binary, [], {encoding:'utf8', timeout:10000});
process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
assert.equal(run.status, 0, 'production scheduler behavior');
NODE
