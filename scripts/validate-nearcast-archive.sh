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

printf 'PASS  Build number %s matches across app, widget, Watch, and complications\n' "$app_version"
printf 'PASS  Watch companion bundle identifier is app.nearcast.ios\n'
printf 'PASS  Watch app icon catalog is compiled\n'
printf 'PASS  Archive is ready for export validation\n'
