#!/bin/bash
set -euo pipefail

# Keep the production/TestFlight identity separate from the native-only Dev
# lane while requiring the explicitly promoted native experience. This intentionally
# checks the resolved source configuration boundary, not product behavior.
#
# Usage:
#   bash scripts/test-native-release-cutover-gate.sh
#   bash scripts/test-native-release-cutover-gate.sh --build
#
# `--build` performs an unsigned Release build for the iOS Simulator. It has
# no archive, export, upload, provisioning update, or delivery side effect.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/native/ios/Nearcast.xcodeproj"
PROJECT_FILE="$PROJECT/project.pbxproj"
DEBUG_INFO="$ROOT/native/ios/NearcastApp/Support/Info-Debug.plist"
RELEASE_INFO="$ROOT/native/ios/NearcastApp/Support/Info-Release.plist"
DEBUG_ENTITLEMENTS="$ROOT/native/ios/NearcastApp/Support/Nearcast-Debug.entitlements"
RELEASE_ENTITLEMENTS="$ROOT/native/ios/NearcastApp/Support/Nearcast-Release.entitlements"
DEV_SCHEME="$PROJECT/xcshareddata/xcschemes/Nearcast Dev.xcscheme"
RELEASE_SCHEME="$PROJECT/xcshareddata/xcschemes/Nearcast.xcscheme"

BUILD=false
case "${1:-}" in
  "") ;;
  --build) BUILD=true ;;
  *)
    printf 'Usage: %s [--build]\n' "$0" >&2
    exit 2
    ;;
esac

fail() {
  printf 'FAIL  Native Release cutover gate: %s\n' "$1" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing required configuration file: $1"
}

require_text() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || fail "$message"
}

forbid_text() {
  local needle="$1"
  local file="$2"
  local message="$3"
  if rg -q --fixed-strings "$needle" "$file"; then
    fail "$message"
  fi
}

# PBX projects keep every target configuration in a single file. Pull one
# named configuration block at a time so matching a production value anywhere
# in the file cannot accidentally prove the wrong target is configured.
configuration_block() {
  local identifier="$1"
  awk -v identifier="$identifier" '
    $0 ~ "^[[:space:]]*" identifier "[[:space:]]*/\\*" {
      capture = 1
    }
    capture {
      print
      line = $0
      opens = gsub(/\{/, "{", line)
      closes = gsub(/\}/, "}", line)
      depth += opens - closes
      if (depth == 0) {
        exit
      }
    }
  ' "$PROJECT_FILE"
}

require_block_text() {
  local block="$1"
  local needle="$2"
  local message="$3"
  grep -Fq -- "$needle" <<<"$block" || fail "$message"
}

forbid_block_text() {
  local block="$1"
  local needle="$2"
  local message="$3"
  if grep -Fq -- "$needle" <<<"$block"; then
    fail "$message"
  fi
}

require_file "$PROJECT_FILE"
require_file "$DEBUG_INFO"
require_file "$RELEASE_INFO"
require_file "$DEBUG_ENTITLEMENTS"
require_file "$RELEASE_ENTITLEMENTS"
require_file "$DEV_SCHEME"
require_file "$RELEASE_SCHEME"

# Project-level settings are inherited by the phone app and every companion.
project_debug="$(configuration_block AA0000000000000000000001)"
project_release="$(configuration_block AA0000000000000000000002)"
[[ -n "$project_debug" ]] || fail 'could not read the project Debug configuration'
[[ -n "$project_release" ]] || fail 'could not read the project Release configuration'

require_block_text "$project_debug" 'NEARCAST_APP_GROUP_IDENTIFIER = group.app.nearcast.ios.dev;' 'Debug must use the isolated Dev app group'
require_block_text "$project_release" 'NEARCAST_APP_GROUP_IDENTIFIER = group.app.nearcast.ios;' 'Release must use the production app group'
require_block_text "$project_debug" 'NEARCAST_URL_SCHEME = nearcast-dev;' 'Debug must use the isolated Dev URL scheme'
require_block_text "$project_release" 'NEARCAST_URL_SCHEME = nearcast;' 'Release must use the production URL scheme'
require_block_text "$project_debug" 'NEARCAST_REMOTE_DELIVERY_ENABLED = NO;' 'Debug must keep remote delivery disabled'
require_block_text "$project_release" 'NEARCAST_REMOTE_DELIVERY_ENABLED = YES;' 'Release must retain production remote delivery'
require_block_text "$project_debug" 'NEARCAST_COMPANION_BUNDLE_IDENTIFIER = app.nearcast.ios.dev;' 'Debug Watch must point at the Dev phone app'
require_block_text "$project_release" 'NEARCAST_COMPANION_BUNDLE_IDENTIFIER = app.nearcast.ios;' 'Release Watch must point at the production phone app'
require_block_text "$project_debug" 'NEARCAST_WATCH_REFRESH_IDENTIFIER = app.nearcast.ios.dev.watch.weather-refresh;' 'Debug Watch refresh identifier must remain isolated'
require_block_text "$project_release" 'NEARCAST_WATCH_REFRESH_IDENTIFIER = app.nearcast.watch.weather-refresh;' 'Release Watch refresh identifier must remain production-only'
require_block_text "$project_debug" 'SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG NEARCAST_DEV $(inherited)";' 'Debug must retain the Dev compilation condition'
forbid_block_text "$project_release" 'NEARCAST_DEV' 'Release must not define the Dev compilation condition'

# Main app target and each embedded companion must have a different install
# identity in Debug and Release. These IDs are deliberately explicit here:
# app-group sharing alone does not prevent an extension from colliding with its
# production counterpart.
app_debug="$(configuration_block AA0000000000000000000003)"
app_release="$(configuration_block AA0000000000000000000004)"
widget_debug="$(configuration_block BB0000000000000000000001)"
widget_release="$(configuration_block BB0000000000000000000002)"
watch_debug="$(configuration_block DD0000000000000000000001)"
watch_release="$(configuration_block DD0000000000000000000002)"
complications_debug="$(configuration_block EE0000000000000000000001)"
complications_release="$(configuration_block EE0000000000000000000002)"

for block_name in app_debug app_release widget_debug widget_release watch_debug watch_release complications_debug complications_release; do
  [[ -n "${!block_name}" ]] || fail "could not read ${block_name} target configuration"
done

require_block_text "$app_debug" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.dev;' 'Debug phone app identity must remain isolated'
require_block_text "$app_release" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios;' 'Release phone app identity must remain production'
require_block_text "$app_debug" 'INFOPLIST_FILE = "NearcastApp/Support/Info-Debug.plist";' 'Debug phone app must use the Dev Info.plist'
require_block_text "$app_release" 'INFOPLIST_FILE = "NearcastApp/Support/Info-Release.plist";' 'Release phone app must use the production Info.plist'
require_block_text "$app_debug" 'CODE_SIGN_ENTITLEMENTS = "NearcastApp/Support/Nearcast-Debug.entitlements";' 'Debug phone app must use Dev entitlements'
require_block_text "$app_release" 'CODE_SIGN_ENTITLEMENTS = "NearcastApp/Support/Nearcast-Release.entitlements";' 'Release phone app must use production entitlements'
require_block_text "$app_release" 'CODE_SIGN_STYLE = Manual;' 'Release phone app must retain its distribution signing lane'

require_block_text "$widget_debug" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.dev.widget;' 'Debug widget identity must remain isolated'
require_block_text "$widget_release" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.widget;' 'Release widget identity must remain production'
require_block_text "$watch_debug" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.dev.watch;' 'Debug Watch identity must remain isolated'
require_block_text "$watch_release" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.watch;' 'Release Watch identity must remain production'
require_block_text "$complications_debug" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.dev.watch.complications;' 'Debug complications identity must remain isolated'
require_block_text "$complications_release" 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.watch.complications;' 'Release complications identity must remain production'

forbid_block_text "$app_release" 'app.nearcast.ios.dev' 'Release phone app must not contain a Dev identity'
forbid_block_text "$widget_release" 'app.nearcast.ios.dev' 'Release widget must not contain a Dev identity'
forbid_block_text "$watch_release" 'app.nearcast.ios.dev' 'Release Watch must not contain a Dev identity'
forbid_block_text "$complications_release" 'app.nearcast.ios.dev' 'Release complications must not contain a Dev identity'

# Both identities now explicitly opt into native-only. Missing configuration
# still fails closed in the runtime rather than silently changing old builds.
debug_native_only="$(/usr/bin/plutil -extract NearcastNativeOnlyExperience raw -o - "$DEBUG_INFO")"
[[ "$debug_native_only" == 'true' ]] || fail 'Debug must explicitly enable native-only experience'
release_native_only="$(/usr/bin/plutil -extract NearcastNativeOnlyExperience raw -o - "$RELEASE_INFO")"
[[ "$release_native_only" == 'true' ]] || fail 'Release must explicitly enable native-only experience'
sky_feature="$(sed -n '/enum NativeLivingSkyFeature {/,/^}/p' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyBackdrop.swift")"
[[ "$sky_feature" == *$'#else\n        return true'* ]] || fail 'Release must enable the reviewed Living Sky'
forbid_text '<key>NSAllowsArbitraryLoadsInWebContent</key>' "$RELEASE_INFO" 'Release must not inherit Debug WebKit transport exceptions'
forbid_text '<key>NSAllowsLocalNetworking</key>' "$RELEASE_INFO" 'Release must not inherit Debug local-network transport settings'
require_text '<key>aps-environment</key>' "$DEBUG_ENTITLEMENTS" 'Debug APNs entitlement is missing'
require_text '<string>development</string>' "$DEBUG_ENTITLEMENTS" 'Debug must use development APNs'
require_text '<key>aps-environment</key>' "$RELEASE_ENTITLEMENTS" 'Release APNs entitlement is missing'
require_text '<string>production</string>' "$RELEASE_ENTITLEMENTS" 'Release must use production APNs'

for entitlement in \
  "$DEBUG_ENTITLEMENTS" \
  "$RELEASE_ENTITLEMENTS" \
  "$ROOT/native/ios/NearcastWidget/NearcastWidget.entitlements" \
  "$ROOT/native/ios/NearcastWatch/NearcastWatch.entitlements" \
  "$ROOT/native/ios/NearcastWatchComplications/NearcastWatchComplications.entitlements"; do
  require_text '$(NEARCAST_APP_GROUP_IDENTIFIER)' "$entitlement" "shared app group must be configuration-driven in $(basename "$entitlement")"
done

require_text '<ArchiveAction' "$DEV_SCHEME" 'Dev scheme archive action is missing'
require_text 'buildConfiguration = "Debug"' "$DEV_SCHEME" 'Dev scheme must archive Debug only'
require_text '<ArchiveAction' "$RELEASE_SCHEME" 'Release scheme archive action is missing'
require_text 'buildConfiguration = "Release"' "$RELEASE_SCHEME" 'Release scheme must archive Release'

printf 'PASS  Native Release identity and delivery boundary\n'

if [[ "$BUILD" == true ]]; then
  command -v xcodebuild >/dev/null 2>&1 || fail 'xcodebuild is required for --build'
  BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-release-simulator.XXXXXX")"
  BUILD_LOG="$BUILD_ROOT/xcodebuild.log"
  trap 'rm -rf "$BUILD_ROOT"' EXIT
  printf 'Building unsigned Nearcast Release for the iOS Simulator...\n'
  if ! xcodebuild -quiet \
      -project "$PROJECT" \
      -scheme Nearcast \
      -configuration Release \
      -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$BUILD_ROOT/DerivedData" \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO \
      CODE_SIGN_IDENTITY='' \
      build >"$BUILD_LOG" 2>&1; then
    tail -n 160 "$BUILD_LOG" >&2
    fail 'unsigned Nearcast Release simulator build failed'
  fi
  printf 'PASS  Unsigned Nearcast Release simulator build\n'
fi
