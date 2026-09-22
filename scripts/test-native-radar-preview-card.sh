#!/bin/bash
set -euo pipefail

PREVIEW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-preview-card.XXXXXX")"
trap 'rm -rf "$PREVIEW_TEMP"' EXIT

node --input-type=module - "$PREVIEW_ROOT" "$PREVIEW_TEMP" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root = process.argv[2], temp = process.argv[3];
const card = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeRadarPreviewCard.swift`, 'utf8');
const home = fs.readFileSync(`${root}/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewView.swift`, 'utf8');
const insertion = home.indexOf('NativeRadarPreviewCard(place: model.selectedPlace');
assert(insertion > home.indexOf('                                    outlookCard'));
assert(insertion < home.indexOf('                                    dailyList'));
assert(home.slice(insertion - 110, insertion).includes('if isToday'), 'Today only');
const eligibility = home.slice(home.indexOf('private var radarPreviewWorkAllowed:'), home.indexOf('private var livingSkyIdentity:'));
for (const gate of ['viewIsVisible', 'isUncovered', 'scenePhase == .active', '!isHourly', '!isScrolling', '!showingNativeMap']) {
  assert(eligibility.includes(gate), `Missing eligibility gate ${gate}`);
}
assert(home.includes('initialContext: previewOpeningContext'));
assert(home.includes('previewOpeningContext = context'));
const tab = home.slice(home.indexOf('navigationButton("Map"'), home.indexOf('navigationButton("Plans"'));
assert(tab.includes('previewOpeningContext = nil'), 'ordinary Map tab must not reuse an old preview route');
assert(card.includes('geometry.frame(in: .named("native-weather-scroll"))'), 'uses real scroll geometry');
assert(card.includes('NativeRadarPreviewVisibility.isVisible(frame: mapFrame, viewportHeight: viewportHeight,')
  && card.includes('wasVisible: isVisible'));
assert(card.includes('NativeRadarPreviewPolicy.stableWidth(current: snapshotWidth, measured: frame.width)'), 'snapshot size is stable through minor layout jitter');
assert(card.indexOf('.onGeometryChange(for: CGRect.self)') > card.indexOf('.buttonStyle(NativeRadarPreviewButtonStyle'), 'measure fixed card outside animated button');
assert(card.includes('guard !Task.isCancelled else { return }'), 'superseded task cannot cancel current admission');
assert(card.includes('isActive && scenePhase == .active && isVisible'));
assert(card.includes('Task.sleep(for: .milliseconds(300))') && card.includes('Task.sleep(for: .seconds(4 * 60))'));
assert(card.includes('.onDisappear { model.cancel() }') && card.includes('if !eligible { model.cancel() }'));
assert(!card.includes('NativeRadarModel(') && !card.includes('NativeRadarMap('), 'no second interactive map/timeline engine');
assert(!card.includes('playback') || card.includes('owns no\n/// timeline or playback engine'));
assert(!card.includes('Storm Check') && !card.includes('Precipitation check'));
assert(card.includes('.frame(height: 200)'));
assert(card.includes('.sensoryFeedback(.selection, trigger: tapRevision)'));
assert(card.includes('configuration.isPressed') && card.includes('0.98 : 1') && card.includes('lineWidth: 2'));
assert(card.includes('accessibilityHint("Opens the full weather map in this area.")'));
assert(card.includes('.accessibilityAddTraits(.isButton)'), 'combined preview remains announced as a button');
assert(card.indexOf('if !model.attributions.isEmpty') > card.indexOf('.buttonStyle(NativeRadarPreviewButtonStyle'), 'credits are outside the map button');
assert(card.includes('Link(credit.title, destination: credit.url)') && card.includes('NativeRadarPreviewCreditLayout {'));
assert(card.includes('ZStack(alignment: .bottomTrailing)'), 'credits overlay the map rather than adding a footer');
assert(!card.includes('Text("Radar nearby")') && !card.includes('Image(systemName: "arrow.up.right")'), 'no large header or expand chrome');
assert(!card.includes('background(.regularMaterial') && !card.includes('Text("Open the full map")'), 'image-only card has no extra material shell or CTA');
assert(card.includes('Text(compactStatus)') && card.includes('.overlay(alignment: .topLeading)'), 'quiet source age sits over the image');
assert(card.includes('sourceLabel.contains("partial coverage")'), 'partial coverage survives delayed/unavailable presentation');
assert(card.includes('subview.sizeThatFits(ProposedViewSize(width: limit, height: nil))'), 'credits wrap without truncating required attribution');
assert(card.includes('model.freshnessDate') && card.includes('now.timeIntervalSince(date)'));
assert(card.includes('NativeRadarFreshnessPolicy.assess(latest: date, at: now)'));
assert(card.includes('Radar out of date') && card.includes('Delayed radar') && card.includes('Radar unavailable'));
assert(!card.includes('No rain') && !card.includes('All clear'), 'blank/unavailable pixels never imply clear weather');
console.log('PASS Today radar preview contracts: immersive image, overlaid credits, placement, routing, visible-only work, truthful source time and accessible pressed feedback');

const start = card.indexOf('enum NativeRadarPreviewVisibility {');
const end = card.indexOf('private struct NativeRadarPreviewButtonStyle:', start);
assert(start >= 0 && end > start);
const policy = card.slice(start, end);
const test = `
import Foundation
import CoreGraphics
${policy}
func visible(_ y: CGFloat, height: CGFloat = 200, viewport: CGFloat = 700) -> Bool {
    NativeRadarPreviewVisibility.isVisible(frame: CGRect(x: 0, y: y, width: 360, height: height), viewportHeight: viewport)
}
precondition(visible(100))
precondition(visible(-150)) // fifty real pixels remain in the viewport
precondition(!visible(-175))
precondition(visible(650))
precondition(!visible(675))
precondition(!visible(710))
precondition(!visible(-210))
precondition(!visible(0, viewport: 0))
precondition(!visible(0, viewport: -.infinity))
precondition(!visible(0, height: 0))
precondition(!NativeRadarPreviewVisibility.isVisible(frame: .null, viewportHeight: 700))
precondition(!NativeRadarPreviewVisibility.isVisible(frame: .infinite, viewportHeight: 700))
precondition(!NativeRadarPreviewVisibility.isVisible(frame: CGRect(x: CGFloat.nan, y: 0, width: 360, height: 200), viewportHeight: 700))
precondition(NativeRadarPreviewVisibility.isVisible(frame: CGRect(x: 0, y: 660, width: 360, height: 200), viewportHeight: 700, wasVisible: true))
precondition(!NativeRadarPreviewVisibility.isVisible(frame: CGRect(x: 0, y: 690, width: 360, height: 200), viewportHeight: 700, wasVisible: true))
var admitted = false
for y: CGFloat in [649, 651, 649, 653, 650] {
    admitted = NativeRadarPreviewVisibility.isVisible(frame: CGRect(x: 0, y: y, width: 360, height: 200), viewportHeight: 700, wasVisible: admitted)
    precondition(admitted, "threshold jitter must not repeatedly cancel a visible global raster load")
}
print("PASS preview visibility: real intersection, partial-card threshold, zero viewport and invalid geometry")
`;
const binary = `${temp}/preview-visibility-test`;
const compile = spawnSync('xcrun', ['swiftc', '-module-cache-path', `${temp}/modules`, '-', '-o', binary], {input: test, encoding: 'utf8'});
process.stdout.write(compile.stdout ?? ''); process.stderr.write(compile.stderr ?? '');
assert.equal(compile.status, 0, 'production visibility policy compiles');
const run = spawnSync(binary, [], {encoding: 'utf8', timeout: 10000});
process.stdout.write(run.stdout ?? ''); process.stderr.write(run.stderr ?? '');
assert.equal(run.status, 0, 'production visibility policy behavior');
NODE
