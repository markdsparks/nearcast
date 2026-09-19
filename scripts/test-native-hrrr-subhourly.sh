#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d /private/tmp/nearcast-hrrr15.XXXXXX)"
src="$root/native/experiments/NativeRadarFoundation"
xcrun swiftc -O -swift-version 6 -module-cache-path "$test_dir/modules" \
 "$src/RadarNumericContract.swift" "$src/RadarChunkContract.swift" "$src/RadarChunkClient.swift" \
 "$src/HRRRZarrCodec.swift" "$src/HRRRZarrContract.swift" "$src/NativeRadarSeamEstimation.swift" \
 "$src/NativeRadarPresentationContract.swift" "$src/HRRRSubhourly.swift" \
 "$root/scripts/native-hrrr-subhourly-test.swift" -o "$test_dir/tests"
"$test_dir/tests" "$@"
