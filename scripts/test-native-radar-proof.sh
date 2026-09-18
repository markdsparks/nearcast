#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/experiments/RadarSubstrateProof/RadarProofContract.swift" \
  "$ROOT/scripts/native-radar-proof-test.swift" -o "$TEST_ROOT/radar-test"
"$TEST_ROOT/radar-test" "$@"
