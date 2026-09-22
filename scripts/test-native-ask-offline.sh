#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-native-ask-offline.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
xcrun swiftc -module-cache-path "$TEST_ROOT/ModuleCache" \
  "$ROOT/native/ios/Shared/NearcastForecastSemantics.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeLegacySourceScope.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherForecast.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherOutlook.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeForecastRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeWeatherPreviewContext.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlacesControlsModel.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlaceLookupService.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAgendaRepository.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativePlanLibrary.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskRead.swift" \
  "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskConversation.swift" \
  "$ROOT/scripts/native-ask-offline-test.swift" -o "$TEST_ROOT/tests"
"$TEST_ROOT/tests" "$TEST_ROOT"

# Native voice remains a draft-only UI; it must never route through a web page
# or opt into server recognition when the on-device recognizer is unavailable.
rg -q 'request.requiresOnDeviceRecognition = true' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskSpeechController.swift"
rg -q 'recognizer.supportsOnDeviceRecognition' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskSpeechController.swift"
if rg -n 'WebKit|WKWebView|evaluateJavaScript|URLSession|conversation.send' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskSpeechController.swift"; then
  exit 1
fi
rg -q 'onDisappear \{ speech.cancel\(\) \}' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskExperience.swift"
rg -q 'if phase != .active \{ speech.cancel\(\) \}' "$ROOT/native/ios/NearcastApp/NativeWeather/NativeAskExperience.swift"
echo 'PASS Native Ask voice source contract: on-device only, reviewable draft, lifecycle cancellation'
