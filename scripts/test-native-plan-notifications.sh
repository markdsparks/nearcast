#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-notifications.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" -swift-version 6 -strict-concurrency=complete \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLegacySourceScope.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationContract.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotifications.swift" \
  "$ROOT/scripts/native-plan-notifications-test.swift" \
  -o "$TEST_ROOT/tests"
"$TEST_ROOT/tests" "$TEST_ROOT"
