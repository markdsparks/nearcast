#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-companions.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" -swift-version 6 -strict-concurrency=complete \
  "$ROOT/native/ios/Shared/NearcastWidgetSnapshot.swift" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherEssentials.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanEvidence.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanWeatherRead.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeCompanionContent.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLiveActivityControls.swift" \
  "$ROOT/native/ios/NearcastApp/Bridge/NativeSnapshotPublicationCoordinator.swift" \
  "$ROOT/scripts/native-companion-content-test.swift" \
  -o "$TEST_ROOT/native-companion-content-test"
"$TEST_ROOT/native-companion-content-test"
