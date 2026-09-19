#!/bin/bash
set -euo pipefail

SATELLITE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SATELLITE_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-satellite.XXXXXX")"
trap 'rm -rf "$SATELLITE_TEST_ROOT"' EXIT

xcrun swiftc -swift-version 6 -module-cache-path "$SATELLITE_TEST_ROOT/ModuleCache" \
  "$SATELLITE_ROOT/native/experiments/NativeRadarFoundation/NativeSatelliteContract.swift" \
  "$SATELLITE_ROOT/native/experiments/NativeRadarFoundation/NativeSatelliteClient.swift" \
  "$SATELLITE_ROOT/scripts/native-satellite-test.swift" \
  -o "$SATELLITE_TEST_ROOT/native-satellite-test"
"$SATELLITE_TEST_ROOT/native-satellite-test"
