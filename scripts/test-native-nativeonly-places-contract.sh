#!/bin/bash
set -euo pipefail

# Source-level contract for the native-only Dev shell.  This is deliberately
# separate from the Places model tests: it protects discoverability at the
# ownership boundary, where a cached read-only weather context is useful but
# must never masquerade as an editable saved-place store.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativeOnlyExperienceRoot.swift"
OWNER_CONTROLLER="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesOwnerController.swift"

fail() {
  printf 'FAIL  Native-only Places contract: %s\n' "$1" >&2
  exit 1
}

require() {
  local pattern="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$pattern" "$file" || fail "$message"
}

require_text() {
  local pattern="$1"
  local text="$2"
  local message="$3"
  [[ "$text" == *"$pattern"* ]] || fail "$message"
}

# Keep the check focused on the NativeOnlyWeatherContainer call.  The shared
# preview may still support a read-only preview host elsewhere in the app;
# Native-only Dev must not use that bare temporary city menu as its only
# Places affordance when its own owner has not been activated yet.
PREVIEW_CALL="$(awk '
  /NativeWeatherPreviewView\(/ { capturing = 1 }
  capturing { print }
  capturing && /isUncovered:/ { exit }
' "$ROOT_VIEW")"
[[ -n "$PREVIEW_CALL" ]] || fail 'native-only weather no longer constructs the shared weather screen'

# Places and Settings must remain discoverable on the native home even when
# the owner is unverified.  A handler may present the verified native sheet
# when ready or the explicit setup sheet when not; ownership must not make the
# controls disappear by passing nil.
require_text 'onPlaces: {' "$PREVIEW_CALL" \
  'native-only weather must always provide an explicit Places entry callback'
require_text 'onSettings: {' "$PREVIEW_CALL" \
  'native-only weather must always provide an explicit Settings entry callback'
if [[ "$PREVIEW_CALL" == *'onPlaces: coordinator.canEditPlaces ?'* ]] || \
   [[ "$PREVIEW_CALL" == *'onSettings: coordinator.canEditPlaces ?'* ]]; then
  fail 'Places or Settings is still hidden behind the ownership gate'
fi
if [[ "$PREVIEW_CALL" == *'onPlaces: nil'* ]] || [[ "$PREVIEW_CALL" == *'onSettings: nil'* ]]; then
  fail 'native-only weather must not fall back to a bare temporary city menu'
fi

# The unowned flow needs an honest setup surface rather than a silent cache
# promotion. These strings make the distinction explicit: native setup starts
# from a freshly resolved user choice, while the old inventory can only enter
# through the separate verified-import action.
require 'Temporary weather preview' "$ROOT_VIEW" \
  'the read-only fallback must be explicitly labelled temporary'
require 'Set up native saved places' "$ROOT_VIEW" \
  'the read-only fallback must offer direct native saved-places setup'
require 'Import existing saved places instead' "$ROOT_VIEW" \
  'the fallback must retain an explicit verified legacy-import choice'
require 'NativePlacesBootstrapSheet' "$ROOT_VIEW" \
  'native-only Dev must have a direct first-run native Places surface'
require 'onOpenCompatibility' "$ROOT_VIEW" \
  'legacy import must remain an explicit compatibility callback, not mutate cached places'

# A setup presentation must be owned by the native-only root.  Requiring a
# named view keeps the migration explanation close to the action and prevents
# a future refactor from burying it in a toolbar-only alert.
require 'NativeOnlyPlacesSetup' "$ROOT_VIEW" \
  'native-only weather needs a dedicated Places setup surface for unowned state'

OWNER_STORE="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesOwnerStore.swift"
require 'func bootstrapNative(place: NativeManagedPlace' "$OWNER_STORE" \
  'native first-run must create ownership only from a native managed place'
require 'A disposable preview cache must' "$OWNER_STORE" \
  'native bootstrap must document that a preview cache is never its source'
if rg -q --fixed-strings 'bootstrapNative(context:' "$OWNER_STORE"; then
  fail 'native bootstrap must not accept a disposable preview context as saved state'
fi

# Native-only Dev uses its own app-group namespace. Its freshly verified owner
# must publish there even when the retained Web setting is still Local; the
# old production-only gate stranded Dev widgets and Watch after native setup.
require 'publishesCompanions = production || NativeRuntimeConfiguration.isNativeOnlyExperience' "$OWNER_CONTROLLER" \
  'native-only Dev owner must publish verified Places to its isolated companions'

printf 'PASS Native-only Places: explicit entry points, honest temporary state, and native first-run ownership\n'
