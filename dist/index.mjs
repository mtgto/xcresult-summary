// src/main.ts
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// src/actions.ts
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { EOL } from "node:os";
function getInput(name) {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}
function getMultilineInput(name) {
  return getInput(name).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}
function getBooleanInput(name) {
  const value = getInput(name);
  if (["true", "True", "TRUE"].includes(value)) return true;
  if (["false", "False", "FALSE", ""].includes(value)) return false;
  throw new TypeError(`Input "${name}" must be "true" or "false", but got "${value}"`);
}
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    process.stdout.write(`${EOL}::set-output name=${name}::${escapeData(value)}${EOL}`);
    return;
  }
  const delimiter = `ghadelimiter_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`);
}
function appendSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) {
    process.stdout.write(markdown + EOL);
    return;
  }
  appendFileSync(file, markdown + EOL);
}
function annotate(level, message, properties = {}) {
  const props = Object.entries(properties).filter(([, value]) => value !== void 0 && value !== "").map(([key, value]) => `${key}=${escapeProperty(String(value))}`).join(",");
  process.stdout.write(`::${level}${props ? ` ${props}` : ""}::${escapeData(message)}${EOL}`);
}
function info(message) {
  process.stdout.write(message + EOL);
}
function setFailed(message) {
  process.exitCode = 1;
  annotate("error", message);
}
function escapeData(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(value) {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

// src/annotations.ts
var MAX_ANNOTATIONS_PER_LEVEL = 10;
function collectAnnotations(report, toWorkspacePath2) {
  const annotations = [];
  for (const issue of report.buildIssues) {
    annotations.push({
      level: issue.severity,
      message: issue.message,
      properties: {
        title: issue.target ? `Build ${issue.severity} in ${issue.target}` : `Build ${issue.severity}`,
        file: issue.location && toWorkspacePath2(issue.location.file),
        line: issue.location?.line
      }
    });
  }
  for (const failure of report.failures) {
    const messages = failure.messages.length > 0 ? failure.messages : [{ text: "Test failed" }];
    for (const message of messages) {
      annotations.push({
        level: "error",
        message: message.text,
        properties: {
          title: `${failure.name} failed`,
          file: message.location && toWorkspacePath2(message.location.file),
          line: message.location?.line
        }
      });
    }
  }
  const counts = { error: 0, warning: 0 };
  const limited = annotations.filter((a) => ++counts[a.level] <= MAX_ANNOTATIONS_PER_LEVEL);
  return { annotations: limited, omitted: annotations.length - limited.length };
}

// src/paths.ts
import { isAbsolute, relative, sep } from "node:path";
function toWorkspacePath(file, workspace) {
  if (!isAbsolute(file)) return void 0;
  const rel = relative(workspace, file);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return void 0;
  return rel.split(sep).join("/");
}

// src/report.ts
import { fileURLToPath } from "node:url";
function buildReport(input) {
  return {
    ...input,
    failures: collectFailures(input.summary, input.tests),
    buildIssues: collectBuildIssues(input.build)
  };
}
function collectFailures(summary, tests) {
  const failures = /* @__PURE__ */ new Map();
  for (const { bundle, suites, testCase } of walkTestCases(tests?.testNodes ?? [])) {
    if (testCase.result !== "Failed") continue;
    const name = testCase.nodeIdentifier ?? [...suites.map((s) => s.name), testCase.name].join("/");
    const messages = descendants(testCase).filter((node) => node.nodeType === "Failure Message").map(toFailureMessage);
    const existing = failures.get(name);
    if (existing) {
      existing.messages = uniqueMessages([...existing.messages, ...messages]);
    } else {
      failures.set(name, { name, target: bundle?.name, messages: uniqueMessages(messages) });
    }
  }
  for (const failure of summary?.testFailures ?? []) {
    const name = failure.testIdentifierString || failure.testName;
    const existing = failures.get(name);
    if (!existing) {
      failures.set(name, {
        name,
        target: failure.targetName,
        messages: [{ text: failure.failureText }]
      });
    } else if (existing.messages.length === 0) {
      existing.messages.push({ text: failure.failureText });
    }
  }
  return [...failures.values()];
}
function* walkTestCases(nodes, bundle, suites = []) {
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
function descendants(node) {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}
function toFailureMessage(node) {
  return {
    text: node.name,
    location: node.sourceLocation && {
      file: node.sourceLocation.filePath,
      line: node.sourceLocation.lineNumber
    }
  };
}
function uniqueMessages(messages) {
  const keys = /* @__PURE__ */ new Set();
  return messages.filter((m) => {
    const key = `${m.location?.file}:${m.location?.line}:${m.text}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
function collectBuildIssues(build) {
  if (!build) return [];
  const toIssue = (severity) => (issue) => ({
    severity,
    message: issue.message,
    target: issue.targetName,
    location: issue.sourceURL ? parseSourceURL(issue.sourceURL) : void 0
  });
  return [
    ...build.errors.map(toIssue("error")),
    ...build.warnings.map(toIssue("warning")),
    ...build.analyzerWarnings.map(toIssue("warning"))
  ];
}
function parseSourceURL(sourceURL) {
  if (!URL.canParse(sourceURL)) return void 0;
  const url = new URL(sourceURL);
  if (url.protocol !== "file:") return void 0;
  const params = new URLSearchParams(url.hash.slice(1));
  const start = params.get("StartingLineNumber");
  return {
    file: fileURLToPath(url),
    // xcresult records 0-based line numbers in source URLs
    line: start !== null ? Number(start) + 1 : void 0
  };
}
function statusIcon(result) {
  switch (result) {
    case "Passed":
      return "\u2705";
    case "Failed":
      return "\u274C";
    case "Skipped":
      return "\u23ED\uFE0F";
    case "Expected Failure":
      return "\u26A0\uFE0F";
    default:
      return "\u2754";
  }
}
function hasErrors(report) {
  return report.failures.length > 0 || (report.summary?.failedTests ?? 0) > 0 || report.buildIssues.some((i) => i.severity === "error");
}
function lineCoverage(coverage) {
  const targets = coverageTargets(coverage);
  const executable = targets.reduce((sum, t) => sum + t.executableLines, 0);
  if (executable === 0) return void 0;
  const covered = targets.reduce((sum, t) => sum + t.coveredLines, 0);
  return covered / executable * 100;
}
function coverageTargets(coverage) {
  return coverage.targets.filter(
    (t) => t.executableLines > 0 && !t.name.endsWith(".xctest") && !(t.buildProductPath ?? "").includes(".xctest/")
  );
}

// src/render.ts
var DEFAULT_MAX_BYTES = 1e3 * 1e3;
function renderReport(report, options) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const attempts = [
    { allTests: options.showPassedTests, coverageFiles: true }
  ];
  if (options.showPassedTests) {
    attempts.push({
      allTests: false,
      coverageFiles: true,
      note: "The list of all tests was omitted because the summary is too large."
    });
  }
  attempts.push({
    allTests: false,
    coverageFiles: false,
    note: options.showPassedTests ? "The list of all tests and per-file coverage were omitted because the summary is too large." : "Per-file coverage was omitted because the summary is too large."
  });
  let markdown = "";
  for (const attempt of attempts) {
    markdown = render(report, options, attempt);
    if (Buffer.byteLength(markdown) <= maxBytes) return markdown;
  }
  const suffix = "\n\n> [!WARNING]\n> The summary was truncated because it is too large.\n";
  return truncateBytes(markdown, maxBytes - Buffer.byteLength(suffix)) + suffix;
}
function render(report, options, sections) {
  const displayPath = options.displayPath ?? ((file) => file);
  const out = [];
  out.push(`## ${hasErrors(report) ? "\u274C" : "\u2705"} ${escapeMarkdown(options.title)}`, "");
  if (sections.note) out.push(`> [!NOTE]`, `> ${sections.note}`, "");
  out.push(...renderSummary(report));
  out.push(...renderBuildIssues(report, displayPath));
  out.push(...renderFailures(report, displayPath));
  if (sections.allTests) out.push(...renderAllTests(report));
  if (options.showCodeCoverage) out.push(...renderCoverage(report, displayPath, sections));
  return out.join("\n").trimEnd() + "\n";
}
function renderSummary(report) {
  const { summary, build } = report;
  const out = [];
  if (summary) {
    const duration = summary.startTime !== void 0 && summary.finishTime !== void 0 ? formatDuration(summary.finishTime - summary.startTime) : "-";
    out.push(
      "| Total | \u2705 Passed | \u274C Failed | \u23ED\uFE0F Skipped | \u26A0\uFE0F Expected Failure | \u23F1\uFE0F Duration |",
      "| ---: | ---: | ---: | ---: | ---: | ---: |",
      `| ${summary.totalTestCount} | ${summary.passedTests} | ${summary.failedTests} | ${summary.skippedTests} | ${summary.expectedFailures} | ${duration} |`,
      ""
    );
    for (const config of summary.devicesAndConfigurations) {
      out.push(
        `- ${escapeMarkdown(formatDevice(config.device))} \u2014 ${escapeMarkdown(config.testPlanConfiguration.configurationName)}`
      );
    }
    if (summary.devicesAndConfigurations.length > 0) out.push("");
  } else if (build) {
    out.push(
      `${escapeMarkdown(build.actionTitle ?? "Build")}: **${escapeMarkdown(build.status ?? "unknown")}** on ${escapeMarkdown(formatDevice(build.destination))} (${formatDuration(build.endTime - build.startTime)})`,
      ""
    );
  }
  return out;
}
function renderBuildIssues(report, displayPath) {
  if (report.buildIssues.length === 0) return [];
  const errors = report.buildIssues.filter((i) => i.severity === "error").length;
  const warnings = report.buildIssues.length - errors;
  const out = [`### Build: ${plural(errors, "error")}, ${plural(warnings, "warning")}`, ""];
  for (const issue of report.buildIssues) {
    const icon = issue.severity === "error" ? "\u274C" : "\u26A0\uFE0F";
    const location = issue.location ? ` ${code(formatLocation(issue.location, displayPath))}` : "";
    out.push(`- ${icon}${location} ${escapeMarkdown(issue.message)}`);
  }
  out.push("");
  return out;
}
function renderFailures(report, displayPath) {
  if (report.failures.length === 0) return [];
  const out = [`### \u274C Failures (${report.failures.length})`, ""];
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
function renderAllTests(report) {
  const entries = [...walkTestCases(report.tests?.testNodes ?? [])];
  if (entries.length === 0) return [];
  const groups = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key = [entry.bundle?.name, ...entry.suites.map((s) => s.name)].filter(Boolean).join(" / ");
    groups.set(key, [...groups.get(key) ?? [], entry]);
  }
  const out = ["### All tests", ""];
  for (const [group, cases] of groups) {
    const failed = cases.some((c) => c.testCase.result === "Failed");
    const passed = cases.filter((c) => c.testCase.result === "Passed").length;
    out.push(
      "<details>",
      `<summary>${failed ? "\u274C" : "\u2705"} ${escapeHTML(group || "Tests")} (${passed}/${cases.length} passed)</summary>`,
      ""
    );
    for (const { testCase } of cases) {
      const duration = testCase.durationInSeconds !== void 0 ? ` (${formatDuration(testCase.durationInSeconds)})` : "";
      out.push(`- ${statusIcon(testCase.result)} ${escapeMarkdown(testCase.name)}${duration}`);
    }
    out.push("", "</details>", "");
  }
  return out;
}
function renderCoverage(report, displayPath, sections) {
  if (!report.coverage) return [];
  const targets = coverageTargets(report.coverage);
  const total = lineCoverage(report.coverage);
  if (targets.length === 0 || total === void 0) return [];
  const out = [
    `### Code coverage: ${formatPercent(total)}`,
    "",
    "| Target | Coverage | Covered / Executable lines |",
    "| --- | ---: | ---: |"
  ];
  for (const target of targets) {
    out.push(
      `| ${escapeMarkdown(target.name)} | ${formatPercent(target.lineCoverage * 100)} | ${target.coveredLines} / ${target.executableLines} |`
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
        "| --- | ---: | ---: |"
      );
      const files = target.files.toSorted((a, b) => a.lineCoverage - b.lineCoverage);
      for (const file of files) {
        out.push(
          `| ${escapeMarkdown(displayPath(file.path))} | ${formatPercent(file.lineCoverage * 100)} | ${file.coveredLines} / ${file.executableLines} |`
        );
      }
      out.push("", "</details>", "");
    }
  }
  return out;
}
function formatDevice(device) {
  const os = [device.platform, device.osVersion].filter(Boolean).join(" ");
  return `${device.deviceName} (${device.modelName}, ${os}, ${device.architecture})`;
}
function formatLocation(location, displayPath) {
  const file = displayPath(location.file);
  return location.line !== void 0 ? `${file}:${location.line}` : file;
}
function formatDuration(seconds) {
  if (seconds < 1) return `${Math.round(seconds * 1e3)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}
function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
function code(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
function codeBlock(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence, text, fence];
}
function escapeHTML(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeMarkdown(text) {
  return escapeHTML(text).replace(/([\\`*_[\]|#])/g, "\\$1").replace(/\r?\n/g, " ");
}
function truncateBytes(text, maxBytes) {
  const buffer = Buffer.from(text);
  if (buffer.byteLength <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString().replace(/�$/, "");
}

// src/xcresult.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
async function xcrun(args) {
  const { stdout } = await execFileAsync("xcrun", args, {
    // test-results tests can be large for big projects
    maxBuffer: 1024 * 1024 * 1024
  });
  return stdout;
}
async function xcrunJSON(args) {
  return JSON.parse(await xcrun(args));
}
async function mergeBundles(paths, outputPath) {
  await xcrun(["xcresulttool", "merge", ...paths, "--output-path", outputPath]);
}
function getTestSummary(path) {
  return xcrunJSON(["xcresulttool", "get", "test-results", "summary", "--path", path, "--compact"]);
}
function getTests(path) {
  return xcrunJSON(["xcresulttool", "get", "test-results", "tests", "--path", path, "--compact"]);
}
function getBuildResults(path) {
  return xcrunJSON(["xcresulttool", "get", "build-results", "--path", path, "--compact"]);
}
function getCoverage(path) {
  return xcrunJSON(["xccov", "view", "--report", "--json", path]);
}
async function optional(label, promise) {
  try {
    return await promise;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    info(`[xcresult-summary] Skipped ${label}: ${detail.trim()}`);
    return void 0;
  }
}

// src/main.ts
async function run() {
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
  let bundle = paths[0];
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
    showCodeCoverage ? optional("code coverage", getCoverage(bundle)) : void 0
  ]);
  if (!summary && !tests && !build) {
    throw new Error(`No build or test results could be read from ${bundle}`);
  }
  const report = buildReport({ summary, tests, build, coverage });
  const relative2 = (file) => toWorkspacePath(file, workspace);
  appendSummary(
    renderReport(report, {
      title,
      showPassedTests,
      showCodeCoverage,
      displayPath: (file) => relative2(file) ?? file
    })
  );
  const { annotations, omitted } = collectAnnotations(report, relative2);
  for (const { level, message, properties } of annotations) annotate(level, message, properties);
  if (omitted > 0) {
    info(
      `${omitted} annotations were omitted (GitHub shows up to ${MAX_ANNOTATIONS_PER_LEVEL} per level); see the job summary for all of them.`
    );
  }
  setOutput("total-tests", String(summary?.totalTestCount ?? 0));
  setOutput("passed-tests", String(summary?.passedTests ?? 0));
  setOutput("failed-tests", String(summary?.failedTests ?? 0));
  setOutput("skipped-tests", String(summary?.skippedTests ?? 0));
  const coveragePercent = coverage ? lineCoverage(coverage) : void 0;
  setOutput("line-coverage", coveragePercent !== void 0 ? coveragePercent.toFixed(2) : "");
  if (failOnError && hasErrors(report)) {
    setFailed(`${title}: build errors or test failures were found`);
  }
}
run().catch((error) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
