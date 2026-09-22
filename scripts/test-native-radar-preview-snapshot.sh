#!/bin/bash
set -euo pipefail
SNAPSHOT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAPSHOT_TEST_DIR="$(mktemp -d /private/tmp/nearcast-radar-snapshot.XXXXXX)"
trap 'rm -rf "$SNAPSHOT_TEST_DIR"' EXIT
xcrun swiftc -swift-version 6 -module-cache-path "$SNAPSHOT_TEST_DIR/modules" \
  "$SNAPSHOT_ROOT/native/experiments/NativeRadarFoundation/NativeBasemapNetwork.swift" \
  "$SNAPSHOT_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarPreviewSnapshotter.swift" \
  "$SNAPSHOT_ROOT/scripts/native-radar-preview-snapshot-test.swift" -o "$SNAPSHOT_TEST_DIR/tests"
"$SNAPSHOT_TEST_DIR/tests"
