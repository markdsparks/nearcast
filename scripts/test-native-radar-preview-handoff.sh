#!/bin/bash
set -euo pipefail
PREVIEW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREVIEW_TEST="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-preview-handoff.XXXXXX")"
trap 'rm -rf "$PREVIEW_TEST"' EXIT
xcrun swiftc -swift-version 6 -parse-as-library -module-cache-path "$PREVIEW_TEST/modules" \
  "$PREVIEW_ROOT/native/experiments/NativeRadarFoundation/NativeRadarFreshnessPolicy.swift" \
  "$PREVIEW_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarOpeningContext.swift" \
  "$PREVIEW_ROOT/scripts/native-radar-preview-handoff-test.swift" -o "$PREVIEW_TEST/test"
"$PREVIEW_TEST/test"
