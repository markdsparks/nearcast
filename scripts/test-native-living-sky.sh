#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-living-sky.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeSunDaylight.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyScene.swift" \
  "$ROOT/scripts/native-living-sky-test.swift" \
  -o "$TEST_ROOT/native-living-sky-test"

"$TEST_ROOT/native-living-sky-test"
