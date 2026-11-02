// Usage: node scripts/sanitize-fixture.ts <repository root> < input.json > output.json
// Replaces the repository path and device IDs so fixtures don't depend on the machine.
import { readFileSync } from "node:fs";

const repositoryRoot = process.argv[2];
if (!repositoryRoot) throw new Error("usage: sanitize-fixture.ts <repository root>");

function sanitize(value: unknown, root: string, key?: string): unknown {
  if (typeof value === "string") {
    return key === "deviceId" ? "DEVICE-ID" : value.replaceAll(root, "/WORKSPACE");
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, root));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, root, k)]));
  }
  return value;
}

const input: unknown = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(`${JSON.stringify(sanitize(input, repositoryRoot), null, 2)}\n`);
