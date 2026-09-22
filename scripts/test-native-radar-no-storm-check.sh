#!/bin/bash
set -euo pipefail

# Storm Check is parked, not a hidden production feature. Guard the whole live
# path so removing its button cannot leave map-tap interception, a second MRMS
# download task, or user-facing instructions behind. Its isolated experiment
# and algorithm tests can remain for future work.
RADAR_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RADAR_VIEW="$RADAR_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarView.swift"
RADAR_MODEL="$RADAR_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarModel.swift"
RADAR_MAP="$RADAR_ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarMap.swift"

fail() {
  printf 'FAIL Native radar without Storm Check: %s\n' "$1" >&2
  exit 1
}

if rg -ni 'storm.?check|checkingStorm|selectingStorm|checkStorm' \
  "$RADAR_VIEW" "$RADAR_MODEL" "$RADAR_MAP"; then
  fail 'production radar must not expose or run the parked precipitation-check capability'
fi

rg -q --fixed-strings 'enhancementEnabled = true' "$RADAR_MODEL" || \
  fail 'Nearcast radar enhancement must remain enabled by default'
rg -q --fixed-strings 'Toggle("Radar-guided forecast"' "$RADAR_VIEW" || \
  fail 'the independent radar-guided forecast control must remain available'
rg -q --fixed-strings 'Label("Alerts", systemImage: "exclamationmark.triangle")' "$RADAR_VIEW" || \
  fail 'official alerts must remain discoverable'
rg -q --fixed-strings 'input.onAlert(id)' "$RADAR_MAP" || \
  fail 'tapping official alert geometry must still open the bulletin'
rg -q --fixed-strings 'input.onPlace(place)' "$RADAR_MAP" || \
  fail 'saved-place markers must retain their actions'
rg -q --fixed-strings 'StormScope and observed lightning are not connected in this native build.' "$RADAR_VIEW" || \
  fail 'the independent Xweather limitation must remain honest'

printf 'PASS Native radar: Storm Check removed; enhancements, alerts, and places retained\n'
