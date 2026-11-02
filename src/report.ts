import { fileURLToPath } from "node:url";
import type {
  BuildResults,
  CoverageReport,
  Issue,
  TestNode,
  TestResult,
  Tests,
  TestSummary,
} from "./types.ts";

export interface SourceLocation {
  /** Absolute path as recorded in the bundle */
  file: string;
  line?: number;
}

export interface FailureMessage {
  text: string;
  location?: SourceLocation;
}

export interface TestFailure {
  /** e.g. "CalculatorXCTests/testSubtractFails()" */
  name: string;
  target?: string;
  messages: FailureMessage[];
}

export interface BuildIssue {
  severity: "error" | "warning";
  message: string;
  target?: string;
  location?: SourceLocation;
}

export interface Report {
  summary?: TestSummary;
  tests?: Tests;
  build?: BuildResults;
  coverage?: CoverageReport;
  failures: TestFailure[];
  buildIssues: BuildIssue[];
}

export function buildReport(input: {
  summary?: TestSummary;
  tests?: Tests;
  build?: BuildResults;
  coverage?: CoverageReport;
}): Report {
  return {
    ...input,
    failures: collectFailures(input.summary, input.tests),
    buildIssues: collectBuildIssues(input.build),
  };
}

/** Failed test cases with their failure messages and where each failure was recorded. */
function collectFailures(summary?: TestSummary, tests?: Tests): TestFailure[] {
  // Keyed by test identifier: the same test case can appear once per device / configuration.
  const failures = new Map<string, TestFailure>();

  for (const { bundle, suites, testCase } of walkTestCases(tests?.testNodes ?? [])) {
    if (testCase.result !== "Failed") continue;
    const name = testCase.nodeIdentifier ?? [...suites.map((s) => s.name), testCase.name].join("/");
    const messages = descendants(testCase)
      .filter((node) => node.nodeType === "Failure Message")
      .map(toFailureMessage);
    const existing = failures.get(name);
    if (existing) {
      existing.messages = uniqueMessages([...existing.messages, ...messages]);
    } else {
      failures.set(name, { name, target: bundle?.name, messages: uniqueMessages(messages) });
    }
  }

  // Failures that only appear in the summary (or when the test tree is unavailable).
  for (const failure of summary?.testFailures ?? []) {
    const name = failure.testIdentifierString || failure.testName;
    const existing = failures.get(name);
    if (!existing) {
      failures.set(name, {
        name,
        target: failure.targetName,
        messages: [{ text: failure.failureText }],
      });
    } else if (existing.messages.length === 0) {
      existing.messages.push({ text: failure.failureText });
    }
  }
  return [...failures.values()];
}

export interface TestCaseEntry {
  bundle?: TestNode;
  suites: TestNode[];
  testCase: TestNode;
}

export function* walkTestCases(
  nodes: TestNode[],
  bundle?: TestNode,
  suites: TestNode[] = [],
): Generator<TestCaseEntry> {
  for (const node of nodes) {
    switch (node.nodeType) {
      case "Test Case":
        yield { bundle, suites, testCase: node };
        break;
      case "Unit test bundle":
      case "UI test bundle":
        yield* walkTestCases(node.children ?? [], node, []);
        break;
      case "Test Suite":
        yield* walkTestCases(node.children ?? [], bundle, [...suites, node]);
        break;
      case "Test Plan":
      case "Device":
      case "Test Plan Configuration":
        yield* walkTestCases(node.children ?? [], bundle, suites);
        break;
      default:
        break;
    }
  }
}

function descendants(node: TestNode): TestNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

// Only the format of Xcode 27 is verified: the location is recorded as `sourceLocation`.
function toFailureMessage(node: TestNode): FailureMessage {
  return {
    text: node.name,
    location: node.sourceLocation && {
      file: node.sourceLocation.filePath,
      line: node.sourceLocation.lineNumber,
    },
  };
}

function uniqueMessages(messages: FailureMessage[]): FailureMessage[] {
  const keys = new Set<string>();
  return messages.filter((m) => {
    const key = `${m.location?.file}:${m.location?.line}:${m.text}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function collectBuildIssues(build?: BuildResults): BuildIssue[] {
  if (!build) return [];
  const toIssue =
    (severity: BuildIssue["severity"]) =>
    (issue: Issue): BuildIssue => ({
      severity,
      message: issue.message,
      target: issue.targetName,
      location: issue.sourceURL ? parseSourceURL(issue.sourceURL) : undefined,
    });
  return [
    ...build.errors.map(toIssue("error")),
    ...build.warnings.map(toIssue("warning")),
    ...build.analyzerWarnings.map(toIssue("warning")),
  ];
}

/** "file:///path/File.swift#EndingLineNumber=8&StartingLineNumber=8" → location (1-based line) */
export function parseSourceURL(sourceURL: string): SourceLocation | undefined {
  if (!URL.canParse(sourceURL)) return undefined;
  const url = new URL(sourceURL);
  if (url.protocol !== "file:") return undefined;
  const params = new URLSearchParams(url.hash.slice(1));
  const start = params.get("StartingLineNumber");
  return {
    file: fileURLToPath(url),
    // xcresult records 0-based line numbers in source URLs
    line: start !== null ? Number(start) + 1 : undefined,
  };
}

export function statusIcon(result?: TestResult): string {
  switch (result) {
    case "Passed":
      return "✅";
    case "Failed":
      return "❌";
    case "Skipped":
      return "⏭️";
    case "Expected Failure":
      return "⚠️";
    default:
      return "❔";
  }
}

export function hasErrors(report: Report): boolean {
  return (
    report.failures.length > 0 ||
    (report.summary?.failedTests ?? 0) > 0 ||
    report.buildIssues.some((i) => i.severity === "error")
  );
}

/** Coverage excluding test bundles, as a percentage. */
export function lineCoverage(coverage: CoverageReport): number | undefined {
  const targets = coverageTargets(coverage);
  const executable = targets.reduce((sum, t) => sum + t.executableLines, 0);
  if (executable === 0) return undefined;
  const covered = targets.reduce((sum, t) => sum + t.coveredLines, 0);
  return (covered / executable) * 100;
}

/** Coverage targets excluding test bundles (their product path is inside `*.xctest`). */
export function coverageTargets(coverage: CoverageReport) {
  return coverage.targets.filter(
    (t) =>
      t.executableLines > 0 &&
      !t.name.endsWith(".xctest") &&
      !(t.buildProductPath ?? "").includes(".xctest/"),
  );
}
