#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-foundation.XXXXXX")"
APP_PATH="$BUILD_ROOT/RadarFoundation.app"
SOURCE="$ROOT/native/experiments/NativeRadarFoundation"
VERSION="6.31.0"
EXPECTED="de3aaa435dd86768b06d90245e630d068dd7eef1491afae7217d1654c52c462a"
ARCHIVE="$BUILD_ROOT/MapLibre.zip"

# Exact official binary + checksum from the tagged upstream Package.swift.
# An optional already-downloaded archive still goes through the same check.
if [[ -n "${NEARCAST_RADAR_SDK_ARCHIVE:-}" ]]; then
  cp "$NEARCAST_RADAR_SDK_ARCHIVE" "$ARCHIVE"
else
  curl --fail --location --retry 2 --connect-timeout 15 --max-time 180 \
    "https://github.com/maplibre/maplibre-native/releases/download/ios-v${VERSION}/MapLibre.dynamic.xcframework.zip" \
    --output "$ARCHIVE"
fi
ACTUAL="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  printf 'FAIL MapLibre checksum mismatch; no SDK was executed.\n' >&2
  exit 1
fi
ditto -x -k "$ARCHIVE" "$BUILD_ROOT/SDK"
FRAMEWORK_ROOT="$BUILD_ROOT/SDK/MapLibre.xcframework/ios-arm64_x86_64-simulator"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"
mkdir -p "$APP_PATH/Frameworks"
cp "$SOURCE/Info.plist" "$APP_PATH/Info.plist"
cp "$SOURCE/DiagnosticStyle.json" "$SOURCE/MapLibre-LICENSE.md" \
  "$SOURCE/MapLibre-iOS-NOTICES.md" "$SOURCE/MapLibre-core-NOTICES.md" "$APP_PATH/"
cp "$ROOT/scripts/fixtures/native-radar/numeric-contract.json" "$APP_PATH/"
ditto "$FRAMEWORK_ROOT/MapLibre.framework" "$APP_PATH/Frameworks/MapLibre.framework"

xcrun --sdk iphonesimulator swiftc -parse-as-library -swift-version 5 -D NEARCAST_RADAR_STANDALONE \
  -sdk "$SDK" -target "$ARCH-apple-ios17.0-simulator" \
  -module-cache-path "$BUILD_ROOT/ModuleCache" -F "$FRAMEWORK_ROOT" -framework MapLibre \
  -Xlinker -rpath -Xlinker @executable_path/Frameworks \
  "$ROOT/native/experiments/RadarSubstrateProof/RadarProofContract.swift" \
  "$SOURCE/RadarTimelineContract.swift" \
  "$SOURCE/RadarNumericContract.swift" \
  "$SOURCE/RadarFoundationModel.swift" \
  "$SOURCE/RadarFoundationMap.swift" \
  "$SOURCE/RadarFoundationApp.swift" \
  -o "$APP_PATH/RadarFoundation"
codesign --force --sign - "$APP_PATH/Frameworks/MapLibre.framework"
codesign --force --sign - "$APP_PATH"
printf 'PASS Native radar foundation simulator build: %s\n' "$APP_PATH"
printf 'Standalone diagnostic app. MapLibre %s, verified SHA-256.\n' "$VERSION"
