#!/bin/bash
# Saves the JSON Schemas of the xcresulttool commands this action reads into
# schemas/xcode-<version>/, so they can be compared when Xcode changes the schema.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
XCODE_VERSION=$(xcodebuild -version | awk '/^Xcode/ { print $2 }')
OUT="$ROOT/schemas/xcode-$XCODE_VERSION"

mkdir -p "$OUT"
{
  xcodebuild -version
  xcrun xcresulttool version
} > "$OUT/version.txt"
# --path is not used with --schema, but some subcommands require it.
xcrun xcresulttool get content-availability --schema --path /dev/null > "$OUT/content-availability.json"
xcrun xcresulttool get test-results summary --schema --path /dev/null > "$OUT/test-results-summary.json"
xcrun xcresulttool get test-results tests --schema --path /dev/null > "$OUT/test-results-tests.json"
xcrun xcresulttool get build-results --schema > "$OUT/build-results.json"
ls -l "$OUT"
