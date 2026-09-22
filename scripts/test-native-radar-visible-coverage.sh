#!/bin/bash
set -euo pipefail

COVERAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COVERAGE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-visible-coverage.XXXXXX")"
trap 'rm -rf "$COVERAGE_TEMP"' EXIT

xcrun swiftc -swift-version 6 -module-cache-path "$COVERAGE_TEMP/ModuleCache" \
  "$COVERAGE_ROOT/native/experiments/NativeRadarFoundation/NativeRadarFrameCachePolicy.swift" \
  "$COVERAGE_ROOT/scripts/native-radar-visible-coverage-test.swift" \
  -o "$COVERAGE_TEMP/native-radar-visible-coverage-test"
"$COVERAGE_TEMP/native-radar-visible-coverage-test"

node --input-type=module - "$COVERAGE_ROOT" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = process.argv[2];
const model = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeRadarModel.swift`, 'utf8');
function block(start, end) {
  const a = model.indexOf(start), b = model.indexOf(end, a);
  assert(a >= 0 && b > a, `Missing production section ${start}`);
  return model.slice(a, b);
}
const refresh = block('    private func refreshCoverageMessage()', '    private func loadObservedImage(');
const viewport = block('    func updateViewport(', '    private func loadSelectedImage(');
const forecast = block('    private func publishForecast(_ cached:', '    private func publishForecast(_ rendered:');
const observed = block('    private func publishObserved(', '    private func refreshCoverageMessage()');
assert(refresh.includes('NativeRadarVisibleCoverage.fraction('), 'Display notices use the behavior-tested visible mask helper');
assert(refresh.includes('visibleBounds = NativeRadarFrameCacheViewport(west: viewport.west') &&
       refresh.includes('south: viewport.south') && refresh.includes('east: viewport.east, north: viewport.north'),
       'Notices use actual camera bounds, never the padded coverageViewport');
assert(refresh.includes('isCovered: displayedCoverage.covers'), 'Coverage follows the displayed image mask, not transparency or reflectivity');
assert(refresh.includes('let forecast = displayedProduct == .forecast'), 'Notice source matches the displayed image during radar/forecast transitions');
assert(refresh.includes('displayedCoverage.fullyCovered, imageBounds.contains(visibleBounds)'),
       'Fully covered contained images avoid repeated full-mask scans during gestures');
assert(refresh.includes('imageUnavailableAtPlace =') && refresh.includes('coverage.map { $0 < 0.98 }'),
       'Missing selected-place data and material peripheral missing data remain truthful');
assert(!refresh.includes('imageMessage ='), 'Coverage notices never overwrite transport errors or enter error retry state');
const refreshIndex = viewport.indexOf('refreshCoverageMessage()');
const reuseIndex = viewport.indexOf('guard next != coverageEnvelope else { return }');
assert(refreshIndex >= 0 && reuseIndex > refreshIndex, 'Same-envelope camera moves must update warnings before cached-envelope reuse');
for (const [label, publication] of [['forecast', forecast], ['observed', observed]]) {
  assert(publication.includes('displayedCoverage = .init('), `${label} publication retains its own actual mask and bounds`);
  assert(publication.includes('refreshCoverageMessage()'), `${label} publication refreshes the camera-specific notice for every frame`);
}
assert(!forecast.includes('Double(cached.coveredPixels) /'), 'Whole padded-image coverage is not shown as camera coverage');
console.log('PASS visible coverage wiring: displayed-mask publication, camera crop, same-envelope pan refresh, and independent error state');
NODE
