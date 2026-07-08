#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_FILE="$ROOT_DIR/native/ios/Nearcast.xcodeproj/project.pbxproj"

if [ "${CI_XCODE_CLOUD:-}" = "TRUE" ] || [ "${NEARCAST_FORCE_CI_BUILD_NUMBER:-}" = "1" ]; then
  BUILD_NUMBER="${NEARCAST_CI_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
  echo "Stamping Nearcast cloud build number: $BUILD_NUMBER"
  perl -0pi -e "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" "$PROJECT_FILE"
else
  echo "Skipping cloud build-number stamp outside Xcode Cloud"
fi

echo "Validating Nearcast iOS plist files"
plutil -lint \
  "$ROOT_DIR/native/ios/NearcastApp/Support/Info-Debug.plist" \
  "$ROOT_DIR/native/ios/NearcastApp/Support/Info-Release.plist" \
  "$ROOT_DIR/native/ios/NearcastWidget/Info.plist"

echo "Nearcast iOS pre-build checks passed"
