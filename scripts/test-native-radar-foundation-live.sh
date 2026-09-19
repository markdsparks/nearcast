#!/bin/bash
set -euo pipefail

# Never invoked by CI or deterministic test suites. Explicit opt-in is mandatory.
if [[ -n "${CI:-}" ]]; then
  printf '%s\n' 'This public-network probe must not run in CI.' >&2
  exit 64
fi
LIVE_REQUESTED=false
for PROBE_ARGUMENT in "$@"; do
  case "$PROBE_ARGUMENT" in
    --live) LIVE_REQUESTED=true ;;
    --tiles) ;;
    *) printf '%s\n' 'Usage: bash scripts/test-native-radar-foundation-live.sh --live [--tiles]' >&2; exit 64 ;;
  esac
done
if [[ "$LIVE_REQUESTED" != true ]]; then
  printf '%s\n' 'Explicit --live is required; optional --tiles checks one selected PNG per source.' >&2
  exit 64
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-live.XXXXXX")"
trap 'rm -rf "$PROBE_ROOT"' EXIT

xcrun swiftc -module-cache-path "$PROBE_ROOT/ModuleCache" \
  "$ROOT/native/experiments/RadarSubstrateProof/RadarProofContract.swift" \
  "$ROOT/native/experiments/NativeRadarFoundation/RadarTimelineContract.swift" \
  "$ROOT/scripts/native-radar-foundation-live-test.swift" \
  -o "$PROBE_ROOT/radar-foundation-live-test"

"$PROBE_ROOT/radar-foundation-live-test" "$@"
