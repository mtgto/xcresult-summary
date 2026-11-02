import type { AnnotationProperties } from "@actions/core";
import type { Report } from "./report.ts";

export interface Annotation {
  level: "error" | "warning";
  message: string;
  properties: AnnotationProperties;
}

/** GitHub shows at most 10 error and 10 warning annotations per step. */
export const MAX_ANNOTATIONS_PER_LEVEL = 10;

export function collectAnnotations(
  report: Report,
  toWorkspacePath: (file: string) => string | undefined,
): { annotations: Annotation[]; omitted: number } {
  const annotations: Annotation[] = [];
  for (const issue of report.buildIssues) {
    annotations.push({
      level: issue.severity,
      message: issue.message,
      properties: {
        title: issue.target
          ? `Build ${issue.severity} in ${issue.target}`
          : `Build ${issue.severity}`,
        file: issue.location && toWorkspacePath(issue.location.file),
        startLine: issue.location?.line,
      },
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
          file: message.location && toWorkspacePath(message.location.file),
          startLine: message.location?.line,
        },
      });
    }
  }
  const counts = { error: 0, warning: 0 };
  const limited = annotations.filter((a) => ++counts[a.level] <= MAX_ANNOTATIONS_PER_LEVEL);
  return { annotations: limited, omitted: annotations.length - limited.length };
}
