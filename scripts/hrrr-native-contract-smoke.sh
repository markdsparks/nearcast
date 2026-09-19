#!/bin/bash
# Standalone HRRR reader tests; does not edit a project, run an app, or publish.
# Pass --live to add a bounded read-only request to the existing NOAA bucket.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d /private/tmp/nearcast-hrrr-test.XXXXXX)"
source_dir="$root/native/experiments/NativeRadarFoundation"
xcrun swiftc -O -module-cache-path "$test_dir/modules" \
  "$source_dir/RadarNumericContract.swift" \
  "$source_dir/RadarChunkContract.swift" \
  "$source_dir/RadarChunkClient.swift" \
  "$source_dir/HRRRZarrCodec.swift" \
  "$source_dir/HRRRZarrContract.swift" \
  "$source_dir/HRRRZarrClient.swift" \
  "$source_dir/HRRRZarrTests.swift" \
  -o "$test_dir/hrrr-tests"
"$test_dir/hrrr-tests" "$@"
