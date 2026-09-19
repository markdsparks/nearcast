#!/bin/bash
set -euo pipefail
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-chunks.XXXXXX")"
trap 'rm -rf "$RADAR_TEST_ROOT"' EXIT
node "$RADAR_ROOT/scripts/native-radar-chunk-fixtures.mjs" --check
xcrun swiftc -swift-version 6 -module-cache-path "$RADAR_TEST_ROOT/ModuleCache" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarNumericContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarChunkContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarChunkClient.swift" \
  "$RADAR_ROOT/scripts/native-radar-chunk-test.swift" -o "$RADAR_TEST_ROOT/chunk-test"
"$RADAR_TEST_ROOT/chunk-test" "$RADAR_ROOT"
