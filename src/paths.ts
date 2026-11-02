import { isAbsolute, relative, sep } from "node:path";

/**
 * Converts an absolute path recorded in the bundle into a workspace-relative path for annotations.
 * Returns undefined for paths outside the workspace, because GitHub can't show them.
 */
export function toWorkspacePath(file: string, workspace: string): string | undefined {
  if (!isAbsolute(file)) return undefined;
  const rel = relative(workspace, file);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}
