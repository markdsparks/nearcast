#!/bin/bash
set -euo pipefail
PREVIEW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_TEST_DIR="$(mktemp -d /private/tmp/nearcast-radar-preview.XXXXXX)"
trap 'rm -rf "$PREVIEW_TEST_DIR"' EXIT
xcrun swiftc -swift-version 6 -module-cache-path "$PREVIEW_TEST_DIR/modules" \
  "$PREVIEW_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarPreviewModel.swift" \
  "$PREVIEW_ROOT/scripts/native-radar-preview-test.swift" -o "$PREVIEW_TEST_DIR/tests"
"$PREVIEW_TEST_DIR/tests"
