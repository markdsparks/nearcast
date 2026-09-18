#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-publication.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -swift-version 6 \
  -strict-concurrency=complete \
  "$ROOT/native/ios/Shared/NearcastWidgetSnapshot.swift" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/Bridge/NativeSnapshotPublicationCoordinator.swift" \
  "$ROOT/scripts/native-snapshot-publication-test.swift" \
  -o "$TEST_ROOT/native-snapshot-publication-test"

"$TEST_ROOT/native-snapshot-publication-test"
