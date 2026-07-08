#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_FILE="$ROOT_DIR/native/ios/Nearcast.xcodeproj/project.pbxproj"

if [ -n "${CI_XCODE_CLOUD:-}" ] || [ -n "${CI:-}" ] || [ "${NEARCAST_FORCE_CI_BUILD_NUMBER:-}" = "1" ]; then
  BUILD_NUMBER="${NEARCAST_CI_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
  echo "Stamping Nearcast cloud build number: $BUILD_NUMBER"
  perl -0pi -e "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" "$PROJECT_FILE"
else
  echo "Skipping cloud build-number stamp outside CI"
fi
