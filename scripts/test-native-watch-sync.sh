#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-watch-sync.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Compile the production sender unchanged against a deterministic transport.
# No simulator, signing, network request, or paired device is involved.
xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -emit-module -emit-library -module-name WatchConnectivity \
  "$TASK_ROOT/scripts/native-watch-sync-transport.swift" \
  -emit-module-path "$TEST_ROOT/WatchConnectivity.swiftmodule" \
  -o "$TEST_ROOT/libWatchConnectivity.dylib"

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -I "$TEST_ROOT" -L "$TEST_ROOT" -lWatchConnectivity \
  -Xlinker -rpath -Xlinker "$TEST_ROOT" \
  "$TASK_ROOT/native/ios/Shared/NearcastWidgetSnapshot.swift" \
  "$TASK_ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$TASK_ROOT/native/ios/NearcastApp/Bridge/NativeWatchSnapshotSync.swift" \
  "$TASK_ROOT/scripts/native-watch-sync-test.swift" \
  -o "$TEST_ROOT/native-watch-sync-test"

"$TEST_ROOT/native-watch-sync-test"
