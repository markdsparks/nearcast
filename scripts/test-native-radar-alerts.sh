#!/bin/bash
# Offline contracts and stubbed transport by default. --live adds one selected-
# point request to the app's existing NWS endpoint; never a national alert sweep.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d /private/tmp/nearcast-radar-alerts.XXXXXX)"
source_dir="$root/native/experiments/NativeRadarFoundation"
xcrun swiftc -O -swift-version 6 -module-cache-path "$test_dir/modules" \
  "$source_dir/NativeRadarAlertsContract.swift" \
  "$source_dir/NativeRadarAlertsClient.swift" \
  "$root/native/ios/NearcastApp/NativeWeather/NativeWeatherEssentials.swift" \
  "$root/scripts/native-radar-alerts-test.swift" \
  -o "$test_dir/alerts-tests"
"$test_dir/alerts-tests" "$@"
