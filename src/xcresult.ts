import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { info } from "./actions.ts";
import type { BuildResults, CoverageReport, Tests, TestSummary } from "./types.ts";

const execFileAsync = promisify(execFile);

async function xcrun(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("xcrun", args, {
    // test-results tests can be large for big projects
    maxBuffer: 1024 * 1024 * 1024,
  });
  return stdout;
}

async function xcrunJSON<T>(args: string[]): Promise<T> {
  return JSON.parse(await xcrun(args)) as T;
}

export async function mergeBundles(paths: string[], outputPath: string): Promise<void> {
  await xcrun(["xcresulttool", "merge", ...paths, "--output-path", outputPath]);
}

export function getTestSummary(path: string): Promise<TestSummary> {
  return xcrunJSON(["xcresulttool", "get", "test-results", "summary", "--path", path, "--compact"]);
}

export function getTests(path: string): Promise<Tests> {
  return xcrunJSON(["xcresulttool", "get", "test-results", "tests", "--path", path, "--compact"]);
}

export function getBuildResults(path: string): Promise<BuildResults> {
  return xcrunJSON(["xcresulttool", "get", "build-results", "--path", path, "--compact"]);
}

export function getCoverage(path: string): Promise<CoverageReport> {
  return xcrunJSON(["xccov", "view", "--report", "--json", path]);
}

/**
 * Resolves to undefined instead of rejecting, because a bundle may lack some contents
 * (e.g. a build-only bundle has no tests, or coverage is disabled). The error is logged.
 */
export async function optional<T>(label: string, promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    info(`[xcresult-summary] Skipped ${label}: ${detail.trim()}`);
    return undefined;
  }
}
