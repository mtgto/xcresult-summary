#!/bin/bash
# Regenerates fixtures/json/*.json from fixtures/SampleApp.
# The sample contains failing tests on purpose, so `xcodebuild test` is expected to fail.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP="$ROOT/fixtures/SampleApp"
OUT="$ROOT/fixtures/json"
BUNDLE="$APP/build/parallel.xcresult"

mkdir -p "$OUT"
if [ "${SKIP_BUILD:-}" != "1" ]; then
  rm -rf "$BUNDLE"
  (cd "$APP" && xcodebuild test \
    -scheme SampleApp \
    -destination 'platform=macOS' \
    -enableCodeCoverage YES \
    -parallel-testing-enabled YES \
    -derivedDataPath build/DerivedData \
    -resultBundlePath "$BUNDLE" 2>&1 | xcbeautify)
fi
set -e

sanitize() { node "$ROOT/scripts/sanitize-fixture.ts" "$ROOT"; }

xcrun xcresulttool get test-results summary --path "$BUNDLE" | sanitize > "$OUT/summary.json"
xcrun xcresulttool get test-results tests --path "$BUNDLE" | sanitize > "$OUT/tests.json"
xcrun xcresulttool get build-results --path "$BUNDLE" | sanitize > "$OUT/build-results.json"
xcrun xccov view --report --json "$BUNDLE" | sanitize > "$OUT/coverage.json"
wc -c "$OUT"/*.json
