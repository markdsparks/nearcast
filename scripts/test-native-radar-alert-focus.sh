#!/bin/bash
set -euo pipefail

# SwiftUI/MapLibre are outside the lightweight alert-contract harness. Keep a
# small source contract for the native alert-route promise: a route ID must be
# verified against the native feed, visibly selected, and camera-focused only
# when its real GeoJSON feature exists. A failed match must explain itself,
# never manufacture an outline.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarView.swift"
MAP="$ROOT/native/ios/NearcastApp/NativeWeather/NativeRadarMap.swift"

fail() {
  printf 'FAIL  Native radar alert focus: %s\n' "$1" >&2
  exit 1
}

require() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || fail "$message"
}

require 'let focusedAlertID: String?' "$VIEW" \
  'native radar view must accept an exact native route alert ID'
require 'if let active = activeAlert(idOrKey: requestedID)' "$VIEW" \
  'a route alert must be verified by the active native alert feed'
require 'if let known = model.alert(requestedID)' "$VIEW" \
  'a stale/cancelled bulletin must be surfaced as last-known detail rather than highlighted'
require 'Linked alert could not be matched' "$VIEW" \
  'an unmatched route must have clear native unavailable treatment'
require 'Nearcast has not guessed at an affected area.' "$VIEW" \
  'bulletins without geometry must not claim a generated map area'
require 'alertFocusRevision += 1' "$VIEW" \
  'only a verified alert with geometry should request a map camera focus'

require 'let highlightedAlertID: String?' "$MAP" \
  'map renderer must receive the selected alert identity'
require 'native-alert-highlight-line' "$MAP" \
  'map renderer must visibly emphasize the selected official outline'
require 'alertFocusRevision != consumedAlertFocusRevision' "$MAP" \
  'alert focus must be revision-driven rather than fight ordinary map gestures'
require 'let bounds = Self.alertBounds(identifier: identifier, data: input.alerts)' "$MAP" \
  'camera framing must be derived from already-rendered official GeoJSON'
require 'map.setVisibleCoordinateBounds(bounds' "$MAP" \
  'verified alert geometry must frame the native map'
require 'A bulletin without geometry, a stale feature, or a' "$MAP" \
  'map focus must document the no-guess safety boundary'

printf 'PASS Native radar alert route: verified current outline focus, clear bulletin-only/stale/unmatched treatment\n'
