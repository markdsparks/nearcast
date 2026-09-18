#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-places.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURE_PATH=""
if [[ -f "$ROOT/scripts/native-places-migration-smoke.mjs" ]]; then
  FIXTURE_PATH="$TEST_ROOT/legacy-export.json"
  node "$ROOT/scripts/native-places-migration-smoke.mjs" --export-fixture > "$FIXTURE_PATH"
fi

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -strict-concurrency=complete \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesMigrationStore.swift" \
  "$ROOT/scripts/native-places-migration-test.swift" \
  -o "$TEST_ROOT/native-places-migration-test"

"$TEST_ROOT/native-places-migration-test" "$FIXTURE_PATH"
