#!/bin/bash
set -euo pipefail
XWEATHER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
XWEATHER_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-xweather.XXXXXX")"
trap 'rm -rf "$XWEATHER_TEST_ROOT"' EXIT
xcrun swiftc -swift-version 6 -module-cache-path "$XWEATHER_TEST_ROOT/ModuleCache" \
  "$XWEATHER_ROOT/native/experiments/NativeRadarFoundation/NativeXweatherContract.swift" \
  "$XWEATHER_ROOT/native/experiments/NativeRadarFoundation/NativeXweatherClient.swift" \
  "$XWEATHER_ROOT/scripts/native-xweather-test.swift" \
  -o "$XWEATHER_TEST_ROOT/native-xweather-test"
"$XWEATHER_TEST_ROOT/native-xweather-test"
