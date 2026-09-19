#!/bin/bash
# I/O-free tests: no app/project changes, network, provider calls or publishing.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d /private/tmp/nearcast-radar-presentation.XXXXXX)"
source_dir="$root/native/experiments/NativeRadarFoundation"
xcrun swiftc -O -swift-version 6 -module-cache-path "$test_dir/modules" \
  "$source_dir/RadarNumericContract.swift" \
  "$source_dir/NativeRadarPresentationContract.swift" \
  "$root/scripts/native-radar-presentation-test.swift" \
  -o "$test_dir/presentation-tests"
"$test_dir/presentation-tests"
