#!/bin/bash
set -euo pipefail

# This protects the native-only Dev promise at its host boundary. It is not a
# substitute for device navigation tests; it makes a future refactor fail fast
# if an ordinary URL or notification silently regains a WebKit escape route.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/native/ios/NearcastApp/NativeWeather/NativeOnlyExperienceRoot.swift"
SOURCE_TEXT="$(<"$SOURCE")"
PLANS_VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlansExperience.swift"
PLANS_TEXT="$(<"$PLANS_VIEW")"

fail() {
  printf 'FAIL  Native-only routing contract: %s\n' "$1" >&2
  exit 1
}

function_body() {
  local signature="$1"
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
  ' "$SOURCE"
}

require_text() {
  local needle="$1"
  local body="$2"
  local message="$3"
  [[ "$body" == *"$needle"* ]] || fail "$message"
}

reject_text() {
  local needle="$1"
  local body="$2"
  local message="$3"
  [[ "$body" != *"$needle"* ]] || fail "$message"
}

url_body="$(function_body 'func open(url: URL)')"
notification_body="$(function_body 'func openNativeNotification(userInfo:')"
weather_preview_body="$(function_body 'private var weatherPreview: some View')"
places_sheet_body="$(function_body 'private func placesSheet(')"
native_map_body="$(function_body 'private var nativeMapSheet: some View')"
apply_route_body="$(function_body 'private func applyRoute()')"

# Forecast/context publications may call this handler, but only a new request
# or the matching deferred forecast can navigate. Otherwise a temporary place
# choice snaps back to the owner's older selection as soon as weather loads.
require_text 'routeApplication.begin(revision: router.revision, selectedPlace: preview.selectedPlace)' "$apply_route_body" \
  'route application must gate weather callbacks by request revision and active place'
require_text 'guard action != .ignore else { return }' "$apply_route_body" \
  'settled navigation must not replay after forecast or context publications'
require_text 'if action == .start && place.coordinateIdentity != preview.selectedPlace.coordinateIdentity' "$apply_route_body" \
  'a deferred forecast continuation must never reselect its old place'
require_text 'routeApplication.waitForForecast(at: preview.selectedPlace)' "$apply_route_body" \
  'requested day/hour navigation must wait only for its active destination'

require_text 'NativeDeepLinkRouter.parse' "$url_body" \
  'ordinary native URLs must use the typed native parser'
require_text 'openNativeRoute(' "$url_body" \
  'ordinary native URLs must resolve through the shared native route handler'
reject_text 'requestCompatibility(' "$url_body" \
  'ordinary native URLs must not open compatibility Nearcast'

require_text 'NativeNotificationRouteParser.parse' "$notification_body" \
  'notification payloads must use the bounded native parser'
require_text 'openNativeRoute(' "$notification_body" \
  'notification payloads must resolve through the shared native route handler'
reject_text 'requestCompatibility(' "$notification_body" \
  'notification taps must not open compatibility Nearcast'

rg -q --fixed-strings 'case .map:' "$SOURCE" || fail 'native route application must own a native map destination'
rg -q --fixed-strings 'case .places:' "$SOURCE" || fail 'native route application must own native Places and Settings destinations'
rg -q --fixed-strings 'NativeRadarView(' "$SOURCE" || fail 'native map routes need a native map presentation'
rg -q --fixed-strings 'showsCloseControl: false' "$SOURCE" || fail 'native-only Home must not expose a close-to-WebKit control'
rg -q --fixed-strings 'allowsExistingMapHandoff: false' "$SOURCE" || fail 'native-only Home must not advertise a WebKit map handoff'
rg -q --fixed-strings 'showsExistingAppActions: false' "$SOURCE" || fail 'native-only Places must not advertise existing-app settings'
rg -q --fixed-strings 'showsCompatibilityRecovery: false' "$SOURCE" || fail 'native-only weather recovery must stay native'
reject_text 'func requestCompatibility(' "$SOURCE_TEXT" 'native-only composition must not keep a generic WebKit handoff API'

# The shared preview has legacy-oriented callbacks for compatibility hosts.
# Native-only composition may retain the callback shape, but it must resolve
# the two supported destinations in native sheets rather than forwarding them
# into a generic existing-app escape.
require_text 'onLegacy: {' "$weather_preview_body" \
  'native-only weather must own its shared-preview legacy callback explicitly'
require_text 'if destination == .ask { showingAsk = true }' "$weather_preview_body" \
  'native-only Ask must remain in the native sheet'
require_text 'else if destination == .plans { showingAgenda = true }' "$weather_preview_body" \
  'native-only Plans must remain in the native sheet'
reject_text 'requestLegacy(' "$weather_preview_body" \
  'native-only weather callback must not request the legacy shell'
reject_text 'onOpenCompatibility' "$weather_preview_body" \
  'native-only weather callback must not expose a generic compatibility action'

# Places gets the shared settings surface, so pin its compatibility callbacks
# to inert values in the native-only composition. A future nonempty callback
# would reveal an existing-app route from a normal Places or Settings visit.
require_text 'onOpenExisting: {}' "$places_sheet_body" \
  'native-only Places must keep the existing-app callback inert'
require_text 'onOpenExistingMap: nil' "$places_sheet_body" \
  'native-only Places must not surface the existing map'
require_text 'onExistingMap: nil' "$native_map_body" \
  'native-only map must not surface the existing map'

# These dormant legacy-projection components still accept broad
# compatibility callbacks. They are deliberately not part of the active
# native-only composition; Plans uses NativePlansExperience instead.
reject_text 'NativeAgendaView(' "$SOURCE_TEXT" \
  'native-only composition must not mount the legacy-oriented agenda view'
reject_text 'NativePlanDetailView(' "$SOURCE_TEXT" \
  'native-only composition must not mount the legacy-oriented plan detail view'
# Plans is the only nested native surface that can open plan detail. Guard it
# too, so a future refactor cannot reintroduce either dormant view one level
# below the root and thereby regain its broad existing-app callbacks.
reject_text 'NativeAgendaView(' "$PLANS_TEXT" \
  'native Plans must not mount the legacy-oriented agenda view'
reject_text 'NativePlanDetailView(' "$PLANS_TEXT" \
  'native Plans must not mount the legacy-oriented plan detail view'
reject_text 'Open existing Nearcast' "$SOURCE_TEXT" \
  'native-only composition must not reveal a generic existing-app action'
reject_text 'Return to existing Nearcast' "$SOURCE_TEXT" \
  'native-only composition must not reveal a generic recovery escape'
# Existing Plans can only be read through one deliberate, user-confirmed
# compatibility handoff while native-only Dev has no ambient WebKit hierarchy.
# It is not a normal route or notification fallback and must target Plans
# precisely so the bridge can produce its verified read-only Agenda export.
rg -q --fixed-strings 'func requestVerifiedPlansHandoff' "$SOURCE" || fail 'native-only Plans needs an explicit verified handoff request'
rg -q --fixed-strings 'confirmTitle: "Open existing Plans"' "$SOURCE" || fail 'Plans handoff must remain user-confirmed'
rg -q --fixed-strings 'destination: .plans' "$SOURCE" || fail 'Plans handoff must target existing Plans, not generic web Home'
agenda_body="$(function_body 'private var agendaSheet: some View')"
reject_text 'onRequestVerifiedLegacyHandoff:' "$agenda_body" 'fresh native Plans must not offer legacy import'
require_text 'if onRequestVerifiedLegacyHandoff != nil { legacyHandoffCard }' "$PLANS_TEXT" 'legacy import must be hidden without an explicit compatibility host'
rg -q --fixed-strings 'showsLegacyImport: false' "$SOURCE" || fail 'fresh native Places setup must not advertise import'
rg -q --fixed-strings 'nearcast.native.root' "$SOURCE" || fail 'native-only root needs a stable runtime-test identifier'
rg -q --fixed-strings 'nearcast.native.weather' "$SOURCE" || fail 'native weather needs a stable runtime-test identifier'
rg -q --fixed-strings 'nearcast.native.navigation.' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewView.swift" || fail 'native navigation needs stable runtime-test identifiers'

printf 'PASS Native-only routing: URLs, notifications, Home, map, Ask, Plans, and Places remain native\n'
