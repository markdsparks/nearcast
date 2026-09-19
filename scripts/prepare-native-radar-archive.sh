#!/bin/bash
# Archive-only workaround for the verified MapLibre 6.31.0 device artifact's
# simulator-valued bundle metadata. Never edits the SDK download or SPM cache.
# Signing changes signature material, not the SDK's executable implementation.
set -euo pipefail

fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
[[ $# -ge 2 && $# -le 3 ]] || fail 'Usage: prepare-native-radar-archive.sh ARCHIVE SIGNING_IDENTITY [--allow-ad-hoc-test]'
archive_input="$1"
signing_identity="$2"
test_option="${3:-}"
[[ -n "$signing_identity" ]] || fail 'An explicit signing certificate is required.'
[[ -d "$archive_input" && ! -L "$archive_input" ]] || fail 'Archive must be a real directory, not a symlink.'
archive="$(cd "$archive_input" && pwd -P)"
[[ "$archive" == *.xcarchive ]] || fail 'Only a built .xcarchive is supported.'
if [[ "$signing_identity" == '-' ]]; then
  [[ "$test_option" == '--allow-ad-hoc-test' && "$archive" == /private/tmp/nearcast-radar-prepare-test.*/*.xcarchive ]] \
    || fail 'Ad-hoc signing is allowed only for explicitly opted-in isolated /private/tmp test archives.'
elif [[ -n "$test_option" ]]; then
  fail 'The test flag is not accepted with a production signing identity.'
fi

app="$archive/Products/Applications/Nearcast.app"
framework="$app/Frameworks/MapLibre.framework"
info="$framework/Info.plist"
binary="$framework/MapLibre"
for directory in "$archive/Products" "$archive/Products/Applications" "$app" "$app/Frameworks" "$framework"; do
  [[ -d "$directory" && ! -L "$directory" ]] || fail "Missing or symlinked archive directory: $directory"
done
[[ -z "$(/usr/bin/find "$app" -type l -print -quit)" ]] || fail 'Symlinks in the app are unsupported; refusing to follow external code/resources.'
read_plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null; }
[[ "$(read_plist "$app/Info.plist" CFBundleIdentifier)" == app.nearcast.ios ]] || fail 'Archive is not the Nearcast iPhone app.'
[[ "$(read_plist "$info" CFBundleIdentifier)" == com.maplibre.mapbox ]] || fail 'Unknown framework bundle identifier.'
[[ "$(read_plist "$info" CFBundleExecutable)" == MapLibre ]] || fail 'Unknown framework executable.'
[[ "$(read_plist "$info" CFBundleShortVersionString)" == 6.31.0 && "$(read_plist "$info" CFBundleVersion)" == 6.31.0 ]] \
  || fail 'Only the reviewed MapLibre 6.31.0 metadata defect is supported.'
[[ -s "$binary" && -s "$framework/PrivacyInfo.xcprivacy" ]] || fail 'Framework binary/privacy manifest is missing.'
for resource in MapLibre-LICENSE.md MapLibre-iOS-NOTICES.md MapLibre-core-NOTICES.md; do
  [[ -s "$app/$resource" ]] || fail "Missing required license resource: $resource"
done

platform="$(read_plist "$info" CFBundleSupportedPlatforms:0)"
[[ -z "$(read_plist "$info" CFBundleSupportedPlatforms:1 || true)" ]] || fail 'Unknown multi-platform framework metadata.'
platform_name="$(read_plist "$info" DTPlatformName)"
sdk_name="$(read_plist "$info" DTSDKName)"
sdk_version="$(read_plist "$info" DTPlatformVersion)"
# This suffix is checked against the exact observed upstream defect, then the
# actual supplied value is retained. Never replace it with this Mac's SDK version.
[[ "$sdk_version" == 26.5 ]] || fail 'Unknown SDK build metadata for the reviewed artifact.'
if [[ "$platform" == iPhoneSimulator && "$platform_name" == iphonesimulator && "$sdk_name" == "iphonesimulator$sdk_version" ]]; then
  needs_correction=true
elif [[ "$platform" == iPhoneOS && "$platform_name" == iphoneos && "$sdk_name" == "iphoneos$sdk_version" ]]; then
  needs_correction=false
else
  fail "Unknown/mixed SDK platform metadata: $platform / $platform_name / $sdk_name"
fi

[[ "$(xcrun lipo -archs "$binary")" == arm64 ]] || fail 'Expected the exact device-only arm64 framework slice.'
load_commands="$(xcrun otool -arch arm64 -l "$binary")"
awk '
  $1 == "cmd" { command = $2 }
  command == "LC_BUILD_VERSION" && $1 == "platform" { count++; platform = $2 }
  END { exit !(count == 1 && (platform == "2" || platform == "IOS")) }
' <<< "$load_commands" || fail 'Framework Mach-O is not an iOS device binary.'
/usr/bin/codesign --verify --strict --verbose=2 "$framework" || fail 'Incoming embedded framework signature is invalid.'
/usr/bin/codesign --verify --strict --deep --verbose=2 "$app" || fail 'Incoming app/nested signatures are invalid.'
for code in "$framework" "$app"; do
  signature="$(/usr/bin/codesign --display --verbose=4 "$code" 2>&1)"
  [[ "$signature" != *linker-signed* ]] || fail 'A linker-only signature cannot preserve signing metadata.'
done
if [[ "$needs_correction" == false ]]; then
  printf 'PASS  MapLibre 6.31.0 archive metadata is already device-correct; no files or signatures changed.\n'
  exit 0
fi

preserve='identifier,entitlements,requirements,flags,runtime,launch-constraints,library-constraints'
# Check certificate/private-key access before creating or modifying staged code.
/usr/bin/codesign --dryrun --force --sign "$signing_identity" --preserve-metadata="$preserve" "$framework"
/usr/bin/codesign --dryrun --force --sign "$signing_identity" --preserve-metadata="$preserve" "$app"
# A sibling stays on the same filesystem for renames but cannot be discovered
# as an extra product by archive export/validation.
stage="$(mktemp -d "$(dirname "$archive")/.nearcast-radar-prepare.XXXXXX")"
staged_app="$stage/Nearcast.app"
staged_framework="$staged_app/Frameworks/MapLibre.framework"
backup="$stage/OriginalNearcast.app"
original_moved=false
replacement_installed=false
finish() {
  local result=$?
  if [[ "$result" -ne 0 && "$original_moved" == true ]]; then
    if [[ "$replacement_installed" == true ]]; then
      /bin/mv "$app" "$stage/FailedNearcast.app" || {
        printf 'FAIL  Could not move failed replacement aside; restore original manually from %s\n' "$backup" >&2
        return "$result"
      }
    fi
    /bin/mv "$backup" "$app" || printf 'FAIL  Restore original app manually from %s\n' "$backup" >&2
  fi
  if [[ "$result" -ne 0 ]]; then
    printf 'FAIL  Archive preparation did not complete. Original/staged recovery files: %s\n' "$stage" >&2
  fi
}
trap finish EXIT
/usr/bin/ditto "$app" "$staged_app"
printf 'PREPARE  Correcting the documented MapLibre 6.31.0 device-framework plist defect in this built archive only.\n'
printf 'PREPARE  %s / %s / %s -> iPhoneOS / iphoneos / iphoneos%s\n' "$platform" "$platform_name" "$sdk_name" "$sdk_version"

code_hash() {
  xcrun otool -arch arm64 -s __TEXT __text "$1" | sed '1d' | shasum -a 256 | awk '{print $1}'
}
original_code_hash="$(code_hash "$binary")"
original_metadata="$(/usr/bin/plutil -p "$info")"
for pair in framework app; do
  code="$app"
  [[ "$pair" != framework ]] || code="$framework"
  /usr/bin/codesign --display --entitlements "$stage/$pair-before.entitlements" --xml "$code" 2>/dev/null
  /usr/bin/codesign --display --requirements "$stage/$pair-before.requirements" "$code" 2>/dev/null
  if [[ "$pair" == app ]]; then
    [[ -s "$stage/app-before.entitlements" ]] || fail 'Could not extract required original app entitlements.'
    /usr/bin/plutil -lint "$stage/app-before.entitlements" >/dev/null
    [[ "$(read_plist "$stage/app-before.entitlements" application-identifier)" == *.app.nearcast.ios ]] \
      || fail 'Original application-identifier entitlement does not identify Nearcast.'
  fi
done
/usr/libexec/PlistBuddy -c 'Set :CFBundleSupportedPlatforms:0 iPhoneOS' "$staged_framework/Info.plist"
/usr/bin/plutil -replace DTPlatformName -string iphoneos "$staged_framework/Info.plist"
/usr/bin/plutil -replace DTSDKName -string "iphoneos$sdk_version" "$staged_framework/Info.plist"
# Round-trip only those three keys in a comparison copy; every other plist field
# (IDs, versions, compiler/build information, etc.) must remain semantically equal.
/bin/cp "$staged_framework/Info.plist" "$stage/metadata-comparison.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleSupportedPlatforms:0 $platform" "$stage/metadata-comparison.plist"
/usr/bin/plutil -replace DTPlatformName -string "$platform_name" "$stage/metadata-comparison.plist"
/usr/bin/plutil -replace DTSDKName -string "$sdk_name" "$stage/metadata-comparison.plist"
[[ "$(/usr/bin/plutil -p "$stage/metadata-comparison.plist")" == "$original_metadata" ]] || fail 'An unapproved metadata field changed.'
/usr/bin/codesign --force --sign "$signing_identity" --preserve-metadata="$preserve" --force-library-entitlements "$staged_framework"
/usr/bin/codesign --force --sign "$signing_identity" --preserve-metadata="$preserve" "$staged_app"
/usr/bin/codesign --verify --strict --verbose=2 "$staged_framework"
/usr/bin/codesign --verify --strict --deep --verbose=2 "$staged_app"
[[ "$(code_hash "$staged_framework/MapLibre")" == "$original_code_hash" ]] || fail 'Framework executable __text bytes changed.'
/usr/bin/cmp -s "$framework/PrivacyInfo.xcprivacy" "$staged_framework/PrivacyInfo.xcprivacy" || fail 'Privacy manifest changed.'
/usr/bin/cmp -s "$app/Info.plist" "$staged_app/Info.plist" || fail 'App bundle metadata changed.'
for resource in MapLibre-LICENSE.md MapLibre-iOS-NOTICES.md MapLibre-core-NOTICES.md; do
  /usr/bin/cmp -s "$app/$resource" "$staged_app/$resource" || fail "License resource changed: $resource"
done
for pair in framework app; do
  code="$staged_app"
  [[ "$pair" != framework ]] || code="$staged_framework"
  /usr/bin/codesign --display --entitlements "$stage/$pair-after.entitlements" --xml "$code" 2>/dev/null
  /usr/bin/codesign --display --requirements "$stage/$pair-after.requirements" "$code" 2>/dev/null
  if [[ "$pair" == app ]]; then
    [[ -s "$stage/app-after.entitlements" ]] || fail 'Could not extract required re-signed app entitlements.'
  fi
  if [[ -s "$stage/$pair-before.entitlements" || -s "$stage/$pair-after.entitlements" ]]; then
    [[ -s "$stage/$pair-before.entitlements" && -s "$stage/$pair-after.entitlements" ]] || fail "$pair entitlements appeared/disappeared."
    /usr/bin/plutil -lint "$stage/$pair-before.entitlements" "$stage/$pair-after.entitlements" >/dev/null
    [[ "$(/usr/bin/plutil -p "$stage/$pair-before.entitlements")" == "$(/usr/bin/plutil -p "$stage/$pair-after.entitlements")" ]] \
      || fail "$pair entitlements changed."
  fi
  /usr/bin/cmp -s "$stage/$pair-before.requirements" "$stage/$pair-after.requirements" || fail "$pair signing requirements changed."
done

# Both moves stay on the archive's filesystem. Keep the untouched original and
# extracted metadata for recovery/audit; never overwrite the download/SPM cache.
/bin/mv "$app" "$backup"
original_moved=true
/bin/mv "$staged_app" "$app"
replacement_installed=true
/usr/bin/codesign --verify --strict --verbose=2 "$framework"
/usr/bin/codesign --verify --strict --deep --verbose=2 "$app"
printf 'PASS  Archive-only SDK metadata correction and explicit re-signing verified.\n'
printf 'PASS  SDK code, app entitlements, privacy and license resources preserved. Original app/metadata retained at %s\n' "$stage"
