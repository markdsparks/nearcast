#!/bin/bash
set -euo pipefail

GLOBAL_RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GLOBAL_RADAR_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-global-radar.XXXXXX")"
trap 'rm -rf "$GLOBAL_RADAR_TEST_ROOT"' EXIT

xcrun swiftc -swift-version 6 -module-cache-path "$GLOBAL_RADAR_TEST_ROOT/ModuleCache" \
  "$GLOBAL_RADAR_ROOT/native/experiments/NativeRadarFoundation/NativeGlobalRadarContract.swift" \
  "$GLOBAL_RADAR_ROOT/native/experiments/NativeRadarFoundation/NativeGlobalRadarClient.swift" \
  "$GLOBAL_RADAR_ROOT/scripts/native-global-radar-test.swift" \
  -o "$GLOBAL_RADAR_TEST_ROOT/native-global-radar-test"
"$GLOBAL_RADAR_TEST_ROOT/native-global-radar-test"
