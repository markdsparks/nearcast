#!/bin/bash
set -euo pipefail

# Native-only Dev is meaningful only if the legacy WebKit host cannot be
# instantiated behind a normal native route. Keep its one retained use
# explicit, bounded, and user-confirmed at the app root.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="$ROOT/native/ios/NearcastApp/Models/NearcastWebModel.swift"
APP="$ROOT/native/ios/NearcastApp/NearcastApp.swift"
ROOT_VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativeOnlyExperienceRoot.swift"

fail() {
  printf 'FAIL  Native-only host boundary: %s\n' "$1" >&2
  exit 1
}

require() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || fail "$message"
}

require 'init(allowNativeOnlyCompatibility: Bool = false)' "$MODEL" \
  'Web model construction must require an explicit native-only capability'
require '!NativeRuntimeConfiguration.isNativeOnlyExperience || allowNativeOnlyCompatibility' "$MODEL" \
  'Native-only WebKit construction must fail closed without that capability'
require 'allowNativeOnlyCompatibility: true' "$APP" \
  'The retained migration cover must explicitly opt into compatibility'
require 'NearcastCompatibilityRoot(' "$APP" \
  'The app root must retain the bounded compatibility presentation'
require 'compatibilityLaunch = Presentation(launch: launch)' "$APP" \
  'The compatibility presentation must still originate in the native root'
require 'primaryButton: .default(Text(request.confirmTitle)' "$ROOT_VIEW" \
  'A native-only compatibility request must stay user-confirmed'

if rg -n --fixed-strings 'NearcastWebModel()' "$ROOT/native/ios/NearcastApp" >/dev/null; then
  fail 'No implicit NearcastWebModel constructor may bypass the native-only capability'
fi

printf 'PASS Native-only host boundary: WebKit requires an explicit confirmed compatibility handoff\n'
