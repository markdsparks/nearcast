#!/bin/bash
set -euo pipefail
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-freshness.XXXXXX")"
trap 'rm -rf "$RADAR_TEST_ROOT"' EXIT
xcrun swiftc -swift-version 6 -module-cache-path "$RADAR_TEST_ROOT/ModuleCache" \
  "$RADAR_ROOT/native/experiments/NativeRadarFoundation/NativeRadarFreshnessPolicy.swift" \
  "$RADAR_ROOT/scripts/native-radar-freshness-test.swift" -o "$RADAR_TEST_ROOT/freshness-test"
"$RADAR_TEST_ROOT/freshness-test"
