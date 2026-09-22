#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-sky-stars.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeSkyStars.swift" \
  "$ROOT/scripts/native-sky-stars-test.swift" \
  -o "$TEST_ROOT/native-sky-stars-test"

"$TEST_ROOT/native-sky-stars-test"
