#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/nearcast-watch-snapshot-test"

mkdir -p "$WORK"
cp "$ROOT/scripts/nearcast-watch-snapshot-test.swift" "$WORK/main.swift"

xcrun swiftc \
  -module-cache-path "$WORK/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastWidgetSnapshot.swift" \
  "$ROOT/native/ios/Shared/NearcastWatchVisualSignal.swift" \
  "$WORK/main.swift" \
  -o "$WORK/nearcast-watch-snapshot-test"

"$WORK/nearcast-watch-snapshot-test"

xcrun swiftc \
  -module-cache-path "$WORK/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastSharedForecast.swift" \
  "$ROOT/scripts/nearcast-native-shared-forecast-test.swift" \
  -o "$WORK/nearcast-native-shared-forecast-test"

"$WORK/nearcast-native-shared-forecast-test"
