#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plan-notification-intent.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -strict-concurrency=complete \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLegacySourceScope.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanMigrationStore.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesOwnerStore.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationIntentStore.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationIntentStagingCoordinator.swift" \
  "$ROOT/scripts/native-plan-notification-intent-test.swift" \
  -o "$TEST_ROOT/native-plan-notification-intent-test"

"$TEST_ROOT/native-plan-notification-intent-test"

# P0 is deliberately local-only. Keep delivery frameworks and direct remote
# operations out of the stage writer; the Swift behavior test above covers the
# receipt itself, while this guard keeps a future convenience import from
# quietly turning it into a notification client.
P0_FILES=(
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationIntentStore.swift"
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationIntentStagingCoordinator.swift"
)
if rg -n \
  -e '^import (UserNotifications|WatchConnectivity|WidgetKit)$' \
  -e 'URLSession\(' \
  -e 'requestAuthorization\(' \
  -e 'registerForRemoteNotifications\(' \
  -e 'NativeNotificationRegistry' \
  -e 'NativeWatchSnapshotSync' \
  -e 'NativeSnapshotPublicationCoordinator' \
  -e 'NearcastNative' \
  "${P0_FILES[@]}"; then
  echo "P0 notification intent staging gained a delivery or remote dependency" >&2
  exit 1
fi
