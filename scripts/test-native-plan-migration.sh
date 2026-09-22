#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plans.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc \
  -module-cache-path "$TEST_ROOT/ModuleCache" \
  -strict-concurrency=complete \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanMigrationStore.swift" \
  "$ROOT/scripts/native-plan-migration-test.swift" \
  -o "$TEST_ROOT/native-plan-migration-test"

"$TEST_ROOT/native-plan-migration-test"
