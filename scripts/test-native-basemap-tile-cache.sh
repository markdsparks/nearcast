#!/bin/bash
set -euo pipefail
BASEMAP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASEMAP_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-basemap-tile-cache.XXXXXX")"
trap 'rm -rf "$BASEMAP_TEST_ROOT"' EXIT
xcrun swiftc -swift-version 6 -module-cache-path "$BASEMAP_TEST_ROOT/ModuleCache" \
  "$BASEMAP_ROOT/native/experiments/NativeRadarFoundation/NativeBasemapClient.swift" \
  "$BASEMAP_ROOT/scripts/native-basemap-tile-cache-test.swift" \
  -o "$BASEMAP_TEST_ROOT/native-basemap-tile-cache-test"
"$BASEMAP_TEST_ROOT/native-basemap-tile-cache-test"
