#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Validating Nearcast iOS plist files"
plutil -lint \
  "$ROOT_DIR/native/ios/NearcastApp/Support/Info-Debug.plist" \
  "$ROOT_DIR/native/ios/NearcastApp/Support/Info-Release.plist" \
  "$ROOT_DIR/native/ios/NearcastWidget/Info.plist"

echo "Nearcast iOS pre-build checks passed"

