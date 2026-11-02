import { describe, expect, test } from "vitest";
import { collectAnnotations } from "../src/annotations.ts";
import { toWorkspacePath } from "../src/paths.ts";
import { renderReport } from "../src/render.ts";
import { buildReport, hasErrors, lineCoverage, parseSourceURL } from "../src/report.ts";
import type { TestNode } from "../src/types.ts";
import { fixtures, WORKSPACE } from "./fixtures.ts";

const relative = (file: string) => toWorkspacePath(file, WORKSPACE);

// Synthetic test tree helpers for cases the sample bundle does not cover.
const failing = (message: string): TestNode => ({
  nodeType: "Test Case",
  nodeIdentifier: "Suite/test()",
  name: "test()",
  result: "Failed",
  children: [
    { nodeType: "Failure Message", name: message },
    { nodeType: "Failure Message", name: "same on every device" },
  ],
});
const configuration = (name: string, message: string): TestNode => ({
  nodeType: "Test Plan Configuration",
  name,
  children: [
    {
      nodeType: "Unit test bundle",
      name: "AppTests",
      children: [{ nodeType: "Test Suite", name: "Suite", children: [failing(message)] }],
    },
  ],
});

describe("buildReport", () => {
  const report = buildReport(fixtures);

  test("collects failure reasons and locations of parallel test runs", () => {
    expect(report.failures).toEqual([
      {
        name: "CalculatorXCTests/testSubtractFails()",
        target: "SampleAppTests",
        messages: [
          {
            text: 'XCTAssertEqual failed: ("2") is not equal to ("3") - 5 - 3 should be 2',
            location: {
              file: `${WORKSPACE}/fixtures/SampleApp/Tests/SampleAppTests/CalculatorXCTests.swift`,
              line: 12,
            },
          },
        ],
      },
      {
        name: "CalculatorSwiftTests/divideByZeroFails()",
        target: "SampleAppTests",
        messages: [
          {
            text: "Expectation failed: Calculator().divide(1, 0) == 0\nCalculator().divide(1, 0) → nil: // intentionally failing",
            location: {
              file: `${WORKSPACE}/fixtures/SampleApp/Tests/SampleAppTests/CalculatorSwiftTests.swift`,
              line: 12,
            },
          },
        ],
      },
    ]);
    expect(hasErrors(report)).toBe(true);
  });

  // Synthetic data: the same test case under two configurations. Not verified against a real
  // bundle because the development machine has no simulators to run on multiple destinations.
  test("merges the same test case recorded under multiple configurations", () => {
    const { failures } = buildReport({
      tests: {
        devices: [],
        testNodes: [configuration("A", "failed on A"), configuration("B", "failed on B")],
      },
    });
    expect(failures).toEqual([
      {
        name: "Suite/test()",
        target: "AppTests",
        messages: [
          { text: "failed on A", location: undefined },
          { text: "same on every device", location: undefined },
          { text: "failed on B", location: undefined },
        ],
      },
    ]);
  });

  test("takes the failure reason from the summary when the test tree has no failure message", () => {
    const withoutMessages = (nodes: TestNode[]): TestNode[] =>
      nodes
        .filter((node) => node.nodeType !== "Failure Message")
        .map((node) => ({ ...node, children: node.children && withoutMessages(node.children) }));
    const { failures } = buildReport({
      summary: fixtures.summary,
      tests: { ...fixtures.tests, testNodes: withoutMessages(fixtures.tests.testNodes) },
    });
    expect(failures).toEqual([
      {
        name: "CalculatorXCTests/testSubtractFails()",
        target: "SampleAppTests",
        messages: [
          { text: 'XCTAssertEqual failed: ("2") is not equal to ("3") - 5 - 3 should be 2' },
        ],
      },
      {
        name: "CalculatorSwiftTests/divideByZeroFails()",
        target: "SampleAppTests",
        messages: [
          {
            text: "Expectation failed: Calculator().divide(1, 0) == 0\nCalculator().divide(1, 0) → nil: // intentionally failing",
          },
        ],
      },
    ]);
  });

  test("ignores failures that are only in the summary", () => {
    expect(buildReport({ summary: fixtures.summary }).failures).toEqual([]);
  });

  test("converts build issue source URLs to 1-based lines", () => {
    expect(report.buildIssues).toEqual([
      {
        severity: "warning",
        message: expect.stringContaining("'unused' was never used"),
        target: undefined,
        location: {
          file: `${WORKSPACE}/fixtures/SampleApp/Sources/SampleApp/Calculator.swift`,
          line: 9,
        },
      },
    ]);
  });

  test("excludes test bundles from coverage", () => {
    const sampleApp = fixtures.coverage.targets.find((t) => t.name === "SampleApp");
    expect(lineCoverage(fixtures.coverage)).toBeCloseTo((sampleApp?.lineCoverage ?? 0) * 100);
  });
});

test("parseSourceURL", () => {
  expect(parseSourceURL("file:///a/b%20c.swift#StartingLineNumber=0&EndingLineNumber=0")).toEqual({
    file: "/a/b c.swift",
    line: 1,
  });
  expect(parseSourceURL("file:///a/b.swift")).toEqual({ file: "/a/b.swift", line: undefined });
  expect(parseSourceURL("not a url")).toBeUndefined();
});

test("toWorkspacePath", () => {
  expect(toWorkspacePath("/ws/Sources/A.swift", "/ws")).toBe("Sources/A.swift");
  expect(toWorkspacePath("/ws/Sources/A.swift", "/ws/")).toBe("Sources/A.swift");
  expect(toWorkspacePath("/ws/..foo/A.swift", "/ws")).toBe("..foo/A.swift");
  expect(toWorkspacePath("/other/A.swift", "/ws")).toBeUndefined();
  expect(toWorkspacePath("/wsx/A.swift", "/ws")).toBeUndefined();
  expect(toWorkspacePath("/ws", "/ws")).toBeUndefined();
  expect(toWorkspacePath("A.swift", "/ws")).toBeUndefined();
});

describe("collectAnnotations", () => {
  test("annotates build issues and test failures with workspace-relative locations", () => {
    const { annotations, omitted } = collectAnnotations(buildReport(fixtures), relative);
    expect(omitted).toBe(0);
    expect(
      annotations.map((a) => [
        a.level,
        a.properties.file,
        a.properties.startLine,
        a.properties.title,
      ]),
    ).toEqual([
      ["warning", "fixtures/SampleApp/Sources/SampleApp/Calculator.swift", 9, "Build warning"],
      [
        "error",
        "fixtures/SampleApp/Tests/SampleAppTests/CalculatorXCTests.swift",
        12,
        "CalculatorXCTests/testSubtractFails() failed",
      ],
      [
        "error",
        "fixtures/SampleApp/Tests/SampleAppTests/CalculatorSwiftTests.swift",
        12,
        "CalculatorSwiftTests/divideByZeroFails() failed",
      ],
    ]);
  });

  test("limits annotations per level, not in total", () => {
    const report = buildReport({});
    report.buildIssues = Array.from({ length: 3 }, () => ({ severity: "warning", message: "w" }));
    report.failures = Array.from({ length: 12 }, (_, i) => ({
      name: `T${i}`,
      messages: [{ text: "x" }],
    }));
    const { annotations, omitted } = collectAnnotations(report, relative);
    expect(annotations.filter((a) => a.level === "error")).toHaveLength(10);
    expect(annotations.filter((a) => a.level === "warning")).toHaveLength(3);
    expect(omitted).toBe(2);
  });
});

describe("renderReport", () => {
  const options = {
    title: "Xcode Results",
    showPassedTests: true,
    showCodeCoverage: true,
    displayPath: (file: string) => relative(file) ?? file,
  };

  test("renders the full report", () => {
    expect(renderReport(buildReport(fixtures), options)).toMatchSnapshot();
  });

  test("renders a build-only bundle", () => {
    expect(renderReport(buildReport({ build: fixtures.build }), options)).toMatchSnapshot();
  });

  test("keeps backticks in failure messages inside the code block", () => {
    const report = buildReport({});
    report.failures = [{ name: "T", messages: [{ text: "expected ```a``` got `b`" }] }];
    expect(renderReport(report, options)).toContain("````\nexpected ```a``` got `b`\n````");
  });

  test("does not claim to omit the test list when it is disabled", () => {
    const report = buildReport(fixtures);
    const withoutTests = { ...options, showPassedTests: false };
    const maxBytes = Buffer.byteLength(renderReport(report, withoutTests)) - 1;
    const markdown = renderReport(report, { ...withoutTests, maxBytes });
    expect(markdown).toContain("Per-file coverage was omitted");
    expect(markdown).not.toContain("list of all tests");
  });

  test("omits sections to stay within the size limit", () => {
    const report = buildReport(fixtures);
    const full = renderReport(report, options);
    const small = renderReport(report, { ...options, maxBytes: Buffer.byteLength(full) - 1 });
    expect(small).not.toContain("### All tests");
    expect(small).toContain("CalculatorXCTests/testSubtractFails()");
    expect(
      Buffer.byteLength(renderReport(report, { ...options, maxBytes: 500 })),
    ).toBeLessThanOrEqual(500);
  });
});
