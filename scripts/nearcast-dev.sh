#!/bin/bash

# A side-by-side direct-device lane for Nearcast Dev. It intentionally never
# deletes an app, cleans DerivedData, or touches the production/TestFlight app.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/native/ios/Nearcast.xcodeproj"
DERIVED_DATA="$ROOT/native/ios/DerivedData/dev"

PHONE_SCHEME="Nearcast Dev"
WATCH_SCHEME="Nearcast Dev Watch"
PHONE_BUNDLE_ID="app.nearcast.ios.dev"
WATCH_BUNDLE_ID="app.nearcast.ios.dev.watch"

# The family's primary direct-test pair. Pass device IDs explicitly to override.
DEFAULT_PHONE_ID="00008150-001E705802F0401C"
DEFAULT_WATCH_ID="00008310-000378683A7BA01E"

PHONE_APP="$DERIVED_DATA/Build/Products/Debug-iphoneos/Nearcast.app"
WATCH_APP="$DERIVED_DATA/Build/Products/Debug-watchos/NearcastWatch.app"
SCHEME_LIST=""

green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
reset='\033[0m'

pass() { printf "${green}PASS${reset}  %s\n" "$1"; }
warn() { printf "${yellow}NOTE${reset}  %s\n" "$1"; }
fail() { printf "${red}FAIL${reset}  %s\n" "$1" >&2; }

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$2"
  else
    fail "$2"
    return 1
  fi
}

device_is_visible() {
  local device_id="$1"
  # Capture the complete list first. With `pipefail`, an early grep exit can
  # otherwise turn a successful device discovery into a false negative.
  local devices
  devices="$(xcrun devicectl list devices 2>/dev/null || true)"
  grep -F -- "$device_id" <<<"$devices" >/dev/null
}

require_visible_device() {
  local device_id="$1"
  local label="$2"
  if device_is_visible "$device_id"; then
    pass "$label is available: $device_id"
  else
    fail "$label is not available to Xcode: $device_id"
    printf 'Connect the paired iPhone by cable, unlock and trust it, then open Xcode Device Hub.\n' >&2
    return 1
  fi
}

require_scheme() {
  local scheme="$1"
  # Recent Xcode releases may write the scheme list to stderr even when the
  # command succeeds. Cache the complete result once so `grep -q` cannot make
  # xcodebuild exit through a broken pipe under `set -o pipefail`.
  if [[ -z "$SCHEME_LIST" ]]; then
    SCHEME_LIST="$(xcodebuild -project "$PROJECT" -list 2>&1 || true)"
  fi
  if grep -F -- "$scheme" <<<"$SCHEME_LIST" >/dev/null; then
    pass "$scheme scheme is available"
  else
    fail "$scheme scheme is unavailable"
    return 1
  fi
}

doctor() {
  local failed=0
  printf 'Nearcast Dev direct-device check\n\n'

  require_command xcodebuild "Xcode command-line tools are installed" || failed=1
  require_command xcrun "Apple platform tools are installed" || failed=1
  [[ -d "$PROJECT" ]] && pass "Nearcast Xcode project exists" || { fail "Nearcast Xcode project is missing"; failed=1; }

  if xcode-select -p 2>/dev/null | grep -q '/Xcode.app/Contents/Developer'; then
    pass "Full Xcode is selected: $(xcode-select -p)"
  else
    fail "Select full Xcode with: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    failed=1
  fi

  if xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
    pass "Xcode first-launch setup and license are complete"
  else
    warn "Open Xcode once, accept its license, and let component installation finish"
  fi

  require_scheme "$PHONE_SCHEME" || failed=1
  require_scheme "$WATCH_SCHEME" || failed=1

  if security find-identity -v -p codesigning 2>/dev/null | grep -q 'Apple Development:'; then
    pass "An Apple Development signing identity is installed"
  else
    warn "In Xcode > Settings > Apple Accounts, sign in and create an Apple Development certificate"
  fi

  if device_is_visible "$DEFAULT_PHONE_ID"; then
    pass "iPhone 17 Pro Max is available: $DEFAULT_PHONE_ID"
  else
    warn "iPhone 17 Pro Max is not connected yet: $DEFAULT_PHONE_ID"
  fi

  if device_is_visible "$DEFAULT_WATCH_ID"; then
    pass "Apple Watch Ultra 2 is available: $DEFAULT_WATCH_ID"
  else
    warn "Apple Watch Ultra 2 is not ready yet: $DEFAULT_WATCH_ID"
  fi

  printf '\n'
  if [[ "$failed" -ne 0 ]]; then
    fail "Complete the failed Mac/Xcode items, then rerun this command"
    return 1
  fi

  pass "Dev lane is configured. When the phone and Watch are connected, run: scripts/nearcast-dev.sh all"
  warn "The first signed device build may require interactive Apple-account, keychain, or provisioning approval."
}

build_phone() {
  local device_id="$1"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$PHONE_SCHEME" \
    -configuration Debug \
    -destination "platform=iOS,id=$device_id" \
    -derivedDataPath "$DERIVED_DATA" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    build
}

run_phone() {
  local device_id="$1"
  require_visible_device "$device_id" "iPhone"
  build_phone "$device_id"
  [[ -d "$PHONE_APP" ]] || { fail "Expected Dev app was not built: $PHONE_APP"; return 1; }
  xcrun devicectl device install app --device "$device_id" "$PHONE_APP"
  xcrun devicectl device process launch --device "$device_id" --terminate-existing "$PHONE_BUNDLE_ID"
  pass "Nearcast Dev installed and launched on iPhone $device_id"
}

build_watch() {
  local device_id="$1"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$WATCH_SCHEME" \
    -configuration Debug \
    -destination "platform=watchOS,id=$device_id" \
    -derivedDataPath "$DERIVED_DATA" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    build
}

run_watch() {
  local device_id="$1"
  warn "A first Watch install needs Nearcast Dev installed on its paired iPhone; use 'scripts/nearcast-dev.sh all' if needed."
  require_visible_device "$device_id" "Apple Watch"
  build_watch "$device_id"
  [[ -d "$WATCH_APP" ]] || { fail "Expected Dev Watch app was not built: $WATCH_APP"; return 1; }
  xcrun devicectl device install app --device "$device_id" "$WATCH_APP"
  xcrun devicectl device process launch --device "$device_id" --terminate-existing "$WATCH_BUNDLE_ID"
  pass "Nearcast Dev installed and launched on Apple Watch $device_id"
}

usage() {
  cat <<'EOF'
Usage: scripts/nearcast-dev.sh COMMAND [PHONE_DEVICE_ID] [WATCH_DEVICE_ID]

Commands:
  doctor                  Check Xcode, signing, shared schemes, and device visibility
  phone [PHONE_DEVICE_ID] Build, install, and launch Nearcast Dev on an iPhone
  watch [WATCH_DEVICE_ID] Build, install, and launch Nearcast Dev on an Apple Watch
  all [PHONE] [WATCH]     Run the phone lane first, then the paired Watch lane

Defaults:
  iPhone 17 Pro Max: 00008150-001E705802F0401C
  Apple Watch Ultra 2: 00008310-000378683A7BA01E

This is a direct-device development lane. It uses the Debug configuration and
automatic signing; it never uploads a build or replaces the TestFlight app.
For a fresh Watch install, run `all` first so its Nearcast Dev iPhone
companion is already installed.
EOF
}

command="${1:-doctor}"
case "$command" in
  doctor) doctor ;;
  phone) run_phone "${2:-$DEFAULT_PHONE_ID}" ;;
  watch) run_watch "${2:-$DEFAULT_WATCH_ID}" ;;
  all)
    run_phone "${2:-$DEFAULT_PHONE_ID}"
    run_watch "${3:-$DEFAULT_WATCH_ID}"
    ;;
  help|-h|--help) usage ;;
  *) fail "Unknown command: $command"; usage; exit 2 ;;
esac
