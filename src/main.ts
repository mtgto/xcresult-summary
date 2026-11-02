import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@actions/core";
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

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
