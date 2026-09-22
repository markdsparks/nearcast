#!/bin/bash
set -euo pipefail

# Protect the boundary between the side-by-side native-only Dev lane and the
# shipping/TestFlight configuration.  This is intentionally a source-level
# guard: both lanes are native-only, but delivery and storage stay isolated.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEBUG_INFO="$ROOT/native/ios/NearcastApp/Support/Info-Debug.plist"
RELEASE_INFO="$ROOT/native/ios/NearcastApp/Support/Info-Release.plist"
PROJECT="$ROOT/native/ios/Nearcast.xcodeproj/project.pbxproj"
RUNTIME="$ROOT/native/ios/NearcastApp/Bridge/NativeRuntimeConfiguration.swift"

fail() {
  printf 'FAIL  Native Dev cutover configuration: %s\n' "$1" >&2
  exit 1
}

require() {
  local needle="$1"
  local file="$2"
  local message="$3"
  rg -q --fixed-strings "$needle" "$file" || fail "$message"
}

require '<key>NearcastNativeOnlyExperience</key>' "$DEBUG_INFO" \
  'Debug must declare the native-only experience flag'
require '<true/>' "$DEBUG_INFO" \
  'Debug must enable the native-only experience flag'

[[ "$(/usr/bin/plutil -extract NearcastNativeOnlyExperience raw -o - "$RELEASE_INFO")" == true ]] \
  || fail 'Release/TestFlight must retain the explicitly promoted native root'

require 'PRODUCT_BUNDLE_IDENTIFIER = app.nearcast.ios.dev;' "$PROJECT" \
  'Dev must retain its side-by-side app identity'
require 'NEARCAST_APP_GROUP_IDENTIFIER = group.app.nearcast.ios.dev;' "$PROJECT" \
  'Dev must retain its isolated shared container'
require 'NEARCAST_URL_SCHEME = nearcast-dev;' "$PROJECT" \
  'Dev must retain its isolated deep-link scheme'
require 'NEARCAST_REMOTE_DELIVERY_ENABLED = NO;' "$PROJECT" \
  'Dev must not send through production remote delivery'
require 'if arguments.contains("-nearcast-web") { return false }' "$RUNTIME" \
  'The compatibility shell must remain an engineer-only process escape hatch'

printf 'PASS  Native Dev stays isolated alongside the promoted native Release\n'
