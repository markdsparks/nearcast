#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-portable}"

run_portable_checks() {
  printf 'Checking production JavaScript entry points...\n'
  local source
  for source in \
    app.js \
    planner.js \
    weather-truth.js \
    map.js \
    sky.js \
    daygraph.js \
    boot.js \
    ai.js \
    sw.js \
    raw-map-runtime.js \
    workers/radar-capability.mjs \
    workers/radar-generation-consumer.mjs
  do
    node --check "$ROOT/$source"
  done

  printf 'Running portable product, weather-truth, delivery, map, and freshness smokes...\n'
  local smoke
  for smoke in \
    weather-truth-fixtures.mjs \
    plan-watch-receipt-smoke.mjs \
    product-activation-smoke.mjs \
    trust-loop-smoke.mjs \
    trust-loop-backend-smoke.mjs \
    trust-loop-report-smoke.mjs \
    hourly-alert-detail-smoke.mjs \
    hourly-precip-graph-smoke.mjs \
    hourly-row-layout-smoke.mjs \
    interaction-gesture-smoke.mjs \
    reactive-sky-smoke.mjs \
    map-location-smoke.mjs \
    map-aerial-smoke.mjs \
    map-satellite-smoke.mjs \
    map-radar-experience-smoke.mjs \
    radar-capability-smoke.mjs \
    live-activity-smoke.mjs \
    radar-generation-consumer-smoke.mjs \
    radar-generation-plan-queue-smoke.mjs \
    raw-map-runtime-smoke.mjs \
    raw-map-canonical-timeline-smoke.mjs \
    raw-map-timeline-controls-smoke.mjs \
    watch-basics-smoke.mjs \
    nearcast-place-label-test.mjs
  do
    node "$ROOT/scripts/$smoke"
  done

  printf 'PASS  Portable Nearcast production checks\n'
}

run_native_model_checks() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    printf 'FAIL  Native model checks require macOS and Xcode.\n' >&2
    exit 1
  fi
  "$ROOT/scripts/test-nearcast-watch-snapshot.sh"
  printf 'PASS  Native shared-model checks\n'
}

case "$MODE" in
  portable)
    run_portable_checks
    ;;
  native-model)
    run_native_model_checks
    ;;
  all)
    run_portable_checks
    run_native_model_checks
    ;;
  *)
    printf 'Usage: scripts/nearcast-ci.sh [portable|native-model|all]\n' >&2
    exit 2
    ;;
esac
