#!/bin/bash
set -euo pipefail
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-transition.XXXXXX")"
trap 'rm -rf "$RADAR_TEST_ROOT"' EXIT
xcrun swiftc -O -swift-version 6 -module-cache-path "$RADAR_TEST_ROOT/ModuleCache" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarNumericContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarChunkContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/NativeRadarSeamEstimation.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/NativeRadarSeamGates.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/NativeRadarTransition.swift" \
  "$RADAR_ROOT/scripts/native-radar-transition-test.swift" -o "$RADAR_TEST_ROOT/transition-test"
"$RADAR_TEST_ROOT/transition-test" "$RADAR_ROOT"
