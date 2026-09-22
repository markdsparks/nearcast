#!/bin/bash
set -euo pipefail
STORM_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORM_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-storm-check.XXXXXX")"
trap 'rm -rf "$STORM_TEST_ROOT"' EXIT
xcrun swiftc -O -swift-version 6 -module-cache-path "$STORM_TEST_ROOT/ModuleCache" \
  "$STORM_ROOT/native/experiments/NativeRadarFoundation/RadarNumericContract.swift" \
  "$STORM_ROOT/native/experiments/NativeRadarFoundation/RadarChunkContract.swift" \
  "$STORM_ROOT/native/experiments/NativeRadarFoundation/NativeRadarSeamEstimation.swift" \
  "$STORM_ROOT/native/experiments/NativeRadarFoundation/NativeStormCheck.swift" \
  "$STORM_ROOT/scripts/native-storm-check-test.swift" -o "$STORM_TEST_ROOT/storm-check-test"
"$STORM_TEST_ROOT/storm-check-test"
