#!/bin/bash
set -euo pipefail

CACHE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-radar-cache.XXXXXX")"
trap 'rm -rf "$CACHE_TEST_ROOT"' EXIT

xcrun swiftc -swift-version 6 -module-cache-path "$CACHE_TEST_ROOT/ModuleCache" \
  "$CACHE_ROOT/native/experiments/NativeRadarFoundation/NativeRadarFrameCachePolicy.swift" \
  "$CACHE_ROOT/scripts/native-radar-cache-test.swift" \
  -o "$CACHE_TEST_ROOT/native-radar-cache-test"
"$CACHE_TEST_ROOT/native-radar-cache-test"
