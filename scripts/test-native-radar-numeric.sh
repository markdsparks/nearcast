#!/bin/bash
set -euo pipefail
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-numeric.XXXXXX")"
trap 'rm -rf "$RADAR_TEST_ROOT"' EXIT
node "$RADAR_ROOT/scripts/native-radar-numeric-fixtures.mjs" --check
if command -v swiftc >/dev/null 2>&1; then
  RADAR_SWIFTC="$(command -v swiftc)"
else
  RADAR_SWIFTC="$(xcrun --find swiftc)"
fi
"$RADAR_SWIFTC" -module-cache-path "$RADAR_TEST_ROOT/ModuleCache" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarNumericContract.swift" \
  "$RADAR_ROOT/scripts/native-radar-numeric-test.swift" \
  -o "$RADAR_TEST_ROOT/radar-numeric-test"
"$RADAR_TEST_ROOT/radar-numeric-test" "$RADAR_ROOT/scripts/fixtures/native-radar/numeric-contract.json"
