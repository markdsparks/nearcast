#!/bin/bash
set -euo pipefail

# Source-level guard for the native-only Dev map failure path. A simulator
# build can prove the code compiles, but not that a nil compatibility callback
# still leaves a person with retry, layer, and close actions instead of a
# dead-end instruction to open the old map.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="$ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarModel.swift"
VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarView.swift"
NATIVE_ROOT="$ROOT/native/ios/NearcastApp/NativeWeather/NativeOnlyExperienceRoot.swift"

fail() {
  printf 'FAIL  Native-only map recovery: %s\n' "$1" >&2
  exit 1
}

require() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || fail "$message"
}

reject_case_insensitive() {
  local needle="$1"
  local file="$2"
  local message="$3"
  ! rg -qi --fixed-strings "$needle" "$file" || fail "$message"
}

function_body() {
  local signature="$1"
  local source="$2"
  awk -v signature="$signature" '
    index($0, signature) { active = 1; depth = 0; started = 0 }
    active {
      print
      opens = gsub(/\{/, "{")
      closes = gsub(/\}/, "}")
      depth += opens - closes
      if (opens > 0) started = 1
      if (started && depth == 0) exit
    }
  ' "$source"
}

recovery_body="$(function_body 'private var mapRecoveryActions: some View' "$VIEW")"

require 'var needsMapRecovery: Bool' "$MODEL" \
  'map failures need an explicit recovery classification'
require 'func retryMap()' "$MODEL" \
  'map failures need a native retry operation'
require 'await self.loadBasemap()' "$MODEL" \
  'native retry must reload the native basemap before refresh'
reject_case_insensitive 'open the existing map' "$MODEL" \
  'model-owned status copy must not direct a native-only user into the old map'
reject_case_insensitive 'existing map from info' "$MODEL" \
  'model-owned status copy must not promise an unavailable compatibility escape'

require 'if model.needsMapRecovery { mapRecoveryActions }' "$VIEW" \
  'a visible map failure must surface its recovery actions'
[[ "$recovery_body" == *'model.retryMap()'* ]] || fail 'recovery must retry the native map'
[[ "$recovery_body" == *'Label("Layers", systemImage: "square.3.layers.3d")'* ]] || fail 'recovery must let the user choose a native layer'
[[ "$recovery_body" == *'Button(action: onClose)'* ]] || fail 'recovery must let the user close the native map'
[[ "$recovery_body" == *'if let onExistingMap'* ]] || fail 'only compatibility hosts may retain the existing-map action'
[[ "$recovery_body" != *'requestLegacy('* ]] || fail 'native recovery must not invoke a generic legacy route'
[[ "$recovery_body" != *'onLegacy('* ]] || fail 'native recovery must not invoke a generic legacy route'

require 'onExistingMap: nil' "$NATIVE_ROOT" \
  'native-only Dev must continue to pass no compatibility map callback'
require 'nearcast.native.map.recovery' "$VIEW" \
  'native map recovery needs a stable runtime-test identifier'

printf 'PASS  Native-only map failures retain retry, layers, and close without a compatibility escape\n'
