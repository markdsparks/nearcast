#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/native/ios/Nearcast.xcodeproj"
PROJECT_FILE="$PROJECT/project.pbxproj"
EXPORT_OPTIONS="$ROOT/native/ios/ExportOptions-TestFlightManual.plist"
VALIDATOR="$ROOT/scripts/validate-nearcast-archive.sh"
KEY_PATH="${NEARCAST_ASC_KEY_PATH:-$ROOT/AppStoreConnect/AuthKey_8LM389Z6NR.p8}"
KEY_ID="${NEARCAST_ASC_KEY_ID:-8LM389Z6NR}"
ISSUER_ID="${NEARCAST_ASC_ISSUER_ID:-00459337-a0be-4634-9c5c-96ea253447e9}"

versions="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([0-9][0-9]*\);/\1/p' "$PROJECT_FILE" | sort -u)"
version_count="$(printf '%s\n' "$versions" | sed '/^$/d' | wc -l | tr -d ' ')"

if [[ "$version_count" != "1" ]]; then
  printf 'FAIL  App, widget, and Watch build numbers do not match:\n%s\n' "$versions" >&2
  exit 1
fi

build="${1:-$versions}"
if [[ "$build" != "$versions" ]]; then
  printf 'FAIL  Requested build %s but the Xcode project is on build %s\n' "$build" "$versions" >&2
  printf 'Update every CURRENT_PROJECT_VERSION before publishing.\n' >&2
  exit 1
fi

if [[ ! -f "$KEY_PATH" ]]; then
  printf 'FAIL  App Store Connect API key not found: %s\n' "$KEY_PATH" >&2
  exit 1
fi

printf 'Running production Trust Loop release preflight...\n'
bash "$ROOT/scripts/nearcast-ci.sh" portable
bash "$ROOT/scripts/nearcast-ci.sh" native-model
/usr/bin/plutil -lint \
  "$ROOT/native/ios/NearcastApp/Support/Info-Debug.plist" \
  "$ROOT/native/ios/NearcastApp/Support/Info-Release.plist" \
  "$ROOT/native/ios/NearcastWidget/Info.plist" \
  "$ROOT/native/ios/NearcastWatch/Info.plist" \
  "$ROOT/native/ios/NearcastWatchComplications/Info.plist"

archive="$ROOT/native/ios/build/Nearcast-${build}.xcarchive"
export_path="$ROOT/native/ios/build/upload-testflight-${build}"

printf 'Archiving Nearcast build %s with iPhone, widget, and Watch products...\n' "$build"
xcodebuild \
  -project "$PROJECT" \
  -scheme Nearcast \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  archive \
  -allowProvisioningUpdates

"$VALIDATOR" "$archive"

printf 'Uploading validated build %s to TestFlight...\n' "$build"
xcodebuild \
  -exportArchive \
  -archivePath "$archive" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER_ID"

printf 'PASS  Nearcast build %s uploaded to TestFlight\n' "$build"
