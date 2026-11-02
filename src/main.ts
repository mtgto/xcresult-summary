import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  annotate,
  appendSummary,
  getBooleanInput,
  getInput,
  getMultilineInput,
  info,
  setFailed,
  setOutput,
} from "./actions.ts";
import { collectAnnotations, MAX_ANNOTATIONS_PER_LEVEL } from "./annotations.ts";
import { toWorkspacePath } from "./paths.ts";
import { renderReport } from "./render.ts";
import { buildReport, hasErrors, lineCoverage } from "./report.ts";
import {
  getBuildResults,
  getCoverage,
  getTests,
  getTestSummary,
  mergeBundles,
  optional,
} from "./xcresult.ts";

async function run(): Promise<void> {
  const paths = getMultilineInput("path");
  const title = getInput("title") || "Xcode Results";
  const showPassedTests = getBooleanInput("show-passed-tests");
  const showCodeCoverage = getBooleanInput("show-code-coverage");
  const failOnError = getBooleanInput("fail-on-error");
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  if (paths.length === 0) throw new Error('Input "path" is required');
  for (const path of paths) {
    if (!existsSync(path)) throw new Error(`Result bundle not found: ${path}`);
  }

  let bundle = paths[0] as string;
  if (paths.length > 1) {
    const dir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "xcresult-"));
    bundle = join(dir, "merged.xcresult");
    info(`Merging ${paths.length} result bundles into ${bundle}`);
    await mergeBundles(paths, bundle);
  }

  const [summary, tests, build, coverage] = await Promise.all([
    optional("test summary", getTestSummary(bundle)),
    optional("test tree", getTests(bundle)),
    optional("build results", getBuildResults(bundle)),
    showCodeCoverage ? optional("code coverage", getCoverage(bundle)) : undefined,
  ]);
  if (!summary && !tests && !build) {
    throw new Error(`No build or test results could be read from ${bundle}`);
  }
  const report = buildReport({ summary, tests, build, coverage });

  const relative = (file: string) => toWorkspacePath(file, workspace);
  appendSummary(
    renderReport(report, {
      title,
      showPassedTests,
      showCodeCoverage,
      displayPath: (file) => relative(file) ?? file,
    }),
  );

  const { annotations, omitted } = collectAnnotations(report, relative);
  for (const { level, message, properties } of annotations) annotate(level, message, properties);
  if (omitted > 0) {
    info(
      `${omitted} annotations were omitted (GitHub shows up to ${MAX_ANNOTATIONS_PER_LEVEL} per level); see the job summary for all of them.`,
    );
  }

  setOutput("total-tests", String(summary?.totalTestCount ?? 0));
  setOutput("passed-tests", String(summary?.passedTests ?? 0));
  setOutput("failed-tests", String(summary?.failedTests ?? 0));
  setOutput("skipped-tests", String(summary?.skippedTests ?? 0));
  const coveragePercent = coverage ? lineCoverage(coverage) : undefined;
  setOutput("line-coverage", coveragePercent !== undefined ? coveragePercent.toFixed(2) : "");

  if (failOnError && hasErrors(report)) {
    setFailed(`${title}: build errors or test failures were found`);
  }
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
