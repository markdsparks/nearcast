#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-plan-handoff.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLegacySourceScope.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeForecastRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlaceLookupService.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift" \
  "$ROOT/scripts/native-plan-handoff-test.swift" \
  -o "$TEST_ROOT/native-plan-handoff-test"

"$TEST_ROOT/native-plan-handoff-test" "$TEST_ROOT"

VIEW="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlansExperience.swift"
LIBRARY="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift"
NATIVE_ROOT="$ROOT/native/ios/NearcastApp/NativeWeather/NativeOnlyExperienceRoot.swift"
WEB_MODEL="$ROOT/native/ios/NearcastApp/Models/NearcastWebModel.swift"
AGENDA_STORE="$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaStore.swift"
P0_COORDINATOR="$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanNotificationIntentHandoffCoordinator.swift"

require() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || {
    printf 'FAIL  Native Plans handoff: %s\n' "$message" >&2
    exit 1
  }
}

forbid() {
  local needle="$1"
  local file="$2"
  local message="$3"
  if rg -q --fixed-strings "$needle" "$file"; then
    printf 'FAIL  Native Plans handoff: %s\n' "$message" >&2
    exit 1
  fi
}

require 'confirmationDialog(' "$VIEW" 'The native Plans handoff must remain user-confirmed'
require 'handoffVerifiedLegacyAgenda(' "$VIEW" 'The UI must only hand off the retained verified Agenda'
require 'legacyAgenda.agenda,' "$VIEW" 'The UI must only hand off the retained verified Agenda'
require 'sourceScope: legacyAgenda.sourceScope' "$VIEW" 'Plans must bind an import receipt to the active retained Agenda source scope'
require 'plan.handoff.import' "$VIEW" 'The native import action needs an accessible identity'
require 'plan.handoff.find' "$VIEW" 'Native-only Dev needs an explicit way to request a verified saved-Plan read'
require 'onRequestVerifiedLegacyHandoff' "$VIEW" 'Plans must ask the root for an explicit verified handoff rather than create WebKit'
require 'legacyHandoff' "$LIBRARY" 'The durable one-time handoff receipt is missing'
require 'let sourceScope: NativeLegacySourceScope?' "$LIBRARY" 'The durable handoff receipt must bind a Local or Production source scope'
require 'guard receipt.sourceScope == sourceScope else' "$LIBRARY" 'A receipt from another source scope must not be reused'
require 'func requestVerifiedPlansHandoff' "$NATIVE_ROOT" 'Native-only Dev needs an exact verified Plans handoff request'
require 'destination: .plans' "$NATIVE_ROOT" 'The handoff must open the exact existing Plans destination'
forbid 'onRequestVerifiedLegacyHandoff:' "$NATIVE_ROOT" 'Fresh native Plans must not expose the old import route'
require 'private var legacySourceScope: NativeLegacySourceScope' "$NATIVE_ROOT" 'Native-only root must retain one explicit legacy source scope'
require 'NativeAgendaStore.shared.configure(sourceScope: sourceScope)' "$NATIVE_ROOT" 'Native-only root must configure retained Agenda for its initial source scope'
require 'placesOwner.configure(production: currentScope.isProduction)' "$NATIVE_ROOT" 'Native-only root must reconfigure Places when the source scope changes'
require 'NativeAgendaStore.shared.configure(sourceScope: currentScope)' "$NATIVE_ROOT" 'Native-only root must reconfigure retained Agenda when the source scope changes'
forbid 'planNotificationIntentCoordinator.configure' "$NATIVE_ROOT" 'Fresh native startup must not stage old notification intent'
require 'func configure(sourceScope: NativeLegacySourceScope)' "$AGENDA_STORE" 'Retained Agenda must expose an explicit source-scope reconfiguration boundary'
require 'sourceScope.scopedDefaultsKey(Self.payloadKey)' "$AGENDA_STORE" 'Retained Agenda cache must be physically scoped by Local or Production source'
require 'private var sourceScope: NativeLegacySourceScope' "$P0_COORDINATOR" 'P0 intent staging must retain its active source scope'
require 'scope.scopedDirectory(from:' "$P0_COORDINATOR" 'P0 intent staging files must be physically scoped by Local or Production source'

# The Plans compatibility export is an explicit, one-shot bridge. Ordinary
# Agenda refreshes must never generate a delivery-intent handoff. In
# particular, a successful JavaScript call is not the acknowledgement: the
# asynchronous bridge receiver consumes the arm after it sees the one trusted
# payload.
function_body() {
  local file="$1"
  local signature="$2"
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
  ' "$file"
}

plans_import_body="$(function_body "$VIEW" 'private func handoffLegacyPlans()')"
root_activate_body="$(function_body "$NATIVE_ROOT" 'func activate()')"
agenda_export_body="$(function_body "$WEB_MODEL" 'private func installAgendaCompatibilityExport()')"
handoff_body="$(function_body "$WEB_MODEL" 'func handoffNativePreview(_ handoff: NativePreviewHandoff)')"
receiver_body="$(function_body "$WEB_MODEL" 'func receiveLegacyPlanHandoverExport(_ data: Data)')"
load_body="$(function_body "$WEB_MODEL" 'func load(_ nextMode: NearcastWebMode)')"
navigation_body="$(function_body "$WEB_MODEL" 'private func requestNavigation(to targetURL: URL, force: Bool)')"
arm_body="$(function_body "$WEB_MODEL" 'private func armPlanHandoverExport()')"

[[ -n "$plans_import_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect native Plans import action\n' >&2; exit 1; }
[[ -n "$root_activate_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect native-only lifecycle activation\n' >&2; exit 1; }
[[ -n "$agenda_export_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect Agenda export installation\n' >&2; exit 1; }
[[ -n "$handoff_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect explicit preview handoff\n' >&2; exit 1; }
[[ -n "$receiver_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect handoff bridge receiver\n' >&2; exit 1; }
[[ -n "$navigation_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect navigation invalidation\n' >&2; exit 1; }
[[ -n "$arm_body" ]] || { printf 'FAIL  Native Plans handoff: could not inspect handoff arm lifetime\n' >&2; exit 1; }

if [[ "$plans_import_body" != *'handoffVerifiedLegacyAgenda('* ]] || \
   [[ "$plans_import_body" != *'legacyAgenda.agenda,'* ]] || \
   [[ "$plans_import_body" != *'sourceScope: legacyAgenda.sourceScope'* ]]; then
  printf 'FAIL  Native Plans handoff: the native import must use the retained Agenda in its active source scope\n' >&2
  exit 1
fi
if [[ "$root_activate_body" != *'placesOwner.configure(production: currentScope.isProduction)'* ]] || \
   [[ "$root_activate_body" != *'NativeAgendaStore.shared.configure(sourceScope: currentScope)'* ]]; then
  printf 'FAIL  Native Plans handoff: native-only lifecycle must keep retained local readers in one source scope\n' >&2
  exit 1
fi

if [[ "$agenda_export_body" == *'publishLegacyPlanHandoverSnapshot'* ]]; then
  printf 'FAIL  Native Plans handoff: ordinary Agenda export must not publish a Plans notification handoff\n' >&2
  exit 1
fi
require 'const planHandoverPublished = requestPlanHandover && safeResponse.ok === true' "$WEB_MODEL" \
  'Plan handoff publishing must be guarded by the exact explicit request and a successful handoff'
require '? publishLegacyPlanHandoverSnapshot() === true' "$WEB_MODEL" \
  'Plan handoff must have one explicit publisher in the handoff path'
publisher_count="$(rg -n --fixed-strings '? publishLegacyPlanHandoverSnapshot() === true' "$WEB_MODEL" | wc -l | tr -d ' ' || true)"
if [[ "$publisher_count" != "1" ]] || [[ "$handoff_body" != *'publishLegacyPlanHandoverSnapshot'* ]]; then
  printf 'FAIL  Native Plans handoff: exactly one Plans export publisher must remain inside the explicit handoff path\n' >&2
  exit 1
fi
if [[ "$handoff_body" != *'handoff.destination == .plans'* ]] || \
   [[ "$handoff_body" != *'planHandoverCompatibilityConsent'* ]] || \
   [[ "$handoff_body" != *'planHandoverConsentRevision == navigationRevision'* ]] || \
   [[ "$handoff_body" != *'armPlanHandoverExport()'* ]]; then
  printf 'FAIL  Native Plans handoff: publisher must be armed only by the consented exact Plans handoff\n' >&2
  exit 1
fi
if [[ "$receiver_body" != *'guard planHandoverExportArmed,'* ]] || \
   [[ "$receiver_body" != *'planHandoverArmRevision == navigationRevision'* ]] || \
   [[ "$receiver_body" != *'clearPlanHandoverExportArm(clearConsent: true)'* ]]; then
  printf 'FAIL  Native Plans handoff: the bridge receiver must consume the document-bound one-shot arm\n' >&2
  exit 1
fi

# Inspect only the success branch of the JavaScript completion. It may clear a
# failed publish, but must not clear an accepted arm before the asynchronous
# `nearcastLegacyPlanHandover` bridge message arrives.
success_callback_body="$(awk '
  /case \.success\(let value\):/ { active = 1 }
  active { print }
  active && /case \.failure:/ { exit }
' "$WEB_MODEL")"
if [[ "$success_callback_body" != *'nativePlanHandoverPublished'* ]] || \
   [[ "$success_callback_body" != *'as? Bool != true'* ]] || \
   [[ "$success_callback_body" != *'clearPlanHandoverExportArm(clearConsent: true)'* ]]; then
  printf 'FAIL  Native Plans handoff: completion may clear only a definitively unpublished handoff\n' >&2
  exit 1
fi
success_clear_count="$(printf '%s\n' "$success_callback_body" | rg -c --fixed-strings 'clearPlanHandoverExportArm(clearConsent: true)' || true)"
if [[ "$success_clear_count" != "1" ]] || ! printf '%s\n' "$success_callback_body" | rg -U -q \
  'if requestsPlanHandover,\s+response\?\["nativePlanHandoverPublished"\] as\? Bool != true \{\s+self\?\.clearPlanHandoverExportArm\(clearConsent: true\)'; then
  printf 'FAIL  Native Plans handoff: a successful JavaScript handoff must retain its arm until the bridge receiver consumes it\n' >&2
  exit 1
fi
if [[ "$success_callback_body" == *'if requestsPlanHandover {'* ]]; then
  printf 'FAIL  Native Plans handoff: completion clears a Plans arm unconditionally before the bridge receiver\n' >&2
  exit 1
fi
if [[ "$arm_body" != *'planHandoverExportArmed = true'* ]] || \
   [[ "$arm_body" != *'planHandoverArmRevision = revision'* ]] || \
   [[ "$arm_body" != *'Task.sleep(nanoseconds:'* ]]; then
  printf 'FAIL  Native Plans handoff: an armed Plans export must be document-bound and time-limited\n' >&2
  exit 1
fi
if [[ "$load_body" != *'clearPlanHandoverExportArm(clearConsent: true)'* ]] || \
   [[ "$navigation_body" != *'clearPlanHandoverExportArm(clearConsent: true)'* ]]; then
  printf 'FAIL  Native Plans handoff: mode or navigation changes must revoke an outstanding Plans handoff arm\n' >&2
  exit 1
fi

# Switching the compatibility host must configure its scoped readers before a
# new page can publish anything. Compare the body positions rather than
# relying on a particular indentation.
scope_config_position="$(printf '%s\n' "$load_body" | rg -n --fixed-strings 'NativeAgendaStore.shared.configure(sourceScope: scope)' | head -n1 | cut -d: -f1 || true)"
navigation_position="$(printf '%s\n' "$load_body" | rg -n --fixed-strings 'requestNavigation(' | head -n1 | cut -d: -f1 || true)"
if [[ -z "$scope_config_position" || -z "$navigation_position" || "$scope_config_position" -ge "$navigation_position" ]]; then
  printf 'FAIL  Native Plans handoff: compatibility source scope must be configured before navigation\n' >&2
  exit 1
fi
TASK_BLOCK="$(awk '
  /^            \.task\(id: initialPlanID\)/ { in_task = 1 }
  in_task { print }
  in_task && /^            }$/ { exit }
' "$VIEW")"
if printf '%s\n' "$TASK_BLOCK" | rg -q --fixed-strings 'handoffVerifiedLegacyAgenda'; then
  printf 'FAIL  Native Plans handoff: Opening Plans must not import a retained agenda automatically\n' >&2
  exit 1
fi
forbid 'requestCompatibility' "$VIEW" 'Plans handoff must not fall through to compatibility/WebKit'
forbid 'NativeCompatibilityLaunch' "$VIEW" 'Plans handoff must not create a compatibility launch'
forbid 'WKWebView' "$VIEW" 'Plans handoff must not create a WebKit dependency'
forbid 'NativeNotificationRouter' "$LIBRARY" 'Plans handoff must not take notification delivery ownership'
forbid 'NativeWatchSnapshotSync' "$LIBRARY" 'Plans handoff must not take Watch delivery ownership'

printf 'PASS Native Plans handoff UI contract: explicit native-only schedule copy with no delivery transfer\n'
