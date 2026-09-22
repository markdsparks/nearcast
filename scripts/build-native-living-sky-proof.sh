#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROOF_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-living-sky-proof.XXXXXX")"
APP_PATH="$PROOF_ROOT/LivingSkyProof.app"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"
mkdir -p "$APP_PATH"
cp "$ROOT/native/experiments/LivingSkyProof/Info.plist" "$APP_PATH/Info.plist"
xcrun actool "$ROOT/native/ios/NearcastApp/Assets.xcassets" \
  --compile "$APP_PATH" --platform iphonesimulator --minimum-deployment-target 18.0 \
  --target-device iphone >/dev/null
xcrun --sdk iphonesimulator swiftc -parse-as-library -sdk "$SDK" -target "$ARCH-apple-ios18.0-simulator" \
  -module-cache-path "$PROOF_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeSunDaylight.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyScene.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyMotion.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeSkyStars.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyStarsView.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyCloudMotionView.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyRainView.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLivingSkyBackdrop.swift" \
  "$ROOT/native/experiments/LivingSkyProof/NativeSkyMotionVerificationView.swift" \
  "$ROOT/native/experiments/LivingSkyProof/NativeSkyStarsVerificationView.swift" \
  "$ROOT/native/experiments/LivingSkyProof/NativeSkyBackdropVerificationView.swift" \
  "$ROOT/native/experiments/LivingSkyProof/NativeSkyRainVerificationView.swift" \
  "$ROOT/native/experiments/LivingSkyProof/NativeSkyRainReadabilityView.swift" \
  "$ROOT/native/experiments/LivingSkyProof/NativeSkySnowVerificationView.swift" \
  "$ROOT/native/experiments/LivingSkyProof/LivingSkyProofApp.swift" \
  -o "$APP_PATH/LivingSkyProof"
codesign --force --sign - "$APP_PATH"
echo "PASS Native living sky simulator proof: $APP_PATH"
echo "Simulator-only illustrative review, not linked into Nearcast or TestFlight."
