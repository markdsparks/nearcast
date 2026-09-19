#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-timeline.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/experiments/RadarSubstrateProof/RadarProofContract.swift" \
  "$ROOT/native/experiments/NativeRadarFoundation/RadarTimelineContract.swift" \
  "$ROOT/scripts/native-radar-timeline-test.swift" \
  -o "$TEST_ROOT/radar-timeline-test"

"$TEST_ROOT/radar-timeline-test"
