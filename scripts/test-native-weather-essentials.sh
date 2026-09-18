#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-essentials.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherEssentials.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeEssentialsRepository.swift" \
  "$ROOT/scripts/native-weather-essentials-test.swift" \
  -o "$TEST_ROOT/native-weather-essentials-test"

"$TEST_ROOT/native-weather-essentials-test"
