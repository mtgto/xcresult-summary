import { resolve } from "node:path";

/**
 * Converts an absolute path recorded in the bundle into a workspace-relative path for annotations.
 * Returns undefined for paths outside the workspace, because GitHub can't show them.
 * Assumes POSIX paths: this action runs only on macOS.
 */
export function toWorkspacePath(file: string, workspace: string): string | undefined {
  const root = `${resolve(workspace)}/`;
  return file.startsWith(root) ? file.slice(root.length) : undefined;
}
