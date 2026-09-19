#!/bin/bash
set -euo pipefail
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-mrms.XXXXXX")"
trap 'rm -rf "$RADAR_TEST_ROOT"' EXIT
node "$RADAR_ROOT/scripts/native-mrms-fixtures.mjs" --check
xcrun swiftc -O -swift-version 6 -module-cache-path "$RADAR_TEST_ROOT/ModuleCache" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarNumericContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarChunkContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarChunkClient.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/MRMSContract.swift" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/MRMSClient.swift" \
  "$RADAR_ROOT/scripts/native-mrms-test.swift" -o "$RADAR_TEST_ROOT/mrms-test"
"$RADAR_TEST_ROOT/mrms-test" "$RADAR_ROOT" "$@"
