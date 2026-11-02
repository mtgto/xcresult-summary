import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@actions/core";
import { collectAnnotations, MAX_ANNOTATIONS_PER_LEVEL } from "./annotations.ts";
import { toWorkspacePath } from "./paths.ts";
import { renderReport } from "./render.ts";
import { buildReport, hasErrors, lineCoverage, mergeTests } from "./report.ts";
import type { Tests } from "./types.ts";
import {
  getBuildResults,
  getContentAvailability,
  getCoverage,
  getTests,
  getTestSummary,
  mergeBundles,
} from "./xcresult.ts";

async function run(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      `This action runs only on macOS runners (current platform: ${process.platform})`,
    );
  }
  const paths = core.getMultilineInput("path", { required: true });
  const title = core.getInput("title") || "Xcode Results";
  const showPassedTests = core.getBooleanInput("show-passed-tests");
  const showCodeCoverage = core.getBooleanInput("show-code-coverage");
  const failOnError = core.getBooleanInput("fail-on-error");
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  for (const path of paths) {
    if (!existsSync(path)) throw new Error(`Result bundle not found: ${path}`);
  }

  let bundle = paths[0] as string;
  if (paths.length > 1) {
    const dir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "xcresult-"));
    bundle = join(dir, "merged.xcresult");
    core.info(`Merging ${paths.length} result bundles into ${bundle}`);
    await mergeBundles(paths, bundle);
  }

  // The results themselves can't tell whether the bundle has tests:
  // for a build-only bundle `get test-results summary` succeeds with zero tests.
  const availability = await getContentAvailability(bundle);
  if (showCodeCoverage && !availability.hasCoverage) {
    core.info("Code coverage is not available in the result bundle");
  }
  // Run one at a time: xcresulttool creates a cache (database.sqlite3) inside a fresh bundle,
  // and concurrent runs fail with "couldn't be moved ... because an item with the same name
  // already exists".
  const summary = availability.hasTestResults ? await getTestSummary(bundle) : undefined;
  const tests = availability.hasTestResults ? await readTests(paths, bundle) : undefined;
  const build = await getBuildResults(bundle);
  const coverage =
    showCodeCoverage && availability.hasCoverage ? await getCoverage(bundle) : undefined;
  const report = buildReport({ summary, tests, build, coverage });

  const relative = (file: string) => toWorkspacePath(file, workspace);
  await core.summary
    .addRaw(
      renderReport(report, {
        title,
        showPassedTests,
        showCodeCoverage,
        displayPath: (file) => relative(file) ?? file,
      }),
    )
    .write();

  const { annotations, omitted } = collectAnnotations(report, relative);
  for (const { level, message, properties } of annotations) {
    if (level === "error") core.error(message, properties);
    else core.warning(message, properties);
  }
  if (omitted > 0) {
    core.info(
      `${omitted} annotations were omitted (GitHub shows up to ${MAX_ANNOTATIONS_PER_LEVEL} per level); see the job summary for all of them.`,
    );
  }

  core.setOutput("total-tests", String(summary?.totalTestCount ?? 0));
  core.setOutput("passed-tests", String(summary?.passedTests ?? 0));
  core.setOutput("failed-tests", String(summary?.failedTests ?? 0));
  core.setOutput("skipped-tests", String(summary?.skippedTests ?? 0));
  const coveragePercent = coverage ? lineCoverage(coverage) : undefined;
  core.setOutput("line-coverage", coveragePercent !== undefined ? coveragePercent.toFixed(2) : "");

  if (failOnError && hasErrors(report)) {
    core.setFailed(`${title}: build errors or test failures were found`);
  }
}

// `get test-results tests` of a merged bundle drops the test plans of all but the first bundle,
// so read the tests of each bundle instead. The summary, build results and coverage of a merged
// bundle include every bundle.
async function readTests(paths: string[], merged: string): Promise<Tests> {
  if (paths.length === 1) return getTests(merged);
  const tests: Tests[] = [];
  for (const path of paths) {
    if ((await getContentAvailability(path)).hasTestResults) tests.push(await getTests(path));
  }
  return mergeTests(tests);
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
