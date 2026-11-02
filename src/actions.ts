// Minimal replacement for @actions/core.
// See https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { EOL } from "node:os";

export function getInput(name: string): string {
  return (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}

export function getMultilineInput(name: string): string[] {
  return getInput(name)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function getBooleanInput(name: string): boolean {
  const value = getInput(name);
  if (["true", "True", "TRUE"].includes(value)) return true;
  if (["false", "False", "FALSE", ""].includes(value)) return false;
  throw new TypeError(`Input "${name}" must be "true" or "false", but got "${value}"`);
}

export function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    process.stdout.write(`${EOL}::set-output name=${name}::${escapeData(value)}${EOL}`);
    return;
  }
  const delimiter = `ghadelimiter_${randomUUID()}`;
  appendFileSync(file, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`);
}

export function appendSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) {
    // Running outside of GitHub Actions: print it so it can still be inspected.
    process.stdout.write(markdown + EOL);
    return;
  }
  appendFileSync(file, markdown + EOL);
}

export interface AnnotationProperties {
  title?: string;
  file?: string;
  line?: number;
}

export function annotate(
  level: "error" | "warning" | "notice",
  message: string,
  properties: AnnotationProperties = {},
): void {
  const props = Object.entries(properties)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${escapeProperty(String(value))}`)
    .join(",");
  process.stdout.write(`::${level}${props ? ` ${props}` : ""}::${escapeData(message)}${EOL}`);
}

export function info(message: string): void {
  process.stdout.write(message + EOL);
}

export function setFailed(message: string): void {
  process.exitCode = 1;
  annotate("error", message);
}

export function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
