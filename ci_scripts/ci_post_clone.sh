#!/bin/sh
set -eu

echo "Nearcast Xcode Cloud post-clone"
xcodebuild -version
"$(dirname "$0")/nearcast_stamp_build_number.sh"
