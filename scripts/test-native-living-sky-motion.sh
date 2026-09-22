#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-living-sky-motion.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyMotion.swift" \
  "$ROOT/scripts/native-living-sky-motion-test.swift" \
  -o "$TEST_ROOT/native-living-sky-motion-test"

"$TEST_ROOT/native-living-sky-motion-test"
