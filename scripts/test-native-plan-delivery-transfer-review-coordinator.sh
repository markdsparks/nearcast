#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plan-delivery-transfer-review.XXXXXX")"
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
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanDeliveryTransferReviewCoordinator.swift" \
  "$ROOT/scripts/native-plan-delivery-transfer-review-coordinator-test.swift" \
  -o "$TEST_ROOT/native-plan-delivery-transfer-review-coordinator-test"

"$TEST_ROOT/native-plan-delivery-transfer-review-coordinator-test"

# This coordinator has a stronger boundary than a typical model: opening a
# review must not create a lock/directory, change receipt protection, contact
# a service, request notification permission, or wake compatibility/native UI.
REVIEW_FILE="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanDeliveryTransferReviewCoordinator.swift"
if rg -n \
  -e '^import (UserNotifications|WatchConnectivity|WidgetKit|Security|Network|FoundationNetworking|WebKit|SwiftUI|UIKit)$' \
  -e 'URLSession|URLRequest|NWConnection|NWPathMonitor' \
  -e 'requestAuthorization\(' \
  -e 'registerForRemoteNotifications\(' \
  -e 'SecItem|kSec|Keychain' \
  -e 'NativeNotificationRegistry|NativeWatchSnapshotSync|NativeSnapshotPublicationCoordinator' \
  -e 'NativePlanNotificationIntentStagingCoordinator|NativePlanMigrationStore|NativeAgendaStore' \
  -e 'stageVerifiedLegacyExport|revokeStagedIntent|handoffVerifiedLegacyAgenda' \
  -e 'createNativePlaces|acknowledgeDeletions' \
  -e '\b(save|delete|perform|activate)\(' \
  -e 'FileManager|URLResourceValues|setAttributes|createDirectory|atomicWrite|withStoreLock' \
  -e 'O_CREAT|O_WRONLY|O_RDWR|flock\(|rename\(|\.write\(' \
  "$REVIEW_FILE"; then
  echo "Native delivery transfer review gained a forbidden dependency or mutable path" >&2
  exit 1
fi
