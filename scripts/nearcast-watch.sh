#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/native/ios/Nearcast.xcodeproj"
DERIVED_DATA="$ROOT/native/ios/DerivedData/watch"
SCHEME="NearcastWatch"
BUNDLE_ID="app.nearcast.ios.watch"
APP_SIMULATOR="$DERIVED_DATA/Build/Products/Debug-watchsimulator/NearcastWatch.app"
APP_DEVICE="$DERIVED_DATA/Build/Products/Debug-watchos/NearcastWatch.app"

green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
reset='\033[0m'

pass() { printf "${green}PASS${reset}  %s\n" "$1"; }
warn() { printf "${yellow}TODO${reset}  %s\n" "$1"; }
fail() { printf "${red}FAIL${reset}  %s\n" "$1" >&2; }

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$2"
  else
    fail "$2"
    return 1
  fi
}

watch_runtime() {
  xcrun simctl list runtimes 2>/dev/null | awk '/watchOS/ && /com.apple.CoreSimulator.SimRuntime.watchOS/ { print; exit }'
}

watch_simulator_id() {
  local requested="${1:-}"
  if [[ -n "$requested" ]]; then
    printf '%s\n' "$requested"
    return
  fi

  local line
  line="$(xcrun simctl list devices available 2>/dev/null | awk '
    /^-- watchOS/ { watch=1; next }
    /^-- / { watch=0 }
    watch && /\(Booted\)/ { print; exit }
  ')"
  if [[ -z "$line" ]]; then
    line="$(xcrun simctl list devices available 2>/dev/null | awk '
      /^-- watchOS/ { watch=1; next }
      /^-- / { watch=0 }
      watch && /\(Shutdown\)/ { print; exit }
    ')"
  fi
  printf '%s\n' "$line" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
}

physical_watch_id() {
  local requested="${1:-}"
  if [[ -n "$requested" ]]; then
    printf '%s\n' "$requested"
    return
  fi

  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -showdestinations 2>/dev/null |
    awk -F'id:' '/platform:watchOS,/ && $0 !~ /placeholder/ {
      value=$2
      sub(/,.*/, "", value)
      gsub(/[[:space:]]/, "", value)
      print value
      exit
    }'
}

doctor() {
  local failed=0
  printf 'Nearcast Watch development check\n\n'

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

  if [[ -n "$(watch_runtime)" ]]; then
    pass "watchOS Simulator runtime is installed: $(watch_runtime)"
  else
    fail "Install watchOS in Xcode > Settings > Components"
    failed=1
  fi

  if xcodebuild -project "$PROJECT" -list 2>/dev/null | grep -q "$SCHEME"; then
    pass "$SCHEME scheme is available"
  else
    fail "$SCHEME scheme is unavailable"
    failed=1
  fi

  if security find-identity -v -p codesigning 2>/dev/null | grep -q 'Apple Development:'; then
    pass "Apple Development signing identity is installed"
  else
    warn "In Xcode > Settings > Apple Accounts, sign in and create an Apple Development certificate"
  fi

  local simulator
  simulator="$(watch_simulator_id || true)"
  if [[ "$simulator" =~ ^[0-9A-F-]{36}$ ]]; then
    pass "A watchOS Simulator is available: $simulator"
  else
    fail "No watchOS Simulator device is available"
    failed=1
  fi

  local phone_count watch_id
  phone_count="$(xcrun devicectl list devices 2>/dev/null | grep -c 'iPhone' || true)"
  if [[ "$phone_count" -gt 0 ]]; then
    pass "A physical iPhone is paired with this Mac"
  else
    warn "Connect and trust the iPhone paired with your Apple Watch"
  fi

  watch_id="$(physical_watch_id || true)"
  if [[ -n "$watch_id" ]]; then
    pass "A physical Apple Watch is an Xcode run destination: $watch_id"
  else
    warn "Physical Watch not ready: connect its paired iPhone, unlock both devices, and enable Developer Mode on iPhone and Watch"
  fi

  printf '\n'
  if [[ "$failed" -eq 0 ]]; then
    pass "Simulator prerequisites are ready. Run: scripts/nearcast-watch.sh simulator"
  else
    fail "Complete the failed items above, then rerun this command"
    return 1
  fi
  if [[ -z "$watch_id" ]]; then
    warn "Finish the one-time physical-device steps in native/ios/WATCH_SETUP.md before running on your Watch"
  else
    pass "Physical-device prerequisites look ready. Run: scripts/nearcast-watch.sh device"
  fi
}

build_simulator() {
  local id="$1"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Debug \
    -destination "platform=watchOS Simulator,id=$id" \
    -derivedDataPath "$DERIVED_DATA" \
    build \
    CODE_SIGNING_ALLOWED=NO
}

run_simulator() {
  local id
  id="$(watch_simulator_id "${1:-}")"
  if [[ ! "$id" =~ ^[0-9A-F-]{36}$ ]]; then
    fail "No watchOS Simulator found. Run the doctor for setup guidance."
    exit 1
  fi
  xcrun simctl boot "$id" 2>/dev/null || true
  open -a Simulator
  build_simulator "$id"
  xcrun simctl install "$id" "$APP_SIMULATOR"
  xcrun simctl launch --terminate-running-process "$id" "$BUNDLE_ID"
  pass "Nearcast launched on watchOS Simulator $id"
}

build_device() {
  local id="$1"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Debug \
    -destination "platform=watchOS,id=$id" \
    -derivedDataPath "$DERIVED_DATA" \
    -allowProvisioningUpdates \
    build
}

run_device() {
  local id
  id="$(physical_watch_id "${1:-}")"
  if [[ -z "$id" ]]; then
    fail "No physical Apple Watch is available to Xcode."
    printf 'Complete the one-time device steps in native/ios/WATCH_SETUP.md, then rerun the doctor.\n' >&2
    exit 1
  fi
  build_device "$id"
  xcrun devicectl device install app --device "$id" "$APP_DEVICE"
  xcrun devicectl device process launch --device "$id" --terminate-existing "$BUNDLE_ID"
  pass "Nearcast installed and launched on Apple Watch $id"
}

usage() {
  cat <<'EOF'
Usage: scripts/nearcast-watch.sh COMMAND [DEVICE_ID]

Commands:
  doctor                 Check Mac, Xcode, signing, Simulator, and device readiness
  build-simulator        Build for an available watchOS Simulator
  simulator              Build, install, and launch in watchOS Simulator
  build-device           Build and sign for a physical Apple Watch
  device                  Build, install, and launch on a physical Apple Watch

DEVICE_ID is optional. The script otherwise chooses a booted/available Simulator
or the first physical watchOS destination reported by Xcode.
EOF
}

command="${1:-doctor}"
device_id="${2:-}"
case "$command" in
  doctor) doctor ;;
  build-simulator)
    id="$(watch_simulator_id "$device_id")"
    [[ "$id" =~ ^[0-9A-F-]{36}$ ]] || { fail "No watchOS Simulator found"; exit 1; }
    build_simulator "$id"
    ;;
  simulator) run_simulator "$device_id" ;;
  build-device)
    id="$(physical_watch_id "$device_id")"
    [[ -n "$id" ]] || { fail "No physical Apple Watch destination found"; exit 1; }
    build_device "$id"
    ;;
  device) run_device "$device_id" ;;
  help|-h|--help) usage ;;
  *) fail "Unknown command: $command"; usage; exit 2 ;;
esac
