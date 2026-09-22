#!/bin/bash
set -euo pipefail

RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_VIEW="$RADAR_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarView.swift"

node --input-type=module - "$RADAR_VIEW" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const view = fs.readFileSync(process.argv[2], 'utf8');
const block = (start, end) => view.slice(view.indexOf(start), view.indexOf(end, view.indexOf(start)));
const body = block('var body: some View', 'private var hasRelevantAlerts');
const timeline = block('private var timeline: some View', 'private var playbackControl');
const info = block('private var information: some View', 'private var alertInformation');
assert(body.includes('header') && body.includes('alertChip') && body.includes('recenterControl'));
assert(!body.includes('mapTools'), 'no permanent legend and tools stack over the map');
assert(view.includes('if hasRelevantAlerts || needsAlertAttention'), 'relevant alerts/failures remain prominent');
assert(view.includes('$0.snapshot.quality != .verified'), 'incomplete area coverage is not silently treated as clear');
assert(info.includes('Label("Alerts",'), 'all official alerts remain accessible in tools');
assert(info.includes('Show my location'), 'location control remains discoverable');
assert(view.includes('private var legendControl') && view.includes('showingLegend = true'));
assert(view.includes('sheet(isPresented: $showingLegend)'), 'full legend is a deliberate disclosure');
assert(timeline.includes('legendControl') && timeline.includes('credits'), 'scale and attribution stay available');
assert(!view.includes('model.pendingTimeLabel ?? " "'), 'no empty reserved loading row');
assert(!timeline.includes('NativeRadarContinuityTrace('), 'one scrub track, not duplicated rails');
assert(view.includes('Text(model.displayedTimeLabel)') && view.includes('Text(model.displayedSourceLabel)'), 'visible weather keeps its actual time/source');
assert(view.includes('if let pending = model.pendingTimeLabel'), 'pending frame is distinguished from visible frame');
assert(view.includes('.tint(.cyan).frame(minHeight: 44)'), 'continuous scrubber keeps an accessible hit target');
assert(view.includes('accessibilityAdjustableAction'), 'VoiceOver retains timeline adjustment');
assert(view.includes('ViewThatFits(in: .horizontal)'), 'credits fit narrow and large-text layouts');
assert(view.includes('dynamicTypeSize.isAccessibilitySize'), 'larger controls have a roomy accessible layout');
console.log('PASS native compact radar controls: progressive disclosure, visible evidence, alerts, credits and accessible scrubber');
NODE
