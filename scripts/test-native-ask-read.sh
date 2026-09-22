#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-ask-read.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherOutlook.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskRead.swift" \
  "$ROOT/scripts/native-ask-read-test.swift" \
  -o "$TEST_ROOT/native-ask-read-test"

"$TEST_ROOT/native-ask-read-test"
