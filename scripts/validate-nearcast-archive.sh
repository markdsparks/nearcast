#!/bin/bash

set -euo pipefail

archive="${1:-}"
if [[ -z "$archive" ]]; then
  printf 'Usage: scripts/validate-nearcast-archive.sh PATH_TO_XCARCHIVE\n' >&2
  exit 2
fi

if [[ ! -d "$archive" ]]; then
  printf 'FAIL  Archive does not exist: %s\n' "$archive" >&2
  exit 1
fi

app="$archive/Products/Applications/Nearcast.app"
widget="$app/PlugIns/NearcastWidgetExtension.appex"
watch="$app/Watch/NearcastWatch.app"
watch_complications="$watch/PlugIns/NearcastWatchComplications.appex"

require_bundle() {
  local path="$1"
  local label="$2"
  if [[ ! -d "$path" ]]; then
    printf 'FAIL  %s is missing: %s\n' "$label" "$path" >&2
    exit 1
  fi
  printf 'PASS  %s is packaged\n' "$label"
}

require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -s "$path" ]]; then
    printf 'FAIL  %s is missing or empty: %s\n' "$label" "$path" >&2
    exit 1
  fi
}

bundle_executable() {
  local bundle="$1"
  local executable
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$bundle/Info.plist" 2>/dev/null || true)"
  if [[ -z "$executable" || "$executable" == */* || "$executable" == "." || "$executable" == ".." ]]; then
    printf 'FAIL  Bundle executable name is invalid: %s\n' "$bundle" >&2
    exit 1
  fi
  require_file "$bundle/$executable" "Bundle executable"
  printf '%s\n' "$bundle/$executable"
}

validate_native_radar_lab() {
  local framework="$app/Frameworks/MapLibre.framework"
  local framework_binary="$framework/MapLibre"
  local supported_platform platform_name sdk_name architectures architecture load_commands
  local app_binary app_links app_load_commands resource bundle bundled_sdk binary links

  require_bundle "$framework" "Native radar MapLibre framework"
  require_file "$framework_binary" "MapLibre device binary"
  require_file "$framework/Info.plist" "MapLibre bundle metadata"
  supported_platform="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$framework/Info.plist" 2>/dev/null || true)"
  platform_name="$(/usr/libexec/PlistBuddy -c 'Print :DTPlatformName' "$framework/Info.plist" 2>/dev/null || true)"
  sdk_name="$(/usr/libexec/PlistBuddy -c 'Print :DTSDKName' "$framework/Info.plist" 2>/dev/null || true)"
  if [[ "$supported_platform" != "iPhoneOS" || "$platform_name" != "iphoneos" || "$sdk_name" != iphoneos* ]]; then
    printf 'FAIL  MapLibre framework is not device-platform metadata (platform=%s, name=%s, SDK=%s)\n' \
      "$supported_platform" "$platform_name" "$sdk_name" >&2
    exit 1
  fi
  # An arm64 slice alone can still be a simulator binary. Inspect every slice's
  # load command as well as the XCFramework-selected bundle's Info.plist.
  architectures="$(xcrun lipo -archs "$framework_binary")"
  if [[ " $architectures " != *" arm64 "* ]]; then
    printf 'FAIL  MapLibre has no arm64 device slice: %s\n' "$architectures" >&2
    exit 1
  fi
  for architecture in $architectures; do
    if [[ "$architecture" != "arm64" && "$architecture" != "arm64e" ]]; then
      printf 'FAIL  Unexpected MapLibre device architecture: %s\n' "$architecture" >&2
      exit 1
    fi
    load_commands="$(xcrun otool -arch "$architecture" -l "$framework_binary")"
    if ! awk '
      $1 == "cmd" { command = $2 }
      command == "LC_BUILD_VERSION" && $1 == "platform" { count++; platform = $2 }
      END { exit !(count == 1 && (platform == "2" || platform == "IOS")) }
    ' <<< "$load_commands"; then
      printf 'FAIL  MapLibre %s Mach-O does not target the iOS device platform\n' "$architecture" >&2
      exit 1
    fi
  done
  if ! /usr/bin/codesign --verify --strict "$framework"; then
    printf 'FAIL  Embedded MapLibre signature is invalid\n' >&2
    exit 1
  fi
  require_file "$framework/PrivacyInfo.xcprivacy" "MapLibre privacy manifest"
  /usr/bin/plutil -lint "$framework/PrivacyInfo.xcprivacy"

  app_binary="$(bundle_executable "$app")"
  app_links="$(xcrun otool -L "$app_binary")"
  if ! awk '$1 == "@rpath/MapLibre.framework/MapLibre" { found = 1 } END { exit !found }' <<< "$app_links"; then
    printf 'FAIL  iPhone app does not link the embedded MapLibre framework\n' >&2
    exit 1
  fi
  app_load_commands="$(xcrun otool -l "$app_binary")"
  if ! awk '
    $1 == "cmd" { command = $2 }
    command == "LC_RPATH" && $1 == "path" && $2 == "@executable_path/Frameworks" { found = 1 }
    END { exit !found }
  ' <<< "$app_load_commands"; then
    printf 'FAIL  iPhone app lacks the embedded-framework runtime search path\n' >&2
    exit 1
  fi
  for resource in DiagnosticStyle.json numeric-contract.json \
    MapLibre-LICENSE.md MapLibre-iOS-NOTICES.md MapLibre-core-NOTICES.md; do
    require_file "$app/$resource" "Native radar resource $resource"
  done

  # Only the opt-in iPhone lab uses this SDK. Reject both accidentally copied
  # bundles and unresolved framework links in the widget/Watch products.
  for bundle in "$widget" "$watch" "$watch_complications"; do
    bundled_sdk="$(/usr/bin/find "$bundle" -type d \( -name MapLibre.framework -o -name MapLibre.xcframework \) -print -quit)"
    if [[ -n "$bundled_sdk" ]]; then
      printf 'FAIL  MapLibre must not be packaged in widget/Watch products: %s\n' "$bundled_sdk" >&2
      exit 1
    fi
    binary="$(bundle_executable "$bundle")"
    links="$(xcrun otool -L "$binary")"
    if [[ "$links" == *MapLibre.framework/* ]]; then
      printf 'FAIL  Widget/Watch executable must not link MapLibre: %s\n' "$binary" >&2
      exit 1
    fi
  done
  printf 'PASS  Native radar device SDK, signature, linkage, privacy and resources are packaged\n'
  printf 'PASS  MapLibre is absent from widget and Watch products\n'
}

require_bundle "$app" "iPhone app"
require_bundle "$widget" "Widget extension"
require_bundle "$watch" "Apple Watch app"
require_bundle "$watch_complications" "Apple Watch complications"

app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Info.plist")"
widget_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$widget/Info.plist")"
watch_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$watch/Info.plist")"
watch_complications_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$watch_complications/Info.plist")"
watch_companion="$(/usr/libexec/PlistBuddy -c 'Print :WKCompanionAppBundleIdentifier' "$watch/Info.plist")"
watch_icon_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIcons:CFBundlePrimaryIcon:CFBundleIconName' "$watch/Info.plist")"
watch_url_scheme="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$watch/Info.plist")"
widget_wants_location="$(/usr/libexec/PlistBuddy -c 'Print :NSWidgetWantsLocation' "$widget/Info.plist" 2>/dev/null || true)"
app_location_usage="$(/usr/libexec/PlistBuddy -c 'Print :NSLocationWhenInUseUsageDescription' "$app/Info.plist" 2>/dev/null || true)"
watch_location_usage="$(/usr/libexec/PlistBuddy -c 'Print :NSLocationWhenInUseUsageDescription' "$watch/Info.plist" 2>/dev/null || true)"

if [[ "$app_version" != "$widget_version" || "$app_version" != "$watch_version" || "$app_version" != "$watch_complications_version" ]]; then
  printf 'FAIL  Build numbers differ: app=%s widget=%s watch=%s complications=%s\n' \
    "$app_version" "$widget_version" "$watch_version" "$watch_complications_version" >&2
  exit 1
fi

if [[ "$watch_companion" != "app.nearcast.ios" ]]; then
  printf 'FAIL  Watch companion bundle identifier is %s\n' "$watch_companion" >&2
  exit 1
fi

if [[ "$watch_icon_name" != "AppIcon" || ! -f "$watch/Assets.car" ]]; then
  printf 'FAIL  Watch app icon catalog is missing or not compiled\n' >&2
  exit 1
fi

if [[ "$watch_url_scheme" != "nearcast" ]]; then
  printf 'FAIL  Watch deep-link URL scheme is %s\n' "$watch_url_scheme" >&2
  exit 1
fi

if [[ "$widget_wants_location" != "true" || -z "$app_location_usage" || -z "$watch_location_usage" ]]; then
  printf 'FAIL  Current Location metadata is incomplete (widget=%s app-purpose=%s watch-purpose=%s)\n' \
    "$widget_wants_location" "${app_location_usage:+present}" "${watch_location_usage:+present}" >&2
  exit 1
fi

printf 'PASS  Build number %s matches across app, widget, Watch, and complications\n' "$app_version"
printf 'PASS  Watch companion bundle identifier is app.nearcast.ios\n'
printf 'PASS  Watch app icon catalog is compiled\n'
printf 'PASS  Watch deep links use the nearcast URL scheme\n'
printf 'PASS  Widget and Watch Current Location metadata is packaged\n'
if [[ ! "$app_version" =~ ^[0-9]{1,9}$ ]]; then
  printf 'FAIL  Nearcast archive build number must be a bounded integer: %s\n' "$app_version" >&2
  exit 1
fi
if (( 10#$app_version >= 106 )); then
  validate_native_radar_lab
fi
if (( 10#$app_version >= 134 )); then
  native_root="$(/usr/libexec/PlistBuddy -c 'Print :NearcastNativeOnlyExperience' "$app/Info.plist" 2>/dev/null || true)"
  remote_delivery="$(/usr/libexec/PlistBuddy -c 'Print :NearcastRemoteDeliveryEnabled' "$app/Info.plist" 2>/dev/null || true)"
  [[ "$native_root" == true && "$remote_delivery" == YES ]] || {
    printf 'FAIL  Native Release archive must enable native root and production delivery\n' >&2
    exit 1
  }
  printf 'PASS  Native root and production delivery are enabled in the archive\n'
fi
printf 'PASS  Archive is ready for export validation\n'
