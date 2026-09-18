#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROOF_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nearcast-radar-proof.XXXXXX")"
APP_PATH="$PROOF_ROOT/RadarProof.app"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)"
mkdir -p "$APP_PATH"
cp "$ROOT/native/experiments/RadarSubstrateProof/Info.plist" "$APP_PATH/Info.plist"
xcrun --sdk iphonesimulator swiftc -parse-as-library -sdk "$SDK" -target "$ARCH-apple-ios17.0-simulator" \
  -module-cache-path "$PROOF_ROOT/ModuleCache" \
  "$ROOT/native/experiments/RadarSubstrateProof/RadarProofContract.swift" \
  "$ROOT/native/experiments/RadarSubstrateProof/RadarProofApp.swift" \
  -o "$APP_PATH/RadarProof"
codesign --force --sign - "$APP_PATH"
echo "PASS Native radar proof simulator build: $APP_PATH"
echo "This separate simulator-only app is not linked into Nearcast or included in TestFlight."
