#!/bin/bash
set -euo pipefail

# Source-level companion to the model test. SwiftUI navigation is intentionally
# verified here because the small Foundation harness cannot instantiate a
# NavigationStack. The runtime model test proves ID/tombstone resolution.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlansExperience.swift"
LIBRARY="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift"
DETAIL="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanDetailView.swift"

fail() {
  printf 'FAIL  Native Plans route focus: %s\n' "$1" >&2
  exit 1
}

require() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || fail "$message"
}

# The Plans UI needs an explicit route input, must offer (not automatically
# perform) the one-time verified Agenda handoff, and must present its native
# detail instead of falling back to a generic list or compatibility handoff.
require 'initialPlanID: String? = nil' "$VIEW" \
  'Native Plans no longer accepts a bounded route plan ID'
require '.task(id: initialPlanID)' "$VIEW" \
  'A changed Plans route no longer reapplies focus'
require '@ObservedObject private var legacyAgenda = NativeAgendaStore.shared' "$VIEW" \
  'Native Plans must only use the retained verified Agenda projection'
require 'showingLegacyHandoffConfirmation' "$VIEW" \
  'Importing a retained Agenda must require an explicit confirmation'
require 'library.handoffVerifiedLegacyAgenda(' "$VIEW" \
  'Plans must use the explicit native handoff instead of automatic import'
require 'sourceScope: legacyAgenda.sourceScope' "$VIEW" \
  'Plans handoff receipts must remain bound to the active retained Agenda source scope'
require 'plan.handoff.import' "$VIEW" \
  'A verified retained Agenda needs a visible native import action'
require 'library.resolveRoutePlan(id: initialPlanID)' "$VIEW" \
  'Plans route IDs are not resolved against an arbitrary compatibility store'
require 'NativeOwnedPlanDetail' "$VIEW" \
  'A focused plan must open native plan details'
require 'plan.route.focused' "$VIEW" \
  'Returning to the list must visibly retain the opened plan'
require 'plan.route.unavailable' "$VIEW" \
  'A missing or deleted route target needs an honest native state'

# Exact lookup gives a deliberately mapped imported copy precedence (including
# a safely preserved source ID), then accepts an ordinary local native ID. A
# stale old route can never create or resurrect a plan.
require 'enum NativePlanRouteMatch' "$LIBRARY" \
  'Plans lacks a typed native route result'
require 'if let copiedID = archive.importedIDs[routeID]' "$LIBRARY" \
  'An earlier route must only use the explicit imported-copy mapping'
require 'if let local = archive.plans.first(where: { $0.id == routeID })' "$LIBRARY" \
  'A native route must still resolve an exact local ID'
require 'return .unavailable' "$LIBRARY" \
  'Unresolved plan routes must remain unavailable rather than guessing'
require 'importedIDs survives deletion, preventing resurrection' "$LIBRARY" \
  'Deleted imported plans must retain their tombstone'

# Both detail paths need to make the ownership boundary clear. Local native
# copies are local-only; earlier watch/notification state remains untouched.
require 'Earlier watches and notifications are unchanged.' "$VIEW" \
  'The imported-copy route state must not imply notification migration'
require 'NativePlanNotificationControls(plan: plan, plans: library.plans, metric: context.metric)' "$VIEW" \
  'Native plan detail must expose explicit per-plan notification consent and truthful delivery state'
require 'must never cause this projection to imply that a notification watch moved' "$DETAIL" \
  'The legacy projection detail must retain its watch-ownership boundary'

printf 'PASS Native Plans route focus: exact local/imported detail routing, visible focus, and no watch migration\n'
