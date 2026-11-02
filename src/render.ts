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

const DEFAULT_MAX_BYTES = 1000 * 1000;

export function renderReport(report: Report, options: RenderOptions): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  // Drop the least important sections first until the report fits.
  const attempts: { allTests: boolean; coverageFiles: boolean; note?: string }[] = [
    { allTests: options.showPassedTests, coverageFiles: true },
  ];
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
  let markdown = "";
  for (const attempt of attempts) {
    markdown = render(report, options, attempt);
    if (Buffer.byteLength(markdown) <= maxBytes) return markdown;
  }
  const suffix = "\n\n> [!WARNING]\n> The summary was truncated because it is too large.\n";
  return truncateBytes(markdown, maxBytes - Buffer.byteLength(suffix)) + suffix;
}

function render(
  report: Report,
  options: RenderOptions,
  sections: { allTests: boolean; coverageFiles: boolean; note?: string },
): string {
  const displayPath = options.displayPath ?? ((file: string) => file);
  const out: string[] = [];
  out.push(`## ${hasErrors(report) ? "❌" : "✅"} ${escapeMarkdown(options.title)}`, "");
  if (sections.note) out.push(`> [!NOTE]`, `> ${sections.note}`, "");

  out.push(...renderSummary(report));
  out.push(...renderBuildIssues(report, displayPath));
  out.push(...renderFailures(report, displayPath));
  if (sections.allTests) out.push(...renderAllTests(report));
  if (options.showCodeCoverage) out.push(...renderCoverage(report, displayPath, sections));
  return out.join("\n").trimEnd() + "\n";
}

function renderSummary(report: Report): string[] {
  const { summary, build } = report;
  const out: string[] = [];
  if (summary) {
    const duration =
      summary.startTime !== undefined && summary.finishTime !== undefined
        ? formatDuration(summary.finishTime - summary.startTime)
        : "-";
    out.push(
      "| Total | ✅ Passed | ❌ Failed | ⏭️ Skipped | ⚠️ Expected Failure | ⏱️ Duration |",
      "| ---: | ---: | ---: | ---: | ---: | ---: |",
      `| ${summary.totalTestCount} | ${summary.passedTests} | ${summary.failedTests} | ${summary.skippedTests} | ${summary.expectedFailures} | ${duration} |`,
      "",
    );
    for (const config of summary.devicesAndConfigurations) {
      out.push(
        `- ${escapeMarkdown(formatDevice(config.device))} — ${escapeMarkdown(config.testPlanConfiguration.configurationName)}`,
      );
    }
    if (summary.devicesAndConfigurations.length > 0) out.push("");
  } else if (build) {
    out.push(
      `${escapeMarkdown(build.actionTitle ?? "Build")}: **${escapeMarkdown(build.status ?? "unknown")}** on ${escapeMarkdown(formatDevice(build.destination))} (${formatDuration(build.endTime - build.startTime)})`,
      "",
    );
  }
  return out;
}

function renderBuildIssues(report: Report, displayPath: (file: string) => string): string[] {
  if (report.buildIssues.length === 0) return [];
  const errors = report.buildIssues.filter((i) => i.severity === "error").length;
  const warnings = report.buildIssues.length - errors;
  const out = [`### Build: ${plural(errors, "error")}, ${plural(warnings, "warning")}`, ""];
  for (const issue of report.buildIssues) {
    const icon = issue.severity === "error" ? "❌" : "⚠️";
    const location = issue.location ? ` ${code(formatLocation(issue.location, displayPath))}` : "";
    out.push(`- ${icon}${location} ${escapeMarkdown(issue.message)}`);
  }
  out.push("");
  return out;
}

function renderFailures(report: Report, displayPath: (file: string) => string): string[] {
  if (report.failures.length === 0) return [];
  const out = [`### ❌ Failures (${report.failures.length})`, ""];
  for (const failure of report.failures) {
    const target = failure.target ? ` (${escapeMarkdown(failure.target)})` : "";
    out.push(`#### ${escapeMarkdown(failure.name)}${target}`, "");
    if (failure.messages.length === 0) out.push("_No failure message was recorded._", "");
    for (const message of failure.messages) {
      if (message.location) out.push(code(formatLocation(message.location, displayPath)), "");
      out.push(...codeBlock(message.text), "");
    }
  }
  return out;
}

function renderAllTests(report: Report): string[] {
  const entries = [...walkTestCases(report.tests?.testNodes ?? [])];
  if (entries.length === 0) return [];
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = [entry.bundle?.name, ...entry.suites.map((s) => s.name)]
      .filter(Boolean)
      .join(" / ");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const out = ["### All tests", ""];
  for (const [group, cases] of groups) {
    const failed = cases.some((c) => c.testCase.result === "Failed");
    const passed = cases.filter((c) => c.testCase.result === "Passed").length;
    out.push(
      "<details>",
      `<summary>${failed ? "❌" : "✅"} ${escapeHTML(group || "Tests")} (${passed}/${cases.length} passed)</summary>`,
      "",
    );
    for (const { testCase } of cases) {
      const duration =
        testCase.durationInSeconds !== undefined
          ? ` (${formatDuration(testCase.durationInSeconds)})`
          : "";
      out.push(`- ${statusIcon(testCase.result)} ${escapeMarkdown(testCase.name)}${duration}`);
    }
    out.push("", "</details>", "");
  }
  return out;
}

function renderCoverage(
  report: Report,
  displayPath: (file: string) => string,
  sections: { coverageFiles: boolean },
): string[] {
  if (!report.coverage) return [];
  const targets = coverageTargets(report.coverage);
  const total = lineCoverage(report.coverage);
  if (targets.length === 0 || total === undefined) return [];
  const out = [
    `### Code coverage: ${formatPercent(total)}`,
    "",
    "| Target | Coverage | Covered / Executable lines |",
    "| --- | ---: | ---: |",
  ];
  for (const target of targets) {
    out.push(
      `| ${escapeMarkdown(target.name)} | ${formatPercent(target.lineCoverage * 100)} | ${target.coveredLines} / ${target.executableLines} |`,
    );
  }
  out.push("");
  if (sections.coverageFiles) {
    for (const target of targets) {
      out.push(
        "<details>",
        `<summary>${escapeHTML(target.name)} files</summary>`,
        "",
        "| File | Coverage | Covered / Executable lines |",
        "| --- | ---: | ---: |",
      );
      const files = target.files.toSorted((a, b) => a.lineCoverage - b.lineCoverage);
      for (const file of files) {
        out.push(
          `| ${escapeMarkdown(displayPath(file.path))} | ${formatPercent(file.lineCoverage * 100)} | ${file.coveredLines} / ${file.executableLines} |`,
        );
      }
      out.push("", "</details>", "");
    }
  }
  return out;
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

/** Inline code that survives backticks in the content. */
function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Fenced code block that survives backtick runs in the content. */
function codeBlock(text: string): string[] {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, text, fence];
}

function escapeHTML(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeMarkdown(text: string): string {
  return escapeHTML(text)
    .replace(/([\\`*_[\]|#])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}

function truncateBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text);
  if (buffer.byteLength <= maxBytes) return text;
  // Avoid cutting a multi-byte character in half.
  return buffer.subarray(0, maxBytes).toString().replace(/�$/, "");
}
