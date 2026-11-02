import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  BuildResults,
  ContentAvailability,
  CoverageReport,
  Tests,
  TestSummary,
} from "./types.ts";

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

export function getContentAvailability(path: string): Promise<ContentAvailability> {
  return xcrunJSON(["xcresulttool", "get", "content-availability", "--path", path, "--compact"]);
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
