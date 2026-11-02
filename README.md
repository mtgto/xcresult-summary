# xcresult-summary

A GitHub Action that reports build results, test results and code coverage from `.xcresult` bundles to the job summary, with annotations for build issues and test failures.

It was made as a lightweight successor of [kishikawakatsumi/xcresulttool](https://github.com/kishikawakatsumi/xcresulttool).
Failure reasons are read from the result bundle, so they are reported even when `xcodebuild` doesn't print them (e.g. parallel testing piped through `xcbeautify`).

- macOS runners only. Uses `xcrun xcresulttool get content-availability` / `test-results` / `build-results` and `xcrun xccov`.
- Requires Xcode 27 or later. The xcresulttool output is pinned to schema version 0.4.0, the default since Xcode 27.0. Xcode 26 and earlier fail with "Unknown schema version". Tested on Apple Silicon; not tested on Intel Macs. Please report an issue if it does not work.
- No token or extra permissions are required; works for pull requests from forks

## Usage

```yaml
- name: Test
  run: |
    set -o pipefail
    xcodebuild test -scheme MyApp -destination 'platform=macOS' \
      -enableCodeCoverage YES -resultBundlePath TestResults.xcresult | xcbeautify

- uses: mtgto/xcresult-summary@v1
  if: ${{ !cancelled() }}
  with:
    path: TestResults.xcresult
```

### Inputs

| Name                 | Default         | Description                                                                                |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `path`               | (required)      | Path(s) to `.xcresult` bundles. Multiple paths (one per line) are merged before reporting. |
| `title`              | `Xcode Results` | Title of the report                                                                        |
| `show-passed-tests`  | `true`          | Show the list of all tests (not only failures)                                             |
| `show-code-coverage` | `true`          | Show code coverage (test bundles are excluded)                                             |
| `fail-on-error`      | `false`         | Fail this step when there are build errors or test failures                                |

### Outputs

`total-tests`, `passed-tests`, `failed-tests`, `skipped-tests`, `line-coverage` (percentage such as `83.21`, empty when unavailable)

### Limitations

- The job summary is limited to 1 MiB per step. When the report is larger, the list of all tests and then per-file coverage are omitted.
- GitHub shows at most 10 error and 10 warning annotations per step. All issues are listed in the job summary.
- Attachments such as screenshots are not reported. Upload the bundle with `actions/upload-artifact` if you need them.

## Development

```sh
pnpm install
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test
pnpm build   # dist/index.mjs must be committed
```

`pnpm install` also sets up Git hooks with [lefthook](https://github.com/evilmartians/lefthook): the pre-commit hook formats and lints staged files, and rebuilds `dist/index.mjs` when the sources change.

Workflow dependencies are pinned in `.github/workflows/actions.lock` with [gh-actions-lock](https://github.com/github/gh-actions-lock) (`gh extension install github/gh-actions-lock`). After adding or changing `uses:` in a workflow, run `gh actions-lock` to update the lockfile; don't edit it by hand. The pre-commit hook runs `gh actions-lock --verify-local` (offline) when files in `.github/workflows/` change.

`fixtures/json/` is generated from `fixtures/SampleApp` by `scripts/generate-fixtures.sh` (requires Xcode).

`schemas/xcode-<version>/` keeps the JSON Schemas of the xcresulttool commands this action reads, saved by `scripts/dump-schemas.sh`. Run it with a new Xcode and diff the directories to see schema changes.

To try the action locally:

```sh
touch fixtures/SampleApp/build/summary.md
env INPUT_PATH=fixtures/SampleApp/build/parallel.xcresult \
  INPUT_SHOW-PASSED-TESTS=true INPUT_SHOW-CODE-COVERAGE=true INPUT_FAIL-ON-ERROR=false \
  GITHUB_STEP_SUMMARY=fixtures/SampleApp/build/summary.md node dist/index.mjs
```
