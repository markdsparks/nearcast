#!/bin/bash
set -euo pipefail
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_BENCH="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-render-benchmark.XXXXXX")"
trap 'rm -rf "$RADAR_BENCH"' EXIT
for mode in debug optimized; do
  optimization=-Onone
  if [[ "$mode" == optimized ]]; then optimization=-O; fi
  xcrun swiftc "$optimization" -module-cache-path "$RADAR_BENCH/ModuleCache" \
    "$RADAR_ROOT/native/experiments/NativeRadarFoundation/RadarNumericContract.swift" \
    "$RADAR_ROOT/scripts/native-radar-render-benchmark.swift" -o "$RADAR_BENCH/$mode"
  printf '%s\n' "$mode synthetic CPU coloring stage:"
  "$RADAR_BENCH/$mode" | tee "$RADAR_BENCH/$mode.log"
done
diff <(rg '^checksum=' "$RADAR_BENCH/debug.log") <(rg '^checksum=' "$RADAR_BENCH/optimized.log")
printf 'PASS optimized and Debug renderer outputs match; timings are local CPU stages, not device/map latency.\n'
