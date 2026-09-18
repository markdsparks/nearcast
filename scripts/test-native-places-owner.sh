#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-owner.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -swift-version 6 \
  -strict-concurrency=complete \
  "$TASK_ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$TASK_ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$TASK_ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesOwnerStore.swift" \
  "$TASK_ROOT/scripts/native-places-owner-test.swift" \
  -o "$TEST_ROOT/native-places-owner-test"

"$TEST_ROOT/native-places-owner-test"
