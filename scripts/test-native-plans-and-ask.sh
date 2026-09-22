#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plans-ask.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLegacySourceScope.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherOutlook.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeForecastRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlaceLookupService.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskRead.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskConversation.swift" \
  "$ROOT/scripts/native-plans-and-ask-test.swift" -o "$TEST_ROOT/tests"
"$TEST_ROOT/tests" "$TEST_ROOT"
