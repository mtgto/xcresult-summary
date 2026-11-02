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

// Pin the output format to the schema the types in types.ts are written for.
// 0.4.0 is the default schema version of xcresulttool in Xcode 27.0 (Xcode 27.1 does not know
// 0.5.0, the default in Xcode 27.2). The commands this action reads have the same JSON Schema in
// 0.4.0 and 0.5.0. Newer Xcode versions keep emitting this format as long as they support it,
// and fail with "Unknown schema version" otherwise.
const SCHEMA_VERSION = "0.4.0";

function xcresulttoolGet<T>(subcommand: string[], path: string): Promise<T> {
  return xcrunJSON([
    "xcresulttool",
    "get",
    ...subcommand,
    "--path",
    path,
    "--schema-version",
    SCHEMA_VERSION,
    "--compact",
  ]);
}

export function getContentAvailability(path: string): Promise<ContentAvailability> {
  return xcresulttoolGet(["content-availability"], path);
}

export function getTestSummary(path: string): Promise<TestSummary> {
  return xcresulttoolGet(["test-results", "summary"], path);
}

export function getTests(path: string): Promise<Tests> {
  return xcresulttoolGet(["test-results", "tests"], path);
}

export function getBuildResults(path: string): Promise<BuildResults> {
  return xcresulttoolGet(["build-results"], path);
}

export function getCoverage(path: string): Promise<CoverageReport> {
  return xcrunJSON(["xccov", "view", "--report", "--json", path]);
}
