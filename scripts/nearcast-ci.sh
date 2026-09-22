#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-portable}"

run_portable_checks() {
  printf 'Checking production JavaScript entry points...\n'
  local source
  for source in \
    app.js \
    native-places-migration.js \
    native-places-controls.js \
    native-places-owner.js \
    planner.js \
    weather-truth.js \
    current-reality.js \
    shared-forecast.js \
    forecast-confidence.js \
    map.js \
    sky.js \
    daygraph.js \
    boot.js \
    ai.js \
    operon-runtime.js \
    vendor/operon/driver.js \
    sw.js \
    raw-map-runtime.js \
    radar-seam-engine.js \
    workers/plan-watch-ownership.mjs \
    workers/radar-capability.mjs \
    workers/shared-forecast-service.mjs \
    workers/radar-generation-consumer.mjs
  do
    node --check "$ROOT/$source"
  done

  printf 'Running portable product, weather-truth, delivery, map, and freshness smokes...\n'
  local smoke
  for smoke in \
    weather-truth-fixtures.mjs \
    plan-watch-receipt-smoke.mjs \
    plan-watch-ownership-test.mjs \
    material-event-surfaces-smoke.mjs \
    product-activation-smoke.mjs \
    ai-operon-smoke.mjs \
    ai-conversation-reliability-smoke.mjs \
    ai-day-followup-smoke.mjs \
    trust-loop-smoke.mjs \
    trust-loop-backend-smoke.mjs \
    trust-loop-report-smoke.mjs \
    hourly-alert-detail-smoke.mjs \
    alert-geometry-smoke.mjs \
    hourly-precip-graph-smoke.mjs \
    precipitation-outlook-smoke.mjs \
    hourly-hero-label-smoke.mjs \
    hourly-row-layout-smoke.mjs \
    daily-row-layout-smoke.mjs \
    day-detail-truth-smoke.mjs \
    interaction-gesture-smoke.mjs \
    reactive-sky-smoke.mjs \
    map-location-smoke.mjs \
    carto-basemap-smoke.mjs \
    map-aerial-smoke.mjs \
    map-satellite-smoke.mjs \
    map-trust-experience-smoke.mjs \
    forecast-journey-map-smoke.mjs \
    map-radar-experience-smoke.mjs \
    radar-capability-smoke.mjs \
    native-plan-notification-owner-test.mjs \
    live-activity-smoke.mjs \
    radar-generation-consumer-smoke.mjs \
    radar-generation-plan-queue-smoke.mjs \
    raw-map-runtime-smoke.mjs \
    radar-seam-engine-smoke.mjs \
    raw-map-seam-integration-smoke.mjs \
    raw-map-canonical-timeline-smoke.mjs \
    raw-map-timeline-controls-smoke.mjs \
    watch-basics-smoke.mjs \
    watch-complication-copy-layout-smoke.mjs \
    forecast-pulse-smoke.mjs \
    forecast-truth-contract-smoke.mjs \
    forecast-confidence-contract-smoke.mjs \
    forecast-disclosure-contract-smoke.mjs \
    forecast-confidence-integration-smoke.mjs \
    current-reality-smoke.mjs \
    shared-forecast-smoke.mjs \
    shared-forecast-service-smoke.mjs \
    shared-forecast-integration-smoke.mjs \
    current-reality-worker-smoke.mjs \
    current-reality-ui-smoke.mjs \
    family-places-smoke.mjs \
    first-look-home-smoke.mjs \
    weather-essentials-smoke.mjs \
    weather-details-smoke.mjs \
    day-overview-smoke.mjs \
    nearcast-brief-smoke.mjs \
    settings-onboarding-smoke.mjs \
    native-preview-handoff-smoke.mjs \
    native-places-migration-smoke.mjs \
    native-places-migration-bridge-smoke.mjs \
    native-places-controls-smoke.mjs \
    native-places-owner-smoke.mjs \
    native-places-owner-bootstrap-smoke.mjs \
    nearcast-place-label-test.mjs
  do
    node "$ROOT/scripts/$smoke"
  done

  node "$ROOT/scripts/forecast-truth-regression-smoke.mjs" --strict

  printf 'PASS  Portable Nearcast production checks\n'
}

run_native_model_checks() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    printf 'FAIL  Native model checks require macOS and Xcode.\n' >&2
    exit 1
  fi
  bash "$ROOT/scripts/test-native-dev-cutover-configuration.sh"
  bash "$ROOT/scripts/test-native-dev-performance-configuration.sh"
  bash "$ROOT/scripts/test-native-release-cutover-gate.sh"
  "$ROOT/scripts/test-nearcast-watch-snapshot.sh"
  bash "$ROOT/scripts/test-native-watch-sync.sh"
  bash "$ROOT/scripts/test-native-watch-receiver.sh"
  bash "$ROOT/scripts/test-native-complication-timeline.sh"
  bash "$ROOT/scripts/test-native-weather-forecast.sh"
  bash "$ROOT/scripts/test-native-weather-preview.sh"
  bash "$ROOT/scripts/test-native-weather-outlook.sh"
  bash "$ROOT/scripts/test-native-day-rhythm.sh"
  bash "$ROOT/scripts/test-native-day-rhythm-view-contract.sh"
  bash "$ROOT/scripts/test-native-weather-essentials.sh"
  bash "$ROOT/scripts/test-native-essentials-model.sh"
  bash "$ROOT/scripts/test-native-sun-daylight.sh"
  bash "$ROOT/scripts/test-native-weather-detail.sh"
  bash "$ROOT/scripts/test-native-radar-proof.sh"
  bash "$ROOT/scripts/test-native-radar-timeline.sh"
  bash "$ROOT/scripts/test-native-radar-numeric.sh"
  bash "$ROOT/scripts/test-native-radar-chunks.sh"
  bash "$ROOT/scripts/test-native-mrms.sh"
  bash "$ROOT/scripts/hrrr-native-contract-smoke.sh"
  bash "$ROOT/scripts/test-native-radar-presentation.sh"
  bash "$ROOT/scripts/test-native-hrrr-subhourly.sh"
  bash "$ROOT/scripts/test-native-radar-freshness.sh"
  bash "$ROOT/scripts/test-native-radar-cache.sh"
  bash "$ROOT/scripts/test-native-radar-visible-coverage.sh"
  bash "$ROOT/scripts/test-native-radar-model-pipeline.sh"
  bash "$ROOT/scripts/test-native-radar-playback.sh"
  bash "$ROOT/scripts/test-native-radar-observed-repository.sh"
  bash "$ROOT/scripts/test-native-radar-preview-handoff.sh"
  bash "$ROOT/scripts/test-native-radar-preview.sh"
  bash "$ROOT/scripts/test-native-radar-preview-lifecycle.sh"
  bash "$ROOT/scripts/test-native-radar-preview-snapshot.sh"
  bash "$ROOT/scripts/test-native-radar-preview-card.sh"
  bash "$ROOT/scripts/test-native-basemap-client.sh"
  bash "$ROOT/scripts/test-native-basemap-tile-cache.sh"
  bash "$ROOT/scripts/test-native-global-radar.sh"
  bash "$ROOT/scripts/test-native-satellite.sh"
  bash "$ROOT/scripts/test-native-radar-alerts.sh"
  bash "$ROOT/scripts/test-native-radar-alert-focus.sh"
  bash "$ROOT/scripts/test-native-radar-no-storm-check.sh"
  bash "$ROOT/scripts/test-native-radar-compact-controls.sh"
  bash "$ROOT/scripts/test-native-radar-seam.sh"
  bash "$ROOT/scripts/test-native-radar-transition.sh"
  bash "$ROOT/scripts/test-native-xweather.sh"
  bash "$ROOT/scripts/test-native-places-migration.sh"
  bash "$ROOT/scripts/test-native-places-controls.sh"
  bash "$ROOT/scripts/test-native-place-lookup.sh"
  bash "$ROOT/scripts/test-native-places-owner.sh"
  # These protect the native-only Dev journey itself.  Keep them in the
  # shared native gate rather than treating a successful model build as proof
  # that a person cannot fall through into the compatibility host.
  bash "$ROOT/scripts/test-native-nativeonly-host-boundary.sh"
  bash "$ROOT/scripts/test-native-nativeonly-places-contract.sh"
  bash "$ROOT/scripts/test-native-app-router.sh"
  bash "$ROOT/scripts/test-native-deep-link-router.sh"
  bash "$ROOT/scripts/test-native-notification-route.sh"
  bash "$ROOT/scripts/test-native-nativeonly-routing-contract.sh"
  bash "$ROOT/scripts/test-native-nativeonly-map-failure-contract.sh"
  bash "$ROOT/scripts/test-native-agenda-repository.sh"
  bash "$ROOT/scripts/test-native-plan-migration.sh"
  # P0 keeps legacy as the only delivery owner, but it must prove the local
  # receipt can wait for later native Plan/Places verification without losing
  # selection or opt-out semantics.
  bash "$ROOT/scripts/test-native-plan-notification-intent.sh"
  # P1 preparation is intentionally a pure review model. It must continue to
  # reject stale mappings without adding a second delivery owner.
  bash "$ROOT/scripts/test-native-plan-delivery-transfer-draft.sh"
  # The review coordinator is descriptor-read-only: a user opening a future
  # transfer review must not create P0 state or cross Local/Production scope.
  bash "$ROOT/scripts/test-native-plan-delivery-transfer-review-coordinator.sh"
  bash "$ROOT/scripts/test-native-plan-handoff.sh"
  bash "$ROOT/scripts/test-native-plan-evidence.sh"
  bash "$ROOT/scripts/test-native-plans-and-ask.sh"
  bash "$ROOT/scripts/test-native-ask-offline.sh"
  bash "$ROOT/scripts/test-native-plan-notifications.sh"
  bash "$ROOT/scripts/test-native-companion-content.sh"
  bash "$ROOT/scripts/test-native-storm-check.sh"
  bash "$ROOT/scripts/test-native-plan-route-focus.sh"
  bash "$ROOT/scripts/test-native-ask-read.sh"
  # Living Sky's scene choice and its motion clock are pure native contracts.
  # Keep both deterministic suites in the shared native gate: a simulator
  # build alone cannot prove that a weather refresh will keep the same scene
  # or that decorative motion obeys its pause/reset rules.
  bash "$ROOT/scripts/test-native-living-sky.sh"
  bash "$ROOT/scripts/test-native-living-sky-motion.sh"
  bash "$ROOT/scripts/test-native-sky-stars.sh"
  node "$ROOT/scripts/test-native-living-sky-lifecycle.mjs"
  bash "$ROOT/scripts/test-native-snapshot-publication.sh"
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
