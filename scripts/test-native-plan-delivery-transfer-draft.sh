#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plan-delivery-transfer-draft.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -strict-concurrency=complete \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLegacySourceScope.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesOwnerStore.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationIntentStore.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanDeliveryTransferDraft.swift" \
  "$ROOT/scripts/native-plan-delivery-transfer-draft-test.swift" \
  -o "$TEST_ROOT/native-plan-delivery-transfer-draft-test"

"$TEST_ROOT/native-plan-delivery-transfer-draft-test"

# P1 preparation is review-only. Keep it clear of delivery frameworks,
# permission/APNs calls, persistent credentials, and all network clients.
DRAFT_FILE="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanDeliveryTransferDraft.swift"
if rg -n \
  -e '^import (UserNotifications|WatchConnectivity|WidgetKit|Security|Network)$' \
  -e 'URLSession|URLRequest|NWConnection|NWPathMonitor' \
  -e 'requestAuthorization\(' \
  -e 'registerForRemoteNotifications\(' \
  -e 'SecItem|kSec|Keychain' \
  -e 'NativeNotificationRegistry' \
  -e 'NativeWatchSnapshotSync' \
  -e 'NativeSnapshotPublicationCoordinator' \
  -e 'NearcastNative' \
  "$DRAFT_FILE"; then
  echo "Native delivery transfer draft gained a delivery, credential, or remote dependency" >&2
  exit 1
fi
