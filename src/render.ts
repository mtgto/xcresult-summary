import { summary } from "@actions/core";
import {
  coverageTargets,
  hasErrors,
  lineCoverage,
  type Report,
  type SourceLocation,
  statusIcon,
  walkTestCases,
} from "./report.ts";
import type { Device } from "./types.ts";

export interface RenderOptions {
  title: string;
  showPassedTests: boolean;
  showCodeCoverage: boolean;
  /** Turns a recorded file path into a display path (workspace-relative when possible). */
  displayPath?: (file: string) => string;
  /** GitHub limits a job summary to 1 MiB per step. */
  maxBytes?: number;
}

interface Sections {
  allTests: boolean;
  coverageFiles: boolean;
  note?: string;
}

const DEFAULT_MAX_BYTES = 1000 * 1000;

/** Renders the report as the HTML of a job summary. */
export function renderReport(report: Report, options: RenderOptions): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  // Drop the least important sections first until the report fits.
  const attempts: Sections[] = [{ allTests: options.showPassedTests, coverageFiles: true }];
  if (options.showPassedTests) {
    attempts.push({
      allTests: false,
      coverageFiles: true,
      note: "The list of all tests was omitted because the summary is too large.",
    });
  }
  attempts.push({
    allTests: false,
    coverageFiles: false,
    note: options.showPassedTests
      ? "The list of all tests and per-file coverage were omitted because the summary is too large."
      : "Per-file coverage was omitted because the summary is too large.",
  });
  let rendered = "";
  for (const attempt of attempts) {
    rendered = render(report, options, attempt);
    if (Buffer.byteLength(rendered) <= maxBytes) return rendered;
  }
  const suffix = html((s) =>
    s.addEOL().addQuote("Warning: the summary was truncated because it is too large."),
  );
  return truncateBytes(rendered, maxBytes - Buffer.byteLength(suffix)) + suffix;
}

/**
 * Builds HTML with core.summary and returns it without keeping it in the buffer.
 * core.summary is a single shared buffer, so this must not be nested: render inner
 * contents (e.g. of <details>) before the outer element.
 */
function html(build: (s: typeof summary) => unknown): string {
  summary.emptyBuffer();
  build(summary);
  const result = summary.stringify();
  summary.emptyBuffer();
  return result;
}

function render(report: Report, options: RenderOptions, sections: Sections): string {
  const displayPath = options.displayPath ?? ((file: string) => file);
  const parts = [
    html((s) => {
      s.addHeading(`${hasErrors(report) ? "❌" : "✅"} ${text(options.title)}`, 2);
      if (sections.note) s.addQuote(text(sections.note));
    }),
    renderSummary(report),
    renderBuildIssues(report, displayPath),
    renderFailures(report, displayPath),
    sections.allTests ? renderAllTests(report) : "",
    options.showCodeCoverage ? renderCoverage(report, displayPath, sections) : "",
  ];
  return parts.join("");
}

function renderSummary(report: Report): string {
  const { summary: testSummary, build } = report;
  if (testSummary) {
    const duration =
      testSummary.startTime !== undefined && testSummary.finishTime !== undefined
        ? formatDuration(testSummary.finishTime - testSummary.startTime)
        : "-";
    return html((s) => {
      s.addTable([
        headerRow([
          "Total",
          "✅ Passed",
          "❌ Failed",
          "⏭️ Skipped",
          "⚠️ Expected Failure",
          "⏱️ Duration",
        ]),
        [
          String(testSummary.totalTestCount),
          String(testSummary.passedTests),
          String(testSummary.failedTests),
          String(testSummary.skippedTests),
          String(testSummary.expectedFailures),
          duration,
        ],
      ]);
      if (testSummary.devicesAndConfigurations.length > 0) {
        s.addList(
          testSummary.devicesAndConfigurations.map(
            (config) =>
              `${text(formatDevice(config.device))} — ${text(config.testPlanConfiguration.configurationName)}`,
          ),
        );
      }
    });
  }
  if (build) {
    return html((s) =>
      s.addTable([
        headerRow(["Action", "Status", "Destination", "⏱️ Duration"]),
        [
          text(build.actionTitle ?? "Build"),
          text(build.status ?? "unknown"),
          text(formatDevice(build.destination)),
          formatDuration(build.endTime - build.startTime),
        ],
      ]),
    );
  }
  return "";
}

function renderBuildIssues(report: Report, displayPath: (file: string) => string): string {
  if (report.buildIssues.length === 0) return "";
  const errors = report.buildIssues.filter((i) => i.severity === "error").length;
  const warnings = report.buildIssues.length - errors;
  return html((s) =>
    s
      .addHeading(`Build: ${plural(errors, "error")}, ${plural(warnings, "warning")}`, 3)
      .addTable([
        headerRow(["Severity", "Location", "Message"]),
        ...report.buildIssues.map((issue) => [
          issue.severity === "error" ? "❌" : "⚠️",
          issue.location ? text(formatLocation(issue.location, displayPath)) : "-",
          text(issue.message),
        ]),
      ]),
  );
}

function renderFailures(report: Report, displayPath: (file: string) => string): string {
  if (report.failures.length === 0) return "";
  return html((s) => {
    s.addHeading(`❌ Failures (${report.failures.length})`, 3);
    for (const failure of report.failures) {
      const target = failure.target ? ` (${text(failure.target)})` : "";
      s.addHeading(`${text(failure.name)}${target}`, 4);
      if (failure.messages.length === 0) s.addQuote("No failure message was recorded.");
      for (const message of failure.messages) {
        // Like xcodebuild's output: the location on the first line, then the message.
        const location = message.location
          ? `${formatLocation(message.location, displayPath)}\n`
          : "";
        // Blank lines around <pre> keep it a separate HTML block in GitHub's Markdown, so that
        // blank lines inside the message don't end the surrounding block.
        s.addEOL()
          .addCodeBlock(escapeHTML(location + message.text))
          .addEOL();
      }
    }
  });
}

function renderAllTests(report: Report): string {
  const entries = [...walkTestCases(report.tests?.testNodes ?? [])];
  if (entries.length === 0) return "";
  const groups = Map.groupBy(entries, (entry) =>
    [entry.bundle?.name, ...entry.suites.map((suite) => suite.name)].filter(Boolean).join(" / "),
  );
  const details = [...groups].map(([group, cases]) => {
    const failed = cases.some((c) => c.testCase.result === "Failed");
    const passed = cases.filter((c) => c.testCase.result === "Passed").length;
    const label = `${failed ? "❌" : "✅"} ${text(group || "Tests")} (${passed}/${cases.length} passed)`;
    const list = html((s) =>
      s.addList(
        cases.map(({ testCase }) => {
          const duration =
            testCase.durationInSeconds !== undefined
              ? ` (${formatDuration(testCase.durationInSeconds)})`
              : "";
          return `${statusIcon(testCase.result)} ${text(testCase.name)}${duration}`;
        }),
      ),
    );
    return { label, list };
  });
  return html((s) => {
    s.addHeading("All tests", 3);
    for (const { label, list } of details) s.addDetails(label, list);
  });
}

function renderCoverage(
  report: Report,
  displayPath: (file: string) => string,
  sections: Sections,
): string {
  if (!report.coverage) return "";
  const targets = coverageTargets(report.coverage);
  const total = lineCoverage(report.coverage);
  if (targets.length === 0 || total === undefined) return "";
  const files = sections.coverageFiles
    ? targets.map((target) => ({
        label: `${text(target.name)} files`,
        table: html((s) =>
          s.addTable([
            coverageHeader("File"),
            ...target.files
              .toSorted((a, b) => a.lineCoverage - b.lineCoverage)
              .map((file) => [
                text(displayPath(file.path)),
                formatPercent(file.lineCoverage * 100),
                `${file.coveredLines} / ${file.executableLines}`,
              ]),
          ]),
        ),
      }))
    : [];
  return html((s) => {
    s.addHeading(`Code coverage: ${formatPercent(total)}`, 3).addTable([
      coverageHeader("Target"),
      ...targets.map((target) => [
        text(target.name),
        formatPercent(target.lineCoverage * 100),
        `${target.coveredLines} / ${target.executableLines}`,
      ]),
    ]);
    for (const { label, table } of files) s.addDetails(label, table);
  });
}

type SummaryTableRow = Parameters<typeof summary.addTable>[0][number];

function headerRow(cells: string[]): SummaryTableRow {
  return cells.map((data) => ({ data, header: true }));
}

function coverageHeader(first: string): SummaryTableRow {
  return headerRow([first, "Coverage", "Covered / Executable lines"]);
}

function formatDevice(device: Device): string {
  const os = [device.platform, device.osVersion].filter(Boolean).join(" ");
  return `${device.deviceName} (${device.modelName}, ${os}, ${device.architecture})`;
}

function formatLocation(location: SourceLocation, displayPath: (file: string) => string): string {
  const file = displayPath(location.file);
  return location.line !== undefined ? `${file}:${location.line}` : file;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** core.summary inserts strings as raw HTML, so all text from the bundle must be escaped. */
function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escaped text for a single-line element. A blank line would end the HTML block in
 * GitHub's Markdown, so line breaks are replaced with spaces.
 */
function text(value: string): string {
  return escapeHTML(value).replace(/\r?\n/g, " ");
}

function truncateBytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  // Avoid cutting a multi-byte character in half.
  return buffer.subarray(0, maxBytes).toString().replace(/�$/, "");
}
