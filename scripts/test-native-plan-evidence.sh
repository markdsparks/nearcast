#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plan-evidence.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherEssentials.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeForecastRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeEssentialsRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanEvidence.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanWeatherRead.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanEvidenceModel.swift" \
  "$ROOT/scripts/native-plan-evidence-test.swift" \
  -o "$TEST_ROOT/native-plan-evidence-test"

"$TEST_ROOT/native-plan-evidence-test"

# The compact native Plan surface must not hide a failed refresh inside its
# details disclosure. A retained forecast can be useful, but it needs a
# visible, dated saved-data label before anyone relies on the headline.
PLANS_VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlansExperience.swift"
rg -q --fixed-strings 'if model.errorMessage != nil' "$PLANS_VIEW" || {
  printf 'FAIL Native plan evidence: saved-plan refresh failure is not visible in the compact detail\n' >&2
  exit 1
}
rg -q --fixed-strings 'Last available forecast · updated' "$PLANS_VIEW" || {
  printf 'FAIL Native plan evidence: compact saved-plan detail lacks source age disclosure\n' >&2
  exit 1
}
rg -q --fixed-strings 'nearcast.native.plan.saved-forecast' "$PLANS_VIEW" || {
  printf 'FAIL Native plan evidence: saved-plan forecast disclosure lacks a stable test identifier\n' >&2
  exit 1
}

printf 'PASS Native plan detail: retained forecast refresh state stays visible\n'
